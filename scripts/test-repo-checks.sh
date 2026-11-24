#!/usr/bin/env bash
#
# scripts/test-repo-checks.sh
# ===========================
#
# State table for this repository's own checks: what runs them, and what keeps their counts honest. It reads three
# files and runs nothing else:
#   - .pre-commit-config.yaml: the shellcheck hook runs the bounded wrapper (scripts/shellcheck-bounded.sh), excludes
#     none of the nested tables, and excludes no parse-error code;
#   - docs/guide.md: it states each Resource Pulse table's total, in its phrase "`<table>` (<n> checks)";
#   - .github/workflows/ci.yml: it runs on every push to main and every pull request to main, and a sound step runs
#     every state table: a step whose whole command is the table, which nothing can skip, let fail unheeded, run
#     under another shell, or run with CI changed.
#
# A table asserts its own literal total, but only a table that runs can fail, and only a stated total can go stale.
# These rows find the tables by glob, so a new one cannot escape them, read each total from the table's text as
# scripts/check-state-table-totals.sh does, and are never a pass over no table. The real guide and workflow hold none
# of the cases the checkers' filters exist for, so the same checkers also run on fixture checkouts under a temporary
# directory, one planted case each.
#
# "Could not run" is exit 2, never a pass: a missing tool, PyYAML, or a fixture that cannot be written. The table
# asserts its own row total.
#
# Requires: bash, awk, grep, mktemp, tr, and python3 with PyYAML (Ubuntu: python3-yaml), which reads the pre-commit
# config and the CI workflows. No network, no root, no bus.
#
# Usage: scripts/test-repo-checks.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/.." && pwd -P)"

PASS=0; FAIL=0
ok()    { printf '  \033[0;32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()   { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 — expected '$3', got '$2'"; fi; }
fatal() { printf '\033[1;31mFATAL\033[0m: %s\n' "$*" >&2; exit 2; }

for required_tool in awk grep mktemp python3 tr; do
  command -v "$required_tool" >/dev/null || fatal "$required_tool is required"
done
python3 -I -c 'import yaml' 2>/dev/null ||
  fatal "PyYAML is required to read the pre-commit config and the CI workflow (Ubuntu: python3-yaml)"

# ---------------------------------------------------------------------------
# The pre-commit shellcheck hook.
#
# The wrapper bounds each shellcheck's address space, so a file that outgrows the bound
# fails the hook instead of taking the machine's memory. These rows hold the hook to
# excluding none of the nested tables and their two libraries, nor the name of the
# retired single table, nor the heaviest file it checks. The hook is read with a YAML
# parser, and its exclude regex is tested with Python's re.search, the way pre-commit
# applies it.
# ---------------------------------------------------------------------------
WRAPPER_PATH='scripts/shellcheck-bounded.sh'
PRECOMMIT_CONFIG='.pre-commit-config.yaml'
# The nested tables and their libraries, and the name of the retired single table: no
# table may be excluded from the hook.
SPLIT_MONOLITH_PATHS=(scripts/test-resource-pulse.sh scripts/test-resource-pulse-nested.sh
  scripts/test-resource-pulse-nested-runs.sh scripts/test-resource-pulse-nested-check.sh
  scripts/test-resource-pulse-nested-signals.sh scripts/resource-pulse-nested-table-lib.sh
  scripts/resource-pulse-check-table-lib.sh)
HEAVIEST_CHECKED_PATH='scripts/test-resource-pulse-sampler.sh'

# hook_query <query> [<path>]: reads the shellcheck hook out of the pre-commit config with a YAML parser. `entry`
# prints the hook's entry; `excludes PATH` prints whether the hook's exclude regex, searched the way pre-commit searches
# it, skips PATH; `excluded-parse-codes` prints the parse-error codes its args pass to `-e` (as `-e X`, `-eX`,
# `--exclude X` or `--exclude=X`, with or without the SC prefix), or `none`. Prints a description of the problem
# instead when there is not exactly one such hook, or when the config cannot be read.
hook_query() {
  python3 -I - "$REPO_ROOT/$PRECOMMIT_CONFIG" "$@" <<'PY'
import re
import sys

import yaml

config_path, query, *query_args = sys.argv[1:]
try:
    with open(config_path, encoding='utf-8') as config_file:
        config = yaml.safe_load(config_file)
except (OSError, yaml.YAMLError) as read_error:
    print(f'cannot read the pre-commit config: {read_error}')
    sys.exit(0)
hooks = [
    hook
    for repo in (config or {}).get('repos', [])
    for hook in repo.get('hooks', [])
    if hook.get('id') == 'shellcheck'
]
if len(hooks) != 1:
    print(f'{len(hooks)} shellcheck hooks')
elif query == 'entry':
    print(hooks[0].get('entry', '<no entry>'))
elif query == 'excludes':
    exclude_pattern = hooks[0].get('exclude', '^$')  # pre-commit's default
    print('excluded' if re.search(exclude_pattern, query_args[0]) else 'checked')
elif query == 'excluded-parse-codes':
    parse_error_code_numbers = {'1071', '1072', '1073'}
    args = [str(arg) for arg in hooks[0].get('args', [])]
    excluded_code_numbers = set()
    for index, arg in enumerate(args):
        if arg in ('-e', '--exclude'):
            excluded_list = args[index + 1] if index + 1 < len(args) else ''
        elif arg.startswith('--exclude='):
            excluded_list = arg.split('=', 1)[1]
        elif arg.startswith('-e'):
            excluded_list = arg[2:]
        else:
            continue
        for code in excluded_list.split(','):
            excluded_code_numbers.add(code.strip().upper().removeprefix('SC'))
    excluded_parse_codes = sorted(excluded_code_numbers & parse_error_code_numbers)
    print(' '.join(f'SC{number}' for number in excluded_parse_codes) or 'none')
PY
}

printf 'the pre-commit shellcheck hook\n'
check "the wrapper is executable, as pre-commit runs it directly" \
  "$([[ -x "$REPO_ROOT/$WRAPPER_PATH" ]] && echo executable)" "executable"
check "the shellcheck hook's entry is the wrapper" "$(hook_query entry)" "./$WRAPPER_PATH"
split_monolith_verdicts=""
for split_monolith_path in "${SPLIT_MONOLITH_PATHS[@]}"; do
  split_monolith_verdicts+="$split_monolith_path=$(hook_query excludes "$split_monolith_path") "
done
check "the hook excludes none of the nested tables or their libraries, nor the retired scripts/test-resource-pulse.sh name" \
  "$split_monolith_verdicts" "$(printf '%s=checked ' "${SPLIT_MONOLITH_PATHS[@]}")"
check "$HEAVIEST_CHECKED_PATH is not excluded by the hook's regex" \
  "$(hook_query excludes "$HEAVIEST_CHECKED_PATH")" "checked"
check "the hook's -e list names no parse-error code (SC1071, SC1072, SC1073)" \
  "$(hook_query excluded-parse-codes)" "none"

# ---------------------------------------------------------------------------
# Every table: its total in the guide, and its step in CI.
#
# The guide documents the Resource Pulse tables, scripts/test-resource-pulse*.sh, so those are the ones it must state
# a total for. CI must run every state table in the repository, scripts/test-*.sh: the guard tables beside the product
# ones count too, since a table no step runs is a table that cannot fail.
# ---------------------------------------------------------------------------
GUIDE_TABLE_PATTERNS=('scripts/test-resource-pulse*.sh')
CI_TABLE_PATTERNS=('scripts/test-*.sh')
RESOURCE_PULSE_GUIDE='docs/guide.md'
CI_WORKFLOW='.github/workflows/ci.yml'
# A table's own total: the line `EXPECTED_ROWS=<n>`, as scripts/check-state-table-totals.sh reads it.
TABLE_TOTAL_LINE_PATTERN='^[[:space:]]*EXPECTED_ROWS=([0-9]+)[[:space:]]*(#.*)?$'
# The `if:` every table's step carries, so that it runs even after an earlier table in its job failed.
# shellcheck disable=SC2016  # A GitHub Actions expression, compared as text: nothing here expands it.
TABLE_STEP_RUN_ANYWAY_CONDITION='${{ !cancelled() }}'

# join_with_semicolons <item>…: the items on one line, separated by "; ".
join_with_semicolons() {
  local joined_items="$1" next_item
  shift
  for next_item in "$@"; do joined_items+="; $next_item"; done
  printf '%s' "$joined_items"
}

# list_tables <pattern>…: each table matching a pattern, relative to REPO_ROOT, one per line, in the patterns' order.
list_tables() {
  local table_pattern table_path
  for table_pattern in "$@"; do
    # Globbed from inside REPO_ROOT, so no character of the checkout's own path is ever read as a pattern.
    while IFS= read -r table_path; do
      [[ -f "$REPO_ROOT/$table_path" ]] && printf '%s\n' "$table_path"
    done < <(cd "$REPO_ROOT" && compgen -G "$table_pattern")
  done
}

# table_total_literal <table>: the n of the table's `EXPECTED_ROWS=<n>` line; nothing when it has no such line, or two
# that disagree.
table_total_literal() {
  local total_line declared_total=""
  while IFS= read -r total_line; do
    [[ "$total_line" =~ $TABLE_TOTAL_LINE_PATTERN ]] || continue
    [[ -z "$declared_total" || "$declared_total" == "${BASH_REMATCH[1]}" ]] || return 0
    declared_total="${BASH_REMATCH[1]}"
  done < <(grep -E -- "$TABLE_TOTAL_LINE_PATTERN" "$REPO_ROOT/$1")
  printf '%s' "$declared_total"
}

# visible_guide_text <guide>: the Markdown file's text a reader sees, on one line with its whitespace folded, so a line
# break inside a phrase does not matter. A fenced code block (from a line that starts, after any indentation, with ```
# or ~~~ to the next line that starts with the same three characters) and an HTML comment (<!-- … -->, which may span
# lines) are left out: a total stated only there is not stated. Either one left open hides the rest of the file, as
# Markdown does. An indented code block is still read as prose.
visible_guide_text() {
  # awk prints each visible piece as it goes, so its work is linear in the file's size; building the whole text in one
  # awk string first was quadratic, and a guide of a hundred thousand lines hung the table. Every line starts with the
  # one space that joined it to the line before, so a marker never straddles a line break. tr then folds each run of
  # whitespace, newlines included, to a single space, which is what the whole-text fold did.
  awk '
    {
      marker_text = $0
      sub(/^[ \t]+/, "", marker_text)
      line_fence = substr(marker_text, 1, 3)
      if (open_fence != "") {
        if (line_fence == open_fence) { open_fence = "" }
        next
      }
      if (line_fence == "```" || line_fence == "~~~") { open_fence = line_fence; next }
      remaining_text = " " $0
      # An open comment, or the one that opens on this line, hides text up to its "-->"; unclosed, it hides the rest.
      while (remaining_text != "") {
        if (in_comment) {
          comment_end = index(remaining_text, "-->")
          if (comment_end == 0) { break }
          remaining_text = substr(remaining_text, comment_end + length("-->"))
          in_comment = 0
          continue
        }
        comment_start = index(remaining_text, "<!--")
        if (comment_start == 0) { printf "%s", remaining_text; break }
        printf "%s ", substr(remaining_text, 1, comment_start - 1)
        remaining_text = substr(remaining_text, comment_start + length("<!--"))
        in_comment = 1
      }
    }
  ' "$1" | tr -s '[:space:]' ' '
}

# guide_totals_of_table <visible guide text> <table>: every n the guide states for the table in its phrase
# "`<table>` (<n> checks)", in the guide's order, separated by commas; nothing when it states none. The table's path
# is matched as text (awk's index), never as a pattern.
guide_totals_of_table() {
  awk -v claim_prefix="\`$2\` (" -v claim_suffix=" checks)" '
    {
      text = $0
      while ((prefix_at = index(text, claim_prefix)) > 0) {
        text = substr(text, prefix_at + length(claim_prefix))
        if (match(text, /^[0-9]+/) && substr(text, RLENGTH + 1, length(claim_suffix)) == claim_suffix) {
          claimed_totals = claimed_totals (claimed_totals == "" ? "" : ",") substr(text, 1, RLENGTH)
        }
      }
    }
    END { printf "%s", claimed_totals }
  ' <<<"$1"
}

# tables_the_guide_misstates <guide>: "none" when the guide (relative to REPO_ROOT) states every Resource Pulse table's
# total, and no other total for it, in its phrase "`<table>` (<n> checks)", in its visible text (visible_guide_text).
# Otherwise each table it misstates, by name; "no table matches …" over no table; and "cannot read <guide>" when it
# cannot read the guide. Only the first is ever "none".
tables_the_guide_misstates() {
  local guide_path="$REPO_ROOT/$1" visible_guide table_path declared_total stated_totals table_count=0
  local -a misstated_tables=()
  [[ -r "$guide_path" ]] || { printf 'cannot read %s' "$1"; return; }
  visible_guide="$(visible_guide_text "$guide_path")" || { printf 'cannot read %s' "$1"; return; }
  while IFS= read -r table_path; do
    table_count=$((table_count + 1))
    declared_total="$(table_total_literal "$table_path")"
    stated_totals="$(guide_totals_of_table "$visible_guide" "$table_path")"
    if [[ -z "$declared_total" ]]; then
      misstated_tables+=("$table_path has no single EXPECTED_ROWS literal")
    elif [[ "$stated_totals" != "$declared_total" ]]; then
      misstated_tables+=("$table_path runs $declared_total, the guide states ${stated_totals:-no total}")
    fi
  done < <(list_tables "${GUIDE_TABLE_PATTERNS[@]}")
  if (( table_count == 0 )); then
    printf 'no table matches %s' "${GUIDE_TABLE_PATTERNS[*]}"
  elif (( ${#misstated_tables[@]} == 0 )); then
    printf 'none'
  else
    join_with_semicolons "${misstated_tables[@]}"
  fi
}

# ci_workflow_gaps <workflow> <table>…: each way the workflow can leave a table unrun or unheeded, one per line, and
# nothing when there is none. The workflow is read with PyYAML, never by its text; exit 2 when it cannot be parsed. See
# ways_ci_can_miss_a_table for what counts as a gap.
ci_workflow_gaps() {
  python3 -I - "$1" "$TABLE_STEP_RUN_ANYWAY_CONDITION" "${@:2}" <<'PY'
import sys

import yaml

workflow_path, run_anyway_condition, *table_paths = sys.argv[1:]
# Both must start a run, filtered by nothing but `branches`, which must keep main. Any other filter (paths,
# paths-ignore, branches-ignore, tags, types) can leave a push or a pull request on which no table runs.
REQUIRED_TRIGGERS = ("push", "pull_request")
ALLOWED_TRIGGER_FILTER = "branches"
REQUIRED_BRANCH = "main"
# A step with no `if:` runs when every step before it passed; one with the tables' condition runs even after an
# earlier table failed. Any other condition can skip it. A job runs here only with no `if:` at all.
ALLOWED_STEP_CONDITIONS = (None, run_anyway_condition)
# Actions sets CI, and a table may read it: the units table fails its unit rows on CI when systemd-analyze is missing,
# and passes them as "absent here" anywhere else. So no env: on a table step's way may set it, to any value.
RUNNER_SET_VARIABLE = "CI"


def trigger_gaps(workflow):
    """Each way the workflow's `on:` can leave a push to main or a pull request without a run."""
    # PyYAML reads the bare key `on` as YAML 1.1's boolean true; only a quoted "on" stays a string.
    triggers = workflow.get(True, workflow.get("on"))
    if isinstance(triggers, str):
        triggers = [triggers]
    if isinstance(triggers, list):
        triggers = dict.fromkeys(triggers)
    if not isinstance(triggers, dict):
        triggers = {}
    gaps = []
    for event in REQUIRED_TRIGGERS:
        if event not in triggers:
            gaps.append(f"the workflow does not run on {event}")
            continue
        event_filters = triggers[event] or {}
        narrowing_filters = sorted(str(name) for name in event_filters if name != ALLOWED_TRIGGER_FILTER)
        if narrowing_filters:
            gaps.append(f"the workflow's {event} trigger filters by {', '.join(narrowing_filters)}")
        branches = event_filters.get(ALLOWED_TRIGGER_FILTER)
        # One branch may be written bare; compared as a list, so "maintenance" does not hold main as a substring.
        branch_names = [branches] if isinstance(branches, str) else branches
        if branch_names is not None and REQUIRED_BRANCH not in branch_names:
            gaps.append(f"the workflow's {event} trigger leaves out {REQUIRED_BRANCH}")
    return gaps


def sets_runner_variable(scope):
    """Whether a workflow's, a job's or a step's env: sets CI, or is not a mapping, which cannot be read."""
    scope_env = scope.get("env")
    return scope_env is not None and (not isinstance(scope_env, dict) or RUNNER_SET_VARIABLE in scope_env)


def default_shell(scope):
    """The shell a workflow's or a job's `defaults: run:` gives its steps, or None."""
    return ((scope.get("defaults") or {}).get("run") or {}).get("shell")


def may_fail_unheeded(scope):
    """Whether a job or a step may fail without failing the workflow."""
    return scope.get("continue-on-error", False) is not False


def step_flaws(step, table_path):
    """Why a step whose command names the table may not run it, or may run it to no effect; empty when it is sound."""
    flaws = []
    if step["run"].split() not in ([table_path], [f"./{table_path}"]):
        flaws.append("its step runs more than the table")
    if step.get("if") not in ALLOWED_STEP_CONDITIONS:
        flaws.append("its step's if: can skip it")
    if may_fail_unheeded(step):
        flaws.append("its step sets continue-on-error")
    if step.get("shell") is not None:
        flaws.append("its step sets shell:")
    if sets_runner_variable(step):
        flaws.append("its step's env sets CI")
    return flaws


def job_flaws(job):
    """Why a job may not run its table steps, or may run them to no effect; empty when it is sound."""
    flaws = []
    if job.get("if") is not None:
        flaws.append("its job's if: can skip it")
    if may_fail_unheeded(job):
        flaws.append("its job sets continue-on-error")
    if default_shell(job) is not None:
        flaws.append("its job's defaults set shell:")
    if sets_runner_variable(job):
        flaws.append("its job's env sets CI")
    return flaws


def workflow_flaws(workflow):
    """Why the workflow's own settings may run every table step to no effect; empty when they cannot."""
    flaws = []
    if default_shell(workflow) is not None:
        flaws.append("the workflow's defaults set shell:")
    if sets_runner_variable(workflow):
        flaws.append("the workflow's env sets CI")
    return flaws


def table_gap(table_path, jobs, flaws_of_the_workflow):
    """None when a sound step runs the table. Otherwise why none does: each flaw of every step that names it."""
    flaws_of_steps_naming_it = []
    for job in jobs.values():
        if not isinstance(job, dict):
            continue
        for step in job.get("steps") or []:
            if not isinstance(step, dict) or not isinstance(step.get("run"), str) or table_path not in step["run"]:
                continue
            flaws = step_flaws(step, table_path) + job_flaws(job) + flaws_of_the_workflow
            if not flaws:
                return None
            flaws_of_steps_naming_it += [flaw for flaw in flaws if flaw not in flaws_of_steps_naming_it]
    if not flaws_of_steps_naming_it:
        return f"no step runs {table_path}"
    return f"{table_path} has no sound step: {', '.join(flaws_of_steps_naming_it)}"


try:
    with open(workflow_path, encoding="utf-8") as workflow_file:
        workflow = yaml.safe_load(workflow_file)
except (OSError, yaml.YAMLError) as parse_error:
    print(f"cannot parse {workflow_path}: {parse_error}", file=sys.stderr)
    sys.exit(2)
jobs = workflow.get("jobs") if isinstance(workflow, dict) else None
if not isinstance(jobs, dict):
    print(f"{workflow_path} has no jobs mapping", file=sys.stderr)
    sys.exit(2)
gaps = trigger_gaps(workflow)
flaws_of_the_workflow = workflow_flaws(workflow)
for table_path in table_paths:
    gap = table_gap(table_path, jobs, flaws_of_the_workflow)
    if gap is not None:
        gaps.append(gap)
for gap in gaps:
    print(gap)
PY
}

# ways_ci_can_miss_a_table <workflow>: "none" when the workflow (relative to REPO_ROOT) runs on every push to main and
# every pull request to main, and a sound step runs every state table. A trigger may be filtered by `branches` alone, which
# must keep main. A sound step's whole command is the table (`<path>` or `./<path>`), so a step that lints, echoes or
# names a table, or runs it `|| true`, does not count. Its `if:` is absent or TABLE_STEP_RUN_ANYWAY_CONDITION, its job
# has none, and neither sets continue-on-error to anything but false. It sets no shell:, nor do its job's or the
# workflow's defaults, and no env: on its way (its own, its job's, the workflow's) sets CI. Otherwise each gap,
# separated by "; ": a trigger that can miss a run, a table no step names, or a table every step of which has a flaw,
# with each flaw. "no table matches …" over no table; "cannot read <workflow>"; and "cannot parse <workflow>". Only the
# first is ever "none".
ways_ci_can_miss_a_table() {
  local workflow_path="$REPO_ROOT/$1" ci_gaps
  local -a table_paths=() ci_gap_lines=()
  [[ -r "$workflow_path" ]] || { printf 'cannot read %s' "$1"; return; }
  mapfile -t table_paths < <(list_tables "${CI_TABLE_PATTERNS[@]}")
  (( ${#table_paths[@]} > 0 )) || { printf 'no table matches %s' "${CI_TABLE_PATTERNS[*]}"; return; }
  ci_gaps="$(ci_workflow_gaps "$workflow_path" "${table_paths[@]}")" || { printf 'cannot parse %s' "$1"; return; }
  if [[ -z "$ci_gaps" ]]; then
    printf 'none'
  else
    mapfile -t ci_gap_lines <<<"$ci_gaps"
    join_with_semicolons "${ci_gap_lines[@]}"
  fi
}

printf '\nthe count each Resource Pulse table is documented as running\n'
check "the guide states each Resource Pulse table's total" "$(tables_the_guide_misstates "$RESOURCE_PULSE_GUIDE")" none
check "a documented file that cannot be read is not a pass" \
  "$(tables_the_guide_misstates no/such/file.md)" "cannot read no/such/file.md"

printf '\nthe state tables CI runs\n'
check "CI runs on every push to main and every pull request to main, and a sound step runs every state table" \
  "$(ways_ci_can_miss_a_table "$CI_WORKFLOW")" none
check "a workflow that cannot be read is not a pass" \
  "$(ways_ci_can_miss_a_table no/such/workflow.yml)" "cannot read no/such/workflow.yml"

# ---------------------------------------------------------------------------
# The same checks on fixtures, one case each.
#
# The rows above read this repository's own guide and workflow, which hold none of the cases the filters exist for, so
# there a filter that stopped working would change nothing. Each row below builds a checkout of its own, holding one
# case, and runs the same function on it with REPO_ROOT pointed there. Each workflow row's needle names the flaw it
# plants, so only the filter that names that flaw can meet it. Each guide fixture states one table's total in prose and
# hides the other's, so the row reads both a phrase it must find and the one it must not.
# ---------------------------------------------------------------------------
FIXTURE_PARENT="$(mktemp -d)" || fatal "cannot create a directory for the fixtures"
trap 'rm -rf "$FIXTURE_PARENT"' EXIT
# Every fixture table's whole text is its total line, written by printf so this file declares no second total.
FIXTURE_TABLE_TOTAL=3
# The triggers this repository's workflow has, and a job that runs one table soundly. Each workflow fixture plants its
# case in one of them and keeps the other as it is.
FIXTURE_SOUND_TRIGGERS='on:
  push:
    branches: [main]
  pull_request:
    branches: [main]'
FIXTURE_SOUND_JOB='jobs:
  tables:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh'

# make_fixture_checkout <name> <table>…: a fresh checkout, FIXTURE_PARENT/<name>, holding each table.
make_fixture_checkout() {
  local fixture_root="$FIXTURE_PARENT/$1" table_path
  shift
  mkdir -p "$fixture_root/scripts" "$fixture_root/$(dirname "$CI_WORKFLOW")" \
    "$fixture_root/$(dirname "$RESOURCE_PULSE_GUIDE")" || fatal "cannot create the fixture checkout $fixture_root"
  for table_path in "$@"; do
    printf 'EXPECTED_ROWS=%d\n' "$FIXTURE_TABLE_TOTAL" >"$fixture_root/$table_path" ||
      fatal "cannot write the fixture table $fixture_root/$table_path"
  done
}

# write_fixture_workflow <name> <table>…: a fixture checkout holding the tables, and stdin as its workflow.
write_fixture_workflow() {
  make_fixture_checkout "$@"
  cat >"$FIXTURE_PARENT/$1/$CI_WORKFLOW" || fatal "cannot write the fixture workflow for $1"
}

# write_fixture_guide <name>: a fixture checkout holding two Resource Pulse tables, and stdin as its guide.
write_fixture_guide() {
  make_fixture_checkout "$1" scripts/test-resource-pulse-a.sh scripts/test-resource-pulse-b.sh
  cat >"$FIXTURE_PARENT/$1/$RESOURCE_PULSE_GUIDE" || fatal "cannot write the fixture guide for $1"
}

# fixture_ci_gaps <name>, fixture_guide_misstatements <name>: the CI and guide verdicts on a fixture checkout.
fixture_ci_gaps() { REPO_ROOT="$FIXTURE_PARENT/$1" ways_ci_can_miss_a_table "$CI_WORKFLOW"; }
fixture_guide_misstatements() { REPO_ROOT="$FIXTURE_PARENT/$1" tables_the_guide_misstates "$RESOURCE_PULSE_GUIDE"; }

printf '\nthe guide checker, on fixtures\n'
write_fixture_guide total-only-in-a-fence <<'MARKDOWN'
The first table, `scripts/test-resource-pulse-a.sh` (3 checks), is stated in prose.

```text
`scripts/test-resource-pulse-b.sh` (3 checks)
```
MARKDOWN
check "a total stated only inside a fenced code block is not stated" \
  "$(fixture_guide_misstatements total-only-in-a-fence)" \
  "scripts/test-resource-pulse-b.sh runs 3, the guide states no total"
# The comment opens on one line and the whole phrase is on its next, so a checker that forgets at a line break that it
# is inside a comment reads the hidden total as stated.
write_fixture_guide total-only-in-a-comment <<'MARKDOWN'
The first table, `scripts/test-resource-pulse-a.sh` (3 checks), is stated in prose.
<!-- The second, only in a comment:
`scripts/test-resource-pulse-b.sh` (3 checks) -->
MARKDOWN
check "a total stated only inside an HTML comment is not stated" \
  "$(fixture_guide_misstatements total-only-in-a-comment)" \
  "scripts/test-resource-pulse-b.sh runs 3, the guide states no total"

printf '\nthe CI checker, on fixtures: steps and jobs\n'
write_fixture_workflow run-or-true scripts/test-a.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
jobs:
  tables:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh || true
YAML
check "a table run as \`<table> || true\` is not run by a sound step" \
  "$(fixture_ci_gaps run-or-true)" "scripts/test-a.sh has no sound step: its step runs more than the table"
write_fixture_workflow may-fail-unheeded scripts/test-a.sh scripts/test-b.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
jobs:
  step-may-fail:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh
        continue-on-error: true
  job-may-fail:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - run: ./scripts/test-b.sh
YAML
check "continue-on-error, on a table's step or on its job, is not a sound step" \
  "$(fixture_ci_gaps may-fail-unheeded)" \
  "scripts/test-a.sh has no sound step: its step sets continue-on-error; scripts/test-b.sh has no sound step: its job sets continue-on-error"
write_fixture_workflow step-condition scripts/test-a.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
jobs:
  tables:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh
        if: github.event_name == 'push'
YAML
check "a table step with an if: that can skip it is not a sound step" \
  "$(fixture_ci_gaps step-condition)" "scripts/test-a.sh has no sound step: its step's if: can skip it"
write_fixture_workflow job-condition scripts/test-a.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
jobs:
  tables:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh
YAML
check "a table step in a job with an if: is not a sound step" \
  "$(fixture_ci_gaps job-condition)" "scripts/test-a.sh has no sound step: its job's if: can skip it"
write_fixture_workflow shell-override scripts/test-a.sh scripts/test-b.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
jobs:
  step-shell:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh
        shell: 'true {0}'
  job-shell:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: 'true {0}'
    steps:
      - run: ./scripts/test-b.sh
YAML
check "a shell: on a table's step, or in its job's defaults, is not a sound step" \
  "$(fixture_ci_gaps shell-override)" \
  "scripts/test-a.sh has no sound step: its step sets shell:; scripts/test-b.sh has no sound step: its job's defaults set shell:"
write_fixture_workflow ci-variable-set scripts/test-a.sh scripts/test-b.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
jobs:
  step-env:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh
        env:
          CI: ''
  job-env:
    runs-on: ubuntu-latest
    env:
      CI: ''
    steps:
      - run: ./scripts/test-b.sh
YAML
check "an env: that sets CI, on a table's step or on its job, is not a sound step" \
  "$(fixture_ci_gaps ci-variable-set)" \
  "scripts/test-a.sh has no sound step: its step's env sets CI; scripts/test-b.sh has no sound step: its job's env sets CI"
# An env: given as an expression is a string, not a mapping, and can still set CI when the run evaluates it. Its text
# holds no "CI", so only the not-a-mapping rule can flag it: `in` on a string is a substring test.
write_fixture_workflow env-not-a-mapping scripts/test-a.sh scripts/test-b.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
jobs:
  step-env:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test-a.sh
        env: \${{ fromJSON(vars.TABLE_ENV) }}
  job-env:
    runs-on: ubuntu-latest
    env: \${{ fromJSON(vars.TABLE_ENV) }}
    steps:
      - run: ./scripts/test-b.sh
YAML
check "an env: that is not a mapping, on a table's step or on its job, is not a sound step, as it may set CI" \
  "$(fixture_ci_gaps env-not-a-mapping)" \
  "scripts/test-a.sh has no sound step: its step's env sets CI; scripts/test-b.sh has no sound step: its job's env sets CI"
write_fixture_workflow workflow-settings scripts/test-a.sh <<YAML
$FIXTURE_SOUND_TRIGGERS
defaults:
  run:
    shell: 'true {0}'
env:
  CI: ''
$FIXTURE_SOUND_JOB
YAML
check "the workflow's own defaults shell: and env CI reach every table step" \
  "$(fixture_ci_gaps workflow-settings)" \
  "scripts/test-a.sh has no sound step: the workflow's defaults set shell:, the workflow's env sets CI"

printf '\nthe CI checker, on fixtures: triggers\n'
write_fixture_workflow push-only scripts/test-a.sh <<YAML
on: push
$FIXTURE_SOUND_JOB
YAML
check "a workflow that does not run on pull_request can miss a table" \
  "$(fixture_ci_gaps push-only)" "the workflow does not run on pull_request"
write_fixture_workflow paths-ignored scripts/test-a.sh <<YAML
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    paths-ignore: ['docs/**']
$FIXTURE_SOUND_JOB
YAML
check "a trigger filtered by paths-ignore can miss a table" \
  "$(fixture_ci_gaps paths-ignored)" "the workflow's pull_request trigger filters by paths-ignore"
# "maintenance" holds main as a substring, so this row also pins that branches are compared as names.
write_fixture_workflow main-left-out scripts/test-a.sh <<YAML
on:
  push:
    branches: maintenance
  pull_request:
    branches: [main]
$FIXTURE_SOUND_JOB
YAML
check "a push trigger whose branches leave out main can miss a table" \
  "$(fixture_ci_gaps main-left-out)" "the workflow's push trigger leaves out main"

# 5 the shellcheck hook + 2 the guide's totals (each table's, and a guide that cannot be read) + 2 CI (the workflow,
# and a workflow that cannot be read) + 2 the guide checker on fixtures (a fence, a comment) + 7 the CI checker on
# step and job fixtures (|| true, continue-on-error, a step if:, a job if:, shell:, env CI, an env that is not a
# mapping) + 1 the workflow's own settings + 3 its triggers (no pull_request, paths-ignore, main left out) = 22.
EXPECTED_ROWS=22

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if (( PASS + FAIL != EXPECTED_ROWS )); then
  printf '\033[1;31m✗\033[0m row total: expected %d, ran %d — a check did not run\n' \
    "$EXPECTED_ROWS" "$((PASS + FAIL))"
  FAIL=$((FAIL + 1))
fi
(( FAIL == 0 ))
