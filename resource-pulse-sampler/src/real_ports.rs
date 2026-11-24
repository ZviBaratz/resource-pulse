//! The real ports: the reader, which stands for `service/fileIo.js`'s `readFileToEnd`, the lister, which
//! stood for the gjs sampler's `listSubdirectoryNames`, and the clocks (see `clocks`).
//!
//! The real reader and lister fail with Gio's own texts (see `gio_texts`), so that a line the sampler
//! logs about a failed read reads as the gjs sampler's line about the same failure did.

use std::fs::{self, DirEntry, File};
use std::io::{self, Read};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use crate::gio_texts;
use crate::ports::{DirectoryLister, FileReader, ReadFailure};

mod clocks;

pub use clocks::{SystemClock, SystemWallClock};

/// The reason in an io error's text: `strerror`'s words alone, without the ` (os error N)` that Rust
/// adds, which is what `g_strerror` gives. An error with no errno keeps its whole text.
fn os_error_reason(error: &io::Error) -> String {
    let error_text = error.to_string();
    let Some(errno) = error.raw_os_error() else {
        return error_text;
    };
    let rust_errno_suffix = format!(" (os error {errno})");
    error_text
        .strip_suffix(&rust_errno_suffix)
        .map_or_else(|| error_text.clone(), str::to_string)
}

/// The vanished failure an errno stands for: ENOENT or ENODEV, and nothing else.
fn vanished_failure_of(error: &io::Error) -> Option<ReadFailure> {
    match error.raw_os_error() {
        Some(libc::ENOENT) => Some(ReadFailure::NotFound),
        Some(libc::ENODEV) => Some(ReadFailure::NoSuchDevice),
        _ => None,
    }
}

/// The real reader. It reads to the end of the file whatever size the file reports (a `/proc`,
/// `/sys` or cgroup file reports 0 or a whole page), and replaces each invalid UTF-8 sequence with
/// U+FFFD as `String::from_utf8_lossy` does.
///
/// gjs's `TextDecoder` does the same for every sequence but one kind: a byte F5 to F7 followed by one
/// or two continuation bytes is one U+FFFD in gjs (SpiderMonkey reads F5 to F7 as the lead of an
/// old-style four-byte form) and two or three here. No published field can carry such bytes: the
/// files the sampler reads are the kernel's numbers and names, and the one place a person can put
/// arbitrary bytes, a swap file's name in `/proc/swaps`, is only matched against `/dev/zram<n>`, never
/// published or logged.
pub struct FileSystemReader;

impl FileReader for FileSystemReader {
    /// The file's text, or why it could not be read: ENOENT and ENODEV as themselves, any other
    /// failure with Gio's text.
    fn read_to_text(&self, path: &Path) -> Result<String, ReadFailure> {
        let mut file = File::open(path).map_err(|error| failure_of_open(path, &error))?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents)
            .map_err(|error| failure_of_read(path, &error))?;
        Ok(String::from_utf8_lossy(&contents).into_owned())
    }
}

/// The real lister. Directories are named as Gio named them for the gjs sampler's `listSubdirectoryNames`: a symlink
/// to a directory counts (Gio follows it), and a name that is not valid UTF-8 fails the listing at
/// the first such directory, with gjs's text, as the gjs listing throws there.
pub struct FileSystemLister;

impl DirectoryLister for FileSystemLister {
    /// The subdirectories' names in the order the directory lists them, or why it could not be
    /// listed.
    fn subdirectory_names(&self, path: &Path) -> Result<Vec<String>, ReadFailure> {
        let entries = fs::read_dir(path).map_err(|error| {
            vanished_failure_of(&error).unwrap_or_else(|| {
                ReadFailure::Other(gio_texts::directory_open_failure(
                    path,
                    &os_error_reason(&error),
                ))
            })
        })?;
        let mut subdirectory_names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| listing_failure_text(path, &error))?;
            if !is_directory_entry(&entry)? {
                continue;
            }
            let name = entry.file_name().into_string().map_err(|name| {
                ReadFailure::Other(gio_texts::filename_conversion_failure(name.as_bytes()))
            })?;
            subdirectory_names.push(name);
        }
        Ok(subdirectory_names)
    }
}

/// A failure while reading a directory's entries, after a good open. Not one of the texts probed
/// (a directory cannot be made to fail there on demand); it names the directory as the open's does.
fn listing_failure_text(path: &Path, error: &io::Error) -> ReadFailure {
    let reason = os_error_reason(error);
    ReadFailure::Other(format!(
        "Error reading directory '{}': {reason}",
        path.display()
    ))
}

/// Whether a listed entry is a directory as Gio sees it, following a symlink: one whose target is
/// gone or unreadable is not. An entry that vanished since the listing read it is not one either;
/// any other failure to learn its type fails the listing.
fn is_directory_entry(entry: &DirEntry) -> Result<bool, ReadFailure> {
    match entry.file_type() {
        Ok(file_type) if file_type.is_symlink() => {
            Ok(fs::metadata(entry.path()).is_ok_and(|metadata| metadata.is_dir()))
        }
        Ok(file_type) => Ok(file_type.is_dir()),
        Err(error) if error.raw_os_error() == Some(libc::ENOENT) => Ok(false),
        Err(error) => {
            let reason = os_error_reason(&error);
            let entry_path = entry.path();
            Err(ReadFailure::Other(format!(
                "Error when getting information for file '{}': {reason}",
                entry_path.display()
            )))
        }
    }
}

/// The failure an open of `path` meets: ENOENT and ENODEV as themselves, anything else with Gio's
/// text for an open.
fn failure_of_open(path: &Path, error: &io::Error) -> ReadFailure {
    vanished_failure_of(error).unwrap_or_else(|| {
        ReadFailure::Other(gio_texts::file_open_failure(path, &os_error_reason(error)))
    })
}

/// The failure a read after a good open meets: ENOENT and ENODEV as themselves; a directory with
/// Gio's text for an open, since Gio refuses a directory when it opens it, where Rust opens it and
/// fails the read; anything else with Gio's text for a read.
fn failure_of_read(path: &Path, error: &io::Error) -> ReadFailure {
    if let Some(vanished_failure) = vanished_failure_of(error) {
        return vanished_failure;
    }
    let reason = os_error_reason(error);
    if error.raw_os_error() == Some(libc::EISDIR) {
        return ReadFailure::Other(gio_texts::file_open_failure(path, &reason));
    }
    ReadFailure::Other(gio_texts::file_read_failure(&reason))
}

#[cfg(test)]
mod tests;
