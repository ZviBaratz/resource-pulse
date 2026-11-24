#!/usr/bin/env bash
#
# scripts/test-resource-pulse-sampler-build.sh
# =============================================
#
# State table for the compiled Resource Pulse sampler's build and install step (scripts/resource-pulse-sampler-build.sh),
# against a stub cargo, each row in a home, a PATH, a cache directory and a crate of its own: --installed-path
# (absolute, trailing slashes dropped, a relative HOME refused), two modes refused, no cargo, an old one, a failed
# build, the build's arguments, the rename (a reader on the final path during repeated installs), that a second run
# with nothing changed renames nothing, --check's three answers, that a build which left a program built from other
# sources (or one that does not answer) installs nothing, that a copy of the script without its background jobs file
# (scripts/resource-pulse-background-jobs.sh) builds nothing and cannot tell, and that a signal (SIGINT or SIGQUIT to
# its group as a terminal sends them, SIGTERM to it alone, during the build or a question to a program) ends the build
# and installs nothing: the signal rows run the traps of that file, as the script sources it. Its option
# --build-limits-module (the job cap's file; none is CARGO_BUILD_JOBS or 2), refused twice or empty, and a relative path
# made absolute. Its row helpers, the
# barrier, the build of the debug program (the --check rows install it) and the build rows are
# scripts/resource-pulse-sampler-table-lib.sh's; what a run said and what it installed (script_verdict,
# installed_state) are its own, since only its rows read them. Nothing here builds into, installs into or reads the
# host's home. Nothing touches the live session bus: the script runs behind
# BUS_BARRIER, which it hands on to the programs it asks for --source-hash.
#
# "Could not run" is exit 2, never a pass: a missing cargo, setsid, timeout, rg, awk, sed, sha256sum, cmp, zsh, stat,
# head or ln, a build script that cannot be read, a row directory that cannot be made, or a program that could
# not be built, is fatal. The table asserts its own row total.
#
# Requires: bash, cargo, setsid and timeout (util-linux, coreutils), rg, awk, sed, sha256sum, cmp, zsh, stat, head and
# ln. Needs the network the first time (crates.io). Refuses to run as root (exit 2): root ignores the directory
# permissions some rows deny.
#
# Usage: scripts/test-resource-pulse-sampler-build.sh
#   CARGO_TARGET_DIR, CARGO_BUILD_JOBS, RUST_TEST_THREADS   as for scripts/test-resource-pulse-sampler.sh
#   RESOURCE_PULSE_BUILD_SCRIPT   the build and install script the rows run (default:
#                                 scripts/resource-pulse-sampler-build.sh)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
SAMPLER_TABLE_LIB="$HERE/resource-pulse-sampler-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-sampler-table-lib.sh
source "$SAMPLER_TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$SAMPLER_TABLE_LIB" >&2; exit 2; }
start_sampler_table
require_tools cargo setsid timeout rg awk sed sha256sum cmp zsh stat head ln

[[ -r "$BUILD_SCRIPT" ]] || fatal "cannot read $BUILD_SCRIPT"
build_sampler_program

printf '\nthe build and install step (scripts/resource-pulse-sampler-build.sh), against a stub cargo\n'
# Every row runs the script with a home, a PATH, a cache directory and a crate of its own, built by new_build_row: nothing
# here builds into, installs into or reads the host's home.
# directory_entry_count <directory> prints how many entries it holds, 0 when it is not there.
directory_entry_count() { find "$1" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' '; }
# cargo_builds_run counts the builds the stub was asked for in the current row.
cargo_builds_run() { if [[ -r "$ROW_RECORD" ]]; then rg -c '^args=build ' "$ROW_RECORD"; else echo 0; fi; }
# The building line a run prints before it runs cargo; script_verdict leaves it out of its count, and the rows for it count it.
BUILDING_LINE_PATTERN='^  … Resource Pulse sampler program building '
# The command the build script's remedies name: bash and its own absolute path (outside the rows' homes, so never
# written with a tilde), so it works from any directory.
BUILD_COMMAND_TEXT="bash $(cd -P -- "${BUILD_SCRIPT%/*}" && pwd -P)/${BUILD_SCRIPT##*/}"
# script_verdict names what the last run said: its exit status, how many result lines it printed, and the symbol
# that starts its line (✓ built or current, ⚠ a warning).
script_verdict() {
  printf '%s/%s/%s' "$SCRIPT_EXIT" "$(printf '%s\n' "$SCRIPT_OUTPUT" | rg -v "$BUILDING_LINE_PATTERN" | rg -c .)" "$(printf '%s' "$SCRIPT_OUTPUT" | rg -o '[✓⚠]' | head -1)"
}
INSTALLED_PROGRAM_IDENTITY_FORMAT='%i %.9Y %s'
# installed_state <home> prints what is installed: its inode, modification time and size, or "none".
installed_state() { stat -c "$INSTALLED_PROGRAM_IDENTITY_FORMAT" "$1/$INSTALLED_PROGRAM_RELATIVE" 2>/dev/null || echo none; }

# --- --build-limits-module --------------------------------------------------------------------------------------------
# The job cap's file is the caller's to name: with none, the cap is CARGO_BUILD_JOBS, else 2. Each misuse, and a call
# that would succeed were it accepted: the control shows that the option is known at all, and combines with a mode.
new_build_row option-misuse; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 1000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
FIRST_LIMITS_MODULE="$ROW_DIR/first-limits-file"; SECOND_LIMITS_MODULE="$ROW_DIR/second-limits-file"
printf 'export CARGO_BUILD_JOBS=3\n' | tee "$FIRST_LIMITS_MODULE" >"$SECOND_LIMITS_MODULE" || fatal "cannot write the modules of $ROW_DIR"
# option_misuse_cell <name>: "<name>=<exit>/<usage lines on stderr>/<builds asked of cargo so far> " for the last run.
option_misuse_cell() { printf '%s=%s/%s/%s ' "$1" "$SCRIPT_EXIT" "$(count_lines_matching '^usage: ' <<<"$SCRIPT_STDERR")" "$(cargo_builds_run)"; }
run_build_script --build-limits-module "$FIRST_LIMITS_MODULE" --build-limits-module "$SECOND_LIMITS_MODULE"
OPTION_MISUSE_VERDICTS="$(option_misuse_cell twice)"
run_build_script --build-limits-module; OPTION_MISUSE_VERDICTS+="$(option_misuse_cell no-value)"
run_build_script --build-limits-module ''; OPTION_MISUSE_VERDICTS+="$(option_misuse_cell empty)"
run_build_script --installed-path --build-limits-module "$FIRST_LIMITS_MODULE"; OPTION_MISUSE_VERDICTS+="control=$SCRIPT_EXIT"
check "--build-limits-module given twice, or with no value (last on the line, or empty), is a usage error: exit 2, one usage line, cargo never run; --installed-path --build-limits-module <a module> exits 0" \
  "$OPTION_MISUSE_VERDICTS" "twice=2/1/0 no-value=2/1/0 empty=2/1/0 control=0"
# The module's answer, then no module: the real script reads none, so a copy of it (with the background jobs file it
# needs to build at all) sits in a checkout of the row's own, beside a module of its own that exports 5.
new_build_row build-limits-module; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 1000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
FIXTURE_LIMITS_MODULE="$ROW_DIR/fixture-limits-file"
printf 'export CARGO_BUILD_JOBS=3\n' >"$FIXTURE_LIMITS_MODULE" || fatal "cannot write $FIXTURE_LIMITS_MODULE"
run_build_script --build-limits-module "$FIXTURE_LIMITS_MODULE"
BUILD_LIMITS_VERDICT="module=$(rg -x 'jobs=.*' "$ROW_RECORD")"
COPY_CHECKOUT="$ROW_DIR/checkout-copy"
{ mkdir -p "$COPY_CHECKOUT/scripts" && cp "$BUILD_SCRIPT" "${BUILD_SCRIPT%/*}/resource-pulse-background-jobs.sh" "$COPY_CHECKOUT/scripts/" \
  && printf 'export CARGO_BUILD_JOBS=5\n' >"$COPY_CHECKOUT/scripts/limits-file"; } || fatal "cannot make the checkout copy $COPY_CHECKOUT"
rm -f "$ROW_RECORD"; rm -rf "$ROW_HOME/.local"
BUILD_SCRIPT="$COPY_CHECKOUT/scripts/${BUILD_SCRIPT##*/}" run_build_script
BUILD_LIMITS_VERDICT+=" no-module=$(rg -x 'jobs=.*' "$ROW_RECORD")"
rm -f "$ROW_RECORD"; rm -rf "$ROW_HOME/.local"
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload" CARGO_BUILD_JOBS=6)
BUILD_SCRIPT="$COPY_CHECKOUT/scripts/${BUILD_SCRIPT##*/}" run_build_script
BUILD_LIMITS_VERDICT+=" no-module-environment=$(rg -x 'jobs=.*' "$ROW_RECORD")"
check "the job cap is --build-limits-module's answer; without it, CARGO_BUILD_JOBS or 2, never the file beside the script" \
  "$BUILD_LIMITS_VERDICT" "module=jobs=3 no-module=jobs=2 no-module-environment=jobs=6"
# A relative --build-limits-module path names a file under the working directory (absolute_path, as the options are
# read): from a scratch working directory, a module there that exports 4 gives the cap, so a script that resolved it
# anywhere else (beside itself, say) fails the first cell; a missing one gives the fallback, 2.
new_build_row relative-build-limits-module; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 1000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
RELATIVE_SCRATCH_DIRECTORY="$ROW_DIR/scratch"
mkdir -p "$RELATIVE_SCRATCH_DIRECTORY" || fatal "cannot create $RELATIVE_SCRATCH_DIRECTORY"
PRESENT_RELATIVE_LIMITS_MODULE="present-limits-file"
printf 'export CARGO_BUILD_JOBS=4\n' >"$RELATIVE_SCRATCH_DIRECTORY/$PRESENT_RELATIVE_LIMITS_MODULE" \
  || fatal "cannot write $RELATIVE_SCRATCH_DIRECTORY/$PRESENT_RELATIVE_LIMITS_MODULE"
# A status no run of the script gives, for a scratch directory the run could not enter.
SCRATCH_UNREACHABLE_STATUS=70
# relative_module_jobs <relative path>: the build step with --build-limits-module <path>, run from the scratch directory
# over a home with nothing installed; prints its exit status and the job cap the stub cargo was given, as
# "exit=N jobs=N" ("jobs=none" when cargo was not run).
relative_module_jobs() {
  local run_status
  rm -f "$ROW_RECORD"; rm -rf "$ROW_HOME/.local"
  (cd "$RELATIVE_SCRATCH_DIRECTORY" || exit "$SCRATCH_UNREACHABLE_STATUS"
    run_build_script --build-limits-module "$1"
    exit "$SCRIPT_EXIT")
  run_status=$?
  printf 'exit=%s %s' "$run_status" "$(rg -x 'jobs=.*' "$ROW_RECORD" 2>/dev/null || printf 'jobs=none')"
}
check "a relative --build-limits-module path resolves against the working directory: from a scratch working directory, present-limits-file there (exporting 4) gives the job cap 4, and no-such-limits-file and no-such-dir/limits-file each give the fallback 2" \
  "present=$(relative_module_jobs "$PRESENT_RELATIVE_LIMITS_MODULE") missing=$(relative_module_jobs no-such-limits-file) $(relative_module_jobs no-such-dir/limits-file)" \
  "present=exit=0 jobs=4 missing=exit=0 jobs=2 exit=0 jobs=2"
# --- --installed-path ---------------------------------------------------------------------------------------------------
# The home the --installed-path row gives, and the path it must print: the unit's ExecStart with %h written as this home.
INSTALLED_PATH_ROW_HOME=/h
INSTALLED_PATH_UNDER_ROW_HOME=/h/.local/lib/resource-pulse/resource-pulse-sampler
# installed_path_answer <HOME value> <expected path>: runs --installed-path with that HOME and an empty PATH directory (the
# answer needs no tool and asks no program), and prints its exit status, whether stdout was exactly the expected path and
# a newline, and the bytes on stderr, as status/exact-or-differs/stderr.
installed_path_answer() {
  local answer_status
  mkdir -p "$ROW_DIR/empty-bin"
  env -i HOME="$1" PATH="$ROW_DIR/empty-bin" "$BASH_PATH" "$BUILD_SCRIPT" --installed-path >"$ROW_DIR/script.out" 2>"$ROW_DIR/script.err"
  answer_status=$?
  printf '%s\n' "$2" >"$ROW_DIR/expected.out"
  printf '%s/%s/%s' "$answer_status" "$(cmp -s "$ROW_DIR/expected.out" "$ROW_DIR/script.out" && echo exact || echo differs)" \
    "$(wc -c <"$ROW_DIR/script.err" | tr -d ' ')"
}
new_build_row installed-path
check "--installed-path under HOME=$INSTALLED_PATH_ROW_HOME, with no tool on PATH: exactly $INSTALLED_PATH_UNDER_ROW_HOME and a newline on stdout, nothing on stderr, exit 0" \
  "$(installed_path_answer "$INSTALLED_PATH_ROW_HOME" "$INSTALLED_PATH_UNDER_ROW_HOME")" "0/exact/0"
# A HOME of slashes alone is the root directory, whose path under it starts with a single slash.
INSTALLED_PATH_UNDER_ROOT_HOME=/.local/lib/resource-pulse/resource-pulse-sampler
new_build_row installed-path-trailing-slashes
check "--installed-path drops HOME's trailing slashes: HOME=/h/ and HOME=/h// each print exactly $INSTALLED_PATH_UNDER_ROW_HOME, and HOME=/ prints $INSTALLED_PATH_UNDER_ROOT_HOME, exit 0, nothing on stderr" \
  "$(installed_path_answer /h/ "$INSTALLED_PATH_UNDER_ROW_HOME") $(installed_path_answer /h// "$INSTALLED_PATH_UNDER_ROW_HOME") $(installed_path_answer / "$INSTALLED_PATH_UNDER_ROOT_HOME")" \
  "0/exact/0 0/exact/0 0/exact/0"
new_build_row installed-path-relative-home
RELATIVE_HOME_ANSWER="$(installed_path_answer relative/home "")"
check "--installed-path with a HOME that is not an absolute path (relative/home): nothing on stdout, one line on stderr saying so, exit 2" \
  "${RELATIVE_HOME_ANSWER%%/*}/$(wc -c <"$ROW_DIR/script.out" | tr -d ' ')/$(awk 'END { print NR }' "$ROW_DIR/script.err")/$(count_lines_matching -F 'HOME is not an absolute path (relative/home)' "$ROW_DIR/script.err")" \
  "2/0/1/1"
new_build_row installed-path-no-home
INSTALLED_PATH_NO_HOME_VERDICTS=""
for home_assignment in "" "HOME="; do
  # shellcheck disable=SC2086 # an empty home_assignment is no argument at all: HOME unset
  env -i PATH="$ROW_BIN" $home_assignment "$BASH_PATH" "$BUILD_SCRIPT" --installed-path >"$ROW_DIR/script.out" 2>"$ROW_DIR/script.err"
  INSTALLED_PATH_NO_HOME_VERDICTS+="$?/$(wc -c <"$ROW_DIR/script.out" | tr -d ' ')/$(awk 'END { print NR }' "$ROW_DIR/script.err")/$(count_lines_matching -F 'HOME is not set' "$ROW_DIR/script.err") "
done
check "--installed-path with HOME unset or empty: nothing on stdout, one line on stderr saying HOME is not set, exit 2, each" \
  "$INSTALLED_PATH_NO_HOME_VERDICTS" "2/0/1/1 2/0/1/1 "
# --- cargo missing, old, unreadable -----------------------------------------------------------------------------------
new_build_row no-cargo
run_build_script
check "no cargo: one ⚠ line on stderr naming cargo and the version the crate needs, exit 0, nothing installed" \
  "$(script_verdict)/$(rg -c 'not built: .*cargo.*1\.89' <<<"$SCRIPT_STDERR")/${#SCRIPT_STDOUT}/$(installed_state "$ROW_HOME")" "0/1/⚠/1/0/none"
new_build_row cargo-too-old; install_stub_cargo 1.88.9
make_payload "$ROW_DIR/payload" A 1000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
run_build_script
check "cargo older than rust-version: the ⚠ line names both versions (1.88.9 and 1.89), no build run, nothing installed" \
  "$(script_verdict)/$(rg -c 'not built: .*1\.88\.9.*1\.89' <<<"$SCRIPT_STDERR")/$(cargo_builds_run)/$(installed_state "$ROW_HOME")" "0/1/⚠/1/0/none"
new_build_row cargo-version-numbers
make_payload "$ROW_DIR/payload" A 1000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
version_verdicts=""
for cargo_version in 1.89.0 1.100.0 2.0.0 1.9.0 1.88.99; do
  install_stub_cargo "$cargo_version"; rm -rf "$ROW_HOME/.local"
  run_build_script
  version_verdicts+="$cargo_version=$(script_verdict | tr '/' ':') "
done
check "versions compare as numbers: 1.89.0, 1.100.0 and 2.0.0 build; 1.9.0 and 1.88.99 do not (a text comparison gets 1.9.0 and 1.100.0 wrong)" \
  "$version_verdicts" "1.89.0=0:1:✓ 1.100.0=0:1:✓ 2.0.0=0:1:✓ 1.9.0=0:1:⚠ 1.88.99=0:1:⚠ "
new_build_row cargo-version-unreadable
printf '#!%s\necho "not a cargo version"\n' "$BASH_PATH" >"$ROW_BIN/cargo"; chmod +x "$ROW_BIN/cargo"
run_build_script
check "a cargo whose --version cannot be read: the ⚠ line says so and quotes it, nothing installed" \
  "$(script_verdict)/$(rg -c 'not built: .*version.*not a cargo version' <<<"$SCRIPT_STDERR")/$(installed_state "$ROW_HOME")" "0/1/⚠/1/none"
new_build_row no-rust-version; install_stub_cargo "$STABLE_CARGO_VERSION"
sed -i '/^rust-version/d' "$ROW_CRATE/Cargo.toml"
run_build_script
check "a Cargo.toml with no rust-version: the ⚠ line names it, no build run" \
  "$(script_verdict)/$(rg -c 'not built: .*rust-version' <<<"$SCRIPT_STDERR")/$(cargo_builds_run)" "0/1/⚠/1/0"
new_build_row no-home; install_stub_cargo "$STABLE_CARGO_VERSION"
ROW_ENV=()
SCRIPT_STDOUT="$(env -i PATH="$ROW_BIN" RESOURCE_PULSE_SAMPLER_CRATE_DIR="$ROW_CRATE" "$BASH_PATH" "$BUILD_SCRIPT" \
  2>"$ROW_DIR/script.err")"
SCRIPT_EXIT=$?; SCRIPT_STDERR="$(<"$ROW_DIR/script.err")"; SCRIPT_OUTPUT="$SCRIPT_STDOUT"$'\n'"$SCRIPT_STDERR"
check "no HOME (the script reads the home from HOME and nothing else): the ⚠ line names HOME, exit 0, no cargo run" \
  "$(script_verdict)/$(rg -c 'not built: .*HOME' <<<"$SCRIPT_STDERR")/$(cargo_builds_run)" "0/1/⚠/1/0"
# --- the build --------------------------------------------------------------------------------------------------------
new_build_row build-ok; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
run_build_script
INSTALLED_PROGRAM="$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
check "the build succeeds: one ✓ 'built and installed' line naming the file, exit 0, the file is the build, executable, and the install directory holds nothing else" \
  "$(script_verdict)/$(rg -c 'built and installed: .*resource-pulse-sampler$' <<<"$SCRIPT_STDOUT")/$(cmp -s "$ROW_DIR/payload" "$INSTALLED_PROGRAM" && echo same)/$([[ -x "$INSTALLED_PROGRAM" ]] && echo exec)/$(directory_entry_count "$ROW_HOME/.local/lib/resource-pulse")" \
  "0/1/✓/1/same/exec/1"
STUB_BUILD_ARGUMENTS="$(rg -x 'args=.*' "$ROW_RECORD")"
check "the build is cargo build --release --locked on the crate's manifest" \
  "$STUB_BUILD_ARGUMENTS" "args=build --release --locked --manifest-path $ROW_CRATE/Cargo.toml"
check "the build goes to \$XDG_CACHE_HOME/resource-pulse/cargo-target-install, a build directory of its own" \
  "$(rg -x 'target=.*' "$ROW_RECORD")" "target=$ROW_CACHE/resource-pulse/cargo-target-install"
new_build_row build-no-xdg-cache; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
SCRIPT_STDOUT="$(env -i HOME="$ROW_HOME" PATH="$ROW_BIN" RESOURCE_PULSE_SAMPLER_CRATE_DIR="$ROW_CRATE" STUB_CARGO_RECORD="$ROW_RECORD" \
  STUB_CARGO_PAYLOAD="$ROW_DIR/payload" "$BASH_PATH" "$BUILD_SCRIPT" 2>&1)"
check "without XDG_CACHE_HOME the build goes to ~/.cache/resource-pulse/cargo-target-install under HOME" \
  "$(rg -x 'target=.*' "$ROW_RECORD")" "target=$ROW_HOME/.cache/resource-pulse/cargo-target-install"
new_build_row build-fails-over-an-install; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload"); run_build_script
BEFORE_FAILED_BUILD="$(installed_state "$ROW_HOME")"; cp "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" "$ROW_DIR/installed-copy"
sleep 1.1
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload" STUB_CARGO_MODE=fail); run_build_script
check "the build fails: the ⚠ line says the build failed and where its output is, exit 0, the installed file is byte-identical with the same inode and time" \
  "$(script_verdict)/$(rg -c 'not built: cargo build failed \(exit 101\).*build\.log' <<<"$SCRIPT_STDERR")/$(cmp -s "$ROW_DIR/installed-copy" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" && echo same)/$([[ "$(installed_state "$ROW_HOME")" == "$BEFORE_FAILED_BUILD" ]] && echo untouched)" \
  "0/1/⚠/1/same/untouched"
check "the failed build's output is kept for the reader: the log under the cache directory holds the build's own error" \
  "$(rg -c 'error: the stub build failed' "$ROW_CACHE/resource-pulse/build.log")" "1"
new_build_row build-fails-nothing-installed; install_stub_cargo "$STABLE_CARGO_VERSION"
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/none" STUB_CARGO_MODE=fail); run_build_script
check "the build fails with nothing installed: nothing is installed, and no directory or temporary file is left in its place" \
  "$(script_verdict)/$(installed_state "$ROW_HOME")/$(directory_entry_count "$ROW_HOME/.local/lib/resource-pulse")" "0/1/⚠/none/0"
new_build_row build-leaves-no-program; install_stub_cargo "$STABLE_CARGO_VERSION"
# shellcheck disable=SC2016 # the stub's own $1 must stay literal
printf '#!%s\nif [[ "$1" == --version ]]; then echo %q; fi\nexit 0\n' "$BASH_PATH" "$(cargo_version_line_for "$STABLE_CARGO_VERSION")" >"$ROW_BIN/cargo"
chmod +x "$ROW_BIN/cargo"; run_build_script
check "a build that exits 0 and leaves no program: the ⚠ line says there is none, nothing installed" \
  "$(script_verdict)/$(rg -c 'not built: .*no program' <<<"$SCRIPT_STDERR")/$(installed_state "$ROW_HOME")" "0/1/⚠/1/none"
# --- the rename -------------------------------------------------------------------------------------------------------
new_build_row nothing-changed; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload"); run_build_script
FIRST_INSTALL_STATE="$(installed_state "$ROW_HOME")"
sleep 1.1
run_build_script
check "a second run with nothing changed renames nothing: one ✓ 'unchanged' line, and the installed file's inode, time and size are the same" \
  "$(script_verdict)/$(rg -c 'unchanged: ' <<<"$SCRIPT_STDOUT")/$([[ "$(installed_state "$ROW_HOME")" == "$FIRST_INSTALL_STATE" ]] && echo same-file)/$(cargo_builds_run)" "0/1/✓/1/same-file/2"
make_payload "$ROW_DIR/payload" B 5000
run_build_script
check "a build that changed is installed: 'built and installed', a different inode, the new bytes" \
  "$(script_verdict)/$(rg -c 'built and installed: ' <<<"$SCRIPT_STDOUT")/$([[ "$(installed_state "$ROW_HOME")" != "$FIRST_INSTALL_STATE" ]] && echo new-file)/$(cmp -s "$ROW_DIR/payload" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" && echo same)" \
  "0/1/✓/1/new-file/same"
# The reader: a loop on the final path during repeated installs, taking the file's size each time round. The two builds differ in
# size, so a size that is neither is a file caught empty or half-written, and a failed stat is a file that was missing.
new_build_row atomic-install; install_stub_cargo "$STABLE_CARGO_VERSION"
SMALLER_PAYLOAD_BYTES=6000000; LARGER_PAYLOAD_BYTES=9000000
make_payload "$ROW_DIR/payload-a" A "$SMALLER_PAYLOAD_BYTES"; make_payload "$ROW_DIR/payload-b" B "$LARGER_PAYLOAD_BYTES"
INSTALL_COUNT=24
INSTALLED_PROGRAM="$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload-a"); run_build_script
READER_STOP_FILE="$ROW_DIR/reader-stop"; READER_TALLY_FILE="$ROW_DIR/reader-tally"
(
  reads=0; bad_reads=0
  while [[ ! -e "$READER_STOP_FILE" ]]; do
    observed_size="$(stat -c %s "$INSTALLED_PROGRAM" 2>/dev/null)"
    reads=$((reads + 1))
    [[ "$observed_size" == "$SMALLER_PAYLOAD_BYTES" || "$observed_size" == "$LARGER_PAYLOAD_BYTES" ]] || bad_reads=$((bad_reads + 1))
  done
  echo "$reads $bad_reads" >"$READER_TALLY_FILE"
) &
READER_PID=$!
replaced_count=0
for ((install_round = 0; install_round < INSTALL_COUNT; install_round++)); do
  if (( install_round % 2 == 0 )); then payload_for_round="$ROW_DIR/payload-b"; else payload_for_round="$ROW_DIR/payload-a"; fi
  ROW_ENV=(STUB_CARGO_PAYLOAD="$payload_for_round"); run_build_script
  [[ "$SCRIPT_STDOUT" == *"built and installed"* ]] && replaced_count=$((replaced_count + 1))
done
: >"$READER_STOP_FILE"
wait "$READER_PID"
read -r READER_READS READER_BAD_READS <"$READER_TALLY_FILE"
MINIMUM_READER_READS=100
check "the install is a rename: during $INSTALL_COUNT installs that each replace the file, a reader on the final path never saw it missing, empty or half-written, and it read the path at least $MINIMUM_READER_READS times" \
  "$replaced_count/$READER_BAD_READS/$(( READER_READS >= MINIMUM_READER_READS ? 1 : 0 ))" "$INSTALL_COUNT/0/1"
# --- --check -----------------------------------------------------------------------------------------------------------
new_build_row check-current; install_stub_cargo "$STABLE_CARGO_VERSION"
ROW_CRATE="$CRATE_DIR"
mkdir -p "$ROW_HOME/.local/lib/resource-pulse"; cp "$PROGRAM_PATH" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
run_build_script --check
check "--check with the program built from this checkout installed: exit 0, one ✓ line carrying the program's own --source-hash, cargo never run" \
  "$(script_verdict)/$(rg -c -F "$PROGRAM_SOURCE_HASH" <<<"$SCRIPT_STDOUT")/$(cargo_builds_run)" "0/1/✓/1/0"
new_build_row check-missing; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
run_build_script --check
check "--check with nothing installed: exit 1, one ⚠ line saying it is missing and to build and install it, cargo never run" \
  "$(script_verdict)/$(rg -c -F "missing: ~/$INSTALLED_PROGRAM_RELATIVE is not installed; build and install it (it needs cargo)" <<<"$SCRIPT_STDERR")/$(cargo_builds_run)" "1/1/⚠/1/0"
# stub_installed_program <home> <hash text> installs a program that prints the text for --source-hash.
stub_installed_program() {
  mkdir -p "$1/.local/lib/resource-pulse"
  # shellcheck disable=SC2016 # the stub's own $1 must stay literal
  printf '#!%s\nif [[ "$1" == --source-hash ]]; then echo %q; exit 0; fi\nexit 2\n' "$BASH_PATH" "$2" >"$1/$INSTALLED_PROGRAM_RELATIVE"
  chmod +x "$1/$INSTALLED_PROGRAM_RELATIVE"
}
new_build_row check-differs; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
stub_installed_program "$ROW_HOME" "$OTHER_HASH"
run_build_script --check
check "--check with another source's program installed: exit 1, one ⚠ line naming both hashes" \
  "$(script_verdict)/$(rg -c -F -e "$OTHER_HASH" <<<"$SCRIPT_STDERR")/$(rg -c -F -e "$PROGRAM_SOURCE_HASH" <<<"$SCRIPT_STDERR")" "1/1/⚠/1/1"
new_build_row check-no-sha256sum; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
stub_installed_program "$ROW_HOME" "$PROGRAM_SOURCE_HASH"; rm "$ROW_BIN/sha256sum"
run_build_script --check
check "--check without sha256sum: exit 2 'could not tell', never 0, naming sha256sum" \
  "$(script_verdict)/$(rg -c 'could not tell: .*sha256sum' <<<"$SCRIPT_STDERR")" "2/1/⚠/1"
new_build_row check-cannot-run; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
stub_installed_program "$ROW_HOME" "$PROGRAM_SOURCE_HASH"; chmod -x "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
run_build_script --check
UNRUNNABLE_VERDICT="$(script_verdict)"
printf '#!%s\nexit 2\n' "$BASH_PATH" >"$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"; chmod +x "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
run_build_script --check
OLD_PROGRAM_VERDICT="$(script_verdict)"
printf '#!%s\necho "not a hash"\n' "$BASH_PATH" >"$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
run_build_script --check
JUNK_VERDICT="$(script_verdict)"
check "--check cannot tell, exit 2 each: an installed file that cannot be run, one that does not know --source-hash, one that prints no hash" \
  "$UNRUNNABLE_VERDICT $OLD_PROGRAM_VERDICT $JUNK_VERDICT" "2/1/⚠ 2/1/⚠ 2/1/⚠"
new_build_row check-no-checkout-hash; install_stub_cargo "$STABLE_CARGO_VERSION"
stub_installed_program "$ROW_HOME" "$PROGRAM_SOURCE_HASH"; rm -rf "$ROW_CRATE"; mkdir -p "$ROW_CRATE"
run_build_script --check
check "--check with a checkout it cannot hash: exit 2, never 0" "$(script_verdict)" "2/1/⚠"
new_build_row usage; run_build_script --nonsense
check "an argument the script does not know: exit 2 and one usage line" "$SCRIPT_EXIT/$(rg -c '^usage: ' <<<"$SCRIPT_STDERR")" "2/1"
# The three modes as the usage line names them, and its options, the path before both time-outs.
BUILD_SCRIPT_MODES_TEXT='[--check | --list-hashed-files | --installed-path]'
BUILD_SCRIPT_OPTIONS_TEXT='[--build-limits-module PATH] [--program-timeout-seconds N] [--build-timeout-seconds N]'
new_build_row two-modes; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
stub_installed_program "$ROW_HOME" "$PROGRAM_SOURCE_HASH"
TWO_MODES_VERDICTS=""
for two_modes in "--check --list-hashed-files" "--list-hashed-files --check" "--list-hashed-files --installed-path" \
  "--installed-path --check" "--check --check"; do
  # shellcheck disable=SC2086 # the two words of two_modes are the two arguments
  run_build_script $two_modes
  TWO_MODES_VERDICTS+="$SCRIPT_EXIT/${#SCRIPT_STDOUT}/$(count_lines_matching -F -x "usage: resource-pulse-sampler-build.sh $BUILD_SCRIPT_MODES_TEXT $BUILD_SCRIPT_OPTIONS_TEXT" <<<"$SCRIPT_STDERR")/$(awk 'END { print NR }' <<<"$SCRIPT_STDERR") "
done
check "two modes on one command line (either order, the same one twice) are a usage error, never the last one silently: exit 2, nothing on stdout, the one usage line naming the three modes and the three options, each" \
  "$TWO_MODES_VERDICTS" "2/0/1/1 2/0/1/1 2/0/1/1 2/0/1/1 2/0/1/1 "
new_build_row check-installed-path-is-a-directory; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
mkdir -p "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
run_build_script --check
check "--check with a directory at the installed path: exit 2, one ⚠ line saying the path is not a regular file and to remove it and run the build script again, cargo never run" \
  "$(script_verdict)/$(count_lines_matching "could not tell: .*resource-pulse-sampler is not a regular file; remove it and run $BUILD_COMMAND_TEXT again" <<<"$SCRIPT_STDERR")/$(cargo_builds_run)" "2/1/⚠/1/0"
# A link to nothing at the installed path: not "missing" (a build would not mend it, as the build step refuses that path
# as it refuses a directory), but the same answer as a directory there.
new_build_row check-installed-path-is-a-link-to-nothing; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
mkdir -p "$ROW_HOME/.local/lib/resource-pulse"; ln -s "$ROW_DIR/no-such-program" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
run_build_script --check
check "--check with a link to nothing at the installed path: exit 2, one ⚠ line saying the path is not a regular file, as the build step refuses it, never 'missing', cargo never run" \
  "$(script_verdict)/$(count_lines_matching "could not tell: .*resource-pulse-sampler is not a regular file; remove it and run $BUILD_COMMAND_TEXT again" <<<"$SCRIPT_STDERR")/$(count_lines_matching -F 'missing' <<<"$SCRIPT_STDERR")/$(cargo_builds_run)" "2/1/⚠/1/0/0"
# A program is installed, behind a directory --check cannot search: HOME itself, then the install directory. "Missing"
# would send the user to the build step, which cannot mend that.
new_build_row check-directory-cannot-be-searched; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
stub_installed_program "$ROW_HOME" "$PROGRAM_SOURCE_HASH"
ROW_RUN_BOUND=("${INSTANT_RUN_BOUND[@]}")
chmod 000 "$ROW_HOME"; run_build_script --check; chmod 755 "$ROW_HOME"
UNSEARCHABLE_HOME_CHECK="$(script_verdict)/$(count_lines_matching -F "could not tell: $ROW_HOME cannot be searched" <<<"$SCRIPT_STDERR")/$(count_lines_matching -F 'missing' <<<"$SCRIPT_STDERR")"
INSTALL_DIRECTORY="$ROW_HOME/.local/lib/resource-pulse"
chmod 000 "$INSTALL_DIRECTORY"; run_build_script --check; chmod 755 "$INSTALL_DIRECTORY"
UNSEARCHABLE_INSTALL_DIRECTORY_CHECK="$(script_verdict)/$(count_lines_matching -F "could not tell: $INSTALL_DIRECTORY cannot be searched" <<<"$SCRIPT_STDERR")/$(count_lines_matching -F 'missing' <<<"$SCRIPT_STDERR")"
check "--check with an installed program behind a directory it cannot search (HOME, then the install directory): could not tell, exit 2, one ⚠ line naming the directory, never 'missing'" \
  "$UNSEARCHABLE_HOME_CHECK $UNSEARCHABLE_INSTALL_DIRECTORY_CHECK" "2/1/⚠/1/0 2/1/⚠/1/0"

# --- bounded questions, asking before building, a building line, a bounded build, and small failures ------------------
PROGRAM_TIMEOUT_TEST_SECONDS=1
BUILD_TIMEOUT_TEST_SECONDS=1
# The most a row waits for a time-out of one second to be seen: the time-out, the kill-after and some slack.
MAXIMUM_TIMEOUT_ROW_SECONDS=12
HIDDEN_TEMPORARY_PATTERN='.resource-pulse-sampler.*'
new_build_row check-program-hangs; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
mkdir -p "$ROW_HOME/.local/lib/resource-pulse"
printf '#!%s\nsleep 30\n' "$BASH_PATH" >"$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"; chmod +x "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
HANG_STARTED_AT=$SECONDS
run_build_script --check --program-timeout-seconds "$PROGRAM_TIMEOUT_TEST_SECONDS"
check "--check with an installed program that never answers: exit 2 within the bound, one ⚠ line saying it did not answer --source-hash within 1 s" \
  "$(script_verdict)/$(rg -c 'could not tell: .*did not answer --source-hash within 1 s' <<<"$SCRIPT_STDERR")/$(( SECONDS - HANG_STARTED_AT < MAXIMUM_TIMEOUT_ROW_SECONDS ? 1 : 0 ))" "2/1/⚠/1/1"
new_build_row check-no-timeout-tool; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
stub_installed_program "$ROW_HOME" "$PROGRAM_SOURCE_HASH"; rm "$ROW_BIN/timeout"
run_build_script --check
check "--check without the timeout tool: exit 2 'could not tell', never an unbounded wait and never 0" \
  "$(script_verdict)/$(rg -c 'could not tell: timeout is not installed' <<<"$SCRIPT_STDERR")" "2/1/⚠/1"
new_build_row current-needs-no-cargo; ROW_CRATE="$CRATE_DIR"
stub_installed_program "$ROW_HOME" "$PROGRAM_SOURCE_HASH"
run_build_script
check "the installed program is already this checkout's: one ✓ 'unchanged' line and no cargo, with none on PATH at all and the cache empty" \
  "$(script_verdict)/$(rg -c 'unchanged: ' <<<"$SCRIPT_STDOUT")/$(directory_entry_count "$ROW_CACHE")" "0/1/✓/1/0"
new_build_row builds-say-so; install_stub_cargo "$STABLE_CARGO_VERSION"; ROW_CRATE="$CRATE_DIR"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
stub_installed_program "$ROW_HOME" "$OTHER_HASH"
run_build_script
STALE_BUILD_LINES="$(printf '%s\n' "$SCRIPT_STDOUT" | rg -c .):$(head -1 <<<"$SCRIPT_STDOUT" | rg -c 'program building .*about half a minute'):$(tail -1 <<<"$SCRIPT_STDOUT" | rg -c '✓ .*built and installed')"
rm -rf "$ROW_HOME/.local"; rm -f "$ROW_RECORD"; run_build_script
MISSING_BUILD_LINES="$(printf '%s\n' "$SCRIPT_STDOUT" | rg -c .):$(head -1 <<<"$SCRIPT_STDOUT" | rg -c 'program building .*about half a minute'):$(tail -1 <<<"$SCRIPT_STDOUT" | rg -c '✓ .*built and installed'):$(cargo_builds_run)"
check "a run that builds prints two lines, the building line first and the result after it, whether a stale program or none is installed; cargo ran once" \
  "$STALE_BUILD_LINES $MISSING_BUILD_LINES" "2:1:1 2:1:1:1"
new_build_row build-fails-says-so; install_stub_cargo "$STABLE_CARGO_VERSION"
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/none" STUB_CARGO_MODE=fail); run_build_script
check "a build that fails: the building line on stdout first, then one ⚠ line on stderr" \
  "$(printf '%s\n' "$SCRIPT_STDOUT" | rg -c 'program building ')/$(printf '%s\n' "$SCRIPT_STDERR" | rg -c '^  ⚠ .*not built: cargo build failed')/$(printf '%s\n' "$SCRIPT_OUTPUT" | rg -c .)" "1/1/2"
new_build_row build-times-out; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload"); run_build_script
BEFORE_TIMED_OUT_BUILD="$(installed_state "$ROW_HOME")"
cp "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" "$ROW_DIR/installed-copy"
ROW_ENV=(STUB_CARGO_MODE=hang STUB_CARGO_PIDS="$ROW_DIR/cargo-pids"); BUILD_STARTED_AT=$SECONDS
run_build_script --build-timeout-seconds "$BUILD_TIMEOUT_TEST_SECONDS"
BUILD_TIMEOUT_ELAPSED=$(( SECONDS - BUILD_STARTED_AT ))
STILL_RUNNING_PROCESSES=0
while read -r stub_process_id; do kill -0 "$stub_process_id" 2>/dev/null && STILL_RUNNING_PROCESSES=$((STILL_RUNNING_PROCESSES + 1)); done <"$ROW_DIR/cargo-pids"
check "a build that outlives its bound: two lines, the ⚠ one saying it timed out after 1 s, exit 0, the installed file untouched, within the bound, and no process of the build left running" \
  "$(script_verdict)/$(rg -c 'not built: cargo build timed out after 1 s' <<<"$SCRIPT_STDERR")/$([[ "$(installed_state "$ROW_HOME")" == "$BEFORE_TIMED_OUT_BUILD" ]] && cmp -s "$ROW_DIR/installed-copy" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" && echo untouched)/$(( BUILD_TIMEOUT_ELAPSED < MAXIMUM_TIMEOUT_ROW_SECONDS ? 1 : 0 ))/$STILL_RUNNING_PROCESSES/$(rg -c . "$ROW_DIR/cargo-pids")" \
  "0/1/⚠/1/untouched/1/0/2"
new_build_row install-dir-is-a-file; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
mkdir -p "$ROW_HOME/.local/lib"; : >"$ROW_HOME/.local/lib/resource-pulse"
run_build_script
check "a file where the install directory should be: exactly one ⚠ line on stderr naming the step, no message of mkdir's, exit 0" \
  "$(script_verdict)/$(printf '%s\n' "$SCRIPT_STDERR" | rg -c .)/$(rg -c 'not built: cannot create ' <<<"$SCRIPT_STDERR")/$(rg '^mkdir' <<<"$SCRIPT_STDERR" | wc -l | tr -d ' ')" "0/1/⚠/1/1/0"
new_build_row install-dir-unwritable; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
mkdir -p "$ROW_HOME/.local/lib/resource-pulse"; chmod 555 "$ROW_HOME/.local/lib/resource-pulse"
run_build_script
check "an install directory that cannot be written: exactly one ⚠ line on stderr naming the temporary file, no message of mktemp's, exit 0" \
  "$(script_verdict)/$(printf '%s\n' "$SCRIPT_STDERR" | rg -c .)/$(rg -c 'not built: cannot create a temporary file' <<<"$SCRIPT_STDERR")/$(rg '^mktemp' <<<"$SCRIPT_STDERR" | wc -l | tr -d ' ')" "0/1/⚠/1/1/0"
chmod 755 "$ROW_HOME/.local/lib/resource-pulse"
new_build_row installed-path-is-a-directory; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
mkdir -p "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
run_build_script
check "the installed path is a directory: a ⚠ line naming it and saying to remove it and run the build script again, never a ✓, nothing written into it, no build run" \
  "$(script_verdict)/$(rg -c -F "is not a regular file; remove it and run $BUILD_COMMAND_TEXT again" <<<"$SCRIPT_STDERR")/$(directory_entry_count "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE")/$(cargo_builds_run)" "0/1/⚠/1/0/0"
new_build_row killed-during-the-copy; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload-a" A 5000; make_payload "$ROW_DIR/payload-b" B 5000
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload-a"); run_build_script
INSTALL_DIRECTORY="$ROW_HOME/.local/lib/resource-pulse"
REAL_CP="$(type -P cp)"; rm "$ROW_BIN/cp"
printf '#!%s\n%q "$@" || exit\nsleep 4\n' "$BASH_PATH" "$REAL_CP" >"$ROW_BIN/cp"; chmod +x "$ROW_BIN/cp"
env -i HOME="$ROW_HOME" PATH="$ROW_BIN" XDG_CACHE_HOME="$ROW_CACHE" RESOURCE_PULSE_SAMPLER_CRATE_DIR="$ROW_CRATE" \
  STUB_CARGO_RECORD="$ROW_RECORD" STUB_CARGO_PAYLOAD="$ROW_DIR/payload-b" "$BASH_PATH" "$BUILD_SCRIPT" >/dev/null 2>&1 &
KILLED_SCRIPT_PID=$!
temporary_seen=0
for ((wait_round = 0; wait_round < 100 && temporary_seen == 0; wait_round++)); do
  if [[ -n "$(find "$INSTALL_DIRECTORY" -name "$HIDDEN_TEMPORARY_PATTERN" 2>/dev/null)" ]]; then temporary_seen=1; else sleep 0.1; fi
done
kill -TERM "$KILLED_SCRIPT_PID" 2>/dev/null
wait "$KILLED_SCRIPT_PID"; KILLED_SCRIPT_STATUS=$?
check "the script killed during the copy: the temporary file had been made, and after it no hidden file is left and the installed file is the one before" \
  "$temporary_seen/$KILLED_SCRIPT_STATUS/$(find "$INSTALL_DIRECTORY" -name "$HIDDEN_TEMPORARY_PATTERN" | wc -l | tr -d ' ')/$(cmp -s "$ROW_DIR/payload-a" "$INSTALL_DIRECTORY/resource-pulse-sampler" && echo before)" "1/143/0/before"
new_build_row bad-timeout-option; run_build_script --build-timeout-seconds abc
check "a time-out option that is not a whole number of seconds: exit 2 and one line" "$SCRIPT_EXIT/$(printf '%s\n' "$SCRIPT_STDERR" | rg -c .)" "2/1"

# --- the build is asked for its source hash before anything is installed, and the tools that needs ---------------------
# What a program built from another checkout's sources answers: a build directory shared with that checkout hands it over.
ANOTHER_CHECKOUTS_HASH="$(printf '%064d' 9)"
BUILD_REFUSAL_TEXT='the build left a program built from other sources'
new_build_row other-sources-over-an-install; install_stub_cargo "$STABLE_CARGO_VERSION"
stub_installed_program "$ROW_HOME" "$OTHER_HASH"; cp "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" "$ROW_DIR/installed-copy"
BEFORE_OTHER_SOURCES_BUILD="$(installed_state "$ROW_HOME")"
make_payload "$ROW_DIR/payload" A 5000 "echo $ANOTHER_CHECKOUTS_HASH"; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
run_build_script
check "a build that leaves a program built from other sources, over an installed program: exit 0, one ⚠ line giving both hashes and the build directory to remove, the installed file byte-identical with the same inode and time" \
  "$(script_verdict)/$(rg -c -F "$BUILD_REFUSAL_TEXT" <<<"$SCRIPT_STDERR")/$(rg -c -F "$ANOTHER_CHECKOUTS_HASH" <<<"$SCRIPT_STDERR"):$(rg -c -F "$PROGRAM_SOURCE_HASH" <<<"$SCRIPT_STDERR")/$(rg -c -F "remove $ROW_CACHE/resource-pulse/cargo-target-install and run $BUILD_COMMAND_TEXT again" <<<"$SCRIPT_STDERR")/$(cmp -s "$ROW_DIR/installed-copy" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" && echo same)/$([[ "$(installed_state "$ROW_HOME")" == "$BEFORE_OTHER_SOURCES_BUILD" ]] && echo untouched)/$(cargo_builds_run)" \
  "0/1/⚠/1/1:1/1/same/untouched/1"
new_build_row other-sources-nothing-installed; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000 "echo $ANOTHER_CHECKOUTS_HASH"; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
run_build_script
check "a build that leaves a program built from other sources, with nothing installed: exit 0, the same ⚠ line, and nothing installed, no temporary file left" \
  "$(script_verdict)/$(rg -c -F "$BUILD_REFUSAL_TEXT" <<<"$SCRIPT_STDERR")/$(installed_state "$ROW_HOME")/$(directory_entry_count "$ROW_HOME/.local/lib/resource-pulse")" "0/1/⚠/1/none/0"
new_build_row built-program-does-not-answer; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000 'exec sleep 30'; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
NO_ANSWER_STARTED_AT=$SECONDS
run_build_script --program-timeout-seconds "$PROGRAM_TIMEOUT_TEST_SECONDS"
check "a build that leaves a program that does not answer --source-hash within the bound: the same refusal (exit 0, one ⚠ line saying so and naming the build directory, nothing installed), within the bound" \
  "$(script_verdict)/$(rg -c 'not built: the build left a program that cannot be shown .*did not answer --source-hash within 1 s.*remove .*/cargo-target-install and run' <<<"$SCRIPT_STDERR")/$(installed_state "$ROW_HOME")/$(( SECONDS - NO_ANSWER_STARTED_AT < MAXIMUM_TIMEOUT_ROW_SECONDS ? 1 : 0 ))" \
  "0/1/⚠/1/none/1"
new_build_row build-tools-missing; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
rm "$ROW_BIN/sha256sum"; run_build_script
NO_SHA256SUM_VERDICT="$(script_verdict)/$(rg -c 'not built: sha256sum is not installed' <<<"$SCRIPT_STDERR")/$(cargo_builds_run)/$(installed_state "$ROW_HOME")"
ln -s "$(type -P sha256sum)" "$ROW_BIN/sha256sum" || fatal "cannot link sha256sum"; rm "$ROW_BIN/timeout"; run_build_script
NO_TIMEOUT_VERDICT="$(script_verdict)/$(rg -c 'not built: timeout is not installed' <<<"$SCRIPT_STDERR")/$(cargo_builds_run)/$(installed_state "$ROW_HOME")"
check "without sha256sum, or without timeout, the build step builds nothing: exit 0, one ⚠ line naming the tool, cargo never run, nothing installed" \
  "$NO_SHA256SUM_VERDICT $NO_TIMEOUT_VERDICT" "0/1/⚠/1/0/none 0/1/⚠/1/0/none"

# --- the build script without its background jobs file --------------------------------------------------------------
# The build step and --check run on scripts/resource-pulse-background-jobs.sh (the background build, the signal traps and
# the question for --source-hash), which the script sources from its own directory. A copy of the script alone, in a
# directory without that file, must say so and do nothing: the build step one ⚠ line, exit 0 (it never stops a caller's install),
# cargo never run, nothing installed; --check one ⚠ 'could not tell' line, exit 2, never 0 ("current") or 1 ("missing").
BACKGROUND_JOBS_FILE_NAME="resource-pulse-background-jobs.sh"
new_build_row background-jobs-file-missing; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 1000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
LONE_SCRIPT_DIRECTORY="$ROW_DIR/scripts-without-background-jobs"
LONE_BUILD_SCRIPT="$LONE_SCRIPT_DIRECTORY/${BUILD_SCRIPT##*/}"
{ mkdir -p "$LONE_SCRIPT_DIRECTORY" && cp "$BUILD_SCRIPT" "$LONE_BUILD_SCRIPT"; } \
  || fatal "cannot copy the build script alone into $LONE_SCRIPT_DIRECTORY"
BACKGROUND_JOBS_MISSING_TEXT="the script's own library $LONE_SCRIPT_DIRECTORY/$BACKGROUND_JOBS_FILE_NAME is missing or cannot be loaded"
# run_build_script runs BUILD_SCRIPT: here, for these two runs only, the lone copy.
BUILD_SCRIPT="$LONE_BUILD_SCRIPT" run_build_script
LONE_BUILD_VERDICT="$(script_verdict)/$(count_lines_matching -F "not built: $BACKGROUND_JOBS_MISSING_TEXT" <<<"$SCRIPT_STDERR")"
BUILD_SCRIPT="$LONE_BUILD_SCRIPT" run_build_script --check
LONE_CHECK_VERDICT="$(script_verdict)/$(count_lines_matching -F "could not tell: $BACKGROUND_JOBS_MISSING_TEXT" <<<"$SCRIPT_STDERR")"
check "the build script without its background jobs file beside it: the build step one ⚠ line naming the file, exit 0, cargo never run, nothing installed; --check one ⚠ 'could not tell' line naming it, exit 2" \
  "build=$LONE_BUILD_VERDICT check=$LONE_CHECK_VERDICT cargo=$(cargo_builds_run) installed=$(installed_state "$ROW_HOME")" \
  "build=0/1/⚠/1 check=2/1/⚠/1 cargo=0 installed=none"

# --- a signal ends the build step: nothing installed, no ✓, nothing of the build left running ---------------------------
# A terminal's Ctrl-C is SIGINT to its foreground process group, and its Ctrl-\ is SIGQUIT. These rows start the script as
# the leader of a session of its own (setsid), a group this table created, with SIGINT and SIGQUIT at their defaults (env
# --default-signal): a background job of this non-interactive table starts with both ignored, which a script cannot trap,
# where under a terminal they are not ignored. Then they signal the script's group, as a terminal does, or the script alone.
# SETSID_PATH, ENV_PATH, TERMINAL_SIGNALS_AT_DEFAULT and the waits (wait_for_line_count, wait_for_signalled_script)
# are the sampler table library's.
# A build bound the signal rows never reach: only the signal ends their builds.
SIGNAL_ROW_BUILD_TIMEOUT_SECONDS=120
# The bound of a question to a program in the row that signals during one: long enough to signal in, short to wait out.
SIGNAL_ROW_PROGRAM_TIMEOUT_SECONDS=3
# start_signalled_script <argument...>: starts the script in the row's environment, in a session of its own with SIGINT and
# SIGQUIT at their defaults, its output in the row's script.out and script.err; sets SIGNALLED_SCRIPT_PID (its group's id
# too).
start_signalled_script() {
  env -i HOME="$ROW_HOME" PATH="$ROW_BIN" XDG_CACHE_HOME="$ROW_CACHE" RESOURCE_PULSE_SAMPLER_CRATE_DIR="$ROW_CRATE" \
    STUB_CARGO_RECORD="$ROW_RECORD" "${ROW_ENV[@]}" "$SETSID_PATH" "$ENV_PATH" --default-signal="$TERMINAL_SIGNALS_AT_DEFAULT" \
    "$BASH_PATH" "$BUILD_SCRIPT" "$@" \
    >"$ROW_DIR/script.out" 2>"$ROW_DIR/script.err" &
  SIGNALLED_SCRIPT_PID=$!
}
# process_group_of <pid>: prints the process group of a running process (the third field after its name in
# /proc/<pid>/stat), or nothing.
process_group_of() {
  local stat_line
  local -a fields_after_name
  stat_line="$(cat "/proc/$1/stat" 2>/dev/null)" || return 0
  read -r -a fields_after_name <<<"${stat_line##*) }"
  printf '%s' "${fields_after_name[2]}"
}
# count_running_processes <pid file>: how many of the processes listed in the file still run (0 for no file).
count_running_processes() {
  local listed_process_id running_count=0
  [[ -r "$1" ]] || { printf '0'; return; }
  while read -r listed_process_id; do kill -0 "$listed_process_id" 2>/dev/null && running_count=$((running_count + 1)); done <"$1"
  printf '%s' "$running_count"
}
# end_listed_processes <pid file>: KILL to each listed process still running, so that no row leaves its stub behind.
end_listed_processes() {
  local listed_process_id
  [[ -r "$1" ]] || return 0
  while read -r listed_process_id; do kill -KILL "$listed_process_id" 2>/dev/null; done <"$1"
}
# signalled_run_leftovers <pid file>: what a signalled run left: how many processes of the file still run (they are then
# ended), the ✓ lines it printed and the temporary files left in the home.
signalled_run_leftovers() {
  local still_running
  still_running="$(count_running_processes "$1")"; end_listed_processes "$1"
  printf '%s/%s/%s' "$still_running" "$(count_lines_matching -F '✓' "$ROW_DIR/script.out")" \
    "$(find "$ROW_HOME" -name "$HIDDEN_TEMPORARY_PATTERN" | wc -l | tr -d ' ')"
}
new_build_row interrupted-build; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload" STUB_CARGO_MODE=hang STUB_CARGO_PIDS="$ROW_DIR/cargo-pids")
start_signalled_script --build-timeout-seconds "$SIGNAL_ROW_BUILD_TIMEOUT_SECONDS"
BUILD_START_STATE="$(wait_for_line_count "$ROW_DIR/cargo-pids" 2)"
SIGNALLED_GROUP_STATE="$([[ "$(process_group_of "$SIGNALLED_SCRIPT_PID")" == "$SIGNALLED_SCRIPT_PID" ]] && echo own-group)"
SIGNAL_SENT_AT=$SECONDS; kill -INT -- "-$SIGNALLED_SCRIPT_PID" 2>/dev/null; wait_for_signalled_script
check "SIGINT to the script's process group during a build, as a terminal's Ctrl-C: exit 130 within a few seconds, the build ended (no process of the stub left), no ✓ line, no temporary file, nothing installed" \
  "$BUILD_START_STATE/$SIGNALLED_GROUP_STATE/$SIGNALLED_SCRIPT_STATUS/$(( SECONDS - SIGNAL_SENT_AT < SIGNAL_ROW_END_WAIT_SECONDS ? 1 : 0 ))/$(signalled_run_leftovers "$ROW_DIR/cargo-pids")/$(installed_state "$ROW_HOME")" \
  "started/own-group/130/1/0/0/0/none"
new_build_row terminated-build; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload" STUB_CARGO_MODE=hang STUB_CARGO_PIDS="$ROW_DIR/cargo-pids")
start_signalled_script --build-timeout-seconds "$SIGNAL_ROW_BUILD_TIMEOUT_SECONDS"
BUILD_START_STATE="$(wait_for_line_count "$ROW_DIR/cargo-pids" 2)"
SIGNAL_SENT_AT=$SECONDS; kill -TERM "$SIGNALLED_SCRIPT_PID" 2>/dev/null; wait_for_signalled_script
check "SIGTERM to the script alone during a build: exit 143 within a few seconds, and the build is not orphaned (no process of the stub left), no ✓ line, nothing installed" \
  "$BUILD_START_STATE/$SIGNALLED_SCRIPT_STATUS/$(( SECONDS - SIGNAL_SENT_AT < SIGNAL_ROW_END_WAIT_SECONDS ? 1 : 0 ))/$(signalled_run_leftovers "$ROW_DIR/cargo-pids")/$(installed_state "$ROW_HOME")" \
  "started/143/1/0/0/0/none"
new_build_row quit-during-the-build; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload" STUB_CARGO_MODE=hang STUB_CARGO_PIDS="$ROW_DIR/cargo-pids")
start_signalled_script --build-timeout-seconds "$SIGNAL_ROW_BUILD_TIMEOUT_SECONDS"
BUILD_START_STATE="$(wait_for_line_count "$ROW_DIR/cargo-pids" 2)"
SIGNALLED_GROUP_STATE="$([[ "$(process_group_of "$SIGNALLED_SCRIPT_PID")" == "$SIGNALLED_SCRIPT_PID" ]] && echo own-group)"
SIGNAL_SENT_AT=$SECONDS; kill -QUIT -- "-$SIGNALLED_SCRIPT_PID" 2>/dev/null; wait_for_signalled_script
check "SIGQUIT to the script's process group during a build, as a terminal's Ctrl-\\: exit 131 within a few seconds, the build ended (no process of the stub left), no ✓ line, no temporary file, nothing installed" \
  "$BUILD_START_STATE/$SIGNALLED_GROUP_STATE/$SIGNALLED_SCRIPT_STATUS/$(( SECONDS - SIGNAL_SENT_AT < SIGNAL_ROW_END_WAIT_SECONDS ? 1 : 0 ))/$(signalled_run_leftovers "$ROW_DIR/cargo-pids")/$(installed_state "$ROW_HOME")" \
  "started/own-group/131/1/0/0/0/none"
# The point of no return: from the rename on, the step ignores the four signals until it has printed its ✓ and exited 0.
# A hook read by the script's own bash through BASH_ENV sends it SIGINT at the
# command after a successful rename, the instant between the install and its ✓; the script starts with INT at its
# default, as under a terminal (TERMINAL_SIGNALS_AT_DEFAULT), so that only the step's own ignoring can keep it.
WINDOW_HOOK_EXPECTED_COMMAND='TEMPORARY_PROGRAM_PATH=""'
new_build_row signal-after-the-rename; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000
cat >"$ROW_DIR/window-hook.sh" <<'WINDOW_HOOK'
set -o functrace
window_hook_state=0
trap 'if (( BASHPID == $$ )); then
  if [[ $BASH_COMMAND == "mv -f -- \"\$TEMPORARY_PROGRAM_PATH\" \"\$installed_program\"" ]]; then
    window_hook_state=1
  elif (( window_hook_state == 1 )); then
    window_hook_state=2
    printf "%s\n" "$BASH_COMMAND" >"$WINDOW_HOOK_MARK"
    kill -INT "$$"
  fi
fi' DEBUG
WINDOW_HOOK
ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload" BASH_ENV="$ROW_DIR/window-hook.sh" WINDOW_HOOK_MARK="$ROW_DIR/window-hook-mark")
ROW_RUN_BOUND=("${INSTANT_RUN_BOUND[@]}" "$ENV_PATH" --default-signal="$TERMINAL_SIGNALS_AT_DEFAULT")
run_build_script
check "SIGINT in the instant after the rename and before its ✓ (a hook through BASH_ENV): the step ignores it, prints its ✓ 'built and installed', exits 0, and the program is installed" \
  "$SCRIPT_EXIT/$(count_lines_matching -F '✓ Resource Pulse sampler program built and installed: ' <<<"$SCRIPT_STDOUT")/$(cmp -s "$ROW_DIR/payload" "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE" && echo installed || echo not-installed)/$([[ "$(cat "$ROW_DIR/window-hook-mark" 2>/dev/null)" == "$WINDOW_HOOK_EXPECTED_COMMAND" ]] && echo hook-fired || echo hook-not-fired)" \
  "0/1/installed/hook-fired"
# The two questions to a program, the installed one's before the build and the built one's after it: each program writes
# its pid and sleeps, so the row signals while the script waits for its answer.
new_build_row interrupted-question-before-the-build; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
mkdir -p "$ROW_HOME/.local/lib/resource-pulse"
# shellcheck disable=SC2016 # the program's own $$ must stay literal
printf '#!%s\necho $$ >>%q\nexec sleep 30\n' "$BASH_PATH" "$ROW_DIR/question-pids" >"$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"
chmod +x "$ROW_HOME/$INSTALLED_PROGRAM_RELATIVE"; BEFORE_INTERRUPTED_QUESTION="$(installed_state "$ROW_HOME")"
start_signalled_script --program-timeout-seconds "$SIGNAL_ROW_PROGRAM_TIMEOUT_SECONDS"
QUESTION_START_STATE="$(wait_for_line_count "$ROW_DIR/question-pids" 1)"
kill -INT -- "-$SIGNALLED_SCRIPT_PID" 2>/dev/null; wait_for_signalled_script
QUESTION_BEFORE_BUILD_VERDICT="$QUESTION_START_STATE/$SIGNALLED_SCRIPT_STATUS/$(cargo_builds_run)/$(signalled_run_leftovers "$ROW_DIR/question-pids")/$([[ "$(installed_state "$ROW_HOME")" == "$BEFORE_INTERRUPTED_QUESTION" ]] && echo untouched)"
new_build_row interrupted-question-after-the-build; install_stub_cargo "$STABLE_CARGO_VERSION"
make_payload "$ROW_DIR/payload" A 5000 "echo \$\$ >>$(printf '%q' "$ROW_DIR/question-pids"); exec sleep 30"; ROW_ENV=(STUB_CARGO_PAYLOAD="$ROW_DIR/payload")
start_signalled_script --program-timeout-seconds "$SIGNAL_ROW_PROGRAM_TIMEOUT_SECONDS"
QUESTION_START_STATE="$(wait_for_line_count "$ROW_DIR/question-pids" 1)"
kill -INT -- "-$SIGNALLED_SCRIPT_PID" 2>/dev/null; wait_for_signalled_script
QUESTION_AFTER_BUILD_VERDICT="$QUESTION_START_STATE/$SIGNALLED_SCRIPT_STATUS/$(cargo_builds_run)/$(signalled_run_leftovers "$ROW_DIR/question-pids")/$(installed_state "$ROW_HOME")"
check "SIGINT while the script waits for a program's --source-hash, the installed one's before the build and the built one's after it: taken once the question's bound ends it, exit 130, the program not left running, no ✓; no build after the first, nothing installed after the second" \
  "$QUESTION_BEFORE_BUILD_VERDICT $QUESTION_AFTER_BUILD_VERDICT" "started/130/0/0/0/0/untouched started/130/1/0/0/0/none"
new_build_row build-ignores-term; install_stub_cargo "$STABLE_CARGO_VERSION"
ROW_ENV=(STUB_CARGO_MODE=ignore-term STUB_CARGO_PIDS="$ROW_DIR/cargo-pids")
run_build_script --build-timeout-seconds "$BUILD_TIMEOUT_TEST_SECONDS"
check "a build that ignores the bound's TERM and is killed by its --kill-after (status 137) reads as timed out, not as failed, and is not left running" \
  "$(script_verdict)/$(count_lines_matching 'not built: cargo build timed out after 1 s' <<<"$SCRIPT_STDERR")/$(count_lines_matching 'failed \(exit' <<<"$SCRIPT_STDERR")/$(count_running_processes "$ROW_DIR/cargo-pids")" \
  "0/1/⚠/1/0/0"
end_listed_processes "$ROW_DIR/cargo-pids"

# 54 rows of the build and install step against a stub cargo: --installed-path 4 (the path, trailing slashes, no HOME,
#   a relative HOME), cargo missing, old, a version compared as numbers, unreadable 4, no rust-version 1, no HOME 1, the
#   build and where it goes 4, a failed build 3, no program 1, the rename 3, --check 6, a bad argument 1, two modes 1,
#   --check with a directory or a link to nothing at the installed path 2, --check behind a directory it cannot search 1;
#   then --check bounded and without timeout 2, no cargo when current 1, the building line 2, the bounded build 1, small
#   failures 5 (a file for the install directory, an unwritable one, a directory at the installed path, killed during the
#   copy, a bad time-out option); a build from other sources refused 3 and the tools it needs 1; the script without its
#   background jobs file 1; a signal 6 (SIGINT to the group, SIGTERM alone, SIGQUIT to the group, SIGINT in the instant
#   after the rename, SIGINT during a question, the bound's KILL read as a time-out)
# + 3 --build-limits-module (each misuse; its cap, and none without it; a relative path, resolved against the working
#   directory, and a missing one)
# = 57.
EXPECTED_ROWS=57

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
