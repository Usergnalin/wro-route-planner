/* ========================================================================
   action.js - Phase 10: routes as ordered ACTIONS.

   Turns used to be inferred by codegen and billed to the next element.
   These cover them being real, selectable, parameterised objects anchored
   to the junction point they happen at.

     node tests/action.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('action model');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  RP.render = function () {};
  RP.updateLayerList = function () {};
  RP.updateInfoPanel = function () {};
  RP.updateInstructions = function () {};
  RP.updateConstraintPanel = function () {};
  RP.updateRouteSelect = function () {};
  RP.updateSideRouteList = function () {};
  RP.calibration = { pixelsPerMm: 2 };
  RP.scale = 1;
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

// An L: (0,0)->(100,0) then (100,0)->(100,80), joined at the corner.
function lRoute(RP) {
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.p2.id, b.p1.id]);
  const route = RP.routes[0];
  const e1 = RP.addMove(route.id, a.line.id, { move: 'forward' });
  const e2 = RP.addMove(route.id, b.line.id, { move: 'forward' });
  return { route, a, b, e1, e2 };
}

const turns = route => route.actions.filter(a => a.type === 'turn');
const autos = route => turns(route).filter(t => t.angleMode === 'auto');

// ---- the invariant ---------------------------------------------------
check('every move gets exactly one auto turn in front of it', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  assert(route.actions.length === 4, 'turn,move,turn,move — got ' + route.actions.length);
  assert(autos(route).length === 2, 'one auto turn per move');
  const seq = route.actions.map(a => a.type).join(',');
  assert(seq === 'turn,move,turn,move', 'got ' + seq);
});

check('the auto turn is anchored to the junction point it happens at', () => {
  const RP = fresh();
  const { route, a, b } = lRoute(RP);
  const second = autos(route)[1];
  const find = RP.Sketch.coincidenceClusters(RP.sketch);
  assert(find(second.pointId) === find(a.p2.id),
    'second turn should sit on the corner the two lines share');
  assert(find(second.pointId) === find(b.p1.id), 'same cluster from either side');
});

check('syncTurnActions is idempotent', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  const before = route.actions.map(a => a.id).join(',');
  RP.syncTurnActions(route);
  RP.syncTurnActions(route);
  assert(route.actions.map(a => a.id).join(',') === before,
    'repeated syncs must not churn action ids');
});

check('an auto turn cannot be removed by hand', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  const t = autos(route)[0];
  assert(RP.removeAction(route.id, t.id) === false, 'auto turns are owned by the invariant');
  assert(autos(route).length === 2, 'still there');
});

// ---- turn parameters -------------------------------------------------
check('turn speed lives on the turn, not on the line after it', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  const corner = autos(route)[1];
  RP.setActionProps(route.id, corner.id, { params: { speed: '120' } });

  const turnSteps = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assert(turnSteps.length === 1, 'one geometric turn at the corner');
  assertClose(turnSteps[0].deg, 90, 1e-9, 'right-angle corner');
  assert(turnSteps[0].params.speed === '120', 'turn speed came from the turn action');
});

check('turn style reaches the emitted step', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.setActionProps(route.id, autos(route)[1].id, { style: 'pivot_left' });
  const t = RP.computeSteps(route).filter(s => s.kind === 'turn')[0];
  assert(t.style === 'pivot_left', 'style should ride along to codegen');
});

check('a fixed angle overrides the geometry', () => {
  const RP = fresh();
  const { route, e2 } = lRoute(RP);
  const inserted = RP.insertFixedTurn(route.id, e2.id, { angle: 30, params: { speed: '90' } });
  assert(inserted && inserted.angleMode === 'fixed', 'inserted a fixed turn');

  const ts = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assert(ts.length === 2, 'the typed turn and the geometric one, got ' + ts.length);
  assertClose(ts[0].deg, 30, 1e-9, 'typed turn comes first');
  assert(ts[0].params.speed === '90', 'typed turn keeps its own speed');
  // The geometric turn is measured from where the typed one left off.
  assertClose(ts[1].deg, 60, 1e-9, '90° corner less the 30° already turned');
});

check('a fixed turn stays in front of its move after a sync', () => {
  const RP = fresh();
  const { route, e2 } = lRoute(RP);
  RP.insertFixedTurn(route.id, e2.id, { angle: 30 });
  RP.syncTurnActions(route);
  const seq = route.actions.map(a =>
    a.type === 'move' ? 'move' : a.angleMode).join(',');
  assert(seq === 'auto,move,fixed,auto,move', 'got ' + seq);
});

// ---- structural edits carry turn parameters --------------------------
check('reordering a move carries its junction parameters', () => {
  const RP = fresh();
  const { route, e1, e2 } = lRoute(RP);
  RP.setActionProps(route.id, autos(route)[1].id, { params: { speed: '175' }, style: 'pivot_right' });

  RP.reorderMove(route.id, e2.id, 0);
  assert(RP.moveActions(route)[0].id === e2.id, 'move actually reordered');

  const carried = autos(route).filter(t => t.params.speed === '175');
  assert(carried.length === 1, 'the 175 turn survived the reorder');
  assert(carried[0].style === 'pivot_right', 'and kept its style');
});

check('reversing the route negates typed turns and keeps auto speeds', () => {
  const RP = fresh();
  const { route, e2 } = lRoute(RP);
  RP.insertFixedTurn(route.id, e2.id, { angle: 30, params: { speed: '90' } });
  RP.setActionProps(route.id, autos(route)[1].id, { params: { speed: '175' } });

  RP.reverseRouteDirection(route);

  assert(RP.resolveRoute(route).ok, 'reversed route must still resolve');
  const fixed = turns(route).filter(t => t.angleMode === 'fixed');
  assert(fixed.length === 1 && fixed[0].angle === -30,
    'a typed turn swings the other way when the route is walked backwards');
  assert(autos(route).some(t => t.params.speed === '175'), 'junction speed survived the reversal');
});

check('removing a move takes its auto turn with it', () => {
  const RP = fresh();
  const { route, e2 } = lRoute(RP);
  RP.removeMove(route.id, e2.id);
  assert(RP.moveActions(route).length === 1, 'one move left');
  assert(autos(route).length === 1, 'and one auto turn, got ' + autos(route).length);
});

// ---- headings the planner cannot know --------------------------------
check('no turn is derived across a teleport', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setMoveProps(route.id, e1.id, { move: 'teleport' });
  const ts = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assert(ts.length === 0, 'arriving heading is unknown, so there is nothing to derive');
});

check('resolveTimeline reports unknown headings rather than guessing', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setMoveProps(route.id, e1.id, { move: 'teleport' });
  const tl = RP.resolveTimeline(route);
  assert(tl.ok, 'should still resolve');
  const tele = tl.items.filter(i => i.kind === 'move')[0];
  assert(tele.entryHeading === null && tele.exitHeading === null,
    'a teleport has no knowable heading at either end');
});

// ---- compat view -----------------------------------------------------
check('RP.moveActions(route) aliases the live move actions', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  assert(RP.moveActions(route)[0] === e1, 'the view must hand back the real action, not a copy');
  RP.moveActions(route)[0].offset = 321;
  assert(RP.findAction(route, e1.id).offset === 321, 'writes reach the model');
});

check('v4 element saves lift into actions with turn data preserved', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.p2.id, b.p1.id]);

  // Hand-built as a v4 save would deserialize: turn data on the elements.
  const route = {
    id: 1, name: 'v4', visible: true, startCheckpoint: null,
    endExtraTurns: [{ deg: 180, speed: 60 }],
    elements: [
      { id: 101, entityId: a.line.id, move: 'forward', flip: false, reverse: false,
        speed: null, offset: 0, junctions: null, teleportName: null,
        turnSpeed: null, extraTurnsBefore: [], checkpoint: null, hidden: false },
      { id: 102, entityId: b.line.id, move: 'forward', flip: false, reverse: false,
        speed: null, offset: 0, junctions: null, teleportName: null,
        turnSpeed: 140, extraTurnsBefore: [{ deg: 15, speed: 70 }],
        checkpoint: null, hidden: false }
    ]
  };
  RP.routes = [route];
  RP.nextActionId = 200;
  RP.migrateRoutesToActions();

  assert(route.actions, 'route was lifted to actions');
  assert(route.endExtraTurns === undefined, 'the end-turn hack is gone');
  const seq = route.actions.map(x => x.type === 'move' ? 'move' : x.angleMode).join(',');
  assert(seq === 'auto,move,fixed,auto,move,fixed', 'got ' + seq);

  const auto2 = autos(route)[1];
  assert(auto2.params.speed === '140', 'el.turnSpeed became the junction turn speed');
  const fixedTurns = turns(route).filter(t => t.angleMode === 'fixed');
  assert(fixedTurns[0].angle === 15 && fixedTurns[0].params.speed === '70', 'extra turn lifted');
  assert(fixedTurns[1].angle === 180 && fixedTurns[1].params.speed === '60', 'end turn lifted');
  assert(route.actions.every(x => !('speed' in x)), 'no action keeps the old speed field');
});

check('a blank pivot template falls back to the spin template', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.setActionProps(route.id, autos(route)[1].id, { style: 'pivot_left' });
  const spin = RP.generateCode(route);

  RP.codeConfig.movements.turn.pivotLeft = 'robot.pivot_left({angle}, {speed})';
  const pivot = RP.generateCode(route);

  // Matched without pinning the decimal places: this is a test about WHICH
  // template was used, not about how many digits the number carries.
  assert(/robot\.turn_in_place\(90(\.0+)?[,)]/.test(spin),
    'blank pivot template emits the ordinary turn, got:\n' + spin);
  assert(/robot\.pivot_left\(90(\.0+)?, 200\)/.test(pivot),
    'a filled-in pivot template is used instead, got:\n' + pivot);
});

// ---- phase 10.2: selecting and editing actions ------------------------
function routeMode(RP) {
  RP.setEditMode('route');
  return RP.getActiveRoute();
}

check('clicking a junction point selects the turn there', () => {
  const RP = fresh();
  const { route, a } = lRoute(RP);
  routeMode(RP);
  const corner = RP.sketch.entities[a.p2.id];

  const hit = RP.routeHitTest(corner.x, corner.y);
  assert(hit && hit.kind === 'action', 'expected an action hit, got ' + JSON.stringify(hit));
  const act = RP.findAction(route, hit.id);
  assert(RP.isTurnAction(act), 'the corner belongs to a turn');
});

check('a point hit beats the lines running through it', () => {
  const RP = fresh();
  const { a } = lRoute(RP);
  routeMode(RP);
  const corner = RP.sketch.entities[a.p2.id];
  // Dead on the corner both lines are also within range; the turn wins.
  const hit = RP.routeHitTest(corner.x, corner.y);
  assert(hit.kind === 'action', 'the small target must win, got ' + hit.kind);
  // A few px along the line, away from the corner, is the move again.
  const off = RP.routeHitTest(corner.x - 40, corner.y);
  assert(off && off.kind === 'move', 'along the line is the move, got ' + JSON.stringify(off));
});

check('clicking again cycles through actions sharing a junction', () => {
  const RP = fresh();
  const { route, a, e2 } = lRoute(RP);
  routeMode(RP);
  RP.insertFixedTurn(route.id, e2.id, { angle: 30 });
  RP.insertCheckpoint(route.id, e2.id, 'grab');
  const corner = RP.sketch.entities[a.p2.id];

  const seen = [];
  for (let i = 0; i < 4; i++) {
    const hit = RP.routeHitTest(corner.x, corner.y);
    RP.selectedActionId = hit.id;
    seen.push(hit.id);
  }
  assert(new Set(seen).size >= 3,
    'repeated clicks should walk the actions at that corner, got ' + JSON.stringify(seen));
});

check('selecting a turn un-highlights every move', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  routeMode(RP);
  RP.selectedActionId = autos(route)[1].id;
  assert(RP.selectedMoveId === null,
    'selectedMoveId must read through only for moves');
  RP.selectedActionId = RP.moveActions(route)[0].id;
  assert(RP.selectedMoveId === RP.moveActions(route)[0].id, 'and read through for a move');
});

check('typing an angle overrides the junction without adding a second turn', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  routeMode(RP);
  const corner = autos(route)[1];
  RP.selectedActionId = corner.id;
  RP.updateSelectedAction({ angle: 45 });

  assert(autos(route).length === 2, 'still one auto turn per move, got ' + autos(route).length);
  assert(turns(route).length === 2, 'no extra turn was created');
  const ts = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assert(ts.length === 1 && ts[0].deg === 45, 'the typed angle is what gets emitted');
});

check('clearing the override returns the junction to the geometry', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  routeMode(RP);
  const corner = autos(route)[1];
  RP.selectedActionId = corner.id;
  RP.updateSelectedAction({ angle: 45 });
  RP.updateSelectedAction({ angle: null });
  const ts = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assertClose(ts[0].deg, 90, 1e-9, 'back to the 90° corner');
});

check('emitted steps are tagged with the action that produced them', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  const emitted = RP.emittedStepsByAction(route);
  assert(emitted[e1.id] && emitted[e1.id][0].kind === 'forward', 'move tagged');
  const corner = autos(route)[1];
  assertClose(RP.turnAngleFor(emitted, corner), 90, 1e-9, 'turn tagged and readable');
  // A turn that emits nothing is simply absent.
  assert(RP.turnAngleFor(emitted, autos(route)[0]) === null,
    'the leading turn emits nothing without a start position');
});

check('add turn / add checkpoint insert in front of the selection', () => {
  const RP = fresh();
  const { route, e2 } = lRoute(RP);
  routeMode(RP);
  RP.selectedActionId = e2.id;
  const t = RP.addTurnHere();
  assert(RP.selectedActionId === t.id, 'the new turn becomes the selection');
  const cp = RP.addCheckpointHere();

  const seq = route.actions.map(x =>
    x.type === 'move' ? 'M' : (x.type === 'checkpoint' ? 'C' : x.angleMode[0]));
  assert(seq.join('') === 'aMfCaM' || seq.join('') === 'aMCfaM',
    'inserted in front of the second move, got ' + seq.join(''));
  assert(cp.pointId != null, 'checkpoint got anchored to a point');
});

check('a user turn can be removed but the junction turn cannot', () => {
  const RP = fresh();
  const { route, e2 } = lRoute(RP);
  routeMode(RP);
  RP.selectedActionId = e2.id;
  const t = RP.addTurnHere();
  assert(RP.removeSelectedAction() === true, 'the inserted turn goes');
  assert(RP.findAction(route, t.id) === null, 'really gone');

  RP.selectedActionId = autos(route)[1].id;
  assert(RP.removeSelectedAction() === false, 'the junction turn stays');
  assert(autos(route).length === 2, 'still there');
});

check('checkpoint actions round-trip through the move panel field', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  routeMode(RP);
  RP.selectedActionId = e1.id;
  RP.updateSelectedMove({ checkpoint: 'grab_block' });

  const cps = route.actions.filter(RP.isCheckpointAction);
  assert(cps.length === 1 && cps[0].name === 'grab_block', 'one checkpoint action');
  assert(RP.checkpointAfterMove(route, e1.id) === cps[0], 'found after its move');
  assert(/grab_block/.test(RP.generateCode(route)), 'and it reaches the code');

  RP.updateSelectedMove({ checkpoint: null });
  assert(route.actions.filter(RP.isCheckpointAction).length === 0, 'blank removes it');
});

check('the start checkpoint is just the first action now', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  routeMode(RP);
  RP.selectedActionId = route.actions[0].id;
  RP.addCheckpointHere();
  RP.setActionProps(route.id, RP.selectedActionId, { name: 'start_cp' });

  const code = RP.generateCode(route);
  const lines = code.split('\n').filter(l => l.indexOf('#') !== 0);
  assert(/start_cp/.test(lines[0]), 'fires before anything moves, got:\n' + code);
  assert(route.startCheckpoint === undefined, 'the old field is gone entirely');
});

// ---- hiding a route move ------------------------------------------------
// Overlapping ROUTE lines are a separate problem from overlapping
// CONSTRUCTION lines: even after hiding the construction geometry, two
// visually-close route moves still fight for the cursor, and there was
// no way to get one out of the way to reach the other or the raw
// geometry underneath.

check('a move is visible by default', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  assert(e1.visible !== false, 'moves start visible');
});

check('hiding a move is purely presentational: generateCode is untouched', () => {
  // The one invariant that matters most here: visible is a rendering and
  // hit-testing flag ONLY. If this ever leaked into codegen, hiding a
  // move to declutter the canvas would silently change what the robot
  // does, which would be far worse than the clutter it was fixing.
  const RP = fresh();
  const { route, e1, e2 } = lRoute(RP);
  const before = RP.generateCode(route);

  RP.setActionProps(route.id, e1.id, { visible: false });
  RP.setActionProps(route.id, e2.id, { visible: false });
  const afterHidden = RP.generateCode(route);
  assert(afterHidden === before, 'hidden moves must generate identical code');

  RP.setActionProps(route.id, e1.id, { visible: true });
  const afterShown = RP.generateCode(route);
  assert(afterShown === before, 'showing it again must still match');
});

check('a hidden move has no presence in routeHitTest', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  // e1 sits on line a: (0,0)->(100,0). (50,1) is a near-miss on it.
  const before = RP.routeHitTest(50, 1);
  assert(before && before.kind === 'move' && before.id === e1.id, 'visible move is hit');

  RP.setActionProps(route.id, e1.id, { visible: false });
  const after = RP.routeHitTest(50, 1);
  assert(!after || after.id !== e1.id,
    'a hidden move must not answer a click — that is the whole point');
});

check('hiding a move frees its entity to render as a guide again', () => {
  const RP = fresh();
  const { route, a, e1 } = lRoute(RP);
  const before = RP.routeReferencedEntities();
  assert(before[a.line.id] === true, 'a visible move claims its entity');

  RP.setActionProps(route.id, e1.id, { visible: false });
  const after = RP.routeReferencedEntities();
  assert(after[a.line.id] === undefined,
    'a hidden move must free its entity so the construction-line guide shows through');
});

check('nearest wins among overlapping moves, not first-added', () => {
  const RP = fresh();
  // Two near-parallel lines, both added to the route as moves.
  const a = RP.addConstructionLine(0, 100, 300, 100);
  const b = RP.addConstructionLine(0, 106, 300, 106);
  RP.setEditMode('route');
  const eA = RP.addGeometryToRoute(a.line.id);
  const eB = RP.addGeometryToRoute(b.line.id);

  const hitNearA = RP.routeHitTest(150, 100);
  assert(hitNearA && hitNearA.id === eA.id, 'closer to A should hit A, not whichever was added last');
  const hitNearB = RP.routeHitTest(150, 106);
  assert(hitNearB && hitNearB.id === eB.id, 'closer to B should hit B');
});

check('hiding the nearer of two overlapping moves reveals the farther one', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 100, 300, 100);
  const b = RP.addConstructionLine(0, 103, 300, 103);
  RP.setEditMode('route');
  const eA = RP.addGeometryToRoute(a.line.id);
  const eB = RP.addGeometryToRoute(b.line.id);

  // Clicking between them currently favours A (closer).
  const before = RP.routeHitTest(150, 101);
  assert(before.id === eA.id, 'setup: A wins the click');

  RP.setActionProps(RP.getActiveRoute().id, eA.id, { visible: false });
  const after = RP.routeHitTest(150, 101);
  assert(after && after.id === eB.id,
    'with A hidden, the click should reach B instead of nothing');
});

check('v4 lift translates the old hidden field to visible', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const route = {
    id: 1, name: 'v4', visible: true,
    elements: [
      { id: 101, entityId: a.line.id, move: 'forward', flip: false, reverse: false,
        speed: null, offset: 0, junctions: null, teleportName: null,
        turnSpeed: null, extraTurnsBefore: [], checkpoint: null, hidden: true }
    ]
  };
  RP.routes = [route];
  RP.nextActionId = 200;
  RP.migrateRoutesToActions();

  const moves = RP.moveActions(route);
  assert(moves.length === 1, 'the move survived the lift');
  assert(moves[0].visible === false, 'hidden:true became visible:false');
  assert(!('hidden' in moves[0]), 'the old field name is gone, not just shadowed');
});

// ---- parameters ------------------------------------------------------
check('fresh actions carry an empty params object and no legacy fields', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  const cp = RP.insertCheckpoint(route.id, e1.id, 'cp');
  for (const a of [e1, autos(route)[0], cp]) {
    assert(a.params && Object.keys(a.params).length === 0, 'expected {} params on ' + a.type);
    assert(!('speed' in a) && !('extraArgs' in a) && !('junctions' in a), 'legacy field on ' + a.type);
  }
});

check('a v4 lift with no extraArgs field does not crash codegen', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const route = {
    id: 1, name: 'v4', visible: true,
    elements: [
      { id: 101, entityId: a.line.id, move: 'forward', flip: false, reverse: false,
        speed: null, offset: 0, junctions: null, teleportName: null,
        turnSpeed: null, extraTurnsBefore: [], checkpoint: null, hidden: false }
    ]
  };
  RP.routes = [route];
  RP.nextActionId = 200;
  RP.migrateRoutesToActions();
  const code = RP.generateCode(route);
  assert(!/\{extra_args\}/.test(code), 'an empty parameter fills in nothing, not the token');
});

check('a parameter value lands only on its own action’s line', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setMoveProps(route.id, e1.id, { params: { extra_args: ', blocking=True' } });
  const lines = RP.generateCode(route).split('\n').filter(l => l.indexOf('move_distance') >= 0);
  assert(lines.length === 2, 'both legs still generate a move line, got ' + lines.length);
  assert(lines[0].indexOf('blocking=True') >= 0, 'the first move carries its own value');
  assert(lines[1].indexOf('blocking=True') < 0, 'the second move must not inherit it');
});

check('turns and checkpoints take parameter values too', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setActionProps(route.id, autos(route)[1].id, { params: { extra_args: ', slow=True' } });
  const cp = RP.insertCheckpoint(route.id, e1.id, 'grab');
  RP.setActionProps(route.id, cp.id, { params: { extra_args: "reason='junction'" } });
  const code = RP.generateCode(route);
  assert(code.split('\n').filter(l => l.indexOf('turn_in_place') >= 0)[0].indexOf('slow=True') >= 0,
    'the corner turn carries its value, got:\n' + code);
  assert(/if callable\(grab\): grab\(reason='junction'\)/.test(code),
    'expected the value inside the checkpoint call, got:\n' + code);
});

check('each movement has its own speed parameter with its own default', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.findParam('forward', 'speed').default = '350';
  const code = RP.generateCode(route);
  assert(code.split('\n').filter(l => l.indexOf('move_distance') >= 0).every(l => l.indexOf('power=350') >= 0),
    'forward moves use Forward’s default, got:\n' + code);
  assert(code.split('\n').filter(l => l.indexOf('turn_in_place') >= 0).every(l => l.indexOf('power=200') >= 0),
    'turns keep Turn’s own default, got:\n' + code);
});

check('an action’s own value beats the parameter default, printed as typed', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.findParam('forward', 'speed').default = '350';
  RP.setMoveProps(route.id, e1.id, { params: { speed: '77.50' } });
  const lines = RP.generateCode(route).split('\n').filter(l => l.indexOf('move_distance') >= 0);
  assert(lines[0].indexOf('power=77.50') >= 0, 'own value, verbatim, got ' + lines[0]);
  assert(lines[1].indexOf('power=350') >= 0, 'the other move gets the default, got ' + lines[1]);
});

check('an empty default fills in nothing, and the template is otherwise untouched', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.codeConfig.movements.forward.template = 'drive({distance}, accel={accel});';
  RP.addParam('forward', { name: 'accel', type: 'number', default: '' });
  const lines = RP.generateCode(route).split('\n').filter(l => l.indexOf('drive(') >= 0);
  assert(lines[0] === 'drive(50.000, accel=);', 'strict template, nothing added or removed, got ' + lines[0]);
});

check('bool parameters and {reversed} follow the project’s bool style', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.codeConfig.boolStyle = 'true/false';
  RP.codeConfig.movements.forward.template = 'drive({distance}, {reversed}, {brake});';
  RP.addParam('forward', { name: 'brake', type: 'bool', default: false });
  RP.setMoveProps(route.id, e1.id, { params: { brake: true } });
  const lines = RP.generateCode(route).split('\n').filter(l => l.indexOf('drive(') >= 0);
  assert(lines[0] === 'drive(50.000, false, true);', 'got ' + lines[0]);
  assert(lines[1] === 'drive(40.000, false, false);', 'got ' + lines[1]);
  RP.codeConfig.boolStyle = '1/0';
  assert(RP.generateCode(route).indexOf('drive(50.000, 0, 1);') >= 0, '1/0 style');
});

check('{{name}} is a literal, and braces that are not placeholders pass through', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.codeConfig.movements.forward.template = 'drive(Cfg{{speed}}, {1, 2}, {speed});';
  const line = RP.generateCode(route).split('\n').filter(l => l.indexOf('drive(') >= 0)[0];
  assert(line === 'drive(Cfg{speed}, {1, 2}, 200);', 'got ' + line);
  assert(RP.templateProblems().length === 0, 'an escaped name is not a problem');
});

check('an unknown placeholder is left as typed and reported', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.codeConfig.movements.forward.template = 'drive({distance}, {sped});';
  const line = RP.generateCode(route).split('\n').filter(l => l.indexOf('drive(') >= 0)[0];
  assert(line === 'drive(50.000, {sped});', 'got ' + line);
  const probs = RP.templateProblems();
  assert(probs.length === 1 && probs[0].name === 'sped' && probs[0].movement === 'forward',
    'got ' + JSON.stringify(probs));
});

check('a built-in belongs to its movement only', () => {
  const RP = fresh();
  RP.codeConfig.movements.turn.template = 'turn({angle}, {radius});';
  const probs = RP.templateProblems();
  assert(probs.some(p => p.movement === 'turn' && p.name === 'radius'),
    'radius is measured for arcs, not turns: ' + JSON.stringify(probs));
});

check('parameter names are validated', () => {
  const RP = fresh();
  assert(RP.addParam('forward', { name: 'radius', type: 'number' }), 'a built-in name is refused');
  assert(RP.addParam('forward', { name: 'speed', type: 'number' }), 'a duplicate is refused');
  assert(RP.addParam('forward', { name: '2fast', type: 'number' }), 'a leading digit is refused');
  assert(RP.addParam('forward', { name: 'accel_2', type: 'number' }) === null, 'a good name is accepted');
  assert(RP.addParam('turn', { name: 'accel_2', type: 'number' }) === null, 'names are per movement');
});

check('renaming a parameter rewrites its templates and every action value', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.codeConfig.movements.turn.pivotLeft = 'pivot({angle}, {speed}, {{speed}})';
  RP.setMoveProps(route.id, e1.id, { params: { speed: '55' } });
  RP.setActionProps(route.id, autos(route)[1].id, { params: { speed: '66' } });
  assert(RP.renameParam('forward', 'speed', 'power') === null, 'rename accepted');
  assert(RP.codeConfig.movements.forward.template.indexOf('{power}') >= 0, 'forward template rewritten');
  assert(e1.params.power === '55' && !('speed' in e1.params), 'move value moved to the new name');
  assert(autos(route)[1].params.speed === '66', 'another movement’s speed is a different parameter');
  assert(RP.codeConfig.movements.turn.pivotLeft === 'pivot({angle}, {speed}, {{speed}})', 'turn untouched');
  RP.renameParam('turn', 'speed', 'spd');
  assert(RP.codeConfig.movements.turn.pivotLeft === 'pivot({angle}, {spd}, {{speed}})',
    'every variant rewritten, escapes kept: ' + RP.codeConfig.movements.turn.pivotLeft);
  assert(RP.templateProblems().length === 0, 'nothing left dangling');
});

check('removing a parameter drops its values and reports its placeholders', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setMoveProps(route.id, e1.id, { params: { extra_args: ', x=1' } });
  assert(RP.removeParam('forward', 'extra_args'), 'removed');
  assert(!('extra_args' in e1.params), 'the action value went with it');
  assert(RP.templateProblems().some(p => p.movement === 'forward' && p.name === 'extra_args'),
    'the placeholder still in the template is reported');
});

check('changing a parameter’s type resets values typed for the old type', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setMoveProps(route.id, e1.id, { params: { speed: '55' } });
  RP.setParamType('forward', 'speed', 'bool');
  assert(!('speed' in e1.params), 'value cleared');
  assert(RP.findParam('forward', 'speed').default === false, 'bool default');
});

check('old flat code configs become per-movement parameters', () => {
  const RP = fresh();
  RP.codeConfig = {
    commentPrefix: '//', defaultUnit: 'cm', defaultSpeed: 175, defaultSpeedForward: 350,
    forwardTemplate: 'fwd({distance}, {speed}, {mode})',
    turnTemplate: 'turn({angle}, {speed})', turnPivotLeftTemplate: '', turnPivotRightTemplate: '',
    lineTraceJunctTemplate: 'lt({junctions}, {speed})'
  };
  RP.ensureCodeConfig();
  const c = RP.codeConfig;
  assert(c.commentPrefix === '//' && c.defaultUnit === 'cm' && c.boolStyle === 'True/False', 'project fields kept');
  assert(c.movements.forward.template === 'fwd({distance}, {speed}, {mode})', 'template kept');
  assert(RP.findParam('forward', 'speed').default === '350', 'per-kind speed became Forward’s default');
  assert(RP.findParam('turn', 'speed').default === '175', 'global speed became Turn’s default');
  assert(RP.findParam('forward', 'mode').type === 'text', 'other placeholders become text parameters');
  assert(RP.findParam('linetrace_junct', 'junctions').default === '1', 'junctions default 1');
  assert(c.movements.arc.template.indexOf('turn_arc') >= 0, 'a movement the old save never had is backfilled');
  assert(!('defaultSpeed' in c) && !('forwardTemplate' in c), 'old keys are gone');
});

check('a straight move is LABELLED "Straight" but still STORED as "forward"', () => {
  const RP = fresh();
  // The label is display-only. The key is what save files and the
  // movement lookup (RP.MOVE_TO_MOVEMENT) key off, so renaming the label
  // must not have touched it.
  assert(RP.MOVE_LABELS.forward === 'Straight',
    'expected the display label "Straight", got ' + RP.MOVE_LABELS.forward);
  const { route, e1 } = lRoute(RP);
  const move = RP.findMove(route, e1.id);
  assert(move.move === 'forward',
    'the stored move type must stay "forward", got ' + move.move);
  assert(RP.MOVE_TO_MOVEMENT.forward === 'forward',
    'the movement lookup still keys off the stored type');
  assert(RP.generateCode(route).indexOf('move_distance') >= 0,
    'codegen still resolves the forward template');
});

// ---- turn precision --------------------------------------------------
// The robot integrates these angles into its own idea of its heading, so
// a turn that is emitted-but-rounded, or dropped entirely, is a permanent
// error in that idea. Nothing downstream can recover it.

function cornerRoute(RP) {
  // East 100mm, then south 80mm: a clean 90 degree corner.
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.line.p2, b.line.p1]);
  const route = RP.routes[0];
  const e1 = RP.addMove(route.id, a.line.id, { move: 'forward' });
  const e2 = RP.addMove(route.id, b.line.id, { move: 'forward' });
  return { route, e1, e2 };
}

function turnAngles(code) {
  return (code.match(/turn_in_place\((-?[\d.]+)/g) || [])
    .map(m => Number(m.replace('robot.turn_in_place(', '').replace('turn_in_place(', '')));
}

check('a typed turn close to the auto one leaves the remainder, it is not swallowed', () => {
  const RP = fresh();
  const { route, e2 } = cornerRoute(RP);
  // 89.6 where the geometry wants 90: the 0.4 remainder used to fall under
  // the old 0.5 degree threshold and vanish, while the planner still
  // advanced its heading the full 90.
  RP.insertFixedTurn(route.id, e2.id, { angle: 89.6 });
  RP.rebuildRouteViews();
  const angles = turnAngles(RP.generateCode(route));
  assert(angles.length === 2, 'expected the typed turn AND its remainder, got ' + JSON.stringify(angles));
  assertClose(angles[0], 89.6, 1e-9, 'the typed angle, verbatim');
  assertClose(angles[1], 0.4, 1e-9, 'and the remainder the geometry still needs');
  assertClose(angles[0] + angles[1], 90, 1e-9,
    'the emitted turns must sum to the angle the corner actually is');
});

check('the remainder survives however small it is', () => {
  for (const typed of [89.9, 89.99, 89.999]) {
    const RP = fresh();
    const { route, e2 } = cornerRoute(RP);
    RP.insertFixedTurn(route.id, e2.id, { angle: typed });
    RP.rebuildRouteViews();
    const angles = turnAngles(RP.generateCode(route));
    assertClose(angles.reduce((a, b) => a + b, 0), 90, 1e-6,
      'typed ' + typed + ' should still sum to 90, got ' + JSON.stringify(angles));
  }
});

check('a remainder too small to print is the only one dropped', () => {
  const RP = fresh();
  const { route, e2 } = cornerRoute(RP);
  // Below half of the last emitted decimal place, so printing it would
  // give exactly "0.000" — dropping it loses nothing that was ever said.
  RP.insertFixedTurn(route.id, e2.id, { angle: 90 - RP.turnEpsilonDeg() / 2 });
  RP.rebuildRouteViews();
  const angles = turnAngles(RP.generateCode(route));
  assert(angles.length === 1,
    'a sub-printable remainder should not add a no-op turn, got ' + JSON.stringify(angles));
});

check('angles are emitted at CODE_DECIMALS places, not rounded to one', () => {
  const RP = fresh();
  const { route, e2 } = cornerRoute(RP);
  RP.insertFixedTurn(route.id, e2.id, { angle: 12.3456 });
  RP.rebuildRouteViews();
  const code = RP.generateCode(route);
  assert(RP.CODE_DECIMALS === 3, 'this test assumes 3dp');
  assert(code.indexOf('turn_in_place(12.346') >= 0,
    'the typed angle should survive to 3dp, got:\n' + code);
});

check('distances are emitted at CODE_DECIMALS places too', () => {
  const RP = fresh();
  // 100 x 80 px is a hypotenuse of 128.0624...px, and this fixture runs at
  // 2 px/mm, so 64.031mm.
  const l = RP.addConstructionLine(0, 0, 100, 80);
  const route = RP.routes[0];
  RP.addMove(route.id, l.line.id, { move: 'forward' });
  const code = RP.generateCode(route);
  assert(code.indexOf('move_distance(64.031') >= 0,
    'distance should keep 3dp, got:\n' + code);
});

check('formatDeg shows a residual honestly instead of rounding it to zero', () => {
  const RP = fresh();
  assert(RP.formatDeg(0.4) === '0.4', 'got ' + RP.formatDeg(0.4));
  assert(RP.formatDeg(0.469) === '0.469', 'got ' + RP.formatDeg(0.469));
  // Trailing zeros trimmed, so the common case stays readable.
  assert(RP.formatDeg(90) === '90', 'got ' + RP.formatDeg(90));
  assert(RP.formatDeg(-45.5) === '-45.5', 'got ' + RP.formatDeg(-45.5));
});

if (!report()) process.exitCode = 1;
