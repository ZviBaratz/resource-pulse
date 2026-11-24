#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2034  # Its constants are read by the tables that source it, never here.
#
# scripts/resource-pulse-nested-table-lib.sh
# ==========================================
#
# The fixtures of the nested-shell harness's state tables (scripts/test-resource-pulse-nested*.sh): the harness script
# run against recording stubs and an empty base directory, the run directories its rows lay out, the sacrificial
# sessions only its rows signal, a pid that is never running, the fake gnome-shell that makes a run look live, this
# shell's session id, and the harness's own constants read back from it.
#
# Sourced, never run, after scripts/resource-pulse-table-lib.sh and its start_table: it reads that library's names
# (WIRING_TMP, the barrier, install_stub, register_stand_in, fatal). Sourcing it only defines names and creates nothing.
# Each table then calls start_nested_harness, once, right after sourcing it: it lays out the base directory and the
# stubs, the sacrificial sessions' directory and the fake gnome-shell's script, and reads this shell's session id. A
# table that needs a fake gnome-shell running starts one with start_long_lived_fake_shell.
#
# Usage, in a table, after start_table:
#   NESTED_TABLE_LIB="$HERE/resource-pulse-nested-table-lib.sh"
#   # shellcheck source=SCRIPTDIR/resource-pulse-nested-table-lib.sh
#   source "$NESTED_TABLE_LIB" || fatal "cannot source $NESTED_TABLE_LIB"
#   start_nested_harness

if [[ "$(type -t start_table)" != function ]]; then
  printf '\033[1;31mFATAL\033[0m: source scripts/resource-pulse-table-lib.sh before %s\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

# The nested-shell harness itself needs gnome-shell and a GPU, so it never runs
# here. The nested tables cover what it decides before anything starts: its
# usage, the bus configs it renders, the environment allowlist, and its
# refusals. Every run of it here has busctl, gsettings and gnome-shell replaced
# by stubs that only record the call (jq too: no run of the script here needs
# it to really run; the rows that do, on perf's probe answers, call the
# functions themselves with the real jq), and RESOURCE_PULSE_NESTED_BASE pointed
# at an empty directory, so a row that must refuse proves it reached none of
# them.
#
# That directory's name is deliberately longer than the script allows a run
# directory to be (48 characters, for its sockets). `start` launches through
# `env -i` with its own PATH, where these stubs do not reach, so a mutant that
# fell through to `start` could otherwise launch a real nested shell from a
# table; with this base it refuses at the length check before launching.
NESTED_SCRIPT="$REPO_ROOT/scripts/resource-pulse-nested.sh"
NESTED_FILES="$REPO_ROOT/gnome-shell/tests/nested"
UNSAFE_MODE_HELPER_UUID="resource-pulse-nested-unsafe-mode@local"
# A pid above the kernel's largest (2^22) is never running.
NEVER_RUNNING_PID=4194305
# The run directory nested_run names to the script; empty, it names none and the script looks for one. A row names one
# for its own call only: NESTED_RUN_DIR=<dir> nested_run ...
NESTED_RUN_DIR=""

nested_stub_call_count() { printf '%d' "$(wc -l <"$NESTED_STUB_CALLS")"; }
# nested_run <args...> runs the script against the stubs and the empty base;
# leaves NESTED_OUTPUT and NESTED_EXIT. With NESTED_RUN_DIR set it names that
# run directory (RESOURCE_PULSE_NESTED_DIR); otherwise the script looks for one.
nested_run() {
  : >"$NESTED_STUB_CALLS"
  NESTED_OUTPUT="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" \
    ${NESTED_RUN_DIR:+RESOURCE_PULSE_NESTED_DIR="$NESTED_RUN_DIR"} \
    PATH="$NESTED_STUB_BIN:$PATH" NESTED_STUB_CALLS="$NESTED_STUB_CALLS" RESOURCE_PULSE_NESTED_BASE="$NESTED_BASE" \
    bash "$NESTED_SCRIPT" "$@" 2>&1)"
  NESTED_EXIT=$?
}
# make_run_dir <dir> writes a run directory's marker (from its name) and,
# with more arguments, its run.values lines (name=value).
make_run_dir() {
  local run_dir="$1"
  shift
  mkdir -p "$run_dir/state" && chmod 700 "$run_dir"
  printf '%s\n' "${run_dir##*/rpn.}" >"$run_dir/.resource-pulse-nested"
  if (( $# > 0 )); then printf '%s\n' "$@" >"$run_dir/state/run.values"; fi
}
# is_running <pid> succeeds while the process exists and is not a zombie.
is_running() {
  local stat_line
  read -r stat_line 2>/dev/null <"/proc/$1/stat" || return 1
  [[ "${stat_line##*) }" != Z* ]]
}
# starttime_of <pid> prints a process's start time (stat field 22), parsed here
# independently of the script (whose own parser a row pins against this one).
starttime_of() {
  local stat_line
  local -a stat_fields
  read -r stat_line 2>/dev/null <"/proc/$1/stat" || return 0
  read -r -a stat_fields <<<"${stat_line##*) }"
  printf '%s' "${stat_fields[19]:-}"
}
# kill_sacrifice <pid> <comm> <start time> sends SIGTERM only while that pid is
# still the same sacrificial process: same comm, same start time.
kill_sacrifice() {
  local current_comm=""
  read -r current_comm 2>/dev/null <"/proc/$1/comm" || return 0
  [[ "$current_comm" == "$2" && "$(starttime_of "$1")" == "$3" && -n "$3" ]] || return 0
  kill "$1" 2>/dev/null
}
# start_sacrificial_session <command...> starts the command as the leader of a
# new session (setsid, then exec), waits until it runs, and prints its pid,
# which is also the session id. Only rows that must never touch a real session
# signal these.
start_sacrificial_session() {
  local pid_file
  pid_file="$(mktemp "$SACRIFICE_DIR/leader.XXXXXX")"
  # shellcheck disable=SC2016  # Expanded by the new session's own bash.
  setsid bash -c 'printf "%s\n" "$$" >"$1"; shift; exec "$@"' sacrifice "$pid_file" "$@" </dev/null >/dev/null 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -s "$pid_file" ]] && break
    sleep 0.1
  done
  cat "$pid_file"
}
# nested_call <function> <args...> sources the script (which then runs nothing)
# and calls one of its functions. A missing script exits 99, never 0.
nested_call() {
  bash -c 'source "$1" || exit 99; shift; "$@"' nested-call "$NESTED_SCRIPT" "$@"
}
# nested_constant_text <name>: one of the script's readonly values, read by sourcing it; empty when it has none.
nested_constant_text() {
  # shellcheck disable=SC2016  # Expanded by the child bash.
  bash -c 'source "$1" || exit 99; printf "%s" "${!2:-}"' nested-constant "$NESTED_SCRIPT" "$1"
}
# nested_constant <name>: one of the script's readonly numbers; exits 2 unless it is one.
nested_constant() {
  local constant_value
  constant_value="$(nested_constant_text "$1")"
  [[ "$constant_value" =~ ^[0-9]+$ ]] || fatal "cannot read $1 from $NESTED_SCRIPT"
  printf '%s' "$constant_value"
}

# start_long_lived_fake_shell starts a fake gnome-shell in this session that lives the table's stand-in lifetime
# (STAND_IN_LIFETIME_SECONDS) unless signalled, registers it as one of the table's stand-ins (this shell its parent, so
# the table's exit ends it), waits until it runs as gnome-shell, and leaves its pid in LONG_LIVED_FAKE_SHELL_PID. A run
# whose recorded gnome-shell is it looks live. One that is not running after the wait stops the table with exit 2: with
# no live run, a row that expects "no live run" would pass for the wrong reason. One still running under another name
# is left to the rows: under load its rename can outlast the wait, and they then still judge it for the right reason.
start_long_lived_fake_shell() {
  "$FAKE_SHELL_DIR/gnome-shell" "$FAKE_SHELL_DIR/block" "$STAND_IN_LIFETIME_SECONDS" &
  LONG_LIVED_FAKE_SHELL_PID=$!
  register_stand_in "$LONG_LIVED_FAKE_SHELL_PID" "$FAKE_SHELL_DIR/gnome-shell" "$$"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ "$(cat "/proc/$LONG_LIVED_FAKE_SHELL_PID/comm" 2>/dev/null)" == gnome-shell ]] && break
    sleep 0.2
  done
  is_running "$LONG_LIVED_FAKE_SHELL_PID" || fatal "the fake gnome-shell did not start"
}

# start_nested_harness: what a nested table runs once, right after sourcing this file (and after start_table). In
# order, it
#   1. names the base directory, the stubs' directory and their call log in WIRING_TMP, makes the base private to the
#      user, and installs the recording stubs (busctl, gsettings, gnome-shell, jq);
#   2. makes SACRIFICE_DIR, where start_sacrificial_session records its leaders and rows keep their sessions' scripts;
#   3. lays out the fake gnome-shell: FAKE_SHELL_DIR, its fifo (block, which only a signal ends a wait on) and its
#      script, whose process the kernel names gnome-shell, and FAKE_SHELL_SCRIPT_PATH, that script's canonical path;
#   4. reads this shell's session id into test_session_id, through the script's own reader.
# A second call, or a call before start_table, stops the table with exit 2.
start_nested_harness() {
  [[ -n "${WIRING_TMP:-}" ]] || fatal "start_table runs before start_nested_harness"
  [[ -z "${NESTED_BASE:-}" ]] || fatal "start_nested_harness runs once per table, and NESTED_BASE is already set"
  NESTED_BASE="$WIRING_TMP/nested-base-named-longer-than-any-run-directory-may-be"
  NESTED_STUB_BIN="$WIRING_TMP/nested-bin"
  NESTED_STUB_CALLS="$WIRING_TMP/nested-stub-calls"
  mkdir -p "$NESTED_BASE" "$NESTED_STUB_BIN" || fatal "cannot create the nested-harness fixture directories"
  # A base directory must be private to the user, as `start` requires of one.
  chmod 700 "$NESTED_BASE" || fatal "cannot make the nested-harness base private"
  local stubbed_tool
  for stubbed_tool in busctl gsettings gnome-shell jq; do
    # shellcheck disable=SC2016  # The stub's own source: its $* and $NESTED_STUB_CALLS expand when it runs.
    install_stub "$NESTED_STUB_BIN" "$stubbed_tool" "$(printf '#!/usr/bin/env bash\nprintf "%%s %%s\\n" %s "$*" >>"$NESTED_STUB_CALLS"\nexit 1' "$stubbed_tool")"
  done
  SACRIFICE_DIR="$WIRING_TMP/sacrifices"
  mkdir -p "$SACRIFICE_DIR" || fatal "cannot create $SACRIFICE_DIR"
  # A process whose comm is gnome-shell: the kernel names a #! script's process after the script file.
  FAKE_SHELL_DIR="$WIRING_TMP/fake-shell"
  if ! mkdir -p "$FAKE_SHELL_DIR" || ! mkfifo "$FAKE_SHELL_DIR/block"; then
    fatal "cannot lay out the fake gnome-shell's directory, $FAKE_SHELL_DIR"
  fi
  # shellcheck disable=SC2016  # The fake shell's own source: its $1 and $2 expand when it runs.
  printf '#!/bin/bash\n# Stands in for a running gnome-shell; blocks until signalled, for $2 seconds at most.\n%s\n' \
    'read -r -t "$2" _ <>"$1"' >"$FAKE_SHELL_DIR/gnome-shell" || fatal "cannot write the fake gnome-shell"
  chmod +x "$FAKE_SHELL_DIR/gnome-shell" || fatal "cannot make the fake gnome-shell executable"
  # The script's path as a stand-in's script descriptor names it (stand_in_fate), resolved while it exists.
  FAKE_SHELL_SCRIPT_PATH="$(readlink -f -- "$FAKE_SHELL_DIR/gnome-shell")" || fatal "cannot resolve the fake gnome-shell"
  test_session_id="$(nested_call session_id_of_process /proc "$$")"
  [[ "$test_session_id" =~ ^[1-9][0-9]*$ ]] || fatal "cannot read this shell's session id through $NESTED_SCRIPT"
}
