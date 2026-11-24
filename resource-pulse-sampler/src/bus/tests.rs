//! The receiving side without a bus: messages built in memory, as the bus would deliver them, an
//! in-memory stream in place of `zbus`'s, and a channel the test holds both ends of. The step that
//! hands a message over is the receiving thread's parameter, so a row can make it panic; the
//! program always passes [`pass_on`].

use std::collections::VecDeque;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use super::*;
use crate::caught_panic::install_panic_hook;

/// The caller every built call comes from, and the member whose handling a row makes panic.
const CALLER: &str = ":1.7";
const PANICKING_MEMBER: &str = "Boom";
/// A member handled as usual.
const ORDINARY_MEMBER: &str = "GetState";
/// What the planted panic says, and the file it is raised in.
const PLANTED_PANIC_MESSAGE: &str = "planted on the receiving thread";
const THIS_FILE: &str = "src/bus/tests.rs";
/// How long a row waits on its channel for something already sent.
const CHANNEL_WAIT: Duration = Duration::from_millis(100);

/// A call of the program's interface, from [`CALLER`], as the bus would deliver it.
fn call_message(member: &str) -> Message {
    Message::method_call(RESOURCE_PULSE_OBJECT_PATH, member)
        .sender(CALLER)
        .interface(RESOURCE_PULSE_INTERFACE_NAME)
        .build(&())
        .unwrap()
}

/// A signal of the program's interface.
fn signal_message() -> Message {
    Message::signal(
        RESOURCE_PULSE_OBJECT_PATH,
        RESOURCE_PULSE_INTERFACE_NAME,
        "Sample",
    )
    .build(&("{}",))
    .unwrap()
}

/// A hand-over step that panics for a message of [`PANICKING_MEMBER`] and is [`pass_on`] for any
/// other.
fn panicking_for_one_member(message: Message) -> Option<IncomingMessage> {
    let is_planted = message
        .header()
        .member()
        .is_some_and(|member| member.as_str() == PANICKING_MEMBER);
    if is_planted {
        panic!("{PLANTED_PANIC_MESSAGE}");
    }
    pass_on(message)
}

/// A hand-over step that panics for every message.
fn panicking_for_every_message(_message: Message) -> Option<IncomingMessage> {
    panic!("{PLANTED_PANIC_MESSAGE}")
}

/// A stream of messages held in memory, which ends when they run out.
struct MessagesThenEnd(VecDeque<zbus::Result<Message>>);

impl Stream for MessagesThenEnd {
    type Item = zbus::Result<Message>;

    /// The next message, or the end.
    fn poll_next(mut self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Poll::Ready(self.0.pop_front())
    }
}

/// One line for what the channel gave, to compare in assertions.
fn describe(received: Received) -> String {
    match received {
        Received::Message(IncomingMessage::Call(call)) => format!("Call({})", call.member),
        Received::Message(IncomingMessage::NameLeftBus(name)) => format!("NameLeftBus({name})"),
        Received::Message(IncomingMessage::HandlingFailed(failure)) => {
            let call_member = failure.call.map(|call| call.member);
            format!("HandlingFailed({call_member:?})")
        }
        Received::Message(IncomingMessage::StreamEnded(stream_end)) => {
            format!("StreamEnded({stream_end:?})")
        }
        Received::TimedOut => "TimedOut".to_string(),
        Received::ReceivingThreadEnded => "ReceivingThreadEnded".to_string(),
    }
}

/// A message whose handling panics is handed over as a failure: the panic's text with where it
/// happened, and, for a call, the call itself, to be answered; a signal has no call to answer.
#[test]
fn a_message_whose_handling_panics_is_handed_over_as_a_failure_with_its_call() {
    install_panic_hook();
    let from_call =
        hand_over_inside_catch(call_message(PANICKING_MEMBER), panicking_for_every_message);
    let from_signal = hand_over_inside_catch(signal_message(), panicking_for_every_message);
    let Some(IncomingMessage::HandlingFailed(call_failure)) = from_call else {
        panic!("the call's failure was not handed over: {from_call:?}");
    };
    let Some(IncomingMessage::HandlingFailed(signal_failure)) = from_signal else {
        panic!("the signal's failure was not handed over: {from_signal:?}");
    };
    let failed_call = call_failure.call.as_ref().map(|call| {
        (
            call.member.clone(),
            call.sender.clone(),
            call.expects_reply(),
        )
    });
    let (panic_message, panic_location) = call_failure.panic_text.rsplit_once(" at ").unwrap();
    assert_eq!(
        (
            failed_call,
            panic_message,
            panic_location.starts_with(&format!("{THIS_FILE}:")),
            signal_failure.call.is_none(),
        ),
        (
            Some((PANICKING_MEMBER.to_string(), CALLER.to_string(), true)),
            PLANTED_PANIC_MESSAGE,
            true,
            true
        )
    );
}

/// After a message whose handling panicked, the receiving loop goes on: the next call is handed
/// over as usual, and the stream's end after it (an in-memory stream that runs out ends with no
/// error).
#[test]
fn after_a_message_whose_handling_panics_the_next_one_is_handed_over() {
    install_panic_hook();
    let messages = MessagesThenEnd(VecDeque::from([
        Ok(call_message(PANICKING_MEMBER)),
        Ok(call_message(ORDINARY_MEMBER)),
    ]));
    let (message_sender, receiver) = mpsc::channel();
    forward_incoming_messages(messages, message_sender, panicking_for_one_member);
    let mut channel = IncomingChannel::new(receiver);
    let received: Vec<String> = (0..3)
        .map(|_| describe(channel.receive(CHANNEL_WAIT)))
        .collect();
    assert_eq!(
        received,
        [
            format!("HandlingFailed(Some({PANICKING_MEMBER:?}))"),
            format!("Call({ORDINARY_MEMBER})"),
            "StreamEnded(EndedWithoutClose)".to_string(),
        ]
    );
}

/// A receiving thread that ends without the stream having ended (it died) is its own event, not
/// the bus going away; once the stream's end has come through, the thread's end is that end again.
#[test]
fn a_receiving_thread_that_ends_before_its_stream_is_not_the_bus_going_away() {
    let (dying_sender, dying_receiver) = mpsc::channel::<IncomingMessage>();
    drop(dying_sender);
    let mut dying_channel = IncomingChannel::new(dying_receiver);
    let after_death = describe(dying_channel.receive(CHANNEL_WAIT));
    let (ending_sender, ending_receiver) = mpsc::channel();
    ending_sender
        .send(IncomingMessage::StreamEnded(StreamEnd::ConnectionClosed))
        .unwrap();
    drop(ending_sender);
    let mut ending_channel = IncomingChannel::new(ending_receiver);
    let after_end: Vec<String> = (0..2)
        .map(|_| describe(ending_channel.receive(CHANNEL_WAIT)))
        .collect();
    assert_eq!(
        (after_death, after_end),
        (
            "ReceivingThreadEnded".to_string(),
            vec![
                "StreamEnded(ConnectionClosed)".to_string(),
                "StreamEnded(ConnectionClosed)".to_string()
            ]
        )
    );
}

/// A bus address under a directory the rows make up, which a failure's text would print.
const MADE_UP_BUS_ADDRESS: &str = "unix:path=/made-up/runtime/bus";
const MADE_UP_DIRECTORY: &str = "/made-up/runtime";

/// A bus error's kind carries no text of the error's own: a failure to connect, whose text names
/// the address, and an address that is not valid, whose text quotes it, are each a kind with no
/// path in it; the error's own text, for contrast, has the path.
#[test]
fn a_bus_error_s_kind_names_no_address() {
    let address: zbus::Address = MADE_UP_BUS_ADDRESS.parse().unwrap();
    let connect_failure = BusError::Bus(zbus::Error::Connection(
        Arc::new(io::Error::from(io::ErrorKind::NotFound)),
        Box::new(address),
    ));
    let address_failure = BusError::Bus(zbus::Error::Address(MADE_UP_BUS_ADDRESS.to_string()));
    let kinds = [connect_failure.kind(), address_failure.kind()];
    assert_eq!(
        (
            connect_failure.to_string().contains(MADE_UP_DIRECTORY),
            kinds.clone(),
            kinds.iter().any(|kind| kind.contains(MADE_UP_DIRECTORY)),
        ),
        (
            true,
            [
                "cannot connect (NotFound)".to_string(),
                "the bus address is not valid".to_string()
            ],
            false
        )
    );
}

/// An I/O failure of `kind`, as `zbus` reports a failed read.
fn io_failure(kind: io::ErrorKind) -> zbus::Error {
    zbus::Error::InputOutput(Arc::new(io::Error::from(kind)))
}

/// The receiving thread run over a stream that ends at once, on `ending_error` or, with none, simply
/// ending, and what the channel then gives, twice: the end, and the end again once the thread is gone.
fn stream_end_given_twice(ending_error: Option<zbus::Error>) -> [String; 2] {
    let stream = MessagesThenEnd(ending_error.map(Err).into_iter().collect());
    let (message_sender, receiver) = mpsc::channel();
    forward_incoming_messages(stream, message_sender, pass_on);
    let mut channel = IncomingChannel::new(receiver);
    [(); 2].map(|()| describe(channel.receive(CHANNEL_WAIT)))
}

/// The stream's end on the socket's end of file, on a reset or on a broken pipe is the connection
/// closing, how a socket says the bus went away at a logout: no failure.
#[test]
fn a_stream_that_ends_on_an_end_of_file_a_reset_or_a_broken_pipe_is_the_connection_closing() {
    let end_of_connection_kinds = [
        io::ErrorKind::UnexpectedEof,
        io::ErrorKind::ConnectionReset,
        io::ErrorKind::BrokenPipe,
    ];
    let first_ends = end_of_connection_kinds
        .map(|kind| stream_end_given_twice(Some(io_failure(kind)))[0].clone());
    assert_eq!(
        first_ends,
        ["StreamEnded(ConnectionClosed)"; 3].map(String::from)
    );
}

/// The stream's end on any other error has failed, carrying the error's kind and never its text: an
/// I/O error that is not the connection ending by its `io::ErrorKind`, and an error that is not an
/// I/O error (an address that is not valid) by the program's own phrase. Both errors' own texts name
/// the made-up directory; neither kind does.
#[test]
fn a_stream_that_ends_on_any_other_error_has_failed_with_that_errors_kind() {
    // A read failure whose text names the made-up address, as a text from the bus could.
    let garbled_read_text = format!("garbled message from {MADE_UP_BUS_ADDRESS}");
    let other_errors = [
        zbus::Error::InputOutput(Arc::new(io::Error::new(
            io::ErrorKind::InvalidData,
            garbled_read_text,
        ))),
        zbus::Error::Address(MADE_UP_BUS_ADDRESS.to_string()),
    ];
    let do_error_texts_name_the_directory = other_errors
        .iter()
        .all(|error| error.to_string().contains(MADE_UP_DIRECTORY));
    let first_ends = other_errors.map(|error| stream_end_given_twice(Some(error))[0].clone());
    assert_eq!(
        (do_error_texts_name_the_directory, first_ends),
        (
            true,
            [
                r#"StreamEnded(Failed("I/O error (InvalidData)"))"#.to_string(),
                r#"StreamEnded(Failed("the bus address is not valid"))"#.to_string()
            ]
        )
    );
}

/// A stream that simply ends, with no error first, ended though the connection did not say it
/// closed: `zbus` reports the socket's end as an error before its streams end, so this end is not
/// the bus going away.
#[test]
fn a_stream_that_ends_with_no_error_ended_without_the_connection_closing() {
    assert_eq!(
        stream_end_given_twice(None)[0],
        "StreamEnded(EndedWithoutClose)"
    );
}

/// Once the stream's end has come through and the receiving thread is gone, the next wait gives
/// that same end again, whichever it was (what `BusLink::next_event` waits on), never a dead thread
/// and never another end.
#[test]
fn a_stream_end_is_given_again_as_it_was_first_given() {
    let ends_given_twice = [
        stream_end_given_twice(Some(io_failure(io::ErrorKind::UnexpectedEof))),
        stream_end_given_twice(Some(io_failure(io::ErrorKind::InvalidData))),
        stream_end_given_twice(None),
    ];
    assert_eq!(
        ends_given_twice,
        [
            ["StreamEnded(ConnectionClosed)"; 2].map(String::from),
            [r#"StreamEnded(Failed("I/O error (InvalidData)"))"#; 2].map(String::from),
            ["StreamEnded(EndedWithoutClose)"; 2].map(String::from),
        ]
    );
}
