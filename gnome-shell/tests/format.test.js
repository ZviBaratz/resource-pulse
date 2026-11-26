import {test, assertEqual} from './harness.js';
import {
    formatGibibytes, formatMemorySize, formatWholeGibibytes, formatWholePercent, memoryLine, clusterSuffix, hoverLabel,
    cardText,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/format.js';
import {MachineCaption} from '../extensions/resource-pulse@zvibaratz.github.io/lib/machineCaptions.js';
import {NO_MACHINE_CONDITIONS} from '../extensions/resource-pulse@zvibaratz.github.io/lib/machineConditions.js';
import {cardPosition, hoverLabelPosition, tooltipPosition} from '../extensions/resource-pulse@zvibaratz.github.io/lib/layout.js';

const GIB = 1024 ** 3;
const CARD_WIDTH_PX = 340;
const CARD_MARGIN_PX = 24;
const SECOND_MONITOR_X_PX = 1536;
// The hover label's rows: a 1536 px wide monitor, a 32 px panel, the indicator's size, the label's width as the
// nested run measured it, and the stylesheet's 8 px gap under the indicator.
const MONITOR_WIDTH_PX = 1536;
const INDICATOR_WIDTH_PX = 88;
const INDICATOR_HEIGHT_PX = 32;
const HOVER_LABEL_WIDTH_PX = 236;
const HOVER_LABEL_GAP_PX = 8;
const LEFT_MONITOR = {x: 0, width: MONITOR_WIDTH_PX};
/** A monitor to the right of a 1920 px wide one, so it is not the leftmost. */
const RIGHT_MONITOR = {x: 1920, width: MONITOR_WIDTH_PX};

/**
 * The indicator's stage rectangle at a given x, in the top bar.
 *
 * @param {number} x - Its left edge.
 * @returns {{x: number, y: number, width: number, height: number}} The rectangle.
 */
const indicatorAt = x => ({x, y: 0, width: INDICATOR_WIDTH_PX, height: INDICATOR_HEIGHT_PX});

/**
 * Builds a swap summary in the shape of lib/protocol.js's Snapshot.swap.
 *
 * @param {number} zramUsedBytes - Swap in use on zram areas.
 * @param {number} zramRamBytes - RAM those zram devices take.
 * @param {number} diskBytes - Swap in use on every other area.
 * @returns {object} A swap summary.
 */
const swapOf = (zramUsedBytes, zramRamBytes, diskBytes) => ({zramUsedBytes, zramRamBytes, diskBytes});

const FULL_SNAPSHOT = {
    cpuBusyPercent: 23, memory: {usedBytes: 16.4 * GIB, totalBytes: 30.3 * GIB},
};

// A whole Snapshot as the sampler publishes it (lib/protocol.js's Snapshot), for the desktop card's rows.
const CARD_SNAPSHOT = {
    takenAtUsec: 1_000_000,
    takenAtClockLabel: '14:02',
    cpuBusyPercent: 23,
    cpuClusters: {performancePercent: 41, efficiencyPercent: 6},
    memory: FULL_SNAPSHOT.memory,
    swap: swapOf(1.6 * GIB, 0.4 * GIB, 0),
    pressureAvg10: {cpu: 12, memory: 3, io: 0},
    apps: {topCpu: {name: 'Chromium', cpuPercent: 31}, topMemory: {name: 'herdr agents', memoryBytes: 15.7 * GIB}},
    isComplete: true,
};
// The snapshot a failed tick publishes (resource-pulse-sampler/src/sampler/snapshot.rs, no_data): every number null.
const FAILED_TICK_SNAPSHOT = {
    takenAtUsec: 3_000_000,
    takenAtClockLabel: '14:04',
    cpuBusyPercent: null,
    cpuClusters: null,
    memory: null,
    swap: null,
    pressureAvg10: {cpu: null, memory: null, io: null},
    apps: null,
    isComplete: false,
};
/** The machine's conditions with CPU and io waited on and swap growing on disk. */
const STRAINED_CONDITIONS = {waits: {cpu: true, memory: false, io: true}, isSwapping: true};
/** What the card's sections, figures and meters read with no numbers at all. */
const CARD_NO_DATA_PARTS = {
    cpuSection: {name: 'CPU', heaviestName: '', heaviestValue: ''},
    memorySection: {name: 'Memory', heaviestName: '', heaviestValue: ''},
    cpuFigure: {figure: '—', unit: '', isMissing: true},
    memoryFigure: {figure: '—', unit: '', isMissing: true},
    memoryDetailLines: [],
    meters: [
        {name: 'cpu', percentText: '', band: null, isWait: false},
        {name: 'mem', percentText: '', band: null, isWait: false},
        {name: 'io', percentText: '', band: null, isWait: false},
    ],
};

/**
 * The texts of the lines under the memory figure for a swap summary, with the amber flag of each.
 *
 * @param {object|null} swap - A swap summary.
 * @param {boolean} [isSwapping] - Whether swap on disk grows.
 * @returns {Array<[string, boolean]>} Each line's text and whether it is amber.
 */
const memoryLinesFor = (swap, isSwapping = false) =>
    cardText({...CARD_SNAPSHOT, swap}, '14:02', {...NO_MACHINE_CONDITIONS, isSwapping}).memoryDetailLines
        .map(({text, isWait}) => [text, isWait]);

/**
 * Picks the given fields of an object, so a row compares only what it is about.
 *
 * @param {object} source - The object.
 * @param {string[]} fieldNames - Fields to keep.
 * @returns {object} Those fields, in the order given.
 */
const pickFields = (source, fieldNames) => Object.fromEntries(fieldNames.map(fieldName => [fieldName, source[fieldName]]));

test('formatGibibytes uses 1024^3, not 1000^3', () => assertEqual(formatGibibytes(20480000000), '19.1'));
test('formatGibibytes rounds to one decimal rather than truncating', () => assertEqual(formatGibibytes(1.96 * GIB), '2.0'));
test('formatWholePercent rounds (22.5 → 23%, not 22%)', () => assertEqual(formatWholePercent(22.5), '23%'));
test('memoryLine: used of total GiB', () =>
    assertEqual(memoryLine({usedBytes: 20480000000, totalBytes: 32768000000}), '19.1 of 30.5 GiB'));
test('memoryLine: null is "no data"', () => assertEqual(memoryLine(null), 'no data'));

test('clusterSuffix both sides', () =>
    assertEqual(clusterSuffix({performancePercent: 80, efficiencyPercent: 40}), 'P 80 · E 40'));
test('clusterSuffix rounds each side', () =>
    assertEqual(clusterSuffix({performancePercent: 79.6, efficiencyPercent: 40.4}), 'P 80 · E 40'));
test('clusterSuffix null is empty', () => assertEqual(clusterSuffix(null), ''));
test('clusterSuffix with one side null shows only the other', () =>
    assertEqual([clusterSuffix({performancePercent: 80, efficiencyPercent: null}),
        clusterSuffix({performancePercent: null, efficiencyPercent: 40}),
        clusterSuffix({performancePercent: null, efficiencyPercent: null})], ['P 80', 'E 40', '']));

test('formatMemorySize: GiB with one decimal from what rounds to 1024 MiB up, whole MiB below, a dash unknown', () =>
    assertEqual([11.9 * GIB, 910 * 1024 * 1024, 1023.6 * 1024 * 1024, null].map(formatMemorySize),
        ['11.9G', '910M', '1.0G', '—']));

test('formatWholeGibibytes: a free space is whole GiB from 10 G and has one decimal under it, never "10.0G"', () =>
    assertEqual([0, 0.04, 9.6, 9.94, 9.96, 10, 212.4, 1117.6].map(gibibytes => formatWholeGibibytes(gibibytes * GIB)),
        ['0.0G', '0.0G', '9.6G', '9.9G', '10G', '10G', '212G', '1118G']));

test('cardText with every part: each section names its heaviest app, the figures and their lines, the meters and the ' +
    'axis', () =>
    assertEqual(cardText(CARD_SNAPSHOT, '14:02'), {
        cpuSection: {name: 'CPU', heaviestName: 'Chromium', heaviestValue: '31%'},
        memorySection: {name: 'Memory', heaviestName: 'herdr agents', heaviestValue: '15.7G'},
        cpuFigure: {figure: '23', unit: '%', isMissing: false},
        memoryFigure: {figure: '16.4', unit: 'GiB', isMissing: false},
        cpuDetailLines: [{text: 'P 41 · E 6', isWait: false}],
        memoryDetailLines: [{text: 'of 30.3', isWait: false}, {text: 'swap 1.6 · 0.4 in RAM', isWait: false}],
        waitingOnLabel: 'Waiting on',
        meters: [
            {name: 'cpu', percentText: '12%', band: 1, isWait: false},
            {name: 'mem', percentText: '3%', band: 0, isWait: false},
            {name: 'io', percentText: '0%', band: 0, isWait: false},
        ],
        axisStartLabel: '5 min',
        axisNowLabel: 'now',
    }));

test('cardText: a figure rounds CPU to a whole percent and memory to a tenth of a GiB', () => {
    const {cpuFigure, memoryFigure} = cardText({...CARD_SNAPSHOT, cpuBusyPercent: 22.5,
        memory: {usedBytes: 1.96 * GIB, totalBytes: 30.3 * GIB}}, '14:02');
    assertEqual([cpuFigure.figure, memoryFigure.figure], ['23', '2.0']);
});

test('cardText: swap in zram and on disk leads with zram\'s part and its RAM, then adds what is on disk', () =>
    assertEqual(memoryLinesFor({zramUsedBytes: 1.6 * GIB, zramRamBytes: 0.4 * GIB, diskBytes: 0.5 * GIB}), [
        ['of 30.3', false], ['swap 1.6 · 0.4 in RAM', false], ['+ 0.5 on disk', false],
    ]));

test('cardText: swap on disk alone has no "0.0 in RAM", nothing swapped is "swap none", and no swap reading is ' +
    '"swap no data"', () =>
    assertEqual([
        memoryLinesFor({zramUsedBytes: 0, zramRamBytes: 0, diskBytes: 0.5 * GIB}),
        memoryLinesFor({zramUsedBytes: 0, zramRamBytes: 0, diskBytes: 0}),
        memoryLinesFor(null),
    ], [
        [['of 30.3', false], ['swap 0.5 on disk', false]],
        [['of 30.3', false], ['swap none', false]],
        [['of 30.3', false], ['swap no data', false]],
    ]));

test('cardText: swap on disk is amber only while it grows, its line alone, with zram or without', () =>
    assertEqual([
        memoryLinesFor({zramUsedBytes: 1.6 * GIB, zramRamBytes: 0.4 * GIB, diskBytes: 0.5 * GIB}, true),
        memoryLinesFor({zramUsedBytes: 0, zramRamBytes: 0, diskBytes: 0.5 * GIB}, true),
        memoryLinesFor({zramUsedBytes: 1.6 * GIB, zramRamBytes: 0.4 * GIB, diskBytes: 0}, true),
    ], [
        [['of 30.3', false], ['swap 1.6 · 0.4 in RAM', false], ['+ 0.5 on disk', true]],
        [['of 30.3', false], ['swap 0.5 on disk', true]],
        [['of 30.3', false], ['swap 1.6 · 0.4 in RAM', false]],
    ]));

test('cardText: each meter reads its avg10 now and is amber where its resource is waited on', () =>
    assertEqual(cardText({...CARD_SNAPSHOT, pressureAvg10: {cpu: 31.4, memory: 4, io: 60}}, '14:02',
        STRAINED_CONDITIONS).meters, [
        {name: 'cpu', percentText: '31%', band: 2, isWait: true},
        {name: 'mem', percentText: '4%', band: 0, isWait: false},
        {name: 'io', percentText: '60%', band: 3, isWait: true},
    ]));

test('cardText before any snapshot: dashes and no line under memory, never a zero; "no data" under CPU; nothing ' +
    'amber', () =>
    assertEqual(pickFields(cardText(null, null), [...Object.keys(CARD_NO_DATA_PARTS), 'cpuDetailLines']),
        {...CARD_NO_DATA_PARTS, cpuDetailLines: [{text: 'no data', isWait: false}]}));

test('cardText after a failed tick: since when under the CPU figure, every other part no data', () =>
    assertEqual(pickFields(cardText(FAILED_TICK_SNAPSHOT, '14:02'), [...Object.keys(CARD_NO_DATA_PARTS),
        'cpuDetailLines']), {...CARD_NO_DATA_PARTS, cpuDetailLines: [{text: 'no data since 14:02', isWait: false}]}));

test('cardText partial: a first sample says plain "no data" under a dash for CPU; a missing memory reading has a ' +
    'dash and no lines', () => {
    const firstSample = cardText({...CARD_SNAPSHOT, cpuBusyPercent: null, cpuClusters: null}, '14:02');
    const memoryMissing = cardText({...CARD_SNAPSHOT, memory: null}, '14:02');
    assertEqual({
        firstSample: [firstSample.cpuFigure.figure, firstSample.cpuDetailLines, firstSample.memoryFigure.figure],
        memoryMissing: [memoryMissing.memoryFigure, memoryMissing.memoryDetailLines, memoryMissing.cpuFigure.figure],
    }, {
        firstSample: ['—', [{text: 'no data', isWait: false}], '16.4'],
        memoryMissing: [{figure: '—', unit: '', isMissing: true}, [], '23'],
    });
});

test('cardText: a CPU with no cluster reading has no line under its figure', () =>
    assertEqual(cardText({...CARD_SNAPSHOT, cpuClusters: null}, '14:02').cpuDetailLines, []));

test('cardText: a top CPU entry at 0.6 % makes the section read "CPU idle" with no value; at 1.0 % it keeps its name ' +
    'and percent', () => {
    const sectionAt = cpuPercent => cardText({...CARD_SNAPSHOT,
        apps: {...CARD_SNAPSHOT.apps, topCpu: {name: 'Chromium', cpuPercent}}}, '14:02').cpuSection;
    assertEqual([sectionAt(0.6), sectionAt(1.0)], [
        {name: 'CPU', heaviestName: 'idle', heaviestValue: ''},
        {name: 'CPU', heaviestName: 'Chromium', heaviestValue: '1%'},
    ]);
});

test('cardText: an app\'s name is whole, never cut to a character count (the card ellipsizes it by width), and a ' +
    'small one\'s memory reads in MiB', () => {
    const longName = 'org.gnome.Nautilus.FileManagerSearchProvider';
    const {cpuSection, memorySection} = cardText({...CARD_SNAPSHOT, apps: {topCpu: {name: longName, cpuPercent: 4},
        topMemory: {name: 'Files', memoryBytes: 310 * 1024 * 1024}}}, '14:02');
    assertEqual([cpuSection.heaviestName, memorySection.heaviestValue], [longName, '310M']);
});

test('cardText: one ranking missing leaves its section\'s name alone', () => {
    const {cpuSection, memorySection} = cardText({...CARD_SNAPSHOT, apps: {topCpu: null,
        topMemory: CARD_SNAPSHOT.apps.topMemory}}, '14:02');
    assertEqual([cpuSection, memorySection.heaviestName],
        [{name: 'CPU', heaviestName: '', heaviestValue: ''}, 'herdr agents']);
});

test('hoverLabel with cpu and memory', () =>
    assertEqual(hoverLabel(FULL_SNAPSHOT, '14:02'), 'cpu 23% · mem 16.4 of 30.3 GiB'));
test('hoverLabel without a snapshot says since when, never stale numbers', () =>
    assertEqual(hoverLabel(null, '14:02'), 'no data since 14:02'));
test('hoverLabel with neither cpu nor memory is "no data since"', () =>
    assertEqual(hoverLabel({cpuBusyPercent: null, memory: null}, '14:02'), 'no data since 14:02'));
test('hoverLabel partial: the missing half says "no data", the present half stays', () =>
    assertEqual([hoverLabel({cpuBusyPercent: 23, memory: null}, '14:02'),
        hoverLabel({cpuBusyPercent: null, memory: FULL_SNAPSHOT.memory}, '14:02')],
    ['cpu 23% · mem no data', 'cpu no data · mem 16.4 of 30.3 GiB']));
test('hoverLabel with no last-good time is plain "no data"', () => assertEqual(hoverLabel(null, null), 'no data'));
test('hoverLabel names the lit captions after the summary, separated by commas; with none lit it is the summary ' +
    'alone', () =>
    assertEqual([
        hoverLabel(FULL_SNAPSHOT, '14:02', [MachineCaption.CPU_WAIT, MachineCaption.SWAPPING]),
        hoverLabel(null, '14:02', [MachineCaption.MACHINE_STALE]),
        hoverLabel(FULL_SNAPSHOT, '14:02', []),
    ], [
        'cpu 23% · mem 16.4 of 30.3 GiB · CPU wait, Swapping',
        'no data since 14:02 · Machine stale',
        'cpu 23% · mem 16.4 of 30.3 GiB',
    ]));

test('cardPosition: top-right of the work area, inset by the margin', () =>
    assertEqual(cardPosition({x: 0, y: 32, width: 1536, height: 928}, CARD_WIDTH_PX, CARD_MARGIN_PX), {x: 1172, y: 56}));
test('cardPosition on a monitor that does not start at x 0 offsets by the work area', () =>
    assertEqual(cardPosition({x: SECOND_MONITOR_X_PX, y: 32, width: 1536, height: 928}, CARD_WIDTH_PX, CARD_MARGIN_PX),
        {x: 2708, y: 56}));
test('cardPosition clamps x to the work area when the card is wider than it', () =>
    assertEqual(cardPosition({x: 100, y: 0, width: 300, height: 600}, CARD_WIDTH_PX, CARD_MARGIN_PX), {x: 100, y: 24}));

test('hoverLabelPosition: centred below the indicator, the gap under it', () =>
    assertEqual(hoverLabelPosition(indicatorAt(1000), HOVER_LABEL_WIDTH_PX, HOVER_LABEL_GAP_PX, LEFT_MONITOR),
        {x: 926, y: 40}));
test('hoverLabelPosition: on a primary that is not the rightmost monitor, a label wider than the space to its ' +
    'right edge stops at that edge, not at the stage\'s', () =>
    // Centred it would start at 1366 and run onto the monitor to the right; the stage is 3456 px wide.
    assertEqual(hoverLabelPosition(indicatorAt(1440), HOVER_LABEL_WIDTH_PX, HOVER_LABEL_GAP_PX, LEFT_MONITOR),
        {x: 1300, y: 40}));
test('hoverLabelPosition: on a monitor right of another, the label never crosses onto the left one', () =>
    // Centred it would start at 1856, on the monitor to the left; the stage's left edge (0) is no limit here.
    assertEqual(hoverLabelPosition(indicatorAt(1930), HOVER_LABEL_WIDTH_PX, HOVER_LABEL_GAP_PX, RIGHT_MONITOR),
        {x: 1920, y: 40}));
test('hoverLabelPosition: a label wider than its monitor starts at the monitor\'s left edge', () =>
    assertEqual(hoverLabelPosition(indicatorAt(1930), HOVER_LABEL_WIDTH_PX, HOVER_LABEL_GAP_PX,
        {x: RIGHT_MONITOR.x, width: 200}), {x: 1920, y: 40}));
test('hoverLabelPosition: a fractional width or gap lands on whole pixels, still inside the monitor', () =>
    // Flush right the label would start at 1300.5; whole pixels round that left, to 1300, never past the edge.
    assertEqual(hoverLabelPosition(indicatorAt(1500), 235.5, 8.5, LEFT_MONITOR), {x: 1300, y: 40}));

// The cockpit tooltip's rows: a 1536 px wide monitor 864 px tall, an anchor row, and a two-line label.
const TOOLTIP_LABEL_WIDTH_PX = 200;
const TOOLTIP_LABEL_HEIGHT_PX = 48;
const TOOLTIP_GAP_PX = 6;
const TALL_MONITOR = {x: 0, y: 0, width: MONITOR_WIDTH_PX, height: 864};
const tooltipPlacement = (anchorRect, monitorRect = TALL_MONITOR) => tooltipPosition({
    anchorRect, labelWidthPx: TOOLTIP_LABEL_WIDTH_PX, labelHeightPx: TOOLTIP_LABEL_HEIGHT_PX,
    gapPx: TOOLTIP_GAP_PX, monitorRect,
});

test('tooltipPosition: centred under the anchor, the gap below it, when there is room', () =>
    assertEqual(tooltipPlacement({x: 500, y: 100, width: 100, height: 20}), {x: 450, y: 126}));
test('tooltipPosition: above the anchor, the gap over it, when the label would cross the monitor\'s bottom', () =>
    assertEqual(tooltipPlacement({x: 500, y: 830, width: 100, height: 20}), {x: 450, y: 776}));
test('tooltipPosition: clamped at the right edge so the label stays inside the monitor', () =>
    assertEqual(tooltipPlacement({x: 1500, y: 100, width: 30, height: 20}), {x: 1336, y: 126}));
test('tooltipPosition: clamped at the monitor\'s left edge, on a monitor that starts right of another', () =>
    assertEqual(tooltipPlacement({x: 1930, y: 100, width: 20, height: 20},
        {x: 1920, y: 0, width: MONITOR_WIDTH_PX, height: 864}), {x: 1920, y: 126}));
test('tooltipPosition: a fractional anchor lands on whole pixels, rounded down on both axes', () =>
    // y = 100.9 + 20 + 6 = 126.9: floor gives 126, round 127 (x is pinned by the next row).
    assertEqual(tooltipPlacement({x: 500.9, y: 100.9, width: 99, height: 20}), {x: 450, y: 126}));
test('tooltipPosition: x rounds down where round would go up', () =>
    // 501.4 + (99 - 200) / 2 = 450.9: floor 450, round 451.
    assertEqual(tooltipPlacement({x: 501.4, y: 100, width: 99, height: 20}), {x: 450, y: 126}));
test('tooltipPosition: a label wider than its monitor starts at the monitor\'s left edge', () =>
    assertEqual(tooltipPlacement({x: 1930, y: 100, width: 20, height: 20},
        {x: 1920, y: 0, width: 150, height: 864}), {x: 1920, y: 126}));
test('tooltipPosition: a monitor that starts below the stage\'s top bounds the label by its own y', () =>
    // Monitor y 1000..1864, anchor y 1100: below ends at 1100 + 20 + 6 + 48 = 1174 and fits. A rule that ignored the
    // monitor's y would see a bottom at 864, cross it, find room above (1046 >= 1000) and answer y 1046.
    assertEqual(tooltipPlacement({x: 500, y: 1100, width: 100, height: 20},
        {x: 0, y: 1000, width: MONITOR_WIDTH_PX, height: 864}), {x: 450, y: 1126}));
test('tooltipPosition: a label that exactly touches the monitor\'s bottom edge stays below', () =>
    // Below ends at 100 + 20 + 6 + 48 = 174 = the monitor's bottom: touching is not crossing.
    assertEqual(tooltipPlacement({x: 500, y: 100, width: 100, height: 20},
        {x: 0, y: 0, width: MONITOR_WIDTH_PX, height: 174}), {x: 450, y: 126}));
test('tooltipPosition: a label that fits neither below nor above stays below, never above the monitor\'s top', () =>
    assertEqual(tooltipPlacement({x: 500, y: 20, width: 100, height: 20},
        {x: 0, y: 0, width: MONITOR_WIDTH_PX, height: 60}), {x: 450, y: 46}));
