// lib/agentsTrack.js: the agents track's recorder. One slot per Sample, as the client's histories gain them (a
// Sample's gaps and its own, told by the client; a state's from the Samples' real time), grouped into cells from the
// newest as the pressure strips group theirs; each cell the most sessions working in it and whether a session blocked
// in it is blocked still.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as agentsTrack from '../extensions/resource-pulse@zvibaratz.github.io/lib/agentsTrack.js';
import {CARD_HISTORY_SAMPLES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

const SAMPLE_INTERVAL_USEC = 2_000_000;
const CELL_COUNT = 30;
const NO_CELL = {workingCount: null, capState: 'none'};
/** A Sample's real time (sampledAtUsec): the wall clock, which counts a suspend as the sampler's gaps do. */
const FIRST_SAMPLE_AT_USEC = 1_794_000_000_000_000;
const LOCK_OF_90_SECONDS_USEC = 90_000_000;
const LOCK_OF_10_MINUTES_USEC = 600_000_000;
/** A suspend of a minute: the sampler says it missed thirty ticks. */
const SUSPENDED_INTERVAL_COUNT = 30;
/** What the client's histories did at a no-data: one gap. */
const NO_DATA_CHANGE = {kind: 'no-data', appendedSlotCount: 1, sampledAtUsec: null};

/**
 * What the client's histories did at a Sample that appended: so many slots, its gaps and its own.
 *
 * @param {number|null} sampledAtUsec - The Sample's real time.
 * @param {number} [appendedSlotCount] - Slots the histories gained: 1 for a Sample on time.
 * @returns {{kind: string, appendedSlotCount: number, sampledAtUsec: number|null}} The change.
 */
function sampleChange(sampledAtUsec, appendedSlotCount = 1) {
    return {kind: 'sample', appendedSlotCount, sampledAtUsec};
}

/**
 * What the client's histories did at a state: replaced, its latest Sample at that real time.
 *
 * @param {number|null} sampledAtUsec - The state's latestSampledAtUsec.
 * @param {string} [kind] - 'state', or 'stale-state' for one whose snapshot was already stale.
 * @returns {{kind: string, appendedSlotCount: null, sampledAtUsec: number|null}} The change.
 */
function stateChange(sampledAtUsec, kind = 'state') {
    return {kind, appendedSlotCount: null, sampledAtUsec};
}

/**
 * A reading of the sessions source: so many working, these blocked.
 *
 * @param {number|null} workingCount - Sessions working; null while not known.
 * @param {string[]} [blockedSessionKeys] - The blocked sessions' keys.
 * @returns {{workingCount: number|null, blockedSessionKeys: string[]}} The reading.
 */
function reading(workingCount, blockedSessionKeys = []) {
    return {workingCount, blockedSessionKeys};
}

/**
 * Thirty cells, empty but for the ones given.
 *
 * @param {Object<number, {workingCount: number|null, capState: string}>} cellsByIndex - Cells by index, oldest 0.
 * @returns {Array<{workingCount: number|null, capState: string}>} The cells.
 */
function cellsWith(cellsByIndex) {
    return Array.from({length: CELL_COUNT}, (_unused, cellIndex) => cellsByIndex[cellIndex] ?? NO_CELL);
}

/**
 * Records one Sample per reading, two seconds apart from FIRST_SAMPLE_AT_USEC, each followed by its reading, which
 * counts in that Sample's slot (a slot runs from its Sample to the next).
 *
 * @param {object} recorder - An AgentsTrackRecorder.
 * @param {number[]} workingCounts - One count per Sample.
 * @returns {number} The last Sample's time.
 */
function recordSamplesWithCounts(recorder, workingCounts) {
    let takenAtUsec = FIRST_SAMPLE_AT_USEC;
    workingCounts.forEach((workingCount, sampleIndex) => {
        takenAtUsec = FIRST_SAMPLE_AT_USEC + sampleIndex * SAMPLE_INTERVAL_USEC;
        recorder.recordHistoryChange(sampleChange(takenAtUsec));
        recorder.recordSessions(reading(workingCount));
    });
    return takenAtUsec;
}

test('agentsTrack: thirty cells of five Samples each, over the card\'s 150; a new recorder\'s are all empty', () =>
    assertEqual({
        cellCount: agentsTrack.AGENTS_TRACK_CELL_COUNT,
        samplesPerCell: agentsTrack.AGENTS_TRACK_SAMPLES_PER_CELL,
        coversThePlot: agentsTrack.AGENTS_TRACK_CELL_COUNT * agentsTrack.AGENTS_TRACK_SAMPLES_PER_CELL,
        cells: new agentsTrack.AgentsTrackRecorder().cells(),
    }, {cellCount: CELL_COUNT, samplesPerCell: 5, coversThePlot: CARD_HISTORY_SAMPLES, cells: cellsWith({})}));

test('agentsTrack: five Samples a cell, grouped from the newest as the strips group theirs, each cell the most ' +
    'working in it; a history shorter than the strip is empty on its left', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recordSamplesWithCounts(recorder, [1, 2, 3, 4, 5, 6, 7]);
    assertEqual(recorder.cells(), cellsWith({
        28: {workingCount: 2, capState: 'none'}, 29: {workingCount: 7, capState: 'none'},
    }));
});

test('agentsTrack: a reading between two Samples counts in the newest slot, which keeps the most it was told and ' +
    'every session blocked in it, even one blocked only between two Samples', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recorder.recordSessions(reading(1));
    recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC));
    recorder.recordSessions(reading(4, ['pane-a']));
    recorder.recordSessions(reading(0));
    assertEqual(recorder.cells()[CELL_COUNT - 1], {workingCount: 4, capState: 'ended'});
});

test('agentsTrack: a cell\'s count is the most of its five slots, not its last', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recordSamplesWithCounts(recorder, [5, 1, 1, 1, 1]);
    assertEqual(recorder.cells()[CELL_COUNT - 1], {workingCount: 5, capState: 'none'});
});

test('agentsTrack: a Sample appends the slots the client\'s histories gained at it, its gaps and its own: a suspend ' +
    'of thirty intervals while enabled is thirty empty slots, then its own, so the cells stand under the strips\' ' +
    'moments', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    const lastBeforeSuspendUsec = recordSamplesWithCounts(recorder, [3, 3, 3, 3, 3]);
    const suspendedSlotCount = SUSPENDED_INTERVAL_COUNT + 1;
    recorder.recordHistoryChange(sampleChange(lastBeforeSuspendUsec + suspendedSlotCount * SAMPLE_INTERVAL_USEC,
        suspendedSlotCount));
    recorder.recordSessions(reading(4));
    // Thirty-six slots: five of 3, thirty empty, then 4.
    assertEqual({slotCount: recorder.slotCount, cells: recorder.cells()}, {
        slotCount: 36,
        cells: cellsWith({
            22: {workingCount: 3, capState: 'none'}, 23: {workingCount: 3, capState: 'none'},
            29: {workingCount: 4, capState: 'none'},
        }),
    });
});

test('agentsTrack: a Sample appends what the histories gained whatever its time says: a tick a second late and ' +
    'the next on time are a slot each', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    const sampleTimesUsec = [0, 3_000_000, 4_000_000, 6_000_000].map(offsetUsec => FIRST_SAMPLE_AT_USEC + offsetUsec);
    sampleTimesUsec.forEach(sampledAtUsec => recorder.recordHistoryChange(sampleChange(sampledAtUsec)));
    assertEqual(recorder.slotCount, sampleTimesUsec.length);
});

test('agentsTrack: a suspend longer than the track pushes every kept slot out, told live or across a disable', () => {
    const slotsAfter = holdsAcrossDisable => {
        const recorder = new agentsTrack.AgentsTrackRecorder();
        const lastBeforeSuspendUsec = recordSamplesWithCounts(recorder, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
        const resumedAtUsec = lastBeforeSuspendUsec + LOCK_OF_10_MINUTES_USEC;
        if (holdsAcrossDisable) {
            recorder.holdAcrossDisable();
            recorder.recordHistoryChange(stateChange(resumedAtUsec));
        } else {
            recorder.recordHistoryChange(sampleChange(resumedAtUsec, CARD_HISTORY_SAMPLES + 1));
        }
        recorder.recordSessions(reading(5));
        return {slotCount: recorder.slotCount, cells: recorder.cells()};
    };
    const trackFromItsRight = {slotCount: CARD_HISTORY_SAMPLES, cells: cellsWith({29: {workingCount: 5, capState: 'none'}})};
    assertEqual({live: slotsAfter(false), acrossDisable: slotsAfter(true)},
        {live: trackFromItsRight, acrossDisable: trackFromItsRight});
});

test('agentsTrack: stateAppendedSlotCount: the slots a state\'s histories gained over what was held, from the ' +
    'Samples\' real time, less the no-data slots already appended; none for a state told again; every slot where ' +
    'the time between is not known', () => {
    const lastAtUsec = FIRST_SAMPLE_AT_USEC;
    const slotsAt = (elapsedUsec, untimedSlotCount = 0, lastSampledAtUsec = lastAtUsec) =>
        agentsTrack.stateAppendedSlotCount({
            lastSampledAtUsec, sampledAtUsec: lastAtUsec + elapsedUsec, untimedSlotCount,
        });
    assertEqual({
        noneHeld: slotsAt(0, 0, null),
        timeUnknown: agentsTrack.stateAppendedSlotCount({lastSampledAtUsec: lastAtUsec, sampledAtUsec: null,
            untimedSlotCount: 0}),
        toldAgain: slotsAt(0),
        next: slotsAt(SAMPLE_INTERVAL_USEC),
        early: slotsAt(1_900_000),
        late: slotsAt(2_900_000),
        twoMissed: slotsAt(3 * SAMPLE_INTERVAL_USEC),
        afterTwoNoDataSlots: slotsAt(5 * SAMPLE_INTERVAL_USEC, 2),
        moreNoDataSlotsThanTicks: slotsAt(2 * SAMPLE_INTERVAL_USEC, 3),
        longerThanThePlot: slotsAt(LOCK_OF_10_MINUTES_USEC),
        clockSetBack: slotsAt(-SAMPLE_INTERVAL_USEC),
    }, {
        noneHeld: CARD_HISTORY_SAMPLES, timeUnknown: CARD_HISTORY_SAMPLES, toldAgain: 0, next: 1, early: 1, late: 1,
        twoMissed: 3, afterTwoNoDataSlots: 3, moreNoDataSlotsThanTicks: 1, longerThanThePlot: CARD_HISTORY_SAMPLES,
        clockSetBack: CARD_HISTORY_SAMPLES,
    });
});

test('agentsTrack: a no-data appends an empty slot; the next Sample the gaps the client pushed less its own, and a ' +
    'state the rest of the silence by time; either way the cells stand under the strips\' moments, and no reading ' +
    'counts in an empty slot', () => {
    const cellsAfterSilence = closingChange => {
        const recorder = new agentsTrack.AgentsTrackRecorder();
        recorder.recordSessions(reading(3));
        recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC));
        recorder.recordHistoryChange(NO_DATA_CHANGE);
        recorder.recordSessions(reading(9));
        recorder.recordHistoryChange(closingChange);
        return recorder.cells();
    };
    const afterEightIntervalsUsec = FIRST_SAMPLE_AT_USEC + 8 * SAMPLE_INTERVAL_USEC;
    // Nine slots: 3, seven empty (one no-data, six with the closing change), then 9: cells of [3, -, -, -] and
    // [-, -, -, -, 9].
    const silenceAsEmptySlots = cellsWith({28: {workingCount: 3, capState: 'none'}, 29: {workingCount: 9, capState: 'none'}});
    assertEqual({
        sample: cellsAfterSilence(sampleChange(afterEightIntervalsUsec, 7)),
        state: cellsAfterSilence(stateChange(afterEightIntervalsUsec)),
    }, {sample: silenceAsEmptySlots, state: silenceAsEmptySlots});
});

test('agentsTrack: a state starts the count of no-data slots again: a silence that ends, then a later one, each ' +
    'counts only its own', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC));
    recorder.recordHistoryChange(NO_DATA_CHANGE);
    recorder.recordHistoryChange(stateChange(FIRST_SAMPLE_AT_USEC + 2 * SAMPLE_INTERVAL_USEC));
    recorder.recordHistoryChange(NO_DATA_CHANGE);
    recorder.recordHistoryChange(stateChange(FIRST_SAMPLE_AT_USEC + 6 * SAMPLE_INTERVAL_USEC));
    // Seven slots, one for each of the six intervals and the first: the first, a no-data, the state's own, a no-data,
    // two empty, the second state's own.
    assertEqual(recorder.slotCount, 7);
});

test('agentsTrack: a state already stale appends its time as empty slots, then the no-data that follows it', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recordSamplesWithCounts(recorder, [3]);
    recorder.recordHistoryChange(stateChange(FIRST_SAMPLE_AT_USEC + 4 * SAMPLE_INTERVAL_USEC, 'stale-state'));
    recorder.recordSessions(reading(6));
    // Six slots: 3, four empty to the state's time (its own among them, since it is stale), then the no-data.
    assertEqual({slotCount: recorder.slotCount, cells: recorder.cells()},
        {slotCount: 6, cells: cellsWith({28: {workingCount: 3, capState: 'none'}})});
});

test('agentsTrack: a change that cannot be read appends nothing', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    [null, undefined, {}, {kind: 'reveal'}].forEach(change => recorder.recordHistoryChange(change));
    assertEqual(recorder.slotCount, 0);
});

test('agentsTrack: a cell\'s cap is ongoing while a session blocked in it is blocked now, ended once none is (a ' +
    'session gone while blocked has ended its wait), and none where no session was blocked', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    const samplesPerCell = 5;
    const cellCounts = [1, 2, 3, 4];
    // pane-a blocked at the first Sample, then gone; pane-d at the eleventh only, then gone; pane-c from the twelfth
    // on, still now: the third cell holds a slot whose wait ended and slots whose wait goes on.
    const blockedAt = sampleIndex => {
        if (sampleIndex === 0)
            return ['pane-a'];
        if (sampleIndex === 2 * samplesPerCell)
            return ['pane-d'];
        return sampleIndex > 2 * samplesPerCell ? ['pane-c'] : [];
    };
    cellCounts.flatMap(workingCount => Array(samplesPerCell).fill(workingCount)).forEach((workingCount, sampleIndex) => {
        recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC + sampleIndex * SAMPLE_INTERVAL_USEC));
        recorder.recordSessions(reading(workingCount, blockedAt(sampleIndex)));
    });
    assertEqual(recorder.cells().slice(-4), [
        {workingCount: 1, capState: 'ended'}, {workingCount: 2, capState: 'none'},
        {workingCount: 3, capState: 'ongoing'}, {workingCount: 4, capState: 'ongoing'},
    ]);
});

test('agentsTrack: keptAcrossDisable keeps the session keys by default; the other way keeps each slot\'s cap as ' +
    'it stood at the disable, and no key', () => {
    const slot = {workingCount: 2, blockedSessionKeys: new Set(['pane-a', 'pane-b'])};
    const blockedNow = new Set(['pane-b']);
    const keysKept = agentsTrack.slotKeptAcrossDisable(slot, blockedNow, agentsTrack.KeptAcrossDisable.SESSION_KEYS);
    const capKept = agentsTrack.slotKeptAcrossDisable(slot, blockedNow, agentsTrack.KeptAcrossDisable.CAP_STATE);
    assertEqual({
        defaultWay: agentsTrack.AGENTS_TRACK_KEPT_ACROSS_DISABLE,
        keysKept: {workingCount: keysKept.workingCount, keys: [...keysKept.blockedSessionKeys].sort(),
            keptCapState: keysKept.keptCapState ?? null},
        capKept: {workingCount: capKept.workingCount, keys: [...capKept.blockedSessionKeys],
            keptCapState: capKept.keptCapState},
    }, {
        defaultWay: 'session-keys',
        keysKept: {workingCount: 2, keys: ['pane-a', 'pane-b'], keptCapState: null},
        capKept: {workingCount: 2, keys: [], keptCapState: 'ongoing'},
    });
});

test('agentsTrack: after a disable a cell kept with its keys says truly whether its wait goes on; kept with its cap ' +
    'only, it says what it said at the disable; a reading after the disable never counts in a slot before it', () => {
    const capsAfterUnlock = keptAcrossDisable => {
        const recorder = new agentsTrack.AgentsTrackRecorder({keptAcrossDisable});
        recorder.recordSessions(reading(1, ['pane-a']));
        recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC));
        recorder.holdAcrossDisable();
        // A higher count than the kept slot's, so a slot left open would show it.
        recorder.recordSessions(reading(3));
        recorder.recordHistoryChange(stateChange(FIRST_SAMPLE_AT_USEC + 8 * SAMPLE_INTERVAL_USEC));
        // Nine slots: the one before the disable, seven empty, then the first after it.
        return recorder.cells().slice(-2);
    };
    assertEqual({
        sessionKeys: capsAfterUnlock(agentsTrack.KeptAcrossDisable.SESSION_KEYS),
        capState: capsAfterUnlock(agentsTrack.KeptAcrossDisable.CAP_STATE),
    }, {
        sessionKeys: [{workingCount: 1, capState: 'ended'}, {workingCount: 3, capState: 'none'}],
        capState: [{workingCount: 1, capState: 'ongoing'}, {workingCount: 3, capState: 'none'}],
    });
});

test('agentsTrack: across a 90 s lock the cells are kept and the lock is empty cells, counted from the Samples\' ' +
    'real time, which counts a suspend in the lock as the histories do; until the first reading after it, the newest ' +
    'slot counts nothing', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    const lastBeforeLockUsec = recordSamplesWithCounts(recorder, [3, 3, 3, 3, 3]);
    recorder.holdAcrossDisable();
    recorder.recordHistoryChange(stateChange(lastBeforeLockUsec + LOCK_OF_90_SECONDS_USEC));
    const beforeReading = recorder.cells()[CELL_COUNT - 1];
    recorder.recordSessions(reading(2));
    // Fifty slots: five of 3, forty-four empty, then the first after the lock.
    assertEqual({beforeReading, cells: recorder.cells()}, {
        beforeReading: NO_CELL,
        cells: cellsWith({20: {workingCount: 3, capState: 'none'}, 29: {workingCount: 2, capState: 'none'}}),
    });
});

test('agentsTrack: the recorder holds no more slots than the plot has Samples', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recordSamplesWithCounts(recorder, Array.from({length: CARD_HISTORY_SAMPLES + 12}, (_unused, index) => index));
    assertEqual({slotCount: recorder.slotCount, oldest: recorder.cells()[0].workingCount},
        {slotCount: CARD_HISTORY_SAMPLES, oldest: 16});
});

test('agentsTrack: sessionsReading: the rows working and the keys of those blocked; herdr not running counts 0; no ' +
    'source is no reading; a state it does not know counts as neither', () => {
    const rows = [
        {id: 'a', state: 'working'}, {id: 'b', state: 'blocked'}, {id: 'c', state: 'working'},
        {id: 'd', state: 'idle'}, {id: 'e', state: 'thinking'}, {id: 'f', state: 'blocked'},
    ];
    assertEqual({
        rows: agentsTrack.sessionsReading({herdrRunning: true, rows}),
        herdrNotRunning: agentsTrack.sessionsReading({herdrRunning: false, rows: []}),
        noSource: agentsTrack.sessionsReading(null),
    }, {
        rows: {workingCount: 2, blockedSessionKeys: ['b', 'f']},
        herdrNotRunning: {workingCount: 0, blockedSessionKeys: []},
        noSource: null,
    });
});

test('agentsTrack: areAgentsCellsEqual: the same counts and caps cell for cell', () => {
    const cells = cellsWith({29: {workingCount: 2, capState: 'ongoing'}});
    const capEnded = cellsWith({29: {workingCount: 2, capState: 'ended'}});
    const countMoved = cellsWith({29: {workingCount: 3, capState: 'ongoing'}});
    assertEqual([
        agentsTrack.areAgentsCellsEqual(cells, cellsWith({29: {workingCount: 2, capState: 'ongoing'}})),
        agentsTrack.areAgentsCellsEqual(cells, capEnded),
        agentsTrack.areAgentsCellsEqual(cells, countMoved),
        agentsTrack.areAgentsCellsEqual(cells, cells.slice(1)),
    ], [true, false, false, false]);
});

test('agentsTrack: cockpitSessionsSource: the sessions source only while the cockpit client is live and the source ' +
    'is not stale; otherwise none', () => {
    const sessionsSource = {herdrRunning: true, rows: []};
    const sourceWhen = (clientState, isStale, source = sessionsSource) =>
        agentsTrack.cockpitSessionsSource({clientState, sessionsSource: source, isStale});
    assertEqual([
        sourceWhen('live', false), sourceWhen('live', true), sourceWhen('vanished', false), sourceWhen('starting', false),
        sourceWhen('skipped', false), sourceWhen('live', false, null),
    ], [sessionsSource, null, null, null, null, null]);
});

test('agentsTrack: presentWorkingCount: the sessions working, for the present; none while herdr is not running or ' +
    'there is no source, though the cells count 0 then', () =>
    assertEqual([
        agentsTrack.presentWorkingCount({herdrRunning: true, rows: [{id: 'a', state: 'working'}, {id: 'b', state: 'idle'}]}),
        agentsTrack.presentWorkingCount({herdrRunning: true, rows: []}),
        agentsTrack.presentWorkingCount({herdrRunning: false, rows: []}),
        agentsTrack.presentWorkingCount(null),
    ], [1, 0, null, null]));
