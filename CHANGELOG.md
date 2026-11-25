# Changelog

All notable changes to Resource Pulse are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-11-25

### Changed

- The sessions card's header shows the unknown state's icon and count only while a session is in it. Working,
  blocked, idle and done still show at 0, so they keep their places. Unknown is rare, so the header is usually one
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

[Unreleased]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ZviBaratz/resource-pulse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ZviBaratz/resource-pulse/releases/tag/v0.1.0
