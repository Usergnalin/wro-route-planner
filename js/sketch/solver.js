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

// How many damped retries one LM iteration may try before giving up on
// finding a downhill step. Each retry costs a full O(n³) factorisation and
// damping only shrinks the step, so a step the first few cannot find, more
// of them cannot either. See the retry loop for the full reasoning.
RP.Sketch.MAX_LM_RETRIES = 12;

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
//   opts.tol          iteration keeps refining until max|r| is under this,
//                     default 1e-9 — full float precision when the system
//                     can actually reach it
//   opts.conflictTol  looser threshold used only to LABEL the result,
//                     default 1e-6 — see below
//
// Returns { ok, status, dof, rank, residual, iterations, n, m }.
// Parameters are written back to the entities even on failure, so geometry
// follows as far as it can and the UI can colour it as conflicting.
//
// Two separate thresholds on purpose. An EXACTLY-determined cluster (say,
// an arc tangent to a line at a point that is also pinned by
// point_on_line, with its other end coincident to a separately-tangent
// line) has zero slack: any float noise at all, from a save/load
// round-trip or an earlier drag, leaves a residual the iteration can
// never fully zero out. Using one tight tolerance for both "keep
// refining" and "is this a conflict" meant such a sketch — already
// solved to 10 significant figures — was permanently painted red. Now
// the iteration still chases full precision (tol), but only a residual
// past conflictTol gets called a conflict; a genuine contradiction
// (mismatched dimensions, etc.) misses by orders of magnitude more than
// that, so real conflicts are still caught just as reliably.
RP.Sketch.solve = function(sk, opts) {
  opts = opts || {};
  var maxIter = opts.maxIter || 60;
  var tol = opts.tol || 1e-9;
  var conflictTol = opts.conflictTol || 1e-6;
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
    return finish(residFixed < conflictTol, 0, residFixed, 0);
  }

  var f = RP.LinAlg.normSq(r, m);
  var lambda = 1e-6;
  var iter = 0;
  var residPrev = RP.LinAlg.maxAbs(r, m);
  var ok = residPrev < tol;

  // Below this, a step is indistinguishable from float noise at the
  // geometry's own magnitude, so it cannot move the sketch. Derived from
  // the actual coordinates rather than charLength, which is a fixed 100
  // and says nothing about a sketch laid out over a competition mat.
  var coordScale = 1;
  for (i = 0; i < n; i++) {
    var av = Math.abs(params[i]);
    if (av > coordScale) coordScale = av;
  }
  var stepFloor = coordScale * 1e-13;

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

    // Each retry is a fresh O(n³) factorisation, so the cost of looking for
    // a step that helps is what dominates a big sketch. Two guards keep
    // that bounded without changing which answer we land on:
    //
    //   - a hard retry cap. Damping only ever SHRINKS the step, so once
    //     lambda is large the trial point sits essentially on top of the
    //     current one and f_trial can no longer drop below f. Grinding
    //     lambda all the way to 1e12 (≈30 factorisations) never rescues a
    //     step that the first dozen could not.
    //   - a step-size floor. If the damped step is already negligible
    //     against the geometry's own scale, no larger lambda will make it
    //     meaningful, so stop immediately rather than confirming it 20
    //     more times.
    //
    // Both matter because `tol` is ABSOLUTE while coordinates are not: a
    // mat-sized sketch runs to six figures of pixels, where 1e-9 is below
    // what doubles can represent. Such a sketch is solved as well as it
    // ever will be, yet still entered this loop on every solve and paid
    // full price to rediscover that. It now finds that out in a few
    // factorisations instead of thirty-odd.
    var accepted = false;
    for (var retry = 0; retry < RP.Sketch.MAX_LM_RETRIES; retry++) {
      for (i = 0; i < n; i++) {
        A[i][i] = diag[i] + lambda * dampScale;
      }
      var dx = RP.LinAlg.luSolve(A, neg, n);
      if (dx) {
        var stepMax = RP.LinAlg.maxAbs(dx, n);
        for (i = 0; i < n; i++) trial[i] = params[i] + dx[i];
        assemble(plan, gTrial, rTrial, null, n, wAngle, false);
        var fT = RP.LinAlg.normSq(rTrial, m);
        if (fT < f) {
          for (i = 0; i < n; i++) params[i] = trial[i];
          f = fT;
          accepted = true;
          break;
        }
        if (stepMax < stepFloor) break;   // damped into the noise; give up
      }
      lambda *= 4;
      if (lambda > 1e12) break;
    }

    if (!accepted) break;

    assemble(plan, g, r, J, n, wAngle, true);
    var resid = RP.LinAlg.maxAbs(r, m);
    ok = resid < tol;

    // Diminishing-returns exit.
    //
    // `tol` is an ABSOLUTE residual, but coordinates are not: a sketch
    // laid out over a competition mat runs to six figures of pixels,
    // where 1e-9 is finer than a double can represent. `ok` therefore
    // never trips and the loop spent its whole iteration budget on every
    // solve. The cost was not subtle — a drag converged to 1.9e-7 in five
    // iterations and then spent twenty-five more taking it to 1.7e-7, for
    // five times the time and no visible difference.
    //
    // So: once the residual is under conflictTol the sketch is solved for
    // every practical purpose (a millionth of a pixel), and we only keep
    // iterating while iterations still earn their keep. Real convergence
    // moves in orders of magnitude per step — 1e-2, 1e-3, 1e-5, 1e-7 —
    // so a step that cannot manage 10% has clearly hit the floor of what
    // this system's conditioning allows, and stopping loses nothing.
    if (!ok && resid < conflictTol && resid > residPrev * 0.9) { iter++; break; }
    residPrev = resid;
    lambda = Math.max(lambda / 3, 1e-12);
  }

  RP.Sketch.writeBack(sk, idx, params);

  var resid = RP.LinAlg.maxAbs(r, m);
  return finish(resid < conflictTol, iter, resid, RP.LinAlg.rank(J, m, n));
};

// An arc held tangent to a line cannot change which side of it the centre
// sits on by moving continuously: the centre would have to travel through
// infinity, and the arc flattens on the way. Levenberg-Marquardt follows
// that path faithfully and strands the arc at a radius of 1e5 with no way
// back — no conflict, but a curve that has straightened out and stopped
// responding.
//
// The escape is that the correct centre is available in closed form. For
// an arc tangent to a line at p and passing through its other end q, with
// n̂ the unit normal to the line:
//
//     R = |q − p|² / (2 |(q − p)·n̂|),   c = p + sign((q − p)·n̂)·R·n̂
//
// So when a radius has run away, re-seed the centre there and re-solve.
// The solver still has the last word — the guess is only kept if it
// actually satisfies the sketch better.
RP.Sketch.FLAT_ARC_RADII = 40;   // × charLength before an arc counts as flat

RP.Sketch.rescueFlatArcs = function(sk, solveOpts) {
  var limit = (sk.charLength || 100) * RP.Sketch.FLAT_ARC_RADII;
  var cids = RP.Sketch.constraintIds(sk);
  var rescued = 0;

  for (var i = 0; i < cids.length; i++) {
    var c = sk.constraints[cids[i]];
    if (!c || c.type !== 'tangent_at') continue;
    var line = sk.entities[c.refs[0]], arc = sk.entities[c.refs[1]];
    var p = sk.entities[c.refs[2]];
    if (!line || !arc || !p) continue;
    var cen = sk.entities[arc.center];
    var q = sk.entities[arc.p1 === p.id ? arc.p2 : arc.p1];
    if (!cen || !q) continue;
    if (Math.hypot(p.x - cen.x, p.y - cen.y) <= limit) continue;

    var a = sk.entities[line.p1], b = sk.entities[line.p2];
    if (!a || !b) continue;
    var dx = b.x - a.x, dy = b.y - a.y;
    var L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    var nx = -dy / L, ny = dx / L;              // unit normal to the line
    var vx = q.x - p.x, vy = q.y - p.y;
    var d = vx * nx + vy * ny;                  // how far off the line q is
    if (Math.abs(d) < 1e-6) continue;           // q is on the line: genuinely straight
    var R = (vx * vx + vy * vy) / (2 * Math.abs(d));
    if (!isFinite(R) || R > limit) continue;

    var before = { x: cen.x, y: cen.y };
    var beforeResid = sk.residual;
    cen.x = p.x + (d > 0 ? 1 : -1) * R * nx;
    cen.y = p.y + (d > 0 ? 1 : -1) * R * ny;
    var res = RP.Sketch.solve(sk, solveOpts);
    // Only keep the branch switch if it genuinely solved better.
    if (!res.ok && !(beforeResid != null && res.residual < beforeResid)) {
      cen.x = before.x; cen.y = before.y;
      RP.Sketch.solve(sk, solveOpts);
    } else {
      rescued++;
    }
  }
  return rescued;
};

// Move a point and re-solve with that point pinned, so the rest of the
// sketch follows it.
//
// The pin is an INTERACTION device, not part of the model. When the
// cursor goes somewhere the constraints cannot follow, the pinned solve
// fails — but that says nothing about whether the sketch is consistent,
// and reporting it as a conflict painted the whole sketch red for the
// rest of the drag. Dragging one end of a tangent arc past what its
// radius allows was enough to trigger it.
//
// So: try pinned; if that cannot be satisfied, drop the pin and solve the
// real system instead. The geometry then lags the cursor — which is what
// a CAD sketcher does — and the status reported is the model's own.
RP.Sketch.dragPoint = function(sk, pointId, x, y, opts) {
  var e = sk.entities[pointId];
  if (!e || e.type !== 'point') return null;
  e.x = x;
  e.y = y;
  var o = { fixedPoints: [pointId], maxIter: (opts && opts.maxIter) || 30 };
  if (opts && opts.tol) o.tol = opts.tol;
  var pinned = RP.Sketch.solve(sk, o);

  // Both paths get the flat-arc check, and it has to happen HERE, while
  // the dragged point is still sitting at the cursor. Once the pin is
  // released the point falls back onto the flattened arc, and the closed
  // form then sees an endpoint already on the tangent line — from which
  // no small circle exists and the re-seed correctly declines.
  if (RP.Sketch.rescueFlatArcs(sk, o)) {
    var retried = RP.Sketch.solve(sk, o);
    if (retried.ok) return retried;
  } else if (pinned.ok) {
    return pinned;
  }
  if (pinned.ok) return RP.Sketch.solve(sk, o);

  var free = { maxIter: o.maxIter };
  if (o.tol) free.tol = o.tol;
  var released = RP.Sketch.solve(sk, free);
  released.laggedCursor = true;   // the point did not reach where it was asked
  return released;
};
