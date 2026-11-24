#!/usr/bin/env bash
#
# scripts/test-resource-pulse-sampler-hash.sh
# ============================================
#
# State table for the compiled Resource Pulse sampler's source hash (src/ minus test code, Cargo.toml, Cargo.lock,
# build.rs, source_hash.rs), over the debug program and the build script (scripts/resource-pulse-sampler-build.sh):
#   - --source-hash and the flags' one answer per run;
#   - which files are hashed (--list-hashed-files), and that none of them holds a #[cfg(test)] item with a body;
#   - the oracle for what the hash covers (a copy of the crate holding exactly the hashed files builds the program in
#     the dev profile and checks in the release one, so it needs no file the hash leaves out in either), and the hash
#     followed through that copy built with cargo between edits (a test-only edit changes nothing; an edit, a new file
#     and a removed one each change it, incrementally), with the build script's --check after each.
# Its row helpers, the barrier, the build of the debug program and the build rows (--check runs in a home, a PATH and a
# crate of its own) are scripts/resource-pulse-sampler-table-lib.sh's. Nothing here touches the live session bus: every
# program run is behind BUS_BARRIER.
#
# "Could not run" is exit 2, never a pass: a missing cargo, rg, awk, sed, sha256sum, cmp, timeout, zsh or ln, a build
# script that cannot be read, a copy of the crate that cannot be made, or a program that could not be built, is fatal;
# a build of the copy that fails is a failed row. The table asserts its own row total.
#
# Requires: bash, cargo, rg, awk, sed, sha256sum, cmp, timeout, zsh and ln (a build row links the build script's tools
# into its PATH). Needs the network the first time (crates.io). Refuses to run as root (exit 2).
#
# Usage: scripts/test-resource-pulse-sampler-hash.sh
#   CARGO_TARGET_DIR, CARGO_BUILD_JOBS, RUST_TEST_THREADS   as for scripts/test-resource-pulse-sampler.sh
#   RESOURCE_PULSE_BUILD_SCRIPT   the build and install script the rows run (default:
#                                 scripts/resource-pulse-sampler-build.sh)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
SAMPLER_TABLE_LIB="$HERE/resource-pulse-sampler-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-sampler-table-lib.sh
source "$SAMPLER_TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$SAMPLER_TABLE_LIB" >&2; exit 2; }
start_sampler_table
require_tools cargo rg awk sed sha256sum cmp timeout zsh ln

[[ -r "$BUILD_SCRIPT" ]] || fatal "cannot read $BUILD_SCRIPT"
build_sampler_program

printf '\nthe source hash and its flag\n'
EMPTY_WORKING_DIR="$WORK_DIR/empty-working-directory"
mkdir -p "$EMPTY_WORKING_DIR"
SOURCE_HASH_STDOUT="$(cd "$EMPTY_WORKING_DIR" && env -i "${BUS_BARRIER[@]}" "$PROGRAM_PATH" --source-hash 2>"$WORK_DIR/source-hash.err")"
SOURCE_HASH_EXIT=$?
check "--source-hash: exit 0, one line of 64 hex digits and a newline, nothing on stderr, and it needs nothing of the environment (it has the barrier alone), no file and no bus" \
  "$SOURCE_HASH_EXIT/$(printf '%s\n' "$SOURCE_HASH_STDOUT" | rg -c "$SOURCE_HASH_PATTERN")/$(wc -c <"$WORK_DIR/source-hash.err" | tr -d ' ')/$(cd "$EMPTY_WORKING_DIR" && env -i "${BUS_BARRIER[@]}" "$PROGRAM_PATH" --source-hash 2>/dev/null | wc -c | tr -d ' ')" \
  "0/1/0/65"
PRINT_AND_EXIT_REFUSALS=""
for refused_call in "--print-constants --source-hash" "--source-hash --print-constants" "--source-hash --print" \
  "--print --source-hash" "--source-hash --fs-root $PROGRAM_FIXTURE_ROOT" "--source-hash --tick-interval-ms 50"; do
  # shellcheck disable=SC2086 # the words of each call are split on purpose
  off_bus "$PROGRAM_PATH" $refused_call >"$WORK_DIR/refused.out" 2>"$WORK_DIR/refused.err"
  PRINT_AND_EXIT_REFUSALS+="$?:$(wc -c <"$WORK_DIR/refused.out" | tr -d ' '):$(rg -c '^usage: resource-pulse-sampler ' "$WORK_DIR/refused.err") "
done
check "more than one print-and-exit flag, or --source-hash beside a run flag, is refused: exit 2, nothing on stdout, the usage line on stderr, in every order" \
  "$PRINT_AND_EXIT_REFUSALS" "2:0:1 2:0:1 2:0:1 2:0:1 2:0:1 2:0:1 "
check "the same print-and-exit flag twice is that one answer, not a refusal" \
  "$(off_bus "$PROGRAM_PATH" --source-hash --source-hash)" "$PROGRAM_SOURCE_HASH"

printf '\nwhat the source hash covers\n'
# hashed_file_list <crate dir> prints the script's list of the files it hashes, one relative path to a line.
hashed_file_list() { RESOURCE_PULSE_SAMPLER_CRATE_DIR="$1" "$BASH_PATH" "$BUILD_SCRIPT" --list-hashed-files; }
# cfg_test_items_with_bodies <file...> prints "<file>:<line>" for each #[cfg(...)] attribute that names `test` and is not
# followed, after any other attributes, comments and blank lines, by a bodiless `mod name;`: a test-only item with a body
# in a file that is hashed. Attributes may span lines.
cfg_test_items_with_bodies() {
  awk '
    function bracket_delta(text,   opened, closed) {
      opened = gsub(/\[/, "[", text); closed = gsub(/\]/, "]", text); return opened - closed
    }
    FNR == 1 { pending = 0; depth = 0 }
    depth > 0 { depth += bracket_delta($0); next }
    /^[[:space:]]*#\[/ {
      depth = bracket_delta($0)
      if ($0 ~ /^[[:space:]]*#\[cfg(_attr)?\(([^]]*[^A-Za-z0-9_])?test([^A-Za-z0-9_]|$)/) {
        if (!pending) { pending = 1; pending_line = FNR }
      }
      if (depth < 0) depth = 0
      next
    }
    /^[[:space:]]*(\/\/.*)?$/ { next }
    pending {
      if ($0 !~ /^[[:space:]]*(pub(\([^)]*\))?[[:space:]]+)?mod[[:space:]]+[A-Za-z0-9_]+;[[:space:]]*$/) print FILENAME ":" pending_line
      pending = 0
    }
  ' "$@"
}
mapfile -t HASHED_FILES < <(hashed_file_list "$CRATE_DIR")
HASHED_FILE_PATHS=()
for hashed_file in "${HASHED_FILES[@]}"; do HASHED_FILE_PATHS+=("$CRATE_DIR/$hashed_file"); done
check "no hashed file holds a #[cfg(test)] item with a body: test code is only in tests.rs, *_tests.rs, test_support.rs or under tests/" \
  "$(( ${#HASHED_FILES[@]} > 0 ? 1 : 0 )):$(cfg_test_items_with_bodies "${HASHED_FILE_PATHS[@]}" | wc -l | tr -d ' ')" "1:0"
CFG_TEST_FIXTURE_DIR="$WORK_DIR/cfg-test-fixtures"
mkdir -p "$CFG_TEST_FIXTURE_DIR"
printf '#[cfg(test)]\nmod tests;\n\n#[cfg(test)]\n// a comment\n#[allow(\n    clippy::unwrap_used,\n)]\n#[path = "x_tests.rs"]\npub(crate) mod more;\n#[cfg(all(unix, test))]\nmod unix_tests;\n' >"$CFG_TEST_FIXTURE_DIR/allowed.rs"
printf 'fn real() {}\n#[cfg(test)]\nfn helper() {}\n' >"$CFG_TEST_FIXTURE_DIR/function.rs"
printf '#[cfg(test)]\nmod tests {\n    fn x() {}\n}\n' >"$CFG_TEST_FIXTURE_DIR/module.rs"
printf '#[cfg(test)]\n#[allow(\n    dead_code\n)]\nimpl Thing {\n}\n' >"$CFG_TEST_FIXTURE_DIR/impl.rs"
printf '#[cfg_attr(test, derive(Debug))]\nstruct Thing;\n' >"$CFG_TEST_FIXTURE_DIR/attr.rs"
printf '#[cfg(not_a_test_flag)]\nfn kept() {}\n#[cfg(feature = "contest")]\nfn also_kept() {}\n' >"$CFG_TEST_FIXTURE_DIR/lookalike.rs"
check "the scan for test code in hashed files accepts each bodiless 'mod' form (comments, multi-line attributes, pub(crate), all(..., test)) and a cfg that only looks like test" \
  "$(cfg_test_items_with_bodies "$CFG_TEST_FIXTURE_DIR/allowed.rs" "$CFG_TEST_FIXTURE_DIR/lookalike.rs" | wc -l | tr -d ' ')" "0"
check "the scan names a test-only function, a module with a body, an impl behind a multi-line attribute and a cfg_attr, each at its attribute's line" \
  "$(cfg_test_items_with_bodies "$CFG_TEST_FIXTURE_DIR/function.rs" "$CFG_TEST_FIXTURE_DIR/module.rs" "$CFG_TEST_FIXTURE_DIR/impl.rs" "$CFG_TEST_FIXTURE_DIR/attr.rs" | sed "s#^$CFG_TEST_FIXTURE_DIR/##" | tr '\n' ' ')" \
  "function.rs:2 module.rs:1 impl.rs:1 attr.rs:1 "
check "the hashed files: Cargo.toml, Cargo.lock, build.rs, source_hash.rs and src/main.rs are in; no tests.rs, *_tests.rs, test_support.rs or tests/ file is; in byte order" \
  "$(printf '%s\n' "${HASHED_FILES[@]}" | rg -c -x -e Cargo.toml -e Cargo.lock -e build.rs -e source_hash.rs -e src/main.rs):$(printf '%s\n' "${HASHED_FILES[@]}" | rg -e '(^|/)tests\.rs$' -e '_tests\.rs$' -e '(^|/)test_support\.rs$' -e '(^|/)tests/' | wc -l | tr -d ' '):$(printf '%s\n' "${HASHED_FILES[@]}" | LC_ALL=C sort -c 2>&1 && echo sorted)" \
  "5:0:sorted"
check "the hashed list is every file under src/ but the test code: the file count of the two agrees" \
  "${#HASHED_FILES[@]}" "$(( 4 + $(find "$CRATE_DIR/src" -type f | rg -v -e '(^|/)tests\.rs$' -e '_tests\.rs$' -e '(^|/)test_support\.rs$' -e '/tests/' | wc -l | tr -d ' ') ))"

# --- the hash follows what compiles in: a copy of the crate, built with cargo ------------------------------------------
printf '\nthe hash follows what compiles in (a copy of the crate, built with cargo and changed between builds)\n'
HASH_COPY_CRATE="$WORK_DIR/hash-copy-crate"
HASH_COPY_TARGET="$WORK_DIR/hash-copy-target"
mkdir -p "$HASH_COPY_CRATE" || fatal "cannot create $HASH_COPY_CRATE"
# The copy holds exactly the files --list-hashed-files names (HASHED_FILES, above) and nothing else, so its first build is
# the oracle for what the hash covers: a build of the program (no test target) fails whenever the program needs a file the
# hash leaves out (a `mod` without #[cfg(test)], a #[path] or an include! naming test code), and rustc is the judge.
# That build is the dev profile; the next row checks the same copy in the release profile, the one the build step builds,
# since debug_assertions differs between the two and a `cfg` on it can bring a left-out file into one profile only.
# These two rows are the only guard that a file the hash leaves out cannot reach the program: the dev and the release
# profiles as built on the host's target (the crate has no features to vary). They catch what a lexer would name: a
# `mod` without #[cfg(test)], a #[path] or an include! of a left-out file, and a cfg on debug_assertions.
for hashed_file in "${HASHED_FILES[@]}"; do
  case "$hashed_file" in
    */*) hashed_file_directory="$HASH_COPY_CRATE/${hashed_file%/*}" ;;
    *) hashed_file_directory="$HASH_COPY_CRATE" ;;
  esac
  if ! mkdir -p "$hashed_file_directory" || ! cp "$CRATE_DIR/$hashed_file" "$hashed_file_directory/"; then
    fatal "cannot copy the hashed file $hashed_file into $HASH_COPY_CRATE"
  fi
done
HASH_COPY_FILES="$(cd "$HASH_COPY_CRATE" && find . -type f | sed 's#^\./##' | LC_ALL=C sort)"
HASH_COPY_PROGRAM="$HASH_COPY_TARGET/debug/resource-pulse-sampler"
# build_hash_copy builds the copy into a target directory of its own (so it can never replace the program under test), and
# fails with the end of cargo's output when cargo fails. Incremental on purpose: each step below is built on the one
# before, never from clean.
build_hash_copy() {
  if off_bus env "CARGO_TARGET_DIR=$HASH_COPY_TARGET" cargo build --locked --manifest-path "$HASH_COPY_CRATE/Cargo.toml" >"$WORK_DIR/hash-copy-build.log" 2>&1; then
    return 0
  fi
  tail -15 "$WORK_DIR/hash-copy-build.log"
  return 1
}
# rebuild_hash_copy: build_hash_copy after an edit, with a failed row when cargo fails.
rebuild_hash_copy() { build_hash_copy || bad "cargo build of the copy of the crate failed"; }
# hash_copy_check_verdict <program> installs the program in a home of its own and runs --check against the copy of the crate.
hash_copy_check_verdict() {
  new_build_row hash-copy-check; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$HASH_COPY_CRATE"
  mkdir -p "$ROW_HOME/.local/lib/resource-pulse"; cp "$1" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
  run_build_script --check
  printf '%s' "$SCRIPT_EXIT"
}
if build_hash_copy; then HASH_COPY_BUILD_VERDICT=built; else HASH_COPY_BUILD_VERDICT=failed; fi
check "the oracle: a copy of the crate holding exactly the ${#HASHED_FILES[@]} files --list-hashed-files names, and nothing else, builds the program with cargo: it needs no file the hash leaves out" \
  "$([[ "$HASH_COPY_FILES" == "$(printf '%s\n' "${HASHED_FILES[@]}")" ]] && echo exactly-the-hashed-files || echo other-files)/$HASH_COPY_BUILD_VERDICT" \
  "exactly-the-hashed-files/built"
# check_hash_copy_release checks the same copy in the release profile (`cargo check --release`: rustc resolves every
# module and include! with that profile's cfg, and generates no code), into the copy's own target directory, and fails
# with the end of cargo's output when cargo fails.
check_hash_copy_release() {
  if off_bus env "CARGO_TARGET_DIR=$HASH_COPY_TARGET" cargo check --release --locked --manifest-path "$HASH_COPY_CRATE/Cargo.toml" >"$WORK_DIR/hash-copy-release-check.log" 2>&1; then
    return 0
  fi
  tail -15 "$WORK_DIR/hash-copy-release-check.log"
  return 1
}
if check_hash_copy_release; then HASH_COPY_RELEASE_VERDICT=checked; else HASH_COPY_RELEASE_VERDICT=failed; fi
check "the oracle in the release profile (the installed one): cargo check --release of the same copy passes, so the program needs no left-out file there either (debug_assertions is off)" \
  "$HASH_COPY_RELEASE_VERDICT" "checked"
BASELINE_COPY_HASH="$(off_bus "$HASH_COPY_PROGRAM" --source-hash)"
cp "$HASH_COPY_PROGRAM" "$WORK_DIR/baseline-copy-program"
check "a copy of the crate at another path, built: the same hash as the checkout's (no path, time or host in it), and --check says current" \
  "$([[ "$BASELINE_COPY_HASH" == "$PROGRAM_SOURCE_HASH" ]] && echo same)/$(hash_copy_check_verdict "$HASH_COPY_PROGRAM")" "same/0"
# The copy holds no test code, so each of these writes a file the copy did not have: src/cpu/ holds only tests.rs in the
# crate, so the copy has no such directory until here.
mkdir -p "$HASH_COPY_CRATE/src/cpu" "$HASH_COPY_CRATE/src/tests"
printf '// a test-only edit\n' >>"$HASH_COPY_CRATE/src/cpu/tests.rs"
printf '// a new test file\n' >"$HASH_COPY_CRATE/src/cpu/new_tests.rs"
printf '// a new test directory\n' >"$HASH_COPY_CRATE/src/tests/new.rs"
printf '// support\n' >>"$HASH_COPY_CRATE/src/test_support.rs"
TEST_FILES_WRITTEN="$(find "$HASH_COPY_CRATE/src/cpu/tests.rs" "$HASH_COPY_CRATE/src/cpu/new_tests.rs" "$HASH_COPY_CRATE/src/tests/new.rs" "$HASH_COPY_CRATE/src/test_support.rs" -type f 2>/dev/null | wc -l | tr -d ' ')"
OLD_PROGRAM_VERDICT="$(hash_copy_check_verdict "$WORK_DIR/baseline-copy-program")"
rebuild_hash_copy
check "test-only files written (tests.rs, a new *_tests.rs, a new tests/ file, test_support.rs: all 4 there): the rebuilt program's --source-hash and the script's --check are unchanged, and the old program is still current" \
  "$TEST_FILES_WRITTEN/$([[ "$(off_bus "$HASH_COPY_PROGRAM" --source-hash)" == "$BASELINE_COPY_HASH" ]] && echo same)/$OLD_PROGRAM_VERDICT/$(hash_copy_check_verdict "$HASH_COPY_PROGRAM")" "4/same/0/0"
printf '// an edit to a file that compiles in\n' >>"$HASH_COPY_CRATE/src/cpu.rs"
STALE_PROGRAM_VERDICT="$(hash_copy_check_verdict "$WORK_DIR/baseline-copy-program")"
rebuild_hash_copy
EDITED_COPY_HASH="$(off_bus "$HASH_COPY_PROGRAM" --source-hash)"
check "an edit to a file that compiles in: --check says 1 for the old program, and after an incremental rebuild the hash is different and --check says current" \
  "$STALE_PROGRAM_VERDICT/$([[ "$EDITED_COPY_HASH" != "$BASELINE_COPY_HASH" ]] && echo changed)/$(hash_copy_check_verdict "$HASH_COPY_PROGRAM")" "1/changed/0"
printf '// a source file added under src/\n' >"$HASH_COPY_CRATE/src/added_source.rs"
cp "$HASH_COPY_PROGRAM" "$WORK_DIR/edited-copy-program"
ADDED_STALE_VERDICT="$(hash_copy_check_verdict "$WORK_DIR/edited-copy-program")"
rebuild_hash_copy
ADDED_COPY_HASH="$(off_bus "$HASH_COPY_PROGRAM" --source-hash)"
check "a file added under src/ (nothing else touched, no clean build): --check says 1 for the old program, and the incrementally rebuilt hash is different and current" \
  "$ADDED_STALE_VERDICT/$([[ "$ADDED_COPY_HASH" != "$EDITED_COPY_HASH" ]] && echo changed)/$(hash_copy_check_verdict "$HASH_COPY_PROGRAM")" "1/changed/0"
rm "$HASH_COPY_CRATE/src/added_source.rs"
rebuild_hash_copy
check "that file removed again: the rebuilt hash is the one before it was added, and --check says current" \
  "$([[ "$(off_bus "$HASH_COPY_PROGRAM" --source-hash)" == "$EDITED_COPY_HASH" ]] && echo back)/$(hash_copy_check_verdict "$HASH_COPY_PROGRAM")" "back/0"

# 3 rows of the source hash and its flag + 5 of what it covers
# + 7 of the oracle and the hash following a copy of the crate through five builds (the oracle, on the first build of a
#   copy holding exactly the hashed files, the oracle in the release profile, and one row per build)
# = 15.
EXPECTED_ROWS=15

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
