// Cells packed into rows: left to right, a gap between neighbours, and a new row, a gap below, once the next cell
// would pass the line's width. Each row is as tall as its tallest cell, and a shorter cell is centred in it. A cell
// wider than the line takes a row of its own at the line's width. The dropdown's caption line lays out its cells so
// (wrappedRowsLayout.js), since Clutter's FlowLayout gives cells of one width and, there, of no height.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs. Lengths are in pixels, as Clutter's are.

/**
 * @typedef {object} CellSize
 * @property {number} width - The cell's natural width.
 * @property {number} height - Its natural height at that width.
 */

/**
 * @typedef {object} CellPlacement
 * @property {number} x - Its left, from the line's.
 * @property {number} y - Its top, from the line's.
 * @property {number} width - Its width: its own, or the line's where it is wider.
 * @property {number} height - Its height.
 */

/**
 * @typedef {object} WrappedRows
 * @property {CellPlacement[]} placements - One per cell, in the cells' order.
 * @property {number} height - The rows' height, the gaps between them included; 0 with no cell.
 * @property {number} rowCount - How many rows.
 */

/**
 * The width a cell is placed at: its own, or the line's where it is wider; its own on a line of no width, which then
 * takes one cell a row.
 *
 * @param {number} width - The cell's natural width.
 * @param {number} lineWidth - The width the rows fill.
 * @returns {number} The width it is placed at.
 */
export function placedCellWidth(width, lineWidth) {
    return lineWidth > 0 ? Math.min(width, lineWidth) : width;
}

/**
 * Packs the cells into rows of the given width.
 *
 * @param {object} line - The line.
 * @param {CellSize[]} line.cellSizes - Each cell's size, in order.
 * @param {number} line.lineWidth - The width the rows fill; one cell a row where it is 0 or less.
 * @param {number} line.gap - The gap between neighbours in a row and between rows.
 * @returns {WrappedRows} Where each cell goes, and how tall the rows are.
 */
export function wrappedRowPlacements({cellSizes, lineWidth, gap}) {
    const rows = [];
    let row = null;
    for (const [cellIndex, {width, height}] of cellSizes.entries()) {
        const placedWidth = placedCellWidth(width, lineWidth);
        const rightIfAdded = row === null ? placedWidth : row.width + gap + placedWidth;
        if (row === null || rightIfAdded > lineWidth) {
            row = {cells: [], width: 0, height: 0};
            rows.push(row);
        }
        const x = row.cells.length === 0 ? 0 : row.width + gap;
        row.cells.push({cellIndex, x, width: placedWidth, height});
        row.width = x + placedWidth;
        row.height = Math.max(row.height, height);
    }
    const placements = new Array(cellSizes.length);
    let rowTop = 0;
    for (const {cells, height: rowHeight} of rows) {
        for (const {cellIndex, x, width, height} of cells) {
            // Centred in its row; whole pixels, so a cell's words are never drawn between two.
            const y = rowTop + Math.floor((rowHeight - height) / 2);
            placements[cellIndex] = {x, y, width, height};
        }
        rowTop += rowHeight + gap;
    }
    const height = rows.length === 0 ? 0 : rowTop - gap;
    return {placements, height, rowCount: rows.length};
}

/**
 * The width the line asks for, as its least and as its natural: its widest cell's. So the line never widens what
 * holds it (a menu takes its width from its widest item's natural width), and wraps within the width it is given.
 *
 * @param {number[]} cellWidths - Each cell's natural width.
 * @returns {number} The widest; 0 with no cell.
 */
export function wrappedRowsRequestedWidth(cellWidths) {
    return cellWidths.length === 0 ? 0 : Math.max(...cellWidths);
}
