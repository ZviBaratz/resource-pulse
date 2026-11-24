//! The sampler program, run by `systemd/resource-pulse.service`: it owns
//! `io.github.zvibaratz.ResourcePulse1` on the session bus and serves the sampler there
//! until the bus goes away.
//!
//! This file reads the flags and runs the mode they ask for; the modes are in
//! [`resource_pulse_sampler::program`].

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

use resource_pulse_sampler::caught_panic::install_panic_hook;
use resource_pulse_sampler::constants::SAMPLE_INTERVAL_SECONDS;
use resource_pulse_sampler::log_line::{detect_journal_stream, write_log_line, LinePriority};
use resource_pulse_sampler::program::{
    print_constants, print_samples, print_source_hash, serve, SamplerSettings,
};

/// Prints the constants and exits.
const PRINT_CONSTANTS_FLAG: &str = "--print-constants";
/// Prints the hash of the sources the program was built from and exits, opening no bus.
const SOURCE_HASH_FLAG: &str = "--source-hash";
/// Opens no bus: writes each publish's Sample as one line on stdout.
const PRINT_FLAG: &str = "--print";
/// The root under which `proc/` and `sys/` are read (the rows read fixture roots).
const FS_ROOT_FLAG: &str = "--fs-root";
/// Sets the interval between ticks, in milliseconds (the rows tick fast).
const TICK_INTERVAL_FLAG: &str = "--tick-interval-ms";
/// What the program says to stderr when it is called with anything else.
const USAGE_LINE: &str = "usage: resource-pulse-sampler [--print-constants | --source-hash] \
    [--print] [--fs-root <path>] [--tick-interval-ms <milliseconds>]";
/// The root read without `--fs-root`: the machine's own.
const DEFAULT_FS_ROOT: &str = "/";
/// Exit status for a call the program does not understand.
const USAGE_EXIT_CODE: u8 = 2;
/// Microseconds in a millisecond and in a second.
const USEC_PER_MILLISECOND: u64 = 1_000;
const USEC_PER_SECOND: u64 = 1_000_000;
/// The interval between ticks without the flag: the sampler's own.
const DEFAULT_TICK_INTERVAL_USEC: u64 = SAMPLE_INTERVAL_SECONDS * USEC_PER_SECOND;

/// What the flags ask for.
#[derive(Debug, PartialEq, Eq)]
enum ProgramMode {
    PrintConstants,
    PrintSourceHash,
    PrintSamples(SamplerSettings),
    Serve(SamplerSettings),
}

/// What a flag that prints one answer and exits asks for. A run has at most one kind: one answer per
/// run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PrintAndExit {
    Constants,
    SourceHash,
}

/// Prints the constants or the source hash, writes Samples to stdout, or serves on the session bus; a flag it does not
/// know is a usage error. The panic hook goes in first, so that no panic can come before it; then
/// whether stderr is the journal is worked out, once, before any line is written.
fn main() -> ExitCode {
    install_panic_hook();
    detect_journal_stream();
    let arguments: Vec<OsString> = std::env::args_os().skip(1).collect();
    match parse_arguments(&arguments) {
        Some(ProgramMode::PrintConstants) => print_constants(),
        Some(ProgramMode::PrintSourceHash) => print_source_hash(),
        Some(ProgramMode::PrintSamples(settings)) => print_samples(&settings),
        Some(ProgramMode::Serve(settings)) => serve(&settings),
        None => {
            // A usage error exits with a failure, so its line is an error.
            write_log_line(LinePriority::Error, USAGE_LINE);
            ExitCode::from(USAGE_EXIT_CODE)
        }
    }
}

/// Reads the flags: `--print-constants`, `--source-hash`, `--print`, `--fs-root <path>` (a path that
/// is not empty) and `--tick-interval-ms <n>` (a whole number of at least 1), each optional, a later
/// one winning. Anything else, a flag without its value, or a flag that is not valid text, is None.
///
/// The print-and-exit flags give one answer per run: a call with two different ones is None, and
/// the same one twice is that one. `--print-constants` wins over the run flags, as it opens nothing.
/// `--source-hash` reads nothing and has no use for them, so a call with one of them is None.
fn parse_arguments(arguments: &[OsString]) -> Option<ProgramMode> {
    let mut remaining_arguments = arguments.iter();
    let mut print_and_exit: Option<PrintAndExit> = None;
    let mut should_print_samples = false;
    let mut has_fs_root_flag = false;
    let mut has_tick_interval_flag = false;
    let mut settings = SamplerSettings {
        fs_root: PathBuf::from(DEFAULT_FS_ROOT),
        tick_interval_usec: DEFAULT_TICK_INTERVAL_USEC,
    };
    while let Some(argument) = remaining_arguments.next() {
        match argument.to_str()? {
            PRINT_CONSTANTS_FLAG => {
                choose_print_and_exit(&mut print_and_exit, PrintAndExit::Constants)?
            }
            SOURCE_HASH_FLAG => {
                choose_print_and_exit(&mut print_and_exit, PrintAndExit::SourceHash)?
            }
            PRINT_FLAG => should_print_samples = true,
            FS_ROOT_FLAG => {
                settings.fs_root = parse_fs_root(remaining_arguments.next()?)?;
                has_fs_root_flag = true;
            }
            TICK_INTERVAL_FLAG => {
                settings.tick_interval_usec =
                    parse_tick_interval_usec(remaining_arguments.next()?.to_str()?)?;
                has_tick_interval_flag = true;
            }
            _ => return None,
        }
    }
    let has_run_flag = should_print_samples || has_fs_root_flag || has_tick_interval_flag;
    match print_and_exit {
        Some(PrintAndExit::Constants) => Some(ProgramMode::PrintConstants),
        Some(PrintAndExit::SourceHash) => (!has_run_flag).then_some(ProgramMode::PrintSourceHash),
        None if should_print_samples => Some(ProgramMode::PrintSamples(settings)),
        None => Some(ProgramMode::Serve(settings)),
    }
}

/// Records a print-and-exit flag; None when a different one was already given.
fn choose_print_and_exit(chosen: &mut Option<PrintAndExit>, requested: PrintAndExit) -> Option<()> {
    match chosen {
        Some(already_chosen) if *already_chosen != requested => None,
        _ => {
            *chosen = Some(requested);
            Some(())
        }
    }
}

/// The root to read under; an empty path is refused, as it would read relative to wherever the
/// program was started.
fn parse_fs_root(path_argument: &OsString) -> Option<PathBuf> {
    (!path_argument.is_empty()).then(|| PathBuf::from(path_argument))
}

/// A tick interval given in milliseconds, in microseconds; zero is refused, as it would never wait,
/// and so is one too long to count in microseconds.
fn parse_tick_interval_usec(milliseconds_text: &str) -> Option<u64> {
    let milliseconds: u64 = milliseconds_text.parse().ok()?;
    let interval_usec = milliseconds.checked_mul(USEC_PER_MILLISECOND)?;
    (interval_usec > 0).then_some(interval_usec)
}

// Tests may unwrap, index and panic: a failing test should say so loudly.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::string_slice,
    clippy::panic
)]
#[path = "main_tests.rs"]
mod tests;
