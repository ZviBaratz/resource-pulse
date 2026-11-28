// lib/agentsTrack.js: the agents track's recorder. One slot per Sample, as the client's histories gain them (a
// Sample's gaps and its own, told by the client; a state's from the Samples' real time, counted as the sampler counts
// a suspend), grouped into cells from the newest as the pressure strips group theirs; each cell the most sessions
// working in it and whether a session blocked in it is blocked still.
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
const ONE_SECOND_USEC = 1_000_000;
/** A suspend while enabled whose remainder the sampler carries: 61.5 s, thirty whole intervals and 1.5 s. */
const LIVE_SUSPEND_USEC = 61_500_000;
/** A suspend across a later lock: 60.6 s, thirty whole intervals and 0.6 s, so 31 with the 1.5 s carried. */
const LOCKED_SUSPEND_USEC = 60_600_000;
const LOCK_OF_10_MINUTES_USEC = 600_000_000;
/** A suspend of a minute: the sampler says it missed thirty ticks. */
const SUSPENDED_INTERVAL_COUNT = 30;
/** What the client's histories did at a no-data: one gap. */
const NO_DATA_CHANGE = {kind: 'no-data', appendedSlotCount: 1, sampledIntervalCount: null, sampledAtUsec: null};

/**
 * What the client's histories did at a Sample that appended: so many slots, its gaps and its own.
 *
 * @param {number|null} sampledAtUsec - The Sample's real time.
 * @param {number} [appendedSlotCount] - Slots the histories gained: 1 for a Sample on time.
 * @param {number|null} [sampledIntervalCount] - The sampler's intervals since its previous Sample, its own included:
 *     the slots gained by default.
 * @returns {{kind: string, appendedSlotCount: number, sampledIntervalCount: number|null, sampledAtUsec: number|null}}
 *     The change.
 */
function sampleChange(sampledAtUsec, appendedSlotCount = 1, sampledIntervalCount = appendedSlotCount) {
    return {kind: 'sample', appendedSlotCount, sampledIntervalCount, sampledAtUsec};
}

/**
 * What the client's histories did at a state: replaced, its latest Sample at that real time.
 *
 * @param {number|null} sampledAtUsec - The state's latestSampledAtUsec.
 * @param {string} [kind] - 'state', or 'stale-state' for one whose snapshot was already stale.
 * @returns {{kind: string, appendedSlotCount: null, sampledIntervalCount: null, sampledAtUsec: number|null}} The change.
 */
function stateChange(sampledAtUsec, kind = 'state') {
    return {kind, appendedSlotCount: null, sampledIntervalCount: null, sampledAtUsec};
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
 * The slots each of two locks gains, one after the other, each with a suspend of 61 s between its three ticks before
 * and its three after: the first leaves 1 s for the second to carry.
 *
 * @returns {number[]} The slots gained across each lock.
 */
function slotsGainedAcrossTwoLocks() {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    let lastSampledAtUsec = recordSamplesWithCounts(recorder, [3]);
    return [0, 1].map(() => {
        const slotCountBeforeLock = recorder.slotCount;
        recorder.holdAcrossDisable();
        lastSampledAtUsec += 6 * SAMPLE_INTERVAL_USEC + 61 * ONE_SECOND_USEC;
        recorder.recordHistoryChange(stateChange(lastSampledAtUsec));
        return recorder.slotCount - slotCountBeforeLock;
    });
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

test('agentsTrack: stateIntervalCount: the sampler\'s intervals between the last Sample told and a state\'s latest, ' +
    'counted from their real times as the sampler counts a suspend: whole intervals, floored, with the remainder ' +
    'carried; unknown where the time between is not known', () => {
    const lastAtUsec = FIRST_SAMPLE_AT_USEC;
    const countAt = (elapsedUsec, carriedUsec = 0, lastSampledAtUsec = lastAtUsec) =>
        agentsTrack.stateIntervalCount({lastSampledAtUsec, sampledAtUsec: lastAtUsec + elapsedUsec, carriedUsec});
    const sixIntervalsUsec = 6 * SAMPLE_INTERVAL_USEC;
    assertEqual({
        noneHeld: countAt(0, 0, null),
        timeUnknown: agentsTrack.stateIntervalCount({lastSampledAtUsec: lastAtUsec, sampledAtUsec: null, carriedUsec: 0}),
        clockSetBack: countAt(-SAMPLE_INTERVAL_USEC),
        toldAgain: countAt(0, ONE_SECOND_USEC),
        next: countAt(SAMPLE_INTERVAL_USEC),
        earlierInItsSlot: countAt(1_950_000),
        late: countAt(2_900_000),
        evenSuspend: countAt(sixIntervalsUsec + 60 * ONE_SECOND_USEC),
        oddSuspend: countAt(sixIntervalsUsec + 61 * ONE_SECOND_USEC),
        oddSuspendAfterACarry: countAt(sixIntervalsUsec + 61 * ONE_SECOND_USEC, ONE_SECOND_USEC),
        wallClockSlow: countAt(sixIntervalsUsec + 60 * ONE_SECOND_USEC - 50_000),
        longerThanThePlot: countAt(LOCK_OF_10_MINUTES_USEC),
    }, {
        noneHeld: {intervalCount: null, carriedUsec: 0}, timeUnknown: {intervalCount: null, carriedUsec: 0},
        clockSetBack: {intervalCount: null, carriedUsec: 0}, toldAgain: {intervalCount: 0, carriedUsec: ONE_SECOND_USEC},
        next: {intervalCount: 1, carriedUsec: 0}, earlierInItsSlot: {intervalCount: 1, carriedUsec: 0},
        late: {intervalCount: 1, carriedUsec: 900_000}, evenSuspend: {intervalCount: 36, carriedUsec: 0},
        oddSuspend: {intervalCount: 36, carriedUsec: ONE_SECOND_USEC},
        oddSuspendAfterACarry: {intervalCount: 37, carriedUsec: 0}, wallClockSlow: {intervalCount: 36, carriedUsec: 0},
        longerThanThePlot: {intervalCount: 300, carriedUsec: 0},
    });
});

test('agentsTrack: carriedAfterSample: the remainder a Sample leaves, from the time since the last and the ' +
    'intervals the sampler counted; none where either is not known, never under 0 or a whole interval', () => {
    const carriedAt = (elapsedUsec, intervalCount, carriedUsec = 0, lastSampledAtUsec = FIRST_SAMPLE_AT_USEC) =>
        agentsTrack.carriedAfterSample({
            lastSampledAtUsec, sampledAtUsec: FIRST_SAMPLE_AT_USEC + elapsedUsec, carriedUsec, intervalCount,
        });
    const liveOddSuspendUsec = SAMPLE_INTERVAL_USEC + 61 * ONE_SECOND_USEC;
    assertEqual({
        onTime: carriedAt(SAMPLE_INTERVAL_USEC, 1),
        oddSuspend: carriedAt(liveOddSuspendUsec, 31),
        oddSuspendAfterACarry: carriedAt(liveOddSuspendUsec, 32, ONE_SECOND_USEC),
        earlierThanCounted: carriedAt(SAMPLE_INTERVAL_USEC - 1, 1),
        moreThanAnInterval: carriedAt(3 * SAMPLE_INTERVAL_USEC, 1),
        noneHeld: carriedAt(SAMPLE_INTERVAL_USEC, 1, ONE_SECOND_USEC, null),
        countUnknown: carriedAt(SAMPLE_INTERVAL_USEC, null, ONE_SECOND_USEC),
    }, {
        onTime: 0, oddSuspend: ONE_SECOND_USEC, oddSuspendAfterACarry: 0, earlierThanCounted: 0,
        moreThanAnInterval: SAMPLE_INTERVAL_USEC - 1, noneHeld: 0, countUnknown: 0,
    });
});

test('agentsTrack: across a lock with a suspend in it, between ticks, the slots stand where the histories\' do: the ' +
    'sampler\'s whole intervals of 59, 60, 61, 62 and 63 s, not rounded', () => {
    const slotsAfterLock = suspendSeconds => {
        const recorder = new agentsTrack.AgentsTrackRecorder();
        const lastBeforeLockUsec = recordSamplesWithCounts(recorder, [3, 3, 3, 3, 3]);
        recorder.holdAcrossDisable();
        // Three ticks, the suspend, three ticks: the state's latest Sample.
        const stateAtUsec = lastBeforeLockUsec + 6 * SAMPLE_INTERVAL_USEC + suspendSeconds * ONE_SECOND_USEC;
        recorder.recordHistoryChange(stateChange(stateAtUsec));
        return recorder.slotCount;
    };
    // Five kept, then the six ticks and the suspend's whole intervals, floored: 29, 30, 30, 31, 31.
    assertEqual([59, 60, 61, 62, 63].map(slotsAfterLock), [40, 41, 41, 42, 42]);
});

test('agentsTrack: a suspend\'s remainder is carried to a suspend across a later lock, as the sampler carries it: ' +
    '61.5 s live leaves 1.5 s, so 60.6 s across the lock is 31 intervals, where rounded it would be 30; and 61 s ' +
    'across one lock leaves 1 s, so 61 s across the next is 31', () => {
    assertEqual(slotsGainedAcrossTwoLocks(), [36, 37]);
    const recorder = new agentsTrack.AgentsTrackRecorder();
    const lastBeforeSuspendUsec = recordSamplesWithCounts(recorder, [3]);
    const resumedAtUsec = lastBeforeSuspendUsec + SAMPLE_INTERVAL_USEC + LIVE_SUSPEND_USEC;
    // The sampler's thirty whole intervals of the suspend and its own: 1.5 s left over.
    recorder.recordHistoryChange(sampleChange(resumedAtUsec, 31, 31));
    recorder.holdAcrossDisable();
    const slotCountBeforeLock = recorder.slotCount;
    recorder.recordHistoryChange(stateChange(resumedAtUsec + 6 * SAMPLE_INTERVAL_USEC + LOCKED_SUSPEND_USEC));
    // The 1.5 s carried and the lock's 60.6 s: 31 whole intervals, and the six ticks.
    assertEqual({slotCountBeforeLock, gained: recorder.slotCount - slotCountBeforeLock},
        {slotCountBeforeLock: 32, gained: 37});
});

test('agentsTrack: a state takes back the no-data slots since the last Sample, which its histories do not hold, ' +
    'and appends what they do: a stale state after a stall across a lock, a Sample told twice, more no-data slots ' +
    'than intervals', () => {
    const slotCountAfter = (noDataCount, closingChange) => {
        const recorder = new agentsTrack.AgentsTrackRecorder();
        recordSamplesWithCounts(recorder, [3, 3, 3, 3, 3]);
        for (let noDataIndex = 0; noDataIndex < noDataCount; noDataIndex++)
            recorder.recordHistoryChange(NO_DATA_CHANGE);
        recorder.holdAcrossDisable();
        recorder.recordHistoryChange(closingChange);
        return recorder.slotCount;
    };
    const lastSampleAtUsec = FIRST_SAMPLE_AT_USEC + 4 * SAMPLE_INTERVAL_USEC;
    const slotCountAfterNoDataThenSample = () => {
        const recorder = new agentsTrack.AgentsTrackRecorder();
        recordSamplesWithCounts(recorder, [3, 3, 3, 3, 3]);
        recorder.recordHistoryChange(NO_DATA_CHANGE);
        const sampleAtUsec = lastSampleAtUsec + 2 * SAMPLE_INTERVAL_USEC;
        recorder.recordHistoryChange(sampleChange(sampleAtUsec, 1, 2));
        recorder.recordHistoryChange(stateChange(sampleAtUsec + 2 * SAMPLE_INTERVAL_USEC));
        return recorder.slotCount;
    };
    assertEqual({
        staleStateAfterAStall: slotCountAfter(1, stateChange(lastSampleAtUsec, 'stale-state')),
        sampleToldTwice: slotCountAfter(1, stateChange(lastSampleAtUsec)),
        moreNoDataSlotsThanIntervals: slotCountAfter(3, stateChange(lastSampleAtUsec + 2 * SAMPLE_INTERVAL_USEC)),
        // A no-data, then a Sample (the client's gap kept: none pushed for its missed tick), then a state two
        // intervals on: only the state's two slots, nothing taken back.
        noDataThenASample: slotCountAfterNoDataThenSample(),
    }, {staleStateAfterAStall: 6, sampleToldTwice: 5, moreNoDataSlotsThanIntervals: 7, noDataThenASample: 9});
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
    'real time, which counts a suspend in the lock as the histories do; until the first reading after it, which is ' +
    'no reading, the newest slot counts nothing and each kept cap shows what it showed at the lock; that reading ' +
    'judges them: herdr stopped ends the wait, the session still blocked keeps it amber', () => {
    const afterLock = firstReadingAfter => {
        const recorder = new agentsTrack.AgentsTrackRecorder();
        recorder.recordSessions(reading(3, ['pane-a']));
        let lastBeforeLockUsec = FIRST_SAMPLE_AT_USEC;
        for (let sampleIndex = 0; sampleIndex < 5; sampleIndex++) {
            lastBeforeLockUsec = FIRST_SAMPLE_AT_USEC + sampleIndex * SAMPLE_INTERVAL_USEC;
            recorder.recordHistoryChange(sampleChange(lastBeforeLockUsec));
        }
        recorder.holdAcrossDisable();
        recorder.recordHistoryChange(stateChange(lastBeforeLockUsec + LOCK_OF_90_SECONDS_USEC));
        const beforeReading = recorder.cells();
        recorder.recordSessions(firstReadingAfter);
        return {beforeReading, afterReading: recorder.cells()};
    };
    // Fifty slots: five of 3 with pane-a blocked, forty-four empty, then the first after the lock.
    assertEqual({
        herdrStopped: afterLock(agentsTrack.sessionsReading({herdrRunning: false, rows: []})),
        stillBlocked: afterLock(reading(2, ['pane-a'])),
    }, {
        herdrStopped: {
            beforeReading: cellsWith({20: {workingCount: 3, capState: 'ongoing'}}),
            afterReading: cellsWith({
                20: {workingCount: 3, capState: 'ended'}, 29: {workingCount: 0, capState: 'none'},
            }),
        },
        stillBlocked: {
            beforeReading: cellsWith({20: {workingCount: 3, capState: 'ongoing'}}),
            afterReading: cellsWith({
                20: {workingCount: 3, capState: 'ongoing'}, 29: {workingCount: 2, capState: 'ongoing'},
            }),
        },
    });
});

test('agentsTrack: a reading told again unchanged builds nothing (the newest slot and the blocked keys stay the ' +
    'same objects), and every empty slot is one frozen slot, so a user with no cockpit allocates none a Sample', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC));
    recorder.recordSessions(reading(2, ['pane-a']));
    const newestSlot = recorder._slots.at(-1);
    const blockedSessionKeys = recorder._latestBlockedSessionKeys;
    recorder.recordSessions(reading(2, ['pane-a']));
    const unchanged = recorder._slots.at(-1) === newestSlot && recorder._latestBlockedSessionKeys === blockedSessionKeys;
    const noCockpit = new agentsTrack.AgentsTrackRecorder();
    [FIRST_SAMPLE_AT_USEC, FIRST_SAMPLE_AT_USEC + SAMPLE_INTERVAL_USEC]
        .forEach(sampledAtUsec => noCockpit.recordHistoryChange(sampleChange(sampledAtUsec)));
    noCockpit.recordHistoryChange(NO_DATA_CHANGE);
    const [firstSlot, ...laterSlots] = noCockpit._slots;
    assertEqual({unchanged, isOneFrozenSlot: Object.isFrozen(firstSlot) && laterSlots.every(slot => slot === firstSlot)},
        {unchanged: true, isOneFrozenSlot: true});
});

test('agentsTrack: the recorder holds no more slots than the plot has Samples', () => {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recordSamplesWithCounts(recorder, Array.from({length: CARD_HISTORY_SAMPLES + 12}, (_unused, index) => index));
    assertEqual({slotCount: recorder.slotCount, oldest: recorder.cells()[0].workingCount},
        {slotCount: CARD_HISTORY_SAMPLES, oldest: 16});
});

test('agentsTrack: sessionsReading: the rows working and the keys of those blocked; herdr not running counts 0; no ' +
    'source, no rows list or herdr\'s state unread is no reading, never a throw; a state it does not know counts as ' +
    'neither', () => {
    const rows = [
        {id: 'a', state: 'working'}, {id: 'b', state: 'blocked'}, {id: 'c', state: 'working'},
        {id: 'd', state: 'idle'}, {id: 'e', state: 'thinking'}, {id: 'f', state: 'blocked'},
    ];
    assertEqual({
        rows: agentsTrack.sessionsReading({herdrRunning: true, rows}),
        herdrNotRunning: agentsTrack.sessionsReading({herdrRunning: false, rows: []}),
        herdrNotRunningNoRows: agentsTrack.sessionsReading({herdrRunning: false, rows: null}),
        noSource: agentsTrack.sessionsReading(null),
        noRows: agentsTrack.sessionsReading({herdrRunning: true, rows: null}),
        herdrUnread: agentsTrack.sessionsReading({herdrRunning: null, rows}),
    }, {
        rows: {workingCount: 2, blockedSessionKeys: ['b', 'f']},
        herdrNotRunning: {workingCount: 0, blockedSessionKeys: []},
        herdrNotRunningNoRows: {workingCount: 0, blockedSessionKeys: []},
        noSource: null,
        noRows: null,
        herdrUnread: null,
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

test('agentsTrack: presentWorkingCount: the sessions working, for the present; none while herdr is not running, ' +
    'there is no source or no rows list, though the cells count 0 with herdr not running', () =>
    assertEqual([
        agentsTrack.presentWorkingCount({herdrRunning: true, rows: [{id: 'a', state: 'working'}, {id: 'b', state: 'idle'}]}),
        agentsTrack.presentWorkingCount({herdrRunning: true, rows: []}),
        agentsTrack.presentWorkingCount({herdrRunning: false, rows: []}),
        agentsTrack.presentWorkingCount(null),
        agentsTrack.presentWorkingCount({herdrRunning: true, rows: null}),
    ], [1, 0, null, null, null]));

/**
 * A recorder whose track holds two waits: session b blocked in the older cell, then a blocked in the newest too, the
 * reading now a blocked and b moved on, so the older cell's cap has ended and the newest's goes on.
 *
 * @returns {agentsTrack.AgentsTrackRecorder} The recorder.
 */
function recorderWithOneWaitEndedAndOneOngoing() {
    const recorder = new agentsTrack.AgentsTrackRecorder();
    recorder.recordSessions(reading(1, ['b']));
    // Six Samples: the first fills the older cell alone, the other five the newest.
    for (let sampleIndex = 0; sampleIndex < 6; sampleIndex++)
        recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC + sampleIndex * SAMPLE_INTERVAL_USEC));
    recorder.recordSessions(reading(2, ['a']));
    return recorder;
}

/** The two waits' cells as recorderWithOneWaitEndedAndOneOngoing leaves them: b's ended, a's ongoing. */
const ONE_WAIT_ENDED_AND_ONE_ONGOING = cellsWith({
    28: {workingCount: 1, capState: 'ended'}, 29: {workingCount: 2, capState: 'ongoing'},
});

test('agentsTrack: herdr stopped is a reading: no session working and none blocked, so every cap is judged and a ' +
    'wait still amber ends', () => {
    const recorder = recorderWithOneWaitEndedAndOneOngoing();
    const before = recorder.cells();
    recorder.recordSessions(agentsTrack.sessionsReading({herdrRunning: false, rows: []}));
    assertEqual({before, herdrStopped: recorder.cells()}, {
        before: ONE_WAIT_ENDED_AND_ONE_ONGOING,
        herdrStopped: cellsWith({28: {workingCount: 1, capState: 'ended'}, 29: {workingCount: 2, capState: 'ended'}}),
    });
});

test('agentsTrack: no reading (the cockpit service gone, or its sessions source stale) judges no cap: each keeps what ' +
    'it last showed, amber where amber, and the counts stand', () => {
    const recorder = recorderWithOneWaitEndedAndOneOngoing();
    recorder.recordSessions(null);
    const afterNoReading = recorder.cells();
    recorder.recordHistoryChange(sampleChange(FIRST_SAMPLE_AT_USEC + 6 * SAMPLE_INTERVAL_USEC));
    assertEqual({afterNoReading, afterASampleWithout: recorder.cells()[CELL_COUNT - 1]}, {
        afterNoReading: ONE_WAIT_ENDED_AND_ONE_ONGOING,
        afterASampleWithout: {workingCount: 2, capState: 'ongoing'},
    });
});

test('agentsTrack: the reading back after none judges every cap again: the wait that went on through the gap ' +
    'stays amber, one that ended in it ends, and the same reading as before the gap is taken again', () => {
    const capsAfterGap = readingBack => {
        const recorder = recorderWithOneWaitEndedAndOneOngoing();
        recorder.recordSessions(null);
        recorder.recordSessions(readingBack);
        return recorder.cells().slice(CELL_COUNT - 2).map(cell => cell.capState);
    };
    assertEqual({
        stillBlocked: capsAfterGap(reading(2, ['a'])),
        movedOn: capsAfterGap(reading(2, [])),
        bBlockedAgain: capsAfterGap(reading(1, ['b'])),
    }, {stillBlocked: ['ended', 'ongoing'], movedOn: ['ended', 'ended'], bBlockedAgain: ['ongoing', 'ongoing']});
});
