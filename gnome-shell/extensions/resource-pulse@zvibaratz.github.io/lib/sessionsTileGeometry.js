// Where every part of the Sessions tile stands, and how wide its columns must be, as pure functions of the tile's
// rectangle, the flow's lengths and the text widths. The tile's shell modules place each part where these say.
//
// - Every column is one whole width, and the odd pixels of a split go to the gaps between columns, one each from the
//   left: the last column ends at the right edge, and a row that moves to another column keeps its width.
// - Each item of the flow stands where the flow counted it, its height the length the flow was handed, so a column
//   drawn is the flow's column to the pixel at any scale and text size.
// - A width that holds text is a fixed part (lib/drawingConstants.js) and the width of a sample text in the rows'
//   class (SESSIONS_WIDTH_SAMPLE_TEXTS), handed in as `textWidthsPx`. A text width is read by the readings' rule
//   (lib/measuredLengths.js wholeReadingPx): one missing, not a finite number, not over 0 or past MOST_READING_PX is
//   a read that failed, and takes its default, so no cell is drawn of no width.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {
    SESSION_GROUP_HEADING_GAP_ABOVE_PX, SESSION_GROUP_HEADING_GAP_BELOW_PX, SESSION_MARK_SIZE_PX,
    SESSION_ROW_CELL_GAP_PX, SESSION_ROW_PADDING_INLINE_PX, SESSION_STRIP_WIDTH_PX,
    SESSIONS_ABOVE_COLUMNS_FIXED_HEIGHT_PX, WAITING_ROW_GAP_BELOW_PX,
} from './drawingConstants.js';
import {LineKind, wholeReadingPx} from './measuredLengths.js';
import {SESSIONS_FLOW_ITEM_KIND} from './sessionsFlow.js';
/** A row's cells where its column has strips: its mark, name, context tag, strip, age and memory. */
const CELL_COUNT_WITH_STRIP = 6;
/** A row's cells where its column has none: its mark, name, context tag, age and memory. */
const CELL_COUNT_WITHOUT_STRIP = 5;

/**
 * What each of the Sessions tile's widths that holds text is measured with, all in the rows' class: an age with its
 * widest unit and the process-age mark (with tabular digits any two-digit age is as wide), the wider of a memory in
 * GiB and in MiB, a name of about twenty characters (the least a name keeps beside a strip), and a full name, which a
 * column at its stop draws whole beside its strip.
 */
export const SESSIONS_WIDTH_SAMPLE_TEXTS = Object.freeze({
    age: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['88m*'])}),
    memory: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['88.8G', '888M'])}),
    nameBesideStrip: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['release-notes-review'])}),
    fullName: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['release-notes-review-and-publish'])}),
});

/** The sample widths at the default text size: what the tile draws with until something measures them. */
export const DEFAULT_SESSIONS_TEXT_WIDTHS_PX =
    Object.freeze({age: 34, memory: 42, nameBesideStrip: 150, fullName: 244});

/** A row's fixed widths where its column has strips: its side padding, its mark, its strip and the gaps. */
const STRIP_ROW_FIXED_WIDTH_PX = 2 * SESSION_ROW_PADDING_INLINE_PX + SESSION_MARK_SIZE_PX + SESSION_STRIP_WIDTH_PX +
    (CELL_COUNT_WITH_STRIP - 1) * SESSION_ROW_CELL_GAP_PX;
/** A row's fixed widths where its column has no strips: its side padding, its mark and the gaps. */
const NARROW_ROW_FIXED_WIDTH_PX = 2 * SESSION_ROW_PADDING_INLINE_PX + SESSION_MARK_SIZE_PX +
    (CELL_COUNT_WITHOUT_STRIP - 1) * SESSION_ROW_CELL_GAP_PX;

/**
 * The text widths, whole (rounded up, so a text is never cut by a fraction of a pixel), each one that reads badly or
 * is missing taken at its default: a reading is taken only as wholeReadingPx takes one.
 *
 * @param {*} textWidthsPx - The caller's widths, keyed as DEFAULT_SESSIONS_TEXT_WIDTHS_PX.
 * @returns {{age: number, memory: number, nameBesideStrip: number, fullName: number}} The widths.
 */
export function sessionsTextWidthsInWholePixels(textWidthsPx) {
    const isObject = textWidthsPx !== null && typeof textWidthsPx === 'object';
    return Object.fromEntries(Object.entries(DEFAULT_SESSIONS_TEXT_WIDTHS_PX).map(([name, defaultWidthPx]) => {
        const wholeWidthPx = isObject ? wholeReadingPx(textWidthsPx[name]) : null;
        return [name, wholeWidthPx ?? defaultWidthPx];
    }));
}

/**
 * The columns' widths and places inside the tile's side padding.
 *
 * @param {object} tile - The tile.
 * @param {number} tile.tileWidthPx - Its width.
 * @param {number} tile.columnCount - Its columns: a whole number, 0 or more.
 * @param {number} tile.columnGapPx - The gap between two columns, from the layout's sheet.
 * @param {number} tile.sidePaddingPx - The tile's side padding, both sides together, from the layout's sheet.
 * @returns {{areaWidthPx: number, columnWidthPx: number, columnXsPx: number[]}} The width inside the side padding,
 *     the one width of every column, and each column's left edge from the padding's.
 */
export function sessionsColumnsGeometry({tileWidthPx, columnCount, columnGapPx, sidePaddingPx}) {
    const areaWidthPx = Math.max(0, tileWidthPx - sidePaddingPx);
    if (columnCount < 1)
        return {areaWidthPx, columnWidthPx: 0, columnXsPx: []};
    const gapCount = columnCount - 1;
    const widthForColumnsPx = Math.max(0, areaWidthPx - gapCount * columnGapPx);
    const columnWidthPx = Math.floor(widthForColumnsPx / columnCount);
    // Fewer odd pixels than columns, so at most one for each gap.
    const oddPixelCount = widthForColumnsPx - columnCount * columnWidthPx;
    const columnXsPx = [0];
    for (let gapIndex = 0; gapIndex < gapCount; gapIndex++) {
        const gapWidthPx = columnGapPx + (gapIndex < oddPixelCount ? 1 : 0);
        columnXsPx.push(columnXsPx[gapIndex] + columnWidthPx + gapWidthPx);
    }
    return {areaWidthPx, columnWidthPx, columnXsPx};
}

/**
 * The room an item of the flow takes, as the flow counts it.
 *
 * @param {{kind: string, state: string}} item - An item of the flow.
 * @param {object} lengths - The lengths the flow was handed, whole.
 * @returns {number} Its height.
 */
function itemHeightPx(item, lengths) {
    if (item.kind === SESSIONS_FLOW_ITEM_KIND.ROW)
        return lengths.rowHeightPxByState[item.state];
    if (item.kind === SESSIONS_FLOW_ITEM_KIND.MORE)
        return lengths.moreLineHeightPx;
    return lengths.groupHeadingHeightPx;
}

/**
 * The part of an item's room its actor is drawn in: a heading on its line, under the room above it; a waiting row's
 * lift, less the gap under it; any other item in its whole room.
 *
 * @param {{kind: string, state: string}} item - An item of the flow.
 * @param {number} topPx - Its room's top.
 * @param {number} heightPx - Its room's height.
 * @returns {{drawnTopPx: number, drawnHeightPx: number}} Where its actor stands.
 */
function drawnPart(item, topPx, heightPx) {
    const isHeading = item.kind === SESSIONS_FLOW_ITEM_KIND.HEADING || item.kind === SESSIONS_FLOW_ITEM_KIND.CONTINUED;
    if (isHeading) {
        const lineHeightPx = heightPx - SESSION_GROUP_HEADING_GAP_ABOVE_PX - SESSION_GROUP_HEADING_GAP_BELOW_PX;
        return {drawnTopPx: topPx + SESSION_GROUP_HEADING_GAP_ABOVE_PX, drawnHeightPx: Math.max(0, lineHeightPx)};
    }
    if (item.kind === SESSIONS_FLOW_ITEM_KIND.ROW && item.state === 'blocked')
        return {drawnTopPx: topPx, drawnHeightPx: Math.max(0, heightPx - WAITING_ROW_GAP_BELOW_PX)};
    return {drawnTopPx: topPx, drawnHeightPx: heightPx};
}

/**
 * @typedef {object} ItemPlace Where one item of the flow stands in its column.
 * @property {object} item - The flow's item.
 * @property {number} topPx - Its room's top, from the column's first item.
 * @property {number} heightPx - Its room's height: the length the flow counted for it.
 * @property {number} drawnTopPx - Its actor's top.
 * @property {number} drawnHeightPx - Its actor's height.
 * @property {boolean} isShown - Whether its room stands wholly inside the column. The flow places every item, and
 *     where even its headings do not fit (doesFit false), the items past the column's foot are not shown.
 */

/**
 * Where each item of the flow stands: one after another from the column's top, each taking the length the flow
 * counted for it.
 *
 * @param {Array<Array<object>>} flowColumns - The flow's columns of items (sessionsFlow's `columns`).
 * @param {object} lengths - The lengths the flow was handed, whole.
 * @param {number} flowHeightPx - The height the flow's columns have.
 * @returns {Array<Array<ItemPlace>>} Per column, its items' places.
 */
export function sessionsItemPlaces(flowColumns, lengths, flowHeightPx) {
    return flowColumns.map(items => {
        let topPx = 0;
        return items.map(item => {
            const heightPx = itemHeightPx(item, lengths);
            const place = {item, topPx, heightPx, ...drawnPart(item, topPx, heightPx),
                isShown: topPx + heightPx <= flowHeightPx};
            topPx += heightPx;
            return place;
        });
    });
}

/**
 * The tile's heights from its top padding down: its header (the title's line), its column labels (the rest of the
 * length above the columns, less the tile's fixed parts) and the flow under them.
 *
 * @param {object} tile - The tile.
 * @param {number} tile.tileHeightPx - Its height.
 * @param {object} tile.lengths - The lengths the flow was handed, whole.
 * @param {number} tile.titleLineBoxPx - The title's line box, as the lengths were summed with it.
 * @returns {{headerHeightPx: number, labelsRowHeightPx: number, flowHeightPx: number}} The heights.
 */
export function sessionsTileBlockHeights({tileHeightPx, lengths, titleLineBoxPx}) {
    const labelsRowHeightPx = Math.max(0,
        lengths.aboveColumnsHeightPx - SESSIONS_ABOVE_COLUMNS_FIXED_HEIGHT_PX - titleLineBoxPx);
    const flowHeightPx = Math.max(0, tileHeightPx - lengths.aboveColumnsHeightPx);
    return {headerHeightPx: titleLineBoxPx, labelsRowHeightPx, flowHeightPx};
}

/**
 * Whether a column has strips: the service publishes the histories, and the column, less a strip row's fixed parts,
 * holds the age, the memory and a name of about twenty characters.
 *
 * @param {object} column - The column.
 * @param {number} column.columnWidthPx - Its width.
 * @param {{age: number, memory: number, nameBesideStrip: number}} column.textWidthsPx - The sample widths, whole.
 * @param {boolean} column.hasStateHistories - Whether the service publishes the histories.
 * @returns {boolean} True when its rows draw strips.
 */
export function hasStripColumn({columnWidthPx, textWidthsPx, hasStateHistories}) {
    const textWidthPx = textWidthsPx.age + textWidthsPx.memory + textWidthsPx.nameBesideStrip;
    return hasStateHistories && columnWidthPx - STRIP_ROW_FIXED_WIDTH_PX >= textWidthPx;
}

/**
 * A column's widths, each a fixed part and a text part: its least (a full name with no strip), its stop (a full name
 * beside a strip) and the width from which it has strips (a twenty-character name beside one).
 *
 * @param {{age: number, memory: number, nameBesideStrip: number, fullName: number}} textWidthsPx - The sample
 *     widths, whole.
 * @returns {{leastWidthPx: {fixedPx: number, textPx: number, totalPx: number},
 *     stopWidthPx: {fixedPx: number, textPx: number, totalPx: number},
 *     stripWidthPx: {fixedPx: number, textPx: number, totalPx: number}}} The widths.
 */
export function sessionsColumnWidthParts(textWidthsPx) {
    const valuesTextPx = textWidthsPx.age + textWidthsPx.memory;
    const fullTextPx = valuesTextPx + textWidthsPx.fullName;
    const stripTextPx = valuesTextPx + textWidthsPx.nameBesideStrip;
    const widthOf = (fixedPx, textPx) => ({fixedPx, textPx, totalPx: fixedPx + textPx});
    return {
        leastWidthPx: widthOf(NARROW_ROW_FIXED_WIDTH_PX, fullTextPx),
        stopWidthPx: widthOf(STRIP_ROW_FIXED_WIDTH_PX, fullTextPx),
        stripWidthPx: widthOf(STRIP_ROW_FIXED_WIDTH_PX, stripTextPx),
    };
}
