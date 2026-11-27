// The Sessions tile's columns: one area holding every slot the columns draw (each column's labels, each group's
// heading, a heading for a group run on into a later column, each group's "+N more" line and the session rows),
// each placed by its position. Shell glue only: where each item stands comes from lib/sessionsTileGeometry.js and
// what it says from lib/sessionsTileContent.js.
//
// - Every slot is a child of the one area for the tile's life: a placement shows, hides and moves slots, and never
//   moves one to another parent or reorders the area's children.
// - The area takes its size from the layout, never from its children, so a row moved or shown cannot change what
//   the tile asks of its parent; it clips to its own edge.
// - Rows stay with their session: a session still listed keeps its row, so a reorder only moves rows, with no text
//   set and no strip repainted. A session newly listed takes a row never used, or one whose session is not listed
//   (lib/sessionsTileSlots.js rowIndexesForSessions, as which slot a line takes is lineSlotOf).
// - Slots are built at construction and at a placement that needs more (ensureSlotsFor), never at an update: a row
//   for each session the tile can list, a heading and a "+N more" line for each state, and the labels and the
//   run-on heading for each column. None is destroyed before the tile is.
// - A slot is shown and hidden by visibility, whole; a cell inside one that comes and goes while the slot stays (a
//   labels row's strip axis) does so by opacity, with no room while absent (sessionsTileCells.js).
// - A shown row whose place changes hides the shared tooltip if it is hovered (the base's _hideTooltipIfHovered,
//   called after the row is shown), since no leave-event is promised for it; the row keeps showing.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {pixelLengthStyle, setActorStyle, setActorVisible, setLabelText} from './cockpitTileBase.js';
import {
    SESSION_GROUP_HEADING_COUNT_GAP_PX, SESSION_ROW_CELL_GAP_PX, SESSION_ROW_PADDING_INLINE_PX,
    SESSION_STRIP_WIDTH_PX,
} from './lib/drawingConstants.js';
import {LineKind} from './lib/measuredLengths.js';
import {SESSION_GROUP_ORDER} from './lib/sessionOrder.js';
import {SESSIONS_FLOW_ITEM_KIND} from './lib/sessionsFlow.js';
import {
    SESSIONS_TILE_COLUMN_LABELS, continuedHeadingText, groupHeadingText, moreLineText, sessionRowContent,
} from './lib/sessionsTileContent.js';
import {LineSlotKind, lineSlotOf, rowIndexesForSessions} from './lib/sessionsTileSlots.js';
import {cellGapStyle, showCell} from './sessionsTileCells.js';
import {SessionsTileRow} from './sessionsTileRow.js';

/** Each heading's, line's and labels row's room at each side, which a row carries too. */
const INLINE_PADDING_STYLE = pixelLengthStyle('padding-left', SESSION_ROW_PADDING_INLINE_PX) +
    pixelLengthStyle('padding-right', SESSION_ROW_PADDING_INLINE_PX);
/** A labels row's cell's gap after the one before it, as a row's; the labels row sets no spacing. */
const LABEL_GAP_STYLE = cellGapStyle(SESSION_ROW_CELL_GAP_PX);
/** The strip axis while the columns have strips: its gap, and the strip's width. */
const PRESENT_STRIP_AXIS_STYLE = LABEL_GAP_STYLE + pixelLengthStyle('width', SESSION_STRIP_WIDTH_PX);
const COLUMN_LABEL_STYLE_CLASS = `${LineKind.SCALE} rp-sessions-column-label`;
const CONTINUED_HEADING_STYLE_CLASS = `${LineKind.GROUP_HEADING} rp-sessions-group-heading-continued`;
const MORE_LINE_STYLE_CLASS = `${LineKind.DETAIL} rp-sessions-more-line`;

/**
 * @typedef {object} PlacedSlot An actor the area places, with the place it was last given.
 * @property {St.Widget} actor - The slot.
 * @property {{xPx: ?number, yPx: ?number, widthPx: ?number, heightPx: ?number}} place - Its last place.
 */

/**
 * Wraps an actor as a slot of the area, hidden and not yet placed.
 *
 * @param {St.Widget} actor - The slot's actor.
 * @param {object} [parts] - The slot's labels, by name.
 * @returns {PlacedSlot} The slot.
 */
function placedSlot(actor, parts = {}) {
    actor.visible = false;
    return {actor, ...parts, place: {xPx: null, yPx: null, widthPx: null, heightPx: null}};
}

/**
 * Moves and sizes a slot, only where its place changed, and shows it.
 *
 * @param {PlacedSlot} slot - The slot.
 * @param {{xPx: number, yPx: number, widthPx: number, heightPx: number}} place - Its place in the area.
 * @returns {void}
 */
function showSlotAt(slot, {xPx, yPx, widthPx, heightPx}) {
    if (slot.place.xPx !== xPx || slot.place.yPx !== yPx)
        slot.actor.set_position(xPx, yPx);
    if (slot.place.widthPx !== widthPx || slot.place.heightPx !== heightPx)
        slot.actor.set_size(widthPx, heightPx);
    slot.place = {xPx, yPx, widthPx, heightPx};
    setActorVisible(slot.actor, true);
}

/**
 * A label, its text centred in its slot's height.
 *
 * @param {string} styleClass - Its classes.
 * @param {object} [properties] - Other properties.
 * @returns {St.Label} The label, empty.
 */
function newCentredLabel(styleClass, properties = {}) {
    return new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...properties});
}

/**
 * Builds a group's heading slot: its words, and its count in a heavier label.
 *
 * @param {string} state - The group's state.
 * @returns {PlacedSlot} The slot, with its `count` label.
 */
function newHeadingSlot(state) {
    const actor = new St.BoxLayout({style: INLINE_PADDING_STYLE});
    actor.add_child(newCentredLabel(`${LineKind.GROUP_HEADING} rp-sessions-group-heading`,
        {text: groupHeadingText(state)}));
    const count = newCentredLabel(`${LineKind.GROUP_HEADING_COUNT} rp-sessions-group-heading-count`,
        {style: pixelLengthStyle('margin-left', SESSION_GROUP_HEADING_COUNT_GAP_PX)});
    actor.add_child(count);
    return placedSlot(actor, {count});
}

/**
 * Builds a slot of one line: a run-on heading or a "+N more" line.
 *
 * @param {string} styleClass - The line's classes.
 * @returns {PlacedSlot} The slot, with its `label`.
 */
function newLineSlot(styleClass) {
    const actor = new St.BoxLayout({style: INLINE_PADDING_STYLE});
    const label = newCentredLabel(styleClass);
    actor.add_child(label);
    return placedSlot(actor, {label});
}

/**
 * Builds a column's labels: "1 h" and "now" over the strip, "idle" over the age and "mem" over the memory.
 *
 * @returns {PlacedSlot} The slot, with its `stripAxis`, `ageLabel` and `memoryLabel`.
 */
function newLabelsRowSlot() {
    const actor = new St.BoxLayout({style: INLINE_PADDING_STYLE});
    actor.add_child(new St.Widget({x_expand: true}));
    const stripAxis = new St.BoxLayout();
    showCell(stripAxis, false, PRESENT_STRIP_AXIS_STYLE);
    stripAxis.add_child(newCentredLabel(COLUMN_LABEL_STYLE_CLASS, {text: SESSIONS_TILE_COLUMN_LABELS.stripStart}));
    stripAxis.add_child(new St.Widget({x_expand: true}));
    stripAxis.add_child(newCentredLabel(COLUMN_LABEL_STYLE_CLASS, {text: SESSIONS_TILE_COLUMN_LABELS.stripEnd}));
    const ageLabel = newCentredLabel(COLUMN_LABEL_STYLE_CLASS,
        {text: SESSIONS_TILE_COLUMN_LABELS.age, style: LABEL_GAP_STYLE});
    const memoryLabel = newCentredLabel(COLUMN_LABEL_STYLE_CLASS,
        {text: SESSIONS_TILE_COLUMN_LABELS.memory, style: LABEL_GAP_STYLE});
    for (const child of [stripAxis, ageLabel, memoryLabel])
        actor.add_child(child);
    return placedSlot(actor, {stripAxis, ageLabel, memoryLabel});
}

/**
 * The columns of the Sessions tile, and every slot in them.
 */
export class SessionsTileColumns {
    /**
     * Builds the area with a heading and a "+N more" line for each state; rows, labels and run-on headings come with
     * ensureSlotsFor.
     *
     * @param {object} tile - What the area needs of its tile.
     * @param {function(St.Widget): object} tile.addHoverRow - Makes an actor one of the tile's hover rows.
     * @param {function(object, string[], string): void} tile.showHoverRow - Shows a hover row with its tooltip lines
     *     and the id a click activates.
     * @param {function(object): void} tile.hideHoverRow - Hides a hover row, and the tooltip if it is hovered.
     * @param {function(object): void} tile.hideTooltipIfHovered - Hides the tooltip if a shown hover row is under the
     *     pointer, for a row moved or resized while it stays shown.
     * @returns {void}
     */
    constructor({addHoverRow, showHoverRow, hideHoverRow, hideTooltipIfHovered}) {
        this._tile = {addHoverRow, showHoverRow, hideHoverRow, hideTooltipIfHovered};
        this.actor = new St.Widget({
            clip_to_allocation: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.START,
        });
        /** @type {SessionsTileRow[]} */
        this._rows = [];
        /** @type {PlacedSlot[]} Each column's labels. */
        this._labelsRows = [];
        /** @type {PlacedSlot[]} The run-on heading of each column after the first, by its column's index less 1. */
        this._continuedSlots = [];
        this._headingSlotByState = Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, newHeadingSlot(state)]));
        this._moreSlotByState = Object.fromEntries(SESSION_GROUP_ORDER.map(state =>
            [state, newLineSlot(MORE_LINE_STYLE_CLASS)]));
        for (const slot of [...Object.values(this._headingSlotByState), ...Object.values(this._moreSlotByState)])
            this.actor.add_child(slot.actor);
        this._textWidthsPx = null;
        this._areaSize = {widthPx: null, heightPx: null};
    }

    /**
     * Builds the slots a placement needs over those built: a row for each session it can list, and the labels and
     * run-on heading of each of its columns. Builds nothing where enough are built; never removes one.
     *
     * @param {{columnCount: number, rowCount: number}} counts - The placement's columns, and the most sessions it
     *     lists (lib/sessionsFlow.js mostSessionsATileLists).
     * @returns {void}
     */
    ensureSlotsFor({columnCount, rowCount}) {
        while (this._rows.length < rowCount)
            this._addRow();
        while (this._labelsRows.length < columnCount)
            this._addSlot(this._labelsRows, newLabelsRowSlot());
        while (this._continuedSlots.length < columnCount - 1)
            this._addSlot(this._continuedSlots, newLineSlot(CONTINUED_HEADING_STYLE_CLASS));
        if (this._textWidthsPx !== null)
            this.setTextWidths(this._textWidthsPx);
    }

    /**
     * Builds one row, hidden, as one of the tile's hover rows.
     *
     * @returns {void}
     */
    _addRow() {
        const row = new SessionsTileRow();
        this.actor.add_child(row.actor);
        row.hoverRow = this._tile.addHoverRow(row.actor);
        this._rows.push(row);
    }

    /**
     * Adds a slot to the area and to its list.
     *
     * @param {PlacedSlot[]} slots - The list.
     * @param {PlacedSlot} slot - The slot.
     * @returns {void}
     */
    _addSlot(slots, slot) {
        this.actor.add_child(slot.actor);
        slots.push(slot);
    }

    /**
     * Sets the columns' text widths: each row's age and memory, and the labels over them.
     *
     * @param {{age: number, memory: number}} textWidthsPx - The sample widths, whole.
     * @returns {void}
     */
    setTextWidths(textWidthsPx) {
        this._textWidthsPx = textWidthsPx;
        for (const row of this._rows)
            row.setTextWidths(textWidthsPx);
        for (const labelsRow of this._labelsRows) {
            setActorStyle(labelsRow.ageLabel, LABEL_GAP_STYLE + pixelLengthStyle('width', textWidthsPx.age));
            setActorStyle(labelsRow.memoryLabel, LABEL_GAP_STYLE + pixelLengthStyle('width', textWidthsPx.memory));
        }
    }

    /**
     * Sizes the area from the layout, only when its size changed.
     *
     * @param {number} widthPx - The width inside the tile's side padding.
     * @param {number} heightPx - The column labels' and the flow's height.
     * @returns {void}
     */
    setAreaSize(widthPx, heightPx) {
        if (this._areaSize.widthPx === widthPx && this._areaSize.heightPx === heightPx)
            return;
        this._areaSize = {widthPx, heightPx};
        this.actor.set_size(widthPx, heightPx);
    }

    /**
     * Shows the flow: each item shown where it stands, every slot it does not use hidden.
     *
     * @param {object} placement - What to show and where.
     * @param {Array<Array<object>>} placement.itemPlaces - Each column's item places (lib/sessionsTileGeometry.js
     *     sessionsItemPlaces).
     * @param {{columnWidthPx: number, columnXsPx: number[]}} placement.columns - The columns' geometry.
     * @param {number} placement.labelsRowHeightPx - The column labels' height, above the flow.
     * @param {Object<string, Array<object>>} placement.rowsByState - Each group's sessions, in its order.
     * @param {boolean} placement.hasStripColumn - Whether the columns have strips.
     * @returns {void}
     */
    place({itemPlaces, columns, labelsRowHeightPx, rowsByState, hasStripColumn}) {
        const shownSlots = new Set();
        const listedRows = [];
        itemPlaces.forEach((columnPlaces, columnIndex) => {
            const xPx = columns.columnXsPx[columnIndex];
            const widthPx = columns.columnWidthPx;
            if (columnPlaces.length > 0) {
                const labelsRow = this._labelsRows[columnIndex];
                showCell(labelsRow.stripAxis, hasStripColumn, PRESENT_STRIP_AXIS_STYLE);
                showSlotAt(labelsRow, {xPx, yPx: 0, widthPx, heightPx: labelsRowHeightPx});
                shownSlots.add(labelsRow);
            }
            for (const itemPlace of columnPlaces.filter(place => place.isShown)) {
                const slotPlace = {xPx, yPx: labelsRowHeightPx + itemPlace.drawnTopPx, widthPx,
                    heightPx: itemPlace.drawnHeightPx};
                const {item} = itemPlace;
                if (item.kind === SESSIONS_FLOW_ITEM_KIND.ROW)
                    listedRows.push({session: rowsByState[item.state][item.indexInGroup], slotPlace});
                else
                    shownSlots.add(this._showLine(item, columnIndex, slotPlace));
            }
        });
        for (const slot of this._lineSlots()) {
            if (!shownSlots.has(slot))
                setActorVisible(slot.actor, false);
        }
        this._showRows(listedRows, hasStripColumn);
    }

    /**
     * Hides every slot: the tile lists nothing.
     *
     * @returns {void}
     */
    hideAll() {
        for (const slot of this._lineSlots())
            setActorVisible(slot.actor, false);
        for (const row of this._rows)
            this._tile.hideHoverRow(row.hoverRow);
    }

    /**
     * Every slot but the rows.
     *
     * @returns {PlacedSlot[]} The slots.
     */
    _lineSlots() {
        return [
            ...this._labelsRows, ...this._continuedSlots, ...Object.values(this._headingSlotByState),
            ...Object.values(this._moreSlotByState),
        ];
    }

    /**
     * Shows a heading, a run-on heading or a "+N more" line at its place.
     *
     * @param {object} item - The flow's item.
     * @param {number} columnIndex - Its column.
     * @param {{xPx: number, yPx: number, widthPx: number, heightPx: number}} slotPlace - Its place in the area.
     * @returns {PlacedSlot} The slot shown.
     */
    _showLine(item, columnIndex, slotPlace) {
        const {slotKind, state, continuedIndex} = lineSlotOf(item, columnIndex);
        let slot;
        if (slotKind === LineSlotKind.HEADING) {
            slot = this._headingSlotByState[state];
            setLabelText(slot.count, String(item.count));
        } else if (slotKind === LineSlotKind.CONTINUED) {
            slot = this._continuedSlots[continuedIndex];
            setLabelText(slot.label, continuedHeadingText(state));
        } else {
            slot = this._moreSlotByState[state];
            setLabelText(slot.label, moreLineText(item.hiddenCount));
        }
        showSlotAt(slot, slotPlace);
        return slot;
    }

    /**
     * Shows each listed session in a row, a session still listed in the row it had, and hides the rows left over.
     *
     * @param {Array<{session: object, slotPlace: object}>} listedRows - The sessions listed, with their places.
     * @param {boolean} hasStripColumn - Whether the columns have strips.
     * @returns {void}
     */
    _showRows(listedRows, hasStripColumn) {
        const rowIndexes = rowIndexesForSessions(this._rows.map(row => row.sessionId),
            listedRows.map(({session}) => session.id));
        const shownRows = new Set();
        listedRows.forEach(({session, slotPlace}, listedIndex) => {
            const rowIndex = rowIndexes[listedIndex];
            // Every row taken: this session is not shown, and those after it still are.
            if (rowIndex === null)
                return;
            const row = this._rows[rowIndex];
            shownRows.add(row);
            this._showRow(row, session, slotPlace, hasStripColumn);
        });
        for (const row of this._rows) {
            if (!shownRows.has(row))
                this._tile.hideHoverRow(row.hoverRow);
        }
    }

    /**
     * Shows one session in a row at its place; a hovered row moved or resized (a new placement, a new text size)
     * hides the tooltip, and keeps showing.
     *
     * @param {SessionsTileRow} row - The row.
     * @param {object} session - The session row.
     * @param {{xPx: number, yPx: number, widthPx: number, heightPx: number}} slotPlace - Its place in the area.
     * @param {boolean} hasStripColumn - Whether the columns have strips.
     * @returns {void}
     */
    _showRow(row, session, slotPlace, hasStripColumn) {
        const content = sessionRowContent(session, {hasStripColumn});
        row.showSession(content, hasStripColumn);
        const hasPlaceChanged = row.setPlace(slotPlace);
        this._tile.showHoverRow(row.hoverRow, content.tooltipLines, content.id);
        // After the row is shown: before, a row whose lines also changed would show its tooltip again.
        if (hasPlaceChanged)
            this._tile.hideTooltipIfHovered(row.hoverRow);
    }
}
