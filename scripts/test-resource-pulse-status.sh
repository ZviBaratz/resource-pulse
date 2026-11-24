#!/usr/bin/env bash
#
# scripts/test-resource-pulse-status.sh
# =====================================
#
# State table for the status script, scripts/resource-pulse-status.sh: the
# extension's state as the shell reports it, the sampler's program and the cockpit service's questions, all
# against gsettings, gnome-extensions and gnome-shell stubs, never the live
# session or its settings.
#
# "Could not run" is exit 2, never a pass: a missing or non-executable status
# script, a missing find, rg, gjs, setsid or timeout, a run of the status script
# that does not exit 0 with its three fixed lines, or that prints a bash
# diagnostic (a report cut short would pass every row that asserts an absence),
# or a run as root (a row needs a directory it cannot search, and root ignores
# directory permissions) is fatal. The table asserts its own row total. Its
# shared helpers and constants (the row helpers, the exit trap, the barrier, the
# stub installer) are scripts/resource-pulse-table-lib.sh's; the stateful
# gsettings stub is its own, since only its rows use it.
#
# Requires: bash, find, rg (ripgrep), gjs (rows have
# GLib print a reply as gdbus would), util-linux's setsid (the Ctrl-C row) and
# coreutils' timeout (the usage row's bound). No network, no root.
#
# Usage: scripts/test-resource-pulse-status.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
source "$TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
start_table
# The stateful gsettings stub's source: values under $STUB_STATE/<schema>/<key>, every call logged to $STUB_CALLS,
# the session bus it was given to $STUB_BUS_SEEN and the GIO_MODULE_DIR it was given to $STUB_GIO_MODULE_DIR_SEEN. Only
# the status script's rows use it: its state and its logs are laid out here, right after start_table, and the status
# script's section installs it.
SHELL_SCHEMA="org.gnome.shell"
ENABLED_EXTENSIONS_GSETTINGS_STUB="$(cat <<'STUB'
#!/usr/bin/env bash
# Stateful gsettings stand-in: get/set/list-schemas over files under $STUB_STATE.
# Every call is logged to $STUB_CALLS, so a row can prove the stub was the one used,
# the session bus it was given to $STUB_BUS_SEEN, so a row can prove the barrier held,
# and the GIO_MODULE_DIR it was given to $STUB_GIO_MODULE_DIR_SEEN, so a row can prove it never got one.
printf '%s\n' "$*" >>"$STUB_CALLS"
printf '%s\n' "${DBUS_SESSION_BUS_ADDRESS-unset}" >>"$STUB_BUS_SEEN"
printf '%s\n' "${GIO_MODULE_DIR-unset}" >>"$STUB_GIO_MODULE_DIR_SEEN"
case "$1" in
  list-schemas) cat "$STUB_STATE/schemas" 2>/dev/null ;;
  get)
    if [[ -f "$STUB_STATE/$2/$3" ]]; then cat "$STUB_STATE/$2/$3"
    else
      case "$3" in
        *-extensions)                 echo '@as []' ;;
        disable-user-extensions)      echo 'false' ;;
        allow-extension-installation) echo 'true' ;;
        *)                            echo "''" ;;
      esac
    fi ;;
  set) mkdir -p "$STUB_STATE/$2" && printf '%s\n' "$4" >"$STUB_STATE/$2/$3" ;;
  *) exit 1 ;;
esac
STUB
)"
STUB_STATE="$WIRING_TMP/gsettings"
mkdir -p "$STUB_STATE" || fatal "cannot create the gsettings stub directory"
STUB_CALLS_LOG="$WIRING_TMP/stub-calls"
STUB_BUS_SEEN_LOG="$WIRING_TMP/stub-bus-seen"
STUB_GIO_MODULE_DIR_SEEN_LOG="$WIRING_TMP/stub-gio-module-dir-seen"

[[ -d "$EXT_DIR" ]] || fatal "no extension directory at $EXT_DIR"
require_tools find rg gjs setsid timeout
# The table's subject, which every row runs with bash: a row that asserts an absence would pass on one not there.
STATUS_SCRIPT="$REPO_ROOT/scripts/resource-pulse-status.sh"
[[ -f "$STATUS_SCRIPT" && -x "$STATUS_SCRIPT" ]] || fatal "no executable status script at $STATUS_SCRIPT"
# How every run below starts the status script, with no argument (a row that gives one adds it after). The script's
# path is the command's last word, so a row can replace it.
STATUS_SCRIPT_COMMAND=(bash "$STATUS_SCRIPT")

printf '\nthe status script (bash, with gsettings, gnome-extensions and gnome-shell stubs)\n'
# The status script (scripts/resource-pulse-status.sh) reads gsettings and asks the shell,
# through gnome-extensions, for the extension's State. With the user extension
# dir skipped the shell does not know the extension at all, so the stub answers
# like the real tool does then: nothing listed, and info fails.
STATUS_REPORT_STUB_BIN="$WIRING_TMP/status-report-bin"
STATUS_REPORT_HOME="$WIRING_TMP/status-report-home"
mkdir -p "$STATUS_REPORT_HOME" || fatal "cannot create the status script's fixture home"
install_stub "$STATUS_REPORT_STUB_BIN" gsettings "$ENABLED_EXTENSIONS_GSETTINGS_STUB"
# shellcheck disable=SC2016  # The stub's own source: its variables expand when it runs.
install_stub "$STATUS_REPORT_STUB_BIN" gnome-extensions '#!/usr/bin/env bash
# STATUS_REPORT_SHELL_STATE is the State the shell reports; empty means the shell does not know the extension.
[[ -n "$STATUS_REPORT_SHELL_STATE" ]] || { [[ "$1" == list ]] && exit 0; echo "Extension does not exist" >&2; exit 2; }
case "$1" in
  list) echo resource-pulse@zvibaratz.github.io ;;
  info) printf "resource-pulse@zvibaratz.github.io\n  State: %s\n" "$STATUS_REPORT_SHELL_STATE" ;;
esac'
install_stub "$STATUS_REPORT_STUB_BIN" gnome-shell '#!/usr/bin/env bash
echo "GNOME Shell 50.1"'
# gnome_status_hints <enabled-extensions> <allow-extension-installation> <disable-user-extensions> <State or ''>
# prints how many lines name each setting, and the status script's exit status.
gnome_status_hints() {
  local status_output status_exit
  rm -rf "${STUB_STATE:?}"/*
  mkdir -p "$STUB_STATE/$SHELL_SCHEMA"
  printf '%s\n' "$1" >"$STUB_STATE/$SHELL_SCHEMA/enabled-extensions"
  printf '%s\n' "$2" >"$STUB_STATE/$SHELL_SCHEMA/allow-extension-installation"
  printf '%s\n' "$3" >"$STUB_STATE/$SHELL_SCHEMA/disable-user-extensions"
  # XDG_CONFIG_HOME pinned empty, and BASH_ENV and RESOURCE_PULSE_ROOT unset, as in status_report_run below.
  status_output="$(env -u BASH_ENV -u RESOURCE_PULSE_ROOT "${LIVE_SETTINGS_BARRIER[@]}" HOME="$STATUS_REPORT_HOME" XDG_CONFIG_HOME= \
    PATH="$STATUS_REPORT_STUB_BIN:$PATH" STUB_STATE="$STUB_STATE" STUB_CALLS="$STUB_CALLS_LOG" STUB_BUS_SEEN="$STUB_BUS_SEEN_LOG" \
    STUB_GIO_MODULE_DIR_SEEN="$STUB_GIO_MODULE_DIR_SEEN_LOG" STATUS_REPORT_SHELL_STATE="$4" "${STATUS_SCRIPT_COMMAND[@]}" 2>&1)"
  status_exit=$?
  printf '%s/%s/rc%s' "$(grep -c -F 'allow-extension-installation is false' <<<"$status_output")" \
    "$(grep -c -F 'disable-user-extensions is true' <<<"$status_output")" "$status_exit"
}
asked_for="['$EXTENSION_UUID']"
gnome_status_summary="installation-off=$(gnome_status_hints "$asked_for" false false '')"
gnome_status_summary+=" user-extensions-off=$(gnome_status_hints "$asked_for" true true '')"
gnome_status_summary+=" running=$(gnome_status_hints "$asked_for" false true ACTIVE)"
gnome_status_summary+=" not-asked-for=$(gnome_status_hints '@as []' false true '')"
check "the status script names the setting that keeps an enabled Resource Pulse from loading, and only then" \
  "$gnome_status_summary" "installation-off=1/0/rc0 user-extensions-off=0/1/rc0 running=0/0/rc0 not-asked-for=0/0/rc0"

# The service half of the status script: systemctl, gdbus, pgrep and date are stubs too.
# Each answers from STATUS_REPORT_* variables and logs its call to
# STATUS_REPORT_CALLS; systemctl answers only the properties the status script reads
# (in systemd's own order, measured: LoadState, ActiveState, SubState,
# ConditionResult, whatever order -p names them), or hangs, fails a start's
# call or answers the sampler's state late, as STATUS_REPORT_SYSTEMCTL_MODE says; gdbus answers
# GetState in its own text form, ('<json>',), or a given reply word for word;
# and date answers `+%s%N` with a fixed now (anything else goes to the real
# date). The cockpit unit answers from STATUS_REPORT_COCKPIT_* variables, and
# unset it is skipped, as for anyone without its config file: loaded, inactive,
# ConditionResult=no. A unit's start is asked with --timestamp=us+utc and
# answered as STATUS_REPORT_SERVICE_STARTED_AT / STATUS_REPORT_COCKPIT_STARTED_AT
# give it, which rows build with unit_timestamp_us_utc (the form systemd prints);
# a --timestamp=unix call is unexpected.
STATUS_REPORT_CALLS="$WIRING_TMP/status-report-calls"
REAL_DATE_PATH="$(command -v date)" || fatal "date is required"
# How long a stand-in that never answers sleeps: systemctl, gdbus, the installed program and the build script, each in
# its hang mode. Every bound a row holds a run to stays under it (checked where the status script's bounds are copied
# below), so a call left unbounded still fails its row. A stand-in's source names it as STAND_IN_HANG_PLACEHOLDER.
STATUS_STAND_IN_HANG_SECONDS=30
STAND_IN_HANG_PLACEHOLDER='@STAND_IN_HANG_SECONDS@'
# fill_stand_in_hang <variable>: replaces STAND_IN_HANG_PLACEHOLDER in the stand-in source the variable holds with
# STATUS_STAND_IN_HANG_SECONDS, and exits 2 when it holds none (a source with no hang to fill is not the one meant).
fill_stand_in_hang() {
  local -n stand_in_source="$1"
  [[ "$stand_in_source" == *"$STAND_IN_HANG_PLACEHOLDER"* ]] || fatal "$1 holds no $STAND_IN_HANG_PLACEHOLDER to fill"
  stand_in_source="${stand_in_source//"$STAND_IN_HANG_PLACEHOLDER"/$STATUS_STAND_IN_HANG_SECONDS}"
}
STATUS_REPORT_SYSTEMCTL_STUB="$(cat <<'STUB'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >>"${STATUS_REPORT_CALLS:-/dev/null}"
[[ "${STATUS_REPORT_SYSTEMCTL_MODE:-}" != hang ]] || exec sleep @STAND_IN_HANG_SECONDS@
[[ "${STATUS_REPORT_SYSTEMCTL_MODE:-}" != hang-on-start-time || "$*" != *ActiveEnterTimestamp* ]] || exec sleep @STAND_IN_HANG_SECONDS@
# A manager that cannot be asked fails a start's call with a message and status 1, as systemctl does.
if [[ "${STATUS_REPORT_SYSTEMCTL_MODE:-}" == fail-on-start-time && "$*" == *ActiveEnterTimestamp* ]]; then
  echo "Failed to get properties: Connection timed out" >&2
  exit 1
fi
# A busy manager answers the sampler's state call STATUS_REPORT_SYSTEMCTL_LATE_SECONDS late.
if [[ "${STATUS_REPORT_SYSTEMCTL_MODE:-}" == late-state-answer \
  && "$*" == "--user show -p LoadState -p ActiveState -p SubState resource-pulse.service" ]]; then
  sleep "${STATUS_REPORT_SYSTEMCTL_LATE_SECONDS:?}"
fi
# default_sub_state <ActiveState>: the SubState systemd shows beside it.
default_sub_state() {
  case "$1" in
    active) echo running ;;
    failed) echo failed ;;
    activating) echo start ;;
    *) echo dead ;;
  esac
}
# default_condition_result <ActiveState>: no while inactive (skipped, or never
# started: systemd's default before any check), yes once a start got past it.
default_condition_result() {
  if [[ "$1" == inactive ]]; then echo no; else echo yes; fi
}
active_state="${STATUS_REPORT_SERVICE_ACTIVE_STATE-inactive}"
cockpit_active_state="${STATUS_REPORT_COCKPIT_ACTIVE_STATE-inactive}"
case "$*" in
  "--user show -p LoadState -p ActiveState -p SubState resource-pulse.service")
    [[ -z "${STATUS_REPORT_NO_MANAGER:-}" ]] || { echo "Failed to connect to user scope bus" >&2; exit 1; }
    printf 'LoadState=%s\nActiveState=%s\nSubState=%s\n' "${STATUS_REPORT_SERVICE_LOAD_STATE:-loaded}" \
      "$active_state" "${STATUS_REPORT_SERVICE_SUB_STATE:-$(default_sub_state "$active_state")}" ;;
  "--user show -p ActiveEnterTimestamp --value --timestamp=us+utc resource-pulse.service")
    printf '%s\n' "${STATUS_REPORT_SERVICE_STARTED_AT-}" ;;
  "--user show -p FragmentPath --value resource-pulse.service")
    printf '%s\n' "${STATUS_REPORT_SERVICE_UNIT_FILE-}" ;;
  "--user show -p FragmentPath --value resource-pulse-cockpit.service")
    printf '%s\n' "${STATUS_REPORT_COCKPIT_UNIT_FILE-}" ;;
  "--user show -p LoadState -p ActiveState -p SubState -p ConditionResult resource-pulse-cockpit.service")
    [[ -z "${STATUS_REPORT_NO_MANAGER:-}" ]] || { echo "Failed to connect to user scope bus" >&2; exit 1; }
    printf 'LoadState=%s\nActiveState=%s\nSubState=%s\nConditionResult=%s\n' "${STATUS_REPORT_COCKPIT_LOAD_STATE:-loaded}" \
      "$cockpit_active_state" "${STATUS_REPORT_COCKPIT_SUB_STATE:-$(default_sub_state "$cockpit_active_state")}" \
      "${STATUS_REPORT_COCKPIT_CONDITION_RESULT:-$(default_condition_result "$cockpit_active_state")}" ;;
  "--user show -p ActiveEnterTimestamp --value --timestamp=us+utc resource-pulse-cockpit.service")
    printf '%s\n' "${STATUS_REPORT_COCKPIT_STARTED_AT-}" ;;
  *) printf 'unexpected systemctl call: %s\n' "$*" >&2; exit 64 ;;
esac
STUB
)"
fill_stand_in_hang STATUS_REPORT_SYSTEMCTL_STUB
install_stub "$STATUS_REPORT_STUB_BIN" systemctl "$STATUS_REPORT_SYSTEMCTL_STUB"
STATUS_REPORT_GDBUS_STUB="$(cat <<'STUB'
#!/usr/bin/env bash
# answer: GetState's JSON as gdbus prints it when no string holds an apostrophe
# or a backslash; verbatim: the given reply as it is; hang: never answers;
# anything else: no owner. The sampler's call answers from STATUS_REPORT_GDBUS_MODE,
# STATUS_REPORT_STATE_JSON and STATUS_REPORT_GDBUS_REPLY, the cockpit's (its
# --dest) from the STATUS_REPORT_COCKPIT_ variables of the same names.
printf 'gdbus %s\n' "$*" >>"${STATUS_REPORT_CALLS:-/dev/null}"
gdbus_mode="${STATUS_REPORT_GDBUS_MODE:-fail}"
state_json="${STATUS_REPORT_STATE_JSON-}"
verbatim_reply="${STATUS_REPORT_GDBUS_REPLY-}"
if [[ " $* " == *" --dest io.github.zvibaratz.ResourcePulse.Cockpit1 "* ]]; then
  gdbus_mode="${STATUS_REPORT_COCKPIT_GDBUS_MODE:-fail}"
  state_json="${STATUS_REPORT_COCKPIT_STATE_JSON-}"
  verbatim_reply="${STATUS_REPORT_COCKPIT_GDBUS_REPLY-}"
fi
case "$gdbus_mode" in
  answer) printf "('%s',)\n" "$state_json" ;;
  verbatim) printf '%s\n' "$verbatim_reply" ;;
  hang) exec sleep @STAND_IN_HANG_SECONDS@ ;;
  *) echo "Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name is not activatable" >&2; exit 1 ;;
esac
STUB
)"
fill_stand_in_hang STATUS_REPORT_GDBUS_STUB
install_stub "$STATUS_REPORT_STUB_BIN" gdbus "$STATUS_REPORT_GDBUS_STUB"
STATUS_REPORT_PGREP_STUB="$(cat <<'STUB'
#!/usr/bin/env bash
printf 'pgrep %s\n' "$*" >>"${STATUS_REPORT_CALLS:-/dev/null}"
[[ -n "${STATUS_REPORT_SHELL_PID:-}" ]] || exit 1
printf '%s\n' "$STATUS_REPORT_SHELL_PID"
STUB
)"
install_stub "$STATUS_REPORT_STUB_BIN" pgrep "$STATUS_REPORT_PGREP_STUB"
# shellcheck disable=SC2016  # The stub's own source: its variables expand when it runs.
install_stub "$STATUS_REPORT_STUB_BIN" date "$(printf '#!/usr/bin/env bash\nif [[ "$1" == "+%%s%%N" && -n "${STATUS_REPORT_NOW_NSEC:-}" ]]; then\n  printf "%%s\\n" "$STATUS_REPORT_NOW_NSEC"\n  exit 0\nfi\nexec %q "$@"' "$REAL_DATE_PATH")"

# suite_started_at_epoch: this suite's own start, in whole seconds since the
# epoch (/proc/stat btime + stat field 22 / CLK_TCK), read here independently of
# the status script. The suite's own pid stands in for the desktop's gnome-shell.
suite_started_at_epoch() {
  local stat_line boot_epoch="" ticks_per_second key value _rest
  local -a stat_fields
  read -r stat_line <"/proc/$$/stat" || return 1
  read -r -a stat_fields <<<"${stat_line##*) }"
  while read -r key value _rest; do
    [[ "$key" == btime ]] && boot_epoch="$value"
  done </proc/stat
  ticks_per_second="$(getconf CLK_TCK)" || return 1
  [[ "$boot_epoch" =~ ^[0-9]+$ && "${stat_fields[19]:-}" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$(( boot_epoch + stat_fields[19] / ticks_per_second ))"
}
SUITE_STARTED_AT_EPOCH="$(suite_started_at_epoch)" || fatal "cannot read this suite's own start time from /proc"
# Two seconds either side of it, so whole-second rounding can never decide a row.
BEFORE_SHELL_START_EPOCH=$((SUITE_STARTED_AT_EPOCH - 2))
AFTER_SHELL_START_EPOCH=$((SUITE_STARTED_AT_EPOCH + 2))
SERVICE_STARTED_LONG_AFTER_EPOCH=$((SUITE_STARTED_AT_EPOCH + 1000))

# A home where the extension is linked (a symlink, as linking it makes it) to a
# fixture extension whose files carry chosen mtimes.
STATUS_REPORT_LINKED_HOME="$WIRING_TMP/status-report-linked-home"
STATUS_EXTENSION_DIR="$WIRING_TMP/status-report-extension"
mkdir -p "$STATUS_REPORT_LINKED_HOME/.local/share/gnome-shell/extensions" \
  || fatal "cannot create the status script's linked fixture home"
ln -s "$STATUS_EXTENSION_DIR" "$STATUS_REPORT_LINKED_HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID" \
  || fatal "cannot link the status script's fixture extension"
# write_sampler_stand_in <file> <what it prints for --source-hash: a hash, nothing, or hang>
write_sampler_stand_in() {
  local stand_in_file="$1" answer="$2" hash_command
  case "$answer" in
    nothing) hash_command='exit 0' ;;
    hang) hash_command="exec sleep $STATUS_STAND_IN_HANG_SECONDS" ;;
    *) hash_command="echo $answer; exit 0" ;;
  esac
  mkdir -p "${stand_in_file%/*}" || fatal "cannot create ${stand_in_file%/*}"
  # shellcheck disable=SC2016  # The stand-in's own $1 must stay literal.
  printf '#!%s\nif [[ "$1" == --source-hash ]]; then %s; fi\nexit 2\n' "$BASH" "$hash_command" >"$stand_in_file" \
    || fatal "cannot write the sampler stand-in $stand_in_file"
  chmod +x "$stand_in_file" || fatal "cannot make the sampler stand-in $stand_in_file executable"
}
SAMPLER_STATUS_OTHER_HASH="$(printf '%064d' 7)"
# The linked home holds the sampler's program too, as a home does once the build script has run: a stand-in that
# answers --source-hash with this checkout's hash, older than any start, so --check says current and a row over this
# home counts no ⚠ about the program. That hash is read from --check itself, over a stand-in answering another first.
LINKED_HOME_PROGRAM_FILE="$STATUS_REPORT_LINKED_HOME/.local/lib/resource-pulse/resource-pulse-sampler"
write_sampler_stand_in "$LINKED_HOME_PROGRAM_FILE" "$SAMPLER_STATUS_OTHER_HASH"
CHECKOUT_REPORT="$(env HOME="$STATUS_REPORT_LINKED_HOME" bash "$REPO_ROOT/scripts/resource-pulse-sampler-build.sh" --check 2>&1)"
[[ "$CHECKOUT_REPORT" =~ checkout\ hash\ ([0-9a-f]{64}) ]] \
  || fatal "cannot read the checkout's source hash from the build script's --check: $CHECKOUT_REPORT"
SAMPLER_STATUS_CHECKOUT_HASH="${BASH_REMATCH[1]}"
write_sampler_stand_in "$LINKED_HOME_PROGRAM_FILE" "$SAMPLER_STATUS_CHECKOUT_HASH"
touch -d "@$BEFORE_SHELL_START_EPOCH" "$LINKED_HOME_PROGRAM_FILE" || fatal "touch -d failed"
# reset_status_extension <card.js mtime> <lib/format.js mtime> <service/cockpit.js mtime>
# [<stylesheet.css mtime>] (epoch seconds); extension.js, metadata.json and the
# other modules are always older than the shell, and the stylesheet is too
# unless given. The modules import one another as the real ones do, in small:
# extension.js imports card.js (which imports lib/format.js), lib/visibility.js,
# lib/protocol.js and lib/cockpitProtocol.js; service/cockpit.js imports
# lib/cockpitProtocol.js, lib/sessions.js and service/fileIo.js. So
# lib/format.js, lib/visibility.js and lib/protocol.js are the shell's alone,
# lib/sessions.js and service/fileIo.js the cockpit's alone, and
# lib/cockpitProtocol.js both sides'. The sampler runs none of them: it is a
# compiled program.
reset_status_extension() {
  local stylesheet_mtime="${4:-$BEFORE_SHELL_START_EPOCH}"
  rm -rf "$STATUS_EXTENSION_DIR"
  mkdir -p "$STATUS_EXTENSION_DIR/lib" "$STATUS_EXTENSION_DIR/service" || fatal "cannot create $STATUS_EXTENSION_DIR"
  printf '%s\n' "import {PulseCard} from './card.js';" "import {isCardCovered} from './lib/visibility.js';" \
    "import {PROTOCOL_VERSION} from './lib/protocol.js';" "import {COCKPIT_BUS_NAME} from './lib/cockpitProtocol.js';" \
    >"$STATUS_EXTENSION_DIR/extension.js"
  : >"$STATUS_EXTENSION_DIR/metadata.json"
  printf '%s\n' "import {cardText} from './lib/format.js';" >"$STATUS_EXTENSION_DIR/card.js"
  : >"$STATUS_EXTENSION_DIR/stylesheet.css"
  : >"$STATUS_EXTENSION_DIR/lib/format.js"
  : >"$STATUS_EXTENSION_DIR/lib/visibility.js"
  : >"$STATUS_EXTENSION_DIR/lib/protocol.js"
  : >"$STATUS_EXTENSION_DIR/lib/cockpitProtocol.js"
  : >"$STATUS_EXTENSION_DIR/lib/sessions.js"
  : >"$STATUS_EXTENSION_DIR/service/fileIo.js"
  printf '%s\n' "import {COCKPIT_BUS_NAME} from '../lib/cockpitProtocol.js';" \
    "import {buildSessionsSource} from '../lib/sessions.js';" "import {readFileToEnd} from './fileIo.js';" \
    >"$STATUS_EXTENSION_DIR/service/cockpit.js"
  touch -d "@$BEFORE_SHELL_START_EPOCH" "$STATUS_EXTENSION_DIR/extension.js" "$STATUS_EXTENSION_DIR/metadata.json" \
    "$STATUS_EXTENSION_DIR/lib/visibility.js" "$STATUS_EXTENSION_DIR/lib/protocol.js" \
    "$STATUS_EXTENSION_DIR/lib/cockpitProtocol.js" "$STATUS_EXTENSION_DIR/lib/sessions.js" \
    "$STATUS_EXTENSION_DIR/service/fileIo.js" \
    || fatal "touch -d failed"
  touch -d "@$1" "$STATUS_EXTENSION_DIR/card.js" || fatal "touch -d @$1 failed"
  touch -d "@$2" "$STATUS_EXTENSION_DIR/lib/format.js" || fatal "touch -d @$2 failed"
  touch -d "@$3" "$STATUS_EXTENSION_DIR/service/cockpit.js" || fatal "touch -d @$3 failed"
  touch -d "@$stylesheet_mtime" "$STATUS_EXTENSION_DIR/stylesheet.css" || fatal "touch -d @$stylesheet_mtime failed"
}
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
# status_extension_with_change <module>: the fixture with every file older than
# the shell but that one module, which is newer.
status_extension_with_change() {
  reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
  touch -d "@$AFTER_SHELL_START_EPOCH" "$STATUS_EXTENSION_DIR/$1" || fatal "touch -d @$AFTER_SHELL_START_EPOCH failed"
}

# A fixed now, and GetState answers whose latest sample is some seconds before it.
# Each carries a decoy of the same key inside the snapshot, after the top-level
# one: only the FIRST match is the service's.
STATUS_NOW_EPOCH=1794000100
STATUS_NOW_NSEC="${STATUS_NOW_EPOCH}000000000"
STATUS_USEC_PER_SECOND=1000000
STATUS_NOW_USEC=$((STATUS_NOW_EPOCH * STATUS_USEC_PER_SECOND))
DECOY_APP_NAME='decoy'
# state_json_usec_before <microseconds before now | null | absent> [app name]: a
# GetState JSON whose top CPU app has that name.
state_json_usec_before() {
  local latest_field app_name="${2:-$DECOY_APP_NAME}"
  case "$1" in
    absent) latest_field='' ;;
    null) latest_field='"latestSampledAtUsec":null,' ;;
    *) latest_field="\"latestSampledAtUsec\":$((STATUS_NOW_USEC - $1))," ;;
  esac
  printf '{"protocol":1,"serviceStartedAtUsec":1793990000000000,%s"sequence":42,"snapshot":{"apps":{"topCpu":{"name":"%s","latestSampledAtUsec":5}}},"histories":{"cpu":[],"memory":[]}}' \
    "$latest_field" "$app_name"
}
# state_json_sampled <seconds before now | null | absent>: the same, in whole seconds.
state_json_sampled() {
  case "$1" in
    absent | null) state_json_usec_before "$1" ;;
    *) state_json_usec_before "$(( $1 * STATUS_USEC_PER_SECOND ))" ;;
  esac
}
# The cockpit's GetState, shaped as gnome-shell/tests/cockpitProtocol.test.js's
# FULL_STATE (synthetic values), with each source stamped some whole seconds
# before the fixed now. Its sources sample every 5, 10 and 30 s, so each is
# stale past 15, 30 and 90 s (three intervals).
COCKPIT_FRESH_PUBLISH_AGE_SECONDS=4
# cockpit_usec_before <seconds>: the fixed now less that many seconds, in microseconds.
cockpit_usec_before() { printf '%s' "$(( STATUS_NOW_USEC - $1 * STATUS_USEC_PER_SECOND ))"; }
# cockpit_state_json <sessions age> <network age> <mounts age> [<configError as JSON> [<latest publish age>]]:
# ages in seconds before now; "absent" leaves that source out, as a service from
# before it would. configError defaults to null, the latest publish to 4 s ago.
cockpit_state_json() {
  local config_error_json="${4:-null}" publish_age_seconds="${5:-$COCKPIT_FRESH_PUBLISH_AGE_SECONDS}"
  local sessions_json network_json mounts_json source_list
  local -a source_entries=()
  if [[ "$1" != absent ]]; then
    sessions_json="\"sessions\":{\"sampledAtUsec\":$(cockpit_usec_before "$1"),\"intervalSeconds\":5,\"herdrRunning\":true,\"totalMemoryBytes\":4000000000,\"counts\":{\"working\":1,\"blocked\":1,\"idle\":0,\"done\":0,\"unknown\":0},\"rows\":[{\"id\":\"w1:p1\",\"name\":\"session-a\",\"state\":\"working\",\"idleSeconds\":12,\"idleFromProcessAge\":false,\"memoryBytes\":3000000000,\"workspaceId\":\"w1\",\"paneId\":\"p1\",\"account\":\"acct-a\",\"contextPercent\":42}]}"
    source_entries+=("$sessions_json")
  fi
  if [[ "$2" != absent ]]; then
    network_json="\"network\":{\"sampledAtUsec\":$(cockpit_usec_before "$2"),\"intervalSeconds\":10,\"uplink\":{\"kind\":\"wired\",\"connectivity\":\"full\",\"wifiEnabled\":false},\"vpn\":{\"isUp\":true,\"interfaceName\":\"tun0\"},\"sshMasterCount\":2}"
    source_entries+=("$network_json")
  fi
  if [[ "$3" != absent ]]; then
    mounts_json="\"mounts\":{\"sampledAtUsec\":$(cockpit_usec_before "$3"),\"intervalSeconds\":30,\"rows\":[{\"mountPoint\":\"/media/user/DATA\",\"label\":\"DATA\",\"kind\":\"removable\",\"filesystemType\":\"ext4\",\"freeBytes\":500000000000,\"totalBytes\":2000000000000}]}"
    source_entries+=("$mounts_json")
  fi
  source_list="$(IFS=,; printf '%s' "${source_entries[*]}")"
  printf '{"protocol":1,"serviceStartedAtUsec":1793990000000000,"latestPublishedAtUsec":%s,"layout":{"monitor":{"vendor":"ACM","product":"ACME Display 27"},"groups":[{"id":"machine","caption":"MACHINE","columns":2,"cards":["system","apps"]},{"id":"agents","caption":"AGENTS","columns":1,"cards":["sessions"]}]},"configError":%s,"sources":{%s}}' \
    "$(cockpit_usec_before "$publish_age_seconds")" "$config_error_json" "$source_list"
}
# The status script's bounds, copied from it (a row below fails when a copy differs from what it copies),
# so that every elapsed-time bound here is derived from them: gdbus's reply timeout, how far inside the call's limit an
# override puts it, and the least it can be; the limit on each systemctl and gdbus call; how long --check gives the installed program to
# answer --source-hash, and what --check needs besides (hashing), which make the limit on each build-script call; and
# how long such a call gets after its TERM before it is killed.
STATUS_REPLY_TIMEOUT_SECONDS=2
STATUS_REPLY_INSIDE_CALL_LIMIT_SECONDS=1
STATUS_SHORTEST_REPLY_TIMEOUT_SECONDS=1
STATUS_CALL_LIMIT_SECONDS=3
STATUS_PROGRAM_TIMEOUT_SECONDS=2
STATUS_HASHING_MARGIN_SECONDS=3
STATUS_BUILD_CALL_KILL_AFTER_SECONDS=2
STATUS_BUILD_CALL_LIMIT_SECONDS=$((STATUS_PROGRAM_TIMEOUT_SECONDS + STATUS_HASHING_MARGIN_SECONDS))
# What a loaded runner may add to a run of the status script besides the calls that run to their limits. Every bound
# built from it stays under STATUS_STAND_IN_HANG_SECONDS, what the hanging stand-ins sleep, so a call left unbounded
# still fails its row.
STATUS_RUN_MARGIN_SECONDS=12
# The longest a run may take whose systemctl or gdbus calls never answer: the most such calls one run below leaves
# hanging (the sampler's and the cockpit's state calls, when every systemctl call hangs), each at its limit.
MOST_HUNG_CALLS_IN_ONE_RUN=2
HUNG_CALL_BOUND_SECONDS=$((MOST_HUNG_CALLS_IN_ONE_RUN * STATUS_CALL_LIMIT_SECONDS + STATUS_RUN_MARGIN_SECONDS))
# The longest a run may take with one build-script call that never ends: its limit, and the kill-after for a call
# that ignores its TERM.
SAMPLER_STATUS_MAXIMUM_SECONDS=$((STATUS_BUILD_CALL_LIMIT_SECONDS + STATUS_BUILD_CALL_KILL_AFTER_SECONDS + STATUS_RUN_MARGIN_SECONDS))
for derived_bound_seconds in "$HUNG_CALL_BOUND_SECONDS" "$SAMPLER_STATUS_MAXIMUM_SECONDS"; do
  (( derived_bound_seconds < STATUS_STAND_IN_HANG_SECONDS )) \
    || fatal "a derived bound ($derived_bound_seconds s) reaches the stand-ins' $STATUS_STAND_IN_HANG_SECONDS s hang"
done
# The limit every run below gives the status script's calls (RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS replaces both), so
# that a loaded runner never adds a time-out ⚠ to a row whose subject is not a bound. A run whose subject is a bound
# sets STATUS_AT_DEFAULT_CALL_LIMITS=yes, and the status script then holds its own limits.
UNHURRIED_STATUS_CALL_LIMIT_SECONDS=60
# gdbus's reply timeout in those runs: the override puts it a second inside the call's limit.
UNHURRIED_REPLY_TIMEOUT_SECONDS=$((UNHURRIED_STATUS_CALL_LIMIT_SECONDS - STATUS_REPLY_INSIDE_CALL_LIMIT_SECONDS))
# One more second than a limit: a stand-in that takes this long runs past it.
STATUS_SLOW_BUILD_CALL_SECONDS=$((STATUS_BUILD_CALL_LIMIT_SECONDS + 1))
STATUS_LATE_SYSTEMCTL_SECONDS=$((STATUS_CALL_LIMIT_SECONDS + 1))
# status_bound_value_in_source <name>: the whole-number value the status script gives that variable at its top level
# (unindented), one line per assignment of a literal (so none, or two, never reads as one value).
status_bound_value_in_source() {
  # shellcheck disable=SC2016  # rg's replacement, the pattern's first group.
  rg -o -r '$1' "^$1=([0-9]+)\$" "$STATUS_SCRIPT" | tr '\n' ' '
}
status_bounds_in_source=""
expected_status_bounds=""
for status_bound_name in rp_reply_timeout_seconds:"$STATUS_REPLY_TIMEOUT_SECONDS" \
  rp_reply_inside_call_limit_seconds:"$STATUS_REPLY_INSIDE_CALL_LIMIT_SECONDS" \
  rp_shortest_reply_timeout_seconds:"$STATUS_SHORTEST_REPLY_TIMEOUT_SECONDS" \
  rp_call_limit_seconds:"$STATUS_CALL_LIMIT_SECONDS" rp_program_timeout_seconds:"$STATUS_PROGRAM_TIMEOUT_SECONDS" \
  rp_hashing_margin_seconds:"$STATUS_HASHING_MARGIN_SECONDS" \
  rp_build_call_kill_after_seconds:"$STATUS_BUILD_CALL_KILL_AFTER_SECONDS"; do
  status_bounds_in_source+="${status_bound_name%%:*}=[$(status_bound_value_in_source "${status_bound_name%%:*}")] "
  expected_status_bounds+="${status_bound_name%%:*}=[${status_bound_name#*:} ] "
done
check "the table's copies of the status script's bounds are the values it gives them, each assigned once" \
  "$status_bounds_in_source" "$expected_status_bounds"

# RESOURCE_PULSE_ROOT is left unset, so the status script runs its default root, this checkout (the parent of its own
# directory), where it finds the closure helper and the build script; a row may set it.
# The cockpit unit keeps the stub's default (skipped) unless a row says otherwise.
STATUS_REPORT_STUB_DEFAULTS=(STATUS_REPORT_SHELL_STATE=ACTIVE STATUS_REPORT_SERVICE_ACTIVE_STATE=active
  STATUS_REPORT_GDBUS_MODE=answer "STATUS_REPORT_STATE_JSON=$(state_json_sampled 3)"
  STATUS_REPORT_COCKPIT_GDBUS_MODE=answer "STATUS_REPORT_COCKPIT_STATE_JSON=$(cockpit_state_json 3 3 2)"
  "STATUS_REPORT_NOW_NSEC=$STATUS_NOW_NSEC"
  "STATUS_REPORT_SERVICE_STARTED_AT=$(unit_timestamp_us_utc "$SERVICE_STARTED_LONG_AFTER_EPOCH" "$UNIT_START_MICROSECONDS")"
  "STATUS_REPORT_SHELL_PID=$$")
# status_report_run <enabled-extensions> <allow-extension-installation> [NAME=value...]
# runs the status script against every stub, settings reset to those two, with the
# defaults above overridden by the assignments (HOME=... included). Leaves its
# output in STATUS_REPORT_OUTPUT; the stubs' calls are in STATUS_REPORT_CALLS.
# disabled-extensions is STATUS_DISABLED_EXTENSIONS when set (the stub's empty list otherwise). Its call limits are
# UNHURRIED_STATUS_CALL_LIMIT_SECONDS, or the status script's own with STATUS_AT_DEFAULT_CALL_LIMITS=yes; an assignment
# overrides either, and the caller's environment never reaches it. It runs STATUS_SCRIPT_COMMAND.
# The table stops (exit 2) unless the run exits 0, prints each of STATUS_FIXED_LINE_PREFIXES and prints no bash
# diagnostic (require_whole_status_report), since every row that asserts an absence ("no ⚠", "says nothing") would
# pass on a report cut short.
STATUS_FIXED_LINE_PREFIXES=('Resource Pulse: linked=' '  service: ' '  cockpit: ')
# The line bash writes to stderr for an error in a script file, '<path>: line <n>: <message>', with the path as the
# script was run (the symlink row's is relative). Anchored at column 0 on a non-space: the report's own lines that
# could hold ': line ' (its ⚠ lines) start with two spaces. An ERE with no \s, for the ugrep shim.
BASH_DIAGNOSTIC_LINE_PATTERN='^[^ ].*: line [0-9]+: '
status_report_run() {
  prepare_status_report_command "$@"
  STATUS_REPORT_OUTPUT="$("${STATUS_REPORT_COMMAND[@]}" 2>&1)"
  require_whole_status_report $?
}
# require_whole_status_report <exit status>: stops the table (exit 2) unless the run that left STATUS_REPORT_OUTPUT (its
# stdout and stderr) exited 0, printed a line starting with each of STATUS_FIXED_LINE_PREFIXES, and printed no line
# matching BASH_DIAGNOSTIC_LINE_PATTERN; for status_report_run, and for a row that runs STATUS_REPORT_COMMAND some other
# way, capturing its stderr the same way.
# The exit status and the prefixes catch a script that is missing or does not parse, an exit before the end, a
# `set -e` or `set -u` that aborts, and a fixed line deleted. They cannot catch an arithmetic error: in a script file
# bash abandons only the top-level command it happens in (the `if … fi` around rp_describe_running_cockpit, say),
# writes its diagnostic to stderr and carries on, so every fixed line is printed and the script still exits 0. The
# diagnostic is what is left of it.
require_whole_status_report() {
  local status_exit="$1" fixed_line_prefix diagnostic_search_status=0
  (( status_exit == 0 )) || fatal "a run of the status script exited $status_exit, not 0; its output: $STATUS_REPORT_OUTPUT"
  for fixed_line_prefix in "${STATUS_FIXED_LINE_PREFIXES[@]}"; do
    status_output_has_line_starting "$fixed_line_prefix" \
      || fatal "a run of the status script printed no line starting '$fixed_line_prefix'; its output: $STATUS_REPORT_OUTPUT"
  done
  # grep's 1 is "no diagnostic"; anything above it is a search that did not happen, never a pass.
  grep -q -E -- "$BASH_DIAGNOSTIC_LINE_PATTERN" <<<"$STATUS_REPORT_OUTPUT" || diagnostic_search_status=$?
  case "$diagnostic_search_status" in
    0) fatal "a run of the status script printed a bash diagnostic; its output: $STATUS_REPORT_OUTPUT" ;;
    1) ;;
    *) fatal "cannot search a run's output for a bash diagnostic: grep exited $diagnostic_search_status" ;;
  esac
}
# status_output_has_line_starting <prefix>: succeeds when a line of STATUS_REPORT_OUTPUT starts with the prefix.
status_output_has_line_starting() { [[ $'\n'"$STATUS_REPORT_OUTPUT" == *$'\n'"$1"* ]]; }
# prepare_status_report_command <the same arguments>: everything status_report_run does but the run itself; leaves the
# command that runs the status script in STATUS_REPORT_COMMAND, for a row that starts it some other way.
prepare_status_report_command() {
  local -a call_limit_assignment=("RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS=$UNHURRIED_STATUS_CALL_LIMIT_SECONDS")
  [[ "${STATUS_AT_DEFAULT_CALL_LIMITS:-}" != yes ]] || call_limit_assignment=()
  rm -rf "${STUB_STATE:?}"/*
  mkdir -p "$STUB_STATE/$SHELL_SCHEMA"
  printf '%s\n' "$1" >"$STUB_STATE/$SHELL_SCHEMA/enabled-extensions"
  printf '%s\n' "$2" >"$STUB_STATE/$SHELL_SCHEMA/allow-extension-installation"
  if [[ -n "${STATUS_DISABLED_EXTENSIONS:-}" ]]; then
    printf '%s\n' "$STATUS_DISABLED_EXTENSIONS" >"$STUB_STATE/$SHELL_SCHEMA/disabled-extensions"
  fi
  shift 2
  : >"$STATUS_REPORT_CALLS"
  # XDG_CONFIG_HOME is pinned empty, so the cockpit's config file is looked for
  # under the row's HOME, never the caller's config home; a row may set it. The
  # caller's BASH_ENV (a file bash reads before the script) and RESOURCE_PULSE_ROOT
  # never reach the run either; a row may set them.
  STATUS_REPORT_COMMAND=(env -u RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS -u BASH_ENV -u RESOURCE_PULSE_ROOT
    "${LIVE_SETTINGS_BARRIER[@]}"
    HOME="$STATUS_REPORT_HOME" XDG_CONFIG_HOME= PATH="$STATUS_REPORT_STUB_BIN:$PATH"
    STUB_STATE="$STUB_STATE" STUB_CALLS="$STUB_CALLS_LOG" STUB_BUS_SEEN="$STUB_BUS_SEEN_LOG"
    STUB_GIO_MODULE_DIR_SEEN="$STUB_GIO_MODULE_DIR_SEEN_LOG"
    STATUS_REPORT_CALLS="$STATUS_REPORT_CALLS" "${STATUS_REPORT_STUB_DEFAULTS[@]}" "${call_limit_assignment[@]}" "$@"
    "${STATUS_SCRIPT_COMMAND[@]}")
}
# The parts of STATUS_REPORT_OUTPUT the rows compare.
status_enabled_field() { sed -n 's/^Resource Pulse: linked=[a-z]* enabled=\(.*\) state=.*$/\1/p' <<<"$STATUS_REPORT_OUTPUT"; }
status_service_line() { sed -n 's/^  service: //p' <<<"$STATUS_REPORT_OUTPUT"; }
status_cockpit_line() { sed -n 's/^  cockpit: //p' <<<"$STATUS_REPORT_OUTPUT"; }
status_warnings_naming() { grep -F '  ⚠ ' <<<"$STATUS_REPORT_OUTPUT" | grep -c -F "$1"; }
status_warning_count() { grep -c -F '  ⚠ ' <<<"$STATUS_REPORT_OUTPUT"; }
status_gdbus_calls() { grep -c '^gdbus ' "$STATUS_REPORT_CALLS"; }
ASKED_FOR_SETTING="['$EXTENSION_UUID']"
NOT_ASKED_FOR_SETTING='@as []'

enabled_summary=""
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_SHELL_STATE=
enabled_summary+="unknown-to-shell=[$(status_enabled_field)]"
status_report_run "$ASKED_FOR_SETTING" true
enabled_summary+=" known=[$(status_enabled_field)]"
status_report_run "$ASKED_FOR_SETTING" false STATUS_REPORT_SHELL_STATE=
enabled_summary+=" kept-out=[$(status_enabled_field)]"
status_report_run "$NOT_ASKED_FOR_SETTING" true STATUS_REPORT_SHELL_STATE=
enabled_summary+=" not-asked-for=[$(status_enabled_field)]"
check "the status script: enabled= reads enabled-extensions, and says it starts at next login while the shell does not know it" \
  "$enabled_summary" "unknown-to-shell=[yes (starts at next login)] known=[yes] kept-out=[yes] not-asked-for=[no]"

# It takes no argument: any (an option, an option with a value, a word, an empty one) is a usage error, exit 2 with its
# usage line alone on stderr, before anything is asked (no stub logs a call, gsettings included) or printed on stdout.
# Not run by status_report_run, which needs exit 0.
STATUS_USAGE_ERROR_STATUS=2
STATUS_USAGE_STDERR_FILE="$WIRING_TMP/status-report-usage-stderr"
# A usage error is refused before any call, so the run margin alone bounds it: a run that does not end ends as
# timeout's 124 and fails the row, where unbounded it would hang the table.
STATUS_USAGE_RUN_KILL_AFTER_SECONDS=2
STATUS_USAGE_RUN_BOUND=(timeout --kill-after="$STATUS_USAGE_RUN_KILL_AFTER_SECONDS" "$STATUS_RUN_MARGIN_SECONDS")
# status_usage_cell <name> <argument...>: runs STATUS_REPORT_COMMAND with the arguments after its own, within
# STATUS_USAGE_RUN_BOUND, and prints "<name>: exit=… stderr-lines=… usage-lines=… stdout=[…] calls=… gsettings-calls=…; ".
status_usage_cell() {
  local cell_name="$1" usage_stdout usage_exit
  shift
  : >"$STUB_CALLS_LOG"
  : >"$STATUS_REPORT_CALLS"
  usage_stdout="$("${STATUS_USAGE_RUN_BOUND[@]}" "${STATUS_REPORT_COMMAND[@]}" "$@" 2>"$STATUS_USAGE_STDERR_FILE")"
  usage_exit=$?
  printf '%s: exit=%s stderr-lines=%s usage-lines=%s stdout=[%s] calls=%s gsettings-calls=%s; ' "$cell_name" "$usage_exit" \
    "$(wc -l <"$STATUS_USAGE_STDERR_FILE" | tr -d ' ')" "$(grep -c '^usage: ' "$STATUS_USAGE_STDERR_FILE")" "$usage_stdout" \
    "$(wc -c <"$STATUS_REPORT_CALLS" | tr -d ' ')" "$(wc -c <"$STUB_CALLS_LOG" | tr -d ' ')"
}
STATUS_USAGE_ERROR_CELL="exit=$STATUS_USAGE_ERROR_STATUS stderr-lines=1 usage-lines=1 stdout=[] calls=0 gsettings-calls=0; "
prepare_status_report_command "$ASKED_FOR_SETTING" true
usage_summary="$(status_usage_cell option --verbose)"
usage_summary+="$(status_usage_cell option-with-value --config "$WIRING_TMP/a-config-file")"
usage_summary+="$(status_usage_cell word report)"
usage_summary+="$(status_usage_cell empty '')"
check "the status script takes no argument: an option, an option with a value, a word or an empty argument is a usage error: exit 2, one line on stderr, no stub called" \
  "$usage_summary" \
  "option: $STATUS_USAGE_ERROR_CELL""option-with-value: $STATUS_USAGE_ERROR_CELL""word: $STATUS_USAGE_ERROR_CELL""empty: $STATUS_USAGE_ERROR_CELL"

# gsettings must use the real dconf backend, which a snap-confined terminal's GIO_MODULE_DIR would hide from it, so the
# status script unsets it before any call: the stub, given one by the caller, logs that it saw none. At least one call
# must be logged, or a run that never asked gsettings would pass.
: >"$STUB_GIO_MODULE_DIR_SEEN_LOG"
status_report_run "$ASKED_FOR_SETTING" true GIO_MODULE_DIR=/nonexistent
gio_module_dir_logged="$([[ -s "$STUB_GIO_MODULE_DIR_SEEN_LOG" ]] && printf some || printf none)"
check "the status script: with GIO_MODULE_DIR set, gsettings never sees it" \
  "logged-calls=$gio_module_dir_logged seen=[$(LC_ALL=C sort -u "$STUB_GIO_MODULE_DIR_SEEN_LOG" | tr '\n' ' ')]" \
  "logged-calls=some seen=[unset ]"

status_report_run "$ASKED_FOR_SETTING" true
running_service_summary="line=[$(status_service_line)] warnings=$(status_warning_count) call=[$(grep '^gdbus ' "$STATUS_REPORT_CALLS")]"
# The same answer with its latestSampledAtUsec written with a leading zero, its digits holding a 9: read as octal
# rather than in base 10, that is an arithmetic error, not merely a wrong age.
LATEST_SAMPLED_KEY_TEXT='"latestSampledAtUsec":'
LEADING_ZERO_WITH_NON_OCTAL_DIGIT_PATTERN="${LATEST_SAMPLED_KEY_TEXT}0[0-9]*[89]"
leading_zero_state_json="$(state_json_sampled 3)"
leading_zero_state_json="${leading_zero_state_json/"$LATEST_SAMPLED_KEY_TEXT"/"${LATEST_SAMPLED_KEY_TEXT}0"}"
leading_zero_has_non_octal_digit=no
[[ "$leading_zero_state_json" =~ $LEADING_ZERO_WITH_NON_OCTAL_DIGIT_PATTERN ]] && leading_zero_has_non_octal_digit=yes
status_report_run "$ASKED_FOR_SETTING" true "STATUS_REPORT_STATE_JSON=$leading_zero_state_json"
running_service_summary+=" leading-zero-non-octal=$leading_zero_has_non_octal_digit line=[$(status_service_line)] warnings=$(status_warning_count)"
check "the status script: a running service shows its state, protocol and the age of its last sample (the top-level field), from GetState, a leading zero read in base 10" \
  "$running_service_summary" \
  "line=[active, protocol 1, last sample 3 s ago] warnings=0 call=[gdbus call --session --dest $RESOURCE_PULSE_BUS_NAME --object-path $RESOURCE_PULSE_OBJECT_PATH --method $RESOURCE_PULSE_BUS_NAME.GetState --timeout $UNHURRIED_REPLY_TIMEOUT_SECONDS] leading-zero-non-octal=yes line=[active, protocol 1, last sample 3 s ago] warnings=0"

stall_summary=""
# Ages in microseconds: 6.9 s is past the extension's 6 s though it shows as 6 s.
for sample_age_usec in 6000000 6900000 7000000 60000000 150000000; do
  status_report_run "$ASKED_FOR_SETTING" true "STATUS_REPORT_STATE_JSON=$(state_json_usec_before "$sample_age_usec")"
  stall_summary+="$sample_age_usec=[$(status_service_line)]/$(status_warnings_naming 'has not sampled') "
done
check "the status script: a last sample more than the extension's 6 s old is a ⚠ (6.9 s too), exactly 6 s is not; from 120 s it reads in minutes" \
  "$stall_summary" \
  "6000000=[active, protocol 1, last sample 6 s ago]/0 6900000=[active, protocol 1, last sample 6 s ago]/1 7000000=[active, protocol 1, last sample 7 s ago]/1 60000000=[active, protocol 1, last sample 60 s ago]/1 150000000=[active, protocol 1, last sample 2 min ago]/1 "

# A string holding an apostrophe makes gdbus print the reply in double quotes,
# escaping every " and \ inside it. The reply is printed by GLib itself
# (GLib.Variant.print, which gdbus uses), from a JSON whose app name holds ', "
# and \, with a sample ten minutes old.
APOSTROPHE_APP_NAME_JSON='Bob'"'"'s \"quoted\" \\ app'
TEN_MINUTES_USEC=600000000
# shellcheck disable=SC2016  # JavaScript source.
apostrophe_reply="$(gjs -c 'const {GLib} = imports.gi; print(new GLib.Variant("(s)", [ARGV[0]]).print(true));' \
  "$(state_json_usec_before "$TEN_MINUTES_USEC" "$APOSTROPHE_APP_NAME_JSON")")"
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_GDBUS_MODE=verbatim "STATUS_REPORT_GDBUS_REPLY=$apostrophe_reply"
check "the status script: a reply gdbus prints in double quotes (a string holding an apostrophe) still gives the protocol, the age and the stall ⚠" \
  "double-quoted=$([[ "$apostrophe_reply" == '("{\"protocol\":1,'* ]] && printf yes || printf no) line=[$(status_service_line)] stalled=$(status_warnings_naming 'has not sampled')" \
  "double-quoted=yes line=[active, protocol 1, last sample 10 min ago] stalled=1"

status_report_run "$ASKED_FOR_SETTING" true "STATUS_REPORT_STATE_JSON=$(state_json_sampled null)"
unsampled_summary="null=[$(status_service_line)]/$(status_warning_count)"
status_report_run "$ASKED_FOR_SETTING" true "STATUS_REPORT_STATE_JSON=$(state_json_sampled absent)"
unsampled_summary+=" absent=[$(status_service_line)]/$(status_warning_count)"
check "the status script: a null latestSampledAtUsec is no sample yet, and none at all (an older service) is not reported; neither warns" \
  "$unsampled_summary" \
  "null=[active, protocol 1, no sample yet]/0 absent=[active, protocol 1, last sample not reported (a service from before it was)]/0"

status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_GDBUS_MODE=fail
no_answer_summary="fail=[$(status_service_line)]/$(status_warnings_naming 'did not answer GetState')"
# The status script bounds the call at its call limit; the hanging stub would take 30 s (HUNG_CALL_BOUND_SECONDS above).
hang_started_seconds=$SECONDS
STATUS_AT_DEFAULT_CALL_LIMITS=yes status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_GDBUS_MODE=hang
hang_elapsed_seconds=$((SECONDS - hang_started_seconds))
no_answer_summary+=" hang=[$(status_service_line)]/$(status_warnings_naming 'did not answer GetState')"
no_answer_summary+=" bounded=$( (( hang_elapsed_seconds < HUNG_CALL_BOUND_SECONDS )) && printf yes || printf 'no-%ss' "$hang_elapsed_seconds")"
check "the status script: an active service that does not answer, or hangs, is 'no answer' and a ⚠, and the call ends within its limit" \
  "$no_answer_summary" "fail=[active, no answer]/1 hang=[active, no answer]/1 bounded=yes"

not_running_summary=""
for state_and_setting in "failed:$ASKED_FOR_SETTING" "failed:$NOT_ASKED_FOR_SETTING" "inactive:$ASKED_FOR_SETTING" \
  "inactive:$NOT_ASKED_FOR_SETTING" "activating:$ASKED_FOR_SETTING"; do
  status_report_run "${state_and_setting#*:}" true "STATUS_REPORT_SERVICE_ACTIVE_STATE=${state_and_setting%%:*}"
  enabled_flag="$([[ "${state_and_setting#*:}" == "$ASKED_FOR_SETTING" ]] && printf enabled || printf off)"
  not_running_summary+="${state_and_setting%%:*}/$enabled_flag=[$(status_service_line)]/$(status_warning_count)/$(status_gdbus_calls) "
done
# Enabled, but before the first login after linking: the extension has not run yet.
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive STATUS_REPORT_SHELL_STATE=
not_running_summary+="inactive/before-login=[$(status_service_line)]/$(status_warning_count)/$(status_gdbus_calls) "
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_NO_MANAGER=1
not_running_summary+="no-manager=[$(status_service_line)]/$(status_warning_count)/$(status_gdbus_calls)"
check "the status script: a failed service always warns, one not running only while enabled and loaded, no manager never; none is asked GetState" \
  "$not_running_summary" \
  "failed/enabled=[failed (not running)]/1/0 failed/off=[failed (not running)]/1/0 inactive/enabled=[inactive (not running)]/1/0 inactive/off=[inactive (not running)]/0/0 activating/enabled=[activating (start)]/1/0 inactive/before-login=[inactive (not running)]/0/0 no-manager=[unknown (no systemd user manager answered)]/0/0"

# Each state gets its own remedy: a unit not found says to link it from this
# checkout (the status script's own); one restarting after an unplanned end says
# so; only a loaded, inactive unit suggests starting it.
SERVICE_LINK_REMEDY="— link it: systemctl --user link --force $REPO_ROOT/systemd/resource-pulse.service"
status_remedies() {
  printf '[%s]/%s/start=%s/link=%s/restarting=%s/status=%s' "$(status_service_line)" "$(status_warning_count)" \
    "$(status_warnings_naming 'systemctl --user start')" "$(status_warnings_naming "$SERVICE_LINK_REMEDY")" \
    "$(status_warnings_naming 'restarting after an unplanned end')" "$(status_warnings_naming 'systemctl --user status')"
}
remedies_summary=""
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_SERVICE_LOAD_STATE=not-found STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
remedies_summary+="not-found/enabled=$(status_remedies) "
status_report_run "$NOT_ASKED_FOR_SETTING" true STATUS_REPORT_SERVICE_LOAD_STATE=not-found STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
remedies_summary+="not-found/off=$(status_remedies) "
status_report_run "$NOT_ASKED_FOR_SETTING" true STATUS_REPORT_SERVICE_ACTIVE_STATE=activating STATUS_REPORT_SERVICE_SUB_STATE=auto-restart
remedies_summary+="auto-restart/off=$(status_remedies) "
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_SERVICE_ACTIVE_STATE=activating
remedies_summary+="starting/enabled=$(status_remedies) "
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
remedies_summary+="inactive/enabled=$(status_remedies) "
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_SERVICE_LOAD_STATE=bad-setting STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
remedies_summary+="bad-setting/enabled=$(status_remedies)"
check "the status script: a missing unit says to link it from this checkout, one restarting after an unplanned end says so, and only a loaded inactive one to start it" \
  "$remedies_summary" \
  "not-found/enabled=[not installed (LoadState=not-found)]/1/start=0/link=1/restarting=0/status=0 not-found/off=[not installed (LoadState=not-found)]/0/start=0/link=0/restarting=0/status=0 auto-restart/off=[activating (auto-restart: restarting after an unplanned end)]/1/start=0/link=0/restarting=1/status=0 starting/enabled=[activating (start)]/1/start=0/link=0/restarting=0/status=0 inactive/enabled=[inactive (not running)]/1/start=1/link=0/restarting=0/status=0 bad-setting/enabled=[cannot load (LoadState=bad-setting)]/1/start=0/link=0/restarting=0/status=1"

hung_systemctl_started_seconds=$SECONDS
STATUS_AT_DEFAULT_CALL_LIMITS=yes status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_SYSTEMCTL_MODE=hang
hung_systemctl_elapsed_seconds=$((SECONDS - hung_systemctl_started_seconds))
hung_systemctl_summary="state-call=[$(status_service_line)]/$( (( hung_systemctl_elapsed_seconds < HUNG_CALL_BOUND_SECONDS )) && printf bounded || printf 'after-%ss' "$hung_systemctl_elapsed_seconds")"
# The start-time call (linked, so the data-side check runs) is bounded too.
hung_systemctl_started_seconds=$SECONDS
STATUS_AT_DEFAULT_CALL_LIMITS=yes status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" \
  STATUS_REPORT_SYSTEMCTL_MODE=hang-on-start-time
hung_systemctl_elapsed_seconds=$((SECONDS - hung_systemctl_started_seconds))
hung_systemctl_summary+=" start-time-call=[$(status_service_line)]/$( (( hung_systemctl_elapsed_seconds < HUNG_CALL_BOUND_SECONDS )) && printf bounded || printf 'after-%ss' "$hung_systemctl_elapsed_seconds")"
check "the status script: a systemctl that hangs is bounded like gdbus, in both of its calls" \
  "$hung_systemctl_summary" \
  "state-call=[unknown (no systemd user manager answered)]/bounded start-time-call=[active, protocol 1, last sample 3 s ago]/bounded"

# Asked for in enabled-extensions but also in disabled-extensions, which wins in
# GNOME 50: a load hint, like the other two, naming the fix, and the service is
# not blamed.
DISABLED_EXTENSIONS_HINT_LINE='  disabled-extensions also lists it, and wins in GNOME 50: it does not load until it is removed from that list'
disabled_summary=""
STATUS_DISABLED_EXTENSIONS="$ASKED_FOR_SETTING" status_report_run "$ASKED_FOR_SETTING" true \
  STATUS_REPORT_SHELL_STATE=INACTIVE STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
disabled_summary+="known=[$(status_enabled_field)]/hint=$(grep -c -x -F -- "$DISABLED_EXTENSIONS_HINT_LINE" <<<"$STATUS_REPORT_OUTPUT")/warnings=$(status_warning_count)"
STATUS_DISABLED_EXTENSIONS="$ASKED_FOR_SETTING" status_report_run "$ASKED_FOR_SETTING" true \
  STATUS_REPORT_SHELL_STATE= STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
disabled_summary+=" unknown-to-shell=[$(status_enabled_field)]/hint=$(grep -c -x -F -- "$DISABLED_EXTENSIONS_HINT_LINE" <<<"$STATUS_REPORT_OUTPUT")/warnings=$(status_warning_count)"
check "the status script: an extension also in disabled-extensions gets a load hint saying to remove it from that list, and the service is not blamed" \
  "$disabled_summary" "known=[yes]/hint=1/warnings=0 unknown-to-shell=[yes]/hint=1/warnings=0"

# The sampler is the compiled program the build script installs, not modules of
# the extension (the shell and the cockpit have import closures; it has none).
# A module of the extension changing after the unit started is no ⚠ about the
# sampler, whichever side runs it.
older_code_summary=""
# The sampler started at .7 of the second the suite started.
STATUS_SERVICE_STARTED_AT="STATUS_REPORT_SERVICE_STARTED_AT=$(unit_timestamp_us_utc "$SUITE_STARTED_AT_EPOCH" "$UNIT_START_MICROSECONDS")"
for changed_module in lib/protocol.js lib/visibility.js lib/format.js card.js service/cockpit.js lib/sessions.js \
  service/fileIo.js lib/cockpitProtocol.js; do
  status_extension_with_change "$changed_module"
  status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT"
  older_code_summary+="$changed_module=$(status_warnings_naming 'resource-pulse.service runs older code')/$(status_warnings_naming 'resource-pulse.service runs an older program') "
done
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT"
older_code_summary+="unchanged=$(status_warnings_naming 'resource-pulse.service runs older')"
check "the status script: no module of the extension (the shell's, the cockpit's, or one both run) changed after the sampler started is a ⚠ about it: the sampler is a program" \
  "$older_code_summary" \
  "lib/protocol.js=0/0 lib/visibility.js=0/0 lib/format.js=0/0 card.js=0/0 service/cockpit.js=0/0 lib/sessions.js=0/0 service/fileIo.js=0/0 lib/cockpitProtocol.js=0/0 unchanged=0"

# The sampler's program. A home with the extension linked and
# the installed program at the path its --installed-path prints: a stand-in
# that answers --source-hash (the real build script, run from this checkout, is
# what the status script asks).
SAMPLER_STATUS_HOME="$WIRING_TMP/status-report-sampler-home"
SAMPLER_STATUS_PROGRAM_DIRECTORY="$SAMPLER_STATUS_HOME/.local/lib/resource-pulse"
SAMPLER_STATUS_PROGRAM_FILE="$SAMPLER_STATUS_PROGRAM_DIRECTORY/resource-pulse-sampler"
SAMPLER_STATUS_LINK_TARGET_DIRECTORY="$WIRING_TMP/status-report-sampler-link-target"
SAMPLER_STATUS_LINK_TARGET="$SAMPLER_STATUS_LINK_TARGET_DIRECTORY/resource-pulse-sampler"
SAMPLER_OLDER_PROGRAM_LINE='resource-pulse.service runs an older program: the installed one changed after it started — systemctl --user try-restart resource-pulse.service (its histories start again)'
SAMPLER_CANNOT_TELL_PREFIX="cannot tell whether the installed sampler program is this checkout's:"
SAMPLER_CANNOT_TELL_OLDER_NEEDLE='cannot tell whether resource-pulse.service runs an older program'
# reset_sampler_status_home <program: a hash, nothing, hang or none>
#   [program mtime: epoch seconds, a fraction allowed, as touch -d @ reads it]
reset_sampler_status_home() {
  chmod -R u+rwx "$SAMPLER_STATUS_HOME" "$SAMPLER_STATUS_LINK_TARGET_DIRECTORY" 2>/dev/null
  rm -rf "$SAMPLER_STATUS_HOME" "$SAMPLER_STATUS_LINK_TARGET_DIRECTORY"
  mkdir -p "$SAMPLER_STATUS_HOME/.local/share/gnome-shell/extensions" || fatal "cannot create $SAMPLER_STATUS_HOME"
  ln -s "$STATUS_EXTENSION_DIR" "$SAMPLER_STATUS_HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID" \
    || fatal "cannot link the fixture extension into $SAMPLER_STATUS_HOME"
  [[ "$1" == none ]] && return 0
  write_sampler_stand_in "$SAMPLER_STATUS_PROGRAM_FILE" "$1"
  touch -d "@${2:-$BEFORE_SHELL_START_EPOCH}" "$SAMPLER_STATUS_PROGRAM_FILE" || fatal "touch -d failed"
}
# sampler_status_run [NAME=value...]: the status script over the sampler home, the sampler active since the suite
# started (the program, when it is a file, as reset_sampler_status_home timed it), the extension's modules all old.
sampler_status_run() {
  reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
  status_report_run "$ASKED_FOR_SETTING" true "HOME=$SAMPLER_STATUS_HOME" "$STATUS_SERVICE_STARTED_AT" "$@"
}
# program_time_cell <name> <program mtime> [NAME=value...]: runs the status script over a program that is this
# checkout's, written at that time, under a sampler started at .7 of the suite's second (unless an assignment says
# otherwise), and leaves its summary cell in PROGRAM_TIME_CELL: "<name>=<older-program ⚠>/<all ⚠> ". Not run in a
# substitution, so that a fixture it cannot make stops the table.
program_time_cell() {
  reset_sampler_status_home "$SAMPLER_STATUS_CHECKOUT_HASH" "$2"
  sampler_status_run "${@:3}"
  PROGRAM_TIME_CELL="$1=$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warning_count) "
}
program_time_cell newer "$AFTER_SHELL_START_EPOCH"
program_time_summary="$PROGRAM_TIME_CELL"
program_time_cell older "$BEFORE_SHELL_START_EPOCH"
program_time_summary+="$PROGRAM_TIME_CELL"
check "the status script: the installed program newer than the sampler's start is one ⚠ with the try-restart remedy; older is none" \
  "$program_time_summary" "newer=1/1 older=0/0 "
# The start is read to the microsecond: a deploy that rebuilds the program writes it and restarts the
# sampler within one second, so a program written earlier in that second is the one running.
program_time_cell before-start "$SUITE_STARTED_AT_EPOCH.$SAME_SECOND_BEFORE_START_MICROSECONDS"
program_same_second_summary="$PROGRAM_TIME_CELL"
program_time_cell after-start "$SUITE_STARTED_AT_EPOCH.$SAME_SECOND_AFTER_START_MICROSECONDS"
program_same_second_summary+="$PROGRAM_TIME_CELL"
check "the status script: within the second the sampler started, a program written before its start (.4 against .7) is no ⚠, and one written after it (.9) is the older-program ⚠" \
  "$program_same_second_summary" "before-start=0/0 after-start=1/1 "
# The start's first word, its day name, is dropped before find reads it (GNU find cannot read one that is not
# English): a start that says Di or 月 is read all the same, to the microsecond.
STATUS_SERVICE_START_WITHOUT_DAY_NAME="${STATUS_SERVICE_STARTED_AT#*=}"
STATUS_SERVICE_START_WITHOUT_DAY_NAME="${STATUS_SERVICE_START_WITHOUT_DAY_NAME#* }"
day_name_summary=""
expected_day_name_summary=""
for non_english_day_name in "${NON_ENGLISH_DAY_NAMES[@]}"; do
  day_name_start="STATUS_REPORT_SERVICE_STARTED_AT=$non_english_day_name $STATUS_SERVICE_START_WITHOUT_DAY_NAME"
  program_time_cell "$non_english_day_name/before-start" "$SUITE_STARTED_AT_EPOCH.$SAME_SECOND_BEFORE_START_MICROSECONDS" \
    "$day_name_start"
  day_name_summary+="$PROGRAM_TIME_CELL"
  program_time_cell "$non_english_day_name/after-start" "$SUITE_STARTED_AT_EPOCH.$SAME_SECOND_AFTER_START_MICROSECONDS" \
    "$day_name_start"
  day_name_summary+="$PROGRAM_TIME_CELL"
  expected_day_name_summary+="$non_english_day_name/before-start=0/0 $non_english_day_name/after-start=1/1 "
done
check "the status script reads a start whose day name is not English (Di, 月) all the same, to the microsecond: a program written before it in its second is no ⚠, one written after it the older-program ⚠" \
  "$day_name_summary" "$expected_day_name_summary"

# A start it cannot read (empty, n/a, or whole seconds as --timestamp=unix printed them)
# is a cannot-tell ⚠ naming the call that reads it, as the refresh step warns, never
# silence: the older-program and unit-file questions both need it. A newer program is
# installed, so a start read some other way would show as an older-program ⚠.
UNREADABLE_START_NEEDLE="cannot tell when resource-pulse.service started (its ActiveEnterTimestamp is not in systemd's microsecond form), so not whether it runs an older program or unit file — systemctl --user show -p ActiveEnterTimestamp --value --timestamp=us+utc resource-pulse.service"
unreadable_status_start_summary=""
expected_unreadable_status_start_summary=""
for unreadable_status_start in '' 'n/a' "@$SUITE_STARTED_AT_EPOCH"; do
  reset_sampler_status_home "$SAMPLER_STATUS_CHECKOUT_HASH" "$AFTER_SHELL_START_EPOCH"
  sampler_status_run "STATUS_REPORT_SERVICE_STARTED_AT=$unreadable_status_start"
  unreadable_status_start_summary+="[$unreadable_status_start]=$(status_warnings_naming "$UNREADABLE_START_NEEDLE")/$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warning_count) "
  expected_unreadable_status_start_summary+="[$unreadable_status_start]=1/0/1 "
done
check "the status script: an active sampler whose start is not in systemd's microsecond UTC form (empty, n/a, or whole seconds as @<epoch>) is one cannot-tell ⚠ naming the call that reads it, never silence" \
  "$unreadable_status_start_summary" "$expected_unreadable_status_start_summary"

# A start whose call fails (status 1, as systemctl does when it cannot ask its manager) or does not end within its limit
# was not read at all: its cannot-tell ⚠ says it could not be read, never that it is not in systemd's microsecond form,
# which is what an answer in another form gets (the row above). For the sampler and the cockpit alike.
START_UNREAD_TEXT="its ActiveEnterTimestamp could not be read"
START_NOT_IN_FORM_TEXT="its ActiveEnterTimestamp is not in systemd's microsecond form"
# start_unread_cell <unit>: "<unit>=<could-not-be-read ⚠>/<not-in-form ⚠>" for the run in STATUS_REPORT_OUTPUT.
start_unread_cell() {
  printf '%s=%s/%s' "$1" "$(status_warnings_naming "cannot tell when $1 started ($START_UNREAD_TEXT)")" \
    "$(status_warnings_naming "cannot tell when $1 started ($START_NOT_IN_FORM_TEXT)")"
}
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" STATUS_REPORT_SYSTEMCTL_MODE=fail-on-start-time \
  STATUS_REPORT_COCKPIT_ACTIVE_STATE=active
start_unread_summary="fails:$(start_unread_cell resource-pulse.service),$(start_unread_cell resource-pulse-cockpit.service)"
STATUS_AT_DEFAULT_CALL_LIMITS=yes status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" \
  STATUS_REPORT_SYSTEMCTL_MODE=hang-on-start-time
start_unread_summary+=" does-not-end:$(start_unread_cell resource-pulse.service)"
check "the status script: a call that fails, or does not end, while reading a unit's start is a cannot-tell ⚠ that its start could not be read, never that it is not in systemd's microsecond form" \
  "$start_unread_summary" "fails:resource-pulse.service=1/0,resource-pulse-cockpit.service=1/0 does-not-end:resource-pulse.service=1/0"

# A link at the program's path is read as what it names (as systemd runs it): its target's time counts, not the link's.
link_time_summary=""
for link_target_mtime in "$AFTER_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"; do
  reset_sampler_status_home none
  mkdir -p "$SAMPLER_STATUS_PROGRAM_DIRECTORY" || fatal "cannot create $SAMPLER_STATUS_PROGRAM_DIRECTORY"
  write_sampler_stand_in "$SAMPLER_STATUS_LINK_TARGET" "$SAMPLER_STATUS_CHECKOUT_HASH"
  touch -d "@$link_target_mtime" "$SAMPLER_STATUS_LINK_TARGET" || fatal "touch -d failed"
  ln -s "$SAMPLER_STATUS_LINK_TARGET" "$SAMPLER_STATUS_PROGRAM_FILE" || fatal "cannot link the program"
  # The link's own time is the opposite of its target's, so reading the link itself would decide the other way.
  if [[ "$link_target_mtime" == "$AFTER_SHELL_START_EPOCH" ]]; then link_mtime="$BEFORE_SHELL_START_EPOCH"; else link_mtime="$AFTER_SHELL_START_EPOCH"; fi
  touch -h -d "@$link_mtime" "$SAMPLER_STATUS_PROGRAM_FILE" || fatal "touch -h -d failed"
  sampler_status_run
  link_time_summary+="target@$link_target_mtime=$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warning_count) "
done
check "the status script: a link at the program's path is read as its target: a newer target is a ⚠ though the link is older, an older one is none though the link is newer" \
  "$link_time_summary" "target@$AFTER_SHELL_START_EPOCH=1/1 target@$BEFORE_SHELL_START_EPOCH=0/0 "

# Not there is not newer; a link to nothing is not there either (the check says why, the time says nothing).
reset_sampler_status_home none
sampler_status_run
no_program_summary="none=$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warnings_naming "$SAMPLER_CANNOT_TELL_OLDER_NEEDLE")"
mkdir -p "$SAMPLER_STATUS_PROGRAM_DIRECTORY" || fatal "cannot create $SAMPLER_STATUS_PROGRAM_DIRECTORY"
ln -s "$WIRING_TMP/no-such-sampler-program" "$SAMPLER_STATUS_PROGRAM_FILE" || fatal "cannot link the program to nothing"
sampler_status_run
no_program_summary+=" dangling=$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warnings_naming "$SAMPLER_CANNOT_TELL_OLDER_NEEDLE")"
check "the status script: a program that is not installed, or a link to nothing, is not newer than the sampler's start: no older-program ⚠, and no cannot-tell about its time" \
  "$no_program_summary" "none=0/0 dangling=0/0"

# Whether it is there cannot be told behind a directory that cannot be searched: one cannot-tell ⚠, never "not there"
# and never an older-program ⚠. --check already says it cannot tell (the program's directory cannot be searched, or the
# link there names no regular file it can see), so the time comparison adds no second ⚠ for that one cause; when
# --check has said nothing of it, the comparison's own ⚠ names the path (a row after the build-script stand-in). Root
# ignores directory permissions, so as root these fixtures cannot be made, and the table stops rather than pass.
UNSEARCHABLE_CHECK_NEEDLE="$SAMPLER_CANNOT_TELL_PREFIX Resource Pulse sampler program could not tell: "
UNSEARCHABLE_COMPARISON_NEEDLE="$SAMPLER_CANNOT_TELL_OLDER_NEEDLE: $SAMPLER_STATUS_PROGRAM_FILE, or a directory on its way, cannot be searched"
# unsearchable_program_cell <directory made unsearchable: program or link-target> [NAME=value...]: the status script
# over a newer program that is this checkout's, behind that directory, with the assignments given to the run; leaves
# "<directory>=<all ⚠>/<--check's cannot-tell>/<the comparison's cannot-tell>/<older-program ⚠> " in UNSEARCHABLE_CELL.
unsearchable_program_cell() {
  local unsearchable_directory
  if [[ "$1" == program ]]; then
    reset_sampler_status_home "$SAMPLER_STATUS_CHECKOUT_HASH" "$AFTER_SHELL_START_EPOCH"
    unsearchable_directory="$SAMPLER_STATUS_PROGRAM_DIRECTORY"
  else
    reset_sampler_status_home none
    mkdir -p "$SAMPLER_STATUS_PROGRAM_DIRECTORY" || fatal "cannot create $SAMPLER_STATUS_PROGRAM_DIRECTORY"
    write_sampler_stand_in "$SAMPLER_STATUS_LINK_TARGET" "$SAMPLER_STATUS_CHECKOUT_HASH"
    touch -d "@$AFTER_SHELL_START_EPOCH" "$SAMPLER_STATUS_LINK_TARGET" || fatal "touch -d failed"
    ln -s "$SAMPLER_STATUS_LINK_TARGET" "$SAMPLER_STATUS_PROGRAM_FILE" || fatal "cannot link the program"
    unsearchable_directory="$SAMPLER_STATUS_LINK_TARGET_DIRECTORY"
  fi
  make_fixture_unsearchable "$unsearchable_directory"
  if [[ -e "$SAMPLER_STATUS_PROGRAM_FILE" ]]; then
    chmod 755 "$unsearchable_directory"
    fatal "chmod 000 did not hide $SAMPLER_STATUS_PROGRAM_FILE (root ignores directory permissions): run this table as a normal user"
  fi
  sampler_status_run "${@:2}"
  chmod 755 "$unsearchable_directory" || fatal "chmod 755 $unsearchable_directory failed"
  UNSEARCHABLE_CELL="$1=$(status_warning_count)/$(status_warnings_naming "$UNSEARCHABLE_CHECK_NEEDLE")"
  UNSEARCHABLE_CELL+="/$(status_warnings_naming "$UNSEARCHABLE_COMPARISON_NEEDLE")/$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE") "
}
UNSEARCHABLE_DIRECTORIES=(program link-target)
unsearchable_summary=""
for unsearchable_directory_case in "${UNSEARCHABLE_DIRECTORIES[@]}"; do
  unsearchable_program_cell "$unsearchable_directory_case"
  unsearchable_summary+="$UNSEARCHABLE_CELL"
done
check "the status script: a program behind a directory that cannot be searched, or a link to one, is one cannot-tell ⚠, never 'not there' and never an older-program ⚠: --check's, and the time comparison adds none" \
  "$unsearchable_summary" "program=1/1/0/0 link-target=1/1/0/0 "

# The program's own answer to --check: said while the unit is linked, in whatever state the unit is in
# (a missing program is why it is failed), with the remedy to run the build script of the checkout the status script
# is in.
CHECKOUT_REBUILD_REMEDY="run bash $REPO_ROOT/scripts/resource-pulse-sampler-build.sh"
installed_check_summary=""
# sampler_check_cell <name>: one summary cell for the run in STATUS_REPORT_OUTPUT.
sampler_check_cell() {
  printf '%s=%s/%s/%s ' "$1" "$(status_warnings_naming "$2")" "$(status_warnings_naming "$3")" "$(status_warning_count)"
}
reset_sampler_status_home "$SAMPLER_STATUS_CHECKOUT_HASH"
sampler_status_run
installed_check_summary+="current=$(status_warning_count) "
reset_sampler_status_home "$SAMPLER_STATUS_OTHER_HASH"
sampler_status_run
installed_check_summary+="$(sampler_check_cell stale "is not this checkout's: installed hash $SAMPLER_STATUS_OTHER_HASH, checkout hash $SAMPLER_STATUS_CHECKOUT_HASH — $CHECKOUT_REBUILD_REMEDY" "$SAMPLER_CANNOT_TELL_PREFIX")"
reset_sampler_status_home none
sampler_status_run STATUS_REPORT_SERVICE_ACTIVE_STATE=failed
installed_check_summary+="$(sampler_check_cell missing-while-failed " is not installed; build and install it (it needs cargo) — $CHECKOUT_REBUILD_REMEDY" "$SAMPLER_CANNOT_TELL_PREFIX")"
reset_sampler_status_home "$SAMPLER_STATUS_OTHER_HASH"
sampler_status_run STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
installed_check_summary+="$(sampler_check_cell stale-while-inactive 'is not this checkout' "$SAMPLER_CANNOT_TELL_PREFIX")"
reset_sampler_status_home nothing
sampler_status_run
installed_check_summary+="$(sampler_check_cell prints-no-hash "$SAMPLER_CANNOT_TELL_PREFIX Resource Pulse sampler program could not tell: " 'is not this checkout')"
check "the status script: --check's answer is a ⚠ in any state of the unit: another program's hash, or none installed, says so and to run the build script; a program that prints no hash is cannot-tell; current says nothing" \
  "$installed_check_summary" \
  "current=0 stale=1/0/1 missing-while-failed=1/0/2 stale-while-inactive=1/0/2 prints-no-hash=1/0/1 "

# A program that never answers --source-hash is bounded by the time the status script gives --check to ask it, which
# sits inside the call's limit: the line is the build script's own, naming the program and that time, never that the
# call ran out. At the status script's own limits, since they are this row's subject.
PROGRAM_SILENT_NEEDLE="$SAMPLER_CANNOT_TELL_PREFIX Resource Pulse sampler program could not tell: ~/.local/lib/resource-pulse/resource-pulse-sampler did not answer --source-hash within $STATUS_PROGRAM_TIMEOUT_SECONDS s"
reset_sampler_status_home hang
hang_started_at=$SECONDS
STATUS_AT_DEFAULT_CALL_LIMITS=yes sampler_status_run
hang_took_seconds=$((SECONDS - hang_started_at))
check "the status script: a program that never answers is the build script's own cannot-tell ⚠, naming --source-hash and the time the status script gave it, and the status script ends within a bound" \
  "$(status_warnings_naming "$PROGRAM_SILENT_NEEDLE")/$(( hang_took_seconds < SAMPLER_STATUS_MAXIMUM_SECONDS ? 1 : 0 ))" "1/1"

# A stand-in for the build script, for the answers the real one gives only when HOME or a tool is broken: it logs
# each call's whole argument list, one line a call, and answers from the environment by its first argument, the mode
# (an option follows the mode). Its --check hangs (first writing its pid, which the sleep keeps, to
# STATUS_REPORT_CHECK_PID_FILE when that is set), ignores the TERM that ends a call and hangs, or answers
# STATUS_REPORT_CHECK_DELAY_SECONDS late, as STATUS_REPORT_CHECK_MODE says (hang, ignore-term, slow); the late sleep
# leaves the status script's output alone, so a call ended before it is over ends there. The closure helper is linked
# beside it, as RESOURCE_PULSE_ROOT holds both.
SAMPLER_STATUS_STUB_ROOT="$WIRING_TMP/status-report-stub-root"
SAMPLER_STATUS_STUB_SCRIPT="$SAMPLER_STATUS_STUB_ROOT/scripts/resource-pulse-sampler-build.sh"
SAMPLER_STATUS_STUB_CALLS="$WIRING_TMP/status-report-stub-build-calls"
mkdir -p "$SAMPLER_STATUS_STUB_ROOT/scripts" || fatal "cannot create $SAMPLER_STATUS_STUB_ROOT"
ln -s "$REPO_ROOT/scripts/resource-pulse-module-closure.sh" "$SAMPLER_STATUS_STUB_ROOT/scripts/resource-pulse-module-closure.sh" \
  || fatal "cannot link the closure helper into the stub root"
# shellcheck disable=SC2016  # The stub's own source: its variables expand when it runs.
SAMPLER_STATUS_STUB_SOURCE="$(printf '%s\n' '#!/usr/bin/env bash' \
  'printf "%s\n" "$*" >>"$STATUS_REPORT_BUILD_CALLS"' \
  'case "$1" in' \
  '  --check)' \
  '    case "${STATUS_REPORT_CHECK_MODE:-}" in' \
  '      hang) [[ -z "${STATUS_REPORT_CHECK_PID_FILE:-}" ]] || printf "%s\n" "$$" >"$STATUS_REPORT_CHECK_PID_FILE"; exec sleep @STAND_IN_HANG_SECONDS@ ;;' \
  '      ignore-term) trap "" TERM; exec sleep @STAND_IN_HANG_SECONDS@ ;;' \
  '      slow) sleep "${STATUS_REPORT_CHECK_DELAY_SECONDS:?}" </dev/null >/dev/null 2>&1 ;;' \
  '    esac' \
  '    printf "%s\n" "${STATUS_REPORT_CHECK_LINE-}" >&2; exit "${STATUS_REPORT_CHECK_STATUS:-0}" ;;' \
  '  --installed-path)' \
  '    installed_path="$HOME/.local/lib/resource-pulse/resource-pulse-sampler"' \
  '    case "${STATUS_REPORT_INSTALLED_PATH_MODE:-}" in' \
  '      fail) printf "  ⚠ Resource Pulse sampler program install path is not known: HOME is not set\n" >&2; exit 2 ;;' \
  '      hang) exec sleep @STAND_IN_HANG_SECONDS@ ;;' \
  '      stderr-noise) printf "a stray line on stderr\n" >&2; printf "%s\n" "$installed_path" ;;' \
  '      two-lines) printf "%s\n" "$installed_path" /a/second/line ;;' \
  '      relative) printf "%s\n" "${installed_path#"$HOME"/}" ;;' \
  '      *) printf "%s\n" "$installed_path" ;;' \
  '    esac ;;' \
  '  *) exit 64 ;;' \
  'esac')"
fill_stand_in_hang SAMPLER_STATUS_STUB_SOURCE
printf '%s\n' "$SAMPLER_STATUS_STUB_SOURCE" >"$SAMPLER_STATUS_STUB_SCRIPT" || fatal "cannot write $SAMPLER_STATUS_STUB_SCRIPT"
# stub_build_run_over <program: a hash, nothing, hang or none> <program mtime, or '' for the default> [NAME=value...]:
# the status script asking the stand-in, over that installed program; leaves the modes of the calls it got in
# SAMPLER_STATUS_BUILD_CALLS_SEEN ("--check --installed-path "), their whole argument lists in
# SAMPLER_STATUS_BUILD_ARGV_SEEN ("[--check …] [--installed-path] "), and how long the status script took in
# STUB_BUILD_RUN_SECONDS. The stand-in's
# --installed-path answers as STATUS_REPORT_INSTALLED_PATH_MODE says:
# the path (unset), fail (exit 2 with a ⚠ on stderr, as the real one for a HOME that names no path), hang,
# stderr-noise (a stray stderr line beside the path), two-lines, or relative.
stub_build_run_over() {
  local run_started_at
  : >"$SAMPLER_STATUS_STUB_CALLS"
  reset_sampler_status_home "$1" "$2"
  run_started_at=$SECONDS
  sampler_status_run "RESOURCE_PULSE_ROOT=$SAMPLER_STATUS_STUB_ROOT" "STATUS_REPORT_BUILD_CALLS=$SAMPLER_STATUS_STUB_CALLS" "${@:3}"
  STUB_BUILD_RUN_SECONDS=$((SECONDS - run_started_at))
  SAMPLER_STATUS_BUILD_CALLS_SEEN="$(cut -d ' ' -f 1 <"$SAMPLER_STATUS_STUB_CALLS" | tr '\n' ' ')"
  SAMPLER_STATUS_BUILD_ARGV_SEEN="$(sed 's/.*/[&]/' "$SAMPLER_STATUS_STUB_CALLS" | tr '\n' ' ')"
}
# stub_build_bounded_flag: 1 when the last stub_build_run_over ended within SAMPLER_STATUS_MAXIMUM_SECONDS, else 0.
stub_build_bounded_flag() { printf '%s' "$(( STUB_BUILD_RUN_SECONDS < SAMPLER_STATUS_MAXIMUM_SECONDS ? 1 : 0 ))"; }
# stub_build_run [NAME=value...]: stub_build_run_over with no program installed.
stub_build_run() { stub_build_run_over none '' "$@"; }
STUB_CHECK_LINE='  ⚠ Resource Pulse sampler program stand-in line'
stub_summary=""
stub_build_run STATUS_REPORT_CHECK_STATUS=0 "STATUS_REPORT_CHECK_LINE=  ✓ Resource Pulse sampler program stand-in current"
stub_summary+="current=$(status_warning_count) calls=[$SAMPLER_STATUS_BUILD_CALLS_SEEN] "
stub_build_run STATUS_REPORT_CHECK_STATUS=1 "STATUS_REPORT_CHECK_LINE=$STUB_CHECK_LINE"
stub_summary+="stale=$(rg -c -x -F -- "  ⚠ Resource Pulse sampler program stand-in line — run bash $SAMPLER_STATUS_STUB_SCRIPT" <<<"$STATUS_REPORT_OUTPUT") "
stub_build_run STATUS_REPORT_CHECK_STATUS=2 "STATUS_REPORT_CHECK_LINE=$STUB_CHECK_LINE"
stub_summary+="check-cannot-tell=$(rg -c -x -F -- "  ⚠ $SAMPLER_CANNOT_TELL_PREFIX Resource Pulse sampler program stand-in line" <<<"$STATUS_REPORT_OUTPUT")"
check "the status script: --check saying 0 says nothing; 1 gives its line and then ' — run bash <the build script it asked>'; 2 is a cannot-tell naming its line" \
  "$stub_summary" \
  "current=0 calls=[--check --installed-path ] stale=1 check-cannot-tell=1"
# --check alone asks the installed program, so it alone is given the time for that (the option after the mode, as the
# build script's usage line has it); --installed-path is given nothing but its mode.
stub_build_run STATUS_REPORT_CHECK_STATUS=0 "STATUS_REPORT_CHECK_LINE=  ✓ Resource Pulse sampler program stand-in current"
check "the status script gives --check, and only --check, --program-timeout-seconds $STATUS_PROGRAM_TIMEOUT_SECONDS after its mode" \
  "$SAMPLER_STATUS_BUILD_ARGV_SEEN" \
  "[--check --program-timeout-seconds $STATUS_PROGRAM_TIMEOUT_SECONDS] [--installed-path] "
stub_odd_summary=""
stub_build_run STATUS_REPORT_CHECK_STATUS=3
stub_odd_summary+="check-3=$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX bash $SAMPLER_STATUS_STUB_SCRIPT --check could not be run, or answered with status 3") "
# timeout's own two statuses are a time-out only when the call ran to its limit: a --check that exits 124 at once
# answered with it.
stub_build_run STATUS_REPORT_CHECK_STATUS=124
stub_odd_summary+="check-124-at-once=$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX bash $SAMPLER_STATUS_STUB_SCRIPT --check could not be run, or answered with status 124") "
# The calls that do not end run at the status script's own limits, the subject of these cells: each says the limit it
# ran out, within that limit, the kill-after for a call that ignores its TERM (killed, so timeout says 137), and the
# margin.
BUILD_CALL_RAN_OUT_TEXT="did not end within $STATUS_BUILD_CALL_LIMIT_SECONDS s"
STATUS_AT_DEFAULT_CALL_LIMITS=yes stub_build_run STATUS_REPORT_CHECK_MODE=hang
stub_odd_summary+="check-hang=$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX bash $SAMPLER_STATUS_STUB_SCRIPT --check $BUILD_CALL_RAN_OUT_TEXT")/bounded=$(stub_build_bounded_flag) "
STATUS_AT_DEFAULT_CALL_LIMITS=yes stub_build_run STATUS_REPORT_CHECK_MODE=ignore-term
stub_odd_summary+="check-ignores-term=$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX bash $SAMPLER_STATUS_STUB_SCRIPT --check $BUILD_CALL_RAN_OUT_TEXT")/bounded=$(stub_build_bounded_flag) "
stub_build_run "RESOURCE_PULSE_ROOT=$WIRING_TMP/no-such-checkout"
stub_odd_summary+="no-script=$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX bash $WIRING_TMP/no-such-checkout/scripts/resource-pulse-sampler-build.sh --check could not be run, or answered with status 127")"
check "the status script: a --check that ends with another status or does not end within its limit, and a build script that is not there, are each one cannot-tell ⚠, never silence" \
  "$stub_odd_summary" \
  "check-3=1 check-124-at-once=1 check-hang=1/bounded=1 check-ignores-term=1/bounded=1 no-script=1"

# When --check has said nothing about a program behind a directory that cannot be searched (the stand-in answers
# current), the time comparison's own cannot-tell ⚠ names the path: still one ⚠, never 'not there' and never an
# older-program ⚠.
unsearchable_comparison_summary=""
for unsearchable_directory_case in "${UNSEARCHABLE_DIRECTORIES[@]}"; do
  unsearchable_program_cell "$unsearchable_directory_case" "RESOURCE_PULSE_ROOT=$SAMPLER_STATUS_STUB_ROOT" \
    "STATUS_REPORT_BUILD_CALLS=$SAMPLER_STATUS_STUB_CALLS" STATUS_REPORT_CHECK_STATUS=0
  unsearchable_comparison_summary+="$UNSEARCHABLE_CELL"
done
check "the status script: a program behind a directory that cannot be searched, or a link to one, with a --check that says current, is the time comparison's one cannot-tell ⚠ naming the path, never an older-program ⚠" \
  "$unsearchable_comparison_summary" "program=1/0/1/0 link-target=1/0/1/0 "

# A terminal's Ctrl-C is SIGINT to its foreground process group, and each build-script call runs in that group
# (timeout --foreground), so the interrupt reaches a call that never ends; plain timeout would move the call into a group
# of its own, which no Ctrl-C reaches. Here the status script leads a session of its own (setsid) with SIGINT at its
# default (env --default-signal: a background job of this table starts with it ignored), its --check never ends and
# writes its pid first, and the group is sent SIGINT, as a terminal does. The call's limits are unhurried, so only the
# signal can end it within the wait.
INTERRUPT_ROW_WAIT_SECONDS=10
INTERRUPT_ROW_POLL_INTERVAL_SECONDS=0.1
INTERRUPT_ROW_POLLS_PER_SECOND=10
INTERRUPTED_CHECK_PID_FILE="$WIRING_TMP/status-report-interrupted-check-pid"
# process_has_ended <pid>: succeeds when the process is gone, or a zombie its parent has not reaped yet.
process_has_ended() {
  local stat_line
  stat_line="$(cat "/proc/$1/stat" 2>/dev/null)" || return 0
  [[ "${stat_line##*) }" == Z* ]]
}
# poll_until <command...>: runs the command every INTERRUPT_ROW_POLL_INTERVAL_SECONDS until it succeeds, for at most
# INTERRUPT_ROW_WAIT_SECONDS; fails when it never did.
poll_until() {
  local poll_round
  for (( poll_round = 0; poll_round < INTERRUPT_ROW_WAIT_SECONDS * INTERRUPT_ROW_POLLS_PER_SECOND; poll_round++ )); do
    "$@" && return 0
    sleep "$INTERRUPT_ROW_POLL_INTERVAL_SECONDS"
  done
  return 1
}
: >"$SAMPLER_STATUS_STUB_CALLS"
: >"$INTERRUPTED_CHECK_PID_FILE"
reset_sampler_status_home none
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
prepare_status_report_command "$ASKED_FOR_SETTING" true "HOME=$SAMPLER_STATUS_HOME" "$STATUS_SERVICE_STARTED_AT" \
  "RESOURCE_PULSE_ROOT=$SAMPLER_STATUS_STUB_ROOT" "STATUS_REPORT_BUILD_CALLS=$SAMPLER_STATUS_STUB_CALLS" \
  STATUS_REPORT_CHECK_MODE=hang "STATUS_REPORT_CHECK_PID_FILE=$INTERRUPTED_CHECK_PID_FILE"
setsid "$(type -P env)" --default-signal=INT "${STATUS_REPORT_COMMAND[@]}" >/dev/null 2>&1 </dev/null &
interrupted_status_pid=$!
interrupted_check_state="not-started"
if poll_until test -s "$INTERRUPTED_CHECK_PID_FILE"; then
  interrupted_check_pid="$(<"$INTERRUPTED_CHECK_PID_FILE")"
  kill -INT -- "-$interrupted_status_pid" 2>/dev/null
  if poll_until process_has_ended "$interrupted_check_pid"; then
    interrupted_check_state="ended"
  else
    # Only a stand-in still running is ended here: the pid of one that ended may already be another process's.
    interrupted_check_state="still-running"
    kill -KILL "$interrupted_check_pid" 2>/dev/null
  fi
fi
# The status script itself ends on the SIGINT; a group still running (the stand-in never started) is ended, never left.
poll_until process_has_ended "$interrupted_status_pid" || kill -KILL -- "-$interrupted_status_pid" 2>/dev/null
wait "$interrupted_status_pid" 2>/dev/null
check "the status script: a Ctrl-C (SIGINT to its process group) reaches a build-script call that never ends, which runs in the status script's own group" \
  "$interrupted_check_state" "ended"

# RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS replaces both of the status script's call limits, the build script's and
# systemctl's: at 60, a --check that answers a second past the build-script call's limit, and a systemctl that answers
# the sampler's state a second past its own, are answers, with no ⚠; and gdbus's own reply timeout moves with them, a
# second inside the limit, so a GetState ⚠ naming the limit would be true.
SLOW_CALLS_RUN=(STATUS_REPORT_CHECK_MODE=slow "STATUS_REPORT_CHECK_DELAY_SECONDS=$STATUS_SLOW_BUILD_CALL_SECONDS"
  STATUS_REPORT_SYSTEMCTL_MODE=late-state-answer "STATUS_REPORT_SYSTEMCTL_LATE_SECONDS=$STATUS_LATE_SYSTEMCTL_SECONDS"
  "STATUS_REPORT_CHECK_LINE=  ✓ Resource Pulse sampler program stand-in current")
# status_gdbus_reply_timeouts: the --timeout each gdbus call got, in the order they were made.
status_gdbus_reply_timeouts() {
  # shellcheck disable=SC2016  # rg's replacement, the pattern's first group.
  rg -o -r '$1' '^gdbus .* --timeout ([0-9]+)$' "$STATUS_REPORT_CALLS" | tr '\n' ' '
}
stub_build_run "${SLOW_CALLS_RUN[@]}" "RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS=$UNHURRIED_STATUS_CALL_LIMIT_SECONDS"
call_limit_override_summary="service=[$(status_service_line)] warnings=$(status_warning_count)"
call_limit_override_summary+=" calls=[$SAMPLER_STATUS_BUILD_CALLS_SEEN] gdbus-timeout=[$(status_gdbus_reply_timeouts)]"
check "the status script: with RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS at $UNHURRIED_STATUS_CALL_LIMIT_SECONDS, a --check ${STATUS_SLOW_BUILD_CALL_SECONDS} s long and a systemctl answering ${STATUS_LATE_SYSTEMCTL_SECONDS} s late are answers, with no ⚠, and gdbus waits ${UNHURRIED_REPLY_TIMEOUT_SECONDS} s for its reply" \
  "$call_limit_override_summary" \
  "service=[active, protocol 1, last sample 3 s ago] warnings=0 calls=[--check --installed-path ] gdbus-timeout=[$UNHURRIED_REPLY_TIMEOUT_SECONDS ]"
# At the smallest override, a second inside it would be 0, and gdbus gives up at once on --timeout 0 (probed on GLib
# 2.88: "Timeout was reached" even from the bus daemon), so every GetState would be a ⚠: the reply timeout stays 1 s.
SMALLEST_CALL_LIMIT_OVERRIDE_SECONDS=1
stub_build_run "RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS=$SMALLEST_CALL_LIMIT_OVERRIDE_SECONDS"
check "the status script: with RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS at $SMALLEST_CALL_LIMIT_OVERRIDE_SECONDS, gdbus waits ${STATUS_SHORTEST_REPLY_TIMEOUT_SECONDS} s for its reply, never 0 s" \
  "gdbus-timeout=[$(status_gdbus_reply_timeouts)]" "gdbus-timeout=[$STATUS_SHORTEST_REPLY_TIMEOUT_SECONDS ]"
# Set to anything but a whole number from 1 (empty included: set is set), it
# is a ⚠ naming the value it got, and the defaults hold, as `timeout 0` would mean no limit: the --check runs out at its
# own limit (a second ⚠) and systemctl at its own (the sampler's state unknown).
# call_limit_rejected_needle <value>: the ⚠ for that value, unique to it.
call_limit_rejected_needle() {
  printf "RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS is '%s', not a whole number of seconds from 1, so the default limits hold (%s s for systemctl and gdbus, %s s for the build script)" \
    "$1" "$STATUS_CALL_LIMIT_SECONDS" "$STATUS_BUILD_CALL_LIMIT_SECONDS"
}
call_limit_ignored_summary=""
for ignored_call_limit in 0 x ''; do
  stub_build_run "${SLOW_CALLS_RUN[@]}" "RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS=$ignored_call_limit"
  call_limit_ignored_summary+="[$ignored_call_limit]=$(status_warnings_naming "$(call_limit_rejected_needle "$ignored_call_limit")")"
  call_limit_ignored_summary+="/$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX bash $SAMPLER_STATUS_STUB_SCRIPT --check $BUILD_CALL_RAN_OUT_TEXT")/$(status_warning_count)/service=[$(status_service_line)] "
done
check "the status script: a RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS of 0, x or empty is a ⚠ naming the value, and its own limits hold, the build script's and systemctl's" \
  "$call_limit_ignored_summary" \
  "[0]=1/1/2/service=[unknown (no systemd user manager answered)] [x]=1/1/2/service=[unknown (no systemd user manager answered)] []=1/1/2/service=[unknown (no systemd user manager answered)] "

# Where the program is installed is --installed-path's answer alone. One that fails (exit 2, its ⚠ on stderr) or does
# not end within its limit leaves the older-program question unanswered: a cannot-tell ⚠, never silence, and never an
# older-program ⚠ guessed from the usual path (a newer program is installed there). One that ran out of its limit says
# the limit, as --check does; the one that failed is that line exactly, with no limit it never reached.
INSTALLED_PATH_NOT_KNOWN_NEEDLE="$SAMPLER_CANNOT_TELL_OLDER_NEEDLE: where it is installed is not known — bash $SAMPLER_STATUS_STUB_SCRIPT --installed-path"
installed_path_unknown_summary=""
stub_build_run_over "$SAMPLER_STATUS_CHECKOUT_HASH" "$AFTER_SHELL_START_EPOCH" STATUS_REPORT_INSTALLED_PATH_MODE=fail
installed_path_unknown_summary+="fail=$(grep -c -x -F -- "  ⚠ $INSTALLED_PATH_NOT_KNOWN_NEEDLE" <<<"$STATUS_REPORT_OUTPUT")/$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warning_count) "
# The call that does not end runs at the status script's own limits, its subject.
STATUS_AT_DEFAULT_CALL_LIMITS=yes stub_build_run_over "$SAMPLER_STATUS_CHECKOUT_HASH" "$AFTER_SHELL_START_EPOCH" \
  STATUS_REPORT_INSTALLED_PATH_MODE=hang
installed_path_unknown_summary+="hang=$(status_warnings_naming "$INSTALLED_PATH_NOT_KNOWN_NEEDLE $BUILD_CALL_RAN_OUT_TEXT")/$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warning_count)"
installed_path_unknown_summary+="/bounded=$(stub_build_bounded_flag)"
check "the status script: an --installed-path that fails (exit 2, its ⚠ on stderr) or does not end within its limit (naming the limit) is one cannot-tell ⚠ that where the program is installed is not known, never silence and never an older-program ⚠" \
  "$installed_path_unknown_summary" "fail=1/0/1 hang=1/0/1/bounded=1"

# Its answer is its stdout alone, and only as one absolute line: a stray line on its stderr beside a good path still
# answers (the newer program there is the older-program ⚠); two lines, or a relative path, is "not known", never a
# path made from them.
installed_path_shape_summary=""
for installed_path_mode in stderr-noise two-lines relative; do
  stub_build_run_over "$SAMPLER_STATUS_CHECKOUT_HASH" "$AFTER_SHELL_START_EPOCH" \
    "STATUS_REPORT_INSTALLED_PATH_MODE=$installed_path_mode"
  installed_path_shape_summary+="$installed_path_mode=$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_warnings_naming "$INSTALLED_PATH_NOT_KNOWN_NEEDLE") "
done
check "the status script reads --installed-path's stdout alone, as one absolute line: a stray line on its stderr beside a good path still answers; two lines, or a relative path, is 'not known'" \
  "$installed_path_shape_summary" "stderr-noise=1/0 two-lines=0/1 relative=0/1 "

# One ⚠ for one cause: a --check that cannot tell beside an --installed-path that fails (a HOME that names no path
# fails both), or a build script that is not there (both calls fail), is --check's cannot-tell ⚠ alone, never a second
# that where the program is installed is not known. Counted: every ⚠ line for the first, whose run has no other fault;
# the ⚠ lines naming the build script at all for the second, whose missing root holds no closure helper either.
BUILD_SCRIPT_FILE_NAME="resource-pulse-sampler-build.sh"
INSTALLED_PATH_NOT_KNOWN_TEXT="where it is installed is not known"
one_cause_summary=""
stub_build_run STATUS_REPORT_CHECK_STATUS=2 "STATUS_REPORT_CHECK_LINE=$STUB_CHECK_LINE" STATUS_REPORT_INSTALLED_PATH_MODE=fail
one_cause_summary+="check-and-installed-path=$(status_warning_count)/$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX Resource Pulse sampler program stand-in line")/$(status_warnings_naming "$INSTALLED_PATH_NOT_KNOWN_TEXT") "
stub_build_run "RESOURCE_PULSE_ROOT=$WIRING_TMP/no-such-checkout"
one_cause_summary+="no-script=$(status_warnings_naming "$BUILD_SCRIPT_FILE_NAME")/$(status_warnings_naming "$SAMPLER_CANNOT_TELL_PREFIX bash $WIRING_TMP/no-such-checkout/scripts/$BUILD_SCRIPT_FILE_NAME --check could not be run")/$(status_warnings_naming "$INSTALLED_PATH_NOT_KNOWN_TEXT")"
check "the status script says one ⚠ for one cause: a --check that cannot tell beside an --installed-path that fails, or a build script that is not there, is --check's cannot-tell ⚠ alone, with no second that where the program is installed is not known" \
  "$one_cause_summary" "check-and-installed-path=1/1/0 no-script=1/1/0"

# The unit is asked about only while the extension is linked: a home without the link never reaches the script.
: >"$SAMPLER_STATUS_STUB_CALLS"
reset_sampler_status_home none
rm -f "$SAMPLER_STATUS_HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID" || fatal "cannot unlink the fixture extension"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$SAMPLER_STATUS_HOME" "$STATUS_SERVICE_STARTED_AT" \
  "RESOURCE_PULSE_ROOT=$SAMPLER_STATUS_STUB_ROOT" "STATUS_REPORT_BUILD_CALLS=$SAMPLER_STATUS_STUB_CALLS" \
  STATUS_REPORT_CHECK_STATUS=1 "STATUS_REPORT_CHECK_LINE=$STUB_CHECK_LINE"
check "the status script: an extension that is not linked never asks the build script, whatever --check would answer" \
  "calls=$(wc -c <"$SAMPLER_STATUS_STUB_CALLS" | tr -d ' ') warnings=$(status_warnings_naming 'sampler program')" "calls=0 warnings=0"

# With no RESOURCE_PULSE_ROOT, the root is the checkout the script itself sits in, its own path resolved first
# (readlink -f): run through a link in another directory, as ./<link> from that directory, it asks the build script
# beside the file the link names, never one found from the link's path or the working directory. A stand-in root of
# the row's own holds a copy of the script and, beside it, a copy of the build-script stand-in, which logs each call;
# the link is in a fresh directory, and the home has the extension linked, so the build script is asked.
LINKED_COPY_ROOT="$WIRING_TMP/status-report-linked-copy-root"
LINKED_COPY_LINK_DIRECTORY="$WIRING_TMP/status-report-link-directory"
LINKED_COPY_BUILD_CALLS="$WIRING_TMP/status-report-linked-copy-build-calls"
STATUS_SCRIPT_FILE_NAME="${STATUS_SCRIPT##*/}"
mkdir -p "$LINKED_COPY_ROOT/scripts" "$LINKED_COPY_LINK_DIRECTORY" || fatal "cannot create the linked copy's fixture"
cp "$STATUS_SCRIPT" "$LINKED_COPY_ROOT/scripts/$STATUS_SCRIPT_FILE_NAME" || fatal "cannot copy the status script"
cp "$SAMPLER_STATUS_STUB_SCRIPT" "$LINKED_COPY_ROOT/scripts/$BUILD_SCRIPT_FILE_NAME" \
  || fatal "cannot copy the build-script stand-in"
ln -s "$LINKED_COPY_ROOT/scripts/$STATUS_SCRIPT_FILE_NAME" "$LINKED_COPY_LINK_DIRECTORY/$STATUS_SCRIPT_FILE_NAME" \
  || fatal "cannot link the status script's copy"
: >"$LINKED_COPY_BUILD_CALLS"
prepare_status_report_command "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" \
  "STATUS_REPORT_BUILD_CALLS=$LINKED_COPY_BUILD_CALLS"
[[ "${STATUS_REPORT_COMMAND[-1]}" == "$STATUS_SCRIPT" ]] \
  || fatal "the status command ends with '${STATUS_REPORT_COMMAND[-1]}', not the status script"
STATUS_REPORT_COMMAND[-1]="./$STATUS_SCRIPT_FILE_NAME"
STATUS_REPORT_OUTPUT="$(cd "$LINKED_COPY_LINK_DIRECTORY" && "${STATUS_REPORT_COMMAND[@]}" 2>&1)"
require_whole_status_report $?
check "the status script: run through a symlink from another directory, with no RESOURCE_PULSE_ROOT, it asks its own checkout's build script" \
  "asked-check=$(grep -c -x -F -- "--check --program-timeout-seconds $STATUS_PROGRAM_TIMEOUT_SECONDS" "$LINKED_COPY_BUILD_CALLS")" "asked-check=1"

# The linked home again, under a directory named a&b: from bash 5.2 a & in the replacement of "${list[@]/#/<dir>/}"
# stands for the matched text, so module paths built that way would name a directory that is not there.
STATUS_REPORT_AMPERSAND_LINKED_HOME="$WIRING_TMP/a&b/status-report-linked-home"
mkdir -p "$STATUS_REPORT_AMPERSAND_LINKED_HOME/.local/share/gnome-shell/extensions" \
  || fatal "cannot create the status script's linked fixture home under a&b"
ln -s "$STATUS_EXTENSION_DIR" "$STATUS_REPORT_AMPERSAND_LINKED_HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID" \
  || fatal "cannot link the status script's fixture extension under a&b"
older_copy_summary=""
OLDER_COPY_NEEDLE='the desktop runs an older copy; takes effect at next login'
reset_status_extension "$AFTER_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME"
older_copy_summary+="card=$(status_warnings_naming "$OLDER_COPY_NEEDLE (card.js changed after this login)")"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_AMPERSAND_LINKED_HOME"
older_copy_summary+=" ampersand-home-card=$(status_warnings_naming "$OLDER_COPY_NEEDLE (card.js changed after this login)")"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" STATUS_REPORT_SHELL_PID=
older_copy_summary+=" no-shell=$(status_warnings_naming "$OLDER_COPY_NEEDLE")"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" STATUS_REPORT_SHELL_STATE=
older_copy_summary+=" unknown-to-shell=$(status_warnings_naming "$OLDER_COPY_NEEDLE")"
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$AFTER_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME"
older_copy_summary+=" lib=$(status_warnings_naming "$OLDER_COPY_NEEDLE (lib/format.js changed after this login)")"
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$AFTER_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME"
older_copy_summary+=" service-only=$(status_warnings_naming "$OLDER_COPY_NEEDLE")"
# GNOME re-reads the stylesheet at every enable, so a CSS-only change is not an older copy.
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" \
  "$AFTER_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME"
older_copy_summary+=" css-only=$(status_warnings_naming "$OLDER_COPY_NEEDLE")"
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME"
older_copy_summary+=" unchanged=$(status_warnings_naming "$OLDER_COPY_NEEDLE")"
older_copy_summary+=" pgrep=[$(grep '^pgrep ' "$STATUS_REPORT_CALLS")]"
check "the status script: drawing code (*.js, lib/) newer than the desktop's gnome-shell says the desktop runs an older copy, and only then" \
  "$older_copy_summary" \
  "card=1 ampersand-home-card=1 no-shell=0 unknown-to-shell=0 lib=1 service-only=0 css-only=0 unchanged=0 pgrep=[pgrep -o -x -u $(id -u) gnome-shell]"
# The shell side is extension.js and what it imports: a module only
# the cockpit service runs never makes the desktop's copy older.
older_copy_by_side_summary=""
for changed_module in lib/sessions.js lib/visibility.js lib/cockpitProtocol.js; do
  status_extension_with_change "$changed_module"
  status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME"
  older_copy_by_side_summary+="$changed_module=$(status_warnings_naming "$OLDER_COPY_NEEDLE ($changed_module changed")/$(status_warnings_naming "$OLDER_COPY_NEEDLE") "
done
check "the status script: the older copy follows extension.js's imports: a cockpit-only module (lib/sessions.js) is none, a shell-only (lib/visibility.js) or shared one (lib/cockpitProtocol.js) is one" \
  "$older_copy_by_side_summary" "lib/sessions.js=0/0 lib/visibility.js=1/1 lib/cockpitProtocol.js=1/1 "
# A closure it cannot work out (a shape the helper refuses, or no helper at all)
# must say so on each side that has one, the shell's and the cockpit's: silence
# would read as "the code is current". The sampler has none (it is a program),
# so neither shape says anything about it.
CANNOT_TELL_COPY_NEEDLE='cannot tell whether the desktop runs an older copy'
CANNOT_TELL_CODE_NEEDLE='cannot tell whether resource-pulse-cockpit.service runs older code'
CANNOT_TELL_SAMPLER_CODE_NEEDLE='cannot tell whether resource-pulse.service runs older code'
CANNOT_TELL_COCKPIT_RUN=(STATUS_REPORT_COCKPIT_ACTIVE_STATE=active
  "STATUS_REPORT_COCKPIT_STARTED_AT=$(unit_timestamp_us_utc "$SUITE_STARTED_AT_EPOCH" "$UNIT_START_MICROSECONDS")")
cannot_tell_summary=""
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
printf '%s\n' 'const loaded = await import(modulePath);' >"$STATUS_EXTENSION_DIR/extension.js"
printf '%s\n' 'const loaded = await import(modulePath);' >"$STATUS_EXTENSION_DIR/service/cockpit.js"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" "${CANNOT_TELL_COCKPIT_RUN[@]}"
cannot_tell_summary+="refused=$(status_warnings_naming "$CANNOT_TELL_COPY_NEEDLE")/$(status_warnings_naming "$CANNOT_TELL_CODE_NEEDLE")/sampler:$(status_warnings_naming "$CANNOT_TELL_SAMPLER_CODE_NEEDLE")"
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" \
  "${CANNOT_TELL_COCKPIT_RUN[@]}" "RESOURCE_PULSE_ROOT=$WIRING_TMP/no-such-checkout"
cannot_tell_summary+=" no-helper=$(status_warnings_naming "$CANNOT_TELL_COPY_NEEDLE")/$(status_warnings_naming "$CANNOT_TELL_CODE_NEEDLE")/sampler:$(status_warnings_naming "$CANNOT_TELL_SAMPLER_CODE_NEEDLE")"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" "${CANNOT_TELL_COCKPIT_RUN[@]}"
cannot_tell_summary+=" working=$(status_warnings_naming 'cannot tell')"
check "the status script: an import closure it cannot work out (the helper refuses a shape, or there is none) is a ⚠ on the shell's side and the cockpit's that it cannot tell, never silence, and never one about the sampler" \
  "$cannot_tell_summary" "refused=1/1/sampler:0 no-helper=1/1/sampler:0 working=0"
# A closure helper that succeeds and prints nothing has listed no module, which is not "no module changed": it gives
# the same cannot-tell ⚠ as one that refuses (the row above), on the shell's side and the cockpit's. The helper is the row's own, in a stand-in root of its own beside a copy
# of the build-script stand-in (SAMPLER_STATUS_STUB_ROOT's helper is a link to the checkout's, never written): it logs
# the entry module it was asked about, so the row proves each side asked it, and prints nothing.
CLOSURE_HELPER_FILE_NAME="resource-pulse-module-closure.sh"
EMPTY_CLOSURE_ROOT="$WIRING_TMP/status-report-empty-closure-root"
EMPTY_CLOSURE_HELPER_CALLS="$WIRING_TMP/status-report-empty-closure-helper-calls"
mkdir -p "$EMPTY_CLOSURE_ROOT/scripts" || fatal "cannot create $EMPTY_CLOSURE_ROOT"
cp "$SAMPLER_STATUS_STUB_SCRIPT" "$EMPTY_CLOSURE_ROOT/scripts/$BUILD_SCRIPT_FILE_NAME" \
  || fatal "cannot copy the build-script stand-in into $EMPTY_CLOSURE_ROOT"
# shellcheck disable=SC2016  # The helper's own $2 must stay literal.
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$2" >>%q\nexit 0\n' "$EMPTY_CLOSURE_HELPER_CALLS" \
  >"$EMPTY_CLOSURE_ROOT/scripts/$CLOSURE_HELPER_FILE_NAME" || fatal "cannot write the empty closure helper"
: >"$EMPTY_CLOSURE_HELPER_CALLS"
: >"$SAMPLER_STATUS_STUB_CALLS"
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" \
  "${CANNOT_TELL_COCKPIT_RUN[@]}" "RESOURCE_PULSE_ROOT=$EMPTY_CLOSURE_ROOT" "STATUS_REPORT_BUILD_CALLS=$SAMPLER_STATUS_STUB_CALLS"
empty_closure_summary="asked=[$(tr '\n' ' ' <"$EMPTY_CLOSURE_HELPER_CALLS")]"
empty_closure_summary+=" empty=$(status_warnings_naming "$CANNOT_TELL_COPY_NEEDLE")/$(status_warnings_naming "$CANNOT_TELL_CODE_NEEDLE")"
empty_closure_summary+="/sampler:$(status_warnings_naming "$CANNOT_TELL_SAMPLER_CODE_NEEDLE")"
check "the status script: a closure helper that succeeds and prints nothing is the cannot-tell ⚠, never 'nothing changed'" \
  "$empty_closure_summary" "asked=[service/cockpit.js extension.js ] empty=1/1/sampler:0"
# Until the next login the desktop may run an older copy of the extension, one
# that need not start the service: while the older copy is reported, a service
# not running is not blamed as well. With the current copy it is.
NOT_RUNNING_NEEDLE='is not running while the extension is enabled'
not_running_beside_older_copy_summary=""
status_extension_with_change card.js
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
not_running_beside_older_copy_summary+="older-copy=$(status_warnings_naming "$OLDER_COPY_NEEDLE")/$(status_warnings_naming "$NOT_RUNNING_NEEDLE")"
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" STATUS_REPORT_SERVICE_ACTIVE_STATE=inactive
not_running_beside_older_copy_summary+=" current-copy=$(status_warnings_naming "$OLDER_COPY_NEEDLE")/$(status_warnings_naming "$NOT_RUNNING_NEEDLE")"
check "the status script: while the desktop runs an older copy (one that need not start the service), a service not running is not blamed; with the current copy it is" \
  "$not_running_beside_older_copy_summary" "older-copy=1/0 current-copy=0/1"

# The cockpit unit, resource-pulse-cockpit.service: opt-in by file, so for anyone without
# ~/.config/resource-pulse/cockpit.json systemd skips every start (loaded,
# inactive, ConditionResult=no), which is no fault. A unit never started reads
# ConditionResult=no too (systemd's default before any check, measured on a
# system unit), so with the file present that state is a unit not started.
STATUS_REPORT_COCKPIT_HOME="$WIRING_TMP/status-report-cockpit-home"
if ! mkdir -p "$STATUS_REPORT_COCKPIT_HOME/.config/resource-pulse" ||
  ! cp "$REPO_ROOT/examples/resource-pulse-cockpit.json.template" "$STATUS_REPORT_COCKPIT_HOME/.config/resource-pulse/cockpit.json"; then
  fatal "cannot create the status script's opted-in fixture home"
fi
COCKPIT_DEST_NEEDLE='--dest io.github.zvibaratz.ResourcePulse.Cockpit1 '
COCKPIT_JOURNAL_HINT='journalctl --user -u resource-pulse-cockpit.service -e'
status_cockpit_gdbus_calls() { grep -c -F -e "$COCKPIT_DEST_NEEDLE" "$STATUS_REPORT_CALLS"; }
cockpit_skipped_summary=""
status_report_run "$ASKED_FOR_SETTING" true
cockpit_skipped_summary+="no-config=[$(status_cockpit_line)]/$(status_warning_count)/$(status_cockpit_gdbus_calls)"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_COCKPIT_HOME"
cockpit_skipped_summary+=" config-never-started=[$(status_cockpit_line)]/$(status_warnings_naming 'resource-pulse-cockpit.service is not running though ~/.config/resource-pulse/cockpit.json exists — systemctl --user start resource-pulse-cockpit.service')/$(status_cockpit_gdbus_calls)"
check "the status script: a cockpit unit skipped by its condition reads skipped while the config file is absent, and warns nothing; with the file, the same state is a unit not started, with the start remedy" \
  "$cockpit_skipped_summary" \
  "no-config=[skipped (no ~/.config/resource-pulse/cockpit.json)]/0/0 config-never-started=[inactive (not running)]/1/0"
# The unit's condition (%E) and the service (GLib's user config dir) both look
# under $XDG_CONFIG_HOME when it is set, so the status script does too: the file under
# it opts in from a HOME without one, and a HOME's file does not count past it.
cockpit_config_home_summary=""
status_report_run "$ASKED_FOR_SETTING" true "XDG_CONFIG_HOME=$STATUS_REPORT_COCKPIT_HOME/.config"
cockpit_config_home_summary+="file-under-it=[$(status_cockpit_line)]"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_COCKPIT_HOME" "XDG_CONFIG_HOME=$WIRING_TMP/no-such-config-home"
cockpit_config_home_summary+=" file-only-in-home=[$(status_cockpit_line)]"
check "the status script: with XDG_CONFIG_HOME set, the cockpit's config file is the one under it, as the unit's %E and the service read it" \
  "$cockpit_config_home_summary" \
  "file-under-it=[inactive (not running)] file-only-in-home=[skipped (no ~/.config/resource-pulse/cockpit.json)]"

# Fresh: sources 3, 3 and 2 s old, the latest publish 4 s ago. The latest
# publish is the latest Changed (or the start), so a quiet service's is old,
# and that is no fault.
QUIET_PUBLISH_AGE_SECONDS=2100
cockpit_fresh_summary=""
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=active
cockpit_fresh_summary+="fresh=[$(status_cockpit_line)]/$(status_warning_count)"
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=active \
  "STATUS_REPORT_COCKPIT_STATE_JSON=$(cockpit_state_json 3 3 2 null "$QUIET_PUBLISH_AGE_SECONDS")"
cockpit_fresh_summary+=" quiet=[$(status_cockpit_line)]/$(status_warning_count)"
check "the status script: an active cockpit shows its protocol, the age of its last publish and no stale source, from GetState; a quiet one's old publish is no fault" \
  "$cockpit_fresh_summary" \
  "fresh=[active, protocol 1, last publish 4 s ago, stale: none]/0 quiet=[active, protocol 1, last publish 35 min ago, stale: none]/0"

# A source is stale past three of its own intervals (mounts: 3 × 30 s = 90 s),
# each read from its own object: mounts comes last, so a read of the first
# stamp in the sources for every source would find none stale.
cockpit_stale_summary=""
for stale_case in "at-limit:3 3 90" "past-limit:3 3 91" "two:16 3 91" "network-absent:3 absent 91"; do
  read -r -a stale_case_ages <<<"${stale_case#*:}"
  status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=active \
    "STATUS_REPORT_COCKPIT_STATE_JSON=$(cockpit_state_json "${stale_case_ages[@]}")"
  cockpit_stale_summary+="${stale_case%%:*}=[$(status_cockpit_line)]/$(status_warning_count) "
done
check "the status script: a cockpit source last sampled more than three of its intervals ago is listed as stale, read from its own object; exactly three is not, and one GetState does not carry is not listed" \
  "$cockpit_stale_summary" \
  "at-limit=[active, protocol 1, last publish 4 s ago, stale: none]/0 past-limit=[active, protocol 1, last publish 4 s ago, stale: mounts]/0 two=[active, protocol 1, last publish 4 s ago, stale: sessions, mounts]/0 network-absent=[active, protocol 1, last publish 4 s ago, stale: mounts]/0 "

# configError is the parser's text (FULL_STATE's holds apostrophes, so gdbus
# prints the reply in double quotes; another holds JSON-escaped quotes), or
# "missing" when the file vanished while the service runs. Each reply is
# printed by GLib itself, as gdbus prints it.
APOSTROPHE_CONFIG_ERROR="groups[2].cards[0]: unknown card id 'weather'"
QUOTED_CONFIG_ERROR='groups[0]: "caption" must be a string'
QUOTED_CONFIG_ERROR_JSON='"groups[0]: \"caption\" must be a string"'
COCKPIT_CONFIG_INVALID_NEEDLE='cockpit: config invalid: '
# cockpit_config_run <configError as JSON>: the status script with an active cockpit whose GetState carries it.
cockpit_config_run() {
  local glib_printed_reply
  # shellcheck disable=SC2016  # JavaScript source.
  glib_printed_reply="$(gjs -c 'const {GLib} = imports.gi; print(new GLib.Variant("(s)", [ARGV[0]]).print(true));' \
    "$(cockpit_state_json 3 3 2 "$1")")"
  status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=active \
    STATUS_REPORT_COCKPIT_GDBUS_MODE=verbatim "STATUS_REPORT_COCKPIT_GDBUS_REPLY=$glib_printed_reply"
}
cockpit_config_summary=""
cockpit_config_run "\"$APOSTROPHE_CONFIG_ERROR\""
cockpit_config_summary+="apostrophe=$(status_warnings_naming "$COCKPIT_CONFIG_INVALID_NEEDLE$APOSTROPHE_CONFIG_ERROR — ")/[$(status_cockpit_line)]"
cockpit_config_run "$QUOTED_CONFIG_ERROR_JSON"
cockpit_config_summary+=" quote=$(status_warnings_naming "$COCKPIT_CONFIG_INVALID_NEEDLE$QUOTED_CONFIG_ERROR — ")"
cockpit_config_run '"missing"'
cockpit_config_summary+=" missing=$(status_warnings_naming "${COCKPIT_CONFIG_INVALID_NEEDLE}missing — ")"
cockpit_config_run null
cockpit_config_summary+=" valid=$(status_warnings_naming "$COCKPIT_CONFIG_INVALID_NEEDLE")"
check "the status script: a configError in the cockpit's GetState is a ⚠ quoting it whole (apostrophes, escaped quotes, or missing), beside its line; none without one" \
  "$cockpit_config_summary" \
  "apostrophe=1/[active, protocol 1, last publish 4 s ago, stale: none] quote=1 missing=1 valid=0"
# A configError holding a backslash sequence is quoted as written, its backslash intact, on the one ⚠ line: a shell
# whose echo reads escapes would print a JSON \n or \t in a configError as a real newline or tab, and \c would cut the
# output short. The needle runs from the line's prefix to its remedy's dash, so the quote must sit whole on one line.
BACKSLASH_CONFIG_ERROR='bad \t caption'
cockpit_config_run '"bad \\t caption"'
check 'the status script quotes a cockpit configError holding a backslash sequence (\t) with the backslash intact' \
  "backslash=$(status_warnings_naming "$COCKPIT_CONFIG_INVALID_NEEDLE$BACKSLASH_CONFIG_ERROR — ")" "backslash=1"

cockpit_not_installed_summary=""
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_LOAD_STATE=not-found
cockpit_not_installed_summary+="no-config=[$(status_cockpit_line)]/$(status_warning_count)"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_COCKPIT_HOME" STATUS_REPORT_COCKPIT_LOAD_STATE=not-found
cockpit_not_installed_summary+=" config=[$(status_cockpit_line)]/$(status_warnings_naming "resource-pulse-cockpit.service is not installed though ~/.config/resource-pulse/cockpit.json exists — link it: systemctl --user link --force $REPO_ROOT/systemd/resource-pulse-cockpit.service")"
check "the status script: a cockpit unit not found reads not installed, never skipped, and says to link it from this checkout only while the config file exists" \
  "$cockpit_not_installed_summary" \
  "no-config=[not installed (LoadState=not-found)]/0 config=[not installed (LoadState=not-found)]/1"

cockpit_fault_summary=""
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=failed
cockpit_fault_summary+="failed=[$(status_cockpit_line)]/$(status_warnings_naming "resource-pulse-cockpit.service failed — $COCKPIT_JOURNAL_HINT")/$(status_cockpit_gdbus_calls) "
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=activating STATUS_REPORT_COCKPIT_SUB_STATE=auto-restart
cockpit_fault_summary+="restarting=[$(status_cockpit_line)]/$(status_warnings_naming "resource-pulse-cockpit.service is restarting after a failure — $COCKPIT_JOURNAL_HINT")/$(status_cockpit_gdbus_calls) "
# Its line names the call limit, so it runs at the status script's own.
STATUS_AT_DEFAULT_CALL_LIMITS=yes status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=active \
  STATUS_REPORT_COCKPIT_GDBUS_MODE=fail
cockpit_fault_summary+="no-answer=[$(status_cockpit_line)]/$(status_warnings_naming "resource-pulse-cockpit.service is active but did not answer GetState within $STATUS_CALL_LIMIT_SECONDS s — $COCKPIT_JOURNAL_HINT")/$(status_cockpit_gdbus_calls)"
check "the status script: a failed, restarting or silent cockpit is a ⚠ naming its journal, as for the sampler; only the active one is asked GetState" \
  "$cockpit_fault_summary" \
  "failed=[failed (not running)]/1/0 restarting=[activating (auto-restart: restarting after a failure)]/1/0 no-answer=[active, no answer]/1/1"

# The cockpit's side is service/cockpit.js and what it imports:
# its own lib/sessions.js and service/fileIo.js count, and so does
# lib/cockpitProtocol.js, which the shell runs too; lib/protocol.js, which only
# the shell runs, does not. The sampler's count beside each is zero throughout:
# it is a program, not these modules.
cockpit_older_code_summary=""
COCKPIT_STARTED_AT="STATUS_REPORT_COCKPIT_STARTED_AT=$(unit_timestamp_us_utc "$SUITE_STARTED_AT_EPOCH" "$UNIT_START_MICROSECONDS")"
for changed_module in service/cockpit.js lib/sessions.js service/fileIo.js lib/cockpitProtocol.js lib/protocol.js; do
  status_extension_with_change "$changed_module"
  status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" \
    STATUS_REPORT_COCKPIT_ACTIVE_STATE=active "$COCKPIT_STARTED_AT"
  cockpit_older_code_summary+="$changed_module=$(status_warnings_naming "resource-pulse-cockpit.service runs older code: $changed_module changed after it started — systemctl --user try-restart resource-pulse-cockpit.service")/$(status_warnings_naming 'resource-pulse-cockpit.service runs older code')/sampler:$(status_warnings_naming 'resource-pulse.service runs older code') "
done
reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" \
  STATUS_REPORT_COCKPIT_ACTIVE_STATE=active "$COCKPIT_STARTED_AT"
cockpit_older_code_summary+="unchanged=$(status_warnings_naming 'runs older code')"
check "the status script: a module service/cockpit.js runs (itself, lib/sessions.js, service/fileIo.js, or lib/cockpitProtocol.js, which the shell runs too) changed after the cockpit started is a ⚠ that it runs older code; a shell-only module (lib/protocol.js) is not" \
  "$cockpit_older_code_summary" \
  "service/cockpit.js=1/1/sampler:0 lib/sessions.js=1/1/sampler:0 service/fileIo.js=1/1/sampler:0 lib/cockpitProtocol.js=1/1/sampler:0 lib/protocol.js=0/0/sampler:0 unchanged=0"
# An active cockpit whose start cannot be read (empty, n/a, or whole seconds as --timestamp=unix printed them) is a
# cannot-tell ⚠ naming the call that reads it, in the sampler's words, never silence. service/cockpit.js
# is newer than any start, so a start read some other way would show as an older-code ⚠.
COCKPIT_UNREADABLE_START_NEEDLE="cannot tell when resource-pulse-cockpit.service started (its ActiveEnterTimestamp is not in systemd's microsecond form), so not whether it runs older code or unit file — systemctl --user show -p ActiveEnterTimestamp --value --timestamp=us+utc resource-pulse-cockpit.service"
cockpit_unreadable_start_summary=""
expected_cockpit_unreadable_start_summary=""
for unreadable_cockpit_start in '' 'n/a' "@$SUITE_STARTED_AT_EPOCH"; do
  status_extension_with_change service/cockpit.js
  status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" \
    STATUS_REPORT_COCKPIT_ACTIVE_STATE=active "STATUS_REPORT_COCKPIT_STARTED_AT=$unreadable_cockpit_start"
  cockpit_unreadable_start_summary+="[$unreadable_cockpit_start]=$(status_warnings_naming "$COCKPIT_UNREADABLE_START_NEEDLE")/$(status_warnings_naming 'resource-pulse-cockpit.service runs older code')/$(status_warning_count) "
  expected_cockpit_unreadable_start_summary+="[$unreadable_cockpit_start]=1/0/1 "
done
check "the status script: an active cockpit whose start is not in systemd's microsecond UTC form (empty, n/a, or whole seconds as @<epoch>) is one cannot-tell ⚠ naming resource-pulse-cockpit.service and the call that reads it, never an older-code ⚠ and never silence" \
  "$cockpit_unreadable_start_summary" "$expected_cockpit_unreadable_start_summary"

# The unit file as systemd sees it is the link's TARGET (the checkout's systemd/<unit>): the link in the
# user's unit directory is created now, so its own time is always after the unit started and would hide
# the difference. FragmentPath names the link; the target's time is the one that counts.
UNIT_FILE_FIXTURE_DIR="$WIRING_TMP/status-report-unit-files"
# unit_files_with_target_mtime <epoch>: fresh unit-file links whose targets carry that mtime.
unit_files_with_target_mtime() {
  local unit_name
  rm -rf "$UNIT_FILE_FIXTURE_DIR"
  mkdir -p "$UNIT_FILE_FIXTURE_DIR/checkout" "$UNIT_FILE_FIXTURE_DIR/unit-dir" || fatal "cannot create $UNIT_FILE_FIXTURE_DIR"
  for unit_name in resource-pulse.service resource-pulse-cockpit.service; do
    : >"$UNIT_FILE_FIXTURE_DIR/checkout/$unit_name"
    touch -d "@$1" "$UNIT_FILE_FIXTURE_DIR/checkout/$unit_name" || fatal "touch -d @$1 failed"
    ln -s "$UNIT_FILE_FIXTURE_DIR/checkout/$unit_name" "$UNIT_FILE_FIXTURE_DIR/unit-dir/$unit_name" || fatal "cannot link $unit_name"
  done
}
# status_unit_file_run <cockpit ActiveState> <sampler ActiveState>: the status script over the linked extension, both
# units started when the suite started, their unit files as the fixture left them.
status_unit_file_run() {
  reset_status_extension "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH" "$BEFORE_SHELL_START_EPOCH"
  status_report_run "$ASKED_FOR_SETTING" true "HOME=$STATUS_REPORT_LINKED_HOME" "$STATUS_SERVICE_STARTED_AT" \
    "STATUS_REPORT_SERVICE_ACTIVE_STATE=$2" "STATUS_REPORT_COCKPIT_ACTIVE_STATE=$1" "$COCKPIT_STARTED_AT" \
    "STATUS_REPORT_SERVICE_UNIT_FILE=$UNIT_FILE_FIXTURE_DIR/unit-dir/resource-pulse.service" \
    "STATUS_REPORT_COCKPIT_UNIT_FILE=$UNIT_FILE_FIXTURE_DIR/unit-dir/resource-pulse-cockpit.service"
}
status_unit_file_warnings_naming() { status_warnings_naming "$1 runs an older unit file"; }
unit_file_newer_summary=""
unit_files_with_target_mtime "$AFTER_SHELL_START_EPOCH"
status_unit_file_run active active
for unit_name in resource-pulse.service resource-pulse-cockpit.service; do
  unit_file_newer_summary+="$unit_name=$(status_warnings_naming "$unit_name runs an older unit file: it changed after the unit started — systemctl --user daemon-reload && systemctl --user try-restart $unit_name")/$(status_unit_file_warnings_naming "$unit_name") "
done
unit_file_newer_summary+="total=$(status_warning_count)"
check "the status script: a unit file (the link's target) changed after its unit started is one ⚠ naming daemon-reload and try-restart, for the sampler and for the cockpit" \
  "$unit_file_newer_summary" "resource-pulse.service=1/1 resource-pulse-cockpit.service=1/1 total=2"

unit_file_older_summary=""
unit_files_with_target_mtime "$BEFORE_SHELL_START_EPOCH"
status_unit_file_run active active
unit_file_older_summary+="older=$(status_warnings_naming 'runs an older unit file') "
# Within the second both units started (at .7): written before the start (.4) is not newer, after it (.9) is.
unit_files_with_target_mtime "$SUITE_STARTED_AT_EPOCH.$SAME_SECOND_BEFORE_START_MICROSECONDS"
status_unit_file_run active active
unit_file_older_summary+="before-start=$(status_warnings_naming 'runs an older unit file') "
unit_files_with_target_mtime "$SUITE_STARTED_AT_EPOCH.$SAME_SECOND_AFTER_START_MICROSECONDS"
status_unit_file_run active active
for unit_name in resource-pulse.service resource-pulse-cockpit.service; do
  unit_file_older_summary+="after-start:$unit_name=$(status_unit_file_warnings_naming "$unit_name") "
done
check "the status script: a unit file older than its unit's start, or written earlier in the second it started (.4 against .7), is no ⚠ (the link's own newer time does not count); one written later in that second (.9) is one ⚠ for each unit" \
  "$unit_file_older_summary" "older=0 before-start=0 after-start:resource-pulse.service=1 after-start:resource-pulse-cockpit.service=1 "

unit_file_stopped_summary=""
unit_files_with_target_mtime "$AFTER_SHELL_START_EPOCH"
status_unit_file_run inactive inactive
unit_file_stopped_summary+="stopped=$(status_warnings_naming 'runs an older unit file')"
check "the status script: a unit that is not running gets no older-unit-file ⚠ even when its file is newer than its last start" \
  "$unit_file_stopped_summary" "stopped=0"

# The status script runs `command find`, never a shell function of that name: a shell can define find as a
# function running bfs, which refuses the start's form. Here the row's own BASH_ENV file (read by bash before the
# script) defines one that refuses every call, and says it was read. It unsets BASH_ENV first, so that the script's own
# shell gets the function and its bash children do not: the build script calls plain find, and a function it read
# would add a ⚠ to every cell. Each of the script's three finds is reached: the program's
# (rp_installed_program_changed_since), the unit file's (rp_warn_when_unit_file_is_newer), and the desktop shell's
# modules' (rp_first_module_changed_since, whose cannot-tell would add a ⚠ to every cell's total). The cell counting
# the file's line stays: without proof that the function was defined, the row passes with or without `command`.
STATUS_FIND_FUNCTION_BASH_ENV="$(cat <<'BASH_ENV_FILE'
unset BASH_ENV
printf '%s\n' 'row bash env read' >&2
find() { printf '%s\n' 'a find function refused this call' >&2; return 1; }
BASH_ENV_FILE
)"
STATUS_FIND_FUNCTION_BASH_ENV_FILE="$WIRING_TMP/status-report-find-function-bash-env"
printf '%s\n' "$STATUS_FIND_FUNCTION_BASH_ENV" >"$STATUS_FIND_FUNCTION_BASH_ENV_FILE" \
  || fatal "cannot write the row's BASH_ENV file"
# find_function_cell <name> <program mtime> [NAME=value...]: the status script over a program that is this checkout's,
# written at that time, with that BASH_ENV file; leaves
# "<name>=<older-program ⚠>/<older-unit-file ⚠>/<all ⚠>/bash-env=<n> " in FIND_FUNCTION_CELL.
find_function_cell() {
  reset_sampler_status_home "$SAMPLER_STATUS_CHECKOUT_HASH" "$2"
  sampler_status_run "BASH_ENV=$STATUS_FIND_FUNCTION_BASH_ENV_FILE" "${@:3}"
  FIND_FUNCTION_CELL="$1=$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")/$(status_unit_file_warnings_naming resource-pulse.service)"
  FIND_FUNCTION_CELL+="/$(status_warning_count)/bash-env=$(grep -c -x -F 'row bash env read' <<<"$STATUS_REPORT_OUTPUT") "
}
find_function_cell newer-program "$AFTER_SHELL_START_EPOCH"
find_function_summary="$FIND_FUNCTION_CELL"
find_function_cell older-program "$BEFORE_SHELL_START_EPOCH"
find_function_summary+="$FIND_FUNCTION_CELL"
unit_files_with_target_mtime "$AFTER_SHELL_START_EPOCH"
find_function_cell newer-unit-file "$BEFORE_SHELL_START_EPOCH" \
  "STATUS_REPORT_SERVICE_UNIT_FILE=$UNIT_FILE_FIXTURE_DIR/unit-dir/resource-pulse.service"
find_function_summary+="$FIND_FUNCTION_CELL"
check "the status script asks the find command, never a shell function named find: with one that refuses every call, a newer program and a newer unit file still give their ⚠, and an older program none" \
  "$find_function_summary" "newer-program=1/0/1/bash-env=1 older-program=0/0/0/bash-env=1 newer-unit-file=0/1/1/bash-env=1 "

# A find command first on PATH that cannot read a unit's start, as bfs cannot (bfs exits 1 on
# -newermt '2026-11-16 07:54:14.270693 UTC', and reads '@1700000000'), is blamed for what cannot be told: one ⚠ for each
# active unit naming that find, never one that a directory cannot be searched or an import closure worked out. The
# stand-in refuses systemd's form after -newermt, and hands every other call (the build script's, the closure
# helper's, the older-copy question's @<epoch>) to the real find. A newer program and a newer cockpit module are there,
# so a comparison that went ahead would warn about them.
REAL_FIND_PATH="$(type -P find)" || fatal "find is required"
BFS_LIKE_FIND_BIN="$WIRING_TMP/status-report-bfs-like-find-bin"
# shellcheck disable=SC2016  # The stand-in's own source: its variables expand when it runs.
install_stub "$BFS_LIKE_FIND_BIN" find "$(printf '%s\n' '#!/usr/bin/env bash' \
  'systemd_start_pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6} UTC$"' \
  'previous_argument=""' \
  'for argument in "$@"; do' \
  '  if [[ "$previous_argument" == -newermt && "$argument" =~ $systemd_start_pattern ]]; then' \
  '    printf "bfs: error: %s: invalid timestamp\n" "$argument" >&2' \
  '    exit 1' \
  '  fi' \
  '  previous_argument="$argument"' \
  'done' \
  "exec $(printf '%q' "$REAL_FIND_PATH") \"\$@\"")"
FIND_CANNOT_READ_START_TEXT="$BFS_LIKE_FIND_BIN/find cannot read its start"
reset_sampler_status_home "$SAMPLER_STATUS_CHECKOUT_HASH" "$AFTER_SHELL_START_EPOCH"
status_extension_with_change service/cockpit.js
status_report_run "$ASKED_FOR_SETTING" true "HOME=$SAMPLER_STATUS_HOME" "$STATUS_SERVICE_STARTED_AT" \
  STATUS_REPORT_COCKPIT_ACTIVE_STATE=active "$COCKPIT_STARTED_AT" "PATH=$BFS_LIKE_FIND_BIN:$STATUS_REPORT_STUB_BIN:$PATH"
bfs_like_find_summary="sampler=$(status_warnings_naming "cannot tell whether resource-pulse.service runs an older program or unit file: $FIND_CANNOT_READ_START_TEXT")"
bfs_like_find_summary+="/directory=$(status_warnings_naming 'or a directory on its way, cannot be searched')/older=$(status_warnings_naming "$SAMPLER_OLDER_PROGRAM_LINE")"
bfs_like_find_summary+=" cockpit=$(status_warnings_naming "cannot tell whether resource-pulse-cockpit.service runs older code or unit file: $FIND_CANNOT_READ_START_TEXT")"
bfs_like_find_summary+="/closure=$(status_warnings_naming 'resource-pulse-cockpit.service runs older code: what service/cockpit.js imports could not be worked out')"
bfs_like_find_summary+="/older=$(status_warnings_naming 'resource-pulse-cockpit.service runs older code: service/cockpit.js changed after it started')"
bfs_like_find_summary+=" all=$(status_warning_count)"
check "the status script blames a find on PATH that cannot read a unit's start (bfs), once for each active unit, never a directory or an import closure" \
  "$bfs_like_find_summary" "sampler=1/directory=0/older=0 cockpit=1/closure=0/older=0 all=2"

cockpit_gdbus_summary=""
status_report_run "$ASKED_FOR_SETTING" true
cockpit_gdbus_summary+="skipped=$(status_gdbus_calls)"
status_report_run "$ASKED_FOR_SETTING" true STATUS_REPORT_COCKPIT_ACTIVE_STATE=active
cockpit_gdbus_summary+=" active=$(status_gdbus_calls) cockpit-call=[$(grep -F -e "$COCKPIT_DEST_NEEDLE" "$STATUS_REPORT_CALLS")]"
check "the status script: an active cockpit makes exactly one more gdbus call than a skipped one, Cockpit1's GetState with gdbus's reply timeout" \
  "$cockpit_gdbus_summary" \
  "skipped=1 active=2 cockpit-call=[gdbus call --session --dest io.github.zvibaratz.ResourcePulse.Cockpit1 --object-path /io/github/zvibaratz/ResourcePulse/Cockpit1 --method io.github.zvibaratz.ResourcePulse.Cockpit1.GetState --timeout $UNHURRIED_REPLY_TIMEOUT_SECONDS]"

# Spelled by pieces so this row's own source is not what it finds.
STATUS_REPORT_FORBIDDEN_PATTERN="cmd""line|env""iron\\b|\\bps -|pgre""p -[a-z]*[al]\\b"
status_script_source="$(<"$STATUS_SCRIPT")"
# The file must hold the service block (its one GetState call), or an empty file would pass.
check "the status script reads no argument list or environment, and runs no ps or pgrep -a/-l" \
  "reaches-service-block=$(grep -c -F 'gdbus call --session' <<<"$status_script_source") forbidden=$(grep -c -E "$STATUS_REPORT_FORBIDDEN_PATTERN" <<<"$status_script_source")" \
  "reaches-service-block=1 forbidden=0"

# This table's own total. The guide states it.
EXPECTED_ROWS=60

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
