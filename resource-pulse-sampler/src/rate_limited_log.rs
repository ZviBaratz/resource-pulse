//! Journal lines for failures, at most one per [`ERROR_LOG_REPEAT_INTERVAL_USEC`] for each template
//! key, matching `lib/errorLog.js`'s `RateLimitedLogger`.

use std::collections::HashMap;

use crate::caught_panic::value_or_none;
use crate::constants::{ERROR_LOG_REPEAT_INTERVAL_USEC, LOG_PREFIX};
use crate::ports::Clock;

/// Writes each message at most once per [`ERROR_LOG_REPEAT_INTERVAL_USEC`] for its template key,
/// prefixed with [`LOG_PREFIX`] and a space. A first line and a line written again once the interval
/// has passed read the same: the message, with no count of the lines held back.
pub struct RateLimitedLog {
    /// Where a line goes (the journal, in the program).
    write: Box<dyn FnMut(&str)>,
    /// When each template key was last written, on the clock handed to [`RateLimitedLog::log`].
    last_logged_usec_by_template_key: HashMap<String, u64>,
}

impl RateLimitedLog {
    /// A log that has written nothing yet.
    pub fn new(write: Box<dyn FnMut(&str)>) -> RateLimitedLog {
        RateLimitedLog {
            write,
            last_logged_usec_by_template_key: HashMap::new(),
        }
    }

    /// Writes `message`, unless a message with the same template key was written less than
    /// [`ERROR_LOG_REPEAT_INTERVAL_USEC`] ago. Keys old enough to write again are forgotten first,
    /// so the table stays small.
    ///
    /// Never panics. A clock that panics loses the line: without a time it can be neither limited
    /// nor recorded. A writer that panics loses the line too, and the key counts as written, as in
    /// gjs, where the key is recorded before the write: there is nowhere left to report that
    /// failure, and the sampler must go on.
    ///
    /// Parameters
    /// ----------
    /// clock
    ///     Monotonic microseconds, read once per call (the sampler's own clock, as in gjs).
    /// message
    ///     The line, without the prefix.
    /// template_key
    ///     A stable name for a message whose text varies; a caller with none passes the message.
    pub fn log(&mut self, clock: &dyn Clock, message: &str, template_key: &str) {
        let Some(now_usec) = value_or_none(|| clock.monotonic_usec()) else {
            return;
        };
        let last_logged_usec = self.last_logged_usec_by_template_key.get(template_key);
        if last_logged_usec
            .is_some_and(|&logged_at_usec| !is_interval_over(now_usec, logged_at_usec))
        {
            return;
        }
        self.last_logged_usec_by_template_key
            .retain(|_, logged_at_usec| !is_interval_over(now_usec, *logged_at_usec));
        self.last_logged_usec_by_template_key
            .insert(template_key.to_string(), now_usec);
        let line = format!("{LOG_PREFIX} {message}");
        let write = &mut self.write;
        // A writer's panic is dropped here, and only here: see the doc comment.
        let _ = value_or_none(|| write(&line));
    }
}

/// `nowUsec - loggedAtUsec >= ERROR_LOG_REPEAT_INTERVAL_USEC`: whether the interval has run out since
/// a line was written. A clock that went backwards gives a negative difference in gjs, which is not
/// past the interval; `checked_sub` gives `None` there, which is not either, and never underflows.
fn is_interval_over(now_usec: u64, logged_at_usec: u64) -> bool {
    now_usec
        .checked_sub(logged_at_usec)
        .is_some_and(|elapsed_usec| elapsed_usec >= ERROR_LOG_REPEAT_INTERVAL_USEC)
}

#[cfg(test)]
mod tests;
