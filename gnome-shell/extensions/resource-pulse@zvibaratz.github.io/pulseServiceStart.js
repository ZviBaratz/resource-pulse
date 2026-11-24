// The StartUnit chain of the extension's client (pulseClient.js): it asks systemd's user manager, on the session bus,
// to start resource-pulse.service, and asks again until the service appears on the bus. A failure, or an accepted
// StartUnit after which the service does not appear within START_CONFIRMATION_TIMEOUT_SECONDS (systemd accepts the job
// before it checks the start limit), is retried after lib/wiring.js's nextStartRetryDelaySeconds. The service appearing
// ends the chain, and supersedes a StartUnit still on its way. pulseClient.js's header gives the whole lifecycle.
// Gio and GLib only (no Shell, St, Clutter or Meta), so it runs under plain gjs. The client injects StartUnit, the
// timeouts and what the chain reads of its state. It runs inside gnome-shell, as the client does: StartUnit is
// asynchronous, each step of the chain is a one-shot timeout whose callback never throws, and once the client is
// destroyed an answer changes nothing.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {DBUS_CALL_TIMEOUT_MS, START_CONFIRMATION_TIMEOUT_SECONDS} from './lib/constants.js';
import {describeError} from './lib/errorLog.js';
import {nextStartRetryDelaySeconds} from './lib/wiring.js';

// systemd's user manager on the session bus, and what the client asks of it.
const SYSTEMD_BUS_NAME = 'org.freedesktop.systemd1';
const SYSTEMD_OBJECT_PATH = '/org/freedesktop/systemd1';
const SYSTEMD_MANAGER_INTERFACE_NAME = 'org.freedesktop.systemd1.Manager';
const START_UNIT_METHOD_NAME = 'StartUnit';
/** The service's unit: systemd/resource-pulse.service, linked into the user's unit directory. */
const RESOURCE_PULSE_UNIT_NAME = 'resource-pulse.service';
/** StartUnit's job mode: replace a conflicting queued job. Starting a unit that already runs changes nothing. */
const START_UNIT_MODE = 'replace';
/** StartUnit(s name, s mode). */
const START_UNIT_PARAMETERS_SIGNATURE = '(ss)';
/** StartUnit → (o job). */
const START_UNIT_REPLY_SIGNATURE = '(o)';
/** StartUnit does not ask the bus to activate systemd's name: with nobody owning it, the call fails at once. */
const START_UNIT_CALL_FLAGS = Gio.DBusCallFlags.NO_AUTO_START;

// Template keys of the rate-limited journal lines whose text varies (lib/errorLog.js).
const START_UNIT_FAILURE_LOG_KEY = 'StartUnit failed';
const START_UNCONFIRMED_LOG_KEY = 'StartUnit unconfirmed';

/**
 * Adds one of GLib's whole-second timeouts at the default priority: the chain's steps, by default (a whole-second
 * timeout may fire up to a second late, as GLib groups them on the second).
 *
 * @param {number} intervalSeconds - Seconds until it fires.
 * @param {() => boolean} callback - Runs when it fires; GLib.SOURCE_REMOVE ends it.
 * @returns {number} The GLib source id, for GLib.source_remove.
 */
export function addGlibTimeoutSeconds(intervalSeconds, callback) {
    return GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSeconds, callback);
}

/**
 * Asks systemd's user manager, on the session bus, to start the service: StartUnit('resource-pulse.service',
 * 'replace') on /org/freedesktop/systemd1, asynchronously.
 *
 * @param {Gio.DBusConnection} connection - The session bus, where the user manager lives.
 * @param {Gio.Cancellable} cancellable - Cancels the call.
 * @param {(error: Error|null) => void} onAnswered - Called once: null when systemd took the start job, or the failure.
 * @returns {void}
 */
export function startResourcePulseUnit(connection, cancellable, onAnswered) {
    const startUnitParameters = new GLib.Variant(START_UNIT_PARAMETERS_SIGNATURE,
        [RESOURCE_PULSE_UNIT_NAME, START_UNIT_MODE]);
    const startUnitReplyType = new GLib.VariantType(START_UNIT_REPLY_SIGNATURE);
    connection.call(SYSTEMD_BUS_NAME, SYSTEMD_OBJECT_PATH, SYSTEMD_MANAGER_INTERFACE_NAME, START_UNIT_METHOD_NAME,
        startUnitParameters, startUnitReplyType, START_UNIT_CALL_FLAGS, DBUS_CALL_TIMEOUT_MS, cancellable,
        (callingConnection, result) => {
            try {
                callingConnection.call_finish(result);
            } catch (error) {
                onAnswered(error);
                return;
            }
            onAnswered(null);
        });
}

/**
 * One client's StartUnit chain: the StartUnit attempts, and the one pending step between them (a retry after a
 * failure, or the wait for the service to appear after an accepted StartUnit). The client restarts it on every
 * start(), sends a StartUnit that waited once its connection is up, ends it when the service appears, and removes its
 * pending step at destroy().
 */
export class ServiceStartChain {
    /**
     * @param {object} options - What the chain takes from its client; each is the client's own.
     * @param {(connection: Gio.DBusConnection, cancellable: Gio.Cancellable,
     *     onAnswered: (error: Error|null) => void) => void} options.startUnit - Asks systemd to start the service:
     *     startResourcePulseUnit, or a fake.
     * @param {{addSeconds: (intervalSeconds: number, callback: () => boolean) => number,
     *     remove: (sourceId: number) => void}} options.timeouts - Adds and removes the chain's whole-second timeouts.
     * @param {import('./lib/errorLog.js').RateLimitedLogger} options.errorLog - Where failures go.
     * @param {Gio.Cancellable} options.cancellable - Cancels a StartUnit on its way; the client cancels it at
     *     destroy().
     * @param {() => Gio.DBusConnection|null} options.getConnection - The client's bus connection; null until it is up.
     * @param {() => boolean} options.isClientDestroyed - True once the client is destroyed: an answer then changes
     *     nothing.
     * @param {() => boolean} options.isServiceOnBus - True while somebody owns the service's bus name: nothing is left
     *     to start.
     * @param {(stepName: string, step: () => void) => void} options.runWithoutThrowing - Runs a step of a timeout
     *     callback, logging what it throws.
     */
    constructor({
        startUnit, timeouts, errorLog, cancellable, getConnection, isClientDestroyed, isServiceOnBus,
        runWithoutThrowing,
    }) {
        this._startUnit = startUnit;
        this._timeouts = timeouts;
        this._errorLog = errorLog;
        this._cancellable = cancellable;
        this._getConnection = getConnection;
        this._isClientDestroyed = isClientDestroyed;
        this._isServiceOnBus = isServiceOnBus;
        this._runWithoutThrowing = runWithoutThrowing;

        // The chain's pending step, at most one: a retry after a failure, or the wait for the service to appear after
        // an accepted StartUnit. Every way the chain ends or restarts removes it.
        this._startChainSourceId = null;
        // The latest StartUnit sent: {attemptNumber}, counted from 1 by each restart(). An answer to an older one is
        // ignored, so two start() calls in a row cannot both schedule a retry.
        this._latestStartAttempt = null;
        // True while a StartUnit is due but the connection is not up yet.
        this._isServiceStartPending = false;
    }

    /**
     * Starts a new StartUnit chain: removes a pending retry, counts attempts from 1 again, and sends the first now if
     * the connection is up (else once it is).
     *
     * @returns {void}
     */
    restart() {
        this.cancelPendingStep();
        this._latestStartAttempt = null;
        this._isServiceStartPending = true;
        this.attemptIfConnected();
    }

    /**
     * Sends the StartUnit that is due, if one is and the connection is up.
     *
     * @returns {void}
     */
    attemptIfConnected() {
        const connection = this._getConnection();
        if (!this._isServiceStartPending || connection === null)
            return;
        this._isServiceStartPending = false;
        const previousAttemptNumber = this._latestStartAttempt?.attemptNumber ?? 0;
        const startAttempt = {attemptNumber: previousAttemptNumber + 1};
        this._latestStartAttempt = startAttempt;
        this._startUnit(connection, this._cancellable,
            error => this._onServiceStartAnswered(startAttempt, error));
    }

    /**
     * Ends the chain, because the service appeared on the bus: removes its pending step, and supersedes a StartUnit
     * still on its way, so its answer cannot start a retry once the service has left again.
     *
     * @returns {void}
     */
    end() {
        this.cancelPendingStep();
        this._latestStartAttempt = null;
    }

    /**
     * Removes the chain's pending step, if any: a retry, or the wait for the service to appear.
     *
     * @returns {void}
     */
    cancelPendingStep() {
        if (this._startChainSourceId === null)
            return;
        const startChainSourceId = this._startChainSourceId;
        this._startChainSourceId = null;
        this._timeouts.remove(startChainSourceId);
    }

    /**
     * Handles systemd's answer to the latest StartUnit (an answer to an older one, or to one the service appearing
     * superseded, is ignored). A failure is logged. While the service is on the bus nothing follows: there is nothing
     * left to start, and a retry could restart it after someone stopped it on purpose. Otherwise an accepted StartUnit
     * waits for the service to appear, and a failure is retried after nextStartRetryDelaySeconds.
     *
     * @param {{attemptNumber: number}} startAttempt - The attempt answered.
     * @param {Error|null} error - Null when systemd accepted the start job.
     * @returns {void}
     */
    _onServiceStartAnswered(startAttempt, error) {
        if (this._isClientDestroyed() || startAttempt !== this._latestStartAttempt)
            return;
        if (error !== null) {
            const errorText = describeError(error);
            this._errorLog.log(`StartUnit ${RESOURCE_PULSE_UNIT_NAME} failed: ${errorText}`,
                START_UNIT_FAILURE_LOG_KEY);
        }
        if (this._isServiceOnBus())
            return;
        if (error === null)
            this._awaitServiceAppearance(startAttempt);
        else
            this._scheduleStartRetry(startAttempt);
    }

    /**
     * Waits START_CONFIRMATION_TIMEOUT_SECONDS for the service an accepted StartUnit started to appear on the bus. Its
     * appearing ends the chain (and removes this wait); otherwise the attempt counts as failed.
     *
     * @param {{attemptNumber: number}} startAttempt - The accepted attempt.
     * @returns {void}
     */
    _awaitServiceAppearance(startAttempt) {
        this._startChainSourceId = this._timeouts.addSeconds(START_CONFIRMATION_TIMEOUT_SECONDS,
            () => this._onStartConfirmationTimeout(startAttempt));
    }

    /**
     * The service did not appear after an accepted StartUnit (the unit at its start limit, or exiting at once): logs
     * it and retries, as for a failure. Runs as a GLib timeout, so it never throws.
     *
     * @param {{attemptNumber: number}} startAttempt - The accepted attempt.
     * @returns {boolean} GLib.SOURCE_REMOVE: each step of the chain is a timeout of its own.
     */
    _onStartConfirmationTimeout(startAttempt) {
        this._startChainSourceId = null;
        this._runWithoutThrowing('retry an unconfirmed StartUnit', () => {
            this._errorLog.log(`StartUnit ${RESOURCE_PULSE_UNIT_NAME} was accepted, but the service did not appear ` +
                `on the bus within ${START_CONFIRMATION_TIMEOUT_SECONDS} s`, START_UNCONFIRMED_LOG_KEY);
            this._scheduleStartRetry(startAttempt);
        });
        return GLib.SOURCE_REMOVE;
    }

    /**
     * Schedules the next StartUnit after nextStartRetryDelaySeconds for the attempt that failed.
     *
     * @param {{attemptNumber: number}} startAttempt - The failed (or unconfirmed) attempt.
     * @returns {void}
     */
    _scheduleStartRetry(startAttempt) {
        const retryDelaySeconds = nextStartRetryDelaySeconds(startAttempt.attemptNumber);
        this._startChainSourceId = this._timeouts.addSeconds(retryDelaySeconds, () => this._onStartRetryTimeout());
    }

    /**
     * Sends the next StartUnit of the chain. Runs as a GLib timeout, so it never throws.
     *
     * @returns {boolean} GLib.SOURCE_REMOVE: each step of the chain is a timeout of its own.
     */
    _onStartRetryTimeout() {
        this._startChainSourceId = null;
        this._isServiceStartPending = true;
        this._runWithoutThrowing('retry StartUnit', () => this.attemptIfConnected());
        return GLib.SOURCE_REMOVE;
    }
}
