//! The real clocks: `CLOCK_MONOTONIC` for `takenAtUsec` and the tick schedule, `CLOCK_BOOTTIME`
//! for the time suspended, the local time for the clock label, and the wall clock for
//! `sampledAtUsec`. None of them can panic.

use std::io;
use std::mem::MaybeUninit;
use std::ptr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ports::{Clock, SuspendClock, WallClock};

extern "C" {
    /// The C library's `tzset(3)`: reads `TZ`, and the zone file it names, again. The `libc` crate
    /// declares it for Windows only.
    fn tzset();
}

/// Microseconds in a second.
const USEC_PER_SECOND: u64 = 1_000_000;
/// Nanoseconds in a microsecond.
const NSEC_PER_USEC: u64 = 1_000;

/// The real sampler clock: monotonic microseconds from `CLOCK_MONOTONIC`, as
/// `GLib.get_monotonic_time` gives them (the clock the client compares `takenAtUsec` with), and the
/// local time as `HH:MM`, read afresh for each label so that a change of time zone is followed.
pub struct SystemClock;

impl Clock for SystemClock {
    /// `CLOCK_MONOTONIC` in microseconds. `clock_gettime` fails only for a clock the kernel lacks
    /// or a bad pointer, and Linux has always had `CLOCK_MONOTONIC`; were it ever to fail, the
    /// answer is 0, which the client reads as a sample older than any other, never a panic.
    fn monotonic_usec(&self) -> u64 {
        let mut now = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: `now` is a valid, writable timespec owned by this frame for the whole call, and
        // clock_gettime writes nothing else; its result is checked below.
        let result = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) };
        if result != 0 {
            return 0;
        }
        usec_of_timespec(now.tv_sec, now.tv_nsec)
    }

    /// The local time now as `HH:MM`: `tzset` first, so that a change to `TZ` or to the zone file
    /// since the last label is followed (`localtime_r` alone keeps the zone it read first), then
    /// `localtime_r`. A time it cannot convert is an error, which the sampler logs as
    /// `sample failed: <text>`.
    fn clock_label(&self) -> Result<String, String> {
        // SAFETY: tzset takes no argument and glibc serialises it with a lock of its own; the one
        // hazard is another thread changing the environment while it reads TZ, and this program
        // never changes its environment.
        unsafe { tzset() };
        // SAFETY: a null pointer asks time for its result only, with nowhere to store it, and time
        // cannot fail with one.
        let now_seconds = unsafe { libc::time(ptr::null_mut()) };
        let mut local_time = MaybeUninit::<libc::tm>::zeroed();
        // SAFETY: both pointers are valid for the call: `now_seconds` is read, `local_time` is a
        // zeroed tm owned by this frame that localtime_r fills; it returns null on failure, which is
        // checked before the tm is read.
        let converted = unsafe { libc::localtime_r(&now_seconds, local_time.as_mut_ptr()) };
        if converted.is_null() {
            let error = io::Error::last_os_error();
            return Err(format!(
                "cannot convert {now_seconds} to the local time: {error}"
            ));
        }
        // SAFETY: localtime_r returned non-null, so it filled the tm; zeroed, it was valid already.
        let local_time = unsafe { local_time.assume_init() };
        Ok(format_clock_label(local_time.tm_hour, local_time.tm_min))
    }
}

/// The real boot clock: `CLOCK_BOOTTIME` in microseconds, which goes on counting while the machine
/// is suspended, as `CLOCK_MONOTONIC` does not.
pub struct SystemSuspendClock;

impl SuspendClock for SystemSuspendClock {
    /// `CLOCK_BOOTTIME` in microseconds. Linux has had it since 2.6.39; were the read ever to fail,
    /// the answer is `None`, which the missed-tick count reads as no news (it keeps its latest good
    /// reading), never as a suspend.
    fn boottime_usec(&self) -> Option<u64> {
        let mut now = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: `now` is a valid, writable timespec owned by this frame for the whole call, and
        // clock_gettime writes nothing else; its result is checked below.
        let result = unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut now) };
        if result != 0 {
            return None;
        }
        Some(usec_of_timespec(now.tv_sec, now.tv_nsec))
    }
}

/// The real wall clock: `CLOCK_REALTIME` in microseconds since the epoch, as `GLib.get_real_time`.
pub struct SystemWallClock;

impl WallClock for SystemWallClock {
    /// Microseconds since the epoch now; 0 for a time before it.
    fn real_usec(&self) -> u64 {
        usec_since_epoch(SystemTime::now())
    }
}

/// Microseconds from the epoch to `time`: 0 for a time before the epoch, so no published figure is
/// ever negative, and `u64::MAX` for one too far after it to count.
fn usec_since_epoch(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since_epoch| {
        u64::try_from(since_epoch.as_micros()).unwrap_or(u64::MAX)
    })
}

/// A `timespec`'s seconds and nanoseconds as microseconds: 0 when negative, `u64::MAX` past the
/// range.
fn usec_of_timespec(seconds: i64, nanoseconds: i64) -> u64 {
    let (Ok(whole_seconds), Ok(nanoseconds)) = (u64::try_from(seconds), u64::try_from(nanoseconds))
    else {
        return 0;
    };
    whole_seconds
        .saturating_mul(USEC_PER_SECOND)
        .saturating_add(nanoseconds / NSEC_PER_USEC)
}

/// `HH:MM` for an hour and a minute, each two digits.
fn format_clock_label(hour: i32, minute: i32) -> String {
    format!("{hour:02}:{minute:02}")
}

#[cfg(test)]
mod tests;
