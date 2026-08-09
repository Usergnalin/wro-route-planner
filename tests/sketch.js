/* ========================================================================
   sketch.js - Unit tests for the constraint solver.

   Loads ONLY js/sketch/* — no core.js, no DOM. If these pass, the sketch
   layer is genuinely independent of the rest of the app.

     node tests/sketch.js
   ======================================================================== */
'use strict';

const { loadApp, SKETCH_FILES, makeRunner, assert, assertClose } = require('./harness');

const ctx = loadApp(SKETCH_FILES);
const RP = ctx.RP;
const S = RP.Sketch;
const { check, report } = makeRunner('sketch solver');

function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

// Sloppy quadrilateral + the constraints that should square it up to an
// axis-aligned 100 x 50 rectangle anchored at the origin.
function buildRect() {
  const sk = S.create();
  const p0 = S.addPoint(sk, 0, 0);
  const p1 = S.addPoint(sk, 100, 10);
  const p2 = S.addPoint(sk, 110, 60);
  const p3 = S.addPoint(sk, 5, 55);
  const top    = S.addLine(sk, p0.id, p1.id);
  const right  = S.addLine(sk, p1.id, p2.id);
  const bottom = S.addLine(sk, p2.id, p3.id);
  const left   = S.addLine(sk, p3.id, p0.id);
  S.addConstraint(sk, 'fix', [p0.id]);
  S.addConstraint(sk, 'horizontal', [top.id]);
  S.addConstraint(sk, 'horizontal', [bottom.id]);
  S.addConstraint(sk, 'vertical', [right.id]);
  S.addConstraint(sk, 'vertical', [left.id]);
  S.addConstraint(sk, 'distance', [top.id], 100);
  S.addConstraint(sk, 'distance', [left.id], 50);
  return { sk, p0, p1, p2, p3, top, right, bottom, left };
}

// ---- linear algebra --------------------------------------------------
check('luSolve solves a known 2x2', () => {
  const x = RP.LinAlg.luSolve([[2, 1], [1, 3]], [3, 5], 2);
  assertClose(x[0], 0.8, 1e-12, 'x');
  assertClose(x[1], 1.4, 1e-12, 'y');
});

check('luSolve returns null for a singular matrix', () => {
  assert(RP.LinAlg.luSolve([[1, 2], [2, 4]], [1, 2], 2) === null, 'expected null');
});

check('rank detects a dependent row', () => {
  assert(RP.LinAlg.rank([[1, 2], [2, 4], [1, 1]], 3, 2) === 2, 'expected rank 2');
});

// ---- entity / topology -----------------------------------------------
check('removeEntity cascades to dependents and constraints', () => {
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 10, 0);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'horizontal', [line.id]);
  S.removeEntity(sk, a.id);
  assert(!S.get(sk, line.id), 'line should be removed with its endpoint');
  assert(S.constraintIds(sk).length === 0, 'constraint should be removed with its line');
  assert(!!S.get(sk, b.id), 'unrelated point should survive');
});

check('addConstraint rejects mismatched entity types', () => {
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  let threw = false;
  try { S.addConstraint(sk, 'horizontal', [a.id]); } catch (e) { threw = true; }
  assert(threw, 'horizontal on a point should throw');
});

// ---- core solving ----------------------------------------------------
check('rectangle solves to exact dimensions and is fully constrained', () => {
  const { sk, p0, p1, p2, p3 } = buildRect();
  const res = S.solve(sk);
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  assert(res.status === 'full', 'expected status full, got ' + res.status);
  assert(res.dof === 0, 'expected dof 0, got ' + res.dof);
  assertClose(p0.x, 0, 1e-7, 'p0.x'); assertClose(p0.y, 0, 1e-7, 'p0.y');
  assertClose(p1.x, 100, 1e-6, 'p1.x'); assertClose(p1.y, 0, 1e-6, 'p1.y');
  assertClose(p2.x, 100, 1e-6, 'p2.x'); assertClose(p2.y, 50, 1e-6, 'p2.y');
  assertClose(p3.x, 0, 1e-6, 'p3.x'); assertClose(p3.y, 50, 1e-6, 'p3.y');
});

check('under-constrained sketch reports remaining DOF', () => {
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 100, 10);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'horizontal', [line.id]);
  const res = S.solve(sk);
  assert(res.ok, 'solve failed');
  assert(res.status === 'under', 'expected under, got ' + res.status);
  // 4 params, 1 independent equation
  assert(res.dof === 3, 'expected dof 3, got ' + res.dof);
});

check('point_on_line projects the point onto the line', () => {
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 100, 0);
  const p = S.addPoint(sk, 50, 30);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'fix', [b.id]);
  S.addConstraint(sk, 'point_on_line', [p.id, line.id]);
  const res = S.solve(sk);
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  assertClose(p.y, 0, 1e-7, 'point should land on the line');
  assertClose(p.x, 50, 1e-2, 'projection should be perpendicular');
});

check('angle constrains a single line against +X', () => {
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 100, 0);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'angle', [line.id], Math.PI / 4);
  const res = S.solve(sk);
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  assertClose(Math.atan2(b.y - a.y, b.x - a.x), Math.PI / 4, 1e-7, 'line angle');
});

check('angle constrains two lines relative to each other', () => {
  const sk = S.create();
  const a1 = S.addPoint(sk, 0, 0), a2 = S.addPoint(sk, 100, 0);
  const b1 = S.addPoint(sk, 0, 50), b2 = S.addPoint(sk, 80, 60);
  const la = S.addLine(sk, a1.id, a2.id);
  const lb = S.addLine(sk, b1.id, b2.id);
  S.addConstraint(sk, 'fix', [a1.id]);
  S.addConstraint(sk, 'fix', [a2.id]);
  S.addConstraint(sk, 'fix', [b1.id]);
  S.addConstraint(sk, 'angle', [la.id, lb.id], Math.PI / 2);
  const res = S.solve(sk);
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  const ux = a2.x - a1.x, uy = a2.y - a1.y;
  const vx = b2.x - b1.x, vy = b2.y - b1.y;
  assertClose(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy), Math.PI / 2, 1e-7, 'angle between');
});

check('distance works on a bare point pair', () => {
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 10, 0);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'distance', [a.id, b.id], 250);
  const res = S.solve(sk);
  assert(res.ok, 'solve failed');
  assertClose(dist(a, b), 250, 1e-7, 'point-point distance');
});

check('heavily underdetermined system still converges quickly', () => {
  // Regression: one distance constraint on a near-horizontal line, plus
  // unrelated free geometry contributing null-space parameters. With
  // per-parameter (Marquardt) damping this stalls at maxIter, because the
  // damping amplifies the weakly-constrained y direction into a step of
  // hundreds of pixels. Uniform damping takes the minimum-norm step.
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 200, 8);
  const c = S.addPoint(sk, 200, 8);
  const d = S.addPoint(sk, 196, 120);
  const l1 = S.addLine(sk, a.id, b.id);
  S.addLine(sk, c.id, d.id);
  S.addConstraint(sk, 'distance', [l1.id], 100);

  const res = S.solve(sk);
  assert(res.ok, 'should converge: ' + JSON.stringify(res));
  assert(res.iterations <= 5, 'expected fast convergence, took ' + res.iterations);
  assertClose(dist(a, b), 100, 1e-6, 'constrained length');
});

// ---- diagnosis -------------------------------------------------------
check('duplicate constraint is reported as redundant, not conflicting', () => {
  const { sk, bottom } = buildRect();
  S.addConstraint(sk, 'horizontal', [bottom.id]);   // already horizontal
  const res = S.solve(sk);
  assert(res.ok, 'redundant sketch should still converge');
  assert(res.status === 'redundant', 'expected redundant, got ' + res.status);
});

check('contradictory dimensions are reported as conflicting', () => {
  const { sk, top } = buildRect();
  S.addConstraint(sk, 'distance', [top.id], 150);   // already 100
  const res = S.solve(sk);
  assert(!res.ok, 'expected failure to converge');
  assert(res.status === 'conflict', 'expected conflict, got ' + res.status);
});

// ---- dragging --------------------------------------------------------
check('drag pulls a linkage along while holding its constraints', () => {
  const sk = S.create();
  const p0 = S.addPoint(sk, 0, 0);
  const p1 = S.addPoint(sk, 100, 0);
  const p2 = S.addPoint(sk, 200, 0);
  const l1 = S.addLine(sk, p0.id, p1.id);
  const l2 = S.addLine(sk, p1.id, p2.id);
  S.addConstraint(sk, 'fix', [p0.id]);
  S.addConstraint(sk, 'distance', [l1.id], 100);
  S.addConstraint(sk, 'distance', [l2.id], 100);

  const res = S.dragPoint(sk, p2.id, 100, 100);
  assert(res.ok, 'drag solve failed: ' + JSON.stringify(res));
  assertClose(p2.x, 100, 1e-9, 'dragged point stays under the cursor');
  assertClose(p2.y, 100, 1e-9, 'dragged point stays under the cursor');
  assertClose(dist(p0, p1), 100, 1e-6, 'first link length');
  assertClose(dist(p1, p2), 100, 1e-6, 'second link length');
  assertClose(p0.x, 0, 1e-9, 'anchor must not move');
  assertClose(p0.y, 0, 1e-9, 'anchor must not move');
});

check('drag beyond reach reports conflict instead of exploding', () => {
  const sk = S.create();
  const p0 = S.addPoint(sk, 0, 0);
  const p1 = S.addPoint(sk, 100, 0);
  const l1 = S.addLine(sk, p0.id, p1.id);
  S.addConstraint(sk, 'fix', [p0.id]);
  S.addConstraint(sk, 'distance', [l1.id], 100);

  const res = S.dragPoint(sk, p1.id, 500, 0);   // rigid link, cannot stretch
  assert(!res.ok, 'expected conflict');
  assert(res.status === 'conflict', 'expected conflict, got ' + res.status);
  assert(isFinite(p1.x) && isFinite(p1.y), 'geometry must stay finite');
});

// ---- entity-contributed equations ------------------------------------
check('arc keeps both endpoints on the same radius', () => {
  const sk = S.create();
  const c = S.addPoint(sk, 0, 0);
  const a = S.addPoint(sk, 100, 0);
  const b = S.addPoint(sk, 0, 90);        // wrong radius on purpose
  S.addArc(sk, c.id, a.id, b.id, true);
  S.addConstraint(sk, 'fix', [c.id]);
  S.addConstraint(sk, 'fix', [a.id]);
  const res = S.solve(sk);
  assert(res.ok, 'solve failed: ' + JSON.stringify(res));
  assertClose(dist(c, b), 100, 1e-7, 'arc endpoint radius');
});

if (!report()) process.exitCode = 1;
