// The order the cockpit draws sessions in: by urgency, the sessions waiting on you first. The cockpit service
// publishes its rows by memory, and keeps that order so that an older extension draws what it drew; the sessions card
// and the dropdown take their rows through here. Sessions fall into groups by state, as the guide's sessions card
// describes them; each group has an order of its own. Pure: no Gio, no GLib and no Shell import, so it runs under
// plain gjs, and total over any rows: a value that is not a finite number is not known.

/** The sessions' groups, from the most urgent: herdr's `blocked` is waiting on you; `done` is not yet seen. */
export const SESSION_GROUP_ORDER = Object.freeze(['blocked', 'working', 'done', 'idle', 'unknown']);
/** The groups whose sessions are ordered by memory, the largest first. */
const GROUPS_BY_LARGEST_MEMORY = Object.freeze(['working']);
/** The groups whose sessions are ordered by idle age, the longest first: how long each has waited. */
const GROUPS_BY_LONGEST_IDLE = Object.freeze(['blocked']);

/**
 * @param {*} state - A session's state.
 * @returns {number} Its group's place in SESSION_GROUP_ORDER; past the last for a state it does not list.
 */
function groupIndexOf(state) {
    const groupIndex = SESSION_GROUP_ORDER.indexOf(state);
    return groupIndex === -1 ? SESSION_GROUP_ORDER.length : groupIndex;
}

/**
 * @param {*} value - A row's cell.
 * @returns {number|null} The cell when it is a finite number; otherwise null, not known.
 */
function knownNumberOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

/**
 * The value a session is ordered by within its group, made so that a smaller one sorts first: the memory negated for a
 * group by largest memory, the idle age negated for a group by longest idle, else the idle age (the most recently
 * active first).
 *
 * @param {{state: *, idleSeconds: *, memoryBytes: *}} session - A session row.
 * @returns {number|null} The value; null when the session does not know the one cell its group is ordered by.
 */
function groupOrderValueOf(session) {
    if (GROUPS_BY_LARGEST_MEMORY.includes(session.state)) {
        const memoryBytes = knownNumberOrNull(session.memoryBytes);
        return memoryBytes == null ? null : -memoryBytes;
    }
    const idleSeconds = knownNumberOrNull(session.idleSeconds);
    if (idleSeconds == null)
        return null;
    return GROUPS_BY_LONGEST_IDLE.includes(session.state) ? -idleSeconds : idleSeconds;
}

/**
 * @param {*} name - A session's name.
 * @param {*} otherName - Another's.
 * @returns {number} Negative, zero or positive by plain string comparison, as the service breaks its own ties.
 */
function compareNames(name, otherName) {
    const nameText = String(name);
    const otherNameText = String(otherName);
    if (nameText === otherNameText)
        return 0;
    return nameText < otherNameText ? -1 : 1;
}

/**
 * @param {object} session - A session row.
 * @param {object} otherSession - Another session row.
 * @returns {number} Negative when `session` is the more urgent: the earlier group; within a group, by its value
 *     (groupOrderValueOf), a session whose value is not known last; then by name. Zero for a tie of names, which the
 *     stable sort leaves in the service's order.
 */
function compareByUrgency(session, otherSession) {
    const groupDifference = groupIndexOf(session.state) - groupIndexOf(otherSession.state);
    if (groupDifference !== 0)
        return groupDifference;
    const value = groupOrderValueOf(session);
    const otherValue = groupOrderValueOf(otherSession);
    const isValueKnown = value != null;
    if (isValueKnown !== (otherValue != null))
        return isValueKnown ? -1 : 1;
    if (isValueKnown && value !== otherValue)
        return value - otherValue;
    return compareNames(session.name, otherSession.name);
}

/**
 * Orders sessions by urgency: waiting on you, working, done, idle, then unknown. Waiting on you puts the longest idle
 * age first; working the largest memory first; done, idle and unknown the most recently active first. A session
 * missing the one value its group is ordered by (memory for working, idle age for the others) goes last in that group,
 * and ties are by name.
 *
 * @param {Array<{state: string, name: string, idleSeconds: number|null, memoryBytes: number|null}>} sessions - The
 *     sessions source's rows, in the service's order.
 * @returns {Array<object>} The same rows, in a new list, by urgency; the given list is left as it was.
 */
export function sessionsByUrgency(sessions) {
    return [...sessions].sort(compareByUrgency);
}
