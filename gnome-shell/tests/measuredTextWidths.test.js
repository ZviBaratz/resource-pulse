// lib/measuredTextWidths.js: each tile's text widths, and the sheet's widths that hold text, from the widths St gives
// the tiles' sample texts, as St gave them in the nested shell at text scaling 1, 1.25 and 1.5, from made-up widths,
// and from odd readings.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as measuredTextWidths from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredTextWidths.js';
import {LineKind} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';
import {
    DEFAULT_HEAVIEST_TEXT_WIDTHS_PX, heaviestWidthsPx,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/heaviestRankings.js';
import {
    DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX, connectionsWidthsPx,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/connectionsFit.js';

/** Past this a reading is a bad one (lib/measuredLengths.js MOST_READING_PX). */
const PAST_THE_BOUND_PX = 32769;

/**
 * A stand-in for the composition's default sizes: the widths this module fills, at those sizes' figures, and lengths
 * it does not fill, which must come through as they are. The composition's own default sizes are its module's.
 */
const STAND_IN_DEFAULT_SHEET = Object.freeze({
    marginPx: 24,
    heaviest: Object.freeze({fixedHeightPx: 88, rowHeightPx: 24, leastWidthPx: 440, stopWidthPx: 624}),
    connections: Object.freeze({
        lineHeightPx: 56, lineLeastWidthPx: 600, listLeastWidthPx: 260, listStopWidthPx: 336,
    }),
    oneRow: Object.freeze({heaviestWidthPx: 624, connectionsWidthPx: 300, sessionsColumnCount: 3}),
});

/**
 * The sample texts' widths in px as St gave them in the nested shell, by class and text.
 *
 * @param {number[]} rowWidthsPx - `docker.service`, `888.8G`, `1023M`, `100%`, `nas-media`, `888G free`,
 *     `no answer`, `Wi-Fi`, `VPN`, `down`, `SSH`, `5` and `888G` in the row's class, in that order.
 * @param {number} moreWidthPx - `+8 more` in the detail's class.
 * @returns {object} The widths, keyed by LineKind value and then by text.
 */
function sampleReadings(rowWidthsPx, moreWidthPx) {
    const rowTexts = ['docker.service', '888.8G', '1023M', '100%', 'nas-media', '888G free', 'no answer', 'Wi-Fi',
        'VPN', 'down', 'SSH', '5', '888G'];
    return {
        [LineKind.ROW]: Object.fromEntries(rowTexts.map((text, textIndex) => [text, rowWidthsPx[textIndex]])),
        [LineKind.DETAIL]: {'+8 more': moreWidthPx},
    };
}

/** St's widths at text scaling 1, 1.25 and 1.5 (Ubuntu Sans 11 pt, monitor scale 1). */
const ST_READINGS_BY_SCALING = Object.freeze({
    1: sampleReadings([95, 46, 45, 36, 68, 65, 67, 34, 28, 37, 26, 8, 34], 48),
    1.25: sampleReadings([117, 57, 56, 45, 82, 80, 83, 40, 36, 46, 33, 10, 42], 61),
    1.5: sampleReadings([140, 68, 67, 55, 100, 96, 102, 49, 43, 56, 39, 12, 51], 72),
});

/**
 * The tiles' widths and the sheet's from readings, through the module's own registry.
 *
 * @param {*} readings - The sample widths.
 * @param {*} [defaultSheet] - The default sheet.
 * @returns {{textWidthsPx: object, sheet: object, fallbackNames: string[]}} What a measurer would give.
 */
function measuredFrom(readings, defaultSheet = STAND_IN_DEFAULT_SHEET) {
    const entries = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES;
    const widths = measuredTextWidths.measuredTextWidths(entries, readings);
    const {sheet, fallbackNames} = measuredTextWidths.measuredSheetWidths(defaultSheet, entries, widths);
    return {textWidthsPx: widths.textWidthsPx, sheet, fallbackNames: [...widths.fallbackNames, ...fallbackNames]};
}

/**
 * The sheet's widths that hold text, in one flat object, for a row to compare.
 *
 * @param {object} sheet - A sheet.
 * @returns {object} Its Heaviest, Connections and one-row widths.
 */
function sheetWidthsOf(sheet) {
    return {
        heaviest: [sheet.heaviest.leastWidthPx, sheet.heaviest.stopWidthPx, sheet.oneRow.heaviestWidthPx],
        connections: [sheet.connections.listLeastWidthPx, sheet.connections.listStopWidthPx,
            sheet.connections.lineLeastWidthPx, sheet.oneRow.connectionsWidthPx],
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
    'a value of 46, 57 and 68, and Connections a mount\'s name, its detail and the line\'s texts; no fallback', () =>
    assertEqual(Object.values(ST_READINGS_BY_SCALING).map(readings => {
        const {textWidthsPx, fallbackNames} = measuredFrom(readings);
        return {textWidthsPx, fallbackNames};
    }), [
        {textWidthsPx: {
            heaviest: {rankingName: 95, rankingValue: 46},
            connections: {mountName: 68, mountDetail: 67, lineTexts: 283},
        }, fallbackNames: []},
        {textWidthsPx: {
            heaviest: {rankingName: 117, rankingValue: 57},
            connections: {mountName: 82, mountDetail: 83, lineTexts: 350},
        }, fallbackNames: []},
        {textWidthsPx: {
            heaviest: {rankingName: 140, rankingValue: 68},
            connections: {mountName: 100, mountDetail: 102, lineTexts: 422},
        }, fallbackNames: []},
    ]));

test('measuredTextWidths: St\'s widths give the sheet Heaviest\'s least and stop (and one row\'s, its stop) of ' +
    '438 and 622, 504 and 688, 572 and 756; Connections\' list 255 to 331, 285 to 361, 322 to 398, its line 571, ' +
    '638 and 710, and one row\'s 295, 325 and 362', () =>
    assertEqual(Object.values(ST_READINGS_BY_SCALING).map(readings => sheetWidthsOf(measuredFrom(readings).sheet)), [
        {heaviest: [438, 622, 622], connections: [255, 331, 571, 295]},
        {heaviest: [504, 688, 688], connections: [285, 361, 638, 325]},
        {heaviest: [572, 756, 756], connections: [322, 398, 710, 362]},
    ]));

test('measuredTextWidths: each sheet width is its tile\'s own sum of the widths handed to the tile, whatever they ' +
    'are, so the stop the composition gives and the stop Heaviest widens at are one number from one read', () => {
    const readings = withReading(withReading(ST_READINGS_BY_SCALING[1.25], LineKind.ROW, 'docker.service', 203),
        LineKind.DETAIL, '+8 more', 7);
    const {textWidthsPx, sheet} = measuredFrom(readings);
    const heaviest = heaviestWidthsPx(textWidthsPx.heaviest);
    const connections = connectionsWidthsPx(textWidthsPx.connections);
    assertEqual(sheetWidthsOf(sheet), {
        heaviest: [heaviest.leastWidthPx.totalPx, heaviest.stopWidthPx.totalPx, heaviest.stopWidthPx.totalPx],
        connections: [connections.listLeastWidthPx.totalPx, connections.listStopWidthPx.totalPx,
            connections.lineLeastWidthPx.totalPx, connections.oneRowWidthPx.totalPx],
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
    '32 768) leaves its whole part at the tile\'s default, never the widest of the rest, and names it; the other ' +
    'parts are measured', () => {
    const badReadings = [undefined, null, '57', Number.NaN, 0, -3, Number.POSITIVE_INFINITY, PAST_THE_BOUND_PX];
    assertEqual(badReadings.map(badReading => {
        const {textWidthsPx, fallbackNames} =
            measuredFrom(withReading(ST_READINGS_BY_SCALING[1.25], LineKind.ROW, '1023M', badReading));
        return {heaviest: textWidthsPx.heaviest, fallbackNames};
    }), badReadings.map(() => ({
        heaviest: {rankingName: 117, rankingValue: DEFAULT_HEAVIEST_TEXT_WIDTHS_PX.rankingValue},
        fallbackNames: ['textWidths.heaviest.rankingValue', 'heaviest.leastWidthPx', 'heaviest.stopWidthPx',
            'oneRow.heaviestWidthPx'],
    })));
});

test('measuredTextWidths: a summed part whose sum passes 32 768 keeps its default and is named, though every ' +
    'reading in it is good', () => {
    const {textWidthsPx, fallbackNames} =
        measuredFrom(withReading(ST_READINGS_BY_SCALING[1], LineKind.ROW, '888G', 32760));
    assertEqual({lineTexts: textWidthsPx.connections.lineTexts, fallbackNames}, {
        lineTexts: DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX.lineTexts,
        fallbackNames: ['textWidths.connections.lineTexts', 'connections.lineLeastWidthPx'],
    });
});

test('measuredTextWidths: a sheet width that needs a part that fell back keeps the sheet\'s default, not the sum ' +
    'of the default part, and is named; the widths that need only measured parts are measured', () => {
    const {sheet, fallbackNames} =
        measuredFrom(withReading(ST_READINGS_BY_SCALING[1.5], LineKind.ROW, 'no answer', Number.NaN));
    assertEqual({widths: sheetWidthsOf(sheet), fallbackNames}, {
        widths: {heaviest: [572, 756, 756], connections: [260, 336, 710, 300]},
        fallbackNames: ['textWidths.connections.mountDetail', 'connections.listLeastWidthPx',
            'connections.listStopWidthPx', 'oneRow.connectionsWidthPx'],
    });
});

test('measuredTextWidths: readings that are not an object leave every part at its default and the default sheet ' +
    'itself, and name every part and width', () => {
    const everyName = ['textWidths.heaviest.rankingName', 'textWidths.heaviest.rankingValue',
        'textWidths.connections.mountName', 'textWidths.connections.mountDetail', 'textWidths.connections.lineTexts',
        'heaviest.leastWidthPx', 'heaviest.stopWidthPx', 'oneRow.heaviestWidthPx', 'connections.listLeastWidthPx',
        'connections.listStopWidthPx', 'connections.lineLeastWidthPx', 'oneRow.connectionsWidthPx'];
    assertEqual([null, undefined, 'readings', 17, []].map(readings => {
        const {textWidthsPx, sheet, fallbackNames} = measuredFrom(readings);
        return {textWidthsPx, isDefaultSheet: sheet === STAND_IN_DEFAULT_SHEET, fallbackNames};
    }), [null, undefined, 'readings', 17, []].map(() => ({
        textWidthsPx: {heaviest: DEFAULT_HEAVIEST_TEXT_WIDTHS_PX, connections: DEFAULT_CONNECTIONS_TEXT_WIDTHS_PX},
        isDefaultSheet: true,
        fallbackNames: everyName,
    })));
});

test('measuredTextWidths: a sheet width whose sum passes 32 768 keeps its default and is named, though its parts ' +
    'were measured', () => {
    const readings = withReading(withReading(ST_READINGS_BY_SCALING[1], LineKind.ROW, 'docker.service', 16000),
        LineKind.ROW, '888.8G', 400);
    const {textWidthsPx, sheet, fallbackNames} = measuredFrom(readings);
    assertEqual({heaviest: textWidthsPx.heaviest, widths: sheetWidthsOf(sheet).heaviest, fallbackNames}, {
        heaviest: {rankingName: 16000, rankingValue: 400},
        widths: [440, 624, 624],
        fallbackNames: ['heaviest.leastWidthPx', 'heaviest.stopWidthPx', 'oneRow.heaviestWidthPx'],
    });
});

test('measuredTextWidths: the sheet is a copy, frozen along each path it sets; every other length comes through ' +
    'as it is, and the default sheet is left as it was', () => {
    const before = JSON.stringify(STAND_IN_DEFAULT_SHEET);
    const {sheet} = measuredFrom(ST_READINGS_BY_SCALING[1]);
    assertEqual({
        frozen: [sheet, sheet.heaviest, sheet.connections, sheet.oneRow].map(part => Object.isFrozen(part)),
        untouched: [sheet.marginPx, sheet.heaviest.fixedHeightPx, sheet.connections.lineHeightPx,
            sheet.oneRow.sessionsColumnCount],
        defaultSheetUnchanged: JSON.stringify(STAND_IN_DEFAULT_SHEET) === before,
    }, {frozen: [true, true, true, true], untouched: [24, 88, 56, 3], defaultSheetUnchanged: true});
});

test('measuredTextWidths: a sheet width names the parts it needs, and needs no other: changing a part it does not ' +
    'name leaves it as it was, changing one it names moves it', () => {
    const entries = measuredTextWidths.TILE_TEXT_WIDTH_ENTRIES;
    const mismatches = [];
    for (const {tileKey, defaultTextWidthsPx, sheetWidths} of entries) {
        for (const {path, partNames, widthOf} of sheetWidths) {
            for (const partName of Object.keys(defaultTextWidthsPx)) {
                const changed = {...defaultTextWidthsPx, [partName]: defaultTextWidthsPx[partName] + 7};
                const isMoved = widthOf(changed) !== widthOf(defaultTextWidthsPx);
                if (isMoved !== partNames.includes(partName))
                    mismatches.push(`${tileKey} ${path.join('.')} ${partName}`);
            }
        }
    }
    assertEqual(mismatches, []);
});

test('measuredTextWidths: the registry holds Heaviest and Connections, each with its own samples and defaults, ' +
    'every part of its defaults sampled; its labels are each distinct text in a class once, 14 in all, each class ' +
    'one the stylesheet sizes', () => {
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
    }, {tiles: ['heaviest', 'connections'], partsSampled: [true, true], labelCount: 14, distinct: 14,
        classesSized: true});
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
    assertEqual(sheetWidthsOf(sheet), {heaviest: [438, 622, 622], connections: [255, 331, 571, 295]});
});
