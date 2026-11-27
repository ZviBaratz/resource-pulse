// The lengths, colours, opacities and icon names the shell draws with: the desktop card, its graphs, the top-bar graphs,
// and the cockpit's grid and cards. Each has its unit in its name. Only the shell imports this module: the cockpit
// service never loads it, so a change here waits for the next login and restarts no service. lib/constants.js, which
// both sides load, keeps the rest: what the cockpit service reads, and the shell's own timings, limits, ids and words.
import {CARD_HISTORY_SAMPLES, TOPBAR_HISTORY_SAMPLES} from './constants.js';

/** Distance of the desktop card from the screen edge, in pixels. */
export const CARD_MARGIN_PX = 24;
/** Width of one top-bar graph's slot for a sample, in logical pixels: whole pixels keep the slots crisp. */
export const TOPBAR_GRAPH_SLOT_WIDTH_PX = 1;
/** Width of each top-bar graph, in logical pixels: one slot per sample of its history. */
export const TOPBAR_GRAPH_WIDTH_PX = TOPBAR_HISTORY_SAMPLES * TOPBAR_GRAPH_SLOT_WIDTH_PX;
/** Height of each top-bar graph, in logical pixels: the height of a panel status icon. */
export const TOPBAR_GRAPH_HEIGHT_PX = 16;
/** Width of one desktop-card CPU graph slot for a sample, in logical pixels: whole pixels keep the slots crisp. */
export const CARD_GRAPH_SLOT_WIDTH_PX = 1;
/** Width of the desktop card's CPU graph, in logical pixels: one slot per sample of its five-minute history. */
export const CARD_CPU_GRAPH_WIDTH_PX = CARD_HISTORY_SAMPLES * CARD_GRAPH_SLOT_WIDTH_PX;
/** Height of the desktop card's CPU graph, in logical pixels: a little under its row's big number. */
export const CARD_CPU_GRAPH_HEIGHT_PX = 20;
/** Width of the desktop card's memory bar, in logical pixels: the CPU graph's, so the two line up. */
export const CARD_MEMORY_BAR_WIDTH_PX = CARD_CPU_GRAPH_WIDTH_PX;
/** Height of the desktop card's memory bar, in logical pixels. */
export const CARD_MEMORY_BAR_HEIGHT_PX = 8;
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
/** The unused part of the desktop card's memory bar as [red, green, blue, alpha], each 0–1: a faint groove. */
export const USED_BAR_TRACK_RGBA = [1, 1, 1, 0.15];
/** Number of cells in the pressure meter (one more than the number of band thresholds). */
export const PRESSURE_METER_CELLS = 3;
/** Width of one drawn pressure-meter cell, in logical pixels: whole pixels keep its edges crisp. */
export const PRESSURE_METER_CELL_WIDTH_PX = 6;
/** Space between two pressure-meter cells, in logical pixels. */
export const PRESSURE_METER_CELL_GAP_PX = 2;
/** Width of a whole pressure meter, in logical pixels: its cells and the gaps between them. */
export const PRESSURE_METER_WIDTH_PX =
    PRESSURE_METER_CELLS * PRESSURE_METER_CELL_WIDTH_PX + (PRESSURE_METER_CELLS - 1) * PRESSURE_METER_CELL_GAP_PX;
/** Height of a pressure meter, in logical pixels: about the cap height of the card's text. */
export const PRESSURE_METER_HEIGHT_PX = 10;
/** Thickness of the dash a pressure meter draws for no data, in logical pixels. */
export const PRESSURE_METER_NO_DATA_DASH_THICKNESS_PX = 2;
/** Filled pressure-meter cells as [red, green, blue, alpha], each 0–1: the card's value colour. */
export const PRESSURE_METER_FILL_RGBA = [1, 1, 1, 1];
/** Empty pressure-meter cells, and the no-data dash, as [red, green, blue, alpha], each 0–1: a visible groove. */
export const PRESSURE_METER_TRACK_RGBA = [1, 1, 1, 0.25];

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
