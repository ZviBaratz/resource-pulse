#!/usr/bin/env bash
#
# scripts/test-resource-pulse-nested-signals.sh
# =============================================
#
# State table for the Resource Pulse nested-shell harness (scripts/resource-pulse-nested.sh), fourth of four: what
# ends, and when. A check session's process group and its guarded KILL; the table's own stand-ins, which end by
# their own lifetimes and by the table's exit on every path; check cockpit's exit and the TERMs that reach it, or
# its perf pass, during that pass and its put-back; and, last, the stand-ins a row abandoned on purpose, judged
# once their lifetimes have passed. That last row waits up to a minute and five seconds after they started, so the
# table runs for at least that long.
#
# "Could not run" is exit 2, never a pass: a missing timeout, setsid or jq, or a stand-in that could not be laid
# out, is fatal. The table asserts its own row total.
#
# Its shared helpers and constants are scripts/resource-pulse-table-lib.sh's, and the nested harness's fixtures
# (its stubs, its run directories, the sacrificial sessions, the fake gnome-shell)
# scripts/resource-pulse-nested-table-lib.sh's.
# The check's stand-ins (a busctl answering the in-shell requests, a gjs standing in for the probe window, the live
# run they act on) are scripts/resource-pulse-check-table-lib.sh's.
#
# Requires: bash, timeout, setsid (util-linux) and jq. No network, no gnome-shell.
#
# Usage: scripts/test-resource-pulse-nested-signals.sh

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

require_tools timeout setsid jq
start_nested_harness
start_check_stand_ins

printf '\nresource-pulse-nested.sh signals: check cockpit under TERM, and how the table stand-ins end (hermetic: sacrificial sessions only)\n'
# A row that runs check cockpit in a session of its own (a TERM to it, or to its process group, during its perf pass)
# bounds that session, and the windows its check opens, to CHECK_SESSION_LIFETIME_SECONDS: above the row's own waits
# (30 s for the check to reach its perf pass, 10 s for it to end), so that one a stopped table leaves behind (the row's
# own ending never reached, a KILL included) is gone within it. Its windows are the window stand-in's with that lifetime
# (CHECK_SESSION_BIN first on the session's PATH). The session's bound is a watchdog in its process group, detached
# from the check's shell (so no wait of the check waits for it) and deaf to the signals the rows send, which KILLs the
# whole group once the lifetime is up; while it runs the group cannot be gone. Once the row's wait has reaped the
# session's leader, only the watchdog holds the group's id, so the row's KILL of the group at its end goes out only
# while the watchdog can still be running (kill_check_session_group): within the lifetime less
# CHECK_SESSION_KILL_MARGIN_SECONDS of uptime since the session started. Uptime counts suspended time and the
# watchdog's sleep does not, so the guard can only stop early, never late; what it skips the watchdog ends. A row
# whose check did not end in time (ended=no) KILLs the group itself while its leader still runs (is_running), which
# ends the watchdog too, and then sends no guarded KILL: the group's id is held by nothing of the row's after it.
CHECK_SESSION_LIFETIME_SECONDS=60
CHECK_SESSION_KILL_MARGIN_SECONDS=2
CHECK_SESSION_BIN="$WIRING_TMP/check-session-bin"
CHECK_SESSION_WINDOW_RECORDS="$WIRING_TMP/check-session-window"
install_stub "$CHECK_SESSION_BIN" gjs "$(check_window_stand_in_source "$CHECK_SESSION_WINDOW_RECORDS.launches" \
  "$CHECK_SESSION_WINDOW_RECORDS.env-names" "$CHECK_SESSION_WINDOW_RECORDS.env-values" "$CHECK_WINDOW_BLOCK" \
  "$CHECK_SESSION_LIFETIME_SECONDS" "$TABLE_STAND_IN_REGISTRY")"
CHECK_SESSION_WINDOW_SCRIPT_PATH="$(readlink -f -- "$CHECK_SESSION_BIN/gjs")" || fatal "cannot resolve $CHECK_SESSION_BIN/gjs"
# shellcheck disable=SC2016  # Expanded by the session's own bash.
CHECK_SESSION_WATCHDOG='( ( trap "" TERM INT HUP; command sleep "$CHECK_SESSION_LIFETIME_SECONDS"; kill -KILL 0 ) & )'
# Assignments start_check_session adds to the session's environment, for one row.
CHECK_SESSION_EXTRA_ENV=()
# whole_uptime_seconds prints the whole seconds of /proc/uptime (time since boot, suspended time included).
whole_uptime_seconds() {
  local uptime_text
  read -r uptime_text _ 2>/dev/null </proc/uptime || return 1
  [[ "${uptime_text%%.*}" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "${uptime_text%%.*}"
}
# kill_check_session_group <process group id> <uptime the session started at> sends KILL to a check session's process
# group only while fewer than CHECK_SESSION_LIFETIME_SECONDS less CHECK_SESSION_KILL_MARGIN_SECONDS seconds of uptime
# have passed since it started: after that its watchdog may have fired, and the group's id may be another's. An uptime
# it cannot read, or a start it was not given, sends nothing.
kill_check_session_group() {
  local now_uptime
  [[ "$2" =~ ^[0-9]+$ ]] || return 0
  now_uptime="$(whole_uptime_seconds)" || return 0
  (( now_uptime - $2 < CHECK_SESSION_LIFETIME_SECONDS - CHECK_SESSION_KILL_MARGIN_SECONDS )) || return 0
  kill -KILL -- "-$1" 2>/dev/null
}
# start_check_session <output file> <bash source> <$0> [args...] runs the source in a new session (setsid) with the
# stubbed check's environment, CHECK_SESSION_EXTRA_ENV and the watchdog first, its output to the file; sets
# CHECK_SESSION_PID: its bash, the session's leader, whose pid is the session's and its process group's id; and
# CHECK_SESSION_STARTED_UPTIME: the uptime just before it started (empty when unreadable), for
# kill_check_session_group.
start_check_session() {
  local output_path="$1" session_source="$2"
  shift 2
  CHECK_SESSION_STARTED_UPTIME="$(whole_uptime_seconds)" || CHECK_SESSION_STARTED_UPTIME=""
  setsid env "${LIVE_SETTINGS_BARRIER[@]}" RESOURCE_PULSE_NESTED_DIR="$CHECK_RUN" \
    PATH="$CHECK_SESSION_BIN:$CHECK_STUB_BIN:$PATH" CHECK_STUB_ANSWERS="$CHECK_ANSWERS" CHECK_STUB_CALLS="$CHECK_CALLS" \
    CHECK_STUB_SHELL_LOG="$CHECK_RUN/log/shell.log" CHECK_SESSION_LIFETIME_SECONDS="$CHECK_SESSION_LIFETIME_SECONDS" \
    "${CHECK_SESSION_EXTRA_ENV[@]}" bash -c "$CHECK_SESSION_WATCHDOG"$'\n'"$session_source" "$@" \
    </dev/null >"$output_path" 2>&1 &
  CHECK_SESSION_PID=$!
}
# kill_check_session_group's guard: a stand-in session of this row's own (a sacrificial sleep leading a session and a
# process group of its own, never a real group) told it started now gets the KILL; told it started inside the margin
# before the session lifetime, or the whole lifetime ago, it gets nothing.
GUARDED_KILL_FATE_WAIT_TENTHS=10
# guarded_kill_fate <seconds since the session started, as told> prints ended, or running (then ends it by identity).
guarded_kill_fate() {
  local stand_in_pid stand_in_starttime now_uptime fate_tenth stand_in_fate=running
  stand_in_pid="$(start_sacrificial_session sleep "$CHECK_SESSION_LIFETIME_SECONDS")"
  [[ "$stand_in_pid" =~ ^[0-9]+$ ]] || { printf no-stand-in; return 0; }
  stand_in_starttime="$(starttime_of "$stand_in_pid")"
  if now_uptime="$(whole_uptime_seconds)"; then
    kill_check_session_group "$stand_in_pid" "$(( now_uptime - $1 ))"
  fi
  for (( fate_tenth = 0; fate_tenth < GUARDED_KILL_FATE_WAIT_TENTHS; fate_tenth++ )); do
    is_running "$stand_in_pid" || { stand_in_fate=ended; break; }
    sleep 0.1
  done
  [[ "$stand_in_fate" == running ]] && kill_sacrifice "$stand_in_pid" sleep "$stand_in_starttime"
  printf '%s' "$stand_in_fate"
}
guarded_kill_summary="started-now=$(guarded_kill_fate 0)"
guarded_kill_summary+=" inside-the-margin=$(guarded_kill_fate $(( CHECK_SESSION_LIFETIME_SECONDS - 1 )))"
guarded_kill_summary+=" lifetime-passed=$(guarded_kill_fate "$CHECK_SESSION_LIFETIME_SECONDS")"
check "a check session's process group is sent its KILL after the row's wait only within the session's lifetime less a margin (its watchdog may since have freed the group's id): a stand-in session of the row's own told it started now is ended, told it started inside the margin or a lifetime ago is left alone" \
  "$guarded_kill_summary" "started-now=ended inside-the-margin=running lifetime-passed=running"
# A row's own stand-ins end by their own lifetimes even when none of their row's endings reaches them: one of each kind
# is abandoned (a check session, a window its check opens, and below, the exit row's fake shell), ended by nothing but
# its lifetime, and the row at the table's end, once each lifetime has passed, finds each gone (the table's exit still
# ends the window and the fake shell if it stops before then; the session ends by its own bound in any case).
# The session's own command outlasts every wait of the table, so only its bound can end it in time.
# shellcheck disable=SC2016  # Expanded by the session's own bash.
start_check_session "$WIRING_TMP/abandoned-session.output" 'command sleep "$((CHECK_SESSION_LIFETIME_SECONDS * 10))"' \
  abandoned-session
abandoned_session_pid=$CHECK_SESSION_PID
abandoned_session_starttime="$(starttime_of "$abandoned_session_pid")"
printf -v abandoned_session_started_at '%(%s)T' -1
"$CHECK_SESSION_BIN/gjs" -m probe-window.js abandoned-probe </dev/null >/dev/null 2>&1 &
abandoned_window_pid=$!
printf -v abandoned_window_started_at '%(%s)T' -1
# Each of the table's stand-ins bounds its own life, for a KILL of the table
# alone, which runs no trap: a fake gnome-shell and a probe window's stand-in,
# started here with a lifetime of a second, must each be gone within a few, by
# itself; the window's stand-in registers itself as it starts. One still running
# then is ended here.
STAND_IN_BOUND_DIR="$WIRING_TMP/stand-in-bound"
STAND_IN_BOUND_LIFETIME_SECONDS=1
STAND_IN_GONE_WAIT_TENTHS=50
if ! mkdir -p "$STAND_IN_BOUND_DIR" ||
  ! mkfifo "$STAND_IN_BOUND_DIR/shell-block" "$STAND_IN_BOUND_DIR/window-block"; then
  fatal "cannot lay out $STAND_IN_BOUND_DIR"
fi
install_stub "$STAND_IN_BOUND_DIR/bin" gjs "$(check_window_stand_in_source "$STAND_IN_BOUND_DIR/launches" \
  "$STAND_IN_BOUND_DIR/env-names" "$STAND_IN_BOUND_DIR/env-values" "$STAND_IN_BOUND_DIR/window-block" \
  "$STAND_IN_BOUND_LIFETIME_SECONDS" "$STAND_IN_BOUND_DIR/registry")"
STAND_IN_BOUND_WINDOW_SCRIPT_PATH="$(readlink -f -- "$STAND_IN_BOUND_DIR/bin/gjs")" \
  || fatal "cannot resolve $STAND_IN_BOUND_DIR/bin/gjs"
# The bash every stand-in's #! line names, as /proc/<pid>/exe reads it.
STAND_IN_INTERPRETER_PATH="$(readlink -f -- /bin/bash)" || fatal "cannot resolve /bin/bash"
# is_row_stand_in <pid> <script's canonical path> succeeds while that pid is still a stand-in running that script: its
# executable is bash, and bash's script descriptor (fd 255) names the script, or the script deleted (a stopped table
# removes its directory, and the kernel then reads the descriptor as "<path> (deleted)"). Never by name.
is_row_stand_in() {
  local script_descriptor_target
  [[ "$(readlink "/proc/$1/exe" 2>/dev/null)" == "$STAND_IN_INTERPRETER_PATH" ]] || return 1
  script_descriptor_target="$(readlink "/proc/$1/fd/255" 2>/dev/null)" || return 1
  [[ "$script_descriptor_target" == "$2" || "$script_descriptor_target" == "$2 (deleted)" ]]
}
# stand_in_fate <pid> <script's canonical path> prints ended once that stand-in is gone within
# STAND_IN_GONE_WAIT_TENTHS; else ends it while it is still that stand-in (is_row_stand_in) and prints left-running, or
# prints left-running-not-ended when it cannot tell it is.
stand_in_fate() {
  local gone_tenth
  [[ "$1" =~ ^[0-9]+$ ]] || { printf no-stand-in; return 0; }
  for (( gone_tenth = 0; gone_tenth < STAND_IN_GONE_WAIT_TENTHS; gone_tenth++ )); do
    is_running "$1" || { printf ended; return 0; }
    sleep 0.1
  done
  if is_row_stand_in "$1" "$2"; then
    kill -TERM "$1" 2>/dev/null
    printf left-running
    return 0
  fi
  printf left-running-not-ended
}
"$FAKE_SHELL_DIR/gnome-shell" "$STAND_IN_BOUND_DIR/shell-block" "$STAND_IN_BOUND_LIFETIME_SECONDS" &
bound_shell_pid=$!
register_stand_in "$bound_shell_pid" "$FAKE_SHELL_DIR/gnome-shell" "$$"
"$STAND_IN_BOUND_DIR/bin/gjs" -m probe-window.js bound-probe </dev/null >/dev/null 2>&1 &
bound_window_pid=$!
register_stand_in "$bound_window_pid" "$STAND_IN_BOUND_DIR/bin/gjs" "$$"
stand_in_bound_summary="gnome-shell=$(stand_in_fate "$bound_shell_pid" "$FAKE_SHELL_SCRIPT_PATH")"
stand_in_bound_summary+=" gjs=$(stand_in_fate "$bound_window_pid" "$STAND_IN_BOUND_WINDOW_SCRIPT_PATH")"
wait "$bound_shell_pid" "$bound_window_pid" 2>/dev/null
read -r bound_registered_pid bound_registered_script _ 2>/dev/null <"$STAND_IN_BOUND_DIR/registry"
stand_in_bound_summary+=" registered-itself=$([[ "${bound_registered_pid:-}" == "$bound_window_pid" &&
  "${bound_registered_script:-}" == "$STAND_IN_BOUND_DIR/bin/gjs" ]] && printf yes || printf no)"
check "the table's stand-ins (a fake gnome-shell, a probe window's gjs) end by themselves after their lifetime, for a KILL of the table alone; the window's registers itself as it starts" \
  "$stand_in_bound_summary" "gnome-shell=ended gjs=ended registered-itself=yes"
# The table's exit ends the stand-ins it registered, on every path: an early
# fatal or exit, and a TERM, INT or HUP. Each case's own bash runs the table's
# own exit (install_table_exit_trap, end_table_stand_ins,
# restore_unsearchable_fixtures, register_stand_in, as the table library
# defines them) on a temporary directory of its own, with its registries named
# there as the library names the table's (name_table_registries), starts a fake
# gnome-shell with the table's lifetime (its fifo outside that directory, which
# the exit removes), registers it, waits until it runs as itself, as the
# table's own have for minutes when it stops, then leaves by that path (INT
# reaching it as a terminal's would: a background job ignores it). The
# stand-in must be gone at once; one still running is ended here.
# Each case's stand-in runs a copy of the fake shell's script, with a lifetime
# of its own (STAND_IN_EXIT_CASE_LIFETIME_SECONDS: far above the 5 s the row
# waits, so ended can still only be the trap's). A table stopped during this
# row removes its directory, the case's registry and script with it, and its
# child's trap then finds nothing to end: the row itself ends what it started,
# by the pid it read as soon as it was written and that process's executable
# and script, deleted or not (removed: the row removes the case's directory
# first, as such a stop would). One no ending reaches (a KILL of the table
# and the row together) is gone within that lifetime (abandoned: judged at
# the table's end).
STAND_IN_EXIT_CASE_LIFETIME_SECONDS=30
STAND_IN_EXIT_DEFINITIONS="$(declare -f fatal register_stand_in end_table_stand_ins restore_unsearchable_fixtures \
  install_table_exit_trap name_table_registries)"
# stand_in_exit_case <fatal, exit, TERM, INT, HUP, removed or abandoned> prints what became of that case's stand-in
# (abandoned: nothing; it is recorded in ABANDONED_EXIT_CASE_RECORD for the row at the table's end).
ABANDONED_EXIT_CASE_RECORD="$WIRING_TMP/abandoned-exit-case"
stand_in_exit_case() {
  local exit_path="$1" case_dir="$WIRING_TMP/stand-in-exit-$1" case_child_pid case_stand_in_pid="" gone_tenth
  local case_script_path child_exit_path="$1" abandoned_started_at case_stand_in_registry
  if ! mkdir -p "$case_dir/tmp" || ! mkfifo "$case_dir/block" "$case_dir/tmp/hold" ||
    ! cp -- "$FAKE_SHELL_DIR/gnome-shell" "$case_dir/gnome-shell" ||
    ! case_script_path="$(readlink -f -- "$case_dir/gnome-shell")"; then
    fatal "cannot lay out $case_dir"
  fi
  # The child's stand-in registry, named as the library names it, in a subshell: the table's own names stay its own.
  case_stand_in_registry="$(WIRING_TMP="$case_dir/tmp" name_table_registries && printf '%s' "$TABLE_STAND_IN_REGISTRY")"
  # removed and abandoned leave as TERM does, once the row took the child's registry away.
  [[ "$exit_path" == removed || "$exit_path" == abandoned ]] && child_exit_path=TERM
  # shellcheck disable=SC2016  # Expanded by the child bash.
  env --default-signal=INT CASE_STAND_IN_LIFETIME_SECONDS="$STAND_IN_EXIT_CASE_LIFETIME_SECONDS" bash -c '
    eval "$1"
    WIRING_TMP="$2"
    name_table_registries
    install_table_exit_trap
    "$3" "$6" "$CASE_STAND_IN_LIFETIME_SECONDS" &
    register_stand_in "$!" "$3" "$$"
    for (( started_tenth = 0; started_tenth < 50; started_tenth++ )); do
      [[ "$(readlink "/proc/$!/fd/255")" == "$(readlink -f -- "$3")" ]] && break
      sleep 0.1
    done
    printf "%s\n" "$!" >"$4"
    case "$5" in
      fatal) fatal "an early exit, injected" ;;
      exit) exit 2 ;;
      *) read -r -t 30 _ <>"$WIRING_TMP/hold" ;;
    esac
  ' stand-in-exit "$STAND_IN_EXIT_DEFINITIONS" "$case_dir/tmp" "$case_dir/gnome-shell" "$case_dir/stand-in.pid" \
    "$child_exit_path" "$case_dir/block" </dev/null >/dev/null 2>&1 &
  case_child_pid=$!
  # Read as soon as it is written: a stopped table removes the file.
  for (( gone_tenth = 0; gone_tenth < STAND_IN_GONE_WAIT_TENTHS; gone_tenth++ )); do
    read -r case_stand_in_pid 2>/dev/null <"$case_dir/stand-in.pid" && [[ "$case_stand_in_pid" =~ ^[0-9]+$ ]] && break
    sleep 0.1
  done
  case "$exit_path" in
    removed) rm -rf -- "$case_dir" ;;
    abandoned) rm -f -- "$case_stand_in_registry" ;;
  esac
  case "$child_exit_path" in
    TERM | INT | HUP) kill "-$child_exit_path" "$case_child_pid" 2>/dev/null ;;
  esac
  wait "$case_child_pid" 2>/dev/null
  if [[ "$exit_path" == abandoned ]]; then
    printf -v abandoned_started_at '%(%s)T' -1
    printf '%s %s %s\n' "$case_stand_in_pid" "$case_script_path" "$abandoned_started_at" >"$ABANDONED_EXIT_CASE_RECORD"
    # Its script stays, so the table's own exit still ends it if the table stops before the row at its end.
    register_stand_in "$case_stand_in_pid" "$case_dir/gnome-shell"
    return 0
  fi
  stand_in_fate "$case_stand_in_pid" "$case_script_path"
}
stand_in_exit_summary=""
for stand_in_exit_path in fatal exit TERM INT HUP removed; do
  stand_in_exit_summary+="$stand_in_exit_path=$(stand_in_exit_case "$stand_in_exit_path") "
done
check "the table's exit ends every stand-in it registered and still runs, whether it stops at a fatal, an exit, a TERM, an INT or a HUP; one whose registry and script a stopped table removed under the row, the row ends itself" \
  "$stand_in_exit_summary" "fatal=ended exit=ended TERM=ended INT=ended HUP=ended removed=left-running "
stand_in_exit_case abandoned

# end_check_perf signals CHECK_PERF_PID only while it is the check's own child
# (is_own_child_process, as end_perf_window and end_perf_cost_job do): between
# the check's wait reaping perf and the variable's clearing, the pid can be
# another's. Its own child (a sleep the check's shell started) is ended and
# waited for; a pid that is no child of it (a sacrificial sleep of this row,
# leading a session of its own) is left running. The variable is cleared in
# both.
check_perf_sacrifice_pid="$(start_sacrificial_session sleep 60)"
check_perf_sacrifice_starttime="$(starttime_of "$check_perf_sacrifice_pid")"
# shellcheck disable=SC2016  # Expanded by the child bash.
end_check_perf_summary="$(bash -c '
  source "$1" || exit 99
  command sleep 60 &
  own_child_pid=$!
  CHECK_PERF_PID=$own_child_pid
  end_check_perf
  own_fate=running
  [[ -e "/proc/$own_child_pid" ]] || own_fate=ended
  printf "own-child=%s/%s" "$own_fate" "${CHECK_PERF_PID:-cleared}"
  CHECK_PERF_PID=$2
  end_check_perf
  printf " not-a-child-forgotten=%s" "${CHECK_PERF_PID:-cleared}"
' end-check-perf "$NESTED_SCRIPT" "$check_perf_sacrifice_pid" 2>/dev/null)"
# A TERM let through to the sacrifice ends it within a moment (its parent, not this row, reaps it).
END_CHECK_PERF_FATE_WAIT_TENTHS=20
for (( check_perf_fate_tenth = 0; check_perf_fate_tenth < END_CHECK_PERF_FATE_WAIT_TENTHS; check_perf_fate_tenth++ )); do
  is_running "$check_perf_sacrifice_pid" || break
  sleep 0.1
done
end_check_perf_summary+=" not-a-child=$(is_running "$check_perf_sacrifice_pid" && printf running || printf ended)"
kill_sacrifice "$check_perf_sacrifice_pid" sleep "$check_perf_sacrifice_starttime"
check "nested: check cockpit's exit signals its perf pass only while it is the check's own child: its own is ended and waited for, a pid that is no child of the check is left alone, and the pid is forgotten in both" \
  "$end_check_perf_summary" "own-child=ended/cleared not-a-child-forgotten=cleared not-a-child=running"

# A TERM sent to check cockpit while its perf pass runs is taken at once: the
# check ends that pass (perf puts the run back on its own TERM) and waits for
# it, rather than for the pass's nine minutes. A stand-in perf marks that it
# runs and waits 30 s; a TERM stops it, and it takes a second to put the run
# back before it records so. The check, a session of its own, gets its TERM
# once the stand-in runs, and must end with 143 well inside those 30 s, after
# the stand-in recorded its put-back, with the run's fixture put back.
CHECK_TERM_PERF_STAND_IN="$WIRING_TMP/check-term-perf"
CHECK_TERM_PERF_STARTED="$WIRING_TMP/check-term-perf-started"
CHECK_TERM_OUTPUT="$WIRING_TMP/check-term-output"
# How long the stubbed check may take to reach its perf pass, and to end once sent TERM, in tenths of a second.
CHECK_TERM_START_LIMIT_TENTHS=300
CHECK_TERM_END_LIMIT_TENTHS=100
CHECK_PERF_STAND_IN_WAIT_SECONDS=30
cat >"$CHECK_TERM_PERF_STAND_IN" <<STAND_IN
#!/bin/bash
# Stands in for check cockpit's perf pass: marks that it runs, then waits; a TERM stops it, and it puts the run back.
trap 'kill "\$wait_pid" 2>/dev/null; sleep 1; printf "perf put the run back after its TERM\n" >>"\$CHECK_STUB_CALLS"; exit 143' TERM
: >"$CHECK_TERM_PERF_STARTED"
sleep $CHECK_PERF_STAND_IN_WAIT_SECONDS &
wait_pid=\$!
wait "\$wait_pid"
STAND_IN
chmod +x "$CHECK_TERM_PERF_STAND_IN" || fatal "cannot make $CHECK_TERM_PERF_STAND_IN executable"
make_check_run yes gc-log=1 replay=1
: >"$CHECK_CALLS"
rm -f "$CHECK_TERM_PERF_STARTED"
CHECK_SESSION_EXTRA_ENV=(CHECK_TERM_PERF_STAND_IN="$CHECK_TERM_PERF_STAND_IN")
# shellcheck disable=SC2016  # Expanded by the session's bash.
start_check_session "$CHECK_TERM_OUTPUT" '
    source "$1" || exit 99
    sleep() { :; }
    run_perf_for_check_cockpit() { exec "$CHECK_TERM_PERF_STAND_IN"; }
    check_cockpit_subcommand
  ' check-term "$NESTED_SCRIPT"
check_term_pid=$CHECK_SESSION_PID
check_term_started_uptime=$CHECK_SESSION_STARTED_UPTIME
for (( check_term_tenth = 0; check_term_tenth < CHECK_TERM_START_LIMIT_TENTHS; check_term_tenth++ )); do
  [[ -e "$CHECK_TERM_PERF_STARTED" ]] && break
  sleep 0.1
done
check_term_summary="perf-ran=$([[ -e "$CHECK_TERM_PERF_STARTED" ]] && printf yes || printf no)"
kill -TERM "$check_term_pid" 2>/dev/null
for (( check_term_tenth = 0; check_term_tenth < CHECK_TERM_END_LIMIT_TENTHS; check_term_tenth++ )); do
  is_running "$check_term_pid" || break
  sleep 0.1
done
check_term_group_killed=""
if is_running "$check_term_pid"; then
  check_term_summary+=" ended=no"
  kill -KILL -- "-$check_term_pid" 2>/dev/null
  check_term_group_killed=yes
  wait "$check_term_pid" 2>/dev/null
else
  wait "$check_term_pid"
  check_term_summary+=" ended=$?"
fi
check_term_summary+=" perf-put-back=$(grep -c -x -F 'perf put the run back after its TERM' "$CHECK_CALLS")"
check_term_summary+=" fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
  && printf restored || printf changed)"
[[ -n "$check_term_group_killed" ]] || kill_check_session_group "$check_term_pid" "$check_term_started_uptime"
nested_call end_recorded_windows "$CHECK_RUN" >/dev/null 2>&1
check "nested: a TERM to check cockpit during its perf pass is taken at once: perf is sent TERM and waited for while it puts the run back, the run's fixture put back, exit 143" \
  "$check_term_summary" "perf-ran=yes ended=143 perf-put-back=1 fixture=restored"

# A TERM can reach check cockpit and its perf pass at once (a TERM to the
# check's process group: a timeout, a tool stopping a background task), and the
# check's exit then sends perf a second one milliseconds later; or the check
# can get two TERMs in quick succession. No second TERM may cut a put-back
# short: perf's (its window ended, the extension enabled, the top bar shown) or
# the check's (perf waited for, its windows ended, the run's fixture put back).
# The perf here is a stand-in with perf's own exit handling (the script's
# install_perf_exit_traps and end_perf_run), whose three put-back steps each
# take a third of a second and record themselves; it waits in the wait builtin,
# which a TERM interrupts at once (perf's own waits are foreground commands,
# which take a TERM sent to perf alone only once they end: up to a minute). The
# check runs in a session of its own, which the row ends whole at its end.
CHECK_PUT_BACK_PERF_STAND_IN="$WIRING_TMP/check-put-back-perf"
CHECK_PUT_BACK_PERF_STARTED="$WIRING_TMP/check-put-back-perf-started"
CHECK_PUT_BACK_OUTPUT="$WIRING_TMP/check-put-back-output"
PERF_PUT_BACK_STEP_SECONDS=0.33
# The second of two TERMs in quick succession: well inside perf's put-back, which takes about a second.
CHECK_SECOND_TERM_DELAY_SECONDS=0.2
# With a TERM to the group, the check's own TERM reaches perf within a millisecond, often together with perf's own (two
# pending TERMs are taken as one). Here the check's exit waits this long before it sends perf its TERM, so that the
# TERM lands once perf's own has begun its put-back, as it can on a loaded machine.
CHECK_TERM_TO_PERF_DELAY_SECONDS=0.1
cat >"$CHECK_PUT_BACK_PERF_STAND_IN" <<STAND_IN
#!/bin/bash
# Stands in for check cockpit's perf pass with perf's own exit handling; each put-back step records itself.
source "$NESTED_SCRIPT" || exit 99
record_put_back_step() {
  sleep $PERF_PUT_BACK_STEP_SECONDS
  printf 'perf put back: %s\n' "\$1" >>"\$CHECK_STUB_CALLS"
}
end_perf_window() { record_put_back_step window; }
end_perf_cost_job() { record_put_back_step cost-job; }
restore_perf_extension() { record_put_back_step extension; }
install_perf_exit_traps
: >"$CHECK_PUT_BACK_PERF_STARTED"
sleep $CHECK_PERF_STAND_IN_WAIT_SECONDS &
wait "\$!"
STAND_IN
chmod +x "$CHECK_PUT_BACK_PERF_STAND_IN" || fatal "cannot make $CHECK_PUT_BACK_PERF_STAND_IN executable"
# The lines check cockpit and perf print to stderr as a signal stops them, saying what they wait for.
CHECK_STOPPING_FOR_PERF_NEEDLE='check cockpit is stopping: waiting for perf to put the run back'
PERF_STOPPING_NEEDLE='perf is stopping: putting the run back first'
# check_put_back_run <group or twice> starts check cockpit on a fresh run with the stand-in as its perf pass, sends,
# once the stand-in runs, one TERM to the check's process group (group, the check's own TERM to perf then sent
# CHECK_TERM_TO_PERF_DELAY_SECONDS late) or two to the check alone in quick succession (twice), waits for the check to
# end, and prints ended=<status> put-back-at-exit=[<the steps perf had recorded when the check ended>]
# fixture=<restored or changed> windows-launched=<by the session's window stand-in, bounded as the session is>/<by the
# table's> said=<the check's stop lines>/<perf's>. Whatever is left of the row's session then ends with it.
check_put_back_run() {
  local term_plan="$1" check_pid check_started_uptime put_back_tenth put_back_summary perf_term_delay_seconds=""
  local check_group_killed=""
  [[ "$term_plan" == group ]] && perf_term_delay_seconds="$CHECK_TERM_TO_PERF_DELAY_SECONDS"
  make_check_run yes gc-log=1 replay=1
  : >"$CHECK_CALLS"
  : >"$CHECK_SESSION_WINDOW_RECORDS.launches"
  : >"$CHECK_WINDOW_LAUNCHES"
  rm -f "$CHECK_PUT_BACK_PERF_STARTED"
  CHECK_SESSION_EXTRA_ENV=(CHECK_PUT_BACK_PERF_STAND_IN="$CHECK_PUT_BACK_PERF_STAND_IN"
    PERF_TERM_DELAY_SECONDS="$perf_term_delay_seconds")
  # shellcheck disable=SC2016  # Expanded by the session's bash.
  start_check_session "$CHECK_PUT_BACK_OUTPUT" '
      source "$1" || exit 99
      sleep() { :; }
      run_perf_for_check_cockpit() { exec "$CHECK_PUT_BACK_PERF_STAND_IN"; }
      if [[ -n "$PERF_TERM_DELAY_SECONDS" ]]; then
        eval "script_$(declare -f end_check_perf)"
        end_check_perf() { command sleep "$PERF_TERM_DELAY_SECONDS"; script_end_check_perf; }
      fi
      check_cockpit_subcommand
    ' check-put-back "$NESTED_SCRIPT"
  check_pid=$CHECK_SESSION_PID
  check_started_uptime=$CHECK_SESSION_STARTED_UPTIME
  for (( put_back_tenth = 0; put_back_tenth < CHECK_TERM_START_LIMIT_TENTHS; put_back_tenth++ )); do
    [[ -e "$CHECK_PUT_BACK_PERF_STARTED" ]] && break
    sleep 0.1
  done
  case "$term_plan" in
    group) kill -TERM -- "-$check_pid" 2>/dev/null ;;
    twice)
      kill -TERM "$check_pid" 2>/dev/null
      sleep "$CHECK_SECOND_TERM_DELAY_SECONDS"
      kill -TERM "$check_pid" 2>/dev/null ;;
  esac
  for (( put_back_tenth = 0; put_back_tenth < CHECK_TERM_END_LIMIT_TENTHS; put_back_tenth++ )); do
    is_running "$check_pid" || break
    sleep 0.1
  done
  if is_running "$check_pid"; then
    put_back_summary="ended=no"
    kill -KILL -- "-$check_pid" 2>/dev/null
    check_group_killed=yes
    wait "$check_pid" 2>/dev/null
  else
    wait "$check_pid"
    put_back_summary="ended=$?"
  fi
  put_back_summary+=" put-back-at-exit=[$(sed -n 's/^perf put back: //p' "$CHECK_CALLS" | tr '\n' ' ')]"
  put_back_summary+=" fixture=$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
    && printf restored || printf changed)"
  put_back_summary+=" windows-launched=$(wc -l <"$CHECK_SESSION_WINDOW_RECORDS.launches")"
  put_back_summary+="/$(wc -l <"$CHECK_WINDOW_LAUNCHES")"
  put_back_summary+=" said=$(grep -c -F "$CHECK_STOPPING_FOR_PERF_NEEDLE" "$CHECK_PUT_BACK_OUTPUT")"
  put_back_summary+="/$(grep -c -F "$PERF_STOPPING_NEEDLE" "$CHECK_PUT_BACK_OUTPUT")"
  [[ -n "$check_group_killed" ]] || kill_check_session_group "$check_pid" "$check_started_uptime"
  nested_call end_recorded_windows "$CHECK_RUN" >/dev/null 2>&1
  printf '%s' "$put_back_summary"
}
check "nested: a TERM to check cockpit's process group during its perf pass reaches perf too, and the check's own TERM to perf, landing once perf's put-back has begun, cuts no step of it: the check waits for every step, puts the run's fixture back and exits 143; each says once on stderr what it waits for; the session's windows are bounded as it is" \
  "$(check_put_back_run group)" \
  "ended=143 put-back-at-exit=[window cost-job extension ] fixture=restored windows-launched=2/0 said=1/1"
check "nested: a second TERM to check cockpit in quick succession cuts its exit short nowhere: it still waits for every step of perf's put-back, then puts the run's fixture back, and exits 143; each says once on stderr what it waits for; the session's windows are bounded as it is" \
  "$(check_put_back_run twice)" \
  "ended=143 put-back-at-exit=[window cost-job extension ] fixture=restored windows-launched=2/0 said=1/1"

# A TERM can also land where no row above can time it: after a first TERM
# began an exit, before the exit handler's own first statement (the gap); or
# during the put-back of a perf or a check that ended by itself (a timeout
# firing just then). Each is sent here by the process to itself, at that point:
# perf's handlers are the script's (its put-back steps recording themselves at
# once), the check's run stubbed as above. Each must still run its put-back to
# the end: perf every step; the check its fixture put back and its last step,
# the dropdown closed, with the exit status it had.
# perf_put_back_with_term <gap or own-exit> prints the steps perf's put-back recorded.
perf_put_back_with_term() {
  local put_back_record="$WIRING_TMP/perf-put-back-$1"
  : >"$put_back_record"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  PERF_PUT_BACK_RECORD="$put_back_record" bash -c '
    source "$1" || exit 99
    record_put_back_step() { printf "%s " "$1" >>"$PERF_PUT_BACK_RECORD"; }
    end_perf_window() { record_put_back_step window; }
    end_perf_cost_job() { record_put_back_step cost-job; }
    restore_perf_extension() { record_put_back_step extension; }
    case "$2" in
      gap)
        eval "script_$(declare -f end_perf_run)"
        end_perf_run() { kill -TERM "$$"; script_end_perf_run; }
        install_perf_exit_traps
        kill -TERM "$$" ;;
      own-exit)
        end_perf_window() { record_put_back_step window; kill -TERM "$$"; }
        install_perf_exit_traps
        exit 0 ;;
    esac
    exit 99
  ' perf-put-back "$NESTED_SCRIPT" "$1" >/dev/null 2>&1
  printf '[%s]' "$(<"$put_back_record")"
}
# check_put_back_with_term <gap or own-exit> prints exit/fixture/the check's last in-shell request.
check_put_back_with_term() {
  local term_overrides
  # shellcheck disable=SC2016  # Evaluated by the check's bash.
  case "$1" in
    gap) term_overrides='run_perf_for_check_cockpit() { kill -TERM "$$"; }
      eval "script_$(declare -f end_check_cockpit)"
      end_check_cockpit() { kill -TERM "$$"; script_end_check_cockpit; }' ;;
    own-exit) term_overrides='eval "script_$(declare -f end_check_perf)"
      end_check_perf() { kill -TERM "$$"; script_end_check_perf; }' ;;
  esac
  CHECK_STUB_OVERRIDES="$term_overrides" check_cockpit_stubbed "$CHECK_ANSWERS"
  printf '%s/%s/%s' "$CHECK_STUB_EXIT" "$(cmp -s "$CHECK_RUN_FIXTURE" "$CHECK_RUN/state/cockpit-fixture.start.json" \
    && printf restored || printf changed)" "$(tail -n 1 "$CHECK_CALLS" | tr ' ' ':')"
  nested_call end_recorded_windows "$CHECK_RUN" >/dev/null 2>&1
}
put_back_term_summary="perf-gap=$(perf_put_back_with_term gap)"
put_back_term_summary+=" perf-own-exit=$(perf_put_back_with_term own-exit)"
put_back_term_summary+=" check-gap=$(check_put_back_with_term gap)"
put_back_term_summary+=" check-own-exit=$(check_put_back_with_term own-exit)"
check "nested: a TERM landing after a first TERM began an exit, before the exit handler's first statement, or during the put-back of a perf or a check that ended by itself, cuts neither perf's put-back nor check cockpit's exit short" \
  "$put_back_term_summary" \
  "perf-gap=[window cost-job extension ] perf-own-exit=[window cost-job extension ] check-gap=143/restored/resourcePulseCockpitCheck:dropdown-close check-own-exit=0/restored/resourcePulseCockpitCheck:dropdown-close"

nested_call end_recorded_windows "$CHECK_RUN" >/dev/null 2>&1
kill "$check_fake_shell_pid" 2>/dev/null
wait "$check_fake_shell_pid" 2>/dev/null
rm -rf "$CHECK_RUN"

# The stand-ins abandoned above (a check session, a window its check opens, an
# exit case's fake shell) end by their own lifetimes: once the longest has
# passed, with a margin (the rows between take under a minute, so this waits
# out the rest), none still runs as itself. One that does is ended here.
STAND_IN_LIFETIME_MARGIN_SECONDS=5
read -r abandoned_exit_case_pid abandoned_exit_case_script abandoned_exit_case_started_at 2>/dev/null \
  <"$ABANDONED_EXIT_CASE_RECORD"
abandoned_exit_case_started_at="${abandoned_exit_case_started_at:-0}"
abandoned_wait_until=$((abandoned_exit_case_started_at + STAND_IN_EXIT_CASE_LIFETIME_SECONDS))
for abandoned_ends_at in $((abandoned_session_started_at + CHECK_SESSION_LIFETIME_SECONDS)) \
  $((abandoned_window_started_at + CHECK_SESSION_LIFETIME_SECONDS)); do
  (( abandoned_ends_at > abandoned_wait_until )) && abandoned_wait_until=$abandoned_ends_at
done
abandoned_wait_until=$((abandoned_wait_until + STAND_IN_LIFETIME_MARGIN_SECONDS))
while printf -v abandoned_now '%(%s)T' -1 && (( abandoned_now < abandoned_wait_until )); do
  sleep 1
done
# abandoned_stand_in_fate <pid> <script's canonical path> prints ended, or ends a stand-in still running and prints
# still-running.
abandoned_stand_in_fate() {
  [[ "$1" =~ ^[0-9]+$ ]] || { printf no-stand-in; return 0; }
  is_row_stand_in "$1" "$2" || { printf ended; return 0; }
  kill -TERM "$1" 2>/dev/null
  printf still-running
}
abandoned_summary="exit-case=$(abandoned_stand_in_fate "${abandoned_exit_case_pid:-}" "${abandoned_exit_case_script:-}")"
abandoned_summary+=" session-window=$(abandoned_stand_in_fate "$abandoned_window_pid" "$CHECK_SESSION_WINDOW_SCRIPT_PATH")"
if [[ -n "$abandoned_session_starttime" && "$(starttime_of "$abandoned_session_pid")" == "$abandoned_session_starttime" ]] &&
  is_running "$abandoned_session_pid"; then
  abandoned_summary+=" session=still-running"
  kill -KILL -- "-$abandoned_session_pid" 2>/dev/null
else
  abandoned_summary+=" session=ended"
fi
check "a row's own stand-ins none of its endings reached end by their own lifetimes: an exit case's fake shell ($STAND_IN_EXIT_CASE_LIFETIME_SECONDS s), a check session and a window its check opens ($CHECK_SESSION_LIFETIME_SECONDS s)" \
  "$abandoned_summary" "exit-case=ended session-window=ended session=ended"

# This table's own total. The guide states it.
EXPECTED_ROWS=9

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
