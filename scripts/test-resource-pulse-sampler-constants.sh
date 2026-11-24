#!/usr/bin/env bash
#
# scripts/test-resource-pulse-sampler-constants.sh
# =================================================
#
# State table for what the compiled Resource Pulse sampler (resource-pulse-sampler/) must agree on with the gjs side and
# with GLib:
#   - one row per constant, comparing the program's `--print-constants` with the gjs lib/constants.js and
#     lib/protocol.js (gnome-shell/tests/sampler-constants.js), a row that those are every name both languages hold,
#     and rows proving that comparison fails when a value changes on one side;
#   - the app names (src/desktop_names.rs): GLib's own answers, from the installed GLib through
#     gnome-shell/tests/desktop-names-reference.js under gjs, for every id in the fixtures, once per language setting,
#     each against the file of answers the Rust tests hold the lookup to, and rows proving the comparison fails when the
#     language changes and that a reference that cannot run is exit 2.
# Its row helpers, the barrier and the build of the debug program are scripts/resource-pulse-sampler-table-lib.sh's.
# Nothing here touches the live session bus: every gjs and every program run is behind BUS_BARRIER.
#
# "Could not run" is exit 2, never a pass: a missing cargo, gjs, rg, sed or head, a module or fixture the rows read
# that cannot be read, or a program that could not be built, is fatal; a comparison that prints no tally is a failed
# row. The table asserts its own row total.
#
# Requires: bash, cargo, gjs, rg, sed and head. Needs the network the first time (crates.io). Refuses to run as root
# (exit 2).
#
# Usage: scripts/test-resource-pulse-sampler-constants.sh
#   CARGO_TARGET_DIR, CARGO_BUILD_JOBS, RUST_TEST_THREADS   as for scripts/test-resource-pulse-sampler.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"
SAMPLER_TABLE_LIB="$HERE/resource-pulse-sampler-table-lib.sh"
# shellcheck source=SCRIPTDIR/resource-pulse-sampler-table-lib.sh
source "$SAMPLER_TABLE_LIB" || { printf '\033[1;31mFATAL\033[0m: cannot source %s\n' "$SAMPLER_TABLE_LIB" >&2; exit 2; }
start_sampler_table
require_tools cargo gjs rg sed head

CONSTANTS_COMPARISON="$REPO_ROOT/gnome-shell/tests/sampler-constants.js"
# The JavaScript modules the comparison reads, and the crate's module of constants: a name one of the two exports and
# the crate's module defines is a name both languages hold.
JAVASCRIPT_CONSTANT_MODULES=("$REPO_ROOT/gnome-shell/extensions/resource-pulse@zvibaratz.github.io/lib/constants.js"
  "$REPO_ROOT/gnome-shell/extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js")
RUST_CONSTANTS_MODULE="$CRATE_DIR/src/constants.rs"
DESKTOP_NAMES_REFERENCE="$REPO_ROOT/gnome-shell/tests/desktop-names-reference.js"
DESKTOP_FIXTURES="$CRATE_DIR/tests/fixtures/desktop"
# How many constant names the program prints and the gjs comparison tallies: the names both languages hold.
EXPECTED_CONSTANT_NAME_COUNT=14
# A constant's name where the JavaScript exports it and where the crate defines it, one to a line as the house style and
# rustfmt write each: `export const NAME =` and `pub const NAME:`.
JAVASCRIPT_CONSTANT_EXPORT_PATTERN='^export const ([A-Za-z_][A-Za-z0-9_]*) ='
RUST_CONSTANT_DEFINITION_PATTERN='^pub const ([A-Z][A-Z0-9_]*):'
[[ -r "$CONSTANTS_COMPARISON" ]] || fatal "cannot read $CONSTANTS_COMPARISON"
for constants_module in "${JAVASCRIPT_CONSTANT_MODULES[@]}" "$RUST_CONSTANTS_MODULE"; do
  [[ -r "$constants_module" ]] || fatal "cannot read $constants_module"
done
[[ -r "$DESKTOP_NAMES_REFERENCE" ]] || fatal "cannot read $DESKTOP_NAMES_REFERENCE"
[[ -r "$DESKTOP_FIXTURES/ids.txt" ]] || fatal "cannot read $DESKTOP_FIXTURES/ids.txt"
build_sampler_program

# run_constants_comparison <program> runs the gjs comparison against <program>, which it runs with --print-constants,
# and sets COMPARISON_EXIT and COMPARISON_OUTPUT; a run that printed no tally is a failed row. Behind the barrier: a
# program whose --print-constants fell through to serving would find no bus, and exit 1 at once.
run_constants_comparison() {
  COMPARISON_OUTPUT="$(off_bus gjs -m "$CONSTANTS_COMPARISON" "$1" 2>&1)"
  COMPARISON_EXIT=$?
}
printf '\nthe constants, one row per name, against lib/constants.js and lib/protocol.js\n'
run_constants_comparison "$PROGRAM_PATH"
while IFS= read -r comparison_line; do
  case "$comparison_line" in
    "CONSTANT-ROW pass "*) ok "constant ${comparison_line#CONSTANT-ROW pass }" ;;
    "CONSTANT-ROW fail "*) bad "constant ${comparison_line#CONSTANT-ROW fail }" ;;
  esac
done <<<"$COMPARISON_OUTPUT"
check "the comparison printed its tally of $EXPECTED_CONSTANT_NAME_COUNT names and exited 0" \
  "$(printf '%s\n' "$COMPARISON_OUTPUT" | rg -c -x "CONSTANT-TALLY names=$EXPECTED_CONSTANT_NAME_COUNT"):$COMPARISON_EXIT" "1:0"
# The comparison covers every constant both languages hold, so that neither side can change one alone: a name kept on
# both sides and left out of the comparison would drift unseen. So the names lib/constants.js or lib/protocol.js
# exports and src/constants.rs defines are exactly the names --print-constants prints, as many as the tally. A module
# that cannot be read holds no name here, which fails the row.
# names_in <pattern> <file>...: the first group of each line matching <pattern>, sorted bytewise, one to a line.
names_in() {
  local name_pattern="$1"; shift
  # shellcheck disable=SC2016 # `$1` is rg's replacement: the pattern's first group
  rg --no-filename --no-line-number --only-matching --replace '$1' "$name_pattern" "$@" | LC_ALL=C sort -u
}
NAMES_HELD_BY_BOTH_LANGUAGES="$(LC_ALL=C comm -12 \
  <(names_in "$JAVASCRIPT_CONSTANT_EXPORT_PATTERN" "${JAVASCRIPT_CONSTANT_MODULES[@]}") \
  <(names_in "$RUST_CONSTANT_DEFINITION_PATTERN" "$RUST_CONSTANTS_MODULE") | tr '\n' ' ')"
PRINTED_CONSTANT_NAMES="$(off_bus "$PROGRAM_PATH" --print-constants | cut -d= -f1 | LC_ALL=C sort | tr '\n' ' ')"
check "the names both languages hold (exported by lib/constants.js or lib/protocol.js, defined by src/constants.rs) are the names --print-constants prints" \
  "$(wc -w <<<"$NAMES_HELD_BY_BOTH_LANGUAGES" | tr -d ' '):$NAMES_HELD_BY_BOTH_LANGUAGES" \
  "$EXPECTED_CONSTANT_NAME_COUNT:$PRINTED_CONSTANT_NAMES"

# A stand-in program that prints the real program's constants after an `sed` edit, to prove the comparison can fail.
make_edited_program() {
  local stand_in_path="$WORK_DIR/$1" sed_script="$2"
  {
    printf '#!/usr/bin/env bash\n'
    # shellcheck disable=SC2016 # the stand-in's own $1 must stay literal
    printf 'if [[ "$1" != --print-constants ]]; then exit 2; fi\n'
    printf '"%s" --print-constants | sed -e %q\n' "$PROGRAM_PATH" "$sed_script"
  } >"$stand_in_path"
  chmod +x "$stand_in_path"
  printf '%s' "$stand_in_path"
}
printf '\nthe constants comparison fails when one side changes\n'
run_constants_comparison "$(make_edited_program changed-value 's/^CARD_HISTORY_SAMPLES=150$/CARD_HISTORY_SAMPLES=151/')"
check "a value changed on the Rust side: exit 1, that one name fails" \
  "$COMPARISON_EXIT:$(printf '%s\n' "$COMPARISON_OUTPUT" | rg -c '^CONSTANT-ROW fail CARD_HISTORY_SAMPLES javascript 150 but program 151$')" "1:1"
run_constants_comparison "$(make_edited_program lacking-name '/^LOG_PREFIX=/d')"
check "a name the program lacks: exit 1, it fails as not printed" \
  "$COMPARISON_EXIT:$(printf '%s\n' "$COMPARISON_OUTPUT" | rg -c '^CONSTANT-ROW fail LOG_PREFIX the program does not print it$')" "1:1"
# shellcheck disable=SC2016 # `$a` is sed's address for the last line
run_constants_comparison "$(make_edited_program extra-name '$a EXTRA_ONLY_ON_RUST_SIDE=1')"
check "a name only the program has: exit 1, it fails as not listed" \
  "$COMPARISON_EXIT:$(printf '%s\n' "$COMPARISON_OUTPUT" | rg -c '^CONSTANT-ROW fail EXTRA_ONLY_ON_RUST_SIDE the program prints it and the comparison does not list it$')" "1:1"
run_constants_comparison "$(make_edited_program changed-list 's/\[10,25,50\]/[10,25,51]/')"
check "a list changed on the Rust side: exit 1" \
  "$COMPARISON_EXIT:$(printf '%s\n' "$COMPARISON_OUTPUT" | rg -c '^CONSTANT-ROW fail PRESSURE_BAND_THRESHOLDS_PERCENT ')" "1:1"
run_constants_comparison "$WORK_DIR/no-such-program"
check "a program that cannot run is exit 2, never a pass" "$COMPARISON_EXIT" 2

printf '\nthe app names against the installed GLib (gnome-shell/tests/desktop-names-reference.js)\n'
# run_desktop_names_reference <ids file> <LANGUAGE> <LC_ALL> <LC_MESSAGES> <LANG> [<PATH>] runs the reference under gjs and sets
# REFERENCE_EXIT and REFERENCE_OUTPUT. Its environment is built here and not inherited: the fixture directories (the
# fixture "home" is the data home, "system-a" then "system-b" the system directories), a PATH of the fixtures' own bin
# (for TryExec and Exec; the word "unset" leaves it out of the environment), a HOME that does not exist, and the four
# language variables as given, with the fixtures directory as the current one (a relative program is looked for there). Behind the barrier, so
# nothing of it can reach a live bus. These language values are the ones LanguageSet holds in
# resource-pulse-sampler/src/desktop_names/tests.rs, which holds the Rust lookup to the same expected files.
GJS_PATH="$(command -v gjs)"
run_desktop_names_reference() {
  local search_path_setting=("PATH=${6:-$DESKTOP_FIXTURES/bin}")
  [[ "${6:-}" != unset ]] || search_path_setting=()
  REFERENCE_OUTPUT="$(cd "$DESKTOP_FIXTURES" && env -i "${BUS_BARRIER[@]}" GIO_USE_VFS=local \
    "HOME=$DESKTOP_FIXTURES/home-dir" "${search_path_setting[@]}" \
    "XDG_DATA_HOME=$DESKTOP_FIXTURES/home" "XDG_DATA_DIRS=$DESKTOP_FIXTURES/system-a:$DESKTOP_FIXTURES/system-b" \
    "LANGUAGE=$2" "LC_ALL=$3" "LC_MESSAGES=$4" "LANG=$5" \
    "$GJS_PATH" -m "$DESKTOP_NAMES_REFERENCE" "$1" 2>"$WORK_DIR/reference.err")"
  REFERENCE_EXIT=$?
}
# Each row: a label, the four language values, PATH ("default" is the fixtures' bin), and the file of answers the Rust
# lookup is held to.
DESKTOP_NAMES_ROWS=(
  "English|en|en_US.UTF-8|en_US.UTF-8|en_US.UTF-8|default|expected-english.tsv"
  "a translated name must win|zz:xx_YY|en_US.UTF-8|en_US.UTF-8|en_US.UTF-8|default|expected-zz-xx-yy.tsv"
  "a codeset and a modifier in the language|xx_YY.UTF-8@mod|en_US.UTF-8|en_US.UTF-8|en_US.UTF-8|default|expected-xx-yy-utf8-mod.tsv"
  "PATH unset, so the default search path applies|en|en_US.UTF-8|en_US.UTF-8|en_US.UTF-8|unset|expected-english-no-path.tsv"
  "PATH with an empty entry, the current directory|en|en_US.UTF-8|en_US.UTF-8|en_US.UTF-8|:|expected-english-empty-path-entry.tsv"
)
for desktop_names_row in "${DESKTOP_NAMES_ROWS[@]}"; do
  IFS='|' read -r row_label row_language row_lc_all row_lc_messages row_lang row_path row_expected_file <<<"$desktop_names_row"
  [[ "$row_path" != default ]] || row_path="$DESKTOP_FIXTURES/bin"
  run_desktop_names_reference "$DESKTOP_FIXTURES/ids.txt" "$row_language" "$row_lc_all" "$row_lc_messages" "$row_lang" "$row_path"
  if (( REFERENCE_EXIT != 0 )); then
    cat "$WORK_DIR/reference.err"
    bad "desktop names, $row_label: the reference could not run (exit $REFERENCE_EXIT), which is not a pass"
  elif [[ "$REFERENCE_OUTPUT" == "$(<"$DESKTOP_FIXTURES/$row_expected_file")" ]]; then
    ok "desktop names, $row_label: GLib's answers are exactly $row_expected_file"
  else
    diff <(printf '%s\n' "$REFERENCE_OUTPUT") "$DESKTOP_FIXTURES/$row_expected_file" | head -10
    # The reference's first stderr line names the GLib it ran on: the expected files are 2.88's answers, so a differing
    # row on another version reads as a change of runner image and not of the lookup.
    cat "$WORK_DIR/reference.err"
    bad "desktop names, $row_label: GLib's answers differ from $row_expected_file"
  fi
done
# The comparison can fail: the English answers are not the answers under another language.
run_desktop_names_reference "$DESKTOP_FIXTURES/ids.txt" zz:xx_YY en_US.UTF-8 en_US.UTF-8 en_US.UTF-8
check "the reference under another language does not print the English answers: exit 0, and they differ" \
  "$REFERENCE_EXIT/$([[ "$REFERENCE_OUTPUT" == "$(<"$DESKTOP_FIXTURES/expected-english.tsv")" ]] && echo same || echo different)" "0/different"
run_desktop_names_reference "$WORK_DIR/no-such-ids.txt" en en_US.UTF-8 en_US.UTF-8 en_US.UTF-8
check "a reference that cannot read its list of ids is exit 2 with nothing printed, never a pass" \
  "$REFERENCE_EXIT/${#REFERENCE_OUTPUT}" "2/0"

# 14 constants + 1 comparison tally + 1 row of the names both languages hold + 5 comparison-fails rows
# + 7 rows of the app names against the installed GLib (3 languages, 2 search paths, 1 that must differ, 1 that cannot run)
# = 28.
EXPECTED_ROWS=28

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
