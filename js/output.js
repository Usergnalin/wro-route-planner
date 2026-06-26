/* ========================================================================
   output.js - Instruction generation, code template output
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

// Conversion factors from mm to a target unit.
RP.UNIT_FACTORS_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 };

RP.unitFactor = function(unit) {
  if (!unit) return 1;
  var k = String(unit).trim().toLowerCase();
  if (RP.UNIT_FACTORS_MM[k]) return RP.UNIT_FACTORS_MM[k];
  return 1; // unknown unit -> treat as mm (don't silently rescale)
};

// Compute the ordered list of steps for a route. Single source of truth
// used by both the on-screen Instructions list and the generated code.
//
// Steps:
//   { kind: 'turn',          deg: <abs>, dirRight: <bool> }
//   { kind: 'forward',       mm: <number>, reverse: <bool> }
//   { kind: 'teleport',      fromX, fromY, toX, toY, heading, name }
//   { kind: 'linetrace',     mm: <number>, reverse: <bool> }
//   { kind: 'linetrace_junct', junctions: <number>, reverse: <bool> }
RP.computeSteps = function(route) {
  if (!route || route.waypoints.length < 2 || !RP.calibration) return [];

  RP.ensureSegmentDirections(route);
  RP.ensureSegmentModes(route);

  var ppm = RP.calibration.pixelsPerMm;
  var wps = route.waypoints;
  var dirs = route.segmentDirections;
  var modes = route.segmentModes;
  var tpNames = route.segmentModeTeleportNames || [];
  var jctCounts = route.segmentModeJunctionCounts || [];
  var steps = [];

  function chassisHeading(a, b, dir) {
    if (dir === RP.SEG_BACKWARD) return RP.toDeg(RP.angleRad(b.x, b.y, a.x, a.y));
    return RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
  }

  var prevHeading = null;

  // Virtual leg from startPos / startHeading.
  if (RP.robotConfig.startPos) {
    var sp = RP.robotConfig.startPos;
    var firstDir = dirs[0] || RP.SEG_FORWARD;
    var firstMode = modes[0] || RP.SEG_MODE_NORMAL;
    var pxFromStart = RP.dist(sp.x, sp.y, wps[0].x, wps[0].y);
    var mmFromStart = pxFromStart / ppm;
    if (mmFromStart > 0.5 && firstMode === RP.SEG_MODE_NORMAL) {
      var headingStartLeg = chassisHeading(sp, wps[0], firstDir);
      var turnInit = RP.turnAngle(RP.robotConfig.startHeading, headingStartLeg);
      if (Math.abs(turnInit) > 0.5) {
        steps.push({ kind: 'turn', deg: Math.abs(turnInit), dirRight: turnInit > 0 });
      }
      steps.push({ kind: 'forward', mm: mmFromStart, reverse: firstDir === RP.SEG_BACKWARD });
      prevHeading = headingStartLeg;
    } else {
      prevHeading = RP.robotConfig.startHeading;
    }
  }

  // Checkpoint on the very first waypoint.
  if (wps[0].isCheckpoint && wps[0].checkpointName) {
    steps.push({ kind: 'checkpoint', name: wps[0].checkpointName });
  }

  for (var i = 0; i < wps.length - 1; i++) {
    var a = wps[i], b = wps[i + 1];
    var dir = dirs[i] || RP.SEG_FORWARD;
    var mode = modes[i] || RP.SEG_MODE_NORMAL;

    // -- TELEPORT: omit both turns, emit comment placeholder --
    if (mode === RP.SEG_MODE_TELEPORT) {
      var hdgTele = RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
      steps.push({
        kind: 'teleport',
        fromX: a.x, fromY: a.y,
        toX: b.x, toY: b.y,
        heading: hdgTele,
        name: tpNames[i] || ('teleport_' + (i + 1))
      });
      prevHeading = null;
      if (b.isCheckpoint && b.checkpointName) {
        steps.push({ kind: 'checkpoint', name: b.checkpointName });
      }
      continue;
    }

    // -- NORMAL / LINETRACE: compute and emit turn --
    var heading = chassisHeading(a, b, dir);
    if (prevHeading !== null) {
      var turn = RP.turnAngle(prevHeading, heading);
      if (Math.abs(turn) > 0.5) {
        steps.push({ kind: 'turn', deg: Math.abs(turn), dirRight: turn > 0 });
      }
    }
    var legMm = RP.dist(a.x, a.y, b.x, b.y) / ppm;

    if (mode === RP.SEG_MODE_LINETRACE_DIST) {
      steps.push({ kind: 'linetrace', mm: legMm, reverse: dir === RP.SEG_BACKWARD });
    } else if (mode === RP.SEG_MODE_LINETRACE_JUNCT) {
      steps.push({ kind: 'linetrace_junct', junctions: jctCounts[i] || 1, reverse: dir === RP.SEG_BACKWARD });
    } else {
      steps.push({ kind: 'forward', mm: legMm, reverse: dir === RP.SEG_BACKWARD });
    }

    prevHeading = heading;

    if (b.isCheckpoint && b.checkpointName) {
      steps.push({ kind: 'checkpoint', name: b.checkpointName });
    }
  }

  return steps;
};

RP.generateCode = function(route) {
  if (!route || route.waypoints.length < 2 || !RP.calibration) return '';

  RP.ensureCodeConfig();

  var cp = RP.codeConfig.commentPrefix;
  var speed = RP.codeConfig.defaultSpeed;
  var unit = RP.codeConfig.defaultUnit || 'mm';
  var uFactor = RP.unitFactor(unit);

  var steps = RP.computeSteps(route);

  var lines_out = [];
  lines_out.push(cp + ' Route: ' + route.name);

  var totalMm = 0;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].kind === 'forward') totalMm += steps[i].mm;
    else if (steps[i].kind === 'linetrace') totalMm += steps[i].mm;
  }
  lines_out.push(cp + ' Total distance: ' + (totalMm / uFactor).toFixed(1) + ' ' + unit);

  if (RP.robotConfig.startPos) {
    lines_out.push(cp + ' Start at (' + RP.robotConfig.startPos.x.toFixed(1) + ', ' +
      RP.robotConfig.startPos.y.toFixed(1) + ') heading ' +
      Math.round(RP.robotConfig.startHeading) + '°');
  }

  lines_out.push(cp + ' ' + '─'.repeat(37));

  for (var s = 0; s < steps.length; s++) {
    var st = steps[s];
    if (st.kind === 'turn') {
      var absAngle = st.deg.toFixed(1);
      var tmpl = st.dirRight ? RP.codeConfig.turnRightTemplate : RP.codeConfig.turnLeftTemplate;
      lines_out.push(tmpl
        .replace(/\{angle\}/g, absAngle)
        .replace(/\{speed\}/g, speed)
        .replace(/\{distance\}/g, '0'));
    } else if (st.kind === 'teleport') {
      var dx2 = st.toX - st.fromX;
      var dy2 = st.toY - st.fromY;
      var distPx2 = Math.hypot(dx2, dy2);
      var distMm2 = RP.calibration ? distPx2 / RP.calibration.pixelsPerMm : 0;
      var hdg = Math.round(st.heading || 0);
      var tpName = st.name || 'teleport';
      lines_out.push('');
      lines_out.push(cp + ' TELEPORT: ' + tpName);
      lines_out.push(cp + ' ' + (distMm2 / uFactor).toFixed(1) + ' ' + unit + ', heading ' + hdg + '°, from (' +
        st.fromX.toFixed(0) + ',' + st.fromY.toFixed(0) + ') to (' +
        st.toX.toFixed(0) + ',' + st.toY.toFixed(0) + ')');
      lines_out.push(cp + ' (insert custom code below, ctrl+f "' + tpName + '")');
      lines_out.push('');
    } else if (st.kind === 'checkpoint') {
      var sep = '─'.repeat(20);
      lines_out.push('');
      lines_out.push(cp + ' ' + sep + ' CHECKPOINT: ' + (st.name || '?') + ' ' + sep);
      lines_out.push('');
    } else if (st.kind === 'linetrace') {
      var distOutLt = (st.reverse ? -st.mm / uFactor : st.mm / uFactor).toFixed(1);
      lines_out.push(RP.codeConfig.lineTraceDistTemplate
        .replace(/\{distance\}/g, Math.abs(distOutLt).toFixed(1))
        .replace(/\{speed\}/g, speed)
        .replace(/\{angle\}/g, '0'));
    } else if (st.kind === 'linetrace_junct') {
      lines_out.push(RP.codeConfig.lineTraceJunctTemplate
        .replace(/\{junctions\}/g, st.junctions)
        .replace(/\{speed\}/g, speed));
    } else {
      // forward
      var mag = st.mm / uFactor;
      var distOut = (st.reverse ? -mag : mag).toFixed(1);
      lines_out.push(RP.codeConfig.forwardTemplate
        .replace(/\{distance\}/g, distOut)
        .replace(/\{speed\}/g, speed)
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
  if (!active || active.waypoints.length < 2 || !RP.calibration) {
    RP.dom.codeOutput.textContent = '// Need a route with >=2 waypoints';
    return;
  }
  try {
    RP.dom.codeOutput.textContent = RP.generateCode(active);
  } catch (e) {
    console.error('generateCode failed:', e);
    RP.dom.codeOutput.textContent = '// Error generating code — check console.';
  }
};
