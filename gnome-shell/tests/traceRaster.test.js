// lib/traceRaster.js: the traces are drawn at half resolution where they are drawn at a resource scale above 1, and
// repainted every other Sample at every scale; the first Sample after a reveal or a new layout always repaints them.
// A scale or a count that cannot be read takes the full resolution and the repaint: the safe side for the look.
import {test, assertEqual} from './harness.js';
import {
    TRACE_HALF_RESOLUTION_ABOVE_RESOURCE_SCALE, TRACE_REPAINT_EVERY_SAMPLES, doesSampleRepaintTraces,
    isTraceHalfResolution, traceResourceScale,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/traceRaster.js';

/** Scales that cannot be read as the scale an actor is drawn at. */
const UNREADABLE_SCALES = [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, null, undefined, '2'];
/** Counts of Samples that cannot be read as one. */
const UNREADABLE_COUNTS = [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, null, undefined, '2'];
/** Samples followed in a row, from a repaint. */
const FOLLOWED_SAMPLE_COUNT = 6;

/**
 * Whether each Sample in a row repaints the traces, from a repaint, the caller counting the Samples since the last
 * repaint (this one included) and starting again from 0 at each.
 *
 * @param {number} sampleCount - Samples in the row.
 * @returns {boolean[]} For each Sample, whether it repaints the traces.
 */
function repaintsOverSamples(sampleCount) {
    const repaints = [];
    let samplesSinceTraceRepaint = 0;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        samplesSinceTraceRepaint++;
        const isRepaint = doesSampleRepaintTraces({samplesSinceTraceRepaint, isFirstSinceRevealOrLayout: false});
        repaints.push(isRepaint);
        if (isRepaint)
            samplesSinceTraceRepaint = 0;
    }
    return repaints;
}

test('traceRaster: half resolution above resource scale 1, and a repaint every 2 Samples', () =>
    assertEqual([TRACE_HALF_RESOLUTION_ABOVE_RESOURCE_SCALE, TRACE_REPAINT_EVERY_SAMPLES], [1, 2]));

test('traceRaster: the resource scale is the one Clutter draws at, a fractional scale read as the whole one above it: ' +
    '1, 1.25 read as 2, 2 and 3', () =>
    assertEqual([1, 1.25, 2, 3].map(traceResourceScale), [1, 2, 2, 3]));

test('traceRaster: full resolution at resource scale 1; half at 1.25 (drawn at 2), 2 and 3', () =>
    assertEqual([1, 1.25, 2, 3].map(isTraceHalfResolution), [false, true, true, true]));

test('traceRaster: a scale that cannot be read has no resource scale and takes the full resolution', () =>
    assertEqual(UNREADABLE_SCALES.map(scale => [traceResourceScale(scale), isTraceHalfResolution(scale)]),
        UNREADABLE_SCALES.map(() => [null, false])));

test('traceRaster: from a repaint, every other Sample repaints the traces: the second, the fourth, the sixth', () =>
    assertEqual(repaintsOverSamples(FOLLOWED_SAMPLE_COUNT), [false, true, false, true, false, true]));

test('traceRaster: the first Sample after a reveal or a new layout repaints the traces whatever the count, so ' +
    'nothing revealed is a Sample old; otherwise one Sample since the last repaint does not', () =>
    assertEqual([1, 2].flatMap(samplesSinceTraceRepaint => [true, false].map(isFirstSinceRevealOrLayout =>
        doesSampleRepaintTraces({samplesSinceTraceRepaint, isFirstSinceRevealOrLayout}))),
    [true, false, true, true]));

test('traceRaster: a count of Samples that cannot be read repaints the traces', () =>
    assertEqual(UNREADABLE_COUNTS.map(samplesSinceTraceRepaint =>
        doesSampleRepaintTraces({samplesSinceTraceRepaint, isFirstSinceRevealOrLayout: false})),
    UNREADABLE_COUNTS.map(() => true)));
