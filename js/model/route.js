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
       RP.addMove(routeId, made.line.id, opts);

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

// Display names only. The KEYS are the stored move types and appear in
// save files, generated code and RP.STEP_KIND_SPEED_KEYS, so `forward`
// stays `forward` on disk however it is labelled here — a straight is
// driven in either direction, so "Straight" is what it is, and "Forwards
// / Backwards" is the separate Drive toggle's job to say.
RP.MOVE_LABELS = {
  forward: 'Straight', arc: 'Arc',
  linetrace_dist: 'Line trace (dist)',
  linetrace_junct: 'Line trace (junct)',
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

RP.nextActionId = 1;

// ---- element CRUD (pure model calls) ---------------------------------
RP.findRoute = function(routeId) {
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id === routeId) return RP.routes[i];
  }
  return null;
};

RP.findMove = function(route, moveId) {
  var moves = RP.moveActions(route);
  for (var i = 0; i < moves.length; i++) {
    if (moves[i].id === moveId) return moves[i];
  }
  return null;
};

// The one function one-step route creation would compose with.
//
// "Element" is the move action, seen through the compat view below. The
// two names will merge when the UI speaks actions directly.
RP.addMove = function(routeId, entityId, opts) {
  var route = RP.findRoute(routeId);
  if (!route) return null;
  var sk = RP.ensureSketch();
  var ent = sk.entities[entityId];
  if (!ent || (ent.type !== 'line' && ent.type !== 'arc')) return null;
  opts = opts || {};

  var el = RP.makeMoveAction(entityId, ent.type, opts);
  var acts = RP.routeActions(route);

  // opts.index counts moves, not actions: land in front of the index-th
  // move's turn group so the new move inherits that slot in the walk.
  var at = acts.length;
  if (opts.index != null && opts.index >= 0) {
    var moves = RP.moveActions(route);
    if (opts.index < moves.length) {
      var group = RP.actionGroupFor(route, moves[opts.index].id);
      if (group) at = group.start;
    }
  }
  acts.splice(at, 0, el);
  RP.rebuildRouteViews();
  return el;
};

RP.removeMove = function(routeId, elementId) {
  var route = RP.findRoute(routeId);
  if (!route) return false;
  var acts = RP.routeActions(route);
  var at = RP.actionIndex(route, elementId);
  if (at < 0 || !RP.isMoveAction(acts[at])) return false;
  acts.splice(at, 1);
  // The move's auto turn goes with it (sync drops orphans). Fixed turns
  // that were queued in front of it survive and attach to the next move.
  RP.rebuildRouteViews();
  return true;
};

RP.setMoveProps = function(routeId, elementId, props) {
  var el = RP.findMove(RP.findRoute(routeId), elementId);
  if (!el) return false;
  for (var k in props) {
    if (Object.prototype.hasOwnProperty.call(props, k)) el[k] = props[k];
  }
  RP.rebuildRouteViews();
  return true;
};

RP.reorderMove = function(routeId, elementId, newIndex) {
  var route = RP.findRoute(routeId);
  if (!route) return false;
  var moves = RP.moveActions(route);
  var from = -1;
  for (var i = 0; i < moves.length; i++) if (moves[i].id === elementId) { from = i; break; }
  if (from < 0) return false;
  newIndex = Math.max(0, Math.min(newIndex, moves.length - 1));
  if (newIndex === from) return true;

  // Move the whole turn group, or the junction's speed and style are left
  // behind attached to whatever move slides into the vacated slot.
  var group = RP.actionGroupFor(route, elementId);
  if (!group) return false;
  var acts = RP.routeActions(route);
  acts.splice(group.start, group.items.length);

  var target = RP.actionGroupFor(route, moves[newIndex].id);
  var at = target ? (newIndex > from ? target.end + 1 : target.start) : acts.length;
  Array.prototype.splice.apply(acts, [at, 0].concat(group.items));
  RP.rebuildRouteViews();
  return true;
};

// Where a newly-picked piece of geometry belongs in the route.
//
// Appending blindly is right only while you are drawing the route in
// order. Editing one — which is what a surprise mission actually is —
// means dropping a leg into the middle, and an appended move there is
// always disconnected, so every insertion had to be fixed by hand.
//
// Returns { index, flip, joins }, where `index` counts MOVES (exactly
// what addMove's own opts.index wants) and `joins` is how many of the two
// neighbouring junctions the geometry actually meets:
//
//   2  it bridges a gap exactly — both the move before and the move after
//      connect to it. This is the case that used to be impossible.
//   1  it extends a chain at one end, including plain appending.
//   0  nothing touches; the route will be reported broken, as before.
//
// Ties go to the LATEST slot, so drawing a route in order still appends —
// that flow is by far the most common and must not regress.
RP.bestInsertionFor = function(route, entityId) {
  var sk = RP.ensureSketch();
  var ent = sk.entities[entityId];
  var moves = route ? RP.moveActions(route) : [];
  if (!ent || (ent.type !== 'line' && ent.type !== 'arc')) {
    return { index: moves.length, flip: false, joins: 0 };
  }
  if (!moves.length) return { index: 0, flip: false, joins: 0 };

  var find = RP.Sketch.coincidenceClusters(sk);
  var best = { index: moves.length, flip: false, joins: -1 };

  // Descending, and unflipped before flipped, so a strict > keeps the
  // latest slot and the unflipped direction when scores tie.
  for (var i = moves.length; i >= 0; i--) {
    for (var f = 0; f < 2; f++) {
      var flip = (f === 1);
      var entry = flip ? ent.p2 : ent.p1;
      var exit  = flip ? ent.p1 : ent.p2;
      var joins = 0;
      if (i > 0) {
        var prev = RP.moveEndpoints(sk, moves[i - 1]);
        if (prev && find(prev.exit) === find(entry)) joins++;
      }
      if (i < moves.length) {
        var next = RP.moveEndpoints(sk, moves[i]);
        if (next && find(next.entry) === find(exit)) joins++;
      }
      if (joins > best.joins) best = { index: i, flip: flip, joins: joins };
    }
  }
  return best;
};

// How long a move's geometry is, in mm — straight for lines, along the
// curve for arcs. Null when there is nothing to measure against.
RP.moveLengthMm = function(el) {
  var sk = RP.ensureSketch();
  if (!el || !RP.calibration || !RP.calibration.pixelsPerMm) return null;
  var ent = sk.entities[el.entityId];
  if (!ent) return null;
  var ppm = RP.calibration.pixelsPerMm;
  if (ent.type === 'arc') {
    var g = RP.Sketch.arcGeometry(sk, ent);
    return g ? Math.abs(g.sweep) * g.radius / ppm : null;
  }
  var a = sk.entities[ent.p1], b = sk.entities[ent.p2];
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y) / ppm;
};

// Travel-order endpoints: entry first, exit second. Lines and arcs both
// carry p1/p2, so this is the same for either.
RP.moveEndpoints = function(sk, el) {
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
  if (!route) return;
  var els = RP.moveActions(route);
  if (els.length === 0) return;
  var find = RP.Sketch.coincidenceClusters(sk);

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
  if (!route || RP.moveActions(route).length === 0) return false;
  // Reversing the whole action list is what makes turns come out right: a
  // fixed turn queued BEFORE a move going one way is a turn AFTER that
  // same move coming back, and it swings the opposite way, hence the
  // negated angle. Auto turns are dropped and re-derived by sync, which
  // matches them back to their junctions by coincidence cluster.
  var acts = RP.routeActions(route);
  acts.reverse();
  for (var i = 0; i < acts.length; i++) {
    var a = acts[i];
    if (RP.isMoveAction(a)) a.flip = !a.flip;
    else if (RP.isTurnAction(a) && a.angle != null) {
      // Typed angles swing the other way when the route is walked
      // backwards; derived ones re-derive and need no help.
      a.angle = -a.angle;
    }
  }
  RP.recomputeFlips(route);
  RP.rebuildRouteViews();
  return true;
};

// ---- derived views ---------------------------------------------------
// route.nodes / route.segments are rebuilt READ-ONLY views so render.js
// and the info panels keep working. Mutating them does nothing; go
// through the action calls.
//
// Built leniently — a disconnected route still produces drawable
// geometry. Strict continuity is the resolver's job.
RP._suspendRouteViews = false;

// Small helper so the view builder reads cleanly and a missing segment
// (an action not in any, which should not happen) fails OPEN rather than
// hiding work.
RP.segmentVisibleFor = function(segIndex, actionId) {
  var seg = segIndex && segIndex[actionId];
  return !seg || seg.visible !== false;
};

RP.rebuildRouteViews = function() {
  if (RP._suspendRouteViews) return;
  var sk = RP.ensureSketch();
  var find = RP.Sketch.coincidenceClusters(sk);

  for (var r = 0; r < RP.routes.length; r++) {
    var route = RP.routes[r];
    // The auto-turn layer is an invariant of the action list, so it is
    // re-established here rather than at every call site that can
    // disturb it. syncTurnActions is idempotent.
    if (RP.syncTurnActions) RP.syncTurnActions(route);
    var segIndex = RP.segmentIndex ? RP.segmentIndex(route) : {};
    var moves = RP.moveActions(route);
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

    // Turn parameters live on turn actions now, but render.js still draws
    // them off the node view, so fold each move's preceding turn run back
    // onto its entry node.
    var turnsBefore = {}, cpBefore = {}, cpAfter = {}, trailingTurns = [];
    var run = [], cpRun = [], lastMoveId = null;
    var acts = RP.routeActions(route);
    for (var t = 0; t < acts.length; t++) {
      if (RP.isTurnAction(acts[t])) { run.push(acts[t]); continue; }
      if (RP.isCheckpointAction(acts[t])) { cpRun.push(acts[t]); continue; }
      if (RP.isMoveAction(acts[t])) {
        // A checkpoint sitting between two moves fires on arrival at the
        // shared point, so it reads as "after" the earlier one.
        if (lastMoveId !== null) cpAfter[lastMoveId] = cpRun;
        else cpBefore[acts[t].id] = cpRun;
        cpRun = [];
        turnsBefore[acts[t].id] = run;
        run = [];
        lastMoveId = acts[t].id;
      }
    }
    trailingTurns = run;
    if (lastMoveId !== null && cpRun.length) {
      cpAfter[lastMoveId] = (cpAfter[lastMoveId] || []).concat(cpRun);
    }

    function cpName(list) {
      return (list && list.length) ? list[list.length - 1].name : null;
    }

    for (var i = 0; i < moves.length; i++) {
      var el = moves[i];
      var ends = RP.moveEndpoints(sk, el);
      if (!ends) continue;
      var na = nodeFor(ends.entry, cpName(cpBefore[el.id]));
      var nb = nodeFor(ends.exit, cpName(cpAfter[el.id]));
      if (!na || !nb) continue;
      var pre = turnsBefore[el.id] || [];
      na.turnSpeed = null;
      na.extraTurns = [];
      for (var p = 0; p < pre.length; p++) {
        if (pre[p].angleMode === RP.TURN_AUTO) na.turnSpeed = pre[p].speed;
        else na.extraTurns.push({ deg: pre[p].angle || 0, speed: pre[p].speed });
      }
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
        // Effective visibility: the move's own switch AND its segment's.
        // Every consumer — render, hit testing, the referenced-entity set —
        // reads this one field, so hiding a segment hides its moves
        // everywhere without any of them knowing segments exist. The
        // move's own flag is left untouched, so un-hiding the segment
        // restores exactly what the user had.
        visible: el.visible !== false && RP.segmentVisibleFor(segIndex, el.id)
      });
    }

    if (nodes.length && trailingTurns.length) {
      var tail = [];
      for (var q = 0; q < trailingTurns.length; q++) {
        if (trailingTurns[q].angleMode === RP.TURN_FIXED) {
          tail.push({ deg: trailingTurns[q].angle || 0, speed: trailingTurns[q].speed });
        }
      }
      nodes[nodes.length - 1].extraTurns = tail;
    }
    route.nodes = nodes;
    route.segments = segments;
  }
};

// ---- wall_align as a constraint --------------------------------------
// Replaces the deleted applyWallAlignSnap, which wrote node.x/y directly.
// The stopping point is now CONSTRAINED to stand `clearance` away from a
// real wall, and the solver puts it there.
// How far the robot's body stands off a wall when it aligns against it.
//
// Derived from the drawn body when there is one: this distance IS the
// overhang from the turning centre to whichever end leads, so with a
// robot document open there is nothing for a human to type, and the two
// numbers can no longer disagree with the drawing they describe. The
// manual fields stay as the fallback for projects with no robot drawn.
RP.wallClearanceMm = function(el) {
  var ext = RP.robotExtentsMm ? RP.robotExtentsMm() : null;
  if (ext) return el.reverse ? ext.rear : ext.front;
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
  var ends = RP.moveEndpoints(sk, el);
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
  if (!route) return 0;
  var moves = RP.moveActions(route);
  var n = 0;
  for (var i = 0; i < moves.length; i++) {
    if (RP.syncWallAlignConstraint(route, moves[i])) n++;
  }
  if (RP.solveSketch) RP.solveSketch();
  RP.rebuildRouteViews();
  return n;
};

// ---- serialization ---------------------------------------------------
// nodes/segments are derived views and are never persisted — actions are
// the source of truth. `elements` is deleted defensively: it is the v4
// field name, and a route loaded from such a file carries it until the
// lift runs.
RP.serializeRoutes = function() {
  var out = JSON.parse(JSON.stringify(RP.routes || []));
  for (var i = 0; i < out.length; i++) {
    delete out[i].nodes;
    delete out[i].segments;
    delete out[i].elements;
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

// v4 (elements) -> v5 (actions). `el.turnSpeed` meant "speed of the turn
// BEFORE this element" and `el.extraTurnsBefore` were turns queued in
// front of it, so both become turn actions sitting where they always
// conceptually were. Emission order is unchanged: extras first, then the
// geometric turn, then the move.
RP.liftElementsToActions = function(route) {
  var acts = [];
  var els = route.elements || [];
  // The one checkpoint with no move in front of it needed its own field;
  // as an action it is just the first entry in the list.
  if (route.startCheckpoint) acts.push(RP.makeCheckpointAction(null, route.startCheckpoint));
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var extras = el.extraTurnsBefore || [];
    for (var x = 0; x < extras.length; x++) {
      acts.push(RP.makeTurnAction(null, {
        angleMode: RP.TURN_FIXED,
        angle: RP.extraTurnDeg(extras[x]),
        speed: RP.extraTurnSpeed(extras[x])
      }));
    }
    acts.push(RP.makeTurnAction(null, { speed: el.turnSpeed }));
    var cpName = el.checkpoint;
    el.type = RP.ACTION_MOVE;
    delete el.turnSpeed;
    delete el.extraTurnsBefore;
    delete el.checkpoint;
    delete el.sagitta;          // arcs became real entities in phase 8
    // v4 called this `hidden` and it was never actually settable from the
    // UI, so it is realistically always false — but translate it
    // correctly regardless, rather than assume.
    el.visible = el.hidden !== true;
    delete el.hidden;
    acts.push(el);
    if (cpName) acts.push(RP.makeCheckpointAction(null, cpName));
  }
  var tail = route.endExtraTurns || [];
  for (var t = 0; t < tail.length; t++) {
    acts.push(RP.makeTurnAction(null, {
      angleMode: RP.TURN_FIXED,
      angle: RP.extraTurnDeg(tail[t]),
      speed: RP.extraTurnSpeed(tail[t])
    }));
  }
  delete route.endExtraTurns;
  delete route.startCheckpoint;
  route.actions = acts;
};

RP.migrateRoutesToActions = function() {
  var sk = RP.ensureSketch();
  var migrated = 0;

  // Adding actions rebuilds route.nodes/segments, which are the very
  // structures being read here — snapshot them and defer rebuilds.
  RP._suspendRouteViews = true;

  for (var r = 0; r < RP.routes.length; r++) {
    var route = RP.routes[r];
    if (route.actions) continue;              // already new-model
    // v4 saves stored `elements`, where turn data rode along on the move
    // that followed the turn. With the compat view gone, the presence of
    // that field now unambiguously means "this came out of a v4 file".
    if (route.elements) { RP.liftElementsToActions(route); migrated++; continue; }
    if (!route.nodes || !route.segments) { route.actions = []; continue; }

    var path = RP.computeLongestPath(route);
    var oldSegments = route.segments.slice();
    route.actions = [];

    if (!path || path.length < 2) {
      delete route.nodes; delete route.segments;
      continue;
    }

    if (path[0].isCheckpoint && path[0].checkpointName) {
      route.actions.push(RP.makeCheckpointAction(null, path[0].checkpointName));
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

      // Node-level turn data becomes turn ACTIONS in front of the move.
      // Extra turns first, then the geometric turn, which is the order
      // the old codegen emitted them in.
      var aExtras = a.extraTurns || [];
      for (var xi = 0; xi < aExtras.length; xi++) {
        route.actions.push(RP.makeTurnAction(entryPoint, {
          angleMode: RP.TURN_FIXED,
          angle: RP.extraTurnDeg(aExtras[xi]),
          speed: RP.extraTurnSpeed(aExtras[xi])
        }));
      }
      route.actions.push(RP.makeTurnAction(entryPoint, { speed: a.turnSpeed }));

      var mode = oldMode;
      RP.addMove(route.id, line.id, {
        move: RP.MODE_TO_MOVE[mode] || 'forward',
        flip: !storedForward,
        // Old effectiveBackward was (direction XOR traversal); with flip
        // now carrying traversal, reverse holds the chassis orientation.
        reverse: (seg.direction === 'backward') !== (!storedForward),
        speed: seg.speed, offset: seg.offset,
        junctions: seg.junctionCount,
        teleportName: seg.teleportName,
        // Old segments never actually carried this — the UI that set it
        // was deleted before phase 9 — but translate it correctly on the
        // rare save file where it does.
        visible: seg.hidden !== true
      });
      if (b.isCheckpoint && b.checkpointName) {
        route.actions.push(RP.makeCheckpointAction(exitPoint, b.checkpointName));
      }
    }

    // Turns hanging off the final node become trailing fixed turns.
    var last = path[path.length - 1];
    var lastExtras = (last && last.extraTurns) ? last.extraTurns : [];
    for (var li = 0; li < lastExtras.length; li++) {
      route.actions.push(RP.makeTurnAction(prevExitPoint, {
        angleMode: RP.TURN_FIXED,
        angle: RP.extraTurnDeg(lastExtras[li]),
        speed: RP.extraTurnSpeed(lastExtras[li])
      }));
    }
    migrated++;
  }

  RP._suspendRouteViews = false;
  // Migration creates geometry, so the geometry views need rebuilding too —
  // not just the route views.
  RP.rebuildLines();
  RP.rebuildRouteViews();
  return migrated;
};
