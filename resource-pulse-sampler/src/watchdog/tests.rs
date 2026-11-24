use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use super::*;

/// How long a test waits for a datagram that is already on its way.
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(2);
/// Room for the datagram and more, so a longer one would show as longer.
const RECEIVE_BUFFER_BYTES: usize = 64;

/// A temporary directory of this test process, removed on drop.
struct TemporaryDirectory(PathBuf);

impl TemporaryDirectory {
    /// A fresh, empty directory under the temporary directory, named for the test.
    fn new(label: &str) -> TemporaryDirectory {
        let path = std::env::temp_dir().join(format!(
            "resource-pulse-watchdog-test-{}-{label}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        TemporaryDirectory(path)
    }
}

impl Drop for TemporaryDirectory {
    /// Removes the directory and the socket in it.
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// The one datagram a socket receives within the time-out.
fn receive_datagram(socket: &UnixDatagram) -> Vec<u8> {
    socket.set_read_timeout(Some(RECEIVE_TIMEOUT)).unwrap();
    let mut buffer = [0_u8; RECEIVE_BUFFER_BYTES];
    let received_length = socket.recv(&mut buffer).unwrap();
    buffer.get(..received_length).unwrap().to_vec()
}

/// A socket at a path and an abstract socket each receive `WATCHDOG=1`, given
/// as `NOTIFY_SOCKET` gives them.
#[test]
fn a_path_and_an_abstract_address_each_get_watchdog_1() {
    let directory = TemporaryDirectory::new("path");
    let socket_path = directory.0.join("notify");
    let path_socket = UnixDatagram::bind(&socket_path).unwrap();
    let abstract_name = format!("resource-pulse-watchdog-test-{}", std::process::id());
    let abstract_address = SocketAddr::from_abstract_name(abstract_name.as_bytes()).unwrap();
    let abstract_socket = UnixDatagram::bind_addr(&abstract_address).unwrap();
    let notify_socket_for_abstract = format!("@{abstract_name}");
    let outcomes = [
        notify_alive_at(Some(socket_path.as_os_str())).unwrap(),
        notify_alive_at(Some(OsStr::new(&notify_socket_for_abstract))).unwrap(),
    ];
    assert_eq!(
        (
            outcomes,
            receive_datagram(&path_socket),
            receive_datagram(&abstract_socket)
        ),
        (
            [Notification::Sent, Notification::Sent],
            b"WATCHDOG=1".to_vec(),
            b"WATCHDOG=1".to_vec()
        )
    );
}

/// With `NOTIFY_SOCKET` unset, or set to nothing, nothing is sent and nothing
/// fails.
#[test]
fn no_notify_socket_sends_nothing() {
    let outcomes = [
        notify_alive_at(None).unwrap(),
        notify_alive_at(Some(OsStr::new(""))).unwrap(),
    ];
    assert_eq!(
        outcomes,
        [Notification::NotRequested, Notification::NotRequested]
    );
}

/// A socket nobody listens on is an error for the caller to log, not a silent success.
#[test]
fn a_socket_nobody_listens_on_is_an_error() {
    let directory = TemporaryDirectory::new("nobody");
    let missing_socket_path = directory.0.join("nobody-listens");
    let outcome = notify_alive_at(Some(missing_socket_path.as_os_str()));
    assert!(outcome.is_err(), "{outcome:?}");
}
