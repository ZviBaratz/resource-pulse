// An hour of each Claude session's state, a cell a minute, as the sessions source publishes it in each row's
// `stateHistory`. The cockpit service keeps one SessionStateHistory for its life, so a restart starts every history
// empty. Pure: no Gio, no GLib and no Shell import, so it runs under plain gjs with minutes given by hand.
//
// - A cell is the state at the minute's last sample: a sample in the same minute as a session's last cell overwrites
//   that cell.
// - A minute with no sample repeats the cell before it. So a sample n minutes after the last adds n - 1 repeats, then
//   its own cell; a gap longer than the hour gives SESSION_STATE_HISTORY_CELLS - 1 repeats and the new cell.
// - The wall clock set back (a sample's minute before the session's last cell) overwrites the last cell and adds
//   nothing, so nothing already recorded moves.
// - A session the sample does not hold is forgotten: a session closed and reopened later starts empty.
// - A minute is wall-clock time, not monotonic, because the history is drawn against "now": the monotonic clock stops
//   during a suspend.
import {MICROSECONDS_PER_SECOND} from './constants.js';
import {SESSION_STATE_HISTORY_CELLS, SESSION_STATE_HISTORY_LETTERS} from './cockpitProtocol.js';

const SECONDS_PER_MINUTE = 60;
const MICROSECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MICROSECONDS_PER_SECOND;

/**
 * @param {number} usec - A wall-clock time, in microseconds since the epoch.
 * @returns {number} Its minute: whole minutes since the epoch.
 */
export function minuteIndexOfUsec(usec) {
    return Math.floor(usec / MICROSECONDS_PER_MINUTE);
}

/**
 * @param {*} state - A session's state.
 * @returns {string} Its letter in SESSION_STATE_HISTORY_LETTERS; unknown's for a state the protocol does not list.
 */
function letterOfState(state) {
    return Object.hasOwn(SESSION_STATE_HISTORY_LETTERS, state)
        ? SESSION_STATE_HISTORY_LETTERS[state] : SESSION_STATE_HISTORY_LETTERS.unknown;
}

/**
 * @param {{letters: string, lastMinuteIndex: number}} history - A session's history so far.
 * @param {number} minuteIndex - The sample's minute.
 * @param {string} letter - The sample's cell.
 * @returns {{letters: string, lastMinuteIndex: number}} The history with the sample recorded.
 */
function historyWithSample(history, minuteIndex, letter) {
    const earlierLetters = history.letters.slice(0, -1);
    const lastLetter = history.letters.slice(-1);
    if (minuteIndex <= history.lastMinuteIndex)
        return {letters: `${earlierLetters}${letter}`, lastMinuteIndex: history.lastMinuteIndex};
    const missedMinuteCount = Math.min(minuteIndex - history.lastMinuteIndex - 1, SESSION_STATE_HISTORY_CELLS - 1);
    const letters = `${history.letters}${lastLetter.repeat(missedMinuteCount)}${letter}`;
    return {letters: letters.slice(-SESSION_STATE_HISTORY_CELLS), lastMinuteIndex: minuteIndex};
}

/** Each session's state over the last hour, by session key (lib/sessions.js's sessionKeyOf). */
export class SessionStateHistory {
    constructor() {
        /** Each session's history: `{letters, lastMinuteIndex}` by session key. */
        this._historiesBySessionKey = new Map();
    }

    /**
     * Records one sample: each session's state at its minute. Sessions the sample does not hold are forgotten.
     *
     * @param {number} minuteIndex - The sample's minute (minuteIndexOfUsec of its wall-clock start).
     * @param {Map<string, string>} stateBySessionKey - The state of every session the sample holds, by session key.
     * @returns {void}
     */
    record(minuteIndex, stateBySessionKey) {
        for (const sessionKey of [...this._historiesBySessionKey.keys()]) {
            if (!stateBySessionKey.has(sessionKey))
                this._historiesBySessionKey.delete(sessionKey);
        }
        for (const [sessionKey, state] of stateBySessionKey) {
            const letter = letterOfState(state);
            const history = this._historiesBySessionKey.get(sessionKey);
            this._historiesBySessionKey.set(sessionKey, history === undefined
                ? {letters: letter, lastMinuteIndex: minuteIndex}
                : historyWithSample(history, minuteIndex, letter));
        }
    }

    /**
     * @returns {Map<string, string>} Each session's cells, the oldest first, by session key: a new map.
     */
    lettersBySessionKey() {
        return new Map([...this._historiesBySessionKey].map(([sessionKey, history]) => [sessionKey, history.letters]));
    }
}
