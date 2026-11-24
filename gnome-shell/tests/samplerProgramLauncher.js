// The compiled sampler under test, for sampler-program-dbus.test.js's rows on a PRIVATE message bus: the program to
// start (setSamplerProgramPath, which run-sampler-program.js calls with its first argument), a copy of it started on
// the private bus over a fixture root and the fixture data directories (spawnProgram) and stopped again
// (stopProgram), who owns its bus name (watchBusName, waitForFreeName), and a row's whole run against one serving
// copy (withServingProgram). It registers no rows.
//
// Every copy it starts stays in runningPrograms until it is seen to exit. The test file's last row asserts that Set is
// empty, so the Set itself is exported and read there: a second Set anywhere else would be empty from the start, and
// that row would pass whatever was left running. The row before it holds the Set it reads to this module's own.
//
// No copy reads the host's .desktop files: spawnProgram gives every copy the program's real inputs for app names,
// XDG_DATA_HOME, XDG_DATA_DIRS and HOME, pointing into resource-pulse-sampler/tests/fixtures/bus-desktop, with the
// language variables fixed (PROGRAM_DATA_ENVIRONMENT), overwriting whatever the runner's own environment holds. The
// fixture paths are resolved from this module's own place (import.meta.url), so it lives in gnome-shell/tests/.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {openPrivateBusConnection, requirePrivateBusAddress, waitUntil} from './privateBus.js';
import {closeConnection} from './busCalls.js';
import {RESOURCE_PULSE_BUS_NAME} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';

const SESSION_BUS_ADDRESS_VARIABLE = 'DBUS_SESSION_BUS_ADDRESS';
export const TICK_INTERVAL_FLAG = '--tick-interval-ms';
const FS_ROOT_FLAG = '--fs-root';
const [MODULE_FILE_PATH] = GLib.filename_from_uri(import.meta.url);
/** The fixture root every copy of the program reads, in place of the machine's own. */
export const FIXTURE_ROOT_PATH = GLib.build_filenamev([GLib.path_get_dirname(MODULE_FILE_PATH), 'fixtures', 'root-a']);
/**
 * The directories the program looks `.desktop` files up in, and the language it names them in: a home that does not
 * exist (nothing is read from it), a data home with Example Editor, a system directory with Example Browser and a
 * Chrome whose name is the fixture's own (root-a's Chrome scopes resolve to it).
 */
const DESKTOP_FIXTURES_PATH = GLib.canonicalize_filename(GLib.build_filenamev([
    GLib.path_get_dirname(MODULE_FILE_PATH), '..', '..', 'resource-pulse-sampler', 'tests', 'fixtures', 'bus-desktop',
]), null);
const FIXED_LANGUAGE = 'C.UTF-8';
/**
 * The same values live in two more places: scripts/test-resource-pulse-sampler-bus.sh's BUS_ROWS_DATA_ENVIRONMENT, for
 * the copies of the program its session children start, and resource-pulse-sampler/tests/common/mod.rs's
 * pin_data_directories, for the Rust tests that start the program. Nothing checks one against another: change all
 * three together.
 */
const PROGRAM_DATA_ENVIRONMENT = {
    XDG_DATA_HOME: GLib.build_filenamev([DESKTOP_FIXTURES_PATH, 'home']),
    XDG_DATA_DIRS: GLib.build_filenamev([DESKTOP_FIXTURES_PATH, 'system']),
    HOME: GLib.build_filenamev([DESKTOP_FIXTURES_PATH, 'home-dir']),
    LANGUAGE: 'en',
    LC_ALL: FIXED_LANGUAGE,
    LC_MESSAGES: FIXED_LANGUAGE,
    LANG: FIXED_LANGUAGE,
};
/** How long a started program may take to own the name. */
export const NAME_OWNED_TIMEOUT_MS = 5000;
/** How long the bus may take to free the name once its owner has exited. */
const NAME_FREED_TIMEOUT_MS = 2000;
/** How long a program may take to exit after a signal, or a second copy to give up. */
export const PROGRAM_EXIT_TIMEOUT_MS = 5000;
const TERMINATE_SIGNAL = 15;

/** The program under test; run-sampler-program.js sets it from its first argument. */
let samplerProgramPath = null;
/** Every copy of the program a row started that has not yet been seen to exit. */
export const runningPrograms = new Set();

/**
 * Sets the program the rows start.
 *
 * @param {string|undefined} programPath - The path run-sampler-program.js was given.
 * @returns {void}
 * @throws {Error} When the path is missing or is not an executable file.
 */
export function setSamplerProgramPath(programPath) {
    if (!programPath || !GLib.file_test(programPath, GLib.FileTest.IS_EXECUTABLE))
        throw new Error(`no executable sampler program at ${programPath}`);
    samplerProgramPath = programPath;
}

/**
 * Starts a copy of the program on the private bus, over a fixture root and the fixture data directories, and starts
 * waiting for its exit.
 *
 * @param {string[]} programArguments - The program's arguments after the fixture root's.
 * @param {string} [fsRootPath] - The root the copy reads; root-a unless given.
 * @returns {{subprocess: Gio.Subprocess, processId: string, hasExited: boolean, exitStatus: number|null}} The copy;
 *     hasExited and exitStatus (null when it was killed by a signal) are filled in when it exits.
 */
export function spawnProgram(programArguments, fsRootPath = FIXTURE_ROOT_PATH) {
    if (samplerProgramPath === null)
        throw new Error('no sampler program was given to the runner');
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv(SESSION_BUS_ADDRESS_VARIABLE, requirePrivateBusAddress(), true);
    for (const [variableName, value] of Object.entries(PROGRAM_DATA_ENVIRONMENT))
        launcher.setenv(variableName, value, true);
    const subprocess = launcher.spawnv([samplerProgramPath, FS_ROOT_FLAG, fsRootPath, ...programArguments]);
    const program = {subprocess, processId: subprocess.get_identifier(), hasExited: false, exitStatus: null};
    runningPrograms.add(program);
    subprocess.wait_async(null, (_subprocess, result) => {
        try {
            subprocess.wait_finish(result);
        } catch (error) {
            // The wait failed, so the exit was not seen: the copy stays in runningPrograms and the last row fails.
            printerr(`waiting for program ${program.processId} failed: ${error.message}`);
            return;
        }
        program.hasExited = true;
        program.exitStatus = subprocess.get_if_exited() ? subprocess.get_exit_status() : null;
        runningPrograms.delete(program);
    });
    return program;
}

/**
 * Stops a copy of the program: SIGTERM, then SIGKILL if it outlives PROGRAM_EXIT_TIMEOUT_MS.
 *
 * @param {{subprocess: Gio.Subprocess, processId: string, hasExited: boolean}} program - From spawnProgram.
 * @returns {Promise<void>}
 * @throws {Error} When it has not exited even after SIGKILL.
 */
export async function stopProgram(program) {
    if (program.hasExited)
        return;
    program.subprocess.send_signal(TERMINATE_SIGNAL);
    if (await waitUntil(() => program.hasExited, PROGRAM_EXIT_TIMEOUT_MS))
        return;
    program.subprocess.force_exit();
    if (!await waitUntil(() => program.hasExited, PROGRAM_EXIT_TIMEOUT_MS))
        throw new Error(`program ${program.processId} did not exit after SIGKILL`);
}

/**
 * Follows who owns the bus name, as a client of it does.
 *
 * @param {Gio.DBusConnection} connection - The watcher's connection.
 * @param {(ownerName: string) => void} [onAppeared] - Called in the name-appeared handler itself.
 * @returns {{ownerName: string|null, isKnown: boolean, stop: () => void}} The owner's unique name, or null while
 *     the name has none; isKnown turns true at the watcher's first answer.
 */
export function watchBusName(connection, onAppeared = () => {}) {
    const watch = {ownerName: null, isKnown: false};
    const watcherId = Gio.bus_watch_name_on_connection(connection, RESOURCE_PULSE_BUS_NAME,
        Gio.BusNameWatcherFlags.NONE, (_connection, _name, ownerName) => {
            watch.ownerName = ownerName;
            watch.isKnown = true;
            onAppeared(ownerName);
        }, () => {
            watch.ownerName = null;
            watch.isKnown = true;
        });
    watch.stop = () => Gio.bus_unwatch_name(watcherId);
    return watch;
}

/**
 * Waits until the bus name has no owner, so that a row's watcher cannot mistake the copy a row before left for its
 * own.
 *
 * @param {{ownerName: string|null, isKnown: boolean}} watch - From watchBusName.
 * @returns {Promise<void>}
 * @throws {Error} When the name is still owned after NAME_FREED_TIMEOUT_MS.
 */
export async function waitForFreeName(watch) {
    if (!await waitUntil(() => watch.isKnown && watch.ownerName === null, NAME_FREED_TIMEOUT_MS))
        throw new Error(`${RESOURCE_PULSE_BUS_NAME} still has an owner (${watch.ownerName}) before the row starts`);
}

/**
 * Starts the program, waits for it to own the name, runs a row against it, and stops it and closes every
 * connection the row opened, whatever happens.
 *
 * @param {string[]} programArguments - The program's arguments.
 * @param {(fixture: object) => Promise<void>} body - The row; gets {program, ownerName, openClient}.
 * @param {string} [fsRootPath] - The root the program reads; root-a unless given.
 * @returns {Promise<void>}
 */
export async function withServingProgram(programArguments, body, fsRootPath = FIXTURE_ROOT_PATH) {
    const watcherConnection = openPrivateBusConnection();
    const clientConnections = [];
    const watch = watchBusName(watcherConnection);
    let program = null;
    try {
        await waitForFreeName(watch);
        program = spawnProgram(programArguments, fsRootPath);
        const servingProgram = program;
        await waitUntil(() => watch.ownerName !== null || servingProgram.hasExited, NAME_OWNED_TIMEOUT_MS);
        if (watch.ownerName === null) {
            throw new Error(`the program never owned ${RESOURCE_PULSE_BUS_NAME} ` +
                `(exited: ${program.hasExited}, status ${program.exitStatus})`);
        }
        await body({
            program,
            ownerName: watch.ownerName,
            openClient: () => {
                const clientConnection = openPrivateBusConnection();
                clientConnections.push(clientConnection);
                return clientConnection;
            },
        });
    } finally {
        watch.stop();
        if (program !== null)
            await stopProgram(program);
        for (const connection of [...clientConnections, watcherConnection]) {
            await closeConnection(connection);
        }
    }
}
