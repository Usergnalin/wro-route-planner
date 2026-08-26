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

// Per-style turn templates. `spin` is the plain turnTemplate every project
// already has; the pivots are opt-in and fall back to it when left blank,
// so adding styles cannot change existing output.
RP.TURN_STYLE_TEMPLATE_KEYS = {
  spin: 'turnTemplate',
  pivot_left: 'turnPivotLeftTemplate',
  pivot_right: 'turnPivotRightTemplate'
};

RP.turnTemplateFor = function(style) {
  var key = RP.TURN_STYLE_TEMPLATE_KEYS[style || RP.DEFAULT_TURN_STYLE];
  if (!key || !RP.codeConfig) return null;
  var tmpl = RP.codeConfig[key];
  return (tmpl && String(tmpl).trim()) ? tmpl : null;
};

// Which codeConfig field holds this step kind's own default speed —
// derived from RP.CODE_CONFIG_FIELDS (core.js) so a new per-kind speed
// field only has to be added in one place. Blank (null) is the common
// case — most projects don't bother overriding most kinds — so this only
// ever narrows the fallback chain, never widens it.
RP.STEP_KIND_SPEED_KEYS = {};
RP.CODE_CONFIG_FIELDS.forEach(function(f) {
  if (f.stepKind) RP.STEP_KIND_SPEED_KEYS[f.stepKind] = f.key;
});

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
      if (Math.abs(turnInit) > 0.5) {
        steps.push({ kind: 'turn', deg: turnInit, startLeg: true,
                     actionId: firstTurn ? firstTurn.id : null,
                     speed: firstTurn ? firstTurn.speed : null,
                     style: firstTurn ? firstTurn.style : RP.DEFAULT_TURN_STYLE,
                     extraArgs: firstTurn ? firstTurn.extraArgs : '' });
      }
      steps.push({ kind: 'forward', mm: mmFromStart, startLeg: true,
                   actionId: el0.id, reverse: backward0, speed: el0.speed,
                   extraArgs: el0.extraArgs });
      prevHeading = legHeading;
    } else {
      prevHeading = RP.robotConfig.startHeading;
    }
  }

  for (var i = 0; i < items.length; i++) {
    var it = items[i];

    if (it.kind === 'checkpoint') {
      steps.push({ kind: 'checkpoint', actionId: it.action.id, name: it.action.name || 'checkpoint',
                   extraArgs: it.action.extraArgs });
      continue;
    }

    if (it.kind === 'turn') {
      var t = it.action;
      // A typed angle wins over the geometry, whether it was inserted
      // standalone or typed over a junction turn. The chassis ends up
      // wherever that angle puts it, which is the point of overriding.
      if (t.angle != null && isFinite(Number(t.angle))) {
        var typedDeg = Number(t.angle);
        if (Math.abs(typedDeg) > 0.01) {
          steps.push({ kind: 'turn', deg: typedDeg, extra: t.angleMode === RP.TURN_FIXED,
                       actionId: t.id, speed: t.speed, style: t.style, extraArgs: t.extraArgs });
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
      if (Math.abs(deg) > 0.5) {
        steps.push({ kind: 'turn', deg: deg, actionId: t.id, speed: t.speed, style: t.style, extraArgs: t.extraArgs });
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
    } else if (it.arc) {
      var dCw = it.arc.sweepDeg;                 // chassis turn, clockwise-positive
      var Rmm = it.arc.radiusPx / ppm;
      var nose = it.arc.noseFirst;
      steps.push({
        kind: 'arc',
        angle: nose ? Math.abs(dCw) : -Math.abs(dCw),
        radiusMm: (nose ? 1 : -1) * (dCw >= 0 ? 1 : -1) * Rmm,
        mm: Rmm * Math.abs(dCw) * Math.PI / 180,
        speed: el.speed
      });
    } else {
      var legMm = RP.dist(it.a.x, it.a.y, it.b.x, it.b.y) / ppm;
      var offsetMm = el.offset || 0;
      if (mode === RP.MOVE_LINETRACE_DIST) {
        steps.push({ kind: 'linetrace', mm: legMm, offsetMm: offsetMm, reverse: backward, speed: el.speed });
      } else if (mode === RP.MOVE_LINETRACE_JUNCT) {
        steps.push({ kind: 'linetrace_junct', junctions: el.junctions || 1, reverse: backward, speed: el.speed });
      } else if (mode === RP.MOVE_WALL_ALIGN) {
        // The solver already knows this leg's length (it pinned the exit
        // point to stand `clearance` off the wall) — hand it out as
        // expected_distance so a real robot can slow down on approach
        // instead of driving blind at wall_align speed the whole leg.
        steps.push({ kind: 'wall_align', reverse: backward, speed: el.speed, expectedDistanceMm: legMm });
      } else {
        steps.push({ kind: 'forward', mm: legMm, offsetMm: offsetMm, reverse: backward, speed: el.speed });
      }
    }

    for (var b = before; b < steps.length; b++) { steps[b].actionId = el.id; steps[b].extraArgs = el.extraArgs; }
    prevHeading = it.exitHeading;
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
  var moveCount = resolved.moves.length;

  var speed = RP.codeConfig.defaultSpeed;
  var unit = RP.codeConfig.defaultUnit || 'mm';
  var uFactor = RP.unitFactor(unit);
  var steps = RP.computeSteps(route);
  var lines_out = [];
  // An action's own typed speed always wins. Otherwise, this kind's own
  // default (if the project bothered to set one) beats the plain global
  // default — a wall approach and a straight-line drive rarely want the
  // same number, but most kinds are happy sharing one.
  function spd(st) {
    if (st.speed != null && st.speed !== '') return st.speed;
    var key = RP.STEP_KIND_SPEED_KEYS[st.kind];
    var perKind = key ? RP.codeConfig[key] : null;
    return (perKind != null && perKind !== '') ? perKind : speed;
  }
  // Raw, unescaped: the whole point is that the user typed exactly what
  // they want spliced into their own template, comma and all.
  function extra(st) { return st.extraArgs || ''; }

  lines_out.push(cp + ' Route: ' + route.name);
  lines_out.push(cp + ' Path: ' + (moveCount + 1) + ' nodes, ' + moveCount + ' segments');

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
      // A spin and a one-wheel pivot are different manoeuvres, so each
      // style can have its own template. Blank means "same as a spin",
      // which is what every project that predates turn styles wants.
      var styleTmpl = RP.turnTemplateFor ? RP.turnTemplateFor(st.style) : null;
      var turnTmpl = styleTmpl || RP.codeConfig.turnTemplate || 'turn({angle}, {speed})';
      lines_out.push(turnTmpl
        .replace(/\{angle\}/g, st.deg.toFixed(1))
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{radius\}/g, '0')
        .replace(/\{distance\}/g, '0')
        .replace(/\{extra_args\}/g, extra(st)));
    } else if (st.kind === 'arc') {
      var arcTmpl = RP.codeConfig.turnArcTemplate || 'robot.turn_arc(angle={angle}, speed={speed}, radius={radius})';
      lines_out.push(arcTmpl
        .replace(/\{angle\}/g, st.angle.toFixed(1))
        .replace(/\{radius\}/g, (st.radiusMm / uFactor).toFixed(1))
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{distance\}/g, ((st.mm) / uFactor).toFixed(1))
        .replace(/\{extra_args\}/g, extra(st)));
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
      var cpTmpl = RP.codeConfig.checkpointTemplate || 'if callable({name}): {name}({extra_args})';
      lines_out.push(cpTmpl
        .replace(/\{name\}/g, st.name || 'checkpoint')
        .replace(/\{extra_args\}/g, extra(st)));
    } else if (st.kind === 'wall_align') {
      lines_out.push((RP.codeConfig.wallAlignTemplate || 'wall_align({reversed}, {speed}, {expected_distance})')
        .replace(/\{reversed\}/g, st.reverse ? 'True' : 'False')
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{expected_distance\}/g, ((st.expectedDistanceMm || 0) / uFactor).toFixed(1))
        .replace(/\{extra_args\}/g, extra(st)));
    } else if (st.kind === 'linetrace') {
      lines_out.push(RP.codeConfig.lineTraceDistTemplate
        .replace(/\{distance\}/g, ((st.mm + (st.offsetMm || 0)) / uFactor).toFixed(1))
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{angle\}/g, '0')
        .replace(/\{extra_args\}/g, extra(st)));
    } else if (st.kind === 'linetrace_junct') {
      lines_out.push(RP.codeConfig.lineTraceJunctTemplate
        .replace(/\{junctions\}/g, st.junctions)
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{extra_args\}/g, extra(st)));
    } else {
      // forward
      var mag = (st.mm + (st.offsetMm || 0)) / uFactor;
      var distOut = (st.reverse ? -mag : mag).toFixed(1);
      lines_out.push(RP.codeConfig.forwardTemplate
        .replace(/\{distance\}/g, distOut)
        .replace(/\{speed\}/g, spd(st))
        .replace(/\{angle\}/g, '0')
        .replace(/\{extra_args\}/g, extra(st)));
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
