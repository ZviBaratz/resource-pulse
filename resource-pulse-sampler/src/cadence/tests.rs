use super::*;
use crate::pressure::pressure_band;

const WATCHED_INTERVAL_TICKS_EXPECTED: f64 = 10.0;
const UNWATCHED_INTERVAL_TICKS_EXPECTED: f64 = 30.0;
const CALM_BANDS: [Option<f64>; 3] = [Some(0.0), Some(0.0), Some(0.0)];
const SETTLED_TICKS: f64 = 5.0;
const REVEAL_COOLDOWN: f64 = REVEAL_SCAN_COOLDOWN_TICKS as f64;
const BURST_COOLDOWN: f64 = BURST_COOLDOWN_TICKS as f64;

/// A state in which nothing is due: watched, mid-interval, steady load, settled cooldowns
/// (what the gjs sampler's `cadence.test.js` called `quietState`).
fn quiet_state() -> CadenceState {
    CadenceState {
        is_watched: true,
        watch_started_this_tick: false,
        ticks_since_last_scan: Some(3.0),
        warm_up_pending: false,
        ticks_since_triggered_scan: Some(SETTLED_TICKS),
        cpu_busy_percent_now: Some(40.0),
        cpu_busy_percent_at_last_scan: Some(40.0),
        pressure_bands_now: CALM_BANDS.to_vec(),
        pressure_bands_at_last_scan: CALM_BANDS.to_vec(),
    }
}

fn bands(values: [Option<f64>; 3]) -> Vec<Option<f64>> {
    values.to_vec()
}

#[test]
fn intervals_are_derived_from_the_seconds_constants() {
    assert_eq!(
        [WATCHED_INTERVAL_TICKS, UNWATCHED_INTERVAL_TICKS],
        [
            WATCHED_INTERVAL_TICKS_EXPECTED,
            UNWATCHED_INTERVAL_TICKS_EXPECTED
        ]
    );
}

#[test]
fn a_quiet_state_does_not_scan() {
    assert_eq!(decide_app_scan(&quiet_state()), None);
}

#[test]
fn with_no_scan_yet_scan_with_reason_first() {
    let state = CadenceState {
        ticks_since_last_scan: None,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::First));
}

#[test]
fn first_beats_watch_start() {
    let state = CadenceState {
        ticks_since_last_scan: None,
        watch_started_this_tick: true,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::First));
}

#[test]
fn watched_interval_scans_at_10_ticks() {
    let state = CadenceState {
        ticks_since_last_scan: Some(WATCHED_INTERVAL_TICKS_EXPECTED),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::Interval));
}

#[test]
fn watched_interval_does_not_scan_at_9_ticks() {
    let state = CadenceState {
        ticks_since_last_scan: Some(WATCHED_INTERVAL_TICKS_EXPECTED - 1.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn unwatched_interval_scans_at_30_ticks() {
    let state = CadenceState {
        is_watched: false,
        ticks_since_last_scan: Some(UNWATCHED_INTERVAL_TICKS_EXPECTED),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::Interval));
}

#[test]
fn unwatched_interval_does_not_scan_at_29_ticks() {
    let state = CadenceState {
        is_watched: false,
        ticks_since_last_scan: Some(UNWATCHED_INTERVAL_TICKS_EXPECTED - 1.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn unwatched_does_not_scan_at_the_watched_interval() {
    let state = CadenceState {
        is_watched: false,
        ticks_since_last_scan: Some(WATCHED_INTERVAL_TICKS_EXPECTED),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn a_watch_starting_scans_at_once() {
    let state = CadenceState {
        watch_started_this_tick: true,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WatchStart));
}

#[test]
fn a_watch_starting_with_no_triggered_scan_yet_scans() {
    let state = CadenceState {
        watch_started_this_tick: true,
        ticks_since_triggered_scan: None,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WatchStart));
}

#[test]
fn a_watch_starting_inside_the_reveal_cooldown_does_not_scan() {
    let state = CadenceState {
        watch_started_this_tick: true,
        ticks_since_triggered_scan: Some(REVEAL_COOLDOWN - 1.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn a_watch_starting_at_the_end_of_the_reveal_cooldown_scans() {
    let state = CadenceState {
        watch_started_this_tick: true,
        ticks_since_triggered_scan: Some(REVEAL_COOLDOWN),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WatchStart));
}

#[test]
fn a_pending_warm_up_scans_with_reason_warm_up() {
    let state = CadenceState {
        warm_up_pending: true,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WarmUp));
}

#[test]
fn a_pending_warm_up_scans_when_unwatched_too() {
    let state = CadenceState {
        warm_up_pending: true,
        is_watched: false,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WarmUp));
}

#[test]
fn watch_start_beats_warm_up() {
    let state = CadenceState {
        watch_started_this_tick: true,
        warm_up_pending: true,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WatchStart));
}

#[test]
fn a_watch_starting_inside_the_reveal_cooldown_with_a_warm_up_pending_falls_through_to_warm_up() {
    let state = CadenceState {
        watch_started_this_tick: true,
        warm_up_pending: true,
        ticks_since_triggered_scan: Some(REVEAL_COOLDOWN - 1.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WarmUp));
}

#[test]
fn warm_up_beats_burst() {
    let state = CadenceState {
        warm_up_pending: true,
        cpu_busy_percent_now: Some(90.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::WarmUp));
}

#[test]
fn burst_beats_interval() {
    let state = CadenceState {
        ticks_since_last_scan: Some(WATCHED_INTERVAL_TICKS_EXPECTED),
        cpu_busy_percent_now: Some(90.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::Burst));
}

#[test]
fn cpu_40_to_55_bursts_when_watched() {
    let state = CadenceState {
        cpu_busy_percent_at_last_scan: Some(40.0),
        cpu_busy_percent_now: Some(55.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::Burst));
}

#[test]
fn cpu_40_to_54_does_not_burst() {
    let state = CadenceState {
        cpu_busy_percent_at_last_scan: Some(40.0),
        cpu_busy_percent_now: Some(54.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn unwatched_never_bursts_on_cpu() {
    let state = CadenceState {
        is_watched: false,
        cpu_busy_percent_at_last_scan: Some(0.0),
        cpu_busy_percent_now: Some(100.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

///
/// The last-scan value is one that a missing value read as zero would turn into a huge rise.
#[test]
fn a_null_cpu_value_now_never_bursts() {
    let state = CadenceState {
        cpu_busy_percent_now: None,
        cpu_busy_percent_at_last_scan: Some(-100.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn a_null_cpu_value_at_the_last_scan_never_bursts() {
    let state = CadenceState {
        cpu_busy_percent_at_last_scan: None,
        cpu_busy_percent_now: Some(100.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn a_pressure_band_rising_1_to_2_bursts() {
    let state = CadenceState {
        pressure_bands_at_last_scan: bands([Some(0.0), Some(1.0), Some(0.0)]),
        pressure_bands_now: bands([Some(0.0), Some(2.0), Some(0.0)]),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::Burst));
}

#[test]
fn a_pressure_band_falling_does_not_burst() {
    let state = CadenceState {
        pressure_bands_at_last_scan: bands([Some(0.0), Some(2.0), Some(0.0)]),
        pressure_bands_now: bands([Some(0.0), Some(1.0), Some(0.0)]),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn a_pressure_band_staying_does_not_burst() {
    let steady = bands([Some(1.0), Some(1.0), Some(1.0)]);
    let state = CadenceState {
        pressure_bands_at_last_scan: steady.clone(),
        pressure_bands_now: steady,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

///
/// Band -1 at the last scan: a missing band read as zero would be above it.
#[test]
fn a_null_pressure_band_now_never_bursts() {
    let state = CadenceState {
        pressure_bands_at_last_scan: bands([Some(-1.0), Some(0.0), Some(0.0)]),
        pressure_bands_now: bands([None, Some(0.0), Some(0.0)]),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn a_null_pressure_band_at_the_last_scan_never_bursts() {
    let state = CadenceState {
        pressure_bands_at_last_scan: bands([None, Some(0.0), Some(0.0)]),
        pressure_bands_now: bands([Some(3.0), Some(0.0), Some(0.0)]),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn unwatched_never_bursts_on_pressure() {
    let state = CadenceState {
        is_watched: false,
        pressure_bands_at_last_scan: bands([Some(0.0), Some(0.0), Some(0.0)]),
        pressure_bands_now: bands([Some(0.0), Some(0.0), Some(3.0)]),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn no_burst_inside_the_burst_cooldown() {
    let state = CadenceState {
        cpu_busy_percent_now: Some(90.0),
        ticks_since_triggered_scan: Some(BURST_COOLDOWN - 1.0),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), None);
}

#[test]
fn a_burst_is_allowed_at_the_end_of_the_burst_cooldown() {
    let state = CadenceState {
        cpu_busy_percent_now: Some(90.0),
        ticks_since_triggered_scan: Some(BURST_COOLDOWN),
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::Burst));
}

#[test]
fn a_burst_is_allowed_with_no_triggered_scan_yet() {
    let state = CadenceState {
        cpu_busy_percent_now: Some(90.0),
        ticks_since_triggered_scan: None,
        ..quiet_state()
    };
    assert_eq!(decide_app_scan(&state), Some(ScanReason::Burst));
}

/// The reasons of the two reason rows, in their order, with the missing reason last.
const REASONS_AND_NONE: [Option<ScanReason>; 6] = [
    Some(ScanReason::First),
    Some(ScanReason::WatchStart),
    Some(ScanReason::Burst),
    Some(ScanReason::Interval),
    Some(ScanReason::WarmUp),
    None,
];

#[test]
fn arms_warm_up_is_true_for_first_watch_start_and_burst_only() {
    let armed: Vec<bool> = REASONS_AND_NONE.into_iter().map(arms_warm_up).collect();
    assert_eq!(armed, vec![true, true, true, false, false, false]);
}

#[test]
fn is_triggered_scan_is_true_for_watch_start_and_burst_only() {
    let triggered: Vec<bool> = REASONS_AND_NONE
        .into_iter()
        .map(is_triggered_scan)
        .collect();
    assert_eq!(triggered, vec![false, true, true, false, false, false]);
}

///
/// `pressureBandIndex` only returns `pressureBand`, so this is `pressure_band` itself.
#[test]
fn pressure_band_index_follows_the_band_thresholds_and_passes_no_data_through() {
    let inputs = [
        Some(0.0),
        Some(9.9),
        Some(10.0),
        Some(24.9),
        Some(25.0),
        Some(49.9),
        Some(50.0),
        Some(100.0),
        None,
    ];
    let bands: Vec<Option<u8>> = inputs.into_iter().map(pressure_band).collect();
    let expected = [0, 0, 1, 1, 2, 2, 3, 3].map(Some).into_iter().chain([None]);
    assert_eq!(bands, expected.collect::<Vec<_>>());
}

/// `decideAppScan` run under gjs on the states that are not ordinary numbers: a NaN counter
/// is not null and compares false, so no cooldown is out and no interval is due; a NaN or
/// equal-infinity CPU pair never bursts; an infinite rise does; bands are compared by index
/// over the current bands, a missing index on either side never bursts, a NaN band never does.
#[test]
fn states_with_values_that_are_not_ordinary_numbers_decide_as_gjs_does() {
    let cases: [(CadenceState, Option<ScanReason>); 11] = [
        (
            CadenceState {
                ticks_since_last_scan: Some(f64::NAN),
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                watch_started_this_tick: true,
                ticks_since_triggered_scan: Some(f64::NAN),
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                cpu_busy_percent_now: Some(90.0),
                ticks_since_triggered_scan: Some(f64::NAN),
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                cpu_busy_percent_now: Some(f64::NAN),
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                cpu_busy_percent_now: Some(f64::INFINITY),
                cpu_busy_percent_at_last_scan: Some(f64::INFINITY),
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                cpu_busy_percent_now: Some(f64::INFINITY),
                ..quiet_state()
            },
            Some(ScanReason::Burst),
        ),
        (
            CadenceState {
                pressure_bands_at_last_scan: vec![Some(0.0)],
                pressure_bands_now: bands([Some(0.0), Some(3.0), Some(3.0)]),
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                pressure_bands_at_last_scan: vec![Some(0.0); 4],
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                pressure_bands_now: vec![],
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                pressure_bands_now: bands([Some(f64::NAN), Some(0.0), Some(0.0)]),
                ..quiet_state()
            },
            None,
        ),
        (
            CadenceState {
                is_watched: false,
                ticks_since_last_scan: Some(f64::INFINITY),
                ..quiet_state()
            },
            Some(ScanReason::Interval),
        ),
    ];
    for (index, (state, expected)) in cases.iter().enumerate() {
        assert_eq!(decide_app_scan(state), *expected, "case {index}");
    }
}
