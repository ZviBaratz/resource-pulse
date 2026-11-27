// The cockpit's Sessions tile: a header ("Sessions 42", each state's mark and count, the memory of them all), and the
// sessions in their groups, flowed down one or more columns (lib/sessionsFlow.js), each column under its labels.
// Shell glue only, on the base every tile shares (cockpitTileBase.js): the flow decides what each column lists, and
// lib/sessionsTileContent.js and lib/sessionsTileGeometry.js what each part says and where it stands.
//
// - Built once: the header, the columns' area and SESSIONS_TILE_FIRST_ROW_COUNT rows with the tile; a placement whose
//   flow can list more builds the rest then, and no update makes or destroys an actor.
// - A placement (setLayout) is the tile's rectangle, its column count, its lengths and its text widths. The tile
//   calls the flow at every render with those same figures, so what it lists is what the layout counted. The column
//   count is the caller's: the tile never changes one the layout gives, and bounds any other as the flow does.
// - Every drawn height is the length the flow was handed, so a column drawn is the flow's column to the pixel.
// - With nothing to list the tile says why in one line under its title (lib/sessionsTileContent.js
//   sessionsTileShortState); a stale source's line is the drawing's (showNoData).
// - Its rows light on hover, show today's tooltip lines and take a click, which activates their session.
// - The header's count, state counts and memory come and go by opacity, each left visible, and an absent state count
//   or memory takes no room (sessionsTileCells.js): the header sets no spacing, and each carries its own gap.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {CockpitTileBase, pixelLengthStyle, setActorOpaque, setActorStyle, setLabelText} from './cockpitTileBase.js';
import {
    SESSION_CELL_NO_ROOM_PX, SESSION_MARK_SIZE_PX, SESSION_ROW_PADDING_INLINE_PX, SESSION_STATE_COUNT_GAP_PX,
    SESSION_STATE_COUNTS_GAP_PX, SESSIONS_HEADER_ITEM_GAP_PX, SESSIONS_TILE_FIRST_ROW_COUNT,
    SESSIONS_TITLE_COUNT_GAP_PX, TILE_BORDER_WIDTH_PX, TILE_TITLE_GAP_BELOW_PX,
} from './lib/drawingConstants.js';
import {stateIconName} from './lib/cockpitFormat.js';
import {DEFAULT_COCKPIT_SIZES, MOST_SESSIONS_COLUMN_COUNT} from './lib/cockpitCompositionSizes.js';
import {LineKind} from './lib/measuredLengths.js';
import {SESSION_GROUP_ORDER} from './lib/sessionOrder.js';
import {
    DEFAULT_SESSIONS_TILE_LENGTHS, boundedCount, mostSessionsATileLists, sessionsFlow,
    sessionsTileLengthsInWholePixels,
} from './lib/sessionsFlow.js';
import {
    SESSIONS_TILE_TITLE, hasStateHistories, sessionsInGroups, sessionsTileHeader, sessionsTileShortState,
} from './lib/sessionsTileContent.js';
import {
    hasStripColumn, sessionsColumnsGeometry, sessionsItemPlaces, sessionsTextWidthsInWholePixels,
    sessionsTileBlockHeights,
} from './lib/sessionsTileGeometry.js';
import {lineBoxOrDefaultPx} from './lib/tileLineBoxes.js';
import {cellGapStyle, showCell} from './sessionsTileCells.js';
import {SessionsTileColumns} from './sessionsTileColumns.js';

/** The tile's side padding, both sides together, from its edge: the composition's default sheet's. */
const DEFAULT_SIDE_PADDING_PX = DEFAULT_COCKPIT_SIZES.sessions.sidePaddingPx;
/** The header's room at each side and under it; no spacing, since its state counts and memory carry their gaps. */
const HEADER_STYLE = pixelLengthStyle('padding-left', SESSION_ROW_PADDING_INLINE_PX) +
    pixelLengthStyle('padding-right', SESSION_ROW_PADDING_INLINE_PX) +
    pixelLengthStyle('margin-bottom', TILE_TITLE_GAP_BELOW_PX);
/** The gap before the state counts, after the title, and before the memory, after the counts. */
const HEADER_ITEM_GAP_STYLE = cellGapStyle(SESSIONS_HEADER_ITEM_GAP_PX);
/** The gap before a state's count that follows another's. */
const STATE_COUNT_GAP_STYLE = cellGapStyle(SESSION_STATE_COUNTS_GAP_PX);
/** The first state count shown: no gap before it, as the state counts' box carries the gap after the title. */
const FIRST_STATE_COUNT_STYLE = cellGapStyle(SESSION_CELL_NO_ROOM_PX);

/**
 * The tile's padding inside its border at each side: half its side padding, less the border.
 *
 * @param {number} sidePaddingPx - The tile's side padding, both sides together, from its edge.
 * @returns {number} The padding at each side, never below 0.
 */
function paddingInsideBorderPx(sidePaddingPx) {
    return Math.max(0, sidePaddingPx / 2 - TILE_BORDER_WIDTH_PX);
}

/**
 * Builds one state's count in the header: its mark, named for the state once, and its count.
 *
 * @param {string} state - The state.
 * @returns {{box: St.BoxLayout, countLabel: St.Label}} The count, hidden.
 */
function newStateCount(state) {
    const box = new St.BoxLayout();
    showCell(box, false, FIRST_STATE_COUNT_STYLE);
    box.add_child(new St.Icon({
        style_class: `rp-sessions-mark-${state}`, icon_name: stateIconName(state), icon_size: SESSION_MARK_SIZE_PX,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    const countLabel = new St.Label({
        style_class: `${LineKind.ROW} rp-sessions-state-count`, y_align: Clutter.ActorAlign.CENTER,
        style: pixelLengthStyle('margin-left', SESSION_STATE_COUNT_GAP_PX),
    });
    box.add_child(countLabel);
    return {box, countLabel};
}

/**
 * The Sessions tile.
 */
export const SessionsTile = GObject.registerClass(
class SessionsTile extends CockpitTileBase {
    /**
     * Builds the tile with its header, its columns' area and its first rows. It records "no data" under its title at
     * once, which a tile covered before its first update draws as it is first mapped; it lists no session until it is
     * placed (setLayout).
     *
     * @param {object} options - The tile's options.
     * @param {import('./cockpitTooltip.js').CockpitTooltip} options.tooltip - The tooltip every tile shares.
     * @param {function(string): void} options.onSessionActivated - Called with a session's id when its row is
     *     clicked.
     * @param {number} [options.sidePaddingPx] - The tile's side padding, both sides together, from its edge: the
     *     composition's sheet's, so that the tile and the composition hold one figure. Fixed for the tile's life.
     * @returns {void}
     */
    _init({tooltip, onSessionActivated, sidePaddingPx = DEFAULT_SIDE_PADDING_PX}) {
        super._init({
            tooltip, tileStyleClass: 'rp-sessions-tile', noDataStyleClass: 'rp-sessions-no-data',
            paddingInlinePx: paddingInsideBorderPx(sidePaddingPx),
            noDataInlineInsetPx: SESSION_ROW_PADDING_INLINE_PX, onRowActivated: onSessionActivated,
        });
        /** The side padding the tile was built with, which its columns' geometry reads. */
        this._sidePaddingPx = sidePaddingPx;
        this._buildHeader();
        this._columns = new SessionsTileColumns({
            addHoverRow: actor => this._addHoverRow(actor),
            showHoverRow: (hoverRow, tooltipLines, sessionId) => this._showHoverRow(hoverRow, tooltipLines, sessionId),
            hideHoverRow: hoverRow => this._hideHoverRow(hoverRow),
            hideTooltipIfHovered: hoverRow => this._hideTooltipIfHovered(hoverRow),
        });
        this._columns.ensureSlotsFor({columnCount: 1, rowCount: SESSIONS_TILE_FIRST_ROW_COUNT});
        this._dataBox.add_child(this._columns.actor);
        /** @type {object|null} The latest placement, in the figures each render reads. */
        this._placement = null;
        this.update(null);
    }

    /**
     * Builds the header: the title and its count, each state's count, and the memory. It is the tile's title, so it
     * stays above the data while the tile's one line is shown in place of the data. It has no hover row.
     *
     * @returns {void}
     */
    _buildHeader() {
        this._header = new St.BoxLayout({style: HEADER_STYLE});
        const titleBox = new St.BoxLayout({x_expand: true, y_align: Clutter.ActorAlign.END});
        titleBox.add_child(new St.Label({
            style_class: `${LineKind.TITLE} rp-sessions-title`, text: SESSIONS_TILE_TITLE,
        }));
        this._countLabel = new St.Label({
            style_class: `${LineKind.TITLE_COUNT} rp-sessions-title-count`,
            style: pixelLengthStyle('margin-left', SESSIONS_TITLE_COUNT_GAP_PX),
        });
        setActorOpaque(this._countLabel, false);
        titleBox.add_child(this._countLabel);
        this._stateCountsBox = new St.BoxLayout({y_align: Clutter.ActorAlign.END});
        showCell(this._stateCountsBox, false, HEADER_ITEM_GAP_STYLE);
        this._stateCountByState = Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, newStateCount(state)]));
        for (const {box} of Object.values(this._stateCountByState))
            this._stateCountsBox.add_child(box);
        this._totalMemoryLabel = new St.Label({
            style_class: `${LineKind.DETAIL} rp-sessions-total-memory`, y_align: Clutter.ActorAlign.END,
        });
        showCell(this._totalMemoryLabel, false, HEADER_ITEM_GAP_STYLE);
        for (const child of [titleBox, this._stateCountsBox, this._totalMemoryLabel])
            this._header.add_child(child);
        this._addTitleActor(this._header);
    }

    /**
     * Places the tile: its size, its columns and the lengths and text widths it draws with. Builds the rows the
     * placement can list over those built. Frozen, the size is set at once and the drawing only recorded. After
     * destroy it does nothing.
     *
     * @param {object} layout - The placement.
     * @param {number} layout.widthPx - The tile's width.
     * @param {number} layout.heightPx - The tile's height.
     * @param {number} layout.columnCount - Its columns, as the layout holds them: a whole number from 0 to
     *     MOST_SESSIONS_COLUMN_COUNT, as the flow bounds it; any other is bounded the flow's way.
     * @param {object} layout.lengths - The flow's lengths (cockpitLengthsMeasurer.js sessionsLengths).
     * @param {object} [layout.lineBoxesPx] - The measured line boxes, keyed by LineKind value.
     * @param {object} [layout.textWidthsPx] - The sample widths (lib/sessionsTileGeometry.js
     *     SESSIONS_WIDTH_SAMPLE_TEXTS); the default text size's where not given.
     * @param {number} layout.columnGapPx - The gap between two columns, from the layout's sheet.
     * @returns {void}
     */
    setLayout({widthPx, heightPx, columnCount: heldColumnCount, lengths, lineBoxesPx, textWidthsPx, columnGapPx}) {
        if (this._isDestroyed)
            return;
        // Bounded as the flow bounds it, so the columns built and laid out are the flow's, and a count no layout
        // gives (a fraction, Infinity) builds no column past the flow's last.
        const columnCount = boundedCount(heldColumnCount, MOST_SESSIONS_COLUMN_COUNT);
        const flowTile = {columnCount, tileHeightPx: heightPx, lengths};
        const wholeLengths = sessionsTileLengthsInWholePixels(lengths) ?? DEFAULT_SESSIONS_TILE_LENGTHS;
        const wholeTextWidthsPx = sessionsTextWidthsInWholePixels(textWidthsPx);
        const blockHeights = sessionsTileBlockHeights({
            tileHeightPx: Math.floor(heightPx), lengths: wholeLengths,
            titleLineBoxPx: lineBoxOrDefaultPx(lineBoxesPx, LineKind.TITLE),
        });
        const columns = sessionsColumnsGeometry({
            tileWidthPx: widthPx, columnCount, columnGapPx, sidePaddingPx: this._sidePaddingPx,
        });
        this._placement = {flowTile, wholeLengths, wholeTextWidthsPx, blockHeights, columns};
        this.setTileSize(widthPx, heightPx);
        this._columns.ensureSlotsFor({columnCount, rowCount: mostSessionsATileLists(flowTile)});
        this._columns.setTextWidths(wholeTextWidthsPx);
        setActorStyle(this._header, HEADER_STYLE + pixelLengthStyle('height', blockHeights.headerHeightPx));
        this._columns.setAreaSize(columns.areaWidthPx, blockHeights.labelsRowHeightPx + blockHeights.flowHeightPx);
        this._redrawLatestRender();
    }

    /**
     * Draws a sessions source: its sessions in their groups, or the one line that says why there are none. Frozen,
     * it is only recorded; after destroy it does nothing. drawCockpitDataCard calls it.
     *
     * @param {object|null} sessions - A sessions source (lib/cockpitProtocol.js parseSessionsSource).
     * @returns {void}
     */
    update(sessions) {
        if (this._isDestroyed)
            return;
        this._renderUnlessFrozen(() => this._renderSessions(sessions));
    }

    /**
     * Shows one line in place of the sessions, under the title alone: a stale source's "no data since HH:MM". After
     * destroy it does nothing.
     *
     * @param {string} text - The line.
     * @returns {void}
     */
    showNoData(text) {
        if (this._isDestroyed)
            return;
        this._renderUnlessFrozen(() => this._renderShortState({lineText: text, isCountShown: false}));
    }

    /**
     * Draws a sessions source.
     *
     * @param {object|null} sessions - A sessions source.
     * @returns {void}
     */
    _renderSessions(sessions) {
        const shortState = sessionsTileShortState(sessions);
        if (shortState !== null) {
            this._renderShortState(shortState);
            return;
        }
        const {rowsByState, sessionCountByState} = sessionsInGroups(sessions.rows);
        this._showHeader(sessionsTileHeader({sessionCountByState, totalMemoryBytes: sessions.totalMemoryBytes}));
        this._setDataShown(true);
        this._placeColumns(rowsByState, sessionCountByState, hasStateHistories(sessions.rows));
    }

    /**
     * Draws the one line that says why the tile lists nothing, under its title, with "0" beside it only where the
     * service lists no session.
     *
     * @param {{lineText: string, isCountShown: boolean}} shortState - The line, and whether the count shows.
     * @returns {void}
     */
    _renderShortState({lineText, isCountShown}) {
        setLabelText(this._countLabel, '0');
        setActorOpaque(this._countLabel, isCountShown);
        this._showStateCounts({});
        showCell(this._totalMemoryLabel, false, HEADER_ITEM_GAP_STYLE);
        this._renderNoData(lineText);
    }

    /**
     * Shows the header's count, each state's count and the memory.
     *
     * @param {object} header - The header (lib/sessionsTileContent.js sessionsTileHeader).
     * @returns {void}
     */
    _showHeader({countText, stateCounts, totalMemoryText}) {
        setLabelText(this._countLabel, countText);
        setActorOpaque(this._countLabel, true);
        this._showStateCounts(Object.fromEntries(stateCounts.map(({state, countText: text}) => [state, text])));
        if (totalMemoryText !== null)
            setLabelText(this._totalMemoryLabel, totalMemoryText);
        showCell(this._totalMemoryLabel, totalMemoryText !== null, HEADER_ITEM_GAP_STYLE);
    }

    /**
     * Shows each state's count that has one, in the groups' order, and leaves the others absent: the first shown
     * takes no gap, each after it its own, and the counts' box its gap after the title while any is shown.
     *
     * @param {Object<string, string>} countTextByState - The count of each state shown, as drawn.
     * @returns {void}
     */
    _showStateCounts(countTextByState) {
        let isAfterShownCount = false;
        for (const [state, {box, countLabel}] of Object.entries(this._stateCountByState)) {
            const stateCountText = countTextByState[state];
            const isShown = stateCountText !== undefined;
            if (isShown)
                setLabelText(countLabel, stateCountText);
            showCell(box, isShown, isAfterShownCount ? STATE_COUNT_GAP_STYLE : FIRST_STATE_COUNT_STYLE);
            isAfterShownCount ||= isShown;
        }
        showCell(this._stateCountsBox, isAfterShownCount, HEADER_ITEM_GAP_STYLE);
    }

    /**
     * Flows the groups into the columns and shows each item where it stands. Not yet placed, the tile lists nothing.
     *
     * @param {Object<string, Array<object>>} rowsByState - Each group's sessions, in its order.
     * @param {Object<string, number>} sessionCountByState - Each group's count.
     * @param {boolean} hasHistories - Whether the service publishes the sessions' state histories.
     * @returns {void}
     */
    _placeColumns(rowsByState, sessionCountByState, hasHistories) {
        if (this._placement === null) {
            this._columns.hideAll();
            return;
        }
        const {flowTile, wholeLengths, wholeTextWidthsPx, blockHeights, columns} = this._placement;
        const flow = sessionsFlow({...flowTile, sessionCountByState});
        this._columns.place({
            itemPlaces: sessionsItemPlaces(flow.columns, wholeLengths, blockHeights.flowHeightPx),
            columns,
            labelsRowHeightPx: blockHeights.labelsRowHeightPx,
            rowsByState,
            hasStripColumn: hasStripColumn({
                columnWidthPx: columns.columnWidthPx, textWidthsPx: wholeTextWidthsPx, hasStateHistories: hasHistories,
            }),
        });
    }
});
