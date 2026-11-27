// The cockpit's monitor tile in its forms by tracks (wide, medium, small): CPU and memory as traced tracks on one
// five-minute plot, the Waiting-on track's pressure on the same plot, the present's rule right of it, and the now
// column's figures, lines and meters right of the rule. Shell glue only, on the base every cockpit tile shares
// (cockpitTileBase.js): every word comes from lib/monitorText.js (on the desktop card's own cardText), every place from
// lib/monitorGeometry.js through monitorLayout.js, and every shape from traceGraph.js and monitorGraph.js.
//
// - Built once: every part in one canvas, which monitorLayout.js lays out. Nothing is hidden or shown by visibility: a
//   line with nothing to say is an empty label, and a part with no room is allocated 0 × 0. The base's no-data line is
//   never shown, since every part says its own absence (a dash, "no data since", a hatch).
// - It draws the histories of the pulse client it is handed (its CPU and memory histories), and adds no listener to
//   it: whoever places the tile tells it each snapshot (update).
// - Every update and layout is a render, which the base's gate draws or records: frozen, an update is only recorded,
//   save the swap window, which every snapshot told enters, as the card's does. A render sets each label only where
//   its text changed and repaints both traces, whose histories move on with every Sample; the present's edge repaints
//   only when the layout changed.
// - Each drawing paints through paintDrawing, which frees its context whatever happens. A frozen tile is dimmed by the
//   base, by its content's opacity, so no painter reads a frozen colour.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {CockpitTileBase, setLabelText, swapStyleClass} from './cockpitTileBase.js';
import {CARD_HISTORY_SAMPLES} from './lib/constants.js';
import {
    BASELINE_RGBA, CPU_GRAPH_RGBA, CPU_TRACE_AREA_ALPHA, MEMORY_GRAPH_RGBA, MEMORY_TRACE_AREA_ALPHA,
    MONITOR_NOW_RULE_RGBA, MONITOR_PRESENT_TICK_RGBA, PRESSURE_RESOURCE_COUNT, TRACE_GAP_HATCH_RGBA, TRACE_GRID_RGBA,
} from './lib/drawingConstants.js';
import {machineConditions, SwapGrowthWindow} from './lib/machineConditions.js';
import {LineKind} from './lib/measuredLengths.js';
import {MONITOR_CPU_DETAIL_LINE_COUNT, MONITOR_MEMORY_DETAIL_LINE_COUNT} from './lib/monitorGeometry.js';
import {MONITOR_MINUTE_LABELS, monitorText} from './lib/monitorText.js';
import {MonitorLayout} from './monitorLayout.js';
import {drawPresentEdge} from './monitorGraph.js';
import {drawTrace} from './traceGraph.js';

const TILE_STYLE_CLASS = 'rp-monitor-tile';
const NO_DATA_STYLE_CLASS = 'rp-monitor-no-data';
const TRACK_LABEL_STYLE_CLASS = `${LineKind.ROW} rp-monitor-track-label`;
const SCALE_LABEL_STYLE_CLASS = `${LineKind.SCALE} rp-monitor-scale-label`;
const FIGURE_STYLE_CLASS = 'rp-monitor-figure';
const UNIT_STYLE_CLASS = `${LineKind.UNIT} rp-monitor-unit`;
const DETAIL_STYLE_CLASS = `${LineKind.DETAIL} rp-monitor-detail`;
const METER_NAME_STYLE_CLASS = `${LineKind.DETAIL} rp-monitor-meter-name`;
const METER_PERCENT_STYLE_CLASS = `${LineKind.DETAIL} rp-monitor-meter-percent`;
const AXIS_LABEL_STYLE_CLASS = `${LineKind.LABEL} rp-monitor-axis-label`;
const AXIS_NOW_STYLE_CLASS = `${LineKind.LABEL} rp-monitor-axis-now`;
const AGENTS_PRESENT_STYLE_CLASS = `${LineKind.DETAIL} rp-monitor-agents-present`;
/** A figure or a scale with no reading: faint. */
const MISSING_STYLE_CLASS = 'rp-monitor-missing';
/** A line or a percentage that names a condition the machine is in. */
const WAIT_STYLE_CLASS = 'rp-monitor-wait';

/** Each traced track's colours, CPU then memory. */
const TRACE_INKS = Object.freeze([
    Object.freeze({lineRgba: CPU_GRAPH_RGBA, areaAlpha: CPU_TRACE_AREA_ALPHA, gridRgba: TRACE_GRID_RGBA,
        baselineRgba: BASELINE_RGBA, hatchRgba: TRACE_GAP_HATCH_RGBA}),
    Object.freeze({lineRgba: MEMORY_GRAPH_RGBA, areaAlpha: MEMORY_TRACE_AREA_ALPHA, gridRgba: TRACE_GRID_RGBA,
        baselineRgba: BASELINE_RGBA, hatchRgba: TRACE_GAP_HATCH_RGBA}),
]);

/**
 * Makes a label that never ellipsizes (St.Label ellipsizes at its end by default, and cuts a label a few pixels short
 * of its own natural width), so no number or word is cut.
 *
 * @param {string} styleClass - Its classes.
 * @returns {St.Label} The label, with no text yet.
 */
function newUncutLabel(styleClass) {
    const label = new St.Label({style_class: styleClass});
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

/**
 * Adds a style class, or removes it, only where that changes it.
 *
 * @param {St.Widget} widget - The widget.
 * @param {string} styleClass - The class.
 * @param {boolean} isOn - Whether the widget should have it.
 * @returns {void}
 */
function setStyleClassOn(widget, styleClass, isOn) {
    if (widget.has_style_class_name(styleClass) === isOn)
        return;
    if (isOn)
        widget.add_style_class_name(styleClass);
    else
        widget.remove_style_class_name(styleClass);
}

/**
 * Paints a drawing: hands its context and its surface's size to a Cairo function, and frees the context whatever
 * happens (as the shell's own drawing areas do).
 *
 * @param {St.DrawingArea} drawingArea - The drawing.
 * @param {function(object, number, number): void} draw - Draws on the context at the surface's width and height.
 * @returns {void}
 */
function paintDrawing(drawingArea, draw) {
    const [widthPx, heightPx] = drawingArea.get_surface_size();
    const cr = drawingArea.get_context();
    try {
        draw(cr, widthPx, heightPx);
    } finally {
        cr.$dispose();
    }
}

/**
 * Builds one traced track's actors, with no text yet.
 *
 * @param {number} detailLineCount - How many lines stand under its figure.
 * @returns {import('./monitorLayout.js').MonitorTraceTrackParts} The parts.
 */
function newTraceTrackParts(detailLineCount) {
    return {
        label: newUncutLabel(TRACK_LABEL_STYLE_CLASS),
        scaleLabel: newUncutLabel(SCALE_LABEL_STYLE_CLASS),
        trace: new St.DrawingArea(),
        figure: newUncutLabel(`${LineKind.FIGURE} ${FIGURE_STYLE_CLASS}`),
        unit: newUncutLabel(UNIT_STYLE_CLASS),
        detailLines: Array.from({length: detailLineCount}, () => newUncutLabel(DETAIL_STYLE_CLASS)),
    };
}

/**
 * Builds one resource's actors in the Waiting-on track, with no text yet.
 *
 * @returns {import('./monitorLayout.js').MonitorMeterParts} The parts.
 */
function newMeterParts() {
    return {
        strip: new St.DrawingArea(),
        meter: new St.DrawingArea(),
        name: newUncutLabel(METER_NAME_STYLE_CLASS),
        percent: newUncutLabel(METER_PERCENT_STYLE_CLASS),
    };
}

/**
 * Every actor of the tile, in the order they are added to its canvas.
 *
 * @param {import('./monitorLayout.js').MonitorParts} parts - The parts.
 * @returns {Clutter.Actor[]} Its actors.
 */
function allPartActors({tracks, presentEdge, minuteLabels, axisNow, waitingOn, meters, agents}) {
    const trackActors = tracks.flatMap(({label, scaleLabel, trace, figure, unit, detailLines}) =>
        [label, scaleLabel, trace, figure, unit, ...detailLines]);
    const meterActors = meters.flatMap(({strip, meter, name, percent}) => [strip, meter, name, percent]);
    return [...trackActors, presentEdge, ...minuteLabels, axisNow, waitingOn, ...meterActors, agents.strip,
        agents.present];
}

/**
 * Shows a traced track's words: its label, its scale (faint with no reading), its figure (faint with no data), its unit
 * and the lines under the figure (amber where one names a condition the machine is in).
 *
 * @param {import('./monitorLayout.js').MonitorTraceTrackParts} trackParts - The track's actors.
 * @param {import('./lib/monitorText.js').MonitorTraceTrackText} trackText - Its words.
 * @returns {void}
 */
function showTraceTrackText(trackParts, trackText) {
    setLabelText(trackParts.label, trackText.label);
    setLabelText(trackParts.scaleLabel, trackText.scaleLabel.text);
    setStyleClassOn(trackParts.scaleLabel, MISSING_STYLE_CLASS, trackText.scaleLabel.isMissing);
    setLabelText(trackParts.figure, trackText.figure.figure);
    setStyleClassOn(trackParts.figure, MISSING_STYLE_CLASS, trackText.figure.isMissing);
    setLabelText(trackParts.unit, trackText.figure.unit);
    trackParts.detailLines.forEach((detailLabel, lineIndex) => {
        const detailLine = trackText.detailLines[lineIndex] ?? null;
        setLabelText(detailLabel, detailLine?.text ?? '');
        setStyleClassOn(detailLabel, WAIT_STYLE_CLASS, detailLine?.isWait ?? false);
    });
}

/**
 * The monitor tile. setLayout gives it its size, its form and its text's lengths; update draws a snapshot.
 */
export const MonitorTile = GObject.registerClass(
class MonitorTile extends CockpitTileBase {
    /**
     * Builds the tile, every actor it will show, and draws the client's latest snapshot.
     *
     * @param {object} options - The tile's options.
     * @param {import('./cockpitTooltip.js').CockpitTooltip} options.tooltip - The tooltip every tile shares.
     * @param {import('./pulseClient.js').PulseClient} options.client - The pulse client whose CPU and memory histories
     *     the traces draw.
     * @returns {void}
     */
    _init({tooltip, client}) {
        super._init({
            tooltip, tileStyleClass: TILE_STYLE_CLASS, noDataStyleClass: NO_DATA_STYLE_CLASS, paddingBlockPx: 0,
            paddingInlinePx: 0,
        });
        this._client = client;
        this._swapGrowthWindow = new SwapGrowthWindow();
        /** @type {import('./monitorLayout.js').MonitorLayoutState|null} The layout setLayout was last given. */
        this._layout = null;
        /** The sessions working now; null while not known. */
        this._agentsWorkingCount = null;
        this._figureLineKind = LineKind.FIGURE;
        this._buildParts();
        this.update(client.latestSnapshot, client.lastGoodClockLabel);
    }

    /**
     * Lays the tile out: its size, its form, whether the layout has a sessions card, and its text's lengths; then
     * draws the latest update again. A frozen tile is resized at once and draws the rest at the reveal.
     *
     * @param {object} layout - The tile's layout.
     * @param {number} layout.widthPx - The tile's width.
     * @param {number} layout.heightPx - Its height.
     * @param {string} layout.form - A MonitorForm value.
     * @param {boolean} layout.hasAgentsTrack - The layout has a sessions card: the wide form draws the agents track.
     * @param {*} layout.lineBoxesPx - The measured line boxes, keyed by LineKind value.
     * @param {number} layout.nowColumnWidthPx - The now column's width (monitorNowColumnWidthPx).
     * @returns {void}
     */
    setLayout({widthPx, heightPx, form, hasAgentsTrack, lineBoxesPx, nowColumnWidthPx}) {
        if (this._isDestroyed)
            return;
        this.setTileSize(widthPx, heightPx);
        this._layout = {widthPx, heightPx, form, hasAgentsTrack, lineBoxesPx, nowColumnWidthPx};
        this._redrawLatestRender();
    }

    /**
     * Draws a snapshot. Every snapshot enters the swap window, frozen or not; frozen, the render is only recorded.
     *
     * @param {import('./pulseClient.js').Snapshot|null} snapshot - The latest snapshot, or null before the first.
     * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data, for "no data since".
     * @returns {void}
     */
    update(snapshot, lastGoodClockLabel) {
        if (this._isDestroyed)
            return;
        this._swapGrowthWindow.record(snapshot);
        this._renderUnlessFrozen(() => this._render(snapshot, lastGoodClockLabel));
    }

    /**
     * Builds the parts once, adds them to one canvas laid out by monitorLayout.js, and connects the drawings' painters.
     *
     * @returns {void}
     */
    _buildParts() {
        const parts = {
            tracks: [
                newTraceTrackParts(MONITOR_CPU_DETAIL_LINE_COUNT),
                newTraceTrackParts(MONITOR_MEMORY_DETAIL_LINE_COUNT),
            ],
            presentEdge: new St.DrawingArea(),
            minuteLabels: MONITOR_MINUTE_LABELS.map(() => newUncutLabel(AXIS_LABEL_STYLE_CLASS)),
            axisNow: newUncutLabel(AXIS_NOW_STYLE_CLASS),
            waitingOn: newUncutLabel(TRACK_LABEL_STYLE_CLASS),
            meters: Array.from({length: PRESSURE_RESOURCE_COUNT}, newMeterParts),
            agents: {strip: new St.DrawingArea(), present: newUncutLabel(AGENTS_PRESENT_STYLE_CLASS)},
        };
        this._parts = parts;
        this._monitorLayout = new MonitorLayout(parts);
        this._canvas = new St.Widget({layout_manager: this._monitorLayout, x_expand: true, y_expand: true});
        for (const actor of allPartActors(parts))
            this._canvas.add_child(actor);
        this._dataBox.add_child(this._canvas);
        const histories = [this._client.cpuHistory, this._client.memoryHistory];
        parts.tracks.forEach(({trace}, trackIndex) =>
            trace.connect('repaint', () => this._paintTrace(trace, histories[trackIndex], TRACE_INKS[trackIndex])));
        parts.presentEdge.connect('repaint', () => this._paintPresentEdge());
    }

    /**
     * Draws what the tile shows now: the layout (a relayout only where it changed, and the present's edge with it),
     * every word, and both traces.
     *
     * @param {import('./pulseClient.js').Snapshot|null} snapshot - The snapshot.
     * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data.
     * @returns {void}
     */
    _render(snapshot, lastGoodClockLabel) {
        this._applyLayout();
        const conditions = machineConditions(snapshot, this._swapGrowthWindow);
        const text = monitorText({snapshot, lastGoodClockLabel, conditions,
            agentsWorkingCount: this._agentsWorkingCount});
        const {tracks, minuteLabels, axisNow, waitingOn, meters, agents} = this._parts;
        showTraceTrackText(tracks[0], text.cpuTrack);
        showTraceTrackText(tracks[1], text.memoryTrack);
        minuteLabels.forEach((minuteLabel, tickIndex) => setLabelText(minuteLabel, text.minuteLabels[tickIndex]));
        setLabelText(axisNow, text.axisNowLabel);
        setLabelText(waitingOn, text.waitingOnLabel);
        meters.forEach((meterParts, meterIndex) => {
            const {name, percentText, isWait} = text.meters[meterIndex];
            setLabelText(meterParts.name, name);
            setLabelText(meterParts.percent, percentText);
            setStyleClassOn(meterParts.percent, WAIT_STYLE_CLASS, isWait);
        });
        setLabelText(agents.present, this._layoutGeometryHasAgentsTrack() ? text.agentsPresent : '');
        this._repaintTraces();
    }

    /**
     * Hands the layout to the layout manager, with the form the client's pressure histories give, and the figures
     * their form's class; where it changed, the present's edge repaints. Nothing before the first setLayout.
     *
     * @returns {void}
     */
    _applyLayout() {
        if (this._layout === null)
            return;
        const {pressureHistories} = this._client;
        // Before the first state the form with a history, as the card has it.
        const hasPressureHistory = pressureHistories.isPublished || !pressureHistories.isPublishingKnown;
        const isLayoutChanged = this._monitorLayout.setLayoutState({...this._layout, hasPressureHistory});
        if (!isLayoutChanged)
            return;
        const figureLineKind = this._monitorLayout.geometry().figureLineKind;
        for (const {figure} of this._parts.tracks)
            swapStyleClass(figure, this._figureLineKind, figureLineKind);
        this._figureLineKind = figureLineKind;
        this._parts.presentEdge.queue_repaint();
    }

    /**
     * Whether the layout held draws the agents track.
     *
     * @returns {boolean} True where it does.
     */
    _layoutGeometryHasAgentsTrack() {
        return this._monitorLayout.geometry()?.agentsTrack.isShown ?? false;
    }

    /**
     * Repaints both traces, whose histories move on with every Sample.
     *
     * @returns {void}
     */
    _repaintTraces() {
        for (const {trace} of this._parts.tracks)
            trace.queue_repaint();
    }

    /**
     * Draws one trace from its history.
     *
     * @param {St.DrawingArea} trace - The trace.
     * @param {import('./lib/history.js').RingBuffer} history - Fractions of the plot's height, oldest first.
     * @param {import('./traceGraph.js').TraceInk} ink - Its colours.
     * @returns {void}
     */
    _paintTrace(trace, history, ink) {
        paintDrawing(trace, (cr, widthPx, heightPx) =>
            drawTrace(cr, widthPx, heightPx, history.values(), CARD_HISTORY_SAMPLES, ink));
    }

    /**
     * Draws the present's rule and a tick at the top, middle and foot of each trace.
     *
     * @returns {void}
     */
    _paintPresentEdge() {
        const tickRowsPx = this._monitorLayout.geometry()?.presentTickTopsPx ?? [];
        paintDrawing(this._parts.presentEdge, (cr, widthPx, heightPx) =>
            drawPresentEdge(cr, widthPx, heightPx, tickRowsPx, MONITOR_NOW_RULE_RGBA, MONITOR_PRESENT_TICK_RGBA));
    }
});
