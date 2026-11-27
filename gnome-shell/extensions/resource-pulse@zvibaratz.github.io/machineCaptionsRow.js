// The dropdown's first line: the machine's lit captions (lib/machineCaptions.js), each an amber outlined cell with its
// words upper-cased, on one line above the card. With nothing lit the line is hidden and takes no room. At most four
// are lit at once (Machine stale is always alone), and four fit within the card's width. On a light menu the cells
// take a darker amber, legible there: on every style change (a theme or colour-scheme switch restyles the menu) the
// line finds the surface drawn behind it and marks itself while the darker amber contrasts more with that surface
// than the usual one does (lib/surfaceLuminance.js), so it follows any theme.
//
// Shell glue only: its cells are rebuilt only when the lit captions change, which the client signals by handing out
// a new list.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {isAlternativeColorMoreLegible, nearestDrawnSurfaceColor, rgbColorOfHex} from './lib/surfaceLuminance.js';

/** The line: the stylesheet gives it the gap between cells and no surface of its own; it lies on the menu's. */
const CAPTIONS_ROW_STYLE_CLASS = 'rp-lit-captions';
/** A cell: an annunciator in the outline shape, amber words in a 1 px amber border. */
const CAPTION_CELL_STYLE_CLASS = 'rp-annunciator rp-annunciator-outline';
/** The line's mark while the darker amber reads better on the surface behind it: the stylesheet darkens its cells. */
const ON_LIGHT_SURFACE_STYLE_CLASS = 'rp-lit-captions-on-light';
/** The cells' words, as the stylesheet colours them: the usual amber, and the darker amber of the marked line. */
const CAPTION_AMBER = rgbColorOfHex('#f0b429');
const DARKER_CAPTION_AMBER = rgbColorOfHex('#946200');
/** A box pointer (the menu's) draws its surface from this property rather than from its background. */
const ARROW_BACKGROUND_PROPERTY = '-arrow-background-color';

/**
 * The layers behind an actor, for lib/surfaceLuminance.js nearestDrawnSurfaceColor: each ancestor from its parent
 * outwards, as its theme node colours it, read only as far as the walk is followed; null for one not styled yet.
 *
 * @param {Clutter.Actor} actor - The actor.
 * @yields {import('./lib/surfaceLuminance.js').SurfaceLayer|null} One ancestor's layer.
 */
function* surfaceLayersBehind(actor) {
    for (let ancestor = actor.get_parent(); ancestor !== null; ancestor = ancestor.get_parent()) {
        const themeNode = ancestor instanceof St.Widget ? ancestor.peek_theme_node() : null;
        if (themeNode === null) {
            yield null;
            continue;
        }
        const [hasArrowBackground, arrowBackground] = themeNode.lookup_color(ARROW_BACKGROUND_PROPERTY, false);
        yield {
            background: themeNode.get_background_color(),
            arrowBackground: hasArrowBackground ? arrowBackground : null,
        };
    }
}

/**
 * One caption's cell: its words upper-cased (St has no text-transform), whole (never ellipsized), centred in the cell.
 *
 * @param {string} caption - The caption's words, as lib/machineCaptions.js names them.
 * @returns {St.Bin} The cell.
 */
function newCaptionCell(caption) {
    const label = new St.Label({
        text: caption.toUpperCase(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return new St.Bin({style_class: CAPTION_CELL_STYLE_CLASS, child: label});
}

export const MachineCaptionsRow = GObject.registerClass(
class MachineCaptionsRow extends St.BoxLayout {
    /** Builds the line hidden and empty: nothing is lit before the first Sample. */
    _init() {
        super._init({style_class: CAPTIONS_ROW_STYLE_CLASS, visible: false, x_expand: true});
        /** @type {ReadonlyArray<string>|null} */
        this._shownCaptions = null;
        this.connect('style-changed', () => this._followSurface());
    }

    /**
     * Marks the line while the darker amber contrasts more than the usual one with the surface drawn behind it (a
     * light menu), so its cells take the darker amber, and unmarks it otherwise, with no surface drawn included. Runs
     * on each style change of the line; a mark already right is left alone, so the change it makes itself settles at
     * once.
     *
     * @returns {void}
     */
    _followSurface() {
        const surfaceColor = nearestDrawnSurfaceColor(surfaceLayersBehind(this));
        const isOnLightSurface = isAlternativeColorMoreLegible(surfaceColor, CAPTION_AMBER, DARKER_CAPTION_AMBER);
        if (isOnLightSurface === this.has_style_class_name(ON_LIGHT_SURFACE_STYLE_CLASS))
            return;
        if (isOnLightSurface)
            this.add_style_class_name(ON_LIGHT_SURFACE_STYLE_CLASS);
        else
            this.remove_style_class_name(ON_LIGHT_SURFACE_STYLE_CLASS);
    }

    /**
     * Shows the lit captions, one cell each, in their order, and hides the line with none. The same list again (the
     * client hands out the same one until a caption lights or unlights) touches no actor.
     *
     * @param {ReadonlyArray<string>} litCaptions - The machine's lit captions.
     * @returns {void}
     */
    setCaptions(litCaptions) {
        if (litCaptions === this._shownCaptions)
            return;
        this._shownCaptions = litCaptions;
        this.destroy_all_children();
        for (const caption of litCaptions)
            this.add_child(newCaptionCell(caption));
        this.visible = litCaptions.length > 0;
    }
});
