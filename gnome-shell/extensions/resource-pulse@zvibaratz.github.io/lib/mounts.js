// The mounts source's pure part: the local disks, network shares and removable disks from the mount entries the IO
// layer read (service/cockpit.js), as the rows parseMountsSource in lib/cockpitProtocol.js rebuilds. No Gio, no GLib
// and no Shell import, so it runs under plain gjs.
import {BYTES_PER_GIBIBYTE, NETWORK_FILESYSTEM_TYPES, REMOVABLE_MOUNT_PREFIXES} from './constants.js';
import {guardDisplayName} from './nameGuard.js';
import {nonNegativeNumberOrNull} from './jsonFields.js';

const ROOT_MOUNT_POINT = '/';
const HOME_MOUNT_POINT = '/home';
/**
 * The mount points whose filesystem is listed as a local disk: the root filesystem, and /home. A mount under either
 * (/boot, /home/user/scratch) is not one. /home makes no row on /'s own device (subvolumes of one btrfs, or a bind
 * mount of a directory of /), where it would repeat /'s free space.
 */
const LOCAL_DISK_MOUNT_POINTS = [ROOT_MOUNT_POINT, HOME_MOUNT_POINT];
const LOCAL_DISK_KIND = 'local';
/**
 * An automount point's filesystem type: a mount point waiting for a mount, never a filesystem with sizes, so it is no
 * row of any kind, and is never queried (a query could trigger the mount).
 */
const AUTOMOUNT_FILESYSTEM_TYPE = 'autofs';
/**
 * The sizes are published to a tenth of a GiB, as lib/format.js's formatGibibytes draws them (a table row holds the
 * two together): free space moves all the time, and finer bytes would make the source change at every sample.
 */
const PUBLISHED_GIBIBYTE_DECIMALS = 1;

/**
 * @param {{mountPoint: string, filesystemType: string, isReadOnly?: boolean}} entry - A mount entry.
 * @returns {string|null} Null for an automount point, before anything else; 'network' for a network filesystem type
 *     (it wins over the mount point); 'local' for a mount point in LOCAL_DISK_MOUNT_POINTS mounted read-write (one
 *     mounted read-only, such as an image root, cannot fill, and is null); 'removable' for one under a
 *     REMOVABLE_MOUNT_PREFIXES entry; otherwise null.
 */
function mountKindOf({mountPoint, filesystemType, isReadOnly}) {
    if (filesystemType === AUTOMOUNT_FILESYSTEM_TYPE)
        return null;
    if (NETWORK_FILESYSTEM_TYPES.includes(filesystemType))
        return 'network';
    if (LOCAL_DISK_MOUNT_POINTS.includes(mountPoint))
        return isReadOnly === true ? null : LOCAL_DISK_KIND;
    if (REMOVABLE_MOUNT_PREFIXES.some(prefix => mountPoint.startsWith(prefix)))
        return 'removable';
    return null;
}

/**
 * @param {*} bytes - A size, as read.
 * @returns {number|null} The size as published: whole bytes at the tenth of a GiB formatGibibytes draws it as, so
 *     the drawn text is the same as from the exact size. A size that rounds to 0 while it is not 0 is kept exact: it
 *     is a filesystem smaller than half a tenth of a GiB, whose total never moves. Null when not a non-negative
 *     number.
 */
function publishedSizeBytes(bytes) {
    const exactBytes = nonNegativeNumberOrNull(bytes);
    if (exactBytes === null)
        return null;
    const drawnGibibytes = Number((exactBytes / BYTES_PER_GIBIBYTE).toFixed(PUBLISHED_GIBIBYTE_DECIMALS));
    const roundedBytes = Math.round(drawnGibibytes * BYTES_PER_GIBIBYTE);
    return roundedBytes === 0 && exactBytes > 0 ? exactBytes : roundedBytes;
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
 * @param {{mountPoint: string, kind: string}} first - A row.
 * @param {{mountPoint: string, kind: string}} second - Another row.
 * @returns {number} Negative, zero or positive: the local disks first, then by plain string comparison of the mount
 *     points.
 */
function compareMountRows(first, second) {
    const isFirstLocal = first.kind === LOCAL_DISK_KIND;
    if (isFirstLocal !== (second.kind === LOCAL_DISK_KIND))
        return isFirstLocal ? -1 : 1;
    if (first.mountPoint === second.mountPoint)
        return 0;
    return first.mountPoint < second.mountPoint ? -1 : 1;
}

/**
 * @param {Map<string, object>} rowsByMountPoint - The rows so far, by mount point.
 * @param {Map<string, string>} devicePathByMountPoint - Each listed mount point's device, the last entry's.
 * @returns {void} Drops the /home local disk where its device is /'s: the same filesystem, whose free space the /
 *     row already shows.
 */
function dropHomeOnRootDevice(rowsByMountPoint, devicePathByMountPoint) {
    const homeRow = rowsByMountPoint.get(HOME_MOUNT_POINT);
    const homeDevicePath = devicePathByMountPoint.get(HOME_MOUNT_POINT);
    const isHomeOnRootDevice = typeof homeDevicePath === 'string' && homeDevicePath !== '' &&
        homeDevicePath === devicePathByMountPoint.get(ROOT_MOUNT_POINT);
    if (homeRow?.kind === LOCAL_DISK_KIND && isHomeOnRootDevice)
        rowsByMountPoint.delete(HOME_MOUNT_POINT);
}

/**
 * Builds the mount rows: the local disks, network shares and removable disks among the mounts.
 *
 * @param {Array<{mountPoint: string, filesystemType: string, devicePath: string, label: string|null,
 *     isReadOnly?: boolean, freeBytes: number|null, totalBytes: number|null}>} entries - The mounts, as the IO layer
 *     read them, in the mount table's order.
 * @returns {Array<{mountPoint: string, label: string, kind: string, filesystemType: string|null,
 *     freeBytes: number|null, totalBytes: number|null}>} A row for each entry with a string mount point that is a
 *     network share, a local disk (mountKindOf; /home not on /'s device) or under a removable prefix: the local
 *     disks first, then the rest by mount point. A mount point the table lists more than once (a filesystem mounted
 *     over another) gives one row, from its last entry: the mount that is seen there. The label is the entry's label,
 *     else the mount point's last segment, through guardDisplayName; sizes are published as publishedSizeBytes
 *     gives them, or null.
 */
export function mountRowsFrom(entries) {
    if (!Array.isArray(entries))
        return [];
    const rowsByMountPoint = new Map();
    const devicePathByMountPoint = new Map();
    entries.forEach(entry => {
        if (entry === null || typeof entry !== 'object' || typeof entry.mountPoint !== 'string')
            return;
        const kind = mountKindOf(entry);
        if (kind === null)
            return;
        const hasLabel = typeof entry.label === 'string' && entry.label !== '';
        devicePathByMountPoint.set(entry.mountPoint, entry.devicePath);
        rowsByMountPoint.set(entry.mountPoint, {
            mountPoint: entry.mountPoint,
            label: guardDisplayName(hasLabel ? entry.label : lastSegmentOf(entry.mountPoint)),
            kind,
            filesystemType: typeof entry.filesystemType === 'string' ? entry.filesystemType : null,
            freeBytes: publishedSizeBytes(entry.freeBytes),
            totalBytes: publishedSizeBytes(entry.totalBytes),
        });
    });
    dropHomeOnRootDevice(rowsByMountPoint, devicePathByMountPoint);
    return [...rowsByMountPoint.values()].sort(compareMountRows);
}
