// traceGraph.js: the desktop card's trace, drawn against a real Cairo context whose calls are recorded: a gap hatched
// from the sample before it to the sample after it and never bridged, an empty left where nothing was recorded yet,
// and nothing a history can do to make it throw.
import Cairo from 'cairo';

import {test, assertEqual} from './harness.js';
import {drawTrace, traceRuns} from '../extensions/resource-pulse@zvibaratz.github.io/traceGraph.js';

const PLOT_WIDTH_PX = 208;
const PLOT_HEIGHT_PX = 65;
const SLOT_COUNT = 150;
/** Each colour distinct, so the recorded calls say which part drew what. */
const TEST_INK = {
    lineRgba: [1, 0, 0, 1],
    areaAlpha: 0.34,
    gridRgba: [0, 1, 0, 0.14],
    baselineRgba: [0, 0, 1, 0.25],
    hatchRgba: [1, 1, 0, 0.16],
};
/** How far two x positions worked out by different sums may differ and still be the same. */
const X_TOLERANCE_PX = 1e-9;
/** Where one slot of a 150-slot plot stands, across 208 px. */
const xOfSlot = slot => (slot / (SLOT_COUNT - 1)) * PLOT_WIDTH_PX;

/**
 * Draws a trace against a real context, recording every call made on it.
 *
 * @param {Array<*>} history - The history, oldest first.
 * @param {object} [plot] - The plot's size and slots.
 * @returns {Array<Array<*>>} [methodName, ...args] per call.
 */
function traceCalls(history, {widthPx = PLOT_WIDTH_PX, heightPx = PLOT_HEIGHT_PX, slotCount = SLOT_COUNT} = {}) {
    const calls = [];
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, Math.max(1, widthPx), Math.max(1, heightPx));
    const cr = new Cairo.Context(surface);
    const recording = new Proxy(cr, {
        get(target, property) {
            const member = target[property];
            if (typeof member !== 'function')
                return member;
            return (...args) => {
                calls.push([property, ...args]);
                return member.apply(target, args);
            };
        },
    });
    try {
        drawTrace(recording, widthPx, heightPx, history, slotCount, TEST_INK);
    } finally {
        cr.$dispose();
        surface.finish();
    }
    return calls;
}

/** What subpathsBySource names a gradient source: the area's fade. */
const GRADIENT_SOURCE = 'gradient';

/**
 * Every subpath drawn, each from its moveTo to its last lineTo, with the source set while it was drawn: a colour, or
 * GRADIENT_SOURCE for a pattern.
 *
 * @param {Array<Array<*>>} calls - Recorded calls.
 * @returns {Array<{source: (number[]|string|null), points: number[][]}>} The subpaths, in the order drawn.
 */
function subpathsBySource(calls) {
    let currentSource = null;
    const subpaths = [];
    for (const [methodName, ...args] of calls) {
        if (methodName === 'setSourceRGBA')
            currentSource = args;
        else if (methodName === 'setSource')
            currentSource = GRADIENT_SOURCE;
        else if (methodName === 'moveTo')
            subpaths.push({source: currentSource, points: [args]});
        else if (methodName === 'lineTo' && subpaths.length > 0)
            subpaths.at(-1).points.push(args);
    }
    return subpaths;
}

/**
 * The points of every subpath drawn with one source.
 *
 * @param {Array<Array<*>>} calls - Recorded calls.
 * @param {number[]|string} source - A colour, or GRADIENT_SOURCE.
 * @returns {number[][][]} Each subpath's [x, y] points, in order.
 */
function subpathPointsIn(calls, source) {
    const sourceText = JSON.stringify(source);
    return subpathsBySource(calls).filter(subpath => JSON.stringify(subpath.source) === sourceText)
        .map(({points}) => points);
}

/**
 * Each subpath's leftmost and rightmost x.
 *
 * @param {number[][][]} subpathPoints - Subpaths' points.
 * @returns {number[][]} [left, right] per subpath.
 */
function subpathSpans(subpathPoints) {
    return subpathPoints.map(points => {
        const pointXs = points.map(([x]) => x);
        return [Math.min(...pointXs), Math.max(...pointXs)];
    });
}

/**
 * Draws a trace while recording every colour stop a gradient is given.
 *
 * @param {Array<*>} history - The history, oldest first.
 * @returns {Array<number[]>} [offset, red, green, blue, alpha] per stop, in the order given.
 */
function gradientStopsOf(history) {
    const gradientPrototype = Object.getPrototypeOf(Cairo.LinearGradient.prototype);
    const addColorStopRGBA = gradientPrototype.addColorStopRGBA;
    const stops = [];
    gradientPrototype.addColorStopRGBA = function (...args) {
        stops.push(args);
        return addColorStopRGBA.apply(this, args);
    };
    try {
        traceCalls(history);
    } finally {
        gradientPrototype.addColorStopRGBA = addColorStopRGBA;
    }
    return stops;
}

/**
 * The clip rectangles a trace hatches: one per gap.
 *
 * @param {Array<Array<*>>} calls - Recorded calls.
 * @returns {Array<number[]>} [x, y, width, height] of each.
 */
const hatchedRects = calls => calls.filter(([methodName]) => methodName === 'rectangle').map(([, ...rect]) => rect);

/** A full history, flat at half height, with the gap given. */
const historyWithGap = (firstGapIndex, gapLength) =>
    Array.from({length: SLOT_COUNT}, (_unused, sampleIndex) =>
        (sampleIndex >= firstGapIndex && sampleIndex < firstGapIndex + gapLength ? null : 0.5));

test('traceRuns: a short history stands at the right end, leaving its left out; a gap is its own run; NaN, ' +
    'undefined and a string are gaps', () =>
    assertEqual({
        shortHistory: traceRuns([0.2, 0.3, null, Number.NaN, 0.4, undefined, '0.5'], 10),
        longHistory: traceRuns([0.1, 0.2, 0.3, 0.4], 2),
        noSlots: [0, -1, Number.NaN, undefined].map(slotCount => traceRuns([0.1], slotCount)),
        notAnArray: traceRuns(null, 10),
    }, {
        shortHistory: [
            {isGap: false, firstSlot: 3, lastSlot: 4},
            {isGap: true, firstSlot: 5, lastSlot: 6},
            {isGap: false, firstSlot: 7, lastSlot: 7},
            {isGap: true, firstSlot: 8, lastSlot: 9},
        ],
        longHistory: [{isGap: false, firstSlot: 0, lastSlot: 1}],
        noSlots: [[], [], [], []],
        notAnArray: [],
    }));

test('drawTrace never throws: an empty, all-gap or nonsense history, a zero-sized plot, or no slots', () => {
    const histories = [[], [null, null], [Number.NaN, Infinity, -2, 3, '1', {}], null, undefined];
    for (const history of histories)
        traceCalls(history);
    for (const plot of [{widthPx: 0}, {heightPx: 0}, {slotCount: 0}, {slotCount: 1}, {slotCount: Number.NaN}])
        traceCalls([0.2, 0.4], plot);
    assertEqual(traceCalls([0.2, 0.4], {widthPx: 0}).length, 0);
});

test('drawTrace hatches a gap from the sample before it to the sample after it; the line and the area stop at the ' +
    'sample before and start again at the sample after, and no segment of the line spans more than one slot', () => {
    const calls = traceCalls(historyWithGap(60, 5));
    const lineSubpaths = subpathPointsIn(calls, TEST_INK.lineRgba);
    const slotStepX = xOfSlot(1);
    const isOneSlotStep = (x, previousX) => Math.abs(x - previousX - slotStepX) < X_TOLERANCE_PX;
    assertEqual({
        hatched: hatchedRects(calls),
        lineRuns: subpathSpans(lineSubpaths),
        areaRuns: subpathSpans(subpathPointsIn(calls, GRADIENT_SOURCE)),
        lineStepsOneSlotEach: lineSubpaths.every(points =>
            points.slice(1).every(([x], pointIndex) => isOneSlotStep(x, points[pointIndex][0]))),
        hatchDrawn: subpathPointsIn(calls, TEST_INK.hatchRgba).length > 0,
    }, {
        hatched: [[xOfSlot(59), 0, xOfSlot(65) - xOfSlot(59), PLOT_HEIGHT_PX]],
        lineRuns: [[0, xOfSlot(59)], [xOfSlot(65), PLOT_WIDTH_PX]],
        areaRuns: [[0, xOfSlot(59)], [xOfSlot(65), PLOT_WIDTH_PX]],
        lineStepsOneSlotEach: true,
        hatchDrawn: true,
    });
});

test('drawTrace leaves the left of a short history empty: no line, no area and no hatch before its oldest ' +
    'sample', () => {
    const recordedCount = 40;
    const firstRecordedSlot = SLOT_COUNT - recordedCount;
    const calls = traceCalls([null, ...Array.from({length: recordedCount - 1}, () => 0.3)]);
    assertEqual({
        lineRuns: subpathSpans(subpathPointsIn(calls, TEST_INK.lineRgba)),
        areaRuns: subpathSpans(subpathPointsIn(calls, GRADIENT_SOURCE)),
        hatched: hatchedRects(calls),
    }, {
        lineRuns: [[xOfSlot(firstRecordedSlot + 1), PLOT_WIDTH_PX]],
        areaRuns: [[xOfSlot(firstRecordedSlot + 1), PLOT_WIDTH_PX]],
        hatched: [[xOfSlot(firstRecordedSlot), 0, xOfSlot(firstRecordedSlot + 1) - xOfSlot(firstRecordedSlot),
            PLOT_HEIGHT_PX]],
    });
});

test('drawTrace draws each run\'s area through a fade, from the area\'s alpha at its highest point to nothing at the ' +
    'baseline, and its line 2 px wide with round joins, in the line\'s colour', () => {
    const history = historyWithGap(60, 5);
    const calls = traceCalls(history);
    const [red, green, blue] = TEST_INK.lineRgba;
    const fadeStops = [[0, red, green, blue, TEST_INK.areaAlpha], [1, red, green, blue, 0]];
    const methodNames = calls.map(([methodName]) => methodName);
    const lineWidthsBeforeLineStrokes = [];
    let currentLineWidth = null;
    let currentRgba = null;
    for (const [methodName, ...args] of calls) {
        if (methodName === 'setLineWidth')
            currentLineWidth = args[0];
        if (methodName === 'setSourceRGBA')
            currentRgba = args;
        if (methodName === 'stroke' && JSON.stringify(currentRgba) === JSON.stringify(TEST_INK.lineRgba))
            lineWidthsBeforeLineStrokes.push(currentLineWidth);
    }
    const isRoundJoin = ([methodName, join]) => methodName === 'setLineJoin' && join === Cairo.LineJoin.ROUND;
    assertEqual({
        gradientFills: methodNames.filter(methodName => methodName === 'setSource').length,
        gradientStops: gradientStopsOf(history),
        lineWidths: lineWidthsBeforeLineStrokes,
        roundJoins: calls.filter(isRoundJoin).length,
    }, {gradientFills: 2, gradientStops: [...fadeStops, ...fadeStops], lineWidths: [2, 2], roundJoins: 2});
});

test('drawTrace\'s grid: a line along the top, a dashed one at half height, four dashed minute ticks and the ' +
    'baseline, each on a pixel\'s centre', () => {
    const calls = traceCalls([0.5, 0.5]);
    const gridMoves = [];
    let currentRgba = null;
    for (const [methodName, ...args] of calls) {
        if (methodName === 'setSourceRGBA')
            currentRgba = args;
        if (methodName === 'setSource')
            currentRgba = null;
        if (methodName === 'moveTo' && [TEST_INK.gridRgba, TEST_INK.baselineRgba].some(rgba =>
            JSON.stringify(rgba) === JSON.stringify(currentRgba)))
            gridMoves.push(args);
    }
    assertEqual(gridMoves, [[0, 0.5], [0, 32.5], [42.5, 0], [83.5, 0], [125.5, 0], [166.5, 0], [0, 64.5]]);
});
