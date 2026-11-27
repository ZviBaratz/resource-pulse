// lib/machineConditions.js: a wait from 25 % of avg10, and Swapping as swap on disk grown by 1 MiB over five Samples
// told one after another, with nothing lit by a reading that is missing.
import {test, assertEqual} from './harness.js';
import {
    NO_MACHINE_CONDITIONS, SWAP_GROWTH_SPAN_SAMPLES, SWAP_GROWTH_THRESHOLD_BYTES, SwapGrowthWindow, isPressureWait,
    machineConditions, pressureWaits,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/machineConditions.js';
import {
    MICROSECONDS_PER_SECOND, SAMPLE_INTERVAL_SECONDS,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

const SAMPLE_INTERVAL_USEC = SAMPLE_INTERVAL_SECONDS * MICROSECONDS_PER_SECOND;
/** The first Sample's time in the rows below: any monotonic time. */
const FIRST_TAKEN_AT_USEC = 5_000_000_000;
const BASE_DISK_BYTES = 512 * 1024 * 1024;
/** A late tick that is still a neighbour (1.4 intervals), and a missed one (two intervals). */
const LATE_TICK_INTERVALS = 1.4;
const MISSED_TICK_INTERVALS = 2;

/**
 * A snapshot with only what the conditions read: its time, its swap on disk and its pressure.
 *
 * @param {object} reading - What the snapshot carries.
 * @param {number|null} reading.takenAtUsec - The Sample's time.
 * @param {number|null} [reading.diskBytes] - Swap on disk; null for a snapshot with no swap.
 * @param {object|null} [reading.pressureAvg10] - PSI avg10 per resource.
 * @returns {object} The snapshot.
 */
function snapshotAt({takenAtUsec, diskBytes = BASE_DISK_BYTES, pressureAvg10 = {cpu: 0, memory: 0, io: 0}}) {
    const swap = diskBytes === null ? null : {zramUsedBytes: 0, zramRamBytes: 0, diskBytes};
    return {takenAtUsec, swap, pressureAvg10};
}

/**
 * A window told one Sample per entry, each a full interval after the one before unless its gap says otherwise.
 *
 * @param {Array<{growthBytes?: number, gapIntervals?: number, diskBytes?: number|null}>} samples - Each Sample's swap
 *     growth over the first, and its gap from the one before, in intervals.
 * @returns {SwapGrowthWindow} The window after the last.
 */
function windowTold(samples) {
    const swapGrowthWindow = new SwapGrowthWindow();
    let takenAtUsec = FIRST_TAKEN_AT_USEC;
    samples.forEach(({growthBytes = 0, gapIntervals = 1, diskBytes}, sampleIndex) => {
        if (sampleIndex > 0)
            takenAtUsec += gapIntervals * SAMPLE_INTERVAL_USEC;
        const sampleDiskBytes = diskBytes === undefined ? BASE_DISK_BYTES + growthBytes : diskBytes;
        swapGrowthWindow.record(snapshotAt({takenAtUsec, diskBytes: sampleDiskBytes}));
    });
    return swapGrowthWindow;
}

/**
 * Six Samples told one after another, the last grown over the first by a number of bytes.
 *
 * @param {number} growthBytes - The last Sample's growth.
 * @returns {Array<{growthBytes: number}>} The Samples.
 */
function grownOverSpan(growthBytes) {
    const steadySamples = Array.from({length: SWAP_GROWTH_SPAN_SAMPLES}, () => ({growthBytes: 0}));
    return [...steadySamples, {growthBytes}];
}

test('machine conditions: 24.9 % is no wait and 25 % is one, for each resource alone', () =>
    assertEqual(['cpu', 'memory', 'io'].map(resource => [24.9, 25].map(avg10Percent =>
        pressureWaits({cpu: 0, memory: 0, io: 0, [resource]: avg10Percent})[resource])),
    [[false, true], [false, true], [false, true]]));

test('machine conditions: a pressure reading that is null, missing or not a number is no wait, and so is no ' +
    'reading', () =>
    assertEqual({
        readings: [null, undefined, Number.NaN].map(isPressureWait),
        noReading: [pressureWaits(null), pressureWaits(undefined)],
    }, {
        readings: [false, false, false],
        noReading: [{cpu: false, memory: false, io: false}, {cpu: false, memory: false, io: false}],
    }));

test('machine conditions: Swapping at exactly 1 MiB of growth over five Samples, not at a byte less', () =>
    assertEqual([SWAP_GROWTH_THRESHOLD_BYTES, SWAP_GROWTH_THRESHOLD_BYTES - 1].map(growthBytes =>
        windowTold(grownOverSpan(growthBytes)).isSwapping), [true, false]));

test('machine conditions: growth over four Samples is not yet Swapping, and swap that shrinks never is', () =>
    assertEqual({
        overFourSamples: windowTold(grownOverSpan(SWAP_GROWTH_THRESHOLD_BYTES).slice(1)).isSwapping,
        shrinking: windowTold(grownOverSpan(-SWAP_GROWTH_THRESHOLD_BYTES)).isSwapping,
    }, {overFourSamples: false, shrinking: false}));

test('machine conditions: the window judges the last five Samples only, so growth that stopped ends Swapping', () => {
    const grownThenSteady = [...grownOverSpan(SWAP_GROWTH_THRESHOLD_BYTES),
        ...Array.from({length: SWAP_GROWTH_SPAN_SAMPLES}, () => ({growthBytes: SWAP_GROWTH_THRESHOLD_BYTES}))];
    assertEqual(windowTold(grownThenSteady).isSwapping, false);
});

test('machine conditions: the same Sample told twice (a reveal) is counted once', () => {
    const swapGrowthWindow = windowTold(grownOverSpan(SWAP_GROWTH_THRESHOLD_BYTES).slice(1));
    const lastTakenAtUsec = FIRST_TAKEN_AT_USEC + (SWAP_GROWTH_SPAN_SAMPLES - 1) * SAMPLE_INTERVAL_USEC;
    swapGrowthWindow.record(snapshotAt({takenAtUsec: lastTakenAtUsec,
        diskBytes: BASE_DISK_BYTES + SWAP_GROWTH_THRESHOLD_BYTES}));
    assertEqual(swapGrowthWindow.isSwapping, false);
});

test('machine conditions: a late tick keeps the window, a missed Sample starts it again, and so does a time that ' +
    'goes back', () => {
    const withGapBeforeLast = gapIntervals => {
        const samples = grownOverSpan(SWAP_GROWTH_THRESHOLD_BYTES);
        samples[samples.length - 1].gapIntervals = gapIntervals;
        return windowTold(samples).isSwapping;
    };
    assertEqual([LATE_TICK_INTERVALS, MISSED_TICK_INTERVALS, -1].map(withGapBeforeLast), [true, false, false]);
});

test('machine conditions: a snapshot with no swap, or no time, empties the window at once', () => {
    const afterMissingReading = missingReading => {
        const swapGrowthWindow = windowTold(grownOverSpan(SWAP_GROWTH_THRESHOLD_BYTES));
        const wasSwapping = swapGrowthWindow.isSwapping;
        swapGrowthWindow.record(missingReading);
        return [wasSwapping, swapGrowthWindow.isSwapping];
    };
    const lastTakenAtUsec = FIRST_TAKEN_AT_USEC + SWAP_GROWTH_SPAN_SAMPLES * SAMPLE_INTERVAL_USEC;
    assertEqual([
        snapshotAt({takenAtUsec: lastTakenAtUsec + SAMPLE_INTERVAL_USEC, diskBytes: null}),
        snapshotAt({takenAtUsec: null}),
        null,
    ].map(afterMissingReading), [[true, false], [true, false], [true, false]]);
});

test('machine conditions: before the first sample, and with a snapshot that has no data, nothing is lit', () => {
    const swappingWindow = windowTold(grownOverSpan(SWAP_GROWTH_THRESHOLD_BYTES));
    const noDataSnapshot = {takenAtUsec: null, swap: null, pressureAvg10: null};
    swappingWindow.record(noDataSnapshot);
    assertEqual({
        beforeFirst: machineConditions(null, new SwapGrowthWindow().isSwapping),
        noData: machineConditions(noDataSnapshot, swappingWindow.isSwapping),
    }, {beforeFirst: NO_MACHINE_CONDITIONS, noData: NO_MACHINE_CONDITIONS});
});

test('machine conditions: a snapshot under strain lights each wait it has and Swapping as the window judges it', () => {
    const swappingWindow = windowTold(grownOverSpan(SWAP_GROWTH_THRESHOLD_BYTES));
    const strainedSnapshot =
        snapshotAt({takenAtUsec: FIRST_TAKEN_AT_USEC, pressureAvg10: {cpu: 31, memory: 4, io: 60}});
    assertEqual(machineConditions(strainedSnapshot, swappingWindow.isSwapping),
        {waits: {cpu: true, memory: false, io: true}, isSwapping: true});
});
