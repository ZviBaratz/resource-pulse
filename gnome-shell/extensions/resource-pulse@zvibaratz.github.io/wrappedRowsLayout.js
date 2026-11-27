// A layout that packs its shown children into rows (lib/wrappedRows.js): left to right, a gap between neighbours, a
// new row once the next would pass the width it is given, each row as tall as its tallest child. It asks for no
// more than its widest child, so it never widens what holds it, and takes whatever width it is given. The dropdown's
// caption line uses it, since Clutter's FlowLayout gives its cells one width and, there, no height.
//
// Shell glue only: the arithmetic is lib/wrappedRows.js's, and this reads the children's sizes and allocates them.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {wrappedRowPlacements, wrappedRowsRequestedWidth} from './lib/wrappedRows.js';

/** What Clutter passes for a size asked with no width or height to fit. */
const NO_SIZE_GIVEN = -1;

/**
 * A child's natural width, in whole pixels.
 *
 * @param {Clutter.Actor} child - The child.
 * @returns {number} Its natural width, rounded up.
 */
function naturalWidthOf(child) {
    const [, naturalWidth] = child.get_preferred_width(NO_SIZE_GIVEN);
    return Math.ceil(naturalWidth);
}

export const WrappedRowsLayout = GObject.registerClass(
class WrappedRowsLayout extends Clutter.LayoutManager {
    /** Starts with no gap; its owner sets the stylesheet's (setGap). */
    _init() {
        super._init();
        this._gap = 0;
    }

    /**
     * Sets the gap between neighbours and between rows, and lays the children out again if it changed.
     *
     * @param {number} gap - The gap, in pixels.
     * @returns {void}
     */
    setGap(gap) {
        if (gap === this._gap)
            return;
        this._gap = gap;
        this.layout_changed();
    }

    /**
     * Where each shown child goes in rows of the given width.
     *
     * @param {Clutter.Actor[]} children - The shown children, in order.
     * @param {number} lineWidth - The width the rows fill.
     * @returns {import('./lib/wrappedRows.js').WrappedRows} The placements and the rows' height.
     */
    _placementsOf(children, lineWidth) {
        const cellSizes = children.map(child => {
            const width = naturalWidthOf(child);
            const placedWidth = Math.min(width, lineWidth);
            const [, naturalHeight] = child.get_preferred_height(placedWidth);
            return {width, height: Math.ceil(naturalHeight)};
        });
        return wrappedRowPlacements({cellSizes, lineWidth, gap: this._gap});
    }

    /**
     * The container's shown children, in order.
     *
     * @param {Clutter.Actor} container - The container.
     * @returns {Clutter.Actor[]} Its visible children.
     */
    _shownChildrenOf(container) {
        return container.get_children().filter(child => child.visible);
    }

    /**
     * Asks for the widest child's width, as the least and the natural.
     *
     * @param {Clutter.Actor} container - The container.
     * @param {number} _forHeight - Unused: the width does not depend on it.
     * @returns {number[]} [least width, natural width].
     */
    vfunc_get_preferred_width(container, _forHeight) {
        const requestedWidth = wrappedRowsRequestedWidth(this._shownChildrenOf(container).map(naturalWidthOf));
        return [requestedWidth, requestedWidth];
    }

    /**
     * Asks for the rows' height at the given width, or at the widest child's width when none is given.
     *
     * @param {Clutter.Actor} container - The container.
     * @param {number} forWidth - The width to fit, or NO_SIZE_GIVEN.
     * @returns {number[]} [least height, natural height], the same.
     */
    vfunc_get_preferred_height(container, forWidth) {
        const children = this._shownChildrenOf(container);
        const lineWidth = forWidth === NO_SIZE_GIVEN
            ? wrappedRowsRequestedWidth(children.map(naturalWidthOf))
            : forWidth;
        const {height} = this._placementsOf(children, lineWidth);
        return [height, height];
    }

    /**
     * Allocates each shown child its place in rows of the box's width, from the box's corner.
     *
     * @param {Clutter.Actor} container - The container.
     * @param {Clutter.ActorBox} box - The content box to fill.
     * @returns {void}
     */
    vfunc_allocate(container, box) {
        const children = this._shownChildrenOf(container);
        const {placements} = this._placementsOf(children, box.get_width());
        children.forEach((child, childIndex) => {
            const {x, y, width, height} = placements[childIndex];
            const childBox = new Clutter.ActorBox();
            childBox.set_origin(box.x1 + x, box.y1 + y);
            childBox.set_size(width, height);
            child.allocate(childBox);
        });
    }
});
