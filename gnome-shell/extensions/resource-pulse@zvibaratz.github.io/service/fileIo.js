// Synchronous file reads. The cockpit service reads with readFileToEnd (service/cockpit.js, and its sources through
// service/sources/sourceIo.js). The compiled sampler's reader gives the texts this gives
// (resource-pulse-sampler/src/real_ports.rs).
// Synchronous on purpose: the cockpit service is its own process, never the shell.
import Gio from 'gi://Gio';

const UTF8_DECODER = new TextDecoder();

/**
 * Reads a whole file synchronously as UTF-8. Gio.File.load_contents reads until EOF, so the size kernfs reports for a
 * /proc, /sys or cgroup file (0, or a whole page) is never trusted.
 *
 * @param {string} path - Absolute path.
 * @returns {string} The contents.
 * @throws {GLib.Error} When the file cannot be opened or read (G_IO_ERROR_NOT_FOUND when it does not exist).
 */
export function readFileToEnd(path) {
    const [, contentBytes] = Gio.File.new_for_path(path).load_contents(null);
    return UTF8_DECODER.decode(contentBytes);
}
