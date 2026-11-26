// lib/mounts.js: the local disk, network and removable mount rows, from synthetic mount entries.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as mounts from '../extensions/resource-pulse@zvibaratz.github.io/lib/mounts.js';
import * as cockpitProtocol from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitProtocol.js';
import {COCKPIT_REDACTED_NAME} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';
import {formatGibibytes} from '../extensions/resource-pulse@zvibaratz.github.io/lib/format.js';
import {connectionsRows} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitFormat.js';

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
test('mounts: /home is a local disk where it is a filesystem of its own, on a device other than /\'s; a mount under ' +
    'it, or under /, is not', () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/home', filesystemType: 'ext4', devicePath: '/dev/nvme0n1p3', label: 'home'}),
        entry({mountPoint: '/home/user/scratch', filesystemType: 'ext4', devicePath: '/dev/sdc1'}),
        entry({mountPoint: '/var', filesystemType: 'xfs', devicePath: '/dev/nvme0n1p4'}),
        entry({mountPoint: '/', filesystemType: 'ext4', devicePath: '/dev/nvme0n1p2', label: 'Filesystem root'}),
    ]);
    assertEqual(rows.map(r => [r.mountPoint, r.kind, r.label]), [['/', 'local', 'Filesystem root'], ['/home', 'local', 'home']]);
});
test('mounts: /home on /\'s own device (two btrfs subvolumes of one device, or a directory of / bind-mounted there) ' +
    'makes no row of its own: it would repeat /\'s free space', () => {
    const rowsOf = (filesystemType, rootDevicePath, homeDevicePath) => mounts.mountRowsFrom([
        entry({mountPoint: '/', filesystemType, devicePath: rootDevicePath, label: 'Filesystem root'}),
        entry({mountPoint: '/home', filesystemType, devicePath: homeDevicePath, label: 'home'}),
    ]).map(r => r.mountPoint);
    assertEqual({
        subvolumes: rowsOf('btrfs', '/dev/nvme0n1p3', '/dev/nvme0n1p3'),
        bindMount: rowsOf('ext4', '/dev/sda2', '/dev/sda2'),
        ownDevice: rowsOf('btrfs', '/dev/nvme0n1p3', '/dev/nvme1n1p1'),
        shareAtHome: rowsOf('nfs4', 'nas:/export', 'nas:/export'),
    }, {subvolumes: ['/'], bindMount: ['/'], ownDevice: ['/', '/home'], shareAtHome: ['/', '/home']});
});
test('mounts: an automount point (autofs) is no row, being a mount point waiting for a mount, with no sizes: a lone ' +
    'one at /home, or one under /mnt/; the share mounted under it is a row', () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/', filesystemType: 'ext4', devicePath: '/dev/nvme0n1p2', label: 'Filesystem root'}),
        entry({mountPoint: '/home', filesystemType: 'autofs', devicePath: 'auto.home', freeBytes: 0, totalBytes: 0}),
        entry({mountPoint: '/home/user', filesystemType: 'nfs4', devicePath: 'nas:/export/home/user'}),
        entry({mountPoint: '/mnt/auto', filesystemType: 'autofs', devicePath: 'systemd-1', freeBytes: 0,
            totalBytes: 0}),
    ]);
    assertEqual(rows.map(r => [r.mountPoint, r.kind]), [['/', 'local'], ['/home/user', 'network']]);
});
test('mounts: a local disk mounted read-only is no row, as nothing on it can fill (an image root); a read-only ' +
    'removable disk is still one', () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/', filesystemType: 'overlay', devicePath: 'composefs', isReadOnly: true}),
        entry({mountPoint: '/home', filesystemType: 'ext4', devicePath: '/dev/vda4', label: 'home', isReadOnly: false}),
        entry({mountPoint: '/media/user/DVD', filesystemType: 'iso9660', devicePath: '/dev/sr0', isReadOnly: true}),
    ]);
    assertEqual(rows.map(r => [r.mountPoint, r.kind]), [['/home', 'local'], ['/media/user/DVD', 'removable']]);
});
test('mounts: the local disks come first, then every other row by mount point, so no share sorted between / and ' +
    '/home pushes /home off the card', () => {
    const rows = mounts.mountRowsFrom([
        ...['/data/a', '/data/b', '/data/c', '/data/d'].map(mountPoint => entry({mountPoint, filesystemType: 'nfs4'})),
        entry({mountPoint: '/media/user/Disk'}),
        entry({mountPoint: '/home', devicePath: '/dev/sda2'}),
        entry({mountPoint: '/', devicePath: '/dev/sda1'}),
    ]);
    assertEqual(rows.map(r => r.mountPoint),
        ['/', '/home', '/data/a', '/data/b', '/data/c', '/data/d', '/media/user/Disk']);
});
test('mounts: a network filesystem mounted at / or /home is a network share, not a local disk', () => {
    const rows = mounts.mountRowsFrom([entry({mountPoint: '/', filesystemType: 'nfs4'}), entry({mountPoint: '/home', filesystemType: 'cifs'})]);
    assertEqual(rows.map(r => [r.mountPoint, r.kind]), [['/', 'network'], ['/home', 'network']]);
});
test('mounts: a mount point the table lists twice (a filesystem mounted over another) is one row, the last listed',
    () => {
    const rows = mounts.mountRowsFrom([
        entry({mountPoint: '/media/user/Disk', filesystemType: 'vfat', freeBytes: 1, totalBytes: 2}),
        entry({mountPoint: '/mnt/nas', filesystemType: 'nfs4', freeBytes: 3, totalBytes: 4}),
        entry({mountPoint: '/media/user/Disk', filesystemType: 'ext4', freeBytes: 5, totalBytes: 9}),
    ]);
    assertEqual(rows.map(r => [r.mountPoint, r.filesystemType, r.freeBytes]),
        [['/media/user/Disk', 'ext4', 5], ['/mnt/nas', 'nfs4', 3]]);
});
test('mounts: sizes are published as the card draws them, to a tenth of a GiB, so jitter inside a step publishes ' +
    'the same bytes and a move across one does not', () => {
    const freeBytesOf = gibibytes => mounts.mountRowsFrom([
        entry({freeBytes: Math.round(gibibytes * BYTES_PER_GIB), totalBytes: 500 * BYTES_PER_GIB}),
    ])[0].freeBytes;
    assertEqual({
        insideAStep: [freeBytesOf(100.01), freeBytesOf(100.02), freeBytesOf(100.0499)],
        acrossAStep: freeBytesOf(100.0501),
        isWholeBytes: Number.isInteger(freeBytesOf(100.0501)),
        exactStep: freeBytesOf(100) === 100 * BYTES_PER_GIB,
    }, {
        insideAStep: Array(3).fill(100 * BYTES_PER_GIB),
        acrossAStep: Math.round(100.1 * BYTES_PER_GIB),
        isWholeBytes: true,
        exactStep: true,
    });
});
test('mounts: the drawn text and tooltip are the same from the published sizes as from the exact ones, either side ' +
    'of a step, and a filesystem smaller than half a step keeps its exact total', () => {
    const network = {uplink: {kind: 'wired', connectivity: 'full', wifiEnabled: false},
        vpn: {isUp: false, interfaceName: null}, sshMasterCount: 0};
    const drawnMountOf = rows => connectionsRows(network, {rows}).rows.filter(row => row.kind === 'mount')
        .map(row => ({text: row.text, tooltip: row.tooltip}));
    const exactRows = [0.04, 99.9499, 99.9501, 100.05 - 1e-6, 100.05 + 1e-6].map((gibibytes, index) => ({
        mountPoint: `/media/user/D${index}`, label: `D${index}`, kind: 'removable', filesystemType: 'ext4',
        freeBytes: Math.round(gibibytes * BYTES_PER_GIB),
        totalBytes: index === 0 ? Math.round(0.04 * BYTES_PER_GIB) : Math.round(2000.04 * BYTES_PER_GIB),
    }));
    const publishedRows = mounts.mountRowsFrom(exactRows.map(row => ({...row, devicePath: '/dev/sdz'})));
    assertEqual({
        drawn: drawnMountOf(publishedRows),
        tinyTotalKept: publishedRows[0].totalBytes === exactRows[0].totalBytes,
        sameAsFormat: publishedRows.every((row, index) =>
            formatGibibytes(row.freeBytes) === formatGibibytes(exactRows[index].freeBytes)),
    }, {drawn: drawnMountOf(exactRows), tinyTotalKept: true, sameAsFormat: true});
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
