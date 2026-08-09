/* ========================================================================
   sketch-ui.js - Constraint UI: selection, palette, badges, DOF readout.

   The solver is invisible to the user; this layer is what they actually
   judge. Modelled on FreeCAD's sketcher: select geometry, apply a
   constraint, watch the DOF counter fall to zero.

   Constraint VALUES are stored in sketch units (pixels / radians) but are
   always shown and entered in mm / degrees.
   ======================================================================== */
var RP = window.RP || {};

// Ordered so that two-line constraints (angle A->B) respect click order.
RP.sketchSelection = [];

RP.SKETCH_STATUS = {
  empty:     { color: '#44ff44', text: 'Empty' },
  under:     { color: '#44ff44', text: 'Under-constrained' },
  full:      { color: '#66ccff', text: 'Fully constrained' },
  redundant: { color: '#ffaa44', text: 'Redundant constraints' },
  conflict:  { color: '#ff4444', text: 'Conflicting constraints' }
};

RP.sketchStatusInfo = function() {
  var sk = RP.sketch;
  var st = (sk && sk.status) || 'empty';
  var info = RP.SKETCH_STATUS[st] || RP.SKETCH_STATUS.empty;
  var text = info.text;
  if (st === 'under' && sk) text += ' (' + sk.dof + ' DOF)';
  return { status: st, color: info.color, text: text };
};

RP.sketchStatusColor = function() {
  return RP.sketchStatusInfo().color;
};

// ---- selection -------------------------------------------------------
RP.clearSketchSelection = function() {
  RP.sketchSelection = [];
};

RP.isSketchSelected = function(id) {
  return RP.sketchSelection.indexOf(id) >= 0;
};

RP.toggleSketchSelection = function(id, additive) {
  var at = RP.sketchSelection.indexOf(id);
  if (!additive) {
    RP.sketchSelection = (at >= 0 && RP.sketchSelection.length === 1) ? [] : [id];
    return;
  }
  if (at >= 0) RP.sketchSelection.splice(at, 1);
  else RP.sketchSelection.push(id);
};

// Distinct points belonging to visible geometry. Arc centres are included
// because dragging the centre is how an arc is reshaped.
RP.sketchPoints = function() {
  var out = [], seen = {};
  function add(id, x, y) {
    if (seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, x: x, y: y });
  }
  for (var i = 0; i < RP.lines.length; i++) {
    var l = RP.lines[i];
    if (l.visible === false) continue;
    add(l.p1, l.x1, l.y1);
    add(l.p2, l.x2, l.y2);
  }
  for (var j = 0; j < RP.arcs.length; j++) {
    var arc = RP.arcs[j];
    if (arc.visible === false) continue;
    add(arc.p1, arc.x1, arc.y1);
    add(arc.p2, arc.x2, arc.y2);
    add(arc.center, arc.cx, arc.cy);
  }
  for (var k = 0; k < RP.points.length; k++) {
    var sp = RP.points[k];
    if (sp.visible === false) continue;
    add(sp.id, sp.x, sp.y);
  }
  return out;
};

// Distance test against an arc, using its render polyline so it reuses the
// same point-to-segment maths as lines. Takes an ENTITY ID so both the
// sketch-mode and route-mode hit tests can share it.
RP.arcHitDistSq = function(arcEntityId, ix, iy) {
  var ent = RP.sketch && RP.sketch.entities[arcEntityId];
  if (!ent || ent.type !== 'arc') return Infinity;
  var pts = RP.Sketch.arcPoints(RP.sketch, ent, 24);
  if (pts.length < 2) return Infinity;
  var best = Infinity;
  for (var i = 0; i < pts.length - 1; i++) {
    var d = RP.pointToSegDistSq(ix, iy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < best) best = d;
  }
  return best;
};

// Distance from a point to whatever geometry an element references —
// straight for lines, along the curve for arcs.
RP.entityDistSq = function(sk, entityId, ix, iy) {
  var ent = sk && sk.entities[entityId];
  if (!ent) return Infinity;
  if (ent.type === 'arc') return RP.arcHitDistSq(entityId, ix, iy);
  var a = sk.entities[ent.p1], b = sk.entities[ent.p2];
  if (!a || !b) return Infinity;
  return RP.pointToSegDistSq(ix, iy, a.x, a.y, b.x, b.y);
};

// Points take priority over lines — they are the smaller target.
RP.sketchHitTest = function(ix, iy) {
  var pts = RP.sketchPoints();
  var best = null, bestD = Infinity;
  for (var i = 0; i < pts.length; i++) {
    var d = RP.screenDist(ix, iy, pts[i].x, pts[i].y);
    if (d < 12 && d < bestD) { bestD = d; best = { kind: 'point', id: pts[i].id }; }
  }
  if (best) return best;

  var threshSq = Math.pow(RP.snapThresholdImg(8), 2);
  var bestLine = null, bestLineD = Infinity;
  for (var j = 0; j < RP.lines.length; j++) {
    var l = RP.lines[j];
    if (l.visible === false) continue;
    var dSq = RP.pointToSegDistSq(ix, iy, l.x1, l.y1, l.x2, l.y2);
    if (dSq < threshSq && dSq < bestLineD) {
      bestLineD = dSq;
      bestLine = { kind: 'line', id: l.id };
    }
  }
  for (var k = 0; k < RP.arcs.length; k++) {
    var arc = RP.arcs[k];
    if (arc.visible === false) continue;
    var aSq = RP.arcHitDistSq(arc.id, ix, iy);
    if (aSq < threshSq && aSq < bestLineD) {
      bestLineD = aSq;
      bestLine = { kind: 'arc', id: arc.id };
    }
  }
  return bestLine;
};

// ---- constraint application -----------------------------------------
// Maps the current selection onto the ordered refs a constraint expects,
// or null when the selection does not fit.
RP.constraintRefsFor = function(type) {
  var sk = RP.sketch;
  if (!sk) return null;
  var pts = [], lns = [], arcs = [];
  for (var i = 0; i < RP.sketchSelection.length; i++) {
    var e = sk.entities[RP.sketchSelection[i]];
    if (!e) continue;
    if (e.type === 'point') pts.push(e.id);
    else if (e.type === 'line') lns.push(e.id);
    else if (e.type === 'arc') arcs.push(e.id);
  }
  switch (type) {
    case 'point_on_arc':
      return (pts.length === 1 && arcs.length === 1) ? [pts[0], arcs[0]] : null;
    case 'radius':
      return (arcs.length === 1 && pts.length === 0 && lns.length === 0) ? arcs : null;
    case 'tangent':
      return (lns.length === 1 && arcs.length === 1 && pts.length === 0)
        ? [lns[0], arcs[0]] : null;
  }
  if (arcs.length) return null;   // the remaining types do not accept arcs
  switch (type) {
    case 'coincident':
      return (pts.length === 2 && lns.length === 0) ? pts : null;
    case 'point_on_line':
    case 'point_line_distance':
      return (pts.length === 1 && lns.length === 1) ? [pts[0], lns[0]] : null;
    case 'horizontal':
    case 'vertical':
      return (lns.length === 1 && pts.length === 0) ? lns : null;
    case 'fix':
      return (pts.length === 1 && lns.length === 0) ? pts : null;
    case 'distance':
      if (lns.length === 1 && pts.length === 0) return lns;
      if (pts.length === 2 && lns.length === 0) return pts;
      return null;
    case 'angle':
      if (lns.length >= 1 && lns.length <= 2 && pts.length === 0) return lns;
      return null;
  }
  return null;
};

RP.canApplyConstraint = function(type) {
  return RP.constraintRefsFor(type) !== null;
};

// Current geometric value, used to pre-fill the dimension prompt.
RP.measureConstraint = function(type, refs) {
  var sk = RP.sketch;
  var a, b;
  if (type === 'point_line_distance') {
    var d = RP.Sketch.perpDistance(sk, refs[0], refs[1]);
    return d === null ? 0 : d;
  }
  if (type === 'radius') {
    var ag = RP.Sketch.arcGeometry(sk, sk.entities[refs[0]]);
    return ag ? ag.radius : 0;
  }
  if (type === 'distance') {
    if (refs.length === 1) {
      var l = sk.entities[refs[0]];
      a = sk.entities[l.p1]; b = sk.entities[l.p2];
    } else {
      a = sk.entities[refs[0]]; b = sk.entities[refs[1]];
    }
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (type === 'angle') {
    var la = sk.entities[refs[0]];
    var ux = sk.entities[la.p2].x - sk.entities[la.p1].x;
    var uy = sk.entities[la.p2].y - sk.entities[la.p1].y;
    if (refs.length === 1) return Math.atan2(uy, ux);
    var lb = sk.entities[refs[1]];
    var vx = sk.entities[lb.p2].x - sk.entities[lb.p1].x;
    var vy = sk.entities[lb.p2].y - sk.entities[lb.p1].y;
    return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  }
  return 0;
};

// px <-> mm, radians <-> degrees
function isLengthConstraint(type) {
  return type === 'distance' || type === 'point_line_distance' || type === 'radius';
}
RP.constraintToDisplay = function(type, v) {
  if (isLengthConstraint(type)) return RP.calibration ? v / RP.calibration.pixelsPerMm : v;
  if (type === 'angle') return v * 180 / Math.PI;
  return v;
};
RP.constraintFromDisplay = function(type, v) {
  if (isLengthConstraint(type)) return RP.calibration ? v * RP.calibration.pixelsPerMm : v;
  if (type === 'angle') return v * Math.PI / 180;
  return v;
};
RP.constraintUnit = function(type) {
  if (isLengthConstraint(type)) return 'mm';
  if (type === 'angle') return '°';
  return '';
};

RP.formatConstraintValue = function(c) {
  var def = RP.Sketch.constraintDefs[c.type];
  if (!def || !def.hasValue) return '';
  return RP.constraintToDisplay(c.type, c.value).toFixed(1) + RP.constraintUnit(c.type);
};

// displayValue omitted -> measure the current geometry.
// A user-added constraint that conflicts is KEPT (and shown red) so the
// conflict is visible and fixable; only auto-constraints roll back.
// The arc endpoint that already sits on one of the line's ends, or null.
// Two entities joined at a point can use the endpoint form of tangency,
// which is far better behaved than the centre-offset form.
RP.sharedTangentPoint = function(lineId, arcId) {
  var sk = RP.sketch;
  var line = sk.entities[lineId], arc = sk.entities[arcId];
  if (!line || !arc) return null;
  var find = RP.Sketch.coincidenceClusters(sk);
  var ends = [line.p1, line.p2].map(find);
  if (ends.indexOf(find(arc.p1)) >= 0) return arc.p1;
  if (ends.indexOf(find(arc.p2)) >= 0) return arc.p2;
  return null;
};

RP.applyConstraint = function(type, displayValue) {
  var refs = RP.constraintRefsFor(type);
  if (!refs) return { ok: false, message: 'Selection does not fit "' + type + '"' };

  // Upgrade a plain tangent to endpoint tangency when the two already
  // meet. Same intent, but it drops the captured side that otherwise
  // stops the arc ever flipping — see the constraint's own comment.
  if (type === 'tangent') {
    var atPt = RP.sharedTangentPoint(refs[0], refs[1]);
    if (atPt != null) { type = 'tangent_at'; refs = [refs[0], refs[1], atPt]; }
  }
  var def = RP.Sketch.constraintDefs[type];
  var value;
  if (def.hasValue) {
    value = (displayValue === undefined || displayValue === null || displayValue === '')
      ? RP.measureConstraint(type, refs)
      : RP.constraintFromDisplay(type, Number(displayValue));
    if (!isFinite(value)) return { ok: false, message: 'Value must be a number' };
  }

  RP.pushHistory('Add ' + type);
  var c;
  try {
    c = RP.Sketch.addConstraint(RP.sketch, type, refs, value);
  } catch (err) {
    RP.undoStack.pop();
    return { ok: false, message: err.message };
  }
  var res = RP.solveSketch();
  RP.clearSketchSelection();
  RP.refreshSketchUI();
  return { ok: true, constraint: c, result: res };
};

RP.deleteConstraint = function(id) {
  if (!RP.sketch || !RP.sketch.constraints[id]) return false;
  RP.pushHistory('Delete constraint');
  RP.Sketch.removeConstraint(RP.sketch, id);
  RP.solveSketch();
  RP.refreshSketchUI();
  return true;
};

RP.setConstraintValue = function(id, displayValue) {
  var c = RP.sketch && RP.sketch.constraints[id];
  if (!c) return false;
  var v = RP.constraintFromDisplay(c.type, Number(displayValue));
  if (!isFinite(v)) return false;
  RP.pushHistory('Edit constraint');
  c.value = v;
  RP.solveSketch();
  RP.refreshSketchUI();
  return true;
};

RP.refreshSketchUI = function() {
  if (RP.updateConstraintPanel) RP.updateConstraintPanel();
  if (RP.updateConstraintDetail) RP.updateConstraintDetail();
  if (RP.updateGeometryDetail) RP.updateGeometryDetail();
  if (RP.updateInfoPanel) RP.updateInfoPanel();
  if (RP.updateLayerList) RP.updateLayerList();
  if (RP.render) RP.render();
};

// ======================================================================
// ENTITY ANNOTATIONS
//
// One place decides everything drawn ABOUT an entity: its length text and
// its constraint badges. They used to be rendered by two unrelated bits
// of code at the same anchor and overlapped each other.
//
// A driving distance constraint does not get its own badge — it BOLDS the
// length text that is already there, which is both less clutter and a
// truer statement (the number is now driven rather than measured).
// ======================================================================
RP.selectedConstraintId = null;

RP.buildAnnotations = function() {
  var sk = RP.sketch;
  var ann = {};
  function ensure(id) {
    if (!ann[id]) ann[id] = { label: null, bold: false, driverId: null, badges: [] };
    return ann[id];
  }

  for (var i = 0; i < RP.lines.length; i++) {
    var l = RP.lines[i];
    if (l.visible === false) continue;
    if (l.label) ensure(l.id).label = l.label;
  }
  for (var j = 0; j < RP.arcs.length; j++) {
    var arc = RP.arcs[j];
    if (arc.visible === false) continue;
    if (arc.label) ensure(arc.id).label = arc.label;
  }

  var cids = RP.Sketch.constraintIds(sk);
  for (var k = 0; k < cids.length; k++) {
    var c = sk.constraints[cids[k]];
    if (!RP.Sketch.constraintDefs[c.type]) continue;
    // A driving dimension bolds the readout that is already there rather
    // than adding a second overlapping one: distance drives a line's
    // length, radius drives an arc's radius.
    if (c.type === 'distance' && c.refs.length === 1 && ann[c.refs[0]]) {
      var a = ensure(c.refs[0]);
      a.bold = true;
      a.driverId = c.id;
      continue;
    }
    if (c.type === 'radius' && ann[c.refs[0]]) {
      var ar = ensure(c.refs[0]);
      ar.bold = true;
      ar.driverId = c.id;
      continue;
    }
    ensure(c.refs[0]).badges.push({ id: c.id, type: c.type, value: c.value });
  }
  return ann;
};

// Canvas icons. Horizontal/vertical are drawn as short bars, matching the
// way CAD sketchers show them, rather than the letters H and V.
RP.drawConstraintIcon = function(ctx, type, x, y, size, color) {
  var h = size / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size * 0.22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (type) {
    case 'horizontal':
      ctx.moveTo(x - h, y); ctx.lineTo(x + h, y); ctx.stroke();
      break;
    case 'vertical':
      ctx.moveTo(x, y - h); ctx.lineTo(x, y + h); ctx.stroke();
      break;
    case 'coincident':
      ctx.arc(x, y, h * 0.55, 0, Math.PI * 2); ctx.fill();
      break;
    case 'fix':
      ctx.strokeRect(x - h * 0.6, y - h * 0.6, h * 1.2, h * 1.2);
      break;
    case 'point_on_line':
      ctx.moveTo(x - h, y + h * 0.5); ctx.lineTo(x + h, y + h * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - h * 0.3, h * 0.4, 0, Math.PI * 2); ctx.fill();
      break;
    case 'point_line_distance':
      ctx.moveTo(x - h, y + h); ctx.lineTo(x + h, y + h);
      ctx.moveTo(x, y + h); ctx.lineTo(x, y - h * 0.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - h * 0.6, h * 0.35, 0, Math.PI * 2); ctx.fill();
      break;
    case 'angle':
      ctx.moveTo(x - h, y + h); ctx.lineTo(x + h, y + h);
      ctx.moveTo(x - h, y + h); ctx.lineTo(x + h * 0.6, y - h); ctx.stroke();
      break;
    case 'tangent':
    case 'tangent_at':
      // A circle resting on a line, which is what tangency looks like.
      ctx.moveTo(x - h, y + h * 0.75); ctx.lineTo(x + h, y + h * 0.75); ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - h * 0.05, h * 0.72, 0, Math.PI * 2); ctx.stroke();
      break;
    default:
      ctx.restore();
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = 'bold ' + size + 'px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y);
      break;
  }
  ctx.restore();
};

RP.badgeHitTest = function(ix, iy) {
  var hits = RP._badgeHits || [];
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    if (RP.screenDist(ix, iy, h.x, h.y) < 11) return h.id;
  }
  return null;
};

RP.selectConstraint = function(id) {
  RP.selectedConstraintId = id;
  if (RP.updateConstraintPanel) RP.updateConstraintPanel();
  if (RP.updateConstraintDetail) RP.updateConstraintDetail();
  if (RP.render) RP.render();
};

RP.drawSketchOverlay = function(ctx) {
  RP._badgeHits = [];
  if (!RP.sketch || RP.editMode === 'route') return;
  var sk = RP.sketch;
  var s = RP.scale || 1;
  var fs = 12 / s;
  var i;

  // Point handles, so there is something to click in constrain mode.
  if (RP.activeTool === 'constrain') {
    var pts = RP.sketchPoints();
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      var selP = RP.isSketchSelected(p.id);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (selP ? 5 : 3.5) / s, 0, Math.PI * 2);
      ctx.fillStyle = selP ? '#ffee44' : '#88ddff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 1 / s;
      ctx.stroke();
    }
  }

  var ann = RP.buildAnnotations();
  var ids = Object.keys(ann);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (i = 0; i < ids.length; i++) {
    var eid = Number(ids[i]);
    var e = sk.entities[eid];
    if (!e) continue;
    var a = ann[eid];
    var ax, ay, nx, ny, tx, ty;

    if (e.type === 'line') {
      var p1 = sk.entities[e.p1], p2 = sk.entities[e.p2];
      if (!p1 || !p2) continue;
      ax = (p1.x + p2.x) / 2; ay = (p1.y + p2.y) / 2;
      var dx = p2.x - p1.x, dy = p2.y - p1.y;
      var len = Math.hypot(dx, dy) || 1;
      tx = dx / len; ty = dy / len;
      nx = -ty; ny = tx;
      if (ny > 0) { nx = -nx; ny = -ny; }   // keep annotations above the line
    } else if (e.type === 'arc') {
      var apts = RP.Sketch.arcPoints(sk, e, 16);
      if (apts.length < 2) continue;
      var mid = apts[Math.floor(apts.length / 2)];
      ax = mid.x; ay = mid.y;
      var ac = sk.entities[e.center];
      var rl = Math.hypot(ax - ac.x, ay - ac.y) || 1;
      nx = (ax - ac.x) / rl; ny = (ay - ac.y) / rl;   // outward from the centre
      tx = -ny; ty = nx;
    } else if (e.type === 'point') {
      ax = e.x; ay = e.y;
      tx = 1; ty = 0; nx = 0.7; ny = -0.7;
    } else {
      continue;
    }

    var used = 0;
    if (a.label) {
      var lx = ax + nx * (13 / s), ly = ay + ny * (13 / s);
      ctx.font = (a.bold ? 'bold ' : '') + fs + 'px -apple-system, sans-serif';
      ctx.lineWidth = 3.5 / s;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(a.label, lx, ly);
      ctx.fillStyle = a.bold ? '#ffd166' : '#9fe89f';
      ctx.fillText(a.label, lx, ly);
      if (a.driverId != null) {
        RP._badgeHits.push({ id: a.driverId, x: lx, y: ly });
        if (RP.selectedConstraintId === a.driverId) {
          ctx.beginPath();
          ctx.arc(lx, ly, 11 / s, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffee44';
          ctx.lineWidth = 1.5 / s;
          ctx.stroke();
        }
      }
      used = 1;
    }

    if (a.badges.length) {
      var size = 9 / s;
      var gap = 15 / s;
      var off = (used ? 30 : 14) / s;
      var span = (a.badges.length - 1) * gap;
      for (var b = 0; b < a.badges.length; b++) {
        var badge = a.badges[b];
        var along = (b * gap) - span / 2;
        var bx = ax + nx * off + tx * along;
        var by = ay + ny * off + ty * along;
        var isSelB = RP.selectedConstraintId === badge.id;
        if (isSelB) {
          ctx.beginPath();
          ctx.arc(bx, by, 9 / s, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,238,68,0.20)';
          ctx.fill();
          ctx.strokeStyle = '#ffee44';
          ctx.lineWidth = 1.5 / s;
          ctx.stroke();
        }
        RP.drawConstraintIcon(ctx, badge.type, bx, by, size, isSelB ? '#ffee44' : '#ffd166');
        RP._badgeHits.push({ id: badge.id, x: bx, y: by });
      }
    }
  }
  ctx.restore();
};

// ---- side panel ------------------------------------------------------
// Same icon vocabulary as the canvas: short bars for horizontal/vertical
// rather than the letters H and V.
RP.CONSTRAINT_ICON_SVG = {
  horizontal:    '<svg viewBox="0 0 16 16"><line x1="2" y1="8" x2="14" y2="8"/></svg>',
  vertical:      '<svg viewBox="0 0 16 16"><line x1="8" y1="2" x2="8" y2="14"/></svg>',
  coincident:    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.2" fill="currentColor" stroke="none"/></svg>',
  point_on_line: '<svg viewBox="0 0 16 16"><line x1="2" y1="11" x2="14" y2="11"/>' +
                 '<circle cx="8" cy="5.5" r="2.4" fill="currentColor" stroke="none"/></svg>',
  distance:      '<svg viewBox="0 0 16 16"><line x1="3" y1="8" x2="13" y2="8"/>' +
                 '<line x1="3" y1="4" x2="3" y2="12"/><line x1="13" y1="4" x2="13" y2="12"/></svg>',
  angle:         '<svg viewBox="0 0 16 16"><line x1="3" y1="13" x2="14" y2="13"/>' +
                 '<line x1="3" y1="13" x2="13" y2="4"/></svg>',
  fix:           '<svg viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7"/></svg>',
  point_line_distance:
                 '<svg viewBox="0 0 16 16"><line x1="2" y1="13" x2="14" y2="13"/>' +
                 '<line x1="8" y1="13" x2="8" y2="6"/>' +
                 '<circle cx="8" cy="4" r="2" fill="currentColor" stroke="none"/></svg>',
  point_on_arc:  '<svg viewBox="0 0 16 16"><path d="M2 12 A 7 7 0 0 1 14 12" fill="none"/>' +
                 '<circle cx="8" cy="5" r="2" fill="currentColor" stroke="none"/></svg>',
  radius:        '<svg viewBox="0 0 16 16"><path d="M2 12 A 7 7 0 0 1 14 12" fill="none"/>' +
                 '<line x1="8" y1="12" x2="13" y2="8"/></svg>',
  tangent_at:    '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="4.5"/>' +
                 '<path d="M1 14h14"/><circle cx="8" cy="14" r="1.6" fill="currentColor"/></svg>',
  tangent:       '<svg viewBox="0 0 16 16"><circle cx="8" cy="10" r="4.5"/>' +
                 '<line x1="1" y1="4" x2="15" y2="4"/></svg>'
};

RP.constraintIconHTML = function(type) {
  var svg = RP.CONSTRAINT_ICON_SVG[type];
  if (!svg) return '<span>?</span>';
  return svg.replace('<svg ', '<svg class="cicon" ');
};

RP.constraintSummary = function(c) {
  var def = RP.Sketch.constraintDefs[c.type];
  var label = (def && def.label) || c.type;
  if (def && def.hasValue) label += '  ' + RP.formatConstraintValue(c);
  return label;
};

// Right panel: actions for the selected geometry. Currently that means
// flipping an arc, which is the one thing about an arc the solver cannot
// do for you.
RP.updateGeometryDetail = function() {
  var section = document.getElementById('geometry-detail-section');
  var host = document.getElementById('geometry-detail');
  if (!section || !host) return;

  var sk = RP.sketch;
  var sel = (sk && RP.sketchSelection.length === 1) ? sk.entities[RP.sketchSelection[0]] : null;
  var show = (RP.editMode !== 'route') && sel && sel.type === 'arc';
  section.style.display = show ? '' : 'none';
  if (!show) { host.innerHTML = ''; return; }

  var g = RP.Sketch.arcGeometry(sk, sel);
  host.innerHTML =
    '<div class="elp"><span>Arc radius</span><span>' +
      (g ? RP.constructionLabel(0, 0, g.radius, 0) : '-') + '</span></div>' +
    '<button id="geo-flip-arc" class="sidebar-small-btn" style="margin-top:6px">⇄ Flip to other side</button>' +
    '<div class="sidebar-hint">Two points bound two arcs; this picks the other one. ' +
    'No amount of dragging can do it.</div>';

  var btn = document.getElementById('geo-flip-arc');
  if (btn) btn.addEventListener('click', function() {
    RP.pushHistory('Flip arc');
    RP.flipArc(sel.id);
    RP.refreshSketchUI();
  });
};

// Right panel: detail for whichever constraint is selected.
RP.updateConstraintDetail = function() {
  var section = document.getElementById('constraint-detail-section');
  var host = document.getElementById('constraint-detail');
  if (!section || !host) return;
  var sk = RP.sketch;
  var c = (sk && RP.selectedConstraintId != null) ? sk.constraints[RP.selectedConstraintId] : null;
  section.style.display = (RP.editMode === 'route') ? 'none' : '';
  if (!c) {
    host.innerHTML = '<div class="sidebar-hint">Click a constraint on the canvas or in the list</div>';
    return;
  }
  var def = RP.Sketch.constraintDefs[c.type];
  var html = '<div class="elp"><span>' + RP.constraintIconHTML(c.type) + ' ' +
             ((def && def.label) || c.type) + '</span></div>';
  if (def && def.hasValue) {
    html += '<label class="elp"><span>Value (' + RP.constraintUnit(c.type) + ')</span>' +
            '<input type="number" id="cd-value" step="0.1" value="' +
            RP.constraintToDisplay(c.type, c.value).toFixed(2) + '" ' +
            'style="width:70px;background:#3a3a3a;border:1px solid #555;color:#ddd;' +
            'padding:2px 4px;border-radius:3px;font-size:11px;text-align:right"></label>';
  }
  html += '<button id="cd-del" class="sidebar-small-btn" style="margin-top:6px">🗑 Delete constraint</button>';
  host.innerHTML = html;

  var valEl = document.getElementById('cd-value');
  if (valEl) valEl.addEventListener('change', function() {
    RP.setConstraintValue(c.id, this.value);
  });
  var delEl = document.getElementById('cd-del');
  if (delEl) delEl.addEventListener('click', function() {
    RP.deleteConstraint(c.id);
    RP.selectedConstraintId = null;
    RP.updateConstraintDetail();
  });
};

// The PALETTE (left) only makes sense with the constrain tool active; the
// LIST (bottom panel) is informational and shows for all of Sketch mode.
RP.updateConstraintPanel = function() {
  var section = document.getElementById('constraint-section');
  if (section) {
    var visible = (RP.editMode !== 'route') && RP.activeTool === 'constrain';
    section.style.display = visible ? '' : 'none';
    if (visible) {
      var info = RP.sketchStatusInfo();
      var dofEl = document.getElementById('constraint-dof');
      if (dofEl) {
        dofEl.textContent = info.text;
        dofEl.style.color = info.color;
      }
      var selEl = document.getElementById('constraint-selection');
      if (selEl) {
        var n = RP.sketchSelection.length;
        selEl.textContent = n === 0 ? 'Nothing selected' :
          (n + ' selected — shift-click to add');
      }
      var btns = document.querySelectorAll('.constraint-btn[data-constraint]');
      for (var i = 0; i < btns.length; i++) {
        var ok = RP.canApplyConstraint(btns[i].dataset.constraint);
        btns[i].disabled = !ok;
        btns[i].classList.toggle('enabled', ok);
      }
    }
  }
  RP.updateConstraintList();
};

RP.updateConstraintList = function() {
  var list = document.getElementById('constraint-list');
  if (!list) return;
  list.innerHTML = '';
  if (RP.editMode === 'route') return;
  var sk = RP.sketch;
  var cids = sk ? RP.Sketch.constraintIds(sk) : [];
  if (cids.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'sidebar-hint';
    empty.textContent = 'No constraints yet';
    list.appendChild(empty);
    return;
  }
  for (var k = 0; k < cids.length; k++) {
    (function(c) {
      var row = document.createElement('div');
      // Selecting here highlights the badge on the canvas, and vice versa.
      row.className = 'layer-item' + (RP.selectedConstraintId === c.id ? ' active' : '');

      var glyph = document.createElement('span');
      glyph.className = 'constraint-glyph';
      glyph.innerHTML = RP.constraintIconHTML(c.type);

      var lbl = document.createElement('span');
      lbl.className = 'layer-item-label';
      lbl.textContent = RP.constraintSummary(c);
      lbl.title = lbl.textContent;

      var del = document.createElement('button');
      del.className = 'layer-del-btn';
      del.textContent = '✕';
      del.title = 'Delete constraint';
      del.onclick = function(e) {
        e.stopPropagation();
        if (RP.selectedConstraintId === c.id) RP.selectedConstraintId = null;
        RP.deleteConstraint(c.id);
        RP.updateConstraintDetail();
      };

      row.onclick = function() {
        RP.selectConstraint(RP.selectedConstraintId === c.id ? null : c.id);
      };

      row.appendChild(glyph);
      row.appendChild(lbl);
      row.appendChild(del);
      list.appendChild(row);
    })(sk.constraints[cids[k]]);
  }
};

// Prompted variant used by the palette buttons and keyboard shortcuts.
RP.promptConstraint = function(type) {
  var refs = RP.constraintRefsFor(type);
  if (!refs) return { ok: false, message: 'Selection does not fit "' + type + '"' };
  var def = RP.Sketch.constraintDefs[type];
  if (!def.hasValue) return RP.applyConstraint(type);
  var current = RP.constraintToDisplay(type, RP.measureConstraint(type, refs));
  var entered = prompt(
    (def.label || type) + ' (' + RP.constraintUnit(type) + '):',
    current.toFixed(2)
  );
  if (entered === null) return { ok: false, cancelled: true };
  return RP.applyConstraint(type, entered);
};

RP.wireConstraintPanel = function() {
  var btns = document.querySelectorAll('.constraint-btn[data-constraint]');
  for (var i = 0; i < btns.length; i++) {
    (function(btn) {
      btn.innerHTML = RP.constraintIconHTML(btn.dataset.constraint);
      btn.addEventListener('click', function() {
        var res = RP.promptConstraint(btn.dataset.constraint);
        if (res && !res.ok && !res.cancelled && res.message) alert(res.message);
      });
    })(btns[i]);
  }
  var auto = document.getElementById('btn-auto-constrain');
  if (auto) {
    auto.addEventListener('click', function() {
      RP.autoConstrain = !RP.autoConstrain;
      auto.classList.toggle('active', RP.autoConstrain);
      auto.textContent = RP.autoConstrain ? '✓ Auto-constrain' : '✗ Auto-constrain';
    });
  }
  RP.updateConstraintPanel();
};
