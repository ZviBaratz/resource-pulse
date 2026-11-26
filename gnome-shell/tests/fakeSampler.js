// The fake sampler the test double (serviceDouble.js) serves. It keeps its histories as the program keeps its own: each
// tick's publish appends one value to each, the three pressure histories included, after a gap in each for every tick
// it missed, and a reveal appends nothing, at lib/constants.js's CARD_HISTORY_SAMPLES. One made as a sampler from
// before the pressure history keeps none, and the double then serves its state as such a sampler's.
// A module of its own, registering no rows, so that both private-bus runners can import it.
import {RingBuffer} from '../extensions/resource-pulse@zvibaratz.github.io/lib/history.js';
import {CARD_HISTORY_SAMPLES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

/** What a missed tick pushes: a gap in every history. */
const GAP_IN_EVERY_HISTORY = Object.freeze({cpu: null, memory: null, pressureAvg10: null});

/** A sampler for the double to serve: the surface ResourcePulseServiceDouble uses, plus a publish() a row drives. */
export class FakeSampler {
    /**
     * @param {object} [options] - The sampler's kind.
     * @param {boolean} [options.isFromBeforePressureHistory] - True for a sampler from before the pressure history,
     *     which keeps none; false by default.
     */
    constructor({isFromBeforePressureHistory = false} = {}) {
        this.latestSnapshot = null;
        this.cpuHistory = new RingBuffer(CARD_HISTORY_SAMPLES);
        this.memoryHistory = new RingBuffer(CARD_HISTORY_SAMPLES);
        /**
         * The three pressure histories, in percent, by resource, in the order of the snapshot's pressureAvg10;
         * undefined for a sampler from before them.
         */
        this.pressureHistories = isFromBeforePressureHistory ? undefined : {
            cpu: new RingBuffer(CARD_HISTORY_SAMPLES),
            memory: new RingBuffer(CARD_HISTORY_SAMPLES),
            io: new RingBuffer(CARD_HISTORY_SAMPLES),
        };
        /** @type {boolean[]} Every setDetailWatched argument, in order. */
        this.detailWatchedCalls = [];
        this._listeners = new Map();
        this._nextListenerId = 1;
    }

    /** @returns {number} How many listeners are attached. */
    get listenerCount() {
        return this._listeners.size;
    }

    /**
     * @param {(snapshot: object, appendedHistory: object|null) => void} callback - Called on each publish.
     * @returns {number} An id for removeListener.
     */
    addListener(callback) {
        const listenerId = this._nextListenerId++;
        this._listeners.set(listenerId, callback);
        return listenerId;
    }

    /**
     * @param {number} listenerId - The id addListener returned.
     * @returns {void}
     */
    removeListener(listenerId) {
        this._listeners.delete(listenerId);
    }

    /**
     * Records the call.
     *
     * @param {boolean} isWatched - True while any client holds a watch.
     * @returns {void}
     */
    setDetailWatched(isWatched) {
        this.detailWatchedCalls.push(isWatched);
    }

    /**
     * Publishes as the real sampler does: a tick appends to the histories, first a gap in each for every tick it
     * missed, then its values; a reveal (appendedHistory null) appends nothing.
     *
     * @param {object} snapshot - The snapshot.
     * @param {{cpu: number|null, memory: number|null, pressureAvg10: object|null, missedTickCount: number}|null}
     *     appendedHistory - What this publish appended. A missing or null pressureAvg10 is a gap in each pressure
     *     history, and a missing missedTickCount is none.
     * @returns {void}
     */
    publish(snapshot, appendedHistory) {
        if (appendedHistory !== null) {
            const missedTickCount = appendedHistory.missedTickCount ?? 0;
            for (let gapIndex = 0; gapIndex < missedTickCount; gapIndex++)
                this._pushToEveryHistory(GAP_IN_EVERY_HISTORY);
            this._pushToEveryHistory(appendedHistory);
        }
        this.latestSnapshot = snapshot;
        for (const listener of [...this._listeners.values()])
            listener(snapshot, appendedHistory);
    }

    /**
     * Pushes one value into each history.
     *
     * @param {{cpu: number|null, memory: number|null, pressureAvg10: object|null}} values - The values; a missing or
     *     null pressureAvg10 is a gap in each pressure history.
     * @returns {void}
     */
    _pushToEveryHistory(values) {
        this.cpuHistory.push(values.cpu);
        this.memoryHistory.push(values.memory);
        for (const [resourceName, history] of Object.entries(this.pressureHistories ?? {}))
            history.push(values.pressureAvg10?.[resourceName] ?? null);
    }
}
