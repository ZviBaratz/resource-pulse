#!/usr/bin/env bash
#
# scripts/test-resource-pulse-sampler-bus.sh
# ===========================================
#
# State table for the compiled Resource Pulse sampler (resource-pulse-sampler/) on a message bus. The real debug
# program, over a fixture root, served on a PRIVATE bus of this run (gnome-shell/tests/run-sampler-program.js under
# `dbus-run-session`), holding the reply order, the start-up order, the name flags, the answer to every call (what
# GDBus answers on every object included) and a disconnecting caller's watches, a tree of garbage files, the compact
# text of the state, and the conformance of the gjs client rows' test double (gnome-shell/tests/serviceDouble.js),
# which, fed the program's own Samples, must give a client what the program gave, and the rule of the comparison that
# row rests on (a value that differs where every key matches is named); and rows proving that runner refuses any other
# bus or a missing program. Then:
#   - the bus link's rules, deterministically: the #[ignore]d tests of resource-pulse-sampler/tests/bus_link.rs, each
#     run with --ignored in a process and on a private bus of its own (one row per test, as cargo's others), and a row
#     proving they refuse off it;
#   - under JOURNAL_STREAM naming its stderr file, its "serving" line and its clean ending's line with no priority
#     prefix and exit 0 when the session ends, beside a warning that carries one, and the session's child refusing any
#     bus but its private one;
#   - the status script (scripts/resource-pulse-status.sh, the status report) reading the
#     program's GetState through the real gdbus, on the private bus, with a stub systemctl.
# Its row helpers, the barrier and the build of the debug program are scripts/resource-pulse-sampler-table-lib.sh's;
# the private bus (start_private_bus, on_private_bus) is its own, since only its rows use it. Nothing here touches the
# live session bus: every bus is this run's own, under `dbus-run-session`, and checked by the code that runs on it;
# every run outside one is behind BUS_BARRIER. Nothing reads a process's command line.
#
# "Could not run" is exit 2, never a pass: a missing cargo, gjs, dbus-run-session, gdbus, setsid, timeout, rg, awk, sed
# or stat, a runner, fixture or session child that cannot be read, a bus runner that prints no tally, or a program
# that could not be built, is fatal; a cargo run that prints no `test result:` line is a failed row. The table asserts
# its own row total.
#
# Requires: bash, cargo, gjs, dbus-run-session (Ubuntu: dbus-daemon), gdbus (libglib2.0-bin), setsid and timeout
# (util-linux, coreutils), rg, awk, sed and stat. Needs the network the first time (crates.io). Refuses to run as
# root (exit 2).
#
# Usage: scripts/test-resource-pulse-sampler-bus.sh
#   CARGO_TARGET_DIR, CARGO_BUILD_JOBS, RUST_TEST_THREADS   as for scripts/test-resource-pulse-sampler.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
SAMPLER_TABLE_LIB="$HERE/resource-pulse-sampler-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-sampler-table-lib.sh
source "$SAMPLER_TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$SAMPLER_TABLE_LIB" >&2; exit 2; }
start_sampler_table
require_tools cargo gjs dbus-run-session gdbus setsid timeout rg awk sed stat

PRIVATE_BUS_RUNNER="$REPO_ROOT/gnome-shell/tests/run-sampler-program.js"
# The data directories and language of the copies of the program that this table's session children start (under the
# journal, and for the status script): they read `.desktop` files from here and never from the host's. The
# private-bus runner gives the copies it starts the same values itself (samplerProgramLauncher.js's
# PROGRAM_DATA_ENVIRONMENT), and a third copy is resource-pulse-sampler/tests/common/mod.rs's pin_data_directories.
# Nothing checks one against another: change all three together.
BUS_DESKTOP_FIXTURES="$CRATE_DIR/tests/fixtures/bus-desktop"
BUS_ROWS_FIXED_LANGUAGE=C.UTF-8
BUS_ROWS_DATA_ENVIRONMENT=(
  "XDG_DATA_HOME=$BUS_DESKTOP_FIXTURES/home" "XDG_DATA_DIRS=$BUS_DESKTOP_FIXTURES/system"
  "HOME=$BUS_DESKTOP_FIXTURES/home-dir" LANGUAGE=en "LC_ALL=$BUS_ROWS_FIXED_LANGUAGE"
  "LC_MESSAGES=$BUS_ROWS_FIXED_LANGUAGE" "LANG=$BUS_ROWS_FIXED_LANGUAGE"
)
# The exit code libtest gives when a test failed (a cargo test run with a failing test exits 101).
LIBTEST_FAILED_EXIT_CODE=101
TALLY_PATTERN='^JS-TALLY pass=([0-9]+) fail=([0-9]+)$'
[[ -r "$PRIVATE_BUS_RUNNER" ]] || fatal "cannot read $PRIVATE_BUS_RUNNER"
# KILL follows the private bus's time-out (PRIVATE_BUS_TIMEOUT_SECONDS) by this long, for whatever outlives it.
PRIVATE_BUS_KILL_AFTER_SECONDS=10
# The private bus is this run's own: a path socket in a 0700 directory, and no service directory, so nothing
# on it can be activated. The bus table's runner (gnome-shell/tests/run-sampler-program.js) refuses to start
# unless DBUS_SESSION_BUS_ADDRESS is that socket, and it all runs behind BUS_BARRIER, so even a program that
# ignored the address would find no live bus to fall back to.
# start_private_bus makes the private bus's directory and its configuration (PRIVATE_BUS_DIR, PRIVATE_BUS_CONFIG) in
# WORK_DIR: what on_private_bus runs a command on. The bus table calls it once, after start_sampler_table.
start_private_bus() {
  [[ "$SAMPLER_TABLE_STARTED" == yes ]] || fatal "start_private_bus runs after start_sampler_table"
  PRIVATE_BUS_DIR="$WORK_DIR/private-bus"
  PRIVATE_BUS_CONFIG="$WORK_DIR/private-bus.conf"
  if ! mkdir -p "$PRIVATE_BUS_DIR" || ! chmod 700 "$PRIVATE_BUS_DIR"; then
    fatal "cannot create the private bus directory $PRIVATE_BUS_DIR"
  fi
  cat >"$PRIVATE_BUS_CONFIG" <<BUS_CONFIG || fatal "cannot write $PRIVATE_BUS_CONFIG"
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:dir=$PRIVATE_BUS_DIR</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*"/>
    <allow receive_sender="*"/>
    <allow own="*"/>
    <!-- A stock bus drops a reply nobody asked for (dbus-daemon(1), requested_reply), so a reply to a call flagged
         "no reply expected" could not be seen there; this one passes it, for bus_link.rs's no-reply test. -->
    <allow send_type="method_return" send_requested_reply="false"/>
    <allow send_type="error" send_requested_reply="false"/>
    <allow receive_type="method_return" receive_requested_reply="false"/>
    <allow receive_type="error" receive_requested_reply="false"/>
  </policy>
</busconfig>
BUS_CONFIG
}
# on_private_bus <command...> runs a command on its own private bus, behind the barrier. GIO_USE_VFS=local keeps GIO
# from asking that bus for gvfs. It runs in a session of its own (setsid), and timeout signals its whole process
# group, so a time-out ends the private dbus-daemon and every copy of the program with it.
on_private_bus() {
  env "${BUS_BARRIER[@]}" RESOURCE_PULSE_TEST_BUS_DIR="$PRIVATE_BUS_DIR" GIO_USE_VFS=local \
    setsid --wait timeout --kill-after="$PRIVATE_BUS_KILL_AFTER_SECONDS" "$PRIVATE_BUS_TIMEOUT_SECONDS" \
    dbus-run-session --config-file="$PRIVATE_BUS_CONFIG" -- "$@"
}
build_sampler_program
start_private_bus

printf '\nthe program on a private bus (gnome-shell/tests/run-sampler-program.js)\n'
# The runner's own guards first. Outside its private bus (the barrier's dead socket, outside the bus directory) it
# must refuse before a row runs; on the bus but with no program, it must refuse too.
RUNNER_GUARD_OUTPUT="$(off_bus RESOURCE_PULSE_TEST_BUS_DIR="$PRIVATE_BUS_DIR" \
  timeout "$PRIVATE_BUS_TIMEOUT_SECONDS" gjs -m "$PRIVATE_BUS_RUNNER" "$PROGRAM_PATH" 2>&1)"
check "the runner refuses a bus outside its private directory: exit 2, no row run" \
  "$?/$(rg -c -F 'refusing to run' <<<"$RUNNER_GUARD_OUTPUT")/$(rg -c '^JS-TALLY' <<<"$RUNNER_GUARD_OUTPUT")" "2/1/"
RUNNER_GUARD_OUTPUT="$(on_private_bus gjs -m "$PRIVATE_BUS_RUNNER" 2>&1)"
check "the runner refuses to start with no program to run: exit 2, no row run" \
  "$?/$(rg -c -F 'no executable sampler program' <<<"$RUNNER_GUARD_OUTPUT")/$(rg -c '^JS-TALLY' <<<"$RUNNER_GUARD_OUTPUT")" \
  "2/1/"
# The bus link's rules, deterministically (resource-pulse-sampler/tests/bus_link.rs). Its tests are #[ignore]d, so the
# cargo and program table's cargo test step lists them as ignored and runs nothing on any bus; here they run with
# --ignored. They are taken from the binary's own list, so a test added to the file cannot be left out.
BUS_LINK_TEST_COMMAND=(cargo test --locked --manifest-path "$MANIFEST_PATH" --test bus_link -- --ignored)
mapfile -t BUS_LINK_TEST_NAMES < <(off_bus "${BUS_LINK_TEST_COMMAND[@]}" --list 2>/dev/null | sed -n 's/: test$//p')
BUS_LINK_TEST_COUNT=${#BUS_LINK_TEST_NAMES[@]}
(( BUS_LINK_TEST_COUNT > 0 )) || bad "cargo test --test bus_link listed no tests: they did not run"
# Off the private bus every one must refuse before it connects: under BUS_BARRIER, whose address is outside the
# private bus directory, each fails with the guard's own message, and none passes.
BUS_LINK_GUARD_OUTPUT="$(off_bus RESOURCE_PULSE_TEST_BUS_DIR="$PRIVATE_BUS_DIR" "${BUS_LINK_TEST_COMMAND[@]}" 2>&1)"
BUS_LINK_GUARD_EXIT=$?
BUS_LINK_GUARD_RESULT_PATTERN="^test result: FAILED\\. 0 passed; $BUS_LINK_TEST_COUNT failed;"
check "off the private bus every bus_link test refuses: a failing exit, one refusal each, none passed" \
  "$BUS_LINK_GUARD_EXIT/$(rg -c '^refusing to run: ' <<<"$BUS_LINK_GUARD_OUTPUT")/$(rg -c "$BUS_LINK_GUARD_RESULT_PATTERN" <<<"$BUS_LINK_GUARD_OUTPUT")" \
  "$LIBTEST_FAILED_EXIT_CODE/$BUS_LINK_TEST_COUNT/1"
# On the private bus each test runs in a process and on a bus of its own: a link's connection lives as long as its
# receiving thread, so in one process a link one test leaves behind could make another fail for its reason and not
# its own.
for bus_link_test_name in "${BUS_LINK_TEST_NAMES[@]}"; do
  BUS_LINK_OUTPUT="$(on_private_bus "${BUS_LINK_TEST_COMMAND[@]}" --exact "$bus_link_test_name" 2>&1)"
  count_cargo_test_rows "cargo test --test bus_link $bus_link_test_name" "$BUS_LINK_OUTPUT" "$?"
done

PROGRAM_BUS_OUTPUT="$(on_private_bus gjs -m "$PRIVATE_BUS_RUNNER" "$PROGRAM_PATH" 2>&1)"
PROGRAM_BUS_EXIT=$?
printf '%s\n' "$PROGRAM_BUS_OUTPUT"
PROGRAM_BUS_TALLY_LINE=""
while IFS= read -r program_bus_line; do
  if [[ "$program_bus_line" =~ $TALLY_PATTERN ]]; then
    PROGRAM_BUS_TALLY_LINE="$program_bus_line"
    PROGRAM_BUS_PASS="${BASH_REMATCH[1]}"
    PROGRAM_BUS_FAIL="${BASH_REMATCH[2]}"
  fi
done <<<"$PROGRAM_BUS_OUTPUT"
[[ -n "$PROGRAM_BUS_TALLY_LINE" ]] \
  || fatal "no JS-TALLY line from the program's bus rows (exit $PROGRAM_BUS_EXIT): they did not run"
PASS=$((PASS + PROGRAM_BUS_PASS))
FAIL=$((FAIL + PROGRAM_BUS_FAIL))
if (( PROGRAM_BUS_EXIT != 0 && PROGRAM_BUS_FAIL == 0 )); then
  bad "the program's bus runner exited $PROGRAM_BUS_EXIT with no failing row"
fi

printf '\nthe program on a private bus under the journal\n'
# The "serving" line and the clean ending's line are routine, so they carry no priority prefix even when stderr is the
# journal. The program serves on a private bus of its own, with JOURNAL_STREAM naming the device and inode of the file
# its stderr is (as systemd sets it), over a root whose initialize logs a warning: that line carries <4>, which proves
# the program took its stderr for the journal, so the two bare lines cannot pass on a run that never decided so. The
# session's child waits for the serving line and exits, so dbus-run-session ends the bus, as a logout does; the
# program's own wrapper writes its exit status. Reopening the file with `2>` truncates it and keeps its inode.
JOURNAL_BUS_FIXTURE_ROOT="$REPO_ROOT/gnome-shell/tests/fixtures/root-bad-pmu"
[[ -d "$JOURNAL_BUS_FIXTURE_ROOT" ]] || fatal "no fixture root at $JOURNAL_BUS_FIXTURE_ROOT"
JOURNAL_BUS_STDERR_FILE="$WORK_DIR/journal-bus.err"
JOURNAL_BUS_EXIT_FILE="$WORK_DIR/journal-bus.exit"
JOURNAL_BUS_PID_FILE="$WORK_DIR/journal-bus.pid"
# The session's child, a checked file of its own (its header says what it does).
JOURNAL_BUS_SESSION_CHILD="$REPO_ROOT/gnome-shell/tests/journal-bus-session-child.sh"
[[ -r "$JOURNAL_BUS_SESSION_CHILD" ]] || fatal "cannot read $JOURNAL_BUS_SESSION_CHILD"
# How long the session's child waits for the serving line, and the table for the program's exit after the session
# ends, each in polls of JOURNAL_BUS_POLL_SECONDS (10 s).
JOURNAL_BUS_POLL_SECONDS=0.1
JOURNAL_BUS_WAIT_POLLS=100
SERVING_LINE="resource-pulse: serving io.github.zvibaratz.ResourcePulse1 (protocol 1)"
BUS_GONE_LINE="resource-pulse: shutting down: lost io.github.zvibaratz.ResourcePulse1: the bus connection closed"
: >"$JOURNAL_BUS_STDERR_FILE" || fatal "cannot create $JOURNAL_BUS_STDERR_FILE"
JOURNAL_BUS_STREAM="$(stat -c '%d:%i' "$JOURNAL_BUS_STDERR_FILE")" || fatal "cannot stat $JOURNAL_BUS_STDERR_FILE"
on_private_bus env "${BUS_ROWS_DATA_ENVIRONMENT[@]}" bash "$JOURNAL_BUS_SESSION_CHILD" "$PRIVATE_BUS_DIR" \
  "$PROGRAM_PATH" "$JOURNAL_BUS_FIXTURE_ROOT" "$JOURNAL_BUS_STDERR_FILE" "$JOURNAL_BUS_PID_FILE" "$JOURNAL_BUS_EXIT_FILE" \
  "$JOURNAL_BUS_STREAM" "$JOURNAL_BUS_POLL_SECONDS" "$JOURNAL_BUS_WAIT_POLLS" >"$WORK_DIR/journal-bus-session.out" 2>&1
JOURNAL_BUS_SESSION_EXIT=$?
for ((journal_bus_poll = 0; journal_bus_poll < JOURNAL_BUS_WAIT_POLLS; journal_bus_poll++)); do
  [[ -s "$JOURNAL_BUS_EXIT_FILE" ]] && break
  sleep "$JOURNAL_BUS_POLL_SECONDS"
done
if [[ -s "$JOURNAL_BUS_EXIT_FILE" ]]; then
  JOURNAL_BUS_PROGRAM_EXIT="$(<"$JOURNAL_BUS_EXIT_FILE")"
else
  # A program still running once the session has ended is stopped here, so that no copy outlives the table.
  JOURNAL_BUS_PROGRAM_EXIT="still running"
  [[ -s "$JOURNAL_BUS_PID_FILE" ]] && kill -KILL "$(<"$JOURNAL_BUS_PID_FILE")" 2>/dev/null
fi
if (( JOURNAL_BUS_SESSION_EXIT != 0 )) || [[ "$JOURNAL_BUS_PROGRAM_EXIT" != 0 ]]; then
  printf '    session exit %s, program exit %s; its stderr:\n' "$JOURNAL_BUS_SESSION_EXIT" "$JOURNAL_BUS_PROGRAM_EXIT"
  sed 's/^/    | /' "$WORK_DIR/journal-bus-session.out" "$JOURNAL_BUS_STDERR_FILE"
fi
check "under JOURNAL_STREAM naming its stderr, on a private bus, the program took its stderr for the journal: the sampler's initialize warning carries <4>" \
  "$(rg -c '^<4>resource-pulse: cannot parse ' "$JOURNAL_BUS_STDERR_FILE")" "1"
check "under JOURNAL_STREAM naming its stderr, on a private bus, the serving line is routine: that line exactly, no prefix" \
  "$(rg -c -x -F "$SERVING_LINE" "$JOURNAL_BUS_STDERR_FILE")" "1"
check "under JOURNAL_STREAM naming its stderr, once the session ends, the clean ending is routine: exit 0, and the bus-gone line exactly, no prefix" \
  "$JOURNAL_BUS_PROGRAM_EXIT:$(rg -c -x -F "$BUS_GONE_LINE" "$JOURNAL_BUS_STDERR_FILE")" "0:1"
# The session's child is a barrier of its own: on any bus but its private one it refuses (exit 2) before it starts the
# program. It runs here behind the table's barrier (the dead socket, outside the private bus directory), and the program
# it is given is a stand-in that only records that it ran, so that a child that did not refuse still starts nothing that
# connects anywhere. One poll: a child that went on would give up waiting for the serving line at once.
# The child starts the program in the background, so it can exit before the program has run. The command substitution
# below therefore also hands the child its pipe as fd 3, which everything the child starts inherits (its start redirects
# only 0 to 2): the substitution ends only once every process holding the pipe has exited, so a program the child
# started has run to its end and written its file before the file is looked for, and a child that started nothing
# ends it at once. No race and no wait on the pass path.
JOURNAL_CHILD_GUARD_DIR="$WORK_DIR/journal-child-guard"
JOURNAL_CHILD_GUARD_STAND_IN="$JOURNAL_CHILD_GUARD_DIR/program-stand-in"
JOURNAL_CHILD_GUARD_RAN_FILE="$JOURNAL_CHILD_GUARD_DIR/stand-in-ran"
JOURNAL_CHILD_GUARD_WAIT_POLLS=1
JOURNAL_CHILD_REFUSAL_LINE='refusing to run: the session bus is not the private one'
mkdir -p "$JOURNAL_CHILD_GUARD_DIR" || fatal "cannot create $JOURNAL_CHILD_GUARD_DIR"
if ! printf '#!/usr/bin/env bash\n: >%q\n' "$JOURNAL_CHILD_GUARD_RAN_FILE" >"$JOURNAL_CHILD_GUARD_STAND_IN" \
  || ! chmod +x "$JOURNAL_CHILD_GUARD_STAND_IN"; then
  fatal "cannot write the journal child's program stand-in"
fi
JOURNAL_CHILD_GUARD_OUTPUT="$(off_bus bash "$JOURNAL_BUS_SESSION_CHILD" "$PRIVATE_BUS_DIR" "$JOURNAL_CHILD_GUARD_STAND_IN" \
  "$JOURNAL_BUS_FIXTURE_ROOT" "$JOURNAL_CHILD_GUARD_DIR/stderr" "$JOURNAL_CHILD_GUARD_DIR/pid" \
  "$JOURNAL_CHILD_GUARD_DIR/exit" "$JOURNAL_BUS_STREAM" "$JOURNAL_BUS_POLL_SECONDS" "$JOURNAL_CHILD_GUARD_WAIT_POLLS" \
  2>&1 3>&1)"
JOURNAL_CHILD_GUARD_EXIT=$?
journal_child_guard_program="not-started"
[[ -e "$JOURNAL_CHILD_GUARD_RAN_FILE" ]] && journal_child_guard_program="started"
check "the journal rows' session child refuses any bus but its private one: exit 2, its refusal said, the program never started" \
  "$JOURNAL_CHILD_GUARD_EXIT/$(rg -c -x -F "$JOURNAL_CHILD_REFUSAL_LINE" <<<"$JOURNAL_CHILD_GUARD_OUTPUT")/$journal_child_guard_program" \
  "2/1/not-started"

printf '\nthe status script reads the program'"'"'s GetState (the real status script and gdbus, a stub systemctl)\n'
# The status script (scripts/resource-pulse-status.sh, which prints the status report) asks the
# sampler for its state through the real gdbus. This row runs the real script, under bash, on the private bus beside the
# real program, with a stub systemctl that says the unit is active (and the cockpit's is skipped, as for anyone without
# its config file); gsettings, gnome-extensions and pgrep are stubs that answer nothing, so nothing of the desktop is
# read. HOME is an empty directory of this run, so the extension is not linked there and the build script is never
# asked: nothing is built. The session's child waits until the program has published a sample (a bounded poll of the
# same GetState), runs the script, and ends the program.
STATUS_SCRIPT_BUS_STUB_BIN="$WORK_DIR/status-script-bus-bin"
STATUS_SCRIPT_BUS_HOME="$WORK_DIR/status-script-bus-home"
STATUS_SCRIPT_BUS_OUTPUT="$WORK_DIR/status-script-bus.out"
STATUS_SCRIPT_BUS_EXIT_FILE="$WORK_DIR/status-script-bus.exit"
STATUS_SCRIPT_BUS_UNEXPECTED_CALLS="$WORK_DIR/status-script-bus-unexpected-calls"
STATUS_SCRIPT_BUS_STDERR_FILE="$WORK_DIR/status-script-bus-program.err"
STATUS_SCRIPT_BUS_SESSION_CHILD="$WORK_DIR/status-script-bus-session-child.sh"
RESOURCE_PULSE_STATUS_SCRIPT="$REPO_ROOT/scripts/resource-pulse-status.sh"
# How fast the program ticks for this row, and the session child's wait for its first sample, in polls of
# STATUS_SCRIPT_BUS_POLL_SECONDS (10 s).
STATUS_SCRIPT_BUS_TICK_INTERVAL_MS=100
STATUS_SCRIPT_BUS_POLL_SECONDS=0.1
STATUS_SCRIPT_BUS_WAIT_POLLS=100
STATUS_SCRIPT_BUS_NAME="io.github.zvibaratz.ResourcePulse1"
STATUS_SCRIPT_BUS_OBJECT_PATH="/io/github/zvibaratz/ResourcePulse1"
mkdir -p "$STATUS_SCRIPT_BUS_STUB_BIN" "$STATUS_SCRIPT_BUS_HOME" || fatal "cannot create the status script bus row's directories"
: >"$STATUS_SCRIPT_BUS_UNEXPECTED_CALLS" || fatal "cannot create $STATUS_SCRIPT_BUS_UNEXPECTED_CALLS"
write_status_script_bus_stub() {
  local stub_path="$STATUS_SCRIPT_BUS_STUB_BIN/$1"
  printf '%s\n' "$2" >"$stub_path" || fatal "cannot write the $1 stub"
  chmod +x "$stub_path" || fatal "cannot make the $1 stub executable"
}
write_status_script_bus_stub gsettings $'#!/usr/bin/env bash\nexit 1'
write_status_script_bus_stub gnome-extensions $'#!/usr/bin/env bash\nexit 1'
write_status_script_bus_stub pgrep $'#!/usr/bin/env bash\nexit 1'
# shellcheck disable=SC2016  # The stub's own source: its variables expand when it runs.
write_status_script_bus_stub systemctl '#!/usr/bin/env bash
case "$*" in
  "--user show -p LoadState -p ActiveState -p SubState resource-pulse.service")
    printf "LoadState=loaded\nActiveState=active\nSubState=running\n" ;;
  "--user show -p LoadState -p ActiveState -p SubState -p ConditionResult resource-pulse-cockpit.service")
    printf "LoadState=loaded\nActiveState=inactive\nSubState=dead\nConditionResult=no\n" ;;
  *) printf "%s\n" "$*" >>"$STATUS_SCRIPT_BUS_UNEXPECTED_CALLS"; exit 64 ;;
esac'
cat >"$STATUS_SCRIPT_BUS_SESSION_CHILD" <<'SESSION_CHILD' || fatal "cannot write $STATUS_SCRIPT_BUS_SESSION_CHILD"
# The session's child: refuses unless its bus is the private one, starts the program, waits until GetState carries a
# sample, runs the status script and writes its exit status, then ends the program.
private_bus_dir="$1" program="$2" fixture_root="$3" tick_interval_ms="$4" program_stderr_file="$5" bus_name="$6"
object_path="$7" poll_seconds="$8" wait_polls="$9"
shift 9
output_file="$1" exit_file="$2" status_home="$3" stub_bin="$4" status_script="$5" unexpected_calls_file="$6"
if [[ "${DBUS_SESSION_BUS_ADDRESS:-}" != "unix:path=$private_bus_dir/"* ]]; then
  echo "refusing to run: the session bus is not the private one" >&2
  exit 2
fi
"$program" --fs-root "$fixture_root" --tick-interval-ms "$tick_interval_ms" </dev/null >/dev/null 2>"$program_stderr_file" &
program_pid=$!
sample_pattern='"latestSampledAtUsec":[0-9]'
has_sample=no
for ((poll = 0; poll < wait_polls; poll++)); do
  state_reply="$(gdbus call --session --dest "$bus_name" --object-path "$object_path" \
    --method "$bus_name.GetState" --timeout 2 2>/dev/null)"
  if [[ "$state_reply" =~ $sample_pattern ]]; then has_sample=yes; break; fi
  sleep "$poll_seconds"
done
if [[ "$has_sample" == yes ]]; then
  env HOME="$status_home" XDG_CONFIG_HOME= PATH="$stub_bin:$PATH" \
    STATUS_SCRIPT_BUS_UNEXPECTED_CALLS="$unexpected_calls_file" \
    bash "$status_script" >"$output_file" 2>&1
  echo "$?" >"$exit_file"
else
  echo "the program published no sample" >&2
fi
kill -TERM "$program_pid" 2>/dev/null
for ((poll = 0; poll < wait_polls; poll++)); do
  kill -0 "$program_pid" 2>/dev/null || break
  sleep "$poll_seconds"
done
kill -KILL "$program_pid" 2>/dev/null
wait "$program_pid" 2>/dev/null
[[ "$has_sample" == yes ]]
SESSION_CHILD
on_private_bus env "${BUS_ROWS_DATA_ENVIRONMENT[@]}" bash "$STATUS_SCRIPT_BUS_SESSION_CHILD" "$PRIVATE_BUS_DIR" \
  "$PROGRAM_PATH" "$PROGRAM_FIXTURE_ROOT" "$STATUS_SCRIPT_BUS_TICK_INTERVAL_MS" "$STATUS_SCRIPT_BUS_STDERR_FILE" \
  "$STATUS_SCRIPT_BUS_NAME" "$STATUS_SCRIPT_BUS_OBJECT_PATH" "$STATUS_SCRIPT_BUS_POLL_SECONDS" "$STATUS_SCRIPT_BUS_WAIT_POLLS" \
  "$STATUS_SCRIPT_BUS_OUTPUT" "$STATUS_SCRIPT_BUS_EXIT_FILE" "$STATUS_SCRIPT_BUS_HOME" "$STATUS_SCRIPT_BUS_STUB_BIN" \
  "$RESOURCE_PULSE_STATUS_SCRIPT" "$STATUS_SCRIPT_BUS_UNEXPECTED_CALLS" >"$WORK_DIR/status-script-bus-session.out" 2>&1
STATUS_SCRIPT_BUS_SESSION_EXIT=$?
STATUS_SCRIPT_BUS_EXIT="no exit status"
[[ -s "$STATUS_SCRIPT_BUS_EXIT_FILE" ]] && STATUS_SCRIPT_BUS_EXIT="$(<"$STATUS_SCRIPT_BUS_EXIT_FILE")"
# The age is the real one, so its shape is compared, not its number (any whole number of seconds: a loaded runner may be
# slow), and the line must be the only one of its kind.
STATUS_SCRIPT_BUS_LINE_PATTERN='^  service: active, protocol 1, last sample [0-9]+ s ago$'
STATUS_SCRIPT_BUS_SERVICE_LINES="$(rg '^  service: ' "$STATUS_SCRIPT_BUS_OUTPUT" 2>/dev/null)"
if [[ "$STATUS_SCRIPT_BUS_SERVICE_LINES" =~ $STATUS_SCRIPT_BUS_LINE_PATTERN ]]; then
  STATUS_SCRIPT_BUS_LINE_SHAPE=ok
else
  STATUS_SCRIPT_BUS_LINE_SHAPE="[$STATUS_SCRIPT_BUS_SERVICE_LINES]"
fi
if (( STATUS_SCRIPT_BUS_SESSION_EXIT != 0 )) || [[ "$STATUS_SCRIPT_BUS_LINE_SHAPE" != ok ]]; then
  printf '    session exit %s; its output, the status script'"'"'s and the program'"'"'s stderr:\n' "$STATUS_SCRIPT_BUS_SESSION_EXIT"
  sed 's/^/    | /' "$WORK_DIR/status-script-bus-session.out" "$STATUS_SCRIPT_BUS_OUTPUT" "$STATUS_SCRIPT_BUS_STDERR_FILE" 2>/dev/null
fi
check "the status script, with a stub systemctl saying the unit is active, reads the program's GetState through the real gdbus: exit 0, the line 'service: active, protocol 1, last sample <n> s ago', no ⚠ at all, no systemctl call it did not expect" \
  "exit=$STATUS_SCRIPT_BUS_EXIT session=$STATUS_SCRIPT_BUS_SESSION_EXIT line=$STATUS_SCRIPT_BUS_LINE_SHAPE warnings=$(rg -F '  ⚠ ' "$STATUS_SCRIPT_BUS_OUTPUT" 2>/dev/null | wc -l | tr -d ' ') unexpected=$(wc -l <"$STATUS_SCRIPT_BUS_UNEXPECTED_CALLS" | tr -d ' ')" \
  "exit=0 session=0 line=ok warnings=0 unexpected=0"

# 2 runner guards + 1 bus_link guard + 12 bus_link tests
# + 19 rows of the program on a private bus (one the test double's conformance row; two need no program: the rule of
#   the comparison that row rests on, and that the Set the last row reads is the one the launcher exports)
# + 4 rows of the program on a private bus under JOURNAL_STREAM: a warning carries <4> (it took stderr for the journal),
#   the serving line bare, the clean ending bare with exit 0, and the session's child refusing any bus but its private one
# + 1 row of the status script asked about the program: the real script and gdbus, a stub systemctl saying the unit is
#   active, on the private bus beside the real program: its service line and no ⚠
# = 39.
EXPECTED_ROWS=39

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
