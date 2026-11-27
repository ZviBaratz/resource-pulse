// lib/mountFaults.js: which mounts are at fault, from mount rows as the reader gives them.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as mountFaults from '../extensions/resource-pulse@zvibaratz.github.io/lib/mountFaults.js';
import {
    MOUNT_KINDS, MOUNT_NO_SIZES_REASONS,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitProtocol.js';

/**
 * @param {object} fields - The fields that differ from a network share with no sizes.
 * @returns {object} A mount row, as the reader gives one.
 */
function mountRow(fields) {
    return {
        mountPoint: '/mnt/share', label: 'share', kind: 'network', filesystemType: 'nfs4', freeBytes: null,
        totalBytes: null, noSizesReason: null, ...fields,
    };
}

test('mountFaults: a query that failed or did not answer is a fault; a size not reported or not permitted is not',
    () => assertEqual(Object.fromEntries(MOUNT_NO_SIZES_REASONS.map(noSizesReason =>
        [noSizesReason, mountFaults.isMountSizeFault(mountRow({noSizesReason}))])), {
        'query-failed': true, 'no-answer': true, 'not-reported': false, 'not-permitted': false,
    }));

test('mountFaults: a mount with both sizes (no reason) is no fault', () =>
    assertEqual(mountFaults.isMountSizeFault(mountRow({freeBytes: 1, totalBytes: 2})), false));

test('mountFaults: an autofs mount point is no fault, whatever its reason', () =>
    assertEqual(MOUNT_NO_SIZES_REASONS.map(noSizesReason =>
        mountFaults.isMountSizeFault(mountRow({filesystemType: 'autofs', noSizesReason}))),
    [false, false, false, false]));

test('mountFaults: a fault counts on every kind of mount, a local disk included', () =>
    assertEqual(MOUNT_KINDS.map(kind => mountFaults.isMountSizeFault(mountRow({kind, noSizesReason: 'no-answer'}))),
        [true, true, true]));

test('mountFaults: a row from a service older than the reason (no such field) is no fault', () => {
    const {noSizesReason: _leftOut, ...olderRow} = mountRow({});
    assertEqual(mountFaults.isMountSizeFault(olderRow), false);
});

test('mountFaults: a row with no filesystem type and a fault reason is a fault', () =>
    assertEqual(mountFaults.isMountSizeFault(mountRow({filesystemType: null, noSizesReason: 'query-failed'})), true));

test('mountFaults: a row that is no object (null, missing, a string) is no fault, and never a throw', () =>
    assertEqual([null, undefined, 'abc'].map(notARow => mountFaults.isMountSizeFault(notARow)), [false, false, false]));
