// lib/cockpitCaptions.js: the cockpit's captions lit from what its client holds, with no hold; a Stale caption only
// for a source that answered and then stopped; the service gone lights both Stale captions and ends the rest; and the
// one order every surface names the captions in.
import {test, assertEqual} from './harness.js';
import {
    CAPTION_ORDER, CaptionSource, CockpitCaption, CockpitCaptionsFollower, captionWords, cockpitCaptionsOf,
    judgeCockpitCaptions, keptCaptionsLit, litCaptionsOf,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitCaptions.js';
import {MachineCaption} from '../extensions/resource-pulse@zvibaratz.github.io/lib/machineCaptions.js';
import {CockpitClientState} from '../extensions/resource-pulse@zvibaratz.github.io/lib/constants.js';

/** Any wall-clock stamp: a source carrying one has answered. */
const SAMPLED_AT_USEC = 1_790_000_000_000_000;
/** The fixture's blocked sessions. */
const FIXTURE_BLOCKED_COUNT = 5;

/**
 * A sessions source as the protocol's reader gives one.
 *
 * @param {number|null} blockedCount - Its `counts.blocked`; null for a count it does not carry.
 * @param {object} [options]
 * @param {number|null} [options.sampledAtUsec] - Its stamp; null for one that never answered.
 * @returns {object} The source.
 */
function sessionsSource(blockedCount, {sampledAtUsec = SAMPLED_AT_USEC} = {}) {
    const counts = {working: 2, blocked: blockedCount, idle: 1, done: 0, unknown: 0};
    return {sampledAtUsec, intervalSeconds: 15, herdrRunning: true, totalMemoryBytes: null, counts, rows: []};
}

/**
 * A network source.
 *
 * @param {string|null} connectivity - Its uplink's connectivity; null for none read.
 * @param {object} [options]
 * @param {number|null} [options.sampledAtUsec] - Its stamp.
 * @returns {object} The source.
 */
function networkSource(connectivity, {sampledAtUsec = SAMPLED_AT_USEC} = {}) {
    return {
        sampledAtUsec, intervalSeconds: 15, uplink: {kind: 'wifi', connectivity, wifiEnabled: true}, vpn: null,
        ssh: null,
    };
}

/**
 * A mounts source of the given rows.
 *
 * @param {object[]} rows - Its rows.
 * @param {object} [options]
 * @param {number|null} [options.sampledAtUsec] - Its stamp.
 * @returns {object} The source.
 */
function mountsSource(rows, {sampledAtUsec = SAMPLED_AT_USEC} = {}) {
    return {sampledAtUsec, intervalSeconds: 30, rows};
}

/**
 * One mount row.
 *
 * @param {string} kind - Its kind.
 * @param {string|null|undefined} noSizesReason - Why it has no sizes; undefined for a service older than the reason.
 * @param {string} [filesystemType] - Its filesystem type.
 * @returns {object} The row.
 */
function mountRow(kind, noSizesReason, filesystemType = 'ext4') {
    const row = {path: '/mnt/share', kind, filesystemType, usedBytes: null, totalBytes: null};
    if (noSizesReason !== undefined)
        row.noSizesReason = noSizesReason;
    return row;
}

/** A quiet cockpit: every source answered, nothing waiting, online, no mount at fault. */
const QUIET_SOURCES = Object.freeze({
    sessions: sessionsSource(0),
    network: networkSource('full'),
    mounts: mountsSource([mountRow('network', null)]),
});

/** No source called stale by the pull rule. */
const NONE_STALE = Object.freeze({sessions: false, network: false, mounts: false});

/**
 * The cockpit's captions for a live client holding QUIET_SOURCES, with the given sources and verdicts in their place.
 *
 * @param {object} [reading]
 * @param {object} [reading.sources] - Sources in place of the quiet ones.
 * @param {object} [reading.stale] - Pull-rule verdicts in place of NONE_STALE.
 * @param {string} [reading.clientState] - The client's state.
 * @returns {{captions: readonly string[], waitingCount: number, staleSourceIds: readonly string[]}} The answer.
 */
function judged({sources = {}, stale = {}, clientState = CockpitClientState.LIVE} = {}) {
    return judgeCockpitCaptions({
        clientState,
        sourcesByName: {...QUIET_SOURCES, ...sources},
        isStaleBySourceName: {...NONE_STALE, ...stale},
    });
}

/**
 * An answer as one line a row compares: its captions, its count and its stale sources.
 *
 * @param {{captions: readonly string[], waitingCount: number, staleSourceIds: readonly string[]}} answer - It.
 * @returns {string} For example 'Waiting on you|5|'.
 */
function summary(answer) {
    return `${answer.captions.join(',')}|${answer.waitingCount}|${answer.staleSourceIds.join(',')}`;
}

test('cockpitCaptions: one order for every caption, the machine\'s and the cockpit\'s, each once, frozen: the ' +
    'waiting caption, the machine\'s waits and Swapping, Offline, Mount, then the two Stale captions', () => {
    assertEqual(CAPTION_ORDER.join(','),
        'Waiting on you,CPU wait,Mem wait,IO wait,Swapping,Offline,Mount,Machine stale,Agents stale');
    const everyCaption = [...Object.values(MachineCaption), ...Object.values(CockpitCaption)].sort();
    assertEqual([...CAPTION_ORDER].sort().join(','), everyCaption.join(','), 'every caption, each once');
    assertEqual(Object.isFrozen(CAPTION_ORDER), true, 'frozen');
    const machineOrder = CAPTION_ORDER.filter(caption => Object.values(MachineCaption).includes(caption));
    assertEqual(machineOrder.join(','), Object.values(MachineCaption).join(','), 'the machine\'s in their own order');
});

test('cockpitCaptions: nothing is lit before the first answer, a source with no stamp lighting not even its own ' +
    'caption, nor while starting or skipped, nor with the service gone before any source answered', () => {
    const neverAnswered = {
        sessions: sessionsSource(FIXTURE_BLOCKED_COUNT, {sampledAtUsec: null}),
        network: networkSource('none', {sampledAtUsec: null}),
        mounts: mountsSource([mountRow('network', 'no-answer')], {sampledAtUsec: null}),
    };
    const noSources = {sessions: null, network: null, mounts: null};
    const allStale = {sessions: true, network: true, mounts: true};
    const answers = [
        judged({sources: noSources}),
        judged({sources: noSources, stale: allStale}),
        judged({sources: neverAnswered}),
        judged({sources: neverAnswered, stale: allStale}),
        judged({sources: noSources, clientState: CockpitClientState.VANISHED}),
        judged({sources: neverAnswered, clientState: CockpitClientState.VANISHED}),
        judged({clientState: CockpitClientState.STARTING, sources: {sessions: sessionsSource(FIXTURE_BLOCKED_COUNT)}}),
        judged({clientState: CockpitClientState.SKIPPED, sources: {sessions: sessionsSource(FIXTURE_BLOCKED_COUNT)}}),
    ];
    const nothingLit = '|0|';
    assertEqual(answers.map(summary).join(' / '), Array(answers.length).fill(nothingLit).join(' / '));
});

test('cockpitCaptions: "N waiting on you" follows the sessions source\'s blocked count exactly, with no hold', () => {
    const blockedCounts = [0, 1, FIXTURE_BLOCKED_COUNT, 3, 0, null];
    const answers = blockedCounts.map(blockedCount =>
        summary(judged({sources: {sessions: sessionsSource(blockedCount)}})));
    assertEqual(answers.join(' / '),
        '|0| / Waiting on you|1| / Waiting on you|5| / Waiting on you|3| / |0| / |0|');
    const noCounts = {...sessionsSource(0), counts: null};
    assertEqual(summary(judged({sources: {sessions: noCounts}})), '|0|', 'a source with no counts');
});

test('cockpitCaptions: Offline is lit while the uplink says no connectivity; unknown and no reading light nothing',
    () => {
        const connectivities = ['none', 'full', 'limited', 'portal', 'unknown', null];
        const answers = connectivities.map(connectivity =>
            `${connectivity}:${summary(judged({sources: {network: networkSource(connectivity)}}))}`);
        assertEqual(answers.join(' / '),
            'none:Offline|0| / full:|0| / limited:|0| / portal:|0| / unknown:|0| / null:|0|');
        const noUplink = {...networkSource(null), uplink: null};
        assertEqual(summary(judged({sources: {network: noUplink}})), '|0|', 'no uplink');
    });

test('cockpitCaptions: Mount is lit while a mount\'s size query failed or did not answer, on any kind of mount, a ' +
    'local disk too, never an automount point; the other reasons and an older service light nothing', () => {
    const cases = [
        ['network query-failed', [mountRow('network', 'query-failed')]],
        ['removable no-answer', [mountRow('removable', 'no-answer')]],
        ['local query-failed', [mountRow('local', 'query-failed')]],
        ['local no-answer', [mountRow('local', 'no-answer')]],
        ['autofs query-failed', [mountRow('network', 'query-failed', 'autofs')]],
        ['autofs no-answer', [mountRow('network', 'no-answer', 'autofs')]],
        ['not-reported', [mountRow('network', 'not-reported')]],
        ['not-permitted', [mountRow('network', 'not-permitted')]],
        ['null', [mountRow('network', null)]],
        ['older service', [mountRow('network', undefined)]],
        ['one of three', [mountRow('local', null), mountRow('network', 'no-answer'), mountRow('removable', null)]],
        ['no rows', []],
    ];
    const answers = cases.map(([name, rows]) => `${name}:${summary(judged({sources: {mounts: mountsSource(rows)}}))}`);
    assertEqual(answers.join(' / '), [
        'network query-failed:Mount|0|', 'removable no-answer:Mount|0|', 'local query-failed:Mount|0|',
        'local no-answer:Mount|0|', 'autofs query-failed:|0|', 'autofs no-answer:|0|', 'not-reported:|0|',
        'not-permitted:|0|', 'null:|0|', 'older service:|0|', 'one of three:Mount|0|', 'no rows:|0|',
    ].join(' / '));
    const noRows = {...mountsSource([]), rows: null};
    assertEqual(summary(judged({sources: {mounts: noRows}})), '|0|', 'rows not read');
});

test('cockpitCaptions: a source that answered and then stopped lights its Stale caption, names itself among the ' +
    'stale sources and puts out its own caption; Machine stale is lit once for the network and the mounts', () => {
    const busySources = {
        sessions: sessionsSource(FIXTURE_BLOCKED_COUNT),
        network: networkSource('none'),
        mounts: mountsSource([mountRow('network', 'no-answer')]),
    };
    const cases = [
        ['none', {}],
        ['sessions', {sessions: true}],
        ['network', {network: true}],
        ['mounts', {mounts: true}],
        ['network and mounts', {network: true, mounts: true}],
        ['all three', {sessions: true, network: true, mounts: true}],
    ];
    const answers = cases.map(([name, stale]) => `${name}:${summary(judged({sources: busySources, stale}))}`);
    assertEqual(answers.join(' / '), [
        'none:Waiting on you,Offline,Mount|5|',
        'sessions:Offline,Mount,Agents stale|0|sessions',
        'network:Waiting on you,Mount,Machine stale|5|network',
        'mounts:Waiting on you,Offline,Machine stale|5|mounts',
        'network and mounts:Waiting on you,Machine stale|5|network,mounts',
        'all three:Machine stale,Agents stale|0|sessions,network,mounts',
    ].join(' / '));
});

test('cockpitCaptions: the service gone lights both Stale captions for the sources that answered, and ends the ' +
    'count, Offline and Mount', () => {
    const busySources = {
        sessions: sessionsSource(FIXTURE_BLOCKED_COUNT),
        network: networkSource('none'),
        mounts: mountsSource([mountRow('network', 'no-answer')]),
    };
    const gone = CockpitClientState.VANISHED;
    assertEqual(summary(judged({sources: busySources, clientState: gone})),
        'Machine stale,Agents stale|0|sessions,network,mounts');
    const onlySessionsAnswered = {
        sessions: sessionsSource(FIXTURE_BLOCKED_COUNT), network: null, mounts: mountsSource([], {sampledAtUsec: null}),
    };
    assertEqual(summary(judged({sources: onlySessionsAnswered, clientState: gone})), 'Agents stale|0|sessions',
        'only the sessions answered');
});

test('cockpitCaptions: an answer is frozen, and a quiet cockpit always gives the same one', () => {
    const lit = judged({sources: {sessions: sessionsSource(1)}, stale: {network: true}});
    const isLitFrozen = Object.isFrozen(lit) && Object.isFrozen(lit.captions) && Object.isFrozen(lit.staleSourceIds);
    assertEqual(isLitFrozen, true, 'lit');
    const quiet = judged();
    assertEqual(Object.isFrozen(quiet) && Object.isFrozen(quiet.captions), true, 'quiet');
    assertEqual(quiet === judged() && quiet === judged({clientState: CockpitClientState.STARTING}), true, 'the same');
});

test('cockpitCaptions: the machine\'s and the cockpit\'s captions joined in the one order, Machine stale once ' +
    'whichever half lit it, the sampler among the stale sources while the machine\'s half lights it', () => {
    const cockpitCaptions = judged({
        sources: {sessions: sessionsSource(FIXTURE_BLOCKED_COUNT), network: networkSource('none')},
        stale: {mounts: true},
    });
    const withWaits = litCaptionsOf({
        machineCaptions: [MachineCaption.IO_WAIT, MachineCaption.CPU_WAIT], cockpitCaptions,
    });
    assertEqual(summary(withWaits), 'Waiting on you,CPU wait,IO wait,Offline,Machine stale|5|mounts', 'waits');
    const bothStale = litCaptionsOf({machineCaptions: [MachineCaption.MACHINE_STALE], cockpitCaptions});
    assertEqual(summary(bothStale), 'Waiting on you,Offline,Machine stale|5|sampler,mounts', 'both halves');
    const machineAlone = litCaptionsOf({machineCaptions: [MachineCaption.MACHINE_STALE], cockpitCaptions: judged()});
    assertEqual(summary(machineAlone), 'Machine stale|0|sampler', 'the sampler alone');
    const nothing = litCaptionsOf({machineCaptions: [], cockpitCaptions: judged()});
    assertEqual(nothing === judged(), true, 'nothing lit: the same frozen answer');
});

test('cockpitCaptions: the waiting caption\'s words carry its count; every other caption\'s are its id; an ' +
    'answer carries its captions\' words in its order, frozen', () => {
    const words = [
        captionWords(CockpitCaption.WAITING, 1),
        captionWords(CockpitCaption.WAITING, 42),
        captionWords(CockpitCaption.OFFLINE, 3),
        captionWords(MachineCaption.CPU_WAIT, 0),
    ];
    assertEqual(words.join(' / '), '1 waiting on you / 42 waiting on you / Offline / CPU wait');
    const lit = litCaptionsOf({
        machineCaptions: [MachineCaption.SWAPPING],
        cockpitCaptions: judged({sources: {sessions: sessionsSource(FIXTURE_BLOCKED_COUNT)}, stale: {mounts: true}}),
    });
    assertEqual(lit.words.join(', '), '5 waiting on you, Swapping, Machine stale', 'words');
    assertEqual(Object.isFrozen(lit.words) && judged().words.length === 0, true, 'frozen, and none when quiet');
});

test('cockpitCaptions: the answer held is kept while the next lights the same captions with the same count and ' +
    'stale sources, so the mark and the line get the same lists; a change of any of the three hands out the next',
() => {
    const answerFor = ({blockedCount = 2, connectivity = 'full', stale = {}} = {}) => judged({
        sources: {sessions: sessionsSource(blockedCount), network: networkSource(connectivity)}, stale,
    });
    const held = answerFor();
    const isKept = next => keptCaptionsLit(held, next) === held;
    assertEqual({
        first: keptCaptionsLit(null, held) === held,
        same: isKept(answerFor()),
        count: isKept(answerFor({blockedCount: 3})),
        caption: isKept(answerFor({connectivity: 'none'})),
        staleSource: isKept(answerFor({stale: {mounts: true}})),
        staleSourceOnly: keptCaptionsLit(answerFor({stale: {mounts: true}}), answerFor({stale: {network: true}}))
            .staleSourceIds.join(','),
    }, {first: true, same: true, count: false, caption: false, staleSource: false, staleSourceOnly: 'network'});
});

test('cockpitCaptions: read from a client through its getters, its pull rule asked for each of its three sources; ' +
    'no client lights nothing', () => {
    const askedSourceNames = [];
    const client = {
        state: CockpitClientState.LIVE,
        sourcesByName: {...QUIET_SOURCES, sessions: sessionsSource(2)},
        sourceFreshness(sourceName) {
            askedSourceNames.push(sourceName);
            return {isStale: sourceName === CaptionSource.NETWORK, shouldPull: false, ageSeconds: 99};
        },
    };
    assertEqual(summary(cockpitCaptionsOf(client)), 'Waiting on you,Machine stale|2|network');
    assertEqual(askedSourceNames.join(','), 'sessions,network,mounts', 'asked');
    assertEqual(summary(cockpitCaptionsOf(null)), '|0|', 'no client');
});

/** The network source's bit in a client's stale mask: COCKPIT_SOURCE_NAMES lists sessions, network, mounts. */
const NETWORK_STALE_BIT = 0b010;

/**
 * A cockpit client as the follower reads it, counting each read: its state, its sources, its pull rule's verdicts
 * and its stale mask, each settable.
 *
 * @param {object} holding - What it holds.
 * @param {string} holding.state - Its CockpitClientState.
 * @param {object} [holding.sourcesByName] - Its sources.
 * @returns {{client: object, holding: object, reads: object}} The client, what it holds (change it in place) and
 *     the reads counted so far (zero them in place).
 */
function countingClient({state, sourcesByName = QUIET_SOURCES}) {
    const holding = {state, sourcesByName, staleSourceNames: [], staleSourceMask: 0};
    const reads = {states: 0, sources: 0, freshness: 0, masks: 0};
    const client = {
        get state() {
            reads.states++;
            return holding.state;
        },
        get sourcesByName() {
            reads.sources++;
            return holding.sourcesByName;
        },
        sourceFreshness(sourceName) {
            reads.freshness++;
            return {isStale: holding.staleSourceNames.includes(sourceName), shouldPull: false, ageSeconds: 1};
        },
        staleSourceMask() {
            reads.masks++;
            return holding.staleSourceMask;
        },
    };
    return {client, holding, reads};
}

/**
 * The reads counted, but the state's, then zeroed.
 *
 * @param {object} reads - countingClient's counts.
 * @returns {{sources: number, freshness: number, masks: number}} Them, before zeroing.
 */
function takeReads(reads) {
    const taken = {sources: reads.sources, freshness: reads.freshness, masks: reads.masks};
    Object.assign(reads, {states: 0, sources: 0, freshness: 0, masks: 0});
    return taken;
}

const NO_READS = Object.freeze({sources: 0, freshness: 0, masks: 0});

test('cockpitCaptions: a client neither live nor gone (starting, or no cockpit) lights nothing, read from its state ' +
    'alone; the follower reads nothing before its first judge, and for such a client neither its judge nor a ' +
    'Sample\'s follow reads anything but the state; gone, it is judged with no stale mask, and a Sample\'s follow ' +
    'reads none; neither follows the clock', () => {
    const skipped = countingClient({state: CockpitClientState.SKIPPED});
    const skippedCaptions = summary(cockpitCaptionsOf(skipped.client));
    const skippedReads = takeReads(skipped.reads);
    const starting = countingClient({state: CockpitClientState.STARTING});
    const follower = new CockpitCaptionsFollower(starting.client);
    const beforeTheFirstJudge = {captions: summary(follower.captions), states: starting.reads.states};
    follower.judge();
    follower.followClock();
    const startingReads = takeReads(starting.reads);
    const gone = countingClient({state: CockpitClientState.VANISHED, sourcesByName: {
        ...QUIET_SOURCES, sessions: sessionsSource(2),
    }});
    const goneFollower = new CockpitCaptionsFollower(gone.client);
    goneFollower.judge();
    const goneJudgeReads = takeReads(gone.reads);
    goneFollower.followClock();
    assertEqual({
        skippedCaptions, skippedReads, beforeTheFirstJudge, startingCaptions: summary(follower.captions),
        startingReads, goneCaptions: summary(goneFollower.captions), goneJudgeReads,
        goneFollowReads: takeReads(gone.reads),
        isClockFollowed: {starting: follower.isClockFollowed, gone: goneFollower.isClockFollowed},
    }, {
        skippedCaptions: '|0|', skippedReads: NO_READS, beforeTheFirstJudge: {captions: '|0|', states: 0},
        startingCaptions: '|0|', startingReads: NO_READS,
        goneCaptions: 'Machine stale,Agents stale|0|sessions,network,mounts',
        goneJudgeReads: {sources: 1, freshness: 3, masks: 0}, goneFollowReads: NO_READS,
        isClockFollowed: {starting: false, gone: false},
    });
});

test('cockpitCaptions: live, the follower follows the clock; its judge reads the stale mask, the sources and each ' +
    'verdict; a Sample\'s follow with the mask unchanged reads the mask alone and keeps the same answer, the same ' +
    'object; a mask the clock moved judges again; a judge that lights the same keeps the object', () => {
    const {client, holding, reads} = countingClient({state: CockpitClientState.LIVE, sourcesByName: {
        ...QUIET_SOURCES, sessions: sessionsSource(2),
    }});
    const follower = new CockpitCaptionsFollower(client);
    follower.judge();
    const firstJudgeReads = takeReads(reads);
    const firstAnswer = follower.captions;
    follower.followClock();
    follower.followClock();
    follower.followClock();
    const unchangedFollowReads = takeReads(reads);
    const isKeptWhileUnchanged = follower.captions === firstAnswer;
    holding.staleSourceNames = [CaptionSource.NETWORK];
    holding.staleSourceMask = NETWORK_STALE_BIT;
    follower.followClock();
    const movedFollowReads = takeReads(reads);
    const movedAnswer = follower.captions;
    follower.followClock();
    const followAfterTheMoveReads = takeReads(reads);
    follower.judge();
    assertEqual({
        firstJudgeReads, firstAnswer: summary(firstAnswer), unchangedFollowReads, isKeptWhileUnchanged,
        movedFollowReads, movedAnswer: summary(movedAnswer), followAfterTheMoveReads,
        isKeptByASameJudge: follower.captions === movedAnswer, isClockFollowed: follower.isClockFollowed,
    }, {
        firstJudgeReads: {sources: 1, freshness: 3, masks: 1}, firstAnswer: 'Waiting on you|2|',
        unchangedFollowReads: {sources: 0, freshness: 0, masks: 3}, isKeptWhileUnchanged: true,
        movedFollowReads: {sources: 1, freshness: 3, masks: 2},
        movedAnswer: 'Waiting on you,Machine stale|2|network',
        followAfterTheMoveReads: {sources: 0, freshness: 0, masks: 1}, isKeptByASameJudge: true,
        isClockFollowed: true,
    });
});
