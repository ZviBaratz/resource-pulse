// lib/pressureStrip.js: a strip's cells divide the plot's samples five to a cell, the newest on the right, each the
// highest band among its samples that have a reading, and blank only where none of them has.
import {test, assertEqual} from './harness.js';
import {
    PRESSURE_STRIP_SAMPLES_PER_CELL, areCellBandsEqual, pressureStripCellBands, pressureStripsCellBands,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/pressureStrip.js';
import {CARD_HISTORY_SAMPLES} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

/** The plot's cells: 150 samples, five to a cell. */
const CELL_COUNT = CARD_HISTORY_SAMPLES / PRESSURE_STRIP_SAMPLES_PER_CELL;
/** avg10 percents in each band: calm under 10 %, then from 10, 25 and 50 %. */
const CALM_PERCENT = 3;
const BAND_ONE_PERCENT = 12;
const WAIT_PERCENT = 31;
const BAND_THREE_PERCENT = 64;

/**
 * A full plot's history, every sample the same reading.
 *
 * @param {number|null} percent - The reading.
 * @returns {Array<number|null>} CARD_HISTORY_SAMPLES of it.
 */
const fullHistoryOf = percent => Array.from({length: CARD_HISTORY_SAMPLES}, () => percent);

/**
 * A full calm history with some samples set, counted from the newest.
 *
 * @param {Object<number, number|null>} readingsFromNewest - Reading by age: 0 is the newest sample.
 * @returns {Array<number|null>} The history, oldest first.
 */
function calmHistoryWith(readingsFromNewest) {
    const history = fullHistoryOf(CALM_PERCENT);
    for (const [age, percent] of Object.entries(readingsFromNewest))
        history[history.length - 1 - Number(age)] = percent;
    return history;
}

/**
 * A strip's cells as a short text, oldest first: a digit per band and '.' for a blank cell.
 *
 * @param {Array<number|null>} cellBands - The cells.
 * @returns {string} The text.
 */
const cellsText = cellBands => cellBands.map(band => (band === null ? '.' : String(band))).join('');

test('pressure strip: 150 samples make 30 cells, five to a cell; a calm history reads calm in every cell', () => {
    const cellBands = pressureStripCellBands(fullHistoryOf(CALM_PERCENT), CARD_HISTORY_SAMPLES);
    assertEqual({cellCount: cellBands.length, samplesPerCell: PRESSURE_STRIP_SAMPLES_PER_CELL,
        cells: cellsText(cellBands)}, {cellCount: 30, samplesPerCell: 5, cells: '0'.repeat(30)});
});

test('pressure strip: a cell reads the highest band among its five samples, at each band\'s threshold: 9.99 % is ' +
    'calm, 10 % band 1, 25 % band 2 and 50 % band 3', () => {
    const lastCellOf = percents => pressureStripCellBands(calmHistoryWith(percents), CARD_HISTORY_SAMPLES).at(-1);
    assertEqual({
        oneHighSampleAmongFour: lastCellOf({2: WAIT_PERCENT}),
        highestOfThree: lastCellOf({0: BAND_ONE_PERCENT, 1: BAND_THREE_PERCENT, 4: WAIT_PERCENT}),
        underBandOne: lastCellOf({0: 9.99}),
        atBandOne: lastCellOf({0: 10}),
        underBandTwo: lastCellOf({0: 24.99}),
        atBandTwo: lastCellOf({0: 25}),
        underBandThree: lastCellOf({0: 49.99}),
        atBandThree: lastCellOf({0: 50}),
    }, {oneHighSampleAmongFour: 2, highestOfThree: 3, underBandOne: 0, atBandOne: 1, underBandTwo: 1, atBandTwo: 2,
        underBandThree: 2, atBandThree: 3});
});

test('pressure strip: a cell is blank only where none of its five samples has a reading; one reading among four gaps ' +
    'is the cell\'s band', () => {
    const gapsInLastCell = {0: null, 1: null, 2: null, 3: null, 4: null};
    assertEqual({
        allFiveGaps: cellsText(pressureStripCellBands(calmHistoryWith(gapsInLastCell), CARD_HISTORY_SAMPLES).slice(-2)),
        oneReadingLeft: pressureStripCellBands(calmHistoryWith({...gapsInLastCell, 3: BAND_ONE_PERCENT}),
            CARD_HISTORY_SAMPLES).at(-1),
        allGaps: cellsText(pressureStripCellBands(fullHistoryOf(null), CARD_HISTORY_SAMPLES)),
    }, {allFiveGaps: '0.', oneReadingLeft: 1, allGaps: '.'.repeat(30)});
});

test('pressure strip: a history shorter than the plot fills the strip from its right, its older slots empty, so a ' +
    'cell part-filled reads its samples and the cells before it are blank', () => {
    const sevenSamples = [WAIT_PERCENT, CALM_PERCENT, CALM_PERCENT, CALM_PERCENT, CALM_PERCENT, CALM_PERCENT,
        BAND_ONE_PERCENT];
    // Seven samples fill the newest cell and two of the one before it; one sample fills the newest cell alone.
    const blanksBeforeTwoCells = '.'.repeat(CELL_COUNT - 2);
    const blanksBeforeOneCell = '.'.repeat(CELL_COUNT - 1);
    assertEqual({
        sevenSamples: cellsText(pressureStripCellBands(sevenSamples, CARD_HISTORY_SAMPLES)),
        oneSample: cellsText(pressureStripCellBands([BAND_THREE_PERCENT], CARD_HISTORY_SAMPLES)),
        none: cellsText(pressureStripCellBands([], CARD_HISTORY_SAMPLES)),
    }, {
        sevenSamples: `${blanksBeforeTwoCells}21`,
        oneSample: `${blanksBeforeOneCell}3`,
        none: '.'.repeat(CELL_COUNT),
    });
});

test('pressure strip: cells are grouped from the newest sample, so a reading stands where its trace slot is and ' +
    'moves one cell left every five Samples', () => {
    const cellOfTheWaitAt = ageInSamples => cellsText(pressureStripCellBands(calmHistoryWith({[ageInSamples]:
        WAIT_PERCENT}), CARD_HISTORY_SAMPLES)).indexOf('2');
    assertEqual([0, 4, 5, 9, 10, 149].map(cellOfTheWaitAt), [29, 29, 28, 28, 27, 0]);
});

test('pressure strip: a history longer than the plot shows its newest 150 samples; a reading that is not a finite ' +
    'number is no reading, and no history or slot count throws', () => {
    const olderWait = [WAIT_PERCENT, ...fullHistoryOf(CALM_PERCENT)];
    const oddReadings = calmHistoryWith({0: Number.NaN, 1: Infinity, 2: '64', 3: undefined, 4: null});
    assertEqual({
        longerHistory: cellsText(pressureStripCellBands(olderWait, CARD_HISTORY_SAMPLES)),
        oddReadings: cellsText(pressureStripCellBands(oddReadings, CARD_HISTORY_SAMPLES).slice(-1)),
        notAnArray: cellsText(pressureStripCellBands(null, CARD_HISTORY_SAMPLES)),
        noSlots: pressureStripCellBands(fullHistoryOf(CALM_PERCENT), 0),
        nonsenseSlots: pressureStripCellBands(fullHistoryOf(CALM_PERCENT), Number.NaN),
        sevenSlots: cellsText(pressureStripCellBands(fullHistoryOf(WAIT_PERCENT), 7)),
    }, {
        longerHistory: '0'.repeat(30),
        oddReadings: '.',
        notAnArray: '.'.repeat(30),
        noSlots: [],
        nonsenseSlots: [],
        sevenSlots: '2',
    });
});

test('pressure strips: the client\'s three histories give the cpu, memory and io strips in that order, and a ' +
    'missing history is a blank strip', () => {
    const historyOf = values => ({values: () => values});
    const pressureHistories = {
        cpu: historyOf(fullHistoryOf(BAND_ONE_PERCENT)),
        memory: historyOf(fullHistoryOf(CALM_PERCENT)),
        io: historyOf(fullHistoryOf(BAND_THREE_PERCENT)),
    };
    assertEqual({
        strips: pressureStripsCellBands(pressureHistories, CARD_HISTORY_SAMPLES).map(cellsText),
        missingMemory: pressureStripsCellBands({...pressureHistories, memory: undefined}, CARD_HISTORY_SAMPLES)
            .map(cellBands => cellsText(cellBands).slice(-1)),
        noHistories: pressureStripsCellBands(null, CARD_HISTORY_SAMPLES).map(cellBands => cellBands.length),
    }, {
        strips: ['1'.repeat(CELL_COUNT), '0'.repeat(CELL_COUNT), '3'.repeat(CELL_COUNT)],
        missingMemory: ['1', '.', '3'],
        noHistories: [CELL_COUNT, CELL_COUNT, CELL_COUNT],
    });
});

test('pressure strip: two strips\' cells are equal only with the same band in every cell, a blank cell differing ' +
    'from a calm one', () => {
    assertEqual({
        same: areCellBandsEqual([0, 1, null, 2], [0, 1, null, 2]),
        blankAgainstCalm: areCellBandsEqual([0, null], [0, 0]),
        oneBandHigher: areCellBandsEqual([0, 1], [0, 2]),
        shorter: areCellBandsEqual([0, 1], [0, 1, 1]),
        bothEmpty: areCellBandsEqual([], []),
    }, {same: true, blankAgainstCalm: false, oneBandHigher: false, shorter: false, bothEmpty: true});
});
