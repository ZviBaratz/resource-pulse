//! How the program ends: the bus going away, a stream that failed or ended without a close, the
//! receiving thread dying, a reader that went away, and a copy that does not get the name, each
//! with its lines and its exit status.

use super::*;
use crate::constants::LOG_PREFIX;
use crate::program::ending::{Ending, LoopEnd};

/// The bus going away (its connection closed: the session ended) is the gjs service's line alone
/// and a clean 0, which `Restart=always` starts again unless a stop was asked for, as a logout's
/// is.
#[test]
fn the_bus_going_away_is_exit_0_with_the_bus_gone_line_alone() {
    assert_eq!(
        ending_of_loop(LoopEnd::BusGone),
        Ending {
            log_lines: vec![format!("{LOG_PREFIX} {GJS_SERVICE_BUS_GONE_TEXT}")],
            exit_status: 0
        }
    );
}

/// A stream of bus messages that ended on an unexpected error is a failure: one line with the
/// error's kind, and 1, so `Restart=always` starts the program again.
#[test]
fn a_stream_that_failed_is_exit_1_and_says_its_kind() {
    assert_eq!(
        ending_of_loop(LoopEnd::BusStreamFailed(Some(
            FAILED_STREAM_KIND.to_string()
        ))),
        Ending {
            log_lines: vec![format!(
                "{LOG_PREFIX} shutting down: the bus connection ended on an unexpected error: \
                 {FAILED_STREAM_KIND}"
            )],
            exit_status: 1
        }
    );
}

/// A stream of bus messages that ended with no error, while the connection did not say it closed,
/// is a failure: one line saying so, and 1.
#[test]
fn a_stream_that_ended_without_a_close_is_exit_1_and_says_so() {
    assert_eq!(
        ending_of_loop(LoopEnd::BusStreamFailed(None)),
        Ending {
            log_lines: vec![format!(
                "{LOG_PREFIX} shutting down: the stream of bus messages ended though the connection \
                 did not close"
            )],
            exit_status: 1
        }
    );
}

/// The loop's other endings: the receiving thread dying is a line of its own and 1, so
/// `Restart=always` starts the program again; a reader that went away is a silent 0.
#[test]
fn the_receiving_thread_dying_is_exit_1_and_a_reader_that_went_away_a_silent_0() {
    let endings = [
        ending_of_loop(LoopEnd::ReceivingThreadEnded),
        ending_of_loop(LoopEnd::OutputFailed(io::Error::from(
            io::ErrorKind::BrokenPipe,
        ))),
    ];
    assert_eq!(
        endings,
        [
            Ending {
                log_lines: vec![format!(
                    "{LOG_PREFIX} shutting down: the thread that receives from the bus ended"
                )],
                exit_status: 1
            },
            Ending {
                log_lines: Vec::new(),
                exit_status: 0
            },
        ]
    );
}

/// A copy that does not get the name ends with the gjs service's line, word for word, and 1; when
/// the bus failed, the failure's kind follows on a line of its own, and nothing names the bus
/// address that `zbus`'s own text would print.
#[test]
fn a_nameless_copy_says_the_cannot_own_line_exactly_and_the_failure_kind_without_the_address() {
    let made_up_address = "unix:path=/made-up/runtime/bus";
    let connect_failure = BusError::Bus(zbus::Error::Connection(
        std::sync::Arc::new(io::Error::from(io::ErrorKind::NotFound)),
        Box::new(made_up_address.parse().unwrap()),
    ));
    let cannot_own_line = format!("{LOG_PREFIX} {GJS_SERVICE_CANNOT_OWN_TEXT}");
    assert_eq!(
        [
            ending_of_name_not_owned(None),
            ending_of_name_not_owned(Some(&connect_failure)),
        ],
        [
            Ending {
                log_lines: vec![cannot_own_line.clone()],
                exit_status: 1
            },
            Ending {
                log_lines: vec![
                    cannot_own_line,
                    format!("{LOG_PREFIX} the session bus failed: cannot connect (NotFound)")
                ],
                exit_status: 1
            },
        ]
    );
}
