// The top bar's mark, left of the two graphs, in a slot that keeps its 20 px whether a mark shows or not, so lighting
// it never moves the panel's other items: an amber disc with the waiting count while a session waits on you, else an
// amber ring while any other caption is lit, else nothing (lib/markFace.js). It says look, and the disc how many; the
// dropdown and the hover label say at what.
//
// The slot holds both marks, one shown at a time; its layout centres them in its content box, so each mark's place
// comes from the slot's padding, set by its style class: the ring's 9 px 8 px in from the left, or the disc's 16 px
// 1 px in, both 3 px from the slot's right.
//
// Shell glue only, and static: each mark is a styled St widget whose surface St draws and caches, shown, hidden or
// given new words only when the mark's face changes, so a Sample that changes nothing touches no actor.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {MarkKind, isSameMarkFace, markFaceOf} from './lib/markFace.js';

/** The slot while it holds the ring or nothing: its content box is the ring's size. */
const MARK_SLOT_STYLE_CLASS = 'rp-machine-mark-slot';
/** The slot while it holds the disc: its content box is the disc's size, the slot's width the same. */
const DISC_SLOT_STYLE_CLASS = 'rp-machine-mark-slot-disc';
/** The ring: a 9 px amber outline, drawn by St from the stylesheet. */
const MARK_RING_STYLE_CLASS = 'rp-machine-mark-ring';
/** The disc: 16 px of amber. */
const MARK_DISC_STYLE_CLASS = 'rp-machine-mark-disc';
/** The count's words, one digit; two digits take the smaller size as well. */
const DISC_COUNT_STYLE_CLASS = 'rp-machine-mark-count';
const TWO_DIGIT_DISC_COUNT_STYLE_CLASSES = 'rp-machine-mark-count rp-machine-mark-count-two-digits';

export const MachineMarkSlot = GObject.registerClass(
class MachineMarkSlot extends St.Widget {
    /** Builds the slot with both marks hidden: nothing is lit before the first Sample. */
    _init() {
        super._init({
            style_class: MARK_SLOT_STYLE_CLASS, layout_manager: new Clutter.BinLayout(), y_expand: true,
        });
        this._ring = new St.Widget({
            style_class: MARK_RING_STYLE_CLASS,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._countLabel = new St.Label({
            style_class: DISC_COUNT_STYLE_CLASS,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._disc = new St.Bin({
            style_class: MARK_DISC_STYLE_CLASS,
            child: this._countLabel,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._ring);
        this.add_child(this._disc);
        this._shownFace = markFaceOf({isRingLit: false, waitingCount: 0});
    }

    /**
     * Shows the disc with the count while one or more sessions wait, else the ring while any caption is lit, else
     * nothing. The same face again touches no actor; a new count touches only the disc's words.
     *
     * @param {object} reading - What is lit.
     * @param {boolean} reading.isRingLit - Any caption is lit.
     * @param {number} reading.waitingCount - How many sessions wait on you; 0 for none.
     * @returns {void}
     */
    setMark({isRingLit, waitingCount}) {
        const face = markFaceOf({isRingLit, waitingCount});
        if (isSameMarkFace(this._shownFace, face))
            return;
        const isDisc = face.kind === MarkKind.DISC;
        if (face.kind !== this._shownFace.kind) {
            this.style_class = isDisc ? DISC_SLOT_STYLE_CLASS : MARK_SLOT_STYLE_CLASS;
            this._ring.visible = face.kind === MarkKind.RING;
            this._disc.visible = isDisc;
        }
        if (isDisc) {
            this._countLabel.text = face.countText;
            this._countLabel.style_class = face.isTwoDigitCount
                ? TWO_DIGIT_DISC_COUNT_STYLE_CLASSES
                : DISC_COUNT_STYLE_CLASS;
        }
        this._shownFace = face;
    }
});
