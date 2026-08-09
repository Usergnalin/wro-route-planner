/* ========================================================================
   route.js - Routes as ORDERED REFERENCES to sketch geometry.

   A route owns no coordinates. It is a list of elements, each naming one
   sketch entity plus what the robot does along it. The sketch is the
   single source of truth for every position.

   Two independent facts are kept separate, where the old model conflated
   them into one XOR:

     flip     - travel p2->p1 instead of p1->p2 along the geometry
     reverse  - the robot drives backwards (chassis orientation)

   REVERSIBILITY RULE (docs/sketch-refactor-plan.md §4): element creation
   is a pure model call taking an entity id, never a mouse event. One-step
   route drawing, if ever wanted, is then just:

       var made = RP.addConstructionLine(...);
       RP.addRouteElement(routeId, made.line.id, opts);

   Nothing in here may reach for event state, and the sketch layer never
   touches route state.
   ======================================================================== */
var RP = window.RP || {};

RP.MOVE_FORWARD         = 'forward';
RP.MOVE_ARC             = 'arc';
RP.MOVE_LINETRACE_DIST  = 'linetrace_dist';
RP.MOVE_LINETRACE_JUNCT = 'linetrace_junct';
RP.MOVE_WALL_ALIGN      = 'wall_align';
RP.MOVE_TELEPORT        = 'teleport';

RP.MOVE_LABELS = {
  forward: 'Forward', arc: 'Arc',
  linetrace_dist: 'Line trace (distance)',
  linetrace_junct: 'Line trace (junctions)',
  wall_align: 'Wall align', teleport: 'Teleport'
};

// Old SEG_MODE_* -> new move type. follow_path is deprecated and collapses
// to a plain forward move; its dense pathPoints never belonged in a model
// where geometry lives in the solver.
RP.MODE_TO_MOVE = {
  normal: 'forward',
  arc: 'arc',
  linetrace_dist: 'linetrace_dist',
  linetrace_junct: 'linetrace_junct',
  wall_align: 'wall_align',
  teleport: 'teleport',
  follow_path: 'forward'
};

RP.nextElementId = 1;

// ---- element CRUD (pure model calls) ---------------------------------
RP.findRoute = function(routeId) {
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id === routeId) return RP.routes[i];
  }
  return null;
};

RP.findElement = function(route, elementId) {
  if (!route || !route.elements) return null;
  for (var i = 0; i < route.elements.length; i++) {
    if (route.elements[i].id === elementId) return route.elements[i];
  }
  return null;
};

// The one function one-step route creation would compose with.
RP.addRouteElement = function(routeId, entityId, opts) {
  var route = RP.findRoute(routeId);
  if (!route) return null;
  var sk = RP.ensureSketch();
  var ent = sk.entities[entityId];
  if (!ent || (ent.type !== 'line' && ent.type !== 'arc')) return null;
  opts = opts || {};

  var el = {
    id: RP.nextElementId++,
    entityId: entityId,
    // An arc entity can only be driven as an arc; a line cannot be.
    move: opts.move || (ent.type === 'arc' ? RP.MOVE_ARC : RP.MOVE_FORWARD),
    flip: !!opts.flip,
    reverse: !!opts.reverse,
    speed: opts.speed != null ? opts.speed : null,
    offset: opts.offset || 0,
    junctions: opts.junctions != null ? opts.junctions : null,
    teleportName: opts.teleportName || null,
    sagitta: opts.sagitta != null ? opts.sagitta : null,  // until phase 8
    turnSpeed: opts.turnSpeed != null ? opts.turnSpeed : null,
    extraTurnsBefore: opts.extraTurnsBefore ? opts.extraTurnsBefore.slice() : [],
    checkpoint: opts.checkpoint || null,
    hidden: !!opts.hidden
  };
  if (!route.elements) route.elements = [];
  if (opts.index != null && opts.index >= 0 && opts.index < route.elements.length) {
    route.elements.splice(opts.index, 0, el);
  } else {
    route.elements.push(el);
  }
  RP.rebuildRouteViews();
  return el;
};

RP.removeRouteElement = function(routeId, elementId) {
  var route = RP.findRoute(routeId);
  if (!route || !route.elements) return false;
  for (var i = 0; i < route.elements.length; i++) {
    if (route.elements[i].id === elementId) {
      route.elements.splice(i, 1);
      RP.rebuildRouteViews();
      return true;
    }
  }
  return false;
};

RP.setRouteElementProps = function(routeId, elementId, props) {
  var el = RP.findElement(RP.findRoute(routeId), elementId);
  if (!el) return false;
  for (var k in props) {
    if (Object.prototype.hasOwnProperty.call(props, k)) el[k] = props[k];
  }
  RP.rebuildRouteViews();
  return true;
};

RP.moveRouteElement = function(routeId, elementId, newIndex) {
  var route = RP.findRoute(routeId);
  if (!route || !route.elements) return false;
  for (var i = 0; i < route.elements.length; i++) {
    if (route.elements[i].id !== elementId) continue;
    var el = route.elements.splice(i, 1)[0];
    newIndex = Math.max(0, Math.min(newIndex, route.elements.length));
    route.elements.splice(newIndex, 0, el);
    RP.rebuildRouteViews();
    return true;
  }
  return false;
};

// Travel-order endpoints: entry first, exit second. Lines and arcs both
// carry p1/p2, so this is the same for either.
RP.elementEndpoints = function(sk, el) {
  var ent = sk.entities[el.entityId];
  if (!ent || (ent.type !== 'line' && ent.type !== 'arc')) return null;
  return el.flip ? { entry: ent.p2, exit: ent.p1 }
                 : { entry: ent.p1, exit: ent.p2 };
};

// Which moves make sense for the geometry an element references.
RP.movesForEntity = function(entityType) {
  return entityType === 'arc'
    ? [RP.MOVE_ARC, RP.MOVE_TELEPORT]
    : [RP.MOVE_FORWARD, RP.MOVE_LINETRACE_DIST, RP.MOVE_LINETRACE_JUNCT,
       RP.MOVE_WALL_ALIGN, RP.MOVE_TELEPORT];
};

// Travel direction along each piece of geometry is a CONSEQUENCE of the
// chain, not a user choice: element N must enter through whichever end
// touches element N-1's exit. So flip is maintained here rather than
// exposed — the only real freedom is which end the whole route starts
// from, which is what reverseRouteDirection() covers.
//
// Disconnected elements are left alone so the resolver can report them
// rather than having their direction silently guessed.
RP.recomputeFlips = function(route) {
  var sk = RP.ensureSketch();
  if (!route || !route.elements || route.elements.length === 0) return;
  var find = RP.Sketch.coincidenceClusters(sk);
  var els = route.elements;

  var firstEnt = sk.entities[els[0].entityId];
  if (!firstEnt) return;

  // Orient the first element so its exit faces the second one.
  if (els.length >= 2) {
    var secondEnt = sk.entities[els[1].entityId];
    if (secondEnt) {
      var touchesSecond = function(pid) {
        var k = find(pid);
        return k === find(secondEnt.p1) || k === find(secondEnt.p2);
      };
      var exit0 = els[0].flip ? firstEnt.p1 : firstEnt.p2;
      var entry0 = els[0].flip ? firstEnt.p2 : firstEnt.p1;
      if (!touchesSecond(exit0) && touchesSecond(entry0)) els[0].flip = !els[0].flip;
    }
  }

  var prevExit = els[0].flip ? firstEnt.p1 : firstEnt.p2;
  for (var i = 1; i < els.length; i++) {
    var ent = sk.entities[els[i].entityId];
    if (!ent) continue;
    var key = find(prevExit);
    if (find(ent.p1) === key) els[i].flip = false;
    else if (find(ent.p2) === key) els[i].flip = true;
    prevExit = els[i].flip ? ent.p1 : ent.p2;
  }
};

// Walk the whole route the other way. Reversing the order and flipping
// every element is exactly the reverse traversal; per-element `reverse`
// (drive tail-first) is deliberately left alone, since that is chosen for
// mechanism reasons and has nothing to do with path direction.
RP.reverseRouteDirection = function(route) {
  if (!route || !route.elements || route.elements.length === 0) return false;
  route.elements.reverse();
  for (var i = 0; i < route.elements.length; i++) {
    route.elements[i].flip = !route.elements[i].flip;
  }
  RP.recomputeFlips(route);
  RP.rebuildRouteViews();
  return true;
};

// ---- derived views ---------------------------------------------------
// route.nodes / route.segments are rebuilt READ-ONLY views so render.js,
// the layer list and the info panels keep working while the UI is
// rehomed in phase 6. Mutating them does nothing; go through the element
// calls above.
//
// Built leniently — a disconnected route still produces drawable
// geometry. Strict continuity is the resolver's job.
RP._suspendRouteViews = false;

RP.rebuildRouteViews = function() {
  if (RP._suspendRouteViews) return;
  var sk = RP.ensureSketch();
  var find = RP.Sketch.coincidenceClusters(sk);

  for (var r = 0; r < RP.routes.length; r++) {
    var route = RP.routes[r];
    if (!route.elements) route.elements = [];
    var nodes = [];
    var segments = [];
    var byCluster = {};

    function nodeFor(pointId, checkpointName) {
      var key = find(pointId);
      var existing = byCluster[key];
      var p = sk.entities[pointId];
      if (!p) return null;
      if (existing) {
        if (checkpointName) {
          existing.isCheckpoint = true;
          existing.checkpointName = checkpointName;
        }
        return existing;
      }
      var n = {
        id: pointId, x: p.x, y: p.y,
        isCheckpoint: !!checkpointName,
        checkpointName: checkpointName || null,
        turnSpeed: null, extraTurns: []
      };
      byCluster[key] = n;
      nodes.push(n);
      return n;
    }

    for (var i = 0; i < route.elements.length; i++) {
      var el = route.elements[i];
      var ends = RP.elementEndpoints(sk, el);
      if (!ends) continue;
      var startCp = (i === 0) ? route.startCheckpoint : null;
      var na = nodeFor(ends.entry, startCp);
      var nb = nodeFor(ends.exit, el.checkpoint);
      if (!na || !nb) continue;
      na.turnSpeed = el.turnSpeed;
      na.extraTurns = el.extraTurnsBefore || [];
      var segEnt = sk.entities[el.entityId];
      segments.push({
        id: el.id,
        fromNodeId: na.id, toNodeId: nb.id,
        elementId: el.id,
        entityId: el.entityId,
        entityType: segEnt ? segEnt.type : 'line',
        flip: !!el.flip,
        mode: el.move === 'forward' ? 'normal' : el.move,
        direction: el.reverse ? 'backward' : 'forward',
        speed: el.speed, offset: el.offset,
        junctionCount: el.junctions,
        teleportName: el.teleportName,
        hidden: el.hidden
      });
    }

    if (nodes.length && route.endExtraTurns && route.endExtraTurns.length) {
      nodes[nodes.length - 1].extraTurns = route.endExtraTurns;
    }
    route.nodes = nodes;
    route.segments = segments;
  }
};

// ---- wall_align as a constraint --------------------------------------
// Replaces the deleted applyWallAlignSnap, which wrote node.x/y directly.
// The stopping point is now CONSTRAINED to stand `clearance` away from a
// real wall, and the solver puts it there.
RP.wallClearanceMm = function(el) {
  return el.reverse ? (RP.robotConfig.rearClearance || 50)
                    : (RP.robotConfig.frontClearance || 50);
};

RP.wallConstraintFor = function(sk, pointId) {
  var cs = RP.Sketch.constraintsOn(sk, pointId);
  for (var i = 0; i < cs.length; i++) {
    if (cs[i].type === 'point_line_distance') return cs[i];
  }
  return null;
};

RP.syncWallAlignConstraint = function(route, el) {
  var sk = RP.ensureSketch();
  var ends = RP.elementEndpoints(sk, el);
  if (!ends) return null;
  var exitId = ends.exit;
  var existing = RP.wallConstraintFor(sk, exitId);

  if (el.move !== RP.MOVE_WALL_ALIGN) {
    if (existing) RP.Sketch.removeConstraint(sk, existing.id);
    return null;
  }

  // Which wall: keep the one already chosen, else honour an explicit
  // point_on_line the user drew against a wall, else the nearest wall.
  var wallId = existing ? existing.refs[1] : null;
  if (!wallId) {
    var fieldIds = RP.fieldLineIds();
    var onWall = RP.Sketch.constraintsOn(sk, exitId).filter(function(c) {
      return c.type === 'point_on_line' && fieldIds.indexOf(c.refs[1]) >= 0;
    });
    if (onWall.length) {
      wallId = onWall[0].refs[1];
      // Sitting ON the wall contradicts standing off it by clearance.
      for (var i = 0; i < onWall.length; i++) RP.Sketch.removeConstraint(sk, onWall[i].id);
    } else {
      wallId = RP.nearestFieldLine(exitId);
    }
  }
  if (!wallId) return null;

  var ppm = RP.calibration ? RP.calibration.pixelsPerMm : 1;
  var clearPx = RP.wallClearanceMm(el) * ppm;
  // Signed, so the point stays on the side of the wall it is already on.
  var signed = RP.Sketch.perpDistance(sk, exitId, wallId);
  var target = (signed !== null && signed < 0) ? -clearPx : clearPx;

  if (existing) {
    existing.refs[1] = wallId;
    existing.value = target;
    return existing;
  }
  return RP.Sketch.addConstraint(sk, 'point_line_distance', [exitId, wallId], target);
};

RP.syncAllWallAligns = function() {
  var route = RP.getActiveRoute();
  if (!route || !route.elements) return 0;
  var n = 0;
  for (var i = 0; i < route.elements.length; i++) {
    if (RP.syncWallAlignConstraint(route, route.elements[i])) n++;
  }
  if (RP.solveSketch) RP.solveSketch();
  RP.rebuildRouteViews();
  return n;
};

// ---- serialization ---------------------------------------------------
// nodes/segments are derived views and are never persisted.
RP.serializeRoutes = function() {
  var out = JSON.parse(JSON.stringify(RP.routes || []));
  for (var i = 0; i < out.length; i++) {
    delete out[i].nodes;
    delete out[i].segments;
  }
  return out;
};

// ---- migration from the node/segment model ---------------------------
// Converts each old route into geometry + elements. Element ORDER comes
// from the old longest-path walk, so generated code is unchanged; nodes
// off that path are dropped, which is exactly what codegen already did.
function segBetweenIn(segs, id1, id2) {
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    if ((s.fromNodeId === id1 && s.toNodeId === id2) ||
        (s.fromNodeId === id2 && s.toNodeId === id1)) return s;
  }
  return null;
}

RP.migrateRoutesToElements = function() {
  var sk = RP.ensureSketch();
  var migrated = 0;

  // Adding elements rebuilds route.nodes/segments, which are the very
  // structures being read here — snapshot them and defer rebuilds.
  RP._suspendRouteViews = true;

  for (var r = 0; r < RP.routes.length; r++) {
    var route = RP.routes[r];
    if (route.elements) continue;             // already new-model
    if (!route.nodes || !route.segments) { route.elements = []; continue; }

    var path = RP.computeLongestPath(route);
    var oldSegments = route.segments.slice();
    route.elements = [];
    route.startCheckpoint = null;
    route.endExtraTurns = [];

    if (!path || path.length < 2) {
      delete route.nodes; delete route.segments;
      continue;
    }

    if (path[0].isCheckpoint && path[0].checkpointName) {
      route.startCheckpoint = path[0].checkpointName;
    }

    var prevExitPoint = null;
    for (var i = 0; i < path.length - 1; i++) {
      var a = path[i], b = path[i + 1];
      var seg = segBetweenIn(oldSegments, a.id, b.id);
      if (!seg) continue;

      // Geometry is created in the segment's STORED order, with flip
      // carrying the traversal direction. Arc sagitta is signed relative
      // to the stored p1->p2 orientation, so preserving that order avoids
      // having to reason about mirroring it.
      var storedForward = (seg.fromNodeId === a.id);
      var n1 = storedForward ? a : b;
      var n2 = storedForward ? b : a;
      var p1 = RP.Sketch.addPoint(sk, n1.x, n1.y);
      var p2 = RP.Sketch.addPoint(sk, n2.x, n2.y);

      // Old arcs were a chord plus a `sagitta` bulge. Convert them into
      // REAL arc entities so the solver owns their geometry too; the
      // sagitta representation dies with this migration.
      var oldMode = seg.mode || 'normal';
      var arcGeom = (oldMode === 'arc' && seg.sagitta && RP.computeArcGeom)
        ? RP.computeArcGeom(n1.x, n1.y, n2.x, n2.y, seg.sagitta)
        : null;

      var line;
      if (arcGeom) {
        var pc = RP.Sketch.addPoint(sk, arcGeom.cx, arcGeom.cy);
        line = RP.Sketch.addArc(sk, pc.id, p1.id, p2.id, arcGeom.sweepRad > 0);
      } else {
        line = RP.Sketch.addLine(sk, p1.id, p2.id);
      }
      RP.constructionMeta[line.id] = {
        label: null, visible: true, role: 'route'
      };

      // Fresh points per element joined by a coincident constraint — the
      // same convention addConstructionLine uses, and it keeps joints
      // detachable by deleting the constraint.
      var entryPoint = storedForward ? p1.id : p2.id;
      var exitPoint  = storedForward ? p2.id : p1.id;
      if (prevExitPoint !== null) {
        RP.Sketch.addConstraint(sk, 'coincident', [prevExitPoint, entryPoint]);
      }
      prevExitPoint = exitPoint;

      var mode = oldMode;
      RP.addRouteElement(route.id, line.id, {
        move: RP.MODE_TO_MOVE[mode] || 'forward',
        flip: !storedForward,
        // Old effectiveBackward was (direction XOR traversal); with flip
        // now carrying traversal, reverse holds the chassis orientation.
        reverse: (seg.direction === 'backward') !== (!storedForward),
        speed: seg.speed, offset: seg.offset,
        junctions: seg.junctionCount,
        teleportName: seg.teleportName,
        turnSpeed: a.turnSpeed,
        extraTurnsBefore: a.extraTurns || [],
        checkpoint: (b.isCheckpoint && b.checkpointName) ? b.checkpointName : null,
        hidden: seg.hidden
      });
    }

    var last = path[path.length - 1];
    route.endExtraTurns = (last && last.extraTurns) ? last.extraTurns.slice() : [];
    migrated++;
  }

  RP._suspendRouteViews = false;
  // Migration creates geometry, so the geometry views need rebuilding too —
  // not just the route views.
  RP.rebuildLines();
  RP.rebuildRouteViews();
  return migrated;
};
