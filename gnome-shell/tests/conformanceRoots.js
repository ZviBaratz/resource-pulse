// The roots the compiled program reads in the conformance exchange (conformanceExchange.js's header says what the
// exchange is): one directory per tick, each of links to one moving fixture root's /proc, block devices and CPU devices
// and to one fixed root's cgroup tree (createConformanceRoots), and the link the program reads its root through, moved
// on atomically after each tick (pointLinkAt, rootAfterTicks). Only the program's side of the conformance row, in
// sampler-program-dbus.test.js, reads them: the test double is fed the program's own Samples. The fixtures are found
// from this module's own place (import.meta.url), so it lives in gnome-shell/tests/. It registers no rows.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [MODULE_FILE_PATH] = GLib.filename_from_uri(import.meta.url);
const FIXTURES_DIRECTORY_PATH = GLib.build_filenamev([GLib.path_get_dirname(MODULE_FILE_PATH), 'fixtures']);
const ROOT_DIRECTORY_MODE = 0o755;
/**
 * The roots the program reads in the exchange, one per tick: the counters of /proc, the block devices and the CPU
 * devices of root-moving-a to root-moving-f, which move by amounts that are not round (golden/moving-counters.json
 * holds their arithmetic), over the cgroup tree of root-moving-a for every tick (createConformanceRoots). So the
 * Samples carry the busy percent of the machine and of each cluster, the memory, swap and pressure, and the apps'
 * memory under the names the .desktop fixtures give them. The cgroup tree is held still so that every number a Sample
 * carries, its clocks apart, is the same on every run: an app's CPU share is its CPU time over the program's own time
 * between two scans, which a runner's load would move. After the last root the roots stay.
 */
const CONFORMANCE_ROOT_NAMES = ['root-moving-a', 'root-moving-b', 'root-moving-c', 'root-moving-d', 'root-moving-e',
    'root-moving-f'];
/** The root whose cgroup tree every tick of the exchange reads. */
const CONFORMANCE_CGROUP_ROOT_NAME = 'root-moving-a';

/**
 * Points a symbolic link at a directory, atomically: the link is made beside it and renamed over it, so a reader
 * resolving the path sees the old target or the new, never none.
 *
 * @param {string} linkPath - The link.
 * @param {string} targetPath - What it points at.
 * @returns {void}
 * @throws {Error} When the link cannot be made or renamed.
 */
export function pointLinkAt(linkPath, targetPath) {
    const nextLinkPath = `${linkPath}.next`;
    Gio.File.new_for_path(nextLinkPath).make_symbolic_link(targetPath, null);
    if (GLib.rename(nextLinkPath, linkPath) !== 0)
        throw new Error(`cannot rename ${nextLinkPath} over ${linkPath}`);
}

/**
 * Builds the roots the exchange moves through, in a directory of the row's own: each is a directory of links to one
 * fixture root's /proc, block devices and CPU devices and to the cgroup tree of CONFORMANCE_CGROUP_ROOT_NAME.
 *
 * @param {string} workDirectoryPath - The row's directory.
 * @returns {string[]} The roots' paths, in tick order.
 */
export function createConformanceRoots(workDirectoryPath) {
    const fixturePath = rootName => GLib.build_filenamev([FIXTURES_DIRECTORY_PATH, rootName]);
    return CONFORMANCE_ROOT_NAMES.map(rootName => {
        const rootPath = GLib.build_filenamev([workDirectoryPath, 'roots', rootName]);
        GLib.mkdir_with_parents(GLib.build_filenamev([rootPath, 'sys']), ROOT_DIRECTORY_MODE);
        const linkedParts = [
            ['proc', rootName], ['sys/block', rootName], ['sys/devices', rootName],
            ['sys/fs', CONFORMANCE_CGROUP_ROOT_NAME],
        ];
        for (const [relativePath, sourceRootName] of linkedParts) {
            pointLinkAt(GLib.build_filenamev([rootPath, relativePath]),
                GLib.build_filenamev([fixturePath(sourceRootName), relativePath]));
        }
        return rootPath;
    });
}

/**
 * The root a number of completed ticks puts the program on: the root of the next tick, the last one for ever after the
 * last.
 *
 * @param {string[]} rootPaths - From createConformanceRoots.
 * @param {number} completedTickCount - Ticks run so far.
 * @returns {string} The root's path.
 */
export function rootAfterTicks(rootPaths, completedTickCount) {
    return rootPaths[Math.min(completedTickCount, rootPaths.length - 1)];
}
