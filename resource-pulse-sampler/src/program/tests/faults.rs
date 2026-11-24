//! Faults the program catches, logs under one key and goes on from: a message whose handling
//! panicked on the receiving thread, a Sample that cannot be sent, a panic inside `initialize`, a
//! panic while a vanished caller's watches are dropped, and a reply the bus refuses.

use std::time::Duration;

use super::*;
use crate::bus::{BusEvent, MessageFailure};
use crate::call_routing::FAILED_ERROR_NAME;
use crate::caught_panic::install_panic_hook;
use crate::constants::{GET_STATE_METHOD_NAME, LOG_PREFIX};
use crate::ports::ReadFailure;
use crate::program::calls::{
    answer_call, drop_watches_inside_catch, failed_message_reply, send_sample, watch_detail,
    CallReply, ProgramBus,
};

/// The file a reader that panics breaks on, as `initialize` reads it, and what its panic says.
const STATUS_FILE_SUFFIX: &str = "proc/self/status";
const STATUS_PANIC_MESSAGE: &str = "status exploded";

/// The rule: a message whose handling panicked on the receiving thread is logged under one
/// key and, when it was a call, answered with a `Failed` error naming the method, the caller and
/// the panic; a message that was not a call is logged, with nothing to answer.
#[test]
fn a_message_whose_handling_panicked_is_logged_and_its_call_answered_with_an_error() {
    let mut call_service = TestService::at_fixture("root-a", &[]);
    let call_reply = failed_message_reply(
        &mut call_service.service,
        MessageFailure {
            panic_text: RECEIVING_PANIC_TEXT.to_string(),
            call: Some(incoming_call_of("Boom")),
        },
    );
    let mut signal_service = TestService::at_fixture("root-a", &[]);
    let signal_reply = failed_message_reply(
        &mut signal_service.service,
        MessageFailure {
            panic_text: RECEIVING_PANIC_TEXT.to_string(),
            call: None,
        },
    );
    let expected_message = format!("Boom from {FIRST_CALLER} failed: {RECEIVING_PANIC_TEXT}");
    assert_eq!(
        (
            call_reply.map(|(call, reply)| (call.member, reply)),
            call_service.logged(),
            signal_reply.is_none(),
            signal_service.logged(),
        ),
        (
            Some((
                "Boom".to_string(),
                CallReply::Error {
                    name: FAILED_ERROR_NAME,
                    message: expected_message.clone()
                }
            )),
            vec![format!("{LOG_PREFIX} receiving {expected_message}")],
            true,
            vec![format!(
                "{LOG_PREFIX} receiving a message failed: {RECEIVING_PANIC_TEXT}"
            )]
        )
    );
}

/// The real reader, except that it panics on `proc/self/status`, which only `initialize` reads.
struct PanickingStatusReader;

impl FileReader for PanickingStatusReader {
    /// Panics for the status file; reads every other file as the real reader does.
    fn read_to_text(&self, path: &Path) -> Result<String, ReadFailure> {
        if path.ends_with(STATUS_FILE_SUFFIX) {
            panic!("{STATUS_PANIC_MESSAGE}");
        }
        FileSystemReader.read_to_text(path)
    }
}

/// The rule "a Sample that cannot be sent is logged under one stable key and the loop goes on": a
/// watch's reveal and a tick's Sample that cannot be sent are one line under the key, the watch
/// call is still answered, the sequence moves past them, and the next Sample that can be sent is.
#[test]
fn a_sample_that_cannot_be_sent_is_logged_under_one_key_and_the_loop_goes_on() {
    let mut test_service = service_ready_to_reveal();
    let bus = FakeWatchBus::default();
    bus.is_send_failing.set(true);
    let watch_reply = watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    test_service.advance_clock(INTERVAL_USEC);
    let unsent_tick_text = test_service.service.run_tick().unwrap();
    send_sample(&bus, &mut test_service.service, &unsent_tick_text);
    bus.is_send_failing.set(false);
    test_service.advance_clock(INTERVAL_USEC);
    let sent_tick_text = test_service.service.run_tick().unwrap();
    send_sample(&bus, &mut test_service.service, &sent_tick_text);
    assert_eq!(
        (watch_reply, test_service.logged(), bus.events()),
        (
            CallReply::Empty,
            vec![format!(
                "{LOG_PREFIX} cannot send a Sample: {SEND_FAILURE_TEXT}"
            )],
            vec![
                format!("follow {FIRST_CALLER}"),
                "Sample 5 tick".to_string()
            ]
        )
    );
}

/// The rule "`initialize` runs inside the catch too": a read that panics in `initialize` is logged
/// once, `initialize failed: <panic> at <place>`, and the first tick still publishes.
#[test]
fn a_panic_inside_initialize_is_caught_logged_and_the_first_tick_publishes() {
    install_panic_hook();
    let mut test_service = TestService::with_ports(
        "root-a",
        &[],
        Box::new(|_| None),
        Box::new(PanickingStatusReader),
    );
    test_service.service.initialize();
    let sample = test_service.tick();
    let logged = test_service.logged();
    let (logged_message, panic_location) = logged[0].rsplit_once(" at ").unwrap();
    assert_eq!(
        (
            logged.len(),
            logged_message,
            panic_source_file(panic_location),
            sample["snapshot"]["memory"].is_object(),
        ),
        (
            1,
            format!("{LOG_PREFIX} initialize failed: {STATUS_PANIC_MESSAGE}").as_str(),
            Some(file!()),
            true
        )
    );
}

/// The vanished-caller catch: a panic while a vanished caller's watches are dropped is logged once
/// (two panics, one line), under the gjs service's key, with the panic's place, and the program
/// goes on, so a later watch is served and reveals. A vanish never reveals, so nothing a bus or a
/// port does can panic there: the drop step is the catch's parameter, and the row plants the panic
/// in it.
#[test]
fn a_panic_while_dropping_a_vanished_caller_is_caught_and_logged_under_its_key() {
    install_panic_hook();
    let mut test_service = service_ready_to_reveal();
    let bus = FakeWatchBus::default();
    for _ in 0..2 {
        drop_watches_inside_catch(&mut test_service.service, SECOND_CALLER, |_| {
            panic!("drop exploded")
        });
    }
    let watch_reply = watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    let logged = test_service.logged();
    let (logged_message, panic_location) = logged[0].rsplit_once(" at ").unwrap();
    assert_eq!(
        (
            logged.len(),
            logged_message,
            panic_source_file(panic_location),
            watch_reply,
            bus.events(),
        ),
        (
            1,
            format!("{LOG_PREFIX} dropping the watches of {SECOND_CALLER} failed: drop exploded")
                .as_str(),
            Some(file!()),
            CallReply::Empty,
            vec![
                format!("follow {FIRST_CALLER}"),
                "Sample 3 reveal".to_string()
            ]
        )
    );
}

/// What a refusing bus says each reply it is handed failed with.
const REPLY_REFUSED_TEXT: &str = "D-Bus: the connection is closed";

/// A bus that refuses every reply and does nothing else: nobody follows, nothing is sent, and no
/// event ever comes.
struct RefusingReplyBus;

impl WatchBus for RefusingReplyBus {
    /// Follows nobody.
    fn follow_caller(&self, _unique_name: &str) -> Result<(), String> {
        Ok(())
    }

    /// Unfollows nobody.
    fn unfollow_caller(&self, _unique_name: &str) -> Result<(), String> {
        Ok(())
    }

    /// Sends nothing.
    fn send_sample_text(&self, _sample_text: &str) -> Result<(), String> {
        Ok(())
    }
}

impl ProgramBus for RefusingReplyBus {
    /// No event ever comes.
    fn next_event(&mut self, _wait: Duration) -> Result<Option<BusEvent>, String> {
        Ok(None)
    }

    /// Refuses the reply.
    fn send_reply(&self, _call: &IncomingCall, _reply: CallReply) -> Result<(), String> {
        Err(REPLY_REFUSED_TEXT.to_string())
    }
}

/// A reply the bus refuses is logged, rate-limited under one key, and the program goes on. Nothing
/// in gjs does this (GDBus owns the reply there), so the line is the program's own.
#[test]
fn a_reply_the_bus_refuses_is_logged_once_under_one_key_and_the_program_goes_on() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let call = incoming_call_of(GET_STATE_METHOD_NAME);
    for _ in 0..2 {
        answer_call(&RefusingReplyBus, &mut test_service.service, &call);
    }
    assert_eq!(
        test_service.logged(),
        vec![format!(
            "{LOG_PREFIX} cannot answer {GET_STATE_METHOD_NAME} from {FIRST_CALLER}: {REPLY_REFUSED_TEXT}"
        )]
    );
}
