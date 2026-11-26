// How light a surface is, to choose a colour that stays legible on it: WCAG 2's relative luminance and contrast
// ratio. The dropdown's captions use it to tell a light menu from a dark one, whatever the theme.
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

/**
 * The luminance at which black and white contrast equally with a surface, about 0.179: above it, dark words read
 * better on the surface than light ones, so it is light.
 */
export const LIGHT_SURFACE_MIN_LUMINANCE = Math.sqrt((1 + CONTRAST_FLARE) * CONTRAST_FLARE) - CONTRAST_FLARE;

/**
 * @typedef {object} RgbColor
 * @property {number} red - 0 to 255.
 * @property {number} green - 0 to 255.
 * @property {number} blue - 0 to 255.
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
 * Whether a surface is light: its luminance is above LIGHT_SURFACE_MIN_LUMINANCE. A colour that cannot be read is no
 * light surface, so what is drawn on it keeps its usual colour.
 *
 * @param {RgbColor} color - The surface's colour.
 * @returns {boolean} True for a light surface.
 */
export function isLightSurface(color) {
    const luminance = relativeLuminance(color);
    return luminance !== null && luminance > LIGHT_SURFACE_MIN_LUMINANCE;
}
