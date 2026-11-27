// The monitor tile's agents track, recorded: how many sessions were working, and which were blocked, at each Sample of
// the last five minutes. Pure: no GObject, no signal, no timer, so it can be kept across a disable as plain data.
//
// - One slot per Sample, as the pulse client's histories gain one: a timed Sample appends as many slots as its time
//   since the last timed Sample counts intervals (appendedSlotCount), less the no-data slots appended in between; all
//   but the last are empty. So a sampler's silence, and a lock across which nothing was told, become empty slots, and
//   the slots stand where the histories' do. A Sample told again appends none.
// - Cells group five slots from the newest, as lib/pressureStrip.js groups the strips' Samples, so a cell stands under
//   the strips' moments. A history shorter than the strip is empty on its left.
// - A slot holds the most sessions seen working while it was the newest, and the keys of every session seen blocked
//   then. A cell's cap is ongoing while one of those sessions is blocked now, ended once none is, none without one.
// - Across a disable each slot keeps what slotKeptAcrossDisable keeps: its session keys, by default
//   (AGENTS_TRACK_KEPT_ACROSS_DISABLE), or only its cap as it stood. Nothing is written anywhere: the recorder lives in
//   the shell's memory for the session and is gone at a logout or a restart.
import {
    CARD_HISTORY_SAMPLES, CockpitClientState, MICROSECONDS_PER_SECOND, SAMPLE_INTERVAL_SECONDS,
} from './constants.js';
import {PRESSURE_STRIP_SAMPLES_PER_CELL} from './pressureStrip.js';

/** Samples to a cell: the strips' own. */
export const AGENTS_TRACK_SAMPLES_PER_CELL = PRESSURE_STRIP_SAMPLES_PER_CELL;
/** Cells in the track: the plot's Samples, five to a cell. */
export const AGENTS_TRACK_CELL_COUNT = CARD_HISTORY_SAMPLES / AGENTS_TRACK_SAMPLES_PER_CELL;
const SAMPLE_INTERVAL_USEC = SAMPLE_INTERVAL_SECONDS * MICROSECONDS_PER_SECOND;
const WORKING_STATE = 'working';
const BLOCKED_STATE = 'blocked';

/** A cell's cap. */
export const CapState = Object.freeze({
    /** No session was blocked in the cell. */
    NONE: 'none',
    /** A session blocked in the cell is blocked now: amber. */
    ONGOING: 'ongoing',
    /** Every session blocked in the cell has moved on, or is gone: neutral. */
    ENDED: 'ended',
});

/** What a slot keeps across a disable. */
export const KeptAcrossDisable = Object.freeze({
    /** Its blocked sessions' keys, so its cap says after the enable whether that wait goes on. */
    SESSION_KEYS: 'session-keys',
    /** Only its cap as it stood at the disable, and no key. */
    CAP_STATE: 'cap-state',
});

/** What every slot keeps across a disable: the one place to change it. */
export const AGENTS_TRACK_KEPT_ACROSS_DISABLE = KeptAcrossDisable.SESSION_KEYS;

const NO_BLOCKED_SESSION_KEYS = Object.freeze(new Set());

/**
 * @typedef {object} AgentsSlot
 * @property {number|null} workingCount - The most sessions working while it was the newest; null for none told.
 * @property {ReadonlySet<string>} blockedSessionKeys - The sessions seen blocked then.
 * @property {string} [keptCapState] - Its cap as it stood at a disable, where only that was kept (a CapState value).
 */

/**
 * @typedef {object} SessionsReading
 * @property {number} workingCount - Sessions working now.
 * @property {string[]} blockedSessionKeys - The keys of the sessions blocked now.
 */

/**
 * @typedef {object} AgentsCell
 * @property {number|null} workingCount - The most working in its five slots; null where none was told.
 * @property {string} capState - A CapState value.
 */

/**
 * The slots the client's histories gained at a timed Sample: none for a Sample told again (no time since the last),
 * one for the first; otherwise the Sample's own and an empty one for each interval it missed, less the no-data slots
 * appended since the last timed Sample, and never more than the plot holds. A time before the last counts one.
 *
 * @param {object} times - The times.
 * @param {number|null} times.lastTimedSampleAtUsec - The last timed Sample's takenAtUsec; null before the first.
 * @param {number} times.takenAtUsec - This Sample's takenAtUsec (monotonic, as the sampler's).
 * @param {number} times.untimedSlotCount - The no-data slots appended since the last timed Sample.
 * @returns {number} Slots to append, 0 to CARD_HISTORY_SAMPLES.
 */
export function appendedSlotCount({lastTimedSampleAtUsec, takenAtUsec, untimedSlotCount}) {
    if (lastTimedSampleAtUsec === null)
        return 1;
    const elapsedUsec = takenAtUsec - lastTimedSampleAtUsec;
    if (elapsedUsec < 0)
        return 1;
    const elapsedIntervalCount = Math.round(elapsedUsec / SAMPLE_INTERVAL_USEC);
    if (elapsedIntervalCount === 0)
        return 0;
    const missedSlotCount = Math.max(0, elapsedIntervalCount - 1 - untimedSlotCount);
    return Math.min(CARD_HISTORY_SAMPLES, 1 + missedSlotCount);
}

/**
 * A slot's cap against the sessions blocked now; a cap kept at a disable stays as it was.
 *
 * @param {AgentsSlot} slot - The slot.
 * @param {ReadonlySet<string>} blockedSessionKeysNow - The sessions blocked now.
 * @returns {string} A CapState value.
 */
function slotCapState(slot, blockedSessionKeysNow) {
    if (slot.keptCapState !== undefined)
        return slot.keptCapState;
    if (slot.blockedSessionKeys.size === 0)
        return CapState.NONE;
    for (const sessionKey of slot.blockedSessionKeys) {
        if (blockedSessionKeysNow.has(sessionKey))
            return CapState.ONGOING;
    }
    return CapState.ENDED;
}

/**
 * What a slot keeps across a disable: the slot as it is, with its keys (SESSION_KEYS); or its count and its cap as it
 * stands against the sessions blocked at the disable, with no key (CAP_STATE).
 *
 * @param {AgentsSlot} slot - The slot.
 * @param {ReadonlySet<string>} blockedSessionKeysNow - The sessions blocked at the disable.
 * @param {string} [keptAcrossDisable] - A KeptAcrossDisable value; AGENTS_TRACK_KEPT_ACROSS_DISABLE by default.
 * @returns {AgentsSlot} What it keeps.
 */
export function slotKeptAcrossDisable(slot, blockedSessionKeysNow, keptAcrossDisable = AGENTS_TRACK_KEPT_ACROSS_DISABLE) {
    if (keptAcrossDisable === KeptAcrossDisable.SESSION_KEYS)
        return slot;
    return {
        workingCount: slot.workingCount,
        blockedSessionKeys: NO_BLOCKED_SESSION_KEYS,
        keptCapState: slotCapState(slot, blockedSessionKeysNow),
    };
}

/**
 * The cap of a cell's slots: ongoing if one is, else ended if one is, else none.
 *
 * @param {string[]} slotCapStates - Each slot's CapState value.
 * @returns {string} A CapState value.
 */
function cellCapState(slotCapStates) {
    if (slotCapStates.includes(CapState.ONGOING))
        return CapState.ONGOING;
    return slotCapStates.includes(CapState.ENDED) ? CapState.ENDED : CapState.NONE;
}

/**
 * The cockpit's sessions source, while it can be read: the cockpit client live and the source not stale.
 *
 * @param {object} cockpit - What the cockpit client holds.
 * @param {string} cockpit.clientState - Its CockpitClientState value.
 * @param {object|null} cockpit.sessionsSource - Its sessions source (sourcesByName.sessions); null before the first.
 * @param {boolean} cockpit.isStale - The source reads stale (sourceFreshness('sessions').isStale).
 * @returns {object|null} The source; null before the cockpit service's first answer, with the service gone, or stale.
 */
export function cockpitSessionsSource({clientState, sessionsSource, isStale}) {
    if (clientState !== CockpitClientState.LIVE || isStale)
        return null;
    return sessionsSource ?? null;
}

/**
 * The count the agents track's present shows: the sessions working; none while herdr is not running, though the
 * cells count 0 then (sessionsReading), since no session can be working.
 *
 * @param {{herdrRunning: boolean, rows: Array<{state: string}>}|null} sessionsSource - The source (cockpitSessionsSource).
 * @returns {number|null} The count; null with no source or herdr not running.
 */
export function presentWorkingCount(sessionsSource) {
    if (sessionsSource === null || !sessionsSource.herdrRunning)
        return null;
    return sessionsReading(sessionsSource).workingCount;
}

/**
 * The reading the recorder is told from the cockpit's sessions source: the rows working, and the keys (each row's id)
 * of those blocked. With herdr not running nothing is working. A state it does not know counts as neither.
 *
 * @param {{herdrRunning: boolean, rows: Array<{id: string, state: string}>}|null} sessionsSource - The source, or
 *     null while there is none to read (before the first answer, the service gone, the source stale).
 * @returns {SessionsReading|null} The reading; null with no source.
 */
export function sessionsReading(sessionsSource) {
    if (sessionsSource === null)
        return null;
    if (!sessionsSource.herdrRunning)
        return {workingCount: 0, blockedSessionKeys: []};
    const rows = sessionsSource.rows;
    return {
        workingCount: rows.filter(row => row.state === WORKING_STATE).length,
        blockedSessionKeys: rows.filter(row => row.state === BLOCKED_STATE).map(row => row.id),
    };
}

/**
 * Whether two tracks' cells read the same, cell for cell, so a track whose cells did not change need not be redrawn.
 *
 * @param {AgentsCell[]} cells - One track's cells.
 * @param {AgentsCell[]} otherCells - The other's.
 * @returns {boolean} True where every count and cap is the same.
 */
export function areAgentsCellsEqual(cells, otherCells) {
    return cells.length === otherCells.length && cells.every((cell, cellIndex) =>
        cell.workingCount === otherCells[cellIndex].workingCount && cell.capState === otherCells[cellIndex].capState);
}

/**
 * A slot with nothing told: no count, no blocked session.
 *
 * @returns {AgentsSlot} The slot.
 */
function emptySlot() {
    return {workingCount: null, blockedSessionKeys: NO_BLOCKED_SESSION_KEYS};
}

/**
 * The recorder: told each reading of the sessions source and each Sample, it gives the track's thirty cells.
 */
export class AgentsTrackRecorder {
    /**
     * @param {object} [options] - The recorder's options.
     * @param {string} [options.keptAcrossDisable] - A KeptAcrossDisable value; AGENTS_TRACK_KEPT_ACROSS_DISABLE by
     *     default.
     */
    constructor({keptAcrossDisable = AGENTS_TRACK_KEPT_ACROSS_DISABLE} = {}) {
        this._keptAcrossDisable = keptAcrossDisable;
        /** @type {AgentsSlot[]} Oldest first, at most CARD_HISTORY_SAMPLES. */
        this._slots = [];
        /** @type {SessionsReading|null} The latest reading; null while none is known. */
        this._latestReading = null;
        this._latestBlockedSessionKeys = NO_BLOCKED_SESSION_KEYS;
        /** Whether a reading counts in the newest slot: only in a timed Sample's own slot, until a disable. */
        this._isNewestSlotOpen = false;
        this._lastTimedSampleAtUsec = null;
        this._untimedSlotCount = 0;
    }

    /** @returns {number} The slots held, at most CARD_HISTORY_SAMPLES. */
    get slotCount() {
        return this._slots.length;
    }

    /**
     * Takes a reading of the sessions source: the latest from here on, and counted in the newest slot while it is open
     * (the most working, every session blocked).
     *
     * @param {SessionsReading|null} reading - The reading (sessionsReading); null while none is known.
     * @returns {void}
     */
    recordSessions(reading) {
        this._latestReading = reading;
        this._latestBlockedSessionKeys = reading === null ? NO_BLOCKED_SESSION_KEYS : new Set(reading.blockedSessionKeys);
        if (reading === null || !this._isNewestSlotOpen)
            return;
        const newestSlot = this._slots.at(-1);
        const workingCount = newestSlot.workingCount === null
            ? reading.workingCount : Math.max(newestSlot.workingCount, reading.workingCount);
        this._slots[this._slots.length - 1] = {
            workingCount,
            blockedSessionKeys: new Set([...newestSlot.blockedSessionKeys, ...reading.blockedSessionKeys]),
        };
    }

    /**
     * Takes a Sample the pulse client told: a no-data one (no time) appends an empty slot; a timed one appends the
     * slots appendedSlotCount gives, the last its own, from the latest reading.
     *
     * @param {number|null} takenAtUsec - The Sample's takenAtUsec; null for a no-data Sample.
     * @returns {void}
     */
    recordSample(takenAtUsec) {
        if (takenAtUsec === null) {
            this._appendSlot(emptySlot());
            this._untimedSlotCount++;
            this._isNewestSlotOpen = false;
            return;
        }
        const slotCount = appendedSlotCount({
            lastTimedSampleAtUsec: this._lastTimedSampleAtUsec, takenAtUsec, untimedSlotCount: this._untimedSlotCount,
        });
        this._lastTimedSampleAtUsec = takenAtUsec;
        this._untimedSlotCount = 0;
        if (slotCount === 0)
            return;
        for (let emptySlotIndex = 0; emptySlotIndex < slotCount - 1; emptySlotIndex++)
            this._appendSlot(emptySlot());
        this._appendSlot(this._latestReadingSlot());
        this._isNewestSlotOpen = true;
    }

    /**
     * Readies the recorder to be kept across a disable: each slot becomes what slotKeptAcrossDisable keeps, the newest
     * is closed (no reading after the disable counts in it), and the latest reading is forgotten, since nothing is
     * known of the sessions until the next enable's first answer. The last timed Sample's time is kept, so the first
     * Sample after the enable counts the time between as empty slots.
     *
     * @returns {void}
     */
    holdAcrossDisable() {
        this._slots = this._slots.map(slot =>
            slotKeptAcrossDisable(slot, this._latestBlockedSessionKeys, this._keptAcrossDisable));
        this._isNewestSlotOpen = false;
        this._latestReading = null;
        this._latestBlockedSessionKeys = NO_BLOCKED_SESSION_KEYS;
    }

    /**
     * The track's cells, oldest first: five slots each, grouped from the newest, each the most working in its slots
     * and its cap against the sessions blocked now; the cells older than the history are empty.
     *
     * @returns {AgentsCell[]} AGENTS_TRACK_CELL_COUNT cells.
     */
    cells() {
        // The slots older than the history: empty, so a short history fills the track from its right.
        const emptySlotCount = CARD_HISTORY_SAMPLES - this._slots.length;
        return Array.from({length: AGENTS_TRACK_CELL_COUNT}, (_unused, cellIndex) => {
            let workingCount = null;
            const slotCapStates = [];
            for (let slotInCell = 0; slotInCell < AGENTS_TRACK_SAMPLES_PER_CELL; slotInCell++) {
                const slot = this._slots[cellIndex * AGENTS_TRACK_SAMPLES_PER_CELL + slotInCell - emptySlotCount];
                if (slot === undefined)
                    continue;
                if (slot.workingCount !== null)
                    workingCount = Math.max(workingCount ?? 0, slot.workingCount);
                slotCapStates.push(slotCapState(slot, this._latestBlockedSessionKeys));
            }
            return {workingCount, capState: cellCapState(slotCapStates)};
        });
    }

    /**
     * A slot from the latest reading: its count and its blocked sessions; empty while none is known.
     *
     * @returns {AgentsSlot} The slot.
     */
    _latestReadingSlot() {
        if (this._latestReading === null)
            return emptySlot();
        return {workingCount: this._latestReading.workingCount, blockedSessionKeys: this._latestBlockedSessionKeys};
    }

    /**
     * Appends a slot, dropping the oldest beyond CARD_HISTORY_SAMPLES.
     *
     * @param {AgentsSlot} slot - The slot.
     * @returns {void}
     */
    _appendSlot(slot) {
        this._slots.push(slot);
        if (this._slots.length > CARD_HISTORY_SAMPLES)
            this._slots.splice(0, this._slots.length - CARD_HISTORY_SAMPLES);
    }
}
