// Every tunable the extension, the cockpit and their tests read, each with its unit in the name. The sampler's own are
// in resource-pulse-sampler/src/constants.rs, beside the ones it shares with these. The cockpit service loads this
// module, so a change here restarts it at an update: the sizes and colours only the shell draws the card and the
// top-bar graphs with are in lib/drawingConstants.js instead.

/** Seconds between CPU, memory and pressure samples. */
export const SAMPLE_INTERVAL_SECONDS = 2;
/**
 * Sample intervals the extension's client waits for a Sample. Data older than that is stale (lib/wiring.js
 * isSampleStale): both surfaces go to no data, once, rather than show its numbers as live.
 */
export const SAMPLE_STALL_TICKS = 3;
/**
 * The same stall in milliseconds: what the client's stall watchdog, which each Sample re-arms, waits before it shows
 * no data. Milliseconds, so the watchdog fires exactly the stall after the last Sample, not on a whole second.
 */
export const SAMPLE_STALL_MS = SAMPLE_STALL_TICKS * SAMPLE_INTERVAL_SECONDS * 1000;
/**
 * Seconds the client waits after a failed StartUnit before asking systemd again: the first delay after the first
 * failure, the second after the second, and the last one for every failure after that. A success, or the service
 * appearing on the bus, ends the retries.
 */
export const START_RETRY_DELAYS_SECONDS = [5, 30, 300];
/**
 * Seconds an accepted StartUnit waits for the service to appear on the bus before it counts as failed. systemd answers
 * StartUnit with a job before it checks Restart= and the start limit, so a unit at its StartLimitBurst is "started"
 * and then never runs; without this wait that answer would end the retries.
 */
export const START_CONFIRMATION_TIMEOUT_SECONDS = 15;
/** Milliseconds the client waits for any D-Bus reply: GetState, WatchDetail, UnwatchDetail and StartUnit. */
export const DBUS_CALL_TIMEOUT_MS = 2000;
/**
 * Seconds between per-app scans while a detail watch is held: a whole number of SAMPLE_INTERVAL_SECONDS, since scans
 * run on fast ticks. 20, to keep the scan inside the idle cost budget.
 */
export const APP_SCAN_INTERVAL_SECONDS = 20;
/** Samples kept for the top-bar sparkline. */
export const TOPBAR_HISTORY_SAMPLES = 30;
/** Samples kept for the desktop card graphs. */
export const CARD_HISTORY_SAMPLES = 150;
/** Lower bounds, in percent of PSI some avg10, of bands 1, 2 and 3 (below the first is band 0). */
export const PRESSURE_BAND_THRESHOLDS_PERCENT = [10, 25, 50];
/** Microseconds before the same error message may be logged again (10 minutes). */
export const ERROR_LOG_REPEAT_INTERVAL_USEC = 600_000_000;
/**
 * Seconds between repaints of the desktop card while it counts as covered (frozen). The extension repaints it,
 * dimmed, from the client's latest state this often (asked on every Sample, or by the cover fallback timeout while the
 * service is silent), so a card misjudged as covered shows numbers at most this old, dimmed, rather than stale ones
 * that read as live.
 */
export const FROZEN_REPAINT_INTERVAL_SECONDS = 30;
/**
 * Samples after which a covered card's cover is checked again, as a backstop for what no window signal reports: 30 s
 * of Samples, the frozen cards' repaint interval. A visible card is checked on every Sample.
 */
export const COVER_BACKSTOP_TICKS = 15;
/**
 * Seconds between cover checks while the card is covered and the service is silent (no Sample comes to check it). The
 * client's stall watchdog going off starts this timeout and the next Sample removes it, so it never runs while
 * Samples flow.
 */
export const COVER_FALLBACK_INTERVAL_SECONDS = 10;
/** Desktop IDs of the system monitors a click may open, in order of preference. */
export const RESOURCES_APP_IDS = ['net.nokyan.Resources.desktop', 'org.gnome.SystemMonitor.desktop'];
/** Milliseconds the pointer rests on a top-bar item before its label shows. */
export const HOVER_LABEL_DELAY_MS = 300;
/** Milliseconds the hover label takes to fade in, and to fade out: the dash's own label timings (dash.js). */
export const HOVER_LABEL_FADE_IN_MS = 150;
export const HOVER_LABEL_FADE_OUT_MS = 100;
/** Pixels between a cockpit row's edge and the cockpit tooltip's nearest edge. */
export const COCKPIT_TOOLTIP_GAP_PX = 6;
/**
 * The actor opacity, of 255, of a long-idle session row: an alpha of 0.55. St reads no CSS `opacity`, so the
 * sessions card sets it on the row actor.
 */
export const COCKPIT_LONG_IDLE_ROW_OPACITY = 140;
/** Prefix of every journal line this extension writes. */
export const LOG_PREFIX = 'resource-pulse:';
/** What the CPU half of "heaviest" reads when even the top entry is below CPU_IDLE_THRESHOLD_PERCENT. */
export const CPU_IDLE_LABEL = 'idle';
/** Below this share of the whole machine, the top CPU entry is not worth naming: the machine is idle. */
export const CPU_IDLE_THRESHOLD_PERCENT = 1;
/** Bytes in one gibibyte (the memory unit shown everywhere). */
export const BYTES_PER_GIBIBYTE = 1024 ** 3;
/** Microseconds in one second: GLib's clocks and every `*Usec` value count in microseconds. */
export const MICROSECONDS_PER_SECOND = 1_000_000;
/**
 * A cockpit source whose sampledAtUsec is older than this many of its own intervalSeconds is stale: its card draws
 * "no data since HH:MM" rather than its numbers as live.
 */
export const COCKPIT_SOURCE_STALE_INTERVALS = 3;
/** The interval a cockpit source is judged against when it publishes none (null or 0): one sample a minute. */
export const COCKPIT_FALLBACK_INTERVAL_SECONDS = 60;
/**
 * What the extension's cockpit client (cockpitClient.js) knows of resource-pulse-cockpit.service:
 * - STARTING: asked systemd to start it, and no state from it yet;
 * - SKIPPED: the cockpit is not configured: systemd skipped the start job for its condition (no layout file), or has
 *   no such unit (NoSuchUnit: never linked, or unloaded after a skipped job); nothing is retried until the next
 *   start();
 * - LIVE: its GetState answered, and its changes are followed;
 * - VANISHED: it left the bus after it was there; the client starts nothing (a stop stays a stop).
 */
export const CockpitClientState = Object.freeze({
    STARTING: 'starting',
    SKIPPED: 'skipped',
    LIVE: 'live',
    VANISHED: 'vanished',
});
/**
 * The `type` of each event the cockpit client tells its listeners:
 * - STATE: its CockpitClientState changed (`{type, state}`);
 * - LAYOUT: the layout or the config error changed (`{type, layout, configError}`);
 * - SOURCES: these sources changed, or a pull settled their freshness (`{type, names, cause}`, cause a
 *   CockpitSourcesCause).
 */
export const CockpitClientEventType = Object.freeze({
    STATE: 'state',
    LAYOUT: 'layout',
    SOURCES: 'sources',
});
/**
 * What brought a cockpit client's SOURCES event (its `cause`), so the extension can pace what it draws:
 * - READ: a GetState the client asked for of itself: an owner's appearance, the subscription becoming wanted (a
 *   reveal), or a Changed that came before any state; pulls that joined it are told with it;
 * - CHANGED: a Changed signal;
 * - PULL: a pull's GetState (pullIfSuspicious), answered or failed, or completed at once (no owner, or the owner left).
 */
export const CockpitSourcesCause = Object.freeze({
    READ: 'read',
    CHANGED: 'changed',
    PULL: 'pull',
});
/**
 * Longest name, in characters, a cockpit source publishes (a workspace label or directory naming a session, an
 * account, a mount label); a longer one is published as COCKPIT_REDACTED_NAME.
 */
export const COCKPIT_NAME_MAX_CHARS = 64;
/**
 * What a cockpit source publishes in place of a name it rejects: one that is empty, too long (COCKPIT_NAME_MAX_CHARS),
 * holds a control character or matches a secret shape.
 */
export const COCKPIT_REDACTED_NAME = '—';
/**
 * Longest id, in characters, a cockpit reader passes (a session row's herdr workspace and pane ids); a longer one
 * reads as null, so another program's runaway string cannot ride an id onto the bus.
 */
export const COCKPIT_ID_MAX_CHARS = 128;
/**
 * Longest session row id, in characters, a cockpit reader passes: the id is "<workspace>:<pane>" at its longest (the
 * pane id alone, or a Claude session id, when herdr gives less), so two COCKPIT_ID_MAX_CHARS ids and the colon. A row
 * with a longer id is dropped, and the client's focusSession refuses one.
 */
export const COCKPIT_SESSION_ID_MAX_CHARS = 2 * COCKPIT_ID_MAX_CHARS + 1;
/** Longest path, in characters, a cockpit reader passes (a mount row's mount point); a longer one drops its row. */
export const COCKPIT_PATH_MAX_CHARS = 1024;
/** Prefix of every journal line the cockpit service writes. */
export const COCKPIT_LOG_PREFIX = 'cockpit:';
/** The card ids a cockpit layout config may name, in the order the cockpit draws them by default. */
export const COCKPIT_CARD_IDS = ['system', 'apps', 'connections', 'sessions'];
/** Columns of the cockpit grid: the most the groups' `columns` may add up to. */
export const COCKPIT_GRID_COLUMNS = 4;
/** The cockpit layout config's path under the user's config home (XDG_CONFIG_HOME). */
export const COCKPIT_CONFIG_RELATIVE_PATH = 'resource-pulse/cockpit.json';
/** A session row idle at least this many seconds is drawn dimmed (the drawing side reads it). */
export const SESSION_IDLE_DIM_SECONDS = 1800;
/** Interface-name prefixes of VPN tunnels in /proc/net/route (OpenVPN tun and tap, WireGuard wg). */
export const TUNNEL_INTERFACE_PREFIXES = ['tun', 'tap', 'wg'];
/** Filesystem types of network shares, as /proc/self/mountinfo names them. */
export const NETWORK_FILESYSTEM_TYPES = ['cifs', 'smb3', 'nfs', 'nfs4', 'fuse.sshfs', 'fuse.rclone', 'davfs', 'afp'];
/** Mount-point prefixes under which removable disks are mounted. */
export const REMOVABLE_MOUNT_PREFIXES = ['/media/', '/run/media/', '/mnt/'];
/** The RTF_GATEWAY bit of a /proc/net/route `Flags` column: the route goes via a gateway. */
export const ROUTE_FLAG_GATEWAY = 0x0002;
/**
 * Milliseconds the cockpit service waits for herdr to answer one request over its socket: connect, send and the reply
 * together. A herdr that has not answered by then fails the request, so a hung herdr marks the sessions source stale
 * instead of stalling the service.
 */
export const HERDR_REQUEST_TIMEOUT_MS = 2000;
/**
 * Milliseconds the cockpit service waits for herdr to answer each of FocusSession's two focus requests (workspace, then
 * pane): shorter than HERDR_REQUEST_TIMEOUT_MS, so that twice it, with FOCUS_SESSION_REPLY_MARGIN_MS, fits under the
 * client's DBUS_CALL_TIMEOUT_MS and a slow herdr is answered herdr-unreachable before the client gives up.
 */
export const HERDR_FOCUS_REQUEST_TIMEOUT_MS = 750;
/**
 * Milliseconds FocusSession leaves, after its two focus requests and under the client's DBUS_CALL_TIMEOUT_MS, for its
 * /proc scan for the window candidates and the bus's round trips.
 */
export const FOCUS_SESSION_REPLY_MARGIN_MS = 400;
/** herdr's API socket's path under the user's config home (XDG_CONFIG_HOME). */
export const HERDR_SOCKET_RELATIVE_PATH = 'herdr/herdr.sock';
/** Where the kernel lists its processes: one directory per pid, named by the pid. */
export const PROC_ROOT_PATH = '/proc';
/** A process's stat file, under its directory in PROC_ROOT_PATH: one line, its pid, comm, state, ppid and on. */
export const PROC_PID_STAT_FILE_NAME = 'stat';
/**
 * Most entries of one process's chain of parents that lib/processTree.js follows, the process itself included: a
 * deeper chain is cut there. A herdr client's terminal is its second or third parent.
 */
export const PROCESS_ANCESTOR_MAX_DEPTH = 16;
/**
 * Most window candidates a FocusSession reply carries (the herdr clients and their parents, ruling out pid 1); a
 * reader drops any past it.
 */
export const FOCUS_WINDOW_PID_CANDIDATES_MAX = 64;
/**
 * The environment variable that puts the cockpit service in fixture mode: when it names a JSON file, the service
 * serves that file's state and focus reply instead of its sources and the config. Only the nested test harness sets
 * it; resource-pulse-cockpit.service never does.
 */
export const COCKPIT_FIXTURE_ENVIRONMENT_VARIABLE = 'RESOURCE_PULSE_COCKPIT_FIXTURE';
/**
 * Most characters of herdr's own error text (its code and message) a rejection's message carries; the rest is cut. An
 * unknown method's message lists every method herdr has, about 2,000 characters.
 */
export const HERDR_ERROR_MESSAGE_MAX_CHARS = 200;
/**
 * Longest reply line, in bytes, the herdr client reads (8 MiB); a longer one is rejected as soon as the cap is passed,
 * so a runaway reply cannot fill the service's memory. A live session snapshot measured about 63 KB.
 */
export const HERDR_REPLY_MAX_BYTES = 8 * 1024 * 1024;
/** Seconds between samples of the sessions source while a client watches the cockpit. */
export const SESSIONS_WATCHED_INTERVAL_SECONDS = 10;
/** Seconds between samples of the sessions source while no client watches the cockpit: its standing cost. */
export const SESSIONS_UNWATCHED_INTERVAL_SECONDS = 60;
/**
 * Seconds between samples of the network source while a client watches the cockpit (NetworkManager's signals cover
 * the uplink between them; the VPN tunnel and the SSH control sockets are read only on a sample).
 */
export const NETWORK_WATCHED_INTERVAL_SECONDS = 10;
/**
 * Seconds between samples of the network source while no client watches the cockpit: nothing shows it then, and a
 * client's first watch samples it at once.
 */
export const NETWORK_UNWATCHED_INTERVAL_SECONDS = 60;
/**
 * Seconds between samples of the mounts source while a client watches the cockpit (the mount monitor's signal covers
 * the rest).
 */
export const MOUNTS_WATCHED_INTERVAL_SECONDS = 30;
/**
 * Seconds between samples of the mounts source while no client watches the cockpit: nothing shows it then, and a
 * client's first watch samples it at once.
 */
export const MOUNTS_UNWATCHED_INTERVAL_SECONDS = 120;
/** Every cockpit source's interval is multiplied by this while UPower reports the machine on battery. */
export const BATTERY_CADENCE_MULTIPLIER = 3;
/**
 * Seconds after a signal-driven sample of a cockpit source during which another signal does not sample it at once;
 * signals inside it give one sample when it ends.
 */
export const SOURCE_SIGNAL_COOLDOWN_SECONDS = 2;
/**
 * Path fragments of the files the cockpit service may stat but never open (the "stat, never open" list): the
 * sources' file reader (service/sources/sourceIo.js) refuses any path containing one, before opening it. Listing a
 * directory's names is not opening a file, so counting the SSH control sockets stays allowed.
 */
export const STAT_ONLY_PATH_FRAGMENTS = [
    '/.aws/', '/.ssh/', '/.credentials',
];
/**
 * The other stat-only files: a home's dotfile whose name holds `.local` after its first character, where a host keeps
 * its own settings and often its secrets. The reader matches it as it matches the fragments, anywhere in the path and
 * as the start of a path component: a component that starts with a dot and holds `.local` after its first character,
 * whatever else the name holds. So such a dotfile, the same file deeper in the tree, and a copy of it whose name goes
 * on past `.local` are refused, while `~/.local/` (the directory) and a `.local` file that is not a dotfile, such as
 * `~/.config/x.local`, are read.
 */
export const STAT_ONLY_LOCAL_DOTFILE_PATTERN = /\/\.[^/]+\.local/;
/**
 * Milliseconds a mount's filesystem size query may take before it counts as failed (its sizes null), so a hung network
 * share cannot stall the mounts source.
 */
export const FILESYSTEM_QUERY_TIMEOUT_MS = 2000;
/**
 * The cockpit grid at its reference size, in logical pixels (the numbers at 1920 x 1080): every length scales
 * with the cockpit monitor's work area. `columns` and `rows` are the most cells a group's block holds across and down.
 */
export const COCKPIT_GRID_REFERENCE = Object.freeze({
    widthPx: 1920, heightPx: 1080, cellWidthPx: 420, cellHeightPx: 300,
    innerGutterPx: 24, groupGapPx: 48, rowGutterPx: 24, captionHeightPx: 28, columns: 4, rows: 3,
});
/** The largest factor the cockpit grid grows to, however large the monitor. */
export const COCKPIT_GRID_MAX_SCALE = 2;
/**
 * The widest a cockpit card's content draws, in logical pixels, its cell's padding and border included. The grid's
 * cells scale with the work area and the cards' content does not: the v2 card's rows, which the system cell adopts,
 * need about 25.8em in its font, 374 to 378 px (the CPU graph alone is 150 px; stylesheet.css .rp-card-fixed), so 412
 * to 416 px with the cell's 18 px side padding and 1 px border; the larger is taken. Where a scaled cell and its inner
 * gutter are narrower, a card runs into the next one, so the grid is not drawn (lib/cockpitGrid.js
 * isCockpitGridDrawable).
 */
export const COCKPIT_CARD_CONTENT_WIDTH_PX = 416;
/** The card ids the cockpit draws; any other id in the layout still gets a cell, which stays empty. */
export const COCKPIT_DRAWN_CARD_IDS = ['system', 'apps', 'connections', 'sessions'];
/** The system card's id: the v2 card's cell. With no cockpit layout the v2 card, top right, is checked under it. */
export const COCKPIT_SYSTEM_CARD_ID = 'system';
/** The apps card's id: the card the pulse client's snapshots feed, besides the system card. */
export const COCKPIT_APPS_CARD_ID = 'apps';
/** The sessions card's id: the one cockpit card the top-bar dropdown draws too, under its system card. */
export const COCKPIT_SESSIONS_CARD_ID = 'sessions';
/** The cards that draw the sampler's snapshot (the system card, the apps card), which the detail watch feeds. */
export const COCKPIT_SNAPSHOT_CARD_IDS = Object.freeze([COCKPIT_SYSTEM_CARD_ID, COCKPIT_APPS_CARD_ID]);
/** The cockpit service's sources each card draws (lib/cockpitProtocol.js COCKPIT_SOURCE_NAMES): none for those two. */
export const COCKPIT_SOURCE_NAMES_BY_CARD_ID = Object.freeze({
    system: Object.freeze([]),
    apps: Object.freeze([]),
    connections: Object.freeze(['network', 'mounts']),
    sessions: Object.freeze(['sessions']),
});
/**
 * Seconds the cockpit waits for a Sample before it draws a Changed (or a pull's answer) by itself: a Changed waits for
 * the next Sample (one frame a tick), and this one-shot timeout draws it when the sampler is silent.
 */
export const COCKPIT_CHANGED_APPLY_FALLBACK_SECONDS = 3;
/** How a cockpit card writes the time of a source's last stamp in "no data since HH:MM" (GLib.DateTime.format). */
export const COCKPIT_CLOCK_LABEL_FORMAT = '%H:%M';
/** The most session rows the sessions card draws; the rest collapse into a '+N more' line. */
export const SESSIONS_CARD_ROW_LIMIT = 6;
/** The most rows each ranking (CPU, memory) of the apps card draws. */
export const APPS_CARD_ROW_LIMIT = 6;
/**
 * The most rows the connections card draws: the uplink, the VPN and the ssh masters, then up to five mounts; the
 * mounts past it collapse into a '+N more' line. Its rows are built with the card, so no update makes an actor.
 */
export const CONNECTIONS_CARD_ROW_LIMIT = 8;
/** Size of a cockpit row's icon and of the sessions header's state icons, in logical pixels: a panel status icon's. */
export const COCKPIT_ROW_ICON_SIZE_PX = 16;
/**
 * Width of a cockpit row's bar track, as a share of its cell's width: a fixed slot at the row's end, so a bar's change
 * never moves the name beside it, and the bars of a card line up.
 */
export const COCKPIT_ROW_BAR_TRACK_SHARE_OF_CELL_WIDTH = 0.15;
/** Pixels between a state's icon and its count in the sessions header, closer than the header's other parts. */
export const COCKPIT_STATE_COUNT_SPACING_PX = 2;
/** Seconds in the units an idle time is written in; a session idle for less than the next unit up shows this one. */
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;
/** Icon names (symbolic, from the stock theme) the cockpit cards draw, by session state and by connection kind. */
export const COCKPIT_ICON_NAMES = Object.freeze({
    working: 'media-playback-start-symbolic',
    blocked: 'dialog-warning-symbolic',
    idle: 'media-playback-pause-symbolic',
    done: 'object-select-symbolic',
    unknown: 'dialog-question-symbolic',
    wired: 'network-wired-symbolic',
    wifi: 'network-wireless-symbolic',
    offline: 'network-offline-symbolic',
    online: 'network-transmit-receive-symbolic',
    vpn: 'network-vpn-symbolic',
    ssh: 'utilities-terminal-symbolic',
    mountRemovable: 'drive-removable-media-symbolic',
    mountNetwork: 'folder-remote-symbolic',
    mountLocal: 'drive-harddisk-symbolic',
});
