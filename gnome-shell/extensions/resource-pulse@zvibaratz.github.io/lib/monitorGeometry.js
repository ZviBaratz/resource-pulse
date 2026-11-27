// The monitor tile's forms by tracks (wide, medium, small): where each of its parts stands, from the tile's size, its form,
// what its tracks hold and the line boxes St measured. CPU and memory are traces on one five-minute plot, with the
// Waiting-on track's strips (and in the wide form the agents track's) on the same plot, the present's rule right of it,
// and the now column right of the rule. Every place is in the tile's own coordinates, from its outer edge.
//
// - Each length is a fixed part (lib/drawingConstants.js) and its text's line box: a track's label slot, a meter's row,
//   the agents track's row and the axis labels grow with the text, and the traces are the fixed part. So a form's
//   height with nothing to fit is the sheet's own sum (lib/measuredLengths.js), and monitorSheetHeightPx says so.
// - A traced track is never shorter than its figure: the figure, less the share of its line box it rises above its
//   trace (MONITOR_FIGURE_LIFT_SHARE), and its lines under it (CPU's one, memory's two) fit the trace and the gap under
//   it. monitorHeightNeedPx is the height that holds both tracks' figures with each trace at least its fixed height.
// - The tile's height does not change with what its tracks hold: the two traces share whatever the height given leaves
//   them, the odd pixel to memory. Where memory's figure needs more than half, memory takes its need and CPU the
//   rest. Where that does not hold CPU's figure, the traces stay even and isFigureFit says so.
// - Without a pressure history the axis closes the traces (and the agents track), and the three meters stand in one
//   row under "Waiting on", in thirds across the tile; each trace is taller by a meter row. The strips take no room.
// - The agents track is in the wide form only, and only where the layout has a sessions card; without it the two
//   traces share its row. A part with no room gets NO_ROOM_BOX, so it is allocated 0 × 0 and never hidden.
// - The width only lengthens the plot: MONITOR_FIXED_WIDTH_PX and the now column stand beside it.
// - The now column's width is the widest of its parts, each a fixed part and its text's width (monitorNowColumnWidthPx).
// - Every length that leaves here is a whole pixel at least 0.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {
    MONITOR_AGENTS_TRACK_GAP_PX, MONITOR_AXIS_GAP_PX, MONITOR_DETAIL_SLOT_FIXED_HEIGHT_PX, MONITOR_FIGURE_LIFT_SHARE,
    MONITOR_FIGURE_UNIT_GAP_PX, MONITOR_FIXED_HEIGHT_PX_BY_FORM, MONITOR_TRACK_GAP_PX_BY_FORM, MONITOR_METER_HEIGHT_PX,
    MONITOR_METER_NAME_GAP_PX, MONITOR_METER_PERCENT_GAP_PX, MONITOR_METER_WIDTH_PX, MONITOR_NOW_COLUMN_GAP_PX,
    MONITOR_NOW_RULE_GAP_PX, MONITOR_NOW_RULE_WIDTH_PX, MONITOR_PADDING_INLINE_PX, MONITOR_PADDING_TOP_PX,
    MONITOR_PLOT_LEAST_BESIDE_ANOTHER_COLUMN_WIDTH_PX, MONITOR_PLOT_LEAST_WIDTH_PX, MONITOR_PLOT_STOP_WIDTH_PX,
    MONITOR_PRESENT_TICK_LENGTH_PX, MONITOR_STRIP_HEIGHT_PX, MONITOR_TRACE_HEIGHT_PX_BY_FORM,
    MONITOR_TRACK_LABEL_SLOT_FIXED_HEIGHT_PX, PRESSURE_RESOURCE_COUNT,
} from './drawingConstants.js';
import {wholeLengthPx} from './compactCardGeometry.js';
import {LineKind, wholeReadingPx} from './measuredLengths.js';
import {lineBoxOrDefaultPx} from './tileLineBoxes.js';

/** The forms by tracks; the engine chooses one (its tile's `monitorForm`). */
export const MonitorForm = Object.freeze({WIDE: 'wide', MEDIUM: 'medium', SMALL: 'small'});

/** Where a part with no room is allocated: nowhere, 0 × 0. */
export const NO_ROOM_BOX = Object.freeze({x: 0, y: 0, width: 0, height: 0});

/** The lines under each figure in a form by tracks: CPU's clusters or no-data line; memory's swap in RAM and on disk. */
export const MONITOR_CPU_DETAIL_LINE_COUNT = 1;
export const MONITOR_MEMORY_DETAIL_LINE_COUNT = 2;

/** The minute labels under the plot, "5 min" to "1 min", one at each minute's tick from the left. */
export const MONITOR_MINUTE_LABEL_COUNT = 5;

/** The width that is neither plot nor now column: the two paddings and the rule's two gaps. */
export const MONITOR_FIXED_WIDTH_PX = 2 * MONITOR_PADDING_INLINE_PX + MONITOR_NOW_RULE_GAP_PX +
    MONITOR_NOW_COLUMN_GAP_PX;

/** The figure's class by form: the small form's figure is the smaller. */
const FIGURE_LINE_KIND_BY_FORM = Object.freeze({
    [MonitorForm.WIDE]: LineKind.FIGURE,
    [MonitorForm.MEDIUM]: LineKind.FIGURE,
    [MonitorForm.SMALL]: LineKind.FIGURE_SMALL,
});

/** The traced tracks, top to bottom, and how many lines stand under each one's figure. */
const TRACE_TRACK_DETAIL_LINE_COUNTS = Object.freeze([MONITOR_CPU_DETAIL_LINE_COUNT, MONITOR_MEMORY_DETAIL_LINE_COUNT]);

/**
 * The fixed height of a form's tracks and gaps at its tightest: the top padding, the two traces, the gaps under them,
 * the agents track's gap (wide only) and the axis's gap.
 *
 * @param {string} form - A MonitorForm value.
 * @returns {number} The height.
 */
function fixedTracksHeightPx(form) {
    const agentsTrackGapPx = form === MonitorForm.WIDE ? MONITOR_AGENTS_TRACK_GAP_PX : 0;
    return MONITOR_PADDING_TOP_PX + 2 * MONITOR_TRACE_HEIGHT_PX_BY_FORM[form] + 2 * MONITOR_TRACK_GAP_PX_BY_FORM[form] +
        agentsTrackGapPx + MONITOR_AXIS_GAP_PX;
}

/** The padding under the last line, by form: what the form's fixed height leaves once its tracks have theirs. */
export const MONITOR_BOTTOM_PADDING_PX_BY_FORM = Object.freeze(Object.fromEntries(Object.values(MonitorForm).map(
    form => [form, MONITOR_FIXED_HEIGHT_PX_BY_FORM[form] - fixedTracksHeightPx(form)])));

/**
 * What each part of the now column's width is measured with, in its own class: the figure and its unit (their widest
 * each, so the widest figure meets the widest unit), a detail line (the lines under the figures, and the agents
 * track's present), and a meter's name and percentage.
 */
export const MONITOR_WIDTH_SAMPLE_TEXTS = Object.freeze({
    figure: Object.freeze({lineKind: LineKind.FIGURE, texts: Object.freeze(['100', '888.8'])}),
    unit: Object.freeze({lineKind: LineKind.UNIT, texts: Object.freeze(['%', 'GiB'])}),
    detail: Object.freeze({lineKind: LineKind.DETAIL, texts: Object.freeze([
        'swap 88.8 · 88.8 in RAM', '+ 88.8 on disk', 'P 88 · E 88', 'no data since 88:88', '88 agents working',
    ])}),
    meterName: Object.freeze({lineKind: LineKind.DETAIL, texts: Object.freeze(['cpu', 'mem', 'io'])}),
    meterPercent: Object.freeze({lineKind: LineKind.DETAIL, texts: Object.freeze(['100%'])}),
});

/** Each part's width at the default text size (Ubuntu Sans 11 pt, text scaling 1). */
export const DEFAULT_MONITOR_TEXT_WIDTHS_PX = Object.freeze({
    figure: 128, unit: 26, detail: 134, meterName: 29, meterPercent: 32,
});

/**
 * @typedef {object} MonitorRowHeights The monitor's rows that hold text, in one form at one text size.
 * @property {number} trackLabelSlotPx - A track's label line and its slot's fixed part.
 * @property {number} meterRowPx - A meter's row (and the agents track's): its detail line and the slot's fixed part.
 * @property {number} axisLabelPx - The axis labels' line.
 * @property {number} rowLinePx - A track label's line (row).
 * @property {number} detailLinePx - A detail line.
 * @property {number} scaleLinePx - A scale label's line.
 * @property {number} figureLinePx - The form's figure's line.
 */

/**
 * @typedef {object} MonitorBox A part's box in the tile's coordinates.
 * @property {number} x - Its left.
 * @property {number} y - Its top.
 * @property {number} width - Its width.
 * @property {number} height - Its height.
 */

/**
 * @typedef {object} MonitorTraceTrack A traced track: its label, its scale, its trace and its figure.
 * @property {number} labelTopPx - The track label's top; its left is the plot's.
 * @property {number} scaleTopPx - The scale label's top: its bottom on the track label's.
 * @property {number} scaleRightPx - Where the scale label ends: the plot's right edge.
 * @property {MonitorBox} traceBox - The trace's drawing area.
 * @property {number} figureTopPx - The figure's top; its left is the now column's.
 * @property {number[]} detailTopsPx - Each line's top under the figure.
 */

/**
 * @typedef {object} MonitorMeterRow One resource's row of the Waiting-on track.
 * @property {MonitorBox} stripBox - Its strip on the plot; NO_ROOM_BOX without a pressure history.
 * @property {MonitorBox} meterBox - Its meter.
 * @property {number} nameLeftPx - Its name's left; the percentage follows the name.
 * @property {number} nameTopPx - Its name's top: centred on the meter.
 */

/**
 * @typedef {object} MonitorGeometry Every part's place.
 * @property {string} form - The form laid out: a MonitorForm value.
 * @property {string} figureLineKind - The figures' LineKind.
 * @property {number} plotLeftPx - The plot's left.
 * @property {number} plotWidthPx - The plot's width, shared by every track.
 * @property {number} nowRuleLeftPx - The present's rule.
 * @property {number} nowColumnLeftPx - The now column's left.
 * @property {MonitorTraceTrack[]} tracks - CPU, then memory.
 * @property {number} waitingOnLabelTopPx - "Waiting on"'s top; its left is the plot's.
 * @property {MonitorMeterRow[]} meterRows - CPU, memory and io.
 * @property {{stripBox: MonitorBox, presentLeftPx: number, presentTopPx: number, isShown: boolean}} agentsTrack - The
 *     agents track's strip and its present's line; NO_ROOM_BOX and not shown without one.
 * @property {number} axisTopPx - The axis labels' top.
 * @property {number[]} minuteLabelLeftsPx - "5 min" to "1 min", each at its minute's tick.
 * @property {MonitorBox} presentEdgeBox - The rule and its ticks: from the first track's label to the axis's gap.
 * @property {number[]} presentTickTopsPx - Each tick's row from the edge's top: each trace's top, middle and bottom.
 * @property {boolean} isFigureFit - Each figure and its lines fit its track and the gap under it.
 */

/**
 * The form asked for, or the wide form for anything else.
 *
 * @param {*} form - A MonitorForm value.
 * @returns {string} A MonitorForm value.
 */
function knownForm(form) {
    return Object.values(MonitorForm).includes(form) ? form : MonitorForm.WIDE;
}

/**
 * A length as a whole number of pixels at least 0.
 *
 * @param {*} lengthPx - A length.
 * @returns {number} It rounded down, or 0 where it is not a finite number over 0.
 */
function wholeOrZeroPx(lengthPx) {
    return Number.isFinite(lengthPx) && lengthPx > 0 ? Math.floor(lengthPx) : 0;
}

/**
 * How far a line's top stands from a box's top for the line to be centred on the box, the odd pixel above.
 *
 * @param {number} boxHeightPx - The box's height.
 * @param {number} lineHeightPx - The line's box.
 * @returns {number} The offset; negative where the line is taller.
 */
function centredOffsetPx(boxHeightPx, lineHeightPx) {
    return Math.floor((boxHeightPx - lineHeightPx) / 2);
}

/**
 * The monitor's rows that hold text, in one form, from the line boxes St measured (the default text size's for a line
 * that reads badly).
 *
 * @param {object} options - The form and its lines.
 * @param {*} options.form - A MonitorForm value.
 * @param {*} options.lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @returns {MonitorRowHeights} The rows.
 */
export function monitorRowHeightsPx({form, lineBoxesPx}) {
    const rowLinePx = lineBoxOrDefaultPx(lineBoxesPx, LineKind.ROW);
    const detailLinePx = lineBoxOrDefaultPx(lineBoxesPx, LineKind.DETAIL);
    return {
        trackLabelSlotPx: MONITOR_TRACK_LABEL_SLOT_FIXED_HEIGHT_PX + rowLinePx,
        meterRowPx: MONITOR_DETAIL_SLOT_FIXED_HEIGHT_PX + detailLinePx,
        axisLabelPx: lineBoxOrDefaultPx(lineBoxesPx, LineKind.LABEL),
        rowLinePx,
        detailLinePx,
        scaleLinePx: lineBoxOrDefaultPx(lineBoxesPx, LineKind.SCALE),
        figureLinePx: lineBoxOrDefaultPx(lineBoxesPx, FIGURE_LINE_KIND_BY_FORM[knownForm(form)]),
    };
}

/**
 * The tile's height less its two traces, in one arrangement.
 *
 * @param {string} form - A MonitorForm value.
 * @param {MonitorRowHeights} rows - The rows.
 * @param {boolean} hasPressureHistory - The Waiting-on track has its strips.
 * @param {boolean} isAgentsTrackShown - The agents track is drawn.
 * @returns {number} The height.
 */
function heightLessTracesPx(form, rows, hasPressureHistory, isAgentsTrackShown) {
    const meterRowCount = hasPressureHistory ? PRESSURE_RESOURCE_COUNT : 1;
    const agentsTrackPx = isAgentsTrackShown ? MONITOR_AGENTS_TRACK_GAP_PX + rows.meterRowPx : 0;
    return MONITOR_PADDING_TOP_PX + PRESSURE_RESOURCE_COUNT * rows.trackLabelSlotPx +
        2 * MONITOR_TRACK_GAP_PX_BY_FORM[form] + meterRowCount * rows.meterRowPx + agentsTrackPx + MONITOR_AXIS_GAP_PX +
        rows.axisLabelPx + MONITOR_BOTTOM_PADDING_PX_BY_FORM[form];
}

/**
 * How far a figure rises above its trace: its share of the figure's line box.
 *
 * @param {MonitorRowHeights} rows - The rows.
 * @returns {number} The lift, whole.
 */
function figureLiftPx(rows) {
    return Math.round(rows.figureLinePx * MONITOR_FIGURE_LIFT_SHARE);
}

/**
 * The least trace a figure and its lines fit beside: the figure less its lift and the lines, less the gap under the
 * track.
 *
 * @param {string} form - A MonitorForm value.
 * @param {MonitorRowHeights} rows - The rows.
 * @param {number} detailLineCount - The lines under the figure.
 * @returns {number} The least trace, at least 0.
 */
function figureNeedPx(form, rows, detailLineCount) {
    const columnPx = rows.figureLinePx - figureLiftPx(rows) + detailLineCount * rows.detailLinePx;
    return Math.max(0, columnPx - MONITOR_TRACK_GAP_PX_BY_FORM[form]);
}

/**
 * The two traces' heights from what the tile leaves them: even, the odd pixel to memory, unless memory's figure needs
 * more; then memory takes its need and CPU the rest, where the rest still holds CPU's figure. CPU's figure never needs
 * more than memory's, which carries one line more.
 *
 * @param {number} tracesPx - The height the two traces share.
 * @param {number[]} needsPx - CPU's and memory's least traces.
 * @returns {{heightsPx: number[], isFigureFit: boolean}} CPU's and memory's heights, and whether both figures fit.
 */
function traceHeightsPx(tracesPx, [cpuNeedPx, memoryNeedPx]) {
    const evenCpuPx = Math.floor(tracesPx / 2);
    const evenMemoryPx = tracesPx - evenCpuPx;
    if (evenCpuPx >= cpuNeedPx && evenMemoryPx >= memoryNeedPx)
        return {heightsPx: [evenCpuPx, evenMemoryPx], isFigureFit: true};
    if (evenMemoryPx < memoryNeedPx && tracesPx - memoryNeedPx >= cpuNeedPx)
        return {heightsPx: [tracesPx - memoryNeedPx, memoryNeedPx], isFigureFit: true};
    return {heightsPx: [evenCpuPx, evenMemoryPx], isFigureFit: false};
}

/**
 * A form's height at its tightest (a pressure history; in the wide form, the agents track) with each trace its fixed
 * height: the sheet's own sum of fixed parts and lines (lib/measuredLengths.js), which a row holds equal to it.
 *
 * @param {object} options - The form and its lines.
 * @param {*} options.form - A MonitorForm value.
 * @param {*} options.lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @returns {number} The height.
 */
export function monitorSheetHeightPx({form, lineBoxesPx}) {
    const knownMonitorForm = knownForm(form);
    const rows = monitorRowHeightsPx({form: knownMonitorForm, lineBoxesPx});
    const isAgentsTrackShown = knownMonitorForm === MonitorForm.WIDE;
    return heightLessTracesPx(knownMonitorForm, rows, true, isAgentsTrackShown) +
        2 * MONITOR_TRACE_HEIGHT_PX_BY_FORM[knownMonitorForm];
}

/**
 * A form's height need: its sheet height, with each trace lengthened to hold its figure where that needs more than the
 * trace's fixed height, in the tightest arrangement. Any other arrangement has as much room for its traces or more.
 *
 * @param {object} options - The form and its lines.
 * @param {*} options.form - A MonitorForm value.
 * @param {*} options.lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @returns {number} The height.
 */
export function monitorHeightNeedPx({form, lineBoxesPx}) {
    const knownMonitorForm = knownForm(form);
    const rows = monitorRowHeightsPx({form: knownMonitorForm, lineBoxesPx});
    const isAgentsTrackShown = knownMonitorForm === MonitorForm.WIDE;
    const traceHeightPx = MONITOR_TRACE_HEIGHT_PX_BY_FORM[knownMonitorForm];
    const tracesPx = TRACE_TRACK_DETAIL_LINE_COUNTS.reduce((totalPx, detailLineCount) =>
        totalPx + Math.max(traceHeightPx, figureNeedPx(knownMonitorForm, rows, detailLineCount)), 0);
    return heightLessTracesPx(knownMonitorForm, rows, true, isAgentsTrackShown) + tracesPx;
}

/**
 * The monitor's widths that the composition places it with: its least, its least where another column stands beside
 * its own, and its stop, each MONITOR_FIXED_WIDTH_PX, the plot's fixed width and the now column.
 *
 * @param {number} nowColumnWidthPx - The now column's width (monitorNowColumnWidthPx).
 * @returns {{leastWidthPx: number, leastWidthBesideAnotherColumnPx: number, stopWidthPx: number}} The widths.
 */
export function monitorWidthsPx(nowColumnWidthPx) {
    const besidePlotPx = MONITOR_FIXED_WIDTH_PX + wholeOrZeroPx(nowColumnWidthPx);
    return {
        leastWidthPx: besidePlotPx + MONITOR_PLOT_LEAST_WIDTH_PX,
        leastWidthBesideAnotherColumnPx: besidePlotPx + MONITOR_PLOT_LEAST_BESIDE_ANOTHER_COLUMN_WIDTH_PX,
        stopWidthPx: besidePlotPx + MONITOR_PLOT_STOP_WIDTH_PX,
    };
}

/**
 * The now column's width: the widest of its parts, each a fixed part and its text's width. A part's width that reads
 * badly is the default text size's.
 *
 * @param {*} textWidthsPx - Each part's text width (MONITOR_WIDTH_SAMPLE_TEXTS' keys).
 * @returns {number} The width, whole.
 */
export function monitorNowColumnWidthPx(textWidthsPx) {
    const isObject = textWidthsPx !== null && typeof textWidthsPx === 'object';
    const widthOf = partName =>
        wholeReadingPx(isObject ? textWidthsPx[partName] : undefined) ?? DEFAULT_MONITOR_TEXT_WIDTHS_PX[partName];
    const figureRowPx = widthOf('figure') + MONITOR_FIGURE_UNIT_GAP_PX + widthOf('unit');
    const meterRowPx = MONITOR_METER_WIDTH_PX + MONITOR_METER_NAME_GAP_PX + widthOf('meterName') +
        MONITOR_METER_PERCENT_GAP_PX + widthOf('meterPercent');
    return Math.max(figureRowPx, widthOf('detail'), meterRowPx);
}

/**
 * A traced track's places.
 *
 * @param {number} labelTopPx - The track label's top.
 * @param {number} traceHeightPx - Its trace's height.
 * @param {number} detailLineCount - The lines under its figure.
 * @param {object} context - What every track shares.
 * @param {MonitorRowHeights} context.rows - The rows.
 * @param {number} context.plotWidthPx - The plot's width.
 * @returns {MonitorTraceTrack} The track.
 */
function traceTrack(labelTopPx, traceHeightPx, detailLineCount, {rows, plotWidthPx}) {
    const traceTopPx = labelTopPx + rows.trackLabelSlotPx;
    const figureTopPx = Math.max(0, traceTopPx - figureLiftPx(rows));
    const detailTopsPx = Array.from({length: detailLineCount},
        (_unused, lineIndex) => figureTopPx + rows.figureLinePx + lineIndex * rows.detailLinePx);
    return {
        labelTopPx,
        scaleTopPx: labelTopPx + Math.max(0, rows.rowLinePx - rows.scaleLinePx),
        scaleRightPx: MONITOR_PADDING_INLINE_PX + plotWidthPx,
        traceBox: {x: MONITOR_PADDING_INLINE_PX, y: traceTopPx, width: plotWidthPx, height: traceHeightPx},
        figureTopPx,
        detailTopsPx,
    };
}

/**
 * The Waiting-on track's three rows: with a history, a strip on the plot and its meter in the now column each; without
 * one, the three meters in one row, in thirds across the tile.
 *
 * @param {number} rowsTopPx - The first row's top.
 * @param {boolean} hasPressureHistory - The strips are drawn.
 * @param {object} context - What the rows share.
 * @param {MonitorRowHeights} context.rows - The rows.
 * @param {number} context.plotWidthPx - The plot's width.
 * @param {number} context.nowColumnLeftPx - The now column's left.
 * @param {number} context.innerWidthPx - The tile's width inside its paddings.
 * @returns {MonitorMeterRow[]} CPU, memory and io.
 */
function meterRows(rowsTopPx, hasPressureHistory, {rows, plotWidthPx, nowColumnLeftPx, innerWidthPx}) {
    const nameOffsetPx = centredOffsetPx(MONITOR_METER_HEIGHT_PX, rows.detailLinePx);
    return Array.from({length: PRESSURE_RESOURCE_COUNT}, (_unused, resourceIndex) => {
        const rowTopPx = hasPressureHistory ? rowsTopPx + resourceIndex * rows.meterRowPx : rowsTopPx;
        const thirdLeftPx = MONITOR_PADDING_INLINE_PX +
            Math.round(resourceIndex * Math.max(0, innerWidthPx) / PRESSURE_RESOURCE_COUNT);
        const meterLeftPx = hasPressureHistory ? nowColumnLeftPx : thirdLeftPx;
        const stripBox = hasPressureHistory
            ? {x: MONITOR_PADDING_INLINE_PX, y: rowTopPx, width: plotWidthPx, height: MONITOR_STRIP_HEIGHT_PX}
            : NO_ROOM_BOX;
        return {
            stripBox,
            meterBox: {x: meterLeftPx, y: rowTopPx, width: MONITOR_METER_WIDTH_PX, height: MONITOR_METER_HEIGHT_PX},
            nameLeftPx: meterLeftPx + MONITOR_METER_WIDTH_PX + MONITOR_METER_NAME_GAP_PX,
            nameTopPx: Math.max(0, rowTopPx + nameOffsetPx),
        };
    });
}

/**
 * The present edge's ticks: each trace's top, middle and bottom row, from the edge's top.
 *
 * @param {MonitorTraceTrack[]} tracks - The traced tracks.
 * @param {number} edgeTopPx - The edge's top.
 * @returns {number[]} The rows.
 */
function presentTickTopsPx(tracks, edgeTopPx) {
    return tracks.flatMap(({traceBox}) => {
        const lastRowPx = Math.max(0, traceBox.height - 1);
        return [0, Math.floor(traceBox.height / 2), lastRowPx].map(rowPx => traceBox.y + rowPx - edgeTopPx);
    });
}

/**
 * Every part's place in one form by tracks.
 *
 * @param {object} options - The tile and what it holds.
 * @param {number} options.widthPx - The tile's width.
 * @param {number} options.heightPx - The tile's height.
 * @param {*} options.form - A MonitorForm value; anything else is the wide form.
 * @param {boolean} options.hasPressureHistory - The sampler publishes a pressure history: the Waiting-on track has
 *     its strips.
 * @param {boolean} options.hasAgentsTrack - The layout has a sessions card: the wide form draws the agents track.
 * @param {*} options.lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @param {number} options.nowColumnWidthPx - The now column's width (monitorNowColumnWidthPx).
 * @returns {MonitorGeometry} Every part's place.
 */
export function monitorGeometry({widthPx, heightPx, form, hasPressureHistory, hasAgentsTrack, lineBoxesPx,
    nowColumnWidthPx}) {
    const knownMonitorForm = knownForm(form);
    const rows = monitorRowHeightsPx({form: knownMonitorForm, lineBoxesPx});
    const tileWidthPx = wholeOrZeroPx(widthPx);
    const nowColumnPx = wholeOrZeroPx(nowColumnWidthPx);
    const plotWidthPx = Math.max(0, tileWidthPx - MONITOR_FIXED_WIDTH_PX - nowColumnPx);
    const nowRuleLeftPx = MONITOR_PADDING_INLINE_PX + plotWidthPx + MONITOR_NOW_RULE_GAP_PX;
    const nowColumnLeftPx = nowRuleLeftPx + MONITOR_NOW_COLUMN_GAP_PX;
    const isAgentsTrackShown = hasAgentsTrack === true && knownMonitorForm === MonitorForm.WIDE;
    const hasStrips = hasPressureHistory === true;
    const trackGapPx = MONITOR_TRACK_GAP_PX_BY_FORM[knownMonitorForm];
    const agentsTrackPx = isAgentsTrackShown ? MONITOR_AGENTS_TRACK_GAP_PX + rows.meterRowPx : 0;

    const tracesPx = Math.max(0, wholeOrZeroPx(heightPx) -
        heightLessTracesPx(knownMonitorForm, rows, hasStrips, isAgentsTrackShown));
    const needsPx = TRACE_TRACK_DETAIL_LINE_COUNTS.map(lineCount => figureNeedPx(knownMonitorForm, rows, lineCount));
    const {heightsPx: [cpuTracePx, memoryTracePx], isFigureFit} = traceHeightsPx(tracesPx, needsPx);

    const context = {rows, plotWidthPx, nowColumnLeftPx, innerWidthPx: tileWidthPx - 2 * MONITOR_PADDING_INLINE_PX};
    const cpuTrack = traceTrack(MONITOR_PADDING_TOP_PX, cpuTracePx, MONITOR_CPU_DETAIL_LINE_COUNT, context);
    const memoryLabelTopPx = cpuTrack.traceBox.y + cpuTracePx + trackGapPx;
    const memoryTrack = traceTrack(memoryLabelTopPx, memoryTracePx, MONITOR_MEMORY_DETAIL_LINE_COUNT, context);
    const tracesBottomPx = memoryTrack.traceBox.y + memoryTracePx;

    // With a history the strips follow the traces and the axis runs under them (and the agents track); without one the
    // axis closes the traces and the agents track, and the meters stand under it.
    const axisClosingTracesBottomPx = tracesBottomPx + agentsTrackPx + MONITOR_AXIS_GAP_PX + rows.axisLabelPx;
    const waitingOnLabelTopPx = (hasStrips ? tracesBottomPx : axisClosingTracesBottomPx) + trackGapPx;
    const meterRowsTopPx = waitingOnLabelTopPx + rows.trackLabelSlotPx;
    const lastTimedTrackBottomPx = hasStrips ? meterRowsTopPx + PRESSURE_RESOURCE_COUNT * rows.meterRowPx
        : tracesBottomPx;
    const agentsTrackTopPx = lastTimedTrackBottomPx + MONITOR_AGENTS_TRACK_GAP_PX;
    const axisTopPx = lastTimedTrackBottomPx + agentsTrackPx + MONITOR_AXIS_GAP_PX;
    const presentEdgeHeightPx = Math.max(0, axisTopPx - MONITOR_AXIS_GAP_PX - MONITOR_PADDING_TOP_PX);
    const agentsStripBox = isAgentsTrackShown
        ? {x: MONITOR_PADDING_INLINE_PX, y: agentsTrackTopPx, width: plotWidthPx, height: MONITOR_STRIP_HEIGHT_PX}
        : NO_ROOM_BOX;
    const agentsPresentTopPx = Math.max(0,
        agentsTrackTopPx + centredOffsetPx(MONITOR_STRIP_HEIGHT_PX, rows.detailLinePx));

    return {
        form: knownMonitorForm,
        figureLineKind: FIGURE_LINE_KIND_BY_FORM[knownMonitorForm],
        plotLeftPx: MONITOR_PADDING_INLINE_PX,
        plotWidthPx,
        nowRuleLeftPx,
        nowColumnLeftPx,
        tracks: [cpuTrack, memoryTrack],
        waitingOnLabelTopPx,
        meterRows: meterRows(meterRowsTopPx, hasStrips, context),
        agentsTrack: {
            stripBox: agentsStripBox,
            presentLeftPx: isAgentsTrackShown ? nowColumnLeftPx : 0,
            presentTopPx: isAgentsTrackShown ? agentsPresentTopPx : 0,
            isShown: isAgentsTrackShown,
        },
        axisTopPx,
        minuteLabelLeftsPx: Array.from({length: MONITOR_MINUTE_LABEL_COUNT}, (_unused, tickIndex) =>
            MONITOR_PADDING_INLINE_PX + Math.round(tickIndex * plotWidthPx / MONITOR_MINUTE_LABEL_COUNT)),
        presentEdgeBox: {
            x: nowRuleLeftPx, y: MONITOR_PADDING_TOP_PX,
            width: MONITOR_NOW_RULE_WIDTH_PX + MONITOR_PRESENT_TICK_LENGTH_PX, height: presentEdgeHeightPx,
        },
        presentTickTopsPx: presentTickTopsPx([cpuTrack, memoryTrack], MONITOR_PADDING_TOP_PX),
        isFigureFit,
    };
}

/**
 * Where a figure's unit stands: MONITOR_FIGURE_UNIT_GAP_PX after the figure, on the figure's baseline.
 *
 * @param {import('./compactCardGeometry.js').TextPart} figure - The figure ("37").
 * @param {import('./compactCardGeometry.js').TextPart} unit - Its unit ("%").
 * @returns {{unitLeftOffsetPx: number, unitTopOffsetPx: number}} The unit's offsets from the figure's top left.
 */
export function monitorUnitPlacement(figure, unit) {
    const figureBaselinePx = Number.isFinite(figure.baselinePx) ? figure.baselinePx : 0;
    const unitBaselinePx = Number.isFinite(unit.baselinePx) ? unit.baselinePx : figureBaselinePx;
    return {
        unitLeftOffsetPx: wholeLengthPx(figure.widthPx) + MONITOR_FIGURE_UNIT_GAP_PX,
        unitTopOffsetPx: Math.round(figureBaselinePx - unitBaselinePx),
    };
}

/**
 * Where a meter's percentage stands: MONITOR_METER_PERCENT_GAP_PX after its name, on the same line.
 *
 * @param {import('./compactCardGeometry.js').TextPart} meterName - The name ("cpu").
 * @returns {number} The percentage's left offset from the name's left.
 */
export function monitorMeterPercentLeftOffsetPx(meterName) {
    return wholeLengthPx(meterName.widthPx) + MONITOR_METER_PERCENT_GAP_PX;
}
