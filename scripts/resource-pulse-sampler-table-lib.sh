#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2034  # Its constants are read by the tables that source it, never here.
#
# scripts/resource-pulse-sampler-table-lib.sh
# ===========================================
#
# The shared helpers and constants of the compiled Resource Pulse sampler's state tables
# (scripts/test-resource-pulse-sampler*.sh): the row helpers; the run's directory, WORK_DIR,
# and the exit trap that removes it; the barrier between a program and the live session
# bus (BUS_BARRIER, off_bus); the worker caps and the checkout's cargo build
# directory; one row per cargo test (count_cargo_test_rows); the program's paths and its source hash; and the build
# rows' helpers (a home, a PATH, a cache and a crate of its own for each row, a stub cargo and its payloads, a run of
# the build script and what it said), with the waits the signal rows share.
#
# Sourced, never run. It owns no row, no total and no trap: each table asserts its own literal total. Sourcing it
# defines names and runs pure checks (not root; the crate, the fixture root and the build directory's helper are
# there; the build directory worked out), and creates nothing. Each table then calls start_sampler_table, once, right
# after sourcing it: it makes WORK_DIR, installs the table's one exit trap (install_sampler_table_exit_trap) before
# anything else is created, then builds the barrier. Until then BUS_BARRIER is a closed placeholder, so a table that
# never called start_sampler_table still never reaches the live session bus. A table whose rows run the debug program
# then calls build_sampler_program, which builds it and reads its source hash. The names those two functions assign
# (WORK_DIR, the barrier's paths, PROGRAM_SOURCE_HASH) have no value before the call, so a table that never made it
# stops at their first use under `set -u`: none of them is a toggle a row could read as "empty" or "none". A helper
# only one table's rows use is that table's own (the bus table's private bus, the build table's script_verdict and
# installed_state). A table sets HERE (its own directory) and REPO_ROOT (its checkout's root) before it sources this
# file; without them this file stops the table with exit 2.
#
# The sampler's tables use this library's conventions (WORK_DIR, its trap, off_bus), not
# the gjs side's (scripts/resource-pulse-table-lib.sh): the two libraries are separate on purpose.
#
# Usage, in a table:
#   HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
#   REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
#   SAMPLER_TABLE_LIB="$HERE/resource-pulse-sampler-table-lib.sh"
#   # shellcheck source=SCRIPTDIR/resource-pulse-sampler-table-lib.sh
#   source "$SAMPLER_TABLE_LIB" || { printf 'FATAL: cannot source %s\n' "$SAMPLER_TABLE_LIB" >&2; exit 2; }
#   start_sampler_table
#   require_tools cargo …
#   build_sampler_program   # a table whose rows run the debug program

PASS=0; FAIL=0
ok()    { printf '  \033[0;32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()   { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 — expected '$3', got '$2'"; fi; }
fatal() { printf '\033[1;31mFATAL\033[0m: %s\n' "$*" >&2; exit 2; }

[[ -n "${REPO_ROOT:-}" && -d "$REPO_ROOT" ]] \
  || fatal "REPO_ROOT must name the checkout's root before scripts/resource-pulse-sampler-table-lib.sh is sourced"
[[ -n "${HERE:-}" && -d "$HERE" ]] \
  || fatal "HERE must name the table's own directory before scripts/resource-pulse-sampler-table-lib.sh is sourced"

# Root ignores directory permissions, so the rows that deny one (an install directory that cannot be written, a tree that
# cannot be listed) could not fail; a row that cannot fail is not a pass. Refused before any row.
(( EUID != 0 )) || fatal "run this as a normal user, not as root: root ignores directory permissions, which some rows deny"

# require_tools <tool>…: "could not run" (exit 2) unless every tool named is on PATH. Each table names the tools its
# own rows need, and no others.
require_tools() {
  local required_tool
  for required_tool in "$@"; do
    command -v "$required_tool" >/dev/null || fatal "$required_tool is required"
  done
}

CRATE_DIR="$REPO_ROOT/resource-pulse-sampler"
MANIFEST_PATH="$CRATE_DIR/Cargo.toml"
CARGO_TARGET_DIR_HELPER="$HERE/resource-pulse-cargo-target-dir.sh"
# The fixture root a program run reads in place of the host's /proc and /sys: the sampler initializes before it
# reaches for the bus, so even a run that cannot reach one reads its root first.
PROGRAM_FIXTURE_ROOT="$REPO_ROOT/gnome-shell/tests/fixtures/root-a"
# The bus rows take about 60 s; the cap ends a hang. The bus table's on_private_bus applies it, and the release table
# bounds its --print run by it too.
PRIVATE_BUS_TIMEOUT_SECONDS=300
[[ -r "$MANIFEST_PATH" ]] || fatal "cannot read $MANIFEST_PATH"
[[ -r "$CARGO_TARGET_DIR_HELPER" ]] || fatal "cannot read $CARGO_TARGET_DIR_HELPER"
[[ -d "$PROGRAM_FIXTURE_ROOT" ]] || fatal "no fixture root at $PROGRAM_FIXTURE_ROOT"

# Workers for cargo's build and its tests when the caller's environment sets neither. A
# caller that wants a different cap exports both variables; this is the fallback.
FALLBACK_WORKER_COUNT=4
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-$FALLBACK_WORKER_COUNT}"
export RUST_TEST_THREADS="${RUST_TEST_THREADS:-$FALLBACK_WORKER_COUNT}"
# The default build directory is this checkout's own, as scripts/resource-pulse-cargo-target-dir.sh works it out (the
# nested harness builds there too; the header says why one per checkout). A caller's CARGO_TARGET_DIR wins.
if [[ -z "${CARGO_TARGET_DIR:-}" ]]; then
  CARGO_TARGET_DIR="$(bash "$CARGO_TARGET_DIR_HELPER")" || fatal "cannot work out this checkout's cargo build directory"
fi
export CARGO_TARGET_DIR

# The debug program the tables run: build_sampler_program builds it (the cargo and program table builds it in a row of
# its own).
PROGRAM_PATH="$CARGO_TARGET_DIR/debug/resource-pulse-sampler"
# What --source-hash prints: a SHA-256, 64 lowercase hex digits.
SOURCE_HASH_PATTERN='^[0-9a-f]{64}$'
# The build and install script the build rows run (RESOURCE_PULSE_BUILD_SCRIPT points them at a copy, for a mutation
# sweep, with the resource-pulse-background-jobs.sh it sources beside it), and the bash they run it with. A table whose
# rows run the script checks that it can read it.
BUILD_SCRIPT="${RESOURCE_PULSE_BUILD_SCRIPT:-$HERE/resource-pulse-sampler-build.sh}"
BASH_PATH="$(command -v bash)"

# Until start_sampler_table builds the barrier, BUS_BARRIER is already closed: a bus socket and a runtime directory
# under /dev/null, which is not a directory, so neither can ever exist. An unset array would expand to nothing under
# `set -u`, and a program would then run with no barrier at all.
SAMPLER_TABLE_NOT_STARTED_PATH='/dev/null/resource-pulse-sampler-table-not-started'
BUS_BARRIER=(GSETTINGS_BACKEND=memory "DBUS_SESSION_BUS_ADDRESS=unix:path=$SAMPLER_TABLE_NOT_STARTED_PATH"
  "XDG_RUNTIME_DIR=$SAMPLER_TABLE_NOT_STARTED_PATH")
# off_bus <command...> runs a command behind BUS_BARRIER.
off_bus() { env "${BUS_BARRIER[@]}" "$@"; }

# install_sampler_table_exit_trap: on every exit, the run's directory is removed. The table's only trap:
# start_sampler_table installs it.
install_sampler_table_exit_trap() {
  trap 'rm -rf "$WORK_DIR"' EXIT
}
# Whether start_sampler_table has run: a second call would make a second WORK_DIR and orphan the first, which the trap
# would then never remove. Its own switch, not WORK_DIR's emptiness: a WORK_DIR in the caller's environment is
# overwritten, as it always was, never mistaken for a call.
SAMPLER_TABLE_STARTED=no
# start_sampler_table: what a table runs once, right after sourcing this file. In order, it
#   1. makes WORK_DIR, where every fixture of the run lives;
#   2. installs the exit trap, before anything else is created, so every later "could not run" still removes WORK_DIR;
#   3. builds the barrier: its runtime directory, its dead bus address, and BUS_BARRIER.
# A second call stops the table with exit 2.
start_sampler_table() {
  [[ "$SAMPLER_TABLE_STARTED" == no ]] || fatal "start_sampler_table runs once per table"
  WORK_DIR="$(mktemp -d)" || fatal "mktemp -d failed"
  install_sampler_table_exit_trap
  SAMPLER_TABLE_STARTED=yes
  # BUS_BARRIER: the environment of every program run outside the private bus. Its session bus address is a socket
  # nobody listens on, and its runtime directory is this run's own, so neither the address nor the fallback under
  # XDG_RUNTIME_DIR can lead to the live session bus.
  BARRIER_RUNTIME_DIR="$WORK_DIR/barrier-runtime"
  BARRIER_BUS_ADDRESS="unix:path=$WORK_DIR/barrier-no-session-bus"
  if ! mkdir -p "$BARRIER_RUNTIME_DIR" || ! chmod 700 "$BARRIER_RUNTIME_DIR"; then
    fatal "cannot create the barrier's runtime directory $BARRIER_RUNTIME_DIR"
  fi
  BUS_BARRIER=(GSETTINGS_BACKEND=memory "DBUS_SESSION_BUS_ADDRESS=$BARRIER_BUS_ADDRESS" "XDG_RUNTIME_DIR=$BARRIER_RUNTIME_DIR")
}

# build_sampler_program: what a table whose rows run the debug program calls once, after start_sampler_table and its
# require_tools. It builds the program into CARGO_TARGET_DIR (cargo build --locked, behind the barrier; where another
# table already built it, cargo finds it fresh), so that PROGRAM_PATH is this checkout's, then sets PROGRAM_SOURCE_HASH
# and PAYLOAD_ANSWERS_THIS_CHECKOUT. A build that fails, or leaves no program, is "could not run" (exit 2): the build
# itself is a row of the cargo and program table, scripts/test-resource-pulse-sampler.sh. So is a --source-hash
# answer that is not a SHA-256 (SOURCE_HASH_PATTERN): a row that compares another answer with it would pass, empty
# against empty, on a program that answers nothing, and only the hash table holds the flag's answer to that shape.
build_sampler_program() {
  [[ "$SAMPLER_TABLE_STARTED" == yes ]] || fatal "build_sampler_program runs after start_sampler_table"
  if ! off_bus cargo build --locked --manifest-path "$MANIFEST_PATH" >"$WORK_DIR/build.log" 2>&1; then
    tail -15 "$WORK_DIR/build.log"
    fatal "cargo build --locked failed: this table's rows have no program to run"
  fi
  [[ -x "$PROGRAM_PATH" ]] || fatal "no program at $PROGRAM_PATH"
  # The program's own hash, from the debug build above: the one this checkout's sources give.
  PROGRAM_SOURCE_HASH="$(env -i "${BUS_BARRIER[@]}" "$PROGRAM_PATH" --source-hash 2>/dev/null)"
  if [[ ! "$PROGRAM_SOURCE_HASH" =~ $SOURCE_HASH_PATTERN ]]; then
    fatal "the debug program's --source-hash is not a SHA-256 ('$PROGRAM_SOURCE_HASH'): no hash for this table's rows"
  fi
  # The text a payload runs for --source-hash when the row gives none: this checkout's hash, which a build of the row's
  # crate (a copy of the checkout's hashed files) carries.
  PAYLOAD_ANSWERS_THIS_CHECKOUT="echo $PROGRAM_SOURCE_HASH"
}

# count_cargo_test_rows <label> <output> <exit status>: one row per test a cargo test run passed and one failed row
# per test it failed (the sums of its `test result: ... N passed; M failed;` lines: unit, integration and doc test
# binaries each print one), a failed row when it printed no such line (it did not run, which is a failure and not
# zero rows), and one when it exited non-zero with no failed test counted.
count_cargo_test_rows() {
  local test_label="$1" test_output="$2" test_exit="$3" passed_count failed_count result_line_count row
  read -r passed_count failed_count result_line_count < <(
    printf '%s\n' "$test_output" | awk '
      /^test result: / {
        lines++
        for (i = 1; i <= NF; i++) {
          if ($i == "passed;") passed += $(i - 1)
          if ($i == "failed;") failed += $(i - 1)
        }
      }
      END { printf "%d %d %d\n", passed, failed, lines }')
  if (( result_line_count == 0 )); then
    printf '%s\n' "$test_output" | tail -15
    bad "$test_label printed no \`test result:\` line (exit $test_exit): it did not run, which is a failure and not zero rows"
    return
  fi
  for ((row = 0; row < passed_count; row++)); do ok "$test_label $((row + 1)) of $passed_count passed"; done
  for ((row = 0; row < failed_count; row++)); do bad "$test_label failed ($((row + 1)) of $failed_count)"; done
  if (( test_exit != 0 && failed_count == 0 )); then
    printf '%s\n' "$test_output" | tail -15
    bad "$test_label exited $test_exit with no failed test counted"
  fi
  # Each failing test's name, and each panic with the three lines after it (an assert_eq! message takes three).
  (( failed_count == 0 )) || printf '%s\n' "$test_output" | rg --no-context-separator -A 3 "^(test .* FAILED|thread '[^']*'.* panicked at )"
}

# The build rows: each runs the build script (BUILD_SCRIPT) against a stub cargo, with a home, a PATH, a cache
# directory and a crate of its own (new_build_row). The build table's rows and the hash table's --check rows are build rows.
# The tools the script may use, linked into every row's PATH; cargo is never among them (a row installs its stub), and a row
# for a missing tool deletes the link.
ROW_TOOLS=(cat chmod cmp cp find mkdir mktemp mv rm sha256sum sleep sort timeout tr wc zsh)
INSTALLED_PROGRAM_RELATIVE=.local/lib/resource-pulse/resource-pulse-sampler
# What cargo --version prints, as a template the stub fills in: the real one's shape, which a row checks.
STUB_CARGO_VERSION_LINE_TEMPLATE='cargo %s (0123abcde 2026-01-01)'
STABLE_CARGO_VERSION=1.90.0
STUB_NPROC_CORES=8

# new_build_row <name> builds the row's directories and sets ROW_DIR, ROW_HOME, ROW_BIN, ROW_CACHE, ROW_CRATE (a copy of
# the files the source hash covers, so its hash is this checkout's, PROGRAM_SOURCE_HASH; the script reads rust-version in
# its Cargo.toml) and ROW_RECORD (what the stub cargo was asked).
new_build_row() {
  local tool
  ROW_DIR="$WORK_DIR/build-rows/$1"
  ROW_HOME="$ROW_DIR/home"; ROW_BIN="$ROW_DIR/bin"; ROW_CACHE="$ROW_DIR/cache"; ROW_CRATE="$ROW_DIR/crate"
  ROW_RECORD="$ROW_DIR/cargo-record"
  rm -rf "$ROW_DIR"
  mkdir -p "$ROW_HOME" "$ROW_BIN" "$ROW_CACHE" "$ROW_CRATE" || fatal "cannot create the row directory $ROW_DIR"
  cp -r "$CRATE_DIR/Cargo.toml" "$CRATE_DIR/Cargo.lock" "$CRATE_DIR/build.rs" "$CRATE_DIR/source_hash.rs" "$CRATE_DIR/src" "$ROW_CRATE/" \
    || fatal "cannot copy the hashed files of the crate into $ROW_CRATE"
  for tool in "${ROW_TOOLS[@]}"; do
    ln -s "$(type -P "$tool")" "$ROW_BIN/$tool" || fatal "cannot link $tool"
  done
  printf '#!%s\necho %s\n' "$BASH_PATH" "$STUB_NPROC_CORES" >"$ROW_BIN/nproc"
  chmod +x "$ROW_BIN/nproc"
  ROW_ENV=(); ROW_RUN_BOUND=()
}
# cargo_version_line_for <version> prints the line the stub says for 'cargo --version'.
cargo_version_line_for() {
  # shellcheck disable=SC2059 # the template is this library's own
  printf "$STUB_CARGO_VERSION_LINE_TEMPLATE" "$1"
}
# count_lines_matching <rg arguments...>: how many lines match, 0 for none (rg -c prints nothing for none).
count_lines_matching() { local matched; matched="$(rg -c "$@" 2>/dev/null)"; printf '%s' "${matched:-0}"; }
# install_stub_cargo <version> writes the row's cargo: --version says the version; a build is recorded (its arguments, the
# job cap and the target directory it was given) and either copies STUB_CARGO_PAYLOAD into the target directory's release
# directory, as a real build leaves its program, or (STUB_CARGO_MODE=fail) says it failed and exits 101. With
# STUB_CARGO_MODE=hang it writes its pid and its sleep's into STUB_CARGO_PIDS and sleeps, ending on a TERM; with
# STUB_CARGO_MODE=ignore-term it writes its pid and becomes a sleep that ignores TERM, so only a KILL ends it.
install_stub_cargo() {
  local version_line
  version_line="$(cargo_version_line_for "$1")"
  {
    printf '#!%s\n' "$BASH_PATH"
    # shellcheck disable=SC2016 # the stub's own $1 must stay literal
    printf 'if [[ "$1" == --version ]]; then echo %q; exit 0; fi\n' "$version_line"
    # shellcheck disable=SC2016 # the stub's own variables must stay literal
    printf 'printf "args=%%s\\njobs=%%s\\ntarget=%%s\\n" "$*" "${CARGO_BUILD_JOBS-<unset>}" "${CARGO_TARGET_DIR-<unset>}" >>"$STUB_CARGO_RECORD"\n'
    # shellcheck disable=SC2016
    printf 'if [[ "${STUB_CARGO_MODE:-ok}" == fail ]]; then echo "error: the stub build failed" >&2; exit 101; fi\n'
    # shellcheck disable=SC2016
    printf 'if [[ "${STUB_CARGO_MODE:-ok}" == hang ]]; then echo $$ >>"$STUB_CARGO_PIDS"; sleep 300 & echo $! >>"$STUB_CARGO_PIDS"; wait; fi\n'
    # shellcheck disable=SC2016
    printf 'if [[ "${STUB_CARGO_MODE:-ok}" == ignore-term ]]; then trap "" TERM; echo $$ >>"$STUB_CARGO_PIDS"; exec sleep 300; fi\n'
    # shellcheck disable=SC2016
    printf 'mkdir -p "$CARGO_TARGET_DIR/release" && cp "$STUB_CARGO_PAYLOAD" "$CARGO_TARGET_DIR/release/resource-pulse-sampler" && chmod +x "$CARGO_TARGET_DIR/release/resource-pulse-sampler"\n'
  } >"$ROW_BIN/cargo"
  chmod +x "$ROW_BIN/cargo"
}
# make_payload <path> <letter> <bytes> [<shell text>] writes the "program" the stub cargo builds, exactly that many bytes: a
# script that, run from a release directory as the program a build left, runs the text for --source-hash (default
# PAYLOAD_ANSWERS_THIS_CHECKOUT) and exits, and run from anywhere else (once installed) does not know the flag, as a
# program from before the source hash. So every run of the step builds over an installed payload, and the build is
# checked as this checkout's. The rest of the size is the letter, which the script never reaches.
make_payload() {
  local payload_path="$1" padding_letter="$2" payload_bytes="$3" answer_text="${4:-$PAYLOAD_ANSWERS_THIS_CHECKOUT}" script_text
  # shellcheck disable=SC2016 # the payload's own $0 and $1 must stay literal
  printf -v script_text '#!%s\nif [[ "$0" == */release/resource-pulse-sampler && "$1" == --source-hash ]]; then %s; exit 0; fi\nexit 2\n' \
    "$BASH_PATH" "$answer_text"
  (( payload_bytes > ${#script_text} )) || fatal "a payload of $payload_bytes bytes cannot hold its script"
  { printf '%s' "$script_text"; head -c "$(( payload_bytes - ${#script_text} ))" /dev/zero | tr '\0' "$padding_letter"; } >"$payload_path" \
    || fatal "cannot write the payload $payload_path"
}
# The bound on a run that must answer at once: a run that blocks instead ends as `timeout`'s 124 and fails its row, where
# unbounded it would hang the table.
INSTANT_RUN_BOUND_SECONDS=10
INSTANT_RUN_KILL_AFTER_SECONDS=2
INSTANT_RUN_BOUND=(timeout --kill-after="$INSTANT_RUN_KILL_AFTER_SECONDS" "$INSTANT_RUN_BOUND_SECONDS")
# run_build_script [argument...] runs the script in the row's own environment (plus ROW_ENV) and behind BUS_BARRIER, which
# it hands on to the programs it asks for --source-hash (the --check rows give it the real one), under ROW_RUN_BOUND when
# a row sets one (INSTANT_RUN_BOUND), with its arguments, and sets SCRIPT_EXIT, SCRIPT_STDOUT, SCRIPT_STDERR and
# SCRIPT_OUTPUT (both streams, in that order).
run_build_script() {
  SCRIPT_STDOUT="$("${ROW_RUN_BOUND[@]}" env -i HOME="$ROW_HOME" PATH="$ROW_BIN" XDG_CACHE_HOME="$ROW_CACHE" "${BUS_BARRIER[@]}" \
    RESOURCE_PULSE_SAMPLER_CRATE_DIR="$ROW_CRATE" STUB_CARGO_RECORD="$ROW_RECORD" "${ROW_ENV[@]}" \
    "$BASH_PATH" "$BUILD_SCRIPT" "$@" 2>"$ROW_DIR/script.err")"
  SCRIPT_EXIT=$?
  SCRIPT_STDERR="$(<"$ROW_DIR/script.err")"
  SCRIPT_OUTPUT="$SCRIPT_STDOUT"$'\n'"$SCRIPT_STDERR"
}
# A source hash that is not this checkout's: what an installed program built from other sources answers.
OTHER_HASH="$(printf '%064d' 7)"

# The waits of a row that signals a script it started in a session of its own, with SIGINT and SIGQUIT at their
# defaults: the build table's signal rows.
SETSID_PATH="$(type -P setsid)"; ENV_PATH="$(type -P env)"
# The most a row waits for the build or the question to start, and for the script to end once signalled.
SIGNAL_ROW_START_WAIT_SECONDS=10
SIGNAL_ROW_END_WAIT_SECONDS=10
SIGNAL_ROW_POLL_INTERVAL_SECONDS=0.1
SIGNAL_ROW_POLLS_PER_SECOND=10
# The signals a terminal sends its foreground group, at their defaults in a signalled script (env --default-signal).
TERMINAL_SIGNALS_AT_DEFAULT=INT,QUIT
# wait_for_line_count <file> <count>: prints "started" once the file holds that many lines, within
# SIGNAL_ROW_START_WAIT_SECONDS, and "not-started" when it never did.
wait_for_line_count() {
  local poll_round
  for (( poll_round = 0; poll_round < SIGNAL_ROW_START_WAIT_SECONDS * SIGNAL_ROW_POLLS_PER_SECOND; poll_round++ )); do
    if [[ -r "$1" ]] && (( $(wc -l <"$1") >= $2 )); then printf 'started'; return; fi
    sleep "$SIGNAL_ROW_POLL_INTERVAL_SECONDS"
  done
  printf 'not-started'
}
# wait_for_signalled_script: sets SIGNALLED_SCRIPT_STATUS to the script's exit status once it ended, within
# SIGNAL_ROW_END_WAIT_SECONDS, or to "still-running" when it had not; its group is then killed, so no row leaves it behind.
wait_for_signalled_script() {
  local poll_round
  for (( poll_round = 0; poll_round < SIGNAL_ROW_END_WAIT_SECONDS * SIGNAL_ROW_POLLS_PER_SECOND; poll_round++ )); do
    if ! kill -0 "$SIGNALLED_SCRIPT_PID" 2>/dev/null; then
      wait "$SIGNALLED_SCRIPT_PID"; SIGNALLED_SCRIPT_STATUS=$?
      return
    fi
    sleep "$SIGNAL_ROW_POLL_INTERVAL_SECONDS"
  done
  kill -KILL -- "-$SIGNALLED_SCRIPT_PID" 2>/dev/null; wait "$SIGNALLED_SCRIPT_PID"
  SIGNALLED_SCRIPT_STATUS=still-running
}
