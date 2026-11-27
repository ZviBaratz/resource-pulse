// The dropdown's first line: the lit captions, the machine's and the cockpit's (lib/cockpitCaptions.js), each a cell
// with its words upper-cased, above the card. "N waiting on you", the one caption that asks for you, is a filled cell
// (dark words on amber), first; every other is an amber outline. With nothing lit the line is hidden and takes no
// room. Up to eight can be lit at once, more than the card's width holds, so the cells wrap into rows
// (wrappedRowsLayout.js), 6 px apart each way (the stylesheet's spacing). On a light menu the cells take a darker
// amber, legible there: on every style change (a theme or colour-scheme switch restyles the menu) the line finds the
// surface drawn behind it and marks itself while the darker amber contrasts more with that surface than the usual
// one does (lib/surfaceLuminance.js), so it follows any theme.
//
// Shell glue only: its cells are rebuilt only when the lit captions change, which the indicator signals by handing
// out a new answer.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {CockpitCaption} from './lib/cockpitCaptions.js';
import {isAlternativeColorMoreLegible, nearestDrawnSurfaceColor, rgbColorOfHex} from './lib/surfaceLuminance.js';
import {WrappedRowsLayout} from './wrappedRowsLayout.js';

/** The line: the stylesheet gives it the gap between cells (its spacing) and no surface of its own. */
const CAPTIONS_ROW_STYLE_CLASS = 'rp-lit-captions';
/** The stylesheet's property for the gap between cells, each way. */
const CELL_GAP_PROPERTY = 'spacing';
/** A cell: an annunciator in the outline shape, amber words in a 1 px amber border. */
const CAPTION_CELL_STYLE_CLASS = 'rp-annunciator rp-annunciator-outline';
/** The waiting caption's cell: an annunciator in the filled shape, dark words on amber. */
const FILLED_CAPTION_CELL_STYLE_CLASS = 'rp-annunciator rp-annunciator-filled';
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
 * @param {string} caption - The caption's words (lib/cockpitCaptions.js captionWords).
 * @param {boolean} isFilled - The cell takes the filled shape (the waiting caption's), else the outline.
 * @returns {St.Bin} The cell.
 */
function newCaptionCell(caption, isFilled) {
    const label = new St.Label({
        text: caption.toUpperCase(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    const cellStyleClass = isFilled ? FILLED_CAPTION_CELL_STYLE_CLASS : CAPTION_CELL_STYLE_CLASS;
    return new St.Bin({style_class: cellStyleClass, child: label});
}

export const MachineCaptionsRow = GObject.registerClass(
class MachineCaptionsRow extends St.Widget {
    /** Builds the line hidden and empty: nothing is lit before the first Sample. */
    _init() {
        const layout = new WrappedRowsLayout();
        super._init({style_class: CAPTIONS_ROW_STYLE_CLASS, layout_manager: layout, visible: false, x_expand: true});
        this._layout = layout;
        /** @type {import('./lib/cockpitCaptions.js').CaptionsLit|null} */
        this._shownCaptions = null;
        this.connect('style-changed', () => {
            this._followGap();
            this._followSurface();
        });
    }

    /**
     * Gives the layout the stylesheet's gap between cells, in pixels at the current scale, on each style change.
     *
     * @returns {void}
     */
    _followGap() {
        this._layout.setGap(this.get_theme_node().get_length(CELL_GAP_PROPERTY));
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
     * Shows the lit captions, one cell each, in their order, the waiting caption's filled, and hides the line with
     * none. The same answer again (the indicator hands out the same one until a caption lights or unlights, or the
     * count changes) touches no actor.
     *
     * @param {import('./lib/cockpitCaptions.js').CaptionsLit} litCaptions - The lit captions, the machine's and the
     *     cockpit's, in CAPTION_ORDER, with their words.
     * @returns {void}
     */
    setCaptions(litCaptions) {
        if (litCaptions === this._shownCaptions)
            return;
        this._shownCaptions = litCaptions;
        this.destroy_all_children();
        litCaptions.captions.forEach((caption, captionIndex) => {
            const isFilled = caption === CockpitCaption.WAITING;
            this.add_child(newCaptionCell(litCaptions.words[captionIndex], isFilled));
        });
        this.visible = litCaptions.captions.length > 0;
    }
});
