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

// Compute ordered list of steps for the longest path through a route graph.
//
// Steps:
//   { kind: 'turn',          deg }
//   { kind: 'forward',       mm, reverse }
//   { kind: 'wall_align',    reverse }
//   { kind: 'teleport',      fromX, fromY, toX, toY, heading, name }
//   { kind: 'linetrace',     mm, reverse }
//   { kind: 'linetrace_junct', junctions, reverse }
//   { kind: 'checkpoint',    name }
RP.computeSteps = function(route) {
  if (!route || !RP.calibration) return [];

  // Routes are ordered references now; the resolver validates continuity
  // and hands back travel-order coordinates.
  var resolved = RP.resolveRoute(route);
  if (!resolved.ok) return [];
  var rels = resolved.elements;
  if (rels.length === 0) return [];

  var ppm = RP.calibration.pixelsPerMm;
  var steps = [];
  var sk = RP.sketch;

  function chassisHeading(a, b, backward) {
    if (backward) return RP.toDeg(RP.angleRad(b.x, b.y, a.x, a.y));
    return RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
  }

  var prevHeading = null;

  // Virtual leg from startPos
  if (RP.robotConfig.startPos) {
    var sp = RP.robotConfig.startPos;
    var firstEl = rels[0].element;
    var firstBackward = !!firstEl.reverse;
    var firstMove = firstEl.move || RP.MOVE_FORWARD;
    var pxFromStart = RP.dist(sp.x, sp.y, rels[0].a.x, rels[0].a.y);
    var mmFromStart = pxFromStart / ppm;
    if (mmFromStart > 0.5 && firstMove === RP.MOVE_FORWARD) {
      var headingStartLeg = chassisHeading(sp, rels[0].a, firstBackward);
      var turnInit = RP.turnAngle(RP.robotConfig.startHeading, headingStartLeg);
      if (Math.abs(turnInit) > 0.5) {
        steps.push({ kind: 'turn', deg: turnInit, speed: firstEl.turnSpeed });
      }
      steps.push({ kind: 'forward', mm: mmFromStart, reverse: firstBackward, speed: firstEl.speed });
      prevHeading = headingStartLeg;
    } else {
      prevHeading = RP.robotConfig.startHeading;
    }
  }

  if (route.startCheckpoint) {
    steps.push({ kind: 'checkpoint', name: route.startCheckpoint });
  }

  for (var i = 0; i < rels.length; i++) {
    var rel = rels[i];
    var el = rel.element;
    var a = rel.a, b = rel.b;
    var mode = el.move || RP.MOVE_FORWARD;
    // Travel order is already resolved into a/b, so the old
    // direction-XOR-traversal dance is gone: reverse is purely chassis.
    var effectiveBackward = !!el.reverse;

    var aExtras = el.extraTurnsBefore || [];
    for (var eti = 0; eti < aExtras.length; eti++) {
      var etDeg = RP.extraTurnDeg(aExtras[eti]);
      if (isFinite(etDeg) && Math.abs(etDeg) > 0.01) {
        steps.push({ kind: 'turn', deg: etDeg, extra: true, speed: RP.extraTurnSpeed(aExtras[eti]) });
        if (prevHeading !== null) prevHeading = ((prevHeading + etDeg) % 360 + 360) % 360;
      }
    }

    if (mode === RP.MOVE_TELEPORT) {
      var hdgTele = RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
      steps.push({
        kind: 'teleport',
        fromX: a.x, fromY: a.y,
        toX: b.x, toY: b.y,
        heading: hdgTele,
        name: el.teleportName || ('teleport_' + el.id)
      });
      prevHeading = null;
      if (el.checkpoint) steps.push({ kind: 'checkpoint', name: el.checkpoint });
      continue;
    }

    if (rel.entity.type === 'arc') {
      // Arc geometry comes from the entity itself now — centre, radius and
      // sweep are all solver-owned. The sweep is stored against p1->p2, so
      // traversing the other way negates it.
      var storedForward = !el.flip;
      var ageo = RP.Sketch.arcGeometry(sk, rel.entity);
      if (ageo) {
        ageo = { cx: ageo.cx, cy: ageo.cy, radiusPx: ageo.radius, sweepRad: ageo.sweep };
        var sweepT = storedForward ? ageo.sweepRad : -ageo.sweepRad; // travel-order sweep (canvas math)
        var ps = a;   // travel start point
        var pe = b;   // travel end point
        var ss = sweepT >= 0 ? 1 : -1;
        // Velocity-direction tangents at each end (tangent = radius rotated ±90°)
        var velStart = RP.toDeg(Math.atan2(ss * (ps.x - ageo.cx), ss * (-(ps.y - ageo.cy))));
        var velEnd   = RP.toDeg(Math.atan2(ss * (pe.x - ageo.cx), ss * (-(pe.y - ageo.cy))));
        var dCw = sweepT * 180 / Math.PI;        // chassis turn, clockwise-positive
        var Rmm = ageo.radiusPx / ppm;
        var noseFirst = !effectiveBackward;
        var startNose = noseFirst ? velStart : (velStart + 180) % 360;
        var endNose   = noseFirst ? velEnd   : (velEnd + 180) % 360;
        var angleCode  = noseFirst ? Math.abs(dCw)  : -Math.abs(dCw);
        var radiusCode = (noseFirst ? 1 : -1) * (dCw >= 0 ? 1 : -1) * Rmm;
        var arcLenMm = Rmm * Math.abs(dCw) * Math.PI / 180;
        if (prevHeading !== null) {
          var aTurn = RP.turnAngle(prevHeading, startNose);
          if (Math.abs(aTurn) > 0.5) steps.push({ kind: 'turn', deg: aTurn, speed: el.turnSpeed });
        }
        steps.push({ kind: 'arc', angle: angleCode, radiusMm: radiusCode, mm: arcLenMm, speed: el.speed });
        prevHeading = endNose;
        if (el.checkpoint) steps.push({ kind: 'checkpoint', name: el.checkpoint });
        continue;
      }
    }

    var heading = chassisHeading(a, b, effectiveBackward);
    if (prevHeading !== null) {
      var turn = RP.turnAngle(prevHeading, heading);
      if (Math.abs(turn) > 0.5) {
        steps.push({ kind: 'turn', deg: turn, speed: el.turnSpeed }); // positive = clockwise, negative = anticlockwise
      }
    }

    var legMm = RP.dist(a.x, a.y, b.x, b.y) / ppm;
    var offsetMm = el.offset || 0;
    if (mode === RP.MOVE_LINETRACE_DIST) {
      steps.push({ kind: 'linetrace', mm: legMm, offsetMm: offsetMm, reverse: effectiveBackward, speed: el.speed });
    } else if (mode === RP.MOVE_LINETRACE_JUNCT) {
      steps.push({ kind: 'linetrace_junct', junctions: el.junctions || 1, reverse: effectiveBackward, speed: el.speed });
    } else if (mode === RP.MOVE_WALL_ALIGN) {
      steps.push({ kind: 'wall_align', reverse: effectiveBackward, speed: el.speed });
      // Heading is now guaranteed perpendicular to the hit wall — snap to nearest cardinal
      prevHeading = Math.round(heading / 90) * 90 % 360;
      if (el.checkpoint) steps.push({ kind: 'checkpoint', name: el.checkpoint });
      continue;
    } else {
      steps.push({ kind: 'forward', mm: legMm, offsetMm: offsetMm, reverse: effectiveBackward, speed: el.speed });
    }

    prevHeading = heading;
    if (el.checkpoint) steps.push({ kind: 'checkpoint', name: el.checkpoint });
  }

  // Extra turns after the final move
  var lastExtras = route.endExtraTurns || [];
  for (var eti2 = 0; eti2 < lastExtras.length; eti2++) {
    var etDeg2 = RP.extraTurnDeg(lastExtras[eti2]);
    if (isFinite(etDeg2) && Math.abs(etDeg2) > 0.01) {
      steps.push({ kind: 'turn', deg: etDeg2, extra: true, speed: RP.extraTurnSpeed(lastExtras[eti2]) });
    }
  }

  return steps;
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
  var elCount = resolved.elements.length;

  var speed = RP.codeConfig.defaultSpeed;
  var unit = RP.codeConfig.defaultUnit || 'mm';
  var uFactor = RP.unitFactor(unit);
  var steps = RP.computeSteps(route);
  var lines_out = [];
  function spd(st) { return (st.speed != null && st.speed !== '') ? st.speed : speed; }

  lines_out.push(cp + ' Route: ' + route.name);
  lines_out.push(cp + ' Path: ' + (elCount + 1) + ' nodes, ' + elCount + ' segments');

  var totalMm = 0;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].kind === 'forward' || steps[i].kind === 'linetrace' || steps[i].kind === 'arc') totalMm += steps[i].mm;
  }
  lines_out.push(cp + ' Total distance: ' + (totalMm / uFactor).toFixed(1) + ' ' + unit);

  if (RP.robotConfig.startPos) {
    lines_out.push(cp + ' Start at (' + RP.robotConfig.startPos.x.toFixed(1) + ', ' +
      RP.robotConfig.startPos.y.toFixed(1) + ') heading ' + Math.round(RP.robotConfig.startHeading) + '°');
  }

  lines_out.push(cp + ' ' + '─'.repeat(37));

  for (var s = 0; s < steps.length; s++) {
    var st = steps[s];
    if (st.kind === 'turn') {
      var turnTmpl = RP.codeConfig.turnTemplate || 'turn({angle}, {speed})';
      lines_out.push(turnTmpl
        .replace(/\{angle\}/g, st.deg.toFixed(1))
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{radius\}/g, '0')
        .replace(/\{distance\}/g, '0'));
    } else if (st.kind === 'arc') {
      var arcTmpl = RP.codeConfig.turnArcTemplate || 'robot.turn_arc(angle={angle}, speed={speed}, radius={radius})';
      lines_out.push(arcTmpl
        .replace(/\{angle\}/g, st.angle.toFixed(1))
        .replace(/\{radius\}/g, (st.radiusMm / uFactor).toFixed(1))
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{distance\}/g, ((st.mm) / uFactor).toFixed(1)));
    } else if (st.kind === 'teleport') {
      var dx2 = st.toX - st.fromX, dy2 = st.toY - st.fromY;
      var distMm2 = RP.calibration ? Math.hypot(dx2, dy2) / RP.calibration.pixelsPerMm : 0;
      lines_out.push('');
      lines_out.push(cp + ' TELEPORT: ' + st.name);
      lines_out.push(cp + ' ' + (distMm2 / uFactor).toFixed(1) + ' ' + unit + ', heading ' + Math.round(st.heading || 0) + '°, from (' +
        st.fromX.toFixed(0) + ',' + st.fromY.toFixed(0) + ') to (' +
        st.toX.toFixed(0) + ',' + st.toY.toFixed(0) + ')');
      lines_out.push('');
    } else if (st.kind === 'checkpoint') {
      var cpTmpl = RP.codeConfig.checkpointTemplate || 'if callable({name}): {name}()';
      lines_out.push(cpTmpl.replace(/\{name\}/g, st.name || 'checkpoint'));
    } else if (st.kind === 'wall_align') {
      lines_out.push((RP.codeConfig.wallAlignTemplate || 'wall_align({reversed}, {speed})')
        .replace(/\{reversed\}/g, st.reverse ? 'True' : 'False')
        .replace(/\{speed\}/g, spd(st)));
    } else if (st.kind === 'linetrace') {
      lines_out.push(RP.codeConfig.lineTraceDistTemplate
        .replace(/\{distance\}/g, ((st.mm + (st.offsetMm || 0)) / uFactor).toFixed(1))
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{angle\}/g, '0'));
    } else if (st.kind === 'linetrace_junct') {
      lines_out.push(RP.codeConfig.lineTraceJunctTemplate
        .replace(/\{junctions\}/g, st.junctions)
        .replace(/\{speed\}/g, spd(st)));
    } else {
      // forward
      var mag = (st.mm + (st.offsetMm || 0)) / uFactor;
      var distOut = (st.reverse ? -mag : mag).toFixed(1);
      lines_out.push(RP.codeConfig.forwardTemplate
        .replace(/\{distance\}/g, distOut)
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{angle\}/g, '0'));
    }
  }

  return lines_out.join('\n');
};

RP.updateInstructions = function() {
  if (!RP.dom.codeOutput) return;
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
    RP.dom.codeOutput.textContent = '// Route has no elements yet';
    return;
  }
  try {
    RP.dom.codeOutput.textContent = RP.generateCode(active);
  } catch (e) {
    console.error('generateCode failed:', e);
    RP.dom.codeOutput.textContent = '// Error generating code - check console.';
  }
};
