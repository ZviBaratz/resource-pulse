// What each part of the Sessions tile says, and the rectangles of each session's hour strip, as pure functions of
// the sessions source (cockpitProtocol.js's parseSessionsSource). The tile's shell modules set these words and draw
// these rectangles; nothing here knows a pixel of the tile's layout but the strip's own cells.
//
// Every count comes from the rows the reader kept, never from the source's own `counts`: a row the reader dropped is
// then counted nowhere, so the header, each group's heading and its "+N more" always agree with what is listed.
import {
    herdrNotRunningText, idleText, isLongIdleSession, noDataText, sessionTooltip, stateIconName,
} from './cockpitFormat.js';
import {SESSION_STATE_HISTORY_CELLS, SESSION_STATE_HISTORY_LETTERS} from './cockpitProtocol.js';
import {SECONDS_PER_DAY} from './constants.js';
import {
    SESSION_CONTEXT_CAUTION_PERCENT, SESSION_STRIP_CELL_WIDTH_PX, SESSION_STRIP_HEIGHT_PX,
    SESSION_STRIP_WORKING_BAND_HEIGHT_PX,
} from './drawingConstants.js';
import {formatMemorySize, formatWholePercent} from './format.js';
import {SESSION_GROUP_ORDER, sessionsByUrgency} from './sessionOrder.js';

/** The tile's title. */
export const SESSIONS_TILE_TITLE = 'Sessions';
/** The words over a column's cells: the strip's two ends, the idle age and the memory. */
export const SESSIONS_TILE_COLUMN_LABELS = Object.freeze({stripStart: '1 h', stripEnd: 'now', age: 'idle', memory: 'mem'});
/** What the tile says when the service lists no session at all. */
export const NO_SESSIONS_TEXT = 'no sessions';
/** The inks of a strip's rectangles: a minute of work, a wait still going on, and a wait that has ended. */
export const SessionStripInk = Object.freeze({WORKING: 'working', WAITING: 'waiting', WAITED: 'waited'});

/** Each state's group heading. */
const GROUP_HEADING_WORDS_BY_STATE = Object.freeze({
    blocked: 'Waiting on you', working: 'Working', done: 'Done', idle: 'Idle', unknown: 'Unknown',
});
/** The ink a minute's letter draws in the strip; a letter not here (idle, done, unknown) draws nothing. */
const STRIP_INK_BY_LETTER = Object.freeze({
    [SESSION_STATE_HISTORY_LETTERS.working]: SessionStripInk.WORKING,
    [SESSION_STATE_HISTORY_LETTERS.blocked]: SessionStripInk.WAITED,
});
/** The 'no data' line, for a source the tile cannot draw. */
const NO_SOURCE_TEXT = noDataText(null, null);
/** The prefix of a context tag's words. */
const CONTEXT_TAG_PREFIX = 'ctx';
/**
 * The most whole days a row's idle age is written with: an older age is written as this many and OLDER_AGE_MARK, so
 * no age is wider than its cell's sample (lib/sessionsTileGeometry.js SESSIONS_WIDTH_SAMPLE_TEXTS), however old.
 */
export const MOST_WRITTEN_IDLE_DAYS = 99;
/** What follows MOST_WRITTEN_IDLE_DAYS on an age older than that: "99d+" is "99 days or more". */
const OLDER_AGE_MARK = '+';
/** The age, in seconds, from which a row writes "99d+". */
const OLDER_AGE_FROM_SECONDS = (MOST_WRITTEN_IDLE_DAYS + 1) * SECONDS_PER_DAY;

/**
 * Whether the tile can draw a sessions source: it needs the rows alone. Each row the reader kept has a known state,
 * so every count is taken from them (sessionsInGroups), and a mistyped `counts` or total memory does not stop the
 * tile.
 *
 * @param {object|null|undefined} sessions - A sessions source.
 * @returns {boolean} True when it has a list of rows.
 */
export function canDrawSessionsTile(sessions) {
    return sessions !== null && sessions !== undefined && Array.isArray(sessions.rows);
}

/**
 * Whether the service publishes the sessions' state histories: a service older than the field sends none, and the
 * tile then draws its columns as it does where they are too narrow for strips.
 *
 * @param {Array<{stateHistory: string|null}>} rows - The session rows.
 * @returns {boolean} True when any row carries a history, an empty one included: a string. A history missing or not
 *     a string, or a row that is not an object, carries none.
 */
export function hasStateHistories(rows) {
    return rows.some(row => typeof row?.stateHistory === 'string');
}

/**
 * The sessions in their groups, in SESSION_GROUP_ORDER, each group's rows in sessionsByUrgency's order, with the
 * count of each: the count the flow is handed, and the one any rule that holds a column count for the tile must be
 * handed too.
 *
 * @param {Array<{state: string}>} rows - The session rows.
 * @returns {{rowsByState: Object<string, Array<object>>, sessionCountByState: Object<string, number>}} The rows and
 *     the count of each group, every group present, an empty one included.
 */
export function sessionsInGroups(rows) {
    const rowsByState = Object.fromEntries(SESSION_GROUP_ORDER.map(state => [state, []]));
    for (const row of sessionsByUrgency(rows)) {
        // Only a group's own state: a state named like an Object member (`constructor`, `__proto__`) is in no group.
        if (Object.hasOwn(rowsByState, row.state))
            rowsByState[row.state].push(row);
    }
    const sessionCountByState = Object.fromEntries(SESSION_GROUP_ORDER.map(state =>
        [state, rowsByState[state].length]));
    return {rowsByState, sessionCountByState};
}

/**
 * The tile's header: its title and count, each state's count in the groups' order (a state with no session shows
 * none; the tile names each state's mark once, at its build), and the memory of every session.
 *
 * @param {object} header - What the header counts.
 * @param {Object<string, number>} header.sessionCountByState - Each group's count (sessionsInGroups).
 * @param {number|null} header.totalMemoryBytes - The memory of every session, or null when not known.
 * @returns {{titleText: string, countText: string, stateCounts: Array<{state: string, countText: string}>,
 *     totalMemoryText: string|null}} `totalMemoryText` is null with no session, so the header then says "Sessions
 *     0" and nothing else.
 */
export function sessionsTileHeader({sessionCountByState, totalMemoryBytes}) {
    const sessionCount = SESSION_GROUP_ORDER.reduce((sum, state) => sum + sessionCountByState[state], 0);
    const stateCounts = SESSION_GROUP_ORDER
        .filter(state => sessionCountByState[state] > 0)
        .map(state => ({state, countText: String(sessionCountByState[state])}));
    const totalMemoryText = sessionCount > 0 ? formatMemorySize(totalMemoryBytes) : null;
    return {titleText: SESSIONS_TILE_TITLE, countText: String(sessionCount), stateCounts, totalMemoryText};
}

/**
 * What the tile says in place of its columns when it has no session to list, under its title.
 *
 * @param {object|null|undefined} sessions - A sessions source.
 * @returns {{lineText: string, isCountShown: boolean}|null} 'herdr not running' or 'no data' under the title alone,
 *     'no sessions' under "Sessions 0"; null when there are sessions to list. A stale source's line is the drawing's
 *     own (cockpitFormat.js's noDataText), which reaches the tile through its showNoData.
 */
export function sessionsTileShortState(sessions) {
    if (sessions?.herdrRunning === false)
        return {lineText: herdrNotRunningText, isCountShown: false};
    if (!canDrawSessionsTile(sessions))
        return {lineText: NO_SOURCE_TEXT, isCountShown: false};
    if (sessions.rows.length === 0)
        return {lineText: NO_SESSIONS_TEXT, isCountShown: true};
    return null;
}

/**
 * A group's heading, without its count (the tile draws the count in a label of its own).
 *
 * @param {string} state - One of SESSION_GROUP_ORDER.
 * @returns {string} 'Waiting on you', 'Working', 'Done', 'Idle' or 'Unknown'.
 */
export function groupHeadingText(state) {
    return GROUP_HEADING_WORDS_BY_STATE[state];
}

/**
 * A group's heading atop a later column it runs on into.
 *
 * @param {string} state - One of SESSION_GROUP_ORDER.
 * @returns {string} '<heading>, continued'.
 */
export function continuedHeadingText(state) {
    return `${groupHeadingText(state)}, continued`;
}

/**
 * The line that ends a group cut short.
 *
 * @param {number} hiddenCount - The group's rows the tile could not list.
 * @returns {string} '+N more'.
 */
export function moreLineText(hiddenCount) {
    return `+${hiddenCount} more`;
}

/**
 * Whether a state history has anything a strip would show: a minute working or waiting.
 *
 * @param {string} stateHistory - A state history, one letter a minute.
 * @returns {boolean} False when the strip would be the bare track.
 */
function hasStripActivity(stateHistory) {
    return stateHistory.includes(SESSION_STATE_HISTORY_LETTERS.working) ||
        stateHistory.includes(SESSION_STATE_HISTORY_LETTERS.blocked);
}

/**
 * A row's context tag. A context is judged on the whole percent it is drawn as, so nothing reads "80%" without its
 * outline. A row shows it from SESSION_CONTEXT_CAUTION_PERCENT, outlined; a waiting row shows it at any value where
 * its column has strips, since it helps to choose which session to answer first, and a narrow column keeps the room
 * for the name.
 *
 * @param {{state: string, contextPercent: number|null}} row - A session row.
 * @param {boolean} hasStripColumn - Whether the row's column has strips.
 * @returns {{text: string, isHigh: boolean}|null} The tag's words and whether it is outlined; null for no tag.
 */
function contextTag(row, hasStripColumn) {
    if (row.contextPercent === null || row.contextPercent === undefined)
        return null;
    const drawnPercentText = formatWholePercent(row.contextPercent);
    const isHigh = Math.round(row.contextPercent) >= SESSION_CONTEXT_CAUTION_PERCENT;
    const isShownOnWaitingRow = row.state === 'blocked' && hasStripColumn;
    if (!isHigh && !isShownOnWaitingRow)
        return null;
    return {text: `${CONTEXT_TAG_PREFIX} ${drawnPercentText}`, isHigh};
}

/**
 * A row's idle age: cockpitFormat.js's idleText, held to MOST_WRITTEN_IDLE_DAYS, since the age's cell is as wide as
 * its sample and its value is never cut.
 *
 * @param {number|null} idleSeconds - The session's idle age, or null when not known.
 * @param {boolean|null} isFromProcessAge - Whether the age is its process's, which idleText marks.
 * @returns {string} For example '40s', '3m*', or '99d+' from a hundred days on.
 */
export function rowAgeText(idleSeconds, isFromProcessAge) {
    if (idleSeconds !== null && idleSeconds >= OLDER_AGE_FROM_SECONDS)
        return `${MOST_WRITTEN_IDLE_DAYS}d${OLDER_AGE_MARK}`;
    return idleText(idleSeconds, isFromProcessAge);
}

/**
 * What one session's row shows.
 *
 * @param {object} row - A session row, as parseSessionsSource reads it.
 * @param {{hasStripColumn: boolean}} column - Whether the row's column has strips.
 * @returns {{id: string, state: string, iconName: string, name: string, ageText: string, memoryText: string,
 *     isWaiting: boolean, isLongIdle: boolean, contextTag: ({text: string, isHigh: boolean}|null),
 *     stripHistory: (string|null), tooltipLines: string[]}} `stripHistory` is the history the row's strip draws
 *     (stateStripRectangles), or null for no strip: a waiting row has none (its age says what the strip's last cells
 *     would), nor a row with no working or waiting minute in its hour, nor one in a column without strips.
 */
export function sessionRowContent(row, {hasStripColumn}) {
    const isWaiting = row.state === 'blocked';
    const hasStrip = hasStripColumn && !isWaiting && typeof row.stateHistory === 'string' &&
        hasStripActivity(row.stateHistory);
    return {
        id: row.id,
        state: row.state,
        iconName: stateIconName(row.state),
        name: row.name,
        ageText: rowAgeText(row.idleSeconds, row.idleFromProcessAge),
        memoryText: formatMemorySize(row.memoryBytes),
        isWaiting,
        isLongIdle: isLongIdleSession(row),
        contextTag: contextTag(row, hasStripColumn),
        stripHistory: hasStrip ? row.stateHistory : null,
        tooltipLines: sessionTooltip(row, row),
    };
}

/**
 * The ink of each minute of a state history: a wait is still going on where no other state follows it, and has
 * ended once any other minute does, of whatever state.
 *
 * @param {string} stateHistory - A state history, one letter a minute.
 * @returns {Array<string|undefined>} Per minute, a SessionStripInk, or undefined for a minute that draws nothing.
 */
function stripCellInks(stateHistory) {
    const letters = [...stateHistory];
    const lastNotWaitingIndex = letters.findLastIndex(letter => letter !== SESSION_STATE_HISTORY_LETTERS.blocked);
    return letters.map((letter, cellIndex) => {
        const ink = STRIP_INK_BY_LETTER[letter];
        return ink === SessionStripInk.WAITED && cellIndex > lastNotWaitingIndex ? SessionStripInk.WAITING : ink;
    });
}

/**
 * The rectangles of a session's hour strip, in the strip's own pixels: equal neighbours are one rectangle, and a
 * history under an hour stands against the strip's right end (the current minute), empty on the left. The track
 * along the strip's foot is the drawing's own, under every strip.
 *
 * @param {string} stateHistory - A state history, one letter a minute, the oldest first, at most
 *     SESSION_STATE_HISTORY_CELLS long (the reader keeps the newest).
 * @returns {Array<{ink: string, xPx: number, yPx: number, widthPx: number, heightPx: number}>} A minute of work is a
 *     band SESSION_STRIP_WORKING_BAND_HEIGHT_PX high along the foot; a wait fills the strip's height.
 */
export function stateStripRectangles(stateHistory) {
    const inks = stripCellInks(stateHistory.slice(-SESSION_STATE_HISTORY_CELLS));
    const firstCellOffset = SESSION_STATE_HISTORY_CELLS - inks.length;
    const rectangles = [];
    inks.forEach((ink, cellIndex) => {
        if (ink === undefined)
            return;
        const xPx = (firstCellOffset + cellIndex) * SESSION_STRIP_CELL_WIDTH_PX;
        const previous = rectangles.at(-1);
        if (previous !== undefined && previous.ink === ink && previous.xPx + previous.widthPx === xPx) {
            previous.widthPx += SESSION_STRIP_CELL_WIDTH_PX;
            return;
        }
        const isWorking = ink === SessionStripInk.WORKING;
        const heightPx = isWorking ? SESSION_STRIP_WORKING_BAND_HEIGHT_PX : SESSION_STRIP_HEIGHT_PX;
        rectangles.push({ink, xPx, yPx: SESSION_STRIP_HEIGHT_PX - heightPx, widthPx: SESSION_STRIP_CELL_WIDTH_PX,
            heightPx});
    });
    return rectangles;
}
