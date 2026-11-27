// The line boxes a tile draws its text with: the ones St measured (cockpitLengthsMeasurer.js lineBoxesPx), each whole,
// or the default text size's for a line that reads badly or was not handed in, so a tile always draws, at the
// default size's lengths at worst.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {LineKind, wholeReadingPx} from './measuredLengths.js';

/** The line boxes St gives at the default text size (Ubuntu Sans 11 pt, text scaling 1), by LineKind value. */
export const DEFAULT_LINE_BOXES_PX = Object.freeze({
    [LineKind.TITLE]: 23,
    [LineKind.DETAIL]: 17,
    [LineKind.ROW]: 18,
    [LineKind.SCALE]: 14,
    [LineKind.LABEL]: 16,
    [LineKind.FIGURE]: 63,
    [LineKind.FIGURE_SMALL]: 54,
});

/**
 * A line box, whole, or the default text size's where it reads badly or is missing.
 *
 * @param {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @param {string} lineKind - The kind asked for; one of DEFAULT_LINE_BOXES_PX's.
 * @returns {number} The line box.
 */
export function lineBoxOrDefaultPx(lineBoxesPx, lineKind) {
    const isObject = lineBoxesPx !== null && typeof lineBoxesPx === 'object';
    return wholeReadingPx(isObject ? lineBoxesPx[lineKind] : undefined) ?? DEFAULT_LINE_BOXES_PX[lineKind];
}
