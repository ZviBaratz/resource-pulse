// lib/plateCells.js: what each cell of a caption plate shows, from the plate's captions and what is lit.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as plateCells from '../extensions/resource-pulse@zvibaratz.github.io/lib/plateCells.js';
import {
    PlateCaption, drawnCardIdsByGroup, plateCaptionsByGroup,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/plateCaptions.js';
import {
    COUNT_SLOT_SAMPLE_TEXT, plateLegendWidthsPx,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/measuredLengths.js';
import {cockpitCaptionText} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitFormat.js';
import {
    CaptionSource, CockpitCaption, litCaptionsOf,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCaptions.js';
import {MachineCaption} from '../extensions/resource-pulse@zvibaratz.github.io/lib/machineCaptions.js';

const {CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT, WAITING_ON_YOU, STALE} = PlateCaption;
const UNLIT = 'unlit';
const OUTLINE = 'outline';
const FILLED = 'filled';
const MACHINE_CARD_IDS = ['system', 'apps', 'connections'];
const AGENTS_CARD_IDS = ['sessions'];
/** The template's two groups, and a layout of one group drawing every card. */
const TEMPLATE_GROUPS = [
    {id: 'machine', caption: 'Machine', columns: 1, cards: MACHINE_CARD_IDS},
    {id: 'agents', caption: 'Agents', columns: 1, cards: AGENTS_CARD_IDS},
];
const ONE_GROUP = [{id: 'all', caption: 'Desk', columns: 1, cards: [...MACHINE_CARD_IDS, ...AGENTS_CARD_IDS]}];
/** The machine's tiles split: the sampler's two in one group, Connections beside Sessions in the other. */
const SPLIT_GROUPS = [
    {id: 'sampler', caption: 'Load', columns: 1, cards: ['system', 'apps']},
    {id: 'links', caption: 'Links', columns: 1, cards: ['connections', 'sessions']},
];
const {MACHINE_STALE} = MachineCaption;
const {AGENTS_STALE} = CockpitCaption;

/**
 * What is lit, as the indicator joins the machine's captions and the cockpit's half (lib/cockpitCaptions.js
 * litCaptionsOf): the plate reads the same answer.
 *
 * @param {object} [halves] - What each half lights.
 * @param {string[]} [halves.machineCaptions] - The machine's lit captions.
 * @param {string[]} [halves.cockpitCaptions] - The cockpit's lit captions.
 * @param {*} [halves.waitingCount] - The sessions waiting on you.
 * @param {string[]} [halves.staleSourceIds] - The cockpit's stale sources.
 * @returns {object} The joined answer (CaptionsLit).
 */
function litBy({machineCaptions = [], cockpitCaptions = [], waitingCount = 0, staleSourceIds = []} = {}) {
    return litCaptionsOf({machineCaptions, cockpitCaptions: {captions: cockpitCaptions, waitingCount, staleSourceIds}});
}

const NOTHING_LIT = litBy();
/** Made-up text widths, odd so a sum that drops or doubles one is seen. */
const GROUP_CAPTION_WIDTHS_PX = {Machine: 61, Agents: 53, Desk: 37, Load: 41, Links: 43};
const ANNUNCIATOR_WIDTHS_PX = {
    [CPU_WAIT]: 57, [MEM_WAIT]: 61, [IO_WAIT]: 47, [SWAPPING]: 67, [OFFLINE]: 55, [MOUNT]: 45, [STALE]: 41,
};
const COUNT_SLOT_WIDTH_PX = 137;
/** A layout as the composition gives one: the full form, a cell 18 px tall, the count slot measured. */
const MEASURED_LAYOUT = Object.freeze({
    widthPx: 600, heightPx: 26, isLegendShort: false, countSlotWidthPx: COUNT_SLOT_WIDTH_PX, cellHeightPx: 18,
});

/**
 * Each group's cells, as plateCellsOf gives them.
 *
 * @param {object[]} groups - The layout's groups.
 * @param {object} lights - What is lit.
 * @param {boolean} [isLegendShort] - The short form.
 * @returns {Array<object|null>} One entry a group: its cells, or null where it has no plate.
 */
function cellsByGroup(groups, lights, isLegendShort = false) {
    const layout = {...MEASURED_LAYOUT, isLegendShort};
    return plateCaptionsByGroup(groups).map(plateCaptions => plateCaptions === null
        ? null
        : plateCells.plateCellsOf({plateCaptions, lights, layout}));
}

/**
 * A cell's words, shape and whether it is shown, without how it is drawn.
 *
 * @param {object} cell - A cell, as plateCellsOf gives it.
 * @returns {object} Its caption, words, shape and isShown.
 */
function lookOf({plateCaption, text, shape, isShown}) {
    return {plateCaption, text, shape, isShown};
}

/**
 * Each group's cells, as `caption shape` words, shown cells only.
 *
 * @param {object[]} groups - The layout's groups.
 * @param {object} lights - What is lit.
 * @param {boolean} [isLegendShort] - The short form.
 * @returns {Array<string[]|null>} One entry a group.
 */
function shownShapesByGroup(groups, lights, isLegendShort = false) {
    return cellsByGroup(groups, lights, isLegendShort).map(plate => plate === null ? null : plate.cells
        .filter(cell => cell.isShown).map(cell => `${cell.plateCaption} ${cell.shape}`));
}

/**
 * Each group's Stale cell's shape.
 *
 * @param {object[]} groups - The layout's groups.
 * @param {object} lights - What is lit.
 * @returns {string[]} One shape a group that has a plate.
 */
function staleShapes(groups, lights) {
    return cellsByGroup(groups, lights).filter(plate => plate !== null)
        .map(plate => plate.cells.find(cell => cell.plateCaption === STALE).shape);
}

test('plateCells: the template, IO wait lit and two waiting: an amber outline, a filled "2 WAITING ON YOU", every ' +
    'other cell unlit, each in its place and upper-cased', () =>
    assertEqual(cellsByGroup(TEMPLATE_GROUPS, litBy({
        machineCaptions: [IO_WAIT], cockpitCaptions: [WAITING_ON_YOU], waitingCount: 2,
    })).map(({groupCaptionText, cells}) => ({groupCaptionText, cells: cells.map(lookOf)})), [
        {groupCaptionText: 'MACHINE', cells: [
            {plateCaption: CPU_WAIT, text: 'CPU WAIT', shape: UNLIT, isShown: true},
            {plateCaption: MEM_WAIT, text: 'MEM WAIT', shape: UNLIT, isShown: true},
            {plateCaption: IO_WAIT, text: 'IO WAIT', shape: OUTLINE, isShown: true},
            {plateCaption: SWAPPING, text: 'SWAPPING', shape: UNLIT, isShown: true},
            {plateCaption: OFFLINE, text: 'OFFLINE', shape: UNLIT, isShown: true},
            {plateCaption: MOUNT, text: 'MOUNT', shape: UNLIT, isShown: true},
            {plateCaption: STALE, text: 'STALE', shape: UNLIT, isShown: true},
        ]},
        {groupCaptionText: 'AGENTS', cells: [
            {plateCaption: WAITING_ON_YOU, text: '2 WAITING ON YOU', shape: FILLED, isShown: true},
            {plateCaption: STALE, text: 'STALE', shape: UNLIT, isShown: true},
        ]},
    ]));

test('plateCells: every caption lit is an outline but "Waiting on you", filled; with nothing lit every cell is unlit',
    () => assertEqual({
        everyLit: shownShapesByGroup(TEMPLATE_GROUPS, litBy({
            machineCaptions: [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, MACHINE_STALE],
            cockpitCaptions: [WAITING_ON_YOU, OFFLINE, MOUNT, AGENTS_STALE], waitingCount: 5,
            staleSourceIds: [CaptionSource.SESSIONS],
        })),
        noneLit: shownShapesByGroup(TEMPLATE_GROUPS, NOTHING_LIT),
    }, {
        everyLit: [
            [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT, STALE].map(caption => `${caption} ${OUTLINE}`),
            [`${WAITING_ON_YOU} ${FILLED}`, `${STALE} ${OUTLINE}`],
        ],
        noneLit: [
            [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT, STALE].map(caption => `${caption} ${UNLIT}`),
            [`${WAITING_ON_YOU} ${UNLIT}`, `${STALE} ${UNLIT}`],
        ],
    }));

test('plateCells: "Waiting on you" is lit by a whole count of 1 or more, which it says up to 99 and from 100 says ' +
    '99; any other count leaves it unlit, in its unlit words', () =>
    assertEqual([0, 1, 2, 99, 100, 1000, null, undefined, NaN, -1, 2.5, '3', Infinity].map(waitingCount => {
        const waitingLit = litBy({cockpitCaptions: [WAITING_ON_YOU], waitingCount});
        const [, agentsPlate] = cellsByGroup(TEMPLATE_GROUPS, waitingLit);
        const {text, shape} = agentsPlate.cells[0];
        return `${text} ${shape}`;
    }), [
        'WAITING ON YOU unlit', '1 WAITING ON YOU filled', '2 WAITING ON YOU filled', '99 WAITING ON YOU filled',
        '99 WAITING ON YOU filled', '99 WAITING ON YOU filled', 'WAITING ON YOU unlit', 'WAITING ON YOU unlit',
        'WAITING ON YOU unlit', 'WAITING ON YOU unlit', 'WAITING ON YOU unlit', 'WAITING ON YOU unlit',
        'WAITING ON YOU unlit',
    ]));

test('plateCells: the widest count the cell says is the count slot\'s sample, so the measured slot holds every ' +
    'count it draws', () =>
    assertEqual({
        widest: plateCells.waitingCaptionText(plateCells.MOST_WAITING_COUNT_SHOWN).length,
        slotSample: cockpitCaptionText(COUNT_SLOT_SAMPLE_TEXT).length,
        mostShown: plateCells.MOST_WAITING_COUNT_SHOWN,
        unlit: plateCells.waitingCaptionText(null),
    }, {widest: 17, slotSample: 17, mostShown: 99, unlit: 'WAITING ON YOU'}));

test('plateCells: a caption lit whose evidence the group does not draw lights nothing there: Offline and Mount on the ' +
    'sampler\'s group, the pressures and Swapping on the links group', () =>
    assertEqual(shownShapesByGroup(SPLIT_GROUPS, litBy({
        machineCaptions: [CPU_WAIT], cockpitCaptions: [WAITING_ON_YOU, OFFLINE, MOUNT], waitingCount: 3,
    })), [
        [`${CPU_WAIT} ${OUTLINE}`, `${MEM_WAIT} ${UNLIT}`, `${IO_WAIT} ${UNLIT}`, `${SWAPPING} ${UNLIT}`,
            `${STALE} ${UNLIT}`],
        [`${WAITING_ON_YOU} ${FILLED}`, `${OFFLINE} ${OUTLINE}`, `${MOUNT} ${OUTLINE}`, `${STALE} ${UNLIT}`],
    ]));

test('plateCells: a plate\'s Stale follows the sources the lit Stale captions stand for: Machine stale of a silent ' +
    'sampler lights the plates drawing the system or apps card, of the network the plate drawing Connections, and ' +
    'Agents stale the plate drawing Sessions; a layout of one group lights its one Stale for any', () => {
    const staleLights = [
        litBy({machineCaptions: [MACHINE_STALE]}),
        litBy({cockpitCaptions: [MACHINE_STALE], staleSourceIds: [CaptionSource.NETWORK]}),
        litBy({cockpitCaptions: [AGENTS_STALE], staleSourceIds: [CaptionSource.SESSIONS]}),
        NOTHING_LIT,
    ];
    assertEqual({
        template: staleLights.map(lights => staleShapes(TEMPLATE_GROUPS, lights)),
        split: staleLights.map(lights => staleShapes(SPLIT_GROUPS, lights)),
        oneGroup: staleLights.map(lights => staleShapes(ONE_GROUP, lights)[0]),
    }, {
        template: [[OUTLINE, UNLIT], [OUTLINE, UNLIT], [UNLIT, OUTLINE], [UNLIT, UNLIT]],
        split: [[OUTLINE, UNLIT], [UNLIT, OUTLINE], [UNLIT, OUTLINE], [UNLIT, UNLIT]],
        oneGroup: [OUTLINE, OUTLINE, OUTLINE, UNLIT],
    });
});

test('plateCells: a plate\'s Stale is lit only where one of its tiles reads from a stale source, whichever Stale ' +
    'caption is lit', () =>
    assertEqual([
        ['sampler'], ['network'], ['mounts'], ['sessions'], ['network', 'sampler'], [], ['radio'],
    ].map(staleSourceIds => staleShapes(SPLIT_GROUPS, {
        ...NOTHING_LIT, captions: [MACHINE_STALE, AGENTS_STALE], staleSourceIds,
    })), [
        [OUTLINE, UNLIT], [UNLIT, OUTLINE], [UNLIT, OUTLINE], [UNLIT, OUTLINE], [OUTLINE, OUTLINE], [UNLIT, UNLIT],
        [UNLIT, UNLIT],
    ]));

test('plateCells: each card reads from its sources: the sampler for the system and apps cards, the service\'s for ' +
    'the others', () =>
    assertEqual(['system', 'apps', 'connections', 'sessions', 'clock'].map(cardId =>
        plateCells.sourceNamesOfCard(cardId)), [['sampler'], ['sampler'], ['network', 'mounts'], ['sessions'], []]));

test('plateCells: the short form shows the group caption and the lit cells only, in their places; with nothing lit, ' +
    'none; the full form shows every cell', () => {
    const someLit = litBy({machineCaptions: [IO_WAIT], cockpitCaptions: [WAITING_ON_YOU, MOUNT], waitingCount: 2});
    const everyLit = litBy({
        machineCaptions: [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, MACHINE_STALE],
        cockpitCaptions: [WAITING_ON_YOU, OFFLINE, MOUNT], waitingCount: 1,
    });
    assertEqual({
        someLit: shownShapesByGroup(ONE_GROUP, someLit, true),
        noneLit: shownShapesByGroup(ONE_GROUP, NOTHING_LIT, true),
        everyLitCount: shownShapesByGroup(ONE_GROUP, everyLit, true)[0].length,
        fullCount: shownShapesByGroup(ONE_GROUP, NOTHING_LIT, false)[0].length,
        caption: cellsByGroup(ONE_GROUP, NOTHING_LIT, true)[0].groupCaptionText,
    }, {
        someLit: [[`${WAITING_ON_YOU} ${FILLED}`, `${IO_WAIT} ${OUTLINE}`, `${MOUNT} ${OUTLINE}`]],
        noneLit: [[]], everyLitCount: 8, fullCount: 8, caption: 'DESK',
    });
});

test('plateCells: lights that are missing or odd light nothing, and never throw: none, an empty object, captions ' +
    'that are not a list, unknown captions; a caption named twice is lit once; "Waiting on you" and Stale named in ' +
    'the list light nothing, since the count and the stale sources light them; stale sources that are not a list ' +
    'light no Stale', () => {
    const shapesOf = lights => shownShapesByGroup(TEMPLATE_GROUPS, lights).flat()
        .filter(words => !words.endsWith(UNLIT));
    assertEqual({
        odd: [null, undefined, {}, {captions: 'IO wait'}, {captions: [null, 'Radio', 7]}, 5].map(shapesOf),
        twice: shapesOf({...NOTHING_LIT, captions: [IO_WAIT, IO_WAIT]}),
        byName: shapesOf({...NOTHING_LIT, captions: [WAITING_ON_YOU, STALE]}),
        staleSourcesNotAList: shapesOf({...NOTHING_LIT, captions: [MACHINE_STALE], staleSourceIds: 'sampler'}),
    }, {
        odd: [[], [], [], [], [], []], twice: [`${IO_WAIT} ${OUTLINE}`], byName: [], staleSourcesNotAList: [],
    });
});

test('plateCells: a group caption that is empty stays empty; the cells follow the plate\'s places, not the lights\' ' +
    'order', () =>
    assertEqual({
        empty: plateCells.plateCellsOf({
            plateCaptions: {groupCaption: '', captions: [STALE], drawnCardIds: ['apps']}, lights: NOTHING_LIT,
            layout: MEASURED_LAYOUT,
        }).groupCaptionText,
        order: shownShapesByGroup(TEMPLATE_GROUPS, {...NOTHING_LIT, captions: [MOUNT, CPU_WAIT]}, true)[0],
    }, {empty: '', order: [`${CPU_WAIT} ${OUTLINE}`, `${MOUNT} ${OUTLINE}`]}));

test('plateCaptions: the cards each group draws, which a plate\'s cells read: each card once, at its first place', () =>
    assertEqual(drawnCardIdsByGroup([
        {cards: ['apps', 'apps', 'clock']}, {cards: ['apps', 'sessions']}, null, {cards: 'system'},
    ]).map(cardIds => [...cardIds]), [['apps'], ['sessions'], [], []]));

test('plateCells: a plate drawn with the plate\'s own lengths is its measured legend: its border, paddings, the ' +
    'caption\'s gap, each cell\'s gap, border and padding, and the count slot as one border box', () => {
    const lengths = plateCells.PLATE_BOX_LENGTHS_PX;
    const cellBorderBoxPx = textPx => lengths.cellGapPx + 2 * lengths.cellBorderPx + 2 * lengths.cellPaddingPx + textPx;
    const slotContentPx = plateCells.countSlotContentWidthPx(COUNT_SLOT_WIDTH_PX);
    const drawnWidthPx = ({groupCaption, captions}) => 2 * lengths.plateBorderPx + lengths.plateStartPaddingPx +
        GROUP_CAPTION_WIDTHS_PX[groupCaption] + lengths.groupCaptionGapPx + captions.reduce((totalPx, caption) =>
        totalPx + cellBorderBoxPx(caption === WAITING_ON_YOU
            ? slotContentPx : ANNUNCIATOR_WIDTHS_PX[caption]), 0) + lengths.plateEndPaddingPx;
    const groupsList = [TEMPLATE_GROUPS, ONE_GROUP, SPLIT_GROUPS];
    const captionWidths = {
        annunciatorWidthsPx: ANNUNCIATOR_WIDTHS_PX, countSlotWidthPx: COUNT_SLOT_WIDTH_PX,
        groupCaptionWidthsPx: GROUP_CAPTION_WIDTHS_PX,
    };
    assertEqual({
        drawn: groupsList.map(groups => plateCaptionsByGroup(groups).map(drawnWidthPx)),
        cellPaddingWithBorder: lengths.cellBorderPx + lengths.cellPaddingPx,
        badSlots: [null, NaN, 15, 16, '137'].map(plateCells.countSlotContentWidthPx),
    }, {
        drawn: groupsList.map(groups => plateLegendWidthsPx(groups, captionWidths)),
        cellPaddingWithBorder: 8,
        badSlots: [null, null, null, null, null],
    });
});

test('plateCells: each shape\'s class on a cell: unlit, the lit outline and the filled cell, each the plates\' own; ' +
    'every cell carries its shape\'s', () => {
    const [machinePlate, agentsPlate] = cellsByGroup(TEMPLATE_GROUPS, litBy({
        machineCaptions: [IO_WAIT], cockpitCaptions: [WAITING_ON_YOU], waitingCount: 2,
    }));
    assertEqual({
        classes: plateCells.CELL_SHAPE_STYLE_CLASSES,
        machine: machinePlate.cells.map(cell => cell.shapeStyleClass),
        agents: agentsPlate.cells.map(cell => cell.shapeStyleClass),
    }, {
        classes: {
            [UNLIT]: 'rp-plate-cell-unlit', [OUTLINE]: 'rp-plate-cell-outline', [FILLED]: 'rp-plate-cell-filled',
        },
        machine: ['rp-plate-cell-unlit', 'rp-plate-cell-unlit', 'rp-plate-cell-outline', 'rp-plate-cell-unlit',
            'rp-plate-cell-unlit', 'rp-plate-cell-unlit', 'rp-plate-cell-unlit'],
        agents: ['rp-plate-cell-filled', 'rp-plate-cell-unlit'],
    });
});

test('plateCells: a shown cell\'s lengths are its gap, its 1 px border, its padding (8 px less the border), its ' +
    'height (the measured cell\'s less its borders) and, for "Waiting on you", the count slot\'s width less its ' +
    'border and padding; with a length unknown, or no room for its content, that length is left out; in the short ' +
    'form an unlit cell takes no room at all', () => {
    const lit = litBy({machineCaptions: [IO_WAIT], cockpitCaptions: [WAITING_ON_YOU], waitingCount: 2});
    const lengthsOf = (layout, plateCaption) => plateCells.plateCellsOf({
        plateCaptions: plateCaptionsByGroup(ONE_GROUP)[0], lights: lit, layout,
    }).cells.find(cell => cell.plateCaption === plateCaption).cellLengthsPx;
    const boxLengthsPx = {'margin-left': 2, 'border-width': 1, 'padding-left': 7, 'padding-right': 7};
    assertEqual({
        measured: [IO_WAIT, WAITING_ON_YOU, CPU_WAIT].map(caption => lengthsOf(MEASURED_LAYOUT, caption)),
        unknown: [null, {...MEASURED_LAYOUT, countSlotWidthPx: null, cellHeightPx: null}].map(layout =>
            [IO_WAIT, WAITING_ON_YOU].map(caption => lengthsOf(layout, caption))),
        noContentRoom: [2, 1, NaN, '18'].map(cellHeightPx => lengthsOf({...MEASURED_LAYOUT, cellHeightPx}, IO_WAIT)),
        short: [IO_WAIT, WAITING_ON_YOU, CPU_WAIT].map(caption =>
            lengthsOf({...MEASURED_LAYOUT, isLegendShort: true}, caption)),
    }, {
        measured: [
            {...boxLengthsPx, height: 16}, {...boxLengthsPx, height: 16, width: 121}, {...boxLengthsPx, height: 16},
        ],
        unknown: [[boxLengthsPx, boxLengthsPx], [boxLengthsPx, boxLengthsPx]],
        noContentRoom: [boxLengthsPx, boxLengthsPx, boxLengthsPx, boxLengthsPx],
        short: [
            {...boxLengthsPx, height: 16}, {...boxLengthsPx, height: 16, width: 121},
            {'margin-left': 0, 'border-width': 0, 'padding-left': 0, 'padding-right': 0, width: 0},
        ],
    });
});

test('plateCells: a plate\'s cards come with its captions, one value a plate (lib/plateCaptions.js); cards that are ' +
    'missing or not a list light no Stale, and never throw', () => {
    const samplerStale = litBy({machineCaptions: [MACHINE_STALE]});
    const staleOf = drawnCardIds => plateCells.plateCellsOf({
        plateCaptions: {groupCaption: 'Machine', captions: [STALE], drawnCardIds}, lights: samplerStale,
        layout: MEASURED_LAYOUT,
    }).cells[0].shape;
    assertEqual({
        cards: plateCaptionsByGroup(TEMPLATE_GROUPS).map(plateCaptions => plateCaptions.drawnCardIds),
        stale: [['system'], undefined, null, 'system', {system: true}].map(staleOf),
    }, {
        cards: [MACHINE_CARD_IDS, AGENTS_CARD_IDS],
        stale: [OUTLINE, UNLIT, UNLIT, UNLIT, UNLIT],
    });
});
