//! The bus as the calls reach it, and the calls between ticks: each carried out and answered.

use std::time::Duration;

use crate::bus::{BusEvent, BusLink, IncomingCall, MessageFailure};
use crate::call_routing::{
    read_machine_id, route_call, CallDescription, CallRoute, ProgramMethod, FAILED_ERROR_NAME,
};
use crate::caught_panic::catching_panic;
use crate::constants::{SAMPLE_SIGNAL_NAME, UNWATCH_DETAIL_METHOD_NAME, WATCH_DETAIL_METHOD_NAME};

use super::sampler_service::SamplerService;
use super::{
    CALL_FAILURE_LOG_KEY, MESSAGE_FAILURE_LOG_KEY, REPLY_FAILURE_LOG_KEY,
    SAMPLE_SEND_FAILURE_LOG_KEY, VANISHED_CALLER_FAILURE_LOG_KEY, WATCH_CALL_FAILURE_LOG_KEY,
};

/// What the bus's outlet reaches the bus through, besides what the watch calls need: the next event,
/// and the replies. `BusLink` is the real one; the rows hand in a scripted one.
pub(super) trait ProgramBus: WatchBus {
    /// The next call, vanished caller, failed message or ending, or None once `wait` has passed.
    fn next_event(&mut self, wait: Duration) -> Result<Option<BusEvent>, String>;
    /// Sends a call's reply; a call flagged "no reply expected" gets none.
    fn send_reply(&self, call: &IncomingCall, reply: CallReply) -> Result<(), String>;
}

impl ProgramBus for BusLink {
    /// `BusLink::next_event`.
    fn next_event(&mut self, wait: Duration) -> Result<Option<BusEvent>, String> {
        BusLink::next_event(self, wait).map_err(|error| error.to_string())
    }

    /// The `BusLink` reply method for the reply's kind, each of which sends nothing to a call flagged
    /// "no reply expected".
    fn send_reply(&self, call: &IncomingCall, reply: CallReply) -> Result<(), String> {
        let sent = match reply {
            CallReply::Text(text) => self.reply_with_string(call, &text),
            CallReply::Empty => self.reply_empty(call),
            CallReply::EmptyPropertyMap => self.reply_with_empty_property_map(call),
            CallReply::Error { name, message } => self.reply_with_error(call, name, &message),
        };
        sent.map_err(|error| error.to_string())
    }
}

/// What the watch calls and a vanished caller need of the bus: following a caller's name, letting
/// it go, and sending a reveal's Sample. `BusLink` is the real one; the rows hand in their own.
pub(super) trait WatchBus {
    /// Starts following a caller, so its departure is reported.
    fn follow_caller(&self, unique_name: &str) -> Result<(), String>;
    /// Stops following a caller.
    fn unfollow_caller(&self, unique_name: &str) -> Result<(), String>;
    /// Emits one Sample.
    fn send_sample_text(&self, sample_text: &str) -> Result<(), String>;
}

impl WatchBus for BusLink {
    /// `BusLink::follow_name`.
    fn follow_caller(&self, unique_name: &str) -> Result<(), String> {
        self.follow_name(unique_name)
            .map_err(|error| error.to_string())
    }

    /// `BusLink::unfollow_name`.
    fn unfollow_caller(&self, unique_name: &str) -> Result<(), String> {
        self.unfollow_name(unique_name)
            .map_err(|error| error.to_string())
    }

    /// The `Sample` signal.
    fn send_sample_text(&self, sample_text: &str) -> Result<(), String> {
        self.emit_string_signal(SAMPLE_SIGNAL_NAME, sample_text)
            .map_err(|error| error.to_string())
    }
}

/// Sends a Sample; one that cannot be sent is logged, and the loop goes on. Its sequence number is
/// spent all the same, so a client sees the gap (`_emitSample`).
pub(super) fn send_sample(bus: &dyn WatchBus, service: &mut SamplerService, sample_text: &str) {
    if let Err(error) = bus.send_sample_text(sample_text) {
        service.log_failure(
            &format!("cannot send a Sample: {error}"),
            SAMPLE_SEND_FAILURE_LOG_KEY,
        );
    }
}

/// What a call is replied with, once carried out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum CallReply {
    Text(String),
    Empty,
    EmptyPropertyMap,
    Error { name: &'static str, message: String },
}

/// Carries out a call inside a catch and answers it: every call that wants a reply gets one, an
/// error reply when the catch caught something.
pub(super) fn answer_call(bus: &dyn ProgramBus, service: &mut SamplerService, call: &IncomingCall) {
    let reply = reply_or_failure(service, &call.member, &call.sender, |service| {
        carry_out_call(bus, service, call)
    });
    send_reply(bus, service, call, reply);
}

/// A call's reply, carried out inside a catch: when it panicked, a `Failed` error reply saying
/// `<method> from <caller> failed: <panic>` (`_answerWatchCall`'s), logged under the watch calls' key
/// for a watch call and under "call failed" for another.
pub(super) fn reply_or_failure(
    service: &mut SamplerService,
    member: &str,
    sender: &str,
    carry_out: impl FnOnce(&mut SamplerService) -> CallReply,
) -> CallReply {
    match catching_panic(|| carry_out(service)) {
        Ok(reply) => reply,
        Err(panic_text) => {
            let message = format!("{member} from {sender} failed: {panic_text}");
            let is_watch_call =
                [WATCH_DETAIL_METHOD_NAME, UNWATCH_DETAIL_METHOD_NAME].contains(&member);
            let template_key = if is_watch_call {
                WATCH_CALL_FAILURE_LOG_KEY
            } else {
                CALL_FAILURE_LOG_KEY
            };
            service.log_failure(&message, template_key);
            CallReply::Error {
                name: FAILED_ERROR_NAME,
                message,
            }
        }
    }
}

/// Routes a call and carries it out: the interface's methods here, everything else as GDBus answers
/// it (`call_routing.rs`).
pub(super) fn carry_out_call(
    bus: &dyn ProgramBus,
    service: &mut SamplerService,
    call: &IncomingCall,
) -> CallReply {
    let signature = call.signature();
    let string_arguments = call.string_arguments();
    let route = route_call(&CallDescription {
        object_path: &call.object_path,
        interface: call.interface.as_deref(),
        member: &call.member,
        signature: &signature,
        string_arguments: &string_arguments,
    });
    match route {
        CallRoute::Program(ProgramMethod::GetState) => {
            CallReply::Text(service.face.state_text(&service.sampler))
        }
        CallRoute::Program(ProgramMethod::WatchDetail) => watch_detail(bus, service, &call.sender),
        CallRoute::Program(ProgramMethod::UnwatchDetail) => {
            unwatch_detail(bus, service, &call.sender)
        }
        CallRoute::Introspection(xml) => CallReply::Text(xml),
        CallRoute::Empty => CallReply::Empty,
        CallRoute::EmptyPropertyMap => CallReply::EmptyPropertyMap,
        CallRoute::MachineId => match read_machine_id() {
            Ok(machine_id) => CallReply::Text(machine_id),
            Err(message) => CallReply::Error {
                name: FAILED_ERROR_NAME,
                message,
            },
        },
        CallRoute::Error { name, message } => CallReply::Error { name, message },
    }
}

/// `WatchDetail`, in `_addWatch`'s order: a caller's first watch follows the caller first, and a
/// follow that fails is answered with an error with nothing counted (a watch held for a caller
/// nobody follows would keep the sampler on the watched cadence for the life of the program); then
/// the watch is counted, the sampler is told when "any watch held" differs from what it last took,
/// and the reveal's Sample is sent, all before the reply, as the gjs service emitted it inside
/// `setDetailWatched` before it returned the call.
pub(super) fn watch_detail(
    bus: &dyn WatchBus,
    service: &mut SamplerService,
    sender: &str,
) -> CallReply {
    if !service.face.holds_watch(sender) {
        if let Err(error) = bus.follow_caller(sender) {
            let message = format!("{WATCH_DETAIL_METHOD_NAME} from {sender} failed: {error}");
            service.log_failure(&message, WATCH_CALL_FAILURE_LOG_KEY);
            return CallReply::Error {
                name: FAILED_ERROR_NAME,
                message,
            };
        }
    }
    service.face.add_watch(sender);
    send_reveal_if_watched_changed(bus, service);
    CallReply::Empty
}

/// `UnwatchDetail`, in `_removeWatch`'s order: a caller holding no watch is left alone (not an
/// error); else one watch fewer is counted, the caller is unfollowed at its last, and the sampler is
/// told when "any watch held" differs from what it last took. The watch is gone even if the bus
/// could not be told to stop routing the caller's departure, which is logged: a departure no longer
/// followed is dropped when it comes.
pub(super) fn unwatch_detail(
    bus: &dyn WatchBus,
    service: &mut SamplerService,
    sender: &str,
) -> CallReply {
    let change = service.face.remove_watch(sender);
    if !change.sender_had_watches {
        return CallReply::Empty;
    }
    if !change.sender_has_watches {
        if let Err(error) = bus.unfollow_caller(sender) {
            service.log_failure(
                &format!(
                    "{UNWATCH_DETAIL_METHOD_NAME} from {sender}: cannot stop following it: {error}"
                ),
                WATCH_CALL_FAILURE_LOG_KEY,
            );
        }
    }
    send_reveal_if_watched_changed(bus, service);
    CallReply::Empty
}

/// Drops every watch of a caller whose name vanished (`_onSenderVanished`), inside a catch: a caller
/// holding none is left alone; else its watches are forgotten and the sampler is told when "any
/// watch held" differs from what it last took. The bus link has already stopped following it.
pub(super) fn drop_vanished_caller(
    bus: &dyn WatchBus,
    service: &mut SamplerService,
    unique_name: &str,
) {
    drop_watches_inside_catch(service, unique_name, |service| {
        let change = service.face.drop_sender(unique_name);
        if change.sender_had_watches {
            send_reveal_if_watched_changed(bus, service);
        }
    });
}

/// Tells the sampler whether any watch is held, when that differs from what it last took, and sends
/// the reveal's Sample a starting watch publishes.
pub(super) fn send_reveal_if_watched_changed(bus: &dyn WatchBus, service: &mut SamplerService) {
    if let Some(reveal_text) = service.tell_sampler_if_watched_changed() {
        send_sample(bus, service, &reveal_text);
    }
}

/// Runs the dropping of a vanished caller's watches inside a catch: a panic there is logged under
/// the gjs service's key, `dropping the watches of <caller> failed: <panic>`, and the program goes
/// on. The step is a parameter, as `reply_or_failure`'s is, so that a row can make it panic.
pub(super) fn drop_watches_inside_catch(
    service: &mut SamplerService,
    unique_name: &str,
    drop_watches: impl FnOnce(&mut SamplerService),
) {
    let dropped = catching_panic(|| drop_watches(service));
    if let Err(panic_text) = dropped {
        service.log_failure(
            &format!("dropping the watches of {unique_name} failed: {panic_text}"),
            VANISHED_CALLER_FAILURE_LOG_KEY,
        );
    }
}

/// Logs a message whose handling panicked on the receiving thread and, when it was a call, answers
/// it with an error, from this thread, as every reply is sent.
pub(super) fn answer_failed_message(
    bus: &dyn ProgramBus,
    service: &mut SamplerService,
    failure: MessageFailure,
) {
    if let Some((call, reply)) = failed_message_reply(service, failure) {
        send_reply(bus, service, &call, reply);
    }
}

/// Logs a message whose handling panicked, under one key, and gives the call it was with its
/// `Failed` reply (`<method> from <caller> failed: <panic>`), or `None` when it was not a call.
pub(super) fn failed_message_reply(
    service: &mut SamplerService,
    failure: MessageFailure,
) -> Option<(IncomingCall, CallReply)> {
    let Some(call) = failure.call else {
        service.log_failure(
            &format!("receiving a message failed: {}", failure.panic_text),
            MESSAGE_FAILURE_LOG_KEY,
        );
        return None;
    };
    let message = format!(
        "{} from {} failed: {}",
        call.member, call.sender, failure.panic_text
    );
    service.log_failure(&format!("receiving {message}"), MESSAGE_FAILURE_LOG_KEY);
    let reply = CallReply::Error {
        name: FAILED_ERROR_NAME,
        message,
    };
    Some((call, reply))
}

/// Sends a call's reply; one that cannot be sent is logged.
pub(super) fn send_reply(
    bus: &dyn ProgramBus,
    service: &mut SamplerService,
    call: &IncomingCall,
    reply: CallReply,
) {
    if let Err(error) = bus.send_reply(call, reply) {
        service.log_failure(
            &format!(
                "cannot answer {} from {}: {error}",
                call.member, call.sender
            ),
            REPLY_FAILURE_LOG_KEY,
        );
    }
}
