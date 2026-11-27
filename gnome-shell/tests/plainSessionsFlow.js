// The Sessions tile's flow done the plain way, for the tables to hold lib/sessionsFlow.js against: no count is
// bounded, rows are given up one at a time, and the balancing tries every height from 120 px up in 3 px steps until
// one fits. It is slow on a large desk and has no bound at all, which is why the module does not work this way; on a
// desk and a tile of real sizes it gives what the module must. Its columns hold any number of rows, so it is only
// compared on tiles whose columns hold fewer than the module's most.
import {
    DEFAULT_SESSIONS_TILE_LENGTHS, SESSIONS_FLOW_ITEM_KIND,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsFlow.js';
import {SESSION_GROUP_ORDER} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionOrder.js';

const GROUPS_GIVEN_UP_FIRST = Object.freeze([...SESSION_GROUP_ORDER].reverse());
const BALANCED_FLOW_LEAST_HEIGHT_PX = 120;
const BALANCED_FLOW_HEIGHT_STEP_PX = 3;

/**
 * Lays the groups out down the columns at a flow height, the way the module does but with no row cap.
 *
 * @param {object} desk - The counts, the columns and the lengths.
 * @param {Object<string, number>} shownCountByState - The rows each group shows.
 * @param {number} flowHeightPx - The height a column's items may take.
 * @param {boolean} isStoppingAtTheFirstMisfit - Whether to stop at the first group that does not fit.
 * @returns {{columns: Array<Array<object>>, doesFit: boolean}} The columns and whether every item fits.
 */
function layOutPlainly(desk, shownCountByState, flowHeightPx, isStoppingAtTheFirstMisfit) {
    const {sessionCountByState, columnCount, lengths} = desk;
    const {groupHeadingHeightPx, moreLineHeightPx, rowHeightPxByState} = lengths;
    const columns = Array.from({length: columnCount}, () => []);
    let columnIndex = 0;
    let usedHeightPx = 0;
    let doesFit = true;
    const isLastColumn = () => columnIndex === columnCount - 1;
    const place = (item, heightPx) => {
        if (usedHeightPx + heightPx > flowHeightPx && !isLastColumn()) {
            columnIndex++;
            columns[columnIndex].push({kind: SESSIONS_FLOW_ITEM_KIND.CONTINUED, state: item.state});
            usedHeightPx = groupHeadingHeightPx;
        }
        columns[columnIndex].push(item);
        usedHeightPx += heightPx;
        doesFit &&= usedHeightPx <= flowHeightPx;
    };
    for (const state of SESSION_GROUP_ORDER) {
        const count = sessionCountByState[state];
        if (count === 0)
            continue;
        const shownCount = shownCountByState[state];
        const headingAndFirstRowHeightPx = groupHeadingHeightPx + (shownCount > 0 ? rowHeightPxByState[state] : 0);
        if (usedHeightPx + headingAndFirstRowHeightPx > flowHeightPx && !isLastColumn()) {
            columnIndex++;
            usedHeightPx = 0;
        }
        columns[columnIndex].push({kind: SESSIONS_FLOW_ITEM_KIND.HEADING, state, count});
        usedHeightPx += groupHeadingHeightPx;
        doesFit &&= usedHeightPx <= flowHeightPx;
        for (let indexInGroup = 0; indexInGroup < shownCount; indexInGroup++)
            place({kind: SESSIONS_FLOW_ITEM_KIND.ROW, state, indexInGroup}, rowHeightPxByState[state]);
        if (count > shownCount && shownCount > 0)
            place({kind: SESSIONS_FLOW_ITEM_KIND.MORE, state, hiddenCount: count - shownCount}, moreLineHeightPx);
        if (!doesFit && isStoppingAtTheFirstMisfit)
            break;
    }
    return {columns, doesFit};
}

/**
 * The rows each group lists, the plain way: from the least urgent group, one row is given up at a time until the
 * flow fits.
 *
 * @param {object} tile - The tile and what it lists, as plainSessionsFlow takes it.
 * @returns {Object<string, number>} The rows each group lists.
 */
export function plainListedCountByState(tile) {
    const {sessionCountByState, columnCount, tileHeightPx, lengths = DEFAULT_SESSIONS_TILE_LENGTHS} = tile;
    const countByState = Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, sessionCountByState[state] ?? 0]));
    const desk = {sessionCountByState: countByState, columnCount, lengths};
    const columnHeightPx = tileHeightPx - lengths.aboveColumnsHeightPx;
    const shownCountByState = {...countByState};
    for (const state of GROUPS_GIVEN_UP_FIRST) {
        while (shownCountByState[state] > 0 && !layOutPlainly(desk, shownCountByState, columnHeightPx, true).doesFit)
            shownCountByState[state]--;
    }
    return shownCountByState;
}

/**
 * The flow, the plain way.
 *
 * @param {object} tile - The tile and what it lists, in whole numbers.
 * @param {Object<string, number>} tile.sessionCountByState - Each state's sessions.
 * @param {number} tile.columnCount - The tile's columns, at least 1.
 * @param {number} tile.tileHeightPx - The tile's height.
 * @param {object} [tile.lengths] - The tile's lengths in whole pixels.
 * @returns {{unlistedCount: number, listedCountByState: Object<string, number>, columns: Array<Array<object>>,
 *     doesFit: boolean}} As sessionsFlow gives it, but for its work.
 */
export function plainSessionsFlow(tile) {
    const {sessionCountByState, columnCount, tileHeightPx, lengths = DEFAULT_SESSIONS_TILE_LENGTHS} = tile;
    const countByState = Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, sessionCountByState[state] ?? 0]));
    const desk = {sessionCountByState: countByState, columnCount, lengths};
    const columnHeightPx = tileHeightPx - lengths.aboveColumnsHeightPx;
    const shownCountByState = plainListedCountByState({...tile, sessionCountByState: countByState, lengths});
    let layout = layOutPlainly(desk, shownCountByState, columnHeightPx, false);
    const firstHeightPx = BALANCED_FLOW_LEAST_HEIGHT_PX;
    for (let flowHeightPx = firstHeightPx; flowHeightPx < columnHeightPx; flowHeightPx += BALANCED_FLOW_HEIGHT_STEP_PX) {
        const balanced = layOutPlainly(desk, shownCountByState, flowHeightPx, false);
        if (balanced.doesFit) {
            layout = balanced;
            break;
        }
    }
    let unlistedCount = 0;
    for (const state of SESSION_GROUP_ORDER)
        unlistedCount += countByState[state] - shownCountByState[state];
    return {unlistedCount, listedCountByState: shownCountByState, columns: layout.columns, doesFit: layout.doesFit};
}
