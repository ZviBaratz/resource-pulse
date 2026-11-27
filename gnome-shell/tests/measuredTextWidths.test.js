// lib/measuredTextWidths.js: each tile's text widths, and the sheet's widths that hold text, from the widths St gives
// the tiles' sample texts, as St gave them in the nested shell at text scaling 1, 1.25 and 1.5, from made-up widths,
// and from odd readings.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as measuredTextWidths from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredTextWidths.js';
import {LineKind, SampleCombine} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';
import {
    DEFAULT_HEAVIEST_TEXT_WIDTHS_PX, heaviestWidthsPx,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/heaviestRankings.js';
import {
    DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX, connectionsWidthsPx,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/connectionsFit.js';
import {
    DEFAULT_SESSIONS_TEXT_WIDTHS_PX, sessionsColumnWidthParts,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsTileGeometry.js';
import {DEFAULT_COCKPIT_SIZES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionSizes.js';

/** Past this a reading is a bad one (lib/measuredLengths.js MOST_READING_PX). */
const PAST_THE_BOUND_PX = 32769;

/** The Sessions tile's sample texts in the row's class that no other tile samples: its ages, a memory and its names. */
const SESSIONS_ROW_TEXTS = ['88m*', '99d+', '88.8G', 'release-notes-review', 'release-notes-review-and-publish'];

/**
 * The sample texts' widths in px as St gave them in the nested shell, by class and text.
 *
 * @param {number[]} rowWidthsPx - `docker.service`, `888.8G`, `1023M`, `100%`, `nas-media`, `888G free`,
 *     `no answer`, `Wi-Fi`, `VPN`, `down`, `SSH`, `5` and `888G` in the row's class, in that order.
 * @param {number} moreWidthPx - `+8 more` in the detail's class.
 * @param {number[]} sessionsRowWidthsPx - SESSIONS_ROW_TEXTS in the row's class, in that order; `1023M`, which
 *     Sessions shares with Heaviest, is in rowWidthsPx.
 * @returns {object} The widths, keyed by LineKind value and then by text.
 */
function sampleReadings(rowWidthsPx, moreWidthPx, sessionsRowWidthsPx) {
    const rowTexts = ['docker.service', '888.8G', '1023M', '100%', 'nas-media', '888G free', 'no answer', 'Wi-Fi',
        'VPN', 'down', 'SSH', '5', '888G', ...SESSIONS_ROW_TEXTS];
    const rowTextWidthsPx = [...rowWidthsPx, ...sessionsRowWidthsPx];
    return {
        [LineKind.ROW]: Object.fromEntries(rowTexts.map((text, textIndex) => [text, rowTextWidthsPx[textIndex]])),
        [LineKind.DETAIL]: {'+8 more': moreWidthPx},
    };
}

/** St's widths at text scaling 1, 1.25 and 1.5 (Ubuntu Sans 11 pt, monitor scale 1). */
const ST_READINGS_BY_SCALING = Object.freeze({
    1: sampleReadings([95, 46, 45, 36, 68, 65, 67, 34, 28, 37, 26, 8, 34], 48, [36, 33, 38, 137, 218]),
    1.25: sampleReadings([117, 57, 56, 45, 82, 80, 83, 40, 36, 46, 33, 10, 42], 61, [45, 41, 47, 169, 268]),
    1.5: sampleReadings([140, 68, 67, 55, 100, 96, 102, 49, 43, 56, 39, 12, 51], 72, [53, 49, 56, 205, 327]),
});

/** A full name's width with a fraction, which the Sessions tile takes as 218, St's whole width at text scaling 1. */
const FRACTIONAL_FULL_NAME_WIDTH_PX = 217.2;

/** The composition's Sessions column widths that the Sessions entry fills, and no other. */
const SESSIONS_SHEET_WIDTH_PATHS = ['sessions.columnLeastWidthPx', 'sessions.columnStopWidthPx'];

/** Each tile's defaults, by its key: what every part of a tile that falls back takes. */
const DEFAULT_TEXT_WIDTHS_BY_TILE = Object.freeze({
    heaviest: DEFAULT_HEAVIEST_TEXT_WIDTHS_PX, connections: DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX,
    sessions: DEFAULT_SESSIONS_TEXT_WIDTHS_PX,
});

/** Each tile's names in `fallbackNames` when it falls back: every part, then every sheet width. */
const PART_NAMES_BY_TILE = Object.freeze({
    heaviest: ['textWidths.heaviest.rankingName', 'textWidths.heaviest.rankingValue'],
    connections: ['textWidths.connections.mountName', 'textWidths.connections.mountDetail',
        'textWidths.connections.lineTexts'],
    sessions: ['textWidths.sessions.age', 'textWidths.sessions.memory', 'textWidths.sessions.nameBesideStrip',
        'textWidths.sessions.fullName'],
});
const WIDTH_PATHS_BY_TILE = Object.freeze({
    heaviest: ['heaviest.leastWidthPx', 'heaviest.stopWidthPx', 'oneRow.heaviestWidthPx'],
    connections: ['connections.listLeastWidthPx', 'connections.listStopWidthPx', 'connections.lineLeastWidthPx',
        'oneRow.connectionsWidthPx'],
    sessions: SESSIONS_SHEET_WIDTH_PATHS,
});

/**
 * The names a read gives where these tiles fell back: their parts in the registry's order, then their sheet widths.
 *
 * @param {string[]} tileKeys - The tiles that fell back, in the registry's order.
 * @returns {string[]} The names.
 */
function fallbackNamesOfTiles(tileKeys) {
    return [...tileKeys.flatMap(tileKey => PART_NAMES_BY_TILE[tileKey]),
        ...tileKeys.flatMap(tileKey => WIDTH_PATHS_BY_TILE[tileKey])];
}

/**
 * The tiles' widths and the sheet's from readings, through the module's own registry.
 *
 * @param {*} readings - The sample widths.
 * @param {*} [defaultSheet] - The default sheet.
 * @returns {{textWidthsPx: object, sheet: object, fallbackNames: string[]}} What a measurer would give.
 */
function measuredFrom(readings, defaultSheet = DEFAULT_COCKPIT_SIZES) {
    const entries = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES;
    const widths = measuredTextWidths.measuredTextWidths(entries, readings);
    const {sheet, fallbackNames} = measuredTextWidths.measuredSheetWidths(defaultSheet, entries, widths);
    return {textWidthsPx: widths.textWidthsPx, sheet, fallbackNames: [...widths.fallbackNames, ...fallbackNames]};
}

/**
 * The sheet's widths that hold text, in one flat object, for a row to compare.
 *
 * @param {object} sheet - A sheet.
 * @returns {object} Its Heaviest, Connections, one-row and Sessions column widths.
 */
function sheetWidthsOf(sheet) {
    return {
        heaviest: [sheet.heaviest.leastWidthPx, sheet.heaviest.stopWidthPx, sheet.oneRow.heaviestWidthPx],
        connections: [sheet.connections.listLeastWidthPx, sheet.connections.listStopWidthPx,
            sheet.connections.lineLeastWidthPx, sheet.oneRow.connectionsWidthPx],
        sessions: [sheet.sessions.columnLeastWidthPx, sheet.sessions.columnStopWidthPx],
    };
}

/**
 * Readings with one text's width replaced.
 *
 * @param {object} readings - Readings by class and text.
 * @param {string} lineKind - The text's class.
 * @param {string} text - The text.
 * @param {*} widthPx - Its new width.
 * @returns {object} A copy with that width.
 */
function withReading(readings, lineKind, text, widthPx) {
    return {...readings, [lineKind]: {...readings[lineKind], [text]: widthPx}};
}

test('measuredTextWidths: St\'s widths at text scaling 1, 1.25 and 1.5 give Heaviest a name of 95, 117 and 140 and ' +
    'a value of 46, 57 and 68, Connections a mount\'s name, its detail and the line\'s texts, and Sessions an age, ' +
    'a memory and its two names; no fallback', () =>
    assertEqual(Object.values(ST_READINGS_BY_SCALING).map(readings => {
        const {textWidthsPx, fallbackNames} = measuredFrom(readings);
        return {textWidthsPx, fallbackNames};
    }), [
        {textWidthsPx: {
            heaviest: {rankingName: 95, rankingValue: 46},
            connections: {mountName: 68, mountDetail: 67, lineTexts: 283},
            sessions: {age: 36, memory: 45, nameBesideStrip: 137, fullName: 218},
        }, fallbackNames: []},
        {textWidthsPx: {
            heaviest: {rankingName: 117, rankingValue: 57},
            connections: {mountName: 82, mountDetail: 83, lineTexts: 350},
            sessions: {age: 45, memory: 56, nameBesideStrip: 169, fullName: 268},
        }, fallbackNames: []},
        {textWidthsPx: {
            heaviest: {rankingName: 140, rankingValue: 68},
            connections: {mountName: 100, mountDetail: 102, lineTexts: 422},
            sessions: {age: 53, memory: 67, nameBesideStrip: 205, fullName: 327},
        }, fallbackNames: []},
    ]));

test('measuredTextWidths: St\'s widths give the sheet Heaviest\'s least and stop (and one row\'s, its stop) of ' +
    '438 and 622, 504 and 688, 572 and 756; Connections\' list 255 to 331, 285 to 361, 322 to 398, its line 571, ' +
    '638 and 710, and one row\'s 295, 325 and 362; a Sessions column\'s least and stop 373 and 503, 443 and 573, ' +
    '521 and 651', () =>
    assertEqual(Object.values(ST_READINGS_BY_SCALING).map(readings => sheetWidthsOf(measuredFrom(readings).sheet)), [
        {heaviest: [438, 622, 622], connections: [255, 331, 571, 295], sessions: [373, 503]},
        {heaviest: [504, 688, 688], connections: [285, 361, 638, 325], sessions: [443, 573]},
        {heaviest: [572, 756, 756], connections: [322, 398, 710, 362], sessions: [521, 651]},
    ]));

test('measuredTextWidths: each sheet width is its tile\'s own sum of the widths handed to the tile, whatever they ' +
    'are, so the stop the composition gives and the stop Heaviest widens at are one number from one read', () => {
    const readings = withReading(withReading(withReading(ST_READINGS_BY_SCALING[1.25], LineKind.ROW,
        'docker.service', 203), LineKind.DETAIL, '+8 more', 7), LineKind.ROW, 'release-notes-review-and-publish', 301);
    const {textWidthsPx, sheet} = measuredFrom(readings);
    const heaviest = heaviestWidthsPx(textWidthsPx.heaviest);
    const connections = connectionsWidthsPx(textWidthsPx.connections);
    const sessionsColumn = sessionsColumnWidthParts(textWidthsPx.sessions);
    assertEqual(sheetWidthsOf(sheet), {
        heaviest: [heaviest.leastWidthPx.totalPx, heaviest.stopWidthPx.totalPx, heaviest.stopWidthPx.totalPx],
        connections: [connections.listLeastWidthPx.totalPx, connections.listStopWidthPx.totalPx,
            connections.lineLeastWidthPx.totalPx, connections.oneRowWidthPx.totalPx],
        sessions: [sessionsColumn.leastWidthPx.totalPx, sessionsColumn.stopWidthPx.totalPx],
    });
});

test('measuredTextWidths: a width with a fraction is rounded up on its own, before the widest is taken or the ' +
    'widths are added', () => {
    const readings = withReading(withReading(withReading(ST_READINGS_BY_SCALING[1], LineKind.ROW, 'docker.service',
        94.2), LineKind.ROW, '100%', 46.01), LineKind.ROW, 'Wi-Fi', 33.4);
    // Each up, 34 and 28; added first, 60.8 would round to 61 and the line to 282.
    const {textWidthsPx} = measuredFrom(withReading(readings, LineKind.ROW, 'VPN', 27.4));
    assertEqual([textWidthsPx.heaviest, textWidthsPx.connections.lineTexts],
        [{rankingName: 95, rankingValue: 47}, 283]);
});

test('measuredTextWidths: a text that reads badly (missing, null, a string, NaN, 0, negative, infinite, past ' +
    '32 768) falls back every tile that samples it whole ("1023M": Heaviest\'s value and Sessions\' memory), each ' +
    'part its default, never the widest of the rest, every part and sheet width named; the tile that does not ' +
    'sample it is measured', () => {
    const badReadings = [undefined, null, '57', Number.NaN, 0, -3, Number.POSITIVE_INFINITY, PAST_THE_BOUND_PX];
    assertEqual(badReadings.map(badReading => {
        const {textWidthsPx, sheet, fallbackNames} =
            measuredFrom(withReading(ST_READINGS_BY_SCALING[1.25], LineKind.ROW, '1023M', badReading));
        return {textWidthsPx, sheetWidths: sheetWidthsOf(sheet), fallbackNames};
    }), badReadings.map(() => ({
        textWidthsPx: {
            heaviest: DEFAULT_HEAVIEST_TEXT_WIDTHS_PX,
            connections: {mountName: 82, mountDetail: 83, lineTexts: 350},
            sessions: DEFAULT_SESSIONS_TEXT_WIDTHS_PX,
        },
        sheetWidths: {heaviest: [440, 624, 624], connections: [285, 361, 638, 325], sessions: [400, 524]},
        fallbackNames: fallbackNamesOfTiles(['heaviest', 'sessions']),
    })));
});

test('measuredTextWidths: a tile with any one part bad has every part at its default and every name of it listed, ' +
    'its parts\' and its sheet widths\'; every other tile is measured', () => {
    const measuredAtScaling125 = measuredFrom(ST_READINGS_BY_SCALING[1.25]).textWidthsPx;
    const tilePartPairs = [['heaviest', 'rankingName'], ['heaviest', 'rankingValue'], ['connections', 'mountName'],
        ['connections', 'mountDetail'], ['connections', 'lineTexts'], ['sessions', 'age'], ['sessions', 'memory'],
        ['sessions', 'nameBesideStrip'], ['sessions', 'fullName']];
    assertEqual(tilePartPairs.map(([tileKey, partName]) => {
        const entry = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES.find(candidate => candidate.tileKey === tileKey);
        // The part's first text: sampled by no other tile, so only its own tile falls back.
        const [{lineKind, texts: [firstText]}] = measuredTextWidths.sampleGroupsOf(entry.samples[partName]).samples;
        const {textWidthsPx, fallbackNames} =
            measuredFrom(withReading(ST_READINGS_BY_SCALING[1.25], lineKind, firstText, Number.NaN));
        return {tileKey, partName, textWidthsPx, fallbackNames};
    }), tilePartPairs.map(([tileKey, partName]) => ({
        tileKey, partName,
        textWidthsPx: {...measuredAtScaling125, [tileKey]: DEFAULT_TEXT_WIDTHS_BY_TILE[tileKey]},
        fallbackNames: fallbackNamesOfTiles([tileKey]),
    })));
});

test('measuredTextWidths: a part with no sample text is no reading, a widest part and a summed one alike: its tile ' +
    'falls back whole and is named, never measured at -Infinity or 0', () => {
    const MADE_UP_SHEET = Object.freeze({madeUp: Object.freeze({widthPx: 40})});
    const madeUpEntryWith = unsampledPart => ({
        tileKey: 'madeUp',
        samples: {sampled: {lineKind: LineKind.ROW, texts: ['5']}, unsampled: unsampledPart},
        defaultTextWidthsPx: {sampled: 9, unsampled: 11},
        sheetWidths: [{path: ['madeUp', 'widthPx'], widthOf: ({sampled, unsampled}) => sampled + unsampled}],
    });
    const partsWithNoText = [
        {lineKind: LineKind.ROW, texts: []},
        {combine: SampleCombine.SUM, samples: []},
        {combine: SampleCombine.SUM, samples: [{lineKind: LineKind.ROW, texts: []}]},
    ];
    assertEqual(partsWithNoText.map(unsampledPart => {
        const entries = [madeUpEntryWith(unsampledPart)];
        const widths = measuredTextWidths.measuredTextWidths(entries, ST_READINGS_BY_SCALING[1]);
        const {sheet, fallbackNames} = measuredTextWidths.measuredSheetWidths(MADE_UP_SHEET, entries, widths);
        return {textWidthsPx: widths.textWidthsPx, sheet, fallbackNames: [...widths.fallbackNames, ...fallbackNames]};
    }), partsWithNoText.map(() => ({
        textWidthsPx: {madeUp: {sampled: 9, unsampled: 11}},
        sheet: MADE_UP_SHEET,
        fallbackNames: ['textWidths.madeUp.sampled', 'textWidths.madeUp.unsampled', 'madeUp.widthPx'],
    })));
});

test('measuredTextWidths: a summed part whose sum passes 32 768 falls its tile back whole, though every reading ' +
    'in it is good: every part its default and named, every sheet width of it the sheet\'s', () => {
    const {textWidthsPx, fallbackNames} =
        measuredFrom(withReading(ST_READINGS_BY_SCALING[1], LineKind.ROW, '888G', 32760));
    assertEqual({connections: textWidthsPx.connections, fallbackNames}, {
        connections: DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX,
        fallbackNames: fallbackNamesOfTiles(['connections']),
    });
});

test('measuredTextWidths: a tile with one part that falls back keeps every sheet width of it at the sheet\'s ' +
    'default, not the sum of the default part, the widths that need only its good parts among them; the other ' +
    'tiles are measured', () => {
    const {textWidthsPx, sheet, fallbackNames} =
        measuredFrom(withReading(ST_READINGS_BY_SCALING[1.5], LineKind.ROW, 'no answer', Number.NaN));
    assertEqual({connections: textWidthsPx.connections, widths: sheetWidthsOf(sheet), fallbackNames}, {
        connections: DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX,
        widths: {heaviest: [572, 756, 756], connections: [260, 336, 600, 300], sessions: [521, 651]},
        fallbackNames: fallbackNamesOfTiles(['connections']),
    });
});

test('measuredTextWidths: readings that are not an object leave every part at its default and the default sheet ' +
    'itself, and name every part and width', () => {
    const everyName = ['textWidths.heaviest.rankingName', 'textWidths.heaviest.rankingValue',
        'textWidths.connections.mountName', 'textWidths.connections.mountDetail', 'textWidths.connections.lineTexts',
        'textWidths.sessions.age', 'textWidths.sessions.memory', 'textWidths.sessions.nameBesideStrip',
        'textWidths.sessions.fullName',
        'heaviest.leastWidthPx', 'heaviest.stopWidthPx', 'oneRow.heaviestWidthPx', 'connections.listLeastWidthPx',
        'connections.listStopWidthPx', 'connections.lineLeastWidthPx', 'oneRow.connectionsWidthPx',
        ...SESSIONS_SHEET_WIDTH_PATHS];
    assertEqual([null, undefined, 'readings', 17, []].map(readings => {
        const {textWidthsPx, sheet, fallbackNames} = measuredFrom(readings);
        return {textWidthsPx, isDefaultSheet: sheet === DEFAULT_COCKPIT_SIZES, fallbackNames};
    }), [null, undefined, 'readings', 17, []].map(() => ({
        textWidthsPx: {
            heaviest: DEFAULT_HEAVIEST_TEXT_WIDTHS_PX, connections: DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX,
            sessions: DEFAULT_SESSIONS_TEXT_WIDTHS_PX,
        },
        isDefaultSheet: true,
        fallbackNames: everyName,
    })));
});

test('measuredTextWidths: a sheet width whose sum passes 32 768 falls its tile back whole, though its parts ' +
    'read well: the tile is handed its defaults, never parts the sheet does not hold', () => {
    const readings = withReading(withReading(ST_READINGS_BY_SCALING[1], LineKind.ROW, 'docker.service', 16000),
        LineKind.ROW, '888.8G', 400);
    const {textWidthsPx, sheet, fallbackNames} = measuredFrom(readings);
    assertEqual({heaviest: textWidthsPx.heaviest, widths: sheetWidthsOf(sheet).heaviest, fallbackNames}, {
        heaviest: DEFAULT_HEAVIEST_TEXT_WIDTHS_PX,
        widths: [440, 624, 624],
        fallbackNames: fallbackNamesOfTiles(['heaviest']),
    });
});

test('measuredTextWidths: the sheet is a copy, frozen along each path it sets; every other length comes through ' +
    'as it is, and the default sheet is left as it was', () => {
    const before = JSON.stringify(DEFAULT_COCKPIT_SIZES);
    const {sheet} = measuredFrom(ST_READINGS_BY_SCALING[1]);
    assertEqual({
        frozen: [sheet, sheet.heaviest, sheet.connections, sheet.oneRow, sheet.sessions]
            .map(part => Object.isFrozen(part)),
        untouched: [sheet.marginPx, sheet.heaviest.fixedHeightPx, sheet.connections.lineHeightPx,
            sheet.oneRow.sessionsColumnCount, sheet.sessions.columnGapPx, sheet.sessions.sidePaddingPx],
        defaultSheetUnchanged: JSON.stringify(DEFAULT_COCKPIT_SIZES) === before,
    }, {frozen: [true, true, true, true, true], untouched: [24, 88, 56, 3, 12, 20], defaultSheetUnchanged: true});
});

test('measuredTextWidths: the registry holds Heaviest, Connections and Sessions, each with its own samples and ' +
    'defaults, every part of its defaults sampled; its labels are each distinct text in a class once, 19 in all ' +
    '("1023M" read once for Heaviest and Sessions), each class one the stylesheet sizes', () => {
    const entries = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES;
    const labels = measuredTextWidths.sampleLabelsOf(entries);
    const lineKinds = new Set(Object.values(LineKind));
    assertEqual({
        tiles: entries.map(({tileKey}) => tileKey),
        partsSampled: entries.map(({samples, defaultTextWidthsPx}) =>
            JSON.stringify(Object.keys(samples)) === JSON.stringify(Object.keys(defaultTextWidthsPx))),
        labelCount: labels.length,
        distinct: new Set(labels.map(({lineKind, text}) => `${lineKind}\n${text}`)).size,
        classesSized: labels.every(({lineKind}) => lineKinds.has(lineKind)),
    }, {tiles: ['heaviest', 'connections', 'sessions'], partsSampled: [true, true, true], labelCount: 19,
        distinct: 19, classesSized: true});
});

test('measuredTextWidths: a part of one class is the widest of its texts; a summed part adds every text of each ' +
    'of its classes, Connections\' line its words in the row\'s class and "+8 more" in the detail\'s', () =>
    assertEqual(['rankingValue', 'lineTexts'].map(partName => {
        const entry = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES.find(({samples}) => partName in samples);
        return measuredTextWidths.sampleGroupsOf(entry.samples[partName]);
    }), [
        {combine: 'widest', samples: [{lineKind: LineKind.ROW, texts: ['888.8G', '1023M', '100%']}]},
        {combine: 'sum', samples: [
            {lineKind: LineKind.ROW, texts: ['Wi-Fi', 'VPN', 'down', 'SSH', '5', 'nas-media', '888G']},
            {lineKind: LineKind.DETAIL, texts: ['+8 more']},
        ]},
    ]));

test('measuredTextWidths: a default sheet that is not an object gives the measured widths alone', () => {
    const {sheet} = measuredFrom(ST_READINGS_BY_SCALING[1], null);
    assertEqual(sheetWidthsOf(sheet),
        {heaviest: [438, 622, 622], connections: [255, 331, 571, 295], sessions: [373, 503]});
});

test('measuredTextWidths: every sheet width a tile fills names a width of the composition\'s default sizes ' +
    '(DEFAULT_COCKPIT_SIZES): a whole number of px at that path, so a renamed or moved length fails here; and the ' +
    'tile\'s own sum of its defaults never passes it, so a tile that falls back whole fits the width the sheet ' +
    'gives it', () => {
    const entries = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES;
    const defaultSheetWidthAt = path => path.reduce((node, key) => node?.[key], DEFAULT_COCKPIT_SIZES);
    const pathsThatAreNotWidths = entries.flatMap(entry => entry.sheetWidths)
        .map(({path}) => path)
        .filter(path => {
            const value = defaultSheetWidthAt(path);
            return !Number.isInteger(value) || value <= 0 || !path.at(-1).endsWith('WidthPx');
        })
        .map(path => path.join('.'));
    const defaultSumsPastTheSheet = entries.flatMap(({defaultTextWidthsPx, sheetWidths}) => sheetWidths
        .filter(({path, widthOf}) => !(widthOf(defaultTextWidthsPx) <= defaultSheetWidthAt(path)))
        .map(({path}) => path.join('.')));
    // Every tile's every width is checked: the registry's widths are the nine the rows name.
    const widthsChecked = entries.flatMap(({sheetWidths}) => sheetWidths.map(({path}) => path.join('.')));
    assertEqual({pathsThatAreNotWidths, defaultSumsPastTheSheet, widthsChecked}, {
        pathsThatAreNotWidths: [], defaultSumsPastTheSheet: [],
        widthsChecked: Object.values(WIDTH_PATHS_BY_TILE).flat(),
    });
});


test('measuredTextWidths: the Sessions entry fills the composition\'s two column widths and no other length of its ' +
    'Sessions part: St\'s widths at text scaling 1 give 373 and 503 where DEFAULT_COCKPIT_SIZES holds 400 and 524, ' +
    'the width from which a column has strips stays the tile\'s, and its rules take a width as the tile takes one, ' +
    'a fraction rounded up', () => {
    const sessionsEntry = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES.find(({tileKey}) => tileKey === 'sessions');
    const filledPaths = sessionsEntry.sheetWidths.map(({path}) => path.join('.'));
    const {sheet} = measuredFrom(ST_READINGS_BY_SCALING[1]);
    const otherSessionsKeys = Object.keys(DEFAULT_COCKPIT_SIZES.sessions)
        .filter(key => !filledPaths.includes(`sessions.${key}`));
    assertEqual({
        filledPaths,
        measuredAtOne: sheetWidthsOf(sheet).sessions,
        defaults: [DEFAULT_COCKPIT_SIZES.sessions.columnLeastWidthPx, DEFAULT_COCKPIT_SIZES.sessions.columnStopWidthPx],
        othersAsTheDefaults: otherSessionsKeys.every(key => sheet.sessions[key] === DEFAULT_COCKPIT_SIZES.sessions[key]),
        fromAFraction: sessionsEntry.sheetWidths.map(({widthOf}) =>
            widthOf({...DEFAULT_SESSIONS_TEXT_WIDTHS_PX, fullName: FRACTIONAL_FULL_NAME_WIDTH_PX})),
    }, {
        filledPaths: SESSIONS_SHEET_WIDTH_PATHS, measuredAtOne: [373, 503], defaults: [400, 524],
        othersAsTheDefaults: true, fromAFraction: [373, 503],
    });
});
