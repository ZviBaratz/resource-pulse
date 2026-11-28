// What lightens the traces' drawing, for the desktop card and the cockpit's monitor alike: where they are drawn at a
// resource scale above 1 they are drawn at half resolution, and at every scale they are repainted every other Sample.
// The words and the big figures beside them still change every Sample, and a frozen or covered card or tile keeps its
// own rules.
//
// - The resource scale is the one Clutter draws the traces' actor at: a whole number, so a monitor at 125 % draws them
//   at 2 and pays for the scale-2 raster. A fractional scale given is read as the whole one above it.
// - The first Sample after a reveal or a new layout always repaints them, so nothing revealed is a Sample old.
// - A scale or a count that cannot be read takes the full resolution and the repaint: the safe side for the look.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.

/** The traces are drawn at half resolution where their resource scale is above this. */
export const TRACE_HALF_RESOLUTION_ABOVE_RESOURCE_SCALE = 1;
/** The traces are repainted once in this many Samples. */
export const TRACE_REPAINT_EVERY_SAMPLES = 2;

/**
 * The resource scale the traces are drawn at: the scale Clutter draws their actor at, a whole number, so a fractional
 * scale is read as the whole one above it.
 *
 * @param {number} scale - The actor's resource scale (Clutter.Actor.get_resource_scale()), or a monitor's scale.
 * @returns {number|null} The whole resource scale; null for anything but a finite number over 0.
 */
export function traceResourceScale(scale) {
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0)
        return null;
    return Math.ceil(scale);
}

/**
 * Whether the traces are drawn at half resolution: where they are drawn at a resource scale above 1.
 *
 * @param {number} scale - The actor's resource scale (traceResourceScale reads it).
 * @returns {boolean} True above resource scale 1; false at 1 and for a scale that cannot be read.
 */
export function isTraceHalfResolution(scale) {
    const resourceScale = traceResourceScale(scale);
    return resourceScale !== null && resourceScale > TRACE_HALF_RESOLUTION_ABOVE_RESOURCE_SCALE;
}

/**
 * Whether a Sample repaints the traces: every other Sample, and always the first after a reveal or a new layout. The
 * caller counts the Samples since the traces last repainted, this one included, and starts again from 0 at each
 * repaint.
 *
 * @param {object} sample - The Sample's place.
 * @param {number} sample.samplesSinceTraceRepaint - Samples since the last repaint, this one included.
 * @param {boolean} sample.isFirstSinceRevealOrLayout - Whether it is the first Sample since a reveal or a new layout.
 * @returns {boolean} True where it repaints them; true too for a count that is not a whole number at least 0.
 */
export function doesSampleRepaintTraces({samplesSinceTraceRepaint, isFirstSinceRevealOrLayout}) {
    if (isFirstSinceRevealOrLayout)
        return true;
    if (!Number.isInteger(samplesSinceTraceRepaint) || samplesSinceTraceRepaint < 0)
        return true;
    return samplesSinceTraceRepaint >= TRACE_REPAINT_EVERY_SAMPLES;
}
