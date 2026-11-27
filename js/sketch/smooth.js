/* ========================================================================
   smooth.js (sketch layer) - Smooth corners as sketch entities.

   A smooth corner is a curve whose curvature rises from 0 to 1/R along a
   raised cosine, holds 1/R, and falls back the same way:

       k(s) = (1/R) (1 - cos(pi s / Lt)) / 2     on each ramp (length Lt)

   `ramp` (0..1) is the share of the turn taken by the two ramps (1 = all
   ramp, 0 = a circular arc). For a turn theta:

       Lt = ramp * |theta| * R          each ramp
       L  = (1 + ramp) * |theta| * R    whole curve

   It starts and ends straight, so a robot can drive it exactly from and
   into straights (the robot library's bot.curve() is the same shape -
   lib/Bot/src/Bot.cpp baseK/baseAngle in the WRO2027 repo; change both
   together).

   ENTITY: like an arc it is pure topology over points, so it can be
   constrained like anything else:

       { type: 'smooth', p1, vertex, p2, ramp }

   p1 and p2 are where the curve starts and ends. `vertex` is where its two
   end tangents meet - the corner it rounds off - so a line through p1 and
   the vertex is tangent at p1 (tangency is just point_on_line). The shape
   is symmetric, so the one internal equation is |vertex-p1| = |vertex-p2|
   (entityDefs.smooth). Everything else - the turn, the tightest radius R,
   the length - is derived. ramp is a fixed property, not solved for.
   Turns up to just under 180 degrees (at 180 the vertex is at infinity).

   It is a separate kind of geometry from an arc throughout the planner.
   ======================================================================== */
var RP = window.RP || {};
RP.Sketch = RP.Sketch || {};

RP.Sketch.SMOOTH_DEFAULT_RAMP = 1;

function sJ(J, row, col, v) { if (col >= 0) J[row][col] += v; }

// Heading change (>= 0) from the start to s along a smooth corner of turn
// |theta| and tightest radius 1. Closed form of the raised-cosine integral.
RP.Sketch.smoothUnitAngle = function(thetaAbs, ramp, s) {
  var Lt = ramp * thetaAbs, L = (1 + ramp) * thetaAbs;
  if (Lt <= 0) return Math.min(Math.max(s, 0), L);
  function up(u) { return u / 2 - Lt / (2 * Math.PI) * Math.sin(Math.PI * u / Lt); }
  if (s <= Lt) return up(Math.max(s, 0));
  if (s >= L - Lt) return (L - Lt) - up(Math.max(L - s, 0));
  return Lt / 2 + (s - Lt);
};

// Point at distance s along the unit curve (start at the origin heading +x,
// turning towards +y). Midpoint rule on the exact heading; a fixed number
// of steps per call keeps it smooth in theta for finite differences.
RP.Sketch.smoothUnitPoint = function(thetaAbs, ramp, s, steps) {
  var n = steps || 96, ds = s / n, x = 0, y = 0;
  for (var i = 0; i < n; i++) {
    var h = RP.Sketch.smoothUnitAngle(thetaAbs, ramp, (i + 0.5) * ds);
    x += Math.cos(h) * ds;
    y += Math.sin(h) * ds;
  }
  return { x: x, y: y };
};

// Distance from the start to the vertex (where the end tangents meet) on
// the unit curve. The vertex is on the start tangent (the x axis); the end
// tangent leaves the end point at angle theta.
RP.Sketch.smoothUnitLeg = function(thetaAbs, ramp, steps) {
  var e = RP.Sketch.smoothUnitPoint(thetaAbs, ramp, (1 + ramp) * thetaAbs, steps || 256);
  var t = Math.tan(thetaAbs);
  if (Math.abs(thetaAbs - Math.PI / 2) < 1e-12) return e.x;
  return e.x - e.y / t;
};

function rampOf(e) {
  var f = e && e.ramp != null ? Number(e.ramp) : RP.Sketch.SMOOTH_DEFAULT_RAMP;
  return isFinite(f) ? Math.min(1, Math.max(0, f)) : RP.Sketch.SMOOTH_DEFAULT_RAMP;
}
RP.Sketch.smoothRamp = rampOf;

// Shape from raw coordinates: start a, vertex v, end b. sweep is signed in
// canvas atan2 terms (same sense as arc sweeps), R the tightest radius.
function shapeFrom(ax, ay, vx, vy, bx, by, ramp, legSteps) {
  var d1 = Math.hypot(vx - ax, vy - ay), d2 = Math.hypot(bx - vx, by - vy);
  if (d1 < 1e-9 || d2 < 1e-9) return null;
  var h0 = Math.atan2(vy - ay, vx - ax), h1 = Math.atan2(by - vy, bx - vx);
  var sweep = h1 - h0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  var th = Math.abs(sweep);
  if (th < 1e-6 || th > Math.PI - 1e-3) return null;
  var leg = RP.Sketch.smoothUnitLeg(th, ramp, legSteps);
  if (!(leg > 1e-9)) return null;
  var R = (d1 + d2) / 2 / leg;
  return { h0: h0, sweep: sweep, theta: th, R: R, d1: d1, d2: d2,
           length: (1 + ramp) * th * R, ramp: ramp };
}

// Resolved geometry of a smooth entity: { start, vertex, end, h0 (start
// heading), sweep (signed), radius (tightest), length, ramp } or null.
RP.Sketch.smoothGeometry = function(sk, e) {
  if (!e || e.type !== 'smooth') return null;
  var a = sk.entities[e.p1], v = sk.entities[e.vertex], b = sk.entities[e.p2];
  if (!a || !v || !b) return null;
  var f = rampOf(e);
  var s = shapeFrom(a.x, a.y, v.x, v.y, b.x, b.y, f);
  if (!s) return null;
  return { start: { x: a.x, y: a.y }, vertex: { x: v.x, y: v.y }, end: { x: b.x, y: b.y },
           h0: s.h0, sweep: s.sweep, radius: s.R, length: s.length, ramp: f };
};

// Point on the curve at fraction u (0..1) of its length, from raw coords.
function curveAt(ax, ay, vx, vy, bx, by, ramp, u, steps) {
  var s = shapeFrom(ax, ay, vx, vy, bx, by, ramp);
  if (!s) return null;
  var p = RP.Sketch.smoothUnitPoint(s.theta, ramp, u * (1 + ramp) * s.theta, steps || 128);
  var sg = s.sweep >= 0 ? 1 : -1;
  var c = Math.cos(s.h0), sn = Math.sin(s.h0);
  var lx = p.x * s.R, ly = sg * p.y * s.R;
  return { x: ax + lx * c - ly * sn, y: ay + lx * sn + ly * c };
}

// Polyline along the curve from p1 to p2, endpoints pinned exactly (the
// last few microns of integration are mapped away by a similarity about p1).
RP.Sketch.smoothPoints = function(sk, e, steps) {
  var g = RP.Sketch.smoothGeometry(sk, e);
  if (!g) {
    var a0 = sk.entities[e.p1], v0 = sk.entities[e.vertex], b0 = sk.entities[e.p2];
    return (a0 && v0 && b0) ? [{ x: a0.x, y: a0.y }, { x: v0.x, y: v0.y }, { x: b0.x, y: b0.y }] : [];
  }
  steps = Math.max(2, steps | 0);
  var th = Math.abs(g.sweep), sg = g.sweep >= 0 ? 1 : -1, f = g.ramp;
  var L = (1 + f) * th, sub = 8, n = steps * sub, ds = L / n;
  var x = 0, y = 0, raw = [{ x: 0, y: 0 }];
  for (var i = 0; i < n; i++) {
    var h = g.h0 + sg * RP.Sketch.smoothUnitAngle(th, f, (i + 0.5) * ds);
    x += Math.cos(h) * ds * g.radius;
    y += Math.sin(h) * ds * g.radius;
    if ((i + 1) % sub === 0) raw.push({ x: x, y: y });
  }
  var a = g.start, b = g.end;
  var ex = raw[raw.length - 1].x, ey = raw[raw.length - 1].y;
  var tx = b.x - a.x, ty = b.y - a.y, d2 = ex * ex + ey * ey;
  var cr = (tx * ex + ty * ey) / d2, ci = (ty * ex - tx * ey) / d2;
  var pts = raw.map(function(p) { return { x: a.x + p.x * cr - p.y * ci, y: a.y + p.x * ci + p.y * cr }; });
  pts[0] = { x: a.x, y: a.y };
  pts[pts.length - 1] = { x: b.x, y: b.y };
  return pts;
};

// ---- internal equation: equal legs ----------------------------------
RP.Sketch.entityDefs.smooth = {
  equations: 1,
  weight: 'position',
  residual: function(g, e, r, row) {
    var v = e.vertex;
    r[row] = Math.hypot(g.px(e.p1) - g.px(v), g.py(e.p1) - g.py(v)) -
             Math.hypot(g.px(e.p2) - g.px(v), g.py(e.p2) - g.py(v));
  },
  jacobian: function(g, e, J, row) {
    var v = e.vertex;
    var d1x = g.px(e.p1) - g.px(v), d1y = g.py(e.p1) - g.py(v);
    var d2x = g.px(e.p2) - g.px(v), d2y = g.py(e.p2) - g.py(v);
    var n1 = Math.hypot(d1x, d1y), n2 = Math.hypot(d2x, d2y);
    if (n1 < 1e-12 || n2 < 1e-12) return;
    d1x /= n1; d1y /= n1; d2x /= n2; d2y /= n2;
    sJ(J, row, g.cx(e.p1), d1x);  sJ(J, row, g.cy(e.p1), d1y);
    sJ(J, row, g.cx(e.p2), -d2x); sJ(J, row, g.cy(e.p2), -d2y);
    sJ(J, row, g.cx(v), d2x - d1x); sJ(J, row, g.cy(v), d2y - d1y);
  }
};

// The curve's three defining points as a flat list, and a way to read /
// perturb them for finite differences.
function defPts(e) { return [e.p1, e.vertex, e.p2]; }
function readPts(g, e) {
  var ids = defPts(e), out = [];
  for (var i = 0; i < 3; i++) { out.push(g.px(ids[i])); out.push(g.py(ids[i])); }
  return out;
}
function fdStep(g) {
  return 1e-4 * ((g.sk && g.sk.charLength) || 100);
}

// Nearest point on the curve to (px, py): fraction u and the point, plus
// the unit normal (left of travel) there. Coarse samples, then a few
// projection refinements.
function nearestOnCurve(c, ramp, px, py) {
  var s = shapeFrom(c[0], c[1], c[2], c[3], c[4], c[5], ramp);
  if (!s) return null;
  var N = 48, best = 0, bestD = Infinity, pts = [];
  for (var i = 0; i <= N; i++) {
    var q = curveAt(c[0], c[1], c[2], c[3], c[4], c[5], ramp, i / N, 128);
    pts.push(q);
    var d = (q.x - px) * (q.x - px) + (q.y - py) * (q.y - py);
    if (d < bestD) { bestD = d; best = i; }
  }
  var u = best / N;
  var du = 1 / N;
  for (var it = 0; it < 12; it++) {      // golden-ish shrinking search around the best sample
    var uL = Math.max(0, u - du), uR = Math.min(1, u + du);
    var qL = curveAt(c[0], c[1], c[2], c[3], c[4], c[5], ramp, uL, 128);
    var qR = curveAt(c[0], c[1], c[2], c[3], c[4], c[5], ramp, uR, 128);
    var dL = (qL.x - px) * (qL.x - px) + (qL.y - py) * (qL.y - py);
    var dR = (qR.x - px) * (qR.x - px) + (qR.y - py) * (qR.y - py);
    var qM = curveAt(c[0], c[1], c[2], c[3], c[4], c[5], ramp, u, 128);
    var dM = (qM.x - px) * (qM.x - px) + (qM.y - py) * (qM.y - py);
    if (dL < dM && dL <= dR) u = uL; else if (dR < dM) u = uR;
    du /= 2;
  }
  var p = curveAt(c[0], c[1], c[2], c[3], c[4], c[5], ramp, u, 128);
  // tangent direction there: the heading at that point
  var hs = s.h0 + (s.sweep >= 0 ? 1 : -1) *
           RP.Sketch.smoothUnitAngle(s.theta, ramp, u * (1 + ramp) * s.theta);
  return { u: u, x: p.x, y: p.y, nx: -Math.sin(hs), ny: Math.cos(hs) };
}

// Signed distance from (px, py) to the curve defined by coords c, measured
// at fraction u along it (u held fixed, for finite differences).
function signedDistAt(c, ramp, u, px, py, nx, ny) {
  var q = curveAt(c[0], c[1], c[2], c[3], c[4], c[5], ramp, u, 128);
  return q ? (px - q.x) * nx + (py - q.y) * ny : 0;
}

// point_on_smooth(point, smooth) - the point sits on the curve, anywhere
// along its length.
RP.Sketch.registerConstraint('point_on_smooth', {
  label: 'Point on smooth corner',
  glyph: '◡',
  equations: 1,
  weight: 'position',
  accepts: function(e) { return e.length === 2 && e[0] && e[0].type === 'point' && e[1] && e[1].type === 'smooth'; },
  residual: function(g, c, r, row) {
    var sm = g.ent(c.refs[1]), p = c.refs[0];
    var pts = readPts(g, sm);
    var near = nearestOnCurve(pts, rampOf(sm), g.px(p), g.py(p));
    r[row] = near ? (g.px(p) - near.x) * near.nx + (g.py(p) - near.y) * near.ny : 0;
  },
  jacobian: function(g, c, J, row) {
    var sm = g.ent(c.refs[1]), p = c.refs[0];
    var f = rampOf(sm);
    var pts = readPts(g, sm);
    var px = g.px(p), py = g.py(p);
    var near = nearestOnCurve(pts, f, px, py);
    if (!near) return;
    // The point itself: the normal. The curve's points: how the distance at
    // that same fraction changes (the nearest point's own shift doesn't
    // change the distance to first order).
    sJ(J, row, g.cx(p), near.nx);
    sJ(J, row, g.cy(p), near.ny);
    var ids = defPts(sm), h = fdStep(g);
    for (var k = 0; k < 6; k++) {
      var col = (k % 2 === 0) ? g.cx(ids[k >> 1]) : g.cy(ids[k >> 1]);
      if (col < 0) continue;
      var up = pts.slice(), dn = pts.slice();
      up[k] += h; dn[k] -= h;
      var dU = signedDistAt(up, f, near.u, px, py, near.nx, near.ny);
      var dD = signedDistAt(dn, f, near.u, px, py, near.nx, near.ny);
      J[row][col] += (dU - dD) / (2 * h);
    }
  }
});

// smooth_radius(smooth, value) - its tightest radius, in sketch px.
RP.Sketch.registerConstraint('smooth_radius', {
  label: 'Tightest radius',
  glyph: 'R',
  equations: 1,
  weight: 'position',
  hasValue: true,
  accepts: function(e) { return e.length === 1 && e[0] && e[0].type === 'smooth'; },
  residual: function(g, c, r, row) {
    var sm = g.ent(c.refs[0]);
    var p = readPts(g, sm);
    var s = shapeFrom(p[0], p[1], p[2], p[3], p[4], p[5], rampOf(sm));
    r[row] = s ? s.R - c.value : 0;
  },
  jacobian: function(g, c, J, row) {
    var sm = g.ent(c.refs[0]), f = rampOf(sm);
    var pts = readPts(g, sm), ids = defPts(sm), h = fdStep(g);
    for (var k = 0; k < 6; k++) {
      var col = (k % 2 === 0) ? g.cx(ids[k >> 1]) : g.cy(ids[k >> 1]);
      if (col < 0) continue;
      var up = pts.slice(), dn = pts.slice();
      up[k] += h; dn[k] -= h;
      var sU = shapeFrom(up[0], up[1], up[2], up[3], up[4], up[5], f);
      var sD = shapeFrom(dn[0], dn[1], dn[2], dn[3], dn[4], dn[5], f);
      if (sU && sD) J[row][col] += (sU.R - sD.R) / (2 * h);
    }
  }
});
