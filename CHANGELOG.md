# Changelog

All notable changes to Resource Pulse are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The nested harness's cockpit fixture fills every list: 42 sessions in every state, named as a busy desk's are (the
  longest 32 characters, some sharing a name), and seven mounts, one a share whose sizes did not answer, so the
  sessions and connections cards draw their `+N more` lines. Its replay ranks ten apps by CPU and ten by memory, as
  the sampler publishes. `check cockpit` opens the dropdown asking for the six session names its card shows, and
  `perf` measures the cards with their lists full.
- The update restarts the cockpit service once, since its mounts source changed.

### Added

- The connections card lists the local disks, each with its free space, a bar of the space used and a disk's icon:
  the root filesystem, and `/home` where it is on a device of its own (not a btrfs subvolume of the root's device,
  nor a bind mount of a directory of `/`). A disk mounted read-only, such as an image-based system's root, is not
  listed, since nothing on it can fill. A full disk is a common reason a build or a session fails, and nothing showed
  it before. The cockpit service publishes them as mounts of a new kind, `local`, which an extension older than this
  release leaves out of its list, keeping its order. The local disks come first, then the other mounts by mount
  point, so on a desk with five or more other mounts the card now shows the local disks in place of the last of
  them. The nested harness's fixture gains the two, so its connections card shows five mounts and `+4 more`.
- The cockpit service publishes a mount's free and total sizes to a tenth of a GiB, as the card draws them. The free
  space of `/` moves all the time, and the exact bytes made the mounts source change at almost every sample, each a
  `Changed` and a repaint of the connections card; the drawn text is unchanged.

### Fixed

- An automount point (a mount of type `autofs`, waiting for its filesystem) is no longer listed. One under `/mnt/`
  made a removable-disk row at 0.0G, and the cockpit service queried its sizes, which could trigger the mount. The
  filesystem mounted on it is listed as before.

## [0.1.4] - 2026-11-25

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

[Unreleased]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ZviBaratz/resource-pulse/releases/tag/v0.1.0
