// The mounts source's pure part: the local disks, network shares and removable disks from the mount entries the IO
// layer read (service/cockpit.js), as the rows parseMountsSource in lib/cockpitProtocol.js rebuilds. No Gio, no GLib
// and no Shell import, so it runs under plain gjs.
import {NETWORK_FILESYSTEM_TYPES, REMOVABLE_MOUNT_PREFIXES} from './constants.js';
import {guardDisplayName} from './nameGuard.js';
import {nonNegativeNumberOrNull} from './jsonFields.js';

/**
 * The mount points whose filesystem is listed as a local disk: the root filesystem, and /home, which the mount table
 * holds only where it is a filesystem of its own. A mount under either (/boot, /home/user/scratch) is not one.
 */
const LOCAL_DISK_MOUNT_POINTS = ['/', '/home'];

/**
 * @param {string} mountPoint - An absolute mount point.
 * @param {string} filesystemType - The mount's filesystem type.
 * @returns {string|null} 'network' for a network filesystem type (it wins over the mount point), 'local' for a
 *     mount point in LOCAL_DISK_MOUNT_POINTS, 'removable' for one under a REMOVABLE_MOUNT_PREFIXES entry, otherwise
 *     null.
 */
function mountKindOf(mountPoint, filesystemType) {
    if (NETWORK_FILESYSTEM_TYPES.includes(filesystemType))
        return 'network';
    if (LOCAL_DISK_MOUNT_POINTS.includes(mountPoint))
        return 'local';
    if (REMOVABLE_MOUNT_PREFIXES.some(prefix => mountPoint.startsWith(prefix)))
        return 'removable';
    return null;
}

/**
 * @param {string} mountPoint - An absolute mount point.
 * @returns {string} Its last non-empty segment ('/mnt/nas/' gives 'nas').
 */
function lastSegmentOf(mountPoint) {
    const segments = mountPoint.split('/').filter(segment => segment !== '');
    return segments.length > 0 ? segments[segments.length - 1] : mountPoint;
}

/**
 * @param {{mountPoint: string}} first - A row.
 * @param {{mountPoint: string}} second - Another row.
 * @returns {number} Negative, zero or positive by plain string comparison of the mount points.
 */
function compareMountPoints(first, second) {
    if (first.mountPoint === second.mountPoint)
        return 0;
    return first.mountPoint < second.mountPoint ? -1 : 1;
}

/**
 * Builds the mount rows: the local disks, network shares and removable disks among the mounts.
 *
 * @param {Array<{mountPoint: string, filesystemType: string, devicePath: string, label: string|null,
 *     freeBytes: number|null, totalBytes: number|null}>} entries - The mounts, as the IO layer read them, in the
 *     mount table's order.
 * @returns {Array<{mountPoint: string, label: string, kind: string, filesystemType: string|null,
 *     freeBytes: number|null, totalBytes: number|null}>} A row for each entry with a string mount point that is a
 *     network share, a local disk or under a removable prefix, sorted by mount point. A mount point the table lists
 *     more than once (an automount, then the filesystem mounted over it) gives one row, from its last entry: the
 *     mount that is seen there. The label is the entry's label, else the mount point's last segment, through
 *     guardDisplayName; sizes pass through as non-negative numbers or null.
 */
export function mountRowsFrom(entries) {
    if (!Array.isArray(entries))
        return [];
    const rowsByMountPoint = new Map();
    entries.forEach(entry => {
        if (entry === null || typeof entry !== 'object' || typeof entry.mountPoint !== 'string')
            return;
        const kind = mountKindOf(entry.mountPoint, entry.filesystemType);
        if (kind === null)
            return;
        const hasLabel = typeof entry.label === 'string' && entry.label !== '';
        // Deleted first, so that the later entry also takes the later place in the map's order.
        rowsByMountPoint.delete(entry.mountPoint);
        rowsByMountPoint.set(entry.mountPoint, {
            mountPoint: entry.mountPoint,
            label: guardDisplayName(hasLabel ? entry.label : lastSegmentOf(entry.mountPoint)),
            kind,
            filesystemType: typeof entry.filesystemType === 'string' ? entry.filesystemType : null,
            freeBytes: nonNegativeNumberOrNull(entry.freeBytes),
            totalBytes: nonNegativeNumberOrNull(entry.totalBytes),
        });
    });
    return [...rowsByMountPoint.values()].sort(compareMountPoints);
}
