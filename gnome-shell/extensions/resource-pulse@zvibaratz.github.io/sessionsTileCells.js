// How a cell inside a slot of the Sessions tile comes and goes while its slot stays shown: a row's context tag and
// strip, a labels row's strip axis, the header's state counts and memory. Shell glue only.
//
// - A cell is switched by opacity, never by visibility: a leaf shown or hidden by visibility in a render draws the
//   tile a second frame, and an opacity change does not (cockpitTileBase.js setActorOpaque). Whole slots are still
//   shown and hidden by visibility.
// - An absent cell has no gap and no width, so the cells beside it take its room, as they would if it were hidden.
//   A box that holds such a cell sets no spacing, which it would put before an absent cell too: each cell carries
//   its own gap, as its left margin, while it is present.
import {pixelLengthStyle, setActorOpaque, setActorStyle} from './cockpitTileBase.js';
import {SESSION_CELL_NO_ROOM_PX} from './lib/drawingConstants.js';

/** An absent cell's inline style: no gap before it and no width. */
const ABSENT_CELL_STYLE = pixelLengthStyle('margin-left', SESSION_CELL_NO_ROOM_PX) +
    pixelLengthStyle('width', SESSION_CELL_NO_ROOM_PX);

/**
 * A present cell's gap after the cell before it, as its inline left margin.
 *
 * @param {number} gapPx - The gap.
 * @returns {string} The inline style.
 */
export function cellGapStyle(gapPx) {
    return pixelLengthStyle('margin-left', gapPx);
}

/**
 * Shows a cell present, with its own inline style, or absent: transparent, with no gap and no width. Each part is set
 * only when it changed; the cell stays visible either way.
 *
 * @param {St.Widget} cell - The cell, visible.
 * @param {boolean} isPresent - True to show it.
 * @param {string} presentStyle - Its inline style while present: its gap and any length of its own.
 * @returns {void}
 */
export function showCell(cell, isPresent, presentStyle) {
    setActorStyle(cell, isPresent ? presentStyle : ABSENT_CELL_STYLE);
    setActorOpaque(cell, isPresent);
}
