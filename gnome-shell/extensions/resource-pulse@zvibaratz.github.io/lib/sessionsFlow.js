// The Sessions tile's flow: which of its sessions a tile of some columns and some height lists, where each heading,
// row and "+N more" line stands in its columns, and how many sessions it leaves unlisted. Pure: no Gio, GLib or Shell
// import, so it runs under plain gjs.
//
// The flow takes counts and knows no session: a row is a state's n-th session, in the order lib/sessionOrder.js gives
// it. The sessions' groups stand in SESSION_GROUP_ORDER, the most urgent first, down the first column and on into the
// next; a group with no session draws nothing. Every column is the tile's height less what stands above the columns.
// While the flow does not fit, rows are given up from the least urgent group that still shows one. With room to spare
// the columns are balanced, which changes where rows stand and never which are listed. Every count is bounded before
// the flow runs, so that no count can make it long, and each input is read once.
import {MOST_SESSIONS_COLUMN_COUNT} from './cockpitCompositionSizes.js';
import {SESSION_GROUP_ORDER} from './sessionOrder.js';

/** The Sessions tile's lengths at GNOME's default text size, in logical pixels. */
export const DEFAULT_SESSIONS_TILE_LENGTHS = Object.freeze({
    /** The tile's padding, its header and its column labels: what stands above the columns. */
    aboveColumnsHeightPx: 80,
    /** A group's heading, and the "continued" heading of a group run on into the next column. */
    groupHeadingHeightPx: 24,
    /** The "+N more" line that ends a group cut short. */
    moreLineHeightPx: 21,
    /** One session's row, by its state: a session waiting on you has a second line. */
    rowHeightPxByState: Object.freeze({blocked: 44, working: 24, done: 21, idle: 21, unknown: 21}),
});
/** What an item of a column is: a group's heading, that heading again atop the next column, a row, "+N more". */
export const SESSIONS_FLOW_ITEM_KIND = Object.freeze({HEADING: 'heading', CONTINUED: 'continued', ROW: 'row', MORE: 'more'});
/** A column lists at most this many rows, however tall the tile: a full column runs its group on into the next. */
const MOST_ROWS_IN_A_COLUMN = 256;
/** The most sessions any Sessions tile lists: its most columns, each full. */
export const MOST_SESSIONS_A_TILE_LISTS = MOST_SESSIONS_COLUMN_COUNT * MOST_ROWS_IN_A_COLUMN;

/** The order rows are given up in where the flow does not fit: the least urgent group first. */
const GROUPS_GIVEN_UP_FIRST = Object.freeze([...SESSION_GROUP_ORDER].reverse());
/** No state is taken to hold more sessions than this, whatever the service publishes. */
export const MOST_SESSIONS_IN_A_STATE = 100000;
/** No length or tile height is taken as longer than this. */
const MOST_LENGTH_PX = 32768;
/**
 * Balanced columns are laid out at a flow height on a 3 px grid from 120 px. No flow height under 120 px is tried, so
 * a few sessions fill the first column to 120 px and the last column takes what is left; a few pixels either way move
 * no row a reader would notice.
 */
const BALANCED_FLOW_LEAST_HEIGHT_PX = 120;
const BALANCED_FLOW_HEIGHT_STEP_PX = 3;
/**
 * The most flow heights the balancing tries. Its first is the least at which the listed items could fit, and while no
 * column is full of rows the columns fit within two headings and the tallest row over that: within 32 heights at the
 * default text size, and 93 at text three times as large, the most GNOME's text scaling gives. So the bound decides no
 * tile whose columns have room for their rows, and keeps lengths that no tile has from making the search long. Where
 * a column is full of rows, the search may end at the bound, and the columns are laid out at the tile's height: the
 * same rows are listed, standing differently.
 */
const MOST_BALANCING_STEPS = 128;

/**
 * @typedef {object} SessionsFlowWork
 * What one flow did, counted to measure its cost.
 * @property {number} layoutPassCount - The times the groups were laid out down the columns.
 * @property {number} placedItemCount - The headings, rows and lines placed, over every pass.
 * @property {number} balancingStepCount - The flow heights the balancing tried.
 */

/**
 * Bounds a count from the caller, as the flow bounds each state's sessions with MOST_SESSIONS_IN_A_STATE.
 *
 * @param {*} value - A count from the caller.
 * @param {number} most - The most it is taken as.
 * @returns {number} The count as a whole number from 0 to `most`; 0 where it is not a finite number.
 */
export function boundedCount(value, most) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(most, Math.max(0, Math.floor(value))) : 0;
}

/**
 * @param {*} length - A length from the caller.
 * @returns {boolean} Whether it is a finite number from 0 to MOST_LENGTH_PX.
 */
function isUsableLength(length) {
    return typeof length === 'number' && Number.isFinite(length) && length >= 0 && length <= MOST_LENGTH_PX;
}

/**
 * The Sessions tile's lengths as the flow uses them, each read once. A caller that lays out several flows with the
 * same lengths can take them this way once, and give the copy to each.
 *
 * @param {*} lengths - The caller's lengths: undefined for the default ones.
 * @returns {object|null} The lengths in whole pixels, rounded up, with the default lengths' keys and no other; null
 *     where one is missing or is not a finite number from 0 to 32 768, which lists nothing.
 */
export function sessionsTileLengthsInWholePixels(lengths) {
    if (lengths === undefined)
        return DEFAULT_SESSIONS_TILE_LENGTHS;
    const rowHeightPxByState = lengths?.rowHeightPxByState;
    if (rowHeightPxByState === null || typeof rowHeightPxByState !== 'object')
        return null;
    const {aboveColumnsHeightPx, groupHeadingHeightPx, moreLineHeightPx} = lengths;
    const rowHeightsPx = SESSION_GROUP_ORDER.map(state => rowHeightPxByState[state]);
    if (![aboveColumnsHeightPx, groupHeadingHeightPx, moreLineHeightPx, ...rowHeightsPx].every(isUsableLength))
        return null;
    return {
        aboveColumnsHeightPx: Math.ceil(aboveColumnsHeightPx),
        groupHeadingHeightPx: Math.ceil(groupHeadingHeightPx),
        moreLineHeightPx: Math.ceil(moreLineHeightPx),
        rowHeightPxByState: Object.fromEntries(SESSION_GROUP_ORDER.map(
            (state, stateIndex) => [state, Math.ceil(rowHeightsPx[stateIndex])])),
    };
}

/**
 * @typedef {object} FlowFacts
 * One flow's inputs, bounded.
 * @property {Object<string, number>} countByState - Each state's sessions, from 0 to MOST_SESSIONS_IN_A_STATE.
 * @property {number} columnCount - The tile's columns, from 0 to MOST_SESSIONS_COLUMN_COUNT.
 * @property {number} columnHeightPx - The height a column's items may take: the tile's, less what stands above.
 * @property {object} lengths - The tile's lengths in whole pixels.
 * @property {boolean} isListingNothing - Whether the tile lists no row, whatever its sessions: it has no column, a
 *     height that is not a finite number, or lengths that cannot be used.
 * @property {SessionsFlowWork} work - What this flow has done so far: the one value the flow changes as it runs.
 */

/**
 * @param {*} tile - The tile, as sessionsFlow takes it.
 * @returns {object} It, or an empty tile where it is not an object.
 */
function tileObjectOf(tile) {
    return tile !== null && typeof tile === 'object' ? tile : {};
}

/**
 * @param {object} tile - The tile, as sessionsFlow takes it, each of its figures read once.
 * @returns {FlowFacts} Its inputs, bounded.
 */
function boundedFlowInputs({sessionCountByState, columnCount, tileHeightPx, lengths}) {
    const countByState = Object.fromEntries(SESSION_GROUP_ORDER.map(
        state => [state, boundedCount(sessionCountByState?.[state], MOST_SESSIONS_IN_A_STATE)]));
    const wholeColumnCount = boundedCount(columnCount, MOST_SESSIONS_COLUMN_COUNT);
    const wholeLengths = sessionsTileLengthsInWholePixels(lengths);
    const isHeightKnown = typeof tileHeightPx === 'number' && Number.isFinite(tileHeightPx);
    const isListingNothing = wholeColumnCount === 0 || !isHeightKnown || wholeLengths === null;
    const usableLengths = wholeLengths ?? DEFAULT_SESSIONS_TILE_LENGTHS;
    const wholeTileHeightPx = isHeightKnown ? Math.min(MOST_LENGTH_PX, Math.floor(tileHeightPx)) : 0;
    return {
        countByState,
        columnCount: wholeColumnCount,
        columnHeightPx: wholeTileHeightPx - usableLengths.aboveColumnsHeightPx,
        lengths: usableLengths,
        isListingNothing,
        work: {layoutPassCount: 0, placedItemCount: 0, balancingStepCount: 0},
    };
}

/**
 * Lays the groups out down the columns at a flow height. A heading never stands alone at the foot of a column: where
 * it and its first row do not both fit, the group starts the next column. A row or "+N more" line that does not fit,
 * or a row in a full column, runs its group on into the next column under a "continued" heading. In the last column
 * every item is placed all the same, and the flow does not fit.
 *
 * @param {FlowFacts} flowFacts - The flow's inputs.
 * @param {Object<string, number>} shownCountByState - The rows each group shows.
 * @param {number} flowHeightPx - The height a column's items may take.
 * @param {Array<Array<object>>|null} columns - The columns to place the items in; null to learn only whether they fit,
 *     which stops at the first group that does not.
 * @returns {boolean} Whether every item stands within the flow height, and every column within its rows.
 */
function layOutFlow({countByState, columnCount, lengths, work}, shownCountByState, flowHeightPx, columns) {
    const {groupHeadingHeightPx, moreLineHeightPx, rowHeightPxByState} = lengths;
    const column = {index: 0, usedHeightPx: 0, rowCount: 0};
    let doesFit = true;
    let placedItemCount = 0;
    const isLastColumn = () => column.index === columnCount - 1;
    const isColumnFullOfRows = () => column.rowCount >= MOST_ROWS_IN_A_COLUMN;
    const startNextColumn = () => {
        column.index++;
        column.usedHeightPx = 0;
        column.rowCount = 0;
    };
    const add = (item, heightPx) => {
        placedItemCount++;
        columns?.[column.index].push(item);
        column.usedHeightPx += heightPx;
        column.rowCount += item.kind === SESSIONS_FLOW_ITEM_KIND.ROW ? 1 : 0;
        doesFit &&= column.usedHeightPx <= flowHeightPx && column.rowCount <= MOST_ROWS_IN_A_COLUMN;
    };
    const placeInGroup = (item, heightPx) => {
        const isRow = item.kind === SESSIONS_FLOW_ITEM_KIND.ROW;
        const doesRunOn = column.usedHeightPx + heightPx > flowHeightPx || (isRow && isColumnFullOfRows());
        if (doesRunOn && !isLastColumn()) {
            startNextColumn();
            // A group that runs on says so, so that its rows are not read as the group before it.
            add({kind: SESSIONS_FLOW_ITEM_KIND.CONTINUED, state: item.state}, groupHeadingHeightPx);
        }
        add(item, heightPx);
    };
    for (const state of SESSION_GROUP_ORDER) {
        const count = countByState[state];
        if (count === 0)
            continue;
        const shownCount = shownCountByState[state];
        const rowHeightPx = rowHeightPxByState[state];
        const firstRowHeightPx = shownCount > 0 ? rowHeightPx : 0;
        const isFirstRowOverTheColumn = column.usedHeightPx + groupHeadingHeightPx + firstRowHeightPx > flowHeightPx;
        const doesHeadingMoveOn = isFirstRowOverTheColumn || (shownCount > 0 && isColumnFullOfRows());
        if (doesHeadingMoveOn && !isLastColumn())
            startNextColumn();
        add({kind: SESSIONS_FLOW_ITEM_KIND.HEADING, state, count}, groupHeadingHeightPx);
        for (let indexInGroup = 0; indexInGroup < shownCount && (doesFit || columns !== null); indexInGroup++)
            placeInGroup({kind: SESSIONS_FLOW_ITEM_KIND.ROW, state, indexInGroup}, rowHeightPx);
        const hiddenCount = count - shownCount;
        if (hiddenCount > 0 && shownCount > 0)
            placeInGroup({kind: SESSIONS_FLOW_ITEM_KIND.MORE, state, hiddenCount}, moreLineHeightPx);
        if (!doesFit && columns === null)
            break;
    }
    work.layoutPassCount++;
    work.placedItemCount += placedItemCount;
    return doesFit;
}

/**
 * The most rows the tile's columns could hold: each column's height in its shortest rows, and no more than a full
 * column. Rows of no height take no room, so where the shortest has none, only the full column bounds them. The tile
 * lists no more than this: it lists rows only where they fit, and then each stands within one of its columns.
 *
 * @param {FlowFacts} flowFacts - The flow's inputs.
 * @returns {number} The bound.
 */
function mostRowsTheColumnsHold({columnCount, columnHeightPx, lengths}) {
    const rowHeightsPx = SESSION_GROUP_ORDER.map(state => lengths.rowHeightPxByState[state]);
    const shortestRowHeightPx = Math.min(...rowHeightsPx);
    const rowsInAColumn = shortestRowHeightPx === 0
        ? MOST_ROWS_IN_A_COLUMN
        : Math.floor(Math.max(0, columnHeightPx) / shortestRowHeightPx);
    return columnCount * Math.min(MOST_ROWS_IN_A_COLUMN, rowsInAColumn);
}

/**
 * The rows each group lists. No more of a group is laid out than the columns could hold, and one more. While the
 * flow does not fit, the least urgent group that still shows a row gives up rows: it keeps the most with which the
 * flow fits, found by bisection. Fewer rows do not always take less room: where "+N more" is taller than a row, as at
 * St's line boxes, all of a group's rows can fit where all but one would not. The bisection never meets that step,
 * since it starts only once the rows first laid out do not fit. Every count under those shows no row or ends in
 * "+N more", and among them one row fewer never moves a later item down or on, so the flow fits at each count under
 * the most that does. Where the flow does not fit even with none, the group keeps none, and the next group gives.
 *
 * @param {FlowFacts} flowFacts - The flow's inputs.
 * @returns {Object<string, number>} The rows each group lists.
 */
function listedCountByStateFor(flowFacts) {
    const {countByState, columnHeightPx, isListingNothing} = flowFacts;
    const mostRowsAGroupLaysOut = mostRowsTheColumnsHold(flowFacts) + 1;
    const shownCountByState = Object.fromEntries(SESSION_GROUP_ORDER.map(
        state => [state, isListingNothing ? 0 : Math.min(countByState[state], mostRowsAGroupLaysOut)]));
    const doesFlowFit = () => layOutFlow(flowFacts, shownCountByState, columnHeightPx, null);
    for (const state of GROUPS_GIVEN_UP_FIRST) {
        if (shownCountByState[state] === 0 || doesFlowFit())
            continue;
        let leastThatDoesNotFit = shownCountByState[state];
        let mostThatFits = 0;
        shownCountByState[state] = 0;
        if (!doesFlowFit())
            continue;
        while (leastThatDoesNotFit - mostThatFits > 1) {
            const middleCount = Math.floor((mostThatFits + leastThatDoesNotFit) / 2);
            shownCountByState[state] = middleCount;
            if (doesFlowFit())
                mostThatFits = middleCount;
            else
                leastThatDoesNotFit = middleCount;
        }
        shownCountByState[state] = mostThatFits;
    }
    return shownCountByState;
}

/**
 * @param {FlowFacts} flowFacts - The flow's inputs.
 * @param {Object<string, number>} listedCountByState - The rows each group lists.
 * @returns {number} The height the listed items take one after another, headings and "+N more" lines with them: no
 *     flow height under this, divided among the columns, can hold them.
 */
function listedItemsHeightPx({countByState, lengths}, listedCountByState) {
    let heightPx = 0;
    for (const state of SESSION_GROUP_ORDER) {
        if (countByState[state] === 0)
            continue;
        const listedCount = listedCountByState[state];
        const isCutShort = listedCount > 0 && listedCount < countByState[state];
        heightPx += lengths.groupHeadingHeightPx + listedCount * lengths.rowHeightPxByState[state];
        heightPx += isCutShort ? lengths.moreLineHeightPx : 0;
    }
    return heightPx;
}

/**
 * The balanced flow height: the least height on the balancing grid, under the column's height, at which the listed
 * items fit; the column's height where none does. The search starts at the first grid height at which the items
 * could fit, since none under it can.
 *
 * @param {FlowFacts} flowFacts - The flow's inputs.
 * @param {Object<string, number>} listedCountByState - The rows each group lists.
 * @returns {number} The flow height.
 */
function balancedFlowHeightPx(flowFacts, listedCountByState) {
    const {columnCount, columnHeightPx, work} = flowFacts;
    const leastPossibleHeightPx = Math.ceil(listedItemsHeightPx(flowFacts, listedCountByState) / columnCount);
    const heightOverTheGridStartPx = leastPossibleHeightPx - BALANCED_FLOW_LEAST_HEIGHT_PX;
    const firstStepIndex = Math.max(0, Math.ceil(heightOverTheGridStartPx / BALANCED_FLOW_HEIGHT_STEP_PX));
    for (let stepIndex = firstStepIndex; stepIndex < firstStepIndex + MOST_BALANCING_STEPS; stepIndex++) {
        const flowHeightPx = BALANCED_FLOW_LEAST_HEIGHT_PX + stepIndex * BALANCED_FLOW_HEIGHT_STEP_PX;
        if (flowHeightPx >= columnHeightPx)
            break;
        work.balancingStepCount++;
        if (layOutFlow(flowFacts, listedCountByState, flowHeightPx, null))
            return flowHeightPx;
    }
    return columnHeightPx;
}

/**
 * @param {object} tile - The Sessions tile, as sessionsFlow takes it.
 * @returns {{flowFacts: FlowFacts, listedCountByState: Object<string, number>, unlistedCount: number}} Its bounded
 *     inputs, the rows each group lists, and the sessions it leaves unlisted.
 */
function listedSessionsOf(tile) {
    const flowFacts = boundedFlowInputs(tileObjectOf(tile));
    const listedCountByState = listedCountByStateFor(flowFacts);
    let unlistedCount = 0;
    for (const state of SESSION_GROUP_ORDER)
        unlistedCount += flowFacts.countByState[state] - listedCountByState[state];
    return {flowFacts, listedCountByState, unlistedCount};
}

/**
 * The Sessions tile's flow: what it lists, and where each item stands in its columns. Odd inputs list nothing rather
 * than throw, and each of the tile's figures is read once.
 *
 * @param {object} tile - The Sessions tile and what it lists.
 * @param {Object<string, number>} tile.sessionCountByState - How many sessions each state holds, by the states in
 *     SESSION_GROUP_ORDER. A count that is not a finite number is 0, a fraction is rounded down, and a count over
 *     100 000 is taken as 100 000.
 * @param {number} tile.columnCount - The tile's columns: a whole number from 0 to MOST_SESSIONS_COLUMN_COUNT.
 * @param {number} tile.tileHeightPx - The tile's height.
 * @param {object} [tile.lengths] - The tile's lengths, in the shape of DEFAULT_SESSIONS_TILE_LENGTHS, which it is
 *     unless given. Fractional lengths are rounded up, and lengths that are not each a finite number from 0 to 32 768
 *     list nothing.
 * @returns {{unlistedCount: number, listedCountByState: Object<string, number>, columns: Array<Array<object>>,
 *     doesFit: boolean, work: SessionsFlowWork}}
 *     The sessions left unlisted; the rows each group lists; one list per column, top to bottom, of its items:
 *     - `{kind: 'heading', state, count}`, a group's heading with all its sessions' count, listed or not;
 *     - `{kind: 'row', state, indexInGroup}`, the group's session at that place in its order;
 *     - `{kind: 'more', state, hiddenCount}`, the "+N more" line that ends a group cut short;
 *     - `{kind: 'continued', state}`, a group run on into this column;
 *     whether every item stands within its column's height, which is false only where the groups' headings alone do
 *     not fit, with no row listed, and the tile must clip its last column; and what the flow did, to measure its
 *     cost. A tile that lists nothing whatever its sessions has no column, leaves every session unlisted, and places
 *     nothing, so it fits.
 */
export function sessionsFlow(tile) {
    const {flowFacts, listedCountByState, unlistedCount} = listedSessionsOf(tile);
    if (flowFacts.isListingNothing)
        return {unlistedCount, listedCountByState, columns: [], doesFit: true, work: flowFacts.work};
    const columns = Array.from({length: flowFacts.columnCount}, () => []);
    const flowHeightPx = balancedFlowHeightPx(flowFacts, listedCountByState);
    const doesFit = layOutFlow(flowFacts, listedCountByState, flowHeightPx, columns);
    return {unlistedCount, listedCountByState, columns, doesFit, work: flowFacts.work};
}

/**
 * How many sessions a Sessions tile leaves unlisted: sessionsFlow's `unlistedCount`, without laying out its columns.
 *
 * @param {object} tile - The tile and what it lists, as sessionsFlow takes it.
 * @returns {number} The sessions left unlisted; every one, where the tile lists nothing.
 */
export function unlistedSessionCount(tile) {
    return listedSessionsOf(tile).unlistedCount;
}

/**
 * A bound on the sessions a Sessions tile lists, whatever its sessions: each column's height in its shortest rows, up
 * to a full column of MOST_ROWS_IN_A_COLUMN, over the tile's columns. The tile can build its rows to it once, for the
 * most columns it may hold. It is a bound and not the most the tile lists, since headings and "+N more" lines take
 * room too: a column 800 px high is bounded at 34, where a column of idle sessions lists 32 or 33.
 *
 * @param {object} tile - The tile, as sessionsFlow takes it: its `columnCount`, `tileHeightPx` and `lengths`, each
 *     read once. Its sessions are not read.
 * @returns {number} The bound, from 0 to MOST_SESSIONS_A_TILE_LISTS: 0 where the tile lists nothing whatever its
 *     sessions.
 */
export function mostSessionsATileLists(tile) {
    const {columnCount, tileHeightPx, lengths} = tileObjectOf(tile);
    const flowFacts = boundedFlowInputs({columnCount, tileHeightPx, lengths});
    return flowFacts.isListingNothing ? 0 : mostRowsTheColumnsHold(flowFacts);
}
