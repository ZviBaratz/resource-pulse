// Rows for graph.js: the Cairo drawing behind the top-bar graphs and the desktop card's meters and strips. It runs
// inside gnome-shell on every repaint, so the first rows pin that no history the sampler can produce makes it throw,
// on a real image surface; the rest pin the geometry, and that the drawing fills exactly that geometry.
import Cairo from 'cairo';

import {test, assertEqual} from './harness.js';
import {
    areaGraphPolygons, drawAreaGraph, drawPressureMeter, drawPressureStrip, padWithLeadingGaps, pressureMeterCellRects,
    pressureStripCellRects,
} from '../extensions/resource-pulse@zvibaratz.github.io/graph.js';
// Read through the namespace too, so a missing export fails its row rather than the whole run.
import * as graphModule from '../extensions/resource-pulse@zvibaratz.github.io/graph.js';
import {
    BASELINE_RGBA, COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, CPU_GRAPH_RGBA, GRAPH_BASELINE_THICKNESS_PX,
    MEMORY_GRAPH_RGBA, PRESSURE_METER_FILL_RGBA, PRESSURE_METER_HEIGHT_PX, PRESSURE_METER_NO_DATA_RGBA,
    PRESSURE_METER_TRACK_RGBA, PRESSURE_METER_WAIT_FILL_RGBA, PRESSURE_METER_WIDTH_PX, PRESSURE_STRIP_BAND_RGBA,
    PRESSURE_STRIP_CALM_RGBA,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';
// Read whole, for the row on its names' suffixes: the cockpit service loads it.
import * as sharedConstants from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

// The top-bar graph's size for the no-throw rows.
const SURFACE_WIDTH_PX = 30;
const SURFACE_HEIGHT_PX = 16;
// A small area whose slot edges and heights are whole numbers, for the geometry rows.
const SMALL_WIDTH_PX = 3;
const SMALL_HEIGHT_PX = 10;
const TEST_FILL_RGBA = [1, 0, 0, 1];
const TEST_TRACK_RGBA = [0, 0, 1, 0.5];
const RGBA_COMPONENT_COUNT = 4;
/** A colour with every component distinct, and half its alpha: what withOpacity(…, 0.5) must make of it. */
const DISTINCT_RGBA = [1, 0.5, 0.25, 0.8];
const HALF_OPACITY = 0.5;
const DISTINCT_RGBA_AT_HALF_OPACITY = [1, 0.5, 0.25, 0.4];
// The card's pressure meter: 50×10, three 14 px cells with 4 px gaps (x 0, 18 and 36), and a 2 px no-data dash
// across the middle (y 4), the meter's width.
const METER_CELL_RECTS = [[0, 0, 14, 10], [18, 0, 14, 10], [36, 0, 14, 10]];
const METER_NO_DATA_DASH_RECT = [0, 4, 50, 2];
/** The no-data dash's test colour, distinct from the track's. */
const TEST_NO_DATA_RGBA = [0, 1, 0, 0.3];
/** A meter cell's corner radius. */
const METER_CELL_RADIUS_PX = 2;
// The card's pressure strip, COMPACT_PRESSURE_STRIP_HEIGHT_PX (11 px) high: a third is 4 px and two thirds 7. Its
// cells on a 10 px step, for the geometry rows: 8 px wide with 2 px gaps, a calm one a 2 px dash at the foot (y 9).
const STRIP_CELL_STEP_PX = 10;
const STRIP_CELL_RADIUS_PX = 1;
const STRIP_CELL_GAP_PX = 2;
const CALM_STRIP_CELL = [0, 9, 8, 2];
const BAND_ONE_STRIP_CELL = [0, 7, 8, 4];
const BAND_TWO_STRIP_CELL = [0, 4, 8, 7];
const BAND_THREE_STRIP_CELL = [0, 0, 8, 11];
/** The plot's cells: five minutes in 10 s cells. */
const PLOT_CELL_COUNT = 30;
/** The strip's test colours, each distinct. */
const TEST_CALM_RGBA = [0, 0, 1, 0.2];
const TEST_BAND_RGBA = [0, 1, 1, 0.6];
const TEST_WAIT_RGBA = [1, 0.5, 0, 1];
const TEST_STRIP_INK = {calmRgba: TEST_CALM_RGBA, bandRgba: TEST_BAND_RGBA, waitRgba: TEST_WAIT_RGBA};
/** The strip's colours: a calm cell and a cell of band 1, white at 0.22 and at 0.63. */
const STRIP_CALM_ALPHA = 0.22;
const STRIP_BAND_ONE_ALPHA = 0.63;
const WHITE_RGB = [1, 1, 1];
/** The series colours, as hex: teal for CPU, purple for memory. */
const CPU_SERIES_HEX = '#30adc4';
const MEMORY_SERIES_HEX = '#a85fc9';
/** The suffixes of the drawing constants' names: a colour, a length in logical pixels, an actor's opacity. */
const DRAWING_CONSTANT_SUFFIXES = ['_RGBA', '_PX', '_OPACITY'];
const OPAQUE_ALPHA = 1;
const HEX_RADIX = 16;
const HEX_COMPONENT_DIGITS = 2;
const COMPONENT_MAX = 0xff;

/**
 * Runs a drawing callback against a real Cairo context on a fresh ARGB32 image surface, then frees both.
 *
 * @param {number} widthPx - Surface width.
 * @param {number} heightPx - Surface height.
 * @param {(cr: Cairo.Context) => void} draw - The drawing under test.
 * @returns {void}
 */
function drawOnImageSurface(widthPx, heightPx, draw) {
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, widthPx, heightPx);
    const cr = new Cairo.Context(surface);
    try {
        draw(cr);
    } finally {
        cr.$dispose();
        surface.finish();
    }
}

/**
 * Wraps a real Cairo context so every method call is recorded, then forwarded to the real context unchanged.
 *
 * @param {Cairo.Context} cr - The real context.
 * @param {Array<Array<*>>} calls - Receives [methodName, ...args] per call.
 * @returns {Cairo.Context} A context that behaves exactly like cr.
 */
function recordingContext(cr, calls) {
    return new Proxy(cr, {
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
}

/**
 * Records the Cairo calls a pressure meter makes for one band, leaving out newPath.
 *
 * @param {*} band - What the card would pass: a band, null, or anything else.
 * @returns {Array<Array<*>>} [methodName, ...args] per call.
 */
function pressureMeterCalls(band) {
    const calls = [];
    drawOnImageSurface(PRESSURE_METER_WIDTH_PX, PRESSURE_METER_HEIGHT_PX, cr =>
        drawPressureMeter(recordingContext(cr, calls), PRESSURE_METER_WIDTH_PX, PRESSURE_METER_HEIGHT_PX, band,
            TEST_FILL_RGBA, TEST_TRACK_RGBA, TEST_NO_DATA_RGBA));
    return calls.filter(([methodName]) => methodName !== 'newPath');
}

/**
 * The calls that fill some rectangles in one colour.
 *
 * @param {number[]} rgba - The colour.
 * @param {Array<number[]>} rects - [x, y, width, height] each.
 * @returns {Array<Array<*>>} setSourceRGBA, one rectangle per rect, then fill.
 */
const fillCalls = (rgba, rects) => [['setSourceRGBA', ...rgba], ...rects.map(rect => ['rectangle', ...rect]), ['fill']];

/**
 * The calls that fill some meter cells in one colour, each a rounded rectangle: a sub-path of four corner arcs.
 *
 * @param {number[]} rgba - The colour.
 * @param {Array<number[]>} rects - [x, y, width, height] each.
 * @param {number} [radius] - The corners' radius: a meter cell's when left out.
 * @returns {Array<Array<*>>} setSourceRGBA, one rounded sub-path per rect, then fill.
 */
function roundedCellFillCalls(rgba, rects, radius = METER_CELL_RADIUS_PX) {
    const cellCalls = ([x, y, width, height]) => [
        ['newSubPath'],
        ['arc', x + width - radius, y + radius, radius, -Math.PI / 2, 0],
        ['arc', x + width - radius, y + height - radius, radius, 0, Math.PI / 2],
        ['arc', x + radius, y + height - radius, radius, Math.PI / 2, Math.PI],
        ['arc', x + radius, y + radius, radius, Math.PI, Math.PI * 3 / 2],
        ['closePath'],
    ];
    return [['setSourceRGBA', ...rgba], ...rects.flatMap(cellCalls), ['fill']];
}

/**
 * Says whether a value is an [red, green, blue, alpha] colour with every component a number from 0 to 1.
 *
 * @param {*} rgba - The candidate colour.
 * @returns {boolean} True for a usable Cairo source colour.
 */
function isRgbaInUnitRange(rgba) {
    return Array.isArray(rgba) && rgba.length === RGBA_COMPONENT_COUNT &&
        rgba.every(component => Number.isFinite(component) && component >= 0 && component <= 1);
}

test('drawAreaGraph on a 30×16 surface does not throw for an empty history', () =>
    drawOnImageSurface(SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, cr =>
        drawAreaGraph(cr, SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, [], CPU_GRAPH_RGBA, BASELINE_RGBA)));
test('drawAreaGraph on a 30×16 surface does not throw for an all-null history', () =>
    drawOnImageSurface(SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, cr =>
        drawAreaGraph(cr, SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, new Array(SURFACE_WIDTH_PX).fill(null),
            CPU_GRAPH_RGBA, BASELINE_RGBA)));
test('drawAreaGraph on a 30×16 surface does not throw for mixed values and gaps', () =>
    drawOnImageSurface(SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, cr =>
        drawAreaGraph(cr, SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, [null, 0, 0.25, null, 0.5, 1, 0.75, null],
            MEMORY_GRAPH_RGBA, BASELINE_RGBA)));
test('drawAreaGraph on a 30×16 surface does not throw for values above 1', () =>
    drawOnImageSurface(SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, cr =>
        drawAreaGraph(cr, SURFACE_WIDTH_PX, SURFACE_HEIGHT_PX, [1.5, 2, 100, 0.5],
            CPU_GRAPH_RGBA, BASELINE_RGBA)));
test('drawPressureMeter on a 50×10 surface does not throw for any band, no data, or nonsense', () =>
    drawOnImageSurface(PRESSURE_METER_WIDTH_PX, PRESSURE_METER_HEIGHT_PX, cr => {
        for (const band of [0, 1, 2, 3, null, undefined, NaN, Infinity, 4, -1, 1.5, '2'])
            drawPressureMeter(cr, PRESSURE_METER_WIDTH_PX, PRESSURE_METER_HEIGHT_PX, band, TEST_FILL_RGBA, TEST_TRACK_RGBA);
    }));
test('areaGraphPolygons: one slot per sample, filled from the baseline up to its value', () =>
    assertEqual(areaGraphPolygons([0.5, 1], 2, SMALL_HEIGHT_PX),
        [[[0, 10], [0, 5], [1, 5], [1, 0], [2, 0], [2, 10]]]));
test('areaGraphPolygons: a null splits the history into two runs (a gap, never a bridge)', () =>
    assertEqual(areaGraphPolygons([0.5, null, 0.5], SMALL_WIDTH_PX, SMALL_HEIGHT_PX), [
        [[0, 10], [0, 5], [1, 5], [1, 10]],
        [[2, 10], [2, 5], [3, 5], [3, 10]],
    ]));
test('areaGraphPolygons: values clamp to 0–1, so 1.5 stops at the top and −0.5 at the baseline', () =>
    assertEqual(areaGraphPolygons([1.5, -0.5], 2, SMALL_HEIGHT_PX),
        [[[0, 10], [0, 0], [1, 0], [1, 10], [2, 10], [2, 10]]]));
test('areaGraphPolygons: NaN, undefined and a string are gaps, so nothing non-finite reaches Cairo', () =>
    assertEqual(areaGraphPolygons([NaN, 0.5, undefined, '0.5'], 4, SMALL_HEIGHT_PX),
        [[[1, 10], [1, 5], [2, 5], [2, 10]]]));
test('areaGraphPolygons: nothing to fill for [], all-null, or a zero-sized area', () => {
    assertEqual(areaGraphPolygons([], SMALL_WIDTH_PX, SMALL_HEIGHT_PX), [], 'empty history');
    assertEqual(areaGraphPolygons([null, null], SMALL_WIDTH_PX, SMALL_HEIGHT_PX), [], 'all null');
    assertEqual(areaGraphPolygons([0.5], 0, SMALL_HEIGHT_PX), [], 'zero width');
    assertEqual(areaGraphPolygons([0.5], SMALL_WIDTH_PX, 0), [], 'zero height');
});

test('padWithLeadingGaps right-aligns a short history and keeps the newest of a long one', () => {
    assertEqual(padWithLeadingGaps([0.1, 0.2], 4), [null, null, 0.1, 0.2], 'short history');
    assertEqual(padWithLeadingGaps([0.1, 0.2, 0.3, 0.4, 0.5], 3), [0.3, 0.4, 0.5], 'long history');
    assertEqual(padWithLeadingGaps([0.1, 0.2], 0), [], 'no slots');
});

test('drawAreaGraph fills the baseline in its colour, then exactly areaGraphPolygons in the fill colour', () => {
    const fractions = [0.5, null, 1];
    const calls = [];
    drawOnImageSurface(SMALL_WIDTH_PX, SMALL_HEIGHT_PX, cr =>
        drawAreaGraph(recordingContext(cr, calls), SMALL_WIDTH_PX, SMALL_HEIGHT_PX, fractions,
            TEST_FILL_RGBA, BASELINE_RGBA));
    const baselineTopPx = SMALL_HEIGHT_PX - GRAPH_BASELINE_THICKNESS_PX;
    const expectedPathCalls = areaGraphPolygons(fractions, SMALL_WIDTH_PX, SMALL_HEIGHT_PX).flatMap(polygon => [
        ['moveTo', ...polygon[0]],
        ...polygon.slice(1).map(point => ['lineTo', ...point]),
        ['closePath'],
    ]);
    assertEqual(calls.filter(([methodName]) => methodName !== 'newPath'), [
        ['setSourceRGBA', ...BASELINE_RGBA],
        ['rectangle', 0, baselineTopPx, SMALL_WIDTH_PX, GRAPH_BASELINE_THICKNESS_PX],
        ['fill'],
        ['setSourceRGBA', ...TEST_FILL_RGBA],
        ...expectedPathCalls,
        ['fill'],
    ]);
});

test('pressureMeterCellRects: three equal full-height 14 px cells with 4 px gaps; none in a zero-sized area', () => {
    assertEqual(pressureMeterCellRects(PRESSURE_METER_WIDTH_PX, PRESSURE_METER_HEIGHT_PX), METER_CELL_RECTS);
    assertEqual(pressureMeterCellRects(0, PRESSURE_METER_HEIGHT_PX), [], 'zero width');
    assertEqual(pressureMeterCellRects(PRESSURE_METER_WIDTH_PX, 0), [], 'zero height');
});
test('drawPressureMeter band 1: the first cell in the fill colour, the other two as empty cells in the track ' +
    'colour, each with rounded corners', () => assertEqual(pressureMeterCalls(1), [
    ...roundedCellFillCalls(TEST_FILL_RGBA, METER_CELL_RECTS.slice(0, 1)),
    ...roundedCellFillCalls(TEST_TRACK_RGBA, METER_CELL_RECTS.slice(1)),
]));
test('drawPressureMeter band 0 draws three empty cells and band 3 three filled ones', () => {
    assertEqual(pressureMeterCalls(0), roundedCellFillCalls(TEST_TRACK_RGBA, METER_CELL_RECTS), 'band 0');
    assertEqual(pressureMeterCalls(3), roundedCellFillCalls(TEST_FILL_RGBA, METER_CELL_RECTS), 'band 3');
});
test('drawPressureMeter with no data draws no cell at all, only a dash across the middle in its own colour: a shape, ' +
    'not a colour', () =>
    assertEqual(pressureMeterCalls(null), fillCalls(TEST_NO_DATA_RGBA, [METER_NO_DATA_DASH_RECT])));
test('drawPressureMeter clamps a band above 3 or below 0, and draws anything not a finite number as no data', () => {
    assertEqual(pressureMeterCalls(4), pressureMeterCalls(3), 'above 3');
    assertEqual(pressureMeterCalls(-1), pressureMeterCalls(0), 'below 0');
    for (const notABand of [undefined, NaN, Infinity, '2'])
        assertEqual(pressureMeterCalls(notABand), pressureMeterCalls(null), String(notABand));
});

/**
 * A strip cell's rectangle moved to its cell's place on the 10 px step.
 *
 * @param {number[]} cellRect - The cell's [x, y, width, height] at x 0.
 * @param {number} cellIndex - Its cell.
 * @returns {number[]} The rectangle at its place.
 */
const stripCellAt = ([, y, width, height], cellIndex) => [cellIndex * STRIP_CELL_STEP_PX, y, width, height];

/**
 * Records the Cairo calls a pressure strip makes, on a strip of one 10 px step per cell, leaving out newPath.
 *
 * @param {Array<*>} cellBands - What the card would pass: a band per cell, null, or anything else.
 * @returns {Array<Array<*>>} [methodName, ...args] per call.
 */
function pressureStripCalls(cellBands) {
    const calls = [];
    const widthPx = cellBands.length * STRIP_CELL_STEP_PX;
    drawOnImageSurface(widthPx, COMPACT_PRESSURE_STRIP_HEIGHT_PX, cr =>
        drawPressureStrip(recordingContext(cr, calls), widthPx, COMPACT_PRESSURE_STRIP_HEIGHT_PX, cellBands,
            TEST_STRIP_INK));
    return calls.filter(([methodName]) => methodName !== 'newPath');
}

test('pressureStripCellRects: on a strip of four 10 px steps, each cell 8 px wide on the strip\'s foot: a calm ' +
    'cell a 2 px dash, band 1 a third of the 11 px (4 px), band 2 two thirds (7 px) and band 3 the whole height', () =>
    assertEqual(pressureStripCellRects(4 * STRIP_CELL_STEP_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, [0, 1, 2, 3]), [
        {band: 0, rect: stripCellAt(CALM_STRIP_CELL, 0)},
        {band: 1, rect: stripCellAt(BAND_ONE_STRIP_CELL, 1)},
        {band: 2, rect: stripCellAt(BAND_TWO_STRIP_CELL, 2)},
        {band: 3, rect: stripCellAt(BAND_THREE_STRIP_CELL, 3)},
    ]));

test('pressureStripCellRects on the card\'s 208 px plot: 30 cells, every left a whole pixel and every gap 2 px, so ' +
    '28 cells are 5 px wide and 2 are 4 px, the last ending 2 px before the plot\'s right', () => {
    const calmCells = Array(PLOT_CELL_COUNT).fill(0);
    const rects = pressureStripCellRects(COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, calmCells)
        .map(({rect}) => rect);
    const gapsPx = rects.slice(1).map(([x], cellIndex) => x - (rects[cellIndex][0] + rects[cellIndex][2]));
    const cellCountByWidthPx = {};
    for (const [, , widthPx] of rects)
        cellCountByWidthPx[widthPx] = (cellCountByWidthPx[widthPx] ?? 0) + 1;
    const [lastLeftPx, , lastWidthPx] = rects.at(-1);
    assertEqual({
        plotWidthPx: COMPACT_PLOT_WIDTH_PX,
        cellCount: rects.length,
        wholePixelLefts: rects.every(([x]) => Number.isInteger(x)),
        gapsPx: [...new Set(gapsPx)],
        cellCountByWidthPx,
        lastRightPx: lastLeftPx + lastWidthPx,
    }, {
        plotWidthPx: 208,
        cellCount: PLOT_CELL_COUNT,
        wholePixelLefts: true,
        gapsPx: [STRIP_CELL_GAP_PX],
        cellCountByWidthPx: {4: 2, 5: 28},
        lastRightPx: COMPACT_PLOT_WIDTH_PX - STRIP_CELL_GAP_PX,
    });
});

test('pressureStripCellRects: a cell with no reading has no rectangle; a band above 3 or below 0 is clamped, and ' +
    'anything not a finite number is no reading; nothing in a zero-sized strip, for no cells, or where a cell would ' +
    'be under a pixel wide', () => {
    const cellsOf = cellBands =>
        pressureStripCellRects(cellBands.length * STRIP_CELL_STEP_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, cellBands);
    assertEqual({
        noReadingSkipped: cellsOf([null, 2, null]),
        aboveThree: cellsOf([4]),
        belowZero: cellsOf([-1]),
        notANumber: [undefined, NaN, Infinity, '2'].map(notABand => cellsOf([notABand])),
        zeroWidth: pressureStripCellRects(0, COMPACT_PRESSURE_STRIP_HEIGHT_PX, [0]),
        zeroHeight: pressureStripCellRects(STRIP_CELL_STEP_PX, 0, [0]),
        noCells: pressureStripCellRects(COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, []),
        notAnArray: pressureStripCellRects(COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, null),
        stepOfTheGap: pressureStripCellRects(STRIP_CELL_GAP_PX * PLOT_CELL_COUNT, COMPACT_PRESSURE_STRIP_HEIGHT_PX,
            Array(PLOT_CELL_COUNT).fill(3)),
    }, {
        noReadingSkipped: [{band: 2, rect: stripCellAt(BAND_TWO_STRIP_CELL, 1)}],
        aboveThree: [{band: 3, rect: BAND_THREE_STRIP_CELL}],
        belowZero: [{band: 0, rect: CALM_STRIP_CELL}],
        notANumber: [[], [], [], []],
        zeroWidth: [],
        zeroHeight: [],
        noCells: [],
        notAnArray: [],
        stepOfTheGap: [],
    });
});

test('drawPressureStrip fills the calm cells in the calm colour, band 1\'s in the band colour and band 2\'s and ' +
    '3\'s in the wait colour (the meters\' amber, on the card), each colour one fill of cells rounded at 1 px, and ' +
    'no fill for a colour no cell has; a strip with no reading draws nothing', () => {
    assertEqual({
        everyBand: pressureStripCalls([0, 1, 2, 3, null, 0]),
        bandOneOnly: pressureStripCalls([1, 1]),
        noReading: pressureStripCalls([null, null, null]),
    }, {
        everyBand: [
            ...roundedCellFillCalls(TEST_CALM_RGBA,
                [stripCellAt(CALM_STRIP_CELL, 0), stripCellAt(CALM_STRIP_CELL, 5)], STRIP_CELL_RADIUS_PX),
            ...roundedCellFillCalls(TEST_BAND_RGBA, [stripCellAt(BAND_ONE_STRIP_CELL, 1)], STRIP_CELL_RADIUS_PX),
            ...roundedCellFillCalls(TEST_WAIT_RGBA,
                [stripCellAt(BAND_TWO_STRIP_CELL, 2), stripCellAt(BAND_THREE_STRIP_CELL, 3)], STRIP_CELL_RADIUS_PX),
        ],
        bandOneOnly: roundedCellFillCalls(TEST_BAND_RGBA,
            [stripCellAt(BAND_ONE_STRIP_CELL, 0), stripCellAt(BAND_ONE_STRIP_CELL, 1)], STRIP_CELL_RADIUS_PX),
        noReading: [],
    });
});

test('drawPressureStrip on the card\'s 208×11 strip does not throw for any band, no reading, nonsense, or a ' +
    'zero-sized strip', () =>
    drawOnImageSurface(COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, cr => {
        const everyKindOfCell = [0, 1, 2, 3, null, 4, -1, NaN, undefined, '2'];
        const cellBands = Array.from({length: PLOT_CELL_COUNT},
            (_unused, cellIndex) => everyKindOfCell[cellIndex % everyKindOfCell.length]);
        drawPressureStrip(cr, COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, cellBands, TEST_STRIP_INK);
        drawPressureStrip(cr, 0, 0, cellBands, TEST_STRIP_INK);
        drawPressureStrip(cr, COMPACT_PLOT_WIDTH_PX, COMPACT_PRESSURE_STRIP_HEIGHT_PX, [], TEST_STRIP_INK);
    }));

test('the pressure strip\'s colours: a calm cell is white at 0.22 and a cell of band 1 white at 0.63', () =>
    assertEqual([PRESSURE_STRIP_CALM_RGBA, PRESSURE_STRIP_BAND_RGBA],
        [[...WHITE_RGB, STRIP_CALM_ALPHA], [...WHITE_RGB, STRIP_BAND_ONE_ALPHA]]));

test('withOpacity scales only a colour\'s alpha, clamps the opacity to 0–1, and leaves the colour as it is for an ' +
    'opacity that is not a finite number (the frozen card dims its graphs with it)', () => {
    const {withOpacity} = graphModule;
    assertEqual({
        half: withOpacity(DISTINCT_RGBA, HALF_OPACITY),
        aboveOne: withOpacity(TEST_FILL_RGBA, 2),
        belowZero: withOpacity(TEST_FILL_RGBA, -1),
        notANumber: withOpacity(TEST_TRACK_RGBA, NaN),
        missing: withOpacity(TEST_TRACK_RGBA, undefined),
        original: DISTINCT_RGBA,
    }, {
        half: DISTINCT_RGBA_AT_HALF_OPACITY,
        aboveOne: TEST_FILL_RGBA,
        belowZero: [...TEST_FILL_RGBA.slice(0, 3), 0],
        notANumber: TEST_TRACK_RGBA,
        missing: TEST_TRACK_RGBA,
        original: [1, 0.5, 0.25, 0.8],
    });
});

/**
 * A colour constant's red, green and blue as a CSS hex colour, and its alpha.
 *
 * @param {number[]} rgba - [red, green, blue, alpha], each 0–1.
 * @returns {{hex: string, alpha: number}} '#rrggbb', each component rounded to a whole 0–255, and the alpha as given.
 */
function rgbaAsHex(rgba) {
    const componentHexes = rgba.slice(0, 3)
        .map(component => Math.round(component * COMPONENT_MAX).toString(HEX_RADIX).padStart(HEX_COMPONENT_DIGITS, '0'));
    return {hex: `#${componentHexes.join('')}`, alpha: rgba[3]};
}

test('the series colours: the CPU graph is the teal #30adc4 and the memory graph the purple #a85fc9, both opaque ' +
    '(where they are drawn: cockpitGlue.test.js)', () =>
    assertEqual([rgbaAsHex(CPU_GRAPH_RGBA), rgbaAsHex(MEMORY_GRAPH_RGBA)],
        [{hex: CPU_SERIES_HEX, alpha: OPAQUE_ALPHA}, {hex: MEMORY_SERIES_HEX, alpha: OPAQUE_ALPHA}]));

test('lib/constants.js exports no name ending in _RGBA, _PX or _OPACITY, the suffixes of a colour, a length and an ' +
    'opacity the shell draws with: the cockpit service loads it, so a change to one there would restart the service ' +
    'at an update', () =>
    assertEqual(Object.keys(sharedConstants)
        .filter(name => DRAWING_CONSTANT_SUFFIXES.some(suffix => name.endsWith(suffix))), []));

test('graph colour constants are [red, green, blue, alpha], each 0–1', () => {
    assertEqual(isRgbaInUnitRange(CPU_GRAPH_RGBA), true, 'CPU_GRAPH_RGBA');
    assertEqual(isRgbaInUnitRange(MEMORY_GRAPH_RGBA), true, 'MEMORY_GRAPH_RGBA');
    assertEqual(isRgbaInUnitRange(BASELINE_RGBA), true, 'BASELINE_RGBA');
    assertEqual(isRgbaInUnitRange(PRESSURE_METER_WAIT_FILL_RGBA), true, 'PRESSURE_METER_WAIT_FILL_RGBA');
    assertEqual(isRgbaInUnitRange(PRESSURE_METER_NO_DATA_RGBA), true, 'PRESSURE_METER_NO_DATA_RGBA');
    assertEqual(isRgbaInUnitRange(PRESSURE_METER_FILL_RGBA), true, 'PRESSURE_METER_FILL_RGBA');
    assertEqual(isRgbaInUnitRange(PRESSURE_METER_TRACK_RGBA), true, 'PRESSURE_METER_TRACK_RGBA');
    assertEqual(isRgbaInUnitRange(PRESSURE_STRIP_CALM_RGBA), true, 'PRESSURE_STRIP_CALM_RGBA');
    assertEqual(isRgbaInUnitRange(PRESSURE_STRIP_BAND_RGBA), true, 'PRESSURE_STRIP_BAND_RGBA');
});
