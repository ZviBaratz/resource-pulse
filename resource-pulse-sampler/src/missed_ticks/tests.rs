use super::MissedTickCounter;

/// One second in microseconds.
const SECOND_USEC: u64 = 1_000_000;
/// The sampler's interval.
const INTERVAL_USEC: u64 = 2 * SECOND_USEC;
/// Where the rows' grid starts: not 0, so a row cannot pass on times that happen to be offsets from
/// the clock's epoch.
const FIRST_TICK_AT_USEC: u64 = 5 * SECOND_USEC + 7;
/// One hour, the time a machine slept before the program started in the first-reading row.
const HOUR_USEC: u64 = 3_600 * SECOND_USEC;

/// The rows' two clocks: monotonic time, and the time suspended so far, which the boot clock adds
/// to it.
struct TwoClocks {
    counter: MissedTickCounter,
    monotonic_usec: u64,
    suspended_usec: u64,
}

impl TwoClocks {
    /// A counter on the rows' grid, its first tick now, after `suspended_before_start_usec` of
    /// sleep before the program started.
    fn starting_after_sleep(suspended_before_start_usec: u64) -> Self {
        Self {
            counter: MissedTickCounter::new(FIRST_TICK_AT_USEC, INTERVAL_USEC),
            monotonic_usec: FIRST_TICK_AT_USEC,
            suspended_usec: suspended_before_start_usec,
        }
    }

    /// The boot clock now.
    fn boottime_usec(&self) -> u64 {
        self.monotonic_usec + self.suspended_usec
    }

    /// The count at a tick `after_usec` of monotonic time after the previous one, with a good read
    /// of the boot clock.
    fn tick_after(&mut self, after_usec: u64) -> u64 {
        self.monotonic_usec += after_usec;
        let boottime_usec = self.boottime_usec();
        self.counter
            .count_before_tick(self.monotonic_usec, Some(boottime_usec))
    }

    /// The count at a tick `after_usec` after the previous one, whose read of the boot clock
    /// failed.
    fn tick_after_with_failed_boot_read(&mut self, after_usec: u64) -> u64 {
        self.monotonic_usec += after_usec;
        self.counter.count_before_tick(self.monotonic_usec, None)
    }

    /// Suspends the machine for `usec`: the boot clock moves on, the monotonic clock does not.
    fn suspend(&mut self, usec: u64) {
        self.suspended_usec += usec;
    }
}

/// The first tick misses nothing, and ticks on time miss nothing.
#[test]
fn the_first_tick_and_ticks_on_time_miss_nothing() {
    let mut clocks = TwoClocks::starting_after_sleep(0);
    let counts: Vec<u64> = [0, INTERVAL_USEC, INTERVAL_USEC, INTERVAL_USEC]
        .iter()
        .map(|&after_usec| clocks.tick_after(after_usec))
        .collect();
    assert_eq!(counts, [0, 0, 0, 0]);
}

/// A tick 1.2 s late and the next one on time, at its own slot, miss nothing: the slots are exact,
/// so lateness is never read as a missed slot and then as none.
#[test]
fn a_late_tick_and_the_next_on_time_miss_nothing() {
    let mut clocks = TwoClocks::starting_after_sleep(0);
    let counts = [
        clocks.tick_after(0),
        clocks.tick_after(INTERVAL_USEC + 1_200_000),
        clocks.tick_after(INTERVAL_USEC - 1_200_000),
    ];
    assert_eq!(counts, [0, 0, 0]);
}

/// A 7 s stall at a 2 s interval: the tick after it, at the slot of 8 s, missed the three slots of
/// 2, 4 and 6 s.
#[test]
fn a_stall_misses_the_slots_it_skipped() {
    let mut clocks = TwoClocks::starting_after_sleep(0);
    clocks.tick_after(0);
    assert_eq!(clocks.tick_after(8 * SECOND_USEC + 300_000), 3);
}

/// Suspends of 1 s, 2 s and an hour between two ticks on time miss 0, 1 and 1800 ticks: the whole
/// intervals slept. The count is not capped here.
#[test]
fn a_suspend_misses_the_whole_intervals_it_slept() {
    let counts: Vec<u64> = [SECOND_USEC, 2 * SECOND_USEC, HOUR_USEC]
        .iter()
        .map(|&suspended_usec| {
            let mut clocks = TwoClocks::starting_after_sleep(0);
            clocks.tick_after(0);
            clocks.suspend(suspended_usec);
            clocks.tick_after(INTERVAL_USEC)
        })
        .collect();
    assert_eq!(counts, [0, 1, 1_800]);
}

/// A stall and a suspend between the same two ticks add: two slots skipped and 4 s slept miss four.
#[test]
fn a_stall_and_a_suspend_between_the_same_ticks_add() {
    let mut clocks = TwoClocks::starting_after_sleep(0);
    clocks.tick_after(0);
    clocks.suspend(4 * SECOND_USEC);
    assert_eq!(clocks.tick_after(3 * INTERVAL_USEC), 4);
}

/// Suspends shorter than an interval add up: five of 0.5 s, one between each pair of ticks, miss
/// one tick, at the tick where the total slept reaches 2 s; the remainder carries over.
#[test]
fn suspends_shorter_than_an_interval_add_up_across_ticks() {
    let mut clocks = TwoClocks::starting_after_sleep(0);
    clocks.tick_after(0);
    let counts: Vec<u64> = (0..5)
        .map(|_| {
            clocks.suspend(SECOND_USEC / 2);
            clocks.tick_after(INTERVAL_USEC)
        })
        .collect();
    assert_eq!(counts, [0, 0, 0, 1, 0]);
}

/// A failed read of the boot clock misses nothing: good, failed, good, with the machine awake
/// throughout, gives no gap at any of the three; the latest good reading is kept, not 0.
#[test]
fn a_failed_boot_clock_read_misses_nothing() {
    let mut clocks = TwoClocks::starting_after_sleep(HOUR_USEC);
    let counts = [
        clocks.tick_after(0),
        clocks.tick_after(INTERVAL_USEC),
        clocks.tick_after_with_failed_boot_read(INTERVAL_USEC),
        clocks.tick_after(INTERVAL_USEC),
    ];
    assert_eq!(counts, [0, 0, 0, 0]);
}

/// A suspend during a failed read is counted at the next good one.
#[test]
fn a_suspend_across_a_failed_boot_clock_read_is_counted_at_the_next_good_one() {
    let mut clocks = TwoClocks::starting_after_sleep(0);
    clocks.tick_after(0);
    clocks.suspend(6 * SECOND_USEC);
    let counts = [
        clocks.tick_after_with_failed_boot_read(INTERVAL_USEC),
        clocks.tick_after(INTERVAL_USEC),
    ];
    assert_eq!(counts, [0, 3]);
}

/// A program started with its boot clock hours ahead of its monotonic clock (the machine slept
/// before it started) misses nothing at its first ticks: suspends count from the first reading.
#[test]
fn sleep_before_the_program_started_misses_nothing() {
    let mut clocks = TwoClocks::starting_after_sleep(5 * HOUR_USEC + 1_300_000);
    let counts = [
        clocks.tick_after(0),
        clocks.tick_after(INTERVAL_USEC),
        clocks.tick_after(INTERVAL_USEC),
    ];
    assert_eq!(counts, [0, 0, 0]);
}

/// Without a grid nothing is ever missed, whatever the clocks do.
#[test]
fn a_counter_without_a_grid_misses_nothing() {
    let mut counter = MissedTickCounter::without_grid();
    let counts = [
        counter.count_before_tick(SECOND_USEC, Some(SECOND_USEC)),
        counter.count_before_tick(20 * SECOND_USEC, Some(HOUR_USEC)),
    ];
    assert_eq!(counts, [0, 0]);
}
