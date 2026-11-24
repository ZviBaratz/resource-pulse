//! The bus link's rules, proved deterministically on a PRIVATE bus, where the end-to-end rows of
//! `gnome-shell/tests/sampler-program-dbus.test.js` cannot pin them:
//!
//! - the stream of incoming messages is open when `connect_listening()` returns, and no name is
//!   asked for until `request_name()` (the end-to-end start-up row catches asking for the name
//!   before opening the stream about once in 150 starts, as the window is microseconds wide);
//! - the name is asked for with "do not queue" only: it neither takes a name whose owner allows
//!   replacement nor waits in the queue behind the owner (no exit status can show the queue);
//! - a call flagged "no reply expected" gets no reply;
//! - a followed caller that had already left is reported, once, and an unfollowed one is not;
//! - the program exits 0 when its bus goes away after it owned the name, and writes no panic to stderr
//!   (the end-to-end twin of `gnome-shell/tests/sampler-program-dbus.test.js`'s rows has no place for
//!   a bus that dies, since it would stop the bus the other rows share);
//! - a stopped program releases the name, and nothing answers a call to it or to its connection
//!   (the counterpart of the gjs service's `destroy()`);
//! - the program tells systemd it is alive on each tick, at the socket `NOTIFY_SOCKET` names;
//! - the program initializes its sampler before it asks for the name, as the gjs service did, so
//!   a copy that loses the name has logged its start-up reads first.
//!
//! Every test is `#[ignore]`d, so a plain `cargo test` never runs one, on any bus.
//! `scripts/test-resource-pulse-sampler-bus.sh` runs each with `--ignored`, in a process and on a
//! private bus of its own under `dbus-run-session`, and each first refuses (fails) unless its bus
//! is that private one, by the test `gnome-shell/tests/privateBus.js` makes: a run that could not
//! prove its bus private fails, it never passes. The waits are bounds on a failure, never what a
//! pass relies on: each test orders the bus with round trips instead.

// Tests may unwrap, expect and panic: a failing test should say so loudly.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::env;
use std::fs;
use std::future::poll_fn;
use std::io::{BufRead, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};
use std::pin::pin;
use std::process::{ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

mod common;

use common::{
    fixture_root, read_stderr, wait_for_exit, ChildGuard, POLL_INTERVAL, PROGRAM_EXIT_TIMEOUT,
};
use futures_core::Stream;
use resource_pulse_sampler::bus::{BusEvent, BusLink, IncomingCall, NameOutcome};
use resource_pulse_sampler::constants::{
    RESOURCE_PULSE_BUS_NAME, RESOURCE_PULSE_INTERFACE_NAME, RESOURCE_PULSE_OBJECT_PATH,
};
use zbus::connection::Builder;
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::message::Flags;
use zbus::{Connection, DBusError, Message, MessageStream};

/// Names the directory the private bus listens in; the state table sets it.
const PRIVATE_BUS_DIRECTORY_VARIABLE: &str = "RESOURCE_PULSE_TEST_BUS_DIR";
const SESSION_BUS_ADDRESS_VARIABLE: &str = "DBUS_SESSION_BUS_ADDRESS";
const RUNTIME_DIRECTORY_VARIABLE: &str = "XDG_RUNTIME_DIR";
const PATH_SOCKET_ADDRESS_PREFIX: &str = "unix:path=";
/// Where the live session bus listens, under XDG_RUNTIME_DIR.
const LIVE_SESSION_BUS_SOCKET_NAME: &str = "bus";
/// What may lead an address that starts inside the bus directory out of it: an address list, a
/// parent segment, and a percent escape (D-Bus decodes them, so %2e%2e is ..).
const ADDRESS_ESCAPE_MARKERS: [&str; 3] = [";", "/../", "%"];
/// How long `next_event` may take to yield an event that is already on its way.
const QUEUED_EVENT_WAIT: Duration = Duration::from_secs(2);
/// How long a second report of the same departure is waited for, to be sure there is none.
const NO_SECOND_REPORT_WAIT: Duration = Duration::from_millis(500);
/// How long the bus may take to drop a name whose connection closed.
const NAME_RELEASED_TIMEOUT: Duration = Duration::from_secs(2);
/// How long a started program may take to own the name.
const NAME_OWNED_TIMEOUT: Duration = Duration::from_secs(5);
/// What the program logs once it owns the name and sampling has started, and when its bus then goes
/// away: the gjs service's two lines, word for word.
const SERVING_LOG_LINE: &str =
    "resource-pulse: serving io.github.zvibaratz.ResourcePulse1 (protocol 1)";
const SHUTTING_DOWN_LOG_LINE: &str = "resource-pulse: shutting down: lost \
    io.github.zvibaratz.ResourcePulse1: the bus connection closed";
/// How long a program that owns the name may take to say it is serving (its first tick comes
/// first), and how long its stderr may take to end once it has exited.
const SERVING_LINE_TIMEOUT: Duration = Duration::from_secs(5);
const STDERR_END_TIMEOUT: Duration = Duration::from_secs(2);
/// The method every row calls to see the program answer, and the errors the bus answers a call to a
/// name nobody owns, and to a connection that is gone, with (the bus gives both the same).
const GET_STATE_METHOD_NAME: &str = "GetState";
const SERVICE_UNKNOWN_ERROR_NAME: &str = "org.freedesktop.DBus.Error.ServiceUnknown";
/// The methods the tests' own calls name; the link hands any call over, known or not.
const EARLY_CALL_METHOD_NAME: &str = "EarlyCall";
const SILENT_CALL_METHOD_NAME: &str = "SilentCall";
const ANSWERED_CALL_METHOD_NAME: &str = "AnsweredCall";
/// The call the unrequested-reply control answers without it ever being sent.
const CONTROL_CALL_METHOD_NAME: &str = "NeverSentCall";
const BUS_DAEMON_NAME: &str = "org.freedesktop.DBus";
const BUS_DAEMON_OBJECT_PATH: &str = "/org/freedesktop/DBus";
const BUS_DAEMON_INTERFACE_NAME: &str = "org.freedesktop.DBus";
/// The bus daemon's method that says whether a name has an owner.
const NAME_HAS_OWNER_METHOD_NAME: &str = "NameHasOwner";
/// The bus daemon's method that says which unique name owns a name.
const GET_NAME_OWNER_METHOD_NAME: &str = "GetNameOwner";
/// The bus daemon's method that lists a name's owner and the connections queued for it.
const LIST_QUEUED_OWNERS_METHOD_NAME: &str = "ListQueuedOwners";
/// The bus daemon's method that answers its ID: a round trip with no effect.
const GET_ID_METHOD_NAME: &str = "GetId";
/// The program the second bus is, the program under test, and the second bus's files.
const DBUS_DAEMON_PROGRAM: &str = "dbus-daemon";
const SAMPLER_PROGRAM_PATH: &str = env!("CARGO_BIN_EXE_resource-pulse-sampler");
/// The flag that names the root the program reads under, and the fixture root it is given, so the
/// program never reads the host's `/proc`.
const FS_ROOT_FLAG: &str = "--fs-root";
const FIXTURE_ROOT_NAME: &str = "root-a";
const SECOND_BUS_DIRECTORY_PREFIX: &str = "second-bus-";
const SECOND_BUS_CONFIG_FILE_NAME: &str = "bus.conf";
/// A fixture root whose performance-core CPU list cannot be parsed: the sampler's `initialize` logs
/// it, and what the log line says about it.
const BAD_PMU_FIXTURE_ROOT_NAME: &str = "root-bad-pmu";
const INITIALIZE_LOG_TEXT: &str = "cannot parse ";
const BAD_PMU_FILE_SUFFIX: &str = "sys/devices/cpu_core/cpus";
/// What the program logs when the name is held by another: the gjs service's line, word for word.
const CANNOT_OWN_LOG_TEXT: &str = "shutting down: cannot own io.github.zvibaratz.ResourcePulse1";
/// The exit status of a copy that never owned the name.
const NAME_NOT_OWNED_EXIT_CODE: i32 = 1;
/// The variable that names systemd's notify socket, the socket the watchdog row binds in its bus's
/// directory, and the datagram it must receive on each tick, three times, each within the bound.
const NOTIFY_SOCKET_VARIABLE: &str = "NOTIFY_SOCKET";
const NOTIFY_SOCKET_FILE_NAME: &str = "notify";
const WATCHDOG_MESSAGE: &str = "WATCHDOG=1";
const WATCHDOG_DATAGRAM_COUNT: usize = 3;
const WATCHDOG_DATAGRAM_TIMEOUT: Duration = Duration::from_secs(2);
/// The tick interval the watchdog row runs the program at, and the flag that sets it.
const TICK_INTERVAL_FLAG: &str = "--tick-interval-ms";
const WATCHDOG_ROW_TICK_INTERVAL_MS: &str = "100";
/// Room for the datagram and more, so a longer one would show as longer.
const DATAGRAM_BUFFER_BYTES: usize = 64;
/// Owner-only, as the table's private bus directory is.
const PRIVATE_DIRECTORY_MODE: u32 = 0o700;

/// Panics unless `address` is provably on the private bus: one path socket inside the directory
/// `RESOURCE_PULSE_TEST_BUS_DIR` names, with nothing that could lead it out, and never the live
/// bus's socket under `XDG_RUNTIME_DIR`. The twin of `requirePrivateBusAddress`.
fn require_private_address(address: &str) {
    let bus_directory = env::var(PRIVATE_BUS_DIRECTORY_VARIABLE).unwrap_or_default();
    let address_prefix_inside = format!("{PATH_SOCKET_ADDRESS_PREFIX}{bus_directory}/");
    let is_inside_bus_directory =
        !bus_directory.is_empty() && address.starts_with(&address_prefix_inside);
    let is_live_bus = env::var(RUNTIME_DIRECTORY_VARIABLE).is_ok_and(|runtime_directory| {
        let live_bus_address_prefix = format!(
            "{PATH_SOCKET_ADDRESS_PREFIX}{runtime_directory}/{LIVE_SESSION_BUS_SOCKET_NAME}"
        );
        address.starts_with(&live_bus_address_prefix)
    });
    let can_lead_elsewhere = ADDRESS_ESCAPE_MARKERS
        .iter()
        .any(|marker| address.contains(marker));
    assert!(
        is_inside_bus_directory && !is_live_bus && !can_lead_elsewhere,
        "refusing to run: {address} is not a private bus inside \
         {PRIVATE_BUS_DIRECTORY_VARIABLE} ({bus_directory})"
    );
}

/// Panics unless the session bus, which every connection here goes to, is the private one.
fn require_private_bus_address() {
    let address = env::var(SESSION_BUS_ADDRESS_VARIABLE).unwrap_or_default();
    require_private_address(&address);
}

/// A second, plain connection to the (checked) private bus.
fn open_plain_connection() -> Connection {
    require_private_bus_address();
    zbus::block_on(Builder::session().build()).expect("a plain connection to the private bus")
}

/// A link on the (checked) private bus.
fn connect_link() -> BusLink {
    require_private_bus_address();
    BusLink::connect_listening().expect("connect_listening on the private bus")
}

/// A connection's unique name.
fn unique_name_of(connection: &Connection) -> String {
    connection
        .unique_name()
        .map(ToString::to_string)
        .expect("a bus connection has a unique name")
}

/// Calls a method of the bus daemon about `name` and waits for its reply.
fn ask_bus_daemon(connection: &Connection, method_name: &str, name: &str) -> Message {
    zbus::block_on(connection.call_method(
        Some(BUS_DAEMON_NAME),
        BUS_DAEMON_OBJECT_PATH,
        Some(BUS_DAEMON_INTERFACE_NAME),
        method_name,
        &name,
    ))
    .unwrap_or_else(|error| panic!("{method_name} failed: {error}"))
}

/// Whether `name` has an owner, as the bus daemon says.
fn name_has_owner(connection: &Connection, name: &str) -> bool {
    ask_bus_daemon(connection, NAME_HAS_OWNER_METHOD_NAME, name)
        .body()
        .deserialize::<bool>()
        .expect("NameHasOwner answers a boolean")
}

/// The unique name that owns `name`, as the bus daemon says.
fn name_owner(connection: &Connection, name: &str) -> String {
    ask_bus_daemon(connection, GET_NAME_OWNER_METHOD_NAME, name)
        .body()
        .deserialize::<String>()
        .expect("GetNameOwner answers a string")
}

/// The owner of `name` and the connections queued behind it, in queue order.
fn queued_owners(connection: &Connection, name: &str) -> Vec<String> {
    ask_bus_daemon(connection, LIST_QUEUED_OWNERS_METHOD_NAME, name)
        .body()
        .deserialize::<Vec<String>>()
        .expect("ListQueuedOwners answers a list of names")
}

/// A round trip to the bus daemon. When it returns, everything this connection sent before it
/// has been routed by the daemon.
fn round_trip_to_bus_daemon(connection: &Connection) {
    zbus::block_on(connection.call_method(
        Some(BUS_DAEMON_NAME),
        BUS_DAEMON_OBJECT_PATH,
        Some(BUS_DAEMON_INTERFACE_NAME),
        GET_ID_METHOD_NAME,
        &(),
    ))
    .expect("GetId answers");
}

/// Closes a connection, then waits until the bus has dropped its unique name.
fn close_and_wait_until_gone(connection: Connection, observer: &Connection) {
    let unique_name = unique_name_of(&connection);
    zbus::block_on(connection.close()).expect("the connection closes");
    let deadline = Instant::now() + NAME_RELEASED_TIMEOUT;
    while name_has_owner(observer, &unique_name) {
        assert!(
            Instant::now() < deadline,
            "{unique_name} is still on the bus {NAME_RELEASED_TIMEOUT:?} after it closed"
        );
        thread::sleep(POLL_INTERVAL);
    }
}

/// A method call of the program's interface to `destination`, flagged as given.
fn method_call_to(destination: &str, method_name: &str, flags: Flags) -> Message {
    Message::method_call(RESOURCE_PULSE_OBJECT_PATH, method_name)
        .destination(destination)
        .interface(RESOURCE_PULSE_INTERFACE_NAME)
        .with_flags(flags)
        .build(&())
        .unwrap_or_else(|error| panic!("{method_name} builds: {error}"))
}

/// Every message the connection receives from now on, through a channel a thread of its own
/// fills, so that the test can wait for one with a time-out.
fn forward_incoming_messages(connection: &Connection) -> Receiver<Message> {
    let incoming_stream = MessageStream::from(connection);
    let (message_sender, incoming_messages) = mpsc::channel();
    thread::spawn(move || {
        zbus::block_on(async move {
            let mut incoming_stream = pin!(incoming_stream);
            while let Some(Ok(message)) =
                poll_fn(|context| incoming_stream.as_mut().poll_next(context)).await
            {
                if message_sender.send(message).is_err() {
                    return;
                }
            }
        });
    });
    incoming_messages
}

/// Panics unless the bus passes a reply nobody asked for. A stock bus drops one, so on it the
/// no-reply test could not see a reply the link should not have sent, and would pass whatever the
/// link did; the table's private bus allows such replies. A helper sends the caller a reply to a
/// call it never made, and the caller must receive it.
fn require_unrequested_replies_pass(caller: &Connection, caller_messages: &Receiver<Message>) {
    let helper = open_plain_connection();
    let caller_unique_name = unique_name_of(caller);
    let never_sent_call = method_call_to(
        &caller_unique_name,
        CONTROL_CALL_METHOD_NAME,
        Flags::empty(),
    );
    let control_serial = never_sent_call.primary_header().serial_num();
    let unrequested_reply = Message::method_return(&never_sent_call.header())
        .destination(caller_unique_name)
        .build(&())
        .expect("the unrequested reply builds");
    zbus::block_on(helper.send(&unrequested_reply)).expect("the unrequested reply is sent");
    loop {
        let message = caller_messages.recv_timeout(QUEUED_EVENT_WAIT).expect(
            "could not run: this bus drops a reply nobody asked for, so it cannot show one",
        );
        if message.header().reply_serial() == Some(control_serial) {
            return;
        }
    }
}

/// One line for an event, to compare in assertions.
fn describe(event: Option<BusEvent>) -> String {
    match event {
        Some(BusEvent::Call(call)) => format!("Call({})", call.member),
        Some(BusEvent::NameVanished(name)) => format!("NameVanished({name})"),
        Some(BusEvent::MessageFailed(failure)) => format!("MessageFailed({})", failure.panic_text),
        Some(BusEvent::Disconnected(_)) => "Disconnected".to_owned(),
        Some(BusEvent::ReceivingThreadEnded) => "ReceivingThreadEnded".to_owned(),
        None => "nothing".to_owned(),
    }
}

/// The next event, which must be a call of `method_name`.
fn expect_call(bus_link: &mut BusLink, method_name: &str) -> IncomingCall {
    match bus_link.next_event(QUEUED_EVENT_WAIT) {
        Ok(Some(BusEvent::Call(call))) if call.member == method_name => call,
        Ok(other) => panic!("expected a call of {method_name}, got {}", describe(other)),
        Err(error) => panic!("next_event failed: {error}"),
    }
}

/// A `dbus-daemon` of the test's own, in a directory inside the private bus's, so that its
/// address passes the same check. It is killed when the test lets go of it.
struct SecondBusDaemon {
    daemon: ChildGuard,
    address: String,
    directory: PathBuf,
    /// Held open, so the daemon never writes to a closed pipe.
    _address_pipe: BufReader<ChildStdout>,
}

impl SecondBusDaemon {
    /// Starts the daemon and reads the address it listens on.
    fn start() -> SecondBusDaemon {
        let bus_directory = env::var(PRIVATE_BUS_DIRECTORY_VARIABLE).expect("a private bus");
        let directory_name = format!("{SECOND_BUS_DIRECTORY_PREFIX}{}", std::process::id());
        let directory = Path::new(&bus_directory).join(directory_name);
        fs::create_dir(&directory).expect("the second bus's directory is created");
        fs::set_permissions(
            &directory,
            fs::Permissions::from_mode(PRIVATE_DIRECTORY_MODE),
        )
        .expect("the second bus's directory is made owner-only");
        let config_path = directory.join(SECOND_BUS_CONFIG_FILE_NAME);
        fs::write(&config_path, second_bus_config(&directory)).expect("the config is written");
        let config_argument = format!("--config-file={}", config_path.display());
        let mut daemon = ChildGuard(
            Command::new(DBUS_DAEMON_PROGRAM)
                .args([config_argument.as_str(), "--nofork", "--print-address=1"])
                .stdout(Stdio::piped())
                .spawn()
                .expect("dbus-daemon starts"),
        );
        let mut address_pipe = BufReader::new(daemon.0.stdout.take().expect("a stdout pipe"));
        let mut address_line = String::new();
        address_pipe
            .read_line(&mut address_line)
            .expect("dbus-daemon prints its address");
        let address = address_line.trim().to_owned();
        require_private_address(&address);
        SecondBusDaemon {
            daemon,
            address,
            directory,
            _address_pipe: address_pipe,
        }
    }

    /// Kills the daemon, as a logout ends the session bus under a running program.
    fn kill(&mut self) {
        self.daemon.0.kill().expect("the second bus is killed");
        self.daemon.0.wait().expect("the second bus is reaped");
    }
}

impl Drop for SecondBusDaemon {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

/// The second bus's configuration: the table's private bus, listening in `directory`.
fn second_bus_config(directory: &Path) -> String {
    format!(
        r#"<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:dir={}</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*"/>
    <allow receive_sender="*"/>
    <allow own="*"/>
  </policy>
</busconfig>
"#,
        directory.display()
    )
}

// Every reason below is a literal, as `#[ignore]` requires; all give the same one.

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn connect_listening_delivers_a_call_sent_before_any_name() {
    require_private_bus_address();
    let mut bus_link = connect_link();
    let caller = open_plain_connection();
    let caller_unique_name = unique_name_of(&caller);
    let link_unique_name = bus_link.unique_name().to_owned();
    assert!(!link_unique_name.is_empty(), "the link has no unique name");
    // No name is requested: the call is addressed to the link's unique name, and sent without
    // waiting for a reply.
    let early_call = method_call_to(&link_unique_name, EARLY_CALL_METHOD_NAME, Flags::empty());
    zbus::block_on(caller.send(&early_call)).expect("the early call is sent");
    // The caller's round trip returns once the daemon has routed the early call to the link. The
    // link's own round trip (follow_name asks the daemon twice) then returns with a reply that sat
    // behind the early call on the link's socket: by then the socket reader has handled the call,
    // and dropped it if nothing was listening, whatever the load. next_event comes only after.
    round_trip_to_bus_daemon(&caller);
    bus_link
        .follow_name(&caller_unique_name)
        .expect("follow_name round-trips to the daemon");
    let call = expect_call(&mut bus_link, EARLY_CALL_METHOD_NAME);
    assert_eq!(call.sender, caller_unique_name);
    bus_link.reply_empty(&call).expect("the reply is sent");
}

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn connect_listening_requests_no_name() {
    require_private_bus_address();
    let bus_link = connect_link();
    let observer = open_plain_connection();
    let has_owner_after_connect = name_has_owner(&observer, RESOURCE_PULSE_BUS_NAME);
    let outcome = bus_link
        .request_name(RESOURCE_PULSE_BUS_NAME)
        .expect("request_name does not fail");
    let has_owner_after_request = name_has_owner(&observer, RESOURCE_PULSE_BUS_NAME);
    let owner_after_request = name_owner(&observer, RESOURCE_PULSE_BUS_NAME);
    assert_eq!(
        (
            has_owner_after_connect,
            outcome,
            has_owner_after_request,
            owner_after_request.as_str()
        ),
        (false, NameOutcome::Owned, true, bus_link.unique_name())
    );
}

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn request_name_does_not_take_a_name_whose_owner_allows_replacement() {
    require_private_bus_address();
    let bus_link = connect_link();
    let helper = open_plain_connection();
    // An owner that allows replacement: only a request with REPLACE_EXISTING could take it over.
    let helper_reply = zbus::block_on(helper.request_name_with_flags(
        RESOURCE_PULSE_BUS_NAME,
        RequestNameFlags::ALLOW_REPLACEMENT | RequestNameFlags::DO_NOT_QUEUE,
    ))
    .expect("the helper asks for the name");
    assert_eq!(helper_reply, RequestNameReply::PrimaryOwner);
    let outcome = bus_link
        .request_name(RESOURCE_PULSE_BUS_NAME)
        .expect("request_name does not fail");
    assert_eq!(
        (outcome, name_owner(&helper, RESOURCE_PULSE_BUS_NAME)),
        (NameOutcome::HeldByAnother, unique_name_of(&helper))
    );
}

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn request_name_does_not_queue_behind_the_owner() {
    require_private_bus_address();
    let bus_link = connect_link();
    let helper = open_plain_connection();
    let helper_reply = zbus::block_on(
        helper.request_name_with_flags(RESOURCE_PULSE_BUS_NAME, RequestNameFlags::DO_NOT_QUEUE),
    )
    .expect("the helper asks for the name");
    assert_eq!(helper_reply, RequestNameReply::PrimaryOwner);
    let outcome = bus_link
        .request_name(RESOURCE_PULSE_BUS_NAME)
        .expect("request_name does not fail");
    // Asked while the link is still connected: a queued link would be listed after the helper.
    assert_eq!(
        (outcome, queued_owners(&helper, RESOURCE_PULSE_BUS_NAME)),
        (NameOutcome::HeldByAnother, vec![unique_name_of(&helper)])
    );
}

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn a_call_flagged_no_reply_expected_gets_no_reply() {
    require_private_bus_address();
    let mut bus_link = connect_link();
    let caller = open_plain_connection();
    let caller_messages = forward_incoming_messages(&caller);
    require_unrequested_replies_pass(&caller, &caller_messages);
    let link_unique_name = bus_link.unique_name().to_owned();
    let silent_call = method_call_to(
        &link_unique_name,
        SILENT_CALL_METHOD_NAME,
        Flags::NO_REPLY_EXPECTED,
    );
    let answered_call =
        method_call_to(&link_unique_name, ANSWERED_CALL_METHOD_NAME, Flags::empty());
    zbus::block_on(caller.send(&silent_call)).expect("the silent call is sent");
    zbus::block_on(caller.send(&answered_call)).expect("the answered call is sent");
    for method_name in [SILENT_CALL_METHOD_NAME, ANSWERED_CALL_METHOD_NAME] {
        let call = expect_call(&mut bus_link, method_name);
        bus_link
            .reply_empty(&call)
            .expect("reply_empty does not fail");
    }
    // The link answered in this order, so a reply to the silent call would arrive first.
    let silent_serial = silent_call.primary_header().serial_num();
    let answered_serial = answered_call.primary_header().serial_num();
    let mut serials_replied_to = Vec::new();
    loop {
        let message = caller_messages
            .recv_timeout(QUEUED_EVENT_WAIT)
            .expect("the answered call's reply arrives");
        let Some(reply_serial) = message.header().reply_serial() else {
            continue;
        };
        if reply_serial == silent_serial || reply_serial == answered_serial {
            serials_replied_to.push(reply_serial);
        }
        if reply_serial == answered_serial {
            break;
        }
    }
    assert_eq!(serials_replied_to, vec![answered_serial]);
}

/// What each reply method of the link is called with to answer a call, for the row that holds all of
/// them to the "no reply expected" flag.
type ReplyMethod = fn(&BusLink, &IncomingCall);

/// The error name and message a call is answered with in the row below.
const SILENT_ERROR_NAME: &str = "io.github.zvibaratz.ResourcePulse1.Failed";
const SILENT_ERROR_MESSAGE: &str = "never to be seen";

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn every_reply_method_sends_nothing_to_a_call_flagged_no_reply_expected() {
    require_private_bus_address();
    let mut bus_link = connect_link();
    let caller = open_plain_connection();
    let caller_messages = forward_incoming_messages(&caller);
    require_unrequested_replies_pass(&caller, &caller_messages);
    let link_unique_name = bus_link.unique_name().to_owned();
    // One silent call for each way the link replies, then one that wants its answer.
    let reply_methods: [(&str, ReplyMethod); 4] = [
        ("SilentWithString", |link, call| {
            link.reply_with_string(call, "text")
                .expect("reply_with_string does not fail");
        }),
        ("SilentWithError", |link, call| {
            link.reply_with_error(call, SILENT_ERROR_NAME, SILENT_ERROR_MESSAGE)
                .expect("reply_with_error does not fail");
        }),
        ("SilentWithPropertyMap", |link, call| {
            link.reply_with_empty_property_map(call)
                .expect("reply_with_empty_property_map does not fail");
        }),
        ("SilentWithNothing", |link, call| {
            link.reply_empty(call).expect("reply_empty does not fail");
        }),
    ];
    let mut silent_serials = Vec::new();
    for (method_name, _) in &reply_methods {
        let silent_call = method_call_to(&link_unique_name, method_name, Flags::NO_REPLY_EXPECTED);
        silent_serials.push(silent_call.primary_header().serial_num());
        zbus::block_on(caller.send(&silent_call)).expect("the silent call is sent");
    }
    let answered_call =
        method_call_to(&link_unique_name, ANSWERED_CALL_METHOD_NAME, Flags::empty());
    zbus::block_on(caller.send(&answered_call)).expect("the answered call is sent");
    for (method_name, reply_method) in &reply_methods {
        let call = expect_call(&mut bus_link, method_name);
        reply_method(&bus_link, &call);
    }
    let answered_call_received = expect_call(&mut bus_link, ANSWERED_CALL_METHOD_NAME);
    bus_link
        .reply_empty(&answered_call_received)
        .expect("reply_empty does not fail");
    // The link answered in this order, so a reply to any silent call would arrive before this one.
    let answered_serial = answered_call.primary_header().serial_num();
    let mut serials_replied_to = Vec::new();
    loop {
        let message = caller_messages
            .recv_timeout(QUEUED_EVENT_WAIT)
            .expect("the answered call's reply arrives");
        let Some(reply_serial) = message.header().reply_serial() else {
            continue;
        };
        if reply_serial == answered_serial || silent_serials.contains(&reply_serial) {
            serials_replied_to.push(reply_serial);
        }
        if reply_serial == answered_serial {
            break;
        }
    }
    assert_eq!(serials_replied_to, vec![answered_serial]);
}

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn follow_name_reports_a_caller_that_already_left_once() {
    require_private_bus_address();
    let mut bus_link = connect_link();
    let observer = open_plain_connection();
    let departed_caller = open_plain_connection();
    let departed_name = unique_name_of(&departed_caller);
    // Gone before it is followed: no NameOwnerChanged can reach the link's match for it.
    close_and_wait_until_gone(departed_caller, &observer);
    bus_link
        .follow_name(&departed_name)
        .expect("follow_name does not fail");
    let first_event = describe(bus_link.next_event(QUEUED_EVENT_WAIT).expect("next_event"));
    let second_event = describe(
        bus_link
            .next_event(NO_SECOND_REPORT_WAIT)
            .expect("next_event"),
    );
    assert_eq!(
        [first_event, second_event],
        [
            format!("NameVanished({departed_name})"),
            "nothing".to_owned()
        ]
    );
}

#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn unfollow_name_stops_reporting_that_caller() {
    require_private_bus_address();
    let mut bus_link = connect_link();
    let observer = open_plain_connection();
    let unfollowed_caller = open_plain_connection();
    let followed_caller = open_plain_connection();
    let unfollowed_name = unique_name_of(&unfollowed_caller);
    let followed_name = unique_name_of(&followed_caller);
    for name in [&unfollowed_name, &followed_name] {
        bus_link
            .follow_name(name)
            .expect("follow_name does not fail");
    }
    bus_link
        .unfollow_name(&unfollowed_name)
        .expect("unfollow_name does not fail");
    // The unfollowed caller leaves first, and is gone before the other leaves: were it still
    // followed, its departure would be the first event.
    close_and_wait_until_gone(unfollowed_caller, &observer);
    close_and_wait_until_gone(followed_caller, &observer);
    let first_event = describe(bus_link.next_event(QUEUED_EVENT_WAIT).expect("next_event"));
    assert_eq!(first_event, format!("NameVanished({followed_name})"));
}

/// Starts the program over the fixture root on the second bus, with these further arguments and
/// variables, its stderr piped; then waits until it owns the name, failing if it exits first or
/// takes too long.
fn start_program_owning_the_name(
    second_bus: &SecondBusDaemon,
    further_arguments: &[&str],
    further_variables: &[(&str, &Path)],
) -> ChildGuard {
    let mut command = Command::new(SAMPLER_PROGRAM_PATH);
    common::pin_data_directories(&mut command);
    command
        .arg(FS_ROOT_FLAG)
        .arg(fixture_root(FIXTURE_ROOT_NAME))
        .args(further_arguments)
        .env(SESSION_BUS_ADDRESS_VARIABLE, &second_bus.address)
        .stderr(Stdio::piped());
    for (name, value) in further_variables {
        command.env(name, value);
    }
    let mut program = ChildGuard(command.spawn().expect("the program starts"));
    let observer = zbus::block_on(Builder::address(second_bus.address.as_str()).build())
        .expect("a connection to the second bus");
    let owned_deadline = Instant::now() + NAME_OWNED_TIMEOUT;
    while !name_has_owner(&observer, RESOURCE_PULSE_BUS_NAME) {
        let early_exit = program.0.try_wait().expect("the program can be waited for");
        assert!(
            early_exit.is_none(),
            "the program exited ({early_exit:?}) before it owned the name"
        );
        assert!(
            Instant::now() < owned_deadline,
            "the program never owned the name"
        );
        thread::sleep(POLL_INTERVAL);
    }
    program
}

/// The program, serving on a bus of its own that is then killed, as a logout ends the session bus,
/// ends cleanly: it exits 0, and its stderr is exactly the gjs service's "serving" line and its
/// line for the bus going away, in that order, and nothing else. An end of file is how the socket
/// says the bus went away, so no line calls it a failure; and a panic anywhere (on the receiving
/// thread, say) writes a line of its own through the program's hook, which this row would see.
#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn program_exits_0_when_its_bus_goes_away() {
    require_private_bus_address();
    let mut second_bus = SecondBusDaemon::start();
    let mut program = start_program_owning_the_name(&second_bus, &[], &[]);
    let stderr_lines = forward_stderr_lines(&mut program);
    // The "serving" line follows the first tick's Sample, and the next tick is 2 s away, so no
    // Sample is being sent when the bus dies.
    let mut logged_lines = lines_until(&stderr_lines, SERVING_LOG_LINE);
    // Only the test's own daemon is killed; the bus the other tests use is never touched.
    second_bus.kill();
    let ending = wait_for_exit_status_text(&mut program, "its bus went away");
    logged_lines.extend(remaining_lines(&stderr_lines));
    assert_eq!(
        (ending.as_str(), logged_lines),
        (
            "exit status: 0",
            vec![
                SERVING_LOG_LINE.to_owned(),
                SHUTTING_DOWN_LOG_LINE.to_owned()
            ]
        )
    );
}

/// The lines a program writes to its stderr, read on a thread of their own as they come, so that a
/// test can wait for one with a time-out; the channel closes when the program's stderr ends.
fn forward_stderr_lines(program: &mut ChildGuard) -> Receiver<String> {
    let stderr = program.0.stderr.take().expect("a stderr pipe");
    let (line_sender, stderr_lines) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { return };
            if line_sender.send(line).is_err() {
                return;
            }
        }
    });
    stderr_lines
}

/// Every line up to and including `wanted_line`, failing if it has not come within
/// `SERVING_LINE_TIMEOUT` or the stderr ended before it.
fn lines_until(stderr_lines: &Receiver<String>, wanted_line: &str) -> Vec<String> {
    let deadline = Instant::now() + SERVING_LINE_TIMEOUT;
    let mut lines = Vec::new();
    loop {
        let remaining_wait = deadline.saturating_duration_since(Instant::now());
        let line = stderr_lines
            .recv_timeout(remaining_wait)
            .unwrap_or_else(|error| {
                panic!("no {wanted_line:?} on stderr ({error}); the lines before were {lines:?}")
            });
        let is_wanted_line = line == wanted_line;
        lines.push(line);
        if is_wanted_line {
            return lines;
        }
    }
}

/// The lines left on the stderr of a program that has exited, failing if it has not ended within
/// `STDERR_END_TIMEOUT`.
fn remaining_lines(stderr_lines: &Receiver<String>) -> Vec<String> {
    let deadline = Instant::now() + STDERR_END_TIMEOUT;
    let mut lines = Vec::new();
    loop {
        let remaining_wait = deadline.saturating_duration_since(Instant::now());
        match stderr_lines.recv_timeout(remaining_wait) {
            Ok(line) => lines.push(line),
            Err(mpsc::RecvTimeoutError::Disconnected) => return lines,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                panic!("stderr had not ended {STDERR_END_TIMEOUT:?} after the exit: {lines:?}")
            }
        }
    }
}

/// Waits for the program to exit, and says how it ended (`exit status: 0`), or that it was still
/// running `PROGRAM_EXIT_TIMEOUT` after `cause`.
fn wait_for_exit_status_text(program: &mut ChildGuard, cause: &str) -> String {
    wait_for_exit(program).map_or_else(
        || format!("still running {PROGRAM_EXIT_TIMEOUT:?} after {cause}"),
        |status| format!("{status}"),
    )
}

/// A program that is stopped, as systemd stops it (SIGTERM), exits and releases the name; a call to
/// the name or to its old connection is then answered by the bus, as an error, and by nobody else.
/// The program has no `destroy()`: its object and its watches live in its process, so the process
/// ending is the object leaving the bus. It holds no sampler listener either, for it has none.
///
#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn program_releases_the_name_and_answers_nothing_once_it_stops() {
    require_private_bus_address();
    let second_bus = SecondBusDaemon::start();
    let mut program = start_program_owning_the_name(&second_bus, &[], &[]);
    let observer = zbus::block_on(Builder::address(second_bus.address.as_str()).build())
        .expect("a connection to the second bus");
    let former_owner = name_owner(&observer, RESOURCE_PULSE_BUS_NAME);
    let state_before_stop = call_get_state(&observer, RESOURCE_PULSE_BUS_NAME);
    send_terminate_signal(&program);
    let ending = wait_for_exit_status_text(&mut program, "SIGTERM");
    assert_eq!(ending, "signal: 15 (SIGTERM)", "the program did not stop");
    wait_until_name_is_free(&observer);
    let state_after_stop = call_get_state(&observer, RESOURCE_PULSE_BUS_NAME);
    let state_from_former_owner = call_get_state(&observer, &former_owner);
    assert_eq!(
        (
            state_before_stop
                .as_deref()
                .map(|text| text.starts_with('{')),
            ending.as_str(),
            state_after_stop,
            state_from_former_owner,
        ),
        (
            Ok(true),
            "signal: 15 (SIGTERM)",
            Err(SERVICE_UNKNOWN_ERROR_NAME.to_owned()),
            Err(SERVICE_UNKNOWN_ERROR_NAME.to_owned()),
        )
    );
}

/// Sends SIGTERM to the program, through `kill(1)`: the standard library only kills.
fn send_terminate_signal(program: &ChildGuard) {
    let killed = Command::new("kill")
        .args(["-TERM", &program.0.id().to_string()])
        .status()
        .expect("kill runs");
    assert!(killed.success(), "kill -TERM failed: {killed}");
}

/// Waits until the bus says the program's name has no owner.
fn wait_until_name_is_free(observer: &Connection) {
    let deadline = Instant::now() + NAME_RELEASED_TIMEOUT;
    while name_has_owner(observer, RESOURCE_PULSE_BUS_NAME) {
        assert!(
            Instant::now() < deadline,
            "the name still has an owner {NAME_RELEASED_TIMEOUT:?} after the program exited"
        );
        thread::sleep(POLL_INTERVAL);
    }
}

/// `GetState` called on `destination`: the reply's text, or the name of the error reply the bus or
/// the program answered with (any other failure panics, so a time-out is never read as an answer).
fn call_get_state(connection: &Connection, destination: &str) -> Result<String, String> {
    let reply = zbus::block_on(connection.call_method(
        Some(destination),
        RESOURCE_PULSE_OBJECT_PATH,
        Some(RESOURCE_PULSE_INTERFACE_NAME),
        GET_STATE_METHOD_NAME,
        &(),
    ));
    match reply {
        Ok(message) => Ok(message
            .body()
            .deserialize::<String>()
            .expect("GetState answers a string")),
        // The bus's own errors (no such name) arrive as `fdo` errors, the program's as method errors.
        Err(zbus::Error::FDO(bus_error)) => Err(bus_error.name().to_string()),
        Err(zbus::Error::MethodError(error_name, _, _)) => Err(error_name.to_string()),
        Err(other) => panic!("GetState to {destination} failed in another way: {other}"),
    }
}

/// The program, serving on its own bus with `NOTIFY_SOCKET` naming a socket the test bound, sends
/// `WATCHDOG=1` there on each tick: three in a row, each within the bound.
#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn program_tells_the_watchdog_it_is_alive_on_each_tick() {
    require_private_bus_address();
    let second_bus = SecondBusDaemon::start();
    let notify_socket_path = second_bus.directory.join(NOTIFY_SOCKET_FILE_NAME);
    let notify_socket = UnixDatagram::bind(&notify_socket_path).expect("the notify socket binds");
    notify_socket
        .set_read_timeout(Some(WATCHDOG_DATAGRAM_TIMEOUT))
        .expect("the notify socket takes a time-out");
    let _program = start_program_owning_the_name(
        &second_bus,
        &[TICK_INTERVAL_FLAG, WATCHDOG_ROW_TICK_INTERVAL_MS],
        &[(NOTIFY_SOCKET_VARIABLE, &notify_socket_path)],
    );
    let datagrams: Vec<String> = (0..WATCHDOG_DATAGRAM_COUNT)
        .map(|_| {
            let mut buffer = [0_u8; DATAGRAM_BUFFER_BYTES];
            let received_length = notify_socket
                .recv(&mut buffer)
                .expect("a watchdog datagram within the time-out");
            let received_bytes = buffer.get(..received_length).expect("within the buffer");
            String::from_utf8_lossy(received_bytes).into_owned()
        })
        .collect();
    assert_eq!(datagrams, vec![WATCHDOG_MESSAGE; WATCHDOG_DATAGRAM_COUNT]);
}

/// The program initializes its sampler before it asks for the name (as the gjs service called
/// `initialize` before `bus_own_name`): a copy started while another connection holds the name
/// exits 1, and its stderr holds `initialize`'s line about the unparseable CPU list before its
/// "cannot own" line. Were `initialize` after the name, that copy would exit before reading
/// anything.
#[test]
#[ignore = "private bus only: scripts/test-resource-pulse-sampler-bus.sh runs it"]
fn program_initializes_before_it_asks_for_the_name() {
    require_private_bus_address();
    let second_bus = SecondBusDaemon::start();
    let name_holder = zbus::block_on(Builder::address(second_bus.address.as_str()).build())
        .expect("a connection to the second bus");
    let holder_reply = zbus::block_on(
        name_holder
            .request_name_with_flags(RESOURCE_PULSE_BUS_NAME, RequestNameFlags::DO_NOT_QUEUE),
    )
    .expect("the holder asks for the name");
    assert_eq!(holder_reply, RequestNameReply::PrimaryOwner);
    let mut program_command = Command::new(SAMPLER_PROGRAM_PATH);
    common::pin_data_directories(&mut program_command);
    let mut program = ChildGuard(
        program_command
            .arg(FS_ROOT_FLAG)
            .arg(fixture_root(BAD_PMU_FIXTURE_ROOT_NAME))
            .env(SESSION_BUS_ADDRESS_VARIABLE, &second_bus.address)
            .stderr(Stdio::piped())
            .spawn()
            .expect("the program starts"),
    );
    let exit_status = wait_for_exit(&mut program);
    assert!(
        exit_status.is_some(),
        "the program still runs {PROGRAM_EXIT_TIMEOUT:?} after it could not own the name"
    );
    let exit_code = exit_status.and_then(|status| status.code());
    let logged_text = read_stderr(&mut program);
    let line_number_of = |is_wanted: &dyn Fn(&str) -> bool| logged_text.lines().position(is_wanted);
    let initialize_line = line_number_of(&|line| {
        line.contains(INITIALIZE_LOG_TEXT) && line.contains(BAD_PMU_FILE_SUFFIX)
    });
    let cannot_own_line = line_number_of(&|line| line.contains(CANNOT_OWN_LOG_TEXT));
    let is_initialize_logged_first = matches!(
        (initialize_line, cannot_own_line),
        (Some(initialize), Some(cannot_own)) if initialize < cannot_own
    );
    assert!(
        exit_code == Some(NAME_NOT_OWNED_EXIT_CODE) && is_initialize_logged_first,
        "exit {exit_code:?}; stderr was {logged_text:?}"
    );
}
