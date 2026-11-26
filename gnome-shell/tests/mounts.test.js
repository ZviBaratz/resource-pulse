// lib/mounts.js: the local disk, network and removable mount rows, from synthetic mount entries.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as mounts from '../extensions/resource-pulse@zvibaratz.github.io/lib/mounts.js';
import * as cockpitProtocol from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitProtocol.js';
import {COCKPIT_REDACTED_NAME} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

const SAMPLED_AT_USEC = 1;
const INTERVAL_SECONDS = 30;
const BYTES_PER_GIB = 1024 ** 3;

/**
 * @param {object} overrides - The fields that differ from a removable ext4 disk.
 * @returns {object} A mount entry.
 */
function entry(overrides) {
    return {mountPoint: '/media/user/Disk', filesystemType: 'ext4', devicePath: '/dev/sdb1', label: null, freeBytes: 1, totalBytes: 2, ...overrides};
}

test('mounts: the root filesystem, network shares and removable disks are kept, the rest dropped, labels guarded', () => {
    const rows = mounts.mountRowsFrom([
        {mountPoint: '/', filesystemType: 'ext4', devicePath: '/dev/nvme0n1p2', label: 'Filesystem root', freeBytes: 1, totalBytes: 2},
        {mountPoint: '/boot/efi', filesystemType: 'vfat', devicePath: '/dev/nvme0n1p1', label: 'efi', freeBytes: 1, totalBytes: 2},
        {mountPoint: '/media/user/Data', filesystemType: 'ext4', devicePath: '/dev/sda1', label: 'Data', freeBytes: 10, totalBytes: 20},
        {mountPoint: '/mnt/nas', filesystemType: 'cifs', devicePath: '//nas/share', label: null, freeBytes: null, totalBytes: null},
    ]);
    assertEqual(rows.map(r => [r.kind, r.label]), [['local', 'Filesystem root'], ['removable', 'Data'], ['network', 'nas']]);
});
test('mounts: /home is a local disk where it is a filesystem of its own; a mount under it, or under /, is not', () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/home', filesystemType: 'btrfs', label: 'home'}),
        entry({mountPoint: '/home/user/scratch', filesystemType: 'ext4'}),
        entry({mountPoint: '/var', filesystemType: 'xfs'}),
        entry({mountPoint: '/', filesystemType: 'btrfs', label: 'Filesystem root'}),
    ]);
    assertEqual(rows.map(r => [r.mountPoint, r.kind, r.label]), [['/', 'local', 'Filesystem root'], ['/home', 'local', 'home']]);
});
test('mounts: a network filesystem mounted at / or /home is a network share, not a local disk', () => {
    const rows = mounts.mountRowsFrom([entry({mountPoint: '/', filesystemType: 'nfs4'}), entry({mountPoint: '/home', filesystemType: 'cifs'})]);
    assertEqual(rows.map(r => [r.mountPoint, r.kind]), [['/', 'network'], ['/home', 'network']]);
});
test('mounts: a mount point the table lists twice (an automount under its filesystem) is one row, the last listed', () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/home', filesystemType: 'autofs', freeBytes: 0, totalBytes: 0}),
        entry({mountPoint: '/media/user/Disk', filesystemType: 'ext4', freeBytes: 1, totalBytes: 2}),
        entry({mountPoint: '/home', filesystemType: 'ext4', freeBytes: 5, totalBytes: 9}),
    ]);
    assertEqual(rows.map(r => [r.mountPoint, r.filesystemType, r.freeBytes]), [['/home', 'ext4', 5], ['/media/user/Disk', 'ext4', 1]]);
});
test('mounts: a row has exactly the reader fields in the reader order, sizes passed through', () => {
    const rows = mounts.mountRowsFrom([entry({label: 'Data', freeBytes: BYTES_PER_GIB, totalBytes: 2 * BYTES_PER_GIB})]);
    assertEqual(rows, [{mountPoint: '/media/user/Disk', label: 'Data', kind: 'removable', filesystemType: 'ext4', freeBytes: BYTES_PER_GIB, totalBytes: 2 * BYTES_PER_GIB}]);
});
test('mounts: a network filesystem type wins over a removable mount point', () => {
    const rows = mounts.mountRowsFrom([entry({mountPoint: '/mnt/share', filesystemType: 'nfs4'})]);
    assertEqual(rows.map(r => r.kind), ['network']);
});
test('mounts: a network type anywhere is kept; every other mount outside the prefixes is dropped', () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/home/user/remote', filesystemType: 'fuse.sshfs'}),
        entry({mountPoint: '/boot/efi', filesystemType: 'vfat'}),
        entry({mountPoint: '/mntx/other'}),
        entry({mountPoint: '/run/media/user/Stick'}),
    ]);
    assertEqual(rows.map(r => r.mountPoint), ['/home/user/remote', '/run/media/user/Stick']);
});
test('mounts: rows sort by mount point and entries without a mount point are dropped', () => {
    const rows = mounts.mountRowsFrom([entry({mountPoint: '/mnt/b'}), entry({mountPoint: null}), entry({mountPoint: '/mnt/B'}), entry({mountPoint: '/mnt/a'})]);
    assertEqual(rows.map(r => r.mountPoint), ['/mnt/B', '/mnt/a', '/mnt/b']);
});
test('mounts: a missing or empty label falls back to the last segment, an unsafe label is redacted', () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/mnt/one', label: ''}),
        entry({mountPoint: '/mnt/two/', label: null}),
        entry({mountPoint: '/mnt/three', label: 'bad\u0007label'}),
    ]);
    assertEqual(rows.map(r => r.label), ['one', COCKPIT_REDACTED_NAME, 'two']);
});
test('mounts: negative or mistyped sizes become null, and a non-list is no rows', () => {
    const rows = mounts.mountRowsFrom([entry({freeBytes: -1, totalBytes: 'big'})]);
    assertEqual([rows[0].freeBytes, rows[0].totalBytes], [null, null]);
    assertEqual(mounts.mountRowsFrom(null), []);
});
test('mounts: the built rows round-trip through parseMountsSource', () => {
    const source = {
        sampledAtUsec: SAMPLED_AT_USEC,
        intervalSeconds: INTERVAL_SECONDS,
        rows: mounts.mountRowsFrom([entry({label: 'Data'}), entry({mountPoint: '/mnt/nas', filesystemType: 'cifs', freeBytes: null, totalBytes: null})]),
    };
    assertEqual(cockpitProtocol.parseMountsSource(source), source);
});
