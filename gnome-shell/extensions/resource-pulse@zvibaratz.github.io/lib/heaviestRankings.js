// The Heaviest tile's content and lengths: its two rankings, by CPU and by memory, each row a name, a bar against the
// largest of its own ranking and the value; how its width is shared between the rankings' names, bars and values;
// and its heights from the line boxes St measures. Decided here as pure functions, so the St glue (heaviestTile.js)
// only assigns finished values.
//
// - The words and tooltips are the apps card's (lib/cockpitFormat.js appsRows): a ranking's names, its values
//   ("14%", "11.9G", "640M") and each row's group key. Only the CPU bar differs: here it is against the largest of
//   its ranking, as the memory bar is, and not the whole machine's share.
// - A width that holds text is a fixed part (lib/drawingConstants.js) and the width of a sample text in the text's own
//   class (HEAVIEST_WIDTH_SAMPLE_TEXTS), handed in as `textWidthsPx`; a width that is not a usable reading (as a line
//   box, lib/measuredLengths.js wholeReadingPx) takes its default. Under its stop the tile is narrow: its rankings
//   stand RANKING_GAP_NARROW_PX apart and a name is as wide as its sample text; at its stop and wider, RANKING_GAP_PX
//   apart and a name RANKING_NAME_EXTRA_WIDTH_PX wider. Whatever is left is the bars'.
// - A height that holds text is a fixed part and the line boxes of its text (lib/measuredLengths.js adds the same
//   parts for the layout's sizes, so the height drawn and the height the layout gives are one sum).
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {appsNoDataText, appsRows, canDrawApps} from './cockpitFormat.js';
import {
    BAR_FILL_LEAST_WIDTH_PX, HEAVIEST_FIXED_HEIGHT_PX, HEAVIEST_STOP_EXTRA_WIDTH_PX, RANKING_BAR_LEAST_WIDTH_PX,
    RANKING_GAP_NARROW_PX, RANKING_GAP_PX, RANKING_NAME_EXTRA_WIDTH_PX, RANKING_ROW_FIXED_HEIGHT_PX,
    RANKING_ROW_ITEM_GAP_PX, TILE_BORDER_WIDTH_PX, TILE_PADDING_INLINE_PX,
} from './drawingConstants.js';
import {LineKind, wholeReadingPx} from './measuredLengths.js';
import {lineBoxOrDefaultPx} from './tileLineBoxes.js';

/** The two rankings a Heaviest tile shows, side by side. */
const RANKING_COUNT = 2;
/** The room between a row's name and its bar, and between its bar and its value: two gaps a row. */
const ROW_ITEM_GAP_COUNT = 2;

/**
 * What each of Heaviest's widths that holds text is measured with, and in which class: the name of a long app, and
 * the widest value a ranking writes. With tabular digits any value of as many characters is as wide.
 */
export const HEAVIEST_WIDTH_SAMPLE_TEXTS = Object.freeze({
    rankingName: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['docker.service'])}),
    rankingValue: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['888.8G', '1023M', '100%'])}),
});

/**
 * The sample widths as St gives them at the default text size (Ubuntu Sans 11 pt, text scaling 1): what a tile draws
 * with until something measures them.
 */
export const DEFAULT_HEAVIEST_TEXT_WIDTHS_PX = Object.freeze({rankingName: 95, rankingValue: 46});

/**
 * @typedef {object} RankingRow One row of a ranking.
 * @property {string} name - The app's name.
 * @property {string} valueText - Its CPU share or its memory, in the apps card's words.
 * @property {number} barFraction - Its bar's share of the track: its value over the largest of its ranking, 0 to 1.
 * @property {string[]} tooltipLines - The group it was ranked as.
 */

/**
 * Whether a ranking is one the tile can list: none (null or missing), or an array of entries that are objects.
 *
 * @param {*} ranking - A ranking as the reader gives it.
 * @returns {boolean} True when the tile can list it.
 */
function isListableRanking(ranking) {
    if (ranking === null || ranking === undefined)
        return true;
    return Array.isArray(ranking) && ranking.every(entry => entry !== null && typeof entry === 'object');
}

/**
 * Whether the tile can draw a scan's apps: at least one ranking as an array, an empty one included
 * (lib/cockpitFormat.js canDrawApps), and neither ranking anything but an array of entries or none. Anything else is
 * no data, never a blank tile, and never a throw at the reveal that draws it.
 *
 * @param {object|null|undefined} apps - A pulse snapshot's apps.
 * @returns {boolean} True when the tile draws them.
 */
export function canDrawHeaviest(apps) {
    return canDrawApps(apps) && isListableRanking(apps.cpuRanking) && isListableRanking(apps.memoryRanking);
}

/**
 * The line the tile shows in place of its rankings: the desktop card's words, from the same clock label.
 *
 * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data, or null.
 * @returns {string} 'no data since HH:MM', or 'no data'.
 */
export function heaviestNoDataText(lastGoodClockLabel) {
    return appsNoDataText(lastGoodClockLabel);
}

/**
 * The share of the largest a value is, 0 where the largest is not over 0.
 *
 * @param {number} fraction - The row's fraction.
 * @param {number} largestFraction - The largest fraction of its ranking.
 * @returns {number} 0 to 1.
 */
function shareOfLargest(fraction, largestFraction) {
    return largestFraction > 0 ? Math.min(1, Math.max(0, fraction / largestFraction)) : 0;
}

/**
 * The rows of both rankings, as many each as asked, or fewer where a ranking has fewer. Each bar is against the
 * largest of its own ranking, whatever order the ranking comes in, so an idle machine's rows read 0 % with bars of 0
 * (the tile draws each as its least mark).
 *
 * @param {{cpuRanking: Array<object>|null, memoryRanking: Array<object>|null}} apps - A scan's apps, drawable
 *     (canDrawHeaviest); a null ranking lists no rows.
 * @param {number} rowCount - The rows each ranking shows; anything but a whole number of at least 0 shows none.
 * @returns {{byCpu: RankingRow[], byMemory: RankingRow[]}} The two rankings' rows, largest first.
 */
export function heaviestRankingRows(apps, rowCount) {
    const shownRowCount = Number.isInteger(rowCount) && rowCount > 0 ? rowCount : 0;
    const {cpu, memory} = appsRows(apps, {limit: shownRowCount});
    const largestCpuFraction = Math.max(0, ...cpu.map(entry => entry.cpuFraction));
    const largestMemoryFraction = Math.max(0, ...memory.map(entry => entry.memoryFraction));
    return {
        byCpu: cpu.map(entry => ({
            name: entry.name,
            valueText: entry.cpuText,
            barFraction: shareOfLargest(entry.cpuFraction, largestCpuFraction),
            tooltipLines: entry.tooltip,
        })),
        byMemory: memory.map(entry => ({
            name: entry.name,
            valueText: entry.memoryText,
            barFraction: shareOfLargest(entry.memoryFraction, largestMemoryFraction),
            tooltipLines: entry.tooltip,
        })),
    };
}

/**
 * The sample widths to lay out with: each a whole reading, or its default (DEFAULT_HEAVIEST_TEXT_WIDTHS_PX) where it is
 * not a usable one (missing, null, NaN, not over 0, past the bound), as a line box falls back to its own.
 *
 * @param {*} textWidthsPx - The sample widths handed in.
 * @returns {{rankingName: number, rankingValue: number}} Usable widths.
 */
export function heaviestTextWidthsOrDefaultPx(textWidthsPx) {
    const isObject = textWidthsPx !== null && typeof textWidthsPx === 'object';
    return Object.fromEntries(Object.entries(DEFAULT_HEAVIEST_TEXT_WIDTHS_PX).map(([part, defaultPx]) =>
        [part, wholeReadingPx(isObject ? textWidthsPx[part] : undefined) ?? defaultPx]));
}

/**
 * @typedef {object} HeaviestColumnLayout How the tile's width is shared.
 * @property {number} rankingGapPx - The gap between the two rankings.
 * @property {number} columnWidthPx - Each ranking's width.
 * @property {number} nameWidthPx - A row's name.
 * @property {number} trackWidthPx - A row's bar track: what is left, never under 0.
 * @property {number} valueWidthPx - A row's value, never cut.
 */

/**
 * How the tile's width is shared between its rankings and, in each, a row's name, bar and value. Under its stop the
 * tile is narrow: its rankings stand closer and its names are as wide as their sample text. The odd pixel of a
 * content width that does not halve is left on the right.
 *
 * @param {object} layout - The tile's width and text.
 * @param {number} layout.tileWidthPx - The tile's width; anything but a finite number counts as 0.
 * @param {number} layout.stopWidthPx - Where the tile stops gaining width, from the layout's sizes.
 * @param {*} layout.textWidthsPx - The sample widths (heaviestTextWidthsOrDefaultPx).
 * @returns {HeaviestColumnLayout} The widths, none under 0.
 */
export function heaviestColumnLayout({tileWidthPx, stopWidthPx, textWidthsPx}) {
    const usableTileWidthPx = Number.isFinite(tileWidthPx) ? tileWidthPx : 0;
    const {rankingName, rankingValue} = heaviestTextWidthsOrDefaultPx(textWidthsPx);
    const isNarrow = !(usableTileWidthPx >= stopWidthPx);
    const rankingGapPx = isNarrow ? RANKING_GAP_NARROW_PX : RANKING_GAP_PX;
    const nameExtraWidthPx = isNarrow ? 0 : RANKING_NAME_EXTRA_WIDTH_PX;
    const nameWidthPx = rankingName + nameExtraWidthPx;
    const valueWidthPx = rankingValue;
    const contentWidthPx = usableTileWidthPx - 2 * (TILE_BORDER_WIDTH_PX + TILE_PADDING_INLINE_PX);
    const columnWidthPx = Math.max(0, Math.floor((contentWidthPx - rankingGapPx) / RANKING_COUNT));
    const textAndGapsWidthPx = nameWidthPx + ROW_ITEM_GAP_COUNT * RANKING_ROW_ITEM_GAP_PX + valueWidthPx;
    const trackWidthPx = Math.max(0, columnWidthPx - textAndGapsWidthPx);
    return {rankingGapPx, columnWidthPx, nameWidthPx, trackWidthPx, valueWidthPx};
}

/**
 * Heaviest's least width and its stop, each in a fixed part and a text part. At the least, the tile is narrow and
 * each bar RANKING_BAR_LEAST_WIDTH_PX; the stop is HEAVIEST_STOP_EXTRA_WIDTH_PX more, all of it fixed.
 *
 * @param {*} textWidthsPx - The sample widths (heaviestTextWidthsOrDefaultPx).
 * @returns {{leastWidthPx: {fixedPx: number, textPx: number, totalPx: number},
 *     stopWidthPx: {fixedPx: number, textPx: number, totalPx: number}}} The two widths.
 */
export function heaviestWidthsPx(textWidthsPx) {
    const {rankingName, rankingValue} = heaviestTextWidthsOrDefaultPx(textWidthsPx);
    const rowFixedWidthPx = ROW_ITEM_GAP_COUNT * RANKING_ROW_ITEM_GAP_PX + RANKING_BAR_LEAST_WIDTH_PX;
    const leastFixedPx = 2 * (TILE_BORDER_WIDTH_PX + TILE_PADDING_INLINE_PX) + RANKING_GAP_NARROW_PX +
        RANKING_COUNT * rowFixedWidthPx;
    const textPx = RANKING_COUNT * (rankingName + rankingValue);
    const stopFixedPx = leastFixedPx + HEAVIEST_STOP_EXTRA_WIDTH_PX;
    return {
        leastWidthPx: {fixedPx: leastFixedPx, textPx, totalPx: leastFixedPx + textPx},
        stopWidthPx: {fixedPx: stopFixedPx, textPx, totalPx: stopFixedPx + textPx},
    };
}

/**
 * The tile's heights: its title, its headings and a row each take their line box; above its rows it is
 * HEAVIEST_FIXED_HEIGHT_PX and the title and heading lines, and a row is RANKING_ROW_FIXED_HEIGHT_PX and its line.
 *
 * @param {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @returns {{titleLinePx: number, headingLinePx: number, rowLinePx: number, fixedHeightPx: number,
 *     rowHeightPx: number}} The heights.
 */
export function heaviestHeightsPx(lineBoxesPx) {
    const titleLinePx = lineBoxOrDefaultPx(lineBoxesPx, LineKind.TITLE);
    const headingLinePx = lineBoxOrDefaultPx(lineBoxesPx, LineKind.DETAIL);
    const rowLinePx = lineBoxOrDefaultPx(lineBoxesPx, LineKind.ROW);
    return {
        titleLinePx,
        headingLinePx,
        rowLinePx,
        fixedHeightPx: HEAVIEST_FIXED_HEIGHT_PX + titleLinePx + headingLinePx,
        rowHeightPx: RANKING_ROW_FIXED_HEIGHT_PX + rowLinePx,
    };
}

/**
 * How wide a row's bar fill is drawn: its share of its track in whole pixels, at least BAR_FILL_LEAST_WIDTH_PX on a
 * track that has room for it, so a 0 % row still shows its mark, and never past the track.
 *
 * @param {number} fraction - The row's bar fraction, 0 to 1; anything but a finite number counts as 0.
 * @param {number} trackWidthPx - The track's width.
 * @returns {number} The fill's width.
 */
export function barFillWidthPx(fraction, trackWidthPx) {
    if (!(trackWidthPx > 0))
        return 0;
    const shownFraction = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    const fillWidthPx = Math.round(shownFraction * trackWidthPx);
    return Math.min(trackWidthPx, Math.max(BAR_FILL_LEAST_WIDTH_PX, fillWidthPx));
}
