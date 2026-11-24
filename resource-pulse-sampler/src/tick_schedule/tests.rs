use super::next_tick_at_usec;

/// One second in microseconds.
const SECOND_USEC: u64 = 1_000_000;
/// The sampler's interval.
const INTERVAL_USEC: u64 = 2 * SECOND_USEC;

/// With a first tick at 0 and an interval of 2 s, the next tick is at 2 s when
/// asked at 0.1 s, at 4 s when asked at 2.0 s (a tick that just ran exactly on time), and at
/// 10 s when asked at 9.3 s, after a 7 s stall: one tick, not the three slots it missed.
#[test]
fn ticks_do_not_drift_and_a_missed_tick_is_skipped() {
    let next_ticks_usec: Vec<u64> = [SECOND_USEC / 10, 2 * SECOND_USEC, 9_300_000]
        .iter()
        .map(|&now_usec| next_tick_at_usec(0, INTERVAL_USEC, now_usec))
        .collect();
    assert_eq!(
        next_ticks_usec,
        [2 * SECOND_USEC, 4 * SECOND_USEC, 10 * SECOND_USEC]
    );
}

/// The grid is the first tick's, wherever it falls: a tick that ran 0.3 s late does not move the
/// next one later.
#[test]
fn a_late_tick_keeps_the_grid_of_the_first_tick() {
    let first_tick_at_usec = 5 * SECOND_USEC + 7;
    let next_after_late_tick = next_tick_at_usec(
        first_tick_at_usec,
        INTERVAL_USEC,
        first_tick_at_usec + 2_300_000,
    );
    assert_eq!(next_after_late_tick, first_tick_at_usec + 2 * INTERVAL_USEC);
}

/// The edges: an interval of 0 ticks now, a time before the first tick gives the first slot,
/// and a grid past the end of the clock's range saturates instead of wrapping round to 0.
#[test]
fn a_zero_interval_ticks_now_and_the_grid_saturates_at_the_end_of_the_clock() {
    assert_eq!(
        [
            next_tick_at_usec(0, 0, 7 * SECOND_USEC),
            next_tick_at_usec(10 * SECOND_USEC, INTERVAL_USEC, 3 * SECOND_USEC),
            next_tick_at_usec(0, u64::MAX / 2 + 1, u64::MAX - 1),
        ],
        [7 * SECOND_USEC, 12 * SECOND_USEC, u64::MAX]
    );
}
