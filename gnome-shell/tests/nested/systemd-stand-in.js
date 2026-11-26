// gnome-shell/tests/nested/systemd-stand-in.js
// ============================================
// Serves systemd's user manager, as a default install with no cockpit answers the extension (systemdStandIn.js), on
// a nested run's private session bus, for a run started with --no-cockpit; scripts/resource-pulse-nested.sh starts
// the run's copy of it in the cockpit service's place, records it as `systemd`, and ends it at stop. It owns
// org.freedesktop.systemd1, which systemd itself owns on the owner's real session bus, so it refuses any bus but its
// run's private one (privateSessionBus.js) before connecting.
//
// Usage (inside a run's environment): gjs -m systemd-stand-in.js
// Exit status: 0 when the bus connection closes after the name was owned; 1 when it cannot connect, cannot export
// its objects or never owns the name; 2 for an argument, or a bus that is not the run's.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {
    NESTED_RUN_DIR_VARIABLE, SESSION_BUS_ADDRESS_VARIABLE, connectToBus, isRunPrivateSessionBusAddress,
} from './privateSessionBus.js';
import {DefaultInstallUnits, SYSTEMD_BUS_NAME, exportDefaultInstallSystemd} from './systemdStandIn.js';

const LOG_PREFIX = 'systemd-stand-in:';
const EXIT_STATUS_SUCCESS = 0;
const EXIT_STATUS_FAILURE = 1;
const EXIT_STATUS_REFUSED = 2;

/**
 * Runs a callback that GLib or Gio calls, so that nothing it throws escapes into the main loop: it is logged.
 *
 * @param {string} callbackDescription - What the callback does, for the log.
 * @param {() => void} callback - The callback's body.
 * @returns {void}
 */
function runWithoutThrowing(callbackDescription, callback) {
    try {
        callback();
    } catch (error) {
        console.error(`${LOG_PREFIX} ${callbackDescription} failed: ${error?.stack ?? error}`);
    }
}

/**
 * Exports the objects, owns the name and serves until the connection closes or the name is lost.
 *
 * @param {Gio.DBusConnection} connection - The run's private session bus.
 * @returns {number} The process exit status.
 */
function serveUntilClosed(connection) {
    const mainLoop = new GLib.MainLoop(null, false);
    let exitStatus = null;
    let hasOwnedName = false;
    const quit = (reason, status) => {
        if (exitStatus !== null)
            return;
        exitStatus = status;
        console.log(`${LOG_PREFIX} stopping: ${reason}`);
        mainLoop.quit();
    };
    let exportedSystemd;
    try {
        exportedSystemd = exportDefaultInstallSystemd(connection, new DefaultInstallUnits(GLib.get_monotonic_time));
    } catch (error) {
        console.error(`${LOG_PREFIX} cannot export systemd's objects: ${error?.message ?? error}`);
        return EXIT_STATUS_FAILURE;
    }
    connection.connect('closed', () => runWithoutThrowing('the connection-closed handler',
        () => quit('the bus connection closed', EXIT_STATUS_SUCCESS)));
    Gio.bus_own_name_on_connection(connection, SYSTEMD_BUS_NAME, Gio.BusNameOwnerFlags.DO_NOT_QUEUE,
        () => runWithoutThrowing('the name-acquired handler', () => {
            hasOwnedName = true;
            console.log(`${LOG_PREFIX} serving ${SYSTEMD_BUS_NAME} as a default install with no cockpit`);
        }),
        () => runWithoutThrowing('the name-lost handler', () => {
            if (hasOwnedName)
                quit(`lost ${SYSTEMD_BUS_NAME}: the bus connection closed`, EXIT_STATUS_SUCCESS);
            else
                quit(`cannot own ${SYSTEMD_BUS_NAME}: another connection holds it`, EXIT_STATUS_FAILURE);
        }));
    mainLoop.run();
    runWithoutThrowing('unexporting', () => exportedSystemd.unexport());
    return exitStatus ?? EXIT_STATUS_SUCCESS;
}

/**
 * Checks that there is no argument and that the bus is the run's, connects, and serves.
 *
 * @param {string[]} argv - The arguments: none.
 * @returns {number} The process exit status.
 */
function main(argv) {
    if (argv.length !== 0) {
        console.error(`${LOG_PREFIX} usage: gjs -m systemd-stand-in.js (it takes no argument)`);
        return EXIT_STATUS_REFUSED;
    }
    const sessionBusAddress = GLib.getenv(SESSION_BUS_ADDRESS_VARIABLE);
    const nestedRunDir = GLib.getenv(NESTED_RUN_DIR_VARIABLE);
    if (!isRunPrivateSessionBusAddress(sessionBusAddress, nestedRunDir)) {
        const shownAddress = sessionBusAddress ?? '';
        console.error(`${LOG_PREFIX} refusing to serve on anything but the private session bus of the run in ` +
            `${NESTED_RUN_DIR_VARIABLE}, got: '${shownAddress}'`);
        return EXIT_STATUS_REFUSED;
    }
    let connection;
    try {
        connection = connectToBus(sessionBusAddress);
    } catch (error) {
        console.error(`${LOG_PREFIX} cannot connect to ${sessionBusAddress}: ${error.message}`);
        return EXIT_STATUS_FAILURE;
    }
    return serveUntilClosed(connection);
}

System.exit(main(ARGV));
