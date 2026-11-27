// lib/cockpitGrid.js: where each cockpit card goes on the cockpit monitor's work area.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEqual} from './harness.js';
import * as cockpitGrid from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitGrid.js';
import * as cockpitConfig from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitConfig.js';
import * as drawingConstantsModule from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';
import {
    COMPACT_CARD_HEIGHT_AT_DEFAULT_TEXT_PX,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';

const REPO_ROOT_URI = GLib.uri_resolve_relative(import.meta.url, '../../', GLib.UriFlags.NONE);
const [REPO_ROOT] = GLib.filename_from_uri(REPO_ROOT_URI);
const TEMPLATE_PATH = GLib.build_filenamev([REPO_ROOT, 'examples', 'resource-pulse-cockpit.json.template']);
const [, TEMPLATE_BYTES] = Gio.File.new_for_path(TEMPLATE_PATH).load_contents(null);
const TEMPLATE_GROUPS = cockpitConfig.parseCockpitConfig(new TextDecoder().decode(TEMPLATE_BYTES)).layout.groups;
const FULL_HD = {x: 0, y: 0, width: 1920, height: 1080};
const TEMPLATE_CARD_COUNT = 4;
const oneColumnGroups = cardIds => cardIds.map(cardId => ({id: cardId, caption: cardId, columns: 1, cards: [cardId]}));
const ALL_CARD_IDS = ['system', 'apps', 'connections', 'sessions'];
/** Layouts the config admits, beside the template. */
const LAYOUTS = {
    twoColumnsFourCards: [{id: 'g', caption: 'G', columns: 2, cards: ALL_CARD_IDS}],
    oneColumnFourCards: [{id: 'g', caption: 'G', columns: 1, cards: ALL_CARD_IDS}],
    twoGroupsOfTwoColumns: [
        {id: 'a', caption: 'A', columns: 2, cards: ['system', 'apps']},
        {id: 'b', caption: 'B', columns: 2, cards: ['connections', 'sessions']},
    ],
    fourOneColumnGroups: oneColumnGroups(ALL_CARD_IDS),
    systemRightMost: [{id: 'g', caption: 'G', columns: 2, cards: ['apps', 'system']}],
};
/** Layouts only the lenient reader lets through (a newer or broken service's), which must still give numbers. */
const READER_ONLY_LAYOUTS = {
    noGroups: [],
    noColumnNoCard: [{id: 'g', caption: 'G', columns: 0, cards: []}],
    noCard: [{id: 'g', caption: 'G', columns: 2, cards: []}],
    cardsAndNoColumn: [{id: 'g', caption: 'G', columns: 0, cards: ['system']}],
    fiveOneColumnGroups: oneColumnGroups([...ALL_CARD_IDS, 'weather']),
};

/**
 * @param {object} geometry - A cockpitGridGeometry result.
 * @param {string} cardId - A card id.
 * @returns {object} That card's cell.
 */
function cellOf(geometry, cardId) {
    return geometry.cells.find(cell => cell.cardId === cardId);
}

test('cockpitGrid: the template\'s grid at 1920x1080 has 420-wide cells, 300-tall rows and a 28 px caption row, ' +
    'centred on the two rows it uses', () => {
    const geometry = cockpitGrid.cockpitGridGeometry({workArea: FULL_HD, groups: TEMPLATE_GROUPS});
    const system = cellOf(geometry, 'system');
    // Grid 1332 wide (a two-column group, 2 x 420 + 24, a 48 gap, a one-column group, 420): margin (1920 - 1332) / 2.
    // 652 tall (a 28 caption, 2 x 300 + 24): margin (1080 - 652) / 2 = 214, then the caption.
    assertEqual([system.x, system.y, system.width, system.height], [294, 242, 420, 300]);
    assertEqual(cellOf(geometry, 'connections').row, 1);
    assertEqual(cellOf(geometry, 'connections').y, 242 + 300 + 24);
    assertEqual(cellOf(geometry, 'sessions').x, 294 + 2 * 420 + 24 + 48);
    assertEqual(geometry.captions.map(c => c.text), ['MACHINE', 'AGENTS']);
});
test('cockpitGrid: a caption spans its group above its first row', () => {
    const {captions} = cockpitGrid.cockpitGridGeometry({workArea: FULL_HD, groups: TEMPLATE_GROUPS});
    assertEqual(captions[0], {groupId: 'machine', text: 'MACHINE', x: 294, y: 214, width: 2 * 420 + 24, height: 28});
    assertEqual([captions[1].x, captions[1].width], [294 + 420 * 2 + 24 + 48, 420]);
});
test('cockpitGrid: a work area offset and a smaller monitor scale every length, never the cell count, just enough ' +
    'for the frame to fit inside the margin, each row raised to the system card\'s height', () => {
    const workArea = {x: 1920, y: 0, width: 1280, height: 720};
    const geometry = cockpitGrid.cockpitGridGeometry({workArea, groups: TEMPLATE_GROUPS});
    assertEqual(geometry.cells.length, TEMPLATE_CARD_COUNT);
    const system = cellOf(geometry, 'system');
    // The frame is 1332 x 652 at the reference; (1280 - 2 x 12) / 1332 is about 0.943, the scale that fits. The
    // scaled row, 282, is raised to the card's 286.
    assertEqual([system.width, system.height], [396, COMPACT_CARD_HEIGHT_AT_DEFAULT_TEXT_PX]);
    assertEqual(cellOf(geometry, 'apps').x - system.x, 396 + 22);
    assertEqual(cellOf(geometry, 'sessions').x - cellOf(geometry, 'apps').x, 396 + 45);
    assertEqual(cellOf(geometry, 'connections').y - system.y, 286 + 22);
    // Grid 1255 x 620 (2 x 396 + 22 + 45 + 396; 26 caption + 2 x 286 + 22): margins (1280 - 1255) / 2 = 12 and
    // (720 - 620) / 2 = 50.
    assertEqual([system.x, system.y], [1920 + 12, 50 + 26]);
    geometry.cells.forEach(cell => {
        const isInside = cell.x >= workArea.x && cell.y >= workArea.y &&
            cell.x + cell.width <= workArea.x + workArea.width && cell.y + cell.height <= workArea.y + workArea.height;
        assertEqual(isInside, true);
    });
});
test('cockpitGrid: the scale is never over 2, never over what fits; a row is never shorter than the system card, so ' +
    'where the raised rows do not fit, the grid is not drawn', () => {
    const tinyWorkArea = {x: 0, y: 0, width: 640, height: 360};
    const tiny = cockpitGrid.cockpitGridGeometry({workArea: tinyWorkArea, groups: TEMPLATE_GROUPS});
    const tinySystem = cellOf(tiny, 'system');
    assertEqual([tinySystem.width, tinySystem.height], [194, COMPACT_CARD_HEIGHT_AT_DEFAULT_TEXT_PX]);
    assertEqual(tiny.cells.every(cell => cell.x >= 0 && cell.x + cell.width <= tinyWorkArea.width), true);
    assertEqual(isDrawableAt(tinyWorkArea.width, tinyWorkArea.height), false);
    const huge = cockpitGrid.cockpitGridGeometry({workArea: {x: 0, y: 0, width: 7680, height: 4320}, groups: TEMPLATE_GROUPS});
    assertEqual([cellOf(huge, 'system').width, cellOf(huge, 'system').height], [840, 600]);
});
test('cockpitGrid: cards fill a group left to right, then the next row; extra cards get no cell', () => {
    const groups = [{id: 'g', caption: 'G', columns: 2, cards: ['system', 'apps', 'connections', 'sessions', 'weather', 'clock', 'notes']}];
    const {cells} = cockpitGrid.cockpitGridGeometry({workArea: FULL_HD, groups});
    assertEqual(cells.map(c => [c.cardId, c.column, c.row]), [
        ['system', 0, 0], ['apps', 1, 0], ['connections', 0, 1], ['sessions', 1, 1], ['weather', 0, 2], ['clock', 1, 2],
    ]);
});
test('cockpitGrid: an unknown card id still gets a cell', () => {
    const groups = [{id: 'g', caption: 'G', columns: 1, cards: ['weather']}];
    assertEqual(cockpitGrid.cockpitGridGeometry({workArea: FULL_HD, groups}).cells.length, 1);
    assertEqual(cockpitGrid.isKnownCockpitCard('weather'), false);
    assertEqual(['system', 'apps', 'connections', 'sessions'].map(cockpitGrid.isKnownCockpitCard), [true, true, true, true]);
});
test('cockpitGrid: the cockpit draws a card in the first cell of each id it knows; an unknown id\'s cell and a known ' +
    'id\'s second cell stay empty (drawnCockpitCells), and the ids drawn are the same whatever the work area', () => {
    const groups = [
        {id: 'machine', caption: 'MACHINE', columns: 2, cards: ['system', 'weather', 'apps', 'system']},
        {id: 'agents', caption: 'AGENTS', columns: 1, cards: ['sessions', 'clock']},
    ];
    const {cells} = cockpitGrid.cockpitGridGeometry({workArea: FULL_HD, groups});
    const drawnCells = cockpitGrid.drawnCockpitCells(cells);
    const smallerWorkArea = {x: 1920, y: 0, width: 1280, height: 720};
    const smallerCells = cockpitGrid.cockpitGridGeometry({workArea: smallerWorkArea, groups}).cells;
    assertEqual({
        drawn: drawnCells.map(cell => [cell.cardId, cell.groupId, cell.column, cell.row]),
        drawnCellIsTheGridCell: drawnCells[0] === cells[0],
        drawnCardIds: cockpitGrid.drawnCockpitCardIds(groups),
        drawnAtAnotherWorkArea: cockpitGrid.drawnCockpitCells(smallerCells).map(cell => cell.cardId),
        noGroups: cockpitGrid.drawnCockpitCardIds([]),
        onlyUnknown: cockpitGrid.drawnCockpitCardIds([{id: 'g', caption: 'G', columns: 1, cards: ['weather']}]),
    }, {
        drawn: [['system', 'machine', 0, 0], ['apps', 'machine', 0, 1], ['sessions', 'agents', 0, 0]],
        drawnCellIsTheGridCell: true,
        drawnCardIds: ['system', 'apps', 'sessions'],
        drawnAtAnotherWorkArea: ['system', 'apps', 'sessions'],
        noGroups: [],
        onlyUnknown: [],
    });
});
test('cockpitGrid: a card past what its group\'s block holds gets no cell, so it is not drawn either', () => {
    const groups = [{id: 'g', caption: 'G', columns: 1, cards: ['weather', 'clock', 'notes', 'sessions']}];
    assertEqual(cockpitGrid.drawnCockpitCardIds(groups), []);
});

/**
 * @param {number} width - A work area's width.
 * @param {number} height - Its height.
 * @param {Array<object>} [groups] - The layout's groups: the template's unless given.
 * @returns {boolean} isCockpitGridDrawable for that work area, at the stage's origin.
 */
function isDrawableAt(width, height, groups = TEMPLATE_GROUPS) {
    return cockpitGrid.isCockpitGridDrawable({x: 0, y: 0, width, height}, groups);
}

/**
 * @param {number} x - A work area's left edge.
 * @param {number} y - Its top edge.
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @returns {number[]|null} The template's system cell as [x, y, width, height], or null where the grid is not drawn.
 */
function systemCellAt(x, y, width, height) {
    const workArea = {x, y, width, height};
    if (!cockpitGrid.isCockpitGridDrawable(workArea, TEMPLATE_GROUPS))
        return null;
    const system = cellOf(cockpitGrid.cockpitGridGeometry({workArea, groups: TEMPLATE_GROUPS}), 'system');
    return [system.x, system.y, system.width, system.height];
}

test('cockpitGrid: the template is drawn where a scaled cell and its inner gutter are at least the widest card ' +
    'content, COCKPIT_CARD_CONTENT_WIDTH_PX, and its frame fits inside the margin: at the 1920x1080 reference, at ' +
    'the nested run\'s 3072x1920, on a 1536x960 laptop panel with or without its top bar, at 1366x736 and at ' +
    '1280x688; on a 1080x1920 portrait monitor, where its three columns need 1274 px, it is not', () => {
    assertEqual({
        contentWidthPx: drawingConstantsModule.COCKPIT_CARD_CONTENT_WIDTH_PX,
        reference: isDrawableAt(1920, 1080),
        nestedRun: isDrawableAt(3072, 1920),
        laptopPanel: isDrawableAt(1536, 960),
        laptopPanelUnderItsTopBar: isDrawableAt(1536, 928),
        smallLaptop: isDrawableAt(1366, 736),
        smallestDrawn: isDrawableAt(1280, 688),
        portrait: isDrawableAt(1080, 1920),
    }, {
        contentWidthPx: 416, reference: true, nestedRun: true, laptopPanel: true, laptopPanelUnderItsTopBar: true,
        smallLaptop: true, smallestDrawn: true, portrait: false,
    });
});

test('cockpitGrid: the least work area depends on the layout\'s columns and rows: 1274x644 for the template, whose ' +
    '394 px cell and 22 px gutter make 416 there, and whose two rows raised to the card\'s 286 make a 620 px frame; ' +
    'one pixel less in either length is under it', () => {
    const atTheLeast = cockpitGrid.cockpitGridGeometry({
        workArea: {x: 0, y: 0, width: 1274, height: 644}, groups: TEMPLATE_GROUPS,
    });
    const system = cellOf(atTheLeast, 'system');
    assertEqual({
        template: cockpitGrid.leastDrawableWorkArea(TEMPLATE_GROUPS),
        twoColumnsFourCards: cockpitGrid.leastDrawableWorkArea(LAYOUTS.twoColumnsFourCards),
        oneColumnFourCards: cockpitGrid.leastDrawableWorkArea(LAYOUTS.oneColumnFourCards),
        twoGroupsOfTwoColumns: cockpitGrid.leastDrawableWorkArea(LAYOUTS.twoGroupsOfTwoColumns),
        fourOneColumnGroups: cockpitGrid.leastDrawableWorkArea(LAYOUTS.fourOneColumnGroups),
        atTheLeast: isDrawableAt(1274, 644), oneNarrower: isDrawableAt(1273, 644), oneShorter: isDrawableAt(1274, 643),
        cellAndGutterAtTheLeast: [system.width, cellOf(atTheLeast, 'apps').x - system.x - system.width],
        frameHeightAtTheLeast: cellOf(atTheLeast, 'connections').y + system.height - atTheLeast.captions[0].y,
    }, {
        template: {width: 1274, height: 644}, twoColumnsFourCards: {width: 835, height: 644},
        oneColumnFourCards: {width: 418, height: 952}, twoGroupsOfTwoColumns: {width: 1691, height: 336},
        fourOneColumnGroups: {width: 1736, height: 336},
        atTheLeast: true, oneNarrower: false, oneShorter: false, cellAndGutterAtTheLeast: [394, 22],
        frameHeightAtTheLeast: 620,
    });
});

test('cockpitGrid: the journal line for a work area too small for the grid names the length that is short for ' +
    'this layout, or both, and the work area\'s size, so the card is drawn top right', () => {
    const line = (width, height, groups) =>
        cockpitGrid.cockpitGridTooSmallLine({x: 0, y: 32, width, height}, groups);
    assertEqual({
        tooShort: line(1536, 928, LAYOUTS.oneColumnFourCards),
        tooNarrow: line(1080, 1920, TEMPLATE_GROUPS),
        both: line(1200, 600, TEMPLATE_GROUPS),
    }, {
        tooShort: 'the cockpit grid needs a work area at least 952 px tall for this layout (it is 1536x928), ' +
            'so the card is drawn top right',
        tooNarrow: 'the cockpit grid needs a work area at least 1274 px wide for this layout (it is 1080x1920), ' +
            'so the card is drawn top right',
        both: 'the cockpit grid needs a work area at least 1274x644 for this layout (it is 1200x600), ' +
            'so the card is drawn top right',
    });
});

test('cockpitGrid: what the template gets, by work area: double cells on UHD, the reference\'s cells from ' +
    '1920x1048 down to 1366x736, cells scaled to fit at 1280x688 with their rows raised to the card\'s height, and ' +
    'nothing on a portrait monitor', () => {
    assertEqual({
        uhd: systemCellAt(0, 0, 3840, 2160), fullHdUnderATopBar: systemCellAt(0, 32, 1920, 1048),
        laptop: systemCellAt(0, 32, 1536, 928), smallLaptop: systemCellAt(0, 32, 1366, 736),
        smallest: systemCellAt(0, 32, 1280, 688), portrait: systemCellAt(0, 0, 1080, 1920),
    }, {
        uhd: [588, 484, 840, 600], fullHdUnderATopBar: [294, 258, 420, 300], laptop: [102, 198, 420, 300],
        smallLaptop: [17, 102, 420, 300], smallest: [12, 92, 396, 286], portrait: null,
    });
});

test('cockpitGrid: at 0.1.0\'s limit, 1802x1014, and a pixel either side of it, the grid is drawn at the ' +
    'reference\'s own cells', () => {
    const cellSizes = [[1801, 1014], [1802, 1013], [1802, 1014], [1803, 1015]].map(([width, height]) =>
        systemCellAt(0, 0, width, height).slice(2));
    assertEqual(cellSizes, [[420, 300], [420, 300], [420, 300], [420, 300]]);
});

/**
 * Walks a line of work areas one pixel at a time and names each step where the larger work area has a narrower or
 * shorter first cell, or loses a drawn grid.
 *
 * @param {string} layoutName - The layout's name, for the fault.
 * @param {Array<object>} groups - The layout's groups.
 * @param {Array<{width: number, height: number}>} workAreas - Work areas in growing order.
 * @returns {string[]} "<layout> at <width>x<height>" for each fault.
 */
function growthFaults(layoutName, groups, workAreas) {
    const faults = [];
    let previous = null;
    for (const {width, height} of workAreas) {
        const workArea = {x: 0, y: 0, width, height};
        const [firstCell] = cockpitGrid.cockpitGridGeometry({workArea, groups}).cells;
        const isDrawn = cockpitGrid.isCockpitGridDrawable(workArea, groups);
        const isFault = previous !== null && (firstCell.width < previous.width || firstCell.height < previous.height ||
            (previous.isDrawn && !isDrawn));
        if (isFault)
            faults.push(`${layoutName} at ${width}x${height}`);
        previous = {width: firstCell.width, height: firstCell.height, isDrawn};
    }
    return faults;
}

/**
 * @param {number} fromPx - The first length.
 * @param {number} toPx - The last length.
 * @param {number} [stepPx] - The step between lengths.
 * @returns {number[]} The lengths from the first to the last.
 */
function lengthsFrom(fromPx, toPx, stepPx = 1) {
    return Array.from({length: Math.floor((toPx - fromPx) / stepPx) + 1}, (_unused, index) => fromPx + index * stepPx);
}

test('cockpitGrid: one pixel at a time, a larger work area never has a narrower or shorter cell and never loses a ' +
    'drawn grid, for the template and each layout, across every threshold', () => {
    const HELD_HEIGHTS_PX = [332, 336, 636, 644, 688, 928, 940, 952, 1080];
    const HELD_WIDTHS_PX = [418, 835, 1274, 1536, 1736, 1920];
    const faults = [];
    for (const [layoutName, groups] of Object.entries({template: TEMPLATE_GROUPS, ...LAYOUTS})) {
        for (const height of HELD_HEIGHTS_PX)
            faults.push(...growthFaults(layoutName, groups, lengthsFrom(400, 2000).map(width => ({width, height}))));
        for (const width of HELD_WIDTHS_PX)
            faults.push(...growthFaults(layoutName, groups, lengthsFrom(300, 1100).map(height => ({width, height}))));
    }
    assertEqual(faults, []);
});

test('cockpitGrid: with the system card right-most at the least work area its layout is drawn at, its cell ends a ' +
    'margin inside the work area', () => {
    const {cells} = cockpitGrid.cockpitGridGeometry({
        workArea: {x: 0, y: 0, width: 835, height: 336}, groups: LAYOUTS.systemRightMost,
    });
    assertEqual({
        isDrawn: isDrawableAt(835, 336, LAYOUTS.systemRightMost),
        cells: cells.map(cell => [cell.cardId, cell.x, cell.y, cell.width, cell.height]),
        rightMarginPx: 835 - (cells[1].x + cells[1].width),
    }, {isDrawn: true, cells: [['apps', 12, 38, 394, 286], ['system', 428, 38, 394, 286]], rightMarginPx: 13});
});

test('cockpitGrid: a layout only the lenient reader admits (no groups, no column, no card, five one-column groups) ' +
    'gives finite numbers everywhere, and a drawn grid is never lost as the work area grows; a work area of nothing ' +
    'gives cells of nothing, and no grid', () => {
    const WORK_AREA_STEP_PX = 16;
    const widths = lengthsFrom(0, 4000, WORK_AREA_STEP_PX);
    const heights = lengthsFrom(0, 2400, WORK_AREA_STEP_PX);
    const faults = [];
    for (const [layoutName, groups] of Object.entries(READER_ONLY_LAYOUTS)) {
        const drawnAt = heights.map(height => widths.map(width =>
            cockpitGrid.isCockpitGridDrawable({x: 0, y: 0, width, height}, groups)));
        heights.forEach((height, heightIndex) => widths.forEach((width, widthIndex) => {
            const {captions, cells} = cockpitGrid.cockpitGridGeometry({workArea: {x: 0, y: 0, width, height}, groups});
            const isFinite = [...captions, ...cells].every(rectangle =>
                [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite));
            const isDrawn = drawnAt[heightIndex][widthIndex];
            const isLostWider = widthIndex > 0 && drawnAt[heightIndex][widthIndex - 1] && !isDrawn;
            const isLostTaller = heightIndex > 0 && drawnAt[heightIndex - 1][widthIndex] && !isDrawn;
            if (!isFinite || isLostWider || isLostTaller)
                faults.push(`${layoutName} at ${width}x${height}`);
        }));
    }
    assertEqual({
        fiveGroupsAtFullHd: isDrawableAt(1920, 1080, READER_ONLY_LAYOUTS.fiveOneColumnGroups),
        fiveGroupsLeast: cockpitGrid.leastDrawableWorkArea(READER_ONLY_LAYOUTS.fiveOneColumnGroups),
        nothingAtNoWorkArea: isDrawableAt(0, 0),
        cellsAtNoWorkArea: cockpitGrid.cockpitGridGeometry({
            workArea: {x: 0, y: 0, width: 0, height: 0}, groups: TEMPLATE_GROUPS,
        }).cells.map(cell => [cell.x, cell.y, cell.width, cell.height]),
        faults,
    }, {
        fiveGroupsAtFullHd: false, fiveGroupsLeast: {width: 2175, height: 336}, nothingAtNoWorkArea: false,
        cellsAtNoWorkArea: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], faults: [],
    });
});

test('cockpitGrid: the grid is centred on the rows it uses: one row, two rows, three rows (a fourth card in one ' +
    'column gets no cell)', () => {
    const cellTops = groups => cockpitGrid.cockpitGridGeometry({workArea: FULL_HD, groups}).cells.map(cell => cell.y);
    assertEqual({
        oneRow: cellTops(LAYOUTS.twoGroupsOfTwoColumns), twoRows: cellTops(TEMPLATE_GROUPS),
        threeRows: cellTops(LAYOUTS.oneColumnFourCards),
    }, {oneRow: [404, 404, 404, 404], twoRows: [242, 242, 566, 242], threeRows: [80, 404, 728]});
});

/**
 * The least work area found the slow way: from 3840 x 2160, each length walked down a pixel at a time while the grid
 * is still drawn, the other held.
 *
 * @param {Array<object>} groups - The layout's groups.
 * @returns {{width: number, height: number}} The least width and height.
 */
function walkedLeast(groups) {
    const START_WIDTH_PX = 3840;
    const START_HEIGHT_PX = 2160;
    const isDrawn = (width, height) => cockpitGrid.isCockpitGridDrawable({x: 0, y: 0, width, height}, groups);
    let width = START_WIDTH_PX;
    while (width > 0 && isDrawn(width - 1, START_HEIGHT_PX))
        width -= 1;
    let height = START_HEIGHT_PX;
    while (height > 0 && isDrawn(START_WIDTH_PX, height - 1))
        height -= 1;
    return {width, height};
}

test('cockpitGrid: the least work area is what a one-pixel walk down finds, and a layout of 200 000 groups costs ' +
    'no walk and no throw', () => {
    const MANY_GROUP_COUNT = 200000;
    const differsFromAWalk = Object.entries({template: TEMPLATE_GROUPS, ...LAYOUTS})
        .filter(([, groups]) => JSON.stringify(cockpitGrid.leastDrawableWorkArea(groups)) !==
            JSON.stringify(walkedLeast(groups)))
        .map(([layoutName]) => layoutName);
    const manyGroups = Array.from({length: MANY_GROUP_COUNT}, (_unused, index) =>
        ({id: `g${index}`, caption: 'G', columns: 1, cards: ['system']}));
    assertEqual({
        differsFromAWalk,
        manyGroupsDrawnAtFullHd: isDrawableAt(1920, 1080, manyGroups),
        manyGroupsLeast: cockpitGrid.leastDrawableWorkArea(manyGroups),
        manyGroupsCellCount: cockpitGrid.cockpitGridGeometry({workArea: FULL_HD, groups: manyGroups}).cells.length,
    }, {
        differsFromAWalk: [], manyGroupsDrawnAtFullHd: false, manyGroupsLeast: {width: 87805694, height: 336},
        manyGroupsCellCount: MANY_GROUP_COUNT,
    });
});

test('cockpitGrid: a group of no column beside others counts no inner gutter, so one pixel at a time a drawn grid is ' +
    'never lost as the work area grows, and the least work area is what a one-pixel walk down finds', () => {
    const zeroColumnGroups = count => Array.from({length: count}, (_unused, index) =>
        ({id: `z${index}`, caption: 'Z', columns: 0, cards: []}));
    const mixedLayouts = {
        fiveEmptyAndTwoColumns: [
            ...zeroColumnGroups(5), {id: 'g', caption: 'G', columns: 2, cards: ['system', 'apps']},
        ],
        threeEmptyAndOneColumn: [...zeroColumnGroups(3), {id: 'g', caption: 'G', columns: 1, cards: ['system']}],
        fiveEmpty: zeroColumnGroups(5),
    };
    const HELD_HEIGHTS_PX = [332, 336, 636, 644, 1080];
    const faults = [];
    for (const [layoutName, groups] of Object.entries(mixedLayouts)) {
        for (const height of HELD_HEIGHTS_PX) {
            let wasDrawn = false;
            for (const width of lengthsFrom(0, 2400)) {
                const isDrawn = cockpitGrid.isCockpitGridDrawable({x: 0, y: 0, width, height}, groups);
                if (wasDrawn && !isDrawn)
                    faults.push(`${layoutName} at ${width}x${height}`);
                wasDrawn = isDrawn;
            }
        }
    }
    const differsFromAWalk = Object.entries(mixedLayouts)
        .filter(([, groups]) => JSON.stringify(cockpitGrid.leastDrawableWorkArea(groups)) !==
            JSON.stringify(walkedLeast(groups)))
        .map(([layoutName]) => layoutName);
    assertEqual({faults, differsFromAWalk}, {faults: [], differsFromAWalk: []});
});

test('cockpitGrid: a layout whose frame is wider than a double can count to the pixel (a group of ' +
    'Number.MAX_SAFE_INTEGER columns) still gets its least work area and journal line at once, never an endless search',
() => {
    const hugeColumns = [{id: 'g', caption: 'G', columns: Number.MAX_SAFE_INTEGER, cards: ['system']}];
    const least = cockpitGrid.leastDrawableWorkArea(hugeColumns);
    const line = cockpitGrid.cockpitGridTooSmallLine(FULL_HD, hugeColumns);
    assertEqual({
        isDrawnAtFullHd: isDrawableAt(1920, 1080, hugeColumns),
        isLeastWidthFinite: Number.isFinite(least.width) && least.width > 1920,
        leastHeight: least.height,
        namesTheWidth: line.includes(' px wide for this layout (it is 1920x1080)'),
    }, {isDrawnAtFullHd: false, isLeastWidthFinite: true, leastHeight: 336, namesTheWidth: true});
});
