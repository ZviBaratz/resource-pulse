// What the cockpit's composition promises, as checks that give the faults they find: one composition by itself; a
// walk along one length of the work area, one pixel at a time; and one work area at every held count and with wide
// legends. It imports nothing from gi://, so a script outside the gjs table can run the same checks under node. It
// holds no rows.
//
// Inside one arrangement nothing a tile shows falls as the work area grows, but at three trades the composition
// makes on purpose. A walk allows those three by name, and gives every one it meets with its first example.
import {
    COCKPIT_TILE_CARD_ID, CONNECTIONS_FORM, MONITOR_FORMS_LARGEST_FIRST,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionGroups.js';
import {MOST_SESSIONS_COLUMN_COUNT} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCompositionSizes.js';
import {
    COCKPIT_ARRANGEMENT, COCKPIT_NOT_DRAWN_REASON, cockpitComposition,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitComposition.js';

/** The three trades inside one arrangement, by what each takes and gives. */
export const COMPOSITION_TRADE = Object.freeze({
    SESSIONS_GAINS_A_COLUMN: 'Sessions gains a column, and the column beside it gives the width',
    A_COLUMN_REACHES_THE_PAIR_WIDTH: 'a column reaches the width at which Heaviest and Connections share a row',
    CONNECTIONS_GOES_TO_ONE_LINE: 'Connections goes from a list to one line where the rankings gain a row',
});
/** The lengths a walk may grow. */
export const WALKED_LENGTH = Object.freeze({WIDTH: 'width', HEIGHT: 'height'});
/** A walked work area's top left corner: under a top bar, so that the checks see a work area not at the origin. */
const WALKED_WORK_AREA_ORIGIN_PX = Object.freeze({x: 0, y: 32});
/** The cards a composition draws a tile for. */
const COMPOSED_CARD_IDS = Object.freeze(Object.values(COCKPIT_TILE_CARD_ID));
/** The arrangements a drawn composition may name, and the reasons one that is not drawn may give. */
const ARRANGEMENT_NAMES = Object.freeze(Object.values(COCKPIT_ARRANGEMENT));
const NOT_DRAWN_REASONS = Object.freeze(Object.values(COCKPIT_NOT_DRAWN_REASON));
/** The widest a plate's legend is taken as. */
const MOST_LEGEND_WIDTH_PX = 32768;
/** Each monitor form's rank, the wide form highest. */
const MONITOR_FORM_RANK = Object.freeze(Object.fromEntries(
    MONITOR_FORMS_LARGEST_FIRST.map((monitorForm, formIndex) => [monitorForm, MONITOR_FORMS_LARGEST_FIRST.length - 1 - formIndex])));

/**
 * @param {object} composition - A drawn composition.
 * @param {string} cardId - A card's id.
 * @returns {object|null} That card's tile, or null where the composition draws none.
 */
function tileOf(composition, cardId) {
    return composition.tiles.find(tile => tile.cardId === cardId) ?? null;
}

/**
 * @param {object} composition - A drawn composition.
 * @returns {string} The forms of its tiles, as one line: what the width may change only at a pair's width.
 */
function formsOf(composition) {
    return composition.tiles.map(tile => {
        if (tile.cardId === COCKPIT_TILE_CARD_ID.MONITOR)
            return tile.monitorForm;
        if (tile.cardId === COCKPIT_TILE_CARD_ID.HEAVIEST)
            return `${tile.rankingRowCount} rows`;
        return tile.connectionsForm ?? 'sessions';
    }).join(', ');
}

/**
 * @param {object} composition - A drawn composition.
 * @returns {string} Its tiles' heights, as one line.
 */
function heightsOf(composition) {
    return composition.tiles.map(tile => `${tile.cardId} ${tile.height}`).join(', ');
}

/**
 * @param {object} composition - A composition.
 * @returns {string} Everything of it but its widths and left edges, as one line: whether it is drawn, its
 *     arrangement and forms, and each plate's and tile's top edge and height. The held count and the legends change
 *     none of it.
 */
function shapeDownTheWorkAreaOf(composition) {
    if (!composition.isDrawn)
        return `not drawn (${composition.reason})`;
    const plates = composition.plates.map(plate => `plate of group ${plate.groupIndex} at ${plate.y}, ${plate.height} high`);
    const tiles = composition.tiles.map(tile => `${tile.cardId} at ${tile.y}, ${tile.height} high`);
    return `${composition.arrangement}: ${formsOf(composition)}; ${[...plates, ...tiles].join('; ')}`;
}

/**
 * @param {object} sizes - The sizes a composition was made with.
 * @param {number} columnCount - Sessions' columns.
 * @returns {number} The least width of a Sessions tile of that many columns: its columns at their least, the gaps
 *     between them and its side padding, and for one column its extra width.
 */
function sessionsLeastWidthPx(sizes, columnCount) {
    const {columnLeastWidthPx, columnGapPx, sidePaddingPx, oneColumnExtraWidthPx} = sizes.sessions;
    const extraWidthPx = columnCount === 1 ? oneColumnExtraWidthPx : 0;
    return columnCount * columnLeastWidthPx + (columnCount - 1) * columnGapPx + sidePaddingPx + extraWidthPx;
}

/**
 * @param {object} sizes - The sizes a composition was made with.
 * @param {string} arrangement - Its arrangement: in any but the stack, the monitor's column stands beside another.
 * @param {number} sessionsColumnCount - Sessions' columns.
 * @returns {object} Each tile's least width and height, by its card id.
 */
function leastTileSizesPx(sizes, arrangement, sessionsColumnCount) {
    const {monitor, heaviest, connections, sessions} = sizes;
    const smallestMonitorForm = MONITOR_FORMS_LARGEST_FIRST[MONITOR_FORMS_LARGEST_FIRST.length - 1];
    const isMonitorBesideAnotherColumn = arrangement !== COCKPIT_ARRANGEMENT.STACKED;
    const monitorLeastWidthPx = isMonitorBesideAnotherColumn ? monitor.leastWidthBesideAnotherColumnPx
        : monitor.leastWidthPx;
    return {
        [COCKPIT_TILE_CARD_ID.MONITOR]: {width: monitorLeastWidthPx, height: monitor.heightPxByForm[smallestMonitorForm]},
        [COCKPIT_TILE_CARD_ID.HEAVIEST]: {
            width: heaviest.leastWidthPx, height: heaviest.fixedHeightPx + heaviest.leastRowCount * heaviest.rowHeightPx,
        },
        [COCKPIT_TILE_CARD_ID.CONNECTIONS]: {width: connections.listLeastWidthPx, height: connections.lineHeightPx},
        [COCKPIT_TILE_CARD_ID.SESSIONS]: {
            width: sessionsLeastWidthPx(sizes, sessionsColumnCount), height: sessions.leastHeightPx,
        },
    };
}

/**
 * @param {{x: number, y: number, width: number, height: number}} rectangle - A rectangle.
 * @returns {boolean} Whether its numbers are whole and its width and height over 0.
 */
function isWholeRectangle({x, y, width, height}) {
    return [x, y, width, height].every(Number.isInteger) && width > 0 && height > 0;
}

/**
 * @param {{x: number, y: number, width: number, height: number}} workArea - A work area as the caller gives it.
 * @returns {{x: number, y: number, width: number, height: number}} It in whole pixels, as a composition takes it:
 *     its left and top edges rounded up, its right and bottom edges down.
 */
function wholeWorkAreaOf({x, y, width, height}) {
    const left = Math.ceil(x);
    const top = Math.ceil(y);
    return {x: left, y: top, width: Math.floor(x + width) - left, height: Math.floor(y + height) - top};
}

/**
 * @param {*} legendWidthsPx - The legends a composition was given.
 * @param {number} groupIndex - A group's place in the layout.
 * @returns {number} Its plate's legend in whole pixels, 0 where none is known.
 */
function legendWidthOfPx(legendWidthsPx, groupIndex) {
    const widthPx = legendWidthsPx?.[groupIndex];
    const isKnown = typeof widthPx === 'number' && Number.isFinite(widthPx) && widthPx > 0;
    return isKnown ? Math.min(MOST_LEGEND_WIDTH_PX, Math.ceil(widthPx)) : 0;
}

/**
 * @param {*} groups - A layout's groups.
 * @returns {string[]} The tiles the layout draws, each as `card of group place (id)`, sorted: a card is drawn once,
 *     at the first place a group that is an object names it in a list of cards.
 */
function expectedTileNamesOf(groups) {
    const placedCardIds = new Set();
    const tileNames = [];
    (Array.isArray(groups) ? groups : []).forEach((group, groupIndex) => {
        const isGroup = group !== null && typeof group === 'object' && Array.isArray(group.cards);
        for (const cardId of isGroup ? group.cards : []) {
            if (!COMPOSED_CARD_IDS.includes(cardId) || placedCardIds.has(cardId))
                continue;
            placedCardIds.add(cardId);
            tileNames.push(`${cardId} of group ${groupIndex} (${String(group.id)})`);
        }
    });
    return tileNames.sort();
}

/**
 * @param {object} tile - A tile.
 * @param {object} otherTile - Another.
 * @returns {number} The gap between them: the larger of the gaps across and down, negative where they overlap.
 */
function gapBetweenTilesPx(tile, otherTile) {
    const acrossPx = Math.max(tile.x, otherTile.x) - Math.min(tile.x + tile.width, otherTile.x + otherTile.width);
    const downPx = Math.max(tile.y, otherTile.y) - Math.min(tile.y + tile.height, otherTile.y + otherTile.height);
    return Math.max(acrossPx, downPx);
}

/**
 * The faults of a tile's form against its height and its box: the monitor as high as its form; Heaviest as high as
 * its rows, of which it shows from the fewest to the most, or in one row, where every tile is the row's height, at
 * least that high; Connections as one line or a list its box allows; and Sessions as the composition says.
 *
 * @param {object} tile - The tile.
 * @param {object} composition - Its composition.
 * @param {object} sizes - The sizes the composition was made with.
 * @returns {string[]} The faults, each naming the tile.
 */
function tileFormFaults(tile, composition, sizes) {
    const {cardId, width, height} = tile;
    if (cardId === COCKPIT_TILE_CARD_ID.MONITOR) {
        const isFormHeld = MONITOR_FORMS_LARGEST_FIRST.includes(tile.monitorForm) &&
            height === sizes.monitor.heightPxByForm[tile.monitorForm];
        return isFormHeld ? [] : [`the monitor is ${height} high in its ${tile.monitorForm} form`];
    }
    if (cardId === COCKPIT_TILE_CARD_ID.HEAVIEST) {
        const {fixedHeightPx, rowHeightPx, leastRowCount, mostRowCount} = sizes.heaviest;
        const rowCount = tile.rankingRowCount;
        const isRowCountHeld = Number.isInteger(rowCount) && rowCount >= leastRowCount && rowCount <= mostRowCount;
        const rowsHeightPx = fixedHeightPx + rowCount * rowHeightPx;
        const isInOneRow = composition.arrangement === COCKPIT_ARRANGEMENT.ONE_ROW;
        const isFormHeld = isRowCountHeld && (isInOneRow ? height >= rowsHeightPx : height === rowsHeightPx);
        return isFormHeld ? [] : [`apps is ${height} high with ${rowCount} rows`];
    }
    if (cardId === COCKPIT_TILE_CARD_ID.CONNECTIONS) {
        const {lineLeastWidthPx, lineHeightPx, listLeastHeightPx} = sizes.connections;
        const isLineHeld = width >= lineLeastWidthPx && height === lineHeightPx;
        const isFormHeld = tile.connectionsForm === CONNECTIONS_FORM.LINE ? isLineHeld
            : tile.connectionsForm === CONNECTIONS_FORM.LIST && height >= listLeastHeightPx;
        return isFormHeld ? [] : [`connections is a ${tile.connectionsForm} at ${width}x${height}`];
    }
    const sessions = composition.sessions;
    const isAsTheCompositionSays = sessions !== null && tile.columnCount === sessions.columnCount &&
        height === sessions.tileHeightPx;
    return isAsTheCompositionSays ? [] : ['the Sessions tile is not as the composition\'s sessions say'];
}

/**
 * The faults of one tile by itself: a rectangle that is not whole, a tile in the margin or under its least size, and
 * a form its height or its box does not allow.
 *
 * @param {object} tile - The tile.
 * @param {object} composition - Its composition.
 * @param {object} edgesPx - `{left, top, right, bottom}`: the work area inside its margins.
 * @param {object} sizes - The sizes the composition was made with.
 * @returns {string[]} The faults, each naming the tile.
 */
function tileFaults(tile, composition, edgesPx, sizes) {
    const faults = [];
    const {cardId, x, y, width, height} = tile;
    const leastSizesPx = leastTileSizesPx(sizes, composition.arrangement, composition.sessions?.columnCount ?? 1);
    if (!isWholeRectangle(tile))
        faults.push(`${cardId} is not a whole rectangle`);
    if (x < edgesPx.left || y < edgesPx.top || x + width > edgesPx.right || y + height > edgesPx.bottom)
        faults.push(`${cardId} reaches into the margin`);
    if (width < leastSizesPx[cardId].width || height < leastSizesPx[cardId].height)
        faults.push(`${cardId} is under its least size at ${width}x${height}`);
    faults.push(...tileFormFaults(tile, composition, sizes));
    return faults;
}

/**
 * The faults of a composition's tiles together: the tiles the layout draws, each once and in its group; each after
 * the first right of the one before it or under it, so column by column from the left and each column from the top;
 * no two nearer than the gap between bands; and each tile's own faults.
 *
 * @param {object} composition - A drawn composition.
 * @param {object} checked - compositionFaults' second parameter, its work area in whole pixels.
 * @returns {string[]} The faults found.
 */
function tilesFaults(composition, {workArea, groups, sizes}) {
    const {tiles} = composition;
    const {marginPx} = sizes;
    const edgesPx = {
        left: workArea.x + marginPx, top: workArea.y + marginPx,
        right: workArea.x + workArea.width - marginPx, bottom: workArea.y + workArea.height - marginPx,
    };
    const faults = [];
    const tileNames = tiles.map(tile => `${tile.cardId} of group ${tile.groupIndex} (${String(tile.groupId)})`).sort();
    const expectedTileNames = expectedTileNamesOf(groups);
    if (tileNames.join('; ') !== expectedTileNames.join('; '))
        faults.push(`the tiles are ${tileNames.join('; ')}, and the layout draws ${expectedTileNames.join('; ')}`);
    tiles.forEach((tile, tileIndex) => {
        faults.push(...tileFaults(tile, composition, edgesPx, sizes));
        const previous = tiles[tileIndex - 1];
        const isInOrder = previous === undefined || tile.x >= previous.x + previous.width ||
            tile.y >= previous.y + previous.height;
        if (!isInOrder)
            faults.push(`${tile.cardId} is neither right of ${previous.cardId} nor under it`);
        for (const otherTile of tiles.slice(tileIndex + 1)) {
            if (gapBetweenTilesPx(tile, otherTile) < sizes.gaps.betweenBandsPx)
                faults.push(`${tile.cardId} and ${otherTile.cardId} are nearer than the gap between bands`);
        }
    });
    return faults;
}

/**
 * The faults of one plate against its group's tiles: as high as the sizes say, over the group's first tile by the
 * gap below a plate, at the group's left edge, and as wide as its legend where its group is that wide, or as wide as
 * its group, the legend then short.
 *
 * @param {object} plate - The plate.
 * @param {Array<object>} groupTiles - Its group's tiles.
 * @param {object} sizes - The sizes the composition was made with.
 * @param {*} legendWidthsPx - The legends the composition was given.
 * @returns {string[]} The faults, each naming the plate.
 */
function plateFaults(plate, groupTiles, sizes, legendWidthsPx) {
    const groupLeftPx = Math.min(...groupTiles.map(tile => tile.x));
    const groupTopPx = Math.min(...groupTiles.map(tile => tile.y));
    const groupWidthPx = Math.max(...groupTiles.map(tile => tile.x + tile.width)) - groupLeftPx;
    const legendWidthPx = legendWidthOfPx(legendWidthsPx, plate.groupIndex);
    const isLegendShort = legendWidthPx > groupWidthPx;
    const expectedWidthPx = legendWidthPx === 0 || isLegendShort ? groupWidthPx : legendWidthPx;
    const isPlaced = plate.x === groupLeftPx && plate.height === sizes.plate.heightPx &&
        plate.y + plate.height + sizes.plate.gapBelowPx === groupTopPx;
    const isAsWideAsItsLegend = plate.width === expectedWidthPx && plate.isLegendShort === isLegendShort;
    const isGroupNamed = plate.groupId === groupTiles[0].groupId;
    if (isPlaced && isAsWideAsItsLegend && isGroupNamed && Number.isInteger(plate.y))
        return [];
    return [`the plate of group ${plate.groupIndex} at ${plate.x},${plate.y} ${plate.width}x${plate.height} is not ` +
        `over its group's ${groupWidthPx} px at ${groupLeftPx},${groupTopPx}, with a legend of ${legendWidthPx}`];
}

/**
 * The faults of a composition's plates: one for each group that draws a tile, in the order of the groups' first
 * tiles, each placed over its group.
 *
 * @param {object} composition - A drawn composition.
 * @param {object} checked - compositionFaults' second parameter.
 * @returns {string[]} The faults found.
 */
function platesFaults({plates, tiles}, {sizes, legendWidthsPx}) {
    const groupIndexesByFirstTile = [...new Set(tiles.map(tile => tile.groupIndex))];
    const plateGroupIndexes = plates.map(plate => plate.groupIndex);
    if (plateGroupIndexes.join(', ') !== groupIndexesByFirstTile.join(', '))
        return [`the plates are of groups ${plateGroupIndexes.join(', ')}, the tiles of ${groupIndexesByFirstTile.join(', ')}`];
    return plates.flatMap(plate => plateFaults(plate, tiles.filter(tile => tile.groupIndex === plate.groupIndex), sizes,
        legendWidthsPx));
}

/**
 * The faults of a composition's bounds: not the rectangle that holds every plate and tile, or not centred to the
 * pixel, half of what is left over on each axis rounded down.
 *
 * @param {object} composition - A drawn composition.
 * @param {{x: number, y: number, width: number, height: number}} workArea - Its work area in whole pixels.
 * @returns {string[]} The faults found.
 */
function boundsFaults({bounds, plates, tiles}, workArea) {
    const rectangles = [...plates, ...tiles];
    const leftPx = Math.min(...rectangles.map(rectangle => rectangle.x));
    const topPx = Math.min(...rectangles.map(rectangle => rectangle.y));
    const union = {
        x: leftPx, y: topPx,
        width: Math.max(...rectangles.map(rectangle => rectangle.x + rectangle.width)) - leftPx,
        height: Math.max(...rectangles.map(rectangle => rectangle.y + rectangle.height)) - topPx,
    };
    const faults = [];
    if (JSON.stringify(bounds) !== JSON.stringify(union))
        faults.push(`the bounds ${JSON.stringify(bounds)} are not the plates' and tiles' ${JSON.stringify(union)}`);
    const centredX = workArea.x + Math.floor((workArea.width - bounds.width) / 2);
    const centredY = workArea.y + Math.floor((workArea.height - bounds.height) / 2);
    if (bounds.x !== centredX || bounds.y !== centredY)
        faults.push(`the composition is at ${bounds.x},${bounds.y}, and centred would be at ${centredX},${centredY}`);
    return faults;
}

/**
 * @param {object} composition - A drawn composition.
 * @param {*} heldColumnCount - The count of Sessions' columns it was given.
 * @returns {string[]} The faults of its `sessions`: there only with a Sessions tile, and the columns held, up to the
 *     most, the most no more than MOST_SESSIONS_COLUMN_COUNT.
 */
function sessionsFaults({sessions, tiles}, heldColumnCount) {
    const hasSessionsTile = tiles.some(tile => tile.cardId === COCKPIT_TILE_CARD_ID.SESSIONS);
    if (sessions === null)
        return hasSessionsTile ? ['a Sessions tile with no sessions said'] : [];
    if (!hasSessionsTile)
        return ['sessions said with no Sessions tile'];
    const isHeldCountANumber = typeof heldColumnCount === 'number' && Number.isFinite(heldColumnCount);
    const heldCount = isHeldCountANumber
        ? Math.min(MOST_SESSIONS_COLUMN_COUNT, Math.max(1, Math.floor(heldColumnCount))) : 1;
    const {columnCount, mostColumnCount} = sessions;
    const isMostHeld = Number.isInteger(mostColumnCount) && mostColumnCount >= 1 &&
        mostColumnCount <= MOST_SESSIONS_COLUMN_COUNT;
    if (isMostHeld && columnCount === Math.min(heldCount, mostColumnCount))
        return [];
    return [`Sessions has ${columnCount} columns of ${mostColumnCount} at the most, with ${heldCount} held`];
}

/**
 * The faults of one composition by itself. One that is not drawn must give a COCKPIT_NOT_DRAWN_REASON. A drawn one
 * must name an arrangement; draw the tiles its layout draws, in order, each whole, inside the margin, at its least
 * size or over it, in a form its height and box allow, and no nearer another than the gap between bands; place a
 * plate over each group; have bounds that hold every plate and tile, centred to the pixel; and give Sessions the
 * columns held up to the most.
 *
 * @param {object} composition - The composition.
 * @param {object} checked - What it was made from.
 * @param {{x: number, y: number, width: number, height: number}} checked.workArea - Its work area, as it was given.
 * @param {*} checked.groups - Its layout's groups.
 * @param {object} checked.sizes - Its sizes, in whole pixels.
 * @param {*} [checked.heldColumnCount] - The count of Sessions' columns it was given.
 * @param {*} [checked.legendWidthsPx] - The legends it was given; none unless given.
 * @returns {string[]} The faults found.
 */
export function compositionFaults(composition, {workArea, groups, sizes, heldColumnCount, legendWidthsPx = null}) {
    if (!composition.isDrawn) {
        const isReasonKnown = NOT_DRAWN_REASONS.includes(composition.reason);
        return isReasonKnown ? [] : [`not drawn, with a reason no caller knows: ${composition.reason}`];
    }
    const checked = {workArea: wholeWorkAreaOf(workArea), groups, sizes, legendWidthsPx};
    const faults = ARRANGEMENT_NAMES.includes(composition.arrangement) ? []
        : [`drawn in an arrangement no caller knows: ${composition.arrangement}`];
    if (!isWholeRectangle(composition.bounds))
        faults.push('the bounds are not a whole rectangle');
    faults.push(...boundsFaults(composition, checked.workArea));
    faults.push(...tilesFaults(composition, checked));
    faults.push(...platesFaults(composition, checked));
    faults.push(...sessionsFaults(composition, heldColumnCount));
    return faults;
}

/**
 * The faults and trades between a composition and the one a pixel shorter, inside one arrangement: nothing the
 * machine's tiles show, no height of Sessions, and not the most columns Sessions may take may fall. Connections may
 * go from a list to one line where the rankings gain a row, or where Sessions gains a column.
 *
 * @param {object} previous - The composition a pixel shorter.
 * @param {object} composition - The composition.
 * @returns {{faults: string[], trades: string[]}} What was found.
 */
function stepAlongHeightFindings(previous, composition) {
    const faults = [];
    const trades = [];
    const [previousMonitor, monitor] = [previous, composition].map(shown => tileOf(shown, COCKPIT_TILE_CARD_ID.MONITOR));
    if (monitor !== null && MONITOR_FORM_RANK[monitor.monitorForm] < MONITOR_FORM_RANK[previousMonitor.monitorForm])
        faults.push('the monitor\'s form falls as the height grows');
    const [previousHeaviest, heaviest] = [previous, composition].map(shown => tileOf(shown, COCKPIT_TILE_CARD_ID.HEAVIEST));
    if (heaviest !== null && heaviest.rankingRowCount < previousHeaviest.rankingRowCount)
        faults.push('a ranking\'s rows fall as the height grows');
    const [previousSessions, sessions] = [previous, composition].map(shown => tileOf(shown, COCKPIT_TILE_CARD_ID.SESSIONS));
    if (sessions !== null && sessions.height < previousSessions.height)
        faults.push(`Sessions' height falls as the height grows, ${previousSessions.height} to ${sessions.height}`);
    if (sessions !== null && composition.sessions.mostColumnCount < previous.sessions.mostColumnCount)
        faults.push('the most columns Sessions may take fall as the height grows');
    // A column of Sessions can arrive as the height grows, where the column beside it, taken under its pair's width
    // by that column, is tall enough only from this height: the same trade as along the width.
    const didSessionsGainAColumn = sessions !== null && composition.sessions.columnCount > previous.sessions.columnCount;
    if (didSessionsGainAColumn)
        trades.push(COMPOSITION_TRADE.SESSIONS_GAINS_A_COLUMN);
    const [previousConnections, connections] = [previous, composition].map(shown => tileOf(shown, COCKPIT_TILE_CARD_ID.CONNECTIONS));
    const didConnectionsGoToOneLine = connections !== null && previousConnections.connectionsForm === CONNECTIONS_FORM.LIST &&
        connections.connectionsForm === CONNECTIONS_FORM.LINE;
    const didRankingsGainARow = heaviest !== null && heaviest.rankingRowCount > previousHeaviest.rankingRowCount;
    if (didConnectionsGoToOneLine && didRankingsGainARow)
        trades.push(COMPOSITION_TRADE.CONNECTIONS_GOES_TO_ONE_LINE);
    else if (didConnectionsGoToOneLine && !didSessionsGainAColumn)
        faults.push('Connections goes from a list to one line, and neither the rankings gain a row nor Sessions a column');
    return {faults, trades};
}

/**
 * The faults and trades between a composition and the one a pixel narrower, inside one arrangement. The most columns
 * Sessions may take never falls. Where Sessions gains a column, no form and no tile's height changes with it. With
 * the same columns and forms, no tile narrows and Sessions does not get shorter. The forms change only where a
 * column reaches a pair's width, and there neither the monitor's form nor a ranking's rows fall.
 *
 * @param {object} previous - The composition a pixel narrower.
 * @param {object} composition - The composition.
 * @param {number} pairLeastWidthPx - The least width at which Heaviest and Connections share a row.
 * @returns {{faults: string[], trades: string[]}} What was found.
 */
function stepAlongWidthFindings(previous, composition, pairLeastWidthPx) {
    const faults = [];
    if (composition.sessions !== null && composition.sessions.mostColumnCount < previous.sessions.mostColumnCount)
        faults.push('the most columns Sessions may take fall as the width grows');
    const [previousForms, forms] = [formsOf(previous), formsOf(composition)];
    if (composition.sessions?.columnCount !== previous.sessions?.columnCount) {
        const [previousHeights, heights] = [heightsOf(previous), heightsOf(composition)];
        if (forms !== previousForms || heights !== previousHeights) {
            const changeText = `${previousForms}; ${previousHeights} to ${forms}; ${heights}`;
            faults.push(`a form or a height changes where Sessions gains a column: ${changeText}`);
        }
        return {faults, trades: [COMPOSITION_TRADE.SESSIONS_GAINS_A_COLUMN]};
    }
    if (forms === previousForms) {
        for (const tile of composition.tiles) {
            if (tile.width < tileOf(previous, tile.cardId).width)
                faults.push(`${tile.cardId} narrows as the width grows, with the same forms and columns`);
        }
        const [previousSessions, sessions] = [previous, composition].map(shown => tileOf(shown, COCKPIT_TILE_CARD_ID.SESSIONS));
        if (sessions !== null && sessions.height < previousSessions.height)
            faults.push('Sessions gets shorter as the width grows, with the same forms and columns');
        return {faults, trades: []};
    }
    const connectionsFormOf = shown => tileOf(shown, COCKPIT_TILE_CARD_ID.CONNECTIONS)?.connectionsForm;
    const didAPairForm = connectionsFormOf(previous) === CONNECTIONS_FORM.LINE && connectionsFormOf(composition) === CONNECTIONS_FORM.LIST;
    const didABandReachThePairWidth = composition.tiles.some(tile =>
        tile.width === pairLeastWidthPx && tileOf(previous, tile.cardId).width === pairLeastWidthPx - 1);
    const monitorRankOf = shown => MONITOR_FORM_RANK[tileOf(shown, COCKPIT_TILE_CARD_ID.MONITOR)?.monitorForm] ?? 0;
    const rowCountOf = shown => tileOf(shown, COCKPIT_TILE_CARD_ID.HEAVIEST)?.rankingRowCount ?? 0;
    const doesAFormFall = monitorRankOf(composition) < monitorRankOf(previous) || rowCountOf(composition) < rowCountOf(previous);
    if (!(didAPairForm || didABandReachThePairWidth) || doesAFormFall) {
        faults.push(`the forms change away from a pair's width, or fall there: ${previousForms} to ${forms}`);
        return {faults, trades: []};
    }
    return {faults, trades: [COMPOSITION_TRADE.A_COLUMN_REACHES_THE_PAIR_WIDTH]};
}

/**
 * @returns {{faults: string[], tradesMet: Map<string, string>, arrangementChanges: Map<string, string>,
 *     compositionCount: number}} An empty record of walks: their faults, each trade and change of arrangement met
 *     with its first example, and how many compositions were checked.
 */
export function newWalkRecord() {
    return {faults: [], tradesMet: new Map(), arrangementChanges: new Map(), compositionCount: 0};
}

/**
 * The step between two compositions of a walk, into the record: a drawn cockpit lost, a change of arrangement, or
 * inside one arrangement the faults and trades along the growing length. walkCompositions takes each step; a script
 * that walks in its own way takes its steps here.
 *
 * @param {object} previous - The composition a pixel shorter, drawn.
 * @param {object} composition - The composition.
 * @param {{growingLength: string, pairLeastWidthPx: number}} walk - The walk: its growing length, a WALKED_LENGTH,
 *     and the least width at which Heaviest and Connections share a row.
 * @param {object} record - newWalkRecord's record.
 * @param {string} where - Where the step is, for the record.
 * @returns {void}
 */
export function recordWalkStep(previous, composition, {growingLength, pairLeastWidthPx}, record, where) {
    if (!composition.isDrawn) {
        record.faults.push(`a drawn cockpit is lost as the ${growingLength} grows, at ${where}`);
        return;
    }
    if (previous.arrangement !== composition.arrangement) {
        const changeName = `${previous.arrangement} to ${composition.arrangement} as the ${growingLength} grows`;
        if (!record.arrangementChanges.has(changeName))
            record.arrangementChanges.set(changeName, where);
        return;
    }
    const {faults, trades} = growingLength === WALKED_LENGTH.HEIGHT ? stepAlongHeightFindings(previous, composition)
        : stepAlongWidthFindings(previous, composition, pairLeastWidthPx);
    record.faults.push(...faults.map(fault => `${fault}, at ${where}`));
    for (const trade of trades) {
        if (!record.tradesMet.has(trade))
            record.tradesMet.set(trade, where);
    }
}

/**
 * Walks one length of a work area a pixel at a time, the other held, and checks each composition by itself and
 * against the one before.
 *
 * @param {object} walk - The walk.
 * @param {Array<object>} walk.groups - The layout.
 * @param {string} walk.layoutName - The layout's name, for the record.
 * @param {object} walk.sizes - The whole-pixel sizes.
 * @param {string} walk.growingLength - A WALKED_LENGTH.
 * @param {number} walk.fixedLengthPx - The other length.
 * @param {number} walk.fromPx - The growing length's first value.
 * @param {number} walk.toPx - Its last.
 * @param {number} walk.heldColumnCount - Sessions' held columns.
 * @param {{x: number, y: number}} [walk.originPx] - The work area's top left corner, which may be a fraction of a
 *     pixel; under a top bar unless given.
 * @param {object} [record] - A record to add to; a new one unless given.
 * @returns {object} The record.
 */
export function walkCompositions(walk, record = newWalkRecord()) {
    const {groups, layoutName, sizes, growingLength, fixedLengthPx, fromPx, toPx, heldColumnCount} = walk;
    const {originPx = WALKED_WORK_AREA_ORIGIN_PX} = walk;
    const pairLeastWidthPx = sizes.heaviest.leastWidthPx + sizes.gaps.betweenTilesInARowPx + sizes.connections.listLeastWidthPx;
    const workArea = {x: originPx.x, y: originPx.y, width: fixedLengthPx, height: fixedLengthPx};
    let previous = null;
    for (let lengthPx = fromPx; lengthPx <= toPx; lengthPx++) {
        workArea[growingLength] = lengthPx;
        const composition = cockpitComposition({workArea, groups, sizes, sessionsColumnCount: heldColumnCount});
        record.compositionCount++;
        const where = `${layoutName} on ${workArea.x},${workArea.y} ${workArea.width}x${workArea.height}, ` +
            `${heldColumnCount} held`;
        const faults = compositionFaults(composition, {workArea, groups, sizes, heldColumnCount});
        record.faults.push(...faults.map(fault => `${fault}, at ${where}`));
        if (previous?.isDrawn)
            recordWalkStep(previous, composition, {growingLength, pairLeastWidthPx}, record, where);
        previous = composition;
    }
    return record;
}

/**
 * The faults between the compositions of one work area at each held count: drawn or not, in their arrangement, their
 * forms and every top edge and height, and with the same most columns for Sessions, all alike.
 *
 * @param {Array<object>} compositions - The compositions with 1 held, then 2, and so on.
 * @returns {string[]} The faults found.
 */
export function heldCountCompositionsFaults(compositions) {
    const summaryOf = composition => {
        const mostColumns = composition.sessions ? `, ${composition.sessions.mostColumnCount} columns at the most` : '';
        return `${shapeDownTheWorkAreaOf(composition)}${mostColumns}`;
    };
    const withOneHeld = summaryOf(compositions[0]);
    const faults = [];
    compositions.slice(1).forEach((composition, countIndexAfterFirst) => {
        const summary = summaryOf(composition);
        if (summary !== withOneHeld)
            faults.push(`${countIndexAfterFirst + 2} held gives ${summary}; one gives ${withOneHeld}`);
    });
    return faults;
}

/**
 * The faults at one work area across the held counts, from 1 to MOST_SESSIONS_COLUMN_COUNT: each composition's own,
 * and any difference between them but in widths and Sessions' columns.
 *
 * @param {Array<object>} groups - The layout.
 * @param {object} sizes - The whole-pixel sizes.
 * @param {{x: number, y: number, width: number, height: number}} workArea - The work area.
 * @returns {string[]} The faults found.
 */
export function heldCountFaults(groups, sizes, workArea) {
    const compositions = Array.from({length: MOST_SESSIONS_COLUMN_COUNT}, (_unused, countIndex) =>
        cockpitComposition({workArea, groups, sizes, sessionsColumnCount: countIndex + 1}));
    const faults = compositions.flatMap((composition, countIndex) =>
        compositionFaults(composition, {workArea, groups, sizes, heldColumnCount: countIndex + 1}));
    return [...faults, ...heldCountCompositionsFaults(compositions)];
}

/**
 * The faults between a work area's compositions without legends and with them: drawn or not, in their arrangement,
 * their forms and every top edge and height, and Sessions' columns, all alike.
 *
 * @param {object} withoutLegends - The composition with no legend known.
 * @param {object} withLegends - The composition with legends.
 * @returns {string[]} The faults found.
 */
export function legendCompositionsFaults(withoutLegends, withLegends) {
    const summaryOf = composition => {
        const columns = composition.sessions
            ? `, columns ${composition.sessions.columnCount} of ${composition.sessions.mostColumnCount}` : '';
        return `${shapeDownTheWorkAreaOf(composition)}${columns}`;
    };
    const [summaryWithout, summaryWith] = [summaryOf(withoutLegends), summaryOf(withLegends)];
    return summaryWith === summaryWithout ? [] : [`legends give ${summaryWith}; none gives ${summaryWithout}`];
}

/**
 * The faults at one work area with wide legends: they change something but widths, or the composition with them
 * fails its own checks, a plate's width against its legend among them.
 *
 * @param {Array<object>} groups - The layout.
 * @param {object} sizes - The whole-pixel sizes.
 * @param {{x: number, y: number, width: number, height: number}} workArea - The work area.
 * @param {number[]} legendWidthsPx - The legends, by each group's place.
 * @returns {string[]} The faults found.
 */
export function legendFaults(groups, sizes, workArea, legendWidthsPx) {
    const withoutLegends = cockpitComposition({workArea, groups, sizes});
    const withLegends = cockpitComposition({workArea, groups, sizes, plateLegendWidthsPx: legendWidthsPx});
    return [
        ...compositionFaults(withLegends, {workArea, groups, sizes, legendWidthsPx}),
        ...legendCompositionsFaults(withoutLegends, withLegends),
    ];
}
