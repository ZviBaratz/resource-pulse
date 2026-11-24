// The conformance exchange: the scripted conversation a client has with a Resource Pulse service, recorded as one
// client connection receives it, and the comparison of two such transcripts. The conformance row in
// sampler-program-dbus.test.js puts it first to the compiled program, then to the test double (serviceDouble.js)
// serving a fake sampler that publishes the program's own Samples, and the double must give the client exactly what the
// program gave. The program's side lives in that file (its launcher in samplerProgramLauncher.js), and the double's
// in conformanceDoubleSide.js; the roots the program reads live in conformanceRoots.js, and the exchange and the
// comparison here. It registers no rows: the comparison's own (describeParting's rule) is in
// sampler-program-dbus.test.js too.
//
// The exchange (runConformanceExchange): the service's first tick (the transcript starts before the service ticks, so
// that tick's Sample is its first entry), GetState, two ticks, WatchDetail with its reveal, GetState, UnwatchDetail,
// three ticks, WatchDetail with its reveal (a second reveal exists only if the first watch was really dropped), a
// method the interface lacks, Peer.Ping, Introspect; then the client disconnects holding its watch. That last step
// observes nothing (the transcripts end before it); the double's own rows (service-dbus.test.js) and the program's
// disconnect row hold what it does. The exchange waits for a Sample before each step that needs a tick, never for a
// duration.
//
// What is compared, entry by entry, with every number compared by Object.is (the program writes a negative zero as 0
// and a number that is not finite as null, payload.rs, so Object.is and === agree on every value a payload holds):
// each Sample and each GetState as lib/protocol.js parses them (what a client reads), the watch calls' replies, the
// unknown method's error name, Ping's answer and Introspect's parsed node. Nothing is left out, clocks included: the
// double is given the program's start time, and each Sample it sends carries the real time the program's did.
//
// What a client can tell apart, each asserted (assertKnownDifferences) so that the row fails if it stops being true:
//   - a call that names no interface is answered by the program and refused by GDBus (UnknownMethod);
//   - the program's introspection text is GDBus's less its `<!-- GDBus x.y.z -->` line and with each empty element
//     closed in its own tag; parsed, the two are the same node, and that is in the transcripts.
// Known, and not seen here: a caught panic's error message ends with its location (`... at src/x.rs:12:5`), which
// nothing on the bus can plant without a test switch; src/caught_panic.rs's rows hold it. And in the journal, never on
// the bus: the program has no "received SIGTERM" line, since a stop needs no handler.
import Gio from 'gi://Gio';
import {assertEqual} from './harness.js';
import {waitUntil} from './privateBus.js';
import {
    INTROSPECTABLE_INTERFACE_NAME, INTROSPECT_METHOD, MISSING_METHOD_NAME, PEER_INTERFACE_NAME, PING_METHOD,
    STRING_REPLY_TYPE, UNKNOWN_METHOD_ERROR_NAME, awaitBusRoundTrip, callGetStateWithoutInterface, callMethod,
    callResourcePulseMethod, describeCallOutcome, describeInterface, describeNode, subscribeToSamples,
} from './busCalls.js';
import {
    GET_STATE_METHOD_NAME, RESOURCE_PULSE_OBJECT_PATH, UNWATCH_DETAIL_METHOD_NAME, WATCH_DETAIL_METHOD_NAME,
    parseSamplePayload, parseStatePayload,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';

/**
 * The program's tick interval in the exchange. The program ticks by itself, so its exchange is the one meant only
 * while no tick sneaks in between the steps that follow one Sample and the next call: each step takes milliseconds,
 * and a tick is this far away, so a runner has to stall a whole tick to add one (and then the row fails on the
 * exchange's summary, naming it, which is a finding and not a pass). It is also longer than the program's 1 s CPU
 * ranking window, which a watch start waits out after any scan before it reveals, so a scan on an earlier tick never
 * holds a reveal back (EXPECTED_EXCHANGE_SUMMARY holds that both watches revealed).
 */
export const CONFORMANCE_TICK_INTERVAL_MS = 1500;
/** The bound on waiting for a tick's Sample or a reveal's: events, waited for, never assumed. */
const CONFORMANCE_SAMPLE_TIMEOUT_MS = 10_000;
/** Ticks the exchange waits for after the first state, and again after the watch ends. */
const TICKS_BEFORE_FIRST_WATCH = 2;
const TICKS_BEFORE_SECOND_WATCH = 3;
/** The names the .desktop fixtures give two of the moving roots' apps, which the program's Samples must rank. */
const FIXTURE_APP_NAMES = ['Example Editor', 'Example Browser'];
export const SAMPLE_KIND_TICK = 'tick';
export const SAMPLE_KIND_REVEAL = 'reveal';
/** The two kinds of entry in a transcript: a Sample the client received, and a reply it got to a call. */
export const ENTRY_KIND_SAMPLE = 'sample';
export const ENTRY_KIND_REPLY = 'reply';
/** The exchange, entry by entry, as summarizeExchange names them. */
const EXPECTED_EXCHANGE_SUMMARY = [
    'Sample tick', 'reply GetState', 'Sample tick', 'Sample tick', 'Sample reveal', 'reply WatchDetail: ()',
    'reply GetState', 'reply UnwatchDetail: ()', 'Sample tick', 'Sample tick', 'Sample tick', 'Sample reveal',
    'reply WatchDetail: ()', `reply ${MISSING_METHOD_NAME}: error reply: ${UNKNOWN_METHOD_ERROR_NAME}`,
    'reply Ping: answered', 'reply Introspect',
];
/** How many differing paths a failing comparison names. */
const REPORTED_DIFFERING_PATH_COUNT = 4;
/** How much of a Sample that does not parse a failure shows, in characters. */
const REPORTED_SAMPLE_TEXT_LENGTH = 80;
/** The version stamp GDBus writes into its introspection text, on a line of its own, which the program leaves out. */
const GDBUS_VERSION_LINE_PATTERN = /^<!-- GDBus [^\n]*-->\n/m;
/** An element with nothing in it, opened and closed on two lines: `<method name="X">`, a newline, `</method>`. */
const EMPTY_ELEMENT_WITH_CLOSING_TAG_PATTERN = /<(\w+)([^<>]*[^/<>])>\s*<\/\1>/g;
/** startTranscript's sender for a service whose unique name is not known yet: a Sample from any connection. */
export const ANY_SENDER = null;

/**
 * Says what a parsed Sample is: a reveal appends nothing to the histories, and a tick appends to both.
 *
 * @param {{appendedHistory: object|null}} sample - A parseSamplePayload result.
 * @returns {string} SAMPLE_KIND_REVEAL or SAMPLE_KIND_TICK.
 */
export function sampleKind(sample) {
    return sample.appendedHistory === null ? SAMPLE_KIND_REVEAL : SAMPLE_KIND_TICK;
}

/**
 * Starts recording what one client connection receives, in the order it receives it: every Sample from now on, and the
 * reply of every call the exchange makes. It resolves once the bus has the subscription, so a side starts its service
 * ticking only after, and the service's first Sample is in the transcript.
 *
 * @param {Gio.DBusConnection} connection - The client's.
 * @param {string|null} senderName - The unique name of the service, or ANY_SENDER.
 * @param {(tickSampleCount: number) => void} [onTickSample] - Called in a tick Sample's own callback, with the count of
 *     tick Samples so far (a reveal is not a tick).
 * @returns {Promise<{entries: object[], sampleTexts: string[], tickSampleCount: number, revealCount: number,
 *     callbackError: Error|null, stop: () => void}>} The transcript, filled as it comes: each Sample is parsed
 *     (parseSamplePayload) into entries, and its text kept in sampleTexts; callbackError is the first error
 *     onTickSample threw, or a Sample that did not parse; stop ends the recording and may be called more than once.
 * @throws {GLib.Error} When the bus does not answer the round trip that follows the subscription.
 */
export async function startTranscript(connection, senderName, onTickSample = () => {}) {
    const recording = {entries: [], sampleTexts: [], tickSampleCount: 0, revealCount: 0, callbackError: null};
    let stopSubscription = subscribeToSamples(connection, senderName, sampleText => {
        const sample = parseSamplePayload(sampleText);
        if (sample === null) {
            // Kept and thrown by the next wait, as an error of onTickSample's is (see below).
            const shownText = sampleText.slice(0, REPORTED_SAMPLE_TEXT_LENGTH);
            recording.callbackError ??= new Error(`a Sample that is not a JSON object arrived: ${shownText}`);
            return;
        }
        recording.sampleTexts.push(sampleText);
        recording.entries.push({kind: ENTRY_KIND_SAMPLE, sample});
        if (sampleKind(sample) === SAMPLE_KIND_REVEAL) {
            recording.revealCount++;
            return;
        }
        recording.tickSampleCount++;
        try {
            onTickSample(recording.tickSampleCount);
        } catch (error) {
            // A throw in a GLib callback is only printed, so it is kept and the row fails with it (see
            // awaitNextTickSample), never left to hang or to part the transcripts for an unstated reason.
            recording.callbackError ??= error;
        }
    });
    recording.stop = () => {
        stopSubscription?.();
        stopSubscription = null;
    };
    try {
        await awaitBusRoundTrip(connection);
    } catch (error) {
        recording.stop();
        throw error;
    }
    return recording;
}

/**
 * Describes a node as its interfaces, each with its methods, signals and properties.
 *
 * @param {Gio.DBusNodeInfo} nodeInfo - The node.
 * @returns {object} The description.
 */
function describeWholeNode(nodeInfo) {
    return {node: describeNode(nodeInfo), interfaces: nodeInfo.interfaces.map(describeInterface)};
}

/**
 * GDBus's introspection text as the program writes it: without the `<!-- GDBus x.y.z -->` version line, and with each
 * empty element closed in its own tag (`<method name="WatchDetail"/>` where GDBus writes a closing tag of its own on
 * the next line). Parsed, the two are the same node (the transcripts hold it).
 *
 * @param {string} gdbusXml - The text GDBus answered.
 * @returns {string} The text the program is expected to answer.
 */
function gdbusIntrospectionAsProgramWritesIt(gdbusXml) {
    return gdbusXml
        .replace(GDBUS_VERSION_LINE_PATTERN, '')
        .replace(EMPTY_ELEMENT_WITH_CLOSING_TAG_PATTERN, '<$1$2/>');
}

/**
 * What a service is asked on the side of the main exchange, whose answers differ or are compared apart: a call that
 * names no interface, and the introspection text.
 *
 * @param {Gio.DBusConnection} connection - The client's.
 * @param {string} destination - The service's name.
 * @returns {Promise<{noInterfaceOutcome: string, introspectionXml: string, introspected: object}>} What came back.
 */
async function askKnownDifferences(connection, destination) {
    const noInterfaceOutcome = await describeCallOutcome(
        callGetStateWithoutInterface(connection, () => {}, destination));
    const reply = await callMethod(connection, {
        destination,
        objectPath: RESOURCE_PULSE_OBJECT_PATH,
        interfaceName: INTROSPECTABLE_INTERFACE_NAME,
        methodName: INTROSPECT_METHOD,
        replyType: STRING_REPLY_TYPE,
    });
    const [introspectionXml] = reply.deepUnpack();
    const introspected = describeWholeNode(Gio.DBusNodeInfo.new_for_xml(introspectionXml));
    return {noInterfaceOutcome, introspectionXml, introspected};
}

/**
 * Describes a watch call's reply by its type: `()` for the empty reply both methods give.
 *
 * @param {GLib.Variant} reply - The reply.
 * @returns {string} Its type string.
 */
function describeWatchReply(reply) {
    return reply.get_type_string();
}

/**
 * Reads a GetState reply as a client does (parseStatePayload).
 *
 * @param {GLib.Variant} reply - A reply of type (s).
 * @returns {object|null} The parsed state.
 */
function readStateReply(reply) {
    const [stateText] = reply.deepUnpack();
    return parseStatePayload(stateText);
}

/**
 * Makes one call of the exchange and records its reply in the transcript, in the order the client received it.
 *
 * @param {Gio.DBusConnection} connection - The client's.
 * @param {string} destination - The service's name.
 * @param {{entries: object[]}} recording - From startTranscript.
 * @param {string} methodName - A method of the Resource Pulse interface.
 * @param {(reply: GLib.Variant) => *} describeReply - Turns the reply into the value recorded.
 * @returns {Promise<void>}
 */
async function callAndRecord(connection, destination, recording, methodName, describeReply) {
    await callResourcePulseMethod(connection, methodName, {
        destination,
        onReply: reply => recording.entries.push(
            {kind: ENTRY_KIND_REPLY, call: methodName, value: describeReply(reply)}),
    });
}

/**
 * Puts the scripted exchange (this file's header) to a service whose first tick has run, and records it as the side's
 * client connection receives it. The recording stops when the exchange ends, whatever happens, so a tick that comes
 * while the side stops its service is not in the transcript; the side closes the connection.
 *
 * @param {{label: string, destination: string, clientConnection: Gio.DBusConnection, recording: object,
 *     produceTick: () => Promise<void>}} side - How this side's service is reached and ticked: the label failures name
 *     it by, the name calls go to, the client and its transcript (startTranscript), and a tick that resolves once its
 *     Sample has arrived.
 * @returns {Promise<{entries: object[], sampleTexts: string[], noInterfaceOutcome: string, introspectionXml: string}>}
 *     The transcript, every Sample's text, and the answers apart.
 */
export async function runConformanceExchange(side) {
    const {clientConnection, destination, recording} = side;
    const inStep = (stepName, step) => inExchangeStep(side, stepName, step);
    try {
        await inStep(`${GET_STATE_METHOD_NAME}, the first`, () => callAndRecord(clientConnection, destination,
            recording, GET_STATE_METHOD_NAME, readStateReply));
        for (let tickIndex = 0; tickIndex < TICKS_BEFORE_FIRST_WATCH; tickIndex++)
            await inStep(`tick ${tickIndex + 1} before the first watch`, () => side.produceTick());
        await inStep(`${WATCH_DETAIL_METHOD_NAME}, the first, and its reveal`,
            () => watchAndAwaitRevealRecorded(clientConnection, destination, recording, 1));
        await inStep(`${GET_STATE_METHOD_NAME} while watching`, () => callAndRecord(clientConnection, destination,
            recording, GET_STATE_METHOD_NAME, readStateReply));
        await inStep(UNWATCH_DETAIL_METHOD_NAME, () => callAndRecord(clientConnection, destination, recording,
            UNWATCH_DETAIL_METHOD_NAME, describeWatchReply));
        for (let tickIndex = 0; tickIndex < TICKS_BEFORE_SECOND_WATCH; tickIndex++)
            await inStep(`tick ${tickIndex + 1} before the second watch`, () => side.produceTick());
        await inStep(`${WATCH_DETAIL_METHOD_NAME}, the second, and its reveal`,
            () => watchAndAwaitRevealRecorded(clientConnection, destination, recording, 2));
        await inStep('the calls that need nothing from the sampler',
            () => recordUnknownMethodAndPingOutcomes(clientConnection, destination, recording));
        const knownDifferences = await inStep('the calls whose answers differ',
            () => askKnownDifferences(clientConnection, destination));
        recording.entries.push({kind: ENTRY_KIND_REPLY, call: INTROSPECT_METHOD, value: knownDifferences.introspected});
        return {
            entries: recording.entries,
            sampleTexts: recording.sampleTexts,
            noInterfaceOutcome: knownDifferences.noInterfaceOutcome,
            introspectionXml: knownDifferences.introspectionXml,
        };
    } finally {
        recording.stop();
    }
}

/**
 * Runs one step of the conformance exchange, and names the side and the step in the error of one that fails, so a
 * failing exchange says which call of which service it was and not only what the call said.
 *
 * @param {{label: string}} side - The side the exchange runs against.
 * @param {string} stepName - What the step is, as the failure should name it.
 * @param {() => Promise<*>} step - The step.
 * @returns {Promise<*>} What the step returns.
 * @throws {Error} The step's error, its message led by the side and the step.
 */
async function inExchangeStep(side, stepName, step) {
    try {
        return await step();
    } catch (error) {
        throw new Error(`${side.label}, step "${stepName}": ${error.message}`, {cause: error});
    }
}

/**
 * Calls WatchDetail, records its reply, and waits for the reveal's Sample, which a service sends before the reply
 * (the transcript shows which came first).
 *
 * @param {Gio.DBusConnection} connection - The client's.
 * @param {string} destination - The service's name.
 * @param {{entries: object[], revealCount: number, callbackError: Error|null}} recording - The transcript.
 * @param {number} expectedRevealCount - How many reveals have arrived once this one has.
 * @returns {Promise<void>}
 * @throws {Error} When the reveal has not arrived within CONFORMANCE_SAMPLE_TIMEOUT_MS of the reply, or a Sample
 *     before it did not parse.
 */
async function watchAndAwaitRevealRecorded(connection, destination, recording, expectedRevealCount) {
    await callAndRecord(connection, destination, recording, WATCH_DETAIL_METHOD_NAME, describeWatchReply);
    const hasArrivedOrFailed = () => recording.revealCount >= expectedRevealCount || recording.callbackError !== null;
    const didArrive = await waitUntil(hasArrivedOrFailed, CONFORMANCE_SAMPLE_TIMEOUT_MS);
    if (recording.callbackError !== null)
        throw recording.callbackError;
    if (!didArrive) {
        throw new Error(`reveal number ${expectedRevealCount} did not arrive within ` +
            `${CONFORMANCE_SAMPLE_TIMEOUT_MS} ms of ${WATCH_DETAIL_METHOD_NAME}`);
    }
}

/**
 * Makes the calls that need nothing from the sampler, and records how each ended: a method the interface lacks, and
 * Peer.Ping.
 *
 * @param {Gio.DBusConnection} connection - The client's.
 * @param {string} destination - The service's name.
 * @param {{entries: object[]}} recording - The transcript.
 * @returns {Promise<void>}
 */
async function recordUnknownMethodAndPingOutcomes(connection, destination, recording) {
    const missingMethodOutcome = await describeCallOutcome(
        callResourcePulseMethod(connection, MISSING_METHOD_NAME, {destination}));
    recording.entries.push({kind: ENTRY_KIND_REPLY, call: MISSING_METHOD_NAME, value: missingMethodOutcome});
    const pingOutcome = await describeCallOutcome(callMethod(connection, {
        destination,
        objectPath: RESOURCE_PULSE_OBJECT_PATH,
        interfaceName: PEER_INTERFACE_NAME,
        methodName: PING_METHOD,
    }));
    recording.entries.push({kind: ENTRY_KIND_REPLY, call: PING_METHOD, value: pingOutcome});
}

/**
 * Waits for the next tick Sample: one more than the transcript holds when called. A Sample reaches the client only
 * when the main loop runs, which is inside this wait, so a side may publish its tick just before calling it.
 *
 * @param {{tickSampleCount: number, callbackError: Error|null}} recording - The transcript.
 * @returns {Promise<void>}
 * @throws {Error} When none arrives in time, or startTranscript's callback failed on an earlier one (a Sample that
 *     did not parse, or a throw of onTickSample's).
 */
export async function awaitNextTickSample(recording) {
    const wantedCount = recording.tickSampleCount + 1;
    const hasArrivedOrFailed = () => recording.tickSampleCount >= wantedCount || recording.callbackError !== null;
    const didArrive = await waitUntil(hasArrivedOrFailed, CONFORMANCE_SAMPLE_TIMEOUT_MS);
    if (recording.callbackError !== null)
        throw recording.callbackError;
    if (!didArrive)
        throw new Error(`no tick Sample number ${wantedCount} within ${CONFORMANCE_SAMPLE_TIMEOUT_MS} ms`);
}

/**
 * Names each entry of a transcript by what it is, to check the exchange is the one meant (two transcripts that parted
 * nowhere because both sides did nothing would be equal too).
 *
 * @param {object[]} entries - A transcript.
 * @returns {string[]} One label per entry.
 */
function summarizeExchange(entries) {
    return entries.map(entry => {
        if (entry.kind === ENTRY_KIND_SAMPLE)
            return `Sample ${sampleKind(entry.sample)}`;
        const outcome = typeof entry.value === 'string' ? `: ${entry.value}` : '';
        return `reply ${entry.call}${outcome}`;
    });
}

/**
 * The names of every app any Sample of a transcript ranks.
 *
 * @param {object[]} entries - A transcript.
 * @returns {string[]} The names, sorted, once each.
 */
function rankedAppNames(entries) {
    const names = new Set();
    for (const entry of entries) {
        const apps = entry.kind === ENTRY_KIND_SAMPLE ? entry.sample.snapshot?.apps : null;
        for (const app of [...(apps?.memoryRanking ?? []), ...(apps?.cpuRanking ?? [])])
            names.add(app.name);
    }
    return [...names].sort();
}

/**
 * Asserts that the program's transcript is the exchange meant, entry by entry, and that its Samples rank the apps under
 * the names the .desktop fixtures give them: so the double is held to Samples with rankings and names in them, and a
 * transcript cannot be matched by a double that is put an exchange the program never had.
 *
 * @param {object[]} programEntries - The program's transcript.
 * @returns {void}
 */
export function assertExchangeIsTheOneMeant(programEntries) {
    assertEqual(summarizeExchange(programEntries), EXPECTED_EXCHANGE_SUMMARY,
        'the program\'s exchange is not the one meant');
    const programRankedNames = rankedAppNames(programEntries);
    assertEqual(FIXTURE_APP_NAMES.filter(name => !programRankedNames.includes(name)), [],
        'the names the .desktop fixtures give, missing from the program\'s rankings');
}

/**
 * Writes a leaf value for a failure message: as JSON, except that -0 stays -0 (JSON writes it as 0).
 *
 * @param {*} value - A leaf of a parsed value.
 * @returns {string} The text.
 */
function describeLeafValue(value) {
    return Object.is(value, -0) ? '-0' : JSON.stringify(value);
}

/**
 * Lists the paths at which two parsed values differ, with both values there. Leaves are compared with Object.is, so
 * numbers are told apart as Object.is tells them (the program writes a negative zero as 0 and a number that is not
 * finite as null, payload.rs, as JSON.stringify does for the double, so no payload either side sends can hold -0 or
 * NaN, and Object.is and === agree on every value met here); objects key by key, whatever their order; arrays index
 * by index.
 *
 * @param {*} programValue - The program's value.
 * @param {*} doubleValue - The double's value.
 * @param {string} path - Where the two values are, for the message.
 * @returns {string[]} One `path: program X, double Y` per leaf that differs, in order.
 */
function listDifferingPaths(programValue, doubleValue, path) {
    const isObject = value => value !== null && typeof value === 'object';
    const areBothContainersOfOneKind = isObject(programValue) && isObject(doubleValue) &&
        Array.isArray(programValue) === Array.isArray(doubleValue);
    if (!areBothContainersOfOneKind) {
        if (Object.is(programValue, doubleValue))
            return [];
        return [`${path}: program ${describeLeafValue(programValue)}, double ${describeLeafValue(doubleValue)}`];
    }
    const keys = [...new Set([...Object.keys(programValue), ...Object.keys(doubleValue)])];
    return keys.flatMap(key => listDifferingPaths(programValue[key], doubleValue[key], `${path}.${key}`));
}

/**
 * Finds where two transcripts part. Exported for the row that holds the comparison itself to its rule.
 *
 * @param {object[]} programEntries - The program's.
 * @param {object[]} doubleEntries - The double's.
 * @returns {string|null} A sentence naming the first entry that differs and the paths in it that do (at most
 *     REPORTED_DIFFERING_PATH_COUNT), or null when they are equal.
 */
export function describeParting(programEntries, doubleEntries) {
    const entryCount = Math.max(programEntries.length, doubleEntries.length);
    for (let index = 0; index < entryCount; index++) {
        const differingPaths = listDifferingPaths(programEntries[index], doubleEntries[index], `entry ${index}`);
        if (differingPaths.length > 0) {
            const shownPaths = differingPaths.slice(0, REPORTED_DIFFERING_PATH_COUNT).join('; ');
            return `the transcripts part at entry ${index} (${differingPaths.length} differing): ${shownPaths}`;
        }
    }
    return null;
}

/**
 * Asserts each difference a client can see between the program and the double, so that the row fails when one stops
 * being true: a call that names no interface is answered by the program and refused by GDBus, and the program's
 * introspection text is GDBus's less its version line and with every empty element closed in its own tag (the parsed
 * nodes are in the transcripts, and equal).
 *
 * @param {{noInterfaceOutcome: string, introspectionXml: string}} programResult - The program's.
 * @param {{noInterfaceOutcome: string, introspectionXml: string}} doubleResult - The double's.
 * @returns {void}
 */
function assertKnownDifferences(programResult, doubleResult) {
    assertEqual({
        programNoInterfaceOutcome: programResult.noInterfaceOutcome,
        doubleNoInterfaceOutcome: doubleResult.noInterfaceOutcome,
        doubleTextHasVersionLine: GDBUS_VERSION_LINE_PATTERN.test(doubleResult.introspectionXml),
        programTextIsGdbusTextAsItWritesIt:
            programResult.introspectionXml === gdbusIntrospectionAsProgramWritesIt(doubleResult.introspectionXml),
        areTextsDifferent: programResult.introspectionXml !== doubleResult.introspectionXml,
    }, {
        programNoInterfaceOutcome: 'answered',
        doubleNoInterfaceOutcome: `error reply: ${UNKNOWN_METHOD_ERROR_NAME}`,
        doubleTextHasVersionLine: true,
        programTextIsGdbusTextAsItWritesIt: true,
        areTextsDifferent: true,
    });
}

/**
 * Asserts that the double gave the client exactly what the program gave: the two transcripts equal entry by entry
 * (this file's header says what an entry holds), nothing in the double's log, and the known differences still the
 * only ones.
 *
 * @param {{entries: object[], noInterfaceOutcome: string, introspectionXml: string}} programResult - The program's.
 * @param {{entries: object[], noInterfaceOutcome: string, introspectionXml: string, logLines: string[]}} doubleResult
 *     - The double's.
 * @returns {void}
 */
export function assertDoubleGaveWhatProgramGave(programResult, doubleResult) {
    assertEqual({
        parting: describeParting(programResult.entries, doubleResult.entries),
        doubleLogLines: doubleResult.logLines,
    }, {parting: null, doubleLogLines: []});
    assertKnownDifferences(programResult, doubleResult);
}
