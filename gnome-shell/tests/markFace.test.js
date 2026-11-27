// lib/markFace.js: the top bar's mark is the disc with the waiting count, else the ring, else nothing; the count's
// words, two digits a size smaller, and 99 from 100.
import {test, assertEqual} from './harness.js';
import {
    DISC_COUNT_LIMIT, MarkKind, TWO_DIGIT_COUNT, isSameMarkFace, markFaceOf,
} from '../extensions/resource-pulse@zvibaratz.github.io/lib/markFace.js';

/**
 * A face as one line a row compares.
 *
 * @param {{kind: string, countText: string, isTwoDigitCount: boolean}} face - The face.
 * @returns {string} For example 'disc:5:one', 'ring::one'.
 */
function faceSummary(face) {
    const digits = face.isTwoDigitCount ? 'two' : 'one';
    return `${face.kind}:${face.countText}:${digits}`;
}

test('markFace: the disc while one or more sessions wait, whatever else is lit; else the ring while any caption is ' +
    'lit; else nothing', () => {
    const faces = [
        markFaceOf({isRingLit: true, waitingCount: 5}),
        markFaceOf({isRingLit: false, waitingCount: 1}),
        markFaceOf({isRingLit: true, waitingCount: 0}),
        markFaceOf({isRingLit: false, waitingCount: 0}),
    ];
    assertEqual(faces.map(faceSummary).join(' / '), 'disc:5:one / disc:1:one / ring::one / none::one');
});

test('markFace: the count as it is up to 99, two digits from 10, and 99 from 100 (the hover label and the line say ' +
    'the true count)', () => {
    const counts = [9, TWO_DIGIT_COUNT, 42, DISC_COUNT_LIMIT, DISC_COUNT_LIMIT + 1, 1234];
    const faces = counts.map(waitingCount => faceSummary(markFaceOf({isRingLit: true, waitingCount})));
    assertEqual(faces.join(' / '), 'disc:9:one / disc:10:two / disc:42:two / disc:99:two / disc:99:two / disc:99:two');
});

test('markFace: a count that is not a whole number of 1 or more is none', () => {
    const counts = [0, -3, 2.5, Number.NaN, null, undefined, '5'];
    const faces = counts.map(waitingCount => markFaceOf({isRingLit: true, waitingCount}).kind);
    assertEqual(faces.join(','), Array(counts.length).fill(MarkKind.RING).join(','));
});

test('markFace: a face is frozen, the ring and nothing are each one face, and two faces are the same while their ' +
    'kind and words are', () => {
    const disc = markFaceOf({isRingLit: true, waitingCount: 5});
    assertEqual({
        isFrozen: Object.isFrozen(disc),
        isOneRing: markFaceOf({isRingLit: true, waitingCount: 0}) === markFaceOf({isRingLit: true, waitingCount: 0}),
        isOneNothing: markFaceOf({isRingLit: false, waitingCount: 0}) ===
            markFaceOf({isRingLit: false, waitingCount: 0}),
        sameCount: isSameMarkFace(disc, markFaceOf({isRingLit: false, waitingCount: 5})),
        otherCount: isSameMarkFace(disc, markFaceOf({isRingLit: true, waitingCount: 6})),
        overTheLimit: isSameMarkFace(markFaceOf({isRingLit: true, waitingCount: 100}),
            markFaceOf({isRingLit: true, waitingCount: 101})),
        otherKind: isSameMarkFace(disc, markFaceOf({isRingLit: true, waitingCount: 0})),
        beforeTheFirst: isSameMarkFace(null, disc),
    }, {
        isFrozen: true, isOneRing: true, isOneNothing: true, sameCount: true, otherCount: false, overTheLimit: true,
        otherKind: false, beforeTheFirst: false,
    });
});
