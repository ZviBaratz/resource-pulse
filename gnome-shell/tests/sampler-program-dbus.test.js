// The compiled sampler (resource-pulse-sampler/) on a PRIVATE message bus: the rules its bus link must keep. Run only
// by run-sampler-program.js under `dbus-run-session`, which scripts/test-resource-pulse-sampler-bus.sh starts with
// the program's path. Every copy of the program a row starts is given the private bus's address, checked by
// requirePrivateBusAddress, as its session bus, and is stopped again by that row whatever happens; the last row
// asserts from the rows' own bookkeeping that none is left running, and the row before it that the bookkeeping it
// reads is the launcher's own.
//
// Every copy serves the real sampler over a fixture root (--fs-root; fixtures/root-a unless a row says otherwise), so
// no row reads the host's /proc or scans its cgroup tree, least of all at 20 ms ticks. The state's and each
// Sample's sequence are top-level numbers, which the order row compares.
//
// No row reads the host's .desktop files either: spawnProgram gives every copy the program's real inputs for app
// names, XDG_DATA_HOME, XDG_DATA_DIRS and HOME, pointing into resource-pulse-sampler/tests/fixtures/bus-desktop, with
// the language variables fixed (PROGRAM_DATA_ENVIRONMENT), overwriting whatever the runner's own environment holds.
// Without that, the reveal row and the conformance row fail, each naming the fixture's names it misses. Nothing in the
// runner's own process looks an app's name up, so the runner checks nothing of its own environment.
//
// This file holds the rows, in the order they run, and what only they use. The program's launcher (spawnProgram,
// withServingProgram, runningPrograms, PROGRAM_DATA_ENVIRONMENT) is samplerProgramLauncher.js; what the rows share
// (the timed row wrapper, test, and the calls and recordings) is programRowSupport.js. Every row registers through
// that test, never harness.js's own, so that each has its deadline.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {assertEqual} from './harness.js';
import {openPrivateBusConnection, waitUntil} from './privateBus.js';
import {
    BUS_DAEMON_INTERFACE_NAME, BUS_DAEMON_NAME, BUS_DAEMON_OBJECT_PATH, CALL_TIMEOUT_MS, INTROSPECTABLE_INTERFACE_NAME,
    INTROSPECT_METHOD, MISSING_METHOD_NAME, PEER_INTERFACE_NAME, PING_METHOD, STRING_REPLY_TYPE,
    UNKNOWN_METHOD_ERROR_NAME, callGetStateWithoutInterface, callMethod, callResourcePulseMethod, closeConnection,
    describeCallOutcome, describeInterface, describeNode, parseStringReply, subscribeToSamples,
} from './busCalls.js';
import {
    ANY_SENDER, CONFORMANCE_TICK_INTERVAL_MS, assertDoubleGaveWhatProgramGave, assertExchangeIsTheOneMeant,
    awaitNextTickSample, describeParting, runConformanceExchange, startTranscript,
} from './conformanceExchange.js';
import {createConformanceRoots, pointLinkAt, rootAfterTicks} from './conformanceRoots.js';
import {runExchangeAgainstDouble} from './conformanceDoubleSide.js';
import {
    GET_STATE_METHOD_NAME, PROTOCOL_VERSION, RESOURCE_PULSE_BUS_NAME, RESOURCE_PULSE_INTERFACE_NAME,
    RESOURCE_PULSE_INTERFACE_XML, RESOURCE_PULSE_OBJECT_PATH, WATCH_DETAIL_METHOD_NAME, parseSamplePayload,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';
import {
    FIXTURE_ROOT_PATH, NAME_OWNED_TIMEOUT_MS, PROGRAM_EXIT_TIMEOUT_MS, TICK_INTERVAL_FLAG, runningPrograms, spawnProgram,
    stopProgram, waitForFreeName, watchBusName, withServingProgram,
} from './samplerProgramLauncher.js';
// The launcher's exports as one namespace, apart from the names above: the Set the last row reads is held to it.
import * as programLauncher from './samplerProgramLauncher.js';
import {
    MICROSECONDS_PER_MILLISECOND, REPLY_ARRIVAL, REVEAL_TIMEOUT_MS, SAMPLE_ARRIVAL, checkReplyOrder, delay,
    fetchNameOwner, fetchState, fetchStateText, introspectPath, recordReveals, recordSamples, test,
    watchAndAwaitReveal,
} from './programRowSupport.js';
import {createSeededRandom, removeTree, writeGarbageTree} from './fixtureTrees.js';

/** Ticks this fast give the order row hundreds of Samples to interleave its replies with. */
const FAST_TICK_INTERVAL_MS = 20;
const ORDER_RUN_DURATION_MS = 10_000;
/** Below these the order row could pass on a run that hardly ticked or hardly asked. */
const MIN_ORDER_REPLY_COUNT = 200;
const MIN_ORDER_SAMPLE_COUNT = 400;
const START_COUNT = 50;
const NAME_HELD_EXIT_STATUS = 1;
const REQUEST_NAME_METHOD = 'RequestName';
/** RequestName's flags and its "the name has another owner" reply, from the D-Bus specification. */
const REQUEST_NAME_REPLACE_EXISTING_FLAG = 0x2;
const REQUEST_NAME_DO_NOT_QUEUE_FLAG = 0x4;
const REQUEST_NAME_REPLY_EXISTS = 3;
const GET_MACHINE_ID_METHOD = 'GetMachineId';
const PROPERTIES_INTERFACE_NAME = 'org.freedesktop.DBus.Properties';
const GET_ALL_PROPERTIES_METHOD = 'GetAll';
/** The root path, above the program's object: GDBus answers Introspect there with the next node down. */
const ROOT_OBJECT_PATH = '/';
/** The nodes between the root and the program's object, each with the next one down as its one child. */
const NODES_ABOVE_OBJECT = [
    {path: '/io', child: 'github'},
    {path: '/io/github', child: 'zvibaratz'},
    {path: '/io/github/zvibaratz', child: 'ResourcePulse1'},
];
const INVALID_ARGS_ERROR_NAME = 'org.freedesktop.DBus.Error.InvalidArgs';
/** An interface nobody has, for a GetAll that GDBus refuses. */
const UNKNOWN_INTERFACE_NAME = 'org.example.Unknown';
/** A machine id, as D-Bus defines it: 32 lowercase hex digits. */
const MACHINE_ID_PATTERN = /^[0-9a-f]{32}$/;
/**
 * The disconnect row's timing, set by the sampler's scan rules: a watch start reveals only two ticks or more after the
 * last watch-start scan (the reveal cooldown) and 1 s or more after the last scan of any kind (the CPU ranking window),
 * and each first or watch-start scan arms a warm-up scan at the first tick 1 s after it. So it ticks fast (the cooldown
 * is long over by the second watch); the first watch comes 3 s in, past the start-up warm-up's window; and the first
 * caller holds its watch 1.5 s, so that the warm-up its watch arms (1 to 1.2 s after it) is 1 s and more in the past
 * when the second caller watches, 1.5 s after the first left: inside the 2 s within which service-dbus.test.js's rows
 * require a vanished caller's watch to drop (VANISHED_WATCH_DROP_TIMEOUT_MS, their own bound). Each reveal must arrive
 * within 1 s of its call (REVEAL_TIMEOUT_MS, programRowSupport.js's).
 */
const DISCONNECT_ROW_TICK_INTERVAL_MS = 200;
const BEFORE_FIRST_WATCH_MS = 3000;
const FIRST_WATCH_HOLD_MS = 1500;
const AFTER_DISCONNECT_MS = 1500;
/**
 * The simple rows' timing. A Sample is waited for, never a duration, wherever a count of them is known; the waits that
 * remain are bounds on a failure (the row fails when one runs out) and the two delays below, each a lower bound the
 * program's own rules need, which a slow runner can only lengthen.
 */
const STATE_ROW_TICK_INTERVAL_MS = 300;
/** The next Sample after a state reply: one tick is 300 ms, so 5 s is more than sixteen ticks' slack. */
const NEXT_SAMPLE_TIMEOUT_MS = 5000;
/** A tick so slow that no tick Sample can arrive while the reveal row runs (it runs for about 2.5 s). */
const SLOW_TICK_INTERVAL_MS = 5000;
/**
 * A watch start reveals only 1 s or more after the last scan of any kind (the CPU ranking window), and the first scan is
 * the first tick's, which has run by the time the name is seen. Waiting 2 s from there leaves 1 s of margin, and a slow
 * runner only widens it.
 */
const RANKING_WINDOW_CLEARED_DELAY_MS = 2000;
/** The garbage row's rate: 50 ticks take 1 s of ticking; a runner 30 times slower still finishes inside the bound. */
const GARBAGE_ROW_TICK_INTERVAL_MS = 20;
const GARBAGE_ROW_SAMPLE_COUNT = 50;
const GARBAGE_ROW_TIMEOUT_MS = 30_000;
/** Fixed, so that a failing garbage tree is the same tree on every run and can be rebuilt to look at. */
const GARBAGE_TREE_SEED = 20_261_114;
/** What a failing step of the conformance exchange names the program's side as. */
const PROGRAM_SIDE_LABEL = 'the compiled program';
/** What root-a's memory is, in the state and in each Sample. */
const ROOT_A_MEMORY = {usedBytes: 20_480_000_000, totalBytes: 32_768_000_000};
/** The name root-a's Chrome scopes resolve to, from the fixture's com.google.Chrome.desktop and nowhere else. */
const CHROME_FIXTURE_APP_NAME = 'Chrome From The Bus Fixture';
/**
 * The compact text GetState answers (a status script cuts fields out of it): its first five keys, in this order. Both
 * calls of the row come after the first tick (which runs before any call is answered), so the time of the latest Sample
 * is a number, never `null`: a looser pattern such as `(\d+|null)` would hide a program that never sets it (the unit
 * row holds `null`).
 */
const STATE_TEXT_PATTERN =
    /^\{"protocol":1,"serviceStartedAtUsec":\d+,"latestSampledAtUsec":\d+,"sequence":\d+,"snapshot":/;
const REQUEST_NAME_REPLY_TYPE = new GLib.VariantType('(u)');

/**
 * Runs the conformance exchange against the program, over roots that move one fixture on per tick, and stops the
 * program. The transcript starts before the program does, so it holds every Sample the program sends, its first tick's
 * included.
 *
 * @param {string} workDirectoryPath - A directory of the row's own, for the roots and the link the program reads.
 * @returns {Promise<object>} runConformanceExchange's result.
 */
async function runExchangeAgainstProgram(workDirectoryPath) {
    const rootPaths = createConformanceRoots(workDirectoryPath);
    const rootLinkPath = GLib.build_filenamev([workDirectoryPath, 'program-root']);
    pointLinkAt(rootLinkPath, rootAfterTicks(rootPaths, 0));
    const clientConnection = openPrivateBusConnection();
    try {
        // The program's unique name is not known before it starts, so the transcript takes a Sample from any sender:
        // the program is the only service on the private bus, and a Sample from anyone else would show in the
        // exchange's summary. Each tick's Sample moves the root on inside its own callback, so the next tick finds the
        // next root however slow the client is.
        const recording = await startTranscript(clientConnection, ANY_SENDER,
            tickSampleCount => pointLinkAt(rootLinkPath, rootAfterTicks(rootPaths, tickSampleCount)));
        let result = null;
        try {
            await withServingProgram([TICK_INTERVAL_FLAG, String(CONFORMANCE_TICK_INTERVAL_MS)],
                async ({ownerName}) => {
                    result = await runConformanceExchange({
                        label: PROGRAM_SIDE_LABEL,
                        destination: ownerName,
                        clientConnection,
                        recording,
                        produceTick: () => awaitNextTickSample(recording),
                    });
                }, rootLinkPath);
        } finally {
            recording.stop();
        }
        return result;
    } finally {
        await closeConnection(clientConnection);
    }
}

test('program: a state reply carrying sequence N arrives after Sample N and before Sample N+1', () =>
    withServingProgram([TICK_INTERVAL_FLAG, String(FAST_TICK_INTERVAL_MS)], async ({ownerName, openClient}) => {
        const clientConnection = openClient();
        const arrivals = [];
        const stopSubscription = subscribeToSamples(clientConnection, ownerName, sampleText => {
            arrivals.push({kind: SAMPLE_ARRIVAL, sequence: JSON.parse(sampleText).sequence});
        });
        try {
            // A round trip first, so the subscription is in place on the bus before anything is recorded.
            await fetchState(clientConnection);
            arrivals.length = 0;
            const deadlineUsec = GLib.get_monotonic_time() + ORDER_RUN_DURATION_MS * MICROSECONDS_PER_MILLISECOND;
            const recordReply = reply => arrivals.push({kind: REPLY_ARRIVAL, sequence: parseStringReply(reply).sequence});
            while (GLib.get_monotonic_time() < deadlineUsec) {
                // One call in flight at a time, as a client asks.
                await callResourcePulseMethod(clientConnection, GET_STATE_METHOD_NAME,
                    {replyType: STRING_REPLY_TYPE, onReply: recordReply});
            }
        } finally {
            stopSubscription();
        }
        const verdict = checkReplyOrder(arrivals);
        print(`#   order row: ${verdict.replyCount} replies, ${verdict.sampleCount} Samples, ` +
            `${verdict.violationCount} violations`);
        assertEqual({
            hasEnoughReplies: verdict.replyCount >= MIN_ORDER_REPLY_COUNT,
            hasEnoughSamples: verdict.sampleCount >= MIN_ORDER_SAMPLE_COUNT,
            violationCount: verdict.violationCount,
            violations: verdict.violations,
        }, {hasEnoughReplies: true, hasEnoughSamples: true, violationCount: 0, violations: []},
        `${verdict.replyCount} replies, ${verdict.sampleCount} Samples`);
    }));

test(`program: a call made the instant the name appears is answered, ${START_COUNT} starts out of ${START_COUNT}`,
    async () => {
        const watcherConnection = openPrivateBusConnection();
        const outcomes = [];
        /** The start under way: its outcome is set once, by the call's answer or failure. */
        let currentStart = {outcome: null};
        // The call goes out from the name-appeared handler itself, as a client's first GetState does.
        const watch = watchBusName(watcherConnection, () => {
            const appearedStart = currentStart;
            fetchState(watcherConnection)
                .then(() => {
                    appearedStart.outcome ??= 'answered';
                })
                .catch(error => {
                    appearedStart.outcome ??= error.message;
                });
        });
        try {
            for (let startNumber = 1; startNumber <= START_COUNT; startNumber++) {
                // Each start waits for the one before it to end.
                await waitForFreeName(watch);
                const thisStart = {outcome: null};
                currentStart = thisStart;
                const program = spawnProgram([]);
                try {
                    await waitUntil(() => thisStart.outcome !== null || program.hasExited,
                        NAME_OWNED_TIMEOUT_MS + CALL_TIMEOUT_MS);
                } finally {
                    await stopProgram(program);
                }
                outcomes.push(thisStart.outcome ??
                    `start ${startNumber}: no answer, the program exited with status ${program.exitStatus}`);
            }
        } finally {
            watch.stop();
            await closeConnection(watcherConnection);
        }
        const failures = outcomes.filter(outcome => outcome !== 'answered');
        assertEqual({answeredCount: outcomes.length - failures.length, failures: failures.slice(0, 3)},
            {answeredCount: START_COUNT, failures: []});
    });

test('program: a second copy exits 1 and the first still owns the name', () =>
    withServingProgram([], async ({program, ownerName, openClient}) => {
        const secondCopy = spawnProgram([]);
        try {
            const didSecondExit = await waitUntil(() => secondCopy.hasExited, PROGRAM_EXIT_TIMEOUT_MS);
            const clientConnection = openClient();
            const ownerAfterSecond = await fetchNameOwner(clientConnection);
            const state = await fetchState(clientConnection);
            assertEqual({
                didSecondExit,
                secondExitStatus: secondCopy.exitStatus,
                ownerAfterSecond,
                isFirstRunning: !program.hasExited,
                doesFirstAnswer: Number.isInteger(state.sequence),
            }, {
                didSecondExit: true,
                secondExitStatus: NAME_HELD_EXIT_STATUS,
                ownerAfterSecond: ownerName,
                isFirstRunning: true,
                doesFirstAnswer: true,
            });
        } finally {
            await stopProgram(secondCopy);
        }
    }));

test('program: an unknown method is answered with org.freedesktop.DBus.Error.UnknownMethod', () =>
    withServingProgram([], async ({openClient}) => {
        let remoteErrorName = 'no error';
        try {
            await callResourcePulseMethod(openClient(), MISSING_METHOD_NAME);
        } catch (error) {
            // A call left unanswered ends in a local time-out after CALL_TIMEOUT_MS, which has no remote name.
            remoteErrorName = Gio.DBusError.get_remote_error(error) ?? `not a remote error: ${error.message}`;
        }
        assertEqual(remoteErrorName, UNKNOWN_METHOD_ERROR_NAME);
    }));

// The program answers what the gjs service's bus (GDBus) answered on every object, as probed on a private bus with the
// gjs service exported (call_routing.rs's rows hold each answer): Introspect on the root names the next node down and
// no interface, and Peer.Ping on the object answers nothing. What these rows pin besides is that the call is answered
// at all.
test('program: Introspect on the root path is answered, not left to time out', () =>
    withServingProgram([], async ({openClient}) => {
        let rootNode = null;
        const outcome = await describeCallOutcome(introspectPath(openClient(), ROOT_OBJECT_PATH).then(nodeInfo => {
            rootNode = describeNode(nodeInfo);
        }));
        assertEqual({outcome, rootNode}, {outcome: 'answered', rootNode: {interfaceNames: [], childNames: ['io']}});
    }));

test('program: Peer.Ping on the program\'s own path is answered, not left to time out', () =>
    withServingProgram([], async ({openClient}) => {
        let replyTypeString = null;
        const outcome = await describeCallOutcome(callMethod(openClient(), {
            destination: RESOURCE_PULSE_BUS_NAME,
            objectPath: RESOURCE_PULSE_OBJECT_PATH,
            interfaceName: PEER_INTERFACE_NAME,
            methodName: PING_METHOD,
            onReply: reply => {
                replyTypeString = reply.get_type_string();
            },
        }));
        assertEqual({outcome, replyTypeString}, {outcome: 'answered', replyTypeString: '()'});
    }));

test('program: GetState with no interface returns the state', () =>
    withServingProgram([], async ({openClient}) => {
        let state = null;
        const outcome = await describeCallOutcome(callGetStateWithoutInterface(openClient(), reply => {
            state = parseStringReply(reply);
        }));
        assertEqual({outcome, hasSequence: Number.isInteger(state?.sequence)},
            {outcome: 'answered', hasSequence: true});
    }));

// GDBus lists the three standard interfaces before the object's own, which is what the gjs service's bus answered.
test('program: Introspect returns the interface with its three methods and its signal', () =>
    withServingProgram([], async ({openClient}) => {
        const programNode = await introspectPath(openClient(), RESOURCE_PULSE_OBJECT_PATH);
        const protocolInterface = describeInterface(
            Gio.DBusNodeInfo.new_for_xml(RESOURCE_PULSE_INTERFACE_XML).lookup_interface(RESOURCE_PULSE_INTERFACE_NAME));
        assertEqual({
            node: describeNode(programNode),
            programInterface: describeInterface(programNode.lookup_interface(RESOURCE_PULSE_INTERFACE_NAME)),
            protocolMethodCount: protocolInterface.methods.length,
            protocolSignalCount: protocolInterface.signals.length,
            introspectable: describeInterface(programNode.lookup_interface(INTROSPECTABLE_INTERFACE_NAME)),
            peer: describeInterface(programNode.lookup_interface(PEER_INTERFACE_NAME)),
            properties: describeInterface(programNode.lookup_interface(PROPERTIES_INTERFACE_NAME)),
        }, {
            node: {
                interfaceNames: [PROPERTIES_INTERFACE_NAME, INTROSPECTABLE_INTERFACE_NAME, PEER_INTERFACE_NAME,
                    RESOURCE_PULSE_INTERFACE_NAME],
                childNames: [],
            },
            programInterface: protocolInterface,
            protocolMethodCount: 3,
            protocolSignalCount: 1,
            introspectable: {
                methods: [{name: INTROSPECT_METHOD, inArguments: [], outArguments: ['s']}],
                signals: [],
                properties: [],
            },
            peer: {
                methods: [
                    {name: PING_METHOD, inArguments: [], outArguments: []},
                    {name: GET_MACHINE_ID_METHOD, inArguments: [], outArguments: ['s']},
                ],
                signals: [],
                properties: [],
            },
            properties: {
                methods: [
                    {name: 'Get', inArguments: ['s', 's'], outArguments: ['v']},
                    {name: GET_ALL_PROPERTIES_METHOD, inArguments: ['s'], outArguments: ['a{sv}']},
                    {name: 'Set', inArguments: ['s', 's', 'v'], outArguments: []},
                ],
                signals: [{name: 'PropertiesChanged', arguments: ['s', 'a{sv}', 'as']}],
                properties: [],
            },
        });
    }));

test('program: Properties.GetAll, Peer.GetMachineId and Introspect on every node above the object answer as GDBus does',
    () => withServingProgram([], async ({openClient}) => {
        const clientConnection = openClient();
        const callStandard = (interfaceName, methodName, parameters = null) => callMethod(clientConnection, {
            destination: RESOURCE_PULSE_BUS_NAME,
            objectPath: RESOURCE_PULSE_OBJECT_PATH,
            interfaceName,
            methodName,
            parameters,
        });
        const allProperties = await callStandard(PROPERTIES_INTERFACE_NAME, GET_ALL_PROPERTIES_METHOD,
            new GLib.Variant('(s)', [RESOURCE_PULSE_INTERFACE_NAME]));
        const unknownInterfaceOutcome = await describeCallOutcome(callStandard(PROPERTIES_INTERFACE_NAME,
            GET_ALL_PROPERTIES_METHOD, new GLib.Variant('(s)', [UNKNOWN_INTERFACE_NAME])));
        const [machineId] = (await callStandard(PEER_INTERFACE_NAME, GET_MACHINE_ID_METHOD)).deepUnpack();
        const nodes = [];
        for (const {path} of NODES_ABOVE_OBJECT)
            nodes.push(describeNode(await introspectPath(clientConnection, path)));
        // The machine id itself is never printed: only whether it has a machine id's form.
        assertEqual({
            allPropertiesType: allProperties.get_type_string(),
            allProperties: allProperties.deepUnpack(),
            unknownInterfaceOutcome,
            isMachineId: MACHINE_ID_PATTERN.test(machineId),
            nodes,
        }, {
            allPropertiesType: '(a{sv})',
            allProperties: [{}],
            unknownInterfaceOutcome: `error reply: ${INVALID_ARGS_ERROR_NAME}`,
            isMachineId: true,
            nodes: NODES_ABOVE_OBJECT.map(({child}) => ({interfaceNames: [], childNames: [child]})),
        });
    }));

// The end-to-end twin of the two flag tests in resource-pulse-sampler/tests/bus_link.rs. Those pin that the program
// neither takes the name from an owner that allows replacement nor queues behind an owner; this row pins that it does
// not allow replacement itself. Together they hold "do not queue only".
test('program: it does not allow replacement: a request with REPLACE_EXISTING gets "exists" and the name stays its own',
    () => withServingProgram([], async ({ownerName, openClient}) => {
        const helperConnection = openClient();
        // With REPLACE_EXISTING the helper takes the name from any owner that asked with ALLOW_REPLACEMENT.
        const reply = await callMethod(helperConnection, {
            destination: BUS_DAEMON_NAME,
            objectPath: BUS_DAEMON_OBJECT_PATH,
            interfaceName: BUS_DAEMON_INTERFACE_NAME,
            methodName: REQUEST_NAME_METHOD,
            parameters: new GLib.Variant('(su)', [RESOURCE_PULSE_BUS_NAME,
                REQUEST_NAME_REPLACE_EXISTING_FLAG | REQUEST_NAME_DO_NOT_QUEUE_FLAG]),
            replyType: REQUEST_NAME_REPLY_TYPE,
        });
        const [requestNameReply] = reply.deepUnpack();
        assertEqual({requestNameReply, ownerAfterRequest: await fetchNameOwner(helperConnection)},
            {requestNameReply: REQUEST_NAME_REPLY_EXISTS, ownerAfterRequest: ownerName});
    }));

// A watch still held for the first caller would make the second caller's WatchDetail no watch start, and no reveal.
test('program: a caller that disconnects loses its watches', () =>
    withServingProgram([TICK_INTERVAL_FLAG, String(DISCONNECT_ROW_TICK_INTERVAL_MS)], async ({ownerName, openClient}) => {
        const observerConnection = openClient();
        const reveals = recordReveals(observerConnection, ownerName);
        try {
            // A round trip first, so the subscription is in place on the bus before any watch.
            await fetchState(observerConnection);
            await delay(BEFORE_FIRST_WATCH_MS);
            const leavingConnection = openClient();
            const didFirstReveal = await watchAndAwaitReveal(leavingConnection, reveals);
            await delay(FIRST_WATCH_HOLD_MS);
            await closeConnection(leavingConnection);
            await delay(AFTER_DISCONNECT_MS);
            const didSecondReveal = await watchAndAwaitReveal(openClient(), reveals);
            assertEqual({didFirstReveal, didSecondReveal}, {didFirstReveal: true, didSecondReveal: true});
        } finally {
            reveals.stop();
        }
    }));

test('program: GetState, then a Sample, on root-a', () =>
    withServingProgram([TICK_INTERVAL_FLAG, String(STATE_ROW_TICK_INTERVAL_MS)], async ({ownerName, openClient}) => {
        const clientConnection = openClient();
        const recording = recordSamples(clientConnection, ownerName);
        try {
            const {state, sampleCountAtReply} = await fetchStateText(clientConnection, recording);
            // The first Sample after the reply: a Sample that came before it is not this row's to count.
            const didSampleArrive = await waitUntil(() => recording.samples.length > sampleCountAtReply,
                NEXT_SAMPLE_TIMEOUT_MS);
            const nextSample = recording.samples[sampleCountAtReply]?.parsed;
            assertEqual({
                didSampleArrive,
                protocol: state.protocol,
                memory: state.snapshot?.memory,
                nextSampleSequence: nextSample?.sequence,
            }, {
                didSampleArrive: true,
                protocol: PROTOCOL_VERSION,
                memory: ROOT_A_MEMORY,
                nextSampleSequence: state.sequence + 1,
            });
        } finally {
            recording.stop();
        }
    }));

test('program: WatchDetail reveals the ranking at once', () =>
    withServingProgram([TICK_INTERVAL_FLAG, String(SLOW_TICK_INTERVAL_MS)], async ({ownerName, openClient}) => {
        const observerConnection = openClient();
        const recording = recordSamples(observerConnection, ownerName);
        try {
            // A round trip first, so the subscription is in place on the bus before the watch.
            await fetchState(observerConnection);
            await delay(RANKING_WINDOW_CLEARED_DELAY_MS);
            const sampleCountBeforeCall = recording.samples.length;
            const calledAtUsec = GLib.get_monotonic_time();
            await callResourcePulseMethod(openClient(), WATCH_DETAIL_METHOD_NAME);
            await waitUntil(() => recording.samples.length > sampleCountBeforeCall, REVEAL_TIMEOUT_MS);
            const reveal = recording.samples[sampleCountBeforeCall];
            const apps = reveal?.parsed.snapshot.apps;
            assertEqual({
                appendedHistory: reveal?.parsed.appendedHistory,
                isRankingPresent: apps?.memoryRanking.length > 0,
                isNameFromFixtureDesktopFile: apps?.memoryRanking.some(app => app.name === CHROME_FIXTURE_APP_NAME),
                arrivedWithinTimeout: reveal !== undefined &&
                    reveal.arrivalUsec - calledAtUsec <= REVEAL_TIMEOUT_MS * MICROSECONDS_PER_MILLISECOND,
            }, {
                appendedHistory: null, isRankingPresent: true, isNameFromFixtureDesktopFile: true,
                arrivedWithinTimeout: true,
            });
        } finally {
            recording.stop();
        }
    }));

test('program: the state\'s text has its compact form at the first call and after a further Sample', () =>
    withServingProgram([TICK_INTERVAL_FLAG, String(STATE_ROW_TICK_INTERVAL_MS)], async ({ownerName, openClient}) => {
        const clientConnection = openClient();
        const recording = recordSamples(clientConnection, ownerName);
        try {
            const first = await fetchStateText(clientConnection, recording);
            await waitUntil(() => recording.samples.length > first.sampleCountAtReply, NEXT_SAMPLE_TIMEOUT_MS);
            const second = await fetchStateText(clientConnection, recording);
            assertEqual({
                firstMatches: STATE_TEXT_PATTERN.test(first.text),
                secondMatches: STATE_TEXT_PATTERN.test(second.text),
                isSecondLater: second.state.sequence > first.state.sequence,
            }, {firstMatches: true, secondMatches: true, isSecondLater: true}, `${first.text.slice(0, 120)}`);
        } finally {
            recording.stop();
        }
    }));

test('program: a tree of truncated and garbage files keeps publishing', async () => {
    const garbageRootPath = GLib.dir_make_tmp('resource-pulse-garbage-XXXXXX');
    try {
        writeGarbageTree(FIXTURE_ROOT_PATH, garbageRootPath, createSeededRandom(GARBAGE_TREE_SEED));
        await withServingProgram([TICK_INTERVAL_FLAG, String(GARBAGE_ROW_TICK_INTERVAL_MS)],
            async ({program, ownerName, openClient}) => {
                const clientConnection = openClient();
                const recording = recordSamples(clientConnection, ownerName);
                try {
                    const didEnoughArrive = await waitUntil(() => recording.samples.length >= GARBAGE_ROW_SAMPLE_COUNT,
                        GARBAGE_ROW_TIMEOUT_MS);
                    const sampled = recording.samples.slice(0, GARBAGE_ROW_SAMPLE_COUNT);
                    const state = await fetchState(clientConnection);
                    assertEqual({
                        didEnoughArrive,
                        unparsableSequences: sampled.filter(sample => parseSamplePayload(sample.text) === null)
                            .map(sample => sample.parsed.sequence),
                        gapsAfterSequences: sampled.slice(1).filter((sample, index) =>
                            sample.parsed.sequence !== sampled[index].parsed.sequence + 1)
                            .map(sample => sample.parsed.sequence),
                        isAlive: !program.hasExited,
                        doesAnswer: Number.isInteger(state.sequence),
                    }, {
                        didEnoughArrive: true, unparsableSequences: [], gapsAfterSequences: [], isAlive: true,
                        doesAnswer: true,
                    }, `garbage tree seed ${GARBAGE_TREE_SEED}, ${recording.samples.length} Samples`);
                } finally {
                    recording.stop();
                }
            }, garbageRootPath);
    } finally {
        removeTree(garbageRootPath);
    }
});

// The comparison the conformance row rests on, held to its rule on two hand-made transcripts with the same keys and
// one value apart. The conformance row itself passes whenever the two sides agree, so only this row fails when the
// comparison stops looking at values: a comparison of key sets alone would pass a double that gives a wrong number.
test('conformance: the comparison names a value that differs where every key matches', () => {
    const programEntries = [{sample: {sequence: 1, sampledAtUsec: 0}}];
    const doubleEntries = [{sample: {sequence: 2, sampledAtUsec: 0}}];
    assertEqual(describeParting(programEntries, doubleEntries),
        'the transcripts part at entry 0 (1 differing): entry 0.sample.sequence: program 1, double 2');
});

// The program and the test double (serviceDouble.js) are put the same scripted exchange: first the program, then the
// double serving a fake sampler that publishes the program's own Samples (conformanceDoubleSide.js).
// conformanceExchange.js's header says what the exchange is, what is compared and what a client can tell apart.
test('conformance: the double, fed the program\'s own snapshots, gives a client exactly what the program gave',
    async () => {
        const workDirectoryPath = GLib.dir_make_tmp('resource-pulse-conformance-XXXXXX');
        try {
            const programResult = await runExchangeAgainstProgram(workDirectoryPath);
            assertExchangeIsTheOneMeant(programResult.entries);
            const doubleResult = await runExchangeAgainstDouble(programResult);
            assertDoubleGaveWhatProgramGave(programResult, doubleResult);
        } finally {
            removeTree(workDirectoryPath);
        }
    });

// The last row reads runningPrograms through the named import above. A Set of that name declared anywhere else (in
// this file, or in another module this file took it from) would be empty from the start, and the last row would pass
// whatever the launcher left running: so the Set it reads must be the very one the launcher exports. This row holds the
// identity only; that the launcher adds each copy it starts to that Set is not held by any row.
test('program: the Set the last row reads is the one samplerProgramLauncher.js exports',
    () => {
        const setTheLastRowReads = runningPrograms === programLauncher.runningPrograms ? 'the launcher\'s' : 'another';
        assertEqual(setTheLastRowReads, 'the launcher\'s');
    });

test('program: every copy a row started has exited', () => {
    assertEqual([...runningPrograms].map(program => program.processId), []);
});
