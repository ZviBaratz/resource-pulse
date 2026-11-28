// Rows for monitorGraph.js: the Cairo drawing of the monitor tile's own marks, on a real image surface. It runs inside
// gnome-shell on every repaint of its drawing, so the first rows pin that nothing it can be handed makes it throw.
import Cairo from 'cairo';

import {test, assertEqual} from './harness.js';
// Read through the namespace, so a missing export fails its row rather than the whole run.
import * as monitorGraph from '../extensions/resource-pulse@zvibaratz.github.io/monitorGraph.js';
import {pressureStripCellRects} from '../extensions/resource-pulse@zvibaratz.github.io/graph.js';
import * as drawingConstants from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';
import {
    CPU_GRAPH_RGBA, MONITOR_NOW_RULE_RGBA, MONITOR_PRESENT_TICK_RGBA, MONITOR_STRIP_HEIGHT_PX,
    PRESSURE_METER_WAIT_FILL_RGBA,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';

/** The present edge of the wide form at 760 × 388: 6 px wide, 334 high, ticks on two 75 px traces. */
const EDGE_WIDTH_PX = 6;
const EDGE_HEIGHT_PX = 334;
const EDGE_TICK_ROWS_PX = [20, 57, 94, 129, 166, 203];
const TEST_RULE_RGBA = [1, 0, 0, 0.3];
const TEST_TICK_RGBA = [0, 1, 0, 0.5];

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

test('presentEdgeRects: the rule 1 px wide down the whole edge, and a 5 px tick right of it at each row given', () =>
    assertEqual(monitorGraph.presentEdgeRects(EDGE_WIDTH_PX, EDGE_HEIGHT_PX, [20, 57]), {
        ruleRect: [0, 0, 1, 334],
        tickRects: [[1, 20, 5, 1], [1, 57, 5, 1]],
    }));

test('presentEdgeRects: a row outside the edge, or not a whole number at least 0, draws no tick; an edge with no room ' +
    'draws nothing', () =>
    assertEqual([
        monitorGraph.presentEdgeRects(EDGE_WIDTH_PX, 30, [0, 29, 30, -1, 2.5, NaN, null]),
        monitorGraph.presentEdgeRects(0, EDGE_HEIGHT_PX, [20]),
        monitorGraph.presentEdgeRects(EDGE_WIDTH_PX, 0, [0]),
        monitorGraph.presentEdgeRects(EDGE_WIDTH_PX, 30, null),
    ], [
        {ruleRect: [0, 0, 1, 30], tickRects: [[1, 0, 5, 1], [1, 29, 5, 1]]},
        {ruleRect: null, tickRects: []},
        {ruleRect: null, tickRects: []},
        {ruleRect: [0, 0, 1, 30], tickRects: []},
    ]));

test('presentEdgeRects: a 1 px edge has the rule and no room for a tick', () =>
    assertEqual(monitorGraph.presentEdgeRects(1, 30, [5]), {ruleRect: [0, 0, 1, 30], tickRects: []}));

test('drawPresentEdge fills the rule in its ink, then every tick in theirs, and nothing else', () => {
    const calls = [];
    drawOnImageSurface(EDGE_WIDTH_PX, EDGE_HEIGHT_PX, cr => monitorGraph.drawPresentEdge(recordingContext(cr, calls),
        EDGE_WIDTH_PX, EDGE_HEIGHT_PX, [20, 57], TEST_RULE_RGBA, TEST_TICK_RGBA));
    assertEqual(calls.filter(([methodName]) => methodName !== 'newPath'), [
        ['setSourceRGBA', ...TEST_RULE_RGBA], ['rectangle', 0, 0, 1, 334], ['fill'],
        ['setSourceRGBA', ...TEST_TICK_RGBA], ['rectangle', 1, 20, 5, 1], ['rectangle', 1, 57, 5, 1], ['fill'],
    ]);
});

test('drawPresentEdge on a real surface does not throw for the wide form\'s edge, no room, or nonsense rows', () => {
    const cases = [[EDGE_WIDTH_PX, EDGE_HEIGHT_PX, EDGE_TICK_ROWS_PX], [EDGE_WIDTH_PX, 1, []], [1, 1, undefined],
        [EDGE_WIDTH_PX, 40, ['a', {}, Infinity]]];
    for (const [widthPx, heightPx, tickRowsPx] of cases) {
        drawOnImageSurface(Math.max(1, widthPx), Math.max(1, heightPx), cr =>
            monitorGraph.drawPresentEdge(cr, widthPx, heightPx, tickRowsPx, TEST_RULE_RGBA, TEST_TICK_RGBA));
    }
    drawOnImageSurface(1, 1, cr => monitorGraph.drawPresentEdge(cr, 0, 0, EDGE_TICK_ROWS_PX, TEST_RULE_RGBA,
        TEST_TICK_RGBA));
    assertEqual(true, true);
});

test('the present edge\'s inks: the rule white at 0.3, the ticks white at 0.5', () =>
    assertEqual([MONITOR_NOW_RULE_RGBA, MONITOR_PRESENT_TICK_RGBA], [[1, 1, 1, 0.3], [1, 1, 1, 0.5]]));

// The agents track: thirty cells on the plot's width, under the strips' own cells.
const AGENTS_CELL_COUNT = 30;
const PLOT_WIDTHS_PX = [300, 500, 724];
const WIDEST_PLOT_PX = 724;
const TEST_AGENTS_INK = Object.freeze({
    calmRgba: [0, 0, 1, 0.25], workingRgba: [0, 0, 1, 0.6], ongoingCapRgba: [1, 0.5, 0, 1], endedCapRgba: [1, 1, 1, 0.4],
});
const NO_AGENTS_CELL = {workingCount: null, capState: 'none'};

/**
 * Thirty agents cells, empty but for the ones given.
 *
 * @param {Object<number, {workingCount: number|null, capState: string}>} cellsByIndex - Cells by index, oldest 0.
 * @returns {Array<{workingCount: number|null, capState: string}>} The cells.
 */
function agentsCellsWith(cellsByIndex) {
    return Array.from({length: AGENTS_CELL_COUNT}, (_unused, cellIndex) => cellsByIndex[cellIndex] ?? NO_AGENTS_CELL);
}

test('agentsTrackCellRects: each cell stands where the pressure strips\' cell of the same index stands, at every ' +
    'plot width, on whole pixels', () => {
    const everyCellCalm = Array(AGENTS_CELL_COUNT).fill(null).map(() => ({workingCount: 0, capState: 'none'}));
    const leftAndWidth = ({rect: [x, , width]}) => [x, width];
    assertEqual(PLOT_WIDTHS_PX.map(widthPx =>
        monitorGraph.agentsTrackCellRects(widthPx, MONITOR_STRIP_HEIGHT_PX, everyCellCalm).bars.map(leftAndWidth)),
    PLOT_WIDTHS_PX.map(widthPx =>
        pressureStripCellRects(widthPx, MONITOR_STRIP_HEIGHT_PX, Array(AGENTS_CELL_COUNT).fill(0)).map(leftAndWidth)));
});

test('agentsTrackCellRects: a bar from the foot, its height its count against the most in the track over the ' +
    'strip less the cap and a pixel, never under 2 px; no one working is a 1 px dash; a cell told nothing draws ' +
    'nothing', () =>
    assertEqual(monitorGraph.agentsTrackCellRects(WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, agentsCellsWith({
        25: {workingCount: 0, capState: 'none'}, 26: {workingCount: 1, capState: 'none'},
        27: {workingCount: 12, capState: 'none'}, 28: {workingCount: 3, capState: 'none'},
    })), {
        // Of 12 at most, over 11 px: 1 is 0.9 px, raised to 2; 3 is 2.75, so 3.
        bars: [
            {isCalm: true, rect: [603, 13, 22, 1]}, {isCalm: false, rect: [627, 12, 23, 2]},
            {isCalm: false, rect: [652, 3, 22, 11]}, {isCalm: false, rect: [676, 11, 22, 3]},
        ],
        caps: [],
    }));

test('agentsTrackCellRects: with no one working in all five minutes every cell told is a dash', () =>
    assertEqual(monitorGraph.agentsTrackCellRects(WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, agentsCellsWith({
        28: {workingCount: 0, capState: 'none'}, 29: {workingCount: 0, capState: 'none'},
    })).bars, [{isCalm: true, rect: [676, 13, 22, 1]}, {isCalm: true, rect: [700, 13, 22, 1]}]));

test('agentsTrackCellRects: a cell in which a session was blocked carries a 2 px cap at the strip\'s top, ongoing or ' +
    'ended, over a dash as over a bar; a cell told nothing has none', () =>
    assertEqual(monitorGraph.agentsTrackCellRects(WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, agentsCellsWith({
        26: {workingCount: null, capState: 'ongoing'}, 27: {workingCount: 0, capState: 'ended'},
        28: {workingCount: 3, capState: 'ongoing'}, 29: {workingCount: 3, capState: 'none'},
    })).caps, [{capState: 'ended', rect: [652, 0, 22, 2]}, {capState: 'ongoing', rect: [676, 0, 22, 2]}]));

test('agentsTrackCellRects: no room, no cells, a plot too narrow for a cell, or a count that is not a whole number ' +
    'at least 0, draws nothing', () => {
    const nonsenseCells = agentsCellsWith({
        25: {workingCount: 'a', capState: 'ongoing'}, 26: {workingCount: -1, capState: 'none'},
        27: {workingCount: NaN, capState: 'none'}, 28: {workingCount: Infinity, capState: 'none'},
        29: {workingCount: 1.5, capState: 'none'},
    });
    const nothing = {bars: [], caps: []};
    assertEqual([
        monitorGraph.agentsTrackCellRects(0, MONITOR_STRIP_HEIGHT_PX, agentsCellsWith({29: {workingCount: 1}})),
        monitorGraph.agentsTrackCellRects(WIDEST_PLOT_PX, 0, agentsCellsWith({29: {workingCount: 1}})),
        monitorGraph.agentsTrackCellRects(WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, null),
        monitorGraph.agentsTrackCellRects(WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, []),
        monitorGraph.agentsTrackCellRects(AGENTS_CELL_COUNT, MONITOR_STRIP_HEIGHT_PX, agentsCellsWith({29: {workingCount: 1}})),
        monitorGraph.agentsTrackCellRects(WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, nonsenseCells),
    ], [nothing, nothing, nothing, nothing, nothing, nothing]);
});

test('drawAgentsTrack fills the dashes, then the bars, then the ongoing caps, then the ended caps, each in its ink ' +
    'and only where there is one', () => {
    const inksSet = cells => {
        const calls = [];
        drawOnImageSurface(WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, cr => monitorGraph.drawAgentsTrack(
            recordingContext(cr, calls), WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, cells, TEST_AGENTS_INK));
        return calls.filter(([methodName]) => methodName === 'setSourceRGBA').map(([, ...rgba]) => rgba);
    };
    const {calmRgba, workingRgba, ongoingCapRgba, endedCapRgba} = TEST_AGENTS_INK;
    assertEqual({
        every: inksSet(agentsCellsWith({
            26: {workingCount: 0, capState: 'ended'}, 27: {workingCount: 2, capState: 'ongoing'},
        })),
        calmOnly: inksSet(agentsCellsWith({29: {workingCount: 0, capState: 'none'}})),
        empty: inksSet(agentsCellsWith({})),
    }, {every: [calmRgba, workingRgba, ongoingCapRgba, endedCapRgba], calmOnly: [calmRgba], empty: []});
});

test('drawAgentsTrack on a real surface does not throw for a full track, no room, or nonsense cells', () => {
    const fullTrack = Array.from({length: AGENTS_CELL_COUNT}, (_unused, cellIndex) =>
        ({workingCount: cellIndex % 4, capState: ['none', 'ongoing', 'ended'][cellIndex % 3]}));
    const cases = [[WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, fullTrack], [WIDEST_PLOT_PX, 2, fullTrack],
        [1, 1, fullTrack], [WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, [null, 3, {}, 'cell']],
        [WIDEST_PLOT_PX, MONITOR_STRIP_HEIGHT_PX, undefined]];
    for (const [widthPx, heightPx, cells] of cases) {
        drawOnImageSurface(widthPx, heightPx, cr =>
            monitorGraph.drawAgentsTrack(cr, widthPx, heightPx, cells, TEST_AGENTS_INK));
    }
    drawOnImageSurface(1, 1, cr => monitorGraph.drawAgentsTrack(cr, 0, 0, fullTrack, TEST_AGENTS_INK));
    assertEqual(true, true);
});

test('the agents track\'s inks: bars in the CPU trace\'s teal at 0.6, dashes at 0.25; an ongoing cap amber as a ' +
    'waited-on meter, an ended one white at 0.4; caps 2 px high', () => {
    const teal = CPU_GRAPH_RGBA.slice(0, 3);
    assertEqual([
        drawingConstants.AGENTS_TRACK_WORKING_RGBA, drawingConstants.AGENTS_TRACK_CALM_RGBA,
        drawingConstants.AGENTS_TRACK_ONGOING_CAP_RGBA, drawingConstants.AGENTS_TRACK_ENDED_CAP_RGBA,
        drawingConstants.AGENTS_TRACK_CAP_HEIGHT_PX,
    ], [[...teal, 0.6], [...teal, 0.25], PRESSURE_METER_WAIT_FILL_RGBA, [1, 1, 1, 0.4], 2]);
});
