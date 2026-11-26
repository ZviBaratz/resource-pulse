// The sizes and colours the desktop card, its graphs and the top-bar graphs are drawn with, each with its unit in the
// name. Only the shell imports this module: the cockpit service never loads it, so a change here waits for the next
// login and restarts no service (lib/constants.js, which both sides load, holds what the cockpit service reads too).
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
/** Fill of the CPU graph as [red, green, blue, alpha], each 0–1: the CPU series' teal, #30adc4. */
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
