// The top bar's mark: an amber ring left of the two graphs while any of the machine's captions is lit
// (lib/machineCaptions.js), in a slot that keeps its width whether the ring shows or not, so lighting it never moves
// the panel's other items. It says look; the dropdown and the hover label say at what.
//
// Shell glue only, and static: the ring is a styled St.Widget whose surface St draws and caches, shown or hidden only
// when the captions light or unlight, so a Sample that changes nothing touches no actor.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** The slot: its width is the stylesheet's, whether the ring shows or not, and its content box is the ring's size. */
const MARK_SLOT_STYLE_CLASS = 'rp-machine-mark-slot';
/** The ring: a 9 px amber outline, drawn by St from the stylesheet. */
const MARK_RING_STYLE_CLASS = 'rp-machine-mark-ring';

export const MachineMarkSlot = GObject.registerClass(
class MachineMarkSlot extends St.Bin {
    /** Builds the slot with its ring hidden: nothing is lit before the first Sample. */
    _init() {
        const ring = new St.Widget({
            style_class: MARK_RING_STYLE_CLASS,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        super._init({style_class: MARK_SLOT_STYLE_CLASS, child: ring, y_expand: true});
        this._ring = ring;
    }

    /** @returns {boolean} True while the ring shows. */
    get isLit() {
        return this._ring.visible;
    }

    /**
     * Shows the ring while any caption is lit, and hides it otherwise. The same state again touches no actor.
     *
     * @param {boolean} isLit - Any of the machine's captions is lit.
     * @returns {void}
     */
    setLit(isLit) {
        if (isLit !== this._ring.visible)
            this._ring.visible = isLit;
    }
});
