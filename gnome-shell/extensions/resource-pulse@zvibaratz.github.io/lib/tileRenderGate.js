// When a cockpit tile draws the last render it recorded. A tile records every update and layout as a render; this
// decides, from the tile's frozen and mapped states, whether to draw it now. The tile (cockpitTileBase.js) asks at
// each event and draws when told to; drawing is the tile's, the decision is here.
//
// - A render is drawn at most once: a recorded render waits until it can be drawn, and nothing is drawn twice.
// - Nothing is drawn while the tile is not mapped: the render waits, and is drawn as the tile is mapped.
// - Frozen (a window covers the tile), a render is recorded and not drawn. The reveal draws it, and so does the frozen
//   repaint; with nothing new recorded, neither draws.
// - A tile that has never drawn draws its render as soon as it is mapped with one recorded, frozen or not: as it is
//   first mapped, or at its first render if it was mapped first. So it never shows its title alone.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.

/** The decision for one tile: built with the tile, unfrozen, with nothing recorded. */
export class TileRenderGate {
    /** Builds the gate: unfrozen, nothing recorded, nothing drawn. */
    constructor() {
        this._isFrozen = false;
        this._hasUndrawnRender = false;
        this._hasDrawn = false;
    }

    /** @returns {boolean} Whether the tile is frozen. */
    get isFrozen() {
        return this._isFrozen;
    }

    /**
     * A render was recorded: drawn now if the tile is mapped and unfrozen, or mapped and has never drawn; else it
     * waits.
     *
     * @param {{isMapped: boolean}} tileState - Whether the tile is mapped now.
     * @returns {boolean} True when the tile is to draw that render now.
     */
    recorded({isMapped}) {
        this._hasUndrawnRender = true;
        return this._takeDraw(isMapped && this._isFreeToDraw());
    }

    /**
     * The tile was frozen or revealed. Freezing never draws; the reveal draws a render that waited. Setting the state
     * the tile has changes nothing.
     *
     * @param {boolean} isFrozen - True while covered.
     * @param {{isMapped: boolean}} tileState - Whether the tile is mapped now.
     * @returns {boolean} True when the tile is to draw its latest render now.
     */
    frozenChanged(isFrozen, {isMapped}) {
        if (isFrozen === this._isFrozen)
            return false;
        this._isFrozen = isFrozen;
        return this._takeDraw(isMapped && !isFrozen);
    }

    /**
     * The tile was mapped or unmapped: mapped, a render that waited is drawn, unless the tile is frozen and has drawn
     * before.
     *
     * @param {{isMapped: boolean}} tileState - Whether the tile is mapped now.
     * @returns {boolean} True when the tile is to draw its latest render now.
     */
    mapped({isMapped}) {
        return this._takeDraw(isMapped && this._isFreeToDraw());
    }

    /**
     * The frozen repaint: a frozen tile draws a render recorded since its last draw, still dimmed. Unfrozen it draws
     * nothing here.
     *
     * @param {{isMapped: boolean}} tileState - Whether the tile is mapped now.
     * @returns {boolean} True when the tile is to draw its latest render now.
     */
    frozenRepaint({isMapped}) {
        return this._takeDraw(isMapped && this._isFrozen);
    }

    /**
     * Whether a mapped tile may draw a waiting render on a record or a mapping: unfrozen, or never drawn yet.
     *
     * @returns {boolean} True when it may.
     */
    _isFreeToDraw() {
        return !this._isFrozen || !this._hasDrawn;
    }

    /**
     * Takes the waiting render for drawing, when the tile can draw and one waits.
     *
     * @param {boolean} canDraw - Whether the tile can draw now.
     * @returns {boolean} True when a render waited and is now to be drawn.
     */
    _takeDraw(canDraw) {
        if (!canDraw || !this._hasUndrawnRender)
            return false;
        this._hasUndrawnRender = false;
        this._hasDrawn = true;
        return true;
    }
}
