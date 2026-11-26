// Rows for the nested harness's own pure modules (scripts/resource-pulse-nested.sh):
// - the unsafe-mode helper's check that keeps it from turning on unsafe mode in any shell but the nested one that
//   script started. nestedRun.js has no Shell import, so it runs here; the helper's extension.js imports the Shell
//   and only calls it.
// - the replay service's generator and scenario requests (replayGenerator.js), which has no gi import: the input
//   every `start --replay` run publishes, the same in every run of every version of the extension, and when a
//   `scenario` request restarts it; and the apps its snapshots carry, read as the extension reads them, ranked
//   afresh as often as the real sampler scans them (ReplayAppScanner, and replay-service.js's use of it, read as text:
//   the service runs at import, so no row can load it); strained's cycle of pressure and swap; and the histories it
//   publishes (ReplayHistories), the pressure histories included, read as the extension reads them.
import GLib from 'gi://GLib';
import {test, assertEqual} from './harness.js';
import {isNestedRunRuntimeDir} from './nested/resource-pulse-nested-unsafe-mode@local/nestedRun.js';
import {
    REPLAY_SCENARIO_NAMES, ReplayGenerator, isNewScenarioRequest, parseScenarioRequest,
} from './nested/replayGenerator.js';
// Read through the namespace, so that a missing export fails its own rows rather than every row of the run.
import * as replayGeneratorModule from './nested/replayGenerator.js';
import {
    APP_SCAN_INTERVAL_SECONDS, APPS_CARD_ROW_LIMIT, BYTES_PER_GIBIBYTE, CARD_HISTORY_SAMPLES, SAMPLE_INTERVAL_SECONDS,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';
import {
    buildSamplePayload, buildStatePayload, parseSamplePayload, parseStatePayload,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';
import {pressureBand} from '../extensions/resource-pulse@zvibaratz.github.io/lib/pressure.js';
import {quantisedColumns} from '../extensions/resource-pulse@zvibaratz.github.io/lib/topbarColumns.js';
import {TOPBAR_GRAPH_HEIGHT_PX} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';

const RUN_DIR = '/run/user/1000/rpn.Abc12345';
/** The replay service's file, read as text by its row. */
const REPLAY_SERVICE_URI = GLib.uri_resolve_relative(import.meta.url, './nested/replay-service.js', GLib.UriFlags.NONE);
/** The sampler's constants, where its ranking length is set. */
const SAMPLER_CONSTANTS_URI = GLib.uri_resolve_relative(import.meta.url,
    '../../resource-pulse-sampler/src/constants.rs', GLib.UriFlags.NONE);
const SAMPLER_APP_RANKING_LENGTH_PATTERN = /^pub const APP_RANKING_LENGTH: u64 = (\d+);$/m;
/**
 * The real sampler's app scan interval while a detail watch is held, in its ticks
 * (resource-pulse-sampler/src/cadence.rs counts it so): the snapshots a replay's apps are held for.
 */
const APP_SCAN_INTERVAL_SNAPSHOTS = APP_SCAN_INTERVAL_SECONDS / SAMPLE_INTERVAL_SECONDS;
/** How many scan intervals of busy snapshots the pace row reads. */
const SCAN_INTERVALS_CHECKED = 3;
/** Intervals ReplayAppScanner must refuse: none is a whole number of snapshots, one or more. */
const REFUSED_SCAN_INTERVALS = [0, -APP_SCAN_INTERVAL_SNAPSHOTS, 2.5, Number.NaN, String(APP_SCAN_INTERVAL_SNAPSHOTS),
    null];
/** The CPU busy percents the apps rows read the replay's rankings at: idle's lowest, busy's highest, and one between. */
const IDLE_CPU_BUSY_PERCENT = 1;
const BUSY_CPU_BUSY_PERCENT = 90;
const TEN_CPU_BUSY_PERCENT = 10;
/**
 * The two winners the replay published before the rankings (replay-service.js's topCpu and topMemory at 10 % CPU
 * busy), written out: the rankings must leave them as they were.
 */
const WINNERS_AT_TEN_CPU_BUSY_PERCENT = {
    topCpu: {groupKey: 'app.slice/chromium', name: 'Chromium', cpuPercent: 6},
    topMemory: {groupKey: 'app.slice/herdr-server.service', name: 'herdr agents', memoryBytes: 15.7 * BYTES_PER_GIBIBYTE},
};
/** A state payload's fields other than the snapshot, as the real service sends them before its first Sample. */
const STATE_PAYLOAD_REST = Object.freeze({
    histories: {cpu: [], memory: [], pressureAvg10: {cpu: [], memory: [], io: []}},
    serviceStartedAtUsec: 1,
    sequence: 0,
});
/** How many of a scenario's first values the range rows read. */
const REPLAY_VALUES_CHECKED = 10;
/** How many idle values the one-pixel row quantises: more than a perf window's 60 s of Samples. */
const IDLE_VALUES_QUANTISED = 100;
/** The scales the nested harness's start --monitor-scale takes, whole ones and the highest (its MAX_MONITOR_SCALE). */
const NESTED_MONITOR_SCALES_CHECKED = [1, 1.5, 2, 3, 4];
const PERCENT_PER_FRACTION = 100;
/** How many of busy's first values its walk row reads: far enough for the walk to meet both bounds many times. */
const BUSY_WALK_VALUES_CHECKED = 630;
/** Decimal places a pinned value is compared to: well inside a double, and far finer than any pixel. */
const PINNED_VALUE_DECIMALS = 6;
/**
 * The first three CPU values of each scenario, as the replay generator (mulberry32 seeded
 * with 20261110) produces them from a fresh seed. Pinned, so a changed seed or algorithm, or one seeded from the
 * clock, fails here: every run must be measured against this same input.
 */
const PINNED_FIRST_CPU_PERCENTS_BY_SCENARIO = {
    idle: [0.818612, 1.205806, 0.6513],
    light: [7.710263, 11.284362, 6.165845],
    busy: [49.275657, 57.486563, 52.901175],
    // strained draws busy's walk from the same seed.
    strained: [49.275657, 57.486563, 52.901175],
};
/** strained's cycle, in ticks (2 s each): 150 s. */
const STRAINED_CYCLE_TICKS = 75;
/** Ticks in 10 s: avg10's own window, and the span over which swap growth is judged. */
const TICKS_IN_TEN_SECONDS = 5;
/** One mebibyte: strained's swap on disk grows by exactly this a tick while it grows. */
const BYTES_PER_MEBIBYTE = 1024 ** 2;
/** Swap on disk growing by more than this in 10 s counts as swapping. */
const SWAPPING_GROWTH_BYTES = BYTES_PER_MEBIBYTE;
/** The bands the extension lights for strain: from the second (25 %), and the third (50 %). */
const WAITING_BAND = 2;
const STALLED_BAND = 3;
/** The calm band. */
const CALM_BAND = 0;
/**
 * strained's cpu and io pressure bands through one cycle, as the guide, the changelog and `scenario`'s usage state
 * them: calm for 20 s, past 25 % for 30 s, past 50 % for 30 s, past 25 % for 20 s, and calm for 50 s.
 */
const STRAINED_BAND_RUNS = Object.freeze([
    {value: CALM_BAND, length: 10}, {value: WAITING_BAND, length: 15}, {value: STALLED_BAND, length: 15},
    {value: WAITING_BAND, length: 10}, {value: CALM_BAND, length: 25},
]);

/**
 * The first values a fresh generator gives for a scenario.
 *
 * @param {string} scenarioName - One of REPLAY_SCENARIO_NAMES.
 * @param {number} valueCount - How many to take.
 * @returns {Array<{cpuBusyPercent: number, usedMemoryBytes: number}>} The values, in order.
 */
function firstReplayValues(scenarioName, valueCount) {
    const generator = new ReplayGenerator(scenarioName);
    return Array.from({length: valueCount}, () => generator.nextValues());
}

/**
 * The first CPU percents of a scenario that lie outside a range, and how many were read.
 *
 * @param {string} scenarioName - One of REPLAY_SCENARIO_NAMES.
 * @param {number} minPercent - The lowest allowed value.
 * @param {number} maxPercent - The highest allowed value.
 * @param {number} [valueCount] - How many values to read.
 * @returns {{readCount: number, outside: number[]}} How many values were read (an empty read has nothing outside
 *     the range either, so a row asserts the count too), and those outside the range.
 */
function cpuPercentsOutsideRange(scenarioName, minPercent, maxPercent, valueCount = REPLAY_VALUES_CHECKED) {
    const cpuPercents = firstReplayValues(scenarioName, valueCount).map(values => values.cpuBusyPercent);
    const outside = cpuPercents.filter(cpuPercent => !(cpuPercent >= minPercent && cpuPercent <= maxPercent));
    return {readCount: cpuPercents.length, outside};
}

/**
 * The positions of a scenario's first CPU percents that repeat the value before them.
 *
 * @param {string} scenarioName - One of REPLAY_SCENARIO_NAMES.
 * @param {number} valueCount - How many values to read.
 * @returns {number[]} Each index whose value equals the previous one.
 */
function repeatedCpuPercentIndexes(scenarioName, valueCount) {
    const cpuPercents = firstReplayValues(scenarioName, valueCount).map(values => values.cpuBusyPercent);
    const isRepeatAt = index => index > 0 && cpuPercents[index] === cpuPercents[index - 1];
    return cpuPercents.flatMap((_cpuPercent, index) => (isRepeatAt(index) ? [index] : []));
}

/**
 * A number rounded to PINNED_VALUE_DECIMALS places.
 *
 * @param {number} value - Any number.
 * @returns {number} The rounded number.
 */
function roundedForPin(value) {
    return Number(value.toFixed(PINNED_VALUE_DECIMALS));
}

/**
 * The replay service's text, every run of whitespace made one space, so a row can find a statement however it wraps.
 *
 * @returns {string} The text.
 */
function replayServiceTextOnOneLine() {
    const [servicePath] = GLib.filename_from_uri(REPLAY_SERVICE_URI);
    const [, contentBytes] = GLib.file_get_contents(servicePath);
    return new TextDecoder().decode(contentBytes).replace(/\s+/g, ' ');
}

/**
 * How many times a text holds a part.
 *
 * @param {string} text - The text.
 * @param {string} part - The part, matched as it is.
 * @returns {number} The count.
 */
function countOf(text, part) {
    return text.split(part).length - 1;
}

test('nested helper: unsafe mode only when the runtime dir is exactly <run dir>/run', () => {
    assertEqual([
        isNestedRunRuntimeDir(RUN_DIR, `${RUN_DIR}/run`),
        isNestedRunRuntimeDir(RUN_DIR, `${RUN_DIR}/run/nested`),
        isNestedRunRuntimeDir(RUN_DIR, `${RUN_DIR}/home`),
        isNestedRunRuntimeDir(RUN_DIR, '/run/user/1000'),
        isNestedRunRuntimeDir(RUN_DIR, `${RUN_DIR}/run/`),
        isNestedRunRuntimeDir(null, `${RUN_DIR}/run`),
        isNestedRunRuntimeDir('', '/run'),
    ], [true, false, false, false, false, false, false]);
});

test('replay generator: the first ten idle CPU values lie in 0.2–1.5 %', () => {
    assertEqual(cpuPercentsOutsideRange('idle', 0.2, 1.5), {readCount: REPLAY_VALUES_CHECKED, outside: []});
});

test('replay generator: idle CPU stays at one device pixel of the top bar\'s graph at every scale the nested ' +
    'harness takes, up to 4, so a covered card at idle input draws no top-bar frame', () => {
    const idleFractions = firstReplayValues('idle', IDLE_VALUES_QUANTISED)
        .map(values => values.cpuBusyPercent / PERCENT_PER_FRACTION);
    const levelsByScale = Object.fromEntries(NESTED_MONITOR_SCALES_CHECKED.map(scale =>
        [scale, [...new Set(quantisedColumns(idleFractions, TOPBAR_GRAPH_HEIGHT_PX, scale))]]));
    assertEqual(levelsByScale, {1: [1], 1.5: [1], 2: [1], 3: [1], 4: [1]});
});

test('replay generator: the first ten light CPU values lie in 2–14 %', () => {
    assertEqual(cpuPercentsOutsideRange('light', 2, 14), {readCount: REPLAY_VALUES_CHECKED, outside: []});
});

test('replay generator: the first 630 busy CPU values lie in 15–90 % and each differs from the one before', () => {
    assertEqual({
        range: cpuPercentsOutsideRange('busy', 15, 90, BUSY_WALK_VALUES_CHECKED),
        repeatedIndexes: repeatedCpuPercentIndexes('busy', BUSY_WALK_VALUES_CHECKED),
    }, {range: {readCount: BUSY_WALK_VALUES_CHECKED, outside: []}, repeatedIndexes: []});
});

test('replay generator: two runs give the same sequence, the fixed seed\'s first values', () => {
    for (const scenarioName of REPLAY_SCENARIO_NAMES) {
        const firstRunValues = firstReplayValues(scenarioName, REPLAY_VALUES_CHECKED);
        const secondRunValues = firstReplayValues(scenarioName, REPLAY_VALUES_CHECKED);
        assertEqual(secondRunValues, firstRunValues, `${scenarioName}: the second run differs`);
        const pinnedCpuPercents = PINNED_FIRST_CPU_PERCENTS_BY_SCENARIO[scenarioName];
        const leadingCpuPercents = firstRunValues.slice(0, pinnedCpuPercents.length)
            .map(values => roundedForPin(values.cpuBusyPercent));
        assertEqual(leadingCpuPercents, pinnedCpuPercents, `${scenarioName}: not the fixed seed's sequence`);
    }
});

test('replay generator: exactly the scenarios idle, light, busy and strained; any other name is refused', () => {
    const refusedNames = ['silent', 'IDLE', '', 'idle '].filter(scenarioName => {
        try {
            new ReplayGenerator(scenarioName);
            return false;
        } catch (_error) {
            return true;
        }
    });
    assertEqual([REPLAY_SCENARIO_NAMES, refusedNames],
        [['idle', 'light', 'busy', 'strained'], ['silent', 'IDLE', '', 'idle ']]);
});

test('replay request: each scenario request restarts the replay, the word playing included; a re-read does not', () => {
    const nothingAsked = parseScenarioRequest(null);
    const busyAsked = parseScenarioRequest('busy Ab12Cd\n');
    const idleAsked = parseScenarioRequest('idle Ef34Gh\n');
    const restartsByCase = {
        'busy asked on a fresh run': isNewScenarioRequest(nothingAsked, busyAsked),
        'the same request read again': isNewScenarioRequest(busyAsked, parseScenarioRequest('busy Ab12Cd')),
        'busy asked again': isNewScenarioRequest(busyAsked, parseScenarioRequest('busy Ij56Kl\n')),
        'idle asked while busy plays': isNewScenarioRequest(busyAsked, idleAsked),
        'the file gone while idle plays': isNewScenarioRequest(idleAsked, parseScenarioRequest(null)),
        'a bad word while busy plays': isNewScenarioRequest(busyAsked, parseScenarioRequest('turbo Mn78Op')),
        'an empty file while busy plays': isNewScenarioRequest(busyAsked, parseScenarioRequest('')),
        'nothing asked, read again': isNewScenarioRequest(nothingAsked, parseScenarioRequest(null)),
    };
    const playedByFileText = ['busy Ab12Cd\n', 'idle Ef34Gh', ' light  Qr90St \n', 'turbo Mn78Op', 'IDLE x', '']
        .map(fileText => parseScenarioRequest(fileText).scenarioName);
    assertEqual({restartsByCase, playedByFileText, nothingAskedPlays: nothingAsked.scenarioName}, {
        restartsByCase: {
            'busy asked on a fresh run': true,
            'the same request read again': false,
            'busy asked again': true,
            'idle asked while busy plays': true,
            'the file gone while idle plays': true,
            'a bad word while busy plays': false,
            'an empty file while busy plays': false,
            'nothing asked, read again': false,
        },
        playedByFileText: ['busy', 'idle', 'light', 'busy', 'busy', 'busy'],
        nothingAskedPlays: 'busy',
    });
});

/**
 * Whether a ranking is largest first by one field.
 *
 * @param {Array<object>} ranking - A ranking's entries.
 * @param {string} valueFieldName - 'cpuPercent' or 'memoryBytes'.
 * @returns {boolean} True when no entry is larger than the one before it.
 */
function isLargestFirst(ranking, valueFieldName) {
    return ranking.every((entry, entryIndex) => entryIndex === 0 ||
        ranking[entryIndex - 1][valueFieldName] >= entry[valueFieldName]);
}

test('replay: the apps a snapshot carries reach the extension\'s reader (lib/protocol.js) field for field, both ' +
    'winners and both rankings, nothing dropped', () => {
    const sentApps = replayGeneratorModule.replayApps(BUSY_CPU_BUSY_PERCENT);
    const statePayload = buildStatePayload({...STATE_PAYLOAD_REST, snapshot: {apps: sentApps}});
    assertEqual(parseStatePayload(statePayload).snapshot.apps, sentApps);
});

/**
 * @returns {number} The sampler's APP_RANKING_LENGTH, read from its source (resource-pulse-sampler/src/constants.rs):
 *     how many apps it publishes in each ranking.
 */
function samplerAppRankingLength() {
    const constantsPath = GLib.filename_from_uri(SAMPLER_CONSTANTS_URI)[0];
    const [, constantsBytes] = GLib.file_get_contents(constantsPath);
    const constantsText = new TextDecoder().decode(constantsBytes);
    const rankingLengthMatch = constantsText.match(SAMPLER_APP_RANKING_LENGTH_PATTERN);
    if (rankingLengthMatch === null)
        throw new Error(`no APP_RANKING_LENGTH in ${constantsPath}`);
    return Number(rankingLengthMatch[1]);
}

test('replay: each ranking holds as many entries as the sampler publishes (its APP_RANKING_LENGTH), more than the ' +
    'apps card shows, each named, with a group key of its own, largest first; topCpu and topMemory are their first ' +
    'entries, as the replay published them before the rankings', () => {
    const {topCpu, topMemory, cpuRanking, memoryRanking} = replayGeneratorModule.replayApps(TEN_CPU_BUSY_PERCENT);
    const rankingLength = samplerAppRankingLength();
    const distinctGroupKeyCount = ranking => new Set(ranking.map(entry => entry.groupKey)).size;
    assertEqual({
        lengths: [cpuRanking.length, memoryRanking.length],
        distinctGroupKeys: [distinctGroupKeyCount(cpuRanking), distinctGroupKeyCount(memoryRanking)],
        named: [...cpuRanking, ...memoryRanking].every(entry => typeof entry.name === 'string' && entry.name !== ''),
        largestFirst: [isLargestFirst(cpuRanking, 'cpuPercent'), isLargestFirst(memoryRanking, 'memoryBytes')],
        winnersAreFirstEntries: JSON.stringify([topCpu, topMemory]) === JSON.stringify([cpuRanking[0], memoryRanking[0]]),
        winners: {topCpu, topMemory},
        isMoreThanTheCardShows: rankingLength > APPS_CARD_ROW_LIMIT,
    }, {
        lengths: [rankingLength, rankingLength],
        distinctGroupKeys: [rankingLength, rankingLength],
        named: true,
        largestFirst: [true, true],
        winnersAreFirstEntries: true,
        winners: WINNERS_AT_TEN_CPU_BUSY_PERCENT,
        isMoreThanTheCardShows: true,
    });
});

test('replay: the CPU ranking follows the snapshot\'s CPU figure (each entry the same share of it, in the same ' +
    'order, idle\'s near 0 % and busy\'s tens of percent, together never above it); the memory ranking is fixed', () => {
    const idleApps = replayGeneratorModule.replayApps(IDLE_CPU_BUSY_PERCENT);
    const busyApps = replayGeneratorModule.replayApps(BUSY_CPU_BUSY_PERCENT);
    const sharesOf = ({cpuRanking}, cpuBusyPercent) =>
        cpuRanking.map(entry => Number((entry.cpuPercent / cpuBusyPercent).toFixed(PINNED_VALUE_DECIMALS)));
    const idleShares = sharesOf(idleApps, IDLE_CPU_BUSY_PERCENT);
    const busyCpuTotal = busyApps.cpuRanking.reduce((total, entry) => total + entry.cpuPercent, 0);
    assertEqual({
        sameShares: JSON.stringify(idleShares) === JSON.stringify(sharesOf(busyApps, BUSY_CPU_BUSY_PERCENT)),
        everyShareAboveZero: idleShares.every(share => share > 0),
        sameOrder: JSON.stringify(idleApps.cpuRanking.map(entry => entry.name)) ===
            JSON.stringify(busyApps.cpuRanking.map(entry => entry.name)),
        busyTotalWithinBusy: busyCpuTotal <= BUSY_CPU_BUSY_PERCENT,
        memoryFixed: JSON.stringify(idleApps.memoryRanking) === JSON.stringify(busyApps.memoryRanking),
    }, {sameShares: true, everyShareAboveZero: true, sameOrder: true, busyTotalWithinBusy: true, memoryFixed: true});
});

test('replay: the apps are ranked afresh as often as the real sampler scans them with a detail watch held (every ' +
    'APP_SCAN_INTERVAL_SECONDS / SAMPLE_INTERVAL_SECONDS snapshots, from the first, at that snapshot\'s CPU ' +
    'figure) and held between: inside one scan interval every snapshot carries the same apps, the next interval\'s ' +
    'differ under busy input; topCpu and topMemory are the first entries at every snapshot', () => {
    const scanner = new replayGeneratorModule.ReplayAppScanner(APP_SCAN_INTERVAL_SNAPSHOTS);
    const cpuBusyPercents = firstReplayValues('busy', SCAN_INTERVALS_CHECKED * APP_SCAN_INTERVAL_SNAPSHOTS)
        .map(values => values.cpuBusyPercent);
    const appsBySnapshot = cpuBusyPercents.map(cpuBusyPercent => scanner.appsOfNextSnapshot(cpuBusyPercent));
    const scanSnapshotIndexOf = snapshotIndex => snapshotIndex - (snapshotIndex % APP_SCAN_INTERVAL_SNAPSHOTS);
    const appsOfScanAt = snapshotIndex =>
        replayGeneratorModule.replayApps(cpuBusyPercents[scanSnapshotIndexOf(snapshotIndex)]);
    const intervalIndexes = Array.from({length: SCAN_INTERVALS_CHECKED}, (_, intervalIndex) => intervalIndex);
    const appsOfInterval = intervalIndex => appsBySnapshot.slice(intervalIndex * APP_SCAN_INTERVAL_SNAPSHOTS,
        (intervalIndex + 1) * APP_SCAN_INTERVAL_SNAPSHOTS).map(apps => JSON.stringify(apps));
    const winnersAreFirstEntries = apps => JSON.stringify([apps.topCpu, apps.topMemory]) ===
        JSON.stringify([apps.cpuRanking[0], apps.memoryRanking[0]]);
    assertEqual({
        heldForMoreThanOneSnapshot: APP_SCAN_INTERVAL_SNAPSHOTS > 1,
        snapshotCount: appsBySnapshot.length,
        snapshotsNotCarryingTheirScan: appsBySnapshot.flatMap((apps, snapshotIndex) =>
            (JSON.stringify(apps) === JSON.stringify(appsOfScanAt(snapshotIndex)) ? [] : [snapshotIndex])),
        distinctAppsInEachInterval: intervalIndexes.map(intervalIndex => new Set(appsOfInterval(intervalIndex)).size),
        distinctIntervals: new Set(intervalIndexes.map(intervalIndex => appsOfInterval(intervalIndex)[0])).size,
        winnersAreFirstEntries: appsBySnapshot.every(winnersAreFirstEntries),
    }, {
        heldForMoreThanOneSnapshot: true,
        snapshotCount: SCAN_INTERVALS_CHECKED * APP_SCAN_INTERVAL_SNAPSHOTS,
        snapshotsNotCarryingTheirScan: [],
        distinctAppsInEachInterval: intervalIndexes.map(() => 1),
        distinctIntervals: SCAN_INTERVALS_CHECKED,
        winnersAreFirstEntries: true,
    });
});

test('replay: a scan interval that is not a whole number of snapshots, one or more, is refused, naming it; one ' +
    'snapshot and the sampler\'s own interval are taken', () => {
    const outcomeOf = scanIntervalSnapshots => {
        try {
            new replayGeneratorModule.ReplayAppScanner(scanIntervalSnapshots);
            return 'taken';
        } catch (error) {
            return error.message.includes(`got ${scanIntervalSnapshots}`) ? 'refused, named' : `refused: ${error}`;
        }
    };
    assertEqual({
        refused: REFUSED_SCAN_INTERVALS.map(outcomeOf),
        taken: [1, APP_SCAN_INTERVAL_SNAPSHOTS].map(outcomeOf),
    }, {
        refused: REFUSED_SCAN_INTERVALS.map(() => 'refused, named'),
        taken: ['taken', 'taken'],
    });
});

test('replay service: each scenario\'s snapshots take their apps from one ReplayAppScanner made with the ' +
    'extension\'s own APP_SCAN_INTERVAL_SECONDS / SAMPLE_INTERVAL_SECONDS, never from replayApps on every ' +
    'snapshot', () => {
    const serviceText = replayServiceTextOnOneLine();
    assertEqual({
        imported: countOf(serviceText, 'REPLAY_TOTAL_MEMORY_BYTES, ReplayAppScanner, ReplayGenerator,'),
        intervalFromTheExtension: countOf(serviceText, 'const appScanIntervalSnapshots = ' +
            'this._constants.APP_SCAN_INTERVAL_SECONDS / this._constants.SAMPLE_INTERVAL_SECONDS;'),
        scannerPerScenario: countOf(serviceText, 'this._generator = new ReplayGenerator(scenarioName); ' +
            'this._appScanner = new ReplayAppScanner(appScanIntervalSnapshots);'),
        appsFromTheScanner: countOf(serviceText, 'apps: this._appScanner.appsOfNextSnapshot(cpuBusyPercent),'),
        rankedEverySnapshot: countOf(serviceText, 'replayApps('),
    }, {
        imported: 1, intervalFromTheExtension: 1, scannerPerScenario: 1, appsFromTheScanner: 1, rankedEverySnapshot: 0,
    });
});

/**
 * The band of each resource's pressure over strained's ticks, as the extension bands it (lib/pressure.js).
 *
 * @param {Array<object>} values - Generator values, one per tick.
 * @param {string} resourceName - 'cpu', 'memory' or 'io'.
 * @returns {number[]} One band per tick.
 */
function pressureBandsOf(values, resourceName) {
    return values.map(tickValues => pressureBand(tickValues.pressureAvg10[resourceName]));
}

/**
 * The runs of equal values in a list, in order: each value once per run.
 *
 * @param {Array<*>} values - The list.
 * @returns {Array<*>} The values with each run collapsed to one.
 */
function runsOf(values) {
    return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

/**
 * The runs of equal values in a list, in order, with their lengths.
 *
 * @param {Array<*>} values - The list.
 * @returns {Array<{value: *, length: number}>} One entry per run: its value and how many values it holds.
 */
function runLengthsOf(values) {
    const runs = [];
    values.forEach((value, index) => {
        if (index === 0 || value !== values[index - 1])
            runs.push({value, length: 0});
        runs[runs.length - 1].length++;
    });
    return runs;
}

test('replay generator: strained\'s cpu and io pressure go calm for 10 ticks, past 25 % for 15, past 50 % for 15, ' +
    'past 25 % for 10 and calm for 25, a cycle of 150 s, the same every cycle, and memory pressure never past 25 %',
() => {
    const twoCycles = firstReplayValues('strained', 2 * STRAINED_CYCLE_TICKS);
    const firstCycle = twoCycles.slice(0, STRAINED_CYCLE_TICKS);
    const secondCycle = twoCycles.slice(STRAINED_CYCLE_TICKS);
    const pressureOf = values => values.map(tickValues => tickValues.pressureAvg10);
    assertEqual({
        cpuRuns: runLengthsOf(pressureBandsOf(firstCycle, 'cpu')),
        ioRuns: runLengthsOf(pressureBandsOf(firstCycle, 'io')),
        memoryHighestBand: Math.max(...pressureBandsOf(twoCycles, 'memory')),
        isEveryCycleTheSame: JSON.stringify(pressureOf(firstCycle)) === JSON.stringify(pressureOf(secondCycle)),
        isWholeCyclesInAHistory: CARD_HISTORY_SAMPLES % STRAINED_CYCLE_TICKS === 0,
    }, {
        cpuRuns: STRAINED_BAND_RUNS,
        ioRuns: STRAINED_BAND_RUNS,
        memoryHighestBand: 1,
        isEveryCycleTheSame: true,
        isWholeCyclesInAHistory: true,
    });
});

test('replay generator: strained\'s swap on disk grows by more than 1 MiB in 10 s while the pressure rises, exactly ' +
    '1 MiB a tick through its 30 ticks past 25 % and 50 %, then stops for the rest of the cycle, and starts the next ' +
    'cycle where the first began', () => {
    const diskSwapBytes = firstReplayValues('strained', STRAINED_CYCLE_TICKS + 1).map(values => values.diskSwapBytes);
    // The growth at each tick after the cycle's first, which is calm.
    const growthPerTick = diskSwapBytes.slice(1, STRAINED_CYCLE_TICKS).map((bytes, index) =>
        bytes - diskSwapBytes[index]);
    const growthOverTenSeconds = diskSwapBytes.slice(TICKS_IN_TEN_SECONDS).map((bytes, index) =>
        bytes - diskSwapBytes[index]);
    const isSwappingAt = growthOverTenSeconds.map(growthBytes => growthBytes > SWAPPING_GROWTH_BYTES);
    assertEqual({
        swappingRuns: runsOf(isSwappingAt),
        growthPerTickRuns: runLengthsOf(growthPerTick),
        neverShrinksInACycle: diskSwapBytes.slice(0, STRAINED_CYCLE_TICKS).every((bytes, index) =>
            index === 0 || bytes >= diskSwapBytes[index - 1]),
        nextCycleStartsAtTheFirst: diskSwapBytes[STRAINED_CYCLE_TICKS] === diskSwapBytes[0],
    }, {
        swappingRuns: [false, true, false],
        // The calm phase's 10 ticks less the first; the two strained phases; the rest of the cycle.
        growthPerTickRuns: [
            {value: 0, length: 9}, {value: BYTES_PER_MEBIBYTE, length: 30}, {value: 0, length: 35},
        ],
        neverShrinksInACycle: true, nextCycleStartsAtTheFirst: true,
    });
});

test('replay generator: idle, light and busy keep their pressure under 25 % and no swap on disk, so nothing lights ' +
    'for strain outside strained', () => {
    const quietScenarioNames = REPLAY_SCENARIO_NAMES.filter(scenarioName => scenarioName !== 'strained');
    const strainSeen = Object.fromEntries(quietScenarioNames.map(scenarioName => {
        const values = firstReplayValues(scenarioName, BUSY_WALK_VALUES_CHECKED);
        const highestBand = Math.max(...['cpu', 'memory', 'io'].flatMap(resourceName =>
            pressureBandsOf(values, resourceName)));
        const mostDiskSwapBytes = Math.max(...values.map(tickValues => tickValues.diskSwapBytes));
        return [scenarioName, {highestBand, mostDiskSwapBytes}];
    }));
    // busy's cpu pressure is a quarter of a CPU figure of up to 90 %: the first band, never the second.
    assertEqual(strainSeen, {
        idle: {highestBand: 0, mostDiskSwapBytes: 0},
        light: {highestBand: 0, mostDiskSwapBytes: 0},
        busy: {highestBand: 1, mostDiskSwapBytes: 0},
    });
});

test('replay histories: GetState and each Sample carry the pressure histories, which the extension reads as ' +
    'published, in percent, the newest CARD_HISTORY_SAMPLES kept', () => {
    const generator = new ReplayGenerator('strained');
    const histories = new replayGeneratorModule.ReplayHistories(CARD_HISTORY_SAMPLES);
    const snapshotOf = ({cpuBusyPercent, usedMemoryBytes, pressureAvg10}) => ({
        cpuBusyPercent, memory: {usedBytes: usedMemoryBytes, totalBytes: 2 * usedMemoryBytes}, pressureAvg10,
    });
    const extraTickCount = 30;
    let appendedHistory = null;
    let lastSnapshot = null;
    for (let tickIndex = 0; tickIndex < CARD_HISTORY_SAMPLES + extraTickCount; tickIndex++) {
        lastSnapshot = snapshotOf(generator.nextValues());
        appendedHistory = histories.append(lastSnapshot);
    }
    const state = parseStatePayload(buildStatePayload({...STATE_PAYLOAD_REST, histories: histories.stateHistories()}));
    const sample = parseSamplePayload(buildSamplePayload({
        snapshot: null, appendedHistory, sequence: 1, sampledAtUsec: 1,
    }));
    const statePressure = state.histories.pressureAvg10;
    assertEqual({
        lengths: [state.histories.cpu.length, statePressure.cpu.length, statePressure.memory.length,
            statePressure.io.length],
        newestCpuPressure: statePressure.cpu.at(-1),
        appendedPressure: sample.appendedHistory.pressureAvg10,
        appendedMemory: sample.appendedHistory.memory,
    }, {
        lengths: [CARD_HISTORY_SAMPLES, CARD_HISTORY_SAMPLES, CARD_HISTORY_SAMPLES, CARD_HISTORY_SAMPLES],
        newestCpuPressure: lastSnapshot.pressureAvg10.cpu,
        appendedPressure: lastSnapshot.pressureAvg10,
        appendedMemory: 0.5,
    });
});

test('replay service: its histories are ReplayHistories, refilled at each scenario request and given to GetState ' +
    'whole, and its pressure and swap on disk come from the generator', () => {
    const serviceText = replayServiceTextOnOneLine();
    assertEqual({
        historiesPerScenario: countOf(serviceText,
            'this._histories = new ReplayHistories(this._constants.CARD_HISTORY_SAMPLES);'),
        appendedThroughThem: countOf(serviceText, 'const appendedHistory = this._histories.append(snapshot);'),
        stateHistories: countOf(serviceText, 'histories: this._histories.stateHistories(),'),
        valuesFromTheGenerator: countOf(serviceText,
            'const {cpuBusyPercent, usedMemoryBytes, pressureAvg10, diskSwapBytes} = this._generator.nextValues();'),
    }, {historiesPerScenario: 1, appendedThroughThem: 1, stateHistories: 1, valuesFromTheGenerator: 1});
});
