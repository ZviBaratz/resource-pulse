// lib/sessionsTileContent.js: what each part of the Sessions tile says, and each hour strip's rectangles, as pure
// functions of the sessions source.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as sessionsTileContent from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionsTileContent.js';
import {noDataText, sessionTooltip} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitFormat.js';
import {
    SECONDS_PER_DAY, SESSION_IDLE_DIM_SECONDS,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';
import {
    SESSION_STRIP_CELL_WIDTH_PX, SESSION_STRIP_HEIGHT_PX, SESSION_STRIP_WORKING_BAND_HEIGHT_PX,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
/** A full hour of history: an hour of idle minutes. */
const IDLE_HOUR = 'i'.repeat(60);
/** A session row with every field set; a row below overrides what it is testing. */
const BASE_ROW = {
    id: 'w1:p1', name: 'home-sync', state: 'working', idleSeconds: 12, idleFromProcessAge: false,
    memoryBytes: 3 * GIB, workspaceId: 'w1', paneId: 'p1', account: 'account-a', contextPercent: 42,
    stateHistory: `${'i'.repeat(50)}${'w'.repeat(10)}`,
};
/** The states' icons, written out rather than imported, so a changed icon fails here instead of moving with it. */
const ICON_NAME_BY_STATE = {
    working: 'media-playback-start-symbolic', blocked: 'dialog-warning-symbolic',
    idle: 'media-playback-pause-symbolic', done: 'object-select-symbolic', unknown: 'dialog-question-symbolic',
};
/** Writes any microsecond wall-clock stamp as one fixed time of day, so the stale line's words are known. */
const FIXED_CLOCK = () => '14:02';
/** A second short of a hundred days: the oldest age a row writes in days. */
const LAST_WRITTEN_AGE_SECONDS = 100 * SECONDS_PER_DAY - 1;
/** A hundred days: from here a row writes "99d+". */
const OLDER_AGE_SECONDS = 100 * SECONDS_PER_DAY;

/**
 * @param {object} overrides - Fields of BASE_ROW to change.
 * @param {boolean} [hasStripColumn] - Whether the row's column has strips.
 * @returns {object} What the row shows.
 */
function contentOf(overrides, hasStripColumn = true) {
    return sessionsTileContent.sessionRowContent({...BASE_ROW, ...overrides}, {hasStripColumn});
}

/**
 * @param {string} stateHistory - A state history, one letter a minute.
 * @returns {Array<string>} Each rectangle as 'ink x y width height', in the strip's pixels.
 */
function rectanglesOf(stateHistory) {
    return sessionsTileContent.stateStripRectangles(stateHistory)
        .map(({ink, xPx, yPx, widthPx, heightPx}) => `${ink} ${xPx} ${yPx} ${widthPx} ${heightPx}`);
}

/**
 * @param {Array<object>} rows - Session rows.
 * @param {object} [fields] - Other fields of the source.
 * @returns {object} A sessions source as the reader keeps it.
 */
function sessionsOf(rows, fields = {}) {
    return {
        sampledAtUsec: 1_794_000_003_000_000, intervalSeconds: 10, herdrRunning: true, totalMemoryBytes: 7 * GIB,
        counts: {working: 0, blocked: 0, idle: 0, done: 0, unknown: 0}, rows, ...fields,
    };
}

test('sessionsTileContent: a row in each state shows its mark, its name, its age and its memory, with today\'s ' +
    'tooltip lines; only a waiting session\'s row is a waiting row', () => {
    const states = ['blocked', 'working', 'done', 'idle', 'unknown'];
    assertEqual(states.map(state => {
        const content = contentOf({state, id: `w:${state}`, idleSeconds: 125});
        return [content.id, content.state, content.iconName, content.name, content.ageText, content.memoryText,
            content.isWaiting];
    }), states.map(state => [`w:${state}`, state, ICON_NAME_BY_STATE[state], 'home-sync', '2m', '3.0G',
        state === 'blocked']));
    const row = {...BASE_ROW, state: 'blocked'};
    assertEqual(sessionsTileContent.sessionRowContent(row, {hasStripColumn: true}).tooltipLines,
        sessionTooltip(row, row));
});

test('sessionsTileContent: an age read from the process\'s age keeps its *, and an age or a memory not known is a ' +
    'dash', () =>
    assertEqual([
        contentOf({idleSeconds: 720, idleFromProcessAge: true}).ageText,
        contentOf({idleSeconds: null, idleFromProcessAge: null}).ageText,
        contentOf({memoryBytes: null}).memoryText,
        contentOf({memoryBytes: 340 * MIB}).memoryText,
    ], ['12m*', '—', '—', '340M']));

test('sessionsTileContent: an idle or done row dims from SESSION_IDLE_DIM_SECONDS; a working, waiting or unknown ' +
    'row never does, nor a row whose age is not known', () =>
    assertEqual([
        ['idle', SESSION_IDLE_DIM_SECONDS - 1], ['idle', SESSION_IDLE_DIM_SECONDS], ['done', SESSION_IDLE_DIM_SECONDS],
        ['working', 7200], ['blocked', 7200], ['unknown', 7200], ['idle', null],
    ].map(([state, idleSeconds]) => contentOf({state, idleSeconds}).isLongIdle),
    [false, true, true, false, false, false, false]));

test('sessionsTileContent: a row shows its context only from 80% as drawn, outlined: 79.5% reads "ctx 80%" and is ' +
    'outlined, 79% shows nothing, and a context not known shows nothing', () =>
    assertEqual([79, 79.4, 79.5, 80, 95, null].map(contextPercent => contentOf({contextPercent}).contextTag), [
        null, null, {text: 'ctx 80%', isHigh: true}, {text: 'ctx 80%', isHigh: true},
        {text: 'ctx 95%', isHigh: true}, null,
    ]));

test('sessionsTileContent: a waiting row shows its context below 80% in plain ink where its column has strips, ' +
    'and only from 80% in a column with none; the same holds with no strip in the row itself', () =>
    assertEqual({
        withStrips: [42, 85, null].map(contextPercent =>
            contentOf({state: 'blocked', contextPercent}, true).contextTag),
        narrow: [42, 85].map(contextPercent => contentOf({state: 'blocked', contextPercent}, false).contextTag),
        workingNarrow: contentOf({contextPercent: 42}, false).contextTag,
    }, {
        withStrips: [{text: 'ctx 42%', isHigh: false}, {text: 'ctx 85%', isHigh: true}, null],
        narrow: [null, {text: 'ctx 85%', isHigh: true}],
        workingNarrow: null,
    }));

test('sessionsTileContent: a row draws its strip only in a column with strips, not on a waiting row, and only ' +
    'with a working or waiting minute in its hour', () =>
    assertEqual({
        working: contentOf({}).stripHistory,
        narrow: contentOf({}, false).stripHistory,
        waiting: contentOf({state: 'blocked', stateHistory: 'wwbb'}).stripHistory,
        quietHour: contentOf({state: 'idle', stateHistory: `${'d'.repeat(30)}${'i'.repeat(25)}uuuuu`}).stripHistory,
        pastWaitOnly: contentOf({state: 'idle', stateHistory: 'iibbii'}).stripHistory,
        noCellYet: contentOf({stateHistory: ''}).stripHistory,
        olderService: contentOf({stateHistory: null}).stripHistory,
    }, {
        working: BASE_ROW.stateHistory, narrow: null, waiting: null, quietHour: null, pastWaitOnly: 'iibbii',
        noCellYet: null, olderService: null,
    }));

test('sessionsTileContent: a strip draws work as a low band, a wait still going on (the trailing waits) as the ' +
    'whole height in amber, and an earlier wait as the whole height in the neutral ink; idle, done and unknown ' +
    'minutes draw nothing', () => {
    const bandTopPx = SESSION_STRIP_HEIGHT_PX - SESSION_STRIP_WORKING_BAND_HEIGHT_PX;
    const cellPx = SESSION_STRIP_CELL_WIDTH_PX;
    const history = `${'i'.repeat(53)}wbidwbb`;
    assertEqual(rectanglesOf(history), [
        `working ${53 * cellPx} ${bandTopPx} ${cellPx} ${SESSION_STRIP_WORKING_BAND_HEIGHT_PX}`,
        `waited ${54 * cellPx} 0 ${cellPx} ${SESSION_STRIP_HEIGHT_PX}`,
        `working ${57 * cellPx} ${bandTopPx} ${cellPx} ${SESSION_STRIP_WORKING_BAND_HEIGHT_PX}`,
        `waiting ${58 * cellPx} 0 ${2 * cellPx} ${SESSION_STRIP_HEIGHT_PX}`,
    ]);
    assertEqual(rectanglesOf(IDLE_HOUR), []);
    assertEqual(rectanglesOf('d'.repeat(20) + 'u'.repeat(40)), []);
});

test('sessionsTileContent: equal neighbours are one rectangle, and a whole hour of one state is one rectangle', () =>
    assertEqual({
        runs: rectanglesOf(`${'w'.repeat(30)}${'b'.repeat(20)}${'w'.repeat(10)}`),
        hour: rectanglesOf('w'.repeat(60)),
    }, {
        runs: ['working 0 7 60 7', 'waited 60 0 40 14', 'working 100 7 20 7'],
        hour: ['working 0 7 120 7'],
    }));

test('sessionsTileContent: a history under an hour is drawn against the strip\'s right end, empty on the left; a ' +
    'whole hour of waiting is amber from end to end', () =>
    assertEqual({
        tenMinutes: rectanglesOf('wwwwwiiibb'),
        hourOfWaiting: rectanglesOf('b'.repeat(60)),
    }, {
        tenMinutes: ['working 100 7 10 7', 'waiting 116 0 4 14'],
        hourOfWaiting: ['waiting 0 0 120 14'],
    }));

test('sessionsTileContent: the groups hold their rows in urgency order, and each group\'s count is its rows, ' +
    'whatever the source\'s own counts say', () => {
    const rows = [
        {...BASE_ROW, id: 'i-old', state: 'idle', idleSeconds: 900},
        {...BASE_ROW, id: 'w-small', memoryBytes: 1 * GIB}, {...BASE_ROW, id: 'w-large', memoryBytes: 5 * GIB},
        {...BASE_ROW, id: 'i-new', state: 'idle', idleSeconds: 30},
        {...BASE_ROW, id: 'b', state: 'blocked'},
    ];
    const {rowsByState, sessionCountByState} = sessionsTileContent.sessionsInGroups(rows);
    assertEqual({
        ids: Object.fromEntries(Object.entries(rowsByState).map(([state, groupRows]) =>
            [state, groupRows.map(row => row.id)])),
        sessionCountByState,
    }, {
        ids: {blocked: ['b'], working: ['w-large', 'w-small'], done: [], idle: ['i-new', 'i-old'], unknown: []},
        sessionCountByState: {blocked: 1, working: 2, done: 0, idle: 2, unknown: 0},
    });
});

test('sessionsTileContent: the header counts every session, then each state that has one in the groups\' order, ' +
    'and the memory of them all', () =>
    assertEqual(sessionsTileContent.sessionsTileHeader({
        sessionCountByState: {blocked: 3, working: 9, done: 0, idle: 28, unknown: 2}, totalMemoryBytes: 41.6 * GIB,
    }), {
        titleText: 'Sessions', countText: '42',
        stateCounts: [
            {state: 'blocked', countText: '3'},
            {state: 'working', countText: '9'},
            {state: 'idle', countText: '28'},
            {state: 'unknown', countText: '2'},
        ],
        totalMemoryText: '41.6G',
    }));

test('sessionsTileContent: a header with no session says 0 and nothing else, and a total memory not known is a ' +
    'dash', () =>
    assertEqual([
        sessionsTileContent.sessionsTileHeader({
            sessionCountByState: {blocked: 0, working: 0, done: 0, idle: 0, unknown: 0}, totalMemoryBytes: 0,
        }),
        sessionsTileContent.sessionsTileHeader({
            sessionCountByState: {blocked: 0, working: 1, done: 0, idle: 0, unknown: 0}, totalMemoryBytes: null,
        }).totalMemoryText,
    ], [{titleText: 'Sessions', countText: '0', stateCounts: [], totalMemoryText: null}, '—']));

test('sessionsTileContent: a group\'s heading, the same heading in a later column, and the line that counts the ' +
    'rows a group could not list', () =>
    assertEqual({
        headings: ['blocked', 'working', 'done', 'idle', 'unknown'].map(state =>
            sessionsTileContent.groupHeadingText(state)),
        continued: sessionsTileContent.continuedHeadingText('idle'),
        more: [1, 17].map(hiddenCount => sessionsTileContent.moreLineText(hiddenCount)),
        columnLabels: sessionsTileContent.SESSIONS_TILE_COLUMN_LABELS,
    }, {
        headings: ['Waiting on you', 'Working', 'Done', 'Idle', 'Unknown'],
        continued: 'Idle, continued',
        more: ['+1 more', '+17 more'],
        columnLabels: {stripStart: '1 h', stripEnd: 'now', age: 'idle', memory: 'mem'},
    }));

test('sessionsTileContent: the tile with nothing to list says why, in one line under its title: herdr not ' +
    'running and no data under the title alone, no sessions under "Sessions 0"; a stale source is cockpitFormat\'s ' +
    'line, as the drawing hands it', () =>
    assertEqual({
        herdrDown: sessionsTileContent.sessionsTileShortState(sessionsOf([], {herdrRunning: false})),
        unreadable: sessionsTileContent.sessionsTileShortState(sessionsOf(null)),
        absent: sessionsTileContent.sessionsTileShortState(null),
        empty: sessionsTileContent.sessionsTileShortState(sessionsOf([])),
        listed: sessionsTileContent.sessionsTileShortState(sessionsOf([BASE_ROW])),
        stale: noDataText(1_794_000_003_000_000, FIXED_CLOCK),
    }, {
        herdrDown: {lineText: 'herdr not running', isCountShown: false},
        unreadable: {lineText: 'no data', isCountShown: false},
        absent: {lineText: 'no data', isCountShown: false},
        empty: {lineText: 'no sessions', isCountShown: true},
        listed: null,
        stale: 'no data since 14:02',
    }));

test('sessionsTileContent: the tile draws a source with its rows alone: a mistyped count does not stop it', () =>
    assertEqual([
        sessionsOf([BASE_ROW]), sessionsOf([BASE_ROW], {counts: null}),
        sessionsOf([BASE_ROW], {totalMemoryBytes: null}),
        sessionsOf(null), null, undefined,
    ].map(sessions => sessionsTileContent.canDrawSessionsTile(sessions)), [true, true, true, false, false, false]));

test('sessionsTileContent: the tile has strip columns only where some row carries a history: an older service ' +
    'sends none', () =>
    assertEqual([
        [BASE_ROW], [{...BASE_ROW, stateHistory: null}, {...BASE_ROW, stateHistory: ''}],
        [{...BASE_ROW, stateHistory: null}], [],
    ].map(rows => sessionsTileContent.hasStateHistories(rows)), [true, true, false, false]));

test('sessionsTileContent: a wait has ended once any later minute follows it, of whatever state, and is drawn in the ' +
    'neutral ink; equal neighbours are one rectangle only where they touch', () =>
    assertEqual({
        waitThenIdle: rectanglesOf('bbii'),
        waitThenDone: rectanglesOf('bbdd'),
        waitThenUnknown: rectanglesOf('bbu'),
        workApart: rectanglesOf('wwiiww'),
    }, {
        waitThenIdle: ['waited 112 0 4 14'],
        waitThenDone: ['waited 112 0 4 14'],
        waitThenUnknown: ['waited 114 0 4 14'],
        workApart: ['working 108 7 4 7', 'working 116 7 4 7'],
    }));

test('sessionsTileContent: herdr not running is said before a source the tile cannot draw', () =>
    assertEqual(sessionsTileContent.sessionsTileShortState({herdrRunning: false, rows: null}),
        {lineText: 'herdr not running', isCountShown: false}));

test('sessionsTileContent: a state named like an Object member is in no group and stops nothing; a row that is not ' +
    'an object, or a history missing or not a string, carries no history', () =>
    assertEqual({
        counts: sessionsTileContent.sessionsInGroups(['constructor', '__proto__', 'toString', 'working']
            .map((state, index) => ({...BASE_ROW, id: `w1:p${index}`, state}))).sessionCountByState,
        histories: [
            [null], [{...BASE_ROW, stateHistory: undefined}], [{...BASE_ROW, stateHistory: 42}], [{id: 'w1:p1'}],
            [null, BASE_ROW],
        ].map(rows => sessionsTileContent.hasStateHistories(rows)),
    }, {
        counts: {blocked: 0, working: 1, done: 0, idle: 0, unknown: 0},
        histories: [false, false, false, false, true],
    }));

test('sessionsTileContent: a row writes its idle age as cockpitFormat does up to 99 days, and "99d+" from a hundred ' +
    'days, from its process\'s age too, so no age is wider than its cell\'s sample', () =>
    assertEqual({
        lastInDays: sessionsTileContent.rowAgeText(LAST_WRITTEN_AGE_SECONDS, false),
        older: sessionsTileContent.rowAgeText(OLDER_AGE_SECONDS, false),
        olderFromProcess: sessionsTileContent.rowAgeText(OLDER_AGE_SECONDS, true),
        aFewDaysFromProcess: sessionsTileContent.rowAgeText(3 * SECONDS_PER_DAY, true),
        notKnown: sessionsTileContent.rowAgeText(null, null),
        onTheRow: contentOf({idleSeconds: 1000 * SECONDS_PER_DAY}).ageText,
        mostDays: sessionsTileContent.MOST_WRITTEN_IDLE_DAYS,
    }, {
        lastInDays: '99d', older: '99d+', olderFromProcess: '99d+', aFewDaysFromProcess: '3d*', notKnown: '\u2014',
        onTheRow: '99d+', mostDays: 99,
    }));
