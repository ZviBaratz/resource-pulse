//! The journal's side of a line, without the journal: whether stderr is it, decided from a value and
//! a device and inode the row gives, and the text a line becomes either way. Nothing here reads the
//! test process's own environment or stderr.

use super::*;

/// The device and inode the rows give as stderr's, and the `JOURNAL_STREAM` value naming them.
const STDERR_DEVICE: u64 = 2_049;
const STDERR_INODE: u64 = 4_211_532;
const MATCHING_JOURNAL_STREAM: &str = "2049:4211532";
/// A line of the program's, as the program writes them.
const PROGRAM_LINE: &str = "resource-pulse: cannot read /proc/pressure/io: gone";
/// Every priority a line can have.
const EVERY_PRIORITY: [LinePriority; 3] = [
    LinePriority::Info,
    LinePriority::Warning,
    LinePriority::Error,
];

/// Stderr is the journal only when `JOURNAL_STREAM` is the device and inode of the file stderr is,
/// each in decimal around one colon: a stream of another inode or device (a child that inherited
/// the variable with its stderr sent elsewhere), no variable, an empty one, and anything that is not
/// two numbers are not the journal.
#[test]
fn stderr_is_the_journal_only_when_journal_stream_names_its_device_and_inode() {
    let another_inode = format!("{STDERR_DEVICE}:{}", STDERR_INODE + 1);
    let another_device = format!("{}:{STDERR_INODE}", STDERR_DEVICE + 1);
    let journal_stream_values: [Option<&str>; 10] = [
        Some(MATCHING_JOURNAL_STREAM),
        Some(&another_inode),
        Some(&another_device),
        None,
        Some(""),
        Some("2049"),
        Some("2049:"),
        Some(":4211532"),
        Some("2049:4211532:7"),
        Some("dev:ino"),
    ];
    let decisions =
        journal_stream_values.map(|value| is_journal_stream(value, STDERR_DEVICE, STDERR_INODE));
    assert_eq!(
        decisions,
        [true, false, false, false, false, false, false, false, false, false]
    );
}

/// Under the journal, a warning starts with `<4>` and an error with `<3>`, right before the text,
/// and an information line has no prefix; each ends with one newline.
#[test]
fn a_warning_and_an_error_are_prefixed_under_the_journal_and_an_info_line_never_is() {
    let journal_texts = EVERY_PRIORITY.map(|priority| log_text(priority, PROGRAM_LINE, true));
    assert_eq!(
        journal_texts,
        [
            format!("{PROGRAM_LINE}\n"),
            format!("<4>{PROGRAM_LINE}\n"),
            format!("<3>{PROGRAM_LINE}\n"),
        ]
    );
}

/// Outside the journal (a terminal, a pipe, every row) a line is written as it is, whatever its
/// priority: the line and a newline.
#[test]
fn no_line_is_prefixed_outside_the_journal() {
    let plain_texts = EVERY_PRIORITY.map(|priority| log_text(priority, PROGRAM_LINE, false));
    assert_eq!(plain_texts, [(); 3].map(|()| format!("{PROGRAM_LINE}\n")));
}

/// A line that holds newlines (a panic's text can): the journal reads each physical line on its
/// own, so under the journal each carries the prefix, or the rest of a warning would be stored as
/// information; outside it, the text is written unchanged.
#[test]
fn under_the_journal_every_physical_line_of_a_line_carries_its_prefix() {
    let multi_line = "resource-pulse: tick failed: assertion failed\n  left: 1\n right: 2";
    assert_eq!(
        (
            log_text(LinePriority::Warning, multi_line, true),
            log_text(LinePriority::Warning, multi_line, false),
        ),
        (
            "<4>resource-pulse: tick failed: assertion failed\n<4>  left: 1\n<4> right: 2\n"
                .to_string(),
            format!("{multi_line}\n"),
        )
    );
}
