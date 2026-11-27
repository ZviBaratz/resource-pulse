// lib/connectionsFit.js: how many mounts the Connections tile names in its list for a height and in its one line for
// a width, its list's heights and its widths' two parts, from synthetic lengths.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as connectionsFit from '../extensions/resource-pulse@zvibaratz.github.io/lib/connectionsFit.js';
import {LineKind} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';

/** The default text size's line boxes. */
const DEFAULT_LINE_BOXES_PX = {[LineKind.TITLE]: 23, [LineKind.DETAIL]: 17, [LineKind.ROW]: 18};
/** The gap between two links of the one line. */
const LINE_LINK_GAP_PX = 32;
/** The uplink, the VPN and the SSH masters, as wide as they are at the default size, about. */
const LINK_WIDTHS_PX = [64, 100, 71];
const MORE_LINE_WIDTH_PX = 56;
/** The line's words at the default text size, as St gives them (Ubuntu Sans 11 pt): the samples and wider ones. */
const LINE_WORD_WIDTHS_PX = {
    'Wi-Fi': 34, 'Wired': 41, 'VPN': 28, 'down': 37, 'SSH': 26, '5': 8, 'nas-media': 68, '888G': 34, '+9 more': 48,
};
/** The most rectangles the dashed rule is drawn with: its width clamped to the bound a reading is good to, 32768 px. */
const DASH_RECT_MOST_COUNT = Math.ceil(32768 / 6);
/** A tile's border and inline padding, on both sides: its width less its content's. */
const CONTENT_INSET_WIDTH_PX = 40;

/**
 * @param {number} tileHeightPx - The list's height.
 * @param {number} mountCount - How many mounts there are.
 * @returns {number} How many the list names.
 */
function listCount(tileHeightPx, mountCount) {
    return connectionsFit.listMountCountThatFits({
        tileHeightPx, listHeightsPx: connectionsFit.connectionsListHeightsPx(DEFAULT_LINE_BOXES_PX), mountCount,
    });
}

/**
 * @param {number} lineWidthPx - The width the line's links may take.
 * @param {number[]} mountWidthsPx - Each mount's link, in listing order, as far as the line has slots.
 * @param {number} [mountCount] - How many mounts there are, beyond the slots too.
 * @returns {number} How many mounts the line names.
 */
function lineCount(lineWidthPx, mountWidthsPx, mountCount = mountWidthsPx.length) {
    return connectionsFit.lineMountCountThatFits({
        lineWidthPx, linkWidthsPx: LINK_WIDTHS_PX, mountWidthsPx, mountCount, moreWidthPx: MORE_LINE_WIDTH_PX,
        gapPx: LINE_LINK_GAP_PX,
    });
}

const MOUNT_COUNTS = [0, 1, 2, 3, 4, 5, 6];

test('connectionsFit: the list\'s heights at the default size are 48 above its links, 26 a row, 17 for the rule, ' +
    '22 for "+N more" and 18 below', () =>
    assertEqual(connectionsFit.connectionsListHeightsPx(DEFAULT_LINE_BOXES_PX),
        {aboveLinksPx: 48, linkRowPx: 26, ruleBlockPx: 17, moreLinePx: 22, belowLinksPx: 18}));

test('connectionsFit: the list\'s heights follow the line boxes, and a line box that reads badly takes the default ' +
    'size\'s', () =>
    assertEqual([
        {[LineKind.TITLE]: 35, [LineKind.DETAIL]: 25, [LineKind.ROW]: 27},
        {[LineKind.TITLE]: -1, [LineKind.DETAIL]: null, [LineKind.ROW]: 17.3},
    ].map(lineBoxesPx => connectionsFit.connectionsListHeightsPx(lineBoxesPx)), [
        {aboveLinksPx: 60, linkRowPx: 35, ruleBlockPx: 17, moreLinePx: 30, belowLinksPx: 18},
        {aboveLinksPx: 48, linkRowPx: 26, ruleBlockPx: 17, moreLinePx: 22, belowLinksPx: 18},
    ]));

test('connectionsFit: at 232 px the list names every mount where two fit, else one beside "+N more"', () =>
    assertEqual(MOUNT_COUNTS.map(mountCount => listCount(232, mountCount)), [0, 1, 2, 1, 1, 1, 1]));

test('connectionsFit: at 258 px, three, else two', () =>
    assertEqual(MOUNT_COUNTS.map(mountCount => listCount(258, mountCount)), [0, 1, 2, 3, 2, 2, 2]));

test('connectionsFit: at 304 px every mount up to five, and four beside "+N more" for six', () =>
    assertEqual(MOUNT_COUNTS.map(mountCount => listCount(304, mountCount)), [0, 1, 2, 3, 4, 5, 4]));

test('connectionsFit: however tall the list, it names five at most', () =>
    assertEqual([5, 6, 20].map(mountCount => listCount(800, mountCount)), [5, 5, 5]));

test('connectionsFit: a list too short for a mount names none, never a negative count', () =>
    assertEqual([0, 1, 9].map(mountCount => listCount(180, mountCount)), [0, 0, 0]));

test('connectionsFit: one pixel either side of the step from two mounts to three beside "+N more", with nine mounts',
    () => assertEqual([260, 261].map(tileHeightPx => listCount(tileHeightPx, 9)), [2, 3]));

test('connectionsFit: the line names every mount where all fit, else as many as leave room for "+N more", one ' +
    'pixel either side of each step', () =>
    assertEqual([518, 519, 650, 651, 694, 695].map(lineWidthPx => lineCount(lineWidthPx, [100, 100, 100])),
        [0, 1, 1, 2, 2, 3]));

test('connectionsFit: a last mount that fits only without "+N more" is named', () =>
    assertEqual([430, 431].map(lineWidthPx => lineCount(lineWidthPx, [100])), [0, 1]));

test('connectionsFit: a mount wider than the line ends the count: no later mount is named past it', () =>
    assertEqual(lineCount(1000, [2000, 50]), 0));

test('connectionsFit: no mount names none, and links wider than the line name none', () =>
    assertEqual([lineCount(1000, []), lineCount(200, [10, 10])], [0, 0]));

test('connectionsFit: the list\'s least width and stop, and the line\'s least, in two parts', () =>
    assertEqual(connectionsFit.connectionsWidthsPx({mountName: 70, mountDetail: 70, lineTexts: 300}), {
        listLeastWidthPx: {fixedPx: 120, textPx: 140, totalPx: 260},
        listStopWidthPx: {fixedPx: 196, textPx: 140, totalPx: 336},
        lineLeastWidthPx: {fixedPx: 288, textPx: 300, totalPx: 588},
    }));

test('connectionsFit: a mount\'s label in the list is at most 104 px at the default row line, and grows with it', () =>
    assertEqual([18, 23, 27].map(rowLinePx => connectionsFit.mountNameMostWidthPx(rowLinePx)), [104, 133, 156]));

test('connectionsFit: a mount row\'s label takes its text up to its most, the bar the rest down to its least, and ' +
    'the label gives way below that', () =>
    assertEqual([
        {contentWidthPx: 220, nameNaturalPx: 50, nameMostPx: 104, detailNaturalPx: 66},
        {contentWidthPx: 300, nameNaturalPx: 150, nameMostPx: 104, detailNaturalPx: 66},
        {contentWidthPx: 220, nameNaturalPx: 150, nameMostPx: 200, detailNaturalPx: 66},
        {contentWidthPx: 220, nameNaturalPx: 50, nameMostPx: 104, detailNaturalPx: 0},
        {contentWidthPx: 60, nameNaturalPx: 50, nameMostPx: 104, detailNaturalPx: 66},
    ].map(widths => connectionsFit.mountRowWidthsPx(widths)), [
        {nameWidthPx: 50, barWidthPx: 52},
        {nameWidthPx: 104, barWidthPx: 78},
        {nameWidthPx: 74, barWidthPx: 28},
        {nameWidthPx: 50, barWidthPx: 118},
        {nameWidthPx: 0, barWidthPx: 0},
    ]));

test('connectionsFit: the dashed rule is centred in its height and 1 px thick, whatever the height', () =>
    assertEqual([[3, 5], [3, 4], [3, 2]].map(([widthPx, heightPx]) =>
        connectionsFit.unknownSizeDashRectsPx(widthPx, heightPx)), [[[0, 2, 3, 1]], [[0, 1, 3, 1]], [[0, 0, 3, 1]]]));

test('connectionsFit: the dashed rule is bounded: a width past the bound draws as wide as the bound, and a width or ' +
    'a height that is no finite number draws nothing', () =>
    assertEqual([
        connectionsFit.unknownSizeDashRectsPx(1e7, 1).length, connectionsFit.unknownSizeDashRectsPx(Infinity, 1),
        connectionsFit.unknownSizeDashRectsPx(20, Infinity), connectionsFit.unknownSizeDashRectsPx(Number.NaN, 1),
    ], [DASH_RECT_MOST_COUNT, [], [], []]));

test('connectionsFit: a list height that is no number names no mount, never NaN', () =>
    assertEqual([undefined, Number.NaN, null].map(tileHeightPx => listCount(tileHeightPx, 3)), [0, 0, 0]));

test('connectionsFit: a line, mount or "+N more" width that is no number names no mount, never all', () =>
    assertEqual([
        lineCount(Number.NaN, [100, 100]), lineCount(undefined, [100, 100]), lineCount(2000, [Number.NaN, 100]),
        connectionsFit.lineMountCountThatFits({
            lineWidthPx: 2000, linkWidthsPx: LINK_WIDTHS_PX, mountWidthsPx: [100, 100], mountCount: 9,
            moreWidthPx: Number.NaN, gapPx: LINE_LINK_GAP_PX,
        }),
        connectionsFit.lineMountCountThatFits({
            lineWidthPx: 2000, linkWidthsPx: [64, Number.NaN, 71], mountWidthsPx: [100], moreWidthPx: 56,
            gapPx: LINE_LINK_GAP_PX,
        }),
    ], [0, 0, 0, 0, 0]));

test('connectionsFit: the line\'s least holds its sampled links and one mount, with no pixel to spare; a wider word ' +
    'in their place ("Wired" for "Wi-Fi") names no mount, and the line says "+9 more"', () => {
    const lineWidthPx = connectionsFit.connectionsWidthsPx(connectionsFit.DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX)
        .lineLeastWidthPx.totalPx - CONTENT_INSET_WIDTH_PX;
    const linkWidthPx = (name, detail) => connectionsFit.lineLinkWidthPx({
        nameNaturalPx: LINE_WORD_WIDTHS_PX[name], detailNaturalPx: detail ? LINE_WORD_WIDTHS_PX[detail] : 0,
    });
    assertEqual(['Wi-Fi', 'Wired'].map(uplinkName => connectionsFit.lineMountCountThatFits({
        lineWidthPx, linkWidthsPx: [linkWidthPx(uplinkName), linkWidthPx('VPN', 'down'), linkWidthPx('SSH', '5')],
        mountWidthsPx: Array(8).fill(linkWidthPx('nas-media', '888G')), mountCount: 9,
        moreWidthPx: LINE_WORD_WIDTHS_PX['+9 more'], gapPx: LINE_LINK_GAP_PX,
    })), [1, 0]);
});

test('connectionsFit: the rule of a mount with no sizes is dashes of 3 px every 6 px across its width, the last one ' +
    'cut at the edge', () =>
    assertEqual([[20, 1], [0, 1], [7, 0]].map(([widthPx, heightPx]) =>
        connectionsFit.unknownSizeDashRectsPx(widthPx, heightPx)),
    [[[0, 0, 3, 1], [6, 0, 3, 1], [12, 0, 3, 1], [18, 0, 2, 1]], [], []]));

test('connectionsFit: a mount past the line\'s slots keeps room for "+N more" after the last slot that fits', () =>
    assertEqual([lineCount(695, [100, 100, 100]), lineCount(695, [100, 100, 100], 9)], [3, 2]));

test('connectionsFit: a link of the line is its icon, its name and, where it has one, its detail, 8 px apart', () =>
    assertEqual([[40, 30], [40, 0]].map(([nameNaturalPx, detailNaturalPx]) =>
        connectionsFit.lineLinkWidthPx({nameNaturalPx, detailNaturalPx})), [102, 64]));

test('connectionsFit: the tile\'s two forms are the list and the one line', () =>
    assertEqual(Object.values(connectionsFit.ConnectionsForm), ['list', 'line']));

test('connectionsFit: at the default text size the list\'s least width is 255 and its stop 331, the line\'s least 571',
    () => assertEqual(connectionsFit.connectionsWidthsPx(connectionsFit.DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX), {
        listLeastWidthPx: {fixedPx: 120, textPx: 135, totalPx: 255},
        listStopWidthPx: {fixedPx: 196, textPx: 135, totalPx: 331},
        lineLeastWidthPx: {fixedPx: 288, textPx: 283, totalPx: 571},
    }));
