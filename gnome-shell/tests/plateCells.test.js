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
const NOTHING_LIT = {litCaptions: [], waitingCount: 0, isMachineStale: false, isAgentsStale: false, staleSources: null};
/** Made-up text widths, odd so a sum that drops or doubles one is seen. */
const GROUP_CAPTION_WIDTHS_PX = {Machine: 61, Agents: 53, Desk: 37, Load: 41, Links: 43};
const ANNUNCIATOR_WIDTHS_PX = {
    [CPU_WAIT]: 57, [MEM_WAIT]: 61, [IO_WAIT]: 47, [SWAPPING]: 67, [OFFLINE]: 55, [MOUNT]: 45, [STALE]: 41,
};
const COUNT_SLOT_WIDTH_PX = 137;

/**
 * Each group's cells, as plateCellsOf gives them.
 *
 * @param {object[]} groups - The layout's groups.
 * @param {object} lights - What is lit.
 * @param {boolean} [isLegendShort] - The short form.
 * @returns {Array<object|null>} One entry a group: its cells, or null where it has no plate.
 */
function cellsByGroup(groups, lights, isLegendShort = false) {
    const drawnCardIds = drawnCardIdsByGroup(groups);
    return plateCaptionsByGroup(groups).map((plateCaptions, groupIndex) => plateCaptions === null
        ? null
        : plateCells.plateCellsOf({plateCaptions, drawnCardIds: drawnCardIds[groupIndex], lights, isLegendShort}));
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
    assertEqual(cellsByGroup(TEMPLATE_GROUPS, {...NOTHING_LIT, litCaptions: [IO_WAIT], waitingCount: 2}), [
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
        everyLit: shownShapesByGroup(TEMPLATE_GROUPS, {
            litCaptions: [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT], waitingCount: 5,
            isMachineStale: true, isAgentsStale: true, staleSources: null,
        }),
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
        const [, agentsPlate] = cellsByGroup(TEMPLATE_GROUPS, {...NOTHING_LIT, waitingCount});
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
    assertEqual(shownShapesByGroup(SPLIT_GROUPS, {
        ...NOTHING_LIT, litCaptions: [OFFLINE, MOUNT, CPU_WAIT], waitingCount: 3,
    }), [
        [`${CPU_WAIT} ${OUTLINE}`, `${MEM_WAIT} ${UNLIT}`, `${IO_WAIT} ${UNLIT}`, `${SWAPPING} ${UNLIT}`,
            `${STALE} ${UNLIT}`],
        [`${OFFLINE} ${OUTLINE}`, `${MOUNT} ${OUTLINE}`, `${WAITING_ON_YOU} ${FILLED}`, `${STALE} ${UNLIT}`],
    ]));

test('plateCells: told no stale sources, Machine stale lights the Stale of every plate drawing a machine tile and ' +
    'Agents stale of every plate drawing Sessions; a layout of one group lights its one Stale for either', () =>
    assertEqual({
        templateMachine: staleShapes(TEMPLATE_GROUPS, {...NOTHING_LIT, isMachineStale: true}),
        templateAgents: staleShapes(TEMPLATE_GROUPS, {...NOTHING_LIT, isAgentsStale: true}),
        oneGroup: [{isMachineStale: true}, {isAgentsStale: true}, {}].map(stale =>
            staleShapes(ONE_GROUP, {...NOTHING_LIT, ...stale})[0]),
        // The sampler gone silent lights the links group's Stale too: the gap the sources close.
        splitMachine: staleShapes(SPLIT_GROUPS, {...NOTHING_LIT, isMachineStale: true}),
    }, {
        templateMachine: [OUTLINE, UNLIT], templateAgents: [UNLIT, OUTLINE], oneGroup: [OUTLINE, OUTLINE, UNLIT],
        splitMachine: [OUTLINE, OUTLINE],
    }));

test('plateCells: told the stale sources, a plate\'s Stale is lit only where one of its tiles reads from one of them, ' +
    'whatever the two flags say', () =>
    assertEqual([
        ['sampler'], ['network'], ['mounts'], ['sessions'], ['network', 'sampler'], [], ['radio'],
    ].map(staleSources => staleShapes(SPLIT_GROUPS, {
        ...NOTHING_LIT, isMachineStale: true, isAgentsStale: true, staleSources,
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
    const someLit = {...NOTHING_LIT, litCaptions: [MOUNT, IO_WAIT], waitingCount: 2};
    const everyLit = {
        litCaptions: [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT], waitingCount: 1, isMachineStale: true,
        isAgentsStale: false, staleSources: null,
    };
    assertEqual({
        someLit: shownShapesByGroup(ONE_GROUP, someLit, true),
        noneLit: shownShapesByGroup(ONE_GROUP, NOTHING_LIT, true),
        everyLitCount: shownShapesByGroup(ONE_GROUP, everyLit, true)[0].length,
        fullCount: shownShapesByGroup(ONE_GROUP, NOTHING_LIT, false)[0].length,
        caption: cellsByGroup(ONE_GROUP, NOTHING_LIT, true)[0].groupCaptionText,
    }, {
        someLit: [[`${IO_WAIT} ${OUTLINE}`, `${MOUNT} ${OUTLINE}`, `${WAITING_ON_YOU} ${FILLED}`]],
        noneLit: [[]], everyLitCount: 8, fullCount: 8, caption: 'DESK',
    });
});

test('plateCells: lights that are missing or odd light nothing, and never throw: none, an empty object, captions ' +
    'that are not a list, unknown captions; a caption named twice is lit once; "Waiting on you" and Stale named in ' +
    'the list light nothing, since the count and the stale flags light them', () => {
    const shapesOf = lights => shownShapesByGroup(TEMPLATE_GROUPS, lights).flat()
        .filter(words => !words.endsWith(UNLIT));
    assertEqual({
        odd: [null, undefined, {}, {litCaptions: 'IO wait'}, {litCaptions: [null, 'Radio', 7]}, 5].map(shapesOf),
        twice: shapesOf({...NOTHING_LIT, litCaptions: [IO_WAIT, IO_WAIT]}),
        byName: shapesOf({...NOTHING_LIT, litCaptions: [WAITING_ON_YOU, STALE]}),
        staleSourcesNotAList: shapesOf({...NOTHING_LIT, isMachineStale: true, staleSources: 'sampler'}),
    }, {
        odd: [[], [], [], [], [], []], twice: [`${IO_WAIT} ${OUTLINE}`], byName: [],
        staleSourcesNotAList: [`${STALE} ${OUTLINE}`],
    });
});

test('plateCells: a group caption that is empty stays empty; the cells follow the plate\'s places, not the lights\' ' +
    'order', () =>
    assertEqual({
        empty: plateCells.plateCellsOf({
            plateCaptions: {groupCaption: '', captions: [STALE]}, drawnCardIds: new Set(['apps']),
            lights: NOTHING_LIT, isLegendShort: false,
        }).groupCaptionText,
        order: shownShapesByGroup(TEMPLATE_GROUPS, {...NOTHING_LIT, litCaptions: [MOUNT, CPU_WAIT]}, true)[0],
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
