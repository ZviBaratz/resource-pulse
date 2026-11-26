// lib/surfaceLuminance.js: WCAG 2's relative luminance and contrast ratio, and which surfaces are light.
import {test, assertEqual} from './harness.js';
import {
    LIGHT_SURFACE_MIN_LUMINANCE, contrastRatio, isLightSurface, relativeLuminance,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/surfaceLuminance.js';

/** Decimal places the luminances and ratios are compared to. */
const COMPARED_DECIMALS = 4;

/**
 * A colour from its hex notation.
 *
 * @param {string} hex - '#rrggbb'.
 * @returns {{red: number, green: number, blue: number}} Its channels.
 */
const colorOf = hex => ({
    red: parseInt(hex.slice(1, 3), 16),
    green: parseInt(hex.slice(3, 5), 16),
    blue: parseInt(hex.slice(5, 7), 16),
});

const rounded = value => Number(value.toFixed(COMPARED_DECIMALS));

test('surface luminance: WCAG 2\'s relative luminance of white, black, a mid grey and a pure green', () =>
    assertEqual(['#ffffff', '#000000', '#777777', '#00ff00'].map(hex => rounded(relativeLuminance(colorOf(hex)))),
        [1, 0, 0.1845, 0.7152]));

test('surface luminance: the contrast ratio is 21 for black on white, either way round, 1 for a colour on itself', () =>
    assertEqual({
        blackOnWhite: rounded(contrastRatio(colorOf('#000000'), colorOf('#ffffff'))),
        whiteOnBlack: rounded(contrastRatio(colorOf('#ffffff'), colorOf('#000000'))),
        greyOnItself: rounded(contrastRatio(colorOf('#777777'), colorOf('#777777'))),
    }, {blackOnWhite: 21, whiteOnBlack: 21, greyOnItself: 1}));

test('surface luminance: a surface is light above the luminance where black and white contrast with it equally ' +
    '(about 0.179): #767676 is, #757575 is not; light and dark menus fall either side', () =>
    assertEqual({
        threshold: rounded(LIGHT_SURFACE_MIN_LUMINANCE),
        equalContrastAtThreshold: rounded((1 + 0.05) / (LIGHT_SURFACE_MIN_LUMINANCE + 0.05)) ===
            rounded((LIGHT_SURFACE_MIN_LUMINANCE + 0.05) / 0.05),
        light: ['#ffffff', '#fafafa', '#767676'].map(hex => isLightSurface(colorOf(hex))),
        dark: ['#757575', '#383838', '#222226', '#000000'].map(hex => isLightSurface(colorOf(hex))),
    }, {
        threshold: 0.1791, equalContrastAtThreshold: true,
        light: [true, true, true], dark: [false, false, false, false],
    }));

test('surface luminance: a colour whose channels cannot be read has no luminance and no contrast, and is no light ' +
    'surface', () =>
    assertEqual({
        luminance: [null, undefined, {red: NaN, green: 0, blue: 0}, {red: 256, green: 0, blue: 0}]
            .map(color => relativeLuminance(color)),
        contrast: contrastRatio(null, colorOf('#ffffff')),
        isLight: isLightSurface({red: 255, green: 255}),
    }, {luminance: [null, null, null, null], contrast: null, isLight: false}));
