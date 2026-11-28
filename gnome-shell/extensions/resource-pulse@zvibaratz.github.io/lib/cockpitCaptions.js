// The cockpit's captions, beside the machine's (lib/machineCaptions.js), and the one order every surface names them
// in: the top bar's mark, its hover label and the dropdown's first line.
//
// - "N waiting on you" is lit while the sessions source counts a blocked session, and carries the count; no hold, it
//   follows the count.
// - Offline is lit while the network source's uplink says no connectivity (`unknown` and no reading light nothing).
// - Mount is lit while a mount is at fault (lib/mountFaults.js isMountSizeFault: its size query failed or did not
//   answer, a local disk's too, never an automount point's).
// - Agents stale is lit for the sessions source, and Machine stale for the network or the mounts source, once that
//   source has answered and then stopped: stale by the client's pull rule (lib/cockpitStaleness.js, which can call a
//   source stale only after a pull, and so only while the cockpit is seen), or the service gone. A source that never
//   answered (no stamp) lights nothing, its own caption included, so nothing is lit before the first answer. A stale
//   source's own caption goes out: what it last said is no longer known, as its card says. The service gone ends the
//   count.
//
// No caption here is held: only pressure and swap are (lib/machineCaptions.js). Each is judged from what the cockpit
// client holds, covered or not, since the client hears every Changed while enabled: at each of the client's events,
// which bring every change of it, and at a Sample only once a source's stale verdict moved with the clock alone
// (CockpitCaptionsFollower), so a Sample with nothing changed reads the client's state and, while it is live, one
// stale mask, allocating nothing.
//
// The indicator joins the two halves (litCaptionsOf) whenever either changed, and keeps the answer it has while the
// next lights the same (keptCaptionsLit), so the mark and the line touch an actor only when a caption lights or
// unlights, or the count changes.
//
// Pure: no Shell, St, Clutter or GLib import, so it runs under plain gjs. cockpitCaptionsOf and the follower only read
// the client they are given, through its getters and methods.
import {CockpitClientState} from './constants.js';
import {MachineCaption} from './machineCaptions.js';
import {isMountSizeFault} from './mountFaults.js';

/**
 * The cockpit's captions, by id. The waiting caption's words carry its count (captionWords); every other caption's
 * words are its id.
 */
export const CockpitCaption = Object.freeze({
    WAITING: 'Waiting on you',
    OFFLINE: 'Offline',
    MOUNT: 'Mount',
    AGENTS_STALE: 'Agents stale',
});

/**
 * Every caption, the machine's and the cockpit's, in the one order the hover label, the dropdown's line and any other
 * surface name them: the waiting caption first, then the machine's waits and Swapping, then Offline, Mount and the
 * two Stale captions.
 */
export const CAPTION_ORDER = Object.freeze([
    CockpitCaption.WAITING,
    MachineCaption.CPU_WAIT,
    MachineCaption.MEM_WAIT,
    MachineCaption.IO_WAIT,
    MachineCaption.SWAPPING,
    CockpitCaption.OFFLINE,
    CockpitCaption.MOUNT,
    MachineCaption.MACHINE_STALE,
    CockpitCaption.AGENTS_STALE,
]);

/** The sources a Stale caption may stand for, by id: the sampler (Machine stale's own half) and the cockpit's three. */
export const CaptionSource = Object.freeze({
    SAMPLER: 'sampler',
    SESSIONS: 'sessions',
    NETWORK: 'network',
    MOUNTS: 'mounts',
});

/** The sources in the order staleSourceIds lists them. */
const CAPTION_SOURCE_ORDER = Object.freeze(Object.values(CaptionSource));

/** Each cockpit source, with the caption that stands for it once it is stale, in the client's source order. */
const COCKPIT_SOURCE_STALE_CAPTIONS = Object.freeze([
    {sourceName: CaptionSource.SESSIONS, staleCaption: CockpitCaption.AGENTS_STALE},
    {sourceName: CaptionSource.NETWORK, staleCaption: MachineCaption.MACHINE_STALE},
    {sourceName: CaptionSource.MOUNTS, staleCaption: MachineCaption.MACHINE_STALE},
]);

/** The network source's connectivity that lights Offline: NetworkManager's "none". */
const OFFLINE_CONNECTIVITY = 'none';
/** The waiting caption's words after its count. */
const WAITING_WORDS_AFTER_COUNT = 'waiting on you';

/** Nothing lit and nothing stale: one frozen answer, so a quiet cockpit always gives the same one. */
const NO_CAPTIONS = Object.freeze({
    captions: Object.freeze([]), words: Object.freeze([]), waitingCount: 0, staleSourceIds: Object.freeze([]),
});

/**
 * @typedef {object} CaptionsLit
 * @property {readonly string[]} captions - The lit captions' ids, each once, in CAPTION_ORDER.
 * @property {readonly string[]} words - Their words (captionWords), in the same order: what the hover label and the
 *     dropdown's line say.
 * @property {number} waitingCount - How many sessions wait on you; 0 unless the waiting caption is lit.
 * @property {readonly string[]} staleSourceIds - The sources a lit Stale caption stands for, in CaptionSource's
 *     order; empty when none is stale.
 */

/**
 * Whether a source has answered: it carries a stamp. One that never did lights no Stale caption.
 *
 * @param {{sampledAtUsec?: number|null}|null|undefined} source - The source as the client holds it.
 * @returns {boolean} True when it carries a finite stamp.
 */
function hasAnswered(source) {
    return Number.isFinite(source?.sampledAtUsec);
}

/**
 * Freezes an answer, with its captions' words, or gives NO_CAPTIONS when nothing is lit.
 *
 * @param {string[]} captions - The lit captions' ids, in CAPTION_ORDER.
 * @param {number} waitingCount - The waiting count, or 0.
 * @param {string[]} staleSourceIds - The stale sources' ids, in CaptionSource's order.
 * @returns {CaptionsLit} The answer.
 */
function frozenCaptions(captions, waitingCount, staleSourceIds) {
    if (captions.length === 0)
        return NO_CAPTIONS;
    const words = captions.map(caption => captionWords(caption, waitingCount));
    return Object.freeze({
        captions: Object.freeze(captions), words: Object.freeze(words), waitingCount,
        staleSourceIds: Object.freeze(staleSourceIds),
    });
}

/**
 * Whether two lists hold the same ids in the same order.
 *
 * @param {readonly string[]} first - One list.
 * @param {readonly string[]} second - The other.
 * @returns {boolean} True when they are the same.
 */
function isSameList(first, second) {
    return first.length === second.length && first.every((item, index) => item === second[index]);
}

/**
 * The given ids that are lit, in CAPTION_ORDER, each once.
 *
 * @param {Set<string>} litCaptionIds - The lit ids.
 * @returns {string[]} Them, in order.
 */
function inCaptionOrder(litCaptionIds) {
    return CAPTION_ORDER.filter(caption => litCaptionIds.has(caption));
}

/**
 * The cockpit's half of the captions, from what its client holds: the client's state, its sources, and which of
 * them its pull rule calls stale.
 *
 * @param {object} reading - What the cockpit client holds.
 * @param {string} reading.clientState - Its CockpitClientState.
 * @param {{sessions?: object|null, network?: object|null, mounts?: object|null}} reading.sourcesByName - Its sources,
 *     as lib/cockpitProtocol.js reads them.
 * @param {Object<string, boolean>} reading.isStaleBySourceName - Whether its pull rule calls each source stale.
 * @returns {CaptionsLit} The cockpit's lit captions, its waiting count and its stale sources.
 */
export function judgeCockpitCaptions({clientState, sourcesByName, isStaleBySourceName}) {
    const isServiceGone = clientState === CockpitClientState.VANISHED;
    if (clientState !== CockpitClientState.LIVE && !isServiceGone)
        return NO_CAPTIONS;
    const litCaptionIds = new Set();
    const staleSourceNames = new Set();
    // A source's own caption is read only from one that answered and is not stale: what its card draws as live.
    const liveSourceNames = new Set();
    for (const {sourceName, staleCaption} of COCKPIT_SOURCE_STALE_CAPTIONS) {
        if (!hasAnswered(sourcesByName[sourceName]))
            continue;
        const isStale = isServiceGone || isStaleBySourceName[sourceName] === true;
        if (isStale) {
            litCaptionIds.add(staleCaption);
            staleSourceNames.add(sourceName);
        } else {
            liveSourceNames.add(sourceName);
        }
    }
    // With the service gone every source that answered is stale, so none is live and no own caption lights.
    let waitingCount = 0;
    const isFresh = sourceName => liveSourceNames.has(sourceName);
    const blockedCount = sourcesByName.sessions?.counts?.blocked ?? 0;
    if (isFresh(CaptionSource.SESSIONS) && blockedCount >= 1) {
        litCaptionIds.add(CockpitCaption.WAITING);
        waitingCount = blockedCount;
    }
    const connectivity = sourcesByName.network?.uplink?.connectivity ?? null;
    if (isFresh(CaptionSource.NETWORK) && connectivity === OFFLINE_CONNECTIVITY)
        litCaptionIds.add(CockpitCaption.OFFLINE);
    const mountRows = sourcesByName.mounts?.rows ?? [];
    if (isFresh(CaptionSource.MOUNTS) && mountRows.some(mountRow => isMountSizeFault(mountRow)))
        litCaptionIds.add(CockpitCaption.MOUNT);
    const staleSourceIds = CAPTION_SOURCE_ORDER.filter(sourceId => staleSourceNames.has(sourceId));
    return frozenCaptions(inCaptionOrder(litCaptionIds), waitingCount, staleSourceIds);
}

/**
 * The cockpit's half of the captions, read from its client now: its state, its sources, and its pull rule's verdict
 * on each (cockpitClient.js sourceFreshness). No client, nothing lit; and a client neither live nor gone (no cockpit,
 * or one not yet answered) lights nothing, read from its state alone.
 *
 * @param {{state: string, sourcesByName: object, sourceFreshness: (sourceName: string) => {isStale: boolean}}|null|
 *     undefined} cockpitClient - The cockpit client, or none.
 * @returns {CaptionsLit} The cockpit's lit captions, its waiting count and its stale sources.
 */
export function cockpitCaptionsOf(cockpitClient) {
    if (cockpitClient === null || cockpitClient === undefined)
        return NO_CAPTIONS;
    const clientState = cockpitClient.state;
    if (clientState !== CockpitClientState.LIVE && clientState !== CockpitClientState.VANISHED)
        return NO_CAPTIONS;
    const isStaleBySourceName = Object.fromEntries(COCKPIT_SOURCE_STALE_CAPTIONS.map(({sourceName}) =>
        [sourceName, cockpitClient.sourceFreshness(sourceName).isStale]));
    return judgeCockpitCaptions({clientState, sourcesByName: cockpitClient.sourcesByName, isStaleBySourceName});
}

/**
 * Whether a client's stale verdicts can move with the clock alone: only while it is live. Gone, every source that
 * answered is stale whatever the clock says; in any other state nothing is lit.
 *
 * @param {{state: string}|null|undefined} cockpitClient - The cockpit client, or none.
 * @returns {boolean} True while the client is live.
 */
function isClockFollowed(cockpitClient) {
    return cockpitClient !== null && cockpitClient !== undefined && cockpitClient.state === CockpitClientState.LIVE;
}

/**
 * Follows the cockpit's half of the captions for the indicator. It is judged again at each of the client's events
 * (judge), which bring every change of it, and at a Sample only once a source's stale verdict moved with the clock
 * alone (followClock): after the wall clock steps back, a source the client calls stale can read fresh, and later
 * stale again, with nothing told. So a Sample with nothing changed reads the client's state and, while it is live,
 * one stale mask (cockpitClient.js staleSourceMask), which copies and allocates nothing. An answer the same as the
 * one held is not taken (keptCaptionsLit), so the indicator sees the same object while nothing changed. Nothing is
 * read before the first judge.
 */
export class CockpitCaptionsFollower {
    /**
     * @param {{state: string, sourcesByName: object, sourceFreshness: function, staleSourceMask: function}|null|
     *     undefined} cockpitClient - The cockpit client, or none.
     */
    constructor(cockpitClient) {
        this._cockpitClient = cockpitClient;
        this._captions = NO_CAPTIONS;
        // The stale mask the answer was judged with, while the client was live; null otherwise.
        this._judgedStaleSourceMask = null;
    }

    /** @returns {CaptionsLit} The cockpit's half as last judged: nothing lit before the first judge. */
    get captions() {
        return this._captions;
    }

    /**
     * Whether a Sample can find work here (followClock): only while the client is live. A plain read of its state,
     * so a caller asks first and makes nothing for a Sample with no live cockpit.
     *
     * @returns {boolean} True while the client is live.
     */
    get isClockFollowed() {
        return isClockFollowed(this._cockpitClient);
    }

    /**
     * Judges the cockpit's half again from what the client holds now (cockpitCaptionsOf), the stale mask read first
     * so a verdict that moves between the two is judged again at the next Sample.
     *
     * @returns {void}
     */
    judge() {
        const cockpitClient = this._cockpitClient;
        this._judgedStaleSourceMask = isClockFollowed(cockpitClient) ? cockpitClient.staleSourceMask() : null;
        this._captions = keptCaptionsLit(this._captions, cockpitCaptionsOf(cockpitClient));
    }

    /**
     * At a Sample: judges again only while the client is live and its stale mask differs from the one judged with.
     *
     * @returns {void}
     */
    followClock() {
        const cockpitClient = this._cockpitClient;
        if (!isClockFollowed(cockpitClient) || cockpitClient.staleSourceMask() === this._judgedStaleSourceMask)
            return;
        this.judge();
    }
}

/**
 * Every lit caption, the machine's and the cockpit's, each once and in CAPTION_ORDER (Machine stale once, whichever
 * half lit it), with the waiting count and the stale sources: the sampler while the machine's half lights Machine
 * stale, and the cockpit's own.
 *
 * @param {object} halves - The two halves.
 * @param {readonly string[]} halves.machineCaptions - The machine's lit captions (lib/machineCaptions.js).
 * @param {CaptionsLit} halves.cockpitCaptions - The cockpit's (judgeCockpitCaptions).
 * @returns {CaptionsLit} All of them.
 */
export function litCaptionsOf({machineCaptions, cockpitCaptions}) {
    const litCaptionIds = new Set([...machineCaptions, ...cockpitCaptions.captions]);
    const staleSourceNames = new Set(cockpitCaptions.staleSourceIds);
    if (machineCaptions.includes(MachineCaption.MACHINE_STALE))
        staleSourceNames.add(CaptionSource.SAMPLER);
    const staleSourceIds = CAPTION_SOURCE_ORDER.filter(sourceId => staleSourceNames.has(sourceId));
    return frozenCaptions(inCaptionOrder(litCaptionIds), cockpitCaptions.waitingCount, staleSourceIds);
}

/**
 * A caption's words: the waiting caption's carry the count ("3 waiting on you"); every other caption's are its id.
 *
 * @param {string} caption - The caption's id.
 * @param {number} waitingCount - How many sessions wait on you.
 * @returns {string} Its words.
 */
export function captionWords(caption, waitingCount) {
    if (caption === CockpitCaption.WAITING)
        return `${waitingCount} ${WAITING_WORDS_AFTER_COUNT}`;
    return caption;
}

/**
 * The answer to keep: the one held while the next lights the same captions with the same count and names the same
 * stale sources, else the next. Kept, the same lists reach the mark and the line, which then touch no actor.
 *
 * @param {CaptionsLit|null} previousCaptions - The answer held, or null before the first.
 * @param {CaptionsLit} nextCaptions - The answer just judged.
 * @returns {CaptionsLit} previousCaptions when nothing changed, else nextCaptions.
 */
export function keptCaptionsLit(previousCaptions, nextCaptions) {
    if (previousCaptions === null)
        return nextCaptions;
    const isUnchanged = previousCaptions.waitingCount === nextCaptions.waitingCount &&
        isSameList(previousCaptions.captions, nextCaptions.captions) &&
        isSameList(previousCaptions.staleSourceIds, nextCaptions.staleSourceIds);
    return isUnchanged ? previousCaptions : nextCaptions;
}
