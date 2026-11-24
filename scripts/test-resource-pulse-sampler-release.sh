#!/usr/bin/env bash
#
# scripts/test-resource-pulse-sampler-release.sh
# ===============================================
#
# State table for the compiled Resource Pulse sampler's release program, as the build step installs it (LTO, strip,
# panic = unwind): built with the real cargo into the checkout's build directory, run with --print over a fixture root,
# and its source hash the debug program's; and a row holding the build rows' stub cargo to the real one's
# `cargo --version` shape.
# Its row helpers, the barrier and the build of the debug program are scripts/resource-pulse-sampler-table-lib.sh's.
# Nothing here touches the live session bus: every program run is behind BUS_BARRIER.
#
# "Could not run" is exit 2, never a pass: a missing cargo, python3, sed, head or timeout, or a debug program that could
# not be built, is fatal; a release build that fails is a failed row. The table asserts its own row total.
#
# Requires: bash, cargo, python3, sed, head and timeout. Needs the network the first time (crates.io). Refuses to run as
# root (exit 2).
#
# Usage: scripts/test-resource-pulse-sampler-release.sh
#   CARGO_TARGET_DIR, CARGO_BUILD_JOBS, RUST_TEST_THREADS   as for scripts/test-resource-pulse-sampler.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
SAMPLER_TABLE_LIB="$HERE/resource-pulse-sampler-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-sampler-table-lib.sh
source "$SAMPLER_TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$SAMPLER_TABLE_LIB" >&2; exit 2; }
start_sampler_table
require_tools cargo python3 sed head timeout

build_sampler_program

printf '\nthe release program, as the build step installs it (LTO, strip, panic = unwind)\n'
RELEASE_PROGRAM="$CARGO_TARGET_DIR/release/resource-pulse-sampler"
if off_bus cargo build --release --locked --manifest-path "$MANIFEST_PATH" >"$WORK_DIR/release-build.log" 2>&1; then
  ok "cargo build --release --locked builds the program"
else
  tail -15 "$WORK_DIR/release-build.log"
  bad "cargo build --release --locked failed"
fi
RELEASE_SAMPLE_COUNT=3
RELEASE_SAMPLES="$(off_bus timeout "$PRIVATE_BUS_TIMEOUT_SECONDS" "$RELEASE_PROGRAM" --print --fs-root "$PROGRAM_FIXTURE_ROOT" --tick-interval-ms 50 | head -n "$RELEASE_SAMPLE_COUNT")"
check "the release program's --print over a fixture root gives $RELEASE_SAMPLE_COUNT Samples, each a JSON object" \
  "$(printf '%s\n' "$RELEASE_SAMPLES" | python3 -I -c 'import json, sys
parsed = [json.loads(line) for line in sys.stdin if line.strip()]
print(sum(1 for sample in parsed if isinstance(sample, dict)))' 2>&1)" "$RELEASE_SAMPLE_COUNT"
check "the release program's --source-hash is the debug program's: the hash survives LTO and strip" \
  "$(off_bus "$RELEASE_PROGRAM" --source-hash)" "$PROGRAM_SOURCE_HASH"

printf '\nthe stub cargo is the real one'"'"'s shape\n'
REAL_CARGO_VERSION_LINE="$(cargo --version)"
STUB_CARGO_VERSION_LINE="$(cargo_version_line_for "$STABLE_CARGO_VERSION")"
# shape_of_cargo_version_line turns the version, the commit hash and the date into placeholders, so the two lines compare by shape.
shape_of_cargo_version_line() { sed -E 's/^cargo [0-9]+\.[0-9]+\.[0-9]+/cargo VERSION/; s/\([0-9a-f]+ [0-9]{4}-[0-9]{2}-[0-9]{2}\)/(COMMIT DATE)/' <<<"$1"; }
check "the stub's 'cargo --version' line has the shape of the real cargo's: cargo X.Y.Z (commit date)" \
  "$(shape_of_cargo_version_line "$STUB_CARGO_VERSION_LINE")" "$(shape_of_cargo_version_line "$REAL_CARGO_VERSION_LINE")"

# 3 rows of the release program (its build, its Samples, its source hash) + 1 of the stub's shape
# = 4.
EXPECTED_ROWS=4

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
