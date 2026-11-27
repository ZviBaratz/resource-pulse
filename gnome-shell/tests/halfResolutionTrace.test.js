// lib/halfResolutionTrace.js: a trace drawn at half resolution is allocated half its box in each direction and scaled
// back up by Clutter from its top left; its painter draws the full trace onto the half surface with one scale, so
// every line keeps its width once scaled up. At full resolution the box and the drawing are the trace's own.
import {test, assertEqual} from './harness.js';
import * as halfResolutionTrace from '../extensions/resource-pulse@zvibaratz.github.io/lib/halfResolutionTrace.js';

/** A trace's box in the wide form, even in both directions. */
const EVEN_TRACE_BOX = {x: 16, y: 40, width: 760, height: 120};
/** One a pixel wider and taller, odd in both. */
const ODD_TRACE_BOX = {x: 16, y: 40, width: 761, height: 121};
/** Boxes with no room to draw in. */
const NO_ROOM_BOXES = [{x: 0, y: 0, width: 0, height: 0}, {x: 3, y: 4, width: 0, height: 50},
    {x: 3, y: 4, width: Number.NaN, height: 50}, {x: 3, y: 4, width: Number.POSITIVE_INFINITY, height: 50}];

test('halfResolutionTrace: a trace at half resolution is drawn at a half of its box in each direction', () =>
    assertEqual(halfResolutionTrace.HALF_RESOLUTION_DIVISOR, 2));

test('halfResolutionTrace: traceAllocation at full resolution is the trace\'s own box, at scale 1', () =>
    assertEqual(halfResolutionTrace.traceAllocation({traceBox: EVEN_TRACE_BOX, isHalfResolution: false}),
        {box: EVEN_TRACE_BOX, scaleX: 1, scaleY: 1}));

test('halfResolutionTrace: traceAllocation at half resolution is half the box from its top left, rounded up, and ' +
    'the scale that draws it back to the whole box', () =>
    assertEqual([EVEN_TRACE_BOX, ODD_TRACE_BOX].map(traceBox =>
        halfResolutionTrace.traceAllocation({traceBox, isHalfResolution: true})), [
        {box: {x: 16, y: 40, width: 380, height: 60}, scaleX: 2, scaleY: 2},
        {box: {x: 16, y: 40, width: 381, height: 61}, scaleX: 761 / 381, scaleY: 121 / 61},
    ]));

test('halfResolutionTrace: a box with no room is allocated as it is, at scale 1, at either resolution', () =>
    assertEqual(NO_ROOM_BOXES.flatMap(traceBox => [true, false].map(isHalfResolution =>
        halfResolutionTrace.traceAllocation({traceBox, isHalfResolution}))),
    NO_ROOM_BOXES.flatMap(traceBox => [true, false].map(() => ({box: traceBox, scaleX: 1, scaleY: 1})))));

test('halfResolutionTrace: traceDrawing on a half surface is the full drawing in whole device pixels and the scale ' +
    'that maps it onto the surface, at resource scale 2, 1 and 1.5; at full resolution, the surface itself at scale 1',
() =>
    assertEqual([
        halfResolutionTrace.traceDrawing({traceBox: EVEN_TRACE_BOX, isHalfResolution: true, surfaceWidthPx: 760,
            surfaceHeightPx: 120}),
        halfResolutionTrace.traceDrawing({traceBox: ODD_TRACE_BOX, isHalfResolution: true, surfaceWidthPx: 381,
            surfaceHeightPx: 61}),
        halfResolutionTrace.traceDrawing({traceBox: ODD_TRACE_BOX, isHalfResolution: true, surfaceWidthPx: 572,
            surfaceHeightPx: 92}),
        halfResolutionTrace.traceDrawing({traceBox: EVEN_TRACE_BOX, isHalfResolution: false, surfaceWidthPx: 1520,
            surfaceHeightPx: 240}),
    ], [
        {drawingWidthPx: 1520, drawingHeightPx: 240, scaleX: 0.5, scaleY: 0.5},
        {drawingWidthPx: 761, drawingHeightPx: 121, scaleX: 381 / 761, scaleY: 61 / 121},
        {drawingWidthPx: 1142, drawingHeightPx: 182, scaleX: 572 / 1142, scaleY: 92 / 182},
        {drawingWidthPx: 1520, drawingHeightPx: 240, scaleX: 1, scaleY: 1},
    ]));

test('halfResolutionTrace: traceDrawing with no room in the box or on the surface is the surface itself at scale 1', () =>
    assertEqual([
        halfResolutionTrace.traceDrawing({traceBox: NO_ROOM_BOXES[0], isHalfResolution: true, surfaceWidthPx: 0,
            surfaceHeightPx: 0}),
        halfResolutionTrace.traceDrawing({traceBox: EVEN_TRACE_BOX, isHalfResolution: true, surfaceWidthPx: 0,
            surfaceHeightPx: 120}),
    ], [
        {drawingWidthPx: 0, drawingHeightPx: 0, scaleX: 1, scaleY: 1},
        {drawingWidthPx: 0, drawingHeightPx: 120, scaleX: 1, scaleY: 1},
    ]));
