// lib/sessionsTileGeometry.js: where every part of the Sessions tile stands, and how wide its columns must be, as
// pure functions of the tile's rectangle, its lengths and its text widths.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as sessionsTileGeometry from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsTileGeometry.js';
import {MOST_READING_PX} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';

/** The flow's lengths at the default text size, as the layout hands them in. */
const DEFAULT_LENGTHS = {
    aboveColumnsHeightPx: 80, groupHeadingHeightPx: 24, moreLineHeightPx: 21,
    rowHeightPxByState: {blocked: 44, working: 24, done: 21, idle: 21, unknown: 21},
};
/** The lengths St measured at text scaling 1 and 1.5. */
const ST_LENGTHS = {
    aboveColumnsHeightPx: 80, groupHeadingHeightPx: 24, moreLineHeightPx: 22,
    rowHeightPxByState: {blocked: 45, working: 24, done: 21, idle: 21, unknown: 21},
};
const SCALED_LENGTHS = {
    aboveColumnsHeightPx: 99, groupHeadingHeightPx: 31, moreLineHeightPx: 30,
    rowHeightPxByState: {blocked: 55, working: 33, done: 30, idle: 30, unknown: 30},
};
/** The sheet's gap between columns and the tile's side padding, both sides. */
const COLUMN_GAP_PX = 12;
const SIDE_PADDING_PX = 20;
/** A column of the flow: two groups, one cut short. */
const FLOW_COLUMN = [
    {kind: 'heading', state: 'blocked', count: 2}, {kind: 'row', state: 'blocked', indexInGroup: 0},
    {kind: 'row', state: 'blocked', indexInGroup: 1}, {kind: 'heading', state: 'working', count: 9},
    {kind: 'row', state: 'working', indexInGroup: 0}, {kind: 'more', state: 'working', hiddenCount: 8},
];
/** A later column of the flow, which a group runs on into. */
const RUN_ON_COLUMN = [
    {kind: 'continued', state: 'idle'}, {kind: 'row', state: 'idle', indexInGroup: 7},
    {kind: 'row', state: 'idle', indexInGroup: 8},
];

/**
 * @param {object} lengths - The flow's lengths.
 * @param {Array<object>} items - One column of the flow's items.
 * @returns {number} The height the flow counts for them, one after another.
 */
function countedHeightPx(lengths, items) {
    return items.reduce((sum, item) => sum + (item.kind === 'row' ? lengths.rowHeightPxByState[item.state]
        : item.kind === 'more' ? lengths.moreLineHeightPx : lengths.groupHeadingHeightPx), 0);
}

/**
 * @param {number} tileWidthPx - The tile's width.
 * @param {number} columnCount - Its columns.
 * @returns {object} Its columns' geometry.
 */
function columnsOf(tileWidthPx, columnCount) {
    return sessionsTileGeometry.sessionsColumnsGeometry({
        tileWidthPx, columnCount, columnGapPx: COLUMN_GAP_PX, sidePaddingPx: SIDE_PADDING_PX,
    });
}

test('sessionsTileGeometry: one column fills the tile inside its side padding, the one column\'s extra width ' +
    'included', () =>
    assertEqual([columnsOf(440, 1), columnsOf(564, 1), columnsOf(416, 1)], [
        {areaWidthPx: 420, columnWidthPx: 420, columnXsPx: [0]},
        {areaWidthPx: 544, columnWidthPx: 544, columnXsPx: [0]},
        {areaWidthPx: 396, columnWidthPx: 396, columnXsPx: [0]},
    ]));

test('sessionsTileGeometry: every column is one whole width, and the odd pixels of a split go to the gaps from ' +
    'the left, so the last column ends at the area\'s right edge', () => {
    const twoEven = columnsOf(1080, 2);
    const twoOdd = columnsOf(1081, 2);
    const three = columnsOf(1300, 3);
    const six = columnsOf(2700, 6);
    const rightEdgePx = geometry => geometry.columnXsPx.at(-1) + geometry.columnWidthPx;
    assertEqual({
        twoEven, twoOdd, three, six,
        rightEdges: [twoEven, twoOdd, three, six].map(rightEdgePx),
    }, {
        twoEven: {areaWidthPx: 1060, columnWidthPx: 524, columnXsPx: [0, 536]},
        twoOdd: {areaWidthPx: 1061, columnWidthPx: 524, columnXsPx: [0, 537]},
        three: {areaWidthPx: 1280, columnWidthPx: 418, columnXsPx: [0, 431, 862]},
        six: {areaWidthPx: 2680, columnWidthPx: 436, columnXsPx: [0, 449, 898, 1347, 1796, 2244]},
        rightEdges: [1060, 1061, 1280, 2680],
    });
});

test('sessionsTileGeometry: a tile with no column, or narrower than its padding, has no width to share', () =>
    assertEqual([columnsOf(564, 0), columnsOf(10, 1)], [
        {areaWidthPx: 544, columnWidthPx: 0, columnXsPx: []},
        {areaWidthPx: 0, columnWidthPx: 0, columnXsPx: [0]},
    ]));

test('sessionsTileGeometry: each item stands where the flow counted it, its height the length the flow was handed, ' +
    'at the defaults, at St\'s lengths and at text scaling 1.5: a column\'s items end at the flow\'s sum', () => {
    const placesOf = lengths => sessionsTileGeometry.sessionsItemPlaces([FLOW_COLUMN, RUN_ON_COLUMN], lengths, 1000);
    const summary = lengths => placesOf(lengths).map(column => ({
        tops: column.map(place => place.topPx),
        heights: column.map(place => place.heightPx),
        endPx: column.at(-1).topPx + column.at(-1).heightPx,
    }));
    assertEqual(summary(DEFAULT_LENGTHS), [
        {tops: [0, 24, 68, 112, 136, 160], heights: [24, 44, 44, 24, 24, 21], endPx: 181},
        {tops: [0, 24, 45], heights: [24, 21, 21], endPx: 66},
    ]);
    for (const lengths of [DEFAULT_LENGTHS, ST_LENGTHS, SCALED_LENGTHS]) {
        assertEqual(summary(lengths).map(column => column.endPx),
            [countedHeightPx(lengths, FLOW_COLUMN), countedHeightPx(lengths, RUN_ON_COLUMN)]);
    }
});

test('sessionsTileGeometry: a waiting row\'s lift is its row less the gap under it; a heading is drawn on its ' +
    'line, under the room above it; a row and the "+N more" line take their whole height', () => {
    const drawnOf = lengths => sessionsTileGeometry.sessionsItemPlaces([FLOW_COLUMN], lengths, 1000)[0]
        .map(place => [place.item.kind, place.drawnTopPx - place.topPx, place.drawnHeightPx]);
    assertEqual({atDefaults: drawnOf(DEFAULT_LENGTHS), scaled: drawnOf(SCALED_LENGTHS)}, {
        atDefaults: [['heading', 6, 16], ['row', 0, 40], ['row', 0, 40], ['heading', 6, 16], ['row', 0, 24],
            ['more', 0, 21]],
        scaled: [['heading', 6, 23], ['row', 0, 51], ['row', 0, 51], ['heading', 6, 23], ['row', 0, 33],
            ['more', 0, 30]],
    });
});

test('sessionsTileGeometry: where the flow does not fit, an item that does not stand wholly inside its column is ' +
    'not shown, and every item that does is', () =>
    assertEqual([181, 180, 160, 23].map(flowHeightPx =>
        sessionsTileGeometry.sessionsItemPlaces([FLOW_COLUMN], DEFAULT_LENGTHS, flowHeightPx)[0]
            .map(place => place.isShown)), [
        [true, true, true, true, true, true],
        [true, true, true, true, true, false],
        [true, true, true, true, true, false],
        [false, false, false, false, false, false],
    ]));

test('sessionsTileGeometry: the header is the title\'s line, the column labels take the rest above the columns, ' +
    'and the flow has the tile\'s height under them', () =>
    assertEqual([
        sessionsTileGeometry.sessionsTileBlockHeights({tileHeightPx: 736, lengths: DEFAULT_LENGTHS,
            titleLineBoxPx: 23}),
        sessionsTileGeometry.sessionsTileBlockHeights({tileHeightPx: 736, lengths: SCALED_LENGTHS,
            titleLineBoxPx: 31}),
        sessionsTileGeometry.sessionsTileBlockHeights({tileHeightPx: 60, lengths: DEFAULT_LENGTHS,
            titleLineBoxPx: 23}),
    ], [
        {headerHeightPx: 23, labelsRowHeightPx: 14, flowHeightPx: 656},
        {headerHeightPx: 31, labelsRowHeightPx: 25, flowHeightPx: 637},
        {headerHeightPx: 23, labelsRowHeightPx: 14, flowHeightPx: 0},
    ]));

test('sessionsTileGeometry: a column has strips where its width, less a strip row\'s fixed parts, holds the age, ' +
    'the memory and a name of about twenty characters; never without the services\' histories', () => {
    const defaults = sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX;
    const scaledWidths = {age: 43, memory: 53, nameBesideStrip: 188, fullName: 305};
    const hasStrips = (columnWidthPx, textWidthsPx, hasStateHistories = true) =>
        sessionsTileGeometry.hasStripColumn({columnWidthPx, textWidthsPx, hasStateHistories});
    assertEqual({
        atDefaults: [429, 430, 544].map(columnWidthPx => hasStrips(columnWidthPx, defaults)),
        scaled: [487, 488].map(columnWidthPx => hasStrips(columnWidthPx, scaledWidths)),
        olderService: hasStrips(544, defaults, false),
    }, {atDefaults: [false, true, true], scaled: [false, true], olderService: false});
});

test('sessionsTileGeometry: a column\'s least width and its stop are each a fixed part and its text: the stop is ' +
    'a full name beside a strip, the least the same text without one', () =>
    assertEqual(sessionsTileGeometry.sessionsColumnWidthParts(sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX), {
        leastWidthPx: {fixedPx: 74, textPx: 320, totalPx: 394},
        stopWidthPx: {fixedPx: 204, textPx: 320, totalPx: 524},
        stripWidthPx: {fixedPx: 204, textPx: 226, totalPx: 430},
    }));

test('sessionsTileGeometry: text widths are taken whole, rounded up, and one that reads badly is its default', () => {
    const defaults = sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX;
    assertEqual([
        sessionsTileGeometry.sessionsTextWidthsInWholePixels({age: 33.2, memory: 41, nameBesideStrip: 149.5,
            fullName: 244}),
        sessionsTileGeometry.sessionsTextWidthsInWholePixels({age: -1, memory: Number.NaN, nameBesideStrip: '150'}),
        sessionsTileGeometry.sessionsTextWidthsInWholePixels(undefined),
        sessionsTileGeometry.sessionsTextWidthsInWholePixels(null),
    ], [
        {age: 34, memory: 41, nameBesideStrip: 150, fullName: 244},
        {...defaults}, {...defaults}, {...defaults},
    ]);
});

test('sessionsTileGeometry: a text width is read by the readings\' rule (lib/measuredLengths.js wholeReadingPx): a ' +
    'width of 0 or one past MOST_READING_PX is a read that failed and takes its default, never a cell of no width; ' +
    'MOST_READING_PX itself, and a fraction over 0, are taken', () => {
    const defaults = sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX;
    assertEqual([
        sessionsTileGeometry.sessionsTextWidthsInWholePixels({
            age: 0, memory: MOST_READING_PX + 1, nameBesideStrip: Number.POSITIVE_INFINITY, fullName: MOST_READING_PX,
        }),
        sessionsTileGeometry.sessionsTextWidthsInWholePixels({age: 0.4, memory: -0, nameBesideStrip: 150}),
    ], [
        {age: defaults.age, memory: defaults.memory, nameBesideStrip: defaults.nameBesideStrip,
            fullName: MOST_READING_PX},
        {age: 1, memory: defaults.memory, nameBesideStrip: 150, fullName: defaults.fullName},
    ]);
});

test('sessionsTileGeometry: each text width is measured with a sample in the rows\' class: an age with its ' +
    'widest unit and its mark, the wider memory, a twenty-character name and a full one', () => {
    const samples = sessionsTileGeometry.SESSIONS_WIDTH_SAMPLE_TEXTS;
    assertEqual({
        keys: Object.keys(samples),
        lineKinds: Object.values(samples).map(sample => sample.lineKind),
        texts: Object.values(samples).map(sample => sample.texts),
        defaultKeys: Object.keys(sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX),
    }, {
        keys: ['age', 'memory', 'nameBesideStrip', 'fullName'],
        lineKinds: ['rp-tile-text-row', 'rp-tile-text-row', 'rp-tile-text-row', 'rp-tile-text-row'],
        texts: [['88m*'], ['88.8G', '888M'], ['release-notes-review'], ['release-notes-review-and-publish']],
        defaultKeys: ['age', 'memory', 'nameBesideStrip', 'fullName'],
    });
});
