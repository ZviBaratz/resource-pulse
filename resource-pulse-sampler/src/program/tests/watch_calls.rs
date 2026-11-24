//! The watch calls through a bus the row fakes: a watch that starts, a follow that fails, a
//! `set_detail_watched` that panicked, the last unwatch and a vanished caller; and a call that
//! panics, answered with a `Failed` error.

use super::*;
use crate::call_routing::FAILED_ERROR_NAME;
use crate::caught_panic::{catching_panic, install_panic_hook};
use crate::constants::{LOG_PREFIX, WATCH_DETAIL_METHOD_NAME};
use crate::program::calls::{
    drop_vanished_caller, reply_or_failure, unwatch_detail, watch_detail, CallReply,
};

/// A watch that starts follows its caller, then sends the reveal's Sample, all before the call is
/// answered (the reply is what `watch_detail` returns); a second watch from the same caller neither
/// follows again nor reveals.
#[test]
fn a_watch_that_starts_follows_the_caller_and_sends_the_reveal_before_the_reply() {
    let mut test_service = service_ready_to_reveal();
    let bus = FakeWatchBus::default();
    let first_reply = watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    let events_before_first_reply = bus.events();
    let second_reply = watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    assert_eq!(
        (
            events_before_first_reply,
            first_reply,
            bus.events().len(),
            second_reply,
            test_service.service.face.detail_watch_count(),
        ),
        (
            vec![
                format!("follow {FIRST_CALLER}"),
                "Sample 3 reveal".to_string()
            ],
            CallReply::Empty,
            2,
            CallReply::Empty,
            2
        )
    );
}

/// `_addWatch`'s order, follow before counting: a follow that fails counts no watch and is answered
/// with a `Failed` error, logged under the watch calls' key, and nothing is revealed; the same
/// caller's next watch is then a first watch again: it follows, and it reveals, so the sampler was
/// not left on the watched cadence.
#[test]
fn a_follow_that_fails_counts_no_watch_and_the_callers_next_watch_is_a_first_again() {
    let mut test_service = service_ready_to_reveal();
    let bus = FakeWatchBus::default();
    bus.is_follow_failing.set(true);
    let failed_reply = watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    let watches_after_failure = test_service.service.face.detail_watch_count();
    let events_after_failure = bus.events();
    bus.is_follow_failing.set(false);
    let next_reply = watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    let expected_message = format!("WatchDetail from {FIRST_CALLER} failed: {FOLLOW_FAILURE_TEXT}");
    assert_eq!(
        (
            failed_reply,
            watches_after_failure,
            events_after_failure,
            test_service.logged(),
            next_reply,
            bus.events(),
        ),
        (
            CallReply::Error {
                name: FAILED_ERROR_NAME,
                message: expected_message.clone()
            },
            0,
            Vec::<String>::new(),
            vec![format!("{LOG_PREFIX} {expected_message}")],
            CallReply::Empty,
            vec![
                format!("follow {FIRST_CALLER}"),
                "Sample 3 reveal".to_string()
            ]
        )
    );
}

/// What the planted `set_detail_watched` panic says.
const SET_DETAIL_WATCHED_PANIC_MESSAGE: &str = "set_detail_watched exploded";

/// The level rule of `_tellSamplerIfWatchedChanged`: what the sampler took is recorded only
/// once `set_detail_watched` returned, so a call that panicked is made again at the next change of a
/// count. A caller's first watch is counted and its telling panics (caught, as a call's handling is);
/// the next caller's watch leaves "any watch held" as it was, yet the sampler is told, and reveals.
#[test]
fn a_set_detail_watched_that_panicked_is_told_again_at_the_next_change_of_a_count() {
    install_panic_hook();
    let mut test_service = service_ready_to_reveal();
    let bus = FakeWatchBus::default();
    let service = &mut test_service.service;
    service.face.add_watch(FIRST_CALLER);
    let first_telling = catching_panic(|| {
        service.tell_sampler_through_if_watched_changed(|_, _| {
            panic!("{SET_DETAIL_WATCHED_PANIC_MESSAGE}")
        })
    });
    let second_reply = watch_detail(&bus, service, SECOND_CALLER);
    assert_eq!(
        (first_telling.is_err(), second_reply, bus.events()),
        (
            true,
            CallReply::Empty,
            vec![
                format!("follow {SECOND_CALLER}"),
                "Sample 3 reveal".to_string()
            ]
        )
    );
}

/// A caller is unfollowed at its last unwatch, not before; a caller whose name vanished loses its
/// watches, and the sampler hears no watch is held: three ticks later (past the reveal cooldown) a
/// new caller's watch is a start again, and reveals.
#[test]
fn the_last_unwatch_unfollows_and_a_vanished_caller_loses_its_watches() {
    let mut test_service = service_ready_to_reveal();
    let bus = FakeWatchBus::default();
    watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    watch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    unwatch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    let events_after_one_unwatch = bus.events();
    unwatch_detail(&bus, &mut test_service.service, FIRST_CALLER);
    watch_detail(&bus, &mut test_service.service, SECOND_CALLER);
    drop_vanished_caller(&bus, &mut test_service.service, SECOND_CALLER);
    let watches_after_vanish = test_service.service.face.detail_watch_count();
    for _ in 0..3 {
        test_service.advance_clock(INTERVAL_USEC);
        test_service.tick();
    }
    test_service.advance_clock(WATCH_AFTER_LAST_TICK_USEC);
    watch_detail(&bus, &mut test_service.service, THIRD_CALLER);
    let events = bus.events();
    assert_eq!(
        (
            events_after_one_unwatch,
            events.get(2..).unwrap().to_vec(),
            watches_after_vanish,
        ),
        (
            vec![
                format!("follow {FIRST_CALLER}"),
                "Sample 3 reveal".to_string()
            ],
            vec![
                format!("unfollow {FIRST_CALLER}"),
                format!("follow {SECOND_CALLER}"),
                format!("follow {THIRD_CALLER}"),
                "Sample 7 reveal".to_string(),
            ],
            0
        )
    );
}

/// The rule "a caught call is still answered": a call that panics gets a `Failed` error reply
/// naming the method, the caller, the panic and its place, logged under "call failed", or under the
/// watch calls' key for a watch call.
#[test]
fn a_call_that_panics_is_answered_with_a_failed_error_and_logged() {
    install_panic_hook();
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let state_reply = reply_or_failure(&mut test_service.service, "GetState", FIRST_CALLER, |_| {
        panic!("state exploded")
    });
    let watch_reply = reply_or_failure(
        &mut test_service.service,
        WATCH_DETAIL_METHOD_NAME,
        FIRST_CALLER,
        |_| panic!("watch exploded"),
    );
    let message_of = |reply: &CallReply| match reply {
        CallReply::Error { name, message } => (*name, message.clone()),
        other => panic!("not an error reply: {other:?}"),
    };
    let (state_error_name, state_message) = message_of(&state_reply);
    let (watch_error_name, watch_message) = message_of(&watch_reply);
    let (state_text, state_location) = state_message.rsplit_once(" at ").unwrap();
    let (watch_text, _) = watch_message.rsplit_once(" at ").unwrap();
    assert_eq!(
        (
            state_error_name,
            state_text,
            panic_source_file(state_location),
            watch_error_name,
            watch_text,
            test_service.logged(),
        ),
        (
            FAILED_ERROR_NAME,
            "GetState from :1.7 failed: state exploded",
            Some(file!()),
            FAILED_ERROR_NAME,
            "WatchDetail from :1.7 failed: watch exploded",
            vec![
                format!("{LOG_PREFIX} {state_message}"),
                format!("{LOG_PREFIX} {watch_message}")
            ]
        )
    );
}
