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
  if (!route || !route.nodes || route.nodes.length < 2 || !RP.calibration) return [];

  // Find longest path through graph
  var pathNodes = RP.computeLongestPath(route);
  if (!pathNodes || pathNodes.length < 2) return [];

  var ppm = RP.calibration.pixelsPerMm;
  var steps = [];

  function chassisHeading(a, b, dir) {
    if (dir === RP.SEG_BACKWARD) return RP.toDeg(RP.angleRad(b.x, b.y, a.x, a.y));
    return RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
  }

  var prevHeading = null;

  // Virtual leg from startPos
  if (RP.robotConfig.startPos) {
    var sp = RP.robotConfig.startPos;
    var firstSeg = RP.findSegBetween(route, pathNodes[0].id, pathNodes[1].id);
    var firstDir = (firstSeg && firstSeg.direction) || RP.SEG_FORWARD;
    var firstMode = (firstSeg && firstSeg.mode) || RP.SEG_MODE_NORMAL;
    var pxFromStart = RP.dist(sp.x, sp.y, pathNodes[0].x, pathNodes[0].y);
    var mmFromStart = pxFromStart / ppm;
    if (mmFromStart > 0.5 && firstMode === RP.SEG_MODE_NORMAL) {
      var headingStartLeg = chassisHeading(sp, pathNodes[0], firstDir);
      var turnInit = RP.turnAngle(RP.robotConfig.startHeading, headingStartLeg);
      if (Math.abs(turnInit) > 0.5) {
        steps.push({ kind: 'turn', deg: turnInit });
      }
      steps.push({ kind: 'forward', mm: mmFromStart, reverse: firstDir === RP.SEG_BACKWARD });
      prevHeading = headingStartLeg;
    } else {
      prevHeading = RP.robotConfig.startHeading;
    }
  }

  // First node checkpoint
  if (pathNodes[0].isCheckpoint && pathNodes[0].checkpointName) {
    steps.push({ kind: 'checkpoint', name: pathNodes[0].checkpointName });
  }

  for (var i = 0; i < pathNodes.length - 1; i++) {
    var a = pathNodes[i], b = pathNodes[i + 1];

    // Find the segment connecting these two nodes (may be traversed in reverse)
    var seg = RP.findSegBetween(route, a.id, b.id);
    if (!seg) continue;

    // Determine actual traversal direction: if segment is stored from->to but we
    // traverse to->from, the storage direction is flipped relative to travel.
    var storedForward = (seg.fromNodeId === a.id);
    var dir  = seg.direction || RP.SEG_FORWARD;
    var mode = seg.mode || RP.SEG_MODE_NORMAL;
    // Effective backward: XOR of segment.direction and traversal order
    var effectiveBackward = (dir === RP.SEG_BACKWARD) !== (!storedForward);

    // Emit extra turns stored on node a, before any geometric turn
    var aExtras = a.extraTurns || [];
    for (var eti = 0; eti < aExtras.length; eti++) {
      var etDeg = Number(aExtras[eti]);
      if (isFinite(etDeg) && Math.abs(etDeg) > 0.01) {
        steps.push({ kind: 'turn', deg: etDeg, extra: true });
        if (prevHeading !== null) prevHeading = ((prevHeading + etDeg) % 360 + 360) % 360;
      }
    }

    if (mode === RP.SEG_MODE_TELEPORT) {
      var hdgTele = RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
      steps.push({
        kind: 'teleport',
        fromX: a.x, fromY: a.y,
        toX: b.x, toY: b.y,
        heading: hdgTele,
        name: seg.teleportName || ('teleport_' + seg.id)
      });
      prevHeading = null;
      if (b.isCheckpoint && b.checkpointName) steps.push({ kind: 'checkpoint', name: b.checkpointName });
      continue;
    }

    var heading = chassisHeading(a, b, effectiveBackward ? RP.SEG_BACKWARD : RP.SEG_FORWARD);
    if (prevHeading !== null) {
      var turn = RP.turnAngle(prevHeading, heading);
      if (Math.abs(turn) > 0.5) {
        steps.push({ kind: 'turn', deg: turn }); // positive = clockwise, negative = anticlockwise
      }
    }

    var legMm = RP.dist(a.x, a.y, b.x, b.y) / ppm;
    var offsetMm = seg.offset || 0;
    if (mode === RP.SEG_MODE_LINETRACE_DIST) {
      steps.push({ kind: 'linetrace', mm: legMm, offsetMm: offsetMm, reverse: effectiveBackward });
    } else if (mode === RP.SEG_MODE_LINETRACE_JUNCT) {
      steps.push({ kind: 'linetrace_junct', junctions: seg.junctionCount || 1, reverse: effectiveBackward });
    } else if (mode === RP.SEG_MODE_WALL_ALIGN) {
      steps.push({ kind: 'wall_align', reverse: effectiveBackward });
      // Heading is now guaranteed perpendicular to the hit wall — snap to nearest cardinal
      prevHeading = Math.round(heading / 90) * 90 % 360;
      if (b.isCheckpoint && b.checkpointName) steps.push({ kind: 'checkpoint', name: b.checkpointName });
      continue;
    } else {
      steps.push({ kind: 'forward', mm: legMm, offsetMm: offsetMm, reverse: effectiveBackward });
    }

    prevHeading = heading;
    if (b.isCheckpoint && b.checkpointName) steps.push({ kind: 'checkpoint', name: b.checkpointName });
  }

  // Extra turns on the last node (appended after the final move)
  var lastNode = pathNodes[pathNodes.length - 1];
  var lastExtras = lastNode.extraTurns || [];
  for (var eti2 = 0; eti2 < lastExtras.length; eti2++) {
    var etDeg2 = Number(lastExtras[eti2]);
    if (isFinite(etDeg2) && Math.abs(etDeg2) > 0.01) {
      steps.push({ kind: 'turn', deg: etDeg2, extra: true });
    }
  }

  return steps;
};

RP.generateCode = function(route) {
  if (!route || !route.nodes || route.nodes.length < 2 || !RP.calibration) return '';

  RP.ensureCodeConfig();
  var pathNodes = RP.computeLongestPath(route);

  var cp = RP.codeConfig.commentPrefix;
  var speed = RP.codeConfig.defaultSpeed;
  var unit = RP.codeConfig.defaultUnit || 'mm';
  var uFactor = RP.unitFactor(unit);
  var steps = RP.computeSteps(route);
  var lines_out = [];

  lines_out.push(cp + ' Route: ' + route.name);
  if (pathNodes && pathNodes.length >= 2) {
    lines_out.push(cp + ' Path: ' + pathNodes.length + ' nodes, ' + (pathNodes.length - 1) + ' segments');
  }

  var totalMm = 0;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].kind === 'forward' || steps[i].kind === 'linetrace') totalMm += steps[i].mm;
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
        .replace(/\{speed\}/g, speed)
        .replace(/\{distance\}/g, '0'));
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
      lines_out.push('');
      lines_out.push(cp + ' ' + '─'.repeat(20) + ' CHECKPOINT: ' + (st.name || '?') + ' ' + '─'.repeat(20));
      lines_out.push('');
    } else if (st.kind === 'wall_align') {
      lines_out.push((RP.codeConfig.wallAlignTemplate || 'wall_align({reversed}, {speed})')
        .replace(/\{reversed\}/g, st.reverse ? 'True' : 'False')
        .replace(/\{speed\}/g, speed));
    } else if (st.kind === 'linetrace') {
      lines_out.push(RP.codeConfig.lineTraceDistTemplate
        .replace(/\{distance\}/g, ((st.mm + (st.offsetMm || 0)) / uFactor).toFixed(1))
        .replace(/\{speed\}/g, speed)
        .replace(/\{angle\}/g, '0'));
    } else if (st.kind === 'linetrace_junct') {
      lines_out.push(RP.codeConfig.lineTraceJunctTemplate
        .replace(/\{junctions\}/g, st.junctions)
        .replace(/\{speed\}/g, speed));
    } else {
      // forward
      var mag = (st.mm + (st.offsetMm || 0)) / uFactor;
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
  if (!active || !active.nodes || active.nodes.length < 2 || !RP.calibration) {
    RP.dom.codeOutput.textContent = '// Need a route with >=2 nodes';
    return;
  }
  var path = RP.computeLongestPath(active);
  if (!path || path.length < 2) {
    RP.dom.codeOutput.textContent = '// Need at least one segment in route';
    return;
  }
  try {
    RP.dom.codeOutput.textContent = RP.generateCode(active);
  } catch (e) {
    console.error('generateCode failed:', e);
    RP.dom.codeOutput.textContent = '// Error generating code - check console.';
  }
};
