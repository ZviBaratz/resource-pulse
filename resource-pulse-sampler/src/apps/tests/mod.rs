//! The rows of app naming, ranking and the scan, including the rows that pin where JavaScript's
//! matching, string handling and ordering differ from Rust's. Expected values that are not
//! hand-derived are what the gjs sampler's `lib/apps.js` answered when run under gjs, before its
//! deletion; these rows hold them now.
//!
//! This file holds the ranking rows' scan builders, which the rows share; `described_leaves.rs`
//! holds the naming tables' data, and each other submodule holds one area's rows and the helpers
//! only they use.

mod attribution;
mod described_leaves;
mod js_number_parity;
mod js_patterns;
mod js_string_order;
mod naming;
mod ranking;
mod ranking_edges;

use super::*;

const GIB: u64 = 1024 * 1024 * 1024;
const ELAPSED_USEC: i64 = 2_000_000;
const CPU_COUNT: u64 = 8;
/// Microseconds of CPU the whole machine has in one scan: 2 s on 8 CPUs.
const MACHINE_CAPACITY_USEC: f64 = 16_000_000.0;
/// 2^53: the first integer a double cannot add 1 to.
const TWO_TO_THE_53: u64 = 9_007_199_254_740_992;

/// One leaf of a ranking input: (path, `usage_usec` last scan, `usage_usec` now, memory bytes).
type LeafSpec = (&'static str, Option<u64>, u64, Option<u64>);

/// What the gjs rows' `input` gives `nameOfCgroup`: each cgroup is named after itself up to a `#`.
fn name_after_itself_up_to_hash(cgroup_path: &str) -> AppGroup {
    let name = cgroup_path.split('#').next().unwrap_or_default();
    AppGroup {
        group_key: name.to_string(),
        name: name.to_string(),
    }
}

/// The gjs rows' `input(spec)`: a scan of the leaves, 2 s long on 8 CPUs, with no root delta.
fn scan_of(leaves: &[LeafSpec]) -> RankingScan {
    let mut scan = RankingScan {
        elapsed_usec: ELAPSED_USEC,
        cpu_count: CPU_COUNT,
        ..RankingScan::default()
    };
    for (path, previous, current, memory) in leaves {
        if let Some(previous_usec) = previous {
            scan.previous_usage_usec.insert(path, *previous_usec);
        }
        scan.current_usage_usec.insert(path, *current);
        if let Some(memory_bytes) = memory {
            scan.memory_bytes_by_cgroup
                .insert(path, *memory_bytes as f64);
        }
    }
    scan
}

/// The gjs rows' `parents(spec, parentDeltas, listedPreviously)` applied to `scan`.
fn with_parents(
    scan: RankingScan,
    parent_of: &[(&str, &str)],
    parent_deltas: &[(&str, f64)],
    listed_previously: &[&str],
) -> RankingScan {
    let mut parent_cpu_delta_usec = InsertionOrderedMap::new();
    for (parent_path, delta_usec) in parent_deltas {
        parent_cpu_delta_usec.insert(parent_path, *delta_usec);
    }
    RankingScan {
        parent_of_leaf: parent_of
            .iter()
            .map(|(leaf, parent)| (leaf.to_string(), parent.to_string()))
            .collect(),
        parents_listed_previously: listed_previously
            .iter()
            .map(|parent| parent.to_string())
            .collect(),
        parent_cpu_delta_usec,
        ..scan
    }
}

/// `scan` with a root CPU delta.
fn with_root_delta(scan: RankingScan, root_cpu_delta_usec: f64) -> RankingScan {
    RankingScan {
        root_cpu_delta_usec: Some(root_cpu_delta_usec),
        ..scan
    }
}

/// Ranks `scan`, naming every cgroup after itself up to a `#`.
fn rank(scan: &RankingScan) -> AppRanking {
    rank_apps(scan, &mut name_after_itself_up_to_hash)
}

/// A CPU ranking entry whose group key is its name.
fn cpu_entry(name: &str, cpu_percent: f64) -> CpuRankEntry {
    CpuRankEntry {
        group_key: name.to_string(),
        name: name.to_string(),
        cpu_percent,
    }
}

/// A memory ranking entry whose group key is its name.
fn memory_entry(name: &str, memory_bytes: f64) -> MemoryRankEntry {
    MemoryRankEntry {
        group_key: name.to_string(),
        name: name.to_string(),
        memory_bytes,
    }
}

/// The names of the CPU ranking, in order.
fn cpu_ranking_names(ranking: &AppRanking) -> Vec<&str> {
    ranking
        .cpu_ranking
        .iter()
        .map(|entry| entry.name.as_str())
        .collect()
}

/// The name of the CPU ranking's winner; fails the test when there is none.
fn top_cpu_name(ranking: &AppRanking) -> &str {
    &ranking.top_cpu.as_ref().expect("a CPU winner").name
}

/// The name of the memory ranking's winner; fails the test when there is none.
fn top_memory_name(ranking: &AppRanking) -> &str {
    &ranking.top_memory.as_ref().expect("a memory winner").name
}

/// A group of the pseudo kind (kernel or short jobs) whose key is not its name.
fn pseudo_cpu_entry(group_key: &str, name: &str, cpu_percent: f64) -> CpuRankEntry {
    CpuRankEntry {
        group_key: group_key.to_string(),
        name: name.to_string(),
        cpu_percent,
    }
}
