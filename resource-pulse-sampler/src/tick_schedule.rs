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
    let elapsed_usec = now_usec.saturating_sub(first_tick_at_usec);
    let Some(whole_intervals_passed) = elapsed_usec.checked_div(interval_usec) else {
        return now_usec;
    };
    let next_slot_number = whole_intervals_passed.saturating_add(1);
    first_tick_at_usec.saturating_add(next_slot_number.saturating_mul(interval_usec))
}

#[cfg(test)]
mod tests;
