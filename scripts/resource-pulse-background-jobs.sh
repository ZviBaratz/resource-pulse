#!/usr/bin/env bash
# shellcheck shell=bash
#
# scripts/resource-pulse-background-jobs.sh
# =========================================
#
# Background jobs, signals and the question for --source-hash, for the Resource Pulse sampler program's
# build step (scripts/resource-pulse-sampler-build.sh): a command run in the background and waited for, so that a
# trapped signal reaches it; the build step's signal traps, and the EXIT trap that ends a background job in flight; and
# a bounded question to a program for its --source-hash. Why each is so: the build script's header ("Signals").
#
# Sourced, never run: by the build script, from its own directory, into its own shell, and never in a subshell or a
# command substitution, since the EXIT trap reads `$!` and BACKGROUND_JOB_IS_RUNNING, which only that shell holds.
# Sourcing it defines names and gives its variables their first values, and does nothing else: it sets no trap (the
# build script calls arm_signal_traps), and creates and runs nothing.
#
# What the script that sources it provides: remove_files_of_the_run, which the EXIT trap (clean_up_on_exit) calls to
# remove the files of the run, defined before anything can exit; and timeout, sleep and kill. What it reads from here:
# KILL_AFTER_SECONDS and TIMED_OUT_STATUS (for its own bounded build), and the question's answer and statuses
# (SOURCE_HASH_ANSWER, SOURCE_HASH_QUESTION_FAILED). Its rows are scripts/test-resource-pulse-sampler-build.sh's: the
# signal rows run these traps, and one row runs a copy of the build script without this file beside it.

# After a timeout's TERM, how long a process gets before it is killed; also how long the EXIT trap waits for an ended
# background job's process group to be gone, before its KILL and again after it.
KILL_AFTER_SECONDS=5
# The status `timeout` exits with when it ended the command.
TIMED_OUT_STATUS=124
# The conventional exit statuses after SIGHUP, SIGINT, SIGQUIT and SIGTERM (128 + the signal's number).
HANGUP_EXIT_STATUS=129
INTERRUPT_EXIT_STATUS=130
QUIT_EXIT_STATUS=131
TERMINATE_EXIT_STATUS=143
# How often a process group that was told to end is looked at, while waiting for it to be gone.
PROCESS_GROUP_POLL_INTERVAL_SECONDS=0.1
PROCESS_GROUP_POLLS_PER_SECOND=10
# The shape of a hash, as --source-hash prints it.
SOURCE_HASH_PATTERN='^[0-9a-f]{64}$'
# What ask_for_source_hash returns when the answer is no hash: the program failed (as one from before the flag does), or
# it printed something else. It returns 0 for a hash and TIMED_OUT_STATUS for no answer in time.
SOURCE_HASH_QUESTION_FAILED=1
SOURCE_HASH_ANSWER_IS_NOT_A_HASH=2
# The hash the last question received; empty unless it returned 0. The build script reads it (probe_program).
SOURCE_HASH_ANSWER=""
# 1 from just before a background job is started until its wait returns: the EXIT trap then ends the job.
BACKGROUND_JOB_IS_RUNNING=0
# What `$!` named just before the job was started (empty for nothing). A process substitution sets `$!` too, so the EXIT
# trap ends a job only when `$!` has moved on from this: a signal that comes before the job's `&` finds no job to end,
# and never ends what an earlier `$!` named, which by then may be another process.
BACKGROUND_PROCESS_ID_BEFORE_JOB=""

# ask_for_source_hash <bound in seconds> <program command...>: asks the program for its --source-hash (the flag follows
# the command's own words) within the bound, and KILLs it KILL_AFTER_SECONDS after a TERM it ignores. Sets
# SOURCE_HASH_ANSWER and returns 0 when it printed a hash; otherwise returns TIMED_OUT_STATUS,
# SOURCE_HASH_QUESTION_FAILED or SOURCE_HASH_ANSWER_IS_NOT_A_HASH. A bounded command substitution: a trapped signal that
# comes during it is acted on when it returns.
ask_for_source_hash() {
  local bound_seconds="$1" answer answer_status
  shift
  SOURCE_HASH_ANSWER=""
  answer="$(timeout --kill-after="$KILL_AFTER_SECONDS" "$bound_seconds" "$@" --source-hash 2>/dev/null)"
  answer_status=$?
  if (( answer_status == TIMED_OUT_STATUS )); then return "$TIMED_OUT_STATUS"; fi
  if (( answer_status != 0 )); then return "$SOURCE_HASH_QUESTION_FAILED"; fi
  [[ "$answer" =~ $SOURCE_HASH_PATTERN ]] || return "$SOURCE_HASH_ANSWER_IS_NOT_A_HASH"
  # shellcheck disable=SC2034 # the build script reads it (probe_program), never this file
  SOURCE_HASH_ANSWER="$answer"
}

# run_in_background_and_wait <command...>: runs the command in the background, waits for it and returns its exit status.
# The caller's redirections, and the assignments written before the call, reach the command. In the background because
# `timeout` puts what it runs in a process group of its own (setpgid(0, 0) without --foreground: GNU coreutils' does, and
# uutils' 0.10.0 too), which a terminal's Ctrl-C never reaches, and bash acts on a trapped signal only once its
# foreground command has ended; a `wait` returns at once on one, and the EXIT trap then ends the job
# (end_background_job_in_flight). That trap runs inside the caller's redirections (the build's log, a namer's listing
# and its stderr file), which is harmless while it writes nothing.
run_in_background_and_wait() {
  local job_status
  BACKGROUND_PROCESS_ID_BEFORE_JOB="${!:-}"
  BACKGROUND_JOB_IS_RUNNING=1
  "$@" &
  wait "$!"
  job_status=$?
  BACKGROUND_JOB_IS_RUNNING=0
  return "$job_status"
}

# Three of the functions below run only from the EXIT trap. shellcheck does not always count that trap as a call, so each
# of the three carries the same directive (its code differs by shellcheck version).

# wait_for_process_group_to_end <process group id>: succeeds once no process of the group is left, looking every
# PROCESS_GROUP_POLL_INTERVAL_SECONDS; fails when some are still there after KILL_AFTER_SECONDS. (The group's leader is
# this script's child; bash reaps it while `sleep` runs, so its exit does not linger as a zombie in the group.)
# shellcheck disable=SC2317,SC2329 # run only from the EXIT trap (see above)
wait_for_process_group_to_end() {
  local poll_round
  for (( poll_round = 0; poll_round < KILL_AFTER_SECONDS * PROCESS_GROUP_POLLS_PER_SECOND; poll_round++ )); do
    kill -0 -- "-$1" 2>/dev/null || return 0
    sleep "$PROCESS_GROUP_POLL_INTERVAL_SECONDS"
  done
  return 1
}

# end_background_job_in_flight: when a background job is running, sends TERM to its whole process group, and to the job's
# own process in case the signal came before that process made its group; waits up to KILL_AFTER_SECONDS for the group
# to be gone, then sends KILL to what is left and waits as long again. Bounded, so an exit never waits on a job for long.
# (Both GNU's and uutils' `timeout` also pass a TERM on to their group and then apply their --kill-after; this does not
# rely on that.)
# shellcheck disable=SC2317,SC2329 # run only from the EXIT trap (see above)
end_background_job_in_flight() {
  # Read before anything else, so that nothing in this function can move it on; unset until something ran in the
  # background (hence the default, under set -u).
  local job_process_id="${!:-}"
  (( BACKGROUND_JOB_IS_RUNNING == 1 )) || return 0
  [[ -n "$job_process_id" && "$job_process_id" != "$BACKGROUND_PROCESS_ID_BEFORE_JOB" ]] || return 0
  kill -TERM -- "-$job_process_id" "$job_process_id" 2>/dev/null
  wait_for_process_group_to_end "$job_process_id" && return 0
  kill -KILL -- "-$job_process_id" "$job_process_id" 2>/dev/null
  wait_for_process_group_to_end "$job_process_id"
}

# ignore_terminating_signals: HUP, INT, QUIT and TERM are ignored from here on: by the EXIT trap, so that a second Ctrl-C
# cannot cut it short, and by a script that has begun its last words, so that it ends with their status.
ignore_terminating_signals() { trap '' HUP INT QUIT TERM; }

# clean_up_on_exit: the EXIT trap: ends a background job still running and removes the files of the run (the script's own
# remove_files_of_the_run), with further signals ignored. Bounded.
# shellcheck disable=SC2317,SC2329 # run only from the EXIT trap (see above)
clean_up_on_exit() {
  ignore_terminating_signals
  end_background_job_in_flight
  remove_files_of_the_run
}

# arm_signal_traps: a HUP, INT, QUIT or TERM exits with 129, 130, 131 or 143, and the EXIT trap (clean_up_on_exit), which
# runs on every other exit too, ends a background job in flight and removes the files of the run.
arm_signal_traps() {
  trap clean_up_on_exit EXIT
  trap 'exit "$HANGUP_EXIT_STATUS"' HUP
  trap 'exit "$INTERRUPT_EXIT_STATUS"' INT
  trap 'exit "$QUIT_EXIT_STATUS"' QUIT
  trap 'exit "$TERMINATE_EXIT_STATUS"' TERM
}
