/* ========================================================================
   arc.js - Phase 8: arcs as real sketch entities.

     node tests/arc.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('arcs');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  ['render', 'updateLayerList', 'updateInfoPanel', 'updateInstructions',
   'updateConstraintPanel', 'updateRouteSelect', 'updateSideRouteList']
    .forEach(k => { RP[k] = function () {}; });
  RP.calibration = { pixelsPerMm: 2 };
  RP.imgNaturalW = 2000;
  RP.imgNaturalH = 1200;
  RP.scale = 1;
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

function legacyArcRoute(RP, sagitta) {
  const route = { id: 1, name: 'Legacy', visible: true, nodes: [], segments: [] };
  RP.routes = [route];
  RP.nextWpId = 1; RP.nextSegId = 1;
  const a = { id: 1, x: 200, y: 200, isCheckpoint: false, checkpointName: null };
  const b = { id: 2, x: 600, y: 200, isCheckpoint: false, checkpointName: null };
  route.nodes.push(a, b);
  route.segments.push({
    id: 1, fromNodeId: a.id, toNodeId: b.id,
    direction: 'forward', mode: 'arc', sagitta: sagitta
  });
  return route;
}

// ---- geometry ---------------------------------------------------------
check('addConstructionArc builds an arc with a real centre point', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0);
  assert(made, 'arc should be created');
  const sk = RP.sketch;
  assert(sk.entities[made.arc.id].type === 'arc', 'entity is an arc');
  assert(sk.entities[made.center.id].type === 'point', 'centre is a point entity');
  assert(RP.arcs.length === 1, 'arc view populated');
  assertClose(RP.arcs[0].x1, 0, 1e-9, 'endpoint kept');
  assertClose(RP.arcs[0].x2, 200, 1e-9, 'endpoint kept');
});

check('arc geometry reports a consistent radius and sweep', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 50 });
  const g = RP.Sketch.arcGeometry(RP.sketch, RP.sketch.entities[made.arc.id]);
  assert(g, 'geometry resolves');
  // Both endpoints must be one radius from the centre.
  const sk = RP.sketch, c = sk.entities[made.center.id];
  const r1 = Math.hypot(sk.entities[made.p1.id].x - c.x, sk.entities[made.p1.id].y - c.y);
  const r2 = Math.hypot(sk.entities[made.p2.id].x - c.x, sk.entities[made.p2.id].y - c.y);
  assertClose(r1, g.radius, 1e-6, 'p1 on the circle');
  assertClose(r2, g.radius, 1e-6, 'p2 on the circle');
  assert(Math.abs(g.sweep) > 0, 'a real sweep');
});

check('arc polyline pins its endpoints exactly', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(10, 20, 210, 20, { sagitta: 40 });
  const pts = RP.Sketch.arcPoints(RP.sketch, RP.sketch.entities[made.arc.id], 24);
  assert(pts.length === 25, 'expected 25 points, got ' + pts.length);
  assertClose(pts[0].x, 10, 1e-9); assertClose(pts[0].y, 20, 1e-9);
  assertClose(pts[24].x, 210, 1e-9); assertClose(pts[24].y, 20, 1e-9);
});

check('the equal-radius equation keeps the arc coherent under a drag', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 50 });
  const sk = RP.sketch;
  RP.Sketch.dragPoint(sk, made.center.id, 100, 90);
  RP.rebuildLines();
  const c = sk.entities[made.center.id];
  const r1 = Math.hypot(sk.entities[made.p1.id].x - c.x, sk.entities[made.p1.id].y - c.y);
  const r2 = Math.hypot(sk.entities[made.p2.id].x - c.x, sk.entities[made.p2.id].y - c.y);
  assertClose(r1, r2, 1e-6, 'both endpoints stay on one circle');
});

// ---- arc constraints ---------------------------------------------------
check('radius constrains the arc size', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 50 });
  const sk = RP.sketch;
  RP.Sketch.addConstraint(sk, 'fix', [made.center.id]);
  RP.Sketch.addConstraint(sk, 'radius', [made.arc.id], 160);
  const res = RP.solveSketch();
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  const g = RP.Sketch.arcGeometry(sk, sk.entities[made.arc.id]);
  assertClose(g.radius, 160, 1e-6, 'radius should be driven');
});

check('point_on_arc puts a loose point onto the circle', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  const sk = RP.sketch;
  RP.Sketch.addConstraint(sk, 'fix', [made.center.id]);
  RP.Sketch.addConstraint(sk, 'fix', [made.p1.id]);
  const loose = RP.Sketch.addPoint(sk, 40, 40);
  RP.Sketch.addConstraint(sk, 'point_on_arc', [loose.id, made.arc.id]);
  const res = RP.solveSketch();
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  const g = RP.Sketch.arcGeometry(sk, sk.entities[made.arc.id]);
  const d = Math.hypot(loose.x - g.cx, loose.y - g.cy);
  assertClose(d, g.radius, 1e-6, 'the point should land on the circle');
});

check('tangent stands the centre one radius off the line', () => {
  const RP = fresh();
  const sk = RP.sketch;
  const la = RP.Sketch.addPoint(sk, 0, 0), lb = RP.Sketch.addPoint(sk, 200, 0);
  const line = RP.Sketch.addLine(sk, la.id, lb.id);
  RP.constructionMeta[line.id] = { label: null, visible: true };
  RP.Sketch.addConstraint(sk, 'fix', [la.id]);
  RP.Sketch.addConstraint(sk, 'fix', [lb.id]);

  const made = RP.addConstructionArc(150, -60, 100, -110, { sagitta: 20 });
  RP.Sketch.addConstraint(sk, 'radius', [made.arc.id], 50);
  RP.Sketch.addConstraint(sk, 'tangent', [line.id, made.arc.id]);
  const res = RP.solveSketch();
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));

  const g = RP.Sketch.arcGeometry(sk, sk.entities[made.arc.id]);
  const d = RP.Sketch.perpDistance(sk, made.center.id, line.id);
  assertClose(g.radius, 50, 1e-6, 'radius held');
  assertClose(Math.abs(d), 50, 1e-6, 'centre stands one radius off the line');
  assert(d < 0, 'and stays on the side it started');
});

// ---- routes referencing arcs -------------------------------------------
check('an arc can be a route element and defaults to an arc move', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 50 });
  RP.setEditMode('route');
  const el = RP.addGeometryToRoute(made.arc.id);
  assert(el, 'arc should be addable to the route');
  assert(el.move === 'arc', 'expected an arc move, got ' + el.move);
  assert(RP.resolveRoute(RP.routes[0]).ok, 'route should resolve');
});

check('moves offered depend on the geometry type', () => {
  const RP = fresh();
  assert(RP.movesForEntity('arc').indexOf('forward') < 0, 'an arc cannot drive straight');
  assert(RP.movesForEntity('arc').indexOf('arc') >= 0, 'an arc can drive an arc');
  assert(RP.movesForEntity('line').indexOf('arc') < 0, 'a line cannot drive an arc');
  assert(RP.movesForEntity('line').indexOf('wall_align') >= 0, 'a line can wall align');
});

check('an arc element generates an arc move', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(200, 200, 600, 200, { sagitta: 80 });
  RP.setEditMode('route');
  RP.addGeometryToRoute(made.arc.id);
  const code = RP.generateCode(RP.routes[0]);
  assert(/turn_arc/.test(code), 'expected an arc call, got:\n' + code);
});

// ---- migration ----------------------------------------------------------
check('legacy sagitta arcs migrate into real arc entities', () => {
  const RP = fresh();
  const route = legacyArcRoute(RP, 80);
  RP.migrateRoutesToActions();

  const el = RP.moveActions(route)[0];
  const ent = RP.sketch.entities[el.entityId];
  assert(ent.type === 'arc', 'should now be an arc entity, got ' + ent.type);
  assert(el.sagitta === undefined || el.sagitta === null,
    'the sagitta field should be gone from the element');
  assert(RP.arcs.length === 1, 'and it should appear in the arc view');
});

check('migrated arcs keep the geometry the sagitta described', () => {
  const RP = fresh();
  legacyArcRoute(RP, 80);
  // What the old representation said the geometry was.
  const want = RP.computeArcGeom(200, 200, 600, 200, 80);
  RP.migrateRoutesToActions();
  const ent = RP.sketch.entities[RP.moveActions(RP.routes[0])[0].entityId];
  const got = RP.Sketch.arcGeometry(RP.sketch, ent);
  assertClose(got.cx, want.cx, 1e-6, 'centre x');
  assertClose(got.cy, want.cy, 1e-6, 'centre y');
  assertClose(got.radius, want.radiusPx, 1e-6, 'radius');
  assertClose(got.sweep, want.sweepRad, 1e-9, 'sweep direction and extent');
});

// ---- flipping an arc to the other side ---------------------------------
// A semicircle: both endpoints on a fixed line, centre constrained onto
// that line. Fully constrained, so the only freedom left is WHICH of the
// two arcs between the endpoints is meant — a discrete choice.
function semicircleOnLine(RP) {
  const S = RP.Sketch, sk = RP.sketch;
  const lead = RP.addConstructionLine(0, 0, 200, 0);
  S.addConstraint(sk, 'fix', [lead.p1.id]);
  S.addConstraint(sk, 'fix', [lead.p2.id]);
  const arc = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  S.addConstraint(sk, 'coincident', [arc.p1.id, lead.p1.id]);
  S.addConstraint(sk, 'coincident', [arc.p2.id, lead.p2.id]);
  S.addConstraint(sk, 'point_on_line', [arc.center.id, lead.line.id]);
  RP.solveSketch();
  return { lead, arc };
}

function arcApexY(RP, arcId) {
  const pts = RP.Sketch.arcPoints(RP.sketch, RP.sketch.entities[arcId], 32);
  return pts[Math.floor(pts.length / 2)].y;
}

check('the semicircle case is fully constrained', () => {
  const RP = fresh();
  semicircleOnLine(RP);
  const res = RP.solveSketch();
  assert(res.status === 'full', 'expected fully constrained, got ' + res.status);
  assert(res.dof === 0, 'no continuous freedom left');
});

check('no drag can move a constrained arc to the other side', () => {
  const RP = fresh();
  const { arc } = semicircleOnLine(RP);
  const before = arcApexY(RP, arc.arc.id);

  // Haul the centre well past the line, then release (re-solve unpinned).
  RP.Sketch.dragPoint(RP.sketch, arc.center.id, 100, -400);
  const after = RP.solveSketch();
  assert(after.ok, 'should settle back to a valid solution');
  assertClose(arcApexY(RP, arc.arc.id), before, 1e-6,
    'the solver cannot change a discrete choice — it returns to the same side');
});

check('flipArc moves it to the other side and keeps it valid', () => {
  const RP = fresh();
  const { arc } = semicircleOnLine(RP);
  const before = arcApexY(RP, arc.arc.id);
  const gBefore = RP.Sketch.arcGeometry(RP.sketch, RP.sketch.entities[arc.arc.id]);

  assert(RP.flipArc(arc.arc.id), 'flip should succeed');

  const after = arcApexY(RP, arc.arc.id);
  const gAfter = RP.Sketch.arcGeometry(RP.sketch, RP.sketch.entities[arc.arc.id]);
  assertClose(after, -before, 1e-6, 'the apex should mirror across the line');
  assertClose(gAfter.radius, gBefore.radius, 1e-6, 'same circle');
  assertClose(gAfter.cx, gBefore.cx, 1e-6, 'same centre');
  assert(RP.sketch.status === 'full', 'still fully constrained, got ' + RP.sketch.status);
});

check('flipping twice returns to the original', () => {
  const RP = fresh();
  const { arc } = semicircleOnLine(RP);
  const before = arcApexY(RP, arc.arc.id);
  RP.flipArc(arc.arc.id);
  RP.flipArc(arc.arc.id);
  assertClose(arcApexY(RP, arc.arc.id), before, 1e-6, 'back where it started');
});

check('flipping is undoable', () => {
  const RP = fresh();
  const { arc } = semicircleOnLine(RP);
  const before = arcApexY(RP, arc.arc.id);
  RP.pushHistory('Flip arc');
  RP.flipArc(arc.arc.id);
  assertClose(arcApexY(RP, arc.arc.id), -before, 1e-6, 'flipped');
  RP.undo();
  assertClose(arcApexY(RP, arc.arc.id), before, 1e-6, 'undo restores the side');
});

check('flipArc rejects things that are not arcs', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  assert(RP.flipArc(line.line.id) === false, 'a line has no other side');
  assert(RP.flipArc(99999) === false, 'missing entity');
});

// ---- selection ----------------------------------------------------------
check('arcs are hit-testable and selectable', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  RP.setEditMode('sketch');
  RP.setTool('constrain');
  // Apex of the bulge sits near the sagitta offset from the chord midpoint.
  const hit = RP.sketchHitTest(100, 60);
  assert(hit && hit.kind === 'arc' && hit.id === made.arc.id,
    'expected to hit the arc, got ' + JSON.stringify(hit));
  assert(RP.sketchHitTest(100, 600) === null, 'far away should miss');
});

check('clicking an arc in Route mode adds it to the route', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  RP.setEditMode('route');

  // Near the apex of the bulge, well off the chord.
  const hit = RP.routeHitTest(100, 60);
  assert(hit && hit.kind === 'geometry' && hit.id === made.arc.id,
    'route mode should see the arc as addable geometry, got ' + JSON.stringify(hit));

  const el = RP.addGeometryToRoute(hit.id);
  assert(el && el.move === 'arc', 'and it should join the route as an arc');
});

check('an arc element is clickable along its curve, not just its chord', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  RP.setEditMode('route');
  const el = RP.addGeometryToRoute(made.arc.id);

  const onCurve = RP.routeHitTest(100, 60);
  assert(onCurve && onCurve.kind === 'move' && onCurve.id === el.id,
    'the curve should hit the element, got ' + JSON.stringify(onCurve));
  // Well away from both the curve and its chord: nothing.
  assert(RP.routeHitTest(100, 400) === null, 'empty space should still miss');
});

check('deleting an arc takes its centre point with it', () => {
  const RP = fresh();
  RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  const arcId = RP.arcs[0].id;
  RP.removeConstructionLine(arcId);
  assert(RP.arcs.length === 0, 'arc removed');
  assert(RP.Sketch.entityIds(RP.sketch).length === 0,
    'centre and endpoints should not be orphaned');
});

check('arcs appear in the geometry list', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);
  RP.addConstructionArc(0, 100, 200, 100, { sagitta: 40 });
  assert(RP.lines.length === 1 && RP.arcs.length === 1,
    'one of each in the views');
});

check('the arc centre is a draggable sketch point', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  const pts = RP.sketchPoints().map(p => p.id);
  assert(pts.indexOf(made.center.id) >= 0, 'centre should be selectable');
  assert(pts.indexOf(made.p1.id) >= 0, 'endpoints too');
});

check('a radius constraint bolds the arc readout instead of adding a badge', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 50 });
  let ann = RP.buildAnnotations();
  assert(ann[made.arc.id].label, 'arc should carry a radius readout');
  assert(ann[made.arc.id].bold === false, 'not driven yet');

  RP.Sketch.addConstraint(RP.sketch, 'radius', [made.arc.id], 160);
  RP.solveSketch();
  ann = RP.buildAnnotations();
  assert(ann[made.arc.id].bold === true, 'a driven radius should be bold');
  assert(ann[made.arc.id].badges.filter(b => b.type === 'radius').length === 0,
    'and must not also add an overlapping badge');
});

// ---- the S-curve that used to go red ---------------------------------
// line — arc — arc — line, tangent at each straight, as in a chicane.
function sCurve(RP, withDims) {
  const S = RP.Sketch, sk = () => RP.sketch;
  const l1 = RP.addConstructionLine(0, 300, 200, 300);
  S.addConstraint(sk(), 'horizontal', [l1.line.id]);
  S.addConstraint(sk(), 'fix', [l1.p1.id]);
  const s1 = RP.computeSnap(200, 300, { kind: 'point' });
  const a1 = RP.addConstructionArc(200, 300, 350, 200, { startSnap: s1 });
  const s2 = RP.computeSnap(350, 200, { kind: 'point' });
  const a2 = RP.addConstructionArc(350, 200, 500, 100, { startSnap: s2 });
  const s3 = RP.computeSnap(500, 100, { kind: 'point' });
  const l2 = RP.addConstructionLine(500, 100, 700, 100, { startSnap: s3 });
  S.addConstraint(sk(), 'horizontal', [l2.line.id]);
  if (withDims) {
    S.addConstraint(sk(), 'radius', [a1.arc.id], 155);
    S.addConstraint(sk(), 'radius', [a2.arc.id], 210);
  }
  return { l1, a1, a2, l2 };
}

// ---- the runaway/collapse that tangent_at's scale-invariance allowed ---
// tangent_at's residual is (p−c)·û, which says nothing about how long the
// line is. Reaching tangency by walking the far end sideways therefore
// changes the length as a free side effect. RP.seedTangentLine swings the
// line about the shared end first, so the length the user drew survives.
function lineOffArc(RP, offsetDeg, len) {
  const S = RP.Sketch;
  // An arc whose ends are pinned, so only the new line can move.
  const arc = RP.addConstructionArc(0, 0, 0, 200, { sagitta: 60 });
  S.addConstraint(RP.sketch, 'fix', [arc.p1.id]);
  S.addConstraint(RP.sketch, 'fix', [arc.p2.id]);
  S.addConstraint(RP.sketch, 'fix', [arc.center.id]);
  RP.solveSketch();

  const end = RP.sketch.entities[arc.arc.p1];
  const cen = RP.sketch.entities[arc.arc.center];
  // 0° = straight out along the radius, i.e. as far from tangent as it gets.
  const base = Math.atan2(end.y - cen.y, end.x - cen.x) + offsetDeg * Math.PI / 180;
  const made = RP.addConstructionLine(
    end.x, end.y, end.x + Math.cos(base) * len, end.y + Math.sin(base) * len,
    { startSnap: { kind: 'endpoint', pointId: arc.arc.p1 } });
  return { arc, made };
}

function lineLength(RP, made) {
  const l = RP.sketch.entities[made.line.id];
  const a = RP.sketch.entities[l.p1], b = RP.sketch.entities[l.p2];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

check('a line drawn far from tangent keeps the length it was drawn at', () => {
  const RP = fresh();
  // Straight out along the radius: the worst case, 90° from tangent.
  const { made } = lineOffArc(RP, 0, 200);
  assert(made, 'line should have been created');
  assertClose(lineLength(RP, made), 200, 1e-6,
    'the drawn length must survive the tangent auto-constraint');
});

check('the length survives at every angle, not just the easy ones', () => {
  for (const off of [0, 30, 60, 120, 150, 200, 260, 300]) {
    const RP = fresh();
    const { made } = lineOffArc(RP, off, 175);
    if (!made) continue;
    assertClose(lineLength(RP, made), 175, 1e-6,
      'length changed when drawn ' + off + '° from the radius');
  }
});

check('a line drawn far from tangent still ends up genuinely tangent', () => {
  const RP = fresh();
  const { arc, made } = lineOffArc(RP, 0, 200);
  const end = RP.sketch.entities[arc.arc.p1];
  const cen = RP.sketch.entities[arc.arc.center];
  const l = RP.sketch.entities[made.line.id];
  const a = RP.sketch.entities[l.p1], b = RP.sketch.entities[l.p2];
  // The radius vector at the shared end must be perpendicular to the line.
  const wx = end.x - cen.x, wy = end.y - cen.y;
  const dx = b.x - a.x, dy = b.y - a.y;
  const cosang = (wx * dx + wy * dy) / (Math.hypot(wx, wy) * Math.hypot(dx, dy));
  assert(Math.abs(cosang) < 1e-9,
    'radius and line should be perpendicular, got cos=' + cosang);
});

check('seeding never collapses a line to nothing', () => {
  for (const off of [0, 45, 90, 180, 270]) {
    const RP = fresh();
    const { made } = lineOffArc(RP, off, 200);
    if (!made) continue;
    assert(lineLength(RP, made) > 1,
      'line collapsed to ' + lineLength(RP, made) + 'px at ' + off + '°');
  }
});

check('seedTangentLine declines the degenerate cases instead of dividing by zero', () => {
  const RP = fresh();
  const arc = RP.addConstructionArc(0, 0, 0, 200, { sagitta: 60 });
  const made = RP.addConstructionLine(0, 0, 100, 0);
  // A zero-length line has no direction to preserve, so there is nothing
  // to rotate — it must decline rather than produce NaNs.
  const l = RP.sketch.entities[made.line.id];
  RP.sketch.entities[l.p2].x = RP.sketch.entities[l.p1].x;
  RP.sketch.entities[l.p2].y = RP.sketch.entities[l.p1].y;
  const ok = RP.seedTangentLine(RP.sketch, made.line.id, arc.arc.id, arc.arc.p1);
  assert(ok === false, 'a zero-length line should be declined');
  assert(isFinite(RP.sketch.entities[l.p2].x) && isFinite(RP.sketch.entities[l.p2].y),
    'coordinates must not become NaN');
});

check('auto-tangency uses the endpoint form, which has no captured side', () => {
  const RP = fresh();
  sCurve(RP, false);
  const sk = RP.sketch;
  const ts = RP.Sketch.constraintIds(sk).map(id => sk.constraints[id])
    .filter(c => /^tangent/.test(c.type));
  assert(ts.length === 2, 'a tangent at each straight, got ' + ts.length);
  for (const c of ts) {
    assert(c.type === 'tangent_at', 'expected tangent_at, got ' + c.type);
    assert(c.side === undefined, 'endpoint tangency must not capture a side');
    assert(c.refs.length === 3, 'line, arc and the point they meet at');
  }
});

check('dragging the S-curve never reports the sketch as conflicting', () => {
  const RP = fresh();
  const { l2 } = sCurve(RP, true);
  const sk = RP.sketch;
  let red = 0, steps = 0;
  // Sweep the free end far past where the old side-locked tangent gave up.
  for (let y = 100; y >= -260; y -= 20) {
    const res = RP.Sketch.dragPoint(sk, l2.p2.id, 700, y);
    steps++;
    if (res.status === 'conflict') red++;
  }
  assert(red === 0, red + ' of ' + steps + ' drag steps went red');
  const settled = RP.Sketch.solve(sk);
  assert(settled.status !== 'conflict',
    'and the sketch is left solvable, got ' + settled.status);
});

check('the joins stay tangent throughout the drag', () => {
  const RP = fresh();
  const { l1, a1, l2 } = sCurve(RP, false);
  const sk = RP.sketch;
  function offBy(lineId, arcId, ptId) {
    const L = sk.entities[lineId], A = sk.entities[arcId];
    const a = sk.entities[L.p1], b = sk.entities[L.p2];
    const c = sk.entities[A.center], p = sk.entities[ptId];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // radius vector projected on the line direction: zero when tangent
    return Math.abs(((p.x - c.x) * dx + (p.y - c.y) * dy) / len);
  }
  for (let y = 100; y >= -100; y -= 25) {
    RP.Sketch.dragPoint(sk, l2.p2.id, 700, y);
    assert(offBy(l1.line.id, a1.arc.id, a1.p1.id) < 1e-6,
      'tangency slipped at y=' + y + ', off by ' +
      offBy(l1.line.id, a1.arc.id, a1.p1.id));
  }
});

// ---- endpoint tangency is oriented (FreeCAD's angle-at-point) ----------
// Tangency used to be "the radius is perpendicular to the line", which a
// line folded back over the arc satisfies just as well. It is now the
// signed angle between the line's own direction and the arc's normal,
// locked to 0 or π when the constraint is made.
check('an arc tangent to a FIXED line flattens towards it instead of crossing, and comes back', () => {
  const RP = fresh();
  const S = RP.Sketch, sk = () => RP.sketch;
  const l = RP.addConstructionLine(0, 300, 400, 300);
  S.addConstraint(sk(), 'fix', [l.p1.id]);
  S.addConstraint(sk(), 'fix', [l.p2.id]);
  const a = RP.addConstructionArc(0, 300, 150, 200, { startSnap: RP.computeSnap(0, 300, { kind: 'point' }) });
  assert(a.tangents.length === 1, 'tangent applied');
  const cen = () => sk().entities[sk().entities[a.arc.id].center];
  const radius = () => S.arcGeometry(sk(), sk().entities[a.arc.id]).radius;
  const ys = [];
  for (let y = 200; y <= 450; y += 10) ys.push(y);        // out past the line...
  for (let y = 450; y >= 200; y -= 10) ys.push(y);        // ...and back
  for (const y of ys) {
    const res = S.dragPoint(sk(), a.p2.id, 150, y);
    assert(res.status !== 'conflict', 'went red with the cursor at y=' + y);
    assert(cen().y < 300, 'the centre crossed the line at y=' + y + ' — the tangent locks its side');
    assert(sk().entities[a.p2.id].y < 300, 'the arc end crossed the line at y=' + y);
  }
  S.endDrag(sk());
  assertClose(sk().entities[a.p2.id].y, 200, 1e-6, 'the end comes all the way back');
  assert(radius() < 400, 'and the arc is not stranded flat: R=' + radius().toFixed(0));
});

check('a line folded back over the arc is an error of π, not a solution', () => {
  const RP = fresh();
  const S = RP.Sketch, sk = RP.sketch;
  // Arc from (100,0) round to (0,100) about the origin; a line ending at
  // (100,0) and running upwards meets it tangentially.
  const c = S.addPoint(sk, 0, 0), p1 = S.addPoint(sk, 100, 0), p2 = S.addPoint(sk, 0, 100);
  const arc = S.addArc(sk, c.id, p1.id, p2.id, true);
  const a = S.addPoint(sk, 100, -80);
  const line = S.addLine(sk, a.id, p1.id);
  const t = S.addConstraint(sk, 'tangent_at', [line.id, arc.id, p1.id]);
  const resid = () => {
    const idx = S.buildIndex(sk, {}), plan = S.buildPlan(sk), prm = [];
    idx.pids.forEach(q => { prm[idx.index[q]] = sk.entities[q].x; prm[idx.index[q] + 1] = sk.entities[q].y; });
    const g = S.makeAccess(sk, idx, prm), r = new Array(plan.m).fill(0);
    const it = plan.items.find(i => i.obj === t);
    it.def.residual(g, t, r, it.row);
    return r[it.row];
  };
  assertClose(resid(), 0, 1e-12, 'smooth as built');
  a.y = 80;                                // fold the line back up past the join
  assertClose(Math.abs(resid()), Math.PI, 1e-9, 'a fold-back is a half-turn of error');
  a.y = 0;  a.x = 100;                     // and a collapsed line is not "satisfied" either
  assert(Math.abs(resid()) > 1, 'zero length must not read as tangent, got ' + resid());
});

check('tangencies saved without an orientation get one from their geometry', () => {
  const RP = fresh();
  const { l1, a1 } = sCurve(RP, false);
  const sk = RP.sketch;
  const ts = RP.Sketch.constraintIds(sk).map(id => sk.constraints[id]).filter(c => c.type === 'tangent_at');
  const want = ts.map(c => c.orient);
  ts.forEach(c => { delete c.orient; });            // as an older save would have it
  const res = RP.Sketch.solve(sk);
  assert(res.status !== 'conflict', 'still solves');
  assert(JSON.stringify(ts.map(c => c.orient)) === JSON.stringify(want),
    'backfilled ' + JSON.stringify(ts.map(c => c.orient)) + ', expected ' + JSON.stringify(want));
});

check('swinging a tangent line a long way does not squeeze it to nothing', () => {
  // Making a line horizontal when it was drawn steeply tangent to an arc
  // needs a big rotation, and shrinking the line is the cheapest way for
  // the solver to turn it. A zero-length line has no direction, so the
  // tangent could no longer be stated and the solve stalled in conflict.
  const RP = fresh();
  const { l2 } = sCurve(RP, false);        // sCurve makes l2 horizontal last
  const sk = RP.sketch, E = id => sk.entities[id];
  const L = E(l2.line.id);
  const len = Math.hypot(E(L.p2).x - E(L.p1).x, E(L.p2).y - E(L.p1).y);
  const res = RP.Sketch.solve(sk);
  assert(res.status !== 'conflict', 'the S-curve solves, got ' + res.status);
  assert(len > 20, 'the line kept a usable length: ' + len.toFixed(3));
  assertClose(E(L.p1).y, E(L.p2).y, 1e-6, 'and it is horizontal');
});

// ---- the line-arc-line chain from the bug report ------------------------
// A straight, an arc and a straight, both tangent at the arc's ends, one
// arc end locked, then dragging. It used to squeeze a straight to zero
// length (and stay red), or fold a straight back over the arc.
function chain(RP) {
  const sk = () => RP.sketch;
  const l1 = RP.addConstructionLine(0, 300, 200, 300);
  const a = RP.addConstructionArc(200, 300, 350, 200, { startSnap: RP.computeSnap(200, 300, { kind: 'point' }) });
  const e2 = sk().entities[a.p2.id];
  const l2 = RP.addConstructionLine(e2.x, e2.y, e2.x + 60, e2.y - 200,
    { startSnap: RP.computeSnap(e2.x, e2.y, { kind: 'point' }) });
  return { l1, a, l2 };
}
function chainHealth(RP, g) {
  const sk = RP.sketch, E = id => sk.entities[id];
  const len = l => { const L = E(l.line.id); return Math.hypot(E(L.p2).x - E(L.p1).x, E(L.p2).y - E(L.p1).y); };
  const orients = RP.Sketch.constraintIds(sk).map(i => sk.constraints[i]).filter(c => c.type === 'tangent_at')
    .map(c => RP.Sketch.tangentAtOrient(sk, c) === c.orient);
  return { l1: len(g.l1), l2: len(g.l2), oriented: orients.every(Boolean), n: orients.length };
}

check('dragging the free arc end round the chain never collapses, folds or goes red', () => {
  for (const radius of [120, 250]) {
    const RP = fresh();
    const g = chain(RP);
    const S = RP.Sketch, sk = RP.sketch;
    assert(chainHealth(RP, g).n === 2, 'both joins are tangent');
    S.addConstraint(sk, 'fix', [g.a.p1.id]);
    S.solve(sk);
    const p = sk.entities[g.a.p2.id], x0 = p.x, y0 = p.y;
    for (let i = 1; i <= 72; i++) {
      const t = i / 72 * 2 * Math.PI;
      const res = S.dragPoint(sk, g.a.p2.id, x0 + radius * Math.sin(t), y0 - radius * (1 - Math.cos(t)));
      const h = chainHealth(RP, g);
      assert(res.status !== 'conflict', 'r=' + radius + ' step ' + i + ' went red');
      assert(h.l1 > 1 && h.l2 > 1, 'r=' + radius + ' step ' + i + ' collapsed a line: ' + h.l1.toFixed(1) + ', ' + h.l2.toFixed(1));
      assert(h.oriented, 'r=' + radius + ' step ' + i + ' folded a line back over the arc');
    }
    S.endDrag(sk);
  }
});

check('dragging the join into a free line pushes its far end instead of collapsing it', () => {
  const RP = fresh();
  const g = chain(RP);
  const S = RP.Sketch, sk = RP.sketch, E = id => sk.entities[id];
  S.addConstraint(sk, 'fix', [g.a.p1.id]);
  S.solve(sk);
  const start = chainHealth(RP, g).l2;
  const P = E(g.a.p2.id), B = E(E(g.l2.line.id).p2);
  const x0 = P.x, y0 = P.y, dx = B.x - P.x, dy = B.y - P.y;
  for (let i = 1; i <= 30; i++) {          // straight at, and past, the far end
    const res = S.dragPoint(sk, g.a.p2.id, x0 + dx * i / 20, y0 + dy * i / 20);
    assert(res.status !== 'conflict', 'went red at step ' + i);
  }
  S.endDrag(sk);
  const h = chainHealth(RP, g);
  assert(h.l2 >= start * RP.Sketch.DRAG_MIN_LENGTH * 0.99, 'the line kept a usable length: ' + h.l2.toFixed(1));
  assert(h.oriented, 'and still runs into the arc the way it did');
});

check('random drags of every point in the chain never fault it', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let moves = 0;
  for (let trial = 0; trial < 12; trial++) {
    const RP = fresh();
    const g = chain(RP);
    const S = RP.Sketch, sk = RP.sketch, E = id => sk.entities[id];
    S.addConstraint(sk, 'fix', [g.a[trial % 2 ? 'p2' : 'p1'].id]);
    S.solve(sk);
    const pts = [g.a.p1.id, g.a.p2.id, g.a.center.id, g.l1.p1.id, g.l2.p2.id];
    for (let d = 0; d < 5; d++) {
      const pid = pts[Math.floor(rnd() * pts.length)];
      let x = E(pid).x, y = E(pid).y;
      let span = Math.abs(S.arcGeometry(sk, E(g.a.arc.id)).sweep);
      for (let s = 0; s < 25; s++) {
        x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40;
        const res = S.dragPoint(sk, pid, x, y);
        moves++;
        const h = chainHealth(RP, g);
        const now = Math.abs(S.arcGeometry(sk, E(g.a.arc.id)).sweep);
        assert(res.status !== 'conflict', 'trial ' + trial + ' went red');
        assert(h.l1 > 1 && h.l2 > 1, 'trial ' + trial + ' collapsed a line');
        assert(h.oriented, 'trial ' + trial + ' folded a line');
        assert(Math.abs(now - span) < Math.PI, 'trial ' + trial + ' wrapped the arc through zero');
        span = now;
      }
      S.endDrag(sk);
    }
  }
  assert(moves === 1500, 'ran ' + moves + ' moves');
});

if (!report()) process.exitCode = 1;
