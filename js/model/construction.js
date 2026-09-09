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

// ---- documents -------------------------------------------------------
// There are two sketch documents, in two different coordinate spaces:
//
//   mat    the competition field. Everything that already existed — route
//          geometry, field walls, obstacles — lives here, in mat pixels.
//   robot  the robot's own body, in ROBOT-LOCAL mm-ish pixels. Its origin
//          and facing come from the drive axis (see RP.robotFrame), not
//          from where the geometry happens to sit.
//
// They are deliberately separate sketches rather than one sketch with a
// role tag: the solver treats a sketch as one system, so a robot drawn
// into the mat would join the mat's DOF count, could be constrained to
// mat geometry, and would be dragged around by mat edits. A body and the
// field it drives over have nothing to solve together.
//
// RP.sketch / RP.constructionMeta always point at the ACTIVE document;
// the other one is parked in RP.documents. That keeps every existing
// reader (43 of them) working unchanged — they simply see whichever
// document is being edited.
RP.DOC_MAT = 'mat';
RP.DOC_ROBOT = 'robot';
RP.activeDocId = RP.DOC_MAT;
RP.documents = {};

function _freshDoc() {
  return { sketch: RP.Sketch.create({ charLength: 100 }), constructionMeta: {}, groups: [] };
}

// ---- groups ----------------------------------------------------------
// A named bag of geometry with one visibility switch. Hiding a group is
// EXACTLY hiding each of its members: invisible, unclickable, unsnappable,
// no presence at all. That is the whole feature — it is an organisation
// tool, not a second solver scope, so nothing here touches the sketch.
//
// The gate is applied once, in rebuildLines, where the `visible` field of
// the RP.lines/arcs/points view is computed. Every consumer already reads
// that field — render, snap, hit tests, selection, the layer list — so
// they all inherit group hiding without knowing groups exist.
RP.groups = [];
RP.nextGroupId = 1;
RP.currentGroupId = null;

// Every piece of geometry is in exactly ONE group — there is no
// "ungrouped" tier. A second kind of membership that behaves differently
// is a rule you have to carry in your head for no benefit, so a document
// always has a Default group and anything without one lands there.
RP.DEFAULT_GROUP_NAME = 'Default';

RP.ensureDefaultGroup = function() {
  if (!RP.groups) RP.groups = [];
  for (var i = 0; i < RP.groups.length; i++) {
    if (RP.groups[i].isDefault) return RP.groups[i];
  }
  var g = { id: RP.nextGroupId++, name: RP.DEFAULT_GROUP_NAME, visible: true, isDefault: true };
  RP.groups.unshift(g);
  if (RP.currentGroupId == null) RP.currentGroupId = g.id;
  return g;
};

// The group new geometry is drawn into. Never null once a document has
// been touched, so drawing always has somewhere to go.
RP.currentGroup = function() {
  var g = RP.currentGroupId != null ? RP.findGroup(RP.currentGroupId) : null;
  return g || RP.ensureDefaultGroup();
};

// Setting a group current also SHOWS it. Otherwise the next line drawn
// vanishes the instant it is created, which reads as drawing being
// broken rather than as the group being hidden.
RP.setCurrentGroup = function(groupId) {
  var g = RP.findGroup(groupId);
  if (!g) return false;
  RP.currentGroupId = g.id;
  if (g.visible === false) g.visible = true;
  RP.rebuildLines();
  return true;
};

RP.findGroup = function(groupId) {
  for (var i = 0; i < RP.groups.length; i++) {
    if (RP.groups[i].id === groupId) return RP.groups[i];
  }
  return null;
};

// `groups` defaults to the ACTIVE document's, which is what the RP.lines
// view wants. Readers that name a document explicitly — obstacleSegments,
// robotFootprint — must pass that document's own groups, or they would
// consult whichever document happens to be open instead.
RP.groupVisible = function(groupId, groups) {
  if (groupId == null) return true;          // ungrouped geometry is always shown
  var list = groups || RP.groups || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === groupId) return list[i].visible !== false;
  }
  return true;                               // a dangling id must not hide anything
};

RP.addGroup = function(name) {
  RP.ensureDefaultGroup();
  var g = { id: RP.nextGroupId++, name: String(name || 'Group ' + (RP.groups.length + 1)), visible: true };
  RP.groups.push(g);
  return g;
};

RP.renameGroup = function(groupId, name) {
  var g = RP.findGroup(groupId);
  if (!g) return false;
  g.name = String(name || g.name);
  return true;
};

RP.setGroupVisible = function(groupId, visible) {
  var g = RP.findGroup(groupId);
  if (!g) return false;
  g.visible = !!visible;
  RP.rebuildLines();
  return true;
};

// Deleting a group never deletes geometry — the members simply become
// ungrouped, and therefore visible again. Losing drawn work to a tidying
// action would be a very unpleasant surprise.
RP.removeGroup = function(groupId) {
  var at = -1;
  for (var i = 0; i < RP.groups.length; i++) if (RP.groups[i].id === groupId) { at = i; break; }
  if (at < 0) return false;
  // Default is the floor everything falls back to, so it cannot be the
  // thing that disappears.
  if (RP.groups[at].isDefault) return false;
  RP.groups.splice(at, 1);
  var home = RP.ensureDefaultGroup();
  for (var id in RP.constructionMeta) {
    if (RP.constructionMeta[id] && RP.constructionMeta[id].group === groupId) {
      RP.constructionMeta[id].group = home.id;
    }
  }
  if (RP.currentGroupId === groupId) RP.currentGroupId = home.id;
  RP.rebuildLines();
  return true;
};

RP.setGeometryGroup = function(entityId, groupId) {
  var meta = RP.constructionMeta[entityId];
  if (!meta) return false;
  meta.group = (groupId == null) ? RP.ensureDefaultGroup().id : groupId;
  RP.rebuildLines();
  return true;
};

// Move geometry into a group in one action. `ids` is whatever the caller
// decided the target is — see RP.groupAssignmentTargets, which resolves
// "the thing I right-clicked" against "the things I had selected".
RP.setGeometryGroupMany = function(ids, groupId) {
  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    if (RP.constructionMeta[ids[i]]) {
      RP.constructionMeta[ids[i]].group = groupId;
      n++;
    }
  }
  if (n) RP.rebuildLines();
  return n;
};

// Right-clicking geometry that is part of the current selection acts on
// the WHOLE selection; right-clicking outside it acts on just that one.
// That is what file managers do, and it means shift-clicking a dozen
// lines then assigning them is still two clicks rather than twenty-four.
RP.groupAssignmentTargets = function(clickedId) {
  var sel = RP.sketchSelection || [];
  if (clickedId != null && sel.indexOf(clickedId) < 0) return [clickedId];
  if (sel.length) return sel.slice();
  return clickedId != null ? [clickedId] : [];
};

// Find by name, or make it. This is what the "Group…" prompt uses, so
// typing a name that already exists joins it rather than making a second
// group with the same label.
RP.groupByNameOrCreate = function(name) {
  var want = String(name || '').trim();
  if (!want) return null;
  for (var i = 0; i < RP.groups.length; i++) {
    if (RP.groups[i].name.toLowerCase() === want.toLowerCase()) return RP.groups[i];
  }
  return RP.addGroup(want);
};

RP.entitiesInGroup = function(groupId) {
  var out = [];
  for (var id in RP.constructionMeta) {
    var m = RP.constructionMeta[id];
    if (m && (m.group == null ? null : m.group) === groupId) out.push(Number(id));
  }
  return out;
};

RP.ensureSketch = function() {
  if (!RP.sketch) RP.sketch = RP.Sketch.create({ charLength: 100 });
  return RP.sketch;
};

// Park the live document back into the map. Call before reading or
// replacing RP.documents wholesale, so the active one is never stale.
RP.parkActiveDoc = function() {
  RP.documents[RP.activeDocId] = {
    sketch: RP.ensureSketch(),
    constructionMeta: RP.constructionMeta,
    groups: RP.groups,
    nextGroupId: RP.nextGroupId,
    currentGroupId: RP.currentGroupId
  };
  return RP.documents;
};

RP.getDoc = function(id) {
  if (id === RP.activeDocId) {
    return { sketch: RP.ensureSketch(), constructionMeta: RP.constructionMeta,
             groups: RP.groups, nextGroupId: RP.nextGroupId,
             currentGroupId: RP.currentGroupId };
  }
  if (!RP.documents[id]) RP.documents[id] = _freshDoc();
  return RP.documents[id];
};

RP.setActiveDoc = function(id) {
  if (id !== RP.DOC_ROBOT) id = RP.DOC_MAT;
  if (id === RP.activeDocId && RP.sketch) return false;
  RP.parkActiveDoc();
  var doc = RP.documents[id] || (RP.documents[id] = _freshDoc());
  RP.sketch = doc.sketch;
  RP.constructionMeta = doc.constructionMeta;
  RP.groups = doc.groups || (doc.groups = []);
  RP.nextGroupId = doc.nextGroupId || 1;
  RP.currentGroupId = doc.currentGroupId != null ? doc.currentGroupId : null;
  RP.ensureDefaultGroup();
  RP.activeDocId = id;
  // Selections are per-document ids; carrying them across would highlight
  // an unrelated entity that happens to share a number.
  RP.selectedLineId = null;
  if (RP.clearSketchSelection) RP.clearSketchSelection();
  RP.hoverGeoId = null;
  RP.rebuildLines();
  return true;
};

RP.resetSketch = function() {
  RP.sketch = RP.Sketch.create({ charLength: 100 });
  RP.constructionMeta = {};
  RP.groups = [];
  RP.nextGroupId = 1;
  RP.currentGroupId = null;
  RP.ensureDefaultGroup();
  RP.activeDocId = RP.DOC_MAT;
  RP.documents = {};
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
        group: pm.group != null ? pm.group : null,
        name: pm.label || null,
        visible: pm.visible !== false && RP.groupVisible(pm.group)
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
        group: am.group != null ? am.group : null,
        name: am.label || null,
        visible: am.visible !== false && RP.groupVisible(am.group)
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
      group: meta.group != null ? meta.group : null,
      name: meta.label || null,
      visible: meta.visible !== false && RP.groupVisible(meta.group)
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
    label: opts.name || null, visible: true, role: RP.POINT_ROLE,
    group: RP.currentGroup().id
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
  RP.constructionMeta[arc.id] = { label: opts.name || null, visible: true, group: RP.currentGroup().id };

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
// Stated as `tangent_at`, at the shared end, rather than the plain
// `tangent` that constrains the centre to stand one radius off the line.
// The plain one captures which SIDE the centre started on and can never
// let the arc flip, which leaves regions of the sketch unreachable and
// the solver stuck in them. See the constraint's own comment.
//
// Only applied when exactly one candidate ends at the point: at a corner
// where two lines already meet, a second tangent would over-constrain and
// there is no way to guess which line was meant.
// Rotate a freshly-drawn line about the arc end it joins, so it starts out
// exactly tangent, WITHOUT changing the length the user drew.
//
// tangent_at's residual is (p − c)·û, the radius vector dotted with the
// line's unit direction. That is scale-invariant in the line's length: the
// constraint says nothing whatsoever about how long the line is, and its
// Jacobian is correspondingly flat along that direction. So when the line
// is drawn far from tangent, the only way the solver has to fix the angle
// is to walk the far end sideways — and swinging a line by translating one
// end changes its length as a side effect, with nothing pushing back. On a
// mat-sized sketch that regularly turned a 200px line into several
// thousand, or (with the length driven the other way) collapsed it toward
// zero, where the residual and Jacobian are both hard-zeroed for a
// degenerate direction: vacuously satisfied, no gradient out, and every
// other constraint touching that line now unsatisfiable — the "conflicting
// constraints" that only a manual length constraint could rescue.
//
// Rotating about the shared end instead sets the angle exactly and leaves
// the length alone, so the solver starts on the answer rather than walking
// to it. Purely a starting guess: the constraint still goes on afterwards
// and the solver still has the last word.
RP.seedTangentLine = function(sk, lineId, arcId, atPoint) {
  var line = sk.entities[lineId], arc = sk.entities[arcId];
  var p = sk.entities[atPoint];
  if (!line || !arc || !p) return false;
  var cen = sk.entities[arc.center];
  if (!cen) return false;

  // The line's own far end — its near end is a separate point coincident
  // with the arc's, so compare through the coincidence clusters.
  var find = RP.Sketch.coincidenceClusters(sk);
  var key = find(atPoint);
  var farId = (find(line.p1) === key) ? line.p2 : (find(line.p2) === key ? line.p1 : null);
  if (farId == null) return false;
  var q = sk.entities[farId];
  if (!q) return false;

  var wx = p.x - cen.x, wy = p.y - cen.y;
  var wl = Math.hypot(wx, wy);
  if (wl < 1e-9) return false;               // degenerate arc, nothing to be tangent to
  var tx = -wy / wl, ty = wx / wl;           // unit tangent at p

  var vx = q.x - p.x, vy = q.y - p.y;
  var L = Math.hypot(vx, vy);
  if (L < 1e-9) return false;                // already collapsed; no direction to preserve

  // Keep the far end on the side the user drew it, so the line swings the
  // short way round rather than flipping end-for-end.
  var s = (vx * tx + vy * ty) < 0 ? -1 : 1;
  q.x = p.x + s * L * tx;
  q.y = p.y + s * L * ty;
  return true;
};

// Swap which end of the drive axis is the nose, without redrawing it.
// Toggling metadata rather than the entity's point order keeps every
// constraint on that line measuring the same thing it did before.
RP.flipDriveAxis = function() {
  var frame = RP.robotFrame();
  if (!frame.ok) return false;
  var doc = RP.getDoc(RP.DOC_ROBOT);
  var m = doc.constructionMeta[frame.id];
  if (!m) return false;
  m.flipped = !m.flipped;
  RP.rebuildLines();
  return true;
};

// The robot's reach from its turning centre, in mm. This is what front
// and rear clearance actually ARE — how far the body sticks out ahead of
// and behind the point it pivots about — so once a body is drawn there is
// nothing left for a human to type, and two numbers that could disagree
// with the drawing become one that cannot.
//
// Returns null when there is no body or no calibration to convert with,
// which is what keeps the manual fields meaningful as a fallback.
RP.robotExtentsMm = function() {
  if (!RP.calibration || !RP.calibration.pixelsPerMm) return null;
  var fp = RP.robotFootprint();
  if (!fp.ok || !fp.points.length) return null;
  var ppm = RP.calibration.pixelsPerMm;
  var maxX = -Infinity, minX = Infinity, maxY = -Infinity, minY = Infinity;
  for (var i = 0; i < fp.points.length; i++) {
    var q = fp.points[i];
    if (q.x > maxX) maxX = q.x;
    if (q.x < minX) minX = q.x;
    if (q.y > maxY) maxY = q.y;
    if (q.y < minY) minY = q.y;
  }
  // Forward is +x in the robot frame. A centre that sits outside the body
  // (a drive axis drawn ahead of the whole chassis) would give a negative
  // extent, which is not a clearance — clamp so it reads as "no overhang".
  return {
    front: Math.max(0, maxX) / ppm,
    rear:  Math.max(0, -minX) / ppm,
    left:  Math.max(0, -minY) / ppm,
    right: Math.max(0, maxY) / ppm,
    length: (maxX - minX) / ppm,
    width:  (maxY - minY) / ppm
  };
};

RP.autoConstrainTangent = function(newEntity, pointId, snap) {
  if (!RP.autoConstrain || !snap || snap.kind !== 'endpoint' || snap.pointId == null) return null;
  if (!newEntity) return null;
  var sk = RP.ensureSketch();
  var lineId = null, arcId = null, atPoint = null;

  if (newEntity.type === 'arc') {
    var lines = RP.entitiesEndingAt(sk, snap.pointId, 'line');
    if (lines.length !== 1) return null;
    lineId = lines[0].id;
    arcId = newEntity.id;
    atPoint = pointId;                 // the ARC end being joined
  } else if (newEntity.type === 'line') {
    var arcs = RP.entitiesEndingAt(sk, snap.pointId, 'arc');
    if (arcs.length !== 1) return null;
    lineId = newEntity.id;
    arcId = arcs[0].id;
    atPoint = snap.pointId;            // the arc's end, which we snapped to
  } else {
    return null;
  }

  // tangent_at needs the arc's OWN endpoint; a coincident partner will
  // not do, because the residual measures the radius vector from the
  // centre to that exact point.
  var arcEnt = sk.entities[arcId];
  if (!arcEnt || (atPoint !== arcEnt.p1 && atPoint !== arcEnt.p2)) return null;

  // Which entity was already there — the new one should be the one that
  // moves to satisfy the guess.
  var existingId = (newEntity.type === 'arc') ? lineId : arcId;

  try {
    var before = RP.Sketch.solve(sk);
    // Swing the new line onto the tangent BEFORE constraining it, keeping
    // the length the user drew. See RP.seedTangentLine — without this the
    // solver reaches tangency by walking the far end sideways, which
    // changes the line's length as a side effect and can run it to
    // thousands of pixels or collapse it to nothing.
    if (newEntity.type === 'line') RP.seedTangentLine(sk, lineId, arcId, atPoint);
    var c = RP.Sketch.addConstraint(sk, 'tangent_at', [lineId, arcId, atPoint]);

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
  RP.constructionMeta[line.id] = { label: opts.name || null, visible: true, group: RP.currentGroup().id };

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
  // Only re-solve if a tangent was actually added — autoConstrainTangent
  // already solves internally when it adds one, and when it adds none the
  // sketch is untouched since the solve above. On a mat-sized sketch that
  // redundant solve was most of the cost of drawing a plain line.
  if (lineTangents.length) RP.solveSketch();

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

// Retag geometry. This is how a plain construction line becomes an
// obstacle, or how a line in the robot document becomes the drive axis.
// Field walls are deliberately excluded: they are generated as a fixed,
// named set and retagging one would leave wall_align pointing at
// something that is no longer a wall.
//
// The drive axis is unique per document — tagging a second line moves the
// role rather than leaving two frames to pick between.
RP.setGeometryRole = function(entityId, role) {
  var meta = RP.constructionMeta[entityId];
  if (!meta) return false;
  if (meta.role === RP.FIELD_ROLE || meta.role === RP.POINT_ROLE) return false;
  if (role === RP.DRIVE_ROLE) {
    var ids = RP.Sketch.entityIds(RP.ensureSketch());
    for (var i = 0; i < ids.length; i++) {
      var m = RP.constructionMeta[ids[i]];
      if (m && m.role === RP.DRIVE_ROLE) m.role = 'construction';
    }
  }
  meta.role = role || 'construction';
  RP.rebuildLines();
  return true;
};

// Every obstacle edge in the mat document, as plain segments the collision
// test can consume. Arcs are flattened here rather than at test time so a
// sweep does not re-flatten the same curve for every sampled pose.
RP.obstacleSegments = function() {
  var doc = RP.getDoc(RP.DOC_MAT);
  var sk = doc.sketch, meta = doc.constructionMeta;
  var segs = [];
  if (!sk) return segs;
  var ids = RP.Sketch.entityIds(sk);
  for (var i = 0; i < ids.length; i++) {
    var e = sk.entities[ids[i]];
    if (!e) continue;
    var m = meta[e.id];
    if (!m || m.role !== RP.OBSTACLE_ROLE) continue;
    // Hidden means inert, group or line — matching every other consumer.
    if (m.visible === false || !RP.groupVisible(m.group, doc.groups)) continue;
    if (e.type === 'line') {
      var a = sk.entities[e.p1], b = sk.entities[e.p2];
      if (a && b) segs.push({ id: e.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    } else if (e.type === 'arc') {
      var ap = RP.Sketch.arcPoints(sk, e, 32);
      for (var j = 0; j < ap.length - 1; j++) {
        segs.push({ id: e.id, x1: ap[j].x, y1: ap[j].y, x2: ap[j + 1].x, y2: ap[j + 1].y });
      }
    }
  }
  return segs;
};

// ---- field boundary --------------------------------------------------
// The walls the robot can physically hit, as REAL fixed sketch geometry.
// Once they exist, drawing a line to a wall snaps against it like anything
// else, and wall_align becomes a distance constraint rather than magic.
RP.FIELD_ROLE = 'field';
RP.FIELD_WALL_NAMES = ['top wall', 'right wall', 'bottom wall', 'left wall'];

// Geometry the robot must not drive through. Just a role on ordinary
// construction geometry, exactly like FIELD_ROLE — so obstacles are
// drawn, constrained and solved with the tools that already exist, and
// they move with the sketch instead of being a parallel world.
//
// An obstacle is a BARRIER, not a filled region: collision asks whether
// the robot's footprint crosses these edges. A solid block is its
// outline, which behaves correctly as long as the robot does not start
// inside it — see RP.simCollisions when that lands.
RP.OBSTACLE_ROLE = 'obstacle';

// The robot document's frame. One line, tagged 'drive', fixes both the
// origin and the facing: p1 is the point the robot rotates about (the
// drive-wheel axle midpoint) and p1->p2 is forward. One entity rather
// than two because an axle alone leaves "which way is forward?"
// ambiguous, and the answer cannot be guessed from a body outline.
RP.DRIVE_ROLE = 'drive';

// Roles that are structural rather than something the user drew freehand,
// so the UI can offer/deny the obstacle toggle sensibly.
RP.isTaggableRole = function(role) {
  return role !== RP.FIELD_ROLE && role !== RP.DRIVE_ROLE && role !== RP.POINT_ROLE;
};

// The robot's local frame, read out of the robot document.
// Returns { ox, oy, cos, sin, ok } — the rotation centre and the unit
// forward vector, in robot-document coordinates. Without a drive axis
// there is no way to know how the body is oriented, so this reports
// ok:false rather than guessing.
RP.robotFrame = function() {
  var doc = RP.getDoc(RP.DOC_ROBOT);
  var sk = doc.sketch, meta = doc.constructionMeta;
  if (!sk) return { ok: false };
  var ids = RP.Sketch.entityIds(sk);
  for (var i = 0; i < ids.length; i++) {
    var e = sk.entities[ids[i]];
    if (!e || e.type !== 'line') continue;
    var m = meta[e.id];
    if (!m || m.role !== RP.DRIVE_ROLE) continue;
    var a = sk.entities[e.p1], b = sk.entities[e.p2];
    if (!a || !b) continue;
    // Which end is the nose is a property of the ROLE, not of the line's
    // point order — so flipping it is a metadata toggle rather than
    // surgery on the sketch. Swapping p1/p2 on the entity itself would
    // silently negate any angle constraint measured against this line.
    if (m.flipped) { var t = a; a = b; b = t; }
    var dx = b.x - a.x, dy = b.y - a.y;
    var L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    return { ok: true, id: e.id, flipped: !!m.flipped, ox: a.x, oy: a.y, cos: dx / L, sin: dy / L };
  }
  return { ok: false };
};

// The robot's outline as points in its own frame: origin at the rotation
// centre, +x forward. This is what the simulator sweeps along the route,
// so it is expressed once here and never recomputed per pose.
//
// Every visible line and arc in the robot document contributes, EXCEPT
// the drive axis itself — that is an annotation of the frame, not part of
// the body, and including it would put a phantom edge down the robot's
// centreline.
RP.robotFootprint = function() {
  var frame = RP.robotFrame();
  if (!frame.ok) return { ok: false, points: [] };
  var doc = RP.getDoc(RP.DOC_ROBOT);
  var sk = doc.sketch, meta = doc.constructionMeta;
  var pts = [];
  function push(x, y) {
    // Into the robot frame: translate to the rotation centre, then rotate
    // so forward is +x.
    var vx = x - frame.ox, vy = y - frame.oy;
    pts.push({ x: vx * frame.cos + vy * frame.sin, y: -vx * frame.sin + vy * frame.cos });
  }
  var ids = RP.Sketch.entityIds(sk);
  for (var i = 0; i < ids.length; i++) {
    var e = sk.entities[ids[i]];
    if (!e) continue;
    var m = meta[e.id];
    if (!m || m.visible === false || !RP.groupVisible(m.group, doc.groups) || m.role === RP.DRIVE_ROLE) continue;
    if (e.type === 'line') {
      var a = sk.entities[e.p1], b = sk.entities[e.p2];
      if (a && b) { push(a.x, a.y); push(b.x, b.y); }
    } else if (e.type === 'arc') {
      var ap = RP.Sketch.arcPoints(sk, e, 24);
      for (var j = 0; j < ap.length; j++) push(ap[j].x, ap[j].y);
    }
  }
  return { ok: pts.length > 0, points: pts };
};

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

// Bring a loaded document up to the "everything is in exactly one group"
// rule. Files written before groups existed have none at all; files from
// the first groups build could leave geometry ungrouped.
RP.migrateGroups = function() {
  var home = RP.ensureDefaultGroup();
  for (var id in RP.constructionMeta) {
    var m = RP.constructionMeta[id];
    if (!m) continue;
    if (m.group == null || !RP.findGroup(m.group)) m.group = home.id;
  }
  if (RP.currentGroupId == null || !RP.findGroup(RP.currentGroupId)) {
    RP.currentGroupId = home.id;
  }
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

// Document-aware serialization. RP.serializeSketch() reads whichever
// document is ACTIVE, which is exactly wrong for saving: with the robot
// open, the robot's geometry would be written into the mat's slot. These
// name the document explicitly instead.
RP._serializeDoc = function(doc) {
  var sk = doc.sketch;
  return {
    sketch: {
      entities: JSON.parse(JSON.stringify(sk.entities)),
      constraints: JSON.parse(JSON.stringify(sk.constraints)),
      nextEntityId: sk.nextEntityId,
      nextConstraintId: sk.nextConstraintId,
      charLength: sk.charLength
    },
    construction: JSON.parse(JSON.stringify(doc.constructionMeta || {})),
    groups: JSON.parse(JSON.stringify(doc.groups || [])),
    nextGroupId: doc.nextGroupId || 1,
    currentGroupId: doc.currentGroupId != null ? doc.currentGroupId : null
  };
};

RP._docFromData = function(data) {
  var sk = RP.Sketch.create({ charLength: (data && data.sketch && data.sketch.charLength) || 100 });
  if (data && data.sketch) {
    sk.entities = JSON.parse(JSON.stringify(data.sketch.entities || {}));
    sk.constraints = JSON.parse(JSON.stringify(data.sketch.constraints || {}));
    sk.nextEntityId = data.sketch.nextEntityId || 1;
    sk.nextConstraintId = data.sketch.nextConstraintId || 1;
  }
  var groups = JSON.parse(JSON.stringify((data && data.groups) || []));
  var nextG = (data && data.nextGroupId) || 1;
  // An old file has no groups at all; everything in it is simply
  // ungrouped, which is exactly what an empty list means.
  for (var g = 0; g < groups.length; g++) nextG = Math.max(nextG, groups[g].id + 1);
  return {
    sketch: sk,
    constructionMeta: JSON.parse(JSON.stringify((data && data.construction) || {})),
    groups: groups,
    nextGroupId: nextG,
    currentGroupId: (data && data.currentGroupId != null) ? data.currentGroupId : null
  };
};

// The robot document, as it goes into a save file or an undo snapshot.
RP.serializeRobotDoc = function() {
  RP.parkActiveDoc();
  return RP._serializeDoc(RP.getDoc(RP.DOC_ROBOT));
};

// Restore the robot document without disturbing which one is active. A
// save file that predates the robot document simply has none, and gets a
// fresh empty one — the mat is unaffected either way.
RP.deserializeRobotDoc = function(data) {
  RP.parkActiveDoc();
  var doc = data ? RP._docFromData(data) : _freshDoc();
  if (RP.activeDocId === RP.DOC_ROBOT) {
    RP.sketch = doc.sketch;
    RP.constructionMeta = doc.constructionMeta;
    RP.groups = doc.groups || (doc.groups = []);
    RP.nextGroupId = doc.nextGroupId || 1;
    RP.currentGroupId = doc.currentGroupId != null ? doc.currentGroupId : null;
    RP.migrateGroups();
    RP.documents[RP.DOC_ROBOT] = doc;
    RP.rebuildLines();
  } else {
    RP.documents[RP.DOC_ROBOT] = doc;
  }
  return doc;
};

// Both documents at once, for undo snapshots. These are in-memory only,
// so unlike the save file there is no older shape to stay compatible
// with — which one was active is part of the state, since undoing a robot
// edit while looking at the mat would be baffling.
RP.serializeAllDocs = function() {
  RP.parkActiveDoc();
  return {
    mat: RP._serializeDoc(RP.getDoc(RP.DOC_MAT)),
    robot: RP._serializeDoc(RP.getDoc(RP.DOC_ROBOT)),
    activeDocId: RP.activeDocId
  };
};

RP.restoreAllDocs = function(docs) {
  RP.documents = {};
  RP.documents[RP.DOC_MAT] = RP._docFromData(docs && docs.mat);
  RP.documents[RP.DOC_ROBOT] = RP._docFromData(docs && docs.robot);
  RP.activeDocId = (docs && docs.activeDocId === RP.DOC_ROBOT) ? RP.DOC_ROBOT : RP.DOC_MAT;
  var doc = RP.documents[RP.activeDocId];
  RP.sketch = doc.sketch;
  RP.constructionMeta = doc.constructionMeta;
  RP.groups = doc.groups || (doc.groups = []);
  RP.nextGroupId = doc.nextGroupId || 1;
  RP.currentGroupId = doc.currentGroupId != null ? doc.currentGroupId : null;
  RP.migrateGroups();
  RP.rebuildLines();
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
  // Opening a project always lands you on the mat, whichever document the
  // file was saved from. Reset first so no document survives from the
  // project that was open a moment ago.
  RP.documents = {};
  RP.activeDocId = RP.DOC_MAT;
  if (data && data.sketch) {
    RP.deserializeSketch(data.sketch);
    RP.constructionMeta = JSON.parse(JSON.stringify(data.construction || {}));
    RP.groups = JSON.parse(JSON.stringify(data.groups || []));
    RP.nextGroupId = data.nextGroupId || 1;
    RP.currentGroupId = data.currentGroupId != null ? data.currentGroupId : null;
    for (var gi = 0; gi < RP.groups.length; gi++) {
      RP.nextGroupId = Math.max(RP.nextGroupId, RP.groups[gi].id + 1);
    }
    RP.migrateGroups();
    RP.rebuildLines();
  } else {
    RP.sketchFromLegacyLines((data && data.lines) || []);
  }
  // Absent in any file older than v6, which correctly yields an empty
  // robot rather than a missing one.
  RP.deserializeRobotDoc(data && data.robotDoc);
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
