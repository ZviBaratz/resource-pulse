//! The source hash: a SHA-256 over what compiles into the program, so that "is the installed
//! binary this checkout's?" has an answer that a rebuild, a new commit or a test-only edit does not
//! change. `build.rs` compiles this file to compute it and embeds it for `--source-hash`;
//! `tests/source_hash.rs` compiles it to hold it to known answers. It has no dependency, and no
//! test code, because it is itself hashed.
//!
//! What is hashed, in this order: the files of [`FIXED_HASHED_FILES`] and every file under `src/`
//! that is not test code (see [`is_hashed_path`]), sorted by the byte order of the path relative to
//! the crate, written with `/`. What is fed to the hash, for each file in turn: its relative path,
//! a NUL byte, its length in bytes written in decimal, a NUL byte, and its contents. Never the
//! commit, the time, the host or an absolute path.
//!
//! `scripts/resource-pulse-sampler-build.sh` computes the same hash with `sha256sum` over the same
//! files in the same order, for `--check`; the state table compares the two.

use std::fs;
use std::path::Path;

/// The files outside `src/` that are hashed, relative to the crate.
pub const FIXED_HASHED_FILES: [&str; 4] =
    ["Cargo.toml", "Cargo.lock", "build.rs", "source_hash.rs"];
/// The directory whose files are hashed, except test code, relative to the crate.
pub const SOURCE_DIRECTORY: &str = "src";
/// The one file name for test code, in any directory.
const TESTS_FILE_NAME: &str = "tests.rs";
/// The file name of shared test helpers, in any directory.
const TEST_SUPPORT_FILE_NAME: &str = "test_support.rs";
/// What ends the name of a file of tests belonging to one module.
const TESTS_FILE_SUFFIX: &str = "_tests.rs";
/// The name of a directory under which everything is test code.
const TESTS_DIRECTORY_NAME: &str = "tests";
/// What separates the parts of a relative path, and what follows a path and a length in the stream.
const PATH_SEPARATOR: char = '/';
const FIELD_TERMINATOR: u8 = 0;

/// Bytes in one block of SHA-256's input, and in its length field's last part.
const BLOCK_BYTES: usize = 64;
/// Bytes of the message length at the end of the last block.
const LENGTH_FIELD_BYTES: usize = 8;
/// Bits in a byte, for the message length the padding records.
const BITS_PER_BYTE: u64 = 8;
/// What follows the message in the padding: a one bit, then zeros.
const PADDING_START_BYTE: u8 = 0x80;
/// Bytes in one word of the message schedule.
const BYTES_PER_WORD: usize = 4;
/// Rounds of the compression function: one per round constant.
const ROUND_COUNT: usize = 64;
/// Words of the digest (eight 32-bit words, 32 bytes).
const DIGEST_WORDS: usize = 8;

/// The initial hash value (FIPS 180-4 §5.3.3): the first 32 bits of the fractional parts of the
/// square roots of the first eight primes.
const INITIAL_STATE: [u32; DIGEST_WORDS] = [
    0x6a09_e667,
    0xbb67_ae85,
    0x3c6e_f372,
    0xa54f_f53a,
    0x510e_527f,
    0x9b05_688c,
    0x1f83_d9ab,
    0x5be0_cd19,
];

/// The round constants (FIPS 180-4 §4.2.2): the first 32 bits of the fractional parts of the cube
/// roots of the first sixty-four primes.
const ROUND_CONSTANTS: [u32; ROUND_COUNT] = [
    0x428a_2f98,
    0x7137_4491,
    0xb5c0_fbcf,
    0xe9b5_dba5,
    0x3956_c25b,
    0x59f1_11f1,
    0x923f_82a4,
    0xab1c_5ed5,
    0xd807_aa98,
    0x1283_5b01,
    0x2431_85be,
    0x550c_7dc3,
    0x72be_5d74,
    0x80de_b1fe,
    0x9bdc_06a7,
    0xc19b_f174,
    0xe49b_69c1,
    0xefbe_4786,
    0x0fc1_9dc6,
    0x240c_a1cc,
    0x2de9_2c6f,
    0x4a74_84aa,
    0x5cb0_a9dc,
    0x76f9_88da,
    0x983e_5152,
    0xa831_c66d,
    0xb003_27c8,
    0xbf59_7fc7,
    0xc6e0_0bf3,
    0xd5a7_9147,
    0x06ca_6351,
    0x1429_2967,
    0x27b7_0a85,
    0x2e1b_2138,
    0x4d2c_6dfc,
    0x5338_0d13,
    0x650a_7354,
    0x766a_0abb,
    0x81c2_c92e,
    0x9272_2c85,
    0xa2bf_e8a1,
    0xa81a_664b,
    0xc24b_8b70,
    0xc76c_51a3,
    0xd192_e819,
    0xd699_0624,
    0xf40e_3585,
    0x106a_a070,
    0x19a4_c116,
    0x1e37_6c08,
    0x2748_774c,
    0x34b0_bcb5,
    0x391c_0cb3,
    0x4ed8_aa4a,
    0x5b9c_ca4f,
    0x682e_6ff3,
    0x748f_82ee,
    0x78a5_636f,
    0x84c8_7814,
    0x8cc7_0208,
    0x90be_fffa,
    0xa450_6ceb,
    0xbef9_a3f7,
    0xc671_78f2,
];

/// SHA-256 (FIPS 180-4), fed in pieces.
pub struct Sha256 {
    state: [u32; DIGEST_WORDS],
    pending_block: [u8; BLOCK_BYTES],
    pending_byte_count: usize,
    total_byte_count: u64,
}

impl Default for Sha256 {
    fn default() -> Self {
        Self::new()
    }
}

impl Sha256 {
    /// A hash of the empty message so far.
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: INITIAL_STATE,
            pending_block: [0; BLOCK_BYTES],
            pending_byte_count: 0,
            total_byte_count: 0,
        }
    }

    /// Adds `bytes` to the message.
    pub fn update(&mut self, bytes: &[u8]) {
        self.total_byte_count = self.total_byte_count.wrapping_add(bytes.len() as u64);
        let mut remaining_bytes = bytes;
        if self.pending_byte_count > 0 {
            let room_in_block = BLOCK_BYTES - self.pending_byte_count;
            let taken_byte_count = room_in_block.min(remaining_bytes.len());
            let (taken, rest) = remaining_bytes.split_at(taken_byte_count);
            let block_end = self.pending_byte_count + taken_byte_count;
            if let Some(destination) = self
                .pending_block
                .get_mut(self.pending_byte_count..block_end)
            {
                destination.copy_from_slice(taken);
            }
            self.pending_byte_count = block_end;
            remaining_bytes = rest;
            if self.pending_byte_count < BLOCK_BYTES {
                return;
            }
            let full_block = self.pending_block;
            self.compress(&full_block);
            self.pending_byte_count = 0;
        }
        let (whole_blocks, leftover) = remaining_bytes.as_chunks::<BLOCK_BYTES>();
        for block in whole_blocks {
            self.compress(block);
        }
        if let Some(destination) = self.pending_block.get_mut(..leftover.len()) {
            destination.copy_from_slice(leftover);
        }
        self.pending_byte_count = leftover.len();
    }

    /// Ends the message and returns its digest as 64 lower-case hex digits.
    #[must_use]
    pub fn finalize_hex(mut self) -> String {
        let message_bit_count = self.total_byte_count.wrapping_mul(BITS_PER_BYTE);
        self.update(&[PADDING_START_BYTE]);
        // Zeros until eight bytes remain in a block, then the message length in bits.
        let zero_byte_count =
            (BLOCK_BYTES + BLOCK_BYTES - LENGTH_FIELD_BYTES - self.pending_byte_count)
                % BLOCK_BYTES;
        self.update(&vec![0; zero_byte_count]);
        self.update(&message_bit_count.to_be_bytes());
        self.state
            .iter()
            .flat_map(|word| word.to_be_bytes())
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// Mixes one 64-byte block into the state (FIPS 180-4 §6.2.2).
    // The two arrays are indexed by loop counters that stop at their lengths, so no index can be
    // out of range; written with iterators the rounds would be much harder to check against the
    // standard.
    #[allow(clippy::indexing_slicing)]
    fn compress(&mut self, block: &[u8; BLOCK_BYTES]) {
        let mut schedule = [0_u32; ROUND_COUNT];
        let (message_words, _) = block.as_chunks::<BYTES_PER_WORD>();
        for (word, bytes) in schedule.iter_mut().zip(message_words) {
            *word = u32::from_be_bytes(*bytes);
        }
        for round in 16..ROUND_COUNT {
            let earlier_a = schedule[round - 15];
            let earlier_b = schedule[round - 2];
            let sigma_a = earlier_a.rotate_right(7) ^ earlier_a.rotate_right(18) ^ (earlier_a >> 3);
            let sigma_b =
                earlier_b.rotate_right(17) ^ earlier_b.rotate_right(19) ^ (earlier_b >> 10);
            schedule[round] = schedule[round - 16]
                .wrapping_add(sigma_a)
                .wrapping_add(schedule[round - 7])
                .wrapping_add(sigma_b);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for round in 0..ROUND_COUNT {
            let big_sigma_e = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choose = (e & f) ^ (!e & g);
            let temporary_one = h
                .wrapping_add(big_sigma_e)
                .wrapping_add(choose)
                .wrapping_add(ROUND_CONSTANTS[round])
                .wrapping_add(schedule[round]);
            let big_sigma_a = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temporary_two = big_sigma_a.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temporary_one);
            d = c;
            c = b;
            b = a;
            a = temporary_one.wrapping_add(temporary_two);
        }
        let round_result = [a, b, c, d, e, f, g, h];
        for (state_word, added_word) in self.state.iter_mut().zip(round_result) {
            *state_word = state_word.wrapping_add(added_word);
        }
    }
}

/// Whether a file, given as its path relative to the crate, is hashed: test code is not. Test code
/// is a file called `tests.rs` or `test_support.rs`, a file whose name ends `_tests.rs`, and any
/// file under a directory called `tests`. The same rule is written in the shell script's
/// `is_hashed_path`.
#[must_use]
pub fn is_hashed_path(relative_path: &str) -> bool {
    let mut components: Vec<&str> = relative_path.split(PATH_SEPARATOR).collect();
    let file_name = components.pop().unwrap_or_default();
    let is_test_file = file_name == TESTS_FILE_NAME
        || file_name == TEST_SUPPORT_FILE_NAME
        || file_name.ends_with(TESTS_FILE_SUFFIX);
    let is_under_tests_directory = components.contains(&TESTS_DIRECTORY_NAME);
    !(is_test_file || is_under_tests_directory)
}

/// The path of `directory_name` inside `parent_path`, written with `/`; the parent is empty for the
/// crate's own directory.
fn join_relative(parent_path: &str, name: &str) -> String {
    if parent_path.is_empty() {
        name.to_owned()
    } else {
        format!("{parent_path}{PATH_SEPARATOR}{name}")
    }
}

/// Adds every hashed file under `crate_dir/relative_directory` to `found_files`, as a path relative
/// to the crate. Anything that is not a regular file or a directory is left out, as the shell
/// script's `find -type f` leaves it out; a name that is not text, or that holds a newline, is an
/// error, since the script lists files one to a line.
fn collect_hashed_files(
    crate_dir: &Path,
    relative_directory: &str,
    found_files: &mut Vec<String>,
) -> Result<(), String> {
    let directory_path = crate_dir.join(relative_directory);
    let entries = fs::read_dir(&directory_path)
        .map_err(|error| format!("cannot read {}: {error}", directory_path.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("cannot read {}: {error}", directory_path.display()))?;
        let name = entry.file_name().into_string().map_err(|bad_name| {
            format!(
                "{} holds a name that is not text: {bad_name:?}",
                directory_path.display()
            )
        })?;
        if name.contains('\n') {
            return Err(format!(
                "{} holds a name with a newline",
                directory_path.display()
            ));
        }
        let relative_path = join_relative(relative_directory, &name);
        let file_type = entry
            .file_type()
            .map_err(|error| format!("cannot read the type of {relative_path}: {error}"))?;
        if file_type.is_dir() {
            collect_hashed_files(crate_dir, &relative_path, found_files)?;
        } else if file_type.is_file() && is_hashed_path(&relative_path) {
            found_files.push(relative_path);
        }
    }
    Ok(())
}

/// The hashed files of the crate at `crate_dir`, relative to it, in the byte order of their paths.
///
/// # Errors
/// When `src/` or a directory under it cannot be read, or holds a name that is not text.
pub fn hashed_files(crate_dir: &Path) -> Result<Vec<String>, String> {
    let mut found_files: Vec<String> = FIXED_HASHED_FILES
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    collect_hashed_files(crate_dir, SOURCE_DIRECTORY, &mut found_files)?;
    found_files.sort();
    Ok(found_files)
}

/// The source hash of the crate at `crate_dir`: 64 lower-case hex digits.
///
/// # Errors
/// When a hashed file, or the list of them, cannot be read: never a hash of less than all of them.
pub fn source_hash(crate_dir: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    for relative_path in hashed_files(crate_dir)? {
        let file_path = crate_dir.join(&relative_path);
        let contents = fs::read(&file_path)
            .map_err(|error| format!("cannot read {}: {error}", file_path.display()))?;
        hasher.update(relative_path.as_bytes());
        hasher.update(&[FIELD_TERMINATOR]);
        hasher.update(contents.len().to_string().as_bytes());
        hasher.update(&[FIELD_TERMINATOR]);
        hasher.update(&contents);
    }
    Ok(hasher.finalize_hex())
}
