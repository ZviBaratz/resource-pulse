// Where each caption plate and tile of the cockpit goes, and in which form, on a work area: the cockpit's layout as
// one pure function of the work area, the layout's groups, the sizes, the plates' legends and Sessions' held columns.
// Pure: no Gio, GLib or Shell import, so it runs under plain gjs. Nothing is kept from one call to the next, so a
// layout or a set of sizes changed in place and given again is read again.
//
// The work area is taken in whole pixels, and the room is the work area inside its margins. The arrangements are
// tried in order: every tile in one row, on a work area wider than the sizes' aspect; Sessions' column beside the
// others'; every group stacked in one column; then one row once more, wherever it fits. A work area taller than it
// is wide, on which side by side holds one column of Sessions at the most, tries the stack before side by side. The
// first that fits is centred in the work area.
import {COCKPIT_TILE_CARD_ID, compositionGroupsOf} from './cockpitCompositionGroups.js';
import {
    DEFAULT_COCKPIT_SIZES, MOST_SESSIONS_COLUMN_COUNT, compositionSizesFacts, plateLegendWidthPx,
} from './cockpitCompositionSizes.js';
import {oneRowArrangement, sideBySideArrangement, stackedArrangement} from './cockpitCompositionArrangements.js';

/** The cockpit's three arrangements, as a composition names them. */
export const COCKPIT_ARRANGEMENT = Object.freeze({ONE_ROW: 'one-row', SIDE_BY_SIDE: 'side-by-side', STACKED: 'stacked'});
/** Why a composition draws nothing: a work area too small for every arrangement, a layout of no tile, bad inputs. */
export const COCKPIT_NOT_DRAWN_REASON = Object.freeze({TOO_SMALL: 'too-small', NO_TILE: 'no-tile', BAD_INPUT: 'bad-input'});
/** The furthest a work area's edge may reach from the stage's origin, and the longest it may be: 2^24. */
const MOST_COORDINATE_PX = 16777216;

/**
 * @param {*} value - A value from the caller.
 * @returns {boolean} Whether it is a finite number.
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A work area in whole pixels: its left and top edges rounded up and its right and bottom edges down, so that no
 * pixel outside it is taken. Each of its numbers is read once.
 *
 * @param {*} workArea - The caller's work area.
 * @returns {{x: number, y: number, width: number, height: number}|null} The work area, or null where it is not an
 *     object or its numbers are not finite or reach past MOST_COORDINATE_PX.
 */
function wholeWorkAreaOf(workArea) {
    if (workArea === null || typeof workArea !== 'object')
        return null;
    const {x: leftPx, y: topPx, width: widthPx, height: heightPx} = workArea;
    const numbers = [leftPx, topPx, widthPx, heightPx];
    if (!numbers.every(number => isFiniteNumber(number) && Math.abs(number) <= MOST_COORDINATE_PX))
        return null;
    const x = Math.ceil(leftPx);
    const y = Math.ceil(topPx);
    const width = Math.floor(leftPx + widthPx) - x;
    const height = Math.floor(topPx + heightPx) - y;
    return {x, y, width, height};
}

/**
 * Each drawn plate's legend width, read once from the caller's legends.
 *
 * @param {*} plateLegendWidthsPx - The caller's legends.
 * @param {Array<{groupIndex: number}>} drawnGroups - The layout's drawn groups.
 * @returns {Object<number, number>|null} Each drawn group's legend width in whole pixels by its place, 0 where none
 *     is known; null where the legends are not an object.
 */
function legendWidthsOfDrawnGroups(plateLegendWidthsPx, drawnGroups) {
    if (plateLegendWidthsPx === null || typeof plateLegendWidthsPx !== 'object')
        return null;
    return Object.fromEntries(drawnGroups.map(({groupIndex}) =>
        [groupIndex, plateLegendWidthPx(plateLegendWidthsPx, groupIndex)]));
}

/**
 * @param {*} sessionsColumnCount - The caller's held count of Sessions' columns.
 * @returns {number} It rounded down and held from 1 to MOST_SESSIONS_COLUMN_COUNT; 1 where it is not a finite number.
 */
function heldColumnCountOf(sessionsColumnCount) {
    if (!isFiniteNumber(sessionsColumnCount))
        return 1;
    return Math.min(MOST_SESSIONS_COLUMN_COUNT, Math.max(1, Math.floor(sessionsColumnCount)));
}

/**
 * The first arrangement that fits, in the order the work area gives.
 *
 * @param {object} room - The room (see cockpitCompositionArrangements.js).
 * @param {string|null} onlyArrangement - The one arrangement to try, or null for every one.
 * @returns {{arrangement: string, arranged: object}|null} The arrangement's name and its rectangles before they are
 *     centred, or null where none fits.
 */
function firstArrangementThatFits(room, onlyArrangement) {
    const isTried = arrangement => onlyArrangement === null || onlyArrangement === arrangement;
    const oneRow = isTried(COCKPIT_ARRANGEMENT.ONE_ROW) ? oneRowArrangement(room, true) : null;
    if (oneRow !== null)
        return {arrangement: COCKPIT_ARRANGEMENT.ONE_ROW, arranged: oneRow};
    const sideBySide = isTried(COCKPIT_ARRANGEMENT.SIDE_BY_SIDE) ? sideBySideArrangement(room) : null;
    const isTallerThanWide = room.workArea.height > room.workArea.width;
    const isStackTriedFirst = isTallerThanWide && sideBySide !== null && sideBySide.mostSessionsColumnCount === 1;
    if (sideBySide !== null && !isStackTriedFirst)
        return {arrangement: COCKPIT_ARRANGEMENT.SIDE_BY_SIDE, arranged: sideBySide};
    const stacked = isTried(COCKPIT_ARRANGEMENT.STACKED) ? stackedArrangement(room) : null;
    if (stacked !== null)
        return {arrangement: COCKPIT_ARRANGEMENT.STACKED, arranged: stacked};
    if (sideBySide !== null)
        return {arrangement: COCKPIT_ARRANGEMENT.SIDE_BY_SIDE, arranged: sideBySide};
    const lastOneRow = isTried(COCKPIT_ARRANGEMENT.ONE_ROW) ? oneRowArrangement(room, false) : null;
    return lastOneRow === null ? null : {arrangement: COCKPIT_ARRANGEMENT.ONE_ROW, arranged: lastOneRow};
}

/**
 * The cockpit's composition on a work area: the first arrangement that fits, centred, or nothing drawn and why.
 * Every number it gives is a whole, finite number of logical pixels, in the stage's coordinates, in which the work
 * area is given. It throws nothing of its own; a getter of the caller's that throws is not caught. Each input is read
 * once. Each call gives a new object, not frozen, and changes nothing it is given.
 *
 * Each group that draws a tile has a plate: the strip above the group's first tile that carries the group's caption
 * and its annunciators, the short captions that light while something the group shows needs attention
 * (lib/plateCaptions.js). A plate's legend is the caption with every annunciator shown, at the width the caller
 * measured it, as `plateLegendWidthsPx` in lib/measuredLengths.js gives it.
 *
 * @param {object} inputs - What the composition is computed from; anything but an object is 'bad-input'.
 * @param {{x: number, y: number, width: number, height: number}} inputs.workArea - The cockpit monitor's work area.
 *     Its left and top edges are rounded up and its right and bottom edges down. A number that is not finite, or
 *     past 2^24 from the origin, is 'bad-input'.
 * @param {Array<{id: string, cards: string[]}>} inputs.groups - The layout's groups, as the config reads them.
 * @param {object} [inputs.sizes] - The lengths to compose with: DEFAULT_COCKPIT_SIZES where left out. Sizes the
 *     composition cannot use, null among them, are 'bad-input'.
 * @param {Array<number>|Object<number, number>} [inputs.plateLegendWidthsPx] - Each plate's legend width, by its
 *     group's place in `groups`. Left out, null or not an object, no legend is known. An entry that is not a finite
 *     number over 0 is no legend for its plate; any other is taken in whole pixels, rounded up, and at most 32 768.
 * @param {number} [inputs.sessionsColumnCount] - Sessions' held columns: rounded down and held from 1 to
 *     MOST_SESSIONS_COLUMN_COUNT; 1 where it is left out or not a finite number.
 * @param {string|null} [inputs.onlyArrangement] - The one arrangement to try, for the least work areas: every one is
 *     tried where it is left out or null, and none, giving 'too-small', where it names no COCKPIT_ARRANGEMENT.
 * @returns {object} `{isDrawn: true, arrangement, bounds, plates, tiles, sessions}` or `{isDrawn: false, reason}`,
 *     the reason a COCKPIT_NOT_DRAWN_REASON. `bounds` is the rectangle that holds every plate and tile, centred in
 *     the work area. A plate is `{groupIndex, groupId, x, y, width, height, isLegendShort}`: as wide as its legend
 *     where the legend is no wider than its group, and otherwise as wide as its group. `isLegendShort` is true where
 *     the legend is wider: whoever draws the plate then shows the group's caption and its lit annunciators only,
 *     clipped at the plate's width. A tile is `{cardId, groupIndex, groupId, x, y, width, height}` with its form:
 *     `monitorForm`, `rankingRowCount`, `connectionsForm` or `columnCount`. `groupIndex` is the group's place in
 *     `groups`, and `groupId` its `id` as given: undefined for a group with none. Tiles come column by column from
 *     the left, each column from the top. `sessions` is `{columnCount, mostColumnCount, tileHeightPx}`, or null
 *     without Sessions.
 */
export function cockpitComposition(inputs) {
    if (inputs === null || typeof inputs !== 'object')
        return {isDrawn: false, reason: COCKPIT_NOT_DRAWN_REASON.BAD_INPUT};
    // Each input is read once, here, so that a value that changes between two reads is never used changed.
    const {
        workArea, groups, sizes = DEFAULT_COCKPIT_SIZES, plateLegendWidthsPx, sessionsColumnCount, onlyArrangement,
    } = inputs;
    const wholeWorkArea = wholeWorkAreaOf(workArea);
    const sizesFacts = compositionSizesFacts(sizes);
    if (wholeWorkArea === null || sizesFacts === null)
        return {isDrawn: false, reason: COCKPIT_NOT_DRAWN_REASON.BAD_INPUT};
    const layout = compositionGroupsOf(groups);
    if (layout.drawnGroups.length === 0)
        return {isDrawn: false, reason: COCKPIT_NOT_DRAWN_REASON.NO_TILE};
    const {marginPx} = sizesFacts.sizes;
    const room = {
        workArea: wholeWorkArea,
        availableWidthPx: wholeWorkArea.width - 2 * marginPx,
        availableHeightPx: wholeWorkArea.height - 2 * marginPx,
        layout,
        compositionFacts: {...sizesFacts, columnPlansByColumn: new Map()},
        legendWidthsPx: legendWidthsOfDrawnGroups(plateLegendWidthsPx, layout.drawnGroups),
        heldColumnCount: heldColumnCountOf(sessionsColumnCount),
    };
    const firstThatFits = firstArrangementThatFits(room, onlyArrangement ?? null);
    if (firstThatFits === null)
        return {isDrawn: false, reason: COCKPIT_NOT_DRAWN_REASON.TOO_SMALL};
    return centred(firstThatFits, wholeWorkArea, room.legendWidthsPx);
}

/**
 * The plates of an arrangement, placed: each as wide as its whole legend where its group is that wide; as wide as
 * its group where the legend is wider, the legend then short, or where no legend is known.
 *
 * @param {Array<object>} plates - The arrangement's plates, from its own top left corner.
 * @param {number[]} origin - `[x, y]` of the arrangement's top left corner.
 * @param {*} legendWidthsPx - Each plate's legend width by its group's place, or null.
 * @returns {Array<object>} The plates, each `{groupIndex, groupId, x, y, width, height, isLegendShort}`.
 */
function placedPlates(plates, [originX, originY], legendWidthsPx) {
    return plates.map(({groupIndex, groupId, x, y, groupWidthPx, height}) => {
        const wholeLegendWidthPx = plateLegendWidthPx(legendWidthsPx, groupIndex);
        const isLegendShort = wholeLegendWidthPx > groupWidthPx;
        const width = wholeLegendWidthPx === 0 || isLegendShort ? groupWidthPx : wholeLegendWidthPx;
        return {groupIndex, groupId, x: originX + x, y: originY + y, width, height, isLegendShort};
    });
}

/**
 * Centres an arrangement in its work area, both ways, half of what is left over rounded down, and places its
 * plates and tiles there.
 *
 * @param {{arrangement: string, arranged: object}} firstThatFits - The arrangement's name and its rectangles.
 * @param {{x: number, y: number, width: number, height: number}} workArea - The work area in whole pixels.
 * @param {*} legendWidthsPx - Each plate's legend width by its group's place, or null.
 * @returns {object} The drawn composition.
 */
function centred({arrangement, arranged}, workArea, legendWidthsPx) {
    const originX = workArea.x + Math.floor((workArea.width - arranged.widthPx) / 2);
    const originY = workArea.y + Math.floor((workArea.height - arranged.heightPx) / 2);
    const tiles = arranged.tiles.map(tile => {
        const placedTile = {...tile, x: originX + tile.x, y: originY + tile.y};
        if (tile.cardId === COCKPIT_TILE_CARD_ID.SESSIONS)
            placedTile.columnCount = arranged.sessionsColumnCount;
        return placedTile;
    });
    const sessionsTile = tiles.find(tile => tile.cardId === COCKPIT_TILE_CARD_ID.SESSIONS) ?? null;
    return {
        isDrawn: true,
        arrangement,
        bounds: {x: originX, y: originY, width: arranged.widthPx, height: arranged.heightPx},
        plates: placedPlates(arranged.plates, [originX, originY], legendWidthsPx),
        tiles,
        sessions: sessionsTile === null ? null : {
            columnCount: arranged.sessionsColumnCount,
            mostColumnCount: arranged.mostSessionsColumnCount,
            tileHeightPx: sessionsTile.height,
        },
    };
}
