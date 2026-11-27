#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2034  # Its constants are read by the tables that source it, never here.
#
# scripts/resource-pulse-check-table-lib.sh
# =========================================
#
# The stand-ins of the nested harness's window, pointer and check cockpit rows, shared by
# scripts/test-resource-pulse-nested-check.sh and scripts/test-resource-pulse-nested-signals.sh: a busctl that answers
# the in-shell requests from a directory of answers, a gjs that stands in for the probe window, the healthy answers, the
# live run the rows act on (CHECK_RUN) with a fake gnome-shell of its own, and the helpers that run the script against
# them (check_stub_run, check_stub_sourced, check_cockpit_stubbed) and read what they left.
#
# Sourced, never run, after scripts/resource-pulse-table-lib.sh (and its start_table) and
# scripts/resource-pulse-nested-table-lib.sh, whose names it reads. Sourcing it only defines names and creates nothing.
# Each table then calls start_check_stand_ins, once, after start_nested_harness: it names the check's paths, installs
# the stand-ins, writes the healthy answers and starts the check's fake gnome-shell.
#
# Usage, in a table, after start_table:
#   source the nested table library, then:
#   CHECK_TABLE_LIB="$HERE/resource-pulse-check-table-lib.sh"
#   # shellcheck source=SCRIPTDIR/resource-pulse-check-table-lib.sh
#   source "$CHECK_TABLE_LIB" || fatal "cannot source $CHECK_TABLE_LIB"
#   start_nested_harness
#   start_check_stand_ins

if [[ "$(type -t start_nested_harness)" != function ]]; then
  printf '\033[1;31mFATAL\033[0m: source scripts/resource-pulse-nested-table-lib.sh before %s\n' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

# window, pointer and check cockpit drive a live run's nested shell through the
# requests of the in-shell files (each with its own plain-gjs rows,
# gnome-shell/tests/cockpitCheck.test.js). Here a stand-in busctl answers each
# request from a directory of answers (ok unless a case's file says otherwise,
# for the request, for its Nth call, or for the window it names by pid, by the title the run recorded for it) and,
# for the Nth click, appends <answers>/click-N.log to the run's shell log, as the extension's focus lines would be,
# and for a request's first call <answers>/<function>.<request>.log; it keeps a copy of the run's fixture as each
# request last saw it (CHECK_CALLS.fixture.<request>), and answers GetState with <answers>/GetState (the replay's state
# JSON), or fails while <answers>/GetState.fails exists; it answers the layer's requests itself, where no file of their
# own does, from a model of the extension's cockpit subscription (described in its source: held whatever is seen, so
# a layout given back is heard at the next request); a stand-in gjs stands in for the
# window (it records how it was started and waits); the real jq rewrites the
# run's fixture. A fake gnome-shell in this session makes the run live.
# What check_stub_run adds to the caller's environment for one case: empty but for the window's.
CHECK_STUB_CALLER_DECOYS=()
CHECK_OK_ANSWER='{"verdict":"ok","detail":"as the stand-in answers"}'
# The run directory check_stub_run and check_stub_sourced name to the script (RESOURCE_PULSE_NESTED_DIR); empty, they
# name none. A row sets it to CHECK_RUN for the calls that act on that run, and empties it after.
CHECK_STUB_RUN_DIR=""
# check_cockpit_stubbed's two switches, each set by a row for one call: CHECK_STUB_RESTORE_FAILS=1 makes every put-back
# of the run's fixture fail, and CHECK_STUB_OVERRIDES holds definitions the check's bash evaluates last.
CHECK_STUB_RESTORE_FAILS=""
CHECK_STUB_OVERRIDES=""
# The busctl stand-in's source; it reads where to answer from, record and append from its environment.
read -r -d '' CHECK_BUSCTL_STAND_IN_SOURCE <<'STAND_IN'
#!/bin/bash
# Stands in for busctl in the check rows: answers each Eval of the in-shell files from $CHECK_STUB_ANSWERS.
eval_code="${!#}"
if [[ "$*" == *" Screenshot "* ]]; then
  printf 'Screenshot %s\n' "${eval_code##*/}" >>"$CHECK_STUB_CALLS"
  printf '%s\n' '{"type":"bs","data":[true,"stand-in"]}'
  exit 0
fi
# GetState of the replay: recorded with its name, path and interface (the three words after `call`).
if [[ "$eval_code" == GetState ]]; then
  call_words=("$@")
  for word_index in "${!call_words[@]}"; do
    [[ "${call_words[word_index]}" == call ]] && call_word_index=$word_index
  done
  printf 'GetState %s %s %s\n' "${call_words[call_word_index+1]}" "${call_words[call_word_index+2]}" \
    "${call_words[call_word_index+3]}" >>"$CHECK_STUB_CALLS"
  if [[ -f "$CHECK_STUB_ANSWERS/GetState.fails" ]]; then
    printf 'Call failed: The name is not activatable\n' >&2
    exit 1
  fi
  jq -cn --rawfile state "$CHECK_STUB_ANSWERS/GetState" '{type: "s", data: [($state | rtrimstr("\n"))]}'
  exit 0
fi
call_line="$(printf '%s\n' "$eval_code" | tail -n 1)"
function_name="${call_line%%(*}"
request="${call_line#*\(\'}"
request="${request%%\'*}"
printf '%s %s\n' "$function_name" "$request" >>"$CHECK_STUB_CALLS"
call_options="${call_line#*\', }"
call_options="${call_options%);}"
printf '%s %s %s\n' "$function_name" "$request" "$call_options" >>"$CHECK_STUB_CALLS.options"
if [[ "$function_name" == resourcePulseNestedPointer && "$request" == click ]]; then
  click_number="$(grep -c -x -F 'resourcePulseNestedPointer click' "$CHECK_STUB_CALLS")"
  if [[ -f "$CHECK_STUB_ANSWERS/click-$click_number.log" ]]; then
    cat "$CHECK_STUB_ANSWERS/click-$click_number.log" >>"$CHECK_STUB_SHELL_LOG"
  fi
fi
answer_path="$CHECK_STUB_ANSWERS/$function_name.$request"
# The Nth call of a request may have an answer of its own: <function>.<request>.<N>.
request_number="$(grep -c -x -F "$function_name $request" "$CHECK_STUB_CALLS")"
if [[ "$request_number" == 1 && -f "$answer_path.log" ]]; then
  cat "$answer_path.log" >>"$CHECK_STUB_SHELL_LOG"
fi
if [[ -n "${RESOURCE_PULSE_NESTED_DIR:-}" ]]; then
  cp -- "$RESOURCE_PULSE_NESTED_DIR/state/cockpit-fixture.json" "$CHECK_STUB_CALLS.fixture.$request" 2>/dev/null
fi
# A request naming a window by pid may have an answer of its own for that window: <function>.<request>.<title>.
call_pid=""
[[ "$call_options" =~ \"pid\":([0-9]+) ]] && call_pid="${BASH_REMATCH[1]}"
call_title=""
for window_record in "${RESOURCE_PULSE_NESTED_DIR:-/nonexistent}"/state/windows/*.pid; do
  [[ -n "$call_pid" && -f "$window_record" && "$(<"$window_record")" == "$call_pid" ]] || continue
  call_title="${window_record##*/}"
  call_title="${call_title%.pid}"
done
if [[ -f "$answer_path.$request_number" ]]; then
  answer_path+=".$request_number"
elif [[ -n "$call_title" && -f "$answer_path.$call_title" ]]; then
  answer_path+=".$call_title"
elif [[ ! -f "$answer_path" ]]; then
  answer_path="$CHECK_STUB_ANSWERS/default"
fi
answer_text="$(<"$answer_path")"
# The extension's cockpit subscription, as extension.js enable and cockpitClient.js setSubscriptionWanted keep it,
# for the layer's requests (layer-placement, grid-geometry, layer-removed), which it answers itself where no answer
# file of their own names them: the client hears every Changed, whatever is seen, so what the run's fixture serves is
# heard at the next request; a state heard with a layout draws the layer (but with <answers>/layer-not-redrawn a layer
# taken away is never drawn again), one with none takes it away. The dropdown opens or closes only on an ok answer,
# and reads nothing. It begins afresh at a run's first request, keeps its state in $CHECK_STUB_CALLS.extension, and
# writes how it stood at each request, before the request acts, to $CHECK_STUB_CALLS.extension-log: "<request>
# layer=<shown|gone> dropdown=<open|closed>".
if [[ "$function_name" == resourcePulseCockpitCheck ]]; then
  extension_state_path="$CHECK_STUB_CALLS.extension"
  layer=shown dropdown=closed served=layout
  if (( $(wc -l <"$CHECK_STUB_CALLS") > 1 )) && [[ -f "$extension_state_path" ]]; then
    source "$extension_state_path"
  else
    : >"$CHECK_STUB_CALLS.extension-log"
  fi
  hear_served_state() {
    if [[ "$served" == none ]]; then
      layer=gone
    elif [[ "$layer" == shown || ! -f "$CHECK_STUB_ANSWERS/layer-not-redrawn" ]]; then
      layer=shown
    fi
  }
  served_now="$(jq -r 'if .state.layout == null then "none" else "layout" end' \
    "${RESOURCE_PULSE_NESTED_DIR:-/nonexistent}/state/cockpit-fixture.json" 2>/dev/null)" || served_now="$served"
  # The service publishes a Changed when what it serves changed, and the client, always subscribed, hears it.
  if [[ "$served_now" != "$served" ]]; then
    served="$served_now"
    hear_served_state
  fi
  printf '%s layer=%s dropdown=%s\n' "$request" "$layer" "$dropdown" >>"$CHECK_STUB_CALLS.extension-log"
  answer_verdict="$(jq -r '.verdict // empty' <<<"$answer_text" 2>/dev/null)"
  if [[ "$request" == dropdown-open && "$answer_verdict" == ok && "$dropdown" == closed ]]; then
    dropdown=open
  elif [[ "$request" == dropdown-close && "$answer_verdict" == ok ]]; then
    dropdown=closed
  fi
  if [[ "$answer_path" == "$CHECK_STUB_ANSWERS/default" ]]; then
    case "$request:$layer" in
      layer-placement:gone | grid-geometry:gone)
        answer_text="$(jq -cn \
          --arg detail 'no cockpit layer: the grid is not drawn (look for "could not draw the cockpit layer")' \
          '{verdict: "bad", detail: $detail}')" ;;
      layer-removed:shown)
        answer_text='{"verdict":"bad","detail":"the extension still holds a cockpit layer"}' ;;
    esac
  fi
  printf 'layer=%s\ndropdown=%s\nserved=%s\n' "$layer" "$dropdown" "$served" >"$extension_state_path"
fi
jq -cn --arg answer "$answer_text" '{type: "bs", data: [true, $answer]}'
STAND_IN
# Under env -i no variable can name where to record: the paths are written into its source.
# shellcheck disable=SC2016  # The stand-in's own source: its values expand when it runs.
{
  CHECK_WINDOW_VALUES_LINE='printf "%%s\\n" "XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR-unset}"'
  CHECK_WINDOW_VALUES_LINE+=' "DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS-unset}"'
  CHECK_WINDOW_VALUES_LINE+=' "WAYLAND_DISPLAY=${WAYLAND_DISPLAY-unset}" "GDK_BACKEND=${GDK_BACKEND-unset}" >%q\n'
}
# check_window_stand_in_source <launches> <env names> <env values> <block> <lifetime seconds> <registry> prints the
# probe window's stand-in gjs: it registers itself as one of the table's stand-ins (its pid, its own path), records how
# it was started, then waits until signalled, for its lifetime at most.
check_window_stand_in_source() {
  # shellcheck disable=SC2016  # The stand-in's own source: its $$, $0 and $* expand when it runs.
  printf '#!/bin/bash\n# Stands in for the probe window: records how it was started, then waits until signalled.\nprintf "%%s %%s -\\n" "$$" "$0" >>%q\nprintf "%%s\\n" "$*" >>%q\ncompgen -e | LC_ALL=C sort >%q\n'"$CHECK_WINDOW_VALUES_LINE"'read -r -t %q _ <>%q\n' \
    "$6" "$1" "$2" "$3" "$5" "$4"
}
# The nested shell's monotonic clock, as the stand-in answers it: it never moves.
CHECK_CLOCK_USEC=1800000000000
# The replay's state as GetState answers it, its snapshot's two rankings two entries each (apps-rows gives their names
# to the in-shell request); and a state from a replay before the rankings, its winners alone.
CHECK_REPLAY_CPU_RANKING='[{"groupKey":"app.slice/chromium","name":"Chromium","cpuPercent":30},'
CHECK_REPLAY_CPU_RANKING+='{"groupKey":"app.slice/herdr-server.service","name":"herdr agents","cpuPercent":7.5}]'
CHECK_REPLAY_MEMORY_RANKING='[{"groupKey":"app.slice/herdr-server.service","name":"herdr agents","memoryBytes":16857746636},'
CHECK_REPLAY_MEMORY_RANKING+='{"groupKey":"app.slice/chromium","name":"Chromium","memoryBytes":4509715660}]'
CHECK_REPLAY_WINNERS='"topCpu":{"groupKey":"app.slice/chromium","name":"Chromium","cpuPercent":30},'
CHECK_REPLAY_WINNERS+='"topMemory":{"groupKey":"app.slice/herdr-server.service","name":"herdr agents","memoryBytes":16857746636}'
CHECK_REPLAY_STATE_WITHOUT_RANKINGS="{\"protocol\":1,\"sequence\":3,\"snapshot\":{\"apps\":{$CHECK_REPLAY_WINNERS}}}"
CHECK_REPLAY_APPS_OPTIONS='{"cpuNames":["Chromium","herdr agents"],"memoryNames":["herdr agents","Chromium"]}'
# answers_with <name> <file name> <answer>... copies the healthy answers to a directory of its own, replaces those
# named, and prints the directory.
answers_with() {
  local answers_dir="$WIRING_TMP/check-answers-$1"
  if ! mkdir -p "$answers_dir" || ! cp "$CHECK_ANSWERS"/* "$answers_dir/"; then
    fatal "cannot lay out $answers_dir"
  fi
  shift
  while (( $# > 1 )); do
    printf '%s\n' "$2" >"$answers_dir/$1"
    shift 2
  done
  printf '%s' "$answers_dir"
}
# check_stub_sourced <answers dir> <function> <args...> sources the script and calls one of its functions against the
# stand-ins, with its waits skipped (sleep does nothing), on CHECK_STUB_RUN_DIR; leaves CHECK_STUB_OUTPUT and
# CHECK_STUB_EXIT.
check_stub_sourced() {
  local answers_dir="$1"
  shift
  : >"$CHECK_CALLS"
  : >"$CHECK_CALL_OPTIONS"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  CHECK_STUB_OUTPUT="$(env "${LIVE_SETTINGS_BARRIER[@]}" RESOURCE_PULSE_NESTED_DIR="$CHECK_STUB_RUN_DIR" \
    PATH="$CHECK_STUB_BIN:$PATH" CHECK_STUB_ANSWERS="$answers_dir" CHECK_STUB_CALLS="$CHECK_CALLS" \
    CHECK_STUB_SHELL_LOG="$CHECK_RUN/log/shell.log" bash -c '
      source "$1" || exit 99
      shift
      sleep() { :; }
      "$@"
    ' check-sourced "$NESTED_SCRIPT" "$@" 2>&1)"
  CHECK_STUB_EXIT=$?
}
# make_check_run <fixture: yes or no> [more run values...] lays out the live run the check rows act on.
make_check_run() {
  local with_fixture="$1"
  shift
  rm -rf "$CHECK_RUN"
  # shellcheck disable=SC2154  # test_session_id is the nested table library's, read by its start_nested_harness.
  make_run_dir "$CHECK_RUN" "supervisor=$$" "supervisor-starttime=$(starttime_of "$$")" "session=$test_session_id" \
    "gnome-shell=$check_fake_shell_pid" "gnome-shell-starttime=$(starttime_of "$check_fake_shell_pid")" \
    "cockpit=$$" "cockpit-starttime=$(starttime_of "$$")" "$@"
  mkdir -p "$CHECK_RUN/log" "$CHECK_RUN/run" "$CHECK_RUN/shots" || fatal "cannot lay out $CHECK_RUN"
  printf '%s\n' "unix:path=$CHECK_RUN/bus/session.sock,guid=0123456789abcdef" >"$CHECK_RUN/state/session.addr"
  printf '%s\n' 'gnome-shell started' >"$CHECK_RUN/log/shell.log"
  if [[ "$with_fixture" == yes ]]; then
    nested_call write_run_cockpit_fixture "$CHECK_RUN" 3600 1800000000000000 || fatal "cannot write $CHECK_RUN's fixture"
  fi
  : >"$CHECK_WINDOW_LAUNCHES"
}
# check_stub_run <answers dir> <subcommand args...> runs the script against the stand-ins; leaves CHECK_STUB_OUTPUT and
# CHECK_STUB_EXIT.
check_stub_run() {
  local answers_dir="$1"
  shift
  : >"$CHECK_CALLS"
  : >"$CHECK_CALL_OPTIONS"
  CHECK_STUB_OUTPUT="$(env -u RESOURCE_PULSE_NESTED_DIR "${LIVE_SETTINGS_BARRIER[@]}" "${CHECK_STUB_CALLER_DECOYS[@]}" \
    ${CHECK_STUB_RUN_DIR:+RESOURCE_PULSE_NESTED_DIR="$CHECK_STUB_RUN_DIR"} PATH="$CHECK_STUB_BIN:$PATH" \
    CHECK_STUB_ANSWERS="$answers_dir" CHECK_STUB_CALLS="$CHECK_CALLS" CHECK_STUB_SHELL_LOG="$CHECK_RUN/log/shell.log" \
    RESOURCE_PULSE_NESTED_BASE="$NESTED_BASE" bash "$NESTED_SCRIPT" "$@" 2>&1)"
  CHECK_STUB_EXIT=$?
}
check_stub_call_count() { grep -c "$1" "$CHECK_CALLS"; }
# check_cockpit_stubbed <answers dir> [again] runs `check cockpit` with sleep and perf stubbed, on a fresh run, or,
# with again, on the run as the last pass left it (another pass in the same run). CHECK_STUB_RESTORE_FAILS=1 makes
# every put-back of the run's fixture fail; CHECK_STUB_OVERRIDES holds definitions the child evaluates last (a case's
# own stand-ins for the script's functions). Leaves CHECK_STUB_OUTPUT and CHECK_STUB_EXIT.
check_cockpit_stubbed() {
  [[ "${2:-}" == again ]] || make_check_run yes gc-log=1 replay=1
  : >"$CHECK_CALLS"
  : >"$CHECK_CALL_OPTIONS"
  # shellcheck disable=SC2016  # Expanded by the child bash.
  CHECK_STUB_OUTPUT="$(env "${LIVE_SETTINGS_BARRIER[@]}" RESOURCE_PULSE_NESTED_DIR="$CHECK_RUN" \
    PATH="$CHECK_STUB_BIN:$PATH" CHECK_STUB_ANSWERS="$1" CHECK_STUB_CALLS="$CHECK_CALLS" \
    CHECK_STUB_SHELL_LOG="$CHECK_RUN/log/shell.log" CHECK_STUB_RESTORE_FAILS="${CHECK_STUB_RESTORE_FAILS:-}" \
    CHECK_STUB_OVERRIDES="${CHECK_STUB_OVERRIDES:-}" bash -c '
      source "$1" || exit 99
      sleep() { :; }
      run_perf_for_check_cockpit() {
        printf "perf: PASS: every count within its budget\nperf: cockpit: PASS: as the stand-in judges\n"
      }
      if [[ -n "$CHECK_STUB_RESTORE_FAILS" ]]; then
        restore_run_cockpit_fixture() { return 1; }
      fi
      eval "$CHECK_STUB_OVERRIDES"
      check_cockpit_subcommand
    ' check-cockpit "$NESTED_SCRIPT" 2>&1)"
  CHECK_STUB_EXIT=$?
}
# check_step_verdicts <step...> prints each step's verdict in the last output: <step>:ok, :bad, :unjudged or :none.
check_step_verdicts() {
  local step_name step_line
  local -a step_verdicts=()
  for step_name in "$@"; do
    step_line="$(grep -E "^(ok|bad|could not judge) $step_name: " <<<"$CHECK_STUB_OUTPUT")"
    case "$step_line" in
      'ok '*) step_verdicts+=("$step_name:ok") ;;
      'bad '*) step_verdicts+=("$step_name:bad") ;;
      'could not judge '*) step_verdicts+=("$step_name:unjudged") ;;
      *) step_verdicts+=("$step_name:none") ;;
    esac
  done
  printf '%s' "${step_verdicts[*]}"
}

# write_healthy_check_answers writes the answers the busctl stand-in gives when a case names no answer of its own:
# every request ok, and the requests that answer with a value of their own (the window count, the clock, the first
# session row's point, the provoked focus lines, the replay's state).
write_healthy_check_answers() {
  printf '%s\n' "$CHECK_OK_ANSWER" >"$CHECK_ANSWERS/default"
  printf '%s\n' '{"verdict":"ok","detail":"0 normal windows","count":0}' \
    >"$CHECK_ANSWERS/resourcePulseCockpitCheck.window-count"
  printf '%s\n' "{\"verdict\":\"ok\",\"detail\":\"the clock\",\"monotonicUsec\":$CHECK_CLOCK_USEC}" \
    >"$CHECK_ANSWERS/resourcePulseCockpitCheck.monotonic-time"
  printf '%s\n' '{"verdict":"ok","detail":"the first session row","x":1480,"y":132,"sessionId":"w1:p1","name":"alpha-sync","tooltipText":"alpha-sync"}' \
    >"$CHECK_ANSWERS/resourcePulseCockpitCheck.session-row-point"
  # The focus lines the third click (candidates matching no window) and the fifth (not focused) provoke.
  printf '%s\n' '(gnome-shell:7): Gjs-Console-WARNING **: 10:00:02.000: resource-pulse: cockpit: focus: no window for pids [4194305]' \
    >"$CHECK_ANSWERS/click-3.log"
  printf '%s\n' '(gnome-shell:7): Gjs-Console-WARNING **: 10:00:03.000: resource-pulse: cockpit: focus: herdr-unreachable' \
    >"$CHECK_ANSWERS/click-5.log"
  printf '%s\n' "{\"protocol\":1,\"sequence\":3,\"snapshot\":{\"apps\":{$CHECK_REPLAY_WINNERS,\"cpuRanking\":$CHECK_REPLAY_CPU_RANKING,\"memoryRanking\":$CHECK_REPLAY_MEMORY_RANKING}}}" \
    >"$CHECK_ANSWERS/GetState"
}

# start_check_stand_ins: what a check table runs once, after start_nested_harness. In order, it
#   1. names the check's paths in WIRING_TMP (the stand-ins' directory, the answers, the call logs, the window's
#      records and its fifo) and CHECK_RUN, the live run the rows act on, under the nested base;
#   2. makes the answers' directory and the window's fifo, and installs the busctl and gjs stand-ins;
#   3. writes the healthy answers (write_healthy_check_answers);
#   4. starts the check's fake gnome-shell (start_long_lived_fake_shell), whose pid make_check_run records as the
#      run's gnome-shell, in check_fake_shell_pid.
# A second call, or a call before start_nested_harness, stops the table with exit 2.
start_check_stand_ins() {
  [[ -n "${NESTED_BASE:-}" ]] || fatal "start_nested_harness runs before start_check_stand_ins"
  [[ -z "${CHECK_RUN:-}" ]] || fatal "start_check_stand_ins runs once per table, and CHECK_RUN is already set"
  CHECK_STUB_BIN="$WIRING_TMP/check-bin"
  CHECK_ANSWERS="$WIRING_TMP/check-answers"
  CHECK_CALLS="$WIRING_TMP/check-calls"
  # Each in-shell request with its options as one JSON object, one per line: "<function> <request> <options>". The
  # stand-in writes it beside CHECK_CALLS, whose path it is given.
  CHECK_CALL_OPTIONS="$CHECK_CALLS.options"
  CHECK_WINDOW_BLOCK="$WIRING_TMP/check-window-block"
  CHECK_WINDOW_LAUNCHES="$WIRING_TMP/check-window-launches"
  CHECK_WINDOW_ENV_NAMES="$WIRING_TMP/check-window-env-names"
  # The values the window's isolation rests on, as the stand-in saw them: its runtime dir, bus, display and backend.
  CHECK_WINDOW_ENV_VALUES="$WIRING_TMP/check-window-env-values"
  CHECK_RUN="$NESTED_BASE/rpn.CheckRn1"
  CHECK_RUN_FIXTURE="$CHECK_RUN/state/cockpit-fixture.json"
  if ! mkdir -p "$CHECK_ANSWERS" || ! mkfifo "$CHECK_WINDOW_BLOCK"; then
    fatal "cannot lay out the check's stand-ins"
  fi
  install_stub "$CHECK_STUB_BIN" busctl "$CHECK_BUSCTL_STAND_IN_SOURCE"
  install_stub "$CHECK_STUB_BIN" gjs "$(check_window_stand_in_source "$CHECK_WINDOW_LAUNCHES" "$CHECK_WINDOW_ENV_NAMES" \
    "$CHECK_WINDOW_ENV_VALUES" "$CHECK_WINDOW_BLOCK" "$STAND_IN_LIFETIME_SECONDS" "$TABLE_STAND_IN_REGISTRY")"
  write_healthy_check_answers
  start_long_lived_fake_shell
  check_fake_shell_pid=$LONG_LIVED_FAKE_SHELL_PID
}
