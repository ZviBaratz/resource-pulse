// The cockpit's lengths that hold text, from the line boxes and text widths St measures: each length is a fixed part
// (lib/drawingConstants.js) and the line boxes of its text, measured in the text's own class (stylesheet.css, the
// cockpit's text sizes), so each grows with GNOME's text scaling and the interface font's size. A caption plate's
// legend is its whole width with every caption it carries (lib/plateCaptions.js).
//
// The layout's sheet is the set of lengths the cockpit's layout places its tiles with, nested by what they belong to
// (`plate.heightPx`, `monitor.heightPxByForm.wide` and so on). Its defaults are the layout's; this module fills in
// the ones that hold text and leaves every other as it is handed in.
//
// - A line box or a width is taken in whole pixels, rounded up, each one before it is added, so a length is never
//   shorter than the text St lays out in it.
// - A reading that is missing, not a finite number, not over 0, or over MOST_READING_PX is a bad reading. St answers
//   at least 1 px for any text, an empty one included, so 0 comes only from a read that failed. A length that needs
//   a bad reading, or whose sum comes to more than MOST_READING_PX, keeps the value the caller handed in as its
//   default, and is named in `fallbackNames`; a plate's legend that needs one, or comes to more, is null, which the
//   layout reads as no legend. So nothing that leaves this module is NaN, negative, 0 or past the bound.
// - The defaults are always the caller's: this module holds no length of the layout's own.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {
    ANNUNCIATOR_CELL_FIXED_HEIGHT_PX, ANNUNCIATOR_CELL_PADDING_PX, SESSION_GROUP_HEADING_FIXED_HEIGHT_PX,
    CONNECTIONS_LINE_FIXED_HEIGHT_PX, HEAVIEST_FIXED_HEIGHT_PX, MONITOR_DETAIL_SLOT_COUNT_BY_FORM,
    MONITOR_DETAIL_SLOT_FIXED_HEIGHT_PX, MONITOR_FIXED_HEIGHT_PX_BY_FORM, MONITOR_TRACK_LABEL_COUNT,
    MONITOR_TRACK_LABEL_SLOT_FIXED_HEIGHT_PX, MORE_LINE_FIXED_HEIGHT_PX, PLATE_BORDER_WIDTH_PX, PLATE_FIXED_HEIGHT_PX,
    PLATE_GROUP_CAPTION_GAP_PX, PLATE_ITEM_GAP_PX, PLATE_PADDING_END_PX, PLATE_PADDING_START_PX,
    RANKING_ROW_FIXED_HEIGHT_PX, SESSION_ROW_FIXED_HEIGHT_PX, SESSIONS_ABOVE_COLUMNS_FIXED_HEIGHT_PX,
    WAITING_ROW_FIXED_HEIGHT_PX, WORKING_ROW_FIXED_HEIGHT_PX,
} from './drawingConstants.js';
import {PlateCaption, plateCaptionsByGroup} from './plateCaptions.js';

/** No reading is taken as longer than this, in pixels: the layout's own bound on a length. */
export const MOST_READING_PX = 32768;

/**
 * The kinds of line the cockpit's tiles and plates draw, each by the class that sizes it (stylesheet.css). Two kinds
 * that share a size and weight share a class.
 */
export const LineKind = Object.freeze({
    ANNUNCIATOR: 'rp-tile-text-annunciator',
    GROUP_CAPTION: 'rp-tile-text-group-caption',
    SCALE: 'rp-tile-text-scale',
    LABEL: 'rp-tile-text-label',
    GROUP_HEADING: 'rp-tile-text-group-heading',
    GROUP_HEADING_COUNT: 'rp-tile-text-group-heading-count',
    DETAIL: 'rp-tile-text-detail',
    ROW: 'rp-tile-text-row',
    WAITING_AGE: 'rp-tile-text-waiting-age',
    WAITING_NAME: 'rp-tile-text-waiting-name',
    UNIT: 'rp-tile-text-unit',
    TITLE: 'rp-tile-text-title',
    TITLE_COUNT: 'rp-tile-text-title-count',
    FIGURE_SMALL: 'rp-tile-text-figure-small',
    FIGURE: 'rp-tile-text-figure',
});

/**
 * How a tile's width part is made of its sample texts' widths (lib/measuredTextWidths.js): the widest of them, or
 * their sum.
 */
export const SampleCombine = Object.freeze({WIDEST: 'widest', SUM: 'sum'});

/** The class every tile and plate carries, and the measurer's labels' parent: the font and its tabular digits. */
export const TILE_TEXT_CLASS = 'rp-tile-text';

/**
 * What each kind's line box is measured with: digits, capitals and a descender. The captions are drawn upper-cased,
 * so they are measured so.
 */
export const LINE_SAMPLE_TEXT = 'Mg0 24.1 GiB';

/**
 * What the "Waiting on you" cell's one width is measured with: the widest two-digit count, so the cell keeps its
 * width from 1 to 99 waiting. With tabular digits every two-digit count is as wide.
 */
export const COUNT_SLOT_SAMPLE_TEXT = '88 waiting on you';

/**
 * @typedef {object} MeasuredSheet
 * @property {object} sheet - The default sheet handed in, with each length that holds text measured: a copy, frozen
 *     along each path it sets, or the default sheet itself where no length could be measured.
 * @property {string[]} fallbackNames - The lengths left at the default because a line they need read badly.
 */

/**
 * @typedef {object} MeasuredSessionsLengths
 * @property {object} lengths - The Sessions tile's lengths: `aboveColumnsHeightPx`, `groupHeadingHeightPx`,
 *     `moreLineHeightPx` and `rowHeightPxByState`, each measured or the default handed in.
 * @property {string[]} fallbackNames - The lengths left at the default.
 */

/**
 * A line box or a text's width as a whole number of pixels.
 *
 * @param {*} readingPx - A line box or a width read from St.
 * @returns {number|null} It rounded up; null when it is a bad reading (not a finite number over 0, or past the bound).
 */
export function wholeReadingPx(readingPx) {
    const isUsable = typeof readingPx === 'number' && Number.isFinite(readingPx) && readingPx > 0 &&
        readingPx <= MOST_READING_PX;
    return isUsable ? Math.ceil(readingPx) : null;
}

/**
 * The line boxes of the kinds a length needs, each whole; null when any of them reads badly.
 *
 * @param {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @param {string[]} lineKinds - The kinds the length needs.
 * @returns {number[]|null} Their whole line boxes, in the order asked.
 */
function wholeLineBoxesOf(lineBoxesPx, lineKinds) {
    const isObject = lineBoxesPx !== null && typeof lineBoxesPx === 'object';
    const boxes = lineKinds.map(lineKind => wholeReadingPx(isObject ? lineBoxesPx[lineKind] : undefined));
    return boxes.includes(null) ? null : boxes;
}

/**
 * The lengths of the layout's sheet that hold text, each with the kinds of line it needs and how it adds them up.
 * `path` is where the length stands in the sheet.
 */
const SHEET_LENGTHS = Object.freeze([
    {
        path: ['plate', 'heightPx'],
        lineKinds: [LineKind.ANNUNCIATOR, LineKind.GROUP_CAPTION],
        // The plate's text part is the taller of its annunciator cells and its group caption.
        lengthOf: ([annunciatorPx, groupCaptionPx]) =>
            PLATE_FIXED_HEIGHT_PX + Math.max(ANNUNCIATOR_CELL_FIXED_HEIGHT_PX + annunciatorPx, groupCaptionPx),
    },
    ...['wide', 'medium', 'small'].map(form => ({
        path: ['monitor', 'heightPxByForm', form],
        lineKinds: [LineKind.ROW, LineKind.DETAIL, LineKind.LABEL],
        // Three track labels, the meters' names (and the agents track's line in the wide form), and the axis labels.
        lengthOf: ([rowPx, detailPx, axisLabelPx]) => MONITOR_FIXED_HEIGHT_PX_BY_FORM[form] +
            MONITOR_TRACK_LABEL_COUNT * (MONITOR_TRACK_LABEL_SLOT_FIXED_HEIGHT_PX + rowPx) +
            MONITOR_DETAIL_SLOT_COUNT_BY_FORM[form] * (MONITOR_DETAIL_SLOT_FIXED_HEIGHT_PX + detailPx) + axisLabelPx,
    })),
    {
        path: ['heaviest', 'fixedHeightPx'],
        lineKinds: [LineKind.TITLE, LineKind.DETAIL],
        lengthOf: ([titlePx, detailPx]) => HEAVIEST_FIXED_HEIGHT_PX + titlePx + detailPx,
    },
    {
        path: ['heaviest', 'rowHeightPx'],
        lineKinds: [LineKind.ROW],
        lengthOf: ([rowPx]) => RANKING_ROW_FIXED_HEIGHT_PX + rowPx,
    },
    {
        path: ['connections', 'lineHeightPx'],
        lineKinds: [LineKind.ROW],
        lengthOf: ([rowPx]) => CONNECTIONS_LINE_FIXED_HEIGHT_PX + rowPx,
    },
]);

/** The Sessions tile's lengths, as SHEET_LENGTHS, with their paths in its lengths. */
const SESSIONS_LENGTHS = Object.freeze([
    {
        path: ['aboveColumnsHeightPx'],
        lineKinds: [LineKind.TITLE, LineKind.SCALE],
        lengthOf: ([titlePx, scalePx]) => SESSIONS_ABOVE_COLUMNS_FIXED_HEIGHT_PX + titlePx + scalePx,
    },
    {
        path: ['groupHeadingHeightPx'],
        lineKinds: [LineKind.GROUP_HEADING, LineKind.GROUP_HEADING_COUNT],
        // The heading's words and its count are two labels on one line: the taller sets the line.
        lengthOf: ([headingPx, countPx]) => SESSION_GROUP_HEADING_FIXED_HEIGHT_PX + Math.max(headingPx, countPx),
    },
    {
        path: ['moreLineHeightPx'],
        lineKinds: [LineKind.DETAIL],
        lengthOf: ([detailPx]) => MORE_LINE_FIXED_HEIGHT_PX + detailPx,
    },
    {
        // One height for a waiting row in every column: where a column is too narrow for strips its name is drawn at
        // the rows' size, and the row keeps this height all the same.
        path: ['rowHeightPxByState', 'blocked'],
        lineKinds: [LineKind.WAITING_NAME],
        lengthOf: ([waitingNamePx]) => WAITING_ROW_FIXED_HEIGHT_PX + waitingNamePx,
    },
    {
        path: ['rowHeightPxByState', 'working'],
        lineKinds: [LineKind.ROW],
        lengthOf: ([rowPx]) => WORKING_ROW_FIXED_HEIGHT_PX + rowPx,
    },
    ...['done', 'idle', 'unknown'].map(sessionState => ({
        path: ['rowHeightPxByState', sessionState],
        lineKinds: [LineKind.ROW],
        lengthOf: ([rowPx]) => SESSION_ROW_FIXED_HEIGHT_PX + rowPx,
    })),
]);

/**
 * A copy of an object with one value set at a path: every object along the path copied and frozen, every other one
 * shared with the original, which is left as it was. The sheet's widths are set the same way
 * (lib/measuredTextWidths.js).
 *
 * @param {*} target - The object, or anything else (taken as an empty object).
 * @param {string[]} path - The keys, outermost first.
 * @param {number} value - The value.
 * @returns {object} The copy.
 */
export function withValueAt(target, [key, ...restOfPath], value) {
    const base = target !== null && typeof target === 'object' ? target : {};
    const nextValue = restOfPath.length === 0 ? value : withValueAt(base[key], restOfPath, value);
    return Object.freeze({...base, [key]: nextValue});
}

/**
 * Fills lengths from line boxes into a copy of the defaults handed in, each within the bound.
 *
 * @param {*} defaults - The defaults.
 * @param {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @param {ReadonlyArray<object>} lengthRules - SHEET_LENGTHS or SESSIONS_LENGTHS.
 * @returns {{filled: object, fallbackNames: string[]}} The copy, and the lengths left at their default.
 */
function filledLengths(defaults, lineBoxesPx, lengthRules) {
    let filled = defaults;
    const fallbackNames = [];
    for (const {path, lineKinds, lengthOf} of lengthRules) {
        const lineBoxes = wholeLineBoxesOf(lineBoxesPx, lineKinds);
        const lengthPx = lineBoxes === null ? null : lengthOf(lineBoxes);
        // A sum of bounded readings can still pass the bound, which the layout would refuse whole.
        if (lengthPx === null || lengthPx > MOST_READING_PX)
            fallbackNames.push(path.join('.'));
        else
            filled = withValueAt(filled, path, lengthPx);
    }
    return {filled, fallbackNames};
}

/**
 * The layout's sheet with each length that holds text measured: the plate, the monitor's three forms, Heaviest above
 * its rows and a ranking's row, and Connections in one line. Every other length is the default sheet's.
 *
 * @param {object} defaultSheet - The layout's default sheet. It is not changed.
 * @param {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @returns {MeasuredSheet} The sheet, and the lengths left at the default.
 */
export function measuredSheet(defaultSheet, lineBoxesPx) {
    const {filled, fallbackNames} = filledLengths(defaultSheet, lineBoxesPx, SHEET_LENGTHS);
    return {sheet: filled, fallbackNames};
}

/**
 * The Sessions tile's lengths, measured: above its columns, a group's heading, a "+N more" line, and a row by its
 * session's state.
 *
 * @param {object} defaultLengths - The tile's default lengths. They are not changed.
 * @param {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @returns {MeasuredSessionsLengths} The lengths, and those left at the default.
 */
export function measuredSessionsLengths(defaultLengths, lineBoxesPx) {
    const {filled, fallbackNames} = filledLengths(defaultLengths, lineBoxesPx, SESSIONS_LENGTHS);
    return {lengths: filled, fallbackNames};
}

/**
 * An annunciator cell's whole width: its caption's and its padding.
 *
 * @param {*} captionWidthPx - The caption's width, upper-cased, in the annunciator's class.
 * @returns {number|null} The cell's width; null for a bad reading.
 */
export function annunciatorCellWidthPx(captionWidthPx) {
    const wholeCaptionPx = wholeReadingPx(captionWidthPx);
    return wholeCaptionPx === null ? null : 2 * ANNUNCIATOR_CELL_PADDING_PX + wholeCaptionPx;
}

/**
 * @typedef {object} CaptionWidths
 * @property {object} annunciatorWidthsPx - Each annunciator's caption width, keyed by its PlateCaption value. The
 *     "Waiting on you" cell takes `countSlotWidthPx` instead.
 * @property {*} countSlotWidthPx - The "Waiting on you" cell's one whole width (annunciatorCellWidthPx of
 *     COUNT_SLOT_SAMPLE_TEXT's width).
 * @property {object} groupCaptionWidthsPx - Each group caption's width, keyed by the caption as the layout gives it.
 */

/**
 * A plate's legend: its whole width with every caption it carries. Each item stands PLATE_ITEM_GAP_PX from the next,
 * the group caption and the first cell included, and the group caption keeps PLATE_GROUP_CAPTION_GAP_PX after itself
 * as well.
 *
 * @param {{groupCaption: string, captions: string[]}} plateCaptions - The plate's captions (lib/plateCaptions.js).
 * @param {CaptionWidths} captionWidths - The measured widths.
 * @returns {number|null} The width; null where a width it needs read badly.
 */
function plateLegendWidthPx({groupCaption, captions}, {annunciatorWidthsPx, countSlotWidthPx, groupCaptionWidthsPx}) {
    const groupCaptionPx = wholeReadingPx(groupCaptionWidthsPx?.[groupCaption]);
    const cellWidthsPx = captions.map(caption => caption === PlateCaption.WAITING_ON_YOU
        ? wholeReadingPx(countSlotWidthPx)
        : annunciatorCellWidthPx(annunciatorWidthsPx?.[caption]));
    if (groupCaptionPx === null || cellWidthsPx.includes(null))
        return null;
    const cellsPx = cellWidthsPx.reduce((totalPx, cellPx) => totalPx + PLATE_ITEM_GAP_PX + cellPx, 0);
    const edgesPx = 2 * PLATE_BORDER_WIDTH_PX + PLATE_PADDING_START_PX + PLATE_PADDING_END_PX;
    const widthPx = edgesPx + groupCaptionPx + PLATE_GROUP_CAPTION_GAP_PX + cellsPx;
    return widthPx <= MOST_READING_PX ? widthPx : null;
}

/**
 * Each group's plate legend, by the group's place in `groups`.
 *
 * @param {*} groups - The layout's groups, as the lenient reader gives them.
 * @param {CaptionWidths} captionWidths - The measured widths.
 * @returns {Array<number|null>} One entry a group: its legend in whole pixels, or null where it has no plate or a
 *     width its plate needs read badly.
 */
export function plateLegendWidthsPx(groups, captionWidths) {
    const widths = captionWidths !== null && typeof captionWidths === 'object' ? captionWidths : {};
    return plateCaptionsByGroup(groups)
        .map(plateCaptions => plateCaptions === null ? null : plateLegendWidthPx(plateCaptions, widths));
}
