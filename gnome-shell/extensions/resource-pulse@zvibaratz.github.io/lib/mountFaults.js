// Which mounts are at fault: one whose size query failed or did not answer, on any kind of mount, and never an
// automount point with nothing mounted on it. The one rule for every part that says so: the Connections tile's
// "no answer" and its order, and the Mount caption.
//
// The shell alone loads this module: the cockpit service, which loads lib/cockpitProtocol.js, never does, so a change
// here restarts no service.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {MOUNT_SIZE_FAULT_REASONS} from './cockpitProtocol.js';

/** An automount point's filesystem type: no fault whatever its reason (lib/cockpitProtocol.js). */
const AUTOMOUNT_FILESYSTEM_TYPE = 'autofs';

/**
 * Whether a mount is at fault: its size query failed or did not answer (MOUNT_SIZE_FAULT_REASONS), on any kind of
 * mount, and it is no automount point. A reason that is no fault, a row with both sizes, and a row from a service
 * older than the reason (no such field) are no fault.
 *
 * @param {{noSizesReason?: string|null, filesystemType?: string|null}} mountRow - A mount row, as the reader gives
 *     one.
 * @returns {boolean} True when the mount is at fault.
 */
export function isMountSizeFault(mountRow) {
    const isFaultReason = MOUNT_SIZE_FAULT_REASONS.includes(mountRow.noSizesReason);
    return isFaultReason && mountRow.filesystemType !== AUTOMOUNT_FILESYSTEM_TYPE;
}
