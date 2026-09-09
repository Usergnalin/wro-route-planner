/* ========================================================================
   action.js - A route is an ordered list of ACTIONS.

   The old model was `1 geometry entity = 1 move`, and turns did not exist
   as objects at all — codegen inferred them from consecutive headings and
   billed them to whichever element came next (`el.turnSpeed` meant "the
   speed of the turn BEFORE this line"). That is why turns were not
   selectable and not configurable.

   Now:

     move  →  references a LINE or ARC.  Distance, radius and headings are
              derived from the sketch; the action carries what the robot
              does along it.
     turn  →  references a POINT.        The angle is derived from the
              headings either side of that point; the action carries
              speed, style and an optional fixed-angle override.

   The sketch still owns every coordinate (docs/sketch-refactor-plan.md
   §1). An action never stores a position — only a reference and the
   parameters that cannot be derived from geometry.

   INVARIANT, maintained by syncTurnActions(): exactly one `auto` turn
   sits immediately before every move. It is created and destroyed with
   its move and is never user-inserted. `fixed` turns are user-owned,
   may appear anywhere, and sync never touches them.

   The leading auto turn (before the first move) looks redundant but is
   not: when a start position is set, it is the turn from the robot's
   start heading onto the first leg. With no start position it resolves
   to nothing, exactly as before.
   ======================================================================== */
var RP = window.RP || {};

RP.ACTION_MOVE = 'move';
RP.ACTION_TURN = 'turn';
RP.ACTION_CHECKPOINT = 'checkpoint';
// A boundary marker, not a span. A segment runs from its marker until the
// next one, so segments are DERIVED from marker positions exactly as
// nodes and turns are derived — boundaries then move with edits for free,
// where a stored {startAction, endAction} pair would need mending every
// time an action was inserted or removed.
RP.ACTION_SEGMENT = 'segment';

// angleMode is OWNERSHIP, not "where the angle comes from":
//   auto  - the junction turn the invariant maintains for a move
//   fixed - a standalone turn the user inserted
// The angle itself is `angle`: null means "derive it from the geometry",
// a number means "use this instead". So an auto turn with an angle is a
// junction turn the user has overridden, and it stays owned by its move —
// converting it to `fixed` would leave sync free to add a SECOND turn at
// the same corner.
RP.TURN_AUTO  = 'auto';
RP.TURN_FIXED = 'fixed';

// Physically different manoeuvres, not cosmetic labels: a spin rotates
// about the chassis centre, a pivot locks one wheel and swings about it.
// Each maps to its own code template.
RP.TURN_STYLES = ['spin', 'pivot_left', 'pivot_right'];
// Short enough to survive the 180px sidebar; the panel hint underneath
// carries the explanation.
RP.TURN_STYLE_LABELS = {
  spin: 'Spin',
  pivot_left: 'Pivot left',
  pivot_right: 'Pivot right'
};
RP.DEFAULT_TURN_STYLE = 'spin';

// ---- construction ----------------------------------------------------
RP.makeTurnAction = function(pointId, opts) {
  opts = opts || {};
  return {
    id: RP.nextActionId++,
    type: RP.ACTION_TURN,
    pointId: pointId != null ? pointId : null,
    angleMode: opts.angleMode === RP.TURN_FIXED ? RP.TURN_FIXED : RP.TURN_AUTO,
    angle: opts.angle != null ? Number(opts.angle) : null,
    speed: opts.speed != null ? opts.speed : null,
    style: opts.style || RP.DEFAULT_TURN_STYLE,
    // Raw text spliced into {extra_args} in this action's code template,
    // verbatim — the user's own comma and all, so it can be dropped into
    // any position that template happens to put it in.
    extraArgs: opts.extraArgs || ''
  };
};

RP.makeMoveAction = function(entityId, entType, opts) {
  opts = opts || {};
  return {
    id: RP.nextActionId++,
    type: RP.ACTION_MOVE,
    entityId: entityId,
    // An arc entity can only be driven as an arc; a line cannot be.
    move: opts.move || (entType === 'arc' ? RP.MOVE_ARC : RP.MOVE_FORWARD),
    flip: !!opts.flip,
    reverse: !!opts.reverse,
    speed: opts.speed != null ? opts.speed : null,
    offset: opts.offset || 0,
    junctions: opts.junctions != null ? opts.junctions : null,
    teleportName: opts.teleportName || null,
    // Independent of the CONSTRUCTION line's own visible flag: hiding the
    // geometry and hiding the route's use of it are two different things
    // you might want separately, so a move gets its own flag rather than
    // reading the entity's. Same name/polarity as every other visible
    // flag in the app (route.visible, line.visible, ...).
    visible: opts.visible !== false,
    // See makeTurnAction: raw text for this move's {extra_args}.
    extraArgs: opts.extraArgs || ''
  };
};

// A checkpoint is a hook the robot calls when it reaches a place, so it
// references the point it happens at and nothing else. It used to be a
// string field on the move before it (`el.checkpoint`) plus a separate
// `route.startCheckpoint` for the one case that had no move before it.
RP.makeCheckpointAction = function(pointId, name) {
  return {
    id: RP.nextActionId++,
    type: RP.ACTION_CHECKPOINT,
    pointId: pointId != null ? pointId : null,
    name: name || 'checkpoint',
    // See makeTurnAction: raw text for this checkpoint's {extra_args}.
    extraArgs: ''
  };
};

RP.makeSegmentAction = function(name) {
  return {
    id: RP.nextActionId++,
    type: RP.ACTION_SEGMENT,
    pointId: null,
    name: name || 'Segment',
    // Two INDEPENDENT switches. Hiding is about reading the canvas;
    // including is about what the robot is asked to run. Wanting to see a
    // section you are not currently testing is completely ordinary, so
    // tying them together would be wrong.
    visible: true,
    included: true
  };
};

// ---- access ----------------------------------------------------------
RP.routeActions = function(route) {
  if (!route) return [];
  if (!route.actions) route.actions = [];
  return route.actions;
};

RP.isMoveAction = function(a) { return !!a && a.type === RP.ACTION_MOVE; };
RP.isTurnAction = function(a) { return !!a && a.type === RP.ACTION_TURN; };
RP.isCheckpointAction = function(a) { return !!a && a.type === RP.ACTION_CHECKPOINT; };
RP.isSegmentAction = function(a) { return !!a && a.type === RP.ACTION_SEGMENT; };

RP.moveActions = function(route) {
  var acts = RP.routeActions(route), out = [];
  for (var i = 0; i < acts.length; i++) if (RP.isMoveAction(acts[i])) out.push(acts[i]);
  return out;
};

RP.findAction = function(route, actionId) {
  var acts = RP.routeActions(route);
  for (var i = 0; i < acts.length; i++) if (acts[i].id === actionId) return acts[i];
  return null;
};

// Index of an action in route.actions, or -1.
RP.actionIndex = function(route, actionId) {
  var acts = RP.routeActions(route);
  for (var i = 0; i < acts.length; i++) if (acts[i].id === actionId) return i;
  return -1;
};

// A move plus everything that belongs to it: the turns queued in front
// of it, and the checkpoints that fire the moment it finishes.
// Reordering has to carry the whole group, otherwise a junction's speed
// is left behind attached to whatever move slides into its place.
RP.actionGroupFor = function(route, moveId) {
  var acts = RP.routeActions(route);
  var at = RP.actionIndex(route, moveId);
  if (at < 0) return null;
  var start = at;
  while (start > 0 && RP.isTurnAction(acts[start - 1])) start--;
  var end = at;
  while (end + 1 < acts.length && RP.isCheckpointAction(acts[end + 1])) end++;
  return { start: start, end: end, items: acts.slice(start, end + 1) };
};

// Every action anchored to the same place as `pointId`, in walk order.
// Several can share a junction — a typed turn, the geometric turn and a
// checkpoint all happen at the same corner.
RP.actionsAtPoint = function(route, pointId) {
  var sk = RP.sketch;
  if (!sk || pointId == null || !sk.entities[pointId]) return [];
  var find = RP.Sketch.coincidenceClusters(sk);
  var key = find(pointId);
  var acts = RP.routeActions(route), out = [];
  for (var i = 0; i < acts.length; i++) {
    var a = acts[i];
    if (RP.isMoveAction(a)) continue;
    if (a.pointId == null || !sk.entities[a.pointId]) continue;
    if (find(a.pointId) === key) out.push(a);
  }
  return out;
};

// ---- the invariant ---------------------------------------------------
// Rebuilds the auto-turn layer so there is exactly one before each move,
// preserving user parameters. Idempotent, so it is safe to call from
// rebuildRouteViews on every refresh.
//
// Matching an existing auto turn to a move is positional first (the turn
// that already preceded it), then by coincidence cluster (the junction it
// sat on). The second pass is what makes a reorder or a reversal carry
// each junction's speed and style along with it.
RP.syncTurnActions = function(route) {
  var sk = RP.sketch;
  if (!route || !sk) return;
  var acts = RP.routeActions(route);
  var find = RP.Sketch.coincidenceClusters(sk);

  var byMove = {};      // moveId    -> the auto turn already in front of it
  var byCluster = {};   // clusterKey -> [auto turn, ...]
  var pending = [];
  for (var i = 0; i < acts.length; i++) {
    var a = acts[i];
    if (RP.isTurnAction(a) && a.angleMode === RP.TURN_AUTO) { pending.push(a); continue; }
    if (RP.isMoveAction(a) && pending.length) byMove[a.id] = pending[pending.length - 1];
    pending = [];
  }
  for (var c = 0; c < acts.length; c++) {
    var t = acts[c];
    if (!RP.isTurnAction(t) || t.angleMode !== RP.TURN_AUTO) continue;
    var ck = (t.pointId != null && sk.entities[t.pointId]) ? String(find(t.pointId)) : '?';
    (byCluster[ck] = byCluster[ck] || []).push(t);
  }
  function takeFromCluster(key) {
    var bucket = byCluster[key];
    if (!bucket) return null;
    for (var k = 0; k < bucket.length; k++) {
      if (!bucket[k]._claimed) { bucket[k]._claimed = true; return bucket[k]; }
    }
    return null;
  }

  var out = [];
  for (var j = 0; j < acts.length; j++) {
    var act = acts[j];
    // The auto layer is rebuilt from scratch; fixed turns pass through
    // untouched and keep their position in front of their move.
    if (RP.isTurnAction(act) && act.angleMode === RP.TURN_AUTO) continue;
    if (RP.isMoveAction(act)) {
      var ends = RP.moveEndpoints(sk, act);
      var entry = ends ? ends.entry : null;
      var key = entry != null ? String(find(entry)) : '?';
      var reuse = byMove[act.id];
      if (reuse && reuse._claimed) reuse = null;
      if (reuse) reuse._claimed = true;
      if (!reuse) reuse = takeFromCluster(key);
      var turn = reuse || RP.makeTurnAction(entry);
      turn.pointId = entry;
      out.push(turn);
    }
    out.push(act);
  }
  for (var d = 0; d < out.length; d++) delete out[d]._claimed;
  route.actions = out;

  // User-inserted turns and checkpoints keep an anchor point purely so
  // they can be drawn and clicked. Reordering moves them, so re-derive it.
  for (var e = 0; e < out.length; e++) {
    var o = out[e];
    if (RP.isMoveAction(o)) continue;
    if (RP.isTurnAction(o) && o.angleMode === RP.TURN_AUTO) continue;
    o.pointId = RP.anchorPointFor(route, e);
  }
};

// The span before the first marker. Deliberately NOT a real marker
// action: forcing one onto the head of every route would put a segment
// row in front of people who never asked for segments, and would rewrite
// the action list of every existing project. Segments appear when you
// make one, and a route with none behaves exactly as it always did.
//
// Its two switches still have to live somewhere, so they live on the
// route. Created lazily — an unsegmented route never grows the field.
RP.leadSegmentProps = function(route) {
  if (!route.leadSegment) {
    route.leadSegment = { name: 'Start', visible: true, included: true };
  }
  return route.leadSegment;
};

// The route sliced at its markers.
//
//   [{ marker, id, name, visible, included, start, end, actions, moves }]
//
// `start`/`end` are inclusive indices into RP.routeActions(route). The
// leading segment has `marker: null` and `id: null`; every other one
// includes its marker at `start`.
RP.routeSegments = function(route) {
  var acts = RP.routeActions(route);
  var out = [];
  if (!acts.length) return out;

  var lead = RP.leadSegmentProps(route);
  var cur = {
    marker: null, id: null, name: lead.name || 'Start',
    visible: lead.visible !== false,
    included: lead.included !== false,
    start: 0, end: -1, actions: [], moves: []
  };

  for (var i = 0; i < acts.length; i++) {
    if (RP.isSegmentAction(acts[i])) {
      cur.end = i - 1;
      // A marker at index 0 means there is no lead span at all; drop the
      // empty placeholder rather than showing a segment with nothing in it.
      if (cur.end >= cur.start || cur.marker) out.push(cur);
      cur = {
        marker: acts[i], id: acts[i].id, name: acts[i].name || 'Segment',
        visible: acts[i].visible !== false,
        included: acts[i].included !== false,
        start: i, end: i, actions: [], moves: []
      };
    }
  }
  cur.end = acts.length - 1;
  if (cur.end >= cur.start || cur.marker) out.push(cur);

  for (var s = 0; s < out.length; s++) {
    out[s].actions = acts.slice(out[s].start, out[s].end + 1);
    out[s].moves = out[s].actions.filter(RP.isMoveAction);
  }
  return out;
};

// Which segment an action falls in, or null.
RP.segmentForAction = function(route, actionId) {
  var segs = RP.routeSegments(route);
  for (var i = 0; i < segs.length; i++) {
    for (var j = 0; j < segs[i].actions.length; j++) {
      if (segs[i].actions[j].id === actionId) return segs[i];
    }
  }
  return null;
};

// actionId -> segment, built once. Callers that ask about many actions
// (rendering, codegen) would otherwise rescan the whole route per action.
RP.segmentIndex = function(route) {
  var segs = RP.routeSegments(route);
  var map = {};
  for (var i = 0; i < segs.length; i++) {
    for (var j = 0; j < segs[i].actions.length; j++) map[segs[i].actions[j].id] = segs[i];
  }
  return map;
};

// markerId null addresses the leading segment, whose switches live on the
// route rather than on an action.
// Whether a move should be drawn/clickable at all: its own switch AND its
// segment's. The derived route.segments view folds this in, but anything
// reading move ACTIONS directly — the hit test, the referenced-entity set
// — has to ask, or segment hiding would be visual only.
RP.moveVisible = function(route, move, segIndex) {
  if (!move || move.visible === false) return false;
  var idx = segIndex || RP.segmentIndex(route);
  var seg = idx[move.id];
  return !seg || seg.visible !== false;
};

RP.setSegmentProps = function(routeId, markerId, props) {
  var route = RP.findRoute(routeId);
  if (!route) return false;
  var target = (markerId == null) ? RP.leadSegmentProps(route) : RP.findAction(route, markerId);
  if (!target || (markerId != null && !RP.isSegmentAction(target))) return false;
  for (var k in props) {
    if (Object.prototype.hasOwnProperty.call(props, k)) target[k] = props[k];
  }
  RP.rebuildRouteViews();
  return true;
};

// Start a new segment immediately before `beforeActionId` — i.e. "the
// next segment begins here". The previous segment therefore ends just
// before it, which is what makes start and end one decision rather than
// two that can contradict each other.
RP.insertSegmentMarker = function(routeId, beforeActionId, name) {
  var route = RP.findRoute(routeId);
  if (!route) return null;
  var acts = RP.routeActions(route);
  var at = beforeActionId != null ? RP.actionIndex(route, beforeActionId) : -1;
  var m = RP.makeSegmentAction(name || ('Segment ' + (RP.routeSegments(route).length + 1)));
  if (at < 0) acts.push(m); else acts.splice(at, 0, m);
  RP.rebuildRouteViews();
  return m;
};

// Removing a marker merges its segment into the one before it. The head
// marker cannot go — it is what makes "exactly one segment each" true.
RP.removeSegmentMarker = function(routeId, markerId) {
  var route = RP.findRoute(routeId);
  if (!route) return false;
  var acts = RP.routeActions(route);
  var at = RP.actionIndex(route, markerId);
  if (at < 0 || !RP.isSegmentAction(acts[at])) return false;
  acts.splice(at, 1);
  RP.rebuildRouteViews();
  return true;
};

RP.syncAllTurnActions = function() {
  for (var i = 0; i < RP.routes.length; i++) RP.syncTurnActions(RP.routes[i]);
};

// ---- turn CRUD (the parts the auto layer does not own) ---------------
// Insert a user-owned fixed turn immediately before `beforeActionId`, or
// at the end of the route when that is null.
RP.insertFixedTurn = function(routeId, beforeActionId, opts) {
  var route = RP.findRoute(routeId);
  if (!route) return null;
  var acts = RP.routeActions(route);
  var turn = RP.makeTurnAction(null, Object.assign({}, opts || {}, { angleMode: RP.TURN_FIXED }));
  if (turn.angle == null) turn.angle = 0;
  var at = beforeActionId != null ? RP.actionIndex(route, beforeActionId) : -1;
  if (at < 0) acts.push(turn); else acts.splice(at, 0, turn);
  turn.pointId = RP.anchorPointFor(route, at < 0 ? acts.length - 1 : at);
  RP.rebuildRouteViews();
  return turn;
};

// Insert a checkpoint that fires when the robot reaches this spot.
RP.insertCheckpoint = function(routeId, beforeActionId, name) {
  var route = RP.findRoute(routeId);
  if (!route) return null;
  var acts = RP.routeActions(route);
  var cp = RP.makeCheckpointAction(null, name);
  var at = beforeActionId != null ? RP.actionIndex(route, beforeActionId) : -1;
  if (at < 0) acts.push(cp); else acts.splice(at, 0, cp);
  cp.pointId = RP.anchorPointFor(route, at < 0 ? acts.length - 1 : at);
  RP.rebuildRouteViews();
  return cp;
};

// The checkpoint that fires the instant a given move finishes, if any.
RP.checkpointAfterMove = function(route, moveId) {
  var acts = RP.routeActions(route);
  var at = RP.actionIndex(route, moveId);
  if (at < 0) return null;
  for (var i = at + 1; i < acts.length && RP.isCheckpointAction(acts[i]); i++) {
    return acts[i];
  }
  return null;
};

// Adapter for "this move has a checkpoint", which is how the move panel
// still thinks about it. A blank name removes the action entirely.
RP.setMoveCheckpoint = function(routeId, moveId, name) {
  var route = RP.findRoute(routeId);
  if (!route) return false;
  var existing = RP.checkpointAfterMove(route, moveId);
  if (!name) {
    if (existing) RP.removeAction(routeId, existing.id);
    return true;
  }
  if (existing) { existing.name = name; RP.rebuildRouteViews(); return true; }
  var acts = RP.routeActions(route);
  var at = RP.actionIndex(route, moveId);
  if (at < 0) return false;
  var ends = RP.moveEndpoints(RP.ensureSketch(), acts[at]);
  acts.splice(at + 1, 0, RP.makeCheckpointAction(ends ? ends.exit : null, name));
  RP.rebuildRouteViews();
  return true;
};

// Where a user-inserted action sits on the mat: the entry point of the
// next move, or failing that the exit of the previous one. Anchors are
// for display and hit-testing only — nothing derives from them.
RP.anchorPointFor = function(route, index) {
  var sk = RP.sketch;
  if (!sk) return null;
  var acts = RP.routeActions(route);
  for (var f = index + 1; f < acts.length; f++) {
    if (!RP.isMoveAction(acts[f])) continue;
    var e = RP.moveEndpoints(sk, acts[f]);
    if (e) return e.entry;
  }
  for (var b = index - 1; b >= 0; b--) {
    if (!RP.isMoveAction(acts[b])) continue;
    var e2 = RP.moveEndpoints(sk, acts[b]);
    if (e2) return e2.exit;
  }
  return null;
};

RP.removeAction = function(routeId, actionId) {
  var route = RP.findRoute(routeId);
  if (!route) return false;
  var act = RP.findAction(route, actionId);
  if (!act) return false;
  // Auto turns are owned by the invariant, not by the user — removing one
  // would just be undone by the next sync.
  if (RP.isTurnAction(act) && act.angleMode === RP.TURN_AUTO) return false;
  if (RP.isMoveAction(act)) return RP.removeMove(routeId, actionId);
  route.actions.splice(RP.actionIndex(route, actionId), 1);
  RP.rebuildRouteViews();
  return true;
};

RP.setActionProps = function(routeId, actionId, props) {
  var act = RP.findAction(RP.findRoute(routeId), actionId);
  if (!act) return false;
  for (var k in props) {
    if (Object.prototype.hasOwnProperty.call(props, k)) act[k] = props[k];
  }
  RP.rebuildRouteViews();
  return true;
};
