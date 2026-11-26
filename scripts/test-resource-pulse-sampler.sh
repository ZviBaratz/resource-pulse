#!/usr/bin/env bash
#
# scripts/test-resource-pulse-sampler.sh
# =======================================
#
# State table for the compiled Resource Pulse sampler (resource-pulse-sampler/): its cargo tests, and the program's
# flags. It counts each cargo test as a row (the sum of cargo's `test result:` lines; tests/golden.rs holds the program
# to gnome-shell/tests/golden/, the definition of what the sampler computes, edited by hand), then builds the program and checks:
#   - a row that fails if zbus is built with its object server (`service`);
#   - the program's flags and exit statuses, and the journal priority of a usage error's line when JOURNAL_STREAM
#     names its stderr (and no priority when it names another file);
#   - its line for a name it could not own, with no bus to reach, and that no line it writes names this run's paths.
# The sampler's other tables share this one's library, scripts/resource-pulse-sampler-table-lib.sh, and each asserts
# its own total:
#   - scripts/test-resource-pulse-sampler-constants.sh: the constants against the gjs ones, and the app names against
#     the installed GLib;
#   - scripts/test-resource-pulse-sampler-bus.sh: the program on a private bus, under the journal, and asked by
#     the status script;
#   - scripts/test-resource-pulse-sampler-hash.sh: the source hash, what it covers, and a copy of the crate built
#     between edits;
#   - scripts/test-resource-pulse-sampler-build.sh: the build and install step, against a stub cargo;
#   - scripts/test-resource-pulse-sampler-release.sh: the release program, and the stub cargo's shape;
# Nothing here touches the live session bus. Every run of the program, and every cargo test, gets BUS_BARRIER (a session
# bus address nobody listens on, in this run's directory, and a runtime directory of its own), so a program that tried
# to connect there could reach no bus at all. Nothing reads a process's command line.
#
# "Could not run" is exit 2, never a pass: a missing cargo, rg, awk, sed, stat or head, or a build that left no
# program, is fatal; a cargo run that prints no `test result:` line, or a build that fails, is a failed row. The table
# asserts its own row total.
#
# Requires: bash, cargo, rg, awk, sed, stat and head. Needs the network the first time (crates.io). Refuses to run as
# root (exit 2): root ignores the directory permissions some rows deny.
#
# Usage: scripts/test-resource-pulse-sampler.sh
#   CARGO_TARGET_DIR   cargo's build directory. The default is this checkout's own, which
#                      scripts/resource-pulse-cargo-target-dir.sh prints
#                      (${XDG_CACHE_HOME:-$HOME/.cache}/resource-pulse/cargo-target-<id>; its header gives <id> and why
#                      the directory is one per checkout, never one shared). The nested harness builds there too;
#                      the installing build step has a directory of its own (resource-pulse-sampler-build.sh).
#   CARGO_BUILD_JOBS, RUST_TEST_THREADS   worker caps (default: FALLBACK_WORKER_COUNT)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
SAMPLER_TABLE_LIB="$HERE/resource-pulse-sampler-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-sampler-table-lib.sh
source "$SAMPLER_TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$SAMPLER_TABLE_LIB" >&2; exit 2; }
start_sampler_table
require_tools cargo rg awk sed stat head

printf 'cargo test: one row per test\n'
# Behind the barrier: a test that reached for a bus here, outside the #[ignore]d private-bus tests (the bus
# table's), finds none.
CARGO_TEST_OUTPUT="$(off_bus cargo test --locked --manifest-path "$MANIFEST_PATH" 2>&1)"
count_cargo_test_rows "cargo test" "$CARGO_TEST_OUTPUT" "$?"

printf '\nthe program\n'
if cargo build --locked --manifest-path "$MANIFEST_PATH" >"$WORK_DIR/build.log" 2>&1; then
  ok "cargo build --locked builds the program"
else
  tail -15 "$WORK_DIR/build.log"
  bad "cargo build --locked failed"
fi
# zbus's object server answers calls on a task of its own, which would break the rule that one thread sends every
# message; it exists only with zbus's `service` feature, and with that off `#[interface]` and `serve_at` do not even
# compile. The features are read from cargo's own resolution of the graph, not from Cargo.toml's text, and the
# resolution must name `default-rt` (which the crate asks for), so a tree that could not be read is a failure.
ZBUS_FEATURE_TREE="$(off_bus cargo tree --locked --manifest-path "$MANIFEST_PATH" -e features -i zbus 2>&1)"
ZBUS_FEATURE_TREE_EXIT=$?
ZBUS_ENABLED_FEATURES=" $(printf '%s\n' "$ZBUS_FEATURE_TREE" | rg -o 'zbus feature "[^"]+"' | sed 's/^zbus feature "//; s/"$//' \
  | sort -u | tr '\n' ' ')"
zbus_resolution_verdict=unresolved
[[ "$ZBUS_ENABLED_FEATURES" == *" default-rt "* ]] && zbus_resolution_verdict=resolved
zbus_service_verdict=no-service
[[ "$ZBUS_ENABLED_FEATURES" == *" service "* ]] && zbus_service_verdict=service
check "zbus is built without its object server: cargo tree resolves its features, and \"service\" is not one" \
  "$ZBUS_FEATURE_TREE_EXIT/$zbus_resolution_verdict/$zbus_service_verdict" "0/resolved/no-service"
[[ -x "$PROGRAM_PATH" ]] || fatal "no program at $PROGRAM_PATH"
off_bus "$PROGRAM_PATH" --print-constants >/dev/null
check "--print-constants exits 0" "$?" 0
off_bus "$PROGRAM_PATH" --tick-interval-ms >/dev/null 2>"$WORK_DIR/usage.err"
check "--tick-interval-ms without a number: exit 2" "$?" 2
check "--tick-interval-ms without a number: one line on stderr, and it is the usage" \
  "$(wc -l <"$WORK_DIR/usage.err" | tr -d ' '):$(rg -c '^usage: resource-pulse-sampler ' "$WORK_DIR/usage.err")" "1:1"
tick_interval_refusals=""
for refused_interval in 0 twenty -5 18446744073709551616; do
  off_bus "$PROGRAM_PATH" --tick-interval-ms "$refused_interval" >/dev/null 2>&1
  tick_interval_refusals+="$refused_interval=$? "
done
check "--tick-interval-ms refuses zero, a word, a negative and an overflow: exit 2 each" \
  "$tick_interval_refusals" "0=2 twenty=2 -5=2 18446744073709551616=2 "
off_bus "$PROGRAM_PATH" --nonsense >/dev/null 2>&1
check "an unknown argument: exit 2" "$?" 2
# The journal's priority, end to end: with JOURNAL_STREAM naming the device and inode of the file the program's stderr
# is (as systemd sets it when stderr is the journal), a usage error's line is an error, `<3>` right before its text;
# with it naming another inode (a variable a child inherited with its stderr sent elsewhere) the line is bare.
# Reopening the file with `2>` truncates it and keeps its inode.
JOURNAL_STDERR_FILE="$WORK_DIR/journal-stream.err"
: >"$JOURNAL_STDERR_FILE" || fatal "cannot create $JOURNAL_STDERR_FILE"
JOURNAL_STDERR_DEVICE_AND_INODE="$(stat -c '%d:%i' "$JOURNAL_STDERR_FILE")" || fatal "cannot stat $JOURNAL_STDERR_FILE"
JOURNAL_STDERR_DEVICE="${JOURNAL_STDERR_DEVICE_AND_INODE%%:*}"
JOURNAL_STDERR_INODE="${JOURNAL_STDERR_DEVICE_AND_INODE##*:}"
off_bus "JOURNAL_STREAM=$JOURNAL_STDERR_DEVICE_AND_INODE" "$PROGRAM_PATH" --nonsense >/dev/null 2>"$JOURNAL_STDERR_FILE"
check "with JOURNAL_STREAM naming its stderr's device and inode, a usage error's line is an error: exit 2, one line, <3> before the usage" \
  "$?:$(wc -l <"$JOURNAL_STDERR_FILE" | tr -d ' '):$(rg -c '^<3>usage: resource-pulse-sampler ' "$JOURNAL_STDERR_FILE")" "2:1:1"
OTHER_JOURNAL_STREAM="$JOURNAL_STDERR_DEVICE:$((JOURNAL_STDERR_INODE + 1))"
off_bus "JOURNAL_STREAM=$OTHER_JOURNAL_STREAM" "$PROGRAM_PATH" --nonsense >/dev/null 2>"$JOURNAL_STDERR_FILE"
check "with JOURNAL_STREAM naming another inode (inherited, stderr sent elsewhere), the usage line has no prefix: exit 2, one line, the usage" \
  "$?:$(wc -l <"$JOURNAL_STDERR_FILE" | tr -d ' '):$(rg -c '^usage: resource-pulse-sampler ' "$JOURNAL_STDERR_FILE")" "2:1:1"
# The program's line for a name it could not own (src/program/ending.rs, ending_of_name_not_owned), exactly, as the earlier gjs
# service printed it, word for word.
CANNOT_OWN_LINE="resource-pulse: shutting down: cannot own io.github.zvibaratz.ResourcePulse1: another copy holds it, or there is no session bus"
off_bus "$PROGRAM_PATH" --fs-root "$PROGRAM_FIXTURE_ROOT" >/dev/null 2>"$WORK_DIR/no-bus.err"
check "no flag but a fixture root, and no bus to reach: exit 1, the cannot-own line exactly, then one naming the failure's kind" \
  "$?:$(wc -l <"$WORK_DIR/no-bus.err" | tr -d ' '):$(head -1 "$WORK_DIR/no-bus.err")" "1:2:$CANNOT_OWN_LINE"
# The address and the runtime directory are this run's own paths, so neither may appear in what the program writes:
# once at the barrier's address (a socket nobody listens on), once with no address, where zbus falls back to the
# runtime directory's bus.
env -u DBUS_SESSION_BUS_ADDRESS GSETTINGS_BACKEND=memory "XDG_RUNTIME_DIR=$BARRIER_RUNTIME_DIR" \
  "$PROGRAM_PATH" --fs-root "$PROGRAM_FIXTURE_ROOT" >/dev/null 2>"$WORK_DIR/no-address.err"
check "no bus to reach, at an address or in the runtime directory: no line on stderr holds either path" \
  "$(rg -c -F -e "$BARRIER_BUS_ADDRESS" -e "$WORK_DIR" "$WORK_DIR/no-bus.err" "$WORK_DIR/no-address.err" | wc -l | tr -d ' '):$(cat "$WORK_DIR/no-bus.err" "$WORK_DIR/no-address.err" | rg -c -F "$CANNOT_OWN_LINE")" "0:2"

# 429 cargo tests (2 of the constants, 24 of the parsers, 36 of the arithmetic, 4 of JavaScript's string order, 1 of the
# insertion-ordered map, 67 of app naming and ranking, 37 of the scan cadence, 33 of app names from `.desktop` files, 11
# of the real reader and lister, 5 of the real clocks, 2 of the rate-limited log, 7 of the panic hook and the catch (3
# of them a panic nothing caught, in a child process: under the journal, its backtrace there, and outside it), 61 of the
# sampler (2 of them its pressure history's ticks, 4 its gaps for missed ticks), 2 of the pressure history's ring
# buffers, 10 of the missed-tick counter, 15 of the payload writer (2 of them its text against an older sampler's), 12
# of the service face, 4 of the tick schedule, 3 of the watchdog, 11 of the call routing, 8 of the bus link without a
# bus (its receiving thread, the kind of its failures, the stream's three ends and an end given again), 35 of the
# program's tick loop (3 of them its missed ticks), calls, flags, endings, bus outlet and the priority of its lines, 4
# of the journal's line priority (log_line.rs), 2 of the program run whole with --print, 33 of the golden test)
# + 9 cargo tests of the source hash and the flags' one answer per run (8 of the hand-written SHA-256 against known
#   answers and of which files are hashed; 1 of the print-and-exit precedence)
# + 1 build + 1 zbus feature row + 7 program flag rows + 2 rows of a line's journal priority under JOURNAL_STREAM
# = 449: 438 cargo tests (429 + 9) + 11. Of the six rows a mutation sweep added, five are cargo tests here
# (the listing's UTF-16 order, the probe cap, the name cache's bound, a refused reply's log line, a call with arguments
# and no interface); the sixth, the reply methods' "no reply expected", is a bus_link test of
# scripts/test-resource-pulse-sampler-bus.sh.
EXPECTED_ROWS=449

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
