//! The sampler program's modes, which `src/main.rs` runs once it has read the flags: serving on the
//! session bus, `--print`, `--print-constants` and `--source-hash`.
//!
//! - **Start-up, in the gjs service's order:** the flags; the real ports; the sampler's
//!   `initialize`, inside a catch, so what it logs is written before the program is named; a bus
//!   connection that listens before it asks for the name; the name, with "do not queue" only; then,
//!   once the name is owned, the first tick and the "serving" line, as the gjs service started
//!   sampling in its name-acquired handler. `--print` has the same order without the bus.
//! - **One loop, on one thread:** it waits for a bus event until the next tick is due; a due tick
//!   runs inside a catch, its Sample is sent, and systemd hears the program is alive; each call is
//!   carried out inside a catch and answered, with an error reply when the catch caught something.
//!   Everything is sent from this thread, so a state reply carrying sequence N leaves after Sample N
//!   and before Sample N+1, and a watch's reveal leaves before the watch call's reply.
//! - **A fault costs one tick or one call, never the process:** a panic is caught, logged
//!   rate-limited under a stable key, and the next tick runs.
//! - **Ticks do not drift, and a missed one is skipped** (`tick_schedule.rs`); a tick's number
//!   counts the ticks run, so the tick after a stall is the previous one plus one, as in gjs.
//! - `--print` runs the same loop, with the same catches and schedule, without a bus: one JSON line
//!   per publish on stdout, and a closed pipe ends it quietly. `--print-constants` prints the
//!   constants both languages hold, for the comparison rows
//!   (`gnome-shell/tests/sampler-constants.js`); `--source-hash` prints the hash of the sources it
//!   was built from, for `scripts/resource-pulse-sampler-build.sh --check`. Test switches are
//!   flags, never environment variables.
//! - **Exit status:** 0 once the bus has gone away after the name was owned, its connection closed
//!   (an end of file, a reset or a broken pipe: a logout), and for `--print`'s closed pipe; 1 when
//!   the name is held by another copy or the bus cannot be reached, when the stream of bus messages
//!   ended any other way (on an unexpected error, or with no error while the connection did not
//!   close), and when the thread that receives from the bus died; 2 for a flag it does not know. The
//!   unit's `Restart=always` starts it again after a 0 or a 1 that no stop asked for, never after a 2
//!   (`RestartPreventExitStatus=2`). A stop needs no handler: systemd counts an exit on SIGTERM as
//!   clean.
//! - **Every line has a priority for the journal** (`log_line.rs`): each line of the sampler's and
//!   the program's failure logs, a caught panic's included, is a warning, as the gjs service wrote
//!   them with `console.warn`; an ending's lines are errors when its exit status is not 0; the
//!   "serving" line and a clean ending's line are information.

mod calls;
mod ending;
mod sampler_service;
mod tick_loop;

use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use crate::bus::{BusError, BusLink, NameOutcome};
use crate::constants::{constant_lines, RESOURCE_PULSE_BUS_NAME};
use crate::log_line::LinePriority;
use crate::watchdog::notify_alive;
use ending::{ending_of_loop, ending_of_name_not_owned, ending_of_output_failure, exit_with};
use sampler_service::SamplerService;
use tick_loop::{run_tick_loop, BusOutlet, PrintOutlet};

/// Exit status when the name was never owned: another copy holds it, or there is no bus.
const NAME_NOT_OWNED_EXIT_CODE: u8 = 1;
/// Exit status when `--print` or `--print-constants` cannot write, for a reason other than a reader
/// that went away.
const OUTPUT_FAILED_EXIT_CODE: u8 = 1;
/// Exit status when the thread that receives from the bus died: a failure, which the journal records as one
/// (`Result=exit-code`).
const RECEIVING_THREAD_ENDED_EXIT_CODE: u8 = 1;
/// Exit status when the stream of bus messages ended other than by the connection closing (on an
/// unexpected error, or with no error at all): a failure, which the journal records as one (`Result=exit-code`).
const BUS_STREAM_FAILED_EXIT_CODE: u8 = 1;
/// Exit status of a clean end: the bus went away, or `--print`'s reader did.
const CLEAN_EXIT_CODE: u8 = 0;
/// The variable whose value is the user's home, where the user's data directory is when
/// `XDG_DATA_HOME` is unset.
const HOME_VARIABLE: &str = "HOME";

/// The template keys of the program's own failures, each logged at most once per ten minutes. The
/// three the gjs service had are its keys (its sampler's tick, and its D-Bus face's watch call and
/// vanished caller).
const TICK_FAILURE_LOG_KEY: &str = "tick failed";
const INITIALIZE_FAILURE_LOG_KEY: &str = "initialize failed";
const WATCH_CALL_FAILURE_LOG_KEY: &str = "watch call failed";
const VANISHED_CALLER_FAILURE_LOG_KEY: &str = "dropping a vanished caller failed";
const CALL_FAILURE_LOG_KEY: &str = "call failed";
const SAMPLE_SEND_FAILURE_LOG_KEY: &str = "cannot send a Sample";
const REPLY_FAILURE_LOG_KEY: &str = "cannot answer a call";
const WATCHDOG_FAILURE_LOG_KEY: &str = "cannot notify the watchdog";
const BUS_LINK_FAILURE_LOG_KEY: &str = "bus link failed";
const MESSAGE_FAILURE_LOG_KEY: &str = "receiving a message failed";

/// Where the sampler reads and how fast it ticks.
#[derive(Debug, PartialEq, Eq)]
pub struct SamplerSettings {
    pub fs_root: PathBuf,
    pub tick_interval_usec: u64,
}

/// Writes one line with its priority: [`write_log_line`](crate::log_line::write_log_line) in the program; the rows record each line.
type WriteLogLine = fn(LinePriority, &str);

/// A writer for a failure log (the sampler's, or the program's own, both rate-limited): each line it
/// is handed goes to `write_line` as a warning, a caught panic's line included, as the gjs service
/// wrote them with `console.warn`.
fn failure_log_writer(write_line: WriteLogLine) -> Box<dyn FnMut(&str)> {
    Box::new(move |line| write_line(LinePriority::Warning, line))
}

/// The source hash of the crate this program was built from (`build.rs` computes it, and
/// `source_hash.rs` says what it covers): what `--source-hash` prints.
pub const SOURCE_HASH: &str = env!("RESOURCE_PULSE_SOURCE_HASH");

/// Prints every constant, one per line. A reader that went away ends it quietly; any other failure
/// to write is said on stderr.
pub fn print_constants() -> ExitCode {
    print_lines(&constant_lines())
}

/// Prints the source hash and a newline, opening no bus and reading nothing. A reader that went
/// away ends it quietly; any other failure to write is said on stderr.
pub fn print_source_hash() -> ExitCode {
    print_lines(&[SOURCE_HASH])
}

/// Writes each line to stdout, then flushes; the one way the print-and-exit flags write.
fn print_lines<Line: AsRef<str>>(lines: &[Line]) -> ExitCode {
    let mut output = io::stdout().lock();
    let written = lines
        .iter()
        .try_for_each(|line| writeln!(output, "{}", line.as_ref()))
        .and_then(|()| output.flush());
    match written {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => exit_with(&ending_of_output_failure(&error)),
    }
}

/// `--print`: `initialize`, then the tick loop with no bus, each Sample a line on stdout, until stdout
/// closes.
pub fn print_samples(settings: &SamplerSettings) -> ExitCode {
    let mut service = SamplerService::with_real_ports(&settings.fs_root);
    service.initialize();
    let mut outlet = PrintOutlet {
        output: io::stdout().lock(),
    };
    let loop_end = run_tick_loop(&mut service, settings.tick_interval_usec, &mut outlet);
    exit_with(&ending_of_loop(loop_end))
}

/// Serves on the session bus, in the gjs service's order: the service, so its start time is taken
/// before anything else; the sampler's `initialize` (the gjs service initialized before
/// `bus_own_name`); a connection that listens; the name; then the tick loop until the bus goes
/// away. A copy that does not get the name has done its start-up reads, and logged them, first, as
/// the gjs service had.
pub fn serve(settings: &SamplerSettings) -> ExitCode {
    let mut service = SamplerService::with_real_ports(&settings.fs_root);
    service.initialize();
    let bus_link = match connect_and_own_name() {
        Ok(bus_link) => bus_link,
        Err(failure) => return exit_with(&ending_of_name_not_owned(failure.as_ref())),
    };
    let mut outlet = BusOutlet {
        bus: bus_link,
        notify_watchdog: Box::new(notify_alive),
    };
    let loop_end = run_tick_loop(&mut service, settings.tick_interval_usec, &mut outlet);
    exit_with(&ending_of_loop(loop_end))
}

/// A bus link that owns the name, or why there is none: `None` when another copy holds the name,
/// the failure when the bus could not be reached or asked.
fn connect_and_own_name() -> Result<BusLink, Option<BusError>> {
    let bus_link = BusLink::connect_listening().map_err(Some)?;
    match bus_link.request_name(RESOURCE_PULSE_BUS_NAME) {
        Ok(NameOutcome::Owned) => Ok(bus_link),
        Ok(NameOutcome::HeldByAnother) => Err(None),
        Err(error) => Err(Some(error)),
    }
}

#[cfg(test)]
mod tests;
