// lib/sessionsTileSlots.js: which row each session of the Sessions tile takes, which slot each line takes, and how
// the header's state counts and a row's context tag are shown, as pure functions.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as sessionsTileSlots from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsTileSlots.js';

/** The gap before a state's count that follows another's, written out so a changed gap fails here. */
const STATE_COUNTS_GAP_PX = 12;

test('sessionsTileSlots: a session still listed keeps its row; a session newly listed takes a row never used ' +
    'first, then one whose session left; past the rows built, a session takes none', () =>
    assertEqual(sessionsTileSlots.rowIndexesForSessions(['a', null, 'b', 'c', null], ['c', 'd', 'a', 'e', 'f', 'g']),
        [3, 1, 0, 4, 2, null]));

test('sessionsTileSlots: a reorder only moves sessions between the rows they had', () =>
    assertEqual(sessionsTileSlots.rowIndexesForSessions(['a', 'b', 'c'], ['c', 'a', 'b']), [2, 0, 1]));

test('sessionsTileSlots: a session that finds no free row leaves the sessions after it their own rows', () =>
    assertEqual(sessionsTileSlots.rowIndexesForSessions(['a', 'b'], ['x', 'y', 'b']), [0, null, 1]));

test('sessionsTileSlots: two listed sessions with one id take a row each, and of two rows that hold one listed id ' +
    'the later keeps it', () =>
    assertEqual({
        twoListed: sessionsTileSlots.rowIndexesForSessions(['a', null], ['a', 'a']),
        twoRows: sessionsTileSlots.rowIndexesForSessions(['a', 'a', null], ['a', 'z']),
    }, {twoListed: [0, 1], twoRows: [1, 2]}));

test('sessionsTileSlots: a heading and a "+N more" line take their state\'s slot, a run-on heading its column\'s; ' +
    'a row, or a run-on heading in the first column, takes no line slot', () =>
    assertEqual([
        [{kind: 'heading', state: 'idle', count: 3}, 0],
        [{kind: 'more', state: 'working', hiddenCount: 8}, 1],
        [{kind: 'continued', state: 'idle'}, 1],
        [{kind: 'continued', state: 'done'}, 2],
        [{kind: 'row', state: 'idle', indexInGroup: 0}, 0],
        [{kind: 'continued', state: 'idle'}, 0],
    ].map(([item, columnIndex]) => sessionsTileSlots.lineSlotOf(item, columnIndex)), [
        {slotKind: 'heading', state: 'idle', continuedIndex: null},
        {slotKind: 'more', state: 'working', continuedIndex: null},
        {slotKind: 'continued', state: 'idle', continuedIndex: 0},
        {slotKind: 'continued', state: 'done', continuedIndex: 1},
        null,
        null,
    ]));

test('sessionsTileSlots: the header shows each state\'s count that has one, in the groups\' order, the first with ' +
    'no gap before it and each after it with its own; a state not in the groups shows nothing', () => {
    const shownOf = countTextByState => {
        const {cells, isBoxPresent} = sessionsTileSlots.stateCountCells(countTextByState);
        return {
            shown: cells.filter(cell => cell.isPresent).map(cell => `${cell.state} ${cell.countText} ${cell.gapPx}`),
            isBoxPresent,
        };
    };
    assertEqual({
        some: shownOf({idle: '15', working: '11'}),
        all: shownOf({blocked: '5', working: '11', done: '5', idle: '15', unknown: '6'}),
        none: shownOf({}),
        strange: shownOf(JSON.parse('{"__proto__": "9", "constructor": "3", "done": "1"}')),
        states: sessionsTileSlots.stateCountCells({}).cells.map(cell => cell.state),
    }, {
        some: {shown: ['working 11 0', `idle 15 ${STATE_COUNTS_GAP_PX}`], isBoxPresent: true},
        all: {shown: ['blocked 5 0', `working 11 ${STATE_COUNTS_GAP_PX}`, `done 5 ${STATE_COUNTS_GAP_PX}`,
            `idle 15 ${STATE_COUNTS_GAP_PX}`, `unknown 6 ${STATE_COUNTS_GAP_PX}`], isBoxPresent: true},
        none: {shown: [], isBoxPresent: false},
        strange: {shown: ['done 1 0'], isBoxPresent: true},
        states: ['blocked', 'working', 'done', 'idle', 'unknown'],
    });
});

test('sessionsTileSlots: a context tag shows its words, outlined when high; an absent tag is not outlined either', () =>
    assertEqual([
        {text: 'ctx 85%', isHigh: true}, {text: 'ctx 42%', isHigh: false}, null, undefined,
    ].map(contextTag => sessionsTileSlots.contextTagCell(contextTag)), [
        {isPresent: true, text: 'ctx 85%', isOutlined: true},
        {isPresent: true, text: 'ctx 42%', isOutlined: false},
        {isPresent: false, text: null, isOutlined: false},
        {isPresent: false, text: null, isOutlined: false},
    ]));
