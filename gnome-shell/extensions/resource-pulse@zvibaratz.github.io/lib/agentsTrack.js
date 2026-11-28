// The monitor tile's agents track, recorded: how many sessions were working, and which were blocked, at each Sample of
// the last five minutes. Pure: no GObject, no signal, no timer, so it can be kept across a disable as plain data.
//
// - One slot per Sample, as the pulse client's histories gain them, told what the histories did
//   (pulseClient.js newestHistoryChange): a Sample appends the slots the client appended, a gap for each tick the
//   sampler says it missed (a stall, or a suspend) and its own; no data appends one empty slot. A state replaces the
//   histories with the service's, which hold no no-data gap of the client's, so it takes back the no-data slots since
//   the last Sample and appends the sampler's intervals since then (stateIntervalCount). Where no Sample was told (a
//   lock, or the service gone) those are counted from the Samples' real time as resource-pulse-sampler's
//   missed_ticks.rs counts a suspend: whole intervals, floored, with the remainder carried to the next count, a
//   remainder each Sample told leaves included (carriedAfterSample). Where that time is not known, every kept slot is
//   pushed out. All but a Sample's or a fresh state's own slot are empty, so the slots stand where the histories' do:
//   exactly, but where a tick runs later in its slot than the ticks before it, or the wall clock is stepped, by more
//   than WALL_CLOCK_TOLERANCE_USEC, or a suspend's remainder falls within it of a whole interval (a slot either way).
// - Cells group five slots from the newest, as lib/pressureStrip.js groups the strips' Samples, so a cell stands under
//   the strips' moments. A history shorter than the strip is empty on its left.
// - A slot holds the most sessions seen working while it was the newest, and the keys of every session seen blocked
//   then. A cell's cap is ongoing while one of those sessions is blocked now, ended once none is, none without one.
//   "Now" is the latest reading's: herdr not running is a reading (none blocked, so every wait ends), but no reading
//   (the cockpit service gone, or its sessions source stale, or a disable until the next enable's first answer)
//   judges nothing, and each cap keeps what it last showed until a reading comes back.
// - Across a disable each slot keeps what slotKeptAcrossDisable keeps: its session keys, by default
//   (AGENTS_TRACK_KEPT_ACROSS_DISABLE), or only its cap as it stood. Nothing is written anywhere: the recorder lives in
//   the shell's memory for the session and is gone at a logout or a restart.
import {
    CARD_HISTORY_SAMPLES, CockpitClientState, MICROSECONDS_PER_SECOND, SAMPLE_INTERVAL_SECONDS,
} from './constants.js';
import {PRESSURE_STRIP_SAMPLES_PER_CELL} from './pressureStrip.js';
import {HistoryChangeKind} from './pulseSnapshots.js';

/** Samples to a cell: the strips' own. */
export const AGENTS_TRACK_SAMPLES_PER_CELL = PRESSURE_STRIP_SAMPLES_PER_CELL;
/** Cells in the track: the plot's Samples, five to a cell. */
export const AGENTS_TRACK_CELL_COUNT = CARD_HISTORY_SAMPLES / AGENTS_TRACK_SAMPLES_PER_CELL;
const SAMPLE_INTERVAL_USEC = SAMPLE_INTERVAL_SECONDS * MICROSECONDS_PER_SECOND;
/**
 * How much earlier in its slot a state's latest Sample may stand than the time carried says, and still count its
 * interval: a tick that runs a little earlier in its slot than the ticks before it, and the wall clock's slew over a
 * lock, are absorbed; the cost is that a suspend whose remainder falls within it of a whole interval counts one more.
 */
export const WALL_CLOCK_TOLERANCE_USEC = 100_000;
/** The most a remainder carried can be: just under one interval. */
const MOST_CARRIED_USEC = SAMPLE_INTERVAL_USEC - 1;
/** A state's count, and the carry, where the time between is not known. */
const UNKNOWN_INTERVAL_COUNT = Object.freeze({intervalCount: null, carriedUsec: 0});
const WORKING_STATE = 'working';
/** The cockpit's sessions source, by its name among the cockpit client's sources. */
const SESSIONS_SOURCE_NAME = 'sessions';
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
 * A remainder to carry: the time carried and elapsed less the intervals counted, kept within 0 and just under one
 * interval.
 *
 * @param {number} remainderUsec - The time carried and elapsed, less the intervals counted.
 * @returns {number} The remainder to carry, in microseconds.
 */
function clampedCarryUsec(remainderUsec) {
    return Math.min(MOST_CARRIED_USEC, Math.max(0, remainderUsec));
}

/**
 * The sampler's intervals between the last Sample told and a state's latest, from their real times, as
 * resource-pulse-sampler's missed_ticks.rs counts a suspend: the whole intervals in the time between and the remainder
 * carried from before (with WALL_CLOCK_TOLERANCE_USEC), floored, and the new remainder to carry. None for a state told
 * again (no time between). Unknown (null, carrying nothing) where either time cannot be read or the clock went back:
 * nothing kept can be placed.
 *
 * @param {object} times - The times.
 * @param {number|null} times.lastSampledAtUsec - The real time of the last Sample or state told; null before the first.
 * @param {number|null} times.sampledAtUsec - The state's latestSampledAtUsec (real time); null where not readable.
 * @param {number} times.carriedUsec - The remainder carried from before.
 * @returns {{intervalCount: number|null, carriedUsec: number}} The intervals, uncapped, and the remainder to carry.
 */
export function stateIntervalCount({lastSampledAtUsec, sampledAtUsec, carriedUsec}) {
    if (lastSampledAtUsec === null || sampledAtUsec === null)
        return UNKNOWN_INTERVAL_COUNT;
    const elapsedUsec = sampledAtUsec - lastSampledAtUsec;
    if (elapsedUsec < 0)
        return UNKNOWN_INTERVAL_COUNT;
    if (elapsedUsec === 0)
        return {intervalCount: 0, carriedUsec};
    const countedUsec = carriedUsec + elapsedUsec;
    const intervalCount = Math.floor((countedUsec + WALL_CLOCK_TOLERANCE_USEC) / SAMPLE_INTERVAL_USEC);
    return {intervalCount, carriedUsec: clampedCarryUsec(countedUsec - intervalCount * SAMPLE_INTERVAL_USEC)};
}

/**
 * The remainder a Sample told leaves to carry: the time carried and elapsed since the last Sample or state told, less
 * the intervals the sampler counted (its sampledIntervalCount). Nothing where either time or the count cannot be read.
 *
 * @param {object} sample - The Sample.
 * @param {number|null} sample.lastSampledAtUsec - The real time of the last Sample or state told; null before the first.
 * @param {number|null} sample.sampledAtUsec - The Sample's real time; null where not readable.
 * @param {number} sample.carriedUsec - The remainder carried from before.
 * @param {number|null} sample.intervalCount - The sampler's intervals since its previous Sample, its own included.
 * @returns {number} The remainder to carry, in microseconds.
 */
export function carriedAfterSample({lastSampledAtUsec, sampledAtUsec, carriedUsec, intervalCount}) {
    if (lastSampledAtUsec === null || sampledAtUsec === null || !Number.isInteger(intervalCount))
        return 0;
    return clampedCarryUsec(carriedUsec + sampledAtUsec - lastSampledAtUsec - intervalCount * SAMPLE_INTERVAL_USEC);
}

/**
 * The slots a Sample appended, as the client counted them (its gaps and its own), at least its own and never more than
 * the plot holds; one for a count that cannot be read.
 *
 * @param {number|null} appendedSlotCount - The change's appendedSlotCount.
 * @returns {number} Slots to append, 1 to CARD_HISTORY_SAMPLES.
 */
function sampleAppendedSlotCount(appendedSlotCount) {
    if (!Number.isInteger(appendedSlotCount) || appendedSlotCount < 1)
        return 1;
    return Math.min(CARD_HISTORY_SAMPLES, appendedSlotCount);
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
 * cells count 0 then (sessionsReading), since no session can be working; none where there is no reading.
 *
 * @param {{herdrRunning: boolean|null, rows: Array<{state: string}>|null}|null} sessionsSource - The source
 *     (cockpitSessionsSource).
 * @returns {number|null} The count; null with no source, no reading or herdr not running.
 */
export function presentWorkingCount(sessionsSource) {
    if (sessionsSource === null || sessionsSource.herdrRunning !== true)
        return null;
    return sessionsReading(sessionsSource)?.workingCount ?? null;
}

/**
 * The reading the recorder is told from the cockpit's sessions source: the rows working, and the keys (each row's id)
 * of those blocked. With herdr not running nothing is working. A state it does not know counts as neither. A source
 * the client kept with herdr's state unread (herdrRunning null) or, herdr running, with no rows list (rows null, as
 * lib/cockpitProtocol.js keeps one that is not a list) is no reading, never a throw.
 *
 * @param {{herdrRunning: boolean|null, rows: Array<{id: string, state: string}>|null}|null} sessionsSource - The
 *     source, or null while there is none to read (before the first answer, the service gone, the source stale).
 * @returns {SessionsReading|null} The reading; null with no source, or none that can be read.
 */
export function sessionsReading(sessionsSource) {
    if (sessionsSource === null)
        return null;
    if (sessionsSource.herdrRunning === false)
        return {workingCount: 0, blockedSessionKeys: []};
    const rows = sessionsSource.rows;
    if (sessionsSource.herdrRunning !== true || !Array.isArray(rows))
        return null;
    return {
        workingCount: rows.filter(row => row.state === WORKING_STATE).length,
        blockedSessionKeys: rows.filter(row => row.state === BLOCKED_STATE).map(row => row.id),
    };
}

/**
 * The reading the recorder is told of what the cockpit client holds now: its sessions source while the client is
 * live and the source not stale (cockpitSessionsSource), read as sessionsReading reads it. The client keeps the
 * sessions current while nothing of the cockpit is seen (its Changed subscription is held from enable to disable), so
 * a reading told at each of its events is the sessions as they are, covered or not.
 *
 * @param {{state: string, sourcesByName: object, sourceFreshness: function(string): {isStale: boolean}}} cockpitClient
 *     - The cockpit client (cockpitClient.js CockpitClient).
 * @returns {SessionsReading|null} The reading; null where the client holds none that can be read.
 */
export function cockpitClientSessionsReading(cockpitClient) {
    const sessionsSource = cockpitSessionsSource({
        clientState: cockpitClient.state, sessionsSource: cockpitClient.sourcesByName[SESSIONS_SOURCE_NAME],
        isStale: cockpitClient.sourceFreshness(SESSIONS_SOURCE_NAME).isStale,
    });
    return sessionsReading(sessionsSource);
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
 * A slot with nothing told: no count, no blocked session. One frozen slot stands for every empty one, since slots are
 * replaced and never changed in place, so a user with no cockpit allocates no slot a Sample.
 *
 * @type {AgentsSlot}
 */
const EMPTY_SLOT = Object.freeze({workingCount: null, blockedSessionKeys: NO_BLOCKED_SESSION_KEYS});

/**
 * Whether two readings say the same: both none, or the same count and the same blocked keys in the same order.
 *
 * @param {SessionsReading|null} reading - One reading.
 * @param {SessionsReading|null} otherReading - The other.
 * @returns {boolean} True where they say the same.
 */
function isSameReading(reading, otherReading) {
    if (reading === null || otherReading === null)
        return reading === otherReading;
    const {blockedSessionKeys} = reading;
    return reading.workingCount === otherReading.workingCount &&
        blockedSessionKeys.length === otherReading.blockedSessionKeys.length &&
        blockedSessionKeys.every((sessionKey, keyIndex) => sessionKey === otherReading.blockedSessionKeys[keyIndex]);
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
        /** Whether a reading counts in the newest slot: only in a Sample's or a fresh state's own, until a disable. */
        this._isNewestSlotOpen = false;
        /** The real time of the last Sample or state told; null before the first, or where it was not readable. */
        this._lastSampledAtUsec = null;
        /** The remainder of the sampler's intervals carried to the next count, as the sampler carries a suspend's. */
        this._carriedUsec = 0;
        /** The no-data slots since the last Sample or state: the newest slots, which a state takes back. */
        this._trailingNoDataSlotCount = 0;
    }

    /** @returns {number} The slots held, at most CARD_HISTORY_SAMPLES. */
    get slotCount() {
        return this._slots.length;
    }

    /**
     * Takes a reading of the sessions source: the latest from here on, and counted in the newest slot while it is open
     * (the most working, every session blocked). A reading the same as the latest changes nothing and builds nothing:
     * the newest slot already counts it, since it was built from the latest reading or has taken it since. No reading
     * leaves the sessions blocked as last read, so every cap keeps what it showed until a reading comes back.
     *
     * @param {SessionsReading|null} reading - The reading (sessionsReading); null while none is known.
     * @returns {void}
     */
    recordSessions(reading) {
        if (isSameReading(reading, this._latestReading))
            return;
        this._latestReading = reading;
        // No reading says nothing of who is blocked now: the caps stay as they were judged last.
        if (reading === null)
            return;
        this._latestBlockedSessionKeys = new Set(reading.blockedSessionKeys);
        if (!this._isNewestSlotOpen)
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
     * Takes what the pulse client's histories did at a history notification (pulseClient.js newestHistoryChange): a
     * Sample's slots, the last its own from the latest reading, and the remainder it leaves to carry; at a state, the
     * no-data slots since the last Sample taken back and the sampler's intervals since it appended
     * (stateIntervalCount), the last its own, or empty for a stale state, which then appends its no data's empty
     * slot; no data's empty slot. A change that cannot be read appends nothing.
     *
     * @param {import('./pulseSnapshots.js').HistoryChange|null} historyChange - The change.
     * @returns {void}
     */
    recordHistoryChange(historyChange) {
        switch (historyChange?.kind) {
        case HistoryChangeKind.SAMPLE:
            this._carriedUsec = carriedAfterSample({
                lastSampledAtUsec: this._lastSampledAtUsec, sampledAtUsec: historyChange.sampledAtUsec ?? null,
                carriedUsec: this._carriedUsec, intervalCount: historyChange.sampledIntervalCount ?? null,
            });
            this._appendSampledSlots(sampleAppendedSlotCount(historyChange.appendedSlotCount), true);
            break;
        case HistoryChangeKind.STATE:
        case HistoryChangeKind.STALE_STATE: {
            const {intervalCount, carriedUsec} = stateIntervalCount({
                lastSampledAtUsec: this._lastSampledAtUsec, sampledAtUsec: historyChange.sampledAtUsec ?? null,
                carriedUsec: this._carriedUsec,
            });
            this._carriedUsec = carriedUsec;
            const isFresh = historyChange.kind === HistoryChangeKind.STATE;
            this._takeBackNoDataSlots();
            this._appendSampledSlots(Math.min(CARD_HISTORY_SAMPLES, intervalCount ?? CARD_HISTORY_SAMPLES), isFresh);
            if (!isFresh)
                this._appendNoDataSlot();
            break;
        }
        case HistoryChangeKind.NO_DATA:
            this._appendNoDataSlot();
            return;
        default:
            return;
        }
        this._lastSampledAtUsec = historyChange.sampledAtUsec ?? null;
    }

    /**
     * Readies the recorder to be kept across a disable: each slot becomes what slotKeptAcrossDisable keeps, the newest
     * is closed (no reading after the disable counts in it), and the latest reading is forgotten, since nothing is
     * known of the sessions until the next enable's first answer. That time is no reading, so the sessions blocked at
     * the disable are kept: each kept cap shows after the enable what it showed at the disable, until the first
     * reading judges it. The last Sample's real time is kept, so the first state after the enable counts the time
     * between, a suspend in it included, as empty slots.
     *
     * @returns {void}
     */
    holdAcrossDisable() {
        this._slots = this._slots.map(slot =>
            slotKeptAcrossDisable(slot, this._latestBlockedSessionKeys, this._keptAcrossDisable));
        this._isNewestSlotOpen = false;
        this._latestReading = null;
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
            return EMPTY_SLOT;
        return {workingCount: this._latestReading.workingCount, blockedSessionKeys: this._latestBlockedSessionKeys};
    }

    /**
     * Takes back the no-data slots since the last Sample or state, the newest slots: a state's histories do not hold
     * the client's own gaps. The newest slot left stays closed to readings, as no data closed it.
     *
     * @returns {void}
     */
    _takeBackNoDataSlots() {
        const keptSlotCount = Math.max(0, this._slots.length - this._trailingNoDataSlotCount);
        this._slots.length = keptSlotCount;
        this._trailingNoDataSlotCount = 0;
    }

    /**
     * Appends slots for a Sample or a state, all empty but the last, which is its own from the latest reading where it
     * has one (then the newest slot is open to readings), else empty too. Starts the count of no-data slots again.
     *
     * @param {number} slotCount - Slots to append, 0 or more.
     * @param {boolean} hasOwnSlot - The last is its own: a Sample's or a fresh state's.
     * @returns {void}
     */
    _appendSampledSlots(slotCount, hasOwnSlot) {
        this._trailingNoDataSlotCount = 0;
        if (slotCount === 0)
            return;
        const emptySlotCount = hasOwnSlot ? slotCount - 1 : slotCount;
        for (let emptySlotIndex = 0; emptySlotIndex < emptySlotCount; emptySlotIndex++)
            this._appendSlot(EMPTY_SLOT);
        this._isNewestSlotOpen = hasOwnSlot;
        if (hasOwnSlot)
            this._appendSlot(this._latestReadingSlot());
    }

    /**
     * Appends no data's empty slot, closed to readings, and counts it for the next state to take back.
     *
     * @returns {void}
     */
    _appendNoDataSlot() {
        this._appendSlot(EMPTY_SLOT);
        this._trailingNoDataSlotCount++;
        this._isNewestSlotOpen = false;
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
