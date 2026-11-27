// lib/pressureHistories.js: the client's three pressure histories, and whether the sampler publishes them. A state
// decides it; while it is not published, a Sample's pressure is ignored and no gap is pushed.
import {test, assertEqual} from './harness.js';
import {PressureHistories} from '../extensions/resource-pulse@zvibaratz.github.io/lib/pressureHistories.js';
import {CARD_HISTORY_SAMPLES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

/** A state's pressure histories, as lib/protocol.js parses them: a gap in each, and cpu and io past 25 %. */
const STATE_PRESSURE_HISTORIES = {cpu: [1.5, null, 30], memory: [0, null, 0.25], io: [0.25, null, 55]};
/** What one Sample appended to them, as lib/protocol.js parses it. */
const APPENDED_PRESSURE = {cpu: 62, memory: 4, io: 51.5};

/**
 * @param {PressureHistories} pressureHistories - The histories.
 * @returns {{isPublished: boolean, cpu: Array<number|null>, memory: Array<number|null>, io: Array<number|null>}} What
 *     they hold now.
 */
function contentsOf(pressureHistories) {
    return {
        isPublished: pressureHistories.isPublished,
        cpu: pressureHistories.cpu.values(),
        memory: pressureHistories.memory.values(),
        io: pressureHistories.io.values(),
    };
}

test('pressure histories: before any state they are not published and empty, and a Sample or a gap adds nothing',
    () => {
        const pressureHistories = new PressureHistories(CARD_HISTORY_SAMPLES);
        pressureHistories.appendFromSample(APPENDED_PRESSURE);
        pressureHistories.appendGap();
        assertEqual(contentsOf(pressureHistories), {isPublished: false, cpu: [], memory: [], io: []});
    });

test('pressure histories: whether they are published is not known before any state, not after a Sample or a gap ' +
    'either, and is known after a state that carries them or one that does not', () => {
    const pressureHistories = new PressureHistories(CARD_HISTORY_SAMPLES);
    const publishingOf = () =>
        ({isPublishingKnown: pressureHistories.isPublishingKnown, isPublished: pressureHistories.isPublished});
    pressureHistories.appendFromSample(APPENDED_PRESSURE);
    pressureHistories.appendGap();
    const beforeAnyState = publishingOf();
    pressureHistories.replaceFromState(null);
    const afterAStateWithout = publishingOf();
    pressureHistories.replaceFromState(STATE_PRESSURE_HISTORIES);
    const afterAStateWith = publishingOf();
    assertEqual({beforeAnyState, afterAStateWithout, afterAStateWith}, {
        beforeAnyState: {isPublishingKnown: false, isPublished: false},
        afterAStateWithout: {isPublishingKnown: true, isPublished: false},
        afterAStateWith: {isPublishingKnown: true, isPublished: true},
    });
});

test('pressure histories: a state that carries them makes them published and replaces all three; each Sample then ' +
    'appends its readings, and a gap or a Sample without them is a gap in each', () => {
    const pressureHistories = new PressureHistories(CARD_HISTORY_SAMPLES);
    pressureHistories.replaceFromState(STATE_PRESSURE_HISTORIES);
    pressureHistories.appendFromSample(APPENDED_PRESSURE);
    pressureHistories.appendGap();
    pressureHistories.appendFromSample(null);
    pressureHistories.appendFromSample({cpu: 0, memory: null, io: 100});
    assertEqual(contentsOf(pressureHistories), {
        isPublished: true,
        cpu: [...STATE_PRESSURE_HISTORIES.cpu, 62, null, null, 0],
        memory: [...STATE_PRESSURE_HISTORIES.memory, 4, null, null, null],
        io: [...STATE_PRESSURE_HISTORIES.io, 51.5, null, null, 100],
    });
});

test('pressure histories: a state without them (a sampler from before them) makes them not published and empty, ' +
    'and then no Sample and no gap is pushed: "not published" is never a run of gaps', () => {
    const pressureHistories = new PressureHistories(CARD_HISTORY_SAMPLES);
    pressureHistories.replaceFromState(STATE_PRESSURE_HISTORIES);
    pressureHistories.replaceFromState(null);
    for (let tickIndex = 0; tickIndex < CARD_HISTORY_SAMPLES; tickIndex++)
        pressureHistories.appendFromSample(null);
    pressureHistories.appendGap();
    assertEqual(contentsOf(pressureHistories), {isPublished: false, cpu: [], memory: [], io: []});
});

test('pressure histories: a state whose list is missing empties that history alone, and they are still published',
    () => {
        const pressureHistories = new PressureHistories(CARD_HISTORY_SAMPLES);
        pressureHistories.replaceFromState({...STATE_PRESSURE_HISTORIES, io: null});
        pressureHistories.appendFromSample(APPENDED_PRESSURE);
        assertEqual(contentsOf(pressureHistories), {
            isPublished: true,
            cpu: [...STATE_PRESSURE_HISTORIES.cpu, 62],
            memory: [...STATE_PRESSURE_HISTORIES.memory, 4],
            io: [51.5],
        });
    });

test('pressure histories: each keeps the newest CARD_HISTORY_SAMPLES values, as the CPU history does', () => {
    const extraSampleCount = 5;
    const pressureHistories = new PressureHistories(CARD_HISTORY_SAMPLES);
    pressureHistories.replaceFromState({cpu: [], memory: [], io: []});
    const appendedPercents = Array.from({length: CARD_HISTORY_SAMPLES + extraSampleCount}, (_, index) => index % 100);
    for (const percent of appendedPercents)
        pressureHistories.appendFromSample({cpu: percent, memory: percent, io: percent});
    const keptPercents = appendedPercents.slice(-CARD_HISTORY_SAMPLES);
    assertEqual(contentsOf(pressureHistories), {
        isPublished: true, cpu: keptPercents, memory: keptPercents, io: keptPercents,
    });
});
