#!/usr/bin/env bash
#
# scripts/test-resource-pulse-nested-runs.sh
# ==========================================
#
# State table for the Resource Pulse nested-shell harness (scripts/resource-pulse-nested.sh), second of four: stop,
# start and the run start prepares. stop's and the supervisor's sweep of a session; start's base directory,
# options and records; the run's cockpit fixture; its two buses, its environment allowlist, fake-gdm.js and the
# replay service; the unsafe-mode helper and the nested settings; the in-bus stage and the services it starts; the
# sampler program's build and the cargo-target-dir helper; stop of the services; the fixture's rewrite; the
# check's log reader; and probe-window.js's refusals. Nothing is started for real: every service, tool and
# session a row runs is a stand-in or a sacrificial session of its own.
#
# "Could not run" is exit 2, never a pass: a missing gjs, find, timeout, setsid or jq, or a fixture that could not
# be laid out, is fatal. The table asserts its own row total.
#
# Its shared helpers and constants are scripts/resource-pulse-table-lib.sh's, and the nested harness's fixtures
# (its stubs, its run directories, the sacrificial sessions, the fake gnome-shell)
# scripts/resource-pulse-nested-table-lib.sh's.
#
# Requires: bash, gjs, find, timeout, setsid (util-linux) and jq. No network, no gnome-shell.
#
# Usage: scripts/test-resource-pulse-nested-runs.sh

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

require_tools gjs find timeout setsid jq
start_nested_harness

printf '\nresource-pulse-nested.sh stop, start and the run it prepares (hermetic: no gnome-shell, nothing is started)\n'
# `stop` signals a session only while its leader is this run's recorded
# launcher, `timeout`: a session id is a pid, and once a run's processes are all
# gone another session can take the same id. Each case below runs `stop` on a
# fixture run against a sacrificial session, so even a mutant can only ever
# signal a session made for the row.
# (1) A session led by something else (a reused id): `stop` must leave it
# running, and just clean the run up.
reused_session_id="$(start_sacrificial_session sleep 60)"
reused_session_starttime="$(starttime_of "$reused_session_id")"
REUSED_RUN="$NESTED_BASE/rpn.Reused01"
make_run_dir "$REUSED_RUN" "launcher=$reused_session_id" "launcher-starttime=$reused_session_starttime" \
  "session=$reused_session_id" "supervisor=$reused_session_id" "supervisor-starttime=$reused_session_starttime" \
  "gnome-shell=$reused_session_id" "gnome-shell-starttime=$reused_session_starttime"
NESTED_RUN_DIR="$REUSED_RUN" nested_run stop
reused_summary="exit=$NESTED_EXIT left-running=$(is_running "$reused_session_id" && printf yes || printf no)"
reused_summary+=" stopped=$([[ -e "$REUSED_RUN/state/stopped" ]] && printf yes || printf no)"
kill_sacrifice "$reused_session_id" sleep "$reused_session_starttime"
check "nested: stop leaves a session alone once its leader is not the run's timeout (a reused id), and cleans up" \
  "$reused_summary" "exit=0 left-running=yes stopped=yes"
# (2) A session still led by the run's timeout: `stop` must end all of it.
timeout_session_id="$(start_sacrificial_session timeout 60 sleep 60)"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ "$(cat "/proc/$timeout_session_id/comm" 2>/dev/null)" == timeout ]] && break
  sleep 0.1
done
timeout_session_starttime="$(starttime_of "$timeout_session_id")"
TIMEOUT_RUN="$NESTED_BASE/rpn.Timeout1"
# Recorded as the run's gnome-shell too, so `stop` sends its first SIGTERM to it (timeout passes it on to its child).
make_run_dir "$TIMEOUT_RUN" "launcher=$timeout_session_id" "launcher-starttime=$timeout_session_starttime" \
  "session=$timeout_session_id" "supervisor=$timeout_session_id" "supervisor-starttime=$timeout_session_starttime" \
  "gnome-shell=$timeout_session_id" "gnome-shell-starttime=$timeout_session_starttime"
NESTED_RUN_DIR="$TIMEOUT_RUN" nested_run stop
timeout_summary="exit=$NESTED_EXIT leader-running=$(is_running "$timeout_session_id" && printf yes || printf no)"
timeout_summary+=" session-empty=$([[ -z "$(nested_call pids_in_session /proc "$timeout_session_id")" ]] && printf yes || printf no)"
check "nested: stop ends a session still led by the run's recorded timeout" "$timeout_summary" \
  "exit=0 leader-running=no session-empty=yes"
# Whatever stop did, nothing of the sacrificial session outlives the row (timeout passes the TERM to its child).
kill_sacrifice "$timeout_session_id" timeout "$timeout_session_starttime"
# (3) The caller's own session, and a session id of 1: refused, nothing signalled.
# The caller runs inside a sandbox session led by `timeout` and recorded as the
# launcher, so only the refusal stands between `stop` and that session.
OWN_RUN="$NESTED_BASE/rpn.OwnSess1"
make_run_dir "$OWN_RUN"
cat >"$SACRIFICE_DIR/stop-own-session.sh" <<'SANDBOX'
#!/bin/bash
# Records this sandbox's own session (led by its parent, timeout) as the run's, then runs `stop` from inside it.
run_dir="$1" script="$2"
read -r stat_line <"/proc/$$/stat"
read -r -a stat_fields <<<"${stat_line##*) }"
read -r parent_stat_line <"/proc/$PPID/stat"
read -r -a parent_stat_fields <<<"${parent_stat_line##*) }"
printf 'launcher=%s\nlauncher-starttime=%s\nsession=%s\nsupervisor=%s\nsupervisor-starttime=%s\n' "$PPID" \
  "${parent_stat_fields[19]}" "${stat_fields[3]}" "$PPID" "${parent_stat_fields[19]}" >"$run_dir/state/run.values"
RESOURCE_PULSE_NESTED_DIR="$run_dir" bash "$script" stop
printf 'stop-exit=%s\n' "$?"
SANDBOX
own_session_output="$(setsid timeout 60 bash "$SACRIFICE_DIR/stop-own-session.sh" "$OWN_RUN" "$NESTED_SCRIPT" 2>&1)"
SESSION_ONE_RUN="$NESTED_BASE/rpn.SessOne1"
make_run_dir "$SESSION_ONE_RUN" "launcher=1" "session=1" "supervisor=1"
NESTED_RUN_DIR="$SESSION_ONE_RUN" nested_run stop
refusal_summary="own-session=$(grep -c -x -F 'stop-exit=2' <<<"$own_session_output")/$(grep -c -F "the caller's own session" <<<"$own_session_output")"
refusal_summary+=" session-1=$NESTED_EXIT/$(grep -c -F 'a session id must be above 1' <<<"$NESTED_OUTPUT")"
check "nested: stop refuses the caller's own session and session 1, signalling nothing" \
  "$refusal_summary" "own-session=1/1 session-1=2/1"
# (4) Bash reads a script as it runs it: a run's supervisor waits inside main
# for up to 20 minutes, so the script must exit before reading past main, or an
# edit made meanwhile would run. A copy with a line appended after main must
# never reach that line.
SCRIPT_COPY="$WIRING_TMP/script-copy/scripts/resource-pulse-nested.sh"
mkdir -p "${SCRIPT_COPY%/*}" && cp "$NESTED_SCRIPT" "$SCRIPT_COPY"
printf 'printf "READ-PAST-MAIN\\n" >&2\n' >>"$SCRIPT_COPY"
ENDED_COPY_RUN="$NESTED_BASE/rpn.CopyRun1"
make_run_dir "$ENDED_COPY_RUN" "launcher=$NEVER_RUNNING_PID" "session=$NEVER_RUNNING_PID"
copy_output="$(RESOURCE_PULSE_NESTED_DIR="$ENDED_COPY_RUN" bash "$SCRIPT_COPY" stop 2>&1)"
copy_exit=$?
check "nested: the script exits before reading past main, so an edit made while a run waits never runs" \
  "$copy_exit:$(grep -c -F 'READ-PAST-MAIN' <<<"$copy_output")" "0:0"
rm -rf "$REUSED_RUN" "$TIMEOUT_RUN" "$OWN_RUN" "$SESSION_ONE_RUN" "$ENDED_COPY_RUN"

# The supervisor's exit sweep runs inside the session it sweeps, so it must not
# count itself (or a subshell of itself) as a member left behind: in a sandbox
# session with one child, the sweep must find the session empty and return 0,
# and mark the run ended.
SWEEP_RUN="$NESTED_BASE/rpn.Sweep001"
make_run_dir "$SWEEP_RUN"
cat >"$SACRIFICE_DIR/sweep-own-session.sh" <<'SANDBOX'
#!/bin/bash
# Leads its own session (setsid), starts one child, then runs the supervisor's exit sweep from inside it.
script="$1" run_dir="$2"
source "$script" || exit 99
sleep 60 &
child_pid=$!
session_id="$(session_id_of_process /proc "$$")"
signal_session "$session_id" TERM 1 "$$" "$PPID"
printf 'signal-exit=%s\n' "$?"
end_supervised_session "$run_dir" "$session_id"
printf 'child-running=%s\n' "$(kill -0 "$child_pid" 2>/dev/null && [[ "$(cut -d' ' -f3 "/proc/$child_pid/stat" 2>/dev/null)" != Z ]] && echo yes || echo no)"
SANDBOX
sweep_output="$(setsid bash "$SACRIFICE_DIR/sweep-own-session.sh" "$NESTED_SCRIPT" "$SWEEP_RUN" 2>&1)"
sweep_summary="$(grep -x -E 'signal-exit=[0-9]+|child-running=(yes|no)' <<<"$sweep_output" | tr '\n' ' ')"
sweep_summary+="ended=$([[ -e "$SWEEP_RUN/state/ended" ]] && printf yes || printf no)"
sweep_summary+=" outlived-note=$(grep -c -F 'outlived SIGKILL' <<<"$sweep_output")"
check "nested: the supervisor's exit sweep sees its own session empty, returns 0 and marks the run ended" \
  "$sweep_summary" "signal-exit=0 child-running=no ended=yes outlived-note=0"
rm -rf "$SWEEP_RUN"

# A base directory others can read would make run directories discoverable.
PUBLIC_BASE="$WIRING_TMP/public-base-named-longer-than-any-run-directory-may-be"
mkdir -p "$PUBLIC_BASE" && chmod 755 "$PUBLIC_BASE"
: >"$NESTED_STUB_CALLS"
public_base_output="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" PATH="$NESTED_STUB_BIN:$PATH" \
  NESTED_STUB_CALLS="$NESTED_STUB_CALLS" RESOURCE_PULSE_NESTED_BASE="$PUBLIC_BASE" \
  bash "$NESTED_SCRIPT" start 2>&1)"
public_base_exit=$?
check "nested: start refuses a base directory others can read, before making anything" \
  "$public_base_exit:$(grep -c -F 'is not private' <<<"$public_base_output"):$(find "$PUBLIC_BASE" -mindepth 1 | wc -l):$(nested_stub_call_count)" \
  "2:1:0:0"

# `start` against that public base: options it accepts reach its first refusal
# (the base is not private), and options it does not are a usage error before
# it. Each case prints exit/its own message/whether it reached that refusal.
# start_options_verdict <needle> <options...>
start_options_verdict() {
  local start_needle="$1" start_options_output start_options_exit
  shift
  start_options_output="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" PATH="$NESTED_STUB_BIN:$PATH" \
    NESTED_STUB_CALLS="$NESTED_STUB_CALLS" RESOURCE_PULSE_NESTED_BASE="$PUBLIC_BASE" \
    bash "$NESTED_SCRIPT" start "$@" 2>&1)"
  start_options_exit=$?
  printf '%s/%s/%s' "$start_options_exit" "$(grep -c -F -e "$start_needle" <<<"$start_options_output")" \
    "$(grep -c -F 'is not private' <<<"$start_options_output")"
}
: >"$NESTED_STUB_CALLS"
start_options_summary="both=$(start_options_verdict 'usage:' --gc-log --replay)"
start_options_summary+=" reversed=$(start_options_verdict 'usage:' --replay --gc-log)"
start_options_summary+=" gc-log=$(start_options_verdict 'usage:' --gc-log)"
start_options_summary+=" replay=$(start_options_verdict 'usage:' --replay)"
start_options_summary+=" twice=$(start_options_verdict 'start takes --gc-log at most once' --gc-log --replay --gc-log)"
start_options_summary+=" unknown=$(start_options_verdict "start takes only --gc-log, --replay, --monitor-size <width>x<height> and --monitor-scale <scale>, got: '--verbose'" --verbose)"
start_options_summary+=" extra=$(start_options_verdict "start takes only --gc-log, --replay, --monitor-size <width>x<height> and --monitor-scale <scale>, got: 'now'" --replay now)"
start_options_summary+=" size=$(start_options_verdict 'usage:' --monitor-size 1536x960)"
start_options_summary+=" size-among=$(start_options_verdict 'usage:' --replay --monitor-size 1536x960 --gc-log)"
start_options_summary+=" scale=$(start_options_verdict 'usage:' --monitor-scale 2)"
start_options_summary+=" scale-among=$(start_options_verdict 'usage:' --monitor-scale 2 --replay --monitor-size 3840x2160)"
start_options_summary+=" created=$(find "$PUBLIC_BASE" -mindepth 1 | wc -l) stub-calls=$(nested_stub_call_count)"
check "nested: start takes --gc-log, --replay, --monitor-size <width>x<height> and --monitor-scale <scale> in any order, each once; anything else is a usage error (exit 2) before anything runs" \
  "$start_options_summary" \
  "both=2/0/1 reversed=2/0/1 gc-log=2/0/1 replay=2/0/1 twice=2/1/0 unknown=2/1/0 extra=2/1/0 size=2/0/1 size-among=2/0/1 scale=2/0/1 scale-among=2/0/1 created=0 stub-calls=0"

# --monitor-size's refusals: each a usage error naming the value, before the base is looked at; both bounds taken.
NOT_WHOLE_PIXELS="--monitor-size takes <width>x<height> in whole pixels, got:"
OUT_OF_BOUNDS="--monitor-size takes a size from 640x480 to 7680x4320, got:"
: >"$NESTED_STUB_CALLS"
monitor_size_summary="missing=$(start_options_verdict '--monitor-size takes <width>x<height>, got nothing' --monitor-size)"
monitor_size_summary+=" twice=$(start_options_verdict 'start takes --monitor-size at most once' --monitor-size 1536x960 --monitor-size 1536x960)"
monitor_size_summary+=" option-as-value=$(start_options_verdict "$NOT_WHOLE_PIXELS '--replay'" --monitor-size --replay)"
monitor_size_summary+=" no-height=$(start_options_verdict "$NOT_WHOLE_PIXELS '1536x'" --monitor-size 1536x)"
monitor_size_summary+=" leading-zero=$(start_options_verdict "$NOT_WHOLE_PIXELS '01536x960'" --monitor-size 01536x960)"
monitor_size_summary+=" capital-x=$(start_options_verdict "$NOT_WHOLE_PIXELS '1536X960'" --monitor-size 1536X960)"
monitor_size_summary+=" three-parts=$(start_options_verdict "$NOT_WHOLE_PIXELS '1536x960x2'" --monitor-size 1536x960x2)"
monitor_size_summary+=" command=$(start_options_verdict "$NOT_WHOLE_PIXELS '1536x960;id'" --monitor-size '1536x960;id')"
monitor_size_summary+=" overlong=$(start_options_verdict "$NOT_WHOLE_PIXELS '99999999999999999999x960'" --monitor-size 99999999999999999999x960)"
monitor_size_summary+=" too-narrow=$(start_options_verdict "$OUT_OF_BOUNDS '639x480'" --monitor-size 639x480)"
monitor_size_summary+=" too-short=$(start_options_verdict "$OUT_OF_BOUNDS '640x479'" --monitor-size 640x479)"
monitor_size_summary+=" too-wide=$(start_options_verdict "$OUT_OF_BOUNDS '7681x4320'" --monitor-size 7681x4320)"
monitor_size_summary+=" too-tall=$(start_options_verdict "$OUT_OF_BOUNDS '7680x4321'" --monitor-size 7680x4321)"
monitor_size_summary+=" least=$(start_options_verdict 'usage:' --monitor-size 640x480)"
monitor_size_summary+=" most=$(start_options_verdict 'usage:' --monitor-size 7680x4320)"
monitor_size_summary+=" created=$(find "$PUBLIC_BASE" -mindepth 1 | wc -l) stub-calls=$(nested_stub_call_count)"
check "nested: start refuses a monitor size that is missing, given twice, not <width>x<height> in whole pixels or outside 640x480 to 7680x4320 (exit 2) before anything runs, and takes both bounds" \
  "$monitor_size_summary" \
  "missing=2/1/0 twice=2/1/0 option-as-value=2/1/0 no-height=2/1/0 leading-zero=2/1/0 capital-x=2/1/0 three-parts=2/1/0 command=2/1/0 overlong=2/1/0 too-narrow=2/1/0 too-short=2/1/0 too-wide=2/1/0 too-tall=2/1/0 least=2/0/1 most=2/0/1 created=0 stub-calls=0"

# --monitor-scale's refusals: each a usage error naming the value, before the base is looked at; both bounds taken,
# and a fractional scale written as Mutter lists it.
SCALE_RULE="--monitor-scale takes a decimal from 1 to 4 with at most 7 decimal places, got:"
: >"$NESTED_STUB_CALLS"
monitor_scale_summary="missing=$(start_options_verdict '--monitor-scale takes <scale>, got nothing' --monitor-scale)"
monitor_scale_summary+=" twice=$(start_options_verdict 'start takes --monitor-scale at most once' --monitor-scale 2 --monitor-scale 2)"
monitor_scale_summary+=" option-as-value=$(start_options_verdict "$SCALE_RULE '--replay'" --monitor-scale --replay)"
monitor_scale_summary+=" below=$(start_options_verdict "$SCALE_RULE '0.5'" --monitor-scale 0.5)"
monitor_scale_summary+=" above=$(start_options_verdict "$SCALE_RULE '4.5'" --monitor-scale 4.5)"
monitor_scale_summary+=" five=$(start_options_verdict "$SCALE_RULE '5'" --monitor-scale 5)"
monitor_scale_summary+=" comma=$(start_options_verdict "$SCALE_RULE '1,5'" --monitor-scale 1,5)"
monitor_scale_summary+=" too-precise=$(start_options_verdict "$SCALE_RULE '1.33333333'" --monitor-scale 1.33333333)"
monitor_scale_summary+=" command=$(start_options_verdict "$SCALE_RULE '2;id'" --monitor-scale '2;id')"
monitor_scale_summary+=" least=$(start_options_verdict 'usage:' --monitor-scale 1)"
monitor_scale_summary+=" most=$(start_options_verdict 'usage:' --monitor-scale 4)"
monitor_scale_summary+=" fractional=$(start_options_verdict 'usage:' --monitor-scale 1.3333334)"
monitor_scale_summary+=" created=$(find "$PUBLIC_BASE" -mindepth 1 | wc -l) stub-calls=$(nested_stub_call_count)"
check "nested: start refuses a monitor scale that is missing, given twice, or not a decimal from 1 to 4 with at most 7 decimal places (exit 2) before anything runs, and takes both bounds and a fractional scale as Mutter lists it" \
  "$monitor_scale_summary" \
  "missing=2/1/0 twice=2/1/0 option-as-value=2/1/0 below=2/1/0 above=2/1/0 five=2/1/0 comma=2/1/0 too-precise=2/1/0 command=2/1/0 least=2/0/1 most=2/0/1 fractional=2/0/1 created=0 stub-calls=0"

# What `start` records for its options, where the in-bus stage and `scenario`
# read them: the run's state/run.values. (Run here on a scratch run directory:
# `start` itself never gets as far as recording them in this suite.)
START_VALUES_RUN="$WIRING_TMP/start-values"
# recorded_start_values <options...> prints the values recorded for these options, space-separated.
recorded_start_values() {
  rm -rf "$START_VALUES_RUN"
  mkdir -p "$START_VALUES_RUN/state" && : >"$START_VALUES_RUN/state/run.values"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  bash -c 'source "$1" || exit 99; run_dir="$2"; shift 2
    parse_start_options "$@" && record_requested_start_options "$run_dir"' \
    start-values "$NESTED_SCRIPT" "$START_VALUES_RUN" "$@" || printf 'exit-%s ' "$?"
  tr '\n' ' ' <"$START_VALUES_RUN/state/run.values"
}
check "nested: start records gc-log=1, replay=1, monitor-size=<size> and monitor-scale=<scale> in state/run.values for the options given, and nothing for the others" \
  "both=[$(recorded_start_values --replay --gc-log)] gc-log=[$(recorded_start_values --gc-log)] replay=[$(recorded_start_values --replay)] size=[$(recorded_start_values --monitor-size 1536x960)] scale=[$(recorded_start_values --monitor-scale 2)] all=[$(recorded_start_values --monitor-scale 1.5 --replay --monitor-size 1536x960 --gc-log)] none=[$(recorded_start_values)]" \
  "both=[replay=1 gc-log=1 ] gc-log=[gc-log=1 ] replay=[replay=1 ] size=[monitor-size=1536x960 ] scale=[monitor-scale=2 ] all=[replay=1 gc-log=1 monitor-size=1536x960 monitor-scale=1.5 ] none=[]"

# `start` writes the run's cockpit fixture, which the cockpit service serves in
# fixture mode (it never asks herdr): the checkout's nested-state.json with
# every source stamped now and its interval the run's lifetime (a source is
# stale only past three intervals, so never within the run), no window
# candidates, a copy kept as written, the path recorded; the checkout's file is
# never written. Run here on a scratch run directory: `start` itself never gets
# that far in this suite. This row runs the real jq.
FIXTURE_WRITE_RUN="$WIRING_TMP/fixture-write-run"
FIXTURE_WRITE_NOW_USEC=1800000000123456
FIXTURE_WRITE_LIFETIME_SECONDS=3600
FIXTURE_WRITE_PATH="$FIXTURE_WRITE_RUN/state/cockpit-fixture.json"
fixture_template_sum_before="$(sha256sum <"$COCKPIT_NESTED_FIXTURE")"
if ! mkdir -p "$FIXTURE_WRITE_RUN/state" || ! : >"$FIXTURE_WRITE_RUN/state/run.values"; then
  fatal "cannot lay out $FIXTURE_WRITE_RUN"
fi
nested_call write_run_cockpit_fixture "$FIXTURE_WRITE_RUN" "$FIXTURE_WRITE_LIFETIME_SECONDS" "$FIXTURE_WRITE_NOW_USEC"
fixture_write_summary="exit=$?"
fixture_write_summary+=" stamps=$(jq -c '[.state.sources[].sampledAtUsec] | unique' "$FIXTURE_WRITE_PATH" 2>&1)"
fixture_write_summary+=" intervals=$(jq -c '[.state.sources[].intervalSeconds] | unique' "$FIXTURE_WRITE_PATH" 2>&1)"
fixture_write_summary+=" sources=$(jq -c '.state.sources | keys' "$FIXTURE_WRITE_PATH" 2>&1)"
fixture_write_summary+=" candidates=$(jq -c '.focusReply.windowPidCandidates' "$FIXTURE_WRITE_PATH" 2>&1)"
fixture_write_summary+=" rest-kept=$(jq -n --slurpfile written "$FIXTURE_WRITE_PATH" --slurpfile template \
  "$COCKPIT_NESTED_FIXTURE" '$written[0].state.layout == $template[0].state.layout
    and $written[0].state.sources.sessions.rows == $template[0].state.sources.sessions.rows
    and $written[0].focusReply.focused == $template[0].focusReply.focused' 2>&1)"
fixture_write_summary+=" start-copy=$(cmp -s "$FIXTURE_WRITE_PATH" "$FIXTURE_WRITE_RUN/state/cockpit-fixture.start.json" \
  && printf same || printf differs)"
fixture_write_summary+=" recorded=$(grep -c -x -F "cockpit-fixture=$FIXTURE_WRITE_PATH" "$FIXTURE_WRITE_RUN/state/run.values")"
fixture_write_summary+=" template=$([[ "$(sha256sum <"$COCKPIT_NESTED_FIXTURE")" == "$fixture_template_sum_before" ]] \
  && printf unchanged || printf written)"
fixture_write_summary+=" private=$(stat -c %a "$FIXTURE_WRITE_PATH" 2>&1)"
fixture_write_summary+=" now=$(nested_call current_time_usec | grep -c -x -E '[1-9][0-9]{15}')"
# The layout writes it (a layout it cannot write fails), and start lays out every run with its own lifetime.
# shellcheck disable=SC2016  # Needles: the script's own lines, read as text.
fixture_write_summary+=" laid-out=$(grep -c -x -F '    write_run_cockpit_fixture "$run_dir" "$lifetime_seconds" "$now_usec"' \
  "$NESTED_SCRIPT")/$(grep -c -x -F '    if ! prepare_run_directory "$run_dir" "$run_suffix" "$lifetime_seconds" ||' \
  "$NESTED_SCRIPT")"
check "nested: start writes the run's cockpit fixture from nested-state.json: every source stamped now, its interval the run's lifetime, no window candidates, a copy kept as written, the path recorded; the checkout's file untouched (needs jq)" \
  "$fixture_write_summary" \
  "exit=0 stamps=[1800000000123456] intervals=[3600] sources=[\"mounts\",\"network\",\"sessions\"] candidates=[] rest-kept=true start-copy=same recorded=1 template=unchanged private=600 now=1 laid-out=1/1"

# The sampler program's file name, and the run's copy of it, which start copies the built program to and the in-bus
# stage starts: pinned here, not read from the script.
SAMPLER_ENTRY_FILE_NAME='resource-pulse-sampler'
NESTED_SAMPLER_PROGRAM_RELATIVE_PATH="bin/$SAMPLER_ENTRY_FILE_NAME"

# The fixture reaches the cockpit service alone: started by the in-bus stage,
# the cockpit service sees RESOURCE_PULSE_COCKPIT_FIXTURE naming the run's
# fixture, the sampler service does not, and the stage itself (which becomes
# gnome-shell) keeps none. A run with no fixture recorded is refused (exit 2,
# the reason in state/refused) before the cockpit service starts. gjs is a
# stand-in that records which module it was started with, and the variable; the
# run's copy of the sampler program is one that records its own name and the
# variable.
SERVICE_START_RUN="$WIRING_TMP/service-start-run"
SERVICE_START_STUB_BIN="$WIRING_TMP/service-start-bin"
SERVICE_START_RECORDS="$WIRING_TMP/service-start-records"
# shellcheck disable=SC2016  # The stand-in's own source: its $2 and the variable expand when it runs.
install_stub "$SERVICE_START_STUB_BIN" gjs "$(printf '#!/bin/bash\nprintf "%%s:%%s\\n" "${2##*/}" "${RESOURCE_PULSE_COCKPIT_FIXTURE-unset}" >>%q' \
  "$SERVICE_START_RECORDS")"
# shellcheck disable=SC2016  # The stand-in's own source: its $0 and the variable expand when it runs.
SERVICE_START_PROGRAM_SOURCE="$(printf '#!/bin/bash\nprintf "%%s:%%s\\n" "${0##*/}" "${RESOURCE_PULSE_COCKPIT_FIXTURE-unset}" >>%q' \
  "$SERVICE_START_RECORDS")"
SERVICE_START_PROGRAM_PATH="$SERVICE_START_RUN/$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH"
# service_start_verdict <fixture recorded: yes or no> prints exit/each start the stand-in saw/the stage's variable/refused.
service_start_verdict() {
  local service_start_output service_start_exit
  if ! rm -rf "$SERVICE_START_RUN" || ! mkdir -p "$SERVICE_START_RUN/state" "$SERVICE_START_RUN/log" ||
    ! mkdir -p "${SERVICE_START_PROGRAM_PATH%/*}" || ! printf '%s\n' "$SERVICE_START_PROGRAM_SOURCE" >"$SERVICE_START_PROGRAM_PATH" ||
    ! chmod 700 "$SERVICE_START_PROGRAM_PATH"; then
    fatal "cannot lay out $SERVICE_START_RUN"
  fi
  : >"$SERVICE_START_RECORDS"
  : >"$SERVICE_START_RUN/state/run.values"
  if [[ "$1" == yes ]]; then
    : >"$SERVICE_START_RUN/state/cockpit-fixture.json"
    printf 'cockpit-fixture=%s\n' "$SERVICE_START_RUN/state/cockpit-fixture.json" >>"$SERVICE_START_RUN/state/run.values"
  fi
  # shellcheck disable=SC2016  # Expanded by the child bash.
  service_start_output="$(env -u RESOURCE_PULSE_COCKPIT_FIXTURE PATH="$SERVICE_START_STUB_BIN:$PATH" bash -c '
    source "$1" || exit 99
    wait_for_nested_service() { return 0; }
    # A refusal (refuse_run) exits the stage before the wait below, so the stage waits for the services it started
    # on every exit: the row reads their records only once they are written.
    trap wait EXIT
    start_nested_sampler "$2" && start_nested_cockpit "$2"
    wait
    printf "stage:%s" "${RESOURCE_PULSE_COCKPIT_FIXTURE-unset}"
  ' service-start "$NESTED_SCRIPT" "$SERVICE_START_RUN" 2>/dev/null)"
  service_start_exit=$?
  printf '%s/[%s]/%s/%s' "$service_start_exit" "$(LC_ALL=C sort "$SERVICE_START_RECORDS" | tr '\n' ' ')" \
    "$service_start_output" "$( [[ -e "$SERVICE_START_RUN/state/refused" ]] \
      && grep -c -F 'no cockpit fixture' "$SERVICE_START_RUN/state/refused" || printf none)"
}
service_start_summary="fixture=$(service_start_verdict yes) no-fixture=$(service_start_verdict no)"
# shellcheck disable=SC2016  # A needle: the script's own line, read as text.
service_start_summary+=" stage-starts-it=$(grep -c -x -F '    start_nested_cockpit "$run_dir"' "$NESTED_SCRIPT")"
check "nested: the run's fixture reaches the cockpit service alone (RESOURCE_PULSE_COCKPIT_FIXTURE), not the sampler nor the stage that becomes gnome-shell; a run with no fixture recorded is refused before the cockpit starts" \
  "$service_start_summary" \
  "fixture=0/[cockpit.js:$SERVICE_START_RUN/state/cockpit-fixture.json $SAMPLER_ENTRY_FILE_NAME:unset ]/stage:unset/none no-fixture=2/[$SAMPLER_ENTRY_FILE_NAME:unset ]//1 stage-starts-it=1"

nested_run screenshot ../escape.png
check "nested: a screenshot name with a / in it is refused before anything runs" \
  "$NESTED_EXIT:$(nested_stub_call_count):$(grep -c -F 'a screenshot name is a plain file name' <<<"$NESTED_OUTPUT")" "2:0:1"

# One run directory, prepared exactly as `start` prepares it but never started.
PREPARED_SUFFIX="Prep0001"
PREPARED_RUN="$WIRING_TMP/prepared/rpn.$PREPARED_SUFFIX"
mkdir -p "$PREPARED_RUN" && chmod 700 "$PREPARED_RUN"
nested_call prepare_run_directory "$PREPARED_RUN" "$PREPARED_SUFFIX"
prepare_exit=$?
SESSION_BUS_CONF="$PREPARED_RUN/bus/session-bus.conf"
SESSION_SERVICES_DIR="$PREPARED_RUN/bus/session-services"
session_bus_summary="prepare=$prepare_exit"
session_bus_summary+=" servicedirs=$(grep -c -F '<servicedir>' "$SESSION_BUS_CONF" 2>/dev/null)"
session_bus_summary+=" ours=$(grep -c -F "<servicedir>$SESSION_SERVICES_DIR</servicedir>" "$SESSION_BUS_CONF" 2>/dev/null)"
session_bus_summary+=" standard=$(grep -c -E 'standard_(session|system)_servicedirs|<include' "$SESSION_BUS_CONF" 2>/dev/null)"
session_bus_summary+=" services=$(find "$SESSION_SERVICES_DIR" -mindepth 1 -printf '%f,' 2>/dev/null)"
session_bus_summary+=" dconf=$(grep -c -x -F 'Name=ca.desrt.dconf' "$SESSION_SERVICES_DIR/ca.desrt.dconf.service" 2>/dev/null)"
check "nested: the private session bus can activate dconf and nothing else" "$session_bus_summary" \
  "prepare=0 servicedirs=1 ours=1 standard=0 services=ca.desrt.dconf.service, dconf=1"

WIDENED_SESSION_BUS_CONF="$WIRING_TMP/widened-session-bus.conf"
{ grep -v -F '</busconfig>' "$SESSION_BUS_CONF"; printf '  <standard_session_servicedirs/>\n</busconfig>\n'; } \
  >"$WIDENED_SESSION_BUS_CONF" 2>/dev/null
nested_call session_bus_config_permits_only_dconf "$SESSION_BUS_CONF" "$SESSION_SERVICES_DIR"
accepts_rendered_session_bus=$?
nested_call session_bus_config_permits_only_dconf "$WIDENED_SESSION_BUS_CONF" "$SESSION_SERVICES_DIR"
accepts_widened_session_bus=$?
check "nested: the start-time check accepts that session bus and refuses one with the standard service dirs" \
  "$accepts_rendered_session_bus:$accepts_widened_session_bus" "0:1"

SYSTEM_BUS_CONF="$PREPARED_RUN/bus/system-bus.conf"
WIDENED_SYSTEM_BUS_CONF="$WIRING_TMP/widened-system-bus.conf"
{ grep -v -F '</busconfig>' "$SYSTEM_BUS_CONF"; printf '  <standard_system_servicedirs/>\n</busconfig>\n'; } \
  >"$WIDENED_SYSTEM_BUS_CONF" 2>/dev/null
system_bus_summary="listen=$(grep -c -F "<listen>unix:path=$PREPARED_RUN/bus/system.sock</listen>" "$SYSTEM_BUS_CONF" 2>/dev/null)"
system_bus_summary+=" activatable=$(grep -c -E '<servicedir|standard_(session|system)_servicedirs|<include|<servicehelper' "$SYSTEM_BUS_CONF" 2>/dev/null)"
nested_call system_bus_config_activates_nothing "$SYSTEM_BUS_CONF"
system_bus_summary+=" check-rendered=$?"
nested_call system_bus_config_activates_nothing "$WIDENED_SYSTEM_BUS_CONF"
system_bus_summary+=" check-widened=$?"
check "nested: the fake system bus can activate nothing, and the start-time check says so" "$system_bus_summary" \
  "listen=1 activatable=0 check-rendered=0 check-widened=1"

# Both buses listen on path sockets inside the 0700 run directory: an abstract
# socket has no file permissions, so any process in the network namespace (a
# confined app included) could connect, or claim the name once the run ends.
socket_summary="session-path=$(grep -c -F "<listen>unix:path=$PREPARED_RUN/bus/session.sock</listen>" "$SESSION_BUS_CONF" 2>/dev/null)"
socket_summary+=" system-path=$(grep -c -F "<listen>unix:path=$PREPARED_RUN/bus/system.sock</listen>" "$SYSTEM_BUS_CONF" 2>/dev/null)"
socket_summary+=" abstract=$(cat "$SESSION_BUS_CONF" "$SYSTEM_BUS_CONF" 2>/dev/null | grep -c -F 'unix:abstract=')"
socket_summary+=" listens=$(cat "$SESSION_BUS_CONF" "$SYSTEM_BUS_CONF" 2>/dev/null | grep -c -F '<listen>')"
socket_summary+=" eavesdrop=$(cat "$SESSION_BUS_CONF" "$SYSTEM_BUS_CONF" 2>/dev/null | grep -c -F 'eavesdrop')"
# Without an allow-receive rule dbus-daemon rejects every reply (measured), so dropping eavesdrop needs this.
socket_summary+=" allow-receive=$(cat "$SESSION_BUS_CONF" "$SYSTEM_BUS_CONF" 2>/dev/null | grep -c -F '<allow receive_sender="*"/>')"
check "nested: both buses listen only on path sockets in the run directory, with no abstract socket or eavesdropping" \
  "$socket_summary" "session-path=1 system-path=1 abstract=0 listens=2 eavesdrop=0 allow-receive=2"

NESTED_ENVIRONMENT="$(nested_call nested_environment_assignments "$PREPARED_RUN")"
NESTED_ENVIRONMENT_NAMES="$(cut -d= -f1 <<<"$NESTED_ENVIRONMENT")"
FORBIDDEN_NESTED_NAMES_PATTERN='^(WAYLAND_DISPLAY|DISPLAY|DBUS_SESSION_BUS_ADDRESS|SSH_AUTH_SOCK)$|TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL'
check "nested: the environment allowlist names no display, no live session bus and no credential" \
  "$(grep -c -E "$FORBIDDEN_NESTED_NAMES_PATTERN" <<<"$NESTED_ENVIRONMENT_NAMES"):$(wc -l <<<"$NESTED_ENVIRONMENT_NAMES")" "0:22"

poisoned_child_environment="$(WAYLAND_DISPLAY=wayland-0 DISPLAY=:0 GH_TOKEN=poison-not-a-token \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \
  nested_call run_isolated "$PREPARED_RUN" env)"
check "nested: a process started isolated inherits none of the live display, bus or token" \
  "$(grep -c -E '^(WAYLAND_DISPLAY|DISPLAY|DBUS_SESSION_BUS_ADDRESS|GH_TOKEN)=' <<<"$poisoned_child_environment"):$(grep -c -x -F "XDG_RUNTIME_DIR=$PREPARED_RUN/run" <<<"$poisoned_child_environment")" "0:1"

dirs_outside_the_run=""
for isolated_variable in HOME TMPDIR XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR; do
  isolated_value="$(grep -E "^$isolated_variable=" <<<"$NESTED_ENVIRONMENT" | cut -d= -f2-)"
  [[ "$isolated_value" == "$PREPARED_RUN/"* ]] || dirs_outside_the_run+="$isolated_variable='$isolated_value' "
done
check "nested: HOME, TMPDIR and every XDG home and runtime dir are in the run; the system bus is the fake one" \
  "${dirs_outside_the_run:-none}:$(grep -c -x -F "DBUS_SYSTEM_BUS_ADDRESS=unix:path=$PREPARED_RUN/bus/system.sock" <<<"$NESTED_ENVIRONMENT")" "none:1"

# perf's window is a GUI process, so it must reach the nested shell and nothing
# else: started any other way it would open on the live desktop. start_perf_window
# launches a stand-in gnome-calculator (by the path perf resolves) on a prepared
# run, from a caller whose environment carries a decoy variable, a display, a
# Wayland display and an X authority. The stand-in records the names in its
# environment and the values its isolation rests on. Its names must be exactly
# the run's allowlist, the three perf adds and bash's own (PWD, SHLVL); its
# runtime dir and session bus the run's; its Wayland display the nested one.
PERF_WINDOW_RUN="$WIRING_TMP/perf-window/rpn.PerfWin1"
PERF_WINDOW_STAND_IN_DIR="$WIRING_TMP/perf-window-bin"
PERF_WINDOW_STAND_IN="$PERF_WINDOW_STAND_IN_DIR/gnome-calculator"
# What the stand-in writes, beside itself: under `env -i` no variable could name another place.
PERF_WINDOW_ENV_NAMES="$PERF_WINDOW_STAND_IN_DIR/env-names"
PERF_WINDOW_ENV_VALUES="$PERF_WINDOW_STAND_IN_DIR/env-values"
PERF_WINDOW_RUN_BUS="unix:path=$PERF_WINDOW_RUN/bus/session.sock"
if ! mkdir -p "$PERF_WINDOW_RUN" "$PERF_WINDOW_STAND_IN_DIR" || ! chmod 700 "$PERF_WINDOW_RUN" ||
  ! nested_call prepare_run_directory "$PERF_WINDOW_RUN" PerfWin1; then
  fatal "cannot prepare $PERF_WINDOW_RUN"
fi
cat >"$PERF_WINDOW_STAND_IN" <<'STAND_IN'
#!/bin/bash
# Stands in for gnome-calculator: records the names in its environment, and the values perf relies on, beside itself.
record_dir="${BASH_SOURCE[0]%/*}"
compgen -e >"$record_dir/env-names"
printf '%s\n' "XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR-unset}" "DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS-unset}" \
  "WAYLAND_DISPLAY=${WAYLAND_DISPLAY-unset}" "GDK_BACKEND=${GDK_BACKEND-unset}" >"$record_dir/env-values"
STAND_IN
chmod +x "$PERF_WINDOW_STAND_IN" || fatal "cannot make $PERF_WINDOW_STAND_IN executable"
: >"$PERF_WINDOW_ENV_NAMES"
: >"$PERF_WINDOW_ENV_VALUES"
# shellcheck disable=SC2016  # Expanded by the child bash.
env "${LIVE_SETTINGS_BARRIER[@]}" PERF_WINDOW_DECOY=decoy-must-not-arrive DISPLAY=:99 WAYLAND_DISPLAY=wayland-decoy \
  XAUTHORITY="$WIRING_TMP/decoy-xauthority" \
  bash -c 'source "$1" || exit 99; shift; start_perf_window "$@" && wait "$PERF_WINDOW_PID"' perf-window \
  "$NESTED_SCRIPT" "$PERF_WINDOW_RUN" "$PERF_WINDOW_RUN_BUS" "$PERF_WINDOW_STAND_IN"
perf_window_summary="exit=$?"
# bash exports PWD and SHLVL itself; `_` only when it inherits one, which `env -i` never gives it.
perf_window_expected_names="$( { nested_call nested_environment_assignments "$PERF_WINDOW_RUN" | cut -d= -f1
  printf '%s\n' WAYLAND_DISPLAY GDK_BACKEND DBUS_SESSION_BUS_ADDRESS PWD SHLVL
} | LC_ALL=C sort -u)"
perf_window_seen_names="$(LC_ALL=C sort -u "$PERF_WINDOW_ENV_NAMES")"
perf_window_summary+=" unexpected=[$(LC_ALL=C comm -13 <(printf '%s\n' "$perf_window_expected_names") \
  <(printf '%s\n' "$perf_window_seen_names") | tr '\n' ' ')]"
perf_window_summary+=" missing=[$(LC_ALL=C comm -23 <(printf '%s\n' "$perf_window_expected_names") \
  <(printf '%s\n' "$perf_window_seen_names") | tr '\n' ' ')]"
perf_window_summary+=" values=[$(tr '\n' ' ' <"$PERF_WINDOW_ENV_VALUES")]"
check "nested: perf's window starts with only the run's allowlist plus its Wayland display, Wayland backend and private bus: nothing of the caller's display, X authority or other variables" \
  "$perf_window_summary" \
  "exit=0 unexpected=[] missing=[] values=[XDG_RUNTIME_DIR=$PERF_WINDOW_RUN/run DBUS_SESSION_BUS_ADDRESS=$PERF_WINDOW_RUN_BUS WAYLAND_DISPLAY=rp-nested-0 GDK_BACKEND=wayland ]"

# fake_gdm_verdict <run dir or ''> <address> prints refused, or whatever else happened.
FAKE_GDM_REFUSAL='refusing to connect to anything but the fake system bus'
fake_gdm_verdict() {
  local fake_gdm_output
  fake_gdm_output="$(env -u RESOURCE_PULSE_NESTED_DIR ${1:+RESOURCE_PULSE_NESTED_DIR="$1"} \
    timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -m "$NESTED_FILES/fake-gdm.js" "$2" 2>&1)"
  if [[ "$fake_gdm_output" == *"$FAKE_GDM_REFUSAL"* ]]; then printf refused; else printf 'tried-to-connect'; fi
}
fake_gdm_summary="no-run=$(fake_gdm_verdict '' 'unix:path=/run/dbus/system_bus_socket')"
fake_gdm_summary+=" real-bus=$(fake_gdm_verdict "$PREPARED_RUN" 'unix:path=/run/dbus/system_bus_socket')"
# The run's own (absent) socket: accepted, so it tries to connect and fails there instead.
fake_gdm_summary+=" own-bus=$(fake_gdm_verdict "$PREPARED_RUN" "unix:path=$PREPARED_RUN/bus/system.sock")"
check "nested: fake-gdm.js refuses any bus but its run's fake one, before connecting" \
  "$fake_gdm_summary" "no-run=refused real-bus=refused own-bus=tried-to-connect"

# The replay service owns the real service's bus name, so it must never serve on
# any bus but its run's private one. Every address below that is not the run's
# is the barrier's dead bus, so even a broken guard reaches nothing live. A D-Bus
# address can be a list, tried in order: the run's bus followed by another one
# is not the run's bus.
REPLAY_SERVICE_REFUSAL='refusing to serve on anything but the private session bus'
REPLAY_SERVICE_CONNECT_FAILURE='cannot connect to'
REPLAY_EXTENSION_DIR="$PREPARED_RUN/data/gnome-shell/extensions/$EXTENSION_UUID"
# replay_service_verdict <run dir or ''> <session bus address> prints refused, tried-to-connect, or other.
replay_service_verdict() {
  local replay_service_output
  replay_service_output="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" \
    ${1:+RESOURCE_PULSE_NESTED_DIR="$1"} DBUS_SESSION_BUS_ADDRESS="$2" \
    timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -m "$NESTED_FILES/replay-service.js" "$REPLAY_EXTENSION_DIR" 2>&1)"
  if [[ "$replay_service_output" == *"$REPLAY_SERVICE_REFUSAL"* ]]; then printf refused
  elif [[ "$replay_service_output" == *"$REPLAY_SERVICE_CONNECT_FAILURE"* ]]; then printf tried-to-connect
  else printf other; fi
}
REPLAY_RUN_BUS="unix:path=$PREPARED_RUN/bus/session.sock"
replay_guard_summary="no-run=$(replay_service_verdict '' "$REPLAY_RUN_BUS")"
replay_guard_summary+=" other-bus=$(replay_service_verdict "$PREPARED_RUN" "$LIVE_SETTINGS_BARRIER_BUS")"
replay_guard_summary+=" address-list=$(replay_service_verdict "$PREPARED_RUN" "$REPLAY_RUN_BUS;$LIVE_SETTINGS_BARRIER_BUS")"
replay_guard_summary+=" bad-guid=$(replay_service_verdict "$PREPARED_RUN" "$REPLAY_RUN_BUS,guid=0123456789abcdef,x=1")"
# A run directory the harness could never make, with the address built from it as the bus: one that is itself an
# address list (the run's socket, then another dead one), and one outside the shell's safe-path rule (a space).
# Either would otherwise match its own address exactly.
CRAFTED_REPLAY_RUN_DIR="$PREPARED_RUN/bus/session.sock;unix:path=$WIRING_TMP/crafted-replay-run"
replay_guard_summary+=" crafted-dir=$(replay_service_verdict "$CRAFTED_REPLAY_RUN_DIR" "unix:path=$CRAFTED_REPLAY_RUN_DIR/bus/session.sock")"
UNSAFE_REPLAY_RUN_DIR="$WIRING_TMP/unsafe replay run"
replay_guard_summary+=" unsafe-dir=$(replay_service_verdict "$UNSAFE_REPLAY_RUN_DIR" "unix:path=$UNSAFE_REPLAY_RUN_DIR/bus/session.sock")"
# The run's own (absent) socket, as dbus-run-session names it: accepted, so it tries to connect and fails there.
replay_guard_summary+=" own-bus=$(replay_service_verdict "$PREPARED_RUN" "$REPLAY_RUN_BUS,guid=0123456789abcdef")"
check "nested: replay-service.js refuses any bus but its run's private session bus, and any run directory the harness could not make, before connecting" \
  "$replay_guard_summary" \
  "no-run=refused other-bus=refused address-list=refused bad-guid=refused crafted-dir=refused unsafe-dir=refused own-bus=tried-to-connect"

# The two apps whose presence makes GNOME 50 check extensions.gnome.org for
# updates (extensionSystem.js updatesSupported): masked, and copied into the run.
masked_update_apps=0
for update_app_id in org.gnome.Extensions com.mattjakeman.ExtensionManager; do
  if [[ "$(grep -c -x -F 'Hidden=true' "$NESTED_FILES/applications/$update_app_id.desktop" 2>/dev/null)" == 1 &&
        -f "$PREPARED_RUN/data/applications/$update_app_id.desktop" ]]; then
    masked_update_apps=$((masked_update_apps + 1))
  fi
done
check "nested: both apps that make the shell check extensions.gnome.org are masked in the run" "$masked_update_apps" 2

UNSAFE_MODE_HELPER_JS="$NESTED_FILES/$UNSAFE_MODE_HELPER_UUID/extension.js"
# The FIRST line that sets unsafe mode must come after the guard.
helper_guard_line="$(grep -n -m 1 -F 'if (!isInsideNestedRun())' "$UNSAFE_MODE_HELPER_JS" 2>/dev/null | cut -d: -f1)"
helper_unsafe_line="$(grep -n -m 1 -F 'global.context.unsafe_mode = true' "$UNSAFE_MODE_HELPER_JS" 2>/dev/null | cut -d: -f1)"
helper_placement="$([[ -d "$PREPARED_RUN/data/gnome-shell/extensions/$UNSAFE_MODE_HELPER_UUID" ]] && printf run)"
helper_placement+="$([[ -e "$REPO_ROOT/gnome-shell/extensions/$UNSAFE_MODE_HELPER_UUID" ]] && printf +linkable)"
check "nested: the unsafe-mode helper checks for a nested run first, and lives only in the run's data dir" \
  "$(( ${helper_guard_line:-0} > 0 && ${helper_unsafe_line:-0} > ${helper_guard_line:-0} )):$helper_placement" "1:run"

# make_fake_stat <pid> <comm> <session> writes one /proc/<pid>/stat.
NESTED_FAKE_PROC="$WIRING_TMP/nested-proc"
make_fake_stat() {
  mkdir -p "$NESTED_FAKE_PROC/$1"
  printf '%s (%s) S 1 %s %s 0 -1 4194304\n' "$1" "$2" "$1" "$3" >"$NESTED_FAKE_PROC/$1/stat"
}
make_fake_stat 500 gnome-shell 500
make_fake_stat 501 'odd) S 1 9 9 (name' 500
make_fake_stat 502 bash 777
mkdir -p "$NESTED_FAKE_PROC/503"
printf '503 (odd) S 1 9 9 (name) S 1 503 503 0 -1 4194304 1 2 3 4 5 6 7 8 20 0 1 0 98765 0 0\n' \
  >"$NESTED_FAKE_PROC/503/stat"
# What start, the supervisor and the in-bus stage call to record a process:
# it must write <name> and <name>-starttime, and then count as running.
RECORD_RUN="$WIRING_TMP/record-run"
mkdir -p "$RECORD_RUN/state"
# shellcheck disable=SC2016  # Expanded by the child bash.
recorded_check="$(bash -c 'source "$1" || exit 99; record_running_process "$2" probe "$3" &&
  is_recorded_process_running "$2" probe && printf running' record-check "$NESTED_SCRIPT" "$RECORD_RUN" "$$")"
recorded_values="$(tr '\n' ' ' <"$RECORD_RUN/state/run.values" 2>/dev/null)"
check "nested: start times are read from stat field 22, even past a comm holding ') ', as this suite reads them" \
  "fake=$(nested_call starttime_of_process "$NESTED_FAKE_PROC" 503) self=$([[ "$(nested_call starttime_of_process /proc "$$")" == "$(starttime_of "$$")" && -n "$(starttime_of "$$")" ]] && printf match || printf differs) recorded=$recorded_check values=$recorded_values" \
  "fake=98765 self=match recorded=running values=probe=$$ probe-starttime=$(starttime_of "$$") "
check "nested: the teardown sweep finds exactly the run's session, even past a comm holding ') '" \
  "$(nested_call pids_in_session "$NESTED_FAKE_PROC" 500 | sort -n | tr '\n' ' ')" "500 501 "

# GNOME 50 scans the user extension dir only while allow-extension-installation
# is on (extensionSystem.js _loadExtensions), and both extensions are copied
# there. So no nested setting may turn it off, or neither extension loads and
# `start` can never succeed. A gsettings stub that records and succeeds stands in.
NESTED_SETTINGS_STUB_BIN="$WIRING_TMP/nested-settings-bin"
NESTED_SETTINGS_CALLS="$WIRING_TMP/nested-settings-calls"
NESTED_SETTINGS_BUS_SEEN="$WIRING_TMP/nested-settings-bus-seen"
# shellcheck disable=SC2016  # The stub's own source.
install_stub "$NESTED_SETTINGS_STUB_BIN" gsettings '#!/usr/bin/env bash
printf "%s\n" "$*" >>"$NESTED_SETTINGS_CALLS"
printf "%s %s\n" "${GSETTINGS_BACKEND-unset}" "${DBUS_SESSION_BUS_ADDRESS-unset}" >>"$NESTED_SETTINGS_BUS_SEEN"'
: >"$NESTED_SETTINGS_CALLS"
: >"$NESTED_SETTINGS_BUS_SEEN"
# write_nested_settings has no guard of its own (the in-bus stage guards it), so the barrier is what stands
# between it and the live dconf should the stub ever be missing.
# shellcheck disable=SC2016  # Expanded by the child bash.
env "${LIVE_SETTINGS_BARRIER[@]}" PATH="$NESTED_SETTINGS_STUB_BIN:$PATH" NESTED_SETTINGS_CALLS="$NESTED_SETTINGS_CALLS" \
  NESTED_SETTINGS_BUS_SEEN="$NESTED_SETTINGS_BUS_SEEN" \
  bash -c 'source "$1" || exit 99; write_nested_settings' nested-settings "$NESTED_SCRIPT"
nested_settings_summary="exit=$?"
nested_settings_summary+=" enabled=$(grep -c -x -F "set org.gnome.shell enabled-extensions ['$UNSAFE_MODE_HELPER_UUID', 'resource-pulse@zvibaratz.github.io']" "$NESTED_SETTINGS_CALLS")"
nested_settings_summary+=" installation-off=$(grep -c -F 'allow-extension-installation false' "$NESTED_SETTINGS_CALLS")"
nested_settings_summary+=" barrier=$(sort -u "$NESTED_SETTINGS_BUS_SEEN" | tr '\n' ' ')"
USER_EXTENSIONS_DIR="$PREPARED_RUN/data/gnome-shell/extensions"
nested_settings_summary+=" in-user-dir=$([[ -f "$USER_EXTENSIONS_DIR/$UNSAFE_MODE_HELPER_UUID/metadata.json" && -f "$USER_EXTENSIONS_DIR/resource-pulse@zvibaratz.github.io/metadata.json" ]] && printf both || printf missing)"
check "nested: no nested setting hides the user extension dir, where both extensions are copied" \
  "$nested_settings_summary" "exit=0 enabled=1 installation-off=0 barrier=memory $LIVE_SETTINGS_BARRIER_BUS  in-user-dir=both"

# `start` polls the shell over busctl. A shell that answers with unsafe mode off
# (Eval's (false, '')) is up but the helper did not load, which must fail fast
# with its own message, not as "did not answer" after 120 s. One that answers
# with unsafe mode on is ready only once its startup is complete: until then its
# startup animation scales the stage and the extension has not placed its grid
# for good, so a request made at once reads a grid in passing. The probe asks the
# startup state (Eval evaluates only with unsafe mode on), and a stand-in busctl
# answering "still starting" shows what probe_nested_shell asks and makes of it.
probe_summary="ready=$(nested_call classify_unsafe_mode_probe 0 '{"type":"bs","data":[true,"true"]}')"
probe_summary+=" starting=$(nested_call classify_unsafe_mode_probe 0 '{"type":"bs","data":[true,"false"]}')"
probe_summary+=" unsafe-off=$(nested_call classify_unsafe_mode_probe 0 '{"type":"bs","data":[false,""]}')"
probe_summary+=" no-shell=$(nested_call classify_unsafe_mode_probe 1 'Call failed: The name org.gnome.Shell was not provided')"
PROBE_STUB_BIN="$WIRING_TMP/probe-bin"
PROBE_CALLS="$WIRING_TMP/probe-calls"
PROBE_RUN="$WIRING_TMP/probe-run"
mkdir -p "$PROBE_RUN/state" || fatal "cannot lay out $PROBE_RUN"
# shellcheck disable=SC2016  # The stub's own source.
install_stub "$PROBE_STUB_BIN" busctl '#!/usr/bin/env bash
printf "%s\n" "${@: -1}" >>"$PROBE_CALLS"
printf "%s\n" "{\"type\":\"bs\",\"data\":[true,\"false\"]}"'
: >"$PROBE_CALLS"
# shellcheck disable=SC2016  # Expanded by the child bash.
probe_state_while_starting="$(env PATH="$PROBE_STUB_BIN:$PATH" PROBE_CALLS="$PROBE_CALLS" bash -c '
  source "$1" || exit 99
  is_private_session_bus_address() { return 0; }
  is_nested_shell_live() { return 0; }
  printf "%s\n" "unix:path=$2/bus/session.sock" >"$2/state/session.addr"
  probe_nested_shell "$2"' probe "$NESTED_SCRIPT" "$PROBE_RUN")"
probe_summary+=" while-starting=$probe_state_while_starting asked=[$(tr '\n' ' ' <"$PROBE_CALLS")]"
check "nested: start tells a shell that answers with unsafe mode off from one that has not answered yet, and one still starting up (its probe asks the startup state) from one that is ready" \
  "$probe_summary" \
  "ready=ready starting=starting-up unsafe-off=unsafe-mode-off no-shell=not-answering while-starting=starting-up asked=[!Main.layoutManager._startingUp ]"

# The stage that runs inside the private bus writes settings and starts
# gnome-shell (both stubs here). It has two guards, so each call below defeats
# one of them: (a) the live environment with the run's private bus address
# claimed, and (b) the run's isolated environment with no private bus. Each
# must refuse on its own guard, writing no setting and starting no shell.
# Both run behind the barrier; (b) keeps the run's own runtime dir, which is
# already private, so that only its missing private bus is wrong.
: >"$NESTED_STUB_CALLS"
live_env_in_bus_output="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" PATH="$NESTED_STUB_BIN:$PATH" \
  NESTED_STUB_CALLS="$NESTED_STUB_CALLS" DBUS_SESSION_BUS_ADDRESS="unix:path=$PREPARED_RUN/bus/session.sock" \
  bash "$NESTED_SCRIPT" __inside-session-bus "$PREPARED_RUN" 2>&1)"
live_env_in_bus_exit=$?
no_bus_in_bus_output="$(nested_call run_isolated "$PREPARED_RUN" \
  env GSETTINGS_BACKEND=memory DBUS_SESSION_BUS_ADDRESS="$LIVE_SETTINGS_BARRIER_BUS" \
  PATH="$NESTED_STUB_BIN:/usr/bin:/bin" NESTED_STUB_CALLS="$NESTED_STUB_CALLS" \
  bash "$NESTED_SCRIPT" __inside-session-bus "$PREPARED_RUN" 2>&1)"
no_bus_in_bus_exit=$?
in_bus_summary="live-env=$live_env_in_bus_exit/$(grep -c -F 'the in-bus stage is not isolated' <<<"$live_env_in_bus_output")"
in_bus_summary+=" no-private-bus=$no_bus_in_bus_exit/$(grep -c -F "is not this run's private one" <<<"$no_bus_in_bus_output")"
in_bus_summary+=" stub-calls=$(nested_stub_call_count)"
in_bus_summary+=" address=$([[ -e "$PREPARED_RUN/state/session.addr" ]] && printf recorded || printf none)"
check "nested: the in-bus stage refuses a live environment and a missing private bus, each on its own guard" \
  "$in_bus_summary" "live-env=2/1 no-private-bus=2/1 stub-calls=0 address=none"

# The in-bus stage's service step, run for real against stubs: gsettings
# succeeds; gjs stands in for each gjs service (it records its arguments, the
# names in its environment and the bus it was given, under its entry module's
# file name, then waits, or exits at once; like gjs, it exits at once when its
# module is not there), and a stand-in program, copied into the run's bin/ as
# start copies the built one, for the sampler program (it records the same,
# under its own file name, and which build it is); busctl says a name is owned
# once the stand-in for the service that owns it has started; gnome-shell
# records the names in its environment,
# the two collection-log variables' values, and whether each service was
# recorded before it, then exits. The stage runs in its isolated environment
# with the run's private bus address (a socket nobody listens on), inside
# `setsid timeout`, from a caller whose own environment carries a display, the
# live bus and a token.
NESTED_SERVICE_STUB_BIN="$WIRING_TMP/nested-service-bin"
NESTED_SERVICE_CALLS="$WIRING_TMP/nested-service-calls"
# Each of the next three is a prefix: a stand-in writes <prefix>.<its entry module's file name>, and the
# gnome-shell stand-in writes <env names prefix>.gnome-shell.
NESTED_SERVICE_ENV_NAMES="$WIRING_TMP/nested-service-env-names"
NESTED_SERVICE_BUS_SEEN="$WIRING_TMP/nested-service-bus-seen"
NESTED_SERVICE_STARTED="$WIRING_TMP/nested-service-started"
NESTED_SERVICE_RUN_LIMIT_SECONDS=30
NESTED_SERVICE_STAND_IN_TEXT='stand-in service started'
COCKPIT_ENTRY_FILE_NAME='cockpit.js'
REPLAY_ENTRY_FILE_NAME='replay-service.js'
NESTED_SHELL_ENV_NAMES_SUFFIX='gnome-shell'
# Which bus name the stand-in for each entry module owns once started (file name=bus name, space-separated).
NESTED_SERVICE_BUS_NAME_BY_ENTRY="$SAMPLER_ENTRY_FILE_NAME=$RESOURCE_PULSE_BUS_NAME $COCKPIT_ENTRY_FILE_NAME=$COCKPIT_BUS_NAME"
NESTED_SERVICE_BUS_NAME_BY_ENTRY+=" $REPLAY_ENTRY_FILE_NAME=$RESOURCE_PULSE_BUS_NAME"
# Pinned here, not read from the script: the run's own copies of the cockpit service, of the replay service, and of
# the extension the replay service is given (the sampler program's copy is pinned above).
NESTED_COCKPIT_MAIN_RELATIVE_PATH="data/gnome-shell/extensions/$EXTENSION_UUID/service/$COCKPIT_ENTRY_FILE_NAME"
NESTED_REPLAY_MAIN_RELATIVE_PATH="replay/$REPLAY_ENTRY_FILE_NAME"
NESTED_EXTENSION_RELATIVE_PATH="data/gnome-shell/extensions/$EXTENSION_UUID"
# perf's cover step, run under plain gjs against a window that records the
# arguments of each maximize() call: Mutter 50.1's meta_window_maximize takes
# none (its Meta-18.typelib records no argument), and GJS logs "Too many
# arguments" into the shell's log for one passed.
PERF_COVER_PROBE="$WIRING_TMP/perf-cover-probe.js"
cat >"$PERF_COVER_PROBE" <<'PROBE'
// Runs perf's cover step (PERF_COVER_CARD_JS) against one fake window, and prints its answer and maximize's arguments.
import GLib from 'gi://GLib';

const NORMAL_WINDOW_TYPE = 0;
const maximizeArgumentCounts = [];
const coveredWindow = {
    get_window_type: () => NORMAL_WINDOW_TYPE,
    unminimize: () => {},
    maximize: (...maximizeArguments) => maximizeArgumentCounts.push(maximizeArguments.length),
};
const fakeGlobal = {display: {list_all_windows: () => [coveredWindow]}};
// Mutter 50.1 still has the flags type; only maximize() stopped taking it.
const fakeMeta = {WindowType: {NORMAL: NORMAL_WINDOW_TYPE}, MaximizeFlags: {BOTH: 3}};
// eslint-disable-next-line no-new-func
const evaluateInShellScope = new Function('global', 'Meta', 'code', "'use strict'; return eval(code);");
const coverAnswer = evaluateInShellScope(fakeGlobal, fakeMeta, GLib.getenv('PERF_COVER_CARD_JS'));
print(`${coverAnswer} maximize-argument-counts=[${maximizeArgumentCounts.join(',')}]`);
PROBE
check "nested: perf's cover step maximizes its window with no argument, as Mutter 50.1 declares meta_window_maximize" \
  "$(env "${LIVE_SETTINGS_BARRIER[@]}" PERF_COVER_CARD_JS="$(nested_constant_text PERF_COVER_CARD_JS)" \
    gjs -m "$PERF_COVER_PROBE" 2>&1)" "covered maximize-argument-counts=[0]"

NESTED_SERVICE_START_TIMEOUT_SECONDS="$(nested_constant SERVICE_START_TIMEOUT_SECONDS)" || exit 2
NESTED_STOP_GRACE_SECONDS="$(nested_constant STOP_GRACE_SECONDS)" || exit 2
# shellcheck disable=SC2016  # The stubs' own source: their variables expand when they run.
install_stub "$NESTED_SERVICE_STUB_BIN" gsettings '#!/usr/bin/env bash
printf "gsettings %s\n" "$*" >>"$NESTED_SERVICE_CALLS"'
# shellcheck disable=SC2016
install_stub "$NESTED_SERVICE_STUB_BIN" gjs '#!/usr/bin/env bash
# Stands in for a service: records how it was started, then waits to be signalled (or exits at once).
entry_file_name="${2##*/}"
printf "gjs %s\n" "$*" >>"$NESTED_SERVICE_CALLS"
compgen -e >"$NESTED_SERVICE_ENV_NAMES.$entry_file_name"
printf "%s\n" "$DBUS_SESSION_BUS_ADDRESS" >"$NESTED_SERVICE_BUS_SEEN.$entry_file_name"
# As gjs -m does with a module it cannot load.
[[ -r "$2" ]] || { printf "stand-in: no module at %s\n" "$2"; exit 1; }
printf "%s\n" "$NESTED_SERVICE_STAND_IN_TEXT"
[[ "$NESTED_SERVICE_MODE" == exits ]] && exit 1
for entry_and_bus_name in $NESTED_SERVICE_BUS_NAME_BY_ENTRY; do
  [[ "${entry_and_bus_name%%=*}" == "$entry_file_name" ]] && : >"$NESTED_SERVICE_STARTED.${entry_and_bus_name#*=}"
done
exec sleep 60'
# shellcheck disable=SC2016
# sampler_program_stand_in_source <build label>: the source of a stand-in for the sampler program, which records how
# it was started and the build it is, then waits to be signalled (or exits at once), as the gjs stand-in does.
SAMPLER_PROGRAM_STAND_IN_TEMPLATE="$(cat <<'STAND_IN'
#!/usr/bin/env bash
# Stands in for the sampler program: records how it was started and which build it is, then waits (or exits at once).
entry_file_name="${0##*/}"
printf 'program %s argc=%s args=[%s] build=%s\n' "$0" "$#" "$*" '@BUILD_LABEL@' >>"$NESTED_SERVICE_CALLS"
compgen -e >"$NESTED_SERVICE_ENV_NAMES.$entry_file_name"
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" >"$NESTED_SERVICE_BUS_SEEN.$entry_file_name"
printf '%s\n' "$NESTED_SERVICE_STAND_IN_TEXT"
[[ "$NESTED_SERVICE_MODE" == exits ]] && exit 1
for entry_and_bus_name in $NESTED_SERVICE_BUS_NAME_BY_ENTRY; do
  [[ "${entry_and_bus_name%%=*}" == "$entry_file_name" ]] && : >"$NESTED_SERVICE_STARTED.${entry_and_bus_name#*=}"
done
exec sleep 60
STAND_IN
)"
sampler_program_stand_in_source() {
  printf '%s\n' "${SAMPLER_PROGRAM_STAND_IN_TEMPLATE//@BUILD_LABEL@/$1}"
}
# The label of the stand-in make_service_run copies into a run, as start copies the built program.
COPIED_PROGRAM_BUILD_LABEL='copied-by-start'
# shellcheck disable=SC2016
install_stub "$NESTED_SERVICE_STUB_BIN" busctl '#!/usr/bin/env bash
# The name asked about is the last argument of NameHasOwner.
printf "busctl %s\n" "$*" >>"$NESTED_SERVICE_CALLS"
if [[ -e "$NESTED_SERVICE_STARTED.${!#}" ]]; then echo "b true"; else echo "b false"; fi'
# shellcheck disable=SC2016
install_stub "$NESTED_SERVICE_STUB_BIN" gnome-shell '#!/usr/bin/env bash
printf "gnome-shell %s\n" "$*" >>"$NESTED_SERVICE_CALLS"
compgen -e >"$NESTED_SERVICE_ENV_NAMES.gnome-shell"
printf "shell-gc-variables=JS_GC_PROFILE=%s,JS_GC_PROFILE_NURSERY=%s\n" "${JS_GC_PROFILE-unset}" \
  "${JS_GC_PROFILE_NURSERY-unset}" >>"$NESTED_SERVICE_CALLS"
for process_name in service cockpit; do
  printf "%s-recorded-before-the-shell=%s\n" "$process_name" \
    "$(grep -c "^$process_name=" "$RESOURCE_PULSE_NESTED_DIR/state/run.values")" >>"$NESTED_SERVICE_CALLS"
done'
# make_service_run <suffix> [no-program]: a run directory laid out as `start` lays it out, with the nested dconf
# already written (the gsettings stub writes nothing) and, unless no-program is given, a stand-in for the sampler
# program copied to bin/ as start copies the built one (labelled COPIED_PROGRAM_BUILD_LABEL).
make_service_run() {
  local run_dir="$WIRING_TMP/service-runs/rpn.$1" program_path
  program_path="$run_dir/$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH"
  if ! mkdir -p "$run_dir" || ! chmod 700 "$run_dir"; then
    fatal "cannot create $run_dir"
  fi
  nested_call prepare_run_directory "$run_dir" "$1" || fatal "cannot prepare $run_dir"
  if ! mkdir -p "$run_dir/config/dconf" || ! printf 'nested settings\n' >"$run_dir/config/dconf/user"; then
    fatal "cannot write $run_dir's nested dconf"
  fi
  if [[ "${2:-}" != no-program ]]; then
    if ! mkdir -p "${program_path%/*}" || ! sampler_program_stand_in_source "$COPIED_PROGRAM_BUILD_LABEL" >"$program_path" ||
      ! chmod 700 "$program_path"; then
      fatal "cannot copy the stand-in program into $run_dir"
    fi
  fi
  printf '%s' "$run_dir"
}
# run_in_bus_stage_with_service <run dir> <stand-in mode: waits | exits>; leaves
# NESTED_SERVICE_EXIT and NESTED_SERVICE_ELAPSED_SECONDS.
run_in_bus_stage_with_service() {
  local run_dir="$1" started_seconds=$SECONDS entry_file_name
  rm -f "$NESTED_SERVICE_STARTED".*
  : >"$NESTED_SERVICE_CALLS"
  for entry_file_name in "$SAMPLER_ENTRY_FILE_NAME" "$COCKPIT_ENTRY_FILE_NAME" "$REPLAY_ENTRY_FILE_NAME"; do
    : >"$NESTED_SERVICE_ENV_NAMES.$entry_file_name"; : >"$NESTED_SERVICE_BUS_SEEN.$entry_file_name"
  done
  : >"$NESTED_SERVICE_ENV_NAMES.$NESTED_SHELL_ENV_NAMES_SUFFIX"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  WAYLAND_DISPLAY=wayland-0 DISPLAY=:0 GH_TOKEN=poison-not-a-token DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \
    setsid --wait timeout "$NESTED_SERVICE_RUN_LIMIT_SECONDS" \
    bash -c 'source "$1" || exit 99; shift; "$@"' nested-call "$NESTED_SCRIPT" run_isolated "$run_dir" \
    env GSETTINGS_BACKEND=memory DBUS_SESSION_BUS_ADDRESS="unix:path=$run_dir/bus/session.sock" \
    PATH="$NESTED_SERVICE_STUB_BIN:/usr/bin:/bin" NESTED_SERVICE_CALLS="$NESTED_SERVICE_CALLS" \
    NESTED_SERVICE_ENV_NAMES="$NESTED_SERVICE_ENV_NAMES" NESTED_SERVICE_BUS_SEEN="$NESTED_SERVICE_BUS_SEEN" \
    NESTED_SERVICE_STARTED="$NESTED_SERVICE_STARTED" NESTED_SERVICE_STAND_IN_TEXT="$NESTED_SERVICE_STAND_IN_TEXT" \
    NESTED_SERVICE_BUS_NAME_BY_ENTRY="$NESTED_SERVICE_BUS_NAME_BY_ENTRY" \
    NESTED_SERVICE_MODE="$2" bash "$NESTED_SCRIPT" __inside-session-bus "$run_dir" >/dev/null 2>&1
  NESTED_SERVICE_EXIT=$?
  NESTED_SERVICE_ELAPSED_SECONDS=$((SECONDS - started_seconds))
}
# end_recorded_stand_ins <run dir>: the stand-ins wait after the stage ends; end
# each, only while it is still the process the run recorded.
end_recorded_stand_ins() {
  local process_name stand_in_pid stand_in_starttime
  for process_name in service cockpit; do
    stand_in_pid="$(grep "^$process_name=" "$1/state/run.values" 2>/dev/null | cut -d= -f2)"
    stand_in_starttime="$(grep "^$process_name-starttime=" "$1/state/run.values" 2>/dev/null | cut -d= -f2)"
    [[ -n "$stand_in_pid" ]] && kill_sacrifice "$stand_in_pid" sleep "$stand_in_starttime"
  done
  return 0
}

SERVICE_RUN="$(make_service_run Service1)"
run_in_bus_stage_with_service "$SERVICE_RUN" waits
SERVICE_RUN_PRIVATE_BUS="unix:path=$SERVICE_RUN/bus/session.sock"
SAMPLER_ENV_NAMES_SEEN="$NESTED_SERVICE_ENV_NAMES.$SAMPLER_ENTRY_FILE_NAME"
COCKPIT_ENV_NAMES_SEEN="$NESTED_SERVICE_ENV_NAMES.$COCKPIT_ENTRY_FILE_NAME"
# What a service may see: the allowlist, the private bus, and what this row
# itself passes the stubs (PWD, SHLVL and _ are bash's own). Byte order for both
# sort and comm: uutils comm compares bytes whatever the locale's collation.
ALLOWED_SERVICE_ENV_NAMES="$( { nested_call nested_environment_assignments "$SERVICE_RUN" | cut -d= -f1
  printf '%s\n' DBUS_SESSION_BUS_ADDRESS GSETTINGS_BACKEND NESTED_SERVICE_CALLS NESTED_SERVICE_ENV_NAMES \
    NESTED_SERVICE_BUS_SEEN NESTED_SERVICE_STARTED NESTED_SERVICE_STAND_IN_TEXT NESTED_SERVICE_BUS_NAME_BY_ENTRY \
    NESTED_SERVICE_MODE PWD SHLVL _
} | LC_ALL=C sort -u)"
ALLOWLIST_ENV_NAMES="$(nested_call nested_environment_assignments "$SERVICE_RUN" | cut -d= -f1 | LC_ALL=C sort -u)"
# unexpected_env_names <env names file>: the names in it that are not allowed, space-separated.
unexpected_env_names() {
  LC_ALL=C sort -u "$1" | LC_ALL=C comm -23 - <(printf '%s\n' "$ALLOWED_SERVICE_ENV_NAMES") | tr '\n' ' '
}
# allowlist_names_seen_in <env names file>: how many of the allowlist's names it holds. An empty
# record would have no unexpected name either: the whole allowlist must be there.
allowlist_names_seen_in() {
  LC_ALL=C sort -u "$1" | LC_ALL=C comm -12 - <(printf '%s\n' "$ALLOWLIST_ENV_NAMES") | wc -l
}
service_start_summary="exit=$NESTED_SERVICE_EXIT"
service_start_summary+=" program=[$(grep '^program ' "$NESTED_SERVICE_CALLS")]"
# Every gjs start but the cockpit's: the sampler is the program now, never a gjs module.
service_start_summary+=" other-gjs=$(grep '^gjs ' "$NESTED_SERVICE_CALLS" | grep -c -v -F " $SERVICE_RUN/$NESTED_COCKPIT_MAIN_RELATIVE_PATH")"
service_start_summary+=" bus=$([[ "$(<"$NESTED_SERVICE_BUS_SEEN.$SAMPLER_ENTRY_FILE_NAME")" == "$SERVICE_RUN_PRIVATE_BUS" ]] && printf private || printf other)"
service_start_summary+=" allowlist-seen=$(allowlist_names_seen_in "$SAMPLER_ENV_NAMES_SEEN") unexpected=[$(unexpected_env_names "$SAMPLER_ENV_NAMES_SEEN")]"
service_start_summary+=" recorded=$(grep -c -E '^service(-starttime)?=[0-9]+$' "$SERVICE_RUN/state/run.values")"
service_start_summary+=" $(grep '^service-recorded-before-the-shell=' "$NESTED_SERVICE_CALLS")"
service_start_summary+=" asked-the-private-bus=$(grep -c -x -F "busctl --address=$SERVICE_RUN_PRIVATE_BUS call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s $RESOURCE_PULSE_BUS_NAME" "$NESTED_SERVICE_CALLS" | sed 's/^[1-9][0-9]*$/yes/')"
service_start_summary+=" logged=$(grep -c -x -F "$NESTED_SERVICE_STAND_IN_TEXT" "$SERVICE_RUN/log/service.log" 2>/dev/null)"
check "nested: the in-bus stage starts the run's copy of the sampler program (bin/resource-pulse-sampler, no argument, never gjs) on the private bus, with only the allowlist, before the shell" \
  "$service_start_summary" \
  "exit=0 program=[program $SERVICE_RUN/$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH argc=0 args=[] build=$COPIED_PROGRAM_BUILD_LABEL] other-gjs=0 bus=private allowlist-seen=22 unexpected=[] recorded=2 service-recorded-before-the-shell=1 asked-the-private-bus=yes logged=1"

# The same run, for the cockpit: started second, from the run's copy of
# service/cockpit.js, with the same allowlist and bus, recorded as `cockpit`
# before the shell, its own name asked for, and its own log.
cockpit_start_summary="exit=$NESTED_SERVICE_EXIT"
# Both services, in the order they started: the program's path, then the cockpit's module, relative to the run.
cockpit_start_summary+=" starts=[$(grep -E '^(program|gjs) ' "$NESTED_SERVICE_CALLS" |
  sed -e "s|^program $SERVICE_RUN/\([^ ]*\) .*|\1|" -e "s|^gjs -m $SERVICE_RUN/||" | tr '\n' ' ')]"
cockpit_start_summary+=" bus=$([[ "$(<"$NESTED_SERVICE_BUS_SEEN.$COCKPIT_ENTRY_FILE_NAME")" == "$SERVICE_RUN_PRIVATE_BUS" ]] && printf private || printf other)"
cockpit_start_summary+=" allowlist-seen=$(allowlist_names_seen_in "$COCKPIT_ENV_NAMES_SEEN") unexpected=[$(unexpected_env_names "$COCKPIT_ENV_NAMES_SEEN")]"
cockpit_start_summary+=" recorded=$(grep -c -E '^cockpit(-starttime)?=[0-9]+$' "$SERVICE_RUN/state/run.values")"
cockpit_start_summary+=" $(grep '^cockpit-recorded-before-the-shell=' "$NESTED_SERVICE_CALLS")"
cockpit_start_summary+=" asked-the-private-bus=$(grep -c -x -F "busctl --address=$SERVICE_RUN_PRIVATE_BUS call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s $COCKPIT_BUS_NAME" "$NESTED_SERVICE_CALLS" | sed 's/^[1-9][0-9]*$/yes/')"
cockpit_start_summary+=" logged=$(grep -c -x -F "$NESTED_SERVICE_STAND_IN_TEXT" "$SERVICE_RUN/log/cockpit.log" 2>/dev/null)"
end_recorded_stand_ins "$SERVICE_RUN"
# Beyond the allowlist the cockpit service gets one name: the run's fixture's (fixture mode).
check "nested: the in-bus stage starts the run's copy of service/cockpit.js after the sampler, on the private bus, before the shell, with only the allowlist and RESOURCE_PULSE_COCKPIT_FIXTURE" \
  "$cockpit_start_summary" \
  "exit=0 starts=[$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH $NESTED_COCKPIT_MAIN_RELATIVE_PATH ] bus=private allowlist-seen=22 unexpected=[RESOURCE_PULSE_COCKPIT_FIXTURE ] recorded=2 cockpit-recorded-before-the-shell=1 asked-the-private-bus=yes logged=1"

check "nested: the harness names the run's copy of service/cockpit.js and the cockpit's bus name, beside the sampler's" \
  "entry=$(nested_constant_text COCKPIT_MAIN_RELATIVE_PATH) bus=$(nested_constant_text COCKPIT_BUS_NAME)" \
  "entry=$NESTED_COCKPIT_MAIN_RELATIVE_PATH bus=$COCKPIT_BUS_NAME"

# The cockpit reads its layout from <XDG_CONFIG_HOME>/resource-pulse/cockpit.json:
# the run's config home, as the run's environment names it, holds the template.
SERVICE_RUN_CONFIG_HOME="$(nested_call nested_environment_assignments "$SERVICE_RUN" | sed -n 's/^XDG_CONFIG_HOME=//p')"
check "nested: the run's XDG_CONFIG_HOME holds the cockpit config template as resource-pulse/cockpit.json" \
  "$(cmp -s "$COCKPIT_CONFIG_TEMPLATE" "$SERVICE_RUN_CONFIG_HOME/$COCKPIT_CONFIG_RELATIVE_PATH" && printf same || printf differs-or-missing)" \
  same

# The collection log: the nested gnome-shell's environment, as its stand-in
# recorded it, beyond the allowlist and what this row passes the stubs. The run
# above was started with neither option; the next records gc-log=1, as
# `start --gc-log` does. The two variables are the shell's alone: both services
# start before they are set.
NESTED_SHELL_ENV_NAMES_SEEN="$NESTED_SERVICE_ENV_NAMES.$NESTED_SHELL_ENV_NAMES_SUFFIX"
# shell_environment_summary prints the shell's unexpected names, how many allowlist names it held, and the two
# variables' values.
shell_environment_summary() {
  printf 'unexpected=[%s] allowlist=%s %s' "$(unexpected_env_names "$NESTED_SHELL_ENV_NAMES_SEEN")" \
    "$(allowlist_names_seen_in "$NESTED_SHELL_ENV_NAMES_SEEN")" "$(grep '^shell-gc-variables=' "$NESTED_SERVICE_CALLS")"
}
gc_log_summary="without: exit=$NESTED_SERVICE_EXIT $(shell_environment_summary)"
GC_LOG_RUN="$(make_service_run GcLog001)"
printf 'gc-log=1\n' >>"$GC_LOG_RUN/state/run.values" || fatal "cannot record gc-log=1 in $GC_LOG_RUN"
run_in_bus_stage_with_service "$GC_LOG_RUN" waits
gc_log_summary+=" with: exit=$NESTED_SERVICE_EXIT $(shell_environment_summary)"
gc_log_summary+=" sampler=[$(unexpected_env_names "$SAMPLER_ENV_NAMES_SEEN")]"
gc_log_summary+=" cockpit=[$(unexpected_env_names "$COCKPIT_ENV_NAMES_SEEN")]"
end_recorded_stand_ins "$GC_LOG_RUN"
check "nested: with gc-log=1 the nested gnome-shell gets exactly JS_GC_PROFILE=0 and JS_GC_PROFILE_NURSERY=0 beyond the allowlist, without it neither, and the services never (the cockpit only its fixture's name)" \
  "$gc_log_summary" \
  "without: exit=0 unexpected=[] allowlist=22 shell-gc-variables=JS_GC_PROFILE=unset,JS_GC_PROFILE_NURSERY=unset with: exit=0 unexpected=[JS_GC_PROFILE JS_GC_PROFILE_NURSERY ] allowlist=22 shell-gc-variables=JS_GC_PROFILE=0,JS_GC_PROFILE_NURSERY=0 sampler=[] cockpit=[RESOURCE_PULSE_COCKPIT_FIXTURE ]"

# The monitor size: the in-bus stage reads the run's recorded monitor-size=, as `start --monitor-size` records it, and
# gives it to gnome-shell's --virtual-monitor; with none recorded the default. A recorded text that is not a size
# (state/run.values written by hand, or by an older or broken start) refuses the run before either service starts.
# virtual_monitor_seen: the size the gnome-shell stand-in got after --virtual-monitor, or not-started.
virtual_monitor_seen() {
  grep -q '^gnome-shell ' "$NESTED_SERVICE_CALLS" || { printf 'not-started'; return 0; }
  sed -n 's/^gnome-shell .*--virtual-monitor \([^ ]*\).*/\1/p' "$NESTED_SERVICE_CALLS"
}
# monitor_size_stage_verdict <suffix> [recorded line]: the in-bus stage's exit and the size gnome-shell got, for a
# run with that line recorded. Each run starts the calls log afresh, so services-started below is the last run's.
monitor_size_stage_verdict() {
  local size_run
  size_run="$(make_service_run "$1")"
  if [[ -n "${2:-}" ]]; then
    printf '%s\n' "$2" >>"$size_run/state/run.values" || fatal "cannot record $2 in $size_run"
  fi
  run_in_bus_stage_with_service "$size_run" waits
  printf '%s/%s' "$NESTED_SERVICE_EXIT" "$(virtual_monitor_seen)"
  end_recorded_stand_ins "$size_run"
}
monitor_size_stage_summary="none-recorded=$(monitor_size_stage_verdict Size0001)"
monitor_size_stage_summary+=" recorded=$(monitor_size_stage_verdict Size0002 monitor-size=1536x960)"
monitor_size_stage_summary+=" not-a-size=$(monitor_size_stage_verdict Size0003 'monitor-size=1536x960;id')"
monitor_size_stage_summary+=" services-started=$(grep -c -E '^(program|gjs) ' "$NESTED_SERVICE_CALLS")"
check "nested: the in-bus stage gives gnome-shell the run's recorded monitor size, 3072x1920 with none recorded, and refuses a run whose recorded size is not one before any service starts" \
  "$monitor_size_stage_summary" \
  "none-recorded=0/3072x1920 recorded=0/1536x960 not-a-size=2/not-started services-started=0"

# The monitor scale: the in-bus stage reads the run's recorded monitor-scale= and, for a scale other than 1, writes
# the run's monitor config (monitors.xml in its own config home, where Mutter reads it at startup) naming the virtual
# monitor at the run's size and that scale. At scale 1, recorded or not, it writes none, so the monitor is as
# --virtual-monitor alone makes it. A recorded text that is not a scale refuses the run before either service starts.
# monitor_scale_stage_verdict <suffix> [recorded lines...]: the stage's exit, then the config's size and scale, or none.
monitor_scale_stage_verdict() {
  local scale_run recorded_line monitors_config
  scale_run="$(make_service_run "$1")"
  shift
  for recorded_line in "$@"; do
    printf '%s\n' "$recorded_line" >>"$scale_run/state/run.values" || fatal "cannot record $recorded_line in $scale_run"
  done
  run_in_bus_stage_with_service "$scale_run" waits
  monitors_config="$scale_run/config/monitors.xml"
  if [[ -f "$monitors_config" ]]; then
    printf '%s/%sx%s@%s' "$NESTED_SERVICE_EXIT" "$(sed -n 's:.*<width>\(.*\)</width>.*:\1:p' "$monitors_config")" \
      "$(sed -n 's:.*<height>\(.*\)</height>.*:\1:p' "$monitors_config")" \
      "$(sed -n 's:.*<scale>\(.*\)</scale>.*:\1:p' "$monitors_config")"
  else
    printf '%s/none' "$NESTED_SERVICE_EXIT"
  fi
  end_recorded_stand_ins "$scale_run"
}
monitor_scale_stage_summary="none-recorded=$(monitor_scale_stage_verdict Scale001)"
monitor_scale_stage_summary+=" one=$(monitor_scale_stage_verdict Scale002 monitor-scale=1)"
monitor_scale_stage_summary+=" two=$(monitor_scale_stage_verdict Scale003 monitor-size=3840x2160 monitor-scale=2)"
monitor_scale_stage_summary+=" default-size=$(monitor_scale_stage_verdict Scale004 monitor-scale=1.5)"
monitor_scale_stage_summary+=" not-a-scale=$(monitor_scale_stage_verdict Scale005 'monitor-scale=2;id')"
monitor_scale_stage_summary+=" services-started=$(grep -c -E '^(program|gjs) ' "$NESTED_SERVICE_CALLS")"
check "nested: the in-bus stage writes the run's monitor config at its recorded size and scale for a scale other than 1, none at scale 1, and refuses a run whose recorded scale is not one before any service starts" \
  "$monitor_scale_stage_summary" \
  "none-recorded=0/none one=0/none two=0/3840x2160@2 default-size=0/3072x1920@1.5 not-a-scale=2/none services-started=0"

# The monitor config names the virtual monitor as Mutter 50 does, in logical layout mode, primary at the origin; a
# size or scale that is not one writes nothing. Pure: monitors_config_xml alone.
# monitors_config_of <size> <scale>: the config's lines, trimmed and joined, or exit-<status>.
monitors_config_of() {
  nested_call monitors_config_xml "$1" "$2" | sed 's/^ *//' | tr -d '\n' || printf 'exit-%s' "$?"
}
monitors_config_summary="spec=$(monitors_config_of 3840x2160 2 | grep -c -F '<monitorspec><connector>Meta-0</connector><vendor>MetaVendor</vendor><product>MetaVirtualMonitor</product><serial>0x00</serial></monitorspec>')"
monitors_config_summary+=" mode=$(monitors_config_of 3840x2160 2 | grep -c -F '<mode><width>3840</width><height>2160</height><rate>60.000</rate></mode>')"
monitors_config_summary+=" logical=$(monitors_config_of 3840x2160 2 | grep -c -F '<layoutmode>logical</layoutmode><logicalmonitor><x>0</x><y>0</y><scale>2</scale><primary>yes</primary>')"
monitors_config_summary+=" fractional=$(monitors_config_of 3072x1920 1.3333334 | grep -c -F '<scale>1.3333334</scale>')"
monitors_config_summary+=" not-a-scale=[$(monitors_config_of 3840x2160 '2</scale>')] not-a-size=[$(monitors_config_of '3840x2160<' 2)]"
check "nested: the monitor config names Mutter's virtual monitor at the run's size and scale, in logical layout mode, primary at the origin; a size or scale that is not one writes nothing" \
  "$monitors_config_summary" \
  "spec=1 mode=1 logical=1 fractional=1 not-a-scale=[exit-1] not-a-size=[exit-1]"

# The scale check after start: a scale the shell reports is the one asked for within Mutter's float precision, and a
# mismatch names the scales the monitor's current mode lists, read from a GetCurrentState reply as busctl gives it.
# Pure: is_same_monitor_scale and supported_scales_of_state alone.
SCALES_REPLY='{"type":"(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})","data":[2,[[["Meta-0","MetaVendor","MetaVirtualMonitor","0x00"],[["1920x1080@60.000",1920,1080,60,1,[1,1.25,1.5],{"is-preferred":{"type":"b","data":true}}],["3072x1920@60.000",3072,1920,60,1,[1,1.333333373069763,1.5,2,2.666666746139526,3],{"is-current":{"type":"b","data":true}}]],{}]],[],{}]}'
same_scale_of() { nested_call is_same_monitor_scale "$1" "$2" && printf 'same' || printf 'different'; }
scale_check_summary="float=$(same_scale_of 1.3333333730697632 1.3333334) whole=$(same_scale_of 2 2.0)"
scale_check_summary+=" fell-back=$(same_scale_of 1 2) other=$(same_scale_of 1.5 1.3333333730697632)"
scale_check_summary+=" supported=[$(nested_call supported_scales_of_state "$SCALES_REPLY")]"
scale_check_summary+=" none=[$(nested_call supported_scales_of_state '{"data":[2,[],[],{}]}')]"
scale_check_summary+=" not-json=[$(nested_call supported_scales_of_state 'Call failed')]"
check "nested: start's scale check takes the shell's scale as the one asked for within Mutter's float precision, and names the current mode's scales, each to eight significant digits, or unknown" \
  "$scale_check_summary" \
  "float=same whole=same fell-back=different other=different supported=[1, 1.3333334, 1.5, 2, 2.6666667, 3] none=[unknown] not-json=[unknown]"

# The scale check itself, as start runs it once the shell answers: the run's recorded scale (scale 1 when none is)
# against the scale the shell reports, which a stub answers, as it does the mode's scales. A monitor left at 1 for a
# run asked for 2 fails, naming the scales; a recorded scale that is not one fails before the shell is asked.
SCALE_CONFIRM_RUN="$WIRING_TMP/scale-confirm-run"
SCALE_CONFIRM_ASKED="$WIRING_TMP/scale-confirm-asked"
SCALE_LEFT_AT_ONE_NEEDLE='the nested monitor is at scale 1, not the 2 asked for:'
SCALE_LEFT_AT_ONE_NEEDLE+=' at 3072x1920 it takes the scales 1, 1.5, 2'
# confirm_scale_of <recorded run.values line, or ""> <the shell's answer, or FAIL> prints the check's exit/whether it
# named the scales left at 1/how many times it asked the shell.
confirm_scale_of() {
  local confirm_output confirm_exit
  rm -rf "$SCALE_CONFIRM_RUN"
  mkdir -p "$SCALE_CONFIRM_RUN/state" || fatal "cannot make $SCALE_CONFIRM_RUN"
  [[ -n "$1" ]] && printf '%s\n' "$1" >"$SCALE_CONFIRM_RUN/state/run.values"
  : >"$SCALE_CONFIRM_ASKED"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  confirm_output="$(bash -c '
    source "$1" || exit 99
    asked_path="$3"
    shell_answer="$4"
    eval_in_nested_shell() {
      printf "asked\n" >>"$asked_path"
      [[ "$shell_answer" != FAIL ]] || return 1
      printf "%s" "$shell_answer"
    }
    supported_monitor_scales() { printf "1, 1.5, 2"; }
    confirm_nested_monitor_scale "$2" unix:path=/nonexistent
  ' scale-confirm "$NESTED_SCRIPT" "$SCALE_CONFIRM_RUN" "$SCALE_CONFIRM_ASKED" "$2" 2>&1)"
  confirm_exit=$?
  printf '%s/%s/%s' "$confirm_exit" "$(grep -c -F "$SCALE_LEFT_AT_ONE_NEEDLE" <<<"$confirm_output")" \
    "$(wc -l <"$SCALE_CONFIRM_ASKED")"
}
confirm_scale_summary="at-scale=$(confirm_scale_of monitor-scale=2 2) left-at-1=$(confirm_scale_of monitor-scale=2 1)"
confirm_scale_summary+=" default=$(confirm_scale_of '' 1) not-a-scale=$(confirm_scale_of monitor-scale=two 2)"
confirm_scale_summary+=" no-answer=$(confirm_scale_of monitor-scale=2 FAIL)"
check "nested: start's scale check passes a monitor at the recorded scale (1 with none recorded), fails one left at 1 for a run asked for 2, naming the scales its mode takes, and fails a recorded scale that is not one before asking the shell, or a shell that does not answer" \
  "$confirm_scale_summary" "at-scale=0/0/1 left-at-1=1/1/1 default=0/0/1 not-a-scale=1/0/0 no-answer=1/0/1"

# Fixed input: with replay=1 recorded, as `start --replay` does, the run's copy
# of the replay service starts in place of the sampler program, given the run's copy
# of the extension, on the private bus with only the allowlist, recorded and
# logged as the service (so `stop` ends it), before the cockpit and the shell.
REPLAY_SERVICE_RUN="$(make_service_run Replay01)"
printf 'replay=1\n' >>"$REPLAY_SERVICE_RUN/state/run.values" || fatal "cannot record replay=1 in $REPLAY_SERVICE_RUN"
run_in_bus_stage_with_service "$REPLAY_SERVICE_RUN" waits
REPLAY_ENV_NAMES_SEEN="$NESTED_SERVICE_ENV_NAMES.$REPLAY_ENTRY_FILE_NAME"
replay_start_summary="exit=$NESTED_SERVICE_EXIT"
replay_start_summary+=" starts=[$(grep '^gjs ' "$NESTED_SERVICE_CALLS" | sed "s|$REPLAY_SERVICE_RUN/||g" | tr '\n' ';')]"
# The run holds a copy of the program (make_service_run's stand-in): the replay starts in its place, so it never runs.
replay_start_summary+=" program-started=$(grep -c '^program ' "$NESTED_SERVICE_CALLS")"
replay_start_summary+=" copies=$(cmp -s "$NESTED_FILES/$REPLAY_ENTRY_FILE_NAME" "$REPLAY_SERVICE_RUN/$NESTED_REPLAY_MAIN_RELATIVE_PATH" &&
  cmp -s "$NESTED_FILES/replayGenerator.js" "$REPLAY_SERVICE_RUN/replay/replayGenerator.js" && printf same || printf differ)"
replay_start_summary+=" bus=$([[ "$(<"$NESTED_SERVICE_BUS_SEEN.$REPLAY_ENTRY_FILE_NAME")" == "unix:path=$REPLAY_SERVICE_RUN/bus/session.sock" ]] && printf private || printf other)"
replay_start_summary+=" allowlist-seen=$(allowlist_names_seen_in "$REPLAY_ENV_NAMES_SEEN") unexpected=[$(unexpected_env_names "$REPLAY_ENV_NAMES_SEEN")]"
replay_start_summary+=" recorded=$(grep -c -E '^service(-starttime)?=[0-9]+$' "$REPLAY_SERVICE_RUN/state/run.values")"
replay_start_summary+=" $(grep '^service-recorded-before-the-shell=' "$NESTED_SERVICE_CALLS")"
replay_start_summary+=" asked-the-private-bus=$(grep -c -x -F "busctl --address=unix:path=$REPLAY_SERVICE_RUN/bus/session.sock call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus NameHasOwner s $RESOURCE_PULSE_BUS_NAME" "$NESTED_SERVICE_CALLS" | sed 's/^[1-9][0-9]*$/yes/')"
replay_start_summary+=" logged=$(grep -c -x -F "$NESTED_SERVICE_STAND_IN_TEXT" "$REPLAY_SERVICE_RUN/log/service.log" 2>/dev/null)"
end_recorded_stand_ins "$REPLAY_SERVICE_RUN"
check "nested: with replay=1 the in-bus stage starts the run's copy of replay-service.js in place of the sampler program, given the run's extension, on the private bus, as the service" \
  "$replay_start_summary" \
  "exit=0 starts=[gjs -m $NESTED_REPLAY_MAIN_RELATIVE_PATH $NESTED_EXTENSION_RELATIVE_PATH;gjs -m $NESTED_COCKPIT_MAIN_RELATIVE_PATH;] program-started=0 copies=same bus=private allowlist-seen=22 unexpected=[] recorded=2 service-recorded-before-the-shell=1 asked-the-private-bus=yes logged=1"

# A run whose copy of the extension has no service/cockpit.js: the cockpit's
# stand-in exits at once, as gjs does, and the run must refuse, naming it.
MISSING_COCKPIT_RUN="$(make_service_run Service3)"
rm -f -- "${MISSING_COCKPIT_RUN:?}/$NESTED_COCKPIT_MAIN_RELATIVE_PATH" || fatal "cannot remove the run's service/cockpit.js"
run_in_bus_stage_with_service "$MISSING_COCKPIT_RUN" waits
missing_cockpit_summary="exit=$NESTED_SERVICE_EXIT"
missing_cockpit_summary+=" refused=$(grep -c -F "the service at $NESTED_COCKPIT_MAIN_RELATIVE_PATH did not take $COCKPIT_BUS_NAME" "$MISSING_COCKPIT_RUN/state/refused" 2>/dev/null)"
missing_cockpit_summary+=" shell-started=$(grep -c '^gnome-shell ' "$NESTED_SERVICE_CALLS")"
missing_cockpit_summary+=" address=$([[ -e "$MISSING_COCKPIT_RUN/state/session.addr" ]] && printf recorded || printf none)"
missing_cockpit_summary+=" at-once=$( (( NESTED_SERVICE_ELAPSED_SECONDS < NESTED_SERVICE_START_TIMEOUT_SECONDS )) && printf yes || printf 'no-%ss' "$NESTED_SERVICE_ELAPSED_SECONDS")"
end_recorded_stand_ins "$MISSING_COCKPIT_RUN"
check "nested: a run with no service/cockpit.js refuses at once, naming the cockpit, and the shell never starts" \
  "$missing_cockpit_summary" "exit=2 refused=1 shell-started=0 address=none at-once=yes"

EXITING_SERVICE_RUN="$(make_service_run Service2)"
run_in_bus_stage_with_service "$EXITING_SERVICE_RUN" exits
exiting_service_summary="exit=$NESTED_SERVICE_EXIT"
exiting_service_summary+=" refused=$(grep -c -F "the service at $NESTED_SAMPLER_PROGRAM_RELATIVE_PATH did not take $RESOURCE_PULSE_BUS_NAME" "$EXITING_SERVICE_RUN/state/refused" 2>/dev/null)"
exiting_service_summary+=" shell-started=$(grep -c '^gnome-shell ' "$NESTED_SERVICE_CALLS")"
exiting_service_summary+=" address=$([[ -e "$EXITING_SERVICE_RUN/state/session.addr" ]] && printf recorded || printf none)"
exiting_service_summary+=" at-once=$( (( NESTED_SERVICE_ELAPSED_SECONDS < NESTED_SERVICE_START_TIMEOUT_SECONDS )) && printf yes || printf 'no-%ss' "$NESTED_SERVICE_ELAPSED_SECONDS")"
check "nested: a service that exits before owning its name refuses the run at once, and the shell never starts" \
  "$exiting_service_summary" "exit=2 refused=1 shell-started=0 address=none at-once=yes"

# start's build of the sampler program (build_run_sampler_program), called here on scratch runs: `start` itself never
# gets that far in this suite (its base is too long, so it refuses before laying out a run), and must not: past the
# build it launches a real nested shell. A stand-in cargo records its arguments, its job cap and its build directory,
# then builds (puts NESTED_BUILT_PROGRAM_SOURCE at <build directory>/release/resource-pulse-sampler by a rename, as
# cargo replaces the file by a new link), fails (prints a compiler-shaped error and exits 101) or leaves no program
# (exits 0 with none there), as NESTED_STAND_IN_CARGO_MODE says. The build directory is the helper's own answer under
# this suite's cache directory, so nothing is written to the user's.
NESTED_CARGO_TARGET_DIR_HELPER="$REPO_ROOT/scripts/resource-pulse-cargo-target-dir.sh"
NESTED_CRATE_MANIFEST_PATH="$REPO_ROOT/resource-pulse-sampler/Cargo.toml"
NESTED_BUILD_CACHE_HOME="$WIRING_TMP/nested-build-cache"
NESTED_CARGO_STUB_BIN="$WIRING_TMP/nested-cargo-bin"
NESTED_CARGO_CALLS="$WIRING_TMP/nested-cargo-calls"
NESTED_BUILD_FAILURE_TEXT='stand-in: error[E0425]: cannot find value in this scope'
NESTED_BUILD_LOG_RELATIVE_PATH='log/sampler-build.log'
NESTED_FALLBACK_BUILD_JOBS=4
NESTED_CALLER_BUILD_JOBS=7
NESTED_BUILT_PROGRAM_LABEL='built-first'
NESTED_REBUILT_PROGRAM_LABEL='built-second'
NESTED_PRIVATE_PROGRAM_MODE=700
NESTED_BUILD_TARGET_DIR="$(XDG_CACHE_HOME="$NESTED_BUILD_CACHE_HOME" bash "$NESTED_CARGO_TARGET_DIR_HELPER")" \
  || fatal "cannot work out the build directory with $NESTED_CARGO_TARGET_DIR_HELPER"
NESTED_BUILT_PROGRAM_PATH="$NESTED_BUILD_TARGET_DIR/release/$SAMPLER_ENTRY_FILE_NAME"
# shellcheck disable=SC2016  # The stand-in's own source: its variables expand when it runs.
install_stub "$NESTED_CARGO_STUB_BIN" cargo '#!/usr/bin/env bash
printf "args=[%s] jobs=%s target=%s\n" "$*" "${CARGO_BUILD_JOBS-unset}" "${CARGO_TARGET_DIR-unset}" >>"$NESTED_CARGO_CALLS"
built_program_path="$CARGO_TARGET_DIR/release/resource-pulse-sampler"
case "$NESTED_STAND_IN_CARGO_MODE" in
  builds)
    mkdir -p "${built_program_path%/*}" && printf "%s\n" "$NESTED_BUILT_PROGRAM_SOURCE" >"$built_program_path.new" &&
      chmod 755 "$built_program_path.new" && mv -f "$built_program_path.new" "$built_program_path" || exit 98
    printf "stand-in: Finished release\n" ;;
  fails) printf "%s\n" "$NESTED_BUILD_FAILURE_TEXT" >&2; exit 101 ;;
  no-program) rm -f "$built_program_path"; exit 0 ;;
  *) exit 99 ;;
esac'
# run_sampler_build <run dir> <stand-in cargo mode> [NAME=value...]: calls build_run_sampler_program on the run, with
# the stand-in cargo first on PATH, neither CARGO_BUILD_JOBS nor CARGO_TARGET_DIR from this suite, the cache directory
# above, and then the assignments given (which win); leaves NESTED_BUILD_EXIT and NESTED_BUILD_OUTPUT (stderr too).
run_sampler_build() {
  local run_dir="$1" cargo_mode="$2"
  shift 2
  : >"$NESTED_CARGO_CALLS"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  NESTED_BUILD_OUTPUT="$(env -u CARGO_BUILD_JOBS -u CARGO_TARGET_DIR PATH="$NESTED_CARGO_STUB_BIN:/usr/bin:/bin" \
    XDG_CACHE_HOME="$NESTED_BUILD_CACHE_HOME" NESTED_CARGO_CALLS="$NESTED_CARGO_CALLS" \
    NESTED_STAND_IN_CARGO_MODE="$cargo_mode" NESTED_BUILD_FAILURE_TEXT="$NESTED_BUILD_FAILURE_TEXT" \
    NESTED_BUILT_PROGRAM_SOURCE="$(sampler_program_stand_in_source "$NESTED_BUILT_PROGRAM_LABEL")" "$@" \
    bash -c 'source "$1" || exit 99; shift; "$@"' nested-call "$NESTED_SCRIPT" build_run_sampler_program "$run_dir" 2>&1)"
  NESTED_BUILD_EXIT=$?
}
nested_cargo_call_count() { printf '%d' "$(wc -l <"$NESTED_CARGO_CALLS")"; }
NESTED_EXPECTED_BUILD_ARGUMENTS="args=[build --release --locked --manifest-path $NESTED_CRATE_MANIFEST_PATH]"

BUILD_RUN="$(make_service_run Build001 no-program)"
run_sampler_build "$BUILD_RUN" builds "CARGO_BUILD_JOBS=$NESTED_CALLER_BUILD_JOBS" \
  "CARGO_TARGET_DIR=$WIRING_TMP/a-build-directory-another-checkout-shares"
build_command_summary="caller-cap=$NESTED_BUILD_EXIT/[$(<"$NESTED_CARGO_CALLS")]"
run_sampler_build "$BUILD_RUN" builds
build_command_summary+=" no-cap=$NESTED_BUILD_EXIT/[$(<"$NESTED_CARGO_CALLS")]"
check "nested: start's build is \`cargo build --release --locked\` of the checkout's crate, into the helper's directory (never a caller's CARGO_TARGET_DIR), with the caller's CARGO_BUILD_JOBS, else $NESTED_FALLBACK_BUILD_JOBS" \
  "$build_command_summary" \
  "caller-cap=0/[$NESTED_EXPECTED_BUILD_ARGUMENTS jobs=$NESTED_CALLER_BUILD_JOBS target=$NESTED_BUILD_TARGET_DIR] no-cap=0/[$NESTED_EXPECTED_BUILD_ARGUMENTS jobs=$NESTED_FALLBACK_BUILD_JOBS target=$NESTED_BUILD_TARGET_DIR]"

BUILD_RUN_PROGRAM_PATH="$BUILD_RUN/$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH"
build_copy_summary="copy=$(cmp -s "$NESTED_BUILT_PROGRAM_PATH" "$BUILD_RUN_PROGRAM_PATH" && printf same || printf differs-or-missing)"
build_copy_summary+=" mode=$(stat -c %a "$BUILD_RUN_PROGRAM_PATH" 2>/dev/null)"
build_copy_summary+=" executable=$([[ -x "$BUILD_RUN_PROGRAM_PATH" ]] && printf yes || printf no)"
check "nested: start copies the built program into the run, at bin/$SAMPLER_ENTRY_FILE_NAME, executable and private to the user ($NESTED_PRIVATE_PROGRAM_MODE)" \
  "$build_copy_summary" "copy=same mode=$NESTED_PRIVATE_PROGRAM_MODE executable=yes"

# A failed build, after the build above left a program in the build directory: that one must not be copied.
FAILED_BUILD_RUN="$(make_service_run Build002 no-program)"
FAILED_BUILD_LOG="$FAILED_BUILD_RUN/$NESTED_BUILD_LOG_RELATIVE_PATH"
run_sampler_build "$FAILED_BUILD_RUN" fails
failed_build_summary="exit=$NESTED_BUILD_EXIT"
failed_build_summary+=" named=$(grep -c -F "refusing: the sampler program did not build; see $FAILED_BUILD_LOG" <<<"$NESTED_BUILD_OUTPUT")"
failed_build_summary+=" refused=$(grep -c -F "did not build; see $FAILED_BUILD_LOG" "$FAILED_BUILD_RUN/state/refused" 2>/dev/null)"
failed_build_summary+=" log=$(grep -c -x -F "$NESTED_BUILD_FAILURE_TEXT" "$FAILED_BUILD_LOG" 2>/dev/null)"
failed_build_summary+=" copied=$([[ -e "$FAILED_BUILD_RUN/$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH" ]] && printf yes || printf no)"
check "nested: a build that fails refuses the run (exit 2) naming its log, which holds cargo's output, and copies nothing" \
  "$failed_build_summary" "exit=2 named=1 refused=1 log=1 copied=no"

NO_PROGRAM_BUILD_RUN="$(make_service_run Build003 no-program)"
run_sampler_build "$NO_PROGRAM_BUILD_RUN" no-program
no_program_summary="exit=$NESTED_BUILD_EXIT"
no_program_summary+=" named=$(grep -c -F "refusing: the build left no program at $NESTED_BUILT_PROGRAM_PATH; see $NO_PROGRAM_BUILD_RUN/$NESTED_BUILD_LOG_RELATIVE_PATH" <<<"$NESTED_BUILD_OUTPUT")"
no_program_summary+=" copied=$([[ -e "$NO_PROGRAM_BUILD_RUN/$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH" ]] && printf yes || printf no)"
check "nested: a build that succeeds but leaves no program refuses the run (exit 2), naming where it looked and the log" \
  "$no_program_summary" "exit=2 named=1 copied=no"

# job_cap_verdict <CARGO_BUILD_JOBS value> prints exit/needle count/cargo calls for a build with that cap.
job_cap_verdict() {
  run_sampler_build "$BUILD_RUN" builds "CARGO_BUILD_JOBS=$1"
  printf '%s/%s/%s' "$NESTED_BUILD_EXIT" \
    "$(grep -c -F "CARGO_BUILD_JOBS is not a positive whole number: '$1'" <<<"$NESTED_BUILD_OUTPUT")" "$(nested_cargo_call_count)"
}
check "nested: a job cap that is not a positive whole number (0, negative, a word) refuses the run before cargo runs: it never removes the bound" \
  "zero=$(job_cap_verdict 0) negative=$(job_cap_verdict -1) word=$(job_cap_verdict four)" "zero=2/1/0 negative=2/1/0 word=2/1/0"

run_sampler_build "$BUILD_RUN" builds XDG_CACHE_HOME= HOME=
check "nested: a build directory the helper cannot work out refuses the run before cargo runs, with the helper's own reason" \
  "exit=$NESTED_BUILD_EXIT named=$(grep -c -F "refusing: cannot work out this checkout's cargo build directory" <<<"$NESTED_BUILD_OUTPUT") reason=$(grep -c -F 'neither XDG_CACHE_HOME nor HOME is set' <<<"$NESTED_BUILD_OUTPUT") cargo-calls=$(nested_cargo_call_count)" \
  "exit=2 named=1 reason=1 cargo-calls=0"

# The run starts its own copy: the build directory's program replaced after the copy (as a rebuild while the run
# lives replaces it, by a new file), the in-bus stage still starts the program start copied.
REBUILD_RUN="$(make_service_run Rebuild1 no-program)"
run_sampler_build "$REBUILD_RUN" builds
rebuild_summary="build=$NESTED_BUILD_EXIT"
if ! mkdir -p "${NESTED_BUILT_PROGRAM_PATH%/*}" ||
  ! sampler_program_stand_in_source "$NESTED_REBUILT_PROGRAM_LABEL" >"$NESTED_BUILT_PROGRAM_PATH.new" ||
  ! chmod 755 "$NESTED_BUILT_PROGRAM_PATH.new" || ! mv -f "$NESTED_BUILT_PROGRAM_PATH.new" "$NESTED_BUILT_PROGRAM_PATH"; then
  fatal "cannot replace the built program at $NESTED_BUILT_PROGRAM_PATH"
fi
run_in_bus_stage_with_service "$REBUILD_RUN" waits
rebuild_summary+=" exit=$NESTED_SERVICE_EXIT started=[$(grep '^program ' "$NESTED_SERVICE_CALLS")]"
end_recorded_stand_ins "$REBUILD_RUN"
check "nested: the run starts its own copy of the program: a rebuild after start copied it changes nothing in the run" \
  "$rebuild_summary" \
  "build=0 exit=0 started=[program $REBUILD_RUN/$NESTED_SAMPLER_PROGRAM_RELATIVE_PATH argc=0 args=[] build=$NESTED_BUILT_PROGRAM_LABEL]"

# The helper's directory is the sampler tables': the formula the sampler table documents, worked out here on its own,
# and the tables' default taken from the same helper, in the library every sampler table sources.
NESTED_CHECKOUT_ID="$(printf '%s' "$(cd "$REPO_ROOT/resource-pulse-sampler" && pwd -P)" | sha256sum | cut -c1-12)"
SAMPLER_TABLE_LIB_PATH="$REPO_ROOT/scripts/resource-pulse-sampler-table-lib.sh"
NESTED_HELPER_HOME="$WIRING_TMP/nested-helper-home"
helper_directory_summary="xdg=$([[ "$NESTED_BUILD_TARGET_DIR" == "$NESTED_BUILD_CACHE_HOME/resource-pulse/cargo-target-$NESTED_CHECKOUT_ID" ]] \
  && printf formula || printf 'other:%s' "$NESTED_BUILD_TARGET_DIR")"
helper_home_answer="$(env -u XDG_CACHE_HOME HOME="$NESTED_HELPER_HOME" bash "$NESTED_CARGO_TARGET_DIR_HELPER")"
helper_directory_summary+=" home=$([[ "$helper_home_answer" == "$NESTED_HELPER_HOME/.cache/resource-pulse/cargo-target-$NESTED_CHECKOUT_ID" ]] \
  && printf formula || printf 'other:%s' "$helper_home_answer")"
# shellcheck disable=SC2016  # The library's own source text.
helper_directory_summary+=" table-helper=$(grep -c -x -F 'CARGO_TARGET_DIR_HELPER="$HERE/resource-pulse-cargo-target-dir.sh"' "$SAMPLER_TABLE_LIB_PATH")"
# shellcheck disable=SC2016
helper_directory_summary+=" table-default=$(grep -c -x -F '  CARGO_TARGET_DIR="$(bash "$CARGO_TARGET_DIR_HELPER")" || fatal "cannot work out this checkout'"'"'s cargo build directory"' "$SAMPLER_TABLE_LIB_PATH")"
check "nested: the build directory is the helper's, by the formula the sampler table documents (XDG_CACHE_HOME, else HOME/.cache), and the sampler table takes its default from the same helper" \
  "$helper_directory_summary" "xdg=formula home=formula table-helper=1 table-default=1"

# helper_refusal_verdict [env arguments...] -- [helper arguments...] prints exit/stderr lines/stdout bytes of the helper,
# and leaves its stderr in NESTED_HELPER_STDERR_FILE.
NESTED_HELPER_STDERR_FILE="$WIRING_TMP/nested-helper.err"
helper_refusal_verdict() {
  local -a env_arguments=()
  local helper_stdout helper_exit helper_stderr_file="$NESTED_HELPER_STDERR_FILE"
  while (( $# > 0 )) && [[ "$1" != -- ]]; do env_arguments+=("$1"); shift; done
  shift
  helper_stdout="$(env "${env_arguments[@]}" bash "$NESTED_CARGO_TARGET_DIR_HELPER" "$@" 2>"$helper_stderr_file")"
  helper_exit=$?
  printf '%s/%s/%s' "$helper_exit" "$(wc -l <"$helper_stderr_file")" "${#helper_stdout}"
}
helper_refusal_summary="none=$(helper_refusal_verdict -u XDG_CACHE_HOME -u HOME --)"
helper_refusal_summary+=" relative=$(helper_refusal_verdict XDG_CACHE_HOME=relative/cache --)"
helper_refusal_summary+=" argument=$(helper_refusal_verdict XDG_CACHE_HOME="$NESTED_BUILD_CACHE_HOME" -- --print)"
check "nested: the cargo-target-dir helper exits 2 with one line on stderr and nothing on stdout when it cannot work the directory out (no XDG_CACHE_HOME or HOME, a relative XDG_CACHE_HOME, an argument)" \
  "$helper_refusal_summary" "none=2/1/0 relative=2/1/0 argument=2/1/0"
check "nested: the cargo-target-dir helper refuses a relative HOME when XDG_CACHE_HOME is unset (exit 2, one line on stderr naming it, nothing on stdout)" \
  "$(helper_refusal_verdict -u XDG_CACHE_HOME HOME=relative/home --)/$(grep -c -F 'not an absolute path: relative/home/.cache' "$NESTED_HELPER_STDERR_FILE")" \
  "2/1/0/1"

# `start` and cargo, against a PATH of stand-ins for every tool start looks for but cargo (each records a call and
# exits 1) and the few real tools the script runs before it looks: without --replay it refuses at once, naming cargo,
# before making anything; with --replay it needs no cargo, and goes on to its next refusal (this base is too long for a
# run directory, so it refuses there; on a machine without dconf-service, at that check).
START_TOOLS_BIN="$WIRING_TMP/nested-start-tools-bin"
for start_stand_in_tool in gnome-shell dbus-daemon dbus-run-session gjs gsettings busctl jq; do
  # shellcheck disable=SC2016  # The stub's own source.
  install_stub "$START_TOOLS_BIN" "$start_stand_in_tool" "$(printf '#!/bin/bash\nprintf "%%s %%s\\n" %s "$*" >>"$NESTED_STUB_CALLS"\nexit 1' "$start_stand_in_tool")"
done
for start_real_tool in bash readlink dirname stat setsid timeout mktemp sed rm; do
  ln -sf "$(command -v "$start_real_tool")" "$START_TOOLS_BIN/$start_real_tool" \
    || fatal "cannot link $start_real_tool into $START_TOOLS_BIN"
done
[[ ! -e "$START_TOOLS_BIN/cargo" ]] || fatal "$START_TOOLS_BIN must hold no cargo"
# start_without_cargo_verdict <needle> <start options...> prints exit/needle count/"cargo is required" count/what is
# left under the base/stand-in calls.
start_without_cargo_verdict() {
  local start_needle="$1" start_output start_exit
  shift
  : >"$NESTED_STUB_CALLS"
  start_output="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" PATH="$START_TOOLS_BIN" \
    NESTED_STUB_CALLS="$NESTED_STUB_CALLS" RESOURCE_PULSE_NESTED_BASE="$NESTED_BASE" \
    "$START_TOOLS_BIN/bash" "$NESTED_SCRIPT" start "$@" 2>&1)"
  start_exit=$?
  printf '%s/%s/%s/%s/%s' "$start_exit" "$(grep -c -E "$start_needle" <<<"$start_output")" \
    "$(grep -c -F 'cargo is required' <<<"$start_output")" "$(find "$NESTED_BASE" -mindepth 1 | wc -l)" \
    "$(nested_stub_call_count)"
}
check "nested: start without --replay refuses (exit 2) with no cargo on PATH, naming it, before making anything or calling any tool" \
  "$(start_without_cargo_verdict 'resource-pulse-nested: cargo is required')" "2/1/1/0/0"
check "nested: start --replay needs no cargo: it goes past the tool checks to its next refusal (exit 2), and makes nothing" \
  "$(start_without_cargo_verdict 'must be at most|dconf-service is required' --replay)" "2/1/0/0/0"

# Where start builds: after it lays out and records the run, and before it launches anything, so a build that fails
# leaves nothing running. Read from start's definition (as `declare -f` prints it), since a row cannot run start that
# far here (past the build it launches a real nested shell). The record and build lines are matched whole (-x), so the
# build cannot pass in the background (a trailing &), in a subshell, or moved into a block (its indentation changes):
# each would let refuse_run's exit end only that job or subshell while start went on to launch. Each of the build and
# the launch is in the definition once, so a second call elsewhere cannot hide behind the first. What this row cannot
# see: whether build_run_sampler_program itself exits on a failure (its rows above hold exit 2 for each refusal).
START_DEFINITION="$(nested_call declare -f start_subcommand)"
# definition_line_of <-x or -F> <fixed text> prints the first line of start's definition that is it (-x) or holds it
# (-F), 0 when none does.
definition_line_of() {
  local found_line match_option="$1" fixed_text="$2"
  if [[ "$match_option" == -x ]]; then
    found_line="$(grep -n -m 1 -x -F -- "$fixed_text" <<<"$START_DEFINITION" | cut -d: -f1)"
  else
    found_line="$(grep -n -m 1 -F -- "$fixed_text" <<<"$START_DEFINITION" | cut -d: -f1)"
  fi
  printf '%s' "${found_line:-0}"
}
# shellcheck disable=SC2016  # start's own source text.
START_RECORD_LINE="$(definition_line_of -x '    if ! record_requested_start_options "$run_dir"; then')"
# shellcheck disable=SC2016
START_BUILD_LINE="$(definition_line_of -x '    is_replay_requested_at_start || build_run_sampler_program "$run_dir";')"
# shellcheck disable=SC2016
START_LAUNCH_LINE="$(definition_line_of -F 'bash "$SCRIPT_PATH" __supervise "$run_dir"')"
start_order_summary="found=$( (( START_RECORD_LINE > 0 && START_BUILD_LINE > 0 && START_LAUNCH_LINE > 0 )) && printf all || printf missing)"
start_order_summary+=" order=$( (( START_RECORD_LINE < START_BUILD_LINE && START_BUILD_LINE < START_LAUNCH_LINE )) \
  && printf record-build-launch || printf other)"
start_order_summary+=" builds=$(grep -c -F 'build_run_sampler_program' <<<"$START_DEFINITION")"
start_order_summary+=" launches=$(grep -c -F '__supervise' <<<"$START_DEFINITION")"
check "nested: start builds the program, only without --replay, in its own foreground, after it lays out and records the run and before it launches anything (read from its definition, whole lines)" \
  "$start_order_summary" "found=all order=record-build-launch builds=1 launches=1"

# Where start checks the shell it launched: its isolation and its monitor's scale, both on the verified bus, after the
# address is verified and before it reports the run, in one condition whose failure stops the run with exit 2. Read
# from start's definition, whole lines, as above: a row cannot run start that far. Without the scale check, a monitor
# Mutter left at 1 would run on, and perf's header, which prints the recorded scale, would name a scale not drawn.
# shellcheck disable=SC2016  # start's own source text.
START_ADDRESS_LINE="$(definition_line_of -F 'address="$(verified_session_address "$run_dir")"')"
# shellcheck disable=SC2016
START_CONFIRM_TEXT='    if ! confirm_nested_shell_isolation "$run_dir" "$address"'
# shellcheck disable=SC2016
START_CONFIRM_TEXT+=' || ! confirm_nested_monitor_scale "$run_dir" "$address"; then'
START_CONFIRM_LINE="$(definition_line_of -x "$START_CONFIRM_TEXT")"
# shellcheck disable=SC2016
START_REPORT_LINE="$(definition_line_of -F 'note "running for at most $lifetime_seconds s; run directory: $run_dir"')"
start_confirm_summary="found=$( (( START_ADDRESS_LINE > 0 && START_CONFIRM_LINE > 0 && START_REPORT_LINE > 0 )) \
  && printf all || printf missing)"
start_confirm_summary+=" order=$( (( START_ADDRESS_LINE < START_CONFIRM_LINE )) \
  && (( START_CONFIRM_LINE < START_REPORT_LINE )) && printf address-confirm-report || printf other)"
# The two lines after the condition: the run stopped, then exit 2.
START_FAILURE_LINES="$((START_CONFIRM_LINE + 1)),$((START_CONFIRM_LINE + 2))p"
start_confirm_summary+=" on-failure=[$(sed -n "$START_FAILURE_LINES" <<<"$START_DEFINITION" | tr '\n' ' ' | tr -s ' ')]"
start_confirm_summary+=" scale-checks=$(grep -c -F 'confirm_nested_monitor_scale' <<<"$START_DEFINITION")"
check "nested: start checks the launched shell's isolation and its monitor's scale after verifying its bus and before reporting the run, and stops the run with exit 2 when either fails (read from its definition, whole lines)" \
  "$start_confirm_summary" \
  "found=all order=address-confirm-report on-failure=[ stop_run \"\$run_dir\"; exit \"\$EXIT_REFUSED\"; ] scale-checks=1"
rm -rf "$WIRING_TMP/service-runs/rpn.Build001" "$FAILED_BUILD_RUN" "$NO_PROGRAM_BUILD_RUN" "$REBUILD_RUN" "$NESTED_BUILD_CACHE_HOME"

# stop_with_recorded_sleep_in_session <process name> <run suffix>: a session led
# by the run's timeout, whose child bash runs a `sleep` recorded as <process
# name>, is stopped. Prints stop's exit, whether that sleep ended, and whether
# stop returned before STOP_GRACE_SECONDS: without its own SIGTERM the sleep
# would linger that long, until the session sweep.
stop_with_recorded_sleep_in_session() {
  local process_name="$1" run_dir="$NESTED_BASE/rpn.$2" sleep_pid_file="$SACRIFICE_DIR/$1-sleep.pid"
  local session_id session_starttime sleep_pid sleep_starttime stop_started_seconds stop_elapsed_seconds
  local sleep_fate stop_timing
  # shellcheck disable=SC2016  # Expanded by the sacrificial session's own bash.
  session_id="$(start_sacrificial_session timeout 60 bash -c 'sleep 60 & printf "%s\n" "$!" >"$1"; wait' \
    "sacrificial-$process_name" "$sleep_pid_file")"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -s "$sleep_pid_file" && "$(cat "/proc/$session_id/comm" 2>/dev/null)" == timeout ]] && break
    sleep 0.1
  done
  sleep_pid="$(cat "$sleep_pid_file")"
  session_starttime="$(starttime_of "$session_id")"
  sleep_starttime="$(starttime_of "$sleep_pid")"
  make_run_dir "$run_dir" "launcher=$session_id" "launcher-starttime=$session_starttime" \
    "session=$session_id" "supervisor=$session_id" "supervisor-starttime=$session_starttime" \
    "$process_name=$sleep_pid" "$process_name-starttime=$sleep_starttime"
  stop_started_seconds=$SECONDS
  NESTED_RUN_DIR="$run_dir" nested_run stop
  stop_elapsed_seconds=$((SECONDS - stop_started_seconds))
  sleep_fate="$(is_running "$sleep_pid" && printf left-running || printf ended)"
  stop_timing="$( (( stop_elapsed_seconds < NESTED_STOP_GRACE_SECONDS )) && printf at-once || printf 'after-%ss' "$stop_elapsed_seconds")"
  kill_sacrifice "$sleep_pid" sleep "$sleep_starttime"
  kill_sacrifice "$session_id" timeout "$session_starttime"
  rm -rf "$run_dir"
  printf '%s/%s/%s' "$NESTED_EXIT" "$sleep_fate" "$stop_timing"
}

# `stop` ends the recorded service in the run's session at once, and never one
# outside it. (1) A session led by the run's timeout, whose child bash runs a
# `sleep` recorded as the service. (2) A session led by the run's timeout (also
# recorded as its gnome-shell, so it ends at once), whose recorded service is a
# process of ANOTHER session: that one must be left running.
service_stop_summary="in-session=$(stop_with_recorded_sleep_in_session service SvcStop1)"
outside_service_id="$(start_sacrificial_session sleep 60)"
outside_service_starttime="$(starttime_of "$outside_service_id")"
outside_run_session_id="$(start_sacrificial_session timeout 60 sleep 60)"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ "$(cat "/proc/$outside_run_session_id/comm" 2>/dev/null)" == timeout ]] && break
  sleep 0.1
done
outside_run_session_starttime="$(starttime_of "$outside_run_session_id")"
OUTSIDE_SERVICE_RUN="$NESTED_BASE/rpn.SvcStop2"
make_run_dir "$OUTSIDE_SERVICE_RUN" "launcher=$outside_run_session_id" \
  "launcher-starttime=$outside_run_session_starttime" "session=$outside_run_session_id" \
  "supervisor=$outside_run_session_id" "supervisor-starttime=$outside_run_session_starttime" \
  "gnome-shell=$outside_run_session_id" "gnome-shell-starttime=$outside_run_session_starttime" \
  "service=$outside_service_id" "service-starttime=$outside_service_starttime"
NESTED_RUN_DIR="$OUTSIDE_SERVICE_RUN" nested_run stop
service_stop_summary+=" outside=$NESTED_EXIT/$(is_running "$outside_service_id" && printf left-running || printf ended)"
kill_sacrifice "$outside_service_id" sleep "$outside_service_starttime"
kill_sacrifice "$outside_run_session_id" timeout "$outside_run_session_starttime"
check "nested: stop ends the run's recorded service in its session at once, and leaves one in another session alone" \
  "$service_stop_summary" "in-session=0/ended/at-once outside=0/left-running"
rm -rf "$OUTSIDE_SERVICE_RUN"

check "nested: stop ends the run's recorded cockpit in its session at once" \
  "$(stop_with_recorded_sleep_in_session cockpit CkptStop1)" "0/ended/at-once"

# The run's fixture is rewritten in one rename (the cockpit service reads it
# again on change): a jq program that fails leaves it as it was, and neither
# leaves a staging file; restore puts back the copy start wrote. On the
# fixture written above. This row runs the real jq.
fixture_before_rewrite="$(<"$FIXTURE_WRITE_PATH")"
# shellcheck disable=SC2016  # A jq program: jq binds $pid.
nested_call replace_run_cockpit_fixture "$FIXTURE_WRITE_RUN" '.focusReply.windowPidCandidates = [$pid]' --argjson pid 77
fixture_rewrite_summary="good=$?/$(jq -c '.focusReply.windowPidCandidates' "$FIXTURE_WRITE_PATH")"
fixture_after_good="$(<"$FIXTURE_WRITE_PATH")"
nested_call replace_run_cockpit_fixture "$FIXTURE_WRITE_RUN" '.focusReply | error("refused")' 2>/dev/null
fixture_rewrite_summary+=" failing=$?/$([[ "$(<"$FIXTURE_WRITE_PATH")" == "$fixture_after_good" ]] && printf unchanged || printf changed)"
nested_call restore_run_cockpit_fixture "$FIXTURE_WRITE_RUN"
fixture_rewrite_summary+=" restored=$?/$([[ "$(<"$FIXTURE_WRITE_PATH")" == "$fixture_before_rewrite" ]] && printf as-written || printf other)"
fixture_rewrite_summary+=" staging-left=$(find "$FIXTURE_WRITE_RUN/state" -name 'cockpit-fixture.json.*' | wc -l)"
check "nested: the run's fixture is rewritten in one rename, left as it was by a jq program that fails, put back as start wrote it, and no staging file is left (needs jq)" \
  "$fixture_rewrite_summary" "good=0/[77] failing=1/unchanged restored=0/as-written staging-left=0"

# What the check reads in the shell's log (shell_log_faults): an error of the
# extension (its prefix with a CRITICAL or ERROR mark; console.warn's WARNING
# lines are not faults), a JS ERROR whose stack names the extension (another
# component's is not), Clutter's reparenting warnings and Mutter's activation
# warnings (a focus time ahead of the comparison timestamp included; "This
# shouldn't happen", a text libmutter-18 does not hold, is no needle), each only
# of the kinds asked for and only past the offset. A log it cannot read fails:
# never no faults.
SHELL_FAULTS_LOG="$WIRING_TMP/shell-faults.log"
{
  printf '%s\n' '(gnome-shell:7): Gjs-Console-WARNING **: 10:00:00.000: resource-pulse: could not start resource-pulse.service'
  printf '%s\n' '(gnome-shell:7): Gjs-Console-CRITICAL **: 10:00:01.000: resource-pulse: could not draw the cockpit layer: x'
  printf '%s\n' 'JS ERROR: TypeError: this._layer is null'
  printf '%s\n' '_onTick@file:///run/data/gnome-shell/extensions/resource-pulse@zvibaratz.github.io/extension.js:12:3'
  printf '%s\n' 'JS ERROR: Error: the panel is gone'
  printf '%s\n' '@resource:///org/gnome/shell/ui/panel.js:1:1'
  printf '%s\n' "(gnome-shell:7): Clutter-CRITICAL **: clutter_actor_add_child: assertion: the actor already has a parent"
  printf '%s\n' 'Window manager warning: Buggy client sent a _NET_ACTIVE_WINDOW message with a timestamp of 0 for 0x1'
  printf '%s\n' 'Window manager warning: last_user_time (9) is greater than comparison timestamp (0)'
  printf '%s\n' "Window manager warning: last_user_time (9) of the probe is more recent than the focus window's"
  printf '%s\n' 'Window manager warning: last_focus_time (9) is greater than comparison timestamp (0).  Trying to work around...'
  printf '%s\n' "Window manager warning: a state of the window it did not expect. This shouldn't happen"
} >"$SHELL_FAULTS_LOG"
shell_faults_offset_past_extension="$(head -n 6 "$SHELL_FAULTS_LOG" | wc -c)"
# shell_fault_kinds_found <offset> <kinds> prints how many faults of each kind it reports, or its failure.
shell_fault_kinds_found() {
  local fault_report
  fault_report="$(nested_call shell_log_faults "$SHELL_FAULTS_LOG" "$1" "$2")" || { printf 'failed'; return 0; }
  printf 'extension:%s,clutter:%s,mutter:%s' "$(grep -c '^extension: ' <<<"$fault_report")" \
    "$(grep -c '^clutter: ' <<<"$fault_report")" "$(grep -c '^mutter: ' <<<"$fault_report")"
}
shell_faults_summary="all=$(shell_fault_kinds_found 0 extension,clutter,mutter)"
shell_faults_summary+=" mutter-only=$(shell_fault_kinds_found 0 mutter)"
shell_faults_summary+=" past-offset=$(shell_fault_kinds_found "$shell_faults_offset_past_extension" extension,clutter)"
shell_faults_summary+=" js-error-named=$(nested_call shell_log_faults "$SHELL_FAULTS_LOG" 0 extension | grep -c -x -F \
  'extension: JS ERROR: TypeError: this._layer is null')"
# Each Mutter line by name: the count of mutter faults alone stays the same when a needle is swapped for another.
shell_faults_mutter_report="$(nested_call shell_log_faults "$SHELL_FAULTS_LOG" 0 mutter)"
shell_faults_summary+=" last-focus-time=$(grep -c -F 'mutter: Window manager warning: last_focus_time (9) is greater' \
  <<<"$shell_faults_mutter_report")"
shell_faults_summary+=" not-a-mutter-text=$(grep -c -F "This shouldn't happen" <<<"$shell_faults_mutter_report")"
if nested_call shell_log_faults "$WIRING_TMP/no-such-shell.log" 0 extension >/dev/null 2>&1
then shell_faults_summary+=" unreadable=passed"
else shell_faults_summary+=" unreadable=failed"; fi
shell_faults_summary+=" counted=$(nested_call count_log_lines_since "$SHELL_FAULTS_LOG" 0 'Window manager warning:')"
check "nested: the check finds the extension's error lines and a JS ERROR naming it (not a warning, not another's JS ERROR), Clutter's reparenting and Mutter's activation warnings (last_focus_time ahead of the comparison included, a text Mutter does not print not), each of the kinds asked for past the offset; an unreadable log fails" \
  "$shell_faults_summary" \
  "all=extension:2,clutter:1,mutter:4 mutter-only=extension:0,clutter:0,mutter:4 past-offset=extension:0,clutter:1,mutter:0 js-error-named=1 last-focus-time=1 not-a-mutter-text=0 unreadable=failed counted=5"

# The stacks the shell prints (shell_log_faults): a stack header is any line
# holding JS ERROR, "Unhandled promise rejection" or a GLib "-CRITICAL **" mark,
# and it is the extension's when a line of its stack (the lines up to the next
# header or log record, at most JS_ERROR_STACK_LINES) names the extension's
# uuid. A Gjs, GLib, GLib-GObject, Clutter or St critical that no stack ties
# to the extension is unattributed (the check cannot judge it, never ok and
# never bad), and only where the extension's faults are asked for. The stock
# shell's own startup noise (its criticals about login1 and CalendarServer, its
# own rejection in screenShield.js) names no uuid and stays clean, also with a
# line of the extension's (a JS WARNING naming its file) right after a stack.
# Each case is a log of its own, in the shapes GNOME Shell 50 prints, with
# blank lines where it prints them.
LOG_READER_DIR="$WIRING_TMP/log-reader"
mkdir -p "$LOG_READER_DIR" || fatal "cannot create $LOG_READER_DIR"
LOG_READER_FRAME_DIR='file:///run/data/gnome-shell/extensions/resource-pulse@zvibaratz.github.io'
LOG_READER_DISPOSED_TEXT='has been already disposed — impossible to set any property on it. This might be caused by the object having been destroyed from C code using something such as destroy(), dispose(), or remove() vfuncs.'
LOG_READER_REJECTION_TEXT='Unhandled promise rejection. To suppress this warning, add an error handler to your promise chain with .catch() or a try-catch block around your await expression. Stack trace of the failed promise:'
# log_reader_case <case> <kinds> <line...> writes the lines to the case's own log and prints
# <case>=extension:<n>,unattributed:<n> as shell_log_faults reads it with those kinds, or <case>=failed.
log_reader_case() {
  local case_name="$1" fault_kinds="$2" case_log fault_report
  shift 2
  case_log="$LOG_READER_DIR/$case_name.log"
  printf '%s\n' "$@" >"$case_log"
  fault_report="$(nested_call shell_log_faults "$case_log" 0 "$fault_kinds")" || { printf '%s=failed' "$case_name"; return 0; }
  printf '%s=extension:%s,unattributed:%s' "$case_name" "$(grep -c '^extension: ' <<<"$fault_report")" \
    "$(grep -c '^unattributed: ' <<<"$fault_report")"
}
log_reader_summary="$(log_reader_case rejection extension,clutter '' \
  "(gnome-shell:7): Gjs-WARNING **: 10:00:00.000: $LOG_READER_REJECTION_TEXT" \
  "_readState@$LOG_READER_FRAME_DIR/cockpitClient.js:120:9" '@resource:///org/gnome/shell/ui/init.js:21:20' '' '')"
log_reader_summary+=" $(log_reader_case disposed extension,clutter '' \
  "(gnome-shell:7): Gjs-CRITICAL **: 10:00:01.000: Object St.Label (0x5a1b2c3d4e50), $LOG_READER_DISPOSED_TEXT" \
  '== Stack trace for context 0x5a1b2c000f00 ==' \
  "#0   5a1b2c3d4000 i   $LOG_READER_FRAME_DIR/cockpitCards.js:88 (1c1f98c2bab0 @ 58)" \
  '#1   5a1b2c3d3f00 i   resource:///org/gnome/shell/ui/init.js:21 (16f6826fb7e0 @ 119)')"
LOG_READER_TOOLKIT_LINES=('' '(gnome-shell:7): GLib-CRITICAL **: 10:00:02.000: Source ID 4242 was not found when attempting to remove it'
  '' "(gnome-shell:7): Clutter-CRITICAL **: 10:00:02.100: clutter_actor_set_child_above_sibling: assertion 'sibling->priv->parent == self' failed"
  '' "(gnome-shell:7): St-CRITICAL **: 10:00:02.200: st_drawing_area_get_surface_size: assertion 'priv->in_repaint' failed"
  '' "(gnome-shell:7): GLib-GObject-CRITICAL **: 10:00:02.300: g_object_unref: assertion 'G_IS_OBJECT (object)' failed")
log_reader_summary+=" $(log_reader_case toolkit extension,clutter "${LOG_READER_TOOLKIT_LINES[@]}")"
log_reader_summary+=" $(log_reader_case toolkit-mutter-only mutter "${LOG_READER_TOOLKIT_LINES[@]}")"
log_reader_summary+=" $(log_reader_case another-stack extension,clutter '' \
  "(gnome-shell:7): Gjs-CRITICAL **: 10:00:03.000: Object St.BoxLayout (0x5a1b2c3d5000), $LOG_READER_DISPOSED_TEXT" \
  '== Stack trace for context 0x5a1b2c000f00 ==' \
  '#0   5a1b2c3d4000 i   resource:///org/gnome/shell/ui/ibusCandidatePopup.js:327 (1c1f98c2bab0 @ 58)')"
log_reader_summary+=" $(log_reader_case stock extension,clutter '' \
  '(gnome-shell:7): GNOME Shell-CRITICAL **: 10:00:04.000: Could not get a proxy for user 1000: Gio.DBusError: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.login1 was not provided by any .service files' \
  '' 'Stack trace:' '  asyncCallback@resource:///org/gnome/gjs/modules/core/overrides/Gio.js:115:23' \
  '  @resource:///org/gnome/shell/ui/init.js:20:20' '  ' '' \
  "(gnome-shell:7): Gjs-WARNING **: 10:00:04.100: $LOG_READER_REJECTION_TEXT" \
  '_getLoginSession@resource:///org/gnome/shell/ui/screenShield.js:163:27' \
  'ScreenShield@resource:///org/gnome/shell/ui/screenShield.js:114:14' '@resource:///org/gnome/shell/ui/init.js:20:20' \
  '' '' \
  '(gnome-shell:7): GNOME Shell-CRITICAL **: 10:00:04.200: Gio.DBusError: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name org.gnome.Shell.CalendarServer was not provided by any .service files' \
  '' 'Stack trace:' '  asyncCallback@resource:///org/gnome/gjs/modules/core/overrides/Gio.js:115:23' \
  '  @resource:///org/gnome/shell/ui/init.js:20:20' '  ' \
  "Gjs-Message: 10:00:04.300: JS WARNING: [$LOG_READER_FRAME_DIR/cockpitLayer.js 40]: Too many arguments to method Clutter.Actor.destroy: expected 0, got 1" \
  '' '(gnome-shell:7): GNOME Shell-WARNING **: 10:00:04.400: resource-pulse: StartUnit resource-pulse-cockpit.service failed: GDBus.Error:org.freedesktop.DBus.Error.NameHasNoOwner: Name "org.freedesktop.systemd1" does not exist')"
log_reader_summary+=" $(log_reader_case after-a-critical extension,clutter '' \
  '(gnome-shell:7): GLib-CRITICAL **: 10:00:05.000: Source ID 77 was not found when attempting to remove it' \
  '(gnome-shell:7): Gjs-CRITICAL **: 10:00:05.100: JS ERROR: TypeError: this._cells is undefined' \
  "_layOut@$LOG_READER_FRAME_DIR/cockpitLayer.js:77:5")"
log_reader_summary+=" named=$(nested_call shell_log_faults "$LOG_READER_DIR/after-a-critical.log" 0 extension | grep -c -x -F \
  'extension: (gnome-shell:7): Gjs-CRITICAL **: 10:00:05.100: JS ERROR: TypeError: this._cells is undefined')"
check "nested: the check's log reader takes an unhandled rejection and a disposed object's critical as the extension's when their stack names its uuid; a toolkit critical (Gjs, GLib, Clutter, St) no stack names it in, another's stack included, is unattributed where the extension's faults are asked for; the stock shell's startup noise is neither; a header ends the stack before it" \
  "$log_reader_summary" \
  "rejection=extension:1,unattributed:0 disposed=extension:1,unattributed:0 toolkit=extension:0,unattributed:4 toolkit-mutter-only=extension:0,unattributed:0 another-stack=extension:0,unattributed:1 stock=extension:0,unattributed:0 after-a-critical=extension:1,unattributed:1 named=1"

# A log step over unattributed toolkit criticals could not be judged, never ok
# and never bad: its line gives how many, and the first
# SHOWN_UNATTRIBUTED_LOG_LINES_LIMIT of them.
UNATTRIBUTED_LOG_RUN="$WIRING_TMP/unattributed-log-run"
mkdir -p "$UNATTRIBUTED_LOG_RUN/log" || fatal "cannot lay out $UNATTRIBUTED_LOG_RUN"
for unattributed_source_id in 1 2 3 4; do
  printf '(gnome-shell:7): GLib-CRITICAL **: 10:00:0%s.000: Source ID %s was not found when attempting to remove it\n' \
    "$unattributed_source_id" "$unattributed_source_id"
done >"$UNATTRIBUTED_LOG_RUN/log/shell.log"
# shellcheck disable=SC2016  # Expanded by the child bash.
unattributed_log_line="$(bash -c '
  source "$1" || exit 99
  CHECK_RUN_DIR="$2"
  begin_check_step
  note_shell_log_faults 0 extension,clutter
  end_check_step early-log "no fault found"
' unattributed-log "$NESTED_SCRIPT" "$UNATTRIBUTED_LOG_RUN" 2>/dev/null)"
UNATTRIBUTED_SHOWN_LINES=''
for unattributed_source_id in 1 2 3; do
  UNATTRIBUTED_SHOWN_LINES+="(gnome-shell:7): GLib-CRITICAL **: 10:00:0$unattributed_source_id.000: Source ID"
  UNATTRIBUTED_SHOWN_LINES+=" $unattributed_source_id was not found when attempting to remove it | "
done
check "nested: a log step over toolkit criticals no stack ties to the extension could not be judged, giving how many and the first three" \
  "$unattributed_log_line" \
  "could not judge early-log: 4 critical line(s) of the toolkit (Gjs, GLib, Clutter, St) in log/shell.log that no stack ties to the extension, so they may be its own: $UNATTRIBUTED_SHOWN_LINES"

# probe-window.js, the window `window` opens, refuses before Gtk is even loaded
# unless it runs in a nested run's own environment (the run named, its runtime
# dir exactly <run>/run, the nested Wayland display), and a title that is not a
# plain name. Each case runs under env -i with an empty runtime dir and no
# display, so even a broken guard could open nothing. Each prints exit/refusal.
PROBE_WINDOW_EMPTY_RUNTIME="$WIRING_TMP/probe-window-runtime"
if ! mkdir -p "$PROBE_WINDOW_EMPTY_RUNTIME" || ! chmod 700 "$PROBE_WINDOW_EMPTY_RUNTIME"; then
  fatal "cannot lay out $PROBE_WINDOW_EMPTY_RUNTIME"
fi
# probe_window_verdict <title or ''> <NAME=value...> prints exit/whether it said it refused.
probe_window_verdict() {
  local window_title="$1" probe_output
  shift
  probe_output="$(env -i "HOME=$WIRING_TMP" PATH=/usr/bin:/bin "XDG_RUNTIME_DIR=$PROBE_WINDOW_EMPTY_RUNTIME" "$@" \
    timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -m "$NESTED_FILES/probe-window.js" ${window_title:+"$window_title"} 2>&1)"
  printf '%s/%s' "$?" "$(grep -c -F 'probe-window: refusing: ' <<<"$probe_output")"
}
probe_window_summary="no-title=$(probe_window_verdict '')"
probe_window_summary+=" bad-title=$(probe_window_verdict '../window')"
probe_window_summary+=" outside-a-run=$(probe_window_verdict herdr-probe)"
probe_window_summary+=" runtime-not-the-run's=$(probe_window_verdict herdr-probe "RESOURCE_PULSE_NESTED_DIR=$PREPARED_RUN")"
probe_window_summary+=" live-display=$(probe_window_verdict herdr-probe "RESOURCE_PULSE_NESTED_DIR=$PREPARED_RUN" \
  "XDG_RUNTIME_DIR=$PREPARED_RUN/run" WAYLAND_DISPLAY=wayland-0)"
check "nested: probe-window.js refuses (exit 2) before loading Gtk outside a nested run's own environment (the run, its runtime dir, its Wayland display) and a title that is not a plain name" \
  "$probe_window_summary" \
  "no-title=2/1 bad-title=2/1 outside-a-run=2/1 runtime-not-the-run's=2/1 live-display=2/1"

# This table's own total. The guide states it.
EXPECTED_ROWS=65

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
