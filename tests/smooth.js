/* ========================================================================
   smooth.js - Smooth corners: their own sketch entity (js/sketch/smooth.js).

     node tests/smooth.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('smooth corners');

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

function endSnap(pointId) { return { kind: 'endpoint', pointId: pointId }; }

// Two straights with a gap at the corner (300,100)-(400,200), and a smooth
// corner drawn from the end of one to the start of the other.
function filletScene(RP) {
  const A = RP.addConstructionLine(0, 100, 300, 100);
  const B = RP.addConstructionLine(400, 200, 400, 500);
  RP.Sketch.addConstraint(RP.sketch, 'horizontal', [A.line.id]);
  RP.Sketch.addConstraint(RP.sketch, 'vertical', [B.line.id]);
  const made = RP.addConstructionSmooth(300, 100, 400, 200,
    { startSnap: endSnap(A.line.p2), endSnap: endSnap(B.line.p1) });
  return { A, B, made, sm: made.smooth };
}

function segDist(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - x, a.y + t * dy - y));
  }
  return best;
}
function heading(p, q) { return Math.atan2(q.y - p.y, q.x - p.x); }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// ---- the shape ------------------------------------------------------------
check('the unit curve turns by exactly theta, whatever the ramp', () => {
  const RP = fresh();
  [0.4, 1.0, Math.PI / 2, 2.6].forEach(th => [0, 0.25, 0.5, 1].forEach(f => {
    assertClose(RP.Sketch.smoothUnitAngle(th, f, (1 + f) * th), th, 1e-12, 'theta ' + th + ' ramp ' + f);
  }));
});

check('closed-form heading matches the integral of the raised-cosine curvature', () => {
  const RP = fresh();
  const th = Math.PI / 2, f = 0.6, Lt = f * th, L = (1 + f) * th, n = 20000, ds = L / n;
  const k = s => s < Lt ? (1 - Math.cos(Math.PI * s / Lt)) / 2
              : (s > L - Lt ? (1 - Math.cos(Math.PI * (L - s) / Lt)) / 2 : 1);
  let acc = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    acc += k((i + 0.5) * ds) * ds;
    if (i % 500 === 0) worst = Math.max(worst, Math.abs(acc - RP.Sketch.smoothUnitAngle(th, f, (i + 1) * ds)));
  }
  assert(worst < 1e-7, 'worst difference ' + worst);
});

check('ramp 0 is a circular arc: leg = tan(theta/2)', () => {
  const RP = fresh();
  [0.5, Math.PI / 2, 2.5].forEach(th =>
    assertClose(RP.Sketch.smoothUnitLeg(th, 0), Math.tan(th / 2), 1e-4, 'theta ' + th));
});

// ---- as sketch geometry ---------------------------------------------------
check('drawn between two line ends it rounds their corner: vertex at the crossing, both tangent, equal legs', () => {
  const RP = fresh();
  const { A, B, sm } = filletScene(RP);
  const sk = RP.sketch;
  assert(sm.type === 'smooth', 'expected a smooth entity');
  const v = sk.entities[sm.vertex], p1 = sk.entities[sm.p1], p2 = sk.entities[sm.p2];
  // tangency: the vertex lies on both lines
  const onLine = (pid, line) => RP.Sketch.perpDistance(sk, pid, line.id);
  assert(Math.abs(onLine(sm.vertex, A.line)) < 1e-6, 'vertex on line A');
  assert(Math.abs(onLine(sm.vertex, B.line)) < 1e-6, 'vertex on line B');
  assertClose(Math.hypot(v.x - p1.x, v.y - p1.y), Math.hypot(v.x - p2.x, v.y - p2.y), 1e-6, 'equal legs');
  const g = RP.Sketch.smoothGeometry(sk, sm);
  assertClose(Math.abs(g.sweep), Math.PI / 2, 1e-6, '90 degree corner');
  assert(['ok', 'under'].indexOf(sk.status) >= 0 || sk.status === 'well', 'sketch solvable: ' + sk.status);
});

check('the curve starts and ends at its points, tangent to the legs, and is tightest (1/R) in the middle', () => {
  const RP = fresh();
  const { sm } = filletScene(RP);
  const sk = RP.sketch, g = RP.Sketch.smoothGeometry(sk, sm);
  const pts = RP.Sketch.smoothPoints(sk, sm, 400);
  const p1 = sk.entities[sm.p1], v = sk.entities[sm.vertex], p2 = sk.entities[sm.p2];
  assertClose(pts[0].x, p1.x, 1e-9); assertClose(pts[pts.length - 1].y, p2.y, 1e-9);
  assert(Math.abs(angDiff(heading(pts[0], pts[1]), heading(p1, v))) < 0.01, 'start tangent towards the vertex');
  const m = pts.length - 1;
  assert(Math.abs(angDiff(heading(pts[m - 1], pts[m]), heading(v, p2))) < 0.01, 'end tangent away from the vertex');
  const curv = i => {
    const a = heading(pts[i - 1], pts[i]), b = heading(pts[i], pts[i + 1]);
    const l = (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) +
               Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)) / 2;
    return Math.abs(angDiff(b, a)) / l;
  };
  assertClose(curv(Math.floor(pts.length / 2)), 1 / g.radius, 0.02 / g.radius, 'peak curvature');
  assert(curv(1) < 0.05 / g.radius, 'straight at the start');
});

check('a tightest-radius dimension drives the corner', () => {
  const RP = fresh();
  const { sm } = filletScene(RP);
  const sk = RP.sketch;
  RP.Sketch.addConstraint(sk, 'smooth_radius', [sm.id], 80);
  RP.solveSketch();
  assertClose(RP.Sketch.smoothGeometry(sk, sm).radius, 80, 1e-6, 'tightest radius');
  const g = RP.Sketch.smoothGeometry(sk, sm);
  assertClose(Math.abs(g.sweep), Math.PI / 2, 1e-6, 'still tangent to both lines');
});

check('construction can sit anywhere along it: point_on_smooth', () => {
  const RP = fresh();
  const { sm } = filletScene(RP);
  const sk = RP.sketch;
  const p = RP.Sketch.addPoint(sk, 385, 135);
  RP.Sketch.addConstraint(sk, 'point_on_smooth', [p.id, sm.id]);
  RP.solveSketch();
  const pts = RP.Sketch.smoothPoints(sk, sm, 400);
  assert(segDist(pts, p.x, p.y) < 1e-3, 'point should lie on the curve, off by ' + segDist(pts, p.x, p.y));
});

check('the constraint UI offers point-on and radius for smooth corners only', () => {
  const RP = fresh();
  const { sm } = filletScene(RP);
  const p = RP.addConstructionPoint(380, 160);
  RP.sketchSelection = [p.point.id, sm.id];
  assert(RP.resolveConstraintType('coincident') === 'point_on_smooth', 'coincident -> point on smooth');
  RP.sketchSelection = [sm.id];
  assert(RP.resolveConstraintType('distance') === 'smooth_radius', 'dimension -> tightest radius');
  assert(RP.constraintRefsFor('radius') === null, 'not an arc radius');
});

check('ramp is a property you can change; ramp 0 is constant radius', () => {
  const RP = fresh();
  const { sm } = filletScene(RP);
  const sk = RP.sketch;
  const r1 = RP.Sketch.smoothGeometry(sk, sm).radius;
  assert(RP.setSmoothRamp(sm.id, 0), 'set ramp');
  const g0 = RP.Sketch.smoothGeometry(sk, sm);
  assert(g0.ramp === 0, 'ramp 0');
  const leg = Math.hypot(sk.entities[sm.vertex].x - sk.entities[sm.p1].x, sk.entities[sm.vertex].y - sk.entities[sm.p1].y);
  assertClose(g0.radius, leg / Math.tan(Math.PI / 4), 1e-3, 'ramp 0 = arc with the same tangent points');
  assert(r1 < g0.radius, 'ramps make it tighter in the middle');
  assert(RP.setSmoothRamp(sm.id, 7) && sk.entities[sm.id].ramp === 1, 'clamped to 1');
});

check('deleting it removes its own points', () => {
  const RP = fresh();
  const made = RP.addConstructionSmooth(100, 100, 300, 300);
  const ids = [made.p1.id, made.vertex.id, made.p2.id];
  RP.removeConstructionLine(made.smooth.id);
  ids.forEach(id => assert(!RP.sketch.entities[id], 'point ' + id + ' should be gone'));
});

check('it saves and loads as itself', () => {
  const RP = fresh();
  const { sm } = filletScene(RP);
  RP.setSmoothRamp(sm.id, 0.4);
  const ser = RP._serializeDoc(RP.getDoc(RP.DOC_MAT));
  const doc = RP._docFromData(ser);
  const e = doc.sketch.entities[sm.id];
  assert(e && e.type === 'smooth' && e.ramp === 0.4, 'entity kept with its ramp');
  assertClose(RP.Sketch.smoothGeometry(doc.sketch, e).radius,
              RP.Sketch.smoothGeometry(RP.sketch, sm).radius, 1e-9, 'same shape');
});

// ---- routes and code ------------------------------------------------------
check('smooth corners and arcs are separate: each offers only its own move', () => {
  const RP = fresh();
  assert(RP.movesForEntity('smooth').join() === 'smooth,teleport', RP.movesForEntity('smooth').join());
  assert(RP.movesForEntity('arc').indexOf('smooth') < 0, 'arcs do not offer smooth');
  assert(RP.movesForEntity('line').indexOf('smooth') < 0, 'lines do not offer smooth');
});

check('straight -> smooth corner -> straight: one curve call between the straights, no turns', () => {
  const RP = fresh();
  const { A, B, sm } = filletScene(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(A.line.id);
  const el = RP.addGeometryToRoute(sm.id);
  RP.addGeometryToRoute(B.line.id);
  assert(el.move === 'smooth', 'move type ' + el.move);
  const route = RP.routes[0];
  assert(RP.resolveRoute(route).ok, 'route should resolve');
  const steps = RP.computeSteps(route);
  const kinds = steps.map(s => s.kind).join(',');
  assert(kinds === 'forward,smooth,forward', 'steps ' + kinds);
  const st = steps[1], g = RP.Sketch.smoothGeometry(RP.sketch, sm);
  assertClose(Math.abs(st.angle), 90, 1e-6, 'angle');
  assertClose(st.radiusMm, g.radius / 2, 1e-9, 'tightest radius in mm');
  assertClose(st.mm, g.length / 2, 1e-9, 'length in mm');
  const code = RP.generateCode(route);
  assert(/robot\.curve\(angle=-?90\.000, radius=[0-9.]+, ramp=1\.000, reversed=False, speed=200\)/.test(code),
         'expected a curve call, got:\n' + code);
});

check('projects saved before smooth corners get the default template', () => {
  const RP = fresh();
  delete RP.codeConfig.movements.smooth;
  const { sm } = filletScene(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(sm.id);
  assert(/robot\.curve\(/.test(RP.generateCode(RP.routes[0])), 'default template filled in');
});

check('the simulator drives along the curve', () => {
  const RP = fresh();
  const { sm } = filletScene(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(sm.id);
  const track = RP.simPoseTrack(RP.routes[0]);
  assert(track.ok, 'pose track');
  const pts = RP.Sketch.smoothPoints(RP.sketch, sm, 96);
  const mid = pts[48];
  assert(track.poses.some(p => Math.hypot(p.x - mid.x, p.y - mid.y) < 1e-6), 'passes the curve\'s midpoint');
  const last = track.poses[track.poses.length - 1], end = RP.sketch.entities[sm.p2];
  assertClose(last.x, end.x, 1e-6); assertClose(last.y, end.y, 1e-6);
});

report();
