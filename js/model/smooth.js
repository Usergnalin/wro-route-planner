/* ========================================================================
   smooth.js - Smooth corners: arcs the robot can drive exactly.

   An arc joins a straight with a jump in curvature (0 -> 1/r), which a
   two-wheeled robot can only follow by changing its wheel speeds
   instantly. A smooth corner replaces the arc with a curve whose
   curvature rises from 0 to 1/R along a raised cosine, holds 1/R, and
   falls back the same way:

       k(s) = (1/R) (1 - cos(pi s / Lt)) / 2     on each ramp (length Lt)

   `ramp` (0..1) is the share of the turn taken by the two ramps: 1 is all
   ramp (no constant-radius part), 0 is the plain arc. For a turn theta:

       Lt = ramp * |theta| * R          each ramp
       L  = (1 + ramp) * |theta| * R    whole curve

   It starts and ends straight, so it meets straights with no curvature
   jump at all, and its turning acceleration rises and falls smoothly.

   THE DRAWN ARC STAYS THE SKETCH ENTITY. A smooth corner is a way of
   DRIVING an arc: it keeps the arc's two endpoints and the tangent
   directions there (the shape is symmetric, so its chord makes theta/2
   with both end tangents - exactly like an arc's), so the rest of the
   route and every constraint are untouched. Only the path between the
   endpoints changes, and with it the radius: R is the smallest radius on
   the curve, chosen so the chord matches the arc's.

   The robot library has the same shape as bot.curve(angle, R, {.ramp}):
   lib/Bot/src/Bot.cpp baseK / baseAngle in the WRO2027 repo. Change both
   together.
   ======================================================================== */
var RP = window.RP || {};

RP.SMOOTH_DEFAULT_RAMP = 1;

RP.smoothRamp = function(act) {
  var f = act && act.ramp != null && act.ramp !== '' ? Number(act.ramp) : RP.SMOOTH_DEFAULT_RAMP;
  if (!isFinite(f)) f = RP.SMOOTH_DEFAULT_RAMP;
  return Math.min(1, Math.max(0, f));
};

// Heading change (rad, >= 0) from the start to s along a smooth corner of
// turn |theta| (rad) and smallest radius 1. Closed form of the integral of
// the raised-cosine ramps.
RP.smoothUnitAngle = function(thetaAbs, ramp, s) {
  var Lt = ramp * thetaAbs, L = (1 + ramp) * thetaAbs;
  if (Lt <= 0) return Math.min(Math.max(s, 0), L);
  function up(u) { return u / 2 - Lt / (2 * Math.PI) * Math.sin(Math.PI * u / Lt); }
  var total = L - Lt;
  if (s <= Lt) return up(Math.max(s, 0));
  if (s >= L - Lt) return total - up(Math.max(L - s, 0));
  return Lt / 2 + (s - Lt);
};

// Chord length of that unit curve (radius 1). Cached - it only depends on
// the turn and the ramp.
RP._smoothChordCache = {};
RP.smoothUnitChord = function(thetaAbs, ramp) {
  var key = thetaAbs.toFixed(6) + '|' + ramp.toFixed(4);
  var hit = RP._smoothChordCache[key];
  if (hit !== undefined) return hit;
  var L = (1 + ramp) * thetaAbs, n = 2000, ds = L / n, x = 0, y = 0;
  for (var i = 0; i < n; i++) {
    var h = RP.smoothUnitAngle(thetaAbs, ramp, (i + 0.5) * ds);
    x += Math.cos(h) * ds;
    y += Math.sin(h) * ds;
  }
  var c = Math.hypot(x, y);
  RP._smoothChordCache[key] = c;
  return c;
};

// The smooth corner that drives the arc entity `ent`, travelled p1->p2 (or
// p2->p1 when flip). Returns { start, end, sweep (rad, traversal sense, in
// canvas atan2 terms), radiusPx (smallest radius), lengthPx, ramp } or null.
RP.smoothCornerOf = function(sk, ent, flip, ramp) {
  var g = RP.Sketch.arcGeometry(sk, ent);
  if (!g) return null;
  var p1 = sk.entities[ent.p1], p2 = sk.entities[ent.p2];
  var a = flip ? p2 : p1, b = flip ? p1 : p2;
  var sweep = flip ? -g.sweep : g.sweep;
  var th = Math.abs(sweep);
  var chord = Math.hypot(b.x - a.x, b.y - a.y);
  var unit = RP.smoothUnitChord(th, ramp);
  if (th < 1e-6 || unit < 1e-9 || chord < 1e-9) return null;
  var R = chord / unit;
  return { start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, sweep: sweep,
           radiusPx: R, lengthPx: (1 + ramp) * th * R, ramp: ramp };
};

// Polyline along the smooth corner, in TRAVEL order, endpoints pinned
// exactly (the integration's last few microns are rotated/scaled away).
RP.smoothPoints = function(sk, ent, flip, ramp, steps) {
  var sc = RP.smoothCornerOf(sk, ent, flip, ramp);
  if (!sc) return [];
  steps = Math.max(2, steps | 0);
  var th = Math.abs(sc.sweep), sg = sc.sweep >= 0 ? 1 : -1;
  var a = sc.start, b = sc.end;
  var chordAng = Math.atan2(b.y - a.y, b.x - a.x);
  var h0 = chordAng - sc.sweep / 2;            // start tangent
  var R = sc.radiusPx, L = (1 + ramp) * th;    // L in units of R
  var sub = 8, n = steps * sub, ds = L / n;
  var x = 0, y = 0, raw = [{ x: 0, y: 0 }];
  for (var i = 0; i < n; i++) {
    var h = h0 + sg * RP.smoothUnitAngle(th, ramp, (i + 0.5) * ds);
    x += Math.cos(h) * ds * R;
    y += Math.sin(h) * ds * R;
    if ((i + 1) % sub === 0) raw.push({ x: x, y: y });
  }
  // Map the integrated end exactly onto b (a similarity about the start)
  var ex = raw[raw.length - 1].x, ey = raw[raw.length - 1].y;
  var tx = b.x - a.x, ty = b.y - a.y;
  var d2 = ex * ex + ey * ey;
  var cr = (tx * ex + ty * ey) / d2, ci = (ty * ex - tx * ey) / d2;   // (t / e) as a complex number
  var pts = raw.map(function(p) {
    return { x: a.x + p.x * cr - p.y * ci, y: a.y + p.x * ci + p.y * cr };
  });
  pts[0] = { x: a.x, y: a.y };
  pts[pts.length - 1] = { x: b.x, y: b.y };
  return pts;
};

// Fastest centre speed (mm/s) the corner allows for a robot of axle track
// T (mm) and turning acceleration limit turnAccel (wheel mm/s^2): the
// ramps change each wheel's turning part at v^2 * k' * T/2, and a raised
// cosine's steepest k' is pi/2 * (1/R) / Lt. Infinity for a plain arc
// (its limit is the jump at its ends, not inside it).
RP.smoothMaxSpeed = function(radiusMm, thetaAbs, ramp, T, turnAccel) {
  var Lt = ramp * thetaAbs * radiusMm;
  if (Lt <= 0) return Infinity;
  var sharp = Math.PI / 2 / radiusMm / Lt;
  return Math.sqrt(2 * turnAccel / (T * sharp));
};
