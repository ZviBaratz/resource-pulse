//! The source hash's rows: SHA-256 against known answers, and the choice of files it covers. The
//! file under test, `source_hash.rs` at the crate root, is the one `build.rs` compiles to hash the
//! crate; it is compiled here too, so these rows hold the very code the build script runs. The
//! hash's state table (`scripts/test-resource-pulse-sampler-hash.sh`) holds it to `sha256sum` and to
//! the shell script's own hash of the same files. That a file the hash leaves out cannot reach the
//! program is held by that table's two hash-copy rows, which build a copy holding only the hashed
//! files.

// Tests may unwrap, expect, index and panic: a failing test should say so loudly.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic
)]

use std::fs;
use std::path::{Path, PathBuf};

#[path = "../source_hash.rs"]
mod source_hash;

use source_hash::{hashed_files, is_hashed_path, source_hash, Sha256, FIXED_HASHED_FILES};

/// Where a row may write its fixture crates: cargo's own scratch directory for integration tests.
const SCRATCH_DIRECTORY: &str = env!("CARGO_TARGET_TMPDIR");

/// The SHA-256 of `message`, as lower-case hex, in one `update`.
fn sha256_hex_of(message: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(message);
    hasher.finalize_hex()
}

/// `byte_count` letters `a`.
fn letters_a(byte_count: usize) -> Vec<u8> {
    vec![b'a'; byte_count]
}

/// Known answers: the first two and the 56-byte message are FIPS 180-4's own examples; the others
/// were produced by `sha256sum` over the same bytes. 55, 56 and 64 bytes are the three edges of
/// padding (the length fits in the block, forces a second block, and fills a block exactly);
/// 119 and 120 are the same edges one block later, and 1000 bytes spans sixteen blocks.
#[test]
fn sha256_matches_the_known_answers() {
    let known_answers: [(Vec<u8>, &str); 9] = [
        (
            Vec::new(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
        (
            b"abc".to_vec(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        ),
        (
            b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".to_vec(),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        ),
        (
            letters_a(55),
            "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
        ),
        (
            letters_a(56),
            "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
        ),
        (
            letters_a(64),
            "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
        ),
        (
            letters_a(119),
            "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb",
        ),
        (
            letters_a(120),
            "2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c",
        ),
        (
            letters_a(1000),
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
        ),
    ];
    for (message, expected_hex) in &known_answers {
        assert_eq!(
            &sha256_hex_of(message),
            expected_hex,
            "{} bytes",
            message.len()
        );
    }
}

/// However a message is cut into `update` calls, the answer is the same: one byte at a time, and
/// in cuts that straddle the 64-byte block edge.
#[test]
fn sha256_does_not_depend_on_how_the_message_is_cut() {
    let message = letters_a(1000);
    let whole_message_hex = sha256_hex_of(&message);

    let mut one_byte_at_a_time = Sha256::new();
    for byte in &message {
        one_byte_at_a_time.update(&[*byte]);
    }
    assert_eq!(one_byte_at_a_time.finalize_hex(), whole_message_hex);

    for cut_length in [1, 7, 63, 64, 65, 127, 129] {
        let mut cut_into_pieces = Sha256::new();
        for piece in message.chunks(cut_length) {
            cut_into_pieces.update(piece);
        }
        assert_eq!(
            cut_into_pieces.finalize_hex(),
            whole_message_hex,
            "pieces of {cut_length}"
        );
    }
}

/// The naming rule: test code is in files called `tests.rs`, `*_tests.rs` or `test_support.rs`, or
/// anywhere under a directory called `tests`; nothing else is left out.
#[test]
fn only_test_files_are_left_out_of_the_hash() {
    let left_out = [
        "src/tests.rs",
        "src/apps/tests.rs",
        "src/main_tests.rs",
        "src/_tests.rs",
        "src/test_support.rs",
        "src/sampler/app_names/test_support.rs",
        "src/sampler/tests/app_scan.rs",
        "src/sampler/tests/deeper/helper.rs",
        "tests/golden.rs",
    ];
    let kept = [
        "Cargo.toml",
        "Cargo.lock",
        "build.rs",
        "source_hash.rs",
        "src/main.rs",
        "src/apps.rs",
        "src/sampler/mod.rs",
        "src/contests.rs",
        "src/tests_helper.rs",
        "src/test_supporting.rs",
        "src/attests.rs",
        "src/tests.rs.bak",
        "src/protests/x.rs",
    ];
    for path in left_out {
        assert!(!is_hashed_path(path), "{path} should be left out");
    }
    for path in kept {
        assert!(is_hashed_path(path), "{path} should be hashed");
    }
}

/// Writes `contents` at `relative_path` under `crate_dir`, making the directories.
fn write_file(crate_dir: &Path, relative_path: &str, contents: &str) {
    let path = crate_dir.join(relative_path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

/// A fresh fixture crate named for its row: the fixed files and a few sources, tests among them.
fn fixture_crate(row_name: &str) -> PathBuf {
    let crate_dir = Path::new(SCRATCH_DIRECTORY).join(format!("source-hash-{row_name}"));
    let _ = fs::remove_dir_all(&crate_dir);
    for fixed_file in FIXED_HASHED_FILES {
        write_file(&crate_dir, fixed_file, &format!("fixed {fixed_file}\n"));
    }
    write_file(&crate_dir, "src/main.rs", "fn main() {}\n");
    write_file(&crate_dir, "src/b/mod.rs", "// b\n");
    write_file(&crate_dir, "src/a.rs", "// a\n");
    write_file(&crate_dir, "src/B.rs", "// capital b\n");
    write_file(&crate_dir, "src/a/tests.rs", "// a's tests\n");
    write_file(&crate_dir, "src/main_tests.rs", "// main's tests\n");
    write_file(&crate_dir, "src/test_support.rs", "// support\n");
    write_file(&crate_dir, "src/tests/one.rs", "// one\n");
    crate_dir
}

/// The files are the four fixed ones and what is under `src/` that is not test code, sorted by the
/// byte order of the relative path ("B.rs" before "a.rs", "Cargo.lock" before "build.rs").
#[test]
fn the_hashed_files_are_the_fixed_ones_and_the_sources_in_byte_order() {
    let crate_dir = fixture_crate("list");
    assert_eq!(
        hashed_files(&crate_dir).unwrap(),
        [
            "Cargo.lock",
            "Cargo.toml",
            "build.rs",
            "source_hash.rs",
            "src/B.rs",
            "src/a.rs",
            "src/b/mod.rs",
            "src/main.rs",
        ]
    );
}

/// A test-only edit leaves the hash alone; an edit to a source, a file added under `src/` and one
/// removed each change it, and removing what was added gives the old hash back.
#[test]
fn the_hash_follows_what_compiles_in_and_nothing_else() {
    let crate_dir = fixture_crate("follows");
    let original_hash = source_hash(&crate_dir).unwrap();
    assert_eq!(original_hash.len(), 64);
    assert_eq!(source_hash(&crate_dir).unwrap(), original_hash);

    write_file(&crate_dir, "src/a/tests.rs", "// a's tests, edited\n");
    write_file(&crate_dir, "src/tests/new.rs", "// a new test file\n");
    fs::remove_file(crate_dir.join("src/test_support.rs")).unwrap();
    assert_eq!(
        source_hash(&crate_dir).unwrap(),
        original_hash,
        "test files"
    );

    write_file(&crate_dir, "src/main.rs", "fn main() { /* edited */ }\n");
    let edited_hash = source_hash(&crate_dir).unwrap();
    assert_ne!(edited_hash, original_hash, "an edited source");

    write_file(&crate_dir, "src/extra.rs", "// added\n");
    let added_hash = source_hash(&crate_dir).unwrap();
    assert_ne!(added_hash, edited_hash, "an added source");

    fs::remove_file(crate_dir.join("src/extra.rs")).unwrap();
    assert_eq!(
        source_hash(&crate_dir).unwrap(),
        edited_hash,
        "removed again"
    );

    write_file(&crate_dir, "Cargo.lock", "fixed Cargo.lock, edited\n");
    assert_ne!(
        source_hash(&crate_dir).unwrap(),
        edited_hash,
        "an edited fixed file"
    );
}

/// A byte moved from the end of one file's name to the start of its contents is a different crate:
/// the name and the length are part of what is hashed.
#[test]
fn a_byte_moved_between_a_name_and_its_contents_changes_the_hash() {
    let first_crate = fixture_crate("framing-first");
    write_file(&first_crate, "src/ab.rs", "c");
    let second_crate = fixture_crate("framing-second");
    write_file(&second_crate, "src/a.rs", "// a\n");
    write_file(&second_crate, "src/ab.r", "sc");
    assert_ne!(
        source_hash(&first_crate).unwrap(),
        source_hash(&second_crate).unwrap()
    );
}

/// One file cannot pose as two: a file whose contents end where the next file's name and contents
/// would have begun is a different crate from the two files, because each file's length is hashed.
#[test]
fn one_file_cannot_pose_as_two() {
    let one_file_crate = fixture_crate("pose-one");
    write_file(&one_file_crate, "src/a.rs", "xsrc/b.rs\0y");
    let two_file_crate = fixture_crate("pose-two");
    write_file(&two_file_crate, "src/a.rs", "x");
    write_file(&two_file_crate, "src/b.rs", "y");
    assert_ne!(
        source_hash(&one_file_crate).unwrap(),
        source_hash(&two_file_crate).unwrap()
    );
}

/// A crate that cannot be read is an error, never a hash of nothing: a missing fixed file, and no
/// `src/` directory.
#[test]
fn an_unreadable_crate_is_an_error_and_not_a_hash() {
    let missing_fixed_file = fixture_crate("missing-fixed");
    fs::remove_file(missing_fixed_file.join("Cargo.lock")).unwrap();
    assert!(source_hash(&missing_fixed_file).is_err());

    let no_sources = fixture_crate("no-sources");
    fs::remove_dir_all(no_sources.join("src")).unwrap();
    assert!(source_hash(&no_sources).is_err());
    assert!(hashed_files(&no_sources).is_err());
}
