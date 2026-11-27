// One column of the cockpit: its tiles' rows at a step, fitted to a height, its least and stop widths, and its
// rectangles. Pure: no Gio, GLib or Shell import, so it runs under plain gjs.
//
// A column's tiles stand one under the other, each as wide as the column, in bands. Heaviest and Connections share a
// row, a pair, where they stand next to each other in their group, the ranking is at its fewest rows, and the column
// is wide enough for both. The machine's tiles give height in steps (see compositionSizesFacts). One tile of a column
// takes the height that is left: Sessions, or Connections alone in its column, which is then a list.
import {COCKPIT_TILE_CARD_ID, CONNECTIONS_FORM, MONITOR_FORMS_LARGEST_FIRST} from './cockpitCompositionGroups.js';

const SMALLEST_MONITOR_FORM = MONITOR_FORMS_LARGEST_FIRST[MONITOR_FORMS_LARGEST_FIRST.length - 1];
/**
 * A group of the machine's three tiles, the monitor, Heaviest and Connections: the column Sessions is measured
 * against where no such group stands beside it. It is used for heights only, and never placed.
 */
const FULL_MACHINE_GROUPS = Object.freeze([Object.freeze({
    groupIndex: -1,
    groupId: 'full-machine',
    cardIds: Object.freeze([COCKPIT_TILE_CARD_ID.MONITOR, COCKPIT_TILE_CARD_ID.HEAVIEST, COCKPIT_TILE_CARD_ID.CONNECTIONS]),
})]);

/**
 * @typedef {object} CompositionFacts
 * What one composition reads of its sizes, with a memo of its own column plans. It is made afresh for each
 * composition, so nothing is kept from one call to the next.
 * @property {object} sizes - The sizes in whole pixels, the gaps around a pair largest first.
 * @property {Array<{monitorForm: string, rankingRowCount: number}>} steps - The steps by which the machine's tiles
 *     give height, largest first.
 * @property {number} plateStandPx - A plate's height and the gap under it.
 * @property {number} pairLeastWidthPx - The least width at which Heaviest and Connections share a row.
 * @property {Map<object, Map<string, object>>} columnPlansByColumn - Each column's plans, by its list of groups, then
 *     by step, gap and whether the column is wide enough for a pair.
 */

/**
 * A column's rows at one step: which tiles stand in each row, each row's height, the gaps, and the height of
 * everything but the one tile that takes what is left. A column's plan at a step, a gap and a width class is asked
 * for many times in one composition, so it is kept in the composition's memo.
 *
 * @param {Array<{groupIndex: number, groupId: *, cardIds: string[]}>} columnGroups - The column's groups, top to
 *     bottom.
 * @param {boolean} isWideEnoughForAPair - Whether the column is at least a pair's least width.
 * @param {number} stepIndex - Which step.
 * @param {number} pairGapPx - The gap above and below a row that holds a pair.
 * @param {CompositionFacts} compositionFacts - The composition's facts.
 * @returns {object} The plan: see planColumnRows.
 */
function columnPlan(columnGroups, isWideEnoughForAPair, stepIndex, pairGapPx, compositionFacts) {
    const {columnPlansByColumn, steps} = compositionFacts;
    let plansOfTheColumn = columnPlansByColumn.get(columnGroups);
    if (plansOfTheColumn === undefined) {
        plansOfTheColumn = new Map();
        columnPlansByColumn.set(columnGroups, plansOfTheColumn);
    }
    const planKey = `${stepIndex}:${pairGapPx}:${isWideEnoughForAPair}`;
    let plan = plansOfTheColumn.get(planKey);
    if (plan === undefined) {
        plan = planColumnRows(columnGroups, isWideEnoughForAPair, steps[stepIndex], pairGapPx, compositionFacts);
        plansOfTheColumn.set(planKey, plan);
    }
    return plan;
}

/**
 * The fixed height of one tile at a step, or null for the tile that takes the height that is left.
 *
 * @param {string} cardId - The tile's card id.
 * @param {{monitorForm: string}} step - The step.
 * @param {number} heaviestHeightPx - Heaviest's height at the step.
 * @param {boolean} isOnlyTile - Whether the tile is the only one in its column.
 * @param {object} sizes - The sizes in whole pixels.
 * @returns {number|null} The height; null for Sessions, and for Connections alone in its column.
 */
function fixedTileHeightPx(cardId, step, heaviestHeightPx, isOnlyTile, sizes) {
    if (cardId === COCKPIT_TILE_CARD_ID.MONITOR)
        return sizes.monitor.heightPxByForm[step.monitorForm];
    if (cardId === COCKPIT_TILE_CARD_ID.HEAVIEST)
        return heaviestHeightPx;
    if (cardId === COCKPIT_TILE_CARD_ID.CONNECTIONS && !isOnlyTile)
        return sizes.connections.lineHeightPx;
    return null;
}

/**
 * @param {Array<{isPair: boolean, heightPx: number|null}>} rows - Rows, top to bottom.
 * @param {number} pairGapPx - The gap above and below a row that holds a pair.
 * @param {number} betweenBandsPx - The gap between two rows otherwise.
 * @returns {number[]} The gap above each row after the first.
 */
function gapsBetweenRowsPx(rows, pairGapPx, betweenBandsPx) {
    return rows.slice(1).map((row, rowIndexAfterFirst) =>
        row.isPair || rows[rowIndexAfterFirst].isPair ? pairGapPx : betweenBandsPx);
}

/**
 * @param {Array<{heightPx: number|null}>} rows - Rows.
 * @param {number[]} gapsPx - The gaps between them.
 * @returns {number} Their fixed heights and the gaps, the flexible tile counted as nothing.
 */
function rowsHeightPx(rows, gapsPx) {
    const tilesHeightPx = rows.reduce((sum, row) => sum + (row.heightPx ?? 0), 0);
    return tilesHeightPx + gapsPx.reduce((sum, gapPx) => sum + gapPx, 0);
}

/**
 * The rows of one group at a step.
 *
 * @param {string[]} cardIds - The group's cards in this column.
 * @param {object} rowFacts - What every row of the column shares.
 * @param {boolean} rowFacts.isPairStep - Whether a pair forms at this step and width.
 * @param {{monitorForm: string}} rowFacts.step - The step.
 * @param {number} rowFacts.heaviestHeightPx - Heaviest's height at the step.
 * @param {boolean} rowFacts.isOnlyTile - Whether the column holds one tile.
 * @param {object} rowFacts.sizes - The sizes in whole pixels.
 * @returns {Array<{cardIds: string[], isPair: boolean, heightPx: number|null}>} The rows, top to bottom.
 */
function groupRows(cardIds, {isPairStep, step, heaviestHeightPx, isOnlyTile, sizes}) {
    const pairCardIds = [COCKPIT_TILE_CARD_ID.HEAVIEST, COCKPIT_TILE_CARD_ID.CONNECTIONS];
    const rows = [];
    for (let cardIndex = 0; cardIndex < cardIds.length; cardIndex++) {
        const twoCardIds = [cardIds[cardIndex], cardIds[cardIndex + 1]];
        const isPair = isPairStep && pairCardIds.every(cardId => twoCardIds.includes(cardId));
        if (isPair) {
            rows.push({cardIds: twoCardIds, isPair: true, heightPx: heaviestHeightPx});
            cardIndex++;
            continue;
        }
        const heightPx = fixedTileHeightPx(cardIds[cardIndex], step, heaviestHeightPx, isOnlyTile, sizes);
        rows.push({cardIds: [cardIds[cardIndex]], isPair: false, heightPx});
    }
    return rows;
}

/**
 * columnPlan's work, done once for each column, step, gap and width class in a composition.
 *
 * @param {Array<object>} columnGroups - The column's groups, top to bottom.
 * @param {boolean} isWideEnoughForAPair - Whether the column is at least a pair's least width.
 * @param {{monitorForm: string, rankingRowCount: number}} step - The step.
 * @param {number} pairGapPx - The gap above and below a row that holds a pair.
 * @param {CompositionFacts} compositionFacts - The composition's facts.
 * @returns {object} `{groupPlans, fixedHeightPx, otherTilesHeightPx, flexibleCardId, hasPair}`: each group's rows,
 *     the gaps between them and the gap above the group; the height of everything but the flexible tile, plates and
 *     gaps included; the height of the tiles other than Sessions with the gaps between them, group by group, as if
 *     Sessions were not among them; the tile that takes what is left, or null; and whether a row holds a pair.
 */
function planColumnRows(columnGroups, isWideEnoughForAPair, step, pairGapPx, {sizes, plateStandPx}) {
    const columnCardIds = columnGroups.flatMap(group => group.cardIds);
    const holdsSmallMonitor = columnCardIds.includes(COCKPIT_TILE_CARD_ID.MONITOR) &&
        step.monitorForm === SMALLEST_MONITOR_FORM;
    const groupGapPx = holdsSmallMonitor ? sizes.gaps.betweenStackedGroupsSmallMonitorPx
        : sizes.gaps.betweenStackedGroupsPx;
    const rowFacts = {
        isPairStep: step.rankingRowCount === sizes.heaviest.leastRowCount && isWideEnoughForAPair,
        step,
        heaviestHeightPx: sizes.heaviest.fixedHeightPx + step.rankingRowCount * sizes.heaviest.rowHeightPx,
        isOnlyTile: columnCardIds.length === 1,
        sizes,
    };
    let flexibleCardId = null;
    let tilesAndInnerGapsHeightPx = 0;
    let otherTilesHeightPx = 0;
    const groupPlans = columnGroups.map(group => {
        const rows = groupRows(group.cardIds, rowFacts);
        const rowGapsPx = gapsBetweenRowsPx(rows, pairGapPx, sizes.gaps.betweenBandsPx);
        tilesAndInnerGapsHeightPx += rowsHeightPx(rows, rowGapsPx);
        const otherRows = rows.filter(row => row.cardIds[0] !== COCKPIT_TILE_CARD_ID.SESSIONS);
        otherTilesHeightPx += rowsHeightPx(otherRows, gapsBetweenRowsPx(otherRows, pairGapPx, sizes.gaps.betweenBandsPx));
        flexibleCardId = rows.find(row => row.heightPx === null)?.cardIds[0] ?? flexibleCardId;
        return {group, rows, rowGapsPx, groupGapPx};
    });
    const groupGapsHeightPx = Math.max(0, columnGroups.length - 1) * groupGapPx;
    const fixedHeightPx = tilesAndInnerGapsHeightPx + columnGroups.length * plateStandPx + groupGapsHeightPx;
    const hasPair = groupPlans.some(({rows}) => rows.some(row => row.isPair));
    return {groupPlans, fixedHeightPx, otherTilesHeightPx, flexibleCardId, hasPair};
}

/**
 * The height a full machine's group takes under its plate at one step, in a column at the width where the monitor
 * stops gaining.
 *
 * @param {number} stepIndex - Which step.
 * @param {number} pairGapPx - The gap above and below its pair.
 * @param {CompositionFacts} compositionFacts - The composition's facts.
 * @returns {number} The height.
 */
function fullMachineGroupHeightAtStepPx(stepIndex, pairGapPx, compositionFacts) {
    const isWideEnoughForAPair = compositionFacts.sizes.monitor.stopWidthPx >= compositionFacts.pairLeastWidthPx;
    return columnPlan(FULL_MACHINE_GROUPS, isWideEnoughForAPair, stepIndex, pairGapPx, compositionFacts)
        .otherTilesHeightPx;
}

/**
 * The least and the most height a plan's flexible tile may take.
 *
 * @param {object} plan - A column's plan at a step.
 * @param {number} stepIndex - Its step.
 * @param {number} pairGapPx - Its gap around a pair.
 * @param {boolean} isSessionsHeld - Whether Sessions' height is held at each step.
 * @param {CompositionFacts} compositionFacts - The composition's facts.
 * @returns {{leastPx: number, mostPx: number}} The range: nothing for a column with no flexible tile; Infinity as the
 *     most where nothing holds it.
 */
function flexibleHeightRangePx(plan, stepIndex, pairGapPx, isSessionsHeld, compositionFacts) {
    const {sizes} = compositionFacts;
    if (plan.flexibleCardId === COCKPIT_TILE_CARD_ID.SESSIONS) {
        const heldPx = isSessionsHeld
            ? Math.max(plan.otherTilesHeightPx, fullMachineGroupHeightAtStepPx(stepIndex, pairGapPx, compositionFacts))
            : Infinity;
        return {leastPx: sizes.sessions.leastHeightPx, mostPx: heldPx};
    }
    if (plan.flexibleCardId === COCKPIT_TILE_CARD_ID.CONNECTIONS)
        return {leastPx: sizes.connections.listLeastHeightPx, mostPx: sizes.connections.listStopHeightPx};
    return {leastPx: 0, mostPx: 0};
}

/**
 * Fits a column into a height.
 * - Without Sessions: the first step that fits, and at that step a row that holds a pair keeps the largest of its
 *   gaps that fits. Connections alone in its column takes the height there is, between its list's two heights.
 * - With Sessions: at each step Sessions has what the other tiles leave, and a pair keeps its largest gap. The step
 *   that leaves Sessions tallest is taken, the earlier where two are equal. Where Sessions is held, it is at each
 *   step no taller than the column's other tiles with the gaps between them, or than a full machine's group at that
 *   step where that is more.
 *
 * @param {Array<object>} columnGroups - The column's groups, top to bottom.
 * @param {number} widthPx - The column's width.
 * @param {number} heightBudgetPx - The height it may take, plates included.
 * @param {boolean} isSessionsHeld - Whether Sessions' height is held at each step.
 * @param {CompositionFacts} compositionFacts - The composition's facts.
 * @returns {object|null} `{plan, stepIndex, step, flexibleHeightPx, heightPx}`: the plan, its step, the flexible
 *     tile's height and the column's; null where no step fits.
 */
export function fitCockpitColumn(columnGroups, widthPx, heightBudgetPx, isSessionsHeld, compositionFacts) {
    const {sizes, steps, pairLeastWidthPx} = compositionFacts;
    const isWideEnoughForAPair = widthPx >= pairLeastWidthPx;
    let tallestSessionsFit = null;
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        for (const pairGapPx of sizes.gaps.aroundAPairChoicesPx) {
            const plan = columnPlan(columnGroups, isWideEnoughForAPair, stepIndex, pairGapPx, compositionFacts);
            const holdsSessions = plan.flexibleCardId === COCKPIT_TILE_CARD_ID.SESSIONS;
            const {leastPx, mostPx} = flexibleHeightRangePx(plan, stepIndex, pairGapPx, isSessionsHeld, compositionFacts);
            const flexibleHeightPx = Math.min(heightBudgetPx - plan.fixedHeightPx, mostPx);
            if (flexibleHeightPx < leastPx) {
                // Only a pair in a column without Sessions closes its gap to fit: beside Sessions the gap would take
                // from Sessions what the height had just given it.
                if (plan.hasPair && !holdsSessions)
                    continue;
                break;
            }
            const heightPx = plan.fixedHeightPx + flexibleHeightPx;
            const fit = {plan, stepIndex, step: steps[stepIndex], flexibleHeightPx, heightPx};
            if (!holdsSessions)
                return fit;
            if (tallestSessionsFit === null || flexibleHeightPx > tallestSessionsFit.flexibleHeightPx)
                tallestSessionsFit = fit;
            break;
        }
    }
    return tallestSessionsFit;
}

/**
 * The height a full machine's group takes under its plate for a height: its largest step that fits, with the gap
 * its pair keeps. It is what Sessions is measured against where no such group stands beside it.
 *
 * @param {number} heightUnderPlatePx - The height there is under the plate.
 * @param {CompositionFacts} compositionFacts - The composition's facts.
 * @returns {number} The full machine's group's height; the height there is, or 0, where no step fits.
 */
export function fullMachineGroupHeightForPx(heightUnderPlatePx, compositionFacts) {
    const {sizes, plateStandPx} = compositionFacts;
    const heightBudgetPx = heightUnderPlatePx + plateStandPx;
    const fit = fitCockpitColumn(FULL_MACHINE_GROUPS, sizes.monitor.stopWidthPx, heightBudgetPx, false, compositionFacts);
    return fit === null ? Math.max(0, heightUnderPlatePx) : fit.heightPx - plateStandPx;
}

/**
 * One tile's rectangle, with the form its box gives it.
 *
 * @param {string} cardId - The tile's card id.
 * @param {{groupIndex: number, groupId: *}} group - Its group.
 * @param {number[]} rectangle - `[x, y, width, height]`.
 * @param {{monitorForm: string, rankingRowCount: number}} step - The step its column is at.
 * @param {string} connectionsForm - Connections' form, where the tile is Connections.
 * @returns {object} The tile: its card, its group, its rectangle, and the one of `monitorForm`, `rankingRowCount` and
 *     `connectionsForm` that applies to it. Sessions' column count is given it once the arrangement is known.
 */
export function cockpitTileRectangle(cardId, group, [x, y, width, height], step, connectionsForm) {
    const tile = {cardId, groupIndex: group.groupIndex, groupId: group.groupId, x, y, width, height};
    if (cardId === COCKPIT_TILE_CARD_ID.MONITOR)
        tile.monitorForm = step.monitorForm;
    else if (cardId === COCKPIT_TILE_CARD_ID.HEAVIEST)
        tile.rankingRowCount = step.rankingRowCount;
    else if (cardId === COCKPIT_TILE_CARD_ID.CONNECTIONS)
        tile.connectionsForm = connectionsForm;
    return tile;
}

/**
 * The tiles of a row that holds a pair: Connections as wide as its list's stop, or what Heaviest leaves at its stop,
 * and no narrower than its list's least; Heaviest the rest.
 *
 * @param {object} row - The row.
 * @param {object} group - Its group.
 * @param {number[]} rowRectangle - `[x, y, width, height]` of the row.
 * @param {object} step - The column's step.
 * @param {object} sizes - The sizes in whole pixels.
 * @returns {Array<object>} The row's two tiles, left to right.
 */
function pairTiles(row, group, [leftPx, topPx, widthPx, heightPx], step, sizes) {
    const tileGapPx = sizes.gaps.betweenTilesInARowPx;
    const {listLeastWidthPx, listStopWidthPx} = sizes.connections;
    const widthLeftByHeaviestPx = widthPx - tileGapPx - sizes.heaviest.stopWidthPx;
    const connectionsWidthPx = Math.min(listStopWidthPx, Math.max(listLeastWidthPx, widthLeftByHeaviestPx));
    const tiles = [];
    let tileLeftPx = leftPx;
    for (const cardId of row.cardIds) {
        const isConnections = cardId === COCKPIT_TILE_CARD_ID.CONNECTIONS;
        const tileWidthPx = isConnections ? connectionsWidthPx : widthPx - tileGapPx - connectionsWidthPx;
        const tileRectangle = [tileLeftPx, topPx, tileWidthPx, heightPx];
        tiles.push(cockpitTileRectangle(cardId, group, tileRectangle, step, CONNECTIONS_FORM.LIST));
        tileLeftPx += tileWidthPx + tileGapPx;
    }
    return tiles;
}

/**
 * Turns a fitted column into rectangles, from its top left corner. A plate is as wide as its column here; its legend
 * is counted once the arrangement is placed.
 *
 * @param {object} fit - fitCockpitColumn's result.
 * @param {{leftPx: number, topPx: number, widthPx: number}} place - Where the column stands.
 * @param {CompositionFacts} compositionFacts - The composition's facts.
 * @returns {{plates: Array<object>, tiles: Array<object>}} The plates, each `{groupIndex, groupId, x, y,
 *     groupWidthPx, height}`, and the tiles, top to bottom.
 */
export function cockpitColumnRectangles(fit, {leftPx, topPx, widthPx}, {sizes, plateStandPx}) {
    const plates = [];
    const tiles = [];
    const isConnectionsAList = fit.plan.flexibleCardId === COCKPIT_TILE_CARD_ID.CONNECTIONS;
    const connectionsForm = isConnectionsAList ? CONNECTIONS_FORM.LIST : CONNECTIONS_FORM.LINE;
    let cursorTopPx = topPx;
    fit.plan.groupPlans.forEach(({group, rows, rowGapsPx, groupGapPx}, groupPlace) => {
        if (groupPlace > 0)
            cursorTopPx += groupGapPx;
        const {groupIndex, groupId} = group;
        plates.push({groupIndex, groupId, x: leftPx, y: cursorTopPx, groupWidthPx: widthPx, height: sizes.plate.heightPx});
        cursorTopPx += plateStandPx;
        rows.forEach((row, rowIndex) => {
            if (rowIndex > 0)
                cursorTopPx += rowGapsPx[rowIndex - 1];
            const rowHeightPx = row.heightPx ?? fit.flexibleHeightPx;
            const rowRectangle = [leftPx, cursorTopPx, widthPx, rowHeightPx];
            if (row.isPair)
                tiles.push(...pairTiles(row, group, rowRectangle, fit.step, sizes));
            else
                tiles.push(cockpitTileRectangle(row.cardIds[0], group, rowRectangle, fit.step, connectionsForm));
            cursorTopPx += rowHeightPx;
        });
    });
    return {plates, tiles};
}

/**
 * The least width of a column's tiles other than Sessions. Connections is one line, at a line's least width, where
 * its column holds another tile, Sessions counted; alone in its column it is a list.
 *
 * @param {string[]} cardIds - Every card of the column, Sessions among them where it is there.
 * @param {boolean} standsBesideAnotherColumn - Whether another column stands beside it.
 * @param {object} sizes - The sizes in whole pixels.
 * @returns {number} The least width; 0 with no such tile.
 */
export function machineTilesLeastWidthPx(cardIds, standsBesideAnotherColumn, sizes) {
    const monitorLeastWidthPx = standsBesideAnotherColumn ? sizes.monitor.leastWidthBesideAnotherColumnPx
        : sizes.monitor.leastWidthPx;
    const connectionsLeastWidthPx = cardIds.length > 1 ? sizes.connections.lineLeastWidthPx
        : sizes.connections.listLeastWidthPx;
    return Math.max(
        cardIds.includes(COCKPIT_TILE_CARD_ID.MONITOR) ? monitorLeastWidthPx : 0,
        cardIds.includes(COCKPIT_TILE_CARD_ID.HEAVIEST) ? sizes.heaviest.leastWidthPx : 0,
        cardIds.includes(COCKPIT_TILE_CARD_ID.CONNECTIONS) ? connectionsLeastWidthPx : 0);
}

/**
 * Where a column of the machine's tiles stops gaining width: Connections alone at its list's stop, Heaviest alone at
 * its own stop, anything else where the monitor stops.
 *
 * @param {string[]} cardIds - Every card of the column; Sessions is not among them.
 * @param {object} sizes - The sizes in whole pixels.
 * @returns {number} The width.
 */
export function machineColumnStopWidthPx(cardIds, sizes) {
    if (cardIds.length === 1 && cardIds[0] === COCKPIT_TILE_CARD_ID.CONNECTIONS)
        return sizes.connections.listStopWidthPx;
    if (cardIds.length === 1 && cardIds[0] === COCKPIT_TILE_CARD_ID.HEAVIEST)
        return sizes.heaviest.stopWidthPx;
    return sizes.monitor.stopWidthPx;
}
