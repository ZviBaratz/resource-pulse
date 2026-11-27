// Cairo drawing for the desktop card's two traces: a five-minute history on a plot, the newest sample at the right
// edge. A pure function of a Cairo context and plain numbers, with no Shell or St import, so it runs under plain
// `gjs -m` against an image surface.
//
// - Behind each trace a faint grid: a line along the top, a dashed one at half height, a dashed tick at each minute,
//   and the baseline.
// - Under the line, an area that fades from the series colour at the line's highest point to nothing at the baseline.
// - The line itself, 2 px with round joins.
// - A gap (a value that is not a finite number: a Sample that had no reading) is hatched, from the sample before it to
//   the sample after it, and never bridged, so "no data" differs from zero in shape.
// - A history shorter than the plot leaves the plot's left empty: no line, no area and no hatch where nothing was
//   recorded yet.
//
// It runs inside gnome-shell on every repaint, so no history can make it throw: every value is clamped to 0–1, and an
// area with no size, or a plot of fewer than two slots, draws nothing but what it can.
import Cairo from 'cairo';

/** The minutes the plot spans: a dashed tick between each two. */
const PLOT_MINUTES = 5;
/** The line's width, and the grid's. */
const TRACE_LINE_WIDTH_PX = 2;
const GRID_LINE_WIDTH_PX = 1;
/** The dashed grid lines: 2 px on, 4 px off. */
const GRID_DASH_PATTERN_PX = [2, 4];
/** The hatch of a gap: lines at 45 degrees, 7 px apart, 1.5 px wide. */
const HATCH_SPACING_PX = 7;
const HATCH_LINE_WIDTH_PX = 1.5;
/** Half a pixel: a 1 px line on a pixel's centre is drawn crisp. */
const HALF_PIXEL = 0.5;

/**
 * @typedef {object} TraceRun
 * @property {boolean} isGap - The run is a gap (no reading), not samples with data.
 * @property {number} firstSlot - Its first slot on the plot, 0 at the left.
 * @property {number} lastSlot - Its last slot.
 */

/**
 * @typedef {object} TraceInk
 * @property {number[]} lineRgba - The line, as [red, green, blue, alpha], each 0–1.
 * @property {number} areaAlpha - The area's alpha at the line's highest point; it fades to 0 at the baseline.
 * @property {number[]} gridRgba - The top line, the half-height line and the minute ticks.
 * @property {number[]} baselineRgba - The baseline.
 * @property {number[]} hatchRgba - A gap's hatch.
 */

/**
 * A value as a fraction of the plot's height, or a gap.
 *
 * @param {*} value - A history's value.
 * @returns {number|null} The value clamped to 0–1; null when it is not a finite number.
 */
function fractionOrGap(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    return Math.min(1, Math.max(0, value));
}

/**
 * The samples of a history the plot shows, and the slot of the oldest: the newest sample stands in the last slot, and a
 * history longer than the plot keeps its newest samples.
 *
 * @param {*} history - The history, oldest first; anything but an array is an empty one.
 * @param {*} slotCount - The plot's slots; anything but a finite number of 1 or more is none.
 * @returns {{slotCount: number, shownHistory: Array<*>, firstRecordedSlot: number}} The whole slot count, the samples
 *     shown, and the slot of the first of them.
 */
function shownSamples(history, slotCount) {
    const wholeSlotCount = Number.isFinite(slotCount) && slotCount >= 1 ? Math.floor(slotCount) : 0;
    const samples = Array.isArray(history) ? history : [];
    const shownHistory = wholeSlotCount === 0 ? [] : samples.slice(-wholeSlotCount);
    return {slotCount: wholeSlotCount, shownHistory, firstRecordedSlot: wholeSlotCount - shownHistory.length};
}

/**
 * Splits a history into its runs of samples with data and its gaps, placed on the plot's slots: the newest sample in
 * the last slot, and the slots before the oldest left out, since nothing was recorded there. A history longer than the
 * plot keeps its newest samples.
 *
 * @param {Array<number|null>} history - The history, oldest first; a value that is not a finite number is a gap.
 * @param {number} slotCount - The plot's slots, one per sample.
 * @returns {TraceRun[]} The runs, left to right.
 */
export function traceRuns(history, slotCount) {
    const {shownHistory, firstRecordedSlot} = shownSamples(history, slotCount);
    const runs = [];
    shownHistory.forEach((value, sampleIndex) => {
        const isGap = fractionOrGap(value) === null;
        const slot = firstRecordedSlot + sampleIndex;
        const currentRun = runs.at(-1);
        if (currentRun !== undefined && currentRun.isGap === isGap)
            currentRun.lastSlot = slot;
        else
            runs.push({isGap, firstSlot: slot, lastSlot: slot});
    });
    return runs;
}

/**
 * Draws the faint grid behind a trace.
 *
 * @param {Cairo.Context} cr - Where to draw.
 * @param {number} widthPx - The plot's width.
 * @param {number} heightPx - The plot's height.
 * @param {TraceInk} ink - The grid's colours.
 * @returns {void}
 */
function drawTraceGrid(cr, widthPx, heightPx, {gridRgba, baselineRgba}) {
    cr.setLineWidth(GRID_LINE_WIDTH_PX);
    cr.setSourceRGBA(...gridRgba);
    cr.setDash([], 0);
    cr.moveTo(0, HALF_PIXEL);
    cr.lineTo(widthPx, HALF_PIXEL);
    cr.stroke();
    cr.setDash(GRID_DASH_PATTERN_PX, 0);
    const halfHeightY = Math.floor(heightPx / 2) + HALF_PIXEL;
    cr.moveTo(0, halfHeightY);
    cr.lineTo(widthPx, halfHeightY);
    for (let minute = 1; minute < PLOT_MINUTES; minute++) {
        const tickX = Math.round((minute / PLOT_MINUTES) * widthPx) + HALF_PIXEL;
        cr.moveTo(tickX, 0);
        cr.lineTo(tickX, heightPx);
    }
    cr.stroke();
    cr.setDash([], 0);
    cr.setSourceRGBA(...baselineRgba);
    cr.moveTo(0, heightPx - HALF_PIXEL);
    cr.lineTo(widthPx, heightPx - HALF_PIXEL);
    cr.stroke();
}

/**
 * Hatches one gap: lines at 45 degrees, anchored to the plot's own left so neighbouring gaps share one pattern.
 *
 * @param {Cairo.Context} cr - Where to draw.
 * @param {number} leftX - The gap's left edge.
 * @param {number} rightX - Its right edge.
 * @param {number} heightPx - The plot's height.
 * @param {number[]} hatchRgba - The hatch's colour.
 * @returns {void}
 */
function hatchGap(cr, leftX, rightX, heightPx, hatchRgba) {
    if (rightX <= leftX)
        return;
    const stepX = HATCH_SPACING_PX * Math.SQRT2;
    cr.save();
    cr.rectangle(leftX, 0, rightX - leftX, heightPx);
    cr.clip();
    cr.setLineWidth(HATCH_LINE_WIDTH_PX);
    cr.setSourceRGBA(...hatchRgba);
    // Each line runs from the bottom up to the right; start one plot's height to the left so the gap is covered.
    for (let lineX = Math.floor((leftX - heightPx) / stepX) * stepX; lineX <= rightX; lineX += stepX) {
        cr.moveTo(lineX, heightPx);
        cr.lineTo(lineX + heightPx, 0);
    }
    cr.stroke();
    cr.restore();
}

/**
 * Draws one run of samples with data: its area, fading from its highest point to the baseline, then its line.
 *
 * @param {Cairo.Context} cr - Where to draw.
 * @param {Array<{x: number, y: number}>} points - The run's samples on the plot, left to right.
 * @param {number} heightPx - The plot's height.
 * @param {TraceInk} ink - The line's colour and the area's alpha.
 * @returns {void}
 */
function drawDataRun(cr, points, heightPx, {lineRgba, areaAlpha}) {
    if (points.length < 2)
        return;
    const [red, green, blue] = lineRgba;
    const highestY = Math.min(...points.map(({y}) => y));
    const fade = new Cairo.LinearGradient(0, highestY, 0, heightPx);
    fade.addColorStopRGBA(0, red, green, blue, areaAlpha);
    fade.addColorStopRGBA(1, red, green, blue, 0);
    cr.setSource(fade);
    cr.moveTo(points[0].x, heightPx);
    for (const {x, y} of points)
        cr.lineTo(x, y);
    cr.lineTo(points.at(-1).x, heightPx);
    cr.closePath();
    cr.fill();
    cr.setLineWidth(TRACE_LINE_WIDTH_PX);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSourceRGBA(...lineRgba);
    cr.moveTo(points[0].x, points[0].y);
    for (const {x, y} of points.slice(1))
        cr.lineTo(x, y);
    cr.stroke();
}

/**
 * Draws a trace: the grid, then each run of the history, the newest sample at the right edge.
 *
 * @param {Cairo.Context} cr - Where to draw.
 * @param {number} widthPx - The plot's width.
 * @param {number} heightPx - The plot's height.
 * @param {Array<number|null>} history - Fractions of the plot's height, oldest first; a gap is a value that is not a
 *     finite number.
 * @param {number} slotCount - The plot's slots, one per sample of a full history.
 * @param {TraceInk} ink - The trace's colours.
 * @returns {void}
 */
export function drawTrace(cr, widthPx, heightPx, history, slotCount, ink) {
    if (!(widthPx > 0 && heightPx > 0))
        return;
    cr.newPath();
    drawTraceGrid(cr, widthPx, heightPx, ink);
    const {slotCount: wholeSlotCount, shownHistory, firstRecordedSlot} = shownSamples(history, slotCount);
    const lastSlot = Math.max(1, wholeSlotCount - 1);
    const xOfSlot = slot => (slot / lastSlot) * widthPx;
    for (const {isGap, firstSlot, lastSlot: runLastSlot} of traceRuns(history, slotCount)) {
        if (isGap) {
            // From the sample before the gap to the sample after it, within what was recorded.
            const leftX = xOfSlot(Math.max(firstRecordedSlot, firstSlot - 1));
            const rightX = xOfSlot(Math.min(lastSlot, runLastSlot + 1));
            hatchGap(cr, leftX, rightX, heightPx, ink.hatchRgba);
            continue;
        }
        const points = [];
        for (let slot = firstSlot; slot <= runLastSlot; slot++) {
            const fraction = fractionOrGap(shownHistory[slot - firstRecordedSlot]);
            points.push({x: xOfSlot(slot), y: heightPx - fraction * heightPx});
        }
        drawDataRun(cr, points, heightPx, ink);
    }
}
