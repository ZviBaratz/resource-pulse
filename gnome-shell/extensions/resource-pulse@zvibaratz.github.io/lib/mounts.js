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
 * (/boot, /home/user/scratch) is not one. /home makes no row beside a / row on the same device (subvolumes of one
 * btrfs, or a bind mount of a directory of /), where it would repeat /'s free space.
 */
const LOCAL_DISK_MOUNT_POINTS = [ROOT_MOUNT_POINT, HOME_MOUNT_POINT];
const LOCAL_DISK_KIND = 'local';
/** An automount point's filesystem type: a mount point waiting for a mount, never a local disk. */
const AUTOMOUNT_FILESYSTEM_TYPE = 'autofs';
/** A device path that names a device starts so; tmpfs and the like read 'tmpfs' or 'none', shared by every one. */
const DEVICE_PATH_PREFIX = '/';
/**
 * Free space is published to the tenth of a GiB that lib/format.js's formatGibibytes draws (a table row holds the two
 * together), on a filesystem at least ROUNDED_FREE_SPACE_MIN_TOTAL_BYTES in size: free space moves all the time, and
 * finer bytes would send a Changed at every sample. A smaller filesystem keeps its exact free space, since a tenth of
 * a GiB is a large part of its bar.
 */
const PUBLISHED_GIBIBYTE_DECIMALS = 1;
const ROUNDED_FREE_SPACE_MIN_TOTAL_BYTES = 10 * BYTES_PER_GIBIBYTE;

/**
 * @param {{mountPoint: string, filesystemType: string, isReadOnly?: boolean}} entry - A mount entry.
 * @returns {string|null} 'network' for a network filesystem type (it wins over the mount point); 'local' for a mount
 *     point in LOCAL_DISK_MOUNT_POINTS mounted read-write and not an automount point (one mounted read-only, such as
 *     an image root, cannot fill); 'removable' for one under a REMOVABLE_MOUNT_PREFIXES entry; otherwise null.
 */
function mountKindOf({mountPoint, filesystemType, isReadOnly}) {
    if (NETWORK_FILESYSTEM_TYPES.includes(filesystemType))
        return 'network';
    const isLocalDiskCandidate = LOCAL_DISK_MOUNT_POINTS.includes(mountPoint) &&
        filesystemType !== AUTOMOUNT_FILESYSTEM_TYPE && isReadOnly !== true;
    if (isLocalDiskCandidate)
        return LOCAL_DISK_KIND;
    if (REMOVABLE_MOUNT_PREFIXES.some(prefix => mountPoint.startsWith(prefix)))
        return 'removable';
    return null;
}

/**
 * @param {number|null} freeBytes - Free bytes, as read: a non-negative number or null.
 * @param {number|null} totalBytes - Total bytes, as read: a non-negative number or null.
 * @returns {number|null} The free bytes as published: on a filesystem of ROUNDED_FREE_SPACE_MIN_TOTAL_BYTES or more,
 *     whole bytes at the tenth of a GiB formatGibibytes draws them as, 0 included, so the drawn text is the same as
 *     from the exact bytes; otherwise, or with the total unknown, exact.
 */
function publishedFreeBytes(freeBytes, totalBytes) {
    const isRounded = freeBytes !== null && totalBytes !== null && totalBytes >= ROUNDED_FREE_SPACE_MIN_TOTAL_BYTES;
    if (!isRounded)
        return freeBytes;
    const drawnGibibytes = Number((freeBytes / BYTES_PER_GIBIBYTE).toFixed(PUBLISHED_GIBIBYTE_DECIMALS));
    return Math.round(drawnGibibytes * BYTES_PER_GIBIBYTE);
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
 * @param {*} devicePath - A mount entry's device path.
 * @returns {boolean} Whether it names a device (starts with DEVICE_PATH_PREFIX), so two equal ones are one device.
 */
function isDevicePath(devicePath) {
    return typeof devicePath === 'string' && devicePath.startsWith(DEVICE_PATH_PREFIX);
}

/**
 * @param {Map<string, object>} rowsByMountPoint - The rows, by mount point.
 * @param {Map<string, object>} entriesByMountPoint - The entry each mount point's row came from.
 * @returns {void} Drops the /home local disk beside a / local disk on the same device: the same filesystem, whose
 *     free space the / row already shows.
 */
function dropHomeOnRootDevice(rowsByMountPoint, entriesByMountPoint) {
    const homeDevicePath = entriesByMountPoint.get(HOME_MOUNT_POINT)?.devicePath;
    const isBesideRootRow = rowsByMountPoint.get(HOME_MOUNT_POINT)?.kind === LOCAL_DISK_KIND &&
        rowsByMountPoint.get(ROOT_MOUNT_POINT)?.kind === LOCAL_DISK_KIND;
    const isOnRootDevice = isDevicePath(homeDevicePath) &&
        homeDevicePath === entriesByMountPoint.get(ROOT_MOUNT_POINT)?.devicePath;
    if (isBesideRootRow && isOnRootDevice)
        rowsByMountPoint.delete(HOME_MOUNT_POINT);
}

/**
 * Builds the mount rows: the local disks, network shares and removable disks among the mounts.
 *
 * @param {Array<{mountPoint: string, filesystemType: string, devicePath: string, label: string|null,
 *     isReadOnly?: boolean, freeBytes: number|null, totalBytes: number|null}>} entries - The mounts, as the IO layer
 *     read them, in the mount table's order.
 * @returns {Array<{mountPoint: string, label: string, kind: string, filesystemType: string|null,
 *     freeBytes: number|null, totalBytes: number|null}>} A row for each mount point whose last entry (the mount seen
 *     there, chosen before its kind is judged) is a network share, a local disk (mountKindOf; /home not beside a /
 *     row on the same device) or under a removable prefix: the local disks first, then the rest by mount point. The
 *     label is the entry's label, else the mount point's last segment, through guardDisplayName. The total is exact,
 *     and the free bytes as publishedFreeBytes gives them; a size that is not a non-negative number is null.
 */
export function mountRowsFrom(entries) {
    if (!Array.isArray(entries))
        return [];
    const entriesByMountPoint = new Map();
    entries.forEach(entry => {
        if (entry !== null && typeof entry === 'object' && typeof entry.mountPoint === 'string')
            entriesByMountPoint.set(entry.mountPoint, entry);
    });
    const rowsByMountPoint = new Map();
    entriesByMountPoint.forEach((entry, mountPoint) => {
        const kind = mountKindOf(entry);
        if (kind === null)
            return;
        const hasLabel = typeof entry.label === 'string' && entry.label !== '';
        const totalBytes = nonNegativeNumberOrNull(entry.totalBytes);
        rowsByMountPoint.set(mountPoint, {
            mountPoint,
            label: guardDisplayName(hasLabel ? entry.label : lastSegmentOf(mountPoint)),
            kind,
            filesystemType: typeof entry.filesystemType === 'string' ? entry.filesystemType : null,
            freeBytes: publishedFreeBytes(nonNegativeNumberOrNull(entry.freeBytes), totalBytes),
            totalBytes,
        });
    });
    dropHomeOnRootDevice(rowsByMountPoint, entriesByMountPoint);
    return [...rowsByMountPoint.values()].sort(compareMountRows);
}
