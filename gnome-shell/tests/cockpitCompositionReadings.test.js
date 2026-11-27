// lib/cockpitComposition.js: compositions that tell one reading of the composition's rules from another, each where
// two plausible readings would place a tile differently.
import {test, assertEqual} from './harness.js';
import {cockpitComposition} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitComposition.js';
import {
    LARGER_TEXT_SIZES, LAYOUTS, TEMPLATE_GROUPS, columnWidthsOf, composeAt, copyOfDefaultSizes, layoutOf,
    placementsOf, sizeAndFormOf, tileOf,
} from './cockpitCompositionFixtures.js';

const WIDE_LEGEND_PX = 900;

/**
 * @param {object} composition - A composition.
 * @returns {string[]} Each tile as `<card id> <width>x<height> <form>`, after the arrangement.
 */
function tilesOf(composition) {
    if (!composition.isDrawn)
        return [`not drawn (${composition.reason})`];
    return [composition.arrangement, ...composition.tiles.map(tile => `${tile.cardId} ${sizeAndFormOf(tile)}`)];
}

/**
 * @param {object} composition - A drawn composition.
 * @returns {Array<Array<number|boolean>>} Each plate's width and whether its legend is short.
 */
function plateWidthsOf(composition) {
    return composition.plates.map(plate => [plate.width, plate.isLegendShort]);
}

test('cockpitComposition readings: one group of the monitor, Heaviest, Sessions and Connections on 1366 x 736 is ' +
    'side by side inside the group, Heaviest and Connections a pair on either side of Sessions, under one plate 1318 ' +
    'wide', () => {
    const groups = layoutOf(['system', 'apps', 'sessions', 'connections']);
    const composition = composeAt(1366, 736, {groups});
    const sessions = tileOf(composition, 'sessions');
    assertEqual({
        tiles: tilesOf(composition), sessionsAt: [sessions.x, sessions.y],
        plates: composition.plates.map(plate => plate.width),
    }, {
        tiles: ['side-by-side', 'system 760x384 wide', 'apps 476x232 6', 'connections 260x232 list', 'sessions 534x640 1'],
        sessionsAt: [808, 65], plates: [1318],
    });
});

test('cockpitComposition readings: one group of all four on 1080 x 1920, two columns held, is stacked 1032 x 1650 ' +
    'with Sessions 1032 x 800: the gap beside Sessions is no part of what holds its height', () => {
    const composition = composeAt(1080, 1920, {groups: LAYOUTS.oneGroupOfFour, heldColumnCount: 2});
    assertEqual([composition.arrangement, `${composition.bounds.width}x${composition.bounds.height}`,
        sizeAndFormOf(tileOf(composition, 'sessions'))], ['stacked', '1032x1650', '1032x800 2']);
});

test('cockpitComposition readings: one group of the monitor and Sessions on 647 x 1080 is stacked, the monitor ' +
    'medium 599 x 352 and Sessions 599 x 608, held to a full machine group\'s height at that step', () => {
    assertEqual(tilesOf(composeAt(647, 1080, {groups: layoutOf(['system', 'sessions'])})), [
        'stacked', 'system 599x352 medium', 'sessions 599x608 1',
    ]);
});

test('cockpitComposition readings: one group of the monitor, Heaviest and Sessions on 720 x 1339 is stacked, the ' +
    'monitor wide over six rows and Sessions 672 x 609', () => {
    assertEqual(tilesOf(composeAt(720, 1339, {groups: layoutOf(['system', 'apps', 'sessions'])})), [
        'stacked', 'system 672x384 wide', 'apps 672x232 6', 'sessions 672x609 1',
    ]);
});

test('cockpitComposition readings: the template on 1920 x 1080 with no legend known has plates as wide as their ' +
    'groups, 760 and 1080, and neither short', () => {
    assertEqual(plateWidthsOf(composeAt(1920, 1080, {heldColumnCount: 2})), [[760, false], [1080, false]]);
});

test('cockpitComposition readings: the template on 1920 x 1080 with legends of 571 and 269 px has plates of 571 and ' +
    '269, as wide as their legends', () => {
    assertEqual(plateWidthsOf(composeAt(1920, 1080, {heldColumnCount: 2, plateLegendWidthsPx: [571, 269]})),
        [[571, false], [269, false]]);
});

test('cockpitComposition readings: the template on 720 x 1280 with legends of 700 and 269 px has its first plate ' +
    '672 wide and short, and its second 269', () => {
    assertEqual(plateWidthsOf(composeAt(720, 1280, {plateLegendWidthsPx: [700, 269]})), [[672, true], [269, false]]);
});

test('cockpitComposition readings: the template on 1500 x 1080 with legends of 900 and 269 px widens the monitor\'s ' +
    'column to its legend, 900, 32 and 520 wide, where with none it is 856, 32 and 564', () => {
    const columnWidthsWith = plateLegendWidthsPx => columnWidthsOf(composeAt(1500, 1080, {plateLegendWidthsPx}));
    assertEqual([columnWidthsWith(undefined), columnWidthsWith([WIDE_LEGEND_PX, 269])], [[856, 32, 564], [900, 32, 520]]);
});

test('cockpitComposition readings: the template on 1440 x 2560 and on 1300 x 1301 is stacked with all four tiles ' +
    'whether or not its plates have legends of 900 px: a legend does not decide the arrangement', () => {
    const compositionsAt = (width, height) => [undefined, [WIDE_LEGEND_PX, WIDE_LEGEND_PX]].map(plateLegendWidthsPx => {
        const composition = composeAt(width, height, {plateLegendWidthsPx});
        return `${composition.arrangement}, ${composition.tiles.length} tiles, plates ${composition.plates.map(plate => plate.width)}`;
    });
    assertEqual([compositionsAt(1440, 2560), compositionsAt(1300, 1301)], [
        ['stacked, 4 tiles, plates 1032,1032', 'stacked, 4 tiles, plates 900,900'],
        ['stacked, 4 tiles, plates 1032,1032', 'stacked, 4 tiles, plates 900,900'],
    ]);
});

test('cockpitComposition readings: the template on 1300 x 1300 with two legends of 900 px is side by side, as with ' +
    'none, its plates 760 and 460 wide and both short', () => {
    const composition = composeAt(1300, 1300, {plateLegendWidthsPx: [WIDE_LEGEND_PX, WIDE_LEGEND_PX]});
    assertEqual([composition.arrangement, plateWidthsOf(composition)], ['side-by-side', [[760, true], [460, true]]]);
});

/** @returns {object} The default sizes with every plate 300 px high. */
function sizesWithTallPlates() {
    const sizes = copyOfDefaultSizes();
    sizes.plate.heightPx = 300;
    return sizes;
}

test('cockpitComposition readings: with plates 300 px high the template on 1300 x 1400 and on 1300 x 1461 is side ' +
    'by side: the stack does not fit there, so a work area taller than it is wide keeps side by side', () => {
    const sizes = sizesWithTallPlates();
    assertEqual([composeAt(1300, 1400, {sizes}).arrangement, composeAt(1300, 1461, {sizes}).arrangement],
        ['side-by-side', 'side-by-side']);
});

test('cockpitComposition readings: with plates 300 px high the template on 1300 x 1462 is stacked, the monitor small ' +
    'over a pair and Sessions 1032 x 190', () => {
    const composition = composeAt(1300, 1462, {sizes: sizesWithTallPlates()});
    assertEqual(tilesOf(composition), [
        'stacked', 'system 1032x328 small', 'apps 672x232 6', 'connections 336x232 list', 'sessions 1032x190 1',
    ]);
});

test('cockpitComposition readings: the template on a work area 1300 wide and 1300.9 high is side by side: in whole ' +
    'pixels it is 1300 high, which is not taller than it is wide', () => {
    const composition = cockpitComposition({workArea: {x: 0, y: 0, width: 1300, height: 1300.9}, groups: TEMPLATE_GROUPS});
    assertEqual(composition.arrangement, 'side-by-side');
});

test('cockpitComposition readings: the template on a work area at x 0.5, 1300 x 1300, is stacked: in whole pixels ' +
    'it is 1299 wide', () => {
    const composition = cockpitComposition({workArea: {x: 0.5, y: 0, width: 1300, height: 1300}, groups: TEMPLATE_GROUPS});
    assertEqual([composition.arrangement, composition.bounds.x], ['stacked', 1 + Math.floor((1299 - 1032) / 2)]);
});

test('cockpitComposition readings: the template on a work area at y 0.5, 1300 x 1300.6, is side by side: in whole ' +
    'pixels it runs from y 1 to 1301, 1300 high, which is not taller than it is wide', () => {
    const composition = cockpitComposition({workArea: {x: 0, y: 0.5, width: 1300, height: 1300.6}, groups: TEMPLATE_GROUPS});
    const centredTopPx = 1 + Math.floor((1300 - composition.bounds.height) / 2);
    assertEqual([composition.arrangement, composition.bounds.y], ['side-by-side', centredTopPx]);
});

test('cockpitComposition readings: the template on 1920 x 1081 leaves the odd pixel below it: its plates stand at ' +
    'y 123, as on 1920 x 1080', () => {
    assertEqual(composeAt(1920, 1081).plates.map(plate => plate.y), [123, 123]);
});

test('cockpitComposition readings: the template on 1672 x 1700 with one column held is side by side, 984, 48, 564: ' +
    'the composition holds two columns there, whatever is held', () => {
    const composition = composeAt(1672, 1700);
    assertEqual([composition.arrangement, columnWidthsOf(composition), composition.sessions.mostColumnCount],
        ['side-by-side', [984, 48, 564], 2]);
});

test('cockpitComposition readings: the template on 1671 x 1700 with one column held is stacked, Sessions 1032 x 776 ' +
    'in one column', () => {
    const composition = composeAt(1671, 1700);
    assertEqual([composition.arrangement, sizeAndFormOf(tileOf(composition, 'sessions'))], ['stacked', '1032x776 1']);
});

test('cockpitComposition readings: Connections beside a group of the monitor, Heaviest and Sessions, two columns ' +
    'held, is stacked on 1171 x 1600 and side by side on 1172 x 1600, a list 260 x 304 beside a column 832 wide ' +
    'that holds two columns of Sessions', () => {
    const groups = LAYOUTS.connectionsThenTheRestWithSessions;
    const narrower = composeAt(1171, 1600, {groups, heldColumnCount: 2});
    const wider = composeAt(1172, 1600, {groups, heldColumnCount: 2});
    assertEqual({
        narrower: [narrower.arrangement, narrower.bounds.width],
        wider: [wider.arrangement, sizeAndFormOf(tileOf(wider, 'connections')), tileOf(wider, 'sessions').width,
            wider.sessions.columnCount],
    }, {narrower: ['stacked', 1032], wider: ['side-by-side', '260x304 list', 832, 2]});
});

test('cockpitComposition readings: the template with its Sessions group first on 1920 x 1080 lists Sessions\' tile ' +
    'first, at 24, 157, and the monitor at 1136, 157', () => {
    const {tiles} = composeAt(1920, 1080, {groups: LAYOUTS.sessionsGroupFirst, heldColumnCount: 2});
    assertEqual(tiles.slice(0, 2).map(tile => `${tile.cardId} ${tile.x},${tile.y}`), ['sessions 24,157', 'system 1136,157']);
});

test('cockpitComposition readings: the system card and Heaviest in two groups stand in one row on 1464 x 665, 666 ' +
    'and 699, the last two because nothing else fits there, and are stacked on 1464 x 700', () => {
    const groups = layoutOf(['system'], ['apps']);
    assertEqual([665, 666, 699, 700].map(height => composeAt(1464, height, {groups}).arrangement),
        ['one-row', 'one-row', 'one-row', 'stacked']);
});

test('cockpitComposition readings: with no system card, two columns held, 1511 x 350 and 1512 x 350 are both drawn ' +
    'with one column of Sessions: a second would take the others\' column under a pair\'s width', () => {
    const at = width => {
        const composition = composeAt(width, 350, {groups: LAYOUTS.noSystemCard, heldColumnCount: 2});
        return [composition.isDrawn, composition.sessions?.columnCount];
    };
    assertEqual([at(1511), at(1512)], [[true, 1], [true, 1]]);
});

test('cockpitComposition readings: with no system card, 1348 x 348 is not drawn, with no legend and with one of ' +
    '900 px', () => {
    const groups = LAYOUTS.noSystemCard;
    assertEqual([composeAt(1348, 348, {groups}).reason, composeAt(1348, 348, {groups, plateLegendWidthsPx: [WIDE_LEGEND_PX]}).reason],
        ['too-small', 'too-small']);
});

test('cockpitComposition readings: with no system card, two columns held, 1530 x 409 has one column of Sessions ' +
    'beside six rows and a pair, and 1530 x 410 two columns beside seven rows and Connections in one line', () => {
    const groups = LAYOUTS.noSystemCard;
    assertEqual([tilesOf(composeAt(1530, 409, {groups, heldColumnCount: 2})), tilesOf(composeAt(1530, 410, {groups, heldColumnCount: 2}))], [
        ['side-by-side', 'apps 602x232 6', 'connections 260x232 list', 'sessions 564x327 1'],
        ['side-by-side', 'apps 600x256 7', 'connections 600x56 line', 'sessions 850x328 2'],
    ]);
});

test('cockpitComposition readings: with larger text, where the monitor\'s least width is under a pair\'s, the ' +
    'template on 1920 x 815 and 1920 x 838 is the same for one and two columns held: one column, the monitor wide ' +
    'over a pair', () => {
    const at = (height, heldColumnCount) => {
        const composition = composeAt(1920, height, {sizes: LARGER_TEXT_SIZES, heldColumnCount});
        return `${tileOf(composition, 'system').monitorForm}, ${tileOf(composition, 'connections').connectionsForm}, ` +
            `${composition.sessions.columnCount} of ${composition.sessions.mostColumnCount} column(s)`;
    };
    assertEqual([at(815, 1), at(815, 2), at(838, 1), at(838, 2)], [
        'wide, list, 1 of 1 column(s)', 'wide, list, 1 of 1 column(s)', 'wide, list, 1 of 1 column(s)',
        'wide, list, 1 of 1 column(s)',
    ]);
});

test('cockpitComposition readings: the system card beside a group of Heaviest, Connections and Sessions on 1920 x ' +
    '560, two columns held, is drawn: the monitor 808 wide beside a column 1032 wide, a pair over Sessions 1032 x ' +
    '222', () => {
    const composition = composeAt(1920, 560, {groups: layoutOf(['system'], ['apps', 'connections', 'sessions']), heldColumnCount: 2});
    assertEqual(tilesOf(composition), [
        'side-by-side', 'system 808x384 wide', 'apps 672x232 6', 'connections 336x232 list', 'sessions 1032x222 2',
    ]);
});

test('cockpitComposition readings: Connections beside a group of the monitor, Heaviest and Sessions on 3840 x 2160, ' +
    'six columns held, is a list 336 x 304 beside a column 1032 wide: the monitor wide, ten rows, Sessions 1032 x 800 ' +
    'in two columns', () => {
    assertEqual(tilesOf(composeAt(3840, 2160, {groups: LAYOUTS.connectionsThenTheRestWithSessions, heldColumnCount: 6})), [
        'side-by-side', 'connections 336x304 list', 'system 1032x384 wide', 'apps 1032x328 10', 'sessions 1032x800 2',
    ]);
});
