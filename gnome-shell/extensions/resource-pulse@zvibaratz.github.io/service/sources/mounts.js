// The mounts source's IO: the mount table from GioUnix, each row's free and total size from an asynchronous
// filesystem query bounded by FILESYSTEM_QUERY_TIMEOUT_MS, and GioUnix's mount monitor for changes, gathered for
// lib/mounts.js. Every read is injectable; the defaults are the real ones.
//
// GioUnix, not Gio: gjs 1.88 warns that Gio.unix_mounts_get and Gio.UnixMountMonitor moved there. There is no Gio
// fallback, and none is needed: metadata.json supports GNOME Shell 50 only, whose GLib ships gi://GioUnix, so every
// supported version has it. The namespace functions (mount_get_mount_path and the rest) are used rather than the
// entry's methods, which only GLib 2.84 and later expose.
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

import {FILESYSTEM_QUERY_TIMEOUT_MS} from '../../lib/constants.js';
import {mountRowsFrom} from '../../lib/mounts.js';

/** The source's name, as COCKPIT_SOURCE_NAMES lists it. */
const SOURCE_NAME = 'mounts';
const FILESYSTEM_FREE_ATTRIBUTE = 'filesystem::free';
const FILESYSTEM_SIZE_ATTRIBUTE = 'filesystem::size';
const FILESYSTEM_SIZE_ATTRIBUTES = `${FILESYSTEM_FREE_ATTRIBUTE},${FILESYSTEM_SIZE_ATTRIBUTE}`;
/** GioUnix.MountMonitor's signal for a change to the mount table. */
const MOUNTS_CHANGED_SIGNAL = 'mounts-changed';
/** A row's sizes before its query answers, and for a mount that makes no row. */
const UNKNOWN_SIZES = Object.freeze({freeBytes: null, totalBytes: null, noSizesReason: null});
/** noSizesReason's words (MOUNT_NO_SIZES_REASONS in lib/cockpitProtocol.js), by what became of the query. */
const QUERY_FAILED_REASON = 'query-failed';
const NO_ANSWER_REASON = 'no-answer';
const NOT_REPORTED_REASON = 'not-reported';

/**
 * A filesystem query that did not answer: not within its timeout, or not yet the mount point's last one, which still
 * runs. The mounts source tells it from a query that failed.
 */
export class FilesystemQueryNoAnswerError extends Error {
    /** @param {string} message - What did not answer, and for how long. */
    constructor(message) {
        super(message);
        this.name = 'FilesystemQueryNoAnswerError';
    }
}
/** The interval the source writes; the scheduler stamps the effective one over it. */
const PLACEHOLDER_INTERVAL_SECONDS = 0;

/**
 * Reads the mount table.
 *
 * @returns {Array<{mountPoint: string, filesystemType: string, devicePath: string, label: string,
 *     isReadOnly: boolean}>} One entry per mount, as lib/mounts.js's mountRowsFrom takes them (without sizes); the
 *     label is GioUnix's guess at the mount's name, and isReadOnly the table's read-only flag.
 */
export function listUnixMountEntries() {
    const [mountEntries] = GioUnix.mounts_get();
    return mountEntries.map(mountEntry => ({
        mountPoint: GioUnix.mount_get_mount_path(mountEntry),
        filesystemType: GioUnix.mount_get_fs_type(mountEntry),
        devicePath: GioUnix.mount_get_device_path(mountEntry),
        label: GioUnix.mount_guess_name(mountEntry),
        isReadOnly: GioUnix.mount_is_readonly(mountEntry),
    }));
}

/**
 * @param {Gio.FileInfo} fileInfo - A filesystem query's answer.
 * @param {string} attributeName - A filesystem attribute.
 * @returns {number|null} The attribute's value; null when the filesystem did not report it.
 */
function uint64AttributeOrNull(fileInfo, attributeName) {
    return fileInfo.has_attribute(attributeName) ? fileInfo.get_attribute_uint64(attributeName) : null;
}

/**
 * Makes the real filesystem query: free and total bytes of the filesystem at a mount point, asynchronously, given up
 * after timeoutMs (its cancellable cancelled). Gio runs such a query on a worker thread that a hung network share can
 * block whatever the cancellable says, so a mount point whose previous query has not finished is not queried again:
 * at most one worker per hung share.
 *
 * @param {object} [options] - The bound.
 * @param {number} [options.timeoutMs] - Milliseconds before a query is given up.
 * @returns {(mountPoint: string) => Promise<{freeBytes: number|null, totalBytes: number|null}>} The query; it
 *     rejects with a FilesystemQueryNoAnswerError when it does not answer within timeoutMs and when the mount point's
 *     previous query is still running, and with Gio's error when the filesystem cannot be queried.
 */
export function createFilesystemSizeQuery({timeoutMs = FILESYSTEM_QUERY_TIMEOUT_MS} = {}) {
    const mountPointsWithQueryRunning = new Set();
    return mountPoint => {
        if (mountPointsWithQueryRunning.has(mountPoint))
            return Promise.reject(new FilesystemQueryNoAnswerError(
                `filesystem query of ${mountPoint}: the previous one is still running`));
        mountPointsWithQueryRunning.add(mountPoint);
        return new Promise((resolve, reject) => {
            const cancellable = new Gio.Cancellable();
            let timeoutSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
                timeoutSourceId = null;
                cancellable.cancel();
                reject(new FilesystemQueryNoAnswerError(
                    `filesystem query of ${mountPoint}: no answer within ${timeoutMs} ms`));
                return GLib.SOURCE_REMOVE;
            });
            Gio.File.new_for_path(mountPoint).query_filesystem_info_async(FILESYSTEM_SIZE_ATTRIBUTES,
                GLib.PRIORITY_DEFAULT, cancellable, (file, result) => {
                    mountPointsWithQueryRunning.delete(mountPoint);
                    if (timeoutSourceId !== null) {
                        GLib.source_remove(timeoutSourceId);
                        timeoutSourceId = null;
                    }
                    let fileInfo;
                    try {
                        fileInfo = file.query_filesystem_info_finish(result);
                    } catch (error) {
                        // After a timeout the promise has already rejected, and this second settle is a no-op.
                        reject(error);
                        return;
                    }
                    resolve({
                        freeBytes: uint64AttributeOrNull(fileInfo, FILESYSTEM_FREE_ATTRIBUTE),
                        totalBytes: uint64AttributeOrNull(fileInfo, FILESYSTEM_SIZE_ATTRIBUTE),
                    });
                });
        });
    };
}

/** The mounts source: the local disks, network shares and removable disks, with their sizes. */
export class MountsSource {
    /**
     * @param {object} [dependencies] - The IO; each defaults to the real one.
     * @param {{connect: Function, disconnect: Function}} [dependencies.mountMonitor] - GioUnix.MountMonitor's
     *     singleton, or a fake emitting 'mounts-changed'.
     * @param {(mountPoint: string) => Promise<{freeBytes: number|null, totalBytes: number|null}>}
     *     [dependencies.queryFilesystem] - A mount's sizes; rejects when they cannot be read in time.
     * @param {() => Array<object>} [dependencies.listMountEntries] - The mount table, as listUnixMountEntries gives
     *     it.
     * @param {() => number} [dependencies.nowUsec] - Wall-clock microseconds; the placeholder sampledAtUsec.
     */
    constructor({
        mountMonitor = GioUnix.MountMonitor.get(),
        queryFilesystem = createFilesystemSizeQuery(),
        listMountEntries = listUnixMountEntries,
        nowUsec = () => GLib.get_real_time(),
    } = {}) {
        this._mountMonitor = mountMonitor;
        this._queryFilesystem = queryFilesystem;
        this._listMountEntries = listMountEntries;
        this._nowUsec = nowUsec;
        this._mountsChangedHandlerId = null;
    }

    /** @returns {string} 'mounts'. */
    get name() {
        return SOURCE_NAME;
    }

    /**
     * Samples the mounts. Only the mounts that make rows are queried for sizes, all at once; a query that fails or
     * times out leaves that row's sizes null, and its noSizesReason says which.
     *
     * @returns {Promise<object>} The source in parseMountsSource's shape; sampledAtUsec and intervalSeconds are
     *     placeholders the scheduler overwrites.
     * @throws {Error} (as a rejection) When the mount table cannot be read.
     */
    async sample() {
        const sampledAtUsec = this._nowUsec();
        const mountEntries = this._listMountEntries();
        // lib/mounts.js's own filter picks which mounts to query, so a mount that makes no row (/boot, /proc, a snap)
        // is never asked for its sizes. A local disk goes through the same bounded query as a share, so even a stalled
        // one cannot hold the sample past FILESYSTEM_QUERY_TIMEOUT_MS.
        const rowMountPoints = new Set(mountRowsFrom(mountEntries).map(row => row.mountPoint));
        const sizesEntries = await Promise.all([...rowMountPoints].map(async mountPoint =>
            [mountPoint, await this._querySizesOrUnknown(mountPoint)]));
        const sizesByMountPoint = new Map(sizesEntries);
        const sizedMountEntries = mountEntries.map(mountEntry =>
            ({...mountEntry, ...(sizesByMountPoint.get(mountEntry.mountPoint) ?? UNKNOWN_SIZES)}));
        return {
            sampledAtUsec,
            intervalSeconds: PLACEHOLDER_INTERVAL_SECONDS,
            rows: mountRowsFrom(sizedMountEntries),
        };
    }

    /**
     * Calls onChange whenever the mount table changes.
     *
     * @param {() => void} onChange - Called with no arguments.
     * @returns {void}
     */
    watchChanges(onChange) {
        if (this._mountsChangedHandlerId !== null)
            return;
        this._mountsChangedHandlerId = this._mountMonitor.connect(MOUNTS_CHANGED_SIGNAL, () => onChange());
    }

    /**
     * Disconnects from the mount monitor. Safe twice.
     *
     * @returns {void}
     */
    destroy() {
        if (this._mountsChangedHandlerId === null)
            return;
        this._mountMonitor.disconnect(this._mountsChangedHandlerId);
        this._mountsChangedHandlerId = null;
    }

    /**
     * @param {string} mountPoint - A mount that makes a row.
     * @returns {Promise<{freeBytes: number|null, totalBytes: number|null, noSizesReason: string|null}>} Its sizes,
     *     and why a size is null: no-answer for a FilesystemQueryNoAnswerError, query-failed for any other rejection,
     *     not-reported for an answer without both sizes; null when both are known.
     */
    async _querySizesOrUnknown(mountPoint) {
        let sizes;
        try {
            sizes = await this._queryFilesystem(mountPoint);
        } catch (error) {
            // A share that is down or hung still shows as a row, without its sizes, saying which it is.
            const isNoAnswer = error instanceof FilesystemQueryNoAnswerError;
            const noSizesReason = isNoAnswer ? NO_ANSWER_REASON : QUERY_FAILED_REASON;
            return {freeBytes: null, totalBytes: null, noSizesReason};
        }
        const freeBytes = sizes?.freeBytes ?? null;
        const totalBytes = sizes?.totalBytes ?? null;
        const areSizesReported = freeBytes !== null && totalBytes !== null;
        return {freeBytes, totalBytes, noSizesReason: areSizesReported ? null : NOT_REPORTED_REASON};
    }
}
