// lib/cockpitComposition.js: what the composition promises, checked one pixel at a time along walks of the work
// area, and at a grid of work areas, for the template and six other layouts. The checks are in
// cockpitCompositionProperties.js; these rows run them over a sample of layouts and lengths, and run them first on
// compositions doctored one way each, to see that the checks catch what they check.
import {test, assertEqual} from './harness.js';
import {cockpitComposition} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitComposition.js';
import {DEFAULT_COCKPIT_SIZES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionSizes.js';
import {
    COMPOSITION_TRADE, WALKED_LENGTH, compositionFaults, heldCountCompositionsFaults, heldCountFaults,
    legendCompositionsFaults, legendFaults, newWalkRecord, recordWalkStep, walkCompositions,
} from './cockpitCompositionProperties.js';
import {LAYOUTS, SIZES_WITH_ST_LINE_BOXES, TEMPLATE_GROUPS, tileOf} from './cockpitCompositionFixtures.js';

/** The layouts walked: the template and six others, each by what sets it apart. */
const WALKED_LAYOUTS = Object.freeze({
    template: TEMPLATE_GROUPS,
    noSystemCard: LAYOUTS.noSystemCard,
    noSessionsCard: LAYOUTS.noSessionsCard,
    fourGroupsOfOneCard: LAYOUTS.fourGroupsOfOneCard,
    oneGroupOfFour: LAYOUTS.oneGroupOfFour,
    systemWithAppsThenConnectionsWithSessions: LAYOUTS.systemWithAppsThenConnectionsWithSessions,
    connectionsThenTheRestWithSessions: LAYOUTS.connectionsThenTheRestWithSessions,
});
/** Sessions held to one column, and to every column there is room for. */
const WALKED_HELD_COLUMN_COUNTS = Object.freeze([1, 6]);
/** The widths walked: from one at which no walked layout is drawn to past where one row starts on a 1080 px high work area. */
const WALKED_WIDTHS_PX = Object.freeze({from: 600, to: 3200});
/** The heights a width walk is run at: a desk, and a work area on which one row starts only past 2.2 to 1. */
const HEIGHTS_WALKED_ALONG_PX = Object.freeze([1080, 1440]);
/** The heights walked: from one at which no walked layout is drawn to past where the stack gives Sessions its full height. */
const WALKED_HEIGHTS_PX = Object.freeze({from: 300, to: 1800});
/** The widths a height walk is run at: a portrait monitor, a laptop panel, and a desk. */
const WIDTHS_WALKED_ALONG_PX = Object.freeze([1080, 1536, 1920]);
/** The grid of work areas the held count and the legends are checked at. */
const GRID_WIDTHS_PX = Object.freeze([720, 1024, 1080, 1280, 1300, 1366, 1440, 1536, 1672, 1920, 2560, 3056, 3440, 3840]);
const GRID_HEIGHTS_PX = Object.freeze([658, 688, 736, 868, 928, 978, 1080, 1280, 1301, 1440, 1700, 1920, 2160]);
/** Legends wider than many groups, by a group's place in its layout. */
const WIDE_LEGEND_WIDTHS_PX = Object.freeze([900, 700, 500, 420]);
/** The most faults a row shows, so that a broken rule names its first few places and not thousands. */
const FAULTS_SHOWN = 5;
/** A walked work area's top left corner: under a top bar. */
const UNDER_A_TOP_BAR_PX = Object.freeze({x: 0, y: 32});
/** A top left corner a fraction of a pixel off the grid, as a scaled monitor's work area can have. */
const FRACTIONAL_ORIGIN_PX = Object.freeze({x: 0.5, y: 27.25});
/** The width a walk from a fractional origin is run at: 1536 whole pixels from its left edge rounded up. */
const FRACTIONAL_WIDTH_PX = 1536.5;
/** The height a walk at St's line boxes is run at. */
const ST_WALK_HEIGHT_PX = 1080;

/**
 * Walks every walked layout along one length at each of the other's lengths, with each held count.
 *
 * @param {string} growingLength - A WALKED_LENGTH.
 * @param {{from: number, to: number}} walkedRangePx - The growing length's range.
 * @param {number[]} fixedLengthsPx - The other length's values.
 * @param {object} [options] - The sizes and the work area's corner.
 * @param {object} [options.sizes] - The whole-pixel sizes; the default ones unless given.
 * @param {{x: number, y: number}} [options.originPx] - The work area's top left corner; under a top bar unless given.
 * @returns {{record: object, walksStartingDrawn: string[]}} The walks' record, and each walk whose first work area
 *     is drawn: a walk that starts there does not see where its layout is first drawn.
 */
function walkEveryLayout(growingLength, walkedRangePx, fixedLengthsPx,
    {sizes = DEFAULT_COCKPIT_SIZES, originPx = UNDER_A_TOP_BAR_PX} = {}) {
    const record = newWalkRecord();
    const walksStartingDrawn = [];
    for (const [layoutName, groups] of Object.entries(WALKED_LAYOUTS)) {
        for (const heldColumnCount of WALKED_HELD_COLUMN_COUNTS) {
            for (const fixedLengthPx of fixedLengthsPx) {
                const firstWorkArea = {...originPx, width: fixedLengthPx, height: fixedLengthPx};
                firstWorkArea[growingLength] = walkedRangePx.from;
                const first = cockpitComposition({workArea: firstWorkArea, groups, sizes, sessionsColumnCount: heldColumnCount});
                const firstWorkAreaText = `${firstWorkArea.width}x${firstWorkArea.height}`;
                if (first.isDrawn)
                    walksStartingDrawn.push(`${layoutName} on ${firstWorkAreaText}, ${heldColumnCount} held`);
                walkCompositions({
                    groups, layoutName, sizes, growingLength, fixedLengthPx, originPx,
                    fromPx: walkedRangePx.from, toPx: walkedRangePx.to, heldColumnCount,
                }, record);
            }
        }
    }
    return {record, walksStartingDrawn};
}

/**
 * @param {{from: number, to: number}} walkedRangePx - The growing length's range.
 * @param {number[]} fixedLengthsPx - The other length's values.
 * @returns {number} How many compositions walkEveryLayout checks: one at every pixel of every walk.
 */
function walkedCompositionCount(walkedRangePx, fixedLengthsPx) {
    const walkCount = Object.keys(WALKED_LAYOUTS).length * WALKED_HELD_COLUMN_COUNTS.length * fixedLengthsPx.length;
    return walkCount * (walkedRangePx.to - walkedRangePx.from + 1);
}

/**
 * @param {object} walks - walkEveryLayout's result.
 * @returns {object} What a walk row reads of it.
 */
function walksSummaryOf({record, walksStartingDrawn}) {
    return {
        walksStartingDrawn: walksStartingDrawn.slice(0, FAULTS_SHOWN),
        compositionCount: record.compositionCount,
        faults: record.faults.slice(0, FAULTS_SHOWN),
        arrangementChanges: [...record.arrangementChanges.keys()].sort(),
        tradesMet: [...record.tradesMet.keys()].sort(),
    };
}

/**
 * @param {function(Array<object>, {x: number, y: number, width: number, height: number}): string[]} faultsAt - The
 *     check at one work area, for a layout.
 * @returns {string[]} Its faults across the grid for every walked layout, each with where it was found.
 */
function faultsAcrossTheGrid(faultsAt) {
    const faults = [];
    for (const [layoutName, groups] of Object.entries(WALKED_LAYOUTS)) {
        for (const width of GRID_WIDTHS_PX) {
            for (const height of GRID_HEIGHTS_PX) {
                const where = `${layoutName} on ${width}x${height}`;
                faults.push(...faultsAt(groups, {x: 0, y: 0, width, height}).map(fault => `${fault}, at ${where}`));
            }
        }
    }
    return faults;
}

/** A desk's work area, and a laptop panel's under a top bar. */
const DESK_WORK_AREA = Object.freeze({x: 0, y: 0, width: 1920, height: 1080});
const LAPTOP_WORK_AREA = Object.freeze({x: 0, y: 32, width: 1366, height: 736});
/** The least width at which Heaviest and Connections share a row, at the default sizes. */
const PAIR_LEAST_WIDTH_PX = DEFAULT_COCKPIT_SIZES.heaviest.leastWidthPx +
    DEFAULT_COCKPIT_SIZES.gaps.betweenTilesInARowPx + DEFAULT_COCKPIT_SIZES.connections.listLeastWidthPx;
/** Legends on 1500 x 1080: one that widens the machine's column, and one under Sessions' column. */
const WIDENING_LEGEND_WIDTHS_PX = Object.freeze([900, 269]);

/**
 * A doctored composition of the template, checked by compositionFaults.
 *
 * @param {string} name - What the doctoring does.
 * @param {object} composed - Where it is composed.
 * @param {object} [composed.workArea] - The work area; a desk's unless given.
 * @param {number} [composed.heldColumnCount] - Sessions' held columns; 2 unless given.
 * @param {number[]|null} [composed.legendWidthsPx] - The legends; none unless given.
 * @param {function(object): void} doctor - Changes the composition in place.
 * @returns {{name: string, faultsWith: function(boolean): string[]}} The case: the faults found in the composition
 *     doctored, or as composed.
 */
function doctoredComposition(name, {workArea = DESK_WORK_AREA, heldColumnCount = 2, legendWidthsPx = null}, doctor) {
    const faultsWith = isDoctored => {
        const composition = cockpitComposition({
            workArea, groups: TEMPLATE_GROUPS, sessionsColumnCount: heldColumnCount, plateLegendWidthsPx: legendWidthsPx,
        });
        if (isDoctored)
            doctor(composition);
        const checked = {workArea, groups: TEMPLATE_GROUPS, sizes: DEFAULT_COCKPIT_SIZES, heldColumnCount, legendWidthsPx};
        return compositionFaults(composition, checked);
    };
    return {name, faultsWith};
}

/**
 * @param {object} composition - A composition, changed in place.
 * @param {number} rightPx - How far to move every plate and tile and the bounds right.
 * @param {number} downPx - And down.
 * @returns {void}
 */
function moveEverything(composition, rightPx, downPx) {
    for (const rectangle of [composition.bounds, ...composition.plates, ...composition.tiles]) {
        rectangle.x += rightPx;
        rectangle.y += downPx;
    }
}

/** Compositions doctored one way each, by what was done to them. */
const DOCTORED_COMPOSITIONS = Object.freeze([
    doctoredComposition('the machine\'s tiles 700 px wide beside Sessions, under the monitor\'s least there', {},
        composition => ['system', 'apps', 'connections'].forEach(cardId => { tileOf(composition, cardId).width = 700; })),
    doctoredComposition('Sessions in three columns in 1080 px, which three do not fit, the most said to be three', {},
        composition => {
            tileOf(composition, 'sessions').columnCount = 3;
            Object.assign(composition.sessions, {columnCount: 3, mostColumnCount: 3});
        }),
    doctoredComposition('everything a pixel right of centre on 1921 px', {workArea: {...DESK_WORK_AREA, width: 1921}},
        composition => moveEverything(composition, 1, 0)),
    doctoredComposition('everything a pixel right of and below centre on 2561 x 1441',
        {workArea: {x: 0, y: 0, width: 2561, height: 1441}}, composition => moveEverything(composition, 1, 1)),
    doctoredComposition('the bounds 300 px narrower and centred, the tiles where they were', {}, composition => {
        composition.bounds.width -= 300;
        composition.bounds.x += 150;
    }),
    doctoredComposition('a plate 60 px down, over its group\'s first tile', {},
        composition => { composition.plates[0].y += 60; }),
    doctoredComposition('a plate at the other group\'s left edge', {},
        composition => { composition.plates[0].x = composition.plates[1].x; }),
    doctoredComposition('a plate left out', {}, composition => { composition.plates.pop(); }),
    doctoredComposition('a plate 5 px high', {}, composition => { composition.plates[0].height = 5; }),
    doctoredComposition('the monitor said to be small at the wide form\'s height', {},
        composition => { tileOf(composition, 'system').monitorForm = 'small'; }),
    doctoredComposition('a ranking said to show six rows at ten rows\' height', {},
        composition => { tileOf(composition, 'apps').rankingRowCount = 6; }),
    doctoredComposition('a ranking of three rows, under the fewest a composition shows', {},
        composition => Object.assign(tileOf(composition, 'apps'), {rankingRowCount: 3, height: 160})),
    doctoredComposition('Connections a list in its band, taking its height from Heaviest', {}, composition => {
        const connections = tileOf(composition, 'connections');
        Object.assign(connections, {connectionsForm: 'list', height: 232, y: connections.y - 176});
        tileOf(composition, 'apps').height -= 176;
    }),
    doctoredComposition('the tiles listed in the other order', {}, composition => { composition.tiles.reverse(); }),
    doctoredComposition('a tile said to be of the other group', {},
        composition => { tileOf(composition, 'apps').groupIndex = 1; }),
    doctoredComposition('Sessions drawn twice, the second over the first', {},
        composition => { composition.tiles.push({...tileOf(composition, 'sessions')}); }),
    doctoredComposition('Connections left out', {}, composition => { composition.tiles.splice(2, 1); }),
    doctoredComposition('Sessions\' tile height said 100 px over its tile\'s', {},
        composition => { composition.sessions.tileHeightPx += 100; }),
    doctoredComposition('Heaviest 300 px wide beside Connections, under its least', {workArea: LAPTOP_WORK_AREA,
        heldColumnCount: 1}, composition => {
        const heaviest = tileOf(composition, 'apps');
        heaviest.width = 300;
        Object.assign(tileOf(composition, 'connections'), {x: heaviest.x + 324, width: 436});
    }),
    doctoredComposition('the monitor 16 px taller than its form, into the gap above the pair',
        {workArea: LAPTOP_WORK_AREA, heldColumnCount: 1}, composition => { tileOf(composition, 'system').height += 16; }),
    doctoredComposition('one column of Sessions with two held and room for two', {workArea: {x: 0, y: 0, width: 2560,
        height: 1440}}, composition => {
        composition.sessions.columnCount = 1;
        tileOf(composition, 'sessions').columnCount = 1;
    }),
    doctoredComposition('a plate 50 px wider than its legend', {workArea: {x: 0, y: 0, width: 1500, height: 1080},
        legendWidthsPx: WIDENING_LEGEND_WIDTHS_PX}, composition => { composition.plates[1].width += 50; }),
    doctoredComposition('not drawn, with a reason no caller knows', {}, composition => {
        for (const key of Object.keys(composition))
            delete composition[key];
        Object.assign(composition, {isDrawn: false, reason: 'because'});
    }),
    {
        name: 'Sessions gaining its second column at 1672 px wide while the monitor goes small, the rankings to six ' +
            'rows and Sessions 200 px shorter',
        faultsWith: isDoctored => {
            const composedAt = width => cockpitComposition({
                workArea: {x: 0, y: 32, width, height: 1080}, groups: TEMPLATE_GROUPS, sessionsColumnCount: 6,
            });
            const [previous, composition] = [composedAt(1671), composedAt(1672)];
            if (isDoctored) {
                tileOf(composition, 'system').monitorForm = 'small';
                tileOf(composition, 'apps').rankingRowCount = 6;
                tileOf(composition, 'sessions').height -= 200;
                composition.sessions.tileHeightPx -= 200;
            }
            const record = newWalkRecord();
            const walk = {growingLength: WALKED_LENGTH.WIDTH, pairLeastWidthPx: PAIR_LEAST_WIDTH_PX};
            recordWalkStep(previous, composition, walk, record, '1672 px wide');
            return record.faults;
        },
    },
    {
        name: 'the machine\'s column 100 px lower with six held than with one, its forms the same',
        faultsWith: isDoctored => {
            const compositions = [1, 2, 3, 4, 5, 6].map(heldColumnCount => cockpitComposition({
                workArea: {x: 0, y: 0, width: 2560, height: 1440}, groups: TEMPLATE_GROUPS,
                sessionsColumnCount: heldColumnCount,
            }));
            if (isDoctored)
                ['apps', 'connections'].forEach(cardId => { tileOf(compositions[5], cardId).y += 100; });
            return heldCountCompositionsFaults(compositions);
        },
    },
    {
        name: 'Sessions 40 px lower and shorter with legends than without',
        faultsWith: isDoctored => {
            const composedWith = plateLegendWidthsPx => cockpitComposition({
                workArea: {x: 0, y: 0, width: 1500, height: 1080}, groups: TEMPLATE_GROUPS, plateLegendWidthsPx,
            });
            const [withoutLegends, withLegends] = [composedWith(null), composedWith(WIDENING_LEGEND_WIDTHS_PX)];
            if (isDoctored) {
                const sessions = tileOf(withLegends, 'sessions');
                Object.assign(sessions, {y: sessions.y + 40, height: sessions.height - 40});
                withLegends.sessions.tileHeightPx -= 40;
            }
            return legendCompositionsFaults(withoutLegends, withLegends);
        },
    },
]);

test(`cockpitComposition walks: the checks find a fault in each of ${DOCTORED_COMPOSITIONS.length} compositions ` +
    'doctored one way each (tiles under their least size, off centre, out of order, of another group, missing or ' +
    'twice, in a form their height does not hold; bounds that are not the tiles\'; plates off their groups; Sessions ' +
    'not as held; a step, a held count or legends that change heights) and none in the same compositions as composed',
() => {
    const faultsUndoctored = DOCTORED_COMPOSITIONS.flatMap(({name, faultsWith}) =>
        faultsWith(false).map(fault => `${name}: ${fault}`));
    const letThrough = DOCTORED_COMPOSITIONS.filter(({faultsWith}) => faultsWith(true).length === 0)
        .map(({name}) => name);
    assertEqual({faultsUndoctored: faultsUndoctored.slice(0, FAULTS_SHOWN), letThrough}, {faultsUndoctored: [], letThrough: []});
});

test('cockpitComposition walks: along the width, one pixel at a time from 600 to 3200 px at two heights, from ' +
    'where nothing is drawn: every composition keeps its own checks, a drawn cockpit is never lost, the arrangement ' +
    'goes only from stacked to side by side or one row and from side by side to one row, and inside one arrangement ' +
    'nothing falls but where Sessions gains a column or a column reaches a pair\'s width', () => {
    const walks = walkEveryLayout(WALKED_LENGTH.WIDTH, WALKED_WIDTHS_PX, HEIGHTS_WALKED_ALONG_PX);
    assertEqual(walksSummaryOf(walks), {
        walksStartingDrawn: [],
        compositionCount: walkedCompositionCount(WALKED_WIDTHS_PX, HEIGHTS_WALKED_ALONG_PX),
        faults: [],
        arrangementChanges: [
            'side-by-side to one-row as the width grows', 'stacked to one-row as the width grows',
            'stacked to side-by-side as the width grows',
        ],
        tradesMet: [COMPOSITION_TRADE.SESSIONS_GAINS_A_COLUMN, COMPOSITION_TRADE.A_COLUMN_REACHES_THE_PAIR_WIDTH].sort(),
    });
});

test('cockpitComposition walks: along the height, one pixel at a time from 300 to 1800 px at three widths, from ' +
    'where nothing is drawn: every composition keeps its own checks, a drawn cockpit is never lost, the arrangement ' +
    'goes only from one row or side by side to stacked, and inside one arrangement nothing falls but where ' +
    'Connections becomes one line as the rankings gain a row, or Sessions gains a column', () => {
    const walks = walkEveryLayout(WALKED_LENGTH.HEIGHT, WALKED_HEIGHTS_PX, WIDTHS_WALKED_ALONG_PX);
    assertEqual(walksSummaryOf(walks), {
        walksStartingDrawn: [],
        compositionCount: walkedCompositionCount(WALKED_HEIGHTS_PX, WIDTHS_WALKED_ALONG_PX),
        faults: [],
        arrangementChanges: ['one-row to stacked as the height grows', 'side-by-side to stacked as the height grows'],
        tradesMet: [COMPOSITION_TRADE.CONNECTIONS_GOES_TO_ONE_LINE, COMPOSITION_TRADE.SESSIONS_GAINS_A_COLUMN].sort(),
    });
});

test('cockpitComposition walks: along the width at St\'s line boxes, one pixel at a time from 600 to 3200 px on a ' +
    '1080 px high work area, from where nothing is drawn: every composition keeps its own checks, a drawn cockpit is ' +
    'never lost, and the arrangements and trades are those at the default sizes', () => {
    const walks = walkEveryLayout(WALKED_LENGTH.WIDTH, WALKED_WIDTHS_PX, [ST_WALK_HEIGHT_PX],
        {sizes: SIZES_WITH_ST_LINE_BOXES});
    assertEqual(walksSummaryOf(walks), {
        walksStartingDrawn: [],
        compositionCount: walkedCompositionCount(WALKED_WIDTHS_PX, [ST_WALK_HEIGHT_PX]),
        faults: [],
        arrangementChanges: [
            'side-by-side to one-row as the width grows', 'stacked to one-row as the width grows',
            'stacked to side-by-side as the width grows',
        ],
        tradesMet: [COMPOSITION_TRADE.SESSIONS_GAINS_A_COLUMN, COMPOSITION_TRADE.A_COLUMN_REACHES_THE_PAIR_WIDTH].sort(),
    });
});

test('cockpitComposition walks: along the height from a top left corner at 0.5, 27.25, one pixel at a time from ' +
    '300 to 1800 px on a work area 1536.5 px wide, from where nothing is drawn: every composition keeps its own ' +
    'checks in whole pixels, a drawn cockpit is never lost, the arrangement goes only from side by side to stacked, ' +
    'and inside one arrangement nothing falls but where Connections becomes one line as the rankings gain a row, or ' +
    'Sessions gains a column', () => {
    const walks = walkEveryLayout(WALKED_LENGTH.HEIGHT, WALKED_HEIGHTS_PX, [FRACTIONAL_WIDTH_PX],
        {originPx: FRACTIONAL_ORIGIN_PX});
    assertEqual(walksSummaryOf(walks), {
        walksStartingDrawn: [],
        compositionCount: walkedCompositionCount(WALKED_HEIGHTS_PX, [FRACTIONAL_WIDTH_PX]),
        faults: [],
        arrangementChanges: ['side-by-side to stacked as the height grows'],
        tradesMet: [COMPOSITION_TRADE.CONNECTIONS_GOES_TO_ONE_LINE, COMPOSITION_TRADE.SESSIONS_GAINS_A_COLUMN].sort(),
    });
});

test('cockpitComposition walks: at a grid of work areas, Sessions held to any count from one to six takes the ' +
    'count held up to the most, keeps every composition\'s own checks, and gives the same arrangement, forms, top ' +
    'edges, heights and most columns, whether drawn or not', () => {
    const faults = faultsAcrossTheGrid((groups, workArea) => heldCountFaults(groups, DEFAULT_COCKPIT_SIZES, workArea));
    assertEqual(faults.slice(0, FAULTS_SHOWN), []);
});

test('cockpitComposition walks: at a grid of work areas, legends of 420 to 900 px change nothing but widths, keep ' +
    'every composition\'s own checks, and make each plate as wide as its legend, or as its group where the legend ' +
    'is wider', () => {
    const faults = faultsAcrossTheGrid((groups, workArea) =>
        legendFaults(groups, DEFAULT_COCKPIT_SIZES, workArea, WIDE_LEGEND_WIDTHS_PX));
    assertEqual(faults.slice(0, FAULTS_SHOWN), []);
});
