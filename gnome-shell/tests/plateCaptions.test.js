// lib/plateCaptions.js: which captions each group's caption plate carries, from synthetic layouts.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as plateCaptions from '../extensions/resource-pulse@zvibaratz.github.io/lib/plateCaptions.js';
import {CAPTION_ORDER, CockpitCaption} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCaptions.js';
import {MachineCaption} from '../extensions/resource-pulse@zvibaratz.github.io/lib/machineCaptions.js';

/** The groups of a large layout whose last group alone draws a card. */
const LARGE_LAYOUT_GROUP_COUNT = 200000;

const {CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT, WAITING_ON_YOU, STALE} = plateCaptions.PlateCaption;

/**
 * @param {string} caption - The group's caption.
 * @param {string[]} cards - Its card ids.
 * @param {string} [id] - Its id; the caption, lower-cased, where left out.
 * @returns {object} A group, as the lenient reader gives one.
 */
function group(caption, cards, id = caption.toLowerCase()) {
    return {id, caption, columns: 1, cards};
}

/**
 * @param {Array<*>} groups - The layout's groups.
 * @returns {Array<string[]|null>} Each group's plate's annunciators; null for a group with no plate.
 */
function captionsByGroup(groups) {
    return plateCaptions.plateCaptionsByGroup(groups).map(plate => plate === null ? null : plate.captions);
}

test('plateCaptions: the template\'s machine plate carries the pressure captions, Swapping, Offline, Mount and ' +
    'Stale, and its agents plate "Waiting on you" and Stale', () =>
    assertEqual(plateCaptions.plateCaptionsByGroup([
        group('Machine', ['system', 'apps', 'connections']), group('Agents', ['sessions']),
    ]), [
        {groupCaption: 'Machine', captions: [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT, STALE]},
        {groupCaption: 'Agents', captions: [WAITING_ON_YOU, STALE]},
    ]));

test('plateCaptions: a group of Connections alone carries Offline, Mount and Stale; of Heaviest alone, Stale alone',
    () => assertEqual(captionsByGroup([group('Links', ['connections']), group('Apps', ['apps'])]),
        [[OFFLINE, MOUNT, STALE], [STALE]]));

test('plateCaptions: a group that draws Sessions and a machine tile carries "Waiting on you" first, as every surface ' +
    'names it, and one Stale, last, not two', () =>
    assertEqual(captionsByGroup([group('All', ['sessions', 'connections'])]),
        [[WAITING_ON_YOU, OFFLINE, MOUNT, STALE]]));

test('plateCaptions: a plate\'s annunciators are the one list\'s captions (lib/cockpitCaptions.js CAPTION_ORDER), ' +
    'by the same ids and in its order, with the plate\'s one Stale standing for the list\'s two Stale captions, ' +
    'last', () => {
    const listedStaleCaptions = [MachineCaption.MACHINE_STALE, CockpitCaption.AGENTS_STALE];
    const listedAnnunciators = CAPTION_ORDER.filter(caption => !listedStaleCaptions.includes(caption));
    assertEqual({
        ids: Object.values(plateCaptions.PlateCaption).filter(caption => caption !== STALE)
            .sort((first, second) => CAPTION_ORDER.indexOf(first) - CAPTION_ORDER.indexOf(second)),
        everyCard: captionsByGroup([group('Desk', ['sessions', 'connections', 'apps', 'system'])])[0],
    }, {ids: listedAnnunciators, everyCard: [...listedAnnunciators, STALE]});
});

test('plateCaptions: the machine\'s tiles split across two groups: each group carries its own evidence and a Stale',
    () => assertEqual(captionsByGroup([group('Monitor', ['system']), group('Rest', ['apps', 'connections'])]),
        [[CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, STALE], [OFFLINE, MOUNT, STALE]]));

test('plateCaptions: within one plate the captions keep their fixed places, whatever order the layout names the ' +
    'cards in', () =>
    assertEqual(captionsByGroup([group('Machine', ['connections', 'apps', 'system'])]),
        [[CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, OFFLINE, MOUNT, STALE]]));

test('plateCaptions: a card is drawn once, at its first place: named again in its group or a later one it brings ' +
    'nothing, and a group left with no card has no plate', () =>
    assertEqual(captionsByGroup([
        group('First', ['connections', 'connections']), group('Again', ['connections']), group('More', ['system']),
    ]), [[OFFLINE, MOUNT, STALE], null, [CPU_WAIT, MEM_WAIT, IO_WAIT, SWAPPING, STALE]]));

test('plateCaptions: an id this release does not draw, a group that is null, cards that are not a list, and no ' +
    'cards at all give no plate; a group with no id still has one', () =>
    assertEqual(captionsByGroup([
        group('Unknown', ['weather']), null, {id: 'odd', caption: 'Odd', cards: 'system'}, group('Empty', []),
        {caption: 'No id', cards: ['apps']},
    ]), [null, null, null, null, [STALE]]));

test('plateCaptions: a repeated group id gives two plates, told apart by place; a caption that is not a string is ' +
    'empty', () =>
    assertEqual(plateCaptions.plateCaptionsByGroup([
        group('One', ['apps'], 'same'), {id: 'same', caption: 42, cards: ['sessions']},
    ]), [{groupCaption: 'One', captions: [STALE]}, {groupCaption: '', captions: [WAITING_ON_YOU, STALE]}]));

test('plateCaptions: groups that are not a list give no plates', () =>
    assertEqual([null, undefined, 'groups', {cards: ['system']}].map(groups =>
        plateCaptions.plateCaptionsByGroup(groups)), [[], [], [], []]));

test('plateCaptions: 200 000 groups whose last alone names a card: one entry a group, the last one\'s plate ' +
    'Sessions\' captions', () => {
    const groups = Array.from({length: LARGE_LAYOUT_GROUP_COUNT - 1}, () => group('Empty', []));
    groups.push(group('Agents', ['sessions']));
    const plates = plateCaptions.plateCaptionsByGroup(groups);
    assertEqual({count: plates.length, platesDrawn: plates.filter(plate => plate !== null).length, last: plates.at(-1)},
        {count: LARGE_LAYOUT_GROUP_COUNT, platesDrawn: 1,
            last: {groupCaption: 'Agents', captions: [WAITING_ON_YOU, STALE]}});
});
