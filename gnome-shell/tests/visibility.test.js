// The desktop card while windows cover it: lib/visibility.js, which decides whether one window covers the card, and
// lib/cardRepaint.js, which decides what the card repaints (nothing while it is frozen, everything at once on the
// reveal, and a meter or the memory bar only when what it draws changed). card.js, stylesheet.css and extension.js are
// Shell glue that plain gjs cannot run, so the last rows read their sources for the rules the glue must keep: only app
// names ellipsize, the stylesheet keeps every class the card's earlier code sets, the card's fixed width fits its
// widest rows (measured with Pango, in the card's font), and extension.js wires the covered check and tears it down.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEqual} from './harness.js';
import {
    COCKPIT_CARD_CONTENT_WIDTH_PX, COMPACT_CARD_HEIGHT_AT_DEFAULT_TEXT_PX, COMPACT_METER_ROW_CLEARANCE_PX,
    COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX, COMPACT_PLOT_WIDTH_PX,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';
import {cardText} from '../extensions/resource-pulse@zvibaratz.github.io/lib/format.js';
// Read through the namespaces, so a missing export fails its rows rather than the whole run.
import * as compactCardGeometryModule
    from '../extensions/resource-pulse@zvibaratz.github.io/lib/compactCardGeometry.js';
import * as visibilityModule from '../extensions/resource-pulse@zvibaratz.github.io/lib/visibility.js';
import * as cardRepaintModule from '../extensions/resource-pulse@zvibaratz.github.io/lib/cardRepaint.js';

const EXTENSION_DIRECTORY_URI =
    GLib.uri_resolve_relative(import.meta.url, '../extensions/resource-pulse@zvibaratz.github.io/', GLib.UriFlags.NONE);
const [EXTENSION_DIRECTORY_PATH] = GLib.filename_from_uri(EXTENSION_DIRECTORY_URI);

// The covered rows' geometry, in stage pixels: a 1920 × 1080 primary monitor with a 32 px top bar, and the card at the
// top right of its work area, 24 px in.
const PRIMARY_MONITOR_RECT = {x: 0, y: 0, width: 1920, height: 1080};
const MAXIMIZED_WINDOW_RECT = {x: 0, y: 32, width: 1920, height: 1048};
const CARD_RECT = {x: 1480, y: 56, width: 416, height: 224};
/** The share of the card's width a window covers in the "99% is not covered" row. */
const NINETY_NINE_PERCENT = 0.99;
const ONE_PIXEL = 1;
/** How wide (or tall) a window beside the card is, in the rows where it only touches an edge. */
const NEIGHBOUR_WINDOW_SIZE_PX = 100;

// The repaint rows' snapshots, in the shape the client publishes. The pressure percents band as [1, 0, 0]; raising
// io to 30 bands it 2 (lib/pressure.js).
const GIB = 1024 ** 3;
const QUIET_PRESSURE = {cpu: 12, memory: 3, io: 0};
const IO_BOUND_PRESSURE = {cpu: 12, memory: 3, io: 30};
const SNAPSHOT = {
    cpuBusyPercent: 23,
    cpuClusters: null,
    memory: {usedBytes: 16.4 * GIB, totalBytes: 30.3 * GIB},
    swap: null,
    pressureAvg10: QUIET_PRESSURE,
    apps: null,
};
const BUSIER_SNAPSHOT = {...SNAPSHOT, cpuBusyPercent: 57};
const IO_BOUND_SNAPSHOT = {...SNAPSHOT, pressureAvg10: IO_BOUND_PRESSURE};
/** What the client publishes when the service went quiet: every number null. */
const NO_DATA_SNAPSHOT = {
    cpuBusyPercent: null,
    cpuClusters: null,
    memory: null,
    swap: null,
    pressureAvg10: {cpu: null, memory: null, io: null},
    apps: null,
};
/** The swap rows' Samples: one interval apart, on the service's monotonic clock, swap on disk from 512 MiB. */
const SAMPLE_INTERVAL_USEC = 2_000_000;
const FIRST_TAKEN_AT_USEC = 9_000_000_000;
const SWAP_BASE_DISK_BYTES = 512 * 1024 * 1024;
const SWAP_GROWTH_BYTES = 1024 * 1024;
/** Six Samples: the newest and the five before it, over which swap growth is judged. */
const SWAP_WINDOW_SAMPLES = 6;
const CLOCK_LABEL = '14:02';
const LATER_CLOCK_LABEL = '14:05';
const ALL_METER_INDEXES = [0, 1, 2];
const IO_METER_INDEX = 2;
/** How often a frozen card is repainted, and how often a Sample comes, in seconds. */
const FROZEN_REPAINT_SECONDS = 30;
const SAMPLE_TICK_SECONDS = 2;
/** How long the frozen-repaint row runs the Samples for: past its second repaint. */
const FROZEN_RUN_SECONDS = 62;
/** The tick from which a covered card's cover is checked again: 30 s of Samples, the frozen cards' repaint interval. */
const COVER_BACKSTOP_TICK = 15;
const USEC_PER_SECOND = 1_000_000;
const ONE_USEC = 1;

// The stylesheet classes the card's code set before the cockpit block was added. GNOME re-reads the stylesheet on every
// enable but the code only at login, so until the next login that code meets this stylesheet: every one of these must
// keep its rule.
const V1_STYLESHEET_CLASS_NAMES = [
    'resource-pulse-graphs', 'resource-pulse-hover-label', 'resource-pulse-card', 'resource-pulse-card-meters',
    'resource-pulse-card-figure', 'resource-pulse-card-label', 'resource-pulse-card-suffix',
    'resource-pulse-card-cpu-figure', 'resource-pulse-card-details', 'resource-pulse-card-detail-row',
    'resource-pulse-card-pressure-meters', 'resource-pulse-card-pressure-group',
];
// The classes the card's code set after that, before the compact card: they keep their rules for the same reason.
const EARLIER_CARD_CLASS_NAMES = ['rp-card-fixed', 'rp-card-heaviest-parts'];
const COMPACT_CARD_CLASS_NAME = 'rp-compact-card';
const TILE_SURFACE_CLASS_NAME = 'rp-tile-surface';
// The compact card's text classes, each with a colour of its own, and its now rule, drawn in a background colour.
const SECTION_NAME_CLASS_NAME = 'rp-compact-section-name';
const HEAVIEST_NAME_CLASS_NAME = 'rp-compact-heaviest-name';
const HEAVIEST_VALUE_CLASS_NAME = 'rp-compact-heaviest-value';
const FIGURE_CLASS_NAME = 'rp-compact-figure';
const UNIT_CLASS_NAME = 'rp-compact-unit';
const DETAIL_CLASS_NAME = 'rp-compact-detail';
const METER_NAME_CLASS_NAME = 'rp-compact-meter-name';
const METER_PERCENT_CLASS_NAME = 'rp-compact-meter-percent';
const AXIS_LABEL_CLASS_NAME = 'rp-compact-axis-label';
const COMPACT_TEXT_CLASS_NAMES = [
    SECTION_NAME_CLASS_NAME, HEAVIEST_NAME_CLASS_NAME, HEAVIEST_VALUE_CLASS_NAME, FIGURE_CLASS_NAME,
    'rp-compact-figure-missing', UNIT_CLASS_NAME, DETAIL_CLASS_NAME, METER_NAME_CLASS_NAME, METER_PERCENT_CLASS_NAME,
    AXIS_LABEL_CLASS_NAME, 'rp-compact-axis-now', 'rp-compact-wait',
];
const NOW_RULE_CLASS_NAME = 'rp-compact-now-rule';
/** The style property that holds the now column's width. */
const NOW_COLUMN_WIDTH_PROPERTY_NAME = '-rp-now-column-width';
/** The card's padding: top, sides and bottom. */
const CARD_PADDING_LENGTH_COUNT = 3;
// The frozen card's dim: card.js's pseudo-class, the stylesheet property it reads for its drawings' opacity, the
// stylesheet selector of the frozen card, and the share of itself every colour keeps under it.
const FROZEN_PSEUDO_CLASS_NAME = 'frozen';
const GRAPH_OPACITY_PROPERTY_NAME = '-rp-graph-opacity';
const FROZEN_CARD_SELECTOR = `.${COMPACT_CARD_CLASS_NAME}:${FROZEN_PSEUDO_CLASS_NAME}`;
const FROZEN_SHARE = 0.42;
/** How far a dimmed alpha may stand from the exact share: the stylesheet writes alphas to two places. */
const COLOUR_ALPHA_TOLERANCE = 0.01;
/** `rgba(r, g, b, a)` and `#rrggbb`: the CSS colours the card's stylesheet uses. */
const CSS_RGBA_PATTERN = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/;
const CSS_HEX_COLOUR_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
/** What card.js's trace painter scales by the opacity: four colours and the area's alpha. */
const TRACE_INK_ENTRY_COUNT = 5;
/** The colours its meter painter scales: the fill (white or amber), the groove and the no-data dash. */
const METER_COLOUR_COUNT = 3;

// The card's text, as GNOME on Ubuntu draws it: the card's own font family at the shell's 11 pt font-name
// ("Ubuntu Sans 11"), at 96 dpi with no text scaling, with tabular digits.
const CARD_FONT_FAMILY = 'Ubuntu Sans';
const SHELL_FONT_SIZE_PT = 11;
const FONT_RESOLUTION_DPI = 96;
const POINTS_PER_INCH = 72;
const EM_PX = SHELL_FONT_SIZE_PT * FONT_RESOLUTION_DPI / POINTS_PER_INCH;
const TABULAR_DIGITS_FEATURE = 'tnum';
/**
 * How much of each long app name the widest section line still shows before its ellipsis: at the full plot, and at the
 * least one a cell leaves it.
 */
const HEAVIEST_NAME_SHOWN_CHARS = 10;
const HEAVIEST_NAME_SHOWN_CHARS_AT_LEAST_PLOT = 8;
const ELLIPSIS = '…';
/** A CSS length the width row reads from the stylesheet: a number and px or em. */
const CSS_LENGTH_PATTERN = /^([\d.]+)(px|em)$/;
const CSS_FIRST_FONT_FAMILY_PATTERN = /^\s*"([^"]+)"/;
const NORMAL_FONT_WEIGHT = 400;
// The widest values each row of the card can show.
const LATEST_CLOCK_LABEL = '23:58';
const FULL_CPU_SNAPSHOT = {
    ...SNAPSHOT, cpuBusyPercent: 100, cpuClusters: {performancePercent: 100, efficiencyPercent: 100},
};
/** A machine just under 100 GiB in every amount: the widest lines the now column holds within its width. */
const NINETY_NINE_GIB = 99.9 * GIB;
const NINETY_NINE_GIB_SNAPSHOT = {
    ...SNAPSHOT,
    memory: {usedBytes: NINETY_NINE_GIB, totalBytes: NINETY_NINE_GIB},
    swap: {zramUsedBytes: NINETY_NINE_GIB, zramRamBytes: NINETY_NINE_GIB, diskBytes: NINETY_NINE_GIB},
};
/** Every resource waited on all of the time: each meter's row at its widest, "100%". */
const FULL_PRESSURE_SNAPSHOT = {...SNAPSHOT, pressureAvg10: {cpu: 100, memory: 100, io: 100}};
const LARGE_MACHINE_SNAPSHOT = {
    ...SNAPSHOT,
    memory: {usedBytes: 123.4 * GIB, totalBytes: 125.6 * GIB},
    swap: {zramUsedBytes: 123.4 * GIB, zramRamBytes: 12.3 * GIB, diskBytes: 123.4 * GIB},
    apps: {
        topCpu: {groupKey: 'app:code', name: 'Visual Studio Code', cpuPercent: 100},
        topMemory: {groupKey: 'unit:calendar', name: 'gnome-shell-calendar-server', memoryBytes: 123.4 * GIB},
    },
};

const CSS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
/** One CSS rule: its selector list, then its declarations. */
const CSS_RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const CSS_CLASS_SELECTOR_PATTERN = /\.([A-Za-z][\w-]*)/g;
const CSS_DECLARATION_PATTERN = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/;
/** A line of card.js that sets a label's ellipsizing, in any of the forms GJS allows. */
const ELLIPSIZE_SETTING_PATTERN = /\.ellipsize\s*=|\bellipsize\s*:|set_ellipsize\s*\(/;
const COMMENT_LINE_PATTERN = /^\s*(\/\/|\*|\/\*)/;
/** `<receiver>.connectObject(<signal, handler pairs>, this);`, the arguments possibly over several lines. */
const CONNECT_OBJECT_PATTERN = /([\w.]+)\.connectObject\(([\s\S]*?)\bthis\);/g;
const QUOTED_SIGNAL_NAME_PATTERN = /'([\w:-]+)'/g;
const DISCONNECT_OBJECT_PATTERN = /([\w.]+)\??\.disconnectObject\(this\)/g;
/** extension.js names its card this._card, and its teardown reads it into a local, card. */
const OWN_FIELD_PREFIX_PATTERN = /^this\._/;
/** One `'signal', handler` pair of a connectObject call, the handler up to the next comma. */
const SIGNAL_HANDLER_PAIR_PATTERN = /'([\w:-]+)',\s*([^,]+?)\s*,/g;
/**
 * The receivers the covered check connects to: in _followCardCover, and in _startFollowingCoveringWindow, whose
 * receiver is each window that covers the card.
 */
const COVER_SIGNAL_RECEIVERS = new Set([
    'global.display', 'global.window_manager', 'global.workspace_manager', 'metaWindow',
]);
// The client's two kinds of listener, counted apart: a history listener added must be removed as one, since
// removeListener on its id is a silent no-op on the other kind's map. A snapshot listener is the pulse client's
// (extension.js's this._client, or client in teardown); the cockpit client's listeners (this._cockpitClient, or
// cockpitClient in teardown) are its one kind, counted apart too. Both are also counted on any receiver, so a listener
// added through another name (an alias, a new client) cannot go unseen.
const ADD_HISTORY_LISTENER_PATTERN = /\.addHistoryListener\(/g;
const ADD_ANY_LISTENER_PATTERN = /\.addListener\(/g;
const REMOVE_ANY_LISTENER_PATTERN = /\.removeListener\(/g;
const REMOVE_HISTORY_LISTENER_PATTERN = /\.removeHistoryListener\(/g;
const ADD_SNAPSHOT_LISTENER_PATTERN = /(?<![\w.])(?:this\._)?client\??\.addListener\(/g;
const REMOVE_SNAPSHOT_LISTENER_PATTERN = /(?<![\w.])(?:this\._)?client\??\.removeListener\(/g;
const ADD_COCKPIT_LISTENER_PATTERN = /(?<![\w.])(?:this\._)?cockpitClient\??\.addListener\(/g;
const REMOVE_COCKPIT_LISTENER_PATTERN = /(?<![\w.])(?:this\._)?cockpitClient\??\.removeListener\(/g;
/** How far extension.js indents a class method's own statements; one level more is inside an if. */
const METHOD_STATEMENT_INDENT = ' '.repeat(8);

/**
 * Reads a file of the extension as text (tests may block).
 *
 * @param {string} fileName - Its path inside the extension directory.
 * @returns {string} Its contents.
 */
function readExtensionFile(fileName) {
    const path = GLib.build_filenamev([EXTENSION_DIRECTORY_PATH, fileName]);
    const [, contentBytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(contentBytes);
}

/**
 * The body of a top-level function or a class method: from its declaration line to the first line that closes it at
 * the declaration's own indent.
 *
 * @param {string} sourceText - The file's text.
 * @param {string} declarationLine - The declaration as it starts its line, for example 'function newCardLabel('.
 * @returns {string} The lines of the body, or '' when there is no such declaration.
 */
function declarationBody(sourceText, declarationLine) {
    const lines = sourceText.split('\n');
    const startIndex = lines.findIndex(line => line.trimStart().startsWith(declarationLine));
    if (startIndex < 0)
        return '';
    const indent = lines[startIndex].length - lines[startIndex].trimStart().length;
    const closingLine = `${' '.repeat(indent)}}`;
    const endIndex = lines.findIndex((line, lineIndex) => lineIndex > startIndex && line === closingLine);
    return lines.slice(startIndex, endIndex < 0 ? undefined : endIndex + 1).join('\n');
}

/**
 * The trimmed lines of a declaration body, for rows that look for one statement.
 *
 * @param {string} bodyText - What declarationBody returned.
 * @returns {string[]} Its lines, trimmed.
 */
const trimmedLines = bodyText => bodyText.split('\n').map(line => line.trim());

/**
 * How many lines of a body are exactly a statement.
 *
 * @param {string} bodyText - What declarationBody returned.
 * @param {string} statement - The statement, trimmed.
 * @returns {number} Its count.
 */
const statementCount = (bodyText, statement) => trimmedLines(bodyText).filter(line => line === statement).length;

/**
 * The handler of each signal that a source text's connectObject calls connect.
 *
 * @param {string} sourceText - A body, or a whole file.
 * @returns {string[]} '<receiver> <signal>: <handler>' for each pair, in order.
 */
function connectedSignalHandlers(sourceText) {
    return [...sourceText.matchAll(CONNECT_OBJECT_PATTERN)].flatMap(([, receiver, connectArguments]) =>
        [...connectArguments.matchAll(SIGNAL_HANDLER_PAIR_PATTERN)]
            .map(([, signalName, handler]) => `${receiver} ${signalName}: ${handler}`));
}

/**
 * Every rule of a stylesheet, comments removed.
 *
 * @param {string} stylesheetText - The stylesheet.
 * @returns {Array<{classNames: string[], declarations: Object<string, string>}>} Each rule's class selectors and its
 *     declarations by property name.
 */
function stylesheetRules(stylesheetText) {
    const uncommentedText = stylesheetText.replace(CSS_COMMENT_PATTERN, '');
    return [...uncommentedText.matchAll(CSS_RULE_PATTERN)].map(([, selectorText, declarationText]) => {
        const classNames = [...selectorText.matchAll(CSS_CLASS_SELECTOR_PATTERN)].map(([, className]) => className);
        const declarationEntries = declarationText.split(';')
            .map(declaration => CSS_DECLARATION_PATTERN.exec(declaration))
            .filter(declarationMatch => declarationMatch !== null)
            .map(([, propertyName, value]) => [propertyName, value]);
        return {selectorText: selectorText.trim(), classNames, declarations: Object.fromEntries(declarationEntries)};
    });
}

/**
 * The declarations of the rules whose selector is exactly one class.
 *
 * @param {ReturnType<typeof stylesheetRules>} rules - The stylesheet's rules.
 * @param {string} className - The class.
 * @returns {Object<string, string>} Its declarations merged, or {} when no rule selects it alone.
 */
function declarationsOfClass(rules, className) {
    const ownRules = rules.filter(rule => rule.classNames.length === 1 && rule.classNames[0] === className);
    return Object.assign({}, ...ownRules.map(rule => rule.declarations));
}

/**
 * The parts of a repaint plan a row compares, or null when there is no plan.
 *
 * @param {object|null} repaintPlan - What CardRepaintPlanner returned.
 * @returns {object|null} Its CPU figure and the meters it repaints.
 */
function summarizeRepaintPlan(repaintPlan) {
    if (repaintPlan === null)
        return null;
    const {text, changedMeterIndexes} = repaintPlan;
    return {cpuFigure: text.cpuFigure.figure, changedMeterIndexes};
}

/**
 * One line for a planner step: what it rendered (its CPU figure, whether it is dimmed, and whether it changes the dim),
 * or nothing.
 *
 * @param {[string, object|null]} step - The step's name and the plan it returned.
 * @returns {string} For example 'freeze: 23 dimmed=true dimChanged=true', or 'freeze again: nothing'.
 */
function describeDimStep([stepName, repaintPlan]) {
    if (repaintPlan === null)
        return `${stepName}: nothing`;
    const {text, isDimmed, isDimChanged} = repaintPlan;
    return `${stepName}: ${text.cpuFigure.figure} dimmed=${isDimmed} dimChanged=${isDimChanged}`;
}

/**
 * The meters a plan redraws (it redraws both traces every time), or null when there is no plan.
 *
 * @param {object|null} repaintPlan - What CardRepaintPlanner returned.
 * @returns {number[]|null} The meters' indexes.
 */
const redrawnMeters = repaintPlan => (repaintPlan === null ? null : repaintPlan.changedMeterIndexes);

/**
 * What the card asks the planner to show: a snapshot and the clock label of the last good one.
 *
 * @param {object|null} snapshot - The snapshot.
 * @param {string|null} [lastGoodClockLabel] - 'HH:MM'.
 * @returns {{snapshot: object|null, lastGoodClockLabel: string|null}} The input.
 */
const shownState = (snapshot, lastGoodClockLabel = CLOCK_LABEL) => ({snapshot, lastGoodClockLabel});

/**
 * A snapshot of one Sample of the swap rows: the n-th, one interval after the one before, with swap on disk grown by
 * the bytes given.
 *
 * @param {number} sampleIndex - Which Sample, from 0.
 * @param {number} growthBytes - Swap on disk above the base.
 * @returns {object} The snapshot.
 */
const swapSampleSnapshot = (sampleIndex, growthBytes) => ({
    ...SNAPSHOT,
    takenAtUsec: FIRST_TAKEN_AT_USEC + sampleIndex * SAMPLE_INTERVAL_USEC,
    swap: {zramUsedBytes: 0, zramRamBytes: 0, diskBytes: SWAP_BASE_DISK_BYTES + growthBytes},
});

/**
 * Whether a plan draws the swap-on-disk line amber.
 *
 * @param {object|null} repaintPlan - What CardRepaintPlanner returned.
 * @returns {boolean|null} The disk line's amber; null with no plan.
 */
const isDiskLineAmber = repaintPlan => (repaintPlan === null ? null : repaintPlan.text.memoryDetailLines.at(-1).isWait);

/**
 * What the cover fallback timer must do (lib/visibility.js coverFallbackTimerChange), read through the namespace.
 *
 * @param {{isCovered: boolean, isServiceLive: boolean, isTimerRunning: boolean}} state - The cover, the service and
 *     the timer.
 * @returns {string} 'start', 'stop' or 'none'.
 */
const fallbackTimerChange = state => visibilityModule.coverFallbackTimerChange(state);

test('visibility: a maximized window containing the card covers it; one covering 99% of it does not', () => {
    const ninetyNinePercentRect = {...CARD_RECT, width: CARD_RECT.width * NINETY_NINE_PERCENT};
    assertEqual([
        visibilityModule.isRectFullyCovered(CARD_RECT, [MAXIMIZED_WINDOW_RECT]),
        visibilityModule.isRectFullyCovered(CARD_RECT, [ninetyNinePercentRect]),
    ], [true, false]);
});

test('visibility: with no windows the card is not covered', () =>
    assertEqual(visibilityModule.isRectFullyCovered(CARD_RECT, []), false));

test('visibility: edges count as inside: a window exactly the card covers it, one a pixel short on any side does ' +
    'not, and windows that only touch its edges do not', () => {
    const onePixelShortRects = {
        left: {...CARD_RECT, x: CARD_RECT.x + ONE_PIXEL, width: CARD_RECT.width - ONE_PIXEL},
        top: {...CARD_RECT, y: CARD_RECT.y + ONE_PIXEL, height: CARD_RECT.height - ONE_PIXEL},
        right: {...CARD_RECT, width: CARD_RECT.width - ONE_PIXEL},
        bottom: {...CARD_RECT, height: CARD_RECT.height - ONE_PIXEL},
    };
    const touchingRects = [
        {...CARD_RECT, x: CARD_RECT.x - NEIGHBOUR_WINDOW_SIZE_PX, width: NEIGHBOUR_WINDOW_SIZE_PX},
        {...CARD_RECT, x: CARD_RECT.x + CARD_RECT.width, width: NEIGHBOUR_WINDOW_SIZE_PX},
        {...CARD_RECT, y: CARD_RECT.y - NEIGHBOUR_WINDOW_SIZE_PX, height: NEIGHBOUR_WINDOW_SIZE_PX},
        {...CARD_RECT, y: CARD_RECT.y + CARD_RECT.height, height: NEIGHBOUR_WINDOW_SIZE_PX},
    ];
    const isCoveredBy = windowRects => visibilityModule.isRectFullyCovered(CARD_RECT, windowRects);
    assertEqual({
        exactlyTheCard: isCoveredBy([{...CARD_RECT}]),
        onePixelShort: Object.fromEntries(
            Object.entries(onePixelShortRects).map(([side, windowRect]) => [side, isCoveredBy([windowRect])])),
        touchingEveryEdge: isCoveredBy(touchingRects),
    }, {
        exactlyTheCard: true,
        onePixelShort: {left: false, top: false, right: false, bottom: false},
        touchingEveryEdge: false,
    });
});

test('visibility: only one window covers the card: two that cover it only together leave it visible', () => {
    const halfWidth = CARD_RECT.width / 2;
    const leftHalfRect = {...CARD_RECT, width: halfWidth};
    const rightHalfRect = {...CARD_RECT, x: CARD_RECT.x + halfWidth, width: halfWidth};
    assertEqual(visibilityModule.isRectFullyCovered(CARD_RECT, [leftHalfRect, rightHalfRect]), false);
});

test('visibility: a card with no area yet is never covered, even under a maximized window', () =>
    assertEqual([
        visibilityModule.isRectFullyCovered({...CARD_RECT, width: 0}, [MAXIMIZED_WINDOW_RECT]),
        visibilityModule.isRectFullyCovered({...CARD_RECT, height: 0}, [MAXIMIZED_WINDOW_RECT]),
    ], [false, false]));

test('visibility: a window can cover the card only when it is a normal or dialog window, not minimized, showing ' +
    'and on the active workspace (its frame is read only then, for the overlap with the primary monitor)', () => {
    const coveringWindow = {isNormalOrDialog: true, isMinimized: false, isShowing: true, isOnActiveWorkspace: true};
    const canCoverWithOneChanged = Object.keys(coveringWindow).map(conditionName => {
        const changedWindow = {...coveringWindow, [conditionName]: !coveringWindow[conditionName]};
        return `${conditionName}: ${visibilityModule.canWindowCoverCard(changedWindow)}`;
    });
    assertEqual([visibilityModule.canWindowCoverCard(coveringWindow), ...canCoverWithOneChanged], [
        true,
        'isNormalOrDialog: false',
        'isMinimized: false',
        'isShowing: false',
        'isOnActiveWorkspace: false',
    ]);
});

test('visibility: the windows covering the card are the ones whose rectangle contains all of it, the rule ' +
    'isCardCovered applies; a card with no area has none', () => {
    const ninetyNinePercentRect = {...CARD_RECT, width: CARD_RECT.width * NINETY_NINE_PERCENT};
    const touchingRect = {...CARD_RECT, x: CARD_RECT.x + CARD_RECT.width, width: NEIGHBOUR_WINDOW_SIZE_PX};
    const windowRects = [MAXIMIZED_WINDOW_RECT, ninetyNinePercentRect, {...CARD_RECT}, touchingRect];
    const coveringIndexes = cardRect => visibilityModule.indexesOfRectsCoveringCard({cardRect, windowRects});
    assertEqual({
        covering: coveringIndexes(CARD_RECT),
        withNoArea: coveringIndexes({...CARD_RECT, width: 0}),
        withNoWindows: visibilityModule.indexesOfRectsCoveringCard({cardRect: CARD_RECT, windowRects: []}),
    }, {covering: [0, 2], withNoArea: [], withNoWindows: []});
});

test('visibility: the covering windows are followed by difference: one that starts covering the card is followed, ' +
    'one that stops is released, and the same set in any order follows and releases nothing', () => {
    const [firstWindow, secondWindow, thirdWindow] = ['first', 'second', 'third'].map(name => ({name}));
    const firstWindowAgain = {name: 'first'};
    const describeChanges = (heldWindows, coveringWindows) => {
        const {windowsToFollow, windowsToRelease} =
            visibilityModule.coveringWindowChanges({heldWindows, coveringWindows});
        return {follow: windowsToFollow.map(({name}) => name), release: windowsToRelease.map(({name}) => name)};
    };
    assertEqual({
        changed: describeChanges([firstWindow, secondWindow], [secondWindow, thirdWindow]),
        sameInAnotherOrder: describeChanges([firstWindow, secondWindow], [secondWindow, firstWindow]),
        anotherWindowOfTheSameName: describeChanges([firstWindow], [firstWindowAgain]),
        noneHeldNoneCovering: describeChanges([], []),
    }, {
        changed: {follow: ['third'], release: ['first']},
        sameInAnotherOrder: {follow: [], release: []},
        anotherWindowOfTheSameName: {follow: ['first'], release: ['first']},
        noneHeldNoneCovering: {follow: [], release: []},
    });
});

test('visibility: the cover is checked on every tick while the card is visible', () =>
    assertEqual(visibilityModule.isCoverBackstopDue({isCovered: false, ticksSinceCoverCheck: 0}), true));

test('visibility: a covered card is checked again from the fifteenth tick, not before', () => {
    const isDueAfterTicks = ticksSinceCoverCheck =>
        visibilityModule.isCoverBackstopDue({isCovered: true, ticksSinceCoverCheck});
    assertEqual([COVER_BACKSTOP_TICK - 1, COVER_BACKSTOP_TICK, COVER_BACKSTOP_TICK + 1].map(isDueAfterTicks),
        [false, true, true]);
});

test('visibility: the fallback timer starts for a covered card whose service is silent', () =>
    assertEqual(fallbackTimerChange({isCovered: true, isServiceLive: false, isTimerRunning: false}), 'start'));

test('visibility: the fallback timer stops when the service is live again or the card is revealed', () =>
    assertEqual({
        liveAgain: fallbackTimerChange({isCovered: true, isServiceLive: true, isTimerRunning: true}),
        revealed: fallbackTimerChange({isCovered: false, isServiceLive: false, isTimerRunning: true}),
        revealedAndLive: fallbackTimerChange({isCovered: false, isServiceLive: true, isTimerRunning: true}),
    }, {liveAgain: 'stop', revealed: 'stop', revealedAndLive: 'stop'}));

test('visibility: the fallback timer changes nothing otherwise', () =>
    assertEqual({
        coveredSilentRunning: fallbackTimerChange({isCovered: true, isServiceLive: false, isTimerRunning: true}),
        coveredLiveStopped: fallbackTimerChange({isCovered: true, isServiceLive: true, isTimerRunning: false}),
        visibleSilentStopped: fallbackTimerChange({isCovered: false, isServiceLive: false, isTimerRunning: false}),
        visibleLiveStopped: fallbackTimerChange({isCovered: false, isServiceLive: true, isTimerRunning: false}),
    }, {coveredSilentRunning: 'none', coveredLiveStopped: 'none', visibleSilentStopped: 'none',
        visibleLiveStopped: 'none'}));

test('visibility: rectangles overlap only when they share area: touching along an edge or at a corner is not ' +
    'overlapping', () => {
    const rightOfPrimaryRect = {x: PRIMARY_MONITOR_RECT.width, y: 0, width: 800, height: 600};
    const overlaps = windowRect => visibilityModule.doRectsOverlap(windowRect, PRIMARY_MONITOR_RECT);
    assertEqual({
        maximized: overlaps(MAXIMIZED_WINDOW_RECT),
        onePixelOver: overlaps({...rightOfPrimaryRect, x: rightOfPrimaryRect.x - ONE_PIXEL}),
        touchingTheRightEdge: overlaps(rightOfPrimaryRect),
        touchingTheBottomRightCorner: overlaps({...rightOfPrimaryRect, y: PRIMARY_MONITOR_RECT.height}),
        noArea: overlaps({...CARD_RECT, width: 0}),
    }, {
        maximized: true, onePixelOver: true, touchingTheRightEdge: false, touchingTheBottomRightCorner: false,
        noArea: false,
    });
});

test('visibility: a fullscreen monitor covers the card on it even with no window over it; otherwise the windows ' +
    'decide', () => {
    const isCovered = (isMonitorInFullscreen, windowRects) =>
        visibilityModule.isCardCovered({isMonitorInFullscreen, cardRect: CARD_RECT, windowRects});
    assertEqual([isCovered(true, []), isCovered(false, []), isCovered(false, [MAXIMIZED_WINDOW_RECT])],
        [true, false, true]);
});

test('visibility: every drawn card is checked on its own (cardsCover): a card one window contains is covered, one ' +
    'only partly under a window is visible; the windows followed are those containing any card, once each, in ' +
    'order; a fullscreen monitor covers every card', () => {
    const neighbourCardRect = {...CARD_RECT, y: CARD_RECT.y + CARD_RECT.height + NEIGHBOUR_WINDOW_SIZE_PX};
    const overFirstCardRect = {...CARD_RECT};
    const overBothCardsRect = {x: CARD_RECT.x, y: CARD_RECT.y, width: CARD_RECT.width,
        height: neighbourCardRect.y + neighbourCardRect.height - CARD_RECT.y};
    const partlyOverNeighbourRect = {...neighbourCardRect, width: neighbourCardRect.width - ONE_PIXEL};
    const cards = [{cardId: 'system', rect: CARD_RECT}, {cardId: 'apps', rect: neighbourCardRect}];
    const cover = (isMonitorInFullscreen, windowRects) =>
        visibilityModule.cardsCover({cards, isMonitorInFullscreen, windowRects});
    assertEqual({
        firstCovered: cover(false, [partlyOverNeighbourRect, overFirstCardRect]),
        bothUnderOneWindow: cover(false, [overBothCardsRect, overFirstCardRect]),
        noWindows: cover(false, []),
        fullscreen: cover(true, [overFirstCardRect]),
    }, {
        firstCovered: {isEveryCardCovered: false, coveredCardIds: ['system'], visibleCardIds: ['apps'],
            coveringWindowIndexes: [1]},
        bothUnderOneWindow: {isEveryCardCovered: true, coveredCardIds: ['system', 'apps'], visibleCardIds: [],
            coveringWindowIndexes: [0, 1]},
        noWindows: {isEveryCardCovered: false, coveredCardIds: [], visibleCardIds: ['system', 'apps'],
            coveringWindowIndexes: []},
        fullscreen: {isEveryCardCovered: true, coveredCardIds: ['system', 'apps'], visibleCardIds: [],
            coveringWindowIndexes: [0]},
    });
});

test('visibility: with no card drawn (a layout naming none this release knows) every card counts as covered, so ' +
    'nothing is checked on every tick and no watch is held for it', () =>
    assertEqual(visibilityModule.cardsCover({cards: [], isMonitorInFullscreen: false, windowRects: []}), {
        isEveryCardCovered: true, coveredCardIds: [], visibleCardIds: [], coveringWindowIndexes: [],
    }));

test('visibility: a card newly covered is stamped as painted now (its freeze), one still covered keeps its stamp, ' +
    'and a revealed card loses its stamp (frozenPaintStamps)', () => {
    const systemPaintedAtUsec = 7 * USEC_PER_SECOND;
    const appsPaintedAtUsec = 9 * USEC_PER_SECOND;
    const nowUsec = 40 * USEC_PER_SECOND;
    assertEqual(visibilityModule.frozenPaintStamps({
        stampsByCardId: {system: systemPaintedAtUsec, apps: appsPaintedAtUsec},
        coveredCardIds: ['system', 'sessions'],
        nowUsec,
    }), {system: systemPaintedAtUsec, sessions: nowUsec});
});

test('card repaint: an unfrozen card renders every snapshot, and its first render repaints all three meters', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    assertEqual(summarizeRepaintPlan(planner.show(shownState(SNAPSHOT))),
        {cpuFigure: '23', changedMeterIndexes: ALL_METER_INDEXES});
});

test('card repaint: a meter repaints only when what it draws changes: its band, and its amber from band 2', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    planner.show(shownState(SNAPSHOT));
    assertEqual([
        planner.show(shownState(BUSIER_SNAPSHOT)),
        planner.show(shownState(IO_BOUND_SNAPSHOT)),
        planner.show(shownState(IO_BOUND_SNAPSHOT)),
    ].map(summarizeRepaintPlan), [
        {cpuFigure: '57', changedMeterIndexes: []},
        {cpuFigure: '23', changedMeterIndexes: [IO_METER_INDEX]},
        {cpuFigure: '23', changedMeterIndexes: []},
    ]);
});

test('card repaint: data after no data repaints all three meters', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    planner.show(shownState(NO_DATA_SNAPSHOT));
    assertEqual(redrawnMeters(planner.show(shownState(SNAPSHOT))), ALL_METER_INDEXES);
});

test('card repaint: every snapshot told counts toward swap growth, frozen or not, and the same one told again at a ' +
    'reveal counts once; a Sample the card was not told of starts the count again', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    const plans = [];
    for (let sampleIndex = 0; sampleIndex < SWAP_WINDOW_SAMPLES - 1; sampleIndex++) {
        if (sampleIndex === 2)
            planner.setFrozen(true);
        plans.push(planner.show(shownState(swapSampleSnapshot(sampleIndex, 0))));
    }
    const reveal = planner.setFrozen(false);
    const repeatedAtReveal = planner.show(shownState(swapSampleSnapshot(SWAP_WINDOW_SAMPLES - 2, 0)));
    const grown = planner.show(shownState(swapSampleSnapshot(SWAP_WINDOW_SAMPLES - 1, SWAP_GROWTH_BYTES)));
    const afterHole = planner.show(shownState(swapSampleSnapshot(SWAP_WINDOW_SAMPLES + 1, 2 * SWAP_GROWTH_BYTES)));
    assertEqual({
        beforeFreeze: plans.slice(0, 2).map(isDiskLineAmber),
        whileFrozen: plans.slice(2),
        reveal: isDiskLineAmber(reveal),
        repeatedAtReveal: isDiskLineAmber(repeatedAtReveal),
        grown: isDiskLineAmber(grown),
        afterHole: isDiskLineAmber(afterHole),
    }, {
        beforeFreeze: [false, false], whileFrozen: [null, null, null], reveal: false, repeatedAtReveal: false,
        grown: true, afterHole: false,
    });
});

test('card repaint: while frozen a snapshot is only recorded; unfreezing renders at once from the latest one, with ' +
    'its clock label', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    planner.show(shownState(SNAPSHOT));
    planner.setFrozen(true);
    const plansWhileFrozen = [
        planner.show(shownState(BUSIER_SNAPSHOT)),
        planner.show(shownState(NO_DATA_SNAPSHOT, LATER_CLOCK_LABEL)),
    ];
    const reveal = planner.setFrozen(false);
    assertEqual({
        plansWhileFrozen: plansWhileFrozen.map(summarizeRepaintPlan),
        reveal: summarizeRepaintPlan(reveal),
        revealLine: reveal?.text.cpuDetailLines[0].text,
    }, {
        plansWhileFrozen: [null, null],
        reveal: {cpuFigure: '—', changedMeterIndexes: ALL_METER_INDEXES},
        revealLine: 'no data since 14:05',
    });
});

test('card repaint: freezing and unfreezing each render once (the freeze dimmed, the reveal at once and undimmed), ' +
    'and setFrozen to the state the card already has does nothing: a second freeze or unfreeze renders nothing', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    planner.show(shownState(SNAPSHOT));
    const plans = [
        planner.setFrozen(false),
        planner.setFrozen(true),
        planner.setFrozen(true),
        planner.setFrozen(false),
        planner.setFrozen(false),
    ];
    assertEqual(plans.map(repaintPlan => repaintPlan !== null), [false, true, false, true, false]);
});

test('card repaint: a frozen repaint compares with what is drawn, so a band that changed while frozen and changed ' +
    'back repaints no meter', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    planner.show(shownState(SNAPSHOT));
    planner.setFrozen(true);
    planner.show(shownState(IO_BOUND_SNAPSHOT));
    planner.show(shownState(SNAPSHOT));
    assertEqual(redrawnMeters(planner.repaintFrozen()), []);
});

test('card repaint: the dim follows the freeze exactly: freezing renders once, dimmed (card.js adds the frozen ' +
    'pseudo-class); a frozen repaint renders the latest state, still dimmed; unfreezing renders at once, undimmed ' +
    '(the pseudo-class removed); nothing else changes the dim', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    const steps = [
        ['live', planner.show(shownState(SNAPSHOT))],
        ['freeze', planner.setFrozen(true)],
        ['freeze again', planner.setFrozen(true)],
        ['sample while frozen', planner.show(shownState(BUSIER_SNAPSHOT))],
        ['frozen repaint', planner.repaintFrozen()],
        ['unfreeze', planner.setFrozen(false)],
        ['unfreeze again', planner.setFrozen(false)],
        ['frozen repaint while live', planner.repaintFrozen()],
        ['live again', planner.show(shownState(SNAPSHOT))],
    ];
    assertEqual(steps.map(describeDimStep), [
        'live: 23 dimmed=false dimChanged=false',
        'freeze: 23 dimmed=true dimChanged=true',
        'freeze again: nothing',
        'sample while frozen: nothing',
        'frozen repaint: 57 dimmed=true dimChanged=false',
        'unfreeze: 57 dimmed=false dimChanged=true',
        'unfreeze again: nothing',
        'frozen repaint while live: nothing',
        'live again: 23 dimmed=false dimChanged=false',
    ]);
});

test('card repaint: a change of dim redraws all three meters, which paint at the new opacity; a frozen repaint with ' +
    'the dim unchanged redraws only what changed', () => {
    const planner = new cardRepaintModule.CardRepaintPlanner();
    planner.show(shownState(SNAPSHOT));
    const freezePlan = planner.setFrozen(true);
    planner.show(shownState(IO_BOUND_SNAPSHOT));
    const frozenRepaintPlan = planner.repaintFrozen();
    const revealPlan = planner.setFrozen(false);
    assertEqual([freezePlan, frozenRepaintPlan, revealPlan].map(redrawnMeters),
        [ALL_METER_INDEXES, [IO_METER_INDEX], ALL_METER_INDEXES]);
});

test('visibility: a frozen card is due a repaint 30 s after it was last painted, and not before; asked on every 2 s ' +
    'Sample from the freeze, it repaints at 30 s and at 60 s', () => {
    const isDueAfterUsec = elapsedUsec =>
        visibilityModule.isFrozenRepaintDue({lastFrozenPaintAtUsec: 0, nowUsec: elapsedUsec});
    const repaintSeconds = [];
    let lastFrozenPaintAtUsec = 0;
    for (let elapsedSeconds = SAMPLE_TICK_SECONDS; elapsedSeconds <= FROZEN_RUN_SECONDS;
        elapsedSeconds += SAMPLE_TICK_SECONDS) {
        const nowUsec = elapsedSeconds * USEC_PER_SECOND;
        if (visibilityModule.isFrozenRepaintDue({lastFrozenPaintAtUsec, nowUsec})) {
            repaintSeconds.push(elapsedSeconds);
            lastFrozenPaintAtUsec = nowUsec;
        }
    }
    assertEqual({
        justBefore: isDueAfterUsec(FROZEN_REPAINT_SECONDS * USEC_PER_SECOND - ONE_USEC),
        atTheInterval: isDueAfterUsec(FROZEN_REPAINT_SECONDS * USEC_PER_SECOND),
        repaintSeconds,
    }, {justBefore: false, atTheInterval: true, repaintSeconds: [FROZEN_REPAINT_SECONDS, 2 * FROZEN_REPAINT_SECONDS]});
});

test('card.js: only the two sections\' heaviest app names ellipsize; every other label is made with ellipsizing off, ' +
    'so no number is ever cut', () => {
    const cardSource = readExtensionFile('card.js');
    const codeLines = cardSource.split('\n').filter(line => !COMMENT_LINE_PATTERN.test(line));
    const ellipsizeSettings = codeLines.filter(line => ELLIPSIZE_SETTING_PATTERN.test(line)).map(line => line.trim());
    const callsOf = functionName => codeLines
        .filter(line => line.includes(`${functionName}(`) && !line.includes(`function ${functionName}(`))
        .map(line => line.trim());
    const labelConstructionCount = codeLines.filter(line => line.includes('new St.Label(')).length;
    assertEqual({
        ellipsizeSettings,
        newCardLabelTurnsItOff: declarationBody(cardSource, 'function newCardLabel(')
            .includes('cardLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;'),
        newHeaviestNameLabelTurnsItOn: declarationBody(cardSource, 'function newHeaviestNameLabel(')
            .includes('nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;'),
        newHeaviestNameLabelStartsFromACardLabel: declarationBody(cardSource, 'function newHeaviestNameLabel(')
            .includes('const nameLabel = newCardLabel('),
        heaviestNameLabelCalls: callsOf('newHeaviestNameLabel'),
        sectionsBuilt: callsOf('newSectionParts'),
        labelConstructionCount,
    }, {
        ellipsizeSettings: [
            'cardLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;',
            'nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;',
        ],
        newCardLabelTurnsItOff: true,
        newHeaviestNameLabelTurnsItOn: true,
        newHeaviestNameLabelStartsFromACardLabel: true,
        heaviestNameLabelCalls: ['heaviestName: newHeaviestNameLabel(),'],
        sectionsBuilt: [
            'cpu: newSectionParts(CPU_DETAIL_LINE_COUNT),',
            'memory: newSectionParts(COMPACT_MEMORY_DETAIL_LINE_COUNT),',
        ],
        labelConstructionCount: 1,
    });
});

test('stylesheet.css keeps a rule for every class the card\'s earlier code set (stylesheet skew: it meets this ' +
    'stylesheet until the next login)', () => {
    const selectedClassNames = new Set(stylesheetRules(readExtensionFile('stylesheet.css'))
        .flatMap(rule => rule.classNames));
    assertEqual([...V1_STYLESHEET_CLASS_NAMES, ...EARLIER_CARD_CLASS_NAMES]
        .filter(className => !selectedClassNames.has(className)), []);
});

/**
 * Converts a CSS length the card's stylesheet uses to pixels.
 *
 * @param {string|undefined} cssLength - For example '12px' or '1.3em'.
 * @param {number} emPx - One em, in pixels.
 * @returns {number} The length in pixels.
 * @throws {Error} For a length this row does not read, or none.
 */
function cssLengthPx(cssLength, emPx) {
    const lengthMatch = CSS_LENGTH_PATTERN.exec(cssLength ?? '');
    if (lengthMatch === null)
        throw new Error(`cannot read the CSS length '${cssLength}'`);
    const [, amountText, unit] = lengthMatch;
    return unit === 'em' ? Number(amountText) * emPx : Number(amountText);
}

/**
 * The compact card's box around its content, from the stylesheet: its padding (top, sides, bottom) and the tile
 * surface's border, at the shell's default text size.
 *
 * @param {ReturnType<typeof stylesheetRules>} rules - The stylesheet's rules.
 * @returns {{topPx: number, sidePx: number, bottomPx: number, borderPx: number}} Each, in pixels.
 * @throws {Error} For a padding of other than three lengths.
 */
function compactCardBox(rules) {
    const paddingLengths = (declarationsOfClass(rules, COMPACT_CARD_CLASS_NAME).padding ?? '').split(/\s+/);
    if (paddingLengths.length !== CARD_PADDING_LENGTH_COUNT) {
        const paddingText = paddingLengths.join(' ');
        throw new Error(`cannot read the card's padding '${paddingText}'`);
    }
    const [topPx, sidePx, bottomPx] = paddingLengths.map(cssLength => cssLengthPx(cssLength, EM_PX));
    const [borderWidth] = (declarationsOfClass(rules, TILE_SURFACE_CLASS_NAME).border ?? '').split(/\s+/);
    return {topPx, sidePx, bottomPx, borderPx: cssLengthPx(borderWidth, EM_PX)};
}

/**
 * Measures the card's text with Pango as St lays it out at the shell's default text size: the card's font family, each
 * class's size and weight from the stylesheet, tabular digits, and a line box rounded up to a whole pixel as
 * ClutterText rounds it.
 *
 * @param {ReturnType<typeof stylesheetRules>} rules - The stylesheet's rules.
 * @returns {Promise<{measure: Function, loadedFamily: string}>} measure(text, className) gives the text's
 *     {widthPx, heightPx, baselinePx}; loadedFamily is the family Pango found for the card's font.
 */
async function compactCardTextMeasurer(rules) {
    const {default: Pango} = await import('gi://Pango?version=1.0');
    const {default: PangoCairo} = await import('gi://PangoCairo?version=1.0');
    const cardFontFamily = CSS_FIRST_FONT_FAMILY_PATTERN.exec(
        declarationsOfClass(rules, COMPACT_CARD_CLASS_NAME)['font-family'] ?? '')?.[1] ?? CARD_FONT_FAMILY;
    const pangoContext = PangoCairo.FontMap.get_default().create_context();
    PangoCairo.context_set_resolution(pangoContext, FONT_RESOLUTION_DPI);
    const fontDescriptionOf = className => {
        const classStyle = declarationsOfClass(rules, className);
        const fontDescription = Pango.FontDescription.from_string(cardFontFamily);
        const sizeEm = cssLengthPx(classStyle['font-size'], 1);
        fontDescription.set_size(Math.round(SHELL_FONT_SIZE_PT * sizeEm * Pango.SCALE));
        fontDescription.set_weight(Number(classStyle['font-weight'] ?? NORMAL_FONT_WEIGHT));
        return fontDescription;
    };
    const measure = (text, className) => {
        const layout = Pango.Layout.new(pangoContext);
        layout.set_font_description(fontDescriptionOf(className));
        const attributes = new Pango.AttrList();
        attributes.insert(Pango.attr_font_features_new(TABULAR_DIGITS_FEATURE));
        layout.set_attributes(attributes);
        layout.set_text(text, -1);
        const [, logicalRect] = layout.get_extents();
        return {
            widthPx: Math.ceil((logicalRect.x + logicalRect.width) / Pango.SCALE),
            heightPx: Math.ceil((logicalRect.y + logicalRect.height) / Pango.SCALE),
            baselinePx: layout.get_baseline() / Pango.SCALE,
        };
    };
    const loadedFamily = pangoContext.load_font(fontDescriptionOf(SECTION_NAME_CLASS_NAME)).describe().get_family();
    return {measure, loadedFamily};
}

/**
 * The geometry's line boxes, measured: one line of each kind of the card's text.
 *
 * @param {Function} measure - compactCardTextMeasurer's measure.
 * @returns {object} The line boxes compactCardGeometry reads.
 */
const measuredLineBoxes = measure => ({
    sectionLabelPx: measure('CPU', SECTION_NAME_CLASS_NAME).heightPx,
    meterNamePx: measure('cpu', METER_NAME_CLASS_NAME).heightPx,
    axisLabelPx: measure('5 min', AXIS_LABEL_CLASS_NAME).heightPx,
    figurePx: measure('37', FIGURE_CLASS_NAME).heightPx,
    detailPx: measure('of 30.3', DETAIL_CLASS_NAME).heightPx,
});

test('the compact card at the shell\'s default text size, measured with Pango in its font and its stylesheet\'s ' +
    'sizes: in either form exactly the height the cockpit\'s fit keeps a row at, and no wider than the cockpit\'s ' +
    'content width', async () => {
    const rules = stylesheetRules(readExtensionFile('stylesheet.css'));
    const {measure, loadedFamily} = await compactCardTextMeasurer(rules);
    const box = compactCardBox(rules);
    const nowColumnWidthPx = cssLengthPx(
        declarationsOfClass(rules, COMPACT_CARD_CLASS_NAME)[NOW_COLUMN_WIDTH_PROPERTY_NAME], EM_PX);
    const lineBoxes = measuredLineBoxes(measure);
    const cardSizes = [false, true].map(hasPressureHistory => {
        const {contentWidthPx, contentHeightPx} =
            compactCardGeometryModule.compactCardGeometry({lineBoxes, nowColumnWidthPx, hasPressureHistory});
        return {
            widthPx: Math.round(contentWidthPx + 2 * (box.sidePx + box.borderPx)),
            heightPx: Math.round(contentHeightPx + box.topPx + box.bottomPx + 2 * box.borderPx),
        };
    });
    const lineBoxesText = JSON.stringify(lineBoxes);
    const cardSizesText = JSON.stringify(cardSizes);
    assertEqual({
        loadedFamily,
        heightsPx: cardSizes.map(({heightPx}) => heightPx),
        fitsTheCockpitsContentWidth: cardSizes.every(({widthPx}) => widthPx <= COCKPIT_CARD_CONTENT_WIDTH_PX),
    }, {
        loadedFamily: CARD_FONT_FAMILY,
        heightsPx: [COMPACT_CARD_HEIGHT_AT_DEFAULT_TEXT_PX, COMPACT_CARD_HEIGHT_AT_DEFAULT_TEXT_PX],
        fitsTheCockpitsContentWidth: true,
    }, `line boxes ${lineBoxesText}, card ${cardSizesText}`);
});

test('the compact card\'s widest text fits where it is drawn, measured with Pango at the default text size: each ' +
    'line and figure under 100 GiB within the now column, any at all within the side padding too; each heaviest ' +
    'app\'s name keeps its first characters at the full and at the least plot; each meter\'s row showing "100%" ' +
    'ends 10 px or more before the next, the last within the side padding, at the least plot too', async () => {
    const rules = stylesheetRules(readExtensionFile('stylesheet.css'));
    const {measure} = await compactCardTextMeasurer(rules);
    const box = compactCardBox(rules);
    const nowColumnWidthPx = cssLengthPx(
        declarationsOfClass(rules, COMPACT_CARD_CLASS_NAME)[NOW_COLUMN_WIDTH_PROPERTY_NAME], EM_PX);
    const {compactCardGeometry, figureUnitPlacement, sectionLabelLine, meterPercentLeftOffsetPx} =
        compactCardGeometryModule;
    const nowColumnWidthOf = text => {
        const lineWidthsPx = [...text.cpuDetailLines, ...text.memoryDetailLines]
            .map(({text: lineText}) => measure(lineText, DETAIL_CLASS_NAME).widthPx);
        const figureWidthsPx = [text.cpuFigure, text.memoryFigure].map(({figure, unit}) => {
            const unitPart = measure(unit, UNIT_CLASS_NAME);
            const {unitLeftOffsetPx} = figureUnitPlacement(measure(figure, FIGURE_CLASS_NAME), unitPart);
            return unitLeftOffsetPx + unitPart.widthPx;
        });
        return Math.max(...lineWidthsPx, ...figureWidthsPx);
    };
    const underHundredGibTexts = [FULL_CPU_SNAPSHOT, NINETY_NINE_GIB_SNAPSHOT, NO_DATA_SNAPSHOT]
        .map(snapshot => cardText(snapshot, LATEST_CLOCK_LABEL));
    const largeMachineText = cardText(LARGE_MACHINE_SNAPSHOT, LATEST_CLOCK_LABEL);
    const shortenedNamePx = (name, shownChars) => {
        const shownName = name.slice(0, shownChars);
        return measure(`${shownName}${ELLIPSIS}`, HEAVIEST_NAME_CLASS_NAME).widthPx;
    };
    const heaviestNameKeeps = (sectionText, plotWidthPx, shownChars) => {
        const {heaviestNameWidthPx} = sectionLabelLine({
            sectionName: measure(sectionText.name, SECTION_NAME_CLASS_NAME),
            heaviestName: measure(sectionText.heaviestName, HEAVIEST_NAME_CLASS_NAME),
            heaviestValue: measure(sectionText.heaviestValue, HEAVIEST_VALUE_CLASS_NAME),
        }, plotWidthPx);
        return heaviestNameWidthPx >= shortenedNamePx(sectionText.heaviestName, shownChars);
    };
    const leastPlotWidthPx = COMPACT_PLOT_WIDTH_PX - COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX;
    const sections = [largeMachineText.cpuSection, largeMachineText.memorySection];
    const fullPressureMeters = cardText(FULL_PRESSURE_SNAPSHOT, LATEST_CLOCK_LABEL).meters;
    const cardMeasures = {
        lineBoxes: measuredLineBoxes(measure), nowColumnWidthPx, hasPressureHistory: false,
        meterNameWidthsPx: fullPressureMeters.map(({name}) => measure(name, METER_NAME_CLASS_NAME).widthPx),
        widestMeterPercentWidthPx: measure(fullPressureMeters[0].percentText, METER_PERCENT_CLASS_NAME).widthPx,
        sidePaddingPx: box.sidePx,
    };
    const geometry = compactCardGeometry(cardMeasures);
    const meterRowEndsIn = cardGeometry => fullPressureMeters.map(({name, percentText}, meterIndex) => {
        const percentLeftOffsetPx = meterPercentLeftOffsetPx(measure(name, METER_NAME_CLASS_NAME));
        const percentWidthPx = measure(percentText, METER_PERCENT_CLASS_NAME).widthPx;
        return cardGeometry.pressureRows[meterIndex].nameLeftPx + percentLeftOffsetPx + percentWidthPx;
    });
    const meterRowEndsPx = meterRowEndsIn(geometry);
    const {leastWidthPx} = compactCardGeometryModule.compactCardContentWidths(nowColumnWidthPx);
    const leastPlotGeometry = compactCardGeometry(cardMeasures, leastWidthPx);
    const leastPlotRowEndsPx = meterRowEndsIn(leastPlotGeometry);
    const nextMeterLimitsPx = geometry.pressureRows.slice(1).map(({meter}) => meter.x - COMPACT_METER_ROW_CLEARANCE_PX);
    const meterRowLimitsPx = [...nextMeterLimitsPx, geometry.contentWidthPx + box.sidePx];
    const underHundredGibWidthsPx = underHundredGibTexts.map(nowColumnWidthOf);
    const largeMachineWidthPx = nowColumnWidthOf(largeMachineText);
    assertEqual({
        underHundredGibWithinTheNowColumn:
            underHundredGibTexts.every(text => nowColumnWidthOf(text) <= nowColumnWidthPx),
        largeMachineWithinTheSidePadding: nowColumnWidthOf(largeMachineText) <= nowColumnWidthPx + box.sidePx,
        heaviestNamesAtTheFullPlot: sections.map(sectionText =>
            heaviestNameKeeps(sectionText, COMPACT_PLOT_WIDTH_PX, HEAVIEST_NAME_SHOWN_CHARS)),
        heaviestNamesAtTheLeastPlot: sections.map(sectionText =>
            heaviestNameKeeps(sectionText, leastPlotWidthPx, HEAVIEST_NAME_SHOWN_CHARS_AT_LEAST_PLOT)),
        meterRowsEndClearOfTheNext: meterRowEndsPx.map((endPx, meterIndex) => endPx <= meterRowLimitsPx[meterIndex]),
        lastMeterRowAtTheLeastPlotWithinThePadding:
            leastPlotRowEndsPx.at(-1) <= leastPlotGeometry.contentWidthPx + box.sidePx,
    }, {
        underHundredGibWithinTheNowColumn: true,
        largeMachineWithinTheSidePadding: true,
        heaviestNamesAtTheFullPlot: [true, true],
        heaviestNamesAtTheLeastPlot: [true, true],
        meterRowsEndClearOfTheNext: [true, true, true],
        lastMeterRowAtTheLeastPlotWithinThePadding: true,
    }, `now column ${nowColumnWidthPx} px: under 100 GiB ${underHundredGibWidthsPx}, large ${largeMachineWidthPx}; ` +
        `meter rows end ${meterRowEndsPx}, limits ${meterRowLimitsPx}; at the least plot ${leastPlotRowEndsPx}`);
});

test('card.js puts its own class and the tile surface on the card, and no class of the earlier card', () => {
    const cardSource = readExtensionFile('card.js');
    const codeText = cardSource.split('\n').filter(line => !COMMENT_LINE_PATTERN.test(line)).join('\n');
    assertEqual({
        ownClass: cardSource.includes(`const CARD_STYLE_CLASS = '${COMPACT_CARD_CLASS_NAME}';`),
        tileSurface: cardSource.includes(`const TILE_SURFACE_STYLE_CLASS = '${TILE_SURFACE_CLASS_NAME}';`),
        onTheCard: cardSource.includes(
            'super._init({style_class: `${CARD_STYLE_CLASS} ${TILE_SURFACE_STYLE_CLASS}`, reactive: false});'),
        earlierClassesSet: [...V1_STYLESHEET_CLASS_NAMES, ...EARLIER_CARD_CLASS_NAMES]
            .filter(className => codeText.includes(`'${className}'`)),
    }, {ownClass: true, tileSurface: true, onTheCard: true, earlierClassesSet: []});
});

test('card.js: a dim change adds the frozen pseudo-class (dimmed) or removes it (undimmed), and nothing else touches ' +
    'it; the frozen repaint applies the planner\'s plan; every colour each painter draws is scaled by the opacity ' +
    'the stylesheet gives', () => {
    const cardSource = readExtensionFile('card.js');
    const applyLines = trimmedLines(declarationBody(cardSource, '_applyRepaintPlan(repaintPlan) {'));
    const showDimmedLines = trimmedLines(declarationBody(cardSource, '_showDimmed(isDimmed) {'));
    const lineAfter = (lines, line) => (lines.includes(line) ? lines[lines.indexOf(line) + 1] : null);
    const pseudoClassCalls = cardSource.split('\n').filter(line => !COMMENT_LINE_PATTERN.test(line))
        .filter(line => line.includes('_style_pseudo_class(')).map(line => line.trim());
    const traceBody = declarationBody(cardSource, '_paintTrace(trace, history, lineRgba, areaAlpha) {');
    const traceInkLines = trimmedLines(traceBody.slice(traceBody.indexOf('const ink = {'), traceBody.indexOf('};')))
        .slice(1).filter(line => line !== '');
    const meterColourLines = trimmedLines(declarationBody(cardSource, '_paintPressureMeter(drawingArea, {band, isWait}) {'))
        .filter(line => /^const \w+Rgba = withOpacity\(/.test(line));
    const traceInkText = JSON.stringify(traceInkLines);
    const meterColoursText = JSON.stringify(meterColourLines);
    assertEqual({
        pseudoClassName: cardSource.includes(`const FROZEN_PSEUDO_CLASS = '${FROZEN_PSEUDO_CLASS_NAME}';`),
        onADimChange: lineAfter(applyLines, 'if (isDimChanged)'),
        whenDimmed: lineAfter(showDimmedLines, 'if (isDimmed)'),
        otherwise: lineAfter(showDimmedLines, 'else'),
        pseudoClassCalls,
        repaintFrozenApplies: statementCount(declarationBody(cardSource, 'repaintFrozen() {'),
            'this._applyRepaintPlan(this._repaintPlanner.repaintFrozen());'),
        opacityProperty: cardSource.includes(`const GRAPH_OPACITY_PROPERTY = '${GRAPH_OPACITY_PROPERTY_NAME}';`),
        readsTheProperty: declarationBody(cardSource, '_graphOpacity() {')
            .includes('this.get_theme_node().lookup_double(GRAPH_OPACITY_PROPERTY, false);'),
        traceInkCount: traceInkLines.length,
        traceInkDimmed: traceInkLines.filter(line => line.includes('graphOpacity')).length,
        meterColoursDimmed: meterColourLines.filter(line => line.endsWith(', graphOpacity);')).length,
    }, {
        pseudoClassName: true,
        onADimChange: 'this._showDimmed(isDimmed);',
        whenDimmed: 'this.add_style_pseudo_class(FROZEN_PSEUDO_CLASS);',
        otherwise: 'this.remove_style_pseudo_class(FROZEN_PSEUDO_CLASS);',
        pseudoClassCalls: [
            'this.add_style_pseudo_class(FROZEN_PSEUDO_CLASS);',
            'this.remove_style_pseudo_class(FROZEN_PSEUDO_CLASS);',
        ],
        repaintFrozenApplies: 1,
        opacityProperty: true,
        readsTheProperty: true,
        traceInkCount: TRACE_INK_ENTRY_COUNT,
        traceInkDimmed: TRACE_INK_ENTRY_COUNT,
        meterColoursDimmed: METER_COLOUR_COUNT,
    }, `trace ink ${traceInkText}; meter colours ${meterColoursText}`);
});

/**
 * A CSS colour the card's stylesheet uses, as [red, green, blue, alpha].
 *
 * @param {string|undefined} cssColour - 'rgba(r, g, b, a)', '#rrggbb' or 'white'.
 * @returns {number[]|null} Red, green and blue 0–255 and alpha 0–1; null for one this row does not read.
 */
function parsedCssColour(cssColour) {
    const rgbaMatch = CSS_RGBA_PATTERN.exec(cssColour ?? '');
    if (rgbaMatch !== null)
        return rgbaMatch.slice(1).map(Number);
    const hexMatch = CSS_HEX_COLOUR_PATTERN.exec(cssColour ?? '');
    if (hexMatch !== null)
        return [...hexMatch.slice(1).map(hexPair => Number.parseInt(hexPair, 16)), 1];
    return cssColour === 'white' ? [255, 255, 255, 1] : null;
}

test('stylesheet.css dims the frozen compact card in rules of their own: its drawings by -rp-graph-opacity, and each ' +
    'of its text classes, and the now rule, to that same share of its own colour', () => {
    const rules = stylesheetRules(readExtensionFile('stylesheet.css'));
    const frozenCardStyle = Object.assign({}, ...rules
        .filter(rule => rule.selectorText === FROZEN_CARD_SELECTOR).map(rule => rule.declarations));
    const graphOpacity = Number(frozenCardStyle[GRAPH_OPACITY_PROPERTY_NAME]);
    const frozenDeclarationsOf = className => Object.assign({}, ...rules
        .filter(rule => rule.selectorText.split(',').map(selector => selector.trim())
            .includes(`${FROZEN_CARD_SELECTOR} .${className}`))
        .map(rule => rule.declarations));
    const isDimmedToShare = (ownColour, frozenColour) => {
        if (ownColour === null || frozenColour === null)
            return false;
        const isSameHue =
            ownColour.slice(0, 3).every((channel, channelIndex) => channel === frozenColour[channelIndex]);
        return isSameHue && Math.abs(frozenColour[3] - ownColour[3] * graphOpacity) <= COLOUR_ALPHA_TOLERANCE;
    };
    const undimmedClassNames = COMPACT_TEXT_CLASS_NAMES.filter(className => !isDimmedToShare(
        parsedCssColour(declarationsOfClass(rules, className).color),
        parsedCssColour(frozenDeclarationsOf(className).color)));
    const nowRuleColourProperty = 'background-color';
    assertEqual({
        graphOpacity,
        undimmedClassNames,
        nowRuleDimmed: isDimmedToShare(
            parsedCssColour(declarationsOfClass(rules, NOW_RULE_CLASS_NAME)[nowRuleColourProperty]),
            parsedCssColour(frozenDeclarationsOf(NOW_RULE_CLASS_NAME)[nowRuleColourProperty])),
    }, {graphOpacity: FROZEN_SHARE, undimmedClassNames: [], nowRuleDimmed: true},
    `frozen card rule: ${JSON.stringify(frozenCardStyle)}`);
});

test('extension.js: while a card is frozen every tick, whether or not the backstop checked the cover, and the ' +
    'fallback timeout repaint it, dimmed, once frozenCardsDueRepaint says so, timing from its freeze and then from ' +
    'each repaint (only frozen cards hold a stamp: a revealed card is left to the reveal); the v2 card top right ' +
    'repaints from the client\'s latest, the cockpit\'s cards through the layer', () => {
    const extensionSource = readExtensionFile('extension.js');
    const tickLines = declarationBody(extensionSource, '_onCardCoverTick() {').split('\n');
    const timeoutLines = trimmedLines(declarationBody(extensionSource, '_onCoverFallbackTimeout() {'));
    const repaintBody = declarationBody(extensionSource, '_repaintFrozenCardsIfDue() {');
    const repaintOneLines = trimmedLines(declarationBody(extensionSource, '_repaintFrozenCard(cardId) {'));
    const syncLines = trimmedLines(declarationBody(extensionSource, '_syncCardCover() {'));
    const lineAfter = (lines, line) => (lines.includes(line) ? lines[lines.indexOf(line) + 1] : null);
    const stampStatement = 'this._frozenCardPaintedAtUsecByCardId = frozenPaintStamps({';
    const stampIndex = syncLines.indexOf(stampStatement);
    assertEqual({
        everyTickAsksOutsideTheBackstop: tickLines
            .filter(line => line === `${METHOD_STATEMENT_INDENT}this._repaintFrozenCardsIfDue();`).length,
        afterTheFallbackCheck: lineAfter(timeoutLines, 'this._syncCardCover();'),
        decides: repaintBody.includes('const dueCardIds = frozenCardsDueRepaint({'),
        // Only the due cards: iterating every stamp would repaint every frozen card on every tick.
        iteratesTheDueCards: statementCount(repaintBody, 'for (const cardId of dueCardIds) {'),
        readsTheFrozenStamps: statementCount(repaintBody,
            'frozenPaintedAtUsecByCardId: this._frozenCardPaintedAtUsecByCardId,'),
        recordsEachRepaint: statementCount(repaintBody, 'this._frozenCardPaintedAtUsecByCardId[cardId] = nowUsec;'),
        repaintsEachDueCard: statementCount(repaintBody, 'this._repaintFrozenCard(cardId);'),
        repaintsOne: repaintOneLines.slice(1, -1),
        timesFromTheFreeze: lineAfter(syncLines, stampStatement),
        stampsBeforeRecordingTheCover: stampIndex >= 0 &&
            stampIndex < syncLines.indexOf('this._isCardVisible = !isCovered;'),
    }, {
        everyTickAsksOutsideTheBackstop: 1,
        afterTheFallbackCheck: 'this._repaintFrozenCardsIfDue();',
        decides: true,
        iteratesTheDueCards: 1,
        readsTheFrozenStamps: 1,
        recordsEachRepaint: 1,
        repaintsEachDueCard: 1,
        repaintsOne: [
            'if (this._layer !== null) {', 'this._layer.repaintFrozenCard(cardId);', 'return;', '}',
            'const client = this._client;', 'this._card.update(client.latestSnapshot, client.lastGoodClockLabel);',
            'this._card.repaintFrozen();',
        ],
        timesFromTheFreeze: 'stampsByCardId: this._frozenCardPaintedAtUsecByCardId, coveredCardIds, ' +
            'nowUsec: GLib.get_monotonic_time(),',
        stampsBeforeRecordingTheCover: true,
    });
});

test('extension.js checks the cover on a restack, a window created or leaving a monitor, a fullscreen change, a ' +
    'minimize, an unminimize, a size change, the end of a drag, a workspace switch, "show desktop", every client ' +
    'update and a covering window\'s move, ' +
    'resize, move to another workspace or close, and its teardown disconnects every object it connects to (the ' +
    'covering windows through _disconnectCoveringWindows) and removes that history listener as one', () => {
    const extensionSource = readExtensionFile('extension.js');
    const tearDownBody = declarationBody(extensionSource, '_tearDown() {');
    const tearDownDisconnectsTheCoveringWindows = tearDownBody.includes('() => this._disconnectCoveringWindows()');
    const disconnectingText = tearDownDisconnectsTheCoveringWindows
        ? `${tearDownBody}\n${declarationBody(extensionSource, '_disconnectCoveringWindows() {')}`
        : tearDownBody;
    const connectedSignals = [...extensionSource.matchAll(CONNECT_OBJECT_PATTERN)].flatMap(
        ([, receiver, connectArguments]) => [...connectArguments.matchAll(QUOTED_SIGNAL_NAME_PATTERN)]
            .map(([, signalName]) => `${receiver} ${signalName}`));
    const connectedReceivers = new Set([...extensionSource.matchAll(CONNECT_OBJECT_PATTERN)]
        .map(([, receiver]) => receiver.replace(OWN_FIELD_PREFIX_PATTERN, '')));
    const disconnectedReceivers = new Set([...disconnectingText.matchAll(DISCONNECT_OBJECT_PATTERN)]
        .map(([, receiver]) => receiver.replace(OWN_FIELD_PREFIX_PATTERN, '')));
    const countMatches = (text, pattern) => (text.match(pattern) ?? []).length;
    assertEqual({
        connectedSignals: connectedSignals.sort(),
        receiversNeverDisconnected: [...connectedReceivers].filter(receiver => !disconnectedReceivers.has(receiver)),
        historyListenersAdded: countMatches(extensionSource, ADD_HISTORY_LISTENER_PATTERN),
        snapshotListenersAdded: countMatches(extensionSource, ADD_SNAPSHOT_LISTENER_PATTERN),
        cockpitListenersAdded: countMatches(extensionSource, ADD_COCKPIT_LISTENER_PATTERN),
        historyListenersRemovedOnTeardown: countMatches(tearDownBody, REMOVE_HISTORY_LISTENER_PATTERN),
        snapshotListenersRemovedOnTeardown: countMatches(tearDownBody, REMOVE_SNAPSHOT_LISTENER_PATTERN),
        cockpitListenersRemovedOnTeardown: countMatches(tearDownBody, REMOVE_COCKPIT_LISTENER_PATTERN),
        listenersAddedOnAnyReceiver: countMatches(extensionSource, ADD_ANY_LISTENER_PATTERN),
        listenersRemovedOnTeardownFromAnyReceiver: countMatches(tearDownBody, REMOVE_ANY_LISTENER_PATTERN),
    }, {
        connectedSignals: [
            'Main.layoutManager monitors-changed',
            'Main.overview hidden',
            'Main.overview showing',
            'global.display grab-op-end',
            'global.display in-fullscreen-changed',
            'global.display restacked',
            'global.display window-created',
            'global.display window-left-monitor',
            'global.display workareas-changed',
            'global.window_manager minimize',
            'global.window_manager size-changed',
            'global.window_manager switch-workspace',
            'global.window_manager unminimize',
            'global.workspace_manager showing-desktop-changed',
            'metaWindow position-changed',
            'metaWindow size-changed',
            'metaWindow unmanaged',
            'metaWindow workspace-changed',
            'this._card notify::width',
            'this._dropdownMenu open-state-changed',
        ],
        receiversNeverDisconnected: [],
        historyListenersAdded: 1,
        snapshotListenersAdded: 0,
        cockpitListenersAdded: 1,
        historyListenersRemovedOnTeardown: 1,
        snapshotListenersRemovedOnTeardown: 0,
        cockpitListenersRemovedOnTeardown: 1,
        listenersAddedOnAnyReceiver: 1,
        listenersRemovedOnTeardownFromAnyReceiver: 1,
    });
});

test('extension.js: enable() follows the cover right after adding the card, before starting the client', () => {
    const enableBody = declarationBody(readExtensionFile('extension.js'), 'enable() {');
    const stepStatements = ['this._addCard();', 'this._followCardCover();', 'this._client.start();'];
    const stepLineIndexes = stepStatements.map(statement => trimmedLines(enableBody).indexOf(statement));
    assertEqual({
        counts: stepStatements.map(statement => statementCount(enableBody, statement)),
        areConsecutive: stepLineIndexes.every((lineIndex, stepIndex) =>
            stepIndex === 0 || lineIndex === stepLineIndexes[stepIndex - 1] + 1),
    }, {counts: [1, 1, 1], areConsecutive: true});
});

test('extension.js: _placeCard() places the v2 card top right only while no cockpit layer is shown (the system ' +
    'cell holds it otherwise, so it is never drawn twice), else the layer, and checks the cover ' +
    'right after placing', () =>
    assertEqual(trimmedLines(declarationBody(readExtensionFile('extension.js'), '_placeCard() {')).slice(1, -1), [
        'if (this._layer === null)', 'this._card?.placeOnPrimaryMonitor();', 'else', 'this._placeCockpitLayer();',
        'this._syncCardCover();',
    ]));

test('extension.js: _syncCardCover() freezes each covered card and unfreezes each visible one, records whether any ' +
    'can be seen and which, restarts the backstop\'s count, sets the layer\'s interactivity, follows the covering ' +
    'windows, and updates the fallback timeout, the detail watch and the cockpit\'s watch; each loop freezes the ' +
    'cards it names as its pair says (the covered frozen, the visible unfrozen)', () => {
    const syncBody = declarationBody(readExtensionFile('extension.js'), '_syncCardCover() {');
    const syncLines = trimmedLines(syncBody);
    const lineAfter = (lines, line) => (lines.includes(line) ? lines[lines.indexOf(line) + 1] : null);
    const statements = [
        'const {isCovered, coveredCardIds, visibleCardIds, coveringWindows, isCockpitInteractive} =',
        'this._readCardCover();',
        'this._ticksSinceCoverCheck = 0;',
        'this._followCoveringWindows(coveringWindows);',
        'for (const cardId of coveredCardIds)',
        'this._setCardFrozen(cardId, true);',
        'for (const cardId of visibleCardIds)',
        'this._setCardFrozen(cardId, false);',
        'this._isCardVisible = !isCovered;',
        'this._visibleCardIds = visibleCardIds;',
        'this._layer?.setInteractive(isCockpitInteractive);',
        'this._syncCoverFallbackTimer();',
        'this._syncDetailWatch();',
        'this._syncCockpitWatch();',
    ];
    assertEqual({
        counts: statements.map(statement => statementCount(syncBody, statement)),
        coveredLoopFreezes: lineAfter(syncLines, 'for (const cardId of coveredCardIds)'),
        visibleLoopUnfreezes: lineAfter(syncLines, 'for (const cardId of visibleCardIds)'),
    }, {
        counts: statements.map(() => 1),
        coveredLoopFreezes: 'this._setCardFrozen(cardId, true);',
        visibleLoopUnfreezes: 'this._setCardFrozen(cardId, false);',
    });
});

test('extension.js: the bursty window-manager, display and covering-window triggers queue the one coalesced cover ' +
    'check, while each client tick (counted first, then behind the backstop) and the fallback timeout check at once ' +
    'with no later', () => {
    const extensionSource = readExtensionFile('extension.js');
    const followBody = declarationBody(extensionSource, '_followCardCover() {');
    const followWindowBody = declarationBody(extensionSource, '_startFollowingCoveringWindow(metaWindow) {');
    const tickBody = declarationBody(extensionSource, '_onCardCoverTick() {');
    const timeoutBody = declarationBody(extensionSource, '_onCoverFallbackTimeout() {');
    const tickLines = trimmedLines(tickBody);
    const coverSignalHandlers = connectedSignalHandlers(`${followBody}\n${followWindowBody}`)
        .filter(signalHandler => COVER_SIGNAL_RECEIVERS.has(signalHandler.split(' ')[0]));
    const queueingStatement = 'const queueCardCoverCheck = () => this._queueCardCoverCheck();';
    const backstopCondition = 'if (isCoverBackstopDue({isCovered, ticksSinceCoverCheck: this._ticksSinceCoverCheck}))';
    const linesQueuingALater = bodyText =>
        trimmedLines(bodyText).filter(line => line.includes('_queueCardCoverCheck')).length;
    assertEqual({
        coverSignalHandlers,
        queuesTheCheck: [statementCount(followBody, queueingStatement), statementCount(followWindowBody,
            queueingStatement)],
        clientListenerTicks: statementCount(followBody,
            'this._cardCoverListenerId = this._client.addHistoryListener(() => this._onCardCoverTick());'),
        tickCountedBeforeTheBackstop: tickLines[1] === 'this._ticksSinceCoverCheck += 1;' &&
            tickLines.indexOf(backstopCondition) > 1,
        backstopChecksAtOnce: tickLines.includes(backstopCondition)
            ? tickLines[tickLines.indexOf(backstopCondition) + 1] : null,
        fallbackChecksAtOnce: statementCount(timeoutBody, 'this._syncCardCover();'),
        linesQueuingALater: [linesQueuingALater(tickBody), linesQueuingALater(timeoutBody)],
    }, {
        coverSignalHandlers: [
            'global.display restacked: queueCardCoverCheck',
            'global.display window-created: queueCardCoverCheck',
            'global.display window-left-monitor: queueCardCoverCheck',
            'global.display in-fullscreen-changed: queueCardCoverCheck',
            'global.display grab-op-end: queueCardCoverCheck',
            'global.window_manager minimize: queueCardCoverCheck',
            'global.window_manager unminimize: queueCardCoverCheck',
            'global.window_manager size-changed: queueCardCoverCheck',
            'global.window_manager switch-workspace: queueCardCoverCheck',
            'global.workspace_manager showing-desktop-changed: queueCardCoverCheck',
            'metaWindow position-changed: queueCardCoverCheck',
            'metaWindow size-changed: queueCardCoverCheck',
            'metaWindow workspace-changed: queueCardCoverCheck',
            'metaWindow unmanaged: () => this._onCoveringWindowUnmanaged(metaWindow)',
        ],
        queuesTheCheck: [1, 1],
        clientListenerTicks: 1,
        tickCountedBeforeTheBackstop: true,
        backstopChecksAtOnce: 'this._syncCardCover();',
        fallbackChecksAtOnce: 1,
        linesQueuingALater: [0, 0],
    });
});

test('extension.js follows exactly the windows covering the card, connecting and disconnecting only the ' +
    'difference (coveringWindowChanges); a covering window closed is dropped at once, before the cover is checked ' +
    'again; teardown empties the set and disconnects every one', () => {
    const extensionSource = readExtensionFile('extension.js');
    const followBody = declarationBody(extensionSource, '_followCoveringWindows(coveringWindows) {');
    const readBody = declarationBody(extensionSource, '_readCardCover() {');
    const disconnectLines = trimmedLines(declarationBody(extensionSource, '_disconnectCoveringWindows() {'));
    assertEqual({
        coveringFromThePureRule: readBody.includes('coveringWindows: coveringWindowIndexes.map(windowIndex => ' +
            'metaWindows[windowIndex]),') && readBody.includes('= cardsCover({'),
        decidesByDifference: followBody.includes('coveringWindowChanges({'),
        releasesTheOnesToRelease: statementCount(followBody, 'this._stopFollowingCoveringWindow(metaWindow);'),
        followsTheOnesToFollow: statementCount(followBody, 'this._startFollowingCoveringWindow(metaWindow);'),
        recordsAFollowedWindow: statementCount(declarationBody(extensionSource,
            '_startFollowingCoveringWindow(metaWindow) {'), 'this._coveringWindows.add(metaWindow);'),
        stopForgetsThenDisconnects: trimmedLines(declarationBody(extensionSource,
            '_stopFollowingCoveringWindow(metaWindow) {')).slice(1, 3),
        onClose: trimmedLines(declarationBody(extensionSource, '_onCoveringWindowUnmanaged(metaWindow) {')).slice(1, 3),
        teardownEmptiesThenDisconnects: [
            disconnectLines.indexOf('this._coveringWindows.clear();') >= 0,
            disconnectLines.indexOf('this._coveringWindows.clear();') <
                disconnectLines.indexOf('metaWindow.disconnectObject(this);'),
        ],
    }, {
        coveringFromThePureRule: true,
        decidesByDifference: true,
        releasesTheOnesToRelease: 1,
        followsTheOnesToFollow: 1,
        recordsAFollowedWindow: 1,
        stopForgetsThenDisconnects: ['this._coveringWindows.delete(metaWindow);', 'metaWindow.disconnectObject(this);'],
        onClose: ['this._stopFollowingCoveringWindow(metaWindow);', 'this._queueCardCoverCheck();'],
        teardownEmptiesThenDisconnects: [true, true],
    });
});

test('extension.js: the cover check is coalesced into one BEFORE_REDRAW later that runs the cover sync, and ' +
    'teardown cancels it', () => {
    const extensionSource = readExtensionFile('extension.js');
    const queueBody = declarationBody(extensionSource, '_queueCardCoverCheck() {');
    assertEqual({
        returnsWhileQueued: statementCount(queueBody, 'if (this._cardCoverCheckLaterId !== null)'),
        addsABeforeRedrawLater: queueBody.includes('global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW,'),
        runsTheCoverSync: statementCount(queueBody, 'this._syncCardCover();'),
        cancelRemovesIt: statementCount(declarationBody(extensionSource, '_cancelCardCoverCheck() {'),
            'global.compositor.get_laters().remove(laterId);'),
        teardownCancels: statementCount(declarationBody(extensionSource, '_tearDown() {'),
            '{name: \'cancel the pending cover check\', run: () => this._cancelCardCoverCheck()},'),
    }, {
        returnsWhileQueued: 1, addsABeforeRedrawLater: true, runsTheCoverSync: 1, cancelRemovesIt: 1,
        teardownCancels: 1,
    });
});

test('extension.js: the cover check\'s later never throws out of its callback, which runs inside the compositor\'s ' +
    'frame: it forgets its id, runs the cover sync inside a try whose catch logs the failure, and returns ' +
    'GLib.SOURCE_REMOVE after the try, on every path', () => {
    const queueLines = trimmedLines(declarationBody(readExtensionFile('extension.js'), '_queueCardCoverCheck() {'));
    const addLineIndex = queueLines.findIndex(line =>
        line.startsWith('this._cardCoverCheckLaterId = global.compositor.get_laters().add('));
    assertEqual({
        callbackOpening: addLineIndex < 0 ? [] : queueLines.slice(addLineIndex + 1, addLineIndex + 5),
        catchLogs: queueLines.filter(line => line.startsWith('this._errorLog.log(')).length,
        callbackClosing: queueLines.slice(-4),
    }, {
        callbackOpening: [
            'this._cardCoverCheckLaterId = null;', 'try {', 'this._syncCardCover();', '} catch (error) {',
        ],
        catchLogs: 1,
        callbackClosing: ['}', 'return GLib.SOURCE_REMOVE;', '});', '}'],
    });
});

test('extension.js: teardown attempts every covering window: each window\'s disconnectObject sits in a try of its ' +
    'own inside the loop, a failure logged as a teardown failure, so one that throws leaves none of the rest ' +
    'connected', () => {
    const disconnectLines = trimmedLines(
        declarationBody(readExtensionFile('extension.js'), '_disconnectCoveringWindows() {'));
    const loopIndex = disconnectLines.indexOf('for (const metaWindow of coveringWindows) {');
    assertEqual(loopIndex < 0 ? [] : disconnectLines.slice(loopIndex + 1, loopIndex + 6), [
        'try {',
        'metaWindow.disconnectObject(this);',
        '} catch (error) {',
        'this._logTearDownFailure(\'disconnect from a covering window\', error);',
        '}',
    ]);
});

test('extension.js: the fallback timeout runs exactly while coverFallbackTimerChange says so, from the cover, the ' +
    'client\'s isLive and whether it runs, asked on each cover check and, once a tick, on a tick that did not check ' +
    'the cover; its callback keeps it, and its removal forgets the id before it removes the source', () => {
    const extensionSource = readExtensionFile('extension.js');
    const timerLines = trimmedLines(declarationBody(extensionSource, '_syncCoverFallbackTimer() {'));
    const removeLines = trimmedLines(declarationBody(extensionSource, '_removeCoverFallbackTimer() {'));
    const tickBody = declarationBody(extensionSource, '_onCardCoverTick() {');
    const tickLines = trimmedLines(tickBody);
    const lineAfter = (lines, line) => (lines.includes(line) ? lines[lines.indexOf(line) + 1] : null);
    const startIndex = timerLines.indexOf('if (timerChange === CoverFallbackTimerChange.START) {');
    const askingStatement = 'this._syncCoverFallbackTimer();';
    const backstopCondition = 'if (isCoverBackstopDue({isCovered, ticksSinceCoverCheck: this._ticksSinceCoverCheck}))';
    const backstopIndex = tickLines.indexOf(backstopCondition);
    assertEqual({
        decides: timerLines.slice(1, 5),
        startsOnStart: startIndex < 0 ? [] : timerLines.slice(startIndex + 1, startIndex + 4),
        stopsOnStop: lineAfter(timerLines, '} else if (timerChange === CoverFallbackTimerChange.STOP) {'),
        removeForgetsThenRemoves: removeLines.slice(-4, -1),
        keepsRunning: statementCount(declarationBody(extensionSource, '_onCoverFallbackTimeout() {'),
            'return GLib.SOURCE_CONTINUE;'),
        askedOnEachCheck: statementCount(declarationBody(extensionSource, '_syncCardCover() {'), askingStatement),
        // The tick asks itself only when the backstop did not check the cover, whose sync already asked.
        askedOnceATick: [
            statementCount(tickBody, askingStatement),
            backstopIndex < 0 ? [] : tickLines.slice(backstopIndex, backstopIndex + 4),
        ],
    }, {
        decides: [
            'const timerChange = coverFallbackTimerChange({',
            'isCovered: !this._isCardVisible,',
            'isServiceLive: this._client?.isLive === true,',
            'isTimerRunning: this._coverFallbackSourceId !== null,',
        ],
        startsOnStart: [
            'const onFallbackTimeout = () => this._onCoverFallbackTimeout();',
            'this._coverFallbackSourceId =',
            'GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, COVER_FALLBACK_INTERVAL_SECONDS, onFallbackTimeout);',
        ],
        stopsOnStop: 'this._removeCoverFallbackTimer();',
        removeForgetsThenRemoves: [
            'const sourceId = this._coverFallbackSourceId;',
            'this._coverFallbackSourceId = null;',
            'GLib.source_remove(sourceId);',
        ],
        keepsRunning: 1,
        askedOnEachCheck: 1,
        askedOnceATick: [1, [backstopCondition, 'this._syncCardCover();', 'else', askingStatement]],
    });
});

test('extension.js: when the overview has closed, the cover is checked again', () => {
    const extensionSource = readExtensionFile('extension.js');
    const followOverviewBody = declarationBody(extensionSource, '_followOverviewWithDetailWatch() {');
    const overviewHandlers = connectedSignalHandlers(followOverviewBody);
    assertEqual({
        hiddenHandler: overviewHandlers.filter(signalHandler => signalHandler.startsWith('Main.overview hidden:')),
        hiddenChecksTheCover: statementCount(declarationBody(extensionSource, '_onOverviewHidden() {'),
            'this._syncCardCover();'),
    }, {hiddenHandler: ['Main.overview hidden: () => this._onOverviewHidden()'], hiddenChecksTheCover: 1});
});

// The top-bar dropdown: indicator.js is a PanelMenu.Button whose menu holds a second card and "Open Resources".
const INDICATOR_SOURCE_FILE = 'indicator.js';
/** The indicator's constructor: the pulse client, then the cockpit's options (the dropdown's sessions card). */
const INDICATOR_INIT_DECLARATION = '_init(client, {cockpitClient, errorLog, onSessionActivated}) {';

test('indicator.js is a PanelMenu.Button with a menu of its own, and the click that launched Resources directly is ' +
    'gone', () => {
    const indicatorSource = readExtensionFile(INDICATOR_SOURCE_FILE);
    assertEqual({
        extendsPanelMenuButton: indicatorSource.includes('class PulseIndicator extends PanelMenu.Button {'),
        createsItsMenu: statementCount(declarationBody(indicatorSource, INDICATOR_INIT_DECLARATION),
            'super._init(MENU_ALIGNMENT, ACCESSIBLE_NAME);'),
        suppressesItsMenu: indicatorSource.includes('DONT_CREATE_MENU'),
        hasItsOwnClickGesture: indicatorSource.includes('ClickGesture'),
        launchesOnClick: indicatorSource.includes('_openSystemMonitor') || indicatorSource.includes('\'recognize\''),
    }, {
        extendsPanelMenuButton: true, createsItsMenu: 1, suppressesItsMenu: false, hasItsOwnClickGesture: false,
        launchesOnClick: false,
    });
});

test('indicator.js: the menu holds a non-reactive item with the second card, and an "Open Resources" item that ' +
    'launches the first installed id in RESOURCES_APP_IDS (cockpitCards.js finds and opens it) and is hidden when ' +
    'none is installed', () => {
    const indicatorSource = readExtensionFile(INDICATOR_SOURCE_FILE);
    const cockpitCardsSource = readExtensionFile('cockpitCards.js');
    const buildBody = declarationBody(indicatorSource, '_buildDropdown() {');
    const findBody = declarationBody(cockpitCardsSource, 'export function findResourcesApp() {');
    const openBody = declarationBody(cockpitCardsSource, 'export function openResourcesApp() {');
    const visibilityBody = declarationBody(indicatorSource, '_syncOpenResourcesVisibility() {');
    assertEqual({
        cardItemIsInert: buildBody.includes('new PopupMenu.PopupBaseMenuItem(CARD_ITEM_PROPERTIES)') &&
            indicatorSource.includes('const CARD_ITEM_PROPERTIES = {reactive: false, can_focus: false, style_class:'),
        secondCardIsBuilt: statementCount(buildBody, 'this._dropdownCard = new PulseCard(this._client);'),
        cardIsInTheItem: statementCount(buildBody, 'cardItem.add_child(this._dropdownCard);'),
        cardIsNeverPlaced: indicatorSource.includes('placeOnPrimaryMonitor'),
        openItemLabel: statementCount(buildBody,
            'this._openResourcesItem = new PopupMenu.PopupMenuItem(OPEN_RESOURCES_LABEL);'),
        labelIsTheSpecifiedOne: indicatorSource.includes('const OPEN_RESOURCES_LABEL = \'Open Resources\';'),
        activationLaunches: buildBody.includes(
            'this._openResourcesItem.connect(\'activate\', () => openResourcesApp());'),
        lookupUsesTheSharedIds: findBody.includes('RESOURCES_APP_IDS') && findBody.includes('.find(app => app !== null)'),
        launchActivates: statementCount(openBody, 'resourcesApp.activate();'),
        launchLeavesTheOverview: statementCount(openBody, 'Main.overview.hide();'),
        hiddenWhenNoneInstalled: statementCount(visibilityBody,
            'this._openResourcesItem.visible = findResourcesApp() !== undefined;'),
    }, {
        cardItemIsInert: true, secondCardIsBuilt: 1, cardIsInTheItem: 1, cardIsNeverPlaced: false, openItemLabel: 1,
        labelIsTheSpecifiedOne: true, activationLaunches: true, lookupUsesTheSharedIds: true, launchActivates: 1,
        launchLeavesTheOverview: 1, hiddenWhenNoneInstalled: 1,
    });
});

test('indicator.js: the dropdown card is never frozen while the menu is open: closing freezes it, opening unfreezes ' +
    'it (a repaint at once), and opening re-checks whether Resources is installed', () => {
    const indicatorSource = readExtensionFile(INDICATOR_SOURCE_FILE);
    const openStateBody = declarationBody(indicatorSource, '_onMenuOpenStateChanged(isOpen) {');
    const initBody = declarationBody(indicatorSource, INDICATOR_INIT_DECLARATION);
    assertEqual({
        freezesExactlyWhileClosed: statementCount(openStateBody, 'this._dropdownCard.setFrozen(!isOpen);'),
        recheckedOnEveryChange: statementCount(openStateBody, 'this._syncOpenResourcesVisibility();'),
        startsFrozen: statementCount(initBody, 'this._dropdownCard.setFrozen(true);'),
        listensToTheMenu: statementCount(initBody,
            'this.menu.connectObject(\'open-state-changed\', (_menu, isOpen) => this._onMenuOpenStateChanged(isOpen),'),
    }, {freezesExactlyWhileClosed: 1, recheckedOnEveryChange: 1, startsFrozen: 1, listensToTheMenu: 1});
});

test('indicator.js: the hover label is suppressed while the menu is open, and opening it hides one that is up', () => {
    const indicatorSource = readExtensionFile(INDICATOR_SOURCE_FILE);
    const syncBody = declarationBody(indicatorSource, '_syncHoverLabel() {');
    const openStateBody = declarationBody(indicatorSource, '_onMenuOpenStateChanged(isOpen) {');
    assertEqual({
        showsOnlyWhenHoveredMappedAndMenuClosed: statementCount(syncBody,
            'if (this.hover && this.mapped && !this.menu.isOpen) {'),
        reSyncsOnOpenStateChange: statementCount(openStateBody, 'this._syncHoverLabel();'),
    }, {showsOnlyWhenHoveredMappedAndMenuClosed: 1, reSyncsOnOpenStateChange: 1});
});

test('indicator.js: destroying the indicator destroys the dropdown card and the hover label, cancels the pending show, and nothing is ' +
    'connected outside the indicator, its menu or its label', () => {
    const indicatorSource = readExtensionFile(INDICATOR_SOURCE_FILE);
    const onDestroyBody = declarationBody(indicatorSource, '_onDestroy() {');
    assertEqual({
        destroysTheDropdownCard: statementCount(onDestroyBody, 'this._dropdownCard?.destroy();'),
        clearsTheDropdownCard: statementCount(onDestroyBody, 'this._dropdownCard = null;'),
        cancelsTheShowTimeout: statementCount(onDestroyBody, 'this._cancelHoverLabelTimeout();'),
        destroysTheLabel: statementCount(onDestroyBody, 'this._hoverLabel?.destroy();'),
        outsideConnectionsDisconnected: statementCount(onDestroyBody,
            'St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);'),
        outsideConnections: (indicatorSource.match(/St\.ThemeContext\.get_for_stage\(global\.stage\)\.connectObject\(/g) ?? [])
            .length,
    }, {
        destroysTheDropdownCard: 1, clearsTheDropdownCard: 1, cancelsTheShowTimeout: 1, destroysTheLabel: 1,
        outsideConnectionsDisconnected: 1, outsideConnections: 1,
    });
});

test('extension.js: the menu\'s open-state-changed drives the dropdown flag of isDetailWatchWanted, and teardown ' +
    'disconnects it', () => {
    const extensionSource = readExtensionFile('extension.js');
    const followBody = declarationBody(extensionSource, '_followDropdown() {');
    const syncBody = declarationBody(extensionSource, '_syncDetailWatch() {');
    const tearDownBody = declarationBody(extensionSource, '_tearDown() {');
    assertEqual({
        receiver: [...followBody.matchAll(CONNECT_OBJECT_PATTERN)].map(([, receiver]) => receiver),
        handler: statementCount(followBody,
            '\'open-state-changed\', (_menu, isOpen) => this._onDropdownOpenStateChanged(isOpen),'),
        recordsTheState: statementCount(declarationBody(extensionSource, '_onDropdownOpenStateChanged(isOpen) {'),
            'this._isDropdownOpen = isOpen;'),
        resyncsTheWatch: statementCount(declarationBody(extensionSource, '_onDropdownOpenStateChanged(isOpen) {'),
            'this._syncDetailWatch();'),
        watchReadsTheFlag: statementCount(syncBody, 'isDropdownOpen: this._isDropdownOpen,'),
        placeholderGone: extensionSource.includes('IS_DROPDOWN_OPEN_UNTIL_DROPDOWN_EXISTS'),
        teardownDisconnects: statementCount(tearDownBody,
            '{name: \'disconnect from the dropdown menu\', run: () => dropdownMenu?.disconnectObject(this)},'),
        teardownClearsTheFlag: statementCount(tearDownBody, 'this._isDropdownOpen = false;'),
    }, {
        receiver: ['this._dropdownMenu'], handler: 1, recordsTheState: 1, resyncsTheWatch: 1, watchReadsTheFlag: 1, placeholderGone: false,
        teardownDisconnects: 1, teardownClearsTheFlag: 1,
    });
});

test('stylesheet.css styles the dropdown with classes of its own, added beside the old ones', () => {
    const selectedClassNames = new Set(stylesheetRules(readExtensionFile('stylesheet.css'))
        .flatMap(rule => rule.classNames));
    assertEqual(['resource-pulse-menu-card-item'].filter(className => !selectedClassNames.has(className)), []);
});

test('indicator.js: _onDestroy disconnects the menu handler first, before it clears the dropdown fields and before ' +
    'super._onDestroy() destroys the menu (whose close() emits open-state-changed against a cleared card)', () => {
    const onDestroyLines = trimmedLines(declarationBody(readExtensionFile(INDICATOR_SOURCE_FILE), '_onDestroy() {'));
    const indexOfLine = statement => onDestroyLines.indexOf(statement);
    const disconnectIndex = indexOfLine('this.menu.disconnectObject(this);');
    assertEqual({
        disconnects: disconnectIndex >= 0,
        beforeClearingTheCard: disconnectIndex < indexOfLine('this._dropdownCard = null;'),
        beforeDestroyingTheMenu: disconnectIndex < indexOfLine('super._onDestroy();'),
    }, {disconnects: true, beforeClearingTheCard: true, beforeDestroyingTheMenu: true});
});
