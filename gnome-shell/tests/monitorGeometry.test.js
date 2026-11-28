// lib/monitorGeometry.js: the monitor tile's forms by tracks, every part's place from the tile's size, its form, what its
// tracks hold and St's line boxes at text scaling 1, 1.25 and 1.5 (each the line box St gives Ubuntu Sans 11 pt there).
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as monitorGeometry from '../extensions/resource-pulse@zvibaratz.github.io/lib/monitorGeometry.js';
import {LineKind, measuredSheet} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';

/**
 * @param {number} rowPx - The row line.
 * @param {number} detailPx - The detail line.
 * @param {number} labelPx - The axis label's line.
 * @param {number} scalePx - The scale label's line.
 * @param {number} figurePx - The wide and medium forms' figure.
 * @param {number} smallFigurePx - The small form's figure.
 * @returns {object} The line boxes, keyed by LineKind value.
 */
function lineBoxesOf(rowPx, detailPx, labelPx, scalePx, figurePx, smallFigurePx) {
    return {
        [LineKind.ROW]: rowPx, [LineKind.DETAIL]: detailPx, [LineKind.LABEL]: labelPx, [LineKind.SCALE]: scalePx,
        [LineKind.FIGURE]: figurePx, [LineKind.FIGURE_SMALL]: smallFigurePx,
    };
}

/** St's line boxes at each text scaling, as measured in the nested shell. */
const LINE_BOXES_BY_SCALING = Object.freeze({
    1: lineBoxesOf(18, 17, 16, 14, 63, 54),
    1.25: lineBoxesOf(23, 21, 19, 17, 79, 67),
    1.5: lineBoxesOf(27, 25, 22, 21, 95, 81),
});
const TEXT_SCALINGS = [1, 1.25, 1.5];
const FORMS = ['wide', 'medium', 'small'];
/** The now column the layout's default sheet gives: 184 px. */
const SHEET_NOW_COLUMN_WIDTH_PX = 184;
/** The default sheet's monitor heights, which the measured ones replace. */
const DEFAULT_SHEET = {monitor: {heightPxByForm: {wide: 384, medium: 352, small: 328}}};

/**
 * @param {object} options - What differs from the wide form at 760 × 388, text scaling 1, with a history and the
 *     agents track, and the sheet's now column.
 * @returns {object} The geometry.
 */
function geometryOf(options = {}) {
    return monitorGeometry.monitorGeometry({
        widthPx: 760, heightPx: 388, form: 'wide', hasPressureHistory: true, hasAgentsTrack: true,
        lineBoxesPx: LINE_BOXES_BY_SCALING[1], nowColumnWidthPx: SHEET_NOW_COLUMN_WIDTH_PX, ...options,
    });
}

/**
 * @param {object} box - A box.
 * @returns {number[]} Its x, y, width and height.
 */
const boxOf = ({x, y, width, height}) => [x, y, width, height];

/**
 * Every number in a value, however deep.
 *
 * @param {*} value - A value.
 * @returns {number[]} Its numbers.
 */
function numbersIn(value) {
    if (typeof value === 'number')
        return [value];
    if (value === null || typeof value !== 'object')
        return [];
    return Object.values(value).flatMap(numbersIn);
}

test('monitorGeometry: each form\'s height with no figure to fit is the sheet\'s measured height, at text scaling 1, ' +
    '1.25 and 1.5, so the tile and the composition count one sum', () =>
    assertEqual(TEXT_SCALINGS.map(scaling => FORMS.map(form =>
        monitorGeometry.monitorSheetHeightPx({form, lineBoxesPx: LINE_BOXES_BY_SCALING[scaling]}))),
    TEXT_SCALINGS.map(scaling => FORMS.map(form =>
        measuredSheet(DEFAULT_SHEET, LINE_BOXES_BY_SCALING[scaling]).sheet.monitor.heightPxByForm[form]))));

test('monitorGeometry: each form\'s height need adds what the memory figure and its two lines, and the CPU figure ' +
    'and its one, need past their tracks: the small form 2 px at 1; every form more at 1.25 and 1.5', () =>
    assertEqual(TEXT_SCALINGS.map(scaling => FORMS.map(form => {
        const lineBoxesPx = LINE_BOXES_BY_SCALING[scaling];
        const sheetPx = monitorGeometry.monitorSheetHeightPx({form, lineBoxesPx});
        const needPx = monitorGeometry.monitorHeightNeedPx({form, lineBoxesPx});
        return [sheetPx, needPx - sheetPx];
    })), [
        [[388, 0], [355, 0], [331, 2]],
        [[422, 17], [385, 20], [361, 20]],
        [[453, 51], [412, 57], [388, 55]],
    ]));

test('monitorGeometry: the wide form at 760 × 388, with a history and the agents track: every ' +
    'part\'s place on St\'s lines', () => {
    const geometry = geometryOf();
    assertEqual({
        plot: [geometry.plotLeftPx, geometry.plotWidthPx, geometry.nowRuleLeftPx, geometry.nowColumnLeftPx],
        tracks: geometry.tracks.map(track => [track.labelTopPx, track.scaleTopPx, track.scaleRightPx, boxOf(track.traceBox),
            track.figureTopPx, track.detailTopsPx]),
        waitingOnLabelTopPx: geometry.waitingOnLabelTopPx,
        meterRows: geometry.meterRows.map(row => [boxOf(row.stripBox), boxOf(row.meterBox), row.nameLeftPx,
            row.nameTopPx]),
        agents: [boxOf(geometry.agentsTrack.stripBox), geometry.agentsTrack.presentLeftPx,
            geometry.agentsTrack.presentTopPx, geometry.agentsTrack.isShown],
        axis: [geometry.axisTopPx, geometry.minuteLabelLeftsPx],
        presentEdge: [boxOf(geometry.presentEdgeBox), geometry.presentTickTopsPx],
        isFigureFit: geometry.isFigureFit,
    }, {
        plot: [24, 500, 536, 552],
        tracks: [
            [18, 22, 524, [24, 38, 500, 75], 26, [89]],
            [127, 131, 524, [24, 147, 500, 75], 135, [198, 215]],
        ],
        waitingOnLabelTopPx: 236,
        meterRows: [
            [[24, 256, 500, 14], [552, 256, 62, 13], 624, 254],
            [[24, 279, 500, 14], [552, 279, 62, 13], 624, 277],
            [[24, 302, 500, 14], [552, 302, 62, 13], 624, 300],
        ],
        agents: [[24, 329, 500, 14], 552, 327, true],
        axis: [356, [24, 124, 224, 324, 424]],
        presentEdge: [[536, 18, 6, 334], [20, 57, 94, 129, 166, 203]],
        isFigureFit: true,
    });
});

test('monitorGeometry: the wide form without the agents track gives its row to the two traces, the odd pixel to ' +
    'memory; medium and small have no agents track even when asked', () =>
    assertEqual([
        geometryOf({hasAgentsTrack: false}),
        geometryOf({form: 'medium', heightPx: 355}),
        geometryOf({form: 'small', heightPx: 333}),
    ].map(geometry => [geometry.tracks.map(track => track.traceBox.height), boxOf(geometry.agentsTrack.stripBox),
        geometry.agentsTrack.isShown, geometry.axisTopPx]), [
        [[88, 89], [0, 0, 0, 0], false, 356],
        [[72, 72], [0, 0, 0, 0], false, 323],
        [[64, 66], [0, 0, 0, 0], false, 305],
    ]));

test('monitorGeometry: without a pressure history the axis closes the traces and the agents track, the strips take no ' +
    'room, the meters stand in one row in thirds under "Waiting on", and each trace is taller by a meter row', () => {
    const geometry = geometryOf({hasPressureHistory: false});
    assertEqual({
        traces: geometry.tracks.map(track => boxOf(track.traceBox)),
        agents: boxOf(geometry.agentsTrack.stripBox),
        axisTopPx: geometry.axisTopPx,
        waitingOnLabelTopPx: geometry.waitingOnLabelTopPx,
        meterRows: geometry.meterRows.map(row => [boxOf(row.stripBox), boxOf(row.meterBox), row.nameLeftPx]),
        presentEdgeHeightPx: geometry.presentEdgeBox.height,
    }, {
        traces: [[24, 38, 500, 98], [24, 170, 500, 98]],
        agents: [24, 272, 500, 14],
        axisTopPx: 299,
        waitingOnLabelTopPx: 329,
        meterRows: [
            [[0, 0, 0, 0], [24, 349, 62, 13], 96],
            [[0, 0, 0, 0], [261, 349, 62, 13], 333],
            [[0, 0, 0, 0], [499, 349, 62, 13], 571],
        ],
        presentEdgeHeightPx: 277,
    });
});

test('monitorGeometry: in every form and arrangement, at each text scaling, the last line ends at the tile\'s ' +
    'height less the form\'s bottom padding', () => {
    const arrangements = [[true, true], [true, false], [false, true], [false, false]];
    const endsPx = TEXT_SCALINGS.flatMap(scaling => FORMS.flatMap(form => arrangements.map(
        ([hasPressureHistory, hasAgentsTrack]) => {
            const lineBoxesPx = LINE_BOXES_BY_SCALING[scaling];
            const heightPx = monitorGeometry.monitorHeightNeedPx({form, lineBoxesPx});
            const geometry = monitorGeometry.monitorGeometry({
                widthPx: 984, heightPx, form, hasPressureHistory, hasAgentsTrack, lineBoxesPx,
                nowColumnWidthPx: SHEET_NOW_COLUMN_WIDTH_PX,
            });
            const lastRow = geometry.meterRows.at(-1);
            const contentEndPx = hasPressureHistory
                ? geometry.axisTopPx + lineBoxesPx[LineKind.LABEL]
                : lastRow.meterBox.y + monitorGeometry.monitorRowHeightsPx({form, lineBoxesPx}).meterRowPx;
            return heightPx - contentEndPx - monitorGeometry.MONITOR_BOTTOM_PADDING_PX_BY_FORM[form];
        })));
    assertEqual(endsPx.filter(endPx => endPx !== 0), []);
});

test('monitorGeometry: at its height need each figure and its lines fit its track and the gap under it, memory taking ' +
    'its need and CPU keeping its trace; given less, CPU gives memory what its own figure can spare, and where that ' +
    'is not enough the traces stay even and it says so', () =>
    assertEqual([
        geometryOf({heightPx: 504, lineBoxesPx: LINE_BOXES_BY_SCALING[1.5]}),
        geometryOf({heightPx: 439, lineBoxesPx: LINE_BOXES_BY_SCALING[1.25]}),
        geometryOf({heightPx: 453, lineBoxesPx: LINE_BOXES_BY_SCALING[1.5]}),
        geometryOf({form: 'small', heightPx: 331}),
    ].map(geometry => [geometry.tracks.map(track => track.traceBox.height), geometry.isFigureFit]), [
        [[88, 113], true],
        [[75, 92], true],
        [[75, 75], false],
        [[62, 66], true],
    ]));

test('monitorGeometry: the widths: 76 px fixed and the plot\'s 300, 500 and 724 beside the now column; a wider tile ' +
    'only lengthens the plot', () =>
    assertEqual({
        widths: monitorGeometry.monitorWidthsPx(SHEET_NOW_COLUMN_WIDTH_PX),
        plots: [560, 760, 984, 1032].map(widthPx => geometryOf({widthPx}).plotWidthPx),
        fixedPx: monitorGeometry.MONITOR_FIXED_WIDTH_PX,
    }, {
        widths: {leastWidthPx: 560, leastWidthBesideAnotherColumnPx: 760, stopWidthPx: 984},
        plots: [300, 500, 724, 772],
        fixedPx: 76,
    }));

test('monitorGeometry: the now column\'s width is the widest of its parts, each a fixed part and its text: the ' +
    'figure and its unit, a detail line, a meter row, the agents line', () =>
    assertEqual({
        defaults: monitorGeometry.monitorNowColumnWidthPx(monitorGeometry.DEFAULT_MONITOR_TEXT_WIDTHS_PX),
        figureWidest: monitorGeometry.monitorNowColumnWidthPx({
            figure: 128, unit: 26, detail: 134, meterName: 29, meterPercent: 32,
        }),
        meterWidest: monitorGeometry.monitorNowColumnWidthPx({
            figure: 50, unit: 10, detail: 60, meterName: 40, meterPercent: 40,
        }),
        detailWidest: monitorGeometry.monitorNowColumnWidthPx({
            figure: 50, unit: 10, detail: 200, meterName: 29, meterPercent: 32,
        }),
        badPart: monitorGeometry.monitorNowColumnWidthPx({
            figure: NaN, unit: 26, detail: 134, meterName: 29, meterPercent: 32,
        }),
        notAnObject: monitorGeometry.monitorNowColumnWidthPx(null),
    }, {
        defaults: 160, figureWidest: 160, meterWidest: 156, detailWidest: 200, badPart: 160, notAnObject: 160,
    }));

test('monitorGeometry: the now column\'s samples: each part\'s texts in its own class, as the width registry reads ' +
    'them', () =>
    assertEqual(monitorGeometry.MONITOR_WIDTH_SAMPLE_TEXTS, {
        figure: {lineKind: LineKind.FIGURE, texts: ['100', '888.8']},
        unit: {lineKind: LineKind.UNIT, texts: ['%', 'GiB']},
        detail: {lineKind: LineKind.DETAIL, texts: [
            'swap 88.8 · 88.8 in RAM', '+ 88.8 on disk', 'P 88 · E 88', 'no data since 88:88', '88 agents working',
        ]},
        meterName: {lineKind: LineKind.DETAIL, texts: ['cpu', 'mem', 'io']},
        meterPercent: {lineKind: LineKind.DETAIL, texts: ['100%']},
    }));

test('monitorGeometry: line boxes missing or reading badly are the default text size\'s, so the tile always lays ' +
    'out', () =>
    assertEqual([null, {}, {[LineKind.ROW]: NaN, [LineKind.FIGURE]: -1}].map(lineBoxesPx =>
        boxOf(geometryOf({lineBoxesPx}).tracks[1].traceBox)),
    [[24, 147, 500, 75], [24, 147, 500, 75], [24, 147, 500, 75]]));

test('monitorGeometry: every length is a whole pixel at least 0, across widths, heights, forms and text scalings', () => {
    const bad = [];
    for (const scaling of TEXT_SCALINGS) {
        for (const form of FORMS) {
            for (const widthPx of [100, 560, 637, 760, 911, 984, 1032]) {
                for (const heightPx of [0, 331, 388, 457, 504]) {
                    const geometry = geometryOf({widthPx, heightPx, form, lineBoxesPx: LINE_BOXES_BY_SCALING[scaling]});
                    if (numbersIn(geometry).some(value => !Number.isInteger(value) || value < 0))
                        bad.push([scaling, form, widthPx, heightPx]);
                }
            }
        }
    }
    assertEqual(bad, []);
});

test('monitorGeometry: the figure\'s line kind follows the form, and an unknown form is the wide form', () =>
    assertEqual(['wide', 'medium', 'small', 'tall'].map(form => [geometryOf({form}).form,
        geometryOf({form}).figureLineKind]), [
        ['wide', LineKind.FIGURE], ['medium', LineKind.FIGURE], ['small', LineKind.FIGURE_SMALL],
        ['wide', LineKind.FIGURE],
    ]));

test('monitorGeometry: the unit stands 6 px after its figure, on the figure\'s baseline; a meter\'s percentage 4 px ' +
    'after its name; a part that reads badly stands at 0', () =>
    assertEqual({
        unit: monitorGeometry.monitorUnitPlacement({widthPx: 127.6, baselinePx: 48.4}, {widthPx: 26, baselinePx: 16.2}),
        unitBad: monitorGeometry.monitorUnitPlacement({widthPx: NaN}, {widthPx: 26}),
        percent: monitorGeometry.monitorMeterPercentLeftOffsetPx({widthPx: 28.7}),
        percentBad: monitorGeometry.monitorMeterPercentLeftOffsetPx({widthPx: -3}),
    }, {
        unit: {unitLeftOffsetPx: 134, unitTopOffsetPx: 32},
        unitBad: {unitLeftOffsetPx: 6, unitTopOffsetPx: 0},
        percent: 33,
        percentBad: 4,
    }));
