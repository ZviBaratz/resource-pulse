// What every cockpit tile shares: the tile's surface and its padding, the frozen state and its dimming, the
// interactive state, its title, the no-data line, the shared tooltip on its hover rows, and destroy. Shell glue only:
// every word and length comes finished from a pure module (lib/), and a tile only assigns it.
//
// - A title is one actor above the data, which stays while the no-data line shows: a label (_addTitleLabel), or a
//   header box of the tile's own (_addTitleActor).
// - A tile is a vertical box carrying the tile surface and the tiles' font (rp-tile-surface rp-tile-text) and its own
//   class, padded from lib/drawingConstants.js, built non-reactive, clipped to its own edge and drawn through its own
//   offscreen texture, so a window drawn over it paints one cached rectangle. No tile paints itself.
// - Its actors are built with it and reused: an update sets a text, a class, a style or a visibility, each only when
//   it changed. No update makes or destroys an actor.
// - Every update and layout is recorded as a render, and lib/tileRenderGate.js says when to draw it. Frozen (a window
//   covers it), an update is only recorded; the content (never the surface) is dimmed by its actor opacity, since St
//   reads no CSS opacity. The reveal undims it and draws the latest at once; repaintFrozen() draws it still dimmed. A
//   tile that is not mapped draws nothing either, since a render measures text as St styles it: the latest is drawn
//   as the tile is mapped. A tile that never drew draws, frozen or not, as soon as it is mapped with a render
//   recorded, whichever comes first, so it need not record one before it is first mapped.
// - Interactive (setInteractive) only while nothing covers the desktop: its hover rows then take the pointer, light on
//   hover (their :hover rule) and show their tooltip; a row given an id takes a primary-button click, which calls the
//   tile's onRowActivated with that id. A row may join after construction (at a later placement): it takes the
//   tile's interactive state as it joins, and leaves the tile's rows as it is destroyed. No leave-event is promised for
//   a row hidden, or moved from under the pointer: a tile hides one through _hideHoverRow; calls
//   _hideTooltipIfHovered for a row it moves or hides with the box that holds it, after any _showHoverRow of that
//   row in the same render; and calls _hideTooltipIfAnyRowHovered for a layout that moves its rows.
// - Hover rows live in the data box or in a header box added through _addTitleActor; hiding the data hides the
//   tooltip only for a row in the data box, so a header row keeps its own.
// - A placement while frozen sets the tile's size at once (its size is not data) and only records its render.
//
// Destroying a tile hides the shared tooltip, which may point at one of its rows; its handlers go with it, and a call
// after it does nothing.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {
    FROZEN_CONTENT_OPACITY, TILE_PADDING_BLOCK_PX, TILE_PADDING_INLINE_PX,
} from './lib/drawingConstants.js';
import {LineKind, TILE_TEXT_CLASS} from './lib/measuredLengths.js';
import {TileRenderGate} from './lib/tileRenderGate.js';

/** The tile surface and the tiles' font, on every tile's root beside its own class. */
const TILE_ROOT_STYLE_CLASS = `rp-tile-surface ${TILE_TEXT_CLASS}`;
const OPAQUE_OPACITY = 255;

/**
 * Sets a label's text only when it changed (St relayouts on every assignment).
 *
 * @param {St.Label} label - The label.
 * @param {string} text - Its text.
 * @returns {void}
 */
export function setLabelText(label, text) {
    if (label.text !== text)
        label.text = text;
}

/**
 * Shows or hides an actor only when its visibility changed.
 *
 * @param {Clutter.Actor} actor - The actor.
 * @param {boolean} isVisible - True to show it.
 * @returns {void}
 */
export function setActorVisible(actor, isVisible) {
    if (actor.visible !== isVisible)
        actor.visible = isVisible;
}

/**
 * Sets an actor's inline style only when it changed (St restyles on every assignment).
 *
 * @param {St.Widget} actor - The actor.
 * @param {string} style - Its inline style.
 * @returns {void}
 */
export function setActorStyle(actor, style) {
    if (actor.style !== style)
        actor.style = style;
}

/**
 * Swaps one of an actor's classes for another of the same kind (an ink, say), only when it changed.
 *
 * @param {St.Widget} actor - The actor.
 * @param {string|null} oldStyleClass - The class it carries of that kind, or null.
 * @param {string|null} newStyleClass - The class it is to carry, or null.
 * @returns {string|null} The class it now carries, to pass as oldStyleClass next time.
 */
export function swapStyleClass(actor, oldStyleClass, newStyleClass) {
    if (oldStyleClass === newStyleClass)
        return newStyleClass;
    if (oldStyleClass !== null)
        actor.remove_style_class_name(oldStyleClass);
    if (newStyleClass !== null)
        actor.add_style_class_name(newStyleClass);
    return newStyleClass;
}

/**
 * A pixel length as an inline style declaration.
 *
 * @param {string} property - The CSS property.
 * @param {number} lengthPx - The length.
 * @returns {string} For example 'width: 96px;'.
 */
export function pixelLengthStyle(property, lengthPx) {
    return `${property}: ${lengthPx}px;`;
}

/**
 * Whether two lists of tooltip lines are the same.
 *
 * @param {string[]} lines - One list.
 * @param {string[]} otherLines - The other.
 * @returns {boolean} True when they hold the same lines in the same order.
 */
function areSameLines(lines, otherLines) {
    return lines.length === otherLines.length && lines.every((line, lineIndex) => line === otherLines[lineIndex]);
}

/**
 * @typedef {object} HoverRow An actor of a tile that lights on hover and shows a tooltip.
 * @property {St.Widget} actor - The row.
 * @property {string[]} tooltipLines - Its tooltip's lines; none shows no tooltip.
 * @property {string|null} rowId - What a click on it activates; null for a row that takes no click.
 */

/**
 * The base of every cockpit tile. A tile adds its title through _addTitleLabel or _addTitleActor, its views to the
 * data box (_dataBox) and its hover rows through _addHoverRow, records each render through _renderUnlessFrozen, hides a
 * row through _hideHoverRow, and calls _hideTooltipIfHovered for a row it moves.
 */
export const CockpitTileBase = GObject.registerClass(
class CockpitTileBase extends St.BoxLayout {
    /**
     * Builds the tile, empty: a tile adds its views to the data box. It starts unfrozen and non-interactive.
     *
     * @param {object} options - The tile's options.
     * @param {import('./cockpitTooltip.js').CockpitTooltip} options.tooltip - The tooltip every tile shares; the tile
     *     only calls its showFor() and hide().
     * @param {string} options.tileStyleClass - The tile's own class, beside the surface's.
     * @param {string} options.noDataStyleClass - The no-data line's own class, beside the row line's.
     * @param {number} [options.paddingBlockPx] - The padding inside the border, above and below.
     * @param {number} [options.paddingInlinePx] - The padding inside the border, on each side.
     * @param {number} [options.noDataInlineInsetPx] - How far the no-data line stands in from the padding, each side.
     * @param {function(string): void|null} [options.onRowActivated] - Called with a row's id when the row is clicked;
     *     null for a tile whose rows take no click.
     * @returns {void}
     */
    _init({
        tooltip, tileStyleClass, noDataStyleClass, paddingBlockPx = TILE_PADDING_BLOCK_PX,
        paddingInlinePx = TILE_PADDING_INLINE_PX, noDataInlineInsetPx = 0, onRowActivated = null,
    }) {
        const paddingStyle = pixelLengthStyle('padding-top', paddingBlockPx) +
            pixelLengthStyle('padding-bottom', paddingBlockPx) + pixelLengthStyle('padding-left', paddingInlinePx) +
            pixelLengthStyle('padding-right', paddingInlinePx);
        super._init({
            style_class: `${TILE_ROOT_STYLE_CLASS} ${tileStyleClass}`,
            style: paddingStyle,
            orientation: Clutter.Orientation.VERTICAL,
            reactive: false,
            clip_to_allocation: true,
        });
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        // Every field _onDestroy reads is set before anything below can throw.
        this._tooltip = tooltip;
        this._onRowActivated = onRowActivated;
        /** @type {HoverRow[]} */
        this._hoverRows = [];
        this._isInteractive = false;
        this._isDestroyed = false;
        /** @type {(function(): void)|null} The latest render, drawn when the gate says. */
        this._latestRender = null;
        this._renderGate = new TileRenderGate();
        this._widthPx = null;
        this._heightPx = null;
        // The content dims while frozen; drawn through a texture of its own only then, so a bar over its track is
        // blended once.
        // Both fill the tile, so a view may centre itself in its height; a vertical box packs from the top, so spare
        // height stays under the content.
        this._contentBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true,
        });
        this._contentBox.set_offscreen_redirect(Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY);
        this._dataBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});
        this._noDataLabel = new St.Label({
            style_class: `${LineKind.ROW} ${noDataStyleClass}`, visible: false,
            style: pixelLengthStyle('margin-left', noDataInlineInsetPx) +
                pixelLengthStyle('margin-right', noDataInlineInsetPx),
        });
        this._contentBox.add_child(this._dataBox);
        this._contentBox.add_child(this._noDataLabel);
        this.add_child(this._contentBox);
        this.connect('notify::mapped', () => this._onMappedChanged());
        this.connect('destroy', () => this._onDestroy());
    }

    /**
     * Sizes the tile, only when its size changed. A frozen tile is resized too: its size is not data.
     *
     * @param {number} widthPx - The tile's width.
     * @param {number} heightPx - The tile's height.
     * @returns {void}
     */
    setTileSize(widthPx, heightPx) {
        if (this._isDestroyed || (widthPx === this._widthPx && heightPx === this._heightPx))
            return;
        this._widthPx = widthPx;
        this._heightPx = heightPx;
        this.set_size(widthPx, heightPx);
    }

    /**
     * Freezes the tile while a window covers it, or unfreezes it on the reveal. Freezing only dims its content;
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
            this._latestRender();
    }

    /**
     * Draws a frozen tile's latest update, still dimmed, so a tile misjudged as covered reads as stale, never as
     * live. Unfrozen, or with nothing recorded since its last draw, it does nothing.
     *
     * @returns {void}
     */
    repaintFrozen() {
        if (!this._isDestroyed && this._renderGate.frozenRepaint({isMapped: this.mapped}))
            this._latestRender();
    }

    /**
     * Lets the tile and its hover rows take the pointer, or not: under a window or ding's desktop a tile is
     * display-only, with no hover. A tile that stops taking the pointer hides the tooltip.
     *
     * @param {boolean} isInteractive - True while nothing covers the desktop.
     * @returns {void}
     */
    setInteractive(isInteractive) {
        if (this._isDestroyed)
            return;
        this._isInteractive = isInteractive;
        this.reactive = isInteractive;
        for (const hoverRow of this._hoverRows)
            hoverRow.actor.reactive = isInteractive;
        if (!isInteractive)
            this._tooltip?.hide();
    }

    /**
     * Shows one muted line ("no data" or "no data since HH:MM", say) in place of the tile's data. Frozen, it is only
     * recorded, as an update is.
     *
     * @param {string} text - The line.
     * @returns {void}
     */
    showNoData(text) {
        if (!this._isDestroyed)
            this._renderUnlessFrozen(() => this._renderNoData(text));
    }

    /**
     * Adds the tile's title, a label, above its data, where it stays while the no-data line is shown.
     *
     * @param {string} text - The title.
     * @param {string} styleClass - The title's classes.
     * @returns {St.Label} The title.
     */
    _addTitleLabel(text, styleClass) {
        const titleLabel = new St.Label({style_class: styleClass, text});
        this._addTitleActor(titleLabel);
        return titleLabel;
    }

    /**
     * Adds the tile's title above its data, where it stays while the no-data line is shown: a label, or a header box
     * of the tile's own (a title with counts beside it, say), which the tile fills and updates itself. A tile has one.
     *
     * @param {Clutter.Actor} titleActor - The title.
     * @returns {void}
     */
    _addTitleActor(titleActor) {
        this._contentBox.insert_child_at_index(titleActor, 0);
    }

    /**
     * Records the tile's latest render, and draws it now if the gate says (mapped and unfrozen); else the reveal, the
     * frozen repaint or the tile being mapped draws it.
     *
     * @param {function(): void} render - Draws what the tile shows now.
     * @returns {void}
     */
    _renderUnlessFrozen(render) {
        this._latestRender = render;
        if (this._renderGate.recorded({isMapped: this.mapped}))
            render();
    }

    /**
     * Draws the latest render as the tile is mapped, if the gate says: one that waited for the mapping.
     *
     * @returns {void}
     */
    _onMappedChanged() {
        if (!this._isDestroyed && this._renderGate.mapped({isMapped: this.mapped}))
            this._latestRender();
    }

    /**
     * Draws the latest render again, if the tile can: a new layout changes what it draws, though the data has not.
     *
     * @returns {void}
     */
    _redrawLatestRender() {
        if (!this._isDestroyed && this._latestRender !== null)
            this._renderUnlessFrozen(this._latestRender);
    }

    /**
     * Shows the tile's data or its no-data line, never both. No leave-event reaches a row hidden with the box that
     * holds it, so hiding the data while one of this tile's rows is hovered hides the tooltip.
     *
     * @param {boolean} isDataShown - True to show the data.
     * @returns {void}
     */
    _setDataShown(isDataShown) {
        if (!isDataShown && this._dataBox.visible && this._hasHoveredDataRow())
            this._tooltip.hide();
        setActorVisible(this._dataBox, isDataShown);
        setActorVisible(this._noDataLabel, !isDataShown);
    }

    /**
     * Draws the no-data line in place of the data.
     *
     * @param {string} text - The line.
     * @returns {void}
     */
    _renderNoData(text) {
        this._setDataShown(false);
        setLabelText(this._noDataLabel, text);
    }

    /**
     * Makes an actor a hover row, at construction or at a later placement: it takes the pointer while the tile is
     * interactive (as the tile is now, from the moment it joins), shows its lines in the shared tooltip while hovered,
     * and takes a click once it is given an id. Its handlers are tied to the tile, so they go when the tile does; a
     * row destroyed before the tile leaves the tile's rows, hiding the tooltip if it was hovered.
     *
     * @param {St.Widget} actor - The row, built with track_hover: true.
     * @returns {HoverRow} The row, with no tooltip lines and no id yet.
     */
    _addHoverRow(actor) {
        const hoverRow = {actor, tooltipLines: [], rowId: null};
        actor.reactive = this._isInteractive;
        actor.connectObject(
            'enter-event', () => this._onHoverRowEntered(hoverRow),
            'leave-event', () => this._onHoverRowLeft(),
            'button-release-event', (_actor, event) => this._onHoverRowReleased(hoverRow, event),
            'destroy', () => this._onHoverRowDestroyed(hoverRow),
            this);
        this._hoverRows.push(hoverRow);
        return hoverRow;
    }

    /**
     * Shows a hover row with its tooltip lines. A hovered row whose lines changed (another mount moved to its place,
     * say) shows its new lines, or hides the tooltip when there are none.
     *
     * @param {HoverRow} hoverRow - The row.
     * @param {string[]} tooltipLines - Its tooltip's lines.
     * @param {string|null} [rowId] - What a click on it activates; null for none.
     * @returns {void}
     */
    _showHoverRow(hoverRow, tooltipLines, rowId = null) {
        setActorVisible(hoverRow.actor, true);
        if (hoverRow.actor.hover && !areSameLines(hoverRow.tooltipLines, tooltipLines)) {
            if (tooltipLines.length > 0)
                this._tooltip.showFor(hoverRow.actor, tooltipLines);
            else
                this._tooltip.hide();
        }
        hoverRow.tooltipLines = tooltipLines;
        hoverRow.rowId = rowId;
    }

    /**
     * Hides a hover row, keeping its actors for the next update. No leave-event reaches a row hidden under the
     * pointer, so hiding a hovered row hides the tooltip; a row hidden already is left alone.
     *
     * @param {HoverRow} hoverRow - The row.
     * @returns {void}
     */
    _hideHoverRow(hoverRow) {
        this._hideTooltipIfHovered(hoverRow);
        setActorVisible(hoverRow.actor, false);
    }

    /**
     * Hides the tooltip if a shown row is under the pointer, for a row the tile moves (a link pushed along by a wider
     * one before it) or hides with the box that holds it: no leave-event is promised for either. The row itself is
     * left as it is.
     *
     * @param {HoverRow} hoverRow - The row moved or hidden.
     * @returns {void}
     */
    _hideTooltipIfHovered(hoverRow) {
        if (hoverRow.actor.visible && hoverRow.actor.hover)
            this._tooltip.hide();
    }

    /**
     * Hides the tooltip if any of the tile's shown rows is under the pointer: a new layout moves them all, and no
     * leave-event is promised for a row moved from under the pointer.
     *
     * @returns {void}
     */
    _hideTooltipIfAnyRowHovered() {
        if (this._hoverRows.some(hoverRow => hoverRow.actor.visible && hoverRow.actor.hover))
            this._tooltip.hide();
    }

    /**
     * Whether one of the shown rows in the data box is under the pointer (a row hidden already may keep a stale
     * hover; a row of a header box stays shown when the data hides).
     *
     * @returns {boolean} True when a visible row of the data box is hovered.
     */
    _hasHoveredDataRow() {
        return this._hoverRows.some(hoverRow =>
            hoverRow.actor.visible && hoverRow.actor.hover && this._dataBox.contains(hoverRow.actor));
    }

    /**
     * Shows the row's tooltip after the shared tooltip's delay.
     *
     * @param {HoverRow} hoverRow - The row the pointer entered.
     * @returns {boolean} Clutter.EVENT_PROPAGATE.
     */
    _onHoverRowEntered(hoverRow) {
        if (hoverRow.tooltipLines.length > 0)
            this._tooltip.showFor(hoverRow.actor, hoverRow.tooltipLines);
        return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Activates the row's id on a primary-button release; a row with no id, a tile with no handler, or any other
     * button does nothing.
     *
     * @param {HoverRow} hoverRow - The row released over.
     * @param {Clutter.Event} event - The release.
     * @returns {boolean} Clutter.EVENT_STOP once the row is activated, else Clutter.EVENT_PROPAGATE.
     */
    _onHoverRowReleased(hoverRow, event) {
        const isActivation = hoverRow.rowId !== null && this._onRowActivated !== null &&
            event.get_button() === Clutter.BUTTON_PRIMARY;
        if (!isActivation)
            return Clutter.EVENT_PROPAGATE;
        this._onRowActivated(hoverRow.rowId);
        return Clutter.EVENT_STOP;
    }

    /**
     * Drops a row destroyed before the tile, and hides the tooltip it may be showing.
     *
     * @param {HoverRow} hoverRow - The row being destroyed.
     * @returns {void}
     */
    _onHoverRowDestroyed(hoverRow) {
        if (hoverRow.actor.hover)
            this._tooltip?.hide();
        this._hoverRows = this._hoverRows.filter(otherRow => otherRow !== hoverRow);
    }

    /**
     * Hides the tooltip as the pointer leaves a row.
     *
     * @returns {boolean} Clutter.EVENT_PROPAGATE.
     */
    _onHoverRowLeft() {
        this._tooltip.hide();
        return Clutter.EVENT_PROPAGATE;
    }

    /**
     * Hides the shared tooltip, which may point at one of the tile's rows, and lets go of the tooltip, the click
     * handler, the latest render and the rows; every call after it does nothing. Runs on 'destroy', so it runs however
     * the tile is destroyed; the rows' handlers go with the rows.
     *
     * @returns {void}
     */
    _onDestroy() {
        this._isDestroyed = true;
        this._tooltip?.hide();
        this._tooltip = null;
        this._onRowActivated = null;
        this._latestRender = null;
        this._hoverRows = [];
    }
});
