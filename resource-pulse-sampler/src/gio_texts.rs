//! Gio's texts for the failures the real reader and lister meet, and the one gjs gives for a name
//! that is not valid UTF-8: what [`crate::ports::ReadFailure`] describes a failure with, and what
//! the real reader and lister ([`crate::real_ports`]) fail with. Each was probed through
//! `service/fileIo.js` on a temporary tree (gjs 1.88, GLib 2.88, `LANG=en_US.UTF-8`); the probe
//! printed, per failure, the Gio code and message:
//!
//! ```text
//! read missing        NOT_FOUND          Error opening file <path>: No such file or directory
//! read directory      IS_DIRECTORY       Error opening file <path>: Is a directory
//! read denied         PERMISSION_DENIED  Error opening file <path>: Permission denied
//! read under a file   NOT_DIRECTORY      Error opening file <path>: Not a directory
//! list missing        NOT_FOUND          Error opening directory '<path>': No such file or directory
//! list a file         NOT_DIRECTORY      Error opening directory '<path>': Not a directory
//! list denied         PERMISSION_DENIED  Error opening directory '<path>': Permission denied
//! list a directory holding `latin1-\351-x.service` (a plain Error, no Gio code):
//!   Could not convert filename string to UTF-8 for string: latin1-\351-x.service. If string is invalid
//!   UTF-8 and used for display purposes, try GLib attribute standard::display-name. The reason is:
//!   Invalid byte sequence in conversion input.<one trailing space>
//! ```
//!
//! A read that fails after a good open is `Error reading from file: <reason>` (GLib's
//! `glocalfileinputstream.c`, and the text the gjs sampler's rows built for ENODEV). The reasons
//! are glibc's `strerror` texts, which `g_strerror` gives under an English locale.

use std::path::Path;

/// `g_strerror(ENOENT)`.
pub const NOT_FOUND_REASON: &str = "No such file or directory";
/// `g_strerror(ENODEV)`.
pub const NO_SUCH_DEVICE_REASON: &str = "No such device";
/// What follows the escaped name in gjs's text for a name that is not valid UTF-8, trailing
/// space included.
const FILENAME_CONVERSION_FAILURE_TAIL: &str = ". If string is invalid UTF-8 and used for display \
    purposes, try GLib attribute standard::display-name. The reason is: Invalid byte sequence in \
    conversion input. ";
/// What precedes the escaped name in that text.
const FILENAME_CONVERSION_FAILURE_HEAD: &str =
    "Could not convert filename string to UTF-8 for string: ";

/// A file that could not be opened (`g_local_file_read`).
pub fn file_open_failure(path: &Path, reason: &str) -> String {
    format!("Error opening file {}: {reason}", path.display())
}

/// A read that failed after a good open (`g_local_file_input_stream_read`).
pub fn file_read_failure(reason: &str) -> String {
    format!("Error reading from file: {reason}")
}

/// A directory that could not be opened for listing (`_g_local_file_enumerator_new`).
pub fn directory_open_failure(path: &Path, reason: &str) -> String {
    format!("Error opening directory '{}': {reason}", path.display())
}

/// gjs's text for a directory name that is not valid UTF-8 (`gjs_string_from_filename`).
pub fn filename_conversion_failure(name_bytes: &[u8]) -> String {
    let escaped_name = escaped_as_g_strescape(name_bytes);
    format!("{FILENAME_CONVERSION_FAILURE_HEAD}{escaped_name}{FILENAME_CONVERSION_FAILURE_TAIL}")
}

/// The first byte `g_strescape` writes as three octal digits, and every one above it.
const FIRST_OCTAL_ESCAPED_HIGH_BYTE: u8 = 0x7f;
/// The first byte `g_strescape` copies as it is.
const FIRST_PRINTED_BYTE: u8 = b' ';

/// `g_strescape(bytes, NULL)`: `\b`, `\f`, `\n`, `\r`, `\t`, `\v`, `\\` and `\"` by name, every
/// other byte below 0x20 or from 0x7F up as a backslash and three octal digits, the rest as is.
fn escaped_as_g_strescape(bytes: &[u8]) -> String {
    let mut escaped = String::with_capacity(bytes.len());
    for &byte in bytes {
        let named_escape = match byte {
            b'\x08' => Some("\\b"),
            b'\x0c' => Some("\\f"),
            b'\n' => Some("\\n"),
            b'\r' => Some("\\r"),
            b'\t' => Some("\\t"),
            b'\x0b' => Some("\\v"),
            b'\\' => Some("\\\\"),
            b'"' => Some("\\\""),
            _ => None,
        };
        match named_escape {
            Some(named_escape) => escaped.push_str(named_escape),
            None if !(FIRST_PRINTED_BYTE..FIRST_OCTAL_ESCAPED_HIGH_BYTE).contains(&byte) => {
                escaped.push_str(&format!("\\{byte:03o}"));
            }
            None => escaped.push(char::from(byte)),
        }
    }
    escaped
}
