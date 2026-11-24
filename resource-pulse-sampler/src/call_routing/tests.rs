//! Every answer is the one the gjs service's bus gave: a gjs probe on a private bus exported its
//! `ResourcePulseDBusService` (now the tests' `ResourcePulseServiceDouble`) for a fake sampler, as
//! `gnome-shell/tests/service-dbus.test.js` does, and called each of these from a second connection
//! (GDBus 2.88.0).
//! The introspection texts below are its replies, less the `<!-- GDBus 2.88.0 -->` line.

use super::*;

/// The interface's object path, for the calls below.
const OBJECT: &str = RESOURCE_PULSE_OBJECT_PATH;
/// An interface nobody has.
const UNKNOWN_INTERFACE: &str = "org.example.Unknown";
/// The first two lines of every introspection the probe printed.
const PROBED_INTROSPECTION_HEAD: &str = "<!DOCTYPE node PUBLIC \"-//freedesktop//DTD D-BUS Object \
    Introspection 1.0//EN\"\n                      \"http://www.freedesktop.org/standards/dbus/1.0/\
    introspect.dtd\">\n";

/// A call's route, from its parts.
fn route(
    object_path: &str,
    interface: Option<&str>,
    member: &str,
    signature: &str,
    string_arguments: &[&str],
) -> CallRoute {
    let string_arguments: Vec<String> = string_arguments.iter().map(|s| s.to_string()).collect();
    route_call(&CallDescription {
        object_path,
        interface,
        member,
        signature,
        string_arguments: &string_arguments,
    })
}

/// An error route, as the probe printed it.
fn error(name: &'static str, message: &str) -> CallRoute {
    CallRoute::Error {
        name,
        message: message.to_string(),
    }
}

/// GDBus's introspection of a node with one child, or none.
fn node_with_child(child_name: Option<&str>) -> String {
    let child = child_name.map_or(String::new(), |name| format!("  <node name=\"{name}\"/>\n"));
    format!("{PROBED_INTROSPECTION_HEAD}<node>\n{child}</node>\n")
}

/// The names an introspection declares with `<tag name="...">`, in order.
fn declared_names(xml: &str, tag: &str) -> Vec<String> {
    let opening = format!("<{tag} name=\"");
    xml.split(&opening)
        .skip(1)
        .map(|rest| rest.split('"').next().unwrap().to_string())
        .collect()
}

/// `Introspect` on `/` and on each node down to the object names the next node, and no interface.
#[test]
fn introspect_on_every_node_above_the_object_names_the_next_one_as_gdbus_does() {
    let answers: Vec<CallRoute> = ["/", "/io", "/io/github", "/io/github/zvibaratz"]
        .iter()
        .map(|path| {
            route(
                path,
                Some(INTROSPECTABLE_INTERFACE_NAME),
                "Introspect",
                "",
                &[],
            )
        })
        .collect();
    let expected: Vec<CallRoute> = ["io", "github", "zvibaratz", "ResourcePulse1"]
        .iter()
        .map(|child| CallRoute::Introspection(node_with_child(Some(child))))
        .collect();
    assert_eq!(answers, expected);
}

/// `Introspect` below the object, beside it or on an unrelated path is an empty node.
#[test]
fn introspect_anywhere_else_is_an_empty_node_as_gdbus_answers() {
    let answers: Vec<CallRoute> = [
        "/io/github/zvibaratz/ResourcePulse1/below",
        "/org",
        "/io/github/other",
        "/io/githubber",
    ]
    .iter()
    .map(|path| {
        route(
            path,
            Some(INTROSPECTABLE_INTERFACE_NAME),
            "Introspect",
            "",
            &[],
        )
    })
    .collect();
    assert_eq!(
        answers,
        vec![CallRoute::Introspection(node_with_child(None)); 4]
    );
}

/// `Introspect` on the object: GDBus's head, its four interfaces in GDBus's order with their methods
/// and signals, and no child node.
#[test]
fn introspect_on_the_object_lists_its_four_interfaces_in_gdbus_order_and_no_child() {
    let CallRoute::Introspection(xml) = route(
        OBJECT,
        Some(INTROSPECTABLE_INTERFACE_NAME),
        "Introspect",
        "",
        &[],
    ) else {
        panic!("Introspect on the object was not answered with a text");
    };
    assert!(xml.starts_with(PROBED_INTROSPECTION_HEAD), "{xml}");
    assert_eq!(
        (
            declared_names(&xml, "interface"),
            declared_names(&xml, "method"),
            declared_names(&xml, "signal"),
            declared_names(&xml, "node"),
        ),
        (
            vec![
                "org.freedesktop.DBus.Properties".to_string(),
                "org.freedesktop.DBus.Introspectable".to_string(),
                "org.freedesktop.DBus.Peer".to_string(),
                RESOURCE_PULSE_INTERFACE_NAME.to_string(),
            ],
            [
                "Get",
                "GetAll",
                "Set",
                "Introspect",
                "Ping",
                "GetMachineId",
                "GetState",
                "WatchDetail",
                "UnwatchDetail"
            ]
            .map(String::from)
            .to_vec(),
            vec!["PropertiesChanged".to_string(), "Sample".to_string()],
            Vec::<String>::new(),
        )
    );
}

/// `Peer.Ping` and `Peer.GetMachineId` are answered on the object and on any other path.
#[test]
fn peer_is_answered_on_every_path() {
    let answers: Vec<(CallRoute, CallRoute)> = [OBJECT, "/", "/io", "/org"]
        .iter()
        .map(|path| {
            (
                route(path, Some(PEER_INTERFACE_NAME), "Ping", "", &[]),
                route(path, Some(PEER_INTERFACE_NAME), "GetMachineId", "", &[]),
            )
        })
        .collect();
    assert_eq!(answers, vec![(CallRoute::Empty, CallRoute::MachineId); 4]);
}

/// `GetAll` of the interface is an empty map; `Get`, `Set`, and any call about another interface, are
/// GDBus's `InvalidArgs` with its text.
#[test]
fn properties_on_the_object_answer_an_empty_map_or_refuse_as_gdbus_does() {
    let properties = Some(PROPERTIES_INTERFACE_NAME);
    let interface = RESOURCE_PULSE_INTERFACE_NAME;
    assert_eq!(
        [
            route(OBJECT, properties, "GetAll", "s", &[interface]),
            route(OBJECT, properties, "GetAll", "s", &[UNKNOWN_INTERFACE]),
            route(OBJECT, properties, "GetAll", "s", &[""]),
            route(OBJECT, properties, "Get", "ss", &[interface, "Missing"]),
            route(
                OBJECT,
                properties,
                "Get",
                "ss",
                &[UNKNOWN_INTERFACE, "Missing"]
            ),
            route(OBJECT, properties, "Set", "ssv", &[interface, "Missing"]),
        ],
        [
            CallRoute::EmptyPropertyMap,
            error(
                INVALID_ARGS_ERROR_NAME,
                "No such interface “org.example.Unknown”"
            ),
            error(INVALID_ARGS_ERROR_NAME, "No such interface “”"),
            error(INVALID_ARGS_ERROR_NAME, "No such property “Missing”"),
            error(
                INVALID_ARGS_ERROR_NAME,
                "No such interface “org.example.Unknown”"
            ),
            error(INVALID_ARGS_ERROR_NAME, "No such property “Missing”"),
        ]
    );
}

/// A standard interface's method with the wrong arguments, a member it lacks, or an interface the
/// object lacks, is GDBus's "No such interface" on the object.
#[test]
fn a_standard_interface_with_the_wrong_arguments_or_member_is_no_such_interface() {
    let no_such = |interface: &str| {
        error(
            UNKNOWN_METHOD_ERROR_NAME,
            &format!("No such interface “{interface}” on object at path {OBJECT}"),
        )
    };
    assert_eq!(
        [
            route(OBJECT, Some(PROPERTIES_INTERFACE_NAME), "GetAll", "", &[]),
            route(OBJECT, Some(PROPERTIES_INTERFACE_NAME), "Get", "s", &["x"]),
            route(OBJECT, Some(PEER_INTERFACE_NAME), "Ping", "s", &["x"]),
            route(
                OBJECT,
                Some(PEER_INTERFACE_NAME),
                "GetMachineId",
                "s",
                &["x"]
            ),
            route(
                OBJECT,
                Some(INTROSPECTABLE_INTERFACE_NAME),
                "Introspect",
                "s",
                &["x"]
            ),
            route(OBJECT, Some(INTROSPECTABLE_INTERFACE_NAME), "Nope", "", &[]),
            route(OBJECT, Some(PEER_INTERFACE_NAME), "Nope", "", &[]),
            route(OBJECT, Some(PROPERTIES_INTERFACE_NAME), "Nope", "", &[]),
            route(OBJECT, Some(UNKNOWN_INTERFACE), "Foo", "", &[]),
        ],
        [
            no_such(PROPERTIES_INTERFACE_NAME),
            no_such(PROPERTIES_INTERFACE_NAME),
            no_such(PEER_INTERFACE_NAME),
            no_such(PEER_INTERFACE_NAME),
            no_such(INTROSPECTABLE_INTERFACE_NAME),
            no_such(INTROSPECTABLE_INTERFACE_NAME),
            no_such(PEER_INTERFACE_NAME),
            no_such(PROPERTIES_INTERFACE_NAME),
            no_such(UNKNOWN_INTERFACE),
        ]
    );
}

/// Anything but `Peer` and `Introspect` on a path that is not the object is "Object does not exist".
#[test]
fn anything_else_off_the_object_is_object_does_not_exist() {
    assert_eq!(
        [
            route(
                "/",
                Some(RESOURCE_PULSE_INTERFACE_NAME),
                "GetState",
                "",
                &[]
            ),
            route(
                "/io",
                Some(RESOURCE_PULSE_INTERFACE_NAME),
                "GetState",
                "",
                &[]
            ),
            route("/", Some(PROPERTIES_INTERFACE_NAME), "GetAll", "s", &["x"]),
            route("/org", None, "Nope", "", &[]),
        ],
        [
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                "Object does not exist at path “/”"
            ),
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                "Object does not exist at path “/io”"
            ),
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                "Object does not exist at path “/”"
            ),
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                "Object does not exist at path “/org”"
            ),
        ]
    );
}

/// The interface's three methods go to the program; a member it lacks is "No such method", and a
/// method of it with arguments is GDBus's `InvalidArgs`.
#[test]
fn the_interface_answers_its_three_methods_and_refuses_the_rest_as_gdbus_does() {
    let interface = Some(RESOURCE_PULSE_INTERFACE_NAME);
    assert_eq!(
        [
            route(OBJECT, interface, "GetState", "", &[]),
            route(OBJECT, interface, "WatchDetail", "", &[]),
            route(OBJECT, interface, "UnwatchDetail", "", &[]),
            route(OBJECT, interface, "Nope", "", &[]),
            route(OBJECT, interface, "GetState", "s", &["x"]),
            route(OBJECT, interface, "WatchDetail", "s", &["x"]),
        ],
        [
            CallRoute::Program(ProgramMethod::GetState),
            CallRoute::Program(ProgramMethod::WatchDetail),
            CallRoute::Program(ProgramMethod::UnwatchDetail),
            error(UNKNOWN_METHOD_ERROR_NAME, "No such method “Nope”"),
            error(
                INVALID_ARGS_ERROR_NAME,
                "Type of message, “(s)”, does not match expected type “()”"
            ),
            error(
                INVALID_ARGS_ERROR_NAME,
                "Type of message, “(s)”, does not match expected type “()”"
            ),
        ]
    );
}

/// The program's one difference from GDBus, kept on purpose: the interface's own
/// methods are answered without an interface in the call; anything else without one is GDBus's
/// "Object does not exist", `Introspect` included.
#[test]
fn a_call_without_an_interface_reaches_the_interface_methods_only() {
    assert_eq!(
        [
            route(OBJECT, None, "GetState", "", &[]),
            route(OBJECT, None, "Introspect", "", &[]),
            route(OBJECT, None, "Ping", "", &[]),
            route(OBJECT, None, "Nope", "", &[]),
            route("/", None, "GetState", "", &[]),
        ],
        [
            CallRoute::Program(ProgramMethod::GetState),
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                &format!("Object does not exist at path “{OBJECT}”")
            ),
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                &format!("Object does not exist at path “{OBJECT}”")
            ),
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                &format!("Object does not exist at path “{OBJECT}”")
            ),
            error(
                UNKNOWN_METHOD_ERROR_NAME,
                "Object does not exist at path “/”"
            ),
        ]
    );
}

/// The interface's methods are answered without an interface only when the call carries no
/// arguments, as with one: a `GetState` that carries a string is not the interface's `GetState`, and
/// is answered as every other call without an interface is, "Object does not exist" (the answer
/// GDBus gives, which the program keeps for everything it does not answer).
#[test]
fn a_call_without_an_interface_that_carries_arguments_is_not_the_interface_method() {
    let not_found = error(
        UNKNOWN_METHOD_ERROR_NAME,
        &format!("Object does not exist at path “{OBJECT}”"),
    );
    assert_eq!(
        [
            route(OBJECT, None, "GetState", "s", &["x"]),
            route(OBJECT, None, "WatchDetail", "s", &["x"]),
            route(OBJECT, None, "UnwatchDetail", "s", &["x"]),
        ],
        [not_found.clone(), not_found.clone(), not_found]
    );
}

/// The machine's id is the first file that reads, without its newline; with none, the error names
/// every file and why the first failed.
#[test]
fn the_machine_id_is_the_first_file_that_reads_without_its_newline() {
    let directory = std::env::temp_dir().join(format!(
        "resource-pulse-machine-id-test-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    let missing = directory.join("missing");
    let present = directory.join("machine-id");
    fs::write(&present, "0123456789abcdef0123456789abcdef\n").unwrap();
    let found = machine_id_from(&[&missing, &present]);
    let not_found = machine_id_from(&[&missing, &directory.join("also-missing")]);
    let _ = fs::remove_dir_all(&directory);
    let expected_failure_head = format!(
        "Unable to load {} or {}: ",
        missing.display(),
        directory.join("also-missing").display()
    );
    assert_eq!(found, Ok("0123456789abcdef0123456789abcdef".to_string()));
    assert!(
        not_found
            .as_ref()
            .is_err_and(|text| text.starts_with(&expected_failure_head)
                && text.contains("No such file or directory")),
        "{not_found:?}"
    );
}
