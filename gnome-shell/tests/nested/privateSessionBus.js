// gnome-shell/tests/nested/privateSessionBus.js
// ===============================================
// The nested harness's services (replay-service.js, systemd-stand-in.js) each own a bus name that something on the
// owner's real session bus owns too: the sampler's, and systemd's user manager's. So each serves only on its run's own
// private session bus, which scripts/resource-pulse-nested.sh hands it as DBUS_SESSION_BUS_ADDRESS, beside the run
// directory as RESOURCE_PULSE_NESTED_DIR. This module holds that one guard and the connection, for both.
import Gio from 'gi://Gio';

/** Set by scripts/resource-pulse-nested.sh to the run directory, in the nested processes' environment only. */
export const NESTED_RUN_DIR_VARIABLE = 'RESOURCE_PULSE_NESTED_DIR';
export const SESSION_BUS_ADDRESS_VARIABLE = 'DBUS_SESSION_BUS_ADDRESS';
/** Where the run's private session bus listens, relative to the run directory. */
const PRIVATE_SESSION_BUS_SOCKET_RELATIVE_PATH = 'bus/session.sock';
/** All dbus-daemon adds after the address it prints: its guid. */
const DBUS_GUID_SUFFIX_PATTERN = /^,guid=[0-9a-f]+$/;
/** A run directory the harness could have made: scripts/resource-pulse-nested.sh's RUN_DIR_SAFE_PATH_PATTERN. */
const RUN_DIR_SAFE_PATH_PATTERN = /^\/[A-Za-z0-9/._-]+$/;
/** What separates the addresses of a D-Bus address list, which GLib would try in turn. */
const DBUS_ADDRESS_LIST_SEPARATOR = ';';

/**
 * Succeeds only for the address of the run's own private session bus, as dbus-run-session hands it over: exactly
 * the run's socket, with at most dbus-daemon's guid after it. The run directory must pass the harness's own rule
 * first: one that does not (holding a ';' or a space, say) could build an address list that matches itself.
 * Anything else is refused, a list of addresses (which GLib would try in turn) included.
 *
 * @param {string|null} address - The session bus address in the environment.
 * @param {string|null} nestedRunDir - The run directory in the environment.
 * @returns {boolean} True for the run's private bus alone.
 */
export function isRunPrivateSessionBusAddress(address, nestedRunDir) {
    if (!address || !nestedRunDir)
        return false;
    if (!RUN_DIR_SAFE_PATH_PATTERN.test(nestedRunDir))
        return false;
    // Never a list. The rule above already keeps ';' out of the directory, and so out of the run's address; this
    // stays so that a wider rule could not let a list through.
    if (address.includes(DBUS_ADDRESS_LIST_SEPARATOR))
        return false;
    const runBusAddress = `unix:path=${nestedRunDir}/${PRIVATE_SESSION_BUS_SOCKET_RELATIVE_PATH}`;
    if (!address.startsWith(runBusAddress))
        return false;
    const addressSuffix = address.slice(runBusAddress.length);
    return addressSuffix === '' || DBUS_GUID_SUFFIX_PATTERN.test(addressSuffix);
}

/**
 * Connects to a message bus by its address.
 *
 * @param {string} address - The bus address, already checked to be the run's private bus.
 * @returns {Gio.DBusConnection} The connection.
 * @throws {GLib.Error} When the bus cannot be reached.
 */
export function connectToBus(address) {
    const connectionFlags = Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
        Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION;
    return Gio.DBusConnection.new_for_address_sync(address, connectionFlags, null, null);
}
