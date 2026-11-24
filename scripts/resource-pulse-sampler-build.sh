#!/usr/bin/env bash
#
# scripts/resource-pulse-sampler-build.sh
# =======================================
#
# The build step for the compiled Resource Pulse sampler (resource-pulse-sampler/): it builds
# the release program and installs it by a rename, at a fixed path outside the checkout,
# ~/.local/lib/resource-pulse/resource-pulse-sampler, which systemd/resource-pulse.service
# runs. This step only puts the file in place: the refresh step
# (scripts/resource-pulse-service-refresh.sh), after it, restarts the unit when the
# installed program is newer than the unit's start.
#
# Why outside the checkout, and why a rename: the checkout is what the user's links point into, so a
# program run from a build directory inside it would change under a running service at every
# `git merge` and every build. Installed by copy and rename, the running program keeps its old
# file until something restarts it, and no reader of the path ever finds it missing, empty or
# half-written. An install that changes nothing renames nothing: the build is compared with the
# installed file byte for byte first, so a deploy that did not change the program does not make
# the sampler restart (a restart resets its histories).
#
# Usage:
#   scripts/resource-pulse-sampler-build.sh                      build and install
#   scripts/resource-pulse-sampler-build.sh --check              is the installed program this checkout's?
#   scripts/resource-pulse-sampler-build.sh --list-hashed-files  the files the source hash covers
#   scripts/resource-pulse-sampler-build.sh --installed-path     the path the build step installs at, for this HOME
#   --build-limits-module PATH    a shell file whose CARGO_BUILD_JOBS caps the jobs (step 7; zsh sources it); none
#                                 given: CARGO_BUILD_JOBS, else 2
#   --program-timeout-seconds N   how long the installed program may take to answer --source-hash (default 5)
#   --build-timeout-seconds N     how long the build may run (default 1200: a cold download on a slow link)
# This script reads no file for the job cap unless --build-limits-module names one. The options combine with any mode.
# The three modes are exclusive: two of them on one command line (the same one twice included) are a usage error, exit
# 2, never the last one silently. So is --build-limits-module given twice, or with no value or an empty one: a path
# given twice is never the last one silently either. The two timeouts take the last value given. A relative path
# is made absolute as the options are read ($PWD/<path>), before anything reads it. The timeouts are options, not
# environment variables, so that nothing in an install's environment can change them; the state table gives them short
# values.
#
# What the build step does, in order. It prints one line, except when it runs cargo: then it prints a building line
# first, and the result line after it.
#   1. HOME must be set and an absolute path (a ⚠ line otherwise); it is read without its trailing slashes, so that
#      HOME=/h/ names /h/.local/... as the unit's %h/.local/... does.
#   2. The installed path must be absent or a regular file; anything else (a directory) is a ⚠ line, and nothing is
#      written there.
#   3. The checkout's source hash: it needs sha256sum, and every question to a program needs timeout (so that none can
#      hang an install). A machine without either gets no build and a ⚠ line naming the tool, and so does a checkout
#      it cannot hash; all three are decided before cargo runs.
#   4. Ask before building: the installed program is asked for --source-hash (within --program-timeout-seconds) and
#      the answer is compared with the checkout's hash. Equal: no cargo is run, nothing is touched, and
#        ✓ Resource Pulse sampler program unchanged: <path>
#      Anything else (nothing installed, a different hash, no answer) goes on to build.
#   5. Cargo: it must be on PATH and at least the crate's rust-version (Cargo.toml), compared as numbers. A machine
#      without a new enough cargo gets no program and no gjs fallback, and is told so:
#        ⚠ Resource Pulse sampler program not built: <why>        (on stderr)
#   6. The building line, on stdout (it says a first build takes about half a minute):
#        … Resource Pulse sampler program building (cargo build --release; ...)
#   7. `cargo build --release --locked` into ${XDG_CACHE_HOME:-$HOME/.cache}/resource-pulse/cargo-target-install, a
#      build directory nothing else writes (see "One build directory of its own" below), under the build caps
#      (CARGO_BUILD_JOBS: the environment's if set, else the one the --build-limits-module module exports, run in zsh
#      so the rule is written once; 2 when no module is given, or zsh or the module is not there) and under a time-out
#      (--build-timeout-seconds; the whole process group is ended, then killed). Its output is kept in
#      ${XDG_CACHE_HOME:-$HOME/.cache}/resource-pulse/build.log. A failed or timed-out build leaves the installed
#      program as it was, and the line is
#        ⚠ Resource Pulse sampler program not built: cargo build failed (exit N); its output is in ...
#        ⚠ Resource Pulse sampler program not built: cargo build timed out after N s and was ended; ...
#   8. The built program is asked for --source-hash (within --program-timeout-seconds), and nothing is installed
#      unless its answer is the checkout's hash: cargo judges a build fresh by its files' times, so a build directory
#      another checkout wrote could hand this one that checkout's program. Another hash, or no answer, leaves the
#      installed program as it was, and the line gives both hashes (or the question's failure) and the directory to
#      remove before running it again:
#        ⚠ Resource Pulse sampler program not built: the build left a program built from other sources ...
#   9. The built program is compared with the installed one (cmp), the last guard. Equal: nothing is touched, and
#      `✓ … unchanged: <path>`. Different, or none installed: it is copied beside the installed one under a
#      temporary name (same directory, so same filesystem) and renamed over it, and
#        ✓ Resource Pulse sampler program built and installed: <path>
#      The temporary file is removed on every exit, a TERM, INT, QUIT or HUP included.
#
# Signals. The build step traps HUP, INT, QUIT and TERM from its start to its end (arm_signal_traps, in
# scripts/resource-pulse-background-jobs.sh, which this script sources): a signal exits with 129, 130, 131 or 143 and
# prints nothing after it, and the EXIT trap ends a build in flight (TERM to the build's whole process group, KILL to what is left after
# KILL_AFTER_SECONDS, waiting until it is gone) and removes a temporary file. From just before the rename, and just
# before an "unchanged" line, the step ignores the four (ignore_terminating_signals) until it exits 0: a signal before
# that point leaves nothing installed and no ✓ line, and after it the step finishes with its ✓. So an install always
# prints its ✓, and a printed ✓ always means the program at the path is this checkout's.
# The build runs in the background and is waited for, because `timeout` puts it in a
# process group of its own, which a terminal's Ctrl-C never reaches; a question to a
# program is a bounded command substitution, and a signal during one is acted on when it
# returns. A Ctrl-C or Ctrl-\ typed at a caller's terminal reaches the caller,
# its shell and this script at once, and a caller that answers by killing its own shell would otherwise leave this script
# running: with these traps the build is ended, no ✓ is printed and nothing is installed. QUIT is trapped because bash
# ignores it unless it is trapped: a script without that trap kept running after Ctrl-\, finished the build, installed
# the program and printed ✓. (A signal already ignored when bash starts cannot be trapped, and stays ignored.)
#
# Its background jobs, signal traps and question for --source-hash are a file of their own beside it,
# scripts/resource-pulse-background-jobs.sh, which it sources from its own directory. When that file cannot be loaded,
# the build step says so in one ⚠ line and exits 0, with no cargo run; --check cannot tell (exit 2).
# --list-hashed-files and --installed-path do not use it.
#
# One build directory of its own. cargo-target-install is written by this step and by nothing else: the state table
# builds elsewhere, and a checkout's own `cargo` runs elsewhere too. A build directory shared between checkouts hands
# one checkout another's release program when its files are older than that checkout's last build there (cargo's
# freshness is by the files' times, wherever the package lives), which step 8 would refuse every time.
# Every other failure (no usable HOME, a crate or program that is not there, a file it cannot create, copy, rename or
# compare) prints a ⚠ line of the same form, with the tool's own message folded into it and never printed before
# it; the build step still exits 0: under `set -e` a failing step would stop a caller's whole install, for
# a program nothing runs yet. Only a call with an argument it does not know, two modes, or an option it refuses (see
# Usage) exits 2.
#
# --check builds nothing and never runs cargo: it asks the installed program for --source-hash
# and compares it with the hash of this checkout (the files of --list-hashed-files, see
# resource-pulse-sampler/source_hash.rs). Exit status, with one line saying which:
#   0  installed and current        ✓ ... installed and current (source hash <hash>)
#   1  missing, or its hash differs ⚠ ... missing: ...   /   ⚠ ... is not this checkout's: ...
#                                   ("missing": nothing at all at the installed path)
#   2  could not tell               ⚠ ... could not tell: <why>  (no sha256sum, no usable HOME, a
#                                   directory on the way to the installed path that cannot be searched
#                                   (never "missing": a build could not mend it), a
#                                   checkout it cannot hash, an installed path that is not a regular
#                                   file (a directory, a link to nothing: the build step refuses
#                                   both), an installed file that cannot be run, that does not know
#                                   --source-hash, that does not answer within
#                                   --program-timeout-seconds, or that prints no hash; no timeout tool;
#                                   no background jobs file beside this script)
#
# --installed-path prints the absolute path the build step installs at for this HOME (step 1: trailing slashes dropped),
# and a newline, on stdout, nothing on stderr, exit 0; with HOME unset, empty or not an absolute path it prints nothing on
# stdout, one ⚠ line on stderr, exit 2. It reads HOME and nothing else (no file, no tool, no program), so it answers at
# once.
#
# "Current", here and in the build step, means built from the same sources (the source hash) and nothing more: a new
# Rust toolchain, a RUSTFLAGS or a user-level cargo configuration does not make the installed program stale, and
# does not rebuild it.
#
# What the hash is, so that this script and build.rs give the same answer: SHA-256 over, for each
# hashed file in the byte order of its path relative to the crate (LC_ALL=C sort), the path, a NUL,
# the file's length in decimal, a NUL, and its contents. The hashed files are Cargo.toml, Cargo.lock,
# build.rs, source_hash.rs and every file under src/ that is not test code (is_hashed_path below,
# and its twin in source_hash.rs). Never the commit, the time, the host or an absolute path. A path
# holding a newline is not supported (build.rs refuses it).
#
# Tools it needs, and what it does without each: cargo (the ⚠ line above; --check does not use
# it); timeout and sha256sum (the build step builds nothing and says which is missing, and --check cannot tell: every
# question and the build are bounded, so none can hang an install, and nothing is installed that cannot be shown to be
# this checkout's); zsh (with --build-limits-module, the job cap falls back to FALLBACK_BUILD_JOBS); cmp (a ⚠ line: it
# cannot tell whether the program changed, so it installs nothing); mkdir, mktemp, cp, chmod, mv, rm (a ⚠ line naming the
# step that failed); sleep (the EXIT trap's wait for an ended build; without it the wait does not pause, and KILL
# follows TERM at once); find, sort, cat, wc (the build step and --check cannot hash the checkout, and
# --list-hashed-files exits 1).
#
# Test overrides: RESOURCE_PULSE_SAMPLER_CRATE_DIR, the crate (default: this checkout's
# resource-pulse-sampler/). The home directory is HOME and nothing else. The state table is
# scripts/test-resource-pulse-sampler-build.sh, against a stub cargo, a private HOME, PATH and cache;
# scripts/test-resource-pulse-sampler-hash.sh holds --list-hashed-files and --check to real builds.

set -uo pipefail

PROGRAM_LABEL="Resource Pulse sampler program"
PROGRAM_NAME="resource-pulse-sampler"
INSTALLED_PROGRAM_RELATIVE_PATH=".local/lib/resource-pulse/$PROGRAM_NAME"
CACHE_SUBDIRECTORY="resource-pulse"
BUILD_LOG_NAME="build.log"
# The build directory of this step and of nothing else (see "One build directory of its own" above).
CARGO_TARGET_SUBDIRECTORY="cargo-target-install"
CARGO_VERSION_PATTERN='^cargo ([0-9]+)\.([0-9]+)\.([0-9]+)'
RUST_VERSION_PATTERN='^rust-version[[:space:]]*=[[:space:]]*"([0-9]+)\.([0-9]+)(\.([0-9]+))?"'
# The job count when neither CARGO_BUILD_JOBS nor the --build-limits-module file gives one.
FALLBACK_BUILD_JOBS=2
POSITIVE_INTEGER_PATTERN='^[1-9][0-9]*$'
# The hashed files outside src/ and the directory of the rest; source_hash.rs has the same two.
FIXED_HASHED_FILES=(Cargo.toml Cargo.lock build.rs source_hash.rs)
SOURCE_DIRECTORY="src"
USAGE_EXIT_STATUS=2
# How long the build may run (enough for a cold download of the crates on a slow link). It and the installed program's
# bound for --source-hash (DEFAULT_PROGRAM_TIMEOUT_SECONDS, below) can be set by an option, for the
# state table: --build-timeout-seconds and --program-timeout-seconds.
DEFAULT_BUILD_TIMEOUT_SECONDS=1200
# How long a program may take to answer --source-hash, which it prints at once.
DEFAULT_PROGRAM_TIMEOUT_SECONDS=5
# The status of a command killed by SIGKILL (128 + 9): `timeout`'s, when its --kill-after ended the command.
KILLED_STATUS=137
# What a first build takes, said on the building line.
FIRST_BUILD_DURATION_TEXT="about half a minute"
# The command a remedy names to build and install the program again: this script by its own path (set by main).
BUILD_COMMAND_TEXT=""
# Exit statuses of --check.
CHECK_CURRENT=0
CHECK_STALE=1
CHECK_COULD_NOT_TELL=2
# The exit status of --installed-path when HOME gives no path.
INSTALLED_PATH_UNKNOWN=2

# Pure bash, no dirname: see scripts/resource-pulse-service-refresh.sh.
SCRIPT_PATH="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_PATH" == */* ]]; then
  SCRIPT_DIRECTORY="${SCRIPT_PATH%/*}"
else
  SCRIPT_DIRECTORY="."
fi
# Background jobs, signals and the question for --source-hash: a file of their own, sourced into this shell (never a
# subshell: the EXIT trap reads `$!` and the job's state). Its EXIT trap removes what remove_files_of_the_run (defined
# after the build step's functions) names. Only the build step and --check run on it: when it cannot be loaded (missing,
# not a regular file, unreadable, or failing as it is read), they say so (refuse_without_background_jobs, in main).
BACKGROUND_JOBS_LIBRARY="$SCRIPT_DIRECTORY/resource-pulse-background-jobs.sh"
BACKGROUND_JOBS_LOADED=0
# shellcheck source=SCRIPTDIR/resource-pulse-background-jobs.sh
if [[ -f "$BACKGROUND_JOBS_LIBRARY" ]] && source "$BACKGROUND_JOBS_LIBRARY" 2>/dev/null; then
  BACKGROUND_JOBS_LOADED=1
fi
CRATE_DIRECTORY="${RESOURCE_PULSE_SAMPLER_CRATE_DIR:-$SCRIPT_DIRECTORY/../resource-pulse-sampler}"
# The path a caller may name (main reads it, absolute): the shell file whose CARGO_BUILD_JOBS caps the jobs. Empty when
# not given: then the cap is CARGO_BUILD_JOBS or FALLBACK_BUILD_JOBS (build_jobs). It is never looked for beside this
# script.
BUILD_LIMITS_MODULE=""
# HOME, made the base of every path the step names (settle_home_directory, below); empty, with HOME_PROBLEM saying why,
# when HOME is unset, empty or not an absolute path.
HOME_DIRECTORY=""
HOME_PROBLEM=""
PROGRAM_TIMEOUT_SECONDS="$DEFAULT_PROGRAM_TIMEOUT_SECONDS"
BUILD_TIMEOUT_SECONDS="$DEFAULT_BUILD_TIMEOUT_SECONDS"
# The temporary file of an install in progress, removed by the traps below.
TEMPORARY_PROGRAM_PATH=""
# How long the last build ran, in whole seconds (bash's SECONDS), set by build_release_program.
BUILD_ELAPSED_SECONDS=0

# say_ok <message>: the ✓ line, on stdout.
say_ok() { printf '  ✓ %s %s\n' "$PROGRAM_LABEL" "$*"; }
# say_building <message>: the line before a build, on stdout; no symbol, as it is not a result.
say_building() { printf '  … %s %s\n' "$PROGRAM_LABEL" "$*"; }
# say_warning <message>: the ⚠ line, on stderr.
say_warning() { printf '  ⚠ %s %s\n' "$PROGRAM_LABEL" "$*" >&2; }
# not_built <why>: the ⚠ line of a build that did not happen.
not_built() { say_warning "not built: $*"; }
# How a line writes the home directory, for reading.
HOME_SHORTHAND="~"
# tilde_path <path>: the path with the home directory written as HOME_SHORTHAND; a path outside it is left as it is.
tilde_path() {
  local home_prefix="${HOME_DIRECTORY%/}/"
  if [[ -n "$HOME_DIRECTORY" && "$1" == "$home_prefix"* ]]; then
    printf '%s/%s' "$HOME_SHORTHAND" "${1#"$home_prefix"}"
  else
    printf '%s' "$1"
  fi
}

# settle_home_directory: sets HOME_DIRECTORY to HOME without its trailing slashes (a HOME of slashes alone is /), so that
# HOME=/h/ names /h/.local/... as the unit's %h/.local/... does; or, when HOME is unset, empty or not an absolute path
# (which would name paths relative to wherever the script runs), leaves it empty and sets HOME_PROBLEM.
settle_home_directory() {
  local home_as_given="${HOME:-}"
  if [[ -z "$home_as_given" ]]; then
    HOME_PROBLEM="HOME is not set"
    return
  fi
  if [[ "$home_as_given" != /* ]]; then
    HOME_PROBLEM="HOME is not an absolute path ($home_as_given)"
    return
  fi
  HOME_DIRECTORY="$home_as_given"
  while [[ "$HOME_DIRECTORY" == */ && "$HOME_DIRECTORY" != / ]]; do HOME_DIRECTORY="${HOME_DIRECTORY%/}"; done
}

# is_hashed_path <relative path>: succeeds unless the file is test code: tests.rs, test_support.rs
# or *_tests.rs in any directory, or anything under a directory called tests. The same rule is
# in source_hash.rs (is_hashed_path).
is_hashed_path() {
  case "$1" in
    tests.rs | */tests.rs | test_support.rs | */test_support.rs | *_tests.rs | tests/* | */tests/*) return 1 ;;
  esac
  return 0
}

# list_hashed_files: the hashed files, relative to the crate, one to a line, in the byte order of
# their paths. Fails when src/ cannot be listed.
list_hashed_files() {
  local relative_path
  cd "$CRATE_DIRECTORY" || return 1
  { printf '%s\n' "${FIXED_HASHED_FILES[@]}"; find "$SOURCE_DIRECTORY" -type f; } | LC_ALL=C sort |
    while IFS= read -r relative_path; do
      if is_hashed_path "$relative_path"; then printf '%s\n' "$relative_path"; fi
    done
}

# hash_stream <file list>: writes, for each listed file, its path, NUL, its length in decimal, NUL
# and its contents: what is hashed. Run in the crate. Fails when a file cannot be read.
hash_stream() {
  local relative_path size_text
  while IFS= read -r relative_path; do
    size_text="$(wc -c <"$relative_path")" || return 1
    printf '%s\0%s\0' "$relative_path" "${size_text//[[:space:]]/}"
    cat -- "$relative_path" || return 1
  done <<<"$1"
}

# checkout_source_hash: prints this checkout's source hash. Fails, printing nothing, when a hashed
# file or the list of them cannot be read: never the hash of less than all of them.
checkout_source_hash() {
  local file_list digest_line
  file_list="$(list_hashed_files)" || return 1
  [[ -n "$file_list" ]] || return 1
  digest_line="$(cd "$CRATE_DIRECTORY" && hash_stream "$file_list" | sha256sum)" || return 1
  printf '%s\n' "${digest_line%% *}"
}

# installed_program_path: prints the path the build step installs at, which --check asks and --installed-path prints:
# one definition, so that the three agree. Only with HOME set.
installed_program_path() { printf '%s\n' "${HOME_DIRECTORY%/}/$INSTALLED_PROGRAM_RELATIVE_PATH"; }

# path_can_be_looked_at <absolute path>: succeeds when a test that finds the path not there can be believed: HOME is a
# directory, and the deepest directory on the way to the path that exists can be searched, so the test failed on a name
# that is not there and not on a permission. Otherwise sets LOOKUP_PROBLEM (in words, for a line) and fails. The path
# must be absolute: the walk up a relative one whose first part is missing never ends.
path_can_be_looked_at() {
  local deepest_existing_ancestor="${1%/*}"
  LOOKUP_PROBLEM=""
  if [[ ! -d "$HOME_DIRECTORY" ]]; then
    LOOKUP_PROBLEM="HOME ($HOME_DIRECTORY) is not a directory this user can reach"
    return 1
  fi
  while [[ -n "$deepest_existing_ancestor" && ! -e "$deepest_existing_ancestor" ]]; do
    deepest_existing_ancestor="${deepest_existing_ancestor%/*}"
  done
  if [[ -n "$deepest_existing_ancestor" && -d "$deepest_existing_ancestor" && ! -x "$deepest_existing_ancestor" ]]; then
    LOOKUP_PROBLEM="$deepest_existing_ancestor cannot be searched"
    return 1
  fi
}

# required_rust_version: prints the crate's rust-version, as "major.minor.patch" (patch 0 when the
# manifest gives two numbers). Fails when Cargo.toml has none.
required_rust_version() {
  local manifest_line
  while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
    if [[ "$manifest_line" =~ $RUST_VERSION_PATTERN ]]; then
      printf '%s.%s.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[4]:-0}"
      return 0
    fi
  done <"$CRATE_DIRECTORY/Cargo.toml"
  return 1
}

# version_is_older <a.b.c> <x.y.z>: succeeds when the first is lower, comparing each part as a number.
version_is_older() {
  local -a older newer
  local part_index
  IFS=. read -r -a older <<<"$1"
  IFS=. read -r -a newer <<<"$2"
  for part_index in 0 1 2; do
    (( older[part_index] < newer[part_index] )) && return 0
    (( older[part_index] > newer[part_index] )) && return 1
  done
  return 1
}

# build_jobs: prints the job cap for cargo: CARGO_BUILD_JOBS when the environment sets it, else the value the
# --build-limits-module file computes, else FALLBACK_BUILD_JOBS. The rule lives in that file only; this runs it in zsh and
# reads what it exports. No file given is FALLBACK_BUILD_JOBS: none is looked for.
build_jobs() {
  local module_jobs=""
  if [[ -n "${CARGO_BUILD_JOBS:-}" ]]; then
    printf '%s\n' "$CARGO_BUILD_JOBS"
    return 0
  fi
  if [[ -n "$BUILD_LIMITS_MODULE" ]] && command -v zsh >/dev/null 2>&1 && [[ -r "$BUILD_LIMITS_MODULE" ]]; then
    # $1 is the module's path, given to zsh as an argument; the module's own output is discarded.
    # shellcheck disable=SC2016
    module_jobs="$(zsh -f -c 'source "$1" >/dev/null 2>&1; print -r -- "$CARGO_BUILD_JOBS"' zsh "$BUILD_LIMITS_MODULE" 2>/dev/null)"
  fi
  if [[ "$module_jobs" =~ $POSITIVE_INTEGER_PATTERN ]]; then
    printf '%s\n' "$module_jobs"
  else
    printf '%s\n' "$FALLBACK_BUILD_JOBS"
  fi
}

# probe_program <path>: asks a program (the installed one, or the one a build left) for its --source-hash, within
# PROGRAM_TIMEOUT_SECONDS. Sets PROBE_HASH and succeeds when it printed a hash; else sets PROBE_PROBLEM (in words, for a
# line) and fails: no timeout tool, an answer that did not come in time, a failure, or text that is no hash.
probe_program() {
  local program="$1" question_status
  PROBE_HASH=""
  if ! command -v timeout >/dev/null 2>&1; then
    PROBE_PROBLEM="timeout is not installed, so the wait for $(tilde_path "$program") cannot be bounded"
    return 1
  fi
  if [[ ! -x "$program" ]]; then
    PROBE_PROBLEM="$(tilde_path "$program") cannot be run (it is not executable)"
    return 1
  fi
  ask_for_source_hash "$PROGRAM_TIMEOUT_SECONDS" "$program"
  question_status=$?
  if (( question_status == TIMED_OUT_STATUS )); then
    PROBE_PROBLEM="$(tilde_path "$program") did not answer --source-hash within $PROGRAM_TIMEOUT_SECONDS s"
    return 1
  fi
  if (( question_status == SOURCE_HASH_QUESTION_FAILED )); then
    PROBE_PROBLEM="$(tilde_path "$program") failed to answer --source-hash (an older program does not know it)"
    return 1
  fi
  if (( question_status != 0 )); then
    PROBE_PROBLEM="$(tilde_path "$program") did not print a source hash for --source-hash"
    return 1
  fi
  PROBE_HASH="$SOURCE_HASH_ANSWER"
}

# installed_program_is_current <path> <checkout hash>: succeeds only when the installed program answers and its hash is
# the checkout's. Every other case (nothing installed, no answer, another hash) fails: the caller builds.
installed_program_is_current() {
  [[ -f "$1" ]] || return 1
  probe_program "$1" || return 1
  [[ "$PROBE_HASH" == "$2" ]]
}

# missing_tool_for_the_build: prints the first of the tools the build step cannot go without (sha256sum for the
# checkout's hash, timeout for every bounded question and the build) that is not on PATH; fails when none is missing.
missing_tool_for_the_build() {
  local required_tool
  for required_tool in sha256sum timeout; do
    if ! command -v "$required_tool" >/dev/null 2>&1; then
      printf '%s\n' "$required_tool"
      return 0
    fi
  done
  return 1
}

# built_program_is_this_checkouts <built program> <checkout hash> <build directory>: succeeds when the program the build
# left answers --source-hash with the checkout's hash. Otherwise says the ⚠ line (both hashes, or why it gave none, and
# the build directory to remove) and fails: the caller installs nothing.
built_program_is_this_checkouts() {
  local built_program="$1" checkout_hash="$2" build_directory="$3" remedy
  remedy="so nothing was installed; remove $(tilde_path "$build_directory") and run $BUILD_COMMAND_TEXT again"
  if ! probe_program "$built_program"; then
    not_built "the build left a program that cannot be shown to be built from this checkout's sources: $PROBE_PROBLEM (this checkout's hash $checkout_hash), $remedy"
    return 1
  fi
  if [[ "$PROBE_HASH" != "$checkout_hash" ]]; then
    not_built "the build left a program built from other sources (its hash $PROBE_HASH, this checkout's $checkout_hash), $remedy"
    return 1
  fi
}

# cargo_is_new_enough: succeeds when cargo is on PATH and at least the crate's rust-version;
# otherwise fails and sets CARGO_CHECK_PROBLEM to the reason, for the caller to say.
cargo_is_new_enough() {
  local required_version cargo_version_line installed_version
  CARGO_CHECK_PROBLEM=""
  if ! required_version="$(required_rust_version)"; then
    CARGO_CHECK_PROBLEM="rust-version is missing from $(tilde_path "$CRATE_DIRECTORY/Cargo.toml"), so the version cargo needs is not known"
    return 1
  fi
  if ! command -v cargo >/dev/null 2>&1; then
    CARGO_CHECK_PROBLEM="cargo is not installed (not on PATH); the program needs cargo ${required_version%.0} or newer, and there is no gjs fallback"
    return 1
  fi
  if ! cargo_version_line="$(cargo --version 2>&1)"; then
    CARGO_CHECK_PROBLEM="cannot read cargo's version: 'cargo --version' failed and said: ${cargo_version_line//$'\n'/ }"
    return 1
  fi
  if [[ ! "$cargo_version_line" =~ $CARGO_VERSION_PATTERN ]]; then
    CARGO_CHECK_PROBLEM="cannot read cargo's version from what 'cargo --version' said: ${cargo_version_line//$'\n'/ }"
    return 1
  fi
  installed_version="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
  if version_is_older "$installed_version" "$required_version"; then
    CARGO_CHECK_PROBLEM="cargo $installed_version is older than the ${required_version%.0} this crate's rust-version needs"
    return 1
  fi
  return 0
}

# build_release_program <cache root> <build directory>: runs the release build under the caps and within
# BUILD_TIMEOUT_SECONDS (the whole process group is ended, then killed after KILL_AFTER_SECONDS), as a background job
# that is waited for (run_in_background_and_wait: a signal must reach the build, and the EXIT trap
# ends it); prints nothing (the output goes to the build log) and sets BUILD_ELAPSED_SECONDS. Fails with the build's exit
# status (TIMED_OUT_STATUS or KILLED_STATUS when the bound ended it), or 1 when it could not start.
build_release_program() {
  local cache_root="$1" build_directory="$2" build_status build_started_at build_job_count
  mkdir -p "$cache_root/$CACHE_SUBDIRECTORY" 2>/dev/null || return 1
  build_job_count="$(build_jobs)"
  build_started_at=$SECONDS
  CARGO_BUILD_JOBS="$build_job_count" CARGO_TARGET_DIR="$build_directory" \
    run_in_background_and_wait timeout --kill-after="$KILL_AFTER_SECONDS" "$BUILD_TIMEOUT_SECONDS" \
    cargo build --release --locked --manifest-path "$CRATE_DIRECTORY/Cargo.toml" \
    >"$cache_root/$CACHE_SUBDIRECTORY/$BUILD_LOG_NAME" 2>&1
  build_status=$?
  BUILD_ELAPSED_SECONDS=$(( SECONDS - build_started_at ))
  return "$build_status"
}

# build_was_ended_by_its_bound <exit status>: succeeds when the bound ended the build: `timeout`'s own status, or the
# status of its --kill-after's SIGKILL once the bound had passed. A SIGKILL before the bound came from something else
# (the out-of-memory killer, say), and reads as a failed build.
build_was_ended_by_its_bound() {
  (( $1 == TIMED_OUT_STATUS )) && return 0
  (( $1 == KILLED_STATUS && BUILD_ELAPSED_SECONDS >= BUILD_TIMEOUT_SECONDS ))
}

# remove_temporary_program: removes the temporary file of an install in progress, if there is one.
remove_temporary_program() {
  if [[ -n "$TEMPORARY_PROGRAM_PATH" ]]; then rm -f -- "$TEMPORARY_PROGRAM_PATH"; fi
}

# remove_files_of_the_run: what the EXIT trap removes for the build step: the temporary file of an install
# in progress.
remove_files_of_the_run() { remove_temporary_program; }

# flatten_message <text>: the text on one line, so that a tool's message can be folded into a ⚠ line.
flatten_message() { printf '%s' "${1//$'\n'/ }"; }

# install_by_rename <built program> <installed program>: copies the built program beside the
# installed path under a temporary name, then renames it over the path. Says the ⚠ line itself and
# fails when a step fails (a tool's own message is folded into that line, never printed before it). The temporary
# file is removed on every exit, a signal included: by the build step's traps (arm_signal_traps), armed throughout.
install_by_rename() {
  local built_program="$1" installed_program="$2" installed_directory tool_message
  installed_directory="${installed_program%/*}"
  if ! tool_message="$(mkdir -p "$installed_directory" 2>&1)"; then
    not_built "cannot create $(tilde_path "$installed_directory"): $(flatten_message "$tool_message")"
    return 1
  fi
  if ! TEMPORARY_PROGRAM_PATH="$(mktemp "$installed_directory/.$PROGRAM_NAME.XXXXXX" 2>&1)"; then
    tool_message="$TEMPORARY_PROGRAM_PATH"
    TEMPORARY_PROGRAM_PATH=""
    not_built "cannot create a temporary file in $(tilde_path "$installed_directory"): $(flatten_message "$tool_message")"
    return 1
  fi
  if ! cp -- "$built_program" "$TEMPORARY_PROGRAM_PATH" || ! chmod 755 "$TEMPORARY_PROGRAM_PATH"; then
    remove_temporary_program
    TEMPORARY_PROGRAM_PATH=""
    not_built "cannot copy the built program into $(tilde_path "$installed_directory")"
    return 1
  fi
  # The point of no return: from here to the exit the four signals are ignored, so that an install always prints its ✓
  # and exits 0 (a signal before here leaves nothing installed; see "Signals" above).
  ignore_terminating_signals
  if ! mv -f -- "$TEMPORARY_PROGRAM_PATH" "$installed_program"; then
    remove_temporary_program
    TEMPORARY_PROGRAM_PATH=""
    not_built "cannot rename the built program over $(tilde_path "$installed_program")"
    return 1
  fi
  TEMPORARY_PROGRAM_PATH=""
}

# build_and_install: the build step, ending in its line (and a building line before it, only when cargo runs); always
# succeeds, unless a signal ends it (arm_signal_traps).
build_and_install() {
  local cache_root build_status build_directory built_program installed_program comparison_status checkout_hash missing_tool
  arm_signal_traps
  if [[ -z "$HOME_DIRECTORY" ]]; then
    not_built "$HOME_PROBLEM, so the install path is not known"
    return 0
  fi
  if [[ ! -r "$CRATE_DIRECTORY/Cargo.toml" ]]; then
    not_built "no crate at $(tilde_path "$CRATE_DIRECTORY")"
    return 0
  fi
  installed_program="$(installed_program_path)"
  if [[ -e "$installed_program" || -L "$installed_program" ]] && [[ ! -f "$installed_program" ]]; then
    not_built "$(tilde_path "$installed_program") exists and is not a regular file; remove it and run $BUILD_COMMAND_TEXT again"
    return 0
  fi
  # Decided before cargo runs: without these there is nothing a build could be checked against, or bounded by.
  if missing_tool="$(missing_tool_for_the_build)"; then
    not_built "$missing_tool is not installed, and the build needs it (sha256sum for this checkout's source hash, timeout to bound the build and every question to a program)"
    return 0
  fi
  if ! checkout_hash="$(checkout_source_hash 2>/dev/null)"; then
    not_built "this checkout's source hash cannot be computed (a hashed file under $(tilde_path "$CRATE_DIRECTORY") cannot be read)"
    return 0
  fi
  # Ask before building: a program that is already this checkout's needs no build, and no cargo.
  if installed_program_is_current "$installed_program" "$checkout_hash"; then
    ignore_terminating_signals
    say_ok "unchanged: $(tilde_path "$installed_program")"
    return 0
  fi
  if ! cargo_is_new_enough; then
    not_built "$CARGO_CHECK_PROBLEM"
    return 0
  fi
  cache_root="${XDG_CACHE_HOME:-$HOME_DIRECTORY/.cache}"
  build_directory="$cache_root/$CACHE_SUBDIRECTORY/$CARGO_TARGET_SUBDIRECTORY"
  say_building "building (cargo build --release; a first build takes $FIRST_BUILD_DURATION_TEXT and downloads the crates)"
  build_release_program "$cache_root" "$build_directory"
  build_status=$?
  if build_was_ended_by_its_bound "$build_status"; then
    not_built "cargo build timed out after $BUILD_TIMEOUT_SECONDS s and was ended; its output so far is in $(tilde_path "$cache_root/$CACHE_SUBDIRECTORY/$BUILD_LOG_NAME")"
    return 0
  fi
  if (( build_status != 0 )); then
    not_built "cargo build failed (exit $build_status); its output is in $(tilde_path "$cache_root/$CACHE_SUBDIRECTORY/$BUILD_LOG_NAME")"
    return 0
  fi
  built_program="$build_directory/release/$PROGRAM_NAME"
  if [[ ! -x "$built_program" ]]; then
    not_built "cargo build succeeded but left no program at $(tilde_path "$built_program")"
    return 0
  fi
  built_program_is_this_checkouts "$built_program" "$checkout_hash" "$build_directory" || return 0
  if [[ -f "$installed_program" ]]; then
    cmp -s -- "$built_program" "$installed_program"
    comparison_status=$?
    if (( comparison_status == 0 )); then
      ignore_terminating_signals
      say_ok "unchanged: $(tilde_path "$installed_program")"
      return 0
    fi
    if (( comparison_status != 1 )); then
      not_built "cannot compare the build with $(tilde_path "$installed_program") (cmp exited $comparison_status), so nothing was installed"
      return 0
    fi
  fi
  install_by_rename "$built_program" "$installed_program" || return 0
  say_ok "built and installed: $(tilde_path "$installed_program")"
}

# could_not_tell <why>: the ⚠ line of a --check that cannot answer; the exit status is the caller's.
could_not_tell() { say_warning "could not tell: $*"; }

# refuse_without_background_jobs <mode>: when the background jobs file could not be loaded, ends a mode that runs on it
# with its own line: the build step with a ⚠ line and exit 0 (it never stops a caller's install), --check with its "could not
# tell" line and CHECK_COULD_NOT_TELL, never "current" or "missing". Returns when the file was loaded, and for the modes
# that do not run on it (--list-hashed-files, --installed-path).
refuse_without_background_jobs() {
  local library_path problem
  (( BACKGROUND_JOBS_LOADED == 1 )) && return 0
  library_path="$(tilde_path "$BACKGROUND_JOBS_LIBRARY")"
  problem="the script's own library $library_path is missing or cannot be loaded"
  case "$1" in
    build)
      not_built "$problem"
      exit 0
      ;;
    check)
      could_not_tell "$problem"
      exit "$CHECK_COULD_NOT_TELL"
      ;;
  esac
}

# check_installed: --check. Prints its one line and returns 0, 1 or 2 (CHECK_*).
check_installed() {
  local installed_program checkout_hash installed_hash
  if [[ -z "$HOME_DIRECTORY" ]]; then
    could_not_tell "$HOME_PROBLEM, so the install path is not known"
    return "$CHECK_COULD_NOT_TELL"
  fi
  installed_program="$(installed_program_path)"
  # "Missing" is nothing at the path, not even a link: the build step refuses a link to nothing there as it refuses a
  # directory (build_and_install), so a build would not mend it, and it is "not a regular file" below.
  if [[ ! -e "$installed_program" && ! -L "$installed_program" ]]; then
    # "Missing" sends the user to the build step, which cannot mend a directory this user cannot search.
    if ! path_can_be_looked_at "$installed_program"; then
      could_not_tell "$LOOKUP_PROBLEM, so whether $(tilde_path "$installed_program") is installed is not known"
      return "$CHECK_COULD_NOT_TELL"
    fi
    say_warning "missing: $(tilde_path "$installed_program") is not installed; build and install it (it needs cargo)"
    return "$CHECK_STALE"
  fi
  if [[ ! -f "$installed_program" ]]; then
    could_not_tell "$(tilde_path "$installed_program") is not a regular file; remove it and run $BUILD_COMMAND_TEXT again"
    return "$CHECK_COULD_NOT_TELL"
  fi
  if ! command -v sha256sum >/dev/null 2>&1; then
    could_not_tell "sha256sum is not installed, so the checkout's source hash cannot be computed"
    return "$CHECK_COULD_NOT_TELL"
  fi
  if ! checkout_hash="$(checkout_source_hash 2>&1)"; then
    could_not_tell "the checkout's source hash cannot be computed (a hashed file under $(tilde_path "$CRATE_DIRECTORY") cannot be read): ${checkout_hash//$'\n'/; }"
    return "$CHECK_COULD_NOT_TELL"
  fi
  if ! probe_program "$installed_program"; then
    could_not_tell "$PROBE_PROBLEM"
    return "$CHECK_COULD_NOT_TELL"
  fi
  installed_hash="$PROBE_HASH"
  if [[ "$installed_hash" != "$checkout_hash" ]]; then
    say_warning "is not this checkout's: installed hash $installed_hash, checkout hash $checkout_hash"
    return "$CHECK_STALE"
  fi
  say_ok "installed and current (source hash $installed_hash)"
  return "$CHECK_CURRENT"
}

# require_positive_integer <option> <value>: returns when the value is a positive integer, else says so and exits 2.
require_positive_integer() {
  if [[ ! "$2" =~ $POSITIVE_INTEGER_PATTERN ]]; then
    printf '%s needs a whole number of seconds, at least 1\n' "$1" >&2
    exit "$USAGE_EXIT_STATUS"
  fi
}

# print_installed_path: --installed-path. Prints the path the build step installs at, an absolute one, and a newline;
# with HOME unset, empty or not an absolute path, prints nothing on stdout and one ⚠ line on stderr, and returns
# INSTALLED_PATH_UNKNOWN. Reads HOME and nothing else.
print_installed_path() {
  if [[ -z "$HOME_DIRECTORY" ]]; then
    say_warning "install path is not known: $HOME_PROBLEM"
    return "$INSTALLED_PATH_UNKNOWN"
  fi
  installed_program_path
}

# usage: the usage line, on stderr, and exit 2.
usage() {
  local modes_text='[--check | --list-hashed-files | --installed-path]'
  local options_text='[--build-limits-module PATH] [--program-timeout-seconds N] [--build-timeout-seconds N]'
  printf 'usage: %s %s %s\n' "${SCRIPT_PATH##*/}" "$modes_text" "$options_text" >&2
  exit "$USAGE_EXIT_STATUS"
}

# absolute_path <path>: prints the path as it is when it is absolute, else under the working directory ($PWD/<path>).
absolute_path() {
  if [[ "$1" == /* ]]; then
    printf '%s\n' "$1"
  else
    printf '%s/%s\n' "${PWD%/}" "$1"
  fi
}

# require_path_option <current value> <argument count> <value>: returns when a path option is given for the first time,
# with a value that is not empty; otherwise the usage line, exit 2. A path given twice is a usage error, never the last
# one silently: two values name two files, and which one was read would be a guess.
require_path_option() {
  [[ -z "$1" ]] || usage
  (( $2 >= 2 )) || usage
  [[ -n "$3" ]] || usage
}

# build_command_text: the command that runs this script again, from any directory: bash and this script's absolute path,
# the home directory written as HOME_SHORTHAND. Needs HOME_DIRECTORY settled.
build_command_text() {
  local script_directory_absolute
  # Falls back to the path as given when the directory cannot be entered; the remedy is then only less exact.
  script_directory_absolute="$(cd -P -- "$SCRIPT_DIRECTORY" 2>/dev/null && pwd -P)" || script_directory_absolute="$SCRIPT_DIRECTORY"
  printf 'bash %s' "$(tilde_path "$script_directory_absolute/${SCRIPT_PATH##*/}")"
}

main() {
  settle_home_directory
  BUILD_COMMAND_TEXT="$(build_command_text)"
  # The mode a flag chose: empty until one does, the build step when none does. A second mode is a usage error.
  local mode=""
  while (( $# > 0 )); do
    case "$1" in
      --check | --list-hashed-files | --installed-path)
        [[ -z "$mode" ]] || usage
        mode="${1#--}"
        ;;
      --build-limits-module)
        require_path_option "$BUILD_LIMITS_MODULE" "$#" "${2:-}"
        BUILD_LIMITS_MODULE="$(absolute_path "$2")"
        shift
        ;;
      --program-timeout-seconds)
        (( $# >= 2 )) || usage
        require_positive_integer "$1" "$2"
        PROGRAM_TIMEOUT_SECONDS="$2"
        shift
        ;;
      --build-timeout-seconds)
        (( $# >= 2 )) || usage
        require_positive_integer "$1" "$2"
        BUILD_TIMEOUT_SECONDS="$2"
        shift
        ;;
      *) usage ;;
    esac
    shift
  done
  refuse_without_background_jobs "${mode:-build}"
  case "${mode:-build}" in
    build)
      build_and_install
      exit 0
      ;;
    check)
      check_installed
      exit $?
      ;;
    list-hashed-files)
      list_hashed_files
      exit $?
      ;;
    installed-path)
      print_installed_path
      exit $?
      ;;
  esac
}

main "$@"
