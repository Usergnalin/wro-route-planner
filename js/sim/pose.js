/* ========================================================================
   pose.js - The route as a dense sequence of robot POSES.

   Everything the simulator does is a fold over this: collision now,
   uncertainty later. Pure geometry — no DOM, no rendering, no mutation of
   the route or either sketch.

   A pose is { x, y, deg, actionId, kind, distMm }, in MAT pixels with
   `deg` the chassis heading in the app's usual clockwise-from-east
   convention. `distMm` is cumulative distance driven, which is what an
   uncertainty model needs to grow against.

   WHY THE TIMELINE AND NOT computeSteps()
   ---------------------------------------
   The obvious source is RP.computeSteps(), since that is what the robot
   actually executes. It cannot be used: a `linetrace_junct` step carries
   only a junction COUNT, with no distance — nothing downstream can know
   how far the robot travelled, so dead reckoning loses the robot at the
   first junction trace and every pose after it is fiction.

   RP.resolveTimeline() has real coordinates for every move, including
   that one, because the sketch knows where the geometry is. So poses come
   from the timeline and are exact by construction.
   ======================================================================== */
var RP = window.RP || {};

// Sampling density. Fine enough that a robot cannot tunnel through a mat
// obstacle between two samples (mat obstacles are centimetres, these are
// millimetres), coarse enough that a long route stays a few thousand
// poses rather than a few hundred thousand.
RP.SIM_STEP_MM = 5;
RP.SIM_TURN_DEG = 4;

// A turn in place still sweeps the body through space, and a long robot
// pivoting in a tight corner is a real way to hit something — so turns
// are sampled, not skipped.
RP.simPoseTrack = function(route, opts) {
  opts = opts || {};
  var stepMm = opts.stepMm || RP.SIM_STEP_MM;
  var turnDeg = opts.turnDeg || RP.SIM_TURN_DEG;

  if (!route || !RP.calibration || !RP.calibration.pixelsPerMm) {
    return { ok: false, reason: 'no calibration', poses: [] };
  }
  var tl = RP.resolveTimeline(route);
  if (!tl.ok) return { ok: false, reason: tl.reason || 'route is broken', poses: [] };
  if (!tl.items.length) return { ok: true, poses: [], reason: null };

  var ppm = RP.calibration.pixelsPerMm;
  var poses = [];
  var distMm = 0;
  var cur = null;   // { x, y, deg }

  function emit(x, y, deg, actionId, kind) {
    poses.push({ x: x, y: y, deg: deg, actionId: actionId, kind: kind, distMm: distMm });
  }

  // Rotate in place from `fromDeg` to `toDeg` the short way, sampling as
  // it goes. Both turn actions and the implicit swing onto a new leg use
  // this — the body sweeps identically either way.
  function sweepTo(toDeg, actionId, kind) {
    if (!cur) return;
    var delta = RP.turnAngle(cur.deg, toDeg);
    var n = Math.max(1, Math.ceil(Math.abs(delta) / turnDeg));
    for (var i = 1; i <= n; i++) {
      emit(cur.x, cur.y, cur.deg + delta * (i / n), actionId, kind);
    }
    cur.deg = ((toDeg % 360) + 360) % 360;
  }

  var items = tl.items;

  // Start pose. Without one there is no frame to begin from, so the first
  // move's own entry defines it instead — the robot is simply assumed to
  // begin where the route does, facing along it.
  var firstMove = null;
  for (var f = 0; f < items.length; f++) {
    if (items[f].kind === 'move') { firstMove = items[f]; break; }
  }
  if (!firstMove) return { ok: true, poses: [], reason: null };

  if (RP.robotConfig.startPos) {
    cur = { x: RP.robotConfig.startPos.x, y: RP.robotConfig.startPos.y,
            deg: RP.robotConfig.startHeading || 0 };
  } else {
    cur = { x: firstMove.a.x, y: firstMove.a.y,
            deg: firstMove.entryHeading === null ? 0 : firstMove.entryHeading };
  }
  emit(cur.x, cur.y, cur.deg, firstMove.action.id, 'start');

  // Drive a straight from the current pose to (tx,ty) without changing
  // heading. Used both for the virtual leg off the start marker and for
  // every straight move.
  function driveTo(tx, ty, actionId, kind) {
    var dx = tx - cur.x, dy = ty - cur.y;
    var px = Math.hypot(dx, dy);
    if (px < 1e-9) { cur.x = tx; cur.y = ty; return; }
    var mm = px / ppm;
    var n = Math.max(1, Math.ceil(mm / stepMm));
    var x0 = cur.x, y0 = cur.y, d0 = distMm;
    for (var i = 1; i <= n; i++) {
      var t = i / n;
      distMm = d0 + mm * t;
      emit(x0 + dx * t, y0 + dy * t, cur.deg, actionId, kind);
    }
    cur.x = tx; cur.y = ty;
  }

  for (var i2 = 0; i2 < items.length; i2++) {
    var it = items[i2];

    if (it.kind === 'checkpoint') continue;

    if (it.kind === 'turn') {
      var t = it.action;
      if (t.angle != null && isFinite(Number(t.angle))) {
        sweepTo(cur.deg + Number(t.angle), t.id, 'turn');
      } else if (t.angleMode === RP.TURN_AUTO && it.nextMove &&
                 it.nextMove.entryHeading !== null) {
        sweepTo(it.nextMove.entryHeading, t.id, 'turn');
      }
      continue;
    }

    var el = it.action;
    var mode = el.move || RP.MOVE_FORWARD;

    if (mode === RP.MOVE_TELEPORT) {
      // A teleport is "pick the robot up and put it there" — it sweeps
      // through nothing, so it contributes one pose and no path.
      cur = { x: it.b.x, y: it.b.y,
              deg: it.exitHeading === null ? cur.deg : it.exitHeading };
      emit(cur.x, cur.y, cur.deg, el.id, 'teleport');
      continue;
    }

    // Swing onto the leg before driving it. The turn ACTION above already
    // did this when there was one; this covers the leading leg and any
    // junction the walk did not give a turn to.
    if (it.entryHeading !== null) sweepTo(it.entryHeading, el.id, 'turn');

    // The robot may not start exactly at the leg's entry — the virtual
    // leg from the start marker is the usual case.
    if (Math.hypot(it.a.x - cur.x, it.a.y - cur.y) > 1e-6) {
      driveTo(it.a.x, it.a.y, el.id, 'move');
    }

    if (it.arc) {
      // Sample the arc's own polyline so the swept body follows the real
      // curve rather than its chord, and carry the heading round with it.
      var pts = RP.Sketch.arcPoints(RP.sketch, it.entity, 96);
      if (el.flip) pts = pts.slice().reverse();
      var prev = { x: cur.x, y: cur.y };
      for (var q = 1; q < pts.length; q++) {
        var seg = Math.hypot(pts[q].x - prev.x, pts[q].y - prev.y) / ppm;
        distMm += seg;
        // Heading along the curve, flipped when the robot drives it
        // backwards — the chassis faces away from where it is going.
        var hd = RP.toDeg(RP.angleRad(prev.x, prev.y, pts[q].x, pts[q].y));
        if (el.reverse) hd = (hd + 180) % 360;
        emit(pts[q].x, pts[q].y, hd, el.id, 'move');
        prev = pts[q];
      }
      cur.x = it.b.x; cur.y = it.b.y;
      if (it.exitHeading !== null) cur.deg = it.exitHeading;
      continue;
    }

    driveTo(it.b.x, it.b.y, el.id, 'move');
    if (it.exitHeading !== null) cur.deg = it.exitHeading;
  }

  return { ok: true, poses: poses, reason: null };
};
