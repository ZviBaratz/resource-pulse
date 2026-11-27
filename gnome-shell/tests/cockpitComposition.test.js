// lib/cockpitComposition.js: where each caption plate and tile of the cockpit goes, and in which form, on the
// screens the cockpit is drawn for; and lib/cockpitLeastWorkAreas.js, the least work area each arrangement needs.
import {test, assertEqual} from './harness.js';
import {COCKPIT_ARRANGEMENT, cockpitComposition} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitComposition.js';
import {DEFAULT_COCKPIT_SIZES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionSizes.js';
import {LineKind, measuredSheet} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';
import {
    LEAST_WORK_AREA_SEARCH_BOUND_PX, leastCockpitWorkAreas,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitLeastWorkAreas.js';
import {
    LAYOUTS, SIZES_WITH_ST_LINE_BOXES, TEMPLATE_GROUPS, composeAt, copyOfDefaultSizes, countReadsOf,
    gapUnderTheMonitorPx, layoutOf, placementsOf, sizeAndFormOf, tileOf,
} from './cockpitCompositionFixtures.js';

const TOP_BAR_HEIGHT_PX = 32;

// ---------------------------------------------------------------------------------------------------------------
// The screens the cockpit is drawn for, every rectangle to the pixel
// ---------------------------------------------------------------------------------------------------------------

test('cockpitComposition: the template on a 1920 x 1080 desk is drawn side by side, the monitor wide over ten rows ' +
    'and Connections in one line, beside Sessions 1080 x 800 in two columns', () => {
    assertEqual(placementsOf(composeAt(1920, 1080, {heldColumnCount: 2})), {
        arrangement: 'side-by-side',
        plates: ['machine 24,123 760x26', 'agents 816,123 1080x26'],
        tiles: ['system 24,157 760x384 wide', 'apps 24,557 760x328 10', 'connections 24,901 760x56 line',
            'sessions 816,157 1080x800 2'],
    });
});

test('cockpitComposition: the template on a 1536 x 960 laptop panel under its top bar is drawn side by side, the ' +
    'machine 892 wide, beside Sessions 564 x 800 in one column', () => {
    assertEqual(placementsOf(composeAt(1536, 928, {y: TOP_BAR_HEIGHT_PX})), {
        arrangement: 'side-by-side',
        plates: ['machine 24,79 892x26', 'agents 948,79 564x26'],
        tiles: ['system 24,113 892x384 wide', 'apps 24,513 892x328 10', 'connections 24,857 892x56 line',
            'sessions 948,113 564x800 1'],
    });
});

test('cockpitComposition: the template on a 1366 x 768 screen under its top bar has Heaviest and Connections side ' +
    'by side under the wide monitor, at six rows and as a list, 24 px apart', () => {
    assertEqual(placementsOf(composeAt(1366, 736, {y: TOP_BAR_HEIGHT_PX})), {
        arrangement: 'side-by-side',
        plates: ['machine 24,63 760x26', 'agents 816,63 526x26'],
        tiles: ['system 24,97 760x384 wide', 'apps 24,505 476x232 6', 'connections 524,505 260x232 list',
            'sessions 816,97 526x640 1'],
    });
});

test('cockpitComposition: the template on a 1280 x 720 screen under its top bar has the monitor in its medium ' +
    'form, a pair 20 px under it, and Sessions at its least width, 440', () => {
    assertEqual(placementsOf(composeAt(1280, 688, {y: TOP_BAR_HEIGHT_PX})), {
        arrangement: 'side-by-side',
        plates: ['machine 24,57 760x26', 'agents 816,57 440x26'],
        tiles: ['system 24,91 760x352 medium', 'apps 24,463 476x232 6', 'connections 524,463 260x232 list',
            'sessions 816,91 440x604 1'],
    });
});

test('cockpitComposition: the template on a 1080 x 1920 portrait monitor is stacked, 1032 wide, with Sessions ' +
    '1032 x 800 in two columns under the machine', () => {
    assertEqual(placementsOf(composeAt(1080, 1920, {heldColumnCount: 2})), {
        arrangement: 'stacked',
        plates: ['machine 24,110 1032x26', 'agents 24,976 1032x26'],
        tiles: ['system 24,144 1032x384 wide', 'apps 24,544 1032x328 10', 'connections 24,888 1032x56 line',
            'sessions 24,1010 1032x800 2'],
    });
});

test('cockpitComposition: the template on a 720 x 1280 portrait monitor is stacked, the monitor small over six ' +
    'rows and Connections in one line, Sessions 672 x 492 under them', () => {
    assertEqual(placementsOf(composeAt(720, 1280)), {
        arrangement: 'stacked',
        plates: ['machine 24,24 672x26', 'agents 24,730 672x26'],
        tiles: ['system 24,58 672x328 small', 'apps 24,402 672x232 6', 'connections 24,650 672x56 line',
            'sessions 24,764 672x492 1'],
    });
});

test('cockpitComposition: the template on a 3440 x 1440 ultrawide stands in one row, every tile 384 high, ' +
    'Connections a list 300 wide and Sessions three columns, 1616 wide', () => {
    assertEqual(placementsOf(composeAt(3440, 1440, {heldColumnCount: 3})), {
        arrangement: 'one-row',
        plates: ['machine 24,511 1744x26', 'agents 1800,511 1616x26'],
        tiles: ['system 24,545 772x384 wide', 'apps 820,545 624x384 10', 'connections 1468,545 300x384 list',
            'sessions 1800,545 1616x384 3'],
    });
});

test('cockpitComposition: a layout with no system card on 1920 x 1080 has Heaviest over Connections in one line, ' +
    'beside Sessions 1080 x 800 in two columns', () => {
    const groups = [{...TEMPLATE_GROUPS[0], cards: ['apps', 'connections']}, TEMPLATE_GROUPS[1]];
    assertEqual(placementsOf(composeAt(1920, 1080, {groups, heldColumnCount: 2})), {
        arrangement: 'side-by-side',
        plates: ['machine 24,123 760x26', 'agents 816,123 1080x26'],
        tiles: ['apps 24,157 760x328 10', 'connections 24,501 760x56 line', 'sessions 816,157 1080x800 2'],
    });
});

test('cockpitComposition: the template on a 1024 x 768 screen under its top bar is not drawn: too small', () => {
    assertEqual(placementsOf(composeAt(1024, 736, {y: TOP_BAR_HEIGHT_PX})), {reason: 'too-small'});
});

// ---------------------------------------------------------------------------------------------------------------
// Ten common screens
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {object} composition - A drawn composition of the template.
 * @returns {object} Its arrangement, its bounds' size, and each tile's size and form.
 */
function commonScreenOf(composition) {
    return {
        arrangement: composition.arrangement,
        bounds: `${composition.bounds.width}x${composition.bounds.height}`,
        tiles: ['system', 'apps', 'connections', 'sessions'].map(cardId => sizeAndFormOf(tileOf(composition, cardId))),
    };
}

/** Ten common screens: each work area, the columns Sessions is held to there, and what the template gets. */
const COMMON_SCREENS = Object.freeze([
    {width: 3840, height: 2160, held: 2, arrangement: 'side-by-side', bounds: '2112x834',
        tiles: ['984x384 wide', '984x328 10', '984x56 line', '1080x800 2']},
    {width: 3440, height: 1440, held: 3, arrangement: 'one-row', bounds: '3392x418',
        tiles: ['772x384 wide', '624x384 10', '300x384 list', '1616x384 3']},
    {width: 2560, height: 1440, held: 2, arrangement: 'side-by-side', bounds: '2112x834',
        tiles: ['984x384 wide', '984x328 10', '984x56 line', '1080x800 2']},
    {width: 1920, height: 1080, held: 2, arrangement: 'side-by-side', bounds: '1872x834',
        tiles: ['760x384 wide', '760x328 10', '760x56 line', '1080x800 2']},
    {width: 1536, height: 928, held: 1, arrangement: 'side-by-side', bounds: '1488x834',
        tiles: ['892x384 wide', '892x328 10', '892x56 line', '564x800 1']},
    {width: 1440, height: 868, held: 1, arrangement: 'side-by-side', bounds: '1392x810',
        tiles: ['796x384 wide', '796x304 9', '796x56 line', '564x776 1']},
    {width: 1366, height: 736, held: 1, arrangement: 'side-by-side', bounds: '1318x674',
        tiles: ['760x384 wide', '476x232 6', '260x232 list', '526x640 1']},
    {width: 1280, height: 688, held: 1, arrangement: 'side-by-side', bounds: '1232x638',
        tiles: ['760x352 medium', '476x232 6', '260x232 list', '440x604 1']},
    {width: 1080, height: 1920, held: 2, arrangement: 'stacked', bounds: '1032x1700',
        tiles: ['1032x384 wide', '1032x328 10', '1032x56 line', '1032x800 2']},
    {width: 720, height: 1280, held: 1, arrangement: 'stacked', bounds: '672x1232',
        tiles: ['672x328 small', '672x232 6', '672x56 line', '672x492 1']},
]);

for (const {width, height, held, arrangement, bounds, tiles} of COMMON_SCREENS) {
    test(`cockpitComposition: the template on ${width} x ${height}, Sessions held to ${held} column(s), is ` +
        `${arrangement} in ${bounds}: monitor ${tiles[0]}, Heaviest ${tiles[1]}, Connections ${tiles[2]}, ` +
        `Sessions ${tiles[3]}`, () => {
        assertEqual(commonScreenOf(composeAt(width, height, {heldColumnCount: held})), {arrangement, bounds, tiles});
    });
}

/** The line boxes St gives at GNOME's default text size, in px, by the kind of line, as lib/measuredLengths.js reads them. */
const ST_LINE_BOXES_AT_THE_DEFAULT_TEXT_SIZE_PX = Object.freeze({
    [LineKind.ANNUNCIATOR]: 13, [LineKind.GROUP_CAPTION]: 15, [LineKind.SCALE]: 14, [LineKind.LABEL]: 16,
    [LineKind.GROUP_HEADING]: 16, [LineKind.GROUP_HEADING_COUNT]: 16, [LineKind.DETAIL]: 17, [LineKind.ROW]: 18,
    [LineKind.WAITING_NAME]: 21, [LineKind.TITLE]: 23,
});

test('cockpitComposition: the default sizes with their text lengths measured from St\'s line boxes at the default ' +
    'text size, by lib/measuredLengths.js, are the sizes the rows with St\'s line boxes use, and none is left at its ' +
    'default', () => {
    const {sheet, fallbackNames} = measuredSheet(DEFAULT_COCKPIT_SIZES, ST_LINE_BOXES_AT_THE_DEFAULT_TEXT_SIZE_PX);
    assertEqual({sheet, fallbackNames}, {sheet: SIZES_WITH_ST_LINE_BOXES, fallbackNames: []});
});

test('cockpitComposition: with St\'s line boxes the ten common screens keep their arrangements and the monitor its ' +
    'forms, 1280 x 688 keeping the medium form with 16 px under it; the monitor and Heaviest are 3 to 4 px and 1 px ' +
    'taller', () => {
    const screens = COMMON_SCREENS.map(({width, height}) => {
        const composition = composeAt(width, height, {sizes: SIZES_WITH_ST_LINE_BOXES, heldColumnCount: 6});
        const {columnCount, mostColumnCount, tileHeightPx} = composition.sessions;
        return `${width}x${height} ${composition.arrangement} ${sizeAndFormOf(tileOf(composition, 'system'))} ` +
            `${sizeAndFormOf(tileOf(composition, 'apps'))}; Sessions ${tileHeightPx} high, ${columnCount} of ` +
            `${mostColumnCount} column(s)`;
    });
    const hdSmall = composeAt(1280, 688, {sizes: SIZES_WITH_ST_LINE_BOXES});
    assertEqual({screens, gapUnderTheMediumMonitorPx: gapUnderTheMonitorPx(hdSmall)}, {
        screens: [
            '3840x2160 side-by-side 760x388 wide 760x329 10; Sessions 805 high, 6 of 6 column(s)',
            '3440x1440 one-row 772x388 wide 624x388 10; Sessions 388 high, 3 of 3 column(s)',
            '2560x1440 side-by-side 760x388 wide 760x329 10; Sessions 805 high, 4 of 4 column(s)',
            '1920x1080 side-by-side 760x388 wide 760x329 10; Sessions 805 high, 2 of 2 column(s)',
            '1536x928 side-by-side 892x388 wide 892x329 10; Sessions 805 high, 1 of 1 column(s)',
            '1440x868 side-by-side 796x388 wide 796x305 9; Sessions 781 high, 1 of 1 column(s)',
            '1366x736 side-by-side 760x388 wide 476x233 6; Sessions 645 high, 1 of 1 column(s)',
            '1280x688 side-by-side 760x355 medium 476x233 6; Sessions 604 high, 1 of 1 column(s)',
            '1080x1920 stacked 1032x388 wide 1032x329 10; Sessions 805 high, 2 of 2 column(s)',
            '720x1280 stacked 672x331 small 672x233 6; Sessions 488 high, 1 of 1 column(s)',
        ],
        gapUnderTheMediumMonitorPx: 16,
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Layouts other than the template
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {Array<object>} groups - A layout.
 * @param {number} width - A work area's width.
 * @param {number} height - Its height.
 * @returns {string[]} Each tile as `<card id> <width>x<height> <form>`, in the composition's order, after its
 *     arrangement.
 */
function tilesAt(groups, width, height) {
    const composition = composeAt(width, height, {groups, heldColumnCount: 2});
    return [composition.arrangement, ...composition.tiles.map(tile => `${tile.cardId} ${sizeAndFormOf(tile)}`)];
}

test('cockpitComposition: a layout with no system card gives Heaviest and Connections 600 px on 1536 x 928, so ' +
    'Sessions has two columns there; it is drawn from 1120 x 386, or 648 x 642 stacked', () => {
    assertEqual({
        desk: tilesAt(LAYOUTS.noSystemCard, 1920, 1080), laptop: tilesAt(LAYOUTS.noSystemCard, 1536, 928),
        least: leastCockpitWorkAreas(LAYOUTS.noSystemCard),
    }, {
        desk: ['side-by-side', 'apps 760x328 10', 'connections 760x56 line', 'sessions 1080x800 2'],
        laptop: ['side-by-side', 'apps 600x328 10', 'connections 600x56 line', 'sessions 856x800 2'],
        least: [{arrangement: 'side-by-side', width: 1120, height: 386}, {arrangement: 'stacked', width: 648, height: 642}],
    });
});

test('cockpitComposition: a layout with no sessions card is one column, 984 x 834, centred; it is stacked only, ' +
    'from 648 x 730', () => {
    const desk = composeAt(1920, 1080, {groups: LAYOUTS.noSessionsCard});
    const laptop = composeAt(1536, 928, {groups: LAYOUTS.noSessionsCard});
    assertEqual({
        desk: [desk.arrangement, desk.bounds], laptop: [laptop.arrangement, laptop.bounds],
        least: leastCockpitWorkAreas(LAYOUTS.noSessionsCard),
    }, {
        desk: ['stacked', {x: 468, y: 123, width: 984, height: 834}],
        laptop: ['stacked', {x: 276, y: 47, width: 984, height: 834}],
        least: [{arrangement: 'stacked', width: 648, height: 730}],
    });
});

test('cockpitComposition: four groups of one card stack the machine\'s three groups, each under its plate, beside ' +
    'Sessions; it is drawn from 1280 x 814, or 648 x 1062 stacked', () => {
    const desk = composeAt(1920, 1080, {groups: LAYOUTS.fourGroupsOfOneCard, heldColumnCount: 2});
    assertEqual({
        desk: tilesAt(LAYOUTS.fourGroupsOfOneCard, 1920, 1080), plateCount: desk.plates.length,
        laptop: tilesAt(LAYOUTS.fourGroupsOfOneCard, 1536, 928),
        least: leastCockpitWorkAreas(LAYOUTS.fourGroupsOfOneCard),
    }, {
        desk: ['side-by-side', 'system 760x384 wide', 'apps 760x328 10', 'connections 760x56 line', 'sessions 1080x900 2'],
        plateCount: 4,
        laptop: ['side-by-side', 'system 892x384 wide', 'apps 892x256 7', 'connections 892x56 line', 'sessions 564x828 1'],
        least: [{arrangement: 'side-by-side', width: 1280, height: 814}, {arrangement: 'stacked', width: 648, height: 1062}],
    });
});

test('cockpitComposition: one group of all four is drawn as the template under one plate, the machine\'s tiles 24 ' +
    'px from Sessions; it is drawn from 1272 x 658, or 648 x 936 stacked', () => {
    const desk = composeAt(1920, 1080, {groups: LAYOUTS.oneGroupOfFour, heldColumnCount: 2});
    assertEqual({
        desk: tilesAt(LAYOUTS.oneGroupOfFour, 1920, 1080),
        gapBesideSessionsPx: tileOf(desk, 'sessions').x - tileOf(desk, 'system').x - tileOf(desk, 'system').width,
        plates: desk.plates.map(plate => plate.width),
        laptop: tilesAt(LAYOUTS.oneGroupOfFour, 1536, 928),
        least: leastCockpitWorkAreas(LAYOUTS.oneGroupOfFour),
    }, {
        desk: ['side-by-side', 'system 768x384 wide', 'apps 768x328 10', 'connections 768x56 line', 'sessions 1080x800 2'],
        gapBesideSessionsPx: 24,
        plates: [768 + 24 + 1080],
        laptop: ['side-by-side', 'system 900x384 wide', 'apps 900x328 10', 'connections 900x56 line', 'sessions 564x800 1'],
        least: [{arrangement: 'side-by-side', width: 1272, height: 658}, {arrangement: 'stacked', width: 648, height: 936}],
    });
});

test('cockpitComposition: the system card with Heaviest, then Connections with Sessions, puts Connections in one ' +
    'line over Sessions; it is drawn from 1440 x 658, or 648 x 978 stacked', () => {
    const groups = LAYOUTS.systemWithAppsThenConnectionsWithSessions;
    assertEqual({
        desk: tilesAt(groups, 1920, 1080), laptop: tilesAt(groups, 1536, 928), least: leastCockpitWorkAreas(groups),
    }, {
        desk: ['side-by-side', 'system 808x384 wide', 'apps 808x328 10', 'connections 1032x56 line', 'sessions 1032x800 2'],
        laptop: ['side-by-side', 'system 760x384 wide', 'apps 760x328 10', 'connections 696x56 line', 'sessions 696x774 1'],
        least: [{arrangement: 'side-by-side', width: 1440, height: 658}, {arrangement: 'stacked', width: 648, height: 978}],
    });
});

test('cockpitComposition: Connections alone beside a group of the monitor, Heaviest and Sessions is a list beside ' +
    'a stack, which gives the monitor its small form; it is drawn from 1100 x 864, or 648 x 978 stacked', () => {
    const groups = LAYOUTS.connectionsThenTheRestWithSessions;
    assertEqual({
        desk: tilesAt(groups, 1920, 1080), laptop: tilesAt(groups, 1536, 928), least: leastCockpitWorkAreas(groups),
    }, {
        desk: ['side-by-side', 'connections 336x304 list', 'system 1032x328 small', 'apps 1032x232 6', 'sessions 1032x406 2'],
        laptop: ['side-by-side', 'connections 336x304 list', 'system 1032x328 small', 'apps 1032x232 6', 'sessions 1032x254 2'],
        least: [{arrangement: 'side-by-side', width: 1100, height: 864}, {arrangement: 'stacked', width: 648, height: 978}],
    });
});

test('cockpitComposition: the template with its Sessions group first is the template mirrored, Sessions on the ' +
    'left; it is drawn from 1280 x 658, or 648 x 978 stacked', () => {
    const groups = LAYOUTS.sessionsGroupFirst;
    const mirrored = composeAt(1920, 1080, {groups, heldColumnCount: 2});
    const template = composeAt(1920, 1080, {heldColumnCount: 2});
    const leftEdgesPx = composition => composition.tiles.map(tile => `${tile.cardId} ${tile.x}`);
    assertEqual({
        desk: tilesAt(groups, 1920, 1080), laptop: tilesAt(groups, 1536, 928),
        mirrored: leftEdgesPx(mirrored), template: leftEdgesPx(template), least: leastCockpitWorkAreas(groups),
    }, {
        desk: ['side-by-side', 'sessions 1080x800 2', 'system 760x384 wide', 'apps 760x328 10', 'connections 760x56 line'],
        laptop: ['side-by-side', 'sessions 564x800 1', 'system 892x384 wide', 'apps 892x328 10', 'connections 892x56 line'],
        mirrored: ['sessions 24', 'system 1136', 'apps 1136', 'connections 1136'],
        template: ['system 24', 'apps 24', 'connections 24', 'sessions 816'],
        least: [{arrangement: 'side-by-side', width: 1280, height: 658}, {arrangement: 'stacked', width: 648, height: 978}],
    });
});

test('cockpitComposition: Sessions as the only card is one tile, 1080 x 800 in two columns, centred; it is drawn ' +
    'from 488 x 272', () => {
    const desk = composeAt(1920, 1080, {groups: LAYOUTS.sessionsOnly, heldColumnCount: 2});
    assertEqual({
        desk: [desk.arrangement, desk.bounds, sizeAndFormOf(tileOf(desk, 'sessions'))],
        laptop: tilesAt(LAYOUTS.sessionsOnly, 1536, 928), least: leastCockpitWorkAreas(LAYOUTS.sessionsOnly),
    }, {
        desk: ['stacked', {x: 420, y: 123, width: 1080, height: 834}, '1080x800 2'],
        laptop: ['stacked', 'sessions 1080x800 2'],
        least: [{arrangement: 'stacked', width: 488, height: 272}],
    });
});

test('cockpitComposition: Connections as the only card is a list, 336 x 304, centred; it is drawn from 308 x 314, ' +
    'its plate giving up its legend before the cockpit is given up', () => {
    const desk = composeAt(1920, 1080, {groups: LAYOUTS.connectionsOnly, plateLegendWidthsPx: [269]});
    assertEqual({
        desk: [desk.arrangement, desk.bounds, sizeAndFormOf(tileOf(desk, 'connections'))],
        laptop: tilesAt(LAYOUTS.connectionsOnly, 1536, 928), least: leastCockpitWorkAreas(LAYOUTS.connectionsOnly),
        legendAtTheLeast: composeAt(308, 314, {groups: LAYOUTS.connectionsOnly, plateLegendWidthsPx: [269]}).plates
            .map(plate => [plate.width, plate.isLegendShort]),
    }, {
        desk: ['stacked', {x: 792, y: 371, width: 336, height: 338}, '336x304 list'],
        laptop: ['stacked', 'connections 336x304 list'],
        least: [{arrangement: 'stacked', width: 308, height: 314}],
        legendAtTheLeast: [[260, true]],
    });
});

test('cockpitComposition: Heaviest as the only card stops gaining width at 624 px: on 1920 x 1080 it is 624 x 328, ' +
    'with ten rows', () => {
    const desk = composeAt(1920, 1080, {groups: layoutOf(['apps'])});
    assertEqual([desk.arrangement, sizeAndFormOf(tileOf(desk, 'apps'))], ['stacked', '624x328 10']);
});

test('cockpitComposition: three groups in one row on 3677 x 1000 take the 15 px they lack from the two gaps between ' +
    'them, 8 px each, rounded up: gaps of 40, and a row 3628 px wide, a pixel under the room', () => {
    const groups = layoutOf(['system'], ['apps', 'connections'], ['sessions']);
    const composition = composeAt(3677, 1000, {groups});
    const [first, second, third] = composition.plates;
    assertEqual({
        arrangement: composition.arrangement,
        groupGapsPx: [second.x - first.x - first.width, third.x - second.x - second.width],
        widthPx: composition.bounds.width,
    }, {arrangement: 'one-row', groupGapsPx: [40, 40], widthPx: 3628});
});

// ---------------------------------------------------------------------------------------------------------------
// The least work areas
// ---------------------------------------------------------------------------------------------------------------

/**
 * The least work area an arrangement is drawn in, found the slow way: each length walked up from 0 one pixel at a
 * time until the arrangement is drawn, the width at the search's bound of height, then the height at that width.
 *
 * @param {Array<object>} groups - A layout.
 * @param {string} arrangement - The arrangement tried alone.
 * @returns {{arrangement: string, width: number, height: number}|null} The least work area, or null where the
 *     arrangement is not drawn at the bound.
 */
function walkedLeastWorkArea(groups, arrangement) {
    const isDrawnAt = (width, height) => cockpitComposition({
        workArea: {x: 0, y: 0, width, height}, groups, onlyArrangement: arrangement,
    }).isDrawn;
    let width = 0;
    while (width <= LEAST_WORK_AREA_SEARCH_BOUND_PX && !isDrawnAt(width, LEAST_WORK_AREA_SEARCH_BOUND_PX))
        width++;
    if (width > LEAST_WORK_AREA_SEARCH_BOUND_PX)
        return null;
    let height = 0;
    while (!isDrawnAt(width, height))
        height++;
    return {arrangement, width, height};
}

test('leastCockpitWorkAreas: reads the layout and the sizes once for its whole search: each group\'s cards and the ' +
    'margin are read once, and the least work areas are the template\'s', () => {
    const groups = TEMPLATE_GROUPS.map(group => ({...group}));
    const cardsReads = groups.map(group => countReadsOf(group, 'cards', group.cards));
    const sizes = copyOfDefaultSizes();
    const marginReads = countReadsOf(sizes, 'marginPx', sizes.marginPx);
    const leastWorkAreas = leastCockpitWorkAreas(groups, sizes);
    assertEqual({leastWorkAreas, reads: [...cardsReads.map(reads => reads.count), marginReads.count]}, {
        leastWorkAreas: leastCockpitWorkAreas(TEMPLATE_GROUPS), reads: [1, 1, 1],
    });
});

test('leastCockpitWorkAreas: for the template and the other layouts, each arrangement\'s least work area is what a ' +
    'walk up from nothing, one pixel at a time, finds', () => {
    const layouts = {template: TEMPLATE_GROUPS, ...LAYOUTS};
    const differences = [];
    for (const [layoutName, groups] of Object.entries(layouts)) {
        const walked = [COCKPIT_ARRANGEMENT.SIDE_BY_SIDE, COCKPIT_ARRANGEMENT.STACKED]
            .map(arrangement => walkedLeastWorkArea(groups, arrangement))
            .filter(leastWorkArea => leastWorkArea !== null);
        if (JSON.stringify(walked) !== JSON.stringify(leastCockpitWorkAreas(groups)))
            differences.push(layoutName);
    }
    assertEqual({differences, template: leastCockpitWorkAreas(TEMPLATE_GROUPS)}, {
        differences: [],
        template: [{arrangement: 'side-by-side', width: 1280, height: 658}, {arrangement: 'stacked', width: 648, height: 978}],
    });
});

test('leastCockpitWorkAreas: a layout that draws no tile has none, and so do sizes with which no arrangement is ' +
    'drawn on any work area up to the search\'s bound; a layout without Sessions has the stack\'s alone', () => {
    const marginTooLargeForAnyWorkArea = {...copyOfDefaultSizes(), marginPx: LEAST_WORK_AREA_SEARCH_BOUND_PX};
    assertEqual({
        noTile: leastCockpitWorkAreas([{id: 'g', caption: 'G', columns: 1, cards: ['weather']}]),
        noGroups: leastCockpitWorkAreas(null),
        sizesThatNeverDraw: leastCockpitWorkAreas(TEMPLATE_GROUPS, marginTooLargeForAnyWorkArea),
        brokenSizes: leastCockpitWorkAreas(TEMPLATE_GROUPS, {}),
        withoutSessions: leastCockpitWorkAreas(LAYOUTS.noSessionsCard).map(leastWorkArea => leastWorkArea.arrangement),
    }, {noTile: [], noGroups: [], sizesThatNeverDraw: [], brokenSizes: [], withoutSessions: ['stacked']});
});
