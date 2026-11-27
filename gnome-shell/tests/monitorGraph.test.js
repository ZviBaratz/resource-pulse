// Rows for monitorGraph.js: the Cairo drawing of the monitor tile's own marks, on a real image surface. It runs inside
// gnome-shell on every repaint of its drawing, so the first rows pin that nothing it can be handed makes it throw.
import Cairo from 'cairo';

import {test, assertEqual} from './harness.js';
// Read through the namespace, so a missing export fails its row rather than the whole run.
import * as monitorGraph from '../extensions/resource-pulse@zvibaratz.github.io/monitorGraph.js';
import {
    MONITOR_NOW_RULE_RGBA, MONITOR_PRESENT_TICK_RGBA,
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
