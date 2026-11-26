// The gaps the client pushes for the ticks its sampler missed (pulseClient.js). The sampler writes a gap into every
// history for each tick that was due and did not run (a stall, or a suspend), and each Sample says how many came
// before its values (appendedHistory.missedTickCount). A client following live pushes the same gaps, so its
// histories stay as the sampler's: a stall or a suspend shows at its real width, at most a whole history.
//
// The client may have pushed a gap of its own for the same silence, when its stall watchdog fired: that gap stands for
// one of the missed ticks, so it is counted against them and no tick is counted twice. The client never times the
// silence itself: against a sampler that sends no count (one from before it), the count reads as none, and the
// client's own gap stays one slot wide, as it was.
// Pure: no Gio and no Shell import, so it runs under plain gjs.

/**
 * How many gaps to push before a Sample's values: the ticks it says were missed, at most a history's length, less the
 * gaps the client already pushed of its own since the last Sample it applied.
 *
 * @param {number|null} missedTickCount - The Sample's appendedHistory.missedTickCount; null (a sampler from before the
 *     count) is none.
 * @param {number} ownGapCountSinceLastSample - The gaps the client pushed of its own (no data shown) since it last
 *     applied a Sample that appended.
 * @param {number} historyCapacity - The values a history keeps: lib/constants.js's CARD_HISTORY_SAMPLES.
 * @returns {number} The gaps to push, zero or more.
 */
export function gapsToPushBefore(missedTickCount, ownGapCountSinceLastSample, historyCapacity) {
    const missedTicksKept = Math.min(missedTickCount ?? 0, historyCapacity);
    return Math.max(0, missedTicksKept - ownGapCountSinceLastSample);
}
