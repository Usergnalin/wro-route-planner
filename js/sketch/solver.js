/* ========================================================================
   solver.js - Levenberg-Marquardt constraint solver.

   Assembles the residual vector r and Jacobian J from the sketch's
   constraints (and any entity-contributed equations), then iterates

       (JᵀJ + λ·diag(JᵀJ)) Δ = −Jᵀr

   Systems are small, so the normal equations plus a dense solve are both
   fast enough and far simpler than a sparse factorisation.
   ======================================================================== */
var RP = window.RP || {};

RP.Sketch = RP.Sketch || {};

// Ordered list of equation blocks: every constraint, then every entity
// that contributes its own equations (currently just arcs).
RP.Sketch.buildPlan = function(sk) {
  var items = [];
  var m = 0;
  var i, def;

  var cids = RP.Sketch.constraintIds(sk);
  for (i = 0; i < cids.length; i++) {
    var c = sk.constraints[cids[i]];
    def = RP.Sketch.constraintDefs[c.type];
    if (!def) continue;
    items.push({ obj: c, def: def, row: m, eqs: def.equations, weight: def.weight });
    m += def.equations;
  }

  var eids = RP.Sketch.entityIds(sk);
  for (i = 0; i < eids.length; i++) {
    var e = sk.entities[eids[i]];
    def = RP.Sketch.entityDefs[e.type];
    if (!def) continue;
    items.push({ obj: e, def: def, row: m, eqs: def.equations, weight: def.weight });
    m += def.equations;
  }

  return { items: items, m: m };
};

// Fill r (and optionally J) at the parameter values visible through `g`.
// Angular rows are scaled by wAngle so radians and pixels are comparable.
function assemble(plan, g, r, J, n, wAngle, withJ) {
  var i, j, k, q;
  for (i = 0; i < plan.m; i++) {
    r[i] = 0;
    if (withJ) {
      var Jz = J[i];
      for (j = 0; j < n; j++) Jz[j] = 0;
    }
  }
  for (k = 0; k < plan.items.length; k++) {
    var it = plan.items[k];
    it.def.residual(g, it.obj, r, it.row);
    if (withJ) it.def.jacobian(g, it.obj, J, it.row);
    if (it.weight === 'angle') {
      for (q = 0; q < it.eqs; q++) {
        var row = it.row + q;
        r[row] *= wAngle;
        if (withJ) {
          var Jr = J[row];
          for (j = 0; j < n; j++) Jr[j] *= wAngle;
        }
      }
    }
  }
}

// Solve the sketch in place.
//
//   opts.fixedPoints  point ids held constant (this is how dragging pins
//                     the point under the cursor)
//   opts.maxIter      default 60
//   opts.tol          convergence on max|r|, default 1e-9
//
// Returns { ok, status, dof, rank, residual, iterations, n, m }.
// Parameters are written back to the entities even on failure, so geometry
// follows as far as it can and the UI can colour it as conflicting.
RP.Sketch.solve = function(sk, opts) {
  opts = opts || {};
  var maxIter = opts.maxIter || 60;
  var tol = opts.tol || 1e-9;
  var wAngle = sk.charLength || 100;

  var fixedSet = {};
  if (opts.fixedPoints) {
    for (var fi = 0; fi < opts.fixedPoints.length; fi++) fixedSet[opts.fixedPoints[fi]] = true;
  }

  var idx = RP.Sketch.buildIndex(sk, fixedSet);
  var n = idx.n;
  var plan = RP.Sketch.buildPlan(sk);
  var m = plan.m;
  var i;

  function finish(ok, iterations, resid, rank) {
    var dof = n - rank;
    var status;
    if (n === 0) status = ok ? 'full' : 'conflict';
    else if (!ok) status = 'conflict';
    else if (m > rank) status = 'redundant';
    else if (dof > 0) status = 'under';
    else status = 'full';
    sk.status = status;
    sk.dof = dof;
    sk.rank = rank;
    sk.residual = resid;
    return {
      ok: ok, status: status, dof: dof, rank: rank,
      residual: resid, iterations: iterations, n: n, m: m
    };
  }

  // Nothing to satisfy — every free parameter is a degree of freedom.
  if (m === 0) return finish(true, 0, 0, 0);

  var params = new Array(n);
  for (i = 0; i < idx.pids.length; i++) {
    var pid = idx.pids[i], base = idx.index[pid], ent = sk.entities[pid];
    params[base] = ent.x;
    params[base + 1] = ent.y;
  }

  var g = RP.Sketch.makeAccess(sk, idx, params);
  var r = new Array(m);
  var J = RP.LinAlg.zeroMatrix(m, n);

  assemble(plan, g, r, J, n, wAngle, true);

  // Everything pinned: nothing to solve, just report whether it holds.
  if (n === 0) {
    var residFixed = RP.LinAlg.maxAbs(r, m);
    return finish(residFixed < tol, 0, residFixed, 0);
  }

  var f = RP.LinAlg.normSq(r, m);
  var lambda = 1e-6;
  var iter = 0;
  var ok = RP.LinAlg.maxAbs(r, m) < tol;

  var trial = new Array(n);
  var rTrial = new Array(m);
  var gTrial = RP.Sketch.makeAccess(sk, idx, trial);
  var diag = new Array(n);

  for (iter = 0; iter < maxIter && !ok; iter++) {
    var ne = RP.LinAlg.normalEquations(J, r, m, n);
    var A = ne.A, grad = ne.g;
    for (i = 0; i < n; i++) diag[i] = A[i][i];

    var neg = new Array(n);
    for (i = 0; i < n; i++) neg[i] = -grad[i];

    // UNIFORM (Levenberg) damping, scaled to the problem's magnitude.
    //
    // Marquardt's per-parameter damping (lambda * diag) is wrong here:
    // sketches are routinely rank-deficient, and scaling the damping by
    // each parameter's own gradient amplifies the weakly-constrained
    // directions. A single distance constraint on a near-horizontal line
    // would demand a step of r/(4*gy) in y — hundreds of pixels — which
    // breaks the linearisation, gets rejected, and ratchets lambda up
    // until the solve stalls. Uniform damping yields the minimum-norm
    // step, which moves along the gradient as intended.
    var maxDiag = 0;
    for (i = 0; i < n; i++) if (diag[i] > maxDiag) maxDiag = diag[i];
    var dampScale = maxDiag > 1e-12 ? maxDiag : 1;

    var accepted = false;
    for (var retry = 0; retry < 40; retry++) {
      for (i = 0; i < n; i++) {
        A[i][i] = diag[i] + lambda * dampScale;
      }
      var dx = RP.LinAlg.luSolve(A, neg, n);
      if (dx) {
        for (i = 0; i < n; i++) trial[i] = params[i] + dx[i];
        assemble(plan, gTrial, rTrial, null, n, wAngle, false);
        var fT = RP.LinAlg.normSq(rTrial, m);
        if (fT < f) {
          for (i = 0; i < n; i++) params[i] = trial[i];
          f = fT;
          accepted = true;
          break;
        }
      }
      lambda *= 4;
      if (lambda > 1e12) break;
    }

    if (!accepted) break;

    assemble(plan, g, r, J, n, wAngle, true);
    ok = RP.LinAlg.maxAbs(r, m) < tol;
    lambda = Math.max(lambda / 3, 1e-12);
  }

  RP.Sketch.writeBack(sk, idx, params);

  var resid = RP.LinAlg.maxAbs(r, m);
  return finish(resid < tol, iter, resid, RP.LinAlg.rank(J, m, n));
};

// Move a point and re-solve with that point pinned, so the rest of the
// sketch follows it. On failure the geometry keeps its best-effort
// positions and ok is false — matching how CAD sketchers go red mid-drag
// rather than snapping back.
RP.Sketch.dragPoint = function(sk, pointId, x, y, opts) {
  var e = sk.entities[pointId];
  if (!e || e.type !== 'point') return null;
  e.x = x;
  e.y = y;
  var o = { fixedPoints: [pointId], maxIter: (opts && opts.maxIter) || 30 };
  if (opts && opts.tol) o.tol = opts.tol;
  return RP.Sketch.solve(sk, o);
};
