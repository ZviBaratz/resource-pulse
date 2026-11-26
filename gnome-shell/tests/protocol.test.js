// lib/protocol.js: the names and the interface the service and the extension share, and the JSON both sides speak.
// The parsers are skew-tolerant: a reader ignores fields it does not know, and a field that is missing or of the
// wrong type is null for that field alone.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEqual} from './harness.js';
import {
    PROTOCOL_VERSION, RESOURCE_PULSE_BUS_NAME, RESOURCE_PULSE_INTERFACE_NAME, RESOURCE_PULSE_INTERFACE_XML,
    RESOURCE_PULSE_OBJECT_PATH, buildSamplePayload, buildStatePayload, parseSamplePayload, parseStatePayload,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as protocolModule from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';
import {CARD_HISTORY_SAMPLES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

const [TEST_FILE_PATH] = GLib.filename_from_uri(import.meta.url);
const SERVICE_STARTED_AT_USEC = 1_794_000_000_000_000;
const SAMPLED_AT_USEC = 1_794_000_002_000_000;
/** Real time of the latest publish, as GetState reports it: a little after SAMPLED_AT_USEC, so the two never mix. */
const LATEST_SAMPLED_AT_USEC = 1_794_000_004_000_000;
const SEQUENCE = 7;

/** A snapshot with every field set, in the Snapshot typedef's order (lib/protocol.js). */
const FULL_SNAPSHOT = {
    takenAtUsec: 123_000_000,
    takenAtClockLabel: '14:02',
    cpuBusyPercent: 23.5,
    cpuClusters: {performancePercent: 41, efficiencyPercent: 6},
    memory: {usedBytes: 16_000_000_000, totalBytes: 32_000_000_000},
    swap: {zramUsedBytes: 1_600_000_000, zramRamBytes: 400_000_000, diskBytes: 0},
    pressureAvg10: {cpu: 1.5, memory: 0, io: 0.25},
    apps: {
        topCpu: {groupKey: 'app:org.example.Editor', name: 'Editor', cpuPercent: 31},
        topMemory: {groupKey: 'herdr-server', name: 'herdr agents', memoryBytes: 15_700_000_000},
        cpuRanking: [
            {groupKey: 'app:org.example.Editor', name: 'Editor', cpuPercent: 31},
            {groupKey: 'pseudo:kernel', name: 'kernel', cpuPercent: 4.5},
        ],
        memoryRanking: [
            {groupKey: 'herdr-server', name: 'herdr agents', memoryBytes: 15_700_000_000},
            {groupKey: 'app:org.example.Editor', name: 'Editor', memoryBytes: 900_000_000},
        ],
    },
    isComplete: true,
};
/** The three pressure histories, in percent: a gap in each, and the second band (25 %) crossed in cpu and io. */
const PRESSURE_HISTORIES = {cpu: [1.5, null, 30], memory: [0, null, 0.25], io: [0.25, null, 55]};
const HISTORIES = {cpu: [0.25, null, 0.5], memory: [0.6, 0.61, null], pressureAvg10: PRESSURE_HISTORIES};
/** What a tick appended: its pressure is its snapshot's own, as the sampler appends it. */
const APPENDED_HISTORY = {cpu: 0.5, memory: null, pressureAvg10: FULL_SNAPSHOT.pressureAvg10};
/** Every history empty, as a sampler's state is before its first tick. */
const EMPTY_HISTORIES = {cpu: [], memory: [], pressureAvg10: {cpu: [], memory: [], io: []}};
/**
 * The payloads of a sampler from before the pressure history, frozen byte for byte (the file's description says
 * which four), and the names they are kept under.
 */
const PAYLOADS_BEFORE_PRESSURE_HISTORY_PATH = GLib.build_filenamev([GLib.path_get_dirname(TEST_FILE_PATH), 'fixtures',
    'protocol', 'payloads-before-pressure-history.json']);
const OLDER_TICK_SAMPLE_KEY = 'tickSample';
const OLDER_NO_DATA_REVEAL_SAMPLE_KEY = 'noDataRevealSample';
const OLDER_STATE_BEFORE_ANY_SAMPLE_KEY = 'stateBeforeAnySample';
const OLDER_STATE_WITH_SNAPSHOT_KEY = 'stateWithSnapshot';

/**
 * Builds the state payload of FULL_SNAPSHOT and HISTORIES.
 *
 * @returns {string} The JSON.
 */
function fullStatePayload() {
    return buildStatePayload({
        snapshot: FULL_SNAPSHOT, histories: HISTORIES, serviceStartedAtUsec: SERVICE_STARTED_AT_USEC,
        latestSampledAtUsec: LATEST_SAMPLED_AT_USEC, sequence: SEQUENCE,
    });
}

/**
 * Builds the sample payload of FULL_SNAPSHOT and APPENDED_HISTORY.
 *
 * @returns {string} The JSON.
 */
function fullSamplePayload() {
    return buildSamplePayload({
        snapshot: FULL_SNAPSHOT, appendedHistory: APPENDED_HISTORY, sequence: SEQUENCE, sampledAtUsec: SAMPLED_AT_USEC,
    });
}

/**
 * Parses a payload as plain JSON, applies an edit to the object, and serializes it again: a payload as another
 * version of the service might send it.
 *
 * @param {string} payload - A built payload.
 * @param {(payloadObject: object) => void} editPayload - Changes the parsed object in place.
 * @returns {string} The edited JSON.
 */
function editedPayload(payload, editPayload) {
    const payloadObject = JSON.parse(payload);
    editPayload(payloadObject);
    return JSON.stringify(payloadObject);
}

test('protocol: version 1, and the bus name, interface, object path and member names of the protocol', () => {
    assertEqual({
        version: PROTOCOL_VERSION,
        busName: RESOURCE_PULSE_BUS_NAME,
        interfaceName: RESOURCE_PULSE_INTERFACE_NAME,
        objectPath: RESOURCE_PULSE_OBJECT_PATH,
        sampleSignal: [protocolModule.SAMPLE_SIGNAL_NAME, protocolModule.SAMPLE_SIGNAL_SIGNATURE],
        methods: [protocolModule.GET_STATE_METHOD_NAME, protocolModule.WATCH_DETAIL_METHOD_NAME,
            protocolModule.UNWATCH_DETAIL_METHOD_NAME],
    }, {
        version: 1,
        busName: 'io.github.zvibaratz.ResourcePulse1',
        interfaceName: 'io.github.zvibaratz.ResourcePulse1',
        objectPath: '/io/github/zvibaratz/ResourcePulse1',
        sampleSignal: ['Sample', '(s)'],
        methods: ['GetState', 'WatchDetail', 'UnwatchDetail'],
    });
});

test('protocol: the interface XML declares GetState() → s, WatchDetail(), UnwatchDetail() and Sample(s)', () => {
    const interfaceInfo = Gio.DBusNodeInfo.new_for_xml(RESOURCE_PULSE_INTERFACE_XML)
        .lookup_interface(RESOURCE_PULSE_INTERFACE_NAME);
    const signaturesOf = argumentInfos => argumentInfos.map(argumentInfo => argumentInfo.signature);
    const methods = interfaceInfo.methods.map(methodInfo =>
        `${methodInfo.name}(${signaturesOf(methodInfo.in_args)})→(${signaturesOf(methodInfo.out_args)})`);
    const signals = interfaceInfo.signals.map(signalInfo => `${signalInfo.name}(${signaturesOf(signalInfo.args)})`);
    assertEqual({methods, signals, properties: interfaceInfo.properties.length}, {
        methods: ['GetState()→(s)', 'WatchDetail()→()', 'UnwatchDetail()→()'],
        signals: ['Sample(s)'],
        properties: 0,
    });
});

test('protocol: a state payload round-trips, with protocol 1', () => {
    assertEqual(parseStatePayload(fullStatePayload()), {
        protocol: 1,
        snapshot: FULL_SNAPSHOT,
        histories: HISTORIES,
        serviceStartedAtUsec: SERVICE_STARTED_AT_USEC,
        latestSampledAtUsec: LATEST_SAMPLED_AT_USEC,
        sequence: SEQUENCE,
    });
});

test('protocol: a state payload before the first sample round-trips with a null snapshot and sample time, sequence 0',
    () => {
        const payload = buildStatePayload({
            snapshot: null, histories: EMPTY_HISTORIES, serviceStartedAtUsec: SERVICE_STARTED_AT_USEC,
            latestSampledAtUsec: null, sequence: 0,
        });
        assertEqual(parseStatePayload(payload), {
            protocol: 1, snapshot: null, histories: EMPTY_HISTORIES,
            serviceStartedAtUsec: SERVICE_STARTED_AT_USEC, latestSampledAtUsec: null, sequence: 0,
        });
    });

test('protocol: GetState writes protocol and latestSampledAtUsec before the snapshot, where a status script reads them',
    () => {
        // a status script reads them out of gdbus's text with a pattern, from the part before "snapshot" only, so a
        // field of the same name nested in the snapshot is never mistaken for one of them.
        const payload = fullStatePayload();
        const snapshotOffset = payload.indexOf('"snapshot":');
        const isBeforeSnapshot = key => {
            const keyOffset = payload.indexOf(`"${key}":`);
            return keyOffset >= 0 && keyOffset < snapshotOffset;
        };
        const topLevelKeys = ['protocol', 'latestSampledAtUsec'];
        assertEqual(topLevelKeys.map(isBeforeSnapshot), topLevelKeys.map(() => true));
    });

test('protocol: a sample payload round-trips', () => {
    assertEqual(parseSamplePayload(fullSamplePayload()), {
        snapshot: FULL_SNAPSHOT, appendedHistory: APPENDED_HISTORY, sequence: SEQUENCE, sampledAtUsec: SAMPLED_AT_USEC,
    });
});

test('protocol: a Sample\'s envelope carries its sequence, time and appended history, and its snapshot unread', () => {
    const appendedHistory = {cpu: 0.5, memory: 0.25, pressureAvg10: FULL_SNAPSHOT.pressureAvg10};
    const payload = buildSamplePayload({
        snapshot: FULL_SNAPSHOT, appendedHistory, sequence: 8, sampledAtUsec: SAMPLED_AT_USEC,
    });
    const envelope = protocolModule.parseSampleEnvelope(payload);
    assertEqual({
        sequence: envelope.sequence,
        sampledAtUsec: envelope.sampledAtUsec,
        appendedHistory: envelope.appendedHistory,
        snapshot: protocolModule.parseEnvelopeSnapshot(envelope.rawSnapshot),
    }, {
        sequence: 8,
        sampledAtUsec: SAMPLED_AT_USEC,
        appendedHistory,
        snapshot: parseSamplePayload(payload).snapshot,
    });
});

test('protocol: an envelope\'s appended history out of range is a gap, and a missing one is null', () => {
    const outOfRange = protocolModule.parseSampleEnvelope(JSON.stringify({appendedHistory: {cpu: 1.5}}));
    const missing = protocolModule.parseSampleEnvelope(JSON.stringify({sequence: 1}));
    // Whole envelopes, so a null result is a mismatch that names what was expected, not a TypeError. Neither
    // payload has a snapshot, so rawSnapshot is undefined and absent from the comparison.
    assertEqual({outOfRange, missing}, {
        outOfRange: {
            sequence: null, sampledAtUsec: null, appendedHistory: {cpu: null, memory: null, pressureAvg10: null},
        },
        missing: {sequence: 1, sampledAtUsec: null, appendedHistory: null},
    });
});

test('protocol: an envelope of text that is not a JSON object is null', () => {
    assertEqual(['[]', 'nope', 42].map(input => protocolModule.parseSampleEnvelope(input)), [null, null, null]);
});

test('protocol: a raw snapshot that is not an object parses to null', () => {
    assertEqual([null, 7, []].map(input => protocolModule.parseEnvelopeSnapshot(input)), [null, null, null]);
});

test('protocol: a watch-start reveal sample carries appendedHistory null, so the client appends nothing', () => {
    const payload = buildSamplePayload({
        snapshot: FULL_SNAPSHOT, appendedHistory: null, sequence: SEQUENCE, sampledAtUsec: SAMPLED_AT_USEC,
    });
    assertEqual({wire: JSON.parse(payload).appendedHistory, parsed: parseSamplePayload(payload).appendedHistory},
        {wire: null, parsed: null});
});

// An older extension against a newer sampler: an unknown key inside histories and inside appendedHistory, where the
// pressure history was added after cpu and memory, is ignored as the older reader ignored pressureAvg10 there.
test('protocol skew: unknown top-level and nested fields are ignored in a state payload', () => {
    const payloadWithExtras = editedPayload(fullStatePayload(), payloadObject => {
        payloadObject.futureTopLevel = {anything: [1, 2]};
        payloadObject.snapshot.futureSnapshotField = 'x';
        payloadObject.snapshot.memory.futureBytes = 5;
        payloadObject.snapshot.apps.topCpu.futureScore = 2;
        payloadObject.histories.futureHistory = [0.1];
        payloadObject.histories.pressureAvg10.futurePressureHistory = [7];
    });
    assertEqual(parseStatePayload(payloadWithExtras), parseStatePayload(fullStatePayload()));
});

test('protocol skew: unknown top-level and nested fields are ignored in a sample payload', () => {
    const payloadWithExtras = editedPayload(fullSamplePayload(), payloadObject => {
        payloadObject.futureTopLevel = 3;
        payloadObject.snapshot.pressureAvg10.futurePressure = 9;
        payloadObject.appendedHistory.futureFraction = 0.3;
        payloadObject.appendedHistory.pressureAvg10.futurePressure = 4;
    });
    assertEqual(parseSamplePayload(payloadWithExtras), parseSamplePayload(fullSamplePayload()));
});

test('protocol skew: a missing snapshot.swap gives swap: null, and every other field intact', () => {
    const payloadWithoutSwap = editedPayload(fullSamplePayload(), payloadObject => {
        delete payloadObject.snapshot.swap;
    });
    assertEqual(parseSamplePayload(payloadWithoutSwap), {
        snapshot: {...FULL_SNAPSHOT, swap: null},
        appendedHistory: APPENDED_HISTORY,
        sequence: SEQUENCE,
        sampledAtUsec: SAMPLED_AT_USEC,
    });
});

test('protocol skew: a mistyped field is null for that field only (a history value is a gap)', () => {
    const mistypedState = editedPayload(fullStatePayload(), payloadObject => {
        payloadObject.sequence = '7';
        payloadObject.snapshot.memory.usedBytes = 'lots';
        payloadObject.snapshot.cpuClusters.efficiencyPercent = true;
        payloadObject.snapshot.apps.topMemory = 'herdr';
        payloadObject.histories.cpu = [0.25, 'x', 0.5];
        payloadObject.histories.memory = 'none';
        payloadObject.histories.pressureAvg10.cpu = [1.5, 'x', 30];
        payloadObject.histories.pressureAvg10.io = 'none';
    });
    assertEqual(parseStatePayload(mistypedState), {
        protocol: 1,
        snapshot: {
            ...FULL_SNAPSHOT,
            cpuClusters: {performancePercent: 41, efficiencyPercent: null},
            memory: null,
            apps: {...FULL_SNAPSHOT.apps, topMemory: null},
        },
        histories: {
            cpu: [0.25, null, 0.5],
            memory: null,
            pressureAvg10: {cpu: [1.5, null, 30], memory: PRESSURE_HISTORIES.memory, io: null},
        },
        serviceStartedAtUsec: SERVICE_STARTED_AT_USEC,
        latestSampledAtUsec: LATEST_SAMPLED_AT_USEC,
        sequence: null,
    });
});

test('protocol skew: a state payload without latestSampledAtUsec (an older service), or with one that is not a ' +
    'finite number, reads it as null and every other field intact', () => {
    const editedLatestSampledAtValues = {absent: undefined, text: 'soon', flag: true, list: [1]};
    const parsedStates = Object.fromEntries(Object.entries(editedLatestSampledAtValues).map(([caseName, value]) => {
        const statePayload = editedPayload(fullStatePayload(), payloadObject => {
            if (value === undefined)
                delete payloadObject.latestSampledAtUsec;
            else
                payloadObject.latestSampledAtUsec = value;
        });
        return [caseName, parseStatePayload(statePayload)];
    }));
    const expectedState = {...parseStatePayload(fullStatePayload()), latestSampledAtUsec: null};
    assertEqual(parsedStates, Object.fromEntries(Object.keys(editedLatestSampledAtValues).map(caseName =>
        [caseName, expectedState])));
});

test('protocol skew: an app entry without a groupKey is null, so two such entries never read as one app', () => {
    // lib/format.js shows the two halves of "heaviest" as one app when their groupKeys are equal, and two keys made
    // null would be equal.
    const payloadWithoutGroupKeys = editedPayload(fullSamplePayload(), payloadObject => {
        delete payloadObject.snapshot.apps.topCpu.groupKey;
        delete payloadObject.snapshot.apps.topMemory.groupKey;
    });
    assertEqual(parseSamplePayload(payloadWithoutGroupKeys).snapshot.apps, {...FULL_SNAPSHOT.apps, topCpu: null, topMemory: null});
});

test('protocol skew: a sequence or protocol that is not a whole number of zero or more is null', () => {
    // The client takes a lower sequence for a service restart, so a negative or fractional one must not pass.
    const notWholeCounts = [-3, 2.5, '7', null];
    const parsedCounts = notWholeCounts.map(count => {
        const statePayload = editedPayload(fullStatePayload(), payloadObject => {
            payloadObject.sequence = count;
            payloadObject.protocol = count;
        });
        const samplePayload = editedPayload(fullSamplePayload(), payloadObject => {
            payloadObject.sequence = count;
        });
        const state = parseStatePayload(statePayload);
        return [state.sequence, state.protocol, parseSamplePayload(samplePayload).sequence];
    });
    assertEqual(parsedCounts, notWholeCounts.map(() => [null, null, null]));
});

test('protocol skew: a negative byte count or percentage is null for its own field (a ranked app as a whole)', () => {
    const negativePayload = editedPayload(fullSamplePayload(), payloadObject => {
        payloadObject.snapshot.cpuBusyPercent = -2;
        payloadObject.snapshot.cpuClusters.performancePercent = -1;
        payloadObject.snapshot.memory.usedBytes = -1;
        payloadObject.snapshot.swap.diskBytes = -5;
        payloadObject.snapshot.pressureAvg10.io = -0.5;
        payloadObject.snapshot.apps.topCpu.cpuPercent = -1;
        payloadObject.snapshot.apps.topMemory.memoryBytes = -1;
    });
    assertEqual(parseSamplePayload(negativePayload).snapshot, {
        ...FULL_SNAPSHOT,
        cpuBusyPercent: null,
        cpuClusters: {performancePercent: null, efficiencyPercent: 6},
        memory: null,
        swap: null,
        pressureAvg10: {cpu: 1.5, memory: 0, io: null},
        apps: {...FULL_SNAPSHOT.apps, topCpu: null, topMemory: null},
    });
});

test('protocol skew: a history fraction outside 0–1 is a gap, in GetState\'s histories and Sample\'s appended', () => {
    const stateWithOutOfRangeFractions = editedPayload(fullStatePayload(), payloadObject => {
        payloadObject.histories.cpu = [-0.1, 0, 0.5, 1, 1.5];
    });
    const sampleWithOutOfRangeFractions = editedPayload(fullSamplePayload(), payloadObject => {
        payloadObject.appendedHistory = {cpu: 1.01, memory: -0.01};
    });
    assertEqual({
        histories: parseStatePayload(stateWithOutOfRangeFractions).histories,
        appendedHistory: parseSamplePayload(sampleWithOutOfRangeFractions).appendedHistory,
    }, {
        histories: {cpu: [null, 0, 0.5, 1, null], memory: HISTORIES.memory, pressureAvg10: PRESSURE_HISTORIES},
        // The edit replaced appendedHistory whole, with no pressure in it.
        appendedHistory: {cpu: null, memory: null, pressureAvg10: null},
    });
});

test('protocol skew: a pressure history percent outside 0–100 is a gap, in GetState\'s histories and Sample\'s ' +
    'appended, and 0, 100 and a fraction are kept', () => {
    const stateWithOutOfRangePercents = editedPayload(fullStatePayload(), payloadObject => {
        payloadObject.histories.pressureAvg10.cpu = [-0.5, 0, 0.5, 100, 100.5];
    });
    const sampleWithOutOfRangePercents = editedPayload(fullSamplePayload(), payloadObject => {
        payloadObject.appendedHistory.pressureAvg10 = {cpu: 101, memory: -1, io: 'high'};
    });
    assertEqual({
        pressureHistories: parseStatePayload(stateWithOutOfRangePercents).histories.pressureAvg10,
        appendedHistory: parseSamplePayload(sampleWithOutOfRangePercents).appendedHistory,
    }, {
        pressureHistories: {...PRESSURE_HISTORIES, cpu: [null, 0, 0.5, 100, null]},
        appendedHistory: {cpu: 0.5, memory: null, pressureAvg10: {cpu: null, memory: null, io: null}},
    });
});

test('protocol skew: pressure histories that are not an object read as not published (null); one list that is not ' +
    'a list is null alone', () => {
    const notObjectValues = [[1.5, 2], 'none', 3, null];
    const parsedNotObjects = notObjectValues.map(value => {
        const statePayload = editedPayload(fullStatePayload(), payloadObject => {
            payloadObject.histories.pressureAvg10 = value;
        });
        const samplePayload = editedPayload(fullSamplePayload(), payloadObject => {
            payloadObject.appendedHistory.pressureAvg10 = value;
        });
        return [parseStatePayload(statePayload).histories.pressureAvg10,
            parseSamplePayload(samplePayload).appendedHistory.pressureAvg10];
    });
    const stateWithoutIoList = editedPayload(fullStatePayload(), payloadObject => {
        delete payloadObject.histories.pressureAvg10.io;
    });
    assertEqual({
        notObjects: parsedNotObjects,
        withoutIoList: parseStatePayload(stateWithoutIoList).histories.pressureAvg10,
    }, {
        notObjects: notObjectValues.map(() => [null, null]),
        withoutIoList: {...PRESSURE_HISTORIES, io: null},
    });
});

/**
 * Reads one payload of a sampler from before the pressure history.
 *
 * @param {string} payloadKey - Its key in the frozen file.
 * @returns {string} The payload's text, byte for byte.
 */
function payloadBeforePressureHistory(payloadKey) {
    const [, fileBytes] = GLib.file_get_contents(PAYLOADS_BEFORE_PRESSURE_HISTORY_PATH);
    const payloads = JSON.parse(new TextDecoder().decode(fileBytes));
    return payloads[payloadKey];
}

// A newer extension against an older sampler: what the sampler never wrote is "not published", told apart from a gap.
test('protocol skew: a sampler from before the pressure history reads as not publishing it (pressureAvg10 null), in ' +
    'its states and its Samples, with everything it did write intact', () => {
    const olderTickSample = parseSamplePayload(payloadBeforePressureHistory(OLDER_TICK_SAMPLE_KEY));
    const olderReveal = parseSamplePayload(payloadBeforePressureHistory(OLDER_NO_DATA_REVEAL_SAMPLE_KEY));
    const olderEmptyState = parseStatePayload(payloadBeforePressureHistory(OLDER_STATE_BEFORE_ANY_SAMPLE_KEY));
    const olderState = parseStatePayload(payloadBeforePressureHistory(OLDER_STATE_WITH_SNAPSHOT_KEY));
    assertEqual({
        tickAppendedHistory: olderTickSample.appendedHistory,
        tickPressureAvg10: olderTickSample.snapshot.pressureAvg10,
        revealAppendedHistory: olderReveal.appendedHistory,
        emptyStateHistories: olderEmptyState.histories,
        stateHistories: olderState.histories,
        stateSequence: olderState.sequence,
    }, {
        tickAppendedHistory: {cpu: 0.5, memory: 0.25, pressureAvg10: null},
        tickPressureAvg10: {cpu: 0.5, memory: 0, io: null},
        revealAppendedHistory: null,
        emptyStateHistories: {cpu: [0.25, null], memory: [0.5, 0.6], pressureAvg10: null},
        stateHistories: {cpu: [], memory: [], pressureAvg10: null},
        stateSequence: 2,
    });
});

test('protocol: buildStatePayload given no pressure histories writes the state as a sampler from before them',
    () => {
        const olderStatePayload = buildStatePayload({
            snapshot: null, histories: {cpu: [0.25, null], memory: [0.5, 0.6]},
            serviceStartedAtUsec: SERVICE_STARTED_AT_USEC, latestSampledAtUsec: null, sequence: 0,
        });
        assertEqual(olderStatePayload, payloadBeforePressureHistory(OLDER_STATE_BEFORE_ANY_SAMPLE_KEY));
    });

test('protocol skew: a history longer than CARD_HISTORY_SAMPLES keeps only its newest values', () => {
    const extraSampleCount = 50;
    const longHistoryLength = CARD_HISTORY_SAMPLES + extraSampleCount;
    const longHistory = Array.from({length: longHistoryLength}, (_, index) => (index % 100) / 100);
    const shortHistory = longHistory.slice(0, 3);
    const longPressureHistory = longHistory.map(fraction => fraction * 100);
    const shortPressureHistory = longPressureHistory.slice(0, 3);
    const pressureAvg10 = {cpu: longPressureHistory, memory: shortPressureHistory, io: shortPressureHistory};
    const payload = buildStatePayload({
        snapshot: null, histories: {cpu: longHistory, memory: shortHistory, pressureAvg10},
        serviceStartedAtUsec: SERVICE_STARTED_AT_USEC, sequence: SEQUENCE,
    });
    assertEqual(parseStatePayload(payload).histories, {
        cpu: longHistory.slice(-CARD_HISTORY_SAMPLES),
        memory: shortHistory,
        pressureAvg10: {...pressureAvg10, cpu: longPressureHistory.slice(-CARD_HISTORY_SAMPLES)},
    });
});

test('protocol skew: raw JSON numbers out of range (1e999, -1e999, a sequence past 2^53) are null', () => {
    // JSON.stringify cannot write these, so they are spliced into the text; each splice is checked to have landed.
    const textEdits = [
        ['sample', `"sequence":${SEQUENCE}`, '"sequence":99999999999999999999'],
        ['sample', `"sampledAtUsec":${SAMPLED_AT_USEC}`, '"sampledAtUsec":1e999'],
        ['sample', '"cpuBusyPercent":23.5', '"cpuBusyPercent":1e999'],
        ['state', `"serviceStartedAtUsec":${SERVICE_STARTED_AT_USEC}`, '"serviceStartedAtUsec":-1e999'],
        ['state', '"cpu":[0.25,null,0.5]', '"cpu":[1e999,null,0.5]'],
    ];
    const rawTexts = {sample: fullSamplePayload(), state: fullStatePayload()};
    const missedSplices = [];
    for (const [payloadKind, originalText, rawText] of textEdits) {
        if (!rawTexts[payloadKind].includes(originalText))
            missedSplices.push(originalText);
        rawTexts[payloadKind] = rawTexts[payloadKind].replace(originalText, rawText);
    }
    const sample = parseSamplePayload(rawTexts.sample);
    const state = parseStatePayload(rawTexts.state);
    assertEqual({
        missedSplices,
        sequence: sample.sequence,
        sampledAtUsec: sample.sampledAtUsec,
        cpuBusyPercent: sample.snapshot.cpuBusyPercent,
        serviceStartedAtUsec: state.serviceStartedAtUsec,
        cpuHistory: state.histories.cpu,
    }, {
        missedSplices: [],
        sequence: null,
        sampledAtUsec: null,
        cpuBusyPercent: null,
        serviceStartedAtUsec: null,
        cpuHistory: [null, null, 0.5],
    });
});

test('protocol skew: a missing snapshot, histories or appendedHistory gives null, never a throw', () => {
    const stateWithoutParts = editedPayload(fullStatePayload(), payloadObject => {
        delete payloadObject.snapshot;
        delete payloadObject.histories;
    });
    const sampleWithoutParts = editedPayload(fullSamplePayload(), payloadObject => {
        delete payloadObject.appendedHistory;
        payloadObject.snapshot = 'not a snapshot';
    });
    assertEqual({state: parseStatePayload(stateWithoutParts), sample: parseSamplePayload(sampleWithoutParts)}, {
        state: {
            protocol: 1, snapshot: null, histories: {cpu: null, memory: null, pressureAvg10: null},
            serviceStartedAtUsec: SERVICE_STARTED_AT_USEC, latestSampledAtUsec: LATEST_SAMPLED_AT_USEC,
            sequence: SEQUENCE,
        },
        sample: {snapshot: null, appendedHistory: null, sequence: SEQUENCE, sampledAtUsec: SAMPLED_AT_USEC},
    });
});

test('protocol skew: "not json", a JSON non-object and a non-string all parse to null', () => {
    const unparseableInputs = ['not json', '[1, 2]', '42', 'null', '"text"', '', undefined, null];
    assertEqual({
        state: unparseableInputs.map(input => parseStatePayload(input)),
        sample: unparseableInputs.map(input => parseSamplePayload(input)),
    }, {
        state: unparseableInputs.map(() => null),
        sample: unparseableInputs.map(() => null),
    });
});

/**
 * Parses the state payload of FULL_SNAPSHOT with its apps replaced.
 *
 * @param {object} apps - The apps field to publish.
 * @returns {object} The parsed apps field.
 */
function parsedAppsOfStateWith(apps) {
    const payload = buildStatePayload({
        snapshot: {...FULL_SNAPSHOT, apps}, histories: HISTORIES, serviceStartedAtUsec: SERVICE_STARTED_AT_USEC,
        latestSampledAtUsec: LATEST_SAMPLED_AT_USEC, sequence: SEQUENCE,
    });
    return parseStatePayload(payload).snapshot.apps;
}

test('protocol: parseStatePayload reads the app rankings and drops a malformed entry', () => {
    const parsed = parsedAppsOfStateWith(
        {...FULL_SNAPSHOT.apps, cpuRanking: [FULL_SNAPSHOT.apps.topCpu, {name: 'no key'}]});
    assertEqual(parsed.cpuRanking, [FULL_SNAPSHOT.apps.topCpu]);
    assertEqual(parsed.memoryRanking, FULL_SNAPSHOT.apps.memoryRanking);
});
test('protocol: a payload from before the rankings reads them as null', () => {
    const {cpuRanking, memoryRanking, ...oldApps} = FULL_SNAPSHOT.apps;
    const parsed = parsedAppsOfStateWith(oldApps);
    assertEqual([parsed.cpuRanking, parsed.memoryRanking], [null, null]);
    assertEqual(parsed.topCpu, FULL_SNAPSHOT.apps.topCpu);
});
test('protocol: a ranking that is not a list reads as null', () => {
    const parsed = parsedAppsOfStateWith(
        {...FULL_SNAPSHOT.apps, cpuRanking: 'Editor', memoryRanking: {0: FULL_SNAPSHOT.apps.topMemory}});
    assertEqual([parsed.cpuRanking, parsed.memoryRanking], [null, null]);
});

/** Where the golden files are: what a client receives for each scenario (golden/README.md says what they hold). */
const GOLDEN_EXPECTED_DIRECTORY = GLib.build_filenamev([GLib.path_get_dirname(TEST_FILE_PATH), 'golden', 'expected']);
/** The golden file the round-trip row reads a Sample of: root-a, then root-b. */
const ROUND_TRIP_GOLDEN_FILE_NAME = 'a-then-b.json';
/** Its second Sample, root-b read after root-a: the first with a CPU delta, so every part of its snapshot is set. */
const ROUND_TRIP_SAMPLE_INDEX = 1;

/**
 * Reads one golden file.
 *
 * @param {string} name - The file's name in GOLDEN_EXPECTED_DIRECTORY.
 * @returns {{samples: object[], state: object}} Its parsed content.
 * @throws {Error} When the file cannot be read or is not JSON.
 */
function readGoldenFile(name) {
    const [, contents] = GLib.file_get_contents(GLib.build_filenamev([GOLDEN_EXPECTED_DIRECTORY, name]));
    return JSON.parse(new TextDecoder().decode(contents));
}

/**
 * Reads every golden file.
 *
 * @returns {Array<{name: string, recording: {samples: object[], state: object}}>} Each file's name and its parsed
 *     content, in name order.
 */
function readGoldenFiles() {
    const enumerator = Gio.File.new_for_path(GOLDEN_EXPECTED_DIRECTORY)
        .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    const names = [];
    for (let info = enumerator.next_file(null); info !== null; info = enumerator.next_file(null))
        names.push(info.get_name());
    enumerator.close(null);
    return names.sort().map(name => ({name, recording: readGoldenFile(name)}));
}

/**
 * Lists where a parsed value has null although the raw one holds a value, at any depth. A list the parser filtered
 * (a ranking entry it dropped) or cut short is reported too, since its entries are values the reader lost.
 *
 * @param {*} rawValue - What the file holds.
 * @param {*} parsedValue - What a parser read from it.
 * @param {string} path - Where the pair is, for the report.
 * @param {{valueCount: number, lostPaths: string[]}} tally - Counts every value looked at and collects the paths lost.
 * @returns {void}
 */
function collectLostValues(rawValue, parsedValue, path, tally) {
    if (rawValue === null)
        return;
    tally.valueCount += 1;
    if (parsedValue === null || parsedValue === undefined) {
        tally.lostPaths.push(path);
    } else if (Array.isArray(rawValue)) {
        if (!Array.isArray(parsedValue) || parsedValue.length !== rawValue.length)
            tally.lostPaths.push(`${path} (a list of ${rawValue.length})`);
        else
            rawValue.forEach((item, index) => collectLostValues(item, parsedValue[index], `${path}[${index}]`, tally));
    } else if (typeof rawValue === 'object') {
        for (const [key, fieldValue] of Object.entries(rawValue))
            collectLostValues(fieldValue, parsedValue[key], `${path}.${key}`, tally);
    }
}

test('protocol: the parsers read every golden file', () => {
    const tally = {valueCount: 0, lostPaths: []};
    const goldenFiles = readGoldenFiles();
    for (const {name, recording} of goldenFiles) {
        recording.samples.forEach((sample, index) => {
            const sampleText = JSON.stringify(sample);
            collectLostValues(sample, parseSamplePayload(sampleText), `${name} samples[${index}]`, tally);
        });
        collectLostValues(recording.state, parseStatePayload(JSON.stringify(recording.state)), `${name} state`, tally);
    }
    // A directory that held no files, or files with nothing in them, would pass with nothing looked at.
    assertEqual({hasFiles: goldenFiles.length > 0, hasValues: tally.valueCount > 1000, lostPaths: tally.lostPaths},
        {hasFiles: true, hasValues: true, lostPaths: []});
});

test('protocol: a golden Sample with every part of a snapshot set (a-then-b\'s second) round-trips field for field',
    () => {
        const sample = readGoldenFile(ROUND_TRIP_GOLDEN_FILE_NAME).samples[ROUND_TRIP_SAMPLE_INDEX];
        const {snapshot, appendedHistory, sequence, sampledAtUsec} = sample;
        const hasEveryPart = [snapshot.cpuBusyPercent, snapshot.cpuClusters, snapshot.memory, snapshot.swap,
            snapshot.apps?.topCpu, snapshot.apps?.topMemory].every(part => part !== null && part !== undefined);
        assertEqual({hasEveryPart, parsed: parseSamplePayload(buildSamplePayload(sample))},
            {hasEveryPart: true, parsed: {snapshot, appendedHistory, sequence, sampledAtUsec}});
    });
