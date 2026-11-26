// lib/missedTicks.js: how many gaps the client pushes before a Sample's values for the ticks its sampler missed, its
// own gaps for the same silence counted against them, at most a history's length.
import {test, assertEqual} from './harness.js';
import {gapsToPushBefore} from '../extensions/resource-pulse@zvibaratz.github.io/lib/missedTicks.js';
import {CARD_HISTORY_SAMPLES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

test('missed ticks: a Sample that missed none pushes no gap; one that missed three pushes three', () => {
    assertEqual([gapsToPushBefore(0, 0, CARD_HISTORY_SAMPLES), gapsToPushBefore(3, 0, CARD_HISTORY_SAMPLES)], [0, 3]);
});

test('missed ticks: the client\'s own gap stands for one of the missed ticks, so no tick is counted twice: after its ' +
    'own gap, a count of five pushes four, a count of one pushes none, and a count of none leaves its gap alone', () => {
    const ownGapCount = 1;
    assertEqual([5, 1, 0].map(missedTickCount => gapsToPushBefore(missedTickCount, ownGapCount, CARD_HISTORY_SAMPLES)),
        [4, 0, 0]);
});

test('missed ticks: a count past the history is held to its length, less the client\'s own gaps', () => {
    assertEqual([
        gapsToPushBefore(21_600, 0, CARD_HISTORY_SAMPLES),
        gapsToPushBefore(21_600, 1, CARD_HISTORY_SAMPLES),
    ], [CARD_HISTORY_SAMPLES, CARD_HISTORY_SAMPLES - 1]);
});

test('missed ticks: a sampler from before the count (null) is read as none missed, so only the client\'s own gap ' +
    'shows the silence, one slot wide', () => {
    assertEqual([gapsToPushBefore(null, 0, CARD_HISTORY_SAMPLES), gapsToPushBefore(null, 1, CARD_HISTORY_SAMPLES)],
        [0, 0]);
});
