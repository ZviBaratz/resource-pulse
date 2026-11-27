// lib/surfaceLuminance.js: WCAG 2's relative luminance and contrast ratio, the nearest surface drawn behind
// something, and which of two colours contrasts more with a surface.
import {test, assertEqual} from './harness.js';
import {
    contrastRatio, isAlternativeColorMoreLegible, nearestDrawnSurfaceColor, relativeLuminance, rgbColorOfHex,
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

/** The dropdown's captions' amber, and the darker amber they take where it reads better. */
const CAPTION_AMBER = colorOf('#f0b429');
const DARKER_CAPTION_AMBER = colorOf('#946200');
/** A layer's colour with its alpha: fully drawn, barely drawn, and fully clear. */
const OPAQUE_ALPHA = 255;
const BARELY_DRAWN_ALPHA = 1;
const CLEAR_ALPHA = 0;
const drawn = (hex, alpha = OPAQUE_ALPHA) => ({...colorOf(hex), alpha});

test('surface luminance: WCAG 2\'s relative luminance of white, black, a mid grey and a pure green', () =>
    assertEqual(['#ffffff', '#000000', '#777777', '#00ff00'].map(hex => rounded(relativeLuminance(colorOf(hex)))),
        [1, 0, 0.1845, 0.7152]));

test('surface luminance: the contrast ratio is 21 for black on white, either way round, 1 for a colour on itself', () =>
    assertEqual({
        blackOnWhite: rounded(contrastRatio(colorOf('#000000'), colorOf('#ffffff'))),
        whiteOnBlack: rounded(contrastRatio(colorOf('#ffffff'), colorOf('#000000'))),
        greyOnItself: rounded(contrastRatio(colorOf('#777777'), colorOf('#777777'))),
    }, {blackOnWhite: 21, whiteOnBlack: 21, greyOnItself: 1}));

test('surface luminance: a colour is read from #rrggbb in either case, and anything else is no colour', () =>
    assertEqual({
        amber: rgbColorOfHex('#f0b429'),
        upperCase: rgbColorOfHex('#FAFAFB'),
        unreadable: ['f0b429', '#fff', '#f0b42', '#f0b4299', '#gggggg', '', null, undefined, 0xf0b429]
            .map(hex => rgbColorOfHex(hex)),
    }, {
        amber: {red: 240, green: 180, blue: 41},
        upperCase: {red: 250, green: 250, blue: 251},
        unreadable: [null, null, null, null, null, null, null, null, null],
    }));

test('surface luminance: the nearest surface drawn is the first layer whose background, or failing that whose ' +
    'arrow background, has any alpha; a layer not styled yet, or with neither drawn, is passed over', () =>
    assertEqual({
        nearestFirst: nearestDrawnSurfaceColor([{background: drawn('#36363a'), arrowBackground: null},
            {background: drawn('#000000'), arrowBackground: null}]),
        notStyledPassedOver: nearestDrawnSurfaceColor([null, {background: drawn('#fafafb'), arrowBackground: null}]),
        backgroundBeforeArrow: nearestDrawnSurfaceColor([
            {background: drawn('#36363a'), arrowBackground: drawn('#fafafb')}]),
        clearBackgroundToArrow: nearestDrawnSurfaceColor([
            {background: drawn('#ffffff', CLEAR_ALPHA), arrowBackground: drawn('#fafafb')}]),
        neitherDrawnPassedOver: nearestDrawnSurfaceColor([
            {background: drawn('#ffffff', CLEAR_ALPHA), arrowBackground: drawn('#ffffff', CLEAR_ALPHA)},
            {background: drawn('#ffffff', CLEAR_ALPHA), arrowBackground: null},
            {background: drawn('#36363a'), arrowBackground: null}]),
        barelyDrawnCounts: nearestDrawnSurfaceColor([
            {background: drawn('#fafafb', BARELY_DRAWN_ALPHA), arrowBackground: drawn('#36363a')}]),
        noAlphaIsNotDrawn: nearestDrawnSurfaceColor([{background: colorOf('#fafafb'), arrowBackground: null}]),
        noneDrawn: nearestDrawnSurfaceColor([null, {background: drawn('#ffffff', CLEAR_ALPHA), arrowBackground: null}]),
        noLayers: nearestDrawnSurfaceColor([]),
    }, {
        nearestFirst: drawn('#36363a'),
        notStyledPassedOver: drawn('#fafafb'),
        backgroundBeforeArrow: drawn('#36363a'),
        clearBackgroundToArrow: drawn('#fafafb'),
        neitherDrawnPassedOver: drawn('#36363a'),
        barelyDrawnCounts: drawn('#fafafb', BARELY_DRAWN_ALPHA),
        noAlphaIsNotDrawn: null,
        noneDrawn: null,
        noLayers: null,
    }));

test('surface luminance: the layers behind are read only as far as the first drawn surface', () => {
    const layersRead = [];
    /**
     * Two layers, the first drawn, each recorded as it is read.
     *
     * @yields {object} A layer.
     */
    function* recordedLayers() {
        layersRead.push('menu');
        yield {background: drawn('#fafafb'), arrowBackground: null};
        layersRead.push('stage');
        yield {background: drawn('#000000'), arrowBackground: null};
    }
    const surfaceColor = nearestDrawnSurfaceColor(recordedLayers());
    assertEqual({surfaceColor, layersRead}, {surfaceColor: drawn('#fafafb'), layersRead: ['menu']});
});

test('surface luminance: the captions\' darker amber is chosen where it contrasts more than their amber: on the ' +
    'stock light menus (#fafafb, white) and from the greys where the two contrast equally (#929292 on), never on ' +
    'the stock dark menu (#36363a) or a mid grey (#808080)', () =>
    assertEqual({
        light: ['#fafafb', '#ffffff', '#a0a0a0', '#929292']
            .map(hex => isAlternativeColorMoreLegible(colorOf(hex), CAPTION_AMBER, DARKER_CAPTION_AMBER)),
        dark: ['#36363a', '#000000', '#808080', '#919191']
            .map(hex => isAlternativeColorMoreLegible(colorOf(hex), CAPTION_AMBER, DARKER_CAPTION_AMBER)),
        contrastsOnMidGrey: [CAPTION_AMBER, DARKER_CAPTION_AMBER]
            .map(amber => Number(contrastRatio(amber, colorOf('#808080')).toFixed(2))),
    }, {light: [true, true, true, true], dark: [false, false, false, false], contrastsOnMidGrey: [2.12, 1.33]}));

test('surface luminance: a colour whose channels cannot be read has no luminance and no contrast; with no surface, ' +
    'a surface or a colour that cannot be read, or a tie, the usual colour is kept', () =>
    assertEqual({
        luminance: [null, undefined, {red: NaN, green: 0, blue: 0}, {red: 256, green: 0, blue: 0}]
            .map(color => relativeLuminance(color)),
        contrast: contrastRatio(null, colorOf('#ffffff')),
        isAlternativeMoreLegible: [
            isAlternativeColorMoreLegible(null, CAPTION_AMBER, DARKER_CAPTION_AMBER),
            isAlternativeColorMoreLegible({red: 255, green: 255}, CAPTION_AMBER, DARKER_CAPTION_AMBER),
            isAlternativeColorMoreLegible(colorOf('#ffffff'), CAPTION_AMBER, {red: 148, green: 98}),
            isAlternativeColorMoreLegible(colorOf('#ffffff'), CAPTION_AMBER, CAPTION_AMBER),
        ],
    }, {
        luminance: [null, null, null, null],
        contrast: null,
        isAlternativeMoreLegible: [false, false, false, false],
    }));
