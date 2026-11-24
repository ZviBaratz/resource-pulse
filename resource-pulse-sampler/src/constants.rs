//! The sampler's constants, in two groups.
//!
//! The first group is what both languages hold: each is named as `lib/constants.js` or
//! `lib/protocol.js` names it, `--print-constants` prints it, and the state table's
//! `sampler-constants.js` rows compare each one with the JavaScript, so neither side can change one
//! alone. The second group is the sampler's own: no JavaScript reads them, so they are neither
//! printed nor compared, and this module is their only definition.

// What both languages hold.

/// Seconds between CPU, memory and pressure samples.
pub const SAMPLE_INTERVAL_SECONDS: u64 = 2;
/// Seconds between per-app scans while a detail watch is held.
pub const APP_SCAN_INTERVAL_SECONDS: u64 = 20;
/// Samples kept for the card's history.
pub const CARD_HISTORY_SAMPLES: u64 = 150;
/// Pressure percentages at which the meter's bands change.
pub const PRESSURE_BAND_THRESHOLDS_PERCENT: [u64; 3] = [10, 25, 50];
/// Microseconds before a repeated error is logged again.
pub const ERROR_LOG_REPEAT_INTERVAL_USEC: u64 = 600_000_000;
/// Prefix of every line the service logs.
pub const LOG_PREFIX: &str = "resource-pulse:";

/// Version of the D-Bus protocol the Sample and GetState payloads follow.
pub const PROTOCOL_VERSION: u64 = 1;
/// The service's well-known bus name.
pub const RESOURCE_PULSE_BUS_NAME: &str = "io.github.zvibaratz.ResourcePulse1";
/// The service's interface name (the same as its bus name).
pub const RESOURCE_PULSE_INTERFACE_NAME: &str = RESOURCE_PULSE_BUS_NAME;
/// The service's object path.
pub const RESOURCE_PULSE_OBJECT_PATH: &str = "/io/github/zvibaratz/ResourcePulse1";
/// Method that returns the whole state.
pub const GET_STATE_METHOD_NAME: &str = "GetState";
/// Method that starts a detail watch.
pub const WATCH_DETAIL_METHOD_NAME: &str = "WatchDetail";
/// Method that ends a detail watch.
pub const UNWATCH_DETAIL_METHOD_NAME: &str = "UnwatchDetail";
/// Signal that carries each sample.
pub const SAMPLE_SIGNAL_NAME: &str = "Sample";

// The sampler's own.

/// Seconds between per-app scans with no detail watch held: a baseline, so a reveal never starts
/// from nothing.
pub const APP_SCAN_UNWATCHED_INTERVAL_SECONDS: u64 = 60;
/// Percentage points CPU busy must rise above its value at the last scan to set off a burst scan.
pub const BURST_CPU_RISE_POINTS: u64 = 15;
/// Ticks after a watch-start or burst scan during which no burst scan may start.
pub const BURST_COOLDOWN_TICKS: u64 = 2;
/// Ticks after a watch-start or burst scan during which a watch starting does not scan at once.
pub const REVEAL_SCAN_COOLDOWN_TICKS: u64 = 2;
/// Shortest window, in seconds, a CPU ranking may cover. Over less, a scan ranks noise: a watch
/// start that soon after the last scan does not scan (the client already has that ranking), and a
/// warm-up due that soon waits a tick.
pub const MIN_CPU_RANKING_WINDOW_SECONDS: u64 = 1;
/// Unit suffixes of the cgroup leaves the app scan leaves out. Such units (mounts, sockets, swap,
/// automounts, paths, timers, devices) never host an app process, and skipping them is the scan's
/// main cost lever: on a typical laptop they were 64 of 171 leaves.
pub const APP_SCAN_SKIPPED_UNIT_SUFFIXES: [&str; 7] = [
    ".mount",
    ".socket",
    ".swap",
    ".automount",
    ".path",
    ".timer",
    ".device",
];
/// `memory.current` above which an app scan also reads a cgroup's `memory.stat` to subtract its
/// page cache (64 MiB). A leaf at or under it ranks by `memory.current` as it is: too small to top
/// the ranking, so not worth a third read.
pub const APP_MEMORY_STAT_MIN_BYTES: u64 = 64 * 1024 * 1024;
/// A CPU whose capacity is at least this fraction of the maximum is a performance core.
pub const PERFORMANCE_CAPACITY_RATIO: f64 = 0.9;
/// Name of the CPU-only pseudo-entry for the root cgroup's CPU no scanned parent slice accounts
/// for.
pub const KERNEL_LABEL: &str = "kernel";
/// Name of the CPU-only pseudo-entry for units that started and ended between two scans.
pub const SHORT_JOBS_LABEL: &str = "short jobs";
/// Display names for service units whose own name reads badly, as (unit name without its suffix,
/// display name).
pub const UNIT_DISPLAY_ALIASES: [(&str, &str); 2] = [
    ("herdr-server", "herdr agents"),
    ("org.gnome.Shell", "GNOME Shell"),
];
/// Most apps the sampler publishes in each app ranking (by CPU, by memory). The cockpit's apps card draws
/// the first `APPS_CARD_ROW_LIMIT` of each (`lib/constants.js`).
pub const APP_RANKING_LENGTH: u64 = 10;

/// Renders a list of numbers as compact JSON.
fn json_number_list(numbers: &[u64]) -> String {
    let rendered: Vec<String> = numbers.iter().map(u64::to_string).collect();
    format!("[{}]", rendered.join(","))
}

/// One `NAME=value` line per constant both languages hold, for `--print-constants`: a scalar and a
/// string as they are, a list as compact JSON.
pub fn constant_lines() -> Vec<String> {
    vec![
        format!("SAMPLE_INTERVAL_SECONDS={SAMPLE_INTERVAL_SECONDS}"),
        format!("APP_SCAN_INTERVAL_SECONDS={APP_SCAN_INTERVAL_SECONDS}"),
        format!("CARD_HISTORY_SAMPLES={CARD_HISTORY_SAMPLES}"),
        format!(
            "PRESSURE_BAND_THRESHOLDS_PERCENT={}",
            json_number_list(&PRESSURE_BAND_THRESHOLDS_PERCENT)
        ),
        format!("ERROR_LOG_REPEAT_INTERVAL_USEC={ERROR_LOG_REPEAT_INTERVAL_USEC}"),
        format!("LOG_PREFIX={LOG_PREFIX}"),
        format!("PROTOCOL_VERSION={PROTOCOL_VERSION}"),
        format!("RESOURCE_PULSE_BUS_NAME={RESOURCE_PULSE_BUS_NAME}"),
        format!("RESOURCE_PULSE_INTERFACE_NAME={RESOURCE_PULSE_INTERFACE_NAME}"),
        format!("RESOURCE_PULSE_OBJECT_PATH={RESOURCE_PULSE_OBJECT_PATH}"),
        format!("GET_STATE_METHOD_NAME={GET_STATE_METHOD_NAME}"),
        format!("WATCH_DETAIL_METHOD_NAME={WATCH_DETAIL_METHOD_NAME}"),
        format!("UNWATCH_DETAIL_METHOD_NAME={UNWATCH_DETAIL_METHOD_NAME}"),
        format!("SAMPLE_SIGNAL_NAME={SAMPLE_SIGNAL_NAME}"),
    ]
}

#[cfg(test)]
mod tests;
