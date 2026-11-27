// lib/cockpitComposition.js: what it gives for layouts, sizes, legends and work areas that no config would give, or
// that a caller changed in place, and lib/cockpitCompositionGroups.js: which tiles a layout draws.
import {test, assertEqual} from './harness.js';
import {COCKPIT_DRAWN_CARD_IDS} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';
import {cockpitComposition} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitComposition.js';
import {
    COCKPIT_TILE_CARD_ID, drawnCockpitGroups,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionGroups.js';
import {DEFAULT_COCKPIT_SIZES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionSizes.js';
import {
    LAYOUTS, TEMPLATE_GROUPS, composeAt, copyOfDefaultSizes, countReadsOf, layoutOf, placementsOf, sizeAndFormOf,
    tileOf,
} from './cockpitCompositionFixtures.js';

/** The furthest a work area may reach from the stage's origin, or be long: 2^24. */
const MOST_COORDINATE_PX = 16777216;
/** The longest a length in the sizes may be. */
const MOST_LENGTH_PX = 32768;
/** The most rows a ranking may be asked for. */
const MOST_RANKING_ROW_COUNT = 16;
/** The most columns Sessions may take in one row. */
const MOST_ONE_ROW_SESSIONS_COLUMN_COUNT = 6;
/** Gaps around a pair by the million: a list whose length the sizes' check must not walk. */
const MANY_PAIR_GAP_COUNT = 1000000;
/** A legend wider than the template's machine column on 1500 x 1080, which widens it. */
const WIDE_LEGEND_PX = 900;
const FULL_HD = Object.freeze({x: 0, y: 0, width: 1920, height: 1080});
/** The two screens each odd layout is composed on: a desk, and a small portrait monitor. */
const DESK_AND_PORTRAIT = Object.freeze([[1920, 1080], [720, 1280]]);
const MANY_GROUP_COUNT = 200000;

/**
 * @param {object} composition - A composition.
 * @returns {Array<string>} Its rectangles as `<card id> x,y widthxheight <form>`, without the groups' places: what
 *     two compositions of layouts that differ only in groups that draw nothing have in common.
 */
function rectanglesOf(composition) {
    const {plates, tiles} = placementsOf(composition);
    return [...plates.map(plate => plate.replace(/^\S+ /, '')), ...tiles];
}

/**
 * @param {function(number, number): *} describeAt - What a row reads of the composition on a work area of a size.
 * @returns {Array<*>} What it reads on the desk and on the portrait monitor, in that order.
 */
function onDeskAndPortrait(describeAt) {
    return DESK_AND_PORTRAIT.map(([width, height]) => describeAt(width, height));
}

// ---------------------------------------------------------------------------------------------------------------
// Odd layouts
// ---------------------------------------------------------------------------------------------------------------

test('cockpitComposition inputs: a layout of no group, or groups that are not a list, draws no tile', () => {
    assertEqual([[], null, undefined, 'machine', 7, {}].map(groups => cockpitComposition({workArea: FULL_HD, groups}).reason),
        ['no-tile', 'no-tile', 'no-tile', 'no-tile', 'no-tile', 'no-tile']);
});

test('cockpitComposition inputs: a group of no column is drawn as any other, since a group\'s columns arrange ' +
    'nothing', () => {
    const groups = [{...TEMPLATE_GROUPS[0], columns: 0}, TEMPLATE_GROUPS[1]];
    assertEqual(onDeskAndPortrait((width, height) => placementsOf(composeAt(width, height, {groups}))),
        onDeskAndPortrait((width, height) => placementsOf(composeAt(width, height))));
});

test('cockpitComposition inputs: a group of no card beside the template adds nothing: the template\'s composition, ' +
    'to the pixel', () => {
    const groups = [{id: 'empty', caption: 'EMPTY', columns: 2, cards: []}, ...TEMPLATE_GROUPS];
    assertEqual({
        onDesk: rectanglesOf(composeAt(1920, 1080, {groups})), onPortrait: rectanglesOf(composeAt(720, 1280, {groups})),
    }, {onDesk: rectanglesOf(composeAt(1920, 1080)), onPortrait: rectanglesOf(composeAt(720, 1280))});
});

test('cockpitComposition inputs: a layout of card ids the cockpit does not know draws no tile', () => {
    assertEqual(onDeskAndPortrait((width, height) => composeAt(width, height, {groups: layoutOf(['weather', 'stocks'])}).reason),
        ['no-tile', 'no-tile']);
});

test('cockpitComposition inputs: a card named twice is drawn once, at its first place, and a second group then ' +
    'draws only what is left to it', () => {
    const groups = [
        {id: 'a', caption: 'A', columns: 2, cards: ['apps', 'apps', 'system']},
        {id: 'b', caption: 'B', columns: 1, cards: ['system', 'sessions']},
    ];
    const tilesAt = (width, height) => composeAt(width, height, {groups}).tiles.map(tile => `${tile.cardId} in ${tile.groupId}`);
    assertEqual(onDeskAndPortrait(tilesAt), [['apps in a', 'system in a', 'sessions in b'], ['apps in a', 'system in a', 'sessions in b']]);
});

test('cockpitComposition inputs: two groups of one id are two plates, told apart by their place in the layout', () => {
    const groups = [
        {id: 'same', caption: 'A', columns: 1, cards: ['system', 'apps']},
        {id: 'same', caption: 'B', columns: 1, cards: ['sessions']},
    ];
    const platesAt = (width, height) => composeAt(width, height, {groups}).plates.map(plate => [plate.groupIndex, plate.groupId]);
    assertEqual(onDeskAndPortrait(platesAt), [[[0, 'same'], [1, 'same']], [[0, 'same'], [1, 'same']]]);
});

test('cockpitComposition inputs: five groups, the fifth naming a card already drawn, are four; a group of ' +
    '2^53 - 1 columns is drawn; and 200 000 groups whose last names Sessions draw Sessions alone', () => {
    const fiveGroups = layoutOf(['system'], ['apps'], ['connections'], ['sessions'], ['apps']);
    const hugeColumns = [{id: 'g', caption: 'G', columns: Number.MAX_SAFE_INTEGER, cards: ['system', 'sessions']}];
    const manyGroups = Array.from({length: MANY_GROUP_COUNT}, (_unused, groupIndex) => ({
        id: `g${groupIndex}`, caption: 'G', columns: 1, cards: groupIndex === MANY_GROUP_COUNT - 1 ? ['sessions'] : ['weather'],
    }));
    const many = composeAt(1920, 1080, {groups: manyGroups});
    assertEqual({
        fiveGroups: onDeskAndPortrait((width, height) => rectanglesOf(composeAt(width, height, {groups: fiveGroups}))),
        hugeColumns: composeAt(1920, 1080, {groups: hugeColumns}).arrangement,
        many: [many.arrangement, many.tiles.map(tile => `${tile.cardId} in group ${tile.groupIndex}`)],
    }, {
        fiveGroups: onDeskAndPortrait((width, height) =>
            rectanglesOf(composeAt(width, height, {groups: LAYOUTS.fourGroupsOfOneCard}))),
        hugeColumns: 'side-by-side',
        many: ['stacked', [`sessions in group ${MANY_GROUP_COUNT - 1}`]],
    });
});

test('cockpitComposition inputs: a group that is null or a function, cards that are not a list and card ids that ' +
    'are not strings draw nothing, and a group with no id is drawn all the same', () => {
    const nullGroupFirst = [null, ...TEMPLATE_GROUPS];
    const functionGroupFirst = [Object.assign(() => null, {id: 'f', cards: ['system', 'sessions']}), ...TEMPLATE_GROUPS];
    const cardsNotAList = [{id: 'a', caption: 'A', columns: 1, cards: 'system'}, ...TEMPLATE_GROUPS];
    const idsNotStrings = [{id: 'a', caption: 'A', columns: 1, cards: [7, null, {}, ['system'], 'sessions']}];
    const noId = [{caption: 'A', columns: 1, cards: ['system', 'sessions']}];
    const rectanglesWith = groups => onDeskAndPortrait((width, height) => rectanglesOf(composeAt(width, height, {groups})));
    const cardIdsWith = groups => onDeskAndPortrait((width, height) =>
        composeAt(width, height, {groups}).tiles.map(tile => tile.cardId));
    assertEqual({
        nullGroupFirst: rectanglesWith(nullGroupFirst), functionGroupFirst: rectanglesWith(functionGroupFirst),
        cardsNotAList: rectanglesWith(cardsNotAList), idsNotStrings: cardIdsWith(idsNotStrings), noId: cardIdsWith(noId),
    }, {
        nullGroupFirst: rectanglesWith(TEMPLATE_GROUPS), functionGroupFirst: rectanglesWith(TEMPLATE_GROUPS),
        cardsNotAList: rectanglesWith(TEMPLATE_GROUPS),
        idsNotStrings: [['sessions'], ['sessions']], noId: [['system', 'sessions'], ['system', 'sessions']],
    });
});

/** Work areas no monitor has, and the two the rows above use. */
const ODD_WORK_AREAS = Object.freeze([
    {x: 0, y: 0, width: 0, height: 0}, {x: 0, y: 0, width: -5, height: 900}, {x: 0, y: 0, width: 47, height: 47},
    {x: -1920, y: 32, width: 1920, height: 1048}, {x: 0.5, y: 0.5, width: 1919.5, height: 1079.5},
    {x: 0, y: 0, width: MOST_COORDINATE_PX, height: MOST_COORDINATE_PX}, {x: 0, y: 0, width: 1e9, height: 1e9},
    {x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: 1080}, {x: 0, y: 0, width: Number.MAX_VALUE, height: 1080},
    {x: 0, y: 0, width: NaN, height: 1080}, {x: 0, y: 0, width: Infinity, height: 1080},
    FULL_HD, {x: 0, y: 0, width: 720, height: 1280},
]);
/** Held counts no extension holds, and the plain ones. */
const ODD_HELD_COLUMN_COUNTS = Object.freeze([1, 0, -3, 2.7, NaN, Infinity, 1e12, undefined, null, '2']);

/**
 * The faults of one result: a number anywhere in it that is not a whole, finite number, or a negative width or
 * height, or no reason where it is not drawn.
 *
 * @param {object} composition - A composition.
 * @returns {string[]} The faults found, by where they are.
 */
function wholeNumberFaultsOf(composition) {
    const faults = [];
    const visit = (value, where) => {
        if (typeof value === 'number' && !Number.isInteger(value))
            faults.push(`${where} is ${value}`);
        else if (Array.isArray(value))
            value.forEach((item, index) => visit(item, `${where}[${index}]`));
        else if (value !== null && typeof value === 'object')
            Object.entries(value).forEach(([key, item]) => visit(item, `${where}.${key}`));
    };
    visit(composition, 'composition');
    if (!composition.isDrawn && typeof composition.reason !== 'string')
        faults.push('not drawn, with no reason');
    for (const rectangle of composition.isDrawn ? [composition.bounds, ...composition.plates, ...composition.tiles] : []) {
        if (rectangle.width < 0 || rectangle.height < 0)
            faults.push(`a ${rectangle.cardId ?? 'plate or bounds'} of ${rectangle.width}x${rectangle.height}`);
    }
    return faults;
}

test('cockpitComposition inputs: for every odd layout and the template, on odd work areas and with odd held counts, ' +
    'nothing throws, every number is whole and finite, nothing is negative, and a work area past 2^24 is refused', () => {
    const layouts = {
        template: TEMPLATE_GROUPS, noGroups: [], notAList: null, noColumn: [{...TEMPLATE_GROUPS[0], columns: 0}],
        emptyBesideTheTemplate: [{id: 'e', caption: 'E', columns: 2, cards: []}, ...TEMPLATE_GROUPS],
        unknownOnly: layoutOf(['weather']), repeatedCard: layoutOf(['apps', 'apps'], ['apps', 'sessions']),
        fiveGroups: layoutOf(['system'], ['apps'], ['connections'], ['sessions'], ['apps']),
        nullGroup: [null, ...TEMPLATE_GROUPS], idsNotStrings: layoutOf([7, null, 'sessions']), noId: [{cards: ['system']}],
    };
    const faults = [];
    for (const [layoutName, groups] of Object.entries(layouts)) {
        for (const workArea of ODD_WORK_AREAS) {
            for (const sessionsColumnCount of ODD_HELD_COLUMN_COUNTS) {
                const where = `${layoutName} on ${JSON.stringify(workArea)}, ${String(sessionsColumnCount)} held`;
                let composition;
                try {
                    composition = cockpitComposition({workArea, groups, sessionsColumnCount});
                } catch (error) {
                    faults.push(`${where}: throws ${error.message}`);
                    continue;
                }
                const isPastTheBound = !Object.values(workArea).every(number =>
                    Number.isFinite(number) && Math.abs(number) <= MOST_COORDINATE_PX);
                if (isPastTheBound && composition.reason !== 'bad-input')
                    faults.push(`${where}: not refused`);
                faults.push(...wholeNumberFaultsOf(composition).map(fault => `${where}: ${fault}`));
            }
        }
    }
    assertEqual(faults.slice(0, 5), []);
});

// ---------------------------------------------------------------------------------------------------------------
// Odd sizes, legends and inputs
// ---------------------------------------------------------------------------------------------------------------

/**
 * @param {function(object): void} change - Changes a copy of the default sizes.
 * @returns {object} The copy, changed.
 */
function sizesWith(change) {
    const sizes = copyOfDefaultSizes();
    change(sizes);
    return sizes;
}

test('cockpitComposition inputs: sizes the composition cannot use are refused: not an object, null, empty, a ' +
    'length or a part missing, a string, NaN, negative, infinite or past 32 768 px, a trillion rows, none, half a ' +
    'row, fewer at the most than the least, a trillion columns in one row, two gaps around a pair, a million of ' +
    'them, three that are not a list, an aspect of nothing', () => {
    const unusableSizes = {
        notAnObject: 7, null: null, empty: {},
        aLengthMissing: sizesWith(sizes => delete sizes.monitor.stopWidthPx),
        aPartMissing: sizesWith(sizes => delete sizes.oneRow),
        aString: sizesWith(sizes => { sizes.plate.heightPx = '26'; }),
        notANumber: sizesWith(sizes => { sizes.heaviest.rowHeightPx = NaN; }),
        negative: sizesWith(sizes => { sizes.marginPx = -24; }),
        infinite: sizesWith(sizes => { sizes.sessions.columnStopWidthPx = Infinity; }),
        pastTheBound: sizesWith(sizes => { sizes.monitor.stopWidthPx = 1e308; }),
        aTrillionRows: sizesWith(sizes => { sizes.heaviest.mostRowCount = 1e12; }),
        noRow: sizesWith(sizes => { sizes.heaviest.leastRowCount = 0; }),
        halfARow: sizesWith(sizes => { sizes.heaviest.leastRowCount = 5.5; }),
        fewerAtTheMost: sizesWith(sizes => { sizes.heaviest.mostRowCount = 3; }),
        aTrillionColumnsInOneRow: sizesWith(sizes => { sizes.oneRow.sessionsColumnCount = 1e12; }),
        twoPairGaps: sizesWith(sizes => { sizes.gaps.aroundAPairChoicesPx = [24, 16]; }),
        aMillionPairGaps: sizesWith(sizes => {
            sizes.gaps.aroundAPairChoicesPx = new Array(MANY_PAIR_GAP_COUNT).fill(24);
        }),
        pairGapsNotAList: sizesWith(sizes => { sizes.gaps.aroundAPairChoicesPx = {0: 24, 1: 20, 2: 16}; }),
        anAspectOfNothing: sizesWith(sizes => { sizes.oneRow.aspectWidth = 0; }),
    };
    const reasons = Object.fromEntries(Object.entries(unusableSizes).map(([name, sizes]) =>
        [name, cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS, sizes}).reason]));
    assertEqual(Object.entries(reasons).filter(([, reason]) => reason !== 'bad-input'), []);
});

test('cockpitComposition inputs: each bound is taken at its value and refused one past it: a length of 32 768 px, ' +
    'a ranking of 16 rows, 6 columns of Sessions in one row, and a work area 2^24 px from the stage\'s origin', () => {
    const outcomeWithSizes = change => {
        const composition = cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS, sizes: sizesWith(change)});
        return composition.reason ?? 'drawn';
    };
    const outcomeAtLeftEdge = x => cockpitComposition({workArea: {...FULL_HD, x}, groups: TEMPLATE_GROUPS}).reason ?? 'drawn';
    assertEqual({
        lengths: [MOST_LENGTH_PX, MOST_LENGTH_PX + 1].map(marginPx =>
            outcomeWithSizes(sizes => { sizes.marginPx = marginPx; })),
        rankingRows: [MOST_RANKING_ROW_COUNT, MOST_RANKING_ROW_COUNT + 1].map(mostRowCount =>
            outcomeWithSizes(sizes => { sizes.heaviest.mostRowCount = mostRowCount; })),
        oneRowColumns: [MOST_ONE_ROW_SESSIONS_COLUMN_COUNT, MOST_ONE_ROW_SESSIONS_COLUMN_COUNT + 1].map(columnCount =>
            outcomeWithSizes(sizes => { sizes.oneRow.sessionsColumnCount = columnCount; })),
        leftEdges: [MOST_COORDINATE_PX, MOST_COORDINATE_PX + 1].map(outcomeAtLeftEdge),
    }, {
        lengths: ['too-small', 'bad-input'], rankingRows: ['drawn', 'bad-input'], oneRowColumns: ['drawn', 'bad-input'],
        leftEdges: ['drawn', 'bad-input'],
    });
});

test('cockpitComposition inputs: a stop the sizes put under its least counts as the least: alone on 1920 x 1080, ' +
    'Sessions with its columns\' stop at 300 px is 440 wide, as beside the machine\'s column, and 640 with their ' +
    'least at 600 over their stop; the monitor with its stop at 500 is 560; Heaviest with its stop at 400 is 440; and ' +
    'Connections with its list\'s stops at 200 px wide and 200 high is a list 260 x 232, and with its height\'s ' +
    'stop at 100 a list 336 x 232', () => {
    const tileAlone = (cardId, change) => {
        const composition = composeAt(1920, 1080, {groups: layoutOf([cardId]), sizes: sizesWith(change)});
        return composition.isDrawn ? sizeAndFormOf(tileOf(composition, cardId)) : `not drawn (${composition.reason})`;
    };
    const putSessionsStopUnderItsLeast = sizes => { sizes.sessions.columnStopWidthPx = 300; };
    const besideTheMachine = composeAt(1920, 1080, {sizes: sizesWith(putSessionsStopUnderItsLeast)});
    assertEqual({
        sessions: tileAlone('sessions', putSessionsStopUnderItsLeast),
        sessionsBesideTheMachine: tileOf(besideTheMachine, 'sessions').width,
        monitor: tileAlone('system', sizes => { sizes.monitor.stopWidthPx = 500; }),
        sessionsWithItsLeastOverItsStop: tileAlone('sessions', sizes => { sizes.sessions.columnLeastWidthPx = 600; }),
        heaviest: tileAlone('apps', sizes => { sizes.heaviest.stopWidthPx = 400; }),
        connections: tileAlone('connections', sizes => {
            sizes.connections.listStopWidthPx = 200;
            sizes.connections.listStopHeightPx = 200;
        }),
        connectionsWithItsListStopAt100High: tileAlone('connections', sizes => {
            sizes.connections.listStopHeightPx = 100;
        }),
    }, {
        sessions: '440x800 1', sessionsBesideTheMachine: 440, monitor: '560x384 wide',
        sessionsWithItsLeastOverItsStop: '640x800 1', heaviest: '440x328 10', connections: '260x232 list',
        connectionsWithItsListStopAt100High: '336x232 list',
    });
});

test('cockpitComposition inputs: a stop under its least counts as the least in a pair too: on 1366 x 736 Heaviest ' +
    'with its stop at 400 px is 440 wide beside Connections 296; Connections with its list\'s stop at 200 px is 260 ' +
    'beside Heaviest 476', () => {
    const pairWith = change => {
        const composition = composeAt(1366, 736, {sizes: sizesWith(change)});
        return ['apps', 'connections'].map(cardId => sizeAndFormOf(tileOf(composition, cardId)));
    };
    assertEqual({
        heaviestStopUnderItsLeast: pairWith(sizes => { sizes.heaviest.stopWidthPx = 400; }),
        listStopUnderItsLeast: pairWith(sizes => { sizes.connections.listStopWidthPx = 200; }),
    }, {
        heaviestStopUnderItsLeast: ['440x232 6', '296x232 list'],
        listStopUnderItsLeast: ['476x232 6', '260x232 list'],
    });
});

test('cockpitComposition inputs: each number of the sizes is read once, so a plate\'s height read as 26 and then ' +
    'NaN, and a ranking\'s most rows read as 10 and then 20 000, give the default composition', () => {
    const sizes = copyOfDefaultSizes();
    const plateHeightReads = countReadsOf(sizes.plate, 'heightPx', 26, NaN);
    const mostRowReads = countReadsOf(sizes.heaviest, 'mostRowCount', 10, 20000);
    const composition = cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS, sizes});
    assertEqual({placements: placementsOf(composition), reads: [plateHeightReads.count, mostRowReads.count]}, {
        placements: placementsOf(cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS})), reads: [1, 1],
    });
});

test('cockpitComposition inputs: each number of the work area is read once, so an x read as 0 and then NaN, and a ' +
    'width read as 1920 and then 10^15, give the composition on 1920 x 1080', () => {
    const workArea = {y: 0, height: 1080};
    const leftEdgeReads = countReadsOf(workArea, 'x', 0, NaN);
    const widthReads = countReadsOf(workArea, 'width', 1920, 1e15);
    const composition = cockpitComposition({workArea, groups: TEMPLATE_GROUPS});
    assertEqual({placements: placementsOf(composition), reads: [leftEdgeReads.count, widthReads.count]}, {
        placements: placementsOf(cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS})), reads: [1, 1],
    });
});

test('cockpitComposition inputs: each group\'s cards are read once, so cards read as a list and then as null give ' +
    'the composition of the list, and throw nothing', () => {
    const groups = TEMPLATE_GROUPS.map(group => ({...group}));
    const cardsReads = countReadsOf(groups[0], 'cards', TEMPLATE_GROUPS[0].cards, null);
    const placements = (() => {
        try {
            return placementsOf(cockpitComposition({workArea: FULL_HD, groups}));
        } catch (error) {
            return `throws ${error.message}`;
        }
    })();
    assertEqual({placements, reads: cardsReads.count}, {
        placements: placementsOf(cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS})), reads: 1,
    });
});

test('cockpitComposition inputs: each plate\'s legend is read once, so a legend read as 900 px and then as none ' +
    'gives the composition with a legend of 900 on 1500 x 1080', () => {
    const legendWidthsPx = [undefined, 269];
    const firstLegendReads = countReadsOf(legendWidthsPx, 0, WIDE_LEGEND_PX, undefined);
    const composition = composeAt(1500, 1080, {plateLegendWidthsPx: legendWidthsPx});
    assertEqual({placements: placementsOf(composition), reads: firstLegendReads.count}, {
        placements: placementsOf(composeAt(1500, 1080, {plateLegendWidthsPx: [WIDE_LEGEND_PX, 269]})), reads: 1,
    });
});

test('cockpitComposition inputs: a length of -0 is taken as 0: plates 0 px high, not -0', () => {
    const composition = composeAt(1920, 1080, {sizes: sizesWith(sizes => { sizes.plate.heightPx = -0; })});
    assertEqual(composition.plates.map(plate => Object.is(plate.height, 0)), [true, true]);
});

test('cockpitComposition inputs: an arrangement to try alone that names no arrangement tries none, and is too ' +
    'small; null, or none given, tries every one', () => {
    const outcomeWith = onlyArrangement => {
        const composition = cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS, onlyArrangement});
        return composition.isDrawn ? composition.arrangement : composition.reason;
    };
    assertEqual([outcomeWith('diagonal'), outcomeWith(null), outcomeWith(undefined)],
        ['too-small', 'side-by-side', 'side-by-side']);
});

test('cockpitComposition inputs: a length with a fraction of a pixel is rounded up: a wide form of 384.4 px draws ' +
    'the monitor 385 high', () => {
    const sizes = sizesWith(sizes => { sizes.monitor.heightPxByForm.wide = 384.4; });
    assertEqual(tileOf(composeAt(1920, 1080, {sizes}), 'system').height, 385);
});

test('cockpitComposition inputs: sizes of zero lengths, one row a ranking and an aspect of 1 to 1 give whole, ' +
    'finite numbers and nothing negative', () => {
    const zeroSizes = sizesWith(sizes => {
        const zeroEveryNumber = part => Object.keys(part).forEach(key => {
            if (typeof part[key] === 'number')
                part[key] = 0;
            else
                zeroEveryNumber(part[key]);
        });
        zeroEveryNumber(sizes);
        Object.assign(sizes.heaviest, {leastRowCount: 1, mostRowCount: 1});
        Object.assign(sizes.oneRow, {sessionsColumnCount: 1, aspectWidth: 1, aspectHeight: 1});
    });
    const faults = [];
    for (const groups of [TEMPLATE_GROUPS, ...Object.values(LAYOUTS)]) {
        for (const workArea of [FULL_HD, {x: 0, y: 0, width: 720, height: 1280}, {x: 0, y: 0, width: 0, height: 0}])
            faults.push(...wholeNumberFaultsOf(cockpitComposition({workArea, groups, sizes: zeroSizes})));
    }
    assertEqual(faults, []);
});

test('cockpitComposition inputs: the gaps around a pair are tried largest first, in whatever order the sizes give ' +
    'them', () => {
    const sizes = sizesWith(sizes => { sizes.gaps.aroundAPairChoicesPx = [16, 24, 20]; });
    const at = (width, height, givenSizes) => placementsOf(composeAt(width, height, {sizes: givenSizes}));
    assertEqual([at(1366, 736, sizes), at(1280, 688, sizes)], [at(1366, 736, DEFAULT_COCKPIT_SIZES), at(1280, 688, DEFAULT_COCKPIT_SIZES)]);
});

test('cockpitComposition inputs: a legend that is null, a string, NaN, negative or infinite counts as no legend; a ' +
    'fraction is rounded up; and legends keyed by each group\'s place read as a list does', () => {
    const plateWidthsWith = plateLegendWidthsPx =>
        composeAt(1920, 1080, {heldColumnCount: 2, plateLegendWidthsPx}).plates.map(plate => [plate.width, plate.isLegendShort]);
    const noLegend = [[760, false], [1080, false]];
    assertEqual({
        null: plateWidthsWith(null), aString: plateWidthsWith('571'), strings: plateWidthsWith(['571', '269']),
        notANumber: plateWidthsWith([NaN, NaN]), negativeAndInfinite: plateWidthsWith([-40, Infinity]),
        fractions: plateWidthsWith([570.5, 268.25]), keyedByPlace: plateWidthsWith({0: 571, 1: 269}),
    }, {
        null: noLegend, aString: noLegend, strings: noLegend, notANumber: noLegend, negativeAndInfinite: noLegend,
        fractions: [[571, false], [269, false]], keyedByPlace: [[571, false], [269, false]],
    });
});

test('cockpitComposition inputs: inputs that are not an object, and a work area that is not one, are refused, not ' +
    'thrown at', () => {
    const reasonOf = call => {
        try {
            return call().reason;
        } catch (error) {
            return `throws ${error.message}`;
        }
    };
    assertEqual([
        reasonOf(() => cockpitComposition()), reasonOf(() => cockpitComposition(null)),
        reasonOf(() => cockpitComposition('inputs')),
        reasonOf(() => cockpitComposition({groups: TEMPLATE_GROUPS})),
        reasonOf(() => cockpitComposition({workArea: null, groups: TEMPLATE_GROUPS})),
        reasonOf(() => cockpitComposition({workArea: '1920x1080', groups: TEMPLATE_GROUPS})),
        reasonOf(() => cockpitComposition({workArea: {width: 1920, height: 1080}, groups: TEMPLATE_GROUPS})),
    ], ['bad-input', 'bad-input', 'bad-input', 'bad-input', 'bad-input', 'bad-input', 'bad-input']);
});

// ---------------------------------------------------------------------------------------------------------------
// Inputs changed in place, and nothing kept between calls
// ---------------------------------------------------------------------------------------------------------------

test('cockpitComposition inputs: the same list of groups given again with a card removed draws one tile fewer', () => {
    const groups = JSON.parse(JSON.stringify(TEMPLATE_GROUPS));
    const before = cockpitComposition({workArea: FULL_HD, groups}).tiles.length;
    groups[0].cards.pop();
    assertEqual([before, cockpitComposition({workArea: FULL_HD, groups}).tiles.length], [4, 3]);
});

test('cockpitComposition inputs: the same sizes given again with the wide form at 500 px draw the monitor 500 high', () => {
    const sizes = copyOfDefaultSizes();
    const workArea = {x: 0, y: 0, width: 3840, height: 2160};
    const before = tileOf(cockpitComposition({workArea, groups: TEMPLATE_GROUPS, sizes}), 'system').height;
    sizes.monitor.heightPxByForm.wide = 500;
    assertEqual([before, tileOf(cockpitComposition({workArea, groups: TEMPLATE_GROUPS, sizes}), 'system').height], [384, 500]);
});

test('cockpitComposition inputs: the same sizes given again with a length made NaN are refused', () => {
    const sizes = copyOfDefaultSizes();
    const before = cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS, sizes}).isDrawn;
    sizes.connections.lineHeightPx = NaN;
    assertEqual([before, cockpitComposition({workArea: FULL_HD, groups: TEMPLATE_GROUPS, sizes}).reason], [true, 'bad-input']);
});

test('cockpitComposition inputs: a call changes nothing it is given, and takes frozen inputs', () => {
    const sizes = sizesWith(givenSizes => { givenSizes.gaps.aroundAPairChoicesPx = [16, 24, 20]; });
    const groups = JSON.parse(JSON.stringify(TEMPLATE_GROUPS));
    const workArea = {x: 0, y: 32, width: 1366, height: 736};
    const [sizesText, groupsText, workAreaText] = [sizes, groups, workArea].map(input => JSON.stringify(input));
    cockpitComposition({workArea, groups, sizes, plateLegendWidthsPx: [571, 269], sessionsColumnCount: 2});
    const frozenGroups = Object.freeze(TEMPLATE_GROUPS.map(group => Object.freeze({...group, cards: Object.freeze([...group.cards])})));
    const frozen = cockpitComposition({
        workArea: Object.freeze({...FULL_HD}), groups: frozenGroups, sizes: DEFAULT_COCKPIT_SIZES,
        plateLegendWidthsPx: Object.freeze([571, 269]),
    });
    assertEqual({
        unchanged: [JSON.stringify(sizes) === sizesText, JSON.stringify(groups) === groupsText,
            JSON.stringify(workArea) === workAreaText],
        frozen: frozen.arrangement,
    }, {unchanged: [true, true, true], frozen: 'side-by-side'});
});

// ---------------------------------------------------------------------------------------------------------------
// The tiles a layout draws
// ---------------------------------------------------------------------------------------------------------------

test('cockpitCompositionGroups: the four tiles the composition places are the cards the cockpit draws', () => {
    assertEqual([...Object.values(COCKPIT_TILE_CARD_ID)].sort(), [...COCKPIT_DRAWN_CARD_IDS].sort());
});

test('cockpitCompositionGroups: drawnCockpitGroups gives each group that draws a tile, by its place, with the ' +
    'cards it draws; a group with no id gives an undefined groupId, and so does each of its plates and tiles', () => {
    const groups = [{caption: 'NO ID', columns: 1, cards: ['system', 'weather', 'apps']}, layoutOf(['apps'])[0],
        ...layoutOf(['connections', 'sessions'])];
    const composition = composeAt(1920, 1080, {groups});
    assertEqual({
        template: drawnCockpitGroups(TEMPLATE_GROUPS),
        groups: drawnCockpitGroups(groups).map(group => [group.groupIndex, group.groupId === undefined, group.cardIds]),
        plates: composition.plates.map(plate => [plate.groupIndex, plate.groupId === undefined]),
        tiles: composition.tiles.map(tile => [tile.cardId, tile.groupIndex, tile.groupId === undefined]),
    }, {
        template: [
            {groupIndex: 0, groupId: 'machine', cardIds: ['system', 'apps', 'connections']},
            {groupIndex: 1, groupId: 'agents', cardIds: ['sessions']},
        ],
        groups: [[0, true, ['system', 'apps']], [2, false, ['connections', 'sessions']]],
        plates: [[0, true], [2, false]],
        tiles: [['system', 0, true], ['apps', 0, true], ['connections', 2, false], ['sessions', 2, false]],
    });
});
