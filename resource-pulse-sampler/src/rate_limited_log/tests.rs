use std::cell::{Cell, RefCell};
use std::rc::Rc;

use super::*;
use crate::caught_panic::install_panic_hook;
use crate::test_support::SettableClock;

/// A clock that panics, as a broken port might.
struct PanickingClock;

impl Clock for PanickingClock {
    /// Panics, as a broken clock port might.
    fn monotonic_usec(&self) -> u64 {
        panic!("clock exploded")
    }

    /// Never asked for by the log.
    fn clock_label(&self) -> Result<String, String> {
        Err("unused".to_string())
    }
}

/// A log whose lines land in the returned list.
fn recording_log() -> (RateLimitedLog, Rc<RefCell<Vec<String>>>) {
    let written = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&written);
    let log = RateLimitedLog::new(Box::new(move |line| {
        sink.borrow_mut().push(line.to_string())
    }));
    (log, written)
}

/// The gjs logger's rule over one sequence of (clock, message, key), the key `None` for the
/// message itself. Expected values: `RateLimitedLogger` run under gjs over the same sequence:
/// the first line, nothing inside the interval, the
/// line again at exactly the interval, a key per template, nothing while the clock is behind
/// the last line, and a key forgotten once its interval passed, which a clock gone back then
/// writes again.
#[test]
fn each_template_key_writes_once_per_interval_and_keys_past_it_are_forgotten() {
    let steps: [(u64, &str, Option<&str>, Option<&str>); 13] = [
        (0, "a", None, Some("resource-pulse: a")),
        (1, "a", None, None),
        (1, "b 1", Some("b"), Some("resource-pulse: b 1")),
        (2, "b 2", Some("b"), None),
        (599_999_999, "a", None, None),
        (600_000_000, "a", None, Some("resource-pulse: a")),
        (600_000_001, "b 3", Some("b"), Some("resource-pulse: b 3")),
        (600_000_000, "a", None, None),
        (5, "a", None, None),
        (0, "x", None, Some("resource-pulse: x")),
        (700_000_000, "y", None, Some("resource-pulse: y")),
        (1, "x", None, Some("resource-pulse: x")),
        (1, "y", None, None),
    ];
    let clock = SettableClock::with_fixed_label(Rc::new(Cell::new(0)));
    let (mut log, written) = recording_log();
    for (now_usec, message, template_key, expected_line) in steps {
        clock.set(now_usec);
        let lines_before = written.borrow().len();
        log.log(&clock, message, template_key.unwrap_or(message));
        let new_line = written.borrow().get(lines_before).cloned();
        assert_eq!(
            new_line.as_deref(),
            expected_line,
            "at {now_usec} µs, {message}"
        );
    }
}

/// A clock that panics loses the line and records nothing; a writer that panics loses its line,
/// and its key counts as written. Neither panic leaves `log`.
#[test]
fn a_panicking_clock_or_writer_loses_the_line_and_does_not_panic() {
    install_panic_hook();
    let (mut log, written) = recording_log();
    log.log(&PanickingClock, "lost", "lost");
    let clock = SettableClock::with_fixed_label(Rc::new(Cell::new(0)));
    log.log(&clock, "lost", "lost");
    let mut panicking_log = RateLimitedLog::new(Box::new(|_| panic!("writer exploded")));
    panicking_log.log(&clock, "dropped", "dropped");
    let write_attempts = Rc::new(Cell::new(0));
    let attempts = Rc::clone(&write_attempts);
    panicking_log.write = Box::new(move |_| attempts.set(attempts.get() + 1));
    panicking_log.log(&clock, "dropped", "dropped");
    assert_eq!(*written.borrow(), vec!["resource-pulse: lost".to_string()]);
    assert_eq!(write_attempts.get(), 0);
}
