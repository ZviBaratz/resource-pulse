// The cockpit's lengths that hold text, the tiles' text widths, and its caption plates' legends, measured from hidden
// labels on the stage, so the layout can be computed before any tile or plate exists, and again whenever the text
// size changes.
//
// - Every read builds its labels afresh, reads them and destroys them: one hidden St.Label for each kind of line, in
//   its own class (stylesheet.css, the cockpit's text sizes), one for each annunciator's caption, one for the
//   "Waiting on you" cell's one width, one for each group caption the layout names, and one for each distinct sample
//   text of the tiles in its class (lib/measuredTextWidths.js), under a hidden parent of the measurer's own with the
//   tiles' font class, which it places under the caller's actor (the labels' theme, and so their font, comes from the
//   stage). Hidden, they are never painted and never take the pointer.
// - The sheet's widths that hold text are each its tile's own sum of the widths `textWidthsPx` gives that tile.
//   **One read, both ends:** a caller hands a tile its `textWidthsPx` and places it with the sheet's widths from the
//   same read, the getters read after the same onLengthsChanged (or the constructor), and hands Heaviest the sheet's
//   `heaviest.stopWidthPx` as its stop. Then the width the composition gives a tile and the width the tile lays
//   itself out against are one number. Every getter answers from the one stored read.
// - Fresh, because a kept label cannot follow a change of scale: Clutter gives an actor that is not mapped the
//   resource scale it guesses at its first read, from its parent, and keeps it; and it answers a preferred size from
//   a cache that a change of monitor does not clear.
// - So the labels measure at the scale Clutter gives their parent when they are built: under the Shell's uiGroup,
//   which lies on every monitor, the highest of any monitor's. A caller that needs one monitor's scale hands in a
//   parent that is mapped, lies wholly on that monitor and has been through a layout. (This is read from Clutter's
//   source, not seen in a run.)
// - St applies a label's style to its text only when the label maps, and a hidden label never maps, so every read
//   calls ensure_style() on each label first: without it a hidden label answers one default height whatever its
//   class.
// - A read again on the stage's St.ThemeContext `changed`, which a change of text scaling or of the interface font
//   fires, and whenever the caller asks (measureAgain), for example when the cockpit moves to another monitor. When
//   anything the getters give has changed, the caller is told once: onLengthsChanged.
// - An St call that throws is logged and read as null, a bad reading (lib/measuredLengths.js), never an error thrown
//   into the caller. A parent that is not on the stage gives no reading at all: every length, width and text width
//   keeps its default, and each is named. Once the caller's actor is destroyed the measurer stops, as after
//   destroy().
// - A read happens only at construction, on the theme's `changed`, on setGroups and on measureAgain: never in a
//   layout, a paint or a tile's update.
import St from 'gi://St';
import {cockpitCaptionText} from './lib/cockpitFormat.js';
import {
    COUNT_SLOT_SAMPLE_TEXT, LINE_SAMPLE_TEXT, LineKind, TILE_TEXT_CLASS, annunciatorCellWidthPx,
    measuredSessionsLengths, measuredSheet, plateLegendWidthsPx,
} from './lib/measuredLengths.js';
import {
    TILE_TEXT_WIDTH_ENTRIES, measuredSheetWidths, measuredTextWidths, sampleLabelsOf,
} from './lib/measuredTextWidths.js';
import {PlateCaption, plateCaptionsByGroup} from './lib/plateCaptions.js';

/** A size asked for with no constraint in the other direction. */
const UNCONSTRAINED_SIZE = -1;
/** The kinds of line drawn upper-cased, so measured so. */
const UPPER_CASED_LINE_KINDS = new Set([LineKind.ANNUNCIATOR, LineKind.GROUP_CAPTION]);
/** The annunciators measured by their own caption; "Waiting on you" is measured by its count slot. */
const ANNUNCIATOR_CAPTIONS = Object.values(PlateCaption).filter(caption => caption !== PlateCaption.WAITING_ON_YOU);
/** The tiles' sample texts, each distinct text in a class once: one label each. */
const SAMPLE_LABELS = sampleLabelsOf(TILE_TEXT_WIDTH_ENTRIES);

/**
 * @typedef {object} CockpitLengths
 * @property {object} lineBoxesPx - Each kind of line's natural height, keyed by LineKind value; null where unread.
 * @property {object} sheet - The layout's sheet, its lengths and widths that hold text measured
 *     (lib/measuredLengths.js, lib/measuredTextWidths.js).
 * @property {object} textWidthsPx - Each tile's text widths, by its key (lib/measuredTextWidths.js).
 * @property {object} sessionsLengths - The Sessions tile's lengths, measured.
 * @property {Array<number|null>} plateLegendWidthsPx - Each group's legend, by its place in the groups last set.
 * @property {number|null} countSlotWidthPx - The "Waiting on you" cell's one whole width.
 * @property {string[]} fallbackNames - The lengths left at their default because a line they need read badly.
 */

/**
 * A label's natural size, its style applied first.
 *
 * @param {St.Label} label - A hidden label.
 * @returns {{heightPx: number, widthPx: number}|null} Its natural height and width, in logical pixels; null when an
 *     St call throws.
 */
function naturalSizeOf(label) {
    try {
        label.ensure_style();
        const [, naturalHeightPx] = label.get_preferred_height(UNCONSTRAINED_SIZE);
        const [, naturalWidthPx] = label.get_preferred_width(UNCONSTRAINED_SIZE);
        return {heightPx: naturalHeightPx, widthPx: naturalWidthPx};
    } catch (error) {
        console.warn(`resource-pulse: a hidden label of the cockpit's lengths could not be read: ${error.message}`);
        return null;
    }
}

/**
 * The tiles' sample texts' widths, keyed by class and then by text.
 *
 * @param {Array<{lineKind: string, text: string}>} labels - The sample texts, each in its class.
 * @param {function(string, string): (number|null)} widthOf - A text's width in a class; null where unread.
 * @returns {object} The widths, keyed by LineKind value and then by text.
 */
function sampleWidthsOf(labels, widthOf) {
    const widthsPx = {};
    for (const {lineKind, text} of labels) {
        widthsPx[lineKind] ??= {};
        widthsPx[lineKind][text] = widthOf(lineKind, text);
    }
    return widthsPx;
}

/**
 * The text a kind of line is measured with: the captions upper-cased, as they are drawn.
 *
 * @param {string} lineKind - A LineKind value.
 * @returns {string} The sample text.
 */
function sampleTextOf(lineKind) {
    return UPPER_CASED_LINE_KINDS.has(lineKind) ? cockpitCaptionText(LINE_SAMPLE_TEXT) : LINE_SAMPLE_TEXT;
}

/**
 * The group captions a layout's plates carry, each once.
 *
 * @param {*} groups - The layout's groups.
 * @returns {string[]} The captions.
 */
function plateGroupCaptionsOf(groups) {
    const plates = plateCaptionsByGroup(groups).filter(plateCaptions => plateCaptions !== null);
    return [...new Set(plates.map(({groupCaption}) => groupCaption))];
}

/**
 * The groups, copied, so a layout changed in place by its owner after it is handed in changes no later read.
 *
 * @param {*} groups - The layout's groups, as the lenient reader gives them.
 * @returns {*} A copy of the list and of each group's cards; anything that is not a list as it is.
 */
function copiedGroups(groups) {
    if (!Array.isArray(groups))
        return groups;
    return groups.map(group => {
        if (group === null || typeof group !== 'object')
            return group;
        return {...group, cards: Array.isArray(group.cards) ? [...group.cards] : group.cards};
    });
}

export class CockpitLengthsMeasurer {
    /**
     * Reads once, and listens for the theme's changes and the end of the caller's actor.
     *
     * @param {object} params - What it measures in, and against.
     * @param {Clutter.Actor} params.parentActor - Where on the stage the hidden labels are built: the Shell's uiGroup,
     *     or, for one monitor's scale, a mapped actor wholly on that monitor that has been through a layout.
     * @param {St.ThemeContext} params.themeContext - The stage's theme context, whose `changed` reads again.
     * @param {object} params.defaultSheet - The layout's default sheet: every length not measured, and each fallback.
     * @param {object} params.defaultSessionsLengths - The Sessions tile's default lengths, the same way.
     * @param {function(): void} [params.onLengthsChanged] - Told when a read changes what the getters give.
     */
    constructor({parentActor, themeContext, defaultSheet, defaultSessionsLengths, onLengthsChanged = () => {}}) {
        this._parentActor = parentActor;
        this._themeContext = themeContext;
        this._defaultSheet = defaultSheet;
        this._defaultSessionsLengths = defaultSessionsLengths;
        this._onLengthsChanged = onLengthsChanged;
        this._groups = [];
        this._isListening = true;
        this._themeChangedId = themeContext.connect('changed', () => this._readAndTell());
        this._parentDestroyId = parentActor.connect('destroy', () => this._stopListening());
        this._lengths = this._read();
    }

    /** @returns {object} The layout's sheet, its lengths that hold text measured. */
    get sheet() {
        return this._lengths.sheet;
    }

    /** @returns {object} The Sessions tile's lengths, measured. */
    get sessionsLengths() {
        return this._lengths.sessionsLengths;
    }

    /**
     * @returns {object} Each tile's text widths, by its key (`heaviest`, `connections`, `sessions`): a copy, from the
     *     same read as the sheet's widths, which are each its tile's own sum of these.
     */
    get textWidthsPx() {
        return Object.fromEntries(Object.entries(this._lengths.textWidthsPx).map(([tileKey, widthsPx]) =>
            [tileKey, {...widthsPx}]));
    }

    /** @returns {Array<number|null>} Each group's plate legend, by its place in the groups last set; null for none. */
    get plateLegendWidthsPx() {
        return [...this._lengths.plateLegendWidthsPx];
    }

    /** @returns {number|null} The "Waiting on you" cell's one whole width, which the plate draws the cell at. */
    get countSlotWidthPx() {
        return this._lengths.countSlotWidthPx;
    }

    /** @returns {string[]} The lengths left at their default because a line they need read badly. */
    get fallbackNames() {
        return [...this._lengths.fallbackNames];
    }

    /** @returns {object} Each kind of line's natural height, keyed by LineKind value: what the lengths are made of. */
    get lineBoxesPx() {
        return {...this._lengths.lineBoxesPx};
    }

    /**
     * Takes the layout's groups, a copy of them, and reads again for their legends. After destroy it does nothing.
     *
     * @param {*} groups - The layout's groups, as the lenient reader gives them.
     * @returns {void}
     */
    setGroups(groups) {
        if (!this._isListening)
            return;
        this._groups = copiedGroups(groups);
        this._readAndTell();
    }

    /**
     * Reads again, with labels built afresh: for the caller to ask when something it knows of may change a length,
     * such as the cockpit moving to another monitor.
     *
     * @returns {void}
     */
    measureAgain() {
        this._readAndTell();
    }

    /**
     * Stops listening. A second call does nothing.
     *
     * @returns {void}
     */
    destroy() {
        if (!this._isListening)
            return;
        this._parentActor.disconnect(this._parentDestroyId);
        this._stopListening();
    }

    /**
     * Stops listening to the theme and reading: on destroy, and when the caller's actor is destroyed.
     *
     * @returns {void}
     */
    _stopListening() {
        if (!this._isListening)
            return;
        this._isListening = false;
        this._themeContext.disconnect(this._themeChangedId);
    }

    /**
     * Reads, and tells the caller when what the getters give has changed.
     *
     * @returns {void}
     */
    _readAndTell() {
        if (!this._isListening)
            return;
        const lengths = this._read();
        const isChanged = JSON.stringify(lengths) !== JSON.stringify(this._lengths);
        this._lengths = lengths;
        if (isChanged)
            this._onLengthsChanged();
    }

    /**
     * Builds the labels under a fresh hidden parent, reads them, and destroys them all.
     *
     * @returns {{lineBoxesPx: object, annunciatorWidthsPx: object, countSlotTextWidthPx: number|null,
     *     groupCaptionWidthsPx: object, sampleWidthsPx: object}} The readings, null where unread; all null where the
     *     parent is not on the stage.
     */
    _readLabels() {
        const isParentOnStage = this._parentActor.get_stage() !== null;
        // Hidden before any label is added, so no label ever maps.
        const holder = isParentOnStage ? new St.Widget({style_class: TILE_TEXT_CLASS, visible: false}) : null;
        if (holder !== null)
            this._parentActor.add_child(holder);
        const measure = (lineKind, text) => {
            if (holder === null)
                return null;
            const label = new St.Label({style_class: lineKind, text});
            holder.add_child(label);
            return naturalSizeOf(label);
        };
        const widthOfCaption = (lineKind, caption) => measure(lineKind, cockpitCaptionText(caption))?.widthPx ?? null;
        const readings = {
            lineBoxesPx: Object.fromEntries(Object.values(LineKind).map(lineKind =>
                [lineKind, measure(lineKind, sampleTextOf(lineKind))?.heightPx ?? null])),
            annunciatorWidthsPx: Object.fromEntries(ANNUNCIATOR_CAPTIONS.map(caption =>
                [caption, widthOfCaption(LineKind.ANNUNCIATOR, caption)])),
            countSlotTextWidthPx: widthOfCaption(LineKind.ANNUNCIATOR, COUNT_SLOT_SAMPLE_TEXT),
            groupCaptionWidthsPx: Object.fromEntries(plateGroupCaptionsOf(this._groups).map(groupCaption =>
                [groupCaption, widthOfCaption(LineKind.GROUP_CAPTION, groupCaption)])),
            sampleWidthsPx: sampleWidthsOf(SAMPLE_LABELS, (lineKind, text) => measure(lineKind, text)?.widthPx ?? null),
        };
        holder?.destroy();
        return readings;
    }

    /**
     * Reads the labels, and from them the lengths, the tiles' widths and the legends: the sheet's heights first, then
     * its widths on that sheet.
     *
     * @returns {CockpitLengths} What was read.
     */
    _read() {
        const {lineBoxesPx, annunciatorWidthsPx, countSlotTextWidthPx, groupCaptionWidthsPx, sampleWidthsPx} =
            this._readLabels();
        const countSlotWidthPx = annunciatorCellWidthPx(countSlotTextWidthPx);
        const {sheet: heightsSheet, fallbackNames: sheetFallbackNames} =
            measuredSheet(this._defaultSheet, lineBoxesPx);
        const textWidths = measuredTextWidths(TILE_TEXT_WIDTH_ENTRIES, sampleWidthsPx);
        const {sheet, fallbackNames: sheetWidthFallbackNames} =
            measuredSheetWidths(heightsSheet, TILE_TEXT_WIDTH_ENTRIES, textWidths);
        const {lengths: sessionsLengths, fallbackNames: sessionsFallbackNames} =
            measuredSessionsLengths(this._defaultSessionsLengths, lineBoxesPx);
        const legendWidthsPx = plateLegendWidthsPx(this._groups,
            {annunciatorWidthsPx, countSlotWidthPx, groupCaptionWidthsPx});
        return {
            lineBoxesPx, sheet, sessionsLengths, textWidthsPx: textWidths.textWidthsPx,
            plateLegendWidthsPx: legendWidthsPx, countSlotWidthPx,
            fallbackNames: [
                ...sheetFallbackNames, ...sessionsFallbackNames, ...textWidths.fallbackNames,
                ...sheetWidthFallbackNames,
            ],
        };
    }
}
