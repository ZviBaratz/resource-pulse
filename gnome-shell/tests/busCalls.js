// A client's side of a D-Bus exchange with a Resource Pulse service on a private bus, as promises: a method call, a
// GetState that names no interface, how a call ended, a Sample subscription, a round trip to the bus, a bounded close,
// and introspected nodes described as names and signatures. Shared by the compiled program's bus rows
// (sampler-program-dbus.test.js) and the conformance exchange (conformanceExchange.js). It registers no rows, and every
// connection it is given was opened by privateBus.js's openPrivateBusConnection.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {waitUntil} from './privateBus.js';
import {
    GET_STATE_METHOD_NAME, RESOURCE_PULSE_BUS_NAME, RESOURCE_PULSE_INTERFACE_NAME, RESOURCE_PULSE_OBJECT_PATH,
    SAMPLE_SIGNAL_NAME,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';

export const CALL_TIMEOUT_MS = 2000;
/** How long closing a connection may take: the close flushes to a peer, so it must not be able to block for ever. */
const CLOSE_TIMEOUT_MS = 2000;
/** The type of a reply that carries one string: GetState's, and Introspect's. */
export const STRING_REPLY_TYPE = new GLib.VariantType('(s)');
export const BUS_DAEMON_NAME = 'org.freedesktop.DBus';
export const BUS_DAEMON_OBJECT_PATH = '/org/freedesktop/DBus';
export const BUS_DAEMON_INTERFACE_NAME = 'org.freedesktop.DBus';
/** The bus daemon's method that answers its own id: a call made only for its round trip. */
const GET_BUS_ID_METHOD = 'GetId';
export const INTROSPECTABLE_INTERFACE_NAME = 'org.freedesktop.DBus.Introspectable';
export const INTROSPECT_METHOD = 'Introspect';
export const PEER_INTERFACE_NAME = 'org.freedesktop.DBus.Peer';
export const PING_METHOD = 'Ping';
export const UNKNOWN_METHOD_ERROR_NAME = 'org.freedesktop.DBus.Error.UnknownMethod';
/** A method the Resource Pulse interface does not have. */
export const MISSING_METHOD_NAME = 'NoSuchMethod';

/**
 * Calls a method and resolves with its reply.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @param {{destination: string, objectPath: string, interfaceName: string, methodName: string,
 *     parameters?: GLib.Variant|null, replyType?: GLib.VariantType|null, onReply?: (reply: GLib.Variant) => void}} call
 *     - The call; onReply runs inside the reply's own callback, so the arrival it records is in arrival order.
 * @returns {Promise<GLib.Variant>} The reply.
 */
export function callMethod(connection, {destination, objectPath, interfaceName, methodName, parameters = null,
    replyType = null, onReply = () => {}}) {
    return new Promise((resolve, reject) => {
        connection.call(destination, objectPath, interfaceName, methodName, parameters, replyType,
            Gio.DBusCallFlags.NONE, CALL_TIMEOUT_MS, null, (callingConnection, result) => {
                let reply;
                try {
                    reply = callingConnection.call_finish(result);
                } catch (error) {
                    reject(error);
                    return;
                }
                onReply(reply);
                resolve(reply);
            });
    });
}

/**
 * Calls a service's GetState with no interface in the message. `Gio.DBusConnection.call` refuses a null
 * interface name in gjs, so the message is built and sent by hand.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @param {(reply: GLib.Variant) => void} onReply - Runs with the reply's body.
 * @param {string} [destination] - The service's name; the Resource Pulse bus name unless given.
 * @returns {Promise<GLib.Variant>} The reply's body.
 */
export function callGetStateWithoutInterface(connection, onReply, destination = RESOURCE_PULSE_BUS_NAME) {
    const message = Gio.DBusMessage.new_method_call(
        destination, RESOURCE_PULSE_OBJECT_PATH, null, GET_STATE_METHOD_NAME);
    return new Promise((resolve, reject) => {
        connection.send_message_with_reply(message, Gio.DBusSendMessageFlags.NONE, CALL_TIMEOUT_MS, null,
            (sendingConnection, result) => {
                let replyMessage;
                try {
                    replyMessage = sendingConnection.send_message_with_reply_finish(result);
                } catch (error) {
                    reject(error);
                    return;
                }
                try {
                    // gjs throws the GError when the reply is an error reply.
                    replyMessage.to_gerror();
                } catch (error) {
                    reject(error);
                    return;
                }
                const body = replyMessage.get_body();
                onReply(body);
                resolve(body);
            });
    });
}

/**
 * Says how a call ended, telling an error reply from a time-out.
 *
 * @param {Promise<GLib.Variant>} pendingCall - A call made through callMethod.
 * @returns {Promise<string>} 'answered', 'error reply: <name>' for a reply from the service, or
 *     'no answer: <message>' for a call that ended locally, as a time-out after CALL_TIMEOUT_MS does.
 */
export async function describeCallOutcome(pendingCall) {
    try {
        await pendingCall;
        return 'answered';
    } catch (error) {
        // A JS error (a call that could not even be made) is not a GLib.Error and has no remote name.
        const remoteErrorName = error instanceof GLib.Error ? Gio.DBusError.get_remote_error(error) : null;
        return remoteErrorName === null ? `no answer: ${error.message}` : `error reply: ${remoteErrorName}`;
    }
}

/**
 * Calls a method of the Resource Pulse interface, at its bus name unless another destination is given.
 *
 * @param {Gio.DBusConnection} connection - The caller.
 * @param {string} methodName - The method.
 * @param {object} [options] - replyType, onReply and destination (the Resource Pulse bus name unless given), as
 *     callMethod takes them.
 * @returns {Promise<GLib.Variant>} The reply.
 */
export function callResourcePulseMethod(connection, methodName, options = {}) {
    return callMethod(connection, {
        destination: RESOURCE_PULSE_BUS_NAME,
        objectPath: RESOURCE_PULSE_OBJECT_PATH,
        interfaceName: RESOURCE_PULSE_INTERFACE_NAME,
        methodName,
        ...options,
    });
}

/**
 * Reads the JSON text of a one-string reply.
 *
 * @param {GLib.Variant} reply - A reply of type (s).
 * @returns {object} The parsed JSON.
 */
export function parseStringReply(reply) {
    const [text] = reply.deepUnpack();
    return JSON.parse(text);
}

/**
 * Closes a connection without blocking the main loop, and fails if the close does not finish in time (a synchronous
 * close flushes to its peer and has no bound).
 *
 * @param {Gio.DBusConnection} connection - The connection; one already closed is left alone.
 * @returns {Promise<void>}
 * @throws {Error} When the close fails or takes longer than CLOSE_TIMEOUT_MS.
 */
export async function closeConnection(connection) {
    if (connection.is_closed())
        return;
    const closing = {isDone: false, error: null};
    connection.close(null, (closingConnection, result) => {
        try {
            closingConnection.close_finish(result);
        } catch (error) {
            closing.error = error;
        }
        closing.isDone = true;
    });
    if (!await waitUntil(() => closing.isDone, CLOSE_TIMEOUT_MS))
        throw new Error(`a connection did not close within ${CLOSE_TIMEOUT_MS} ms`);
    if (closing.error !== null)
        throw closing.error;
}

/**
 * Subscribes to a service's Sample signal and hands the text of each Sample to a callback, in arrival order.
 *
 * @param {Gio.DBusConnection} connection - The listener.
 * @param {string|null} senderName - The unique name of the service, or null for a Sample from any sender.
 * @param {(sampleText: string) => void} onSampleText - Called in the signal's own callback.
 * @returns {() => void} Stops the subscription.
 */
export function subscribeToSamples(connection, senderName, onSampleText) {
    const subscriptionId = connection.signal_subscribe(senderName, RESOURCE_PULSE_INTERFACE_NAME, SAMPLE_SIGNAL_NAME,
        RESOURCE_PULSE_OBJECT_PATH, null, Gio.DBusSignalFlags.NONE, (...signalArguments) => {
            const [sampleText] = signalArguments.at(-1).deepUnpack();
            onSampleText(sampleText);
        });
    return () => connection.signal_unsubscribe(subscriptionId);
}

/**
 * Waits for one round trip to the bus daemon. The daemon handles one connection's messages in order, so once this
 * resolves, every match rule the connection asked for before (a signal_subscribe) is in place on the bus.
 *
 * @param {Gio.DBusConnection} connection - The connection.
 * @returns {Promise<void>}
 * @throws {GLib.Error} When the daemon does not answer within CALL_TIMEOUT_MS.
 */
export async function awaitBusRoundTrip(connection) {
    await callMethod(connection, {
        destination: BUS_DAEMON_NAME,
        objectPath: BUS_DAEMON_OBJECT_PATH,
        interfaceName: BUS_DAEMON_INTERFACE_NAME,
        methodName: GET_BUS_ID_METHOD,
        replyType: STRING_REPLY_TYPE,
    });
}

/**
 * Describes an interface as names and signatures, to compare two introspections of it.
 *
 * @param {Gio.DBusInterfaceInfo|null} interfaceInfo - The interface, or null when the node lacks it.
 * @returns {object|null} Its methods, signals and properties, or null.
 */
export function describeInterface(interfaceInfo) {
    if (interfaceInfo === null)
        return null;
    return {
        methods: interfaceInfo.methods.map(methodInfo => ({
            name: methodInfo.name,
            inArguments: methodInfo.in_args.map(argumentInfo => argumentInfo.signature),
            outArguments: methodInfo.out_args.map(argumentInfo => argumentInfo.signature),
        })),
        signals: interfaceInfo.signals.map(signalInfo => ({
            name: signalInfo.name,
            arguments: signalInfo.args.map(argumentInfo => argumentInfo.signature),
        })),
        properties: interfaceInfo.properties.map(propertyInfo => propertyInfo.name),
    };
}

/**
 * Describes a node as its interfaces' names and its children's, to compare with what GDBus answers.
 *
 * @param {Gio.DBusNodeInfo} nodeInfo - The node.
 * @returns {{interfaceNames: string[], childNames: string[]}} The names, in the order the node lists them.
 */
export function describeNode(nodeInfo) {
    return {
        interfaceNames: nodeInfo.interfaces.map(interfaceInfo => interfaceInfo.name),
        childNames: nodeInfo.nodes.map(childInfo => childInfo.path),
    };
}
