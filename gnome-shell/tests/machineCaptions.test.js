// lib/machineCaptions.js: the machine's captions lit at once and held for five Samples, counted in Samples; a missing
// reading ends a hold at once; Machine stale from no data until the next Sample.
import {test, assertEqual} from './harness.js';
import {
    CAPTION_HOLD_SAMPLES, MachineCaption, MachineCaptionTracker,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/machineCaptions.js';
import {MICROSECONDS_PER_SECOND, SAMPLE_INTERVAL_SECONDS} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

const SAMPLE_INTERVAL_USEC = SAMPLE_INTERVAL_SECONDS * MICROSECONDS_PER_SECOND;
/** The first Sample's time in the rows below: any monotonic time. */
const FIRST_TAKEN_AT_USEC = 7_000_000_000;
const BASE_DISK_BYTES = 512 * 1024 * 1024;
const ONE_MEBIBYTE = 1024 * 1024;
/** A cpu wait: avg10 at the second band, and the band's edge (25 %), and under it. */
const WAITED_ON_PERCENT = 31;
const WAIT_EDGE_PERCENT = 25;
const UNDER_WAIT_PERCENT = 24;
const CALM_PERCENT = 3;

/**
 * One Sample's readings: the n-th, one interval after the one before.
 *
 * @param {number} sampleIndex - Which Sample, from 0.
 * @param {object} [reading] - What it carries.
 * @param {number|null} [reading.cpu] - cpu avg10; null for a missing reading.
 * @param {number|null} [reading.memory] - memory avg10.
 * @param {number|null} [reading.io] - io avg10.
 * @param {number|null} [reading.diskBytes] - Swap on disk; null for a missing swap reading.
 * @returns {object} The readings.
 */
function readingsAt(sampleIndex, {cpu = CALM_PERCENT, memory = CALM_PERCENT, io = CALM_PERCENT,
    diskBytes = BASE_DISK_BYTES} = {}) {
    return {
        takenAtUsec: FIRST_TAKEN_AT_USEC + sampleIndex * SAMPLE_INTERVAL_USEC,
        swap: diskBytes === null ? null : {zramUsedBytes: 0, zramRamBytes: 0, diskBytes},
        pressureAvg10: {cpu, memory, io},
    };
}

/**
 * Tells a new tracker one Sample per cpu reading, and says after each whether CPU wait is lit.
 *
 * @param {Array<number|null>} cpuReadings - cpu avg10 per Sample.
 * @returns {boolean[]} CPU wait lit, after each Sample.
 */
function cpuWaitLitAfterEach(cpuReadings) {
    const tracker = new MachineCaptionTracker();
    return cpuReadings.map((cpu, sampleIndex) => {
        tracker.recordSample(readingsAt(sampleIndex, {cpu}));
        return tracker.litCaptions.includes(MachineCaption.CPU_WAIT);
    });
}

/**
 * The cpu readings of a wait on one Sample and then the given count of calm ones.
 *
 * @param {number} calmSampleCount - How many calm Samples follow the wait.
 * @returns {number[]} The readings.
 */
const waitThenCalm = calmSampleCount => [WAITED_ON_PERCENT, ...Array(calmSampleCount).fill(CALM_PERCENT)];

test('machine captions: a wait lights on its first Sample, stays lit while it reads false on four Samples, and ' +
    'unlights on the fifth', () => {
    assertEqual(CAPTION_HOLD_SAMPLES, 5);
    const litAfterEach = cpuWaitLitAfterEach(waitThenCalm(CAPTION_HOLD_SAMPLES));
    assertEqual(litAfterEach, [true, true, true, true, true, false]);
});

test('machine captions: a wait again inside the hold starts its count again', () => {
    const readings = [...waitThenCalm(CAPTION_HOLD_SAMPLES - 1), ...waitThenCalm(CAPTION_HOLD_SAMPLES)];
    const litAfterEach = cpuWaitLitAfterEach(readings);
    assertEqual({
        throughTheSecondHold: litAfterEach.slice(0, -1).every(isLit => isLit),
        last: litAfterEach.at(-1),
    }, {throughTheSecondHold: true, last: false});
});

test('machine captions: a reading that hovers at 25 % keeps its caption lit, never toggling it every Sample', () => {
    const hoveringReadings = Array.from({length: 12},
        (_unused, sampleIndex) => (sampleIndex % 2 === 0 ? WAIT_EDGE_PERCENT : UNDER_WAIT_PERCENT));
    assertEqual(cpuWaitLitAfterEach(hoveringReadings).every(isLit => isLit), true);
});

test('machine captions: a missing reading ends its caption\'s hold at once, and lights nothing', () => {
    assertEqual({
        missingInTheHold: cpuWaitLitAfterEach([WAITED_ON_PERCENT, CALM_PERCENT, null]),
        missingFirst: cpuWaitLitAfterEach([null, null]),
    }, {missingInTheHold: [true, true, false], missingFirst: [false, false]});
});

test('machine captions: a missing reading of one resource ends only that resource\'s hold', () => {
    const tracker = new MachineCaptionTracker();
    tracker.recordSample(readingsAt(0, {cpu: WAITED_ON_PERCENT, io: WAITED_ON_PERCENT}));
    tracker.recordSample(readingsAt(1, {cpu: CALM_PERCENT, io: null}));
    assertEqual(tracker.litCaptions, [MachineCaption.CPU_WAIT]);
});

test('machine captions: before the first Sample nothing is lit, Machine stale included', () =>
    assertEqual(new MachineCaptionTracker().litCaptions, []));

test('machine captions: the same Sample told again (a reveal) counts once toward a hold', () => {
    const tracker = new MachineCaptionTracker();
    const litAfterEach = [];
    waitThenCalm(CAPTION_HOLD_SAMPLES).forEach((cpu, sampleIndex) => {
        const readings = readingsAt(sampleIndex, {cpu});
        tracker.recordSample(readings);
        tracker.recordSample(readings);
        litAfterEach.push(tracker.litCaptions.includes(MachineCaption.CPU_WAIT));
    });
    assertEqual(litAfterEach, [true, true, true, true, true, false]);
});

test('machine captions: Swapping lights when swap on disk has grown by 1 MiB over five Samples, and is held for ' +
    'five Samples after the growth leaves the window; isSwapping, the card\'s, has no hold', () => {
    const tracker = new MachineCaptionTracker();
    const grownAtSample = 5;
    const sampleCount = 16;
    const litAfterEach = [];
    const swappingAfterEach = [];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const diskBytes = sampleIndex < grownAtSample ? BASE_DISK_BYTES : BASE_DISK_BYTES + ONE_MEBIBYTE;
        tracker.recordSample(readingsAt(sampleIndex, {diskBytes}));
        litAfterEach.push(tracker.litCaptions.includes(MachineCaption.SWAPPING));
        swappingAfterEach.push(tracker.isSwapping);
    }
    const sampleIndexesWhere = flags => flags.flatMap((flag, sampleIndex) => (flag ? [sampleIndex] : []));
    assertEqual({
        captionLit: sampleIndexesWhere(litAfterEach),
        isSwapping: sampleIndexesWhere(swappingAfterEach),
    }, {captionLit: [5, 6, 7, 8, 9, 10, 11, 12, 13], isSwapping: [5, 6, 7, 8, 9]});
});

test('machine captions: a missing swap reading ends Swapping at once and empties the window', () => {
    const tracker = new MachineCaptionTracker();
    for (let sampleIndex = 0; sampleIndex < 6; sampleIndex++)
        tracker.recordSample(readingsAt(sampleIndex, {diskBytes: BASE_DISK_BYTES + sampleIndex * ONE_MEBIBYTE}));
    const wasLit = tracker.litCaptions.includes(MachineCaption.SWAPPING);
    tracker.recordSample(readingsAt(6, {diskBytes: null}));
    assertEqual({wasLit, litAfter: tracker.litCaptions, isSwapping: tracker.isSwapping},
        {wasLit: true, litAfter: [], isSwapping: false});
});

test('machine captions: no data ends every hold at once and lights Machine stale, until the next Sample', () => {
    const tracker = new MachineCaptionTracker();
    tracker.recordSample(readingsAt(0, {cpu: WAITED_ON_PERCENT, memory: WAITED_ON_PERCENT}));
    const beforeNoData = tracker.litCaptions;
    tracker.recordNoData();
    const silent = tracker.litCaptions;
    tracker.recordSample(readingsAt(10));
    assertEqual({beforeNoData, silent, nextSample: tracker.litCaptions}, {
        beforeNoData: [MachineCaption.CPU_WAIT, MachineCaption.MEM_WAIT],
        silent: [MachineCaption.MACHINE_STALE],
        nextSample: [],
    });
});

test('machine captions: a Sample with no snapshot ends every hold, and is no reason for Machine stale', () => {
    const tracker = new MachineCaptionTracker();
    tracker.recordSample(readingsAt(0, {io: WAITED_ON_PERCENT}));
    tracker.recordSample(null);
    assertEqual(tracker.litCaptions, []);
});

test('machine captions: a Sample with no snapshot empties the swap window: the card\'s Swapping ends with the ' +
    'caption, and the next Sample starts the window again, even the last reading\'s neighbour', () => {
    const tracker = new MachineCaptionTracker();
    const grownSampleCount = 6;
    for (let sampleIndex = 0; sampleIndex < grownSampleCount; sampleIndex++)
        tracker.recordSample(readingsAt(sampleIndex, {diskBytes: BASE_DISK_BYTES + sampleIndex * ONE_MEBIBYTE}));
    const isSwappingBefore = tracker.isSwapping;
    tracker.recordSample(null);
    const afterNoSnapshot = {isSwapping: tracker.isSwapping, litCaptions: tracker.litCaptions};
    const neighbourDiskBytes = BASE_DISK_BYTES + grownSampleCount * ONE_MEBIBYTE;
    tracker.recordSample(readingsAt(grownSampleCount, {diskBytes: neighbourDiskBytes}));
    assertEqual({isSwappingBefore, afterNoSnapshot, isSwappingAfterTheNextSample: tracker.isSwapping}, {
        isSwappingBefore: true,
        afterNoSnapshot: {isSwapping: false, litCaptions: []},
        isSwappingAfterTheNextSample: false,
    });
});

test('machine captions: the lit captions are named in one order, and the same list is returned until one lights ' +
    'or unlights', () => {
    const tracker = new MachineCaptionTracker();
    const everyWait = {cpu: WAITED_ON_PERCENT, memory: WAITED_ON_PERCENT, io: WAITED_ON_PERCENT};
    for (let sampleIndex = 0; sampleIndex < 6; sampleIndex++) {
        const diskBytes = BASE_DISK_BYTES + sampleIndex * ONE_MEBIBYTE;
        tracker.recordSample(readingsAt(sampleIndex, {...everyWait, diskBytes}));
    }
    const allLit = tracker.litCaptions;
    tracker.recordSample(readingsAt(6, {...everyWait, diskBytes: BASE_DISK_BYTES + 6 * ONE_MEBIBYTE}));
    assertEqual({
        allLit,
        isSameListWhileUnchanged: tracker.litCaptions === allLit,
        isFrozen: Object.isFrozen(allLit),
    }, {
        allLit: [MachineCaption.CPU_WAIT, MachineCaption.MEM_WAIT, MachineCaption.IO_WAIT, MachineCaption.SWAPPING],
        isSameListWhileUnchanged: true,
        isFrozen: true,
    });
});

test('machine captions: their words, as the hover label and the dropdown name them', () =>
    assertEqual(Object.values(MachineCaption), ['CPU wait', 'Mem wait', 'IO wait', 'Swapping', 'Machine stale']));
