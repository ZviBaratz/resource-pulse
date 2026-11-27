// Layouts, sizes and helpers that the cockpit composition's rows share. It holds no rows itself.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as cockpitConfig from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitConfig.js';
import {cockpitComposition} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitComposition.js';
import {DEFAULT_COCKPIT_SIZES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionSizes.js';

const REPO_ROOT_URI = GLib.uri_resolve_relative(import.meta.url, '../../', GLib.UriFlags.NONE);
const [REPO_ROOT] = GLib.filename_from_uri(REPO_ROOT_URI);
const TEMPLATE_PATH = GLib.build_filenamev([REPO_ROOT, 'examples', 'resource-pulse-cockpit.json.template']);
const [, TEMPLATE_BYTES] = Gio.File.new_for_path(TEMPLATE_PATH).load_contents(null);

/** The example template's groups as the config reads them: the machine's three cards, then Sessions in a group of its own. */
export const TEMPLATE_GROUPS = cockpitConfig.parseCockpitConfig(new TextDecoder().decode(TEMPLATE_BYTES)).layout.groups;

/**
 * A layout of one group for each list of card ids, in order, with ids `g0`, `g1`, and so on.
 *
 * @param {...string[]} cardIdLists - Each group's card ids.
 * @returns {Array<object>} The layout's groups.
 */
export function layoutOf(...cardIdLists) {
    return cardIdLists.map((cards, groupIndex) => ({id: `g${groupIndex}`, caption: `G${groupIndex}`, columns: 1, cards}));
}

/** Layouts besides the template, each by what sets it apart. */
export const LAYOUTS = Object.freeze({
    noSystemCard: layoutOf(['apps', 'connections'], ['sessions']),
    noSessionsCard: layoutOf(['system', 'apps', 'connections']),
    fourGroupsOfOneCard: layoutOf(['system'], ['apps'], ['connections'], ['sessions']),
    oneGroupOfFour: layoutOf(['system', 'apps', 'connections', 'sessions']),
    systemWithAppsThenConnectionsWithSessions: layoutOf(['system', 'apps'], ['connections', 'sessions']),
    connectionsThenTheRestWithSessions: layoutOf(['connections'], ['system', 'apps', 'sessions']),
    sessionsGroupFirst: [TEMPLATE_GROUPS[1], TEMPLATE_GROUPS[0]],
    sessionsOnly: layoutOf(['sessions']),
    connectionsOnly: layoutOf(['connections']),
});

/**
 * @returns {object} A copy of the default sizes that a row may change: plain objects and arrays, nothing frozen.
 */
export function copyOfDefaultSizes() {
    return JSON.parse(JSON.stringify(DEFAULT_COCKPIT_SIZES));
}

/**
 * @param {object} change - Parts to replace, each a whole part of the default sizes.
 * @returns {object} The default sizes with those parts replaced.
 */
function defaultSizesWith(change) {
    return {...copyOfDefaultSizes(), ...change};
}

/**
 * The default sizes with the line boxes St gives at GNOME's default text size, as lib/measuredLengths.js fills them
 * in: a 13 px detail line is 17 px high where the default sizes count 16, which makes the monitor's three forms and
 * Heaviest's fixed part taller.
 */
export const SIZES_WITH_ST_LINE_BOXES = defaultSizesWith({
    monitor: {...DEFAULT_COCKPIT_SIZES.monitor, heightPxByForm: {wide: 388, medium: 355, small: 331}},
    heaviest: {...DEFAULT_COCKPIT_SIZES.heaviest, fixedHeightPx: 89},
});

/**
 * Sizes of the shape larger text gives: every text part about a quarter larger and every fixed part as it is. The
 * monitor's least width beside another column, 806, is then under a pair's least width, 854.
 */
export const LARGER_TEXT_SIZES = defaultSizesWith({
    plate: {heightPx: 30, gapBelowPx: 8},
    monitor: {
        heightPxByForm: {wide: 425, medium: 388, small: 364},
        leastWidthPx: 606, leastWidthBesideAnotherColumnPx: 806, stopWidthPx: 1030,
    },
    heaviest: {fixedHeightPx: 98, rowHeightPx: 29, mostRowCount: 10, leastRowCount: 6, leastWidthPx: 520, stopWidthPx: 740},
    connections: {
        lineHeightPx: 61, lineLeastWidthPx: 720,
        listLeastWidthPx: 310, listStopWidthPx: 400, listLeastHeightPx: 272, listStopHeightPx: 365,
    },
    sessions: {
        leastHeightPx: 228, columnLeastWidthPx: 480, columnStopWidthPx: 630, columnGapPx: 12, sidePaddingPx: 20,
        oneColumnExtraWidthPx: 20,
    },
    columnWithSessionsStopWidthPx: 1078,
    oneRow: {...DEFAULT_COCKPIT_SIZES.oneRow, heaviestWidthPx: 740, connectionsWidthPx: 360},
});

/**
 * Puts a getter on one key of an object that counts its reads and gives one value at the first read and another at
 * every read after: an input that changes between two reads of it.
 *
 * @param {object} target - The object; its key is replaced.
 * @param {string|number} key - The key.
 * @param {*} firstValue - What the first read gives.
 * @param {*} [laterValue] - What every later read gives; the first value unless given.
 * @returns {{count: number}} The reads so far, counted as they are made.
 */
export function countReadsOf(target, key, firstValue, laterValue = firstValue) {
    const reads = {count: 0};
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get() {
            reads.count++;
            return reads.count === 1 ? firstValue : laterValue;
        },
    });
    return reads;
}

/**
 * The composition on a work area of the given size.
 *
 * @param {number} width - The work area's width.
 * @param {number} height - Its height.
 * @param {object} [options] - What else the composition is given.
 * @param {Array<object>} [options.groups] - The layout: the template's unless given.
 * @param {number} [options.heldColumnCount] - Sessions' held columns: one unless given.
 * @param {object} [options.sizes] - The sizes: the default unless given.
 * @param {*} [options.plateLegendWidthsPx] - Each plate's legend width.
 * @param {number} [options.x] - The work area's left edge: 0 unless given.
 * @param {number} [options.y] - Its top edge: 0 unless given.
 * @returns {object} The composition.
 */
export function composeAt(width, height, {groups = TEMPLATE_GROUPS, heldColumnCount = 1, sizes = DEFAULT_COCKPIT_SIZES,
    plateLegendWidthsPx, x = 0, y = 0} = {}) {
    return cockpitComposition({
        workArea: {x, y, width, height}, groups, sizes, plateLegendWidthsPx, sessionsColumnCount: heldColumnCount,
    });
}

/**
 * @param {object} composition - A drawn composition.
 * @param {string} cardId - A card's id.
 * @returns {object|null} That card's tile, or null where the composition draws none.
 */
export function tileOf(composition, cardId) {
    return composition.tiles?.find(tile => tile.cardId === cardId) ?? null;
}

/**
 * @param {object} tile - A tile.
 * @returns {string|number|null} The tile's form: the monitor's form, a ranking's rows, Connections' form or Sessions'
 *     columns.
 */
export function formOf(tile) {
    return tile.monitorForm ?? tile.rankingRowCount ?? tile.connectionsForm ?? tile.columnCount ?? null;
}

/**
 * @param {object} tile - A tile, or null.
 * @returns {string|null} Its size and form, as `760x384 wide`; null for no tile.
 */
export function sizeAndFormOf(tile) {
    return tile === null ? null : `${tile.width}x${tile.height} ${formOf(tile)}`;
}

/**
 * Every plate and tile of a composition, one line each, in the composition's order: what a row compares to the
 * pixel.
 *
 * @param {object} composition - A composition.
 * @returns {object} `{arrangement, plates, tiles}`, each plate as `<group id> x,y widthxheight` and each tile as
 *     `<card id> x,y widthxheight <form>`; `{reason}` where it is not drawn.
 */
export function placementsOf(composition) {
    if (!composition.isDrawn)
        return {reason: composition.reason};
    return {
        arrangement: composition.arrangement,
        plates: composition.plates.map(plate => `${plate.groupId} ${plate.x},${plate.y} ${plate.width}x${plate.height}`),
        tiles: composition.tiles.map(tile => `${tile.cardId} ${tile.x},${tile.y} ${sizeAndFormOf(tile)}`),
    };
}

/**
 * The widths side by side gives its two columns, and the gap between them, for the template: the monitor's width,
 * the gap between the monitor's column and Sessions', and Sessions' width.
 *
 * @param {object} composition - A composition of the template.
 * @returns {number[]|null} `[monitor width, gap, Sessions width]`, or null where it is not drawn.
 */
export function columnWidthsOf(composition) {
    if (!composition.isDrawn)
        return null;
    const monitor = tileOf(composition, 'system');
    const sessions = tileOf(composition, 'sessions');
    return [monitor.width, sessions.x - monitor.x - monitor.width, sessions.width];
}

/**
 * The gap between the monitor and the tile under it.
 *
 * @param {object} composition - A drawn composition with a monitor and Heaviest in one column.
 * @returns {number} The gap.
 */
export function gapUnderTheMonitorPx(composition) {
    const monitor = tileOf(composition, 'system');
    return tileOf(composition, 'apps').y - monitor.y - monitor.height;
}
