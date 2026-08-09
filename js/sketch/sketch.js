/* ========================================================================
   sketch.js - Geometry container: entities + constraints.

   This layer knows nothing about construction lines, routes, robots or
   code generation. Its entire vocabulary is points, lines, arcs and the
   constraints between them. Higher layers tag entity ids with meaning.

   Only POINTS carry parameters (x, y). Lines and arcs are pure topology
   over point ids — that is what makes an arc endpoint constrainable
   against a line endpoint.
   ======================================================================== */
var RP = window.RP || {};

RP.Sketch = RP.Sketch || {};

RP.Sketch.create = function(opts) {
  return {
    entities: {},
    constraints: {},
    nextEntityId: 1,
    nextConstraintId: 1,
    // Characteristic length in px, used to weight angle equations against
    // positional ones so the Jacobian stays well conditioned.
    charLength: (opts && opts.charLength) || 100,
    // Populated by solve()
    status: 'empty',
    dof: 0,
    rank: 0,
    residual: 0
  };
};

// ---- ids -------------------------------------------------------------
// Integer-like object keys iterate in ascending numeric order per spec, so
// these are deterministic without a separate ordering array.
RP.Sketch.entityIds = function(sk) {
  return Object.keys(sk.entities).map(Number);
};
RP.Sketch.constraintIds = function(sk) {
  return Object.keys(sk.constraints).map(Number);
};
RP.Sketch.get = function(sk, id) {
  return sk.entities[id] || null;
};

// ---- entity creation -------------------------------------------------
RP.Sketch.addPoint = function(sk, x, y) {
  var e = { id: sk.nextEntityId++, type: 'point', x: x, y: y };
  sk.entities[e.id] = e;
  return e;
};

RP.Sketch.addLine = function(sk, p1Id, p2Id) {
  if (!sk.entities[p1Id] || !sk.entities[p2Id]) throw new Error('addLine: unknown point');
  var e = { id: sk.nextEntityId++, type: 'line', p1: p1Id, p2: p2Id };
  sk.entities[e.id] = e;
  return e;
};

// Arc as centre + two endpoints. Radius is derived, not stored, so there
// is no redundant parameter; the equal-radius condition is contributed as
// an internal equation (see entityDefs.arc).
RP.Sketch.addArc = function(sk, centerId, p1Id, p2Id, ccw) {
  if (!sk.entities[centerId] || !sk.entities[p1Id] || !sk.entities[p2Id]) {
    throw new Error('addArc: unknown point');
  }
  var e = {
    id: sk.nextEntityId++, type: 'arc',
    center: centerId, p1: p1Id, p2: p2Id, ccw: !!ccw
  };
  sk.entities[e.id] = e;
  return e;
};

// Convenience: create both endpoints and the line in one call.
RP.Sketch.addLineXY = function(sk, x1, y1, x2, y2) {
  var a = RP.Sketch.addPoint(sk, x1, y1);
  var b = RP.Sketch.addPoint(sk, x2, y2);
  var line = RP.Sketch.addLine(sk, a.id, b.id);
  return { line: line, p1: a, p2: b };
};

// ---- topology --------------------------------------------------------
// Point ids an entity is built from (empty for a point itself).
RP.Sketch.pointsOf = function(sk, entityId) {
  var e = sk.entities[entityId];
  if (!e) return [];
  if (e.type === 'line') return [e.p1, e.p2];
  if (e.type === 'arc') return [e.center, e.p1, e.p2];
  return [];
};

RP.Sketch.referencesEntity = function(e, targetId) {
  if (e.type === 'line') return e.p1 === targetId || e.p2 === targetId;
  if (e.type === 'arc') return e.center === targetId || e.p1 === targetId || e.p2 === targetId;
  return false;
};

// Remove an entity, everything built on it, and every constraint touching
// any of them.
RP.Sketch.removeEntity = function(sk, id) {
  var doomed = {};
  var ids = RP.Sketch.entityIds(sk);

  function mark(eid) {
    if (doomed[eid]) return;
    doomed[eid] = true;
    for (var i = 0; i < ids.length; i++) {
      var e = sk.entities[ids[i]];
      if (e && !doomed[e.id] && RP.Sketch.referencesEntity(e, eid)) mark(e.id);
    }
  }
  mark(id);

  var cids = RP.Sketch.constraintIds(sk);
  for (var i = 0; i < cids.length; i++) {
    var c = sk.constraints[cids[i]];
    for (var j = 0; j < c.refs.length; j++) {
      if (doomed[c.refs[j]]) { delete sk.constraints[c.id]; break; }
    }
  }
  for (var k in doomed) if (doomed[k]) delete sk.entities[k];
  return Object.keys(doomed).map(Number);
};

// ---- constraints -----------------------------------------------------
RP.Sketch.addConstraint = function(sk, type, refs, value) {
  var def = RP.Sketch.constraintDefs[type];
  if (!def) throw new Error('addConstraint: unknown type "' + type + '"');

  var entities = [];
  for (var i = 0; i < refs.length; i++) {
    var e = sk.entities[refs[i]];
    if (!e) throw new Error('addConstraint: unknown entity ' + refs[i]);
    entities.push(e);
  }
  if (def.accepts && !def.accepts(entities)) {
    throw new Error(
      'addConstraint: "' + type + '" does not accept [' +
      entities.map(function(e) { return e.type; }).join(', ') + ']'
    );
  }

  var c = { id: sk.nextConstraintId++, type: type, refs: refs.slice() };
  if (def.hasValue) c.value = value;
  if (def.init) def.init(c, sk, entities);
  sk.constraints[c.id] = c;
  return c;
};

RP.Sketch.removeConstraint = function(sk, id) {
  var existed = !!sk.constraints[id];
  delete sk.constraints[id];
  return existed;
};

// Constraints referencing a given entity — for the UI's per-entity list.
RP.Sketch.constraintsOn = function(sk, entityId) {
  var out = [];
  var cids = RP.Sketch.constraintIds(sk);
  for (var i = 0; i < cids.length; i++) {
    var c = sk.constraints[cids[i]];
    if (c.refs.indexOf(entityId) >= 0) out.push(c);
  }
  return out;
};

// ---- parameter index -------------------------------------------------
// Maps each free point to a base column: x at base, y at base+1. Points in
// fixedSet are excluded from the free set and read as constants (this is
// how dragging pins the point under the cursor).
RP.Sketch.buildIndex = function(sk, fixedSet) {
  var index = {};
  var pids = [];
  var ids = RP.Sketch.entityIds(sk);
  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    var e = sk.entities[ids[i]];
    if (!e || e.type !== 'point') continue;
    if (fixedSet && fixedSet[e.id]) continue;
    index[e.id] = n;
    pids.push(e.id);
    n += 2;
  }
  return { index: index, pids: pids, n: n };
};

// Accessor bundle handed to residual/jacobian functions. Reads a free
// point's value from the working parameter vector and a pinned point's
// straight off the entity; column index is -1 for pinned points, which the
// Jacobian writer treats as "no derivative".
RP.Sketch.makeAccess = function(sk, idx, params) {
  var index = idx.index;
  var ents = sk.entities;
  return {
    sk: sk,
    px: function(pid) { var b = index[pid]; return b === undefined ? ents[pid].x : params[b]; },
    py: function(pid) { var b = index[pid]; return b === undefined ? ents[pid].y : params[b + 1]; },
    cx: function(pid) { var b = index[pid]; return b === undefined ? -1 : b; },
    cy: function(pid) { var b = index[pid]; return b === undefined ? -1 : b + 1; },
    ent: function(eid) { return ents[eid]; }
  };
};

// Resolved arc geometry. `ccw` picks which of the two possible sweeps
// between the endpoints is meant, matching the convention the old
// sagitta-based geometry used (positive sweep = increasing angle).
RP.Sketch.arcGeometry = function(sk, arc) {
  if (!arc || arc.type !== 'arc') return null;
  var c = sk.entities[arc.center], p1 = sk.entities[arc.p1], p2 = sk.entities[arc.p2];
  if (!c || !p1 || !p2) return null;
  var r = Math.hypot(p1.x - c.x, p1.y - c.y);
  if (r < 1e-9) return null;
  var a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
  var a1 = Math.atan2(p2.y - c.y, p2.x - c.x);
  var TAU = Math.PI * 2;
  var d = ((a1 - a0) % TAU + TAU) % TAU;   // (0, 2pi)
  return {
    cx: c.x, cy: c.y, radius: r,
    a0: a0, a1: a1,
    sweep: arc.ccw ? d : d - TAU
  };
};

// Polyline along the arc, endpoints pinned exactly.
RP.Sketch.arcPoints = function(sk, arc, steps) {
  var g = RP.Sketch.arcGeometry(sk, arc);
  if (!g) return [];
  steps = Math.max(2, steps | 0);
  var pts = [];
  for (var i = 0; i <= steps; i++) {
    var ang = g.a0 + g.sweep * (i / steps);
    pts.push({ x: g.cx + g.radius * Math.cos(ang), y: g.cy + g.radius * Math.sin(ang) });
  }
  var p1 = sk.entities[arc.p1], p2 = sk.entities[arc.p2];
  pts[0] = { x: p1.x, y: p1.y };
  pts[pts.length - 1] = { x: p2.x, y: p2.y };
  return pts;
};

// Union-find over `coincident` constraints: two points are "the same
// place" if they are the same entity or sit in the same coincident
// cluster. This is how route continuity is checked without comparing
// coordinates against a tolerance.
//
// Returns a find(pointId) -> clusterRepresentative function.
RP.Sketch.coincidenceClusters = function(sk) {
  var parent = {};
  function find(x) {
    if (parent[x] === undefined) { parent[x] = x; return x; }
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) {
    var ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  var cids = RP.Sketch.constraintIds(sk);
  for (var i = 0; i < cids.length; i++) {
    var c = sk.constraints[cids[i]];
    if (c.type === 'coincident') union(c.refs[0], c.refs[1]);
  }
  return find;
};

// Write solved parameters back onto the point entities.
RP.Sketch.writeBack = function(sk, idx, params) {
  for (var i = 0; i < idx.pids.length; i++) {
    var pid = idx.pids[i];
    var base = idx.index[pid];
    var e = sk.entities[pid];
    e.x = params[base];
    e.y = params[base + 1];
  }
};
