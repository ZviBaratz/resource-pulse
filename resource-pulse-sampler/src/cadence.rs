//! When the service scans the cgroup tree, as the gjs sampler did. A JavaScript name in
//! parentheses is the gjs sampler's name for the same function.

use crate::constants::{
    APP_SCAN_INTERVAL_SECONDS, APP_SCAN_UNWATCHED_INTERVAL_SECONDS, BURST_COOLDOWN_TICKS,
    BURST_CPU_RISE_POINTS, REVEAL_SCAN_COOLDOWN_TICKS, SAMPLE_INTERVAL_SECONDS,
};

/// Ticks between scans while a detail watch is held. Divided in `f64`, as `cadence.js` did, so
/// an inexact division of two constants compares exactly as it did there.
const WATCHED_INTERVAL_TICKS: f64 =
    APP_SCAN_INTERVAL_SECONDS as f64 / SAMPLE_INTERVAL_SECONDS as f64;
/// Ticks between scans while no detail watch is held.
const UNWATCHED_INTERVAL_TICKS: f64 =
    APP_SCAN_UNWATCHED_INTERVAL_SECONDS as f64 / SAMPLE_INTERVAL_SECONDS as f64;

/// Why a scan ran: `decideAppScan`'s `reason` strings, `'first'`, `'interval'`, `'burst'`,
/// `'watch-start'` and `'warm-up'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanReason {
    First,
    Interval,
    Burst,
    WatchStart,
    WarmUp,
}

/// What `decideAppScan` reads. A `None` is the JavaScript `null`: never scanned, or no data.
#[derive(Debug, Clone, PartialEq)]
pub struct CadenceState {
    pub is_watched: bool,
    pub watch_started_this_tick: bool,
    pub ticks_since_last_scan: Option<f64>,
    pub warm_up_pending: bool,
    pub ticks_since_triggered_scan: Option<f64>,
    pub cpu_busy_percent_now: Option<f64>,
    pub cpu_busy_percent_at_last_scan: Option<f64>,
    pub pressure_bands_now: Vec<Option<f64>>,
    pub pressure_bands_at_last_scan: Vec<Option<f64>>,
}

/// Whether a cooldown measured in ticks since the last triggered scan has run out
/// (`hasCooledDown`). No triggered scan ever, `None`, is a cooldown that has run out; a NaN
/// count is not `None` and compares false, so it has not.
fn has_cooled_down(ticks_since_triggered_scan: Option<f64>, cooldown_ticks: u64) -> bool {
    ticks_since_triggered_scan.is_none_or(|ticks| ticks >= cooldown_ticks as f64)
}

/// Whether CPU busy rose by the burst threshold since the last scan (`hasCpuBurst`). No data on
/// either side never bursts.
fn has_cpu_burst(state: &CadenceState) -> bool {
    match (
        state.cpu_busy_percent_now,
        state.cpu_busy_percent_at_last_scan,
    ) {
        (Some(now), Some(at_last_scan)) => now - at_last_scan >= BURST_CPU_RISE_POINTS as f64,
        _ => false,
    }
}

/// Whether any pressure meter's band rose since the last scan (`hasPressureBurst`). The bands
/// are paired by index over the current bands; a band with no data on either side, or none at
/// that index at the last scan, never bursts.
fn has_pressure_burst(state: &CadenceState) -> bool {
    state
        .pressure_bands_now
        .iter()
        .enumerate()
        .any(
            |(index, band_now)| match (band_now, state.pressure_bands_at_last_scan.get(index)) {
                (Some(now), Some(Some(at_last_scan))) => now > at_last_scan,
                _ => false,
            },
        )
}

/// Whether a burst may start a scan now (`burstAllowed`): a detail watch is held and no
/// triggered scan is recent enough to hold the burst cooldown.
fn is_burst_allowed(state: &CadenceState) -> bool {
    state.is_watched && has_cooled_down(state.ticks_since_triggered_scan, BURST_COOLDOWN_TICKS)
}

/// Decides whether the app scan runs now (`decideAppScan`), returning the first reason that
/// applies, in this order: first, watch-start, warm-up, burst, interval. `None` is no scan.
///
/// Parameters
/// ----------
/// state
///     What the decision reads. The caller keeps the counters and applies [`arms_warm_up`] and
///     [`is_triggered_scan`] to the reason of each scan it runs.
///
/// Returns
/// -------
/// The reason to scan, or `None` for no scan.
pub fn decide_app_scan(state: &CadenceState) -> Option<ScanReason> {
    let Some(ticks_since_last_scan) = state.ticks_since_last_scan else {
        return Some(ScanReason::First);
    };
    if state.watch_started_this_tick
        && has_cooled_down(state.ticks_since_triggered_scan, REVEAL_SCAN_COOLDOWN_TICKS)
    {
        return Some(ScanReason::WatchStart);
    }
    if state.warm_up_pending {
        return Some(ScanReason::WarmUp);
    }
    if is_burst_allowed(state) && (has_cpu_burst(state) || has_pressure_burst(state)) {
        return Some(ScanReason::Burst);
    }
    let interval_ticks = if state.is_watched {
        WATCHED_INTERVAL_TICKS
    } else {
        UNWATCHED_INTERVAL_TICKS
    };
    (ticks_since_last_scan >= interval_ticks).then_some(ScanReason::Interval)
}

/// Whether a scan of this reason arms a warm-up scan for the next tick (`armsWarmUp`).
///
/// Parameters
/// ----------
/// reason
///     The reason the scan ran, or `None` for no reason.
///
/// Returns
/// -------
/// `true` for first, watch-start and burst; `false` for interval, warm-up and no reason.
pub fn arms_warm_up(reason: Option<ScanReason>) -> bool {
    matches!(
        reason,
        Some(ScanReason::First | ScanReason::WatchStart | ScanReason::Burst)
    )
}

/// Whether a scan of this reason counts toward the watch-start and burst cooldowns
/// (`isTriggeredScan`).
///
/// Parameters
/// ----------
/// reason
///     The reason the scan ran, or `None` for no reason.
///
/// Returns
/// -------
/// `true` for watch-start and burst.
pub fn is_triggered_scan(reason: Option<ScanReason>) -> bool {
    matches!(reason, Some(ScanReason::WatchStart | ScanReason::Burst))
}

#[cfg(test)]
mod tests;
