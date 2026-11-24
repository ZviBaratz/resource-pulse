//! Which answer a call gets: the interface's three methods, which the program answers, and
//! everything else as GDBus answers it on every object. The gjs service got the rest from GDBus for
//! free; with no object server, the program writes it out, so `gdbus introspect`, a `Peer.Ping` or a
//! mistyped call is answered, never left to time out.
//!
//! Every answer here is the one the gjs service's bus gave (GDBus 2.88, probed on a private bus
//! with the gjs service's `ResourcePulseDBusService`, now the tests' `ResourcePulseServiceDouble`
//! in `gnome-shell/tests/serviceDouble.js`, exported for a fake sampler; the rows in
//! `call_routing/tests.rs` hold each answer the probe printed), with one difference kept on
//! purpose: GDBus answers a call that names no interface with "Object does not exist", and the
//! program answers the interface's own three methods without one, as the D-Bus specification allows.

use std::fs;
use std::path::Path;

use crate::constants::{
    GET_STATE_METHOD_NAME, RESOURCE_PULSE_INTERFACE_NAME, RESOURCE_PULSE_OBJECT_PATH,
    SAMPLE_SIGNAL_NAME, UNWATCH_DETAIL_METHOD_NAME, WATCH_DETAIL_METHOD_NAME,
};

/// The standard error for a call to a method, interface or object that does not exist.
pub const UNKNOWN_METHOD_ERROR_NAME: &str = "org.freedesktop.DBus.Error.UnknownMethod";
/// The standard error for a call whose arguments are wrong.
pub const INVALID_ARGS_ERROR_NAME: &str = "org.freedesktop.DBus.Error.InvalidArgs";
/// The standard error for a call that could not be carried out.
pub const FAILED_ERROR_NAME: &str = "org.freedesktop.DBus.Error.Failed";
/// The standard interface every node answers `Introspect` on.
pub const INTROSPECTABLE_INTERFACE_NAME: &str = "org.freedesktop.DBus.Introspectable";
/// The one method of [`INTROSPECTABLE_INTERFACE_NAME`].
pub const INTROSPECT_METHOD_NAME: &str = "Introspect";
/// The standard interface every path answers `Ping` and `GetMachineId` on.
pub const PEER_INTERFACE_NAME: &str = "org.freedesktop.DBus.Peer";
/// `Peer`'s method that answers nothing.
pub const PING_METHOD_NAME: &str = "Ping";
/// `Peer`'s method that answers the machine's id.
pub const GET_MACHINE_ID_METHOD_NAME: &str = "GetMachineId";
/// The standard interface the object answers property calls on (it has no properties).
pub const PROPERTIES_INTERFACE_NAME: &str = "org.freedesktop.DBus.Properties";
/// `Properties`' methods, and the signature each takes.
const GET_PROPERTY_METHOD_NAME: &str = "Get";
const GET_ALL_PROPERTIES_METHOD_NAME: &str = "GetAll";
const SET_PROPERTY_METHOD_NAME: &str = "Set";
const GET_PROPERTY_SIGNATURE: &str = "ss";
const GET_ALL_PROPERTIES_SIGNATURE: &str = "s";
const SET_PROPERTY_SIGNATURE: &str = "ssv";
/// The signature of a call with no arguments, which every method here but `Properties`' takes.
const NO_ARGUMENTS_SIGNATURE: &str = "";
/// The separator of an object path's components, and the root path.
const OBJECT_PATH_SEPARATOR: char = '/';
const ROOT_OBJECT_PATH: &str = "/";

/// Where GDBus reads the machine's id, in its order: the D-Bus daemon's copy, then systemd's.
const MACHINE_ID_PATHS: [&str; 2] = ["/var/lib/dbus/machine-id", "/etc/machine-id"];
/// What joins the paths in the error for a machine id that could not be read.
const MACHINE_ID_PATHS_SEPARATOR: &str = " or ";

/// The head of every introspection, as GDBus writes it.
const INTROSPECTION_HEAD: &str = r#"<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
                      "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
"#;
/// The three standard interfaces on the object, as GDBus introspects them, in its order.
const STANDARD_INTERFACES_XML: &str = r#"  <interface name="org.freedesktop.DBus.Properties">
    <method name="Get">
      <arg type="s" name="interface_name" direction="in"/>
      <arg type="s" name="property_name" direction="in"/>
      <arg type="v" name="value" direction="out"/>
    </method>
    <method name="GetAll">
      <arg type="s" name="interface_name" direction="in"/>
      <arg type="a{sv}" name="properties" direction="out"/>
    </method>
    <method name="Set">
      <arg type="s" name="interface_name" direction="in"/>
      <arg type="s" name="property_name" direction="in"/>
      <arg type="v" name="value" direction="in"/>
    </method>
    <signal name="PropertiesChanged">
      <arg type="s" name="interface_name"/>
      <arg type="a{sv}" name="changed_properties"/>
      <arg type="as" name="invalidated_properties"/>
    </signal>
  </interface>
  <interface name="org.freedesktop.DBus.Introspectable">
    <method name="Introspect">
      <arg type="s" name="xml_data" direction="out"/>
    </method>
  </interface>
  <interface name="org.freedesktop.DBus.Peer">
    <method name="Ping"/>
    <method name="GetMachineId">
      <arg type="s" name="machine_uuid" direction="out"/>
    </method>
  </interface>
"#;

/// One of the interface's own methods, which the program answers itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgramMethod {
    GetState,
    WatchDetail,
    UnwatchDetail,
}

/// What a call is answered with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallRoute {
    /// One of the interface's methods, for the program to carry out and answer.
    Program(ProgramMethod),
    /// `Introspect`: this text.
    Introspection(String),
    /// A reply with no arguments (`Ping`).
    Empty,
    /// `GetAll` of the interface, which has no properties: an empty `a{sv}`.
    EmptyPropertyMap,
    /// `GetMachineId`: the machine's id, which the program reads.
    MachineId,
    /// An error reply.
    Error { name: &'static str, message: String },
}

/// A call as routing needs it.
#[derive(Debug, Clone, Copy)]
pub struct CallDescription<'a> {
    pub object_path: &'a str,
    /// The interface the call names, if it names one.
    pub interface: Option<&'a str>,
    pub member: &'a str,
    /// The signature of the call's arguments, without parentheses: `""` for none.
    pub signature: &'a str,
    /// The call's leading string arguments (an interface and a property name, for `Properties`).
    pub string_arguments: &'a [String],
}

/// The answer to a call, in GDBus's order: `Peer` and `Introspectable` on any path, then the object,
/// whose `Properties`, standard interfaces and own interface answer as GDBus has them; anything on a
/// path that is not the object is "Object does not exist".
pub fn route_call(call: &CallDescription<'_>) -> CallRoute {
    if let Some(route) = route_answered_on_every_path(call) {
        return route;
    }
    if call.object_path != RESOURCE_PULSE_OBJECT_PATH {
        return no_such_object(call.object_path);
    }
    match call.interface {
        None => route_without_interface(call),
        Some(PROPERTIES_INTERFACE_NAME) => route_properties_call(call),
        Some(RESOURCE_PULSE_INTERFACE_NAME) => route_interface_call(call),
        Some(other_interface) => no_such_interface(other_interface, call.object_path),
    }
}

/// `Peer.Ping`, `Peer.GetMachineId` and `Introspect`, each with no arguments, which GDBus answers on
/// every path; `None` for any other call.
fn route_answered_on_every_path(call: &CallDescription<'_>) -> Option<CallRoute> {
    if call.signature != NO_ARGUMENTS_SIGNATURE {
        return None;
    }
    match (call.interface?, call.member) {
        (PEER_INTERFACE_NAME, PING_METHOD_NAME) => Some(CallRoute::Empty),
        (PEER_INTERFACE_NAME, GET_MACHINE_ID_METHOD_NAME) => Some(CallRoute::MachineId),
        (INTROSPECTABLE_INTERFACE_NAME, INTROSPECT_METHOD_NAME) => Some(CallRoute::Introspection(
            introspection_xml(call.object_path),
        )),
        _ => None,
    }
}

/// A call on the object that names no interface: the interface's own methods (the program's
/// difference from GDBus, which answers "Object does not exist"), and GDBus's answer for anything
/// else.
fn route_without_interface(call: &CallDescription<'_>) -> CallRoute {
    match program_method_named(call.member) {
        Some(method) if call.signature == NO_ARGUMENTS_SIGNATURE => CallRoute::Program(method),
        _ => no_such_object(call.object_path),
    }
}

/// A call of the interface on the object: one of its methods with no arguments; a method of it with
/// arguments is refused as GDBus refuses it, and a member it lacks is "No such method".
fn route_interface_call(call: &CallDescription<'_>) -> CallRoute {
    let Some(method) = program_method_named(call.member) else {
        return CallRoute::Error {
            name: UNKNOWN_METHOD_ERROR_NAME,
            message: format!("No such method “{}”", call.member),
        };
    };
    if call.signature != NO_ARGUMENTS_SIGNATURE {
        return CallRoute::Error {
            name: INVALID_ARGS_ERROR_NAME,
            message: format!(
                "Type of message, “({})”, does not match expected type “()”",
                call.signature
            ),
        };
    }
    CallRoute::Program(method)
}

/// A `Properties` call on the object: the interface has no properties, so `GetAll` of it is empty,
/// and `Get` or `Set` of any property, or any call about another interface, is refused as GDBus
/// refuses it. A member it lacks, or the wrong arguments, is "No such interface", as in GDBus.
fn route_properties_call(call: &CallDescription<'_>) -> CallRoute {
    let expected_signature = match call.member {
        GET_PROPERTY_METHOD_NAME => GET_PROPERTY_SIGNATURE,
        GET_ALL_PROPERTIES_METHOD_NAME => GET_ALL_PROPERTIES_SIGNATURE,
        SET_PROPERTY_METHOD_NAME => SET_PROPERTY_SIGNATURE,
        _ => return no_such_interface(PROPERTIES_INTERFACE_NAME, call.object_path),
    };
    let interface_asked = match call.string_arguments.first() {
        Some(interface_asked) if call.signature == expected_signature => interface_asked,
        _ => return no_such_interface(PROPERTIES_INTERFACE_NAME, call.object_path),
    };
    if interface_asked != RESOURCE_PULSE_INTERFACE_NAME {
        return invalid_args(format!("No such interface “{interface_asked}”"));
    }
    match call.string_arguments.get(1) {
        Some(property_asked) => invalid_args(format!("No such property “{property_asked}”")),
        None => CallRoute::EmptyPropertyMap,
    }
}

/// The interface method a member names, if it names one.
fn program_method_named(member: &str) -> Option<ProgramMethod> {
    match member {
        GET_STATE_METHOD_NAME => Some(ProgramMethod::GetState),
        WATCH_DETAIL_METHOD_NAME => Some(ProgramMethod::WatchDetail),
        UNWATCH_DETAIL_METHOD_NAME => Some(ProgramMethod::UnwatchDetail),
        _ => None,
    }
}

/// GDBus's error for a call on a path that is not the object.
fn no_such_object(object_path: &str) -> CallRoute {
    CallRoute::Error {
        name: UNKNOWN_METHOD_ERROR_NAME,
        message: format!("Object does not exist at path “{object_path}”"),
    }
}

/// GDBus's error for an interface the object lacks, or a call a standard interface does not take.
fn no_such_interface(interface: &str, object_path: &str) -> CallRoute {
    CallRoute::Error {
        name: UNKNOWN_METHOD_ERROR_NAME,
        message: format!("No such interface “{interface}” on object at path {object_path}"),
    }
}

/// GDBus's error for a property call about something that does not exist.
fn invalid_args(message: String) -> CallRoute {
    CallRoute::Error {
        name: INVALID_ARGS_ERROR_NAME,
        message,
    }
}

/// What `Introspect` answers on a path, as GDBus: the object's interfaces on the object; one child
/// node, the next component of the object's path, on each node above it; and an empty node anywhere
/// else.
pub fn introspection_xml(object_path: &str) -> String {
    let body = if object_path == RESOURCE_PULSE_OBJECT_PATH {
        object_interfaces_xml()
    } else {
        match child_node_toward_object(object_path) {
            Some(child_name) => format!("  <node name=\"{child_name}\"/>\n"),
            None => String::new(),
        }
    };
    format!("{INTROSPECTION_HEAD}<node>\n{body}</node>\n")
}

/// The next component of the object's path below `object_path`, when `object_path` is a node above
/// the object.
fn child_node_toward_object(object_path: &str) -> Option<&'static str> {
    let below_node = if object_path == ROOT_OBJECT_PATH {
        RESOURCE_PULSE_OBJECT_PATH.strip_prefix(ROOT_OBJECT_PATH)?
    } else {
        RESOURCE_PULSE_OBJECT_PATH
            .strip_prefix(object_path)?
            .strip_prefix(OBJECT_PATH_SEPARATOR)?
    };
    below_node.split(OBJECT_PATH_SEPARATOR).next()
}

/// The machine's id, as GDBus answers `GetMachineId` (`_g_dbus_get_machine_id`): the first of
/// `MACHINE_ID_PATHS` that can be read, without the whitespace around it; when neither can, an
/// error naming both, for a `Failed` reply.
pub fn read_machine_id() -> Result<String, String> {
    machine_id_from(&MACHINE_ID_PATHS.map(Path::new))
}

/// [`read_machine_id`] from the given files, tried in order. The error names them all, with the
/// reason the first could not be read, as GDBus's does.
fn machine_id_from(paths: &[&Path]) -> Result<String, String> {
    let mut first_failure = None;
    for path in paths {
        match fs::read_to_string(path) {
            Ok(machine_id) => return Ok(machine_id.trim().to_string()),
            Err(error) => {
                first_failure.get_or_insert(error);
            }
        }
    }
    let path_list = paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(MACHINE_ID_PATHS_SEPARATOR);
    let reason = first_failure.map_or_else(|| "no file to read".to_string(), |e| e.to_string());
    Err(format!("Unable to load {path_list}: {reason}"))
}

/// The object's four interfaces: the three standard ones, then its own (`RESOURCE_PULSE_INTERFACE_XML`
/// in `lib/protocol.js`).
fn object_interfaces_xml() -> String {
    format!(
        r#"{STANDARD_INTERFACES_XML}  <interface name="{RESOURCE_PULSE_INTERFACE_NAME}">
    <method name="{GET_STATE_METHOD_NAME}">
      <arg type="s" name="state" direction="out"/>
    </method>
    <method name="{WATCH_DETAIL_METHOD_NAME}"/>
    <method name="{UNWATCH_DETAIL_METHOD_NAME}"/>
    <signal name="{SAMPLE_SIGNAL_NAME}">
      <arg type="s" name="sample"/>
    </signal>
  </interface>
"#
    )
}

#[cfg(test)]
mod tests;
