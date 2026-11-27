// The Sessions tile's lengths with the line boxes St gives, for the tables of lib/sessionsFlow.js and
// lib/sessionsColumnCount.js: the lengths lib/measuredLengths.js measures, at GNOME's default text size and with its
// text scaled by 1.5, as measuredLengths.test.js holds them.

/** The Sessions tile's lengths with the line boxes St gives at GNOME's default text size. */
export const ST_SESSIONS_TILE_LENGTHS = Object.freeze({
    aboveColumnsHeightPx: 80,
    groupHeadingHeightPx: 24,
    moreLineHeightPx: 22,
    rowHeightPxByState: Object.freeze({blocked: 45, working: 24, done: 21, idle: 21, unknown: 21}),
});
/** The Sessions tile's lengths with the line boxes St gives with GNOME's text scaled by 1.5. */
export const ST_SESSIONS_TILE_LENGTHS_AT_TEXT_SCALED_BY_ONE_AND_A_HALF = Object.freeze({
    aboveColumnsHeightPx: 99,
    groupHeadingHeightPx: 31,
    moreLineHeightPx: 30,
    rowHeightPxByState: Object.freeze({blocked: 55, working: 33, done: 30, idle: 30, unknown: 30}),
});
