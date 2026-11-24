// Fixture trees for sampler-program-dbus.test.js's garbage and conformance rows: a copy of a fixture root with every
// file cut short or filled with random bytes (writeGarbageTree, from createSeededRandom's numbers, so one seed gives
// the same tree on every machine), and the removal of a tree a row made (removeTree). It registers no rows.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** The share of files cut at a random offset; the rest are filled with random bytes of at least the original length. */
const TRUNCATE_PROBABILITY = 0.5;
const MIN_GARBAGE_LENGTH_BYTES = 16;
const DIRECTORY_MODE = 0o755;

/**
 * A pseudo-random generator that gives the same numbers for the same seed (mulberry32).
 *
 * @param {number} seed - The seed.
 * @returns {() => number} A function giving the next number, at least 0 and below 1, on each call.
 */
export function createSeededRandom(seed) {
    const STEP = 0x6D2B79F5;
    const UINT32_RANGE = 4294967296;
    let state = seed >>> 0;
    return () => {
        state = (state + STEP) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
    };
}

/**
 * Lists a directory's children in name order, so that a tree made from it is the same on every machine.
 *
 * @param {string} directoryPath - The directory.
 * @returns {Array<{name: string, isDirectory: boolean}>} Its children.
 */
function listChildren(directoryPath) {
    const enumerator = Gio.File.new_for_path(directoryPath).enumerate_children('standard::name,standard::type',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    const children = [];
    for (let info = enumerator.next_file(null); info !== null; info = enumerator.next_file(null))
        children.push({name: info.get_name(), isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY});
    enumerator.close(null);
    return children.sort((first, second) => (first.name < second.name ? -1 : 1));
}

/**
 * Cuts a file's bytes at a random offset, or replaces them with random bytes of about the same length, by a coin flip.
 *
 * @param {Uint8Array} bytes - The file's bytes.
 * @param {() => number} nextRandom - From createSeededRandom.
 * @returns {Uint8Array} The garbled bytes.
 */
function garbleBytes(bytes, nextRandom) {
    const BYTE_VALUE_COUNT = 256;
    if (nextRandom() < TRUNCATE_PROBABILITY)
        return bytes.slice(0, Math.floor(nextRandom() * (bytes.length + 1)));
    const garbageLength = Math.max(bytes.length, MIN_GARBAGE_LENGTH_BYTES);
    return Uint8Array.from({length: garbageLength}, () => Math.floor(nextRandom() * BYTE_VALUE_COUNT));
}

/**
 * Copies a directory tree with every file garbled (garbleBytes), in name order.
 *
 * @param {string} sourcePath - The tree to copy.
 * @param {string} destinationPath - An existing, empty directory.
 * @param {() => number} nextRandom - From createSeededRandom.
 * @returns {void}
 */
export function writeGarbageTree(sourcePath, destinationPath, nextRandom) {
    for (const {name, isDirectory} of listChildren(sourcePath)) {
        const sourceChildPath = GLib.build_filenamev([sourcePath, name]);
        const destinationChildPath = GLib.build_filenamev([destinationPath, name]);
        if (isDirectory) {
            GLib.mkdir_with_parents(destinationChildPath, DIRECTORY_MODE);
            writeGarbageTree(sourceChildPath, destinationChildPath, nextRandom);
        } else {
            const [, bytes] = GLib.file_get_contents(sourceChildPath);
            GLib.file_set_contents(destinationChildPath, garbleBytes(bytes, nextRandom));
        }
    }
}

/**
 * Deletes a directory tree.
 *
 * @param {string} directoryPath - The directory.
 * @returns {void}
 */
export function removeTree(directoryPath) {
    for (const {name, isDirectory} of listChildren(directoryPath)) {
        const childPath = GLib.build_filenamev([directoryPath, name]);
        if (isDirectory)
            removeTree(childPath);
        else
            Gio.File.new_for_path(childPath).delete(null);
    }
    Gio.File.new_for_path(directoryPath).delete(null);
}
