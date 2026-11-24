//! How a line of the program's reaches stderr, and how the journal ranks it.
//!
//! - **Every line is written with a priority.** Under systemd, stderr is the journal, which stores
//!   a line as information unless it starts with a syslog priority prefix (`sd-daemon.h`'s `<4>`
//!   for a warning, `<3>` for an error). So under the journal a warning's or an error's line carries
//!   its prefix at the very start, on each of its physical lines, as the journal reads every line on
//!   its own; an information line carries none. Anywhere else (a terminal, a pipe, every row) no
//!   line has a prefix, and the text is written as it is.
//! - **Whether stderr is the journal is worked out once,** at start-up ([`detect_journal_stream`]):
//!   systemd sets `JOURNAL_STREAM` to `<device>:<inode>` of the stream it connects stderr to
//!   (systemd.exec(5)), and the program compares that with the device and inode of the file open
//!   as its file descriptor 2. A child that inherited the variable with its stderr sent elsewhere
//!   does not match; any failure to read either side means "not the journal".
//! - **Writing never panics:** a line that cannot be written has nowhere else to go.

use std::fs::File;
use std::io::{self, Write};
use std::os::fd::AsFd;
use std::os::unix::fs::MetadataExt;
use std::sync::OnceLock;

/// The variable systemd sets, for a process whose stderr it connects to the journal, to that
/// stream's `<device>:<inode>`, each in decimal (systemd.exec(5)).
const JOURNAL_STREAM_VARIABLE: &str = "JOURNAL_STREAM";
/// What separates the device from the inode in `JOURNAL_STREAM`'s value.
const JOURNAL_STREAM_SEPARATOR: char = ':';
/// The syslog priority prefixes the journal reads at the start of a line (`sd-daemon.h`'s
/// `SD_WARNING` and `SD_ERR`).
const WARNING_PRIORITY_PREFIX: &str = "<4>";
const ERROR_PRIORITY_PREFIX: &str = "<3>";
/// No prefix: an information line's under the journal (which takes a line without one as
/// information), and every line's anywhere else.
const NO_PREFIX: &str = "";
/// What ends each physical line of a text.
const LINE_END: char = '\n';

/// Whether stderr is the journal, worked out once for the life of the process: neither the
/// environment nor the file open as stderr changes after the start.
static IS_STDERR_THE_JOURNAL: OnceLock<bool> = OnceLock::new();

/// How the journal is to rank a line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinePriority {
    /// Routine: the "serving" line, and a clean ending's line. No prefix.
    Info,
    /// A failure the program goes on from: each line of the sampler's and the program's failure
    /// logs, a caught panic's included (the gjs service wrote them with `console.warn`). `<4>`
    /// under the journal.
    Warning,
    /// The lines of an ending whose exit status is not 0. `<3>` under the journal.
    Error,
}

impl LinePriority {
    /// The prefix that tells the journal this priority, at the start of each physical line.
    fn journal_prefix(self) -> &'static str {
        match self {
            LinePriority::Info => NO_PREFIX,
            LinePriority::Warning => WARNING_PRIORITY_PREFIX,
            LinePriority::Error => ERROR_PRIORITY_PREFIX,
        }
    }
}

/// Works out whether stderr is the journal, once, so that the answer is taken at start-up; `main`
/// calls it first thing. A line written before it was called works it out the same way.
pub fn detect_journal_stream() {
    is_stderr_the_journal();
}

/// Writes one line to stderr; under the journal, a warning or an error is prefixed `<4>` or `<3>`.
/// Never panics: a line that cannot be written is dropped, as it has nowhere else to go.
pub fn write_log_line(priority: LinePriority, line: &str) {
    let text = log_text(priority, line, is_stderr_the_journal());
    let _ = io::stderr().lock().write_all(text.as_bytes());
}

/// Whether stderr is the journal: worked out at the first call, from `JOURNAL_STREAM` and the file
/// open as stderr, and the same answer at every later one. The panic hook asks it too, to choose
/// between its own text and std's.
pub(crate) fn is_stderr_the_journal() -> bool {
    *IS_STDERR_THE_JOURNAL.get_or_init(|| {
        // A value that is not valid text cannot name a device and inode: not the journal.
        let journal_stream_value = std::env::var(JOURNAL_STREAM_VARIABLE).ok();
        stderr_device_and_inode().is_some_and(|(stderr_device, stderr_inode)| {
            is_journal_stream(journal_stream_value.as_deref(), stderr_device, stderr_inode)
        })
    })
}

/// The device and inode of the file open as file descriptor 2, read through a duplicate of it, or
/// `None` when either step fails (no stderr at all, say).
fn stderr_device_and_inode() -> Option<(u64, u64)> {
    let stderr_duplicate = io::stderr().as_fd().try_clone_to_owned().ok()?;
    let stderr_metadata = File::from(stderr_duplicate).metadata().ok()?;
    Some((stderr_metadata.dev(), stderr_metadata.ino()))
}

/// Whether stderr is the journal: `JOURNAL_STREAM` is `<device>:<inode>` of the file stderr is.
/// No value, an empty one, or one that is not two decimal numbers around one colon is not.
fn is_journal_stream(
    journal_stream_value: Option<&str>,
    stderr_device: u64,
    stderr_inode: u64,
) -> bool {
    let Some((device_text, inode_text)) =
        journal_stream_value.and_then(|value| value.split_once(JOURNAL_STREAM_SEPARATOR))
    else {
        return false;
    };
    let (Ok(journal_device), Ok(journal_inode)) =
        (device_text.parse::<u64>(), inode_text.parse::<u64>())
    else {
        return false;
    };
    journal_device == stderr_device && journal_inode == stderr_inode
}

/// The text written for `line`: each of its physical lines, with the priority's prefix in front
/// when stderr is the journal, and a newline after. Outside the journal that is the line as it is
/// and one newline.
fn log_text(priority: LinePriority, line: &str, is_journal: bool) -> String {
    let prefix = if is_journal {
        priority.journal_prefix()
    } else {
        NO_PREFIX
    };
    let mut text = String::with_capacity(line.len() + prefix.len() + 1);
    for physical_line in line.split(LINE_END) {
        text.push_str(prefix);
        text.push_str(physical_line);
        text.push(LINE_END);
    }
    text
}

#[cfg(test)]
mod tests;
