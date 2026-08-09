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
  const e1 = RP.addRouteElement(route.id, a.line.id, { move: 'forward' });
  const e2 = RP.addRouteElement(route.id, b.line.id, { move: 'forward' });
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

  RP.moveRouteElement(route.id, e2.id, 0);
  assert(route.elements[0].id === e2.id, 'move actually reordered');

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
  RP.removeRouteElement(route.id, e2.id);
  assert(route.elements.length === 1, 'one move left');
  assert(autos(route).length === 1, 'and one auto turn, got ' + autos(route).length);
});

// ---- headings the planner cannot know --------------------------------
check('no turn is derived across a teleport', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setRouteElementProps(route.id, e1.id, { move: 'teleport' });
  const ts = RP.computeSteps(route).filter(s => s.kind === 'turn');
  assert(ts.length === 0, 'arriving heading is unknown, so there is nothing to derive');
});

check('resolveTimeline reports unknown headings rather than guessing', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  RP.setRouteElementProps(route.id, e1.id, { move: 'teleport' });
  const tl = RP.resolveTimeline(route);
  assert(tl.ok, 'should still resolve');
  const tele = tl.items.filter(i => i.kind === 'move')[0];
  assert(tele.entryHeading === null && tele.exitHeading === null,
    'a teleport has no knowable heading at either end');
});

// ---- compat view -----------------------------------------------------
check('route.elements aliases the live move actions', () => {
  const RP = fresh();
  const { route, e1 } = lRoute(RP);
  assert(route.elements[0] === e1, 'the view must hand back the real action, not a copy');
  route.elements[0].speed = 321;
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
  RP.nextElementId = 200;
  RP.migrateRoutesToElements();

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

  assert(spin.indexOf('robot.turn_arc(angle=90.0') >= 0,
    'blank pivot template emits the ordinary turn');
  assert(pivot.indexOf('robot.pivot_left(90.0, 200)') >= 0,
    'a filled-in pivot template is used instead, got:\n' + pivot);
});

if (!report()) process.exitCode = 1;
