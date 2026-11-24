//! CPU arithmetic, as the gjs sampler did it: busy fractions
//! from two samples of `/proc/stat` counters, the kernel CPU-list syntax, and the split into
//! performance and efficiency cores.
//!
//! The gjs numbers were doubles throughout, so every counter becomes an `f64` before the first
//! arithmetic on it and each expression is written in the order the JavaScript wrote it:
//! floating-point sums depend on that order, and a counter that went backwards gives a negative
//! delta here exactly as it does there.

use std::collections::BTreeMap;
use std::fmt;

use crate::constants::PERFORMANCE_CAPACITY_RATIO;
use crate::parsers::is_ascii_digit_run;
use crate::parsers::is_js_whitespace;
use crate::parsers::parse_all_digits;
use crate::parsers::proc::CpuTimes;

/// The highest CPU number a kernel CPU list may name. No kernel has such a CPU (it builds with
/// at most 8192); the gjs `parseCpuList` has no limit and would build a list of billions of
/// numbers for a range such as `0-4000000000`, where this refuses it.
pub(crate) const MAX_CPU_NUMBER_IN_LIST: u64 = 65_535;

/// A kernel CPU list that [`parse_cpu_list`] cannot read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CpuListError {
    /// A part that is neither a number nor a `first-last` range of numbers (the gjs `Error`).
    UnparseablePart(String),
    /// A part naming a CPU above `MAX_CPU_NUMBER_IN_LIST`, which no kernel has.
    CpuNumberTooLarge(String),
}

impl fmt::Display for CpuListError {
    /// The gjs message for an unparseable part, and its own for a number out of range.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnparseablePart(part) => {
                write!(formatter, "unparseable CPU list part \"{part}\"")
            }
            Self::CpuNumberTooLarge(part) => {
                write!(
                    formatter,
                    "CPU list part \"{part}\" names a CPU above {MAX_CPU_NUMBER_IN_LIST}"
                )
            }
        }
    }
}

impl std::error::Error for CpuListError {}

/// Where cluster information may come from (the gjs `buildClusterMap` argument).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterMapInput {
    /// CPUs of the `cpu_core` PMU.
    pub core_pmu_cpus: Vec<u32>,
    /// CPUs of the `cpu_atom` PMU.
    pub atom_pmu_cpus: Vec<u32>,
    /// `cpu_capacity` per CPU.
    pub capacities: BTreeMap<u32, u64>,
    /// Number of CPUs.
    pub cpu_count: u32,
}

/// Which CPUs are performance cores and which efficiency cores.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterMap {
    /// The performance cluster, in the order the source lists it.
    pub performance_cpus: Vec<u32>,
    /// The efficiency cluster, in the order the source lists it.
    pub efficiency_cpus: Vec<u32>,
}

/// Sums the counters that make up wall-clock CPU time, as `totalTicks` does. `guest` and
/// `guest_nice` are excluded because the kernel already counts them inside `user` and `nice`.
fn total_ticks(times: &CpuTimes) -> f64 {
    times.user as f64
        + times.nice as f64
        + times.system as f64
        + times.idle as f64
        + times.iowait as f64
        + times.irq as f64
        + times.softirq as f64
        + times.steal as f64
}

/// Idle ticks: `iowait` is the CPU waiting with nothing to run, so it is idle.
fn idle_ticks(times: &CpuTimes) -> f64 {
    times.idle as f64 + times.iowait as f64
}

/// Busy fraction between two samples of one CPU line.
///
/// Parameters
/// ----------
/// previous, current
///     The earlier and the later counters; `None` when a sample is missing (the first one).
///
/// Returns
/// -------
/// `None` when a sample is missing or no ticks elapsed (or the total went backwards); otherwise
/// the fraction, which a counter that went backwards can push outside 0 to 1, as in gjs.
pub fn cpu_busy_fraction(previous: Option<&CpuTimes>, current: Option<&CpuTimes>) -> Option<f64> {
    let (previous, current) = (previous?, current?);
    let total_delta = total_ticks(current) - total_ticks(previous);
    // `!(totalDelta > 0)`: written with a comparison that is false for NaN as well.
    if total_delta.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
        return None;
    }
    let idle_delta = idle_ticks(current) - idle_ticks(previous);
    Some((total_delta - idle_delta) / total_delta)
}

/// Busy fraction of a group of CPUs, from summed deltas. CPUs missing from either map (offline
/// CPUs have no line) are skipped; a CPU listed twice counts twice, as in gjs.
///
/// Returns
/// -------
/// `None` when no CPU of the group is present or nothing elapsed.
pub fn cluster_busy_fraction(
    previous: &BTreeMap<u32, CpuTimes>,
    current: &BTreeMap<u32, CpuTimes>,
    cpus: &[u32],
) -> Option<f64> {
    let mut total_delta = 0.0_f64;
    let mut idle_delta = 0.0_f64;
    let mut present_count = 0_u64;
    for cpu in cpus {
        let (Some(previous_times), Some(current_times)) = (previous.get(cpu), current.get(cpu))
        else {
            continue;
        };
        present_count += 1;
        total_delta += total_ticks(current_times) - total_ticks(previous_times);
        idle_delta += idle_ticks(current_times) - idle_ticks(previous_times);
    }
    // `present_count == 0` is the gjs function's own first test, kept so the two read alike. It
    // cannot change an answer: with no CPU present the total is still 0.0, which the second test
    // refuses as well, so removing it changes no output.
    if present_count == 0 || total_delta.partial_cmp(&0.0) != Some(std::cmp::Ordering::Greater) {
        return None;
    }
    Some((total_delta - idle_delta) / total_delta)
}

/// Reads one CPU number of a CPU list: ASCII digits only, no sign, within the kernel's range.
/// `whole_part` is the part as it stood in the list, untrimmed, which is the text an error names.
fn parse_cpu_number(digits: &str, whole_part: &str) -> Result<u32, CpuListError> {
    if !is_ascii_digit_run(digits) {
        return Err(CpuListError::UnparseablePart(whole_part.to_string()));
    }
    // All digits, so a failure to read them as a u64 means a number beyond any kernel's.
    let value = parse_all_digits(digits).filter(|&value| value <= MAX_CPU_NUMBER_IN_LIST);
    value
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| CpuListError::CpuNumberTooLarge(whole_part.to_string()))
}

/// Parses a kernel CPU list such as `0-3,6,8-9`: `/^(\d+)(?:-(\d+))?$/` on each trimmed part.
///
/// Returns
/// -------
/// The CPU numbers in listed order; empty for an empty or blank text, and for a range whose
/// last number is below its first (`3-1`), as in gjs.
///
/// Errors
/// ------
/// [`CpuListError`] where the gjs function throws: a part that is not a number or a range.
pub fn parse_cpu_list(text: &str) -> Result<Vec<u32>, CpuListError> {
    let trimmed = text.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let mut cpus = Vec::new();
    for untrimmed_part in trimmed.split(',') {
        // Trimmed only to match; an error names the part untrimmed, as the gjs message does.
        let part = untrimmed_part.trim_matches(is_js_whitespace);
        let (first_digits, last_digits) = part.split_once('-').unwrap_or((part, part));
        let first = parse_cpu_number(first_digits, untrimmed_part)?;
        let last = parse_cpu_number(last_digits, untrimmed_part)?;
        cpus.extend(first..=last);
    }
    Ok(cpus)
}

/// Splits CPUs into performance and efficiency clusters. Prefers the hybrid PMU lists, then
/// `cpu_capacity` (performance = at least `PERFORMANCE_CAPACITY_RATIO` of the maximum, so 1024
/// and 1005 stay together).
///
/// Returns
/// -------
/// `None` for a single-cluster machine.
pub fn build_cluster_map(input: ClusterMapInput) -> Option<ClusterMap> {
    if !input.core_pmu_cpus.is_empty() && !input.atom_pmu_cpus.is_empty() {
        return Some(ClusterMap {
            performance_cpus: input.core_pmu_cpus,
            efficiency_cpus: input.atom_pmu_cpus,
        });
    }
    let max_capacity = input.capacities.values().copied().max()? as f64;
    let performance_floor = PERFORMANCE_CAPACITY_RATIO * max_capacity;
    let mut performance_cpus = Vec::new();
    let mut efficiency_cpus = Vec::new();
    for cpu in 0..input.cpu_count {
        let Some(&capacity) = input.capacities.get(&cpu) else {
            continue;
        };
        if capacity as f64 >= performance_floor {
            performance_cpus.push(cpu);
        } else {
            efficiency_cpus.push(cpu);
        }
    }
    if efficiency_cpus.is_empty() {
        return None;
    }
    Some(ClusterMap {
        performance_cpus,
        efficiency_cpus,
    })
}

#[cfg(test)]
mod tests;
