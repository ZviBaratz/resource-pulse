// What the top bar's mark shows: an amber disc with the waiting count while a session waits on you, else an amber
// ring while any other caption is lit, else nothing. The disc says how many; the ring says look; the dropdown and the
// hover label say at what, with the true count.
//
// - The count is drawn as it is up to DISC_COUNT_LIMIT; from there the disc says DISC_COUNT_LIMIT, since 16 px holds
//   two digits at most. From TWO_DIGIT_COUNT its words are a size smaller.
// - With the cockpit service gone the count is no longer known (lib/cockpitCaptions.js gives none), so the disc gives
//   way to the ring, which the Stale captions light.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.

/** What the mark shows. */
export const MarkKind = Object.freeze({
    NONE: 'none',
    RING: 'ring',
    DISC: 'disc',
});

/** The most the disc says: two digits. */
export const DISC_COUNT_LIMIT = 99;
/** The least count whose words are two digits, and a size smaller. */
export const TWO_DIGIT_COUNT = 10;

/**
 * @typedef {object} MarkFace
 * @property {string} kind - A MarkKind.
 * @property {string} countText - The disc's words; '' unless the disc shows.
 * @property {boolean} isTwoDigitCount - The disc's words are two digits, and take the smaller size.
 */

/** Nothing shown, and the ring: one frozen face each, so an unchanged mark always gives the same one. */
const NO_MARK = Object.freeze({kind: MarkKind.NONE, countText: '', isTwoDigitCount: false});
const RING_MARK = Object.freeze({kind: MarkKind.RING, countText: '', isTwoDigitCount: false});

/**
 * The mark for the lit captions: the disc with the count while one or more sessions wait, else the ring while any
 * caption is lit, else nothing.
 *
 * @param {object} reading - What is lit.
 * @param {boolean} reading.isRingLit - Any caption is lit (the waiting caption included).
 * @param {number} reading.waitingCount - How many sessions wait on you (lib/cockpitCaptions.js); 0 for none. Anything
 *     that is not a whole number of 1 or more counts as none.
 * @returns {MarkFace} The mark, frozen.
 */
export function markFaceOf({isRingLit, waitingCount}) {
    if (Number.isInteger(waitingCount) && waitingCount >= 1) {
        const shownCount = Math.min(waitingCount, DISC_COUNT_LIMIT);
        return Object.freeze({
            kind: MarkKind.DISC, countText: String(shownCount), isTwoDigitCount: shownCount >= TWO_DIGIT_COUNT,
        });
    }
    return isRingLit ? RING_MARK : NO_MARK;
}

/**
 * Whether two faces draw the same: the same kind and the same words.
 *
 * @param {MarkFace|null} shownFace - The face shown, or null before the first.
 * @param {MarkFace} nextFace - The face to show.
 * @returns {boolean} True when nothing would change.
 */
export function isSameMarkFace(shownFace, nextFace) {
    return shownFace !== null && shownFace.kind === nextFace.kind && shownFace.countText === nextFace.countText;
}
