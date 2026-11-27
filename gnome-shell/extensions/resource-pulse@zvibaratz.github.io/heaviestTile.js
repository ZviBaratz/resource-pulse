// The cockpit's Heaviest tile: its title and two rankings side by side, "by CPU" and "by memory", each row a name, a
// bar against the largest of its own ranking and the value; the no-data line in place of the rankings. Shell glue
// only: the rows' words, bars and tooltips, the widths and the heights come finished from lib/heaviestRankings.js,
// and the tile only assigns them, on the base every cockpit tile shares (cockpitTileBase.js).
//
// - Built once: the title, both headings and HEAVIEST_ROW_SLOT_COUNT row slots a ranking; an update shows as many rows
//   as the layout asks and hides the rest. Every length is an inline style built from lib/drawingConstants.js and
//   the line boxes it is handed, so the heights it draws are the layout's.
// - A row lights on hover and shows the apps card's tooltip (its group key); no row takes a click.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    CockpitTileBase, pixelLengthStyle, setActorStyle, setActorVisible, setLabelText,
} from './cockpitTileBase.js';
import {
    RANKING_HEADING_GAP_BELOW_PX, RANKING_ROW_ITEM_GAP_PX, TILE_TITLE_GAP_BELOW_PX,
} from './lib/drawingConstants.js';
import {
    barFillWidthPx, canDrawHeaviest, DEFAULT_HEAVIEST_TEXT_WIDTHS_PX, heaviestColumnLayout, heaviestHeightsPx,
    heaviestNoDataText, heaviestRankingRows, heaviestWidthsPx,
} from './lib/heaviestRankings.js';
import {LineKind} from './lib/measuredLengths.js';

/** The row slots each ranking builds: the most rows the sampler publishes a ranking. */
const HEAVIEST_ROW_SLOT_COUNT = 10;
const TITLE_TEXT = 'Heaviest';
const CPU_HEADING_TEXT = 'by CPU';
const MEMORY_HEADING_TEXT = 'by memory';
const TILE_STYLE_CLASS = 'rp-heaviest-tile';
const NO_DATA_STYLE_CLASS = 'rp-heaviest-no-data';
const TITLE_STYLE_CLASS = `${LineKind.TITLE} rp-heaviest-title`;
const HEADING_STYLE_CLASS = `${LineKind.DETAIL} rp-heaviest-heading`;
const ROW_STYLE_CLASS = 'rp-heaviest-row';
const NAME_STYLE_CLASS = `${LineKind.ROW} rp-heaviest-name`;
const VALUE_STYLE_CLASS = `${LineKind.ROW} rp-heaviest-value`;
const BAR_TRACK_STYLE_CLASS = 'rp-heaviest-bar-track';
const CPU_BAR_STYLE_CLASS = 'rp-heaviest-bar rp-heaviest-bar-cpu';
const MEMORY_BAR_STYLE_CLASS = 'rp-heaviest-bar rp-heaviest-bar-memory';

/**
 * @typedef {object} RankingRowSlot One row slot of a ranking, built once.
 * @property {import('./cockpitTileBase.js').HoverRow} hoverRow - The row, with its tooltip.
 * @property {St.Label} nameLabel - The app's name.
 * @property {St.Widget} barTrack - The bar's track.
 * @property {St.Widget} barFill - The bar.
 * @property {St.Label} valueLabel - The value.
 * @property {number} barFraction - The fraction the bar was last drawn with.
 */

/**
 * @typedef {object} RankingColumn One ranking, built once.
 * @property {St.BoxLayout} box - The column.
 * @property {St.Label} headingLabel - "by CPU" or "by memory".
 * @property {RankingRowSlot[]} rowSlots - Its row slots.
 */

/**
 * The Heaviest tile. setLayout gives it its size, its row count and its text's lengths; update draws a scan's apps.
 */
export const HeaviestTile = GObject.registerClass(
class HeaviestTile extends CockpitTileBase {
    /**
     * Builds the tile, every actor it will show: the title, two rankings of HEAVIEST_ROW_SLOT_COUNT row slots, and the
     * no-data line, which it shows until its first update.
     *
     * @param {object} options - The tile's options.
     * @param {import('./cockpitTooltip.js').CockpitTooltip} options.tooltip - The tooltip every tile shares.
     * @returns {void}
     */
    _init({tooltip}) {
        super._init({tooltip, tileStyleClass: TILE_STYLE_CLASS, noDataStyleClass: NO_DATA_STYLE_CLASS});
        this._rankingRowCount = 0;
        this._layout = null;
        this._titleLabel = this._addTitleLabel(TITLE_TEXT, TITLE_STYLE_CLASS);
        this._rankingsBox = new St.BoxLayout({orientation: Clutter.Orientation.HORIZONTAL});
        this._cpuColumn = this._buildRankingColumn(CPU_HEADING_TEXT, CPU_BAR_STYLE_CLASS);
        this._memoryColumn = this._buildRankingColumn(MEMORY_HEADING_TEXT, MEMORY_BAR_STYLE_CLASS);
        this._dataBox.add_child(this._rankingsBox);
        this.showNoData(heaviestNoDataText(null));
    }

    /**
     * Lays the tile out: its size, how many rows each ranking shows, and every length from the line boxes and the
     * sample widths; then draws the latest update again. A frozen tile is laid out too, and draws at the reveal.
     *
     * @param {object} layout - The tile's layout.
     * @param {number} layout.widthPx - The tile's width.
     * @param {number} layout.heightPx - Its height.
     * @param {number} layout.rankingRowCount - The rows each ranking shows, at most HEAVIEST_ROW_SLOT_COUNT.
     * @param {*} layout.lineBoxesPx - The measured line boxes, keyed by LineKind value.
     * @param {{rankingName: number, rankingValue: number}} [layout.textWidthsPx] - The sample widths; the default
     *     text size's when not handed in.
     * @param {number} [layout.stopWidthPx] - Where the tile stops gaining width; heaviestWidthsPx's when not handed
     *     in.
     * @returns {void}
     */
    setLayout({widthPx, heightPx, rankingRowCount, lineBoxesPx, textWidthsPx = DEFAULT_HEAVIEST_TEXT_WIDTHS_PX,
        stopWidthPx = heaviestWidthsPx(textWidthsPx).stopWidthPx.totalPx}) {
        this.setTileSize(widthPx, heightPx);
        this._rankingRowCount = Math.min(HEAVIEST_ROW_SLOT_COUNT, rankingRowCount);
        const columns = heaviestColumnLayout({tileWidthPx: widthPx, stopWidthPx, textWidthsPx});
        const heights = heaviestHeightsPx(lineBoxesPx);
        this._layout = {columns, heights};
        this._applyLengths();
        this._redrawLatestRender();
    }

    /**
     * Draws a scan's apps, or the no-data line when they cannot be drawn ("no data since HH:MM" after a scan that
     * could). Frozen, it is only recorded.
     *
     * @param {object|null} apps - A pulse snapshot's apps.
     * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with apps, or null.
     * @returns {void}
     */
    update(apps, lastGoodClockLabel) {
        if (!canDrawHeaviest(apps)) {
            this.showNoData(heaviestNoDataText(lastGoodClockLabel));
            return;
        }
        this._renderUnlessFrozen(() => this._renderRankings(apps));
    }

    /**
     * Builds one ranking: its heading and its row slots, hidden until given content.
     *
     * @param {string} headingText - "by CPU" or "by memory".
     * @param {string} barStyleClass - The bar's classes, its colour with them.
     * @returns {RankingColumn} The ranking.
     */
    _buildRankingColumn(headingText, barStyleClass) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        const headingLabel = new St.Label({style_class: HEADING_STYLE_CLASS, text: headingText});
        box.add_child(headingLabel);
        const rowSlots = Array.from({length: HEAVIEST_ROW_SLOT_COUNT}, () => this._buildRowSlot(box, barStyleClass));
        this._rankingsBox.add_child(box);
        return {box, headingLabel, rowSlots};
    }

    /**
     * Builds one row slot, hidden: a name that ellipsizes at its end, a bar in its track, and a value that is never
     * cut. Built non-reactive (setInteractive makes it take the pointer); it tracks hover for its :hover rule.
     *
     * @param {St.BoxLayout} columnBox - Where the row goes.
     * @param {string} barStyleClass - The bar's classes.
     * @returns {RankingRowSlot} The slot.
     */
    _buildRowSlot(columnBox, barStyleClass) {
        const rowActor = new St.BoxLayout({
            style_class: ROW_STYLE_CLASS, reactive: false, track_hover: true, visible: false,
        });
        const nameLabel = new St.Label({style_class: NAME_STYLE_CLASS, y_align: Clutter.ActorAlign.CENTER});
        nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const barTrack = new St.Widget({
            style_class: BAR_TRACK_STYLE_CLASS, layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Expanding, so the track's BinLayout gives it the whole track and its own alignment puts it at the start.
        const barFill = new St.Widget({
            style_class: barStyleClass, x_expand: true, x_align: Clutter.ActorAlign.START,
        });
        const valueLabel = new St.Label({style_class: VALUE_STYLE_CLASS, y_align: Clutter.ActorAlign.CENTER});
        valueLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        // The label is its column's width; its text, never wrapped, ends at the column's end.
        valueLabel.clutter_text.x_align = Clutter.ActorAlign.END;
        barTrack.add_child(barFill);
        for (const rowPart of [nameLabel, barTrack, valueLabel])
            rowActor.add_child(rowPart);
        columnBox.add_child(rowActor);
        return {hoverRow: this._addHoverRow(rowActor), nameLabel, barTrack, barFill, valueLabel, barFraction: 0};
    }

    /**
     * Sets every length the layout gives: the title's and the headings' lines and the gaps under them, the gap between
     * the rankings, each ranking's width, and each row's height, name, track and value; then each bar for its track.
     *
     * @returns {void}
     */
    _applyLengths() {
        const {columns, heights} = this._layout;
        setActorStyle(this._titleLabel, pixelLengthStyle('height', heights.titleLinePx) +
            pixelLengthStyle('margin-bottom', TILE_TITLE_GAP_BELOW_PX));
        setActorStyle(this._rankingsBox, pixelLengthStyle('spacing', columns.rankingGapPx));
        const headingStyle = pixelLengthStyle('height', heights.headingLinePx) +
            pixelLengthStyle('margin-bottom', RANKING_HEADING_GAP_BELOW_PX);
        const rowStyle = pixelLengthStyle('height', heights.rowHeightPx) +
            pixelLengthStyle('spacing', RANKING_ROW_ITEM_GAP_PX);
        for (const column of [this._cpuColumn, this._memoryColumn]) {
            setActorStyle(column.box, pixelLengthStyle('width', columns.columnWidthPx));
            setActorStyle(column.headingLabel, headingStyle);
            for (const rowSlot of column.rowSlots) {
                setActorStyle(rowSlot.hoverRow.actor, rowStyle);
                setActorStyle(rowSlot.nameLabel, pixelLengthStyle('width', columns.nameWidthPx));
                setActorStyle(rowSlot.barTrack, pixelLengthStyle('width', columns.trackWidthPx));
                setActorStyle(rowSlot.valueLabel, pixelLengthStyle('width', columns.valueWidthPx));
                this._showBar(rowSlot);
            }
        }
    }

    /**
     * Draws both rankings: as many rows as the layout asks, each only where it changed, and hides the rest.
     *
     * @param {object} apps - A scan's apps, drawable.
     * @returns {void}
     */
    _renderRankings(apps) {
        const {byCpu, byMemory} = heaviestRankingRows(apps, this._rankingRowCount);
        this._setDataShown(true);
        this._showRanking(this._cpuColumn, byCpu);
        this._showRanking(this._memoryColumn, byMemory);
    }

    /**
     * Shows a ranking's rows in its slots and hides the slots after them.
     *
     * @param {RankingColumn} column - The ranking.
     * @param {import('./lib/heaviestRankings.js').RankingRow[]} rows - Its rows, largest first.
     * @returns {void}
     */
    _showRanking(column, rows) {
        column.rowSlots.forEach((rowSlot, rowIndex) => {
            const row = rows[rowIndex];
            if (row === undefined) {
                this._hideHoverRow(rowSlot.hoverRow);
                return;
            }
            setLabelText(rowSlot.nameLabel, row.name);
            setLabelText(rowSlot.valueLabel, row.valueText);
            rowSlot.barFraction = row.barFraction;
            this._showBar(rowSlot);
            this._showHoverRow(rowSlot.hoverRow, row.tooltipLines);
        });
    }

    /**
     * Sets a row's bar to its fraction of the layout's track, only when its width changed; no bar on no track.
     *
     * @param {RankingRowSlot} rowSlot - The row.
     * @returns {void}
     */
    _showBar(rowSlot) {
        const trackWidthPx = this._layout?.columns.trackWidthPx ?? 0;
        const fillWidthPx = barFillWidthPx(rowSlot.barFraction, trackWidthPx);
        setActorVisible(rowSlot.barTrack, trackWidthPx > 0);
        setActorStyle(rowSlot.barFill, pixelLengthStyle('width', fillWidthPx));
    }
});
