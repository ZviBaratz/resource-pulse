// The order the cockpit draws sessions in: by urgency, the sessions waiting on you first. The cockpit service
// publishes its rows by memory, and keeps that order so that an older extension draws what it drew; the sessions card
// and the dropdown take their rows through here. Pure: no Gio, no GLib and no Shell import, so it runs under plain
// gjs.

/** The sessions' bays, from the most urgent: herdr's `blocked` is waiting on you; `done` is not yet seen. */
export const SESSION_BAY_ORDER = Object.freeze(['blocked', 'working', 'done', 'idle', 'unknown']);
/** The bays whose sessions are ordered by memory, the largest first. */
const BAYS_BY_LARGEST_MEMORY = Object.freeze(['working']);
/** The bays whose sessions are ordered by idle age, the longest first: how long each has waited. */
const BAYS_BY_LONGEST_IDLE = Object.freeze(['blocked']);

/**
 * @param {string} state - A session's state.
 * @returns {number} Its bay's place in SESSION_BAY_ORDER; past the last for a state it does not list.
 */
function bayIndexOf(state) {
    const bayIndex = SESSION_BAY_ORDER.indexOf(state);
    return bayIndex === -1 ? SESSION_BAY_ORDER.length : bayIndex;
}

/**
 * The value a session is ordered by within its bay, made so that a smaller one sorts first: the memory negated for a
 * bay by largest memory, the idle age negated for a bay by longest idle, else the idle age (the most recently active
 * first).
 *
 * @param {{state: string, idleSeconds: number|null, memoryBytes: number|null}} session - A session row.
 * @returns {number|null} The value; null when the session's bay orders by a cell it does not know.
 */
function bayOrderValueOf(session) {
    if (BAYS_BY_LARGEST_MEMORY.includes(session.state))
        return session.memoryBytes === null ? null : -session.memoryBytes;
    if (session.idleSeconds === null)
        return null;
    return BAYS_BY_LONGEST_IDLE.includes(session.state) ? -session.idleSeconds : session.idleSeconds;
}

/**
 * @param {string} name - A session's name.
 * @param {string} otherName - Another's.
 * @returns {number} Negative, zero or positive by plain string comparison, as the service breaks its own ties.
 */
function compareNames(name, otherName) {
    if (name === otherName)
        return 0;
    return name < otherName ? -1 : 1;
}

/**
 * @param {object} session - A session row.
 * @param {object} otherSession - Another session row.
 * @returns {number} Negative when `session` is the more urgent: the earlier bay; within a bay, by its value
 *     (bayOrderValueOf), a session whose value is not known last; then by name. Zero for a tie of names, which the
 *     stable sort leaves in the service's order.
 */
function compareByUrgency(session, otherSession) {
    const bayDifference = bayIndexOf(session.state) - bayIndexOf(otherSession.state);
    if (bayDifference !== 0)
        return bayDifference;
    const value = bayOrderValueOf(session);
    const otherValue = bayOrderValueOf(otherSession);
    const isValueKnown = value !== null;
    if (isValueKnown !== (otherValue !== null))
        return isValueKnown ? -1 : 1;
    if (isValueKnown && value !== otherValue)
        return value - otherValue;
    return compareNames(session.name, otherSession.name);
}

/**
 * Orders sessions by urgency: waiting on you, working, done, idle, then unknown. Waiting on you puts the longest idle
 * age first; working the largest memory first; done, idle and unknown the most recently active first. A session with
 * no known value for its bay's order goes last in that bay, and ties are by name.
 *
 * @param {Array<{state: string, name: string, idleSeconds: number|null, memoryBytes: number|null}>} sessions - The
 *     sessions source's rows, in the service's order.
 * @returns {Array<object>} The same rows, in a new list, by urgency; the given list is left as it was.
 */
export function sessionsByUrgency(sessions) {
    return [...sessions].sort(compareByUrgency);
}
