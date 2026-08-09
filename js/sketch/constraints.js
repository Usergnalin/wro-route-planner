/* ========================================================================
   constraints.js - Constraint registry and the v1 constraint set.

   Every constraint contributes one or more equations f(params) = 0 plus
   the analytic derivatives of those equations. Adding a new constraint
   type is a self-contained registerConstraint() call — the solver never
   changes.

   Residuals are all expressed in PIXELS (positional) or RADIANS (angular);
   the solver scales angular rows by sketch.charLength so the two mix
   without wrecking the conditioning of JᵀJ.
   ======================================================================== */
var RP = window.RP || {};

RP.Sketch = RP.Sketch || {};
RP.Sketch.constraintDefs = {};
RP.Sketch.entityDefs = {};

RP.Sketch.registerConstraint = function(type, def) {
  RP.Sketch.constraintDefs[type] = def;
};

var EPS = 1e-12;

// Jacobian writer that silently drops derivatives w.r.t. pinned points.
function J_(J, row, col, v) {
  if (col >= 0) J[row][col] += v;
}

function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

function isPoint(e) { return e && e.type === 'point'; }
function isLine(e)  { return e && e.type === 'line'; }

// Endpoints for the distance/angle constraints, which accept either a line
// or a bare pair of points.
function endsOf(g, c) {
  if (c.refs.length === 1) {
    var line = g.ent(c.refs[0]);
    return [line.p1, line.p2];
  }
  return [c.refs[0], c.refs[1]];
}

// ======================================================================
// coincident(pointA, pointB)
// ======================================================================
RP.Sketch.registerConstraint('coincident', {
  label: 'Coincident',
  glyph: '●',
  equations: 2,
  weight: 'position',
  accepts: function(e) { return e.length === 2 && isPoint(e[0]) && isPoint(e[1]); },
  residual: function(g, c, r, row) {
    var a = c.refs[0], b = c.refs[1];
    r[row]     = g.px(a) - g.px(b);
    r[row + 1] = g.py(a) - g.py(b);
  },
  jacobian: function(g, c, J, row) {
    var a = c.refs[0], b = c.refs[1];
    J_(J, row,     g.cx(a),  1); J_(J, row,     g.cx(b), -1);
    J_(J, row + 1, g.cy(a),  1); J_(J, row + 1, g.cy(b), -1);
  }
});

// ======================================================================
// point_on_line(point, line)
//
// Residual is the signed perpendicular distance from the point to the
// INFINITE line through the segment. Equality constraints cannot express
// "within the segment" — FreeCAD behaves the same way.
//
// f = cross / L, so the residual is a true distance in px rather than an
// area, which keeps it comparable with the other positional rows.
// ======================================================================
// Signed perpendicular distance from a point to the INFINITE line through
// a segment, plus its derivatives. point_on_line is this with a target of
// zero; point_line_distance is this with a target of d — so they share one
// implementation rather than two copies that could drift apart.
function perpDist(g, pointId, line) {
  var a = line.p1, b = line.p2;
  var ux = g.px(b) - g.px(a), uy = g.py(b) - g.py(a);
  var L = Math.hypot(ux, uy);
  if (L < EPS) return null;
  var dpx = g.px(pointId) - g.px(a), dpy = g.py(pointId) - g.py(a);
  var cross = ux * dpy - uy * dpx;
  return { d: cross / L, ux: ux, uy: uy, L: L, dpx: dpx, dpy: dpy, cross: cross, a: a, b: b };
}

function perpDistJacobian(g, pointId, line, J, row) {
  var q = perpDist(g, pointId, line);
  if (!q) return;
  var L = q.L, L3 = L * L * L;
  // d(cross)/dv / L  -  cross * d(L)/dv / L^2
  J_(J, row, g.cx(pointId), -q.uy / L);
  J_(J, row, g.cy(pointId),  q.ux / L);
  J_(J, row, g.cx(q.a), (q.uy - q.dpy) / L + q.cross * q.ux / L3);
  J_(J, row, g.cy(q.a), (q.dpx - q.ux) / L + q.cross * q.uy / L3);
  J_(J, row, g.cx(q.b),  q.dpy / L - q.cross * q.ux / L3);
  J_(J, row, g.cy(q.b), -q.dpx / L - q.cross * q.uy / L3);
}

RP.Sketch.perpDistance = function(sk, pointId, lineId) {
  var line = sk.entities[lineId];
  if (!line || line.type !== 'line') return null;
  var g = {
    px: function(id) { return sk.entities[id].x; },
    py: function(id) { return sk.entities[id].y; }
  };
  var q = perpDist(g, pointId, line);
  return q ? q.d : null;
};

RP.Sketch.registerConstraint('point_on_line', {
  label: 'Point on line',
  glyph: '―',
  equations: 1,
  weight: 'position',
  accepts: function(e) { return e.length === 2 && isPoint(e[0]) && isLine(e[1]); },
  residual: function(g, c, r, row) {
    var q = perpDist(g, c.refs[0], g.ent(c.refs[1]));
    r[row] = q ? q.d : 0;
  },
  jacobian: function(g, c, J, row) {
    perpDistJacobian(g, c.refs[0], g.ent(c.refs[1]), J, row);
  }
});

// ======================================================================
// point_line_distance(point, line, d)
//
// Hold a point a fixed perpendicular distance from a line. This is what
// makes wall_align honest: the field wall is real fixed geometry, and the
// robot's stopping point is CONSTRAINED to sit `clearance` away from it,
// solved like everything else — rather than a helper writing coordinates
// behind the solver's back.
//
// The value is SIGNED, so which side of the wall the point sits on is
// preserved.
// ======================================================================
RP.Sketch.registerConstraint('point_line_distance', {
  label: 'Distance to line',
  glyph: '⊥',
  equations: 1,
  weight: 'position',
  hasValue: true,
  accepts: function(e) { return e.length === 2 && isPoint(e[0]) && isLine(e[1]); },
  residual: function(g, c, r, row) {
    var q = perpDist(g, c.refs[0], g.ent(c.refs[1]));
    r[row] = q ? (q.d - c.value) : 0;
  },
  jacobian: function(g, c, J, row) {
    perpDistJacobian(g, c.refs[0], g.ent(c.refs[1]), J, row);
  }
});

// ======================================================================
// horizontal(line) / vertical(line)
// ======================================================================
RP.Sketch.registerConstraint('horizontal', {
  label: 'Horizontal',
  glyph: 'H',
  equations: 1,
  weight: 'position',
  accepts: function(e) { return e.length === 1 && isLine(e[0]); },
  residual: function(g, c, r, row) {
    var l = g.ent(c.refs[0]);
    r[row] = g.py(l.p1) - g.py(l.p2);
  },
  jacobian: function(g, c, J, row) {
    var l = g.ent(c.refs[0]);
    J_(J, row, g.cy(l.p1),  1);
    J_(J, row, g.cy(l.p2), -1);
  }
});

RP.Sketch.registerConstraint('vertical', {
  label: 'Vertical',
  glyph: 'V',
  equations: 1,
  weight: 'position',
  accepts: function(e) { return e.length === 1 && isLine(e[0]); },
  residual: function(g, c, r, row) {
    var l = g.ent(c.refs[0]);
    r[row] = g.px(l.p1) - g.px(l.p2);
  },
  jacobian: function(g, c, J, row) {
    var l = g.ent(c.refs[0]);
    J_(J, row, g.cx(l.p1),  1);
    J_(J, row, g.cx(l.p2), -1);
  }
});

// ======================================================================
// distance(line, value) | distance(pointA, pointB, value)
// ======================================================================
RP.Sketch.registerConstraint('distance', {
  label: 'Distance',
  glyph: '↔',
  equations: 1,
  weight: 'position',
  hasValue: true,
  accepts: function(e) {
    if (e.length === 1) return isLine(e[0]);
    return e.length === 2 && isPoint(e[0]) && isPoint(e[1]);
  },
  residual: function(g, c, r, row) {
    var e = endsOf(g, c);
    var dx = g.px(e[1]) - g.px(e[0]), dy = g.py(e[1]) - g.py(e[0]);
    r[row] = Math.hypot(dx, dy) - c.value;
  },
  jacobian: function(g, c, J, row) {
    var e = endsOf(g, c);
    var a = e[0], b = e[1];
    var dx = g.px(b) - g.px(a), dy = g.py(b) - g.py(a);
    var d = Math.hypot(dx, dy);
    if (d < EPS) { dx = 1; dy = 0; d = 1; }   // degenerate: pick a direction
    var ux = dx / d, uy = dy / d;
    J_(J, row, g.cx(b),  ux); J_(J, row, g.cy(b),  uy);
    J_(J, row, g.cx(a), -ux); J_(J, row, g.cy(a), -uy);
  }
});

// ======================================================================
// angle(line, value)              — direction of the line vs +X
// angle(lineA, lineB, value)      — signed angle from A to B
//
// Value is in RADIANS. Residual is wrapped to (-pi, pi] so the solver
// always takes the short way round.
// ======================================================================
RP.Sketch.registerConstraint('angle', {
  label: 'Angle',
  glyph: '∠',
  equations: 1,
  weight: 'angle',
  hasValue: true,
  accepts: function(e) {
    if (e.length === 1) return isLine(e[0]);
    return e.length === 2 && isLine(e[0]) && isLine(e[1]);
  },
  residual: function(g, c, r, row) {
    var la = g.ent(c.refs[0]);
    var ux = g.px(la.p2) - g.px(la.p1), uy = g.py(la.p2) - g.py(la.p1);
    if (c.refs.length === 1) {
      r[row] = wrapPi(Math.atan2(uy, ux) - c.value);
      return;
    }
    var lb = g.ent(c.refs[1]);
    var vx = g.px(lb.p2) - g.px(lb.p1), vy = g.py(lb.p2) - g.py(lb.p1);
    var C = ux * vy - uy * vx, D = ux * vx + uy * vy;
    r[row] = wrapPi(Math.atan2(C, D) - c.value);
  },
  jacobian: function(g, c, J, row) {
    var la = g.ent(c.refs[0]);
    var ux = g.px(la.p2) - g.px(la.p1), uy = g.py(la.p2) - g.py(la.p1);

    if (c.refs.length === 1) {
      var q = ux * ux + uy * uy;
      if (q < EPS) return;
      var dux = -uy / q, duy = ux / q;
      J_(J, row, g.cx(la.p2),  dux); J_(J, row, g.cx(la.p1), -dux);
      J_(J, row, g.cy(la.p2),  duy); J_(J, row, g.cy(la.p1), -duy);
      return;
    }

    var lb = g.ent(c.refs[1]);
    var vx = g.px(lb.p2) - g.px(lb.p1), vy = g.py(lb.p2) - g.py(lb.p1);
    var C = ux * vy - uy * vx, D = ux * vx + uy * vy;
    var q2 = C * C + D * D;               // = |u|^2 |v|^2
    if (q2 < EPS) return;

    var dUx = ( D * vy - C * vx) / q2;
    var dUy = (-D * vx - C * vy) / q2;
    var dVx = (-D * uy - C * ux) / q2;
    var dVy = ( D * ux - C * uy) / q2;

    J_(J, row, g.cx(la.p2),  dUx); J_(J, row, g.cx(la.p1), -dUx);
    J_(J, row, g.cy(la.p2),  dUy); J_(J, row, g.cy(la.p1), -dUy);
    J_(J, row, g.cx(lb.p2),  dVx); J_(J, row, g.cx(lb.p1), -dVx);
    J_(J, row, g.cy(lb.p2),  dVy); J_(J, row, g.cy(lb.p1), -dVy);
  }
});

// ======================================================================
// fix(point) - pin a point at its current location.
//
// Not on the original "minimum" list, but required: without at least one
// anchor the sketch keeps 3 global degrees of freedom (2 translation +
// 1 rotation) and geometry drifts under dragging. It is also how geometry
// gets pinned to fixed features of the mat image.
// ======================================================================
RP.Sketch.registerConstraint('fix', {
  label: 'Lock',
  glyph: '\u{1F512}',
  equations: 2,
  weight: 'position',
  accepts: function(e) { return e.length === 1 && isPoint(e[0]); },
  init: function(c, sk, entities) {
    c.x = entities[0].x;
    c.y = entities[0].y;
  },
  residual: function(g, c, r, row) {
    var p = c.refs[0];
    r[row]     = g.px(p) - c.x;
    r[row + 1] = g.py(p) - c.y;
  },
  jacobian: function(g, c, J, row) {
    var p = c.refs[0];
    J_(J, row,     g.cx(p), 1);
    J_(J, row + 1, g.cy(p), 1);
  }
});

// ======================================================================
// ARC CONSTRAINTS
//
// The arc entity and its equal-radius equation landed in phase 1; these
// are what make arcs usable rather than merely representable.
// ======================================================================

// Unit vector from the arc centre to a point, or null if degenerate.
function radialUnit(g, centerId, pointId) {
  var dx = g.px(pointId) - g.px(centerId);
  var dy = g.py(pointId) - g.py(centerId);
  var r = Math.hypot(dx, dy);
  if (r < EPS) return null;
  return { x: dx / r, y: dy / r, r: r };
}

// point_on_arc(point, arc) — the point sits on the arc's circle.
RP.Sketch.registerConstraint('point_on_arc', {
  label: 'Point on arc',
  glyph: '◠',
  equations: 1,
  weight: 'position',
  accepts: function(e) { return e.length === 2 && isPoint(e[0]) && e[1] && e[1].type === 'arc'; },
  residual: function(g, c, r, row) {
    var arc = g.ent(c.refs[1]);
    var up = radialUnit(g, arc.center, c.refs[0]);
    var u0 = radialUnit(g, arc.center, arc.p1);
    r[row] = (up && u0) ? (up.r - u0.r) : 0;
  },
  jacobian: function(g, c, J, row) {
    var arc = g.ent(c.refs[1]);
    var p = c.refs[0], cen = arc.center;
    var up = radialUnit(g, cen, p);
    var u0 = radialUnit(g, cen, arc.p1);
    if (!up || !u0) return;
    J_(J, row, g.cx(p), up.x);         J_(J, row, g.cy(p), up.y);
    J_(J, row, g.cx(arc.p1), -u0.x);   J_(J, row, g.cy(arc.p1), -u0.y);
    J_(J, row, g.cx(cen), u0.x - up.x);
    J_(J, row, g.cy(cen), u0.y - up.y);
  }
});

// radius(arc, value)
RP.Sketch.registerConstraint('radius', {
  label: 'Radius',
  glyph: 'R',
  equations: 1,
  weight: 'position',
  hasValue: true,
  accepts: function(e) { return e.length === 1 && e[0] && e[0].type === 'arc'; },
  residual: function(g, c, r, row) {
    var arc = g.ent(c.refs[0]);
    var u = radialUnit(g, arc.center, arc.p1);
    r[row] = u ? (u.r - c.value) : 0;
  },
  jacobian: function(g, c, J, row) {
    var arc = g.ent(c.refs[0]);
    var u = radialUnit(g, arc.center, arc.p1);
    if (!u) return;
    J_(J, row, g.cx(arc.p1), u.x);  J_(J, row, g.cy(arc.p1), u.y);
    J_(J, row, g.cx(arc.center), -u.x);
    J_(J, row, g.cy(arc.center), -u.y);
  }
});

// tangent(line, arc) — the line touches the circle exactly once, i.e. the
// centre stands one radius off the line. `side` is captured at creation so
// the arc stays on the side of the line it started on.
RP.Sketch.registerConstraint('tangent', {
  label: 'Tangent',
  glyph: 'T',
  equations: 1,
  weight: 'position',
  accepts: function(e) {
    return e.length === 2 && isLine(e[0]) && e[1] && e[1].type === 'arc';
  },
  init: function(c, sk) {
    var d = RP.Sketch.perpDistance(sk, sk.entities[c.refs[1]].center, c.refs[0]);
    c.side = (d !== null && d < 0) ? -1 : 1;
  },
  residual: function(g, c, r, row) {
    var line = g.ent(c.refs[0]), arc = g.ent(c.refs[1]);
    var q = perpDist(g, arc.center, line);
    var u = radialUnit(g, arc.center, arc.p1);
    if (!q || !u) { r[row] = 0; return; }
    r[row] = q.d - (c.side || 1) * u.r;
  },
  jacobian: function(g, c, J, row) {
    var line = g.ent(c.refs[0]), arc = g.ent(c.refs[1]);
    var u = radialUnit(g, arc.center, arc.p1);
    if (!u) return;
    // d(perpDistance(centre, line)) — writes the centre and line columns
    perpDistJacobian(g, arc.center, line, J, row);
    // minus side * d(radius): radius grows with p1 and shrinks with centre
    var s = (c.side || 1);
    J_(J, row, g.cx(arc.p1), -s * u.x);  J_(J, row, g.cy(arc.p1), -s * u.y);
    J_(J, row, g.cx(arc.center), s * u.x);
    J_(J, row, g.cy(arc.center), s * u.y);
  }
});

// ======================================================================
// ENTITY-CONTRIBUTED EQUATIONS
//
// An arc stores centre + two endpoints and derives its radius, so it must
// assert that both endpoints are equidistant from the centre. Proving this
// extension point works now means point_on_arc and tangent drop in later
// without touching the solver.
// ======================================================================
RP.Sketch.entityDefs.arc = {
  equations: 1,
  weight: 'position',
  residual: function(g, e, r, row) {
    var c = e.center;
    var r1 = Math.hypot(g.px(e.p1) - g.px(c), g.py(e.p1) - g.py(c));
    var r2 = Math.hypot(g.px(e.p2) - g.px(c), g.py(e.p2) - g.py(c));
    r[row] = r1 - r2;
  },
  jacobian: function(g, e, J, row) {
    var c = e.center;
    var d1x = g.px(e.p1) - g.px(c), d1y = g.py(e.p1) - g.py(c);
    var d2x = g.px(e.p2) - g.px(c), d2y = g.py(e.p2) - g.py(c);
    var r1 = Math.hypot(d1x, d1y), r2 = Math.hypot(d2x, d2y);
    if (r1 < EPS || r2 < EPS) return;
    var u1x = d1x / r1, u1y = d1y / r1;
    var u2x = d2x / r2, u2y = d2y / r2;
    J_(J, row, g.cx(e.p1),  u1x); J_(J, row, g.cy(e.p1),  u1y);
    J_(J, row, g.cx(e.p2), -u2x); J_(J, row, g.cy(e.p2), -u2y);
    J_(J, row, g.cx(c), u2x - u1x);
    J_(J, row, g.cy(c), u2y - u1y);
  }
};

// Radius of an arc, derived from its stored points.
RP.Sketch.arcRadius = function(sk, arc) {
  var c = sk.entities[arc.center], p = sk.entities[arc.p1];
  if (!c || !p) return 0;
  return Math.hypot(p.x - c.x, p.y - c.y);
};
