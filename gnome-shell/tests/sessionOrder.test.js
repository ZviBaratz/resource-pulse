// lib/sessionOrder.js: the sessions by urgency, as the sessions card and the dropdown draw them, from synthetic rows.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as sessionOrder from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionOrder.js';

const MIB = 1024 * 1024;

/**
 * @param {string} name - The session's name, which is also its id here.
 * @param {string} state - Its state.
 * @param {object} [cells] - Its idle age and memory; each defaults to a known value.
 * @param {number|null} [cells.idleSeconds] - The idle age.
 * @param {number|null} [cells.memoryBytes] - The memory.
 * @returns {object} A session row, as parseSessionsSource reads one (only the fields the order reads).
 */
function row(name, state, {idleSeconds = 60, memoryBytes = 100 * MIB} = {}) {
    return {id: name, name, state, idleSeconds, memoryBytes};
}

/**
 * @param {Array<object>} rows - Session rows, in the service's order.
 * @returns {string[]} Their ids by urgency.
 */
function idsByUrgency(rows) {
    return sessionOrder.sessionsByUrgency(rows).map(session => session.id);
}

test('sessionOrder: the bays come waiting on you, working, done, idle, unknown, whatever the service\'s order', () =>
    assertEqual(idsByUrgency([
        row('u', 'unknown'), row('i', 'idle'), row('d', 'done'), row('w', 'working'), row('b', 'blocked'),
    ]), ['b', 'w', 'd', 'i', 'u']));

test('sessionOrder: waiting on you puts the longest idle age first', () =>
    assertEqual(idsByUrgency([
        row('b-short', 'blocked', {idleSeconds: 30}), row('b-long', 'blocked', {idleSeconds: 3600}),
        row('b-mid', 'blocked', {idleSeconds: 600}),
    ]), ['b-long', 'b-mid', 'b-short']));

test('sessionOrder: working puts the largest memory first, today\'s order, whatever its idle age', () =>
    assertEqual(idsByUrgency([
        row('w-small', 'working', {memoryBytes: 10 * MIB, idleSeconds: 1}),
        row('w-large', 'working', {memoryBytes: 900 * MIB, idleSeconds: 500}),
        row('w-mid', 'working', {memoryBytes: 300 * MIB}),
    ]), ['w-large', 'w-mid', 'w-small']));

test('sessionOrder: done, idle and unknown each put the most recently active first, whatever its memory', () =>
    assertEqual(idsByUrgency([
        row('i-old', 'idle', {idleSeconds: 7200, memoryBytes: 900 * MIB}), row('i-new', 'idle', {idleSeconds: 5}),
        row('d-old', 'done', {idleSeconds: 900}), row('d-new', 'done', {idleSeconds: 90}),
        row('u-old', 'unknown', {idleSeconds: 99999}), row('u-new', 'unknown', {idleSeconds: 1}),
    ]), ['d-new', 'd-old', 'i-new', 'i-old', 'u-new', 'u-old']));

test('sessionOrder: a session with no known age goes last in a bay ordered by age (waiting, done, idle, unknown)',
    () => assertEqual(idsByUrgency([
        row('b-no-age', 'blocked', {idleSeconds: null}), row('b-aged', 'blocked', {idleSeconds: 1}),
        row('d-no-age', 'done', {idleSeconds: null}), row('d-aged', 'done', {idleSeconds: 99999}),
        row('i-no-age', 'idle', {idleSeconds: null}), row('i-aged', 'idle', {idleSeconds: 99999}),
        row('u-no-age', 'unknown', {idleSeconds: null}), row('u-aged', 'unknown', {idleSeconds: 99999}),
    ]), ['b-aged', 'b-no-age', 'd-aged', 'd-no-age', 'i-aged', 'i-no-age', 'u-aged', 'u-no-age']));

test('sessionOrder: a session with no known memory goes last among working; an unknown age there changes nothing',
    () => assertEqual(idsByUrgency([
        row('w-no-memory', 'working', {memoryBytes: null}), row('w-tiny', 'working', {memoryBytes: 1}),
        row('w-no-age', 'working', {idleSeconds: null, memoryBytes: 2}),
    ]), ['w-no-age', 'w-tiny', 'w-no-memory']));

test('sessionOrder: in a bay ordered by age an unknown memory changes nothing, and is never put last for it', () =>
    assertEqual(idsByUrgency([
        row('b-no-memory', 'blocked', {idleSeconds: 900, memoryBytes: null}),
        row('b-memory', 'blocked', {idleSeconds: 9}),
    ]), ['b-no-memory', 'b-memory']));

test('sessionOrder: a tie, and the sessions put last, are by name; a tie of names keeps the service\'s order', () =>
    assertEqual(idsByUrgency([
        {...row('second', 'idle', {idleSeconds: 10}), name: 'same'},
        row('zeta', 'idle', {idleSeconds: 10}),
        {...row('first', 'idle', {idleSeconds: 10}), name: 'same'},
        row('alpha', 'idle', {idleSeconds: 10}),
        row('y-no-age', 'idle', {idleSeconds: null}), row('x-no-age', 'idle', {idleSeconds: null}),
    ]), ['alpha', 'second', 'first', 'zeta', 'x-no-age', 'y-no-age']));

test('sessionOrder: idle age 0 and memory 0 are known values, not missing ones', () =>
    assertEqual(idsByUrgency([
        row('w-zero', 'working', {memoryBytes: 0}), row('w-no-memory', 'working', {memoryBytes: null}),
        row('i-no-age', 'idle', {idleSeconds: null}), row('i-zero', 'idle', {idleSeconds: 0}),
    ]), ['w-zero', 'w-no-memory', 'i-zero', 'i-no-age']));

test('sessionOrder: the rows are a new list, the given one untouched; none is no rows', () => {
    const rows = [row('i', 'idle'), row('b', 'blocked')];
    const ordered = sessionOrder.sessionsByUrgency(rows);
    assertEqual({given: rows.map(session => session.id), ordered: ordered.map(session => session.id),
        isSameRow: ordered[1] === rows[0], none: sessionOrder.sessionsByUrgency([])},
    {given: ['i', 'b'], ordered: ['b', 'i'], isSameRow: true, none: []});
});

test('sessionOrder: SESSION_BAY_ORDER is the bays from the most urgent, every session state once', () =>
    assertEqual(sessionOrder.SESSION_BAY_ORDER, ['blocked', 'working', 'done', 'idle', 'unknown']));
