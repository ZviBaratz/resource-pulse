// The test double's side of the conformance exchange (conformanceExchange.js, whose header says what the exchange is
// and what is compared): the double (serviceDouble.js), exported on a connection of its own, serves a fake sampler that
// publishes the program's own Samples in the order the program sent them, and the exchange is put to it as it was to
// the program. It registers no rows.
import {openPrivateBusConnection} from './privateBus.js';
import {closeConnection} from './busCalls.js';
import {
    ENTRY_KIND_REPLY, SAMPLE_KIND_REVEAL, SAMPLE_KIND_TICK, awaitNextTickSample, runConformanceExchange, sampleKind,
    startTranscript,
} from './conformanceExchange.js';
import {FakeSampler} from './fakeSampler.js';
import {ResourcePulseServiceDouble} from './serviceDouble.js';
import {GET_STATE_METHOD_NAME, parseSamplePayload} from '../extensions/resource-pulse@zvibaratz.github.io/lib/protocol.js';

/** What a failing step of the exchange names the double's side as. */
const DOUBLE_SIDE_LABEL = 'the test double';

/**
 * The fake sampler the double serves in the exchange. It publishes the program's own Samples, each parsed back as a
 * client reads it (parseSamplePayload), in the order the program sent them: a tick's when the exchange asks the
 * double's side for a tick, and a reveal's when the double tells it a watch is now held, as the program reveals on a
 * watch start before it answers the call. Its histories are FakeSampler's, kept as the program keeps its own.
 */
class ProgramReplaySampler extends FakeSampler {
    /**
     * @param {string[]} programSampleTexts - Every Sample the program sent, in the order it sent them.
     * @throws {Error} When one is not a JSON object.
     */
    constructor(programSampleTexts) {
        super();
        this._programSamples = programSampleTexts.map((sampleText, index) => {
            const sample = parseSamplePayload(sampleText);
            if (sample === null)
                throw new Error(`the program's Sample number ${index + 1} is not a JSON object`);
            return sample;
        });
        this._nextSampleIndex = 0;
        /** The program's Sample being published now; null between publishes. */
        this._sampleInFlight = null;
    }

    /**
     * The real time the program's Sample being published now carried: the double's clock, so that each Sample it sends
     * carries the time the program's did.
     *
     * @returns {number|null} That Sample's sampledAtUsec, as parsed.
     * @throws {Error} When no Sample is being published: the double asked the time for something else.
     */
    sampledAtUsecInFlight() {
        if (this._sampleInFlight === null)
            throw new Error('the double asked for the real time outside a publish');
        return this._sampleInFlight.sampledAtUsec;
    }

    /**
     * Publishes the program's next Sample, which must be a tick's.
     *
     * @returns {void}
     * @throws {Error} When the program sent no further Sample, or its next one is a reveal.
     */
    publishNextTick() {
        this._publishNextSample(SAMPLE_KIND_TICK);
    }

    /**
     * Records the call, as FakeSampler does, and on a watch start publishes the program's next Sample, which must be a
     * reveal's.
     *
     * @param {boolean} isWatched - True while any client holds a watch.
     * @returns {void}
     * @throws {Error} On a watch start, when the program sent no further Sample, or its next one is a tick.
     */
    setDetailWatched(isWatched) {
        super.setDetailWatched(isWatched);
        if (isWatched)
            this._publishNextSample(SAMPLE_KIND_REVEAL);
    }

    /**
     * Publishes the program's next Sample, its real time held for the double's clock meanwhile.
     *
     * @param {string} expectedKind - SAMPLE_KIND_TICK or SAMPLE_KIND_REVEAL.
     * @returns {void}
     * @throws {Error} When the program sent no further Sample, or its next one is of the other kind.
     */
    _publishNextSample(expectedKind) {
        const sampleNumber = this._nextSampleIndex + 1;
        const sample = this._programSamples[this._nextSampleIndex];
        if (sample === undefined)
            throw new Error(`the program sent no Sample number ${sampleNumber} to publish as a ${expectedKind}`);
        const kind = sampleKind(sample);
        if (kind !== expectedKind)
            throw new Error(`the program's Sample number ${sampleNumber} is a ${kind}, not a ${expectedKind}`);
        this._nextSampleIndex++;
        this._sampleInFlight = sample;
        try {
            this.publish(sample.snapshot, sample.appendedHistory);
        } finally {
            this._sampleInFlight = null;
        }
    }
}

/**
 * The state a transcript's first GetState reply carried.
 *
 * @param {object[]} entries - A transcript.
 * @returns {object} The parsed state.
 * @throws {Error} When the transcript has no GetState reply, or one that did not parse.
 */
function firstStateOf(entries) {
    const firstState = entries.find(
        entry => entry.kind === ENTRY_KIND_REPLY && entry.call === GET_STATE_METHOD_NAME)?.value;
    if (!firstState)
        throw new Error(`the transcript has no parsed ${GET_STATE_METHOD_NAME} reply`);
    return firstState;
}

/**
 * Runs the exchange against the test double, exported on a connection of its own for a ProgramReplaySampler of the
 * program's Samples, with the program's start time and each Sample's real time, and takes it all down.
 *
 * @param {{entries: object[], sampleTexts: string[]}} programResult - runConformanceExchange's result for the program.
 * @returns {Promise<object>} runConformanceExchange's result, with every line the double logged.
 */
export async function runExchangeAgainstDouble(programResult) {
    const sampler = new ProgramReplaySampler(programResult.sampleTexts);
    const logLines = [];
    const serviceConnection = openPrivateBusConnection();
    const clientConnection = openPrivateBusConnection();
    let double = null;
    let recording = null;
    try {
        double = new ResourcePulseServiceDouble(sampler, serviceConnection, {
            serviceStartedAtUsec: firstStateOf(programResult.entries).serviceStartedAtUsec,
            nowRealUsec: () => sampler.sampledAtUsecInFlight(),
            logWriter: line => logLines.push(line),
        });
        const doubleName = serviceConnection.get_unique_name();
        recording = await startTranscript(clientConnection, doubleName);
        // The double's first tick comes once its transcript has started, as the program's did.
        sampler.publishNextTick();
        const result = await runConformanceExchange({
            label: DOUBLE_SIDE_LABEL,
            destination: doubleName,
            clientConnection,
            recording,
            produceTick: () => {
                sampler.publishNextTick();
                return awaitNextTickSample(recording);
            },
        });
        return {...result, logLines};
    } finally {
        recording?.stop();
        double?.destroy();
        for (const connection of [clientConnection, serviceConnection])
            await closeConnection(connection);
    }
}
