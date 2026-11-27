// lib/sessionsColumnCount.js: how many columns the Sessions tile holds, against the template's composition.
import {test, assertEqual} from './harness.js';
import {LAYOUTS, SIZES_WITH_ST_LINE_BOXES, composeAt, countReadsOf, tileOf} from './cockpitCompositionFixtures.js';
import {ST_SESSIONS_TILE_LENGTHS} from './sessionsTileFixtures.js';
import {sessionsColumnCountToHold} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsColumnCount.js';
import {
    DEFAULT_SESSIONS_TILE_LENGTHS, unlistedSessionCount,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsFlow.js';
import {DEFAULT_COCKPIT_SIZES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionSizes.js';

/** An everyday desk: 42 sessions, two of them waiting on you. */
const EVERYDAY_DESK = Object.freeze({blocked: 2, working: 7, done: 1, idle: 32, unknown: 0});
const EVERYDAY_SESSION_COUNT = 42;
const NO_SESSION = Object.freeze({blocked: 0, working: 0, done: 0, idle: 0, unknown: 0});
/** Common screens' work areas, from the largest. */
const COMMON_WORK_AREAS = Object.freeze([
    [3840, 2160], [3440, 1440], [2560, 1440], [1920, 1080], [1536, 928],
    [1440, 868], [1366, 736], [1280, 688], [1080, 1920], [720, 1280],
]);

/**
 * @param {number} idleCount - The idle sessions.
 * @returns {Object<string, number>} A desk of idle sessions alone.
 */
function idleDesk(idleCount) {
    return {...NO_SESSION, idle: idleCount};
}

/**
 * @param {number} width - The work area's width.
 * @param {number} height - Its height.
 * @param {object} [options] - The layout and the sizes.
 * @param {object[]} [options.groups] - The layout's groups; the template's unless given.
 * @param {object} [options.sizes] - The composition's sizes; the default ones unless given.
 * @returns {function(number): (object|null)} The composition's Sessions tile for each held count.
 */
function sessionsBoxOn(width, height, {groups, sizes = DEFAULT_COCKPIT_SIZES} = {}) {
    return heldColumnCount => composeAt(width, height, {groups, sizes, heldColumnCount}).sessions ?? null;
}

/**
 * @param {Object<string, number>} sessionCountByState - The desk.
 * @param {number|null} heldColumnCount - The count held.
 * @param {number} width - The work area's width.
 * @param {number} height - Its height.
 * @returns {number} The count to hold, for the template there.
 */
function countFor(sessionCountByState, heldColumnCount, width, height) {
    return sessionsColumnCountToHold({heldColumnCount, sessionCountByState, sessionsBoxFor: sessionsBoxOn(width, height)});
}

/**
 * The everyday desk on a work area, its count decided with none held.
 *
 * @param {number} width - The work area's width.
 * @param {number} height - Its height.
 * @param {object} [options] - The layout, the sizes and the Sessions tile's lengths.
 * @param {object[]} [options.groups] - The layout's groups.
 * @param {object} [options.sizes] - The composition's sizes.
 * @param {object} [options.lengths] - The Sessions tile's lengths.
 * @returns {{columnCount: number, listedCount: number, composition: object}} The columns it holds, the sessions it
 *     lists in them, and the composition.
 */
function everydayDeskOn(width, height, {groups, sizes = DEFAULT_COCKPIT_SIZES, lengths} = {}) {
    const sessionsBoxFor = sessionsBoxOn(width, height, {groups, sizes});
    const columnCount = sessionsColumnCountToHold({
        heldColumnCount: null, sessionCountByState: EVERYDAY_DESK, sessionsBoxFor, lengths,
    });
    const composition = composeAt(width, height, {groups, sizes, heldColumnCount: columnCount});
    const {tileHeightPx} = composition.sessions;
    const unlistedCount = unlistedSessionCount({sessionCountByState: EVERYDAY_DESK, columnCount, tileHeightPx, lengths});
    return {columnCount, listedCount: EVERYDAY_SESSION_COUNT - unlistedCount, composition};
}

test('sessionsColumnCountToHold: idle sessions on 1920 x 1080 with no count held take one column up to 33, two from 34', () => {
    assertEqual([33, 34].map(idleCount => countFor(idleDesk(idleCount), null, 1920, 1080)), [1, 2]);
});

test('sessionsColumnCountToHold: idle sessions on 1920 x 1080 with one column held keep it up to 34, take two from 35', () => {
    assertEqual([34, 35].map(idleCount => countFor(idleDesk(idleCount), 1, 1920, 1080)), [1, 2]);
});

test('sessionsColumnCountToHold: idle sessions on 1920 x 1080 with two columns held keep them down to 31, take ' +
    'one from 30', () => {
    assertEqual([31, 30].map(idleCount => countFor(idleDesk(idleCount), 2, 1920, 1080)), [2, 1]);
});

test('sessionsColumnCountToHold: the everyday desk on 1920 x 1080 takes two columns whatever odd count is held', () => {
    const oddHeldCounts = [undefined, null, NaN, 2.7, Infinity, 0, -3];
    const counts = oddHeldCounts.map(heldColumnCount => countFor(EVERYDAY_DESK, heldColumnCount, 1920, 1080));
    assertEqual(counts, [2, 2, 2, 2, 2, 2, 2]);
});

test('sessionsColumnCountToHold: two columns held with no session, as with herdr not running, come down to one', () => {
    assertEqual(countFor(NO_SESSION, 2, 1920, 1080), 1);
});

test('sessionsColumnCountToHold: two columns held while the sessions are not known stay two', () => {
    assertEqual(countFor(null, 2, 1920, 1080), 2);
});

test('sessionsColumnCountToHold: the everyday desk with no count held takes 2, 3, 2, 2, 1, 1, 1, 1, 2 and 1 columns ' +
    'on 3840 x 2160, 3440 x 1440, 2560 x 1440, 1920 x 1080, 1536 x 928, 1440 x 868, 1366 x 736, 1280 x 688, ' +
    '1080 x 1920 and 720 x 1280', () => {
    assertEqual(COMMON_WORK_AREAS.map(([width, height]) => countFor(EVERYDAY_DESK, null, width, height)),
        [2, 3, 2, 2, 1, 1, 1, 1, 2, 1]);
});

test('sessionsColumnCountToHold: with no Sessions tile, the count held stays, and is 1 where none is held', () => {
    const sessionsBoxFor = sessionsBoxOn(1920, 1080, {groups: LAYOUTS.noSessionsCard});
    const countHolding = heldColumnCount =>
        sessionsColumnCountToHold({heldColumnCount, sessionCountByState: EVERYDAY_DESK, sessionsBoxFor});
    assertEqual([countHolding(3), countHolding(null)], [3, 1]);
});

test('sessionsColumnCountToHold: six columns held come down first to the most the composition has room for: two on ' +
    '1920 x 1080, and one on 1536 x 928, where taking one away at a time would stop at two', () => {
    assertEqual([countFor(EVERYDAY_DESK, 6, 1920, 1080), countFor(EVERYDAY_DESK, 6, 1536, 928)], [2, 1]);
});

test('sessionsColumnCountToHold: with no situation, or a sessionsBoxFor that is not a function, the count held ' +
    'stays, and is 1 where none is held', () => {
    const withoutAComposition = heldColumnCount =>
        sessionsColumnCountToHold({heldColumnCount, sessionCountByState: EVERYDAY_DESK, sessionsBoxFor: 'a box'});
    const counts = {
        noSituation: sessionsColumnCountToHold(),
        situationNull: sessionsColumnCountToHold(null),
        situationAString: sessionsColumnCountToHold('two'),
        threeHeldWithoutAComposition: withoutAComposition(3),
        noneHeldWithoutAComposition: withoutAComposition(null),
    };
    assertEqual(counts, {
        noSituation: 1, situationNull: 1, situationAString: 1, threeHeldWithoutAComposition: 3,
        noneHeldWithoutAComposition: 1,
    });
});

test('sessionsColumnCountToHold: reads each session count and length once, and asks the composition once for each ' +
    'column count, each box read once', () => {
    const sessionCountByState = {...EVERYDAY_DESK};
    const rowHeightPxByState = {...DEFAULT_SESSIONS_TILE_LENGTHS.rowHeightPxByState};
    const lengths = {...DEFAULT_SESSIONS_TILE_LENGTHS, rowHeightPxByState};
    const reads = [
        countReadsOf(sessionCountByState, 'idle', EVERYDAY_DESK.idle, NaN),
        countReadsOf(rowHeightPxByState, 'idle', DEFAULT_SESSIONS_TILE_LENGTHS.rowHeightPxByState.idle, NaN),
    ];
    const askedCounts = [];
    const sessionsBoxFor = heldColumnCount => {
        askedCounts.push(heldColumnCount);
        const box = {...sessionsBoxOn(3440, 1440)(heldColumnCount)};
        reads.push(countReadsOf(box, 'tileHeightPx', box.tileHeightPx, NaN));
        return box;
    };
    const columnCount = sessionsColumnCountToHold({heldColumnCount: 1, sessionCountByState, sessionsBoxFor, lengths});
    const readCounts = reads.map(({count}) => count);
    assertEqual({columnCount, askedCounts, readCounts},
        {columnCount: 3, askedCounts: [1, 2], readCounts: [1, 1, 1, 1]});
});

test('sessionsColumnCountToHold: the count it gives, held, is the count it gives again', () => {
    const unsettled = [];
    for (const [width, height] of COMMON_WORK_AREAS) {
        for (let idleCount = 0; idleCount <= 120; idleCount += 3) {
            for (const heldColumnCount of [null, 1, 2, 3, 6]) {
                const desk = {...EVERYDAY_DESK, idle: idleCount};
                const columnCount = countFor(desk, heldColumnCount, width, height);
                const again = countFor(desk, columnCount, width, height);
                const where = `${width} x ${height}, ${idleCount} idle, ${heldColumnCount} held`;
                if (again !== columnCount)
                    unsettled.push(`${where}: ${columnCount}, then ${again}`);
            }
        }
    }
    assertEqual(unsettled.slice(0, 3), []);
});

test('sessionsColumnCountToHold: the everyday desk lists 42, 33, 42, 42, 25, 24, 17, 16, 42 and 10 of its 42 on ' +
    '3840 x 2160, 3440 x 1440, 2560 x 1440, 1920 x 1080, 1536 x 928, 1440 x 868, 1366 x 736, 1280 x 688, ' +
    '1080 x 1920 and 720 x 1280', () => {
    assertEqual(COMMON_WORK_AREAS.map(([width, height]) => everydayDeskOn(width, height).listedCount),
        [42, 33, 42, 42, 25, 24, 17, 16, 42, 10]);
});

test('sessionsColumnCountToHold: with no system card, the everyday desk on 1920 x 1080 lists all 42', () => {
    assertEqual(everydayDeskOn(1920, 1080, {groups: LAYOUTS.noSystemCard}).listedCount, 42);
});

test("sessionsColumnCountToHold: at St's line boxes the everyday desk keeps each screen's monitor form, and lists " +
    '42, 33, 42, 42, 25, 24, 18, 16, 42 and 10 of its 42 on the common screens', () => {
    const atStLineBoxes = COMMON_WORK_AREAS.map(([width, height]) => {
        const atStSizes = {sizes: SIZES_WITH_ST_LINE_BOXES, lengths: ST_SESSIONS_TILE_LENGTHS};
        const {listedCount, composition} = everydayDeskOn(width, height, atStSizes);
        return `${width}x${height} ${tileOf(composition, 'system').monitorForm} ${listedCount}`;
    });
    assertEqual(atStLineBoxes, [
        '3840x2160 wide 42', '3440x1440 wide 33', '2560x1440 wide 42', '1920x1080 wide 42', '1536x928 wide 25',
        '1440x868 wide 24', '1366x736 wide 18', '1280x688 medium 16', '1080x1920 wide 42', '720x1280 small 10',
    ]);
});
