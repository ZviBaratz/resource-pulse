// The lengths, colours, opacities and icon names the shell draws with: the desktop card, its graphs, the top-bar graphs,
// and the cockpit's grid and cards. Each has its unit in its name. Only the shell imports this module: the cockpit
// service never loads it, so a change here waits for the next login and restarts no service. lib/constants.js, which
// both sides load, keeps the rest: what the cockpit service reads, and the shell's own timings, limits, ids and words.
import {TOPBAR_HISTORY_SAMPLES} from './constants.js';
import {SESSION_STATE_HISTORY_CELLS} from './cockpitProtocol.js';

/** Distance of the desktop card from the screen edge, in pixels. */
export const CARD_MARGIN_PX = 24;
/** Width of one top-bar graph's slot for a sample, in logical pixels: whole pixels keep the slots crisp. */
export const TOPBAR_GRAPH_SLOT_WIDTH_PX = 1;
/** Width of each top-bar graph, in logical pixels: one slot per sample of its history. */
export const TOPBAR_GRAPH_WIDTH_PX = TOPBAR_HISTORY_SAMPLES * TOPBAR_GRAPH_SLOT_WIDTH_PX;
/** Height of each top-bar graph, in logical pixels: the height of a panel status icon. */
export const TOPBAR_GRAPH_HEIGHT_PX = 16;
/** Thickness of the faint line along the bottom of every graph, in logical pixels. */
export const GRAPH_BASELINE_THICKNESS_PX = 1;
/**
 * Fill of the CPU graph as [red, green, blue, alpha], each 0–1: the CPU series' teal, #30adc4. A session working and a
 * VPN up are drawn in the same teal (stylesheet.css).
 */
export const CPU_GRAPH_RGBA = [0x30 / 0xff, 0xad / 0xff, 0xc4 / 0xff, 1];
/** Fill of the memory graph as [red, green, blue, alpha], each 0–1: the memory series' purple, #a85fc9. */
export const MEMORY_GRAPH_RGBA = [0xa8 / 0xff, 0x5f / 0xff, 0xc9 / 0xff, 1];
/** The faint line under every graph as [red, green, blue, alpha], each 0–1, so an empty graph still shows. */
export const BASELINE_RGBA = [1, 1, 1, 0.25];
/** The desktop card's traces' faint grid (the top line, the half-height line, the minute ticks), each 0–1. */
export const TRACE_GRID_RGBA = [1, 1, 1, 0.14];
/** The hatch of a gap in a desktop card's trace, each 0–1. */
export const TRACE_GAP_HATCH_RGBA = [1, 1, 1, 0.16];
/** The alpha the CPU trace's area starts at, at its run's highest point; it fades to nothing at the baseline. */
export const CPU_TRACE_AREA_ALPHA = 0.34;
/** The alpha the memory trace's area starts at, fainter than the CPU's; it fades to nothing at the baseline. */
export const MEMORY_TRACE_AREA_ALPHA = 0.16;
/** Number of cells in the pressure meter (one more than the number of band thresholds). */
export const PRESSURE_METER_CELLS = 3;
/** The resources the card has a pressure meter for: CPU, memory and io. */
export const PRESSURE_RESOURCE_COUNT = 3;
/** Width of one drawn pressure-meter cell, in logical pixels: whole pixels keep its edges crisp. */
export const PRESSURE_METER_CELL_WIDTH_PX = 14;
/** Space between two pressure-meter cells, in logical pixels. */
export const PRESSURE_METER_CELL_GAP_PX = 4;
/** Width of a whole pressure meter, in logical pixels: its cells and the gaps between them. */
export const PRESSURE_METER_WIDTH_PX =
    PRESSURE_METER_CELLS * PRESSURE_METER_CELL_WIDTH_PX + (PRESSURE_METER_CELLS - 1) * PRESSURE_METER_CELL_GAP_PX;
/** Height of a pressure meter, in logical pixels. */
export const PRESSURE_METER_HEIGHT_PX = 10;
/** Radius of a pressure-meter cell's corners, in logical pixels. */
export const PRESSURE_METER_CELL_RADIUS_PX = 2;
/** Thickness of the dash a pressure meter draws for no data, in logical pixels. */
export const PRESSURE_METER_NO_DATA_DASH_THICKNESS_PX = 2;
/** Filled pressure-meter cells as [red, green, blue, alpha], each 0–1: the card's value colour. */
export const PRESSURE_METER_FILL_RGBA = [1, 1, 1, 1];
/** Filled pressure-meter cells of a resource waited on (lib/machineConditions.js), each 0–1: amber, #f0b429. */
export const PRESSURE_METER_WAIT_FILL_RGBA = [0xf0 / 0xff, 0xb4 / 0xff, 0x29 / 0xff, 1];
/** Empty pressure-meter cells as [red, green, blue, alpha], each 0–1: a faint groove. */
export const PRESSURE_METER_TRACK_RGBA = [1, 1, 1, 0.18];
/** The no-data dash of a pressure meter as [red, green, blue, alpha], each 0–1: a little brighter than a groove. */
export const PRESSURE_METER_NO_DATA_RGBA = [1, 1, 1, 0.3];

// The desktop card's compact form: its fixed lengths, in logical pixels. Its text sizes are in em, in stylesheet.css,
// so text scaling grows the text and leaves these alone; lib/compactCardGeometry.js places every part from both.
/** The plot's width, the traces' and the strips': the five-minute history's 150 samples across it. */
export const COMPACT_PLOT_WIDTH_PX = 208;
/** The most the plot gives up where the card's cell is narrower than the card: 22 px of its 208. */
export const COMPACT_PLOT_WIDTH_GIVEN_UP_LIMIT_PX = 22;
/** From the plot's right edge to the now rule. */
export const COMPACT_NOW_RULE_GAP_PX = 12;
/** From the now rule's left edge to the now column (the figures). */
export const COMPACT_NOW_COLUMN_GAP_PX = 16;
/** The now rule's width. */
export const COMPACT_NOW_RULE_WIDTH_PX = 1;
/** Under a section's label line, before its trace. */
export const COMPACT_SECTION_LABEL_GAP_PX = 2;
/**
 * A trace's height with a pressure history; without one each trace also takes one pressure row of the two given up.
 * Where the memory figure's lines would reach the meters, the traces grow too (lib/compactCardGeometry.js).
 */
export const COMPACT_TRACE_HEIGHT_PX = 46;
/** The most lines under the memory figure: memory installed, the zram line and swap on disk. */
export const COMPACT_MEMORY_DETAIL_LINE_COUNT = 3;
/** Between two sections, and between the axis and the "Waiting on" section. */
export const COMPACT_SECTION_GAP_PX = 10;
/** Under a meter name's line, inside its pressure row. */
export const COMPACT_PRESSURE_ROW_GAP_PX = 2;
/** Above the time axis's labels. */
export const COMPACT_AXIS_GAP_PX = 4;
/**
 * How far a figure's line box starts above its trace, as a share of the box: 8 px of the 37 px box at the default text
 * size, so its digits keep their place against the trace at every size.
 */
export const COMPACT_FIGURE_LIFT_SHARE = 8 / 37;
/** Between a figure and its unit. */
export const COMPACT_UNIT_GAP_PX = 4;
/** Between a section's name and its heaviest app's name, a space and a little more. */
export const COMPACT_HEAVIEST_NAME_GAP_PX = 10;
/** Between the heaviest app's name and its value, a space. */
export const COMPACT_HEAVIEST_VALUE_GAP_PX = 3;
/** Between a pressure meter and its name. */
export const COMPACT_METER_NAME_GAP_PX = 10;
/** Between a meter's name and its percentage, a space and a little more. */
export const COMPACT_METER_PERCENT_GAP_PX = 7;
/** Without a pressure history: the least clear space after a meter's row, at its widest percentage, before the next. */
export const COMPACT_METER_ROW_CLEARANCE_PX = 10;
/** A pressure strip's height, with a pressure history. */
export const COMPACT_PRESSURE_STRIP_HEIGHT_PX = 11;
/** Between two cells of a pressure strip. */
export const PRESSURE_STRIP_CELL_GAP_PX = 2;
/** Radius of a pressure strip cell's corners. */
export const PRESSURE_STRIP_CELL_RADIUS_PX = 1;
/** A calm cell of a pressure strip (band 0): a low dash at the strip's foot, this high. */
export const PRESSURE_STRIP_CALM_DASH_HEIGHT_PX = 2;
/** A calm cell of a pressure strip as [red, green, blue, alpha], each 0–1: faint white. */
export const PRESSURE_STRIP_CALM_RGBA = [1, 1, 1, 0.22];
/** A strip cell of band 1, a third of the strip high, as [red, green, blue, alpha], each 0–1: brighter white. */
export const PRESSURE_STRIP_BAND_RGBA = [1, 1, 1, 0.63];
/**
 * The card's whole height at the shell's default text size and font, its border and padding included: what the
 * cockpit's fit keeps a row of the grid at, at least (lib/cockpitGrid.js). Larger text, or a larger font, makes the
 * card taller than this, as it does wider; a table measures this figure from the card's geometry.
 */
export const COMPACT_CARD_HEIGHT_AT_DEFAULT_TEXT_PX = 286;

// The cockpit's grid and cards.

/**
 * The cockpit grid at its reference size, in logical pixels (the numbers at 1920 x 1080): every length scales
 * with the cockpit monitor's work area. `columns` and `rows` are the most cells a group's block holds across and down.
 */
export const COCKPIT_GRID_REFERENCE = Object.freeze({
    widthPx: 1920, heightPx: 1080, cellWidthPx: 420, cellHeightPx: 300,
    innerGutterPx: 24, groupGapPx: 48, rowGutterPx: 24, captionHeightPx: 28, columns: 4, rows: 3,
});
/** The largest factor the cockpit grid grows to, however large the monitor. */
export const COCKPIT_GRID_MAX_SCALE = 2;
/**
 * The widest a cockpit card's content draws, in logical pixels, its cell's padding and border included. The grid's
 * cells scale with the work area and the cards' content does not. The system cell holds the desktop card (card.js),
 * whose content is at most 416 px wide at the shell's default text size, padding and border included; the other
 * cards' rows fit in less. Where a scaled cell and its inner gutter are narrower, a card runs into the next one, so
 * the grid is not drawn (lib/cockpitGrid.js isCockpitGridDrawable).
 */
export const COCKPIT_CARD_CONTENT_WIDTH_PX = 416;
/** Size of a cockpit row's icon and of the sessions header's state icons, in logical pixels: a panel status icon's. */
export const COCKPIT_ROW_ICON_SIZE_PX = 16;
/**
 * Width of a cockpit row's bar track, as a share of its cell's width: a fixed slot at the row's end, so a bar's change
 * never moves the name beside it, and the bars of a card line up.
 */
export const COCKPIT_ROW_BAR_TRACK_SHARE_OF_CELL_WIDTH = 0.15;
/** Pixels between a state's icon and its count in the sessions header, closer than the header's other parts. */
export const COCKPIT_STATE_COUNT_SPACING_PX = 2;
/**
 * The actor opacity, of 255, of a long-idle session row: an alpha of 0.55. St reads no CSS `opacity`, so the
 * sessions card sets it on the row actor.
 */
export const COCKPIT_LONG_IDLE_ROW_OPACITY = 140;
/** Pixels between a cockpit row's edge and the cockpit tooltip's nearest edge. */
export const COCKPIT_TOOLTIP_GAP_PX = 6;
/** Icon names (symbolic, from the stock theme) the cockpit cards draw, by session state and by connection kind. */
export const COCKPIT_ICON_NAMES = Object.freeze({
    working: 'media-playback-start-symbolic',
    blocked: 'dialog-warning-symbolic',
    idle: 'media-playback-pause-symbolic',
    done: 'object-select-symbolic',
    unknown: 'dialog-question-symbolic',
    wired: 'network-wired-symbolic',
    wifi: 'network-wireless-symbolic',
    offline: 'network-offline-symbolic',
    online: 'network-transmit-receive-symbolic',
    vpn: 'network-vpn-symbolic',
    ssh: 'utilities-terminal-symbolic',
    mountRemovable: 'drive-removable-media-symbolic',
    mountNetwork: 'folder-remote-symbolic',
    mountLocal: 'drive-harddisk-symbolic',
});

// The fixed parts of the cockpit's lengths that hold text: each length is its fixed part and the line boxes of its
// text, which St measures in the text's own class (stylesheet.css, the cockpit's text sizes) and lib/measuredLengths.js
// adds up. A tile or a plate that draws one of these lengths draws it with the same constant, so the length the
// layout is given and the length drawn are one sum.

/** A caption plate's height less its annunciator cells: its border and the room above and below the cells. */
export const PLATE_FIXED_HEIGHT_PX = 8;
/** An annunciator cell's height less its caption's line box. */
export const ANNUNCIATOR_CELL_FIXED_HEIGHT_PX = 5;
/** A caption plate's border, on each side. */
export const PLATE_BORDER_WIDTH_PX = 1;
/** The room inside a plate's border before its group caption. */
export const PLATE_PADDING_START_PX = 12;
/** The room inside a plate's border after its last annunciator cell. */
export const PLATE_PADDING_END_PX = 4;
/** The room a plate's group caption keeps after itself, before the item gap to the first cell. */
export const PLATE_GROUP_CAPTION_GAP_PX = 8;
/** The gap between two items of a plate, the group caption and the first cell included. */
export const PLATE_ITEM_GAP_PX = 2;
/** An annunciator cell's padding, on each side of its caption. */
export const ANNUNCIATOR_CELL_PADDING_PX = 8;

/** The monitor tile's height less its text, by form. */
export const MONITOR_FIXED_HEIGHT_PX_BY_FORM = Object.freeze({wide: 220, medium: 210, small: 186});
/** The monitor's track labels (one row line each), in every form. */
export const MONITOR_TRACK_LABEL_COUNT = 3;
/** A monitor track label's slot less its row line. */
export const MONITOR_TRACK_LABEL_SLOT_FIXED_HEIGHT_PX = 2;
/** The monitor's detail lines (the meters' names, and in the wide form the agents track's line), by form. */
export const MONITOR_DETAIL_SLOT_COUNT_BY_FORM = Object.freeze({wide: 4, medium: 3, small: 3});
/** A monitor detail line's slot less its detail line. */
export const MONITOR_DETAIL_SLOT_FIXED_HEIGHT_PX = 6;
/** The monitor tile's padding from its edge above its first track, and on each side of its tracks and now column. */
export const MONITOR_PADDING_TOP_PX = 18;
export const MONITOR_PADDING_INLINE_PX = 24;
/** Each trace's height at its tightest (the wide form's with the agents track, every form's with a pressure history), by
 *  form: a fixed length, which only a figure that needs more lengthens. */
export const MONITOR_TRACE_HEIGHT_PX_BY_FORM = Object.freeze({wide: 75, medium: 72, small: 64});
/** The gap under a trace track, before the next track's label, by form. */
export const MONITOR_TRACK_GAP_PX_BY_FORM = Object.freeze({wide: 14, medium: 14, small: 12});
/** The gap above the agents track, and above the time axis's labels. */
export const MONITOR_AGENTS_TRACK_GAP_PX = 4;
export const MONITOR_AXIS_GAP_PX = 4;
/** From the plot's right edge to the present's rule, and from the rule to the now column. */
export const MONITOR_NOW_RULE_GAP_PX = 12;
export const MONITOR_NOW_COLUMN_GAP_PX = 16;
/** The present's rule, and its ticks right of it at the top, middle and bottom of each trace. */
export const MONITOR_NOW_RULE_WIDTH_PX = 1;
export const MONITOR_PRESENT_TICK_LENGTH_PX = 5;
/** The present's rule, and its ticks, which are brighter. */
export const MONITOR_NOW_RULE_RGBA = Object.freeze([1, 1, 1, 0.3]);
export const MONITOR_PRESENT_TICK_RGBA = Object.freeze([1, 1, 1, 0.5]);
/** A tick's thickness. */
export const MONITOR_PRESENT_TICK_THICKNESS_PX = 1;
/** A pressure strip, and the agents track's strip, at the top of its row. */
export const MONITOR_STRIP_HEIGHT_PX = 14;
/** A track form's meter: three cells of 18 × 13 px, PRESSURE_METER_CELL_GAP_PX apart. */
export const MONITOR_METER_CELL_WIDTH_PX = 18;
export const MONITOR_METER_HEIGHT_PX = 13;
export const MONITOR_METER_WIDTH_PX =
    PRESSURE_METER_CELLS * MONITOR_METER_CELL_WIDTH_PX + (PRESSURE_METER_CELLS - 1) * PRESSURE_METER_CELL_GAP_PX;
/** A meter's name after the meter, and its percentage after the name. */
export const MONITOR_METER_NAME_GAP_PX = 10;
export const MONITOR_METER_PERCENT_GAP_PX = 4;
/** A figure's unit after the figure. */
export const MONITOR_FIGURE_UNIT_GAP_PX = 6;
/** The share of a figure's line box above its digits' tops, by which the figure rises above its trace: 12 px of
 *  the 63 px figure at the default text size, so it grows with the figure. */
export const MONITOR_FIGURE_LIFT_SHARE = 0.19;
/** The plot's widths: the least, the least where another column stands beside the monitor's, and its stop. */
export const MONITOR_PLOT_LEAST_WIDTH_PX = 300;
export const MONITOR_PLOT_LEAST_BESIDE_ANOTHER_COLUMN_WIDTH_PX = 500;
export const MONITOR_PLOT_STOP_WIDTH_PX = 724;

/** A tile's border, on each side: the tile surface's 1px border (stylesheet.css, rp-tile-surface). */
export const TILE_BORDER_WIDTH_PX = 1;
/** A tile's padding inside its border, above and below its content: 18 from the tile's edge, with the border. */
export const TILE_PADDING_BLOCK_PX = 17;
/** A tile's padding inside its border, on each side of its content: 20 from the tile's edge, with the border. */
export const TILE_PADDING_INLINE_PX = 19;
/** The room under a tile's title line. */
export const TILE_TITLE_GAP_BELOW_PX = 7;
/** The room under a ranking's heading line ("by CPU", "by memory"). */
export const RANKING_HEADING_GAP_BELOW_PX = 6;

/**
 * The Heaviest tile's height above its rows less its title line and its heading's detail line: the room above and
 * below its content, the gap under its title and the gap under its headings. The tile draws each with these
 * constants.
 */
export const HEAVIEST_FIXED_HEIGHT_PX = 2 * (TILE_BORDER_WIDTH_PX + TILE_PADDING_BLOCK_PX) + TILE_TITLE_GAP_BELOW_PX +
    RANKING_HEADING_GAP_BELOW_PX;
/** A ranking's row less its row line. */
export const RANKING_ROW_FIXED_HEIGHT_PX = 6;
/** The Connections tile in one line, less its row line. */
export const CONNECTIONS_LINE_FIXED_HEIGHT_PX = 38;
/** A row of the Connections list (a link or a mount) less its row line. */
export const CONNECTIONS_LINK_ROW_FIXED_HEIGHT_PX = 8;
/** The rule over the Connections list's mounts. */
export const CONNECTIONS_RULE_HEIGHT_PX = 1;
/** The room above and below the rule over the Connections list's mounts. */
export const CONNECTIONS_RULE_GAP_PX = 8;

/**
 * The Sessions tile above its columns of groups, less its title line and its strips' scale line: the room above and
 * below its content and the gap under its title. The tile draws each with these constants.
 */
export const SESSIONS_ABOVE_COLUMNS_FIXED_HEIGHT_PX = 2 * (TILE_BORDER_WIDTH_PX + TILE_PADDING_BLOCK_PX) +
    TILE_TITLE_GAP_BELOW_PX;
/** The room above a group of sessions' heading, between it and the item over it. */
export const SESSION_GROUP_HEADING_GAP_ABOVE_PX = 6;
/** The room under a group of sessions' heading, between its line and its first row. */
export const SESSION_GROUP_HEADING_GAP_BELOW_PX = 2;
/** A group of sessions' heading less its line. */
export const SESSION_GROUP_HEADING_FIXED_HEIGHT_PX = SESSION_GROUP_HEADING_GAP_ABOVE_PX +
    SESSION_GROUP_HEADING_GAP_BELOW_PX;
/** A "+N more" line less its detail line. */
export const MORE_LINE_FIXED_HEIGHT_PX = 5;
/** A done, idle or unknown session's row less its row line. */
export const SESSION_ROW_FIXED_HEIGHT_PX = 3;
/** A working session's row less its row line. */
export const WORKING_ROW_FIXED_HEIGHT_PX = 6;
/** The gap under a waiting session's row, between its lift and the next item. */
export const WAITING_ROW_GAP_BELOW_PX = 4;
/** The room inside a waiting session's lift above its name's line, and again below it. */
export const WAITING_ROW_LIFT_PADDING_BLOCK_PX = 10;
/** A waiting session's row, the gap under it included, less its name's line. */
export const WAITING_ROW_FIXED_HEIGHT_PX = WAITING_ROW_GAP_BELOW_PX + 2 * WAITING_ROW_LIFT_PADDING_BLOCK_PX;

// The Heaviest and Connections tiles' widths, gaps and drawing. A width that holds text is a fixed part and the
// width of a sample text measured in the text's own class (lib/heaviestRankings.js, lib/connectionsFit.js); these are
// the fixed parts.

/** The gap between Heaviest's two rankings where the tile is narrower than its stop. */
export const RANKING_GAP_NARROW_PX = 24;
/** The gap between Heaviest's two rankings where the tile is at its stop or wider. */
export const RANKING_GAP_PX = 40;
/** The room between a ranking row's name and its bar, and between its bar and its value. */
export const RANKING_ROW_ITEM_GAP_PX = 12;
/** A ranking's bar at Heaviest's least width: what is left of the row once its name and value have their text. */
export const RANKING_BAR_LEAST_WIDTH_PX = 22;
/** What a ranking's name gains over its text where the tile is at its stop or wider. */
export const RANKING_NAME_EXTRA_WIDTH_PX = 36;
/** Heaviest's stop less its least width: what its names and bars gain together, both rankings. */
export const HEAVIEST_STOP_EXTRA_WIDTH_PX = 184;
/** The narrowest a shown row's bar fill is: a ranking's 0 % row still shows a mark on its track. */
export const BAR_FILL_LEAST_WIDTH_PX = 1;
/** A Connections link's icon, in either form. */
export const CONNECTIONS_LINK_ICON_SIZE_PX = 16;
/** The room between a Connections list row's parts: icon, name, bar and detail. */
export const CONNECTIONS_LIST_ITEM_GAP_PX = 12;
/** The room between a one-line Connections link's parts: icon, name and detail. */
export const CONNECTIONS_LINE_ITEM_GAP_PX = 8;
/** The room between two links of the one-line Connections tile. */
export const CONNECTIONS_LINE_LINK_GAP_PX = 32;
/** The widest a mount's label is drawn in the Connections list, at the default text size; it grows with the text. */
export const MOUNT_NAME_MOST_WIDTH_PX = 104;
/** The narrowest a mount's bar is drawn in the Connections list. */
export const MOUNT_BAR_LEAST_WIDTH_PX = 28;
/** The gaps along a Connections list mount row: icon to label, label to bar, bar to detail. */
export const CONNECTIONS_LIST_ROW_GAP_COUNT = 3;
/** The Connections list's least width less its text: what its mount row's fixed parts take. */
export const CONNECTIONS_LIST_LEAST_FIXED_WIDTH_PX = 2 * (TILE_BORDER_WIDTH_PX + TILE_PADDING_INLINE_PX) +
    CONNECTIONS_LINK_ICON_SIZE_PX + CONNECTIONS_LIST_ROW_GAP_COUNT * CONNECTIONS_LIST_ITEM_GAP_PX +
    MOUNT_BAR_LEAST_WIDTH_PX;
/** The Connections list's stop less its least width: what its mounts' bars gain. */
export const CONNECTIONS_LIST_STOP_EXTRA_WIDTH_PX = 76;
/**
 * Connections' width in a composition of one row less the list's least width: the composition's default sizes give
 * one row 300 px, 40 over the list's least at the default text size, with no part that says why; held as a fixed
 * part, so it grows with the text.
 */
export const ONE_ROW_CONNECTIONS_EXTRA_WIDTH_PX = 40;
/** The most mounts the Connections list names; the rest are counted on its "+N more" line. */
export const MOUNT_LIST_MOST_COUNT = 5;
/**
 * The mount slots the one-line Connections tile builds: at the widest line a column holds and the default text,
 * about six mounts fit beside the uplink, the VPN, the SSH masters and "+N more"; the rest are counted.
 */
export const MOUNT_LINE_SLOT_COUNT = 8;
/** A dash of the rule drawn in place of the bar of a mount with no sizes. */
export const UNKNOWN_SIZE_DASH_PX = 3;
/** The gap after each dash of that rule. */
export const UNKNOWN_SIZE_DASH_GAP_PX = 3;
/** The rule drawn in place of the bar of a mount with no sizes: its thickness. */
export const UNKNOWN_SIZE_RULE_THICKNESS_PX = 1;
/**
 * The actor opacity, of 255, of a covered tile's content: about 42 %. St reads no CSS opacity, so the tile sets it on
 * its content, and its surface stays as it is.
 */
export const FROZEN_CONTENT_OPACITY = 107;

// The Sessions tile's rows, its hour strips and its context tags. Every length a row's width is made of is here, so
// the widths the tile draws and the widths it is said to need are one sum (lib/sessionsTileGeometry.js).

/**
 * The room at each side of a Sessions row, heading, line, header and no-data line, inside the tile's own side
 * padding: a waiting row's lift then reaches the column's edges.
 */
export const SESSION_ROW_PADDING_INLINE_PX = 10;
/** The gap between two cells of a Sessions row: its mark, name, context tag, strip, age and memory. */
export const SESSION_ROW_CELL_GAP_PX = 10;
/**
 * A Sessions cell's gap and width where it takes no room: an absent cell's (left visible and transparent, so the
 * cells beside it take its room), and the first shown state count's gap.
 */
export const SESSION_CELL_NO_ROOM_PX = 0;
/** Size of a session's state mark, on its row and in the Sessions tile's header, in logical pixels. */
export const SESSION_MARK_SIZE_PX = 14;
/**
 * The session rows the Sessions tile builds with itself: a one-column placement under 1109 px high lists no more at
 * the default lengths, so only a taller one, or one of two or more columns, builds more, once, at its placement
 * (lib/sessionsFlow.js mostSessionsATileLists).
 */
export const SESSIONS_TILE_FIRST_ROW_COUNT = 48;
/** The gap between the Sessions tile's title and its count: the width of a space and 4 px more. */
export const SESSIONS_TITLE_COUNT_GAP_PX = 9;
/** The gap between the Sessions tile's title, its states' counts and its memory, in its header. */
export const SESSIONS_HEADER_ITEM_GAP_PX = 12;
/** The gap between a group of sessions' heading and its count: the width of a space and 2 px more. */
export const SESSION_GROUP_HEADING_COUNT_GAP_PX = 5;
/** The gap between a state's mark and its count in the Sessions tile's header. */
export const SESSION_STATE_COUNT_GAP_PX = 4;
/** The gap between one state's count and the next in the Sessions tile's header. */
export const SESSION_STATE_COUNTS_GAP_PX = 12;
/** Width of one minute of a session's hour strip: a whole number of pixels, so no cell's edge falls between two. */
export const SESSION_STRIP_CELL_WIDTH_PX = 2;
/** Width of a session's hour strip: a cell for each minute of its state history. */
export const SESSION_STRIP_WIDTH_PX = SESSION_STATE_HISTORY_CELLS * SESSION_STRIP_CELL_WIDTH_PX;
/** Height of a session's hour strip: a minute it waited on you fills it. */
export const SESSION_STRIP_HEIGHT_PX = 14;
/** Height of the low band a minute of work draws along the strip's foot: half the strip. */
export const SESSION_STRIP_WORKING_BAND_HEIGHT_PX = 7;
/** Thickness of the track along the strip's foot, which is all an idle, done or unknown minute draws. */
export const SESSION_STRIP_TRACK_HEIGHT_PX = 1;
/** A minute of work on the strip as [red, green, blue, alpha], each 0–1: the CPU series' teal at 60 %. */
export const SESSION_STRIP_WORKING_RGBA = [CPU_GRAPH_RGBA[0], CPU_GRAPH_RGBA[1], CPU_GRAPH_RGBA[2], 0.6];
/** A wait still going on, on the strip, as [red, green, blue, alpha], each 0–1: the amber of #f0b429. */
export const SESSION_STRIP_WAITING_RGBA = [0xf0 / 0xff, 0xb4 / 0xff, 0x29 / 0xff, 1];
/** A wait that has ended, on the strip, as [red, green, blue, alpha], each 0–1: a neutral ink. */
export const SESSION_STRIP_WAITED_RGBA = [1, 1, 1, 0.3];
/** The strip's track as [red, green, blue, alpha], each 0–1: faint, so a quiet hour reads as a line. */
export const SESSION_STRIP_TRACK_RGBA = [1, 1, 1, 0.12];
/** A session's context, in percent as drawn (whole), from which every row shows its context tag, outlined. */
export const SESSION_CONTEXT_CAUTION_PERCENT = 80;
/** The room at each side of an outlined context tag's words, inside its border. */
export const CONTEXT_TAG_PADDING_INLINE_PX = 5;
/** Width of the amber edge along a waiting session's row. */
export const WAIT_EDGE_WIDTH_PX = 3;
/** The room at each side of a waiting session's age, inside its amber cell. */
export const WAITING_AGE_CELL_PADDING_INLINE_PX = 7;
/** The room above and below a waiting session's age, inside its amber cell. */
export const WAITING_AGE_CELL_PADDING_BLOCK_PX = 2;
