//! systemd's watchdog, by hand and without libsystemd: one datagram, `WATCHDOG=1`, to the socket
//! that `NOTIFY_SOCKET` names. The program sends it on every tick, and its unit
//! (`systemd/resource-pulse.service`) sets `WatchdogSec=`: after that long without a datagram,
//! systemd kills the program and `Restart=always` starts it again.
//!
//! systemd gives the socket as a path (`/run/user/1000/systemd/notify`) or as an abstract name
//! written with a leading `@`; both are handled. Outside a unit the variable is unset, and nothing is
//! sent.

use std::ffi::OsStr;
use std::io;
use std::os::linux::net::SocketAddrExt;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::net::{SocketAddr, UnixDatagram};
use std::path::Path;

/// The variable systemd sets to the socket its service is to notify.
const NOTIFY_SOCKET_VARIABLE: &str = "NOTIFY_SOCKET";
/// The datagram that tells systemd the service is alive.
const WATCHDOG_MESSAGE: &[u8] = b"WATCHDOG=1";
/// What leads a notify socket address that names an abstract socket.
const ABSTRACT_ADDRESS_MARKER: u8 = b'@';

/// What a call of [`notify_alive`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Notification {
    /// `WATCHDOG=1` was sent.
    Sent,
    /// `NOTIFY_SOCKET` is unset or empty: no manager asked, so nothing was sent.
    NotRequested,
}

/// Tells systemd the program is alive: sends `WATCHDOG=1` to `$NOTIFY_SOCKET`, a path or an
/// abstract name starting with `@`, and does nothing when it is unset. A send that fails is
/// returned, for the caller to log; the program goes on either way.
pub fn notify_alive() -> io::Result<Notification> {
    let notify_socket = std::env::var_os(NOTIFY_SOCKET_VARIABLE);
    notify_alive_at(notify_socket.as_deref())
}

/// [`notify_alive`] with the variable's value handed in.
fn notify_alive_at(notify_socket: Option<&OsStr>) -> io::Result<Notification> {
    let Some(notify_socket) = notify_socket.filter(|address| !address.is_empty()) else {
        return Ok(Notification::NotRequested);
    };
    let socket_address = notify_socket_address(notify_socket)?;
    let socket = UnixDatagram::unbound()?;
    socket.send_to_addr(WATCHDOG_MESSAGE, &socket_address)?;
    Ok(Notification::Sent)
}

/// The socket address `NOTIFY_SOCKET` names: an abstract one for a value starting with `@` (the rest
/// is its name), a path for anything else.
fn notify_socket_address(notify_socket: &OsStr) -> io::Result<SocketAddr> {
    match notify_socket.as_bytes().split_first() {
        Some((&ABSTRACT_ADDRESS_MARKER, abstract_name)) => {
            SocketAddr::from_abstract_name(abstract_name)
        }
        _ => SocketAddr::from_pathname(Path::new(notify_socket)),
    }
}

#[cfg(test)]
mod tests;
