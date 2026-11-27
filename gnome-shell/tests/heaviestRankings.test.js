// lib/heaviestRankings.js: the Heaviest tile's two rankings, its widths and its heights, from synthetic app scans and
// line boxes.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as heaviestRankings from '../extensions/resource-pulse@zvibaratz.github.io/lib/heaviestRankings.js';
import {LineKind, measuredSheet} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';

const MEBIBYTE_BYTES = 1024 * 1024;
const GIBIBYTE_BYTES = 1024 * MEBIBYTE_BYTES;
/** How many entries the sampler publishes in each ranking. */
const PUBLISHED_RANKING_LENGTH = 10;
/** Sample widths that make the least width 440 and the stop 624. */
const SAMPLE_TEXT_WIDTHS_PX = {rankingName: 96, rankingValue: 46};
/** The stop the layout's sizes give Heaviest by default. */
const STOP_WIDTH_PX = 624;

/**
 * @param {number} entryCount - How many entries each ranking has.
 * @param {function(number): number} cpuPercentAt - The CPU share of the entry at an index.
 * @returns {{cpuRanking: Array<object>, memoryRanking: Array<object>}} A scan's apps, largest first.
 */
function appsWith(entryCount, cpuPercentAt = index => 20 - index) {
    return {
        cpuRanking: Array.from({length: entryCount}, (_, index) => ({
            groupKey: `unit:cpu-${index}.service`, name: `cpu-${index}`, cpuPercent: cpuPercentAt(index),
        })),
        memoryRanking: Array.from({length: entryCount}, (_, index) => ({
            groupKey: `app:memory-${index}`, name: `memory-${index}`,
            memoryBytes: (entryCount - index) * GIBIBYTE_BYTES,
        })),
    };
}

/**
 * @param {Array<object>} rows - A ranking's rows.
 * @returns {number[]} Their bar fractions.
 */
function barFractions(rows) {
    return rows.map(row => row.barFraction);
}

test('heaviestRankings: each ranking lists as many rows as it is asked for, of the ten published, for 0, 1, 6 and ' +
    '10 rows', () => {
    const apps = appsWith(PUBLISHED_RANKING_LENGTH);
    assertEqual([0, 1, 6, 10].map(rowCount => {
        const {byCpu, byMemory} = heaviestRankings.heaviestRankingRows(apps, rowCount);
        return [byCpu.length, byMemory.length];
    }), [[0, 0], [1, 1], [6, 6], [10, 10]]);
});

test('heaviestRankings: a ranking with fewer entries than rows lists what it has', () => {
    const {byCpu, byMemory} = heaviestRankings.heaviestRankingRows(appsWith(3), 10);
    assertEqual([byCpu.length, byMemory.length], [3, 3]);
});

test('heaviestRankings: a row is the name, the value in today\'s words and the group it was ranked as', () => {
    const {byCpu, byMemory} = heaviestRankings.heaviestRankingRows({
        cpuRanking: [{groupKey: 'app:chromium', name: 'Chromium', cpuPercent: 14.4}],
        memoryRanking: [
            {groupKey: 'app:herdr', name: 'herdr agents', memoryBytes: 11.9 * GIBIBYTE_BYTES},
            {groupKey: 'app:ptyxis', name: 'Ptyxis', memoryBytes: 640 * MEBIBYTE_BYTES},
        ],
    }, 6);
    assertEqual({byCpu, byMemory}, {
        byCpu: [{name: 'Chromium', valueText: '14%', barFraction: 1, tooltipLines: ['app:chromium']}],
        byMemory: [
            {name: 'herdr agents', valueText: '11.9G', barFraction: 1, tooltipLines: ['app:herdr']},
            {name: 'Ptyxis', valueText: '640M', barFraction: 640 / (11.9 * 1024), tooltipLines: ['app:ptyxis']},
        ],
    });
});

test('heaviestRankings: a CPU bar is against the largest of its ranking, not the whole machine', () =>
    assertEqual(barFractions(heaviestRankings.heaviestRankingRows(
        appsWith(3, index => [14, 7, 3.5][index]), 6).byCpu), [1, 0.5, 0.25]));

test('heaviestRankings: an idle machine lists its rows at 0 %, every bar empty, never NaN', () => {
    const {byCpu} = heaviestRankings.heaviestRankingRows(appsWith(4, () => 0), 6);
    assertEqual(byCpu.map(row => [row.valueText, row.barFraction]), [['0%', 0], ['0%', 0], ['0%', 0], ['0%', 0]]);
});

test('heaviestRankings: a null ranking beside an array lists no rows, and the other ranking as it is', () => {
    const {byCpu, byMemory} = heaviestRankings.heaviestRankingRows({...appsWith(2), memoryRanking: null}, 6);
    assertEqual([byCpu.length, byMemory.length], [2, 0]);
});

test('heaviestRankings: apps from a sampler before the rankings (topCpu and topMemory alone), or none, are no data, ' +
    'and the no-data line is the desktop card\'s words', () =>
    assertEqual({
        olderSampler: heaviestRankings.canDrawHeaviest({topCpu: null, topMemory: null}),
        none: heaviestRankings.canDrawHeaviest(null),
        empty: heaviestRankings.canDrawHeaviest({cpuRanking: [], memoryRanking: []}),
        noDataSince: heaviestRankings.heaviestNoDataText('14:02'),
        noData: heaviestRankings.heaviestNoDataText(null),
    }, {olderSampler: false, none: false, empty: true, noDataSince: 'no data since 14:02', noData: 'no data'}));

test('heaviestRankings: a row count that is not a whole number of at least 0 lists no rows', () =>
    assertEqual([-1, Number.NaN, null].map(rowCount =>
        heaviestRankings.heaviestRankingRows(appsWith(3), rowCount).byCpu.length), [0, 0, 0]));

test('heaviestRankings: under its stop the rankings are 24 apart and a name is its text; at the stop and over, 40 ' +
    'apart and a name 36 wider', () =>
    assertEqual([STOP_WIDTH_PX - 1, STOP_WIDTH_PX, 892].map(tileWidthPx => {
        const {rankingGapPx, nameWidthPx} = heaviestRankings.heaviestColumnLayout({
            tileWidthPx, stopWidthPx: STOP_WIDTH_PX, textWidthsPx: SAMPLE_TEXT_WIDTHS_PX,
        });
        return [rankingGapPx, nameWidthPx];
    }), [[24, 96], [40, 132], [40, 132]]));

test('heaviestRankings: a ranking\'s name, gaps, track and value fill its column, and the two columns and their gap ' +
    'the tile\'s content, a pixel or none to spare', () => {
    const sums = [440, 476, 623, 624, 760, 892].map(tileWidthPx => {
        const {rankingGapPx, nameWidthPx, valueWidthPx, trackWidthPx, columnWidthPx} =
            heaviestRankings.heaviestColumnLayout({
                tileWidthPx, stopWidthPx: STOP_WIDTH_PX, textWidthsPx: SAMPLE_TEXT_WIDTHS_PX,
            });
        const rowWidthPx = nameWidthPx + 2 * 12 + trackWidthPx + valueWidthPx;
        const spareWidthPx = tileWidthPx - 2 * 20 - 2 * columnWidthPx - rankingGapPx;
        return [rowWidthPx === columnWidthPx, spareWidthPx];
    });
    assertEqual(sums, [[true, 0], [true, 0], [true, 1], [true, 0], [true, 0], [true, 0]]);
});

test('heaviestRankings: at the least width the bar is 22 px; at the 476 px of a pair\'s Heaviest, 40', () =>
    assertEqual([440, 476].map(tileWidthPx => heaviestRankings.heaviestColumnLayout({
        tileWidthPx, stopWidthPx: STOP_WIDTH_PX, textWidthsPx: SAMPLE_TEXT_WIDTHS_PX,
    }).trackWidthPx), [22, 40]));

test('heaviestRankings: a tile too narrow for its text gives its bar first, never a negative width', () =>
    assertEqual(heaviestRankings.heaviestColumnLayout({
        tileWidthPx: 300, stopWidthPx: STOP_WIDTH_PX, textWidthsPx: SAMPLE_TEXT_WIDTHS_PX,
    }).trackWidthPx, 0));

test('heaviestRankings: the least width and the stop in two parts: 156 fixed and 284 of text at the default, 624 ' +
    'at the stop; text twice as wide doubles the text part only', () =>
    assertEqual([SAMPLE_TEXT_WIDTHS_PX, {rankingName: 192, rankingValue: 92}].map(textWidthsPx =>
        heaviestRankings.heaviestWidthsPx(textWidthsPx)), [
        {
            leastWidthPx: {fixedPx: 156, textPx: 284, totalPx: 440},
            stopWidthPx: {fixedPx: 340, textPx: 284, totalPx: 624},
        },
        {
            leastWidthPx: {fixedPx: 156, textPx: 568, totalPx: 724},
            stopWidthPx: {fixedPx: 340, textPx: 568, totalPx: 908},
        },
    ]));

test('heaviestRankings: the heights drawn are the layout\'s sizes for the same line boxes, at 1, 1.25 and 1.5 and ' +
    'at a fractional box', () => {
    const lineBoxSets = [
        {title: 23, detail: 17, row: 18}, {title: 30, detail: 21, row: 23}, {title: 35, detail: 25, row: 27},
        {title: 22.4, detail: 16.2, row: 17.5},
    ];
    const defaultSheet = Object.freeze({heaviest: Object.freeze({fixedHeightPx: 88, rowHeightPx: 24})});
    assertEqual(lineBoxSets.map(({title, detail, row}) => {
        const lineBoxesPx = {[LineKind.TITLE]: title, [LineKind.DETAIL]: detail, [LineKind.ROW]: row};
        const drawn = heaviestRankings.heaviestHeightsPx(lineBoxesPx);
        const {heaviest} = measuredSheet(defaultSheet, lineBoxesPx).sheet;
        return [drawn.fixedHeightPx === heaviest.fixedHeightPx, drawn.rowHeightPx === heaviest.rowHeightPx];
    }), [[true, true], [true, true], [true, true], [true, true]]);
});

test('heaviestRankings: the heights\' parts: the title, the heading and a row take their line boxes, whole; a line ' +
    'box that reads badly takes the default text size\'s', () =>
    assertEqual([
        {[LineKind.TITLE]: 23, [LineKind.DETAIL]: 17, [LineKind.ROW]: 18},
        {[LineKind.TITLE]: 0, [LineKind.DETAIL]: Number.NaN, [LineKind.ROW]: 17.2},
        null,
    ].map(lineBoxesPx => heaviestRankings.heaviestHeightsPx(lineBoxesPx)), [
        {titleLinePx: 23, headingLinePx: 17, rowLinePx: 18, fixedHeightPx: 89, rowHeightPx: 24},
        {titleLinePx: 23, headingLinePx: 17, rowLinePx: 18, fixedHeightPx: 89, rowHeightPx: 24},
        {titleLinePx: 23, headingLinePx: 17, rowLinePx: 18, fixedHeightPx: 89, rowHeightPx: 24},
    ]));

test('heaviestRankings: a bar fill is its share of its track in whole pixels, at least 1 px on a track, at most the ' +
    'track', () =>
    assertEqual([[0, 40], [0.5, 40], [0.333, 40], [1, 40], [1.5, 40], [0.5, 0], [Number.NaN, 40]].map(
        ([fraction, trackWidthPx]) => heaviestRankings.barFillWidthPx(fraction, trackWidthPx)),
    [1, 20, 13, 40, 40, 0, 1]));

test('heaviestRankings: at the default text size St gives the samples 95 and 46 px, so the least width is 438 and ' +
    'the stop 622', () =>
    assertEqual(heaviestRankings.heaviestWidthsPx(heaviestRankings.DEFAULT_HEAVIEST_TEXT_WIDTHS_PX), {
        leastWidthPx: {fixedPx: 156, textPx: 282, totalPx: 438},
        stopWidthPx: {fixedPx: 340, textPx: 282, totalPx: 622},
    }));
