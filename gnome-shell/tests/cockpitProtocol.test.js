// lib/cockpitProtocol.js: the names and the interface of Cockpit1, the JSON its builders write and its skew-tolerant
// parsers read. Every builder runs each source and the layout through the reader the parser uses, so a field no reader
// lists never leaves the service.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as cockpitProtocol from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitProtocol.js';
import {connectionsRows, sessionRows} from '../extensions/resource-pulse@zvibaratz.github.io/lib/cockpitFormat.js';
import {sessionsByUrgency} from '../extensions/resource-pulse@zvibaratz.github.io/lib/sessionOrder.js';

/** The length past which a session name counts as long, in the desk shape the nested fixture copies (characters). */
const DESK_LONG_NAME_THRESHOLD_CHARS = 24;

/**
 * A state with every field set to a value its reader accepts, in the order the parser lists the fields: two session
 * rows of different states, counts for every state, one mount of each kind, and a config error beside a layout.
 */
const FULL_STATE = {
    serviceStartedAtUsec: 1_794_000_000_000_000,
    latestPublishedAtUsec: 1_794_000_004_000_000,
    layout: {
        monitor: {vendor: 'ACM', product: 'ACME Display 27'},
        groups: [
            {id: 'machine', caption: 'MACHINE', columns: 2, cards: ['system', 'apps']},
            {id: 'agents', caption: 'AGENTS', columns: 1, cards: ['sessions']},
        ],
    },
    configError: "groups[2].cards[0]: unknown card id 'weather'",
    sources: {
        sessions: {
            sampledAtUsec: 1_794_000_003_000_000,
            intervalSeconds: 5,
            herdrRunning: true,
            totalMemoryBytes: 4_000_000_000,
            counts: {working: 1, blocked: 1, idle: 0, done: 0, unknown: 0},
            rows: [
                {
                    id: 'w1:p1', name: 'home-sync', state: 'working', idleSeconds: 12, idleFromProcessAge: false,
                    memoryBytes: 3_000_000_000, workspaceId: 'w1', paneId: 'p1', account: 'account-a',
                    contextPercent: 42, stateHistory: 'iiiiwwwwww',
                },
                {
                    id: 'w2:p3', name: 'user/cockpit', state: 'blocked', idleSeconds: 600, idleFromProcessAge: true,
                    memoryBytes: 1_000_000_000, workspaceId: 'w2', paneId: 'p3', account: 'account-b',
                    contextPercent: 7.5, stateHistory: `${'w'.repeat(50)}bbbbbbbbbb`,
                },
            ],
        },
        network: {
            sampledAtUsec: 1_794_000_003_500_000,
            intervalSeconds: 10,
            uplink: {kind: 'wired', connectivity: 'full', wifiEnabled: false},
            vpn: {isUp: true, interfaceName: 'tun0'},
            sshMasterCount: 2,
        },
        mounts: {
            sampledAtUsec: 1_794_000_002_000_000,
            intervalSeconds: 30,
            rows: [
                {
                    mountPoint: '/', label: 'Filesystem root', kind: 'local', filesystemType: 'ext4',
                    freeBytes: 180_000_000_000, totalBytes: 500_000_000_000, noSizesReason: null,
                },
                {
                    mountPoint: '/media/user/DATA', label: 'DATA', kind: 'removable', filesystemType: 'ext4',
                    freeBytes: 500_000_000_000, totalBytes: 2_000_000_000_000, noSizesReason: null,
                },
                {
                    mountPoint: '/mnt/share', label: 'share', kind: 'network', filesystemType: 'cifs', freeBytes: null,
                    totalBytes: null, noSizesReason: 'no-answer',
                },
            ],
        },
    },
};
/** One field name no reader lists per object level of a state; withUnlistedFieldAtEveryLevel plants each. */
const UNLISTED_FIELD_NAME_BY_LEVEL = {
    state: 'unlistedInState',
    layout: 'unlistedInLayout',
    monitor: 'unlistedInMonitor',
    layoutGroup: 'unlistedInLayoutGroup',
    sources: 'unlistedInSources',
    sessions: 'unlistedInSessions',
    counts: 'unlistedInCounts',
    sessionRow: 'unlistedInSessionRow',
    network: 'unlistedInNetwork',
    uplink: 'unlistedInUplink',
    vpn: 'unlistedInVpn',
    mounts: 'unlistedInMounts',
    mountRow: 'unlistedInMountRow',
};
const UNLISTED_FIELD_NAMES = Object.values(UNLISTED_FIELD_NAME_BY_LEVEL);
/** The field no reader lists, planted in a FocusSession reply. */
const UNLISTED_REPLY_FIELD_NAME = 'unlistedInReply';
/** herdr's own text for a pane that is gone: what a FocusSession reply's error must never carry. */
const HERDR_FREE_TEXT_ERROR = 'herdr: pane_not_found: pane not found';
/** The readers' caps, written out rather than imported, so a changed constant fails here instead of moving with it. */
const ID_MAX_CHARS = 128;
const PATH_MAX_CHARS = 1024;
/** The most window candidates a FocusSession reply carries, written out as the caps above are. */
const WINDOW_PID_CANDIDATES_MAX = 64;
/** A character outside the Basic Multilingual Plane: one code point, two UTF-16 code units. */
const WIDE_CHARACTER = '\u{1F642}';

/**
 * A copy of a state with one unlisted field planted at every object level: the state, the layout, its monitor and
 * each group, the sources object, each source, the session counts, each session row, the uplink, the VPN tunnel and
 * each mount row.
 *
 * @param {object} state - A state shaped as FULL_STATE.
 * @returns {object} The copy.
 */
function withUnlistedFieldAtEveryLevel(state) {
    const unlistedField = level => ({[UNLISTED_FIELD_NAME_BY_LEVEL[level]]: 'leaked'});
    const {layout, sources: {sessions, network, mounts}} = state;
    return {
        ...state, ...unlistedField('state'),
        layout: {
            ...layout, ...unlistedField('layout'),
            monitor: {...layout.monitor, ...unlistedField('monitor')},
            groups: layout.groups.map(group => ({...group, ...unlistedField('layoutGroup')})),
        },
        sources: {
            ...unlistedField('sources'),
            sessions: {
                ...sessions, ...unlistedField('sessions'),
                counts: {...sessions.counts, ...unlistedField('counts')},
                rows: sessions.rows.map(row => ({...row, ...unlistedField('sessionRow')})),
            },
            network: {
                ...network, ...unlistedField('network'),
                uplink: {...network.uplink, ...unlistedField('uplink')},
                vpn: {...network.vpn, ...unlistedField('vpn')},
            },
            mounts: {
                ...mounts, ...unlistedField('mounts'),
                rows: mounts.rows.map(row => ({...row, ...unlistedField('mountRow')})),
            },
        },
    };
}

/**
 * The planted unlisted field names a text holds.
 *
 * @param {string} text - Built JSON.
 * @returns {string[]} Those of UNLISTED_FIELD_NAMES found in it, in their order.
 */
function unlistedFieldNamesIn(text) {
    return UNLISTED_FIELD_NAMES.filter(fieldName => text.includes(fieldName));
}

/**
 * @param {string} relativePath - A path under gnome-shell/tests/fixtures/cockpit.
 * @returns {string} The file's text.
 */
function readFixture(relativePath) {
    const fixtureDirectoryUri = GLib.uri_resolve_relative(import.meta.url, 'fixtures/cockpit/', GLib.UriFlags.NONE);
    const [fixtureDirectory] = GLib.filename_from_uri(fixtureDirectoryUri);
    const path = GLib.build_filenamev([fixtureDirectory, relativePath]);
    const [, contentBytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(contentBytes);
}

test('cockpitProtocol: the names and the interface', () => {
    assertEqual(cockpitProtocol.COCKPIT_BUS_NAME, 'io.github.zvibaratz.ResourcePulse.Cockpit1');
    assertEqual(cockpitProtocol.COCKPIT_OBJECT_PATH, '/io/github/zvibaratz/ResourcePulse/Cockpit1');
    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(cockpitProtocol.COCKPIT_INTERFACE_XML);
    const iface = nodeInfo.lookup_interface(cockpitProtocol.COCKPIT_INTERFACE_NAME);
    assertEqual(iface.methods.map(m => m.name).sort(), ['FocusSession', 'GetState', 'UnwatchCockpit', 'WatchCockpit']);
    assertEqual(iface.signals.map(s => s.name), ['Changed']);
});
test('cockpitProtocol: a full state round-trips', () => {
    assertEqual(cockpitProtocol.parseCockpitStatePayload(cockpitProtocol.buildCockpitStatePayload(FULL_STATE)),
        {protocol: 1, ...FULL_STATE});
});
test('cockpitProtocol: an unknown field is ignored and a mistyped one is null for itself alone', () => {
    const text = JSON.stringify({...JSON.parse(cockpitProtocol.buildCockpitStatePayload(FULL_STATE)), extra: 1,
        sources: {...FULL_STATE.sources, network: {...FULL_STATE.sources.network, sshMasterCount: 'two'}}});
    const parsed = cockpitProtocol.parseCockpitStatePayload(text);
    assertEqual(parsed.extra, undefined);
    assertEqual(parsed.sources.network.sshMasterCount, null);
    assertEqual(parsed.sources.network.vpn, FULL_STATE.sources.network.vpn);
});
test('cockpitProtocol: a session row with an unlisted state is dropped, the others kept', () => {
    const rows = [
        ...FULL_STATE.sources.sessions.rows, {...FULL_STATE.sources.sessions.rows[0], id: 'x', state: 'napping'},
    ];
    const parsed = cockpitProtocol.parseSessionsSource({...FULL_STATE.sources.sessions, rows});
    assertEqual(parsed.rows.length, FULL_STATE.sources.sessions.rows.length);
});
test('cockpitProtocol: Changed carries only the sources named', () => {
    const changed = cockpitProtocol.parseChangedPayload(cockpitProtocol.buildChangedPayload(
        {publishedAtUsec: 5, sources: {mounts: FULL_STATE.sources.mounts}}));
    assertEqual(Object.keys(changed.sources), ['mounts']);
    assertEqual(changed.sources.mounts, FULL_STATE.sources.mounts);
});
test('cockpitProtocol: a FocusSession reply with nothing known reads as all null and no window candidates', () => {
    assertEqual(cockpitProtocol.parseFocusSessionReply('{}'),
        {focused: null, windowPid: null, error: null, windowPidCandidates: []});
});
test('cockpitProtocol: a field no reader lists never leaves the builder', () => {
    const sessions = {
        ...FULL_STATE.sources.sessions, lastText: 'model prose',
        rows: [{...FULL_STATE.sources.sessions.rows[0], cwd: '/home/x'}],
    };
    const text = cockpitProtocol.buildCockpitStatePayload({...FULL_STATE, sources: {...FULL_STATE.sources, sessions}});
    assertEqual(text.includes('lastText'), false);
    assertEqual(text.includes('"cwd"'), false);
    // The same at every object level. The input is checked to hold every planted field, so the row cannot pass on a
    // plant that went nowhere.
    const plantedState = withUnlistedFieldAtEveryLevel(FULL_STATE);
    assertEqual(unlistedFieldNamesIn(JSON.stringify(plantedState)), UNLISTED_FIELD_NAMES);
    assertEqual(unlistedFieldNamesIn(cockpitProtocol.buildCockpitStatePayload(plantedState)), []);
});
test('cockpitProtocol: a field no reader lists, at any level, never leaves the Changed builder', () => {
    const plantedState = withUnlistedFieldAtEveryLevel(FULL_STATE);
    const plantedChange = {
        publishedAtUsec: 5, sources: plantedState.sources, layout: plantedState.layout,
        configError: plantedState.configError, [UNLISTED_FIELD_NAME_BY_LEVEL.state]: 'leaked',
    };
    assertEqual(unlistedFieldNamesIn(JSON.stringify(plantedChange)), UNLISTED_FIELD_NAMES);
    assertEqual(unlistedFieldNamesIn(cockpitProtocol.buildChangedPayload(plantedChange)), []);
});
test('cockpitProtocol: a field no reader lists, or herdr\'s text as the error, never leaves the FocusSession reply ' +
    'builder', () => {
    const text = cockpitProtocol.buildFocusSessionReply({
        focused: false, windowPid: 4242, error: HERDR_FREE_TEXT_ERROR, [UNLISTED_REPLY_FIELD_NAME]: 'leaked',
    });
    assertEqual([text.includes(UNLISTED_REPLY_FIELD_NAME), text.includes(HERDR_FREE_TEXT_ERROR)], [false, false]);
    assertEqual(JSON.parse(text), {focused: false, windowPid: 4242, error: null, windowPidCandidates: []});
});
test('cockpitProtocol: a FocusSession reply\'s error is one of five codes; any other string reads as null', () => {
    assertEqual(cockpitProtocol.COCKPIT_FOCUS_ERROR_CODES,
        ['unknown-session', 'no-pane', 'herdr-rejected', 'herdr-unreachable', 'internal']);
    assertEqual(Object.isFrozen(cockpitProtocol.COCKPIT_FOCUS_ERROR_CODES), true);
    const readErrors = cockpitProtocol.COCKPIT_FOCUS_ERROR_CODES.map(errorCode =>
        cockpitProtocol.parseFocusSessionReply(JSON.stringify({focused: false, error: errorCode})).error);
    assertEqual(readErrors, cockpitProtocol.COCKPIT_FOCUS_ERROR_CODES);
    const unlistedReply = JSON.stringify({focused: false, windowPid: null, error: 'herdr-on-fire'});
    assertEqual(cockpitProtocol.parseFocusSessionReply(unlistedReply),
        {focused: false, windowPid: null, error: null, windowPidCandidates: []});
});
/**
 * @param {*} stateHistory - A session row's stateHistory as sent; undefined sends the row without the field.
 * @returns {string|null|undefined} What the reader makes of it, in FULL_STATE's first session row.
 */
function readStateHistory(stateHistory) {
    const {stateHistory: _sentHistory, ...rowWithoutHistory} = FULL_STATE.sources.sessions.rows[0];
    const sentRow = stateHistory === undefined ? rowWithoutHistory : {...rowWithoutHistory, stateHistory};
    const state = {...FULL_STATE, sources: {...FULL_STATE.sources,
        sessions: {...FULL_STATE.sources.sessions, rows: [sentRow]}}};
    return cockpitProtocol.parseCockpitStatePayload(JSON.stringify({protocol: 1, ...state}))
        .sources.sessions.rows[0].stateHistory;
}

test('cockpitProtocol: a session\'s state history is one letter a minute per state, at most 60 of them', () =>
    assertEqual({letters: cockpitProtocol.SESSION_STATE_HISTORY_LETTERS,
        cells: cockpitProtocol.SESSION_STATE_HISTORY_CELLS,
        isEveryStateLettered: cockpitProtocol.SESSION_STATES.every(sessionState =>
            Object.hasOwn(cockpitProtocol.SESSION_STATE_HISTORY_LETTERS, sessionState))},
    {letters: {working: 'w', blocked: 'b', idle: 'i', done: 'd', unknown: 'u'}, cells: 60,
        isEveryStateLettered: true}));

test('cockpitProtocol: a state history is read as sent; a letter the reader does not know reads as unknown\'s, ' +
    'and one longer than the hour keeps its newest 60', () =>
    assertEqual({
        asSent: readStateHistory('wwbbidu'),
        unknownLetter: readStateHistory('wwxb?'),
        longerThanTheHour: readStateHistory(`bb${'w'.repeat(60)}`),
        noCellYet: readStateHistory(''),
    }, {asSent: 'wwbbidu', unknownLetter: 'wwubu', longerThanTheHour: 'w'.repeat(60), noCellYet: ''}));

test('cockpitProtocol: a state history that is not a string reads as null, the row kept', () =>
    assertEqual([['w', 'b'], 42, null, {w: 1}, true].map(readStateHistory), [null, null, null, null, null]));

test('cockpitProtocol: skew: from a service older than the state history, the row reads stateHistory null (none ' +
    'published), never an empty history (no cell yet), and every other field as before', () => {
    const {stateHistory: _sentHistory, ...rowWithoutHistory} = FULL_STATE.sources.sessions.rows[0];
    const state = {...FULL_STATE, sources: {...FULL_STATE.sources,
        sessions: {...FULL_STATE.sources.sessions, rows: [rowWithoutHistory]}}};
    const readRow = cockpitProtocol.parseCockpitStatePayload(JSON.stringify({protocol: 1, ...state}))
        .sources.sessions.rows[0];
    assertEqual({readRow, isEmptyHistory: readRow.stateHistory === ''},
        {readRow: {...rowWithoutHistory, stateHistory: null}, isEmptyHistory: false});
});

test('cockpitProtocol: a session row with an empty id or an empty name is dropped, the others kept', () => {
    const [firstRow] = FULL_STATE.sources.sessions.rows;
    const rows = [...FULL_STATE.sources.sessions.rows, {...firstRow, id: ''}, {...firstRow, id: 'x', name: ''}];
    const parsed = cockpitProtocol.parseSessionsSource({...FULL_STATE.sources.sessions, rows});
    assertEqual(parsed.rows, FULL_STATE.sources.sessions.rows);
});
test('cockpitProtocol: text that is not a JSON object parses to null as a whole', () => {
    assertEqual(cockpitProtocol.parseCockpitStatePayload('[]'), null);
});
test('cockpitProtocol: the state writes its top-level numbers before the layout and the sources', () => {
    const text = cockpitProtocol.buildCockpitStatePayload(FULL_STATE);
    const firstNestedIndex = Math.min(text.indexOf('"layout"'), text.indexOf('"sources"'));
    const isWrittenBeforeNested = quotedFieldName =>
        text.indexOf(quotedFieldName) >= 0 && text.indexOf(quotedFieldName) < firstNestedIndex;
    assertEqual(['"protocol"', '"serviceStartedAtUsec"', '"latestPublishedAtUsec"'].map(isWrittenBeforeNested),
        [true, true, true]);
});
test('cockpitProtocol: a layout drops an incomplete group and reads a missing monitor as unknown', () => {
    const groups = [
        ...FULL_STATE.layout.groups,
        {id: 'no-caption', columns: 1, cards: ['weather']},
        {id: 'bad-columns', caption: 'X', columns: 1.5, cards: ['weather']},
        {id: 'bad-cards', caption: 'X', columns: 1, cards: ['weather', 7]},
    ];
    assertEqual(cockpitProtocol.parseLayout({groups}),
        {monitor: {vendor: null, product: null}, groups: FULL_STATE.layout.groups});
    assertEqual(cockpitProtocol.parseLayout({monitor: FULL_STATE.layout.monitor}), null);
});
test('cockpitProtocol: a workspace or pane id over 128 characters reads as null, its row kept; one of 128 passes',
    () => {
    const [firstRow] = FULL_STATE.sources.sessions.rows;
    const idAtCap = 'w'.repeat(ID_MAX_CHARS);
    const wideIdAtCap = WIDE_CHARACTER.repeat(ID_MAX_CHARS);
    const idOverCap = 'w'.repeat(ID_MAX_CHARS + 1);
    const rows = [
        {...firstRow, workspaceId: idOverCap, paneId: idOverCap},
        {...firstRow, workspaceId: idAtCap, paneId: wideIdAtCap},
    ];
    const parsed = cockpitProtocol.parseSessionsSource({...FULL_STATE.sources.sessions, rows});
    assertEqual(parsed.rows.map(row => [row.workspaceId, row.paneId]), [[null, null], [idAtCap, wideIdAtCap]]);
});
test('cockpitProtocol: a session row whose id is over 257 characters (a "<workspace>:<pane>" of two 128-character ' +
    'ids) is dropped, the others kept; one of 257 passes', () => {
    const [firstRow] = FULL_STATE.sources.sessions.rows;
    const sessionIdAtCap = `${'w'.repeat(ID_MAX_CHARS)}:${WIDE_CHARACTER.repeat(ID_MAX_CHARS)}`;
    const sessionIdOverCap = `${sessionIdAtCap}x`;
    const rows = [{...firstRow, id: sessionIdOverCap}, {...firstRow, id: sessionIdAtCap}];
    const parsed = cockpitProtocol.parseSessionsSource({...FULL_STATE.sources.sessions, rows});
    assertEqual(parsed.rows.map(row => row.id), [sessionIdAtCap]);
});
test('cockpitProtocol: a mount row whose mount point is over 1024 characters is dropped, the others kept', () => {
    const [firstMount] = FULL_STATE.sources.mounts.rows;
    const mountPointAtCap = `/${'m'.repeat(PATH_MAX_CHARS - 1)}`;
    const mountPointOverCap = `/${'m'.repeat(PATH_MAX_CHARS)}`;
    const rows = [
        ...FULL_STATE.sources.mounts.rows,
        {...firstMount, mountPoint: mountPointOverCap},
        {...firstMount, mountPoint: mountPointAtCap},
    ];
    const parsed = cockpitProtocol.parseMountsSource({...FULL_STATE.sources.mounts, rows});
    const keptMountPoints = [...FULL_STATE.sources.mounts.rows.map(row => row.mountPoint), mountPointAtCap];
    assertEqual(parsed.rows.map(row => row.mountPoint), keptMountPoints);
});
// An extension older than local never sees the local rows, and its order is unchanged: the service puts them first,
// so the rows it keeps are the others in mount-point order, as before.
test('cockpitProtocol: a mount row of an unlisted kind is dropped, the others kept (so an extension older than a ' +
    'kind, as one that knows only network and removable is older than local, lists the rest and not those)', () => {
    const rows = [...FULL_STATE.sources.mounts.rows, {...FULL_STATE.sources.mounts.rows[0], kind: 'optical'}];
    assertEqual(cockpitProtocol.parseMountsSource({...FULL_STATE.sources.mounts, rows}), FULL_STATE.sources.mounts);
});
test('cockpitProtocol: every member of MOUNT_KINDS is drawn with a string icon, so no kind is added to one list ' +
    'alone', () => {
    const network = {uplink: {kind: 'wired', connectivity: 'full', wifiEnabled: false},
        vpn: {isUp: false, interfaceName: null}, sshMasterCount: 0};
    const iconsByKind = Object.fromEntries(cockpitProtocol.MOUNT_KINDS.map(kind => {
        const mount = {mountPoint: '/mnt/one', label: 'one', kind, filesystemType: null, freeBytes: null,
            totalBytes: null};
        const mountRow = connectionsRows(network, {rows: [mount]}).rows.find(row => row.kind === 'mount');
        return [kind, typeof mountRow?.icon === 'string' && mountRow.icon !== ''];
    }));
    assertEqual(iconsByKind, Object.fromEntries(cockpitProtocol.MOUNT_KINDS.map(kind => [kind, true])));
});
test('cockpitProtocol: a mount\'s noSizesReason is one of four; query-failed and no-answer are a fault of the mount, ' +
    'not-reported and not-permitted (a steady refusal) are not', () => assertEqual({
    reasons: cockpitProtocol.MOUNT_NO_SIZES_REASONS,
    faultReasons: cockpitProtocol.MOUNT_SIZE_FAULT_REASONS,
}, {
    reasons: ['query-failed', 'no-answer', 'not-reported', 'not-permitted'],
    faultReasons: ['query-failed', 'no-answer'],
}));
test('cockpitProtocol: not-permitted is read as sent, the row kept, and is no fault', () => {
    const shareRow = FULL_STATE.sources.mounts.rows[2];
    const refusedRow = {...shareRow, noSizesReason: 'not-permitted'};
    const readRow = cockpitProtocol.parseMountsSource({...FULL_STATE.sources.mounts, rows: [refusedRow]}).rows[0];
    assertEqual({readRow, isFault: cockpitProtocol.MOUNT_SIZE_FAULT_REASONS.includes(readRow.noSizesReason)},
        {readRow: refusedRow, isFault: false});
});
test('cockpitProtocol skew: a mount row from a service older than noSizesReason reads it as null, not said, which no ' +
    'fault reason is: a share sent with no sizes is not then read as a fault', () => {
    const shareRow = FULL_STATE.sources.mounts.rows[2];
    const {noSizesReason: _ignored, ...olderShareRow} = shareRow;
    const readRow = cockpitProtocol.parseMountsSource({...FULL_STATE.sources.mounts, rows: [olderShareRow]}).rows[0];
    assertEqual({readRow, isFault: cockpitProtocol.MOUNT_SIZE_FAULT_REASONS.includes(readRow.noSizesReason)},
        {readRow: {...shareRow, noSizesReason: null}, isFault: false});
});
test('cockpitProtocol skew: a noSizesReason this reader does not know, or not a string, reads as null, the row kept',
    () => {
        const shareRow = FULL_STATE.sources.mounts.rows[2];
        const rows = [{...shareRow, noSizesReason: 'quota-exceeded'}, {...shareRow, noSizesReason: 3}];
        assertEqual(cockpitProtocol.parseMountsSource({...FULL_STATE.sources.mounts, rows}).rows,
            [{...shareRow, noSizesReason: null}, {...shareRow, noSizesReason: null}]);
    });
test('cockpitProtocol: Changed carries the layout and its error beside the sources only when given', () => {
    const withLayout = cockpitProtocol.parseChangedPayload(cockpitProtocol.buildChangedPayload(
        {publishedAtUsec: 5, sources: {}, layout: FULL_STATE.layout, configError: null}));
    assertEqual(withLayout, {publishedAtUsec: 5, sources: {}, layout: FULL_STATE.layout, configError: null});
    const withoutLayout = cockpitProtocol.buildChangedPayload({publishedAtUsec: 5, sources: {}});
    assertEqual([withoutLayout.includes('"layout"'), withoutLayout.includes('"configError"')], [false, false]);
});
test('cockpitProtocol: a FocusSession reply round-trips, and a mistyped field is null for itself alone', () => {
    const reply = {focused: true, windowPid: 4242, error: null, windowPidCandidates: [4242, 4100]};
    assertEqual(cockpitProtocol.parseFocusSessionReply(cockpitProtocol.buildFocusSessionReply(reply)), reply);
    const failedReply = {focused: false, windowPid: null, error: 'herdr-unreachable', windowPidCandidates: []};
    assertEqual(cockpitProtocol.parseFocusSessionReply(cockpitProtocol.buildFocusSessionReply(failedReply)),
        failedReply);
    assertEqual(cockpitProtocol.parseFocusSessionReply('{"focused":"yes","windowPid":-1,"error":"herdr-rejected"}'),
        {focused: null, windowPid: null, error: 'herdr-rejected', windowPidCandidates: []});
});
test('cockpitProtocol: a FocusSession reply\'s windowPidCandidates missing, or not a list, reads as no candidates',
    () => {
        const readCandidates = replyText => cockpitProtocol.parseFocusSessionReply(replyText).windowPidCandidates;
        assertEqual([
            readCandidates('{"focused":true}'), readCandidates('{"focused":true,"windowPidCandidates":4242}'),
            readCandidates('{"focused":true,"windowPidCandidates":{"0":4242}}'),
            readCandidates('{"focused":true,"windowPidCandidates":null}'),
        ], [[], [], [], []]);
    });
test(`cockpitProtocol: a FocusSession reply keeps the first ${WINDOW_PID_CANDIDATES_MAX} window candidates and drops ` +
    'the rest', () => {
    const manyPids = Array.from({length: WINDOW_PID_CANDIDATES_MAX + 6}, (_unused, index) => 5000 + index);
    const replyText = JSON.stringify({focused: true, windowPidCandidates: manyPids});
    assertEqual(cockpitProtocol.parseFocusSessionReply(replyText).windowPidCandidates,
        manyPids.slice(0, WINDOW_PID_CANDIDATES_MAX));
});
test('cockpitProtocol: a FocusSession reply drops a window candidate that is not a count, the others kept', () => {
    const replyText = JSON.stringify(
        {focused: true, windowPidCandidates: [4242, '4243', -1, 1.5, null, true, [4244], 4100, 9007199254740992]});
    assertEqual(cockpitProtocol.parseFocusSessionReply(replyText).windowPidCandidates, [4242, 4100]);
});
test('cockpitProtocol: the nested harness\'s fixture state and focus reply read back unchanged', () => {
    const {state, focusReply} = JSON.parse(readFixture('nested-state.json'));
    const stateTimes = {serviceStartedAtUsec: 1_794_000_000_000_000, latestPublishedAtUsec: 1_794_000_000_000_000};
    const readState = cockpitProtocol.parseCockpitStatePayload(
        cockpitProtocol.buildCockpitStatePayload({...state, ...stateTimes}));
    const readReply = cockpitProtocol.parseFocusSessionReply(cockpitProtocol.buildFocusSessionReply(focusReply));
    assertEqual({readState, readReply}, {readState: {protocol: 1, ...stateTimes, ...state}, readReply: focusReply});
});
test('cockpitProtocol: the nested harness\'s fixture fills every list: sessions in every state, counted as its rows ' +
    'are, past the sessions card ("+36 more"), named as a busy desk\'s are (the card drawing the longest name and ' +
    'two of one name); mounts past the connections card ("+4 more"), the two local disks first, one drawn whose ' +
    'sizes did not answer, which says so; its first two sessions by urgency, the five waiting on you and then a ' +
    'working one drawn, the ones the nested check hovers and clicks; no session with a missing cell', () => {
    const {sessions, network, mounts} = JSON.parse(readFixture('nested-state.json')).state.sources;
    const sessionNames = sessions.rows.map(row => row.name);
    const longestNameChars = Math.max(...sessionNames.map(name => name.length));
    const isNameShared = name => sessionNames.filter(otherName => otherName === name).length > 1;
    const drawnSessionNames = sessionRows(sessions).rows.map(row => row.name);
    const rowCountByState = Object.fromEntries(cockpitProtocol.SESSION_STATES.map(sessionState =>
        [sessionState, sessions.rows.filter(row => row.state === sessionState).length]));
    const drawnConnections = connectionsRows(network, mounts);
    const drawnMountTexts = drawnConnections.rows.filter(row => row.kind === 'mount').map(row => row.text);
    const unansweredMountLabels = mounts.rows
        .filter(mount => mount.freeBytes === null && mount.totalBytes === null)
        .map(mount => mount.label);
    const summedSessionMemoryBytes = sessions.rows.reduce((sum, row) => sum + row.memoryBytes, 0);
    assertEqual({
        sessionRowCount: sessions.rows.length,
        statesWithNoRow: cockpitProtocol.SESSION_STATES.filter(sessionState => rowCountByState[sessionState] === 0),
        areCountsTheRows: JSON.stringify(sessions.counts) === JSON.stringify(rowCountByState),
        isTotalTheRowsSum: sessions.totalMemoryBytes === summedSessionMemoryBytes,
        sessionsOverflowText: sessionRows(sessions).overflowText,
        firstSessions: sessionsByUrgency(sessions.rows).slice(0, 2).map(row => `${row.id} ${row.name}`),
        drawnSessions: sessionRows(sessions).rows.map(row => `${row.state} ${row.name}`),
        sessionsWithAMissingCell: sessions.rows.filter(row => row.idleSeconds === null || row.memoryBytes === null)
            .length,
        longestNameChars,
        longNameCount: sessionNames.filter(name => name.length > DESK_LONG_NAME_THRESHOLD_CHARS).length,
        sharedNameSessionCount: sessionNames.filter(isNameShared).length,
        isLongestNameDrawn: drawnSessionNames.some(name => name.length === longestNameChars),
        drawnSharedNames: [...new Set(drawnSessionNames.filter(name => drawnSessionNames.indexOf(name) !==
            drawnSessionNames.lastIndexOf(name)))],
        mountRowCount: mounts.rows.length,
        connectionsOverflowText: drawnConnections.overflowText,
        unansweredMountsDrawn: unansweredMountLabels.filter(label => drawnMountTexts.includes(label)).length,
        firstMounts: mounts.rows.slice(0, 2).map(mount => `${mount.kind} ${mount.mountPoint}`),
        localDiskRowCount: mounts.rows.filter(mount => mount.kind === 'local').length,
        noSizesReasonByLabel: Object.fromEntries(mounts.rows
            .filter(mount => mount.noSizesReason !== null || mount.freeBytes === null || mount.totalBytes === null)
            .map(mount => [mount.label, mount.noSizesReason])),
    }, {
        sessionRowCount: 42,
        statesWithNoRow: [],
        areCountsTheRows: true,
        isTotalTheRowsSum: true,
        sessionsOverflowText: '+36 more',
        firstSessions: ['w5:p5 consolidate-logging-config', 'w4:p5 api-v2'],
        drawnSessions: ['blocked consolidate-logging-config', 'blocked api-v2', 'blocked triage-nightly-ci-failures',
            'blocked fix-flaky-tests', 'blocked migrate-legacy-auth-to-oidc-flow', 'working fix-flaky-tests'],
        sessionsWithAMissingCell: 0,
        longestNameChars: 32,
        longNameCount: 24,
        sharedNameSessionCount: 15,
        isLongestNameDrawn: true,
        drawnSharedNames: ['fix-flaky-tests'],
        mountRowCount: 9,
        connectionsOverflowText: '+4 more',
        unansweredMountsDrawn: 1,
        firstMounts: ['local /', 'local /home'],
        localDiskRowCount: 2,
        noSizesReasonByLabel: {'nas-media': 'no-answer'},
    });
});
test('cockpitProtocol: the nested harness\'s fixture gives every session a state history ending in its own state, ' +
    'four of them younger than the hour, and the hour holds waits and work that ended', () => {
    const {sessions} = JSON.parse(readFixture('nested-state.json')).state.sources;
    const letters = cockpitProtocol.SESSION_STATE_HISTORY_LETTERS;
    const histories = sessions.rows.map(row => row.stateHistory);
    // A wait that ended is a blocked cell followed by another state; work that ended, working followed by done. A
    // session blocked or done now supplies neither.
    const waitThatEnded = new RegExp(`${letters.blocked}[^${letters.blocked}]`);
    const workThatEnded = `${letters.working}${letters.done}`;
    assertEqual({
        sessionsWithoutHistory: histories.filter(history => typeof history !== 'string').length,
        sessionsEndingElsewhere: sessions.rows.filter(row => !row.stateHistory?.endsWith(letters[row.state])).length,
        youngerThanTheHour: histories.filter(history => history.length < cockpitProtocol.SESSION_STATE_HISTORY_CELLS)
            .map(history => history.length),
        sessionsWhoseWaitEnded: histories.filter(history => waitThatEnded.test(history)).length,
        sessionsWhoseWorkEnded: histories.filter(history => history.includes(workThatEnded)).length,
    }, {
        sessionsWithoutHistory: 0,
        sessionsEndingElsewhere: 0,
        youngerThanTheHour: [3, 17, 38, 52],
        sessionsWhoseWaitEnded: 16,
        sessionsWhoseWorkEnded: 28,
    });
});
