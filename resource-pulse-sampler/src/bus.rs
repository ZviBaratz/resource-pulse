//! The program's link to the session bus, on `zbus`'s message-level API.
//!
//! Four rules shape it; each has a row in `gnome-shell/tests/sampler-program-dbus.test.js`, and
//! `tests/bus_link.rs` pins the first, the second and the fourth's exception deterministically.
//!
//! - **It listens before it is named.** `zbus` discards a message that arrives while no stream is
//!   listening, and a client calls `GetState` the instant the name has an owner. So
//!   [`BusLink::connect_listening`] connects with no name and opens the stream of incoming
//!   messages, and only [`BusLink::request_name`], called after it, asks for the name.
//! - **The name is asked for with "do not queue" only.** `zbus`'s default adds "replace the
//!   existing owner" and "allow replacement", with which a second copy would take the name from
//!   the first.
//! - **One thread sends every message.** No interface is registered with `zbus`'s object server,
//!   which would answer calls on a task of its own. Every reply and signal goes out from the thread
//!   that owns the `BusLink`, each send awaited before the next, and `zbus` writes a send on the
//!   caller's own task under the socket's write lock: the order of the calls is the order on the
//!   wire. A second thread only receives: it moves each incoming message into a channel that
//!   [`BusLink::next_event`] waits on, and it never sends. It hands each message over inside a
//!   catch, so a message whose handling panics costs that message alone: it reaches the program as
//!   [`BusEvent::MessageFailed`], for the sending thread to log and, for a call, to answer.
//! - **Every call is answered.** With no object server nothing answers for the program, so each
//!   call reaches it as [`BusEvent::Call`], whatever its path, interface or member.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::future::poll_fn;
use std::pin::pin;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use futures_core::Stream;
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::message::{Flags, Type as MessageType};
use zbus::{Connection, DBusError, MatchRule, Message, MessageStream, OwnedVariant};

use crate::caught_panic::catching_panic;
use crate::constants::{RESOURCE_PULSE_INTERFACE_NAME, RESOURCE_PULSE_OBJECT_PATH};

/// How long a call to the bus daemon (asking for the name, following and unfollowing a caller) may
/// wait for its answer before it fails: D-Bus's default reply time-out, libdbus's and GDBus's own.
/// Generous on purpose: a daemon slow at login must not make the program exit 1 for want of an
/// answer it would have had a second later.
const BUS_DAEMON_CALL_TIMEOUT: Duration = Duration::from_secs(25);
/// The signatures of the bodies [`IncomingCall::string_arguments`] reads strings from: one string,
/// two, and two before a variant (the arguments of `Properties`' `GetAll`, `Get` and `Set`).
const ONE_STRING_SIGNATURE: &str = "s";
const TWO_STRINGS_SIGNATURE: &str = "ss";
const TWO_STRINGS_AND_A_VARIANT_SIGNATURE: &str = "ssv";
/// The bus daemon's well-known name, which is also the sender of its signals.
const BUS_DAEMON_NAME: &str = "org.freedesktop.DBus";
/// The bus daemon's object path.
const BUS_DAEMON_OBJECT_PATH: &str = "/org/freedesktop/DBus";
/// The bus daemon's interface.
const BUS_DAEMON_INTERFACE_NAME: &str = "org.freedesktop.DBus";
/// The bus daemon's signal for a name changing owner: (name, old owner, new owner), the new owner
/// empty once the name has none.
const NAME_OWNER_CHANGED_SIGNAL_NAME: &str = "NameOwnerChanged";
/// The bus daemon's method that starts routing the signals a match rule describes to the caller.
const ADD_MATCH_METHOD_NAME: &str = "AddMatch";
/// The bus daemon's method that stops routing them.
const REMOVE_MATCH_METHOD_NAME: &str = "RemoveMatch";
/// The bus daemon's method that says whether a name has an owner.
const NAME_HAS_OWNER_METHOD_NAME: &str = "NameHasOwner";
/// The name of the thread that receives, as `top -H` shows it (Linux keeps 15 bytes of it).
const RECEIVING_THREAD_NAME: &str = "rp-bus-receiver";
/// The I/O errors that end the stream of incoming messages because the connection closed: the
/// socket's end of file, a reset and a broken pipe are how a socket says its peer went away, which
/// is the session bus going away at a logout, not a fault. (Measured: a private bus daemon ended by
/// SIGTERM, by SIGKILL and by its `dbus-run-session` exiting, 50 times each, ended the stream with
/// an end of file every time.)
const END_OF_CONNECTION_ERROR_KINDS: [std::io::ErrorKind; 3] = [
    std::io::ErrorKind::UnexpectedEof,
    std::io::ErrorKind::ConnectionReset,
    std::io::ErrorKind::BrokenPipe,
];

/// What [`BusLink::next_event`] hands the program.
#[derive(Debug)]
pub enum BusEvent {
    /// A method call, to be answered with one of the `reply_*` methods.
    Call(IncomingCall),
    /// A unique name the program followed has left the bus. It is followed no more.
    NameVanished(String),
    /// A message whose handling on the receiving thread panicked. That message is lost; the
    /// program logs the failure and, when the message was a call, answers it with an error.
    MessageFailed(MessageFailure),
    /// The stream of incoming messages ended, and nothing more will arrive; how it ended says
    /// whether the bus went away (the connection closed) or something failed.
    Disconnected(StreamEnd),
    /// The receiving thread ended while the stream of incoming messages had not: nothing more will
    /// arrive, though the connection may still be up. Not the bus going away, and not a clean end.
    ReceivingThreadEnded,
}

/// How the stream of incoming bus messages ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEnd {
    /// An end of file, a reset or a broken pipe: the session bus went away.
    ConnectionClosed,
    /// Any other error; carries the error's kind, never its text.
    Failed(String),
    /// No error at all: the library stopped delivering while the connection did not report closing.
    EndedWithoutClose,
}

/// A message whose handling on the receiving thread panicked.
#[derive(Debug)]
pub struct MessageFailure {
    /// The panic's text, with where it happened.
    pub panic_text: String,
    /// The call the message was, when it was one and could still be read as one, to be answered.
    pub call: Option<IncomingCall>,
}

/// A method call received from the bus.
#[derive(Debug)]
pub struct IncomingCall {
    /// The caller's unique name.
    pub sender: String,
    /// The method's name.
    pub member: String,
    /// The interface the call names; D-Bus lets a call leave it out.
    pub interface: Option<String>,
    /// The object path the call is addressed to.
    pub object_path: String,
    /// The call itself, which its reply is addressed by.
    message: Message,
}

impl IncomingCall {
    /// A method call as the program sees it. A call always has a sender, a member and a path on a
    /// bus; were one missing, it would read as empty, so the call is still handed over and answered.
    pub fn from_message(message: Message) -> IncomingCall {
        let header = message.header();
        let sender = header.sender().map(ToString::to_string).unwrap_or_default();
        let member = header.member().map(ToString::to_string).unwrap_or_default();
        let interface = header.interface().map(ToString::to_string);
        let object_path = header.path().map(ToString::to_string).unwrap_or_default();
        IncomingCall {
            sender,
            member,
            interface,
            object_path,
            message,
        }
    }

    /// The signature of the call's arguments, without the parentheses around several: `""` for
    /// none, `"ss"` for two strings.
    pub fn signature(&self) -> String {
        self.message.body().signature().to_string_no_parens()
    }

    /// The call's leading string arguments, for a body of one string, of two, or of two and a
    /// variant (as `Properties`' `GetAll`, `Get` and `Set` take): those strings. Any other body, or
    /// one that does not read as its signature says, gives none.
    pub fn string_arguments(&self) -> Vec<String> {
        let body = self.message.body();
        let strings = match self.signature().as_str() {
            ONE_STRING_SIGNATURE => body.deserialize::<(String,)>().map(|(first,)| vec![first]),
            TWO_STRINGS_SIGNATURE => body
                .deserialize::<(String, String)>()
                .map(|(first, second)| vec![first, second]),
            TWO_STRINGS_AND_A_VARIANT_SIGNATURE => body
                .deserialize::<(String, String, OwnedVariant)>()
                .map(|(first, second, _value)| vec![first, second]),
            _ => return Vec::new(),
        };
        strings.unwrap_or_default()
    }

    /// Whether the caller wants a reply: a call flagged "no reply expected" gets none.
    pub fn expects_reply(&self) -> bool {
        !self
            .message
            .primary_header()
            .flags()
            .contains(Flags::NO_REPLY_EXPECTED)
    }
}

/// How a request for the bus name ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameOutcome {
    /// The program owns the name.
    Owned,
    /// Another connection owns it, and the program was not queued for it.
    HeldByAnother,
}

/// A failure on the bus link.
#[derive(Debug)]
pub enum BusError {
    /// Connecting, a call to the bus daemon, or a send failed in `zbus`.
    Bus(zbus::Error),
    /// The thread that receives could not be started.
    ReceivingThread(std::io::Error),
}

impl fmt::Display for BusError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BusError::Bus(error) => write!(formatter, "D-Bus: {error}"),
            BusError::ReceivingThread(error) => {
                write!(formatter, "cannot start the receiving thread: {error}")
            }
        }
    }
}

impl BusError {
    /// What kind of failure this is, in words of the program's own, never the error's text:
    /// `zbus`'s text for a failure to connect names the bus address it tried (or the runtime
    /// directory it fell back to), and the program never prints its environment.
    pub fn kind(&self) -> String {
        match self {
            BusError::Bus(error) => zbus_error_kind(error),
            BusError::ReceivingThread(error) => {
                format!("cannot start the receiving thread ({:?})", error.kind())
            }
        }
    }
}

/// What kind of `zbus` failure this is, from its variant alone: an I/O failure by its
/// `io::ErrorKind`, an error the bus answered by its D-Bus error name, and every other kind by a
/// fixed phrase. None of these carries text from the error, so none can name an address or a path.
fn zbus_error_kind(error: &zbus::Error) -> String {
    match error {
        zbus::Error::Connection(io_error, _address) => {
            format!("cannot connect ({:?})", io_error.kind())
        }
        zbus::Error::InputOutput(io_error) => format!("I/O error ({:?})", io_error.kind()),
        zbus::Error::Address(_) => "the bus address is not valid".to_owned(),
        zbus::Error::Handshake(_) => "the handshake with the bus failed".to_owned(),
        zbus::Error::MethodError(error_name, _detail, _reply) => {
            format!("the bus answered {}", error_name.as_str())
        }
        zbus::Error::FDO(fdo_error) => format!("the bus answered {}", fdo_error.name()),
        zbus::Error::NameTaken => "the name is taken".to_owned(),
        _ => "another D-Bus failure".to_owned(),
    }
}

impl std::error::Error for BusError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            BusError::Bus(error) => Some(error),
            BusError::ReceivingThread(error) => Some(error),
        }
    }
}

impl From<zbus::Error> for BusError {
    fn from(error: zbus::Error) -> Self {
        BusError::Bus(error)
    }
}

/// What the receiving thread passes on: only what [`BusLink::next_event`] can act on.
#[derive(Debug)]
enum IncomingMessage {
    Call(IncomingCall),
    /// The bus daemon says this name has no owner any more.
    NameLeftBus(String),
    /// Handing a message over panicked: the message is lost, and this says so.
    HandlingFailed(MessageFailure),
    /// The stream of incoming messages has ended, as the end says.
    StreamEnded(StreamEnd),
}

/// The connection, the channel the receiving thread fills, and the names being followed.
///
/// Dropping a `BusLink` does not close its connection at once: the receiving thread holds the stream
/// of incoming messages, and with it the connection, until the next message arrives, when it finds
/// nobody listening and ends, and the connection closes with it. The program drops its link only on
/// its way out, and the process's exit closes the socket in any case, which is when the bus releases
/// the name.
///
/// The channel is unbounded on purpose: a bounded one, once full, would stall the receiving thread,
/// and with it `zbus`'s reader, which also carries the replies to the daemon calls the loop waits on
/// (a deadlock). In practice the loop drains it one event per turn; only while the loop is held (up
/// to three daemon round trips of `BUS_DAEMON_CALL_TIMEOUT` in one watch call) can a client that
/// pipelines calls grow it, within the bus daemon's per-connection limits and the unit's memory cap.
pub struct BusLink {
    connection: Connection,
    incoming_messages: IncomingChannel,
    /// Unique names whose departure is reported as [`BusEvent::NameVanished`].
    followed_names: RefCell<HashSet<String>>,
    /// Events found outside [`BusLink::next_event`], which it hands out first.
    pending_events: RefCell<VecDeque<BusEvent>>,
}

impl BusLink {
    /// Connects to the session bus with NO name and opens the stream of incoming messages. Every
    /// call to the bus daemon on this connection fails after `BUS_DAEMON_CALL_TIMEOUT` without an
    /// answer.
    pub fn connect_listening() -> Result<BusLink, BusError> {
        let connection_builder =
            zbus::connection::Builder::session().method_timeout(BUS_DAEMON_CALL_TIMEOUT);
        let connection = zbus::block_on(connection_builder.build())?;
        // Opened before the name is asked for, so that no call addressed to the name can arrive
        // while nothing is listening.
        let incoming_stream = MessageStream::from(&connection);
        let (message_sender, incoming_messages) = mpsc::channel();
        thread::Builder::new()
            .name(RECEIVING_THREAD_NAME.to_owned())
            .spawn(move || forward_incoming_messages(incoming_stream, message_sender, pass_on))
            .map_err(BusError::ReceivingThread)?;
        Ok(BusLink {
            connection,
            incoming_messages: IncomingChannel::new(incoming_messages),
            followed_names: RefCell::default(),
            pending_events: RefCell::default(),
        })
    }

    /// The link's unique name on the bus, which a call can be addressed to before the program
    /// owns any other. The bus assigns it in its reply to `Hello`, inside `build()`, so a bus
    /// connection always has one; the empty string would mean a peer-to-peer connection, which a
    /// `BusLink` never makes.
    pub fn unique_name(&self) -> &str {
        self.connection
            .unique_name()
            .map_or("", |unique_name| unique_name.as_str())
    }

    /// Asks for the name with DO_NOT_QUEUE only.
    pub fn request_name(&self, name: &str) -> Result<NameOutcome, BusError> {
        let request = self
            .connection
            .request_name_with_flags(name, RequestNameFlags::DO_NOT_QUEUE);
        match zbus::block_on(request) {
            Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => {
                Ok(NameOutcome::Owned)
            }
            // `zbus` reports the bus's "exists" as `NameTaken`. "In queue" cannot come back for a
            // request that said not to queue; were it to, another connection still owns the name.
            Ok(RequestNameReply::Exists | RequestNameReply::InQueue)
            | Err(zbus::Error::NameTaken) => Ok(NameOutcome::HeldByAnother),
            Err(error) => Err(error.into()),
        }
    }

    /// The next call or name loss, or None once `wait` has passed.
    pub fn next_event(&mut self, wait: Duration) -> Result<Option<BusEvent>, BusError> {
        if let Some(pending_event) = self.pending_events.get_mut().pop_front() {
            return Ok(Some(pending_event));
        }
        // A wait too long for the clock to represent is waited out in full on every turn instead.
        let deadline = Instant::now().checked_add(wait);
        loop {
            let remaining_wait = deadline.map_or(wait, |deadline| {
                deadline.saturating_duration_since(Instant::now())
            });
            let incoming_message = match self.incoming_messages.receive(remaining_wait) {
                Received::Message(incoming_message) => incoming_message,
                Received::TimedOut => return Ok(None),
                Received::ReceivingThreadEnded => return Ok(Some(BusEvent::ReceivingThreadEnded)),
            };
            match incoming_message {
                IncomingMessage::Call(call) => return Ok(Some(BusEvent::Call(call))),
                IncomingMessage::HandlingFailed(failure) => {
                    return Ok(Some(BusEvent::MessageFailed(failure)))
                }
                IncomingMessage::StreamEnded(stream_end) => {
                    return Ok(Some(BusEvent::Disconnected(stream_end)))
                }
                IncomingMessage::NameLeftBus(name) => {
                    if self.followed_names.get_mut().contains(&name) {
                        self.stop_following_departed(&name)?;
                        return Ok(self.pending_events.get_mut().pop_front());
                    }
                    // A name not followed, or one already reported: wait on.
                }
            }
        }
    }

    /// Replies to a call with one string.
    pub fn reply_with_string(&self, call: &IncomingCall, text: &str) -> Result<(), BusError> {
        if call.expects_reply() {
            zbus::block_on(self.connection.reply(&call.message.header(), &text))?;
        }
        Ok(())
    }

    /// Replies to a call with nothing.
    pub fn reply_empty(&self, call: &IncomingCall) -> Result<(), BusError> {
        if call.expects_reply() {
            zbus::block_on(self.connection.reply(&call.message.header(), &()))?;
        }
        Ok(())
    }

    /// Replies to a call with a D-Bus error and its message.
    pub fn reply_with_error(
        &self,
        call: &IncomingCall,
        error_name: &str,
        message: &str,
    ) -> Result<(), BusError> {
        if call.expects_reply() {
            let header = call.message.header();
            zbus::block_on(self.connection.reply_error(&header, error_name, &message))?;
        }
        Ok(())
    }

    /// Replies to a call with an empty `a{sv}`: `GetAll` of an interface with no properties.
    pub fn reply_with_empty_property_map(&self, call: &IncomingCall) -> Result<(), BusError> {
        if call.expects_reply() {
            let no_properties: HashMap<String, OwnedVariant> = HashMap::new();
            zbus::block_on(
                self.connection
                    .reply(&call.message.header(), &no_properties),
            )?;
        }
        Ok(())
    }

    /// Emits a signal of the program's interface, from its object, with one string.
    pub fn emit_string_signal(&self, signal_name: &str, text: &str) -> Result<(), BusError> {
        zbus::block_on(self.connection.emit_signal(
            None::<&str>,
            RESOURCE_PULSE_OBJECT_PATH,
            RESOURCE_PULSE_INTERFACE_NAME,
            signal_name,
            &text,
        ))?;
        Ok(())
    }

    /// From now on, the caller's disappearance from the bus arrives as BusEvent::NameVanished.
    ///
    /// The link keeps a set of the names it follows, not a count: following a name it already
    /// follows does nothing, and one [`BusLink::unfollow_name`] ends it however often it was
    /// followed. The program counts watches per caller (`ServiceFace`) and follows a caller from its
    /// first watch to its last.
    ///
    /// If the second round trip fails, the name stays in the followed set, and its match rule on the
    /// daemon, until the caller leaves: harmless, as its departure then drops no watch.
    pub fn follow_name(&self, unique_name: &str) -> Result<(), BusError> {
        if self.followed_names.borrow().contains(unique_name) {
            return Ok(());
        }
        self.call_bus_daemon(ADD_MATCH_METHOD_NAME, &name_left_bus_rule(unique_name)?)?;
        self.followed_names
            .borrow_mut()
            .insert(unique_name.to_owned());
        // A caller that left before the match was in place sent no signal the program will see,
        // so the bus is asked as well. If it leaves between the two, both report it, and
        // `followed_names` lets only the first through.
        let has_owner = self
            .call_bus_daemon(NAME_HAS_OWNER_METHOD_NAME, unique_name)?
            .body()
            .deserialize::<bool>()?;
        if !has_owner {
            self.stop_following_departed(unique_name)?;
        }
        Ok(())
    }

    /// Stops following a name; its departure is no longer reported.
    pub fn unfollow_name(&self, unique_name: &str) -> Result<(), BusError> {
        if !self.followed_names.borrow_mut().remove(unique_name) {
            return Ok(());
        }
        self.call_bus_daemon(REMOVE_MATCH_METHOD_NAME, &name_left_bus_rule(unique_name)?)?;
        Ok(())
    }

    /// Ends the following of a name that has left the bus: queues its NameVanished, then removes
    /// its match rule from the bus. The event is queued first, so that a failure to remove the
    /// rule, which is returned, does not lose it.
    fn stop_following_departed(&self, unique_name: &str) -> Result<(), BusError> {
        self.followed_names.borrow_mut().remove(unique_name);
        self.pending_events
            .borrow_mut()
            .push_back(BusEvent::NameVanished(unique_name.to_owned()));
        self.call_bus_daemon(REMOVE_MATCH_METHOD_NAME, &name_left_bus_rule(unique_name)?)?;
        Ok(())
    }

    /// Calls a method of the bus daemon with one string and waits for its reply, on this thread.
    fn call_bus_daemon(&self, method_name: &str, argument: &str) -> Result<Message, BusError> {
        let reply = zbus::block_on(self.connection.call_method(
            Some(BUS_DAEMON_NAME),
            BUS_DAEMON_OBJECT_PATH,
            Some(BUS_DAEMON_INTERFACE_NAME),
            method_name,
            &argument,
        ))?;
        Ok(reply)
    }
}

/// The match rule for the bus daemon's signal that `unique_name` changed owner.
fn name_left_bus_rule(unique_name: &str) -> Result<String, BusError> {
    let rule = MatchRule::builder()
        .msg_type(MessageType::Signal)
        .sender(BUS_DAEMON_NAME)
        .interface(BUS_DAEMON_INTERFACE_NAME)
        .member(NAME_OWNER_CHANGED_SIGNAL_NAME)
        .arg(0, unique_name)
        .build()?;
    Ok(rule.to_string())
}

/// How the stream ended, from the error that ended it, or `None` when it ended with none: the
/// connection closing for an end of file, a reset or a broken pipe (see
/// [`END_OF_CONNECTION_ERROR_KINDS`]); a failure, by the error's kind and never its text (which can
/// name an address), for any other error; and an end without the connection closing for no error,
/// as `zbus` reports the socket's end as an error before its streams end.
fn stream_end_of(ending_error: Option<&zbus::Error>) -> StreamEnd {
    match ending_error {
        Some(zbus::Error::InputOutput(io_error))
            if END_OF_CONNECTION_ERROR_KINDS.contains(&io_error.kind()) =>
        {
            StreamEnd::ConnectionClosed
        }
        Some(error) => StreamEnd::Failed(zbus_error_kind(error)),
        None => StreamEnd::EndedWithoutClose,
    }
}

/// The receiving thread: moves each message the program acts on from the stream into the
/// channel, each handed over by `hand_over` inside a catch, and says when the stream ends. It never
/// sends anything on the bus. `hand_over` is [`pass_on`] in the program; the rows give their own,
/// to make one message's handling panic.
fn forward_incoming_messages<IncomingStream>(
    incoming_stream: IncomingStream,
    message_sender: Sender<IncomingMessage>,
    hand_over: fn(Message) -> Option<IncomingMessage>,
) where
    IncomingStream: Stream<Item = zbus::Result<Message>>,
{
    zbus::block_on(async move {
        let mut incoming_stream = pin!(incoming_stream);
        loop {
            let next_item = poll_fn(|context| incoming_stream.as_mut().poll_next(context)).await;
            let incoming_message = match next_item {
                Some(Ok(message)) => match hand_over_inside_catch(message, hand_over) {
                    Some(incoming_message) => incoming_message,
                    None => continue,
                },
                // `zbus` ends the stream after its first read error, so an error is its end too.
                Some(Err(error)) => IncomingMessage::StreamEnded(stream_end_of(Some(&error))),
                None => IncomingMessage::StreamEnded(stream_end_of(None)),
            };
            let is_stream_end = matches!(incoming_message, IncomingMessage::StreamEnded(_));
            // A send fails only once the BusLink is gone, and then nobody is left to tell.
            if message_sender.send(incoming_message).is_err() || is_stream_end {
                return;
            }
        }
    });
}

/// Hands one message over inside a catch, so a message whose handling panics costs that message
/// alone: it becomes [`IncomingMessage::HandlingFailed`], carrying the call it was when it can still
/// be read as one (a panic in reading the call itself leaves none to answer).
fn hand_over_inside_catch(
    message: Message,
    hand_over: fn(Message) -> Option<IncomingMessage>,
) -> Option<IncomingMessage> {
    // A `Message` is a shared handle: the clone costs a count, and keeps the call to answer.
    let handed_over = catching_panic(|| hand_over(message.clone()));
    handed_over.unwrap_or_else(|panic_text| {
        Some(IncomingMessage::HandlingFailed(MessageFailure {
            panic_text,
            call: call_of_failed_message(message),
        }))
    })
}

/// The call a message whose handling failed was, read inside a catch: `None` for a message that is
/// not a call, or one that cannot be read as one either.
fn call_of_failed_message(message: Message) -> Option<IncomingCall> {
    let read_as_call = catching_panic(|| {
        (message.message_type() == MessageType::MethodCall)
            .then(|| IncomingCall::from_message(message))
    });
    read_as_call.ok().flatten()
}

/// The receiving end of the channel the receiving thread fills, and the stream's end once it has
/// come through it: the thread ends only after it has sent the stream's end, unless it died.
struct IncomingChannel {
    receiver: Receiver<IncomingMessage>,
    /// How the stream ended, once that has come through; given again on every later wait.
    stream_end: Option<StreamEnd>,
}

/// What one wait on the channel gave.
#[derive(Debug)]
enum Received {
    Message(IncomingMessage),
    TimedOut,
    /// The thread ended without sending the stream's end first: it died.
    ReceivingThreadEnded,
}

impl IncomingChannel {
    /// A channel whose stream has not ended.
    fn new(receiver: Receiver<IncomingMessage>) -> IncomingChannel {
        IncomingChannel {
            receiver,
            stream_end: None,
        }
    }

    /// The next message within `wait`, or why there is none: the wait passed, or the thread is
    /// gone. A thread gone after the stream's end is that same end again, never a death.
    fn receive(&mut self, wait: Duration) -> Received {
        match self.receiver.recv_timeout(wait) {
            Ok(incoming_message) => {
                if let IncomingMessage::StreamEnded(stream_end) = &incoming_message {
                    self.stream_end = Some(stream_end.clone());
                }
                Received::Message(incoming_message)
            }
            Err(RecvTimeoutError::Timeout) => Received::TimedOut,
            // The thread sends the stream's end before it ends, so its end with none sent first
            // is its death, and the connection may still be up.
            Err(RecvTimeoutError::Disconnected) => match &self.stream_end {
                Some(stream_end) => {
                    Received::Message(IncomingMessage::StreamEnded(stream_end.clone()))
                }
                None => Received::ReceivingThreadEnded,
            },
        }
    }
}

/// What of a message the program acts on: every method call, and the bus daemon's word that a
/// name has left. Replies are not passed on: `zbus` hands them to the call that awaits them.
fn pass_on(message: Message) -> Option<IncomingMessage> {
    match message.message_type() {
        MessageType::MethodCall => Some(IncomingMessage::Call(IncomingCall::from_message(message))),
        MessageType::Signal => name_left_bus(&message).map(IncomingMessage::NameLeftBus),
        MessageType::MethodReturn | MessageType::Error => None,
    }
}

/// The name a `NameOwnerChanged` from the bus daemon says has no owner any more, if the message
/// is one. Only the daemon's own signal counts: its sender cannot be forged, as the bus sets it.
fn name_left_bus(message: &Message) -> Option<String> {
    let header = message.header();
    let is_from_bus_daemon = header
        .sender()
        .is_some_and(|sender| sender.as_str() == BUS_DAEMON_NAME);
    let is_owner_change = header
        .interface()
        .is_some_and(|interface| interface.as_str() == BUS_DAEMON_INTERFACE_NAME)
        && header
            .member()
            .is_some_and(|member| member.as_str() == NAME_OWNER_CHANGED_SIGNAL_NAME);
    if !(is_from_bus_daemon && is_owner_change) {
        return None;
    }
    // The daemon's signal always has this body; one that did not would be dropped as unreadable.
    let (name, _old_owner, new_owner) = message
        .body()
        .deserialize::<(String, String, String)>()
        .ok()?;
    new_owner.is_empty().then_some(name)
}

#[cfg(test)]
mod tests;
