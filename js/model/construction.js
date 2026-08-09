/* ========================================================================
   construction.js - Construction-geometry semantics over the sketch layer.

   The sketch owns POSITIONS (points, lines, constraints). This module owns
   what a construction line MEANS to the app: its label, its visibility, and
   the fact that it is a snap target rather than a route.

   RP.lines is kept alive as a flat, rebuilt view so render.js, computeSnap
   and the layer list keep working unchanged:

       [{ id, p1, p2, x1, y1, x2, y2, type, label, visible }]

   `id` is the sketch LINE entity id — there is no second id space. The view
   is ordered by entity id, which is stable, because computeSnap's
   `excludeLineIdx` and elementDrag's `lineIdx` are array indices held across
   a drag.

   TREAT THE VIEW AS READ-ONLY. Mutating RP.lines[i].x1 no longer does
   anything useful — the next rebuild discards it. Go through the helpers
   here instead.
   ======================================================================== */
var RP = window.RP || {};

RP.sketch = null;
RP.constructionMeta = {};     // line entity id -> { label, visible }
RP.autoConstrain = true;      // snap-derived constraints on draw

RP.ensureSketch = function() {
  if (!RP.sketch) RP.sketch = RP.Sketch.create({ charLength: 100 });
  return RP.sketch;
};

RP.resetSketch = function() {
  RP.sketch = RP.Sketch.create({ charLength: 100 });
  RP.constructionMeta = {};
  RP.lines = [];
  RP.arcs = [];
  RP.points = [];
  RP.selectedLineId = null;
};

// ---- the RP.lines view ----------------------------------------------
RP.rebuildLines = function() {
  var sk = RP.ensureSketch();
  var ids = RP.Sketch.entityIds(sk);
  var out = [];
  var arcsOut = [];
  var ptsOut = [];
  for (var i = 0; i < ids.length; i++) {
    var e = sk.entities[ids[i]];
    if (!e) continue;

    // A standalone point is a point that carries construction metadata of
    // its own. Points owned by a line or arc have none, which is what
    // keeps endpoints out of this view.
    if (e.type === 'point') {
      var pm = RP.constructionMeta[e.id];
      if (!pm || pm.role !== RP.POINT_ROLE) continue;
      ptsOut.push({
        id: e.id, x: e.x, y: e.y,
        role: RP.POINT_ROLE,
        name: pm.label || null,
        visible: pm.visible !== false
      });
      continue;
    }

    if (e.type === 'arc') {
      var am = RP.constructionMeta[e.id];
      if (!am) continue;
      var ac = sk.entities[e.center], ap1 = sk.entities[e.p1], ap2 = sk.entities[e.p2];
      if (!ac || !ap1 || !ap2) continue;
      var ageo = RP.Sketch.arcGeometry(sk, e);
      arcsOut.push({
        id: e.id, center: e.center, p1: e.p1, p2: e.p2, ccw: !!e.ccw,
        cx: ac.x, cy: ac.y,
        x1: ap1.x, y1: ap1.y, x2: ap2.x, y2: ap2.y,
        radius: ageo ? ageo.radius : 0,
        sweep: ageo ? ageo.sweep : 0,
        role: am.role || 'construction',
        // Radius, measured live like line lengths.
        label: ageo ? ('R ' + RP.constructionLabel(0, 0, ageo.radius, 0)) : null,
        name: am.label || null,
        visible: am.visible !== false
      });
      continue;
    }

    if (e.type !== 'line') continue;
    var meta = RP.constructionMeta[e.id];
    if (!meta) continue;              // not a construction line
    var a = sk.entities[e.p1], b = sk.entities[e.p2];
    if (!a || !b) continue;
    out.push({
      id: e.id, p1: e.p1, p2: e.p2,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      type: 'construction',
      role: meta.role || 'construction',
      // MEASURED LIVE from the solved coordinates. It used to be a string
      // captured at draw time, which meant every solver move left it
      // stale — constrain a length and the line moved while the mm text
      // kept reporting the old value.
      label: RP.constructionLabel(a.x, a.y, b.x, b.y),
      name: meta.label || null,
      visible: meta.visible !== false
    });
  }
  RP.lines = out;
  RP.arcs = arcsOut;
  RP.points = ptsOut;
  return out;
};

// A point that exists in its own right rather than as the end of
// something. Useful for marking a mission object, a drop zone, or any
// reference you want to constrain other geometry against.
RP.POINT_ROLE = 'point';

RP.addConstructionPoint = function(x, y, opts) {
  opts = opts || {};
  var sk = RP.ensureSketch();
  var p = RP.Sketch.addPoint(sk, x, y);
  RP.constructionMeta[p.id] = {
    label: opts.name || null, visible: true, role: RP.POINT_ROLE
  };
  var added = RP.autoConstrainPoint(p.id, opts.snap);
  var res = RP.solveSketch();
  if (res && res.status === 'conflict' && added.length) {
    for (var i = 0; i < added.length; i++) RP.Sketch.removeConstraint(sk, added[i].id);
    RP.solveSketch();
    added = [];
  }
  return { point: p, constraints: added };
};

// Create a construction arc. The centre is a real sketch point, so it can
// be dragged and constrained like anything else — which is what makes an
// arc adjustable without a bespoke "bulge handle".
RP.addConstructionArc = function(x1, y1, x2, y2, opts) {
  opts = opts || {};
  var sk = RP.ensureSketch();
  var dx = x2 - x1, dy = y2 - y1;
  var L = Math.hypot(dx, dy);
  if (L < 1e-6) return null;

  // Default bulge: centre offset perpendicular from the chord midpoint.
  var sag = (opts.sagitta != null) ? opts.sagitta : Math.max(6, L * 0.2);
  var geom = RP.computeArcGeom(x1, y1, x2, y2, sag);
  if (!geom) return null;

  var p1 = RP.Sketch.addPoint(sk, x1, y1);
  var p2 = RP.Sketch.addPoint(sk, x2, y2);
  var pc = RP.Sketch.addPoint(sk, geom.cx, geom.cy);
  var arc = RP.Sketch.addArc(sk, pc.id, p1.id, p2.id, geom.sweepRad > 0);
  RP.constructionMeta[arc.id] = { label: opts.name || null, visible: true };

  var added = [];
  added = added.concat(RP.autoConstrainPoint(p1.id, opts.startSnap));
  added = added.concat(RP.autoConstrainPoint(p2.id, opts.endSnap));
  var res = RP.solveSketch();
  if (res && res.status === 'conflict' && added.length) {
    for (var i = 0; i < added.length; i++) RP.Sketch.removeConstraint(sk, added[i].id);
    RP.solveSketch();
    added = [];
  }

  // Tangency comes last, and only where the endpoint actually landed on a
  // straight — it is judged on its own so a rejected tangent cannot take
  // the coincident that joined the ends down with it.
  var tangents = [];
  var t1 = RP.autoConstrainTangent(arc, p1.id, opts.startSnap);
  if (t1) tangents.push(t1);
  var t2 = RP.autoConstrainTangent(arc, p2.id, opts.endSnap);
  if (t2) tangents.push(t2);
  RP.solveSketch();

  return { arc: arc, p1: p1, p2: p2, center: pc,
           constraints: added, tangents: tangents };
};

RP.solveSketch = function(opts) {
  var res = RP.Sketch.solve(RP.ensureSketch(), opts);
  RP.rebuildLines();
  return res;
};

RP.constructionLabel = function(x1, y1, x2, y2) {
  var px = RP.dist(x1, y1, x2, y2);
  var mm = RP.calibration ? px / RP.calibration.pixelsPerMm : px;
  return mm.toFixed(2) + ' mm';
};

// ---- auto-constraints from the snap system ---------------------------
// Snap stays a drawing aid; it merely OFFERS a constraint on commit. The
// two systems are never merged.
RP.autoConstrainPoint = function(pointId, snap) {
  if (!RP.autoConstrain || !snap) return [];
  var sk = RP.ensureSketch();
  var added = [];
  try {
    if (snap.kind === 'endpoint' && snap.pointId && snap.pointId !== pointId) {
      added.push(RP.Sketch.addConstraint(sk, 'coincident', [pointId, snap.pointId]));
    } else if (snap.kind === 'along-line' && snap.lineId) {
      added.push(RP.Sketch.addConstraint(sk, 'point_on_line', [pointId, snap.lineId]));
    } else if (snap.kind === 'intersection' && snap.lineIds) {
      for (var i = 0; i < snap.lineIds.length; i++) {
        added.push(RP.Sketch.addConstraint(sk, 'point_on_line', [pointId, snap.lineIds[i]]));
      }
    }
  } catch (err) { /* a rejected auto-constraint is never fatal */ }
  return added;
};

// Entities that END at the same place as this point (an arc's centre does
// not count — the centre is a control handle, not somewhere the curve
// reaches).
//
// Compared through the coincidence union-find, not by point id: two lines
// meeting at a corner keep their OWN endpoints and are joined by a
// coincident constraint, so an id comparison would see one line where
// there are two.
RP.entitiesEndingAt = function(sk, pointId, type) {
  var find = RP.Sketch.coincidenceClusters(sk);
  var key = find(pointId);
  var ids = RP.Sketch.entityIds(sk), out = [];
  for (var i = 0; i < ids.length; i++) {
    var e = sk.entities[ids[i]];
    if (!e || e.type !== type) continue;
    if (find(e.p1) === key || find(e.p2) === key) out.push(e);
  }
  return out;
};

// A curve meeting a straight at a shared endpoint almost always wants to
// be TANGENT there — that is what makes the robot's path continuous
// instead of kinking, and it is the whole reason to draw an arc between
// two legs. So offer it the same way snap offers coincident.
//
// `tangent` constrains the arc's centre to stand one radius off the line.
// Combined with the coincident that put the endpoints together, the point
// of tangency IS that shared endpoint, which is the constraint we want.
//
// Only applied when exactly one candidate ends at the point: at a corner
// where two lines already meet, a second tangent would over-constrain and
// there is no way to guess which line was meant.
RP.autoConstrainTangent = function(newEntity, pointId, snap) {
  if (!RP.autoConstrain || !snap || snap.kind !== 'endpoint' || snap.pointId == null) return null;
  if (!newEntity) return null;
  var sk = RP.ensureSketch();
  var lineId = null, arcId = null;

  if (newEntity.type === 'arc') {
    var lines = RP.entitiesEndingAt(sk, snap.pointId, 'line');
    if (lines.length !== 1) return null;
    lineId = lines[0].id;
    arcId = newEntity.id;
  } else if (newEntity.type === 'line') {
    var arcs = RP.entitiesEndingAt(sk, snap.pointId, 'arc');
    if (arcs.length !== 1) return null;
    lineId = newEntity.id;
    arcId = arcs[0].id;
  } else {
    return null;
  }

  // Which entity was already there — the new one should be the one that
  // moves to satisfy the guess.
  var existingId = (newEntity.type === 'arc') ? lineId : arcId;

  try {
    var before = RP.Sketch.solve(sk);
    var c = RP.Sketch.addConstraint(sk, 'tangent', [lineId, arcId]);

    // Solve once with the pre-existing geometry pinned. Without this the
    // solver is free to satisfy tangency by swinging the line the user
    // already drew, which is alarming: you draw a horizontal line, add an
    // arc, and the line tilts. Pinning steers it to the solution that
    // moves the NEW arc instead. The pins come straight back off; the
    // configuration it lands on already satisfies everything, so the
    // unpinned solve that follows has nothing left to do.
    var pins = [];
    var ends = RP.Sketch.pointsOf(sk, existingId) || [];
    for (var i = 0; i < ends.length; i++) {
      try { pins.push(RP.Sketch.addConstraint(sk, 'fix', [ends[i]])); } catch (e2) { /* skip */ }
    }
    var pinned = pins.length ? RP.Sketch.solve(sk) : null;
    for (var j = 0; j < pins.length; j++) RP.Sketch.removeConstraint(sk, pins[j].id);
    // If pinning made it unsolvable, the existing geometry genuinely has
    // to move — let it, rather than dropping a tangent that is fine.
    if (pinned && (pinned.status === 'conflict' || !pinned.ok)) RP.Sketch.solve(sk);

    var after = RP.Sketch.solve(sk);
    // An inferred constraint must never make the sketch worse than it was.
    // Redundant counts as worse here: it adds a badge and a row for an
    // equation that changes nothing.
    if (after.status === 'conflict' || after.status === 'redundant') {
      if (before.status !== after.status) {
        RP.Sketch.removeConstraint(sk, c.id);
        RP.Sketch.solve(sk);
        return null;
      }
    }
    return c;
  } catch (err) {
    return null;   // a rejected guess is never fatal
  }
};

// A 90deg snap means the user asked for an axis-aligned line; record that
// as a real horizontal/vertical constraint rather than leaving it implicit.
RP.autoConstrainAxis = function(lineId, snap) {
  if (!RP.autoConstrain || !snap || snap.kind !== '90deg') return null;
  var sk = RP.ensureSketch();
  var line = RP.Sketch.get(sk, lineId);
  if (!line) return null;
  var a = sk.entities[line.p1], b = sk.entities[line.p2];
  var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  try {
    if (dy < 1e-6 && dx > 1e-6) return RP.Sketch.addConstraint(sk, 'horizontal', [lineId]);
    if (dx < 1e-6 && dy > 1e-6) return RP.Sketch.addConstraint(sk, 'vertical', [lineId]);
  } catch (err) { /* ignore */ }
  return null;
};

// ---- create / remove / edit ------------------------------------------
RP.addConstructionLine = function(x1, y1, x2, y2, opts) {
  opts = opts || {};
  var sk = RP.ensureSketch();
  var a = RP.Sketch.addPoint(sk, x1, y1);
  var b = RP.Sketch.addPoint(sk, x2, y2);
  var line = RP.Sketch.addLine(sk, a.id, b.id);
  // No label stored — length is derived in rebuildLines(). `label` here is
  // reserved for an optional user-given name.
  RP.constructionMeta[line.id] = { label: opts.name || null, visible: true };

  var added = [];
  added = added.concat(RP.autoConstrainPoint(a.id, opts.startSnap));
  added = added.concat(RP.autoConstrainPoint(b.id, opts.endSnap));
  var axis = RP.autoConstrainAxis(line.id, opts.endSnap);
  if (axis) added.push(axis);

  var res = RP.solveSketch();
  // An auto-constraint must never be able to break the sketch. If the guess
  // conflicts, drop it and keep the geometry the user actually drew.
  if (res && res.status === 'conflict' && added.length) {
    for (var i = 0; i < added.length; i++) RP.Sketch.removeConstraint(sk, added[i].id);
    RP.solveSketch();
    added = [];
  }

  // The mirror of the arc case: a straight drawn away from where an arc
  // ends should leave that join smooth too.
  var lineTangents = [];
  var lt1 = RP.autoConstrainTangent(line, a.id, opts.startSnap);
  if (lt1) lineTangents.push(lt1);
  var lt2 = RP.autoConstrainTangent(line, b.id, opts.endSnap);
  if (lt2) lineTangents.push(lt2);
  RP.solveSketch();

  return { line: line, p1: a, p2: b, constraints: added, tangents: lineTangents };
};

// True if any OTHER entity is built on this point.
RP.sketchPointInUse = function(sk, pointId) {
  var ids = RP.Sketch.entityIds(sk);
  for (var i = 0; i < ids.length; i++) {
    var e = sk.entities[ids[i]];
    if (e && e.id !== pointId && RP.Sketch.referencesEntity(e, pointId)) return true;
  }
  return false;
};

RP.removeConstructionLine = function(lineId) {
  var sk = RP.ensureSketch();
  var line = RP.Sketch.get(sk, lineId);
  if (!line) return;
  // A standalone point has no sub-points to cascade, and deleting it is
  // only safe if nothing else was built on it.
  if (line.type === 'point') {
    if (RP.sketchPointInUse(sk, lineId)) return;
    RP.pushHistory('Delete point');
    RP.Sketch.removeEntity(sk, lineId);
    delete RP.constructionMeta[lineId];
    if (RP.selectedLineId === lineId) RP.selectedLineId = null;
    RP.solveSketch();
    if (RP.updateLayerList) RP.updateLayerList();
    if (RP.render) RP.render();
    return;
  }
  // pointsOf covers arcs too, whose centre would otherwise be orphaned.
  var ends = RP.Sketch.pointsOf(sk, lineId);

  RP.pushHistory('Delete construction geometry');
  RP.Sketch.removeEntity(sk, lineId);
  delete RP.constructionMeta[lineId];
  // Drop the endpoints too, unless something else is built on them.
  for (var i = 0; i < ends.length; i++) {
    if (!RP.sketchPointInUse(sk, ends[i])) RP.Sketch.removeEntity(sk, ends[i]);
  }
  if (RP.selectedLineId === lineId) RP.selectedLineId = null;

  RP.solveSketch();
  if (RP.updateLayerList) RP.updateLayerList();
  if (RP.render) RP.render();
};

// Move one end of a construction line. The point is pinned at the cursor
// and the rest of the sketch re-solves around it, so constrained geometry
// follows.
RP.moveConstructionEndpoint = function(lineId, which, x, y) {
  var sk = RP.ensureSketch();
  var line = RP.Sketch.get(sk, lineId);
  if (!line) return null;
  var pid = (which === 'start') ? line.p1 : line.p2;
  var res = RP.Sketch.dragPoint(sk, pid, x, y);
  RP.rebuildLines();
  return res;
};

RP.setConstructionVisible = function(lineId, visible) {
  var meta = RP.constructionMeta[lineId];
  if (meta) meta.visible = !!visible;
  RP.rebuildLines();
};

// ---- field boundary --------------------------------------------------
// The walls the robot can physically hit, as REAL fixed sketch geometry.
// Once they exist, drawing a line to a wall snaps against it like anything
// else, and wall_align becomes a distance constraint rather than magic.
RP.FIELD_ROLE = 'field';
RP.FIELD_WALL_NAMES = ['top wall', 'right wall', 'bottom wall', 'left wall'];

RP.fieldLineIds = function() {
  var out = [];
  for (var id in RP.constructionMeta) {
    if (RP.constructionMeta[id] && RP.constructionMeta[id].role === RP.FIELD_ROLE) {
      out.push(Number(id));
    }
  }
  return out;
};

RP.hasFieldBoundary = function() { return RP.fieldLineIds().length > 0; };

RP.removeFieldBoundary = function() {
  var sk = RP.ensureSketch();
  var ids = RP.fieldLineIds();
  for (var i = 0; i < ids.length; i++) {
    var line = RP.Sketch.get(sk, ids[i]);
    delete RP.constructionMeta[ids[i]];
    if (!line) continue;
    var ends = [line.p1, line.p2];
    RP.Sketch.removeEntity(sk, ids[i]);
    for (var k = 0; k < ends.length; k++) {
      if (!RP.sketchPointInUse(sk, ends[k])) RP.Sketch.removeEntity(sk, ends[k]);
    }
  }
  RP.rebuildLines();
  return ids.length;
};

// Four corner points shared by four lines, each corner pinned — so the
// boundary contributes 8 parameters and 8 equations and is exactly rigid.
RP.createFieldBoundary = function(opts) {
  var sk = RP.ensureSketch();
  var w = (opts && opts.width) || RP.imgNaturalW;
  var h = (opts && opts.height) || RP.imgNaturalH;
  if (!w || !h) return null;

  RP.removeFieldBoundary();
  var corners = [
    RP.Sketch.addPoint(sk, 0, 0),
    RP.Sketch.addPoint(sk, w, 0),
    RP.Sketch.addPoint(sk, w, h),
    RP.Sketch.addPoint(sk, 0, h)
  ];
  var lines = [];
  for (var i = 0; i < 4; i++) {
    var ln = RP.Sketch.addLine(sk, corners[i].id, corners[(i + 1) % 4].id);
    RP.constructionMeta[ln.id] = {
      label: RP.FIELD_WALL_NAMES[i], visible: true, role: RP.FIELD_ROLE
    };
    lines.push(ln);
  }
  for (var j = 0; j < 4; j++) RP.Sketch.addConstraint(sk, 'fix', [corners[j].id]);
  RP.solveSketch();
  return lines;
};

// Two endpoints on a circle bound TWO arcs; `ccw` says which one is meant.
// That is a discrete topological choice, not a solvable parameter — with
// the centre and both endpoints constrained, the solver cannot move the
// arc to the other side no matter what you drag. Flipping it has to be an
// explicit action.
RP.flipArc = function(arcId) {
  var sk = RP.ensureSketch();
  var arc = RP.Sketch.get(sk, arcId);
  if (!arc || arc.type !== 'arc') return false;
  arc.ccw = !arc.ccw;
  RP.solveSketch();
  return true;
};

// Nearest field wall to a point, used when an element becomes wall_align
// and nothing has said which wall it means.
RP.nearestFieldLine = function(pointId) {
  var sk = RP.ensureSketch();
  var p = sk.entities[pointId];
  if (!p) return null;
  var ids = RP.fieldLineIds();
  var best = null, bestD = Infinity;
  for (var i = 0; i < ids.length; i++) {
    var d = RP.Sketch.perpDistance(sk, pointId, ids[i]);
    if (d === null) continue;
    if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = ids[i]; }
  }
  return best;
};

// ---- serialization ---------------------------------------------------
RP.serializeSketch = function() {
  var sk = RP.ensureSketch();
  return {
    entities: JSON.parse(JSON.stringify(sk.entities)),
    constraints: JSON.parse(JSON.stringify(sk.constraints)),
    nextEntityId: sk.nextEntityId,
    nextConstraintId: sk.nextConstraintId,
    charLength: sk.charLength
  };
};

RP.deserializeSketch = function(data) {
  var sk = RP.Sketch.create({ charLength: (data && data.charLength) || 100 });
  if (data) {
    sk.entities = JSON.parse(JSON.stringify(data.entities || {}));
    sk.constraints = JSON.parse(JSON.stringify(data.constraints || {}));
    sk.nextEntityId = data.nextEntityId || 1;
    sk.nextConstraintId = data.nextConstraintId || 1;
  }
  RP.sketch = sk;
  return sk;
};

// Restore from a save payload of any vintage: v3 carries a real sketch,
// anything older only has flat lines and gets migrated.
RP.loadSketchFrom = function(data) {
  if (data && data.sketch) {
    RP.deserializeSketch(data.sketch);
    RP.constructionMeta = JSON.parse(JSON.stringify(data.construction || {}));
    RP.rebuildLines();
  } else {
    RP.sketchFromLegacyLines((data && data.lines) || []);
  }
};

// ---- migration from pre-sketch saves ---------------------------------
// Builds an equivalent sketch from legacy RP.lines. Endpoints that were
// already exactly coincident (they came from endpoint snapping) get a real
// coincident constraint; a union-find keeps that to a spanning set so a
// cluster of N coincident points yields N-1 constraints, not N-choose-2.
//
// Nothing else is inferred — guessing horizontal/parallel from near
// alignment would silently reshape existing maps.
RP.sketchFromLegacyLines = function(lines) {
  RP.resetSketch();
  var sk = RP.sketch;
  var pts = [];
  var i, j;

  for (i = 0; i < (lines || []).length; i++) {
    var l = lines[i];
    var a = RP.Sketch.addPoint(sk, l.x1, l.y1);
    var b = RP.Sketch.addPoint(sk, l.x2, l.y2);
    var line = RP.Sketch.addLine(sk, a.id, b.id);
    RP.constructionMeta[line.id] = { label: null, visible: l.visible !== false };
    pts.push(a);
    pts.push(b);
  }

  var parent = {};
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(x, y) {
    var rx = find(x), ry = find(y);
    if (rx === ry) return false;
    parent[rx] = ry;
    return true;
  }
  for (i = 0; i < pts.length; i++) parent[pts[i].id] = pts[i].id;

  var EPS = 0.01;
  for (i = 0; i < pts.length; i++) {
    for (j = i + 1; j < pts.length; j++) {
      if (Math.abs(pts[i].x - pts[j].x) < EPS && Math.abs(pts[i].y - pts[j].y) < EPS) {
        if (union(pts[i].id, pts[j].id)) {
          RP.Sketch.addConstraint(sk, 'coincident', [pts[i].id, pts[j].id]);
        }
      }
    }
  }

  RP.rebuildLines();
  return sk;
};
