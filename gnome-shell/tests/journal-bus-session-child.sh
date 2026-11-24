#!/usr/bin/env bash
#
# gnome-shell/tests/journal-bus-session-child.sh
# ==============================================
#
# The private session's child for the sampler bus table's journal rows
# (scripts/test-resource-pulse-sampler-bus.sh, "the program on a private bus
# under the journal"), run by the table with bash on its private bus (on_private_bus):
# refuses unless its bus is the private one, starts the program in the
# background with JOURNAL_STREAM naming its stderr file (the wrapper writes the
# program's pid and exit status), waits until it serves, whatever the serving
# line's prefix, then exits, which ends the session and with it the bus.
#
# Usage: journal-bus-session-child.sh <private bus dir> <program> <fixture root> <stderr file> <pid file> \
#          <exit file> <journal stream (device:inode)> <poll seconds> <wait polls>
#
# Exit: 0 the program said it was serving; 2 the session bus is not the
#       private one; 3 the program never said it was serving.

private_bus_dir="$1" program="$2" fixture_root="$3" stderr_file="$4" pid_file="$5" exit_file="$6"
journal_stream="$7" poll_seconds="$8" wait_polls="$9"
if [[ "${DBUS_SESSION_BUS_ADDRESS:-}" != "unix:path=$private_bus_dir/"* ]]; then
  echo "refusing to run: the session bus is not the private one" >&2
  exit 2
fi
(
  env "JOURNAL_STREAM=$journal_stream" "$program" --fs-root "$fixture_root" </dev/null >/dev/null 2>"$stderr_file" &
  echo "$!" >"$pid_file"
  wait "$!"
  echo "$?" >"$exit_file"
) </dev/null >/dev/null 2>&1 &
for ((poll = 0; poll < wait_polls; poll++)); do
  rg -q -F 'resource-pulse: serving ' "$stderr_file" && exit 0
  sleep "$poll_seconds"
done
echo "the program never said it was serving" >&2
exit 3
