// The lengths the cockpit is composed from: a default set at GNOME's default text size, how a caller's set is checked
// and taken in whole pixels, and what follows from it. Pure: no Gio, GLib or Shell import, so it runs under plain gjs.
//
// The composition multiplies nothing by a text scale. Every length it uses is in the sizes it is given: a caller that
// measures the cards' text gives its own, the defaults below with the lengths that hold text filled in from what St
// measures (lib/measuredLengths.js). The defaults are what it uses otherwise, and what its tables use. Each number of a
// caller's sizes is read once, into a copy that is then checked and used. A length is taken in whole pixels, rounded
// up, and every number is bounded, so that no set of sizes can make a loop long or a number large. A stop the sizes put
// under its least counts as the least.
import {MONITOR_FORM, MONITOR_FORMS_LARGEST_FIRST} from './cockpitCompositionGroups.js';

/**
 * Every length the composition uses, in logical pixels at GNOME's default text size, with the few counts and the
 * one ratio that are not lengths.
 */
export const DEFAULT_COCKPIT_SIZES = Object.freeze({
    /** The margin between the composition and each edge of the work area. */
    marginPx: 24,
    /** A group's caption plate, and the gap between it and the group's first tile. */
    plate: Object.freeze({heightPx: 26, gapBelowPx: 8}),
    gaps: Object.freeze({
        /** Between two tiles that stand one under the other, each as wide as its column. */
        betweenBandsPx: 16,
        /** Between two tiles side by side in one row. */
        betweenTilesInARowPx: 24,
        /** Above and below a row that holds Heaviest and Connections side by side: tried largest first. */
        aroundAPairChoicesPx: Object.freeze([24, 20, 16]),
        /** Between the two columns side by side, and between groups in one row: the most, and what it gives down to. */
        betweenColumnsMostPx: 48,
        betweenColumnsLeastPx: 32,
        /** Between two groups in one column; and where that column holds the monitor in its small form. */
        betweenStackedGroupsPx: 32,
        betweenStackedGroupsSmallMonitorPx: 24,
    }),
    monitor: Object.freeze({
        heightPxByForm: Object.freeze({[MONITOR_FORM.WIDE]: 384, [MONITOR_FORM.MEDIUM]: 352, [MONITOR_FORM.SMALL]: 328}),
        /** Its least width in a column that stands alone; where another column stands beside its own; its stop. */
        leastWidthPx: 560,
        leastWidthBesideAnotherColumnPx: 760,
        stopWidthPx: 984,
    }),
    heaviest: Object.freeze({
        /** Its height is the fixed part and a row's height for each of its rows. */
        fixedHeightPx: 88,
        rowHeightPx: 24,
        /** The most rows its ranking shows, and the fewest it shows in a composition. */
        mostRowCount: 10,
        leastRowCount: 6,
        leastWidthPx: 440,
        stopWidthPx: 624,
    }),
    connections: Object.freeze({
        /** As one line: its height, and its least width. */
        lineHeightPx: 56,
        lineLeastWidthPx: 600,
        /** As a list: its width, and its height, each from its least to where it stops gaining. */
        listLeastWidthPx: 260,
        listStopWidthPx: 336,
        listLeastHeightPx: 232,
        listStopHeightPx: 304,
    }),
    sessions: Object.freeze({
        leastHeightPx: 190,
        /** One of its columns: at its least, where it stops gaining; the gap between two; the tile's side padding. */
        columnLeastWidthPx: 400,
        columnStopWidthPx: 524,
        columnGapPx: 12,
        sidePaddingPx: 20,
        /** What a tile of one column has beyond its column and its padding. */
        oneColumnExtraWidthPx: 20,
    }),
    /** Where a column that holds Sessions with other tiles stops gaining width: the monitor's widest. */
    columnWithSessionsStopWidthPx: 1032,
    oneRow: Object.freeze({
        heaviestWidthPx: 624,
        connectionsWidthPx: 300,
        /** The columns Sessions takes in one row, at the most. */
        sessionsColumnCount: 3,
        /** One row is tried first only on a work area wider than this aspect: `aspectHeight × width > aspectWidth × height`. */
        aspectWidth: 11,
        aspectHeight: 5,
        /** The fewest tiles a layout draws for one row to apply. */
        leastTileCount: 2,
    }),
});

/** No composition gives Sessions more columns than this, whatever it is asked: it bounds every loop over columns. */
export const MOST_SESSIONS_COLUMN_COUNT = 6;
/** The most rows a ranking may be asked for: it bounds the steps by which the machine's tiles give height. */
const MOST_RANKING_ROW_COUNT = 16;
/** No length, and no plate's legend, is taken as longer than this. */
const MOST_LENGTH_PX = 32768;
/**
 * The numbers of the sizes that are counts or parts of a ratio, not lengths: they are checked as numbers but not
 * rounded up to a whole pixel.
 */
const NUMBERS_THAT_ARE_NOT_LENGTHS = Object.freeze(
    ['mostRowCount', 'leastRowCount', 'sessionsColumnCount', 'aspectWidth', 'aspectHeight', 'leastTileCount']);
/**
 * Each length at which a tile stops gaining, with the least it is held to, by the keys of its part of the sizes. The
 * stops that a tile's place decides the least of, such as the monitor's beside another column, are held where they
 * are used.
 */
const STOPS_AND_THEIR_LEASTS = Object.freeze([
    {partKey: 'monitor', stopKey: 'stopWidthPx', leastKey: 'leastWidthPx'},
    {partKey: 'heaviest', stopKey: 'stopWidthPx', leastKey: 'leastWidthPx'},
    {partKey: 'connections', stopKey: 'listStopWidthPx', leastKey: 'listLeastWidthPx'},
    {partKey: 'connections', stopKey: 'listStopHeightPx', leastKey: 'listLeastHeightPx'},
    {partKey: 'sessions', stopKey: 'columnStopWidthPx', leastKey: 'columnLeastWidthPx'},
]);

/**
 * A plain copy of a part of the caller's sizes, in the default sizes' shape, each value read once: so the check and
 * the composition read the same numbers, whatever the caller's object gives on a second read. Keys the defaults do
 * not have are not read. A list's length is read once, however long the list, and must be the default list's.
 *
 * @param {*} part - A part of the caller's sizes.
 * @param {*} defaultPart - The same part of the default sizes.
 * @returns {*} The copy, its numbers as read; null where a part is not an object, or a list is not one of the
 *     default list's length.
 */
function plainCopyOf(part, defaultPart) {
    if (typeof defaultPart === 'number')
        return part;
    if (part === null || typeof part !== 'object')
        return null;
    const isList = Array.isArray(defaultPart);
    if (isList && !(Array.isArray(part) && part.length === defaultPart.length))
        return null;
    const copy = isList ? [] : {};
    for (const key of Object.keys(defaultPart)) {
        const copiedPart = plainCopyOf(part[key], defaultPart[key]);
        if (copiedPart === null)
            return null;
        copy[key] = copiedPart;
    }
    return copy;
}

/**
 * Whether a copy of the caller's sizes has every number the default sizes have, each a finite number from 0 to
 * MOST_LENGTH_PX.
 *
 * @param {*} part - A part of plainCopyOf's copy.
 * @param {*} defaultPart - The same part of the default sizes.
 * @returns {boolean} True where every number is there and in range.
 */
function hasEveryNumber(part, defaultPart) {
    if (typeof defaultPart === 'number')
        return typeof part === 'number' && Number.isFinite(part) && part >= 0 && part <= MOST_LENGTH_PX;
    if (part === null || typeof part !== 'object')
        return false;
    return Object.keys(defaultPart).every(key => hasEveryNumber(part[key], defaultPart[key]));
}

/**
 * @param {*} value - A number from the caller's sizes.
 * @param {number} least - The least it may be.
 * @param {number} most - The most it may be.
 * @returns {boolean} Whether it is a whole number from least to most.
 */
function isWholeNumberWithin(value, least, most) {
    return Number.isInteger(value) && value >= least && value <= most;
}

/**
 * Whether the composition may use a copy of the caller's sizes: every length there and in range, the counts whole
 * and small enough to loop over, and both parts of the aspect over 0. The copy holds three gaps around a pair, since
 * plainCopyOf copies no list of another length.
 *
 * @param {object} sizes - plainCopyOf's copy of the caller's sizes.
 * @returns {boolean} True where they are usable.
 */
function isUsableSizes(sizes) {
    if (!hasEveryNumber(sizes, DEFAULT_COCKPIT_SIZES))
        return false;
    const {mostRowCount, leastRowCount} = sizes.heaviest;
    return isWholeNumberWithin(leastRowCount, 1, MOST_RANKING_ROW_COUNT) &&
        isWholeNumberWithin(mostRowCount, leastRowCount, MOST_RANKING_ROW_COUNT) &&
        isWholeNumberWithin(sizes.oneRow.sessionsColumnCount, 1, MOST_SESSIONS_COLUMN_COUNT) &&
        sizes.oneRow.aspectWidth > 0 && sizes.oneRow.aspectHeight > 0;
}

/**
 * A copy of usable sizes with every length rounded up to a whole pixel, and -0 taken as 0, holding the default
 * sizes' keys and no other.
 *
 * @param {object} part - A usable copy of the caller's sizes, or a part of one.
 * @param {object} defaultPart - The same part of the default sizes.
 * @returns {object} The copy.
 */
function inWholePixels(part, defaultPart) {
    const copy = Array.isArray(defaultPart) ? [] : {};
    for (const key of Object.keys(defaultPart)) {
        if (typeof defaultPart[key] !== 'number')
            copy[key] = inWholePixels(part[key], defaultPart[key]);
        else if (NUMBERS_THAT_ARE_NOT_LENGTHS.includes(key))
            copy[key] = part[key];
        else
            copy[key] = Math.max(0, Math.ceil(part[key]));
    }
    return copy;
}

/**
 * Holds each stop in STOPS_AND_THEIR_LEASTS at its least or over it, so that a stop the sizes put under its least
 * counts as the least wherever it is used.
 *
 * @param {object} wholeSizes - A whole-pixel copy of usable sizes; it is changed in place.
 * @returns {void}
 */
function holdStopsAtTheirLeast(wholeSizes) {
    for (const {partKey, stopKey, leastKey} of STOPS_AND_THEIR_LEASTS) {
        const part = wholeSizes[partKey];
        part[stopKey] = Math.max(part[stopKey], part[leastKey]);
    }
}

/**
 * The steps by which the machine's tiles give height, largest first: a ranking's rows from the most down to the
 * least while the monitor keeps its wide form, then the monitor's smaller forms at the least rows. Rows give way
 * before the monitor's form does.
 *
 * @param {object} heaviest - The sizes' `heaviest` part, in whole pixels.
 * @returns {Array<{monitorForm: string, rankingRowCount: number}>} The steps.
 */
function heightStepsOf({mostRowCount, leastRowCount}) {
    const steps = [];
    for (let rankingRowCount = mostRowCount; rankingRowCount >= leastRowCount; rankingRowCount--)
        steps.push({monitorForm: MONITOR_FORM.WIDE, rankingRowCount});
    for (const monitorForm of MONITOR_FORMS_LARGEST_FIRST.slice(1))
        steps.push({monitorForm, rankingRowCount: leastRowCount});
    return steps;
}

/**
 * The caller's sizes as one composition uses them: checked, taken in whole pixels, each stop held at its least, and
 * what follows from them. Made afresh for each composition, so sizes changed in place are read again.
 *
 * @param {*} sizes - The caller's sizes.
 * @returns {object|null} `{sizes, steps, plateStandPx, pairLeastWidthPx}`, or null where the sizes are not usable.
 *     `sizes` is the whole-pixel copy, its pair gaps largest first; `plateStandPx` is a plate and the gap under it;
 *     `pairLeastWidthPx` is the least width at which Heaviest and Connections can share a row.
 */
export function compositionSizesFacts(sizes) {
    const copiedSizes = plainCopyOf(sizes, DEFAULT_COCKPIT_SIZES);
    if (copiedSizes === null || !isUsableSizes(copiedSizes))
        return null;
    const wholeSizes = inWholePixels(copiedSizes, DEFAULT_COCKPIT_SIZES);
    holdStopsAtTheirLeast(wholeSizes);
    wholeSizes.gaps.aroundAPairChoicesPx.sort((first, second) => second - first);
    const {heaviest, connections, gaps, plate} = wholeSizes;
    return {
        sizes: wholeSizes,
        steps: heightStepsOf(heaviest),
        plateStandPx: plate.heightPx + plate.gapBelowPx,
        pairLeastWidthPx: heaviest.leastWidthPx + gaps.betweenTilesInARowPx + connections.listLeastWidthPx,
    };
}

/**
 * @param {object} sizes - Sizes in whole pixels.
 * @param {number} columnCount - Sessions' columns, at least 1.
 * @param {number} columnWidthPx - One column's width.
 * @returns {number} The Sessions tile's width for that many columns of that width: its columns, the gaps between
 *     them and its side padding, and for one column its extra width.
 */
function sessionsWidthPx(sizes, columnCount, columnWidthPx) {
    const {columnGapPx, sidePaddingPx, oneColumnExtraWidthPx} = sizes.sessions;
    const extraWidthPx = columnCount === 1 ? oneColumnExtraWidthPx : 0;
    return columnCount * columnWidthPx + (columnCount - 1) * columnGapPx + sidePaddingPx + extraWidthPx;
}

/**
 * @param {object} sizes - Sizes in whole pixels.
 * @param {number} columnCount - Sessions' columns, at least 1.
 * @returns {number} The least width of a Sessions tile of that many columns.
 */
export function sessionsLeastWidthPx(sizes, columnCount) {
    return sessionsWidthPx(sizes, columnCount, sizes.sessions.columnLeastWidthPx);
}

/**
 * @param {object} sizes - Sizes in whole pixels.
 * @param {number} columnCount - Sessions' columns, at least 1.
 * @returns {number} The width at which a Sessions tile of that many columns stops gaining.
 */
export function sessionsStopWidthPx(sizes, columnCount) {
    return sessionsWidthPx(sizes, columnCount, sizes.sessions.columnStopWidthPx);
}

/**
 * @param {object} sizes - Sizes in whole pixels.
 * @param {number} widthPx - The width Sessions may take.
 * @returns {number} The most columns that width holds at their least, from 0 to MOST_SESSIONS_COLUMN_COUNT.
 */
export function mostSessionsColumnCountIn(sizes, widthPx) {
    let columnCount = 0;
    while (columnCount < MOST_SESSIONS_COLUMN_COUNT && sessionsLeastWidthPx(sizes, columnCount + 1) <= widthPx)
        columnCount++;
    return columnCount;
}

/**
 * A plate's whole legend width, as the caller measured it: its group's caption with every annunciator shown.
 *
 * @param {*} legendWidthsPx - The caller's legends: a list, or an object keyed by each group's place in the layout.
 * @param {number} groupIndex - A group's place in the layout.
 * @returns {number} That plate's legend width in whole pixels, at most MOST_LENGTH_PX; 0 where none is known, which is
 *     where the caller gives anything but a finite number over 0.
 */
export function plateLegendWidthPx(legendWidthsPx, groupIndex) {
    const widthPx = legendWidthsPx?.[groupIndex];
    const isKnown = typeof widthPx === 'number' && Number.isFinite(widthPx) && widthPx > 0;
    return isKnown ? Math.min(MOST_LENGTH_PX, Math.ceil(widthPx)) : 0;
}
