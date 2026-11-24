# The golden files

For each scenario, what a client of the Resource Pulse sampler receives on the bus: every Sample, in order, and
the `GetState` reply after the last step. The files are the definition of what the sampler computes from a fixture
root. The compiled sampler (`resource-pulse-sampler/`) is held to them, and the shell's parsers read them.

They were recorded from an earlier gjs sampler and its D-Bus service by a generator script. The generator was deleted
with that sampler, so **a golden file is edited by hand, in a reviewed pull request.** If the program and a golden
file disagree, find which of the two is wrong. Never change the expected file, the scenario or the comparison only to
make the check pass.

## A scenario: `scenarios/<name>.json`

```json
{"description": "...", "serviceStartedAtUsec": 1793999995000000,
 "appNames": {"org.example.Editor.desktop": "Example Editor"}, "steps": [...]}
```

- `description`: what the scenario is for, in words. No check reads it.
- `serviceStartedAtUsec`: the service's start time in real microseconds, which the state reports.
- `appNames`: the name each `.desktop` id resolves to. An id not listed resolves to no name.
- `steps`, at least one, applied in order:
  - `{"tick": {"fsRoot", "monotonicUsec", "realUsec", "clockLabel"}}` is one tick over the fixture root `fsRoot`,
    a directory under `gnome-shell/tests/fixtures/`. `monotonicUsec` is the sampler's clock, `clockLabel` the
    snapshot's `HH:MM`, and `realUsec` the Sample's `sampledAtUsec`. A tick always publishes one Sample.
  - `{"watchDetail": true, "fsRoot", "monotonicUsec", "realUsec"}`: a detail watch starts, and its scan reads
    `fsRoot`. It publishes a reveal, a Sample whose `appendedHistory` is `null` and whose `sampledAtUsec` is
    `realUsec`, unless the sampler holds the scan back. The rules for that are in `set_detail_watched`
    (`resource-pulse-sampler/src/sampler/mod.rs`).
  - `{"watchDetail": false}`: the watch ends, which publishes nothing.

The clock is set before the root, and the root before the call. The first step's root is the one the sampler
starts on.

## An expected file: `expected/<name>.json`

```json
{"samples": [<every Sample, parsed>], "state": <the GetState reply, parsed>}
```

The Samples are numbered from 1 (`sequence`). The state's `sequence` is the last Sample's, its
`latestSampledAtUsec` is that Sample's `sampledAtUsec`, and its `serviceStartedAtUsec` is the scenario's. The
shapes are those of `buildSamplePayload` and `buildStatePayload` in `lib/protocol.js`, whose typedefs (`Snapshot`,
`AppRanking`, `AppendedHistory`) say what each field holds. Each scenario has exactly one expected file of the same
name, and each expected file has a scenario.

## How equal is judged

Equal means equal as parsed JSON. The keys must be the same, with none extra and none missing. `null` must stand
where `null` stands, strings must be equal, and every number must be the same double, bit for bit. Key order and
number spelling do not count, so `100` and `1e2` are the same value. The files are indented JSON with two spaces and
a final newline, which is how `generate.js` wrote them. Keep that layout so a diff shows the values that changed.

## What reads them

- `resource-pulse-sampler/tests/golden.rs` runs the program's sampler, its bus face and its payload writer through
  each scenario, over the same fixture roots with the real file reader, and compares the result with the expected
  file. It has one test per scenario, listed in `SCENARIOS_WITH_A_TEST`, and a test that fails when a scenario, an
  expected file and that list do not match. So **a new scenario needs its line there too.** Its other rows check the
  comparison itself, and that every number in every file survives the program's JSON writer with the same bits.
  Cargo counts these tests in the sampler table (`scripts/test-resource-pulse-sampler.sh`).
- `gnome-shell/tests/protocol.test.js` runs `parseSamplePayload` and `parseStatePayload` over every file and fails
  on any value the parsers lose ("protocol: the parsers read every golden file"). It also round-trips one Sample of
  `a-then-b.json` through `buildSamplePayload`.

Several fixture roots under `gnome-shell/tests/fixtures/` are read only through a scenario. Before you delete a
root, search the scenarios for its name.
