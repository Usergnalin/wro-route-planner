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
  const el = RP.appendGeometryToRoute(made.arc.id);
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
  RP.appendGeometryToRoute(made.arc.id);
  const code = RP.generateCode(RP.routes[0]);
  assert(/turn_arc/.test(code), 'expected an arc call, got:\n' + code);
});

// ---- migration ----------------------------------------------------------
check('legacy sagitta arcs migrate into real arc entities', () => {
  const RP = fresh();
  const route = legacyArcRoute(RP, 80);
  RP.migrateRoutesToElements();

  const el = route.elements[0];
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
  RP.migrateRoutesToElements();
  const ent = RP.sketch.entities[RP.routes[0].elements[0].entityId];
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

  const el = RP.appendGeometryToRoute(hit.id);
  assert(el && el.move === 'arc', 'and it should join the route as an arc');
});

check('an arc element is clickable along its curve, not just its chord', () => {
  const RP = fresh();
  const made = RP.addConstructionArc(0, 0, 200, 0, { sagitta: 60 });
  RP.setEditMode('route');
  const el = RP.appendGeometryToRoute(made.arc.id);

  const onCurve = RP.routeHitTest(100, 60);
  assert(onCurve && onCurve.kind === 'element' && onCurve.id === el.id,
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

check('an arc tangent to a line can be dragged to the other side of it', () => {
  const RP = fresh();
  const S = RP.Sketch, sk = () => RP.sketch;
  const l = RP.addConstructionLine(0, 300, 400, 300);
  S.addConstraint(sk(), 'fix', [l.p1.id]);
  S.addConstraint(sk(), 'fix', [l.p2.id]);
  const snap = RP.computeSnap(0, 300, { kind: 'point' });
  const a = RP.addConstructionArc(0, 300, 150, 200, { startSnap: snap });
  assert(a.tangents.length === 1, 'tangent applied');

  // Above the line, then below. The old side-locked form could not cross.
  RP.Sketch.dragPoint(sk(), a.p2.id, 150, 150);
  const above = sk().entities[sk().entities[a.arc.id].center].y;
  RP.Sketch.dragPoint(sk(), a.p2.id, 150, 450);
  const res = RP.Sketch.solve(sk());
  const below = sk().entities[sk().entities[a.arc.id].center].y;

  assert(res.status !== 'conflict', 'crossing must not fault the sketch, got ' + res.status);
  assert(above < 300 && below > 300,
    'the centre should follow the arc across the line: ' +
    above.toFixed(1) + ' -> ' + below.toFixed(1));
});

if (!report()) process.exitCode = 1;
