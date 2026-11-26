# Changelog

All notable changes to Resource Pulse are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `scripts/resource-pulse-nested.sh start --no-cockpit` starts no cockpit service, so the nested shell draws only the
  desktop card, and starts a stand-in for systemd in its place, which answers the extension's `StartUnit` as a
  default install with no cockpit does: the cockpit's start skipped, never retried. `perf` on such a run measures the
  card alone: the same states and count budgets, no grid in any state, the grid's budgets not judged, and the
  fallback timers judged, since the cover check's is the card's own. `check cockpit` refuses it. The replay service
  and the stand-in share one guard that keeps each to its run's private bus.
- `scripts/resource-pulse-nested.sh start --monitor-scale <scale>` puts the nested monitor at a scale, from 1 to
  4, as its mode lists them (fractional ones too), through a monitor config in the run's own config home. `start`
  stops a run that is not at the scale asked for, naming the scales the mode takes. The stage is the size over the
  scale, and `check cockpit`'s pointer rest point and `perf`'s header follow it. The replay's idle input is now CPU
  0.2–1.5 %, under one device pixel of the top bar's graph at any scale up to 4: at 1–4 % a scaled top bar drew
  every Sample, so a covered card at idle input broke its frame budget at scale 2.
- While the sampler publishes its pressure history, each resource has a pressure strip under the traces, on their
  five minutes: 30 cells of 10 s, each the highest band of its five Samples, amber from 25 %, and blank only where
  none of the five has a reading. Each meter stands beside its strip, and the time axis runs under the strips.
  Without that history the axis closes the traces and the meters stand in a row at the bottom. Both forms are the
  same size.

### Changed

- The cockpit service's budget with a watch held is now under 0.15% of one core with about 40 sessions, from
  0.1%. It read 0.132% with 38 sessions, and the guide says where that goes. Without a watch the budget stays under
  0.05%; it read 0.030%.
- The desktop card is drawn in a compact form: a five-minute trace each for CPU and memory, the heaviest app by each
  on its trace's label line, the figures now in a column beside the traces, and the three pressure meters. The
  dropdown's card and the cockpit's system cell draw the same card. It is 286 px high at the default text size,
  where it was about 158, so the dropdown is taller by the same. The "heaviest" line and the memory bar are gone:
  each trace names its heaviest app.
- A gap in a trace, a Sample with no reading, is hatched, never bridged. A condition the machine is in is drawn
  amber: a pressure meter and its percentage from 25 % of `avg10`, and the "+ X on disk" line while swap on disk
  grows by 1 MiB or more over 10 s.
- The card's text follows GNOME's text size and the shell's font, so the card grows with them: its text, the
  padding at its sides, its column of figures and, where the memory figure's lines need the room, its traces'
  height. The plots' width, the strips and the gaps between its parts stay fixed.
- A row of the cockpit grid is never shorter than the system card at the default text size, so the template's
  least work area is 1274 × 644, where it was 1274 × 636, and a layout of three rows needs 952 px of height,
  where it needed 940. A 1280 × 720 panel still draws the template, under its top bar too.

## [0.1.11] - 2026-11-26

### Changed

- The update restarts the cockpit service once, since its sessions source changed.

### Added

- The cockpit service keeps an hour of each Claude session's state, a cell a minute, and publishes it in each session
  row as `stateHistory`: one letter a minute, the oldest first, the current minute last. A minute with no sample
  repeats the cell before it. A history belongs to a pane and its Claude session id, lives only as long as the
  service, and is kept while herdr is not running. No card draws it yet. An extension older than this ignores the
  field, and this one reads a service older than it as publishing no history. The nested harness's fixture gives
  every session a history.

## [0.1.10] - 2026-11-26

### Changed

- The histories count time, not ticks: a stall or a suspend shows in the graphs at its real width, as one gap for
  each 2 s tick missed, at most the whole five minutes, where it was one gap or none. The stall is counted on the
  tick grid and the suspend on `CLOCK_BOOTTIME`. Each Sample that appends says how many ticks it missed
  (`appendedHistory.missedTickCount`, protocol 1), and the extension widens its own gap to match; from a sampler
  that does not say, it keeps its one gap. An update restarts the sampler once.

## [0.1.9] - 2026-11-26

### Changed

- The sessions card and the dropdown order the sessions by urgency, so a session waiting on you is never hidden
  behind a session that is not waiting on you: first those waiting on you, the longest wait first; then those
  working, the largest memory first; then done, idle and unknown, each the most recently active first. A session
  missing the one value its group is ordered by (memory for working, idle age for the others) goes last in that
  group. The cockpit service still publishes them by memory, so an extension older than this release draws what it
  drew. The nested harness's `check cockpit` asks the card for its first sessions by urgency.

## [0.1.8] - 2026-11-26

### Changed

- CPU is drawn in a brighter teal, `#30adc4`, and memory in a brighter purple, `#a85fc9`, in the top-bar graphs and
  on the card, wherever it is drawn (on the desktop, in the dropdown, and in the cockpit's system cell), in place of
  `#2190a4`, which read slightly grey, and `#9141ac`, which was dark on the card's surface. The apps card's bars stay
  neutral. A working session and a VPN that is up take the same teal.
- The card and every cockpit card have a new surface: a dark vertical gradient with a faint highlight along the top
  edge, a faint border and rounder corners, with no shadow. Their sizes and rows are as before. The new look comes
  with the next login; until then the desktop keeps the earlier one.
- The update restarts the cockpit service once, since it loads `lib/constants.js`, whose lengths, colours, opacities
  and icon names for the card, the top-bar graphs and the cockpit's grid and cards moved to `lib/drawingConstants.js`,
  which only the shell loads. A later change to how they are drawn restarts no service.

## [0.1.7] - 2026-11-26

### Changed

- The update restarts the cockpit service once, since its mounts source changed.

### Added

- Each mount the cockpit service publishes says why it has no sizes, in `noSizesReason`: its query failed
  (`query-failed`), it did not answer in time (`no-answer`), the filesystem gives none (`not-reported`), or the query
  is refused with permission denied (`not-permitted`). A client can then tell a share that is down or hung, the first
  two, from a filesystem with no size to report or one this user may not query. The cards do not draw it yet, and an
  extension older than the field ignores it. The nested harness's share without sizes says `no-answer`.

## [0.1.6] - 2026-11-26

### Added

- The sampler keeps and publishes five minutes of PSI `some avg10` for cpu, memory and io, in percent, beside its
  CPU and memory histories: whole in `GetState`'s `histories.pressureAvg10`, and each Sample's values in
  `appendedHistory.pressureAvg10`. The protocol stays 1 and every key it had keeps its place. The extension keeps the
  three histories, and from a sampler that does not publish them holds them as not published rather than as gaps.
  An update restarts the sampler once, and its histories fill again within five minutes.
- The nested harness's replay sends the pressure histories, and plays a fourth scenario, `strained`: busy's CPU walk
  under a 150 s cycle in which cpu and io pressure rise past 25 % and then 50 % and come back, while swap on disk grows
  by 1 MiB a tick (5 MiB in 10 s) and then stops.

## [0.1.5] - 2026-11-26

### Changed

- The nested harness's cockpit fixture fills every list: 42 sessions in every state, named as a busy desk's are (the
  longest 32 characters, some sharing a name), and seven mounts, one a share whose sizes did not answer, so the
  sessions and connections cards draw their `+N more` lines. Its replay ranks ten apps by CPU and ten by memory, as
  the sampler publishes. `check cockpit` opens the dropdown asking for the six session names its card shows, and
  `perf` measures the cards with their lists full.
- The update restarts the cockpit service once, since its mounts source changed.
- The cockpit service publishes a mount's total exact, and its free space, on a filesystem of 10 GiB or more, to the
  tenth of a GiB the connections card draws, so free space moving within a tenth sends no `Changed` and no client
  parses one for it. A smaller filesystem's free space is published exact, so its bar stays true. The drawn text and
  tooltip are the same as from the exact sizes.

### Added

- The connections card lists the local disks, each with its free space, a bar of the space used and a disk's icon:
  the root filesystem, and `/home` unless it is beside a `/` row on the same device (a btrfs subvolume of the
  root's device, or a bind mount of a directory of `/`). A disk mounted read-only, such as an image-based system's
  root, is not listed, since nothing on it can fill, and an automount point is never a local disk. A full disk is a
  common reason a build or a session fails, and nothing showed it before. The cockpit service publishes them as
  mounts of a new kind, `local`, which an extension older than this release leaves out of its list, keeping its
  order. The local disks come first, then the other mounts by mount point, so on a desk with four or more other
  mounts the card now shows the local disks in place of the last of them (five or more where only `/` is listed).
  The nested harness's fixture gains the two, so its connections card shows five mounts and `+4 more`.

## [0.1.4] - 2026-11-26

### Changed

- The cockpit grid is drawn wherever the columns and rows the layout uses fit the work area, each column wide enough
  for the cards' content. Every layout needed 1802 × 1014 before; the template now needs 1274 × 636, so a 1536 × 960
  laptop panel draws it, under its top bar too. A layout of three rows needs 940 px of height, and one of four columns
  1691 to 1736 px of width. On a work area smaller than 1920 × 1080 the cells keep their 420 × 300 while the grid
  fits inside a 12 px margin, and shrink just enough where it does not.
- The grid is centred on the rows it uses, so on a monitor that drew it before it sits lower: 162 px at
  1920 × 1080 for the template. Between 1802 and 1919 px of width the template's cells are 420 px wide, not 394 to
  419.
- The journal line for a grid that does not fit names the length that is short for the layout, such as `the cockpit
  grid needs a work area at least 940 px tall for this layout (it is 1536x928)`.
- The update restarts the cockpit service once, since it loads `lib/constants.js`, which lost the grid's unused
  0.5 scale floor.

### Added

- The nested harness's `start --monitor-size <width>x<height>`, from 640x480 to 7680x4320, so the cockpit can be
  checked at a laptop's size.

## [0.1.3] - 2026-11-25

### Changed

- The sessions card's header shows the unknown state's icon and count only while a session is in it. Working,
  blocked, idle and done still show at 0, so they keep their places. While no session is unknown, the header is one
  icon and count narrower.

## [0.1.2] - 2026-11-25

### Changed

- While a client watches the cockpit, two of every three sessions samples are **snapshot ticks**: one
  `session.snapshot` request, with the rows rebuilt from it and from the last full sample's facts. A snapshot tick
  reads no `/proc` file, stats no transcript, and asks herdr nothing per pane. State, name, account and context still
  refresh every 10 s. Idle age and memory refresh with each full sample, about every 30 s. A tick that changes nothing
  drawn publishes nothing. Measured with 37 sessions, a snapshot tick costs about 4 ms of CPU and a full sample about
  14 ms, so the watched sessions cost falls from about 0.15 % to about 0.08 % of one core. A new session, or a Claude
  restarted in its pane, gets a full sample at once.
- Session memory is read at every full sample. 0.1.1's separate 30 s memory refresh is folded into it.

## [0.1.1] - 2026-11-25

### Changed

- The cockpit service samples the network every 60 s and the mounts every 120 s while no client watches the
  cockpit (10 s and 30 s while one does, as before). Nothing draws them then, and the first watch samples every
  source at once, so a grid that appears draws fresh data. Measured on the live desktop with 39 sessions, the
  service read 0.21 % of one core unwatched, against its 0.05 % budget, and the 10 s network cadence was most of
  that budget on its own.
- The sessions source reads each session's memory (`/proc/<pid>/status`) at most every 30 s while its Claude
  process keeps its pid, instead of at every sample; the row shows the last reading in between. That is one of the
  two `/proc` reads each session cost a sample.

## [0.1.0] - 2026-11-25

The first public release.

### Added

- The GNOME Shell extension `resource-pulse@zvibaratz.github.io`, for GNOME Shell 50 on Wayland: CPU and memory
  graphs in the top bar, a desktop card with swap, pressure and the heaviest apps, a dropdown, and an optional
  cockpit that draws a grid of cards (system, apps, connections, sessions) on one monitor.
- The sampler, `resource-pulse-sampler` 0.1.0, a Rust program run as the systemd user unit `resource-pulse.service`,
  serving `io.github.zvibaratz.ResourcePulse1` on the session bus.
- The cockpit service, `service/cockpit.js`, run under `gjs` as the opt-in unit `resource-pulse-cockpit.service`,
  serving `io.github.zvibaratz.ResourcePulse.Cockpit1`, and its config template,
  `examples/resource-pulse-cockpit.json.template`.
- The scripts that build and install the sampler, refresh the running services after an update, report their status,
  measure their cost, and run a nested GNOME Shell for trying changes.
- 16 state tables, `scripts/test-resource-pulse*.sh`, three tables for the repository's own checks, and CI that runs
  them all with the sampler's `cargo fmt`, `clippy` and `doc` checks, every pre-commit hook and gitleaks.
- The README and the user guide, `docs/guide.md`. The licence is GPL-2.0-or-later.

[Unreleased]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.11...HEAD
[0.1.11]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ZviBaratz/resource-pulse/releases/tag/v0.1.0
