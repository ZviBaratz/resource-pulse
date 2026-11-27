// One session's row in the Sessions tile: its state's mark, its name, its context tag, its hour strip, its idle age
// and its memory, and on a waiting session's row a lift with an amber edge and the age in an amber cell. Shell glue
// only: every word comes finished from lib/sessionsTileContent.js and every length from lib/drawingConstants.js.
//
// - Built once, hidden, and reused for whichever session the tile gives it: showing a session sets each part only
//   when it changed, so a row that keeps its session through an update sets nothing, and a row moved to another
//   place is only moved.
// - A waiting row keeps one height in every column (the length the flow counts for it); where its column has no
//   strips its name is drawn at the rows' size, heavier, so it is the last thing cut.
// - The age and the memory each take their column's text width, so the cells line up down a column; a waiting row's
//   amber age cell takes its own width, its right edge where the others' is.
// - A long-idle row is dimmed by its actor's opacity, since St reads no CSS opacity.
// - The wait edge, the context tag and the strip come and go by opacity, each left visible (sessionsTileCells.js):
//   an absent tag or strip takes no room, so the name takes it. The cells' box sets no spacing; each cell after the
//   mark carries its own gap.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    pixelLengthStyle, setActorOpaque, setActorStyle, setLabelText, swapStyleClass,
} from './cockpitTileBase.js';
import {
    COCKPIT_LONG_IDLE_ROW_OPACITY, CONTEXT_TAG_PADDING_INLINE_PX, SESSION_MARK_SIZE_PX, SESSION_ROW_CELL_GAP_PX,
    SESSION_ROW_PADDING_INLINE_PX, WAIT_EDGE_WIDTH_PX, WAITING_AGE_CELL_PADDING_BLOCK_PX,
    WAITING_AGE_CELL_PADDING_INLINE_PX,
} from './lib/drawingConstants.js';
import {LineKind} from './lib/measuredLengths.js';
import {cellGapStyle, showCell} from './sessionsTileCells.js';
import {newSessionStrip, showStripHistory} from './sessionsTileStrip.js';

const OPAQUE_OPACITY = 255;
const ROW_STYLE_CLASS = 'rp-sessions-row';
const WAITING_ROW_STYLE_CLASS = 'rp-sessions-row rp-sessions-row-waiting';
const NAME_STYLE_CLASS = `${LineKind.ROW} rp-sessions-name`;
const WAITING_NAME_STYLE_CLASS = `${LineKind.WAITING_NAME} rp-sessions-name rp-sessions-name-waiting`;
const NARROW_WAITING_NAME_STYLE_CLASS = `${LineKind.ROW} rp-sessions-name rp-sessions-name-waiting`;
const AGE_STYLE_CLASS = `${LineKind.ROW} rp-sessions-age`;
const WAITING_AGE_STYLE_CLASS = `${LineKind.WAITING_AGE} rp-sessions-waiting-age`;
const MEMORY_STYLE_CLASS = `${LineKind.ROW} rp-sessions-memory`;
const CONTEXT_TAG_STYLE_CLASS = `${LineKind.LABEL} rp-sessions-context-tag`;
const HIGH_CONTEXT_TAG_STYLE_CLASS = 'rp-sessions-context-tag-high';
const WAIT_EDGE_STYLE_CLASS = 'rp-sessions-wait-edge';
/** A cell's gap after the one before it: every cell's but the mark's, each while it is present. */
const CELL_GAP_STYLE = cellGapStyle(SESSION_ROW_CELL_GAP_PX);
/** The amber cell's gap, and its room around a waiting session's age. */
const WAITING_AGE_CELL_STYLE = CELL_GAP_STYLE + pixelLengthStyle('padding-top', WAITING_AGE_CELL_PADDING_BLOCK_PX) +
    pixelLengthStyle('padding-bottom', WAITING_AGE_CELL_PADDING_BLOCK_PX) +
    pixelLengthStyle('padding-left', WAITING_AGE_CELL_PADDING_INLINE_PX) +
    pixelLengthStyle('padding-right', WAITING_AGE_CELL_PADDING_INLINE_PX);
/** The outlined context tag's gap, and its room at each side of its words. */
const HIGH_CONTEXT_TAG_STYLE = CELL_GAP_STYLE + pixelLengthStyle('padding-left', CONTEXT_TAG_PADDING_INLINE_PX) +
    pixelLengthStyle('padding-right', CONTEXT_TAG_PADDING_INLINE_PX);
/** A row's cells: its side padding, and no spacing, since each cell carries its own gap. */
const ROW_CELLS_STYLE = pixelLengthStyle('padding-left', SESSION_ROW_PADDING_INLINE_PX) +
    pixelLengthStyle('padding-right', SESSION_ROW_PADDING_INLINE_PX);

/**
 * A label that never ellipsizes: a value, which its column's text width holds whole, after its gap.
 *
 * @param {string} styleClass - Its classes.
 * @returns {St.Label} The label, empty.
 */
function newValueLabel(styleClass) {
    const label = new St.Label({style_class: styleClass, style: CELL_GAP_STYLE, y_align: Clutter.ActorAlign.CENTER});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

/**
 * Sets an actor's whole class list only when it changed (St restyles on every assignment).
 *
 * @param {St.Widget} actor - The actor.
 * @param {string} styleClass - Its classes.
 * @returns {void}
 */
function setStyleClassName(actor, styleClass) {
    if (actor.style_class !== styleClass)
        actor.style_class = styleClass;
}

/**
 * A name's classes: the rows' line; a waiting session's in its own larger line where its column has strips, and in
 * the rows' line, heavier, where it has none.
 *
 * @param {boolean} isWaiting - Whether the session waits on you.
 * @param {boolean} hasStripColumn - Whether its column has strips.
 * @returns {string} The classes.
 */
function nameStyleClass(isWaiting, hasStripColumn) {
    if (!isWaiting)
        return NAME_STYLE_CLASS;
    return hasStripColumn ? WAITING_NAME_STYLE_CLASS : NARROW_WAITING_NAME_STYLE_CLASS;
}

/**
 * One row slot of the Sessions tile. The tile's columns place it (setPlace) and show a session in it (showSession);
 * its actor is a hover row of the tile, whose base lights it, shows its tooltip and takes its click.
 */
export class SessionsTileRow {
    /**
     * Builds the row, hidden, with no session.
     *
     * @returns {void}
     */
    constructor() {
        /** @type {string|null} The session the row shows, or last showed. */
        this.sessionId = null;
        this.actor = new St.Widget({
            style_class: ROW_STYLE_CLASS, layout_manager: new Clutter.BinLayout(), track_hover: true,
            reactive: false, visible: false,
        });
        // A BinLayout keeps a child's alignment only on an axis where the child expands, and centres it on any
        // other: the edge expands both ways, so it stands at the row's left edge at its own width.
        this._waitEdge = new St.Widget({
            style_class: WAIT_EDGE_STYLE_CLASS, style: pixelLengthStyle('width', WAIT_EDGE_WIDTH_PX),
            x_align: Clutter.ActorAlign.START, x_expand: true, y_align: Clutter.ActorAlign.FILL, y_expand: true,
        });
        setActorOpaque(this._waitEdge, false);
        const cells = new St.BoxLayout({style: ROW_CELLS_STYLE, x_expand: true, y_expand: true});
        this._mark = new St.Icon({icon_size: SESSION_MARK_SIZE_PX, y_align: Clutter.ActorAlign.CENTER});
        this._markStyleClass = null;
        this._name = new St.Label({
            style_class: NAME_STYLE_CLASS, style: CELL_GAP_STYLE, x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        });
        this._name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._contextTag = newValueLabel(CONTEXT_TAG_STYLE_CLASS);
        showCell(this._contextTag, false, CELL_GAP_STYLE);
        this._highContextTagStyleClass = null;
        this._strip = newSessionStrip();
        this._age = newValueLabel(AGE_STYLE_CLASS);
        this._memory = newValueLabel(MEMORY_STYLE_CLASS);
        /** @type {number|null} The column's text width of the age, set by setTextWidths; null for its natural width. */
        this._ageWidthPx = null;
        this._isWaiting = false;
        const cellActors = [
            this._mark, this._name, this._contextTag, this._strip.area, this._age, this._memory,
        ];
        for (const cell of cellActors)
            cells.add_child(cell);
        this.actor.add_child(cells);
        this.actor.add_child(this._waitEdge);
        /** The place the row was last given, to move it only when it changes. */
        this._place = {xPx: null, yPx: null, widthPx: null, heightPx: null};
    }

    /**
     * Sets the widths the age and the memory take: the column's text widths, so the values line up down a column.
     *
     * @param {{age: number, memory: number}} textWidthsPx - The sample widths, whole.
     * @returns {void}
     */
    setTextWidths({age, memory}) {
        this._ageWidthPx = age;
        this._showAgeCell();
        setActorStyle(this._memory, CELL_GAP_STYLE + pixelLengthStyle('width', memory));
    }

    /**
     * Sizes the age's cell after its gap: a waiting session's amber cell takes its words' width and its own room
     * around them; any other age takes the column's text width, so the ages line up down a column.
     *
     * @returns {void}
     */
    _showAgeCell() {
        if (this._isWaiting)
            setActorStyle(this._age, WAITING_AGE_CELL_STYLE);
        else
            setActorStyle(this._age, this._ageWidthPx === null ? CELL_GAP_STYLE
                : CELL_GAP_STYLE + pixelLengthStyle('width', this._ageWidthPx));
    }

    /**
     * Places the row in the tile's columns, moving or sizing it only when its place changed.
     *
     * @param {{xPx: number, yPx: number, widthPx: number, heightPx: number}} place - Its place in the columns' area.
     * @returns {boolean} Whether the row moved or changed size.
     */
    setPlace({xPx, yPx, widthPx, heightPx}) {
        const place = this._place;
        const hasMoved = place.xPx !== xPx || place.yPx !== yPx;
        const hasResized = place.widthPx !== widthPx || place.heightPx !== heightPx;
        if (hasMoved)
            this.actor.set_position(xPx, yPx);
        if (hasResized)
            this.actor.set_size(widthPx, heightPx);
        this._place = {xPx, yPx, widthPx, heightPx};
        return hasMoved || hasResized;
    }

    /**
     * Shows a session's row content, setting each part only when it changed.
     *
     * @param {object} content - What the row shows (lib/sessionsTileContent.js sessionRowContent).
     * @param {boolean} hasStripColumn - Whether the row's column has strips.
     * @returns {void}
     */
    showSession(content, hasStripColumn) {
        this.sessionId = content.id;
        this._showWaiting(content.isWaiting, hasStripColumn);
        if (this._mark.icon_name !== content.iconName)
            this._mark.icon_name = content.iconName;
        this._markStyleClass = swapStyleClass(this._mark, this._markStyleClass, `rp-sessions-mark-${content.state}`);
        setLabelText(this._name, content.name);
        this._showContextTag(content.contextTag);
        showStripHistory(this._strip, content.stripHistory);
        setLabelText(this._age, content.ageText);
        setLabelText(this._memory, content.memoryText);
        const opacity = content.isLongIdle ? COCKPIT_LONG_IDLE_ROW_OPACITY : OPAQUE_OPACITY;
        if (this.actor.opacity !== opacity)
            this.actor.opacity = opacity;
    }

    /**
     * Draws the row as a waiting row or an ordinary one: the lift and its edge, the name's line, and the age's cell.
     *
     * @param {boolean} isWaiting - Whether the session waits on you.
     * @param {boolean} hasStripColumn - Whether the row's column has strips.
     * @returns {void}
     */
    _showWaiting(isWaiting, hasStripColumn) {
        setStyleClassName(this._name, nameStyleClass(isWaiting, hasStripColumn));
        if (isWaiting === this._isWaiting)
            return;
        this._isWaiting = isWaiting;
        setStyleClassName(this.actor, isWaiting ? WAITING_ROW_STYLE_CLASS : ROW_STYLE_CLASS);
        setActorOpaque(this._waitEdge, isWaiting);
        setStyleClassName(this._age, isWaiting ? WAITING_AGE_STYLE_CLASS : AGE_STYLE_CLASS);
        this._showAgeCell();
    }

    /**
     * Shows the row's context tag, outlined from the caution percent, or leaves it absent: transparent and of no
     * width, so the name takes its room.
     *
     * @param {{text: string, isHigh: boolean}|null} contextTag - The tag, or null for none.
     * @returns {void}
     */
    _showContextTag(contextTag) {
        if (contextTag === null) {
            showCell(this._contextTag, false, CELL_GAP_STYLE);
            return;
        }
        setLabelText(this._contextTag, contextTag.text);
        const highStyleClass = contextTag.isHigh ? HIGH_CONTEXT_TAG_STYLE_CLASS : null;
        this._highContextTagStyleClass = swapStyleClass(this._contextTag, this._highContextTagStyleClass,
            highStyleClass);
        showCell(this._contextTag, true, contextTag.isHigh ? HIGH_CONTEXT_TAG_STYLE : CELL_GAP_STYLE);
    }
}
