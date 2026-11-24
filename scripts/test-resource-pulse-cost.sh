#!/usr/bin/env bash
#
# scripts/test-resource-pulse-cost.sh
# ===================================
#
# State table for scripts/resource-pulse-cost.sh, the script that measures the
# Resource Pulse shell extension's and its services' cost (RSS, CPU, tick
# median) from a /proc tree. Every row runs it over a fake PROC_ROOT built in
# this run's temporary directory, with a systemctl stub: it never reads the live
# /proc of the processes it measures, and never the live user manager.
#
# "Could not run" is exit 2, never a pass. The table asserts its own row total.
# Its shared helpers and constants are scripts/resource-pulse-table-lib.sh's.
#
# Requires: bash and coreutils. The extension's lib/constants.js is read (as text) for the sampling interval. No
# gjs, no network, no root.
#
# Usage: scripts/test-resource-pulse-cost.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
source "$TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
start_table

[[ -d "$EXT_DIR" ]] || fatal "no extension directory at $EXT_DIR"

# The script this table's rows run.
COST_SCRIPT="$REPO_ROOT/scripts/resource-pulse-cost.sh"

printf '\nresource-pulse-cost.sh (fake PROC_ROOT)\n'
# make_fake_proc <root> <pid> <comm> <vmrss_kib> builds one process entry. Its
# stat carries clock ticks (utime 100, stime 50), which the cost script must
# never read for CPU: reading them, or falling back to them, gives a reading
# where a row expects a different one or exit 2.
make_fake_proc() {
  mkdir -p "$1/$2"
  printf '%s\n' "$3" >"$1/$2/comm"
  printf 'Name:\t%s\nVmRSS:\t%s kB\n' "$3" "$4" >"$1/$2/status"
  printf '%s (%s) S 1 1 1 0 -1 0 0 0 0 0 100 50 0 0 20 0 1 0 1 0 0\n' "$2" "$3" >"$1/$2/stat"
}
# write_fake_schedstat <root> <pid> <tid> <line> writes one thread's <root>/<pid>/task/<tid>/schedstat: the
# scheduler's time on a CPU (ns), time waiting (ns) and timeslices.
write_fake_schedstat() {
  mkdir -p "$1/$2/task/$3" && printf '%s\n' "$4" >"$1/$2/task/$3/schedstat"
}
ONE_SHELL_ROOT="$WIRING_TMP/proc-one"
TWO_SHELLS_ROOT="$WIRING_TMP/proc-two"
NO_SHELL_ROOT="$WIRING_TMP/proc-none"
FAKE_SHELL_RSS_KIB=400000
make_fake_proc "$ONE_SHELL_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
make_fake_proc "$ONE_SHELL_ROOT" 4300 bash 1000
make_fake_proc "$TWO_SHELLS_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
make_fake_proc "$TWO_SHELLS_ROOT" 4243 gnome-shell "$FAKE_SHELL_RSS_KIB"
make_fake_proc "$NO_SHELL_ROOT" 4300 bash 1000
cost_run() { # <proc root> <args...>; leaves COST_OUTPUT and COST_EXIT
  local proc_root="$1"; shift
  COST_OUTPUT="$(env -u GNOME_SHELL_PID PROC_ROOT="$proc_root" bash "$COST_SCRIPT" "$@" 2>&1)"
  COST_EXIT=$?
}
cost_run "$ONE_SHELL_ROOT" --rss-kib
check "cost: --rss-kib prints the VmRSS of the one gnome-shell" "$COST_OUTPUT" "$FAKE_SHELL_RSS_KIB"
cost_run "$ONE_SHELL_ROOT" --rss-check 380000
check "cost: growth inside the tolerance exits 0" "$COST_EXIT" 0
cost_run "$ONE_SHELL_ROOT" --rss-check 300000
check "cost: growth beyond the tolerance exits 1" "$COST_EXIT" 1
check "cost: a failed check prints both the baseline and the current number" \
  "$(grep -c -F '300000' <<<"$COST_OUTPUT")$(grep -c -F "$FAKE_SHELL_RSS_KIB" <<<"$COST_OUTPUT")" 11
cost_run "$TWO_SHELLS_ROOT" --rss-kib
check "cost: two gnome-shell candidates exit 2" "$COST_EXIT" 2
cost_run "$NO_SHELL_ROOT" --rss-kib
check "cost: no gnome-shell candidate exits 2" "$COST_EXIT" 2

# CPU comes from the scheduler's own nanosecond counters, one per thread
# (<proc>/<pid>/task/<tid>/schedstat, first field), never from stat's clock
# ticks. `sleep` is a stub on PATH: it records each call's argument and, on its
# Nth call, copies <steps dir>/<N>/ over the fake proc root, as that much of the
# window would move the counters on.
COST_STUB_BIN="$WIRING_TMP/cost-bin"
COST_SLEEP_CALLS="$WIRING_TMP/cost-sleep-calls"
COST_WINDOW_SECONDS=2
# shellcheck disable=SC2016  # The stub's own source: its variables expand when it runs.
install_stub "$COST_STUB_BIN" sleep '#!/usr/bin/env bash
printf "%s\n" "$*" >>"$COST_SLEEP_CALLS"
sleep_call_number=$(( $(wc -l <"$COST_SLEEP_CALLS") ))
step_dir="$COST_SLEEP_STEPS/$sleep_call_number"
if [[ -d "$step_dir" ]]; then cp -R "$step_dir/." "$COST_SLEEP_PROC_ROOT/"; fi'
# cost_steps_run <proc root> <steps dir> <args...> runs the cost script against
# a fake proc root (GNOME_SHELL_PID names its gnome-shell, 4242), the sleep stub
# moving it through the steps; leaves COST_OUTPUT, COST_EXIT and the sleep calls.
cost_steps_run() {
  local proc_root="$1" steps_dir="$2"
  shift 2
  : >"$COST_SLEEP_CALLS"
  COST_OUTPUT="$(PATH="$COST_STUB_BIN:$PATH" GNOME_SHELL_PID=4242 PROC_ROOT="$proc_root" \
    COST_SLEEP_CALLS="$COST_SLEEP_CALLS" COST_SLEEP_STEPS="$steps_dir" COST_SLEEP_PROC_ROOT="$proc_root" \
    bash "$COST_SCRIPT" "$@" 2>&1)"
  COST_EXIT=$?
}
# --cpu-percent over a fake window, two threads: 4 ms and 6 ms on a CPU before,
# each 5 ms more after, so 10 ms over 2 s is 0.500% of one core (one thread
# alone reads 0.250). The other two fields (time waiting, timeslices) move by
# other amounts, so reading the wrong field gives another number.
CPU_PROC_ROOT="$WIRING_TMP/proc-cpu"
CPU_SLEEP_STEPS="$WIRING_TMP/cost-cpu-steps"
make_fake_proc "$CPU_PROC_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
write_fake_schedstat "$CPU_PROC_ROOT" 4242 4242 '4000000 0 1'
write_fake_schedstat "$CPU_PROC_ROOT" 4242 4243 '6000000 0 1'
write_fake_schedstat "$CPU_SLEEP_STEPS/1" 4242 4242 '9000000 3000000 4'
write_fake_schedstat "$CPU_SLEEP_STEPS/1" 4242 4243 '11000000 8000000 9'
cost_steps_run "$CPU_PROC_ROOT" "$CPU_SLEEP_STEPS" --cpu-percent "$COST_WINDOW_SECONDS"
check "cost: --cpu-percent is every thread's Δ schedstat time on a CPU (ns) / the window × 100, over the window it was given" \
  "exit=$COST_EXIT percent=$COST_OUTPUT slept=$(tr '\n' ' ' <"$COST_SLEEP_CALLS")" \
  "exit=0 percent=0.500 slept=$COST_WINDOW_SECONDS "

# --tick-median reads the main thread (its tid is the pid) once a tick, at the
# extension's SAMPLE_INTERVAL_SECONDS (read here from lib/constants.js, so the
# cost script's copy of it cannot drift unseen), and prints the median of its
# CPU per tick in ms. Five ticks of 3, 1, 40 (a collection), 1.5 and 2.5 ms: the
# median is 2.50 and the mean 9.60; the other thread's 100 ms a tick shows if
# every thread were read. A window under one tick is a usage error.
SAMPLE_INTERVAL_SECONDS_IN_CONSTANTS="$(sed -n 's/^export const SAMPLE_INTERVAL_SECONDS = \([0-9][0-9]*\);$/\1/p' \
  "$EXT_DIR/lib/constants.js" 2>/dev/null)"
[[ "$SAMPLE_INTERVAL_SECONDS_IN_CONSTANTS" =~ ^[1-9][0-9]*$ ]] \
  || fatal "cannot read SAMPLE_INTERVAL_SECONDS from $EXT_DIR/lib/constants.js"
TICK_PROC_ROOT="$WIRING_TMP/proc-tick"
TICK_SLEEP_STEPS="$WIRING_TMP/cost-tick-steps"
TICK_MAIN_THREAD_NANOSECONDS=(3000000 1000000 40000000 1500000 2500000)
TICK_OTHER_THREAD_NANOSECONDS=100000000
make_fake_proc "$TICK_PROC_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
write_fake_schedstat "$TICK_PROC_ROOT" 4242 4242 '1000000 0 1'
write_fake_schedstat "$TICK_PROC_ROOT" 4242 4243 '0 0 1'
tick_main_thread_total=1000000
tick_other_thread_total=0
expected_tick_sleeps=""
for tick_index in "${!TICK_MAIN_THREAD_NANOSECONDS[@]}"; do
  tick_main_thread_total=$((tick_main_thread_total + TICK_MAIN_THREAD_NANOSECONDS[tick_index]))
  tick_other_thread_total=$((tick_other_thread_total + TICK_OTHER_THREAD_NANOSECONDS))
  write_fake_schedstat "$TICK_SLEEP_STEPS/$((tick_index + 1))" 4242 4242 "$tick_main_thread_total 0 1"
  write_fake_schedstat "$TICK_SLEEP_STEPS/$((tick_index + 1))" 4242 4243 "$tick_other_thread_total 0 1"
  expected_tick_sleeps+="$SAMPLE_INTERVAL_SECONDS_IN_CONSTANTS "
done
tick_window_seconds=$(( ${#TICK_MAIN_THREAD_NANOSECONDS[@]} * SAMPLE_INTERVAL_SECONDS_IN_CONSTANTS ))
cost_steps_run "$TICK_PROC_ROOT" "$TICK_SLEEP_STEPS" --tick-median "$tick_window_seconds"
tick_median_summary="exit=$COST_EXIT median=$COST_OUTPUT slept=$(tr '\n' ' ' <"$COST_SLEEP_CALLS")"
# An even count, as perf's 30 ticks are: the first four ticks, 3, 1, 40 and 1.5 ms, sort to 1, 1.5, 3, 40, and the
# script reports the UPPER of the two middle ones, 3.00 (the lower would be 1.50, their mean 2.25).
write_fake_schedstat "$TICK_PROC_ROOT" 4242 4242 '1000000 0 1'
write_fake_schedstat "$TICK_PROC_ROOT" 4242 4243 '0 0 1'
cost_steps_run "$TICK_PROC_ROOT" "$TICK_SLEEP_STEPS" --tick-median $(( 4 * SAMPLE_INTERVAL_SECONDS_IN_CONSTANTS ))
tick_median_summary+=" even-count=$COST_EXIT/$COST_OUTPUT"
cost_steps_run "$TICK_PROC_ROOT" "$TICK_SLEEP_STEPS" --tick-median $((SAMPLE_INTERVAL_SECONDS_IN_CONSTANTS - 1))
tick_median_summary+=" under-one-tick=$COST_EXIT/$(grep -c -F 'needs at least one tick' <<<"$COST_OUTPUT")"
check "cost: --tick-median prints the median ms of the main thread's CPU per tick, read every SAMPLE_INTERVAL_SECONDS of lib/constants.js; under one tick is a usage error" \
  "$tick_median_summary" "exit=0 median=2.50 slept=$expected_tick_sleeps even-count=0/3.00 under-one-tick=2/1"

# A counter that cannot be read is exit 2, never a reading of 0: a thread
# listed with no schedstat (a kernel that keeps none), a process with no task
# directory, and a first field that is not a number, in both modes. Each case
# prints its exit and whether any number came out.
MISSING_SCHEDSTAT_PROC_ROOT="$WIRING_TMP/proc-no-schedstat"
NO_TASK_DIR_PROC_ROOT="$WIRING_TMP/proc-no-task-dir"
MALFORMED_SCHEDSTAT_PROC_ROOT="$WIRING_TMP/proc-malformed-schedstat"
NO_COST_STEPS="$WIRING_TMP/cost-no-steps"
make_fake_proc "$MISSING_SCHEDSTAT_PROC_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
mkdir -p "$MISSING_SCHEDSTAT_PROC_ROOT/4242/task/4242"
write_fake_schedstat "$MISSING_SCHEDSTAT_PROC_ROOT" 4242 4243 '6000000 0 1'
make_fake_proc "$NO_TASK_DIR_PROC_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
make_fake_proc "$MALFORMED_SCHEDSTAT_PROC_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
write_fake_schedstat "$MALFORMED_SCHEDSTAT_PROC_ROOT" 4242 4242 'n/a 0 1'
# unreadable_counter_verdict <proc root> <mode> prints exit/no-reading, or exit/the reading it printed.
unreadable_counter_verdict() {
  cost_steps_run "$1" "$NO_COST_STEPS" "$2" "$COST_WINDOW_SECONDS"
  if grep -q -E '^[0-9]+(\.[0-9]+)?$' <<<"$COST_OUTPUT"; then
    printf '%s/reading-%s' "$COST_EXIT" "$(grep -E '^[0-9]+(\.[0-9]+)?$' <<<"$COST_OUTPUT" | head -n 1)"
  else
    printf '%s/no-reading' "$COST_EXIT"
  fi
}
unreadable_counter_summary=""
for unreadable_mode in --cpu-percent --tick-median; do
  unreadable_counter_summary+="${unreadable_mode#--}:"
  unreadable_counter_summary+=" no-schedstat=$(unreadable_counter_verdict "$MISSING_SCHEDSTAT_PROC_ROOT" \
    "$unreadable_mode")"
  unreadable_counter_summary+=" no-task-dir=$(unreadable_counter_verdict "$NO_TASK_DIR_PROC_ROOT" "$unreadable_mode")"
  unreadable_counter_summary+=" malformed=$(unreadable_counter_verdict "$MALFORMED_SCHEDSTAT_PROC_ROOT" \
    "$unreadable_mode") "
done
check "cost: a schedstat that is missing, a process with no task dir and a counter that is not a number are exit 2 in both modes, never a reading" \
  "$unreadable_counter_summary" \
  "cpu-percent: no-schedstat=2/no-reading no-task-dir=2/no-reading malformed=2/no-reading tick-median: no-schedstat=2/no-reading no-task-dir=2/no-reading malformed=2/no-reading "

# --service measures the sampler service the same way, found by its unit's
# MainPID: a systemctl stub answers that one property and records the call,
# behind the barrier, so no real user manager is ever asked. The fake root
# holds a gnome-shell too, named by GNOME_SHELL_PID, which --service must never
# measure. The service's main thread goes from 10 ms to 28 ms on a CPU: 18 ms
# over 2 s is 0.900% of one core; gnome-shell's moves by 50 ms (2.500%), so
# measuring it instead shows.
SERVICE_PROC_ROOT="$WIRING_TMP/proc-service"
SERVICE_SLEEP_STEPS="$WIRING_TMP/cost-service-steps"
FAKE_SERVICE_PID=5151
# A healthy sampler's resident memory: the live reading after the switch to the compiled program.
FAKE_SERVICE_RSS_KIB=4004
# The budget for the sampler's resident memory, 8 MiB, written out.
SERVICE_RSS_BUDGET_KIB=8192
SERVICE_UNIT_NAME="resource-pulse.service"
FAKE_SCHEDSTAT_BEFORE='10000000 0 1'
make_fake_proc "$SERVICE_PROC_ROOT" 4242 gnome-shell "$FAKE_SHELL_RSS_KIB"
make_fake_proc "$SERVICE_PROC_ROOT" "$FAKE_SERVICE_PID" gjs "$FAKE_SERVICE_RSS_KIB"
write_fake_schedstat "$SERVICE_SLEEP_STEPS/1" "$FAKE_SERVICE_PID" "$FAKE_SERVICE_PID" '28000000 4000000 7'
write_fake_schedstat "$SERVICE_SLEEP_STEPS/1" 4242 4242 '60000000 9000000 11'
COST_SYSTEMCTL_STUB_BIN="$WIRING_TMP/cost-systemctl-bin"
COST_SYSTEMCTL_CALLS="$WIRING_TMP/cost-systemctl-calls"
# shellcheck disable=SC2016  # The stub's own source: its variables expand when it runs.
install_stub "$COST_SYSTEMCTL_STUB_BIN" systemctl '#!/usr/bin/env bash
printf "%s\n" "$*" >>"$COST_SYSTEMCTL_CALLS"
case "$*" in
  "--user show -p MainPID --value resource-pulse.service") printf "%s\n" "$COST_SERVICE_MAIN_PID" ;;
  "--user show -p MainPID --value resource-pulse-cockpit.service") printf "%s\n" "${COST_COCKPIT_MAIN_PID:-0}" ;;
  *) printf "unexpected systemctl call: %s\n" "$*" >&2; exit 64 ;;
esac
exit "${COST_SYSTEMCTL_EXIT:-0}"'
# cost_service_run <MainPID answer> <args...> [-- with COST_SYSTEMCTL_EXIT in the
# caller's environment]; leaves COST_OUTPUT, COST_EXIT and the systemctl calls.
# Each run starts the service's and gnome-shell's counters from "before", which
# the sleep stub moves on.
cost_service_run() {
  local main_pid_answer="$1"
  shift
  if ! write_fake_schedstat "$SERVICE_PROC_ROOT" "$FAKE_SERVICE_PID" "$FAKE_SERVICE_PID" "$FAKE_SCHEDSTAT_BEFORE" ||
    ! write_fake_schedstat "$SERVICE_PROC_ROOT" 4242 4242 "$FAKE_SCHEDSTAT_BEFORE"; then
    fatal "cannot reset the fake service's and gnome-shell's schedstat"
  fi
  : >"$COST_SYSTEMCTL_CALLS"
  : >"$COST_SLEEP_CALLS"
  COST_OUTPUT="$(env "${LIVE_SETTINGS_BARRIER[@]}" PATH="$COST_STUB_BIN:$COST_SYSTEMCTL_STUB_BIN:$PATH" \
    GNOME_SHELL_PID=4242 PROC_ROOT="$SERVICE_PROC_ROOT" COST_SYSTEMCTL_CALLS="$COST_SYSTEMCTL_CALLS" \
    COST_SERVICE_MAIN_PID="$main_pid_answer" COST_SLEEP_CALLS="$COST_SLEEP_CALLS" \
    COST_SLEEP_STEPS="$SERVICE_SLEEP_STEPS" COST_SLEEP_PROC_ROOT="$SERVICE_PROC_ROOT" \
    bash "$COST_SCRIPT" "$@" 2>&1)"
  COST_EXIT=$?
}
SERVICE_MAIN_PID_CALL="--user show -p MainPID --value $SERVICE_UNIT_NAME;"
cost_service_run "$FAKE_SERVICE_PID" --service --rss-kib
check "cost: --service --rss-kib prints the service's VmRSS, found by its unit's MainPID, never gnome-shell's" \
  "exit=$COST_EXIT rss=$COST_OUTPUT calls=[$(tr '\n' ';' <"$COST_SYSTEMCTL_CALLS")]" \
  "exit=0 rss=$FAKE_SERVICE_RSS_KIB calls=[$SERVICE_MAIN_PID_CALL]"
cost_service_run "$FAKE_SERVICE_PID" --service --cpu-percent "$COST_WINDOW_SECONDS"
check "cost: --service --cpu-percent measures the service's own schedstat over the window, as for gnome-shell" \
  "exit=$COST_EXIT percent=$COST_OUTPUT slept=$(tr '\n' ' ' <"$COST_SLEEP_CALLS")" \
  "exit=0 percent=0.900 slept=$COST_WINDOW_SECONDS "
cost_unmeasurable_summary=""
cost_service_run 0 --service --rss-kib
cost_unmeasurable_summary+="not-running=$COST_EXIT/$(grep -c -F 'is not running' <<<"$COST_OUTPUT")"
cost_service_run '' --service --rss-kib
cost_unmeasurable_summary+=" empty=$COST_EXIT/$(grep -c -F 'MainPID is not a number' <<<"$COST_OUTPUT")"
COST_SYSTEMCTL_EXIT=1 cost_service_run "$FAKE_SERVICE_PID" --service --rss-kib
cost_unmeasurable_summary+=" no-manager=$COST_EXIT/$(grep -c -F 'systemctl --user show' <<<"$COST_OUTPUT")"
check "cost: --service exits 2 and says why when the service is not running, its MainPID is unreadable, or systemctl fails" \
  "$cost_unmeasurable_summary" "not-running=2/1 empty=2/1 no-manager=2/1"
cost_service_usage_summary=""
cost_service_run "$FAKE_SERVICE_PID" --service --rss-check 50000
cost_service_usage_summary+="rss-check=$COST_EXIT/$(grep -c -E -- "--service --rss-kib must read at most ${SERVICE_RSS_BUDGET_KIB}\$" <<<"$COST_OUTPUT")"
cost_service_run "$FAKE_SERVICE_PID" --service
cost_service_usage_summary+=" alone=$COST_EXIT/$(grep -c -F 'usage:' <<<"$COST_OUTPUT")"
check "cost: --service --rss-check is refused, naming the sampler's own budget ($SERVICE_RSS_BUDGET_KIB KiB), and --service alone is a usage error" \
  "$cost_service_usage_summary calls=$(wc -l <"$COST_SYSTEMCTL_CALLS")" "rss-check=2/1 alone=2/1 calls=0"
# --service anywhere on the line: after the mode, it must still measure the
# service, never silently gnome-shell.
cost_flag_order_summary=""
cost_service_run "$FAKE_SERVICE_PID" --rss-kib --service
cost_flag_order_summary+="rss-kib=$COST_EXIT/$COST_OUTPUT"
cost_service_run "$FAKE_SERVICE_PID" --cpu-percent "$COST_WINDOW_SECONDS" --service
cost_flag_order_summary+=" cpu-percent=$COST_EXIT/$COST_OUTPUT"
check "cost: --service after the mode still measures the service" \
  "$cost_flag_order_summary" "rss-kib=0/$FAKE_SERVICE_RSS_KIB cpu-percent=0/0.900"
# --cockpit measures resource-pulse-cockpit.service the same way, by its own unit's MainPID:
# the fake root holds the sampler's process as well as gnome-shell, and the
# stub answers both units, so measuring either neighbour shows as its number.
FAKE_COCKPIT_PID=6161
FAKE_COCKPIT_RSS_KIB=31000
# The budget for the cockpit's resident memory, 48 MiB, written out.
COCKPIT_RSS_BUDGET_KIB=49152
make_fake_proc "$SERVICE_PROC_ROOT" "$FAKE_COCKPIT_PID" gjs "$FAKE_COCKPIT_RSS_KIB"
COST_COCKPIT_MAIN_PID="$FAKE_COCKPIT_PID" cost_service_run "$FAKE_SERVICE_PID" --cockpit --rss-kib
check "cost: --cockpit --rss-kib prints resource-pulse-cockpit.service's VmRSS, found by its own unit's MainPID, never the sampler's or gnome-shell's" \
  "exit=$COST_EXIT rss=$COST_OUTPUT calls=[$(tr '\n' ';' <"$COST_SYSTEMCTL_CALLS")]" \
  "exit=0 rss=$FAKE_COCKPIT_RSS_KIB calls=[--user show -p MainPID --value resource-pulse-cockpit.service;]"
cost_cockpit_usage_summary=""
COST_COCKPIT_MAIN_PID="$FAKE_COCKPIT_PID" cost_service_run "$FAKE_SERVICE_PID" --cockpit --rss-check 30000
cost_cockpit_usage_summary+="rss-check=$COST_EXIT/$(grep -c -E -- "--cockpit --rss-kib must read at most ${COCKPIT_RSS_BUDGET_KIB}\$" <<<"$COST_OUTPUT")"
COST_COCKPIT_MAIN_PID="$FAKE_COCKPIT_PID" cost_service_run "$FAKE_SERVICE_PID" --service --cockpit --rss-kib
cost_cockpit_usage_summary+=" both-flags=$COST_EXIT/$(grep -c -F 'usage:' <<<"$COST_OUTPUT")"
check "cost: --cockpit --rss-check is refused, naming the cockpit's own budget ($COCKPIT_RSS_BUDGET_KIB KiB), and --service with --cockpit is a usage error" \
  "$cost_cockpit_usage_summary calls=$(wc -l <"$COST_SYSTEMCTL_CALLS")" "rss-check=2/1 both-flags=2/1 calls=0"
# Anything left over is a usage error, never ignored.
cost_leftover_summary=""
cost_service_run "$FAKE_SERVICE_PID" --rss-kib --serivce
cost_leftover_summary+="misspelt-flag=$COST_EXIT/$(grep -c -F 'usage:' <<<"$COST_OUTPUT")"
cost_service_run "$FAKE_SERVICE_PID" --service --cpu-percent "$COST_WINDOW_SECONDS" 60
cost_leftover_summary+=" extra-number=$COST_EXIT/$(grep -c -F 'usage:' <<<"$COST_OUTPUT")"
cost_run "$ONE_SHELL_ROOT" --rss-check 380000 extra
cost_leftover_summary+=" rss-check-extra=$COST_EXIT/$(grep -c -F 'usage:' <<<"$COST_OUTPUT")"
check "cost: an unknown or leftover argument is a usage error (exit 2), never ignored" \
  "$cost_leftover_summary calls=$(wc -l <"$COST_SYSTEMCTL_CALLS")" \
  "misspelt-flag=2/1 extra-number=2/1 rss-check-extra=2/1 calls=0"
# Spelled by pieces so this row's own source is not what it finds in the script.
FORBIDDEN_READS_PATTERN="cmd""line|env""iron\\b|pgre""p|\\bps -"
check "cost: the script never reads an argument list or environment, or runs ps" \
  "$(grep -c -E "$FORBIDDEN_READS_PATTERN" "$COST_SCRIPT" 2>/dev/null)" 0

EXPECTED_ROWS=18

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
