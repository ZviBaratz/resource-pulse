// The client's pressure histories (pulseClient.js): the sampler's five-minute history of the three PSI `some avg10`
// readings, cpu, memory and io, in percent, one value per fast tick, and whether the sampler publishes it at all.
//
// "Not published" is not "a gap". A sampler from before the pressure history writes none, and a Sample's missing
// pressure would otherwise read as a gap on every tick. So the client decides once, at each state, whether the
// sampler publishes the history (lib/protocol.js reads it as null when it does not), and while it does not, ignores
// pressure in every Sample and pushes no gap: the three histories stay empty, and isPublished says why. A sampler
// that changes version restarts, so its Samples number from 1 again and the client reads a fresh state before it
// draws another: the decision holds for every Sample between two states.
// Pure: no Gio and no Shell import, so it runs under plain gjs.
import {RingBuffer} from './history.js';

/** The three resources the kernel reports pressure for, in the order lib/protocol.js's pressureAvg10 lists them. */
const PRESSURE_RESOURCE_NAMES = Object.freeze(['cpu', 'memory', 'io']);

/** The three pressure histories of the client, and whether the sampler publishes them. */
export class PressureHistories {
    /**
     * Three empty histories, not published until a state says they are.
     *
     * @param {number} capacity - The values each keeps: lib/constants.js's CARD_HISTORY_SAMPLES.
     * @throws {Error} When the capacity is not a positive integer (RingBuffer).
     */
    constructor(capacity) {
        this._isPublished = false;
        this._historiesByResource = new Map(PRESSURE_RESOURCE_NAMES.map(resourceName =>
            [resourceName, new RingBuffer(capacity)]));
    }

    /**
     * @returns {boolean} True when the latest state carried the pressure history; false before any state and while
     *     the sampler does not publish it, when the three histories are empty and stay so.
     */
    get isPublished() {
        return this._isPublished;
    }

    /** @returns {RingBuffer} CPU pressure percents 0–100, null for a gap, oldest first. */
    get cpu() {
        return this._historiesByResource.get('cpu');
    }

    /** @returns {RingBuffer} Memory pressure percents 0–100, null for a gap, oldest first. */
    get memory() {
        return this._historiesByResource.get('memory');
    }

    /** @returns {RingBuffer} IO pressure percents 0–100, null for a gap, oldest first. */
    get io() {
        return this._historiesByResource.get('io');
    }

    /**
     * Takes a state's pressure histories whole, and with them whether the sampler publishes them.
     *
     * @param {import('./protocol.js').PressureHistories|null} statePressureHistories - parseStatePayload's
     *     histories.pressureAvg10: null when the sampler does not publish them, which empties all three; a list that
     *     is null empties its own history alone.
     * @returns {void}
     */
    replaceFromState(statePressureHistories) {
        this._isPublished = statePressureHistories !== null;
        for (const [resourceName, history] of this._historiesByResource) {
            history.clear();
            for (const value of statePressureHistories?.[resourceName] ?? [])
                history.push(value);
        }
    }

    /**
     * Appends what one Sample appended, while the sampler publishes the history; ignored while it does not.
     *
     * @param {{cpu: number|null, memory: number|null, io: number|null}|null} appendedPressure - The Sample's
     *     appendedHistory.pressureAvg10. Null from a sampler that publishes the history is a Sample it could not
     *     read, and is a gap in all three, so they stay as long as the CPU history.
     * @returns {void}
     */
    appendFromSample(appendedPressure) {
        if (!this._isPublished)
            return;
        for (const [resourceName, history] of this._historiesByResource)
            history.push(appendedPressure?.[resourceName] ?? null);
    }

    /**
     * Appends a gap to each history, while the sampler publishes them: the client's own, when it shows no data.
     *
     * @returns {void}
     */
    appendGap() {
        this.appendFromSample(null);
    }
}
