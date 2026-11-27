// lib/connectionsLinks.js: what each link of the Connections tile says, in which ink, and the mounts' order, from
// synthetic network and mounts sources as the reader gives them.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as connectionsLinks from '../extensions/resource-pulse@zvibaratz.github.io/lib/connectionsLinks.js';
import {connectionsRows} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitFormat.js';
import {
    CONNECTIVITY_STATES, MOUNT_NO_SIZES_REASONS,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitProtocol.js';

const GIBIBYTE_BYTES = 1024 * 1024 * 1024;
const {PRIMARY, QUIET, UP, DOWN, CAUTION} = connectionsLinks.LinkInk;

/**
 * @param {object} [fields] - The network source's fields that differ from a wired link reaching the internet, the VPN
 *     down and two SSH masters.
 * @returns {object} A network source.
 */
function network(fields = {}) {
    return {
        sampledAtUsec: 1, intervalSeconds: 10,
        uplink: {kind: 'wired', connectivity: 'full', wifiEnabled: true},
        vpn: {isUp: false, interfaceName: null},
        sshMasterCount: 2,
        ...fields,
    };
}

/**
 * @param {object} fields - The fields that differ from a network share with both sizes.
 * @returns {object} A mount row.
 */
function mount(fields) {
    return {
        mountPoint: `/mnt/${fields.label}`, kind: 'network', filesystemType: 'nfs4', freeBytes: 212 * GIBIBYTE_BYTES,
        totalBytes: 500 * GIBIBYTE_BYTES, noSizesReason: null, ...fields,
    };
}

/**
 * @param {Array<object>} rows - The mounts' rows, as published.
 * @returns {object} A mounts source.
 */
function mounts(rows) {
    return {sampledAtUsec: 1, intervalSeconds: 30, rows};
}

/**
 * @param {object} link - A link.
 * @returns {Array<*>} Its name, its two details and its three inks.
 */
function words(link) {
    return [link.name, link.listDetail, link.lineDetail, link.iconInk, link.nameInk, link.detailInk];
}

/**
 * @param {object} uplink - The uplink's fields.
 * @returns {Array<*>} The uplink link's words and inks.
 */
function uplinkWords(uplink) {
    return words(connectionsLinks.connectionsLinks(network({uplink}), mounts([])).uplink);
}

test('connectionsLinks: a wired or Wi-Fi link by every verdict: its kind; limited and portal in plain words; none ' +
    'an amber "no internet", its icon alone in the line', () =>
    assertEqual(['wired', 'wifi'].map(kind => CONNECTIVITY_STATES.map(connectivity =>
        uplinkWords({kind, connectivity, wifiEnabled: true}))), [
        [
            ['Wired', '', '', PRIMARY, PRIMARY, QUIET], ['Wired', 'limited', '', PRIMARY, PRIMARY, QUIET],
            ['Wired', 'portal', '', PRIMARY, PRIMARY, QUIET], ['Wired', 'no internet', '', CAUTION, PRIMARY, CAUTION],
            ['Wired', '', '', PRIMARY, PRIMARY, QUIET],
        ],
        [
            ['Wi-Fi', '', '', PRIMARY, PRIMARY, QUIET], ['Wi-Fi', 'limited', '', PRIMARY, PRIMARY, QUIET],
            ['Wi-Fi', 'portal', '', PRIMARY, PRIMARY, QUIET], ['Wi-Fi', 'no internet', '', CAUTION, PRIMARY, CAUTION],
            ['Wi-Fi', '', '', PRIMARY, PRIMARY, QUIET],
        ],
    ]));

test('connectionsLinks: a wired or Wi-Fi link with no verdict (null) reads its kind alone', () =>
    assertEqual(uplinkWords({kind: 'wifi', connectivity: null, wifiEnabled: true}),
        ['Wi-Fi', '', '', PRIMARY, PRIMARY, QUIET]));

test('connectionsLinks: a wired link with Wi-Fi turned off says so, unless the internet is out of reach; a Wi-Fi ' +
    'link never does', () =>
    assertEqual([
        uplinkWords({kind: 'wired', connectivity: 'full', wifiEnabled: false}),
        uplinkWords({kind: 'wired', connectivity: 'none', wifiEnabled: false}),
        uplinkWords({kind: 'wifi', connectivity: 'full', wifiEnabled: false}),
    ], [
        ['Wired', 'Wi-Fi off', '', PRIMARY, PRIMARY, QUIET],
        ['Wired', 'no internet', '', CAUTION, PRIMARY, CAUTION],
        ['Wi-Fi', '', '', PRIMARY, PRIMARY, QUIET],
    ]));

test('connectionsLinks: no wired or Wi-Fi link (kind none, or none known): "Offline" in amber for a verdict of ' +
    'none, "Online" while reachable, "Uplink unknown" with no verdict', () =>
    assertEqual(['none', null].map(kind => CONNECTIVITY_STATES.concat([null]).map(connectivity =>
        uplinkWords({kind, connectivity, wifiEnabled: null}))), [
        [
            ['Online', '', '', PRIMARY, PRIMARY, QUIET], ['Online', 'limited', '', PRIMARY, PRIMARY, QUIET],
            ['Online', 'portal', '', PRIMARY, PRIMARY, QUIET], ['Offline', '', '', CAUTION, CAUTION, QUIET],
            ['Uplink', 'unknown', '', QUIET, PRIMARY, QUIET], ['Uplink', 'unknown', '', QUIET, PRIMARY, QUIET],
        ],
        [
            ['Online', '', '', PRIMARY, PRIMARY, QUIET], ['Online', 'limited', '', PRIMARY, PRIMARY, QUIET],
            ['Online', 'portal', '', PRIMARY, PRIMARY, QUIET], ['Offline', '', '', CAUTION, CAUTION, QUIET],
            ['Uplink', 'unknown', '', QUIET, PRIMARY, QUIET], ['Uplink', 'unknown', '', QUIET, PRIMARY, QUIET],
        ],
    ]));

test('connectionsLinks: only a verdict of none is a caution', () =>
    assertEqual(CONNECTIVITY_STATES.map(connectivity => connectionsLinks.connectionsLinks(
        network({uplink: {kind: 'wifi', connectivity, wifiEnabled: true}}), mounts([])).uplink.isCaution),
    [false, false, false, true, false]));

test('connectionsLinks: the VPN: its interface in teal while up ("up" with none named), "down" and "unknown" in ' +
    'grey', () =>
    assertEqual([
        {isUp: true, interfaceName: 'tun0'}, {isUp: true, interfaceName: null}, {isUp: false, interfaceName: null},
        {isUp: null, interfaceName: null},
    ].map(vpn => words(connectionsLinks.connectionsLinks(network({vpn}), mounts([])).vpn)), [
        ['VPN', 'tun0', 'tun0', UP, PRIMARY, UP], ['VPN', 'up', 'up', UP, PRIMARY, UP],
        ['VPN', 'down', 'down', DOWN, PRIMARY, QUIET], ['VPN', 'unknown', 'unknown', DOWN, PRIMARY, QUIET],
    ]));

test('connectionsLinks: the SSH masters: 0, 1 and many in the list\'s words and the line\'s count; unknown in both',
    () => assertEqual([0, 1, 5, null].map(sshMasterCount =>
        words(connectionsLinks.connectionsLinks(network({sshMasterCount}), mounts([])).ssh)), [
        ['SSH', '0 masters', '0', PRIMARY, PRIMARY, QUIET], ['SSH', '1 master', '1', PRIMARY, PRIMARY, QUIET],
        ['SSH', '5 masters', '5', PRIMARY, PRIMARY, QUIET], ['SSH', 'unknown', 'unknown', PRIMARY, PRIMARY, QUIET],
    ]));

test('connectionsLinks: a mount at fault reads "no answer" in amber, its icon amber and its bar unknown; the line ' +
    'shows its amber icon alone', () => {
    const [link] = connectionsLinks.connectionsLinks(network(),
        mounts([mount({label: 'backup', freeBytes: null, totalBytes: null, noSizesReason: 'no-answer'})])).mounts;
    assertEqual([...words(link), link.isCaution, link.usedFraction],
        ['backup', 'no answer', '', CAUTION, PRIMARY, CAUTION, true, null]);
});

test('connectionsLinks: every reason a mount has no sizes, and none (an older service): only a fault says "no ' +
    'answer"; the others read the label alone, with an unknown bar', () =>
    assertEqual(MOUNT_NO_SIZES_REASONS.concat([null]).map(noSizesReason => {
        const [link] = connectionsLinks.connectionsLinks(network(),
            mounts([mount({label: 'share', freeBytes: null, totalBytes: null, noSizesReason})])).mounts;
        return [link.listDetail, link.iconInk, link.isCaution, link.usedFraction];
    }), [
        ['no answer', CAUTION, true, null], ['no answer', CAUTION, true, null], ['', QUIET, false, null],
        ['', QUIET, false, null], ['', QUIET, false, null],
    ]));

test('connectionsLinks: an autofs mount point that does not answer is no fault: its label alone', () => {
    const [link] = connectionsLinks.connectionsLinks(network(), mounts([mount({
        label: 'auto', filesystemType: 'autofs', freeBytes: null, totalBytes: null, noSizesReason: 'no-answer',
    })])).mounts;
    assertEqual([link.listDetail, link.isCaution], ['', false]);
});

test('connectionsLinks: a mount with sizes: its free space in the list and the line, its used share for its bar, ' +
    'its icon by kind', () => {
    const links = connectionsLinks.connectionsLinks(network(), mounts([
        mount({label: '/', kind: 'local', freeBytes: 212 * GIBIBYTE_BYTES, totalBytes: 848 * GIBIBYTE_BYTES}),
        mount({label: 'SCRATCH', kind: 'removable'}),
        mount({label: 'nas', kind: 'network'}),
    ])).mounts;
    assertEqual(links.map(link => [...words(link), link.usedFraction, link.iconName]), [
        ['/', '212G free', '212G', QUIET, PRIMARY, QUIET, 0.75, 'drive-harddisk-symbolic'],
        ['SCRATCH', '212G free', '212G', QUIET, PRIMARY, QUIET, 0.576, 'drive-removable-media-symbolic'],
        ['nas', '212G free', '212G', QUIET, PRIMARY, QUIET, 0.576, 'folder-remote-symbolic'],
    ]);
});

test('connectionsLinks: mounts are listed at fault first, then the local disks, then the rest, each in the order ' +
    'the service published them; two at fault keep theirs', () => {
    const atFault = {freeBytes: null, totalBytes: null, noSizesReason: 'query-failed'};
    const links = connectionsLinks.connectionsLinks(network(), mounts([
        mount({label: 'usb', kind: 'removable'}),
        mount({label: '/', kind: 'local'}),
        mount({label: 'nas-b', ...atFault}),
        mount({label: '/home', kind: 'local'}),
        mount({label: 'nas-a', ...atFault}),
        mount({label: 'nas-c'}),
    ])).mounts;
    assertEqual(links.map(link => link.name), ['nas-b', 'nas-a', '/', '/home', 'usb', 'nas-c']);
});

test('connectionsLinks: a local disk at fault is listed first and in amber, as any mount at fault', () => {
    const links = connectionsLinks.connectionsLinks(network(), mounts([
        mount({label: 'nas'}),
        mount({label: '/', kind: 'local', freeBytes: null, totalBytes: null, noSizesReason: 'no-answer'}),
    ])).mounts;
    assertEqual(links.map(link => [link.name, link.isCaution]), [['/', true], ['nas', false]]);
});

test('connectionsLinks: every link\'s tooltip is the connections card\'s, the mounts\' following them to their ' +
    'place in the listing', () => {
    const net = network({vpn: {isUp: true, interfaceName: 'tun0'}});
    const source = mounts([
        mount({label: 'usb', kind: 'removable'}),
        mount({label: 'nas', freeBytes: null, totalBytes: null, noSizesReason: 'no-answer'}),
    ]);
    const links = connectionsLinks.connectionsLinks(net, source);
    const cardRows = connectionsRows(net, source, {limit: Number.POSITIVE_INFINITY}).rows;
    assertEqual([links.uplink, links.vpn, links.ssh, ...links.mounts].map(link => link.tooltipLines),
        [cardRows[0], cardRows[1], cardRows[2], cardRows[4], cardRows[3]].map(row => row.tooltip));
});

test('connectionsLinks: each link\'s icon is the connections card\'s', () => {
    const links = connectionsLinks.connectionsLinks(
        network({uplink: {kind: 'wired', connectivity: 'none', wifiEnabled: true}}), mounts([]));
    assertEqual([links.uplink.iconName, links.vpn.iconName, links.ssh.iconName],
        ['network-offline-symbolic', 'network-vpn-symbolic', 'utilities-terminal-symbolic']);
});

test('connectionsLinks: the tile draws both sources only with the uplink, the VPN and the mounts\' rows, as the ' +
    'connections card', () =>
    assertEqual([
        connectionsLinks.canDrawConnectionsTile(network(), mounts([])),
        connectionsLinks.canDrawConnectionsTile(null, mounts([])),
        connectionsLinks.canDrawConnectionsTile(network({uplink: null}), mounts([])),
        connectionsLinks.canDrawConnectionsTile(network(), {rows: null}),
    ], [true, false, false, false]));

test('connectionsLinks: no mount gives no mount links', () =>
    assertEqual(connectionsLinks.connectionsLinks(network(), mounts([])).mounts, []));

test('connectionsLinks: the "+N more" line counts the mounts left out, and is empty for none', () =>
    assertEqual([0, 1, 8, -1].map(hiddenCount => connectionsLinks.moreLineText(hiddenCount)),
        ['', '+1 more', '+8 more', '']));

test('connectionsLinks: the no-data line is the connections card\'s words', () =>
    assertEqual(connectionsLinks.connectionsNoDataText(), 'no data'));
