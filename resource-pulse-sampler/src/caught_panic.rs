//! Where a throw in gjs is a panic here: running a step so that its panic becomes a failure value,
//! the text a caught panic is logged with, and the panic hook that keeps a caught panic out of the
//! journal. Crate-level, so the sampler's catches and the tick loop's own log a caught panic the
//! same way.
//!
//! - **Inside a catch the hook is quiet.** [`catching_panic`] and [`value_or_none`] count themselves
//!   active on their thread while their step runs. A panic there writes nothing (the catch logs it,
//!   rate-limited, under a stable key), and the hook records where it happened, which
//!   [`catching_panic`] appends to its text: `disk on fire at src/x.rs:12:5`. gjs logs a stack, and
//!   the message alone says less.
//! - **Outside a catch it writes the panic, never silently.** A panic nothing caught (on the
//!   receiving thread, or in `main` before the loop) ends the program with a failure: 101 from
//!   `main`, and the receiving thread's death exits 1. So when stderr is the journal its text is an
//!   error, `<3>` on every physical line (`log_line.rs`): the thread, the place and the message, and
//!   the backtrace `RUST_BACKTRACE` asks for, in the shape of std's own line but without its thread
//!   id and its `RUST_BACKTRACE` note; a backtrace starts with the hook's own frames. Anywhere else
//!   the hook it replaced writes it (std's default line, in the program), exactly as before.
//! - **The program installs it first thing** ([`install_panic_hook`]); without it every caught
//!   panic would also be printed, each time, outside the ten-minute limit, and the text would have
//!   no location. A test that panics on purpose, or reads a caught panic's location, installs it
//!   too.

use std::any::Any;
use std::backtrace::Backtrace;
use std::cell::{Cell, RefCell};
use std::panic::{self, catch_unwind, AssertUnwindSafe, PanicHookInfo};
use std::sync::Once;
use std::thread;

use crate::log_line::{is_stderr_the_journal, write_log_line, LinePriority};

/// What a caught panic is logged as when its payload is not text (a panic with a value of another
/// type, which no code here raises).
const NON_TEXT_PANIC_TEXT: &str = "a panic whose payload is not text";
/// What joins a caught panic's message and its location.
const LOCATION_SEPARATOR: &str = " at ";
/// How std's hook names a thread that has no name, and a panic whose place is not known.
const UNNAMED_THREAD_NAME: &str = "<unnamed>";
const UNKNOWN_PANIC_PLACE: &str = "an unknown place";
/// The variable std's hook reads for a backtrace, its value for none, and its value for every
/// frame; any other value asks for the short form.
const BACKTRACE_VARIABLE: &str = "RUST_BACKTRACE";
const NO_BACKTRACE_STYLE: &str = "0";
const FULL_BACKTRACE_STYLE: &str = "full";
/// The line std's hook leads a backtrace with.
const BACKTRACE_HEADING: &str = "stack backtrace:";

/// A panic hook, as `std::panic::take_hook` returns it.
type PanicHook = Box<dyn Fn(&PanicHookInfo<'_>) + Sync + Send + 'static>;

/// Installs the hook once per process, however often it is asked.
static HOOK_INSTALLATION: Once = Once::new();

thread_local! {
    /// How many catches are running on this thread, nested ones counted: the hook is quiet while
    /// it is above 0.
    static ACTIVE_CATCH_DEPTH: Cell<u32> = const { Cell::new(0) };
    /// Where the latest panic inside a catch on this thread happened (`file:line:column`), recorded
    /// by the hook for the catch to take.
    static CAUGHT_PANIC_LOCATION: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Installs the panic hook: quiet inside a catch on the panicking thread, where it records the
/// panic's location; the hook it replaces (the default one, in the program) outside. Only the first
/// call installs it; later ones do nothing.
pub fn install_panic_hook() {
    HOOK_INSTALLATION.call_once(|| {
        let previous_hook = panic::take_hook();
        panic::set_hook(quiet_inside_catch(previous_hook));
    });
}

/// The hook: records the location and writes nothing inside a catch, and writes every other panic
/// (see [`write_uncaught_panic`]). Reading the catch depth cannot fail today: `ACTIVE_CATCH_DEPTH`
/// is a const `Cell<u32>`, which has no destructor, so it stays readable even on a thread that is
/// ending. The `try_with` is a defensive fallback for a thread-local that could be gone: such a
/// panic would go to `previous_hook`, which needs no thread-local, where a `with` would panic
/// inside the hook, and a panic inside a panic hook aborts the process.
fn quiet_inside_catch(previous_hook: PanicHook) -> PanicHook {
    Box::new(move |panic_info| {
        let Ok(active_catch_depth) = ACTIVE_CATCH_DEPTH.try_with(Cell::get) else {
            previous_hook(panic_info);
            return;
        };
        if active_catch_depth == 0 {
            write_uncaught_panic(panic_info, &previous_hook);
            return;
        }
        let location = panic_info.location().map(ToString::to_string);
        // Only a thread inside a catch gets here, so its thread-locals are alive.
        let _ = CAUGHT_PANIC_LOCATION.try_with(|caught_location| {
            *caught_location.borrow_mut() = location;
        });
    })
}

/// Writes a panic nothing caught: when stderr is the journal, as an error, `<3>` on each of its
/// physical lines, since it ends the program with a failure; anywhere else through `previous_hook`
/// (std's default line, in the program), exactly as it was written before.
fn write_uncaught_panic(panic_info: &PanicHookInfo<'_>, previous_hook: &PanicHook) {
    if is_stderr_the_journal() {
        write_log_line(LinePriority::Error, &uncaught_panic_text(panic_info));
    } else {
        previous_hook(panic_info);
    }
}

/// A panic nothing caught, in the shape of std's own line but without its thread id and its
/// `RUST_BACKTRACE` note: `thread '<name>' panicked at <place>:`, then its message, then the
/// backtrace `RUST_BACKTRACE` asks for, if any, which starts with this hook's own frames.
fn uncaught_panic_text(panic_info: &PanicHookInfo<'_>) -> String {
    let current_thread = thread::current();
    let thread_name = current_thread.name().unwrap_or(UNNAMED_THREAD_NAME);
    let place = panic_info
        .location()
        .map_or_else(|| UNKNOWN_PANIC_PLACE.to_owned(), ToString::to_string);
    let message = panic_text(panic_info.payload());
    let panic_line = format!("thread '{thread_name}' panicked at {place}:");
    match requested_backtrace_text() {
        Some(backtrace_text) => {
            format!("{panic_line}\n{message}\n{BACKTRACE_HEADING}\n{backtrace_text}")
        }
        None => format!("{panic_line}\n{message}"),
    }
}

/// The backtrace of this thread as `RUST_BACKTRACE` asks for it, read as std's hook reads it:
/// unset or `0` for none, `full` for every frame, anything else for the short form. Its last
/// newline is left off, as the line writer ends the text.
fn requested_backtrace_text() -> Option<String> {
    let backtrace_style = std::env::var_os(BACKTRACE_VARIABLE)?;
    if backtrace_style == NO_BACKTRACE_STYLE {
        return None;
    }
    let backtrace = Backtrace::force_capture();
    let backtrace_text = if backtrace_style == FULL_BACKTRACE_STYLE {
        format!("{backtrace:#}")
    } else {
        format!("{backtrace}")
    };
    Some(backtrace_text.trim_end().to_owned())
}

/// Runs a step, returning its value, or the text of its panic, as a gjs `try` gives the value or
/// the error (the caller logs it as gjs logs the error). The text is the panic's message and, once
/// the hook is installed, where it happened: `disk on fire at src/x.rs:12:5`.
pub fn catching_panic<Value>(step: impl FnOnce() -> Value) -> Result<Value, String> {
    run_counted_as_catch(step).map_err(|payload| {
        let message = panic_text(payload.as_ref());
        match take_caught_panic_location() {
            Some(location) => format!("{message}{LOCATION_SEPARATOR}{location}"),
            None => message,
        }
    })
}

/// A best-effort value (`callOrNull`): the step's value, or `None` when it panics. Used where the
/// failure is already being logged or cannot be (a clock or a log writer that panics), where this
/// step may well be what failed.
pub fn value_or_none<Value>(step: impl FnOnce() -> Value) -> Option<Value> {
    let outcome = run_counted_as_catch(step);
    // A panic's location is not wanted here; it must not be left for the next catch to take.
    take_caught_panic_location();
    outcome.ok()
}

/// Runs a step under `catch_unwind`, counted as an active catch on this thread while it runs, so the
/// hook stays quiet for its panic.
fn run_counted_as_catch<Value>(step: impl FnOnce() -> Value) -> Result<Value, Box<dyn Any + Send>> {
    ACTIVE_CATCH_DEPTH.with(|depth| depth.set(depth.get().saturating_add(1)));
    let outcome = catch_unwind(AssertUnwindSafe(step));
    ACTIVE_CATCH_DEPTH.with(|depth| depth.set(depth.get().saturating_sub(1)));
    outcome
}

/// The location the hook recorded for the panic just caught on this thread, if any, leaving none.
fn take_caught_panic_location() -> Option<String> {
    CAUGHT_PANIC_LOCATION.with(|caught_location| caught_location.borrow_mut().take())
}

/// The panic's own message when it is text (`panic!` with a literal gives a `&str`, with a format a
/// `String`), else [`NON_TEXT_PANIC_TEXT`].
fn panic_text(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    payload
        .downcast_ref::<String>()
        .cloned()
        .unwrap_or_else(|| NON_TEXT_PANIC_TEXT.to_string())
}

#[cfg(test)]
mod tests;
