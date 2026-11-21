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
// that contributes its own equations (currently just arcs), then any SOFT
// rows the caller passed in (see dragPoint). A soft row is
// { eqs, residual(g, obj, r, row), jacobian(g, obj, J, row) } and is only
// ever used for a shaping pass that an exact solve then follows.
RP.Sketch.buildPlan = function(sk, soft) {
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

  if (soft) {
    for (i = 0; i < soft.length; i++) {
      items.push({ obj: soft[i], def: soft[i], row: m, eqs: soft[i].eqs, weight: 'position' });
      m += soft[i].eqs;
    }
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

// Endpoint tangencies saved before they carried an orientation get one
// from the geometry they were saved with — FreeCAD's "autodetect, then lock
// it" for old sketches. Runs once per constraint; after that it is stored.
RP.Sketch.backfillTangentOrient = function(sk) {
  for (var id in sk.constraints) {
    var c = sk.constraints[id];
    if (c && c.type === 'tangent_at' && c.orient == null) c.orient = RP.Sketch.tangentAtOrient(sk, c);
  }
};

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
function solveCore(sk, opts) {
  opts = opts || {};
  var maxIter = opts.maxIter || 60;
  var tol = opts.tol || 1e-9;
  var conflictTol = opts.conflictTol || 1e-6;
  var wAngle = sk.charLength || 100;

  var fixedSet = {};
  if (opts.fixedPoints) {
    for (var fi = 0; fi < opts.fixedPoints.length; fi++) fixedSet[opts.fixedPoints[fi]] = true;
  }

  RP.Sketch.backfillTangentOrient(sk);
  var idx = RP.Sketch.buildIndex(sk, fixedSet);
  var n = idx.n;
  var plan = RP.Sketch.buildPlan(sk, opts.soft);
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
    // A soft pass can never reach zero — the cursor may be out of reach —
    // so it stops as soon as an iteration buys less than 1%.
    if (opts.soft && resid > residPrev * 0.99) { iter++; break; }
    // A drag asks for something the sketch may simply not allow. Reachable
    // targets converge in a few large steps; one still crawling (under 10%
    // per iteration) is out of reach, and the drag has a better way to
    // handle that than spending the rest of the budget proving it.
    if (opts.giveUp && resid > residPrev * 0.9) { iter++; break; }
    residPrev = resid;
    lambda = Math.max(lambda / 3, 1e-12);
  }

  RP.Sketch.writeBack(sk, idx, params);

  var resid = RP.LinAlg.maxAbs(r, m);
  // The rank is a full factorisation — on a mat-sized sketch it costs more
  // than the whole iteration loop — and only labels the result (under,
  // full, redundant). Intermediate passes that another solve follows, and
  // every solve during a drag, skip it: they only need to know whether it
  // worked. The full solve on mouseup labels the sketch properly.
  if (opts.skipRank || opts.soft) {
    var okQ = resid < conflictTol;
    var prev = sk.status;
    sk.status = okQ ? (prev && prev !== 'conflict' ? prev : 'under') : 'conflict';
    sk.residual = resid;
    return { ok: okQ, status: sk.status, dof: sk.dof, rank: sk.rank,
             residual: resid, iterations: iter, n: n, m: m };
  }
  return finish(resid < conflictTol, iter, resid, RP.LinAlg.rank(J, m, n));
}

// The solve everyone calls. Shapes are protected here, not only while
// dragging: any solve that has to swing geometry a long way — adding
// `horizontal` to a line drawn steeply tangent to an arc, say — finds that
// shrinking a line, or an arc's radius or span, is the cheapest way to
// turn it. A line squeezed to nothing has no direction, so the tangent on
// it can no longer be stated and the solve stalls in conflict.
//
// So: solve, and if anything collapsed below DRAG_MIN_LENGTH of what it
// was (or an arc wrapped through zero), start again with the soft floors
// that dragging uses, then settle it exactly. When nothing collapses —
// nearly always — this costs one cheap check after the solve.
RP.Sketch.solve = function(sk, opts) {
  opts = opts || {};
  if (opts.soft || opts.unguarded) return solveCore(sk, opts);
  var before = savePoints(sk);
  // A drag measures collapse against the shape it started with, not the
  // previous mouse event (see dragPoint).
  var lens = opts.shapeRef ? opts.shapeRef.lengths : lineLengths(sk);
  var arcs = opts.shapeRef ? opts.shapeRef.arcs : arcState(sk);
  var res = solveCore(sk, opts);
  if (!collapsed(sk, lens, arcs)) return res;
  restorePoints(sk, before);
  var shaped = {};
  for (var k in opts) shaped[k] = opts[k];
  shaped.soft = minLengthRows(sk, lens, RP.Sketch.DRAG_SOFT_WEIGHT)
    .concat(sweepRows(sk, arcs, RP.Sketch.DRAG_SOFT_WEIGHT))
    .concat(radiusRows(sk, arcs, RP.Sketch.DRAG_SOFT_WEIGHT));
  solveCore(sk, shaped);
  var settled = solveCore(sk, opts);
  // Keep whichever is better; the guard must never make a solve worse.
  if (!settled.ok && res.ok) { restorePoints(sk, before); return solveCore(sk, opts); }
  return settled;
};

function collapsed(sk, lens, arcs) {
  var f = RP.Sketch.DRAG_MIN_LENGTH;
  var nowL = lineLengths(sk);
  for (var id in lens) if (nowL[id] != null && nowL[id] < lens[id] * f) return true;
  var nowA = arcState(sk);
  for (var a in arcs) {
    if (!nowA[a]) continue;
    if (nowA[a].r < arcs[a].r * f) return true;
    if (Math.abs(nowA[a].span - arcs[a].span) > Math.PI) return true;
  }
  return false;
}

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
    // The tangent locks which side of the line the centre is on (see
    // tangent_at), so that side's normal is the only one worth seeding on.
    var side = (c.orient === Math.PI) ? -1 : 1;
    var nx = side * -dy / L, ny = side * dx / L;
    var vx = q.x - p.x, vy = q.y - p.y;
    var d = vx * nx + vy * ny;                  // how far off the line q is, on that side
    if (d < 1e-6) continue;                     // on the line, or the side no such circle reaches
    var R = (vx * vx + vy * vy) / (2 * d);
    if (!isFinite(R) || R > limit) continue;

    var before = { x: cen.x, y: cen.y };
    var beforeResid = sk.residual;
    cen.x = p.x + R * nx;
    cen.y = p.y + R * ny;
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

// ---- dragging ---------------------------------------------------------
//
// Modelled on how FreeCAD drags (Sketch::moveGeometry + planegcs' two
// priority levels): the sketch's own constraints always come first, and
// what the cursor wants is satisfied only as far as they allow.
//
// One drag is a SESSION, from the first move until RP.Sketch.endDrag(): it
// remembers every line's length as the drag began. That memory is what
// stops a free line from being squeezed to nothing. Dragging an arc's end
// towards the far end of the line tangent to it used to shorten that line
// a little on every mouse move — nothing tells the solver the far end may
// move too — until it reached ~1e-7, where its direction is numerically
// meaningless; the solve then stalled there and the sketch stayed red.
//
// Each move is then:
//
//   1. PINNED  the dragged point pinned at the cursor. If that squeezed a
//              line below DRAG_MIN_LENGTH of its length at the start of the
//              drag (or an arc's radius or span), RP.Sketch.solve redoes it
//              with soft rows resisting exactly that — zero above the
//              floor, so lines behave as they always did, free ends staying
//              put, until one gets short and its far end is pushed ahead
//              instead of the line collapsing. This is the answer if it
//              solves.
//   3. LAG     the cursor is somewhere the constraints cannot follow, or
//              following it would wrap an arc through zero in one move. The
//              cursor becomes a soft target too, from where this move
//              started, and an exact solve with nothing pinned settles it.
//              The point gets as close as the sketch allows and the status
//              reported is the sketch's own, never the drag's.
RP.Sketch.DRAG_MIN_LENGTH = 0.1;   // of each line's length when the drag began
RP.Sketch.DRAG_SOFT_WEIGHT = 1;

function lineLengths(sk) {
  var out = {};
  for (var id in sk.entities) {
    var e = sk.entities[id];
    if (!e || e.type !== 'line') continue;
    var a = sk.entities[e.p1], b = sk.entities[e.p2];
    if (a && b) out[id] = Math.hypot(b.x - a.x, b.y - a.y);
  }
  return out;
}

// One-sided: zero above the floor, so it never moves anything that is not
// about to collapse.
function minLengthRows(sk, start, w) {
  var rows = [];
  for (var id in start) {
    var line = sk.entities[id];
    var floor = start[id] * RP.Sketch.DRAG_MIN_LENGTH;
    if (!line || !(floor > 0)) continue;
    rows.push({
      eqs: 1,
      residual: function(line, floor) { return function(g, o, r, row) {
        var L = Math.hypot(g.px(line.p2) - g.px(line.p1), g.py(line.p2) - g.py(line.p1));
        r[row] = L < floor ? w * (floor - L) : 0;
      }; }(line, floor),
      jacobian: function(line, floor) { return function(g, o, J, row) {
        var dx = g.px(line.p2) - g.px(line.p1), dy = g.py(line.p2) - g.py(line.p1);
        var L = Math.hypot(dx, dy);
        if (L >= floor || L < 1e-12) return;
        var ux = -w * dx / L, uy = -w * dy / L;     // d(floor − L)
        var cb = g.cx(line.p2), ca = g.cx(line.p1);
        if (cb >= 0) { J[row][cb] += ux; J[row][cb + 1] += uy; }
        if (ca >= 0) { J[row][ca] -= ux; J[row][ca + 1] -= uy; }
      }; }(line, floor)
    });
  }
  return rows;
}

// Arcs get the same protection, on their sweep: an arc whose span passes
// through zero wraps to a full circle (or the reverse), which is a real
// change of shape the user did not ask for. Soft floor at 10% of the span
// the drag started with, soft ceiling the same distance short of 360°.
// Measured as arc length at the starting radius, so it is a length like
// every other position row.
function arcState(sk) {
  var out = {};
  for (var id in sk.entities) {
    var e = sk.entities[id];
    if (!e || e.type !== 'arc') continue;
    var geo = RP.Sketch.arcGeometry(sk, e);
    if (geo) out[id] = { span: Math.abs(geo.sweep), r: geo.radius };
  }
  return out;
}

function sweepRows(sk, start, w) {
  var TAU = Math.PI * 2, rows = [];
  for (var id in start) {
    var arc = sk.entities[id];
    if (!arc) continue;
    var lo = start[id].span * RP.Sketch.DRAG_MIN_LENGTH;
    var hi = TAU - (TAU - start[id].span) * RP.Sketch.DRAG_MIN_LENGTH;
    var k = w * start[id].r;
    rows.push({
      eqs: 1,
      arc: arc, lo: lo, hi: hi, k: k,
      // |sweep| and the angles it is made of, at the solver's parameters.
      span: function(g) {
        var c = this.arc.center;
        var v1x = g.px(this.arc.p1) - g.px(c), v1y = g.py(this.arc.p1) - g.py(c);
        var v2x = g.px(this.arc.p2) - g.px(c), v2y = g.py(this.arc.p2) - g.py(c);
        var d = Math.atan2(v2y, v2x) - Math.atan2(v1y, v1x);
        d = ((d % TAU) + TAU) % TAU;
        return { span: this.arc.ccw ? d : TAU - d, v1x: v1x, v1y: v1y, v2x: v2x, v2y: v2y };
      },
      residual: function(g, o, r, row) {
        var s = o.span(g).span;
        r[row] = s < o.lo ? o.k * (o.lo - s) : s > o.hi ? o.k * (o.hi - s) : 0;
      },
      jacobian: function(g, o, J, row) {
        var q = o.span(g);
        if (q.span >= o.lo && q.span <= o.hi) return;
        var q1 = q.v1x * q.v1x + q.v1y * q.v1y, q2 = q.v2x * q.v2x + q.v2y * q.v2y;
        if (q1 < 1e-12 || q2 < 1e-12) return;
        // d|sweep| = sgn · (dφ(p2 − c) − dφ(p1 − c)), and the residual is −k·d|sweep|
        var f = -o.k * (o.arc.ccw ? 1 : -1);
        function put(pid, ax, ay) {
          var col = g.cx(pid);
          if (col >= 0) { J[row][col] += f * ax; J[row][col + 1] += f * ay; }
        }
        put(o.arc.p2, -q.v2y / q2, q.v2x / q2);
        put(o.arc.p1, q.v1y / q1, -q.v1x / q1);
        put(o.arc.center, q.v2y / q2 - q.v1y / q1, -q.v2x / q2 + q.v1x / q1);
      }
    });
  }
  return rows;
}

// And on radius: an arc whose centre lands on its own endpoint has no
// direction at either end, and no tangency involving it can be stated.
function radiusRows(sk, start, w) {
  var rows = [];
  for (var id in start) {
    var arc = sk.entities[id];
    var floor = start[id].r * RP.Sketch.DRAG_MIN_LENGTH;
    if (!arc || !(floor > 0)) continue;
    rows.push({
      eqs: 1, arc: arc, floor: floor,
      residual: function(g, o, r, row) {
        var c = o.arc.center, p = o.arc.p1;
        var R = Math.hypot(g.px(p) - g.px(c), g.py(p) - g.py(c));
        r[row] = R < o.floor ? w * (o.floor - R) : 0;
      },
      jacobian: function(g, o, J, row) {
        var c = o.arc.center, p = o.arc.p1;
        var dx = g.px(p) - g.px(c), dy = g.py(p) - g.py(c);
        var R = Math.hypot(dx, dy);
        if (R >= o.floor || R < 1e-12) return;
        var ux = -w * dx / R, uy = -w * dy / R;
        var cp = g.cx(p), cc = g.cx(c);
        if (cp >= 0) { J[row][cp] += ux; J[row][cp + 1] += uy; }
        if (cc >= 0) { J[row][cc] -= ux; J[row][cc + 1] -= uy; }
      }
    });
  }
  return rows;
}

function cursorRows(pointId, x, y, w) {
  return [{
    eqs: 2,
    residual: function(g, o, r, row) {
      r[row] = w * (g.px(pointId) - x);
      r[row + 1] = w * (g.py(pointId) - y);
    },
    jacobian: function(g, o, J, row) {
      var c = g.cx(pointId);
      if (c >= 0) { J[row][c] += w; J[row + 1][c + 1] += w; }
    }
  }];
}

function savePoints(sk) {
  var out = {};
  for (var id in sk.entities) {
    var e = sk.entities[id];
    if (e && e.type === 'point') out[id] = [e.x, e.y];
  }
  return out;
}
function restorePoints(sk, saved) {
  for (var id in saved) {
    var e = sk.entities[id];
    if (e) { e.x = saved[id][0]; e.y = saved[id][1]; }
  }
}

// Did any arc's span jump by more than half a turn in one move? That is an
// arc wrapping through zero (or 360°) between two mouse events — too fast
// for the soft span rows, which only see where a solve landed.
function arcWrapped(sk, spansBefore) {
  var now = arcState(sk);
  for (var id in spansBefore) {
    if (now[id] && Math.abs(now[id].span - spansBefore[id].span) > Math.PI) return true;
  }
  return false;
}

// Every point NOT connected to `pointId` through an entity or a
// constraint. Moving a point cannot affect geometry it shares no equation
// with, so a drag freezes all of it and solves only the piece being
// dragged — what FreeCAD's solver does by splitting a sketch into
// independent subsystems. On a mat sketch with ~400 unknowns this is the
// difference between solving all of them on every mouse event and solving
// a handful.
RP.Sketch.pointsOutsideComponent = function(sk, pointId) {
  var parent = {};
  function find(a) {
    while (parent[a] !== undefined && parent[a] !== a) a = parent[a] = (parent[parent[a]] !== undefined ? parent[parent[a]] : parent[a]);
    return a;
  }
  function union(a, b) {
    if (parent[a] === undefined) parent[a] = a;
    if (parent[b] === undefined) parent[b] = b;
    var ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  function pointsOfRef(ref) {
    var e = sk.entities[ref];
    if (!e) return [];
    return e.type === 'point' ? [ref] : RP.Sketch.pointsOf(sk, ref);
  }
  function unionAll(pts) { for (var i = 1; i < pts.length; i++) union(pts[0], pts[i]); }
  var id;
  for (id in sk.entities) {
    var e = sk.entities[id];
    if (e.type === 'point') { if (parent[e.id] === undefined) parent[e.id] = e.id; }
    else unionAll(RP.Sketch.pointsOf(sk, e.id));
  }
  for (id in sk.constraints) {
    var c = sk.constraints[id], pts = [];
    for (var r = 0; r < c.refs.length; r++) pts = pts.concat(pointsOfRef(c.refs[r]));
    unionAll(pts);
  }
  var mine = find(pointId), out = [];
  for (id in sk.entities) {
    var p = sk.entities[id];
    if (p.type === 'point' && find(p.id) !== mine) out.push(p.id);
  }
  return out;
};

// Ends the current drag session (mouseup). Harmless to call when none is
// running.
RP.Sketch.endDrag = function(sk) { if (sk) delete sk._drag; };

RP.Sketch.dragPoint = function(sk, pointId, x, y, opts) {
  var e = sk.entities[pointId];
  if (!e || e.type !== 'point') return null;
  // A drag of a different point, or a call with no session, starts one.
  if (!sk._drag || sk._drag.pointId !== pointId) {
    sk._drag = { pointId: pointId, lengths: lineLengths(sk), arcs: arcState(sk),
                 frozen: RP.Sketch.pointsOutsideComponent(sk, pointId) };
  }
  var frozen = sk._drag.frozen;
  var maxIter = (opts && opts.maxIter) || 30;
  var w = RP.Sketch.DRAG_SOFT_WEIGHT;
  var before = savePoints(sk);
  var spansBefore = arcState(sk);
  var wasSolvable = sk.status !== 'conflict';

  // 1 + 2: the point at the cursor. RP.Sketch.solve reshapes (the soft
  // floors) only if this collapsed something relative to the drag's start.
  var pin = { fixedPoints: [pointId].concat(frozen), maxIter: maxIter, shapeRef: sk._drag,
              giveUp: true, skipRank: true };
  if (opts && opts.tol) pin.tol = opts.tol;
  e.x = x; e.y = y;
  var pinned = RP.Sketch.solve(sk, pin);

  // An arc stranded at a huge radius has a closed-form way back; this has
  // to happen while the point is still at the cursor (see rescueFlatArcs).
  if (RP.Sketch.rescueFlatArcs(sk, pin)) {
    var retried = RP.Sketch.solve(sk, pin);
    if (retried.ok && !arcWrapped(sk, spansBefore)) return retried;
  } else if (pinned.ok && !arcWrapped(sk, spansBefore)) {
    return pinned;
  }

  // 3: unreachable. Start again from where this move began, let the
  // cursor pull rather than pin, then settle the sketch exactly. Both get
  // a small budget: if this does not come together quickly, the point
  // stays put for this mouse event and the next one tries again.
  restorePoints(sk, before);
  var shape = minLengthRows(sk, sk._drag.lengths, w)
    .concat(sweepRows(sk, sk._drag.arcs, w))
    .concat(radiusRows(sk, sk._drag.arcs, w));
  RP.Sketch.solve(sk, { maxIter: 15, fixedPoints: frozen, soft: shape.concat(cursorRows(pointId, x, y, w)) });
  var free = { maxIter: 15, fixedPoints: frozen, shapeRef: sk._drag, skipRank: true };
  if (opts && opts.tol) free.tol = opts.tol;
  var released = RP.Sketch.solve(sk, free);
  // Even pulled gently it would wrap an arc, or it found no valid
  // configuration at all: stay put. A drag never turns a solvable sketch
  // red.
  if (arcWrapped(sk, spansBefore) || (!released.ok && wasSolvable)) {
    restorePoints(sk, before);
    released = RP.Sketch.solve(sk, { maxIter: maxIter, fixedPoints: frozen, unguarded: true, skipRank: true });
  }
  released.laggedCursor = true;   // the point did not reach where it was asked
  return released;
};
