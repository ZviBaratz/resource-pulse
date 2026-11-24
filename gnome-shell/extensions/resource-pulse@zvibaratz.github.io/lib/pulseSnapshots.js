// The pure snapshot and data-state helpers of the extension's client (pulseClient.js): what the client knows of the
// service's data, the snapshot it publishes, and the small decisions it takes on a state and a Sample (a sequence
// restart, a state's freshness, what is left of the stall, whether a snapshot or a Sample has numbers).
// Pure: no Gio and no Shell import, so it runs under plain gjs.
import {SAMPLE_STALL_MS} from './constants.js';

/** Microseconds in a millisecond: a state's age is in microseconds, the watchdog's interval in milliseconds. */
const USEC_PER_MILLISECOND = 1000;
/**
 * The shortest the stall watchdog is armed for: a state exactly as old as the stall is still drawn (it is not stale
 * yet), and nothing of the stall is left, so its watchdog fires at once.
 */
const MIN_STALL_WATCHDOG_MS = 1;

/** What the client knows of the service's data. */
export const DataState = Object.freeze({
    /** No state since the start, since the owner last appeared, or since the sequence restarted: Samples wait. */
    AWAITING_STATE: 'awaiting state',
    /** Drawing every Sample. */
    LIVE: 'live',
    /** No Sample for too long: no data shown; the next Sample of the same run draws again. */
    STALLED: 'stalled',
});

/**
 * A snapshot as the client publishes it: lib/protocol.js's Snapshot as its parseSnapshot reads it, so each field is of
 * its type or null (missing from a service of another version, or mistyped), and only its own row shows no data. The
 * client's own no-data snapshot has every number null and apps null.
 *
 * @typedef {object} Snapshot
 * @property {number|null} takenAtUsec - The service's monotonic time of the sample.
 * @property {string|null} takenAtClockLabel - Wall-clock 'HH:MM' of the sample.
 * @property {number|null} cpuBusyPercent - Whole-machine CPU busy, 0–100.
 * @property {{performancePercent: number|null, efficiencyPercent: number|null}|null} cpuClusters - Busy percent per
 *     core type.
 * @property {{usedBytes: number, totalBytes: number}|null} memory - Memory in use, and in all.
 * @property {{zramUsedBytes: number, zramRamBytes: number, diskBytes: number}|null} swap - Swap in use.
 * @property {{cpu: number|null, memory: number|null, io: number|null}|null} pressureAvg10 - PSI `some avg10`
 *     percents.
 * @property {{topCpu: object|null, topMemory: object|null}|null} apps - The app ranking.
 * @property {boolean|null} isComplete - True when every read of the sample succeeded.
 */

/**
 * Says whether a Sample's sequence shows that the service restarted: it is not past the last one applied. A sequence
 * that either side lacks (a version without one) shows nothing.
 *
 * @param {number|null} lastAppliedSequence - The sequence of the last Sample drawn, or of the state.
 * @param {number|null} sampleSequence - The new Sample's sequence.
 * @returns {boolean} True for a restart.
 */
export function isSequenceRestart(lastAppliedSequence, sampleSequence) {
    return lastAppliedSequence !== null && sampleSequence !== null && sampleSequence <= lastAppliedSequence;
}

/**
 * When a state's data was fresh: its snapshot's own time, on the monotonic clock the service and the client share, so
 * a state served by a service whose sampler has stopped is as old as its snapshot. A snapshot with no time counts from
 * now (its arrival), and one stamped in the future from now.
 *
 * @param {Snapshot|null} snapshot - The state's snapshot.
 * @param {number} nowUsec - Monotonic microseconds now.
 * @returns {number} Monotonic microseconds.
 */
export function freshnessOfStateSnapshot(snapshot, nowUsec) {
    const takenAtUsec = snapshot?.takenAtUsec ?? null;
    return takenAtUsec === null ? nowUsec : Math.min(takenAtUsec, nowUsec);
}

/**
 * What is left of the stall for data of a given age, for the watchdog a state arms: SAMPLE_STALL_MS less the age,
 * rounded up to a whole millisecond so the watchdog never fires before the stall, and at least MIN_STALL_WATCHDOG_MS.
 *
 * @param {number} dataAgeUsec - How old the data is, in microseconds: from 0 to the stall (older data is stale, and
 *     arms no watchdog).
 * @returns {number} Whole milliseconds, from MIN_STALL_WATCHDOG_MS to SAMPLE_STALL_MS.
 */
export function stallRemainderMs(dataAgeUsec) {
    const stallRemainderUsec = SAMPLE_STALL_MS * USEC_PER_MILLISECOND - dataAgeUsec;
    const roundedUpRemainderMs = Math.ceil(stallRemainderUsec / USEC_PER_MILLISECOND);
    return Math.max(MIN_STALL_WATCHDOG_MS, roundedUpRemainderMs);
}

/**
 * Says whether a snapshot has the numbers "no data since" counts from: CPU or memory.
 *
 * @param {Snapshot|null} snapshot - A snapshot.
 * @returns {boolean} True when it has either.
 */
export function hasNumbers(snapshot) {
    return snapshot !== null && (snapshot.cpuBusyPercent !== null || snapshot.memory !== null);
}

/**
 * Says whether a Sample appended a number to either history. One that did comes from a sample with numbers, so the
 * unread snapshot it replaces need not be parsed for "no data since"; one that did not (a numberless sample, or a
 * reveal) may come from a service whose sampling fails.
 *
 * @param {{cpu: number|null, memory: number|null}|null} appendedHistory - What the Sample appended; null for nothing.
 * @returns {boolean} True when it appended a CPU or a memory value.
 */
export function hasAppendedNumber(appendedHistory) {
    return appendedHistory !== null && (appendedHistory.cpu !== null || appendedHistory.memory !== null);
}

/**
 * The snapshot the client publishes when it has no fresh data: every number null, no ranking.
 *
 * @returns {Snapshot} A new one each time.
 */
export function noDataSnapshot() {
    return {
        takenAtUsec: null,
        takenAtClockLabel: null,
        cpuBusyPercent: null,
        cpuClusters: null,
        memory: null,
        swap: null,
        pressureAvg10: {cpu: null, memory: null, io: null},
        apps: null,
        isComplete: false,
    };
}

/**
 * Replaces a history with the values a state carried.
 *
 * @param {import('./history.js').RingBuffer} history - The client's history.
 * @param {Array<number|null>|null} values - The state's, oldest first; null (none sent) empties the history.
 * @returns {void}
 */
export function replaceHistory(history, values) {
    history.clear();
    for (const value of values ?? [])
        history.push(value);
}
