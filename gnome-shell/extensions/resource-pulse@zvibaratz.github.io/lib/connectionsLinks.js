// What each link of the Connections tile says, and in which ink: the uplink, the VPN, the SSH masters and each mount,
// as a name and a detail, in the tile's list and in its one line; and the order the mounts are listed in. Decided
// here as pure functions, so the St glue (connectionsTile.js) only assigns finished values.
//
// - Only no internet at all is a caution (amber): a wired or Wi-Fi link's "no internet", or "Offline" with no link,
//   and a mount at fault (lib/mountFaults.js), which reads "no answer". "limited" and "portal" are steady states on
//   some networks, so they are plain words; a VPN that is down is grey, not amber.
// - In one line a link says the least: a caution is its amber icon alone, and the uplink its name.
// - A mount at fault is listed first, so a share that is down is seen; then the local disks; then the rest, each in
//   the order the service published them.
// - Each link's icon and tooltip are the connections card's (lib/cockpitFormat.js connectionsRows).
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {canDrawConnections, connectionsRows, noDataText} from './cockpitFormat.js';
import {formatWholeGibibytes} from './format.js';
import {isMountSizeFault} from './mountFaults.js';

/** The inks a link's icon, name and detail are drawn in; the tile gives each its colour (stylesheet.css). */
export const LinkInk = Object.freeze({
    PRIMARY: 'primary',
    QUIET: 'quiet',
    UP: 'up',
    DOWN: 'down',
    CAUTION: 'caution',
});

/** The uplink's name by the kind of link it is, for the two kinds it names. */
const LINKED_UPLINK_NAMES_BY_KIND = Object.freeze({wired: 'Wired', wifi: 'Wi-Fi'});
/** NetworkManager's verdicts that reach the internet only in part: said after the link's name, in plain words. */
const PARTIAL_CONNECTIVITY_STATES = Object.freeze(['limited', 'portal']);
/** NetworkManager's verdicts that reach the internet, fully or in part. */
const REACHABLE_CONNECTIVITY_STATES = Object.freeze(['full', ...PARTIAL_CONNECTIVITY_STATES]);
const NO_INTERNET_CONNECTIVITY = 'none';
const NO_INTERNET_TEXT = 'no internet';
const WIFI_OFF_TEXT = 'Wi-Fi off';
const OFFLINE_NAME = 'Offline';
const ONLINE_NAME = 'Online';
const UPLINK_NAME = 'Uplink';
const VPN_NAME = 'VPN';
const SSH_NAME = 'SSH';
const UNKNOWN_TEXT = 'unknown';
const VPN_UP_TEXT = 'up';
const VPN_DOWN_TEXT = 'down';
const MOUNT_NO_ANSWER_TEXT = 'no answer';
/** Where the uplink, the VPN and the SSH masters stand among the connections card's rows; the mounts follow them. */
const CARD_ROW_INDEX = Object.freeze({uplink: 0, vpn: 1, ssh: 2, firstMount: 3});
/** A mount's place in the listing, by what it is: lower is listed first. */
const MOUNT_LISTING_RANK = Object.freeze({atFault: 0, local: 1, other: 2});
const LOCAL_MOUNT_KIND = 'local';

/**
 * @typedef {object} ConnectionsLink One link of the tile, in either form.
 * @property {string} iconName - Its icon (the connections card's).
 * @property {string} iconInk - A LinkInk value.
 * @property {string} name - Its name.
 * @property {string} nameInk - A LinkInk value: PRIMARY, or CAUTION for "Offline".
 * @property {string} listDetail - What it says after its name in the list; '' for nothing.
 * @property {string} lineDetail - What it says after its name in the one line; '' for nothing.
 * @property {string} detailInk - A LinkInk value.
 * @property {boolean} isCaution - Whether it is a caution: no internet, or a mount at fault.
 * @property {boolean} isMount - Whether it is a mount, with a bar in the list.
 * @property {number|null} usedFraction - A mount's used share, 0 to 1, for its bar; null where its sizes are not
 *     known (its bar is drawn unknown), and for a link that is no mount.
 * @property {string[]} tooltipLines - Its tooltip (the connections card's).
 */

/**
 * The line under the named mounts: how many are left out.
 *
 * @param {number} hiddenCount - The mounts not named.
 * @returns {string} '+N more'; '' for none.
 */
export function moreLineText(hiddenCount) {
    return hiddenCount > 0 ? `+${hiddenCount} more` : '';
}

/**
 * The line the tile shows in place of its links: the connections card's words.
 *
 * @returns {string} 'no data'.
 */
export function connectionsNoDataText() {
    return noDataText(null, null);
}

/**
 * Whether the tile can draw the two sources: the uplink, the VPN and the mounts' rows, as the connections card needs
 * (lib/cockpitFormat.js canDrawConnections).
 *
 * @param {object|null|undefined} network - The network source.
 * @param {object|null|undefined} mounts - The mounts source.
 * @returns {boolean} True when the tile draws them.
 */
export function canDrawConnectionsTile(network, mounts) {
    return canDrawConnections(network, mounts);
}

/**
 * A link that is no mount, from its parts.
 *
 * @param {object} cardRow - Its row of the connections card: its icon and tooltip.
 * @param {object} parts - What differs from a plain link: name, details, inks, caution.
 * @returns {ConnectionsLink} The link.
 */
function linkOf(cardRow, parts) {
    return {
        iconName: cardRow.icon, iconInk: LinkInk.PRIMARY, nameInk: LinkInk.PRIMARY, listDetail: '', lineDetail: '',
        detailInk: LinkInk.QUIET, isCaution: false, isMount: false, usedFraction: null, tooltipLines: cardRow.tooltip,
        ...parts,
    };
}

/**
 * The uplink: a wired or Wi-Fi link by its kind, with "Wi-Fi off", "limited", "portal" or an amber "no internet"
 * after it; with no such link, "Offline" in amber for a verdict of none, "Online" while reachable, and "Uplink
 * unknown" with no verdict. In one line a caution is its amber icon alone, and every uplink its name.
 *
 * @param {{kind: string|null, connectivity: string|null, wifiEnabled: boolean|null}} uplink - The uplink.
 * @param {object} cardRow - The connections card's uplink row.
 * @returns {ConnectionsLink} The link.
 */
function uplinkLink(uplink, cardRow) {
    const linkedName = LINKED_UPLINK_NAMES_BY_KIND[uplink.kind] ?? null;
    const isNoInternet = uplink.connectivity === NO_INTERNET_CONNECTIVITY;
    const partialDetail = PARTIAL_CONNECTIVITY_STATES.includes(uplink.connectivity) ? uplink.connectivity : '';
    if (isNoInternet && linkedName !== null) {
        return linkOf(cardRow, {
            name: linkedName, iconInk: LinkInk.CAUTION, listDetail: NO_INTERNET_TEXT, detailInk: LinkInk.CAUTION,
            isCaution: true,
        });
    }
    if (isNoInternet) {
        return linkOf(cardRow, {
            name: OFFLINE_NAME, iconInk: LinkInk.CAUTION, nameInk: LinkInk.CAUTION, isCaution: true,
        });
    }
    if (linkedName !== null) {
        const isWiredWithWifiOff = uplink.kind === 'wired' && uplink.wifiEnabled === false;
        const wifiOffDetail = isWiredWithWifiOff ? WIFI_OFF_TEXT : '';
        return linkOf(cardRow, {name: linkedName, listDetail: partialDetail || wifiOffDetail});
    }
    if (REACHABLE_CONNECTIVITY_STATES.includes(uplink.connectivity))
        return linkOf(cardRow, {name: ONLINE_NAME, listDetail: partialDetail});
    return linkOf(cardRow, {name: UPLINK_NAME, iconInk: LinkInk.QUIET, listDetail: UNKNOWN_TEXT});
}

/**
 * The VPN: its interface in teal while up ("up" where none is named), "down" or "unknown" in grey otherwise.
 *
 * @param {{isUp: boolean|null, interfaceName: string|null}} vpn - The VPN state.
 * @param {object} cardRow - The connections card's VPN row.
 * @returns {ConnectionsLink} The link.
 */
function vpnLink(vpn, cardRow) {
    if (vpn.isUp === true) {
        const interfaceText = vpn.interfaceName || VPN_UP_TEXT;
        return linkOf(cardRow, {
            name: VPN_NAME, iconInk: LinkInk.UP, listDetail: interfaceText, lineDetail: interfaceText,
            detailInk: LinkInk.UP,
        });
    }
    const stateText = vpn.isUp === false ? VPN_DOWN_TEXT : UNKNOWN_TEXT;
    return linkOf(cardRow, {name: VPN_NAME, iconInk: LinkInk.DOWN, listDetail: stateText, lineDetail: stateText});
}

/**
 * The SSH masters: "N masters" in the list ("1 master"), the count alone in the line, "unknown" in both.
 *
 * @param {number|null} sshMasterCount - Live SSH control masters, or null when unknown.
 * @param {object} cardRow - The connections card's SSH row.
 * @returns {ConnectionsLink} The link.
 */
function sshLink(sshMasterCount, cardRow) {
    if (sshMasterCount === null || sshMasterCount === undefined)
        return linkOf(cardRow, {name: SSH_NAME, listDetail: UNKNOWN_TEXT, lineDetail: UNKNOWN_TEXT});
    const masterNoun = sshMasterCount === 1 ? 'master' : 'masters';
    return linkOf(cardRow, {
        name: SSH_NAME, listDetail: `${sshMasterCount} ${masterNoun}`, lineDetail: `${sshMasterCount}`,
    });
}

/**
 * A mount: at fault, "no answer" in amber with its bar unknown, its amber icon alone in the line; with its sizes, its
 * free space and its used share; with no sizes and no fault, its label alone, its bar unknown.
 *
 * @param {object} mountRow - A mount row.
 * @param {object} cardRow - The connections card's row for it.
 * @returns {ConnectionsLink} The link.
 */
function mountLink(mountRow, cardRow) {
    const mountParts = {name: mountRow.label, iconInk: LinkInk.QUIET, isMount: true};
    if (isMountSizeFault(mountRow)) {
        return linkOf(cardRow, {
            ...mountParts, iconInk: LinkInk.CAUTION, listDetail: MOUNT_NO_ANSWER_TEXT, detailInk: LinkInk.CAUTION,
            isCaution: true,
        });
    }
    const areSizesKnown = mountRow.freeBytes !== null && mountRow.totalBytes !== null && mountRow.totalBytes > 0;
    const freeText = mountRow.freeBytes === null ? '' : formatWholeGibibytes(mountRow.freeBytes);
    const usedFraction = areSizesKnown ? (mountRow.totalBytes - mountRow.freeBytes) / mountRow.totalBytes : null;
    return linkOf(cardRow, {
        ...mountParts,
        listDetail: freeText === '' ? '' : `${freeText} free`,
        lineDetail: freeText,
        usedFraction: usedFraction === null ? null : Math.min(1, Math.max(0, usedFraction)),
    });
}

/**
 * Where a mount stands in the listing: at fault first, then a local disk, then the rest.
 *
 * @param {object} mountRow - A mount row.
 * @returns {number} Its rank; lower is listed first.
 */
function mountListingRank(mountRow) {
    if (isMountSizeFault(mountRow))
        return MOUNT_LISTING_RANK.atFault;
    return mountRow.kind === LOCAL_MOUNT_KIND ? MOUNT_LISTING_RANK.local : MOUNT_LISTING_RANK.other;
}

/**
 * Every link of the tile: the uplink, the VPN, the SSH masters, and the mounts in listing order (at fault, then the
 * local disks, then the rest, each in the order published; the sort is stable).
 *
 * @param {object} network - The network source, drawable (canDrawConnectionsTile).
 * @param {object} mounts - The mounts source, drawable.
 * @returns {{uplink: ConnectionsLink, vpn: ConnectionsLink, ssh: ConnectionsLink, mounts: ConnectionsLink[]}} The
 *     links.
 */
export function connectionsLinks(network, mounts) {
    const cardRows = connectionsRows(network, mounts, {limit: Number.POSITIVE_INFINITY}).rows;
    const mountsWithCardRows = mounts.rows.map((mountRow, publishedIndex) =>
        ({mountRow, cardRow: cardRows[CARD_ROW_INDEX.firstMount + publishedIndex]}));
    mountsWithCardRows.sort((first, second) => mountListingRank(first.mountRow) - mountListingRank(second.mountRow));
    return {
        uplink: uplinkLink(network.uplink, cardRows[CARD_ROW_INDEX.uplink]),
        vpn: vpnLink(network.vpn, cardRows[CARD_ROW_INDEX.vpn]),
        ssh: sshLink(network.sshMasterCount, cardRows[CARD_ROW_INDEX.ssh]),
        mounts: mountsWithCardRows.map(({mountRow, cardRow}) => mountLink(mountRow, cardRow)),
    };
}
