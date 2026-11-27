// What the desktop card repaints, decided without the Shell; card.js applies each plan to its labels and drawing areas.
//
// - While the card is frozen (a window covers it: extension.js), a new snapshot is only recorded, and nothing is
//   repainted or relaid out, except the frozen repaint extension.js asks for every FROZEN_REPAINT_INTERVAL_SECONDS.
// - A frozen card is dimmed, so one misjudged as covered reads as stale, never as live: freezing renders
//   once, dimmed (a render nobody sees when the card really is covered), and so does each frozen repaint.
// - Unfreezing renders at once, undimmed, from the latest snapshot recorded.
// - Each render sets every label (card.js skips a label whose text is unchanged) and redraws the two traces, whose
//   histories move on with every sample. A pressure meter is redrawn only when what it draws differs from what it last
//   drew: its band or its amber, which change rarely, and the dim, which changes its opacity.
// - Every snapshot told, frozen or not, is recorded in the swap window (lib/machineConditions.js), so Swapping is
//   judged over the Samples the card was told of; a render draws the machine's conditions from it.
//
// Pure: no Shell, St, Clutter or Meta import, so it runs under plain gjs.
import {cardText} from './format.js';
import {SwapGrowthWindow, machineConditions} from './machineConditions.js';

/** What a meter has drawn before the first render: nothing, so its first state is a change. */
const NOTHING_DRAWN_YET = Symbol('nothing drawn yet');

/**
 * @typedef {object} ShownState
 * @property {import('../pulseClient.js').Snapshot|null} snapshot - The latest snapshot, or null before the first.
 * @property {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data, for "no data since".
 */

/**
 * @typedef {object} RepaintPlan
 * @property {import('./format.js').CardText} text - Every string on the card, and each meter's band and amber
 *     (text.meters).
 * @property {number[]} changedMeterIndexes - The meters whose band or amber differs from what they drew, in
 *     text.meters order: only these are redrawn.
 * @property {boolean} isDimmed - The card is frozen, so the render is dimmed (card.js's frozen pseudo-class).
 * @property {boolean} isDimChanged - The dim differs from the last render's: card.js adds or removes the pseudo-class
 *     only then, and every meter is redrawn at the new opacity.
 */

/**
 * What a meter draws: its band and whether it is amber, as one comparable key.
 *
 * @param {import('./format.js').CardMeterText} meter - The meter's text.
 * @returns {string} The key.
 */
const meterDrawnKey = ({band, isWait}) => `${band}:${isWait}`;

export class CardRepaintPlanner {
    /**
     * Starts unfrozen and undimmed, with nothing recorded and nothing drawn.
     */
    constructor() {
        this._isFrozen = false;
        /** @type {ShownState|null} */
        this._latestShownState = null;
        /** @type {string[]|symbol} */
        this._drawnMeterKeys = NOTHING_DRAWN_YET;
        this._isDrawnDimmed = false;
        this._swapGrowthWindow = new SwapGrowthWindow();
    }

    /** @returns {boolean} True while the card is frozen. */
    get isFrozen() {
        return this._isFrozen;
    }

    /**
     * Records the state the card should show, and plans its render unless the card is frozen.
     *
     * @param {ShownState} shownState - The latest snapshot and its clock label.
     * @returns {RepaintPlan|null} What to repaint now, or null while frozen (recorded only).
     */
    show(shownState) {
        this._latestShownState = shownState;
        this._swapGrowthWindow.record(shownState.snapshot);
        return this._isFrozen ? null : this._planRender();
    }

    /**
     * Freezes or unfreezes the card, planning a render of the latest recorded state at once either way: freezing
     * renders it dimmed, unfreezing undimmed. Setting the state the card already has plans nothing, and so does a
     * change with nothing recorded yet.
     *
     * @param {boolean} isFrozen - True while a window covers the card.
     * @returns {RepaintPlan|null} The freeze's or the reveal's render, or null.
     */
    setFrozen(isFrozen) {
        if (isFrozen === this._isFrozen)
            return null;
        this._isFrozen = isFrozen;
        if (this._latestShownState === null)
            return null;
        return this._planRender();
    }

    /**
     * Plans the frozen card's periodic repaint (extension.js asks every FROZEN_REPAINT_INTERVAL_SECONDS while the card
     * counts as covered): the latest recorded state, still dimmed. A card misjudged as covered then shows numbers at
     * most that old, dimmed, rather than stale ones.
     *
     * @returns {RepaintPlan|null} The dimmed render, or null when unfrozen (an unfrozen card renders every snapshot
     *     already) or with nothing recorded yet.
     */
    repaintFrozen() {
        if (!this._isFrozen || this._latestShownState === null)
            return null;
        return this._planRender();
    }

    /**
     * Plans a render of the latest recorded state, dimmed while the card is frozen. Each meter's band and amber are
     * compared with what it last drew, and a change of dim redraws them all, since each draws at the new opacity. The
     * new states are recorded as drawn: card.js applies every plan it is given.
     *
     * @returns {RepaintPlan} The plan.
     */
    _planRender() {
        const {snapshot, lastGoodClockLabel} = this._latestShownState;
        const text = cardText(snapshot, lastGoodClockLabel, machineConditions(snapshot, this._swapGrowthWindow));
        const isDimmed = this._isFrozen;
        const isDimChanged = isDimmed !== this._isDrawnDimmed;
        const meterKeys = text.meters.map(meterDrawnKey);
        const haveMetersDrawn = this._drawnMeterKeys !== NOTHING_DRAWN_YET;
        const changedMeterIndexes = meterKeys.flatMap((meterKey, meterIndex) => {
            const isUnchanged = !isDimChanged && haveMetersDrawn && meterKey === this._drawnMeterKeys[meterIndex];
            return isUnchanged ? [] : [meterIndex];
        });
        this._drawnMeterKeys = meterKeys;
        this._isDrawnDimmed = isDimmed;
        return {text, changedMeterIndexes, isDimmed, isDimChanged};
    }
}
