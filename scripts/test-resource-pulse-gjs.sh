#!/usr/bin/env bash
#
# scripts/test-resource-pulse-gjs.sh
# ==================================
#
# State table for the plain-gjs unit tests of the Resource Pulse GNOME Shell
# extension (gnome-shell/extensions/resource-pulse@zvibaratz.github.io). The rows live in
# test files under gnome-shell/tests/, imported by a static list in run.js;
# this table runs them, echoes their output and folds the ONE anchored
# `JS-TALLY pass=<n> fail=<n>` line into its own PASS/FAIL.
#
# The rows run only in a process started with no reachable bus, a config home
# that cannot exist and one fixed time zone (gnome-shell/tests/liveSessionBarrier.js:
# run.js started any other way runs itself again behind them), so a fake a row
# leaves out never reaches the live session.
#
# "Could not run" is exit 2, never a pass: a missing gjs, an unreadable run.js,
# or a missing tally line (an import error prints none) is fatal. A gjs exit
# that is not 0 with no failing row is a ✗ of its own. The table asserts its
# own row total. Its shared helpers are scripts/resource-pulse-table-lib.sh's.
#
# Requires: bash, gjs, and for the card-width row the Pango typelibs
# (gir1.2-pango-1.0) and the card's font, Ubuntu Sans (fonts-ubuntu): without
# them that row fails, never passes. No network.
#
# Usage: scripts/test-resource-pulse-gjs.sh
#   The rows always test the tree: RESOURCE_PULSE_EXT_DIR does not apply here.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
RUNNER="$REPO_ROOT/gnome-shell/tests/run.js"
TABLE_LIB="$HERE/resource-pulse-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-table-lib.sh
source "$TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$TABLE_LIB" >&2; exit 2; }
start_table

[[ -r "$RUNNER" ]] || fatal "cannot read $RUNNER"
require_tools gjs

JS_OUTPUT="$(gjs -m "$RUNNER" 2>&1)"
JS_EXIT=$?
printf '%s\n' "$JS_OUTPUT"
fold_js_tally "$JS_OUTPUT" "$JS_EXIT" gjs

EXPECTED_ROWS=886

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
