use std::time::Duration;

use super::*;

/// How long the monotonic row sleeps between its two reads.
const MONOTONIC_GAP: Duration = Duration::from_millis(20);
/// Far more than the sleep can take on a loaded machine, and far less than a wrong unit (seconds
/// or nanoseconds read as microseconds) would give.
const MAX_MONOTONIC_GAP_USEC: u64 = 2_000_000;

/// Two reads of the monotonic clock 20 ms apart differ by at least 20 ms and by far less than a
/// wrong unit would make them, and neither is 0.
#[test]
fn the_monotonic_clock_counts_microseconds() {
    let first_usec = SystemClock.monotonic_usec();
    std::thread::sleep(MONOTONIC_GAP);
    let second_usec = SystemClock.monotonic_usec();
    let gap_usec = second_usec.saturating_sub(first_usec);
    let min_gap_usec = u64::try_from(MONOTONIC_GAP.as_micros()).unwrap();
    assert!(
        first_usec > 0 && gap_usec >= min_gap_usec && gap_usec < MAX_MONOTONIC_GAP_USEC,
        "first {first_usec} µs, then {gap_usec} µs later"
    );
}

/// The boot clock reads, and is never behind the monotonic clock read just before it: it is the
/// monotonic clock plus the time suspended.
#[test]
fn the_boot_clock_is_never_behind_the_monotonic_clock() {
    let monotonic_usec = SystemClock.monotonic_usec();
    let boottime_usec = SystemSuspendClock.boottime_usec();
    assert!(
        boottime_usec.is_some_and(|boottime_usec| boottime_usec >= monotonic_usec),
        "monotonic {monotonic_usec} µs, boot {boottime_usec:?}"
    );
}

/// The kernel's uptime file, whose first field is `CLOCK_BOOTTIME` in seconds, to the hundredth.
const UPTIME_PATH: &str = "/proc/uptime";
/// How far the uptime file's figure may lie below the boot clock: it is cut to a hundredth of a
/// second.
const UPTIME_RESOLUTION_USEC: u64 = 10_000;

/// The uptime file's first field (seconds, a point, two digits) in microseconds.
fn uptime_usec(uptime_text: &str) -> u64 {
    let seconds_field = uptime_text.split_whitespace().next().unwrap();
    let (whole_seconds, hundredths) = seconds_field.split_once('.').unwrap();
    let whole_seconds: u64 = whole_seconds.parse().unwrap();
    let hundredths: u64 = hundredths.parse().unwrap();
    whole_seconds * USEC_PER_SECOND + hundredths * UPTIME_RESOLUTION_USEC
}

/// The boot clock is the clock the uptime file counts: read before and after it, it brackets the
/// file's figure, to the file's hundredth of a second. The wall clock in its place would miss by
/// decades; the monotonic clock would miss only on a machine suspended since it booted, which a
/// test machine may not be.
#[test]
fn the_boot_clock_is_the_uptime_files_clock() {
    let before_usec = SystemSuspendClock.boottime_usec().unwrap();
    let uptime_text = std::fs::read_to_string(UPTIME_PATH).unwrap();
    let after_usec = SystemSuspendClock.boottime_usec().unwrap();
    let file_usec = uptime_usec(&uptime_text);
    assert!(
        file_usec + UPTIME_RESOLUTION_USEC >= before_usec && file_usec <= after_usec,
        "boot clock {before_usec} to {after_usec} µs, {UPTIME_PATH} {uptime_text:?}"
    );
}

/// A `timespec` becomes microseconds; a negative one is 0 and one past the range saturates.
#[test]
fn a_timespec_becomes_microseconds_never_negative_and_saturating() {
    assert_eq!(
        [
            usec_of_timespec(1, 500_000_999),
            usec_of_timespec(-1, 0),
            usec_of_timespec(0, -1),
            usec_of_timespec(i64::MAX, 999_999_999),
        ],
        [1_500_000, 0, 0, u64::MAX]
    );
}

/// The wall clock counts from the epoch; a time before it (a clock set back past 1970) is 0, not
/// a negative figure or a panic.
#[test]
fn a_wall_clock_before_the_epoch_is_0_and_after_it_counts_microseconds() {
    let before_epoch = UNIX_EPOCH - Duration::from_secs(1);
    let after_epoch = UNIX_EPOCH + Duration::from_micros(1_794_000_000_000_123);
    assert_eq!(
        [
            usec_since_epoch(before_epoch),
            usec_since_epoch(after_epoch)
        ],
        [0, 1_794_000_000_000_123]
    );
}

/// The label is two digits, a colon and two digits.
#[test]
fn the_clock_label_is_two_digit_hours_and_minutes() {
    let label = SystemClock.clock_label().unwrap();
    let (hours, minutes) = label.split_once(':').unwrap();
    let is_two_digits = |part: &str| part.len() == 2 && part.bytes().all(|b| b.is_ascii_digit());
    assert!(
        is_two_digits(hours)
            && is_two_digits(minutes)
            && hours.parse::<u8>().unwrap() < 24
            && minutes.parse::<u8>().unwrap() < 60,
        "{label:?}"
    );
    assert_eq!(
        [format_clock_label(9, 5), format_clock_label(23, 59)],
        ["09:05", "23:59"]
    );
}
