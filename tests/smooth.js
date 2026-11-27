/* ========================================================================
   smooth.js - Smooth corners: arcs driven with no curvature jumps.

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

function smoothRoute(RP, ramp, sagitta) {
  const made = RP.addConstructionArc(200, 200, 600, 200, { sagitta: sagitta || 120 });
  RP.setEditMode('route');
  const el = RP.addGeometryToRoute(made.arc.id);
  RP.setMoveProps(RP.routes[0].id, el.id, { move: 'smooth', ramp: ramp });
  return { arc: made.arc, el: el, route: RP.routes[0] };
}

function heading(p, q) { return Math.atan2(q.y - p.y, q.x - p.x); }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// ---- the shape ------------------------------------------------------------
check('the curve turns by exactly theta, whatever the ramp', () => {
  const RP = fresh();
  [0.4, 1.0, Math.PI / 2, 2.6].forEach(th => [0, 0.25, 0.5, 1].forEach(f => {
    assertClose(RP.smoothUnitAngle(th, f, (1 + f) * th), th, 1e-12, 'theta ' + th + ' ramp ' + f);
  }));
});

check('ramp 0 is the plain arc (chord 2 sin(theta/2))', () => {
  const RP = fresh();
  [0.5, Math.PI / 2, 2.5].forEach(th =>
    assertClose(RP.smoothUnitChord(th, 0), 2 * Math.sin(th / 2), 1e-5, 'theta ' + th));
});

check('closed-form heading matches the integral of the raised-cosine curvature', () => {
  const RP = fresh();
  const th = Math.PI / 2, f = 0.6, Lt = f * th, L = (1 + f) * th, n = 20000, ds = L / n;
  function k(s) {
    if (s < Lt) return (1 - Math.cos(Math.PI * s / Lt)) / 2;
    if (s > L - Lt) return (1 - Math.cos(Math.PI * (L - s) / Lt)) / 2;
    return 1;
  }
  let acc = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    acc += k((i + 0.5) * ds) * ds;
    if (i % 500 === 0) worst = Math.max(worst, Math.abs(acc - RP.smoothUnitAngle(th, f, (i + 1) * ds)));
  }
  assert(worst < 1e-7, 'worst difference ' + worst);
});

// ---- on an arc entity -----------------------------------------------------
check('a smooth corner keeps the arc\'s endpoints and end tangents', () => {
  const RP = fresh();
  const { arc } = smoothRoute(RP, 1);
  const ent = RP.sketch.entities[arc.id];
  [false, true].forEach(flip => {
    const sp = RP.smoothPoints(RP.sketch, ent, flip, 1, 200);
    const ap = RP.Sketch.arcPoints(RP.sketch, ent, 2000);
    const at = flip ? ap.slice().reverse() : ap;
    assertClose(sp[0].x, at[0].x, 1e-9); assertClose(sp[0].y, at[0].y, 1e-9);
    assertClose(sp[sp.length - 1].x, at[at.length - 1].x, 1e-9);
    assertClose(sp[sp.length - 1].y, at[at.length - 1].y, 1e-9);
    // end tangents: within the polyline's own resolution
    const tol = 0.02;
    assert(Math.abs(angDiff(heading(sp[0], sp[1]), heading(at[0], at[1]))) < tol, 'start tangent, flip ' + flip);
    const m = sp.length - 1, ma = at.length - 1;
    assert(Math.abs(angDiff(heading(sp[m - 1], sp[m]), heading(at[ma - 1], at[ma]))) < tol, 'end tangent, flip ' + flip);
  });
});

check('it starts and ends straight and is tightest in the middle (1/R)', () => {
  const RP = fresh();
  const { arc } = smoothRoute(RP, 1);
  const ent = RP.sketch.entities[arc.id];
  const sc = RP.smoothCornerOf(RP.sketch, ent, false, 1);
  const pts = RP.smoothPoints(RP.sketch, ent, false, 1, 400);
  function curv(i) {   // turning per unit length between neighbouring segments
    const a = heading(pts[i - 1], pts[i]), b = heading(pts[i], pts[i + 1]);
    const l = (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) +
               Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)) / 2;
    return Math.abs(angDiff(b, a)) / l;
  }
  const mid = curv(Math.floor(pts.length / 2));
  assertClose(mid, 1 / sc.radiusPx, 0.02 / sc.radiusPx, 'peak curvature');
  assert(curv(1) < 0.05 / sc.radiusPx, 'near-straight at the start: ' + curv(1));
  assert(curv(pts.length - 2) < 0.05 / sc.radiusPx, 'near-straight at the end');
  // the whole curve: drawn arc's radius is bigger than... no - R is the SMALLEST radius,
  // so with the same chord it is tighter than the arc
  const g = RP.Sketch.arcGeometry(RP.sketch, ent);
  assert(sc.radiusPx < g.radius, 'smooth R ' + sc.radiusPx + ' should be < arc r ' + g.radius);
});

// ---- route + code ---------------------------------------------------------
check('arcs offer the smooth corner move; lines do not', () => {
  const RP = fresh();
  assert(RP.movesForEntity('arc').indexOf('smooth') >= 0, 'arc should offer smooth');
  assert(RP.movesForEntity('line').indexOf('smooth') < 0, 'line should not');
});

check('a smooth corner generates its own movement with angle, radius, ramp and distance', () => {
  const RP = fresh();
  const { arc, el, route } = smoothRoute(RP, 0.5);
  const steps = RP.computeSteps(route);
  const st = steps.find(s => s.kind === 'smooth');
  assert(st, 'expected a smooth step, got ' + steps.map(s => s.kind).join(','));
  const ent = RP.sketch.entities[arc.id];
  const sc = RP.smoothCornerOf(RP.sketch, ent, !!el.flip, 0.5);
  assertClose(st.radiusMm, sc.radiusPx / 2, 1e-9, 'radius in mm');
  assertClose(st.mm, sc.lengthPx / 2, 1e-9, 'length in mm');
  assertClose(Math.abs(st.angle), Math.abs(RP.Sketch.arcGeometry(RP.sketch, ent).sweep) * 180 / Math.PI, 1e-9, 'angle');
  const code = RP.generateCode(route);
  assert(/robot\.curve\(angle=-?[0-9.]+, radius=[0-9.]+, ramp=0\.50?0*, reversed=False, speed=200\)/.test(code),
         'expected a curve call, got:\n' + code);
});

check('projects saved before smooth corners get the default template', () => {
  const RP = fresh();
  delete RP.codeConfig.movements.smooth;
  const { route } = smoothRoute(RP, 1);
  const code = RP.generateCode(route);
  assert(/robot\.curve\(/.test(code), 'expected the default template to be filled in:\n' + code);
});

check('the simulator drives the smooth curve and ends at the arc end', () => {
  const RP = fresh();
  const { arc, route } = smoothRoute(RP, 1);
  const track = RP.simPoseTrack(route);
  assert(track.ok, 'pose track should resolve');
  const last = track.poses[track.poses.length - 1];
  const ent = RP.sketch.entities[arc.id];
  const end = RP.sketch.entities[ent.p2];
  assertClose(last.x, end.x, 1e-6); assertClose(last.y, end.y, 1e-6);
  // it really took the smooth path: a midway pose lies on the smooth curve, not the arc
  const sp = RP.smoothPoints(RP.sketch, ent, false, 1, 96);
  const mids = track.poses.filter(p => Math.abs(p.x - sp[48].x) < 1e-6 && Math.abs(p.y - sp[48].y) < 1e-6);
  assert(mids.length > 0, 'expected the simulator to pass through the smooth curve\'s midpoint');
});

check('ramp is clamped to 0..1 and defaults to 1', () => {
  const RP = fresh();
  assert(RP.smoothRamp({}) === 1);
  assert(RP.smoothRamp({ ramp: 2 }) === 1);
  assert(RP.smoothRamp({ ramp: -1 }) === 0);
  assert(RP.smoothRamp({ ramp: '0.3' }) === 0.3);
});

report();
