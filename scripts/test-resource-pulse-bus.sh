#!/usr/bin/env bash
#
# scripts/test-resource-pulse-bus.sh
# ==================================
#
# State table for the Resource Pulse rows that need a message bus: the D-Bus
# rows of gnome-shell/tests/run-private-bus.js (the sampler's test double,
# gnome-shell/tests/serviceDouble.js, the cockpit's D-Bus face, and the clients
# of both), and the cockpit's entry point (service/cockpit.js), run through the
# real gdbus. Every one runs inside `dbus-run-session`, on a private bus of this
# run, and refuses to run on any other: never on the live session bus. The
# program the double stands in for is held to it by the sampler's bus table
# (scripts/test-resource-pulse-sampler-bus.sh).
#
# "Could not run" is exit 2, never a pass: a missing gjs, timeout, setsid,
# dbus-run-session, gdbus or script, a fake herdr client that did not come up,
# or a missing tally line (an import error prints none) is fatal. The table
# asserts its own row total. Its shared helpers and constants are
# scripts/resource-pulse-table-lib.sh's; the private-bus setup is this table's,
# since only these rows read it.
#
# Requires: bash, gjs, timeout, setsid, dbus-run-session (Ubuntu: dbus-daemon),
# gdbus (libglib2.0-bin; the cockpit's rows ask the real service through it) and
# script (util-linux's, from bsdutils: it gives the fake herdr client of the
# FocusSession rows a terminal). No network, no root.
#
# Usage: scripts/test-resource-pulse-bus.sh
#   RESOURCE_PULSE_EXT_DIR=<dir> points the file rows at a copy of the
#   extension (for a mutation trial); the JS rows always test the tree.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
source "$TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
start_table

[[ -d "$EXT_DIR" ]] || fatal "no extension directory at $EXT_DIR"
require_tools gjs timeout setsid dbus-run-session gdbus script

# ---------------------------------------------------------------------------
# The rows on a private message bus.
#
# Every row that needs a message bus runs inside `dbus-run-session` on a bus of
# its own (on_private_bus): a path socket in a 0700 directory of this run, and no
# service directory, so nothing on it can be activated. Each program run there
# refuses to start unless DBUS_SESSION_BUS_ADDRESS is that socket, and all of it
# runs behind LIVE_SETTINGS_BARRIER, so even a program that ignored the address
# would find no live bus to fall back to.
# ---------------------------------------------------------------------------
PRIVATE_BUS_DIR="$WIRING_TMP/private-bus"
PRIVATE_BUS_CONFIG="$WIRING_TMP/private-bus.conf"
PRIVATE_BUS_RUNNER="$REPO_ROOT/gnome-shell/tests/run-private-bus.js"
PRIVATE_BUS_TIMEOUT_SECONDS=150
PRIVATE_BUS_KILL_AFTER_SECONDS=10
if ! mkdir -p "$PRIVATE_BUS_DIR" || ! chmod 700 "$PRIVATE_BUS_DIR"; then
  fatal "cannot create the private bus directory $PRIVATE_BUS_DIR"
fi
cat >"$PRIVATE_BUS_CONFIG" <<BUS_CONFIG || fatal "cannot write $PRIVATE_BUS_CONFIG"
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:dir=$PRIVATE_BUS_DIR</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*"/>
    <allow receive_sender="*"/>
    <allow own="*"/>
  </policy>
</busconfig>
BUS_CONFIG
# on_private_bus <command...> runs a command on its own private bus, behind the
# barrier. GIO_USE_VFS=local keeps GIO from even asking that bus for gvfs. It
# runs in a session of its own (setsid), and timeout signals its whole process
# group, KILL 10 s after TERM: a timeout ends the private dbus-daemon and
# everything the command started with it, never only dbus-run-session.
on_private_bus() {
  env "${LIVE_SETTINGS_BARRIER[@]}" RESOURCE_PULSE_TEST_BUS_DIR="$PRIVATE_BUS_DIR" GIO_USE_VFS=local \
    setsid --wait timeout --kill-after="$PRIVATE_BUS_KILL_AFTER_SECONDS" "$PRIVATE_BUS_TIMEOUT_SECONDS" \
    dbus-run-session --config-file="$PRIVATE_BUS_CONFIG" -- "$@"
}
# is_private_bus_address <address> <bus dir>: the drivers' twin of
# requirePrivateBusAddress (gnome-shell/tests/privateBus.js): one path
# socket inside the bus dir, and nothing that could lead it out of it: an
# address list (;), a /../ segment, or a percent escape (D-Bus decodes %2e%2e
# to ..). Exported, so a driver run under on_private_bus checks its bus with
# this same function.
is_private_bus_address() {
  local address="$1" bus_dir="$2"
  [[ -n "$bus_dir" && "$address" == "unix:path=$bus_dir/"* ]] || return 1
  [[ "$address" != *';'* && "$address" != *'/../'* && "$address" != *'%'* ]]
}
export -f is_private_bus_address

printf '\nthe D-Bus rows on a private bus: the sampler'"'"'s test double, the cockpit'"'"'s face and their clients (gnome-shell/tests/run-private-bus.js)\n'
# The runner's own guard, first: outside its private bus it must refuse (exit 2)
# before a row runs. Every address below is a socket that does not exist, so
# even a runner without the guard could reach nothing: (a) the barrier's dead
# bus, outside the private bus directory; (b) the live bus's socket name under
# XDG_RUNTIME_DIR, with the bus directory set to that runtime dir; then three
# that start inside the private bus directory but lead out of it: (c) an
# address list (;) whose second entry is elsewhere, (d) a /../ segment, and
# (e) a percent escape, which D-Bus decodes (%2e%2e is ..).
runner_guard_summary=""
runner_guard_output="$(env "${LIVE_SETTINGS_BARRIER[@]}" RESOURCE_PULSE_TEST_BUS_DIR="$PRIVATE_BUS_DIR" \
  timeout "$PRIVATE_BUS_TIMEOUT_SECONDS" gjs -m "$PRIVATE_BUS_RUNNER" 2>&1)"
runner_guard_summary+="outside=$?/$(grep -c -F 'refusing to run' <<<"$runner_guard_output")"
runner_guard_summary+="/$(grep -c -F 'JS-TALLY' <<<"$runner_guard_output")"
runner_guard_output="$(env "${LIVE_SETTINGS_BARRIER[@]}" RESOURCE_PULSE_TEST_BUS_DIR="$LIVE_SETTINGS_BARRIER_RUNTIME_DIR" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=$LIVE_SETTINGS_BARRIER_RUNTIME_DIR/bus" \
  timeout "$PRIVATE_BUS_TIMEOUT_SECONDS" gjs -m "$PRIVATE_BUS_RUNNER" 2>&1)"
runner_guard_summary+=" runtime-bus=$?/$(grep -c -F 'refusing to run' <<<"$runner_guard_output")"
runner_guard_summary+="/$(grep -c -F 'JS-TALLY' <<<"$runner_guard_output")"
ESCAPING_BUS_ADDRESSES=(
  "list=unix:path=$PRIVATE_BUS_DIR/no-bus;$LIVE_SETTINGS_BARRIER_BUS"
  "dotdot=unix:path=$PRIVATE_BUS_DIR/../barrier-no-session-bus"
  "escaped=unix:path=$PRIVATE_BUS_DIR/%2e%2e/barrier-no-session-bus"
)
for escaping_entry in "${ESCAPING_BUS_ADDRESSES[@]}"; do
  runner_guard_output="$(env "${LIVE_SETTINGS_BARRIER[@]}" RESOURCE_PULSE_TEST_BUS_DIR="$PRIVATE_BUS_DIR" \
    DBUS_SESSION_BUS_ADDRESS="${escaping_entry#*=}" timeout "$PRIVATE_BUS_TIMEOUT_SECONDS" gjs -m "$PRIVATE_BUS_RUNNER" 2>&1)"
  runner_guard_summary+=" ${escaping_entry%%=*}=$?/$(grep -c -F 'refusing to run' <<<"$runner_guard_output")"
  runner_guard_summary+="/$(grep -c -F 'JS-TALLY' <<<"$runner_guard_output")"
done
check "the private-bus runner refuses (exit 2, no row run) a bus outside its directory, the live bus, ;, /../ and %" \
  "$runner_guard_summary" "outside=2/1/0 runtime-bus=2/1/0 list=2/1/0 dotdot=2/1/0 escaped=2/1/0"
# The drivers' twin of that guard, which every bash driver below runs first.
private_bus_check_summary=""
PRIVATE_BUS_CHECK_CASES=(
  "own=unix:path=$PRIVATE_BUS_DIR/dbus-0123456789,guid=0123456789abcdef"
  "list=unix:path=$PRIVATE_BUS_DIR/dbus-0123456789;unix:path=/run/user/0/bus"
  "dotdot=unix:path=$PRIVATE_BUS_DIR/../bus"
  "escaped=unix:path=$PRIVATE_BUS_DIR/%2e%2e/bus"
  "elsewhere=unix:path=$WIRING_TMP/bus"
)
for check_case in "${PRIVATE_BUS_CHECK_CASES[@]}"; do
  if is_private_bus_address "${check_case#*=}" "$PRIVATE_BUS_DIR"; then check_verdict=accepted; else check_verdict=refused; fi
  private_bus_check_summary+="${check_case%%=*}=$check_verdict "
done
check "the drivers' bus check accepts its own socket and refuses a list (;), a /../ segment, a % escape and elsewhere" \
  "$private_bus_check_summary" "own=accepted list=refused dotdot=refused escaped=refused elsewhere=refused "
PRIVATE_BUS_JS_OUTPUT="$(on_private_bus gjs -m "$PRIVATE_BUS_RUNNER" 2>&1)"
PRIVATE_BUS_JS_EXIT=$?
printf '%s\n' "$PRIVATE_BUS_JS_OUTPUT"
fold_js_tally "$PRIVATE_BUS_JS_OUTPUT" "$PRIVATE_BUS_JS_EXIT" "the private-bus runner"

printf '\nservice/cockpit.js on a private bus (the real sources, under a home of this run and no system bus)\n'
# The cockpit's entry point runs twice, each time under a HOME, XDG_CONFIG_HOME
# and XDG_STATE_HOME of this run: the config home holds the shipped template as
# resource-pulse/cockpit.json, the state home nothing, the home no ~/.ssh.
# DBUS_SYSTEM_BUS_ADDRESS names a socket that does not exist, so NetworkManager
# and UPower are absent, as on a runner with no system bus at all. The first
# run has no herdr socket; the second has a fake herdr at
# <config home>/herdr/herdr.sock, so FocusSession never reaches the live herdr,
# and beside it a fake herdr client: a process named herdr in a terminal of its
# own, whose pid and its terminal's FocusSession must name, on any machine.
# Neither is in fixture mode: the first sets RESOURCE_PULSE_COCKPIT_FIXTURE
# empty, the second unsets it. A third run sets it to a copy of
# gnome-shell/tests/fixtures/cockpit/nested-state.json, under a config home with
# no config and no herdr socket, so what it serves can only be the fixture's.
# A fourth runs a copy of the extension whose listing of /proc throws a plain
# Error (a fault, not IO), with a fake herdr of its own. A fifth has a fake
# herdr of its own that takes every connection and never answers a focus
# request, so FocusSession's own request timeout is what answers it.
# Every run but the /proc-fault one (which runs its own copy) starts
# service/cockpit.js through a link of this run's own to the extension, as
# resource-pulse-cockpit.service starts it through the extension's link, so a module that
# finds files from its own path is tested where the unit runs it.
COCKPIT_RUN_DIR="$WIRING_TMP/cockpit"
COCKPIT_EXTENSION_LINK="$COCKPIT_RUN_DIR/link-home/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
COCKPIT_MAIN_PATH="$COCKPIT_EXTENSION_LINK/service/cockpit.js"
COCKPIT_OBJECT_PATH='/io/github/zvibaratz/ResourcePulse/Cockpit1'
# Warnings of gjs and GLib themselves only (a deprecated API, a misused call,
# an uncaught error): the cockpit's own lines are Gjs-Console-*, and a read
# this runner's kernel refuses may well log one of those.
ENGINE_WARNING_PATTERN='(Gjs|GLib|GLib-GIO|GLib-GObject)-(WARNING|CRITICAL)|JS ERROR|Unhandled promise rejection'
COCKPIT_NO_SYSTEM_BUS="unix:path=$WIRING_TMP/cockpit-no-system-bus"
COCKPIT_SERVE_LOG="$COCKPIT_RUN_DIR/cockpit-serve.log"
COCKPIT_FOCUS_LOG="$COCKPIT_RUN_DIR/cockpit-focus.log"
COCKPIT_HERDR_REQUEST_LOG="$COCKPIT_RUN_DIR/herdr-requests.log"
COCKPIT_FAKE_HERDR_LOG="$COCKPIT_RUN_DIR/fake-herdr.log"
COCKPIT_FIXTURE_LOG="$COCKPIT_RUN_DIR/cockpit-fixture.log"
COCKPIT_BAD_FIXTURE_LOG="$COCKPIT_RUN_DIR/cockpit-bad-fixture.log"
# The fixture the third run serves, and two rewrites of it: the network source
# changed alone (2 ssh masters become 3), then the layout alone as well (the
# second group's caption AGENTS becomes LATER).
COCKPIT_FIXTURE_PATH="$COCKPIT_RUN_DIR/cockpit-fixture.json"
COCKPIT_FIXTURE_NETWORK_REWRITE="$COCKPIT_RUN_DIR/cockpit-fixture-network.json"
COCKPIT_FIXTURE_LAYOUT_REWRITE="$COCKPIT_RUN_DIR/cockpit-fixture-layout.json"
# The same fixture, readable and valid, under a stat-only directory (/.ssh/, one
# of lib/constants.js's STAT_ONLY_PATH_FRAGMENTS): the service must refuse it
# unopened, so serving it, or failing to read it, both fail its row.
COCKPIT_REFUSED_FIXTURE_PATH="$COCKPIT_RUN_DIR/fixture-home/.ssh/cockpit-fixture.json"
COCKPIT_REFUSED_FIXTURE_LOG="$COCKPIT_RUN_DIR/cockpit-refused-fixture.log"
# service/cockpit.js's COCKPIT_FIXTURE_REFUSED_ERROR: the reason its shutdown line gives.
COCKPIT_FIXTURE_REFUSED_REASON='refused before opening it: its path names a file the cockpit may stat, never open'
# The fake herdr client: a /bin/sh script whose file name is herdr, which the
# kernel takes as its comm (a copied binary cannot be renamed that way). The
# driver runs it under script(1), which gives it a pseudo-terminal (a non-zero
# tty_nr) and stays its parent, as a terminal emulator would. It writes its pid
# to the file it is given and sleeps until killed, or at most
# FAKE_CLIENT_LIFETIME_SECONDS should every cleanup be skipped; it never reaches
# any herdr socket. It lives in this run's directory, never on PATH.
COCKPIT_FAKE_CLIENT_DIR="$COCKPIT_RUN_DIR/fake-herdr-client"
COCKPIT_FAKE_CLIENT_PATH="$COCKPIT_FAKE_CLIENT_DIR/herdr"
COCKPIT_FAKE_CLIENT_PID_FILE="$COCKPIT_FAKE_CLIENT_DIR/client.pid"
COCKPIT_FAKE_CLIENT_LOG="$COCKPIT_RUN_DIR/fake-herdr-client.log"
# The /proc-fault run: a copy of the extension in which service/sources/sourceIo.js
# re-exports the real module (moved beside it) but listEntryNames throws a plain
# Error for /proc. Under the real tree the scan never meets such an Error, so
# this is the one way to drive the fault path of service/cockpit.js itself.
COCKPIT_PROC_FAULT_EXT_DIR="$COCKPIT_RUN_DIR/proc-fault-extension"
COCKPIT_PROC_FAULT_SOURCE_IO="$COCKPIT_PROC_FAULT_EXT_DIR/service/sources/sourceIo.js"
COCKPIT_PROC_FAULT_REAL_SOURCE_IO="$COCKPIT_PROC_FAULT_EXT_DIR/service/sources/sourceIoWithoutFault.js"
COCKPIT_PROC_FAULT_MAIN_PATH="$COCKPIT_PROC_FAULT_EXT_DIR/service/cockpit.js"
COCKPIT_PROC_FAULT_LOG="$COCKPIT_RUN_DIR/cockpit-proc-fault.log"
COCKPIT_PROC_FAULT_HERDR_REQUEST_LOG="$COCKPIT_RUN_DIR/proc-fault-herdr-requests.log"
COCKPIT_SILENT_HERDR_LOG="$COCKPIT_RUN_DIR/cockpit-silent-herdr.log"
COCKPIT_SILENT_HERDR_REQUEST_LOG="$COCKPIT_RUN_DIR/silent-herdr-requests.log"
# The methods the silent run's fake herdr takes and never answers: FocusSession's two requests.
COCKPIT_SILENT_HERDR_METHODS='workspace.focus,pane.focus'
# lib/constants.js's DBUS_CALL_TIMEOUT_MS: how long the shell's client waits for FocusSession's reply.
COCKPIT_CLIENT_CALL_TIMEOUT_MS="$(sed -n -E 's/^export const DBUS_CALL_TIMEOUT_MS = ([0-9]+);$/\1/p' \
  "$EXT_DIR/lib/constants.js")"
[[ "$COCKPIT_CLIENT_CALL_TIMEOUT_MS" =~ ^[0-9]+$ ]] \
  || fatal "cannot read DBUS_CALL_TIMEOUT_MS from $EXT_DIR/lib/constants.js"
COCKPIT_PROC_FAULT_MESSAGE='injected fault: listing /proc'
for cockpit_run_name in serve focus; do
  for cockpit_home_kind in home config state; do
    mkdir -p "$COCKPIT_RUN_DIR/$cockpit_run_name-$cockpit_home_kind" \
      || fatal "cannot create $COCKPIT_RUN_DIR/$cockpit_run_name-$cockpit_home_kind"
  done
  cockpit_config_path="$COCKPIT_RUN_DIR/$cockpit_run_name-config/$COCKPIT_CONFIG_RELATIVE_PATH"
  if ! mkdir -p "$(dirname "$cockpit_config_path")" || ! cp "$COCKPIT_CONFIG_TEMPLATE" "$cockpit_config_path"; then
    fatal "cannot place the config template at $cockpit_config_path"
  fi
done
mkdir -p "$COCKPIT_RUN_DIR/focus-config/herdr" || fatal "cannot create the fake herdr's directory"
for cockpit_home_kind in home config state; do
  mkdir -p "$COCKPIT_RUN_DIR/fixture-$cockpit_home_kind" "$COCKPIT_RUN_DIR/proc-fault-$cockpit_home_kind" \
    "$COCKPIT_RUN_DIR/silent-herdr-$cockpit_home_kind" \
    || fatal "cannot create the fixture, /proc-fault and silent-herdr $cockpit_home_kind directories under $COCKPIT_RUN_DIR"
done
mkdir -p "$COCKPIT_RUN_DIR/proc-fault-config/herdr" "$COCKPIT_RUN_DIR/silent-herdr-config/herdr" \
  "${COCKPIT_REFUSED_FIXTURE_PATH%/*}" "$COCKPIT_FAKE_CLIENT_DIR" \
  || fatal "cannot create the /proc-fault fake herdr's, the refused fixture's or the fake client's directory"
cp -- "$COCKPIT_NESTED_FIXTURE" "$COCKPIT_REFUSED_FIXTURE_PATH" || fatal "cannot copy $COCKPIT_NESTED_FIXTURE"
cat >"$COCKPIT_FAKE_CLIENT_PATH" <<'FAKE_HERDR_CLIENT' || fatal "cannot write $COCKPIT_FAKE_CLIENT_PATH"
#!/bin/sh
# A stand-in for a herdr client, for scripts/test-resource-pulse-bus.sh: see
# COCKPIT_FAKE_CLIENT_PATH there. $1 is the file its pid goes to.
FAKE_CLIENT_LIFETIME_SECONDS=300
printf '%s\n' "$$" >"$1"
trap 'kill "$sleep_pid" 2>/dev/null; exit 0' TERM HUP INT
sleep "$FAKE_CLIENT_LIFETIME_SECONDS" &
sleep_pid=$!
wait "$sleep_pid"
FAKE_HERDR_CLIENT
chmod +x "$COCKPIT_FAKE_CLIENT_PATH" || fatal "cannot make $COCKPIT_FAKE_CLIENT_PATH executable"
# The link is made to the extension's absolute, physical path, so a relative
# RESOURCE_PULSE_EXT_DIR still names it from the link's own directory.
cockpit_extension_link_target="$(cd "$EXT_DIR" && pwd -P)" || fatal "cannot resolve $EXT_DIR"
if ! mkdir -p "${COCKPIT_EXTENSION_LINK%/*}" \
  || ! ln -s -- "$cockpit_extension_link_target" "$COCKPIT_EXTENSION_LINK"; then
  fatal "cannot link the extension at $COCKPIT_EXTENSION_LINK"
fi
[[ -L "$COCKPIT_EXTENSION_LINK" && "$COCKPIT_EXTENSION_LINK" -ef "$EXT_DIR" ]] \
  || fatal "$COCKPIT_EXTENSION_LINK is not a link that resolves to $EXT_DIR"
if ! cp -R -- "$EXT_DIR" "$COCKPIT_PROC_FAULT_EXT_DIR" \
  || ! mv -- "$COCKPIT_PROC_FAULT_SOURCE_IO" "$COCKPIT_PROC_FAULT_REAL_SOURCE_IO"; then
  fatal "cannot copy the extension to $COCKPIT_PROC_FAULT_EXT_DIR, or move its sourceIo.js aside"
fi
# A module's own export shadows the same name from export *, so every other
# helper is the real one.
cat >"$COCKPIT_PROC_FAULT_SOURCE_IO" <<PROC_FAULT_SOURCE_IO || fatal "cannot write $COCKPIT_PROC_FAULT_SOURCE_IO"
// scripts/test-resource-pulse-bus.sh's /proc-fault copy of sourceIo.js: the real
// module, but a listing of PROC_ROOT_PATH throws a plain Error.
import {PROC_ROOT_PATH} from '../../lib/constants.js';
import {listEntryNames as listEntryNamesWithoutFault} from './${COCKPIT_PROC_FAULT_REAL_SOURCE_IO##*/}';

export * from './${COCKPIT_PROC_FAULT_REAL_SOURCE_IO##*/}';

export function listEntryNames(directoryPath) {
    if (directoryPath === PROC_ROOT_PATH)
        throw new Error('$COCKPIT_PROC_FAULT_MESSAGE');
    return listEntryNamesWithoutFault(directoryPath);
}
PROC_FAULT_SOURCE_IO
cp -- "$COCKPIT_NESTED_FIXTURE" "$COCKPIT_FIXTURE_PATH" || fatal "cannot copy $COCKPIT_NESTED_FIXTURE"
sed 's/"sshMasterCount": 2/"sshMasterCount": 3/' "$COCKPIT_FIXTURE_PATH" >"$COCKPIT_FIXTURE_NETWORK_REWRITE" \
  || fatal "cannot write $COCKPIT_FIXTURE_NETWORK_REWRITE"
sed 's/"caption": "AGENTS"/"caption": "LATER"/' "$COCKPIT_FIXTURE_NETWORK_REWRITE" >"$COCKPIT_FIXTURE_LAYOUT_REWRITE" \
  || fatal "cannot write $COCKPIT_FIXTURE_LAYOUT_REWRITE"
# A rewrite that changed nothing (the fixture's text moved on) would leave the
# rewrite rows comparing a file with itself.
if cmp -s "$COCKPIT_FIXTURE_PATH" "$COCKPIT_FIXTURE_NETWORK_REWRITE" \
  || cmp -s "$COCKPIT_FIXTURE_NETWORK_REWRITE" "$COCKPIT_FIXTURE_LAYOUT_REWRITE"; then
  fatal "a rewrite of $COCKPIT_NESTED_FIXTURE changed nothing: its ssh master count or AGENTS caption moved"
fi
: >"$COCKPIT_SERVE_LOG"; : >"$COCKPIT_FOCUS_LOG"; : >"$COCKPIT_HERDR_REQUEST_LOG"; : >"$COCKPIT_FAKE_HERDR_LOG"
: >"$COCKPIT_FIXTURE_LOG"; : >"$COCKPIT_BAD_FIXTURE_LOG"; : >"$COCKPIT_REFUSED_FIXTURE_LOG"
: >"$COCKPIT_FAKE_CLIENT_LOG"; : >"$COCKPIT_PROC_FAULT_LOG"; : >"$COCKPIT_PROC_FAULT_HERDR_REQUEST_LOG"
: >"$COCKPIT_SILENT_HERDR_LOG"; : >"$COCKPIT_SILENT_HERDR_REQUEST_LOG"
# Decodes a gdbus call's reply (GLib.Variant text, as gdbus prints it, holding
# one JSON string). For `reply` it prints the JSON compactly (FocusSession's);
# `client-reply` does the same, but a focused reply's windowPidCandidates print
# as fake-client-then-script when they hold the fake herdr client's pid with its
# terminal's (script's) right after it, the two pids given after the text, and
# hold no pid 1; as themselves otherwise. Other herdr clients may come before or
# after (the host's own), so only those two are asked for. For `state` it
# prints the GetState fields named after the text, as <name>=<value> separated
# by spaces, in the order asked.
# shellcheck disable=SC2016  # JavaScript source: $ and backticks are gjs's, not bash's.
COCKPIT_REPLY_DECODER_JS='
const {GLib} = imports.gi;
const [replyKind, gdbusReplyText, ...fieldNames] = ARGV;
const SOURCE_NAMES = ["sessions", "network", "mounts"];
const SINGLE_STRING_TYPE = new GLib.VariantType("(s)");
const FAKE_CLIENT_CANDIDATES_TAG = "fake-client-then-script";
const INIT_PID = 1;
function holdsFakeClientThenScript(candidates, fakeClientPid, fakeClientScriptPid) {
    const fakeClientIndex = candidates.indexOf(fakeClientPid);
    return fakeClientIndex >= 0 && candidates[fakeClientIndex + 1] === fakeClientScriptPid &&
        !candidates.includes(INIT_PID);
}
function kindOf(value) {
    if (value === null || value === undefined)
        return "null";
    return Array.isArray(value) ? "list" : typeof value;
}
function stateFieldTexts(state) {
    const sources = state.sources ?? {};
    const sessions = sources.sessions ?? {};
    const uplink = sources.network?.uplink ?? {};
    const sourceKinds = SOURCE_NAMES.map(sourceName => kindOf(sources[sourceName]));
    const uplinkValues = [uplink.kind, uplink.connectivity, uplink.wifiEnabled].map(String);
    const intervals = SOURCE_NAMES.map(sourceName => String(sources[sourceName]?.intervalSeconds));
    const groupCount = state.layout?.groups?.length;
    const network = sources.network ?? {};
    return {
        protocol: String(state.protocol),
        sources: sourceKinds.join("/"),
        layout: kindOf(state.layout),
        groups: String(groupCount ?? "none"),
        configError: JSON.stringify(state.configError ?? null),
        published: String(state.latestPublishedAtUsec),
        herdrRunning: String(sessions.herdrRunning),
        sessionRows: String(sessions.rows?.length),
        mounts: kindOf(sources.mounts),
        mountsRows: kindOf(sources.mounts?.rows),
        uplink: uplinkValues.join("/"),
        intervals: intervals.join("/"),
        captions: (state.layout?.groups ?? []).map(group => group.caption).join("/"),
        sessionIds: (sessions.rows ?? []).map(row => row.id).join(","),
        vpn: String(network.vpn?.isUp),
        sshMasters: String(network.sshMasterCount),
        mountRowCount: String(sources.mounts?.rows?.length),
    };
}
let decoded;
try {
    const [replyJson] = GLib.Variant.parse(SINGLE_STRING_TYPE, gdbusReplyText, null, null).deepUnpack();
    const reply = JSON.parse(replyJson);
    const candidates = reply.windowPidCandidates;
    const [fakeClientPid, fakeClientScriptPid] = fieldNames.map(Number);
    if (replyKind === "client-reply" && reply.focused === true && Array.isArray(candidates) &&
            holdsFakeClientThenScript(candidates, fakeClientPid, fakeClientScriptPid))
        reply.windowPidCandidates = FAKE_CLIENT_CANDIDATES_TAG;
    if (replyKind === "reply" || replyKind === "client-reply") {
        decoded = JSON.stringify(reply);
    } else {
        const fieldTexts = stateFieldTexts(reply);
        decoded = fieldNames.map(fieldName => `${fieldName}=${fieldTexts[fieldName]}`).join(" ");
    }
} catch (error) {
    decoded = `unreadable reply: ${error.message}`;
}
print(decoded);
'
# A fake herdr on <socket path>, speaking herdr's framing (one JSON request
# line {id, method, params}, one reply line, then close: see
# service/herdrSocket.js). It logs each request as `<method> <params JSON>` to
# <request log>. Its snapshot holds four claude panes: w1:p1; w1:p2, whose
# pane.focus it rejects as herdr does a pane that is gone; p3, in no
# workspace; and one with no pane at all, whose row id is its session id. A
# request whose method is in the optional third argument (comma-separated) is
# logged and never answered: its connection is held open, unanswered.
# shellcheck disable=SC2016  # JavaScript source: $ and backticks are gjs's, not bash's.
COCKPIT_FAKE_HERDR_JS='
const {Gio, GLib} = imports.gi;
const [socketPath, requestLogPath, silentMethodList = ""] = ARGV;
const PANE_HERDR_REJECTS = "p2";
const SILENT_METHODS = new Set(silentMethodList.split(",").filter(methodName => methodName !== ""));
const heldConnections = [];
const SNAPSHOT = {
    workspaces: [{workspace_id: "w1", label: "alpha"}],
    agents: [
        {agent: "claude", agent_status: "working", workspace_id: "w1", pane_id: "p1", agent_session: {value: "s1"}},
        {agent: "claude", agent_status: "idle", workspace_id: "w1", pane_id: PANE_HERDR_REJECTS,
            agent_session: {value: "s2"}},
        {agent: "claude", agent_status: "idle", pane_id: "p3", cwd: "/work/beta", agent_session: {value: "s3"}},
        {agent: "claude", agent_status: "idle", cwd: "/work/gamma", agent_session: {value: "s4"}},
    ],
};
const requestLines = [];
function answerFor(method, params) {
    switch (method) {
    case "session.snapshot":
        return {result: {type: "session_snapshot", snapshot: SNAPSHOT}};
    case "pane.process_info":
        return {result: {type: "pane_process_info", process_info: {pane_id: params.pane_id, foreground_processes: []}}};
    case "workspace.focus":
        return {result: {type: "ok"}};
    case "pane.focus":
        if (params.pane_id === PANE_HERDR_REJECTS)
            return {error: {code: "pane_not_found", message: "pane not found"}};
        return {result: {type: "ok"}};
    default:
        return {error: {code: "invalid_request", message: "unknown method"}};
    }
}
function logRequest(request) {
    requestLines.push(`${request.method} ${JSON.stringify(request.params ?? {})}`);
    GLib.file_set_contents(requestLogPath, `${requestLines.join("\n")}\n`);
}
function replyTextFor(request) {
    logRequest(request);
    return JSON.stringify({id: request.id, ...answerFor(request.method, request.params ?? {})});
}
const socketService = new Gio.SocketService();
socketService.add_address(Gio.UnixSocketAddress.new(socketPath), Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT,
    null);
socketService.connect("incoming", (_service, connection) => {
    const lineReader = new Gio.DataInputStream({base_stream: connection.get_input_stream()});
    lineReader.read_line_async(GLib.PRIORITY_DEFAULT, null, (_stream, readResult) => {
        let replyText = "";
        try {
            const [requestLine] = lineReader.read_line_finish_utf8(readResult);
            const request = JSON.parse(requestLine);
            if (SILENT_METHODS.has(request.method)) {
                logRequest(request);
                heldConnections.push(connection);
                return;
            }
            replyText = replyTextFor(request);
        } catch (error) {
            printerr(`fake herdr: cannot answer: ${error.message}`);
        }
        const replyBytes = new GLib.Bytes(new TextEncoder().encode(`${replyText}\n`));
        connection.get_output_stream().write_bytes_async(replyBytes, GLib.PRIORITY_DEFAULT, null,
            (outputStream, writeResult) => {
                try {
                    if (outputStream.write_bytes_finish(writeResult) !== replyBytes.get_size())
                        printerr("fake herdr: a reply went out in part");
                } catch (error) {
                    printerr(`fake herdr: cannot reply: ${error.message}`);
                }
                connection.close(null);
            });
    });
    return true;
});
socketService.start();
new GLib.MainLoop(null, false).run();
'
# The driver. The serve run: owns the name, answers GetState, a second copy
# exits 1, then the config is rewritten unchanged (GetState's latest publish
# time read around it), overwritten with "{", deleted and renamed back into
# place, each followed by GetState for up to 3 s; then SIGTERM. The focus run: a
# fake herdr and the fake herdr client first, then the service, then one
# FocusSession per kind of row, each followed by the focus requests the fake
# herdr saw for it; then the fake herdr stopped and one more FocusSession, which
# finds herdr unreachable; then SIGTERM. The /proc-fault run: its own fake herdr,
# the faulty copy of the service, one FocusSession, SIGTERM; then the fake herdr
# client is stopped (and by the EXIT trap on every other path). The silent-herdr
# run: its own fake herdr, which answers the sessions source's requests and
# never a focus request, then the service, one timed FocusSession on a row with
# a workspace and one on a row in none, SIGTERM. The fixture run:
# GetState, two FocusSessions, then the fixture renamed over twice (the network
# rewrite, then the layout one), each followed by GetState for up to 3 s, with
# the Changed signals watched on the bus; then SIGTERM; then a fixture that does
# not exist, one that is not JSON and one under a stat-only path, each ending
# the service at its start. Every wait is bounded.
# shellcheck disable=SC2016  # The driver's own source: its variables expand when it runs.
COCKPIT_DRIVER_OUTPUT="$(on_private_bus bash -c '
set -u
cockpit_main="$1" decoder_js="$2" fake_herdr_js="$3" bus_name="$4" object_path="$5" run_dir="$6"
config_template="$7" config_relative_path="$8" no_system_bus="$9"
serve_log="${10}" focus_log="${11}" request_log="${12}" fake_herdr_log="${13}"
fixture_path="${14}" fixture_network_rewrite="${15}" fixture_layout_rewrite="${16}" fixture_log="${17}"
bad_fixture_log="${18}" refused_fixture_path="${19}" refused_fixture_log="${20}"
fake_client_path="${21}" fake_client_pid_file="${22}" fake_client_log="${23}"
proc_fault_main="${24}" proc_fault_log="${25}" proc_fault_request_log="${26}"
silent_herdr_log="${27}" silent_herdr_request_log="${28}" silent_herdr_methods="${29}"
is_private_bus_address "${DBUS_SESSION_BUS_ADDRESS:-}" "${RESOURCE_PULSE_TEST_BUS_DIR:-}" \
  || { printf "refused: %s is not the private bus\n" "${DBUS_SESSION_BUS_ADDRESS:-unset}"; exit 97; }
USEC_PER_SECOND=1000000
FOCUS_REQUEST_PATTERN="^(workspace|pane)\.focus "
# still_running <pid>: the process exists and is not a zombie (the state after the last ") " of its stat).
still_running() {
  local stat_line process_state
  read -r stat_line 2>/dev/null <"/proc/$1/stat" || return 1
  process_state="${stat_line##*) }"
  [[ "${process_state%% *}" != Z ]]
}
now_usec() { printf "%s" "${EPOCHREALTIME/./}"; }
# layout_changed_count <file>: the Changed signals gdbus monitor wrote to <file>
# that carry the key configError, which only a layout change adds.
layout_changed_count() {
  grep -c -E 'Changed.*configError' "$1"
}
# changed_count <file>: the Changed signals gdbus monitor wrote to <file>.
changed_count() {
  grep -c -F ".Changed (" "$1"
}
# changed_summary <file>: what each Changed signal gdbus monitor wrote to
# <file> names, in order, joined by |: layout when it carries configError,
# which only a layout change adds, then each source it carries.
changed_summary() {
  local monitor_line changed_names summary="" source_name
  while IFS= read -r monitor_line; do
    [[ "$monitor_line" == *".Changed ("* ]] || continue
    changed_names=""
    [[ "$monitor_line" == *\"configError\"* ]] && changed_names+="+layout"
    for source_name in sessions network mounts; do
      [[ "$monitor_line" == *\"$source_name\":* ]] && changed_names+="+$source_name"
    done
    summary+="|${changed_names#+}"
  done <"$1"
  printf "%s" "${summary#|}"
}
# wait_for_changed <file> <count>: waits at most 3 s for <count> Changed
# signals in <file>.
wait_for_changed() {
  local attempt
  for (( attempt = 0; attempt < 30; attempt++ )); do
    (( $(changed_count "$1") >= $2 )) && break
    sleep 0.1
  done
}
# start_fake_herdr_client: runs the fake herdr client under script(1), through
# an exec in the shell script starts, so that script is its parent; waits at
# most 5 s for its pid; sets fake_client_pid and fake_client_script_pid.
# SHELL=/bin/sh, so no login shell of the host reads its rc files. Prints
# fake-herdr-client=ready, or "could not run" and why when it wrote no pid, or
# is not named herdr, has no terminal or is not the child of script.
start_fake_herdr_client() {
  local attempt client_stat_line client_comm client_state="could not run: it wrote no pid within 5 s"
  local -a client_stat_fields=()
  : >"$fake_client_pid_file"
  env SHELL=/bin/sh script -qec "exec \"$fake_client_path\" \"$fake_client_pid_file\"" /dev/null \
    </dev/null >>"$fake_client_log" 2>&1 &
  fake_client_script_pid=$!
  for (( attempt = 0; attempt < 50; attempt++ )); do
    [[ -s "$fake_client_pid_file" ]] && break
    sleep 0.1
  done
  read -r fake_client_pid 2>/dev/null <"$fake_client_pid_file" || fake_client_pid=""
  [[ -n "$fake_client_pid" ]] && client_state="could not run: no /proc/$fake_client_pid/stat"
  if [[ -n "$fake_client_pid" ]] && read -r client_stat_line 2>/dev/null <"/proc/$fake_client_pid/stat"; then
    client_comm="${client_stat_line#*(}"
    client_comm="${client_comm%)*}"
    read -r -a client_stat_fields <<<"${client_stat_line##*) }"
    client_state="could not run: comm=$client_comm ppid=${client_stat_fields[1]-} tty_nr=${client_stat_fields[4]-}"
    [[ "$client_comm" == herdr && "${client_stat_fields[1]-}" == "$fake_client_script_pid" \
      && "${client_stat_fields[4]-0}" != 0 ]] && client_state=ready
  fi
  printf "fake-herdr-client=%s\n" "$client_state"
}
# stop_fake_herdr_client: SIGTERM to the fake herdr client, while its pid is
# still a process named herdr, and to script; then at most 5 s for script to
# end, and SIGKILL only while it still runs; safe when neither runs.
stop_fake_herdr_client() {
  local attempt client_stat_line=""
  [[ -n "$fake_client_pid" ]] && read -r client_stat_line 2>/dev/null <"/proc/$fake_client_pid/stat"
  [[ "$client_stat_line" == *" (herdr) "* ]] && kill -TERM "$fake_client_pid" 2>/dev/null
  if [[ -n "$fake_client_script_pid" ]]; then
    still_running "$fake_client_script_pid" && kill -TERM "$fake_client_script_pid" 2>/dev/null
    for (( attempt = 0; attempt < 50; attempt++ )); do
      still_running "$fake_client_script_pid" || break
      sleep 0.1
    done
    still_running "$fake_client_script_pid" && kill -KILL "$fake_client_script_pid" 2>/dev/null
    wait "$fake_client_script_pid" 2>/dev/null
  fi
  fake_client_pid="" fake_client_script_pid=""
}
# wait_for_banner <file>: waits at most 5 s for the first line of gdbus monitor
# (its "Monitoring signals" banner, the readiness signal) in <file>.
wait_for_banner() {
  local attempt
  for (( attempt = 0; attempt < 50; attempt++ )); do
    [[ -s "$1" ]] && break
    sleep 0.1
  done
}
# probe_state <seconds> <needle> <field...>: asks GetState through gdbus until
# the decoded fields hold <needle>, for at most <seconds>; prints the last
# decoding, or "no answer" when gdbus never answered.
probe_state() {
  local wait_seconds="$1" needle="$2" deadline_usec decoded="no answer" reply
  shift 2
  deadline_usec=$(( $(now_usec) + wait_seconds * USEC_PER_SECOND ))
  while :; do
    if reply="$(gdbus call --session --dest "$bus_name" --object-path "$object_path" \
        --method "$bus_name.GetState" --timeout 2 2>/dev/null)"; then
      decoded="$(gjs -c "$decoder_js" state "$reply" "$@")"
      [[ "$decoded" == *"$needle"* ]] && break
    fi
    (( $(now_usec) >= deadline_usec )) && break
    sleep 0.1
  done
  printf "%s" "$decoded"
}
# stop_process <label> <pid>: SIGTERM, then at most 10 s; prints <label>=<exit status>, or hung.
stop_process() {
  local label="$1" pid="$2" attempt
  kill -TERM "$pid" 2>/dev/null
  for (( attempt = 0; attempt < 100; attempt++ )); do
    still_running "$pid" || break
    sleep 0.1
  done
  if still_running "$pid"; then
    kill -KILL "$pid"
    wait "$pid"
    printf "%s=hung\n" "$label"
  else
    wait "$pid"
    printf "%s=%s\n" "$label" "$?"
  fi
}
# focus_session <id> [label] [decoding]: one FocusSession through gdbus;
# prints, under "focus <label>" (the id by default), the reply as the decoding
# <decoding> of the decoder gives it (client-reply, against the fake herdr
# client running now, by default) and the focus requests the fake herdr saw for
# it in request_log, joined by |; sets focus_call_ms, how long the gdbus call
# took.
focus_session() {
  local session_id="$1" label="${2:-$1}" reply_decoding="${3:-client-reply}" requests_before reply decoded requests
  local call_started_usec call_status
  requests_before="$(grep -c -E "$FOCUS_REQUEST_PATTERN" "$request_log")"
  call_started_usec="$(now_usec)"
  reply="$(gdbus call --session --dest "$bus_name" --object-path "$object_path" \
    --method "$bus_name.FocusSession" "\"$session_id\"" --timeout 5 2>&1)"
  call_status=$?
  focus_call_ms=$(( ($(now_usec) - call_started_usec) / 1000 ))
  if (( call_status == 0 )); then
    decoded="$(gjs -c "$decoder_js" "$reply_decoding" "$reply" "$fake_client_pid" "$fake_client_script_pid")"
  else
    decoded="D-Bus error: ${reply%%$'"'"'\n'"'"'*}"
  fi
  requests="$(grep -E "$FOCUS_REQUEST_PATTERN" "$request_log" | tail -n "+$(( requests_before + 1 ))" | tr "\n" "|")"
  printf "focus %s=reply=%s requests=[%s]\n" "$label" "$decoded" "${requests%|}"
  return 0
}

serve_config="$run_dir/serve-config/$config_relative_path"
serve_environment=(env HOME="$run_dir/serve-home" XDG_CONFIG_HOME="$run_dir/serve-config"
  XDG_STATE_HOME="$run_dir/serve-state" DBUS_SYSTEM_BUS_ADDRESS="$no_system_bus" RESOURCE_PULSE_COCKPIT_FIXTURE=)
"${serve_environment[@]}" gjs -m "$cockpit_main" >>"$serve_log" 2>&1 &
serve_pid=$!
printf "served=%s\n" "$(probe_state 15 "sources=object/object/object" \
  protocol sources groups configError herdrRunning mountsRows)"
printf "no-system-bus=%s\n" "$(probe_state 2 "uplink=" uplink intervals)"
"${serve_environment[@]}" timeout 30 gjs -m "$cockpit_main" >>"$serve_log" 2>&1
printf "second-exit=%s\n" "$?"
printf "after-second=%s\n" "$(probe_state 5 "protocol=1" protocol)"
# A monitor on the the service bus name, attached (its first output line, the
# "Monitoring signals" banner, is the readiness signal) before any rewrite. Only a
# layout change adds the key configError to Changed, so counting those lines
# says whether a rewrite published a layout; a mounts resample cannot move it.
monitor_log="$run_dir/layout-monitor.log"
: >"$monitor_log"
gdbus monitor --session --dest "$bus_name" >"$monitor_log" 2>&1 &
monitor_pid=$!
fixture_monitor_pid=""
fake_client_pid="" fake_client_script_pid=""
trap '"'"'kill "$monitor_pid" ${fixture_monitor_pid:+"$fixture_monitor_pid"} 2>/dev/null; stop_fake_herdr_client'"'"' EXIT
wait_for_banner "$monitor_log"
cp -- "$config_template" "$serve_config"
sleep 1
layout_changes_after_same_text="$(layout_changed_count "$monitor_log")"
printf "{" >"$serve_config"
printf "malformed=%s\n" "$(probe_state 3 "layout=null" layout configError mounts)"
for (( attempt = 0; attempt < 30; attempt++ )); do
  (( $(layout_changed_count "$monitor_log") >= 1 )) && break
  sleep 0.1
done
layout_changes_after_new_text="$(layout_changed_count "$monitor_log")"
kill "$monitor_pid" 2>/dev/null
printf "layout-changes=same-text=%s new-text=%s\n" \
  "$layout_changes_after_same_text" "$layout_changes_after_new_text"
rm -f -- "$serve_config"
printf "deleted=%s\n" "$(probe_state 3 "configError=\"missing\"" layout configError mounts)"
cp -- "$config_template" "$serve_config.new" && mv -- "$serve_config.new" "$serve_config"
printf "renamed-in=%s\n" "$(probe_state 3 "groups=2" layout groups configError)"
stop_process serve-exit "$serve_pid"

herdr_socket="$run_dir/focus-config/herdr/herdr.sock"
gjs -c "$fake_herdr_js" "$herdr_socket" "$request_log" >>"$fake_herdr_log" 2>&1 &
fake_herdr_pid=$!
for (( attempt = 0; attempt < 50; attempt++ )); do
  [[ -S "$herdr_socket" ]] && break
  sleep 0.1
done
start_fake_herdr_client
focus_environment=(env -u RESOURCE_PULSE_COCKPIT_FIXTURE HOME="$run_dir/focus-home"
  XDG_CONFIG_HOME="$run_dir/focus-config" XDG_STATE_HOME="$run_dir/focus-state"
  DBUS_SYSTEM_BUS_ADDRESS="$no_system_bus")
"${focus_environment[@]}" gjs -m "$cockpit_main" >>"$focus_log" 2>&1 &
focus_pid=$!
printf "focus-ready=%s\n" "$(probe_state 15 "sessionRows=4" herdrRunning sessionRows)"
for session_id in w1:p1 p3 w1:p2 w1:p9 s4; do
  focus_session "$session_id"
done
# The rows stay those of the start sample: unwatched, sessions resamples only
# after 60 s, so w1:p1 is still a row once herdr is gone.
kill -TERM "$fake_herdr_pid" 2>/dev/null
wait "$fake_herdr_pid" 2>/dev/null
focus_session w1:p1 "w1:p1 without herdr"
stop_process focus-exit "$focus_pid"

# The first fake herdr is gone, so the /proc-fault run has its own, logging to
# its own request log. The fake herdr client still runs: a scan that did not
# fault would name it.
request_log="$proc_fault_request_log"
proc_fault_herdr_socket="$run_dir/proc-fault-config/herdr/herdr.sock"
gjs -c "$fake_herdr_js" "$proc_fault_herdr_socket" "$request_log" >>"$fake_herdr_log" 2>&1 &
proc_fault_herdr_pid=$!
for (( attempt = 0; attempt < 50; attempt++ )); do
  [[ -S "$proc_fault_herdr_socket" ]] && break
  sleep 0.1
done
proc_fault_environment=(env -u RESOURCE_PULSE_COCKPIT_FIXTURE HOME="$run_dir/proc-fault-home"
  XDG_CONFIG_HOME="$run_dir/proc-fault-config" XDG_STATE_HOME="$run_dir/proc-fault-state"
  DBUS_SYSTEM_BUS_ADDRESS="$no_system_bus")
"${proc_fault_environment[@]}" gjs -m "$proc_fault_main" >>"$proc_fault_log" 2>&1 &
proc_fault_pid=$!
printf "proc-fault-ready=%s\n" "$(probe_state 15 "sessionRows=4" herdrRunning sessionRows)"
focus_session w1:p1 "proc-fault w1:p1" reply
stop_process proc-fault-exit "$proc_fault_pid"
kill -TERM "$proc_fault_herdr_pid" 2>/dev/null
wait "$proc_fault_herdr_pid" 2>/dev/null
stop_fake_herdr_client

request_log="$silent_herdr_request_log"
silent_herdr_socket="$run_dir/silent-herdr-config/herdr/herdr.sock"
gjs -c "$fake_herdr_js" "$silent_herdr_socket" "$request_log" "$silent_herdr_methods" >>"$fake_herdr_log" 2>&1 &
silent_herdr_pid=$!
for (( attempt = 0; attempt < 50; attempt++ )); do
  [[ -S "$silent_herdr_socket" ]] && break
  sleep 0.1
done
silent_herdr_environment=(env -u RESOURCE_PULSE_COCKPIT_FIXTURE HOME="$run_dir/silent-herdr-home"
  XDG_CONFIG_HOME="$run_dir/silent-herdr-config" XDG_STATE_HOME="$run_dir/silent-herdr-state"
  DBUS_SYSTEM_BUS_ADDRESS="$no_system_bus")
"${silent_herdr_environment[@]}" gjs -m "$cockpit_main" >>"$silent_herdr_log" 2>&1 &
silent_herdr_service_pid=$!
printf "silent-herdr-ready=%s\n" "$(probe_state 15 "sessionRows=4" herdrRunning sessionRows)"
for session_id in w1:p1 p3; do
  focus_session "$session_id" "silent-herdr $session_id" reply
  printf "silent-herdr-call-ms %s=%s\n" "$session_id" "$focus_call_ms"
done
stop_process silent-herdr-exit "$silent_herdr_service_pid"
kill -TERM "$silent_herdr_pid" 2>/dev/null
wait "$silent_herdr_pid" 2>/dev/null

fixture_environment=(env HOME="$run_dir/fixture-home" XDG_CONFIG_HOME="$run_dir/fixture-config"
  XDG_STATE_HOME="$run_dir/fixture-state" DBUS_SYSTEM_BUS_ADDRESS="$no_system_bus")
"${fixture_environment[@]}" RESOURCE_PULSE_COCKPIT_FIXTURE="$fixture_path" gjs -m "$cockpit_main" \
  >>"$fixture_log" 2>&1 &
fixture_pid=$!
printf "fixture-served=%s\n" "$(probe_state 15 "sessionIds=w1:p1,w1:p2" \
  groups configError herdrRunning sessionIds uplink vpn sshMasters mountRowCount intervals)"
focus_session w1:p1 "fixture w1:p1" reply
focus_session w1:p9 "fixture w1:p9" reply
fixture_monitor_log="$run_dir/fixture-monitor.log"
: >"$fixture_monitor_log"
gdbus monitor --session --dest "$bus_name" >"$fixture_monitor_log" 2>&1 &
fixture_monitor_pid=$!
wait_for_banner "$fixture_monitor_log"
cp -- "$fixture_network_rewrite" "$fixture_path.new" && mv -- "$fixture_path.new" "$fixture_path"
printf "fixture-network-rewrite=%s\n" "$(probe_state 3 "sshMasters=3" sshMasters captions)"
wait_for_changed "$fixture_monitor_log" 1
cp -- "$fixture_layout_rewrite" "$fixture_path.new" && mv -- "$fixture_path.new" "$fixture_path"
printf "fixture-layout-rewrite=%s\n" "$(probe_state 3 "captions=MACHINE/LATER" sshMasters captions)"
wait_for_changed "$fixture_monitor_log" 2
kill "$fixture_monitor_pid" 2>/dev/null
printf "fixture-changes=%s\n" "$(changed_summary "$fixture_monitor_log")"
stop_process fixture-exit "$fixture_pid"
"${fixture_environment[@]}" RESOURCE_PULSE_COCKPIT_FIXTURE="$run_dir/no-such-fixture.json" \
  timeout 30 gjs -m "$cockpit_main" >>"$bad_fixture_log" 2>&1
printf "missing-fixture-exit=%s\n" "$?"
printf "{" >"$run_dir/malformed-fixture.json"
"${fixture_environment[@]}" RESOURCE_PULSE_COCKPIT_FIXTURE="$run_dir/malformed-fixture.json" \
  timeout 30 gjs -m "$cockpit_main" >>"$bad_fixture_log" 2>&1
printf "malformed-fixture-exit=%s\n" "$?"
"${fixture_environment[@]}" RESOURCE_PULSE_COCKPIT_FIXTURE="$refused_fixture_path" \
  timeout 30 gjs -m "$cockpit_main" >>"$refused_fixture_log" 2>&1
printf "refused-fixture-exit=%s\n" "$?"
' cockpit-driver "$COCKPIT_MAIN_PATH" "$COCKPIT_REPLY_DECODER_JS" "$COCKPIT_FAKE_HERDR_JS" "$COCKPIT_BUS_NAME" \
  "$COCKPIT_OBJECT_PATH" "$COCKPIT_RUN_DIR" "$COCKPIT_CONFIG_TEMPLATE" "$COCKPIT_CONFIG_RELATIVE_PATH" \
  "$COCKPIT_NO_SYSTEM_BUS" "$COCKPIT_SERVE_LOG" "$COCKPIT_FOCUS_LOG" "$COCKPIT_HERDR_REQUEST_LOG" \
  "$COCKPIT_FAKE_HERDR_LOG" "$COCKPIT_FIXTURE_PATH" "$COCKPIT_FIXTURE_NETWORK_REWRITE" \
  "$COCKPIT_FIXTURE_LAYOUT_REWRITE" "$COCKPIT_FIXTURE_LOG" "$COCKPIT_BAD_FIXTURE_LOG" \
  "$COCKPIT_REFUSED_FIXTURE_PATH" "$COCKPIT_REFUSED_FIXTURE_LOG" "$COCKPIT_FAKE_CLIENT_PATH" \
  "$COCKPIT_FAKE_CLIENT_PID_FILE" "$COCKPIT_FAKE_CLIENT_LOG" "$COCKPIT_PROC_FAULT_MAIN_PATH" \
  "$COCKPIT_PROC_FAULT_LOG" "$COCKPIT_PROC_FAULT_HERDR_REQUEST_LOG" "$COCKPIT_SILENT_HERDR_LOG" \
  "$COCKPIT_SILENT_HERDR_REQUEST_LOG" "$COCKPIT_SILENT_HERDR_METHODS" 2>&1)"
declare -A cockpit_driver_said=()
while IFS= read -r driver_line; do
  [[ "$driver_line" == *=* ]] && cockpit_driver_said["${driver_line%%=*}"]="${driver_line#*=}"
done <<<"$COCKPIT_DRIVER_OUTPUT"
# Without the fake herdr client the FocusSession rows would check nothing, so a
# client that did not come up is "could not run", never a row of its own.
cockpit_fake_client_state="${cockpit_driver_said[fake-herdr-client]-never started}"
[[ "$cockpit_fake_client_state" == ready ]] \
  || fatal "the fake herdr client of the FocusSession rows: $cockpit_fake_client_state (driver said: $COCKPIT_DRIVER_OUTPUT)"
cockpit_fail_count_before=$FAIL
check "service/cockpit.js, started through a link to the extension, as resource-pulse-cockpit.service starts it, with RESOURCE_PULSE_COCKPIT_FIXTURE set empty (no fixture), owns Cockpit1 within 15 s and its GetState says protocol 1, the template's two groups, herdr not running and a list of mount rows" \
  "${cockpit_driver_said[served]-}" "protocol=1 sources=object/object/object groups=2 configError=null herdrRunning=false mountsRows=list"
check "with no system bus it serves all the same: no uplink known, and every unwatched cadence off battery (sessions 60 s, network 60 s, mounts 120 s)" \
  "${cockpit_driver_said[no-system-bus]-}" "uplink=null/null/null intervals=60/60/120"
check "a second service/cockpit.js finds the name taken and exits 1, while the first keeps serving" \
  "second-exit=${cockpit_driver_said[second-exit]-} after-second=${cockpit_driver_said[after-second]-}" \
  "second-exit=1 after-second=protocol=1"
check "the config rewritten with the same text publishes no layout change, and with a new text publishes one (Changed signals carrying configError, watched on the bus)" \
  "${cockpit_driver_said[layout-changes]-}" "same-text=0 new-text=1"
check "the config overwritten with '{' reads within 3 s as no layout and the parse error, and the sources keep serving" \
  "${cockpit_driver_said[malformed]-}" 'layout=null configError="config: malformed JSON" mounts=object'
check "the config deleted reads within 3 s as no layout and the error missing, and the sources keep serving" \
  "${cockpit_driver_said[deleted]-}" 'layout=null configError="missing" mounts=object'
check "the config renamed back into place (an atomic editor's save) reads within 3 s as the layout again" \
  "${cockpit_driver_said[renamed-in]-}" "layout=object groups=2 configError=null"
check "SIGTERM ends service/cockpit.js with exit 0, in all three runs" \
  "serve=${cockpit_driver_said[serve-exit]-} focus=${cockpit_driver_said[focus-exit]-} fixture=${cockpit_driver_said[fixture-exit]-}" \
  "serve=0 focus=0 fixture=0"
check "service/cockpit.js logged its serving line once, with the protocol" \
  "$(grep -c -F "cockpit: serving $COCKPIT_BUS_NAME (protocol 1)" "$COCKPIT_SERVE_LOG")" 1
check "service/cockpit.js logged no gjs or GLib warning, critical or uncaught error, in any run (the fixture's, the bad and refused fixtures', the /proc-fault run's and the silent herdr's included)" \
  "$(cat "$COCKPIT_SERVE_LOG" "$COCKPIT_FOCUS_LOG" "$COCKPIT_FIXTURE_LOG" "$COCKPIT_BAD_FIXTURE_LOG" \
    "$COCKPIT_REFUSED_FIXTURE_LOG" "$COCKPIT_PROC_FAULT_LOG" "$COCKPIT_SILENT_HERDR_LOG" \
    | grep -c -E "$ENGINE_WARNING_PATTERN")" 0
# A focused reply's windowPidCandidates come from /proc: every herdr client (a
# process named herdr with a terminal) and its parents. The driver's own fake
# client is one on any machine, CI included, so the decoder prints
# fake-client-then-script only when the reply names its pid with its terminal's
# (script's) right after it, and no pid 1. The host's real herdr clients may
# add their own chains around it, so nothing else in the list is asked for;
# lib/processTree.js's rows pin the order, the repeats and the bounds.
check "FocusSession, with RESOURCE_PULSE_COCKPIT_FIXTURE unset, focuses the row's own workspace, then its pane, over the herdr socket: focused true, windowPid null, and window candidates naming the fake herdr client, then its terminal, and never pid 1" \
  "ready=${cockpit_driver_said[focus-ready]-} ${cockpit_driver_said[focus w1:p1]-}" \
  'ready=herdrRunning=true sessionRows=4 reply={"focused":true,"windowPid":null,"error":null,"windowPidCandidates":"fake-client-then-script"} requests=[workspace.focus {"workspace_id":"w1"}|pane.focus {"pane_id":"p1"}]'
check "FocusSession on a row in no workspace sends pane.focus alone, and names the fake herdr client, then its terminal, and never pid 1" \
  "${cockpit_driver_said[focus p3]-}" \
  'reply={"focused":true,"windowPid":null,"error":null,"windowPidCandidates":"fake-client-then-script"} requests=[pane.focus {"pane_id":"p3"}]'
# A herdr rejection is an answer, not a fault: the cockpit replies with its
# code itself, so the D-Bus face's fault line never appears for it. herdr's own
# text goes to the journal alone.
check "a herdr rejection of pane.focus answers focused false and the code herdr-rejected, not a D-Bus error nor herdr's text, which is logged, not as a fault" \
  "${cockpit_driver_said[focus w1:p2]-} logged=$(grep -c -F 'cockpit: focus: w1:p2: herdr: pane_not_found: pane not found' "$COCKPIT_FOCUS_LOG") faults=$(grep -c -F 'cockpit: FocusSession failed' "$COCKPIT_FOCUS_LOG")" \
  'reply={"focused":false,"windowPid":null,"error":"herdr-rejected","windowPidCandidates":[]} requests=[workspace.focus {"workspace_id":"w1"}|pane.focus {"pane_id":"p2"}] logged=1 faults=0'
check "an unknown id, and a row with no pane, answer focused false with the codes unknown-session and no-pane and ask herdr nothing" \
  "unknown: ${cockpit_driver_said[focus w1:p9]-} no-pane: ${cockpit_driver_said[focus s4]-}" \
  'unknown: reply={"focused":false,"windowPid":null,"error":"unknown-session","windowPidCandidates":[]} requests=[] no-pane: reply={"focused":false,"windowPid":null,"error":"no-pane","windowPidCandidates":[]} requests=[]'
check "with the fake herdr stopped, a row answers focused false and the code herdr-unreachable, and herdr's text goes to the journal" \
  "${cockpit_driver_said[focus w1:p1 without herdr]-} logged=$(grep -c -F 'cockpit: focus: w1:p1: herdr: ' "$COCKPIT_FOCUS_LOG")" \
  'reply={"focused":false,"windowPid":null,"error":"herdr-unreachable","windowPidCandidates":[]} requests=[] logged=1'
# FocusSession bounds each of its two herdr requests by a timeout of its own, shorter than a sample's, so that a herdr
# that takes the connection and never answers is answered herdr-unreachable before the shell's client gives up on
# the call: for a row with a workspace (its workspace.focus goes unanswered) and one in none (its pane.focus). The
# requests the silent herdr took show that each call reached it, not a socket that refused it.
# silent_herdr_focus <session id> prints the reply and requests, and whether the call came back within the timeout.
silent_herdr_focus() {
  local call_ms="${cockpit_driver_said[silent-herdr-call-ms $1]-}" within_call_timeout
  within_call_timeout="no ($call_ms ms)"
  [[ "$call_ms" =~ ^[0-9]+$ ]] && (( call_ms < COCKPIT_CLIENT_CALL_TIMEOUT_MS )) && within_call_timeout=yes
  printf '%s within-call-timeout=%s' "${cockpit_driver_said[focus silent-herdr $1]-}" "$within_call_timeout"
}
check "FocusSession against a herdr that takes the connection and never answers a focus request answers focused false and herdr-unreachable within the shell's call timeout ($COCKPIT_CLIENT_CALL_TIMEOUT_MS ms), for a row with a workspace and for one in none; the service still ends with 0 on SIGTERM" \
  "ready=${cockpit_driver_said[silent-herdr-ready]-} w1:p1: $(silent_herdr_focus w1:p1) p3: $(silent_herdr_focus p3) exit=${cockpit_driver_said[silent-herdr-exit]-}" \
  'ready=herdrRunning=true sessionRows=4 w1:p1: reply={"focused":false,"windowPid":null,"error":"herdr-unreachable","windowPidCandidates":[]} requests=[workspace.focus {"workspace_id":"w1"}] within-call-timeout=yes p3: reply={"focused":false,"windowPid":null,"error":"herdr-unreachable","windowPidCandidates":[]} requests=[pane.focus {"pane_id":"p3"}] within-call-timeout=yes exit=0'
# The /proc-fault copy throws a plain Error listing /proc, once herdr focused
# the pane. The pane is focused all the same, so the reply must say so, naming
# no window (the fake client still runs, so the scan would otherwise name it),
# with the fault logged once, never answered as the face's internal error.
check "a fault (not IO) while naming the window candidates leaves the reply focused, with no candidates, the fault logged once and never as the face's internal error" \
  "ready=${cockpit_driver_said[proc-fault-ready]-} ${cockpit_driver_said[focus proc-fault w1:p1]-} logged=$(grep -c -F "cockpit: focus: window candidates: $COCKPIT_PROC_FAULT_MESSAGE" "$COCKPIT_PROC_FAULT_LOG") faults=$(grep -c -F 'cockpit: FocusSession failed' "$COCKPIT_PROC_FAULT_LOG") exit=${cockpit_driver_said[proc-fault-exit]-}" \
  'ready=herdrRunning=true sessionRows=4 reply={"focused":true,"windowPid":null,"error":null,"windowPidCandidates":[]} requests=[workspace.focus {"workspace_id":"w1"}|pane.focus {"pane_id":"p1"}] logged=1 faults=0 exit=0'
# The fixture run's config home holds no config and no herdr socket: serving the
# config would read as no layout and the error missing, serving the sources as
# herdr not running, no session rows and no uplink.
check "with RESOURCE_PULSE_COCKPIT_FIXTURE naming nested-state.json, GetState within 15 s serves the fixture's layout and sources, neither the config's nor the real sources'" \
  "${cockpit_driver_said[fixture-served]-}" \
  'groups=2 configError=null herdrRunning=true sessionIds=w1:p1,w1:p2 uplink=wired/full/false vpn=false sshMasters=2 mountRowCount=1 intervals=10/10/30'
check "with the fixture, FocusSession answers its focusReply, windowPidCandidates [4242] included, for a row's id and an unknown one alike" \
  "${cockpit_driver_said[focus fixture w1:p1]-} ${cockpit_driver_said[focus fixture w1:p9]-}" \
  'reply={"focused":true,"windowPid":null,"error":null,"windowPidCandidates":[4242]} requests=[] reply={"focused":true,"windowPid":null,"error":null,"windowPidCandidates":[4242]} requests=[]'
check "the fixture renamed over with another network source reads within 3 s as the new one, and then with another layout as the new layout" \
  "network=${cockpit_driver_said[fixture-network-rewrite]-} layout=${cockpit_driver_said[fixture-layout-rewrite]-}" \
  'network=sshMasters=3 captions=MACHINE/AGENTS layout=sshMasters=3 captions=MACHINE/LATER'
check "each fixture rewrite publishes one Changed naming what changed: the network source alone, then the layout alone" \
  "${cockpit_driver_said[fixture-changes]-}" 'network|layout'
check "with the fixture, service/cockpit.js logs its serving line and the fixture's path once each" \
  "serving=$(grep -c -F "cockpit: serving $COCKPIT_BUS_NAME (protocol 1)" "$COCKPIT_FIXTURE_LOG") fixture=$(grep -c -F "cockpit: serving a fixture ($COCKPIT_FIXTURE_PATH)" "$COCKPIT_FIXTURE_LOG")" \
  'serving=1 fixture=1'
check "a fixture that does not exist, or that is not JSON, ends service/cockpit.js at its start with exit 1, saying why, before it serves" \
  "missing=${cockpit_driver_said[missing-fixture-exit]-} malformed=${cockpit_driver_said[malformed-fixture-exit]-} logged=$(grep -c -F 'cockpit: shutting down: cannot serve the fixture (' "$COCKPIT_BAD_FIXTURE_LOG") served=$(grep -c -F 'cockpit: serving' "$COCKPIT_BAD_FIXTURE_LOG")" \
  'missing=1 malformed=1 logged=2 served=0'
# The fixture at that path is readable and valid: reading it would serve it,
# and only the refusing reader's refusal ends the start, with its own reason.
check "a readable, valid fixture under a stat-only path (/.ssh/) is refused unopened: service/cockpit.js exits 1 at its start, saying so, and never serves" \
  "exit=${cockpit_driver_said[refused-fixture-exit]-} logged=$(grep -c -F "cockpit: shutting down: cannot serve the fixture ($COCKPIT_REFUSED_FIXTURE_PATH): $COCKPIT_FIXTURE_REFUSED_REASON" "$COCKPIT_REFUSED_FIXTURE_LOG") served=$(grep -c -F 'cockpit: serving' "$COCKPIT_REFUSED_FIXTURE_LOG")" \
  'exit=1 logged=1 served=0'
if (( FAIL > cockpit_fail_count_before )); then
  printf '    (driver said: %s)\n' "$COCKPIT_DRIVER_OUTPUT"
  sed 's/^/    serve log: /' "$COCKPIT_SERVE_LOG"
  sed 's/^/    focus log: /' "$COCKPIT_FOCUS_LOG"
  sed 's/^/    fake herdr log: /' "$COCKPIT_FAKE_HERDR_LOG"
  sed 's/^/    fixture log: /' "$COCKPIT_FIXTURE_LOG"
  sed 's/^/    bad fixture log: /' "$COCKPIT_BAD_FIXTURE_LOG"
  sed 's/^/    refused fixture log: /' "$COCKPIT_REFUSED_FIXTURE_LOG"
  sed 's/^/    \/proc-fault log: /' "$COCKPIT_PROC_FAULT_LOG"
  sed 's/^/    silent herdr log: /' "$COCKPIT_SILENT_HERDR_LOG"
  sed 's/^/    fake herdr client log: /' "$COCKPIT_FAKE_CLIENT_LOG"
fi

# This table's own total. The guide states it.
EXPECTED_ROWS=64

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
