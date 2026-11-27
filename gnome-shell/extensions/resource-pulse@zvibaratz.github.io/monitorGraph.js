// Cairo drawing for the monitor tile's own marks: the present's edge, a 1 px rule down the tile from the first track's
// label to the axis, with a short tick right of it at the top, the middle and the foot of each trace; and the agents
// track, a bar per cell under the pressure strips' cells, with a cap where a session was blocked. Pure functions of a
// Cairo context and plain numbers, with no Shell or St import, so they run under plain `gjs -m` against an image
// surface.
//
// They run inside gnome-shell on every repaint of their drawing, so nothing they are handed can make them throw: a
// drawing with no room draws nothing, a tick row outside the edge, or not a whole pixel, is left out, and so is a cell
// whose count is not a whole number at least 0.
import {fillRoundedCells, pressureStripCellRects} from './graph.js';
import {
    AGENTS_TRACK_CALM_DASH_HEIGHT_PX, AGENTS_TRACK_CAP_GAP_PX, AGENTS_TRACK_CAP_HEIGHT_PX,
    AGENTS_TRACK_LEAST_BAR_HEIGHT_PX, MONITOR_NOW_RULE_WIDTH_PX, MONITOR_PRESENT_TICK_LENGTH_PX,
    MONITOR_PRESENT_TICK_THICKNESS_PX, PRESSURE_STRIP_CELL_RADIUS_PX,
} from './lib/drawingConstants.js';

/** The caps drawn, in the order they are filled. */
const ONGOING_CAP_STATE = 'ongoing';
const ENDED_CAP_STATE = 'ended';
const CAP_STATES_DRAWN = Object.freeze([ONGOING_CAP_STATE, ENDED_CAP_STATE]);
/** The band each agents cell is placed with: a strip places its cells the same, whatever their bands. */
const PLACING_BAND = 0;

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

/**
 * Whether a cell's count can be drawn: a whole number at least 0.
 *
 * @param {*} workingCount - The count.
 * @returns {boolean} True where it can.
 */
function isDrawableCount(workingCount) {
    return Number.isInteger(workingCount) && workingCount >= 0;
}

/**
 * The agents track's rectangles. Each cell stands where the pressure strips' cell of its index stands (graph.js
 * pressureStripCellRects, at the same width), so a cell is under the strips' moment. A cell's bar stands on the
 * strip's foot: one where no one was working is a 1 px dash; any other is its count against the most in the track,
 * over the strip less the cap and the gap under it, and never under 2 px. A cell in which a session was blocked
 * carries a cap at the strip's top. A cell told nothing draws nothing.
 *
 * @param {number} widthPx - The strip's width: the plot's.
 * @param {number} heightPx - Its height.
 * @param {*} cells - The cells, oldest first (lib/agentsTrack.js AgentsTrackRecorder cells).
 * @returns {{bars: Array<{isCalm: boolean, rect: number[]}>, caps: Array<{capState: string, rect: number[]}>}} Each
 *     as [x, y, width, height]; none with no room.
 */
export function agentsTrackCellRects(widthPx, heightPx, cells) {
    const noRects = {bars: [], caps: []};
    if (!Array.isArray(cells) || cells.length === 0)
        return noRects;
    const placingRects = pressureStripCellRects(widthPx, heightPx, Array(cells.length).fill(PLACING_BAND));
    if (placingRects.length !== cells.length)
        return noRects;
    const drawableCounts = cells.map(cell => cell?.workingCount).filter(isDrawableCount);
    const mostWorkingCount = Math.max(1, ...drawableCounts);
    const barRoomPx = Math.max(0, heightPx - AGENTS_TRACK_CAP_HEIGHT_PX - AGENTS_TRACK_CAP_GAP_PX);
    const capHeightPx = Math.min(AGENTS_TRACK_CAP_HEIGHT_PX, heightPx);
    const bars = [];
    const caps = [];
    cells.forEach((cell, cellIndex) => {
        const workingCount = cell?.workingCount;
        if (!isDrawableCount(workingCount))
            return;
        const [leftPx, , cellWidthPx] = placingRects[cellIndex].rect;
        const isCalm = workingCount === 0;
        const scaledHeightPx = Math.round(workingCount / mostWorkingCount * barRoomPx);
        const barHeightPx = Math.min(heightPx,
            isCalm ? AGENTS_TRACK_CALM_DASH_HEIGHT_PX : Math.max(AGENTS_TRACK_LEAST_BAR_HEIGHT_PX, scaledHeightPx));
        bars.push({isCalm, rect: [leftPx, heightPx - barHeightPx, cellWidthPx, barHeightPx]});
        if (CAP_STATES_DRAWN.includes(cell.capState))
            caps.push({capState: cell.capState, rect: [leftPx, 0, cellWidthPx, capHeightPx]});
    });
    return {bars, caps};
}

/**
 * Draws the agents track: the dashes, then the bars, each with the strips' rounded corners, then the ongoing caps,
 * then the ended ones.
 *
 * @param {object} cr - The Cairo context.
 * @param {number} widthPx - The strip's width.
 * @param {number} heightPx - Its height.
 * @param {*} cells - The cells, oldest first.
 * @param {object} ink - The track's colours, as [red, green, blue, alpha], each 0–1.
 * @param {number[]} ink.calmRgba - A dash: no one working.
 * @param {number[]} ink.workingRgba - A bar.
 * @param {number[]} ink.ongoingCapRgba - A cap whose wait goes on.
 * @param {number[]} ink.endedCapRgba - A cap whose wait has ended.
 * @returns {void}
 */
export function drawAgentsTrack(cr, widthPx, heightPx, cells, {calmRgba, workingRgba, ongoingCapRgba, endedCapRgba}) {
    const {bars, caps} = agentsTrackCellRects(widthPx, heightPx, cells);
    if (bars.length === 0)
        return;
    cr.newPath();
    const barRectsWhere = isCalm => bars.filter(bar => bar.isCalm === isCalm).map(({rect}) => rect);
    const capRectsOf = capState => caps.filter(cap => cap.capState === capState).map(({rect}) => rect);
    fillRoundedCells(cr, barRectsWhere(true), calmRgba, PRESSURE_STRIP_CELL_RADIUS_PX);
    fillRoundedCells(cr, barRectsWhere(false), workingRgba, PRESSURE_STRIP_CELL_RADIUS_PX);
    fillRects(cr, capRectsOf(ONGOING_CAP_STATE), ongoingCapRgba);
    fillRects(cr, capRectsOf(ENDED_CAP_STATE), endedCapRgba);
}
