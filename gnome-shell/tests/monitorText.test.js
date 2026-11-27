// lib/monitorText.js: the monitor tile's words in its forms by tracks, on the desktop card's own figures, lines and meters
// (lib/format.js cardText), so a number reads the same on both.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as monitorText from '../extensions/resource-pulse@zvibaratz.github.io/lib/monitorText.js';
import {cardText} from '../extensions/resource-pulse@zvibaratz.github.io/lib/format.js';
import {MONITOR_MINUTE_LABEL_COUNT} from '../extensions/resource-pulse@zvibaratz.github.io/lib/monitorGeometry.js';

const GIB = 1024 ** 3;

// A whole Snapshot as the sampler publishes it (lib/protocol.js's Snapshot).
const SNAPSHOT = {
    takenAtUsec: 1_000_000,
    takenAtClockLabel: '14:02',
    cpuBusyPercent: 23,
    cpuClusters: {performancePercent: 41, efficiencyPercent: 6},
    memory: {usedBytes: 16.4 * GIB, totalBytes: 30.3 * GIB},
    swap: {zramUsedBytes: 1.6 * GIB, zramRamBytes: 0.4 * GIB, diskBytes: 2.1 * GIB},
    pressureAvg10: {cpu: 12, memory: 3, io: 0},
    apps: {topCpu: {name: 'Chromium', cpuPercent: 31}, topMemory: {name: 'herdr agents', memoryBytes: 15.7 * GIB}},
    isComplete: true,
};
// The snapshot a failed tick publishes: every number null.
const FAILED_TICK_SNAPSHOT = {
    takenAtUsec: 3_000_000, takenAtClockLabel: '14:04', cpuBusyPercent: null, cpuClusters: null, memory: null,
    swap: null, pressureAvg10: {cpu: null, memory: null, io: null}, apps: null, isComplete: false,
};
/** The machine's conditions with CPU waited on and swap growing on disk. */
const STRAINED_CONDITIONS = {waits: {cpu: true, memory: false, io: false}, isSwapping: true};

test('monitorText with every part: the tracks\' names without their heaviest apps, CPU\'s scale and memory\'s installed ' +
    'memory as the scale, the card\'s figures, CPU\'s line and memory\'s swap lines without "of", and the five ' +
    'minutes; the agents track\'s present is the tile\'s own (agentsPresentText)', () =>
    assertEqual(monitorText.monitorText({snapshot: SNAPSHOT, lastGoodClockLabel: '14:02',
        conditions: STRAINED_CONDITIONS}), {
        cpuTrack: {
            label: 'CPU', scaleLabel: {text: '100%', isMissing: false},
            figure: {figure: '23', unit: '%', isMissing: false},
            detailLines: [{text: 'P 41 · E 6', isWait: false}],
        },
        memoryTrack: {
            label: 'Memory', scaleLabel: {text: '30.3 GiB', isMissing: false},
            figure: {figure: '16.4', unit: 'GiB', isMissing: false},
            detailLines: [{text: 'swap 1.6 · 0.4 in RAM', isWait: false}, {text: '+ 2.1 on disk', isWait: true}],
        },
        waitingOnLabel: 'Waiting on',
        meters: [
            {name: 'cpu', percentText: '12%', band: 1, isWait: true},
            {name: 'mem', percentText: '3%', band: 0, isWait: false},
            {name: 'io', percentText: '0%', band: 0, isWait: false},
        ],
        minuteLabels: ['5 min', '4 min', '3 min', '2 min', '1 min'],
        axisNowLabel: 'now',
    }));

test('monitorText: the figures, the CPU line and the meters are the card\'s own, part for part', () => {
    const card = cardText(SNAPSHOT, '14:02', STRAINED_CONDITIONS);
    const monitor = monitorText.monitorText({snapshot: SNAPSHOT, lastGoodClockLabel: '14:02',
        conditions: STRAINED_CONDITIONS});
    assertEqual([monitor.cpuTrack.figure, monitor.memoryTrack.figure, monitor.cpuTrack.detailLines, monitor.meters,
        monitor.waitingOnLabel, monitor.minuteLabels[0], monitor.axisNowLabel],
    [card.cpuFigure, card.memoryFigure, card.cpuDetailLines, card.meters, card.waitingOnLabel, card.axisStartLabel,
        card.axisNowLabel]);
});

test('monitorText before any snapshot: dashes, "no data" under CPU, no swap lines, CPU\'s scale standing and ' +
    'memory\'s a faint dash, never a zero', () => {
    const monitor = monitorText.monitorText({snapshot: null, lastGoodClockLabel: null});
    assertEqual([monitor.cpuTrack, monitor.memoryTrack], [
        {label: 'CPU', scaleLabel: {text: '100%', isMissing: false}, figure: {figure: '—', unit: '', isMissing: true},
            detailLines: [{text: 'no data', isWait: false}]},
        {label: 'Memory', scaleLabel: {text: '—', isMissing: true}, figure: {figure: '—', unit: '', isMissing: true},
            detailLines: []},
    ]);
});

test('monitorText after a failed tick: since when under the CPU figure; memory\'s scale a dash, not the last good ' +
    'total', () => {
    const monitor = monitorText.monitorText({snapshot: FAILED_TICK_SNAPSHOT, lastGoodClockLabel: '14:02'});
    assertEqual([monitor.cpuTrack.detailLines, monitor.memoryTrack.scaleLabel, monitor.memoryTrack.detailLines],
        [[{text: 'no data since 14:02', isWait: false}], {text: '—', isMissing: true}, []]);
});

test('monitorText: memory\'s lines with no swap reading and with nothing swapped are the card\'s one line after "of"', () =>
    assertEqual([null, {zramUsedBytes: 0, zramRamBytes: 0, diskBytes: 0}].map(swap =>
        monitorText.monitorText({snapshot: {...SNAPSHOT, swap}, lastGoodClockLabel: '14:02'}).memoryTrack.detailLines),
    [[{text: 'swap no data', isWait: false}], [{text: 'swap none', isWait: false}]]));

test('agentsPresentText: one agent in the singular, every other count in the plural, 0 included; a dash while the ' +
    'count is not known, never a zero', () =>
    assertEqual([0, 1, 2, 7, 88, null, undefined, -1, 2.5, NaN, '3'].map(monitorText.agentsPresentText), [
        '0 agents working', '1 agent working', '2 agents working', '7 agents working', '88 agents working',
        '—', '—', '—', '—', '—', '—',
    ]));

test('monitorText: the minute labels run from the plot\'s left end, one a minute, as many as the geometry places', () =>
    assertEqual([monitorText.MONITOR_MINUTE_LABELS, monitorText.MONITOR_MINUTE_LABELS.length],
        [['5 min', '4 min', '3 min', '2 min', '1 min'], MONITOR_MINUTE_LABEL_COUNT]));
