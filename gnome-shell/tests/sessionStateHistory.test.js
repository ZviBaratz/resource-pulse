// lib/sessionStateHistory.js: an hour of each session's state, a cell a minute, from hand-driven minutes.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as sessionStateHistory from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionStateHistory.js';

const MINUTE_USEC = 60e6;
/** A minute well after the epoch, so that minutes before it are still positive. */
const FIRST_MINUTE = 29_000_000;
const KEY_A = '["p1","s1"]';
const KEY_B = '["p2","s2"]';
const CELLS_PER_HOUR = 60;

/**
 * Records each sample in turn into a new history.
 *
 * @param {Array<[number, Object<string, string>]>} samples - Each sample's minute and the state of each session key.
 * @returns {Map<string, string>} The letters by session key after the last sample.
 */
function lettersAfter(samples) {
    const history = new sessionStateHistory.SessionStateHistory();
    for (const [minuteIndex, stateBySessionKey] of samples)
        history.record(minuteIndex, new Map(Object.entries(stateBySessionKey)));
    return history.lettersBySessionKey();
}

test('sessionStateHistory: a session\'s first sample is one cell, its state\'s letter', () =>
    assertEqual([...lettersAfter([[FIRST_MINUTE, {[KEY_A]: 'working'}]])], [[KEY_A, 'w']]));

test('sessionStateHistory: two samples in one minute make one cell, the later sample\'s state', () =>
    assertEqual(lettersAfter([
        [FIRST_MINUTE, {[KEY_A]: 'working'}], [FIRST_MINUTE, {[KEY_A]: 'blocked'}],
    ]).get(KEY_A), 'b'));

test('sessionStateHistory: a sample in the next minute adds a cell after the last', () =>
    assertEqual(lettersAfter([
        [FIRST_MINUTE, {[KEY_A]: 'working'}], [FIRST_MINUTE + 1, {[KEY_A]: 'done'}],
    ]).get(KEY_A), 'wd'));

test('sessionStateHistory: a minute with no sample repeats the cell before it', () =>
    assertEqual(lettersAfter([
        [FIRST_MINUTE, {[KEY_A]: 'working'}], [FIRST_MINUTE + 4, {[KEY_A]: 'idle'}],
    ]).get(KEY_A), 'wwwwi'));

test('sessionStateHistory: at most 60 cells; the 61st minute drops the oldest', () => {
    const samples = Array.from({length: CELLS_PER_HOUR + 1},
        (_, minuteOffset) => [FIRST_MINUTE + minuteOffset, {[KEY_A]: minuteOffset === 0 ? 'blocked' : 'working'}]);
    const letters = lettersAfter(samples).get(KEY_A);
    assertEqual({length: letters.length, hasBlocked: letters.includes('b')},
        {length: CELLS_PER_HOUR, hasBlocked: false});
});

test('sessionStateHistory: a gap longer than the hour gives 59 repeats and the new cell', () =>
    assertEqual(lettersAfter([
        [FIRST_MINUTE, {[KEY_A]: 'idle'}], [FIRST_MINUTE + 1, {[KEY_A]: 'working'}],
        [FIRST_MINUTE + 1 + 500, {[KEY_A]: 'done'}],
    ]).get(KEY_A), `${'w'.repeat(CELLS_PER_HOUR - 1)}d`));

test('sessionStateHistory: a session missing from a sample is forgotten, and starts empty when it comes back', () =>
    assertEqual([...lettersAfter([
        [FIRST_MINUTE, {[KEY_A]: 'working', [KEY_B]: 'idle'}], [FIRST_MINUTE + 1, {[KEY_B]: 'idle'}],
        [FIRST_MINUTE + 2, {[KEY_A]: 'blocked', [KEY_B]: 'idle'}],
    ])], [[KEY_B, 'iii'], [KEY_A, 'b']]));

test('sessionStateHistory: the wall clock set back overwrites the last cell, and nothing is added or moved', () =>
    assertEqual(lettersAfter([
        [FIRST_MINUTE, {[KEY_A]: 'working'}], [FIRST_MINUTE + 1, {[KEY_A]: 'idle'}],
        [FIRST_MINUTE - 30, {[KEY_A]: 'blocked'}], [FIRST_MINUTE + 2, {[KEY_A]: 'done'}],
    ]).get(KEY_A), 'wbd'));

test('sessionStateHistory: each state has its letter; a state the protocol does not list is unknown\'s', () =>
    assertEqual(lettersAfter([[FIRST_MINUTE, {
        a: 'working', b: 'blocked', c: 'idle', d: 'done', e: 'unknown', f: 'asleep', g: undefined,
    }]]), new Map([['a', 'w'], ['b', 'b'], ['c', 'i'], ['d', 'd'], ['e', 'u'], ['f', 'u'], ['g', 'u']])));

test('sessionStateHistory: sessions are independent: one changing leaves the others\' cells as they were', () =>
    assertEqual([...lettersAfter([
        [FIRST_MINUTE, {[KEY_A]: 'working', [KEY_B]: 'idle'}],
        [FIRST_MINUTE + 1, {[KEY_A]: 'blocked', [KEY_B]: 'idle'}],
        [FIRST_MINUTE + 1, {[KEY_A]: 'working', [KEY_B]: 'idle'}],
    ])], [[KEY_A, 'ww'], [KEY_B, 'ii']]));

test('sessionStateHistory: a sample\'s minute is its wall-clock time in whole minutes since the epoch', () =>
    assertEqual([0, MINUTE_USEC - 1, MINUTE_USEC, FIRST_MINUTE * MINUTE_USEC + 59e6].map(
        sessionStateHistory.minuteIndexOfUsec), [0, 0, 1, FIRST_MINUTE]));
