// The cockpit's Connections tile, in its two forms: a list (its title, the uplink's, the VPN's and the SSH masters'
// rows, and under a rule each mount with its bar and free space, then "+N more"), or one line with no title (the
// links from the left, 32 px apart, as many mounts as fit, then "+N more"). Shell glue only: each link's words, inks,
// icon and tooltip come finished from lib/connectionsLinks.js and the counts and lengths from lib/connectionsFit.js,
// and the tile only assigns them, on the base every cockpit tile shares (cockpitTileBase.js).
//
// - Both forms are built once, with the tile; setLayout shows one. No update makes or destroys an actor.
// - The one line counts its mounts at the update, from the text widths St gives its labels (each read off the label's
//   own text, after its style), never inside a layout or a paint. "+N more" is measured with every mount left out, on
//   a hidden twin, so its room never falls short of the line drawn.
// - A mount with no sizes has a dashed rule in place of its bar: an St.DrawingArea, since St draws no dashed border,
//   painted from its own surface's size and its theme node's colour.
// - A row or link lights on hover and shows the connections card's tooltip; nothing takes a click.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    CockpitTileBase, pixelLengthStyle, setActorStyle, setActorVisible, setLabelText, swapStyleClass,
} from './cockpitTileBase.js';
import {
    CONNECTIONS_LINE_ITEM_GAP_PX, CONNECTIONS_LINE_LINK_GAP_PX, CONNECTIONS_LINK_ICON_SIZE_PX,
    CONNECTIONS_LIST_ITEM_GAP_PX, CONNECTIONS_RULE_GAP_PX, CONNECTIONS_RULE_HEIGHT_PX, MORE_LINE_FIXED_HEIGHT_PX,
    MOUNT_LINE_SLOT_COUNT, MOUNT_LIST_MOST_COUNT, TILE_BORDER_WIDTH_PX, TILE_PADDING_INLINE_PX,
    TILE_TITLE_GAP_BELOW_PX,
} from './lib/drawingConstants.js';
import {
    connectionsListHeightsPx, ConnectionsForm, lineLinkWidthPx, lineMountCountThatFits, listMountCountThatFits,
    mountNameMostWidthPx, mountRowWidthsPx, unknownSizeDashRectsPx,
} from './lib/connectionsFit.js';
import {
    canDrawConnectionsTile, connectionsLinks, connectionsNoDataText, LinkInk, moreLineText,
} from './lib/connectionsLinks.js';
import {barFillWidthPx} from './lib/heaviestRankings.js';
import {LineKind} from './lib/measuredLengths.js';
import {lineBoxOrDefaultPx} from './lib/tileLineBoxes.js';

const TITLE_TEXT = 'Connections';
const TILE_STYLE_CLASS = 'rp-connections-tile';
const NO_DATA_STYLE_CLASS = 'rp-connections-no-data';
const TITLE_STYLE_CLASS = `${LineKind.TITLE} rp-connections-title`;
const LINK_STYLE_CLASS = 'rp-connections-link';
const ICON_STYLE_CLASS = 'rp-connections-icon';
const NAME_STYLE_CLASS = LineKind.ROW;
const DETAIL_STYLE_CLASS = `${LineKind.ROW} rp-connections-detail`;
const MOUNT_BAR_TRACK_STYLE_CLASS = 'rp-connections-mount-bar-track';
const MOUNT_BAR_STYLE_CLASS = 'rp-connections-mount-bar';
const UNKNOWN_SIZE_STYLE_CLASS = 'rp-connections-unknown-size';
const RULE_STYLE_CLASS = 'rp-connections-rule';
const MORE_STYLE_CLASS = `${LineKind.DETAIL} rp-connections-more`;
/** The class each ink is drawn with (stylesheet.css). */
const INK_STYLE_CLASSES = Object.freeze({
    [LinkInk.PRIMARY]: 'rp-connections-ink-primary',
    [LinkInk.QUIET]: 'rp-connections-ink-quiet',
    [LinkInk.UP]: 'rp-connections-ink-up',
    [LinkInk.DOWN]: 'rp-connections-ink-down',
    [LinkInk.CAUTION]: 'rp-connections-caution',
});
/** The uplink, the VPN and the SSH masters: the links above or before the mounts. */
const LINK_SLOT_COUNT = 3;
/** The tile's content width less its whole width: the border and the padding on both sides. */
const CONTENT_INSET_WIDTH_PX = 2 * (TILE_BORDER_WIDTH_PX + TILE_PADDING_INLINE_PX);
/** The most a colour channel reads in a theme node's colour. */
const COLOUR_CHANNEL_MOST = 255;

/**
 * @typedef {object} LinkSlot One row of the list, or one link of the line, built once.
 * @property {import('./cockpitTileBase.js').HoverRow} hoverRow - The row or link, with its tooltip.
 * @property {St.Icon} icon - Its icon.
 * @property {St.Label} nameLabel - Its name.
 * @property {St.Label} detailLabel - Its detail.
 * @property {{icon: string|null, name: string|null, detail: string|null}} inkStyleClasses - The ink classes each
 *     part carries now.
 * @property {MountBar|null} mountBar - A list mount row's bar; null for any other slot.
 */

/**
 * @typedef {object} MountBar A list mount row's bar, built once.
 * @property {St.Widget} barSlot - What holds the bar or the dashed rule, at the bar's width.
 * @property {St.Widget} barTrack - The bar's track.
 * @property {St.Widget} barFill - The bar.
 * @property {St.DrawingArea} unknownSizeRule - The dashed rule of a mount with no sizes.
 * @property {number} barWidthPx - The bar's width, as last laid out.
 */

/**
 * The width of a label's text, read off its own text after its style, so no width set on the label enters it.
 *
 * @param {St.Label} label - The label, on the stage.
 * @returns {number} The width; 0 for no text.
 */
function labelTextWidthPx(label) {
    if (label.text === '')
        return 0;
    label.ensure_style();
    const [, naturalWidthPx] = label.clutter_text.get_preferred_width(-1);
    return Math.ceil(naturalWidthPx);
}

/**
 * Makes a label that never ellipsizes, so a width read off it is the width it draws.
 *
 * @param {string} styleClass - Its classes.
 * @param {object} [extraProperties] - More St.Label properties.
 * @returns {St.Label} The label, with no text yet.
 */
function newUncutLabel(styleClass, extraProperties = {}) {
    const label = new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...extraProperties});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

/**
 * The Connections tile. setLayout gives it its size, its form and its text's lengths; update draws the network and
 * mounts sources.
 */
export const ConnectionsTile = GObject.registerClass(
class ConnectionsTile extends CockpitTileBase {
    /**
     * Builds the tile with both of its forms, every actor either will show; the list is shown until setLayout says
     * otherwise, and the no-data line until its first update.
     *
     * @param {object} options - The tile's options.
     * @param {import('./cockpitTooltip.js').CockpitTooltip} options.tooltip - The tooltip every tile shares.
     * @returns {void}
     */
    _init({tooltip}) {
        super._init({tooltip, tileStyleClass: TILE_STYLE_CLASS, noDataStyleClass: NO_DATA_STYLE_CLASS});
        this._form = ConnectionsForm.LIST;
        this._layout = null;
        this._titleLabel = this._addTitleLabel(TITLE_TEXT, TITLE_STYLE_CLASS);
        this._buildList();
        this._buildLine();
        this._lineBox.visible = false;
        this.showNoData(connectionsNoDataText());
    }

    /**
     * Lays the tile out: its size, its form, and its lengths from the line boxes; then draws the latest update again.
     * A frozen tile is laid out too, and draws at the reveal.
     *
     * @param {object} layout - The tile's layout.
     * @param {number} layout.widthPx - The tile's width.
     * @param {number} layout.heightPx - Its height.
     * @param {string} layout.connectionsForm - A ConnectionsForm value.
     * @param {*} layout.lineBoxesPx - The measured line boxes, keyed by LineKind value.
     * @returns {void}
     */
    setLayout({widthPx, heightPx, connectionsForm, lineBoxesPx}) {
        this.setTileSize(widthPx, heightPx);
        this._form = connectionsForm === ConnectionsForm.LINE ? ConnectionsForm.LINE : ConnectionsForm.LIST;
        const rowLinePx = lineBoxOrDefaultPx(lineBoxesPx, LineKind.ROW);
        this._layout = {
            tileHeightPx: heightPx,
            contentWidthPx: Math.max(0, widthPx - CONTENT_INSET_WIDTH_PX),
            listHeightsPx: connectionsListHeightsPx(lineBoxesPx),
            titleLinePx: lineBoxOrDefaultPx(lineBoxesPx, LineKind.TITLE),
            detailLinePx: lineBoxOrDefaultPx(lineBoxesPx, LineKind.DETAIL),
            mountNameMostPx: mountNameMostWidthPx(rowLinePx),
        };
        setActorVisible(this._titleLabel, this._form === ConnectionsForm.LIST);
        setActorVisible(this._listBox, this._form === ConnectionsForm.LIST);
        setActorVisible(this._lineBox, this._form === ConnectionsForm.LINE);
        this._applyListLengths();
        this._redrawLatestRender();
    }

    /**
     * Draws the network and mounts sources, or the no-data line when either cannot be drawn. Frozen, it is only
     * recorded.
     *
     * @param {object|null} network - The network source.
     * @param {object|null} mounts - The mounts source.
     * @returns {void}
     */
    update(network, mounts) {
        if (!canDrawConnectionsTile(network, mounts)) {
            this.showNoData(connectionsNoDataText());
            return;
        }
        this._renderUnlessFrozen(() => this._renderLinks(connectionsLinks(network, mounts)));
    }

    /**
     * Builds the list: the three link rows, the rule, MOUNT_LIST_MOST_COUNT mount rows and "+N more".
     *
     * @returns {void}
     */
    _buildList() {
        this._listBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._listLinkSlots = Array.from({length: LINK_SLOT_COUNT}, () => this._buildListSlot({isMount: false}));
        this._rule = new St.Widget({style_class: RULE_STYLE_CLASS, visible: false});
        this._listBox.add_child(this._rule);
        this._listMountSlots = Array.from({length: MOUNT_LIST_MOST_COUNT}, () => this._buildListSlot({isMount: true}));
        this._listMoreLabel = newUncutLabel(MORE_STYLE_CLASS, {visible: false, y_align: Clutter.ActorAlign.START});
        this._listBox.add_child(this._listMoreLabel);
        this._dataBox.add_child(this._listBox);
    }

    /**
     * Builds one list row, hidden: its icon, its name, a mount's bar (or its dashed rule) and its detail. The detail
     * is always shown, empty or not, so a row's gaps never change with its words.
     *
     * @param {{isMount: boolean}} slotKind - Whether the row is a mount's, with a bar.
     * @returns {LinkSlot} The row.
     */
    _buildListSlot({isMount}) {
        const rowActor = new St.BoxLayout({
            style_class: LINK_STYLE_CLASS, reactive: false, track_hover: true, visible: false,
            style: pixelLengthStyle('spacing', CONNECTIONS_LIST_ITEM_GAP_PX),
        });
        const slot = this._buildLinkParts(rowActor, {isNameExpanding: !isMount});
        if (isMount) {
            slot.nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            slot.mountBar = this._buildMountBar();
            rowActor.insert_child_above(slot.mountBar.barSlot, slot.nameLabel);
        }
        slot.detailLabel.x_expand = isMount;
        slot.detailLabel.x_align = Clutter.ActorAlign.END;
        this._listBox.add_child(rowActor);
        return slot;
    }

    /**
     * Builds the line: its links from the left, LINE_LINK_GAP_PX apart, centred in the tile's height; "+N more"; and
     * the hidden twin "+N more" is measured on.
     *
     * @returns {void}
     */
    _buildLine() {
        this._lineBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: pixelLengthStyle('spacing', CONNECTIONS_LINE_LINK_GAP_PX),
        });
        const slotCount = LINK_SLOT_COUNT + MOUNT_LINE_SLOT_COUNT;
        const lineSlots = Array.from({length: slotCount}, () => this._buildLineSlot());
        this._lineLinkSlots = lineSlots.slice(0, LINK_SLOT_COUNT);
        this._lineMountSlots = lineSlots.slice(LINK_SLOT_COUNT);
        this._lineMoreLabel = newUncutLabel(MORE_STYLE_CLASS, {visible: false});
        this._lineMoreTwinLabel = newUncutLabel(MORE_STYLE_CLASS, {visible: false});
        this._lineBox.add_child(this._lineMoreLabel);
        this._lineBox.add_child(this._lineMoreTwinLabel);
        this._dataBox.add_child(this._lineBox);
    }

    /**
     * Builds one link of the line, hidden: its icon, its name and its detail, never cut.
     *
     * @returns {LinkSlot} The link.
     */
    _buildLineSlot() {
        const linkActor = new St.BoxLayout({
            style_class: LINK_STYLE_CLASS, reactive: false, track_hover: true, visible: false,
            y_align: Clutter.ActorAlign.CENTER, style: pixelLengthStyle('spacing', CONNECTIONS_LINE_ITEM_GAP_PX),
        });
        const slot = this._buildLinkParts(linkActor, {isNameExpanding: false});
        this._lineBox.add_child(linkActor);
        return slot;
    }

    /**
     * Builds the parts every row and link has: its icon, its name and its detail, and makes it a hover row.
     *
     * @param {St.BoxLayout} linkActor - The row or link.
     * @param {{isNameExpanding: boolean}} options - Whether the name takes the row's spare width.
     * @returns {LinkSlot} The slot, with no content yet.
     */
    _buildLinkParts(linkActor, {isNameExpanding}) {
        const icon = new St.Icon({
            style_class: ICON_STYLE_CLASS, icon_size: CONNECTIONS_LINK_ICON_SIZE_PX, y_align: Clutter.ActorAlign.CENTER,
        });
        const nameLabel = newUncutLabel(NAME_STYLE_CLASS, {x_expand: isNameExpanding});
        const detailLabel = newUncutLabel(DETAIL_STYLE_CLASS);
        for (const linkPart of [icon, nameLabel, detailLabel])
            linkActor.add_child(linkPart);
        return {
            hoverRow: this._addHoverRow(linkActor), icon, nameLabel, detailLabel,
            inkStyleClasses: {icon: null, name: null, detail: null}, mountBar: null,
        };
    }

    /**
     * Builds a list mount row's bar: a slot holding the track with its fill, and the dashed rule, one of them shown.
     *
     * @returns {MountBar} The bar.
     */
    _buildMountBar() {
        const barSlot = new St.Widget({layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        const barTrack = new St.Widget({
            style_class: MOUNT_BAR_TRACK_STYLE_CLASS, layout_manager: new Clutter.BinLayout(), x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Expanding, so the track's BinLayout gives it the whole track and its own alignment puts it at the start.
        const barFill = new St.Widget({
            style_class: MOUNT_BAR_STYLE_CLASS, x_expand: true, x_align: Clutter.ActorAlign.START,
        });
        const unknownSizeRule = new St.DrawingArea({
            style_class: UNKNOWN_SIZE_STYLE_CLASS, x_expand: true, y_align: Clutter.ActorAlign.CENTER, visible: false,
        });
        unknownSizeRule.connect('repaint', () => this._paintUnknownSizeRule(unknownSizeRule));
        barTrack.add_child(barFill);
        barSlot.add_child(barTrack);
        barSlot.add_child(unknownSizeRule);
        return {barSlot, barTrack, barFill, unknownSizeRule, barWidthPx: 0};
    }

    /**
     * Sets the list's lengths the layout gives: the title's line and the gap under it, a row's height, the rule's
     * room, and "+N more"'s.
     *
     * @returns {void}
     */
    _applyListLengths() {
        const {listHeightsPx, titleLinePx, detailLinePx} = this._layout;
        setActorStyle(this._titleLabel, pixelLengthStyle('height', titleLinePx) +
            pixelLengthStyle('margin-bottom', TILE_TITLE_GAP_BELOW_PX));
        const rowStyle = pixelLengthStyle('height', listHeightsPx.linkRowPx) +
            pixelLengthStyle('spacing', CONNECTIONS_LIST_ITEM_GAP_PX);
        for (const slot of [...this._listLinkSlots, ...this._listMountSlots])
            setActorStyle(slot.hoverRow.actor, rowStyle);
        setActorStyle(this._rule, pixelLengthStyle('height', CONNECTIONS_RULE_HEIGHT_PX) +
            pixelLengthStyle('margin-top', CONNECTIONS_RULE_GAP_PX) +
            pixelLengthStyle('margin-bottom', CONNECTIONS_RULE_GAP_PX));
        setActorStyle(this._listMoreLabel, pixelLengthStyle('height', detailLinePx) +
            pixelLengthStyle('margin-top', MORE_LINE_FIXED_HEIGHT_PX));
    }

    /**
     * Draws every link in the tile's form.
     *
     * @param {ReturnType<typeof connectionsLinks>} links - The tile's links.
     * @returns {void}
     */
    _renderLinks(links) {
        this._setDataShown(true);
        if (this._layout === null)
            return;
        if (this._form === ConnectionsForm.LINE)
            this._renderLine(links);
        else
            this._renderList(links);
    }

    /**
     * Draws the list: the three link rows, the rule where there is a mount, as many mount rows as the height holds,
     * and "+N more" for the rest.
     *
     * @param {ReturnType<typeof connectionsLinks>} links - The tile's links.
     * @returns {void}
     */
    _renderList(links) {
        const linkRows = [links.uplink, links.vpn, links.ssh];
        this._listLinkSlots.forEach((slot, slotIndex) => this._showLink(slot, linkRows[slotIndex], 'listDetail'));
        const namedCount = listMountCountThatFits({
            tileHeightPx: this._layout.tileHeightPx, listHeightsPx: this._layout.listHeightsPx,
            mountCount: links.mounts.length,
        });
        setActorVisible(this._rule, links.mounts.length > 0);
        this._listMountSlots.forEach((slot, slotIndex) => {
            if (slotIndex >= namedCount) {
                this._hideHoverRow(slot.hoverRow);
                return;
            }
            this._showLink(slot, links.mounts[slotIndex], 'listDetail');
            this._showMountBar(slot, links.mounts[slotIndex].usedFraction);
        });
        this._showMoreLabel(this._listMoreLabel, links.mounts.length - namedCount);
    }

    /**
     * Draws the line: the three links, then as many mounts as fit beside them and "+N more", from the widths St gives
     * each link's text at this update.
     *
     * @param {ReturnType<typeof connectionsLinks>} links - The tile's links.
     * @returns {void}
     */
    _renderLine(links) {
        const linkRows = [links.uplink, links.vpn, links.ssh];
        const linkWidthsPx = this._lineLinkSlots.map((slot, slotIndex) =>
            this._setLinkContent(slot, linkRows[slotIndex], 'lineDetail'));
        const candidateMounts = links.mounts.slice(0, MOUNT_LINE_SLOT_COUNT);
        const mountWidthsPx = candidateMounts.map((mountLink, slotIndex) =>
            this._setLinkContent(this._lineMountSlots[slotIndex], mountLink, 'lineDetail'));
        setLabelText(this._lineMoreTwinLabel, moreLineText(links.mounts.length));
        const namedCount = lineMountCountThatFits({
            lineWidthPx: this._layout.contentWidthPx, linkWidthsPx, mountWidthsPx, mountCount: links.mounts.length,
            moreWidthPx: labelTextWidthPx(this._lineMoreTwinLabel), gapPx: CONNECTIONS_LINE_LINK_GAP_PX,
        });
        this._lineLinkSlots.forEach((slot, slotIndex) =>
            this._showHoverRow(slot.hoverRow, linkRows[slotIndex].tooltipLines));
        this._lineMountSlots.forEach((slot, slotIndex) => {
            if (slotIndex < namedCount)
                this._showHoverRow(slot.hoverRow, links.mounts[slotIndex].tooltipLines);
            else
                this._hideHoverRow(slot.hoverRow);
        });
        this._showMoreLabel(this._lineMoreLabel, links.mounts.length - namedCount);
    }

    /**
     * Shows a link in a list row: its content, then the row with its tooltip; a mount row's widths from its text.
     *
     * @param {LinkSlot} slot - The row.
     * @param {import('./lib/connectionsLinks.js').ConnectionsLink} link - The link.
     * @param {'listDetail'} detailKey - Which of the link's details the row says.
     * @returns {void}
     */
    _showLink(slot, link, detailKey) {
        this._setLinkContent(slot, link, detailKey);
        if (slot.mountBar !== null) {
            const {nameWidthPx, barWidthPx} = mountRowWidthsPx({
                contentWidthPx: this._layout.contentWidthPx, nameNaturalPx: labelTextWidthPx(slot.nameLabel),
                nameMostPx: this._layout.mountNameMostPx, detailNaturalPx: labelTextWidthPx(slot.detailLabel),
            });
            setActorStyle(slot.nameLabel, pixelLengthStyle('width', nameWidthPx));
            setActorStyle(slot.mountBar.barSlot, pixelLengthStyle('width', barWidthPx));
            slot.mountBar.barWidthPx = barWidthPx;
        }
        this._showHoverRow(slot.hoverRow, link.tooltipLines);
    }

    /**
     * Sets a slot's icon, words and inks, each only when it changed, without showing it; a detail of '' is hidden in
     * the line and shown empty in the list, so a list row keeps its gaps.
     *
     * @param {LinkSlot} slot - The row or link.
     * @param {import('./lib/connectionsLinks.js').ConnectionsLink} link - The link.
     * @param {'listDetail'|'lineDetail'} detailKey - Which of the link's details the slot says.
     * @returns {number} The link's width in the line, from its text as St draws it.
     */
    _setLinkContent(slot, link, detailKey) {
        const detailText = link[detailKey];
        if (slot.icon.icon_name !== link.iconName)
            slot.icon.icon_name = link.iconName;
        setLabelText(slot.nameLabel, link.name);
        setLabelText(slot.detailLabel, detailText);
        setActorVisible(slot.detailLabel, detailKey === 'listDetail' || detailText !== '');
        slot.inkStyleClasses.icon = swapStyleClass(slot.icon, slot.inkStyleClasses.icon,
            INK_STYLE_CLASSES[link.iconInk]);
        slot.inkStyleClasses.name = swapStyleClass(slot.nameLabel, slot.inkStyleClasses.name,
            INK_STYLE_CLASSES[link.nameInk]);
        slot.inkStyleClasses.detail = swapStyleClass(slot.detailLabel, slot.inkStyleClasses.detail,
            INK_STYLE_CLASSES[link.detailInk]);
        if (detailKey !== 'lineDetail')
            return 0;
        return lineLinkWidthPx({
            nameNaturalPx: labelTextWidthPx(slot.nameLabel), detailNaturalPx: labelTextWidthPx(slot.detailLabel),
        });
    }

    /**
     * Shows a list mount row's bar at its used share, or the dashed rule where its sizes are not known.
     *
     * @param {LinkSlot} slot - The mount row.
     * @param {number|null} usedFraction - The mount's used share; null where its sizes are not known.
     * @returns {void}
     */
    _showMountBar(slot, usedFraction) {
        const {barTrack, barFill, unknownSizeRule, barWidthPx} = slot.mountBar;
        const areSizesKnown = usedFraction !== null;
        setActorVisible(barTrack, areSizesKnown);
        setActorVisible(unknownSizeRule, !areSizesKnown);
        if (areSizesKnown)
            setActorStyle(barFill, pixelLengthStyle('width', barFillWidthPx(usedFraction, barWidthPx)));
    }

    /**
     * Shows "+N more" for the mounts left out, or hides it for none.
     *
     * @param {St.Label} moreLabel - The list's or the line's "+N more".
     * @param {number} hiddenCount - The mounts not named.
     * @returns {void}
     */
    _showMoreLabel(moreLabel, hiddenCount) {
        setLabelText(moreLabel, moreLineText(hiddenCount));
        setActorVisible(moreLabel, hiddenCount > 0);
    }

    /**
     * Paints a dashed rule across the drawing area's own surface, in its theme node's colour, and frees the context
     * whatever happens. It reads only the surface's size: no allocation is asked for during a repaint.
     *
     * @param {St.DrawingArea} unknownSizeRule - The rule being repainted.
     * @returns {void}
     */
    _paintUnknownSizeRule(unknownSizeRule) {
        const [widthPx, heightPx] = unknownSizeRule.get_surface_size();
        const colour = unknownSizeRule.get_theme_node().get_foreground_color();
        const cr = unknownSizeRule.get_context();
        try {
            cr.setSourceRGBA(colour.red / COLOUR_CHANNEL_MOST, colour.green / COLOUR_CHANNEL_MOST,
                colour.blue / COLOUR_CHANNEL_MOST, colour.alpha / COLOUR_CHANNEL_MOST);
            for (const dashRect of unknownSizeDashRectsPx(widthPx, heightPx))
                cr.rectangle(...dashRect);
            cr.fill();
        } finally {
            cr.$dispose();
        }
    }
});
