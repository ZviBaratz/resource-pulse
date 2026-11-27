// Which captions a group's caption plate carries: the group's own caption, then each annunciator whose evidence the
// group draws, each in a fixed place, lit or not.
//
// - The system card's tile brings CPU wait, Mem wait, IO wait and Swapping.
// - The connections card brings Offline and Mount.
// - The sessions card brings "Waiting on you", which keeps one width with or without its count.
// - A group that draws any of the machine's tiles (system, apps, connections), or the sessions tile, carries one
//   "Stale" last: one, not two, where it draws both.
//
// A card is drawn once, at the first place the layout names an id this release draws: a second cell of the same id,
// in that group or a later one, and an id it does not draw, bring nothing. A group that draws no card has no plate.
// The groups are read as the protocol's lenient reader gives them, and anything else is taken as drawing nothing.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {COCKPIT_APPS_CARD_ID, COCKPIT_DRAWN_CARD_IDS, COCKPIT_SESSIONS_CARD_ID, COCKPIT_SYSTEM_CARD_ID}
    from './constants.js';

/** The connections card's id, as the layout names it (lib/constants.js COCKPIT_DRAWN_CARD_IDS). */
const CONNECTIONS_CARD_ID = 'connections';

/** The annunciators' words on a plate, before the layer upper-cases them. */
export const PlateCaption = Object.freeze({
    CPU_WAIT: 'CPU wait',
    MEM_WAIT: 'Mem wait',
    IO_WAIT: 'IO wait',
    SWAPPING: 'Swapping',
    OFFLINE: 'Offline',
    MOUNT: 'Mount',
    WAITING_ON_YOU: 'Waiting on you',
    STALE: 'Stale',
});

/** The captions each card's tile brings to its group's plate, in their places. */
const CAPTIONS_BY_CARD_ID = Object.freeze({
    [COCKPIT_SYSTEM_CARD_ID]: Object.freeze([
        PlateCaption.CPU_WAIT, PlateCaption.MEM_WAIT, PlateCaption.IO_WAIT, PlateCaption.SWAPPING,
    ]),
    [COCKPIT_APPS_CARD_ID]: Object.freeze([]),
    [CONNECTIONS_CARD_ID]: Object.freeze([PlateCaption.OFFLINE, PlateCaption.MOUNT]),
    [COCKPIT_SESSIONS_CARD_ID]: Object.freeze([PlateCaption.WAITING_ON_YOU]),
});

/** The order the cards' captions stand in on one plate: the machine's, then the sessions'. */
const CARD_IDS_IN_CAPTION_ORDER = Object.freeze([
    COCKPIT_SYSTEM_CARD_ID, COCKPIT_APPS_CARD_ID, CONNECTIONS_CARD_ID, COCKPIT_SESSIONS_CARD_ID,
]);

/**
 * @typedef {object} PlateCaptions
 * @property {string} groupCaption - The group's caption as the layout gives it ('' where it is not a string).
 * @property {string[]} captions - The annunciators, in their places: PlateCaption values.
 */

/**
 * The cards each group draws, by the group's place in `groups`: each known card once, at its first place. A plate's
 * cells read it to tell whose evidence their group holds (lib/plateCells.js).
 *
 * @param {*} groups - The layout's groups, `[{id, caption, columns, cards}]`.
 * @returns {Array<Set<string>>} One set a group, empty where it draws nothing; none where `groups` is not a list.
 */
export function drawnCardIdsByGroup(groups) {
    if (!Array.isArray(groups))
        return [];
    const placedCardIds = new Set();
    return groups.map(group => {
        const drawnCardIds = new Set();
        const cardIds = group !== null && typeof group === 'object' && Array.isArray(group.cards) ? group.cards : [];
        // Once every card is placed nothing more can be drawn, so a layout of any length costs one pass.
        if (placedCardIds.size === COCKPIT_DRAWN_CARD_IDS.length)
            return drawnCardIds;
        for (const cardId of cardIds) {
            if (!COCKPIT_DRAWN_CARD_IDS.includes(cardId) || placedCardIds.has(cardId))
                continue;
            placedCardIds.add(cardId);
            drawnCardIds.add(cardId);
        }
        return drawnCardIds;
    });
}

/**
 * The captions each group's plate carries, by the group's place in `groups`.
 *
 * @param {*} groups - The layout's groups, `[{id, caption, columns, cards}]`, as the lenient reader gives them.
 * @returns {Array<PlateCaptions|null>} One entry a group: its plate's captions, or null where it draws no card and
 *     so has no plate. Empty where `groups` is not a list.
 */
export function plateCaptionsByGroup(groups) {
    return drawnCardIdsByGroup(groups).map((drawnCardIds, groupIndex) => {
        if (drawnCardIds.size === 0)
            return null;
        const caption = groups[groupIndex].caption;
        const captions = CARD_IDS_IN_CAPTION_ORDER
            .filter(cardId => drawnCardIds.has(cardId))
            .flatMap(cardId => CAPTIONS_BY_CARD_ID[cardId]);
        return {groupCaption: typeof caption === 'string' ? caption : '', captions: [...captions, PlateCaption.STALE]};
    });
}
