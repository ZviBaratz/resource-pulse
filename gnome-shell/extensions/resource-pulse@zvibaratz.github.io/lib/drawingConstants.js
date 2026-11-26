// The lengths, colours, opacities and icon names the shell draws with: the desktop card, its graphs, the top-bar graphs,
// and the cockpit's grid and cards. Each has its unit in its name. Only the shell imports this module: the cockpit
// service never loads it, so a change here waits for the next login and restarts no service. lib/constants.js, which
// both sides load, keeps the rest: what the cockpit service reads, and the shell's own timings, limits, ids and words.
import {TOPBAR_HISTORY_SAMPLES} from './constants.js';

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

/** The Heaviest tile's height above its rows less its title line and its heading's detail line. */
export const HEAVIEST_FIXED_HEIGHT_PX = 49;
/** A ranking's row less its row line. */
export const RANKING_ROW_FIXED_HEIGHT_PX = 6;
/** The Connections tile in one line, less its row line. */
export const CONNECTIONS_LINE_FIXED_HEIGHT_PX = 38;

/** The Sessions tile above its columns of groups, less its title line and its strips' scale line. */
export const SESSIONS_ABOVE_COLUMNS_FIXED_HEIGHT_PX = 43;
/** A group of sessions' heading less its line. */
export const SESSION_GROUP_HEADING_FIXED_HEIGHT_PX = 8;
/** A "+N more" line less its detail line. */
export const MORE_LINE_FIXED_HEIGHT_PX = 5;
/** A done, idle or unknown session's row less its row line. */
export const SESSION_ROW_FIXED_HEIGHT_PX = 3;
/** A working session's row less its row line. */
export const WORKING_ROW_FIXED_HEIGHT_PX = 6;
/** A waiting session's row, the gap under it included, less its name's line. */
export const WAITING_ROW_FIXED_HEIGHT_PX = 24;
