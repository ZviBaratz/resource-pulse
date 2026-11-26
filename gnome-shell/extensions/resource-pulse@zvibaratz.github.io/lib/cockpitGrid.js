// The cockpit's grid geometry: which cell each card gets on the cockpit monitor's work area, and whether a work area
// holds the grid of a layout with the cards' content clear of each other. Pure: no Gio, GLib or Shell import, so it
// runs under plain gjs; the shell glue draws what this returns.
//
// The grid is laid out at a 1920 x 1080 reference (COCKPIT_GRID_REFERENCE: 420 x 300 cells, 24 px gutters, a 48 px gap
// between groups, a 28 px caption row) and every length is scaled and floored. What is scaled is the frame the layout
// uses: its groups' columns side by side, and the most rows a group needs (at most the reference's three). Its scale
// is min(what fits, clamp(raw, 1, COCKPIT_GRID_MAX_SCALE)), where raw is min(width / 1920, height / 1080) and what fits
// is the largest scale at which the frame fits the work area inside a LEAST_GRID_MARGIN_PX margin on every side. So at
// 1920 x 1080 or larger the grid grows with the work area, up to double; on a smaller one it keeps the reference's
// lengths while its frame fits, and shrinks just enough to fit where it does not. The grid is centred on the columns
// and rows it uses.
//
// The cards' content does not scale, so the grid is drawn (isCockpitGridDrawable) only where a scaled cell and its
// inner gutter hold the widest card content, COCKPIT_CARD_CONTENT_WIDTH_PX, and the scaled frame fits inside the
// margin. Under a scale of 1 a card's widest rows may reach a few pixels past its cell: into the gutter, which is
// what it is for, and in the right-most column into the margin, which is never under 12 px. The fit assumes GNOME's
// default text size, as the content width does: with larger text a card is wider than its cell.
import {
    COCKPIT_CARD_CONTENT_WIDTH_PX, COCKPIT_DRAWN_CARD_IDS, COCKPIT_GRID_MAX_SCALE, COCKPIT_GRID_REFERENCE,
} from './constants.js';

/** Added before flooring, so a product like 420 x (2/3) that floating point leaves a hair under 280 floors to 280. */
const FLOOR_TOLERANCE = 1e-9;
/** The work area the grid's reference lengths are given for, at the stage's origin. */
const REFERENCE_WORK_AREA = Object.freeze({
    x: 0, y: 0, width: COCKPIT_GRID_REFERENCE.widthPx, height: COCKPIT_GRID_REFERENCE.heightPx,
});
/**
 * The scale at which every length is the reference's own; a work area smaller than the reference is not scaled under
 * it unless the frame would not fit.
 */
const UNSCALED = 1;
/** The fewest rows the frame has, so that its height is a number for any layout, one with no groups included. */
const LEAST_ROW_COUNT = 1;
/**
 * The least margin between the grid and each edge of the work area, in logical pixels. 12 keeps a 1280 x 688 work
 * area drawing the template (at 24 it would not), and it leaves room for a right-most card's widest rows.
 */
const LEAST_GRID_MARGIN_PX = 12;
/**
 * leastDrawableWorkArea searches each length between 0 and a length sure to draw the grid: this many times the
 * reference length, or the frame at the reference plus both margins, whichever is larger.
 */
const LEAST_SIZE_BOUND_FACTOR = 2;

/**
 * @typedef {object} GridCounts
 * @property {number} columnCount - The columns of every group together.
 * @property {number} innerGutterCount - The inner gutters of every group together: one fewer than its columns, and
 *     none for a group of no column, so that a group of no column never narrows the frame.
 * @property {number} groupCount - The groups.
 * @property {number} rowCount - The rows the frame has: the most any group needs, from 1 to the reference's rows.
 */

/**
 * @param {number} lengthPx - A length in reference pixels.
 * @param {number} scale - The grid scale.
 * @returns {number} The length scaled, as a floored integer.
 */
function scaledLength(lengthPx, scale) {
    return Math.floor(lengthPx * scale + FLOOR_TOLERANCE);
}

/**
 * @param {{columns: number}} group - One of the layout's groups.
 * @returns {number} The inner gutters between the group's columns: one fewer than its columns, none with no column.
 */
function innerGuttersOf(group) {
    return Math.max(0, group.columns - 1);
}

/**
 * @param {{columns: number, cards: string[]}} group - One of the layout's groups.
 * @returns {number} The rows the group's cards need: ceil(cards / columns), or none for a group with no column or no
 *     card. Every card id counts, known or not, as every one gets a cell.
 */
function rowsNeededBy(group) {
    const hasCells = group.columns >= 1 && group.cards.length > 0;
    return hasCells ? Math.ceil(group.cards.length / group.columns) : 0;
}

/**
 * Reduces a layout to the counts its frame depends on, once, so that a search over work areas does not walk the
 * groups at every step. Folded with reduce, never spread into Math.max, so that no number of groups can throw.
 *
 * @param {Array<{columns: number, cards: string[]}>} groups - The layout's groups.
 * @returns {GridCounts} The layout's counts.
 */
function gridCountsOf(groups) {
    const mostRowsNeeded = groups.reduce((most, group) => Math.max(most, rowsNeededBy(group)), LEAST_ROW_COUNT);
    return {
        columnCount: groups.reduce((sum, group) => sum + group.columns, 0),
        innerGutterCount: groups.reduce((sum, group) => sum + innerGuttersOf(group), 0),
        groupCount: groups.length,
        rowCount: Math.min(COCKPIT_GRID_REFERENCE.rows, mostRowsNeeded),
    };
}

/**
 * @param {GridCounts} counts - The layout's counts.
 * @param {number} scale - The grid scale.
 * @returns {{cellWidth: number, cellHeight: number, innerGutter: number, groupGap: number, rowGutter: number,
 *     captionHeight: number, gridWidth: number, gridHeight: number}} The frame's scaled, floored lengths, and its
 *     size: each group's columns with an inner gutter between them, a group gap between groups, and the caption row
 *     over the rows used.
 */
function gridFrameAt({columnCount, innerGutterCount, groupCount, rowCount}, scale) {
    const reference = COCKPIT_GRID_REFERENCE;
    const cellWidth = scaledLength(reference.cellWidthPx, scale);
    const cellHeight = scaledLength(reference.cellHeightPx, scale);
    const innerGutter = scaledLength(reference.innerGutterPx, scale);
    const groupGap = scaledLength(reference.groupGapPx, scale);
    const rowGutter = scaledLength(reference.rowGutterPx, scale);
    const captionHeight = scaledLength(reference.captionHeightPx, scale);
    const groupsWidth = columnCount * cellWidth + innerGutterCount * innerGutter;
    const gridWidth = groupsWidth + Math.max(0, groupCount - 1) * groupGap;
    const gridHeight = captionHeight + rowCount * cellHeight + (rowCount - 1) * rowGutter;
    return {cellWidth, cellHeight, innerGutter, groupGap, rowGutter, captionHeight, gridWidth, gridHeight};
}

/**
 * @param {number} availablePx - The work area's length inside both margins.
 * @param {number} framePx - The frame's length at the reference.
 * @returns {number} The largest scale at which the frame's length fits; a frame length that is not positive limits
 *     nothing.
 */
function fitAlong(availablePx, framePx) {
    return framePx > 0 ? availablePx / framePx : Infinity;
}

/**
 * @param {{width: number, height: number}} workArea - The cockpit monitor's work area.
 * @param {GridCounts} counts - The layout's counts.
 * @returns {number} min(what fits inside the margin, clamp(raw, 1, COCKPIT_GRID_MAX_SCALE)), raw being
 *     min(width / 1920, height / 1080); never under 0, so a work area smaller than its margins gives lengths of 0.
 */
function gridScaleFor(workArea, counts) {
    const reference = COCKPIT_GRID_REFERENCE;
    const frameAtReference = gridFrameAt(counts, UNSCALED);
    const widthFit = fitAlong(workArea.width - 2 * LEAST_GRID_MARGIN_PX, frameAtReference.gridWidth);
    const heightFit = fitAlong(workArea.height - 2 * LEAST_GRID_MARGIN_PX, frameAtReference.gridHeight);
    const largestFittingScale = Math.max(0, Math.min(widthFit, heightFit));
    const rawScale = Math.min(workArea.width / reference.widthPx, workArea.height / reference.heightPx);
    return Math.min(largestFittingScale, COCKPIT_GRID_MAX_SCALE, Math.max(UNSCALED, rawScale));
}

/**
 * @param {{width: number, height: number}} workArea - The cockpit monitor's work area.
 * @param {GridCounts} counts - The layout's counts.
 * @returns {boolean} The grid of a layout with these counts is drawn on the work area (isCockpitGridDrawable).
 */
function isDrawableWithCounts(workArea, counts) {
    const frame = gridFrameAt(counts, gridScaleFor(workArea, counts));
    const doesContentFit = frame.cellWidth + frame.innerGutter >= COCKPIT_CARD_CONTENT_WIDTH_PX;
    const doesFrameFit = frame.gridWidth + 2 * LEAST_GRID_MARGIN_PX <= workArea.width &&
        frame.gridHeight + 2 * LEAST_GRID_MARGIN_PX <= workArea.height;
    return doesContentFit && doesFrameFit;
}

/**
 * Says whether a work area holds a layout's grid with every card's content clear of the next card: a scaled cell and
 * its scaled inner gutter are at least the widest card content, COCKPIT_CARD_CONTENT_WIDTH_PX, and the frame the
 * layout uses, at its scale, fits the work area inside LEAST_GRID_MARGIN_PX on every side. For the template (two rows,
 * three columns) the least such work area is 1274 x 636, where a 394 px cell and a 22 px gutter make 416, so a
 * 1536 x 928 laptop panel draws it at the reference's own cells; a layout of three rows needs 940 px of height, and
 * one of four columns 1691 to 1736 px of width (leastDrawableWorkArea). The height needs no rule of its own: the apps
 * card's rows need about 265 px, and a cell at the least scale is 281 px tall.
 *
 * @param {{width: number, height: number}} workArea - The cockpit monitor's work area.
 * @param {Array<{columns: number, cards: string[]}>} groups - The layout's groups.
 * @returns {boolean} True when the grid may be drawn there.
 */
export function isCockpitGridDrawable(workArea, groups) {
    return isDrawableWithCounts(workArea, gridCountsOf(groups));
}

/**
 * Finds the least length at which the grid is drawn by bisection: the grid is drawn at every length from the least
 * one up, so each step halves the range between a length it is not drawn at and one it is. Past 2^53 px adjacent
 * doubles are more than a pixel apart, so the middle can land on an end; the search stops there rather than loop, at a
 * length the grid is drawn at (only a layout of trillions of columns, from a broken service, gets that far).
 *
 * @param {number} drawnLengthPx - A length the grid is drawn at.
 * @param {function(number): boolean} isDrawnAtLengthPx - Whether the grid is drawn at a length.
 * @returns {number} The least length it is drawn at, 0 included; drawnLengthPx when it is drawn at no smaller one.
 */
function leastDrawnLengthPx(drawnLengthPx, isDrawnAtLengthPx) {
    let undrawnLengthPx = -1;
    let leastLengthPx = drawnLengthPx;
    while (leastLengthPx - undrawnLengthPx > 1) {
        const middleLengthPx = Math.floor((undrawnLengthPx + leastLengthPx) / 2);
        const isMiddleStrictlyBetween = middleLengthPx > undrawnLengthPx && middleLengthPx < leastLengthPx;
        if (!isMiddleStrictlyBetween)
            break;
        if (isDrawnAtLengthPx(middleLengthPx))
            leastLengthPx = middleLengthPx;
        else
            undrawnLengthPx = middleLengthPx;
    }
    return leastLengthPx;
}

/**
 * The smallest work area isCockpitGridDrawable holds a layout's grid in, for the journal line that names it: the
 * least width when the height is no constraint, and the least height likewise. Each length is found by bisection
 * (leastDrawnLengthPx) with the other held at a length sure to draw the grid, so a layout of very many groups, from a
 * newer or broken service, costs a few dozen steps and never stalls the compositor.
 *
 * @param {Array<{columns: number, cards: string[]}>} groups - The layout's groups.
 * @returns {{width: number, height: number}} The least width and height, in logical pixels (1274 x 636 for the
 *     template).
 */
export function leastDrawableWorkArea(groups) {
    const counts = gridCountsOf(groups);
    const frameAtReference = gridFrameAt(counts, UNSCALED);
    const surelyDrawnPx = (referencePx, framePx) =>
        Math.max(LEAST_SIZE_BOUND_FACTOR * referencePx, Math.ceil(framePx) + 2 * LEAST_GRID_MARGIN_PX);
    const surelyDrawnWidth = surelyDrawnPx(COCKPIT_GRID_REFERENCE.widthPx, frameAtReference.gridWidth);
    const surelyDrawnHeight = surelyDrawnPx(COCKPIT_GRID_REFERENCE.heightPx, frameAtReference.gridHeight);
    return {
        width: leastDrawnLengthPx(surelyDrawnWidth,
            width => isDrawableWithCounts({width, height: surelyDrawnHeight}, counts)),
        height: leastDrawnLengthPx(surelyDrawnHeight,
            height => isDrawableWithCounts({width: surelyDrawnWidth, height}, counts)),
    };
}

/**
 * The journal line for a cockpit monitor whose work area is too small for a layout's grid (isCockpitGridDrawable):
 * the length that is short for this layout (leastDrawableWorkArea), or the least size when both are, and the work
 * area's size.
 *
 * @param {{width: number, height: number}} workArea - The cockpit monitor's work area.
 * @param {Array<{columns: number, cards: string[]}>} groups - The layout's groups.
 * @returns {string} The line, without the logger's prefix.
 */
export function cockpitGridTooSmallLine(workArea, groups) {
    const leastWorkArea = leastDrawableWorkArea(groups);
    const isWidthShort = workArea.width < leastWorkArea.width;
    const isHeightShort = workArea.height < leastWorkArea.height;
    let neededSize = `${leastWorkArea.width}x${leastWorkArea.height}`;
    if (isHeightShort && !isWidthShort)
        neededSize = `${leastWorkArea.height} px tall`;
    else if (isWidthShort && !isHeightShort)
        neededSize = `${leastWorkArea.width} px wide`;
    const workAreaSize = `${workArea.width}x${workArea.height}`;
    return `the cockpit grid needs a work area at least ${neededSize} for this layout (it is ${workAreaSize}), ` +
        'so the card is drawn top right';
}

/**
 * The cells and captions of the cockpit grid. Every reference length (cells, gutters, caption) scales by the grid's
 * scale for this layout (see the module's header: the reference's lengths where the frame fits, shrunk just enough
 * where it does not, grown up to COCKPIT_GRID_MAX_SCALE on a work area larger than 1920 x 1080) and is floored to an
 * integer. The grid is centred in the work area on the columns and rows it uses: as tall as the caption row plus the
 * most rows a group needs, at most COCKPIT_GRID_REFERENCE.rows. Groups sit left to right, each `columns` cells wide,
 * one inner gutter between the cells of a group and one group gap between groups. A group's cards fill its columns
 * left to right, then the next row; every card id gets a cell, known or not, except that a group with more cards than
 * `columns x COCKPIT_GRID_REFERENCE.rows` leaves the extra cards without a cell. The caption spans its group's width
 * above its first row. Coordinates are absolute stage coordinates (the work area's origin included). Every number is
 * finite for any groups the lenient reader lets through, so Clutter is never handed NaN.
 *
 * @param {object} options - The inputs.
 * @param {{x: number, y: number, width: number, height: number}} options.workArea - The cockpit monitor's work area.
 * @param {Array<{id: string, caption: string, columns: number, cards: string[]}>} options.groups - The layout's groups.
 * @returns {{captions: Array<{groupId: string, text: string, x: number, y: number, width: number, height: number}>,
 *     cells: Array<{cardId: string, groupId: string, column: number, row: number, x: number, y: number, width: number,
 *     height: number}>}} The captions and cells.
 */
export function cockpitGridGeometry({workArea, groups}) {
    const counts = gridCountsOf(groups);
    const frame = gridFrameAt(counts, gridScaleFor(workArea, counts));
    const {cellWidth, cellHeight, innerGutter, groupGap, rowGutter, captionHeight} = frame;
    const groupWidths = groups.map(group => group.columns * cellWidth + innerGuttersOf(group) * innerGutter);
    const gridLeft = workArea.x + Math.floor((workArea.width - frame.gridWidth) / 2);
    const gridTop = workArea.y + Math.floor((workArea.height - frame.gridHeight) / 2);
    const cellsTop = gridTop + captionHeight;
    const cellsPerColumn = COCKPIT_GRID_REFERENCE.rows;

    const captions = [];
    const cells = [];
    let groupLeft = gridLeft;
    groups.forEach((group, groupIndex) => {
        captions.push({
            groupId: group.id, text: group.caption, x: groupLeft, y: gridTop, width: groupWidths[groupIndex], height: captionHeight,
        });
        group.cards.slice(0, group.columns * cellsPerColumn).forEach((cardId, cardIndex) => {
            const column = cardIndex % group.columns;
            const row = Math.floor(cardIndex / group.columns);
            cells.push({
                cardId, groupId: group.id, column, row,
                x: groupLeft + column * (cellWidth + innerGutter),
                y: cellsTop + row * (cellHeight + rowGutter),
                width: cellWidth, height: cellHeight,
            });
        });
        groupLeft += groupWidths[groupIndex] + groupGap;
    });
    return {captions, cells};
}

/**
 * @param {string} cardId - A card id from the layout.
 * @returns {boolean} True when the cockpit draws this card (COCKPIT_DRAWN_CARD_IDS); other ids get a cell left empty.
 */
export function isKnownCockpitCard(cardId) {
    return COCKPIT_DRAWN_CARD_IDS.includes(cardId);
}

/**
 * The cells the cockpit draws a card in: the first cell of each card id it knows (isKnownCockpitCard). The cell of an
 * id it does not know (a newer service's) and a second cell of a known id stay empty, and nothing throws for them.
 *
 * @param {Array<{cardId: string}>} cells - cockpitGridGeometry's cells.
 * @returns {Array<object>} The cells drawn, the same objects, in order.
 */
export function drawnCockpitCells(cells) {
    const drawnCardIds = new Set();
    return cells.filter(cell => {
        if (!isKnownCockpitCard(cell.cardId) || drawnCardIds.has(cell.cardId))
            return false;
        drawnCardIds.add(cell.cardId);
        return true;
    });
}

/**
 * The card ids the cockpit draws for a layout's groups: those of drawnCockpitCells, in order. Which cards get a cell
 * depends on the groups alone, never on the work area, so the reference work area serves.
 *
 * @param {Array<{id: string, caption: string, columns: number, cards: string[]}>} groups - The layout's groups.
 * @returns {string[]} The card ids drawn.
 */
export function drawnCockpitCardIds(groups) {
    const {cells} = cockpitGridGeometry({workArea: REFERENCE_WORK_AREA, groups});
    return drawnCockpitCells(cells).map(cell => cell.cardId);
}
