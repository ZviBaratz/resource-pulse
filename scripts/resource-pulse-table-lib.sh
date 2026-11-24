#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2034  # Its constants are read by the tables that source it, never here.
#
# scripts/resource-pulse-table-lib.sh
# ===================================
#
# The shared helpers and constants of Resource Pulse's gjs-side state tables (scripts/test-resource-pulse*.sh, not the
# sampler's): the row helpers, the table's temporary directory and the exit trap that cleans it up, the fold of a gjs
# runner's JS-TALLY line, the barrier between a row and the live session, the stub installer, systemd's timestamp form,
# and the product's names. A stub only one table's rows use is that table's own. Each table's own total is stated in
# the guide.
#
# Sourced, never run. It owns no row, no total and no trap: each table asserts its own literal total. Sourcing it only
# defines names and runs pure checks, and creates nothing. Each table then calls start_table, once, right after
# sourcing it: start_table makes WIRING_TMP, installs the table's one exit trap (install_table_exit_trap) before
# anything else is created, then builds the barrier. Until then LIVE_SETTINGS_BARRIER is a closed placeholder, so a
# table that never called start_table still never reaches the live session. A table sets REPO_ROOT, its checkout's
# root, before it sources this file; without it this file stops the table with exit 2.
#
# Usage, in a table:
#   HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
#   REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
#   TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
#   # shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
#   source "$TABLE_LIB" || { printf 'FATAL: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
#   start_table
#   require_tools gjs …

PASS=0; FAIL=0
ok()    { printf '  \033[0;32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()   { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 — expected '$3', got '$2'"; fi; }
fatal() { printf '\033[1;31mFATAL\033[0m: %s\n' "$*" >&2; exit 2; }

[[ -n "${REPO_ROOT:-}" && -d "$REPO_ROOT" ]] \
  || fatal "REPO_ROOT must name the checkout's root before scripts/resource-pulse-table-lib.sh is sourced"

# require_tools <tool>…: "could not run" (exit 2) unless every tool named is on PATH. Each table names the tools its
# own rows need, and no others.
require_tools() {
  local required_tool
  for required_tool in "$@"; do
    command -v "$required_tool" >/dev/null || fatal "$required_tool is required"
  done
}

# The extension the file rows read: the tree's, or a copy named by RESOURCE_PULSE_EXT_DIR (for a mutation trial). The
# gjs rows always test the tree. A table whose rows read it checks that it is a directory.
EXT_DIR="${RESOURCE_PULSE_EXT_DIR:-$REPO_ROOT/gnome-shell/extensions/resource-pulse@zvibaratz.github.io}"
EXTENSION_UUID="resource-pulse@zvibaratz.github.io"
RESOURCE_PULSE_BUS_NAME='io.github.zvibaratz.ResourcePulse1'
RESOURCE_PULSE_OBJECT_PATH='/io/github/zvibaratz/ResourcePulse1'
# The cockpit's bus name, its config template and that config's path below the config home, and the nested-shell
# state fixture it serves: read by the bus table's cockpit runs and the nested runs table's harness rows (all four), by
# the units table's cockpit unit rows (the bus name and the config's path) and by the nested check table (the fixture).
COCKPIT_BUS_NAME='io.github.zvibaratz.ResourcePulse.Cockpit1'
COCKPIT_CONFIG_TEMPLATE="$REPO_ROOT/examples/resource-pulse-cockpit.json.template"
COCKPIT_CONFIG_RELATIVE_PATH='resource-pulse/cockpit.json'
COCKPIT_NESTED_FIXTURE="$REPO_ROOT/gnome-shell/tests/fixtures/cockpit/nested-state.json"
# The longest a gjs process that only parses a module, or reads a file, is given. The glue-parse rows and the nested
# harness's helper rows both bound their gjs calls by it.
GLUE_PARSE_TIMEOUT_SECONDS=20

# The one line a gjs runner (gnome-shell/tests/run.js, run-private-bus.js) ends with.
JS_TALLY_PATTERN='^JS-TALLY pass=([0-9]+) fail=([0-9]+)$'
# fold_js_tally <runner output> <runner exit status> <label> folds the runner's tally into PASS and FAIL. The tally is
# read from ONE anchored line, never by counting marks: a row name may contain one. No tally line is "could not run"
# (exit 2): an import error prints none. A non-zero exit with no failing row in the tally means the runner itself
# broke, and is one ✗ of its own, "<label> exited <status> with no failing row".
fold_js_tally() {
  local runner_output="$1" runner_exit="$2" runner_label="$3" output_line tally_line="" tally_pass=0 tally_fail=0
  while IFS= read -r output_line; do
    if [[ "$output_line" =~ $JS_TALLY_PATTERN ]]; then
      tally_line="$output_line"
      tally_pass="${BASH_REMATCH[1]}"
      tally_fail="${BASH_REMATCH[2]}"
    fi
  done <<<"$runner_output"
  [[ -n "$tally_line" ]] \
    || fatal "no JS-TALLY line in the output of $runner_label (exit $runner_exit): its rows did not run"
  PASS=$((PASS + tally_pass))
  FAIL=$((FAIL + tally_fail))
  if (( runner_exit != 0 && tally_fail == 0 )); then
    bad "$runner_label exited $runner_exit with no failing row"
  fi
}

# A unit's start as the systemctl stubs of the status report and the refresh step answer it: ActiveEnterTimestamp with
# --timestamp=us+utc, to the microsecond, in UTC, with systemd's English day name. As systemd 259 prints it:
# `systemctl --user show -p ActiveEnterTimestamp --value --timestamp=us+utc
# resource-pulse.service` prints, for example, `Mon 2026-11-16 07:54:14.270693 UTC` (its --timestamp=unix, @1794815654), and an
# unknown unit an empty line; unit_timestamp_us_utc 1794815654 270693 prints the same. Under a German locale built with
# localedef (glibc's own strftime then said "Mo"), systemd still printed "Mon"; both scripts drop that first word all
# the same, and NON_ENGLISH_DAY_NAMES are what the rows that hold them to it put there instead. The rows start their
# units at .7 of a second, so a file can be written in the same second before the start (.4) or after it (.9).
NON_ENGLISH_DAY_NAMES=(Di 月)
UNIT_START_MICROSECONDS=700000
SAME_SECOND_BEFORE_START_MICROSECONDS=400000
SAME_SECOND_AFTER_START_MICROSECONDS=900000
# unit_timestamp_us_utc <epoch seconds> <microseconds>: that instant in systemd's us+utc form (bash's own strftime;
# the microseconds read in base 10, so a leading zero is no octal).
unit_timestamp_us_utc() {
  (
    export TZ=UTC0 LC_ALL=C
    printf '%(%a %Y-%m-%d %H:%M:%S)T.%06d UTC' "$1" "$((10#$2))"
  )
}
[[ "$(unit_timestamp_us_utc 1794815654 270693)" == 'Mon 2026-11-16 07:54:14.270693 UTC' ]] \
  || fatal "unit_timestamp_us_utc does not print systemd's form: $(unit_timestamp_us_utc 1794815654 270693)"

# The table's stand-ins are processes it starts that block until they are ended (a fake gnome-shell, a probe window's
# gjs). A table run that stops early would leave them beside the live session, where `pgrep -x gnome-shell` would then
# count a fake one. Each is registered as it starts (its pid, the script it runs, and, for one the table starts itself,
# its parent's pid), and the table's exit ends every one still running as itself, on every path its EXIT trap covers (a
# fatal, an exit, TERM, INT, HUP). One left by a KILL of the table alone, which runs no trap, ends by itself after
# STAND_IN_LIFETIME_SECONDS: far above the table's longest run (minutes), so no row loses its stand-in.
STAND_IN_LIFETIME_SECONDS=3600
# register_stand_in <pid> <script> [parent pid] records one stand-in for end_table_stand_ins.
register_stand_in() {
  printf '%s %s %s\n' "$1" "$2" "${3:--}" >>"$TABLE_STAND_IN_REGISTRY"
}
# end_table_stand_ins sends TERM to each registered stand-in still running as itself: its bash still runs the stand-in's
# own script (bash keeps the script it runs open on fd 255) and, when it was registered with a parent, it is still that
# process's child. Nothing else is signalled.
end_table_stand_ins() {
  local stand_in_pid stand_in_script stand_in_parent stand_in_script_path stat_line
  local -a stat_fields
  [[ -r "$TABLE_STAND_IN_REGISTRY" ]] || return 0
  while read -r stand_in_pid stand_in_script stand_in_parent; do
    stand_in_script_path="$(readlink -f -- "$stand_in_script")" || continue
    [[ "$(readlink "/proc/$stand_in_pid/fd/255" 2>/dev/null)" == "$stand_in_script_path" ]] || continue
    if [[ "$stand_in_parent" != - ]]; then
      read -r stat_line 2>/dev/null <"/proc/$stand_in_pid/stat" || continue
      read -r -a stat_fields <<<"${stat_line##*) }"
      [[ "${stat_fields[1]}" == "$stand_in_parent" ]] || continue
    fi
    kill -TERM "$stand_in_pid" 2>/dev/null
  done <"$TABLE_STAND_IN_REGISTRY"
}
# A row that needs a directory it cannot search makes one (make_fixture_unsearchable), and records it first in
# UNSEARCHABLE_FIXTURE_REGISTRY, which start_table names: rm -rf cannot remove what is inside a directory at mode 000,
# so a run stopped before the row gives the mode back (a time-out, Ctrl-C) would leave it in TMPDIR, where a temp cleaner
# cannot remove it either. The exit trap gives each recorded directory its owner's permissions back before it removes
# the temporary directory.
# make_fixture_unsearchable <directory> records the directory for the exit trap, then makes it unsearchable (mode 000).
# It stops the table itself, saying which of the two steps failed: a registry that could not be written is not a chmod
# that failed, and the directory is left searchable then, so nothing is hidden and nothing needs restoring.
make_fixture_unsearchable() {
  printf '%s\n' "$1" >>"$UNSEARCHABLE_FIXTURE_REGISTRY" \
    || fatal "cannot record $1 in $UNSEARCHABLE_FIXTURE_REGISTRY, so it was not made unsearchable"
  chmod 000 "$1" || fatal "chmod 000 $1 failed"
}
# restore_unsearchable_fixtures gives each directory make_fixture_unsearchable recorded its owner's permissions back.
restore_unsearchable_fixtures() {
  local fixture_directory
  [[ -r "$UNSEARCHABLE_FIXTURE_REGISTRY" ]] || return 0
  while IFS= read -r fixture_directory; do
    chmod u+rwx -- "$fixture_directory" 2>/dev/null
  done <"$UNSEARCHABLE_FIXTURE_REGISTRY"
}
# name_table_registries names the table's two registries in WIRING_TMP: TABLE_STAND_IN_REGISTRY (register_stand_in,
# end_table_stand_ins) and UNSEARCHABLE_FIXTURE_REGISTRY (make_fixture_unsearchable, restore_unsearchable_fixtures).
# start_table runs it, and the stand-in exit row runs it in a child of its own with the trap's functions, so the
# child's registries are named as the table's are, whatever this library names them.
name_table_registries() {
  TABLE_STAND_IN_REGISTRY="$WIRING_TMP/stand-ins"
  UNSEARCHABLE_FIXTURE_REGISTRY="$WIRING_TMP/unsearchable-fixture-directories"
}
# install_table_exit_trap: on every exit, the stand-ins still running are ended, then the temporary directory removed,
# once every directory a row made unsearchable can be searched again. The table's only trap: start_table installs it.
install_table_exit_trap() {
  trap 'end_table_stand_ins; restore_unsearchable_fixtures; rm -rf "$WIRING_TMP"' EXIT
}

# ---------------------------------------------------------------------------
# The barrier and the stubs.
#
# A stub is only a stub while it is there: if one failed to install, the real
# tool would run on the live session. So every stub is installed by
# install_stub (exit 2 unless it is an executable file, and unless PATH with its
# directory first resolves the tool to it), and every row that runs code which
# can write settings runs it behind LIVE_SETTINGS_BARRIER:
#   - a dead session bus address, so GLib cannot reach the live bus (dconf's
#     writes all go through it);
#   - a private XDG_RUNTIME_DIR, because with no address at all GLib falls back
#     to $XDG_RUNTIME_DIR/bus, which is the live bus;
#   - the in-memory GSettings backend, so even the real gsettings would write
#     to nothing. It is an extra layer, never the only one: the bus barrier
#     holds on its own.
# ---------------------------------------------------------------------------
# Until start_table builds the barrier, LIVE_SETTINGS_BARRIER is already closed: a bus socket and a runtime directory
# under /dev/null, which is not a directory, so neither can ever exist. An unset array would expand to nothing under
# `set -u`, and a row would then run with no barrier at all.
TABLE_NOT_STARTED_PATH='/dev/null/resource-pulse-table-not-started'
LIVE_SETTINGS_BARRIER=(GSETTINGS_BACKEND=memory "DBUS_SESSION_BUS_ADDRESS=unix:path=$TABLE_NOT_STARTED_PATH"
  "XDG_RUNTIME_DIR=$TABLE_NOT_STARTED_PATH")
# install_stub <dir> <tool> <source>: writes an executable stub, then exits 2
# unless it is one and PATH with <dir> first resolves <tool> to it.
install_stub() {
  local stub_dir="$1" tool_name="$2" stub_source="$3" resolved_path
  if ! mkdir -p "$stub_dir" || ! printf '%s\n' "$stub_source" >"$stub_dir/$tool_name" || ! chmod +x "$stub_dir/$tool_name"
  then
    fatal "cannot install the $tool_name stub in $stub_dir"
  fi
  [[ -f "$stub_dir/$tool_name" && -x "$stub_dir/$tool_name" ]] || fatal "the $tool_name stub in $stub_dir is not executable"
  # shellcheck disable=SC2016  # Expanded by the child bash, with the stub dir first on its PATH.
  resolved_path="$(env PATH="$stub_dir:$PATH" bash -c 'command -v "$1"' resolve-stub "$tool_name")"
  [[ "$resolved_path" == "$stub_dir/$tool_name" ]] \
    || fatal "PATH with $stub_dir first finds $tool_name at '$resolved_path', not the stub"
}

# start_table: what a table runs once, right after sourcing this file. In order, it
#   1. makes WIRING_TMP, where every fixture of the run lives, and names the two registries in it
#      (name_table_registries, which the stand-in exit row also runs in a child, so they change together or not at all);
#   2. installs the exit trap, before anything else is created, so every later "could not run" still removes WIRING_TMP;
#   3. builds the barrier: its private runtime directory, its dead bus address, and LIVE_SETTINGS_BARRIER.
# A second call, or a WIRING_TMP inherited from the environment, stops the table with exit 2: a second directory would
# orphan the first, which the trap would then never remove.
start_table() {
  [[ -z "${WIRING_TMP:-}" ]] || fatal "start_table runs once per table, and WIRING_TMP is already set ($WIRING_TMP)"
  WIRING_TMP="$(mktemp -d)" || fatal "mktemp -d failed"
  name_table_registries
  install_table_exit_trap
  LIVE_SETTINGS_BARRIER_RUNTIME_DIR="$WIRING_TMP/barrier-runtime"
  LIVE_SETTINGS_BARRIER_BUS="unix:path=$WIRING_TMP/barrier-no-session-bus"
  if ! mkdir -p "$LIVE_SETTINGS_BARRIER_RUNTIME_DIR" || ! chmod 700 "$LIVE_SETTINGS_BARRIER_RUNTIME_DIR"; then
    fatal "cannot create the barrier's private runtime dir"
  fi
  LIVE_SETTINGS_BARRIER=(GSETTINGS_BACKEND=memory "DBUS_SESSION_BUS_ADDRESS=$LIVE_SETTINGS_BARRIER_BUS"
    "XDG_RUNTIME_DIR=$LIVE_SETTINGS_BARRIER_RUNTIME_DIR")
}
