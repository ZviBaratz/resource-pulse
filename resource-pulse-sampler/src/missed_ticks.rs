//! How many ticks were due and did not run before each tick: the slots of the tick grid a stall
//! skipped, and the whole intervals the machine spent suspended. The sampler writes a gap into
//! every history for each, so the histories count time, not ticks.
//!
//! Two clocks, because neither sees both: `CLOCK_MONOTONIC`, the tick grid's clock, keeps running
//! through a stall but stops while the machine is suspended; `CLOCK_BOOTTIME` is the same clock
//! plus the time spent suspended, so their difference at a tick is how long the machine has slept.
//! The stall is counted in slots of the grid, which are exact, so a tick that runs late and the
//! next one on time are never read as a missed slot. Only the suspend is measured.

use crate::tick_schedule::slot_number_at;

/// Counts the ticks missed before each tick of one tick grid. Fed once per tick, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissedTickCounter {
    /// Monotonic time of the first tick, the origin of the grid.
    first_tick_at_usec: u64,
    /// The interval between ticks; 0 is no grid, and nothing is ever counted as missed.
    interval_usec: u64,
    /// The slot of the latest tick counted; `None` before the first.
    previous_slot_number: Option<u64>,
    /// The time suspended at the first good reading of the boot clock, from which the suspends are
    /// counted, so that what the machine slept before the program started adds nothing; `None`
    /// before a good reading.
    suspended_at_first_reading_usec: Option<u64>,
    /// The time suspended since the first good reading, as of the latest good reading: a failed
    /// read keeps it, so a failure misses nothing.
    suspended_since_first_reading_usec: u64,
    /// The most whole intervals in `suspended_since_first_reading_usec` at any tick so far, all of
    /// them counted, so that a remainder carries over to the next suspend rather than being lost.
    /// Never lowered: the two clocks are read one after the other, so the time suspended jitters
    /// by a microsecond or more, and a reading that dips below a whole interval and comes back
    /// must not count the same interval again.
    counted_whole_suspended_intervals: u64,
}

impl MissedTickCounter {
    /// A counter for the grid of `interval_usec` that starts at `first_tick_at_usec`: the same
    /// origin the tick schedule ([`crate::tick_schedule::next_tick_at_usec`]) is given.
    pub fn new(first_tick_at_usec: u64, interval_usec: u64) -> Self {
        Self {
            first_tick_at_usec,
            interval_usec,
            previous_slot_number: None,
            suspended_at_first_reading_usec: None,
            suspended_since_first_reading_usec: 0,
            counted_whole_suspended_intervals: 0,
        }
    }

    /// A counter that never counts a tick as missed: no grid. A service that the tick loop has not
    /// started has one, as the rows that tick a service by hand do.
    pub fn without_grid() -> Self {
        Self::new(0, 0)
    }

    /// The ticks missed before the tick that runs now: the slots skipped since the previous tick,
    /// plus the whole intervals the machine was suspended since then. The first tick misses
    /// nothing. Never capped here: the sampler caps what it writes at its history's length.
    ///
    /// Parameters
    /// ----------
    /// monotonic_usec
    ///     `CLOCK_MONOTONIC` now, in microseconds.
    /// boottime_usec
    ///     `CLOCK_BOOTTIME` now, read just after `monotonic_usec`; `None` when the read failed,
    ///     which keeps the latest good reading, so a failure misses nothing at this tick or the
    ///     next.
    pub fn count_before_tick(&mut self, monotonic_usec: u64, boottime_usec: Option<u64>) -> u64 {
        if let Some(boottime_usec) = boottime_usec {
            self.take_boot_clock_reading(monotonic_usec, boottime_usec);
        }
        let whole_suspended_intervals = self
            .suspended_since_first_reading_usec
            .checked_div(self.interval_usec)
            .unwrap_or(0);
        let suspended_tick_count =
            whole_suspended_intervals.saturating_sub(self.counted_whole_suspended_intervals);
        self.counted_whole_suspended_intervals = self
            .counted_whole_suspended_intervals
            .max(whole_suspended_intervals);
        let slot_number =
            slot_number_at(self.first_tick_at_usec, self.interval_usec, monotonic_usec)
                .unwrap_or(0);
        let skipped_slot_count = self.previous_slot_number.map_or(0, |previous_slot_number| {
            slot_number
                .saturating_sub(previous_slot_number)
                .saturating_sub(1)
        });
        let is_first_tick = self.previous_slot_number.is_none();
        self.previous_slot_number = Some(slot_number);
        if is_first_tick {
            return 0;
        }
        skipped_slot_count.saturating_add(suspended_tick_count)
    }

    /// Takes a good reading of the boot clock: the time suspended now (boot clock less monotonic),
    /// counted from the first good reading.
    fn take_boot_clock_reading(&mut self, monotonic_usec: u64, boottime_usec: u64) {
        let suspended_usec = boottime_usec.saturating_sub(monotonic_usec);
        let suspended_at_first_reading_usec = *self
            .suspended_at_first_reading_usec
            .get_or_insert(suspended_usec);
        self.suspended_since_first_reading_usec =
            suspended_usec.saturating_sub(suspended_at_first_reading_usec);
    }
}

#[cfg(test)]
mod tests;
