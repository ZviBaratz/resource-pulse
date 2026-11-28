// What each cell of a caption plate shows and how it is drawn: its words, its shape and that shape's class, whether it
// is shown and the lengths of its room, from the plate's captions (lib/plateCaptions.js), what is lit and the plate's
// layout. It judges nothing: what is lit comes from the modules that judge it, and a plate only assigns what this
// module gives it.
//
// - A lit caption is an amber outline, but "Waiting on you", which is filled; an unlit one is its faint words. A cell
//   keeps one size in every shape, so lighting a caption moves nothing beside it.
// - "Waiting on you" is lit by its count, a whole number from 1, and says it: "2 WAITING ON YOU", up to
//   MOST_WAITING_COUNT_SHOWN, which a larger count says too. Its cell keeps the one width of the measured count slot
//   (lib/measuredLengths.js COUNT_SLOT_SAMPLE_TEXT), which holds every count it says.
// - A caption lights a cell only where the plate carries it: one whose evidence the group does not draw lights
//   nothing there.
// - What is lit is the indicator's one answer (lib/cockpitCaptions.js litCaptionsOf): the lit captions' ids, the
//   waiting count and the stale sources, so a plate lights what the hover label and the dropdown name.
// - A plate's one "Stale" stands for its group's sources: it is lit where a source one of its group's cards draws its
//   own data from is one the answer names stale (the sampler for Machine stale's own half, the cockpit service's three
//   by name). So where the machine's tiles are split between two plates, a silent sampler lights only the plate that
//   draws its tiles. The monitor tile's agents track, drawn from the sessions source, does not light the system
//   card's plate: it is drawn only where the layout has a sessions card, whose own plate lights its Stale, and the
//   same stale source is not said twice.
// - The short form, for a plate wider than its group: the group caption and the lit cells only, in their places; an
//   unlit cell there takes no room at all.
// - The plate's lengths are the ones the legend adds (lib/measuredLengths.js plateLegendWidthsPx), so a plate drawn
//   with PLATE_BOX_LENGTHS_PX is as wide as its measured legend.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {CaptionSource} from './cockpitCaptions.js';
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

/** Each shape's class on a cell, a class of the plates' own stylesheet block. */
export const CELL_SHAPE_STYLE_CLASSES = Object.freeze({
    [CellShape.UNLIT]: 'rp-plate-cell-unlit',
    [CellShape.OUTLINE]: 'rp-plate-cell-outline',
    [CellShape.FILLED]: 'rp-plate-cell-filled',
});

/** The largest count "Waiting on you" says: two digits, as its measured slot. A larger count says this one. */
export const MOST_WAITING_COUNT_SHOWN = 99;

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

/** The room an unlit cell takes in the short form: none, its border and gap included. */
const NO_ROOM_PX = 0;
/** An unlit cell's lengths in the short form: no gap, border, padding or width. */
const NO_ROOM_CELL_LENGTHS_PX = Object.freeze({
    'margin-left': NO_ROOM_PX,
    'border-width': NO_ROOM_PX,
    'padding-left': NO_ROOM_PX,
    'padding-right': NO_ROOM_PX,
    'width': NO_ROOM_PX,
});

/**
 * @typedef {object} PlateCell
 * @property {string} plateCaption - Its PlateCaption value.
 * @property {string} text - Its words, upper-cased.
 * @property {string} shape - A CellShape value.
 * @property {string} shapeStyleClass - Its shape's class (CELL_SHAPE_STYLE_CLASSES).
 * @property {boolean} isShown - False only for an unlit cell in the short form.
 * @property {Object<string, number>} cellLengthsPx - Its room, by CSS property, in pixels and in the order they are
 *     written: its gap, border and padding, and its height and width where known.
 */

/**
 * The sources a card draws its own data from. The monitor tile's agents track is not counted for the system card: it
 * is drawn only where the layout has a sessions card, whose plate lights Stale for the sessions source.
 *
 * @param {string} cardId - The card's id.
 * @returns {string[]} The sampler for the system and apps cards; the cockpit service's sources for the others; none
 *     for an unknown card. Each is its CaptionSource id.
 */
export function sourceNamesOfCard(cardId) {
    if (COCKPIT_SNAPSHOT_CARD_IDS.includes(cardId))
        return [CaptionSource.SAMPLER];
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
 * A shown cell's room: its gap, border and padding, its height (the measured cell's less its borders), and for
 * "Waiting on you" the count slot's width less its border and padding. A length unknown, or one that leaves its
 * content no room, is left out.
 *
 * @param {string} plateCaption - Its PlateCaption value.
 * @param {*} countSlotWidthPx - The measured count slot, a cell's whole width; null where unknown.
 * @param {*} cellHeightPx - A cell's whole height; null where unknown.
 * @returns {Object<string, number>} The lengths, by CSS property, in the order they are written.
 */
function shownCellLengthsPx(plateCaption, countSlotWidthPx, cellHeightPx) {
    const {cellGapPx, cellBorderPx, cellPaddingPx} = PLATE_BOX_LENGTHS_PX;
    const cellLengthsPx = {
        'margin-left': cellGapPx,
        'border-width': cellBorderPx,
        'padding-left': cellPaddingPx,
        'padding-right': cellPaddingPx,
    };
    const contentHeightPx = Number.isFinite(cellHeightPx) ? cellHeightPx - 2 * cellBorderPx : null;
    if (contentHeightPx !== null && contentHeightPx > 0)
        cellLengthsPx.height = contentHeightPx;
    const slotContentWidthPx = plateCaption === PlateCaption.WAITING_ON_YOU
        ? countSlotContentWidthPx(countSlotWidthPx) : null;
    if (slotContentWidthPx !== null)
        cellLengthsPx.width = slotContentWidthPx;
    return cellLengthsPx;
}

/**
 * Whether a plate's Stale is lit.
 *
 * @param {*} drawnCardIds - The cards the plate's group draws; anything but a list names none.
 * @param {*} staleSourceIds - The stale sources' CaptionSource ids; anything but a list names none.
 * @returns {boolean} True where a card its group draws takes its own data from a stale source.
 */
function isPlateStale(drawnCardIds, staleSourceIds) {
    if (!Array.isArray(drawnCardIds) || !Array.isArray(staleSourceIds))
        return false;
    return drawnCardIds.some(cardId =>
        sourceNamesOfCard(cardId).some(sourceName => staleSourceIds.includes(sourceName)));
}

/**
 * One cell's words and shape.
 *
 * @param {string} plateCaption - Its PlateCaption value.
 * @param {object} lights - What is lit (CaptionsLit, or an empty object).
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
 * Each cell of one plate, in the plate's places, and how it is drawn.
 *
 * @param {object} plate - The plate.
 * @param {import('./plateCaptions.js').PlateCaptions} plate.plateCaptions - Its captions and the cards its group
 *     draws (plateCaptionsByGroup).
 * @param {*} plate.lights - What is lit: the indicator's answer (lib/cockpitCaptions.js CaptionsLit, from
 *     litCaptionsOf); anything else lights nothing.
 * @param {*} plate.layout - The plate's layout (cockpitCaptionPlate.js PlateLayout): the short form and the measured
 *     count slot and cell height; anything else is the full form with neither known.
 * @returns {{groupCaptionText: string, cells: PlateCell[]}} The group caption, upper-cased, and the cells.
 */
export function plateCellsOf({plateCaptions, lights, layout}) {
    const knownLights = lights !== null && typeof lights === 'object' ? lights : {};
    const knownLayout = layout !== null && typeof layout === 'object' ? layout : {};
    const {isLegendShort = false, countSlotWidthPx = null, cellHeightPx = null} = knownLayout;
    const litCaptions = Array.isArray(knownLights.captions) ? knownLights.captions : [];
    // "Waiting on you" is lit by its count and Stale by the stale sources, so naming either lights nothing.
    const litNamedCaptions = new Set(litCaptions);
    const isStale = isPlateStale(plateCaptions.drawnCardIds, knownLights.staleSourceIds);
    const cells = plateCaptions.captions.map(plateCaption => {
        const {text, shape} = cellLook(plateCaption, knownLights, litNamedCaptions, isStale);
        const isShown = !isLegendShort || shape !== CellShape.UNLIT;
        const cellLengthsPx = isShown
            ? shownCellLengthsPx(plateCaption, countSlotWidthPx, cellHeightPx) : {...NO_ROOM_CELL_LENGTHS_PX};
        return {plateCaption, text, shape, shapeStyleClass: CELL_SHAPE_STYLE_CLASSES[shape], isShown, cellLengthsPx};
    });
    return {groupCaptionText: cockpitCaptionText(plateCaptions.groupCaption), cells};
}
