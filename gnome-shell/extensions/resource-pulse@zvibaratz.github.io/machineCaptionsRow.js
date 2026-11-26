// The dropdown's first line: the machine's lit captions (lib/machineCaptions.js), each an amber outlined cell with its
// words upper-cased, on one line above the card. With nothing lit the line is hidden and takes no room. At most four
// are lit at once (Machine stale is always alone), and four fit within the card's width.
//
// Shell glue only: its cells are rebuilt only when the lit captions change, which the client signals by handing out
// a new list.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

/** The line: the stylesheet gives it the gap between cells and no surface of its own; it lies on the menu's. */
const CAPTIONS_ROW_STYLE_CLASS = 'rp-lit-captions';
/** A cell: an annunciator in the outline shape, amber words in a 1 px amber border. */
const CAPTION_CELL_STYLE_CLASS = 'rp-annunciator rp-annunciator-outline';

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
