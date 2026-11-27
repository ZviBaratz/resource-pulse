// What each cell of a caption plate shows: its words, its shape and whether it is shown, from the plate's captions
// (lib/plateCaptions.js) and what is lit. It judges nothing: what is lit comes from the modules that judge it, and a
// plate only draws it.
//
// - A lit caption is an amber outline, but "Waiting on you", which is filled; an unlit one is its faint words. A cell
//   keeps one size in every shape, so lighting a caption moves nothing beside it.
// - "Waiting on you" is lit by its count, a whole number from 1, and says it: "2 WAITING ON YOU", up to
//   MOST_WAITING_COUNT_SHOWN, which a larger count says too. Its cell keeps the one width of the measured count slot
//   (lib/measuredLengths.js COUNT_SLOT_SAMPLE_TEXT), which holds every count it says.
// - A caption lights a cell only where the plate carries it: one whose evidence the group does not draw lights
//   nothing there.
// - A plate's one "Stale" stands for its group's sources. Told which sources are stale, it is lit where one of its
//   group's tiles reads from one of them. Told none, Machine stale lights it on a plate that draws a machine tile and
//   Agents stale on a plate that draws Sessions, so where the machine's tiles are split between two plates, a silent
//   sampler lights both.
// - The short form, for a plate wider than its group: the group caption and the lit cells only, in their places.
// - The plate's lengths are the ones the legend adds (lib/measuredLengths.js plateLegendWidthsPx), so a plate drawn
//   with PLATE_BOX_LENGTHS_PX is as wide as its measured legend.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {cockpitCaptionText} from './cockpitFormat.js';
import {COCKPIT_SNAPSHOT_CARD_IDS, COCKPIT_SOURCE_NAMES_BY_CARD_ID} from './constants.js';
import {
    ANNUNCIATOR_CELL_BORDER_WIDTH_PX, ANNUNCIATOR_CELL_PADDING_PX, PLATE_BORDER_WIDTH_PX, PLATE_GROUP_CAPTION_GAP_PX,
    PLATE_ITEM_GAP_PX, PLATE_PADDING_END_PX, PLATE_PADDING_START_PX,
} from './drawingConstants.js';
import {PlateCaption} from './plateCaptions.js';

/** How a cell is drawn. */
export const CellShape = Object.freeze({
    UNLIT: 'unlit',
    OUTLINE: 'outline',
    FILLED: 'filled',
});

/** The largest count "Waiting on you" says: two digits, as its measured slot. A larger count says this one. */
export const MOST_WAITING_COUNT_SHOWN = 99;

/** The sampler's name as a source of a plate's Stale; the cockpit service's sources keep their own names. */
const SAMPLER_SOURCE_NAME = 'sampler';
/** The cards whose evidence Machine stale stands for: the sampler's two and Connections. */
const MACHINE_CARD_IDS = Object.freeze(['system', 'apps', 'connections']);
/** The card whose evidence Agents stale stands for. */
const AGENTS_CARD_IDS = Object.freeze(['sessions']);

/**
 * The lengths a plate is drawn with, each the one the legend adds: the plate's border and its paddings, the group
 * caption's gap, and each cell's gap, border and padding. A cell's border stands inside the legend's padding.
 */
export const PLATE_BOX_LENGTHS_PX = Object.freeze({
    plateBorderPx: PLATE_BORDER_WIDTH_PX,
    plateStartPaddingPx: PLATE_PADDING_START_PX,
    plateEndPaddingPx: PLATE_PADDING_END_PX,
    groupCaptionGapPx: PLATE_GROUP_CAPTION_GAP_PX,
    cellGapPx: PLATE_ITEM_GAP_PX,
    cellBorderPx: ANNUNCIATOR_CELL_BORDER_WIDTH_PX,
    cellPaddingPx: ANNUNCIATOR_CELL_PADDING_PX - ANNUNCIATOR_CELL_BORDER_WIDTH_PX,
});

/**
 * @typedef {object} PlateLights What is lit, as the modules that judge it say.
 * @property {string[]} litCaptions - The PlateCaption values lit by name: the pressures, Swapping, Offline, Mount.
 * @property {number|null} waitingCount - The sessions waiting on you; null where not known.
 * @property {boolean} isMachineStale - Machine stale is lit.
 * @property {boolean} isAgentsStale - Agents stale is lit.
 * @property {string[]|null} staleSources - The sources stale ('sampler', or a cockpit service's source name), or
 *     null where only the two flags are known.
 */

/**
 * @typedef {object} PlateCell
 * @property {string} plateCaption - Its PlateCaption value.
 * @property {string} text - Its words, upper-cased.
 * @property {string} shape - A CellShape value.
 * @property {boolean} isShown - False only for an unlit cell in the short form.
 */

/**
 * The sources a card's tile reads from.
 *
 * @param {string} cardId - The card's id.
 * @returns {string[]} The sampler for the system and apps cards; the cockpit service's sources for the others; none
 *     for an unknown card.
 */
export function sourceNamesOfCard(cardId) {
    if (COCKPIT_SNAPSHOT_CARD_IDS.includes(cardId))
        return [SAMPLER_SOURCE_NAME];
    return [...(COCKPIT_SOURCE_NAMES_BY_CARD_ID[cardId] ?? [])];
}

/**
 * The count "Waiting on you" says: a whole number from 1, held to MOST_WAITING_COUNT_SHOWN.
 *
 * @param {*} waitingCount - The sessions waiting on you.
 * @returns {number|null} The count it says; null where it is unlit.
 */
function shownWaitingCount(waitingCount) {
    if (!Number.isInteger(waitingCount) || waitingCount < 1)
        return null;
    return Math.min(waitingCount, MOST_WAITING_COUNT_SHOWN);
}

/**
 * The words of "Waiting on you", upper-cased: with its count where lit, without it where not.
 *
 * @param {*} waitingCount - The sessions waiting on you.
 * @returns {string} For example '2 WAITING ON YOU', or 'WAITING ON YOU'.
 */
export function waitingCaptionText(waitingCount) {
    const shownCount = shownWaitingCount(waitingCount);
    const caption = shownCount === null ? PlateCaption.WAITING_ON_YOU : `${shownCount} ${PlateCaption.WAITING_ON_YOU}`;
    return cockpitCaptionText(caption);
}

/**
 * The width a count slot's words are drawn in: the measured slot less its cell's padding and border on both sides.
 *
 * @param {*} countSlotWidthPx - The measured slot, a cell's whole width (lib/measuredLengths.js countSlotWidthPx).
 * @returns {number|null} The width; null where the slot is not a finite number with room for its words.
 */
export function countSlotContentWidthPx(countSlotWidthPx) {
    if (typeof countSlotWidthPx !== 'number' || !Number.isFinite(countSlotWidthPx))
        return null;
    const edgesPx = 2 * (PLATE_BOX_LENGTHS_PX.cellBorderPx + PLATE_BOX_LENGTHS_PX.cellPaddingPx);
    const contentPx = countSlotWidthPx - edgesPx;
    return contentPx > 0 ? contentPx : null;
}

/**
 * Whether a plate's Stale is lit.
 *
 * @param {Set<string>} drawnCardIds - The cards the plate's group draws.
 * @param {object} lights - What is lit.
 * @returns {boolean} True where one of its group's sources is stale.
 */
function isPlateStale(drawnCardIds, lights) {
    const cardIds = [...drawnCardIds];
    if (Array.isArray(lights.staleSources)) {
        const staleSources = lights.staleSources;
        return cardIds.some(cardId => sourceNamesOfCard(cardId).some(sourceName => staleSources.includes(sourceName)));
    }
    const isMachineStaleHere = lights.isMachineStale === true && cardIds.some(id => MACHINE_CARD_IDS.includes(id));
    const isAgentsStaleHere = lights.isAgentsStale === true && cardIds.some(id => AGENTS_CARD_IDS.includes(id));
    return isMachineStaleHere || isAgentsStaleHere;
}

/**
 * One cell's words and shape.
 *
 * @param {string} plateCaption - Its PlateCaption value.
 * @param {object} lights - What is lit.
 * @param {Set<string>} litNamedCaptions - The captions lit by name: every caption but "Waiting on you" and Stale.
 * @param {boolean} isStale - The plate's Stale is lit.
 * @returns {{text: string, shape: string}} Its words and shape.
 */
function cellLook(plateCaption, lights, litNamedCaptions, isStale) {
    if (plateCaption === PlateCaption.WAITING_ON_YOU) {
        const isLit = shownWaitingCount(lights.waitingCount) !== null;
        return {text: waitingCaptionText(lights.waitingCount), shape: isLit ? CellShape.FILLED : CellShape.UNLIT};
    }
    const isLit = plateCaption === PlateCaption.STALE ? isStale : litNamedCaptions.has(plateCaption);
    return {text: cockpitCaptionText(plateCaption), shape: isLit ? CellShape.OUTLINE : CellShape.UNLIT};
}

/**
 * Each cell of one plate, in the plate's places.
 *
 * @param {object} plate - The plate.
 * @param {{groupCaption: string, captions: string[]}} plate.plateCaptions - Its captions (plateCaptionsByGroup).
 * @param {Set<string>} plate.drawnCardIds - The cards its group draws (lib/plateCaptions.js drawnCardIdsByGroup).
 * @param {*} plate.lights - What is lit (PlateLights); anything else lights nothing.
 * @param {boolean} plate.isLegendShort - The plate is wider than its group, so shows its lit cells only.
 * @returns {{groupCaptionText: string, cells: PlateCell[]}} The group caption, upper-cased, and the cells.
 */
export function plateCellsOf({plateCaptions, drawnCardIds, lights, isLegendShort}) {
    const knownLights = lights !== null && typeof lights === 'object' ? lights : {};
    const litCaptions = Array.isArray(knownLights.litCaptions) ? knownLights.litCaptions : [];
    // "Waiting on you" is lit by its count and Stale by the stale flags or sources, so naming either lights nothing.
    const litNamedCaptions = new Set(litCaptions);
    const isStale = isPlateStale(drawnCardIds, knownLights);
    const cells = plateCaptions.captions.map(plateCaption => {
        const {text, shape} = cellLook(plateCaption, knownLights, litNamedCaptions, isStale);
        return {plateCaption, text, shape, isShown: !isLegendShort || shape !== CellShape.UNLIT};
    });
    return {groupCaptionText: cockpitCaptionText(plateCaptions.groupCaption), cells};
}
