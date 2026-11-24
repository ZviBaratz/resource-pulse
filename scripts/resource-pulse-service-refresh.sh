#!/usr/bin/env bash
#
# scripts/resource-pulse-service-refresh.sh
# =========================================
#
# The refresh step for the two Resource Pulse services, each linked into the
# user's systemd unit directory and never enabled: the sampler (systemd/resource-pulse.service,
# which the GNOME Shell extension starts on demand) and the cockpit
# (systemd/resource-pulse-cockpit.service, which systemd skips without
# ~/.config/resource-pulse/cockpit.json, or that file under $XDG_CONFIG_HOME
# when it is set). It runs after the build step
# (scripts/resource-pulse-sampler-build.sh), reloads systemd once, then
# restarts each service only when what it runs changed after it started.
#
# Why only then: a restart resets the sampler's histories (the top-bar graph
# and the card's), and most updates leave
# what the services run alone. So each unit is try-restarted only when what its
# restart follows has an mtime newer than that unit's ActiveEnterTimestamp:
#   - the sampler runs the compiled program the build step installs, at
#     ~/.local/lib/resource-pulse/resource-pulse-sampler (the unit's ExecStart),
#     so its restart follows that file. The build step installs a new program
#     by a rename, so the file's time changes exactly when its bytes do, and an
#     install that changes nothing touches nothing. A link there is read as
#     what it names, as systemd runs what it names. A program that is not there
#     (nor a link to nothing) is not newer, and is no reason to warn: none was
#     built, and the build step says why. One that may be
#     there, behind a directory that cannot be searched (on its own path, or on
#     the path a link there names), is a search that failed. No module of the
#     extension restarts the sampler: it runs none.
#   - the cockpit runs service/cockpit.js from this checkout, so its restart
#     follows that entry and every module it imports, directly or not, as
#     scripts/resource-pulse-module-closure.sh lists them. A change
#     to the drawing side (extension.js, card.js, a lib/ module only the shell
#     imports, the stylesheet) never restarts it; the shell picks that up at its
#     next login. A module the shell and the cockpit share counts for the
#     cockpit.
# Each unit's own file (systemd/<unit>) counts too, when it is newer than that
# unit's start: the daemon-reload loads it, but its [Service] settings (a cap,
# the ExecStart) apply only from the next start. For the sampler, a newer unit
# file restarts it whether or not its program is there, and when both are newer
# its one ✓ line names both.
#
# What it does, in order, and what it says; every line names its unit:
#   - no systemctl, or no reachable user manager (a server, a container, CI):
#     nothing, silently, exit 0;
#   - systemctl --user daemon-reload, once, so the linked unit files are the
#     loaded ones;
#   - then, for each unit in SERVICE_UNITS, on its own:
#     - not active (inactive, failed, activating; systemd reports a unit
#       skipped on an unmet condition, as the cockpit is without its layout
#       file, and one not linked yet, as inactive): nothing more for it,
#       silently. A stopped service stays stopped: this step never starts one;
#     - active, nothing its restart follows newer than its start: silent;
#     - active, something newer: `systemctl --user try-restart <unit>`, then the
#       look: its ActiveState read once more. Active: one ✓ line saying what
#       changed. Anything else (failed, activating, an empty answer, a read that
#       fails): a ⚠ line naming the unit and that state, and no ✓, so a unit
#       that did not come back never reads as restarted. try-restart returns
#       once the start job is done, so this catches a start that "succeeded" and
#       a service that died at once; one that dies a moment after the look reads
#       as active.
# A failure (the reload, a state or start time it cannot read, a HOME that names
# no program, modules it cannot work out, a program, modules or a unit file it
# cannot search, the restart) prints a ⚠ line on stderr naming the unit, the
# step and what to run, restarts nothing it could not decide about (a partial
# answer never decides a restart), goes on to the next unit (a reload failure
# stops both, since neither can be decided on unloaded files), and still exits
# 0. It never fails the install: under `set -e` an exit 1 here would abort the
# rest of a caller's install, for a service that at worst keeps
# running its previous code.
#
# The sampler's program is found under HOME, as the build step installs it
# (`resource-pulse-sampler-build.sh --installed-path` prints the same path). A
# HOME that is unset, empty or not an absolute path (it would name a path under
# wherever the script runs; the build step refuses one too) names no program:
# a ⚠ for the sampler, which is not restarted; the cockpit is still decided.
#
# Comparing times: a unit's start is read to the microsecond, in UTC
# (ActiveEnterTimestamp with --timestamp=us+utc, which systemd prints as
# `Mon 2026-01-05 07:54:14.270693 UTC`, systemd 248 and later), and handed
# without its day name (`2026-01-05 07:54:14.270693 UTC`) to `find -newermt`,
# which keeps only files modified strictly after that instant. systemd 259
# prints the day in English even under another language, but GNU find cannot
# read one that is not, so that word is dropped whatever it says.
# Whole seconds would not do: a deploy that rebuilds the program copies it in
# and restarts the sampler within the same second, so a start rounded down to
# its second would find that program newer, and the next deploy would restart
# the sampler again and empty its histories for nothing. A start in any other
# form (empty for a unit never started, whole seconds) cannot be read, and is
# refused before find sees it: GNU find reads an empty -newermt as the start of
# today (local midnight, as `date -d ''` prints it), so an empty start would
# make every file written today newer: a restart that empties the histories at
# each deploy that day, and the status report's false "runs an older program" ⚠.
# find is run as `command find`, so a shell function of that name (bash
# imports one exported into its environment) never answers in its place; the
# find first on PATH does, and one that cannot read this form fails, which is a
# ⚠ and no restart.
# The status report (scripts/resource-pulse-status.sh) reads
# the start and compares the installed program with it in the same way, for
# its ⚠.
#
# Test overrides: RESOURCE_PULSE_EXTENSION_DIR, the extension directory
# (default: this checkout's gnome-shell/extensions/resource-pulse@zvibaratz.github.io);
# RESOURCE_PULSE_UNIT_FILE, the sampler's unit file (default: this checkout's
# systemd/resource-pulse.service); RESOURCE_PULSE_COCKPIT_UNIT_FILE, the
# cockpit's (default: this checkout's systemd/resource-pulse-cockpit.service); and
# RESOURCE_PULSE_PROGRAM_FILE, the sampler's installed program (default:
# $HOME/.local/lib/resource-pulse/resource-pulse-sampler). An empty one is the
# default. The refresh step sets none. The state table is in
# scripts/test-resource-pulse-units.sh, against a systemctl stub.
#
# Usage: scripts/resource-pulse-service-refresh.sh

set -uo pipefail

SAMPLER_UNIT="resource-pulse.service"
COCKPIT_UNIT="resource-pulse-cockpit.service"
# What a unit's restart follows, besides its own unit file, when that is the
# program the build step installs rather than modules of this checkout.
FOLLOWS_INSTALLED_PROGRAM="installed-program"
# Each unit this step looks after, in the order it decides them, with what its
# restart follows besides its own unit file, as <unit>:<what>: the installed
# program (FOLLOWS_INSTALLED_PROGRAM) for the sampler, a compiled program; the
# entry module it runs, and so that module's import closure, for the cockpit.
# Only what a service runs decides its restart: the drawing side is the
# shell's, read at login.
SERVICE_UNITS=("$SAMPLER_UNIT:$FOLLOWS_INSTALLED_PROGRAM" "$COCKPIT_UNIT:service/cockpit.js")
ACTIVE_STATE="active"
# How a unit's start is asked for, and the one form of the answer it reads:
# systemd's ActiveEnterTimestamp to the microsecond, in UTC, after a day name
# in any language (see "Comparing times" above; probed on systemd 259).
# Anything else cannot be read.
START_TIME_FORMAT_OPTION="--timestamp=us+utc"
START_TIME_PATTERN='^[^ ]+ [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6} UTC$'
# Pure bash, no dirname: the script must run with no tool on PATH at all, as in a
# container, where it has nothing to do and must say nothing.
SCRIPT_PATH="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_PATH" == */* ]]; then
  SCRIPT_DIRECTORY="${SCRIPT_PATH%/*}"
else
  SCRIPT_DIRECTORY="."
fi
DEFAULT_EXTENSION_DIR="$SCRIPT_DIRECTORY/../gnome-shell/extensions/resource-pulse@zvibaratz.github.io"
EXTENSION_DIR="${RESOURCE_PULSE_EXTENSION_DIR:-$DEFAULT_EXTENSION_DIR}"
MODULE_CLOSURE_SCRIPT="$SCRIPT_DIRECTORY/resource-pulse-module-closure.sh"
DEFAULT_UNIT_DIRECTORY="$SCRIPT_DIRECTORY/../systemd"
# Where the build step installs the sampler's program, relative to HOME: the
# path its --installed-path prints, and the unit's ExecStart under %h.
INSTALLED_PROGRAM_RELATIVE_PATH=".local/lib/resource-pulse/resource-pulse-sampler"
# The test overrides of a unit's own file; an empty or absent one means the
# checkout's systemd/<unit>.
declare -A UNIT_FILE_OVERRIDES=(
  ["$SAMPLER_UNIT"]="${RESOURCE_PULSE_UNIT_FILE:-}"
  ["$COCKPIT_UNIT"]="${RESOURCE_PULSE_COCKPIT_UNIT_FILE:-}"
)
# What a restart costs, said on its ✓ line: only the sampler keeps histories.
declare -A RESTART_NOTES=(
  ["$SAMPLER_UNIT"]=" (its histories start again)"
)
# How the ✓ line names a changed unit file, a changed program, and both.
UNIT_FILE_LABEL="its unit file"
PROGRAM_LABEL="its program"
PROGRAM_AND_UNIT_FILE_LABEL="$PROGRAM_LABEL and $UNIT_FILE_LABEL"
# How the look's ⚠ line names a state systemctl did not give (an empty answer,
# or a read that failed).
UNREAD_STATE_DESCRIPTION="in a state that could not be read"
# What a ⚠ line suggests, after the unit's name, when a restart was not decided.
MANUAL_RESTART_HINT="if its code changed, run: systemctl --user try-restart"
# The sampler's installed program, set by locate_installed_program_file: its
# path, or, when HOME names none, why not.
INSTALLED_PROGRAM_FILE=""
INSTALLED_PROGRAM_PROBLEM=""

# warn_line <text>: one ⚠ line on stderr.
warn_line() {
  printf '  ⚠ %s\n' "$*" >&2
}

# warn <unit or units> <message>: one ⚠ line on stderr, "<unit or units>: <message>".
warn() {
  local warned_about="$1"
  shift
  warn_line "$warned_about: $*"
}

# have_user_manager: systemctl exists and a systemd user manager answers it.
have_user_manager() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

# unit_property <unit> <property>: one property of the unit, its value only.
unit_property() {
  systemctl --user show "$1" -p "$2" --value
}

# unit_started_at <unit>: the unit's ActiveEnterTimestamp to the microsecond,
# in UTC, as systemd prints it but without its day name, which is how find
# -newermt reads it; fails (printing nothing) when it cannot be read in that
# form (START_TIME_PATTERN).
unit_started_at() {
  local started_at
  started_at="$(systemctl --user show "$1" -p ActiveEnterTimestamp --value "$START_TIME_FORMAT_OPTION")" || return 1
  [[ "$started_at" =~ $START_TIME_PATTERN ]] || return 1
  printf '%s\n' "${started_at#* }"
}

# locate_installed_program_file: sets INSTALLED_PROGRAM_FILE to the sampler's
# installed program: RESOURCE_PULSE_PROGRAM_FILE when it is set, else
# INSTALLED_PROGRAM_RELATIVE_PATH under HOME. When HOME is unset, empty or not
# an absolute path, leaves it empty and sets INSTALLED_PROGRAM_PROBLEM, in the
# build step's words.
locate_installed_program_file() {
  local home_as_given="${HOME:-}"
  if [[ -n "${RESOURCE_PULSE_PROGRAM_FILE:-}" ]]; then
    INSTALLED_PROGRAM_FILE="$RESOURCE_PULSE_PROGRAM_FILE"
  elif [[ -z "$home_as_given" ]]; then
    INSTALLED_PROGRAM_PROBLEM="HOME is not set"
  elif [[ "$home_as_given" != /* ]]; then
    INSTALLED_PROGRAM_PROBLEM="HOME is not an absolute path ($home_as_given)"
  else
    INSTALLED_PROGRAM_FILE="$home_as_given/$INSTALLED_PROGRAM_RELATIVE_PATH"
  fi
}

# service_module_list <entry module>: the modules a service runs, one per line,
# relative to EXTENSION_DIR: its entry and what that imports, from the closure
# helper (run by this same bash). Fails, with nothing on stdout, when the helper
# cannot say; its reason goes straight to this script's stderr.
service_module_list() {
  "$BASH" "$MODULE_CLOSURE_SCRIPT" "$EXTENSION_DIR" "$1"
}

# paths_changed_since <start> <path>...: prints each of those paths modified
# after that start (unit_started_at's form), one per line, in the order given;
# nothing when none was. Fails when any of them cannot be searched, whatever it
# found in the others. find's stderr goes straight to this script's stderr,
# never into the list, so a warning from find can never pass for a changed file.
paths_changed_since() {
  local started_at="$1"
  shift
  command find "$@" -maxdepth 0 -type f -newermt "$started_at"
}

# absence_is_certain <path>: succeeds when a path that tests as not there truly
# is not: the deepest of the directories on its way that exists can be
# searched (or is no directory at all), so the test failed on a name that is
# not there, never on a permission. A path with no directory part has nothing
# to look in, and fails.
absence_is_certain() {
  local deepest_existing_ancestor="$1"
  while [[ "$deepest_existing_ancestor" == */* && "$deepest_existing_ancestor" != / ]]; do
    deepest_existing_ancestor="${deepest_existing_ancestor%/*}"
    # The directory of /<name> is /.
    deepest_existing_ancestor="${deepest_existing_ancestor:-/}"
    [[ ! -e "$deepest_existing_ancestor" ]] || break
  done
  [[ -e "$deepest_existing_ancestor" && ( ! -d "$deepest_existing_ancestor" || -x "$deepest_existing_ancestor" ) ]]
}

# installed_program_changed_since <start> <program file>: the comparison "the
# installed program is newer than the unit's start" (unit_started_at's form).
# Prints the program file when it was modified after that start; prints nothing
# when it was not, or when it is not there (a program never installed is not
# newer). A link is read as what it names, as systemd runs what it names: a
# link to nothing is not there. Fails when whether it is there, or its time,
# cannot be read, through a link too. find's stderr goes straight to this
# script's stderr, as in paths_changed_since.
installed_program_changed_since() {
  local started_at="$1" program_file="$2"
  # A link is left to find -H, which reads one to nothing as the link itself (so
  # not there), and fails when what it names cannot be examined (behind a
  # directory that cannot be searched, a loop): absence_is_certain looks at the
  # directories on the path it is given, never at those on a link's target.
  if [[ ! -e "$program_file" && ! -L "$program_file" ]]; then
    absence_is_certain "$program_file"
    return
  fi
  command find -H "$program_file" -maxdepth 0 -type f -newermt "$started_at"
}

# program_or_unit_file_change <unit> <start> <unit file>: what changed after
# that start of a unit that runs the installed program, as its ✓ line names
# it: its program, its unit file, both, or nothing (no output). Warns, naming
# the unit, and fails when it cannot tell: HOME names no program, or the
# program or the unit file cannot be searched.
program_or_unit_file_change() {
  local unit="$1" started_at="$2" unit_file="$3" program_change unit_file_change
  if [[ -z "$INSTALLED_PROGRAM_FILE" ]]; then
    warn "$unit" "cannot tell where its program is installed ($INSTALLED_PROGRAM_PROBLEM), so it was not restarted — $MANUAL_RESTART_HINT $unit"
    return 1
  fi
  if ! program_change="$(installed_program_changed_since "$started_at" "$INSTALLED_PROGRAM_FILE")" \
    || ! unit_file_change="$(paths_changed_since "$started_at" "$unit_file")"; then
    warn "$unit" "cannot search its program $INSTALLED_PROGRAM_FILE, or its unit file $unit_file, so it was not restarted — $MANUAL_RESTART_HINT $unit"
    return 1
  fi
  if [[ -n "$program_change" && -n "$unit_file_change" ]]; then
    printf '%s\n' "$PROGRAM_AND_UNIT_FILE_LABEL"
  elif [[ -n "$program_change" ]]; then
    printf '%s\n' "$PROGRAM_LABEL"
  elif [[ -n "$unit_file_change" ]]; then
    printf '%s\n' "$UNIT_FILE_LABEL"
  fi
}

# module_or_unit_file_change <unit> <start> <entry module> <unit file>: what
# changed after that start of a unit that runs that entry module, as its ✓
# line names it: the first module of the entry's import closure so modified
# (relative to EXTENSION_DIR), else its unit file, else nothing (no output).
# Warns, naming the unit, and fails when it cannot tell: the modules it runs
# cannot be worked out, or they or the unit file cannot be searched.
module_or_unit_file_change() {
  local unit="$1" started_at="$2" entry_module="$3" unit_file="$4"
  local module_list module_path changed_paths first_changed_path
  local -a watched_paths=()
  if ! module_list="$(service_module_list "$entry_module")"; then
    warn "$unit" "cannot work out which modules it runs ($entry_module and what it imports, under $EXTENSION_DIR), so it was not restarted — $MANUAL_RESTART_HINT $unit"
    return 1
  fi
  while IFS= read -r module_path; do
    watched_paths+=("$EXTENSION_DIR/$module_path")
  done <<<"$module_list"
  watched_paths+=("$unit_file")
  if ! changed_paths="$(paths_changed_since "$started_at" "${watched_paths[@]}")"; then
    warn "$unit" "cannot search the modules it runs under $EXTENSION_DIR, or its unit file $unit_file, so it was not restarted — $MANUAL_RESTART_HINT $unit"
    return 1
  fi
  first_changed_path="${changed_paths%%$'\n'*}"
  if [[ -z "$first_changed_path" ]]; then
    return 0
  elif [[ "$first_changed_path" == "$unit_file" ]]; then
    printf '%s\n' "$UNIT_FILE_LABEL"
  else
    printf '%s\n' "${first_changed_path#"$EXTENSION_DIR"/}"
  fi
}

# restart_and_look <unit> <what changed>: try-restarts the unit, then looks: its
# ActiveState, read once more. The ✓ line, saying what changed, only when that
# is active; any other state, an empty answer or a failed read is a ⚠ naming
# the state, and no ✓. A failed try-restart warns and looks no further. Returns
# 0 either way: see the header.
restart_and_look() {
  local unit="$1" what_changed="$2" state_after_restart
  local journal_hint="journalctl --user -u $unit -e"
  if ! systemctl --user try-restart "$unit"; then
    warn "$unit" "try-restart failed — $journal_hint"
    return 0
  fi
  if ! state_after_restart="$(unit_property "$unit" ActiveState)" || [[ -z "$state_after_restart" ]]; then
    state_after_restart="$UNREAD_STATE_DESCRIPTION"
  fi
  if [[ "$state_after_restart" != "$ACTIVE_STATE" ]]; then
    warn_line "$unit was restarted and is $state_after_restart, not active — $journal_hint"
    return 0
  fi
  printf '  ✓ %s restarted: %s changed since it started%s\n' "$unit" "$what_changed" "${RESTART_NOTES[$unit]:-}"
}

# refresh_unit <unit> <what its restart follows>: the decision for one unit,
# after the reload: try-restart it, and look, when it is active and what its
# restart follows (FOLLOWS_INSTALLED_PROGRAM, or an entry module), or its unit
# file, changed after it started. Every failure warns, naming the unit, and
# returns 0: see the header.
refresh_unit() {
  local unit="$1" restart_follows="$2" unit_file="${UNIT_FILE_OVERRIDES[$1]:-$DEFAULT_UNIT_DIRECTORY/$1}"
  local active_state started_at what_changed

  if ! active_state="$(unit_property "$unit" ActiveState)"; then
    warn "$unit" "cannot read its state (ActiveState), so it was not checked — run: systemctl --user status $unit"
    return 0
  fi
  # Inactive covers a unit skipped on an unmet condition: it is not running, so
  # it runs no old code, and only its own starter may start it.
  [[ "$active_state" == "$ACTIVE_STATE" ]] || return 0

  if ! started_at="$(unit_started_at "$unit")"; then
    warn "$unit" "cannot parse when it started (ActiveEnterTimestamp), so it was not restarted — $MANUAL_RESTART_HINT $unit"
    return 0
  fi
  if [[ "$restart_follows" == "$FOLLOWS_INSTALLED_PROGRAM" ]]; then
    what_changed="$(program_or_unit_file_change "$unit" "$started_at" "$unit_file")" || return 0
  else
    what_changed="$(module_or_unit_file_change "$unit" "$started_at" "$restart_follows" "$unit_file")" || return 0
  fi
  [[ -n "$what_changed" ]] || return 0

  restart_and_look "$unit" "$what_changed"
}

main() {
  local unit_and_follows all_units=""

  # A server, a container and a CI runner legitimately have none.
  have_user_manager || return 0

  for unit_and_follows in "${SERVICE_UNITS[@]}"; do
    all_units+="${all_units:+, }${unit_and_follows%%:*}"
  done
  # One reload for every unit; when it fails, none can be decided. See the header.
  if ! systemctl --user daemon-reload >/dev/null 2>&1; then
    warn "$all_units" "daemon-reload failed, so they were not checked — run: systemctl --user daemon-reload"
    return 0
  fi

  locate_installed_program_file
  for unit_and_follows in "${SERVICE_UNITS[@]}"; do
    refresh_unit "${unit_and_follows%%:*}" "${unit_and_follows#*:}"
  done
}

main "$@"
