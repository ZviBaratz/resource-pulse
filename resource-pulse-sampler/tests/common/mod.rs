//! What the tests that start the program share: the program's real inputs for app names, pinned to
//! fixtures, so no test reads the host's `.desktop` files; the fixture roots it reads in place of
//! the host's `/proc` and `/sys`; and a child process that cannot outlive its test, with the
//! waits and reads on it.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

/// The fixture data directories: a data home, a system directory and a home that does not exist.
const DESKTOP_FIXTURES_PATH: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/bus-desktop");
/// The language the program names apps in, fixed whatever the host's is.
const FIXED_LANGUAGE: &str = "C.UTF-8";
/// Where the fixture roots are, from the crate's directory.
const FIXTURE_ROOTS_PATH: &str = "../gnome-shell/tests/fixtures";
/// How long a program may take to exit once it has been told to, or has lost what it serves.
pub const PROGRAM_EXIT_TIMEOUT: Duration = Duration::from_secs(5);
/// How often a condition with a time-out is looked at.
pub const POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Gives the program the directories it looks `.desktop` files up in (`XDG_DATA_HOME`,
/// `XDG_DATA_DIRS`, `HOME`) and the language it names them in, all of them the fixtures'. These are
/// the program's real inputs, not test switches. The same values live in two more places:
/// `gnome-shell/tests/samplerProgramLauncher.js`'s `PROGRAM_DATA_ENVIRONMENT` and
/// `scripts/test-resource-pulse-sampler-bus.sh`'s `BUS_ROWS_DATA_ENVIRONMENT`. Nothing checks one
/// against another: change all three together.
pub fn pin_data_directories(command: &mut Command) -> &mut Command {
    command
        .env("XDG_DATA_HOME", format!("{DESKTOP_FIXTURES_PATH}/home"))
        .env("XDG_DATA_DIRS", format!("{DESKTOP_FIXTURES_PATH}/system"))
        .env("HOME", format!("{DESKTOP_FIXTURES_PATH}/home-dir"))
        .env("LANGUAGE", "en")
        .env("LC_ALL", FIXED_LANGUAGE)
        .env("LC_MESSAGES", FIXED_LANGUAGE)
        .env("LANG", FIXED_LANGUAGE)
}

/// The absolute path of a fixture root under `gnome-shell/tests/fixtures`.
pub fn fixture_root(root_name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(FIXTURE_ROOTS_PATH)
        .join(root_name)
}

/// A child process that is killed and reaped when the test lets go of it, however it ends.
pub struct ChildGuard(pub Child);

impl Drop for ChildGuard {
    /// Kills and reaps the child, which has usually exited already.
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The program's exit status, once it has exited, or `None` if it is still running after
/// [`PROGRAM_EXIT_TIMEOUT`].
pub fn wait_for_exit(child: &mut ChildGuard) -> Option<ExitStatus> {
    let deadline = Instant::now() + PROGRAM_EXIT_TIMEOUT;
    loop {
        if let Some(status) = child.0.try_wait().expect("the program can be waited for") {
            return Some(status);
        }
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(POLL_INTERVAL);
    }
}

/// Everything the program wrote to stderr. It must have exited, so that the pipe is at its end and
/// the read cannot block.
pub fn read_stderr(child: &mut ChildGuard) -> String {
    let mut stderr_text = String::new();
    child
        .0
        .stderr
        .take()
        .expect("a stderr pipe")
        .read_to_string(&mut stderr_text)
        .expect("stderr can be read");
    stderr_text
}
