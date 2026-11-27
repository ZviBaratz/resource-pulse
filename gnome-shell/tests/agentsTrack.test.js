// lib/agentsTrack.js: the agents track's recorder. One slot per Sample, as the client's histories gain them, grouped
// into cells from the newest as the pressure strips group theirs; each cell the most sessions working in it and whether
// a session blocked in it is blocked still.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as agentsTrack from '../extensions/resource-pulse@zvibaratz.github.io/lib/agentsTrack.js';
import {CARD_HISTORY_SAMPLES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

const SAMPLE_INTERVAL_USEC = 2_000_000;
const CELL_COUNT = 30;
const NO_CELL = {workingCount: null, capState: 'none'};
const FIRST_SAMPLE_AT_USEC = 1_000_000_000;
const LOCK_OF_90_SECONDS_USEC = 90_000_000;
const LOCK_OF_10_MINUTES_USEC = 600_000_000;

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
        recorder.recordSample(takenAtUsec);
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
    recorder.recordSample(FIRST_SAMPLE_AT_USEC);
    recorder.recordSessions(reading(4, ['pane-a']));
    recorder.recordSessions(reading(0));
    assertEqual(recorder.cells()[CELL_COUNT - 1], {workingCount: 4, capState: 'ended'});
});

test('agentsTrack: appendedSlotCount: the slots the client\'s histories gained at a Sample, from its time against ' +
    'the last timed Sample\'s, less the no-data slots already appended; none for a Sample told again', () => {
    const lastAtUsec = FIRST_SAMPLE_AT_USEC;
    const slotsAt = (elapsedUsec, untimedSlotCount = 0, lastTimedSampleAtUsec = lastAtUsec) =>
        agentsTrack.appendedSlotCount({
            lastTimedSampleAtUsec, takenAtUsec: lastAtUsec + elapsedUsec, untimedSlotCount,
        });
    assertEqual({
        first: slotsAt(0, 0, null),
        toldAgain: slotsAt(0),
        next: slotsAt(SAMPLE_INTERVAL_USEC),
        early: slotsAt(1_900_000),
        late: slotsAt(2_900_000),
        twoMissed: slotsAt(3 * SAMPLE_INTERVAL_USEC),
        afterTwoNoDataSlots: slotsAt(5 * SAMPLE_INTERVAL_USEC, 2),
        moreNoDataSlotsThanTicks: slotsAt(2 * SAMPLE_INTERVAL_USEC, 3),
        longerThanThePlot: slotsAt(LOCK_OF_10_MINUTES_USEC),
        backwards: slotsAt(-SAMPLE_INTERVAL_USEC),
    }, {
        first: 1, toldAgain: 0, next: 1, early: 1, late: 1, twoMissed: 3, afterTwoNoDataSlots: 3, moreNoDataSlotsThanTicks: 1,
        longerThanThePlot: CARD_HISTORY_SAMPLES, backwards: 1,
    });
});

test('agentsTrack: a no-data Sample appends an empty slot, and the next timed one the rest of the silence as empty ' +
    'slots before its own, so the cells stand under the strips\' moments; no reading counts in an empty slot', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recorder.recordSessions(reading(3));
    recorder.recordSample(FIRST_SAMPLE_AT_USEC);
    recorder.recordSample(null);
    recorder.recordSessions(reading(9));
    recorder.recordSample(FIRST_SAMPLE_AT_USEC + 8 * SAMPLE_INTERVAL_USEC);
    // Nine slots: 3, seven empty (one no-data, six at the Sample), then 9: cells of [3, -, -, -] and [-, -, -, -, 9].
    assertEqual(recorder.cells(), cellsWith({
        28: {workingCount: 3, capState: 'none'}, 29: {workingCount: 9, capState: 'none'},
    }));
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
        recorder.recordSample(FIRST_SAMPLE_AT_USEC + sampleIndex * SAMPLE_INTERVAL_USEC);
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
        recorder.recordSample(FIRST_SAMPLE_AT_USEC);
        recorder.holdAcrossDisable();
        recorder.recordSessions(reading(1));
        recorder.recordSample(FIRST_SAMPLE_AT_USEC + 8 * SAMPLE_INTERVAL_USEC);
        // Nine slots: the one before the disable, seven empty, then the first after it.
        return recorder.cells().slice(-2);
    };
    assertEqual({
        sessionKeys: capsAfterUnlock(agentsTrack.KeptAcrossDisable.SESSION_KEYS),
        capState: capsAfterUnlock(agentsTrack.KeptAcrossDisable.CAP_STATE),
    }, {
        sessionKeys: [{workingCount: 1, capState: 'ended'}, {workingCount: 1, capState: 'none'}],
        capState: [{workingCount: 1, capState: 'ongoing'}, {workingCount: 1, capState: 'none'}],
    });
});

test('agentsTrack: across a 90 s lock the cells are kept and the lock is empty cells, counted from the Samples\' ' +
    'own times; until the first reading after it, the newest slot counts nothing', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    const lastBeforeLockUsec = recordSamplesWithCounts(recorder, [3, 3, 3, 3, 3]);
    recorder.holdAcrossDisable();
    recorder.recordSample(lastBeforeLockUsec + LOCK_OF_90_SECONDS_USEC);
    const beforeReading = recorder.cells()[CELL_COUNT - 1];
    recorder.recordSessions(reading(2));
    // Fifty slots: five of 3, forty-four empty, then the first after the lock.
    assertEqual({beforeReading, cells: recorder.cells()}, {
        beforeReading: NO_CELL,
        cells: cellsWith({20: {workingCount: 3, capState: 'none'}, 29: {workingCount: 2, capState: 'none'}}),
    });
});

test('agentsTrack: a lock of five minutes or more pushes every kept slot out: the strip fills again from its right', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    const lastBeforeLockUsec = recordSamplesWithCounts(recorder, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    recorder.holdAcrossDisable();
    recorder.recordSessions(reading(1));
    recorder.recordSample(lastBeforeLockUsec + LOCK_OF_10_MINUTES_USEC);
    assertEqual(recorder.cells(), cellsWith({29: {workingCount: 1, capState: 'none'}}));
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
