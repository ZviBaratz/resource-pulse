// How many columns the Sessions tile holds: the one input of the cockpit's composition that its sessions change. A
// column is added while sessions go unlisted and the composition has room for one more, and taken away only once the
// sessions would all be listed without it, with rows to spare, so that a desk whose count wavers by a session or two
// keeps its columns. Each input is read once. Pure: no Gio, GLib or Shell import, so it runs under plain gjs.
import {MOST_SESSIONS_COLUMN_COUNT} from './cockpitCompositionSizes.js';
import {SESSION_GROUP_ORDER} from './sessionOrder.js';
import {
    MOST_SESSIONS_IN_A_STATE, boundedCount, sessionsTileLengthsInWholePixels, unlistedSessionCount,
} from './sessionsFlow.js';

/**
 * A column is added while this many sessions or more would be unlisted without it, and taken away while every session
 * and this many more ordinary ones would be listed without it.
 */
export const COLUMN_HYSTERESIS_SESSION_COUNT = 3;
/** The state whose rows are the ordinary ones: what the rows to spare are counted in. */
const STATE_OF_ORDINARY_ROWS = 'idle';

/**
 * @param {*} heldColumnCount - The count the caller holds.
 * @returns {number|null} It as a whole number from 1 to MOST_SESSIONS_COLUMN_COUNT; null where none is held.
 */
function heldCountOf(heldColumnCount) {
    if (heldColumnCount === null || heldColumnCount === undefined)
        return null;
    return Math.max(1, boundedCount(heldColumnCount, MOST_SESSIONS_COLUMN_COUNT));
}

/**
 * @param {*} sessionCountByState - The caller's sessions by state.
 * @returns {Object<string, number>|null} Each state's sessions, read once and bounded as the flow bounds them; null
 *     where the sessions are not known.
 */
function boundedSessionCountsOf(sessionCountByState) {
    if (sessionCountByState === null || typeof sessionCountByState !== 'object')
        return null;
    return Object.fromEntries(SESSION_GROUP_ORDER.map(
        state => [state, boundedCount(sessionCountByState[state], MOST_SESSIONS_IN_A_STATE)]));
}

/**
 * @param {function(number): *} sessionsBoxFor - The composition's Sessions tile for each held count.
 * @returns {function(number): ({mostColumnCount: *, tileHeightPx: *}|null)} The same, asking `sessionsBoxFor` at most
 *     once for each count and reading each box once; null for a box that is not an object.
 */
function boxesKeptByCount(sessionsBoxFor) {
    const boxByColumnCount = new Map();
    return columnCount => {
        if (!boxByColumnCount.has(columnCount)) {
            const box = sessionsBoxFor(columnCount);
            const isBoxAnObject = box !== null && typeof box === 'object';
            const boxFigures = isBoxAnObject
                ? {mostColumnCount: box.mostColumnCount, tileHeightPx: box.tileHeightPx}
                : null;
            boxByColumnCount.set(columnCount, boxFigures);
        }
        return boxByColumnCount.get(columnCount);
    };
}

/**
 * The count a held count comes to: down to the most the composition has room for first, then up while sessions go
 * unlisted, then down while they would all be listed with rows to spare.
 *
 * @param {number} heldCount - The count held, from 1 to MOST_SESSIONS_COLUMN_COUNT.
 * @param {number} mostColumnCount - The most the composition has room for.
 * @param {Object<string, number>} countByState - The sessions, bounded.
 * @param {function(number, Object<string, number>): number} unlistedWith - The sessions a count leaves unlisted.
 * @returns {number} The count to hold.
 */
function countFromTheHeldCount(heldCount, mostColumnCount, countByState, unlistedWith) {
    const withRowsToSpare = {
        ...countByState,
        [STATE_OF_ORDINARY_ROWS]: countByState[STATE_OF_ORDINARY_ROWS] + COLUMN_HYSTERESIS_SESSION_COUNT,
    };
    let columnCount = Math.min(heldCount, mostColumnCount);
    while (columnCount < mostColumnCount && unlistedWith(columnCount, countByState) >= COLUMN_HYSTERESIS_SESSION_COUNT)
        columnCount++;
    while (columnCount > 1 && unlistedWith(columnCount - 1, withRowsToSpare) === 0)
        columnCount--;
    return columnCount;
}

/**
 * The number of Sessions' columns to hold, at a moment it may change.
 * - Where the sessions are not known, where the composition draws no Sessions tile, or where no composition is given,
 *   the count held stays, and is 1 where none is held.
 * - With no count held, it is the fewest columns that list every session, up to the most the composition has room
 *   for.
 * - With a count held, it first comes down to that most. Then it gains a column while COLUMN_HYSTERESIS_SESSION_COUNT
 *   sessions or more are unlisted and the composition has room for another, and loses one while the sessions, and
 *   COLUMN_HYSTERESIS_SESSION_COUNT more ordinary ones, would all be listed without it. The two cannot both hold, so
 *   the count it gives is the count it gives again.
 *
 * Each input is read once, and `sessionsBoxFor` is asked at most once for each count; one that throws is not caught.
 *
 * @param {object} [situation] - The sessions and the composition. With none, or one that is not an object, the count
 *     is 1.
 * @param {number|null} [situation.heldColumnCount] - The count held; null or undefined where none is. A fraction is
 *     rounded down, a count under 1 or not a finite number is taken as 1, and one over MOST_SESSIONS_COLUMN_COUNT as
 *     that.
 * @param {Object<string, number>|null} situation.sessionCountByState - How many sessions each state holds; null where
 *     they are not known (no answer yet, a stale source, the service gone). With herdr not running, the sessions are
 *     known, and there is none. Each count is bounded as sessionsFlow bounds it.
 * @param {function(number): ({mostColumnCount: number, tileHeightPx: number}|null)} situation.sessionsBoxFor - The
 *     composition's Sessions tile when Sessions is held to a column count, as cockpitComposition gives it in its
 *     `sessions`: null, or anything but an object, where the composition draws no Sessions tile. Where it is not a
 *     function, the count held stays.
 * @param {object} [situation.lengths] - The Sessions tile's lengths; DEFAULT_SESSIONS_TILE_LENGTHS unless given.
 *     Lengths that cannot be used list nothing, so wherever sessions go unlisted the count climbs to the most the
 *     composition has room for. The measured lengths fall back to the default ones, so the cockpit gives none such.
 * @returns {number} The count to hold: a whole number from 1 to MOST_SESSIONS_COLUMN_COUNT.
 */
export function sessionsColumnCountToHold(situation) {
    const isSituationAnObject = situation !== null && typeof situation === 'object';
    const {heldColumnCount, sessionCountByState, sessionsBoxFor, lengths} = isSituationAnObject ? situation : {};
    const heldCount = heldCountOf(heldColumnCount);
    if (typeof sessionsBoxFor !== 'function')
        return heldCount ?? 1;
    const boxFor = boxesKeptByCount(sessionsBoxFor);
    const startingBox = boxFor(heldCount ?? 1);
    const countByState = boundedSessionCountsOf(sessionCountByState);
    if (startingBox === null || countByState === null)
        return heldCount ?? 1;
    const wholeLengths = sessionsTileLengthsInWholePixels(lengths);
    const mostColumnCount = Math.max(1, boundedCount(startingBox.mostColumnCount, MOST_SESSIONS_COLUMN_COUNT));
    const unlistedWith = (columnCount, counts) => {
        const box = boxFor(columnCount);
        if (box === null)
            return Infinity;
        const tile = {sessionCountByState: counts, columnCount, tileHeightPx: box.tileHeightPx, lengths: wholeLengths};
        return unlistedSessionCount(tile);
    };
    if (heldCount !== null)
        return countFromTheHeldCount(heldCount, mostColumnCount, countByState, unlistedWith);
    let fewestColumnCount = 1;
    while (fewestColumnCount < mostColumnCount && unlistedWith(fewestColumnCount, countByState) > 0)
        fewestColumnCount++;
    return fewestColumnCount;
}
