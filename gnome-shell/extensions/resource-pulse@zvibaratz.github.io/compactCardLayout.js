// The desktop card's layout manager: it reads St's own line boxes of the card's text, the meters' text widths, the
// side padding and the now column's width from the card's style (-rp-now-column-width, in em), asks
// lib/compactCardGeometry.js where each part stands, and allocates every part there. The card's size is its
// content's natural size, unless a cell sizes it (card.js setCellSize): then a narrower content box takes its width
// from the plot, down to the least, and a larger one leaves the content at the top left at its one size.
//
// The card says which form to lay out (setHasPressureHistory): with the sampler's pressure history, a strip for each
// resource on the plot and the meters in the now column; without it, the meters in one row and the strips given no
// room. The two forms are one size, so a change of form moves parts and never the card.
//
// It runs only on a relayout, which St queues when a label's text changes or the form does; no part is created or
// destroyed here.
// Shell glue only: every length is the geometry's.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    compactCardContentWidths, compactCardGeometry, figureUnitPlacement, logicalLayoutLengthPx, sectionLabelLine,
    meterPercentLeftOffsetPx,
} from './lib/compactCardGeometry.js';
import {formatWholePercent} from './lib/format.js';

/** The style property that holds the now column's width, in em of the card's font. */
const NOW_COLUMN_WIDTH_PROPERTY = '-rp-now-column-width';
/** The now column's width where the stylesheet gives none: 9em of an 11 pt font at 96 dpi. */
const FALLBACK_NOW_COLUMN_WIDTH_PX = 132;
/** A size request that leaves the other dimension free. */
const UNCONSTRAINED_SIZE = -1;
/** The most a meter's avg10 reads, all of the time: its percentage's widest text, "100%". */
const WIDEST_METER_PERCENT = 100;
/** A Pango layout's width that never wraps or ellipsizes its text. */
const UNBOUNDED_LAYOUT_WIDTH = -1;
/** Pango's length for a whole text. */
const WHOLE_TEXT_LENGTH = -1;
/** Where a strip stands without a pressure history: nowhere, with no size. */
const NO_ROOM = Object.freeze({x: 0, y: 0, width: 0, height: 0});

/**
 * @typedef {object} CompactSectionParts
 * @property {St.Label} sectionName - "CPU" or "Memory".
 * @property {St.Label} heaviestName - The heaviest app's name, which ellipsizes.
 * @property {St.Label} heaviestValue - Its value.
 * @property {St.DrawingArea} trace - The trace.
 * @property {St.Label} figure - The figure now.
 * @property {St.Label} unit - Its unit.
 * @property {St.Label[]} detailLines - The lines under the figure.
 */

/**
 * @typedef {object} CompactMeterParts
 * @property {St.DrawingArea} drawingArea - The meter's cells.
 * @property {St.Label} name - "cpu", "mem" or "io".
 * @property {St.Label} percent - avg10 now.
 * @property {St.DrawingArea} strip - The resource's pressure strip on the plot, with a pressure history.
 */

/**
 * @typedef {object} CompactCardParts
 * @property {CompactSectionParts} cpu - The CPU section.
 * @property {CompactSectionParts} memory - The memory section.
 * @property {St.Widget} nowRule - The present's rule.
 * @property {St.Label} axisStart - "5 min".
 * @property {St.Label} axisNow - "now".
 * @property {St.Label} waitingOn - "Waiting on".
 * @property {CompactMeterParts[]} meters - CPU, memory and io.
 */

/**
 * An actor's natural width or height, as St measures it now.
 *
 * @param {Clutter.Actor} actor - The actor.
 * @returns {{widthPx: number, heightPx: number}} Its natural size.
 */
function naturalSize(actor) {
    const [, naturalWidthPx] = actor.get_preferred_width(UNCONSTRAINED_SIZE);
    const [, naturalHeightPx] = actor.get_preferred_height(UNCONSTRAINED_SIZE);
    return {widthPx: naturalWidthPx, heightPx: naturalHeightPx};
}

/**
 * A length of a label's text layout, in Pango units, as logical pixels: the layout is laid out at the label's
 * resource scale, which St's own measures are not.
 *
 * @param {St.Label} label - The label the layout is of, or was copied from.
 * @param {number} pangoUnits - The length, in Pango units.
 * @returns {number} It in logical pixels, not rounded.
 */
function layoutLengthInLabelPx(label, pangoUnits) {
    return logicalLayoutLengthPx(pangoUnits / Pango.SCALE, label.clutter_text.get_resource_scale());
}

/**
 * A label as a text part of the geometry: its natural width and its first line's baseline.
 *
 * @param {St.Label} label - The label.
 * @returns {{widthPx: number, baselinePx: number}} Its width and baseline, in logical pixels.
 */
function textPart(label) {
    const baselinePx = layoutLengthInLabelPx(label, label.clutter_text.get_layout().get_baseline());
    return {widthPx: naturalSize(label).widthPx, baselinePx};
}

/**
 * A text's natural width in a label's font, as the label would measure it showing that text: a copy of its layout,
 * unwrapped and never ellipsized, so neither the label's own text nor its allocation changes the width.
 *
 * @param {St.Label} label - The label whose font measures it.
 * @param {string} text - The text.
 * @returns {number} Its width, in whole logical pixels.
 */
function textWidthInLabelPx(label, text) {
    const layout = label.clutter_text.get_layout().copy();
    layout.set_width(UNBOUNDED_LAYOUT_WIDTH);
    layout.set_ellipsize(Pango.EllipsizeMode.NONE);
    layout.set_text(text, WHOLE_TEXT_LENGTH);
    const [, logicalRect] = layout.get_extents();
    return Math.ceil(layoutLengthInLabelPx(label, logicalRect.x + logicalRect.width));
}

/**
 * Allocates an actor a rectangle of the content box, in whole pixels.
 *
 * @param {Clutter.Actor} actor - The part.
 * @param {Clutter.ActorBox} contentBox - The card's content box, which the rectangle is placed in.
 * @param {{x: number, y: number, width: number, height: number}} rect - Where, from the content box's top left.
 * @returns {void}
 */
function allocateAt(actor, contentBox, {x, y, width, height}) {
    const x1 = Math.round(contentBox.x1 + x);
    const y1 = Math.round(contentBox.y1 + y);
    const widthPx = Math.max(0, Math.round(width));
    const heightPx = Math.max(0, Math.round(height));
    actor.allocate(Clutter.ActorBox.new(x1, y1, x1 + widthPx, y1 + heightPx));
}

/**
 * Allocates a label at its natural size.
 *
 * @param {St.Label} label - The label.
 * @param {Clutter.ActorBox} contentBox - The card's content box.
 * @param {number} x - Its left, from the content box's.
 * @param {number} y - Its top, from the content box's.
 * @returns {void}
 */
function allocateLabelAt(label, contentBox, x, y) {
    const {widthPx, heightPx} = naturalSize(label);
    allocateAt(label, contentBox, {x, y, width: widthPx, height: heightPx});
}

export const CompactCardLayout = GObject.registerClass(
class CompactCardLayout extends Clutter.LayoutManager {
    /**
     * Lays out the parts the card built: it holds them, and never adds or removes one.
     *
     * @param {CompactCardParts} parts - The card's parts.
     * @returns {void}
     */
    _init(parts) {
        super._init();
        this._parts = parts;
        // The form the card draws before the client's first state (card.js _showPressureStrips).
        this._hasPressureHistory = true;
    }

    /**
     * Sets the form: with the sampler's pressure history or without it. A change queues a relayout of the card.
     *
     * @param {boolean} hasPressureHistory - The form with the sampler's pressure history: while the sampler publishes
     *     it, and before a state has said whether it does (card.js _showPressureStrips).
     * @returns {boolean} True when the form changed.
     */
    setHasPressureHistory(hasPressureHistory) {
        if (this._hasPressureHistory === hasPressureHistory)
            return false;
        this._hasPressureHistory = hasPressureHistory;
        this.layout_changed();
        return true;
    }

    /**
     * What St measures of the card's text now, for the geometry: each kind of line box, read from a part that always
     * has text, and the now column's width from the card's style.
     *
     * @param {St.Widget} container - The card.
     * @returns {object} The geometry's measures.
     */
    _measures(container) {
        const {cpu, meters, axisStart} = this._parts;
        const [hasNowColumnWidth, nowColumnWidthPx] =
            container.get_theme_node().lookup_length(NOW_COLUMN_WIDTH_PROPERTY, false);
        return {
            lineBoxes: {
                sectionLabelPx: naturalSize(cpu.sectionName).heightPx,
                meterNamePx: naturalSize(meters[0].name).heightPx,
                axisLabelPx: naturalSize(axisStart).heightPx,
                figurePx: naturalSize(cpu.figure).heightPx,
                detailPx: naturalSize(cpu.detailLines[0]).heightPx,
            },
            nowColumnWidthPx: hasNowColumnWidth ? nowColumnWidthPx : FALLBACK_NOW_COLUMN_WIDTH_PX,
            hasPressureHistory: this._hasPressureHistory,
        };
    }

    /**
     * What places the meters in their one row: their names' widths and the widest percentage's at the present text
     * size, never the reading shown, and the card's side padding, which the last row may reach into. Read at
     * allocation only, since no size depends on them, and only in the form without a history, the one with that row.
     *
     * @param {St.Widget} container - The card.
     * @returns {{meterNameWidthsPx: number[], widestMeterPercentWidthPx: number, sidePaddingPx: number}} The lengths.
     */
    _meterRowMeasures(container) {
        const {meters} = this._parts;
        const widestPercentText = formatWholePercent(WIDEST_METER_PERCENT);
        return {
            meterNameWidthsPx: meters.map(({name}) => naturalSize(name).widthPx),
            widestMeterPercentWidthPx: textWidthInLabelPx(meters[0].percent, widestPercentText),
            sidePaddingPx: container.get_theme_node().get_padding(St.Side.RIGHT),
        };
    }

    /**
     * The content's least and natural width: the plot at its least or at full width, beside the now column.
     *
     * @param {St.Widget} container - The card.
     * @param {number} _forHeightPx - The height offered; the width does not depend on it.
     * @returns {[number, number]} The least and the natural width.
     */
    vfunc_get_preferred_width(container, _forHeightPx) {
        const {leastWidthPx, naturalWidthPx} = compactCardContentWidths(this._measures(container).nowColumnWidthPx);
        return [leastWidthPx, naturalWidthPx];
    }

    /**
     * The content's height, the same at every width the card can take.
     *
     * @param {St.Widget} container - The card.
     * @param {number} _forWidthPx - The width offered; the height does not depend on it.
     * @returns {[number, number]} The content's height, as both the least and the natural one.
     */
    vfunc_get_preferred_height(container, _forWidthPx) {
        const {contentHeightPx} = compactCardGeometry(this._measures(container));
        return [contentHeightPx, contentHeightPx];
    }

    /**
     * Allocates every part where the geometry puts it, in the content box St hands over (the card's allocation less
     * its border and padding).
     *
     * @param {St.Widget} container - The card.
     * @param {Clutter.ActorBox} contentBox - The content box.
     * @returns {void}
     */
    vfunc_allocate(container, contentBox) {
        const meterRowMeasures = this._hasPressureHistory ? {} : this._meterRowMeasures(container);
        const measures = {...this._measures(container), ...meterRowMeasures};
        const geometry = compactCardGeometry(measures, contentBox.get_width());
        const {cpu, memory, nowRule, axisStart, axisNow, waitingOn, meters} = this._parts;
        this._allocateSection(cpu, geometry.cpu, geometry, contentBox);
        this._allocateSection(memory, geometry.memory, geometry, contentBox);
        allocateAt(nowRule, contentBox, geometry.nowRule);
        allocateLabelAt(axisStart, contentBox, 0, geometry.axisTopPx);
        const nowLabelWidthPx = naturalSize(axisNow).widthPx;
        allocateLabelAt(axisNow, contentBox, geometry.nowLabelCentrePx - nowLabelWidthPx / 2, geometry.axisTopPx);
        allocateLabelAt(waitingOn, contentBox, 0, geometry.waitingOnTopPx);
        meters.forEach((meterParts, meterIndex) => {
            const {meter, nameLeftPx, nameTopPx, strip} = geometry.pressureRows[meterIndex];
            allocateAt(meterParts.strip, contentBox, strip ?? NO_ROOM);
            allocateAt(meterParts.drawingArea, contentBox, meter);
            allocateLabelAt(meterParts.name, contentBox, nameLeftPx, nameTopPx);
            const percentLeftPx = nameLeftPx + meterPercentLeftOffsetPx(textPart(meterParts.name));
            allocateLabelAt(meterParts.percent, contentBox, percentLeftPx, nameTopPx);
        });
    }

    /**
     * Allocates one section: its label line (the heaviest app's name given the width the plot leaves it), its trace,
     * its figure with the unit on the figure's baseline, and the lines under the figure.
     *
     * @param {CompactSectionParts} sectionParts - The section's parts.
     * @param {import('./lib/compactCardGeometry.js').CompactSection} section - Where the geometry puts the section.
     * @param {import('./lib/compactCardGeometry.js').CompactCardGeometry} geometry - The whole card's places.
     * @param {Clutter.ActorBox} contentBox - The content box.
     * @returns {void}
     */
    _allocateSection(sectionParts, section, geometry, contentBox) {
        const {sectionName, heaviestName, heaviestValue, trace, figure, unit, detailLines} = sectionParts;
        allocateLabelAt(sectionName, contentBox, 0, section.labelTopPx);
        const labelLine = sectionLabelLine({
            sectionName: textPart(sectionName),
            heaviestName: textPart(heaviestName),
            heaviestValue: textPart(heaviestValue),
        }, geometry.plotWidthPx);
        const heaviestTopPx = section.labelTopPx + labelLine.heaviestTopOffsetPx;
        allocateAt(heaviestName, contentBox, {x: labelLine.heaviestNameLeftPx, y: heaviestTopPx,
            width: labelLine.heaviestNameWidthPx, height: naturalSize(heaviestName).heightPx});
        allocateLabelAt(heaviestValue, contentBox, labelLine.heaviestValueLeftPx, heaviestTopPx);
        allocateAt(trace, contentBox, section.trace);
        allocateLabelAt(figure, contentBox, geometry.nowColumnLeftPx, section.figureTopPx);
        const {unitLeftOffsetPx, unitTopOffsetPx} = figureUnitPlacement(textPart(figure), textPart(unit));
        const unitLeftPx = geometry.nowColumnLeftPx + unitLeftOffsetPx;
        allocateLabelAt(unit, contentBox, unitLeftPx, section.figureTopPx + unitTopOffsetPx);
        detailLines.forEach((detailLine, lineIndex) => {
            const detailTopPx = section.detailsTopPx + lineIndex * geometry.detailLinePx;
            allocateLabelAt(detailLine, contentBox, geometry.nowColumnLeftPx, detailTopPx);
        });
    }
});
