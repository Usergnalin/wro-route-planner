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
  RP.setActionProps(route.id, corner.id, { speed: 120 });

  const turnSteps = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assert(turnSteps.length === 1, 'one geometric turn at the corner');
  assertClose(turnSteps[0].deg, 90, 1e-9, 'right-angle corner');
  assert(turnSteps[0].speed === 120, 'turn speed came from the turn action');
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
  const inserted = RP.insertFixedTurn(route.id, e2.id, { angle: 30, speed: 90 });
  assert(inserted && inserted.angleMode === 'fixed', 'inserted a fixed turn');

  const ts = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assert(ts.length === 2, 'the typed turn and the geometric one, got ' + ts.length);
  assertClose(ts[0].deg, 30, 1e-9, 'typed turn comes first');
  assert(ts[0].speed === 90, 'typed turn keeps its own speed');
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
  RP.setActionProps(route.id, autos(route)[1].id, { speed: 175, style: 'pivot_right' });

  RP.reorderMove(route.id, e2.id, 0);
  assert(RP.moveActions(route)[0].id === e2.id, 'move actually reordered');

  const carried = autos(route).filter(t => t.speed === 175);
  assert(carried.length === 1, 'the 175 turn survived the reorder');
  assert(carried[0].style === 'pivot_right', 'and kept its style');
});

check('reversing the route negates typed turns and keeps auto speeds', () => {
  const RP = fresh();
  const { route, e2 } = lRoute(RP);
  RP.insertFixedTurn(route.id, e2.id, { angle: 30, speed: 90 });
  RP.setActionProps(route.id, autos(route)[1].id, { speed: 175 });

  RP.reverseRouteDirection(route);

  assert(RP.resolveRoute(route).ok, 'reversed route must still resolve');
  const fixed = turns(route).filter(t => t.angleMode === 'fixed');
  assert(fixed.length === 1 && fixed[0].angle === -30,
    'a typed turn swings the other way when the route is walked backwards');
  assert(autos(route).some(t => t.speed === 175), 'junction speed survived the reversal');
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
  RP.moveActions(route)[0].speed = 321;
  assert(RP.findAction(route, e1.id).speed === 321, 'writes reach the model');
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
  assert(auto2.speed === 140, 'el.turnSpeed became the junction turn speed');
  const fixedTurns = turns(route).filter(t => t.angleMode === 'fixed');
  assert(fixedTurns[0].angle === 15 && fixedTurns[0].speed === 70, 'extra turn lifted');
  assert(fixedTurns[1].angle === 180 && fixedTurns[1].speed === 60, 'end turn lifted');
});

check('a blank pivot template falls back to the spin template', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.setActionProps(route.id, autos(route)[1].id, { style: 'pivot_left' });
  const spin = RP.generateCode(route);

  RP.codeConfig.turnPivotLeftTemplate = 'robot.pivot_left({angle}, {speed})';
  const pivot = RP.generateCode(route);

  assert(spin.indexOf('robot.turn_in_place(90.0') >= 0,
    'blank pivot template emits the ordinary turn');
  assert(pivot.indexOf('robot.pivot_left(90.0, 200)') >= 0,
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
  const eA = RP.appendGeometryToRoute(a.line.id);
  const eB = RP.appendGeometryToRoute(b.line.id);

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
  const eA = RP.appendGeometryToRoute(a.line.id);
  const eB = RP.appendGeometryToRoute(b.line.id);

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

// ---- {extra_args}: raw user text spliced into an action's own template --
check('extraArgs is blank by default on a fresh move, turn and checkpoint', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  assert(e1.extraArgs === '', 'a fresh move starts with no extra args');
  assert(autos(route)[0].extraArgs === '', 'a fresh auto turn starts with no extra args');
  const cp = RP.insertCheckpoint(route.id, e1.id, 'cp');
  assert(cp.extraArgs === '', 'a fresh checkpoint starts with no extra args');
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
  assert(!/\{extra_args\}/.test(code), 'a missing extraArgs field must fall back to blank, not leak the token');
});

check('extraArgs on a forward move lands only on that move’s own line', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setMoveProps(route.id, e1.id, { extraArgs: ', blocking=True' });
  const code = RP.generateCode(route);
  const lines = code.split('\n').filter(l => l.indexOf('move_distance') >= 0);
  assert(lines.length === 2, 'both legs still generate a move line, got ' + lines.length);
  assert(lines[0].indexOf('blocking=True') >= 0, 'the first move carries its own extra args');
  assert(lines[1].indexOf('blocking=True') < 0, 'the second move must not inherit the first’s extra args');
});

check('extraArgs on a turn lands only on that turn’s own line', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  const corner = autos(route)[1];
  RP.setActionProps(route.id, corner.id, { extraArgs: ', slow=True' });
  const code = RP.generateCode(route);
  const lines = code.split('\n').filter(l => l.indexOf('turn_in_place') >= 0);
  assert(lines.length === 1, 'one geometric turn at the corner, got ' + lines.length);
  assert(lines[0].indexOf('slow=True') >= 0, 'the corner turn carries its extra args, got:\n' + code);
});

check('extraArgs on a checkpoint lands inside its own call', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  const cp = RP.insertCheckpoint(route.id, e1.id, 'grab');
  RP.setActionProps(route.id, cp.id, { extraArgs: "reason='junction'" });
  const code = RP.generateCode(route);
  assert(/if callable\(grab\): grab\(reason='junction'\)/.test(code),
    'expected the extra args inside the checkpoint call, got:\n' + code);
});

// ---- per-move-kind default speeds ---------------------------------------
check('with no overrides, every kind falls back to the plain global default', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.codeConfig.defaultSpeed = 175;
  const code = RP.generateCode(route);
  assert(code.indexOf('power=175') >= 0 && code.indexOf('power=200') < 0,
    'both the move and the turn should use the global default, got:\n' + code);
});

check('a per-kind default speed is used when the action has no explicit speed', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.codeConfig.defaultSpeed = 200;
  RP.codeConfig.defaultSpeedForward = 350;
  const code = RP.generateCode(route);
  const moveLines = code.split('\n').filter(l => l.indexOf('move_distance') >= 0);
  assert(moveLines.every(l => l.indexOf('power=350') >= 0),
    'every forward move should pick up its kind default, got:\n' + code);
  const turnLines = code.split('\n').filter(l => l.indexOf('turn_in_place') >= 0);
  assert(turnLines.every(l => l.indexOf('power=200') >= 0),
    'turns must not be affected by the forward-only override, got:\n' + code);
});

check('an action’s own explicit speed still beats its kind’s default', () => {
  const RP = fresh();
  const { route, e1, e2 } = lRoute(RP);
  RP.codeConfig.defaultSpeedForward = 350;
  RP.setMoveProps(route.id, e1.id, { speed: 77 });
  const code = RP.generateCode(route);
  const moveLines = code.split('\n').filter(l => l.indexOf('move_distance') >= 0);
  assert(moveLines[0].indexOf('power=77') >= 0, 'the explicit speed must win over the kind default, got:\n' + code);
  assert(moveLines[1].indexOf('power=350') >= 0, 'the other move still gets the kind default, got:\n' + code);
});

check('different kinds use independent defaults, not each other’s', () => {
  const RP = fresh();
  const { route } = lRoute(RP);
  RP.codeConfig.defaultSpeedForward = 111;
  RP.codeConfig.defaultSpeedTurn = 222;
  const code = RP.generateCode(route);
  assert(code.split('\n').filter(l => l.indexOf('move_distance') >= 0).every(l => l.indexOf('power=111') >= 0),
    'forward moves should use defaultSpeedForward, got:\n' + code);
  assert(code.split('\n').filter(l => l.indexOf('turn_in_place') >= 0).every(l => l.indexOf('power=222') >= 0),
    'turns should use defaultSpeedTurn, got:\n' + code);
});

check('per-kind speeds default to null once ensured, so old save files are unaffected', () => {
  const RP = fresh();
  // ensureCodeConfig backfills fields an old save file never had — the
  // same path a v4/v5 project takes on open, and the one generateCode
  // itself calls before every run.
  RP.ensureCodeConfig();
  const keys = ['defaultSpeedForward', 'defaultSpeedTurn', 'defaultSpeedArc',
                'defaultSpeedWallAlign', 'defaultSpeedLineTraceDist', 'defaultSpeedLineTraceJunct'];
  for (const k of keys) assert(RP.codeConfig[k] === null, k + ' should default to null, got ' + RP.codeConfig[k]);
});

check('a straight move is LABELLED "Straight" but still STORED as "forward"', () => {
  const RP = fresh();
  // The label is display-only. The key is what save files, generated code
  // and RP.STEP_KIND_SPEED_KEYS all key off, so renaming the label must
  // not have touched it.
  assert(RP.MOVE_LABELS.forward === 'Straight',
    'expected the display label "Straight", got ' + RP.MOVE_LABELS.forward);
  const { route, e1 } = lRoute(RP);
  const move = RP.findMove(route, e1.id);
  assert(move.move === 'forward',
    'the stored move type must stay "forward", got ' + move.move);
  assert(RP.STEP_KIND_SPEED_KEYS.forward === 'defaultSpeedForward',
    'the per-kind speed lookup still keys off the stored type');
  assert(RP.generateCode(route).indexOf('move_distance') >= 0,
    'codegen still resolves the forward template');
});

if (!report()) process.exitCode = 1;
