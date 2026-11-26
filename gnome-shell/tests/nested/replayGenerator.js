// The input the replay service (replay-service.js) publishes in place of the real sampler's: per tick, one CPU busy
// percent and one used-memory figure, drawn from a small seeded generator, and the three pressure percents and the
// swap on disk. A fresh generator always starts from the same seed, so every run of every version of the extension is
// measured against the same sequence.
//   idle      CPU 1–4 %: inside one pixel of a 16-pixel graph
//   light     CPU 2–14 %: crosses a pixel boundary on some ticks
//   busy      CPU a walk between 15 % and 90 % that reflects off both bounds, so it changes on every tick (clamping
//             it instead would sit at a bound, repeating itself).
//   strained  busy's CPU walk, under a fixed cycle of pressure and swap (STRAINED_CYCLE_PHASES): calm, then cpu and
//             io pressure past 25 %, then past 50 %, then past 25 % again, then calm, while swap on disk grows by
//             1 MiB a tick through the first two strained phases and then stops. A cycle is 75 ticks (150 s), so the
//             history the replay fills at a restart holds two whole cycles and the live Samples start a cycle.
// In idle, light and busy the pressure stays where it always was in the replay, under 25 % (cpu a quarter of the CPU
// figure, memory 0.1 %, io 0.2 %), and no swap is on disk, so nothing the extension lights for strain lights there.
// It also reads the scenario file the harness's `scenario` request writes, and says when a read must restart the
// replay (parseScenarioRequest, isNewScenarioRequest), builds the apps each snapshot carries (replayApps): both
// winners and both rankings, in the real sampler's shape, so the cockpit's apps card has rows to draw; ranked afresh
// only as often as the real sampler scans the apps, and held between (ReplayAppScanner); and keeps the histories as
// the real sampler keeps them, the three pressure histories included (ReplayHistories).
// Pure: no gi import, no clock, no file, so it runs under plain gjs (gnome-shell/tests/nestedHarness.test.js).

const IDLE_SCENARIO_NAME = 'idle';
const LIGHT_SCENARIO_NAME = 'light';
const BUSY_SCENARIO_NAME = 'busy';
const STRAINED_SCENARIO_NAME = 'strained';
/** The scenario words, in the order scripts/resource-pulse-nested.sh's `scenario` request lists them. */
export const REPLAY_SCENARIO_NAMES = Object.freeze([IDLE_SCENARIO_NAME, LIGHT_SCENARIO_NAME, BUSY_SCENARIO_NAME,
    STRAINED_SCENARIO_NAME]);
/** The scenarios that take busy's CPU walk and its wider memory steps. */
const BUSY_WALK_SCENARIO_NAMES = Object.freeze([BUSY_SCENARIO_NAME, STRAINED_SCENARIO_NAME]);
/** What plays until a scenario is asked for, and while the scenario file names none. */
export const DEFAULT_REPLAY_SCENARIO_NAME = BUSY_SCENARIO_NAME;
/** Separates the scenario file's fields: the word, then the token the harness writes with each request. */
const SCENARIO_FILE_FIELD_SEPARATOR_PATTERN = /\s+/;
/** How a request's fields are joined back into its text, whatever spacing the file had. */
const SCENARIO_REQUEST_FIELD_JOINER = ' ';
/** The seed of every generator: fixed, so every run publishes the same sequence. */
export const REPLAY_RANDOM_SEED = 20261110;

const BYTES_PER_MEBIBYTE = 1024 ** 2;
/** A fraction 0–1 is this many percent. */
const PERCENT = 100;
const BYTES_PER_GIBIBYTE = 1024 ** 3;
/** The memory every snapshot reports in total: that of a 32 GB machine. The walk's bounds use it unrounded. */
const TOTAL_MEMORY_BYTES = 30.3 * BYTES_PER_GIBIBYTE;
/** The same total in whole bytes, as a snapshot reports it. */
export const REPLAY_TOTAL_MEMORY_BYTES = Math.round(TOTAL_MEMORY_BYTES);
/** Where the used-memory walk starts. */
const START_USED_MEMORY_BYTES = 16.4 * BYTES_PER_GIBIBYTE;
/** The used-memory walk stays between these fractions of the total. */
const MIN_USED_MEMORY_FRACTION = 0.3;
const MAX_USED_MEMORY_FRACTION = 0.9;
/** The width of one tick's used-memory step (half of it either way): busy, and the two quiet scenarios. */
const BUSY_MEMORY_STEP_SPAN_BYTES = 60 * BYTES_PER_MEBIBYTE;
const QUIET_MEMORY_STEP_SPAN_BYTES = 2 * BYTES_PER_MEBIBYTE;

/** idle and light draw each tick's CPU uniformly from [min, max). */
const IDLE_CPU_MIN_PERCENT = 1;
const IDLE_CPU_MAX_PERCENT = 4;
const LIGHT_CPU_MIN_PERCENT = 2;
const LIGHT_CPU_MAX_PERCENT = 14;
/** busy walks from its start by up to half the step span either way per tick, reflected off min and max. */
const BUSY_CPU_MIN_PERCENT = 15;
const BUSY_CPU_MAX_PERCENT = 90;
const BUSY_CPU_START_PERCENT = 50;
const BUSY_CPU_STEP_SPAN_PERCENT = 30;
/** A step is (draw - this) * span: a draw from [0, 1) centred on zero. */
const STEP_CENTRE = 0.5;

/** The pressure of idle, light and busy: cpu a share of the CPU figure, memory and io fixed; all under 25 %. */
const QUIET_CPU_PRESSURE_PER_CPU_PERCENT = 0.25;
const QUIET_MEMORY_PRESSURE_PERCENT = 0.1;
const QUIET_IO_PRESSURE_PERCENT = 0.2;
/** The swap on disk of idle, light and busy. */
const QUIET_DISK_SWAP_BYTES = 0;
/** strained's swap on disk at the start of each cycle, and what it gains on each tick of a phase that swaps. */
const STRAINED_BASE_DISK_SWAP_BYTES = 64 * BYTES_PER_MEBIBYTE;
const STRAINED_DISK_SWAP_GROWTH_BYTES_PER_TICK = BYTES_PER_MEBIBYTE;
/** strained's pressure in each kind of phase, in percent: calm under 10 %; waiting past 25 %; stalled past 50 %. */
const CALM_PRESSURE_PERCENTS = Object.freeze({cpu: 3, memory: 0.5, io: 2});
const WAITING_PRESSURE_PERCENTS = Object.freeze({cpu: 35, memory: 4, io: 30});
const STALLED_PRESSURE_PERCENTS = Object.freeze({cpu: 62, memory: 12, io: 56});
/**
 * strained's cycle, in order, from its first tick: each phase's length in ticks (2 s each), its pressure, and whether
 * swap on disk grows through it. 75 ticks: a history of CARD_HISTORY_SAMPLES (150) holds exactly two cycles.
 */
export const STRAINED_CYCLE_PHASES = Object.freeze([
    Object.freeze({tickCount: 10, pressureAvg10: CALM_PRESSURE_PERCENTS, isSwapGrowing: false}),
    Object.freeze({tickCount: 15, pressureAvg10: WAITING_PRESSURE_PERCENTS, isSwapGrowing: true}),
    Object.freeze({tickCount: 15, pressureAvg10: STALLED_PRESSURE_PERCENTS, isSwapGrowing: true}),
    Object.freeze({tickCount: 10, pressureAvg10: WAITING_PRESSURE_PERCENTS, isSwapGrowing: false}),
    Object.freeze({tickCount: 25, pressureAvg10: CALM_PRESSURE_PERCENTS, isSwapGrowing: false}),
]);
/** strained's cycle length in ticks: the sum of its phases'. */
const STRAINED_CYCLE_TICKS = STRAINED_CYCLE_PHASES.reduce((tickTotal, phase) => tickTotal + phase.tickCount, 0);

/**
 * The apps the replay ranks, as a ranking entry names one (lib/protocol.js's AppRanking): its group key and the name
 * the card shows.
 */
const CHROMIUM_APP = Object.freeze({groupKey: 'app.slice/chromium', name: 'Chromium'});
const HERDR_AGENTS_APP = Object.freeze({groupKey: 'app.slice/herdr-server.service', name: 'herdr agents'});
const CODE_APP = Object.freeze({groupKey: 'app.slice/app-code.scope', name: 'Code'});
const TERMINAL_APP = Object.freeze({groupKey: 'app.slice/app-ptyxis.scope', name: 'Terminal'});
const SLACK_APP = Object.freeze({groupKey: 'app.slice/app-slack.scope', name: 'Slack'});
const FILES_APP = Object.freeze({groupKey: 'app.slice/app-nautilus.scope', name: 'Files'});
const TEXT_EDITOR_APP = Object.freeze({groupKey: 'app.slice/app-org.gnome.TextEditor.scope', name: 'Text Editor'});
const SETTINGS_APP = Object.freeze({groupKey: 'app.slice/app-gnome-control-center.scope', name: 'Settings'});
const CALENDAR_APP = Object.freeze({groupKey: 'app.slice/app-org.gnome.Calendar.scope', name: 'Calendar'});
const SOFTWARE_APP = Object.freeze({groupKey: 'app.slice/app-org.gnome.Software.scope', name: 'Software'});
/**
 * The CPU ranking, largest first: each app's share of the snapshot's CPU busy percent, so the ranking follows the
 * scenario (idle's entries near 0 %, busy's tens of percent) and keeps its order; together they stay under the whole.
 * Ten entries: as many as the real sampler publishes (resource-pulse-sampler/src/constants.rs APP_RANKING_LENGTH),
 * more than the cockpit's apps card shows (lib/constants.js APPS_CARD_ROW_LIMIT). The first is the topCpu the replay
 * published before the rankings.
 */
const CPU_RANKING_SHARES = Object.freeze([
    {app: CHROMIUM_APP, shareOfCpuBusy: 0.6},
    {app: HERDR_AGENTS_APP, shareOfCpuBusy: 0.15},
    {app: CODE_APP, shareOfCpuBusy: 0.08},
    {app: TERMINAL_APP, shareOfCpuBusy: 0.05},
    {app: SLACK_APP, shareOfCpuBusy: 0.04},
    {app: FILES_APP, shareOfCpuBusy: 0.02},
    {app: TEXT_EDITOR_APP, shareOfCpuBusy: 0.015},
    {app: SETTINGS_APP, shareOfCpuBusy: 0.01},
    {app: CALENDAR_APP, shareOfCpuBusy: 0.008},
    {app: SOFTWARE_APP, shareOfCpuBusy: 0.005},
]);
/**
 * The memory ranking, largest first, in GiB: fixed, as the topMemory the replay published before the rankings (its
 * first entry) was. Ten entries, as the CPU ranking has.
 */
const MEMORY_RANKING_GIBIBYTES = Object.freeze([
    {app: HERDR_AGENTS_APP, gibibytes: 15.7},
    {app: CHROMIUM_APP, gibibytes: 4.2},
    {app: CODE_APP, gibibytes: 2.1},
    {app: SLACK_APP, gibibytes: 0.9},
    {app: TERMINAL_APP, gibibytes: 0.4},
    {app: FILES_APP, gibibytes: 0.2},
    {app: SOFTWARE_APP, gibibytes: 0.15},
    {app: CALENDAR_APP, gibibytes: 0.1},
    {app: SETTINGS_APP, gibibytes: 0.08},
    {app: TEXT_EDITOR_APP, gibibytes: 0.05},
]);

/** mulberry32's increment; the shifts and multipliers in createSeededRandom are the algorithm's published ones. */
const MULBERRY32_INCREMENT = 0x6D2B79F5;
/** 2^32: an unsigned 32-bit result over this is a draw from [0, 1). */
const UINT32_RANGE = 2 ** 32;

/**
 * A seeded source of draws from [0, 1): mulberry32, so a seed always gives the same draws.
 *
 * @param {number} seed - The seed, a 32-bit integer.
 * @returns {() => number} Returns the next draw.
 */
function createSeededRandom(seed) {
    let state = seed;
    return () => {
        state = (state + MULBERRY32_INCREMENT) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        const remixed = Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
        mixed = (mixed + remixed) ^ mixed;
        const unsignedResult = (mixed ^ (mixed >>> 14)) >>> 0;
        return unsignedResult / UINT32_RANGE;
    };
}

/**
 * A value held between two bounds.
 *
 * @param {number} value - Any number.
 * @param {number} min - The lowest result.
 * @param {number} max - The highest result.
 * @returns {number} The value, or the bound it crossed.
 */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * A value folded back into a range from the bound it crossed, as a walk bounces off a wall: a value past max by d
 * becomes max - d. One fold is enough while a step is narrower than the range, as busy's is.
 *
 * @param {number} value - The walk's position after a step.
 * @param {number} min - The lower bound.
 * @param {number} max - The upper bound.
 * @returns {number} The position inside [min, max].
 */
function reflectIntoRange(value, min, max) {
    if (value > max)
        return max - (value - max);
    if (value < min)
        return min + (min - value);
    return value;
}

/**
 * @typedef {object} ScenarioRequest
 * @property {string} scenarioName - The scenario to play: the file's word, or the default when it names none.
 * @property {string|null} requestText - The file's fields, single-spaced, when its word is a scenario: two requests
 *     for the same word differ here by their tokens. Null when the default plays because the file names none.
 * @property {string|null} rejectedText - The file's text when its word is not a scenario, for the log; else null.
 */

/**
 * Reads the scenario file's text: its first whitespace-separated field is the word, and what follows (the token the
 * harness writes with each request) only tells one request from the next.
 *
 * @param {string|null} fileText - The file's text; null when there is no readable file.
 * @returns {ScenarioRequest} What it asks for.
 */
export function parseScenarioRequest(fileText) {
    if (fileText === null)
        return {scenarioName: DEFAULT_REPLAY_SCENARIO_NAME, requestText: null, rejectedText: null};
    const trimmedText = fileText.trim();
    const requestFields = trimmedText.split(SCENARIO_FILE_FIELD_SEPARATOR_PATTERN);
    const [scenarioWord] = requestFields;
    if (!REPLAY_SCENARIO_NAMES.includes(scenarioWord))
        return {scenarioName: DEFAULT_REPLAY_SCENARIO_NAME, requestText: null, rejectedText: trimmedText};
    const requestText = requestFields.join(SCENARIO_REQUEST_FIELD_JOINER);
    return {scenarioName: scenarioWord, requestText, rejectedText: null};
}

/**
 * Whether a read of the scenario file must restart the replay: a request not read before restarts it, the word
 * already playing included (each `scenario` request carries a new token), and so does falling back to the default
 * from another scenario. Reading the same request again does not, nor does falling back to the scenario playing.
 *
 * @param {ScenarioRequest} lastRequest - What the previous read asked for.
 * @param {ScenarioRequest} readRequest - What this read asks for.
 * @returns {boolean} True when the replay must start the read scenario again from its seed.
 */
export function isNewScenarioRequest(lastRequest, readRequest) {
    if (readRequest.requestText !== null)
        return readRequest.requestText !== lastRequest.requestText;
    return readRequest.scenarioName !== lastRequest.scenarioName;
}

/**
 * The apps a replay snapshot carries, in the real sampler's shape (lib/protocol.js's AppRanking, as its parseAppRanking
 * reads it, field for field): the two winners and the two rankings, each winner its ranking's first entry. The
 * CPU figures follow the snapshot's CPU busy percent (CPU_RANKING_SHARES); the memory figures are fixed.
 *
 * @param {number} cpuBusyPercent - The snapshot's CPU busy percent, 0–100.
 * @returns {{topCpu: {groupKey: string, name: string, cpuPercent: number},
 *     topMemory: {groupKey: string, name: string, memoryBytes: number},
 *     cpuRanking: Array<{groupKey: string, name: string, cpuPercent: number}>,
 *     memoryRanking: Array<{groupKey: string, name: string, memoryBytes: number}>}} The snapshot's apps.
 */
export function replayApps(cpuBusyPercent) {
    const cpuRanking = CPU_RANKING_SHARES.map(({app, shareOfCpuBusy}) =>
        ({...app, cpuPercent: cpuBusyPercent * shareOfCpuBusy}));
    const memoryRanking = MEMORY_RANKING_GIBIBYTES.map(({app, gibibytes}) =>
        ({...app, memoryBytes: gibibytes * BYTES_PER_GIBIBYTE}));
    return {topCpu: {...cpuRanking[0]}, topMemory: {...memoryRanking[0]}, cpuRanking, memoryRanking};
}

/**
 * The apps of each snapshot at the real sampler's pace. The sampler renews its apps only when it scans them
 * (resource-pulse-sampler/src/cadence.rs, decide_app_scan: at its first tick, then every APP_SCAN_INTERVAL_SECONDS
 * while a detail watch is held), and every Sample between carries the last scan's; ranked afresh on every snapshot, the
 * cockpit's apps card would redraw its rows on every Sample, and a visible state would read above what the extension
 * costs with a real sampler. So the replay ranks (replayApps) at its first snapshot and then once every scan interval,
 * from that snapshot's CPU figure, and holds the apps between. Not replayed: the warm-up scan after the first, the
 * burst scans, and the longer interval with no watch held.
 */
export class ReplayAppScanner {
    /**
     * Starts with no scan: the first snapshot's apps are ranked afresh.
     *
     * @param {number} scanIntervalSnapshots - Snapshots from one scan to the next: lib/constants.js
     *     APP_SCAN_INTERVAL_SECONDS / SAMPLE_INTERVAL_SECONDS, the sampler's ticks between two scans.
     * @throws {Error} For anything but a whole number of snapshots, one or more.
     */
    constructor(scanIntervalSnapshots) {
        if (!Number.isInteger(scanIntervalSnapshots) || scanIntervalSnapshots < 1) {
            throw new Error('a scan interval is a whole number of snapshots, one or more: ' +
                `got ${scanIntervalSnapshots}`);
        }
        this._scanIntervalSnapshots = scanIntervalSnapshots;
        // Snapshots since the last scan, the scan's own included; null before the first.
        this._snapshotsSinceScan = null;
        this._scannedApps = null;
    }

    /**
     * The apps of the next snapshot: ranked afresh from its CPU figure at the first snapshot and at every
     * scanIntervalSnapshots-th after it, else the last scan's (the same object).
     *
     * @param {number} cpuBusyPercent - The snapshot's CPU busy percent, 0–100.
     * @returns {object} The snapshot's apps, in replayApps' shape.
     */
    appsOfNextSnapshot(cpuBusyPercent) {
        const isScanDue = this._snapshotsSinceScan === null || this._snapshotsSinceScan >= this._scanIntervalSnapshots;
        if (isScanDue) {
            this._scannedApps = replayApps(cpuBusyPercent);
            this._snapshotsSinceScan = 0;
        }
        this._snapshotsSinceScan++;
        return this._scannedApps;
    }
}

/**
 * The pressure and swap on disk of idle, light and busy: the replay's figures from before strained, all under 25 %.
 *
 * @param {number} cpuBusyPercent - The tick's CPU busy percent.
 * @returns {{pressureAvg10: {cpu: number, memory: number, io: number}, diskSwapBytes: number}} This tick's.
 */
function quietPressureAndSwap(cpuBusyPercent) {
    return {
        pressureAvg10: {
            cpu: cpuBusyPercent * QUIET_CPU_PRESSURE_PER_CPU_PERCENT,
            memory: QUIET_MEMORY_PRESSURE_PERCENT,
            io: QUIET_IO_PRESSURE_PERCENT,
        },
        diskSwapBytes: QUIET_DISK_SWAP_BYTES,
    };
}

/**
 * The phase of strained's cycle a tick falls in.
 *
 * @param {number} cycleTickIndex - The tick's place in its cycle, from 0 to STRAINED_CYCLE_TICKS - 1.
 * @returns {object} One of STRAINED_CYCLE_PHASES.
 */
function strainedPhaseAt(cycleTickIndex) {
    let phaseStartTick = 0;
    for (const phase of STRAINED_CYCLE_PHASES) {
        if (cycleTickIndex < phaseStartTick + phase.tickCount)
            return phase;
        phaseStartTick += phase.tickCount;
    }
    throw new Error(`tick ${cycleTickIndex} is past strained's cycle of ${STRAINED_CYCLE_TICKS} ticks`);
}

/**
 * The histories the replay publishes, kept as the real sampler keeps its own: each snapshot appends its CPU and
 * memory fractions and its three pressure percents, the newest CARD_HISTORY_SAMPLES of each kept.
 */
export class ReplayHistories {
    /**
     * Empty histories.
     *
     * @param {number} capacity - The values each keeps: lib/constants.js CARD_HISTORY_SAMPLES.
     */
    constructor(capacity) {
        this._capacity = capacity;
        this._cpu = [];
        this._memory = [];
        this._pressure = {cpu: [], memory: [], io: []};
    }

    /**
     * Appends a snapshot's values, dropping the oldest of each past the capacity.
     *
     * @param {object} snapshot - A replay snapshot (lib/protocol.js's Snapshot, every field set).
     * @returns {{cpu: number, memory: number, pressureAvg10: {cpu: number, memory: number, io: number}}} What it
     *     appended: the Sample's appendedHistory, in the order the sampler writes it.
     */
    append(snapshot) {
        const {cpu, memory, io} = snapshot.pressureAvg10;
        const appendedHistory = {
            cpu: snapshot.cpuBusyPercent / PERCENT,
            memory: snapshot.memory.usedBytes / snapshot.memory.totalBytes,
            pressureAvg10: {cpu, memory, io},
        };
        this._pushKeepingCapacity(this._cpu, appendedHistory.cpu);
        this._pushKeepingCapacity(this._memory, appendedHistory.memory);
        for (const [resourceName, history] of Object.entries(this._pressure))
            this._pushKeepingCapacity(history, appendedHistory.pressureAvg10[resourceName]);
        return appendedHistory;
    }

    /**
     * @returns {object} The histories as GetState carries them (lib/protocol.js buildStatePayload's histories): copies.
     */
    stateHistories() {
        return {
            cpu: [...this._cpu],
            memory: [...this._memory],
            pressureAvg10: {cpu: [...this._pressure.cpu], memory: [...this._pressure.memory], io: [...this._pressure.io]},
        };
    }

    /**
     * Appends one value to a history, dropping its oldest past the capacity.
     *
     * @param {number[]} history - One history.
     * @param {number} value - The value.
     * @returns {void}
     */
    _pushKeepingCapacity(history, value) {
        history.push(value);
        if (history.length > this._capacity)
            history.shift();
    }
}

/** One scenario's sequence of synthetic samples, from the fixed seed. */
export class ReplayGenerator {
    /**
     * Starts a scenario's sequence from the fixed seed.
     *
     * @param {string} scenarioName - One of REPLAY_SCENARIO_NAMES.
     * @throws {Error} For any other name: there are exactly four scenarios.
     */
    constructor(scenarioName) {
        if (!REPLAY_SCENARIO_NAMES.includes(scenarioName))
            throw new Error(`not a replay scenario: '${scenarioName}' (one of ${REPLAY_SCENARIO_NAMES.join(', ')})`);
        this._scenarioName = scenarioName;
        this._nextRandom = createSeededRandom(REPLAY_RANDOM_SEED);
        this._busyCpuPercent = BUSY_CPU_START_PERCENT;
        this._usedMemoryBytes = START_USED_MEMORY_BYTES;
        // strained's place in its cycle (the next tick's), and its swap on disk so far.
        this._strainedCycleTickIndex = 0;
        this._strainedDiskSwapBytes = STRAINED_BASE_DISK_SWAP_BYTES;
    }

    /** @returns {string} The scenario this sequence plays. */
    get scenarioName() {
        return this._scenarioName;
    }

    /**
     * The next tick's figures: the CPU draw first, then the memory step, then the pressure and the swap on disk, which
     * draw nothing, so idle, light and busy give the CPU and memory figures they always gave.
     *
     * @returns {{cpuBusyPercent: number, usedMemoryBytes: number, pressureAvg10: {cpu: number, memory: number,
     *     io: number}, diskSwapBytes: number}} CPU busy 0–100, used memory in whole bytes, the three pressure
     *     percents, and the swap on disk in whole bytes.
     */
    nextValues() {
        const cpuBusyPercent = this._nextCpuPercent();
        const usedMemoryBytes = this._nextUsedMemoryBytes();
        if (this._scenarioName !== STRAINED_SCENARIO_NAME)
            return {cpuBusyPercent, usedMemoryBytes, ...quietPressureAndSwap(cpuBusyPercent)};
        return {cpuBusyPercent, usedMemoryBytes, ...this._nextStrainedPressureAndSwap()};
    }

    /**
     * Steps strained's cycle: the phase's pressure, and the swap on disk grown by a tick while the phase swaps; back to
     * its base when a cycle starts.
     *
     * @returns {{pressureAvg10: {cpu: number, memory: number, io: number}, diskSwapBytes: number}} This tick's.
     */
    _nextStrainedPressureAndSwap() {
        if (this._strainedCycleTickIndex === 0)
            this._strainedDiskSwapBytes = STRAINED_BASE_DISK_SWAP_BYTES;
        const phase = strainedPhaseAt(this._strainedCycleTickIndex);
        if (phase.isSwapGrowing)
            this._strainedDiskSwapBytes += STRAINED_DISK_SWAP_GROWTH_BYTES_PER_TICK;
        this._strainedCycleTickIndex = (this._strainedCycleTickIndex + 1) % STRAINED_CYCLE_TICKS;
        return {pressureAvg10: {...phase.pressureAvg10}, diskSwapBytes: this._strainedDiskSwapBytes};
    }

    /**
     * Draws the next CPU busy percent of this scenario.
     *
     * @returns {number} The percent.
     */
    _nextCpuPercent() {
        if (this._scenarioName === IDLE_SCENARIO_NAME)
            return this._nextUniform(IDLE_CPU_MIN_PERCENT, IDLE_CPU_MAX_PERCENT);
        if (this._scenarioName === LIGHT_SCENARIO_NAME)
            return this._nextUniform(LIGHT_CPU_MIN_PERCENT, LIGHT_CPU_MAX_PERCENT);
        // busy and strained.
        const busyStepPercent = this._nextCentredStep(BUSY_CPU_STEP_SPAN_PERCENT);
        this._busyCpuPercent = reflectIntoRange(this._busyCpuPercent + busyStepPercent, BUSY_CPU_MIN_PERCENT,
            BUSY_CPU_MAX_PERCENT);
        return this._busyCpuPercent;
    }

    /**
     * Steps the used-memory walk: wider while busy.
     *
     * @returns {number} Used memory, in whole bytes.
     */
    _nextUsedMemoryBytes() {
        const isBusyWalk = BUSY_WALK_SCENARIO_NAMES.includes(this._scenarioName);
        const stepSpanBytes = isBusyWalk ? BUSY_MEMORY_STEP_SPAN_BYTES : QUIET_MEMORY_STEP_SPAN_BYTES;
        const memoryStepBytes = this._nextCentredStep(stepSpanBytes);
        const minUsedBytes = TOTAL_MEMORY_BYTES * MIN_USED_MEMORY_FRACTION;
        const maxUsedBytes = TOTAL_MEMORY_BYTES * MAX_USED_MEMORY_FRACTION;
        this._usedMemoryBytes = clamp(this._usedMemoryBytes + memoryStepBytes, minUsedBytes, maxUsedBytes);
        return Math.round(this._usedMemoryBytes);
    }

    /**
     * Draws a value uniformly from [min, max).
     *
     * @param {number} min - The lowest value.
     * @param {number} max - The value never reached.
     * @returns {number} The value.
     */
    _nextUniform(min, max) {
        return min + (max - min) * this._nextRandom();
    }

    /**
     * Draws a step from [-span / 2, span / 2).
     *
     * @param {number} span - The width of the range.
     * @returns {number} The step.
     */
    _nextCentredStep(span) {
        return (this._nextRandom() - STEP_CENTRE) * span;
    }
}
