// Which slot of the Sessions tile each thing it shows takes, and how a cell that comes and goes inside a slot is
// shown, as pure functions: the tile's shell modules only apply what these give. Pure: no Shell, St, Clutter or GLib
// import, so it runs under plain gjs.
//
// - A session keeps its row: a session still listed takes the row that showed it, so a reorder only moves rows. A
//   session newly listed takes a row never used first, then one whose session is no longer listed, so a row whose
//   session left keeps its painted strip should the session come back.
// - Each heading and "+N more" line has a slot of its state's; a group run on into a later column takes that
//   column's run-on heading.
// - The header's state counts each carry their own gap, the first shown none, so an absent count leaves no gap.
// - A context tag that is absent is not outlined either, so its border adds no width to a cell of none.
import {SESSION_CELL_NO_ROOM_PX, SESSION_STATE_COUNTS_GAP_PX} from './drawingConstants.js';
import {SESSION_GROUP_ORDER} from './sessionOrder.js';
import {SESSIONS_FLOW_ITEM_KIND} from './sessionsFlow.js';

/** What kind of slot a line of the flow takes: a group's heading, a column's run-on heading, a "+N more" line. */
export const LineSlotKind = Object.freeze({HEADING: 'heading', CONTINUED: 'continued', MORE: 'more'});

/**
 * The row each listed session takes.
 *
 * @param {Array<string|null>} rowSessionIds - Each row's session, in the rows' order: the one it showed last, or null
 *     for a row never used.
 * @param {string[]} listedSessionIds - The sessions listed, in the order they are shown.
 * @returns {Array<number|null>} For each listed session, the index of its row, or null where every row is taken: the
 *     sessions after it still take theirs. Two listed sessions with one id (a service fault) take a row each, and a
 *     second row left holding a listed id after such a fault is free.
 */
export function rowIndexesForSessions(rowSessionIds, listedSessionIds) {
    const listedIds = new Set(listedSessionIds);
    const keptRowIndexById = new Map();
    // Where two rows hold one listed id (after a service fault), the later keeps it and the earlier is free.
    rowSessionIds.forEach((sessionId, rowIndex) => {
        if (sessionId !== null && listedIds.has(sessionId))
            keptRowIndexById.set(sessionId, rowIndex);
    });
    const keptRowIndexes = new Set(keptRowIndexById.values());
    const freeRowIndexes = rowSessionIds.map((sessionId, rowIndex) => ({sessionId, rowIndex}))
        .filter(({rowIndex}) => !keptRowIndexes.has(rowIndex))
        // A row never used first: a row whose session left keeps its strip painted, should the session come back.
        .sort((row, otherRow) => Number(row.sessionId !== null) - Number(otherRow.sessionId !== null))
        .map(({rowIndex}) => rowIndex);
    const takenRowIndexes = new Set();
    return listedSessionIds.map(sessionId => {
        const keptRowIndex = keptRowIndexById.get(sessionId);
        const rowIndex = keptRowIndex !== undefined && !takenRowIndexes.has(keptRowIndex)
            ? keptRowIndex : freeRowIndexes.shift() ?? null;
        if (rowIndex !== null)
            takenRowIndexes.add(rowIndex);
        return rowIndex;
    });
}

/**
 * The slot a heading, a run-on heading or a "+N more" line takes.
 *
 * @param {{kind: string, state: string}} item - The flow's item: not a row.
 * @param {number} columnIndex - Its column.
 * @returns {{slotKind: string, state: string, continuedIndex: (number|null)}|null} A LineSlotKind, the item's state,
 *     and for a run-on heading its column's slot (one for each column after the first); null for a row, or a run-on
 *     heading in the first column, which the flow never gives.
 */
export function lineSlotOf(item, columnIndex) {
    if (item.kind === SESSIONS_FLOW_ITEM_KIND.HEADING)
        return {slotKind: LineSlotKind.HEADING, state: item.state, continuedIndex: null};
    if (item.kind === SESSIONS_FLOW_ITEM_KIND.MORE)
        return {slotKind: LineSlotKind.MORE, state: item.state, continuedIndex: null};
    if (item.kind === SESSIONS_FLOW_ITEM_KIND.CONTINUED && columnIndex >= 1)
        return {slotKind: LineSlotKind.CONTINUED, state: item.state, continuedIndex: columnIndex - 1};
    return null;
}

/**
 * How the header shows each state's count: present where the state has sessions, each with its gap, the first shown
 * with none, since the counts' box carries the gap after the title.
 *
 * @param {Object<string, string>} countTextByState - The count of each state shown, as drawn.
 * @returns {{cells: Array<{state: string, isPresent: boolean, countText: (string|null), gapPx: number}>,
 *     isBoxPresent: boolean}} A cell for every state, in the groups' order, and whether any is present.
 */
export function stateCountCells(countTextByState) {
    let isAfterPresentCount = false;
    const cells = SESSION_GROUP_ORDER.map(state => {
        const countText = Object.hasOwn(countTextByState, state) ? countTextByState[state] : null;
        const isPresent = countText !== null;
        const gapPx = isAfterPresentCount ? SESSION_STATE_COUNTS_GAP_PX : SESSION_CELL_NO_ROOM_PX;
        isAfterPresentCount ||= isPresent;
        return {state, isPresent, countText, gapPx};
    });
    return {cells, isBoxPresent: isAfterPresentCount};
}

/**
 * How a row shows its context tag (lib/sessionsTileContent.js sessionRowContent's `contextTag`).
 *
 * @param {{text: string, isHigh: boolean}|null} contextTag - The tag, or null for none.
 * @returns {{isPresent: boolean, text: (string|null), isOutlined: boolean}} Whether it is present, its words, and
 *     whether it is outlined: an absent tag never is, so its border adds no width to a cell of none.
 */
export function contextTagCell(contextTag) {
    if (contextTag === null || contextTag === undefined)
        return {isPresent: false, text: null, isOutlined: false};
    return {isPresent: true, text: contextTag.text, isOutlined: contextTag.isHigh === true};
}
