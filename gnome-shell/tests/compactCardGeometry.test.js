// lib/compactCardGeometry.js: the compact card's parts placed from St's line boxes and its fixed lengths, one height
// in both forms, the traces grown where the memory figure's lines would reach the meters, the meters' one row placed
// for their widest text, a plot that gives up at most 22 px in a narrow cell, and no NaN from a broken reading.
import {test, assertEqual} from './harness.js';
import {
    compactCardContentWidths, compactCardGeometry, figureUnitPlacement, logicalLayoutLengthPx, sectionLabelLine,
    meterPercentLeftOffsetPx,
    wholeLengthPx,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/compactCardGeometry.js';
import {
    COMPACT_AXIS_GAP_PX, COMPACT_METER_ROW_CLEARANCE_PX, COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX, COMPACT_PLOT_WIDTH_PX,
    COMPACT_PRESSURE_ROW_GAP_PX, COMPACT_SECTION_GAP_PX, COMPACT_TRACE_HEIGHT_PX,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';

/**
 * St's line boxes for the card's text, the now column's 9em, the widths of the meters' names ("cpu", "mem", "io")
 * and of "100%", and the side padding (1.568em), at text scaling 1, 1.25 and 1.5, in Ubuntu Sans at the shell's
 * default 11 pt: as a nested shell measured them.
 */
const ST_MEASURES_BY_TEXT_SCALING = {
    1: {
        lineBoxes: {sectionLabelPx: 18, meterNamePx: 17, axisLabelPx: 16, figurePx: 37, detailPx: 16},
        nowColumnWidthPx: 132, meterNameWidthsPx: [21, 29, 11], widestMeterPercentWidthPx: 32,
        sidePaddingPx: 23,
    },
    1.25: {
        lineBoxes: {sectionLabelPx: 23, meterNamePx: 21, axisLabelPx: 19, figurePx: 46, detailPx: 19},
        nowColumnWidthPx: 165, meterNameWidthsPx: [27, 37, 14], widestMeterPercentWidthPx: 41,
        sidePaddingPx: 29,
    },
    1.5: {
        lineBoxes: {sectionLabelPx: 27, meterNamePx: 25, axisLabelPx: 22, figurePx: 55, detailPx: 22},
        nowColumnWidthPx: 198, meterNameWidthsPx: [31, 45, 16], widestMeterPercentWidthPx: 49,
        sidePaddingPx: 34,
    },
};
const TEXT_SCALINGS = Object.keys(ST_MEASURES_BY_TEXT_SCALING);
const DEFAULT_MEASURES = ST_MEASURES_BY_TEXT_SCALING[1];
/**
 * The card's frame at the default text size, across and down: 23 px of side padding (1.568em) and the 1 px border each
 * side; 18 + 16 px of padding, fixed, and the two borders.
 */
const CARD_FRAME_WIDTH_PX = 48;
const CARD_FRAME_HEIGHT_PX = 36;
/** The most lines under the memory figure: "of N", the zram line and the disk line. */
const MEMORY_DETAIL_LINE_LIMIT = 3;
/** The meters' names, and a percentage, as wide as nothing: a row that leaves every meter at its third. */
const NARROWEST_METER_TEXT = {meterNameWidthsPx: [0, 0, 0], widestMeterPercentWidthPx: 0};
/** The card in a 1280 x 720 panel's cell and at the template's least work area: 396 and 394 px wide. */
const PANEL_CELL_CONTENT_PX = 348;
const LEAST_CELL_CONTENT_PX = 346;
/** A percentage too wide for any clearance to keep the last row inside the padding. */
const OVERWIDE_PERCENT_PX = 80;
/** Line boxes whose memory lines end well above the meters: a figure and lines of a small font. */
const SMALL_LINE_BOXES = {sectionLabelPx: 18, meterNamePx: 17, axisLabelPx: 16, figurePx: 20, detailPx: 10};
/** A content box narrower than the card by a little, and by more than the plot gives up. */
const SLIGHTLY_NARROWER_PX = 10;
const MUCH_NARROWER_PX = 60;
const MUCH_WIDER_PX = 200;

/**
 * The geometry of one form at one text scaling.
 *
 * @param {string} textScaling - '1', '1.25' or '1.5'.
 * @param {boolean} hasPressureHistory - The form.
 * @param {number|null} [contentBoxWidthPx] - A cell's content box, or null for the natural width.
 * @returns {object} The geometry.
 */
function geometryAt(textScaling, hasPressureHistory, contentBoxWidthPx = null) {
    return compactCardGeometry({...ST_MEASURES_BY_TEXT_SCALING[textScaling], hasPressureHistory}, contentBoxWidthPx);
}

test('compact card geometry: 416 x 286 at St\'s default line boxes, its frame included, in both forms', () =>
    assertEqual([false, true].map(hasPressureHistory => {
        const {contentWidthPx, contentHeightPx} = geometryAt('1', hasPressureHistory);
        return [contentWidthPx + CARD_FRAME_WIDTH_PX, contentHeightPx + CARD_FRAME_HEIGHT_PX];
    }), [[416, 286], [416, 286]]));

test('compact card geometry: 327 px high at text scaling 1.25 and 366 at 1.5, its content 401 and 434 wide (the side ' +
    'padding is in em, so it grows too), one size in both forms', () =>
    assertEqual(['1.25', '1.5'].map(textScaling => [false, true].map(hasPressureHistory => {
        const {contentWidthPx, contentHeightPx} = geometryAt(textScaling, hasPressureHistory);
        return [contentWidthPx, contentHeightPx + CARD_FRAME_HEIGHT_PX];
    })), [[[401, 327], [401, 327]], [[434, 366], [434, 366]]]));

test('compact card geometry: with a history, where the memory figure\'s three lines would reach the meters the ' +
    'memory trace grows by the difference, 1, 12 and 24 px at text scaling 1, 1.25 and 1.5, so that the first meter ' +
    'row starts where the last line\'s box ends; the CPU trace keeps its height', () =>
    assertEqual(TEXT_SCALINGS.map(textScaling => {
        const {cpu, memory, pressureRows, detailLinePx} = geometryAt(textScaling, true);
        const linesEndPx = memory.detailsTopPx + MEMORY_DETAIL_LINE_LIMIT * detailLinePx;
        return {
            growthPx: memory.trace.height - COMPACT_TRACE_HEIGHT_PX,
            cpuTracePx: cpu.trace.height,
            firstRowStartsWhereTheLinesEnd: pressureRows[0].nameTopPx === linesEndPx,
        };
    }), [1, 12, 24].map(growthPx =>
        ({growthPx, cpuTracePx: COMPACT_TRACE_HEIGHT_PX, firstRowStartsWhereTheLinesEnd: true}))));

test('compact card geometry: without a history the two traces share the same growth, half each, so they stay one ' +
    'height; the odd pixel at the default text size goes above "Waiting on"', () =>
    assertEqual(TEXT_SCALINGS.map(textScaling => {
        const {cpu, memory, axisTopPx, waitingOnTopPx} = geometryAt(textScaling, false);
        const {lineBoxes} = ST_MEASURES_BY_TEXT_SCALING[textScaling];
        const givenUpRowPx = lineBoxes.meterNamePx + COMPACT_PRESSURE_ROW_GAP_PX;
        return {
            traceGrowthsPx: [cpu, memory].map(({trace}) => trace.height - COMPACT_TRACE_HEIGHT_PX - givenUpRowPx),
            aboveWaitingOnPx: waitingOnTopPx - (axisTopPx + lineBoxes.axisLabelPx) - COMPACT_SECTION_GAP_PX,
        };
    }), [{traceGrowthsPx: [0, 0], aboveWaitingOnPx: 1}, {traceGrowthsPx: [6, 6], aboveWaitingOnPx: 0},
        {traceGrowthsPx: [12, 12], aboveWaitingOnPx: 0}]));

test('compact card geometry: where the memory figure\'s lines end above the meters nothing grows, never less than ' +
    'nothing, in either form', () =>
    assertEqual([false, true].map(hasPressureHistory => {
        const geometry = compactCardGeometry({...DEFAULT_MEASURES, lineBoxes: SMALL_LINE_BOXES, hasPressureHistory});
        const givenUpRowPx = hasPressureHistory ? 0 : SMALL_LINE_BOXES.meterNamePx + COMPACT_PRESSURE_ROW_GAP_PX;
        return [geometry.cpu.trace.height, geometry.memory.trace.height].map(heightPx => heightPx - givenUpRowPx);
    }), [[COMPACT_TRACE_HEIGHT_PX, COMPACT_TRACE_HEIGHT_PX], [COMPACT_TRACE_HEIGHT_PX, COMPACT_TRACE_HEIGHT_PX]]));

test('compact card geometry: a content box narrower than the card takes the difference from the plot, never more ' +
    'than 22 px, and a wider one leaves every part where it is', () => {
    const {naturalWidthPx, leastWidthPx} = compactCardContentWidths(DEFAULT_MEASURES.nowColumnWidthPx);
    const natural = geometryAt('1', false);
    const wider = geometryAt('1', false, naturalWidthPx + MUCH_WIDER_PX);
    assertEqual({
        leastWidthGap: naturalWidthPx - leastWidthPx,
        slightlyNarrowerPlot: geometryAt('1', false, naturalWidthPx - SLIGHTLY_NARROWER_PX).plotWidthPx,
        muchNarrower: (({plotWidthPx, contentWidthPx}) => ({plotWidthPx, contentWidthPx}))(
            geometryAt('1', false, naturalWidthPx - MUCH_NARROWER_PX)),
        widerIsNatural: JSON.stringify(wider) === JSON.stringify(natural),
    }, {
        leastWidthGap: COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX,
        slightlyNarrowerPlot: COMPACT_PLOT_WIDTH_PX - SLIGHTLY_NARROWER_PX,
        muchNarrower: {plotWidthPx: COMPACT_PLOT_WIDTH_PX - COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX,
            contentWidthPx: leastWidthPx},
        widerIsNatural: true,
    });
});

test('compact card geometry: a narrower plot leaves every height and every row where it was', () => {
    const {naturalWidthPx} = compactCardContentWidths(DEFAULT_MEASURES.nowColumnWidthPx);
    const tops = geometry => [geometry.contentHeightPx, geometry.cpu.trace.y, geometry.memory.trace.y,
        geometry.axisTopPx, geometry.waitingOnTopPx, geometry.pressureRows.map(row => row.nameTopPx)];
    assertEqual(tops(geometryAt('1', false, naturalWidthPx - SLIGHTLY_NARROWER_PX)), tops(geometryAt('1', false)));
});

test('compact card geometry: without a history the axis closes the traces and the three meters stand in one row ' +
    'under "Waiting on"', () => {
    const geometry = geometryAt('1', false);
    const memoryTraceBottomPx = geometry.memory.trace.y + geometry.memory.trace.height;
    assertEqual({
        axisTopPx: geometry.axisTopPx,
        nameTops: geometry.pressureRows.map(row => row.nameTopPx),
        strips: geometry.pressureRows.map(row => row.strip),
        rowsUnderWaitingOn: geometry.pressureRows[0].nameTopPx > geometry.waitingOnTopPx,
        traceHeights: [geometry.cpu.trace.height, geometry.memory.trace.height],
    }, {
        axisTopPx: memoryTraceBottomPx + COMPACT_AXIS_GAP_PX,
        nameTops: [231, 231, 231],
        strips: [null, null, null],
        rowsUnderWaitingOn: true,
        traceHeights: [65, 65],
    });
});

test('compact card geometry: in their one row each meter stands at its third, or 10 px clear of "100%" in the meter ' +
    'before it where that is further right: at text scaling 1, 1.25 and 1.5 "cpu 100%" and "mem 100%" push the ' +
    'second and the third meter right of their thirds', () => {
    const rowsAt = textScaling => {
        const geometry = geometryAt(textScaling, false);
        const {meterNameWidthsPx, widestMeterPercentWidthPx} = ST_MEASURES_BY_TEXT_SCALING[textScaling];
        const widestRowEndsPx = geometry.pressureRows.map(({nameLeftPx}, meterIndex) => nameLeftPx +
            meterPercentLeftOffsetPx({widthPx: meterNameWidthsPx[meterIndex]}) + widestMeterPercentWidthPx);
        return {
            meterLefts: geometry.pressureRows.map(({meter}) => meter.x),
            clearAfterWidestRows: geometry.pressureRows.slice(1).map(({meter}, gapIndex) =>
                meter.x - widestRowEndsPx[gapIndex]),
        };
    };
    const clearAfterBothRows = [COMPACT_METER_ROW_CLEARANCE_PX, COMPACT_METER_ROW_CLEARANCE_PX];
    assertEqual(TEXT_SCALINGS.map(rowsAt), [
        {meterLefts: [0, 130, 268], clearAfterWidestRows: clearAfterBothRows},
        {meterLefts: [0, 145, 300], clearAfterWidestRows: clearAfterBothRows},
        {meterLefts: [0, 157, 328], clearAfterWidestRows: clearAfterBothRows},
    ]);
});

test('compact card geometry: where the row before leaves room each meter keeps its third of the content, and a ' +
    'narrower content box moves only what stands at its third', () => {
    const {naturalWidthPx} = compactCardContentWidths(DEFAULT_MEASURES.nowColumnWidthPx);
    const meterLeftsOf = geometry => geometry.pressureRows.map(({meter}) => meter.x);
    const narrowTextAt = contentBoxWidthPx => meterLeftsOf(compactCardGeometry(
        {...DEFAULT_MEASURES, ...NARROWEST_METER_TEXT, hasPressureHistory: false}, contentBoxWidthPx));
    assertEqual({
        thirds: narrowTextAt(null),
        thirdsOfANarrowerBox: narrowTextAt(naturalWidthPx - SLIGHTLY_NARROWER_PX),
        widestTextInANarrowerBox: meterLeftsOf(geometryAt('1', false, naturalWidthPx - SLIGHTLY_NARROWER_PX)),
    }, {thirds: [0, 123, 245], thirdsOfANarrowerBox: [0, 119, 239], widestTextInANarrowerBox: [0, 130, 268]});
});

test('compact card geometry: in a cell narrower than the card, where the io meter\'s row at "100%" would end past ' +
    'the side padding, the two clearances give way equally, to 6 px in a 396 px card and 5 px in a 394 px one, and ' +
    'the row ends inside the padding; at the card\'s own width they stay 10 px', () => {
    const {meterNameWidthsPx, widestMeterPercentWidthPx, sidePaddingPx} = DEFAULT_MEASURES;
    const rowsIn = contentBoxWidthPx => {
        const geometry = geometryAt('1', false, contentBoxWidthPx);
        const widestRowEndsPx = geometry.pressureRows.map(({nameLeftPx}, meterIndex) => nameLeftPx +
            meterPercentLeftOffsetPx({widthPx: meterNameWidthsPx[meterIndex]}) + widestMeterPercentWidthPx);
        return {
            clearances: geometry.pressureRows.slice(1).map(({meter}, gapIndex) => meter.x - widestRowEndsPx[gapIndex]),
            lastRowInsideThePadding: widestRowEndsPx.at(-1) <= geometry.contentWidthPx + sidePaddingPx,
        };
    };
    assertEqual([null, PANEL_CELL_CONTENT_PX, LEAST_CELL_CONTENT_PX].map(rowsIn), [
        {clearances: [COMPACT_METER_ROW_CLEARANCE_PX, COMPACT_METER_ROW_CLEARANCE_PX], lastRowInsideThePadding: true},
        {clearances: [6, 6], lastRowInsideThePadding: true},
        {clearances: [5, 5], lastRowInsideThePadding: true},
    ]);
});

test('compact card geometry: the clearances give way down to nothing and never less: with a percentage too wide for ' +
    'any, each row ends where the next meter starts', () => {
    const geometry = compactCardGeometry({
        ...DEFAULT_MEASURES, widestMeterPercentWidthPx: OVERWIDE_PERCENT_PX, hasPressureHistory: false,
    }, LEAST_CELL_CONTENT_PX);
    const widestRowEndsPx = geometry.pressureRows.map(({nameLeftPx}, meterIndex) => nameLeftPx +
        meterPercentLeftOffsetPx({widthPx: DEFAULT_MEASURES.meterNameWidthsPx[meterIndex]}) + OVERWIDE_PERCENT_PX);
    assertEqual(geometry.pressureRows.slice(1).map(({meter}, gapIndex) => meter.x - widestRowEndsPx[gapIndex]), [0, 0]);
});

test('compact card geometry: a length read from a label\'s text layout is taken over its resource scale, so "100%" ' +
    'measured at 200 % or 125 % is the 32 px it is unscaled, and a scale that cannot be used counts as 1', () =>
    assertEqual([[64, 2], [40, 1.25], [32, 1], [32, 0], [32, -2], [32, Number.NaN], [32, undefined]]
        .map(([layoutLengthPx, resourceScale]) => logicalLayoutLengthPx(layoutLengthPx, resourceScale)),
    [32, 32, 32, 32, 32, 32, 32]));

test('compact card geometry: with a history each resource is a row, its strip on the plot beside its meter in the ' +
    'now column, and the axis under the strips', () => {
    const geometry = geometryAt('1', true);
    assertEqual({
        rows: geometry.pressureRows.map(({meter, nameTopPx, strip}) =>
            ({meterLeft: meter.x, meterTop: meter.y, nameTopPx, strip})),
        axisTopPx: geometry.axisTopPx,
        traceHeights: [geometry.cpu.trace.height, geometry.memory.trace.height],
    }, {
        rows: [
            {meterLeft: 236, meterTop: 177, nameTopPx: 173, strip: {x: 0, y: 177, width: 208, height: 11}},
            {meterLeft: 236, meterTop: 196, nameTopPx: 192, strip: {x: 0, y: 196, width: 208, height: 11}},
            {meterLeft: 236, meterTop: 215, nameTopPx: 211, strip: {x: 0, y: 215, width: 208, height: 11}},
        ],
        axisTopPx: 234,
        traceHeights: [46, 47],
    });
});

test('compact card geometry: the now rule runs from the CPU section\'s top to 4 px above the axis, with "now" ' +
    'centred under it and the figures 16 px to its right', () => {
    const geometry = geometryAt('1', false);
    assertEqual({
        nowRule: geometry.nowRule,
        nowLabelCentrePx: geometry.nowLabelCentrePx,
        nowColumnLeftPx: geometry.nowColumnLeftPx,
        ruleEndsAboveAxis: geometry.axisTopPx - (geometry.nowRule.y + geometry.nowRule.height),
    }, {
        nowRule: {x: 220, y: 0, width: 1, height: 180},
        nowLabelCentrePx: 220.5,
        nowColumnLeftPx: 236,
        ruleEndsAboveAxis: COMPACT_AXIS_GAP_PX,
    });
});

test('compact card geometry: a figure\'s box starts above its trace by the same share of the box at every size: 8, ' +
    '10 and 12 px', () =>
    assertEqual(TEXT_SCALINGS.map(textScaling => {
        const {cpu, memory} = geometryAt(textScaling, false);
        return [cpu.trace.y - cpu.figureTopPx, memory.trace.y - memory.figureTopPx];
    }), [[8, 8], [10, 10], [12, 12]]));

test('compact card geometry: without a history the memory figure\'s three lines end above the meters at text scaling ' +
    '1, 1.25 and 1.5', () => {
    assertEqual(TEXT_SCALINGS.map(textScaling => {
        const {memory, pressureRows, detailLinePx} = geometryAt(textScaling, false);
        const linesEndPx = memory.detailsTopPx + MEMORY_DETAIL_LINE_LIMIT * detailLinePx;
        return linesEndPx <= pressureRows[0].nameTopPx;
    }), [true, true, true]);
});

test('compact card geometry: on a section\'s label line the app\'s name gets what the plot leaves and its value ' +
    'keeps its width; an idle CPU has no value gap; a name with no room is 0 wide, never less', () => {
    const sectionName = {widthPx: 30, baselinePx: 14};
    const heaviestValue = {widthPx: 26, baselinePx: 13};
    const lineFor = heaviestNameWidthPx => sectionLabelLine(
        {sectionName, heaviestName: {widthPx: heaviestNameWidthPx, baselinePx: 13}, heaviestValue},
        COMPACT_PLOT_WIDTH_PX);
    assertEqual({
        shortName: lineFor(60),
        longName: lineFor(400),
        idle: sectionLabelLine({sectionName, heaviestName: {widthPx: 24, baselinePx: 13}, heaviestValue: {widthPx: 0}},
            COMPACT_PLOT_WIDTH_PX),
        noRoom: sectionLabelLine({sectionName: {widthPx: 300, baselinePx: 14},
            heaviestName: {widthPx: 60, baselinePx: 13}, heaviestValue}, COMPACT_PLOT_WIDTH_PX).heaviestNameWidthPx,
    }, {
        shortName: {heaviestNameLeftPx: 40, heaviestNameWidthPx: 60, heaviestValueLeftPx: 103, heaviestTopOffsetPx: 1},
        longName: {heaviestNameLeftPx: 40, heaviestNameWidthPx: 139, heaviestValueLeftPx: 182, heaviestTopOffsetPx: 1},
        idle: {heaviestNameLeftPx: 40, heaviestNameWidthPx: 24, heaviestValueLeftPx: 64, heaviestTopOffsetPx: 1},
        noRoom: 0,
    });
});

test('compact card geometry: a unit stands 4 px after its figure on the figure\'s baseline, and a meter\'s ' +
    'percentage 7 px after its name', () =>
    assertEqual({
        unit: figureUnitPlacement({widthPx: 33, baselinePx: 29}, {widthPx: 12, baselinePx: 13}),
        percentLeft: meterPercentLeftOffsetPx({widthPx: 22}),
    }, {unit: {unitLeftOffsetPx: 37, unitTopOffsetPx: 16}, percentLeft: 29}));

test('compact card geometry: line boxes and widths of 0, negative, NaN or missing give whole sizes of 0 or more, ' +
    'never NaN', () => {
    const brokenReadings = [0, -3, Number.NaN, undefined, null, '18'];
    const geometries = brokenReadings.map(reading => compactCardGeometry({
        lineBoxes: {sectionLabelPx: reading, meterNamePx: reading, axisLabelPx: reading, figurePx: reading,
            detailPx: reading},
        nowColumnWidthPx: reading, hasPressureHistory: false,
        meterNameWidthsPx: [reading, reading, reading], widestMeterPercentWidthPx: reading, sidePaddingPx: reading,
    }, reading));
    const numbers = JSON.stringify(geometries).match(/-?\d+(\.\d+)?|NaN|null/g) ?? [];
    assertEqual({
        lengths: brokenReadings.map(wholeLengthPx),
        noNaN: !JSON.stringify(geometries, (_key, value) => (Number.isNaN(value) ? 'NaN' : value)).includes('NaN'),
        noNegative: numbers.every(number => number === 'null' || Number(number) >= 0),
    }, {lengths: [0, 0, 0, 0, 0, 0], noNaN: true, noNegative: true});
});
