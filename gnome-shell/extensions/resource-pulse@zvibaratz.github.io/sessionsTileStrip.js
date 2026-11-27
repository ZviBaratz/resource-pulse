// A session's hour strip in the Sessions tile: one St.DrawingArea a row, SESSION_STRIP_WIDTH_PX by
// SESSION_STRIP_HEIGHT_PX, that paints the track along its foot and the rectangles lib/sessionsTileContent.js gives
// for the row's state history. Shell glue only: what is drawn where is decided there.
//
// - It asks for a repaint only when the history it is handed differs from the one it drew, or as it comes back from
//   absent, so an update that keeps a session's minute asks for none. St repaints a drawing area on its own as well
//   whenever it is restyled: a pointer crossing its row (the row's :hover) does, and so does the shared tooltip's
//   first showing over the tile.
// - A row with no strip (a waiting session's, or a column with no strips) leaves it absent, by opacity and with no
//   width, so the name takes its room (sessionsTileCells.js): shown or hidden by visibility it would draw the tile a
//   second frame. Of no width, it paints nothing.
// - A repaint reads only the area's own surface and the rectangles kept at the last change: no allocation is asked
//   for during a repaint, which can bring the Shell down.
// - Its inks are lib/drawingConstants.js's RGBA constants, as the graphs' are: Cairo reads no stylesheet.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {pixelLengthStyle} from './cockpitTileBase.js';
import {
    SESSION_ROW_CELL_GAP_PX, SESSION_STRIP_HEIGHT_PX, SESSION_STRIP_TRACK_HEIGHT_PX, SESSION_STRIP_TRACK_RGBA,
    SESSION_STRIP_WAITED_RGBA, SESSION_STRIP_WAITING_RGBA, SESSION_STRIP_WIDTH_PX, SESSION_STRIP_WORKING_RGBA,
} from './lib/drawingConstants.js';
import {SessionStripInk, stateStripRectangles} from './lib/sessionsTileContent.js';
import {cellGapStyle, showCell} from './sessionsTileCells.js';

/** A present strip: its gap after the cell before it, a cell a minute of the hour, and the height a wait fills. */
const PRESENT_STRIP_STYLE = cellGapStyle(SESSION_ROW_CELL_GAP_PX) + pixelLengthStyle('width', SESSION_STRIP_WIDTH_PX) +
    pixelLengthStyle('height', SESSION_STRIP_HEIGHT_PX);
/** Each rectangle's ink as [red, green, blue, alpha], each 0–1. */
const RGBA_BY_STRIP_INK = Object.freeze({
    [SessionStripInk.WORKING]: SESSION_STRIP_WORKING_RGBA,
    [SessionStripInk.WAITING]: SESSION_STRIP_WAITING_RGBA,
    [SessionStripInk.WAITED]: SESSION_STRIP_WAITED_RGBA,
});

/**
 * @typedef {object} SessionStrip A row's hour strip.
 * @property {St.DrawingArea} area - Its drawing area.
 * @property {boolean} isPresent - Whether it is present in its row: opaque, with its width.
 * @property {string|null} drawnHistory - The history it drew last; null for none since it came back.
 * @property {Array<object>} rectangles - That history's rectangles, which its repaint reads.
 */

/**
 * Builds a strip, absent and empty: a row shows it with showStripHistory.
 *
 * @returns {SessionStrip} The strip.
 */
export function newSessionStrip() {
    const area = new St.DrawingArea({y_align: Clutter.ActorAlign.CENTER});
    showCell(area, false, PRESENT_STRIP_STYLE);
    const strip = {area, isPresent: false, drawnHistory: null, rectangles: []};
    area.connect('repaint', () => paintSessionStrip(strip));
    return strip;
}

/**
 * Makes a strip present or absent, only when that changed. Coming back, it forgets what it drew, so it is painted
 * again at its width: what it held at no width is not kept.
 *
 * @param {SessionStrip} strip - The strip.
 * @param {boolean} isPresent - True to show it.
 * @returns {void}
 */
function setStripPresent(strip, isPresent) {
    if (strip.isPresent === isPresent)
        return;
    strip.isPresent = isPresent;
    showCell(strip.area, isPresent, PRESENT_STRIP_STYLE);
    if (isPresent)
        strip.drawnHistory = null;
}

/**
 * Shows a state history on a strip, repainting it only when the history differs from the one it drew, or leaves the
 * strip absent for none.
 *
 * @param {SessionStrip} strip - The strip.
 * @param {string|null} stateHistory - The history to draw, one letter a minute; null for no strip.
 * @returns {void}
 */
export function showStripHistory(strip, stateHistory) {
    setStripPresent(strip, stateHistory !== null);
    if (stateHistory === null || strip.drawnHistory === stateHistory)
        return;
    strip.drawnHistory = stateHistory;
    strip.rectangles = stateStripRectangles(stateHistory);
    strip.area.queue_repaint();
}

/**
 * Paints the track and the rectangles of the history the strip was last handed, in the strip's own units: a
 * surface that is not SESSION_STRIP_WIDTH_PX by SESSION_STRIP_HEIGHT_PX (at a scale St applies to the area) is
 * painted to its size; one of no width (absent) paints nothing. The context is freed whatever happens.
 *
 * @param {SessionStrip} strip - The strip being repainted.
 * @returns {void}
 */
function paintSessionStrip(strip) {
    const [surfaceWidthPx, surfaceHeightPx] = strip.area.get_surface_size();
    // Absent, the strip has no width: nothing to paint, and Cairo takes no scale of 0.
    if (surfaceWidthPx === 0 || surfaceHeightPx === 0)
        return;
    const cr = strip.area.get_context();
    try {
        cr.scale(surfaceWidthPx / SESSION_STRIP_WIDTH_PX, surfaceHeightPx / SESSION_STRIP_HEIGHT_PX);
        cr.setSourceRGBA(...SESSION_STRIP_TRACK_RGBA);
        cr.rectangle(0, SESSION_STRIP_HEIGHT_PX - SESSION_STRIP_TRACK_HEIGHT_PX, SESSION_STRIP_WIDTH_PX,
            SESSION_STRIP_TRACK_HEIGHT_PX);
        cr.fill();
        for (const {ink, xPx, yPx, widthPx, heightPx} of strip.rectangles) {
            cr.setSourceRGBA(...RGBA_BY_STRIP_INK[ink]);
            cr.rectangle(xPx, yPx, widthPx, heightPx);
            cr.fill();
        }
    } finally {
        cr.$dispose();
    }
}
