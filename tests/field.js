/* ========================================================================
   field.js - Phase 7: field walls as fixed geometry, wall_align as a
   real distance constraint.

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
  RP.robotConfig.frontClearance = 50;         // mm
  RP.robotConfig.rearClearance = 30;          // mm
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

// A line running at the right-hand wall, stopping 50 px short of it.
function approachRightWall(RP) {
  RP.createFieldBoundary();
  const lead = RP.addConstructionLine(1000, 600, 1950, 600);
  RP.setEditMode('route');
  const el = RP.appendGeometryToRoute(lead.line.id);
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

// ---- wall_align --------------------------------------------------------
check('making an element a wall align constrains it off the wall', () => {
  const RP = fresh();
  const { el, route, lead } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });

  const sk = RP.sketch;
  const c = RP.wallConstraintFor(sk, lead.p2.id);
  assert(c, 'a distance-to-wall constraint should exist');
  assert(c.refs[1] === rightWallId(RP), 'against the right wall');
  // 50 mm front clearance at 2 px/mm = 100 px, so x = 2000 - 100
  assertClose(sk.entities[lead.p2.id].x, 1900, 1e-6,
    'the solver should stand the robot off the wall');
  assert(RP.resolveRoute(route).ok, 'route still resolves');
});

check('changing clearance moves the stopping point', () => {
  const RP = fresh();
  const { el, lead } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });

  RP.robotConfig.frontClearance = 80;        // mm -> 160 px
  RP.syncAllWallAligns();
  assertClose(RP.sketch.entities[lead.p2.id].x, 1840, 1e-6,
    'clearance now drives the position through the solver');
});

check('driving backwards uses the rear clearance', () => {
  const RP = fresh();
  const { el, lead } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  assertClose(RP.sketch.entities[lead.p2.id].x, 1900, 1e-6, 'front clearance first');

  RP.updateSelectedMove({ reverse: true });   // rear clearance is 30 mm = 60 px
  assertClose(RP.sketch.entities[lead.p2.id].x, 1940, 1e-6,
    'reversing should switch to the rear clearance');
});

check('leaving wall_align drops the constraint', () => {
  const RP = fresh();
  const { el, lead } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  assert(RP.wallConstraintFor(RP.sketch, lead.p2.id), 'setup');

  RP.updateSelectedMove({ move: 'forward' });
  assert(!RP.wallConstraintFor(RP.sketch, lead.p2.id),
    'a plain forward move should not be pinned to a wall');
});

check('a point drawn onto a wall is stood off it, not left conflicting', () => {
  const RP = fresh();
  RP.createFieldBoundary();
  const wall = rightWallId(RP);
  // As if the user drew a line to the wall and it auto-constrained.
  const lead = RP.addConstructionLine(1000, 600, 2000, 600);
  RP.Sketch.addConstraint(RP.sketch, 'point_on_line', [lead.p2.id, wall]);
  RP.setEditMode('route');
  const el = RP.appendGeometryToRoute(lead.line.id);

  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });

  const onLine = RP.Sketch.constraintsOn(RP.sketch, lead.p2.id)
    .filter(c => c.type === 'point_on_line' && c.refs[1] === wall);
  assert(onLine.length === 0, 'the on-the-wall constraint must be replaced');
  assert(RP.sketch.status !== 'conflict', 'and must not leave a conflict');
  assertClose(RP.sketch.entities[lead.p2.id].x, 1900, 1e-6, 'stood off by clearance');
});

check('wall_align still generates its move', () => {
  const RP = fresh();
  const { el, route } = approachRightWall(RP);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ move: 'wall_align' });
  const code = RP.generateCode(route);
  assert(/wall_align/.test(code), 'expected a wall_align call, got:\n' + code);
});

if (!report()) process.exitCode = 1;
