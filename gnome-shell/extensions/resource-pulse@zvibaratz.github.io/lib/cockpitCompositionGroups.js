// Which tiles a cockpit layout draws, and in which of its groups: the first step of composing the cockpit, and the
// tiles' vocabulary (their card ids and their forms). Pure: no Gio, GLib or Shell import, so it runs under plain gjs.
//
// A card is drawn once, at the first place the layout names an id the cockpit knows. A second cell of the same id,
// and an id the cockpit does not know, draw nothing and take no room. A group that draws no card is left out
// altogether: no plate, no gap, no width. A group is told by its place in the layout, since the lenient reader
// passes a repeated id.
import {
    COCKPIT_APPS_CARD_ID, COCKPIT_SESSIONS_CARD_ID, COCKPIT_SYSTEM_CARD_ID,
} from './constants.js';

/** The layout's id for the Connections card, as COCKPIT_DRAWN_CARD_IDS names it. */
const CONNECTIONS_CARD_ID = 'connections';

/** The four tiles the cockpit composes, by what each is: the card id a layout names it by. */
export const COCKPIT_TILE_CARD_ID = Object.freeze({
    MONITOR: COCKPIT_SYSTEM_CARD_ID,
    HEAVIEST: COCKPIT_APPS_CARD_ID,
    CONNECTIONS: CONNECTIONS_CARD_ID,
    SESSIONS: COCKPIT_SESSIONS_CARD_ID,
});
/** Every card id the composition places; any other id in a layout draws nothing. */
const COMPOSED_CARD_IDS = Object.freeze(Object.values(COCKPIT_TILE_CARD_ID));

/** The monitor tile's three forms, by height: the wide form is the tallest. */
export const MONITOR_FORM = Object.freeze({WIDE: 'wide', MEDIUM: 'medium', SMALL: 'small'});
/** The monitor's forms in the order its height gives way: from the wide form down to the small one. */
export const MONITOR_FORMS_LARGEST_FIRST = Object.freeze([MONITOR_FORM.WIDE, MONITOR_FORM.MEDIUM, MONITOR_FORM.SMALL]);
/** The Connections tile's two forms: one line, or a list of its connections and mounts. */
export const CONNECTIONS_FORM = Object.freeze({LINE: 'line', LIST: 'list'});

/**
 * The groups of a layout that draw a tile, each with the cards it draws, in the layout's order. One pass over the
 * layout, which stops once every composed card is placed, so a layout of any length costs one pass at the most. The
 * list's length, each group, its `cards` and its `id` are read once.
 *
 * @param {*} groups - The layout's groups, `[{id, caption, columns, cards}]`, as the lenient reader gives them. A
 *     value that is not a list draws nothing; so does a group that is not an object (a function among them), or whose
 *     `cards` is not a list. A group's `columns` is not read: it arranges nothing.
 * @returns {Array<{groupIndex: number, groupId: *, cardIds: string[]}>} The groups that draw a tile. `groupIndex` is
 *     the group's place in `groups`; `groupId` is its `id` as given, `undefined` for a group with none.
 */
export function drawnCockpitGroups(groups) {
    const drawnGroups = [];
    if (!Array.isArray(groups))
        return drawnGroups;
    const placedCardIds = new Set();
    const groupCount = groups.length;
    for (let groupIndex = 0; groupIndex < groupCount && placedCardIds.size < COMPOSED_CARD_IDS.length; groupIndex++) {
        const group = groups[groupIndex];
        const isGroupAnObject = group !== null && typeof group === 'object';
        const groupCards = isGroupAnObject ? group.cards : null;
        const cards = Array.isArray(groupCards) ? groupCards : [];
        const cardCount = cards.length;
        const cardIds = [];
        for (let cardIndex = 0; cardIndex < cardCount && placedCardIds.size < COMPOSED_CARD_IDS.length; cardIndex++) {
            const cardId = cards[cardIndex];
            if (!COMPOSED_CARD_IDS.includes(cardId) || placedCardIds.has(cardId))
                continue;
            placedCardIds.add(cardId);
            cardIds.push(cardId);
        }
        if (cardIds.length > 0)
            drawnGroups.push({groupIndex, groupId: group.id, cardIds});
    }
    return drawnGroups;
}

/**
 * What the composition needs to know of a layout, read once for one composition: its drawn groups, every card they
 * draw, and how side by side would cut them in two.
 *
 * @param {*} groups - The layout's groups.
 * @returns {{drawnGroups: Array<object>, cardIds: string[], sideBySideCut: object|null}} The layout's tiles;
 *     `sideBySideCut` is null where side by side does not apply.
 */
export function compositionGroupsOf(groups) {
    const drawnGroups = drawnCockpitGroups(groups);
    return {
        drawnGroups,
        cardIds: drawnGroups.flatMap(group => group.cardIds),
        sideBySideCut: sideBySideCutOf(drawnGroups),
    };
}

/**
 * The two columns of side by side: Sessions' column, and the others' column beside it. With two groups or more,
 * Sessions' group is one column and every other group stands in the other, in the layout's order. A layout of one
 * group is cut in two for the arrangement: its other tiles, and Sessions, under the group's one plate.
 *
 * @param {Array<{groupIndex: number, groupId: *, cardIds: string[]}>} drawnGroups - The drawn groups.
 * @returns {object|null} Each column's groups and what the arrangement needs to know of them; null where the layout
 *     draws no Sessions tile, or nothing else.
 */
function sideBySideCutOf(drawnGroups) {
    const sessionsGroupPlace = drawnGroups.findIndex(group => group.cardIds.includes(COCKPIT_TILE_CARD_ID.SESSIONS));
    if (sessionsGroupPlace === -1)
        return null;
    const sessionsGroup = drawnGroups[sessionsGroupPlace];
    const isInsideOneGroup = drawnGroups.length === 1;
    if (isInsideOneGroup && sessionsGroup.cardIds.length === 1)
        return null;
    const otherCardIdsOfTheGroup = sessionsGroup.cardIds.filter(cardId => cardId !== COCKPIT_TILE_CARD_ID.SESSIONS);
    const otherGroups = isInsideOneGroup
        ? [{...sessionsGroup, cardIds: otherCardIdsOfTheGroup}]
        : drawnGroups.filter(group => group !== sessionsGroup);
    const sessionsGroups = [isInsideOneGroup ? {...sessionsGroup, cardIds: [COCKPIT_TILE_CARD_ID.SESSIONS]} : sessionsGroup];
    // Sessions' column stands on the right, or on the left where Sessions is the layout's first group (inside one
    // group: where it is the group's first card).
    const isSessionsGroupFirst = sessionsGroupPlace === 0;
    const isSessionsFirstInItsGroup = sessionsGroup.cardIds[0] === COCKPIT_TILE_CARD_ID.SESSIONS;
    return {
        otherGroups,
        sessionsGroups,
        isInsideOneGroup,
        otherCardIds: otherGroups.flatMap(group => group.cardIds),
        sessionsColumnCardIds: sessionsGroups[0].cardIds,
        isSessionsAloneInItsColumn: sessionsGroups[0].cardIds.length === 1,
        isSessionsFirst: isSessionsGroupFirst && (!isInsideOneGroup || isSessionsFirstInItsGroup),
    };
}
