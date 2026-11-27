// The least work area in which each of side by side and the stack draws a layout's cockpit: what a message can name
// where a work area is too small for it. Pure: no Gio, GLib or Shell import, so it runs under plain gjs.
import {COCKPIT_ARRANGEMENT, cockpitComposition} from './cockpitComposition.js';
import {drawnCockpitGroups} from './cockpitCompositionGroups.js';
import {DEFAULT_COCKPIT_SIZES, compositionSizesFacts} from './cockpitCompositionSizes.js';

/** A length no layout's composition needs more than: the search for a least length runs from 0 to this. */
export const LEAST_WORK_AREA_SEARCH_BOUND_PX = 16384;
/**
 * The arrangements whose least work areas are named, in this order. One row is not named: it always needs more width
 * than either.
 */
const ARRANGEMENTS_WITH_A_LEAST_WORK_AREA = Object.freeze([COCKPIT_ARRANGEMENT.SIDE_BY_SIDE, COCKPIT_ARRANGEMENT.STACKED]);

/**
 * The least length at which something holds, by bisection between a length at which it does not hold and one at
 * which it does: fifteen steps or so for any layout, since the range is fixed.
 *
 * @param {function(number): boolean} holdsAt - Whether it holds at a length; it holds at every longer one too.
 * @returns {number|null} The least length, or null where it does not hold even at LEAST_WORK_AREA_SEARCH_BOUND_PX.
 */
function leastLengthPx(holdsAt) {
    if (!holdsAt(LEAST_WORK_AREA_SEARCH_BOUND_PX))
        return null;
    let shortOfItPx = -1;
    let leastPx = LEAST_WORK_AREA_SEARCH_BOUND_PX;
    while (leastPx - shortOfItPx > 1) {
        const middlePx = Math.floor((shortOfItPx + leastPx) / 2);
        if (holdsAt(middlePx))
            leastPx = middlePx;
        else
            shortOfItPx = middlePx;
    }
    return leastPx;
}

/**
 * The least work area each of side by side and the stack draws a layout in: the arrangement's least width at the
 * search's bound of height, then the least height at that width. Each is asked of the composition for that
 * arrangement alone, with one column of Sessions held and no plate's legend, which is where an arrangement fits the
 * smallest work area.
 *
 * @param {Array<{id: string, cards: string[]}>} groups - The layout's groups.
 * @param {object} [sizes] - The lengths to compose with; DEFAULT_COCKPIT_SIZES unless given.
 * @returns {Array<{arrangement: string, width: number, height: number}>} One entry for each of the two arrangements
 *     that ever draws the layout, side by side first; none for a layout that draws no tile, or for sizes the
 *     composition cannot use.
 */
export function leastCockpitWorkAreas(groups, sizes = DEFAULT_COCKPIT_SIZES) {
    const leastWorkAreas = [];
    // The layout and the sizes are read once for the whole search. Each composition it asks for is of the drawn
    // groups alone, which compose as the layout does, and of the sizes as a composition takes them.
    const sizesFacts = compositionSizesFacts(sizes);
    if (sizesFacts === null)
        return leastWorkAreas;
    const drawnLayout = drawnCockpitGroups(groups).map(group => ({id: group.groupId, cards: group.cardIds}));
    for (const arrangement of ARRANGEMENTS_WITH_A_LEAST_WORK_AREA) {
        const isDrawnAt = (width, height) => cockpitComposition({
            workArea: {x: 0, y: 0, width, height}, groups: drawnLayout, sizes: sizesFacts.sizes,
            onlyArrangement: arrangement,
        }).isDrawn;
        const width = leastLengthPx(candidateWidthPx => isDrawnAt(candidateWidthPx, LEAST_WORK_AREA_SEARCH_BOUND_PX));
        if (width === null)
            continue;
        const height = leastLengthPx(candidateHeightPx => isDrawnAt(width, candidateHeightPx));
        leastWorkAreas.push({arrangement, width, height});
    }
    return leastWorkAreas;
}
