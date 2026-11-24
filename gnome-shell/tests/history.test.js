// lib/history.js: the fixed-capacity ring buffer that holds the client's CPU and memory histories, which the card
// and the indicator draw; null marks a gap.
import {test, assertEqual} from './harness.js';
import {RingBuffer} from '../extensions/resource-pulse@zvibaratz.github.io/lib/history.js';

test('ring buffer drops the oldest and keeps null gaps', () => {
    const ring = new RingBuffer(3);
    [1, null, 3, 4].forEach(value => ring.push(value));
    assertEqual(ring.values(), [null, 3, 4]);
});
test('ring buffer lastValues returns the newest, oldest first, and clear empties it', () => {
    const ring = new RingBuffer(5);
    [1, 2, 3].forEach(value => ring.push(value));
    const newestTwo = ring.lastValues(2);
    ring.clear();
    assertEqual([newestTwo, ring.values()], [[2, 3], []]);
});
