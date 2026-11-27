// lib/sessionsTileGeometry.js: where every part of the Sessions tile stands, and how wide its columns must be, as
// pure functions of the tile's rectangle, its lengths and its text widths.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as sessionsTileGeometry from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsTileGeometry.js';
import {MOST_READING_PX} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';
import {
    SESSION_ROW_PADDING_INLINE_PX,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';

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
/** The most columns a Sessions tile holds, written out so a changed bound fails here. */
const MOST_COLUMN_COUNT = 6;
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

test('sessionsTileGeometry: a gap or a padding missing, negative or not a finite number is the sheet\'s, and a width ' +
    'so is none; a count is bounded as the flow bounds it, a fraction taken down, one past the most the most, and ' +
    'one that is not a finite number none: no width is NaN, and no count runs on', () => {
    const columnsGiven = given => sessionsTileGeometry.sessionsColumnsGeometry({
        tileWidthPx: 1080, columnCount: 2, columnGapPx: COLUMN_GAP_PX, sidePaddingPx: SIDE_PADDING_PX, ...given,
    });
    const noWidth = {areaWidthPx: 0, columnWidthPx: 0, columnXsPx: [0, 12]};
    const noCount = {areaWidthPx: 1060, columnWidthPx: 0, columnXsPx: []};
    assertEqual({
        oddGaps: [undefined, -12, Number.POSITIVE_INFINITY].map(columnGapPx => columnsGiven({columnGapPx})),
        oddPaddings: [Number.NaN, -20, Number.POSITIVE_INFINITY].map(sidePaddingPx => columnsGiven({sidePaddingPx})),
        oddWidths: [undefined, -1080, Number.POSITIVE_INFINITY].map(tileWidthPx => columnsGiven({tileWidthPx})),
        oddCounts: [Number.NaN, Number.POSITIVE_INFINITY, '2'].map(columnCount => columnsGiven({columnCount})),
        aFraction: columnsGiven({columnCount: 2.5}),
        pastTheMost: columnsGiven({columnCount: MOST_COLUMN_COUNT + 3}).columnXsPx.length,
    }, {
        oddGaps: Array(3).fill(columnsGiven({})),
        oddPaddings: Array(3).fill(columnsGiven({})),
        oddWidths: Array(3).fill(noWidth),
        oddCounts: Array(3).fill(noCount),
        aFraction: columnsGiven({}),
        pastTheMost: MOST_COLUMN_COUNT,
    });
});

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

test('sessionsTileGeometry: a waiting row\'s lift is its row less the gap under it; a heading, and a group\'s ' +
    'heading run on into a later column, is drawn on its line, under the room above it; a row and the "+N more" ' +
    'line take their whole height', () => {
    const drawnOf = (lengths, column = FLOW_COLUMN) => sessionsTileGeometry.sessionsItemPlaces([column], lengths,
        1000)[0].map(place => [place.item.kind, place.drawnTopPx - place.topPx, place.drawnHeightPx]);
    assertEqual({
        atDefaults: drawnOf(DEFAULT_LENGTHS), scaled: drawnOf(SCALED_LENGTHS), runOn: drawnOf(DEFAULT_LENGTHS,
            RUN_ON_COLUMN),
    }, {
        atDefaults: [['heading', 6, 16], ['row', 0, 40], ['row', 0, 40], ['heading', 6, 16], ['row', 0, 24],
            ['more', 0, 21]],
        scaled: [['heading', 6, 23], ['row', 0, 51], ['row', 0, 51], ['heading', 6, 23], ['row', 0, 33],
            ['more', 0, 30]],
        runOn: [['continued', 6, 16], ['row', 0, 21], ['row', 0, 21]],
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
        atDefaults: [421, 422, 544].map(columnWidthPx => hasStrips(columnWidthPx, defaults)),
        scaled: [487, 488].map(columnWidthPx => hasStrips(columnWidthPx, scaledWidths)),
        olderService: hasStrips(544, defaults, false),
    }, {atDefaults: [false, true, true], scaled: [false, true], olderService: false});
});

test('sessionsTileGeometry: a column\'s least width and its stop are each a fixed part and its text: the stop is ' +
    'a full name beside a strip, the least the same text without one', () =>
    assertEqual(sessionsTileGeometry.sessionsColumnWidthParts(sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX), {
        leastWidthPx: {fixedPx: 74, textPx: 299, totalPx: 373},
        stopWidthPx: {fixedPx: 204, textPx: 299, totalPx: 503},
        stripWidthPx: {fixedPx: 204, textPx: 218, totalPx: 422},
    }));

test('sessionsTileGeometry: the default text widths are St\'s at text scaling 1, and text widths are taken whole, ' +
    'rounded up, and one that reads badly is its default', () => {
    const defaults = sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX;
    assertEqual([
        sessionsTileGeometry.sessionsTextWidthsInWholePixels({age: 33.2, memory: 41, nameBesideStrip: 149.5,
            fullName: 244}),
        sessionsTileGeometry.sessionsTextWidthsInWholePixels({age: -1, memory: Number.NaN, nameBesideStrip: '150'}),
        sessionsTileGeometry.sessionsTextWidthsInWholePixels(undefined),
        sessionsTileGeometry.sessionsTextWidthsInWholePixels(null),
        defaults,
    ], [
        {age: 34, memory: 41, nameBesideStrip: 150, fullName: 244},
        {...defaults}, {...defaults}, {...defaults},
        {age: 36, memory: 45, nameBesideStrip: 137, fullName: 218},
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
    'widest unit and its mark and the oldest age written, the widest memory in GiB and in MiB, a twenty-character ' +
    'name and a full one', () => {
    const samples = sessionsTileGeometry.SESSIONS_WIDTH_SAMPLE_TEXTS;
    assertEqual({
        keys: Object.keys(samples),
        lineKinds: Object.values(samples).map(sample => sample.lineKind),
        texts: Object.values(samples).map(sample => sample.texts),
        defaultKeys: Object.keys(sessionsTileGeometry.DEFAULT_SESSIONS_TEXT_WIDTHS_PX),
    }, {
        keys: ['age', 'memory', 'nameBesideStrip', 'fullName'],
        lineKinds: ['rp-tile-text-row', 'rp-tile-text-row', 'rp-tile-text-row', 'rp-tile-text-row'],
        texts: [['88m*', '99d+'], ['88.8G', '1023M'], ['release-notes-review'],
            ['release-notes-review-and-publish']],
        defaultKeys: ['age', 'memory', 'nameBesideStrip', 'fullName'],
    });
});

/**
 * The header's parts in a 416 px tile (396 inside its side padding) as St measured them at text scaling 1, 1.25 and
 * 1.5, each with its gap: the title's count after its 9 px gap, the counts' box with its 12 px gap, the memory with
 * its 12 px gap.
 */
const HEADERS_AT_416_BY_SCALING = {
    1: {headerWidthPx: 396, titleWordWidthPx: 70, titleCountWidthPx: 31, stateCountsWidthPx: 206,
        totalMemoryWidthPx: 45},
    1.25: {headerWidthPx: 396, titleWordWidthPx: 88, titleCountWidthPx: 35, stateCountsWidthPx: 220,
        totalMemoryWidthPx: 54},
    1.5: {headerWidthPx: 396, titleWordWidthPx: 107, titleCountWidthPx: 41, stateCountsWidthPx: 234,
        totalMemoryWidthPx: 63},
};
/** The header the rule's edges are walked on: 416 px at text scaling 1.25. */
const HEADER_AT_416 = HEADERS_AT_416_BY_SCALING[1.25];
/** The header's side padding, both sides: a row's. */
const HEADER_SIDE_PADDING_PX = 2 * SESSION_ROW_PADDING_INLINE_PX;

/**
 * @param {object} given - The header's widths that differ from HEADER_AT_416's.
 * @returns {{isTitleWordShown: boolean, isTotalMemoryShown: boolean}} What the header shows.
 */
function headerPartsShown(given) {
    return sessionsTileGeometry.sessionsHeaderPartsShown({...HEADER_AT_416, ...given});
}

/**
 * @param {number} roomPx - The room inside the header's side padding.
 * @returns {{headerWidthPx: number}} A header that has that room.
 */
function headerWithRoom(roomPx) {
    return {headerWidthPx: roomPx + HEADER_SIDE_PADDING_PX};
}

test('sessionsTileGeometry: the header shows every part where all fit inside its side padding; where they do not, ' +
    'the memory gives way first, then the title\'s word, each whole; the counts never give way', () => {
    const {titleWordWidthPx, titleCountWidthPx, stateCountsWidthPx, totalMemoryWidthPx} = HEADER_AT_416;
    const countsPx = titleCountWidthPx + stateCountsWidthPx;
    const withTitleWordPx = countsPx + titleWordWidthPx;
    const everythingPx = withTitleWordPx + totalMemoryWidthPx;
    const allShown = {isTitleWordShown: true, isTotalMemoryShown: true};
    const withoutMemory = {isTitleWordShown: true, isTotalMemoryShown: false};
    const countsAlone = {isTitleWordShown: false, isTotalMemoryShown: false};
    assertEqual({
        allFit: headerPartsShown(headerWithRoom(everythingPx)),
        aPixelShort: headerPartsShown(headerWithRoom(everythingPx - 1)),
        theWordFits: headerPartsShown(headerWithRoom(withTitleWordPx)),
        aPixelShortOfTheWord: headerPartsShown(headerWithRoom(withTitleWordPx - 1)),
        theCountsFit: headerPartsShown(headerWithRoom(countsPx)),
        shortOfTheCounts: headerPartsShown(headerWithRoom(countsPx - 1)),
        noMemoryToShow: headerPartsShown({...headerWithRoom(withTitleWordPx), totalMemoryWidthPx: 0}),
    }, {
        allFit: allShown, aPixelShort: withoutMemory, theWordFits: withoutMemory, aPixelShortOfTheWord: countsAlone,
        theCountsFit: countsAlone, shortOfTheCounts: countsAlone, noMemoryToShow: allShown,
    });
});

test('sessionsTileGeometry: at 416 px the header shows every part at text scaling 1, gives the memory way at 1.25, ' +
    'and the memory and the title\'s word at 1.5, each count whole', () =>
    assertEqual(Object.values(HEADERS_AT_416_BY_SCALING).map(header =>
        sessionsTileGeometry.sessionsHeaderPartsShown(header)), [
        {isTitleWordShown: true, isTotalMemoryShown: true},
        {isTitleWordShown: true, isTotalMemoryShown: false},
        {isTitleWordShown: false, isTotalMemoryShown: false},
    ]));

test('sessionsTileGeometry: a header width that cannot be read gives the header no room, and a part\'s width that ' +
    'cannot be read (missing, NaN, negative, infinite), whichever part, is none', () => {
    const {titleWordWidthPx, titleCountWidthPx, stateCountsWidthPx} = HEADER_AT_416;
    // Room for the word and the counts: a part read as none shows the word, one read as infinite would hide it.
    const room = headerWithRoom(titleWordWidthPx + titleCountWidthPx + stateCountsWidthPx);
    const partNames = ['titleWordWidthPx', 'titleCountWidthPx', 'stateCountsWidthPx', 'totalMemoryWidthPx'];
    const badWidths = [undefined, Number.NaN, -45, Number.POSITIVE_INFINITY];
    const shownWithNone = partNames.map(partName => headerPartsShown({...room, [partName]: 0}));
    assertEqual({
        noHeaderWidth: [undefined, Number.NaN, Number.POSITIVE_INFINITY]
            .map(headerWidthPx => headerPartsShown({headerWidthPx})),
        badAsNone: partNames.map(partName =>
            badWidths.map(badWidth => headerPartsShown({...room, [partName]: badWidth}))),
        shownWithNone,
    }, {
        noHeaderWidth: Array(3).fill({isTitleWordShown: false, isTotalMemoryShown: false}),
        badAsNone: shownWithNone.map(shown => Array(badWidths.length).fill(shown)),
        shownWithNone: [
            {isTitleWordShown: true, isTotalMemoryShown: true}, {isTitleWordShown: true, isTotalMemoryShown: false},
            {isTitleWordShown: true, isTotalMemoryShown: true}, {isTitleWordShown: true, isTotalMemoryShown: true},
        ],
    });
});
