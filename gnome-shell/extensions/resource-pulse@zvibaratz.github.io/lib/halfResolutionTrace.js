// How a trace is drawn at half resolution (lib/traceRaster.js says where): it is allocated half its box in each
// direction, from its top left, and Clutter scales it back up to the whole box as it paints, so its surface holds a
// quarter of the pixels. Its painter draws the full trace onto that half surface with one scale, so every line keeps
// its width once scaled up. At full resolution the box and the drawing are the trace's own.
//
// - A half is rounded up, so the scale back up is never more than the divisor and the drawing never short of the box.
// - A box or a surface with no room is taken as it is, at scale 1: nothing is drawn there either way.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.

/** A trace at half resolution is drawn at 1 / HALF_RESOLUTION_DIVISOR of its box in each direction. */
export const HALF_RESOLUTION_DIVISOR = 2;

/** A scale that leaves a length as it is. */
const UNSCALED = 1;

/**
 * Whether a width and a height have room to draw in: both finite and over 0.
 *
 * @param {number} widthPx - The width.
 * @param {number} heightPx - The height.
 * @returns {boolean} True where they do.
 */
function hasRoom(widthPx, heightPx) {
    return Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0;
}

/**
 * Half a length, rounded up.
 *
 * @param {number} lengthPx - The length, over 0.
 * @returns {number} Its half, whole.
 */
function halfLengthPx(lengthPx) {
    return Math.ceil(lengthPx / HALF_RESOLUTION_DIVISOR);
}

/**
 * Where a trace is allocated and how much Clutter scales it: at half resolution, half its box from its top left and
 * the scale back to the whole box; at full resolution, or with no room, its own box at scale 1.
 *
 * @param {object} trace - The trace.
 * @param {{x: number, y: number, width: number, height: number}} trace.traceBox - Its box (lib/monitorGeometry.js).
 * @param {boolean} trace.isHalfResolution - Whether it is drawn at half resolution (lib/traceRaster.js).
 * @returns {{box: object, scaleX: number, scaleY: number}} The box to allocate it, and its scale in each direction.
 */
export function traceAllocation({traceBox, isHalfResolution}) {
    const {x, y, width, height} = traceBox;
    if (!isHalfResolution || !hasRoom(width, height))
        return {box: traceBox, scaleX: UNSCALED, scaleY: UNSCALED};
    const halfWidthPx = halfLengthPx(width);
    const halfHeightPx = halfLengthPx(height);
    return {
        box: {x, y, width: halfWidthPx, height: halfHeightPx},
        scaleX: width / halfWidthPx,
        scaleY: height / halfHeightPx,
    };
}

/**
 * What a trace's painter draws on its surface: at half resolution, the full drawing's size in device pixels (the
 * surface's, as many times larger as the whole box is than the half one) and the scale that maps it onto the surface;
 * at full resolution, or with no room in the box or on the surface, the surface itself at scale 1.
 *
 * @param {object} drawing - The trace's drawing.
 * @param {{width: number, height: number}} drawing.traceBox - Its whole box (lib/monitorGeometry.js).
 * @param {boolean} drawing.isHalfResolution - Whether it is drawn at half resolution.
 * @param {number} drawing.surfaceWidthPx - Its surface's width, in device pixels.
 * @param {number} drawing.surfaceHeightPx - Its surface's height, in device pixels.
 * @returns {{drawingWidthPx: number, drawingHeightPx: number, scaleX: number, scaleY: number}} The size to draw at,
 *     and the scale that maps it onto the surface.
 */
export function traceDrawing({traceBox, isHalfResolution, surfaceWidthPx, surfaceHeightPx}) {
    const asSurface = {drawingWidthPx: surfaceWidthPx, drawingHeightPx: surfaceHeightPx, scaleX: UNSCALED, scaleY: UNSCALED};
    const {width, height} = traceBox;
    if (!isHalfResolution || !hasRoom(width, height) || !hasRoom(surfaceWidthPx, surfaceHeightPx))
        return asSurface;
    const drawingWidthPx = Math.round(width * surfaceWidthPx / halfLengthPx(width));
    const drawingHeightPx = Math.round(height * surfaceHeightPx / halfLengthPx(height));
    return {
        drawingWidthPx,
        drawingHeightPx,
        scaleX: surfaceWidthPx / drawingWidthPx,
        scaleY: surfaceHeightPx / drawingHeightPx,
    };
}
