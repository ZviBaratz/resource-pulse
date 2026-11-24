//! The program's rows that need no bus: the tick loop on a clock the test sets, through an outlet
//! that records what it is handed; the watch calls through a bus the test fakes; the bus's own
//! outlet on a bus the test scripts (its events, its replies, the watchdog); and a real 1 s timer
//! through `--print`'s own outlet. Every sampler reads a fixture root under
//! `gnome-shell/tests/fixtures/`, never the host's `/proc`. Four rows were the gjs sampler's
//! timer rows, moved onto the tick loop, which is where the timer went:
//! `the_tick_loop_keeps_one_schedule_ends_when_stopped_and_runs_nothing_after`,
//! `the_first_tick_runs_at_once_with_memory_and_cpu_follows_one_interval_later`,
//! `a_panic_inside_a_tick_is_caught_logged_under_one_key_and_the_next_tick_publishes` and
//! `a_real_1_s_timer_sends_samples_and_none_for_1_5_s_after_it_is_stopped`.
//!
//! This file holds what the rows share; each submodule holds one area's rows and the helpers only
//! they use.

mod bus_loop;
mod endings;
mod faults;
mod log_priority;
mod real_timer;
mod tick_loop;
mod watch_calls;

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::Rc;

use crate::bus::IncomingCall;
use crate::constants::RESOURCE_PULSE_OBJECT_PATH;
use crate::log_line::LinePriority;
use crate::ports::{FileReader, WallClock};
use crate::program::calls::WatchBus;
use crate::real_ports::{FileSystemLister, FileSystemReader};
use crate::sampler::{ResolveAppName, Sampler, SamplerPorts};
use crate::test_support::{fixture_root, SettableClock};
use serde_json::Value;

use super::*;

/// One second in microseconds.
const SECOND_USEC: u64 = 1_000_000;
/// The sampler's interval, which the rows tick at on their clock.
const INTERVAL_USEC: u64 = 2 * SECOND_USEC;
/// Where the rows' monotonic clock starts: not 0, so a row cannot pass on times that happen to be
/// offsets from the epoch of the clock.
const MONOTONIC_START_USEC: u64 = 5 * SECOND_USEC;
/// The wall clock at the service's start, and the start of the rows' wall clock.
const SERVICE_STARTED_AT_USEC: u64 = 1_794_000_000_000_000;
/// The text a planted wall-clock panic carries.
const WALL_CLOCK_PANIC_MESSAGE: &str = "wall clock exploded";
/// This file, where [`TestWallClock`]'s planted panic is located.
const WALL_CLOCK_PANIC_FILE: &str = file!();
/// The callers the watch rows name.
const FIRST_CALLER: &str = ":1.7";
const SECOND_CALLER: &str = ":1.8";
const THIRD_CALLER: &str = ":1.9";
/// What a fake bus's follow and send say when they are made to fail.
const FOLLOW_FAILURE_TEXT: &str = "D-Bus: the daemon did not answer";
const SEND_FAILURE_TEXT: &str = "D-Bus: I/O error: Broken pipe (os error 32)";
/// How long after the last tick the watch rows call `WatchDetail`: past the 1 s CPU ranking window,
/// as the golden watch scenario does.
const WATCH_AFTER_LAST_TICK_USEC: u64 = 1_500_000;
/// What ends the path of a Rust source file.
const RUST_SOURCE_SUFFIX: &str = ".rs";

/// A wall clock the row sets, which panics on the reads the row names (counted from 1: the first
/// read is the service's start time).
struct TestWallClock {
    real_usec: Rc<Cell<u64>>,
    read_count: Cell<u32>,
    panicking_read_numbers: Vec<u32>,
}

impl WallClock for TestWallClock {
    /// The time the row set, or a panic on a read the row named.
    fn real_usec(&self) -> u64 {
        let read_number = self.read_count.get() + 1;
        self.read_count.set(read_number);
        if self.panicking_read_numbers.contains(&read_number) {
            panic!("{WALL_CLOCK_PANIC_MESSAGE}");
        }
        self.real_usec.get()
    }
}

/// A service under test, and the handles a row turns and reads.
struct TestService {
    service: SamplerService,
    monotonic_usec: Rc<Cell<u64>>,
    real_usec: Rc<Cell<u64>>,
    /// Every line logged, by the sampler and by the program.
    logged: Rc<RefCell<Vec<String>>>,
}

impl TestService {
    /// A service over a fixture root, with no app names, on the rows' clocks; its wall clock panics
    /// on the reads named.
    fn at_fixture(root_name: &str, panicking_wall_reads: &[u32]) -> TestService {
        TestService::with_resolver(root_name, panicking_wall_reads, Box::new(|_| None))
    }

    /// A service over a fixture root that names apps with `resolve_app_name`.
    fn with_resolver(
        root_name: &str,
        panicking_wall_reads: &[u32],
        resolve_app_name: ResolveAppName,
    ) -> TestService {
        TestService::with_ports(
            root_name,
            panicking_wall_reads,
            resolve_app_name,
            Box::new(FileSystemReader),
        )
    }

    /// A service over a fixture root that names apps with `resolve_app_name` and reads with `reader`.
    fn with_ports(
        root_name: &str,
        panicking_wall_reads: &[u32],
        resolve_app_name: ResolveAppName,
        reader: Box<dyn FileReader>,
    ) -> TestService {
        let monotonic_usec = Rc::new(Cell::new(MONOTONIC_START_USEC));
        let real_usec = Rc::new(Cell::new(SERVICE_STARTED_AT_USEC));
        let logged = Rc::new(RefCell::new(Vec::new()));
        let ports = SamplerPorts {
            reader,
            lister: Box::new(FileSystemLister),
            clock: Box::new(SettableClock::with_fixed_label(Rc::clone(&monotonic_usec))),
            resolve_app_name,
            log: recording_writer(&logged),
        };
        let service = SamplerService::new(
            Sampler::new(fixture_root(root_name), ports),
            Box::new(SettableClock::with_fixed_label(Rc::clone(&monotonic_usec))),
            Box::new(TestWallClock {
                real_usec: Rc::clone(&real_usec),
                read_count: Cell::new(0),
                panicking_read_numbers: panicking_wall_reads.to_vec(),
            }),
            recording_writer(&logged),
        );
        TestService {
            service,
            monotonic_usec,
            real_usec,
            logged,
        }
    }

    /// Moves the monotonic clock on.
    fn advance_clock(&self, usec: u64) {
        self.monotonic_usec.set(self.monotonic_usec.get() + usec);
    }

    /// Runs one tick and parses its Sample.
    fn tick(&mut self) -> Value {
        parse_json(&self.service.run_tick().expect("the tick published"))
    }

    /// What has been logged so far.
    fn logged(&self) -> Vec<String> {
        self.logged.borrow().clone()
    }
}

/// A log writer that records each line.
fn recording_writer(logged: &Rc<RefCell<Vec<String>>>) -> Box<dyn FnMut(&str)> {
    let logged = Rc::clone(logged);
    Box::new(move |line| logged.borrow_mut().push(line.to_string()))
}

/// Parses a JSON text a row was handed.
fn parse_json(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|error| panic!("{error}: {text}"))
}

/// A bus the watch rows fake: it records what it is asked to do, in order, and its follow can be
/// made to fail.
#[derive(Default)]
struct FakeWatchBus {
    events: RefCell<Vec<String>>,
    is_follow_failing: Cell<bool>,
    is_send_failing: Cell<bool>,
}

impl FakeWatchBus {
    /// What it was asked to do, in order; a Sample as `Sample <sequence> reveal|tick`.
    fn events(&self) -> Vec<String> {
        self.events.borrow().clone()
    }
}

impl WatchBus for FakeWatchBus {
    /// Records the follow, or fails when made to.
    fn follow_caller(&self, unique_name: &str) -> Result<(), String> {
        if self.is_follow_failing.get() {
            return Err(FOLLOW_FAILURE_TEXT.to_string());
        }
        self.events
            .borrow_mut()
            .push(format!("follow {unique_name}"));
        Ok(())
    }

    /// Records the unfollow.
    fn unfollow_caller(&self, unique_name: &str) -> Result<(), String> {
        self.events
            .borrow_mut()
            .push(format!("unfollow {unique_name}"));
        Ok(())
    }

    /// Records the Sample by its sequence, and whether it is a reveal (it appends nothing), or
    /// fails when made to.
    fn send_sample_text(&self, sample_text: &str) -> Result<(), String> {
        if self.is_send_failing.get() {
            return Err(SEND_FAILURE_TEXT.to_string());
        }
        let sample = parse_json(sample_text);
        let kind = if sample["appendedHistory"].is_null() {
            "reveal"
        } else {
            "tick"
        };
        self.events
            .borrow_mut()
            .push(format!("Sample {} {kind}", sample["sequence"]));
        Ok(())
    }
}

/// A service whose sampler has ticked twice, 2 s apart, and whose clock then moved on 1.5 s: a watch
/// that starts now scans and reveals (the golden watch scenario's timing).
fn service_ready_to_reveal() -> TestService {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    test_service.tick();
    test_service.advance_clock(INTERVAL_USEC);
    test_service.tick();
    test_service.advance_clock(WATCH_AFTER_LAST_TICK_USEC);
    test_service
}

/// The gjs service's texts, word for word, for the bus going away once the name was owned (its
/// `_onNameLost`) and for a name it could not own, after the prefix.
const GJS_SERVICE_BUS_GONE_TEXT: &str =
    "shutting down: lost io.github.zvibaratz.ResourcePulse1: the bus connection closed";
const GJS_SERVICE_CANNOT_OWN_TEXT: &str = "shutting down: cannot own \
    io.github.zvibaratz.ResourcePulse1: another copy holds it, or there is no session bus";
/// What a planted panic on the receiving thread is handed over as.
const RECEIVING_PANIC_TEXT: &str = "planted on the receiving thread at src/bus.rs:1:1";

/// A call of the program's interface from [`FIRST_CALLER`], as the bus would deliver it.
fn incoming_call_of(member: &str) -> IncomingCall {
    let message = zbus::Message::method_call(RESOURCE_PULSE_OBJECT_PATH, member)
        .sender(FIRST_CALLER)
        .build(&())
        .unwrap();
    IncomingCall::from_message(message)
}

/// The kind a failed stream's rows carry: an I/O error's, as `BusError::kind` words it.
const FAILED_STREAM_KIND: &str = "I/O error (InvalidData)";

thread_local! {
    /// Each line [`record_log_line`] was handed on this thread, with its priority: a row runs on a
    /// thread of its own, so it reads its own lines only.
    static RECORDED_LOG_LINES: RefCell<Vec<(LinePriority, String)>> = const { RefCell::new(Vec::new()) };
}

/// A line writer that records each line and its priority, where the program writes to stderr.
fn record_log_line(priority: LinePriority, line: &str) {
    RECORDED_LOG_LINES.with(|recorded| recorded.borrow_mut().push((priority, line.to_string())));
}

/// The file a caught panic's place names, the `<file>` of `<file>:<line>:<column>`, when it is a
/// path ending in `.rs` with something before the `.rs`; `None` for any other place, an empty one
/// included. A row compares it, whole, with the `file!()` of the file that plants its panic, so a
/// panic placed anywhere else, a sibling test file included, fails the row.
fn panic_source_file(panic_location: &str) -> Option<&str> {
    let (source_file, _line_and_column) = panic_location.split_once(':')?;
    let is_rust_source_path = source_file
        .strip_suffix(RUST_SOURCE_SUFFIX)
        .is_some_and(|path_before_suffix| !path_before_suffix.is_empty());
    is_rust_source_path.then_some(source_file)
}
