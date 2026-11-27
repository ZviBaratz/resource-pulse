// Cairo drawing for the monitor tile's own marks: the present's edge, a 1 px rule down the tile from the first track's
// label to the axis, with a short tick right of it at the top, the middle and the foot of each trace. A pure function of
// a Cairo context and plain numbers, with no Shell or St import, so it runs under plain `gjs -m` against an image
// surface.
//
// It runs inside gnome-shell on every repaint of its drawing, so nothing it is handed can make it throw: an edge with no
// room draws nothing, and a tick row outside the edge, or not a whole pixel, is left out.
import {
    MONITOR_NOW_RULE_WIDTH_PX, MONITOR_PRESENT_TICK_LENGTH_PX, MONITOR_PRESENT_TICK_THICKNESS_PX,
} from './lib/drawingConstants.js';

/**
 * Whether an area has room to draw in.
 *
 * @param {number} widthPx - Its width.
 * @param {number} heightPx - Its height.
 * @returns {boolean} Both are finite and over 0.
 */
function hasDrawableArea(widthPx, heightPx) {
    return Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0;
}

/**
 * The present edge's rectangles: the rule at the edge's left, down its whole height, and a tick right of the rule at
 * each row given, where the edge has room for one.
 *
 * @param {number} widthPx - The edge's width: the rule and a tick.
 * @param {number} heightPx - Its height.
 * @param {*} tickRowsPx - Each tick's row from the edge's top (lib/monitorGeometry.js presentTickTopsPx).
 * @returns {{ruleRect: number[]|null, tickRects: number[][]}} Each as [x, y, width, height]; no rule with no room.
 */
export function presentEdgeRects(widthPx, heightPx, tickRowsPx) {
    if (!hasDrawableArea(widthPx, heightPx))
        return {ruleRect: null, tickRects: []};
    const ruleRect = [0, 0, MONITOR_NOW_RULE_WIDTH_PX, heightPx];
    const tickWidthPx = Math.min(MONITOR_PRESENT_TICK_LENGTH_PX, widthPx - MONITOR_NOW_RULE_WIDTH_PX);
    const rows = Array.isArray(tickRowsPx) ? tickRowsPx : [];
    const isRowOnEdge = rowPx => Number.isInteger(rowPx) && rowPx >= 0 && rowPx < heightPx;
    const tickRects = tickWidthPx <= 0 ? [] : rows.filter(isRowOnEdge).map(rowPx =>
        [MONITOR_NOW_RULE_WIDTH_PX, rowPx, tickWidthPx, MONITOR_PRESENT_TICK_THICKNESS_PX]);
    return {ruleRect, tickRects};
}

/**
 * Fills rectangles in one colour, in one fill; nothing for none.
 *
 * @param {object} cr - The Cairo context.
 * @param {number[][]} rects - Each as [x, y, width, height].
 * @param {number[]} rgba - Their colour.
 * @returns {void}
 */
function fillRects(cr, rects, rgba) {
    if (rects.length === 0)
        return;
    cr.setSourceRGBA(...rgba);
    for (const rect of rects)
        cr.rectangle(...rect);
    cr.fill();
}

/**
 * Draws the present edge: the rule in its ink, then the ticks in theirs.
 *
 * @param {object} cr - The Cairo context.
 * @param {number} widthPx - The edge's width.
 * @param {number} heightPx - Its height.
 * @param {*} tickRowsPx - Each tick's row from the edge's top.
 * @param {number[]} ruleRgba - The rule's colour.
 * @param {number[]} tickRgba - The ticks' colour.
 * @returns {void}
 */
export function drawPresentEdge(cr, widthPx, heightPx, tickRowsPx, ruleRgba, tickRgba) {
    const {ruleRect, tickRects} = presentEdgeRects(widthPx, heightPx, tickRowsPx);
    if (ruleRect === null)
        return;
    fillRects(cr, [ruleRect], ruleRgba);
    fillRects(cr, tickRects, tickRgba);
}
