// The test double of the program's face (serviceDouble.js) on a PRIVATE message bus, with a fake sampler
// (fakeSampler.js). Run only by run-private-bus.js under `dbus-run-session`, never by run.js: that runs on whatever
// session bus its caller has, which at a desk is the live one. Every connection here is opened by address, and only
// once requirePrivateBusAddress has said the address is a path socket inside RESOURCE_PULSE_TEST_BUS_DIR, so a run
// anywhere else fails instead of reaching the live session. That guard, openPrivateBusConnection and waitUntil live in
// privateBus.js, which registers no rows; this file re-exports them for the rows that import them from here.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEqual} from './harness.js';
import {openPrivateBusConnection, waitUntil} from './privateBus.js';
import {FakeSampler} from './fakeSampler.js';
import {ResourcePulseServiceDouble} from './serviceDouble.js';
import {
    RESOURCE_PULSE_INTERFACE_NAME, RESOURCE_PULSE_OBJECT_PATH, parseSamplePayload, parseStatePayload,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';

const CALL_TIMEOUT_MS = 2000;
/** How long a row waits for a vanished caller's watch to drop: these rows' own bound. */
const VANISHED_WATCH_DROP_TIMEOUT_MS = 2000;
const SAMPLE_SIGNAL_TIMEOUT_MS = 2000;
const SERVICE_STARTED_AT_USEC = 1_794_000_000_000_000;
const SAMPLED_AT_USEC = 1_794_000_002_000_000;
/** How much later a second publish happens, in real microseconds. */
const LATER_PUBLISH_OFFSET_USEC = 2_000_000;
const STATE_REPLY_TYPE = new GLib.VariantType('(s)');
const SAMPLE_SIGNAL_NAME = 'Sample';
const GET_STATE_METHOD = 'GetState';
const WATCH_DETAIL_METHOD = 'WatchDetail';
const UNWATCH_DETAIL_METHOD = 'UnwatchDetail';

/** A snapshot with every field set, as the program would publish it after a scan. */
const TICK_SNAPSHOT = {
    takenAtUsec: 123_000_000,
    takenAtClockLabel: '14:02',
    cpuBusyPercent: 50,
    cpuClusters: {performancePercent: 60, efficiencyPercent: 20},
    memory: {usedBytes: 8_000_000_000, totalBytes: 32_000_000_000},
    swap: {zramUsedBytes: 0, zramRamBytes: 0, diskBytes: 0},
    pressureAvg10: {cpu: 0.5, memory: 0, io: 0},
    apps: {
        topCpu: {groupKey: 'app:org.example.Editor', name: 'Editor', cpuPercent: 31},
        topMemory: {groupKey: 'app:org.example.Editor', name: 'Editor', memoryBytes: 2_000_000_000},
        cpuRanking: [{groupKey: 'app:org.example.Editor', name: 'Editor', cpuPercent: 31}],
        memoryRanking: [{groupKey: 'app:org.example.Editor', name: 'Editor', memoryBytes: 2_000_000_000}],
    },
    isComplete: true,
};
/** What a watch start's reveal publishes: the tick's values with a new ranking, appending nothing. */
const REVEAL_SNAPSHOT = {
    ...TICK_SNAPSHOT,
    apps: {...TICK_SNAPSHOT.apps, topCpu: {groupKey: 'herdr-server', name: 'herdr agents', cpuPercent: 40}},
};
/** What the tick appended to the histories: the pressure history takes the snapshot's own percents. */
/** What a tick on time appends, as the real sampler writes it: no tick missed before it. */
const TICK_APPENDED_HISTORY = {cpu: 0.5, memory: 0.25, pressureAvg10: TICK_SNAPSHOT.pressureAvg10, missedTickCount: 0};

export {requirePrivateBusAddress, openPrivateBusConnection, waitUntil} from './privateBus.js';

/**
 * Exports a ResourcePulseServiceDouble for a fake sampler on its own connection, runs a row against it, and closes
 * every connection the row opened whatever happens.
 *
 * @param {(fixture: object) => Promise<void>} body - The row; gets {sampler, service, serviceName, openClient}.
 * @param {object} [options] - The service's clock.
 * @param {() => number} [options.nowRealUsec] - Real time now, in microseconds; SAMPLED_AT_USEC by default.
 * @returns {Promise<void>}
 */
async function withExportedService(body, {nowRealUsec = () => SAMPLED_AT_USEC} = {}) {
    const sampler = new FakeSampler();
    const serviceConnection = openPrivateBusConnection();
    const clientConnections = [];
    let service = null;
    try {
        service = new ResourcePulseServiceDouble(sampler, serviceConnection,
            {serviceStartedAtUsec: SERVICE_STARTED_AT_USEC, nowRealUsec});
        await body({
            sampler,
            service,
            serviceName: serviceConnection.get_unique_name(),
            openClient: () => {
                const clientConnection = openPrivateBusConnection();
                clientConnections.push(clientConnection);
                return clientConnection;
            },
        });
    } finally {
        service?.destroy();
        for (const connection of [...clientConnections, serviceConnection]) {
            if (!connection.is_closed())
                connection.close_sync(null);
        }
    }
}

/**
 * Calls a method of the service's interface.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @param {string} serviceName - The service connection's unique name.
 * @param {string} methodName - The method.
 * @param {GLib.VariantType|null} [replyType] - The reply's type, or null for none.
 * @returns {Promise<GLib.Variant>} The reply.
 */
function callServiceMethod(connection, serviceName, methodName, replyType = null) {
    return new Promise((resolve, reject) => {
        connection.call(serviceName, RESOURCE_PULSE_OBJECT_PATH, RESOURCE_PULSE_INTERFACE_NAME, methodName, null,
            replyType, Gio.DBusCallFlags.NONE, CALL_TIMEOUT_MS, null, (callingConnection, result) => {
                try {
                    resolve(callingConnection.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

/**
 * Calls GetState and parses its JSON.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @param {string} serviceName - The service connection's unique name.
 * @returns {Promise<object|null>} parseStatePayload's result.
 */
async function fetchState(connection, serviceName) {
    const reply = await callServiceMethod(connection, serviceName, GET_STATE_METHOD, STATE_REPLY_TYPE);
    const [stateText] = reply.deepUnpack();
    return parseStatePayload(stateText);
}

/**
 * Collects the Sample signals a connection receives from the service, parsed, until stopped.
 *
 * @param {Gio.DBusConnection} connection - The listener.
 * @param {string} serviceName - The service connection's unique name.
 * @returns {{samples: object[], stop: () => void}} The samples so far, and a way to unsubscribe.
 */
function collectSamples(connection, serviceName) {
    const samples = [];
    const subscriptionId = connection.signal_subscribe(serviceName, RESOURCE_PULSE_INTERFACE_NAME, SAMPLE_SIGNAL_NAME,
        RESOURCE_PULSE_OBJECT_PATH, null, Gio.DBusSignalFlags.NONE, (...signalArguments) => {
            const [sampleText] = signalArguments.at(-1).deepUnpack();
            samples.push(parseSamplePayload(sampleText));
        });
    return {samples, stop: () => connection.signal_unsubscribe(subscriptionId)};
}

test('service double: before any sample GetState answers protocol 1, sequence 0, the start time and the histories',
    () => withExportedService(async ({sampler, serviceName, openClient}) => {
        sampler.cpuHistory.push(0.25);
        sampler.cpuHistory.push(null);
        sampler.memoryHistory.push(0.5);
        sampler.memoryHistory.push(0.6);
        // As long as the CPU and memory histories, as the real sampler keeps them: one value of each per tick.
        const pressureAvg10 = {cpu: [1.5, null], memory: [null, 0], io: [30.25, 2]};
        for (const [resourceName, values] of Object.entries(pressureAvg10))
            values.forEach(value => sampler.pressureHistories[resourceName].push(value));
        assertEqual(await fetchState(openClient(), serviceName), {
            protocol: 1,
            snapshot: null,
            histories: {cpu: [0.25, null], memory: [0.5, 0.6], pressureAvg10},
            serviceStartedAtUsec: SERVICE_STARTED_AT_USEC,
            latestSampledAtUsec: null,
            sequence: 0,
        });
    }));

test('service double: each publish sends one Sample (sequence from 1; a reveal appends nothing), and GetState follows',
    () => withExportedService(async ({sampler, serviceName, openClient}) => {
        const clientConnection = openClient();
        const sampleCollector = collectSamples(clientConnection, serviceName);
        // A round trip first, so the subscription is in place on the bus before anything is published.
        await fetchState(clientConnection, serviceName);
        sampler.publish(TICK_SNAPSHOT, TICK_APPENDED_HISTORY);
        sampler.publish(REVEAL_SNAPSHOT, null);
        const didArrive = await waitUntil(() => sampleCollector.samples.length >= 2, SAMPLE_SIGNAL_TIMEOUT_MS);
        sampleCollector.stop();
        const state = await fetchState(clientConnection, serviceName);
        assertEqual({didArrive, samples: sampleCollector.samples, state}, {
            didArrive: true,
            samples: [
                {snapshot: TICK_SNAPSHOT, appendedHistory: TICK_APPENDED_HISTORY, sequence: 1,
                    sampledAtUsec: SAMPLED_AT_USEC},
                {snapshot: REVEAL_SNAPSHOT, appendedHistory: null, sequence: 2, sampledAtUsec: SAMPLED_AT_USEC},
            ],
            state: {
                protocol: 1,
                snapshot: REVEAL_SNAPSHOT,
                histories: {cpu: [0.5], memory: [0.25], pressureAvg10: {cpu: [0.5], memory: [0], io: [0]}},
                serviceStartedAtUsec: SERVICE_STARTED_AT_USEC,
                latestSampledAtUsec: SAMPLED_AT_USEC,
                sequence: 2,
            },
        });
    }));

test('service double: GetState\'s latestSampledAtUsec is the real time of the latest publish, a reveal\'s included',
    () => {
        const publishRealTimesUsec = [SAMPLED_AT_USEC, SAMPLED_AT_USEC + LATER_PUBLISH_OFFSET_USEC];
        const remainingRealTimesUsec = [...publishRealTimesUsec];
        return withExportedService(async ({sampler, serviceName, openClient}) => {
            const clientConnection = openClient();
            sampler.publish(TICK_SNAPSHOT, TICK_APPENDED_HISTORY);
            const afterTick = (await fetchState(clientConnection, serviceName)).latestSampledAtUsec;
            sampler.publish(REVEAL_SNAPSHOT, null);
            const afterReveal = (await fetchState(clientConnection, serviceName)).latestSampledAtUsec;
            assertEqual({afterTick, afterReveal},
                {afterTick: publishRealTimesUsec[0], afterReveal: publishRealTimesUsec[1]});
        }, {nowRealUsec: () => remainingRealTimesUsec.shift()});
    });

test('service double: a caller that closes its connection holding a watch loses it: setDetailWatched(false) in 2 s',
    () => withExportedService(async ({sampler, serviceName, openClient}) => {
        const clientConnection = openClient();
        await callServiceMethod(clientConnection, serviceName, WATCH_DETAIL_METHOD);
        const callsWhileWatched = [...sampler.detailWatchedCalls];
        clientConnection.close_sync(null);
        const didDrop = await waitUntil(() => sampler.detailWatchedCalls.length >= 2, VANISHED_WATCH_DROP_TIMEOUT_MS);
        assertEqual({callsWhileWatched, didDrop, calls: sampler.detailWatchedCalls},
            {callsWhileWatched: [true], didDrop: true, calls: [true, false]});
    }));

test('service double: a caller holding two watches that vanishes drops both: setDetailWatched(false), count 0', () =>
    withExportedService(async ({sampler, service, serviceName, openClient}) => {
        const clientConnection = openClient();
        await callServiceMethod(clientConnection, serviceName, WATCH_DETAIL_METHOD);
        await callServiceMethod(clientConnection, serviceName, WATCH_DETAIL_METHOD);
        const countWhileWatched = service.detailWatchCount;
        clientConnection.close_sync(null);
        const didDropBoth = await waitUntil(() => service.detailWatchCount === 0, VANISHED_WATCH_DROP_TIMEOUT_MS);
        assertEqual({countWhileWatched, didDropBoth, calls: sampler.detailWatchedCalls,
            countAfter: service.detailWatchCount}, {countWhileWatched: 2, didDropBoth: true, calls: [true, false],
            countAfter: 0});
    }));

test('service double: two watches from one caller need two unwatches', () =>
    withExportedService(async ({sampler, serviceName, openClient}) => {
        const clientConnection = openClient();
        const callsAfterEachStep = [];
        for (const methodName of [WATCH_DETAIL_METHOD, WATCH_DETAIL_METHOD, UNWATCH_DETAIL_METHOD,
            UNWATCH_DETAIL_METHOD]) {
            // In sequence: each step is checked after the one before it has been answered.
            await callServiceMethod(clientConnection, serviceName, methodName);
            callsAfterEachStep.push(sampler.detailWatchedCalls.join(','));
        }
        assertEqual(callsAfterEachStep, ['true', 'true', 'true', 'true,false']);
    }));

test('service double: UnwatchDetail from a caller holding no watch is a no-op, not an error', () =>
    withExportedService(async ({sampler, service, serviceName, openClient}) => {
        const watchingConnection = openClient();
        const idleConnection = openClient();
        await callServiceMethod(idleConnection, serviceName, UNWATCH_DETAIL_METHOD);
        const callsAfterLoneUnwatch = [...sampler.detailWatchedCalls];
        await callServiceMethod(watchingConnection, serviceName, WATCH_DETAIL_METHOD);
        await callServiceMethod(idleConnection, serviceName, UNWATCH_DETAIL_METHOD);
        assertEqual({callsAfterLoneUnwatch, calls: sampler.detailWatchedCalls, watchCount: service.detailWatchCount},
            {callsAfterLoneUnwatch: [], calls: [true], watchCount: 1});
    }));

test('service double: one caller vanishing leaves another\'s watch, and the sampler hears only changes', () =>
    withExportedService(async ({sampler, service, serviceName, openClient}) => {
        const vanishingConnection = openClient();
        const stayingConnection = openClient();
        await callServiceMethod(vanishingConnection, serviceName, WATCH_DETAIL_METHOD);
        await callServiceMethod(stayingConnection, serviceName, WATCH_DETAIL_METHOD);
        const countWithBoth = service.detailWatchCount;
        vanishingConnection.close_sync(null);
        const didDropVanished = await waitUntil(() => service.detailWatchCount === 1, VANISHED_WATCH_DROP_TIMEOUT_MS);
        const callsAfterVanish = [...sampler.detailWatchedCalls];
        await callServiceMethod(stayingConnection, serviceName, UNWATCH_DETAIL_METHOD);
        assertEqual({countWithBoth, didDropVanished, callsAfterVanish, calls: sampler.detailWatchedCalls},
            {countWithBoth: 2, didDropVanished: true, callsAfterVanish: [true], calls: [true, false]});
    }));

test('service double: destroy() unexports the object and detaches from the sampler', () =>
    withExportedService(async ({sampler, service, serviceName, openClient}) => {
        const clientConnection = openClient();
        const listenersBefore = sampler.listenerCount;
        service.destroy();
        let callError = null;
        try {
            await fetchState(clientConnection, serviceName);
        } catch (error) {
            callError = error;
        }
        const isUnknownMethodOrObject = callError instanceof GLib.Error &&
            (callError.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD) ||
             callError.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_OBJECT));
        assertEqual({listenersBefore, listenersAfter: sampler.listenerCount, isUnknownMethodOrObject},
            {listenersBefore: 1, listenersAfter: 0, isUnknownMethodOrObject: true});
    }));
