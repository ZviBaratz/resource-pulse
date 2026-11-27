// lib/cockpitComposition.js: each length at which the template's composition changes, with the work area one pixel
// short of it. Sessions is held to six columns, so that it has every column the composition has room for.
import {test, assertEqual} from './harness.js';
import {columnWidthsOf, composeAt, gapUnderTheMonitorPx, tileOf} from './cockpitCompositionFixtures.js';

const EVERY_COLUMN = 6;

/**
 * @param {number} width - A work area's width.
 * @param {number} height - Its height.
 * @returns {object} The template's composition there, Sessions held to every column it has room for.
 */
function templateAt(width, height) {
    return composeAt(width, height, {heldColumnCount: EVERY_COLUMN});
}

/**
 * The machine's forms in a composition of the template, as one line: the monitor's form, a ranking's rows, and
 * whether Heaviest and Connections share a row, with the gap above them.
 *
 * @param {object} composition - A composition of the template.
 * @returns {string} The forms, or the reason it is not drawn.
 */
function machineFormsOf(composition) {
    if (!composition.isDrawn)
        return `not drawn (${composition.reason})`;
    const isAPair = tileOf(composition, 'connections').connectionsForm === 'list';
    const pairText = isAPair ? `a pair ${gapUnderTheMonitorPx(composition)} px under it` : 'in bands';
    return `${composition.arrangement}, ${tileOf(composition, 'system').monitorForm}, ` +
        `${tileOf(composition, 'apps').rankingRowCount} rows, ${pairText}`;
}

/**
 * @param {object} composition - A drawn composition.
 * @returns {string} Sessions' size and its columns.
 */
function sessionsOf(composition) {
    const sessions = tileOf(composition, 'sessions');
    return `${sessions.width}x${sessions.height}, ${sessions.columnCount} column(s)`;
}

test('cockpitComposition thresholds: on a 1920 px wide work area the template is drawn side by side from 658 px of ' +
    'height, the monitor small over six rows and a pair 16 px under it; at 657 it is not drawn', () => {
    assertEqual([machineFormsOf(templateAt(1920, 658)), machineFormsOf(templateAt(1920, 657))], [
        'side-by-side, small, 6 rows, a pair 16 px under it', 'not drawn (too-small)',
    ]);
});

test('cockpitComposition thresholds: the gap above the pair grows from 16 to 20 px at 662 px of height, and to 24 ' +
    'at 666', () => {
    assertEqual([661, 662, 665, 666].map(height => gapUnderTheMonitorPx(templateAt(1920, height))), [16, 20, 20, 24]);
});

test('cockpitComposition thresholds: the monitor takes its medium form from 682 px of height with a gap of 16, 20 ' +
    'from 686 and 24 from 690; at 681 it is small', () => {
    assertEqual([681, 682, 686, 690].map(height => machineFormsOf(templateAt(1920, height))), [
        'side-by-side, small, 6 rows, a pair 24 px under it',
        'side-by-side, medium, 6 rows, a pair 16 px under it',
        'side-by-side, medium, 6 rows, a pair 20 px under it',
        'side-by-side, medium, 6 rows, a pair 24 px under it',
    ]);
});

test('cockpitComposition thresholds: the monitor takes its wide form from 714 px of height with a gap of 16, and ' +
    '24 from 722; at 713 it is medium', () => {
    assertEqual([713, 714, 721, 722].map(height => machineFormsOf(templateAt(1920, height))), [
        'side-by-side, medium, 6 rows, a pair 24 px under it',
        'side-by-side, wide, 6 rows, a pair 16 px under it',
        'side-by-side, wide, 6 rows, a pair 20 px under it',
        'side-by-side, wide, 6 rows, a pair 24 px under it',
    ]);
});

test('cockpitComposition thresholds: the rankings have seven, eight, nine and ten rows, in bands, from 810, 834, ' +
    '858 and 882 px of height; at 809 they have six, beside Connections as a list', () => {
    assertEqual([809, 810, 833, 834, 857, 858, 881, 882].map(height => machineFormsOf(templateAt(1920, height))), [
        'side-by-side, wide, 6 rows, a pair 24 px under it',
        'side-by-side, wide, 7 rows, in bands', 'side-by-side, wide, 7 rows, in bands',
        'side-by-side, wide, 8 rows, in bands', 'side-by-side, wide, 8 rows, in bands',
        'side-by-side, wide, 9 rows, in bands', 'side-by-side, wide, 9 rows, in bands',
        'side-by-side, wide, 10 rows, in bands',
    ]);
});

test('cockpitComposition thresholds: on a 1080 px high work area the template is side by side from 1280 px of ' +
    'width, the monitor 760, the gap 32 and Sessions 440; at 1279 it is stacked', () => {
    const atTheEdge = templateAt(1280, 1080);
    const underIt = templateAt(1279, 1080);
    assertEqual([atTheEdge.arrangement, columnWidthsOf(atTheEdge), underIt.arrangement], ['side-by-side', [760, 32, 440], 'stacked']);
});

test('cockpitComposition thresholds: a 1300 px wide work area is stacked once it is taller than it is wide, at ' +
    '1301 px, the monitor small over six rows and Sessions 1032 x 577 in two columns; at 1300 it is side by side, ' +
    'the monitor wide over ten rows beside Sessions 460 x 800 in one', () => {
    const taller = templateAt(1300, 1301);
    const square = templateAt(1300, 1300);
    assertEqual([machineFormsOf(taller), sessionsOf(taller), machineFormsOf(square), sessionsOf(square)], [
        'stacked, small, 6 rows, a pair 24 px under it', '1032x577, 2 column(s)',
        'side-by-side, wide, 10 rows, in bands', '460x800, 1 column(s)',
    ]);
});

test('cockpitComposition thresholds: a 1700 px high work area is side by side from 1672 px of width, where it holds ' +
    'two columns of Sessions: 760, 32, 832; at 1671 it is stacked, nine rows over Sessions 1032 x 776 in two columns', () => {
    const atTheEdge = templateAt(1672, 1700);
    const underIt = templateAt(1671, 1700);
    assertEqual([atTheEdge.arrangement, columnWidthsOf(atTheEdge), machineFormsOf(underIt), sessionsOf(underIt)], [
        'side-by-side', [760, 32, 832], 'stacked, wide, 9 rows, in bands', '1032x776, 2 column(s)',
    ]);
});

test('cockpitComposition thresholds: a 1400 px high work area is side by side from 1400 px of width, 760, 32 and ' +
    'Sessions 560 in one column; at 1399 it is stacked, the monitor wide over six rows and Sessions 1032 x 612', () => {
    const square = templateAt(1400, 1400);
    const underIt = templateAt(1399, 1400);
    assertEqual([square.arrangement, columnWidthsOf(square), sessionsOf(square), machineFormsOf(underIt), sessionsOf(underIt)], [
        'side-by-side', [760, 32, 560], '560x800, 1 column(s)', 'stacked, wide, 6 rows, a pair 24 px under it',
        '1032x612, 2 column(s)',
    ]);
});

test('cockpitComposition thresholds: on a 1080 px high work area Sessions\' one column stops at 564 from 1404 px of ' +
    'width, the machine at 984 from 1628, and the gap between them at 48 from 1644', () => {
    const widthsAt = width => columnWidthsOf(templateAt(width, 1080));
    assertEqual([1403, 1404, 1627, 1628, 1643, 1644].map(widthsAt), [
        [760, 32, 563], [760, 32, 564], [983, 32, 564], [984, 32, 564], [984, 47, 564], [984, 48, 564],
    ]);
});

test('cockpitComposition thresholds: Sessions takes two columns from 1672 px of width, the monitor going back to 760 ' +
    'for them: 760, 32, 832; at 1671 it has one column, 984, 48, 564', () => {
    assertEqual([columnWidthsOf(templateAt(1672, 1080)), columnWidthsOf(templateAt(1671, 1080))], [[760, 32, 832], [984, 48, 564]]);
});

test('cockpitComposition thresholds: Sessions takes three columns from 2084 px of width: 760, 32, 1244; at 2083 it ' +
    'has two', () => {
    const atTheEdge = templateAt(2084, 1080);
    const underIt = templateAt(2083, 1080);
    assertEqual([columnWidthsOf(atTheEdge), atTheEdge.sessions.columnCount, underIt.sessions.columnCount], [[760, 32, 1244], 3, 2]);
});

test('cockpitComposition thresholds: on a 1080 px high work area the template stands in one row from 3056 px of ' +
    'width; at 3055 it is side by side', () => {
    assertEqual([templateAt(3056, 1080).arrangement, templateAt(3055, 1080).arrangement], ['one-row', 'side-by-side']);
});

test('cockpitComposition thresholds: on a 1440 px high work area one row starts at 3169 px of width, once the work ' +
    'area is wider than 2.2 to 1; at 3168, 2.2 times 1440, it is side by side', () => {
    assertEqual([templateAt(3169, 1440).arrangement, templateAt(3168, 1440).arrangement], ['one-row', 'side-by-side']);
});

test('cockpitComposition thresholds: on a 1080 px high work area the stack is drawn from 648 px of width, 600 wide ' +
    'with Connections in one line; at 647 nothing is drawn', () => {
    const atTheEdge = templateAt(648, 1080);
    assertEqual([atTheEdge.arrangement, atTheEdge.bounds.width, tileOf(atTheEdge, 'connections').connectionsForm,
        templateAt(647, 1080).reason], ['stacked', 600, 'line', 'too-small']);
});

test('cockpitComposition thresholds: in the stack Heaviest and Connections share a row from a column of 724 px, ' +
    'on a work area 772 px wide; at 771 Connections is one line', () => {
    const atTheEdge = templateAt(772, 1080);
    const underIt = templateAt(771, 1080);
    assertEqual([atTheEdge.bounds.width, machineFormsOf(atTheEdge), tileOf(underIt, 'connections').connectionsForm], [
        724, 'stacked, small, 6 rows, a pair 24 px under it', 'line',
    ]);
});

test('cockpitComposition thresholds: the stack holds two columns of Sessions from a column of 832 px, on a work area ' +
    '880 px wide; at 879 it holds one', () => {
    const atTheEdge = templateAt(880, 1080);
    const underIt = templateAt(879, 1080);
    assertEqual([atTheEdge.bounds.width, atTheEdge.sessions.mostColumnCount, underIt.sessions.mostColumnCount], [832, 2, 1]);
});

test('cockpitComposition thresholds: on a 1080 px wide work area the stack is drawn from 914 px of height, the ' +
    'monitor small over a pair and Sessions 190 high; at 913 nothing is drawn', () => {
    const atTheEdge = templateAt(1080, 914);
    assertEqual([machineFormsOf(atTheEdge), tileOf(atTheEdge, 'sessions').height, templateAt(1080, 913).reason], [
        'stacked, small, 6 rows, a pair 24 px under it', 190, 'too-small',
    ]);
});

test('cockpitComposition thresholds: on a 720 px wide work area the stack is drawn from 978 px of height, the ' +
    'monitor small over six rows and Connections in one line, Sessions 190 high; at 977 nothing is drawn', () => {
    const atTheEdge = templateAt(720, 978);
    assertEqual([machineFormsOf(atTheEdge), tileOf(atTheEdge, 'sessions').height, templateAt(720, 977).reason], [
        'stacked, small, 6 rows, in bands', 190, 'too-small',
    ]);
});

test('cockpitComposition thresholds: on a 1080 px wide work area the stack\'s monitor is medium from 1340 px of ' +
    'height and wide from 1396, the rankings have seven rows from 1516 and ten from 1724, and Sessions reaches 800 ' +
    'from 1748', () => {
    const stackAt = height => {
        const composition = templateAt(1080, height);
        return `${machineFormsOf(composition)}; Sessions ${tileOf(composition, 'sessions').height}`;
    };
    const lines = [1339, 1340, 1395, 1396, 1515, 1516, 1723, 1724, 1747, 1748].map(stackAt);
    assertEqual(lines.map(line => line.replace(/; Sessions \d+$/, '')), [
        'stacked, small, 6 rows, a pair 24 px under it', 'stacked, medium, 6 rows, a pair 24 px under it',
        'stacked, medium, 6 rows, a pair 24 px under it', 'stacked, wide, 6 rows, a pair 24 px under it',
        'stacked, wide, 6 rows, a pair 24 px under it', 'stacked, wide, 7 rows, in bands',
        'stacked, wide, 9 rows, in bands', 'stacked, wide, 10 rows, in bands',
        'stacked, wide, 10 rows, in bands', 'stacked, wide, 10 rows, in bands',
    ]);
    assertEqual(lines.slice(-2).map(line => Number(line.split('; Sessions ')[1])), [799, 800]);
});
