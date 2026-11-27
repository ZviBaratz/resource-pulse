// The machine's captions: what the top bar's mark, its hover label and the dropdown's first line say the machine is in.
//
// - CPU wait, Mem wait and IO wait are lit while their resource is waited on (lib/machineConditions.js: 25 % of
//   avg10 and over), and Swapping while swap on disk grows (the same module's SwapGrowthWindow).
// - A hold: each of those four lights on the first Sample its condition holds, and stays lit until its condition has
//   read false on CAPTION_HOLD_SAMPLES Samples in a row (10 s), so a reading that hovers at the threshold does not
//   toggle the caption every Sample. The hold is counted in Samples, never by a timer: a Sample told twice (the same
//   takenAtUsec, as a watch start's reveal) counts once.
// - A reading that is missing ends its hold at once: before the first Sample, and while the sampler is silent, every
//   one of the four is unlit, since a hold counted in Samples would otherwise never end while no Sample comes. A
//   Sample with no readings at all also empties the swap window, as no data does, so the card's Swapping ends too.
// - Machine stale is lit while the sampler is silent: from the client's no data (the stall rule, SAMPLE_STALL_MS, or
//   the service gone) until the next reading. Before the first reading nothing is lit, stale included.
//
// The client records every Sample in a MachineCaptionTracker, covered or not, and the card reads its Swapping from the
// same tracker's window, so the card's amber and the captions judge swap over the same Samples.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {SwapGrowthWindow, isPressureWait} from './machineConditions.js';

/** The machine's captions, in the order they are named. Off a plate, "Stale" says whose it is: "Machine stale". */
export const MachineCaption = Object.freeze({
    CPU_WAIT: 'CPU wait',
    MEM_WAIT: 'Mem wait',
    IO_WAIT: 'IO wait',
    SWAPPING: 'Swapping',
    MACHINE_STALE: 'Machine stale',
});

/** How many Samples in a row a held caption's condition must read false before it is unlit: five, 10 s. */
export const CAPTION_HOLD_SAMPLES = 5;

/** The captions that are held, in the order they are named, each with the pressure resource it reads, if any. */
const HELD_CAPTIONS = Object.freeze([
    {caption: MachineCaption.CPU_WAIT, pressureResource: 'cpu'},
    {caption: MachineCaption.MEM_WAIT, pressureResource: 'memory'},
    {caption: MachineCaption.IO_WAIT, pressureResource: 'io'},
    {caption: MachineCaption.SWAPPING, pressureResource: null},
]);

/** No caption lit: one frozen list, so a tracker with nothing lit always returns the same one. */
const NO_LIT_CAPTIONS = Object.freeze([]);

/**
 * @typedef {object} ConditionReadings
 * @property {number|null} takenAtUsec - The Sample's monotonic time, in microseconds; null when unknown.
 * @property {{cpu: number|null, memory: number|null, io: number|null}|null} pressureAvg10 - PSI `some avg10` per
 *     resource; null for no data.
 * @property {{diskBytes: number}|null} swap - Swap in use, of which the swap on disk is read; null for no data.
 *
 * A Snapshot (lib/pulseSnapshots.js) is one, and so is lib/protocol.js parseEnvelopeConditionReadings's result.
 */

/** One held caption: lit at once, unlit after CAPTION_HOLD_SAMPLES false readings in a row or a missing one. */
class CaptionHold {
    /** Starts unlit. */
    constructor() {
        this._isLit = false;
        this._falseReadingsInARow = 0;
    }

    /** @returns {boolean} True while the caption is lit. */
    get isLit() {
        return this._isLit;
    }

    /**
     * Records one Sample's reading of the caption's condition.
     *
     * @param {boolean|null} isConditionHeld - The condition held on this Sample; null when its reading is missing.
     * @returns {void}
     */
    record(isConditionHeld) {
        if (isConditionHeld === null) {
            this.end();
            return;
        }
        if (isConditionHeld) {
            this._isLit = true;
            this._falseReadingsInARow = 0;
            return;
        }
        if (!this._isLit)
            return;
        this._falseReadingsInARow += 1;
        if (this._falseReadingsInARow >= CAPTION_HOLD_SAMPLES)
            this.end();
    }

    /**
     * Unlights the caption at once, whatever its hold.
     *
     * @returns {void}
     */
    end() {
        this._isLit = false;
        this._falseReadingsInARow = 0;
    }
}

/**
 * Whether a resource is waited on, from one Sample's pressure.
 *
 * @param {ConditionReadings} readings - The Sample's readings.
 * @param {string} pressureResource - 'cpu', 'memory' or 'io'.
 * @returns {boolean|null} The wait; null when the resource's reading is missing.
 */
function pressureWaitReading(readings, pressureResource) {
    const avg10Percent = readings.pressureAvg10?.[pressureResource] ?? null;
    return avg10Percent === null ? null : isPressureWait(avg10Percent);
}

export class MachineCaptionTracker {
    /** Starts with nothing recorded and nothing lit. */
    constructor() {
        this._swapGrowthWindow = new SwapGrowthWindow();
        this._holds = new Map(HELD_CAPTIONS.map(({caption}) => [caption, new CaptionHold()]));
        this._lastRecordedTakenAtUsec = null;
        this._isMachineStale = false;
        /** @type {ReadonlyArray<string>} */
        this._litCaptions = NO_LIT_CAPTIONS;
    }

    /**
     * The lit captions, in MachineCaption's order. The same list is returned until a caption lights or unlights, so a
     * caller can tell a change by identity.
     *
     * @returns {ReadonlyArray<string>} MachineCaption values; empty with nothing lit.
     */
    get litCaptions() {
        return this._litCaptions;
    }

    /**
     * Whether swap on disk grows now, with no hold: the card's amber "+ X on disk" line.
     *
     * @returns {boolean} True while Swapping.
     */
    get isSwapping() {
        return this._swapGrowthWindow.isSwapping;
    }

    /**
     * Records one Sample's readings: the swap window and every hold move on, and Machine stale ends. The Sample last
     * recorded, told again, changes nothing; readings that are null (a Sample with no snapshot) end every hold and
     * empty the swap window, so the next Sample starts it again.
     *
     * @param {ConditionReadings|null} readings - The Sample's readings, or null when it carried none.
     * @returns {void}
     */
    recordSample(readings) {
        this._isMachineStale = false;
        if (readings === null || readings === undefined) {
            this._swapGrowthWindow.clear();
            this._endEveryHold();
            this._lastRecordedTakenAtUsec = null;
            this._updateLitCaptions();
            return;
        }
        const takenAtUsec = readings.takenAtUsec ?? null;
        const isSameSampleAgain = takenAtUsec !== null && takenAtUsec === this._lastRecordedTakenAtUsec;
        this._lastRecordedTakenAtUsec = takenAtUsec;
        if (!isSameSampleAgain) {
            this._swapGrowthWindow.record(readings);
            this._recordHeldReadings(readings);
        }
        this._updateLitCaptions();
    }

    /**
     * Records that the sampler is silent: every hold ends at once, the swap window empties, and Machine stale lights
     * until the next Sample. The client calls it when its data stops being live.
     *
     * @returns {void}
     */
    recordNoData() {
        this._swapGrowthWindow.clear();
        this._endEveryHold();
        this._lastRecordedTakenAtUsec = null;
        this._isMachineStale = true;
        this._updateLitCaptions();
    }

    /**
     * Moves each held caption on by one Sample's reading.
     *
     * @param {ConditionReadings} readings - The Sample's readings.
     * @returns {void}
     */
    _recordHeldReadings(readings) {
        const hasSwapReading = Number.isFinite(readings.swap?.diskBytes) && Number.isFinite(readings.takenAtUsec);
        const swapReading = hasSwapReading ? this._swapGrowthWindow.isSwapping : null;
        for (const {caption, pressureResource} of HELD_CAPTIONS) {
            const reading = pressureResource === null ? swapReading : pressureWaitReading(readings, pressureResource);
            this._holds.get(caption).record(reading);
        }
    }

    /**
     * Unlights every held caption at once.
     *
     * @returns {void}
     */
    _endEveryHold() {
        for (const hold of this._holds.values())
            hold.end();
    }

    /**
     * Recomputes the lit captions, keeping the same list when nothing lit or unlit.
     *
     * @returns {void}
     */
    _updateLitCaptions() {
        const heldLitCaptions = HELD_CAPTIONS.map(({caption}) => caption)
            .filter(caption => this._holds.get(caption).isLit);
        const litCaptions = this._isMachineStale ? [...heldLitCaptions, MachineCaption.MACHINE_STALE] : heldLitCaptions;
        const isUnchanged = litCaptions.length === this._litCaptions.length &&
            litCaptions.every((caption, captionIndex) => caption === this._litCaptions[captionIndex]);
        if (isUnchanged)
            return;
        this._litCaptions = litCaptions.length === 0 ? NO_LIT_CAPTIONS : Object.freeze(litCaptions);
    }
}
