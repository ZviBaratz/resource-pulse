// Where every part of the desktop card's compact form stands, from the lengths of two kinds: the fixed ones, in
// logical pixels (lib/drawingConstants.js), and the line boxes of its text, which St measures in the card's own font
// at its own size. Text scaling grows the line boxes, and the now column and the side padding (both in em in
// stylesheet.css), and with the line boxes the traces' height where the memory figure's lines need the room (below);
// the plots' width, the strips and the gaps between the parts are fixed.
//
//   CPU  Chromium 14%            |  37 %
//   [trace, 150 samples]         |  P 58 · E 12
//   Memory  herdr agents 11.9G   |  24.1 GiB
//   [trace]                      |  of 30.3 / swap 1.6 · 0.4 in RAM
//   5 min                       now
//   Waiting on
//   [meter] cpu 12%   [meter] mem 0%   [meter] io 31%
//
// That is the form without a pressure history: the axis closes the traces, and the three meters stand in one row
// across the card, each trace taking one of the two pressure rows given up. With a history each resource is a row,
// its strip on the plot and its meter beside the present, under the memory figure's lines, and the axis runs under
// the strips. Where the memory figure and its lines would reach the meters there, the memory trace grows by the
// difference; without a history the two traces share the same growth. So the card is one height in both forms.
// Every position is from the top left of the card's content box (inside its border and padding).
//
// Pure: no Shell, St, Clutter or Meta import, so it runs under plain gjs. compactCardLayout.js reads the line boxes
// and allocates the parts where this says.
import {
    COMPACT_AXIS_GAP_PX, COMPACT_FIGURE_LIFT_SHARE, COMPACT_HEAVIEST_NAME_GAP_PX, COMPACT_HEAVIEST_VALUE_GAP_PX,
    COMPACT_MEMORY_DETAIL_LINE_COUNT, COMPACT_SECTION_GAP_PX, COMPACT_SECTION_LABEL_GAP_PX, COMPACT_METER_NAME_GAP_PX,
    COMPACT_METER_PERCENT_GAP_PX, COMPACT_METER_ROW_CLEARANCE_PX, COMPACT_NOW_COLUMN_GAP_PX, COMPACT_NOW_RULE_GAP_PX,
    COMPACT_NOW_RULE_WIDTH_PX, COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX, COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_ROW_GAP_PX,
    COMPACT_PRESSURE_STRIP_HEIGHT_PX, COMPACT_TRACE_HEIGHT_PX, COMPACT_UNIT_GAP_PX, PRESSURE_METER_HEIGHT_PX,
    PRESSURE_METER_WIDTH_PX, PRESSURE_RESOURCE_COUNT,
} from './drawingConstants.js';

/** The least plot the card draws, in logical pixels: what is left when it has given up all it can. */
const LEAST_PLOT_WIDTH_PX = COMPACT_PLOT_WIDTH_PX - COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX;
/** Everything across the card but the plot and the now column: the gap to the now rule and on to the figures. */
const NOW_GAPS_WIDTH_PX = COMPACT_NOW_RULE_GAP_PX + COMPACT_NOW_COLUMN_GAP_PX;
/** The resource scale of a monitor that is not scaled, taken where a label reports none that can be used. */
const UNSCALED_RESOURCE_SCALE = 1;

/**
 * @typedef {object} CompactCardLineBoxes
 * @property {number} sectionLabelPx - A section's label line ("CPU", "Memory", "Waiting on"), as St measures it.
 * @property {number} meterNamePx - A meter's name line ("cpu 12%").
 * @property {number} axisLabelPx - The time axis's line ("5 min", "now").
 * @property {number} figurePx - A figure's line box ("37").
 * @property {number} detailPx - One line under a figure ("P 58 · E 12").
 */

/**
 * @typedef {object} Rect
 * @property {number} x - Left edge, from the content box's left.
 * @property {number} y - Top edge, from the content box's top.
 * @property {number} width - Width.
 * @property {number} height - Height.
 */

/**
 * @typedef {object} CompactSection
 * @property {number} labelTopPx - The top of the section's label line.
 * @property {Rect} trace - The trace's plot.
 * @property {number} figureTopPx - The top of the figure's line box, which starts above the trace.
 * @property {number} detailsTopPx - The top of the first line under the figure.
 */

/**
 * @typedef {object} CompactPressureRow
 * @property {Rect} meter - The drawn meter.
 * @property {number} nameLeftPx - The left of the meter's name.
 * @property {number} nameTopPx - The top of the name's line box, on which the meter is centred.
 * @property {Rect|null} strip - The pressure strip on the plot; null without a history.
 */

/**
 * @typedef {object} CompactTraceHeights
 * @property {number} cpuTracePx - The CPU trace's height.
 * @property {number} memoryTracePx - The memory trace's height.
 * @property {number} aboveWaitingOnPx - What the growth leaves over, which goes above "Waiting on": 0 or 1 px.
 */

/**
 * @typedef {object} CompactCardGeometry
 * @property {number} contentWidthPx - The content's width: the card's natural one, or a narrower content box's down
 *     to the least the plot leaves.
 * @property {number} contentHeightPx - The content's height, the same in both forms.
 * @property {number} plotWidthPx - The plot's width: COMPACT_PLOT_WIDTH_PX, less what a narrow cell takes.
 * @property {number} nowColumnLeftPx - The left of the figures.
 * @property {number} nowColumnWidthPx - The now column's width.
 * @property {number} detailLinePx - The pitch of the lines under a figure: one line box each.
 * @property {CompactSection} cpu - The CPU section.
 * @property {CompactSection} memory - The memory section.
 * @property {Rect} nowRule - The present's rule, from the CPU section's top to above the axis.
 * @property {number} axisTopPx - The top of the time axis's line.
 * @property {number} nowLabelCentrePx - Where "now" is centred, under the rule.
 * @property {number} waitingOnTopPx - The top of the "Waiting on" label line.
 * @property {CompactPressureRow[]} pressureRows - CPU, memory and io.
 */

/**
 * A length that is a whole number of pixels at least 0, from anything: what a line box or a width read from St is
 * taken as, so a missing or broken reading never turns into NaN or a negative size.
 *
 * @param {*} lengthPx - A length in pixels.
 * @returns {number} It rounded, or 0 when it is not a finite number of 0 or more.
 */
export function wholeLengthPx(lengthPx) {
    return Number.isFinite(lengthPx) && lengthPx > 0 ? Math.round(lengthPx) : 0;
}

/**
 * A length read from a label's own text layout, in logical pixels. Clutter lays a label's text out at its actor's
 * resource scale (2 on a monitor scaled to 200 %), so every length of that layout is that many times the length St
 * measures the label at.
 *
 * @param {number} layoutLengthPx - The length in the layout's pixels: its Pango units over Pango.SCALE.
 * @param {number} resourceScale - The label's resource scale; anything but a finite number over 0 is taken as 1.
 * @returns {number} The length in logical pixels, not rounded.
 */
export function logicalLayoutLengthPx(layoutLengthPx, resourceScale) {
    const isUsableScale = Number.isFinite(resourceScale) && resourceScale > 0;
    return layoutLengthPx / (isUsableScale ? resourceScale : UNSCALED_RESOURCE_SCALE);
}

/**
 * The card's natural content width, and the least it can be: the plot at full width or with all it gives up, beside
 * the gaps and the now column.
 *
 * @param {number} nowColumnWidthPx - The now column's width (9em, resolved by St).
 * @returns {{naturalWidthPx: number, leastWidthPx: number}} Both, in whole pixels.
 */
export function compactCardContentWidths(nowColumnWidthPx) {
    const besidePlotPx = NOW_GAPS_WIDTH_PX + wholeLengthPx(nowColumnWidthPx);
    return {naturalWidthPx: COMPACT_PLOT_WIDTH_PX + besidePlotPx, leastWidthPx: LEAST_PLOT_WIDTH_PX + besidePlotPx};
}

/**
 * How far a figure's line box starts above its trace: its share of the box, so its digits keep their place against
 * the trace at every size.
 *
 * @param {number} figurePx - The figure's line box.
 * @returns {number} The lift, in whole pixels.
 */
function figureLiftPx(figurePx) {
    return Math.round(figurePx * COMPACT_FIGURE_LIFT_SHARE);
}

/**
 * How far the memory figure and its most lines would reach into the first meter row in the form with a pressure
 * history, where both stand in the now column: what the memory trace grows by there, so that the meter rows start
 * where the last line's box ends. Both lengths are counted from the memory trace's top, so the CPU section above
 * leaves the growth alone.
 *
 * @param {CompactCardLineBoxes} lineBoxes - The text's line boxes, in whole pixels.
 * @returns {number} The growth, in whole pixels: 0 where the lines end above the meters.
 */
function memoryLinesGrowthPx(lineBoxes) {
    const linesEndPx = lineBoxes.figurePx - figureLiftPx(lineBoxes.figurePx) +
        COMPACT_MEMORY_DETAIL_LINE_COUNT * lineBoxes.detailPx;
    const meterRowsStartPx = COMPACT_TRACE_HEIGHT_PX + COMPACT_SECTION_GAP_PX + lineBoxes.sectionLabelPx +
        COMPACT_SECTION_LABEL_GAP_PX;
    return Math.max(0, linesEndPx - meterRowsStartPx);
}

/**
 * The two traces' heights in either form. With a history only the memory trace grows, by the growth. Without one the
 * two traces share the two pressure rows given up and the same growth, half each, so they stay one height, and an
 * odd pixel of the growth goes above "Waiting on". Either way the card is one height in both forms.
 *
 * @param {boolean} hasPressureHistory - The form.
 * @param {number} pressureRowHeightPx - One pressure row's height, in whole pixels.
 * @param {number} growthPx - What memoryLinesGrowthPx gives.
 * @returns {CompactTraceHeights} The heights.
 */
function traceHeights(hasPressureHistory, pressureRowHeightPx, growthPx) {
    if (hasPressureHistory) {
        return {cpuTracePx: COMPACT_TRACE_HEIGHT_PX, memoryTracePx: COMPACT_TRACE_HEIGHT_PX + growthPx,
            aboveWaitingOnPx: 0};
    }
    const givenUpRowsPx = (PRESSURE_RESOURCE_COUNT - 1) * pressureRowHeightPx;
    const halfGrowthPx = Math.floor(growthPx / 2);
    const sharedTracePx = COMPACT_TRACE_HEIGHT_PX + givenUpRowsPx / 2 + halfGrowthPx;
    return {cpuTracePx: sharedTracePx, memoryTracePx: sharedTracePx, aboveWaitingOnPx: growthPx - 2 * halfGrowthPx};
}

/**
 * Each meter's row at its widest: the meter, its name and its widest percentage after the name.
 *
 * @param {number[]} meterNameWidthsPx - The meters' names' widths: "cpu", "mem" and "io".
 * @param {number} widestPercentWidthPx - The widest percentage's width, "100%".
 * @returns {number[]} Each row's width.
 */
function widestMeterRowWidthsPx(meterNameWidthsPx, widestPercentWidthPx) {
    const widestPercentPx = wholeLengthPx(widestPercentWidthPx);
    return Array.from({length: PRESSURE_RESOURCE_COUNT}, (_unused, resourceIndex) => PRESSURE_METER_WIDTH_PX +
        COMPACT_METER_NAME_GAP_PX + meterPercentLeftOffsetPx({widthPx: meterNameWidthsPx[resourceIndex]}) +
        widestPercentPx);
}

/**
 * The meters' lefts for one clearance: the first at the content's left, each other at its third of the content, or
 * further right where the row before it, at its widest, needs the clearance after it.
 *
 * @param {number} contentWidthPx - The content's width.
 * @param {number[]} rowWidthsPx - Each meter's row at its widest.
 * @param {number} clearancePx - The clear space kept after a row.
 * @returns {number[]} Each meter's left.
 */
function meterLeftsWithClearancePx(contentWidthPx, rowWidthsPx, clearancePx) {
    const meterLeftsPx = [0];
    for (let resourceIndex = 1; resourceIndex < PRESSURE_RESOURCE_COUNT; resourceIndex++) {
        const thirdPx = Math.round((resourceIndex / PRESSURE_RESOURCE_COUNT) * contentWidthPx);
        const clearOfPreviousPx = meterLeftsPx[resourceIndex - 1] + rowWidthsPx[resourceIndex - 1] + clearancePx;
        meterLeftsPx.push(Math.max(thirdPx, clearOfPreviousPx));
    }
    return meterLeftsPx;
}

/**
 * Where the three meters stand in their one row, without a pressure history: each at its third of the content, or
 * further right where the meter before it needs, showing its widest percentage, so that
 * COMPACT_METER_ROW_CLEARANCE_PX stays clear after it. The widths are the text's at the present size, never the
 * reading shown, so a meter never moves when a percentage gains a digit. Where the last row at its widest would then
 * end past the card's side padding (only in a cell narrower than the card), the two clearances give way equally, a
 * pixel at a time, down to nothing.
 *
 * @param {number} contentWidthPx - The content's width.
 * @param {number} sidePaddingPx - The card's side padding, beyond the content's right edge.
 * @param {number[]} meterNameWidthsPx - The meters' names' widths: "cpu", "mem" and "io".
 * @param {number} widestPercentWidthPx - The widest percentage's width, "100%".
 * @returns {number[]} Each meter's left.
 */
function meterLeftsInOneRowPx(contentWidthPx, sidePaddingPx, meterNameWidthsPx, widestPercentWidthPx) {
    const rowWidthsPx = widestMeterRowWidthsPx(meterNameWidthsPx, widestPercentWidthPx);
    const lastRowLimitPx = contentWidthPx + wholeLengthPx(sidePaddingPx);
    for (let clearancePx = COMPACT_METER_ROW_CLEARANCE_PX; clearancePx > 0; clearancePx--) {
        const meterLeftsPx = meterLeftsWithClearancePx(contentWidthPx, rowWidthsPx, clearancePx);
        if (meterLeftsPx.at(-1) + rowWidthsPx.at(-1) <= lastRowLimitPx)
            return meterLeftsPx;
    }
    return meterLeftsWithClearancePx(contentWidthPx, rowWidthsPx, 0);
}

/**
 * A trace section: its label line, then its trace, with the figure's box starting above the trace by its share of the
 * box.
 *
 * @param {number} topPx - The section's top.
 * @param {number} traceHeightPx - Its trace's height.
 * @param {number} plotWidthPx - The plot's width.
 * @param {CompactCardLineBoxes} lineBoxes - The text's line boxes.
 * @returns {CompactSection} The section.
 */
function traceSection(topPx, traceHeightPx, plotWidthPx, lineBoxes) {
    const traceTopPx = topPx + lineBoxes.sectionLabelPx + COMPACT_SECTION_LABEL_GAP_PX;
    const figureTopPx = traceTopPx - figureLiftPx(lineBoxes.figurePx);
    return {
        labelTopPx: topPx,
        trace: {x: 0, y: traceTopPx, width: plotWidthPx, height: traceHeightPx},
        figureTopPx,
        detailsTopPx: figureTopPx + lineBoxes.figurePx,
    };
}

/**
 * One pressure row's meter, centred on its name's line box.
 *
 * @param {number} leftPx - The meter's left.
 * @param {number} rowTopPx - The row's top, where the name's line box starts.
 * @param {number} meterNamePx - The name's line box.
 * @returns {{meter: Rect, nameLeftPx: number, nameTopPx: number}} The meter and its name's place.
 */
function meterWithName(leftPx, rowTopPx, meterNamePx) {
    const meterTopPx = rowTopPx + Math.round((meterNamePx - PRESSURE_METER_HEIGHT_PX) / 2);
    return {
        meter: {x: leftPx, y: meterTopPx, width: PRESSURE_METER_WIDTH_PX, height: PRESSURE_METER_HEIGHT_PX},
        nameLeftPx: leftPx + PRESSURE_METER_WIDTH_PX + COMPACT_METER_NAME_GAP_PX,
        nameTopPx: rowTopPx,
    };
}

/**
 * Every part's place on the compact card.
 *
 * @param {object} measures - What St measured.
 * @param {CompactCardLineBoxes} measures.lineBoxes - The text's line boxes.
 * @param {number} measures.nowColumnWidthPx - The now column's width.
 * @param {boolean} measures.hasPressureHistory - Whether the sampler publishes a pressure history: the strips' form.
 * @param {number[]} [measures.meterNameWidthsPx] - The meters' names' widths, "cpu", "mem" and "io", which place the
 *     meters in their one row, without a history; their heights and the card's size never depend on them, so a measure
 *     of the size alone, or of the form with a history, may leave them out.
 * @param {number} [measures.widestMeterPercentWidthPx] - The widest percentage's width, "100%", at the present size.
 * @param {number} [measures.sidePaddingPx] - The card's side padding, which the last meter's row may reach into.
 * @param {number|null} [contentBoxWidthPx] - The content box's width where a cell sizes the card; null (or omitted)
 *     for the card's natural width. A box narrower than the natural width takes the difference from the plot, down to
 *     the least plot; a wider one leaves every part where it is, at the top left.
 * @returns {CompactCardGeometry} The places.
 */
export function compactCardGeometry({lineBoxes: measuredLineBoxes, nowColumnWidthPx, hasPressureHistory,
    meterNameWidthsPx = [], widestMeterPercentWidthPx = 0, sidePaddingPx = 0}, contentBoxWidthPx = null) {
    const wholeLineBoxEntries = Object.entries(measuredLineBoxes).map(([part, px]) => [part, wholeLengthPx(px)]);
    const lineBoxes = Object.fromEntries(wholeLineBoxEntries);
    const nowColumnPx = wholeLengthPx(nowColumnWidthPx);
    const {naturalWidthPx} = compactCardContentWidths(nowColumnPx);
    const boxWidthPx = contentBoxWidthPx === null ? naturalWidthPx : wholeLengthPx(contentBoxWidthPx);
    const plotWidthPx = Math.max(LEAST_PLOT_WIDTH_PX, Math.min(COMPACT_PLOT_WIDTH_PX, boxWidthPx - NOW_GAPS_WIDTH_PX -
        nowColumnPx));
    const nowRuleLeftPx = plotWidthPx + COMPACT_NOW_RULE_GAP_PX;
    const nowColumnLeftPx = nowRuleLeftPx + COMPACT_NOW_COLUMN_GAP_PX;
    // The plot alone takes up a narrower box, so the content is that box's width, its natural one, or its least.
    const contentWidthPx = nowColumnLeftPx + nowColumnPx;

    const pressureRowHeightPx = lineBoxes.meterNamePx + COMPACT_PRESSURE_ROW_GAP_PX;
    const pressureRowCount = hasPressureHistory ? PRESSURE_RESOURCE_COUNT : 1;
    const {cpuTracePx, memoryTracePx, aboveWaitingOnPx} =
        traceHeights(hasPressureHistory, pressureRowHeightPx, memoryLinesGrowthPx(lineBoxes));
    const cpu = traceSection(0, cpuTracePx, plotWidthPx, lineBoxes);
    const memoryTopPx = cpu.trace.y + cpu.trace.height + COMPACT_SECTION_GAP_PX;
    const memory = traceSection(memoryTopPx, memoryTracePx, plotWidthPx, lineBoxes);
    const memoryBottomPx = memory.trace.y + memory.trace.height;

    // With a history the axis runs under the strips; without one it closes the traces and the meters stand under it.
    const waitingOnTopPx = hasPressureHistory ? memoryBottomPx + COMPACT_SECTION_GAP_PX
        : memoryBottomPx + COMPACT_AXIS_GAP_PX + lineBoxes.axisLabelPx + COMPACT_SECTION_GAP_PX + aboveWaitingOnPx;
    const pressureRowsTopPx = waitingOnTopPx + lineBoxes.sectionLabelPx + COMPACT_SECTION_LABEL_GAP_PX;
    const pressureRowsBottomPx = pressureRowsTopPx + pressureRowCount * pressureRowHeightPx;
    const axisTopPx = (hasPressureHistory ? pressureRowsBottomPx : memoryBottomPx) + COMPACT_AXIS_GAP_PX;
    const contentHeightPx = hasPressureHistory ? axisTopPx + lineBoxes.axisLabelPx : pressureRowsBottomPx;

    // The meters' one row is the form without a history's alone: with one, the meters stand in the now column.
    const oneRowMeterLeftsPx = hasPressureHistory ? []
        : meterLeftsInOneRowPx(contentWidthPx, sidePaddingPx, meterNameWidthsPx, widestMeterPercentWidthPx);
    const pressureRows = Array.from({length: PRESSURE_RESOURCE_COUNT}, (_unused, resourceIndex) => {
        if (!hasPressureHistory) {
            const meterLeftPx = oneRowMeterLeftsPx[resourceIndex];
            return {...meterWithName(meterLeftPx, pressureRowsTopPx, lineBoxes.meterNamePx), strip: null};
        }
        const rowTopPx = pressureRowsTopPx + resourceIndex * pressureRowHeightPx;
        const placed = meterWithName(nowColumnLeftPx, rowTopPx, lineBoxes.meterNamePx);
        const strip = {x: 0, y: placed.meter.y, width: plotWidthPx, height: COMPACT_PRESSURE_STRIP_HEIGHT_PX};
        return {...placed, strip};
    });

    return {
        contentWidthPx, contentHeightPx, plotWidthPx, nowColumnLeftPx, nowColumnWidthPx: nowColumnPx,
        detailLinePx: lineBoxes.detailPx, cpu, memory,
        nowRule: {x: nowRuleLeftPx, y: 0, width: COMPACT_NOW_RULE_WIDTH_PX, height: axisTopPx - COMPACT_AXIS_GAP_PX},
        axisTopPx,
        nowLabelCentrePx: nowRuleLeftPx + COMPACT_NOW_RULE_WIDTH_PX / 2,
        waitingOnTopPx,
        pressureRows,
    };
}

/**
 * @typedef {object} TextPart
 * @property {number} widthPx - Its natural width.
 * @property {number} baselinePx - Its first line's baseline, from its top.
 */

/**
 * Where a section's heaviest app stands on the section's label line: its name after the section's name, its value
 * after that, both on the section name's baseline. The name alone gives up width, ellipsized at its end, so the line
 * ends inside the plot and a number is never cut.
 *
 * @param {object} parts - The line's three parts.
 * @param {TextPart} parts.sectionName - "CPU" or "Memory".
 * @param {TextPart} parts.heaviestName - The heaviest app's name; width 0 with none.
 * @param {TextPart} parts.heaviestValue - Its value ("14%", "11.9G"); width 0 with none (an idle CPU).
 * @param {number} plotWidthPx - The plot's width, which the line keeps to.
 * @returns {{heaviestNameLeftPx: number, heaviestNameWidthPx: number, heaviestValueLeftPx: number,
 *     heaviestTopOffsetPx: number}} The two parts' lefts, the name's allotted width, and how far below the section
 *     name's top both start.
 */
export function sectionLabelLine({sectionName, heaviestName, heaviestValue}, plotWidthPx) {
    const sectionNameWidthPx = wholeLengthPx(sectionName.widthPx);
    const valueWidthPx = wholeLengthPx(heaviestValue.widthPx);
    const valueGapPx = valueWidthPx === 0 ? 0 : COMPACT_HEAVIEST_VALUE_GAP_PX;
    const heaviestNameLeftPx = sectionNameWidthPx + COMPACT_HEAVIEST_NAME_GAP_PX;
    const roomForNamePx = wholeLengthPx(plotWidthPx) - heaviestNameLeftPx - valueGapPx - valueWidthPx;
    const heaviestNameWidthPx = Math.max(0, Math.min(wholeLengthPx(heaviestName.widthPx), roomForNamePx));
    return {
        heaviestNameLeftPx,
        heaviestNameWidthPx,
        heaviestValueLeftPx: heaviestNameLeftPx + heaviestNameWidthPx + valueGapPx,
        heaviestTopOffsetPx: Math.round((sectionName.baselinePx ?? 0) - (heaviestName.baselinePx ?? 0)),
    };
}

/**
 * Where a figure's unit stands: after the figure, on its baseline.
 *
 * @param {TextPart} figure - The figure ("37").
 * @param {TextPart} unit - Its unit ("%").
 * @returns {{unitLeftOffsetPx: number, unitTopOffsetPx: number}} The unit's offsets from the figure's top left.
 */
export function figureUnitPlacement(figure, unit) {
    return {
        unitLeftOffsetPx: wholeLengthPx(figure.widthPx) + COMPACT_UNIT_GAP_PX,
        unitTopOffsetPx: Math.round((figure.baselinePx ?? 0) - (unit.baselinePx ?? 0)),
    };
}

/**
 * Where a meter's percentage stands: after its name, on the same line.
 *
 * @param {TextPart} meterName - The name ("cpu").
 * @returns {number} The percentage's left offset from the name's left.
 */
export function meterPercentLeftOffsetPx(meterName) {
    return wholeLengthPx(meterName.widthPx) + COMPACT_METER_PERCENT_GAP_PX;
}
