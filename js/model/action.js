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

RP.TURN_AUTO  = 'auto';    // angle derived from the geometry either side
RP.TURN_FIXED = 'fixed';   // angle typed by the user

// Physically different manoeuvres, not cosmetic labels: a spin rotates
// about the chassis centre, a pivot locks one wheel and swings about it.
// Each maps to its own code template.
RP.TURN_STYLES = ['spin', 'pivot_left', 'pivot_right'];
RP.TURN_STYLE_LABELS = {
  spin: 'Spin (both wheels)',
  pivot_left: 'Pivot on left wheel',
  pivot_right: 'Pivot on right wheel'
};
RP.DEFAULT_TURN_STYLE = 'spin';

// ---- construction ----------------------------------------------------
RP.makeTurnAction = function(pointId, opts) {
  opts = opts || {};
  return {
    id: RP.nextElementId++,
    type: RP.ACTION_TURN,
    pointId: pointId != null ? pointId : null,
    angleMode: opts.angleMode === RP.TURN_FIXED ? RP.TURN_FIXED : RP.TURN_AUTO,
    angle: opts.angle != null ? Number(opts.angle) : null,
    speed: opts.speed != null ? opts.speed : null,
    style: opts.style || RP.DEFAULT_TURN_STYLE
  };
};

RP.makeMoveAction = function(entityId, entType, opts) {
  opts = opts || {};
  return {
    id: RP.nextElementId++,
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
    checkpoint: opts.checkpoint || null,
    hidden: !!opts.hidden
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

// A move plus the turns that belong to it: its auto turn and any fixed
// turns queued in front of it. Reordering has to carry the whole group,
// otherwise a junction's speed is left behind with the wrong move.
RP.actionGroupFor = function(route, moveId) {
  var acts = RP.routeActions(route);
  var end = RP.actionIndex(route, moveId);
  if (end < 0) return null;
  var start = end;
  while (start > 0 && RP.isTurnAction(acts[start - 1])) start--;
  return { start: start, end: end, items: acts.slice(start, end + 1) };
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
      var ends = RP.elementEndpoints(sk, act);
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
  RP.rebuildRouteViews();
  return turn;
};

RP.removeAction = function(routeId, actionId) {
  var route = RP.findRoute(routeId);
  if (!route) return false;
  var act = RP.findAction(route, actionId);
  if (!act) return false;
  // Auto turns are owned by the invariant, not by the user — removing one
  // would just be undone by the next sync.
  if (RP.isTurnAction(act) && act.angleMode === RP.TURN_AUTO) return false;
  if (RP.isMoveAction(act)) return RP.removeRouteElement(routeId, actionId);
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
