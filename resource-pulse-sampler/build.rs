//! Build script: computes the source hash (`source_hash.rs` says what it covers) and embeds it as
//! `RESOURCE_PULSE_SOURCE_HASH`, which `--source-hash` prints.
//!
//! Cargo reruns this script only when a path it was told about changes (`rerun-if-changed`), so it
//! names every input of the hash: each fixed file, and the `src` directory, which cargo scans
//! recursively, so that an edit, a new file and a removed file under it each recompute the hash
//! (a test-only edit recomputes it too, to the same value). A change the hash does not see cannot
//! reach the binary, and one it does see cannot be missed.

// Cargo reads a build script's instructions from its stdout; that is the protocol, not a log.
#![allow(clippy::print_stdout)]

use std::path::PathBuf;

mod source_hash;

/// The environment variable the program reads its hash from, with `env!`.
const SOURCE_HASH_ENVIRONMENT_VARIABLE: &str = "RESOURCE_PULSE_SOURCE_HASH";
/// The variable cargo sets to the directory holding `Cargo.toml`.
const MANIFEST_DIRECTORY_VARIABLE: &str = "CARGO_MANIFEST_DIR";

/// Tells cargo which paths decide whether this script runs again, then embeds the hash.
fn main() -> Result<(), String> {
    let crate_dir = std::env::var_os(MANIFEST_DIRECTORY_VARIABLE)
        .map(PathBuf::from)
        .ok_or_else(|| format!("cargo did not set {MANIFEST_DIRECTORY_VARIABLE}"))?;
    for fixed_file in source_hash::FIXED_HASHED_FILES {
        println!("cargo:rerun-if-changed={fixed_file}");
    }
    println!("cargo:rerun-if-changed={}", source_hash::SOURCE_DIRECTORY);
    let hash = source_hash::source_hash(&crate_dir)?;
    println!("cargo:rustc-env={SOURCE_HASH_ENVIRONMENT_VARIABLE}={hash}");
    Ok(())
}
