#!/usr/bin/env bash
#
# scripts/test-resource-pulse-source.sh
# =====================================
#
# State table for the SOURCE of the Resource Pulse GNOME Shell extension
# (gnome-shell/extensions/resource-pulse@zvibaratz.github.io): rows that read the files, or run
# a small helper over them, and need no bus, no stub of the live session and no
# service. The Shell glue (extension.js, indicator.js, card.js and the cockpit's
# three Shell modules) must parse and get as far as its first
# `resource:///org/gnome/shell` import, and the measurer of the cockpit's lengths
# as far as its St import; the pure modules must import no Shell
# module, nothing may block the shell's main loop, and metadata.json must say what
# GNOME 50 needs; resource-pulse-module-closure.sh must follow each side's imports;
# only privateBus.js may open a bus connection in a test; and the cockpit service
# may stat, never open, its stat-only paths. A missing file makes a row FAIL,
# never pass.
#
# "Could not run" is exit 2, never a pass: a missing gjs, find, timeout or rg is
# fatal. The table asserts its own row total. Its shared helpers and constants
# are scripts/resource-pulse-table-lib.sh's.
#
# Requires: bash, gjs, find, timeout, and rg (ripgrep: the row that keeps every
# test's bus connection in privateBus.js searches with it). No network, no root.
#
# Usage: scripts/test-resource-pulse-source.sh
#   RESOURCE_PULSE_EXT_DIR=<dir> points the file rows at a copy of the
#   extension (for a mutation trial).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
source "$TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
start_table

[[ -d "$EXT_DIR" ]] || fatal "no extension directory at $EXT_DIR"
require_tools gjs find timeout rg

# ---------------------------------------------------------------------------
# The Shell glue and the packaging: what plain gjs cannot run
# ---------------------------------------------------------------------------
printf '\nShell glue and packaging (%s)\n' "$EXT_DIR"

# The Shell modules do not exist outside gnome-shell, so plain gjs stops at the
# first one. Getting there proves the file parsed; both shapes were measured
# on gjs 1.88: a Shell import fails with "ImportError: Unable to load file
# from: resource:///…", a parse error says "SyntaxError" and never gets there.
SHELL_IMPORT_NEEDLE='resource:///org/gnome/shell'
SYNTAX_ERROR_NEEDLE='SyntaxError'
for glue_file in extension.js indicator.js card.js cockpitTooltip.js cockpitCards.js cockpitLayer.js; do
  glue_path="$EXT_DIR/$glue_file"
  row_name="$glue_file parses and gets as far as its Shell imports"
  if [[ ! -r "$glue_path" ]]; then
    bad "$row_name — cannot read $glue_path"
    continue
  fi
  parse_output="$(timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -m "$glue_path" 2>&1)"
  if [[ "$parse_output" == *"$SYNTAX_ERROR_NEEDLE"* ]]; then
    bad "$row_name — gjs reported a SyntaxError: $parse_output"
  elif [[ "$parse_output" != *"$SHELL_IMPORT_NEEDLE"* ]]; then
    bad "$row_name — gjs never reached a $SHELL_IMPORT_NEEDLE import: $parse_output"
  else
    ok "$row_name"
  fi
done
# The card's compact layout, the dropdown's caption line and its wrapping
# layout, and the top bar's mark import no Shell module, only the toolkit's
# Clutter first (then St or Pango), whose typelib plain gjs does not find.
# Getting to that error proves the file and the modules it imports parsed: gjs
# parses the whole graph before it runs it.
CLUTTER_TYPELIB_NEEDLE="Typelib file for namespace 'Clutter'"
for toolkit_file in compactCardLayout.js machineCaptionsRow.js machineMark.js wrappedRowsLayout.js; do
  toolkit_path="$EXT_DIR/$toolkit_file"
  row_name="$toolkit_file parses and gets as far as its Clutter import"
  if [[ ! -r "$toolkit_path" ]]; then
    bad "$row_name — cannot read $toolkit_path"
    continue
  fi
  parse_output="$(timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -m "$toolkit_path" 2>&1)"
  if [[ "$parse_output" == *"$SYNTAX_ERROR_NEEDLE"* ]]; then
    bad "$row_name — gjs reported a SyntaxError: $parse_output"
  elif [[ "$parse_output" != *"$CLUTTER_TYPELIB_NEEDLE"* ]]; then
    bad "$row_name — gjs never reached its Clutter import: $parse_output"
  else
    ok "$row_name"
  fi
done

# The measurer of the cockpit's lengths imports St and no Shell module, so plain gjs stops at St instead: its typelib
# lives only in the Shell's own directory. Measured on gjs 1.88: "Requiring St, version none: Typelib file for
# namespace 'St' (any version) not found". Getting there proves the file parsed.
ST_IMPORT_NEEDLE='Requiring St'
measurer_path="$EXT_DIR/cockpitLengthsMeasurer.js"
row_name="cockpitLengthsMeasurer.js parses and gets as far as its St import"
if [[ ! -r "$measurer_path" ]]; then
  bad "$row_name — cannot read $measurer_path"
else
  parse_output="$(timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -m "$measurer_path" 2>&1)"
  if [[ "$parse_output" == *"$SYNTAX_ERROR_NEEDLE"* ]]; then
    bad "$row_name — gjs reported a SyntaxError: $parse_output"
  elif [[ "$parse_output" != *"$ST_IMPORT_NEEDLE"* ]]; then
    bad "$row_name — gjs never reached its St import: $parse_output"
  else
    ok "$row_name"
  fi
fi

# The cockpit's tiles import Clutter and St and no Shell module, Clutter first (sessionsTileCells.js through the
# base), so plain gjs stops at Clutter, as at compactCardLayout.js above. Getting there proves the file parsed.
for tile_file in cockpitTileBase.js heaviestTile.js connectionsTile.js sessionsTile.js sessionsTileColumns.js \
  sessionsTileRow.js sessionsTileStrip.js sessionsTileCells.js monitorTile.js monitorLayout.js; do
  tile_path="$EXT_DIR/$tile_file"
  row_name="$tile_file parses and gets as far as its Clutter import"
  if [[ ! -r "$tile_path" ]]; then
    bad "$row_name — cannot read $tile_path"
    continue
  fi
  parse_output="$(timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -m "$tile_path" 2>&1)"
  if [[ "$parse_output" == *"$SYNTAX_ERROR_NEEDLE"* ]]; then
    bad "$row_name — gjs reported a SyntaxError: $parse_output"
  elif [[ "$parse_output" != *"$CLUTTER_TYPELIB_NEEDLE"* ]]; then
    bad "$row_name — gjs never reached its Clutter import: $parse_output"
  else
    ok "$row_name"
  fi
done

# list_files_under <directory> <array name> <find test>...: fills the named
# array with every path find lists under the directory with those tests, and
# returns non-zero when find does. find exits non-zero when it cannot read a
# directory, and a file it never listed is a file no scan read, so a scan fails
# then rather than passing over it; find's own message is left on stderr,
# naming the directory. The listing goes through a file: a process
# substitution would lose find's status.
list_files_under() {
  local search_dir="$1" listing_path
  local -n listed_paths="$2"
  shift 2
  listed_paths=()
  listing_path="$(mktemp -p "$WIRING_TMP" file-listing.XXXXXX)" || return 2
  if ! find "$search_dir" "$@" -print0 >"$listing_path"; then
    rm -f "$listing_path"
    return 1
  fi
  # listed_paths is a nameref: filling it fills the caller's array, which ShellCheck reads as never used.
  # shellcheck disable=SC2034
  mapfile -d '' listed_paths <"$listing_path"
  rm -f "$listing_path"
  return 0
}
# list_shell_side_javascript <extension dir> <array name>: fills the named
# array with every .js file under the extension directory outside the top-level
# service/, and returns non-zero when the tree cannot be listed
# (list_files_under).
list_shell_side_javascript() {
  local extension_dir="$1" javascript_path
  local -n shell_side_paths="$2"
  local -a javascript_paths=()
  shell_side_paths=()
  list_files_under "$extension_dir" javascript_paths -type f -name '*.js' || return
  for javascript_path in "${javascript_paths[@]}"; do
    [[ "$javascript_path" == "$extension_dir/service/"* ]] || shell_side_paths+=("$javascript_path")
  done
  return 0
}
# shell_side_files_matching <extension dir> <how>: one line per shell-side .js
# file (list_shell_side_javascript) whose text matches: with "literal:<text>"
# when it contains the text, with "pattern:<ERE>" when the regular expression
# matches it (newlines included, so a call may span lines). One line per such
# file that cannot be read (an unread file is not a clean one), and a line when
# the tree cannot be listed or holds no shell-side JavaScript.
shell_side_files_matching() {
  local extension_dir="$1" match_rule="$2" extension_file_path relative_path extension_file_text
  local -a extension_file_paths=()
  if ! list_shell_side_javascript "$extension_dir" extension_file_paths; then
    printf 'cannot list the JavaScript under %s\n' "$extension_dir"
    return
  fi
  if (( ${#extension_file_paths[@]} == 0 )); then
    printf 'found no shell-side JavaScript under %s\n' "$extension_dir"
    return
  fi
  for extension_file_path in "${extension_file_paths[@]}"; do
    relative_path="${extension_file_path#"$extension_dir"/}"
    if [[ ! -r "$extension_file_path" ]] || ! extension_file_text="$(<"$extension_file_path")"; then
      printf 'cannot read %s\n' "$relative_path"
    elif [[ "$match_rule" == literal:* && "$extension_file_text" == *"${match_rule#literal:}"* ]]; then
      printf '%s\n' "$relative_path"
    elif [[ "$match_rule" == pattern:* && "$extension_file_text" =~ ${match_rule#pattern:} ]]; then
      printf '%s\n' "$relative_path"
    fi
  done
}

# lib/, pulseClient.js, pulseServiceStart.js, serviceLink.js, cockpitClient.js,
# displayConfig.js, cockpitSourceDrawing.js, graph.js and traceGraph.js run under plain gjs in
# the JS rows above, which only works while they import nothing from the Shell.
# A listed file that is missing fails the row: an absent file contains nothing,
# which is not a pass.
PURE_MODULE_PATHS=("$EXT_DIR/pulseClient.js" "$EXT_DIR/pulseServiceStart.js" "$EXT_DIR/serviceLink.js"
  "$EXT_DIR/cockpitClient.js" "$EXT_DIR/displayConfig.js" "$EXT_DIR/cockpitSourceDrawing.js" "$EXT_DIR/graph.js"
  "$EXT_DIR/traceGraph.js")
row_name="lib/, pulseClient.js, pulseServiceStart.js, serviceLink.js, cockpitClient.js, displayConfig.js,"
row_name+=" cockpitSourceDrawing.js, graph.js and traceGraph.js import nothing from resource:///"
if ! list_files_under "$EXT_DIR/lib" LIB_MODULE_PATHS -type f -name '*.js'; then
  bad "$row_name — cannot list the JavaScript under $EXT_DIR/lib"
elif (( ${#LIB_MODULE_PATHS[@]} == 0 )); then
  bad "$row_name — found no lib/*.js under $EXT_DIR"
else
  pure_module_problems=()
  for module_path in "${PURE_MODULE_PATHS[@]}" "${LIB_MODULE_PATHS[@]}"; do
    if [[ ! -r "$module_path" ]]; then
      pure_module_problems+=("cannot read ${module_path#"$EXT_DIR"/}")
    elif [[ "$(<"$module_path")" == *'resource:///'* ]]; then
      pure_module_problems+=("${module_path#"$EXT_DIR"/} mentions resource:///")
    fi
  done
  if (( ${#pure_module_problems[@]} == 0 )); then
    ok "$row_name"
  else
    bad "$row_name — ${pure_module_problems[*]}"
  fi
fi

# The shell side runs on the compositor's main loop: no subprocess and no
# synchronous IO (file or D-Bus), anywhere in it. service/ is the sampler
# service, its own process outside the shell, so it may read files
# synchronously; it still starts no subprocess. Each Gio call is matched with
# its "(" so its _async form (enumerate_children_async( and so on) does not
# match, and _sync( and Sync( catch every synchronous D-Bus call (call_sync,
# new_sync, bus_get_sync, a proxy wrapper's GetStateSync) without catching an
# _async or Async one.
SUBPROCESS_CALL_PATTERN='Gio.Subprocess|GLib.spawn|Util.spawn|util_spawn'
SYNCHRONOUS_IO_CALL_PATTERN='load_contents\(|file_get_contents|enumerate_children\(|query_info\(|read_bytes\(|load_bytes\('
SYNCHRONOUS_IO_CALL_PATTERN+='|replace_contents\(|next_file\(|next_files\(|query_exists\(|query_file_type\(|GLib\.file_test'
SYNCHRONOUS_IO_CALL_PATTERN+='|read_all\(|GLib\.Dir\.open|\.read\(null\)|\.close\(null\)|_sync\('
# A GJS proxy wrapper (Gio.DBusProxy.makeProxyWrapper) gives each method an XxxSync( besides XxxRemote( and
# XxxAsync(; the capital S keeps Async( out.
SYNCHRONOUS_IO_CALL_PATTERN+='|Sync\('
BLOCKING_CALL_PATTERN="$SUBPROCESS_CALL_PATTERN|$SYNCHRONOUS_IO_CALL_PATTERN"
# blocking_calls_in <extension dir>: one line, "<path>: <call>", for each file
# making a call its place forbids: a subprocess anywhere, synchronous IO
# anywhere but the top-level service/. A tree that cannot be listed
# (list_files_under), or holds no files, is a line too.
blocking_calls_in() {
  local extension_dir="$1" extension_file_path forbidden_call_pattern
  local -a extension_file_paths=()
  if ! list_files_under "$extension_dir" extension_file_paths -type f; then
    printf 'cannot list the files under %s\n' "$extension_dir"
    return 1
  fi
  if (( ${#extension_file_paths[@]} == 0 )); then
    printf 'found no files under %s\n' "$extension_dir"
    return 0
  fi
  for extension_file_path in "${extension_file_paths[@]}"; do
    forbidden_call_pattern="$BLOCKING_CALL_PATTERN"
    [[ "$extension_file_path" == "$extension_dir/service/"* ]] && forbidden_call_pattern="$SUBPROCESS_CALL_PATTERN"
    if [[ "$(<"$extension_file_path")" =~ $forbidden_call_pattern ]]; then
      printf '%s: %s\n' "${extension_file_path#"$extension_dir"/}" "${BASH_REMATCH[0]}"
    fi
  done
  return 0
}
# The pattern itself: every forbidden call (a subprocess, synchronous IO) must
# match, and no asynchronous call, IO or D-Bus, that the shell side makes.
FORBIDDEN_CALLS=('Gio.Subprocess.new(' 'GLib.spawn_command_line_async(' 'Util.spawn([' 'file.load_contents(null)'
  'GLib.file_get_contents(path)' 'file.enumerate_children(attributes, flags, null)' 'file.query_info(attributes, flags, null)'
  'stream.read_bytes(4096, null)' 'file.load_bytes(null)' 'file.replace_contents(bytes, null, false, 0, null)'
  'enumerator.next_file(null)' 'enumerator.next_files(64, null)' 'file.query_exists(null)'
  'file.query_file_type(flags, null)' 'GLib.file_test(path, GLib.FileTest.EXISTS)' 'stream.read_all(buffer, null)'
  'GLib.Dir.open(path, 0)' 'file.read(null)' 'stream.close(null)' 'Shell.util_spawn_async(workingDirectory, argv, envp, flags)'
  'connection.call_sync(busName, objectPath, interfaceName, methodName, null, null, flags, timeoutMs, null)'
  'Gio.DBusProxy.new_sync(connection, flags, null, busName, objectPath, interfaceName, null)' 'proxy.GetStateSync()')
ASYNCHRONOUS_CALLS=('file.load_contents_async(null)' 'file.enumerate_children_async(attributes, flags, priority, null)'
  'file.query_info_async(attributes, flags, priority, null)' 'stream.read_bytes_async(4096, priority, null)'
  'file.load_bytes_async(null)' 'file.replace_contents_async(bytes, null, false, 0, null)'
  'enumerator.next_files_async(64, priority, null)' 'file.read_async(priority, null)' 'stream.close_async(priority, null)'
  'enumerator.close_async(priority, null)' 'Gio.bus_get(busType, cancellable, callback)' 'Gio.bus_get_finish(result)'
  'Gio.DBusProxy.new(connection, flags, null, busName, objectPath, interfaceName, cancellable, callback)'
  'Gio.DBusProxy.new_finish(result)' 'proxy.call(methodName, null, flags, timeoutMs, cancellable, callback)'
  'proxy.call_finish(result)' 'connection.call(busName, objectPath, interfaceName, methodName, parameters, replyType, flags, timeoutMs, cancellable, callback)'
  'connection.call_finish(result)' 'proxy.GetStateAsync()' 'proxy.GetStateRemote(callback)')
unmatched_forbidden_calls=()
for io_call in "${FORBIDDEN_CALLS[@]}"; do
  [[ "$io_call" =~ $BLOCKING_CALL_PATTERN ]] || unmatched_forbidden_calls+=("$io_call")
done
matched_asynchronous_calls=()
for io_call in "${ASYNCHRONOUS_CALLS[@]}"; do
  [[ "$io_call" =~ $BLOCKING_CALL_PATTERN ]] && matched_asynchronous_calls+=("$io_call")
done
check "the blocking-call pattern matches every forbidden call (subprocess, synchronous IO) and no asynchronous IO or D-Bus call" \
  "missed=[${unmatched_forbidden_calls[*]}] async-matched=[${matched_asynchronous_calls[*]}]" "missed=[] async-matched=[]"
row_name="no file in the extension spawns a process, and none outside service/ does synchronous IO (file or D-Bus)"
# The scan's own exit status is read too: a scan that could not run prints
# nothing, which is not a pass.
blocking_calls="$(blocking_calls_in "$EXT_DIR")"
blocking_scan_status=$?
if (( blocking_scan_status == 0 )) && [[ -z "$blocking_calls" ]]; then
  ok "$row_name"
else
  bad "$row_name — scan exit $blocking_scan_status: $(tr '\n' ' ' <<<"$blocking_calls")"
fi
# The scan's scoping, on a fixture tree: service/ (and only the top-level one)
# may read files synchronously, nothing may spawn, and an asynchronous D-Bus call
# is fine anywhere.
PLACEMENT_FIXTURE_DIR="$WIRING_TMP/placement-fixture"
mkdir -p "$PLACEMENT_FIXTURE_DIR/service" "$PLACEMENT_FIXTURE_DIR/lib/service" \
  || fatal "cannot create the placement fixture under $PLACEMENT_FIXTURE_DIR"
printf '%s\n' 'const [, contents] = file.load_contents(null);' >"$PLACEMENT_FIXTURE_DIR/service/reads.js"
printf '%s\n' 'const process = Gio.Subprocess.new(argv, flags);' >"$PLACEMENT_FIXTURE_DIR/service/spawns.js"
printf '%s\n' 'const [, contents] = file.load_contents(null);' >"$PLACEMENT_FIXTURE_DIR/lib/service/reads.js"
printf '%s\n' 'const fileInfo = enumerator.next_file(null);' >"$PLACEMENT_FIXTURE_DIR/lib/lists.js"
printf '%s\n' 'proxy.call(methodName, null, flags, timeoutMs, cancellable, callback);' >"$PLACEMENT_FIXTURE_DIR/client.js"
check "the placement scan lets the top-level service/ read files but not spawn, and nothing else read (a fixture tree)" \
  "$(blocking_calls_in "$PLACEMENT_FIXTURE_DIR" | LC_ALL=C sort | tr '\n' ' ')" \
  "lib/lists.js: next_file( lib/service/reads.js: load_contents( service/spawns.js: Gio.Subprocess "

# A shell-side module that imports anything from service/ would load the
# cockpit service, with its synchronous reads, into gnome-shell. GNOME loads only
# extension.js and what it imports, so service/ stays out of the shell only
# while nothing outside service/ imports it, statically or dynamically: a
# from, import or import( whose quoted specifier starts with service/ or
# reaches it after a slash. Comments that name service/ files are not imports.
SERVICE_IMPORT_PATTERN="(from|import)[[:space:]]*[(]?[[:space:]]*['\"]([^'\"]*/)?service/"
# service_imports_in <extension dir>: one line per .js file outside the
# top-level service/ that imports from service/ (shell_side_files_matching). A
# tree that cannot be listed or holds no shell-side JavaScript, and a file that
# cannot be read, are a line too.
service_imports_in() { shell_side_files_matching "$1" "pattern:$SERVICE_IMPORT_PATTERN"; }
row_name="no file outside service/ imports service/, so gnome-shell never loads service code"
service_importers="$(service_imports_in "$EXT_DIR")"
service_import_scan_status=$?
if (( service_import_scan_status == 0 )) && [[ -z "$service_importers" ]]; then
  ok "$row_name"
else
  bad "$row_name — scan exit $service_import_scan_status: $(tr '\n' ' ' <<<"$service_importers")"
fi
SERVICE_IMPORT_FIXTURE_DIR="$WIRING_TMP/service-import-fixture"
mkdir -p "$SERVICE_IMPORT_FIXTURE_DIR/service" "$SERVICE_IMPORT_FIXTURE_DIR/lib" \
  || fatal "cannot create the service-import fixture under $SERVICE_IMPORT_FIXTURE_DIR"
printf '%s\n' "import {CockpitSources} from './service/cockpitSources.js';" >"$SERVICE_IMPORT_FIXTURE_DIR/extension.js"
printf '%s\n' "const serviceModule = await import('../service/cockpit.js');" >"$SERVICE_IMPORT_FIXTURE_DIR/lib/loader.js"
printf '%s\n' '// The cockpit (service/cockpit.js) publishes these.' \
  "import {COCKPIT_BUS_NAME} from './lib/cockpitProtocol.js';" >"$SERVICE_IMPORT_FIXTURE_DIR/card.js"
# service/ may import itself, even by a path that leaves and re-enters it.
printf '%s\n' "import {CockpitSources} from './cockpitSources.js';" "import {runEveryStep} from '../lib/teardown.js';" \
  "import {readFileToEnd} from '../service/fileIo.js';" >"$SERVICE_IMPORT_FIXTURE_DIR/service/cockpit.js"
check "the service/ import scan finds a static and a dynamic import of service/, and neither a comment nor service/'s own" \
  "$(service_imports_in "$SERVICE_IMPORT_FIXTURE_DIR" | LC_ALL=C sort | tr '\n' ' ')" "extension.js lib/loader.js "

# A D-Bus proxy object owned only by JavaScript, with handlers connected, is
# referenced by GDBus on every incoming signal, and that makes GJS schedule a
# forced full garbage collection on the compositor thread 10 s later: once per
# Sample. So no shell-side file (every .js outside the top-level service/) may
# name one, not even in a comment: the client follows the service through
# serviceLink.js's name watch and subscription. The service, a process of its
# own, may.
DBUS_PROXY_LITERAL='Gio.DBusProxy'
# dbus_proxy_mentions_in <extension dir>: one line per shell-side .js file that
# contains DBUS_PROXY_LITERAL, comments included (shell_side_files_matching).
dbus_proxy_mentions_in() { shell_side_files_matching "$1" "literal:$DBUS_PROXY_LITERAL"; }
row_name="no shell-side file names Gio.DBusProxy"
dbus_proxy_mentions="$(dbus_proxy_mentions_in "$EXT_DIR")"
if [[ -z "$dbus_proxy_mentions" ]]; then
  ok "$row_name"
else
  bad "$row_name — $(tr '\n' ' ' <<<"$dbus_proxy_mentions")"
fi
# The planted twin, on a copy of the extension: a call at the top level and a
# comment in lib/ are found; service/, whose sources use proxies, is not.
DBUS_PROXY_FIXTURE_DIR="$WIRING_TMP/dbus-proxy-fixture"
cp -R "$EXT_DIR" "$DBUS_PROXY_FIXTURE_DIR" || fatal "cannot copy $EXT_DIR to $DBUS_PROXY_FIXTURE_DIR"
printf '%s\n' 'Gio.DBusProxy.new(connection, flags, null, busName, objectPath, interfaceName, cancellable, callback);' \
  >>"$DBUS_PROXY_FIXTURE_DIR/pulseClient.js"
printf '%s\n' '// Built with Gio.DBusProxy.new(connection, ...), once.' >>"$DBUS_PROXY_FIXTURE_DIR/lib/wiring.js"
check "a planted Gio.DBusProxy.new( in a shell-side copy is found" \
  "$(dbus_proxy_mentions_in "$DBUS_PROXY_FIXTURE_DIR" | LC_ALL=C sort | tr '\n' ' ')" "lib/wiring.js pulseClient.js "

# While Samples flow they are the shell's tick, and a timer at the same rate
# costs about as much as handling one (the card's old cover re-check timer did,
# measured), so nothing shell-side may wake on the sampler's interval: no
# shell-side file adds a timeout whose arguments name SAMPLE_INTERVAL_SECONDS,
# whether a GLib timeout of any kind, the client's injectable addSeconds or
# addMilliseconds, or setTimeout or setInterval. The call is matched up to the
# end of its statement, across lines, comments included. service/, the sampler,
# ticks at that interval by design.
SAMPLE_INTERVAL_TIMEOUT_PATTERN='(timeout_add[a-z_]*|addSeconds|addMilliseconds|setTimeout|setInterval)\([^;]*'
SAMPLE_INTERVAL_TIMEOUT_PATTERN+='SAMPLE_INTERVAL_SECONDS'
# sample_interval_timeouts_in <extension dir>: one line per shell-side .js file
# that adds such a timeout (shell_side_files_matching).
sample_interval_timeouts_in() { shell_side_files_matching "$1" "pattern:$SAMPLE_INTERVAL_TIMEOUT_PATTERN"; }
row_name="no shell-side file adds a timeout of SAMPLE_INTERVAL_SECONDS"
sample_interval_timeouts="$(sample_interval_timeouts_in "$EXT_DIR")"
if [[ -z "$sample_interval_timeouts" ]]; then
  ok "$row_name"
else
  bad "$row_name — $(tr '\n' ' ' <<<"$sample_interval_timeouts")"
fi
# The planted twin, on a copy of the extension: the cover re-check timer this
# row replaced, put back in extension.js with its interval on the next line, and
# a watchdog-style addMilliseconds in lib/, are found; the same timeout in
# service/ is not.
SAMPLE_TIMEOUT_FIXTURE_DIR="$WIRING_TMP/sample-timeout-fixture"
cp -R "$EXT_DIR" "$SAMPLE_TIMEOUT_FIXTURE_DIR" || fatal "cannot copy $EXT_DIR to $SAMPLE_TIMEOUT_FIXTURE_DIR"
printf '%s\n' 'this._coverRecheckSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,' \
  '    SAMPLE_INTERVAL_SECONDS, () => this._onCoverRecheckTimeout());' >>"$SAMPLE_TIMEOUT_FIXTURE_DIR/extension.js"
printf '%s\n' 'this._timeouts.addMilliseconds(SAMPLE_INTERVAL_SECONDS * 1000, () => this._onTick());' \
  >>"$SAMPLE_TIMEOUT_FIXTURE_DIR/lib/wiring.js"
printf '%s\n' 'GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SAMPLE_INTERVAL_SECONDS, () => this._onTimeout());' \
  >>"$SAMPLE_TIMEOUT_FIXTURE_DIR/service/cockpit.js"
check "no shell-side file adds a timeout of SAMPLE_INTERVAL_SECONDS: a planted one is found" \
  "$(sample_interval_timeouts_in "$SAMPLE_TIMEOUT_FIXTURE_DIR" | LC_ALL=C sort | tr '\n' ' ')" \
  "extension.js lib/wiring.js "

# A repeating timer in the shell while Samples flow is a budget no measurement
# here catches: perf's count budgets do not move for a timer that draws nothing,
# and the row above knows a timer only by the sampler's interval. So every
# timeout the shell side adds is pinned, by file and count: the one line of
# cockpitClient.js's injectable GLIB_TIMEOUTS seam (1), whose one-shot timeouts
# are the steps of its StartUnit chain (the wait for the service to appear, and
# the retry delay), each returning SOURCE_REMOVE; cockpitTooltip.js's show delay
# (1), one-shot; cockpitSourceDrawing.js's fallback that draws a Changed the next
# Sample did not (1), one-shot, of COCKPIT_CHANGED_APPLY_FALLBACK_SECONDS, armed
# only while a Changed waits and removed by each Sample: one call site, the line
# of its injectable seam, which the cockpit layer's pacing and the dropdown's
# share, so the layer adds none; extension.js's cover fallback
# (1), indicator.js's hover label delay (1), and the pulse client's injectable
# timeouts, split over its two modules: the line of pulseClient.js's
# GLIB_TIMEOUTS seam that arms the stall watchdog (1), and
# pulseServiceStart.js's whole-second timeout (1), the seam's default for the
# steps of the client's StartUnit chain, each returning SOURCE_REMOVE. One more
# anywhere, a new file included, or one moved between files, fails the row until
# it is counted here. GJS's own setTimeout(
# and setInterval( are timeouts too and are counted with GLib's two calls (the
# shell side uses neither today); a method whose name merely ends that way (a
# letter, digit, _ or . before "set") is not one. The
# call text is counted on code lines only: a line that starts as a comment (//,
# /* or a JSDoc *) is not a call.
SHELL_SIDE_GLIB_TIMEOUT_CALL_PATTERN='GLib[.]timeout_add(_seconds)?[(]|(^|[^A-Za-z0-9_.])set(Timeout|Interval)[(]'
EXPECTED_SHELL_SIDE_GLIB_TIMEOUT_CALLS='cockpitClient.js:1 cockpitSourceDrawing.js:1 cockpitTooltip.js:1 '
EXPECTED_SHELL_SIDE_GLIB_TIMEOUT_CALLS+='extension.js:1 indicator.js:1 '
EXPECTED_SHELL_SIDE_GLIB_TIMEOUT_CALLS+='pulseClient.js:1 pulseServiceStart.js:1 '
# glib_timeout_calls_in <extension dir>: one line, "<file>:<count>", per
# shell-side .js file (list_shell_side_javascript) whose code lines add GLib
# timeouts; one per such file awk cannot read, and one when the tree cannot be
# listed or holds no shell-side JavaScript.
glib_timeout_calls_in() {
  local extension_dir="$1" extension_file_path relative_path timeout_call_count
  local -a extension_file_paths=()
  if ! list_shell_side_javascript "$extension_dir" extension_file_paths; then
    printf 'cannot list the JavaScript under %s\n' "$extension_dir"
    return
  fi
  if (( ${#extension_file_paths[@]} == 0 )); then
    printf 'found no shell-side JavaScript under %s\n' "$extension_dir"
    return
  fi
  for extension_file_path in "${extension_file_paths[@]}"; do
    relative_path="${extension_file_path#"$extension_dir"/}"
    if ! timeout_call_count="$(awk -v call_pattern="$SHELL_SIDE_GLIB_TIMEOUT_CALL_PATTERN" '
        /^[ \t]*(\/\/|\/\*|\*)/ { next }
        { code_line = $0; call_count += gsub(call_pattern, "", code_line) }
        END { print call_count + 0 }' "$extension_file_path")"; then
      printf 'cannot read %s\n' "$relative_path"
    elif (( timeout_call_count > 0 )); then
      printf '%s:%s\n' "$relative_path" "$timeout_call_count"
    fi
  done
}
check "the shell side adds a timeout in the places the table knows, and nowhere else" \
  "$(glib_timeout_calls_in "$EXT_DIR" | LC_ALL=C sort | tr '\n' ' ')" "$EXPECTED_SHELL_SIDE_GLIB_TIMEOUT_CALLS"
# The planted twin, on a copy of the extension: one GLib.timeout_add( and one
# setInterval( in card.js, which adds none today, are the one difference the row
# sees; a row blind to either form would count 1 there, not 2. A method named
# resetTimeout( planted beside them is not a timeout and is not counted.
GLIB_TIMEOUT_FIXTURE_DIR="$WIRING_TMP/glib-timeout-fixture"
cp -R "$EXT_DIR" "$GLIB_TIMEOUT_FIXTURE_DIR" || fatal "cannot copy $EXT_DIR to $GLIB_TIMEOUT_FIXTURE_DIR"
printf '%s\n' 'this._pollSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => GLib.SOURCE_CONTINUE);' \
  '    setInterval(() => this._poll(), 2000);' 'this.resetTimeout(5);' >>"$GLIB_TIMEOUT_FIXTURE_DIR/card.js"
check "the shell side adds a timeout in the places the table knows, and nowhere else: planted ones in card.js are found" \
  "$(glib_timeout_calls_in "$GLIB_TIMEOUT_FIXTURE_DIR" | LC_ALL=C sort | tr '\n' ' ')" \
  "card.js:2 $EXPECTED_SHELL_SIDE_GLIB_TIMEOUT_CALLS"

# The compositor repaints every actor of the card's layer on each frame a window draws over it, because actors there
# are not culled, so the card draws through an offscreen texture (one cached rectangle for those frames): _init sets
# the redirect to ALWAYS. card.js imports the Shell and cannot run here, so the row reads its text. The call is
# counted inside _init's body only: a call elsewhere in the file does not redirect a card at construction.
OFFSCREEN_REDIRECT_CALL='this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);'
# offscreen_redirect_calls_in_init <card.js>: how many times _init's body (from its signature to the closing brace
# at the method's indentation) holds a line that IS OFFSCREEN_REDIRECT_CALL: nothing but whitespace before it and
# nothing after it, so a call in a // or /* */ comment is not counted. awk does it all, so a zero is an answer and
# an unreadable file is awk's failure status (returned), not an empty count; "no _init body" when there is none.
offscreen_redirect_calls_in_init() {
  awk -v call="$OFFSCREEN_REDIRECT_CALL" '
    /^    _init\(client\) \{$/ { in_init = 1 }
    in_init { line = $0; sub(/^[ \t]+/, "", line); if (line == call) found++ }
    in_init && /^    \}$/ { exit }
    END { if (in_init) print found + 0; else print "no _init body" }' "$1"
}
real_card_redirect_calls="$(offscreen_redirect_calls_in_init "$EXT_DIR/card.js")"
check "card.js sets the offscreen redirect to ALWAYS in _init" "$real_card_redirect_calls" 1
# The planted twin, on copies of card.js: the call deleted, the call moved out of _init to the end of the file, and
# the call commented out with // in place, each count 0 (neither a call outside _init nor a commented one may satisfy
# the row).
OFFSCREEN_FIXTURE_DIR="$WIRING_TMP/offscreen-fixture"
mkdir "$OFFSCREEN_FIXTURE_DIR" || fatal "cannot create $OFFSCREEN_FIXTURE_DIR"
awk -v call="$OFFSCREEN_REDIRECT_CALL" 'index($0, call) == 0' "$EXT_DIR/card.js" \
  >"$OFFSCREEN_FIXTURE_DIR/deleted.js" || fatal "cannot write $OFFSCREEN_FIXTURE_DIR/deleted.js"
awk -v call="$OFFSCREEN_REDIRECT_CALL" 'index($0, call) { print "        // " call; next } { print }' \
  "$EXT_DIR/card.js" >"$OFFSCREEN_FIXTURE_DIR/commented.js" || fatal "cannot write $OFFSCREEN_FIXTURE_DIR/commented.js"
{ cat "$OFFSCREEN_FIXTURE_DIR/deleted.js"; printf '    %s\n' "$OFFSCREEN_REDIRECT_CALL"; } \
  >"$OFFSCREEN_FIXTURE_DIR/moved.js"
deleted_card_redirect_calls="$(offscreen_redirect_calls_in_init "$OFFSCREEN_FIXTURE_DIR/deleted.js")"
moved_card_redirect_calls="$(offscreen_redirect_calls_in_init "$OFFSCREEN_FIXTURE_DIR/moved.js")"
check "card.js sets the offscreen redirect to ALWAYS in _init: a deleted call and a moved one are not counted" \
  "$deleted_card_redirect_calls|$moved_card_redirect_calls" "0|0"
commented_card_redirect_calls="$(offscreen_redirect_calls_in_init "$OFFSCREEN_FIXTURE_DIR/commented.js")"
check "card.js sets the offscreen redirect to ALWAYS in _init: a commented-out call is not counted" \
  "$commented_card_redirect_calls" 0

# A JavaScript paint override runs in the compositor's paint path on every frame the actor draws, and GJS cannot
# do that cheaply: no shell-side file overrides the paint vfunc or its node variant. The scan matches the text
# anywhere, comments included, so no comment spells it either; the literal below also covers the _node variant.
PAINT_OVERRIDE_LITERAL='vfunc_paint'
# paint_overrides_in <extension dir>: one line per shell-side .js file that contains PAINT_OVERRIDE_LITERAL
# (shell_side_files_matching).
paint_overrides_in() { shell_side_files_matching "$1" "literal:$PAINT_OVERRIDE_LITERAL"; }
row_name="no shell-side file overrides vfunc_paint or vfunc_paint_node"
paint_overrides="$(paint_overrides_in "$EXT_DIR")"
if [[ -z "$paint_overrides" ]]; then
  ok "$row_name"
else
  bad "$row_name — $(tr '\n' ' ' <<<"$paint_overrides")"
fi
# The planted twin, on a copy of the extension: an override in the card and a node override in lib/ are found;
# service/ is not scanned.
PAINT_OVERRIDE_FIXTURE_DIR="$WIRING_TMP/paint-override-fixture"
cp -R "$EXT_DIR" "$PAINT_OVERRIDE_FIXTURE_DIR" || fatal "cannot copy $EXT_DIR to $PAINT_OVERRIDE_FIXTURE_DIR"
printf '%s\n' '    vfunc_paint(paintContext) { super.vfunc_paint(paintContext); }' \
  >>"$PAINT_OVERRIDE_FIXTURE_DIR/card.js"
printf '%s\n' '    vfunc_paint_node() {}' >>"$PAINT_OVERRIDE_FIXTURE_DIR/lib/wiring.js"
printf '%s\n' '    vfunc_paint(paintContext) {}' >>"$PAINT_OVERRIDE_FIXTURE_DIR/service/cockpit.js"
check "no shell-side file overrides vfunc_paint or vfunc_paint_node: a planted override is found" \
  "$(paint_overrides_in "$PAINT_OVERRIDE_FIXTURE_DIR" | LC_ALL=C sort | tr '\n' ' ')" "card.js lib/wiring.js "

# extension.js imports the Shell, so its teardown cannot run here. lib/teardown.js
# (runEveryStep, whose rows are in lifecycle.test.js) guards each step; these
# rows read extension.js for the order of its destroy steps, every one of them
# (any part a step destroys, so a new one cannot slip in unpinned): the
# DisplayConfig read is cancelled first, then the cockpit layer goes, the most
# visible part (it gives the v2 card back as it goes), then the card, because a
# card left behind would show frozen numbers as live, the indicator, and last
# the two clients.
EXTENSION_JS="$EXT_DIR/extension.js"
teardown_destroy_order="$(grep -E "run: \(\) => [A-Za-z]+\?\.destroy\(\)" "$EXTENSION_JS" 2>/dev/null \
  | sed -E 's/.*=> ([A-Za-z]+)\?\.destroy.*/\1/' | tr '\n' ' ')"
check "extension.js tears down in guarded steps (runEveryStep): the DisplayConfig read, the layer, the card, the indicator, the cockpit client, then the client" \
  "$teardown_destroy_order|$(grep -c -F 'runEveryStep([' "$EXTENSION_JS" 2>/dev/null)" \
  "displayConfigReader layer card indicator cockpitClient client |1"
# The client's own failures (a StartUnit refused, a call timed out) heal by
# themselves, so they stay warnings; the extension's teardown failures are
# errors. Each kind has one limiter that outlives every enable.
# Three clients take it: the pulse client, the cockpit client and the
# DisplayConfig reader.
check "extension.js hands every client one rate-limited logger that writes warnings and spans enables" \
  "$(grep -c -F 'errorLog: this._clientLog' "$EXTENSION_JS" 2>/dev/null):$(grep -c -E 'this\._clientLog = new RateLimitedLogger\(\{nowUsec, write: line => console\.warn\(line\)\}\)' "$EXTENSION_JS" 2>/dev/null)" "3:1"
# A client lives for one enable (every unlock and blank makes a new one), so the
# last good clock label is kept in the extension, as the loggers are: set once,
# saved from the client before teardown destroys it and never reset there, and
# seeded into each new client. After an unlock with the service down the
# surfaces then say "no data since HH:MM", not a bare "no data". The bodies are
# read from each method's declaration line to the closing brace at its indent.
method_body_lines() { sed -n "/^    $1 {\$/,/^    }\$/p" "$EXTENSION_JS" 2>/dev/null | sed 's/^[[:space:]]*//'; }
LAST_GOOD_LABEL_SAVE_STATEMENT='this._lastGoodClockLabel = client?.lastGoodClockLabel ?? this._lastGoodClockLabel;'
CLIENT_DESTROY_STEP="{name: 'destroy the client', run: () => client?.destroy()},"
teardown_lines="$(method_body_lines '_tearDown()')"
label_save_line_number="$(grep -n -x -F "$LAST_GOOD_LABEL_SAVE_STATEMENT" <<<"$teardown_lines" | head -n 1 | cut -d: -f1)"
client_destroy_line_number="$(grep -n -x -F "$CLIENT_DESTROY_STEP" <<<"$teardown_lines" | head -n 1 | cut -d: -f1)"
label_saved_before_destroy="no"
if [[ -n "$label_save_line_number" && -n "$client_destroy_line_number" ]] \
  && (( label_save_line_number < client_destroy_line_number )); then
  label_saved_before_destroy="yes"
fi
check "extension.js keeps the last good clock label across enables: set once, saved from the client before teardown destroys it, never reset there, and seeded into each new client" \
  "set=$(method_body_lines 'constructor(metadata)' | grep -c -x -F 'this._lastGoodClockLabel = null;') saved-before-destroy=$label_saved_before_destroy reset-in-teardown=$(grep -c -E '^this\._lastGoodClockLabel = null;' <<<"$teardown_lines") seeded=$(method_body_lines 'enable()' | grep -c -F 'lastGoodClockLabel: this._lastGoodClockLabel')" \
  "set=1 saved-before-destroy=yes reset-in-teardown=0 seeded=1"
# The cockpit's layout is kept the same way, so the grid is drawn
# at once after an unlock or a blank: set once, saved from the cockpit client
# before teardown destroys it (the layout lib/cockpitWiring.js
# cockpitLayoutToKeep keeps: none once the cockpit is SKIPPED, nor one that
# failed to build in this enable, so a broken layout is never
# seeded into the next enable), never reset there, and seeded into each new
# cockpit client as its cached layout. The call's argument lines are read
# joined, from the line after its opening one to its closing one.
LAYOUT_SAVE_STATEMENT='this._lastCockpitLayout = cockpitClient === null'
LAYOUT_KEPT_STATEMENT=': cockpitLayoutToKeep({'
LAYOUT_KEPT_ARGUMENTS='clientState: cockpitClient.state, layout: cockpitClient.layout, failedLayout: this._failedCockpitLayout, });'
LAYOUT_KEPT_ARGUMENT_LINE_COUNT=3
COCKPIT_CLIENT_DESTROY_STEP="{name: 'destroy the cockpit client', run: () => cockpitClient?.destroy()},"
layout_save_line_number="$(grep -n -x -F "$LAYOUT_SAVE_STATEMENT" <<<"$teardown_lines" | head -n 1 | cut -d: -f1)"
layout_kept_line_number="$(grep -n -x -F "$LAYOUT_KEPT_STATEMENT" <<<"$teardown_lines" | head -n 1 | cut -d: -f1)"
cockpit_destroy_line_number="$(grep -n -x -F "$COCKPIT_CLIENT_DESTROY_STEP" <<<"$teardown_lines" \
  | head -n 1 | cut -d: -f1)"
layout_saved_before_destroy="no"
if [[ -n "$layout_save_line_number" && -n "$layout_kept_line_number" && -n "$cockpit_destroy_line_number" ]] \
  && (( layout_save_line_number + 2 == layout_kept_line_number )) \
  && (( layout_kept_line_number < cockpit_destroy_line_number )); then
  layout_saved_before_destroy="yes"
fi
layout_failed_not_kept="no"
if [[ -n "$layout_kept_line_number" ]]; then
  layout_kept_first_argument_line=$(( layout_kept_line_number + 1 ))
  layout_kept_last_argument_line=$(( layout_kept_line_number + LAYOUT_KEPT_ARGUMENT_LINE_COUNT ))
  layout_kept_arguments="$(sed -n "${layout_kept_first_argument_line},${layout_kept_last_argument_line}p" \
    <<<"$teardown_lines" | tr '\n' ' ')"
  if [[ "${layout_kept_arguments% }" == "$LAYOUT_KEPT_ARGUMENTS" ]]; then
    layout_failed_not_kept="yes"
  fi
fi
check "extension.js keeps the cockpit's layout across enables: set once, saved from the cockpit client (cockpitLayoutToKeep, never the layout that failed to build) before teardown destroys it, never reset there, and seeded into each new cockpit client" \
  "set=$(method_body_lines 'constructor(metadata)' | grep -c -x -F 'this._lastCockpitLayout = null;') saved-before-destroy=$layout_saved_before_destroy failed-not-kept=$layout_failed_not_kept reset-in-teardown=$(grep -c -E '^this\._lastCockpitLayout = null;' <<<"$teardown_lines") seeded=$(method_body_lines 'enable()' | grep -c -F 'cachedLayout: this._lastCockpitLayout')" \
  "set=1 saved-before-destroy=yes failed-not-kept=yes reset-in-teardown=0 seeded=1"
check "indicator.js re-places a shown hover label when its width or the display scale changes" \
  "$(grep -c -E "'notify::(width|scale-factor)'" "$EXT_DIR/indicator.js" 2>/dev/null)" 2
# notify::width is emitted during allocation, and moving an actor then makes
# Clutter warn "Can't update stage views actor ... needs an allocation" (seen in
# the nested shell for the card and the hover label). Both placements on a
# width change go through a BEFORE_REDRAW later instead, which teardown removes:
# the extension in a guarded step of _tearDown (the step itself is counted,
# not just the remove() it calls), the indicator inside _onDestroy. extension.js
# has a second later, the coalesced cover check, pinned by its own row in
# gnome-shell/tests/visibility.test.js. cockpitLayer.js queues no later and
# follows no width: the extension places it, in its own later (0/0/0).
deferred_placement_summary=""
for glue_file in extension.js indicator.js cockpitLayer.js; do
  glue_path="$EXT_DIR/$glue_file"
  deferred_placement_summary+="$glue_file:$(grep -c -F 'Meta.LaterType.BEFORE_REDRAW' "$glue_path" 2>/dev/null)"
  deferred_placement_summary+="/$(grep -c -F 'get_laters().remove(' "$glue_path" 2>/dev/null)"
  deferred_placement_summary+="/$(grep -c -E "connect(Object)?\('notify::width', \(\) => this\._queue" "$glue_path" 2>/dev/null) "
done
teardown_cancels_placement="$(grep -c -F "{name: 'cancel the pending card placement', run: () => this._cancelCardPlacement()}" "$EXTENSION_JS" 2>/dev/null)"
on_destroy_removes_later="$(sed -n '/^    _onDestroy() {/,/^    }/p' "$EXT_DIR/indicator.js" 2>/dev/null | grep -c -F 'get_laters().remove(')"
check "a width change moves the card and the hover label in a BEFORE_REDRAW later, never during allocation" \
  "$deferred_placement_summary| teardown-step=$teardown_cancels_placement on-destroy=$on_destroy_removes_later" \
  "extension.js:2/2/1 indicator.js:1/1/1 cockpitLayer.js:0/0/0 | teardown-step=1 on-destroy=1"

# The top bar asks for a frame only when a graph's columns change by a whole
# device pixel, and only while the indicator is mapped. The arithmetic is
# lib/topbarColumns.js, with its rows in gnome-shell/tests/topbarColumns.test.js;
# the glue runs only inside gnome-shell, so these rows read it. A drawing area's
# queue_repaint() is neither cheap nor lazy, so indicator.js calls it in exactly
# one place, behind the decision that compares columns: one call more, anywhere,
# redraws identical pixels on every tick, as the top bar did before.
REPAINT_CALL_NEEDLE='queue_repaint('
REPAINT_DECISION_DECLARATION='_isRepaintNeeded(topbarGraph)'
# indicator_method_lines <indicator.js path> <declaration>: the method's body,
# from its declaration line to the closing brace at its indent, each line
# trimmed. A missing file or method is no lines, so every count below is 0.
indicator_method_lines() { sed -n "/^    $2 {\$/,/^    }\$/p" "$1" 2>/dev/null | sed 's/^[[:space:]]*//'; }
# count_occurrences <text> <needle>: how many times the text contains the
# needle. Counted in the text, not by grep -c, which counts lines: two on one
# line are two.
count_occurrences() {
  local text="$1" needle="$2" text_without_needle
  text_without_needle="${text//"$needle"/}"
  printf '%s' "$(( (${#text} - ${#text_without_needle}) / ${#needle} ))"
}
# repaint_call_summary <indicator.js path>: how many times the file says
# queue_repaint(, the trimmed line before each one, and how many lines of the
# decision method compare columns (lib/topbarColumns.js isGraphRepaintNeeded).
# An unreadable file is a line of its own.
repaint_call_summary() {
  local indicator_path="$1" indicator_text guard_lines comparison_count
  if [[ ! -r "$indicator_path" ]] || ! indicator_text="$(<"$indicator_path")"; then
    printf 'cannot read %s' "$indicator_path"
    return
  fi
  guard_lines="$(awk -v needle="$REPAINT_CALL_NEEDLE" '
    index($0, needle) { sub(/^[ \t]+/, "", previous_line); guards = guards separator previous_line; separator = "|" }
    { previous_line = $0 }
    END { print guards }' "$indicator_path")"
  comparison_count="$(indicator_method_lines "$indicator_path" "$REPAINT_DECISION_DECLARATION" \
    | grep -c -F 'isGraphRepaintNeeded(')"
  printf 'calls=%s guards=[%s] compares=%s' "$(count_occurrences "$indicator_text" "$REPAINT_CALL_NEEDLE")" \
    "$guard_lines" "$comparison_count"
}
check "indicator.js calls queue_repaint( in one place, behind the column comparison" \
  "$(repaint_call_summary "$EXT_DIR/indicator.js")" \
  "calls=1 guards=[if (this._isRepaintNeeded(topbarGraph))] compares=1"
# The planted twin, on a copy of the extension: the unguarded call the history
# listener made before, put back, is found.
TOPBAR_REPAINT_FIXTURE_DIR="$WIRING_TMP/topbar-repaint-fixture"
cp -R "$EXT_DIR" "$TOPBAR_REPAINT_FIXTURE_DIR" || fatal "cannot copy $EXT_DIR to $TOPBAR_REPAINT_FIXTURE_DIR"
awk '{ print } $0 == "    _onHistoriesChanged() {" { print "        this._cpuGraph.drawingArea.queue_repaint();" }' \
  "$EXT_DIR/indicator.js" >"$TOPBAR_REPAINT_FIXTURE_DIR/indicator.js" \
  || fatal "cannot plant an unguarded repaint in $TOPBAR_REPAINT_FIXTURE_DIR/indicator.js"
check "a planted unguarded queue_repaint( in a copy of indicator.js is found" \
  "$(repaint_call_summary "$TOPBAR_REPAINT_FIXTURE_DIR/indicator.js")" \
  "calls=2 guards=[if (this._isRepaintNeeded(topbarGraph))|_onHistoriesChanged() {] compares=1"
# A repaint skipped while the indicator is unmapped is owed: the decision
# answers false then and leaves the columns last drawn as they are, and
# notify::mapped runs the same comparison again, so a graph whose columns
# changed while it was hidden draws once when it is shown.
MAPPED_HANDLER_CONNECT="this.connect('notify::mapped', () => this._onMappedChanged());"
# mapped_repaint_summary <indicator.js path>: how many lines connect
# notify::mapped to _onMappedChanged, how many lines of that handler ask the
# changed graphs to repaint, and how many lines of the decision skip while
# unmapped.
mapped_repaint_summary() {
  local indicator_path="$1"
  printf 'connected=%s draws-there=%s skips-while-unmapped=%s' \
    "$(grep -c -F "$MAPPED_HANDLER_CONNECT" "$indicator_path" 2>/dev/null)" \
    "$(indicator_method_lines "$indicator_path" '_onMappedChanged()' \
      | grep -c -x -F 'this._queueRepaintsOfChangedGraphs();')" \
    "$(indicator_method_lines "$indicator_path" "$REPAINT_DECISION_DECLARATION" \
      | grep -c -x -F 'if (this._client === null || !this.mapped)')"
}
check "indicator.js connects notify::mapped and draws the owed repaint there" \
  "$(mapped_repaint_summary "$EXT_DIR/indicator.js")" "connected=1 draws-there=1 skips-while-unmapped=1"
# The planted twin, on a copy: a notify::mapped handler that only follows the
# hover label, as it did before, is found.
TOPBAR_MAPPED_FIXTURE_DIR="$WIRING_TMP/topbar-mapped-fixture"
cp -R "$EXT_DIR" "$TOPBAR_MAPPED_FIXTURE_DIR" || fatal "cannot copy $EXT_DIR to $TOPBAR_MAPPED_FIXTURE_DIR"
awk '
  $0 == "    _onMappedChanged() {" { is_inside_handler = 1 }
  is_inside_handler && $0 == "        this._queueRepaintsOfChangedGraphs();" { next }
  $0 == "    }" { is_inside_handler = 0 }
  { print }' "$EXT_DIR/indicator.js" >"$TOPBAR_MAPPED_FIXTURE_DIR/indicator.js" \
  || fatal "cannot plant a handler that does not draw in $TOPBAR_MAPPED_FIXTURE_DIR/indicator.js"
check "a copy of indicator.js whose notify::mapped handler does not draw is found" \
  "$(mapped_repaint_summary "$TOPBAR_MAPPED_FIXTURE_DIR/indicator.js")" \
  "connected=1 draws-there=0 skips-while-unmapped=1"
# St lets a drawing area report its surface size, and hand out its cairo
# context, only inside its repaint handler: anywhere else it logs a CRITICAL and
# the size reads 0, which made the column comparison see a change on every tick.
# So indicator.js reads each exactly once, in _paintGraph, and compares at the
# height its last paint recorded. Counted over the whole file, comments
# included, as the Gio.DBusProxy row does (indicator.js's comments never spell
# either call): a comment only adds to the counts, so it cannot hide a read
# outside the handler.
SURFACE_READ_NEEDLES=('get_surface_size(' 'get_context(')
PAINT_HANDLER_DECLARATION='_paintGraph(topbarGraph)'
# surface_reads_summary <indicator.js path>: for each needle, how many times the
# file says it and how many times _paintGraph's body does. An unreadable file is
# a line of its own.
surface_reads_summary() {
  local indicator_path="$1" indicator_text paint_handler_text needle summary="" separator=""
  if [[ ! -r "$indicator_path" ]] || ! indicator_text="$(<"$indicator_path")"; then
    printf 'cannot read %s' "$indicator_path"
    return
  fi
  paint_handler_text="$(indicator_method_lines "$indicator_path" "$PAINT_HANDLER_DECLARATION")"
  for needle in "${SURFACE_READ_NEEDLES[@]}"; do
    summary+="$separator$needle file=$(count_occurrences "$indicator_text" "$needle")"
    summary+=" repaint=$(count_occurrences "$paint_handler_text" "$needle")"
    separator="; "
  done
  printf '%s' "$summary"
}
check "indicator.js reads the drawing area's surface size and context only inside the repaint handler" \
  "$(surface_reads_summary "$EXT_DIR/indicator.js")" \
  "get_surface_size( file=1 repaint=1; get_context( file=1 repaint=1"
# The planted twin, on a copy: the surface read the decision made at tick time,
# put back, is found.
TOPBAR_SURFACE_FIXTURE_DIR="$WIRING_TMP/topbar-surface-fixture"
cp -R "$EXT_DIR" "$TOPBAR_SURFACE_FIXTURE_DIR" || fatal "cannot copy $EXT_DIR to $TOPBAR_SURFACE_FIXTURE_DIR"
awk '{ print } $0 == "    _isRepaintNeeded(topbarGraph) {" {
  print "        const [, heightPx] = topbarGraph.drawingArea.get_surface_size();" }' \
  "$EXT_DIR/indicator.js" >"$TOPBAR_SURFACE_FIXTURE_DIR/indicator.js" \
  || fatal "cannot plant a surface read in $TOPBAR_SURFACE_FIXTURE_DIR/indicator.js"
check "a planted get_surface_size( outside the repaint handler in a copy of indicator.js is found" \
  "$(surface_reads_summary "$TOPBAR_SURFACE_FIXTURE_DIR/indicator.js")" \
  "get_surface_size( file=2 repaint=1; get_context( file=1 repaint=1"

# The desktop card's cover check runs on the Samples and the window signals,
# with no timer while Samples flow. extension.js's one timer is the fallback
# that checks a covered card while the service is silent (when it runs is
# lib/visibility.js coverFallbackTimerChange, its wiring pinned in
# gnome-shell/tests/visibility.test.js): every timeout the file adds, of any
# kind, is counted in the text, and the one there is must be of
# COVER_FALLBACK_INTERVAL_SECONDS.
FALLBACK_TIMEOUT_CALL='GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, COVER_FALLBACK_INTERVAL_SECONDS,'
# extension_timeouts_summary <extension.js path>: how many times the file says
# timeout_add (any kind), setTimeout( or setInterval(, and how many times it
# adds the fallback timeout. An unreadable file is a line of its own.
extension_timeouts_summary() {
  local extension_path="$1" extension_text timeout_count
  if [[ ! -r "$extension_path" ]] || ! extension_text="$(<"$extension_path")"; then
    printf 'cannot read %s' "$extension_path"
    return
  fi
  timeout_count=$(( $(count_occurrences "$extension_text" 'timeout_add') \
    + $(count_occurrences "$extension_text" 'setTimeout(') + $(count_occurrences "$extension_text" 'setInterval(') ))
  printf 'timeouts=%s fallback=%s' "$timeout_count" "$(count_occurrences "$extension_text" "$FALLBACK_TIMEOUT_CALL")"
}
check "extension.js's one timeout_add_seconds uses COVER_FALLBACK_INTERVAL_SECONDS" \
  "$(extension_timeouts_summary "$EXTENSION_JS")" "timeouts=1 fallback=1"
# Teardown removes what the covered check adds while the card is covered, each
# in a guarded step of its own (runEveryStep): the fallback timeout, and every
# covering window's position-changed, size-changed, workspace-changed and
# unmanaged.
FALLBACK_TEARDOWN_STEP="{name: 'remove the cover fallback timeout', run: () => this._removeCoverFallbackTimer()},"
COVERING_WINDOWS_TEARDOWN_STEP="{name: 'disconnect from the covering windows', run: () => "
COVERING_WINDOWS_TEARDOWN_STEP+="this._disconnectCoveringWindows()},"
fallback_teardown_steps="$(grep -c -x -F "$FALLBACK_TEARDOWN_STEP" <<<"$teardown_lines")"
covering_windows_teardown_steps="$(grep -c -x -F "$COVERING_WINDOWS_TEARDOWN_STEP" <<<"$teardown_lines")"
check "_tearDown removes the fallback timeout and disconnects the covering windows" \
  "fallback=$fallback_teardown_steps covering-windows=$covering_windows_teardown_steps" "fallback=1 covering-windows=1"

# metadata.json, parsed as JSON by gjs (never grepped). Each field is printed
# on its own prefixed line, so an unreadable or malformed file prints none and
# every row below fails rather than passes.
METADATA_PATH="$EXT_DIR/metadata.json"
# shellcheck disable=SC2016  # JavaScript source: $ and backticks are gjs's, not bash's.
READ_METADATA_JS='
const [metadataPath] = ARGV;
const [, metadataBytes] = imports.gi.GLib.file_get_contents(metadataPath);
const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
print(`uuid=${metadata.uuid}`);
print(`shell-version=${JSON.stringify(metadata["shell-version"])}`);
print(`session-modes=${Object.hasOwn(metadata, "session-modes") ? "present" : "absent"}`);
'
metadata_output="$(timeout "$GLUE_PARSE_TIMEOUT_SECONDS" gjs -c "$READ_METADATA_JS" "$METADATA_PATH" 2>&1)"
metadata_uuid=""; metadata_shell_version=""; metadata_session_modes=""
while IFS= read -r metadata_line; do
  case "$metadata_line" in
    uuid=*)          metadata_uuid="${metadata_line#uuid=}" ;;
    shell-version=*) metadata_shell_version="${metadata_line#shell-version=}" ;;
    session-modes=*) metadata_session_modes="${metadata_line#session-modes=}" ;;
  esac
done <<<"$metadata_output"
[[ -n "$metadata_uuid" ]] || printf '    (gjs read of %s said: %s)\n' "$METADATA_PATH" "$metadata_output"
check "metadata.json: uuid equals the directory name" "$metadata_uuid" "$(basename "$EXT_DIR")"
check 'metadata.json: shell-version is exactly ["50"]' "$metadata_shell_version" '["50"]'
check "metadata.json: no session-modes key, so the lock screen disables it" "$metadata_session_modes" "absent"

printf '\nresource-pulse-module-closure.sh (which modules each side runs)\n'
# The two stale-code checks (the status report's ⚠ lines and the refresh step's
# try-restart) follow each side's static import closure: the shell side is
# extension.js and what it imports, the service side service/cockpit.js and what
# it imports. The sampler is no side: it is a compiled program and runs no
# module of the extension. The helper is pure bash; these rows run it on the
# real tree and on fixtures, and a shape it does not understand must be exit 2
# with nothing on stdout, never a partial closure that would skip a check.
CLOSURE_SCRIPT="$REPO_ROOT/scripts/resource-pulse-module-closure.sh"
# sorted_closure <extension dir> <entry module>: the closure, sorted, on one line,
# then "exit=<n>".
sorted_closure() {
  local closure_output closure_exit
  closure_output="$(bash "$CLOSURE_SCRIPT" "$1" "$2" 2>/dev/null)"
  closure_exit=$?
  printf '%sexit=%s' "$(LC_ALL=C sort <<<"$closure_output" | tr '\n' ' ')" "$closure_exit"
}
# Read from the import lines of today's tree, by hand: the shell side's
# fifty-two modules and the cockpit service's twenty-one (below), five of them
# (cockpitProtocol, constants, errorLog, jsonFields, teardown) on both. The
# shell side reaches cockpitCards.js and its three lib modules (cockpitFormat,
# cockpitProtocol, cockpitStaleness) through indicator.js (the Resources helpers
# and the dropdown's sessions card) and through the layer. The shell's nine
# cockpit modules are its client (cockpitClient.js), its layer (cockpitLayer.js),
# cockpitTooltip.js, the pacing and data-card drawing (cockpitSourceDrawing.js),
# the DisplayConfig reader (displayConfig.js), and lib/'s cockpitGrid,
# cockpitInteraction, cockpitMonitor and cockpitWiring. extension.js reaches all
# nine; indicator.js imports three of them itself, for the dropdown's sessions
# card (cockpitSourceDrawing.js, cockpitTooltip.js and lib/cockpitWiring.js),
# with lib/teardown.js, one of the five both sides share. indicator.js also
# reaches lib/cockpitCaptions.js, and through it lib/mountFaults.js, for the
# captions it judges from the cockpit client. The mark reaches lib/markFace.js,
# and the caption line wrappedRowsLayout.js and through it lib/wrappedRows.js.
EXPECTED_SHELL_CLOSURE='card.js cockpitCards.js cockpitClient.js cockpitLayer.js cockpitSourceDrawing.js '
EXPECTED_SHELL_CLOSURE+='cockpitTooltip.js compactCardLayout.js displayConfig.js '
EXPECTED_SHELL_CLOSURE+='extension.js graph.js indicator.js lib/agentsTrack.js lib/cardRepaint.js lib/cockpitCaptions.js '
EXPECTED_SHELL_CLOSURE+='lib/cockpitFormat.js '
EXPECTED_SHELL_CLOSURE+='lib/cockpitGrid.js lib/cockpitInteraction.js lib/cockpitMonitor.js lib/cockpitProtocol.js '
EXPECTED_SHELL_CLOSURE+='lib/cockpitStaleness.js lib/cockpitWiring.js lib/compactCardGeometry.js lib/constants.js '
EXPECTED_SHELL_CLOSURE+='lib/drawingConstants.js lib/errorLog.js lib/format.js lib/history.js lib/jsonFields.js '
EXPECTED_SHELL_CLOSURE+='lib/layout.js lib/machineCaptions.js lib/machineConditions.js lib/markFace.js '
EXPECTED_SHELL_CLOSURE+='lib/missedTicks.js '
EXPECTED_SHELL_CLOSURE+='lib/mountFaults.js '
EXPECTED_SHELL_CLOSURE+='lib/pressure.js lib/pressureHistories.js lib/pressureStrip.js lib/protocol.js '
EXPECTED_SHELL_CLOSURE+='lib/pulseSnapshots.js lib/sessionOrder.js lib/surfaceLuminance.js lib/teardown.js '
EXPECTED_SHELL_CLOSURE+='lib/topbarColumns.js lib/visibility.js lib/wiring.js lib/wrappedRows.js '
EXPECTED_SHELL_CLOSURE+='machineCaptionsRow.js machineMark.js '
EXPECTED_SHELL_CLOSURE+='pulseClient.js pulseServiceStart.js serviceLink.js traceGraph.js wrappedRowsLayout.js '
check "closure: on the real tree, extension.js gives exactly the modules it imports, directly or not" \
  "$(sorted_closure "$EXT_DIR" extension.js)" "${EXPECTED_SHELL_CLOSURE}exit=0"
# resource-pulse-cockpit.service's closure decides its own restarts: its entry, its
# D-Bus face (service/cockpitDbusService.js), its sources (service/cockpitSources.js,
# service/herdrSocket.js and service/sources/'s mounts, network, sessions and
# sourceIo), the file helpers (service/fileIo.js), and lib/'s cockpitConfig,
# mounts, nameGuard, network, processTree, sessions and sessionStateHistory, with the five it shares
# with the shell. A module that joins or leaves it changes what restarts the
# cockpit, so it is pinned whole, like the shell's.
EXPECTED_COCKPIT_CLOSURE='lib/cockpitConfig.js lib/cockpitProtocol.js lib/constants.js lib/errorLog.js '
EXPECTED_COCKPIT_CLOSURE+='lib/jsonFields.js lib/mounts.js lib/nameGuard.js lib/network.js lib/processTree.js '
EXPECTED_COCKPIT_CLOSURE+='lib/sessionStateHistory.js lib/sessions.js lib/teardown.js service/cockpit.js '
EXPECTED_COCKPIT_CLOSURE+='service/cockpitDbusService.js '
EXPECTED_COCKPIT_CLOSURE+='service/cockpitSources.js service/fileIo.js service/herdrSocket.js '
EXPECTED_COCKPIT_CLOSURE+='service/sources/mounts.js service/sources/network.js service/sources/sessions.js '
EXPECTED_COCKPIT_CLOSURE+='service/sources/sourceIo.js '
check "closure: on the real tree, service/cockpit.js gives exactly the modules it imports, directly or not" \
  "$(sorted_closure "$EXT_DIR" service/cockpit.js)" "${EXPECTED_COCKPIT_CLOSURE}exit=0"

# A fixture of every shape it follows, and of what it must not: a JSDoc type
# and a comment naming import('./x.js') are no imports; a multi-line import
# (with a comment inside), a side-effect import, a re-export, and a dynamic
# import of a string literal are; import.meta is not; gi:// and resource:///
# name no file of the extension.
CLOSURE_FIXTURE_DIR="$WIRING_TMP/closure-fixture"
mkdir -p "$CLOSURE_FIXTURE_DIR/lib" || fatal "cannot create $CLOSURE_FIXTURE_DIR"
printf '%s\n' \
  "// A comment naming import('./commented.js') is no import." \
  '/**' \
  " * @param {import('./jsdoc-only.js').Thing} thing - A JSDoc type, no import." \
  ' */' \
  "import Gio from 'gi://Gio';" \
  "import * as Main from 'resource:///org/gnome/shell/ui/main.js';" \
  'import {' \
  '    first,' \
  '    // A comment inside the list.' \
  '    second,' \
  "} from './lib/multi-line.js';" \
  "import './side-effect.js';" \
  'export {third} from "./re-exported.js";' \
  "const lazyModule = await import('./lazy.js');" \
  'const moduleUrl = import.meta.url;' >"$CLOSURE_FIXTURE_DIR/entry.js"
printf '%s\n' "import {shared} from '../shared.js';" >"$CLOSURE_FIXTURE_DIR/lib/multi-line.js"
printf '%s\n' "import {shared} from './shared.js';" >"$CLOSURE_FIXTURE_DIR/re-exported.js"
for closure_fixture_module in side-effect.js lazy.js shared.js jsdoc-only.js commented.js; do
  : >"$CLOSURE_FIXTURE_DIR/$closure_fixture_module"
done
check "closure: follows multi-line, side-effect, re-exported and literal dynamic imports; never a JSDoc type, a comment, import.meta or gi://" \
  "$(sorted_closure "$CLOSURE_FIXTURE_DIR" entry.js)" \
  "entry.js lazy.js lib/multi-line.js re-exported.js shared.js side-effect.js exit=0"

# An import written after block comments that close on the same line is a real
# import, and the closure must name its file (a change to it restarts the
# service that loads it); a line that is all comment, closed or not, hides what
# it says, and so does a block comment left open on its line.
CLOSURE_BLOCK_FIXTURE_DIR="$WIRING_TMP/closure-block-fixture"
rm -rf "$CLOSURE_BLOCK_FIXTURE_DIR"
mkdir -p "$CLOSURE_BLOCK_FIXTURE_DIR" || fatal "cannot create $CLOSURE_BLOCK_FIXTURE_DIR"
printf '%s\n' \
  "/* note */ import {after_one} from './after-one.js';" \
  "/* first */ /* second */ import {after_two} from './after-two.js';" \
  "/* import {all_comment} from './all-comment.js'; */" \
  "/* a */ // import {x} from './line-hidden.js';" >"$CLOSURE_BLOCK_FIXTURE_DIR/entry.js"
for closure_block_module in after-one.js after-two.js all-comment.js line-hidden.js; do
  : >"$CLOSURE_BLOCK_FIXTURE_DIR/$closure_block_module"
done
check "closure: an import after a block comment closed on its own line is followed" \
  "$(sorted_closure "$CLOSURE_BLOCK_FIXTURE_DIR" entry.js)" \
  "after-one.js after-two.js entry.js exit=0"
CLOSURE_OPEN_COMMENT_FIXTURE_DIR="$WIRING_TMP/closure-open-comment-fixture"
rm -rf "$CLOSURE_OPEN_COMMENT_FIXTURE_DIR"
mkdir -p "$CLOSURE_OPEN_COMMENT_FIXTURE_DIR" || fatal "cannot create $CLOSURE_OPEN_COMMENT_FIXTURE_DIR"
printf '%s\n' \
  "/* import {hidden} from './hidden.js'; this comment closes on a later line" \
  ' */' \
  "/* closed */ /* import {also_hidden} from './also-hidden.js'; still open" \
  ' */' >"$CLOSURE_OPEN_COMMENT_FIXTURE_DIR/entry.js"
for closure_open_comment_module in hidden.js also-hidden.js; do
  : >"$CLOSURE_OPEN_COMMENT_FIXTURE_DIR/$closure_open_comment_module"
done
check "closure: a block comment that does not close on its line still hides the line" \
  "$(sorted_closure "$CLOSURE_OPEN_COMMENT_FIXTURE_DIR" entry.js)" \
  "entry.js exit=0"

# Each shape it cannot follow: exit 2, nothing on stdout, and a line on stderr
# naming the module and its line.
# closure_refusal <module source>: "<exit>/<stdout lines>/<stderr names entry.js:line>".
closure_refusal() {
  local refusal_dir="$WIRING_TMP/closure-refusal" refusal_stdout refusal_stderr_path refusal_exit
  rm -rf "$refusal_dir"
  mkdir -p "$refusal_dir" || fatal "cannot create $refusal_dir"
  printf '%s\n' "$1" >"$refusal_dir/entry.js"
  : >"$refusal_dir/present.js"
  refusal_stderr_path="$refusal_dir/stderr"
  refusal_stdout="$(bash "$CLOSURE_SCRIPT" "$refusal_dir" entry.js 2>"$refusal_stderr_path")"
  refusal_exit=$?
  printf '%s/%s/%s' "$refusal_exit" "$(grep -c . <<<"$refusal_stdout")" \
    "$(grep -c -E '^resource-pulse-module-closure: entry\.js:[0-9]+: ' "$refusal_stderr_path")"
}
closure_refusals="dynamic=$(closure_refusal 'const loaded = await import(modulePath);')"
closure_refusals+=" unterminated=$(closure_refusal "import {present} from './present.js'")"
closure_refusals+=" indented=$(closure_refusal "    import {present} from './present.js';")"
closure_refusals+=" missing=$(closure_refusal "import {missing} from './missing.js';")"
# '../present.js' climbs out of the extension directory, though present.js exists
# inside it: a resolver that let .. pass the top would find it and say exit 0.
closure_refusals+=" outside=$(closure_refusal "import {present} from '../present.js';")"
check "closure: a dynamic import of a computed specifier, an import with no ;, one not starting its line, and one naming no file in the extension are each exit 2 with nothing on stdout" \
  "$closure_refusals" "dynamic=2/0/1 unterminated=2/0/1 indented=2/0/1 missing=2/0/1 outside=2/0/1"

printf '\nevery test'"'"'s bus connection is opened by privateBus.js\n'
# A Gio.DBusConnection that a test creates itself and drops is the deadlock an earlier fix removed: gjs's collector
# disposes it, taking GLib's message_bus_lock under gjs's toggle-queue lock, while GDBus's worker takes the two in the
# other order (privateBus.js's openedConnections says how). privateBus.js opens every connection the rows use and keeps
# each one reachable; the nested harness (nested/) runs in a nested shell of its own and holds its connections for its
# process's life. This search is a papercut guard, not a proof: it matches the constructors (DBusConnection.new, and
# new_for_address under any alias, each with its _sync and _finish forms, and `new Gio.DBusConnection({…})` under any
# alias of Gio); Gio.bus_get and Gio.DBus.session are not
# matched and need not be, since GLib holds that singleton itself, so JavaScript is never its only holder.
BUS_CONNECTION_TESTS_DIR="$REPO_ROOT/gnome-shell/tests"
BUS_CONNECTION_HELPER_NAME=privateBus.js
BUS_CONNECTION_EXEMPT_DIR_NAME=nested
DIRECT_BUS_CONNECTION_PATTERN='DBusConnection\.new|new_for_address|new[[:space:]]+([A-Za-z_]+\.)?DBusConnection[[:space:]]*\('
# direct_bus_connections <tests dir>: every line of a .js file under <tests dir>, at any depth, that creates a
# Gio.DBusConnection itself, as <path>:<line>:<text> with the path relative to <tests dir>, except in privateBus.js and
# under nested/. Exit 0 when there is none and 1 when there is one; exit 2 and a "could not run" line when it cannot
# say: no such directory, rg failing, or a search that does not find privateBus.js's own connection (the pattern or
# the tree it searched has drifted, and a search that sees nothing must not pass).
direct_bus_connections() {
  local tests_dir="$1" search_output search_exit offending_lines
  [[ -d "$tests_dir" ]] || { printf 'could not run: no directory %s\n' "$tests_dir"; return 2; }
  search_output="$(cd "$tests_dir" && rg --no-heading --with-filename --line-number --glob '*.js' \
    -e "$DIRECT_BUS_CONNECTION_PATTERN" -- .)"
  search_exit=$?
  (( search_exit <= 1 )) || { printf 'could not run: rg exited %s in %s\n' "$search_exit" "$tests_dir"; return 2; }
  if [[ "$search_output" != *"./$BUS_CONNECTION_HELPER_NAME:"* ]]; then
    printf 'could not run: the search found no connection in %s/%s\n' "$tests_dir" "$BUS_CONNECTION_HELPER_NAME"
    return 2
  fi
  offending_lines="$(printf '%s\n' "$search_output" | awk \
    -v helper_prefix="./$BUS_CONNECTION_HELPER_NAME:" -v exempt_prefix="./$BUS_CONNECTION_EXEMPT_DIR_NAME/" '
      index($0, helper_prefix) == 1 || index($0, exempt_prefix) == 1 { next }
      { print substr($0, 3) }')"
  [[ -z "$offending_lines" ]] && return 0
  printf '%s\n' "$offending_lines"
  return 1
}
bus_connection_output="$(direct_bus_connections "$BUS_CONNECTION_TESTS_DIR")"
check "no test under gnome-shell/tests/ creates a bus connection itself: only privateBus.js and nested/ may (exit/lines)" \
  "$?/$bus_connection_output" "0/"
# The same search can fail: a copy of the tests holding one planted file that opens a connection itself is exit 1
# naming that file and line; and a directory that is not there is exit 2, never a search that found nothing.
BUS_CONNECTION_PLANTED_COPY="$WIRING_TMP/bus-connection-guard-tests"
cp -R "$BUS_CONNECTION_TESTS_DIR" "$BUS_CONNECTION_PLANTED_COPY" || fatal "cannot copy $BUS_CONNECTION_TESTS_DIR"
printf '%s\n' "import Gio from 'gi://Gio';" \
  "const connection = Gio.DBusConnection.new_for_address_sync(address, flags, null, null);" \
  >"$BUS_CONNECTION_PLANTED_COPY/planted.test.js" || fatal "cannot plant a file in $BUS_CONNECTION_PLANTED_COPY"
planted_output="$(direct_bus_connections "$BUS_CONNECTION_PLANTED_COPY")"
bus_connection_guard_summary="planted=$?/$(cut -d: -f1,2 <<<"$planted_output")"
direct_bus_connections "$WIRING_TMP/no-such-tests-dir" >/dev/null
bus_connection_guard_summary+=" missing-dir=$?"
check "the search fails on a copy with one planted connection, naming its file and line, and a missing directory is could not run" \
  "$bus_connection_guard_summary" "planted=1/planted.test.js:2 missing-dir=2"
# The constructor form is matched too: a second planted file that builds one with `new Gio.DBusConnection({…})`, and
# one that builds it through an alias of Gio, are each named with their line, the first planted file's line as well.
printf '%s\n' "import Gio from 'gi://Gio';" \
  "const connection = new Gio.DBusConnection({address, flags: Gio.DBusConnectionFlags.NONE});" \
  >"$BUS_CONNECTION_PLANTED_COPY/planted-constructor.test.js" || fatal "cannot plant a file in $BUS_CONNECTION_PLANTED_COPY"
printf '%s\n' "import GioAlias from 'gi://Gio';" \
  "const connection = new GioAlias.DBusConnection ({address});" \
  >"$BUS_CONNECTION_PLANTED_COPY/planted-alias.test.js" || fatal "cannot plant a file in $BUS_CONNECTION_PLANTED_COPY"
planted_output="$(direct_bus_connections "$BUS_CONNECTION_PLANTED_COPY")"
planted_summary="planted=$?/$(cut -d: -f1,2 <<<"$planted_output" | sort | tr '\n' ' ')"
check "the search names a planted \`new Gio.DBusConnection({…})\` and one through an alias of Gio, by file and line" \
  "$planted_summary" "planted=1/planted-alias.test.js:2 planted-constructor.test.js:2 planted.test.js:2 "

printf '\nthe stat-only paths (named nowhere under service/ or lib/ but their list)\n'
# The cockpit service may stat these files, never open them (a "stat, never
# open" list): its file reader (service/sources/sourceIo.js) refuses a
# path holding a fragment of lib/constants.js's STAT_ONLY_PATH_FRAGMENTS, or a
# dotfile whose name holds .local (STAT_ONLY_LOCAL_DOTFILE_PATTERN). So no file
# under service/ or lib/ may name one anywhere else, in a path it reads or one
# it builds; the list itself is the one place that does, and only its own lines
# are passed over. The names are fixed here, so the row does not lean on the
# list it guards; a local dotfile has no fixed name, so its shape is searched
# for: a dot, a name of any characters (a letter, digit, underscore, hyphen, an @ or an inner dot), and .local.
# shellcheck disable=SC2088  # The ~ is text the row searches for, never a path to expand.
STAT_ONLY_NAMES=('.credentials' '.aws/' '~/.ssh/')
STAT_ONLY_LOCAL_DOTFILE_ERE='\.[^/[:space:]]+\.local'
STAT_ONLY_LIST_FIRST_LINE='export const STAT_ONLY_PATH_FRAGMENTS = ['
STAT_ONLY_LIST_LAST_LINE='];'
STAT_ONLY_LIST_MODULE='lib/constants.js'
# stat_only_mentions <extension dir>: "named-in=[<file> ...] list=<state>": the
# files under service/ and lib/ (relative, sorted) naming one of STAT_ONLY_NAMES,
# or a name of STAT_ONLY_LOCAL_DOTFILE_ERE's shape, outside the list, and whether lib/constants.js held the list, closed. A tree
# that cannot be listed, or holds no file, says so instead of naming none.
stat_only_mentions() {
  local extension_dir="$1" listing_path="$WIRING_TMP/stat-only-listing" module_path relative_path
  local module_line stat_only_name list_state="absent" inside_list named_in=""
  local -a module_paths=()
  find "$extension_dir/service" "$extension_dir/lib" -type f -print0 >"$listing_path" 2>/dev/null \
    || { printf 'cannot list service/ and lib/ under %s' "$extension_dir"; return; }
  mapfile -d '' module_paths < <(LC_ALL=C sort -z "$listing_path")
  (( ${#module_paths[@]} > 0 )) || { printf 'no file under service/ or lib/ in %s' "$extension_dir"; return; }
  for module_path in "${module_paths[@]}"; do
    relative_path="${module_path#"$extension_dir"/}"
    inside_list=false
    while IFS= read -r module_line || [[ -n "$module_line" ]]; do
      if [[ "$relative_path" == "$STAT_ONLY_LIST_MODULE" ]]; then
        if [[ "$module_line" == "$STAT_ONLY_LIST_FIRST_LINE" ]]; then
          inside_list=true; list_state="unclosed"; continue
        fi
        if [[ "$inside_list" == true ]]; then
          [[ "$module_line" == "$STAT_ONLY_LIST_LAST_LINE" ]] && { inside_list=false; list_state="closed"; }
          continue
        fi
      fi
      for stat_only_name in "${STAT_ONLY_NAMES[@]}"; do
        if [[ "$module_line" == *"$stat_only_name"* ]]; then
          named_in+="$relative_path "
          continue 3
        fi
      done
      if [[ "$module_line" =~ $STAT_ONLY_LOCAL_DOTFILE_ERE ]]; then
        named_in+="$relative_path "
        continue 2
      fi
    done <"$module_path"
  done
  printf 'named-in=[%s] list=%s' "${named_in% }" "$list_state"
}
# The fixture: the real lib/constants.js with one name planted after its list,
# a source that load_contents a planted path, another that builds a local
# dotfile's path, and a clean module beside it.
STAT_ONLY_FIXTURE_DIR="$WIRING_TMP/stat-only-fixture"
mkdir -p "$STAT_ONLY_FIXTURE_DIR/lib" "$STAT_ONLY_FIXTURE_DIR/service/sources" \
  || fatal "cannot create $STAT_ONLY_FIXTURE_DIR"
cp "$EXT_DIR/$STAT_ONLY_LIST_MODULE" "$STAT_ONLY_FIXTURE_DIR/$STAT_ONLY_LIST_MODULE" \
  || fatal "cannot copy $STAT_ONLY_LIST_MODULE into $STAT_ONLY_FIXTURE_DIR"
printf '%s\n' "export const PLANTED_CONFIG_PATH = '${STAT_ONLY_NAMES[2]}config';" \
  >>"$STAT_ONLY_FIXTURE_DIR/$STAT_ONLY_LIST_MODULE"
printf '%s\n' "import Gio from 'gi://Gio';" "import GLib from 'gi://GLib';" \
  "const plantedPath = GLib.build_filenamev([GLib.get_home_dir(), '${STAT_ONLY_NAMES[1]}config']);" \
  "const [, plantedBytes] = Gio.File.new_for_path(plantedPath).load_contents(null);" \
  >"$STAT_ONLY_FIXTURE_DIR/service/sources/planted.js"
printf '%s\n' "import GLib from 'gi://GLib';" \
  "const plantedLocalPath = GLib.build_filenamev([GLib.get_home_dir(), '.Planted_a-1@b.local']);" \
  >"$STAT_ONLY_FIXTURE_DIR/service/sources/plantedLocal.js"
printf '%s\n' "export const CLEAN_INTERVAL_SECONDS = 10;" >"$STAT_ONLY_FIXTURE_DIR/service/clean.js"
check "no file under service/ or lib/ names a stat-only path outside lib/constants.js's list; a planted load_contents of one, a local dotfile's path, or a name after the list, is found" \
  "real: $(stat_only_mentions "$EXT_DIR") fixture: $(stat_only_mentions "$STAT_ONLY_FIXTURE_DIR")" \
  "real: named-in=[] list=closed fixture: named-in=[lib/constants.js service/sources/planted.js service/sources/plantedLocal.js] list=closed"

EXPECTED_ROWS=65

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
