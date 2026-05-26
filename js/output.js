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
//   { kind: 'turn',    deg: <abs>,    dirRight: <bool> }
//   { kind: 'forward', mm:  <number>, reverse: <bool> }
//   { kind: 'teleport', fromX, fromY, toX, toY, heading }
//
// Direction model:
//   For a segment a->b with direction 'forward', the robot's chassis
//   faces along (a->b) while driving. After the segment, heading is
//   atan2(b.y-a.y, b.x-a.x).
//   For 'backward', the chassis faces along (b->a) - opposite of
//   travel - while driving in reverse from a to b. After the segment,
//   heading is atan2(a.y-b.y, a.x-b.x) (which is the forward angle + 180).
//
// Turns are always computed as the SHORTEST signed angle from the
// previous chassis heading to the next segment's required chassis
// heading. Distance is reported as a positive magnitude in `mm`; the
// `reverse` flag tells downstream consumers how to render / sign it.
//
// The robot's starting pose (RP.robotConfig.startPos / startHeading) is
// included as a virtual prefix when present. The virtual leg from
// startPos to wp[0] inherits the direction of the FIRST route segment
// (so a backward first segment implies driving backward from the start
// position to wp[0] as well - this is the most physically natural
// interpretation: the robot starts where you placed it, facing
// startHeading, and just drives along the route).
RP.computeSteps = function(route) {
  if (!route || route.waypoints.length < 2 || !RP.calibration) return [];

  RP.ensureSegmentDirections(route);

  var ppm = RP.calibration.pixelsPerMm;
  var wps = route.waypoints;
  var dirs = route.segmentDirections;
  var steps = [];

  // Helper: chassis heading required to traverse segment (a -> b) in
  // the given direction.
  function chassisHeading(a, b, dir) {
    if (dir === RP.SEG_BACKWARD) {
      return RP.toDeg(RP.angleRad(b.x, b.y, a.x, a.y));
    }
    return RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
  }

  var prevHeading = null; // last chassis heading the robot is facing

  // Virtual leg from startPos / startHeading.
  if (RP.robotConfig.startPos) {
    var sp = RP.robotConfig.startPos;
    var firstDir = dirs[0] || RP.SEG_FORWARD;
    var pxFromStart = RP.dist(sp.x, sp.y, wps[0].x, wps[0].y);
    var mmFromStart = pxFromStart / ppm;
    if (mmFromStart > 0.5) {
      // Real leg from startPos -> wp[0] inheriting first-segment direction.
      var headingStartLeg = chassisHeading(sp, wps[0], firstDir);
      var turnInit = RP.turnAngle(RP.robotConfig.startHeading, headingStartLeg);
      if (Math.abs(turnInit) > 0.5) {
        steps.push({ kind: 'turn', deg: Math.abs(turnInit), dirRight: turnInit > 0 });
      }
      steps.push({ kind: 'forward', mm: mmFromStart, reverse: firstDir === RP.SEG_BACKWARD });
      prevHeading = headingStartLeg;
    } else {
      // wp[0] coincides with startPos. Heading prefix only.
      prevHeading = RP.robotConfig.startHeading;
    }
  }

  for (var i = 0; i < wps.length - 1; i++) {
    var a = wps[i], b = wps[i + 1];
    var dir = dirs[i] || RP.SEG_FORWARD;

    if (dir === RP.SEG_TELEPORT) {
      // Teleport: omit turn before, emit comment placeholder, set
      // prevHeading=null so the turn after is also omitted.
      var heading = RP.toDeg(RP.angleRad(a.x, a.y, b.x, b.y));
      steps.push({
        kind: 'teleport',
        fromX: a.x, fromY: a.y,
        toX: b.x, toY: b.y,
        heading: heading
      });
      prevHeading = null;
      continue;
    }

    var heading = chassisHeading(a, b, dir);
    if (prevHeading !== null) {
      var turn = RP.turnAngle(prevHeading, heading);
      if (Math.abs(turn) > 0.5) {
        steps.push({ kind: 'turn', deg: Math.abs(turn), dirRight: turn > 0 });
      }
    }
    var legMm = RP.dist(a.x, a.y, b.x, b.y) / ppm;
    steps.push({ kind: 'forward', mm: legMm, reverse: dir === RP.SEG_BACKWARD });
    prevHeading = heading;
  }

  return steps;
};

RP.generateCode = function(route) {
  if (!route || route.waypoints.length < 2 || !RP.calibration) return '';

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
  }
  lines_out.push(cp + ' Total distance: ' + (totalMm / uFactor).toFixed(1) + ' ' + unit);

  if (RP.robotConfig.startPos) {
    lines_out.push(cp + ' Start at (' + RP.robotConfig.startPos.x.toFixed(1) + ', ' +
      RP.robotConfig.startPos.y.toFixed(1) + ') heading ' +
      Math.round(RP.robotConfig.startHeading) + '\u00b0');
  }

  lines_out.push(cp + ' ' + '\u2500'.repeat(37));

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
      var unit2 = RP.codeConfig.defaultUnit || 'mm';
      var uf2 = RP.unitFactor(unit2);
      var dx2 = (st.toX - st.fromX);
      var dy2 = (st.toY - st.fromY);
      var distPx2 = RP.dist ? RP.dist(st.fromX, st.fromY, st.toX, st.toY) : Math.hypot(dx2, dy2);
      var distMm2 = 0;
      if (RP.calibration) distMm2 = distPx2 / RP.calibration.pixelsPerMm;
      var hdg = Math.round(st.heading || 0);
      lines_out.push('');
      lines_out.push(cp + ' === TELEPORT ===');
      lines_out.push(cp + ' From: (' + st.fromX.toFixed(1) + ', ' + st.fromY.toFixed(1) + ')');
      lines_out.push(cp + ' To:   (' + st.toX.toFixed(1) + ', ' + st.toY.toFixed(1) + ')');
      lines_out.push(cp + ' Distance: ' + (distMm2 / uf2).toFixed(1) + ' ' + unit2 + '   Heading: ' + hdg + '\u00b0');
      lines_out.push(cp + ' (insert your custom arc/maneuver code here)');
      lines_out.push(cp + ' ================');
      lines_out.push('');
    } else {
      // Backward legs are signalled by a negative {distance} so the
      // same forward template is reused (e.g. move(-300, 200)).
      var mag = (st.mm / uFactor);
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
  if (!RP.instructionsVisible) {
    RP.dom.instrList.innerHTML = '';
    RP.dom.instrTotal.textContent = '';
    RP.dom.codeOutput.textContent = '';
    return;
  }

  var active = RP.getActiveRoute();
  if (!active || active.waypoints.length < 2 || !RP.calibration) {
    RP.dom.instrList.innerHTML = '<li style="color:#666">Need route with \u22652 waypoints and calibration</li>';
    RP.dom.instrTotal.textContent = '';
    RP.dom.codeOutput.textContent = '';
    return;
  }

  var unit = RP.codeConfig.defaultUnit || 'mm';
  var uFactor = RP.unitFactor(unit);

  var steps = RP.computeSteps(active);
  var totalMm = 0;
  var html = '';
  for (var i = 0; i < steps.length; i++) {
    var st = steps[i];
    if (st.kind === 'turn') {
      var dir = st.dirRight ? 'right' : 'left';
      html += '<li class="turn">' + (i + 1) + '. Turn ' + dir + ' ' + st.deg.toFixed(1) + '\u00b0</li>';
    } else if (st.kind === 'teleport') {
      html += '<li class="teleport">' + (i + 1) + '. ' +
        '\u2708 Teleport from (' + st.fromX.toFixed(0) + ',' + st.fromY.toFixed(0) + ') to (' +
        st.toX.toFixed(0) + ',' + st.toY.toFixed(0) + ') — ' +
        '<em>insert manual arc/custom logic here</em></li>';
    } else {
      totalMm += st.mm;
      var verb = st.reverse ? 'Reverse' : 'Forward';
      var cls = st.reverse ? 'forward reverse' : 'forward';
      html += '<li class="' + cls + '">' + (i + 1) + '. ' + verb + ' ' + (st.mm / uFactor).toFixed(1) + ' ' + unit + '</li>';
    }
  }
  RP.dom.instrList.innerHTML = html;

  var totalInUnit = totalMm / uFactor;
  var totalMeters = totalMm / 1000;
  RP.dom.instrTotal.textContent = 'Total distance: ' + totalInUnit.toFixed(1) + ' ' + unit +
    ' (' + totalMeters.toFixed(2) + ' m)';
  RP.dom.codeOutput.textContent = RP.generateCode(active);
};
