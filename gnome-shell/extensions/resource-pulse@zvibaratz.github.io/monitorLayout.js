// The monitor tile's layout manager: it asks lib/monitorGeometry.js where each part stands, from the layout the tile
// was given (its size, its form, what its tracks hold, the line boxes and the now column's width the measurer read),
// and allocates every part there. The geometry's places are from the tile's outer edge; the parts stand in a canvas
// inside the tile's border, so each is allocated TILE_BORDER_WIDTH_PX up and to the left of its place.
//
// - A label is allocated at its natural size: the scale labels end at the plot's right edge, "now" is centred on the
//   present's rule, a unit stands on its figure's baseline and a percentage after its meter's name.
// - A part with no room (a strip without a pressure history, the agents track where there is none) is allocated
//   0 × 0, never hidden.
//
// It runs only on a relayout, which St queues when a label's text changes or setLayout changes the layout; no part is
// created or destroyed here. Shell glue only: every length is the geometry's.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {allocateAt, allocateLabelAt, naturalSize, textPart} from './compactCardLayout.js';
import {TILE_BORDER_WIDTH_PX} from './lib/drawingConstants.js';
import {
    monitorGeometry, monitorMeterPercentLeftOffsetPx, monitorUnitPlacement, NO_ROOM_BOX,
} from './lib/monitorGeometry.js';

/**
 * @typedef {object} MonitorTraceTrackParts One traced track's actors.
 * @property {St.Label} label - 'CPU' or 'Memory'.
 * @property {St.Label} scaleLabel - '100%', '30.3 GiB'.
 * @property {St.DrawingArea} trace - The trace.
 * @property {St.Label} figure - The reading now.
 * @property {St.Label} unit - Its unit.
 * @property {St.Label[]} detailLines - The lines under the figure.
 */

/**
 * @typedef {object} MonitorMeterParts One resource's actors in the Waiting-on track.
 * @property {St.DrawingArea} strip - Its strip on the plot.
 * @property {St.DrawingArea} meter - Its meter's cells.
 * @property {St.Label} name - 'cpu', 'mem' or 'io'.
 * @property {St.Label} percent - Its avg10 now.
 */

/**
 * @typedef {object} MonitorParts Every actor the tile built, in its canvas.
 * @property {MonitorTraceTrackParts[]} tracks - CPU, then memory.
 * @property {St.DrawingArea} presentEdge - The present's rule and its ticks.
 * @property {St.Label[]} minuteLabels - "5 min" to "1 min".
 * @property {St.Label} axisNow - 'now'.
 * @property {St.Label} waitingOn - The Waiting-on track's label.
 * @property {MonitorMeterParts[]} meters - CPU, memory and io.
 * @property {{strip: St.DrawingArea, present: St.Label}} agents - The agents track's strip and its present.
 */

/**
 * @typedef {object} MonitorLayoutState What the tile was laid out with (monitorTile.js setLayout).
 * @property {number} widthPx - The tile's width.
 * @property {number} heightPx - Its height.
 * @property {string} form - A MonitorForm value.
 * @property {boolean} hasPressureHistory - The Waiting-on track has its strips.
 * @property {boolean} hasAgentsTrack - The layout has a sessions card.
 * @property {*} lineBoxesPx - The measured line boxes, keyed by LineKind value.
 * @property {number} nowColumnWidthPx - The now column's width.
 */

/** The canvas's origin in the geometry's coordinates: the tile's outer edge, the border up and to the left. */
const CANVAS_ORIGIN_OFFSET_PX = -TILE_BORDER_WIDTH_PX;

/**
 * The box allocateAt and allocateLabelAt place a part in: the canvas's own box, moved so that the geometry's places,
 * which are from the tile's outer edge, land inside the border.
 *
 * @param {Clutter.ActorBox} contentBox - The canvas's content box.
 * @returns {{x1: number, y1: number}} The origin the geometry's places are taken from.
 */
function geometryOrigin(contentBox) {
    return {x1: contentBox.x1 + CANVAS_ORIGIN_OFFSET_PX, y1: contentBox.y1 + CANVAS_ORIGIN_OFFSET_PX};
}

export const MonitorLayout = GObject.registerClass(
class MonitorLayout extends Clutter.LayoutManager {
    /**
     * Lays out the parts the tile built: it holds them, and never adds or removes one. It allocates nothing until the
     * tile's first setLayout.
     *
     * @param {MonitorParts} parts - The tile's parts.
     * @returns {void}
     */
    _init(parts) {
        super._init();
        this._parts = parts;
        /** @type {MonitorLayoutState|null} */
        this._state = null;
        /** @type {import('./lib/monitorGeometry.js').MonitorGeometry|null} The held layout's, computed as it is taken. */
        this._geometry = null;
    }

    /**
     * Takes a new layout, and queues a relayout when it differs from the one held.
     *
     * @param {MonitorLayoutState} state - The layout.
     * @returns {boolean} Whether it changed.
     */
    setLayoutState(state) {
        const isSameState = this._state !== null &&
            Object.keys(state).every(fieldName => state[fieldName] === this._state[fieldName]);
        if (isSameState)
            return false;
        this._state = {...state};
        this._geometry = monitorGeometry(this._state);
        this.layout_changed();
        return true;
    }

    /**
     * The layout held now; null before the first.
     *
     * @returns {MonitorLayoutState|null} The layout.
     */
    layoutState() {
        return this._state;
    }

    /**
     * The geometry of the layout held now, computed once as the layout was taken, so a Sample, a sessions count and a
     * painter read it without computing it again; null before the first.
     *
     * @returns {import('./lib/monitorGeometry.js').MonitorGeometry|null} Every part's place.
     */
    geometry() {
        return this._geometry;
    }

    /**
     * The canvas asks for nothing: the tile sets its own size, and the canvas fills it.
     *
     * @param {Clutter.Actor} _container - The canvas.
     * @param {number} _forHeightPx - The height it is asked at.
     * @returns {number[]} The least and natural width, 0.
     */
    vfunc_get_preferred_width(_container, _forHeightPx) {
        return [0, 0];
    }

    /**
     * The canvas asks for nothing: the tile sets its own size, and the canvas fills it.
     *
     * @param {Clutter.Actor} _container - The canvas.
     * @param {number} _forWidthPx - The width it is asked at.
     * @returns {number[]} The least and natural height, 0.
     */
    vfunc_get_preferred_height(_container, _forWidthPx) {
        return [0, 0];
    }

    /**
     * Allocates every part where the geometry puts it. Before the first layout, every part gets no room.
     *
     * @param {Clutter.Actor} container - The canvas.
     * @param {Clutter.ActorBox} contentBox - Its content box.
     * @returns {void}
     */
    vfunc_allocate(container, contentBox) {
        const geometry = this.geometry();
        const origin = geometryOrigin(contentBox);
        if (geometry === null) {
            for (const child of container.get_children())
                allocateAt(child, origin, NO_ROOM_BOX);
            return;
        }
        const {tracks, presentEdge, minuteLabels, axisNow, waitingOn, meters, agents} = this._parts;
        tracks.forEach((trackParts, trackIndex) =>
            this._allocateTraceTrack(trackParts, geometry.tracks[trackIndex], geometry, origin));
        allocateAt(presentEdge, origin, geometry.presentEdgeBox);
        minuteLabels.forEach((minuteLabel, tickIndex) =>
            allocateLabelAt(minuteLabel, origin, geometry.minuteLabelLeftsPx[tickIndex], geometry.axisTopPx));
        const nowLabelLeftPx = geometry.nowRuleLeftPx - naturalSize(axisNow).widthPx / 2;
        allocateLabelAt(axisNow, origin, nowLabelLeftPx, geometry.axisTopPx);
        allocateLabelAt(waitingOn, origin, geometry.plotLeftPx, geometry.waitingOnLabelTopPx);
        meters.forEach((meterParts, meterIndex) =>
            this._allocateMeter(meterParts, geometry.meterRows[meterIndex], origin));
        allocateAt(agents.strip, origin, geometry.agentsTrack.stripBox);
        allocateLabelAt(agents.present, origin, geometry.agentsTrack.presentLeftPx, geometry.agentsTrack.presentTopPx);
    }

    /**
     * Allocates one traced track: its label, its scale ending at the plot's right edge, its trace, its figure with the
     * unit on the figure's baseline, and the lines under the figure.
     *
     * @param {MonitorTraceTrackParts} trackParts - The track's actors.
     * @param {import('./lib/monitorGeometry.js').MonitorTraceTrack} track - Its places.
     * @param {import('./lib/monitorGeometry.js').MonitorGeometry} geometry - Every part's place.
     * @param {{x1: number, y1: number}} origin - The geometry's origin.
     * @returns {void}
     */
    _allocateTraceTrack(trackParts, track, geometry, origin) {
        const {label, scaleLabel, trace, figure, unit, detailLines} = trackParts;
        allocateLabelAt(label, origin, geometry.plotLeftPx, track.labelTopPx);
        const scaleLeftPx = track.scaleRightPx - naturalSize(scaleLabel).widthPx;
        allocateLabelAt(scaleLabel, origin, scaleLeftPx, track.scaleTopPx);
        allocateAt(trace, origin, track.traceBox);
        allocateLabelAt(figure, origin, geometry.nowColumnLeftPx, track.figureTopPx);
        const {unitLeftOffsetPx, unitTopOffsetPx} = monitorUnitPlacement(textPart(figure), textPart(unit));
        allocateLabelAt(unit, origin, geometry.nowColumnLeftPx + unitLeftOffsetPx, track.figureTopPx + unitTopOffsetPx);
        detailLines.forEach((detailLabel, lineIndex) =>
            allocateLabelAt(detailLabel, origin, geometry.nowColumnLeftPx, track.detailTopsPx[lineIndex]));
    }

    /**
     * Allocates one resource of the Waiting-on track: its strip (0 × 0 without a history), its meter, and its name and
     * percentage, centred on the meter.
     *
     * @param {MonitorMeterParts} meterParts - The resource's actors.
     * @param {import('./lib/monitorGeometry.js').MonitorMeterRow} meterRow - Its places.
     * @param {{x1: number, y1: number}} origin - The geometry's origin.
     * @returns {void}
     */
    _allocateMeter(meterParts, meterRow, origin) {
        const {strip, meter, name, percent} = meterParts;
        allocateAt(strip, origin, meterRow.stripBox);
        allocateAt(meter, origin, meterRow.meterBox);
        allocateLabelAt(name, origin, meterRow.nameLeftPx, meterRow.nameTopPx);
        const percentLeftPx = meterRow.nameLeftPx + monitorMeterPercentLeftOffsetPx(textPart(name));
        allocateLabelAt(percent, origin, percentLeftPx, meterRow.nameTopPx);
    }
});
