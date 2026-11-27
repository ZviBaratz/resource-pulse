// The Sessions tile's shell modules (sessionsTile.js, sessionsTileColumns.js, sessionsTileRow.js, sessionsTileStrip.js
// and sessionsTileCells.js), which nothing draws yet, and their stylesheet block, read as text: they import St, which
// plain gjs cannot load.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEqual} from './harness.js';
import {SESSION_CELL_NO_ROOM_PX} from '../extensions/resource-pulse@zvibaratz.github.io/lib/drawingConstants.js';
import {SESSION_GROUP_ORDER} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionOrder.js';

const EXTENSION_DIRECTORY_URI =
    GLib.uri_resolve_relative(import.meta.url, '../extensions/resource-pulse@zvibaratz.github.io/', GLib.UriFlags.NONE);
const [EXTENSION_DIRECTORY_PATH] = GLib.filename_from_uri(EXTENSION_DIRECTORY_URI);
const STYLESHEET_FILE = 'stylesheet.css';
const TILE_SOURCE_FILE = 'sessionsTile.js';
const COLUMNS_SOURCE_FILE = 'sessionsTileColumns.js';
const ROW_SOURCE_FILE = 'sessionsTileRow.js';
const STRIP_SOURCE_FILE = 'sessionsTileStrip.js';
const CELLS_SOURCE_FILE = 'sessionsTileCells.js';
const SOURCE_FILES = [TILE_SOURCE_FILE, COLUMNS_SOURCE_FILE, ROW_SOURCE_FILE, STRIP_SOURCE_FILE, CELLS_SOURCE_FILE];
const SESSIONS_BLOCK_MARKER = 'Added with the Sessions tile.';
const TEXT_BLOCK_MARKER = 'Added with the cockpit\'s text sizes.';
/** The opening of a later block's comment, which ends this one. */
const BLOCK_OPENING = '/* Added with ';
const COMMENT_OPENING = '/*';
const CSS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const JS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
/** A class a CSS selector names, without its dot. */
const SELECTOR_CLASS_PATTERN = /\.([A-Za-z_-][\w-]*)/g;
/** A class of the tile's own, wherever the code names it. */
const SESSIONS_OWN_CLASS_PATTERN = /\brp-sessions-[\w-]*\w/g;
/** A state mark's class, which the code writes once for every state. */
const STATE_MARK_CLASS_TEMPLATE = 'rp-sessions-mark-${';
const STATE_MARK_CLASS_PREFIX = 'rp-sessions-mark-';
/** A static import's specifier. */
const IMPORT_SPECIFIER_PATTERN = /^import\s[^;]*?from\s+'([^']+)';/gm;
/** What a shell module of the tile may import: the Shell's libraries St draws with, and modules of its own. */
const ALLOWED_IMPORT_PATTERN =
    /^(?:gi:\/\/(?:Clutter|GObject|Pango|St)|\.\/(?:cockpitTileBase|sessionsTile\w*)\.js|\.\/lib\/\w+\.js)$/;
const CONSTANTS_IMPORT = './lib/constants.js';
/** A statement that makes an actor or puts one in the tree. */
const ACTOR_BUILDING_PATTERN = /new St\.|new SessionsTileRow\(|\.add_child\(|\.insert_child_\w*\(|\._addTitleActor\(/;
/**
 * A top-level function's or a method's declaration, as it starts its line at the file's or the class's indent and
 * opens its body at the line's end; a call at that indent inside a function opens none.
 */
const DECLARATION_LINE_PATTERN = /^(?: {4})?(?:export )?(?:function )?([_A-Za-z]\w*)\(.*\) \{$/;
/** Words that start a line the way a declaration does, but are not one. */
const NOT_A_DECLARATION_PATTERN = /^\s*(?:if|for|while|switch|return)\b/;
/** Where the tile may make an actor: its constructors, its builders, and the slot growing they call. */
const ACTOR_BUILDING_FUNCTION_PATTERN = /^(?:_init|constructor|_build\w*|_add(?:Row|Slot)|new\w+)$/;
/** A render that puts an actor in the tree, which the builder scan must catch. */
const RENDER_BUILDING_SOURCE = '    _renderSessions(sessions) {\n        this._box.add_child(new St.Label());\n    }\n';
/** A builder with a call at the class's indent before its building line, which the scan must not take for a method. */
const BUILDER_WITH_CALL_SOURCE =
    'function newStateCount(state) {\n    showCell(box, false, STYLE);\n    box.add_child(new St.Icon());\n}\n';
/** Calls that move an actor to another parent or reorder a parent's children. */
const REPARENTING_PATTERN =
    /\.remove_child\(|\.insert_child_(?:above|below)\(|set_child_(?:at_index|above_sibling|below_sibling)\(/g;
/** Declarations a pixel length could be written in, other than through the code's constants. */
const LENGTH_DECLARATION_PATTERN = /(?:^|[\s{;])(?:font-size|padding[\w-]*|margin[\w-]*|spacing|width|height)\s*:/;
const OPACITY_PROPERTY_PATTERN = /(?:^|[\s{;])opacity\s*:/;
const TRANSITION_PROPERTY_PATTERN = /(?:^|[\s{;])transition[\w-]*\s*:/;
const PIXEL_LITERAL_PATTERN = /\d\s*px/;
/** A colour written out: a hex colour or an rgb()/rgba() call. */
const COLOUR_LITERAL_PATTERN = /#[\da-fA-F]{3,8}\b|rgba?\(/;
/** A call that sets an actor's place or size directly, not through an inline style. */
const GEOMETRY_CALL_PATTERN = /\.set_(?:size|position|width|height)\(/;
/** Where the tile may set a place directly: a slot's, a row's and the area's in the columns' fixed layout. */
const PLACING_FUNCTION_NAMES = [[], ['showSlotAt', 'setAreaSize'], ['setPlace'], [], []];
/** An actor shown or hidden by visibility: through the base's helper, or by assigning it. */
const VISIBILITY_SWITCH_PATTERN = /setActorVisible\(([^,]+),|([\w.]+)\.visible = /g;
/** An actor shown or hidden by opacity: through the base's helper, or as a cell (sessionsTileCells.js). */
const OPACITY_SWITCH_PATTERN = /(?:setActorOpaque|showCell)\(([^,]+),/g;
/** A leaf switched by visibility, which the visibility scan must catch. */
const LEAF_BY_VISIBILITY_SOURCE =
    'setActorVisible(this._contextTag, contextTag !== null);\nthis._mark.visible = false;';
/** A box's spacing, which it would put before an absent cell too. */
const SPACING_STYLE_TEXT = 'pixelLengthStyle(\'spacing\'';
/** A use of the shared tooltip itself: naming it, showing it or hiding it. */
const TOOLTIP_USE_PATTERN = /\b_tooltip\b|\.showFor\(/;
/** The base's call for a shown row whose place changes, as the tile hands it to its columns. */
const MOVED_ROW_CALL = 'hideTooltipIfHovered: hoverRow => this._hideTooltipIfHovered(hoverRow),';
/** A public method's declaration in a class: at the class's indent, a name not starting with an underscore. */
const PUBLIC_METHOD_LINE_PATTERN = /^ {4}([a-z]\w*)\(.*\) \{$/;
/** The base's guard, which a public method opens with: after destroy it does nothing. */
const DESTROYED_GUARD_STATEMENTS = ['if (this._isDestroyed)', 'return;'];
/** A public method without the guard, which the guard scan must catch. */
const UNGUARDED_METHOD_SOURCE = '    setLayout({widthPx}) {\n        this.setTileSize(widthPx, widthPx);\n    }\n';
/** A placement that takes a side padding, which the tile takes once, at construction. */
const SET_LAYOUT_SIDE_PADDING_PATTERN = /setLayout\(\{[^}]*\bsidePaddingPx\b/;
/** A size read from an actor, which a repaint must not ask for. */
const ACTOR_SIZE_READ_PATTERN = /allocation|get_width|get_height|get_size|\.width\b|\.height\b/;

/**
 * Reads a file of the extension as text.
 *
 * @param {string} fileName - Path relative to the extension directory.
 * @returns {string} Its contents.
 */
function readExtensionFile(fileName) {
    const path = GLib.build_filenamev([EXTENSION_DIRECTORY_PATH, fileName]);
    const [, contentBytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(contentBytes);
}

/**
 * A file of the extension with its comments removed, so that no needle can match a comment. A string holding `//`
 * (an import URL) loses its tail too; no row reads one from this text.
 *
 * @param {string} fileName - Path relative to the extension directory.
 * @returns {string} Its code.
 */
function codeOf(fileName) {
    return readExtensionFile(fileName).replace(JS_COMMENT_PATTERN, '');
}

/**
 * How many times a literal text occurs in another.
 *
 * @param {string} haystack - The text searched.
 * @param {string} needle - The literal looked for.
 * @returns {number} The number of non-overlapping occurrences.
 */
function occurrenceCount(haystack, needle) {
    return haystack.split(needle).length - 1;
}

/**
 * The body of a function or method: from its declaration line to the first line that closes it at the declaration's
 * own indent, comments removed.
 *
 * @param {string} sourceText - The file's text.
 * @param {string} declarationLine - The declaration as it starts its line, for example 'update(sessions) {'.
 * @returns {string} The body without comments, or '' when there is no such declaration.
 */
function methodBody(sourceText, declarationLine) {
    const lines = sourceText.split('\n');
    const startIndex = lines.findIndex(line => line.trimStart().startsWith(declarationLine));
    if (startIndex < 0)
        return '';
    const indent = lines[startIndex].length - lines[startIndex].trimStart().length;
    const closingLine = `${' '.repeat(indent)}}`;
    const endIndex = lines.findIndex((line, lineIndex) => lineIndex > startIndex && line === closingLine);
    return lines.slice(startIndex, endIndex < 0 ? undefined : endIndex + 1).join('\n')
        .replace(JS_COMMENT_PATTERN, '');
}

/**
 * The statements of a body, one per line, trimmed, blank lines left out.
 *
 * @param {string} bodyText - What methodBody returned.
 * @returns {string[]} Its lines.
 */
function statementsOf(bodyText) {
    return bodyText.split('\n').map(line => line.trim()).filter(line => line !== '');
}

/**
 * The Sessions tile's block of the stylesheet, from its opening comment to the next block's or the file's end,
 * comments removed.
 *
 * @returns {string} Its rules.
 */
function sessionsBlockText() {
    const stylesheet = readExtensionFile(STYLESHEET_FILE);
    // From the opening of the comment that holds the marker, so that the whole comment is removed.
    const blockStart = stylesheet.lastIndexOf(COMMENT_OPENING, stylesheet.indexOf(SESSIONS_BLOCK_MARKER));
    const nextBlockStart = stylesheet.indexOf(BLOCK_OPENING, blockStart + BLOCK_OPENING.length);
    const blockEnd = nextBlockStart < 0 ? stylesheet.length : nextBlockStart;
    return stylesheet.slice(blockStart, blockEnd).replace(CSS_COMMENT_PATTERN, '');
}

/**
 * The names of the functions and methods of a source that hold a line a pattern matches: for each such line, the
 * nearest declaration above it at the file's or the class's indent.
 *
 * @param {string} codeText - The source, comments removed.
 * @param {RegExp} linePattern - What a line is looked for with.
 * @returns {string[]} The names, each once, in order.
 */
function functionNamesWithLine(codeText, linePattern) {
    const names = new Set();
    let currentName = null;
    for (const line of codeText.split('\n')) {
        const declaration = line.match(DECLARATION_LINE_PATTERN);
        if (declaration !== null && !NOT_A_DECLARATION_PATTERN.test(line))
            currentName = declaration[1];
        if (linePattern.test(line))
            names.add(currentName);
    }
    return [...names];
}

/**
 * The names of a class's public methods: each declared at the class's indent with a name not starting with an
 * underscore.
 *
 * @param {string} sourceText - The source.
 * @returns {string[]} The names, in order.
 */
function publicMethodNames(sourceText) {
    return sourceText.replace(JS_COMMENT_PATTERN, '').split('\n')
        .filter(line => !NOT_A_DECLARATION_PATTERN.test(line))
        .map(line => line.match(PUBLIC_METHOD_LINE_PATTERN)?.[1])
        .filter(name => name !== undefined);
}

/**
 * The public methods of a class that do not open with the base's guard against a call after destroy.
 *
 * @param {string} sourceText - The source.
 * @returns {string[]} Their names, in order.
 */
function unguardedPublicMethods(sourceText) {
    const guardText = JSON.stringify(DESTROYED_GUARD_STATEMENTS);
    return publicMethodNames(sourceText).filter(name =>
        JSON.stringify(statementsOf(methodBody(sourceText, `${name}(`)).slice(1, 3)) !== guardText);
}

/**
 * The tile's own classes its code names: each written out, and a state mark's for every state where the code
 * writes it from the state.
 *
 * @returns {string[]} The classes, each once, sorted.
 */
function classesNamedInCode() {
    const classes = new Set();
    for (const fileName of SOURCE_FILES) {
        const code = codeOf(fileName);
        const withoutTemplates = code.split(STATE_MARK_CLASS_TEMPLATE).join('');
        for (const [className] of withoutTemplates.matchAll(SESSIONS_OWN_CLASS_PATTERN))
            classes.add(className);
        if (code.includes(STATE_MARK_CLASS_TEMPLATE))
            SESSION_GROUP_ORDER.forEach(state => classes.add(`${STATE_MARK_CLASS_PREFIX}${state}`));
    }
    return [...classes].sort();
}

test('the Sessions tile\'s modules import only Clutter, GObject, Pango and St and modules of the extension\'s own, ' +
    'no Shell module, and no lib/constants.js', () =>
    assertEqual(SOURCE_FILES.map(fileName => [...readExtensionFile(fileName).matchAll(IMPORT_SPECIFIER_PATTERN)]
        .map(([, specifier]) => specifier)
        .filter(specifier => !ALLOWED_IMPORT_PATTERN.test(specifier) || specifier === CONSTANTS_IMPORT)),
    [[], [], [], [], []]));

test('the Sessions tile: built once: every actor is made and put in the tree in a constructor or a builder, and ' +
    'nothing in its modules destroys an actor', () =>
    assertEqual({
        outsideBuilders: SOURCE_FILES.map(fileName => functionNamesWithLine(codeOf(fileName), ACTOR_BUILDING_PATTERN)
            .filter(name => !ACTOR_BUILDING_FUNCTION_PATTERN.test(name ?? ''))),
        destroyCalls: SOURCE_FILES.map(fileName => occurrenceCount(codeOf(fileName), '.destroy(')),
        scanCatchesARender: functionNamesWithLine(RENDER_BUILDING_SOURCE, ACTOR_BUILDING_PATTERN),
        scanKeepsTheBuilder: functionNamesWithLine(BUILDER_WITH_CALL_SOURCE, ACTOR_BUILDING_PATTERN),
    }, {
        outsideBuilders: [[], [], [], [], []], destroyCalls: [0, 0, 0, 0, 0], scanCatchesARender: ['_renderSessions'],
        scanKeepsTheBuilder: ['newStateCount'],
    }));

test('sessionsTile.js: a placement builds the rows the flow can list with the same figures the flow is handed at ' +
    'every render, and draws the latest again; the tile builds its first rows with itself', () => {
    const tileSource = readExtensionFile(TILE_SOURCE_FILE);
    const setLayoutBody = methodBody(tileSource, 'setLayout({');
    assertEqual({
        flowTile: occurrenceCount(setLayoutBody, 'const flowTile = {columnCount, tileHeightPx: heightPx, lengths};'),
        grows: occurrenceCount(setLayoutBody,
            'this._columns.ensureSlotsFor({columnCount, rowCount: mostSessionsATileLists(flowTile)});'),
        redraws: statementsOf(setLayoutBody).at(-2),
        flowsWithIt: occurrenceCount(methodBody(tileSource, '_placeColumns('),
            'const flow = sessionsFlow({...flowTile, sessionCountByState});'),
        firstRows: occurrenceCount(methodBody(tileSource, '_init({'),
            'this._columns.ensureSlotsFor({columnCount: 1, rowCount: SESSIONS_TILE_FIRST_ROW_COUNT});'),
    }, {flowTile: 1, grows: 1, redraws: 'this._redrawLatestRender();', flowsWithIt: 1, firstRows: 1});
});

test('sessionsTileStrip.js: a strip repaints only when its history changed or as it comes back from absent, paints ' +
    'nothing at no width, and its paint reads only its own surface\'s size: no allocation is asked for during a ' +
    'repaint', () => {
    const stripSource = readExtensionFile(STRIP_SOURCE_FILE);
    const paintBody = methodBody(stripSource, 'function paintSessionStrip(');
    assertEqual({
        repaintCalls: SOURCE_FILES.map(fileName => occurrenceCount(codeOf(fileName), 'queue_repaint()')),
        guardedRepaint: statementsOf(methodBody(stripSource, 'export function showStripHistory(')).slice(1, 4),
        noRoomPaints: statementsOf(paintBody).slice(2, 4),
        surfaceSizeReads: occurrenceCount(paintBody, '.get_surface_size()'),
        otherSizeReads: ACTOR_SIZE_READ_PATTERN.test(paintBody),
        allocationBoxCalls: SOURCE_FILES.map(fileName => occurrenceCount(codeOf(fileName), 'get_allocation_box')),
        disposes: occurrenceCount(paintBody, 'cr.$dispose();'),
    }, {
        repaintCalls: [0, 0, 0, 1, 0], guardedRepaint: [
            'setStripPresent(strip, stateHistory !== null);',
            'if (stateHistory === null || strip.drawnHistory === stateHistory)', 'return;'],
        noRoomPaints: ['if (surfaceWidthPx === 0 || surfaceHeightPx === 0)', 'return;'],
        surfaceSizeReads: 1, otherSizeReads: false, allocationBoxCalls: [0, 0, 0, 0, 0], disposes: 1,
    });
});

test('the Sessions tile: a slot is shown and hidden by visibility, whole; a cell inside one (the wait edge, the ' +
    'context tag, the strip, the strip axis, the header\'s count, state counts and memory) by opacity, left visible, ' +
    'since a leaf shown or hidden by visibility draws the tile a second frame; an absent cell has no gap and no ' +
    'width, in boxes that set no spacing; and a strip coming back is painted again', () => {
    const switchedTargets = (pattern, codeText) =>
        [...new Set([...codeText.matchAll(pattern)].map(match => match[1] ?? match[2]))].sort();
    const cellsCode = codeOf(CELLS_SOURCE_FILE);
    assertEqual({
        byVisibility: SOURCE_FILES.map(fileName => switchedTargets(VISIBILITY_SWITCH_PATTERN, codeOf(fileName))),
        builtHidden: SOURCE_FILES.map(fileName => occurrenceCount(codeOf(fileName), 'visible: false')),
        byOpacity: SOURCE_FILES.map(fileName => switchedTargets(OPACITY_SWITCH_PATTERN, codeOf(fileName))),
        spacing: SOURCE_FILES.map(fileName => occurrenceCount(codeOf(fileName), SPACING_STYLE_TEXT)),
        absentLengths: ['pixelLengthStyle(\'margin-left\', SESSION_CELL_NO_ROOM_PX)',
            'pixelLengthStyle(\'width\', SESSION_CELL_NO_ROOM_PX)'].map(text => occurrenceCount(cellsCode, text)),
        noRoomPx: SESSION_CELL_NO_ROOM_PX,
        showCell: statementsOf(methodBody(readExtensionFile(CELLS_SOURCE_FILE),
            'export function showCell(')).slice(1, -1),
        stripComesBack: statementsOf(methodBody(readExtensionFile(STRIP_SOURCE_FILE),
            'function setStripPresent(')).slice(-3, -1),
        scanSeesOne: switchedTargets(VISIBILITY_SWITCH_PATTERN, LEAF_BY_VISIBILITY_SOURCE),
    }, {
        byVisibility: [[], ['actor', 'slot.actor'], [], [], []],
        builtHidden: [0, 0, 1, 0, 0],
        byOpacity: [
            ['box', 'this._countLabel', 'this._stateCountsBox', 'this._totalMemoryLabel'],
            ['labelsRow.stripAxis', 'stripAxis'], ['this._contextTag', 'this._waitEdge'], ['area', 'strip.area'],
            ['cell'],
        ],
        spacing: [0, 0, 0, 0, 0],
        absentLengths: [1, 1],
        noRoomPx: 0,
        showCell: [
            'setActorStyle(cell, isPresent ? presentStyle : ABSENT_CELL_STYLE);', 'setActorOpaque(cell, isPresent);',
        ],
        stripComesBack: ['if (isPresent)', 'strip.drawnHistory = null;'],
        scanSeesOne: ['this._contextTag', 'this._mark'],
    });
});

test('the Sessions tile: no actor moves to another parent and no parent reorders its children: every slot is placed ' +
    'by position, and the header is the tile\'s title, added once through the base\'s _addTitleActor', () =>
    assertEqual({
        reparenting: SOURCE_FILES.map(fileName => codeOf(fileName).match(REPARENTING_PATTERN) ?? []),
        headerAdded: occurrenceCount(methodBody(readExtensionFile(TILE_SOURCE_FILE), '_buildHeader() {'),
            'this._addTitleActor(this._header);'),
        titlesAdded: SOURCE_FILES.map(fileName => occurrenceCount(codeOf(fileName), '._addTitle')),
        inserts: SOURCE_FILES.map(fileName => occurrenceCount(codeOf(fileName), '.insert_child_at_index(')),
    }, {reparenting: [[], [], [], [], []], headerAdded: 1, titlesAdded: [1, 0, 0, 0, 0], inserts: [0, 0, 0, 0, 0]}));

test('stylesheet.css and the Sessions tile: every class of the tile\'s own its code names is selected in its block, ' +
    'and every class its block selects is one the code names', () => {
    const namedInCode = classesNamedInCode();
    const selectedInBlock = [...new Set([...sessionsBlockText().matchAll(SELECTOR_CLASS_PATTERN)]
        .map(([, className]) => className))].sort();
    assertEqual({selectedInBlock, isMany: selectedInBlock.length > 20}, {selectedInBlock: namedInCode, isMany: true});
});

test('stylesheet.css: the Sessions tile\'s block opens with its comment after the text block, and declares no ' +
    'length that enters a sum (no font size, padding, margin, spacing, width or height), no opacity and no ' +
    'transition: sizes are the text block\'s classes, lengths are constants', () => {
    const stylesheet = readExtensionFile(STYLESHEET_FILE);
    const blockText = sessionsBlockText();
    assertEqual({
        isAfterTextBlock: stylesheet.indexOf(SESSIONS_BLOCK_MARKER) > stylesheet.indexOf(TEXT_BLOCK_MARKER),
        lengths: LENGTH_DECLARATION_PATTERN.test(blockText),
        opacity: OPACITY_PROPERTY_PATTERN.test(blockText),
        transition: TRANSITION_PROPERTY_PATTERN.test(blockText),
        guardsSeeOne: [' padding-left: 1px;', '{height:2px', ' transition-duration: 1ms;'].map(text =>
            LENGTH_DECLARATION_PATTERN.test(text) || TRANSITION_PROPERTY_PATTERN.test(text)),
    }, {isAfterTextBlock: true, lengths: false, opacity: false, transition: false, guardsSeeOne: [true, true, true]});
});

test('the Sessions tile: no colour and no pixel length is written out in its code: the strip\'s inks and every ' +
    'length are named constants', () =>
    assertEqual({
        colours: SOURCE_FILES.map(fileName => COLOUR_LITERAL_PATTERN.test(codeOf(fileName))),
        pixels: SOURCE_FILES.map(fileName => PIXEL_LITERAL_PATTERN.test(codeOf(fileName))),
        guardsSeeOne: [COLOUR_LITERAL_PATTERN.test('#f0b429'), PIXEL_LITERAL_PATTERN.test('3px')],
    }, {
        colours: [false, false, false, false, false], pixels: [false, false, false, false, false],
        guardsSeeOne: [true, true],
    }));

test('the Sessions tile: a text and a style are assigned only through the base\'s helpers, which set them only when ' +
    'they changed', () =>
    assertEqual(SOURCE_FILES.map(fileName => /\.(?:text|style) = /.test(codeOf(fileName))),
        [false, false, false, false, false]));

test('the Sessions tile: rows are hover rows of the tile, built non-reactive with track_hover; a click activates ' +
    'the row\'s session through the base\'s onRowActivated, with the session\'s id', () => {
    const rowConstructor = methodBody(readExtensionFile(ROW_SOURCE_FILE), 'constructor() {');
    const tileInit = methodBody(readExtensionFile(TILE_SOURCE_FILE), '_init({');
    const columnsSource = readExtensionFile(COLUMNS_SOURCE_FILE);
    assertEqual({
        trackHover: occurrenceCount(rowConstructor, 'track_hover: true,'),
        builtNonReactive: occurrenceCount(rowConstructor, 'reactive: false,'),
        activation: occurrenceCount(tileInit, 'onRowActivated: onSessionActivated,'),
        joinsTheTile: occurrenceCount(methodBody(columnsSource, '_addRow() {'),
            'row.hoverRow = this._tile.addHoverRow(row.actor);'),
        clickId: occurrenceCount(methodBody(columnsSource, '_showRow('),
            'this._tile.showHoverRow(row.hoverRow, content.tooltipLines, content.id);'),
    }, {trackHover: 1, builtNonReactive: 1, activation: 1, joinsTheTile: 1, clickId: 1});
});

test('sessionsTile.js: an update, a stale line and a placement go through the base\'s recorded render, so a covered ' +
    'tile only records them', () => {
    const tileSource = readExtensionFile(TILE_SOURCE_FILE);
    assertEqual({
        update: statementsOf(methodBody(tileSource, 'update(sessions) {')).slice(3, -1),
        showNoData: statementsOf(methodBody(tileSource, 'showNoData(text) {')).slice(3, -1),
        placementRecorded: occurrenceCount(methodBody(tileSource, 'setLayout({'), 'this._redrawLatestRender();'),
    }, {
        update: ['this._renderUnlessFrozen(() => this._renderSessions(sessions));'],
        showNoData: ['this._renderUnlessFrozen(() => this._renderShortState({lineText: text, isCountShown: false}));'],
        placementRecorded: 1,
    });
});

test('sessionsTile.js: after destroy every public call does nothing: each public method opens with the base\'s ' +
    'guard; and the tile records "no data" as it is built, so a tile covered before its first update draws it as ' +
    'it is first mapped', () => {
    const tileSource = readExtensionFile(TILE_SOURCE_FILE);
    assertEqual({
        publicNames: publicMethodNames(tileSource),
        unguarded: unguardedPublicMethods(tileSource),
        recordedAtConstruction: statementsOf(methodBody(tileSource, '_init({')).at(-2),
        scanSeesOne: unguardedPublicMethods(UNGUARDED_METHOD_SOURCE),
    }, {
        publicNames: ['setLayout', 'update', 'showNoData'], unguarded: [],
        recordedAtConstruction: 'this.update(null);', scanSeesOne: ['setLayout'],
    });
});

test('sessionsTileColumns.js: the area takes its size from the layout, never from its children, and clips to its ' +
    'edge; a shown row whose place changes calls the base\'s _hideTooltipIfHovered after it is shown, and keeps ' +
    'showing', () => {
    const columnsSource = readExtensionFile(COLUMNS_SOURCE_FILE);
    const showRowStatements = statementsOf(methodBody(columnsSource, '_showRow('));
    const shownRowIndex = showRowStatements.indexOf(
        'this._tile.showHoverRow(row.hoverRow, content.tooltipLines, content.id);');
    assertEqual({
        clips: occurrenceCount(methodBody(columnsSource, 'constructor({'), 'clip_to_allocation: true,'),
        sizedFromLayout: occurrenceCount(methodBody(columnsSource, 'setAreaSize('),
            'this.actor.set_size(widthPx, heightPx);'),
        sizeCalls: occurrenceCount(codeOf(COLUMNS_SOURCE_FILE), 'this.actor.set_size('),
        movedHoveredRow: showRowStatements.slice(shownRowIndex, shownRowIndex + 3),
    }, {
        clips: 1, sizedFromLayout: 1, sizeCalls: 1, movedHoveredRow: [
            'this._tile.showHoverRow(row.hoverRow, content.tooltipLines, content.id);',
            'if (hasPlaceChanged)', 'this._tile.hideTooltipIfHovered(row.hoverRow);'],
    });
});

test('the Sessions tile: every length is an inline style built by pixelLengthStyle; a place is set directly only for ' +
    'a slot, a row and the area in the columns\' fixed layout; the side padding is fixed at construction, its ' +
    'default the composition\'s sheet\'s, so the root is never restyled; and the base alone uses the tooltip, through its call for a row that moves', () => {
    const tileCode = codeOf(TILE_SOURCE_FILE);
    assertEqual({
        placing: SOURCE_FILES.map(fileName => functionNamesWithLine(codeOf(fileName), GEOMETRY_CALL_PATTERN)),
        rootRestyles: occurrenceCount(tileCode, 'setActorStyle(this,'),
        setLayoutTakesSidePadding: SET_LAYOUT_SIDE_PADDING_PATTERN.test(tileCode),
        sidePaddingAtConstruction: occurrenceCount(tileCode,
            '_init({tooltip, onSessionActivated, sidePaddingPx = DEFAULT_SIDE_PADDING_PX}) {'),
        defaultFromTheSheet: occurrenceCount(tileCode,
            'const DEFAULT_SIDE_PADDING_PX = DEFAULT_COCKPIT_SIZES.sessions.sidePaddingPx;'),
        movedRowCall: occurrenceCount(methodBody(readExtensionFile(TILE_SOURCE_FILE), '_init({'), MOVED_ROW_CALL),
        tooltipUses: SOURCE_FILES.map(fileName => TOOLTIP_USE_PATTERN.test(codeOf(fileName))),
        guardsSeeOne: [
            GEOMETRY_CALL_PATTERN.test('label.set_width(4);'), TOOLTIP_USE_PATTERN.test('this._tooltip.hide();'),
            SET_LAYOUT_SIDE_PADDING_PATTERN.test('setLayout({widthPx, sidePaddingPx}) {'),
        ],
    }, {
        placing: PLACING_FUNCTION_NAMES, rootRestyles: 0, setLayoutTakesSidePadding: false,
        sidePaddingAtConstruction: 1, defaultFromTheSheet: 1, movedRowCall: 1,
        tooltipUses: [false, false, false, false, false],
        guardsSeeOne: [true, true, true],
    });
});
