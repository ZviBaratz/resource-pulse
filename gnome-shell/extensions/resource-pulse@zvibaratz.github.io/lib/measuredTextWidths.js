// The tiles' widths that hold text, from the widths St gives their sample texts: each tile's `textWidthsPx`, the input
// its pure module lays it out with, and the sheet's widths that hold text, the lengths the composition places the
// tiles with.
//
// - Each tile's samples, its default widths and its sheet widths are one entry of TILE_TEXT_WIDTH_ENTRIES, read from
//   the tile's own module: a tile not yet built adds its entry, and nothing here changes shape.
// - A part of a tile's widths is the widest of its sample texts in their class, or, where the part says so
//   (SampleCombine.SUM), the sum of every text of each of its classes. Each text's width is taken whole, rounded up
//   on its own before the widest is taken or the widths are added (lib/measuredLengths.js wholeReadingPx).
// - Each sheet width is its tile's own sum of fixed parts and the widths handed to the tile (heaviestWidthsPx,
//   connectionsWidthsPx, sessionsColumnWidthParts): no width is added up here, so the width the composition gives a
//   tile and the width the tile lays itself out against are one number, from one read. A text sampled by two tiles
//   ("1023M", Heaviest's value and Sessions' memory) is one label, read once for both.
// - A bad reading as the heights have it: a part that needs a text that reads badly, or whose sum passes
//   MOST_READING_PX, takes the tile's default part whole, never the widest of the rest; a sheet width that needs a part
//   that fell back, or whose sum passes the bound, keeps the sheet's default. Each is named in `fallbackNames`, a part
//   as `textWidths.<tile>.<part>`, a width by its path in the sheet.
// - The defaults are the caller's sheet and each tile's own module's; this module holds no length of its own.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {
    CONNECTIONS_WIDTH_SAMPLE_TEXTS, DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX, connectionsWidthsPx,
} from './connectionsFit.js';
import {DEFAULT_HEAVIEST_TEXT_WIDTHS_PX, HEAVIEST_WIDTH_SAMPLE_TEXTS, heaviestWidthsPx} from './heaviestRankings.js';
import {MOST_READING_PX, SampleCombine, wholeReadingPx, withValueAt} from './measuredLengths.js';
import {
    DEFAULT_SESSIONS_TEXT_WIDTHS_PX, SESSIONS_WIDTH_SAMPLE_TEXTS, sessionsColumnWidthParts,
    sessionsTextWidthsInWholePixels,
} from './sessionsTileGeometry.js';

/**
 * @typedef {object} SheetWidthRule One of the sheet's widths that hold text.
 * @property {string[]} path - Where it stands in the sheet, outermost key first.
 * @property {string[]} partNames - The tile's parts it needs: a part that fell back leaves it at the sheet's default.
 * @property {function(object): number} widthOf - Its width from the tile's widths, by the tile's own function.
 */

/**
 * @typedef {object} TileTextWidthEntry One tile's sample texts and what is made of them.
 * @property {string} tileKey - The tile's key in `textWidthsPx`.
 * @property {object} samples - Each part's samples, keyed as the defaults: `{lineKind, texts}` for the widest of
 *     texts of one class, or `{combine, samples: [{lineKind, texts}, ...]}`.
 * @property {object} defaultTextWidthsPx - Each part's width at the default text size, the tile's own.
 * @property {ReadonlyArray<SheetWidthRule>} sheetWidths - The sheet's widths made of its parts.
 */

/** @type {ReadonlyArray<TileTextWidthEntry>} Every tile whose widths hold text, in the order they are read. */
export const TILE_TEXT_WIDTH_ENTRIES = Object.freeze([
    Object.freeze({
        tileKey: 'heaviest',
        samples: HEAVIEST_WIDTH_SAMPLE_TEXTS,
        defaultTextWidthsPx: DEFAULT_HEAVIEST_TEXT_WIDTHS_PX,
        sheetWidths: Object.freeze([
            {
                path: ['heaviest', 'leastWidthPx'], partNames: ['rankingName', 'rankingValue'],
                widthOf: textWidthsPx => heaviestWidthsPx(textWidthsPx).leastWidthPx.totalPx,
            },
            {
                path: ['heaviest', 'stopWidthPx'], partNames: ['rankingName', 'rankingValue'],
                widthOf: textWidthsPx => heaviestWidthsPx(textWidthsPx).stopWidthPx.totalPx,
            },
            {
                // One row draws Heaviest at its stop.
                path: ['oneRow', 'heaviestWidthPx'], partNames: ['rankingName', 'rankingValue'],
                widthOf: textWidthsPx => heaviestWidthsPx(textWidthsPx).stopWidthPx.totalPx,
            },
        ]),
    }),
    Object.freeze({
        tileKey: 'connections',
        samples: CONNECTIONS_WIDTH_SAMPLE_TEXTS,
        defaultTextWidthsPx: DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX,
        sheetWidths: Object.freeze([
            {
                path: ['connections', 'listLeastWidthPx'], partNames: ['mountName', 'mountDetail'],
                widthOf: textWidthsPx => connectionsWidthsPx(textWidthsPx).listLeastWidthPx.totalPx,
            },
            {
                path: ['connections', 'listStopWidthPx'], partNames: ['mountName', 'mountDetail'],
                widthOf: textWidthsPx => connectionsWidthsPx(textWidthsPx).listStopWidthPx.totalPx,
            },
            {
                path: ['connections', 'lineLeastWidthPx'], partNames: ['lineTexts'],
                widthOf: textWidthsPx => connectionsWidthsPx(textWidthsPx).lineLeastWidthPx.totalPx,
            },
            {
                path: ['oneRow', 'connectionsWidthPx'], partNames: ['mountName', 'mountDetail'],
                widthOf: textWidthsPx => connectionsWidthsPx(textWidthsPx).oneRowWidthPx.totalPx,
            },
        ]),
    }),
    Object.freeze({
        // A column's least and stop, each by the tile's own sum, of the widths taken as the tile takes them
        // (sessionsTile.js setLayout). The width from which a column has strips stays the tile's: the sheet has none.
        tileKey: 'sessions',
        samples: SESSIONS_WIDTH_SAMPLE_TEXTS,
        defaultTextWidthsPx: DEFAULT_SESSIONS_TEXT_WIDTHS_PX,
        sheetWidths: Object.freeze([
            {
                path: ['sessions', 'columnLeastWidthPx'], partNames: ['age', 'memory', 'fullName'],
                widthOf: textWidthsPx =>
                    sessionsColumnWidthParts(sessionsTextWidthsInWholePixels(textWidthsPx)).leastWidthPx.totalPx,
            },
            {
                path: ['sessions', 'columnStopWidthPx'], partNames: ['age', 'memory', 'fullName'],
                widthOf: textWidthsPx =>
                    sessionsColumnWidthParts(sessionsTextWidthsInWholePixels(textWidthsPx)).stopWidthPx.totalPx,
            },
        ]),
    }),
]);

/**
 * @typedef {object} MeasuredTextWidths
 * @property {object} textWidthsPx - Each tile's widths, by its key: each part measured, or its default.
 * @property {object} measuredPartNames - Each tile's parts that were measured, by its key: what a sheet width needs.
 * @property {string[]} fallbackNames - The parts left at their default, as `textWidths.<tile>.<part>`.
 */

/**
 * A part's samples in one shape: how they combine, and the texts of each class.
 *
 * @param {object} part - A part's samples: `{lineKind, texts}`, the widest of texts of one class, or
 *     `{combine, samples: [{lineKind, texts}, ...]}`.
 * @returns {{combine: string, samples: Array<{lineKind: string, texts: string[]}>}} The samples.
 */
export function sampleGroupsOf(part) {
    if (Array.isArray(part.samples))
        return {combine: part.combine, samples: part.samples.map(({lineKind, texts}) => ({lineKind, texts: [...texts]}))};
    return {combine: SampleCombine.WIDEST, samples: [{lineKind: part.lineKind, texts: [...part.texts]}]};
}

/**
 * Every sample text the entries measure, each distinct text in a class once, in the entries' order: one hidden label
 * each.
 *
 * @param {ReadonlyArray<TileTextWidthEntry>} entries - The tiles' entries.
 * @returns {Array<{lineKind: string, text: string}>} The labels to read.
 */
export function sampleLabelsOf(entries) {
    const seenKeys = new Set();
    const labels = [];
    for (const {samples} of entries) {
        for (const part of Object.values(samples)) {
            for (const {lineKind, texts} of sampleGroupsOf(part).samples) {
                for (const text of texts) {
                    const labelKey = `${lineKind}\n${text}`;
                    if (seenKeys.has(labelKey))
                        continue;
                    seenKeys.add(labelKey);
                    labels.push({lineKind, text});
                }
            }
        }
    }
    return labels;
}

/**
 * A part's width from the readings: the widest or the sum of its texts' whole widths.
 *
 * @param {object} part - The part's samples.
 * @param {*} sampleWidthsPx - The readings, keyed by LineKind value and then by text.
 * @returns {number|null} Its width; null where a text it needs reads badly or its sum passes the bound.
 */
function partWidthPx(part, sampleWidthsPx) {
    const isObject = sampleWidthsPx !== null && typeof sampleWidthsPx === 'object';
    const {combine, samples} = sampleGroupsOf(part);
    const widthsPx = samples.flatMap(({lineKind, texts}) =>
        texts.map(text => wholeReadingPx(isObject ? sampleWidthsPx[lineKind]?.[text] : undefined)));
    if (widthsPx.includes(null))
        return null;
    const combinedPx = combine === SampleCombine.SUM
        ? widthsPx.reduce((totalPx, widthPx) => totalPx + widthPx, 0)
        : Math.max(...widthsPx);
    return combinedPx <= MOST_READING_PX ? combinedPx : null;
}

/**
 * Each tile's widths from the readings: every part measured, or the tile's default where it cannot be.
 *
 * @param {ReadonlyArray<TileTextWidthEntry>} entries - The tiles' entries.
 * @param {*} sampleWidthsPx - The readings, keyed by LineKind value and then by text.
 * @returns {MeasuredTextWidths} The widths, the parts measured, and the parts left at their default.
 */
export function measuredTextWidths(entries, sampleWidthsPx) {
    const textWidthsPx = {};
    const measuredPartNames = {};
    const fallbackNames = [];
    for (const {tileKey, samples, defaultTextWidthsPx} of entries) {
        textWidthsPx[tileKey] = {};
        measuredPartNames[tileKey] = [];
        for (const [partName, defaultWidthPx] of Object.entries(defaultTextWidthsPx)) {
            const widthPx = partWidthPx(samples[partName], sampleWidthsPx);
            if (widthPx === null) {
                fallbackNames.push(`textWidths.${tileKey}.${partName}`);
                textWidthsPx[tileKey][partName] = defaultWidthPx;
            } else {
                measuredPartNames[tileKey].push(partName);
                textWidthsPx[tileKey][partName] = widthPx;
            }
        }
    }
    return {textWidthsPx, measuredPartNames, fallbackNames};
}

/**
 * The sheet with each of its widths that hold text measured: each its tile's own sum of the tile's measured widths,
 * set as the heights are (a copy, frozen along each path it sets). A width that needs a part that fell back, or whose
 * sum passes the bound, keeps the sheet's default.
 *
 * @param {*} defaultSheet - The sheet: the composition's default sizes, with any heights already measured. It is not
 *     changed.
 * @param {ReadonlyArray<TileTextWidthEntry>} entries - The tiles' entries.
 * @param {MeasuredTextWidths} widths - measuredTextWidths's result for the same entries.
 * @returns {{sheet: object, fallbackNames: string[]}} The sheet (the one handed in where nothing could be measured),
 *     and the widths left at the default.
 */
export function measuredSheetWidths(defaultSheet, entries, {textWidthsPx, measuredPartNames}) {
    let sheet = defaultSheet;
    const fallbackNames = [];
    for (const {tileKey, sheetWidths} of entries) {
        for (const {path, partNames, widthOf} of sheetWidths) {
            const isMeasured = partNames.every(partName => measuredPartNames[tileKey].includes(partName));
            const widthPx = isMeasured ? widthOf(textWidthsPx[tileKey]) : null;
            if (widthPx === null || widthPx > MOST_READING_PX)
                fallbackNames.push(path.join('.'));
            else
                sheet = withValueAt(sheet, path, widthPx);
        }
    }
    return {sheet, fallbackNames};
}
