// The desktop card: one compact card at the top right of the primary monitor's work area, laid out as:
//
//   CPU  Chromium 14%                          │ 37 %
//   [five-minute CPU trace]                    │ P 41 · E 6
//   Memory  Code 11.9G                         │ 24.1 GiB
//   [five-minute memory trace]                 │ of 30.3
//                                              │ swap 1.6 · 0.4 in RAM
//   5 min                                     now
//   Waiting on
//   [meter] cpu 12%     [meter] mem 0%     [meter] io 31%
//
// That is the form without a pressure history. While the sampler publishes one (the client's pressureHistories), the
// card takes the other form, of the same size: under "Waiting on" a strip for each resource on the plot, its last
// five minutes in 10 s cells (lib/pressureStrip.js), each beside its meter, name and percentage in the now column,
// and the axis under the strips. The form follows the client at every render, and is the one with strips, every cell
// blank, until a state says whether the sampler publishes the history: the client starts after the card at every
// enable, so at every unlock, and the card changes form when that state comes only for a sampler that publishes none.
//
// The traces, the meters and the strips are drawn (traceGraph.js drawTrace, graph.js drawPressureMeter and
// drawPressureStrip); every other part is a label. compactCardLayout.js places each part where
// lib/compactCardGeometry.js puts it, from St's own line boxes of the text, so the card's size follows the shell's
// text size and font. Every part is built once and never hidden: a line with nothing to say is an empty label, so a
// change of text costs a relayout and nothing more, and the strips are given no room in the form without a history.
// St.Label ellipsizes by default; every label here turns that off, so a number is never cut, except the two heaviest
// apps' names, which ellipsize at their end to what the plot's width leaves them.
//
// Windows cover it most of the day. While one does, the extension freezes it (setFrozen): a new snapshot is only
// recorded, and the card queues no relayout and no repaint until the reveal, which repaints it at once from the
// snapshot it last recorded (a covered card is told none while the detail watch is released; the client hands it the
// latest one in the same main-loop turn as the reveal). A frozen card is dimmed (the frozen pseudo-class, which
// stylesheet.css styles) and repainted, still dimmed, every FROZEN_REPAINT_INTERVAL_SECONDS (repaintFrozen), so a
// card misjudged as covered reads as stale, never as live; freezing costs one repaint, unseen when the card really
// is covered. The card is drawn through an offscreen texture (set in _init), so a window drawing over it costs one
// cached rectangle per frame, not a repaint of its actors. Unfrozen, a meter redraws only when what it draws changes
// (lib/cardRepaint.js decides what to repaint), and a strip only when one of its cells does; the traces redraw on
// every render, since their histories move on.
//
// Shell glue only: every string, band and condition comes from lib/format.js (cardText, through lib/cardRepaint.js),
// every strip's cells from lib/pressureStrip.js, every shape from traceGraph.js and graph.js, every place from
// lib/compactCardGeometry.js and the position from lib/layout.js (cardPosition). The extension adds it to the layout
// manager's background group, above the wallpaper and below every window, which the overview hides. It is
// display-only: ding's desktop window lies over it and takes every click, so nothing here is reactive. Destroying it
// removes its client listener, the only thing it adds outside itself.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CompactCardLayout} from './compactCardLayout.js';
import {drawPressureMeter, drawPressureStrip, withOpacity} from './graph.js';
import {drawTrace} from './traceGraph.js';
import {CARD_HISTORY_SAMPLES} from './lib/constants.js';
import {
    BASELINE_RGBA, CARD_MARGIN_PX, COMPACT_MEMORY_DETAIL_LINE_COUNT, CPU_GRAPH_RGBA, CPU_TRACE_AREA_ALPHA,
    MEMORY_GRAPH_RGBA, MEMORY_TRACE_AREA_ALPHA, PRESSURE_METER_FILL_RGBA, PRESSURE_METER_NO_DATA_RGBA,
    PRESSURE_METER_TRACK_RGBA, PRESSURE_METER_WAIT_FILL_RGBA, PRESSURE_RESOURCE_COUNT, PRESSURE_STRIP_BAND_RGBA,
    PRESSURE_STRIP_CALM_RGBA, TRACE_GAP_HATCH_RGBA, TRACE_GRID_RGBA,
} from './lib/drawingConstants.js';
import {CardRepaintPlanner} from './lib/cardRepaint.js';
import {cardPosition} from './lib/layout.js';
import {areCellBandsEqual, pressureStripsCellBands} from './lib/pressureStrip.js';

/** The card's own class: its padding, font and now column's width, and its dim under :frozen (stylesheet.css). */
const CARD_STYLE_CLASS = 'rp-compact-card';
/** The surface the card shares with the cockpit's cards: its gradient, highlight, border and radius. */
const TILE_SURFACE_STYLE_CLASS = 'rp-tile-surface';
const SECTION_NAME_STYLE_CLASS = 'rp-compact-section-name';
const HEAVIEST_NAME_STYLE_CLASS = 'rp-compact-heaviest-name';
const HEAVIEST_VALUE_STYLE_CLASS = 'rp-compact-heaviest-value';
const FIGURE_STYLE_CLASS = 'rp-compact-figure';
/** A figure with no data: a dash, drawn faint. */
const FIGURE_MISSING_STYLE_CLASS = 'rp-compact-figure-missing';
const UNIT_STYLE_CLASS = 'rp-compact-unit';
const DETAIL_STYLE_CLASS = 'rp-compact-detail';
const METER_NAME_STYLE_CLASS = 'rp-compact-meter-name';
const METER_PERCENT_STYLE_CLASS = 'rp-compact-meter-percent';
const AXIS_LABEL_STYLE_CLASS = 'rp-compact-axis-label';
const AXIS_NOW_STYLE_CLASS = 'rp-compact-axis-now';
const NOW_RULE_STYLE_CLASS = 'rp-compact-now-rule';
/** A line or a percentage naming a condition the machine is in: drawn amber. */
const WAIT_STYLE_CLASS = 'rp-compact-wait';
/** The line under the CPU figure: its clusters, or since when there is no data. Memory's are in drawingConstants.js. */
const CPU_DETAIL_LINE_COUNT = 1;
/** The style pseudo-class a frozen card carries: .rp-compact-card:frozen dims it. */
const FROZEN_PSEUDO_CLASS = 'frozen';
/** The style property the stylesheet dims the drawings by. */
const GRAPH_OPACITY_PROPERTY = '-rp-graph-opacity';
const FULL_GRAPH_OPACITY = 1;
/** A size of -1 lets the card take its natural size again. */
const UNSET_SIZE = -1;

/**
 * Sets a label's text only when it changed, so an unchanged part never costs a relayout.
 *
 * @param {St.Label} label - The label.
 * @param {string} text - Its new text.
 * @returns {void}
 */
function setLabelText(label, text) {
    if (label.text !== text)
        label.text = text;
}

/**
 * Adds or removes a style class only when that changes it, so an unchanged part costs no restyle.
 *
 * @param {St.Widget} widget - The part.
 * @param {string} styleClass - The class.
 * @param {boolean} isOn - Whether it carries the class.
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
 * Makes a text label that never ellipsizes (St.Label ellipsizes at its end by default), so no number is cut.
 *
 * @param {string} styleClass - Its style class.
 * @returns {St.Label} The label, with no text yet.
 */
function newCardLabel(styleClass) {
    const cardLabel = new St.Label({style_class: styleClass});
    cardLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return cardLabel;
}

/**
 * Makes the label for a heaviest app's name: it ellipsizes at its end to the width the layout gives it, so the value
 * beside it is never cut.
 *
 * @returns {St.Label} The label, with no text yet.
 */
function newHeaviestNameLabel() {
    const nameLabel = newCardLabel(HEAVIEST_NAME_STYLE_CLASS);
    nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return nameLabel;
}

/**
 * Builds one section's parts: its label line, its trace and the now column's figure, unit and lines.
 *
 * @param {number} detailLineCount - How many lines stand under the figure.
 * @returns {import('./compactCardLayout.js').CompactSectionParts} The parts, with no text yet.
 */
function newSectionParts(detailLineCount) {
    return {
        sectionName: newCardLabel(SECTION_NAME_STYLE_CLASS),
        heaviestName: newHeaviestNameLabel(),
        heaviestValue: newCardLabel(HEAVIEST_VALUE_STYLE_CLASS),
        trace: new St.DrawingArea(),
        figure: newCardLabel(FIGURE_STYLE_CLASS),
        unit: newCardLabel(UNIT_STYLE_CLASS),
        detailLines: Array.from({length: detailLineCount}, () => newCardLabel(DETAIL_STYLE_CLASS)),
    };
}

/**
 * Builds one resource's pressure parts: its meter's drawn cells, its name, its percentage and its strip.
 *
 * @returns {import('./compactCardLayout.js').CompactMeterParts} The parts, with no text yet.
 */
function newMeterParts() {
    return {
        drawingArea: new St.DrawingArea(),
        name: newCardLabel(METER_NAME_STYLE_CLASS),
        percent: newCardLabel(METER_PERCENT_STYLE_CLASS),
        strip: new St.DrawingArea(),
    };
}

/**
 * Every actor of a section, in the order they are added to the card.
 *
 * @param {import('./compactCardLayout.js').CompactSectionParts} sectionParts - The section's parts.
 * @returns {Clutter.Actor[]} Its actors.
 */
const sectionActors = ({sectionName, heaviestName, heaviestValue, trace, figure, unit, detailLines}) =>
    [sectionName, heaviestName, heaviestValue, trace, figure, unit, ...detailLines];

/**
 * Shows a section's label line, its figure (faint with no data) and the lines under it (amber where one names a
 * condition the machine is in).
 *
 * @param {import('./compactCardLayout.js').CompactSectionParts} sectionParts - The section's parts.
 * @param {import('./lib/format.js').CardSectionText} sectionText - Its label line's strings.
 * @param {import('./lib/format.js').CardFigureText} figureText - Its figure's strings.
 * @param {import('./lib/format.js').CardDetailLine[]} detailLines - Its lines under the figure: as many as its labels,
 *     or fewer, the rest left empty.
 * @returns {void}
 */
function showSectionText(sectionParts, sectionText, figureText, detailLines) {
    setLabelText(sectionParts.sectionName, sectionText.name);
    setLabelText(sectionParts.heaviestName, sectionText.heaviestName);
    setLabelText(sectionParts.heaviestValue, sectionText.heaviestValue);
    setLabelText(sectionParts.figure, figureText.figure);
    setStyleClassOn(sectionParts.figure, FIGURE_MISSING_STYLE_CLASS, figureText.isMissing);
    setLabelText(sectionParts.unit, figureText.unit);
    sectionParts.detailLines.forEach((detailLabel, lineIndex) => {
        const detailLine = detailLines[lineIndex] ?? null;
        setLabelText(detailLabel, detailLine?.text ?? '');
        setStyleClassOn(detailLabel, WAIT_STYLE_CLASS, detailLine?.isWait ?? false);
    });
}

export const PulseCard = GObject.registerClass(
class PulseCard extends St.Widget {
    /**
     * Builds every part, shows "no data" until the first snapshot, and starts listening to the client. The listener
     * is added last, after everything that could throw, so a failed construction leaves nothing in the client. The
     * card starts unfrozen.
     *
     * @param {import('./pulseClient.js').PulseClient} client - The one client; the card draws its CPU and memory
     *     histories.
     * @returns {void}
     */
    _init(client) {
        super._init({style_class: `${CARD_STYLE_CLASS} ${TILE_SURFACE_STYLE_CLASS}`, reactive: false});
        // Draw through an offscreen texture: actors in this layer are not culled, so without it a window drawing over
        // the card would repaint every one of the card's actors on each of its frames. The card is rendered into the
        // texture only when its own content changes.
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        // Every field _onDestroy reads is set before anything below can throw.
        this._client = client;
        this._snapshotListenerId = null;
        this.connect('destroy', () => this._onDestroy());
        this._repaintPlanner = new CardRepaintPlanner();
        /** What each meter draws, from the last render: its band and its amber. */
        this._meterStates = Array.from({length: PRESSURE_RESOURCE_COUNT}, () => ({band: null, isWait: false}));
        /** What each strip draws, from the last render: its cells' bands (lib/pressureStrip.js). */
        this._stripCellBands = Array.from({length: PRESSURE_RESOURCE_COUNT}, () => []);

        this._buildParts(client);
        this.update(client.latestSnapshot, client.lastGoodClockLabel);
        this._snapshotListenerId = client.addListener(
            snapshot => this.update(snapshot, this._client.lastGoodClockLabel));
    }

    /**
     * Builds the parts once, adds them, connects the drawings' painters, and hands the parts to the layout manager,
     * which places them from then on. Every label waits for the first render for its text.
     *
     * @param {import('./pulseClient.js').PulseClient} client - The client whose histories the traces draw.
     * @returns {void}
     */
    _buildParts(client) {
        const parts = {
            cpu: newSectionParts(CPU_DETAIL_LINE_COUNT),
            memory: newSectionParts(COMPACT_MEMORY_DETAIL_LINE_COUNT),
            nowRule: new St.Widget({style_class: NOW_RULE_STYLE_CLASS}),
            axisStart: newCardLabel(AXIS_LABEL_STYLE_CLASS),
            axisNow: newCardLabel(AXIS_NOW_STYLE_CLASS),
            waitingOn: newCardLabel(SECTION_NAME_STYLE_CLASS),
            meters: Array.from({length: PRESSURE_RESOURCE_COUNT}, newMeterParts),
        };
        this._parts = parts;
        const {cpu, memory, nowRule, axisStart, axisNow, waitingOn, meters} = parts;
        const meterActors =
            meters.flatMap(({drawingArea, name, percent, strip}) => [drawingArea, name, percent, strip]);
        const allActors = [
            ...sectionActors(cpu), ...sectionActors(memory), nowRule, axisStart, axisNow, waitingOn, ...meterActors,
        ];
        for (const actor of allActors)
            this.add_child(actor);
        cpu.trace.connect('repaint',
            () => this._paintTrace(cpu.trace, client.cpuHistory, CPU_GRAPH_RGBA, CPU_TRACE_AREA_ALPHA));
        memory.trace.connect('repaint',
            () => this._paintTrace(memory.trace, client.memoryHistory, MEMORY_GRAPH_RGBA, MEMORY_TRACE_AREA_ALPHA));
        meters.forEach(({drawingArea, strip}, meterIndex) => {
            drawingArea.connect('repaint', () => this._paintPressureMeter(drawingArea, this._meterStates[meterIndex]));
            strip.connect('repaint', () => this._paintPressureStrip(strip, this._stripCellBands[meterIndex]));
        });
        this.layout_manager = new CompactCardLayout(parts);
    }

    /**
     * Shows a snapshot. Frozen, the card only records it, touching no actor, so a covered card queues no relayout and
     * no repaint; unfrozen, it renders it at once (_applyRepaintPlan).
     *
     * @param {import('./pulseClient.js').Snapshot|null} snapshot - The latest snapshot, or null before the first.
     * @param {string|null} lastGoodClockLabel - 'HH:MM' of the last snapshot with data, for "no data since".
     * @returns {void}
     */
    update(snapshot, lastGoodClockLabel) {
        this._applyRepaintPlan(this._repaintPlanner.show({snapshot, lastGoodClockLabel}));
    }

    /**
     * Freezes the card while a window covers it, repainting it once, dimmed; or unfreezes it on the reveal, which
     * repaints it at once, undimmed, from the snapshot it last recorded. Setting the state it already has does
     * nothing.
     *
     * @param {boolean} isFrozen - True while covered.
     * @returns {void}
     */
    setFrozen(isFrozen) {
        this._applyRepaintPlan(this._repaintPlanner.setFrozen(isFrozen));
    }

    /**
     * Repaints a frozen card, still dimmed, from the latest snapshot it was given. The extension gives the card the
     * client's latest snapshot and calls this once FROZEN_REPAINT_INTERVAL_SECONDS have passed since the card was last
     * painted, checked on each Sample while the card is covered and on the fallback timeout while the service is
     * silent. Unfrozen it does nothing, since an unfrozen card renders every snapshot already.
     *
     * @returns {void}
     */
    repaintFrozen() {
        this._applyRepaintPlan(this._repaintPlanner.repaintFrozen());
    }

    /**
     * Renders a repaint plan: the dim first, when it changed (_showDimmed); then every label (one whose text is
     * unchanged is left alone), each meter only when what it draws changed, the form and each strip whose cells
     * changed (_showPressureStrips), and both traces, whose histories move on with every sample. A part with no
     * data reads "no data" or a dash and draws as a gap (a hatch, or a meter's no-data dash), never as the last good
     * number.
     *
     * @param {import('./lib/cardRepaint.js').RepaintPlan|null} repaintPlan - What to repaint; null for nothing (the
     *     card is frozen, or already in the state asked for).
     * @returns {void}
     */
    _applyRepaintPlan(repaintPlan) {
        if (repaintPlan === null)
            return;
        const {text, changedMeterIndexes, isDimmed, isDimChanged} = repaintPlan;
        if (isDimChanged)
            this._showDimmed(isDimmed);
        const {cpu, memory, axisStart, axisNow, waitingOn} = this._parts;
        showSectionText(cpu, text.cpuSection, text.cpuFigure, text.cpuDetailLines);
        showSectionText(memory, text.memorySection, text.memoryFigure, text.memoryDetailLines);
        setLabelText(axisStart, text.axisStartLabel);
        setLabelText(axisNow, text.axisNowLabel);
        setLabelText(waitingOn, text.waitingOnLabel);
        this._showPressureMeters(text.meters, changedMeterIndexes);
        this._showPressureStrips(isDimChanged);
        cpu.trace.queue_repaint();
        memory.trace.queue_repaint();
    }

    /**
     * Dims the card as it freezes, or undims it as it unfreezes: adds or removes the frozen pseudo-class, under which
     * stylesheet.css dims every text class's colour and the drawings (GRAPH_OPACITY_PROPERTY, which every painter
     * reads). A repaint plan that changes the dim also redraws every drawing, so each paints at the new opacity.
     *
     * @param {boolean} isDimmed - True as the card freezes.
     * @returns {void}
     */
    _showDimmed(isDimmed) {
        if (isDimmed)
            this.add_style_pseudo_class(FROZEN_PSEUDO_CLASS);
        else
            this.remove_style_pseudo_class(FROZEN_PSEUDO_CLASS);
    }

    /**
     * The opacity the stylesheet gives the card's drawings now: GRAPH_OPACITY_PROPERTY on the card's own style, which
     * stylesheet.css sets only under the frozen pseudo-class, or FULL_GRAPH_OPACITY where it sets none.
     *
     * @returns {number} 0–1 (graph.js withOpacity clamps whatever the stylesheet says).
     */
    _graphOpacity() {
        const [isSet, graphOpacity] = this.get_theme_node().lookup_double(GRAPH_OPACITY_PROPERTY, false);
        return isSet ? graphOpacity : FULL_GRAPH_OPACITY;
    }

    /**
     * Shows the three meters: each one's name and percentage, the percentage amber while its resource is waited on,
     * and a redraw of only the meters whose band or amber changed.
     *
     * @param {import('./lib/format.js').CardMeterText[]} meterTexts - CPU, memory and io.
     * @param {number[]} changedMeterIndexes - The meters whose band or amber differs from what they drew.
     * @returns {void}
     */
    _showPressureMeters(meterTexts, changedMeterIndexes) {
        this._parts.meters.forEach((meterParts, meterIndex) => {
            const {name, percentText, band, isWait} = meterTexts[meterIndex];
            setLabelText(meterParts.name, name);
            setLabelText(meterParts.percent, percentText);
            setStyleClassOn(meterParts.percent, WAIT_STYLE_CLASS, isWait);
            this._meterStates[meterIndex] = {band, isWait};
        });
        for (const meterIndex of changedMeterIndexes)
            this._parts.meters[meterIndex].drawingArea.queue_repaint();
    }

    /**
     * Takes the form the client's pressure histories give (the layout queues a relayout when it changes) and, with a
     * history, redraws each strip whose cells changed: all three when the form or the dim changed, none on a calm
     * machine whose cells read the same.
     *
     * @param {boolean} isDimChanged - Whether this render changes the dim, which every drawing must repaint at.
     * @returns {void}
     */
    _showPressureStrips(isDimChanged) {
        // A destroyed card has let its client go: a late render (a freeze after the destroy) has no form to follow.
        if (this._client === null)
            return;
        const {pressureHistories} = this._client;
        // Before the first state the form with a history, its strips blank: the form changes at a state only when the
        // sampler publishes no history.
        const hasPressureHistory = pressureHistories.isPublished || !pressureHistories.isPublishingKnown;
        const isFormChanged = this.layout_manager.setHasPressureHistory(hasPressureHistory);
        if (!hasPressureHistory)
            return;
        const cellBandsByStrip = pressureStripsCellBands(pressureHistories, CARD_HISTORY_SAMPLES);
        this._parts.meters.forEach(({strip}, stripIndex) => {
            const cellBands = cellBandsByStrip[stripIndex];
            const isCellChanged = !areCellBandsEqual(cellBands, this._stripCellBands[stripIndex]);
            this._stripCellBands[stripIndex] = cellBands;
            if (isCellChanged || isFormChanged || isDimChanged)
                strip.queue_repaint();
        });
    }

    /**
     * Moves the card to the top right of the primary monitor's work area, inset by CARD_MARGIN_PX, at its current
     * width. With no monitor at all (primaryIndex is -1 then) it stays where it is until the monitors come back.
     *
     * @returns {void}
     */
    placeOnPrimaryMonitor() {
        const {primaryIndex} = Main.layoutManager;
        if (primaryIndex < 0)
            return;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(primaryIndex);
        const {x, y} = cardPosition(workArea, this.width, CARD_MARGIN_PX);
        // Whole logical pixels keep the text sharp.
        this.set_position(Math.floor(x), Math.floor(y));
    }

    /**
     * Sizes the card to the cockpit's system cell (cockpitCards.js SystemCockpitCard), so the cell draws this one card
     * surface; the content keeps its own size at the top left, its plot giving up width only where the cell is
     * narrower than the card (compactCardLayout.js). clearCellSize() undoes it.
     *
     * @param {number} widthPx - The cell's width.
     * @param {number} heightPx - The cell's height.
     * @returns {void}
     */
    setCellSize(widthPx, heightPx) {
        this.set_size(widthPx, heightPx);
    }

    /**
     * Undoes setCellSize, for the card's own place top right on the primary monitor (the cockpit not configured): its
     * natural size again. placeOnPrimaryMonitor() only moves the card, so it cannot do this.
     *
     * @returns {void}
     */
    clearCellSize() {
        this.set_size(UNSET_SIZE, UNSET_SIZE);
    }

    /**
     * Draws one trace at the drawings' opacity (_graphOpacity), and frees the context whatever happens (as the shell's
     * own drawing areas do).
     *
     * @param {St.DrawingArea} trace - The trace's drawing area.
     * @param {import('./lib/history.js').RingBuffer} history - Fractions of the plot's height, oldest first.
     * @param {number[]} lineRgba - The series' colour.
     * @param {number} areaAlpha - The alpha its area starts at.
     * @returns {void}
     */
    _paintTrace(trace, history, lineRgba, areaAlpha) {
        const graphOpacity = this._graphOpacity();
        const ink = {
            lineRgba: withOpacity(lineRgba, graphOpacity),
            areaAlpha: areaAlpha * graphOpacity,
            gridRgba: withOpacity(TRACE_GRID_RGBA, graphOpacity),
            baselineRgba: withOpacity(BASELINE_RGBA, graphOpacity),
            hatchRgba: withOpacity(TRACE_GAP_HATCH_RGBA, graphOpacity),
        };
        const [widthPx, heightPx] = trace.get_surface_size();
        const cr = trace.get_context();
        try {
            drawTrace(cr, widthPx, heightPx, history.values(), CARD_HISTORY_SAMPLES, ink);
        } finally {
            cr.$dispose();
        }
    }

    /**
     * Draws one meter at its band, amber while its resource is waited on, at the drawings' opacity (_graphOpacity),
     * and frees the context whatever happens.
     *
     * @param {St.DrawingArea} drawingArea - The meter's drawing area.
     * @param {{band: 0|1|2|3|null, isWait: boolean}} meterState - What it draws.
     * @returns {void}
     */
    _paintPressureMeter(drawingArea, {band, isWait}) {
        const graphOpacity = this._graphOpacity();
        const fillRgba = withOpacity(isWait ? PRESSURE_METER_WAIT_FILL_RGBA : PRESSURE_METER_FILL_RGBA, graphOpacity);
        const trackRgba = withOpacity(PRESSURE_METER_TRACK_RGBA, graphOpacity);
        const noDataRgba = withOpacity(PRESSURE_METER_NO_DATA_RGBA, graphOpacity);
        const [widthPx, heightPx] = drawingArea.get_surface_size();
        const cr = drawingArea.get_context();
        try {
            drawPressureMeter(cr, widthPx, heightPx, band, fillRgba, trackRgba, noDataRgba);
        } finally {
            cr.$dispose();
        }
    }

    /**
     * Draws one pressure strip's cells at the drawings' opacity (_graphOpacity), amber from the wait band, and frees
     * the context whatever happens.
     *
     * @param {St.DrawingArea} strip - The strip's drawing area.
     * @param {Array<0|1|2|3|null>} cellBands - Its cells' bands, oldest first, null for no reading.
     * @returns {void}
     */
    _paintPressureStrip(strip, cellBands) {
        const graphOpacity = this._graphOpacity();
        const ink = {
            calmRgba: withOpacity(PRESSURE_STRIP_CALM_RGBA, graphOpacity),
            bandRgba: withOpacity(PRESSURE_STRIP_BAND_RGBA, graphOpacity),
            waitRgba: withOpacity(PRESSURE_METER_WAIT_FILL_RGBA, graphOpacity),
        };
        const [widthPx, heightPx] = strip.get_surface_size();
        const cr = strip.get_context();
        try {
            drawPressureStrip(cr, widthPx, heightPx, cellBands, ink);
        } finally {
            cr.$dispose();
        }
    }

    /**
     * Removes the client listener, the one thing the card added outside itself. Runs on 'destroy', so it runs
     * however the card is destroyed.
     *
     * @returns {void}
     */
    _onDestroy() {
        if (this._snapshotListenerId !== null) {
            this._client.removeListener(this._snapshotListenerId);
            this._snapshotListenerId = null;
        }
        this._client = null;
    }
});
