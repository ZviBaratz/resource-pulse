// Which colour stays legible on a surface: WCAG 2's relative luminance and contrast ratio, the nearest surface drawn
// behind something, and which of two colours contrasts more with it. The dropdown's captions use it to choose their
// amber on whatever menu the theme draws.
//
// Pure: no gi import, so it runs under plain gjs with its own table.

/** sRGB channels are 0 to 255. */
const CHANNEL_MAX = 255;
/** Below this, an sRGB channel is linear (WCAG 2's 0.04045). */
const SRGB_LINEAR_LIMIT = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA = 2.4;
/** Each linear channel's weight in the luminance. */
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
/** The flare WCAG 2 adds to both luminances of a contrast ratio. */
const CONTRAST_FLARE = 0.05;

/** A colour's hex notation: '#rrggbb'. */
const HEX_COLOR_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RADIX = 16;

/**
 * @typedef {object} RgbColor
 * @property {number} red - 0 to 255.
 * @property {number} green - 0 to 255.
 * @property {number} blue - 0 to 255.
 */

/**
 * @typedef {object} SurfaceLayer
 * @property {{alpha: number}|null} background - The colour of the layer's background, with its alpha (0, fully
 *     clear, to 255); null for none.
 * @property {{alpha: number}|null} arrowBackground - The colour of its arrow background (a box pointer draws its
 *     surface from that property rather than from its background); null for none.
 */

/**
 * One sRGB channel, linear.
 *
 * @param {number} channel - 0 to 255.
 * @returns {number} 0 to 1.
 */
function linearChannel(channel) {
    const fraction = channel / CHANNEL_MAX;
    if (fraction <= SRGB_LINEAR_LIMIT)
        return fraction / SRGB_LINEAR_DIVISOR;
    return ((fraction + SRGB_GAMMA_OFFSET) / (1 + SRGB_GAMMA_OFFSET)) ** SRGB_GAMMA;
}

/**
 * Whether each channel is a number from 0 to 255.
 *
 * @param {RgbColor} color - The colour.
 * @returns {boolean} True when every channel can be read.
 */
function hasReadableChannels(color) {
    return [color?.red, color?.green, color?.blue].every(
        channel => Number.isFinite(channel) && channel >= 0 && channel <= CHANNEL_MAX);
}

/**
 * WCAG 2's relative luminance.
 *
 * @param {RgbColor} color - The colour.
 * @returns {number|null} 0 (black) to 1 (white); null for a colour whose channels cannot be read.
 */
export function relativeLuminance(color) {
    if (!hasReadableChannels(color))
        return null;
    return RED_WEIGHT * linearChannel(color.red) + GREEN_WEIGHT * linearChannel(color.green) +
        BLUE_WEIGHT * linearChannel(color.blue);
}

/**
 * WCAG 2's contrast ratio of two colours, the lighter's luminance over the darker's, each with the flare added.
 *
 * @param {RgbColor} firstColor - One colour.
 * @param {RgbColor} secondColor - The other.
 * @returns {number|null} 1 to 21; null when either colour cannot be read.
 */
export function contrastRatio(firstColor, secondColor) {
    const firstLuminance = relativeLuminance(firstColor);
    const secondLuminance = relativeLuminance(secondColor);
    if (firstLuminance === null || secondLuminance === null)
        return null;
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + CONTRAST_FLARE) / (darker + CONTRAST_FLARE);
}

/**
 * A colour from its hex notation.
 *
 * @param {string} hex - '#rrggbb', in either case.
 * @returns {RgbColor|null} Its channels; null for anything else.
 */
export function rgbColorOfHex(hex) {
    const channelDigits = typeof hex === 'string' ? HEX_COLOR_PATTERN.exec(hex) : null;
    if (channelDigits === null)
        return null;
    const [red, green, blue] = channelDigits.slice(1).map(digits => parseInt(digits, HEX_RADIX));
    return {red, green, blue};
}

/**
 * Whether a colour is drawn at all: it has an alpha above 0.
 *
 * @param {{alpha: number}|null} color - The colour, or null for none.
 * @returns {boolean} True unless it is missing or fully clear.
 */
function isDrawnColor(color) {
    return Number.isFinite(color?.alpha) && color.alpha > 0;
}

/**
 * The colour of the nearest surface drawn behind something: the first layer, nearest first, whose background is
 * drawn, or failing that its arrow background. A layer not styled yet is passed over, and so is one with neither
 * drawn. The layers are read only as far as the first drawn one.
 *
 * @param {Iterable<SurfaceLayer|null>} layersNearestFirst - The layers behind it, nearest first; null for a layer
 *     not styled yet.
 * @returns {{alpha: number}|null} That surface's colour, as its layer gave it; null when no layer draws one.
 */
export function nearestDrawnSurfaceColor(layersNearestFirst) {
    for (const layer of layersNearestFirst) {
        if (layer === null)
            continue;
        if (isDrawnColor(layer.background))
            return layer.background;
        if (isDrawnColor(layer.arrowBackground))
            return layer.arrowBackground;
    }
    return null;
}

/**
 * Whether an alternative colour reads better on a surface than the usual one: its contrast ratio with the surface is
 * higher. With no surface, or a colour that cannot be read, the usual colour is kept, and so it is at a tie.
 *
 * @param {RgbColor|null} surfaceColor - The surface's colour, or null when none is drawn.
 * @param {RgbColor} usualColor - The colour drawn on it otherwise.
 * @param {RgbColor} alternativeColor - The colour to draw instead where it reads better.
 * @returns {boolean} True when the alternative contrasts more with the surface.
 */
export function isAlternativeColorMoreLegible(surfaceColor, usualColor, alternativeColor) {
    if (surfaceColor === null)
        return false;
    const usualContrast = contrastRatio(usualColor, surfaceColor);
    const alternativeContrast = contrastRatio(alternativeColor, surfaceColor);
    if (usualContrast === null || alternativeContrast === null)
        return false;
    return alternativeContrast > usualContrast;
}
