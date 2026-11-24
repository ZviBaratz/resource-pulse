#!/usr/bin/env bash
#
# scripts/resource-pulse-status.sh
# ================================
#
# Resource Pulse's status report: the lines a status client prints about the
# extension, its sampler service (resource-pulse.service) and its cockpit
# service (resource-pulse-cockpit.service). It only reads (the block comment below lists
# what), and runs nothing that builds, starts or changes anything.
#
# Usage: scripts/resource-pulse-status.sh
#   It prints `Resource Pulse: linked=… enabled=… state=…`, a line for each
#   setting that keeps the extension from loading, `  service: …`,
#   `  cockpit: …`, and then one `  ⚠ …` line for each fault.
#
# Exit status: 0 after its report, whatever the report says (a fault is a ⚠
# line, never a status); 2 when given any argument, with a usage line on
# stderr and nothing else run.
#
# Environment:
#   RESOURCE_PULSE_ROOT  the checkout whose scripts/resource-pulse-module-closure.sh
#     and scripts/resource-pulse-sampler-build.sh it runs. Default: the parent
#     of the directory holding this script, its own path resolved first
#     (readlink -f), so a link to the script works.
#   RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS  replaces its call limits (below).
#   HOME, XDG_CONFIG_HOME and PATH, as any user tool reads them.
#
# No set -e, set -u or pipefail: the report handles every failure itself, and
# those options would change which lines it prints.

# gsettings must use the real dconf backend even from a snap-confined terminal
# (a snap's terminal sets GIO_MODULE_DIR).
unset GIO_MODULE_DIR

rp_usage_error_status=2
# rp_usage_error: the usage line on stderr, and exit 2, before anything is asked.
rp_usage_error() {
  printf 'usage: %s\n' "${BASH_SOURCE[0]##*/}" >&2
  exit "$rp_usage_error_status"
}
# It takes no argument: any is a usage error.
(( $# == 0 )) || rp_usage_error

# The default RESOURCE_PULSE_ROOT: the parent of this script's directory, once
# a link to the script is resolved to the script itself.
rp_status_script_file="$(readlink -f "${BASH_SOURCE[0]}")"
rp_status_script_dir="${rp_status_script_file%/*}"
rp_checkout_root="${RESOURCE_PULSE_ROOT:-${rp_status_script_dir%/*}}"

# rp_has_command <name>: succeeds when the name is a command this shell can run.
# Defined before the constants, which ask it whether timeout is there.
rp_has_command() {
  command -v "$1" >/dev/null 2>&1
}

# Resource Pulse: the extension is linked into the user's extensions
# directory and enabled in GNOME Shell's enabled-extensions list; it starts its
# sampler service, resource-pulse.service (linked, never enabled), itself.
# State is the shell's own verdict (ACTIVE / ERROR / OUT OF DATE), so a silent
# failure after an update shows here. Everything below only reads: settings,
# the two units' properties, each service's GetState (under a timeout), file
# mtimes, the sampler build script's read-only questions (--check,
# --installed-path: it builds nothing then), whether the cockpit's
# config file exists, and the desktop shell's
# /proc/<pid>/stat and /proc/stat. Never an argument list or an environment,
# and no `ps`.
rp_uuid="resource-pulse@zvibaratz.github.io"
rp_extension_dir="$HOME/.local/share/gnome-shell/extensions/$rp_uuid"
rp_service_unit="resource-pulse.service"
rp_bus_name="io.github.zvibaratz.ResourcePulse1"
rp_object_path="/io/github/zvibaratz/ResourcePulse1"
# Both services answer GetState on an interface named as their bus name.
rp_get_state_method_name="GetState"
# The cockpit service (resource-pulse-cockpit.service), opt-in by its config file: under
# $XDG_CONFIG_HOME, or ~/.config when that is unset or empty, as the unit's
# ConditionPathExists (%E) and the service's GLib both look for it. The
# lines print it as ~/.config/... whichever it is.
rp_cockpit_unit="resource-pulse-cockpit.service"
# The remedies for a unit that is not installed: link its file from this
# checkout into the user's unit directory (systemd reloads itself after). --force
# replaces a stale link of the same name, left by a checkout that moved.
rp_service_link_command="systemctl --user link --force $rp_checkout_root/systemd/$rp_service_unit"
rp_cockpit_link_command="systemctl --user link --force $rp_checkout_root/systemd/$rp_cockpit_unit"
rp_cockpit_bus_name="io.github.zvibaratz.ResourcePulse.Cockpit1"
rp_cockpit_object_path="/io/github/zvibaratz/ResourcePulse/Cockpit1"
rp_cockpit_config_path="${XDG_CONFIG_HOME:-$HOME/.config}/resource-pulse/cockpit.json"
# The home directory as the lines write it: a tilde, never expanded.
rp_home_shorthand="~"
rp_cockpit_config_display_path="$rp_home_shorthand/.config/resource-pulse/cockpit.json"
# The sources GetState carries, in its order (COCKPIT_SOURCE_NAMES); each
# is stale once its last sample is older than this many of its own
# intervals (COCKPIT_SOURCE_STALE_INTERVALS in lib/constants.js).
rp_cockpit_source_names=(sessions network mounts)
rp_cockpit_stale_intervals=3
# The desktop shell runs its entry module and every module that imports, as
# this checkout's closure helper lists them; so does the cockpit
# service, whose closure is its own. The sampler is not one of
# them: it is the compiled program the build script installs, so it is
# asked of that script (--check, --installed-path), by the path it names
# and never by what the extension imports.
rp_module_closure_script="$rp_checkout_root/scripts/resource-pulse-module-closure.sh"
rp_sampler_build_script="$rp_checkout_root/scripts/resource-pulse-sampler-build.sh"
# The remedy for an installed program that is missing or not this
# checkout's: build and install it again with this checkout's build script.
rp_rebuild_command="bash $rp_sampler_build_script"
rp_shell_entry_module="extension.js"
rp_cockpit_entry_module="service/cockpit.js"
# The build script's --check exit statuses: current, not this checkout's
# (or missing), could not tell.
rp_check_current_status=0
rp_check_stale_status=1
rp_check_could_not_tell_status=2
# What `timeout` exits with when it ended its command: 124 when the command
# ended on its TERM, 137 (128 + 9) when it was killed after ignoring it.
rp_timed_out_status=124
rp_killed_status=137
# What ⚠ lines of the build script start with (two spaces, the mark, a space).
rp_build_script_warning_prefix="  ⚠ "
# gdbus's own reply timeout, and the hard bound `timeout` puts on every call
# to systemctl or gdbus, so the report never hangs on a wedged manager or bus.
rp_reply_timeout_seconds=2
rp_call_limit_seconds=3
# The bound on each call to the sampler's build script: how long --check may wait for the
# installed program's --source-hash, given to it so that the program's bound
# sits inside the call's (a program that does not answer is then named, not
# the call), and what --check needs besides: hashing the checkout's sources.
# A call still running this long after its TERM is killed.
rp_program_timeout_seconds=2
rp_hashing_margin_seconds=3
rp_build_call_limit_seconds=$(( rp_program_timeout_seconds + rp_hashing_margin_seconds ))
rp_build_call_kill_after_seconds=2
# RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS, a whole number of seconds from 1,
# replaces both limits (the state table gives its calls room on a loaded
# machine), and gdbus's reply timeout then sits a second inside the call's,
# as 2 sits inside 3, never below 1 s, so a GetState ⚠ naming the limit is
# true. Set to anything else, empty and 0 included (set is set), it is a ⚠ naming the value, and
# the default limits hold: `timeout 0` would mean no bound. Unset says nothing.
rp_positive_whole_seconds_pattern='^[1-9][0-9]*$'
rp_reply_inside_call_limit_seconds=1
rp_shortest_reply_timeout_seconds=1
rp_call_limit_override_warning=""
if [[ -n "${RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS+set}" ]]; then
  if [[ "$RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS" =~ $rp_positive_whole_seconds_pattern ]]; then
    rp_call_limit_seconds="$RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS"
    rp_build_call_limit_seconds="$RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS"
    rp_reply_timeout_seconds=$(( rp_call_limit_seconds - rp_reply_inside_call_limit_seconds ))
    (( rp_reply_timeout_seconds >= rp_shortest_reply_timeout_seconds )) \
      || rp_reply_timeout_seconds=$rp_shortest_reply_timeout_seconds
  else
    rp_default_limits_text="$rp_call_limit_seconds s for systemctl and gdbus, $rp_build_call_limit_seconds s for the build script"
    rp_call_limit_override_warning="RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS is '$RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS', not a whole number of seconds from 1, so the default limits hold ($rp_default_limits_text)"
  fi
fi
rp_call_limit=()
rp_has_command timeout && rp_call_limit=(timeout "$rp_call_limit_seconds")
# In the foreground: plain `timeout` moves
# the call into a process group of its own, which a terminal's Ctrl-C never
# reaches. What the build script starts is bounded by its own timeouts.
rp_build_call_limit=()
rp_has_command timeout && rp_build_call_limit=(timeout --foreground
  --kill-after="$rp_build_call_kill_after_seconds" "$rp_build_call_limit_seconds")
# The extension shows no data once SAMPLE_STALL_TICKS (3) × 2 s pass without a sample.
rp_stall_seconds=6
rp_usec_per_second=1000000
rp_seconds_per_minute=60
# Ages from this many seconds on are shown in minutes.
rp_minutes_from_seconds=120
# `date +%s%N` prints 10 digits of seconds, then 9 of nanoseconds; the first 16
# are microseconds. %N is sliced because uutils date ignores a %6N width.
rp_epoch_nsec_digits=19
rp_epoch_usec_digits=16
# A unit's start is read to the microsecond, in UTC: the one form systemd's
# --timestamp=us+utc prints (`Mon 2026-01-05 07:54:14.270693 UTC`, as on
# systemd 259), handed to `find -newermt` without its day name, which GNU
# find cannot read in any language but English; anything else cannot be
# read. In whole seconds, a program the deploy wrote earlier in the second
# the sampler started would read as newer (the refresh step's header says
# more). find is run as `command find`, so a shell function or alias of that
# name never answers in its place: a shell can define find as a
# function running bfs, which refuses this form.
rp_start_time_format_option="--timestamp=us+utc"
rp_start_time_pattern='^[^ ]+ [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6} UTC$'
# Why a start was not read (rp_unit_started_at's statuses): the call
# failed or did not end, or it answered something not in that form.
rp_start_unread_status=1
rp_start_not_in_form_status=2
# A backslash, the escape character of a JSON string (rp_json_string_after).
rp_backslash="\\"
rp_linked="no"; rp_enabled="no"; rp_disabled="no"; rp_state="n/a"; rp_shell_knows_it="unknown"
rp_load_hints=(); rp_warnings=()
[ -z "$rp_call_limit_override_warning" ] || rp_warnings+=("$rp_call_limit_override_warning")
# The "not running" ⚠ waits for the older-copy check, which can make it moot.
rp_not_running_warning=""; rp_runs_older_copy="no"
# Whether a ⚠ already said it cannot tell about the installed sampler
# program (--check could not tell). Its causes (HOME, the
# build script, the program's directory) are the older-program question's
# too, so that question then adds no cannot-tell of its own: one ⚠ per cause.
rp_said_cannot_tell_about_program="no"

# rp_is_whole_number <text>: succeeds when the text is one or more digits.
rp_is_whole_number() {
  [[ $1 =~ ^[0-9]+$ ]]
}

# rp_join_with_comma_space <item>...: prints the items joined by ", ", and
# nothing for no items.
rp_join_with_comma_space() {
  (( $# > 0 )) || return 0
  printf '%s' "$1"
  shift
  (( $# == 0 )) || printf ', %s' "$@"
  printf '\n'
}

# rp_first_number_after <text> <key>: the digits right after the first
# "<key>": in text. gdbus prints GetState's JSON inside a GVariant string,
# where a key's quotes stay as they are. Fails when the key is absent or
# holds no number (null). Callers pass only the top-level fields before the
# snapshot, so a field of the same name nested in it is never read. Printed
# in base 10 (10#), so leading zeros never make it octal in an arithmetic
# context: every number taken from a reply passes through here.
rp_first_number_after() {
  local text="$1" key_text="\"$2\":" after_key digits
  after_key="${text#*"$key_text"}"
  [[ "$after_key" != "$text" ]] || return 1
  digits="${after_key%%[^0-9]*}"
  [[ -n "$digits" ]] || return 1
  printf '%s\n' "$((10#$digits))"
}

# rp_age_text <seconds>: "N s", or "N min" from rp_minutes_from_seconds on.
rp_age_text() {
  if (( $1 < rp_minutes_from_seconds )); then
    printf '%s\n' "$1 s"
  else
    printf '%s\n' "$(( $1 / rp_seconds_per_minute )) min"
  fi
}

# rp_now_usec: the real time now, in microseconds; fails when date cannot say.
rp_now_usec() {
  local now_nsec
  now_nsec="$(date +%s%N 2>/dev/null)" || return 1
  rp_is_whole_number "$now_nsec" && [[ ${#now_nsec} -eq $rp_epoch_nsec_digits ]] || return 1
  printf '%s\n' "${now_nsec:0:$rp_epoch_usec_digits}"
}

# rp_started_at_epoch <pid>: when a process started, in whole seconds since
# the epoch: /proc/stat's btime plus stat field 22 (clock ticks after boot).
# Reads only those two files. Fails when either cannot be read.
rp_started_at_epoch() {
  local stat_line boot_epoch="" clock_ticks_per_second key value rest
  local -a stat_fields
  rp_is_whole_number "$1" && [[ -r "/proc/$1/stat" && -r /proc/stat ]] || return 1
  read -r stat_line <"/proc/$1/stat" || return 1
  # comm may hold spaces and ") ", so fields count from after the LAST ") ":
  # the state (field 3) is the first, the start time (field 22) the 20th,
  # at index 19.
  read -r -a stat_fields <<<"${stat_line##*) }"
  rp_is_whole_number "${stat_fields[19]}" || return 1
  while read -r key value rest; do
    if [[ "$key" == btime ]]; then boot_epoch="$value"; break; fi
  done </proc/stat
  clock_ticks_per_second="$(getconf CLK_TCK 2>/dev/null)"
  rp_is_whole_number "$boot_epoch" && rp_is_whole_number "$clock_ticks_per_second" && (( clock_ticks_per_second > 0 )) || return 1
  printf '%s\n' "$(( boot_epoch + stat_fields[19] / clock_ticks_per_second ))"
}

# rp_unescaped_gvariant_string <gdbus reply>: the reply with GVariant's string
# escapes undone, so the JSON inside reads as JSON whichever quotes gdbus
# chose. A string holding an apostrophe makes it quote with " and escape every
# " inside as \"; either way a backslash is \\. Quotes first: each escaped
# quote's backslash is the one right before it, so a \\ pair never loses half.
rp_unescaped_gvariant_string() {
  local text="$1"
  if [[ "$text" == '("'* ]]; then
    text="${text//\\\"/\"}"
  else
    text="${text//\\\'/\'}"
  fi
  printf '%s\n' "${text//\\\\/\\}"
}

# rp_first_module_changed_since <entry module> <instant>: prints the first
# module of that entry's import closure (relative to the extension dir)
# modified after that instant, given as find -newermt reads it (a unit's
# start as rp_unit_started_at prints it, or @<epoch seconds>), or nothing.
# Fails when the closure cannot be worked out or its modules cannot be
# searched: a partial answer would read as "nothing changed".
rp_first_module_changed_since() {
  local module_list changed_paths module_path first_changed_path first_changed_module
  local -a module_paths module_files=()
  module_list="$(bash "$rp_module_closure_script" "$rp_extension_dir" "$1" 2>/dev/null)" || return 1
  [[ -n "$module_list" ]] || return 1
  mapfile -t module_paths <<<"$module_list"
  # A loop, never "${module_paths[@]/#/…}": from bash 5.2 a & in that
  # replacement (a home holding one) stands for the matched text.
  for module_path in "${module_paths[@]}"; do module_files+=("$rp_extension_dir/$module_path"); done
  changed_paths="$(command find -H "${module_files[@]}" -maxdepth 0 -type f -newermt "$2" \
    -print 2>/dev/null)" || return 1
  [ -n "$changed_paths" ] || return 0
  first_changed_path="${changed_paths%%$'\n'*}"
  first_changed_module="${first_changed_path#"$rp_extension_dir"/}"
  printf '%s\n' "$first_changed_module"
}

# rp_warn_when_unit_file_is_newer <unit> <start>: adds a ⚠ when the unit's
# file changed after the unit started (the start as rp_unit_started_at
# prints it): systemd keeps the old definition until daemon-reload and a
# restart. The file is the one systemd loaded (FragmentPath, a link into the
# checkout's systemd/), and its time is the link's TARGET's (find -H follows
# it), the same strictly-after comparison the modules get. Silent when the
# path or its time cannot be read: a unit that is not linked is reported by
# the lines above.
rp_warn_when_unit_file_is_newer() {
  local unit_name="$1" fragment_path changed_unit_file unit_file_remedy
  fragment_path="$("${rp_call_limit[@]}" systemctl --user show -p FragmentPath --value "$unit_name" 2>/dev/null)" \
    || return 0
  [ -n "$fragment_path" ] || return 0
  changed_unit_file="$(command find -H "$fragment_path" -maxdepth 0 -type f -newermt "$2" -print 2>/dev/null)" \
    || return 0
  [ -n "$changed_unit_file" ] || return 0
  unit_file_remedy="systemctl --user daemon-reload && systemctl --user try-restart $unit_name"
  rp_warnings+=("$unit_name runs an older unit file: it changed after the unit started — $unit_file_remedy")
}

# rp_warn_start_cannot_be_read <unit> <what it runs> <rp_unit_started_at's
# status>: adds the ⚠ that the active unit's start cannot be read, so
# whether it runs <what it runs> ("older code or unit file") cannot be
# told, naming the call that reads the start: it could not be read at all
# (the call failed or did not end), or it is not in systemd's microsecond
# form. One wording for every unit: a could-not-tell is never silent.
rp_warn_start_cannot_be_read() {
  local unit_name="$1" what_cannot_be_told="$2" start_problem start_time_read_command
  if (( $3 == rp_start_unread_status )); then
    start_problem="its ActiveEnterTimestamp could not be read"
  else
    start_problem="its ActiveEnterTimestamp is not in systemd's microsecond form"
  fi
  start_time_read_command="systemctl --user show -p ActiveEnterTimestamp --value $rp_start_time_format_option $unit_name"
  rp_warnings+=("cannot tell when $unit_name started ($start_problem), so not whether it runs $what_cannot_be_told — $start_time_read_command")
}

# rp_find_reads_start <start>: succeeds when the find on PATH reads a
# unit's start, as rp_unit_started_at prints it, for -newermt: GNU find
# does, bfs for one does not. Asked of /, which is always there, so a
# failure is find's own and never a path's.
rp_find_reads_start() {
  command find / -maxdepth 0 -newermt "$1" >/dev/null 2>&1
}

# rp_warn_find_cannot_read_start <unit> <what it runs> <start>: adds the ⚠
# that the find on PATH cannot compare a file with the unit's start, so
# whether it runs <what it runs> cannot be told, naming the call that shows
# find's own error. Blamed on find, never on a path it was given.
rp_warn_find_cannot_read_start() {
  local unit_name="$1" what_cannot_be_told="$2" started_at="$3" find_path
  find_path="$(type -P find)" || find_path="find"
  rp_warnings+=("cannot tell whether $unit_name runs $what_cannot_be_told: $find_path cannot read its start for -newermt, as GNU find can — $find_path / -maxdepth 0 -newermt '$started_at'")
}

# rp_read_start_for_comparison <unit> <what it runs>: sets
# rp_comparable_start to the active unit's start (rp_unit_started_at) when
# files can be compared with it; otherwise adds the one cannot-tell ⚠ that
# says why not (the start cannot be read, or find cannot read it) and
# fails. Run as a plain call, never in a substitution, so its ⚠ is kept.
rp_read_start_for_comparison() {
  local unit_name="$1" what_cannot_be_told="$2" started_at start_read_status
  rp_comparable_start=""
  started_at="$(rp_unit_started_at "$unit_name")"
  start_read_status=$?
  if (( start_read_status != 0 )); then
    rp_warn_start_cannot_be_read "$unit_name" "$what_cannot_be_told" "$start_read_status"
    return 1
  fi
  if ! rp_find_reads_start "$started_at"; then
    rp_warn_find_cannot_read_start "$unit_name" "$what_cannot_be_told" "$started_at"
    return 1
  fi
  rp_comparable_start="$started_at"
}

# rp_warn_when_unit_runs_older_code <unit> <entry module>: adds a ⚠ when a
# module of the entry's import closure changed after the active unit
# started (it runs older code than the checkout), or when the closure
# cannot be worked out, and one when the unit's own file changed after the
# start (rp_warn_when_unit_file_is_newer). Without a start files can be
# compared with, the cannot-tell of rp_read_start_for_comparison instead.
rp_warn_when_unit_runs_older_code() {
  local unit_name="$1" entry_module="$2" started_at changed_file
  rp_read_start_for_comparison "$unit_name" "older code or unit file" || return 0
  started_at="$rp_comparable_start"
  rp_warn_when_unit_file_is_newer "$unit_name" "$started_at"
  if ! changed_file="$(rp_first_module_changed_since "$entry_module" "$started_at")"; then
    rp_warnings+=("cannot tell whether $unit_name runs older code: what $entry_module imports could not be worked out or searched — bash $rp_module_closure_script $rp_extension_dir $entry_module")
  elif [ -n "$changed_file" ]; then
    rp_warnings+=("$unit_name runs older code: $changed_file changed after it started — systemctl --user try-restart $unit_name")
  fi
}

# rp_unit_started_at <unit>: prints when the active unit started, to the
# microsecond, in UTC, as systemd prints it but without its day name, which
# is how find -newermt reads it (rp_start_time_pattern). Fails, printing
# nothing, without a start in that form, since the comparisons against a
# start mean nothing then: with rp_start_unread_status when the call failed
# or did not end within its limit, rp_start_not_in_form_status when it
# answered something else.
rp_unit_started_at() {
  local started_at
  started_at="$("${rp_call_limit[@]}" systemctl --user show -p ActiveEnterTimestamp --value \
    "$rp_start_time_format_option" "$1" 2>/dev/null)" || return "$rp_start_unread_status"
  [[ "$started_at" =~ $rp_start_time_pattern ]] || return "$rp_start_not_in_form_status"
  printf '%s\n' "${started_at#* }"
}

# rp_absence_is_certain <path>: succeeds when a path that tests as not there
# truly is not: the deepest of the directories on its way that exists can be
# searched (or is no directory at all), so the test failed on a name that is
# not there, never on a permission. The same rule as the refresh script's
# absence_is_certain, so the two cannot disagree.
rp_absence_is_certain() {
  local deepest_existing_ancestor="$1"
  while [[ "$deepest_existing_ancestor" == */* && "$deepest_existing_ancestor" != / ]]; do
    deepest_existing_ancestor="${deepest_existing_ancestor%/*}"
    # The directory of /<name> is /.
    deepest_existing_ancestor="${deepest_existing_ancestor:-/}"
    [[ ! -e "$deepest_existing_ancestor" ]] || break
  done
  [[ -e "$deepest_existing_ancestor" && ( ! -d "$deepest_existing_ancestor" || -x "$deepest_existing_ancestor" ) ]]
}

# rp_installed_program_changed_since <start> <program file>: the comparison
# "the installed program is newer than the unit's start" (the start as
# rp_unit_started_at prints it), as the refresh script's
# installed_program_changed_since makes it. Prints the
# file when it was modified after that start; prints nothing when it was
# not, or is not there (never installed is not newer). A link is read as
# what it names, as systemd runs what it names; a link to nothing is not
# there. Fails when whether it is there, or its time, cannot be read:
# behind a directory that cannot be searched, through a link too.
rp_installed_program_changed_since() {
  local started_at="$1" program_file="$2"
  # A link is left to find -H, which reads one to nothing as the link
  # itself (so not there) and fails when what it names cannot be examined:
  # rp_absence_is_certain looks at the directories on the path it is given,
  # never at those on a link's target.
  if [[ ! -e "$program_file" && ! -L "$program_file" ]]; then
    rp_absence_is_certain "$program_file"
    return
  fi
  command find -H "$program_file" -maxdepth 0 -type f -newermt "$started_at" -print 2>/dev/null
}

# rp_run_build_script <flag> [option...]: the sampler's build script in that
# mode, its bound the build call limit, from this checkout. Leaves its
# stdout and stderr together in rp_build_script_output, how long it took in
# rp_build_script_took_seconds, and returns its exit status
# (rp_timed_out_status or rp_killed_status when it did not end within the
# limit; 127 when it cannot be run at all).
rp_run_build_script() {
  local build_script_status started_at_seconds=$SECONDS
  rp_build_script_output="$("${rp_build_call_limit[@]}" bash "$rp_sampler_build_script" "$@" 2>&1)"
  build_script_status=$?
  rp_build_script_took_seconds=$(( SECONDS - started_at_seconds ))
  return "$build_script_status"
}

# rp_build_call_ran_out <status>: succeeds when the last build-script call
# (its exit status, and rp_build_script_took_seconds) ended on its limit:
# timeout's two statuses are a time-out only when the call took as long as
# the limit, so a build script that exits 124 at once did not run out.
rp_build_call_ran_out() {
  (( ($1 == rp_timed_out_status || $1 == rp_killed_status)
    && rp_build_script_took_seconds >= rp_build_call_limit_seconds ))
}

# rp_build_call_ran_out_text <call>: what a call (its mode and any option)
# that ran out of its limit says, the limit included.
rp_build_call_ran_out_text() {
  printf '%s\n' "bash $rp_sampler_build_script $1 did not end within $rp_build_call_limit_seconds s"
}

# rp_build_script_could_not_be_asked_text <status> <call>: why a call to the
# build script gave no answer of the three it has, from its exit status. The
# call is its mode and any option, as the line names them.
rp_build_script_could_not_be_asked_text() {
  if rp_build_call_ran_out "$1"; then
    rp_build_call_ran_out_text "$2"
  else
    printf '%s\n' "bash $rp_sampler_build_script $2 could not be run, or answered with status $1"
  fi
}

# rp_warn_when_sampler_program_is_not_this_checkouts: adds a ⚠ about the
# installed sampler program, whatever state the unit is in (a program that
# is missing is exactly why the unit is failed). Silent only when --check
# says the program is current; a call that cannot answer, runs out of time
# or answers anything but 0, 1 or 2 is "cannot tell", never silence, and
# sets rp_said_cannot_tell_about_program.
rp_warn_when_sampler_program_is_not_this_checkouts() {
  local cannot_tell_prefix="cannot tell whether the installed sampler program is this checkout's:"
  local build_script_status check_line
  rp_run_build_script --check --program-timeout-seconds "$rp_program_timeout_seconds"
  build_script_status=$?
  check_line="${rp_build_script_output#"$rp_build_script_warning_prefix"}"
  case "$build_script_status" in
    "$rp_check_current_status") ;;
    "$rp_check_stale_status")
      rp_warnings+=("$check_line — run $rp_rebuild_command") ;;
    "$rp_check_could_not_tell_status")
      rp_warnings+=("$cannot_tell_prefix $check_line")
      rp_said_cannot_tell_about_program="yes" ;;
    *)
      rp_warnings+=("$cannot_tell_prefix $(rp_build_script_could_not_be_asked_text "$build_script_status" --check)")
      rp_said_cannot_tell_about_program="yes" ;;
  esac
}

# rp_read_installed_program_path: sets rp_installed_program to the path the
# build script's --installed-path names, bounded as every call to it is:
# its stdout alone (its stderr is never read as part of a path), and only
# when that is exactly one absolute line. Fails otherwise (the call fails,
# does not end within the limit, or prints anything else), leaving
# rp_installed_path_ran_out "yes" when the call ran out of its limit
# (rp_build_call_ran_out). Run as a plain call, never in a substitution,
# so what it sets is kept.
rp_read_installed_program_path() {
  local path_output path_status started_at_seconds=$SECONDS
  rp_installed_program=""; rp_installed_path_ran_out="no"
  path_output="$("${rp_build_call_limit[@]}" bash "$rp_sampler_build_script" --installed-path 2>/dev/null)"
  path_status=$?
  rp_build_script_took_seconds=$(( SECONDS - started_at_seconds ))
  if (( path_status != 0 )); then
    if rp_build_call_ran_out "$path_status"; then rp_installed_path_ran_out="yes"; fi
    return 1
  fi
  [[ "$path_output" == /* && "$path_output" != *$'\n'* ]] || return 1
  rp_installed_program="$path_output"
}

# rp_warn_when_sampler_runs_older_program: adds a ⚠ when the installed
# program (or the unit's own file) changed after the active sampler started,
# which then runs an older program than the one installed. A start that
# cannot be read, or that find cannot read, is "cannot tell", as the
# refresh step warns; so is a program it cannot be compared with (no path
# known, or the program behind a directory that cannot be searched),
# unless a ⚠ already said it cannot tell about the installed program
# (rp_said_cannot_tell_about_program): one ⚠ per cause. The remedy is the
# same try-restart the refresh step makes.
rp_warn_when_sampler_runs_older_program() {
  local started_at installed_program changed_program installed_path_problem
  rp_read_start_for_comparison "$rp_service_unit" "an older program or unit file" || return 0
  started_at="$rp_comparable_start"
  rp_warn_when_unit_file_is_newer "$rp_service_unit" "$started_at"
  if ! rp_read_installed_program_path; then
    if [ "$rp_said_cannot_tell_about_program" != "yes" ]; then
      # The call to run by hand; one that ran out of its limit says which.
      installed_path_problem="bash $rp_sampler_build_script --installed-path"
      [ "$rp_installed_path_ran_out" = "no" ] || installed_path_problem="$(rp_build_call_ran_out_text --installed-path)"
      rp_warnings+=("cannot tell whether $rp_service_unit runs an older program: where it is installed is not known — $installed_path_problem")
    fi
    return 0
  fi
  installed_program="$rp_installed_program"
  if ! changed_program="$(rp_installed_program_changed_since "$started_at" "$installed_program")"; then
    [ "$rp_said_cannot_tell_about_program" = "yes" ] ||
      rp_warnings+=("cannot tell whether $rp_service_unit runs an older program: $installed_program, or a directory on its way, cannot be searched")
  elif [ -n "$changed_program" ]; then
    rp_warnings+=("$rp_service_unit runs an older program: the installed one changed after it started — systemctl --user try-restart $rp_service_unit (its histories start again)")
  fi
}

# rp_call_get_state <bus name> <object path>: the service's GetState reply,
# its GVariant string escapes undone, so the JSON in it reads as JSON.
# Fails when it does not answer within rp_call_limit_seconds.
rp_call_get_state() {
  local bus_name="$1" object_path="$2" state_reply
  state_reply="$("${rp_call_limit[@]}" gdbus call --session --dest "$bus_name" \
    --object-path "$object_path" --method "$bus_name.$rp_get_state_method_name" \
    --timeout "$rp_reply_timeout_seconds" 2>/dev/null)" || return 1
  rp_unescaped_gvariant_string "$state_reply"
}

# rp_json_string_after <JSON text> <key>: the string value of the first
# "<key>":"…" in the text, with JSON's \" \\ and \/ undone and any other
# escape left as written. Fails when the key is absent, holds no string
# (null), or the string does not end.
rp_json_string_after() {
  local text="$1" key_text="\"$2\":\"" after_key string_value="" character
  local -i character_index=0
  after_key="${text#*"$key_text"}"
  [[ "$after_key" != "$text" ]] || return 1
  while (( character_index < ${#after_key} )); do
    character="${after_key:character_index:1}"
    if [[ "$character" == '"' ]]; then
      printf '%s\n' "$string_value"
      return 0
    fi
    if [[ "$character" == "$rp_backslash" ]]; then
      (( character_index++ ))
      character="${after_key:character_index:1}"
      case "$character" in
        '"' | "$rp_backslash" | '/') ;;
        *) string_value+="$rp_backslash" ;;
      esac
    fi
    string_value+="$character"
    (( character_index++ ))
  done
  return 1
}

# rp_describe_running_service: asks the active service for GetState and sets
# rp_service_line ("active, protocol 1, last sample 1 s ago"), adding a ⚠
# line when it does not answer within rp_call_limit_seconds or its last
# sample is more than rp_stall_seconds old (compared in microseconds, as the
# extension does; the age shown is in whole seconds).
rp_describe_running_service() {
  local state_reply top_level_fields protocol_version latest_sampled_at_usec now_usec age_usec age_seconds
  local sample_text
  if ! rp_has_command gdbus; then
    rp_service_line="active (gdbus not found, so not asked)"
    return 0
  fi
  if ! state_reply="$(rp_call_get_state "$rp_bus_name" "$rp_object_path")"; then
    rp_service_line="active, no answer"
    rp_warnings+=("$rp_service_unit is active but did not answer GetState within $rp_call_limit_seconds s — journalctl --user -u $rp_service_unit -e")
    return 0
  fi
  # The service writes protocol, its times and the sequence before the
  # snapshot (lib/protocol.js buildStatePayload): only that part is read.
  top_level_fields="${state_reply%%\"snapshot\":*}"
  protocol_version="$(rp_first_number_after "$top_level_fields" protocol)" || protocol_version="unknown"
  if latest_sampled_at_usec="$(rp_first_number_after "$top_level_fields" latestSampledAtUsec)"; then
    if now_usec="$(rp_now_usec)"; then
      age_usec=$(( now_usec - latest_sampled_at_usec ))
      (( age_usec < 0 )) && age_usec=0
      age_seconds=$(( age_usec / rp_usec_per_second ))
      sample_text="last sample $(rp_age_text "$age_seconds") ago"
      if (( age_usec > rp_stall_seconds * rp_usec_per_second )); then
        rp_warnings+=("$rp_service_unit has not sampled for over $rp_stall_seconds s (the last $(rp_age_text "$age_seconds") ago), so the extension shows no data — journalctl --user -u $rp_service_unit -e")
      fi
    else
      sample_text="last sample at a time date cannot compare"
    fi
  elif [[ "$top_level_fields" == *'"latestSampledAtUsec":'* ]]; then
    sample_text="no sample yet"
  else
    sample_text="last sample not reported (a service from before it was)"
  fi
  rp_service_line="active, protocol $protocol_version, $sample_text"
}

# rp_cockpit_source_is_stale <sources JSON> <source name> <now usec>:
# succeeds when that source's last sample is older than
# rp_cockpit_stale_intervals of its own intervals. The service writes each
# source's sampledAtUsec and intervalSeconds first in its object
# (lib/cockpitProtocol.js), so they are read between "<name>":{ and the
# next brace, and a field of another source is never read. A source the
# JSON does not carry (an older service), or one not stamped, is not stale.
rp_cockpit_source_is_stale() {
  local sources_text="$1" anchor_text="\"$2\":{" now_usec="$3" after_anchor source_timing_fields
  local sampled_at_usec interval_seconds stale_after_usec
  after_anchor="${sources_text#*"$anchor_text"}"
  [[ "$after_anchor" != "$sources_text" ]] || return 1
  source_timing_fields="${after_anchor%%[\{\}]*}"
  sampled_at_usec="$(rp_first_number_after "$source_timing_fields" sampledAtUsec)" || return 1
  interval_seconds="$(rp_first_number_after "$source_timing_fields" intervalSeconds)" || return 1
  stale_after_usec=$(( rp_cockpit_stale_intervals * interval_seconds * rp_usec_per_second ))
  (( now_usec - sampled_at_usec > stale_after_usec ))
}

# rp_describe_running_cockpit: asks the active cockpit service for GetState
# and sets rp_cockpit_line ("active, protocol 1, last publish 4 s ago,
# stale: none"), naming each stale source. Adds a ⚠ when it does not answer
# within rp_call_limit_seconds, and one quoting GetState's configError when
# it carries one. The service writes protocol and its times before the
# layout and the sources (lib/cockpitProtocol.js buildCockpitStatePayload),
# and configError before the sources: those are read from the part before
# "sources" only.
rp_describe_running_cockpit() {
  local state_reply top_level_fields sources_text protocol_version latest_published_at_usec now_usec=""
  local publish_age_usec publish_age_seconds publish_age_text publish_text stale_text stale_source_list source_name
  local config_error
  local -a stale_source_names=()
  if ! rp_has_command gdbus; then
    rp_cockpit_line="active (gdbus not found, so not asked)"
    return 0
  fi
  if ! state_reply="$(rp_call_get_state "$rp_cockpit_bus_name" "$rp_cockpit_object_path")"; then
    rp_cockpit_line="active, no answer"
    rp_warnings+=("$rp_cockpit_unit is active but did not answer GetState within $rp_call_limit_seconds s — $rp_cockpit_journal_hint")
    return 0
  fi
  top_level_fields="${state_reply%%\"sources\":*}"
  sources_text=""
  [[ "$top_level_fields" != "$state_reply" ]] && sources_text="${state_reply#*\"sources\":}"
  protocol_version="$(rp_first_number_after "$top_level_fields" protocol)" || protocol_version="unknown"
  now_usec="$(rp_now_usec)" || now_usec=""
  if ! latest_published_at_usec="$(rp_first_number_after "$top_level_fields" latestPublishedAtUsec)"; then
    publish_text="last publish not reported"
  elif [[ -z "$now_usec" ]]; then
    publish_text="last publish at a time date cannot compare"
  else
    publish_age_usec=$(( now_usec - latest_published_at_usec ))
    (( publish_age_usec < 0 )) && publish_age_usec=0
    publish_age_seconds=$(( publish_age_usec / rp_usec_per_second ))
    publish_age_text="$(rp_age_text "$publish_age_seconds")"
    publish_text="last publish $publish_age_text ago"
  fi
  if [[ -z "$now_usec" ]]; then
    stale_text="stale: not known (date cannot say the time)"
  else
    for source_name in "${rp_cockpit_source_names[@]}"; do
      rp_cockpit_source_is_stale "$sources_text" "$source_name" "$now_usec" && stale_source_names+=("$source_name")
    done
    stale_source_list="$(rp_join_with_comma_space "${stale_source_names[@]}")"
    stale_text="stale: ${stale_source_list:-none}"
  fi
  rp_cockpit_line="active, protocol $protocol_version, $publish_text, $stale_text"
  if config_error="$(rp_json_string_after "$top_level_fields" configError)"; then
    rp_warnings+=("cockpit: config invalid: $config_error — fix $rp_cockpit_config_display_path; the service rereads it when it changes")
  fi
}

[ -e "$rp_extension_dir" ] && rp_linked="yes"
# Read from the setting itself: `gnome-extensions list --enabled` omits an
# extension the shell does not know yet, which said enabled=no until the first
# login after linking.
case "$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null)" in
  *"'$rp_uuid'"*) rp_enabled="yes" ;;
esac
case "$(gsettings get org.gnome.shell disabled-extensions 2>/dev/null)" in
  *"'$rp_uuid'"*) rp_disabled="yes" ;;
esac
if rp_has_command gnome-extensions; then
  rp_state="$(gnome-extensions info "$rp_uuid" 2>/dev/null | sed -n 's/^ *State: *//p')"
  if [ -n "$rp_state" ]; then rp_shell_knows_it="yes"; else rp_shell_knows_it="no"; fi
  rp_state="${rp_state:-not known to the shell (log out / in after linking)}"
fi
# Asked for but not running: name the settings that keep GNOME 50 from loading
# it. With the user dir skipped the shell does not know the extension at all.
if [ "$rp_enabled" = "yes" ] && [ "$rp_state" != "ACTIVE" ]; then
  if [ "$rp_disabled" = "yes" ]; then
    rp_load_hints+=("disabled-extensions also lists it, and wins in GNOME 50: it does not load until it is removed from that list")
  fi
  if [ "$(gsettings get org.gnome.shell allow-extension-installation 2>/dev/null)" = "false" ]; then
    rp_load_hints+=("allow-extension-installation is false: GNOME 50 skips ~/.local/share/gnome-shell/extensions, where it is linked")
  fi
  if [ "$(gsettings get org.gnome.shell disable-user-extensions 2>/dev/null)" = "true" ]; then
    rp_load_hints+=("disable-user-extensions is true: GNOME loads no user extension")
  fi
fi
rp_enabled_text="$rp_enabled"
if [ "$rp_enabled" = "yes" ] && [ "$rp_shell_knows_it" = "no" ] && (( ${#rp_load_hints[@]} == 0 )); then
  rp_enabled_text="yes (starts at next login)"
fi
printf '%s\n' "Resource Pulse: linked=$rp_linked enabled=$rp_enabled_text state=$rp_state"
for rp_hint in "${rp_load_hints[@]}"; do printf '%s\n' "  $rp_hint"; done

# The sampler service. Failed, or restarting after an unplanned end (one no
# stop asked for: under Restart=always a failure or a clean exit alike), is
# always a ⚠; anything else not running is one while the extension should be
# running it: enabled, not also disabled, and known to the shell (before the
# first login after linking it has not run yet, so a service not started yet
# is no fault). The refresh step only warns, never failing the
# install, so this is where a missing, stopped, stalled or out-of-date
# service shows.
# Each state names its own remedy: a unit not found (never linked)
# needs linking, and only a loaded, inactive one is started.
rp_extension_runs_it="no"
if [ "$rp_enabled" = "yes" ] && [ "$rp_disabled" = "no" ] && [ "$rp_shell_knows_it" != "no" ]; then
  rp_extension_runs_it="yes"
fi
rp_load_state=""; rp_service_state=""; rp_sub_state=""
if rp_has_command systemctl &&
  rp_unit_properties="$("${rp_call_limit[@]}" systemctl --user show -p LoadState -p ActiveState -p SubState \
    "$rp_service_unit" 2>/dev/null)"; then
  while IFS= read -r rp_unit_property; do
    case "$rp_unit_property" in
      LoadState=*) rp_load_state="${rp_unit_property#LoadState=}" ;;
      ActiveState=*) rp_service_state="${rp_unit_property#ActiveState=}" ;;
      SubState=*) rp_sub_state="${rp_unit_property#SubState=}" ;;
    esac
  done <<<"$rp_unit_properties"
fi
rp_journal_hint="journalctl --user -u $rp_service_unit -e"
if [ -z "$rp_load_state" ] || [ -z "$rp_service_state" ]; then
  rp_service_line="unknown (no systemd user manager answered)"
elif [ "$rp_load_state" = "not-found" ]; then
  rp_service_line="not installed (LoadState=not-found)"
  [ "$rp_extension_runs_it" = "yes" ] &&
    rp_warnings+=("$rp_service_unit is not installed, so the extension cannot start it — link it: $rp_service_link_command")
elif [ "$rp_load_state" != "loaded" ]; then
  rp_service_line="cannot load (LoadState=$rp_load_state)"
  [ "$rp_extension_runs_it" = "yes" ] &&
    rp_warnings+=("$rp_service_unit cannot load (LoadState=$rp_load_state) — systemctl --user status $rp_service_unit")
else
  case "$rp_service_state" in
    active) rp_describe_running_service ;;
    failed)
      rp_service_line="failed (not running)"
      rp_warnings+=("$rp_service_unit failed — $rp_journal_hint") ;;
    inactive)
      rp_service_line="inactive (not running)"
      [ "$rp_extension_runs_it" = "yes" ] &&
        rp_not_running_warning="$rp_service_unit is not running while the extension is enabled, so it shows no data — systemctl --user start $rp_service_unit" ;;
    *)
      if [ "$rp_sub_state" = "auto-restart" ]; then
        rp_service_line="$rp_service_state (auto-restart: restarting after an unplanned end)"
        rp_warnings+=("$rp_service_unit is restarting after an unplanned end — $rp_journal_hint")
      else
        rp_service_line="$rp_service_state ($rp_sub_state)"
        [ "$rp_extension_runs_it" = "yes" ] &&
          rp_warnings+=("$rp_service_unit is $rp_service_state ($rp_sub_state), not serving yet — $rp_journal_hint")
      fi ;;
  esac
fi
printf '%s\n' "  service: $rp_service_line"
# Data side: the sampler is the program the build script installs. Whether
# that is this checkout's is asked while the unit is linked, in whatever
# state it is in (a missing program is why it is failed); that the
# active sampler runs an older program than the installed one is asked
# while it is active and linked, as the unit file's age is.
if [ "$rp_linked" = "yes" ]; then
  rp_warn_when_sampler_program_is_not_this_checkouts
  if [ "$rp_service_state" = "active" ]; then
    rp_warn_when_sampler_runs_older_program
  fi
fi

# The cockpit service, resource-pulse-cockpit.service: linked, never
# enabled, and opt-in by its config file. While
# ~/.config/resource-pulse/cockpit.json (or that file under
# $XDG_CONFIG_HOME, when it is set) is absent its ConditionPathExists
# makes systemd skip every start: loaded, inactive, ConditionResult=no, and
# no fault. LoadState is read first (a unit not found is inactive too), and
# the file itself is tested as well: a unit never started also reads
# ConditionResult=no (systemd's default before any check), so that state is
# "skipped" only while the file is absent. The file plays the part the
# extension being enabled plays for the sampler: with it, a cockpit not
# running or not installed is a ⚠. Each form and its remedy:
#   skipped (no ~/.config/resource-pulse/cockpit.json)  not opted in; none.
#   active, protocol 1, last publish 4 s ago, stale: none  (or stale:
#     sessions, mounts): from GetState. The last publish is the latest
#     Changed, or the start, so a quiet service's can be long ago, which is
#     no fault. A source is stale once its last sample is older than
#     rp_cockpit_stale_intervals of its own intervals.
#   active, no answer / failed (not running) / activating (auto-restart:
#     restarting after a failure)  always a ⚠ naming its journal.
#   inactive (not running)  a ⚠ to start it while the file exists.
#   activating (start), or any other state  a ⚠ naming its journal while
#     the file exists.
#   not installed (LoadState=not-found)  a ⚠ to link it while the
#     file exists; cannot load (LoadState=…) one to read its status.
#   unknown (no systemd user manager answered)  none.
# GetState's configError ("missing" when the file vanished while the
# service runs, the parser's text when it is malformed) is a ⚠ to fix the
# file, which the service rereads when it changes. A module service/cockpit.js
# runs (it and what it imports) changed after it started is a ⚠
# that it runs older code; one it does not run (the shell's alone) is not.
rp_cockpit_load_state=""; rp_cockpit_active_state=""; rp_cockpit_sub_state=""; rp_cockpit_condition_result=""
if rp_has_command systemctl &&
  rp_cockpit_unit_properties="$("${rp_call_limit[@]}" systemctl --user show -p LoadState -p ActiveState \
    -p SubState -p ConditionResult "$rp_cockpit_unit" 2>/dev/null)"; then
  while IFS= read -r rp_unit_property; do
    case "$rp_unit_property" in
      LoadState=*) rp_cockpit_load_state="${rp_unit_property#LoadState=}" ;;
      ActiveState=*) rp_cockpit_active_state="${rp_unit_property#ActiveState=}" ;;
      SubState=*) rp_cockpit_sub_state="${rp_unit_property#SubState=}" ;;
      ConditionResult=*) rp_cockpit_condition_result="${rp_unit_property#ConditionResult=}" ;;
    esac
  done <<<"$rp_cockpit_unit_properties"
fi
rp_cockpit_opted_in="no"
[ -e "$rp_cockpit_config_path" ] && rp_cockpit_opted_in="yes"
rp_cockpit_journal_hint="journalctl --user -u $rp_cockpit_unit -e"
if [ -z "$rp_cockpit_load_state" ] || [ -z "$rp_cockpit_active_state" ]; then
  rp_cockpit_line="unknown (no systemd user manager answered)"
elif [ "$rp_cockpit_load_state" = "not-found" ]; then
  rp_cockpit_line="not installed (LoadState=not-found)"
  [ "$rp_cockpit_opted_in" = "yes" ] &&
    rp_warnings+=("$rp_cockpit_unit is not installed though $rp_cockpit_config_display_path exists — link it: $rp_cockpit_link_command")
elif [ "$rp_cockpit_load_state" != "loaded" ]; then
  rp_cockpit_line="cannot load (LoadState=$rp_cockpit_load_state)"
  [ "$rp_cockpit_opted_in" = "yes" ] &&
    rp_warnings+=("$rp_cockpit_unit cannot load (LoadState=$rp_cockpit_load_state) — systemctl --user status $rp_cockpit_unit")
else
  case "$rp_cockpit_active_state" in
    active) rp_describe_running_cockpit ;;
    failed)
      rp_cockpit_line="failed (not running)"
      rp_warnings+=("$rp_cockpit_unit failed — $rp_cockpit_journal_hint") ;;
    inactive)
      if [ "$rp_cockpit_opted_in" = "yes" ]; then
        rp_cockpit_line="inactive (not running)"
        rp_warnings+=("$rp_cockpit_unit is not running though $rp_cockpit_config_display_path exists — systemctl --user start $rp_cockpit_unit")
      elif [ "$rp_cockpit_condition_result" = "no" ]; then
        rp_cockpit_line="skipped (no $rp_cockpit_config_display_path)"
      else
        rp_cockpit_line="inactive (not running)"
      fi ;;
    *)
      if [ "$rp_cockpit_sub_state" = "auto-restart" ]; then
        rp_cockpit_line="$rp_cockpit_active_state (auto-restart: restarting after a failure)"
        rp_warnings+=("$rp_cockpit_unit is restarting after a failure — $rp_cockpit_journal_hint")
      else
        rp_cockpit_line="$rp_cockpit_active_state ($rp_cockpit_sub_state)"
        [ "$rp_cockpit_opted_in" = "yes" ] &&
          rp_warnings+=("$rp_cockpit_unit is $rp_cockpit_active_state ($rp_cockpit_sub_state), not serving yet — $rp_cockpit_journal_hint")
      fi ;;
  esac
fi
printf '%s\n' "  cockpit: $rp_cockpit_line"
if [ "$rp_cockpit_active_state" = "active" ] && [ "$rp_linked" = "yes" ]; then
  rp_warn_when_unit_runs_older_code "$rp_cockpit_unit" "$rp_cockpit_entry_module"
fi
# Drawing side: the shell loads the extension's JS once per login, so a
# module it runs (extension.js and what it imports) changed after
# the desktop's gnome-shell started is not what runs. A lib/ module only the
# service imports does not count, and neither does the stylesheet: GNOME
# re-reads it at every enable. The oldest gnome-shell of this
# user is the desktop's (a nested test shell is younger); pgrep prints pids
# only. Whole seconds: a change within the second the shell started also warns.
if [ "$rp_linked" = "yes" ] && [ "$rp_extension_runs_it" = "yes" ] && [ "$rp_shell_knows_it" = "yes" ] &&
  rp_has_command pgrep; then
  rp_shell_pid="$(pgrep -o -x -u "$UID" gnome-shell 2>/dev/null)"
  if rp_shell_started_at="$(rp_started_at_epoch "$rp_shell_pid")"; then
    if ! rp_changed_file="$(rp_first_module_changed_since "$rp_shell_entry_module" "@$rp_shell_started_at")"; then
      rp_warnings+=("cannot tell whether the desktop runs an older copy: what $rp_shell_entry_module imports could not be worked out or searched — bash $rp_module_closure_script $rp_extension_dir $rp_shell_entry_module")
    elif [ -n "$rp_changed_file" ]; then
      rp_runs_older_copy="yes"
      rp_warnings+=("the desktop runs an older copy; takes effect at next login ($rp_changed_file changed after this login)")
    fi
  fi
fi
# Until the next login the desktop may run an older copy of the extension, one
# that need not start the service: while it runs an older copy, a service not
# running is no fault of its own to report.
if [ -n "$rp_not_running_warning" ] && [ "$rp_runs_older_copy" = "no" ]; then
  rp_warnings+=("$rp_not_running_warning")
fi
for rp_warning in "${rp_warnings[@]}"; do printf '%s\n' "  ⚠ $rp_warning"; done

exit 0
