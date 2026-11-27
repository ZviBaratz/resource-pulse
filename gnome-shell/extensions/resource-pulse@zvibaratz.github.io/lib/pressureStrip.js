// The desktop card's pressure strips (card.js, while the sampler publishes a pressure history): what each strip's
// cells read, from the client's pressure histories (lib/pressureHistories.js).
//
// A strip stands on the traces' own plot, so a moment has the same x in a strip and in the traces: its cells divide
// the plot's samples, the newest on the right, PRESSURE_STRIP_SAMPLES_PER_CELL to a cell, which is 10 s of the
// sampler's 2 s ticks, the span of avg10 itself. A cell reads the highest PSI band (lib/pressure.js) among its samples
// that have a reading, and nothing only where none of them has: a gap the client recorded, or a slot older than the
// history, which is empty, never hatched. Cells are grouped from the newest sample, so a reading moves one cell left
// every PRESSURE_STRIP_SAMPLES_PER_CELL Samples, as its trace slot does.
// Pure: no Gio and no Shell import, so it runs under plain gjs.
import {pressureBand} from './pressure.js';

/** The samples one cell reads: 10 s of 2 s ticks, the span of PSI's avg10. */
export const PRESSURE_STRIP_SAMPLES_PER_CELL = 5;
/** The client's pressure histories in the order the card's meters and strips stand: cpu, memory, io. */
const PRESSURE_HISTORY_NAMES = Object.freeze(['cpu', 'memory', 'io']);

/**
 * A history entry's band, or no reading where the entry is not a finite number.
 *
 * @param {*} percent - An avg10 percent from a pressure history, or null for a gap.
 * @returns {0|1|2|3|null} Its band, or null for no reading.
 */
function bandOrNoReading(percent) {
    if (typeof percent !== 'number' || !Number.isFinite(percent))
        return null;
    return pressureBand(percent);
}

/**
 * One strip's cells: each the highest band among its samples that have a reading, oldest first.
 *
 * @param {Array<number|null>} percentHistory - avg10 percents, oldest first, null for a gap; anything that is not an
 *     array is an empty history.
 * @param {number} slotCount - The plot's samples (lib/constants.js CARD_HISTORY_SAMPLES): the strip has one cell per
 *     PRESSURE_STRIP_SAMPLES_PER_CELL of them, and a history shorter than the plot leaves its oldest slots empty.
 * @returns {Array<0|1|2|3|null>} One band per cell, the newest last; null where none of a cell's samples has a reading.
 */
export function pressureStripCellBands(percentHistory, slotCount) {
    const cellCount = Number.isFinite(slotCount)
        ? Math.max(0, Math.floor(slotCount / PRESSURE_STRIP_SAMPLES_PER_CELL)) : 0;
    const coveredSlotCount = cellCount * PRESSURE_STRIP_SAMPLES_PER_CELL;
    const history = Array.isArray(percentHistory) ? percentHistory : [];
    const shownHistory = history.slice(Math.max(0, history.length - coveredSlotCount));
    // The slots older than the history: empty, so a short history fills the strip from its right.
    const emptySlotCount = coveredSlotCount - shownHistory.length;
    return Array.from({length: cellCount}, (_unused, cellIndex) => {
        let highestBand = null;
        for (let slotInCell = 0; slotInCell < PRESSURE_STRIP_SAMPLES_PER_CELL; slotInCell++) {
            const historyIndex = cellIndex * PRESSURE_STRIP_SAMPLES_PER_CELL + slotInCell - emptySlotCount;
            const band = historyIndex < 0 ? null : bandOrNoReading(shownHistory[historyIndex]);
            if (band !== null && (highestBand === null || band > highestBand))
                highestBand = band;
        }
        return highestBand;
    });
}

/**
 * The three strips' cells, from the client's pressure histories.
 *
 * @param {import('./pressureHistories.js').PressureHistories} pressureHistories - The client's histories: cpu,
 *     memory and io, each with values() oldest first.
 * @param {number} slotCount - The plot's samples.
 * @returns {Array<Array<0|1|2|3|null>>} The cells of the cpu, memory and io strips, in that order.
 */
export function pressureStripsCellBands(pressureHistories, slotCount) {
    return PRESSURE_HISTORY_NAMES.map(historyName =>
        pressureStripCellBands(pressureHistories?.[historyName]?.values() ?? [], slotCount));
}

/**
 * Whether two strips' cells read the same, so a strip whose cells did not change need not be redrawn.
 *
 * @param {Array<0|1|2|3|null>} cellBands - One strip's cells.
 * @param {Array<0|1|2|3|null>} otherCellBands - Another's.
 * @returns {boolean} True when they have the same bands in the same cells.
 */
export function areCellBandsEqual(cellBands, otherCellBands) {
    return cellBands.length === otherCellBands.length &&
        cellBands.every((band, cellIndex) => band === otherCellBands[cellIndex]);
}
