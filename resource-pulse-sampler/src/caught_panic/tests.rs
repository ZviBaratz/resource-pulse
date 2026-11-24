use std::fs::{self, File};
use std::os::unix::fs::MetadataExt;
use std::panic::panic_any;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;
use crate::log_line::detect_journal_stream;

/// The file a panic raised in these tests is located in.
const THIS_FILE: &str = "src/caught_panic/tests.rs";
/// The child test the hook row runs in a process of its own.
const HOOK_CHILD_TEST_NAME: &str = "caught_panic::tests::panic_hook_child_process";
/// The messages the child plants inside a catch and outside one.
const PLANTED_INSIDE_MESSAGE: &str = "planted inside a catch";
const PLANTED_OUTSIDE_MESSAGE: &str = "planted outside a catch";
/// The name of the child's thread that panics outside a catch, as the default line names it.
const OUTSIDE_THREAD_NAME: &str = "planted-outside-a-catch";

/// The message and the location of a caught panic's text, split at the last " at ".
fn message_and_location(caught_text: &str) -> (&str, &str) {
    caught_text.rsplit_once(LOCATION_SEPARATOR).unwrap()
}

/// Whether a location is `file:line:column` in the given file.
fn is_location_in(location: &str, file: &str) -> bool {
    let Some(line_and_column) = location.strip_prefix(&format!("{file}:")) else {
        return false;
    };
    let parts: Vec<&str> = line_and_column.split(':').collect();
    parts.len() == 2 && parts.iter().all(|part| part.parse::<u32>().is_ok())
}

/// A formatted message is caught as its text, with the place it was raised.
#[test]
fn a_panic_with_a_formatted_message_gives_the_formatted_text_and_where_it_happened() {
    install_panic_hook();
    let reason = "disk on fire";
    let caught_text = catching_panic(|| -> u32 { panic!("{reason}") }).unwrap_err();
    let (message, location) = message_and_location(&caught_text);
    assert!(
        message == "disk on fire" && is_location_in(location, THIS_FILE),
        "{caught_text:?}"
    );
}

/// A payload that is not text is caught as the fixed text, with the place it was raised.
#[test]
fn a_panic_whose_payload_is_not_text_gives_the_fixed_text() {
    install_panic_hook();
    let caught_text = catching_panic(|| -> u32 { panic_any(42_i32) }).unwrap_err();
    let (message, location) = message_and_location(&caught_text);
    assert!(
        message == NON_TEXT_PANIC_TEXT && is_location_in(location, THIS_FILE),
        "{caught_text:?}"
    );
}

/// A panic inside `value_or_none` gives `None` and leaves no location behind: a later catch's
/// text names its own panic's place, and a catch whose step returned leaves none either.
#[test]
fn value_or_none_leaves_no_location_for_the_next_catch() {
    install_panic_hook();
    let best_effort: Option<u32> = value_or_none(|| panic!("ignored"));
    let left_behind = take_caught_panic_location();
    let returned = catching_panic(|| 7_u32);
    assert_eq!((best_effort, left_behind, returned), (None, None, Ok(7)));
}

/// Not a row of its own: the child process of the hook row below, which runs it alone with
/// `--ignored`. It installs the hook, panics inside a catch (whose text must carry this file's
/// location), then panics on a thread of its own, outside any catch.
#[test]
#[ignore = "run in a process of its own by the panic hook row"]
fn panic_hook_child_process() {
    install_panic_hook();
    let caught_text = catching_panic(|| -> u32 { panic!("{PLANTED_INSIDE_MESSAGE}") }).unwrap_err();
    let (message, location) = message_and_location(&caught_text);
    assert!(
        message == PLANTED_INSIDE_MESSAGE && is_location_in(location, THIS_FILE),
        "{caught_text:?}"
    );
    let outside_catch = std::thread::Builder::new()
        .name(OUTSIDE_THREAD_NAME.to_string())
        .spawn(|| panic!("{PLANTED_OUTSIDE_MESSAGE}"))
        .unwrap()
        .join();
    assert!(outside_catch.is_err());
}

/// The hook, as the program installs it, writes nothing for a panic inside a catch and the
/// default hook's line for one outside: run in a child process, so the default hook writes to a
/// stderr this test reads, and this process's hook is never touched.
#[test]
fn the_panic_hook_is_quiet_inside_a_catch_and_writes_the_default_line_outside_one() {
    let child_output = Command::new(std::env::current_exe().unwrap())
        .args([
            HOOK_CHILD_TEST_NAME,
            "--exact",
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env("RUST_BACKTRACE", "0")
        .output()
        .unwrap();
    let child_stderr = String::from_utf8_lossy(&child_output.stderr);
    let panic_lines: Vec<&str> = child_stderr
        .lines()
        .filter(|line| line.contains(" panicked at "))
        .collect();
    let expected_line_start = format!("thread '{OUTSIDE_THREAD_NAME}'");
    let expected_line_place = format!(" panicked at {THIS_FILE}:");
    assert!(
        child_output.status.success()
            && panic_lines.len() == 1
            && panic_lines[0].starts_with(&expected_line_start)
            && panic_lines[0].contains(&expected_line_place)
            && child_stderr.contains(PLANTED_OUTSIDE_MESSAGE)
            && !child_stderr.contains(PLANTED_INSIDE_MESSAGE),
        "exit {:?}, stderr {child_stderr:?}",
        child_output.status
    );
}

/// The child test the uncaught-panic rows run in a process of their own, the variable that tells
/// it which hook to panic under, and its two values: the program's hook, installed as `main`
/// installs it, or std's own.
const UNCAUGHT_CHILD_TEST_NAME: &str = "caught_panic::tests::uncaught_panic_child_process";
const CHILD_HOOK_VARIABLE: &str = "RESOURCE_PULSE_TEST_PANIC_HOOK";
const PROGRAM_HOOK: &str = "program";
const STD_HOOK: &str = "std";
/// The variable systemd sets when stderr is the journal, and the one std's hook reads for a
/// backtrace, with the two styles the rows use: none, and the short form.
const JOURNAL_STREAM_VARIABLE: &str = "JOURNAL_STREAM";
const BACKTRACE_VARIABLE: &str = "RUST_BACKTRACE";
const NO_BACKTRACE_STYLE: &str = "0";
const SHORT_BACKTRACE_STYLE: &str = "1";
/// The thread the child panics on, outside any catch, and its message, of two lines.
const UNCAUGHT_THREAD_NAME: &str = "planted-uncaught";
const UNCAUGHT_MESSAGE: &str = "planted outside any catch\nits second line";
/// The journal's prefix for an error, and the line std's hook leads a backtrace with.
const ERROR_PREFIX: &str = "<3>";
const BACKTRACE_HEADING_LINE: &str = "stack backtrace:";
/// Numbers each child's stderr file, so that rows running at once never share one.
static CHILD_STDERR_FILE_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Not a row of its own: the child process of the uncaught-panic rows below, which run it alone
/// with `--ignored`. Under the hook its parent names (the program's, then whether stderr is the
/// journal worked out, as `main` does; or std's own), it panics on a thread of its own, outside
/// any catch.
#[test]
#[ignore = "run in a process of its own by the uncaught-panic rows"]
fn uncaught_panic_child_process() {
    let hook = std::env::var(CHILD_HOOK_VARIABLE).unwrap();
    assert!(
        [PROGRAM_HOOK, STD_HOOK].contains(&hook.as_str()),
        "{hook:?}"
    );
    if hook == PROGRAM_HOOK {
        install_panic_hook();
        detect_journal_stream();
    }
    let uncaught = std::thread::Builder::new()
        .name(UNCAUGHT_THREAD_NAME.to_string())
        .spawn(|| panic!("{UNCAUGHT_MESSAGE}"))
        .unwrap()
        .join();
    assert!(uncaught.is_err());
}

/// What `JOURNAL_STREAM` a child gets.
#[derive(Clone, Copy)]
enum ChildJournalStream {
    /// None at all.
    Unset,
    /// The device and inode of the file its stderr is: stderr is the journal.
    NamingItsStderr,
    /// Another inode: a variable inherited with stderr sent elsewhere.
    NamingAnotherInode,
}

/// What the child writes on stderr, a file of its own, when it panics under `hook`, with
/// `RUST_BACKTRACE` set to `backtrace_style` and `JOURNAL_STREAM` as `journal_stream` says, and
/// nothing else of this process's environment.
fn uncaught_panic_child_stderr(
    hook: &str,
    journal_stream: ChildJournalStream,
    backtrace_style: &str,
) -> String {
    let file_number = CHILD_STDERR_FILE_COUNT.fetch_add(1, Ordering::Relaxed);
    let file_name = format!("rp-uncaught-panic-{}-{file_number}.err", std::process::id());
    let stderr_path = std::env::temp_dir().join(file_name);
    let stderr_file = File::create(&stderr_path).unwrap();
    let stderr_metadata = stderr_file.metadata().unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            UNCAUGHT_CHILD_TEST_NAME,
            "--exact",
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env_clear()
        .env(CHILD_HOOK_VARIABLE, hook)
        .env(BACKTRACE_VARIABLE, backtrace_style)
        .stdout(Stdio::null())
        .stderr(stderr_file);
    let stderr_device = stderr_metadata.dev();
    let stderr_inode = stderr_metadata.ino();
    match journal_stream {
        ChildJournalStream::Unset => {}
        ChildJournalStream::NamingItsStderr => {
            command.env(
                JOURNAL_STREAM_VARIABLE,
                format!("{stderr_device}:{stderr_inode}"),
            );
        }
        ChildJournalStream::NamingAnotherInode => {
            let other_inode = stderr_inode + 1;
            command.env(
                JOURNAL_STREAM_VARIABLE,
                format!("{stderr_device}:{other_inode}"),
            );
        }
    }
    let child_status = command.status().unwrap();
    let stderr_text = fs::read_to_string(&stderr_path).unwrap();
    fs::remove_file(&stderr_path).unwrap();
    assert!(
        child_status.success(),
        "the child did not run to its end: {child_status:?}, stderr {stderr_text:?}"
    );
    stderr_text
}

/// The text with the thread id std writes after a thread's name (`thread 'x' (12345) panicked`)
/// taken out of each line: it differs from run to run.
fn without_thread_ids(text: &str) -> String {
    let lines_without_ids: Vec<String> = text
        .split('\n')
        .map(|line| {
            let Some((before_id, from_id)) = line.split_once("' (") else {
                return line.to_string();
            };
            match from_id.split_once(") ") {
                Some((thread_id, after_id)) if thread_id.chars().all(|c| c.is_ascii_digit()) => {
                    format!("{before_id}' {after_id}")
                }
                _ => line.to_string(),
            }
        })
        .collect();
    lines_without_ids.join("\n")
}

/// Under the journal (`JOURNAL_STREAM` names the file the child's stderr is), a panic nothing
/// caught is an error: every line it writes starts with `<3>`, the first naming the thread and the
/// place, then each line of its message, and nothing else.
#[test]
fn an_uncaught_panic_under_the_journal_is_an_error_on_every_line() {
    let stderr_text = uncaught_panic_child_stderr(
        PROGRAM_HOOK,
        ChildJournalStream::NamingItsStderr,
        NO_BACKTRACE_STYLE,
    );
    let lines: Vec<&str> = stderr_text.lines().collect();
    let first_line_start =
        format!("{ERROR_PREFIX}thread '{UNCAUGHT_THREAD_NAME}' panicked at {THIS_FILE}:");
    let expected_message_lines: Vec<String> = UNCAUGHT_MESSAGE
        .lines()
        .map(|message_line| format!("{ERROR_PREFIX}{message_line}"))
        .collect();
    assert_eq!(
        (
            lines
                .first()
                .is_some_and(|line| line.starts_with(&first_line_start)),
            lines.get(1..).map(<[&str]>::to_vec),
        ),
        (
            true,
            Some(expected_message_lines.iter().map(String::as_str).collect())
        ),
        "{stderr_text:?}"
    );
}

/// Outside the journal, a panic nothing caught reads exactly as std's own hook writes it, which the
/// program's hook hands it to: with no `JOURNAL_STREAM`, and with one naming another inode (a
/// variable inherited with stderr sent elsewhere), the text is the one std writes with no hook of
/// the program's installed, but for the thread id std writes, which differs from run to run.
#[test]
fn an_uncaught_panic_outside_the_journal_reads_as_std_writes_it() {
    let std_text = without_thread_ids(&uncaught_panic_child_stderr(
        STD_HOOK,
        ChildJournalStream::Unset,
        NO_BACKTRACE_STYLE,
    ));
    let program_texts = [
        ChildJournalStream::Unset,
        ChildJournalStream::NamingAnotherInode,
    ]
    .map(|journal_stream| {
        without_thread_ids(&uncaught_panic_child_stderr(
            PROGRAM_HOOK,
            journal_stream,
            NO_BACKTRACE_STYLE,
        ))
    });
    let first_message_line = UNCAUGHT_MESSAGE.lines().next().unwrap();
    assert_eq!(
        (std_text.contains(first_message_line), program_texts),
        (true, [std_text.clone(), std_text])
    );
}

/// Under the journal, the backtrace `RUST_BACKTRACE` asks for is written too, under std's
/// `stack backtrace:` heading (its frames start with the hook's own), and every line of it is an
/// error.
#[test]
fn an_uncaught_panics_backtrace_under_the_journal_is_an_error_on_every_line() {
    let stderr_text = uncaught_panic_child_stderr(
        PROGRAM_HOOK,
        ChildJournalStream::NamingItsStderr,
        SHORT_BACKTRACE_STYLE,
    );
    let lines: Vec<&str> = stderr_text.lines().collect();
    let backtrace_heading = format!("{ERROR_PREFIX}{BACKTRACE_HEADING_LINE}");
    let frame_line_count = lines
        .iter()
        .skip_while(|line| **line != backtrace_heading)
        .skip(1)
        .count();
    assert_eq!(
        (
            frame_line_count > 0,
            lines.iter().all(|line| line.starts_with(ERROR_PREFIX)),
        ),
        (true, true),
        "{stderr_text:?}"
    );
}
