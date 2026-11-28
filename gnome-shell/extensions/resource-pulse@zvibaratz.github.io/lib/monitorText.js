// The monitor tile's words in its forms by tracks (wide, medium, small). The figures, the line under CPU's figure, memory's swap lines and the
// meters are the desktop card's own (lib/format.js cardText), so a number reads the same on both; what is the monitor's
// alone is here:
//
// - Each track's name stands alone: the heaviest apps have their own tile beside it.
// - Each track's scale stands on its label line, at the plot's right end: CPU's "100%" always, memory's installed
//   memory ("30.3 GiB") where there is a memory reading, and a faint dash where there is none, as the figures are. So
//   the card's "of 30.3" line is the scale here, and not repeated under the figure.
// - The time axis: a label at each minute from the plot's left end, and "now" at the present.
// - The agents track's present: "7 agents working", "1 agent working", "0 agents working"; a dash while the count is
//   not known (before the cockpit service's first answer, herdr not running, the service gone, the source stale).
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs.
import {cardText, formatGibibytes} from './format.js';
import {NO_MACHINE_CONDITIONS} from './machineConditions.js';
import {MONITOR_MINUTE_LABEL_COUNT} from './monitorGeometry.js';

const CPU_TRACK_LABEL = 'CPU';
const MEMORY_TRACK_LABEL = 'Memory';
const CPU_SCALE_LABEL = '100%';
const MEMORY_SCALE_UNIT = 'GiB';
const NO_DATA_DASH = '—';
const AGENT_NOUN_SINGULAR = 'agent';
const AGENT_NOUN_PLURAL = 'agents';
/** The card's memory lines open with the memory installed ("of 30.3"), which the track's scale names instead. */
const CARD_INSTALLED_MEMORY_LINE_COUNT = 1;

/** "5 min" to "1 min", left to right, one at each minute's tick from the plot's left end. */
export const MONITOR_MINUTE_LABELS = Object.freeze(Array.from({length: MONITOR_MINUTE_LABEL_COUNT},
    (_unused, tickIndex) => `${MONITOR_MINUTE_LABEL_COUNT - tickIndex} min`));

/**
 * @typedef {object} MonitorScaleLabel A track's scale, at its plot's right end on its label line.
 * @property {string} text - '100%', '30.3 GiB', or a dash with no reading.
 * @property {boolean} isMissing - No reading: drawn faint.
 */

/**
 * @typedef {object} MonitorTraceTrackText A traced track's words.
 * @property {string} label - 'CPU' or 'Memory'.
 * @property {MonitorScaleLabel} scaleLabel - Its scale.
 * @property {import('./format.js').CardFigureText} figure - The reading now: the card's.
 * @property {import('./format.js').CardDetailLine[]} detailLines - The lines under the figure: CPU's the card's; memory's
 *     the card's swap lines, without the memory installed.
 */

/**
 * @typedef {object} MonitorText Every word on the monitor tile in a form by tracks.
 * @property {MonitorTraceTrackText} cpuTrack - CPU's track.
 * @property {MonitorTraceTrackText} memoryTrack - Memory's track.
 * @property {string} waitingOnLabel - The pressure track's label: the card's.
 * @property {import('./format.js').CardMeterText[]} meters - CPU, memory and io: the card's.
 * @property {string[]} minuteLabels - MONITOR_MINUTE_LABELS.
 * @property {string} axisNowLabel - 'now': the card's.
 */

/**
 * The agents track's present: how many sessions are working now.
 *
 * @param {*} workingCount - The sessions working now: a whole number at least 0, or null while it is not known.
 * @returns {string} '7 agents working', '1 agent working', '0 agents working', or a dash.
 */
export function agentsPresentText(workingCount) {
    if (!Number.isInteger(workingCount) || workingCount < 0)
        return NO_DATA_DASH;
    const noun = workingCount === 1 ? AGENT_NOUN_SINGULAR : AGENT_NOUN_PLURAL;
    return `${workingCount} ${noun} working`;
}

/**
 * Memory's scale: the memory installed, or a faint dash with no memory reading (never the last good total, as no
 * figure is).
 *
 * @param {{usedBytes: number, totalBytes: number}|null} memory - Memory in use, and in all.
 * @returns {MonitorScaleLabel} The scale.
 */
function memoryScaleLabel(memory) {
    if (memory === null)
        return {text: NO_DATA_DASH, isMissing: true};
    const installedText = formatGibibytes(memory.totalBytes);
    return {text: `${installedText} ${MEMORY_SCALE_UNIT}`, isMissing: false};
}

/**
 * Whether a snapshot has a reading the traces draw: a CPU or a memory reading, as the words judge "no data since". A
 * failed tick's snapshot, the client's no data and none at all have none.
 *
 * @param {import('./pulseSnapshots.js').Snapshot|null} snapshot - The snapshot, or null before the first.
 * @returns {boolean} True where it has one.
 */
export function hasTraceReading(snapshot) {
    if (snapshot === null)
        return false;
    return snapshot.cpuBusyPercent !== null || snapshot.memory !== null;
}

/**
 * Every word on the monitor tile in a form by tracks, from one snapshot and the machine's conditions, but the agents
 * track's present, which the tile sets itself as each sessions count comes (agentsPresentText).
 *
 * @param {object} options - What the tile was told.
 * @param {import('./pulseSnapshots.js').Snapshot|null} options.snapshot - The latest snapshot, or null before the
 *     first.
 * @param {string|null} options.lastGoodClockLabel - 'HH:MM' of the last snapshot with data, for "no data since".
 * @param {import('./machineConditions.js').MachineConditions} [options.conditions] - The machine's conditions now;
 *     none lit when left out.
 * @returns {MonitorText} The tile's words.
 */
export function monitorText({snapshot, lastGoodClockLabel, conditions = NO_MACHINE_CONDITIONS}) {
    const card = cardText(snapshot, lastGoodClockLabel, conditions);
    return {
        cpuTrack: {
            label: CPU_TRACK_LABEL,
            scaleLabel: {text: CPU_SCALE_LABEL, isMissing: false},
            figure: card.cpuFigure,
            detailLines: card.cpuDetailLines,
        },
        memoryTrack: {
            label: MEMORY_TRACK_LABEL,
            scaleLabel: memoryScaleLabel(snapshot?.memory ?? null),
            figure: card.memoryFigure,
            detailLines: card.memoryDetailLines.slice(CARD_INSTALLED_MEMORY_LINE_COUNT),
        },
        waitingOnLabel: card.waitingOnLabel,
        meters: card.meters,
        minuteLabels: MONITOR_MINUTE_LABELS,
        axisNowLabel: card.axisNowLabel,
    };
}
