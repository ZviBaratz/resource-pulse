// The machine's conditions the desktop card draws in amber: a wait on CPU, memory or io, and swap growing on disk.
//
// - A wait is pressure's `some avg10` at 25 % or over, the second band of lib/pressure.js (PRESSURE_WAIT_BAND): below
//   it the machine is busy, not slow.
// - Swapping is swap on disk larger by SWAP_GROWTH_THRESHOLD_BYTES or more than it was SWAP_GROWTH_SPAN_SAMPLES
//   Samples before. A level of swap that only stays above zero is not a reason the machine is slow now. The growth is
//   counted in Samples, never by a timer: SwapGrowthWindow keeps the swap on disk of the Samples it was told of, and a
//   Sample it was not told of (as while the card is covered) starts it again, so it never judges growth across a hole.
// - A reading that is missing lights nothing: a null pressure is no wait, and a null swap, or a snapshot with no time,
//   empties the window at once.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {MICROSECONDS_PER_SECOND, SAMPLE_INTERVAL_SECONDS} from './constants.js';
import {pressureBand} from './pressure.js';

/** The PSI band from which a resource counts as waited on: 25 % of avg10 and over (lib/pressure.js). */
export const PRESSURE_WAIT_BAND = 2;
/** How far back swap growth is judged, in Samples: five Samples, 10 s. */
export const SWAP_GROWTH_SPAN_SAMPLES = 5;
/** The growth of swap on disk over SWAP_GROWTH_SPAN_SAMPLES Samples that counts as Swapping, in bytes: 1 MiB. */
export const SWAP_GROWTH_THRESHOLD_BYTES = 1024 * 1024;
/**
 * The longest time between two Samples that still makes them neighbours, in Sample intervals: one interval and a half,
 * so a tick that comes a little late is no hole, and a tick missed is one.
 */
const NEIGHBOUR_SAMPLE_GAP_INTERVALS = 1.5;
const NEIGHBOUR_SAMPLE_GAP_USEC = NEIGHBOUR_SAMPLE_GAP_INTERVALS * SAMPLE_INTERVAL_SECONDS * MICROSECONDS_PER_SECOND;
/** The readings the window keeps: the newest Sample and the SWAP_GROWTH_SPAN_SAMPLES before it. */
const SWAP_WINDOW_READING_COUNT = SWAP_GROWTH_SPAN_SAMPLES + 1;

/**
 * @typedef {object} PressureWaits
 * @property {boolean} cpu - CPU is waited on (avg10 at 25 % or over).
 * @property {boolean} memory - Memory is waited on.
 * @property {boolean} io - io is waited on.
 */

/**
 * @typedef {object} MachineConditions
 * @property {PressureWaits} waits - Each resource's wait.
 * @property {boolean} isSwapping - Swap on disk grew by SWAP_GROWTH_THRESHOLD_BYTES or more over
 *     SWAP_GROWTH_SPAN_SAMPLES Samples.
 */

/** What every condition reads with nothing known: none of them holds. */
export const NO_MACHINE_CONDITIONS = Object.freeze({
    waits: Object.freeze({cpu: false, memory: false, io: false}),
    isSwapping: false,
});

/**
 * Whether one pressure reading is a wait.
 *
 * @param {number|null|undefined} avg10Percent - The resource's `some avg10`, 0–100; null or undefined for no data.
 * @returns {boolean} True from PRESSURE_WAIT_BAND up; false with no data.
 */
export function isPressureWait(avg10Percent) {
    const band = pressureBand(avg10Percent);
    return band !== null && band >= PRESSURE_WAIT_BAND;
}

/**
 * Which resources the machine is waiting on.
 *
 * @param {{cpu: number|null, memory: number|null, io: number|null}|null|undefined} pressureAvg10 - PSI `some avg10`
 *     per resource; null or undefined for no data.
 * @returns {PressureWaits} Each resource's wait; none with no data.
 */
export function pressureWaits(pressureAvg10) {
    return {
        cpu: isPressureWait(pressureAvg10?.cpu),
        memory: isPressureWait(pressureAvg10?.memory),
        io: isPressureWait(pressureAvg10?.io),
    };
}

/** The swap on disk of the last Samples told, neighbours all, for judging whether it grows. */
export class SwapGrowthWindow {
    /** Starts empty: nothing grows until SWAP_WINDOW_READING_COUNT neighbouring Samples are recorded. */
    constructor() {
        /** @type {Array<{takenAtUsec: number, diskBytes: number}>} */
        this._readings = [];
    }

    /**
     * Records one snapshot. The same Sample told again (the same takenAtUsec, as at a reveal) is not counted twice; a
     * Sample that is not the last one's neighbour (a hole, or a time that went back) starts the window again with it;
     * a snapshot with no time or no swap empties it.
     *
     * @param {import('./pulseSnapshots.js').Snapshot|null} snapshot - The latest snapshot, or null before the first.
     * @returns {void}
     */
    record(snapshot) {
        const takenAtUsec = snapshot?.takenAtUsec ?? null;
        const diskBytes = snapshot?.swap?.diskBytes ?? null;
        if (!Number.isFinite(takenAtUsec) || !Number.isFinite(diskBytes)) {
            this.clear();
            return;
        }
        const newestReading = this._readings.at(-1);
        if (newestReading !== undefined && takenAtUsec === newestReading.takenAtUsec)
            return;
        if (newestReading !== undefined && !isNeighbourSample(newestReading.takenAtUsec, takenAtUsec))
            this.clear();
        this._readings.push({takenAtUsec, diskBytes});
        if (this._readings.length > SWAP_WINDOW_READING_COUNT)
            this._readings.shift();
    }

    /**
     * Whether swap on disk is growing: the window holds SWAP_WINDOW_READING_COUNT neighbouring Samples, and the newest
     * holds SWAP_GROWTH_THRESHOLD_BYTES or more than the oldest.
     *
     * @returns {boolean} True while Swapping.
     */
    get isSwapping() {
        if (this._readings.length < SWAP_WINDOW_READING_COUNT)
            return false;
        const growthBytes = this._readings.at(-1).diskBytes - this._readings[0].diskBytes;
        return growthBytes >= SWAP_GROWTH_THRESHOLD_BYTES;
    }

    /**
     * Forgets every reading.
     *
     * @returns {void}
     */
    clear() {
        this._readings = [];
    }
}

/**
 * Whether a Sample follows another as its neighbour: later, and by no more than NEIGHBOUR_SAMPLE_GAP_USEC.
 *
 * @param {number} earlierTakenAtUsec - The earlier Sample's time, in microseconds.
 * @param {number} laterTakenAtUsec - The later Sample's time, in microseconds.
 * @returns {boolean} True for neighbours.
 */
function isNeighbourSample(earlierTakenAtUsec, laterTakenAtUsec) {
    const gapUsec = laterTakenAtUsec - earlierTakenAtUsec;
    return gapUsec > 0 && gapUsec <= NEIGHBOUR_SAMPLE_GAP_USEC;
}

/**
 * The machine's conditions now: each wait from the snapshot's pressure, and Swapping from the window, which the caller
 * has given every snapshot it was told of, this one included.
 *
 * @param {import('./pulseSnapshots.js').Snapshot|null} snapshot - The latest snapshot, or null before the first.
 * @param {SwapGrowthWindow} swapGrowthWindow - The swap on disk of the Samples told.
 * @returns {MachineConditions} The conditions; NO_MACHINE_CONDITIONS with no snapshot.
 */
export function machineConditions(snapshot, swapGrowthWindow) {
    if (snapshot === null || snapshot === undefined)
        return NO_MACHINE_CONDITIONS;
    return {waits: pressureWaits(snapshot.pressureAvg10), isSwapping: swapGrowthWindow.isSwapping};
}
