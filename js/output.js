/* ========================================================================
   output.js - Instruction generation, code template output (graph model)
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

RP.UNIT_FACTORS_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };

RP.unitFactor = function(unit) {
  if (!unit) return 1;
  var k = String(unit).trim().toLowerCase();
  return RP.UNIT_FACTORS_MM[k] || 1;
};

// Which template variant a turn style renders with (see RP.MOVEMENTS.turn).
// `spin` is the movement's own template; the pivots fall back to it when
// left blank.
RP.TURN_STYLE_VARIANTS = { spin: null, pivot_left: 'pivotLeft', pivot_right: 'pivotRight' };

// Decimal places for every physical value written into generated code.
//
// 3 rather than 1 because the robot INTEGRATES these numbers: it carries
// its own idea of the heading it should be at, and every degree thrown
// away rounding a turn is a degree that idea is wrong by, permanently.
// Ten 0.05° roundings is half a degree of accumulated lie, and nothing
// downstream can recover it.
RP.CODE_DECIMALS = 3;

// The only turn worth suppressing is one that would print as zero anyway.
// Half of the last displayed place, so a dropped turn can never differ
// from the emitted text.
//
// This used to be 0.5°, which is where the real bug lived: type a turn of
// 89.5 where the geometry wanted 90, and the 0.5° remainder the auto turn
// should have emitted fell under the threshold and vanished — while the
// planner still advanced its heading to 90. The generated code and the
// planner disagreed by half a degree, silently, per corner.
RP.turnEpsilonDeg = function() { return 0.5 * Math.pow(10, -RP.CODE_DECIMALS); };

// Angles for HUMANS: full precision, but without trailing zeros, so a
// residual reads as "0.469°" rather than the "0.0°" that started this.
RP.formatDeg = function(deg) {
  if (deg == null || !isFinite(deg)) return '—';
  var s = Number(deg).toFixed(RP.CODE_DECIMALS);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
};

// Compute ordered list of steps for the longest path through a route graph.
//
// Steps:
//   { kind: 'turn',          deg, style }
//   { kind: 'forward',       mm, offsetMm, reverse }
//   { kind: 'arc',           angle, radiusMm, mm }
//   { kind: 'wall_align',    reverse, expectedDistanceMm }
//   { kind: 'teleport',      fromX, fromY, toX, toY, heading, name }
//   { kind: 'linetrace',     mm, offsetMm, reverse }
//   { kind: 'linetrace_junct', reverse }
//   { kind: 'checkpoint',    name }
// Every step but a teleport also carries actionId and `params`, the
// owning action's own parameter values (see params.js).
RP.computeSteps = function(route) {
  if (!route || !RP.calibration) return [];

  // Every turn is an action now, so this is a walk, not an inference: the
  // resolver has already worked out each move's entry and exit heading.
  var tl = RP.resolveTimeline(route);
  if (!tl.ok || tl.items.length === 0) return [];

  var ppm = RP.calibration.pixelsPerMm;
  var steps = [];
  var items = tl.items;

  var firstMove = null, firstTurn = null;
  for (var f = 0; f < items.length; f++) {
    if (!firstTurn && items[f].kind === 'turn') firstTurn = items[f].action;
    if (items[f].kind === 'move') { firstMove = items[f]; break; }
  }
  if (!firstMove) return [];

  var prevHeading = null;

  // Virtual leg from startPos. Its turn belongs to the leading auto turn —
  // the same action that then swings the robot onto the first leg.
  if (RP.robotConfig.startPos) {
    var sp = RP.robotConfig.startPos;
    var el0 = firstMove.action;
    var backward0 = !!el0.reverse;
    var mmFromStart = RP.dist(sp.x, sp.y, firstMove.a.x, firstMove.a.y) / ppm;
    if (mmFromStart > 0.5 && (el0.move || RP.MOVE_FORWARD) === RP.MOVE_FORWARD) {
      var legHeading = backward0
        ? RP.toDeg(RP.angleRad(firstMove.a.x, firstMove.a.y, sp.x, sp.y))
        : RP.toDeg(RP.angleRad(sp.x, sp.y, firstMove.a.x, firstMove.a.y));
      var turnInit = RP.turnAngle(RP.robotConfig.startHeading, legHeading);
      if (Math.abs(turnInit) > RP.turnEpsilonDeg()) {
        steps.push({ kind: 'turn', deg: turnInit, startLeg: true,
                     actionId: firstTurn ? firstTurn.id : null,
                     params: firstTurn ? firstTurn.params : {},
                     style: firstTurn ? firstTurn.style : RP.DEFAULT_TURN_STYLE });
      }
      steps.push({ kind: 'forward', mm: mmFromStart, startLeg: true,
                   actionId: el0.id, reverse: backward0, params: el0.params });
      prevHeading = legHeading;
    } else {
      prevHeading = RP.robotConfig.startHeading;
    }
  }

  for (var i = 0; i < items.length; i++) {
    var it = items[i];

    if (it.kind === 'checkpoint') {
      steps.push({ kind: 'checkpoint', actionId: it.action.id, name: it.action.name || 'checkpoint',
                   params: it.action.params });
      continue;
    }

    if (it.kind === 'turn') {
      var t = it.action;
      // A typed angle wins over the geometry, whether it was inserted
      // standalone or typed over a junction turn. The chassis ends up
      // wherever that angle puts it, which is the point of overriding.
      if (t.angle != null && isFinite(Number(t.angle))) {
        var typedDeg = Number(t.angle);
        if (Math.abs(typedDeg) > RP.turnEpsilonDeg()) {
          steps.push({ kind: 'turn', deg: typedDeg, extra: t.angleMode === RP.TURN_FIXED,
                       actionId: t.id, params: t.params, style: t.style });
          if (prevHeading !== null) prevHeading = ((prevHeading + typedDeg) % 360 + 360) % 360;
        }
        continue;
      }
      if (t.angleMode !== RP.TURN_AUTO) continue;   // typed turn with no angle
      // Swing onto whatever the next move needs. An unknown heading on
      // either side (nothing driven yet, or arriving from a teleport)
      // means there is no angle to derive.
      var next = it.nextMove;
      if (prevHeading === null || !next || next.entryHeading === null) continue;
      var deg = RP.turnAngle(prevHeading, next.entryHeading);
      if (Math.abs(deg) > RP.turnEpsilonDeg()) {
        steps.push({ kind: 'turn', deg: deg, actionId: t.id, params: t.params, style: t.style });
      }
      prevHeading = next.entryHeading;
      continue;
    }

    var el = it.action;
    var mode = el.move || RP.MOVE_FORWARD;
    var backward = !!el.reverse;
    var before = steps.length;

    if (mode === RP.MOVE_TELEPORT) {
      steps.push({
        kind: 'teleport',
        fromX: it.a.x, fromY: it.a.y,
        toX: it.b.x, toY: it.b.y,
        heading: RP.toDeg(RP.angleRad(it.a.x, it.a.y, it.b.x, it.b.y)),
        name: el.teleportName || ('teleport_' + el.id)
      });
    } else if (it.arc && mode === RP.MOVE_SMOOTH) {
      // Same endpoints and end tangents as the arc, driven along a curve
      // with no curvature jumps; R is its smallest radius.
      var ramp = RP.smoothRamp(el);
      var sc = RP.smoothCornerOf(RP.sketch, it.entity, !!el.flip, ramp);
      if (sc) {
        steps.push({
          kind: 'smooth',
          angle: it.arc.sweepDeg,                  // chassis turn, clockwise-positive
          radiusMm: sc.radiusPx / ppm,
          ramp: ramp,
          mm: sc.lengthPx / ppm,
          reverse: !it.arc.noseFirst
        });
      }
    } else if (it.arc) {
      var dCw = it.arc.sweepDeg;                 // chassis turn, clockwise-positive
      var Rmm = it.arc.radiusPx / ppm;
      var nose = it.arc.noseFirst;
      steps.push({
        kind: 'arc',
        angle: nose ? Math.abs(dCw) : -Math.abs(dCw),
        radiusMm: (nose ? 1 : -1) * (dCw >= 0 ? 1 : -1) * Rmm,
        mm: Rmm * Math.abs(dCw) * Math.PI / 180
      });
    } else {
      var legMm = RP.dist(it.a.x, it.a.y, it.b.x, it.b.y) / ppm;
      var offsetMm = el.offset || 0;
      if (mode === RP.MOVE_LINETRACE_DIST) {
        steps.push({ kind: 'linetrace', mm: legMm, offsetMm: offsetMm, reverse: backward });
      } else if (mode === RP.MOVE_LINETRACE_JUNCT) {
        steps.push({ kind: 'linetrace_junct', reverse: backward });
      } else if (mode === RP.MOVE_WALL_ALIGN) {
        // How long the leg is AS DRAWN — hand it out as expected_distance
        // so a real robot can slow down on approach instead of driving
        // blind at wall_align speed the whole leg. It is the user's own
        // number now: draw the line ending where the robot should stop.
        steps.push({ kind: 'wall_align', reverse: backward, expectedDistanceMm: legMm });
      } else {
        steps.push({ kind: 'forward', mm: legMm, offsetMm: offsetMm, reverse: backward });
      }
    }

    for (var b = before; b < steps.length; b++) { steps[b].actionId = el.id; steps[b].params = el.params; }
    prevHeading = it.exitHeading;
  }

  return steps;
};

// Steps belonging to segments the user has excluded. Filtering at the
// STEP level rather than inside computeSteps keeps the resolver whole:
// continuity is still computed across the entire route, so the headings
// and distances of an included segment are the real ones, not what they
// would be if the excluded parts had never existed.
RP.excludedStepFilter = function(route) {
  var segs = RP.routeSegments ? RP.routeSegments(route) : [];
  if (!segs.length) return null;
  var anyExcluded = false;
  for (var i = 0; i < segs.length; i++) if (!segs[i].included) anyExcluded = true;
  if (!anyExcluded) return null;

  var idx = RP.segmentIndex(route);
  return function(step) {
    if (step.actionId == null) return true;   // never drop something unowned
    var seg = idx[step.actionId];
    return !seg || seg.included !== false;
  };
};

// Where the robot actually is when a given segment begins, taken from the
// simulator's pose track so it agrees with everything else rather than
// being derived a second, subtly different way.
RP.segmentStartPose = function(route, seg) {
  if (!seg || !RP.simPoseTrack) return null;
  var ids = {};
  for (var i = 0; i < seg.actions.length; i++) ids[seg.actions[i].id] = true;
  var track = RP.simPoseTrack(route);
  if (!track.ok) return null;
  for (var p = 0; p < track.poses.length; p++) {
    if (ids[track.poses[p].actionId]) {
      return { x: track.poses[p].x, y: track.poses[p].y, deg: track.poses[p].deg };
    }
  }
  return null;
};

// One step's line of code: its movement's template, with the built-ins
// this step measured and the parameter values of the action it came from.
// len/num format a length (mm -> output unit) and a plain number.
RP.renderStep = function(st, len, num) {
  var key = st.kind;
  var variant = null;
  var b = {};
  if (key === 'turn') {
    variant = RP.TURN_STYLE_VARIANTS[st.style || RP.DEFAULT_TURN_STYLE] || null;
    b.angle = num(st.deg);
  } else if (key === 'arc') {
    b.angle = num(st.angle);
    b.radius = len(st.radiusMm);
    b.distance = len(st.mm);
  } else if (key === 'smooth') {
    b.angle = num(st.angle);
    b.radius = len(st.radiusMm);
    b.ramp = num(st.ramp);
    b.distance = len(st.mm);
    b.reversed = RP.formatBool(!!st.reverse);
  } else if (key === 'wall_align') {
    b.reversed = RP.formatBool(!!st.reverse);
    b.expected_distance = len(st.expectedDistanceMm || 0);
  } else if (key === 'linetrace') {
    b.distance = len(st.mm + (st.offsetMm || 0));
    b.reversed = RP.formatBool(!!st.reverse);
  } else if (key === 'linetrace_junct') {
    b.reversed = RP.formatBool(!!st.reverse);
  } else if (key === 'checkpoint') {
    b.name = st.name || 'checkpoint';
  } else if (key === 'forward') {
    var mag = st.mm + (st.offsetMm || 0);
    b.distance = len(st.reverse ? -mag : mag);
    b.reversed = RP.formatBool(!!st.reverse);
  } else {
    return null;
  }
  return RP.renderTemplate(key, RP.templateFor(key, variant), b, st.params);
};

RP.generateCode = function(route) {
  if (!route || !RP.calibration) return '';

  RP.ensureCodeConfig();
  var cp = RP.codeConfig.commentPrefix;

  // A broken route used to silently produce plausible-but-wrong code.
  // Now it says what is wrong and where.
  var resolved = RP.resolveRoute(route);
  if (!resolved.ok) {
    if (resolved.code === 'EMPTY') return '';
    return cp + ' Route: ' + (route.name || '?') + '\n' +
           cp + ' ⚠ ' + resolved.message;
  }
  var moveCount = resolved.moves.length;

  var unit = RP.codeConfig.defaultUnit || 'mm';
  var uFactor = RP.unitFactor(unit);
  var steps = RP.computeSteps(route);
  // Excluded segments are dropped AFTER the walk, so everything kept was
  // computed against the whole route and carries its real headings.
  var keep = RP.excludedStepFilter(route);
  var partial = !!keep;
  if (keep) steps = steps.filter(keep);
  var lines_out = [];
  function num(v) { return Number(v).toFixed(RP.CODE_DECIMALS); }
  function len(mm) { return num(mm / uFactor); }

  lines_out.push(cp + ' Route: ' + route.name);
  lines_out.push(cp + ' Path: ' + (moveCount + 1) + ' nodes, ' + moveCount + ' segments');

  var totalMm = 0;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].kind === 'forward' || steps[i].kind === 'linetrace' || steps[i].kind === 'arc' ||
        steps[i].kind === 'smooth') totalMm += steps[i].mm;
  }
  lines_out.push(cp + ' Total distance: ' + len(totalMm) + ' ' + unit);
  if (partial) {
    // Running part of a route means the robot has to already BE at that
    // part. Saying which segments these are, and where the first one
    // begins, is the difference between a useful test and a confusing
    // crash into the mat.
    var segsAll = RP.routeSegments(route);
    var inc = segsAll.filter(function(g) { return g.included !== false; });
    lines_out.push(cp + ' PARTIAL ROUTE — ' + inc.length + ' of ' + segsAll.length +
                   ' segments: ' + inc.map(function(g) { return g.name; }).join(', '));
    // Only worth saying when the first kept segment is NOT the route's own
    // start — otherwise it just repeats the Start line below it.
    if (inc.length && inc[0].id != null) {
      var startAt = RP.segmentStartPose(route, inc[0]);
      if (startAt) {
        lines_out.push(cp + ' Assumes the robot starts at (' + startAt.x.toFixed(1) + ', ' +
                       startAt.y.toFixed(1) + ') heading ' + RP.formatDeg(startAt.deg) + '°');
      }
    }
  }

  if (RP.robotConfig.startPos) {
    lines_out.push(cp + ' Start at (' + RP.robotConfig.startPos.x.toFixed(1) + ', ' +
      RP.robotConfig.startPos.y.toFixed(1) + ') heading ' + Math.round(RP.robotConfig.startHeading) + '°');
  }

  lines_out.push(cp + ' ' + '─'.repeat(37));

  // Segment headings in the emitted code. Only when the route actually has
  // segments — an unsegmented route gets exactly the output it always did.
  //
  // Keyed off the OWNING SEGMENT of each step rather than off marker
  // positions, so a segment whose actions all emitted nothing never gets a
  // heading with no code under it.
  var segMark = (RP.routeSegments(route).length > 1) ? RP.segmentIndex(route) : null;
  var curSeg;

  for (var s = 0; s < steps.length; s++) {
    var st = steps[s];
    if (segMark && st.actionId != null) {
      var owner = segMark[st.actionId];
      var ownerId = owner ? owner.id : null;
      if (owner && ownerId !== curSeg) {
        if (s > 0) lines_out.push('');
        lines_out.push(cp + ' Segment ' + owner.name);
        curSeg = ownerId;
      }
    }
    if (st.kind === 'teleport') {
      var dx2 = st.toX - st.fromX, dy2 = st.toY - st.fromY;
      var distMm2 = RP.calibration ? Math.hypot(dx2, dy2) / RP.calibration.pixelsPerMm : 0;
      lines_out.push('');
      lines_out.push(cp + ' TELEPORT: ' + st.name);
      lines_out.push(cp + ' ' + len(distMm2) + ' ' + unit + ', heading ' + Math.round(st.heading || 0) + '°, from (' +
        st.fromX.toFixed(0) + ',' + st.fromY.toFixed(0) + ') to (' +
        st.toX.toFixed(0) + ',' + st.toY.toFixed(0) + ')');
      lines_out.push('');
      continue;
    }
    var line = RP.renderStep(st, len, num);
    if (line != null) lines_out.push(line);
  }

  return lines_out.join('\n');
};

RP.updateInstructions = function() {
  if (!RP.dom.codeOutput) return;
  if (RP.updateCodeWarnings) RP.updateCodeWarnings();
  if (!RP.instructionsVisible) {
    RP.dom.codeOutput.textContent = '';
    return;
  }
  var active = RP.getActiveRoute();
  if (!active || !RP.calibration) {
    RP.dom.codeOutput.textContent = '// Need a calibrated image and a route';
    return;
  }
  var check = RP.resolveRoute(active);
  if (!check.ok && check.code === 'EMPTY') {
    RP.dom.codeOutput.textContent = '// Route has no moves yet';
    return;
  }
  try {
    RP.dom.codeOutput.textContent = RP.generateCode(active);
  } catch (e) {
    console.error('generateCode failed:', e);
    RP.dom.codeOutput.textContent = '// Error generating code - check console.';
  }
};
