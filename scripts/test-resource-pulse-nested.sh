#!/usr/bin/env bash
#
# scripts/test-resource-pulse-nested.sh
# =====================================
#
# State table for the Resource Pulse nested-shell harness (scripts/resource-pulse-nested.sh), first of four: what
# it decides before anything starts. Its usage; eval's refusals and its lookup of the live run (a run not live,
# ended, marked or with a reused pid passes nowhere); scenario; and perf: its refusals, its count of the shell's
# major collections, its verdicts on the counts and on the cockpit's grid, its probe and read-cockpit answers, and
# what its exit puts back. The harness starts no gnome-shell here: busctl, gsettings, gnome-shell and jq are
# recording stubs, its base directory is empty, and a process a row signals is a sacrificial session of the row's.
# The other three: scripts/test-resource-pulse-nested-runs.sh, -nested-check.sh and -nested-signals.sh.
#
# "Could not run" is exit 2, never a pass: a missing find, timeout, setsid or jq, or a fixture that could not be
# laid out, is fatal. The table asserts its own row total.
#
# Its shared helpers and constants are scripts/resource-pulse-table-lib.sh's, and the nested harness's fixtures
# (its stubs, its run directories, the sacrificial sessions, the fake gnome-shell)
# scripts/resource-pulse-nested-table-lib.sh's.
#
# Requires: bash, find, timeout, setsid (util-linux) and jq. No network, no gnome-shell.
#
# Usage: scripts/test-resource-pulse-nested.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
source "$TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
start_table
NESTED_TABLE_LIB="$HERE/resource-pulse-nested-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-nested-table-lib.sh
source "$NESTED_TABLE_LIB" || fatal "cannot source $NESTED_TABLE_LIB"

require_tools find timeout setsid jq
start_nested_harness

printf '\nresource-pulse-nested.sh (hermetic: no gnome-shell, nothing is started)\n'
check "nested: the script parses (bash -n)" "$(bash -n "$NESTED_SCRIPT" 2>&1; printf 'rc=%d' $?)" "rc=0"

nested_run
no_subcommand_exit=$NESTED_EXIT
nested_run launch
check "nested: no subcommand and an unknown one both exit 2, say why, and create nothing" \
  "$no_subcommand_exit:$NESTED_EXIT:$(grep -c -F "unknown subcommand: 'launch'" <<<"$NESTED_OUTPUT"):$(find "$NESTED_BASE" -mindepth 1 | wc -l)" \
  "2:2:1:0"

# The usage block, as a usage error prints it: whole lines, so a line that merely mentions an option is not enough.
nested_run
usage_summary="start=$(grep -c -x -F 'usage: scripts/resource-pulse-nested.sh start [--gc-log] [--replay] [--monitor-size <width>x<height>]' <<<"$NESTED_OUTPUT")"
usage_summary+=" start-scale=$(grep -c -x -F '           [--monitor-scale <scale>] [--no-cockpit]' <<<"$NESTED_OUTPUT")"
usage_summary+=" scenario=$(grep -c -x -F '       scripts/resource-pulse-nested.sh scenario <idle|light|busy|strained>' <<<"$NESTED_OUTPUT")"
check "nested: the usage lists start's --gc-log, --replay, --monitor-size, --monitor-scale and --no-cockpit, and the scenario request" "$usage_summary" \
  "start=1 start-scale=1 scenario=1"

nested_run eval '1 + 1'
check "nested: eval with no run refuses (exit 2) and never calls busctl" \
  "$NESTED_EXIT:$(nested_stub_call_count):$(grep -c -F 'no live run' <<<"$NESTED_OUTPUT")" "2:0:1"

# A run directory whose recorded address is the LIVE session bus: the address
# check, not the run lookup, must be what refuses it.
TAMPERED_SUFFIX="Tamper01"
TAMPERED_RUN="$NESTED_BASE/rpn.$TAMPERED_SUFFIX"
mkdir -p "$TAMPERED_RUN/state" && chmod 700 "$TAMPERED_RUN"
printf '%s\n' "$TAMPERED_SUFFIX" >"$TAMPERED_RUN/.resource-pulse-nested"
printf '%s\n' "unix:path=/run/user/$(id -u)/bus" >"$TAMPERED_RUN/state/session.addr"
# Named, not looked for: looking skips a run with no live supervisor, which this one has none of.
NESTED_RUN_DIR="$TAMPERED_RUN" nested_run eval '1 + 1'
check "nested: a run whose recorded address is not its private bus is refused before busctl" \
  "$NESTED_EXIT:$(nested_stub_call_count):$(grep -c -F "not this run's private session bus" <<<"$NESTED_OUTPUT")" "2:0:1"
rm -rf "$TAMPERED_RUN"

# A run whose recorded address IS its private bus, but which is not live: eval
# and screenshot must refuse unless the supervisor runs and the recorded
# gnome-shell runs in the run's own session under that name. Each case below
# defeats one requirement; the last meets them all and so reaches busctl (the
# stub), which proves the fixture is otherwise good.
STALE_SUFFIX="Stale001"
STALE_RUN="$NESTED_BASE/rpn.$STALE_SUFFIX"
mkdir -p "$STALE_RUN/state" && chmod 700 "$STALE_RUN"
printf '%s\n' "$STALE_SUFFIX" >"$STALE_RUN/.resource-pulse-nested"
printf '%s\n' "unix:path=$STALE_RUN/bus/session.sock,guid=0123456789abcdef" >"$STALE_RUN/state/session.addr"
# A process whose comm is gnome-shell in this session, recorded as a run's gnome-shell, makes the run live: the
# nested table library's long-lived fake gnome-shell.
start_long_lived_fake_shell
fake_shell_pid=$LONG_LIVED_FAKE_SHELL_PID
# eval_stale_run <supervisor> <session> <gnome-shell pid> prints refused or reached-busctl.
eval_stale_run() {
  printf 'supervisor=%s\nsupervisor-starttime=%s\nsession=%s\ngnome-shell=%s\ngnome-shell-starttime=%s\n' \
    "$1" "$(starttime_of "$1")" "$2" "$3" "$(starttime_of "$3")" >"$STALE_RUN/state/run.values"
  NESTED_RUN_DIR="$STALE_RUN" nested_run eval '1 + 1'
  if [[ $NESTED_EXIT == 2 && $(nested_stub_call_count) == 0 ]]; then printf refused
  elif (( $(nested_stub_call_count) > 0 )); then printf reached-busctl
  else printf 'exit-%s' "$NESTED_EXIT"; fi
}
stale_summary="supervisor-gone=$(eval_stale_run "$NEVER_RUNNING_PID" "$test_session_id" "$fake_shell_pid")"
stale_summary+=" other-session=$(eval_stale_run "$$" "$NEVER_RUNNING_PID" "$fake_shell_pid")"
stale_summary+=" not-gnome-shell=$(eval_stale_run "$$" "$test_session_id" "$$")"
stale_summary+=" live=$(eval_stale_run "$$" "$test_session_id" "$fake_shell_pid")"
check "nested: eval refuses a run that is not live: supervisor gone, shell in another session, or not gnome-shell" \
  "$stale_summary" "supervisor-gone=refused other-session=refused not-gnome-shell=refused live=reached-busctl"

# A run that ended without `stop` (its lifetime ran out, or it crashed) next to
# a live one: looking for the live run must skip it, not report "several live
# runs" and steer the user to stop the ended one.
ENDED_RUN="$NESTED_BASE/rpn.Ended001"
make_run_dir "$ENDED_RUN" "launcher=$NEVER_RUNNING_PID" "session=$NEVER_RUNNING_PID" "supervisor=$NEVER_RUNNING_PID"
eval_stale_run "$$" "$test_session_id" "$fake_shell_pid" >/dev/null
nested_run eval '1 + 1'
check "nested: looking for the live run skips one whose supervisor and launcher are gone" \
  "$NESTED_EXIT:$(nested_stub_call_count):$(grep -c -F 'several live runs' <<<"$NESTED_OUTPUT")" "2:1:0"
rm -rf "$ENDED_RUN"

# A run marked ended (its supervisor's exit) or stopped, whose recorded
# processes still look live (the same pids and start times as the live run):
# only the marker can make looking for a live run skip it.
mv "$STALE_RUN" "$NESTED_BASE/rpn.Marked01"
MARKED_ENDED_RUN="$NESTED_BASE/rpn.Marked01"
: >"$MARKED_ENDED_RUN/state/ended"
printf '%s\n' Marked01 >"$MARKED_ENDED_RUN/.resource-pulse-nested"
MARKED_STOPPED_RUN="$NESTED_BASE/rpn.Marked02"
cp -a "$MARKED_ENDED_RUN" "$MARKED_STOPPED_RUN"
rm -f "$MARKED_STOPPED_RUN/state/ended"
: >"$MARKED_STOPPED_RUN/state/stopped"
printf '%s\n' Marked02 >"$MARKED_STOPPED_RUN/.resource-pulse-nested"
nested_run eval '1 + 1'
check "nested: looking for the live run skips a run marked ended or stopped, however live its pids look" \
  "$NESTED_EXIT:$(nested_stub_call_count):$(grep -c -F 'no live run' <<<"$NESTED_OUTPUT")" "2:0:1"
rm -rf "$MARKED_ENDED_RUN" "$MARKED_STOPPED_RUN"

# A pid can be reused once its process ends. A recorded process counts only
# while the same pid runs with the start time recorded for it, so a different
# start time (a reused pid) must never pass: (a) stop leaves a session led by
# a `timeout` it did not record; (b) eval refuses a shell it did not record;
# (c) looking for a live run skips a run whose supervisor is someone else.
reused_pid_session_id="$(start_sacrificial_session timeout 60 sleep 60)"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ "$(cat "/proc/$reused_pid_session_id/comm" 2>/dev/null)" == timeout ]] && break
  sleep 0.1
done
reused_pid_starttime="$(starttime_of "$reused_pid_session_id")"
REUSED_PID_RUN="$NESTED_BASE/rpn.ReusePid"
make_run_dir "$REUSED_PID_RUN" "launcher=$reused_pid_session_id" "launcher-starttime=$((reused_pid_starttime + 1))" \
  "session=$reused_pid_session_id" "supervisor=$reused_pid_session_id" \
  "supervisor-starttime=$((reused_pid_starttime + 1))"
NESTED_RUN_DIR="$REUSED_PID_RUN" nested_run stop
reused_pid_summary="stop=$(is_running "$reused_pid_session_id" && printf left-running || printf signalled)"
kill_sacrifice "$reused_pid_session_id" timeout "$reused_pid_starttime"
SHELL_REUSED_RUN="$NESTED_BASE/rpn.ShellPid"
make_run_dir "$SHELL_REUSED_RUN" "supervisor=$$" "supervisor-starttime=$(starttime_of "$$")" "session=$test_session_id" \
  "gnome-shell=$fake_shell_pid" "gnome-shell-starttime=$(( $(starttime_of "$fake_shell_pid") + 1 ))"
printf '%s\n' "unix:path=$SHELL_REUSED_RUN/bus/session.sock,guid=0123456789abcdef" >"$SHELL_REUSED_RUN/state/session.addr"
NESTED_RUN_DIR="$SHELL_REUSED_RUN" nested_run eval '1 + 1'
reused_pid_summary+=" eval=$([[ $NESTED_EXIT == 2 && $(nested_stub_call_count) == 0 ]] && printf refused || printf 'exit-%s' "$NESTED_EXIT")"
SUPERVISOR_REUSED_RUN="$NESTED_BASE/rpn.SupvPid1"
make_run_dir "$SUPERVISOR_REUSED_RUN" "supervisor=$$" "supervisor-starttime=$(( $(starttime_of "$$") + 1 ))" \
  "session=$test_session_id" "gnome-shell=$fake_shell_pid" "gnome-shell-starttime=$(starttime_of "$fake_shell_pid")"
printf '%s\n' "unix:path=$SUPERVISOR_REUSED_RUN/bus/session.sock,guid=0123456789abcdef" \
  >"$SUPERVISOR_REUSED_RUN/state/session.addr"
rm -rf "$SHELL_REUSED_RUN"
nested_run eval '1 + 1'
reused_pid_summary+=" discovery=$(grep -c -F 'no live run' <<<"$NESTED_OUTPUT")"
check "nested: a recorded pid with another start time (a reused pid) passes nowhere: stop, eval, or looking for a run" \
  "$reused_pid_summary" "stop=left-running eval=refused discovery=1"
rm -rf "$REUSED_PID_RUN" "$SUPERVISOR_REUSED_RUN"

# `scenario` takes exactly one of three words, and refuses any other before it
# looks for a run. Each case prints exit/its own message/whether it looked.
# scenario_word_verdict <needle> <args...>
scenario_word_verdict() {
  local scenario_needle="$1"
  shift
  nested_run scenario "$@"
  printf '%s/%s/%s' "$NESTED_EXIT" "$(grep -c -F "$scenario_needle" <<<"$NESTED_OUTPUT")" \
    "$(grep -c -F 'no live run' <<<"$NESTED_OUTPUT")"
}
scenario_word_summary="heavy=$(scenario_word_verdict "not a scenario: 'heavy'" heavy)"
scenario_word_summary+=" upper-case=$(scenario_word_verdict "not a scenario: 'IDLE'" IDLE)"
scenario_word_summary+=" empty=$(scenario_word_verdict "not a scenario: ''" '')"
scenario_word_summary+=" two-words=$(scenario_word_verdict 'scenario takes one word' idle light)"
scenario_word_summary+=" no-word=$(scenario_word_verdict 'scenario takes one word')"
# The list the request accepts, read by sourcing the script: a fifth word added there fails this row.
# shellcheck disable=SC2016  # Expanded by the child bash.
scenario_word_summary+=" words=[$(bash -c 'source "$1" || exit 99; printf "%s " "${REPLAY_SCENARIO_NAMES[@]}"' \
  scenario-words "$NESTED_SCRIPT")]"
check "nested: scenario takes exactly idle, light, busy or strained, and refuses any other word (exit 2) before looking for a run" \
  "$scenario_word_summary" \
  "heavy=2/1/0 upper-case=2/1/0 empty=2/1/0 two-words=2/1/0 no-word=2/1/0 words=[idle light busy strained ]"

# `scenario idle` on a run recorded with the given values; each case defeats
# one requirement: replay=1 recorded, the run live (its supervisor, and its
# gnome-shell in its session), and its replay service running. The last meets
# them all and so writes the word, which proves the fixture otherwise good.
# The file holds the word, then a token new to each request, so the replay
# service restarts even for the word already playing: asked again, the same
# word must come with a new token, and no staging file may be left behind.
SCENARIO_RUN="$NESTED_BASE/rpn.Scenari1"
SCENARIO_FILE="$SCENARIO_RUN/run/rp-scenario"
# scenario_file_summary prints the scenario file's first field and whether a request token follows it, or none.
scenario_file_summary() {
  local scenario_word="" request_id=""
  [[ -e "$SCENARIO_FILE" ]] || { printf none; return 0; }
  read -r scenario_word request_id _ <"$SCENARIO_FILE"
  printf '%s+%s' "$scenario_word" "$([[ -n "$request_id" ]] && printf token || printf no-token)"
}
# scenario_run_verdict <needle> <run values...> prints exit/needle count/what the file holds.
scenario_run_verdict() {
  local scenario_needle="$1"
  shift
  rm -rf "$SCENARIO_RUN"
  make_run_dir "$SCENARIO_RUN" "$@"
  mkdir -p "$SCENARIO_RUN/run"
  NESTED_RUN_DIR="$SCENARIO_RUN" nested_run scenario idle
  printf '%s/%s/%s' "$NESTED_EXIT" "$(grep -c -F "$scenario_needle" <<<"$NESTED_OUTPUT")" "$(scenario_file_summary)"
}
live_supervisor_values=("supervisor=$$" "supervisor-starttime=$(starttime_of "$$")")
live_shell_values=("session=$test_session_id" "gnome-shell=$fake_shell_pid"
  "gnome-shell-starttime=$(starttime_of "$fake_shell_pid")")
live_service_values=("service=$$" "service-starttime=$(starttime_of "$$")")
scenario_run_summary="no-replay=$(scenario_run_verdict 'was not started with --replay' \
  "${live_supervisor_values[@]}" "${live_shell_values[@]}" "${live_service_values[@]}")"
scenario_run_summary+=" not-live=$(scenario_run_verdict 'is not live' "supervisor=$NEVER_RUNNING_PID" \
  "${live_shell_values[@]}" "${live_service_values[@]}" replay=1)"
scenario_run_summary+=" service-gone=$(scenario_run_verdict 'replay service is not running' \
  "${live_supervisor_values[@]}" "${live_shell_values[@]}" "service=$NEVER_RUNNING_PID" replay=1)"
scenario_run_summary+=" live=$(scenario_run_verdict 'replay service takes' \
  "${live_supervisor_values[@]}" "${live_shell_values[@]}" "${live_service_values[@]}" replay=1)"
first_scenario_request="$(cat "$SCENARIO_FILE" 2>/dev/null)"
NESTED_RUN_DIR="$SCENARIO_RUN" nested_run scenario idle
scenario_run_summary+=" again=$NESTED_EXIT/$(scenario_file_summary)"
scenario_run_summary+="/$([[ -n "$first_scenario_request" && "$(cat "$SCENARIO_FILE" 2>/dev/null)" != "$first_scenario_request" ]] && printf new-request || printf same-request)"
scenario_run_summary+=" staging-left=$(find "$SCENARIO_RUN/run" -mindepth 1 -name 'rp-scenario.*' | wc -l)"
check "nested: scenario refuses a run without replay=1, one not live and one whose replay service is gone (exit 2); a live replay run gets the word and a new request token in run/rp-scenario" \
  "$scenario_run_summary" \
  "no-replay=2/1/none not-live=2/1/none service-gone=2/1/none live=0/1/idle+token again=0/idle+token/new-request staging-left=0"
rm -rf "$SCENARIO_RUN"

# `perf` acts only on a live run started with --gc-log and --replay whose
# replay service runs, with gnome-calculator on PATH, and a shell log holding a
# collection line of the run's gnome-shell (the GC log is on). Each case below
# defeats one requirement; the last meets them all and so reaches busctl (the
# stub), which proves the fixture otherwise good. No case may start
# gnome-calculator (its stub records any call). Each prints exit/its own
# message/busctl calls/gnome-calculator calls.
PERF_RUN="$NESTED_BASE/rpn.PerfRun1"
PERF_CALCULATOR_STUB_BIN="$WIRING_TMP/perf-calculator-bin"
PERF_CALCULATOR_CALLS="$WIRING_TMP/perf-calculator-calls"
# The real gnome-calculator is in /usr/bin beside every tool, so the case
# without it runs on a PATH of the stubs and only what perf runs before it looks
# for gnome-calculator.
PERF_MINIMAL_BIN="$WIRING_TMP/perf-minimal-bin"
mkdir -p "$PERF_MINIMAL_BIN" || fatal "cannot create $PERF_MINIMAL_BIN"
for perf_minimal_tool in bash readlink dirname stat; do
  ln -sf "$(command -v "$perf_minimal_tool")" "$PERF_MINIMAL_BIN/$perf_minimal_tool" \
    || fatal "cannot link $perf_minimal_tool into $PERF_MINIMAL_BIN"
done
# Its calls file is written into its source: a launch under `env -i` would carry no variable naming it.
install_stub "$PERF_CALCULATOR_STUB_BIN" gnome-calculator \
  "$(printf '#!/bin/bash\nprintf "gnome-calculator %%s\\n" "$*" >>%q' "$PERF_CALCULATOR_CALLS")"
PERF_STUBBED_PATH="$PERF_CALCULATOR_STUB_BIN:$NESTED_STUB_BIN:$PATH"
# The case without jq: gnome-calculator's stub, busctl's stub alone (the stub dir holds a jq stub too), and the
# minimal tools; jq is the next tool perf looks for.
PERF_BUSCTL_ONLY_BIN="$WIRING_TMP/perf-busctl-only-bin"
if ! mkdir -p "$PERF_BUSCTL_ONLY_BIN" || ! ln -sf "$NESTED_STUB_BIN/busctl" "$PERF_BUSCTL_ONLY_BIN/busctl"; then
  fatal "cannot lay out $PERF_BUSCTL_ONLY_BIN"
fi
PERF_WITHOUT_JQ_PATH="$PERF_CALCULATOR_STUB_BIN:$PERF_BUSCTL_ONLY_BIN:$PERF_MINIMAL_BIN"
# A collection line of the run's gnome-shell, and a log with none: only another process's line, and a word.
PERF_COLLECTING_LOG="MinorGC:   $fake_shell_pid 0x5f2aea7ebe60   0.015299 OUT_OF_NURSERY         8.1%    256    512"
PERF_SILENT_LOG="$(printf 'gnome-shell started\nMajorGC:   %s 0x5f2aea7ebe60  10.918717 MEM_PRESSURE\n' \
  "$NEVER_RUNNING_PID")"
# perf_refusal_verdict <needle> <PATH> <shell log> [run values...] prints exit/needle count/busctl
# calls/gnome-calculator calls for `perf` on the fixture run made with these values, named; with no values there is
# no run, and none is named.
perf_refusal_verdict() {
  local perf_needle="$1" perf_path="$2" perf_shell_log="$3" perf_output perf_exit
  shift 3
  rm -rf "$PERF_RUN"
  : >"$NESTED_STUB_CALLS"
  : >"$PERF_CALCULATOR_CALLS"
  if (( $# > 0 )); then
    make_run_dir "$PERF_RUN" "$@"
    mkdir -p "$PERF_RUN/log" "$PERF_RUN/run" || fatal "cannot lay out $PERF_RUN"
    printf '%s\n' "unix:path=$PERF_RUN/bus/session.sock,guid=0123456789abcdef" >"$PERF_RUN/state/session.addr"
    printf '%s\n' "$perf_shell_log" >"$PERF_RUN/log/shell.log"
  fi
  perf_output="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" \
    ${1:+RESOURCE_PULSE_NESTED_DIR="$PERF_RUN"} PATH="$perf_path" NESTED_STUB_CALLS="$NESTED_STUB_CALLS" \
    RESOURCE_PULSE_NESTED_BASE="$NESTED_BASE" bash "$NESTED_SCRIPT" perf 2>&1)"
  perf_exit=$?
  printf '%s/%s/%s/%s' "$perf_exit" "$(grep -c -F "$perf_needle" <<<"$perf_output")" \
    "$(grep -c '^busctl ' "$NESTED_STUB_CALLS")" "$(wc -l <"$PERF_CALCULATOR_CALLS")"
}
perf_live_run_values=("${live_supervisor_values[@]}" "${live_shell_values[@]}" "${live_service_values[@]}")
nested_run perf now
perf_refusal_summary="extra-argument=$NESTED_EXIT/$(grep -c -F 'perf takes no arguments' <<<"$NESTED_OUTPUT")"
perf_refusal_summary+=" no-run=$(perf_refusal_verdict 'no live run' "$PERF_STUBBED_PATH" '')"
perf_refusal_summary+=" not-live=$(perf_refusal_verdict 'is not live' "$PERF_STUBBED_PATH" "$PERF_COLLECTING_LOG" \
  "supervisor=$NEVER_RUNNING_PID" "${live_shell_values[@]}" "${live_service_values[@]}" gc-log=1 replay=1)"
perf_refusal_summary+=" no-gc-log=$(perf_refusal_verdict 'was not started with --gc-log' "$PERF_STUBBED_PATH" \
  "$PERF_COLLECTING_LOG" "${perf_live_run_values[@]}" replay=1)"
perf_refusal_summary+=" no-replay=$(perf_refusal_verdict 'was not started with --replay' "$PERF_STUBBED_PATH" \
  "$PERF_COLLECTING_LOG" "${perf_live_run_values[@]}" gc-log=1)"
perf_refusal_summary+=" service-gone=$(perf_refusal_verdict 'replay service is not running' "$PERF_STUBBED_PATH" \
  "$PERF_COLLECTING_LOG" "${live_supervisor_values[@]}" "${live_shell_values[@]}" "service=$NEVER_RUNNING_PID" \
  gc-log=1 replay=1)"
perf_refusal_summary+=" no-calculator=$(perf_refusal_verdict 'gnome-calculator is required' \
  "$NESTED_STUB_BIN:$PERF_MINIMAL_BIN" "$PERF_COLLECTING_LOG" "${perf_live_run_values[@]}" gc-log=1 replay=1)"
perf_refusal_summary+=" no-jq=$(perf_refusal_verdict 'jq is required' "$PERF_WITHOUT_JQ_PATH" \
  "$PERF_COLLECTING_LOG" "${perf_live_run_values[@]}" gc-log=1 replay=1)"
perf_refusal_summary+=" gc-log-silent=$(perf_refusal_verdict 'holds no collection line' "$PERF_STUBBED_PATH" \
  "$PERF_SILENT_LOG" "${perf_live_run_values[@]}" gc-log=1 replay=1)"
perf_refusal_summary+=" all-met=$(perf_refusal_verdict 'the Eval call failed' "$PERF_STUBBED_PATH" \
  "$PERF_COLLECTING_LOG" "${perf_live_run_values[@]}" gc-log=1 replay=1)"
perf_refusal_summary+=" usage=$(grep -c -x -F '       scripts/resource-pulse-nested.sh perf' <<<"$NESTED_OUTPUT")"
check "nested: perf refuses (exit 2), before busctl and without starting gnome-calculator, a run that is not live, one without gc-log=1 or replay=1, a stopped replay service, no gnome-calculator or jq on PATH and a silent GC log" \
  "$perf_refusal_summary" \
  "extra-argument=2/1 no-run=2/1/0/0 not-live=2/1/0/0 no-gc-log=2/1/0/0 no-replay=2/1/0/0 service-gone=2/1/0/0 no-calculator=2/1/0/0 no-jq=2/1/0/0 gc-log-silent=2/1/0/0 all-met=2/1/1/0 usage=1"
rm -rf "$PERF_RUN"
kill "$fake_shell_pid" 2>/dev/null
wait "$fake_shell_pid" 2>/dev/null

# perf counts a window's major collections in the shell's log (SpiderMonkey's
# MajorGC: lines, as `start --gc-log` makes it write them): only the lines past
# the byte offset the window began at, and only those whose PID column is the
# nested shell's, never the column header, a MinorGC: line, another process's
# line or one that merely mentions MajorGC:. A log it cannot read is a failure,
# never a count of 0.
PERF_GC_LOG="$WIRING_TMP/perf-gc-shell.log"
PERF_GC_SHELL_PID=3353150
PERF_GC_HEADER='MajorGC: PID     Runtime        Timestamp  Reason               States FSNR SizeKB'
perf_gc_line() { printf '%s:   %s 0x5f2aea7ebe60  %s %s         0 -> 0 F N      5772\n' "$1" "$2" "$3" "$4"; }
{
  printf '%s\n' "$PERF_GC_HEADER"
  perf_gc_line MajorGC "$PERF_GC_SHELL_PID" 1.002 MEM_PRESSURE
} >"$PERF_GC_LOG"
perf_gc_window_offset="$(stat -c %s "$PERF_GC_LOG")"
{
  printf '%s\n' "$PERF_GC_HEADER"
  perf_gc_line MajorGC "$PERF_GC_SHELL_PID" 10.918 MEM_PRESSURE
  perf_gc_line MinorGC "$PERF_GC_SHELL_PID" 11.002 OUT_OF_NURSERY
  perf_gc_line MajorGC 3353318 12.500 ALLOC_TRIGGER
  printf 'JS LOG: resource-pulse: MajorGC:   %s seen\n' "$PERF_GC_SHELL_PID"
  perf_gc_line MajorGC "$PERF_GC_SHELL_PID" 20.950 MEM_PRESSURE
} >>"$PERF_GC_LOG"
perf_gc_summary="window=$(nested_call count_major_collections_since "$PERF_GC_LOG" "$perf_gc_window_offset" \
  "$PERF_GC_SHELL_PID")"
perf_gc_summary+=" whole-log=$(nested_call count_major_collections_since "$PERF_GC_LOG" 0 "$PERF_GC_SHELL_PID")"
if nested_call count_major_collections_since "$WIRING_TMP/no-such-shell.log" 0 "$PERF_GC_SHELL_PID" >/dev/null 2>&1
then perf_gc_summary+=" unreadable=passed"
else perf_gc_summary+=" unreadable=failed"; fi
check "nested: perf counts the MajorGC: lines of the shell's own pid past the window's start, never the header, a MinorGC: line or another process's; an unreadable log fails" \
  "$perf_gc_summary" "window=2 whole-log=3 unreadable=failed"

# perf's verdict, a pure function of the counts. The disabled state shows 4
# major collections and 2 frames; each enabled state is "<major collections>
# <frames> <Samples> <top-bar paints> <card redirect>", in perf's order:
# covered-idle, covered-busy, topbar-hidden-covered, visible-busy. The in-budget
# counts sit on every bound's edge, and the disabled state's frames are above
# zero, so a comparison off by one either way, or a frame bound that leaves the
# disabled state's frames out, moves a row: the disabled state's own collections
# on their absolute bound, 4; an enabled state's 4 + 1 = 5; frames 30 Samples +
# 2 + 2 = 34, and covered-idle's 2 + 3 = 5; no top-bar paint while hidden.
PERF_VERDICT_DISABLED_MAJORS=4
PERF_VERDICT_DISABLED_FRAMES=2
PERF_VERDICT_DISABLED_COUNTS=("$PERF_VERDICT_DISABLED_MAJORS" "$PERF_VERDICT_DISABLED_FRAMES")
PERF_VERDICT_EDGE_MAJORS=5
PERF_VERDICT_STATE_NAMES=(covered-idle covered-busy topbar-hidden-covered visible-busy)
PERF_VERDICT_EDGE_RECORDS=("$PERF_VERDICT_EDGE_MAJORS 5 30 0 ALWAYS" "$PERF_VERDICT_EDGE_MAJORS 34 30 30 ALWAYS"
  "$PERF_VERDICT_EDGE_MAJORS 34 30 0 ALWAYS" "$PERF_VERDICT_EDGE_MAJORS 34 30 60 ALWAYS")
# perf_verdict_run <records...> runs the verdict on the disabled counts and these records; leaves
# PERF_VERDICT_OUTPUT and PERF_VERDICT_EXIT.
perf_verdict_run() {
  PERF_VERDICT_OUTPUT="$(nested_call perf_count_verdict "${PERF_VERDICT_DISABLED_COUNTS[@]}" "$@" 2>&1)"
  PERF_VERDICT_EXIT=$?
}
# perf_breach_verdict <state index> <record> <needle> runs the verdict with one state's record replaced, and prints
# exit/needle count/whether the line names exactly one broken budget.
perf_breach_verdict() {
  local -a breach_records=("${PERF_VERDICT_EDGE_RECORDS[@]}")
  breach_records[$1]="$2"
  perf_verdict_run "${breach_records[@]}"
  printf '%s/%s/%s' "$PERF_VERDICT_EXIT" "$(grep -c -F "$3" <<<"$PERF_VERDICT_OUTPUT")" \
    "$(grep -c -F 'FAIL: 1 count budget broken: ' <<<"$PERF_VERDICT_OUTPUT")"
}
perf_verdict_run "${PERF_VERDICT_EDGE_RECORDS[@]}"
check "nested: perf's verdict passes (exit 0) counts on every budget's edge, in one line" \
  "exit=$PERF_VERDICT_EXIT lines=$(wc -l <<<"$PERF_VERDICT_OUTPUT") [$PERF_VERDICT_OUTPUT]" \
  "exit=0 lines=1 [perf: PASS: every count within its budget]"

# The disabled state's own collections one past their absolute bound: a defect that outlives disable() raises
# the disabled state with the enabled ones, and every relative budget then holds. Only this budget breaks: the
# enabled states' 5 stay within 5 + 1.
PERF_VERDICT_DISABLED_COUNTS=($((PERF_VERDICT_DISABLED_MAJORS + 1)) "$PERF_VERDICT_DISABLED_FRAMES")
perf_disabled_breach_needle="disabled-collections: disabled had 5 major collections, more than 4: something outlives"
perf_disabled_breach_needle+=" disable(), or the run is not idle"
perf_verdict_run "${PERF_VERDICT_EDGE_RECORDS[@]}"
PERF_VERDICT_DISABLED_COUNTS=("$PERF_VERDICT_DISABLED_MAJORS" "$PERF_VERDICT_DISABLED_FRAMES")
check "nested: perf's verdict fails (exit 1) a disabled state with one more major collection than its absolute bound of 4, naming only that budget" \
  "$PERF_VERDICT_EXIT/$(grep -c -F "$perf_disabled_breach_needle" <<<"$PERF_VERDICT_OUTPUT")/$(grep -c -F 'FAIL: 1 count budget broken: ' <<<"$PERF_VERDICT_OUTPUT")" \
  "1/1/1"

perf_collections_summary=""
perf_frames_summary=""
perf_redirect_summary=""
for perf_state_index in "${!PERF_VERDICT_STATE_NAMES[@]}"; do
  perf_state_name="${PERF_VERDICT_STATE_NAMES[perf_state_index]}"
  read -r _ edge_frames edge_samples edge_paints _ <<<"${PERF_VERDICT_EDGE_RECORDS[perf_state_index]}"
  collections_breach_needle="collections: $perf_state_name had 6 major collections, more than the disabled state's"
  collections_breach_needle+=" 4 plus 1"
  perf_collections_summary+=" $perf_state_name=$(perf_breach_verdict "$perf_state_index" \
    "6 $edge_frames $edge_samples $edge_paints ALWAYS" "$collections_breach_needle")"
  # One frame past Samples + 2 + 2. In covered-idle that is with no Sample at all, so that its own tighter bound
  # (the disabled state's 2 frames + 3) still holds and only this one breaks.
  if [[ "$perf_state_name" == covered-idle ]]; then frames_breach_record="$PERF_VERDICT_EDGE_MAJORS 5 0 0 ALWAYS"
  else frames_breach_record="$PERF_VERDICT_EDGE_MAJORS 35 30 $edge_paints ALWAYS"; fi
  read -r _ breach_frames breach_samples _ _ <<<"$frames_breach_record"
  frames_breach_needle="frames-per-sample: $perf_state_name drew $breach_frames frames, more than its"
  frames_breach_needle+=" $breach_samples Samples plus the disabled state's 2 frames plus 2"
  perf_frames_summary+=" $perf_state_name=$(perf_breach_verdict "$perf_state_index" "$frames_breach_record" \
    "$frames_breach_needle")"
  perf_redirect_summary+=" $perf_state_name=$(perf_breach_verdict "$perf_state_index" \
    "$PERF_VERDICT_EDGE_MAJORS $edge_frames $edge_samples $edge_paints 0" \
    "card-redirect: $perf_state_name found the card's offscreen redirect 0, not ALWAYS")"
done
check "nested: perf's verdict fails (exit 1) one more major collection than the disabled state's + 1 in any enabled state, naming it" \
  "$perf_collections_summary" " covered-idle=1/1/1 covered-busy=1/1/1 topbar-hidden-covered=1/1/1 visible-busy=1/1/1"
check "nested: perf's verdict fails (exit 1) one more frame than Samples + the disabled state's frames + 2 in any enabled state, naming it" \
  "$perf_frames_summary" " covered-idle=1/1/1 covered-busy=1/1/1 topbar-hidden-covered=1/1/1 visible-busy=1/1/1"
covered_idle_breach_needle="covered-idle-frames: covered-idle drew 6 frames, more than the disabled state's 2 frames"
covered_idle_breach_needle+=" plus 3"
check "nested: perf's verdict fails (exit 1) covered-idle at one more frame than the disabled state's frames + 3, naming it" \
  "$(perf_breach_verdict 0 "$PERF_VERDICT_EDGE_MAJORS 6 30 0 ALWAYS" "$covered_idle_breach_needle")" "1/1/1"
hidden_paint_breach_needle="hidden-topbar-paints: topbar-hidden-covered painted the top bar while it was hidden"
hidden_paint_breach_needle+=" (top-bar paints 1, allowed 0)"
check "nested: perf's verdict fails (exit 1) one top-bar paint while the top bar is hidden, naming it" \
  "$(perf_breach_verdict 2 "$PERF_VERDICT_EDGE_MAJORS 34 30 1 ALWAYS" "$hidden_paint_breach_needle")" "1/1/1"
check "nested: perf's verdict fails (exit 1) a card whose offscreen redirect is not ALWAYS in any enabled state, naming it" \
  "$perf_redirect_summary" " covered-idle=1/1/1 covered-busy=1/1/1 topbar-hidden-covered=1/1/1 visible-busy=1/1/1"

# Counts it cannot judge are exit 2, never a pass or a breach: a state missing,
# a count that is not a whole number, a record short or long by a field, and a
# visible-busy window in which the probe counted no frame, no Sample or no
# paint, where each must happen (a probe that is not counting reads as clean).
# perf_unjudgeable_verdict <records...> prints exit/whether it said it could not judge.
perf_unjudgeable_verdict() {
  perf_verdict_run "$@"
  printf '%s/%s' "$PERF_VERDICT_EXIT" "$(grep -c -F 'perf: could not judge the counts: ' <<<"$PERF_VERDICT_OUTPUT")"
}
PERF_VERDICT_OTHER_EDGE_RECORDS=("${PERF_VERDICT_EDGE_RECORDS[@]:1}")
perf_unjudgeable_summary="state-missing=$(perf_unjudgeable_verdict "${PERF_VERDICT_EDGE_RECORDS[@]:0:3}")"
perf_unjudgeable_summary+=" not-a-number=$(perf_unjudgeable_verdict '5 x 30 0 ALWAYS' \
  "${PERF_VERDICT_OTHER_EDGE_RECORDS[@]}")"
# A leading zero, which bash arithmetic would read as octal (08 is not a number to it).
perf_unjudgeable_summary+=" leading-zero=$(perf_unjudgeable_verdict '5 08 30 0 ALWAYS' \
  "${PERF_VERDICT_OTHER_EDGE_RECORDS[@]}")"
perf_unjudgeable_summary+=" short-record=$(perf_unjudgeable_verdict '5 5 30 ALWAYS' \
  "${PERF_VERDICT_OTHER_EDGE_RECORDS[@]}")"
perf_unjudgeable_summary+=" long-record=$(perf_unjudgeable_verdict '5 5 30 0 ALWAYS 9' \
  "${PERF_VERDICT_OTHER_EDGE_RECORDS[@]}")"
for perf_dead_counter in frames Samples paints; do
  case "$perf_dead_counter" in
    frames) perf_dead_record='5 0 30 60 ALWAYS' ;;
    Samples) perf_dead_record='5 34 0 60 ALWAYS' ;;
    paints) perf_dead_record='5 34 30 0 ALWAYS' ;;
  esac
  perf_unjudgeable_summary+=" visible-busy-no-$perf_dead_counter=$(perf_unjudgeable_verdict \
    "${PERF_VERDICT_EDGE_RECORDS[@]:0:3}" "$perf_dead_record")"
done
PERF_VERDICT_DISABLED_COUNTS=("$PERF_VERDICT_DISABLED_MAJORS" '')
perf_unjudgeable_summary+=" disabled-frames-empty=$(perf_unjudgeable_verdict "${PERF_VERDICT_EDGE_RECORDS[@]}")"
PERF_VERDICT_DISABLED_COUNTS=("$PERF_VERDICT_DISABLED_MAJORS" "$PERF_VERDICT_DISABLED_FRAMES")
check "nested: perf's verdict cannot judge (exit 2, never 0 or 1) a missing state, a count that is not a whole number, a record of the wrong length, or a visible-busy window with no frame, Sample or paint" \
  "$perf_unjudgeable_summary" \
  "state-missing=2/1 not-a-number=2/1 leading-zero=2/1 short-record=2/1 long-record=2/1 visible-busy-no-frames=2/1 visible-busy-no-Samples=2/1 visible-busy-no-paints=2/1 disabled-frames-empty=2/1"

# What a probe answer must show before perf takes the request for done: a JSON
# object, no refusal, and the mode the request ran in (.attached after an
# attach, .mode after a read) the one expected. An answer lost on the way (empty,
# null) must fail at the attach, not nine minutes later at the verdict. Each case
# prints the check's status; only the four real answers succeed. This row runs
# the real jq (the stub is only for runs of the script): without jq it fails.
# perf_probe_answer_status <request> <expected mode> <answer> prints the check's status.
perf_probe_answer_status() {
  nested_call is_successful_perf_probe_answer "$1" "$2" "$3" 2>/dev/null
  printf '%s' "$?"
}
PERF_ENABLED_READ_ANSWER='{"mode":"enabled","frames":2,"samples":3,"topbarPaints":3,"cardRedirect":"ALWAYS"}'
perf_answer_summary="attached-enabled=$(perf_probe_answer_status attach-enabled enabled \
  '{"attached":"enabled","reattached":true}')"
perf_answer_summary+=" attached-disabled=$(perf_probe_answer_status attach-disabled disabled \
  '{"attached":"disabled","counts":"frames only: with the extension disabled there is no client"}')"
perf_answer_summary+=" read-enabled=$(perf_probe_answer_status read enabled "$PERF_ENABLED_READ_ANSWER")"
perf_answer_summary+=" read-disabled=$(perf_probe_answer_status read disabled '{"mode":"disabled","frames":1}')"
perf_answer_summary+=" empty=$(perf_probe_answer_status attach-enabled enabled '')"
perf_answer_summary+=" null=$(perf_probe_answer_status attach-enabled enabled 'null')"
perf_answer_summary+=" empty-object=$(perf_probe_answer_status attach-enabled enabled '{}')"
perf_answer_summary+=" other-mode=$(perf_probe_answer_status attach-enabled enabled '{"attached":"disabled"}')"
perf_answer_summary+=" read-with-attach-sign=$(perf_probe_answer_status read enabled '{"attached":"enabled"}')"
perf_answer_summary+=" read-other-mode=$(perf_probe_answer_status read disabled "$PERF_ENABLED_READ_ANSWER")"
perf_answer_summary+=" refused=$(perf_probe_answer_status attach-enabled enabled \
  '{"refused":"missing the card","missing":["card"]}')"
perf_answer_summary+=" not-an-object=$(perf_probe_answer_status attach-enabled enabled '"enabled"')"
perf_empty_answer_output="$(nested_call is_successful_perf_probe_answer attach-enabled enabled '' 2>&1)"
perf_answer_summary+=" says-why=$(grep -c -F 'shows no sign that it ran' <<<"$perf_empty_answer_output")"
check "nested: perf takes a probe answer for done only when it shows the mode it ran in; an empty, null, refused or other answer fails at once (needs jq)" \
  "$perf_answer_summary" \
  "attached-enabled=0 attached-disabled=0 read-enabled=0 read-disabled=0 empty=1 null=1 empty-object=1 other-mode=1 read-with-attach-sign=1 read-other-mode=1 refused=1 not-an-object=1 says-why=1"

# perf takes an enabled state's counts only when the probe's two facts, read at
# the end of its window, show the state set up as it is named: the card covered
# (not visible) in the three covered states and visible in visible-busy; the top
# bar's indicator unmapped in topbar-hidden-covered and mapped in the other three.
# A window that did not maximize or minimize, or a top bar not hidden or not shown
# again, would otherwise report its counts under the wrong name. A mismatch is
# exit 2, naming the state and what was expected, with no line of readings: never
# a pass and never a breach. So is a fact that is not true or false (null, or the
# string "false"). Each case prints exit/its needle's count/the state's readings
# lines, from record_perf_state on a read answer with in-budget counts. This row
# runs the real jq: without it, it fails.
PERF_SETUP_ANSWER_COUNTS='"mode":"enabled","frames":34,"samples":30,"topbarPaints":30,"cardRedirect":"ALWAYS"'
# perf_setup_verdict <state> <isCardVisible, as JSON> <isIndicatorMapped, as JSON> <needle> prints the case.
perf_setup_verdict() {
  local setup_state="$1" setup_needle="$4" setup_answer setup_output setup_exit
  setup_answer="{$PERF_SETUP_ANSWER_COUNTS,\"isCardVisible\":$2,\"isIndicatorMapped\":$3}"
  setup_output="$(nested_call record_perf_state "$setup_state" "$setup_answer" 2>&1)"
  setup_exit=$?
  printf '%s/%s/%s' "$setup_exit" "$(grep -c -F "$setup_needle" <<<"$setup_output")" \
    "$(grep -c -F "$setup_state: cpu=" <<<"$setup_output")"
}
# perf_setup_mismatch_needle <state> <what was expected, and found> prints the line a mismatch must print.
perf_setup_mismatch_needle() { printf 'perf: could not measure %s: it was not set up as named: %s' "$1" "$2"; }
PERF_SETUP_PROBLEM_NEEDLE='perf: could not measure'
PERF_SETUP_CARD_COVERED_MISMATCH='expected the card covered (not visible), and it counts as visible'
PERF_SETUP_CARD_VISIBLE_MISMATCH='expected the card visible, and it counts as covered'
PERF_SETUP_INDICATOR_UNMAPPED_MISMATCH='expected the top bar indicator unmapped (hidden), and it is mapped'
PERF_SETUP_INDICATOR_MAPPED_MISMATCH='expected the top bar indicator mapped (shown), and it is unmapped'
PERF_SETUP_NOT_A_FACT_NEEDLE="perf: could not measure covered-busy: the probe's facts are not true or false"
perf_setup_summary="set-up:"
perf_setup_summary+=" $(perf_setup_verdict covered-idle false true "$PERF_SETUP_PROBLEM_NEEDLE")"
perf_setup_summary+=" $(perf_setup_verdict covered-busy false true "$PERF_SETUP_PROBLEM_NEEDLE")"
perf_setup_summary+=" $(perf_setup_verdict topbar-hidden-covered false false "$PERF_SETUP_PROBLEM_NEEDLE")"
perf_setup_summary+=" $(perf_setup_verdict visible-busy true true "$PERF_SETUP_PROBLEM_NEEDLE")"
perf_setup_summary+=" card-visible-while-covered:"
perf_setup_summary+=" $(perf_setup_verdict covered-idle true true \
  "$(perf_setup_mismatch_needle covered-idle "$PERF_SETUP_CARD_COVERED_MISMATCH")")"
perf_setup_summary+=" $(perf_setup_verdict covered-busy true true \
  "$(perf_setup_mismatch_needle covered-busy "$PERF_SETUP_CARD_COVERED_MISMATCH")")"
perf_setup_summary+=" $(perf_setup_verdict topbar-hidden-covered true false \
  "$(perf_setup_mismatch_needle topbar-hidden-covered "$PERF_SETUP_CARD_COVERED_MISMATCH")")"
perf_setup_summary+=" card-covered-in-visible-busy:"
perf_setup_summary+=" $(perf_setup_verdict visible-busy false true \
  "$(perf_setup_mismatch_needle visible-busy "$PERF_SETUP_CARD_VISIBLE_MISMATCH")")"
perf_setup_summary+=" indicator-mapped-while-hidden:"
perf_setup_summary+=" $(perf_setup_verdict topbar-hidden-covered false true \
  "$(perf_setup_mismatch_needle topbar-hidden-covered "$PERF_SETUP_INDICATOR_UNMAPPED_MISMATCH")")"
perf_setup_summary+=" indicator-unmapped-while-shown:"
perf_setup_summary+=" $(perf_setup_verdict covered-idle false false \
  "$(perf_setup_mismatch_needle covered-idle "$PERF_SETUP_INDICATOR_MAPPED_MISMATCH")")"
perf_setup_summary+=" $(perf_setup_verdict covered-busy false false \
  "$(perf_setup_mismatch_needle covered-busy "$PERF_SETUP_INDICATOR_MAPPED_MISMATCH")")"
perf_setup_summary+=" $(perf_setup_verdict visible-busy true false \
  "$(perf_setup_mismatch_needle visible-busy "$PERF_SETUP_INDICATOR_MAPPED_MISMATCH")")"
perf_setup_summary+=" not-a-fact:"
perf_setup_summary+=" $(perf_setup_verdict covered-busy null true "$PERF_SETUP_NOT_A_FACT_NEEDLE")"
perf_setup_summary+=" $(perf_setup_verdict covered-busy '"false"' true "$PERF_SETUP_NOT_A_FACT_NEEDLE")"
expected_perf_setup_summary="set-up: 0/0/1 0/0/1 0/0/1 0/0/1 card-visible-while-covered: 2/1/0 2/1/0 2/1/0"
expected_perf_setup_summary+=" card-covered-in-visible-busy: 2/1/0 indicator-mapped-while-hidden: 2/1/0"
expected_perf_setup_summary+=" indicator-unmapped-while-shown: 2/1/0 2/1/0 2/1/0 not-a-fact: 2/1/0 2/1/0"
check "nested: perf takes an enabled state's counts only when the probe shows it set up as named (the card covered in the covered states and visible in visible-busy, the indicator unmapped only in topbar-hidden-covered); a mismatch, or a fact that is not true or false, is exit 2 naming the state and what was expected (needs jq)" \
  "$perf_setup_summary" "$expected_perf_setup_summary"

# Every nested run draws the cockpit's grid, so after each enabled state's read
# perf asks the probe's read-cockpit for the grid's facts at the end of the
# window: the card ids that can be seen, the ids the layer draws (null with no
# layer), each part's offscreen redirect, and the fallback timeouts armed. Its
# answer is taken for done like a read's: the enabled mode, and no refusal.
# This row runs the real jq.
PERF_COCKPIT_DESIGNED_REDIRECTS_JSON='{"layer":"NONE","system":"NONE","apps":"ALWAYS","connections":"ALWAYS","sessions":"ALWAYS"}'
PERF_GRID_CARD_IDS_JSON='["apps","connections","sessions","system"]'
PERF_READ_COCKPIT_ANSWER="{\"mode\":\"enabled\",\"visibleCardIds\":[],\"layerCardIds\":$PERF_GRID_CARD_IDS_JSON,"
PERF_READ_COCKPIT_ANSWER+="\"cockpitRedirects\":$PERF_COCKPIT_DESIGNED_REDIRECTS_JSON,\"armedCockpitTimers\":[]}"
perf_cockpit_answer_summary="read-cockpit=$(perf_probe_answer_status read-cockpit enabled "$PERF_READ_COCKPIT_ANSWER")"
perf_cockpit_answer_summary+=" attach-sign=$(perf_probe_answer_status read-cockpit enabled '{"attached":"enabled"}')"
perf_cockpit_answer_summary+=" disabled-mode=$(perf_probe_answer_status read-cockpit enabled '{"mode":"disabled","frames":1}')"
perf_cockpit_answer_summary+=" refused=$(perf_probe_answer_status read-cockpit enabled \
  '{"refused":"cannot read the cockpit facts","missing":["layerPacing"]}')"
check "nested: perf takes a read-cockpit answer for done only when it shows the enabled mode; an attach's sign, another mode or a refusal fails at once (needs jq)" \
  "$perf_cockpit_answer_summary" "read-cockpit=0 attach-sign=1 disabled-mode=1 refused=1"

# Every nested run serves the fixture, so an enabled state is set up as named
# only when the layer draws the fixture's cards (no layer is no grid drawn, and
# a part of it is not the grid either), no card of it can be seen in the
# covered states, and every one in visible-busy. A mismatch, or facts that are
# not of their types, is exit 2 naming the state and what was expected, with no
# grid line: never a pass and never a breach. Each case prints exit/its
# needle's count/the state's grid lines, from record_perf_cockpit_state. The
# fixture's cards perf expects are the checkout fixture's own: its layout's ids
# that this release draws, as check cockpit's grid step reads them. This row
# runs the real jq.
# perf_cockpit_setup_verdict <state> <visibleCardIds JSON> <layerCardIds JSON> <needle> prints the case.
perf_cockpit_setup_verdict() {
  local setup_redirects_json="$PERF_COCKPIT_DESIGNED_REDIRECTS_JSON" setup_answer setup_output setup_exit
  [[ "$3" == null ]] && setup_redirects_json=null
  setup_answer="{\"mode\":\"enabled\",\"visibleCardIds\":$2,\"layerCardIds\":$3,"
  setup_answer+="\"cockpitRedirects\":$setup_redirects_json,\"armedCockpitTimers\":[]}"
  setup_output="$(nested_call record_perf_cockpit_state "$1" "$setup_answer" 2>&1)"
  setup_exit=$?
  printf '%s/%s/%s' "$setup_exit" "$(grep -c -F "$4" <<<"$setup_output")" "$(grep -c -F "$1: grid " <<<"$setup_output")"
}
PERF_COCKPIT_SETUP_NOT_SET_UP='it was not set up as named:'
PERF_COCKPIT_GRID_SEEN_WHILE_COVERED="perf: could not measure covered-busy: it was not set up as named: expected no card"
PERF_COCKPIT_GRID_SEEN_WHILE_COVERED+=" of the grid visible, and sessions can be seen"
PERF_COCKPIT_GRID_PART_COVERED="perf: could not measure visible-busy: it was not set up as named: expected every card"
PERF_COCKPIT_GRID_PART_COVERED+=" it draws visible (apps,connections,sessions,system), and only apps,system can be seen"
PERF_COCKPIT_NONE_SEEN="perf: could not measure visible-busy: it was not set up as named: expected every card it"
PERF_COCKPIT_NONE_SEEN+=" draws visible (apps,connections,sessions,system), and none can be seen"
PERF_COCKPIT_NO_GRID="perf: could not measure covered-idle: it was not set up as named: expected the layer to draw"
PERF_COCKPIT_NO_GRID+=" the fixture's cards (apps,connections,sessions,system), and there is no layer: no grid is drawn"
PERF_COCKPIT_PART_DRAWN="perf: could not measure covered-busy: it was not set up as named: expected the layer to draw"
PERF_COCKPIT_PART_DRAWN+=" the fixture's cards (apps,connections,sessions,system), and it draws apps,system"
PERF_COCKPIT_NOT_OF_TYPES="perf: could not measure covered-busy: the probe's cockpit facts are not of their types"
perf_cockpit_setup_summary="set-up:"
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict covered-idle '[]' "$PERF_GRID_CARD_IDS_JSON" \
  "$PERF_COCKPIT_SETUP_NOT_SET_UP")"
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict covered-busy '[]' "$PERF_GRID_CARD_IDS_JSON" \
  "$PERF_COCKPIT_SETUP_NOT_SET_UP")"
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict topbar-hidden-covered '[]' "$PERF_GRID_CARD_IDS_JSON" \
  "$PERF_COCKPIT_SETUP_NOT_SET_UP")"
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict visible-busy "$PERF_GRID_CARD_IDS_JSON" \
  "$PERF_GRID_CARD_IDS_JSON" "$PERF_COCKPIT_SETUP_NOT_SET_UP")"
perf_cockpit_setup_summary+=" grid-seen-while-covered: $(perf_cockpit_setup_verdict covered-busy '["sessions"]' \
  "$PERF_GRID_CARD_IDS_JSON" "$PERF_COCKPIT_GRID_SEEN_WHILE_COVERED")"
perf_cockpit_setup_summary+=" grid-partly-covered: $(perf_cockpit_setup_verdict visible-busy '["apps","system"]' \
  "$PERF_GRID_CARD_IDS_JSON" "$PERF_COCKPIT_GRID_PART_COVERED")"
# The whole grid drawn and none of it seen: perf's uncover did not land.
perf_cockpit_setup_summary+=" none-seen: $(perf_cockpit_setup_verdict visible-busy '[]' "$PERF_GRID_CARD_IDS_JSON" \
  "$PERF_COCKPIT_NONE_SEEN")"
perf_cockpit_setup_summary+=" no-grid: $(perf_cockpit_setup_verdict covered-idle '[]' null "$PERF_COCKPIT_NO_GRID")"
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict visible-busy '["system"]' null "$PERF_COCKPIT_SETUP_NOT_SET_UP")"
perf_cockpit_setup_summary+=" part-drawn: $(perf_cockpit_setup_verdict covered-busy '[]' '["apps","system"]' \
  "$PERF_COCKPIT_PART_DRAWN")"
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict visible-busy '["apps","system"]' '["apps","system"]' \
  "$PERF_COCKPIT_SETUP_NOT_SET_UP")"
perf_cockpit_setup_summary+=" not-of-types: $(perf_cockpit_setup_verdict covered-busy '"none"' \
  "$PERF_GRID_CARD_IDS_JSON" "$PERF_COCKPIT_NOT_OF_TYPES")"
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict covered-busy '[]' '"apps"' "$PERF_COCKPIT_NOT_OF_TYPES")"
# Numbers, which jq's join would write out as words: only the type check refuses them.
perf_cockpit_setup_summary+=" $(perf_cockpit_setup_verdict covered-busy '[1]' "$PERF_GRID_CARD_IDS_JSON" \
  "$PERF_COCKPIT_NOT_OF_TYPES")"
# perf_fixture_grid_word prints "same" when perf's expected cards are what the checkout's fixture lays out of the cards
# this release draws (check cockpit's GRID_OPTIONS_JQ over it), else both.
perf_fixture_grid_word() {
  # shellcheck disable=SC2016  # Expanded by the child bash.
  bash -c '
    source "$1" || exit 99
    fixture_word="$(jq -r --argjson known "$COCKPIT_KNOWN_CARD_IDS_JSON" "$GRID_OPTIONS_JQ | .expectedCardIds | join(\",\")" \
      "$COCKPIT_FIXTURE_TEMPLATE")" || exit 99
    if [[ "$fixture_word" == "$PERF_FIXTURE_GRID_CARD_IDS_WORD" ]]; then printf same
    else printf "%s, not %s" "$PERF_FIXTURE_GRID_CARD_IDS_WORD" "$fixture_word"; fi
  ' fixture-grid "$NESTED_SCRIPT"
}
perf_cockpit_setup_summary+=" fixture-cards=$(perf_fixture_grid_word)"
check "nested: perf takes an enabled state's grid as set up only when the layer draws the fixture's cards (no layer, or a part of them, is no grid), no card of it can be seen in the covered states and every one in visible-busy (none seen there is an uncover that did not land); a mismatch, or facts not of their types, is exit 2 naming the state and what was expected (needs jq)" \
  "$perf_cockpit_setup_summary" \
  "set-up: 0/0/1 0/0/1 0/0/1 0/0/1 grid-seen-while-covered: 2/1/0 grid-partly-covered: 2/1/0 none-seen: 2/1/0 no-grid: 2/1/0 2/1/0 part-drawn: 2/1/0 2/1/0 not-of-types: 2/1/0 2/1/0 2/1/0 fixture-cards=same"

# perf on a card-alone run (--no-cockpit): an enabled state is set up as named only with no grid, and a grid is exit 2
# naming the state and what it draws. Its end judges the counts and the one cockpit budget the card has with no grid,
# the fallback timers (the cover check's fallback is the card's own): the cockpit line says the grid's budgets were
# not judged, and perf's status is the worse of the count verdict's and the fallback verdict's. A cockpit run with no
# grid record could not judge the cockpit (exit 2).
# card_alone_setup_of <state> <grid word>: check_perf_card_alone_setup's exit/whether it named the state and the grid.
card_alone_setup_of() {
  local setup_output
  setup_output="$(nested_call check_perf_card_alone_setup "$1" "$2" 2>&1)"
  printf '%s/%s' "$?" "$(grep -c -F "perf: could not measure $1: it was not set up as named: expected no layer, since the run started no cockpit service (--no-cockpit), and it draws '$2'" <<<"$setup_output")"
}
PERF_GRID_NOT_JUDGED_LINE="perf: cockpit: the grid's budgets not judged: the run started no cockpit service (--no-cockpit), so no state drew a grid"
# perf_judge_of <card alone: true|false> <fallback words, space-separated> <enabled records...>: judge_perf_run on the
# edge disabled counts, those records, those fallbacks and no grid record; prints exit/count PASS/grid not judged/
# fallbacks PASS/fallbacks FAIL/could not judge the cockpit or the fallbacks.
perf_judge_of() {
  local judge_output judge_exit
  # shellcheck disable=SC2016  # Expanded by the child bash.
  judge_output="$(bash -c 'source "$1" || exit 99; PERF_IS_CARD_ALONE="$2"; read -r -a PERF_CARD_ALONE_FALLBACK_RECORDS <<<"$3"
    PERF_DISABLED_MAJOR_COLLECTIONS="$4"; PERF_DISABLED_FRAMES="$5"; shift 5; PERF_ENABLED_STATE_RECORDS=("$@")
    PERF_COCKPIT_STATE_RECORDS=(); judge_perf_run' \
    perf-judge "$NESTED_SCRIPT" "$1" "$2" "$PERF_VERDICT_DISABLED_MAJORS" "$PERF_VERDICT_DISABLED_FRAMES" "${@:3}" 2>&1)"
  judge_exit=$?
  printf '%s/%s/%s/%s/%s/%s' "$judge_exit" "$(grep -c -F 'perf: PASS: every count within its budget' <<<"$judge_output")" \
    "$(grep -c -x -F "$PERF_GRID_NOT_JUDGED_LINE" <<<"$judge_output")" \
    "$(grep -c -x -F 'perf: fallbacks: PASS: no fallback armed while Samples flowed' <<<"$judge_output")" \
    "$(grep -c -x -F 'perf: fallbacks: FAIL: 1 budget broken: fallback-timers: visible-busy found cover-fallback armed while Samples flowed: each is one-shot, armed only with the sampler silent' <<<"$judge_output")" \
    "$(grep -c -E '^perf: could not judge the (cockpit|fallbacks): ' <<<"$judge_output")"
}
PERF_CARD_ALONE_BREACH_RECORDS=("${PERF_VERDICT_EDGE_RECORDS[@]}")
PERF_CARD_ALONE_BREACH_RECORDS[0]="$PERF_VERDICT_EDGE_MAJORS 6 30 0 ALWAYS"
PERF_NO_FALLBACKS='none none none none'
card_alone_summary="no-grid=$(card_alone_setup_of covered-idle no-grid) grid=$(card_alone_setup_of visible-busy apps,system)"
card_alone_summary+=" empty=$(card_alone_setup_of covered-busy '')"
card_alone_summary+=" card-alone=$(perf_judge_of true "$PERF_NO_FALLBACKS" "${PERF_VERDICT_EDGE_RECORDS[@]}")"
card_alone_summary+=" card-alone-armed=$(perf_judge_of true 'none none none cover-fallback' "${PERF_VERDICT_EDGE_RECORDS[@]}")"
card_alone_summary+=" card-alone-breach=$(perf_judge_of true "$PERF_NO_FALLBACKS" "${PERF_CARD_ALONE_BREACH_RECORDS[@]}")"
card_alone_summary+=" fallbacks-missing=$(perf_judge_of true 'none' "${PERF_VERDICT_EDGE_RECORDS[@]}")"
card_alone_summary+=" cockpit-run=$(perf_judge_of false '' "${PERF_VERDICT_EDGE_RECORDS[@]}")"
check "nested: perf takes a card-alone run's enabled state as set up only with no grid (a grid is exit 2 naming the state and what it draws), and judges such a run by its counts and its fallback timers, saying the grid's budgets were not judged" \
  "$card_alone_summary" \
  "no-grid=0/0 grid=2/1 empty=2/1 card-alone=0/1/1/1/0/0 card-alone-armed=1/1/1/0/1/0 card-alone-breach=1/0/1/1/0/0 fallbacks-missing=2/1/1/0/0/1 cockpit-run=2/1/0/0/0/1"

# perf's cockpit verdict, a pure function of each enabled state's record
# "<redirects> <armed fallbacks>": the layer and the system cell's wrapper draw
# through no texture of their own, each data card through its own,
# and no fallback timeout is armed while Samples flow (each is one-shot, armed
# only with the sampler silent). Records in perf's order: covered-idle,
# covered-busy, topbar-hidden-covered, visible-busy.
PERF_COCKPIT_DESIGNED_REDIRECTS='layer:NONE,system:NONE,apps:ALWAYS,connections:ALWAYS,sessions:ALWAYS'
PERF_COCKPIT_DESIGNED_RECORDS=("$PERF_COCKPIT_DESIGNED_REDIRECTS none" "$PERF_COCKPIT_DESIGNED_REDIRECTS none"
  "$PERF_COCKPIT_DESIGNED_REDIRECTS none" "$PERF_COCKPIT_DESIGNED_REDIRECTS none")
# perf_cockpit_verdict_case <state index> <record> <needle> runs the verdict with one state's record replaced, and
# prints exit/needle count/whether the line names exactly one broken budget.
perf_cockpit_verdict_case() {
  local -a case_records=("${PERF_COCKPIT_DESIGNED_RECORDS[@]}")
  local case_output case_exit
  case_records[$1]="$2"
  case_output="$(nested_call perf_cockpit_verdict "${case_records[@]}" 2>&1)"
  case_exit=$?
  printf '%s/%s/%s' "$case_exit" "$(grep -c -F "$3" <<<"$case_output")" \
    "$(grep -c -F 'perf: cockpit: FAIL: 1 cockpit budget broken: ' <<<"$case_output")"
}
perf_cockpit_pass_output="$(nested_call perf_cockpit_verdict "${PERF_COCKPIT_DESIGNED_RECORDS[@]}" 2>&1)"
perf_cockpit_verdict_summary="designed=$?/$(wc -l <<<"$perf_cockpit_pass_output")/$(grep -c -F 'perf: cockpit: PASS: ' \
  <<<"$perf_cockpit_pass_output")"
perf_cockpit_verdict_summary+=" data-card=$(perf_cockpit_verdict_case 1 \
  'layer:NONE,system:NONE,apps:1,connections:ALWAYS,sessions:ALWAYS none' \
  "cockpit-redirect: covered-busy found apps's offscreen redirect 1, not ALWAYS")"
perf_cockpit_verdict_summary+=" system-wrapper=$(perf_cockpit_verdict_case 3 \
  'layer:NONE,system:ALWAYS,apps:ALWAYS,connections:ALWAYS,sessions:ALWAYS none' \
  "cockpit-redirect: visible-busy found system's offscreen redirect ALWAYS, not NONE")"
perf_cockpit_verdict_summary+=" layer=$(perf_cockpit_verdict_case 0 \
  'layer:ALWAYS,system:NONE,apps:ALWAYS,connections:ALWAYS,sessions:ALWAYS none' \
  "cockpit-redirect: covered-idle found layer's offscreen redirect ALWAYS, not NONE")"
perf_cockpit_verdict_summary+=" armed=$(perf_cockpit_verdict_case 3 "$PERF_COCKPIT_DESIGNED_REDIRECTS layer-pacing-fallback" \
  'fallback-timers: visible-busy found layer-pacing-fallback armed while Samples flowed')"
# perf_cockpit_unjudgeable <records...> prints exit/whether it said it could not judge.
perf_cockpit_unjudgeable() {
  local unjudgeable_output
  unjudgeable_output="$(nested_call perf_cockpit_verdict "$@" 2>&1)"
  printf '%s/%s' "$?" "$(grep -c -F 'perf: could not judge the cockpit: ' <<<"$unjudgeable_output")"
}
PERF_COCKPIT_OTHER_RECORDS=("${PERF_COCKPIT_DESIGNED_RECORDS[@]:1}")
perf_cockpit_verdict_summary+=" state-missing=$(perf_cockpit_unjudgeable "${PERF_COCKPIT_DESIGNED_RECORDS[@]:0:3}")"
perf_cockpit_verdict_summary+=" one-word=$(perf_cockpit_unjudgeable "$PERF_COCKPIT_DESIGNED_REDIRECTS" \
  "${PERF_COCKPIT_OTHER_RECORDS[@]}")"
perf_cockpit_verdict_summary+=" unknown-part=$(perf_cockpit_unjudgeable \
  'layer:NONE,system:NONE,weather:ALWAYS none' "${PERF_COCKPIT_OTHER_RECORDS[@]}")"
perf_cockpit_verdict_summary+=" not-a-pair=$(perf_cockpit_unjudgeable 'layer:NONE,system none' \
  "${PERF_COCKPIT_OTHER_RECORDS[@]}")"
# A grid record that reads no grid, or no redirect for one part, judges nothing of it: never a pass.
PERF_COCKPIT_NO_GRID_RECORD_NEEDLE='perf: could not judge the cockpit: covered-idle drew no grid'
PERF_COCKPIT_NO_SESSIONS_NEEDLE='perf: could not judge the cockpit: covered-idle'"'"'s record reads no redirect for sessions'
PERF_COCKPIT_NO_LAYER_NEEDLE='perf: could not judge the cockpit: covered-idle'"'"'s record reads no redirect for layer'
# perf_cockpit_unjudgeable_naming <needle> <records...> prints exit/whether that reason was given.
perf_cockpit_unjudgeable_naming() {
  local unjudgeable_needle="$1" unjudgeable_output
  shift
  unjudgeable_output="$(nested_call perf_cockpit_verdict "$@" 2>&1)"
  printf '%s/%s' "$?" "$(grep -c -F "$unjudgeable_needle" <<<"$unjudgeable_output")"
}
perf_cockpit_verdict_summary+=" no-grid=$(perf_cockpit_unjudgeable_naming "$PERF_COCKPIT_NO_GRID_RECORD_NEEDLE" \
  'no-grid none' "${PERF_COCKPIT_OTHER_RECORDS[@]}")"
perf_cockpit_verdict_summary+=" armed-with-no-grid=$(perf_cockpit_unjudgeable_naming \
  "$PERF_COCKPIT_NO_GRID_RECORD_NEEDLE" 'no-grid cover-fallback' "${PERF_COCKPIT_OTHER_RECORDS[@]}")"
perf_cockpit_verdict_summary+=" no-sessions=$(perf_cockpit_unjudgeable_naming "$PERF_COCKPIT_NO_SESSIONS_NEEDLE" \
  'layer:NONE,system:NONE,apps:ALWAYS,connections:ALWAYS none' "${PERF_COCKPIT_OTHER_RECORDS[@]}")"
perf_cockpit_verdict_summary+=" no-layer=$(perf_cockpit_unjudgeable_naming "$PERF_COCKPIT_NO_LAYER_NEEDLE" \
  'system:NONE,apps:ALWAYS,connections:ALWAYS,sessions:ALWAYS none' "${PERF_COCKPIT_OTHER_RECORDS[@]}")"
check "nested: perf's cockpit verdict passes (exit 0, one line) the grid's redirects as wanted and no armed fallback, and fails (exit 1) a data card not drawn through its texture, a wrapper or layer drawn through one, or an armed fallback, naming it; a record it cannot read, one with no grid or with no redirect for a part, is exit 2" \
  "$perf_cockpit_verdict_summary" \
  "designed=0/1/1 data-card=1/1/1 system-wrapper=1/1/1 layer=1/1/1 armed=1/1/1 state-missing=2/1 one-word=2/1 unknown-part=2/1 not-a-pair=2/1 no-grid=2/1 armed-with-no-grid=2/1 no-sessions=2/1 no-layer=2/1"

# perf ends with both verdicts, each its own line, and the worse status: a
# broken budget (1) before a count or a record it could not judge (2), and
# either before a pass (0). Run on the readings' globals as perf leaves them.
# perf_run_judgement <count records: "edge" or "breach" or "unjudgeable"> <cockpit records: "designed" or "armed" or
# "unjudgeable"> prints exit/its lines.
perf_run_judgement() {
  # shellcheck disable=SC2016  # Expanded by the child bash.
  bash -c '
    source "$1" || exit 99
    PERF_DISABLED_MAJOR_COLLECTIONS=4
    PERF_DISABLED_FRAMES=2
    case "$2" in
      edge) PERF_ENABLED_STATE_RECORDS=("5 5 30 0 ALWAYS" "5 34 30 30 ALWAYS" "5 34 30 0 ALWAYS" "5 34 30 60 ALWAYS") ;;
      breach) PERF_ENABLED_STATE_RECORDS=("5 5 30 0 ALWAYS" "6 34 30 30 ALWAYS" "5 34 30 0 ALWAYS" "5 34 30 60 ALWAYS") ;;
      unjudgeable) PERF_ENABLED_STATE_RECORDS=("5 5 30 0 ALWAYS") ;;
    esac
    designed="layer:NONE,system:NONE,apps:ALWAYS,connections:ALWAYS,sessions:ALWAYS"
    case "$3" in
      designed) PERF_COCKPIT_STATE_RECORDS=("$designed none" "$designed none" "$designed none" "$designed none") ;;
      armed) PERF_COCKPIT_STATE_RECORDS=("$designed none" "$designed none" "$designed none" "$designed cover-fallback") ;;
      unjudgeable) PERF_COCKPIT_STATE_RECORDS=("$designed none") ;;
    esac
    judgement_output="$(judge_perf_run)"
    judgement_exit=$?
    printf "%s/%s" "$judgement_exit" "$(grep -c -E "^perf: (PASS|FAIL|could not judge the counts)" <<<"$judgement_output")"
    printf "+%s" "$(grep -c -E "^perf: (cockpit: (PASS|FAIL)|could not judge the cockpit)" <<<"$judgement_output")"
  ' perf-judgement "$NESTED_SCRIPT" "$1" "$2"
}
perf_judgement_summary="both-pass=$(perf_run_judgement edge designed)"
perf_judgement_summary+=" counts-breach=$(perf_run_judgement breach designed)"
perf_judgement_summary+=" cockpit-breach=$(perf_run_judgement edge armed)"
perf_judgement_summary+=" breach-and-unjudgeable=$(perf_run_judgement breach unjudgeable)"
perf_judgement_summary+=" unjudgeable-and-breach=$(perf_run_judgement unjudgeable armed)"
perf_judgement_summary+=" unjudgeable-counts=$(perf_run_judgement unjudgeable designed)"
perf_judgement_summary+=" unjudgeable-cockpit=$(perf_run_judgement edge unjudgeable)"
check "nested: perf prints its count verdict and its cockpit verdict and exits with the worse: a broken budget (1) before a verdict it could not judge (2), either before a pass (0)" \
  "$perf_judgement_summary" \
  "both-pass=0/1+1 counts-breach=1/1+1 cockpit-breach=1/1+1 breach-and-unjudgeable=1/1+1 unjudgeable-and-breach=1/1+1 unjudgeable-counts=2/1+1 unjudgeable-cockpit=2/1+1"

# Each enabled state's grid facts are read after its counts, at the end of the
# window, with no eval during it; the disabled state has no grid to read. One
# state measured with every step stubbed: the probe's requests in order, and
# how many grid records each state left.
# perf_measure_requests <state> <scenario> prints the probe's requests, then the number of grid records.
PERF_MEASURE_REQUESTS="$WIRING_TMP/perf-measure-requests"
perf_measure_requests() {
  : >"$PERF_MEASURE_REQUESTS"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  bash -c '
    source "$1" || exit 99
    requests_path="$2"
    read_cockpit_answer="$4"
    request_perf_scenario() { :; }
    run_perf_step() { :; }
    sleep() { :; }
    measure_perf_window() { PERF_WINDOW_CPU_PERCENT=1.000; PERF_WINDOW_TICK_MEDIAN_MS=1.000; PERF_WINDOW_MAJOR_COLLECTIONS=1; }
    run_perf_probe() {
      printf "%s " "$2" >>"$requests_path"
      case "$2" in
        attach-disabled) printf "%s\n" "{\"attached\":\"disabled\"}" ;;
        attach-enabled) printf "%s\n" "{\"attached\":\"enabled\",\"reattached\":true}" ;;
        read) printf "%s\n" "{\"mode\":\"$3\",\"frames\":3,\"samples\":30,\"topbarPaints\":30,\"cardRedirect\":\"ALWAYS\",\"isCardVisible\":false,\"isIndicatorMapped\":true}" ;;
        read-cockpit) printf "%s\n" "$read_cockpit_answer" ;;
      esac
    }
    measure_perf_state /nonexistent-run unix:path=/nonexistent 1 "$3" busy >/dev/null 2>&1
    printf "%s" "$(<"$requests_path")"
    printf "records=%s" "${#PERF_COCKPIT_STATE_RECORDS[@]}"
  ' perf-measure "$NESTED_SCRIPT" "$PERF_MEASURE_REQUESTS" "$1" "$PERF_READ_COCKPIT_ANSWER"
}
check "nested: perf reads each enabled state's grid (read-cockpit) after its counts, and the disabled state's not at all" \
  "covered-busy=[$(perf_measure_requests covered-busy)] disabled=[$(perf_measure_requests disabled)]" \
  "covered-busy=[attach-enabled read read-cockpit records=1] disabled=[attach-disabled read records=0]"

# The same state in a card-alone run (PERF_IS_CARD_ALONE): with no grid, measure_perf_state keeps no grid record and
# the state's armed fallbacks for the fallback verdict; with a grid it stops with exit 2, naming the state, and keeps
# nothing. Without the card-alone setup check, a --no-cockpit run drawing a grid would pass as the card alone.
PERF_CARD_ALONE_ANSWER='{"mode":"enabled","visibleCardIds":[],"layerCardIds":null,"cockpitRedirects":null,'
PERF_CARD_ALONE_ANSWER+='"armedCockpitTimers":["cover-fallback"]}'
PERF_CARD_ALONE_GRID_NEEDLE='perf: could not measure covered-busy: it was not set up as named: expected no layer'
# perf_card_alone_measure_of <read-cockpit answer> prints measure_perf_state's exit in a card-alone run, then the grid
# records it kept, the fallbacks it kept, and whether it named the state drawing a grid.
perf_card_alone_measure_of() {
  local measure_output
  # shellcheck disable=SC2016  # Expanded by the child bash.
  measure_output="$(bash -c '
    source "$1" || exit 99
    read_cockpit_answer="$2"
    PERF_IS_CARD_ALONE=true
    request_perf_scenario() { :; }
    run_perf_step() { :; }
    sleep() { :; }
    measure_perf_window() { PERF_WINDOW_CPU_PERCENT=1.000; PERF_WINDOW_TICK_MEDIAN_MS=1.000; PERF_WINDOW_MAJOR_COLLECTIONS=1; }
    run_perf_probe() {
      case "$2" in
        attach-enabled) printf "%s\n" "{\"attached\":\"enabled\",\"reattached\":true}" ;;
        read) printf "%s\n" "{\"mode\":\"$3\",\"frames\":3,\"samples\":30,\"topbarPaints\":30,\"cardRedirect\":\"ALWAYS\",\"isCardVisible\":false,\"isIndicatorMapped\":true}" ;;
        read-cockpit) printf "%s\n" "$read_cockpit_answer" ;;
      esac
    }
    trap '"'"'printf "exit=%s grid-records=%s fallbacks=[%s]" "$?" "${#PERF_COCKPIT_STATE_RECORDS[@]}" "${PERF_CARD_ALONE_FALLBACK_RECORDS[*]}"'"'"' EXIT
    measure_perf_state /nonexistent-run unix:path=/nonexistent 1 covered-busy busy
  ' perf-card-alone-measure "$NESTED_SCRIPT" "$1" 2>&1)"
  printf '%s named=%s' "$(grep -o -E 'exit=[0-9]+ grid-records=[0-9]+ fallbacks=\[[^]]*\]' <<<"$measure_output")" \
    "$(grep -c -F "$PERF_CARD_ALONE_GRID_NEEDLE" <<<"$measure_output")"
}
check "nested: in a card-alone run perf keeps an enabled state's armed fallbacks and no grid record when it draws no grid, and stops with exit 2, naming the state, when it draws one" \
  "no-grid=[$(perf_card_alone_measure_of "$PERF_CARD_ALONE_ANSWER")] grid=[$(perf_card_alone_measure_of "$PERF_READ_COCKPIT_ANSWER")]" \
  "no-grid=[exit=0 grid-records=0 fallbacks=[cover-fallback] named=0] grid=[exit=2 grid-records=0 fallbacks=[] named=1]"

# perf's exit (end_perf_run, its EXIT trap) on a fixture, from inside one bash
# that plays perf: two children of it stand in for the window (recorded with
# no start time, as when it could not be read) and the background measurement
# job, and busctl is the stub, which fails every call, so each restore step
# fails. Every step must still run: both children ended, and busctl asked once
# to enable the extension and once to show the top bar. A recorded window that
# is not perf's child (a process of another session) must be left alone. And
# perf installs it as its EXIT trap.
PERF_CLEANUP_ADDRESS="unix:path=$WIRING_TMP/perf-cleanup/bus/session.sock"
# perf_cleanup_verdict <own-child | the pid of a process that is not its child> prints, for the window then the
# measurement job, ended or left-running, then end_perf_run's status.
perf_cleanup_verdict() {
  : >"$NESTED_STUB_CALLS"
  # shellcheck disable=SC2016  # Expanded by the child bash, which plays perf.
  env "${LIVE_SETTINGS_BARRIER[@]}" PATH="$NESTED_STUB_BIN:$PATH" NESTED_STUB_CALLS="$NESTED_STUB_CALLS" \
    bash -c '
      source "$1" || exit 99
      sleep 300 &
      own_window_pid=$!
      sleep 300 &
      PERF_COST_JOB_PID=$!
      cost_job_pid=$PERF_COST_JOB_PID
      if [[ "$2" == own-child ]]; then PERF_WINDOW_PID=$own_window_pid; else PERF_WINDOW_PID=$2; fi
      PERF_WINDOW_STARTTIME=""
      PERF_ADDRESS="$3"
      end_perf_run 2>/dev/null
      cleanup_status=$?
      # A child ended by a signal is a zombie until reaped, which read_stat_fields does not count as running.
      process_fate() {
        local poll
        for poll in 1 2 3 4 5 6 7 8 9 10; do
          read_stat_fields /proc "$1" || { printf ended; return 0; }
          sleep 0.1
        done
        printf left-running
      }
      printf "window=%s cost-job=%s status=%s" "$(process_fate "$PERF_WINDOW_PID")" \
        "$(process_fate "$cost_job_pid")" "$cleanup_status"
      kill "$own_window_pid" "$cost_job_pid" 2>/dev/null
    ' perf-cleanup "$NESTED_SCRIPT" "$1" "$PERF_CLEANUP_ADDRESS"
}
perf_cleanup_summary="own-child: $(perf_cleanup_verdict own-child)"
perf_cleanup_summary+=" busctl=$(grep -c '^busctl ' "$NESTED_STUB_CALLS")"
perf_cleanup_summary+=" enable=$(grep -c -F 'Main.extensionManager.enableExtension(' "$NESTED_STUB_CALLS")"
perf_cleanup_summary+=" show=$(grep -c -F 'indicator?.show()' "$NESTED_STUB_CALLS")"
other_session_process_id="$(start_sacrificial_session sleep 60)"
other_session_process_starttime="$(starttime_of "$other_session_process_id")"
perf_cleanup_summary+=" not-a-child: $(perf_cleanup_verdict "$other_session_process_id")"
kill_sacrifice "$other_session_process_id" sleep "$other_session_process_starttime"
perf_cleanup_summary+=" installed=$(grep -c -x -F '    trap end_perf_run EXIT' "$NESTED_SCRIPT")"
# The line above sits in install_perf_exit_traps: perf_subcommand must call it (no other row runs perf that far).
perf_cleanup_summary+=" called-by-perf=$(awk '/^perf_subcommand\(\) \{/,/^}/' "$NESTED_SCRIPT" \
  | grep -c -x -F '    install_perf_exit_traps')"
check "nested: perf's exit ends its window (by pid when its start time is unknown, only if it is perf's child) and its measurement job, then asks to enable the extension and show the top bar, each step despite a failed one; perf installs it" \
  "$perf_cleanup_summary" \
  "own-child: window=ended cost-job=ended status=0 busctl=2 enable=1 show=1 not-a-child: window=left-running cost-job=ended status=0 installed=1 called-by-perf=1"

# perf's header names the run's monitor size and scale, since the guide's figures are for the default size at scale 1.
# Read from scratch runs:
# perf itself never gets that far in this table.
PERF_HEADER_RUN="$WIRING_TMP/perf-header-run"
# perf_header_of [run.values lines...]: perf_header_line of a scratch run recording those lines, or exit-<status>.
perf_header_of() {
  rm -rf "$PERF_HEADER_RUN"
  mkdir -p "$PERF_HEADER_RUN/state" || fatal "cannot create $PERF_HEADER_RUN"
  printf '%s\n' "$@" >"$PERF_HEADER_RUN/state/run.values" || fatal "cannot write $PERF_HEADER_RUN's run values"
  nested_call perf_header_line "$PERF_HEADER_RUN" 4242 || printf 'exit-%s' "$?"
}
PERF_CARD_ALONE_HEADER_NEEDLE=', monitor 3072x1920 at scale 1; the card alone, no cockpit service (--no-cockpit); each state:'
check "nested: perf's header names the run's monitor size and scale, the defaults with none recorded, and the card alone in a run started with --no-cockpit" \
  "default=$(perf_header_of | grep -c -F ', monitor 3072x1920 at scale 1; each state: its scenario,') recorded=$(perf_header_of monitor-size=1536x960 | grep -c -F ', monitor 1536x960 at scale 1; each state: its scenario,') scaled=$(perf_header_of monitor-size=3840x2160 monitor-scale=2 | grep -c -F ', monitor 3840x2160 at scale 2; each state: its scenario,') not-a-scale=$(perf_header_of 'monitor-scale=2;id') card-alone=$(perf_header_of no-cockpit=1 | grep -c -F "$PERF_CARD_ALONE_HEADER_NEEDLE") cockpit-run=$(perf_header_of | grep -c -F 'the card alone')" \
  "default=1 recorded=1 scaled=1 not-a-scale=exit-1 card-alone=1 cockpit-run=0"

# This table's own total. The guide states it.
EXPECTED_ROWS=32

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
