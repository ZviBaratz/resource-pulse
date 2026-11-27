// lib/wrappedRows.js: the dropdown's captions packed into rows, from cell widths at the card's width and at a narrow
// one; a cell wider than the line; each row as tall as its tallest cell.
import {test, assertEqual} from './harness.js';
import {
    placedCellWidth, wrappedRowPlacements, wrappedRowsRequestedWidth,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/wrappedRows.js';

/** The card's width at a text scaling of 1, which the line takes. */
const CARD_LINE_WIDTH = 416;
/** A narrow line: a menu at a large text scaling seen against a long caption. */
const NARROW_LINE_WIDTH = 180;
const CELL_GAP = 6;
const CELL_HEIGHT = 22;
/** Eight cells' widths, of the order of the captions' at a text scaling of 1 (the waiting caption's first). */
const EIGHT_CAPTION_WIDTHS = [126, 72, 74, 64, 82, 70, 58, 106];

/**
 * Cells of one height and the given widths.
 *
 * @param {number[]} widths - Their widths.
 * @param {number} [height] - Their height.
 * @returns {{width: number, height: number}[]} The cells.
 */
function cellsOf(widths, height = CELL_HEIGHT) {
    return widths.map(width => ({width, height}));
}

/**
 * Each row's cells' indices, from the placements' tops.
 *
 * @param {{y: number}[]} placements - The placements.
 * @returns {string} For example '0,1,2 / 3,4'.
 */
function rowsOf(placements) {
    const indicesByTop = new Map();
    placements.forEach(({y}, cellIndex) => {
        indicesByTop.set(y, [...indicesByTop.get(y) ?? [], cellIndex]);
    });
    return [...indicesByTop.values()].map(indices => indices.join(',')).join(' / ');
}

test('wrappedRows: eight captions at the card\'s 416 px take two rows, packed left to right 6 px apart, the second ' +
    'row 6 px below the first', () => {
    const {placements, height, rowCount} = wrappedRowPlacements({
        cellSizes: cellsOf(EIGHT_CAPTION_WIDTHS), lineWidth: CARD_LINE_WIDTH, gap: CELL_GAP,
    });
    assertEqual({
        rows: rowsOf(placements), rowCount, height,
        firstRowLefts: placements.slice(0, 5).map(({x}) => x),
        secondRowTop: placements[5].y,
    }, {
        rows: '0,1,2,3 / 4,5,6,7', rowCount: 2, height: CELL_HEIGHT * 2 + CELL_GAP,
        firstRowLefts: [0, 132, 210, 290, 0], secondRowTop: CELL_HEIGHT + CELL_GAP,
    });
});

test('wrappedRows: a cell that ends exactly at the line\'s width stays on its row; one pixel more starts a new one',
    () => {
        const exact = wrappedRowPlacements({cellSizes: cellsOf([205, 205]), lineWidth: 416, gap: CELL_GAP});
        const over = wrappedRowPlacements({cellSizes: cellsOf([205, 206]), lineWidth: 416, gap: CELL_GAP});
        assertEqual([exact.rowCount, over.rowCount], [1, 2]);
    });

test('wrappedRows: at a narrow width the same captions take more rows, none wider than the line', () => {
    const {placements, rowCount} = wrappedRowPlacements({
        cellSizes: cellsOf(EIGHT_CAPTION_WIDTHS), lineWidth: NARROW_LINE_WIDTH, gap: CELL_GAP,
    });
    const isEachWithin = placements.every(({x, width}) => x + width <= NARROW_LINE_WIDTH);
    assertEqual({rows: rowsOf(placements), rowCount, isEachWithin},
        {rows: '0 / 1,2 / 3,4 / 5,6 / 7', rowCount: 5, isEachWithin: true});
});

test('wrappedRows: a cell wider than the line takes a row of its own at the line\'s width, and the cells after it ' +
    'start the next row', () => {
    const {placements, rowCount} = wrappedRowPlacements({
        cellSizes: cellsOf([60, 500, 60]), lineWidth: CARD_LINE_WIDTH, gap: CELL_GAP,
    });
    assertEqual({rowCount, wide: placements[1], last: placements[2]}, {
        rowCount: 3, wide: {x: 0, y: CELL_HEIGHT + CELL_GAP, width: CARD_LINE_WIDTH, height: CELL_HEIGHT},
        last: {x: 0, y: (CELL_HEIGHT + CELL_GAP) * 2, width: 60, height: CELL_HEIGHT},
    });
});

test('wrappedRows: a row is as tall as its tallest cell, and a shorter cell is centred in it, on a whole pixel', () => {
    const {placements, height} = wrappedRowPlacements({
        cellSizes: [{width: 80, height: 28}, {width: 80, height: 22}, {width: 80, height: 21}],
        lineWidth: CARD_LINE_WIDTH, gap: CELL_GAP,
    });
    assertEqual({tops: placements.map(({y}) => y), height}, {tops: [0, 3, 3], height: 28});
});

test('wrappedRows: a cell is placed at its own width, at the line\'s where it is wider, and at its own on a line of ' +
    'no width, or less, as the placements place it', () => {
    const widths = {narrower: placedCellWidth(60, NARROW_LINE_WIDTH), wider: placedCellWidth(400, NARROW_LINE_WIDTH),
        noLine: placedCellWidth(60, 0), lessThanNoLine: placedCellWidth(60, -1)};
    const placedAtNoLine = wrappedRowPlacements({cellSizes: [{width: 60, height: 20}], lineWidth: 0, gap: CELL_GAP})
        .placements[0].width;
    assertEqual({widths, placedAtNoLine},
        {widths: {narrower: 60, wider: NARROW_LINE_WIDTH, noLine: 60, lessThanNoLine: 60}, placedAtNoLine: 60});
});

test('wrappedRows: no cell gives no row and no height; a line of no width gives one cell a row; the line asks for ' +
    'its widest cell\'s width, and none with no cell', () => {
    const empty = wrappedRowPlacements({cellSizes: [], lineWidth: CARD_LINE_WIDTH, gap: CELL_GAP});
    const noWidth = wrappedRowPlacements({cellSizes: cellsOf([60, 70]), lineWidth: 0, gap: CELL_GAP});
    assertEqual({
        empty: [empty.placements.length, empty.height, empty.rowCount],
        noWidthRows: noWidth.rowCount,
        noWidthWidths: noWidth.placements.map(({width}) => width),
        requested: wrappedRowsRequestedWidth(EIGHT_CAPTION_WIDTHS),
        requestedOfNone: wrappedRowsRequestedWidth([]),
    }, {empty: [0, 0, 0], noWidthRows: 2, noWidthWidths: [60, 70], requested: 126, requestedOfNone: 0});
});
