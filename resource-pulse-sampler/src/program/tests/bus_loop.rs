//! The bus's own outlet on a bus the row scripts: its events (the receiving thread's end, a
//! connection that closed, a stream that failed or ended, a message whose handling panicked), a
//! failure while waiting for one, and the watchdog told after every tick.

use std::collections::VecDeque;
use std::ops::ControlFlow;
use std::time::Duration;

use super::*;
use crate::bus::{BusEvent, MessageFailure, StreamEnd};
use crate::call_routing::FAILED_ERROR_NAME;
use crate::caught_panic::install_panic_hook;
use crate::constants::LOG_PREFIX;
use crate::program::calls::{CallReply, ProgramBus};
use crate::program::ending::Ending;
use crate::program::tick_loop::{run_one_tick, work_until, TickLoopOutlet};
use crate::watchdog::Notification;

/// A call of the program's interface from [`FIRST_CALLER`], flagged "no reply expected".
fn no_reply_call_of(member: &str) -> IncomingCall {
    let message = zbus::Message::method_call(RESOURCE_PULSE_OBJECT_PATH, member)
        .sender(FIRST_CALLER)
        .with_flags(zbus::message::Flags::NO_REPLY_EXPECTED)
        .build(&())
        .unwrap();
    IncomingCall::from_message(message)
}

/// What a scripted bus's wait fails with.
const NEXT_EVENT_FAILURE_TEXT: &str = "D-Bus: the bus answered org.freedesktop.DBus.Error.NoReply";
/// The bus's outlet's wait for the next event, in the rows that hand it one event: a whole interval.
const OUTLET_WAIT: Duration = Duration::from_micros(INTERVAL_USEC);
/// What the scripted outlet's watchdog writes in the log on each notification.
const WATCHDOG_LOG_ENTRY: &str = "watchdog";

/// One turn of a scripted bus's `next_event`.
enum ScriptedTurn {
    /// The whole wait passes with nothing: the rows' clock moves on by it.
    Quiet,
    /// An event arrives at once.
    Event(BusEvent),
    /// Waiting fails, with this text.
    Failure(&'static str),
}

/// A bus the outlet rows script: `next_event` plays its turns in order and, once they are spent,
/// says the bus is gone, so that a loop on it always ends. Each Sample and reply it is handed goes
/// into a log the row reads, in order; a reply to a call flagged "no reply expected" is dropped, as
/// `BusLink`'s reply methods drop it (bus_link.rs's no-reply row pins that on a real bus).
struct ScriptedBus {
    monotonic_usec: Rc<Cell<u64>>,
    turns: VecDeque<ScriptedTurn>,
    log: Rc<RefCell<Vec<String>>>,
}

impl WatchBus for ScriptedBus {
    /// Follows nobody: no row here watches.
    fn follow_caller(&self, _unique_name: &str) -> Result<(), String> {
        Ok(())
    }

    /// Unfollows nobody.
    fn unfollow_caller(&self, _unique_name: &str) -> Result<(), String> {
        Ok(())
    }

    /// Logs the Sample by its sequence.
    fn send_sample_text(&self, sample_text: &str) -> Result<(), String> {
        let sequence = parse_json(sample_text)["sequence"].clone();
        self.log.borrow_mut().push(format!("Sample {sequence}"));
        Ok(())
    }
}

impl ProgramBus for ScriptedBus {
    /// Plays the next turn; once they are spent, the bus is gone.
    fn next_event(&mut self, wait: Duration) -> Result<Option<BusEvent>, String> {
        match self.turns.pop_front() {
            Some(ScriptedTurn::Quiet) => {
                let waited_usec = u64::try_from(wait.as_micros()).unwrap();
                self.monotonic_usec
                    .set(self.monotonic_usec.get() + waited_usec);
                Ok(None)
            }
            Some(ScriptedTurn::Event(event)) => Ok(Some(event)),
            Some(ScriptedTurn::Failure(failure_text)) => Err(failure_text.to_string()),
            None => Ok(Some(BusEvent::Disconnected(StreamEnd::ConnectionClosed))),
        }
    }

    /// Logs the reply with the method it answers, unless the call wants none.
    fn send_reply(&self, call: &IncomingCall, reply: CallReply) -> Result<(), String> {
        if call.expects_reply() {
            self.log
                .borrow_mut()
                .push(format!("reply to {}: {reply:?}", call.member));
        }
        Ok(())
    }
}

/// The bus's outlet on a bus that plays `turns`, on the rows' clock, and a log of what it sent, in
/// order: each Sample, each reply, and each time it told the watchdog the program is alive.
fn scripted_bus_outlet(
    test_service: &TestService,
    turns: Vec<ScriptedTurn>,
) -> (BusOutlet<ScriptedBus>, Rc<RefCell<Vec<String>>>) {
    let log = Rc::new(RefCell::new(Vec::new()));
    let watchdog_log = Rc::clone(&log);
    let outlet = BusOutlet {
        bus: ScriptedBus {
            monotonic_usec: Rc::clone(&test_service.monotonic_usec),
            turns: VecDeque::from(turns),
            log: Rc::clone(&log),
        },
        notify_watchdog: Box::new(move || {
            watchdog_log
                .borrow_mut()
                .push(WATCHDOG_LOG_ENTRY.to_string());
            Ok(Notification::Sent)
        }),
    };
    (outlet, log)
}

/// The bus's outlet handed `event` as the one event of a wait: the ending of the loop it ended, or
/// None when the loop went on, and what it sent on the bus meanwhile.
fn ending_after_one_event(event: BusEvent) -> (Option<Ending>, Vec<String>) {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let (mut outlet, log) = scripted_bus_outlet(&test_service, vec![ScriptedTurn::Event(event)]);
    let flow = outlet.wait_for_work(&mut test_service.service, OUTLET_WAIT);
    let ending = match flow {
        ControlFlow::Break(loop_end) => Some(ending_of_loop(loop_end)),
        ControlFlow::Continue(()) => None,
    };
    let sent = log.borrow().clone();
    (ending, sent)
}

/// The receiving thread's end, from the event to the exit status: the bus's outlet ends the loop
/// with the receiving thread's own ending, which says so and exits 1, a failure the journal shows
/// as one; never with the bus going away, a clean 0 that would hide it.
#[test]
fn a_receiving_thread_that_ended_ends_the_loop_with_1_never_as_the_bus_going_away() {
    assert_eq!(
        ending_after_one_event(BusEvent::ReceivingThreadEnded),
        (
            Some(Ending {
                log_lines: vec![format!(
                    "{LOG_PREFIX} shutting down: the thread that receives from the bus ended"
                )],
                exit_status: 1
            }),
            Vec::<String>::new()
        )
    );
}

/// A connection that closed, from the event to the exit status: the bus's outlet ends the loop as
/// the bus going away, the gjs service's line alone and 0, and sends nothing.
#[test]
fn a_connection_that_closed_ends_the_loop_as_the_bus_going_away_with_0() {
    assert_eq!(
        ending_after_one_event(BusEvent::Disconnected(StreamEnd::ConnectionClosed)),
        (
            Some(Ending {
                log_lines: vec![format!("{LOG_PREFIX} {GJS_SERVICE_BUS_GONE_TEXT}")],
                exit_status: 0
            }),
            Vec::<String>::new()
        )
    );
}

/// A stream that failed, from the event to the exit status: the bus's outlet ends the loop as a
/// failed stream with the error's kind, which says it and exits 1, never as the bus going away.
#[test]
fn a_stream_that_failed_ends_the_loop_with_1_and_its_kind() {
    let stream_end = StreamEnd::Failed(FAILED_STREAM_KIND.to_string());
    assert_eq!(
        ending_after_one_event(BusEvent::Disconnected(stream_end)),
        (
            Some(Ending {
                log_lines: vec![format!(
                    "{LOG_PREFIX} shutting down: the bus connection ended on an unexpected error: \
                     {FAILED_STREAM_KIND}"
                )],
                exit_status: 1
            }),
            Vec::<String>::new()
        )
    );
}

/// A stream that ended without the connection closing, from the event to the exit status: the bus's
/// outlet ends the loop as a failed stream with no kind, which says so and exits 1.
#[test]
fn a_stream_that_ended_without_a_close_ends_the_loop_with_1() {
    assert_eq!(
        ending_after_one_event(BusEvent::Disconnected(StreamEnd::EndedWithoutClose)),
        (
            Some(Ending {
                log_lines: vec![format!(
                    "{LOG_PREFIX} shutting down: the stream of bus messages ended though the \
                     connection did not close"
                )],
                exit_status: 1
            }),
            Vec::<String>::new()
        )
    );
}

/// A message whose handling panicked on the receiving thread, from the event to the wire: a call
/// that wants a reply gets exactly one, a `Failed` error naming the method, the caller and the panic,
/// sent from the loop's thread; a message that was not a call, and a call flagged "no reply
/// expected", get none. The loop goes on after each.
#[test]
fn a_call_whose_handling_panicked_on_the_receiving_thread_gets_exactly_one_error_reply() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let failure_of = |call| {
        ScriptedTurn::Event(BusEvent::MessageFailed(MessageFailure {
            panic_text: RECEIVING_PANIC_TEXT.to_string(),
            call,
        }))
    };
    let turns = vec![
        failure_of(Some(incoming_call_of("Boom"))),
        failure_of(None),
        failure_of(Some(no_reply_call_of("Hush"))),
    ];
    let turn_count = turns.len();
    let (mut outlet, log) = scripted_bus_outlet(&test_service, turns);
    let has_loop_gone_on = (0..turn_count).all(|_| {
        let flow = outlet.wait_for_work(&mut test_service.service, OUTLET_WAIT);
        flow.is_continue()
    });
    let expected_reply = CallReply::Error {
        name: FAILED_ERROR_NAME,
        message: format!("Boom from {FIRST_CALLER} failed: {RECEIVING_PANIC_TEXT}"),
    };
    assert_eq!(
        (has_loop_gone_on, log.borrow().clone()),
        (true, vec![format!("reply to Boom: {expected_reply:?}")])
    );
}

/// A failure while waiting for the next event (a `RemoveMatch` for a departed caller the daemon
/// did not answer, say): logged under the bus link's key (two, one line), and the loop goes on to
/// its next tick, which sends its Sample and tells the watchdog. The bus is not gone.
#[test]
fn a_failure_while_waiting_for_an_event_is_logged_and_the_next_tick_runs() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    test_service.service.initialize();
    let (mut outlet, log) = scripted_bus_outlet(
        &test_service,
        vec![
            ScriptedTurn::Failure(NEXT_EVENT_FAILURE_TEXT),
            ScriptedTurn::Failure(NEXT_EVENT_FAILURE_TEXT),
            ScriptedTurn::Quiet,
        ],
    );
    let next_tick_at_usec = test_service.service.monotonic_usec() + INTERVAL_USEC;
    let waited = work_until(&mut test_service.service, &mut outlet, next_tick_at_usec);
    let ticked = run_one_tick(&mut test_service.service, &mut outlet);
    assert_eq!(
        (
            waited.is_continue(),
            ticked.is_continue(),
            test_service.logged(),
            log.borrow().clone()
        ),
        (
            true,
            true,
            vec![format!("{LOG_PREFIX} bus: {NEXT_EVENT_FAILURE_TEXT}")],
            vec!["Sample 1".to_string(), WATCHDOG_LOG_ENTRY.to_string()]
        )
    );
}

/// The watchdog is told after every tick, a tick that panicked included,
/// so a tick that panics on every run costs that tick and never the process (told only after a
/// Sample, systemd would kill the program once `WatchdogSec=` passed). Ticks 0 and 1 panic (their
/// wall-clock reads do), tick 2 sends Sample 1.
#[test]
fn the_watchdog_is_told_after_every_tick_a_tick_that_panicked_included() {
    install_panic_hook();
    let mut test_service = TestService::at_fixture("root-a", &[2, 3]);
    test_service.service.initialize();
    let (mut outlet, log) = scripted_bus_outlet(&test_service, Vec::new());
    let have_ticks_gone_on = (0..3).all(|_| {
        test_service.advance_clock(INTERVAL_USEC);
        run_one_tick(&mut test_service.service, &mut outlet).is_continue()
    });
    let logged_steps: Vec<String> = log.borrow().clone();
    assert_eq!(
        (have_ticks_gone_on, logged_steps),
        (
            true,
            [
                WATCHDOG_LOG_ENTRY,
                WATCHDOG_LOG_ENTRY,
                "Sample 1",
                WATCHDOG_LOG_ENTRY
            ]
            .map(String::from)
            .to_vec()
        )
    );
}
