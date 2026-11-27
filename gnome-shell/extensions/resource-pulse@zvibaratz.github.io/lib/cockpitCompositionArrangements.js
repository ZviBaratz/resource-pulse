// The cockpit's three arrangements: Sessions' column beside the others' column, every group stacked in one column,
// and every tile in one row. Each fits the room it is given or gives null, and holds as many of Sessions' columns as
// the held count asks, up to the most it has room for. Pure: no Gio, GLib or Shell import, so it runs under plain gjs.
//
// An arrangement's rectangles are measured from its own top left corner; the composition centres it in the work
// area and gives each plate its legend's width.
import {COCKPIT_TILE_CARD_ID, CONNECTIONS_FORM, MONITOR_FORMS_LARGEST_FIRST} from './cockpitCompositionGroups.js';
import {
    MOST_SESSIONS_COLUMN_COUNT, mostSessionsColumnCountIn, plateLegendWidthPx, sessionsLeastWidthPx, sessionsStopWidthPx,
} from './cockpitCompositionSizes.js';
import {
    cockpitColumnRectangles, cockpitTileRectangle, fitCockpitColumn, fullMachineGroupHeightForPx,
    machineColumnStopWidthPx, machineTilesLeastWidthPx,
} from './cockpitCompositionColumn.js';

const LARGEST_MONITOR_FORM = MONITOR_FORMS_LARGEST_FIRST[0];
/** The order in which one row's tiles give width, after the gaps between its groups. */
const ONE_ROW_CARD_IDS_IN_THE_ORDER_THEY_GIVE = Object.freeze([
    COCKPIT_TILE_CARD_ID.MONITOR, COCKPIT_TILE_CARD_ID.SESSIONS, COCKPIT_TILE_CARD_ID.HEAVIEST,
    COCKPIT_TILE_CARD_ID.CONNECTIONS,
]);

/**
 * @typedef {object} CockpitRoom
 * What an arrangement is fitted to, for one composition.
 * @property {{x: number, y: number, width: number, height: number}} workArea - The work area in whole pixels.
 * @property {number} availableWidthPx - The work area's width inside its margins.
 * @property {number} availableHeightPx - Its height inside its margins.
 * @property {{drawnGroups: Array<object>, cardIds: string[], sideBySideCut: object|null}} layout - The layout's
 *     tiles, from compositionGroupsOf.
 * @property {object} compositionFacts - The composition's facts (see cockpitCompositionColumn.js).
 * @property {*} legendWidthsPx - Each plate's legend width by its group's place, or null where none is given.
 * @property {number} heldColumnCount - Sessions' held columns, from 1 to MOST_SESSIONS_COLUMN_COUNT.
 */

/**
 * @typedef {object} CockpitArranged
 * An arrangement that fits, before it is centred.
 * @property {number} widthPx - Its width.
 * @property {number} heightPx - Its height.
 * @property {Array<object>} plates - Its plates, each `{groupIndex, groupId, x, y, groupWidthPx, height}`.
 * @property {Array<object>} tiles - Its tiles, column by column from the left, each column from the top.
 * @property {number} sessionsColumnCount - The columns Sessions has; 0 without Sessions.
 * @property {number} mostSessionsColumnCount - The most it has room for; 0 without Sessions.
 */

/**
 * Takes a shortfall out of a length, as far as its least.
 *
 * @param {number} lengthPx - The length.
 * @param {number} leastPx - Its least.
 * @param {number} shortfallPx - What is still to give.
 * @returns {{lengthPx: number, shortfallPx: number}} The length after giving, and what is left to give.
 */
function giveWidth(lengthPx, leastPx, shortfallPx) {
    const givenPx = Math.max(0, Math.min(shortfallPx, lengthPx - leastPx));
    return {lengthPx: lengthPx - givenPx, shortfallPx: shortfallPx - givenPx};
}

/**
 * @param {Array<{groupIndex: number}>} columnGroups - A column's groups.
 * @param {*} legendWidthsPx - The legends to count, or null for none.
 * @returns {number} The widest of their plates' legends; 0 where none is known.
 */
function widestLegendPx(columnGroups, legendWidthsPx) {
    return columnGroups.reduce((widest, group) => Math.max(widest, plateLegendWidthPx(legendWidthsPx, group.groupIndex)), 0);
}

/**
 * @param {number} heldColumnCount - Sessions' held columns.
 * @param {number} mostColumnCount - The most it has room for.
 * @returns {number} The columns Sessions has: the held count, up to the most, and at least one.
 */
function sessionsColumnCountOf(heldColumnCount, mostColumnCount) {
    return Math.min(Math.max(1, heldColumnCount), mostColumnCount);
}

// ---------------------------------------------------------------------------------------------------------------
// Side by side
// ---------------------------------------------------------------------------------------------------------------

/**
 * The least and stop widths of side by side's two columns and of the gap between them, with some plates' legends
 * counted: a legend asks for width between its column's least and its stop.
 *
 * @param {object} sideBySideCut - The layout's cut in two.
 * @param {number} columnCount - Sessions' columns.
 * @param {*} legendWidthsPx - The legends to count, or null for none.
 * @param {object} sizes - The sizes in whole pixels.
 * @returns {object} `{gap, other, sessions}`, each `{mostPx, leastPx}`, with `legendPx` for the two columns.
 */
function sideBySideWidthRangesPx(sideBySideCut, columnCount, legendWidthsPx, sizes) {
    const {otherGroups, sessionsGroups, otherCardIds, sessionsColumnCardIds, isInsideOneGroup} = sideBySideCut;
    const {isSessionsAloneInItsColumn} = sideBySideCut;
    const gapMostPx = isInsideOneGroup ? sizes.gaps.betweenTilesInARowPx : sizes.gaps.betweenColumnsMostPx;
    const gapLeastPx = isInsideOneGroup ? sizes.gaps.betweenTilesInARowPx : sizes.gaps.betweenColumnsLeastPx;
    const otherLeastPx = machineTilesLeastWidthPx(otherCardIds, true, sizes);
    const otherStopPx = Math.max(otherLeastPx, machineColumnStopWidthPx(otherCardIds, sizes));
    // Sessions alone in its column sets the column's width by its columns. With other tiles the column is as wide as
    // a column that stands alone, and Sessions takes the columns that fit it.
    const sessionsLeastPx = isSessionsAloneInItsColumn ? sessionsLeastWidthPx(sizes, columnCount)
        : Math.max(machineTilesLeastWidthPx(sessionsColumnCardIds, true, sizes), sessionsLeastWidthPx(sizes, 1));
    const sessionsOwnStopPx = isSessionsAloneInItsColumn ? sessionsStopWidthPx(sizes, columnCount)
        : sizes.columnWithSessionsStopWidthPx;
    const sessionsStopPx = Math.max(sessionsLeastPx, sessionsOwnStopPx);
    const legendWithin = (columnGroups, leastPx, stopPx) =>
        Math.min(stopPx, Math.max(leastPx, widestLegendPx(columnGroups, legendWidthsPx)));
    return {
        gap: {mostPx: gapMostPx, leastPx: gapLeastPx},
        other: {mostPx: otherStopPx, leastPx: otherLeastPx, legendPx: legendWithin(otherGroups, otherLeastPx, otherStopPx)},
        sessions: {
            mostPx: sessionsStopPx, leastPx: sessionsLeastPx,
            legendPx: legendWithin(sessionsGroups, sessionsLeastPx, sessionsStopPx),
        },
    };
}

/**
 * Side by side's widths for the room: the shortfall given by the gap between the columns, then the others' column
 * as far as its legend, then Sessions' as far as its own, then each column as far as its least. A plate's whole
 * legend is given up last.
 *
 * @param {object} widthRangesPx - sideBySideWidthRangesPx's result.
 * @param {number} availableWidthPx - The room's width.
 * @returns {{gapPx: number, otherWidthPx: number, sessionsWidthPx: number}|null} The widths; null where they do not
 *     fit at their least.
 */
function sideBySideWidthsPx({gap, other, sessions}, availableWidthPx) {
    const shortfallPx = Math.max(0, other.mostPx + gap.mostPx + sessions.mostPx - availableWidthPx);
    const gapGiven = giveWidth(gap.mostPx, gap.leastPx, shortfallPx);
    let otherGiven = giveWidth(other.mostPx, other.legendPx, gapGiven.shortfallPx);
    let sessionsGiven = giveWidth(sessions.mostPx, sessions.legendPx, otherGiven.shortfallPx);
    otherGiven = giveWidth(otherGiven.lengthPx, other.leastPx, sessionsGiven.shortfallPx);
    sessionsGiven = giveWidth(sessionsGiven.lengthPx, sessions.leastPx, otherGiven.shortfallPx);
    if (sessionsGiven.shortfallPx > 0)
        return null;
    return {gapPx: gapGiven.lengthPx, otherWidthPx: otherGiven.lengthPx, sessionsWidthPx: sessionsGiven.lengthPx};
}

/**
 * Side by side for one count of Sessions' columns, with some plates' legends counted in the widths: the widths the
 * two columns take and the fit of each to the height. Sessions alone in its column is as tall as the column beside
 * it, and at least as tall as it would be beside a full machine's group. A column that holds Sessions with other
 * tiles is fitted as a column that stands alone: to the room's height, with Sessions held.
 *
 * @param {CockpitRoom} room - The room.
 * @param {number} columnCount - Sessions' columns.
 * @param {*} legendWidthsPx - The legends to count, or null for none.
 * @returns {object|null} `{gapPx, otherWidthPx, sessionsWidthPx, otherFit, sessionsFit}`; null where it does not fit.
 */
function fitSideBySide({availableWidthPx, availableHeightPx, layout, compositionFacts}, columnCount, legendWidthsPx) {
    const {sizes, plateStandPx} = compositionFacts;
    const {otherGroups, sessionsGroups, isSessionsAloneInItsColumn} = layout.sideBySideCut;
    const widthRangesPx = sideBySideWidthRangesPx(layout.sideBySideCut, columnCount, legendWidthsPx, sizes);
    const widthsPx = sideBySideWidthsPx(widthRangesPx, availableWidthPx);
    if (widthsPx === null)
        return null;
    const otherFit = fitCockpitColumn(otherGroups, widthsPx.otherWidthPx, availableHeightPx, false, compositionFacts);
    if (otherFit === null)
        return null;
    let sessionsFit;
    if (isSessionsAloneInItsColumn) {
        const fullMachineHeightPx = fullMachineGroupHeightForPx(availableHeightPx - plateStandPx, compositionFacts);
        const rowHeightPx = Math.max(otherFit.heightPx, plateStandPx + fullMachineHeightPx);
        sessionsFit = fitCockpitColumn(sessionsGroups, widthsPx.sessionsWidthPx, rowHeightPx, false, compositionFacts);
    } else {
        sessionsFit = fitCockpitColumn(sessionsGroups, widthsPx.sessionsWidthPx, availableHeightPx, true, compositionFacts);
    }
    return sessionsFit === null ? null : {...widthsPx, otherFit, sessionsFit};
}

/**
 * Whether two fits of one column are the same but in width: the same step, the same pair, and the same heights.
 *
 * @param {object} fit - One of fitCockpitColumn's results.
 * @param {object} otherFit - Another, for the same column at another width.
 * @returns {boolean} True where nothing but the width differs.
 */
function isSameButInWidth(fit, otherFit) {
    return fit.stepIndex === otherFit.stepIndex && fit.plan.hasPair === otherFit.plan.hasPair &&
        fit.heightPx === otherFit.heightPx && fit.flexibleHeightPx === otherFit.flexibleHeightPx;
}

/**
 * Side by side for one count of Sessions' columns. A plate's legend changes nothing but widths: whether the
 * arrangement fits, each column's step and heights, and the columns Sessions may take are decided without legends,
 * and the widths the legends ask for are taken only where they change none of that.
 *
 * @param {CockpitRoom} room - The room.
 * @param {number} columnCount - Sessions' columns.
 * @returns {object|null} fitSideBySide's result, or null where it does not fit without legends.
 */
function fitSideBySideWithLegends(room, columnCount) {
    const fitWithoutLegends = fitSideBySide(room, columnCount, null);
    const {sideBySideCut} = room.layout;
    if (fitWithoutLegends === null || sideBySideCut.isInsideOneGroup || room.legendWidthsPx === null)
        return fitWithoutLegends;
    const fitWithLegends = fitSideBySide(room, columnCount, room.legendWidthsPx);
    if (fitWithLegends === null)
        return fitWithoutLegends;
    const {sizes} = room.compositionFacts;
    const isSessionsCountKept = sideBySideCut.isSessionsAloneInItsColumn ||
        mostSessionsColumnCountIn(sizes, fitWithLegends.sessionsWidthPx) ===
            mostSessionsColumnCountIn(sizes, fitWithoutLegends.sessionsWidthPx);
    const doLegendsChangeWidthsOnly = isSessionsCountKept &&
        isSameButInWidth(fitWithLegends.otherFit, fitWithoutLegends.otherFit) &&
        isSameButInWidth(fitWithLegends.sessionsFit, fitWithoutLegends.sessionsFit);
    return doLegendsChangeWidthsOnly ? fitWithLegends : fitWithoutLegends;
}

/**
 * The fit with Sessions' columns, and the most it has room for. Sessions alone in its column holds one more column
 * only where the others' column stays as it is with one column but in width: a column more takes width from that
 * column and can take it under its pair's width, where it would stand in bands, taller, and could lose a step or
 * stop fitting. So the count never changes a form, a height, or whether the cockpit is drawn.
 *
 * @param {CockpitRoom} room - The room.
 * @param {object} fitWithOneColumn - The fit with one column of Sessions.
 * @returns {{chosenFit: object, mostColumnCount: number}} The fit for the held count, and the most columns.
 */
function sideBySideColumnsOf(room, fitWithOneColumn) {
    const {layout, compositionFacts, heldColumnCount} = room;
    if (!layout.sideBySideCut.isSessionsAloneInItsColumn) {
        const mostColumnCount = Math.max(1, mostSessionsColumnCountIn(compositionFacts.sizes, fitWithOneColumn.sessionsWidthPx));
        return {chosenFit: fitWithOneColumn, mostColumnCount};
    }
    let chosenFit = fitWithOneColumn;
    let mostColumnCount = 1;
    while (mostColumnCount < MOST_SESSIONS_COLUMN_COUNT) {
        const fitWithOneMore = fitSideBySideWithLegends(room, mostColumnCount + 1);
        if (fitWithOneMore === null || !isSameButInWidth(fitWithOneMore.otherFit, fitWithOneColumn.otherFit))
            break;
        mostColumnCount++;
        if (mostColumnCount <= heldColumnCount)
            chosenFit = fitWithOneMore;
    }
    return {chosenFit, mostColumnCount};
}

/**
 * Sessions' column beside the others' column, on the right, or on the left where Sessions comes first. Sessions has
 * the held count of columns, and no more than the most with which the arrangement fits and the others' column is as
 * it is with one column, but in width.
 *
 * @param {CockpitRoom} room - The room.
 * @returns {CockpitArranged|null} The arrangement, or null where it does not apply or does not fit.
 */
export function sideBySideArrangement(room) {
    const {layout, compositionFacts, heldColumnCount} = room;
    if (layout.sideBySideCut === null)
        return null;
    const {isInsideOneGroup, isSessionsFirst} = layout.sideBySideCut;
    const fitWithOneColumn = fitSideBySideWithLegends(room, 1);
    if (fitWithOneColumn === null)
        return null;
    const {chosenFit, mostColumnCount} = sideBySideColumnsOf(room, fitWithOneColumn);
    const {gapPx, otherWidthPx, sessionsWidthPx, otherFit, sessionsFit} = chosenFit;
    const otherLeftPx = isSessionsFirst ? sessionsWidthPx + gapPx : 0;
    const sessionsLeftPx = isSessionsFirst ? 0 : otherWidthPx + gapPx;
    const otherPlace = {leftPx: otherLeftPx, topPx: 0, widthPx: otherWidthPx};
    const sessionsPlace = {leftPx: sessionsLeftPx, topPx: 0, widthPx: sessionsWidthPx};
    const otherRectangles = cockpitColumnRectangles(otherFit, otherPlace, compositionFacts);
    const sessionsRectangles = cockpitColumnRectangles(sessionsFit, sessionsPlace, compositionFacts);
    const columnsLeftToRight = isSessionsFirst ? [sessionsRectangles, otherRectangles] : [otherRectangles, sessionsRectangles];
    const widthPx = otherWidthPx + gapPx + sessionsWidthPx;
    // Inside one group there is one plate: the left column's, over the whole group.
    const plates = isInsideOneGroup ? [{...columnsLeftToRight[0].plates[0], groupWidthPx: widthPx}]
        : columnsLeftToRight.flatMap(rectangles => rectangles.plates);
    return {
        widthPx,
        heightPx: Math.max(otherFit.heightPx, sessionsFit.heightPx),
        plates,
        tiles: columnsLeftToRight.flatMap(rectangles => rectangles.tiles),
        sessionsColumnCount: sessionsColumnCountOf(heldColumnCount, mostColumnCount),
        mostSessionsColumnCount: mostColumnCount,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Stacked
// ---------------------------------------------------------------------------------------------------------------

/**
 * The stack's column width, and the most columns of Sessions it holds. Sessions alone is as wide as its held
 * columns at their stop; any other column is as wide as it may be up to where its tiles stop gaining.
 *
 * @param {CockpitRoom} room - The room.
 * @returns {{columnWidthPx: number, mostColumnCount: number}|null} The width and the most columns; null where the
 *     room is narrower than the column's least.
 */
function stackedColumnWidthOf({availableWidthPx, layout, compositionFacts, heldColumnCount}) {
    const {sizes} = compositionFacts;
    const {cardIds} = layout;
    const holdsSessions = cardIds.includes(COCKPIT_TILE_CARD_ID.SESSIONS);
    if (holdsSessions && cardIds.length === 1) {
        const mostColumnCount = mostSessionsColumnCountIn(sizes, availableWidthPx);
        if (mostColumnCount === 0)
            return null;
        const columnCount = sessionsColumnCountOf(heldColumnCount, mostColumnCount);
        return {columnWidthPx: Math.min(availableWidthPx, sessionsStopWidthPx(sizes, columnCount)), mostColumnCount};
    }
    const machineCardIds = cardIds.filter(cardId => cardId !== COCKPIT_TILE_CARD_ID.SESSIONS);
    const sessionsLeastPx = holdsSessions ? sessionsLeastWidthPx(sizes, 1) : 0;
    const leastWidthPx = Math.max(machineTilesLeastWidthPx(cardIds, false, sizes), sessionsLeastPx);
    const stopWidthPx = holdsSessions ? sizes.columnWithSessionsStopWidthPx : machineColumnStopWidthPx(machineCardIds, sizes);
    if (availableWidthPx < leastWidthPx)
        return null;
    const columnWidthPx = Math.min(availableWidthPx, Math.max(leastWidthPx, stopWidthPx));
    return {columnWidthPx, mostColumnCount: holdsSessions ? mostSessionsColumnCountIn(sizes, columnWidthPx) : 0};
}

/**
 * Every group in one column, in the layout's order, Sessions held.
 *
 * @param {CockpitRoom} room - The room.
 * @returns {CockpitArranged|null} The arrangement, or null where it does not fit.
 */
export function stackedArrangement(room) {
    const column = stackedColumnWidthOf(room);
    if (column === null)
        return null;
    const {availableHeightPx, layout, compositionFacts, heldColumnCount} = room;
    const fit = fitCockpitColumn(layout.drawnGroups, column.columnWidthPx, availableHeightPx, true, compositionFacts);
    if (fit === null)
        return null;
    const rectangles = cockpitColumnRectangles(fit, {leftPx: 0, topPx: 0, widthPx: column.columnWidthPx}, compositionFacts);
    const holdsSessions = layout.cardIds.includes(COCKPIT_TILE_CARD_ID.SESSIONS);
    return {
        widthPx: column.columnWidthPx,
        heightPx: fit.heightPx,
        plates: rectangles.plates,
        tiles: rectangles.tiles,
        sessionsColumnCount: holdsSessions ? sessionsColumnCountOf(heldColumnCount, column.mostColumnCount) : 0,
        mostSessionsColumnCount: column.mostColumnCount,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {object} sizes - The sizes in whole pixels.
 * @returns {object} Each tile's least and stop width in one row, by its card id.
 */
function oneRowWidthRangesPx(sizes) {
    const {monitor, oneRow: oneRowSizes} = sizes;
    const sessionsLeastPx = sessionsLeastWidthPx(sizes, oneRowSizes.sessionsColumnCount);
    return {
        [COCKPIT_TILE_CARD_ID.MONITOR]: {
            leastPx: monitor.leastWidthBesideAnotherColumnPx,
            stopPx: Math.max(monitor.leastWidthBesideAnotherColumnPx, monitor.stopWidthPx),
        },
        [COCKPIT_TILE_CARD_ID.HEAVIEST]: {leastPx: oneRowSizes.heaviestWidthPx, stopPx: oneRowSizes.heaviestWidthPx},
        [COCKPIT_TILE_CARD_ID.CONNECTIONS]: {leastPx: oneRowSizes.connectionsWidthPx, stopPx: oneRowSizes.connectionsWidthPx},
        [COCKPIT_TILE_CARD_ID.SESSIONS]: {
            leastPx: sessionsLeastPx,
            stopPx: Math.max(sessionsLeastPx, sessionsStopWidthPx(sizes, oneRowSizes.sessionsColumnCount)),
        },
    };
}

/**
 * One row's widths for the room: the gaps between groups give together, each the same whole number of pixels, then
 * the monitor, Sessions, Heaviest and Connections in turn, each as far as its least.
 *
 * @param {CockpitRoom} room - The room.
 * @returns {{groupGapPx: number, widthPxByCardId: object}|null} The gap between groups and each tile's width; null
 *     where the row is wider than the room at its least.
 */
function oneRowWidthsPx({availableWidthPx, layout, compositionFacts}) {
    const {gaps} = compositionFacts.sizes;
    const {drawnGroups, cardIds} = layout;
    const widthRangePxByCardId = oneRowWidthRangesPx(compositionFacts.sizes);
    const groupGapCount = drawnGroups.length - 1;
    const tileGapsPx = (cardIds.length - drawnGroups.length) * gaps.betweenTilesInARowPx;
    const sumOver = pickLength => cardIds.reduce((sum, cardId) => sum + pickLength(widthRangePxByCardId[cardId]), 0);
    const leastWidthPx = sumOver(range => range.leastPx) + tileGapsPx + groupGapCount * gaps.betweenColumnsLeastPx;
    if (leastWidthPx > availableWidthPx)
        return null;
    const stopWidthPx = sumOver(range => range.stopPx) + tileGapsPx + groupGapCount * gaps.betweenColumnsMostPx;
    let shortfallPx = Math.max(0, stopWidthPx - availableWidthPx);
    const mostAGroupGapGivesPx = Math.max(0, gaps.betweenColumnsMostPx - gaps.betweenColumnsLeastPx);
    const givenByEachGroupGapPx = groupGapCount === 0 ? 0
        : Math.min(mostAGroupGapGivesPx, Math.ceil(shortfallPx / groupGapCount));
    shortfallPx = Math.max(0, shortfallPx - givenByEachGroupGapPx * groupGapCount);
    const widthPxByCardId = {};
    for (const cardId of ONE_ROW_CARD_IDS_IN_THE_ORDER_THEY_GIVE) {
        const range = widthRangePxByCardId[cardId];
        const isDrawn = cardIds.includes(cardId);
        const given = giveWidth(range.stopPx, range.leastPx, isDrawn ? shortfallPx : 0);
        widthPxByCardId[cardId] = given.lengthPx;
        shortfallPx = isDrawn ? given.shortfallPx : shortfallPx;
    }
    return {groupGapPx: gaps.betweenColumnsMostPx - givenByEachGroupGapPx, widthPxByCardId};
}

/**
 * Every tile in one row, on a work area that holds it and, unless this is the last try, is wider than the sizes'
 * aspect. Every tile is as tall as the monitor's wide form, at the largest step, and Connections is a list.
 *
 * @param {CockpitRoom} room - The room.
 * @param {boolean} mustBeWiderThanTheAspect - False for the last try, where nothing else fits: then the row is drawn
 *     wherever it fits, so that the aspect chooses between arrangements and never removes the cockpit.
 * @returns {CockpitArranged|null} The arrangement, or null where it does not apply or does not fit.
 */
export function oneRowArrangement(room, mustBeWiderThanTheAspect) {
    const {workArea, availableHeightPx, layout, compositionFacts, heldColumnCount} = room;
    const {sizes, plateStandPx, steps} = compositionFacts;
    const {oneRow: oneRowSizes, gaps} = sizes;
    const isWiderThanTheAspect = oneRowSizes.aspectWidth * workArea.height < oneRowSizes.aspectHeight * workArea.width;
    const rowHeightPx = sizes.monitor.heightPxByForm[LARGEST_MONITOR_FORM];
    const isRuledOut = layout.cardIds.length < oneRowSizes.leastTileCount ||
        (mustBeWiderThanTheAspect && !isWiderThanTheAspect) || plateStandPx + rowHeightPx > availableHeightPx;
    const widthsPx = isRuledOut ? null : oneRowWidthsPx(room);
    if (widthsPx === null)
        return null;
    const {groupGapPx, widthPxByCardId} = widthsPx;
    const plates = [];
    const tiles = [];
    let cursorLeftPx = 0;
    layout.drawnGroups.forEach((group, groupPlace) => {
        if (groupPlace > 0)
            cursorLeftPx += groupGapPx;
        const groupLeftPx = cursorLeftPx;
        group.cardIds.forEach((cardId, cardIndex) => {
            if (cardIndex > 0)
                cursorLeftPx += gaps.betweenTilesInARowPx;
            const tileRectangle = [cursorLeftPx, plateStandPx, widthPxByCardId[cardId], rowHeightPx];
            tiles.push(cockpitTileRectangle(cardId, group, tileRectangle, steps[0], CONNECTIONS_FORM.LIST));
            cursorLeftPx += widthPxByCardId[cardId];
        });
        const groupWidthPx = cursorLeftPx - groupLeftPx;
        const {groupIndex, groupId} = group;
        plates.push({groupIndex, groupId, x: groupLeftPx, y: 0, groupWidthPx, height: sizes.plate.heightPx});
    });
    const holdsSessions = layout.cardIds.includes(COCKPIT_TILE_CARD_ID.SESSIONS);
    const sessionsRoomColumnCount = mostSessionsColumnCountIn(sizes, widthPxByCardId[COCKPIT_TILE_CARD_ID.SESSIONS]);
    const mostColumnCount = holdsSessions ? Math.max(1, Math.min(oneRowSizes.sessionsColumnCount, sessionsRoomColumnCount)) : 0;
    return {
        widthPx: cursorLeftPx,
        heightPx: plateStandPx + rowHeightPx,
        plates,
        tiles,
        sessionsColumnCount: holdsSessions ? sessionsColumnCountOf(heldColumnCount, mostColumnCount) : 0,
        mostSessionsColumnCount: mostColumnCount,
    };
}
