# Resource Pulse

Resource Pulse is a GNOME Shell extension that answers "why is this machine slow right now". It draws two small
CPU and memory graphs in the top bar, and a card on the desktop with swap, pressure and the heaviest apps. An
optional cockpit turns the desktop of one monitor into a grid of cards: the system card, the heaviest apps, the
network connections and mounts, and the Claude Code sessions running in herdr.

**Status: early.** It supports GNOME Shell 50 on Wayland only. Its names, paths and interfaces may change before
1.0.

## How it works

It has three parts. The extension only draws; the services do all the reading.

- **The extension**, `resource-pulse@zvibaratz.github.io`, in
  `gnome-shell/extensions/resource-pulse@zvibaratz.github.io/`. It reads no file and starts no process, and each of
  its D-Bus calls is asynchronous with a 2 s timeout, so the shell never waits on a service.
- **The sampler**, `resource-pulse-sampler/`: a Rust program, run as the systemd user unit
  `resource-pulse.service`. Every 2 s it reads `/proc` and the pressure files, and every 20 to 60 s it scans the
  cgroups to rank the apps. It serves the result on the session bus as `io.github.zvibaratz.ResourcePulse1`.
- **The cockpit service**, `service/cockpit.js` in the extension, run by `gjs` as the systemd user unit
  `resource-pulse-cockpit.service`. It serves the sessions, the network and the mounts on the session bus as
  `io.github.zvibaratz.ResourcePulse.Cockpit1`. It is opt-in: systemd starts it only when
  `~/.config/resource-pulse/cockpit.json` exists.

The extension starts both units on demand, each time it is enabled. Neither unit is ever enabled in systemd.

## The sessions card needs herdr

The cockpit's sessions card lists the Claude Code sessions in [herdr](https://github.com/herdrdev/herdr), a
terminal workspace manager for coding agents. It reads herdr's socket, `~/.config/herdr/herdr.sock`. Without herdr
the card says `herdr not running`, and the rest of the cockpit works.

A session's name is its herdr workspace's label, else the last part of its directory. Its idle time is the age of
its transcript, found under `~/.claude/projects`, and also under [clauth](https://github.com/uwuclxdy/clauth)'s
profiles (`~/.clauth/profiles`) for those who use it. Without a transcript the card shows the age of the
session's Claude process instead.

Two herdr sidebar tokens on a session's agent add a line each to its row's tooltip, when something publishes
them:

- `acct`: the account the session bills (`account <acct>`), through the card's name guard;
- one of `ctx_ok`, `ctx_warn` and `ctx_crit`: the context the session has used, read from the first percent in the
  token's value (`▅ 62%` gives `context 62%`).

Nothing in this repository publishes them. Without them the tooltip leaves those two lines out.

## Installing it by hand

There is no installer: you link the extension and the two units from a checkout, and a script builds the sampler.
Keep the checkout where it is afterwards, since the links point into it. Run the commands from the checkout's root.

1. **Requirements.** GNOME Shell 50 on Wayland; `cargo` 1.89 or newer (from [rustup](https://rustup.rs) if your
   distribution's is older; `cargo --version` says which); a C toolchain, which cargo links with (on Debian and
   Ubuntu, `sudo apt install build-essential`); and `gjs` at `/usr/bin/gjs`, which runs the cockpit service. The
   first build downloads about 56 MB of crates from crates.io.
2. **Get the code.**

   ```bash
   git clone https://github.com/ZviBaratz/resource-pulse.git
   cd resource-pulse
   ```

3. **Build the sampler.** This builds the release program and installs it at
   `~/.local/lib/resource-pulse/resource-pulse-sampler`, where the unit runs it. It ends with
   `✓ Resource Pulse sampler program built and installed: ~/.local/lib/resource-pulse/resource-pulse-sampler`.

   ```bash
   bash scripts/resource-pulse-sampler-build.sh
   ```

4. **Link the extension** into GNOME Shell's user extension directory:

   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions
   ln -s "$PWD/gnome-shell/extensions/resource-pulse@zvibaratz.github.io" ~/.local/share/gnome-shell/extensions/
   ```

5. **Link both units** into your systemd user unit directory. Do not enable them: they have no `[Install]`
   section, and the extension starts them.

   ```bash
   systemctl --user link "$PWD/systemd/resource-pulse.service" "$PWD/systemd/resource-pulse-cockpit.service"
   ```

6. **Log out and back in.** GNOME on Wayland finds a new extension only at login.
7. **Enable the extension.** It loads at once and starts the sampler.

   ```bash
   gnome-extensions enable resource-pulse@zvibaratz.github.io
   ```

8. **Check that it runs.** The status report should show `state=ACTIVE`, `service: active, protocol 1, last
   sample …` and no `⚠` line:

   ```bash
   bash scripts/resource-pulse-status.sh
   ```

9. **The cockpit, if you want it.** Write its config from the template, then start it, or wait for the
   extension's next enable (a login, an unlock or a screen blank):

   ```bash
   mkdir -p ~/.config/resource-pulse
   cp examples/resource-pulse-cockpit.json.template ~/.config/resource-pulse/cockpit.json
   systemctl --user start resource-pulse-cockpit.service
   ```

   The cards take hovers and clicks only while no desktop-icons window covers the cockpit's monitor. On Ubuntu,
   turn its desktop icons off with `gnome-extensions disable ding@rastersoft.com`.

[The guide](docs/guide.md#adopting-it-step-by-step) says what each step prints, and what to do when one fails.

## Updating

Pull, rebuild the sampler, then run the refresh step. It reloads systemd and restarts each running service whose
program, modules or unit file changed since it started, and no other (a restart empties the sampler's graphs):

```bash
git pull
bash scripts/resource-pulse-sampler-build.sh
bash scripts/resource-pulse-service-refresh.sh
```

A change to the extension's drawing side takes effect at your next login, since the shell loads an extension's code
once per login. The status report says when the desktop runs an older copy.

## Removing it

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
not in memory, which you can ignore. The shell forgets the extension at your next login.

## Tests

The tests are 16 state tables, `scripts/test-resource-pulse*.sh`. Run one with bash, from the repository's root:

```bash
bash scripts/test-resource-pulse-gjs.sh
```

Or run them all:

```bash
for table in scripts/test-resource-pulse*.sh; do bash "$table" || echo "FAILED: $table"; done
```

- Each table asserts its own row total.
- A table that is missing a tool it needs (`gjs`, `cargo`, `dbus-run-session` and others) stops with exit 2,
  "could not run", in place of a pass. The guide names the one exception: `systemd-analyze` outside CI.
- Run them as your own user. Several refuse to run as root.
- No table touches the live session. Every bus a table uses is a private one of its own.

What each table covers, and what it needs, is in the guide: [Tests](docs/guide.md#tests) and
[The state tables](docs/guide.md#the-state-tables).

Three more tables check the repository itself:

- `scripts/test-repo-checks.sh`: the guide states each table's total, and CI runs every table;
- `scripts/test-shellcheck-bounded.sh`: the ShellCheck wrapper;
- `scripts/test-state-table-totals.sh`: the row-total checker.

CI (`.github/workflows/ci.yml`) runs all of them, on every pull request to `main` and every push to `main`, with the
sampler's `cargo fmt`, `clippy` and `doc` checks, every pre-commit hook and gitleaks.

## Documentation

- [docs/guide.md](docs/guide.md): how it runs, every number it shows, installing, enabling and checking it, the
  nested shell for trying changes, and what it costs.
- [CHANGELOG.md](CHANGELOG.md).

## Licence

GPL-2.0-or-later. Copyright (C) 2026 Zvi Baratz. The licence text is in [LICENSE](LICENSE).
