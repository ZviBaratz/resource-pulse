# Resource Pulse

A top-bar CPU and memory indicator, and a desktop card that adds swap, pressure and the heaviest apps
to answer "why is this machine slow right now". It lives in
`gnome-shell/extensions/resource-pulse@zvibaratz.github.io/` (GNOME Shell 50 only). The sampling runs outside the
shell, in a service of its own, so the shell never waits on a read. An optional cockpit turns one monitor's desktop
into a grid of cards, served by a second service ([The cockpit service](#the-cockpit-service),
[Drawing the cockpit](#drawing-the-cockpit)).

You install it by hand from a checkout: [Adopting it, step by step](#adopting-it-step-by-step) has the procedure,
and [Enabling it](#enabling-it) and [Checking that it runs](#checking-that-it-runs) the details. Commands in this
guide run from the checkout's root unless they say otherwise.

## How it runs

It has two parts, and an optional third ([The cockpit service](#the-cockpit-service)):

- **The sampler service**, `resource-pulse.service`: the compiled program
  `~/.local/lib/resource-pulse/resource-pulse-sampler` (Rust, `resource-pulse-sampler/`), a systemd user
  unit outside the shell. It does all the sampling, keeps the histories, ranks the apps and serves the
  result as JSON on the session bus (`io.github.zvibaratz.ResourcePulse1`). Its reads are
  synchronous, in its own process, so a slow read delays only its own next sample. It runs in
  `background.slice` at `Nice=10`, capped at `CPUQuota=10%`, `MemoryHigh=16M` and `MemoryMax=32M`, with
  no swap (`MemorySwapMax=0`); systemd restarts it 5 s after any unplanned end, one no stop asked for
  (`Restart=always`: a failure or a clean exit alike; never a stop, a logout or an exit 2, a flag the
  program does not know), at most 5 starts in 5 minutes, and kills it when it stops saying it is alive
  ([The watchdog](#the-watchdog-and-a-machine-without-the-program)). The program is built and installed by
  `scripts/resource-pulse-sampler-build.sh` ([The compiled sampler](#the-compiled-sampler)). It is the only
  sampler: it replaced an earlier one written in gjs.
- **The extension**, which only draws: the top-bar graphs, the desktop card, the dropdown and, where the
  cockpit is configured, the cockpit's grid. It
  reads no file and starts no process, and each of its D-Bus calls is asynchronous with a 2 s timeout,
  so the shell never waits on the service.

**Started on demand, never enabled.** The unit has no `[Install]` section, so nothing can enable it.
The extension's `enable()` asks systemd to start it (`StartUnit`, which is idempotent). A start counts
only once the service owns its bus name, within 15 s; until then the extension retries after 5 s,
30 s, then every 5 minutes. The extension never stops the service: disabling the extension leaves it running
until logout, and `systemctl --user stop resource-pulse.service` stops it at once.

**Updates.** After you pull a change, two steps bring the services up to date
([Updating](#updating)): `scripts/resource-pulse-sampler-build.sh` rebuilds and installs the sampler program when
its sources changed, and `scripts/resource-pulse-service-refresh.sh` runs `systemctl --user daemon-reload` and
restarts the sampler only when its installed program, or its unit file, is newer than its start, read to the
microsecond. The refresh step warns on a failure and still exits 0. The installed program's file changes exactly
when its bytes do, since the build installs by a rename and a build that changes nothing renames nothing. After a
restart the step looks at the unit once more: one that did not come back (failed, still starting) is a ⚠ naming
its state, never a ✓. A running sampler never loses its histories to an update that leaves the program and the
unit file alone. The cockpit keeps its rule: it runs `service/cockpit.js` from the checkout, through the
extension's link, so it is restarted when that module, or one it imports (directly or not, as
`scripts/resource-pulse-module-closure.sh` lists them), or its unit file changed after it started, and such a
restart empties every session's state history, which then fills again over the hour; the shell's side is its
`extension.js` and what that imports. So:

- a **sampler** change (the program's source, which is what the source hash covers and so not its test files, or
  `systemd/resource-pulse.service`) is live within seconds of the build and the refresh, with no logout, and
  restarts the sampler **once**: the extension sees the service come back and reads its state again, and the
  histories start over and fill again, within five minutes. No module of the extension restarts the sampler,
  since it runs none of them;
- a **drawing** change (a `.js` file at the extension's top level, such as `extension.js`, `card.js`,
  `indicator.js` or `cockpitLayer.js`, or a `lib/` module only the shell imports, such as
  `lib/visibility.js`) waits for the next login, because
  the shell loads an extension's JS once per login, and never restarts a service. A `lib/` module the
  shell and the cockpit both import (`lib/cockpitProtocol.js`) is both: the cockpit runs it at once, the shell at
  the next login. The status report (`scripts/resource-pulse-status.sh`) says when the desktop runs an older copy
  of that code;
- a **stylesheet** change is live at the next enable (the next lock or blank), since GNOME re-reads
  the stylesheet at every enable, while the JS that sets its classes waits for the login. So the rule
  this repo follows is that a stylesheet change only adds classes, and never renames or removes one
  an older copy's JS still sets: a new look is a block of rules appended to the file, under class names
  no earlier release used, and a table pins every block byte for byte, so an edit in place fails it;
- every other update leaves the service, and its histories, alone.

**Lock and blank.** GNOME 50 turns the extension off on every lock **and on every idle screen blank**
(a blank enters the lock screen's session mode even with locking off). The service keeps sampling, and
the next enable reads the histories back, so **the histories survive a lock or a blank**.

**Cadence.** Every 2 s (`SAMPLE_INTERVAL_SECONDS`) the service reads `/proc/stat`, `meminfo`, `swaps`,
`pressure/*`, and `mm_stat` of the zram devices `/proc/swaps` lists. The per-app cgroup scan runs:

- every 20 s while a **detail watch** is held, that is while the card can be seen or the dropdown is
  open, and every 60 s otherwise, so a reveal never starts from nothing;
- at once when a watch starts, at most once per 2 ticks, so rapid cover and uncover cannot set off a
  storm of scans;
- while a watch is held, at once when CPU busy rises 15 points above its value at the last scan, or a
  pressure meter's band rises (a burst, also at most once per 2 ticks);
- once more on the tick after a watch or burst scan, to sharpen a CPU ranking taken over a short
  window. No CPU ranking covers less than 1 s.

It skips leaves whose unit type never hosts an app (`.mount .socket .swap .automount .path .timer
.device`), and runs a full garbage collection after every scan. The top bar keeps 30 samples (60 s),
the card 150 (5 minutes).

**The histories.** The service keeps the last 150 values of five histories, one per 2 s slot: CPU busy and memory used,
as fractions 0 to 1, and the PSI `some avg10` of cpu, memory and io, in percent 0 to 100 (`pressureAvg10`), each a gap
(null) on a tick that could not read it or a tick that did not run (below). `GetState` carries all five whole, each
`Sample` the values it appended. The extension reads a pressure percent outside 0 to 100 as a gap. A service from before
the pressure histories sends none, and the extension then holds them as **not published**, which is not a run of gaps:
it adds nothing to them, not even its own gaps, until a state carries them.

**The histories count time, not ticks.** A tick that was due and did not run is a gap in all five histories: a stall
that held the sampler up, or a suspend. The ticks run on a fixed 2 s grid of `CLOCK_MONOTONIC`, so a stall is counted in
the grid's slots it skipped. That clock stops while the machine is suspended, so a suspend is counted on
`CLOCK_BOOTTIME`, which goes on: one tick for each whole 2 s slept since the sampler started, the remainder carried over
to the next suspend. At most 150 are written, a whole history, so after a night the histories are gaps but for the
newest value. Each `Sample` that appends says how many it missed before its values (`appendedHistory.missedTickCount`),
and the extension pushes as many gaps, counting its own gap for the same silence as one of them. A service from before
the count sends none, which the extension reads as none missed.

**No data, never a stale number.** The first sample is *no data*, never 0%. When no sample has
arrived for 6 s (`SAMPLE_STALL_TICKS` × 2 s), both surfaces show "no data since HH:MM" and each
history gets one gap; they recover by themselves when samples resume, and the first Sample widens that gap to the
ticks the sampler says it missed. A service that restarted (its
samples are numbered from 1 again) shows no data until its state has been read afresh, and one that
is down shows no data while the extension retries its start.

**The card** is compact: a five-minute trace each for CPU and memory, the heaviest app by each on its trace's label
line, the figures now in a column beside the traces, and the three pressure meters. While the sampler publishes its
pressure history, the card takes the form with **pressure strips**: under the traces, one strip per resource on
their own five minutes, in 30 cells of 10 s, the newest on the right. A cell is the highest band of its five
Samples: calm is a low dash, and a cell is a third, two thirds or the whole strip high from 10, 25 and 50 %, amber
from 25 %, as the meters are. Only a cell none of whose five Samples has a reading is blank, so a history shorter
than five minutes leaves the strip's left empty, and a gap blanks only the cells it covers entirely. Each strip's
meter, name and percentage stand beside it in the column, and the time axis runs under the strips. Without that
history, from a sampler that does not publish it, the axis closes the traces and the meters stand in a row at the
bottom: each at its third of the card, or as far right as the meter before it needs to show `100%` with 10 pixels
clear, so no meter moves when a reading gains a digit. In a cockpit cell narrower than the card, the two gaps
narrow equally where they must for the last meter's `100%` to stay inside the card. Both forms are one size, so the
card does not move when the form changes, and until the sampler's first state says whether it publishes the history,
as after each unlock, the card draws the form with strips, every cell blank: its form changes when that state comes
only for a sampler that does not. A gap in a trace (a Sample with no reading) is hatched, never bridged,
and a history shorter than five minutes leaves the trace's left empty. Its text follows GNOME's text size and the
shell's font, and the card grows with them: the text, the padding at its sides, the column of figures and the
traces' height where the memory figure's lines need the room (the memory trace's alone with a pressure history,
both traces' without one). The plots' width, the strips and the gaps between its parts stay fixed. The heaviest
apps' names ellipsize, and numbers are never cut. A condition the machine is in is drawn amber: a resource waited
on, and swap growing on disk ([Every number, defined](#every-number-defined)). It counts as covered when one
normal or dialog window on the primary monitor's active workspace fully contains it, or that monitor
is fullscreen (ding's desktop window never counts, and partly covered counts as visible). While
covered it is **dimmed**, repaints only every 30 s (still dimmed, from the latest state) and releases
its detail watch, so a card wrongly judged covered reads as stale, never as live; on reveal it repaints
at once, undimmed, and takes the watch again. `Super+D` reveals it without waiting for a sample. With the
cockpit drawn, the card sits in the grid's system cell and is judged on the cockpit monitor, as each card
of the grid is ([Drawing the cockpit](#drawing-the-cockpit)).

**Nothing on a timer.** While samples flow the shell side wakes for nothing else: the sample is the tick.
The top bar's graphs are redrawn only when a column changes by a whole device pixel, and only while the
top bar is shown. The card is drawn through an offscreen texture, so a window drawing over it does not
repaint it. Whether the card is covered is checked again on window changes, on the covering window's own
moves, and on a sample: every one while the card is visible, every fifteenth while it is covered. Only
while the service is silent and the card covered (with the cockpit, every card of the grid) does a
10-second check run. The cockpit adds no repeating timer; "Freshness" in
[Drawing the cockpit](#drawing-the-cockpit) says when a change is drawn. The budgets, and the request that
checks them: [What it costs](#what-it-costs).

**The dropdown.** Clicking the top-bar graphs opens a dropdown holding the lit captions, if any, each in an
amber outline, but **N waiting on you** in dark words on amber (on a light menu each takes a darker amber,
wherever it contrasts more with the menu, and the filled one white words on it). They wrap onto a second row
where they pass the card's width. Then comes a second card, live while it is open; under it, once the cockpit
service has answered, the cockpit's sessions card ([Drawing the cockpit](#drawing-the-cockpit)); and an **Open
Resources** button (Resources, else System Monitor; hidden when neither is installed). Resting the pointer on the
graphs shows a one-line summary, and the lit captions after it separated by commas, never while the dropdown is
open.

**The mark.** Left of the graphs, in a slot 20 pixels wide that keeps its width lit or not, an amber ring shows
while any caption is lit, and an amber disc with the count in place of the ring while a session waits on you
(**N waiting on you**, below); from 100 the disc says 99, and the hover label and the dropdown the true count.
The machine's captions are lit for every user, with a cockpit or without one:

- **CPU wait**, **Mem wait** and **IO wait**: the resource is waited on, from 25 % of its `avg10`;
- **Swapping**: swap on disk grows ([Every number, defined](#every-number-defined));
- **Machine stale**: the sampler has gone silent, by the rule of "no data since" (no Sample for 6 s, or the
  service gone), or the service answers with its last Sample already that old; until its next Sample.

Each of the first four lights on the first Sample its condition holds, and stays lit until its condition has
read false on five Samples in a row (10 s), so a reading that hovers at 25 % does not blink it. The hold is
counted in Samples, with no timer, and a reading that is missing ends it at once: before the first Sample, and
while the sampler is silent, none of the four is lit. The extension reads the time, swap and pressure of every
Sample for them, the card covered or not, so the mark is right behind windows; the rest of a Sample is read only
when something shows it. The card's amber swap line is judged over the same Samples.

All of this starts afresh at each enable, and so at each unlock, since the extension is disabled while the
screen is locked: the holds and the swap window are empty again, and Machine stale lights only once the
service has answered since. A sampler that was already silent at an unlock leaves the ring dark and the
dropdown without the line, while the hover label, whose last good time is kept across enables, still says
"no data since".

**The cockpit's captions.** With a cockpit, four more join the machine's. Every surface names them all in one
order: **N waiting on you** first, then CPU wait, Mem wait, IO wait and Swapping, then **Offline**, **Mount**,
Machine stale and **Agents stale**.

- **N waiting on you**: the sessions source counts a blocked session; it says how many;
- **Offline**: the network source's uplink says there is no connectivity (`unknown` lights nothing);
- **Mount**: a mount's size query failed or did not answer, a local disk's too, never an automount point's;
- **Machine stale**, the cockpit's half, and **Agents stale**: the network or the mounts source, or the sessions
  source, answered and then stopped. A source is called stale as its card is (Freshness, in
  [Drawing the cockpit](#drawing-the-cockpit)), which takes a pull, and pulls are made only while something of
  the cockpit is seen; so covered, these two light only once the cockpit service has gone. The service gone
  lights them for every source that had answered.

None of them is held: each follows what the cockpit client holds, judged at each event the client sends, which it
sends whatever is seen, and at a Sample only where the clock alone moved a source's stale verdict (a wall clock set
back). So each lights at its source's next sample, seen or not, and while nothing of the cockpit is seen the
sources keep their unwatched pace: **Offline** within seconds, since the network source samples at once on
NetworkManager's change of connectivity; **Mount** at the mounts' next sample, at once when a mount comes or goes,
else up to 120 s later; the waiting count at the sessions' next sample, up to 60 s later (10 s while a card is
seen). On battery the unwatched paces are three times as long. A source that never answered lights nothing. A
source's own caption goes out while it is stale, and with the service gone only the two Stale captions are lit,
since what the sources last said is no longer known.

## Installing it

### Adopting it, step by step

For someone who has never seen this repository. You need a desktop on GNOME Shell 50 on Wayland (the extension
supports nothing else), and:

- **A Rust toolchain with `cargo` 1.89 or newer** on `PATH` when you build (the crate's `rust-version`;
  `cargo --version` prints it). A toolchain from [rustup](https://rustup.rs) will do; a distribution package older
  than 1.89 will not. The first build needs the network, to download the crate's dependencies (about 56 MB, all
  from crates.io, pinned by `Cargo.lock`), and takes about half a minute on an 8-thread laptop. Cargo links with a
  C compiler, so a C toolchain is needed too (on Debian and Ubuntu, `sudo apt install build-essential`).
- **`gjs` at `/usr/bin/gjs`**: the cockpit's unit runs `service/cockpit.js` with it, and the tests need it.
- The build step's `sha256sum` and `timeout` (coreutils), and the status report's `gsettings`, `gnome-extensions`,
  `gdbus` and `systemctl`, which a GNOME desktop has.

Then, from a terminal in your session:

1. **Clone it** somewhere it can stay. The links below point into the checkout, so moving or deleting it breaks
   them.

   ```bash
   git clone https://github.com/ZviBaratz/resource-pulse.git
   cd resource-pulse
   ```

2. **Build the sampler.** It prints a building line, then
   `✓ Resource Pulse sampler program built and installed: ~/.local/lib/resource-pulse/resource-pulse-sampler`. A
   `⚠ … not built: <why>` line says what is missing ([Building and installing it](#building-and-installing-it)).

   ```bash
   bash scripts/resource-pulse-sampler-build.sh
   ```

3. **Link the extension** into GNOME Shell's user extension directory. The link's name is the extension's uuid,
   `resource-pulse@zvibaratz.github.io`, which GNOME requires, and the cockpit's unit runs `service/cockpit.js`
   through that link.

   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions
   ln -s "$PWD/gnome-shell/extensions/resource-pulse@zvibaratz.github.io" ~/.local/share/gnome-shell/extensions/
   ```

4. **Link both units** into your systemd user unit directory. `link` takes absolute paths and reloads systemd.
   Never `enable` or `reenable` them: they have no `[Install]` section, and the extension starts them (each unit's
   header says why).

   ```bash
   systemctl --user link "$PWD/systemd/resource-pulse.service" "$PWD/systemd/resource-pulse-cockpit.service"
   ```

5. **Log out and back in.** GNOME on Wayland finds a new extension only at login ([Enabling it](#enabling-it)).
6. **Enable the extension.** It loads at once and asks systemd to start the sampler, and the cockpit, which
   systemd skips while its config file is absent.

   ```bash
   gnome-extensions enable resource-pulse@zvibaratz.github.io
   ```

7. **Check that it runs.** The status report prints `Resource Pulse: linked=yes enabled=yes state=ACTIVE`,
   `service: active, protocol 1, last sample … ago` and `cockpit: skipped (no ~/.config/resource-pulse/cockpit.json)`,
   with no ⚠ line, and `--check` prints `✓ Resource Pulse sampler program installed and current (source hash …)`
   ([Checking that it runs](#checking-that-it-runs)).

   ```bash
   bash scripts/resource-pulse-status.sh
   bash scripts/resource-pulse-sampler-build.sh --check
   ```

8. **The cockpit**, if you want it: "Turning it on" under [Drawing the cockpit](#drawing-the-cockpit).

### Updating

```bash
git pull
bash scripts/resource-pulse-sampler-build.sh
bash scripts/resource-pulse-service-refresh.sh
```

The build says `✓ … unchanged: <path>` when the sampler's sources did not change, and rebuilds and installs the
program when they did. The refresh step reloads systemd, then restarts each running service whose code changed
since it started, and says so in one line, such as
`✓ resource-pulse.service restarted: its program changed since it started (its histories start again)`. It
restarts nothing else, starts no service that is not running, and prints nothing when nothing changed
([Updates](#how-it-runs)). A change to the drawing side waits for your next login, and the status report says
`the desktop runs an older copy; takes effect at next login (…)` until then.

### Removing it

```bash
gnome-extensions disable resource-pulse@zvibaratz.github.io
systemctl --user stop resource-pulse.service resource-pulse-cockpit.service
systemctl --user disable resource-pulse.service resource-pulse-cockpit.service
systemctl --user reset-failed resource-pulse.service resource-pulse-cockpit.service
rm "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/resource-pulse@zvibaratz.github.io"
rm -rf ~/.local/lib/resource-pulse "${XDG_CACHE_HOME:-$HOME/.cache}/resource-pulse" "${XDG_CONFIG_HOME:-$HOME/.config}/resource-pulse"
```

`disable` removes the links that `link` made. `reset-failed` clears a unit that had failed before you removed it
(otherwise `systemctl --user --failed` keeps listing it until the next login); it reports an error for a unit that is
not in memory, which you can ignore. The last line removes the installed program, the build directories
and log, and the cockpit's config. The shell forgets the extension at your next login.

## The compiled sampler

`resource-pulse.service` runs a program, not a script: the sampler is written in Rust
(`resource-pulse-sampler/`). It is the only sampler. The golden files
(`gnome-shell/tests/golden/`) are the definition of what it computes, and are edited by hand, in a reviewed pull
request ([their README](../gnome-shell/tests/golden/README.md)); the conformance row now holds the gjs client rows'
test double (`gnome-shell/tests/serviceDouble.js`) to the program. `scripts/resource-pulse-sampler-build.sh` builds
the program and puts it at `~/.local/lib/resource-pulse/resource-pulse-sampler`, where the unit's `ExecStart` runs it.
Run by hand, outside the unit, the program is safe only in its print
modes: `--print` (each publish as one line, no bus), `--print-constants` and
`--source-hash` open no bus, but a bare run would try to own the live service's name.

### The watchdog, and a machine without the program

- **The watchdog.** The program tells systemd it is alive on every tick. After 120 s without that
  (`WatchdogSec=120`) systemd kills it with SIGKILL (`WatchdogSignal=SIGKILL`: the default, SIGABRT, would hand
  a core dump of a program that only hung to the crash reporter) and `Restart=always` starts it again 5 s
  later, so a sampler that hangs once mends itself. The 120 s is long on purpose: around a suspend systemd
  freezes the user's session, and nothing orders the sampler's first message after the thaw before the
  manager's check. The kill is a restart: the histories start again. The journal says each one,
  `journalctl --user -u resource-pulse.service -e`, as `Watchdog timeout (limit 2min)!` (a start that hangs
  before the program owns its bus name is ended by the start timeout instead, 90 s, and logged as `start
  operation timed out`). A sampler that hangs
  on **every** run is killed and started again for ever, and never reaches `failed`, since its starts are too
  far apart for the start limit (5 in 300 s); that shows in `NRestarts` (`systemctl --user show -p NRestarts
  resource-pulse.service`) and, while it is up, in the status report's "did not answer GetState" or "has not
  sampled". The unit's own header has the arithmetic.
- **A machine without the program** (no cargo, a cargo older than 1.89, a failed build, a build never run) has
  a unit with nothing to run: `ExecStart` has no condition on purpose, so every start fails at once, and
  `Restart=always` with the start limit (5 starts in 300 s) ends in a **failed** unit, with no restart loop
  after that. The extension shows "no data" and asks again every 5 minutes only while the sampler has not owned
  its bus name since the extension was last enabled (as on a machine that never had the program); otherwise it
  waits for its next enable. "Within half a minute" is what the settings imply (five starts 5 s apart), not a
  measurement. What you see:
  - the status report: `service: failed (not running)` with the ⚠ `resource-pulse.service failed — journalctl
    --user -u resource-pulse.service -e`, and the ⚠ naming the program:
    `⚠ Resource Pulse sampler program missing: ~/.local/lib/resource-pulse/resource-pulse-sampler is not installed;
    build and install it (it needs cargo) — run bash <checkout>/scripts/resource-pulse-sampler-build.sh` (up to the
    dash, `scripts/resource-pulse-sampler-build.sh --check`'s own line, which `--check` prints with exit status 1);
  - after you install cargo and build the program, the failed sampler is **not** started by the build or by the
    refresh step (it restarts only a running one). The extension asks for it again by itself only while the sampler
    has not owned its bus name since the extension was last enabled (a lock and unlock, a blank and a login each
    enable it again), retrying 5 s, then 30 s, then every 5 minutes after an ask that fails, so it starts within
    about 5 minutes. A sampler that owned its name since that enable and then failed waits for the next enable.
    Or start it now: `systemctl --user reset-failed resource-pulse.service && systemctl
    --user start resource-pulse.service` (`reset-failed` also clears the start limit, 5 starts in 300 s, which
    refuses a start inside that window);
  - `systemctl --user --failed` lists `resource-pulse.service`.

### Building and installing it

- **Who gets it.** Anyone who runs `scripts/resource-pulse-sampler-build.sh` with `cargo` at least the crate's
  `rust-version` (1.89). A machine without a new enough cargo gets no program, and no fallback: its unit is a
  failed one ([a machine without the program](#the-watchdog-and-a-machine-without-the-program)).
- **What the build does.** `bash scripts/resource-pulse-sampler-build.sh` first asks the installed program (if
  any) for its `--source-hash` and, when that is this checkout's, stops there: no cargo, nothing touched.
  Otherwise it builds the release program under a job cap into `~/.cache/resource-pulse/cargo-target-install`, a
  build directory nothing else writes, within a 20-minute limit; asks the built program for its `--source-hash`
  and installs nothing unless it is this checkout's (a build directory shared with another checkout could hand
  over that checkout's program: cargo judges a build fresh by its files' times); compares the build with the
  installed file byte for byte, and only a different one is installed, with a rename at
  `~/.local/lib/resource-pulse/resource-pulse-sampler`, outside the checkout. A build that changes nothing
  renames nothing, so a later refresh never restarts the sampler for this. The first build downloads the crates
  (about 56 MB) and takes about half a minute on an 8-thread laptop. The script runs from any directory: it finds
  the crate beside itself.
- **The job cap.** `CARGO_BUILD_JOBS` from the environment when it is set; else, with
  `--build-limits-module <path>`, the `CARGO_BUILD_JOBS` that shell file exports, read under zsh; else 2 (also
  when zsh or the file is not there). The script reads no such file unless it is named one. The option given
  twice, or with no value, is a usage error; a relative path is read under the working directory.
- **The lines it prints.** One line, except when it runs cargo: then a building line first
  (`… Resource Pulse sampler program building …`), and the result after it. A `Ctrl-C` or `Ctrl-\` before the
  rename ends the build and installs nothing; from the rename on, the step ignores them and finishes, so an install
  always prints its ✓ and a ✓ always means the program is in place. It exits 0 with each of these lines, so it
  never stops a script that runs it under `set -e`; a usage error exits 2, and a signal 128 plus its number:
  - `✓ Resource Pulse sampler program built and installed: <path>`: a new or changed program is in place.
  - `✓ … unchanged: <path>`: the installed program is already this checkout's, or the build is byte for byte the
    installed one; nothing was touched.
  - `⚠ … not built: <why>`: no cargo, a cargo older than 1.89, no `sha256sum` or `timeout`, a build that
    failed or timed out (its output is in `~/.cache/resource-pulse/build.log`; the installed program, if any, is
    untouched), a build that left a program built from other sources (the line gives both hashes and the
    build directory to remove), an installed path that is not a regular file, or a directory or file it could
    not create, copy or rename. Install a current Rust toolchain, or read the log, and run the build again.
- **Is the installed program this checkout's?** `scripts/resource-pulse-sampler-build.sh --check` builds
  nothing and runs no cargo: it asks the installed program for `--source-hash`, a SHA-256 of everything that
  compiles into it (`Cargo.toml`, `Cargo.lock`, `build.rs`, `source_hash.rs` and `src/` except test code),
  and compares it with the checkout's. It exits 0 (current), 1 (missing, or built from other sources) or 2
  (could not tell: no `sha256sum` or `timeout`, a directory on the way to the installed path that it cannot search
  (never "missing", which a build could not mend), an installed path that is not a regular file (a directory, or
  a link to nothing, which the build refuses too), an installed file that cannot be run, does not know
  `--source-hash` or does not answer within 5 seconds). A test-only edit does not change the hash, and so does not
  reinstall. "Current" means built from the same sources (the source hash)
  and nothing more: a new Rust toolchain, a `RUSTFLAGS` or a user-level cargo configuration does not rebuild it.
- **Asked by other scripts.** `--installed-path` prints the absolute path the step installs at for this `HOME`
  (read without its trailing slashes), and exits 2 when `HOME` is unset, empty or not an absolute path. The three
  modes (`--check`, `--list-hashed-files`, `--installed-path`) are exclusive: two on one command line are a usage
  error.

**A known limit on translated app names.** The compiled program names an app from its `.desktop` file's own
`Name` keys (`Name[xx]`, in the order of the user's languages) and reads no gettext catalogue. GLib on Ubuntu
also translates a name through a catalogue a file names (an `X-…-Gettext-Domain` key; 73 of the 95 files in
`/usr/share/applications` on one Ubuntu desktop name one). Under `en_US` none of the 73 differs; under `en_GB`
four do ("Colour Management" and three others), and in a translated session more would, so under a locale
other than `en_US` a few names can differ from what GNOME shows. The constants table's
rows against the installed GLib (`scripts/test-resource-pulse-sampler-constants.sh`) run over the fixtures' ids
only, so they do not cover this.

### The state tables

The program's state tables run in the `resource-pulse-sampler-test` CI job, each a step of its own, and share
`scripts/resource-pulse-sampler-table-lib.sh`:

- `scripts/test-resource-pulse-sampler.sh` (452 checks): each `cargo test` as a row (the golden files' among them),
  the program's build, and its flags and exit statuses.
- `scripts/test-resource-pulse-sampler-constants.sh` (28 checks): the constants against the extension's
  (`lib/constants.js`, `lib/protocol.js`), and the app names against GLib.
- `scripts/test-resource-pulse-sampler-bus.sh` (39 checks): the program on a private message bus (the name's flags,
  listening before naming, the reply order, the conformance row holding the test double to it), its lines under the
  journal, and the status report (`scripts/resource-pulse-status.sh`) asking it for its state.
- `scripts/test-resource-pulse-sampler-hash.sh` (15 checks): the source hash, what it covers, and a copy of the crate
  built with cargo between edits.
- `scripts/test-resource-pulse-sampler-build.sh` (57 checks): the build step, against a stub cargo, and its
  `--build-limits-module` option with and without it.
- `scripts/test-resource-pulse-sampler-release.sh` (4 checks): the release program, and the stub cargo's shape.

Every use of a bus is a private one of the run's own behind a barrier, so no table touches the live session. Each
asserts its own row total, and refuses to run as root (root ignores the directory permissions some rows deny).

They build in `~/.cache/resource-pulse/cargo-target-<id>`, one directory per checkout, which
`scripts/resource-pulse-cargo-target-dir.sh` prints (`<id>` is the first 12 hex digits of the SHA-256 of the crate
directory's real path; that script's header gives the command), and not in the build step's `cargo-target-install`:
cargo judges a build fresh by its files' times wherever the package lives, so in a directory two checkouts share,
`cargo test` in one runs the other's test binaries, and a release build hands over the other's program. Each of
these directories is only a cache, safe to remove; `CARGO_TARGET_DIR` set by the caller wins here. The nested
harness builds its release program in the same directory, always: a caller's `CARGO_TARGET_DIR` does not move its
build ([Trying changes in a nested shell](#trying-changes-in-a-nested-shell)).

## The cockpit service

A third part, opt-in: the cockpit's data side. The extension draws what it serves
([Drawing the cockpit](#drawing-the-cockpit)) and starts it: at every enable it asks systemd for the unit, as it
does for the sampler (`StartUnit`, retried after 5 s, 30 s, then every 5 minutes until the service owns its name).
A unit systemd skips for want of the config file, or has no file for, ends the asking until the next enable.

**What it serves.** `resource-pulse-cockpit.service` (`gjs -m service/cockpit.js`) is a second systemd user unit, apart
from the sampler, so a cockpit update leaves the sampler and its histories alone: the sampler is a program that
imports no module of the extension, and only its own program or unit file restarts it. It serves JSON
on the session bus as `io.github.zvibaratz.ResourcePulse.Cockpit1` (protocol 1), at
`/io/github/zvibaratz/ResourcePulse/Cockpit1`:

- `GetState`: the layout, the config error (null when there is none), and three sources, each stamped with
  when it was sampled (`sampledAtUsec`) and its interval (`intervalSeconds`): `sessions` (the Claude Code
  sessions in herdr), `network` (the uplink, the VPN tunnel and the SSH control masters) and `mounts`
  (the local disks, network shares and removable disks). Their fields are defined in
  [Every number, defined](#every-number-defined).
- `Changed`: the sources, or the layout, that changed; never sent on a timer.
- `WatchCockpit` / `UnwatchCockpit`: held while the cockpit can be seen. Watches are counted per caller and
  dropped when the caller leaves the bus, as the sampler's are.
- `FocusSession(id)`: focuses that session's herdr workspace, then its pane, and answers whether it did. A
  failure is an answer, never a D-Bus error: `focused: false` and an `error` code, one of `unknown-session`
  (no row has that id), `no-pane` (the row has no herdr pane), `herdr-rejected` (herdr refused, or its
  reply could not be read), `herdr-unreachable` (no socket, a refused connection, or no reply to either
  request in 0.75 s, so the answer comes before the shell's 2 s call gives up) and `internal` (a fault in the
  service). herdr's own message goes to the journal, never to the bus:
  `cockpit: focus: <id>: <message>`. Once herdr focused the pane, the answer also names
  `windowPidCandidates`, for the shell to bring the window showing herdr forward: herdr's API lists no
  clients, so the service finds them in `/proc` (a `herdr` process with a controlling terminal; the server
  has none) and names each client's pid and its parents' (pid 1 left out, at most 64). A failure names none,
  and so does a fault while naming them, which is logged: the pane stays focused.

**Fixture mode.** With `RESOURCE_PULSE_COCKPIT_FIXTURE` naming a JSON file, the service runs no source,
reads no config and never asks herdr: it serves the file's `state` (re-read on change, as the config is) and
answers every `FocusSession` with its `focusReply`, and logs `cockpit: serving a fixture (<path>)`. The
file is read through the cockpit's refusing reader, so a path under a stat-only directory is never opened:
the service exits 1 instead. It is for the nested harness alone; the unit unsets the variable
(`UnsetEnvironment=`), so a user manager that carries it cannot make the unit serve a fixture.

**Stale.** The service sends `Changed` only when something changed, so a quiet source is not a dead one.
A source is stale once its `sampledAtUsec` is older than 3 of its own `intervalSeconds`
(`COCKPIT_SOURCE_STALE_INTERVALS`). The extension, seeing one that old on a sample while the cockpit can be
seen, asks `GetState` again, at most once per interval of that source, and draws the source as no data only
once such a request has come back, answered or failed, without a newer stamp.

The unit runs `/usr/bin/gjs -m` on `service/cockpit.js` through the extension's link,
`~/.local/share/gnome-shell/extensions/resource-pulse@zvibaratz.github.io`, which you point at the checkout
([Adopting it, step by step](#adopting-it-step-by-step)), so it names no checkout and works wherever the
repository lives.
It runs in `background.slice` at `Nice=10`, capped at `CPUQuota=10%`, `MemoryHigh=64M` and
`MemoryMax=96M`, with no swap (`MemorySwapMax=0`); systemd restarts it 5 s after a crash, at most 5 starts in
5 minutes. Its budgets are in
[What it costs](#what-it-costs). It logs to `journalctl --user -u resource-pulse-cockpit.service`, every line prefixed
`cockpit:`. The refresh step (`scripts/resource-pulse-service-refresh.sh`) try-restarts it when
`service/cockpit.js`, a module it imports, or its unit file changed after it started, and looks once more after a
restart, as for the sampler (whose rule is its program and its unit file, [Updates](#how-it-runs)); a cockpit
that is not running is left alone, silently.

**Opt-in by file: `~/.config/resource-pulse/cockpit.json`** (under `$XDG_CONFIG_HOME` instead when that is
set). The unit is linked, never enabled: it has no `[Install]` section. Its
`ConditionPathExists` (on `%E`, which is `$XDG_CONFIG_HOME` or `~/.config`, where the service reads the
file too) makes systemd skip every start while that file is absent. The unit stays inactive, and that is
not a failure. To opt in, copy the template, `examples/resource-pulse-cockpit.json.template`, from this repository's
root, as the commands below do. The extension starts the service at its next enable (the next
login, unlock or blank); start it by hand to have the grid drawn now, since the extension follows the
service's bus name whatever systemd answered it before.

```bash
mkdir -p ~/.config/resource-pulse
cp examples/resource-pulse-cockpit.json.template ~/.config/resource-pulse/cockpit.json
systemctl --user start resource-pulse-cockpit.service   # or wait for the next enable
bash scripts/resource-pulse-status.sh   # cockpit: active, protocol 1, last publish …
```

The file may name the monitor the cockpit is drawn on (`monitor`, by `vendor` and `product`; the template
names none, see [Where](#drawing-the-cockpit)), and names its card groups (`groups`). Each group has an `id`, a
`caption`, 1 or 2 `columns` and its `cards`, from `system`, `apps`, `connections` and `sessions`; any other card
id is a config error (`groups[0].cards[0]: unknown card id 'weather'`). The groups' columns add up to at most 4.
`version` must be 1. Keys it does not know, such as the template's `_comment`, are ignored.

The service watches the file. An edit, a save that renames into place, a move or a delete is read again
200 ms after its first event, with no restart. A malformed file publishes no layout, and a `configError`
that names its first fault (`config: malformed JSON` for text that is not JSON at all); a deleted one
publishes the `configError` `missing`. The sources are served either way.

**Cadence.** Each source samples once at start, then on its own interval:

| Source | Interval | Also sampled at once on |
|---|---|---|
| `sessions` | 10 s while a watch is held (a full sample every third, the rest snapshot ticks), 60 s otherwise | the first watch being taken, as a signal is (so at most once in 2 s) |
| `network` | 10 s while a watch is held, 60 s otherwise | the first watch being taken; a change to NetworkManager's primary connection, its type, the connectivity or whether Wi-Fi is enabled |
| `mounts` | 30 s while a watch is held, 120 s otherwise | the first watch being taken; a mount or an unmount (the mount monitor's `mounts-changed`) |

- With no watch held nothing draws the sources, so each runs at its slower interval, and the first watch
  samples every source at once, so a grid that appears draws fresh data (for `sessions`, a watch taken again
  within 25 s of a full sample gets a snapshot tick: fresh states, with idle ages and memory up to 25 s old).
  A source whose first watched sample
  fails keeps its last object, stamped with the unwatched interval it ran under, so its card goes stale only
  after three of those (3 minutes for `network`, 6 for `mounts`).
- `network` reads the route table and lists the SSH control sockets together, on each sample: one cadence
  for both, so the listing costs one directory read per sample.
- On battery (UPower's `OnBattery`), every interval triples.
- A signal within 2 s of a source's last signal-driven sample gives one more sample at the end of those 2 s,
  not one per signal, counted on the monotonic clock so that setting the clock cannot stretch them.
- A signal while the source's sample is still running gives one more sample once that one ends, and at the
  earliest 1 s after the signal: a change made mid-sample does not wait for the next interval.
- A source whose signal cannot be watched logs one line and is still sampled on its interval.
- A sample still running when the next one is due is not started twice.
- A source that fails keeps its last object, stamp included, and logs one line; the others go on.
- Each request to herdr gives up after 2 s. With no herdr socket (`~/.config/herdr/herdr.sock`), or one that
  refuses connections, `sessions` has no rows and `herdrRunning` is false; that is not an error.
- `sessions` asks herdr for a pane's Claude process (`pane.process_info`) once and remembers it while that
  process lives, for at most 10 minutes. It asks again at once in four cases, each read from the process's
  `/proc/<pid>/stat`:
  - a new pane;
  - a process that exited;
  - a pid that now names another process (its start time differs);
  - a process that left its terminal's foreground group (its `pgrp` is no longer the terminal's `tpgid`).

  It does that only in a full sample. A sample is a **full sample** or a **snapshot tick**, and both start
  with one `session.snapshot` request:
  - **A full sample** reads every session's facts: its Claude process, its transcript's age, and its memory
    (`/proc/<pid>/status`).
  - **A snapshot tick** reads nothing more. It rebuilds the rows from the snapshot (state, name, account,
    context) and the last full sample's facts, so idle age and memory are as that full sample found them. It
    counts idle ages to that full sample's time, not to now, so a tick that changes nothing drawn publishes
    nothing, unless it starts a minute: that adds a cell to every state history (`stateHistory`, below).
  - **Which one runs:** a sample is a tick while the last full sample is younger than 25 s and has facts for
    every Claude session the snapshot shows (the same pane and session id); otherwise it is full. So a watch
    gets a full sample every third tick (about every 30 s), the unwatched pace gets one at every sample, and a
    new session or a Claude restarted in its pane is read at once. A Claude resumed in the same pane under the
    same session id keeps the old process's facts until the next full sample. herdr not running forgets the
    facts.
  - **Cost,** measured with 37 sessions: a snapshot tick about 4 ms of CPU, a full sample about 14 ms.
- `sessions` keeps an hour of each session's state, a cell a minute, and publishes it in each row's
  `stateHistory` ([Every number, defined](#every-number-defined)). Every sample that resolves with rows records
  it, a full sample or a snapshot tick, so the first sample of a minute adds a cell. A full sample is already a
  change (its idle ages count to now), so the history adds a `Changed` of its own only when a snapshot tick
  starts a minute: at most one a minute while a watch is held, none at the unwatched pace. On a desk where no
  session's idle age is known (no transcript and no Claude process found, so no memory either), two full samples
  are otherwise equal, so there the history adds one `Changed` a minute unwatched too. A full history makes every
  `sessions` source larger by about 78 bytes a session.
- After a `sessions` sample the service runs a full garbage collection, at most once in 50 s: after every
  sample at the 60 s pace, and every fifth at the 10 s pace. herdr's replies are native memory the engine
  does not count, so without it they pile up between collections.

**The secrets rule.** The service hands the drawing side only fields it chose:

- **An allowlist.** Every source, the layout and every reply pass through a reader in
  `lib/cockpitProtocol.js`, and each builder writes only what its reader returns. A field no reader lists
  never leaves the service. The readers cap lengths too: a herdr workspace or pane id longer than 128
  characters reads as null, and a mount whose mount point is longer than 1024 is dropped.
- **Stat, never open.** The sources' file reader refuses, before opening it, any path holding `/.aws/`,
  `/.ssh/` or `/.credentials` (`STAT_ONLY_PATH_FRAGMENTS`), and any path with a local dotfile in it: a
  component `.<name>.local`, at any depth, and a name that goes on past `.local` too
  (`STAT_ONLY_LOCAL_DOTFILE_PATTERN`). `~/.local/` and a `.local` file that is not a dotfile are read as usual.
  Those paths may be stat'ed, or listed when a directory: the SSH control sockets are counted, never opened, and
  a transcript is only stat'ed. It matches the path as given, so it is a guard, not a boundary. A table row also
  forbids those paths anywhere in `service/` and `lib/` outside that list.
- **The name guard.** Every name published (a session name, an account, a mount label, a value quoted in a
  config error) is replaced by `—` when it is empty, longer than 64 characters, holds a control character,
  or matches one of the common credential shapes in `lib/nameGuard.js` (`SECRET_SHAPE_PATTERNS`).

**What the status report says.** `scripts/resource-pulse-status.sh` prints one `cockpit:` line under its
`service:` line ([Checking that it runs](#checking-that-it-runs)). The two you will usually see:

```
  cockpit: skipped (no ~/.config/resource-pulse/cockpit.json)
  cockpit: active, protocol 1, last publish 4 s ago, stale: none
```

- `skipped` needs the unit loaded and inactive with its condition unmet, **and** the file absent, because a
  unit that never ran also reads `ConditionResult=no`. With the file there and the unit never started, the
  line is `inactive (not running)`, and a ⚠ says to start it.
- `active` comes from `GetState`. The last publish is the latest `Changed`, or the start, so a quiet
  service's can be long ago, which is no fault. `stale:` names each stale source (`stale: sessions, mounts`).
- These come with a ⚠ naming the remedy:
  - `failed (not running)` and `activating (auto-restart: restarting after a failure)`: its journal;
  - `active, no answer`, when `GetState` did not answer within 3 s: its journal;
  - while the file exists: `inactive (not running)` (start it), `not installed (LoadState=not-found)`
    (link it: `systemctl --user link --force <checkout>/systemd/resource-pulse-cockpit.service`), `cannot load (…)`
    (`systemctl --user status`), and any other state, such as
    `activating (start)` (its journal). Without the file, none of these four warns;
  - `cockpit: config invalid: <configError>`, while the service runs: fix the file, which it rereads;
  - it **runs older code**: a module `service/cockpit.js` runs changed after it started (`systemctl --user
    try-restart resource-pulse-cockpit.service`);
  - it **cannot tell** whether it does, when the cockpit's start cannot be read: `cannot tell when
    resource-pulse-cockpit.service started (its ActiveEnterTimestamp could not be read), so not whether it runs older code or
    unit file — systemctl --user show -p ActiveEnterTimestamp --value --timestamp=us+utc resource-pulse-cockpit.service`, with
    `is not in systemd's microsecond form` in place of `could not be read` when `systemctl` answered with
    something else; and when the `find` first on `PATH` cannot read that start, as bfs cannot: `cannot tell
    whether resource-pulse-cockpit.service runs older code or unit file: <find> cannot read its start for -newermt, as GNU
    find can — <find> / -maxdepth 0 -newermt '<start>'`. These are the sampler's wordings for its own start,
    never silence.
- These have no ⚠: `unknown (no systemd user manager answered)`;
  `active (gdbus not found, so not asked)`, an active unit not asked for `GetState` for want of `gdbus`;
  and `inactive (not running)` while the file is absent and `ConditionResult` is not `no`, a unit whose
  last start found the file (stopped since, and the file deleted).

## Drawing the cockpit

With the cockpit service configured, the extension draws its layout as a grid of cards on one monitor's
desktop, behind every window, and the desktop card moves into the grid. The top bar and its dropdown stay
where they are.

**Turning it on**, once the extension runs ([Adopting it, step by step](#adopting-it-step-by-step)):

1. Make the config from the template, from the checkout's root:

   ```bash
   mkdir -p ~/.config/resource-pulse
   cp examples/resource-pulse-cockpit.json.template ~/.config/resource-pulse/cockpit.json
   ```

2. Start the service, `systemctl --user start resource-pulse-cockpit.service`, or wait for the extension's next
   enable (the next login, unlock or blank). The extension follows the service's bus name, so the grid is drawn as
   soon as the service answers, with no new login ([Opt-in by file](#the-cockpit-service)).
3. For hovers and clicks, turn the desktop icons off ([Hover, clicks and ding](#drawing-the-cockpit)): on Ubuntu,
   `gnome-extensions disable ding@rastersoft.com`.
4. `bash scripts/resource-pulse-status.sh` says `cockpit: active, protocol 1, …`.

The template fills three of the grid's four columns: the `machine` group, two columns wide, holds `system`, `apps`
and `connections`, and the `agents` group, one column wide, holds `sessions`.

**Where.** The cockpit monitor is the one the config's `monitor` block names, its `vendor` and `product`
both equal to what Mutter's DisplayConfig reports; else the only monitor; else the largest one that is not
primary. It is chosen again whenever the monitors change, so an undock moves the grid to the monitor that is
left. The grid is drawn where the columns and rows the layout uses fit the work area, each column wide enough
for the cards' content and each row as tall as the system card. For the template that is a work area of at least
1274×644, so a 1536×960 laptop panel draws it, under its top bar too, and so does a 1280×720 one. A layout of
three rows needs 952 pixels of height, more than that panel has under its top bar, and one of four columns
needs 1691 to 1736 pixels of width. Where the layout does not fit,
the desktop card is drawn top right instead, as with no layout, and the journal says so once, naming the length
that is short (`the cockpit grid needs a work area at least … for this layout`). The remedy is fewer columns or
rows in `cockpit.json`, or a larger monitor: the grid comes back when it fits again, at a dock. An edit to the
layout made while the grid is held back draws the grid as soon as the service hears it, if the new layout fits:
the extension follows the service's `Changed` while it is enabled, whether anything of the cockpit can be seen or
not. At a login's first enable the desktop card sits top right until
the service's layout arrives (a first answer that fails or does not come in 2 s is asked for again after 5 s,
then 30 s, then every 300 s), then the grid replaces it; from then on the extension keeps the last layout
across disables, so an unlock or a blank draws the grid at once. A layout that names no `system` card draws
no system card. The overview hides the grid as it hides the card. The lock screen draws none of it, since
GNOME turns the extension off there: it shows the lock screen's own background.

The template names no monitor, so a config made from it takes the only monitor, else the largest that is not
primary. To name one, add `"monitor": {"vendor": "…", "product": "…"}` to the config, with the values Mutter
reports. This read-only call lists them; in each monitor's first group of four strings, the second and third are
its `vendor` and `product` (the first is its connector, such as `DP-1`):

```bash
gdbus call --session --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig --method org.gnome.Mutter.DisplayConfig.GetCurrentState
```

**The grid.** Up to four columns by three rows: as wide as the columns the layout uses and as tall as the rows
it uses, centred on the cockpit monitor's work area. The groups sit left to right, each `columns` cells wide under
its caption, and fill their cells left to right, then down. At a work area of 1920 × 1080 logical pixels the cells
are 420 × 300, 24 apart inside a group and between rows, 48 between groups, under a 28-pixel caption row. On a
larger work area every length scales by the smaller of its width over 1920 and its height over 1080, up to double.
On a smaller one the lengths keep their 1920 × 1080 size while the grid fits inside a 12-pixel margin on every
side, and shrink just enough to fit where it does not. Every length is rounded down. A card fills its cell, and a
row is never shorter than the system card, which is 286 pixels tall at the default text size: where the scaled rows
would be shorter, each keeps 286 and the grid is taller by the difference. The system card's content keeps its own
size, so in a cell larger than the card (420 × 300 at a work area of 1920 × 1080, and larger on a larger one) it
stands at the cell's top left and the rest of the cell is the card's empty surface. The sizes assume GNOME's default
text size and font: with larger text, or a larger font, the system card is both wider and taller than its cell,
and runs into the next card ([issue #12](https://github.com/ZviBaratz/resource-pulse/issues/12)). There are four cards,
`system`, `apps`, `connections` and `sessions`, each drawn in the first cell of its id: a second cell of the same
id stays empty under its caption, and a group's cards past its `columns` × 3 cells get none.

**The cards.** Every card, the desktop card too, has one surface: a dark vertical gradient, a faint highlight
along its top edge and a faint border, with no shadow. The desktop card, which the system cell holds, draws CPU in
teal and memory in purple, as the top bar does; a working session and a VPN that is up take the CPU's teal. Every
row of the apps, connections and sessions cards shows a tooltip once the pointer has rested on it for 300 ms.

- **System** is the desktop card itself, as [How it runs](#how-it-runs) describes it. A click opens
  Resources (else System Monitor).
- **Apps** lists up to six of the heaviest by CPU ("kernel" and "short jobs" among them when they rank),
  each with its share of the whole machine and a faint bar of it, then, under a divider, up to six apps by
  memory, each with a bar against the largest: the sampler's rankings
  ([Every number, defined](#every-number-defined)). A row's tooltip names the group it was ranked as, such
  as `unit:docker.service`.
- **Connections** lists the uplink, what kind of link it is and whether the internet is reachable over it:
  `wired` (`wired · wifi off` when Wi-Fi is turned off) or `wifi`; `wired · limited` or `wifi · portal` when
  NetworkManager reaches the internet only in part; `wired · no internet`, with the offline icon, when not at
  all; `online` when the primary connection is neither, such as a VPN on a full tunnel or a tethered phone
  (its tooltip says so), and `offline` when NetworkManager finds no internet over it, as with no link at all;
  `uplink unknown` without NetworkManager, or while it has not judged a link that is neither. Its tooltip
  gives NetworkManager's verdict, `internet: <connectivity>`. Then the VPN (`VPN up (tun0)` or `VPN down`,
  its icon teal while up and grey while down or unknown), the SSH masters (`3 live ssh masters`), then one
  row per mount, in the service's order: its icon (a disk for a local disk, a remote folder for a network
  share, a removable drive for a removable disk), its label and free space, with a bar of the space used, and
  its mount point, filesystem type and size in the tooltip, a line too long for the tooltip cut at its end.
  Five mounts at most; the rest are counted on a `+N more` line. The service lists the local disks first, so
  they are always among the five.
- **Sessions** has a header (`SESSIONS`, how many, each state's icon with its count, and their memory in
  all; working, blocked, idle and done keep their places at 0, and unknown shows only while a session is
  in it), then up to six sessions by urgency, the rest counted on a `+N more` line. The order puts the sessions in
  groups: first those waiting on you (blocked), the longest idle first; then those working, the largest memory
  first; then done, idle and unknown, each the most recently active first. Done comes before idle, since herdr's
  `done` is ready for input and not yet seen. So a session waiting on you is never hidden behind a session that is
  not waiting on you. A waiting session with no transcript is ordered by its Claude process's age, which is an upper
  bound on its wait, so for it "the longest wait first" may not hold. A session missing the one value its group is
  ordered by (memory for working, idle age for the others) goes last in that group, and ties are by name. A row
  shows its state's icon (working: a teal play; blocked, waiting on you: an amber warning; idle: a grey pause;
  done: a green check; unknown: a grey question mark), the name, the idle age (`*` when only the Claude
  process's age is known), the memory and a bar against the largest session's, drawn or not. An idle or done
  session idle 30 minutes or more is dimmed, and a blocked one's name is tinted amber. The tooltip gives the state (a
  blocked one's as `waiting on you`), the herdr pane, the account and the context used when they are known,
  and says the memory is the Claude process's alone (MCP servers and tool shells not counted). Without herdr
  the card says `herdr not running`.

**Take me there.** A click on a session row asks the cockpit service to focus that session's herdr pane,
then brings forward the window that shows it, as a dock click does: it switches to the window's workspace,
unminimizes and raises it, which ends `Super+D`. Clicks are taken one at a time: a click while the last
one's answer is awaited (up to 2 s) does nothing. The window is found by process: one whose process is the
herdr client or one of the client's parents, preferring one on the active workspace, then the topmost. So
herdr running inside tmux matches no window (the tmux server, not the terminal, is the client's parent): the
pane is focused and nothing comes forward. A terminal that runs all its windows in one process can bring
forward another of its windows. Each reason nothing came forward is one line in the shell's journal, at
most once in 10 minutes for each reason ([Checking that it runs](#checking-that-it-runs)).

**Freshness.** Each card is judged covered on its own, as the desktop card is, on the cockpit monitor. A
covered card is frozen and dimmed, and repainted, still dimmed, at most every 30 seconds; a revealed card
(`Super+D` reveals them all) draws at once the latest the extension holds. Only while a card of the grid
can be seen outside the overview, or while the dropdown is open, does the extension hold the cockpit
service's watch (which samples every source at once, then the sessions every 10 s rather than 60: the
sessions a reveal draws at once give way to those sampled at the reveal from the next sample on). It follows the
service's `Changed` whatever is seen, at the unwatched pace while nothing is: the grid then holds what it hears and
draws none of it, and the first card seen again draws the latest at once. While a card is seen, a change is drawn
on the next sample, about 2 seconds later, or, by a one-shot timeout, after 3 seconds if the sampler is silent. A source the service stopped refreshing makes its whole card give way to
`no data since HH:MM`, the oldest last sample of the card's sources: a stale mounts source hides the uplink,
VPN and SSH rows too. A source's last sample is judged against three of its intervals; one taken while the watch
was held, judged after it was dropped, against three of its unwatched ones, since the service samples it next only
at that pace. So a card revealed soon after it was covered is not called stale, and a source that truly stopped
still is, within three unwatched intervals of its last sample. If the cockpit service goes away the grid stays: the system and apps cards keep drawing
from the sampler, the others say `no data since HH:MM`, and the extension starts the service again at its next
enable (systemd restarts one that crashed before then).

**The dropdown** shows the sessions card under its system card once the cockpit service has answered, with
the same rows and tooltips, live while the menu is open: it opens on the sessions the extension holds, and
those sampled as it opens follow within a few seconds. A row's click closes the menu, then takes you to the
session.

**Hover, clicks and ding.** The cards take the pointer only while no desktop-icons window (ding's) shows on
the cockpit monitor, since that window would take the clicks. With ding on they are display-only: no
tooltip and no click. Turning ding off is step 3 of turning the cockpit on (above); it costs the desktop's
icons and its right-click menu.

**Without the file,** the extension draws exactly what it draws with no cockpit: the card top right of the
primary monitor, and the dropdown with its system card and **Open Resources**. systemd skips the unit at each
enable, which ends the extension's asking until the next. Masking the unit
(`systemctl --user mask resource-pulse-cockpit.service`) turns the cockpit off the same way from the next login,
the file kept: the extension takes the mask as it takes a missing file, with no retry and no warning. The status
report does warn, though: with the file there it reports `cannot load (LoadState=masked)` with a ⚠ on every run, so
removing the file is the quiet way off.

**When the grid cannot be drawn,** because a layout cannot be built, rebuilt or placed, the card stays top
right, as without a cockpit, and the shell's journal holds one line saying so
([Checking that it runs](#checking-that-it-runs)). That layout is not tried again until the service sends
another, nor kept for the next enable.

**Tiles built and not yet drawn.** The Heaviest and Connections tiles (`heaviestTile.js`, `connectionsTile.js`, on
the base every tile shares, `cockpitTileBase.js`) are in the extension but nothing draws them yet: the grid above
draws the cards. What they will show:

- **Heaviest** puts the two rankings side by side, "by CPU" and "by memory": a name, a bar against the largest of
  its own ranking (teal for CPU, purple for memory; an idle machine's rows read 0 %, each bar its 1 px mark) and the
  value, in the apps card's words and tooltips. Under its stop width the rankings stand 24 px apart; at the stop and
  wider, 40 px, and each name gains 36 px. With no rankings it shows the apps card's "no data" line under its title.
- **Connections** comes in two forms. As a list: its title, the uplink's, the VPN's and the SSH masters' rows, then
  under a rule each mount with its bar and free space ("212G free": whole GiB from 10 G, one decimal under), the
  mounts at fault first ("no answer", amber), then the local disks, then the rest; every mount where all fit and
  there are at most five, else as many as leave a line for "+N more". In one line: no title, "Wi-Fi", "VPN tun0",
  "SSH 5", then as many mounts as fit, each with its free space, and "+N more", the links 32 px apart from the left.
  A caution (no internet, a mount at fault) is amber; in the line it is its amber icon alone. A wired or Wi-Fi link
  with no internet says "no internet"; with no link at all the tile says "Offline", amber words in the list and
  plain words beside the amber icon in the line. The VPN's interface is teal while it is up. A mount whose sizes are
  not known has a dashed rule in place of its bar.
- **Both** are built once, with every actor either form shows; an update sets a text, class or length only where it
  changed. Covered, a tile records its update and dims its content (not its surface) to 42 %; the reveal draws the
  latest, and a tile covered before it ever drew draws its first update as soon as it is shown. When a layout or an
  update moves the row under the pointer, its tooltip hides until the pointer enters a row again. Each draws through
  its own offscreen texture, and its lengths are the fixed parts in `lib/drawingConstants.js` with the line boxes the
  measurer reads, so a tile's heights are the layout's.

**The tiles' widths that hold text.** Heaviest's, Connections' and the Sessions tile's (`sessionsTile.js`, built
and not yet drawn too) are fixed parts with the widths the measurer reads of each tile's sample texts in their own
classes: Heaviest's `docker.service` and its widest value; a mount's `nas-media` and the wider of `888G free` and
`no answer`; the line's words; a Sessions row's widest age and memory and its two names. Each is the tile's own sum
(`lib/measuredTextWidths.js`) and a width of the composition's default sizes (`DEFAULT_COCKPIT_SIZES`). Heaviest
and Sessions are handed the widths they are summed from; Connections lays itself out from its own texts' widths,
and its widths size it in the layout alone. A tile is measured whole or not at all: where a reading it needs is
bad, every width of it keeps its default, in the tile and in the layout, and the layout's defaults hold the tile's.
So at any text size the width the layout gives Heaviest or Sessions is the width it lays itself out against, or,
fallen back, holds it. In Ubuntu Sans at 11 pt, at text scaling 1, they are Heaviest's least 438 and stop 622, the
list's 255 and 331, the line's least 571, and a Sessions column's least 373 and stop 503.

**The monitor tile** (`monitorTile.js`, laid out by `monitorLayout.js`, on the same base) is built the same way, and
nothing draws it yet either. In its wide, medium and small forms:

- CPU and memory are traces on one five-minute plot, each under its label and its scale: "CPU" and "100%",
  "Memory" and the memory installed ("30.3 GiB"), a faint dash while there is no memory reading.
- Right of the present's rule (with a tick at the top, middle and foot of each trace) stand each figure, its unit
  and the lines under it: CPU's clusters, or since when there is no data; memory's swap. The figures, the lines and
  the meters are the desktop card's own words, so a number reads the same on both.
- Under the plot, a label at each minute from "5 min" and "now" at the rule.
- A trace is never shorter than its figure and the lines under it. At the default text size the forms fit as they
  are; at larger text a form needs more height (`lib/monitorGeometry.js` `monitorHeightNeedPx`), and the composition
  is to give it that.
- Its width only lengthens the plot: 76 px of paddings and gaps and the now column stand beside it.
- Under "Waiting on", each resource's pressure over the same five minutes as a strip of cells, under the traces'
  own moments, and beside the now column its meter, name and percentage: the desktop card's strips and meters at
  this size. While the sampler publishes no pressure history the strips have no room, and the three meters stand in
  one row under "Waiting on". A meter is redrawn only when its band or amber changes, and a strip only when its cells
  do, so a calm machine redraws neither.
- In the wide form, where the layout has a sessions card, the agents track under the strips, with "7 agents working"
  beside it ("1 agent working", "0 agents working"; a dash while the count is not known). The tile draws the cells of
  the recorder it is handed and records nothing itself: whoever places it tells the recorder each Sample and each
  sessions reading, then tells the tile (`showAgentsWorkingCount`). A count that comes between two Samples is shown at
  once while the tile can be seen, and otherwise at its next render. The recorder (`lib/agentsTrack.js`) keeps one
  slot per Sample, as the client's histories gain them, grouped five to a cell from the newest as the strips group
  theirs, so a cell stands under the strips' moments. A cell holds the most sessions working in it and, as a cap,
  whether a session blocked in it is blocked still. Its drawing (`monitorGraph.js` `drawAgentsTrack`) puts each cell
  exactly where the strips put theirs: a bar from the foot in the CPU trace's teal, its height its count against the
  most in the five minutes (never under 2 px), a 1 px dash where no one was working, and a 2 px cap at the top, amber
  while that wait goes on and faint once it has ended.
- **What is kept across a lock.** The extension is disabled while the screen is locked. It keeps the agents track's
  recorder across that, as it keeps the last good time: built once, with the extension, and told from each enable on
  of every Sample (the newest Sample's time, read without parsing its snapshot) and every sessions reading of the
  cockpit client (none while the client is not live or the source is stale). Across a lock it holds the last five
  minutes of counts, the ids of the sessions seen blocked (the same opaque ids the cockpit service sends, so a cap can
  say after the unlock whether that wait goes on), and the last Sample's time. It is plain data in the shell's memory:
  nothing is written to disk or sent anywhere, and it is gone at a logout or a restart. The time locked becomes empty
  cells, counted from the Samples' own times; a lock of five minutes or more leaves the track empty, filling again
  from its right. Keeping only each cell's cap and no id is a change to one constant
  (`AGENTS_TRACK_KEPT_ACROSS_DISABLE`).

## Every number, defined

| Number | Definition | Source |
|---|---|---|
| CPU busy % (total) | `1 − Δ(idle+iowait) / Δtotal` over the interval. `total` = user+nice+system+idle+iowait+irq+softirq+steal. guest/guest_nice are excluded because the kernel already counts them in user. 100% = every core. | `/proc/stat` `cpu` line |
| P / E busy % | The same formula over the per-CPU lines of each cluster. | `/proc/stat` `cpuN` lines, cluster map below |
| Cluster map | The hybrid PMU (`/sys/devices/cpu_core/cpus`, `/sys/devices/cpu_atom/cpus`). Fallback: group by distinct `cpu_capacity`. Fallback: one cluster, and the P/E row is hidden. | sysfs, read once when the service starts |
| Memory used | `MemTotal − MemAvailable`, shown as "16.4 of 30.3 GiB" in the top bar's hover label, and on the card as the figure "16.4 GiB" over "of 30.3". It already includes zram's RAM cost. | `/proc/meminfo` |
| Swap | "swap 1.6 · 0.4 in RAM", under the memory figure, in its GiB. The lead number is zram's swap alone: Σ `Used` of the `/dev/zram*` areas in `/proc/swaps`. In RAM = Σ zram `mem_used_total` of those same devices, the only `mm_stat` files read (a zram device that is not a swap area does not count, and `/sys/block` is never listed). **Swap on disk** = Σ `Used` of every other area. It is shown only when it is above 0, as a separate "+ X on disk" line that adds to the lead number, because paging to disk is a real "why slow" signal; the line is amber while the machine is **swapping**: swap on disk at least 1 MiB larger than five Samples (10 s) before, over six Samples in a row, each of which the extension reads, the card covered or not. With no zram swap in use the line is "swap X on disk"; with nothing in use, "swap none"; with `/proc/swaps` unreadable, "swap no data". zram's `orig_data_size` is not used: it under-counts zram's share of swap (same-filled pages, slot use), and a formula built on it reported disk swap that did not exist. | `/proc/swaps`, `/sys/block/zram*/mm_stat` |
| Waiting on | PSI `some avg10` for cpu, memory and **io**. It is a 10 s average by definition, so it lags on purpose. Each is a drawn meter of three cells (not glyphs, which fell back to another font): none filled < 10%, one 10–25%, two 25–50%, all three ≥ 50%. The top band matches oomd's 50% kill limit. With no data the cells give way to a dash, so it never reads as calm. Beside each meter its name and its avg10 as a whole percentage; from 25 % (two cells) the meter's cells and its percentage are amber: the resource is **waited on**. With the sampler's pressure history (`histories.pressureAvg10`, one avg10 per Sample for five minutes), each resource's strip shows those five minutes in 10 s cells, each the highest band of its five Samples. | `/proc/pressure/*` |
| App CPU | Each leaf cgroup's Δ`cpu.stat usage_usec` / (interval × ncpu), as a % of the whole machine, so it is comparable with the total. | cgroup v2 |
| App memory | Each leaf cgroup's memory **minus reclaimable page cache**: `memory.current − (active_file + inactive_file)`. This matches the MemAvailable semantics, so cache never counts as used. A leaf at or under 64 MiB (`APP_MEMORY_STAT_MIN_BYTES`) ranks by `memory.current` as it is: too small to top the ranking, so its `memory.stat` is not read. | cgroup v2 `memory.current`, `memory.stat` |
| "kernel" | A computed CPU-only entry: the root `/sys/fs/cgroup/cpu.stat` Δ minus the Σ of the scanned **parent slices'** Δ, clamped at 0. The parents are listed afresh every scan: every slice directly under `user@<uid>.service` (`app.slice`, `session.slice`, `background.slice`, and any a `systemd-run --user --slice=` job makes) and every top-level slice but `user.slice` (`system.slice`, `machine.slice`, and any other), so a VM, a rootless container or such a job is named, not counted here. That leaves kernel threads, irq, reclaim, zram compression, PID 1, the user managers and login-session scopes. It is ranked only when every parent has a delta and both listings succeeded: with none read, "root minus zero parents" would name the whole machine. It is **not a memory candidate** (by design): the memory half of "heaviest" names real apps only, and unattributed memory still counts in the MEM total. | root and parent cgroups |
| "short jobs" | A computed CPU-only entry: Σ over the scanned parents of max(0, the parent's Δ minus the Σ of its leaves' Δ). These are units that started and ended between two scans (timers, oneshots); a parent whose leaves exceed its Δ (read skew) adds 0. A leaf whose counter went backwards (a unit recreated at the same path) counts its current value; a leaf absent from the previous scan counts its full usage only when its parent was listed in that scan. | parent cgroups |
| Heaviest | **On each trace's label line**: the top entry by CPU (an app, "kernel" or "short jobs") beside "CPU", and the top real app by memory beside "Memory", for example `CPU Chromium 31%` and `Memory Firefox 2.1G`. A name ellipsizes to what the plot's width leaves it; the numbers are never cut. When the top CPU entry is below 1% of the machine the CPU line reads `idle`, with no number. The service also publishes the first 10 of each ranking (`cpuRanking`, `memoryRanking`, `APP_RANKING_LENGTH`) for the cockpit's apps card, which draws the first six of each. | the two rankings above |
| Names | The launcher prefix is matched before unescaping, so `app-gnome\x2dcalculator-1234.scope` is the app `gnome-calculator`. `org.gnome.SettingsDaemon.Power.service` is `gsd-power`; any other reverse-DNS unit drops its first two segments (`org.freedesktop.IBus.session.GNOME.service` is `IBus.session.GNOME`). A snap is named through `<snap>_<app>.desktop` when that exists, else by its snap name. | cgroup names |
| Session state | herdr's `agent_status` for the session's Claude agent: `working`, `blocked`, `idle` or `done`; anything else, or none, is `unknown`. A session is one herdr agent whose `agent` is `claude`. The source also counts the sessions in each state. | herdr's `session.snapshot`, over its socket |
| Session name | The first that is set of: the herdr workspace's label, and the last segment of the session's cwd, through the name guard ([The cockpit service](#the-cockpit-service)); else `—`. | herdr's snapshot |
| Session idle | `idleSeconds`: the age of the session's transcript, which Claude Code appends to while it works, in whole seconds. With no transcript found it is the age of the session's Claude process instead, and `idleFromProcessAge` is true: that is an upper bound. Null when neither is known. The transcript is stat'ed at `~/.claude/projects/<project>/<session id>.jsonl`, where `<project>` is the cwd with every `/` and `.` turned into `-`, else looked for in every `~/.claude/projects/*` and `~/.clauth/profiles/*/runtime-*/projects/*` (each directory listed at most once per sample). It is never opened. | the transcript's mtime; `/proc/<pid>/stat` field 22 and `/proc/stat` `btime` |
| Session memory | `memoryBytes`: VmRSS + VmSwap of the pane's Claude process, picked from herdr's `pane.process_info` (its `argv[0]`'s file name is `claude`, or its `argv[0]` holds `/claude/versions/`, or its name is `claude`). Null when that process is gone. The service publishes the rows by it, largest first (unknown last, ties by name), and the source's total is the sum of the known ones; the cards draw them by urgency ([Drawing the cockpit](#drawing-the-cockpit)). | `/proc/<pid>/status` |
| Session account | `account`: the session's `acct` sidebar token, through the name guard. Null without one. Nothing in this repository publishes the token: whatever reports a session's status to herdr may. | herdr's snapshot |
| Session context | `contextPercent`: the percent in whichever of the `ctx_ok`, `ctx_warn` and `ctx_crit` sidebar tokens the session has (`▅ 62%` gives 62). Null without one. | herdr's snapshot |
| Session state history | `stateHistory`: the session's state over the last hour, one letter a minute (`w` working, `b` blocked, `i` idle, `d` done, `u` unknown), the oldest first and the current minute last, 60 letters at most. A cell is the state at the minute's last sample, by the wall clock; a minute with no sample repeats the cell before it, so on battery, or after a suspend, cells repeat. A history belongs to a pane and a Claude session id: a Claude restarted in its pane starts a new one under the same row `id`, and a session gone from herdr's snapshot is forgotten. While herdr is not running nothing is recorded and nothing forgotten. A wall clock set back overwrites the last cell and adds none, so a clock that was ahead at a session's first sample and is then corrected holds that history at one cell until real time reaches it. The service keeps the histories in memory only, so after it starts every history is shorter than 60 letters: the minutes before the first letter have no cell yet. A reader takes a letter it does not know as `u`, and a missing field (a service older than it) as null, which is not the empty string. | herdr's snapshot, at each sample |
| VPN up | True when a route on a tunnel interface (`tun*`, `tap*`, `wg*`) goes via a gateway or is a default route. The interface named is the first tunnel interface in the table, up or not. | `/proc/net/route` |
| Uplink | `kind`: `wired` when NetworkManager's primary connection is `802-3-ethernet`, `wifi` when it is `802-11-wireless`, `none` otherwise. `connectivity`: NetworkManager's own verdict, `full`, `limited`, `portal` or `none`, and `unknown` for anything else. Beside them, whether Wi-Fi is enabled. With no NetworkManager on the system bus, all three are null. | NetworkManager's `PrimaryConnectionType`, `Connectivity`, `WirelessEnabled` |
| SSH masters | The number of entries in `~/.ssh/sockets`, a common `ControlPath` directory for SSH's connection sharing, listed and never opened: 0 when the directory is missing, null when it cannot be listed. | the directory's names |
| Mounts | Network shares (a filesystem type of `cifs`, `smb3`, `nfs`, `nfs4`, `fuse.sshfs`, `fuse.rclone`, `davfs` or `afp`), the local disks (`kind` `local`: the root filesystem, and `/home` unless it is beside a `/` row on the same device, as a btrfs subvolume or a bind mount of a directory of `/` is; neither while mounted read-only, as an image-based system's root is, since nothing on it can fill, nor an automount point, type `autofs`) and removable disks (mounted under `/media/`, `/run/media/` or `/mnt/`); a network type wins, so a share mounted at `/home` is a share. A mount point the mount table lists twice, as an automount point and the filesystem mounted on it, is judged by its last entry, the mount seen there, and gives at most one row. The local disks first, then the rest sorted by mount point. An extension older than the `local` kind drops those rows and lists the rest in the same order. The label is GIO's guess at the mount's name, else the mount point's last segment, through the name guard. Free and total are the filesystem's own. The total is published exact, and on a filesystem of 10 GiB or more the free space to the tenth of a GiB the card draws, 0 included, so free space moving within a tenth sends no `Changed`; a smaller filesystem's free space is exact, so its bar stays true. They come from a query given up after 2 s, as on a hung share: that row's sizes are then null, and the row stays. One query per mount point runs at a time. A local disk is queried the same way, so not even a stalled one can hold the sample longer than that. Where a size is null, `noSizesReason` says why: `query-failed` (the query failed), `no-answer` (no answer within those 2 s, or the mount point's last query still runs), `not-reported` (the filesystem gives no size: it answered without one, or does not support the query) or `not-permitted` (the query is refused with permission denied, as where a directory above the mount point is closed to this user, like another user's `/run/media/<user>/<disk>`). It is null where both sizes are known. With it a client can tell a share that is down or hung (`query-failed`, `no-answer`) from a filesystem with no size to report. The other two are no fault, but they do not mean healthy, only not known to be down: GIO reports no size for a FUSE filesystem with no free blocks, so a completely full FUSE disk reads `not-reported`, and a share may read `not-permitted` once this user's credentials for it lapse. A row of type `autofs`, an automount point with nothing mounted on it, is no fault whatever its reason: while its server is out of reach, its query reads `no-answer` or `query-failed` at every sample. From a service older than the field it reads as null, not said, which is no fault. The cards do not draw it. | the mount table (`GioUnix`), `filesystem::free` and `filesystem::size` |

The rows from Session state on are the cockpit service's, in `GetState`; the cockpit's sessions and
connections cards draw them ([Drawing the cockpit](#drawing-the-cockpit)).

## Enabling it

The extension is a link in `~/.local/share/gnome-shell/extensions/`, and its two units are links in your systemd
user unit directory ([Adopting it, step by step](#adopting-it-step-by-step)); linking them does nothing by itself.
GNOME on Wayland discovers a new extension only at login, so log out and back in once after linking it, then:

```bash
gnome-extensions enable resource-pulse@zvibaratz.github.io
```

The extension loads at once and starts its services itself. GNOME 50 loads it only while:

- its uuid is in `enabled-extensions` (`org.gnome.shell`) and not in `disabled-extensions`, which wins over
  `enabled-extensions`;
- `disable-user-extensions` is false: when it is true, nothing user-installed loads;
- `allow-extension-installation` is true: when it is false, GNOME 50 skips the user extension directory, where
  the extension is linked.

The status report names whichever of these keeps it from loading ([Checking that it runs](#checking-that-it-runs)).

To turn it off, `gnome-extensions disable resource-pulse@zvibaratz.github.io`. The service runs on until logout;
`systemctl --user stop resource-pulse.service` ends it at once.

## Checking that it runs

`scripts/resource-pulse-status.sh` prints, for example:

```
Resource Pulse: linked=yes enabled=yes state=ACTIVE
  service: active, protocol 1, last sample 1 s ago
  cockpit: skipped (no ~/.config/resource-pulse/cockpit.json)
```

It only reads, and runs nothing that builds, starts or changes anything. It takes no argument (any argument is a
usage error, exit 2), and exits 0 after its report, whatever the report says. It runs from any directory, and asks
the build script and the module-closure helper of its own checkout, the one it lives in (a link to the script is
followed first); `RESOURCE_PULSE_ROOT` names another checkout.

- `enabled=` reads `enabled-extensions` itself, and says `yes (starts at next login)` while the shell
  does not know the extension yet (enabled after linking, before the next login).
- `state=` is the shell's own verdict (`ACTIVE`, `ERROR`, `OUT OF DATE`), so a failure after a GNOME
  update is visible. When `enabled-extensions` asks for it but it is not `ACTIVE`, the next line names
  what keeps it from loading: it is also in `disabled-extensions`, which wins in GNOME 50, or one of
  the two settings in [Enabling it](#enabling-it).
- `service:` is the unit's state, from its `LoadState`, `ActiveState` and `SubState`: for an active
  service, also the protocol and the age of its last sample, asked with `GetState` through `gdbus`.
  Every call to `systemctl` and `gdbus` is bounded at 3 s ("no answer", or "unknown", otherwise), and
  every call to `scripts/resource-pulse-sampler-build.sh` at 5 s, killed 2 s later if it ignores its
  TERM: `--check` gives the installed program 2 s to answer (`--program-timeout-seconds 2`), so one
  that does not is named, and has 3 s besides for hashing the checkout.
  `RESOURCE_PULSE_STATUS_CALL_LIMIT_SECONDS`, a whole number of seconds from 1, replaces both bounds,
  and puts `gdbus`'s own reply timeout a second inside them (never below 1 s). It leaves the program's
  2 s unchanged, so at 2 or less the build-script call runs out first, and is named instead of the
  program. Set to anything else (`0` or empty too), it is a ⚠ naming the value, and the default
  bounds hold. A call that runs out of its bound says which bound.
- `cockpit:` is the cockpit service's line; its forms are in [The cockpit service](#the-cockpit-service).
- A ⚠ line follows, with its own remedy, for each of:
  - the service **failed**, or is **restarting after an unplanned end** (`auto-restart`): its journal;
  - while the extension is enabled (and not also disabled), from the first login after linking on:
    the unit is **not installed** (never linked: the line names
    `systemctl --user link --force <checkout>/systemd/resource-pulse.service`, whose `--force` replaces a stale
    link left by a checkout that moved); it **cannot load** (`systemctl --user status`); it is **not running**
    (`systemctl --user start`), except while the desktop runs an older copy of the extension, which need not
    start it; or it is still **starting**;
  - it does **not answer**, or it has **not sampled for more than 6 s**, compared to the
    microsecond as the extension does (it shows no data then);
  - it **runs an older program** than the one installed: the installed sampler program
    (`~/.local/lib/resource-pulse/resource-pulse-sampler`, followed through a link) changed after the
    unit started, as when the refresh step's restart failed (`systemctl --user try-restart
    resource-pulse.service`). It is compared as the refresh step compares it, against the start read
    to the microsecond, so a program the build wrote in the same second before its restart is not
    older. It is a **cannot tell**, never silence, when that start cannot be read (or the `find` first
    on `PATH` cannot read it, as bfs cannot: the line names that `find`), when where the
    program is installed is not known (`scripts/resource-pulse-sampler-build.sh --installed-path`
    fails, does not end within 5 s, or does not print one absolute path), or when the program is
    behind a directory that cannot be searched (never "not there"). One cause gives one ⚠: after a
    `--check` that cannot tell, this adds no cannot-tell of its own;
  - the **installed program is not this checkout's**, in whatever state the unit is in (a missing
    program is why it is `failed`), while the extension is linked: the line is
    `scripts/resource-pulse-sampler-build.sh --check`'s own (`missing: … is not installed; build and install it
    (it needs cargo)`, or `is not this checkout's: …`), then
    ` — run bash <checkout>/scripts/resource-pulse-sampler-build.sh`; a `--check` that cannot tell, does not end
    within 5 s or cannot be run is a **cannot tell whether the installed sampler program is this checkout's**,
    never silence;
  - **the desktop runs an older copy**: a module the shell runs (`extension.js` or one it imports)
    changed after this login, and takes effect at the next. A module only the cockpit imports does not
    count, and neither does a stylesheet change, since GNOME re-reads the stylesheet at every enable;
  - it **cannot tell** the older-copy question, because what `extension.js` imports could not be
    worked out (the line names the helper to run, which says why). The sampler is a program, not
    modules, so nothing of it is on an import closure; the cockpit's and the shell's are.

The service logs to its unit's journal, `journalctl --user -u resource-pulse.service`; the extension
logs under `resource-pulse:` in the shell's, `journalctl --user -b -g resource-pulse`. Each distinct
message appears at most once per 10 minutes. The cockpit service logs to its own unit's journal,
`journalctl --user -u resource-pulse-cockpit.service`, every line prefixed `cockpit:`. Among the cockpit's lines in the
shell's journal:

- `resource-pulse: could not draw the cockpit layer, so the card is drawn top right: <error>`: the grid
  could not be built, rebuilt or placed from the service's layout ([Drawing the cockpit](#drawing-the-cockpit)).
- `resource-pulse: the cockpit grid needs a work area at least <n> px tall for this layout (it is
  <width>x<height>), so the card is drawn top right`: the layout's grid does not fit the cockpit monitor's work
  area, written once as that begins. It says `<n> px wide` when the width is what is short, and
  `<width>x<height>` when both are ([Drawing the cockpit](#drawing-the-cockpit)).
- `resource-pulse: could not read the cockpit layout (<error>), so the card is drawn top right`: the service
  could not read `cockpit.json`, as the status report says it. Among the errors: `missing` with no file or one
  that cannot be read, `config: malformed JSON` for text that is not JSON (a half-typed save included),
  `config: expected a JSON object` for JSON that is not an object, or the first field it found wrong, such as
  `groups[1].caption: expected a non-empty string`; the grid goes. Once the file reads again the grid comes back
  the next time the extension reads the cockpit's state, which is when the dropdown opens, when the screen comes
  back from a lock or a blank, or when `resource-pulse-cockpit.service` starts again: it does not come back by itself while only
  the card top right is on screen.
- `resource-pulse: cockpit: focus: <reason>`: a session row's click brought no window forward. The reason is
  one of `FocusSession`'s five error codes ([The cockpit service](#the-cockpit-service); `internal` also when
  the call itself failed or got no answer in 2 s), `not focused`, or `no window for pids [<pids>]` when herdr
  focused the pane and no window's process is among them. Each reason is logged at most once per 10
  minutes, and a new one at once.

## Trying changes in a nested shell

Never restart the live shell to test a change, and never use the plain
`dbus-run-session gnome-shell --devkit --wayland` recipe: even with its own config, data and cache it
writes the live session's crash-guard file, takes a logind inhibitor and sets the live session's
locked hint, registers with GDM and GeoClue, and posts your extension list to extensions.gnome.org.
Use `scripts/resource-pulse-nested.sh`, which starts a headless nested shell that can reach none of
that, with a copy of the checkout's extension enabled and its sampler and cockpit services on the same
private bus:

```bash
scripts/resource-pulse-nested.sh start        # prints the nested shell's private bus address
scripts/resource-pulse-nested.sh start --gc-log --replay   # or: collections logged to log/shell.log, fixed input
scripts/resource-pulse-nested.sh start --replay --monitor-size 1536x960   # or: a monitor of another size
scripts/resource-pulse-nested.sh start --replay --monitor-size 3840x2160 --monitor-scale 2   # or: a scaled one
scripts/resource-pulse-nested.sh start --gc-log --replay --no-cockpit   # or: no cockpit service, the card alone
scripts/resource-pulse-nested.sh eval 'Main.extensionManager.lookup("resource-pulse@zvibaratz.github.io").state'
scripts/resource-pulse-nested.sh screenshot card.png 2600 40 470 200   # x y width height, optional
scripts/resource-pulse-nested.sh scenario idle   # with --replay: idle, light, busy or strained (busy until asked)
RESOURCE_PULSE_NESTED_LIFETIME_SECONDS=3600 scripts/resource-pulse-nested.sh start --gc-log --replay   # for check cockpit
nohup scripts/resource-pulse-nested.sh check cockpit >check.txt 2>&1   # with --gc-log --replay and no window yet
scripts/resource-pulse-nested.sh window herdr-probe   # a small window, the cockpit's one window candidate
scripts/resource-pulse-nested.sh pointer 1200 400 click   # the nested pointer to x y (stage pixels), and a click
scripts/resource-pulse-nested.sh stop         # logs and screenshots stay in the run directory
```

Everything it creates is in one 0700 run directory under `$XDG_RUNTIME_DIR` (the path is
printed; `RESOURCE_PULSE_NESTED_BASE` picks another base, which must be yours with no group or
other access): a private runtime dir, HOME and XDG dirs, a private session bus that can activate
only dconf and a fake empty system bus with a fake GDM, both on path sockets inside the run
directory (never abstract sockets, which any local process could reach), an `env -i` allowlist (no
tokens, no live display or bus), nested settings that never lock, blank, use the network or check
for extension updates, and the extension-update apps masked. Without `--replay`, `start` first builds the
sampler program, the unit's own, with `cargo build --release --locked` into this checkout's build directory
(`scripts/resource-pulse-cargo-target-dir.sh`; `CARGO_BUILD_JOBS` caps it, 4 when unset), before any bus or
shell starts, and copies it into the run as `bin/resource-pulse-sampler`, so a rebuild while the run lives
swaps nothing; the build's output is `log/sampler-build.log`, and a build that fails refuses the run naming it,
with nothing started. The first build takes minutes, a later one seconds. With `--replay` nothing is built and
cargo is not needed. The run's own copies of the sampler program (or the replay service) and then the cockpit
service start on the private session bus before the shell, with the same allowlist, and the run refuses to go
on when either does not own its name within 15 s (their logs are `log/service.log` and `log/cockpit.log`, their
pids `service=` and `cockpit=` in `state/run.values`).
The cockpit runs in fixture mode ([The cockpit service](#the-cockpit-service)): it serves the run's
`state/cockpit-fixture.json`, written at the start from `gnome-shell/tests/fixtures/cockpit/nested-state.json`
with every source stamped then and none going stale within the run, and answers every `FocusSession` with
the fixture's reply, which names no window until `window` names one; it asks no herdr. The fixture's layout
is the template's groups with no monitor named, so the grid is drawn on the nested shell's one monitor. Its
lists are full, so every card is measured at its most: 42 sessions in every state (the sessions card shows six
and `+36 more`: by urgency, its five waiting on you and the working one of the most memory), named as a busy desk's
are, the longest 32 characters and 15 sharing a name with another (the card's fourth and sixth rows share a name; at
the default size its cells are wide enough to draw even the longest whole, which is its fifth), each with an hour's
state history ending in its own state (four of them younger than the hour), and nine mounts, the two local disks
first and one a share whose sizes did not answer, which its `noSizesReason` says (the connections card shows five
and `+4 more`). The replay ranks ten apps by CPU and ten by memory, as the sampler publishes; the apps card shows
six of each.
It sends the three pressure histories as the sampler does. Its `strained` scenario plays busy's CPU
walk under a 150 s cycle: 20 s calm, then cpu and io pressure past 25 % for 30 s and past 50 % for 30 s, 20 s past
25 % again and 50 s calm, while swap on disk grows by 1 MiB a tick through the first minute of strain and then
stops. In idle, light and busy the pressure stays under 25 % and no swap is on disk.
The extension's `StartUnit` finds no systemd there; that is expected, since it follows both services on the
bus whatever `StartUnit` answers. A run started with `--no-cockpit` starts a stand-in for systemd in the
cockpit service's place, which answers as a default install with no `cockpit.json` does: the cockpit's start
skipped on its condition, so the client stops asking, where with no systemd it would retry every few minutes.
Unsafe mode (which `eval` and `screenshot` need) comes from a throwaway helper extension that exists only in
that directory and refuses to act anywhere else, and every request (`eval`, `screenshot` and the rest) refuses
a run whose supervisor and recorded gnome-shell are not both running in its own session. A run lives at most
20 minutes (`setsid timeout`; `RESOURCE_PULSE_NESTED_LIFETIME_SECONDS` sets another limit). `stop` ends the
shell, both services (or the sampler and systemd's stand-in) and the windows `window` opened, and signals only
processes in the run's own session, only while that session is still led by the run's own `timeout`: a run
that already ended is just cleaned up, since its session id may since belong to something else. Any isolation
step that fails stops the run with exit 2, and a shell whose unsafe-mode helper did not load is reported
within 15 s. `start` returns once the shell answers with unsafe mode on and its own startup complete: until
then its startup animation scales the stage and the extension has not placed the grid for good, so a request
made at once would read a grid in passing. It needs gnome-shell and a GPU, so CI does not run it; its hermetic
rows are in the suite below.

**The monitor's size and scale.** The nested monitor is 3072 × 1920 unless `start --monitor-size
<width>x<height>` asks for another, in whole pixels, from 640x480 to 7680x4320; anything else is a usage error,
with nothing started. It is at scale 1 unless `start --monitor-scale <scale>` asks for another, a decimal from 1
to 4. Each is recorded in the run's `state/run.values` (`monitor-size=`, `monitor-scale=`), because the stage
that starts the shell runs under `env -i` and reads its options from there, and a recorded value that is not one
refuses the run before either service starts.
- **The scale** is set by a monitor config, `monitors.xml`, that the stage writes to the run's own config home
  before the shell starts, naming Mutter's virtual monitor at the run's size and scale. A run at scale 1 has none.
- **Mutter takes only the scales the monitor's mode lists.** At 3072x1920 those are 1, 1.3333334, 1.5, 2,
  2.6666667 and 3; a fractional one is named as Mutter lists it. Mutter leaves a scale it does not take at 1, with
  a warning in the shell's log and no failure, so once the shell answers `start` reads the monitor's scale, and a
  run not at the one asked for is stopped with exit 2, naming the scales its mode takes.
- **The stage is the monitor's size over its scale,** in logical pixels: at scale 2 on 3840 × 2160 it is
  1920 × 1080, drawn at twice the resolution. Every point and area the harness takes or gives (`pointer`,
  `screenshot`'s area, `check cockpit`'s points) is on the stage.
- Before its screenshot `check cockpit` rests the pointer 4 px in from the stage's left edge at half its height,
  inside the margin the grid keeps at any size. `perf`'s header names the run's size and scale: the figures under
  [What it costs](#what-it-costs) are for the default size at scale 1.
- `perf` and `check cockpit` judge the grid, so they need a stage whose work area holds the fixture's grid (the
  template's: at least 1274 × 644, [Drawing the cockpit](#drawing-the-cockpit)); on a smaller one the grid is
  held back, `perf` stops with exit 2 and `check cockpit` finds no grid.

**Driving the cockpit.** Three requests act on the drawn cockpit, each only in a live run:

- `window <title>` opens a small Gtk 4 window titled with a plain name, a client of the nested shell only,
  names its pid as the fixture's one window candidate, and prints the pid once the shell shows it. `stop`
  closes it.
- `pointer <x> <y> [click]` moves the nested shell's own virtual pointer to a point in stage pixels and,
  when asked, clicks the primary button there. A pointer that never arrives is exit 2.
- `check cockpit` judges the cockpit, in a run started with `--gc-log --replay` whose session has no window
  yet, one line a step: `ok`, `bad` or `could not judge`, never `ok` for a step it could not judge. The
  steps: the extension active and its log free of errors; the layer and the grid (each asked again for up
  to 5 s while bad, since DisplayConfig's answer, which places the grid again, may come just after `start`
  returns); the apps card's rows against the rankings the replay sends; hover; the clicks, with two windows
  of its own (from another
  window's focus, from every window minimized, a reply naming no window, one not focused, two quick
  clicks); cover and reveal, and between them one session more blocked in the fixture, which the top bar's disc
  must count with every card still frozen and no watch held; a source made stale and put back; the layout taken away (an unreadable
  `cockpit.json`, so the card goes back top right) and given back (the grid at its cells again, heard with
  nothing of the cockpit seen and no dropdown opened); the dropdown; the lock path (disable, then enable); a
  screenshot, `shots/cockpit-<pass>.png`, once window effects are over; the log; and the count budgets
  through `perf`, about nine minutes more. Exit 1 when a
  step is bad, else 2 when one could not be judged. It rewrites only the run's copy of the fixture. It may
  run again in the same run:
  each pass judges the log from where the last one stopped reading, and cannot judge the clicks whose one
  journal line the extension's 10-minute limit still holds from an earlier pass, and says how long is left.
  A pass takes about 9 minutes, its `perf` pass included, and a run lives 20 minutes by default, so start a run
  meant for it with `RESOURCE_PULSE_NESTED_LIFETIME_SECONDS` raised, as above: an hour holds a pass, a fix and a
  second pass.

**Stopping a `check cockpit` or a `perf`.** A stopped one first puts the run back: its windows closed, the
extension enabled, the top bar shown, the fixture restored. That takes about a minute, and up to a few
minutes when the nested shell does not answer; it says so on stderr. Leave it to finish: it ignores
`TERM` and `INT` until then, but a `HUP` or a `QUIT` (a closed terminal) still ends it, and a `KILL`
leaves the run changed. So start either one under `nohup`, with its output sent to a file, as above,
never through a pipe such as `| tee`: a pipe whose reader has gone can cut the put-back short.

## What it costs

**Inside gnome-shell.** The extension runs in the compositor, so its cost is budgeted per state: what it
adds over the same shell with it disabled, in % of one core.

| State | Budget |
|---|---|
| card covered, top bar on, idle machine | 0.08 |
| card covered, top bar on, busy machine | 0.20 |
| card visible | 0.25 |
| cockpit visible: its four cards and the top bar | 0.5 |
| card covered, under a window redrawing 60 times a second | 0.3 |
| the main thread's median per 2 s tick, card covered: idle, busy | 1 ms, 3 ms |

A percentage moves with the machine's load, so a change to the drawing side is gated on counts, which do
not. In a 60 s window:

| Count | Budget |
|---|---|
| major collections with the extension disabled | at most 4: more means something outlives `disable()` |
| major collections in any enabled state | at most one more than disabled |
| frames in any enabled state | at most the Samples, plus the disabled state's frames, plus 2 |
| frames with the card covered and idle input | at most the disabled state's frames plus 3 |
| top-bar paints while the top bar is hidden | none |
| the card's offscreen redirect | always |
| the offscreen redirect of each of the cockpit's apps, connections and sessions cards | always |
| an offscreen redirect of the cockpit's layer, or of the system cell's wrapper around the card | none |
| a one-shot fallback timeout (the cover check's, the layer's or the dropdown's) found armed at `perf`'s reading, with Samples flowing | none |

`scripts/resource-pulse-nested.sh perf` measures both, in the isolated nested shell and never on the live
desktop:

```bash
scripts/resource-pulse-nested.sh start --gc-log --replay   # or with --no-cockpit: the card alone
nohup scripts/resource-pulse-nested.sh perf >perf.txt 2>&1   # about 9 minutes; exit 1 names every count budget it found broken
scripts/resource-pulse-nested.sh stop
```

- **What it does.** It opens one `gnome-calculator` window in the nested session and measures five states,
  each after its own `scenario` request and 40 s to settle, over one 60 s window: disabled; covered with idle
  input; covered with busy input; top bar hidden and covered; visible with busy input. It prints one line a
  state (CPU, the median per tick, collections, frames, Samples, top-bar paints, the card's redirect) and
  then a verdict. It needs `gnome-calculator` and `jq`; a count it could not take is exit 2, never a pass.
  A nested run whose monitor holds the grid draws it from its fixture, so in the covered states every card of the
  grid is covered and in the visible state every card is visible; after each enabled state's counts `perf`
  reads the grid (a line a state), and a second verdict line names each broken cockpit budget, the last
  three rows above. A state not set up as it is named stops it with exit 2.
- **The card alone.** A run started with `--no-cockpit` starts no cockpit service, so the extension draws only
  the desktop card, top right, and a stand-in for systemd answers its `StartUnit` as a default install with no
  cockpit does: the cockpit's start skipped on its condition, never retried. `perf` then measures the same five
  states against the same count budgets, and its header says `the card alone`. No state may draw a grid (one that
  does stops it with exit 2), and no grid line is printed. The cockpit line says the grid's budgets were not
  judged, and a fallback line judges the one of them the card has with no grid: no fallback timeout armed while
  Samples flow, since the cover check's fallback is the card's own. `check cockpit` refuses such a run. A monitor
  too small for the grid is not the card alone: its cockpit service still runs, and `perf` stops there with exit 2.
- **How to read it.** Run it three times. The counts must pass each time. The percentages are reported, not
  gated: take the median, and on a busy machine read them against the shipped extension measured at the same
  moment, not against the table. A collections budget broken by one, in one state of one run, can be
  chance (an idle shell makes one or two a minute): run it again.
- **Why these budgets.** Three things cost most when the extension was first measured: a D-Bus proxy object
  owned only by JavaScript made GJS force a full collection after every Sample; two 2-second timers cost as much
  as the Sample itself; and the top bar and a covered card were redrawn when no pixel had changed. The counts
  above guard the first and the third. No count moves for a timer that draws nothing, so the timers are guarded
  in the suite below: a row pins every timeout the shell side adds, by file and count, and a new one fails it
  until it is counted there on purpose.
- **On the live desktop the figures are about twice these.** One reading, at a load of 8 to 10, put the
  extension at 0.37 to 0.56 % of one core with the card covered or visible. About 0.15 of that is
  the compositor's own frame for each Sample that changes the top bar, which the nested shell draws more
  cheaply. gnome-shell also forces a full collection about every 10 s by itself while a laptop is on
  Wi-Fi or its battery is charging or discharging (its network and power indicators do it), with the
  extension on or off: a 20 to 30 ms burst on that grid is not the extension's. Two traces of the live
  shell found no collection the extension triggers.
- **Not budgeted yet: nothing visible.** With the top bar hidden and the card covered the extension still
  receives Samples, since a card judged covered may still be seen through a translucent window and is kept
  fresh. That state is `perf`'s fourth line.
- **The cockpit's budgets are the nested shell's:** 0.5 % of one core with the cockpit visible, its four cards
  and the top bar, as in the first table; and, as for the card, no forced collection the extension causes, no
  repeating timer in the shell, and one frame a Sample at most. The live desktop reads above the nested
  figures, as the bullet on it says, and has no percentage to pass.

**Measured in the nested shell, for 0.2.0,** with `perf` on 2026-11-27, at the default size (3072 × 1920):
0.2.0's extension at commit `1baf4f6`, alternated with the card it replaces, `main` at `a608dce` (0.1.11's card).
The release was then rebased onto the cockpit's text-length measurer, which nothing in the shell loads yet, so the
code measured is the code released. The figures are % of one core over the disabled state: with three runs, lowest
to highest and then the median; with two, both readings and then their mean. "How to read it" asks for three runs a
side, and only 0.1.11's card with the cockpit has its third: the other three sides stand on two. Each kept run's
disabled state read between 0.020 and 0.071; a run whose disabled state read over 0.1, loaded by something else,
was set aside and measured again. Every count, cockpit and fallback budget held in each run.

With the cockpit, `start --gc-log --replay`, the fixture's grid drawn and its lists full:

| State | 0.2.0, two runs | 0.1.11's card, three runs | Budget |
|---|---|---|---|
| card covered, idle input | 0.071 and 0.077 (0.074) | 0.009 to 0.077 (0.028) | 0.08 |
| card covered, busy input | 0.107 and 0.151 (0.129) | 0.096 to 0.146 (0.123) | 0.20 |
| top bar hidden, card covered | 0.067 and 0.071 (0.069) | 0.039 to 0.062 (0.047) | none yet |
| the cockpit visible, busy input | 0.256 and 0.326 (0.291) | 0.161 to 0.219 (0.188) | 0.5 |
| the main thread's median per tick: covered and idle, covered and busy, visible | 0.63, 1.87 and 4.90 ms | 0.60, 1.91 and 4.17 ms | 1 and 3 ms covered |

The card alone, the same with `--no-cockpit`, two runs a side:

| State | 0.2.0 | 0.1.11's card | Budget |
|---|---|---|---|
| card covered, idle input | 0.056 and 0.078 (0.067) | 0.042 and 0.054 (0.048) | 0.08 |
| card covered, busy input | 0.102 and 0.116 (0.109) | 0.147 and 0.147 (0.147) | 0.20 |
| top bar hidden, card covered | 0.044 and 0.052 (0.048) | 0.057 and 0.087 (0.072) | none yet |
| **card visible, busy input** | **0.250 and 0.278 (0.264), over its budget** | 0.168 and 0.201 (0.185) | 0.25 |
| the main thread's median per tick: covered and idle, covered and busy, visible | 0.85, 1.75 and 4.86 ms | 0.50, 2.18 and 2.85 ms | 1 and 3 ms covered |

**The card alone, visible and busy, is over its budget:** 0.264 % of one core, the mean of 0.250 and 0.278, is
0.014 over the 0.25 the first table gives a visible card. One run read the budget exactly and the other 0.028 over
it. 0.1.11's card read 0.185 in the same state. Every other state of 0.2.0 is within its budget, with the cockpit
and without. A next step draws the card's traces at half resolution.

**Measured in the nested shell, for 0.2.1,** with `perf` on 2026-11-27, at the default size, with the cockpit
(`start --gc-log --replay`): 0.2.1's change at commit `135ebab`, alternated with the 0.2.0 code it stood on,
`1baf4f6`, three runs a side. The change was then rebased, file for file the same, so the code measured is the code
released. The figures are % of one core over the disabled state, lowest to highest and then the median. Each run's
disabled state read between 0.015 and 0.073, and every count, cockpit and fallback budget held in each run.

| State | 0.2.1, three runs | 0.2.0, three runs | Budget |
|---|---|---|---|
| **card covered, idle input** | **0.045 to 0.104 (0.090), over its budget** | 0.015 to 0.083 (0.053) | 0.08 |
| card covered, busy input | 0.096 to 0.186 (0.159) | 0.100 to 0.201 (0.141) | 0.20 |
| top bar hidden, card covered | 0.084 to 0.283 (0.106) | 0.043 to 0.072 (0.056) | none yet |
| the cockpit visible, busy input | 0.224 to 0.265 (0.246) | 0.211 to 0.324 (0.233) | 0.5 |
| the main thread's median per tick: covered and idle, covered and busy | 0.92 and 1.98 ms | 0.70 and 2.09 ms | 1 and 3 ms |

**Covered with idle input, 0.2.1 is over its budget:** 0.090 % of one core, the median of three runs, is 0.010
over the 0.08 the first table gives that state, and two of the three runs read over it. 0.2.0 read 0.053 there.
Every other state measured is within its budget.

**What 0.2.1 adds there, timed inside the shell.** 0.2.1 reads the time, swap and pressure of every Sample, the
card covered or not, for the mark. Timed from the client's Sample signal to its return, in four runs of 300 s
alternated two a side, the card covered with idle input, that read adds about 0.06 ms a Sample (a median of 58 µs,
against 2 µs for the same stretch on 0.2.0): 0.003 % of one core. The pair above cannot resolve less than about
0.03 %: in those four runs, two runs of the same side differed by 0.3 to 0.5 ms a Sample in the shell's own
main-thread time. The budget stays 0.08.

**The services and memory,** at idle:

| What | Budget |
|---|---|
| the service, with a detail watch held | under 0.1% of one core |
| the service, with no watch | under 0.05% of one core |
| the service's resident memory | at most 8 MiB, flat over 24 h |
| the cockpit service, with a cockpit watch held | under 0.15% of one core, with about 40 sessions |
| the cockpit service, with no watch | under 0.05% of one core |
| the cockpit service's resident memory | at most 48 MiB, flat over 24 h |
| gnome-shell's resident memory | flat over 24 h |

The figures above are the compiled sampler's.

**The cockpit's watched budget grows with its sessions,** because most of it is the sessions source. On
2026-11-26, with a watch held for 17 minutes and 38 sessions, the cockpit service read 0.132% of one core. A GJS
profile of that state split it as follows:

- the sessions source (the rows, herdr's replies, and each session's files): about 0.045%;
- garbage collection, most of it started by the engine after the sessions source's full samples: about 0.031%,
  on the main thread and the JS helper threads together;
- the network and mounts sources: about 0.018%;
- the service around them (D-Bus, the scheduler, JIT compilation, the main loop): about 0.023%.

Over the budget, the levers are the full sample's age (`SESSION_FACTS_MAX_AGE_SECONDS`) and the network's watched
interval (`NETWORK_WATCHED_INTERVAL_SECONDS`). A longer one makes its figures that much staler while the grid is in
view.

`scripts/resource-pulse-cost.sh` measures them, and is what `perf` reads the nested shell with. On the
live desktop it reads gnome-shell as a whole, so take a reading with the extension off and one with it on;
`--service` measures the service itself, found by its unit's `MainPID`. Read the service once with a
detail watch held (the card visible, or the dropdown open) and once with none (the card covered), each
over 10 idle minutes:

```bash
scripts/resource-pulse-cost.sh --cpu-percent 600            # gnome-shell CPU over 10 min, % of one core
scripts/resource-pulse-cost.sh --tick-median 120            # its main thread's median CPU per 2 s tick, ms
scripts/resource-pulse-cost.sh --service --cpu-percent 600  # the service's
scripts/resource-pulse-cost.sh --service --rss-kib          # the service's resident memory: at most 8192
scripts/resource-pulse-cost.sh --cockpit --cpu-percent 600  # the cockpit service's
scripts/resource-pulse-cost.sh --cockpit --rss-kib          # the cockpit's resident memory: at most 49152
scripts/resource-pulse-cost.sh --rss-kib                    # gnome-shell's resident memory
scripts/resource-pulse-cost.sh --rss-check <kib>            # exit 1 if gnome-shell grew more than 64 MiB since <kib>
```

It reads only `comm`, `status` and each thread's `schedstat` under `/proc`: CPU comes from the scheduler's
nanosecond counters, since `stat`'s clock ticks resolve only about 0.02% of one core over a minute, and a
counter it cannot read is exit 2, never 0%. `--cockpit` measures the cockpit service by
its unit's `MainPID`, as `--service` does the sampler. Either may stand anywhere on the line; the two
together are a usage error, and so is any other word left over (exit 2), never ignored. `--rss-check` is
gnome-shell's growth tripwire alone: `--cockpit --rss-check` (or `--service --rss-check`) is a usage error
too, which names that service's absolute budget, the figure its `--rss-kib` must stay under. To meet these
budgets the app scan's interval is 20 s while a detail watch is held and 60 s with
none (10 s cost too much). Over a budget, the remedy is a longer interval, or pruning slices that cannot beat the current
leader; never a shorter history. The program's live cost is
read with `scripts/resource-pulse-cost.sh --service`.

## Tests

Resource Pulse has these sixteen state tables, `scripts/test-resource-pulse*.sh`. Each asserts its own total, and CI
runs each one by name, as a step of its own. `scripts/test-repo-checks.sh` holds the totals this guide states, and
CI's steps, to every table.

- `scripts/test-resource-pulse-gjs.sh` (1433 checks): the `gjs -m` unit tests. Among them, the cockpit's composition
  is walked one pixel at a time along each length of the work area, for a sample of layouts.
- `scripts/test-resource-pulse-source.sh` (65 checks): what the extension's files say: the Shell glue's parse, the
  measurer's and the tiles', the pure modules, the blocking-call scans, `metadata.json`, the module closure and the
  stat-only paths.
- `scripts/test-resource-pulse-cost.sh` (18 checks): `resource-pulse-cost.sh`, over a fake `/proc`.
- `scripts/test-resource-pulse-bus.sh` (66 checks): the D-Bus rows on a private bus: the sampler's test double, the
  cockpit's D-Bus face and entry point, and the clients of both.
- `scripts/test-resource-pulse-units.sh` (44 checks): the services' systemd units and their refresh step, against a
  systemctl stub.
- `scripts/test-resource-pulse-status.sh` (60 checks): the status report, `scripts/resource-pulse-status.sh`,
  against gsettings, gnome-extensions and gnome-shell stubs.
- `scripts/test-resource-pulse-nested.sh` (32 checks): the nested-shell harness before anything starts: its usage,
  eval's run lookup, scenario and perf.
- `scripts/test-resource-pulse-nested-runs.sh` (68 checks): the harness's stop and start, and the run start prepares:
  its buses, environment, services, build, fixture and monitor config.
- `scripts/test-resource-pulse-nested-check.sh` (39 checks): the harness's window, pointer and `check cockpit`,
  against stand-ins that answer for the nested shell.
- `scripts/test-resource-pulse-nested-signals.sh` (9 checks): what ends `check cockpit` and the stand-ins, and when:
  its TERMs, the exit trap and their own lifetimes.
- The compiled sampler's six tables, each with its total under [The state tables](#the-state-tables).

`nameGuard.test.js` holds a sample to each of `lib/nameGuard.js`'s `SECRET_SHAPE_PATTERNS`, and a row fails when a
pattern has no sample there, so a new shape needs one.

`scripts/test-resource-pulse-gjs.sh` runs the `gjs -m` unit tests of `lib/`, of `PulseClient` (its JSON handling and
version-skew rows), of `CockpitClient` (the skipped-unit rule and pull-on-suspicion, on fakes) and of the
cockpit's herdr socket client (against a fake herdr speaking herdr's
framing on a socket in a temp dir). Those rows run only in a process started with no reachable bus, a config
home that cannot exist and one fixed time zone (`gnome-shell/tests/liveSessionBarrier.js`: `run.js` started any
other way runs itself again behind them), so a fake a row leaves out reaches no bus and no herdr socket, never
the live session or system bus or the live herdr, and a row that reads a local time reads it in the same zone
on every machine. So run them through `gjs -m gnome-shell/tests/run.js` or the table. It needs `gjs`, and stops with
exit 2 without it. The card's two Pango rows, its height and where its widest text fits, also need Pango's typelibs
(`gir1.2-pango-1.0`) and the card's font, Ubuntu Sans (`fonts-ubuntu`): without them those rows fail, never pass.

`scripts/test-resource-pulse-bus.sh` runs the rows that need a message bus. On a private bus of its own
(`dbus-run-session`, never the live session bus) it runs the sampler's test double (`gnome-shell/tests/serviceDouble.js`,
held to the program by the sampler bus table's conformance row), the client against it, the cockpit's D-Bus
face, the cockpit client against it and against a fake systemd that answers its StartUnit and unit read, and the real
`service/cockpit.js` (under a temp home, with no system bus, and a fake herdr and a
fake herdr client, a process named `herdr` in a terminal of its own, for `FocusSession`; then with a fault
injected into its `/proc` scan; then with a fake herdr that never answers a focus request, which `FocusSession`
answers within the client's call timeout; then in fixture mode). It is **not fully hermetic**: the
`service/cockpit.js` rows read the host's real mount and route tables and its processes' `/proc/<pid>/stat` lines,
and one expects the host's `/` to be listed as a local disk: a writable root that is not a network share.
It needs `gjs`, `timeout`, `setsid`, `dbus-run-session` (package `dbus-daemon`), `gdbus` (`libglib2.0-bin`) and
util-linux's `script` (`bsdutils`): without any of them it stops with exit 2.

`scripts/test-resource-pulse-units.sh` covers the services' units: each unit's settings, `systemd-analyze verify` on
the shipped file (`%h` at a stand-in home), and the refresh step (its rule and its look after a restart),
against a `systemctl` stub, never the live user manager. It needs `systemd-analyze`; without it the verify rows say
so and pass with nothing verified, unless `CI` is set (GitHub Actions sets it), where the table fails instead.

`scripts/test-resource-pulse-status.sh` covers the status script, `scripts/resource-pulse-status.sh` (its sampler
questions included), against gsettings, gnome-extensions and gnome-shell stubs. It never touches the live session. It
needs `find`, `rg`, `gjs` (rows have GLib print a reply as `gdbus` would), util-linux's `setsid` (the Ctrl-C row)
and `timeout` (the usage row's bound), and it refuses to run as root (a row hides a file behind a directory that
root can still search): without them it stops with exit 2.

The four `scripts/test-resource-pulse-nested*.sh` tables run the nested harness, `check cockpit` included, against
stubs. They never touch the live session, and none starts a gnome-shell. Each needs `timeout`, util-linux's
`setsid` and `jq`, all but the signals table `find`, and the runs table `gjs`: without any of them a table stops
with exit 2. The signals table takes over a minute by design: its last row judges the stand-ins it abandoned on
purpose, once their lifetimes have passed.

**Run on a desktop**, the nested tables start bash scripts named `gnome-shell` and `gjs` as stand-ins, and end them
themselves. A table that was stopped leaves none past a minute; one killed outright can leave a stand-in for
up to an hour. A leftover is a process whose `readlink /proc/<pid>/exe` is bash and whose
`readlink /proc/<pid>/fd/255` is a script under a temporary directory. End it by its pid, never by name: the
live session runs real processes of both names.
