//! When the next tick is due: on a fixed grid of whole intervals from the first tick, against the
//! monotonic clock, so ticks do not drift; and a tick missed while the program was stalled or frozen
//! is skipped, never replayed, as GLib's timer (which the gjs sampler ran on) never catches up.

/// The first tick time after `now_usec` on the grid `first_tick_at_usec + k × interval_usec`
/// (k ≥ 1): the first whole interval after now. A tick that runs late is followed by the next slot
/// of the grid, not by a slot one interval after it, so ticks do not drift; and every slot that
/// passed during a stall is skipped, so a 7 s stall at a 2 s interval is followed by one tick, not
/// three.
///
/// Parameters
/// ----------
/// first_tick_at_usec
///     Monotonic time of the first tick, the origin of the grid.
/// interval_usec
///     The interval between ticks. The program never passes 0 (`--tick-interval-ms` refuses it);
///     were it 0, there would be no grid, and the answer is `now_usec`: tick now.
/// now_usec
///     Monotonic time now. The monotonic clock never goes back, so it is never before the first
///     tick; were it, the answer is the first slot after the first tick.
pub fn next_tick_at_usec(first_tick_at_usec: u64, interval_usec: u64, now_usec: u64) -> u64 {
    let Some(slot_number) = slot_number_at(first_tick_at_usec, interval_usec, now_usec) else {
        return now_usec;
    };
    let next_slot_number = slot_number.saturating_add(1);
    first_tick_at_usec.saturating_add(next_slot_number.saturating_mul(interval_usec))
}

/// The number of the grid's slot that `now_usec` falls in: the whole intervals passed since the
/// first tick, whose own slot is 0. A tick runs at its slot's time or later within it, so a late
/// tick keeps its slot's number; [`next_tick_at_usec`] schedules from the same number, so the two
/// cannot disagree.
///
/// Parameters
/// ----------
/// first_tick_at_usec
///     Monotonic time of the first tick, the origin of the grid.
/// interval_usec
///     The interval between ticks; 0 is no grid, and the answer is `None`.
/// now_usec
///     Monotonic time now; a time before the first tick is in slot 0.
pub fn slot_number_at(first_tick_at_usec: u64, interval_usec: u64, now_usec: u64) -> Option<u64> {
    now_usec
        .saturating_sub(first_tick_at_usec)
        .checked_div(interval_usec)
}

#[cfg(test)]
mod tests;
