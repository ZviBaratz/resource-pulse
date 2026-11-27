// lib/measuredLengths.js: the cockpit's lengths that hold text, and its plates' legends, from line boxes and widths
// as St measures them in the nested shell at text scaling 1, 1.25 and 1.5, from made-up widths, and from odd readings.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as measuredLengths from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';

const {LineKind} = measuredLengths;

/**
 * A stand-in for the layout's default sheet: the lengths this module fills, at round values near the measured ones, and
 * one length with no text part, which must come through as it is. The layout's own default sheet is its module's.
 */
const STAND_IN_DEFAULT_SHEET = Object.freeze({
    marginPx: 24,
    plate: Object.freeze({heightPx: 26, gapBelowPx: 8}),
    gaps: Object.freeze({betweenBandsPx: 16}),
    monitor: Object.freeze({heightPxByForm: Object.freeze({wide: 384, medium: 352, small: 328}), stopWidthPx: 984}),
    heaviest: Object.freeze({fixedHeightPx: 88, rowHeightPx: 24, mostRowCount: 10}),
    connections: Object.freeze({lineHeightPx: 56, lineLeastWidthPx: 600}),
});

/** A stand-in for the Sessions tile's default lengths, the same way. */
const STAND_IN_DEFAULT_SESSIONS_LENGTHS = Object.freeze({
    aboveColumnsHeightPx: 80,
    groupHeadingHeightPx: 24,
    moreLineHeightPx: 21,
    rowHeightPxByState: Object.freeze({blocked: 44, working: 24, done: 21, idle: 21, unknown: 21}),
});

/**
 * Each kind's natural height in px as St gave it in the nested shell, at text scaling 1, 1.25 and 1.5: the kinds a
 * length needs. A group heading's count, in a heavier weight, has the heading's line box.
 *
 * @param {number[]} heightsPx - The annunciator, group caption, scale, label, group heading, detail, row, waiting name
 *     and title line boxes, in that order.
 * @returns {object} The line boxes, keyed by LineKind value.
 */
function lineBoxes([annunciator, groupCaption, scale, label, groupHeading, detail, row, waitingName, title]) {
    return {
        [LineKind.ANNUNCIATOR]: annunciator, [LineKind.GROUP_CAPTION]: groupCaption, [LineKind.SCALE]: scale,
        [LineKind.LABEL]: label, [LineKind.GROUP_HEADING]: groupHeading, [LineKind.GROUP_HEADING_COUNT]: groupHeading,
        [LineKind.DETAIL]: detail, [LineKind.ROW]: row, [LineKind.WAITING_NAME]: waitingName, [LineKind.TITLE]: title,
    };
}

/** St's line boxes at text scaling 1, 1.25 and 1.5. */
const ST_LINE_BOXES_BY_SCALING = Object.freeze({
    1: lineBoxes([13, 15, 14, 16, 16, 17, 18, 21, 23]),
    1.25: lineBoxes([17, 18, 17, 19, 20, 21, 23, 26, 30]),
    1.5: lineBoxes([20, 22, 21, 22, 23, 25, 27, 31, 35]),
});

/**
 * The sheet's lengths that hold text, in one flat object, for a row to compare.
 *
 * @param {object} sheet - A sheet.
 * @returns {object} Its plate, monitor, Heaviest and Connections lengths.
 */
function textLengthsOf(sheet) {
    return {
        plate: sheet.plate?.heightPx,
        monitor: sheet.monitor?.heightPxByForm,
        heaviest: [sheet.heaviest?.fixedHeightPx, sheet.heaviest?.rowHeightPx],
        connectionsLine: sheet.connections?.lineHeightPx,
    };
}

/**
 * The sheet's lengths that hold text, measured from St's line boxes at one text scaling.
 *
 * @param {number} scaling - 1, 1.25 or 1.5.
 * @returns {object} The lengths, and those left at the default.
 */
function sheetAtScaling(scaling) {
    const {sheet, fallbackNames} =
        measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, ST_LINE_BOXES_BY_SCALING[scaling]);
    return {...textLengthsOf(sheet), fallbackNames};
}

/**
 * The Sessions tile's lengths, measured from St's line boxes at one text scaling.
 *
 * @param {number} scaling - 1, 1.25 or 1.5.
 * @returns {object} The lengths, and those left at the default.
 */
function sessionsLengthsAtScaling(scaling) {
    const {lengths, fallbackNames} = measuredLengths.measuredSessionsLengths(STAND_IN_DEFAULT_SESSIONS_LENGTHS,
        ST_LINE_BOXES_BY_SCALING[scaling]);
    return {...lengths, fallbackNames};
}

/**
 * The St line boxes at text scaling 1, with one kind's reading replaced.
 *
 * @param {string} lineKind - The kind.
 * @param {*} reading - What it reads, or undefined to leave it out.
 * @returns {object} The line boxes.
 */
function withReading(lineKind, reading) {
    const boxes = {...ST_LINE_BOXES_BY_SCALING[1]};
    if (reading === undefined)
        delete boxes[lineKind];
    else
        boxes[lineKind] = reading;
    return boxes;
}

/** Readings that are no line box or width: missing, null, a string, NaN, 0, negative, infinite, past the bound. */
const BAD_READINGS = Object.freeze([undefined, null, '18', NaN, 0, -18, Infinity, 32769]);

test('measuredLengths: St\'s line boxes at text scaling 1 give the plate 26, the monitor 388, 355 and 331, ' +
    'Heaviest 89 and 24 a row, and Connections in one line 56', () =>
    assertEqual(sheetAtScaling(1), {
        plate: 26, monitor: {wide: 388, medium: 355, small: 331}, heaviest: [89, 24], connectionsLine: 56,
        fallbackNames: [],
    }));

test('measuredLengths: at text scaling 1.25 they give the plate 30, the monitor 422, 385 and 361, Heaviest 100 and ' +
    '29 a row, and Connections in one line 61', () =>
    assertEqual(sheetAtScaling(1.25), {
        plate: 30, monitor: {wide: 422, medium: 385, small: 361}, heaviest: [100, 29], connectionsLine: 61,
        fallbackNames: [],
    }));

test('measuredLengths: at text scaling 1.5 they give the plate 33, the monitor 453, 412 and 388, Heaviest 109 and ' +
    '33 a row, and Connections in one line 65', () =>
    assertEqual(sheetAtScaling(1.5), {
        plate: 33, monitor: {wide: 453, medium: 412, small: 388}, heaviest: [109, 33], connectionsLine: 65,
        fallbackNames: [],
    }));

test('measuredLengths: the Sessions tile at text scaling 1, 1.25 and 1.5: 80, 90 and 99 above the columns; a heading ' +
    '24, 28 and 31; "+N more" 22, 26 and 30; a waiting row 45, 50 and 55, a working one 24, 29 and 33, any other 21, ' +
    '26 and 30', () =>
    assertEqual([1, 1.25, 1.5].map(sessionsLengthsAtScaling), [
        {aboveColumnsHeightPx: 80, groupHeadingHeightPx: 24, moreLineHeightPx: 22,
            rowHeightPxByState: {blocked: 45, working: 24, done: 21, idle: 21, unknown: 21}, fallbackNames: []},
        {aboveColumnsHeightPx: 90, groupHeadingHeightPx: 28, moreLineHeightPx: 26,
            rowHeightPxByState: {blocked: 50, working: 29, done: 26, idle: 26, unknown: 26}, fallbackNames: []},
        {aboveColumnsHeightPx: 99, groupHeadingHeightPx: 31, moreLineHeightPx: 30,
            rowHeightPxByState: {blocked: 55, working: 33, done: 30, idle: 30, unknown: 30}, fallbackNames: []},
    ]));

test('measuredLengths: a length with no text part is the default sheet\'s, the same object where nothing in it is ' +
    'measured, and the default sheet is left as it was, still frozen', () => {
    const {sheet} = measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, ST_LINE_BOXES_BY_SCALING[1.5]);
    assertEqual({
        margin: sheet.marginPx, plateGap: sheet.plate.gapBelowPx, monitorStop: sheet.monitor.stopWidthPx,
        rowCount: sheet.heaviest.mostRowCount, lineLeast: sheet.connections.lineLeastWidthPx,
        gapsShared: sheet.gaps === STAND_IN_DEFAULT_SHEET.gaps, isCopy: sheet !== STAND_IN_DEFAULT_SHEET,
        defaultPlate: STAND_IN_DEFAULT_SHEET.plate.heightPx,
        defaultWide: STAND_IN_DEFAULT_SHEET.monitor.heightPxByForm.wide,
        isDefaultFrozen: Object.isFrozen(STAND_IN_DEFAULT_SHEET) && Object.isFrozen(STAND_IN_DEFAULT_SHEET.monitor),
        isSheetFrozen: Object.isFrozen(sheet) && Object.isFrozen(sheet.monitor.heightPxByForm),
    }, {
        margin: 24, plateGap: 8, monitorStop: 984, rowCount: 10, lineLeast: 600, gapsShared: true, isCopy: true,
        defaultPlate: 26, defaultWide: 384, isDefaultFrozen: true, isSheetFrozen: true,
    });
});

test('measuredLengths: the plate\'s text part is its annunciator cell where the cell is taller, and its group ' +
    'caption where the caption is; a group heading\'s count taller than its words sets the heading', () => {
    const tallCaption = withReading(LineKind.GROUP_CAPTION, 30);
    const tallCount = withReading(LineKind.GROUP_HEADING_COUNT, 19);
    assertEqual({
        plateAtOne: measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, ST_LINE_BOXES_BY_SCALING[1])
            .sheet.plate.heightPx,
        plateWithTallCaption: measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, tallCaption).sheet.plate.heightPx,
        headingWithTallCount: measuredLengths.measuredSessionsLengths(STAND_IN_DEFAULT_SESSIONS_LENGTHS, tallCount)
            .lengths.groupHeadingHeightPx,
    }, {plateAtOne: 26, plateWithTallCaption: 38, headingWithTallCount: 27});
});

test('measuredLengths: a line box with a fraction is rounded up on its own before it is added, and line boxes of ' +
    'half a pixel give whole lengths', () => {
    const fractional = {...withReading(LineKind.ROW, 18.2), [LineKind.DETAIL]: 16.5, [LineKind.LABEL]: 15.1};
    const halfPixel = Object.fromEntries(Object.values(LineKind).map(lineKind => [lineKind, 0.5]));
    const halfPixelSheet = measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, halfPixel).sheet;
    assertEqual({
        fractional: textLengthsOf(measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, fractional).sheet),
        halfPixel: textLengthsOf(halfPixelSheet),
    }, {
        // Wide: 220 + 3 × (2 + 19) + 4 × (6 + 17) + 16; medium: 210 + 3 × (2 + 19) + 3 × (6 + 17) + 16; a ranking's
        // row 6 + 19; one line 38 + 19.
        fractional: {plate: 26, monitor: {wide: 391, medium: 358, small: 334}, heaviest: [89, 25], connectionsLine: 57},
        halfPixel: {plate: 14, monitor: {wide: 258, medium: 241, small: 217}, heaviest: [51, 7], connectionsLine: 39},
    });
});

test('measuredLengths: a row line that reads badly (missing, null, a string, NaN, 0, negative, infinite, past ' +
    '32 768) leaves each length that needs it at the default, and names it', () =>
    assertEqual(BAD_READINGS.map(reading => sheetAtScalingWith(withReading(LineKind.ROW, reading))),
        BAD_READINGS.map(() => ({
            plate: 26, monitor: {wide: 384, medium: 352, small: 328}, heaviest: [89, 24], connectionsLine: 56,
            fallbackNames: ['monitor.heightPxByForm.wide', 'monitor.heightPxByForm.medium',
                'monitor.heightPxByForm.small', 'heaviest.rowHeightPx', 'connections.lineHeightPx'],
        }))));

/**
 * The sheet's lengths that hold text, from given line boxes.
 *
 * @param {*} boxes - The line boxes.
 * @returns {object} The lengths, and those left at the default.
 */
function sheetAtScalingWith(boxes) {
    const {sheet, fallbackNames} = measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, boxes);
    return {...textLengthsOf(sheet), fallbackNames};
}

test('measuredLengths: a waiting name that reads badly leaves a waiting row at the default, and names it; the ' +
    'other rows are measured', () => {
    const {lengths, fallbackNames} = measuredLengths.measuredSessionsLengths(STAND_IN_DEFAULT_SESSIONS_LENGTHS,
        withReading(LineKind.WAITING_NAME, NaN));
    assertEqual({rows: lengths.rowHeightPxByState, fallbackNames},
        {rows: {blocked: 44, working: 24, done: 21, idle: 21, unknown: 21},
            fallbackNames: ['rowHeightPxByState.blocked']});
});

test('measuredLengths: line boxes that are not an object leave the defaults themselves and name every length', () => {
    const everySheetLength = ['plate.heightPx', 'monitor.heightPxByForm.wide', 'monitor.heightPxByForm.medium',
        'monitor.heightPxByForm.small', 'heaviest.fixedHeightPx', 'heaviest.rowHeightPx', 'connections.lineHeightPx'];
    assertEqual({
        notObjects: [null, 'boxes', 42].map(boxes => {
            const {sheet, fallbackNames} = measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET, boxes);
            return {isDefault: sheet === STAND_IN_DEFAULT_SHEET, fallbackNames};
        }),
    }, {
        notObjects: [null, 'boxes', 42].map(() => ({isDefault: true, fallbackNames: everySheetLength})),
    });
});

test('measuredLengths: a length whose sum passes 32 768 keeps its default and is named, though every reading in it ' +
    'is within the bound; a sum of exactly 32 768 is a length', () => {
    const connectionsLineFrom = rowPx => {
        const {sheet, fallbackNames} = measuredLengths.measuredSheet(STAND_IN_DEFAULT_SHEET,
            withReading(LineKind.ROW, rowPx));
        return {lineHeightPx: sheet.connections.lineHeightPx,
            isNamed: fallbackNames.includes('connections.lineHeightPx')};
    };
    // Connections in one line is 38 + the row line: 32 730 sums to the bound, 32 731 and 32 768 past it.
    assertEqual([32730, 32731, 32768].map(connectionsLineFrom), [
        {lineHeightPx: 32768, isNamed: false}, {lineHeightPx: 56, isNamed: true}, {lineHeightPx: 56, isNamed: true},
    ]);
});

test('measuredLengths: a default that is not an object gives the measured lengths alone', () =>
    assertEqual(measuredLengths.measuredSessionsLengths(null, ST_LINE_BOXES_BY_SCALING[1]).lengths, {
        aboveColumnsHeightPx: 80, groupHeadingHeightPx: 24, moreLineHeightPx: 22,
        rowHeightPxByState: {blocked: 45, working: 24, done: 21, idle: 21, unknown: 21},
    }));

/** Made-up caption widths, as St would measure them upper-cased in the annunciator's class. */
const ANNUNCIATOR_WIDTHS_PX = Object.freeze({
    'CPU wait': 50, 'Mem wait': 52, 'IO wait': 44, 'Swapping': 58, 'Offline': 50, 'Mount': 42, 'Stale': 38,
});
/** The template's two groups. */
const TEMPLATE_GROUPS = Object.freeze([
    {id: 'machine', caption: 'Machine', columns: 2, cards: ['system', 'apps', 'connections']},
    {id: 'agents', caption: 'Agents', columns: 2, cards: ['sessions']},
]);

/**
 * Caption widths for a row.
 *
 * @param {object} [overrides] - Widths to change.
 * @returns {object} The widths: the annunciators', the count slot's and the template's group captions'.
 */
function captionWidths(overrides = {}) {
    return {
        annunciatorWidthsPx: ANNUNCIATOR_WIDTHS_PX, countSlotWidthPx: 136,
        groupCaptionWidthsPx: {Machine: 60, Agents: 50}, ...overrides,
    };
}

test('measuredLengths: a legend is the plate\'s border and room at both ends, its group caption and the room after ' +
    'it, and each cell with the gap before it: 546 and 270 for the template\'s plates with these widths', () =>
    // Machine: 1 + 12 + 60 + 8 + 7 × (2 + 8 + 8) + 334 + 4 + 1. Agents: 1 + 12 + 50 + 8 + (2 + 136) + (2 + 16 + 38) +
    // 4 + 1.
    assertEqual(measuredLengths.plateLegendWidthsPx(TEMPLATE_GROUPS, captionWidths()), [546, 270]));

test('measuredLengths: a plate over Connections alone carries Offline, Mount and Stale', () =>
    assertEqual(measuredLengths.plateLegendWidthsPx(
        [{id: 'links', caption: 'Machine', columns: 1, cards: ['connections']}], captionWidths()), [270]));

test('measuredLengths: the "Waiting on you" cell takes its count slot\'s one width, whatever its caption\'s; a ' +
    'count slot is its caption\'s width, rounded up, and the cell\'s padding, and none for a width of 0', () =>
    assertEqual({
        legends: [100, 200].map(countSlotWidthPx =>
            measuredLengths.plateLegendWidthsPx([TEMPLATE_GROUPS[1]], captionWidths({countSlotWidthPx}))[0]),
        cellOfCountSlot: [120, 119.2, 0].map(measuredLengths.annunciatorCellWidthPx),
    }, {legends: [234, 334], cellOfCountSlot: [136, 136, null]}));

test('measuredLengths: a width with a fraction is rounded up; a width of 0 is a bad reading (St gives any text, an ' +
    'empty one included, at least 1 px), so that plate has no legend', () =>
    assertEqual(measuredLengths.plateLegendWidthsPx(TEMPLATE_GROUPS,
        captionWidths({groupCaptionWidthsPx: {Machine: 59.1, Agents: 0}})), [546, null]));

test('measuredLengths: a width that reads badly gives that plate no legend (null) and leaves the other plates\' ' +
    'legends; a group with no plate has none', () =>
    assertEqual(BAD_READINGS.map(reading => measuredLengths.plateLegendWidthsPx(
        [...TEMPLATE_GROUPS, {id: 'none', caption: 'None', cards: []}],
        captionWidths({annunciatorWidthsPx: {...ANNUNCIATOR_WIDTHS_PX, Mount: reading}}))),
    BAD_READINGS.map(() => [null, 270, null])));

test('measuredLengths: widths that are not an object, a missing group caption and a bad count slot each give no ' +
    'legend; groups that are not a list give none at all', () =>
    assertEqual({
        noWidths: measuredLengths.plateLegendWidthsPx(TEMPLATE_GROUPS, null),
        missingCaption: measuredLengths.plateLegendWidthsPx(TEMPLATE_GROUPS,
            captionWidths({groupCaptionWidthsPx: {Agents: 50}})),
        badCountSlot: measuredLengths.plateLegendWidthsPx(TEMPLATE_GROUPS, captionWidths({countSlotWidthPx: NaN})),
        notAList: measuredLengths.plateLegendWidthsPx('groups', captionWidths()),
    }, {noWidths: [null, null], missingCaption: [null, 270], badCountSlot: [546, null], notAList: []}));

test('measuredLengths: a legend past 32 768 is no legend', () =>
    assertEqual(measuredLengths.plateLegendWidthsPx(TEMPLATE_GROUPS,
        captionWidths({groupCaptionWidthsPx: {Machine: 32768, Agents: 50}})), [null, 270]));
