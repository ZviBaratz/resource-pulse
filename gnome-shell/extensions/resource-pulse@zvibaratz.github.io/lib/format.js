// Every string the top-bar label and the desktop card show, and the sizes the cockpit writes. Pure functions; the Shell
// glue only calls these.
import {BYTES_PER_GIBIBYTE, CPU_IDLE_LABEL, CPU_IDLE_THRESHOLD_PERCENT} from './constants.js';
import {NO_MACHINE_CONDITIONS} from './machineConditions.js';
import {pressureBand} from './pressure.js';

const NO_DATA_TEXT = 'no data';
const SEPARATOR = ' · ';
/** Between the lit captions the hover label names. */
const CAPTION_SEPARATOR = ', ';
const EM_DASH = '—';
const BYTES_PER_MEBIBYTE = 1024 * 1024;
const MEBIBYTES_PER_GIBIBYTE = 1024;
/** From this many GiB a free space is written whole; under it, with one decimal. */
const WHOLE_GIBIBYTES_FROM = 10;
// The desktop card's fixed words, as drawn on it.
const CARD_CPU_SECTION_NAME = 'CPU';
const CARD_MEMORY_SECTION_NAME = 'Memory';
const CARD_WAITING_ON_LABEL = 'Waiting on';
const CARD_AXIS_START_LABEL = '5 min';
const CARD_AXIS_NOW_LABEL = 'now';
const CARD_CPU_UNIT = '%';
const CARD_MEMORY_UNIT = 'GiB';
const SWAP_NO_DATA_LINE = 'swap no data';
const SWAP_NONE_LINE = 'swap none';
// The names beside the card's three pressure meters, in the order it draws them, with the reading each one reads.
const CARD_METER_RESOURCES = [
    {name: 'cpu', resource: 'cpu'},
    {name: 'mem', resource: 'memory'},
    {name: 'io', resource: 'io'},
];

/**
 * Formats a byte count as GiB with one decimal and no unit.
 *
 * @param {number} bytes - Size in bytes.
 * @returns {string} For example '19.1'.
 */
export function formatGibibytes(bytes) {
    return (bytes / BYTES_PER_GIBIBYTE).toFixed(1);
}

/**
 * Formats a percentage as a whole number with a percent sign.
 *
 * @param {number} percent - Percentage.
 * @returns {string} For example '23%'.
 */
export function formatWholePercent(percent) {
    return `${Math.round(percent)}%`;
}

/**
 * Describes memory use.
 *
 * @param {{usedBytes: number, totalBytes: number}|null} memory - Memory usage.
 * @returns {string} For example '19.1 of 30.5 GiB', or 'no data'.
 */
export function memoryLine(memory) {
    if (memory === null || memory === undefined)
        return NO_DATA_TEXT;
    return `${formatGibibytes(memory.usedBytes)} of ${formatGibibytes(memory.totalBytes)} GiB`;
}

/**
 * Describes per-cluster CPU load. A side with no data is left out (a machine with no efficiency cores has none).
 *
 * @param {{performancePercent: number|null, efficiencyPercent: number|null}|null} cpuClusters - Cluster loads.
 * @returns {string} For example 'P 80 · E 40', or '' when there is nothing to show.
 */
export function clusterSuffix(cpuClusters) {
    if (cpuClusters === null || cpuClusters === undefined)
        return '';
    const parts = [];
    if (cpuClusters.performancePercent !== null)
        parts.push(`P ${Math.round(cpuClusters.performancePercent)}`);
    if (cpuClusters.efficiencyPercent !== null)
        parts.push(`E ${Math.round(cpuClusters.efficiencyPercent)}`);
    return parts.join(SEPARATOR);
}


/**
 * Says there is no data, and since when when that is known.
 *
 * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data.
 * @returns {string} 'no data since 14:02', or 'no data' without a last good time.
 */
export function noDataSince(lastGoodClockLabel) {
    if (lastGoodClockLabel === null || lastGoodClockLabel === undefined)
        return NO_DATA_TEXT;
    return `${NO_DATA_TEXT} since ${lastGoodClockLabel}`;
}

/**
 * Builds the top-bar hover label: the numbers' summary, then the machine's lit captions, if any, separated by commas.
 * A missing half of the summary says 'no data' rather than showing a stale number.
 *
 * @param {{cpuBusyPercent: number|null, memory: {usedBytes: number, totalBytes: number}|null}|null} snapshot
 *     Latest snapshot.
 * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data.
 * @param {ReadonlyArray<string>} [litCaptions] - The machine's lit captions (lib/machineCaptions.js), in their order.
 * @returns {string} For example 'cpu 23% · mem 16.4 of 30.3 GiB', 'cpu 91% · mem 29.8 of 30.3 GiB · CPU wait,
 *     Swapping', or 'no data since 14:02 · Machine stale'.
 */
export function hoverLabel(snapshot, lastGoodClockLabel, litCaptions = []) {
    const summary = hoverSummary(snapshot, lastGoodClockLabel);
    if (litCaptions.length === 0)
        return summary;
    const captionsText = litCaptions.join(CAPTION_SEPARATOR);
    return `${summary}${SEPARATOR}${captionsText}`;
}

/**
 * The hover label's summary of the numbers. A missing half says 'no data' rather than showing a stale number.
 *
 * @param {{cpuBusyPercent: number|null, memory: {usedBytes: number, totalBytes: number}|null}|null} snapshot
 *     Latest snapshot.
 * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data.
 * @returns {string} For example 'cpu 23% · mem 16.4 of 30.3 GiB', or 'no data since 14:02'.
 */
function hoverSummary(snapshot, lastGoodClockLabel) {
    const cpuPercent = snapshot?.cpuBusyPercent ?? null;
    const memory = snapshot?.memory ?? null;
    if (cpuPercent === null && memory === null)
        return noDataSince(lastGoodClockLabel);
    const cpuText = cpuPercent === null ? NO_DATA_TEXT : formatWholePercent(cpuPercent);
    return `cpu ${cpuText}${SEPARATOR}mem ${memoryLine(memory)}`;
}


/**
 * Formats a memory size short, as the heaviest app's value and the cockpit's rows show it: GiB with one decimal from
 * what rounds to 1024 MiB up, whole MiB below.
 *
 * @param {number|null} bytes - Size in bytes.
 * @returns {string} '1.2G', '340M', or '—' when unknown; never '1024M'.
 */
export function formatMemorySize(bytes) {
    if (bytes === null || bytes === undefined)
        return EM_DASH;
    const roundedMebibytes = Math.round(bytes / BYTES_PER_MEBIBYTE);
    if (roundedMebibytes < MEBIBYTES_PER_GIBIBYTE)
        return `${roundedMebibytes}M`;
    const gibibytesText = formatGibibytes(bytes);
    return `${gibibytesText}G`;
}

/**
 * A free space in GiB: whole from WHOLE_GIBIBYTES_FROM, one decimal under it, as it would be rounded ("9.96" is
 * "10G", never "10.0G").
 *
 * @param {number} bytes - The free space.
 * @returns {string} For example '212G' or '9.6G'.
 */
export function formatWholeGibibytes(bytes) {
    const gibibytes = bytes / BYTES_PER_GIBIBYTE;
    const tenthsRounded = Math.round(gibibytes * 10) / 10;
    if (tenthsRounded >= WHOLE_GIBIBYTES_FROM)
        return `${Math.round(gibibytes)}G`;
    return `${tenthsRounded.toFixed(1)}G`;
}

/**
 * @typedef {object} CardSectionText
 * @property {string} name - The section's name: 'CPU' or 'Memory'.
 * @property {string} heaviestName - The heaviest app of the section's resource; 'idle' for a CPU whose top app is under
 *     CPU_IDLE_THRESHOLD_PERCENT; '' with no ranking.
 * @property {string} heaviestValue - Its value: '14%', '11.9G'; '' when idle or with no ranking.
 */

/**
 * @typedef {object} CardFigureText
 * @property {string} figure - The reading now: '37', '24.1'; '—' with no data, never the last good number.
 * @property {string} unit - '%' or 'GiB'; '' with no data.
 * @property {boolean} isMissing - No data: the figure is drawn faint.
 */

/**
 * @typedef {object} CardDetailLine
 * @property {string} text - A line under a figure.
 * @property {boolean} isWait - The line names a condition the machine is in (swap growing on disk): drawn amber.
 */

/**
 * @typedef {object} CardMeterText
 * @property {string} name - 'cpu', 'mem' or 'io'.
 * @property {string} percentText - avg10 now, '12%'; '' with no data.
 * @property {0|1|2|3|null} band - The PSI band the meter draws (lib/pressure.js); null for no data, a dash.
 * @property {boolean} isWait - The resource is waited on (lib/machineConditions.js): the meter and its percentage are
 *     amber.
 */

/**
 * @typedef {object} CardText
 * @property {CardSectionText} cpuSection - The CPU section's label line.
 * @property {CardSectionText} memorySection - The memory section's label line.
 * @property {CardFigureText} cpuFigure - CPU busy now.
 * @property {CardFigureText} memoryFigure - Memory in use now.
 * @property {CardDetailLine[]} cpuDetailLines - Under the CPU figure: the clusters, or since when there is no data.
 *     None or one.
 * @property {CardDetailLine[]} memoryDetailLines - Under the memory figure: the memory installed and swap. None to
 *     three.
 * @property {string} waitingOnLabel - The pressure section's label.
 * @property {CardMeterText[]} meters - CPU, memory and io.
 * @property {string} axisStartLabel - The time axis's left end: '5 min'.
 * @property {string} axisNowLabel - Its present: 'now'.
 */

/**
 * The CPU section's label line: its heaviest app by CPU, or 'idle' when even that one is under
 * CPU_IDLE_THRESHOLD_PERCENT.
 *
 * @param {{name: string, cpuPercent: number}|null} topCpu - The app ranking's top entry by CPU; null with none.
 * @returns {CardSectionText} The line's texts.
 */
function cpuSectionText(topCpu) {
    if (topCpu === null)
        return {name: CARD_CPU_SECTION_NAME, heaviestName: '', heaviestValue: ''};
    if (topCpu.cpuPercent < CPU_IDLE_THRESHOLD_PERCENT)
        return {name: CARD_CPU_SECTION_NAME, heaviestName: CPU_IDLE_LABEL, heaviestValue: ''};
    const heaviestValue = formatWholePercent(topCpu.cpuPercent);
    return {name: CARD_CPU_SECTION_NAME, heaviestName: topCpu.name, heaviestValue};
}

/**
 * The memory section's label line: its heaviest app by memory.
 *
 * @param {{name: string, memoryBytes: number}|null} topMemory - The app ranking's top entry by memory; null with none.
 * @returns {CardSectionText} The line's texts.
 */
function memorySectionText(topMemory) {
    if (topMemory === null)
        return {name: CARD_MEMORY_SECTION_NAME, heaviestName: '', heaviestValue: ''};
    return {name: CARD_MEMORY_SECTION_NAME, heaviestName: topMemory.name,
        heaviestValue: formatMemorySize(topMemory.memoryBytes)};
}

/**
 * A figure, or its absence: a dash and no unit, never a zero.
 *
 * @param {string|null} figure - The reading's text; null for no data.
 * @param {string} unit - Its unit.
 * @returns {CardFigureText} The figure's texts.
 */
function figureText(figure, unit) {
    if (figure === null)
        return {figure: EM_DASH, unit: '', isMissing: true};
    return {figure, unit, isMissing: false};
}

/**
 * The line under the CPU figure: the clusters' load where it has a reading; with none, since when there is no data
 * when neither CPU nor memory has any (a failed tick, the sampler silent, none yet), or a plain "no data" when only the
 * CPU is missing (the first sample has no delta).
 *
 * @param {import('./pulseSnapshots.js').Snapshot|null} snapshot - The latest snapshot, or null before the first.
 * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data.
 * @returns {CardDetailLine[]} None or one line.
 */
function cpuDetailLines(snapshot, lastGoodClockLabel) {
    const cpuPercent = snapshot?.cpuBusyPercent ?? null;
    if (cpuPercent === null) {
        const hasNoNumbers = (snapshot?.memory ?? null) === null;
        return [{text: hasNoNumbers ? noDataSince(lastGoodClockLabel) : NO_DATA_TEXT, isWait: false}];
    }
    const clustersText = clusterSuffix(snapshot.cpuClusters ?? null);
    return clustersText === '' ? [] : [{text: clustersText, isWait: false}];
}

/**
 * The lines under the memory figure: the memory installed, then swap. What zram holds leads, with the RAM it costs;
 * what is on disk follows, added to it, and is amber only while it grows (isSwapping): a level that merely stays above
 * zero is not a reason the machine is slow now. With no memory reading there are none.
 *
 * @param {{usedBytes: number, totalBytes: number}|null} memory - Memory in use, and in all.
 * @param {{zramUsedBytes: number, zramRamBytes: number, diskBytes: number}|null} swap - Swap in use.
 * @param {boolean} isSwapping - Swap on disk is growing (lib/machineConditions.js).
 * @returns {CardDetailLine[]} None to three lines.
 */
function memoryDetailLines(memory, swap, isSwapping) {
    if (memory === null)
        return [];
    const installedText = formatGibibytes(memory.totalBytes);
    const installedLine = {text: `of ${installedText}`, isWait: false};
    if (swap === null)
        return [installedLine, {text: SWAP_NO_DATA_LINE, isWait: false}];
    const hasZramSwap = swap.zramUsedBytes > 0;
    const hasDiskSwap = swap.diskBytes > 0;
    if (!hasZramSwap && !hasDiskSwap)
        return [installedLine, {text: SWAP_NONE_LINE, isWait: false}];
    const zramUsedText = formatGibibytes(swap.zramUsedBytes);
    const zramRamText = formatGibibytes(swap.zramRamBytes);
    const zramText = `swap ${zramUsedText}${SEPARATOR}${zramRamText} in RAM`;
    const zramLines = hasZramSwap ? [{text: zramText, isWait: false}] : [];
    const diskAmountText = formatGibibytes(swap.diskBytes);
    const diskText = hasZramSwap ? `+ ${diskAmountText} on disk` : `swap ${diskAmountText} on disk`;
    const diskLines = hasDiskSwap ? [{text: diskText, isWait: isSwapping}] : [];
    return [installedLine, ...zramLines, ...diskLines];
}

/**
 * The card's three pressure meters: each resource's name, avg10 now, its band and whether it is waited on.
 *
 * @param {{cpu: number|null, memory: number|null, io: number|null}|null} pressureAvg10 - PSI `some avg10`.
 * @param {import('./machineConditions.js').PressureWaits} waits - Each resource's wait.
 * @returns {CardMeterText[]} CPU, memory and io.
 */
function meterTexts(pressureAvg10, waits) {
    return CARD_METER_RESOURCES.map(({name, resource}) => {
        const avg10Percent = pressureAvg10?.[resource] ?? null;
        const band = pressureBand(avg10Percent);
        const percentText = band === null ? '' : formatWholePercent(avg10Percent);
        return {name, percentText, band, isWait: waits[resource]};
    });
}

/**
 * Every string on the desktop card, from one snapshot and the machine's conditions. A missing part says so (a dash,
 * "no data", a meter's dash) rather than showing a stale number as live, and a missing reading lights nothing.
 *
 * @param {import('./pulseSnapshots.js').Snapshot|null} snapshot - The latest snapshot, or null before the first.
 * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data, for "no data since".
 * @param {import('./machineConditions.js').MachineConditions} [conditions] - The machine's conditions now; none lit
 *     when left out.
 * @returns {CardText} The card's strings.
 */
export function cardText(snapshot, lastGoodClockLabel, conditions = NO_MACHINE_CONDITIONS) {
    const cpuPercent = snapshot?.cpuBusyPercent ?? null;
    const memory = snapshot?.memory ?? null;
    const apps = snapshot?.apps ?? null;
    return {
        cpuSection: cpuSectionText(apps?.topCpu ?? null),
        memorySection: memorySectionText(apps?.topMemory ?? null),
        cpuFigure: figureText(cpuPercent === null ? null : String(Math.round(cpuPercent)), CARD_CPU_UNIT),
        memoryFigure: figureText(memory === null ? null : formatGibibytes(memory.usedBytes), CARD_MEMORY_UNIT),
        cpuDetailLines: cpuDetailLines(snapshot, lastGoodClockLabel),
        memoryDetailLines: memoryDetailLines(memory, snapshot?.swap ?? null, conditions.isSwapping),
        waitingOnLabel: CARD_WAITING_ON_LABEL,
        meters: meterTexts(snapshot?.pressureAvg10 ?? null, conditions.waits),
        axisStartLabel: CARD_AXIS_START_LABEL,
        axisNowLabel: CARD_AXIS_NOW_LABEL,
    };
}
