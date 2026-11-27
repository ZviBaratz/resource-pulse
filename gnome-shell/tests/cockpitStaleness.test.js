// lib/cockpitStaleness.js: when a cockpit source is suspected, pulled and called stale, and the label a
// stale card draws.
import {test, assertEqual} from './harness.js';
import * as staleness from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitStaleness.js';

const BASE_INPUT = {sampledAtUsec: 0, intervalSeconds: 10, lastPullRequestedAtUsec: null, lastPullCompletedAtUsec: null};

test('cockpitStaleness: fresh, suspicious-but-unpulled, pulled-and-still-old', () => {
    const base = BASE_INPUT;
    assertEqual(staleness.sourceFreshness({...base, nowRealUsec: 20e6}), {isStale: false, shouldPull: false, ageSeconds: 20});
    assertEqual(staleness.sourceFreshness({...base, nowRealUsec: 31e6}), {isStale: false, shouldPull: true, ageSeconds: 31});
    assertEqual(staleness.sourceFreshness({...base, nowRealUsec: 31e6, lastPullRequestedAtUsec: 25e6}), {isStale: false, shouldPull: false, ageSeconds: 31});
    assertEqual(staleness.sourceFreshness({...base, nowRealUsec: 31e6, lastPullRequestedAtUsec: 30.5e6, lastPullCompletedAtUsec: 30.6e6}), {isStale: true, shouldPull: false, ageSeconds: 31});
    assertEqual(staleness.sourceFreshness({...base, sampledAtUsec: null, nowRealUsec: 1}), {isStale: true, shouldPull: false, ageSeconds: null});
});

test('cockpitStaleness: exactly three intervals old is still fresh; a pull older than one interval may be repeated', () => {
    assertEqual(staleness.sourceFreshness({...BASE_INPUT, nowRealUsec: 30e6}).shouldPull, false);
    const repeated = staleness.sourceFreshness({
        ...BASE_INPUT, nowRealUsec: 45e6, lastPullRequestedAtUsec: 31e6, lastPullCompletedAtUsec: 31.1e6,
    });
    assertEqual(repeated, {isStale: true, shouldPull: true, ageSeconds: 45});
});

test('cockpitStaleness: a pull that completed before the stamp does not make a source stale', () => {
    const result = staleness.sourceFreshness({
        ...BASE_INPUT, sampledAtUsec: 5e6, nowRealUsec: 40e6, lastPullRequestedAtUsec: 1e6, lastPullCompletedAtUsec: 2e6,
    });
    assertEqual(result.isStale, false);
});

test('cockpitStaleness: a null, zero or non-number interval counts as 60 seconds', () => {
    for (const intervalSeconds of [null, 0, 'ten']) {
        const input = {...BASE_INPUT, intervalSeconds};
        assertEqual(staleness.sourceFreshness({...input, nowRealUsec: 179e6}).shouldPull, false);
        assertEqual(staleness.sourceFreshness({...input, nowRealUsec: 181e6}).shouldPull, true);
    }
});

test('cockpitStaleness: isSourceStaleAt is sourceFreshness\'s verdict from plain numbers, at every stamp (none, not ' +
    'finite, old, recent), interval (none, 0, 10 s), clock (fresh, suspect, stepped back, long after) and pull (none, ' +
    'before the stamp, after it)', () => {
    const stamps = [null, Number.NaN, 0, 50e6];
    const intervals = [null, 0, 10];
    const clocks = [20e6, 31e6, 40e6, 400e6];
    const pullsCompleted = [null, 25e6, 30.6e6, 60e6];
    const verdicts = [];
    for (const sampledAtUsec of stamps) {
        for (const intervalSeconds of intervals) {
            for (const nowRealUsec of clocks) {
                for (const lastPullCompletedAtUsec of pullsCompleted) {
                    const {isStale} = staleness.sourceFreshness({
                        sampledAtUsec, intervalSeconds, nowRealUsec, lastPullRequestedAtUsec: null,
                        lastPullCompletedAtUsec,
                    });
                    const isStaleAt = staleness.isSourceStaleAt(sampledAtUsec, intervalSeconds, nowRealUsec,
                        lastPullCompletedAtUsec);
                    verdicts.push({isStale, isAgreed: isStaleAt === isStale});
                }
            }
        }
    }
    assertEqual({
        cases: verdicts.length, disagreements: verdicts.filter(verdict => !verdict.isAgreed).length,
        staleCases: verdicts.filter(verdict => verdict.isStale).length,
    }, {cases: 192, disagreements: 0, staleCases: 114});
});

test('cockpitStaleness: a clock that stepped back gives a negative age and a fresh source', () => {
    assertEqual(staleness.sourceFreshness({...BASE_INPUT, sampledAtUsec: 50e6, nowRealUsec: 40e6}),
        {isStale: false, shouldPull: false, ageSeconds: -10});
});

test('cockpitStaleness: a stamp that is not a finite number (undefined, NaN, Infinity) reads as no stamp: stale, ' +
    'never pulled, never fresh for ever', () => {
    assertEqual([undefined, NaN, Infinity].map(sampledAtUsec =>
        staleness.sourceFreshness({...BASE_INPUT, sampledAtUsec, nowRealUsec: 40e6})), [
        {isStale: true, shouldPull: false, ageSeconds: null},
        {isStale: true, shouldPull: false, ageSeconds: null},
        {isStale: true, shouldPull: false, ageSeconds: null},
    ]);
});

test('cockpitStaleness: the no-data label uses the injected clock, and says so when nothing was ever sampled', () => {
    const formatClock = usec => `clock(${usec})`;
    assertEqual(staleness.noDataSinceLabel(7e6, formatClock), 'no data since clock(7000000)');
    assertEqual(staleness.noDataSinceLabel(null, formatClock), 'no data');
});
