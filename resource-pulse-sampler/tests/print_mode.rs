//! The program run whole with `--print`, which opens no bus connection: one JSON line per publish on
//! stdout, a reader that goes away ending it quietly with status 0, and the clock label in the local
//! time `TZ` gives. Every run reads the fixture root `gnome-shell/tests/fixtures/root-a`, never the
//! host's `/proc`, and is killed if a row fails before it ends. Nothing here sets a clock or a
//! time zone outside a child's own environment.

// Tests may unwrap, expect, index and panic: a failing test should say so loudly.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic
)]

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{ChildStdout, Command, Stdio};

mod common;

use common::{fixture_root, read_stderr, wait_for_exit, ChildGuard};
use serde_json::Value;

/// The program under test.
const SAMPLER_PROGRAM_PATH: &str = env!("CARGO_BIN_EXE_resource-pulse-sampler");
/// Ticks this fast make the rows quick.
const FAST_TICK_INTERVAL_MS: &str = "50";
/// How many Samples the print row reads before it lets go of the pipe.
const PRINTED_SAMPLE_COUNT: u64 = 3;
/// The variable a C library reads the local time zone from.
const TIME_ZONE_VARIABLE: &str = "TZ";
/// The two zones of the label row, nine hours apart all year (neither has summer time).
const UTC_TIME_ZONE: &str = "UTC";
const TOKYO_TIME_ZONE: &str = "Asia/Tokyo";
const TOKYO_ZONE_FILE: &str = "/usr/share/zoneinfo/Asia/Tokyo";
const TOKYO_OFFSET_MINUTES: i64 = 9 * 60;
/// The two runs read the clock a moment apart, so the minute may turn between them.
const LABEL_TOLERANCE_MINUTES: i64 = 1;
const MINUTES_PER_HOUR: i64 = 60;
const MINUTES_PER_DAY: i64 = 24 * MINUTES_PER_HOUR;

/// Starts `--print` on root-a, ticking fast, its stdout and stderr piped, with `TZ` set when given.
fn spawn_print_mode(time_zone: Option<&str>) -> (ChildGuard, BufReader<ChildStdout>) {
    let mut command = Command::new(SAMPLER_PROGRAM_PATH);
    common::pin_data_directories(&mut command);
    command
        .arg("--print")
        .arg("--fs-root")
        .arg(fixture_root("root-a"))
        .args(["--tick-interval-ms", FAST_TICK_INTERVAL_MS])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(time_zone) = time_zone {
        command.env(TIME_ZONE_VARIABLE, time_zone);
    }
    let mut child = ChildGuard(command.spawn().expect("the program starts"));
    let stdout = BufReader::new(child.0.stdout.take().expect("a stdout pipe"));
    (child, stdout)
}

/// The next line on the program's stdout, parsed.
fn read_sample(stdout: &mut BufReader<ChildStdout>) -> Value {
    let mut line = String::new();
    let byte_count = stdout.read_line(&mut line).expect("stdout can be read");
    assert!(byte_count > 0, "the program closed its stdout");
    serde_json::from_str(line.trim_end()).unwrap_or_else(|error| panic!("{error}: {line:?}"))
}

/// `HH:MM` as minutes since midnight.
fn minutes_of_label(label: &Value) -> i64 {
    let label_text = label.as_str().expect("the label is text");
    let (hours, minutes) = label_text.split_once(':').expect("HH:MM");
    hours.parse::<i64>().unwrap() * MINUTES_PER_HOUR + minutes.parse::<i64>().unwrap()
}

/// The first Sample's clock label under a time zone.
fn first_clock_label_under(time_zone: &str) -> Value {
    let (_child, mut stdout) = spawn_print_mode(Some(time_zone));
    read_sample(&mut stdout)["snapshot"]["takenAtClockLabel"].clone()
}

/// One line per publish, numbered from 1, each a whole Sample; and once its reader has gone, the
/// program ends by itself, with status 0 and nothing on stderr: a closed pipe is not a failure.
#[test]
fn print_writes_one_sample_per_publish_and_ends_quietly_with_0_once_its_reader_leaves() {
    let (mut child, mut stdout) = spawn_print_mode(None);
    let samples: Vec<Value> = (0..PRINTED_SAMPLE_COUNT)
        .map(|_| read_sample(&mut stdout))
        .collect();
    drop(stdout);
    let exit_status = wait_for_exit(&mut child);
    let stderr_text = exit_status.map_or_else(String::new, |_| read_stderr(&mut child));
    let sequences: Vec<Value> = samples
        .iter()
        .map(|sample| sample["sequence"].clone())
        .collect();
    let are_whole_samples = samples.iter().all(|sample| {
        sample["snapshot"]["memory"].is_object()
            && sample["appendedHistory"].is_object()
            && sample["sampledAtUsec"].is_u64()
    });
    assert_eq!(
        (
            sequences,
            are_whole_samples,
            exit_status.and_then(|status| status.code()),
            stderr_text,
        ),
        (
            (1..=PRINTED_SAMPLE_COUNT).map(Value::from).collect(),
            true,
            Some(0),
            String::new()
        )
    );
}

/// The clock label is local time: the first label under `TZ=UTC` and
/// under `TZ=Asia/Tokyo` are nine hours apart, modulo a day, give or take a minute.
#[test]
fn the_clock_label_is_local_time() {
    assert!(
        Path::new(TOKYO_ZONE_FILE).is_file(),
        "could not run: no zone file at {TOKYO_ZONE_FILE}, so TZ={TOKYO_TIME_ZONE} would read as UTC"
    );
    let utc_label = first_clock_label_under(UTC_TIME_ZONE);
    let tokyo_label = first_clock_label_under(TOKYO_TIME_ZONE);
    let offset_minutes =
        (minutes_of_label(&tokyo_label) - minutes_of_label(&utc_label)).rem_euclid(MINUTES_PER_DAY);
    assert!(
        (offset_minutes - TOKYO_OFFSET_MINUTES).abs() <= LABEL_TOLERANCE_MINUTES,
        "{UTC_TIME_ZONE} {utc_label}, {TOKYO_TIME_ZONE} {tokyo_label}: {offset_minutes} minutes apart"
    );
}
