//! How the program ends: each ending's lines and exit status, and how the tick loop ended.

use std::io;
use std::process::ExitCode;

use crate::bus::BusError;
use crate::constants::{LOG_PREFIX, PROTOCOL_VERSION, RESOURCE_PULSE_BUS_NAME};
use crate::log_line::{write_log_line, LinePriority};

use super::{
    BUS_STREAM_FAILED_EXIT_CODE, CLEAN_EXIT_CODE, NAME_NOT_OWNED_EXIT_CODE,
    OUTPUT_FAILED_EXIT_CODE, RECEIVING_THREAD_ENDED_EXIT_CODE,
};

/// How the program ends: what it says on stderr, if anything, and the status it exits with.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Ending {
    pub(super) log_lines: Vec<String>,
    pub(super) exit_status: u8,
}

impl Ending {
    /// How the journal ranks the ending's lines: errors when the program exits with a failure,
    /// information when it exits 0.
    pub(super) fn line_priority(&self) -> LinePriority {
        if self.exit_status == CLEAN_EXIT_CODE {
            LinePriority::Info
        } else {
            LinePriority::Error
        }
    }
}

/// Says the ending's lines, at its priority, and gives its exit status.
pub(super) fn exit_with(ending: &Ending) -> ExitCode {
    let line_priority = ending.line_priority();
    for log_line in &ending.log_lines {
        write_log_line(line_priority, log_line);
    }
    ExitCode::from(ending.exit_status)
}

/// The ending for a failed write to stdout: quietly 0 for a reader that closed the pipe (the program
/// has nobody left to write for), else the failure said and 1.
pub(super) fn ending_of_output_failure(error: &io::Error) -> Ending {
    if error.kind() == io::ErrorKind::BrokenPipe {
        return Ending {
            log_lines: Vec::new(),
            exit_status: CLEAN_EXIT_CODE,
        };
    }
    Ending {
        log_lines: vec![format!(
            "{LOG_PREFIX} cannot write to the standard output: {error}"
        )],
        exit_status: OUTPUT_FAILED_EXIT_CODE,
    }
}

/// The ending of a copy that did not get the name: the gjs service's line, word for word, then,
/// when the bus failed, a line with the failure's kind (never its text, which names the bus
/// address), and 1.
pub(super) fn ending_of_name_not_owned(failure: Option<&BusError>) -> Ending {
    let cannot_own_line = format!(
        "{LOG_PREFIX} shutting down: cannot own {RESOURCE_PULSE_BUS_NAME}: another copy holds it, \
         or there is no session bus"
    );
    let kind_line = failure.map(|error| {
        let failure_kind = error.kind();
        format!("{LOG_PREFIX} the session bus failed: {failure_kind}")
    });
    Ending {
        log_lines: std::iter::once(cannot_own_line).chain(kind_line).collect(),
        exit_status: NAME_NOT_OWNED_EXIT_CODE,
    }
}

/// The gjs service's line, word for word, once the name is owned and sampling has started.
pub(super) fn serving_line() -> String {
    format!("{LOG_PREFIX} serving {RESOURCE_PULSE_BUS_NAME} (protocol {PROTOCOL_VERSION})")
}

/// The gjs service's line, word for word, for the bus going away after the name was owned.
pub(super) fn bus_gone_line() -> String {
    format!("{LOG_PREFIX} shutting down: lost {RESOURCE_PULSE_BUS_NAME}: the bus connection closed")
}

/// The line for a stream of bus messages that ended other than by the connection closing: with the
/// kind of the unexpected error that ended it (never `zbus`'s text, which can name an address), or,
/// with none, that it ended though the connection did not close.
pub(super) fn bus_stream_failed_line(unexpected_error_kind: Option<&str>) -> String {
    match unexpected_error_kind {
        Some(kind) => format!(
            "{LOG_PREFIX} shutting down: the bus connection ended on an unexpected error: {kind}"
        ),
        None => format!(
            "{LOG_PREFIX} shutting down: the stream of bus messages ended though the connection \
             did not close"
        ),
    }
}

/// The ending for how the loop ended: the bus going away is a clean end, said as the gjs service
/// said it; a stream of bus messages that failed and the receiving thread dying are failures, each
/// said as such (the journal records each as `Result=exit-code`).
pub(super) fn ending_of_loop(loop_end: LoopEnd) -> Ending {
    match loop_end {
        LoopEnd::BusGone => Ending {
            log_lines: vec![bus_gone_line()],
            exit_status: CLEAN_EXIT_CODE,
        },
        LoopEnd::BusStreamFailed(unexpected_error_kind) => Ending {
            log_lines: vec![bus_stream_failed_line(unexpected_error_kind.as_deref())],
            exit_status: BUS_STREAM_FAILED_EXIT_CODE,
        },
        LoopEnd::ReceivingThreadEnded => Ending {
            log_lines: vec![format!(
                "{LOG_PREFIX} shutting down: the thread that receives from the bus ended"
            )],
            exit_status: RECEIVING_THREAD_ENDED_EXIT_CODE,
        },
        LoopEnd::OutputFailed(error) => ending_of_output_failure(&error),
    }
}

/// How the tick loop ended.
#[derive(Debug)]
pub(super) enum LoopEnd {
    /// The bus connection closed: the session ended.
    BusGone,
    /// The stream of bus messages ended other than by the connection closing: on an unexpected
    /// error, whose kind it carries (never `zbus`'s text, which can name an address), or, with
    /// `None`, with no error while the connection did not close.
    BusStreamFailed(Option<String>),
    /// The thread that receives from the bus died, while the connection may still be up.
    ReceivingThreadEnded,
    /// `--print` could not write: a reader that closed the pipe, or another failure.
    OutputFailed(io::Error),
}
