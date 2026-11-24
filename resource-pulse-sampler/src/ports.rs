//! What the sampler reads files, lists directories and tells time through, so that its rows and the
//! golden scenarios can hand in their own (as the gjs sampler's `readFile`, `listDirectoryNames`,
//! `nowUsec` and `clockLabel` were injected), and why a read failed. The real ones are in
//! [`crate::real_ports`].

use std::path::Path;

use crate::gio_texts;

/// Why a read or a listing failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadFailure {
    /// No such file or directory (ENOENT: Gio's `G_IO_ERROR_NOT_FOUND`).
    NotFound,
    /// No such device (ENODEV: Gio's `G_IO_ERROR_NO_SUCH_DEVICE`). kernfs answers a read from a file
    /// whose cgroup was removed after the open this way.
    NoSuchDevice,
    /// Any other failure, with what to log about it: for the real reader and lister, Gio's text.
    Other(String),
}

impl ReadFailure {
    /// Whether the file or directory is gone (`isVanishedCgroupError`): no such file, or no such
    /// device, and nothing else.
    pub fn is_vanished(&self) -> bool {
        matches!(self, ReadFailure::NotFound | ReadFailure::NoSuchDevice)
    }

    /// What gjs's `describeError` gives for this failure of a read of `path`: Gio's text for the
    /// errno, from the path, or the text an [`ReadFailure::Other`] carries.
    pub fn file_failure_text(&self, path: &Path) -> String {
        match self {
            ReadFailure::NotFound => {
                gio_texts::file_open_failure(path, gio_texts::NOT_FOUND_REASON)
            }
            ReadFailure::NoSuchDevice => {
                gio_texts::file_read_failure(gio_texts::NO_SUCH_DEVICE_REASON)
            }
            ReadFailure::Other(text) => text.clone(),
        }
    }

    /// What gjs's `describeError` gives for this failure of a listing of `path`.
    pub fn directory_failure_text(&self, path: &Path) -> String {
        match self {
            ReadFailure::NotFound => {
                gio_texts::directory_open_failure(path, gio_texts::NOT_FOUND_REASON)
            }
            ReadFailure::NoSuchDevice => {
                gio_texts::directory_open_failure(path, gio_texts::NO_SUCH_DEVICE_REASON)
            }
            ReadFailure::Other(text) => text.clone(),
        }
    }
}

/// Reads a whole file as text (`readFileToEnd`).
pub trait FileReader {
    /// The file's contents, every byte that is not part of valid UTF-8 replaced (see
    /// [`FileSystemReader`](crate::real_ports::FileSystemReader)).
    fn read_to_text(&self, path: &Path) -> Result<String, ReadFailure>;
}

/// Names the subdirectories of a directory.
pub trait DirectoryLister {
    /// The names of the entries that are directories, in no defined order: the sampler sorts them
    /// where its result depends on the order.
    fn subdirectory_names(&self, path: &Path) -> Result<Vec<String>, ReadFailure>;
}

/// The sampler's two clocks (`nowUsec` and `clockLabel`).
pub trait Clock {
    /// Monotonic microseconds: `CLOCK_MONOTONIC`, the clock the client compares `takenAtUsec` with.
    fn monotonic_usec(&self) -> u64;
    /// Local wall-clock time as `HH:MM`, or what went wrong reading it.
    fn clock_label(&self) -> Result<String, String>;
}

/// The service's wall clock (the gjs service's `nowRealUsec`, `GLib.get_real_time`): each
/// Sample's `sampledAtUsec` and the service's start time.
pub trait WallClock {
    /// Microseconds since the Unix epoch. It follows the wall clock wherever it is set, backwards
    /// included, as `GLib.get_real_time` does; a time before the epoch is 0, never negative.
    fn real_usec(&self) -> u64;
}
