// A group's caption plate: the group's caption and then its annunciators, one cell each, on a dark surface of its
// own. Shell glue only: what each cell says and how it is drawn (its words, its shape's class, its room) comes finished
// from lib/plateCells.js, and where the plate stands and how wide it is from the composition; the plate only assigns
// them.
//
// - Built once: its captions are fixed by its group, so a layout that changes them builds new plates. Its size, its
//   form and its measured lengths (the count slot, a cell's height) come in one setLayout, as a tile's do, so a text
//   size change needs no new plate. No update makes or destroys an actor.
// - Every length it draws is one the legend adds (lib/plateCells.js PLATE_BOX_LENGTHS_PX), so where the composition
//   gives it its legend's width, its cells fill it exactly.
// - A cell keeps one size in every shape: lit and unlit swap its shape class, so a change of what is lit draws one
//   frame and moves nothing beside it. In the short form an unlit cell's words go transparent and the cell takes no
//   room by its inline style (no width, padding, border or gap): a leaf shown or hidden by visibility would cost a
//   second frame.
// - It is drawn as a tile is: non-reactive, clipped to its own edge, through its own offscreen texture. Frozen (a
//   window covers it), an update is only recorded and its content (never its surface) is dimmed; the reveal undims it
//   and draws the latest, and repaintFrozen() draws it still dimmed (lib/tileRenderGate.js decides when).
// - No label of it ellipsizes: St cuts a letter-spaced label short of its own natural width, and a plate given its
//   legend's width must draw every word it was measured with.
// - Nothing in it takes the pointer, and no rule of its block has a transition.
//
// After destroy every call does nothing.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {pixelLengthStyle, setActorOpaque, setActorStyle, setLabelText, swapStyleClass} from './cockpitTileBase.js';
import {FROZEN_CONTENT_OPACITY} from './lib/drawingConstants.js';
import {LineKind, TILE_TEXT_CLASS} from './lib/measuredLengths.js';
import {CELL_SHAPE_STYLE_CLASSES, CellShape, PLATE_BOX_LENGTHS_PX, plateCellsOf} from './lib/plateCells.js';
import {TileRenderGate} from './lib/tileRenderGate.js';

/** The plate's surface and the tiles' font, on its root. */
const PLATE_ROOT_STYLE_CLASS = `rp-caption-plate ${TILE_TEXT_CLASS}`;
const GROUP_CAPTION_STYLE_CLASS = `${LineKind.GROUP_CAPTION} rp-plate-group-caption`;
const CELL_STYLE_CLASS = 'rp-plate-cell';
const OPAQUE_OPACITY = 255;

/** The plate's border and its paddings, inline from the lengths the legend adds. */
const PLATE_ROOT_STYLE = pixelLengthStyle('border-width', PLATE_BOX_LENGTHS_PX.plateBorderPx) +
    pixelLengthStyle('padding-left', PLATE_BOX_LENGTHS_PX.plateStartPaddingPx) +
    pixelLengthStyle('padding-right', PLATE_BOX_LENGTHS_PX.plateEndPaddingPx);
/** The group caption's gap before the first cell's own. */
const GROUP_CAPTION_STYLE = pixelLengthStyle('margin-right', PLATE_BOX_LENGTHS_PX.groupCaptionGapPx);

/**
 * @typedef {object} PlateCellActors One cell's actors and what they show.
 * @property {St.Bin} cell - The cell: its border, padding and gap.
 * @property {St.Label} label - Its words.
 * @property {string|null} shapeStyleClass - The shape class it carries.
 */

/**
 * @typedef {object} PlateLayout Where the composition puts a plate, and the lengths measured for it.
 * @property {number} widthPx - The plate's width: its legend's, or its group's where the legend is wider.
 * @property {number} heightPx - The plate's height, the sheet's `plate.heightPx`.
 * @property {boolean} isLegendShort - The plate is wider than its group, so shows its lit cells only.
 * @property {number|null} countSlotWidthPx - The measured "Waiting on you" slot, a cell's whole width; null where
 *     unknown.
 * @property {number|null} cellHeightPx - A cell's whole height: ANNUNCIATOR_CELL_FIXED_HEIGHT_PX and the
 *     annunciator's line box, from the read the sheet came from; null where unknown.
 */

/**
 * A cell's room as its inline style: each length lib/plateCells.js gives it, a pixel length, in their order.
 *
 * @param {Object<string, number>} cellLengthsPx - The cell's lengths by CSS property (lib/plateCells.js PlateCell).
 * @returns {string} The style.
 */
function cellLengthsStyle(cellLengthsPx) {
    return Object.entries(cellLengthsPx).map(([property, lengthPx]) => pixelLengthStyle(property, lengthPx))
        .join('');
}

/**
 * Makes a label that never ellipsizes, centred in its height, so it draws the whole width it was measured at.
 *
 * @param {string} styleClass - Its classes.
 * @param {object} [extraProperties] - More St.Label properties.
 * @returns {St.Label} The label, with no text yet.
 */
function newUncutLabel(styleClass, extraProperties = {}) {
    const label = new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...extraProperties});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

/**
 * Whether two layouts are the same.
 *
 * @param {PlateLayout} layout - One layout.
 * @param {PlateLayout|null} otherLayout - The other, or null for none yet.
 * @returns {boolean} True when every field is the same.
 */
function isSameLayout(layout, otherLayout) {
    return otherLayout !== null && Object.keys(layout).every(fieldName => layout[fieldName] === otherLayout[fieldName]);
}

export const CockpitCaptionPlate = GObject.registerClass(
class CockpitCaptionPlate extends St.BoxLayout {
    /**
     * Builds the plate with every cell unlit, unfrozen and unsized: the composition lays it out.
     *
     * @param {object} options - The plate's options.
     * @param {import('./lib/plateCaptions.js').PlateCaptions} options.plateCaptions - Its captions and the cards its
     *     group draws, one group's (lib/plateCaptions.js plateCaptionsByGroup).
     * @returns {void}
     */
    _init({plateCaptions}) {
        super._init({
            style_class: PLATE_ROOT_STYLE_CLASS,
            style: PLATE_ROOT_STYLE,
            reactive: false,
            clip_to_allocation: true,
        });
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        // Every field the destroy handler reads is set before anything below can throw.
        this._isDestroyed = false;
        this._plateCaptions = plateCaptions;
        this._lights = null;
        /** @type {PlateLayout|null} */
        this._layout = null;
        this._renderGate = new TileRenderGate();
        // The content dims while frozen, drawn through a texture of its own only then; the surface stays.
        this._contentBox = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, y_expand: true});
        this._contentBox.set_offscreen_redirect(Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY);
        this._groupCaptionLabel = newUncutLabel(GROUP_CAPTION_STYLE_CLASS, {style: GROUP_CAPTION_STYLE});
        this._contentBox.add_child(this._groupCaptionLabel);
        /** @type {PlateCellActors[]} */
        this._cells = plateCaptions.captions.map(() => this._buildCell());
        this.add_child(this._contentBox);
        this.connect('notify::mapped', () => this._onMappedChanged());
        this.connect('destroy', () => {
            this._isDestroyed = true;
        });
        this._recordRender();
    }

    /**
     * Builds one cell, unlit, and puts it after the others. The first draw gives it its words and its room.
     *
     * @returns {PlateCellActors} Its actors.
     */
    _buildCell() {
        const label = newUncutLabel(LineKind.ANNUNCIATOR, {x_align: Clutter.ActorAlign.CENTER});
        const shapeStyleClass = CELL_SHAPE_STYLE_CLASSES[CellShape.UNLIT];
        const cell = new St.Bin({
            style_class: `${CELL_STYLE_CLASS} ${shapeStyleClass}`, y_align: Clutter.ActorAlign.CENTER, child: label,
        });
        this._contentBox.add_child(cell);
        return {cell, label, shapeStyleClass};
    }

    /**
     * Lays the plate out: its size at once (frozen too, since its size is not data), and its form and its cells'
     * lengths at its next draw. The same layout again touches nothing.
     *
     * @param {PlateLayout} layout - The composition's place for it and the lengths measured for it.
     * @returns {void}
     */
    setLayout({widthPx, heightPx, isLegendShort, countSlotWidthPx, cellHeightPx}) {
        const layout = {widthPx, heightPx, isLegendShort, countSlotWidthPx, cellHeightPx};
        if (this._isDestroyed || isSameLayout(layout, this._layout))
            return;
        this._layout = layout;
        this.set_size(widthPx, heightPx);
        this._recordRender();
    }

    /**
     * Shows what is lit. The same lights again, by identity, touch nothing, so a caller that hands out the same object
     * until something lights or unlights draws only on a change.
     *
     * @param {import('./lib/cockpitCaptions.js').CaptionsLit|null} lights - What is lit, the indicator's one answer
     *     (lib/cockpitCaptions.js litCaptionsOf), which it keeps the same object while nothing changes; null for
     *     nothing.
     * @returns {void}
     */
    setLights(lights) {
        if (this._isDestroyed || lights === this._lights)
            return;
        this._lights = lights;
        this._recordRender();
    }

    /**
     * Freezes the plate while a window covers it, or unfreezes it on the reveal. Freezing only dims its content;
     * unfreezing undims it and draws an update recorded meanwhile. Setting the state it has does nothing.
     *
     * @param {boolean} isFrozen - True while covered.
     * @returns {void}
     */
    setFrozen(isFrozen) {
        if (this._isDestroyed || isFrozen === this._renderGate.isFrozen)
            return;
        this._contentBox.opacity = isFrozen ? FROZEN_CONTENT_OPACITY : OPAQUE_OPACITY;
        if (this._renderGate.frozenChanged(isFrozen, {isMapped: this.mapped}))
            this._drawCells();
    }

    /**
     * Draws a frozen plate's latest update, still dimmed. Unfrozen, or with nothing recorded since its last draw, it
     * does nothing.
     *
     * @returns {void}
     */
    repaintFrozen() {
        if (!this._isDestroyed && this._renderGate.frozenRepaint({isMapped: this.mapped}))
            this._drawCells();
    }

    /**
     * Records that what the plate shows changed, and draws it now if the gate says (mapped and unfrozen).
     *
     * @returns {void}
     */
    _recordRender() {
        if (this._renderGate.recorded({isMapped: this.mapped}))
            this._drawCells();
    }

    /**
     * Draws the latest as the plate is mapped, if the gate says.
     *
     * @returns {void}
     */
    _onMappedChanged() {
        if (!this._isDestroyed && this._renderGate.mapped({isMapped: this.mapped}))
            this._drawCells();
    }

    /**
     * Draws what the plate shows now: the group caption's words, and each cell's words, shape and room.
     *
     * @returns {void}
     */
    _drawCells() {
        const {groupCaptionText, cells} = plateCellsOf({
            plateCaptions: this._plateCaptions, lights: this._lights, layout: this._layout,
        });
        setLabelText(this._groupCaptionLabel, groupCaptionText);
        cells.forEach(({text, shapeStyleClass, isShown, cellLengthsPx}, cellIndex) => {
            const cellActors = this._cells[cellIndex];
            setLabelText(cellActors.label, text);
            cellActors.shapeStyleClass = swapStyleClass(cellActors.cell, cellActors.shapeStyleClass, shapeStyleClass);
            setActorStyle(cellActors.cell, cellLengthsStyle(cellLengthsPx));
            setActorOpaque(cellActors.label, isShown);
        });
    }
});
