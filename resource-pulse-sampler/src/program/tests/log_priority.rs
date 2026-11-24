//! The priority each line is written at: an ending's lines are errors exactly when it exits with a
//! failure, and a failure log line and a caught panic are warnings.

use super::*;
use crate::caught_panic::install_panic_hook;
use crate::constants::LOG_PREFIX;
use crate::program::calls::reply_or_failure;
use crate::program::ending::LoopEnd;
use crate::program::sampler_service::desktop_name_lookup;

/// Every way the program ends, each with its exit status: an ending's lines are errors exactly when
/// it exits with a failure, and information when it exits 0 (the bus going away, a reader that went
/// away), so the journal never ranks a clean ending as a fault, nor a failing one as routine.
#[test]
fn an_endings_lines_are_errors_exactly_when_its_exit_status_is_not_0() {
    let connect_failure = BusError::Bus(zbus::Error::Connection(
        std::sync::Arc::new(io::Error::from(io::ErrorKind::NotFound)),
        Box::new("unix:path=/made-up/runtime/bus".parse().unwrap()),
    ));
    let every_ending = [
        ending_of_name_not_owned(None),
        ending_of_name_not_owned(Some(&connect_failure)),
        ending_of_loop(LoopEnd::BusGone),
        ending_of_loop(LoopEnd::BusStreamFailed(Some(
            FAILED_STREAM_KIND.to_string(),
        ))),
        ending_of_loop(LoopEnd::BusStreamFailed(None)),
        ending_of_loop(LoopEnd::ReceivingThreadEnded),
        ending_of_loop(LoopEnd::OutputFailed(io::Error::from(
            io::ErrorKind::BrokenPipe,
        ))),
        ending_of_loop(LoopEnd::OutputFailed(io::Error::from(
            io::ErrorKind::PermissionDenied,
        ))),
    ];
    let statuses_and_priorities =
        every_ending.map(|ending| (ending.exit_status, ending.line_priority()));
    assert_eq!(
        statuses_and_priorities,
        [
            (1, LinePriority::Error),
            (1, LinePriority::Error),
            (0, LinePriority::Info),
            (1, LinePriority::Error),
            (1, LinePriority::Error),
            (1, LinePriority::Error),
            (0, LinePriority::Info),
            (1, LinePriority::Error),
        ]
    );
}

/// What the caught-panic row's call panics with.
const CALL_PANIC_MESSAGE: &str = "planted in a call";

/// Every line of the sampler's and the program's failure logs is a warning, as the gjs service
/// wrote them with `console.warn`, through the writers the program builds for its service: the
/// lines the sampler's `initialize` logs over a root whose performance-core list cannot be parsed,
/// and a call whose handling panicked, caught and logged by the program.
#[test]
fn a_failure_log_line_and_a_caught_panic_are_warnings() {
    install_panic_hook();
    let mut service = SamplerService::with_real_ports_writing_to(
        &fixture_root("root-bad-pmu"),
        desktop_name_lookup(&|_| None),
        record_log_line,
    );
    service.initialize();
    reply_or_failure(&mut service, "Boom", FIRST_CALLER, |_| {
        panic!("{CALL_PANIC_MESSAGE}")
    });
    let recorded = RECORDED_LOG_LINES.with(|recorded| recorded.borrow().clone());
    let caught_panic_line_start =
        format!("{LOG_PREFIX} Boom from {FIRST_CALLER} failed: {CALL_PANIC_MESSAGE} at ");
    let has_initialize_line = recorded
        .iter()
        .any(|(_, line)| line.starts_with(&format!("{LOG_PREFIX} cannot parse ")));
    let caught_panic_source_file = recorded
        .iter()
        .find_map(|(_, line)| line.strip_prefix(caught_panic_line_start.as_str()))
        .and_then(panic_source_file);
    let are_all_warnings = recorded
        .iter()
        .all(|(priority, _)| *priority == LinePriority::Warning);
    assert_eq!(
        (
            has_initialize_line,
            caught_panic_source_file,
            are_all_warnings
        ),
        (true, Some(file!()), true),
        "{recorded:?}"
    );
}
