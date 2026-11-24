#!/usr/bin/env bash
#
# scripts/test-resource-pulse-units.sh
# ====================================
#
# State table for the Resource Pulse services' systemd side: the sampler's unit
# (systemd/resource-pulse.service), the cockpit's unit (systemd/resource-pulse-cockpit.service),
# and the refresh step that restarts them when their code changed
# (scripts/resource-pulse-service-refresh.sh, run against a recording systemctl
# stub, never the live user manager). The unit rows also have `systemd-analyze
# verify` read the unit files as shipped, each under a home of this run; it
# never touches the live manager.
#
# "Could not run" is exit 2, never a pass: a run as root (a refresh row needs a
# directory it cannot search, and root ignores directory permissions) is fatal.
# Without systemd-analyze the verify rows say so and pass with nothing verified
# unless CI is set, where GitHub Actions' runner has it; CI runs this table with
# CI set. The table asserts its own row total. Its shared helpers and constants
# are scripts/resource-pulse-table-lib.sh's.
#
# Requires: bash, find, and systemd-analyze (systemd) for the verify rows. No
# network, no root.
#
# Usage: scripts/test-resource-pulse-units.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
source "$TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
start_table

require_tools find

printf '\nthe unit (systemd/resource-pulse.service)\n'
SERVICE_UNIT="$REPO_ROOT/systemd/resource-pulse.service"
# The sampler's unit runs the compiled program where the build step installs it, outside the checkout: %h is
# the user's home, as systemd expands it in ExecStart.
UNIT_HOME_SPECIFIER='%h'
SAMPLER_UNIT_EXEC_START="$UNIT_HOME_SPECIFIER/.local/lib/resource-pulse/resource-pulse-sampler"
SAMPLER_BUILD_SCRIPT="$REPO_ROOT/scripts/resource-pulse-sampler-build.sh"
EXPECTED_UNIT_SETTINGS=(
  '[Unit]Description=<set>'
  '[Unit]PartOf=graphical-session.target'
  '[Unit]StartLimitIntervalSec=300'
  '[Unit]StartLimitBurst=5'
  '[Service]Type=dbus'
  "[Service]BusName=$RESOURCE_PULSE_BUS_NAME"
  "[Service]ExecStart=$SAMPLER_UNIT_EXEC_START"
  '[Service]NotifyAccess=main'
  '[Service]WatchdogSec=120'
  '[Service]WatchdogSignal=SIGKILL'
  '[Service]Restart=always'
  '[Service]RestartSec=5'
  '[Service]RestartPreventExitStatus=2'
  '[Service]Slice=background.slice'
  '[Service]Nice=10'
  '[Service]CPUQuota=10%'
  '[Service]MemoryHigh=16M'
  '[Service]MemoryMax=32M'
  '[Service]MemorySwapMax=0'
)
# read_unit_settings <unit file>: reads each setting as "[Section]Key=value",
# comments and blank lines aside, into unit_settings; the section headers, in
# order, into unit_sections; and the ExecStart value into unit_exec_start. A
# Description's text is not pinned, only that it is set. An unreadable file
# leaves no settings and says so in unit_sections.
read_unit_settings() {
  local unit_path="$1" unit_section="" unit_line
  unit_sections=""; unit_settings=(); unit_exec_start=""
  if [[ ! -r "$unit_path" ]]; then
    unit_sections="cannot read $unit_path"
    return
  fi
  while IFS= read -r unit_line || [[ -n "$unit_line" ]]; do
    case "$unit_line" in
      ''|'#'*|';'*) ;;
      '['*']') unit_section="$unit_line"; unit_sections+="$unit_line " ;;
      Description=?*) unit_settings+=("${unit_section}Description=<set>") ;;
      *)
        unit_settings+=("$unit_section$unit_line")
        [[ "$unit_line" == ExecStart=* ]] && unit_exec_start="${unit_line#ExecStart=}"
        ;;
    esac
  done <"$unit_path"
}
sorted_settings() { printf '%s\n' "$@" | LC_ALL=C sort | tr '\n' '|'; }
# verify checks that ExecStart's command exists and is executable, and it
# expands %h from HOME (measured: a HOME holding an executable at the installed
# path verifies, one without it names that path "not executable"). So each row
# verifies its unit file as shipped, with HOME at a temporary home of its own.
# The sampler's program is not installed on a runner (nor here before the build
# step has run), so the sampler's home holds an executable stand-in at the path
# its ExecStart names: a file verify never starts. The cockpit's home holds the
# extension's link, as linking it makes it, pointing at this checkout's extension
# (COCKPIT_VERIFY_HOME, defined with the cockpit's rows). verify never reads gjs's
# script argument, so it does not follow that link; the link is checked by
# unit_exec_resolution's row.
# --user mode refuses to start with no XDG_RUNTIME_DIR ("Failed to lookup
# RuntimeDirectory path", measured), which a CI runner need not have, so it runs
# behind the barrier, whose private runtime dir is all it needs. It still exits
# 1 for an unknown key and for a missing command (both measured).
SAMPLER_VERIFY_HOME="$WIRING_TMP/sampler-unit-verify-home"
SAMPLER_VERIFY_STAND_IN_PROGRAM="$SAMPLER_VERIFY_HOME/${SAMPLER_UNIT_EXEC_START#"$UNIT_HOME_SPECIFIER/"}"
# check_unit_verifies <unit file> <what verify's complaints about it contain> <row name> <verify's HOME>:
# one row, systemd-analyze --user verify, reading the unit file itself,
# unmodified, with HOME (and so %h) at the given directory.
check_unit_verifies() {
  local unit_path="$1" complaint_needle="$2" row_name="$3" verify_home="${4-}"
  local verify_output verify_exit
  if [[ ! -r "$unit_path" ]]; then
    bad "$row_name — cannot read $unit_path"
  elif [[ ! -d "$verify_home" ]]; then
    fatal "the verify home for ${unit_path##*/} is not a directory: '$verify_home'"
  elif command -v systemd-analyze >/dev/null 2>&1; then
    verify_output="$(env "${LIVE_SETTINGS_BARRIER[@]}" HOME="$verify_home" systemd-analyze --user verify \
      --man=no --recursive-errors=no "$unit_path" 2>&1)"
    verify_exit=$?
    check "$row_name" "$verify_exit:[$(grep -F "$complaint_needle" <<<"$verify_output")]" "0:[]"
  elif [[ -n "${CI:-}" ]]; then
    # CI is where this row is meant to run, so a runner without the tool is a failure, never a skip.
    bad "$row_name — systemd-analyze is missing on CI"
  else
    ok "systemd-analyze absent here; CI verifies ${unit_path##*/}"
  fi
}
read_unit_settings "$SERVICE_UNIT"
check "the unit has a [Unit] and a [Service] section and no [Install], so nothing can ever enable it" \
  "$unit_sections" "[Unit] [Service] "
check "the unit's settings are exactly the intended ones: Type=dbus on its bus name, the installed program, PartOf, the watchdog, restart, its limit and exit 2 never retried, caps" \
  "$(sorted_settings "${unit_settings[@]}")" "$(sorted_settings "${EXPECTED_UNIT_SETTINGS[@]}")"
# The ExecStart above is pinned as text; this row holds it to the build step:
# with every %h written as a home, as systemd expands it, its first word is the
# path --installed-path prints for that home, and no argument follows it. The
# build script runs behind the barrier, as every script here does. Each side
# has its own word for nothing, so an empty ExecStart never matches an empty answer.
EXEC_START_ROW_HOME=/h
unit_exec_start_under_row_home="${unit_exec_start//"$UNIT_HOME_SPECIFIER"/"$EXEC_START_ROW_HOME"}"
read -r -a unit_exec_words <<<"$unit_exec_start_under_row_home"
unit_exec_program="${unit_exec_words[0]:-<no ExecStart>}"
unit_exec_argument_count=$(( ${#unit_exec_words[@]} > 0 ? ${#unit_exec_words[@]} - 1 : 0 ))
build_step_installed_path="$(env "${LIVE_SETTINGS_BARRIER[@]}" HOME="$EXEC_START_ROW_HOME" \
  "$BASH" "$SAMPLER_BUILD_SCRIPT" --installed-path 2>&1)"
build_step_installed_path_exit=$?
check "the unit's ExecStart is the path the build step installs at, under %h, with no argument" \
  "installed-path-exit=$build_step_installed_path_exit program=$unit_exec_program arguments=$unit_exec_argument_count" \
  "installed-path-exit=0 program=${build_step_installed_path:-<no path printed>} arguments=0"
if ! mkdir -p "${SAMPLER_VERIFY_STAND_IN_PROGRAM%/*}" \
  || ! printf '#!/bin/sh\nexit 0\n' >"$SAMPLER_VERIFY_STAND_IN_PROGRAM" \
  || ! chmod +x "$SAMPLER_VERIFY_STAND_IN_PROGRAM"; then
  fatal "cannot write the sampler unit's verify stand-in at $SAMPLER_VERIFY_STAND_IN_PROGRAM"
fi
check_unit_verifies "$SERVICE_UNIT" 'resource-pulse' \
  "systemd-analyze --user verify accepts the unit as shipped, %h a home with an executable stand-in at the installed path, and says nothing of it" \
  "$SAMPLER_VERIFY_HOME"

printf '\nthe cockpit unit (systemd/resource-pulse-cockpit.service)\n'
COCKPIT_UNIT="$REPO_ROOT/systemd/resource-pulse-cockpit.service"
CHECKOUT_EXTENSION_RELATIVE_DIR="gnome-shell/extensions/$EXTENSION_UUID"
COCKPIT_MAIN_EXTENSION_RELATIVE_PATH='service/cockpit.js'
COCKPIT_MAIN_RELATIVE_PATH="$CHECKOUT_EXTENSION_RELATIVE_DIR/$COCKPIT_MAIN_EXTENSION_RELATIVE_PATH"
# The cockpit's unit runs its entry under gjs through the extension's link, which
# the user creates, pointing at the checkout, so the unit names no checkout.
UNIT_EXTENSION_LINK_PREFIX="%h/.local/share/gnome-shell/extensions/$EXTENSION_UUID/"
UNIT_INTERPRETER='/usr/bin/gjs -m'
# The cockpit's rows read %h as a home of this run whose extension link points at
# this checkout's extension: verify reads the unit as shipped under it (never gjs's script argument, so it does not follow the
# link); unit_exec_resolution's row is what follows the link.
COCKPIT_VERIFY_HOME="$WIRING_TMP/cockpit-unit-verify-home"
cockpit_verify_extension_link_relative_path="${UNIT_EXTENSION_LINK_PREFIX#"$UNIT_HOME_SPECIFIER/"}"
COCKPIT_VERIFY_EXTENSION_LINK="$COCKPIT_VERIFY_HOME/${cockpit_verify_extension_link_relative_path%/}"
COCKPIT_VERIFY_EXTENSION_TARGET="$REPO_ROOT/$CHECKOUT_EXTENSION_RELATIVE_DIR"
if ! mkdir -p "${COCKPIT_VERIFY_EXTENSION_LINK%/*}" \
  || ! ln -s -- "$COCKPIT_VERIFY_EXTENSION_TARGET" "$COCKPIT_VERIFY_EXTENSION_LINK"; then
  fatal "cannot link the cockpit unit's verify home's extension at $COCKPIT_VERIFY_EXTENSION_LINK"
fi
[[ -L "$COCKPIT_VERIFY_EXTENSION_LINK" && "$COCKPIT_VERIFY_EXTENSION_LINK" -ef "$COCKPIT_VERIFY_EXTENSION_TARGET" ]] \
  || fatal "$COCKPIT_VERIFY_EXTENSION_LINK is not a link to $COCKPIT_VERIFY_EXTENSION_TARGET"
# unit_exec_resolution <entry path relative to the checkout>: resolves the
# unit_exec_start that read_unit_settings left: the script it names through the
# extension's link, with every %h written as COCKPIT_VERIFY_HOME, as systemd
# expands it, is that entry of this checkout. Prints the entry relative to the
# extension directory when it is, "unresolved" otherwise.
unit_exec_resolution() {
  local expected_entry_path="$1" exec_script exec_script_under_verify_home
  exec_script="${unit_exec_start#"$UNIT_INTERPRETER "}"
  exec_script_under_verify_home="${exec_script//"$UNIT_HOME_SPECIFIER"/"$COCKPIT_VERIFY_HOME"}"
  if [[ "$exec_script" == "$UNIT_EXTENSION_LINK_PREFIX"* && -f "$exec_script_under_verify_home" \
    && "$exec_script_under_verify_home" -ef "$REPO_ROOT/$expected_entry_path" ]]; then
    printf '%s' "${expected_entry_path#"$CHECKOUT_EXTENSION_RELATIVE_DIR/"}"
  else
    printf 'unresolved'
  fi
}
# The opt-in: for anyone without the layout file, systemd skips the unit.
COCKPIT_UNIT_CONDITION_KEY='ConditionPathExists'
# %E is $XDG_CONFIG_HOME (or ~/.config), where GLib's user config dir, and so the
# service, looks for the file too.
COCKPIT_UNIT_CONDITION="$COCKPIT_UNIT_CONDITION_KEY=%E/$COCKPIT_CONFIG_RELATIVE_PATH"
EXPECTED_COCKPIT_UNIT_SETTINGS=(
  '[Unit]Description=<set>'
  '[Unit]PartOf=graphical-session.target'
  '[Unit]StartLimitIntervalSec=300'
  '[Unit]StartLimitBurst=5'
  "[Unit]$COCKPIT_UNIT_CONDITION"
  '[Service]Type=dbus'
  "[Service]BusName=$COCKPIT_BUS_NAME"
  "[Service]ExecStart=$UNIT_INTERPRETER $UNIT_EXTENSION_LINK_PREFIX$COCKPIT_MAIN_EXTENSION_RELATIVE_PATH"
  # Fixture mode is the nested harness's alone: the unit never inherits its variable.
  '[Service]UnsetEnvironment=RESOURCE_PULSE_COCKPIT_FIXTURE'
  '[Service]Restart=on-failure'
  '[Service]RestartSec=5'
  '[Service]Slice=background.slice'
  '[Service]Nice=10'
  '[Service]CPUQuota=10%'
  '[Service]MemoryHigh=64M'
  '[Service]MemoryMax=96M'
  '[Service]MemorySwapMax=0'
)
read_unit_settings "$COCKPIT_UNIT"
check "resource-pulse-cockpit.service has a [Unit] and a [Service] section and no [Install], so nothing can ever enable it" \
  "$unit_sections" "[Unit] [Service] "
check "resource-pulse-cockpit.service's settings are exactly the intended ones: Type=dbus on Cockpit1, PartOf, its condition, the fixture variable unset, restart and its limit, caps" \
  "$(sorted_settings "${unit_settings[@]}")" "$(sorted_settings "${EXPECTED_COCKPIT_UNIT_SETTINGS[@]}")"
# Counted over every section, so a second condition anywhere (a stricter or a
# looser one, in [Service] by mistake) shows, and so does the right one missing.
cockpit_condition_count=0; cockpit_exact_condition_count=0
for unit_setting in "${unit_settings[@]}"; do
  [[ "$unit_setting" == *"]$COCKPIT_UNIT_CONDITION_KEY="* ]] && cockpit_condition_count=$((cockpit_condition_count + 1))
  [[ "$unit_setting" == "[Unit]$COCKPIT_UNIT_CONDITION" ]] && cockpit_exact_condition_count=$((cockpit_exact_condition_count + 1))
done
check "resource-pulse-cockpit.service has exactly one $COCKPIT_UNIT_CONDITION_KEY, in [Unit], on %E/$COCKPIT_CONFIG_RELATIVE_PATH (\$XDG_CONFIG_HOME, or ~/.config)" \
  "conditions=$cockpit_condition_count exact=$cockpit_exact_condition_count" "conditions=1 exact=1"
check "resource-pulse-cockpit.service's ExecStart runs, under $UNIT_INTERPRETER, the checkout's own service/cockpit.js through the extension's link (%h a home whose link points at this checkout)" \
  "${unit_exec_start%% "$UNIT_EXTENSION_LINK_PREFIX"*}|$(unit_exec_resolution "$COCKPIT_MAIN_RELATIVE_PATH")" \
  "$UNIT_INTERPRETER|service/cockpit.js"
check_unit_verifies "$COCKPIT_UNIT" 'resource-pulse-cockpit.service' \
  "systemd-analyze --user verify accepts resource-pulse-cockpit.service as shipped, %h a home of this run, and says nothing of it" \
  "$COCKPIT_VERIFY_HOME"

printf '\nresource-pulse-service-refresh.sh (systemctl stub; never the live user manager)\n'
# Every row runs the script against a recording systemctl stub first on PATH,
# behind the barrier (a dead bus and a private runtime dir, so a real
# systemctl --user could reach no manager), over fixture files with chosen
# mtimes: an extension directory, both units' files and the sampler's installed
# program. The stub answers only the exact calls the script makes; any other
# call is an error the row sees. A unit's start is asked with
# --timestamp=us+utc and answered in that form (unit_timestamp_us_utc, as
# systemd prints it), at .7 of UNIT_STARTED_AT_EPOCH unless a row says
# otherwise.
REFRESH_SCRIPT="$REPO_ROOT/scripts/resource-pulse-service-refresh.sh"
REFRESH_STUB_BIN="$WIRING_TMP/refresh-bin"
REFRESH_NO_SYSTEMCTL_BIN="$WIRING_TMP/refresh-no-systemctl-bin"
REFRESH_CALLS="$WIRING_TMP/refresh-systemctl-calls"
REFRESH_EXTENSION_DIR="$WIRING_TMP/refresh-extension"
# The fixture's own copies of systemd/resource-pulse.service and
# systemd/resource-pulse-cockpit.service, with chosen mtimes.
REFRESH_UNIT_FILE="$WIRING_TMP/refresh-unit/resource-pulse.service"
REFRESH_COCKPIT_UNIT_FILE="$WIRING_TMP/refresh-unit/resource-pulse-cockpit.service"
# The fixture's installed sampler program, given to the script as
# RESOURCE_PULSE_PROGRAM_FILE (run_refresh), with a chosen mtime. The script
# reads only its time, so an empty file stands in for it.
REFRESH_PROGRAM_FILE="$WIRING_TMP/refresh-program/resource-pulse-sampler"
REFRESH_PROGRAM_DIRECTORY="${REFRESH_PROGRAM_FILE%/*}"
# The rows' own HOME, for the row on the program's default path, and a HOME that
# is not an absolute path.
REFRESH_HOME="$WIRING_TMP/refresh-home"
REFRESH_RELATIVE_HOME="relative/home"
UNIT_STARTED_AT_EPOCH=1700000100
BEFORE_START_EPOCH=1700000000
AFTER_START_EPOCH=1700000200
mkdir -p "$REFRESH_NO_SYSTEMCTL_BIN" || fatal "cannot create $REFRESH_NO_SYSTEMCTL_BIN"
# shellcheck disable=SC2016  # The stub's own source: its variables expand when it runs.
install_stub "$REFRESH_STUB_BIN" systemctl '#!/usr/bin/env bash
# Records each call, and answers from the REFRESH_STUB_* variables. resource-pulse-cockpit.service
# is inactive unless REFRESH_STUB_COCKPIT_ACTIVE_STATE says otherwise, as for
# anyone without its layout file, whose unit systemd skips. The state of a unit
# read after its try-restart (the look of the script) answers from variables of
# its own, active unless the row says otherwise.
printf "%s\n" "$*" >>"$REFRESH_CALLS"
# was_restarted <unit>: a try-restart of that unit is among the calls so far.
was_restarted() {
  local recorded_call
  while IFS= read -r recorded_call; do
    [[ "$recorded_call" == "--user try-restart $1" ]] && return 0
  done <"$REFRESH_CALLS"
  return 1
}
case "$*" in
  "--user show-environment") exit "$REFRESH_STUB_MANAGER_EXIT" ;;
  "--user daemon-reload") exit "$REFRESH_STUB_RELOAD_EXIT" ;;
  "--user show resource-pulse.service -p ActiveState --value")
    if was_restarted resource-pulse.service; then
      printf "%s\n" "${REFRESH_STUB_STATE_AFTER_RESTART-active}"
      exit "${REFRESH_STUB_STATE_AFTER_RESTART_EXIT:-0}"
    fi
    printf "%s\n" "$REFRESH_STUB_ACTIVE_STATE"
    exit "${REFRESH_STUB_STATE_EXIT:-0}" ;;
  "--user show resource-pulse.service -p ActiveEnterTimestamp --value --timestamp=us+utc")
    printf "%s\n" "$REFRESH_STUB_STARTED_AT" ;;
  "--user try-restart resource-pulse.service") exit "$REFRESH_STUB_RESTART_EXIT" ;;
  "--user show resource-pulse-cockpit.service -p ActiveState --value")
    if was_restarted resource-pulse-cockpit.service; then
      printf "%s\n" "${REFRESH_STUB_COCKPIT_STATE_AFTER_RESTART-active}"
      exit "${REFRESH_STUB_COCKPIT_STATE_AFTER_RESTART_EXIT:-0}"
    fi
    printf "%s\n" "${REFRESH_STUB_COCKPIT_ACTIVE_STATE:-inactive}" ;;
  "--user show resource-pulse-cockpit.service -p ActiveEnterTimestamp --value --timestamp=us+utc")
    printf "%s\n" "${REFRESH_STUB_COCKPIT_STARTED_AT:-}" ;;
  "--user try-restart resource-pulse-cockpit.service") exit "${REFRESH_STUB_COCKPIT_RESTART_EXIT:-0}" ;;
  *) printf "unexpected systemctl call: %s\n" "$*" >&2; exit 64 ;;
esac'
# The fixture's modules, relative to its extension directory, beside the two
# below that import others.
REFRESH_EMPTY_MODULES=(lib/protocol.js lib/sessions.js lib/visibility.js service/fileIo.js stylesheet.css)
# reset_refresh_fixture: the fixture with every file older than the units'
# start: an extension directory whose modules import one another as the real
# ones do, in small (service/cockpit.js, resource-pulse-cockpit.service's entry, imports
# service/fileIo.js and lib/sessions.js; extension.js imports lib/protocol.js
# and lib/visibility.js), both units' files, and the installed program.
reset_refresh_fixture() {
  local empty_module
  local -a fixture_files=("$REFRESH_EXTENSION_DIR/service/cockpit.js"
    "$REFRESH_EXTENSION_DIR/extension.js" "$REFRESH_UNIT_FILE" "$REFRESH_COCKPIT_UNIT_FILE" "$REFRESH_PROGRAM_FILE")
  # The program goes first: a row may have left a link there, which writing the
  # file would follow.
  rm -rf "$REFRESH_EXTENSION_DIR" "$REFRESH_PROGRAM_FILE" || fatal "cannot clear the refresh fixture"
  mkdir -p "$REFRESH_EXTENSION_DIR/lib" "$REFRESH_EXTENSION_DIR/service" "${REFRESH_UNIT_FILE%/*}" \
    "$REFRESH_PROGRAM_DIRECTORY" || fatal "cannot create the refresh fixture's directories"
  printf '%s\n' "import {readFileToEnd} from './fileIo.js';" \
    "import {buildSessionsSource} from '../lib/sessions.js';" >"$REFRESH_EXTENSION_DIR/service/cockpit.js" \
    || fatal "cannot write the fixture's service/cockpit.js"
  printf '%s\n' "import {PROTOCOL_VERSION} from './lib/protocol.js';" \
    "import {isCardCovered} from './lib/visibility.js';" >"$REFRESH_EXTENSION_DIR/extension.js" \
    || fatal "cannot write the fixture's extension.js"
  for empty_module in "${REFRESH_EMPTY_MODULES[@]}"; do
    : >"$REFRESH_EXTENSION_DIR/$empty_module" || fatal "cannot write the fixture's $empty_module"
    fixture_files+=("$REFRESH_EXTENSION_DIR/$empty_module")
  done
  if ! : >"$REFRESH_UNIT_FILE" || ! : >"$REFRESH_COCKPIT_UNIT_FILE" || ! : >"$REFRESH_PROGRAM_FILE"; then
    fatal "cannot write the fixture's unit files and program"
  fi
  touch -d "@$BEFORE_START_EPOCH" "${fixture_files[@]}" || fatal "touch -d @$BEFORE_START_EPOCH failed"
}
# refresh_fixture_with_newer <path>...: the fixture with every file older than
# the units' start but those, which are newer.
refresh_fixture_with_newer() {
  reset_refresh_fixture
  touch -d "@$AFTER_START_EPOCH" "$@" || fatal "touch -d @$AFTER_START_EPOCH $* failed"
}
# run_refresh <manager exit> <reload exit> <ActiveState> <ActiveEnterTimestamp> <try-restart exit> [stub bin]
# prints "exit=<n> calls=[<call>;...] output=[<stdout+stderr>]". The arguments
# answer for resource-pulse.service; resource-pulse-cockpit.service answers from the
# REFRESH_STUB_COCKPIT_* variables of the caller's environment (inactive
# without), and each unit's state after its restart from
# REFRESH_STUB_STATE_AFTER_RESTART* and REFRESH_STUB_COCKPIT_STATE_AFTER_RESTART*
# (active without). The sampler's program is the fixture's unless the caller sets
# REFRESH_RUN_PROGRAM_FILE (empty: none, so the script finds it under HOME).
# REFRESH_RUN_EXTRA_ENVIRONMENT holds any further NAME=value the script gets.
REFRESH_RUN_EXTRA_ENVIRONMENT=()
run_refresh() {
  local refresh_output refresh_exit stub_bin="${6:-$REFRESH_STUB_BIN}"
  : >"$REFRESH_CALLS"
  refresh_output="$(env "${LIVE_SETTINGS_BARRIER[@]}" PATH="$stub_bin:$PATH" REFRESH_CALLS="$REFRESH_CALLS" \
    REFRESH_STUB_MANAGER_EXIT="$1" REFRESH_STUB_RELOAD_EXIT="$2" REFRESH_STUB_ACTIVE_STATE="$3" \
    REFRESH_STUB_STARTED_AT="$4" REFRESH_STUB_RESTART_EXIT="$5" \
    RESOURCE_PULSE_EXTENSION_DIR="$REFRESH_EXTENSION_DIR" RESOURCE_PULSE_UNIT_FILE="$REFRESH_UNIT_FILE" \
    RESOURCE_PULSE_COCKPIT_UNIT_FILE="$REFRESH_COCKPIT_UNIT_FILE" \
    RESOURCE_PULSE_PROGRAM_FILE="${REFRESH_RUN_PROGRAM_FILE-$REFRESH_PROGRAM_FILE}" \
    "${REFRESH_RUN_EXTRA_ENVIRONMENT[@]}" "$BASH" "$REFRESH_SCRIPT" 2>&1)"
  refresh_exit=$?
  printf 'exit=%s calls=[%s] output=[%s]' "$refresh_exit" "$(tr '\n' ';' <"$REFRESH_CALLS")" "$refresh_output"
}
STARTED_AT="$(unit_timestamp_us_utc "$UNIT_STARTED_AT_EPOCH" "$UNIT_START_MICROSECONDS")"
# Written in the second both units started, before their start (.4 against .7) and after it (.9), as touch -d reads it.
SAME_SECOND_BEFORE_START="@$UNIT_STARTED_AT_EPOCH.$SAME_SECOND_BEFORE_START_MICROSECONDS"
SAME_SECOND_AFTER_START="@$UNIT_STARTED_AT_EPOCH.$SAME_SECOND_AFTER_START_MICROSECONDS"
# warnings_naming <summary> <step>: how many ⚠ lines of a run name that step.
warnings_naming() { grep -F '⚠' <<<"$1" | grep -c -F "$2"; }
# output_lines <summary> <mark>: the lines of a run's output (what follows
# "output=[", its closing bracket dropped) that carry that mark, joined by |.
output_lines() {
  local run_output="${1#* output=\[}"
  grep -F "$2" <<<"${run_output%]}" | tr '\n' '|'
}
# restart_lines and warning_lines <summary>: a run's ✓ lines, and its ⚠ lines.
restart_lines() { output_lines "$1" '✓'; }
warning_lines() { output_lines "$1" '⚠'; }
# Each unit's calls in the order the script makes them: its state, then (active)
# its start time, then (changed) its try-restart and, when that returned 0, the
# look: its state once more. resource-pulse.service first.
REFRESH_PREAMBLE_CALLS='--user show-environment;--user daemon-reload;'
SAMPLER_STATE_CALL='--user show resource-pulse.service -p ActiveState --value;'
SAMPLER_START_TIME_CALL='--user show resource-pulse.service -p ActiveEnterTimestamp --value --timestamp=us+utc;'
SAMPLER_RESTART_CALL='--user try-restart resource-pulse.service;'
COCKPIT_STATE_CALL='--user show resource-pulse-cockpit.service -p ActiveState --value;'
COCKPIT_START_TIME_CALL='--user show resource-pulse-cockpit.service -p ActiveEnterTimestamp --value --timestamp=us+utc;'
COCKPIT_RESTART_CALL='--user try-restart resource-pulse-cockpit.service;'
SAMPLER_CHECKED_CALLS="$SAMPLER_STATE_CALL$SAMPLER_START_TIME_CALL"
COCKPIT_CHECKED_CALLS="$COCKPIT_STATE_CALL$COCKPIT_START_TIME_CALL"
SAMPLER_RESTARTED_CALLS="$SAMPLER_RESTART_CALL$SAMPLER_STATE_CALL"
COCKPIT_RESTARTED_CALLS="$COCKPIT_RESTART_CALL$COCKPIT_STATE_CALL"
# The sampler's rows below leave resource-pulse-cockpit.service inactive, so each run that gets
# past the reload ends with its one state call, and says nothing of it.
CALLS_UP_TO_STATE="$REFRESH_PREAMBLE_CALLS$SAMPLER_STATE_CALL$COCKPIT_STATE_CALL"
CALLS_UP_TO_START_TIME="$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$COCKPIT_STATE_CALL"
CALLS_WITH_RESTART="$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$SAMPLER_RESTARTED_CALLS$COCKPIT_STATE_CALL"
CALLS_WITH_FAILED_RESTART="$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$SAMPLER_RESTART_CALL$COCKPIT_STATE_CALL"
# The sampler's ✓ lines, as restart_lines joins them.
SAMPLER_PROGRAM_RESTART_LINE='  ✓ resource-pulse.service restarted: its program changed since it started (its histories start again)|'
SAMPLER_UNIT_FILE_RESTART_LINE='  ✓ resource-pulse.service restarted: its unit file changed since it started (its histories start again)|'
SAMPLER_PROGRAM_AND_UNIT_FILE_RESTART_LINE='  ✓ resource-pulse.service restarted: its program and its unit file changed since it started (its histories start again)|'

refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE"
check "refresh: no user manager (a server) is silent and exits 0, asking nothing more" \
  "$(run_refresh 1 0 active "$STARTED_AT" 0)" "exit=0 calls=[--user show-environment;] output=[]"
# Without systemctl on PATH at all (a container): the script is run by bash's own path, so PATH can be empty of tools.
no_systemctl_output="$(env "${LIVE_SETTINGS_BARRIER[@]}" PATH="$REFRESH_NO_SYSTEMCTL_BIN" \
  RESOURCE_PULSE_EXTENSION_DIR="$REFRESH_EXTENSION_DIR" "$BASH" "$REFRESH_SCRIPT" 2>&1)"
no_systemctl_exit=$?
check "refresh: no systemctl at all (a container) is silent and exits 0" \
  "exit=$no_systemctl_exit output=[$no_systemctl_output]" "exit=0 output=[]"
refresh_not_active_summary=""
for refresh_active_state in inactive failed activating; do
  refresh_not_active_summary+="$refresh_active_state:$(run_refresh 0 0 "$refresh_active_state" "$STARTED_AT" 0) "
done
check "refresh: a unit not active (inactive, failed, activating) is reloaded for, then left alone, silently" \
  "$refresh_not_active_summary" \
  "inactive:exit=0 calls=[$CALLS_UP_TO_STATE] output=[] failed:exit=0 calls=[$CALLS_UP_TO_STATE] output=[] activating:exit=0 calls=[$CALLS_UP_TO_STATE] output=[] "
# The sampler runs the compiled program the build step installs: its restart
# follows that program's file, and its own unit file, never a module.
reset_refresh_fixture
check "refresh: an active sampler whose program and unit file are both older than its start is left alone, silently" \
  "$(run_refresh 0 0 active "$STARTED_AT" 0)" "exit=0 calls=[$CALLS_UP_TO_START_TIME] output=[]"
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE"
check "refresh: a program newer than the sampler's start try-restarts it, after the reload, looks, and says its program changed and its histories start again" \
  "$(run_refresh 0 0 active "$STARTED_AT" 0)" "exit=0 calls=[$CALLS_WITH_RESTART] output=[${SAMPLER_PROGRAM_RESTART_LINE%|}]"
# Nor does any module of the extension: the cockpit's entry and the modules it
# imports, or the shell's entry and its modules.
REFRESH_EXTENSION_MODULES=(service/cockpit.js service/fileIo.js lib/sessions.js extension.js lib/protocol.js
  lib/visibility.js)
refresh_module_summary=""
expected_refresh_module_summary=""
for changed_module in "${REFRESH_EXTENSION_MODULES[@]}"; do
  refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/$changed_module"
  refresh_module_summary+="$changed_module:$(run_refresh 0 0 active "$STARTED_AT" 0) "
  expected_refresh_module_summary+="$changed_module:exit=0 calls=[$CALLS_UP_TO_START_TIME] output=[] "
done
check "refresh: no module of the extension restarts the sampler (the cockpit's service/cockpit.js, service/fileIo.js and lib/sessions.js, the shell's extension.js, lib/protocol.js and lib/visibility.js), so its histories survive" \
  "$refresh_module_summary" "$expected_refresh_module_summary"
# The start is read to the microsecond: a deploy that rebuilds the
# program writes it and restarts the sampler within one second, so a program
# written earlier in that second is the one running, and restarting it again
# would empty its histories for nothing.
reset_refresh_fixture
touch -d "$SAME_SECOND_BEFORE_START" "$REFRESH_PROGRAM_FILE" || fatal "touch -d $SAME_SECOND_BEFORE_START failed"
before_start_summary="$(run_refresh 0 0 active "$STARTED_AT" 0)"
touch -d "$SAME_SECOND_AFTER_START" "$REFRESH_PROGRAM_FILE" || fatal "touch -d $SAME_SECOND_AFTER_START failed"
after_start_summary="$(run_refresh 0 0 active "$STARTED_AT" 0)"
check "refresh: within the second the sampler started, a program written before its start (.4 against .7) is not newer; one written after it (.9) is" \
  "before-start:${before_start_summary%% output=*} after-start:${after_start_summary%% output=*}" \
  "before-start:exit=0 calls=[$CALLS_UP_TO_START_TIME] after-start:exit=0 calls=[$CALLS_WITH_RESTART]"
# The start's first word, its day name, is dropped before find reads it (GNU find cannot read one that is not
# English): a start that says Di or 月 is read all the same, to the microsecond.
refresh_day_name_summary=""
expected_refresh_day_name_summary=""
for non_english_day_name in "${NON_ENGLISH_DAY_NAMES[@]}"; do
  day_name_started_at="$non_english_day_name ${STARTED_AT#* }"
  reset_refresh_fixture
  touch -d "$SAME_SECOND_BEFORE_START" "$REFRESH_PROGRAM_FILE" || fatal "touch -d $SAME_SECOND_BEFORE_START failed"
  day_name_run="$(run_refresh 0 0 active "$day_name_started_at" 0)"
  refresh_day_name_summary+="$non_english_day_name/before-start:${day_name_run%% output=*} "
  touch -d "$SAME_SECOND_AFTER_START" "$REFRESH_PROGRAM_FILE" || fatal "touch -d $SAME_SECOND_AFTER_START failed"
  day_name_run="$(run_refresh 0 0 active "$day_name_started_at" 0)"
  refresh_day_name_summary+="$non_english_day_name/after-start:${day_name_run%% output=*} "
  expected_refresh_day_name_summary+="$non_english_day_name/before-start:exit=0 calls=[$CALLS_UP_TO_START_TIME] "
  expected_refresh_day_name_summary+="$non_english_day_name/after-start:exit=0 calls=[$CALLS_WITH_RESTART] "
done
check "refresh: a start whose day name is not English (Di, 月) is read all the same, to the microsecond: a program written before it in its second is not newer, one written after it is" \
  "$refresh_day_name_summary" "$expected_refresh_day_name_summary"
# A program that is not there (not built yet, a build that failed: the build
# step said why) is not newer, and is no reason to warn; the unit file still
# decides alone.
reset_refresh_fixture
rm -f "$REFRESH_PROGRAM_FILE" || fatal "cannot remove $REFRESH_PROGRAM_FILE"
check "refresh: a program that is not there is not newer: beside an older unit file the sampler is left alone, silently" \
  "$(run_refresh 0 0 active "$STARTED_AT" 0)" "exit=0 calls=[$CALLS_UP_TO_START_TIME] output=[]"
refresh_fixture_with_newer "$REFRESH_UNIT_FILE"
rm -f "$REFRESH_PROGRAM_FILE" || fatal "cannot remove $REFRESH_PROGRAM_FILE"
check "refresh: a program that is not there leaves a newer unit file to restart the sampler, in a line naming the unit file alone" \
  "$(run_refresh 0 0 active "$STARTED_AT" 0)" "exit=0 calls=[$CALLS_WITH_RESTART] output=[${SAMPLER_UNIT_FILE_RESTART_LINE%|}]"
# A link at the program's path is read as what it names, as systemd runs what
# it names: a link older than the start to a program newer than it restarts
# the sampler, and a link newer than the start to nothing is a program that is
# not there.
REFRESH_PROGRAM_LINK_TARGET="$WIRING_TMP/refresh-program-target/resource-pulse-sampler"
reset_refresh_fixture
if ! mkdir -p "${REFRESH_PROGRAM_LINK_TARGET%/*}" || ! : >"$REFRESH_PROGRAM_LINK_TARGET" \
  || ! touch -d "@$AFTER_START_EPOCH" "$REFRESH_PROGRAM_LINK_TARGET" \
  || ! ln -sfn "$REFRESH_PROGRAM_LINK_TARGET" "$REFRESH_PROGRAM_FILE" \
  || ! touch -h -d "@$BEFORE_START_EPOCH" "$REFRESH_PROGRAM_FILE"; then
  fatal "cannot link $REFRESH_PROGRAM_FILE to a newer $REFRESH_PROGRAM_LINK_TARGET"
fi
program_link_summary="newer-target:$(run_refresh 0 0 active "$STARTED_AT" 0)"
if ! rm -f "$REFRESH_PROGRAM_LINK_TARGET" || ! touch -h -d "@$AFTER_START_EPOCH" "$REFRESH_PROGRAM_FILE"; then
  fatal "cannot leave $REFRESH_PROGRAM_FILE a newer link to nothing"
fi
program_link_summary+=" dangling:$(run_refresh 0 0 active "$STARTED_AT" 0)"
check "refresh: a link at the program's path is read as what it names: one to a newer program restarts the sampler, a newer one to nothing is a program that is not there" \
  "$program_link_summary" \
  "newer-target:exit=0 calls=[$CALLS_WITH_RESTART] output=[${SAMPLER_PROGRAM_RESTART_LINE%|}] dangling:exit=0 calls=[$CALLS_UP_TO_START_TIME] output=[]"
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE" "$REFRESH_UNIT_FILE"
check "refresh: its program and its unit file both newer than the sampler's start: one try-restart, in a line naming both" \
  "$(run_refresh 0 0 active "$STARTED_AT" 0)" "exit=0 calls=[$CALLS_WITH_RESTART] output=[${SAMPLER_PROGRAM_AND_UNIT_FILE_RESTART_LINE%|}]"
# The unit file counts too: after the daemon-reload has loaded a newer one, its
# [Service] settings (a cap, the ExecStart) apply only from the next start. A
# missing one, beside a newer program, is a search that failed: a partial
# answer never decides a restart.
unit_file_summary=""
refresh_fixture_with_newer "$REFRESH_UNIT_FILE"
unit_file_run="$(run_refresh 0 0 active "$STARTED_AT" 0)"
unit_file_summary+="newer:${unit_file_run%% output=*} said=[$(restart_lines "$unit_file_run")]"
reset_refresh_fixture
unit_file_run="$(run_refresh 0 0 active "$STARTED_AT" 0)"
unit_file_summary+=" older:${unit_file_run%% output=*}"
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE"
rm -f "$REFRESH_UNIT_FILE" || fatal "cannot remove $REFRESH_UNIT_FILE"
unit_file_run="$(run_refresh 0 0 active "$STARTED_AT" 0)"
unit_file_summary+=" missing:${unit_file_run%% output=*} warned=$(warnings_naming "$unit_file_run" 'cannot search its program')"
check "refresh: a unit file newer than the sampler's start try-restarts it, after the reload, and says so; an older one does not; a missing one warns and restarts nothing, though its program changed" \
  "$unit_file_summary" \
  "newer:exit=0 calls=[$CALLS_WITH_RESTART] said=[$SAMPLER_UNIT_FILE_RESTART_LINE] older:exit=0 calls=[$CALLS_UP_TO_START_TIME] missing:exit=0 calls=[$CALLS_UP_TO_START_TIME] warned=1"
# "Not there" must be believed: behind a directory it cannot search, the
# program may be there, and newer, so the answer is partial and decides
# nothing, not even the restart a newer unit file would give. Root ignores
# directory permissions, so as root this fixture cannot be made, and the table
# stops rather than pass.
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE" "$REFRESH_UNIT_FILE"
make_fixture_unsearchable "$REFRESH_PROGRAM_DIRECTORY"
if [[ -e "$REFRESH_PROGRAM_FILE" ]]; then
  chmod 755 "$REFRESH_PROGRAM_DIRECTORY"
  fatal "chmod 000 did not hide $REFRESH_PROGRAM_FILE (root ignores directory permissions): run this table as a normal user"
fi
unsearchable_program_run="$(run_refresh 0 0 active "$STARTED_AT" 0)"
chmod 755 "$REFRESH_PROGRAM_DIRECTORY" || fatal "chmod 755 $REFRESH_PROGRAM_DIRECTORY failed"
check "refresh: a program behind a directory it cannot search may be there: it warns, naming that, and restarts nothing, though the unit file is newer" \
  "${unsearchable_program_run%% output=*} warned=$(warnings_naming "$unsearchable_program_run" 'cannot search its program')" \
  "exit=0 calls=[$CALLS_UP_TO_START_TIME] warned=1"
# So is a link at the program's path to a program behind a directory it cannot
# search: the directories on the link's own path can be searched, but what it
# names may be there, and newer.
REFRESH_PROGRAM_LINK_TARGET_DIRECTORY="${REFRESH_PROGRAM_LINK_TARGET%/*}"
refresh_fixture_with_newer "$REFRESH_UNIT_FILE"
if ! mkdir -p "$REFRESH_PROGRAM_LINK_TARGET_DIRECTORY" || ! : >"$REFRESH_PROGRAM_LINK_TARGET" \
  || ! touch -d "@$AFTER_START_EPOCH" "$REFRESH_PROGRAM_LINK_TARGET" || ! rm -f "$REFRESH_PROGRAM_FILE" \
  || ! ln -s "$REFRESH_PROGRAM_LINK_TARGET" "$REFRESH_PROGRAM_FILE" \
  || ! touch -h -d "@$BEFORE_START_EPOCH" "$REFRESH_PROGRAM_FILE"; then
  fatal "cannot link $REFRESH_PROGRAM_FILE to a newer $REFRESH_PROGRAM_LINK_TARGET"
fi
make_fixture_unsearchable "$REFRESH_PROGRAM_LINK_TARGET_DIRECTORY"
if [[ -e "$REFRESH_PROGRAM_FILE" ]]; then
  chmod 755 "$REFRESH_PROGRAM_LINK_TARGET_DIRECTORY"
  fatal "chmod 000 did not hide $REFRESH_PROGRAM_LINK_TARGET (root ignores directory permissions): run this table as a normal user"
fi
unsearchable_link_target_run="$(run_refresh 0 0 active "$STARTED_AT" 0)"
chmod 755 "$REFRESH_PROGRAM_LINK_TARGET_DIRECTORY" || fatal "chmod 755 $REFRESH_PROGRAM_LINK_TARGET_DIRECTORY failed"
check "refresh: a link at the program's path to a program behind a directory it cannot search may name a newer program: it warns, naming that, and restarts nothing, though the unit file is newer" \
  "${unsearchable_link_target_run%% output=*} warned=$(warnings_naming "$unsearchable_link_target_run" 'cannot search its program')" \
  "exit=0 calls=[$CALLS_UP_TO_START_TIME] warned=1"
# With no RESOURCE_PULSE_PROGRAM_FILE (the refresh step sets none) the program is under
# HOME, where the build step installs it: the path its --installed-path prints
# for that HOME, which the row writes to only once it is inside the rows' HOME.
refresh_installed_path="$(env "${LIVE_SETTINGS_BARRIER[@]}" HOME="$REFRESH_HOME" \
  "$BASH" "$SAMPLER_BUILD_SCRIPT" --installed-path 2>&1)" \
  || fatal "resource-pulse-sampler-build.sh --installed-path failed: $refresh_installed_path"
[[ "$refresh_installed_path" == "$REFRESH_HOME/"* ]] \
  || fatal "--installed-path named '$refresh_installed_path', not a path inside the rows' HOME $REFRESH_HOME"
reset_refresh_fixture
if ! mkdir -p "${refresh_installed_path%/*}" || ! : >"$refresh_installed_path" \
  || ! touch -d "@$AFTER_START_EPOCH" "$refresh_installed_path"; then
  fatal "cannot write the program at $refresh_installed_path"
fi
check "refresh: with no RESOURCE_PULSE_PROGRAM_FILE, the sampler follows the program under HOME at the path resource-pulse-sampler-build.sh --installed-path prints" \
  "$(HOME="$REFRESH_HOME" REFRESH_RUN_PROGRAM_FILE='' run_refresh 0 0 active "$STARTED_AT" 0)" \
  "exit=0 calls=[$CALLS_WITH_RESTART] output=[${SAMPLER_PROGRAM_RESTART_LINE%|}]"
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE"
reload_failed_summary="$(run_refresh 0 1 active "$STARTED_AT" 0)"
# Every failure below warns with a ⚠ line naming the step, restarts nothing, and
# still returns 0: under `set -e` an exit 1 would abort the rest of a caller's
# install.
# The reload is one step for both units, so its one line names both.
check "refresh: a failed daemon-reload warns once, naming it and both units, restarts nothing and returns 0" \
  "${reload_failed_summary%% output=*} warned=$(warnings_naming "$reload_failed_summary" daemon-reload) names-both=$(grep -c -F '⚠ resource-pulse.service, resource-pulse-cockpit.service: daemon-reload failed' <<<"$reload_failed_summary")" \
  "exit=0 calls=[$REFRESH_PREAMBLE_CALLS] warned=1 names-both=1"
# A state that cannot be read must not pass for "not active", which is silent.
state_unreadable_summary="$(REFRESH_STUB_STATE_EXIT=1 run_refresh 0 0 active "$STARTED_AT" 0)"
check "refresh: a state it cannot read warns, naming it, restarts nothing and returns 0" \
  "${state_unreadable_summary%% output=*} warned=$(warnings_naming "$state_unreadable_summary" ActiveState)" \
  "exit=0 calls=[$CALLS_UP_TO_STATE] warned=1"
unreadable_start_summary=""
# Empty (a unit never started), n/a, and whole seconds: @<epoch> (what --timestamp=unix printed) and systemd's UTC
# form without its microseconds. Whole seconds must not pass: they would bring back the needless restart.
UNREADABLE_START_TIMES=('' 'n/a' "@$UNIT_STARTED_AT_EPOCH" "${STARTED_AT%.*} UTC")
for unreadable_started_at in "${UNREADABLE_START_TIMES[@]}"; do
  unreadable_summary="$(run_refresh 0 0 active "$unreadable_started_at" 0)"
  unreadable_start_summary+="${unreadable_summary%% output=*} warned=$(warnings_naming "$unreadable_summary" ActiveEnterTimestamp) "
done
expected_unreadable_start_summary=""
for _ in "${UNREADABLE_START_TIMES[@]}"; do
  expected_unreadable_start_summary+="exit=0 calls=[$CALLS_UP_TO_START_TIME] warned=1 "
done
check "refresh: an active unit whose start time is not systemd's microsecond UTC form (empty, n/a, or whole seconds, as @<epoch> or without a fraction) warns, naming it, restarts nothing, returns 0" \
  "$unreadable_start_summary" "$expected_unreadable_start_summary"
restart_failed_summary="$(run_refresh 0 0 active "$STARTED_AT" 1)"
check "refresh: a failed try-restart warns, naming it, looks no further, says no ✓ and returns 0" \
  "${restart_failed_summary%% output=*} warned=$(warnings_naming "$restart_failed_summary" try-restart) said=[$(restart_lines "$restart_failed_summary")]" \
  "exit=0 calls=[$CALLS_WITH_FAILED_RESTART] warned=1 said=[]"
# A find that warns on stderr yet succeeds, listing nothing: its warning must
# reach the terminal, and never be read as a changed file. The sampler is
# searched twice, its program and then its unit file, so it is shown twice.
REFRESH_FIND_WARNING_BIN="$WIRING_TMP/refresh-find-warning-bin"
install_stub "$REFRESH_FIND_WARNING_BIN" find '#!/usr/bin/env bash
printf "find: warning: a stand-in warning on stderr\n" >&2
exit 0'
reset_refresh_fixture
find_warning_summary="$(run_refresh 0 0 active "$STARTED_AT" 0 "$REFRESH_FIND_WARNING_BIN:$REFRESH_STUB_BIN")"
check "refresh: a warning find prints on stderr while succeeding is shown, for each of the sampler's two searches, and never read as a changed file" \
  "${find_warning_summary%% output=*} shown=$(grep -c -F 'stand-in warning' <<<"$find_warning_summary")" \
  "exit=0 calls=[$CALLS_UP_TO_START_TIME] shown=2"

# resource-pulse-cockpit.service is the step's second unit: its own entry (service/cockpit.js),
# its own closure and its own unit file, decided alone after the one reload, and
# every line names its unit. A module it runs restarts it alone, and its
# program restarts the sampler alone.
# run_refresh_both_active [sampler state exit] [cockpit start time]: both units
# active since UNIT_STARTED_AT_EPOCH, every call succeeding.
run_refresh_both_active() {
  REFRESH_STUB_STATE_EXIT="${1:-0}" REFRESH_STUB_COCKPIT_ACTIVE_STATE=active \
    REFRESH_STUB_COCKPIT_STARTED_AT="${2:-$STARTED_AT}" run_refresh 0 0 active "$STARTED_AT" 0
}
CALLS_BOTH_UNCHANGED="$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$COCKPIT_CHECKED_CALLS"
CALLS_COCKPIT_RESTARTED="$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$COCKPIT_CHECKED_CALLS$COCKPIT_RESTARTED_CALLS"
CALLS_SAMPLER_RESTARTED="$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$SAMPLER_RESTARTED_CALLS$COCKPIT_CHECKED_CALLS"
COCKPIT_ENTRY_RESTART_LINE='  ✓ resource-pulse-cockpit.service restarted: service/cockpit.js changed since it started|'
reset_refresh_fixture
both_unchanged_run="$(run_refresh_both_active)"
check "refresh: both units active and nothing changed since their starts: one reload, both checked, neither restarted, nothing said" \
  "${both_unchanged_run%% output=*} said=[$(restart_lines "$both_unchanged_run")]" \
  "exit=0 calls=[$CALLS_BOTH_UNCHANGED] said=[]"
refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/service/cockpit.js"
cockpit_entry_changed_run="$(run_refresh_both_active)"
check "refresh: service/cockpit.js newer than resource-pulse-cockpit.service's start try-restarts resource-pulse-cockpit.service and leaves resource-pulse.service alone, in a line naming resource-pulse-cockpit.service" \
  "${cockpit_entry_changed_run%% output=*} said=[$(restart_lines "$cockpit_entry_changed_run")]" \
  "exit=0 calls=[$CALLS_COCKPIT_RESTARTED] said=[$COCKPIT_ENTRY_RESTART_LINE]"
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE"
sampler_program_changed_run="$(run_refresh_both_active)"
check "refresh: a program newer than resource-pulse.service's start try-restarts it and leaves an active resource-pulse-cockpit.service alone" \
  "${sampler_program_changed_run%% output=*} said=[$(restart_lines "$sampler_program_changed_run")]" \
  "exit=0 calls=[$CALLS_SAMPLER_RESTARTED] said=[$SAMPLER_PROGRAM_RESTART_LINE]"
refresh_by_closure_summary=""
for changed_module in service/fileIo.js lib/sessions.js lib/visibility.js; do
  refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/$changed_module"
  refresh_closure_run="$(run_refresh_both_active)"
  refresh_by_closure_summary+="$changed_module:${refresh_closure_run%% output=*} "
done
refresh_fixture_with_newer "$REFRESH_COCKPIT_UNIT_FILE"
refresh_closure_run="$(run_refresh_both_active)"
refresh_by_closure_summary+="cockpit-unit-file:${refresh_closure_run%% output=*} said=[$(restart_lines "$refresh_closure_run")]"
check "refresh: a module resource-pulse-cockpit.service runs (service/fileIo.js, lib/sessions.js), or its own unit file, restarts only it; one it does not run (lib/visibility.js) restarts neither unit" \
  "$refresh_by_closure_summary" \
  "service/fileIo.js:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] lib/sessions.js:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] lib/visibility.js:exit=0 calls=[$CALLS_BOTH_UNCHANGED] cockpit-unit-file:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] said=[  ✓ resource-pulse-cockpit.service restarted: its unit file changed since it started|]"
# The cockpit's start is read to the microsecond too, and its modules compared against it.
reset_refresh_fixture
touch -d "$SAME_SECOND_BEFORE_START" "$REFRESH_EXTENSION_DIR/service/cockpit.js" \
  || fatal "touch -d $SAME_SECOND_BEFORE_START failed"
cockpit_before_start_run="$(run_refresh_both_active)"
touch -d "$SAME_SECOND_AFTER_START" "$REFRESH_EXTENSION_DIR/service/cockpit.js" \
  || fatal "touch -d $SAME_SECOND_AFTER_START failed"
cockpit_after_start_run="$(run_refresh_both_active)"
check "refresh: within the second resource-pulse-cockpit.service started, service/cockpit.js written before its start (.4 against .7) does not restart it; written after it (.9) does" \
  "before-start:${cockpit_before_start_run%% output=*} after-start:${cockpit_after_start_run%% output=*}" \
  "before-start:exit=0 calls=[$CALLS_BOTH_UNCHANGED] after-start:exit=0 calls=[$CALLS_COCKPIT_RESTARTED]"
# The step runs `command find`, never a shell function of that name: bash imports one exported into its environment
# (BASH_FUNC_find%%). One that refuses every call changes nothing: a newer program and a newer service/cockpit.js
# restart their units, and the function never answers.
REFRESH_REFUSING_FIND_FUNCTION='() { printf "a find function refused this call\n" >&2; return 1; }'
CALLS_BOTH_RESTARTED="$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$SAMPLER_RESTARTED_CALLS$COCKPIT_CHECKED_CALLS$COCKPIT_RESTARTED_CALLS"
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE" "$REFRESH_EXTENSION_DIR/service/cockpit.js"
REFRESH_RUN_EXTRA_ENVIRONMENT=("BASH_FUNC_find%%=$REFRESH_REFUSING_FIND_FUNCTION")
find_function_run="$(run_refresh_both_active)"
REFRESH_RUN_EXTRA_ENVIRONMENT=()
# That bash does import it, so the row is not passing on a function that was never there.
# shellcheck disable=SC2016  # Expanded by the child bash.
find_function_imported="$(env "BASH_FUNC_find%%=$REFRESH_REFUSING_FIND_FUNCTION" "$BASH" -c 'declare -F find')"
check "refresh: it asks the find command, never a shell function named find in its environment: with one that refuses every call, a newer program and a newer service/cockpit.js still restart their units" \
  "${find_function_run%% output=*} refused=$(grep -c -F 'a find function refused' <<<"$find_function_run") imported=[$find_function_imported]" \
  "exit=0 calls=[$CALLS_BOTH_RESTARTED] refused=0 imported=[find]"
# service/cockpit.js missing while lib/ holds a newer module it imported: which
# modules resource-pulse-cockpit.service runs cannot be worked out, and a partial answer must
# never decide a restart.
refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/lib/sessions.js"
rm -f "$REFRESH_EXTENSION_DIR/service/cockpit.js" || fatal "cannot remove the fixture's service/cockpit.js"
unlistable_run="$(run_refresh_both_active)"
check "refresh: when it cannot work out which modules resource-pulse-cockpit.service runs (service/cockpit.js missing, a newer module beside it), it warns, naming the unit and that, restarts nothing and returns 0" \
  "${unlistable_run%% output=*} warned=$(warnings_naming "$unlistable_run" 'resource-pulse-cockpit.service: cannot work out which modules it runs')" \
  "exit=0 calls=[$CALLS_BOTH_UNCHANGED] warned=1"
# Its unit file missing while service/cockpit.js is newer: the one search over
# the modules it runs and its unit file fails, and finds a changed module all
# the same. A partial answer must never decide a restart.
refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/service/cockpit.js"
rm -f "$REFRESH_COCKPIT_UNIT_FILE" || fatal "cannot remove $REFRESH_COCKPIT_UNIT_FILE"
unsearchable_cockpit_run="$(run_refresh_both_active)"
check "refresh: when it cannot search what resource-pulse-cockpit.service runs (its unit file missing, service/cockpit.js newer), it warns, naming the unit and that, restarts nothing and returns 0" \
  "${unsearchable_cockpit_run%% output=*} said=[$(restart_lines "$unsearchable_cockpit_run")] warned=$(warnings_naming "$unsearchable_cockpit_run" 'resource-pulse-cockpit.service: cannot search the modules it runs')" \
  "exit=0 calls=[$CALLS_BOTH_UNCHANGED] said=[] warned=1"
# Without ~/.config/resource-pulse/cockpit.json, systemd skips resource-pulse-cockpit.service
# on its condition and reports it inactive: however new its code, the step
# leaves it alone and says nothing of it, while the sampler is still decided.
refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/service/cockpit.js" "$REFRESH_COCKPIT_UNIT_FILE"
check "refresh: an inactive (condition-skipped) resource-pulse-cockpit.service, with newer code and unit file, is left alone, silently, after the sampler is decided" \
  "$(run_refresh 0 0 active "$STARTED_AT" 0)" "exit=0 calls=[$REFRESH_PREAMBLE_CALLS$SAMPLER_CHECKED_CALLS$COCKPIT_STATE_CALL] output=[]"
# A failure on one unit warns naming that unit, and the other is still decided.
refresh_failure_isolation_summary=""
refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/service/cockpit.js"
refresh_isolation_run="$(run_refresh_both_active 1)"
refresh_failure_isolation_summary+="sampler-state-unreadable:${refresh_isolation_run%% output=*} warned=$(grep -c -F '⚠ resource-pulse.service: cannot read its state' <<<"$refresh_isolation_run") said=[$(restart_lines "$refresh_isolation_run")]"
refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE"
refresh_isolation_run="$(run_refresh_both_active 0 'n/a')"
refresh_failure_isolation_summary+=" cockpit-start-unparseable:${refresh_isolation_run%% output=*} warned=$(grep -c -F '⚠ resource-pulse-cockpit.service: cannot parse when it started' <<<"$refresh_isolation_run") said=[$(restart_lines "$refresh_isolation_run")]"
check "refresh: a failure deciding one unit warns in a line naming that unit, and the other is still decided and restarted" \
  "$refresh_failure_isolation_summary" \
  "sampler-state-unreadable:exit=0 calls=[$REFRESH_PREAMBLE_CALLS$SAMPLER_STATE_CALL$COCKPIT_CHECKED_CALLS$COCKPIT_RESTARTED_CALLS] warned=1 said=[$COCKPIT_ENTRY_RESTART_LINE] cockpit-start-unparseable:exit=0 calls=[$CALLS_SAMPLER_RESTARTED] warned=1 said=[$SAMPLER_PROGRAM_RESTART_LINE]"
# The look: after a try-restart that returned 0, the unit's state is read once
# more, and only active gives its ✓. Anything else (failed, activating, an empty
# answer, a read that fails though it printed active) is a ⚠ naming the unit
# and that state, and no ✓: a unit that did not come back never reads as
# restarted.
REFRESH_LOOK_VARIANTS=(active failed activating empty unreadable)
REFRESH_UNREAD_STATE_DESCRIPTION='in a state that could not be read'
# look_stub_answer <variant>: what the stub answers for the state read after the
# restart, as <state>:<exit status>.
look_stub_answer() {
  case "$1" in
    empty) printf ':0' ;;
    unreadable) printf 'active:1' ;;
    *) printf '%s:0' "$1" ;;
  esac
}
# look_described_state <variant>: the state as the look's ⚠ line names it.
look_described_state() {
  case "$1" in
    empty | unreadable) printf '%s' "$REFRESH_UNREAD_STATE_DESCRIPTION" ;;
    *) printf '%s' "$1" ;;
  esac
}
# look_warning_line <unit> <variant>: the look's ⚠ line, as warning_lines joins it.
look_warning_line() {
  local described_state
  described_state="$(look_described_state "$2")"
  printf '  ⚠ %s was restarted and is %s, not active — journalctl --user -u %s -e|' "$1" "$described_state" "$1"
}
sampler_look_summary=""
expected_sampler_look_summary=""
for look_variant in "${REFRESH_LOOK_VARIANTS[@]}"; do
  look_answer="$(look_stub_answer "$look_variant")"
  refresh_fixture_with_newer "$REFRESH_PROGRAM_FILE"
  look_run="$(REFRESH_STUB_STATE_AFTER_RESTART="${look_answer%:*}" REFRESH_STUB_STATE_AFTER_RESTART_EXIT="${look_answer##*:}" \
    run_refresh 0 0 active "$STARTED_AT" 0)"
  sampler_look_summary+="$look_variant:${look_run%% output=*} said=[$(restart_lines "$look_run")] warned=[$(warning_lines "$look_run")] "
  if [[ "$look_variant" == active ]]; then
    expected_sampler_look_summary+="$look_variant:exit=0 calls=[$CALLS_WITH_RESTART] said=[$SAMPLER_PROGRAM_RESTART_LINE] warned=[] "
  else
    expected_sampler_look_summary+="$look_variant:exit=0 calls=[$CALLS_WITH_RESTART] said=[] warned=[$(look_warning_line resource-pulse.service "$look_variant")] "
  fi
done
check "refresh: after restarting the sampler it reads its state once more: active says ✓; failed, activating, an empty answer or a failed read say ⚠ with that state, and no ✓" \
  "$sampler_look_summary" "$expected_sampler_look_summary"
cockpit_look_summary=""
expected_cockpit_look_summary=""
for look_variant in "${REFRESH_LOOK_VARIANTS[@]}"; do
  look_answer="$(look_stub_answer "$look_variant")"
  refresh_fixture_with_newer "$REFRESH_EXTENSION_DIR/service/cockpit.js"
  look_run="$(REFRESH_STUB_COCKPIT_STATE_AFTER_RESTART="${look_answer%:*}" \
    REFRESH_STUB_COCKPIT_STATE_AFTER_RESTART_EXIT="${look_answer##*:}" run_refresh_both_active)"
  cockpit_look_summary+="$look_variant:${look_run%% output=*} said=[$(restart_lines "$look_run")] warned=[$(warning_lines "$look_run")] "
  if [[ "$look_variant" == active ]]; then
    expected_cockpit_look_summary+="$look_variant:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] said=[$COCKPIT_ENTRY_RESTART_LINE] warned=[] "
  else
    expected_cockpit_look_summary+="$look_variant:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] said=[] warned=[$(look_warning_line resource-pulse-cockpit.service "$look_variant")] "
  fi
done
check "refresh: after restarting resource-pulse-cockpit.service it reads its state once more: active says ✓; failed, activating, an empty answer or a failed read say ⚠ with that state, and no ✓" \
  "$cockpit_look_summary" "$expected_cockpit_look_summary"
# A HOME that names no program (unset, empty, or not absolute, which would name
# a path under wherever the script runs; the build step refuses each too): one ⚠
# naming the sampler and why, and no restart of it, though its unit file is
# newer. The cockpit, which runs from the checkout, is still decided.
# home_warning_line <why>: that ⚠ line, as warning_lines joins it.
home_warning_line() {
  printf '  ⚠ resource-pulse.service: cannot tell where its program is installed (%s), so it was not restarted — if its code changed, run: systemctl --user try-restart resource-pulse.service|' "$1"
}
refresh_fixture_with_newer "$REFRESH_UNIT_FILE" "$REFRESH_EXTENSION_DIR/service/cockpit.js"
home_unset_run="$(unset HOME; REFRESH_RUN_PROGRAM_FILE='' run_refresh_both_active)"
home_empty_run="$(HOME='' REFRESH_RUN_PROGRAM_FILE='' run_refresh_both_active)"
home_relative_run="$(HOME="$REFRESH_RELATIVE_HOME" REFRESH_RUN_PROGRAM_FILE='' run_refresh_both_active)"
home_summary="unset:${home_unset_run%% output=*} said=[$(restart_lines "$home_unset_run")] warned=[$(warning_lines "$home_unset_run")]"
home_summary+=" empty:${home_empty_run%% output=*} said=[$(restart_lines "$home_empty_run")] warned=[$(warning_lines "$home_empty_run")]"
home_summary+=" relative:${home_relative_run%% output=*} said=[$(restart_lines "$home_relative_run")] warned=[$(warning_lines "$home_relative_run")]"
expected_home_summary="unset:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] said=[$COCKPIT_ENTRY_RESTART_LINE] warned=[$(home_warning_line 'HOME is not set')]"
expected_home_summary+=" empty:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] said=[$COCKPIT_ENTRY_RESTART_LINE] warned=[$(home_warning_line 'HOME is not set')]"
expected_home_summary+=" relative:exit=0 calls=[$CALLS_COCKPIT_RESTARTED] said=[$COCKPIT_ENTRY_RESTART_LINE] warned=[$(home_warning_line "HOME is not an absolute path ($REFRESH_RELATIVE_HOME)")]"
check "refresh: a HOME that names no program (unset, empty, relative) warns once, naming the sampler and why, restarts it not even for a newer unit file, and still decides the cockpit" \
  "$home_summary" "$expected_home_summary"
# A sampler that is not active runs no program, old or new, so a HOME that
# names none leaves nothing to decide for it: silent, as with any HOME.
refresh_fixture_with_newer "$REFRESH_UNIT_FILE"
home_inactive_summary="unset:$(unset HOME; REFRESH_RUN_PROGRAM_FILE='' run_refresh 0 0 inactive "$STARTED_AT" 0)"
home_inactive_summary+=" empty:$(HOME='' REFRESH_RUN_PROGRAM_FILE='' run_refresh 0 0 inactive "$STARTED_AT" 0)"
home_inactive_summary+=" relative:$(HOME="$REFRESH_RELATIVE_HOME" REFRESH_RUN_PROGRAM_FILE='' run_refresh 0 0 inactive "$STARTED_AT" 0)"
check "refresh: an inactive sampler with a HOME that names no program (unset, empty, relative), and a newer unit file, is left alone, silently" \
  "$home_inactive_summary" \
  "unset:exit=0 calls=[$CALLS_UP_TO_STATE] output=[] empty:exit=0 calls=[$CALLS_UP_TO_STATE] output=[] relative:exit=0 calls=[$CALLS_UP_TO_STATE] output=[]"

# This table's own total. The guide states it.
EXPECTED_ROWS=44

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
