// How many mounts the Connections tile names, and its lengths: in its list, for the height it is given; in its one
// line, for the width its links leave; the list's heights from the line boxes St measures; and its widths, each a
// fixed part and the width of a sample text.
//
// - The list names every mount where all fit and are MOUNT_LIST_MOST_COUNT at most; otherwise as many as leave a line
//   for "+N more". Its uplink, VPN and SSH rows always come first.
// - The line names every mount where all fit; otherwise as many as leave room for "+N more", from the left, in
//   listing order. A link's width is read from St at the update (connectionsTile.js), never during a layout.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {
    CONNECTIONS_LINE_ITEM_GAP_PX, CONNECTIONS_LINE_LINK_GAP_PX, CONNECTIONS_LINK_ICON_SIZE_PX,
    CONNECTIONS_LINK_ROW_FIXED_HEIGHT_PX, CONNECTIONS_LIST_ITEM_GAP_PX, CONNECTIONS_LIST_LEAST_FIXED_WIDTH_PX,
    CONNECTIONS_LIST_ROW_GAP_COUNT,
    CONNECTIONS_LIST_STOP_EXTRA_WIDTH_PX, CONNECTIONS_RULE_GAP_PX, CONNECTIONS_RULE_HEIGHT_PX,
    MORE_LINE_FIXED_HEIGHT_PX, MOUNT_BAR_LEAST_WIDTH_PX, MOUNT_LIST_MOST_COUNT, MOUNT_NAME_MOST_WIDTH_PX,
    TILE_BORDER_WIDTH_PX, TILE_PADDING_BLOCK_PX, TILE_PADDING_INLINE_PX, TILE_TITLE_GAP_BELOW_PX,
    UNKNOWN_SIZE_DASH_GAP_PX, UNKNOWN_SIZE_DASH_PX, UNKNOWN_SIZE_RULE_THICKNESS_PX,
} from './drawingConstants.js';
import {LineKind, MOST_READING_PX, wholeReadingPx} from './measuredLengths.js';
import {DEFAULT_LINE_BOXES_PX, lineBoxOrDefaultPx} from './tileLineBoxes.js';

/** The rows above the list's mounts: the uplink, the VPN and the SSH masters. */
const LINK_ROWS_ABOVE_MOUNTS = 3;
/**
 * The one line at its least: the uplink, the VPN, the SSH masters, one mount and "+N more" (five links, four gaps);
 * an icon on each but "+N more"; a detail after the VPN, the SSH masters and the mount.
 */
const LINE_LEAST_LINK_COUNT = 5;
const LINE_LEAST_ICON_COUNT = 4;
const LINE_LEAST_DETAIL_COUNT = 3;
/** The Connections tile's two forms: a list of its links under its title, or its links in one line. */
export const ConnectionsForm = Object.freeze({LIST: 'list', LINE: 'line'});

/**
 * What each of the tile's widths that holds text is measured with, and in which class.
 *
 * - The list's least width holds a mount's label and the wider of "888G free" and "no answer": a larger free space
 *   ("1118G free") is wider still, and its label gives way first (mountRowWidthsPx).
 * - The line's least holds its links as sampled ("Wi-Fi", "VPN down", "SSH 5") and one mount ("nas-media 888G"),
 *   with no pixel to spare. A wider word in any of them ("Wired", "Offline", "VPN proton0", "SSH 12", "1118G") leaves
 *   no room for the mount: at the least the line then names none and says "+N more".
 */
export const CONNECTIONS_WIDTH_SAMPLE_TEXTS = Object.freeze({
    mountName: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['nas-media'])}),
    mountDetail: Object.freeze({lineKind: LineKind.ROW, texts: Object.freeze(['888G free', 'no answer'])}),
    lineTexts: Object.freeze({
        lineKind: LineKind.ROW,
        texts: Object.freeze(['Wi-Fi', 'VPN', 'down', 'SSH', '5', 'nas-media', '888G']),
        moreLineKind: LineKind.DETAIL,
        moreTexts: Object.freeze(['+8 more']),
    }),
});

/**
 * The sample widths as St gives them at the default text size (Ubuntu Sans 11 pt, text scaling 1): the line's is the
 * sum of its samples.
 */
export const DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX = Object.freeze({mountName: 68, mountDetail: 67, lineTexts: 283});

/** The tile's width less its content's: the border and the inline padding, on both sides. */
const CONTENT_INSET_WIDTH_PX = 2 * (TILE_BORDER_WIDTH_PX + TILE_PADDING_INLINE_PX);

/**
 * The sample widths to lay out with: each a whole reading, or its default (DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX) where
 * it is not a usable one (missing, null, NaN, not over 0, past the bound), as a line box falls back to its own.
 *
 * @param {*} textWidthsPx - The sample widths handed in.
 * @returns {{mountName: number, mountDetail: number, lineTexts: number}} Usable widths.
 */
export function connectionsTextWidthsOrDefaultPx(textWidthsPx) {
    const isObject = textWidthsPx !== null && typeof textWidthsPx === 'object';
    return Object.fromEntries(Object.entries(DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX).map(([part, defaultPx]) =>
        [part, wholeReadingPx(isObject ? textWidthsPx[part] : undefined) ?? defaultPx]));
}

/**
 * The tile's content width: its width less its border and padding, never under 0.
 *
 * @param {number} widthPx - The tile's width; anything but a finite number counts as 0.
 * @returns {number} The content width.
 */
export function connectionsContentWidthPx(widthPx) {
    return Number.isFinite(widthPx) ? Math.max(0, widthPx - CONTENT_INSET_WIDTH_PX) : 0;
}

/**
 * @typedef {object} ConnectionsListHeights The list's heights, at its text size.
 * @property {number} aboveLinksPx - The room above its links: the tile's edge, its title line and the gap under it.
 * @property {number} linkRowPx - A row: a link or a mount.
 * @property {number} ruleBlockPx - The rule over the mounts and the room around it.
 * @property {number} moreLinePx - The "+N more" line.
 * @property {number} belowLinksPx - The room below its last line, to the tile's edge.
 */

/**
 * The list's heights from the line boxes: each a fixed part and its line.
 *
 * @param {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @returns {ConnectionsListHeights} The heights.
 */
export function connectionsListHeightsPx(lineBoxesPx) {
    const tileEdgePx = TILE_BORDER_WIDTH_PX + TILE_PADDING_BLOCK_PX;
    return {
        aboveLinksPx: tileEdgePx + lineBoxOrDefaultPx(lineBoxesPx, LineKind.TITLE) + TILE_TITLE_GAP_BELOW_PX,
        linkRowPx: CONNECTIONS_LINK_ROW_FIXED_HEIGHT_PX + lineBoxOrDefaultPx(lineBoxesPx, LineKind.ROW),
        ruleBlockPx: 2 * CONNECTIONS_RULE_GAP_PX + CONNECTIONS_RULE_HEIGHT_PX,
        moreLinePx: MORE_LINE_FIXED_HEIGHT_PX + lineBoxOrDefaultPx(lineBoxesPx, LineKind.DETAIL),
        belowLinksPx: tileEdgePx,
    };
}

/**
 * How many mounts the list names in its height: every one where all fit and are MOUNT_LIST_MOST_COUNT at most;
 * otherwise as many as leave room for "+N more". The rule over the mounts is drawn only where there is a mount.
 *
 * @param {object} fit - The list's height and what goes in it.
 * @param {number} fit.tileHeightPx - The tile's height; anything but a finite number names none.
 * @param {ConnectionsListHeights} fit.listHeightsPx - Its heights.
 * @param {number} fit.mountCount - How many mounts there are.
 * @returns {number} The mounts named, 0 to MOUNT_LIST_MOST_COUNT.
 */
export function listMountCountThatFits({tileHeightPx, listHeightsPx, mountCount}) {
    if (!(mountCount > 0) || !Number.isFinite(tileHeightPx))
        return 0;
    const {aboveLinksPx, linkRowPx, ruleBlockPx, moreLinePx, belowLinksPx} = listHeightsPx;
    const roomForMountsPx = tileHeightPx - aboveLinksPx - LINK_ROWS_ABOVE_MOUNTS * linkRowPx - ruleBlockPx -
        belowLinksPx;
    const rowsThatFit = Math.floor(roomForMountsPx / linkRowPx);
    if (mountCount <= Math.min(MOUNT_LIST_MOST_COUNT, rowsThatFit))
        return mountCount;
    const rowsBesideMoreLine = Math.floor((roomForMountsPx - moreLinePx) / linkRowPx);
    return Math.min(MOUNT_LIST_MOST_COUNT, Math.max(0, rowsBesideMoreLine));
}

/**
 * How many mounts the one line names: from the left, in listing order, every one where all fit; otherwise as many as
 * leave room for "+N more". The uplink, the VPN and the SSH masters always stand first; a mount that does not fit
 * ends the count, so no later mount is named past it. A length that is no finite number names none.
 *
 * @param {object} fit - The line's width and its links' widths.
 * @param {number} fit.lineWidthPx - The width the links may take.
 * @param {number[]} fit.linkWidthsPx - The uplink's, the VPN's and the SSH masters' widths.
 * @param {number[]} fit.mountWidthsPx - Each mount's width, in listing order, as far as the line has slots.
 * @param {number} [fit.mountCount] - How many mounts there are, beyond the slots too: the last slot leaves room for
 *     "+N more" while a mount is left after it.
 * @param {number} fit.moreWidthPx - "+N more" at its widest.
 * @param {number} fit.gapPx - The room between two links.
 * @returns {number} The mounts named.
 */
export function lineMountCountThatFits({
    lineWidthPx, linkWidthsPx, mountWidthsPx, mountCount = mountWidthsPx.length, moreWidthPx, gapPx,
}) {
    const lengthsPx = [lineWidthPx, moreWidthPx, gapPx, ...linkWidthsPx, ...mountWidthsPx];
    if (!lengthsPx.every(lengthPx => Number.isFinite(lengthPx)))
        return 0;
    const linksWidthPx = linkWidthsPx.reduce((sumPx, widthPx) => sumPx + widthPx, 0);
    let usedWidthPx = linksWidthPx + (linkWidthsPx.length - 1) * gapPx;
    let namedCount = 0;
    for (const mountWidthPx of mountWidthsPx) {
        const widthWithMountPx = usedWidthPx + gapPx + mountWidthPx;
        const isLastMount = namedCount === mountCount - 1;
        const moreRoomPx = isLastMount ? 0 : gapPx + moreWidthPx;
        if (widthWithMountPx + moreRoomPx > lineWidthPx)
            break;
        usedWidthPx = widthWithMountPx;
        namedCount++;
    }
    return namedCount;
}

/**
 * A link of the one line: its icon, its name and, where it has one, its detail, CONNECTIONS_LINE_ITEM_GAP_PX apart.
 *
 * @param {{nameNaturalPx: number, detailNaturalPx: number}} widths - The name's and the detail's text widths; 0 for
 *     no detail.
 * @returns {number} The link's width.
 */
export function lineLinkWidthPx({nameNaturalPx, detailNaturalPx}) {
    const detailPartPx = detailNaturalPx > 0 ? CONNECTIONS_LINE_ITEM_GAP_PX + detailNaturalPx : 0;
    return CONNECTIONS_LINK_ICON_SIZE_PX + CONNECTIONS_LINE_ITEM_GAP_PX + nameNaturalPx + detailPartPx;
}

/**
 * The widest a mount's label is drawn in the list: MOUNT_NAME_MOST_WIDTH_PX at the default row line, growing with the
 * text.
 *
 * @param {number} rowLinePx - The row line box.
 * @returns {number} The width, whole.
 */
export function mountNameMostWidthPx(rowLinePx) {
    return Math.round(MOUNT_NAME_MOST_WIDTH_PX * rowLinePx / DEFAULT_LINE_BOXES_PX[LineKind.ROW]);
}

/**
 * The tile's widths, each a fixed part and a text part: the list's least (a mount row with its bar at its least) and
 * its stop (CONNECTIONS_LIST_STOP_EXTRA_WIDTH_PX more, all of it fixed), and the line's least (CONNECTIONS_WIDTH_
 * SAMPLE_TEXTS' five links with their icons and gaps).
 *
 * @param {*} textWidthsPx - The sample widths (connectionsTextWidthsOrDefaultPx): `lineTexts` is the sum of the
 *     line's samples.
 * @returns {{listLeastWidthPx: object, listStopWidthPx: object, lineLeastWidthPx: object}} Each as
 *     `{fixedPx, textPx, totalPx}`.
 */
export function connectionsWidthsPx(textWidthsPx) {
    const {mountName, mountDetail, lineTexts} = connectionsTextWidthsOrDefaultPx(textWidthsPx);
    const listTextPx = mountName + mountDetail;
    const listStopFixedPx = CONNECTIONS_LIST_LEAST_FIXED_WIDTH_PX + CONNECTIONS_LIST_STOP_EXTRA_WIDTH_PX;
    const lineFixedPx = CONTENT_INSET_WIDTH_PX +
        (LINE_LEAST_LINK_COUNT - 1) * CONNECTIONS_LINE_LINK_GAP_PX +
        LINE_LEAST_ICON_COUNT * (CONNECTIONS_LINK_ICON_SIZE_PX + CONNECTIONS_LINE_ITEM_GAP_PX) +
        LINE_LEAST_DETAIL_COUNT * CONNECTIONS_LINE_ITEM_GAP_PX;
    return {
        listLeastWidthPx: {
            fixedPx: CONNECTIONS_LIST_LEAST_FIXED_WIDTH_PX, textPx: listTextPx,
            totalPx: CONNECTIONS_LIST_LEAST_FIXED_WIDTH_PX + listTextPx,
        },
        listStopWidthPx: {fixedPx: listStopFixedPx, textPx: listTextPx, totalPx: listStopFixedPx + listTextPx},
        lineLeastWidthPx: {
            fixedPx: lineFixedPx, textPx: lineTexts, totalPx: lineFixedPx + lineTexts,
        },
    };
}

/**
 * A list mount row's label and bar: the label as wide as its text up to its most, the bar the rest; where the row is
 * short, the label gives way first, down to nothing, so the bar keeps MOUNT_BAR_LEAST_WIDTH_PX as long as it can. The
 * icon and the detail are never cut.
 *
 * @param {object} widths - The row's room and its text.
 * @param {number} widths.contentWidthPx - The tile's content width; anything but a finite number counts as 0.
 * @param {number} widths.nameNaturalPx - The label's text width.
 * @param {number} widths.nameMostPx - The widest the label is drawn (mountNameMostWidthPx).
 * @param {number} widths.detailNaturalPx - The detail's text width; 0 for none.
 * @returns {{nameWidthPx: number, barWidthPx: number}} The two widths, never under 0.
 */
export function mountRowWidthsPx({contentWidthPx, nameNaturalPx, nameMostPx, detailNaturalPx}) {
    const rowGapsWidthPx = CONNECTIONS_LIST_ROW_GAP_COUNT * CONNECTIONS_LIST_ITEM_GAP_PX;
    const usableContentWidthPx = Number.isFinite(contentWidthPx) ? contentWidthPx : 0;
    const roomPx = usableContentWidthPx - CONNECTIONS_LINK_ICON_SIZE_PX - rowGapsWidthPx - detailNaturalPx;
    const nameRoomPx = Math.max(0, roomPx - MOUNT_BAR_LEAST_WIDTH_PX);
    const nameWidthPx = Math.min(nameNaturalPx, nameMostPx, nameRoomPx);
    return {nameWidthPx, barWidthPx: Math.max(0, roomPx - nameWidthPx)};
}

/**
 * The dashes of the rule drawn in place of a bar for a mount whose sizes are not known: UNKNOWN_SIZE_DASH_PX long,
 * UNKNOWN_SIZE_DASH_GAP_PX apart, from the left edge, the last one cut at the right; centred in the height,
 * UNKNOWN_SIZE_RULE_THICKNESS_PX thick at most. A width past MOST_READING_PX is drawn as wide as it, so the dashes
 * are bounded.
 *
 * @param {number} widthPx - The drawing area's width.
 * @param {number} heightPx - Its height.
 * @returns {Array<[number, number, number, number]>} Each dash as [x, y, width, height]; none for an empty area or
 *     a length that is no finite number.
 */
export function unknownSizeDashRectsPx(widthPx, heightPx) {
    const isDrawable = Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0;
    if (!isDrawable)
        return [];
    const drawnWidthPx = Math.min(widthPx, MOST_READING_PX);
    const thicknessPx = Math.min(UNKNOWN_SIZE_RULE_THICKNESS_PX, heightPx);
    const topPx = Math.floor((heightPx - thicknessPx) / 2);
    const dashRects = [];
    for (let leftPx = 0; leftPx < drawnWidthPx; leftPx += UNKNOWN_SIZE_DASH_PX + UNKNOWN_SIZE_DASH_GAP_PX) {
        const dashWidthPx = Math.min(UNKNOWN_SIZE_DASH_PX, drawnWidthPx - leftPx);
        dashRects.push([leftPx, topPx, dashWidthPx, thicknessPx]);
    }
    return dashRects;
}
