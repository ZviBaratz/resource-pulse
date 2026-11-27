// lib/sessionsFlow.js: which sessions a Sessions tile lists, and where each heading, row and "+N more" line stands.
import {test, assertEqual} from './harness.js';
import {countReadsOf} from './cockpitCompositionFixtures.js';
import {createSeededRandom} from './fixtureTrees.js';
import {plainListedCountByState, plainSessionsFlow} from './plainSessionsFlow.js';
import {
    ST_SESSIONS_TILE_LENGTHS, ST_SESSIONS_TILE_LENGTHS_AT_TEXT_SCALED_BY_ONE_AND_A_HALF,
} from './sessionsTileFixtures.js';
import {
    DEFAULT_SESSIONS_TILE_LENGTHS, MOST_SESSIONS_A_TILE_LISTS, mostSessionsATileLists, sessionsFlow,
    unlistedSessionCount,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsFlow.js';
import {SESSION_GROUP_ORDER} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionOrder.js';

const DESKS_SEED = 20261127;
/** The bounded flow is held against the plain one on this many desks. */
const BOUNDED_FLOW_DESK_COUNT = 200000;
/** The bounded flow is held against the plain one at St's line boxes on this many desks. */
const BOUNDED_FLOW_DESK_COUNT_AT_ST_LINE_BOXES = 20000;
/** The balanced columns are held against the plain search on this many desks. */
const BALANCED_FLOW_DESK_COUNT = 2000;
/** The two results are held together on this many desks. */
const AGREEING_RESULTS_DESK_COUNT = 500;
/** The sessions listed are held under mostSessionsATileLists on this many desks at each set of lengths. */
const BOUNDED_LISTING_DESK_COUNT = 1000;
/** The most sessions each state holds on a random desk: a desk of about forty, and some much larger. */
const MOST_RANDOM_SESSIONS_BY_STATE = Object.freeze({blocked: 6, working: 20, done: 8, idle: 90, unknown: 4});
const LEAST_RANDOM_TILE_HEIGHT_PX = 100;
const MOST_RANDOM_TILE_HEIGHT_PX = 1000;
/** The tallest Sessions tile a monitor gives, a little over, for the balancing rows. */
const MOST_BALANCED_TILE_HEIGHT_PX = 1500;
const BALANCED_FLOW_HEIGHT_STEP_PX = 3;
/** The longest length a random set of lengths has. */
const MOST_RANDOM_LENGTH_PX = 60;
/** The everyday desk: 42 sessions, two of them waiting on you. */
const EVERYDAY_DESK = Object.freeze({blocked: 2, working: 7, done: 1, idle: 32, unknown: 0});

/**
 * @param {Object<string, number>} counts - Some states' sessions.
 * @returns {Object<string, number>} Every state's, 0 where not given.
 */
function deskOf(counts) {
    return Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, counts[state] ?? 0]));
}

/**
 * @param {() => number} random - The seeded generator.
 * @param {number} most - The most the number may be.
 * @returns {number} A whole number from 0 to `most`.
 */
function wholeUpTo(random, most) {
    return Math.floor(random() * (most + 1));
}

/**
 * @param {() => number} random - The seeded generator.
 * @param {number} mostTileHeightPx - The tallest tile to give.
 * @returns {{sessionCountByState: Object<string, number>, columnCount: number, tileHeightPx: number}} A random tile.
 */
function randomTile(random, mostTileHeightPx = MOST_RANDOM_TILE_HEIGHT_PX) {
    const sessionCountByState = Object.fromEntries(SESSION_GROUP_ORDER.map(
        state => [state, wholeUpTo(random, MOST_RANDOM_SESSIONS_BY_STATE[state])]));
    const columnCount = 1 + wholeUpTo(random, 5);
    const tileHeightPx = LEAST_RANDOM_TILE_HEIGHT_PX + wholeUpTo(random, mostTileHeightPx - LEAST_RANDOM_TILE_HEIGHT_PX);
    return {sessionCountByState, columnCount, tileHeightPx};
}

/**
 * @param {() => number} random - The seeded generator.
 * @returns {object} Random lengths, each a whole number from 0 to MOST_RANDOM_LENGTH_PX.
 */
function randomLengths(random) {
    const randomLengthPx = () => wholeUpTo(random, MOST_RANDOM_LENGTH_PX);
    return {
        aboveColumnsHeightPx: randomLengthPx(),
        groupHeadingHeightPx: randomLengthPx(),
        moreLineHeightPx: randomLengthPx(),
        rowHeightPxByState: Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, randomLengthPx()])),
    };
}

/**
 * @param {Object<string, number>} countByState - Sessions by state.
 * @returns {number} Their total.
 */
function totalOf(countByState) {
    return SESSION_GROUP_ORDER.reduce((sum, state) => sum + countByState[state], 0);
}

/**
 * @param {object} item - A column's item.
 * @param {object} lengths - The tile's lengths.
 * @returns {number} Its height.
 */
function itemHeightPx(item, lengths) {
    if (item.kind === 'row')
        return lengths.rowHeightPxByState[item.state];
    return item.kind === 'more' ? lengths.moreLineHeightPx : lengths.groupHeadingHeightPx;
}

/**
 * @param {Array<Array<object>>} columns - A flow's columns.
 * @param {object} [lengths] - The tile's lengths.
 * @returns {number[]} Each column's height.
 */
function columnHeightsPx(columns, lengths = DEFAULT_SESSIONS_TILE_LENGTHS) {
    return columns.map(column => column.reduce((sumPx, item) => sumPx + itemHeightPx(item, lengths), 0));
}

/**
 * The most flow heights a balanced flow needs past the first at which its items could fit: while no column is full of
 * rows, it fits at any height of two headings and the tallest row over that.
 *
 * @param {object} lengths - The tile's lengths.
 * @returns {number} The steps.
 */
function mostBalancingStepsNeeded(lengths) {
    const tallestRowHeightPx = Math.max(...Object.values(lengths.rowHeightPxByState));
    const marginPx = 2 * lengths.groupHeadingHeightPx + tallestRowHeightPx;
    return Math.ceil(marginPx / BALANCED_FLOW_HEIGHT_STEP_PX) + 1;
}

/**
 * The faults of one flow's two results against each other: the rows its columns hold against each group's listed
 * count, the indices, the headings' counts, the "+N more" lines, the count unlisted, and whether it says it fits
 * against its columns' heights.
 *
 * @param {object} tile - The tile.
 * @returns {string[]} One line per fault.
 */
function disagreementsOf(tile) {
    const flow = sessionsFlow(tile);
    const faults = [];
    const items = flow.columns.flat();
    for (const state of SESSION_GROUP_ORDER) {
        const count = tile.sessionCountByState[state];
        const listedCount = flow.listedCountByState[state];
        const rowIndices = items.filter(item => item.kind === 'row' && item.state === state).map(item => item.indexInGroup);
        const headings = items.filter(item => item.kind === 'heading' && item.state === state);
        const moreLines = items.filter(item => item.kind === 'more' && item.state === state);
        const expectedMoreLines = listedCount > 0 && listedCount < count ? [count - listedCount] : [];
        if (JSON.stringify(rowIndices) !== JSON.stringify([...Array(listedCount).keys()]))
            faults.push(`${state}: rows ${rowIndices.length} for ${listedCount} listed`);
        if (JSON.stringify(headings.map(heading => heading.count)) !== JSON.stringify(count > 0 ? [count] : []))
            faults.push(`${state}: headings ${JSON.stringify(headings)}`);
        if (JSON.stringify(moreLines.map(line => line.hiddenCount)) !== JSON.stringify(expectedMoreLines))
            faults.push(`${state}: "+N more" ${JSON.stringify(moreLines)}`);
    }
    const listedTotal = totalOf(flow.listedCountByState);
    if (flow.unlistedCount !== totalOf(tile.sessionCountByState) - listedTotal)
        faults.push(`unlisted ${flow.unlistedCount} for ${listedTotal} listed`);
    if (unlistedSessionCount(tile) !== flow.unlistedCount)
        faults.push(`unlistedSessionCount ${unlistedSessionCount(tile)} against ${flow.unlistedCount}`);
    const columnHeightPx = tile.tileHeightPx - DEFAULT_SESSIONS_TILE_LENGTHS.aboveColumnsHeightPx;
    const doesEveryColumnFit = columnHeightsPx(flow.columns).every(heightPx => heightPx <= columnHeightPx);
    if (flow.doesFit !== doesEveryColumnFit)
        faults.push(`doesFit ${flow.doesFit} where every column fitting is ${doesEveryColumnFit}`);
    return faults;
}

/**
 * @param {*} value - A flow's result, or part of one.
 * @returns {boolean} Whether every number in it is a whole one.
 */
function isEveryNumberWhole(value) {
    if (typeof value === 'number')
        return Number.isInteger(value);
    if (value !== null && typeof value === 'object')
        return Object.values(value).every(isEveryNumberWhole);
    return true;
}

/**
 * @param {object} lengths - The tile's lengths.
 * @param {number} seed - The desks' seed.
 * @returns {{differingDesks: string[], mostBalancingSteps: number}} Where the balanced columns differ from the plain
 *     search's, and the most heights any desk's balancing tried.
 */
function balancedAgainstThePlainSearch(lengths, seed) {
    const random = createSeededRandom(seed);
    const differingDesks = [];
    let mostBalancingSteps = 0;
    for (let deskIndex = 0; deskIndex < BALANCED_FLOW_DESK_COUNT; deskIndex++) {
        const tile = {...randomTile(random, MOST_BALANCED_TILE_HEIGHT_PX), lengths};
        const {work, ...placedFlow} = sessionsFlow(tile);
        mostBalancingSteps = Math.max(mostBalancingSteps, work.balancingStepCount);
        if (JSON.stringify(placedFlow) !== JSON.stringify(plainSessionsFlow(tile)))
            differingDesks.push(JSON.stringify(tile));
    }
    return {differingDesks: differingDesks.slice(0, 3), mostBalancingSteps};
}

/**
 * @param {object} lengths - The tile's lengths.
 * @param {number} seed - The desks' seed.
 * @param {number} deskCount - The desks to try.
 * @returns {string[]} The first desks on which the bounded flow leaves unlisted other than the plain one does.
 */
function unlistedAgainstThePlainFlow(lengths, seed, deskCount) {
    const random = createSeededRandom(seed);
    const differingDesks = [];
    for (let deskIndex = 0; deskIndex < deskCount; deskIndex++) {
        const tile = {...randomTile(random), lengths};
        const plainUnlistedCount = totalOf(tile.sessionCountByState) - totalOf(plainListedCountByState(tile));
        if (unlistedSessionCount(tile) !== plainUnlistedCount)
            differingDesks.push(JSON.stringify(tile));
    }
    return differingDesks.slice(0, 3);
}

test('sessionsFlow: one waiting and one working session in one column of a tile 190 px high leave 1 unlisted', () => {
    const tile = {sessionCountByState: deskOf({blocked: 1, working: 1}), columnCount: 1, tileHeightPx: 190};
    assertEqual(unlistedSessionCount(tile), 1);
});

test('sessionsFlow: 2 waiting, 7 working, 1 done and 32 idle in one column 470 px high leave the 32 idle unlisted', () => {
    const tile = {sessionCountByState: deskOf({blocked: 2, working: 7, done: 1, idle: 32}), columnCount: 1, tileHeightPx: 470};
    assertEqual(sessionsFlow(tile).listedCountByState, {blocked: 2, working: 7, done: 1, idle: 0, unknown: 0});
});

test('sessionsFlow: 3 waiting, 9 working, 4 done and 40 idle in one column 640 px high leave the 40 idle unlisted', () => {
    const tile = {sessionCountByState: deskOf({blocked: 3, working: 9, done: 4, idle: 40}), columnCount: 1, tileHeightPx: 640};
    assertEqual(sessionsFlow(tile).listedCountByState, {blocked: 3, working: 9, done: 4, idle: 0, unknown: 0});
});

test('sessionsFlow: a trillion idle sessions in six columns 800 px high leave 99 803 of the 100 000 they are taken ' +
    'as unlisted, with the work of 206 and no more than twice that of a tile listing all 198 it holds', () => {
    const tileOf = idleCount => ({sessionCountByState: deskOf({idle: idleCount}), columnCount: 6, tileHeightPx: 800});
    const workOf = idleCount => {
        const {unlistedCount, work} = sessionsFlow(tileOf(idleCount));
        return {unlistedCount, ...work};
    };
    const trillionWork = workOf(1e12);
    const fullTileWork = workOf(198);
    assertEqual(trillionWork.unlistedCount, 99803);
    assertEqual(fullTileWork.unlistedCount, 0, 'the full tile lists all 198');
    assertEqual({...workOf(206), unlistedCount: 99803}, trillionWork, 'the same work as 206 sessions');
    const isAtMostTwiceAFullTile = trillionWork.placedItemCount <= 2 * fullTileWork.placedItemCount &&
        trillionWork.layoutPassCount <= 2 * fullTileWork.layoutPassCount;
    assertEqual(isAtMostTwiceAFullTile, true, `${JSON.stringify(trillionWork)} against ${JSON.stringify(fullTileWork)}`);
});

test('sessionsFlow: a heading that fits at the foot of a column but whose first row does not starts the next column', () => {
    const tile = {sessionCountByState: deskOf({blocked: 1, working: 1}), columnCount: 2, tileHeightPx: 180};
    assertEqual(sessionsFlow(tile).columns, [
        [{kind: 'heading', state: 'blocked', count: 1}, {kind: 'row', state: 'blocked', indexInGroup: 0}],
        [{kind: 'heading', state: 'working', count: 1}, {kind: 'row', state: 'working', indexInGroup: 0}],
    ]);
});

test('sessionsFlow: a group that runs on into the next column starts it under a "continued" heading', () => {
    const tile = {sessionCountByState: deskOf({idle: 6}), columnCount: 2, tileHeightPx: 167};
    const rowsOf = indices => indices.map(indexInGroup => ({kind: 'row', state: 'idle', indexInGroup}));
    assertEqual(sessionsFlow(tile).columns, [
        [{kind: 'heading', state: 'idle', count: 6}, ...rowsOf([0, 1, 2])],
        [{kind: 'continued', state: 'idle'}, ...rowsOf([3, 4, 5])],
    ]);
});

test('sessionsFlow: a group cut short ends in a "+N more" line with the sessions it does not list', () => {
    const tile = {sessionCountByState: deskOf({idle: 10}), columnCount: 1, tileHeightPx: 209};
    const rows = [0, 1, 2, 3].map(indexInGroup => ({kind: 'row', state: 'idle', indexInGroup}));
    assertEqual(sessionsFlow(tile).columns, [
        [{kind: 'heading', state: 'idle', count: 10}, ...rows, {kind: 'more', state: 'idle', hiddenCount: 6}],
    ]);
});

test('sessionsFlow: a group cut to no row keeps its heading with its count, and no "+N more" line', () => {
    const tile = {sessionCountByState: deskOf({blocked: 1, idle: 5}), columnCount: 1, tileHeightPx: 172};
    assertEqual(sessionsFlow(tile).columns, [[
        {kind: 'heading', state: 'blocked', count: 1}, {kind: 'row', state: 'blocked', indexInGroup: 0},
        {kind: 'heading', state: 'idle', count: 5},
    ]]);
});

test('sessionsFlow: rows are given up from the least urgent group first, and the waiting sessions last', () => {
    const everyStateTwice = deskOf({blocked: 2, working: 2, done: 2, idle: 2, unknown: 2});
    const listedIn = tileHeightPx => {
        const tile = {sessionCountByState: everyStateTwice, columnCount: 1, tileHeightPx};
        return sessionsFlow(tile).listedCountByState;
    };
    assertEqual(listedIn(380), {blocked: 2, working: 2, done: 2, idle: 0, unknown: 0});
    assertEqual(listedIn(288), {blocked: 2, working: 0, done: 0, idle: 0, unknown: 0});
});

test('sessionsFlow: a state with no session draws no heading', () => {
    const tile = {sessionCountByState: deskOf({working: 2, idle: 1}), columnCount: 1, tileHeightPx: 800};
    assertEqual(sessionsFlow(tile).columns, [[
        {kind: 'heading', state: 'working', count: 2}, {kind: 'row', state: 'working', indexInGroup: 0},
        {kind: 'row', state: 'working', indexInGroup: 1}, {kind: 'heading', state: 'idle', count: 1},
        {kind: 'row', state: 'idle', indexInGroup: 0},
    ]]);
});

test(`sessionsFlow: on ${AGREEING_RESULTS_DESK_COUNT} random desks the columns hold each group's listed rows in ` +
    'order, and the count unlisted is the rest, as unlistedSessionCount gives it', () => {
    const random = createSeededRandom(DESKS_SEED);
    const faults = [];
    for (let deskIndex = 0; deskIndex < AGREEING_RESULTS_DESK_COUNT; deskIndex++) {
        const tile = randomTile(random);
        faults.push(...disagreementsOf(tile).map(fault => `${JSON.stringify(tile)}: ${fault}`));
    }
    assertEqual(faults.slice(0, 3), []);
});

test('sessionsFlow: two columns with room to spare are balanced to within a row of each other', () => {
    const heightsFor = counts => {
        const tile = {sessionCountByState: deskOf(counts), columnCount: 2, tileHeightPx: 800};
        return columnHeightsPx(sessionsFlow(tile).columns);
    };
    assertEqual(heightsFor({idle: 20}), [234, 234]);
    assertEqual(heightsFor({blocked: 2, working: 7, done: 1, idle: 32}), [541, 528]);
    assertEqual(heightsFor({blocked: 3, working: 9, done: 4, idle: 10}), [372, 390]);
});

test(`sessionsFlow: on ${BALANCED_FLOW_DESK_COUNT} random desks the balanced columns are the plain search's, from ` +
    '120 px up, and each balancing tries fewer heights than two headings and the tallest row span', () => {
    const {differingDesks, mostBalancingSteps} = balancedAgainstThePlainSearch(DEFAULT_SESSIONS_TILE_LENGTHS, DESKS_SEED);
    assertEqual(differingDesks, []);
    const isWithinTheMargin = mostBalancingSteps <= mostBalancingStepsNeeded(DEFAULT_SESSIONS_TILE_LENGTHS);
    assertEqual(isWithinTheMargin, true, `${mostBalancingSteps} heights tried`);
});

test(`sessionsFlow: with text scaled by 1.5, on ${BALANCED_FLOW_DESK_COUNT} random desks the balanced columns are ` +
    "the plain search's too, so the search's bound decides none of them", () => {
    const lengths = ST_SESSIONS_TILE_LENGTHS_AT_TEXT_SCALED_BY_ONE_AND_A_HALF;
    const {differingDesks, mostBalancingSteps} = balancedAgainstThePlainSearch(lengths, DESKS_SEED + 1);
    assertEqual(differingDesks, []);
    assertEqual(mostBalancingSteps <= mostBalancingStepsNeeded(lengths), true, `${mostBalancingSteps} heights tried`);
});

test(`sessionsFlow: on ${BOUNDED_FLOW_DESK_COUNT} random desks the bounded flow leaves unlisted what the plain one ` +
    'does, giving up one row at a time', () => {
    const deskCount = BOUNDED_FLOW_DESK_COUNT;
    assertEqual(unlistedAgainstThePlainFlow(DEFAULT_SESSIONS_TILE_LENGTHS, DESKS_SEED + 2, deskCount), []);
});

test(`sessionsFlow: at St's line boxes, where "+N more" is a pixel taller than a row, on ` +
    `${BOUNDED_FLOW_DESK_COUNT_AT_ST_LINE_BOXES} random desks the bounded flow leaves unlisted what the plain one ` +
    'does', () => {
    const deskCount = BOUNDED_FLOW_DESK_COUNT_AT_ST_LINE_BOXES;
    assertEqual(unlistedAgainstThePlainFlow(ST_SESSIONS_TILE_LENGTHS, DESKS_SEED + 3, deskCount), []);
});

test('sessionsFlow: reads each count, length and figure of the tile once, so one that would read differently a ' +
    'second time is never used changed', () => {
    const sessionCountByState = {...EVERYDAY_DESK};
    const rowHeightPxByState = {...DEFAULT_SESSIONS_TILE_LENGTHS.rowHeightPxByState};
    const lengths = {...DEFAULT_SESSIONS_TILE_LENGTHS, rowHeightPxByState};
    const tile = {sessionCountByState, columnCount: 2, tileHeightPx: 800, lengths};
    const reads = [
        countReadsOf(sessionCountByState, 'idle', EVERYDAY_DESK.idle, NaN),
        countReadsOf(rowHeightPxByState, 'idle', DEFAULT_SESSIONS_TILE_LENGTHS.rowHeightPxByState.idle, NaN),
        countReadsOf(tile, 'tileHeightPx', 800, NaN),
    ];
    const flow = sessionsFlow(tile);
    const everydayFlow = sessionsFlow({sessionCountByState: EVERYDAY_DESK, columnCount: 2, tileHeightPx: 800});
    assertEqual({flow, reads: reads.map(({count}) => count)}, {flow: everydayFlow, reads: [1, 1, 1]});
});

test('sessionsFlow: says whether its columns fit: five headings, 120 px, over a column of 110 do not, with all five ' +
    'sessions unlisted; the everyday desk in two columns 800 px high fits, and a tile with no column places ' +
    'nothing', () => {
    const oneInEachState = deskOf({blocked: 1, working: 1, done: 1, idle: 1, unknown: 1});
    const overflowing = sessionsFlow({sessionCountByState: oneInEachState, columnCount: 1, tileHeightPx: 190});
    const everyday = sessionsFlow({sessionCountByState: EVERYDAY_DESK, columnCount: 2, tileHeightPx: 800});
    const noColumn = sessionsFlow({sessionCountByState: oneInEachState, columnCount: 0, tileHeightPx: 190});
    const overflowingFacts = [overflowing.doesFit, overflowing.unlistedCount, columnHeightsPx(overflowing.columns)];
    assertEqual({overflowing: overflowingFacts, everyday: everyday.doesFit, noColumn: noColumn.doesFit},
        {overflowing: [false, 5, [120]], everyday: true, noColumn: true});
});

test('sessionsFlow: a fractional length is rounded up, a length of 0 or of 32 768 is used, one over 32 768 lists ' +
    'nothing, and a tile over 32 768 px high is taken as 32 768', () => {
    const thirtyIdle = {sessionCountByState: deskOf({idle: 30}), columnCount: 1, tileHeightPx: 585};
    const lengthsUnderTheDefaults = {
        aboveColumnsHeightPx: 79.2, groupHeadingHeightPx: 23.1, moreLineHeightPx: 20.4,
        rowHeightPxByState: {blocked: 43.5, working: 23.5, done: 20.01, idle: 20.01, unknown: 20.01},
    };
    const everydayWith = change => {
        const lengths = {...DEFAULT_SESSIONS_TILE_LENGTHS, ...change};
        const flow = sessionsFlow({sessionCountByState: EVERYDAY_DESK, columnCount: 2, tileHeightPx: 800, lengths});
        return `${flow.columns.length} columns, ${flow.unlistedCount} unlisted`;
    };
    const rowsOf1000Px = Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, 1000]));
    const tileOverTheMost = {
        sessionCountByState: deskOf({idle: 100}), columnCount: 1, tileHeightPx: 1e6,
        lengths: {...DEFAULT_SESSIONS_TILE_LENGTHS, rowHeightPxByState: rowsOf1000Px},
    };
    assertEqual({
        idleListedWithFractions:
            sessionsFlow({...thirtyIdle, lengths: lengthsUnderTheDefaults}).listedCountByState.idle,
        idleListedWithTheDefaults: sessionsFlow(thirtyIdle).listedCountByState.idle,
        moreLineOfNoHeight: everydayWith({moreLineHeightPx: 0}),
        aboveColumnsAtTheMost: everydayWith({aboveColumnsHeightPx: 32768}),
        aboveColumnsOverTheMost: everydayWith({aboveColumnsHeightPx: 32769}),
        idleListedOnATileOverTheMost: sessionsFlow(tileOverTheMost).listedCountByState.idle,
    }, {
        idleListedWithFractions: 21,
        idleListedWithTheDefaults: 21,
        moreLineOfNoHeight: '2 columns, 0 unlisted',
        aboveColumnsAtTheMost: '2 columns, 42 unlisted',
        aboveColumnsOverTheMost: '0 columns, 42 unlisted',
        idleListedOnATileOverTheMost: 32,
    });
});

test('mostSessionsATileLists: 68 for two columns 800 px high, where idle sessions list 65; 256 for a column of rows ' +
    'with no height, which lists 256 of 300; 1536 at the most; 0 where the tile lists nothing', () => {
    const rowsOfNoHeight = Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, 0]));
    const columnOfRowsWithNoHeight = {
        sessionCountByState: deskOf({idle: 300}), columnCount: 1, tileHeightPx: 180,
        lengths: {...DEFAULT_SESSIONS_TILE_LENGTHS, rowHeightPxByState: rowsOfNoHeight},
    };
    const twoColumnsOfIdle = {sessionCountByState: deskOf({idle: 100}), columnCount: 2, tileHeightPx: 800};
    assertEqual({
        twoColumns: mostSessionsATileLists(twoColumnsOfIdle),
        idleListedInTwoColumns: sessionsFlow(twoColumnsOfIdle).listedCountByState.idle,
        rowsOfNoHeight: mostSessionsATileLists(columnOfRowsWithNoHeight),
        idleListedInRowsOfNoHeight: sessionsFlow(columnOfRowsWithNoHeight).listedCountByState.idle,
        atTheMost: mostSessionsATileLists({columnCount: 6, tileHeightPx: 32768}),
        noColumn: mostSessionsATileLists({columnCount: 0, tileHeightPx: 800}),
        heightNotANumber: mostSessionsATileLists({columnCount: 2, tileHeightPx: NaN}),
        lengthsNull: mostSessionsATileLists({columnCount: 2, tileHeightPx: 800, lengths: null}),
        noTile: mostSessionsATileLists(undefined),
    }, {
        twoColumns: 68, idleListedInTwoColumns: 65, rowsOfNoHeight: 256, idleListedInRowsOfNoHeight: 256,
        atTheMost: MOST_SESSIONS_A_TILE_LISTS, noColumn: 0, heightNotANumber: 0, lengthsNull: 0, noTile: 0,
    });
});

test(`mostSessionsATileLists: on ${BOUNDED_LISTING_DESK_COUNT} random desks at the default lengths, at St's and at ` +
    'random ones, the sessions listed never pass it', () => {
    const random = createSeededRandom(DESKS_SEED + 4);
    const lengthsChoices = [
        () => DEFAULT_SESSIONS_TILE_LENGTHS, () => ST_SESSIONS_TILE_LENGTHS, () => randomLengths(random),
    ];
    const desksOverTheBound = [];
    for (const lengthsOf of lengthsChoices) {
        for (let deskIndex = 0; deskIndex < BOUNDED_LISTING_DESK_COUNT; deskIndex++) {
            const tile = {...randomTile(random), lengths: lengthsOf()};
            const listedCount = totalOf(sessionsFlow(tile).listedCountByState);
            if (listedCount > mostSessionsATileLists(tile))
                desksOverTheBound.push(`${JSON.stringify(tile)}: ${listedCount} listed`);
        }
    }
    assertEqual(desksOverTheBound.slice(0, 3), []);
});

test('sessionsFlow: odd counts, columns, heights and lengths list nothing or a bounded flow, never throw, and give ' +
    'whole numbers', () => {
    const everyday = deskOf({blocked: 2, working: 7, done: 1, idle: 32});
    const tileWith = change => ({sessionCountByState: everyday, columnCount: 2, tileHeightPx: 800, ...change});
    const oddCounts = {blocked: NaN, working: -4, done: 2.7, idle: Infinity, unknown: 1e12};
    const flows = {
        oddCounts: sessionsFlow(tileWith({sessionCountByState: oddCounts})),
        sevenColumns: sessionsFlow(tileWith({columnCount: 7})),
        noColumn: sessionsFlow(tileWith({columnCount: 0})),
        columnsNotANumber: sessionsFlow(tileWith({columnCount: NaN})),
        heightNotANumber: sessionsFlow(tileWith({tileHeightPx: NaN})),
        negativeHeight: sessionsFlow(tileWith({tileHeightPx: -40})),
        infiniteHeight: sessionsFlow(tileWith({tileHeightPx: Infinity})),
        countsNull: sessionsFlow(tileWith({sessionCountByState: null})),
        countsAString: sessionsFlow(tileWith({sessionCountByState: 'blocked'})),
        countsAnArray: sessionsFlow(tileWith({sessionCountByState: [2, 7, 1, 32]})),
        lengthsNull: sessionsFlow(tileWith({lengths: null})),
        lengthsWithoutRows: sessionsFlow(tileWith({lengths: {...DEFAULT_SESSIONS_TILE_LENGTHS, rowHeightPxByState: null}})),
        lengthNegative: sessionsFlow(tileWith({lengths: {...DEFAULT_SESSIONS_TILE_LENGTHS, moreLineHeightPx: -1}})),
        noTile: sessionsFlow(undefined),
    };
    assertEqual(isEveryNumberWhole(flows), true);
    const summaries = Object.fromEntries(Object.entries(flows).map(
        ([name, flow]) => [name, `${flow.columns.length} columns, ${flow.unlistedCount} unlisted`]));
    assertEqual(summaries, {
        oddCounts: '2 columns, 99938 unlisted',
        sevenColumns: '6 columns, 0 unlisted',
        noColumn: '0 columns, 42 unlisted',
        columnsNotANumber: '0 columns, 42 unlisted',
        heightNotANumber: '0 columns, 42 unlisted',
        negativeHeight: '2 columns, 42 unlisted',
        infiniteHeight: '0 columns, 42 unlisted',
        countsNull: '2 columns, 0 unlisted',
        countsAString: '2 columns, 0 unlisted',
        countsAnArray: '2 columns, 0 unlisted',
        lengthsNull: '0 columns, 42 unlisted',
        lengthsWithoutRows: '0 columns, 42 unlisted',
        lengthNegative: '0 columns, 42 unlisted',
        noTile: '0 columns, 0 unlisted',
    });
});

test('sessionsFlow: a column lists at most 256 rows, and no tile more than MOST_SESSIONS_A_TILE_LISTS, 1536', () => {
    const tallColumn = sessionsFlow({sessionCountByState: deskOf({idle: 300}), columnCount: 1, tileHeightPx: 6425});
    assertEqual(tallColumn.columns[0].at(-1), {kind: 'more', state: 'idle', hiddenCount: 44});
    assertEqual(tallColumn.listedCountByState.idle, 256);
    const tallestTile = {sessionCountByState: deskOf({idle: 1e12, working: 1e12}), columnCount: 6, tileHeightPx: 32768};
    assertEqual(MOST_SESSIONS_A_TILE_LISTS, 1536);
    assertEqual(totalOf(sessionsFlow(tallestTile).listedCountByState), MOST_SESSIONS_A_TILE_LISTS);
});
