#!/usr/bin/env bash
#
# scripts/test-resource-pulse-nested-check.sh
# ===========================================
#
# State table for the Resource Pulse nested-shell harness (scripts/resource-pulse-nested.sh), third of four:
# window, pointer and check cockpit, against stand-ins that answer for the nested shell. Their usage and refusals;
# window's isolation and records, and stop's end of the windows; pointer; and check cockpit: each of its steps,
# its passes in one run and the shell log each one reads, its layer-readd and dropdown steps, and every case it
# could not judge.
#
# "Could not run" is exit 2, never a pass: a missing find, timeout, setsid or jq, or a stand-in that could not be
# laid out, is fatal. The table asserts its own row total.
#
# Its shared helpers and constants are scripts/resource-pulse-table-lib.sh's, and the nested harness's fixtures
# (its stubs, its run directories, the sacrificial sessions, the fake gnome-shell)
# scripts/resource-pulse-nested-table-lib.sh's.
# The check's stand-ins (a busctl answering the in-shell requests, a gjs standing in for the probe window, the live
# run they act on) are scripts/resource-pulse-check-table-lib.sh's.
#
# Requires: bash, find, timeout, setsid (util-linux) and jq. No network, no gnome-shell.
#
# Usage: scripts/test-resource-pulse-nested-check.sh
#   RESOURCE_PULSE_EXT_DIR=<dir> points the row that reads lib/constants.js at a copy of the extension (for a
#   mutation trial).

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
CHECK_TABLE_LIB="$HERE/resource-pulse-check-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-check-table-lib.sh
source "$CHECK_TABLE_LIB" || fatal "cannot source $CHECK_TABLE_LIB"

[[ -d "$EXT_DIR" ]] || fatal "no extension directory at $EXT_DIR"
require_tools find timeout setsid jq
start_nested_harness
start_check_stand_ins

printf '\nresource-pulse-nested.sh window, pointer and check cockpit (hermetic: stand-ins answer for the nested shell)\n'
check_stub_run "$CHECK_ANSWERS"
usage_summary="window=$(grep -c -x -F '       scripts/resource-pulse-nested.sh window <title>' <<<"$CHECK_STUB_OUTPUT")"
usage_summary+=" pointer=$(grep -c -x -F '       scripts/resource-pulse-nested.sh pointer <x> <y> [click]' <<<"$CHECK_STUB_OUTPUT")"
usage_summary+=" check=$(grep -c -x -F '       scripts/resource-pulse-nested.sh check cockpit' <<<"$CHECK_STUB_OUTPUT")"
check "nested: the usage lists window <title>, pointer <x> <y> [click] and check cockpit" "$usage_summary" \
  "window=1 pointer=1 check=1"

# Refusals, each before the stand-in gjs starts or busctl is asked anything it
# acts with. Each prints exit/its own message/busctl calls/windows started.
# check_refusal_verdict <needle> <fixture: yes, no or none (no run)> <args...> [-- run values...]
check_refusal_verdict() {
  local refusal_needle="$1" run_kind="$2"
  shift 2
  local -a script_args=() extra_run_values=()
  while (( $# > 0 )) && [[ "$1" != -- ]]; do script_args+=("$1"); shift; done
  [[ "${1:-}" == -- ]] && shift && extra_run_values=("$@")
  : >"$CHECK_WINDOW_LAUNCHES"
  if [[ "$run_kind" == none ]]; then
    rm -rf "$CHECK_RUN"
    CHECK_STUB_RUN_DIR=""
  else
    make_check_run "$run_kind" "${extra_run_values[@]}"
    CHECK_STUB_RUN_DIR="$CHECK_RUN"
  fi
  check_stub_run "$CHECK_ANSWERS" "${script_args[@]}"
  CHECK_STUB_RUN_DIR=""
  printf '%s/%s/%s/%s' "$CHECK_STUB_EXIT" "$(grep -c -F "$refusal_needle" <<<"$CHECK_STUB_OUTPUT")" \
    "$(check_stub_call_count '^resourcePulse')" "$(wc -l <"$CHECK_WINDOW_LAUNCHES")"
}
window_refusal_summary="bad-title=$(check_refusal_verdict 'a window title is a plain name' none window ../herdr)"
window_refusal_summary+=" two-titles=$(check_refusal_verdict 'window takes one title' none window a b)"
window_refusal_summary+=" no-run=$(check_refusal_verdict 'no live run' none window herdr-probe)"
window_refusal_summary+=" no-fixture=$(check_refusal_verdict 'not started in fixture mode' no window herdr-probe)"
check "nested: window refuses (exit 2) a title that is not a plain name or a second word (before looking for a run), no live run, and a run whose cockpit is not in fixture mode, asking the shell nothing and opening nothing" \
  "$window_refusal_summary" "bad-title=2/1/0/0 two-titles=2/1/0/0 no-run=2/1/0/0 no-fixture=2/1/0/0"

pointer_refusal_summary="no-y=$(check_refusal_verdict 'pointer takes x y' none pointer 10)"
pointer_refusal_summary+=" negative=$(check_refusal_verdict 'a point is two numbers' none pointer -1 5)"
pointer_refusal_summary+=" leading-zero=$(check_refusal_verdict 'a point is two numbers' none pointer 007 5)"
pointer_refusal_summary+=" exponent=$(check_refusal_verdict 'a point is two numbers' none pointer 1e3 5)"
pointer_refusal_summary+=" not-click=$(check_refusal_verdict 'pointer takes click after the point' none pointer 10 10 tap)"
pointer_refusal_summary+=" no-run=$(check_refusal_verdict 'no live run' none pointer 10 10)"
pointer_refusal_summary+=" click-no-fixture=$(check_refusal_verdict 'refusing to click' no pointer 10 10 click)"
check "nested: pointer refuses (exit 2) words that are not a point or click (before looking for a run), no live run, and a click in a run whose cockpit is not in fixture mode, asking the shell nothing" \
  "$pointer_refusal_summary" \
  "no-y=2/1/0/0 negative=2/1/0/0 leading-zero=2/1/0/0 exponent=2/1/0/0 not-click=2/1/0/0 no-run=2/1/0/0 click-no-fixture=2/1/0/0"

check_refusal_summary="alone=$(check_refusal_verdict 'check takes one word: cockpit' none check)"
check_refusal_summary+=" other-word=$(check_refusal_verdict 'check takes one word: cockpit' none check perf)"
check_refusal_summary+=" no-run=$(check_refusal_verdict 'no live run' none check cockpit)"
check_refusal_summary+=" no-fixture=$(check_refusal_verdict 'not started in fixture mode' no check cockpit)"
check_refusal_summary+=" cockpit-gone=$(check_refusal_verdict "cockpit service is not running" yes check cockpit -- \
  "cockpit=$NEVER_RUNNING_PID")"
check_refusal_summary+=" no-gc-log=$(check_refusal_verdict 'was not started with --gc-log' yes check cockpit -- replay=1)"
check_refusal_summary+=" no-replay=$(check_refusal_verdict 'was not started with --replay' yes check cockpit -- gc-log=1)"
two_windows_answers="$(answers_with two-windows resourcePulseCockpitCheck.window-count \
  '{"verdict":"ok","detail":"2 normal windows","count":2}')"
make_check_run yes gc-log=1 replay=1
CHECK_STUB_RUN_DIR="$CHECK_RUN"
check_stub_run "$two_windows_answers" check cockpit
CHECK_STUB_RUN_DIR=""
check_refusal_summary+=" windows-open=$CHECK_STUB_EXIT/$(grep -c -F 'has 2 window(s) already' <<<"$CHECK_STUB_OUTPUT")"
check_refusal_summary+="/$(check_stub_call_count '^resourcePulseCockpitCheck window-count$')/$(check_stub_call_count '^resourcePulse')"
check "nested: check takes the one word cockpit, and refuses (exit 2) no live run, a run whose cockpit is not in fixture mode or not running, a run started without --gc-log or --replay (its perf pass needs both), and a session with windows already, before it clicks anything" \
  "$check_refusal_summary" \
  "alone=2/1/0/0 other-word=2/1/0/0 no-run=2/1/0/0 no-fixture=2/1/0/0 cockpit-gone=2/1/0/0 no-gc-log=2/1/0/0 no-replay=2/1/0/0 windows-open=2/1/1/1"

# window on a live fixture run: the stand-in started as probe-window.js with
# the title, with only the run's environment plus its Wayland display, backend
# and private bus; recorded by pid and start time; named as the fixture's one
# candidate; its pid printed. The caller is poisoned (the barrier's session bus,
# a display, a Wayland display, a token): the window must get the run's bus,
# runtime dir and display, the Wayland backend, and none of the caller's. A
# title open already is refused; one that never appears is ended and forgotten.
make_check_run yes
CHECK_STUB_RUN_DIR="$CHECK_RUN"
: >"$CHECK_WINDOW_ENV_VALUES"
CHECK_STUB_CALLER_DECOYS=(DISPLAY=:99 WAYLAND_DISPLAY=wayland-decoy GH_TOKEN=decoy-token-must-not-arrive)
check_stub_run "$CHECK_ANSWERS" window herdr-probe
CHECK_STUB_CALLER_DECOYS=()
window_open_exit=$CHECK_STUB_EXIT
window_pid="$(tail -n 1 <<<"$CHECK_STUB_OUTPUT")"
window_summary="exit=$window_open_exit pid=$([[ "$window_pid" =~ ^[1-9][0-9]*$ ]] && printf printed || printf "'%s'" "$window_pid")"
window_summary+=" recorded=$([[ "$(cat "$CHECK_RUN/state/windows/herdr-probe.pid" 2>/dev/null)" == "$window_pid" ]] \
  && printf pid || printf none)+$([[ "$(cat "$CHECK_RUN/state/windows/herdr-probe.starttime" 2>/dev/null)" == \
  "$(starttime_of "$window_pid")" ]] && printf starttime || printf none)"
window_summary+=" candidates=$([[ "$(jq -c '.focusReply.windowPidCandidates' "$CHECK_RUN_FIXTURE")" == "[$window_pid]" ]] \
  && printf the-pid || printf other)/$(jq -c '.focusReply.focused' "$CHECK_RUN_FIXTURE")"
window_summary+=" launched=[$(sed "s|$NESTED_FILES/||" "$CHECK_WINDOW_LAUNCHES")]"
window_summary+=" asked=$(check_stub_call_count '^resourcePulseCockpitCheck window-shown$')"
window_expected_names="$( { nested_call nested_environment_assignments "$CHECK_RUN" | cut -d= -f1
  printf '%s\n' WAYLAND_DISPLAY GDK_BACKEND DBUS_SESSION_BUS_ADDRESS PWD SHLVL
} | LC_ALL=C sort -u)"
window_summary+=" env-unexpected=[$(LC_ALL=C comm -13 <(printf '%s\n' "$window_expected_names") "$CHECK_WINDOW_ENV_NAMES" \
  | tr '\n' ' ')] env-missing=[$(LC_ALL=C comm -23 <(printf '%s\n' "$window_expected_names") "$CHECK_WINDOW_ENV_NAMES" \
  | tr '\n' ' ')]"
window_summary+=" values=[$(tr '\n' ' ' <"$CHECK_WINDOW_ENV_VALUES")]"
check_stub_run "$CHECK_ANSWERS" window herdr-probe
window_summary+=" again=$CHECK_STUB_EXIT/$(grep -c -F 'is open already' <<<"$CHECK_STUB_OUTPUT")"
nested_call end_recorded_windows "$CHECK_RUN"
for _ in 1 2 3 4 5 6 7 8 9 10; do is_running "$window_pid" || break; sleep 0.1; done
window_summary+=" ended=$(is_running "$window_pid" && printf no || printf yes)/$(find "$CHECK_RUN/state/windows" -type f | wc -l)"
no_window_answers="$(answers_with no-window resourcePulseCockpitCheck.window-shown \
  '{"verdict":"bad","detail":"no window of pid 1 yet"}')"
: >"$CHECK_WINDOW_LAUNCHES"
check_stub_sourced "$no_window_answers" window_subcommand herdr-probe
CHECK_STUB_RUN_DIR=""
window_summary+=" never-shown=$CHECK_STUB_EXIT/$(grep -c -F 'did not appear' <<<"$CHECK_STUB_OUTPUT")"
window_summary+="/$(find "$CHECK_RUN/state/windows" -type f | wc -l)/$(wc -l <"$CHECK_WINDOW_LAUNCHES")"
CHECK_RUN_BUS_LINE="unix:path=$CHECK_RUN/bus/session.sock,guid=0123456789abcdef"
CHECK_WINDOW_WANTED_VALUES="XDG_RUNTIME_DIR=$CHECK_RUN/run DBUS_SESSION_BUS_ADDRESS=$CHECK_RUN_BUS_LINE"
CHECK_WINDOW_WANTED_VALUES+=" WAYLAND_DISPLAY=rp-nested-0 GDK_BACKEND=wayland "
check "nested: window opens probe-window.js with its title as a client of the run alone (its environment plus the nested display, backend and bus: their values the run's, from a caller with a bus, a display and a token of its own), records it by pid and start time, names it the fixture's one candidate and prints its pid; a title open already is refused, and one that never appears is ended and forgotten" \
  "$window_summary" \
  "exit=0 pid=printed recorded=pid+starttime candidates=the-pid/true launched=[-m probe-window.js herdr-probe] asked=1 env-unexpected=[] env-missing=[] values=[$CHECK_WINDOW_WANTED_VALUES] again=2/1 ended=yes/0 never-shown=2/1/0/1"

# stop ends every window the run recorded, only while each is still the
# process recorded (pid and start time): a recorded pid now another process's
# is left alone. On a run whose session is gone, which stop only cleans up.
STOP_WINDOWS_RUN="$NESTED_BASE/rpn.StopWin1"
stop_window_id="$(start_sacrificial_session sleep 60)"
stop_window_starttime="$(starttime_of "$stop_window_id")"
reused_window_id="$(start_sacrificial_session sleep 60)"
reused_window_starttime="$(starttime_of "$reused_window_id")"
make_run_dir "$STOP_WINDOWS_RUN" "launcher=$NEVER_RUNNING_PID" "session=$NEVER_RUNNING_PID"
mkdir -p "$STOP_WINDOWS_RUN/state/windows" || fatal "cannot lay out $STOP_WINDOWS_RUN"
printf '%s\n' "$stop_window_id" >"$STOP_WINDOWS_RUN/state/windows/herdr-probe.pid"
printf '%s\n' "$stop_window_starttime" >"$STOP_WINDOWS_RUN/state/windows/herdr-probe.starttime"
printf '%s\n' "$reused_window_id" >"$STOP_WINDOWS_RUN/state/windows/rp-decoy.pid"
printf '%s\n' "$((reused_window_starttime + 1))" >"$STOP_WINDOWS_RUN/state/windows/rp-decoy.starttime"
NESTED_RUN_DIR="$STOP_WINDOWS_RUN" nested_run stop
for _ in 1 2 3 4 5 6 7 8 9 10; do is_running "$stop_window_id" || break; sleep 0.1; done
stop_windows_summary="exit=$NESTED_EXIT recorded=$(is_running "$stop_window_id" && printf left-running || printf ended)"
stop_windows_summary+=" reused=$(is_running "$reused_window_id" && printf left-running || printf ended)"
stop_windows_summary+=" records=$(find "$STOP_WINDOWS_RUN/state/windows" -type f | wc -l)"
kill_sacrifice "$stop_window_id" sleep "$stop_window_starttime"
kill_sacrifice "$reused_window_id" sleep "$reused_window_starttime"
check "nested: stop ends each window the run recorded while it is still that process, leaves a reused pid alone, and forgets them all" \
  "$stop_windows_summary" "exit=0 recorded=ended reused=left-running records=0"
rm -rf "$STOP_WINDOWS_RUN"

# pointer on a live fixture run: a move, or a click, through pointer.js, then
# `at` until the shell moved it; one that never arrives is exit 2, naming the
# headless backend.
make_check_run yes
CHECK_STUB_RUN_DIR="$CHECK_RUN"
check_stub_run "$CHECK_ANSWERS" pointer 10.5 20 click
pointer_summary="click=$CHECK_STUB_EXIT/$(grep -c -x -F 'pointer at (10.5, 20), clicked' <<<"$CHECK_STUB_OUTPUT")"
pointer_summary+="/[$(tr '\n' ' ' <"$CHECK_CALLS")]"
stuck_answers="$(answers_with stuck resourcePulseNestedPointer.at \
  '{"verdict":"bad","detail":"the pointer is at (0, 0), not (10, 20)"}')"
check_stub_sourced "$stuck_answers" pointer_subcommand 10 20
CHECK_STUB_RUN_DIR=""
pointer_summary+=" stuck=$CHECK_STUB_EXIT/$(grep -c -F 'the headless backend may not take a virtual pointer' <<<"$CHECK_STUB_OUTPUT")"
pointer_summary+="/$(check_stub_call_count '^resourcePulseNestedPointer at$')"
check "nested: pointer moves (and clicks) through pointer.js, then waits until the shell moved it; a pointer that never arrives is exit 2, naming the headless backend" \
  "$pointer_summary" \
  "click=0/1/[resourcePulseNestedPointer click resourcePulseNestedPointer at ] stuck=2/1/20"

# check cockpit on a live fixture run, every step answered ok by the stand-in
# (and perf, overridden here, passing; the waits skipped): one ok line per step
# in the order the harness runs them, exit 0, the windows it
# opened ended and the run's fixture put back. Then one bad answer (exit 1,
# naming the step, every other step still run), one that could not be judged
# (exit 2), both (exit 1), and a log without the provoked focus lines.
CHECK_STEP_NAMES="extension early-log layer grid apps-rows interactive hover windows click click-log click-show-desktop"
CHECK_STEP_NAMES+=" click-no-window click-no-window-again click-not-focused click-twice cover cover-holds-changes reveal"
CHECK_STEP_NAMES+=" visible-change stale stale-recovers layer-readd dropdown-order dropdown-open dropdown-tooltip"
CHECK_STEP_NAMES+=" dropdown-closed dropdown-change dropdown-click lock-path screenshot log count-budgets"
# check_steps_seen prints the step names of the output's step lines, in order.
check_steps_seen() {
  sed -n -E 's/^(ok|bad|could not judge) ([a-z-]+): .*/\2/p' <<<"$CHECK_STUB_OUTPUT" | tr '\n' ' '
}
check_cockpit_stubbed "$CHECK_ANSWERS"
healthy_check_summary="exit=$CHECK_STUB_EXIT steps=[$(check_steps_seen)]"
healthy_check_summary+=" ok=$(grep -c '^ok ' <<<"$CHECK_STUB_OUTPUT")"
healthy_check_summary+=" summary=$(grep -c -x -F 'check cockpit: 32 ok, 0 bad, 0 could not judge' <<<"$CHECK_STUB_OUTPUT")"
healthy_check_summary+=" windows-opened=$(wc -l <"$CHECK_WINDOW_LAUNCHES")"
healthy_check_summary+=" windows-left=$(find "$CHECK_RUN/state/windows" -type f 2>/dev/null | wc -l)"
healthy_check_summary+=" fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed)"
healthy_check_summary+=" perf=$(grep -c -x -F 'perf: cockpit: PASS: as the stand-in judges' <<<"$CHECK_STUB_OUTPUT")"
healthy_check_summary+=" lock-path=$(check_stub_call_count '^resourcePulseCockpitCheck lock-path$')"
healthy_check_summary+=" clicks=$(check_stub_call_count '^resourcePulseNestedPointer click$')"
check "nested: check cockpit, every request answered ok, prints one ok line per step in the notes' order and exits 0, ending its windows and putting the run's fixture back" \
  "$healthy_check_summary" \
  "exit=0 steps=[$CHECK_STEP_NAMES ] ok=32 summary=1 windows-opened=2 windows-left=0 fixture=restored perf=1 lock-path=1 clicks=7"
# Before its screenshot the check moves the pointer off the grid, to its rest point (4 px in from the stage's left
# edge at half its height: inside the margin the grid keeps at any size), and waits for it there, so that no hover or
# tooltip an earlier step left is in the picture: the two requests right before the Screenshot call are that move and
# its arrival. The run records no size, so its monitor is the default, 3072x1920. The same row reads the rest point
# of scratch runs that record a size, and of one whose recorded size is not one.
screenshot_pointer_summary="before-screenshot=[$(grep -B 2 -x -F 'Screenshot cockpit-1.png' "$CHECK_CALLS" | head -n 2 \
  | tr '\n' ' ')]"
screenshot_pointer_summary+=" last-move=$(grep -F 'resourcePulseNestedPointer move ' "$CHECK_CALL_OPTIONS" | tail -n 1)"
REST_POINT_RUN="$WIRING_TMP/rest-point-run"
# rest_point_of [run.values lines...]: pointer_rest_point of a scratch run recording those lines, or exit-<status>.
rest_point_of() {
  rm -rf "$REST_POINT_RUN"
  mkdir -p "$REST_POINT_RUN/state" || fatal "cannot create $REST_POINT_RUN"
  printf '%s\n' "$@" >"$REST_POINT_RUN/state/run.values" || fatal "cannot write $REST_POINT_RUN's run values"
  nested_call pointer_rest_point "$REST_POINT_RUN" || printf 'exit-%s' "$?"
}
screenshot_pointer_summary+=" default=[$(rest_point_of)] laptop=[$(rest_point_of monitor-size=1536x960)]"
screenshot_pointer_summary+=" least=[$(rest_point_of monitor-size=640x480)] not-a-size=[$(rest_point_of 'monitor-size=1536x960;id')]"
check "nested: check cockpit moves the pointer off the grid, to its rest point at the run's monitor size, and waits for it there before its screenshot, so that no hover an earlier step left is in the picture" \
  "$screenshot_pointer_summary" \
  'before-screenshot=[resourcePulseNestedPointer move resourcePulseNestedPointer at ] last-move=resourcePulseNestedPointer move {"x":4,"y":960,"clickCount":0} default=[4 960] laptop=[4 480] least=[4 240] not-a-size=[exit-1]'
# A new window takes the focus as Mutter maps it, and window-shown sees a window before that map: in a nested
# run the probe's late map took the focus back from a decoy activated a second after the probe opened. So
# the check waits until each window it opens has the focus before it activates the decoy. Read from the requests the
# stand-in recorded, from the first window's placement to the decoy's activation, each named with whose window it
# asks about (the first placed is the decoy, the second the probe). Only the rule is read: for each window, where its
# first focused-window falls against its own window-clear and the decoy's activation (between, when it waits as it
# should); no other request of the setup counts.
window_setup_calls="$(awk '$2 == "place-window-clear" { is_window_setup = 1 }
  is_window_setup { print }
  $2 == "activate-window" { exit }' "$CHECK_CALL_OPTIONS")"
window_setup_decoy_pid="$(awk '$2 == "place-window-clear"' <<<"$window_setup_calls" | sed -n -E '1s/.*"pid":([0-9]+).*/\1/p')"
window_setup_probe_pid="$(awk '$2 == "place-window-clear"' <<<"$window_setup_calls" | sed -n -E '2s/.*"pid":([0-9]+).*/\1/p')"
window_setup_sequence=""
while read -r _ window_setup_request window_setup_options; do
  window_setup_pid="$(sed -n -E 's/.*"pid":([0-9]+).*/\1/p' <<<"$window_setup_options")"
  window_setup_role=other
  [[ -n "$window_setup_pid" && "$window_setup_pid" == "$window_setup_decoy_pid" ]] && window_setup_role=decoy
  [[ -n "$window_setup_pid" && "$window_setup_pid" == "$window_setup_probe_pid" ]] && window_setup_role=probe
  window_setup_sequence+="$window_setup_request:$window_setup_role"$'\n'
done <<<"$window_setup_calls"
# window_focus_wait_place <role> prints where that window's first focused-window falls in the setup's requests:
# between (after its own last window-clear before it, and before the decoy's activation), before-clear, after-activate,
# or none (never asked).
window_focus_wait_place() {
  awk -v role="$1" '
    $0 == "window-clear:" role { clear_index = NR }
    $0 == "focused-window:" role && focus_index == 0 { focus_index = NR; clear_index_at_focus = clear_index }
    $0 == "activate-window:decoy" && activate_index == 0 { activate_index = NR }
    END {
      if (focus_index == 0) print "none"
      else if (clear_index_at_focus == 0) print "before-clear"
      else if (activate_index == 0 || focus_index > activate_index) print "after-activate"
      else print "between"
    }' <<<"$window_setup_sequence"
}
window_wait_summary="distinct=$([[ -n "$window_setup_decoy_pid" && "$window_setup_decoy_pid" != "$window_setup_probe_pid" ]] \
  && printf yes || printf no)"
window_wait_summary+=" decoy=$(window_focus_wait_place decoy) probe=$(window_focus_wait_place probe)"
check "nested: check cockpit waits until each window it opens has the focus (Mutter's map of it is over) before it activates the decoy, so a late map of the probe cannot take the focus back from the decoy: each window's focused-window comes after its own window-clear and before the decoy's activation" \
  "$window_wait_summary" "distinct=yes decoy=between probe=between"

# apps-rows reads what the replay sent from the replay itself, right after the grid step: GetState of the sampler's
# name on the run's bus, by the name, object path and interface lib/protocol.js gives the service (read from it here),
# and gives the names of the snapshot's two rankings to apps-rows; never through the extension, whose reading of them
# the step judges.
PROTOCOL_MODULE="$REPO_ROOT/gnome-shell/extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js"
protocol_bus_name="$(sed -n -E "s/^export const RESOURCE_PULSE_BUS_NAME = '([^']+)';$/\1/p" "$PROTOCOL_MODULE")"
protocol_object_path="$(sed -n -E "s/^export const RESOURCE_PULSE_OBJECT_PATH = '([^']+)';$/\1/p" "$PROTOCOL_MODULE")"
protocol_interface_line_count="$(grep -c -x -F 'export const RESOURCE_PULSE_INTERFACE_NAME = RESOURCE_PULSE_BUS_NAME;' \
  "$PROTOCOL_MODULE")"
apps_rows_summary="protocol-read=$([[ -n "$protocol_bus_name" && -n "$protocol_object_path" ]] && printf yes \
  || printf no)/$protocol_interface_line_count"
apps_rows_summary+=" after-grid=[$(grep -A 2 -x -F 'resourcePulseCockpitCheck grid-geometry' "$CHECK_CALLS" | head -n 3 \
  | tr '\n' ' ')]"
apps_rows_summary+=" options=$(grep -F 'resourcePulseCockpitCheck apps-rows ' "$CHECK_CALL_OPTIONS" | head -n 1 \
  | cut -d ' ' -f 3-)"
check "nested: check cockpit's apps-rows reads the replay's snapshot from GetState of the sampler's name, path and interface (lib/protocol.js's) right after the grid step, and gives apps-rows the names of its two rankings" \
  "$apps_rows_summary" \
  "protocol-read=yes/1 after-grid=[resourcePulseCockpitCheck grid-geometry GetState $protocol_bus_name $protocol_object_path $protocol_bus_name resourcePulseCockpitCheck apps-rows ] options=$CHECK_REPLAY_APPS_OPTIONS"

# layer-readd, in the same pass: between the stale steps' last request and the dropdown's first, it asks layer-removed;
# puts the fixture back; opens the dropdown, since with no layer nothing of the cockpit is seen and the layout given
# back is heard only once something is (the stand-in's model of the subscription: GetState's answer one request late);
# waits for the layer (layer-placement asked again past the request that still finds none), then grid-geometry; and
# closes the dropdown. The fixture layer-removed saw served no layout and the configError of a cockpit.json the service
# cannot read (its sources as start wrote them), and the one the second half saw was start's again; the step's ok line
# says the dropdown opened and closed; and the dropdown's steps begin with the layer drawn and the dropdown closed.
LAYER_READD_OK_LINE="ok layer-readd: taken away: no layer, the v2 card top right, the dropdown's sessions item shown"
LAYER_READD_OK_LINE+="; given back and the cockpit seen again (the dropdown opened and closed): one layer,"
LAYER_READD_OK_LINE+=" the v2 card in the system cell, every card at its cell"
layer_readd_requests="$(awk '$2 == "stale-card" { is_after_stale = 1; requests = ""; next }
  is_after_stale && $2 == "dropdown-order" { print requests; exit }
  is_after_stale { requests = requests $2 " " }' "$CHECK_CALLS")"
layer_readd_summary="requests=[$layer_readd_requests]"
layer_readd_summary+=" taken-away=$(jq -c '[.state.layout, .state.configError]' "$CHECK_CALLS.fixture.layer-removed" 2>&1)"
layer_readd_summary+=" sources=$(cmp -s <(jq -S '.state.sources' "$CHECK_CALLS.fixture.layer-removed" 2>&1) \
  <(jq -S '.state.sources' "$CHECK_RUN/state/cockpit-fixture.start.json" 2>&1) && printf as-start || printf changed)"
layer_readd_summary+=" given-back=$(cmp -s "$CHECK_CALLS.fixture.layer-placement" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf start || printf other)"
layer_readd_summary+=" ok-line=$(grep -c -x -F "$LAYER_READD_OK_LINE" <<<"$CHECK_STUB_OUTPUT")"
layer_readd_summary+=" at-dropdown-steps=[$(grep -m 1 '^dropdown-order ' "$CHECK_CALLS.extension-log" | cut -d ' ' -f 2-)]"
check "nested: check cockpit's layer-readd serves the run's fixture with no layout and the configError of a cockpit.json the service cannot read, asks layer-removed, puts the fixture back as start wrote it, then opens the dropdown, waits for the layer, asks grid-geometry and closes the dropdown, leaving the layer drawn and the dropdown closed" \
  "$layer_readd_summary" \
  'requests=[layer-removed dropdown-open layer-placement layer-placement grid-geometry dropdown-close ] taken-away=[null,"missing"] sources=as-start given-back=start ok-line=1 at-dropdown-steps=[layer=shown dropdown=closed]'

BAD_GRID_DETAIL='the apps card is at 600x500+685+80, not its cell 600x500+680+80'
UNJUDGED_STALE_DETAIL="cannot read the card's no-data line (_noDataLabel)"
# The first pass asks grid-geometry again while it is bad, so a grid bad in that pass is bad at every one of its asks.
CHECK_STATE_SETTLE_ATTEMPTS="$(nested_constant STATE_SETTLE_ATTEMPTS)" || exit 2
first_pass_bad_grid_pairs=()
for (( attempt = 1; attempt <= CHECK_STATE_SETTLE_ATTEMPTS; attempt++ )); do
  first_pass_bad_grid_pairs+=("resourcePulseCockpitCheck.grid-geometry.$attempt"
    "{\"verdict\":\"bad\",\"detail\":\"$BAD_GRID_DETAIL\"}")
done
bad_grid_answers="$(answers_with bad-grid "${first_pass_bad_grid_pairs[@]}")"
unjudged_stale_answers="$(answers_with unjudged-stale resourcePulseCockpitCheck.stale-card \
  "{\"verdict\":\"could-not-judge\",\"detail\":\"$UNJUDGED_STALE_DETAIL\"}")"
both_answers="$(answers_with both "${first_pass_bad_grid_pairs[@]}" resourcePulseCockpitCheck.stale-card \
  "{\"verdict\":\"could-not-judge\",\"detail\":\"$UNJUDGED_STALE_DETAIL\"}")"
check_cockpit_stubbed "$bad_grid_answers"
faulted_check_summary="bad-grid=$CHECK_STUB_EXIT/$(grep -c -x -F "bad grid: $BAD_GRID_DETAIL" <<<"$CHECK_STUB_OUTPUT")"
faulted_check_summary+="/$(grep -c -x -F 'check cockpit: 31 ok, 1 bad, 0 could not judge' <<<"$CHECK_STUB_OUTPUT")"
check_cockpit_stubbed "$unjudged_stale_answers"
faulted_check_summary+=" unjudged-stale=$CHECK_STUB_EXIT/$(grep -c -x -F "could not judge stale: $UNJUDGED_STALE_DETAIL" \
  <<<"$CHECK_STUB_OUTPUT")/$(grep -c -x -F 'check cockpit: 30 ok, 0 bad, 2 could not judge' <<<"$CHECK_STUB_OUTPUT")"
check_cockpit_stubbed "$both_answers"
faulted_check_summary+=" both=$CHECK_STUB_EXIT/$(grep -c -x -F 'check cockpit: 29 ok, 1 bad, 2 could not judge' \
  <<<"$CHECK_STUB_OUTPUT")"
silent_log_answers="$(answers_with silent-log)"
rm -f "$silent_log_answers"/click-*.log
check_cockpit_stubbed "$silent_log_answers"
faulted_check_summary+=" silent-log=$CHECK_STUB_EXIT/$(grep -c -E '^bad click-(no-window|not-focused): ' <<<"$CHECK_STUB_OUTPUT")"
faulted_check_summary+="/$(grep -c '^could not judge log: ' <<<"$CHECK_STUB_OUTPUT")"
# One step with a bad part and a part that could not be judged (the count armed unjudged, read bad): the step is bad.
mixed_step_answers="$(answers_with mixed-step resourcePulseCockpitCheck.focus-calls-arm \
  '{"verdict":"could-not-judge","detail":"the cockpit client has no focusSession"}' \
  resourcePulseCockpitCheck.focus-calls-read '{"verdict":"bad","detail":"2 FocusSession calls, not 1"}')"
check_cockpit_stubbed "$mixed_step_answers"
faulted_check_summary+=" mixed-step=$CHECK_STUB_EXIT/$(grep -c -x -F 'bad click-twice: 2 FocusSession calls, not 1' \
  <<<"$CHECK_STUB_OUTPUT")"
mutter_log_answers="$(answers_with mutter-log click-1.log \
  'Window manager warning: Buggy client sent a _NET_ACTIVE_WINDOW message with a timestamp of 0 for 0x1')"
check_cockpit_stubbed "$mutter_log_answers"
faulted_check_summary+=" mutter-warning=$CHECK_STUB_EXIT/$(grep -c -E '^bad (click-log|log): ' <<<"$CHECK_STUB_OUTPUT")"
# perf's lines cannot be written (a directory stands where they go): its step could not be judged, never a breach.
make_check_run yes gc-log=1 replay=1
mkdir -p "$CHECK_RUN/log/check-cockpit-perf.log" || fatal "cannot lay out $CHECK_RUN's perf log"
check_cockpit_stubbed "$CHECK_ANSWERS" again
faulted_check_summary+=" perf-unwritable=$CHECK_STUB_EXIT/$(check_step_verdicts count-budgets)"
check "nested: check cockpit runs every step whatever one answers: a bad step is exit 1 naming it, one that could not be judged exit 2, both exit 1, a step with a bad part bad whatever else in it could not be judged; a log without the provoked focus lines fails the clicks and cannot judge the log, a Mutter warning after a click is bad, and perf's lines that cannot be written are no breach" \
  "$faulted_check_summary" \
  "bad-grid=1/1/1 unjudged-stale=2/1/1 both=1/1 silent-log=1/2/1 mixed-step=1/1 mutter-warning=1/2 perf-unwritable=2/count-budgets:unjudged"
# check cockpit opens the dropdown asking for the session names its card shows
# (the fixture's first by urgency, as many as lib/constants.js
# SESSIONS_CARD_ROW_LIMIT: its five sessions waiting on you, the longest wait
# first, then its working one of the most memory, the six names the gjs table's
# fixture row pins too), so that the request that opens the menu judges the
# rows at once (only the widths, which need an allocation, are polled after it);
# and it arms the dropdown's draw watch only once that open is ok: a closed
# menu's card draws nothing, which would read as the pacing's fault. The cover
# steps ask the card's first row by urgency for its name, and rename that
# session. Each request's options are read from what the stand-in recorded. The
# first dropdown-open of a pass is layer-readd's own, which opens here: the
# dropdown's steps make the others.
FIXTURE_SESSION_NAMES_BY_URGENCY_JSON='["consolidate-logging-config","api-v2","triage-nightly-ci-failures",'
FIXTURE_SESSION_NAMES_BY_URGENCY_JSON+='"fix-flaky-tests","migrate-legacy-auth-to-oidc-flow","fix-flaky-tests"]'
FIXTURE_FIRST_SESSION_BY_URGENCY_NAME='consolidate-logging-config'
check_cockpit_stubbed "$CHECK_ANSWERS"
dropdown_sequencing_summary="open-with-names=$(grep -c -x -F \
  "resourcePulseCockpitCheck dropdown-open {\"names\":$FIXTURE_SESSION_NAMES_BY_URGENCY_JSON}" "$CHECK_CALL_OPTIONS")"
dropdown_sequencing_summary+=" first-row-asked=$(grep -c -x -F \
  "resourcePulseCockpitCheck row-name {\"surface\":\"layer\",\"name\":\"$FIXTURE_FIRST_SESSION_BY_URGENCY_NAME\"}" \
  "$CHECK_CALL_OPTIONS")"
CLOSED_DROPDOWN_DETAIL='the dropdown did not open'
closed_dropdown_answers="$(answers_with closed-dropdown resourcePulseCockpitCheck.dropdown-open \
  "{\"verdict\":\"could-not-judge\",\"detail\":\"$CLOSED_DROPDOWN_DETAIL\"}" \
  resourcePulseCockpitCheck.dropdown-open.1 "$CHECK_OK_ANSWER")"
check_cockpit_stubbed "$closed_dropdown_answers"
dropdown_sequencing_summary+=" closed-arms=$(check_stub_call_count '^resourcePulseCockpitCheck draw-watch-arm$')"
dropdown_sequencing_summary+=" closed-change=$(grep -c -x -F "could not judge dropdown-change: $CLOSED_DROPDOWN_DETAIL" \
  <<<"$CHECK_STUB_OUTPUT")"
check "nested: check cockpit opens the dropdown with the fixture's first session names by urgency, so the open itself judges the rows at once, asks the card's first row by urgency in the cover steps, and arms the dropdown's draw watch only once the open is ok (the visible step's watch is the one other arm)" \
  "$dropdown_sequencing_summary" "open-with-names=1 first-row-asked=1 closed-arms=1 closed-change=1"
# minimize-all is the harness's own setup at every place check cockpit asks
# it (before click-show-desktop, click-no-window and click-twice, the cover,
# the dropdown's click): a window that did not minimize makes that step could
# not judge, never ok. The stand-in answers the fourth call (the cover step's)
# so; every call goes through the same function, minimize_check_windows.
UNMINIMIZED_DETAIL='1 windows did not minimize'
unminimized_answers="$(answers_with unminimized resourcePulseCockpitCheck.minimize-all.4 \
  "{\"verdict\":\"could-not-judge\",\"detail\":\"$UNMINIMIZED_DETAIL\"}")"
check_cockpit_stubbed "$unminimized_answers"
unminimized_summary="exit=$CHECK_STUB_EXIT $(check_step_verdicts cover)"
unminimized_summary+=" named=$(grep -c -x -F "could not judge cover: $UNMINIMIZED_DETAIL" <<<"$CHECK_STUB_OUTPUT")"
unminimized_summary+=" summary=$(grep -c -x -F 'check cockpit: 31 ok, 0 bad, 1 could not judge' <<<"$CHECK_STUB_OUTPUT")"
unminimized_summary+=" asked=$(check_stub_call_count '^resourcePulseCockpitCheck minimize-all$')"
check "nested: check cockpit takes a minimize-all that could not be judged (a window that did not minimize) for its step's own setup: that step could not be judged, never ok" \
  "$unminimized_summary" "exit=2 cover:unjudged named=1 summary=1 asked=5"
# check cockpit run again in the same run (the one run may need a second pass
# after a fix to the harness's own files): each pass is numbered, judges the
# shell log only from where it began (the run's first pass from the run's
# start), keeps its own screenshot, and cannot judge the two clicks whose one
# line the extension's log limiter still holds from an earlier pass of the run,
# by the nested shell's clock, naming how long is left. Three passes on one
# run: the first with an extension error already in the log; the second at
# once (the stand-in's clock never moves); the third once the limiter's
# interval has passed (the earlier passes' times written back older), with a
# Mutter warning of its own after its first click. Three rows read them.
CHECK_EXTENSION_ERROR_LINE='(gnome-shell:7): Gjs-CRITICAL **: 09:59:00.000: resource-pulse: could not draw the cockpit layer'
CHECK_LIMITER_INTERVAL_USEC="$(nested_constant EXTENSION_LOG_REPEAT_INTERVAL_USEC)" || exit 2
CHECK_NO_ACTIVATION_WAIT_SECONDS="$(nested_constant NO_ACTIVATION_WAIT_SECONDS)" || exit 2
# A pass records, before its click, the end of the step's wait: with the stand-in's clock still, the interval and
# that wait are left.
CHECK_LIMITER_WAIT_NEEDLE="an earlier pass of this run had it logged: it can be judged again in"
CHECK_LIMITER_WAIT_NEEDLE+=" $((CHECK_LIMITER_INTERVAL_USEC / 1000000 + CHECK_NO_ACTIVATION_WAIT_SECONDS)) s"
CHECK_LIMITED_STEP_NAMES=(click-no-window click-not-focused)
own_fault_answers="$(answers_with own-fault click-1.log \
  'Window manager warning: Buggy client sent a _NET_ACTIVE_WINDOW message with a timestamp of 0 for 0x1')"
make_check_run yes gc-log=1 replay=1
printf '%s\n' "$CHECK_EXTENSION_ERROR_LINE" >>"$CHECK_RUN/log/shell.log"
check_cockpit_stubbed "$CHECK_ANSWERS" again
pass_log_summary="first=[$(check_step_verdicts early-log log)]"
pass_limiter_summary="first=[$(check_step_verdicts "${CHECK_LIMITED_STEP_NAMES[@]}")]"
# The time is read before the click it is for (C a click, T the clock), and recorded as the end of the step's wait.
pass_limiter_summary+=" order=$(awk '$2 == "click" { printf "C" } $2 == "monotonic-time" { printf "T" }' "$CHECK_CALLS")"
pass_limiter_summary+=" logged-by=$(( $(nested_call recorded_run_value "$CHECK_RUN" check-no-window-logged-usec) \
  - CHECK_CLOCK_USEC ))"
pass_screenshot_summary="first=[$(sed -n 's/^Screenshot //p' "$CHECK_CALLS")]"
check_cockpit_stubbed "$CHECK_ANSWERS" again
pass_log_summary+=" second=[$(check_step_verdicts early-log log)]"
pass_limiter_summary+=" second=[$(check_step_verdicts "${CHECK_LIMITED_STEP_NAMES[@]}")]"
pass_limiter_summary+=" waits=$(grep -c -F "$CHECK_LIMITER_WAIT_NEEDLE" <<<"$CHECK_STUB_OUTPUT")"
pass_screenshot_summary+=" second=[$(sed -n 's/^Screenshot //p' "$CHECK_CALLS")]"
# The limiter's interval has passed since both lines were logged: the times are written back that much older.
check_old_logged_usec=$((CHECK_CLOCK_USEC - CHECK_LIMITER_INTERVAL_USEC))
printf '%s\n' "check-no-window-logged-usec=$check_old_logged_usec" \
  "check-not-focused-logged-usec=$check_old_logged_usec" >>"$CHECK_RUN/state/run.values"
check_cockpit_stubbed "$own_fault_answers" again
pass_log_summary+=" third=[$(check_step_verdicts early-log click-log log)]"
pass_limiter_summary+=" third=[$(check_step_verdicts "${CHECK_LIMITED_STEP_NAMES[@]}")]"
pass_screenshot_summary+=" third=[$(sed -n 's/^Screenshot //p' "$CHECK_CALLS")]"
pass_screenshot_summary+=" ok-line=$(grep -c -x -F "ok screenshot: $CHECK_RUN/shots/cockpit-3.png" <<<"$CHECK_STUB_OUTPUT")"
pass_screenshot_summary+=" passes=$(nested_call recorded_run_value "$CHECK_RUN" check-cockpit-pass)"
lib_limiter_interval_usec="$(sed -n -E 's/^export const ERROR_LOG_REPEAT_INTERVAL_USEC = ([0-9_]+);$/\1/p' \
  "$EXT_DIR/lib/constants.js" | tr -d '_')"
pass_limiter_summary+=" interval=$([[ "$lib_limiter_interval_usec" == "$CHECK_LIMITER_INTERVAL_USEC" ]] && printf \
  the-extensions || printf "'%s' not '%s'" "$CHECK_LIMITER_INTERVAL_USEC" "$lib_limiter_interval_usec")"
check "nested: a second pass of check cockpit in the same run judges the shell log only from where it began, so a fault the first pass found is not found again and one of its own is (the first pass reads the log from the run's start)" \
  "$pass_log_summary" \
  "first=[early-log:bad log:bad] second=[early-log:ok log:ok] third=[early-log:ok click-log:bad log:bad]"
check "nested: a pass of check cockpit cannot judge click-no-window and click-not-focused while the extension's log limiter (its own interval, by the nested shell's clock) still holds the line an earlier pass of the run had logged, naming how long is left; once it has passed they are judged again; the time is recorded before the click, as the end of the step's wait" \
  "$pass_limiter_summary" \
  "first=[click-no-window:ok click-not-focused:ok] order=CCTCCTCCC logged-by=$((CHECK_NO_ACTIVATION_WAIT_SECONDS * 1000000)) second=[click-no-window:unjudged click-not-focused:unjudged] waits=2 third=[click-no-window:ok click-not-focused:ok] interval=the-extensions"
check "nested: each pass of check cockpit in a run is numbered in state/run.values and keeps its own screenshot, shots/cockpit-<pass>.png" \
  "$pass_screenshot_summary" \
  "first=[cockpit-1.png] second=[cockpit-2.png] third=[cockpit-3.png] ok-line=1 passes=3"
# A pass's log steps start where the last pass's log step read to (the run's
# state records it), so that what is logged after that step is judged by the
# next pass: the last pass's own perf run (five disable and enable cycles), a
# perf run alone, the time between passes. Four passes on one run: the first
# with a perf run that logs an extension error (after its log step); the
# second at once; then an error logged between passes; the third; the fourth.
# Each pass's two log steps, and how many lines name each error.
CHECK_PERF_FAULT_LINE='(gnome-shell:7): Gjs-CRITICAL **: 10:05:00.000: resource-pulse: the cockpit failed as perf enabled it'
CHECK_BETWEEN_PASSES_FAULT_LINE='(gnome-shell:7): Gjs-CRITICAL **: 10:15:00.000: resource-pulse: the cockpit failed between passes'
# The perf pass, as check_cockpit_stubbed's, logging the error first; the check's bash evaluates it.
CHECK_PERF_LOGS_FAULT_OVERRIDES="run_perf_for_check_cockpit() {
  printf '%s\n' $(printf '%q' "$CHECK_PERF_FAULT_LINE") >>\"\$CHECK_STUB_SHELL_LOG\"
  printf 'perf: PASS: every count within its budget\nperf: cockpit: PASS: as the stand-in judges\n'
}"
# later_log_verdicts prints the last pass's two log steps and how many lines name each error.
later_log_verdicts() {
  printf '[%s perf-error=%s between-error=%s]' "$(check_step_verdicts early-log log)" \
    "$(grep -c -F "$CHECK_PERF_FAULT_LINE" <<<"$CHECK_STUB_OUTPUT")" \
    "$(grep -c -F "$CHECK_BETWEEN_PASSES_FAULT_LINE" <<<"$CHECK_STUB_OUTPUT")"
}
CHECK_STUB_OVERRIDES="$CHECK_PERF_LOGS_FAULT_OVERRIDES" check_cockpit_stubbed "$CHECK_ANSWERS"
later_log_summary="first=$(later_log_verdicts)"
check_cockpit_stubbed "$CHECK_ANSWERS" again
later_log_summary+=" second=$(later_log_verdicts)"
printf '%s\n' "$CHECK_BETWEEN_PASSES_FAULT_LINE" >>"$CHECK_RUN/log/shell.log"
check_cockpit_stubbed "$CHECK_ANSWERS" again
later_log_summary+=" third=$(later_log_verdicts)"
check_cockpit_stubbed "$CHECK_ANSWERS" again
later_log_summary+=" fourth=$(later_log_verdicts)"
check "nested: a pass of check cockpit judges the shell log from where the last pass's log step read it to, so a fault logged after that step (in that pass's own perf run, or between passes) is the next pass's bad, and only that pass's" \
  "$later_log_summary" \
  "first=[early-log:ok log:ok perf-error=0 between-error=0] second=[early-log:bad log:bad perf-error=2 between-error=0] third=[early-log:bad log:bad perf-error=0 between-error=2] fourth=[early-log:ok log:ok perf-error=0 between-error=0]"

# check cockpit never takes a run's state it cannot read for one where nothing
# was recorded (the run's first pass: its log judged from the start, its
# screenshot named as an earlier pass's, the limiter taken for open). Every
# read of the state fails here (read_recorded_run_value, replaced): the steps
# that need it could not be judged, saying so, and the pass takes no
# screenshot and records no pass or log offset (the limiter's two times it
# records still, as before every such click). The reader itself fails on a
# run.values it cannot read (a directory in its place) or that is not there,
# and reads the last value of a name otherwise.
# shellcheck disable=SC2016  # Evaluated by the check's bash.
CHECK_STUB_OVERRIDES='read_recorded_run_value() { return 1; }' check_cockpit_stubbed "$CHECK_ANSWERS"
unreadable_state_summary="exit=$CHECK_STUB_EXIT [$(check_step_verdicts early-log click-no-window click-not-focused \
  screenshot log)] screenshots=$(check_stub_call_count '^Screenshot ')"
unreadable_state_summary+=" passes=$(grep -c '^check-cockpit-pass=' "$CHECK_RUN/state/run.values")"
unreadable_state_summary+=" log-offsets=$(grep -c '^check-log-read-offset=' "$CHECK_RUN/state/run.values")"
# Recorded before each limited click even when it cannot be judged: a later pass then waits for that click's line too.
unreadable_state_summary+=" limiter-times=$(grep -c -E '^check-(no-window|not-focused)-logged-usec=' \
  "$CHECK_RUN/state/run.values")"
unreadable_state_summary+=" named=$(grep -c -F "cannot read the run's state ($CHECK_RUN/state/run.values)" \
  <<<"$CHECK_STUB_OUTPUT")/$(grep -c -F "the run's state ($CHECK_RUN/state/run.values) cannot be read" \
  <<<"$CHECK_STUB_OUTPUT")"
unreadable_state_summary+=" summary=$(grep -c -x -F 'check cockpit: 27 ok, 0 bad, 5 could not judge' <<<"$CHECK_STUB_OUTPUT")"
STATE_READER_RUN="$WIRING_TMP/state-reader-run"
mkdir -p "$STATE_READER_RUN/state/run.values" || fatal "cannot lay out $STATE_READER_RUN"
# state_reader_case prints read_recorded_run_value's status and what it printed, for the check's pass number.
state_reader_case() {
  local reader_output reader_status
  reader_output="$(nested_call read_recorded_run_value "$STATE_READER_RUN" check-cockpit-pass 2>/dev/null)"
  reader_status=$?
  printf '%s:%s' "$reader_status" "$reader_output"
}
unreadable_state_summary+=" reader: unreadable=$(state_reader_case)"
unreadable_state_summary+=" unwritable=$(nested_call record_run_value "$STATE_READER_RUN" check-cockpit-pass 1 \
  >/dev/null 2>&1; printf '%s' "$?")"
rmdir "$STATE_READER_RUN/state/run.values" || fatal "cannot lay out $STATE_READER_RUN"
unreadable_state_summary+=" missing=$(state_reader_case)"
printf '%s\n' check-cockpit-pass=1 gc-log=1 check-cockpit-pass=2 >"$STATE_READER_RUN/state/run.values"
unreadable_state_summary+=" readable=$(state_reader_case)"
# A recorded pass number that is not a whole number (a torn write, a hand edit) tells no pass either.
make_check_run yes gc-log=1 replay=1
printf '%s\n' check-cockpit-pass=x >>"$CHECK_RUN/state/run.values"
check_cockpit_stubbed "$CHECK_ANSWERS" again
unreadable_state_summary+=" not-a-number=[$(check_step_verdicts early-log screenshot log)]"
unreadable_state_summary+=" screenshots=$(check_stub_call_count '^Screenshot ')"
unreadable_state_summary+=" named=$(grep -c -F "the run's state holds 'x' as the last pass's number" <<<"$CHECK_STUB_OUTPUT")"
check "nested: check cockpit takes a run's state it cannot read, or a pass number recorded there that is not one, for unknown, never for its first pass: the log steps, the limiter's two steps and the screenshot could not be judged, saying so, with no screenshot taken and no pass recorded; the reader fails on a run.values it cannot read or that is not there, and the writer on one it cannot write" \
  "$unreadable_state_summary" \
  "exit=2 [early-log:unjudged click-no-window:unjudged click-not-focused:unjudged screenshot:unjudged log:unjudged] screenshots=0 passes=0 log-offsets=0 limiter-times=2 named=3/2 summary=1 reader: unreadable=1: unwritable=1 missing=1: readable=0:2 not-a-number=[early-log:unjudged screenshot:unjudged log:unjudged] screenshots=0 named=3"

# check cockpit says so when it cannot record a value of the run's state a
# later pass needs, and does nothing that would mislead that pass: a pass
# number it cannot record takes no screenshot (a later pass would take the same
# name); a limiter time it cannot record makes no click (its line would hold
# the extension's limiter unrecorded), nor the click that counts on that one; a
# log offset it cannot record leaves its log step could not judge (the next
# pass judges that part again). Each case fails one name's writes
# (record_run_value, wrapped) on a fresh run, and prints the exit, the steps
# that could not be judged, the clicks and the screenshots.
# unrecordable_value_case <run value name> [answers dir] runs that case.
unrecordable_value_case() {
  # shellcheck disable=SC2016  # Evaluated by the check's bash.
  CHECK_STUB_OVERRIDES="$(printf '%s\n' 'eval "script_$(declare -f record_run_value)"' \
    "record_run_value() { [[ \"\$2\" == $1 ]] && return 1; script_record_run_value \"\$@\"; }")" \
    check_cockpit_stubbed "${2:-$CHECK_ANSWERS}"
  printf '%s/[%s]/%s/%s' "$CHECK_STUB_EXIT" \
    "$(sed -n -E 's/^could not judge ([a-z-]+): .*/\1/p' <<<"$CHECK_STUB_OUTPUT" | tr '\n' ' ')" \
    "$(check_stub_call_count '^resourcePulseNestedPointer click$')" "$(check_stub_call_count '^Screenshot ')"
}
unrecordable_value_summary="pass=$(unrecordable_value_case check-cockpit-pass)"
# With click-no-window's two clicks not made, click-not-focused's is the third: it logs its line there.
unclicked_no_window_answers="$(answers_with unclicked-no-window click-3.log \
  '(gnome-shell:7): Gjs-Console-WARNING **: 10:00:03.000: resource-pulse: cockpit: focus: herdr-unreachable')"
rm -f "$unclicked_no_window_answers/click-5.log"
unrecordable_value_summary+=" no-window=$(unrecordable_value_case check-no-window-logged-usec \
  "$unclicked_no_window_answers")"
unrecordable_value_summary+=" not-focused=$(unrecordable_value_case check-not-focused-logged-usec)"
unrecordable_value_summary+=" log-offset=$(unrecordable_value_case check-log-read-offset)"
check "nested: check cockpit, unable to record a value of the run's state a later pass needs, says so in the step that needed it and does nothing that would mislead that pass: no screenshot under an unrecorded pass number, no click with an unrecorded limiter time (nor the click counting on it), a log step whose read-to point is unrecorded could not be judged" \
  "$unrecordable_value_summary" \
  "pass=2/[screenshot ]/7/0 no-window=2/[click-no-window click-no-window-again ]/5/1 not-focused=2/[click-not-focused ]/6/1 log-offset=2/[log ]/7/1"

# A shell log that cannot be read past its offset (a directory stands where it
# should be: it passes the readable test, and tail fails on it) is could not
# judge for a log step, never "no faults".
UNREADABLE_LOG_RUN="$WIRING_TMP/unreadable-log-run"
mkdir -p "$UNREADABLE_LOG_RUN/log/shell.log" || fatal "cannot lay out $UNREADABLE_LOG_RUN"
# shellcheck disable=SC2016  # Expanded by the child bash.
unreadable_log_line="$(bash -c '
  source "$1" || exit 99
  CHECK_RUN_DIR="$2"
  begin_check_step
  note_shell_log_faults 0 extension,clutter
  end_check_step early-log "no fault found"
' unreadable-log "$NESTED_SCRIPT" "$UNREADABLE_LOG_RUN" 2>/dev/null)"
check "nested: check cockpit's log steps take a shell log they could not read past their offset for could not judge, never for no faults" \
  "$unreadable_log_line" "could not judge early-log: cannot read $UNREADABLE_LOG_RUN/log/shell.log past byte 0"

# A step whose precondition is missing prints its own could-not-judge line, so
# the summary counts every step: with the check's windows never shown, the
# seven click steps, the four cover steps and the dropdown's click, and the log
# (no click provoked its focus lines). A part of the windows step that fails
# (the decoy not focused here) is the harness's own setup: could not judge,
# never bad.
never_shown_answers="$(answers_with never-shown resourcePulseCockpitCheck.window-shown \
  '{"verdict":"bad","detail":"no window of pid 1 yet"}')"
check_cockpit_stubbed "$never_shown_answers"
skipped_steps_summary="exit=$CHECK_STUB_EXIT steps=[$(check_steps_seen)]"
skipped_steps_summary+=" summary=$(grep -c -x -F 'check cockpit: 18 ok, 0 bad, 14 could not judge' <<<"$CHECK_STUB_OUTPUT")"
skipped_steps_summary+=" click-lines=$(grep -c -E \
  "^could not judge click[a-z-]*: the check's windows could not be set up \\(see the windows step\\)$" \
  <<<"$CHECK_STUB_OUTPUT")"
skipped_steps_summary+=" cover-lines=$(grep -c -E \
  '^could not judge (cover|cover-holds-changes|reveal|visible-change): no probe window to cover the cards with$' \
  <<<"$CHECK_STUB_OUTPUT")"
unfocused_decoy_answers="$(answers_with unfocused-decoy resourcePulseCockpitCheck.focused-window \
  '{"verdict":"bad","detail":"the focus is on pid 7'"'"'s window, not 8'"'"'s"}')"
check_cockpit_stubbed "$unfocused_decoy_answers"
# The stand-in answers every focused-window alike, so the dropdown's click is bad here too: only these two are read.
skipped_steps_summary+=" setup-fault=$(check_step_verdicts windows click)"
check "nested: check cockpit prints a could-not-judge line for every step whose precondition is missing (the click steps without its windows, the cover steps without its probe), so the summary counts all of them; its windows' own setup failing could not be judged, never bad" \
  "$skipped_steps_summary" \
  "exit=2 steps=[$CHECK_STEP_NAMES ] summary=1 click-lines=7 cover-lines=4 setup-fault=windows:unjudged click:unjudged"

# A window that never takes the focus as it maps makes the windows step could not judge, by the wait for its focus
# alone: here the stand-in answers focused-window by the window asked about, the probe never focused and the decoy
# focused (as it is once activated), so the decoy's activation after the waits succeeds, and only the probe's wait can
# stop the clicks.
unfocused_probe_answers="$(answers_with unfocused-probe resourcePulseCockpitCheck.focused-window.herdr-probe \
  '{"verdict":"bad","detail":"the focus is on the decoy'"'"'s window, not the probe'"'"'s"}')"
check_cockpit_stubbed "$unfocused_probe_answers"
probe_focus_summary="$(check_step_verdicts windows click)"
probe_focus_summary+=" decoy-activated=$(check_stub_call_count '^resourcePulseCockpitCheck activate-window$')"
check "nested: check cockpit's windows step could not be judged, and its clicks are not run, when a window it opened never takes the focus as it maps, even though the decoy's activation would succeed" \
  "$probe_focus_summary" "windows:unjudged click:unjudged decoy-activated=1"

# apps-rows could not be judged when the replay's snapshot cannot be read (its GetState fails) or holds no ranking (a
# replay from before the rankings): apps-rows is then never asked. layer-readd is bad for either half the extension
# fails (no layer-removed, or no layer back even once the dropdown opened: the stand-in's extension never draws the
# layer again), its fixture put back as start wrote it and the dropdown closed all the same. One pass gives the first
# of each pair, a second the other.
LAYER_REMOVED_BAD_DETAIL='the extension still holds a cockpit layer'
NO_COCKPIT_LAYER_DETAIL='no cockpit layer: the grid is not drawn (look for "could not draw the cockpit layer")'
APPS_ROWS_UNREADABLE_DETAIL="cannot read the two rankings of the replay's snapshot (GetState of $protocol_bus_name)"
# layer_readd_requests_seen prints the in-shell requests layer-readd asked in the last pass, from CHECK_CALLS: those
# after the stale steps' last request, up to the first that is none of its own; one asked again at once is written once
# with its count (layer-placement*2).
layer_readd_requests_seen() {
  awk 'function write_run() { if (run_request != "") requests = requests run_request (run_count > 1 ? "*" run_count : "") " " }
    $2 == "stale-card" { is_after_stale = 1; requests = ""; run_request = ""; run_count = 0; next }
    is_after_stale && $2 !~ /^(layer-removed|dropdown-open|layer-placement|grid-geometry|dropdown-close)$/ {
      write_run(); print requests; is_printed = 1; exit
    }
    is_after_stale { if ($2 == run_request) run_count++; else { write_run(); run_request = $2; run_count = 1 } }
    END { if (is_after_stale && !is_printed) { write_run(); print requests } }' "$CHECK_CALLS"
}
readd_removed_bad_answers="$(answers_with readd-removed-bad resourcePulseCockpitCheck.layer-removed \
  "{\"verdict\":\"bad\",\"detail\":\"$LAYER_REMOVED_BAD_DETAIL\"}" GetState.fails '')"
check_cockpit_stubbed "$readd_removed_bad_answers"
apps_rows_unjudged_summary="replay-unreadable=$(check_step_verdicts apps-rows)"
apps_rows_unjudged_summary+="/$(grep -c -x -F "could not judge apps-rows: $APPS_ROWS_UNREADABLE_DETAIL" <<<"$CHECK_STUB_OUTPUT")"
apps_rows_unjudged_summary+="/asked=$(check_stub_call_count '^resourcePulseCockpitCheck apps-rows$')"
layer_readd_bad_summary="removed-bad=$(check_step_verdicts layer-readd)"
layer_readd_bad_summary+="/$(grep -c -x -F "bad layer-readd: $LAYER_REMOVED_BAD_DETAIL" <<<"$CHECK_STUB_OUTPUT")"
layer_readd_bad_summary+="/placement-asked=$(check_stub_call_count '^resourcePulseCockpitCheck layer-placement$')"
layer_readd_bad_summary+="/fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed)"
readd_back_bad_answers="$(answers_with readd-back-bad GetState "$CHECK_REPLAY_STATE_WITHOUT_RANKINGS" \
  layer-not-redrawn '')"
check_cockpit_stubbed "$readd_back_bad_answers"
apps_rows_unjudged_summary+=" no-ranking=$(check_step_verdicts apps-rows)"
apps_rows_unjudged_summary+="/$(grep -c -x -F "could not judge apps-rows: $APPS_ROWS_UNREADABLE_DETAIL" <<<"$CHECK_STUB_OUTPUT")"
apps_rows_unjudged_summary+="/asked=$(check_stub_call_count '^resourcePulseCockpitCheck apps-rows$')"
layer_readd_bad_summary+=" back-bad=$(check_step_verdicts layer-readd)"
layer_readd_bad_summary+="/$(grep -c -x -F "bad layer-readd: $NO_COCKPIT_LAYER_DETAIL; $NO_COCKPIT_LAYER_DETAIL" \
  <<<"$CHECK_STUB_OUTPUT")"
layer_readd_bad_summary+="/requests=[$(layer_readd_requests_seen)]"
layer_readd_bad_summary+="/fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed)"
layer_readd_bad_summary+="/at-dropdown-steps=[$(grep -m 1 '^dropdown-order ' "$CHECK_CALLS.extension-log" | cut -d ' ' -f 2-)]"
check "nested: check cockpit's apps-rows could not be judged, and is not asked, when the replay's snapshot cannot be read or holds no ranking" \
  "$apps_rows_unjudged_summary" \
  "replay-unreadable=apps-rows:unjudged/1/asked=0 no-ranking=apps-rows:unjudged/1/asked=0"
check "nested: check cockpit's layer-readd is bad when the layout taken away leaves the layer, and when the layout given back brings none even once the dropdown opened and the waits ran out; the fixture is put back as start wrote it and the dropdown closed either way" \
  "$layer_readd_bad_summary" \
  "removed-bad=layer-readd:bad/1/placement-asked=3/fixture=restored back-bad=layer-readd:bad/1/requests=[layer-removed dropdown-open layer-placement*20 grid-geometry*20 dropdown-close ]/fixture=restored/at-dropdown-steps=[layer=gone dropdown=closed]"

# The stand-in's model of the extension's subscription fails layer-readd's old second half, as a real shell would: with
# the layer taken away nothing of the cockpit is seen, so the layout put back is never heard, and judged at once (no
# dropdown opened) the layer is still absent when the waits run out. The dropdown's steps, which open it, then bring
# the layer back: it is drawn when lock-path is asked.
# shellcheck disable=SC2016  # Evaluated by the check's own bash.
CHECK_STUB_OVERRIDES='judge_layout_given_back() {
  poll_nested "$STATE_SETTLE_ATTEMPTS" ask_check layer-placement
  note_answer
  poll_nested "$STATE_SETTLE_ATTEMPTS" ask_check grid-geometry "$1"
  note_answer
}'
check_cockpit_stubbed "$CHECK_ANSWERS"
CHECK_STUB_OVERRIDES=""
old_second_half_summary="$(check_step_verdicts layer-readd)"
old_second_half_summary+="/$(grep -c -x -F "bad layer-readd: $NO_COCKPIT_LAYER_DETAIL; $NO_COCKPIT_LAYER_DETAIL" \
  <<<"$CHECK_STUB_OUTPUT")"
old_second_half_summary+=" requests=[$(layer_readd_requests_seen)]"
old_second_half_summary+=" fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed)"
old_second_half_summary+=" at-lock-path=[$(grep -m 1 '^lock-path ' "$CHECK_CALLS.extension-log" | cut -d ' ' -f 2)]"
check "nested: the check rows' stand-in hears no layout given back while nothing of the cockpit is seen, as the extension's client does: layer-readd's old second half (no dropdown opened) is bad, no cockpit layer, and the dropdown's steps bring the layer back" \
  "$old_second_half_summary" \
  "layer-readd:bad/1 requests=[layer-removed layer-placement*20 grid-geometry*20 ] fixture=restored at-lock-path=[layer=shown]"

# A dropdown layer-readd could not open (the layout given back then cannot be read) or could not close: the step could
# not be judged, and nor can the dropdown's six steps after it (as the clicks cannot be without the check's windows);
# with no open, the layer is not waited for and the steps that need the grid (lock-path, count-budgets) could not be
# judged either; with no close, they are judged. The step asks to close the dropdown either way, and the fixture is
# put back as start wrote it.
DROPDOWN_NOT_OPEN_DETAIL='the dropdown is not open'
DROPDOWN_NOT_CLOSED_DETAIL='the dropdown is not closed'
DROPDOWN_NOT_USABLE_DETAIL='the dropdown could not be opened or closed (see the layer-readd step)'
GRID_NOT_READ_DETAIL='layer-readd could not open the dropdown, which reads the layout given back, so the grid this'
GRID_NOT_READ_DETAIL+=' step needs may not be drawn'
# dropdown_steps_unjudged_by_layer_readd prints how many of the dropdown's six steps the last output has as could not
# be judged for the dropdown layer-readd could not open or close, each line matched whole and literally.
dropdown_steps_unjudged_by_layer_readd() {
  local step_name unjudged_count=0
  for step_name in dropdown-order dropdown-open dropdown-tooltip dropdown-closed dropdown-change dropdown-click; do
    grep -q -x -F "could not judge $step_name: $DROPDOWN_NOT_USABLE_DETAIL" <<<"$CHECK_STUB_OUTPUT" \
      && unjudged_count=$((unjudged_count + 1))
  done
  printf '%s' "$unjudged_count"
}
dropdown_not_open_answers="$(answers_with dropdown-not-open resourcePulseCockpitCheck.dropdown-open.1 \
  "{\"verdict\":\"bad\",\"detail\":\"$DROPDOWN_NOT_OPEN_DETAIL\"}")"
check_cockpit_stubbed "$dropdown_not_open_answers"
dropdown_not_usable_summary="not-open=$CHECK_STUB_EXIT/$(check_step_verdicts layer-readd)"
dropdown_not_usable_summary+="/$(grep -c -x -F \
  "could not judge layer-readd: could not open the dropdown, which reads the layout given back (with no layer nothing of the cockpit is seen, so no change of it is heard): $DROPDOWN_NOT_OPEN_DETAIL" \
  <<<"$CHECK_STUB_OUTPUT")"
dropdown_not_usable_summary+="/requests=[$(layer_readd_requests_seen)]"
dropdown_not_usable_summary+="/dropdown-steps=$(dropdown_steps_unjudged_by_layer_readd)"
dropdown_not_usable_summary+="/grid-steps=$(grep -c -x -E "could not judge (lock-path|count-budgets): $GRID_NOT_READ_DETAIL" \
  <<<"$CHECK_STUB_OUTPUT")"
dropdown_not_usable_summary+="/fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed)"
dropdown_not_usable_summary+="/$(grep -c -x -F 'check cockpit: 23 ok, 0 bad, 9 could not judge' <<<"$CHECK_STUB_OUTPUT")"
dropdown_not_closed_answers="$(answers_with dropdown-not-closed resourcePulseCockpitCheck.dropdown-close.1 \
  "{\"verdict\":\"bad\",\"detail\":\"$DROPDOWN_NOT_CLOSED_DETAIL\"}")"
check_cockpit_stubbed "$dropdown_not_closed_answers"
dropdown_not_usable_summary+=" not-closed=$CHECK_STUB_EXIT/$(check_step_verdicts layer-readd)"
dropdown_not_usable_summary+="/$(grep -c -x -F \
  "could not judge layer-readd: could not close the dropdown: $DROPDOWN_NOT_CLOSED_DETAIL" <<<"$CHECK_STUB_OUTPUT")"
dropdown_not_usable_summary+="/requests=[$(layer_readd_requests_seen)]"
dropdown_not_usable_summary+="/dropdown-steps=$(dropdown_steps_unjudged_by_layer_readd)"
dropdown_not_usable_summary+="/$(check_step_verdicts lock-path count-budgets)"
dropdown_not_usable_summary+="/fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed)"
dropdown_not_usable_summary+="/$(grep -c -x -F 'check cockpit: 25 ok, 0 bad, 7 could not judge' <<<"$CHECK_STUB_OUTPUT")"
check "nested: check cockpit's layer-readd could not be judged when it could not open the dropdown (then the layer is not waited for, and the steps that need the grid could not be judged) or close it, the dropdown's six steps after it could not be judged either way, and it asks to close the dropdown and puts the fixture back either way" \
  "$dropdown_not_usable_summary" \
  "not-open=2/layer-readd:unjudged/1/requests=[layer-removed dropdown-open dropdown-close ]/dropdown-steps=6/grid-steps=2/fixture=restored/1 not-closed=2/layer-readd:unjudged/1/requests=[layer-removed dropdown-open layer-placement*2 grid-geometry dropdown-close ]/dropdown-steps=6/lock-path:ok count-budgets:ok/fixture=restored/1"

# A fixture layer-readd could not rewrite: the step could not be judged, asks neither half, and leaves the fixture as
# start wrote it; the later steps that need the grid are judged as ever (the layout never went).
# shellcheck disable=SC2016  # Evaluated by the check's own bash.
CHECK_STUB_OVERRIDES='eval "original_$(declare -f replace_run_cockpit_fixture)"
replace_run_cockpit_fixture() {
  [[ "$2" == "$UNREADABLE_LAYOUT_JQ" ]] && return 1
  original_replace_run_cockpit_fixture "$@"
}'
check_cockpit_stubbed "$CHECK_ANSWERS"
CHECK_STUB_OVERRIDES=""
layout_not_rewritten_summary="$(check_step_verdicts layer-readd)"
layout_not_rewritten_summary+="/$(grep -c -x -F "could not judge layer-readd: could not rewrite the run's fixture" \
  <<<"$CHECK_STUB_OUTPUT")"
layout_not_rewritten_summary+=" removed-asked=$(check_stub_call_count '^resourcePulseCockpitCheck layer-removed$')"
layout_not_rewritten_summary+=" placement-asked=$(check_stub_call_count '^resourcePulseCockpitCheck layer-placement$')"
layout_not_rewritten_summary+=" fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed) $(check_step_verdicts lock-path count-budgets)"
check "nested: check cockpit's layer-readd could not be judged when it could not rewrite the run's fixture, asks neither half, leaves the fixture as start wrote it, and the steps that need the grid are still judged" \
  "$layout_not_rewritten_summary" \
  "layer-readd:unjudged/1 removed-asked=0 placement-asked=1 fixture=restored lock-path:ok count-budgets:ok"

# The line the extension writes for an unreadable layout (its client log's console.warn: GNOME Shell's WARNING mark,
# as in a nested run's log) is provoked by layer-readd, and the log steps never read it as a fault of the
# extension; a critical between the two halves still reads as it does anywhere (one of St naming the extension's widget
# by its GType name, which no stack ties to the extension: could not be judged). In the first of these passes the
# check's waits are recorded too: right before its screenshot the check waits SCREENSHOT_WINDOW_EFFECT_WAIT_SECONDS (2)
# after the pointer's rest, so that no closing window's effect is in the picture.
LAYOUT_UNREADABLE_LOG_LINE='(gnome-shell:7): GNOME Shell-WARNING **: 10:00:04.000: resource-pulse: could not read the'
LAYOUT_UNREADABLE_LOG_LINE+=' cockpit layout (missing), so the card is drawn top right'
LAYER_READD_ST_CRITICAL_LINE='(gnome-shell:7): St-CRITICAL **: 10:00:04.100: st_widget_get_theme_node called on the'
LAYER_READD_ST_CRITICAL_LINE+=' widget [0x5600 Gjs_resource-pulse_zvibaratz_github_io_cockpitLayer_CockpitLayer.rp-cockpit-layer'
LAYER_READD_ST_CRITICAL_LINE+=':insensitive ("MACHINE")] which is not in the stage.'
layout_line_answers="$(answers_with layout-line resourcePulseCockpitCheck.layer-removed.log \
  "$LAYOUT_UNREADABLE_LOG_LINE")"
# shellcheck disable=SC2016  # Evaluated by the check's own bash.
CHECK_STUB_OVERRIDES='sleep() { printf "sleep %s\n" "$1" >>"$CHECK_STUB_CALLS"; }'
check_cockpit_stubbed "$layout_line_answers"
CHECK_STUB_OVERRIDES=""
provoked_layout_line_summary="provoked=$(grep -c -x -F "$LAYOUT_UNREADABLE_LOG_LINE" "$CHECK_RUN/log/shell.log")"
provoked_layout_line_summary+=" $(check_step_verdicts layer-readd log)"
screenshot_wait_summary="before-screenshot=[$(grep -B 3 -x -F 'Screenshot cockpit-1.png' "$CHECK_CALLS" | head -n 3 \
  | tr '\n' ' ')]"
layout_critical_answers="$(answers_with layout-critical resourcePulseCockpitCheck.layer-removed.log \
  "$LAYOUT_UNREADABLE_LOG_LINE"$'\n'"$LAYER_READD_ST_CRITICAL_LINE")"
check_cockpit_stubbed "$layout_critical_answers"
provoked_layout_line_summary+=" with-critical=$(check_step_verdicts log)"
provoked_layout_line_summary+="/$(grep -c -F 'could not judge log: 1 critical line(s) of the toolkit' <<<"$CHECK_STUB_OUTPUT")"
check "nested: check cockpit's log steps do not read layer-readd's own provoked line (a warning) as a fault of the extension, and still read a critical between its halves as they would anywhere" \
  "$provoked_layout_line_summary" "provoked=1 layer-readd:ok log:ok with-critical=log:unjudged/1"
check "nested: check cockpit waits after the pointer's rest before its screenshot, so that no closing window's effect is in the picture" \
  "$screenshot_wait_summary" \
  'before-screenshot=[resourcePulseNestedPointer move resourcePulseNestedPointer at sleep 2 ]'

# A window whose pid record cannot be written (a directory stands where the
# record goes) is ended at once: no stop and no exit could find it by its
# record.
make_check_run yes
mkdir -p "$CHECK_RUN/state/windows/herdr-probe.pid" || fatal "cannot lay out $CHECK_RUN's windows"
# shellcheck disable=SC2016  # Expanded by the child bash.
unrecorded_window_output="$(env "${LIVE_SETTINGS_BARRIER[@]}" bash -c '
  source "$1" || exit 99
  shift
  start_probe_window "$@"
  printf "status=%s pid=%s\n" "$?" "$OPENED_WINDOW_PID"
' unrecorded-window "$NESTED_SCRIPT" "$CHECK_RUN" "unix:path=$CHECK_RUN/bus/session.sock" herdr-probe \
  "$CHECK_STUB_BIN/gjs" 2>&1)"
unrecorded_window_pid="$(sed -n -E 's/^status=[0-9]+ pid=([0-9]+)$/\1/p' <<<"$unrecorded_window_output")"
for _ in 1 2 3 4 5 6 7 8 9 10; do is_running "$unrecorded_window_pid" || break; sleep 0.1; done
unrecorded_window_summary="$(grep -o -E '^status=[0-9]+' <<<"$unrecorded_window_output")"
# Its launch line is no proof here: it may be ended before it writes one. The pid start_probe_window kept is.
unrecorded_window_summary+=" started=$([[ "$unrecorded_window_pid" =~ ^[1-9][0-9]*$ ]] && printf pid || printf none)"
unrecorded_window_summary+=" ended=$(is_running "$unrecorded_window_pid" && printf no || printf yes)"
unrecorded_window_summary+=" noted=$(grep -c -F "could not record the window of pid $unrecorded_window_pid, so it was ended" \
  <<<"$unrecorded_window_output")"
is_running "$unrecorded_window_pid" && kill "$unrecorded_window_pid" 2>/dev/null
check "nested: a window whose pid record cannot be written is ended at once, since no stop or exit could find it" \
  "$unrecorded_window_summary" "status=1 started=pid ended=yes noted=1"

# A fixture that could not be put back makes the step that ran on it could not
# judge: the step after the cover's put-back (stale), the stale step whose own
# put-back failed (stale-recovers, layer-readd), and the step after the dropdown's
# (dropdown-click); layer-readd then judges no second half, and the later steps
# that need the grid (lock-path, count-budgets) could not be judged either,
# since the layout may not be back. Every put-back fails here.
CHECK_FIXTURE_NOT_RESTORED_DETAIL="the run's fixture could not be put back as start wrote it, so this step ran on a"
CHECK_FIXTURE_NOT_RESTORED_DETAIL+=" rewritten one"
CHECK_GRID_NOT_BACK_DETAIL='layer-readd could not put the layout back, so the grid this step needs may not be drawn'
CHECK_STUB_RESTORE_FAILS=1 check_cockpit_stubbed "$CHECK_ANSWERS"
restore_failed_summary="exit=$CHECK_STUB_EXIT $(check_step_verdicts stale stale-recovers layer-readd dropdown-click \
  lock-path count-budgets)"
restore_failed_summary+=" named=$(grep -c -E \
  "^could not judge (stale|stale-recovers|layer-readd|dropdown-click): $CHECK_FIXTURE_NOT_RESTORED_DETAIL$" \
  <<<"$CHECK_STUB_OUTPUT")"
restore_failed_summary+=" grid-named=$(grep -c -E "^could not judge (lock-path|count-budgets): $CHECK_GRID_NOT_BACK_DETAIL$" \
  <<<"$CHECK_STUB_OUTPUT")"
restore_failed_summary+=" placement-asked=$(check_stub_call_count '^resourcePulseCockpitCheck layer-placement$')"
restore_failed_summary+=" lock-path-asked=$(check_stub_call_count '^resourcePulseCockpitCheck lock-path$')"
restore_failed_summary+=" summary=$(grep -c -x -F 'check cockpit: 26 ok, 0 bad, 6 could not judge' <<<"$CHECK_STUB_OUTPUT")"
check "nested: check cockpit makes the step that ran on a fixture it could not put back could not judge (the next step, or the one whose own put-back failed); with the layout not put back, layer-readd judges nothing back and the steps that need the grid (lock-path, count-budgets) could not be judged" \
  "$restore_failed_summary" \
  "exit=2 stale:unjudged stale-recovers:unjudged layer-readd:unjudged dropdown-click:unjudged lock-path:unjudged count-budgets:unjudged named=4 grid-named=2 placement-asked=1 lock-path-asked=0 summary=1"

# The first pass's layer and grid steps ask again while the answer is bad, as layer-readd's do: a shell just started
# may not have placed its grid for good (DisplayConfig's answer places it again). A first answer that is bad and a
# second that is ok pass both steps; a layer-placement bad every time is still bad once the waits run out, and asked
# STATE_SETTLE_ATTEMPTS times in that pass (layer-readd asks it twice more, as in a healthy run).
FIRST_PASS_NOT_PLACED_DETAIL='DisplayConfig has not answered, or its read failed'
FIRST_PASS_NOT_PLACED_ANSWER="{\"verdict\":\"bad\",\"detail\":\"$FIRST_PASS_NOT_PLACED_DETAIL\"}"
LAYER_READD_PLACEMENT_ASKS=2
first_pass_settles_answers="$(answers_with first-pass-settles \
  resourcePulseCockpitCheck.layer-placement.1 "$FIRST_PASS_NOT_PLACED_ANSWER" \
  resourcePulseCockpitCheck.grid-geometry.1 '{"verdict":"bad","detail":"the system card is not at its cell"}')"
check_cockpit_stubbed "$first_pass_settles_answers"
first_pass_summary="settles=$(check_step_verdicts layer grid)"
first_pass_summary+="/placement-asked=$(check_stub_call_count '^resourcePulseCockpitCheck layer-placement$')"
first_pass_summary+="/geometry-asked=$(check_stub_call_count '^resourcePulseCockpitCheck grid-geometry$')"
never_placed_pairs=()
for (( attempt = 1; attempt <= CHECK_STATE_SETTLE_ATTEMPTS; attempt++ )); do
  never_placed_pairs+=("resourcePulseCockpitCheck.layer-placement.$attempt" "$FIRST_PASS_NOT_PLACED_ANSWER")
done
first_pass_never_answers="$(answers_with first-pass-never "${never_placed_pairs[@]}")"
check_cockpit_stubbed "$first_pass_never_answers"
first_pass_summary+=" never=$(check_step_verdicts layer)"
first_pass_summary+="/$(grep -c -x -F "bad layer: $FIRST_PASS_NOT_PLACED_DETAIL" <<<"$CHECK_STUB_OUTPUT")"
first_pass_placement_asks="$(check_stub_call_count '^resourcePulseCockpitCheck layer-placement$')"
first_pass_summary+="/first-pass-placement-asked=$((first_pass_placement_asks - LAYER_READD_PLACEMENT_ASKS))"
check "nested: check cockpit's first layer and grid steps ask again while their answer is bad, so a grid placed again just after start passes, and one never placed is bad once the waits run out" \
  "$first_pass_summary" \
  "settles=layer:ok grid:ok/placement-asked=4/geometry-asked=3 never=layer:bad/1/first-pass-placement-asked=$CHECK_STATE_SETTLE_ATTEMPTS"

# This table's own total. The guide states it.
EXPECTED_ROWS=34

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
