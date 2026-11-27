// lib/tileRenderGate.js: when a cockpit tile draws the last render it recorded, from its frozen and mapped states.
import {test, assertEqual} from './harness.js';
// The member names are read through the namespace, so a missing export fails its row rather than the whole run.
import * as tileRenderGate from '../extensions/resource-pulse@zvibaratz.github.io/lib/tileRenderGate.js';

const MAPPED = {isMapped: true};
const UNMAPPED = {isMapped: false};

/**
 * A gate that has drawn once already: a render recorded and drawn while mapped and unfrozen.
 *
 * @returns {object} The gate.
 */
function gateDrawnOnce() {
    const gate = new tileRenderGate.TileRenderGate();
    gate.recorded(MAPPED);
    return gate;
}

test('tileRenderGate: a render recorded while mapped and unfrozen is drawn at once, and only once', () => {
    const gate = new tileRenderGate.TileRenderGate();
    assertEqual([gate.recorded(MAPPED), gate.mapped(MAPPED), gate.frozenChanged(false, MAPPED)],
        [true, false, false]);
});

test('tileRenderGate: a render recorded before the tile is mapped waits, and is drawn as the tile is mapped, once',
    () => {
        const gate = new tileRenderGate.TileRenderGate();
        assertEqual([gate.recorded(UNMAPPED), gate.mapped(UNMAPPED), gate.mapped(MAPPED), gate.mapped(MAPPED)],
            [false, false, true, false]);
    });

test('tileRenderGate: frozen, a render is recorded and not drawn; the frozen repaint draws it once, and draws ' +
    'nothing when nothing new was recorded', () => {
    const gate = gateDrawnOnce();
    assertEqual([
        gate.frozenChanged(true, MAPPED), gate.recorded(MAPPED), gate.recorded(MAPPED), gate.frozenRepaint(MAPPED),
        gate.frozenRepaint(MAPPED),
    ], [false, false, false, true, false]);
});

test('tileRenderGate: the reveal draws what was recorded while frozen, and draws nothing when nothing was', () => {
    const recordedWhileFrozen = gateDrawnOnce();
    recordedWhileFrozen.frozenChanged(true, MAPPED);
    recordedWhileFrozen.recorded(MAPPED);
    const nothingWhileFrozen = gateDrawnOnce();
    nothingWhileFrozen.frozenChanged(true, MAPPED);
    assertEqual([recordedWhileFrozen.frozenChanged(false, MAPPED), nothingWhileFrozen.frozenChanged(false, MAPPED)],
        [true, false]);
});

test('tileRenderGate: unfrozen, the frozen repaint draws nothing, even with a render waiting for the tile to map',
    () => {
        const gate = new tileRenderGate.TileRenderGate();
        gate.recorded(UNMAPPED);
        assertEqual([gate.frozenRepaint(MAPPED), gate.mapped(MAPPED)], [false, true]);
    });

test('tileRenderGate: nothing is drawn while the tile is not mapped, whether revealed, repainted or recorded', () => {
    const gate = gateDrawnOnce();
    gate.frozenChanged(true, MAPPED);
    gate.recorded(MAPPED);
    assertEqual([gate.frozenRepaint(UNMAPPED), gate.frozenChanged(false, UNMAPPED), gate.recorded(UNMAPPED),
        gate.mapped(MAPPED)], [false, false, false, true]);
});

test('tileRenderGate: a tile frozen before it ever drew draws as it is first mapped, so it never shows its title ' +
    'alone; a tile that has drawn and is frozen does not draw as it maps again', () => {
    const neverDrawn = new tileRenderGate.TileRenderGate();
    neverDrawn.frozenChanged(true, UNMAPPED);
    neverDrawn.recorded(UNMAPPED);
    const drawnBefore = gateDrawnOnce();
    drawnBefore.frozenChanged(true, MAPPED);
    drawnBefore.recorded(UNMAPPED);
    assertEqual([neverDrawn.mapped(MAPPED), drawnBefore.mapped(MAPPED)], [true, false]);
});

test('tileRenderGate: setting the frozen state it has changes nothing and draws nothing; isFrozen reads the state',
    () => {
        const gate = new tileRenderGate.TileRenderGate();
        gate.recorded(UNMAPPED);
        assertEqual([gate.isFrozen, gate.frozenChanged(false, MAPPED), gate.frozenChanged(true, MAPPED),
            gate.isFrozen, gate.frozenChanged(true, MAPPED)], [false, false, false, true, false]);
    });

test('tileRenderGate: a tile frozen and mapped before it ever recorded draws its first render at once, so it never ' +
    'shows its title alone; a second render while still frozen waits', () => {
    const gate = new tileRenderGate.TileRenderGate();
    gate.frozenChanged(true, UNMAPPED);
    assertEqual([gate.mapped(MAPPED), gate.recorded(MAPPED), gate.recorded(MAPPED), gate.frozenRepaint(MAPPED)],
        [false, true, false, true]);
});
