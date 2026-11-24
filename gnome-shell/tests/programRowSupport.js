// What sampler-program-dbus.test.js's rows share, beside the program's launcher (samplerProgramLauncher.js): the row
// wrapper that gives every row its deadline (test), a delay that runs the main loop, the calls the rows make
// (fetchState, fetchNameOwner, fetchStateText, introspectPath), the Samples they record (recordSamples, recordReveals,
// watchAndAwaitReveal), and the order row's check of replies against Samples (checkReplyOrder).
//
// The rows register through this module's test, never harness.js's own: it is what fails a row that hangs, naming
// it, after ROW_TIMEOUT_MS. This module registers no rows itself.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test as registerRow} from './harness.js';
import {waitUntil} from './privateBus.js';
import {
    BUS_DAEMON_INTERFACE_NAME, BUS_DAEMON_NAME, BUS_DAEMON_OBJECT_PATH, INTROSPECTABLE_INTERFACE_NAME,
    INTROSPECT_METHOD, STRING_REPLY_TYPE, callMethod, callResourcePulseMethod, parseStringReply, subscribeToSamples,
} from './busCalls.js';
import {
    GET_STATE_METHOD_NAME, RESOURCE_PULSE_BUS_NAME, WATCH_DETAIL_METHOD_NAME,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';

/** GLib's monotonic clock counts microseconds; the rows' durations are in milliseconds. */
export const MICROSECONDS_PER_MILLISECOND = 1000;
/** How many violations a failing order row names. */
const REPORTED_VIOLATION_COUNT = 5;
/**
 * The most a row may take, the longest being the 50 starts (about 15 s) and the conformance row (about 8 s): a row
 * past it fails naming itself, so a hang costs this and not the table's whole time-out.
 */
const ROW_TIMEOUT_MS = 90_000;
const GET_NAME_OWNER_METHOD = 'GetNameOwner';
/** How soon a reveal must arrive after the WatchDetail call that asked for it. */
export const REVEAL_TIMEOUT_MS = 1000;
const NAME_OWNER_REPLY_TYPE = new GLib.VariantType('(s)');
/** The two kinds of arrival the order row records, in the order they came (checkReplyOrder). */
export const SAMPLE_ARRIVAL = 'Sample';
export const REPLY_ARRIVAL = 'reply';

/**
 * Calls GetState and parses its JSON.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @returns {Promise<{sequence: number}>} The state (lib/protocol.js's buildStatePayload).
 */
export async function fetchState(connection) {
    return parseStringReply(await callResourcePulseMethod(connection, GET_STATE_METHOD_NAME,
        {replyType: STRING_REPLY_TYPE}));
}

/**
 * Asks the bus who owns the program's name.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @returns {Promise<string>} The owner's unique name.
 */
export async function fetchNameOwner(connection) {
    const reply = await callMethod(connection, {
        destination: BUS_DAEMON_NAME,
        objectPath: BUS_DAEMON_OBJECT_PATH,
        interfaceName: BUS_DAEMON_INTERFACE_NAME,
        methodName: GET_NAME_OWNER_METHOD,
        parameters: new GLib.Variant('(s)', [RESOURCE_PULSE_BUS_NAME]),
        replyType: NAME_OWNER_REPLY_TYPE,
    });
    const [ownerName] = reply.deepUnpack();
    return ownerName;
}

/**
 * Registers a row that prints its title to stderr (unbuffered) when it starts, so a run that is killed shows which row
 * was in flight, and that fails, naming itself, after ROW_TIMEOUT_MS.
 *
 * @param {string} name - The row's title.
 * @param {() => (void|Promise<void>)} body - The row.
 * @returns {void}
 */
export function test(name, body) {
    registerRow(name, async () => {
        printerr(`#   row starting: ${name}`);
        let timerId = null;
        const deadline = new Promise((_resolve, reject) => {
            timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ROW_TIMEOUT_MS, () => {
                timerId = null;
                reject(new Error(`the row did not finish within ${ROW_TIMEOUT_MS} ms`));
                return GLib.SOURCE_REMOVE;
            });
        });
        try {
            await Promise.race([Promise.resolve().then(body), deadline]);
        } finally {
            if (timerId !== null)
                GLib.source_remove(timerId);
        }
    });
}

/**
 * Resolves after a delay, running the main loop meanwhile.
 *
 * @param {number} delayMs - How long to wait.
 * @returns {Promise<void>}
 */
export function delay(delayMs) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/**
 * Checks the order of Samples and state replies as one connection received them: a reply carrying sequence N must
 * come after Sample N (no Sample above N before it) and before Sample N+1 (the first Sample after it is N+1).
 *
 * @param {Array<{kind: string, sequence: number}>} arrivals - Samples and replies, in arrival order.
 * @returns {{replyCount: number, sampleCount: number, violationCount: number, violations: string[]}} The counts,
 *     and the first REPORTED_VIOLATION_COUNT violations.
 */
export function checkReplyOrder(arrivals) {
    // Walk backwards once to know, for each arrival, the sequence of the first Sample after it.
    const nextSampleSequenceAfter = new Array(arrivals.length).fill(null);
    let nextSampleSequence = null;
    for (let index = arrivals.length - 1; index >= 0; index--) {
        nextSampleSequenceAfter[index] = nextSampleSequence;
        if (arrivals[index].kind === SAMPLE_ARRIVAL)
            nextSampleSequence = arrivals[index].sequence;
    }
    const violations = [];
    let highestSampleSequence = null;
    let replyCount = 0;
    let sampleCount = 0;
    arrivals.forEach(({kind, sequence}, index) => {
        if (kind === SAMPLE_ARRIVAL) {
            sampleCount++;
            highestSampleSequence = Math.max(highestSampleSequence ?? sequence, sequence);
            return;
        }
        replyCount++;
        if (highestSampleSequence !== null && highestSampleSequence > sequence)
            violations.push(`reply ${sequence} arrived after Sample ${highestSampleSequence}`);
        const followingSample = nextSampleSequenceAfter[index];
        if (followingSample !== null && followingSample !== sequence + 1)
            violations.push(`reply ${sequence} was followed by Sample ${followingSample}`);
    });
    return {
        replyCount,
        sampleCount,
        violationCount: violations.length,
        violations: violations.slice(0, REPORTED_VIOLATION_COUNT),
    };
}

/**
 * Calls Introspect on a path of the program's and parses the answer.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @param {string} objectPath - The path.
 * @returns {Promise<Gio.DBusNodeInfo>} The node the program describes there.
 */
export async function introspectPath(connection, objectPath) {
    const reply = await callMethod(connection, {
        destination: RESOURCE_PULSE_BUS_NAME,
        objectPath,
        interfaceName: INTROSPECTABLE_INTERFACE_NAME,
        methodName: INTROSPECT_METHOD,
        replyType: STRING_REPLY_TYPE,
    });
    const [introspectionXml] = reply.deepUnpack();
    return Gio.DBusNodeInfo.new_for_xml(introspectionXml);
}

/**
 * Subscribes to the program's Sample signal and keeps each reveal (a Sample with appendedHistory null) with the
 * monotonic time it arrived.
 *
 * @param {Gio.DBusConnection} connection - The listener.
 * @param {string} ownerName - The program's unique name.
 * @returns {{revealArrivalsUsec: number[], stop: () => void}} The arrivals, filled as they come.
 */
export function recordReveals(connection, ownerName) {
    const revealArrivalsUsec = [];
    const stop = subscribeToSamples(connection, ownerName, sampleText => {
        if (JSON.parse(sampleText).appendedHistory === null)
            revealArrivalsUsec.push(GLib.get_monotonic_time());
    });
    return {revealArrivalsUsec, stop};
}

/**
 * Calls WatchDetail and waits for a reveal that arrives after the call was made.
 *
 * @param {Gio.DBusConnection} callerConnection - The caller.
 * @param {{revealArrivalsUsec: number[]}} reveals - From recordReveals.
 * @returns {Promise<boolean>} True when such a reveal arrived within REVEAL_TIMEOUT_MS of the call.
 */
export async function watchAndAwaitReveal(callerConnection, reveals) {
    const calledAtUsec = GLib.get_monotonic_time();
    await callResourcePulseMethod(callerConnection, WATCH_DETAIL_METHOD_NAME);
    return waitUntil(() => reveals.revealArrivalsUsec.some(arrivalUsec => arrivalUsec >= calledAtUsec &&
        arrivalUsec - calledAtUsec <= REVEAL_TIMEOUT_MS * MICROSECONDS_PER_MILLISECOND), REVEAL_TIMEOUT_MS);
}

/**
 * Subscribes to the program's Sample signal and keeps every Sample, parsed, with the monotonic time it arrived.
 *
 * @param {Gio.DBusConnection} connection - The listener.
 * @param {string} ownerName - The program's unique name.
 * @returns {{samples: Array<{text: string, parsed: object, arrivalUsec: number}>, stop: () => void}} The Samples, filled
 *     as they come, in arrival order.
 */
export function recordSamples(connection, ownerName) {
    const samples = [];
    const stop = subscribeToSamples(connection, ownerName, sampleText => {
        samples.push({text: sampleText, parsed: JSON.parse(sampleText), arrivalUsec: GLib.get_monotonic_time()});
    });
    return {samples, stop};
}

/**
 * Calls GetState and keeps the reply's text, and how many Samples had arrived when the reply did.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @param {{samples: object[]}} recording - From recordSamples, on the same connection.
 * @returns {Promise<{text: string, state: object, sampleCountAtReply: number}>} The state's text and parsed form.
 */
export async function fetchStateText(connection, recording) {
    let sampleCountAtReply = null;
    const reply = await callResourcePulseMethod(connection, GET_STATE_METHOD_NAME, {
        replyType: STRING_REPLY_TYPE,
        onReply: () => {
            sampleCountAtReply = recording.samples.length;
        },
    });
    const [text] = reply.deepUnpack();
    return {text, state: JSON.parse(text), sampleCountAtReply};
}
