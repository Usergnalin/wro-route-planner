/* ========================================================================
   field.js - Phase 7: field walls as fixed geometry, and wall_align
   trusting the geometry the user drew.

     node tests/field.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('field + wall align');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  ['render', 'updateLayerList', 'updateInfoPanel', 'updateInstructions',
   'updateConstraintPanel', 'updateRouteSelect', 'updateSideRouteList']
    .forEach(k => { RP[k] = function () {}; });
  RP.calibration = { pixelsPerMm: 2 };        // 2 px = 1 mm
  RP.imgNaturalW = 2000;
  RP.imgNaturalH = 1200;
  RP.scale = 1;
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

// A line running at the right-hand wall, stopping 50 px short of it.
function approachRightWall(RP) {
  RP.createFieldBoundary();
  const lead = RP.addConstructionLine(1000, 600, 1950, 600);
  RP.setEditMode('route');
  const el = RP.addGeometryToRoute(lead.line.id);
  return { lead, el, route: RP.routes[0] };
}

function rightWallId(RP) {
  return RP.fieldLineIds().filter(id =>
    RP.constructionMeta[id].label === 'right wall')[0];
}

// ---- the constraint itself -------------------------------------------
check('point_line_distance holds a point off a line', () => {
  const RP = fresh();
  const S = RP.Sketch, sk = RP.sketch;
  const a = S.addPoint(sk, 0, 0), b = S.addPoint(sk, 100, 0);
  const p = S.addPoint(sk, 50, 12);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'fix', [b.id]);
  S.addConstraint(sk, 'point_line_distance', [p.id, line.id], 40);
  const res = S.solve(sk);
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  assertClose(p.y, 40, 1e-7, 'point should stand 40 off the line');
});

check('the distance is signed, so the point keeps its side', () => {
  const RP = fresh();
  const S = RP.Sketch, sk = RP.sketch;
  const a = S.addPoint(sk, 0, 0), b = S.addPoint(sk, 100, 0);
  const p = S.addPoint(sk, 50, -12);        // starts on the far side
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'fix', [b.id]);
  S.addConstraint(sk, 'point_line_distance', [p.id, line.id], -40);
  assert(S.solve(sk).ok, 'solve failed');
  assertClose(p.y, -40, 1e-7, 'negative target keeps it on that side');
});

check('point_on_line still behaves as distance zero', () => {
  const RP = fresh();
  const S = RP.Sketch, sk = RP.sketch;
  const a = S.addPoint(sk, 0, 0), b = S.addPoint(sk, 100, 0);
  const p = S.addPoint(sk, 50, 30);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'fix', [b.id]);
  S.addConstraint(sk, 'point_on_line', [p.id, line.id]);
  assert(S.solve(sk).ok, 'solve failed');
  assertClose(p.y, 0, 1e-7, 'shared implementation must not have drifted');
});

// ---- field boundary ---------------------------------------------------
check('field boundary is four rigid walls', () => {
  const RP = fresh();
  const lines = RP.createFieldBoundary();
  assert(lines.length === 4, 'four walls');
  assert(RP.fieldLineIds().length === 4, 'all tagged as field geometry');
  const res = RP.solveSketch();
  assert(res.status === 'full', 'walls should be fully constrained, got ' + res.status);
  assert(res.dof === 0, 'no freedom left in the boundary');
});

check('field walls sit on the image bounds and are named', () => {
  const RP = fresh();
  RP.createFieldBoundary();
  const walls = {};
  RP.fieldLineIds().forEach(id => { walls[RP.constructionMeta[id].label] = id; });
  for (const n of ['top wall', 'right wall', 'bottom wall', 'left wall']) {
    assert(walls[n] !== undefined, 'missing ' + n);
  }
  const view = RP.lines.filter(l => l.id === walls['right wall'])[0];
  assertClose(view.x1, 2000, 1e-9, 'right wall on the image edge');
  assertClose(view.x2, 2000, 1e-9, 'right wall on the image edge');
});

check('adding the boundary twice replaces rather than duplicates', () => {
  const RP = fresh();
  RP.createFieldBoundary();
  RP.createFieldBoundary();
  assert(RP.fieldLineIds().length === 4, 'still four walls');
});

check('removing the boundary leaves no orphan geometry', () => {
  const RP = fresh();
  RP.createFieldBoundary();
  RP.removeFieldBoundary();
  assert(RP.fieldLineIds().length === 0, 'walls gone');
  assert(RP.Sketch.entityIds(RP.sketch).length === 0, 'corners gone too');
});

check('nearestFieldLine picks the wall actually being approached', () => {
  const RP = fresh();
  RP.createFieldBoundary();
  const p = RP.Sketch.addPoint(RP.sketch, 1950, 600);
  assert(RP.nearestFieldLine(p.id) === rightWallId(RP), 'expected the right wall');
});

// ---- wall_align -------------------------------------------------------
// A wall align says what the robot DOES at the end of a leg. It is not a
// reason to move where the leg ends — the drawing is trusted, exactly as
// it is for a line trace.
check('making a move a wall align does not move the geometry', () => {
  const RP = fresh();
  const { el, route, lead } = approachRightWall(RP);
  const before = { x: RP.sketch.entities[lead.p2.id].x, y: RP.sketch.entities[lead.p2.id].y };
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });

  assertClose(RP.sketch.entities[lead.p2.id].x, before.x, 1e-9, 'x must not shift');
  assertClose(RP.sketch.entities[lead.p2.id].y, before.y, 1e-9, 'y must not shift');
  assert(!RP.wallConstraintFor(RP.sketch, lead.p2.id),
    'no constraint the user did not ask for');
  assert(RP.resolveRoute(route).ok, 'route still resolves');
});

check('reversing a wall align does not move it either', () => {
  const RP = fresh();
  const { el, lead } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  RP.updateSelectedMove({ reverse: true });
  assertClose(RP.sketch.entities[lead.p2.id].x, 1950, 1e-9,
    'front/rear overhang is not the planner\'s business any more');
});

check('a point drawn onto a wall stays on the wall', () => {
  const RP = fresh();
  RP.createFieldBoundary();
  const wall = rightWallId(RP);
  const lead = RP.addConstructionLine(1000, 600, 2000, 600);
  RP.Sketch.addConstraint(RP.sketch, 'point_on_line', [lead.p2.id, wall]);
  RP.setEditMode('route');
  const el = RP.addGeometryToRoute(lead.line.id);

  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });

  const onLine = RP.Sketch.constraintsOn(RP.sketch, lead.p2.id)
    .filter(c => c.type === 'point_on_line' && c.refs[1] === wall);
  assert(onLine.length === 1, 'a constraint the user drew must survive');
  assert(RP.sketch.status !== 'conflict', 'and must not be fought with a second one');
  assertClose(RP.sketch.entities[lead.p2.id].x, 2000, 1e-6, 'left where it was drawn');
});

check('leaving wall_align leaves the sketch alone too', () => {
  const RP = fresh();
  const { el, lead } = approachRightWall(RP);
  // A distance-to-wall constraint the USER applied, as a pre-2026-08-30
  // project would also have.
  RP.Sketch.addConstraint(RP.sketch, 'point_line_distance',
    [lead.p2.id, rightWallId(RP)], -100);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  RP.updateSelectedMove({ move: 'forward' });
  assert(RP.wallConstraintFor(RP.sketch, lead.p2.id),
    'switching modes must never delete a constraint');
});

check('wall_align still generates its move', () => {
  const RP = fresh();
  const { el, route } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  const code = RP.generateCode(route);
  assert(/wall_align/.test(code), 'expected a wall_align call, got:\n' + code);
});

// ---- which wall it squares against ------------------------------------
// Read out of the drawing for the simulator's benefit, never written back.
check('the wall is the nearest one to where the move ends', () => {
  const RP = fresh();
  const { el } = approachRightWall(RP);
  assert(RP.wallAlignTarget(RP.sketch, el) === rightWallId(RP),
    'the leg ends 50px from the right wall');
});

check('an explicit constraint names the wall instead of proximity', () => {
  const RP = fresh();
  RP.createFieldBoundary();
  const lead = RP.addConstructionLine(1000, 600, 1950, 600);
  const bottom = RP.fieldLineIds().filter(id =>
    RP.constructionMeta[id].label === 'bottom wall')[0];
  RP.Sketch.addConstraint(RP.sketch, 'point_line_distance', [lead.p2.id, bottom], -1200);
  RP.setEditMode('route');
  const el = RP.addGeometryToRoute(lead.line.id);
  assert(RP.wallAlignTarget(RP.sketch, el) === bottom,
    'a constraint the user drew says which wall this is about');
});

// ---- {expected_distance} ----------------------------------------------
// The leg AS DRAWN — so a real robot can slow down on approach instead of
// driving blind the whole way.
check('expected_distance is the drawn leg length', () => {
  const RP = fresh();
  const { el, route } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  // 1000 -> 1950 at 2px/mm is 475mm.
  const code = RP.generateCode(route);
  assert(/expected_distance=475(\.0+)?/.test(code),
    'expected_distance should be the leg the user drew, got:\n' + code);
});

check('moving the geometry moves expected_distance with it', () => {
  const RP = fresh();
  const { el, route, lead } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  RP.Sketch.addConstraint(RP.sketch, 'point_line_distance',
    [lead.p2.id, rightWallId(RP)], 160);         // 80mm off the right wall
  RP.solveSketch();
  RP.rebuildRouteViews();
  const code = RP.generateCode(route);
  assert(/expected_distance=420(\.0+)?/.test(code),
    'the drawing is the source of truth, got:\n' + code);
});

// ---- {extra_args} -------------------------------------------------------
// A user-typed string spliced verbatim into the template, for whatever a
// project's own robot API needs that no built-in placeholder covers.
check('extraArgs is blank by default and does not touch the template', () => {
  const RP = fresh();
  const { el, route } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  const code = RP.generateCode(route);
  assert(!/\{extra_args\}/.test(code), 'the placeholder itself must never leak into output');
  // Decimal places deliberately not pinned — see tests/action.js.
  assert(/wall_align\(reversed=False, power=200, expected_distance=475(\.0+)?\)/.test(code),
    'blank extraArgs should vanish cleanly, got:\n' + code);
});

check('extraArgs on a wall_align move is spliced into its own line only', () => {
  const RP = fresh();
  const { el, route } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align', extraArgs: ', blocking=True' });
  const code = RP.generateCode(route);
  assert(/wall_align\([^)]*, blocking=True\)/.test(code),
    'expected the user text appended verbatim, got:\n' + code);
});

check('defaultSpeedWallAlign overrides the global default for wall_align only', () => {
  const RP = fresh();
  const { el, route } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  RP.codeConfig.defaultSpeed = 200;
  RP.codeConfig.defaultSpeedWallAlign = 60;   // approach a wall slower than everything else
  const code = RP.generateCode(route);
  assert(/wall_align\(reversed=False, power=60,/.test(code),
    'wall_align should pick up its own kind default, got:\n' + code);
});

if (!report()) process.exitCode = 1;
