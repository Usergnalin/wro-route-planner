/* ========================================================================
   resolver.js - Validate a route and linearise it for code generation.

   Replaces computeLongestPath, which was an exponential DFS over every
   simple path in the graph. With reference-only routes the order is
   already explicit, so this is O(n): check that consecutive elements meet
   end-to-start and hand back resolved coordinates.

   Continuity is checked through the coincidence union-find, not by
   comparing coordinates against a tolerance — two points are "the same
   place" if they are the same entity or joined by a coincident
   constraint. That makes continuity a property the solver maintains.
   ======================================================================== */
var RP = window.RP || {};

RP.ROUTE_ERRORS = {
  EMPTY:            'Route has no moves',
  MISSING_GEOMETRY: 'A move references geometry that no longer exists',
  OPEN_JUNCTION:    'Route is broken between two moves',
  NO_CALIBRATION:   'Image is not calibrated'
};

// → { ok:true, moves:[ {move, entity, entryId, exitId, a, b} ] }
// → { ok:false, code, message, moveIds:[…] }
RP.resolveRoute = function(route) {
  var sk = RP.sketch;
  var moves = RP.moveActions(route);
  if (!route || moves.length === 0) {
    return { ok: false, code: 'EMPTY', message: RP.ROUTE_ERRORS.EMPTY, moveIds: [] };
  }
  if (!sk) {
    return { ok: false, code: 'MISSING_GEOMETRY',
             message: RP.ROUTE_ERRORS.MISSING_GEOMETRY, moveIds: [] };
  }

  var find = RP.Sketch.coincidenceClusters(sk);
  var out = [];
  var prevExit = null;
  var prevMove = null;

  for (var i = 0; i < moves.length; i++) {
    var mv = moves[i];
    var ent = sk.entities[mv.entityId];
    if (!ent || (ent.type !== 'line' && ent.type !== 'arc')) {
      return {
        ok: false, code: 'MISSING_GEOMETRY',
        message: 'Move ' + (i + 1) + ' references missing geometry',
        moveIds: [mv.id]
      };
    }
    var ends = RP.moveEndpoints(sk, mv);
    var pa = sk.entities[ends.entry], pb = sk.entities[ends.exit];
    if (!pa || !pb) {
      return {
        ok: false, code: 'MISSING_GEOMETRY',
        message: 'Move ' + (i + 1) + ' has missing endpoints',
        moveIds: [mv.id]
      };
    }

    if (prevExit !== null && find(prevExit) !== find(ends.entry)) {
      return {
        ok: false, code: 'OPEN_JUNCTION',
        // The distance is the diagnosis: 0.0mm means the endpoints are on
        // top of each other and simply are not joined, which looks
        // perfectly continuous and is the case that wastes the most time.
        message: 'Route is broken between move ' + i + ' and ' + (i + 1) +
                 ' — endpoints are ' +
                 (RP.dist(sk.entities[prevExit].x, sk.entities[prevExit].y, pa.x, pa.y) /
                  ((RP.calibration && RP.calibration.pixelsPerMm) || 1)).toFixed(1) +
                 ' mm apart and not joined',
        moveIds: [prevMove.id, mv.id]
      };
    }

    out.push({
      move: mv, entity: ent,
      entryId: ends.entry, exitId: ends.exit,
      a: { x: pa.x, y: pa.y },
      b: { x: pb.x, y: pb.y }
    });
    prevExit = ends.exit;
    prevMove = mv;
  }

  return { ok: true, moves: out };
};

// ---- diagnosing a break ----------------------------------------------
// resolveRoute stops at the FIRST break, which is right for codegen and
// wrong for a human: you fix one, regenerate, and find another. This
// walks the whole route and reports every break at once.
//
// The one that actually costs time is a break you cannot see: two
// endpoints at exactly the same pixel that are not joined by a coincident
// constraint. Continuity is a constraint relation, not a positional one,
// so the drawing looks perfect and the route is still cut in half. The
// gap distance is what separates that case from having referenced the
// wrong line entirely, so it is measured and reported.
//
// Nothing here writes to the sketch. Joining the points is the user's
// call — an auto-join is a constraint they did not ask for, in a document
// where an unwanted constraint is its own kind of afternoon.
//
// → [ { index, gapMm, joined, fromMove, toMove, exitId, entryId, a, b } ]
//   `index` is the number of the move BEFORE the break, 1-based, matching
//   what the action list shows.
RP.BREAK_TOUCH_MM = 0.5;

RP.routeBreaks = function(route) {
  var sk = RP.sketch;
  var moves = route ? RP.moveActions(route) : [];
  if (!sk || moves.length < 2) return [];

  var find = RP.Sketch.coincidenceClusters(sk);
  var ppm = (RP.calibration && RP.calibration.pixelsPerMm) || 1;
  var breaks = [];
  var prev = null;

  for (var i = 0; i < moves.length; i++) {
    var mv = moves[i];
    var ent = sk.entities[mv.entityId];
    if (!ent || (ent.type !== 'line' && ent.type !== 'arc')) { prev = null; continue; }
    var ends = RP.moveEndpoints(sk, mv);
    var pa = ends && sk.entities[ends.entry], pb = ends && sk.entities[ends.exit];
    if (!pa || !pb) { prev = null; continue; }

    if (prev && find(prev.exitId) !== find(ends.entry)) {
      var pe = sk.entities[prev.exitId];
      breaks.push({
        index: prev.n, gapMm: RP.dist(pe.x, pe.y, pa.x, pa.y) / ppm,
        // Same place, different cluster: the invisible one.
        joined: false,
        fromMove: prev.move, toMove: mv,
        exitId: prev.exitId, entryId: ends.entry,
        a: { x: pe.x, y: pe.y }, b: { x: pa.x, y: pa.y }
      });
    }
    prev = { move: mv, exitId: ends.exit, n: i + 1 };
  }
  return breaks;
};

// Which moves sit either side of a break, so the action list can mark
// them without re-walking the route per row.
RP.breakIndexFor = function(route) {
  var idx = { before: {}, after: {}, count: 0 };
  var bs = RP.routeBreaks(route);
  for (var i = 0; i < bs.length; i++) {
    idx.before[bs[i].fromMove.id] = bs[i];
    idx.after[bs[i].toMove.id] = bs[i];
  }
  idx.count = bs.length;
  return idx;
};

// How a break should be described, in one line. The distance is the
// whole point: 0.0 mm means "these are on top of each other and simply
// are not joined", which is a completely different mistake from 40 mm.
RP.describeBreak = function(b) {
  if (!b) return '';
  return (b.gapMm <= RP.BREAK_TOUCH_MM)
    ? 'touching (' + b.gapMm.toFixed(1) + ' mm) but not joined — they need a coincident constraint'
    : b.gapMm.toFixed(1) + ' mm apart';
};

// ---- action timeline -------------------------------------------------
// Codegen used to infer turns from consecutive headings while it emitted
// moves, which is why turn parameters had nowhere to live. Turns are real
// actions now, so headings have to be known BEFORE the walk: an auto turn
// needs the entry heading of the move that follows it.
//
// entryHeading === null means "no turn can be derived here" — a teleport
// arrives with the chassis pointing somewhere the planner cannot know.
// exitHeading === null means the same for whatever comes next.
//
// → { ok:true, items:[ {kind:'move'|'turn', ...} ] }  |  the resolveRoute error
RP.resolveTimeline = function(route) {
  var resolved = RP.resolveRoute(route);
  if (!resolved.ok) return resolved;

  var sk = RP.sketch;
  var byId = {};
  for (var i = 0; i < resolved.moves.length; i++) {
    byId[resolved.moves[i].move.id] = resolved.moves[i];
  }

  function headings(rel) {
    var el = rel.move;
    var backward = !!el.reverse;
    var move = el.move || RP.MOVE_FORWARD;

    if (move === RP.MOVE_TELEPORT) return { entry: null, exit: null, arc: null };

    if (rel.entity.type === 'arc') {
      var g = RP.Sketch.arcGeometry(sk, rel.entity);
      if (g) {
        // Sweep is stored against p1->p2, so traversing the other way
        // negates it. Tangent = radius rotated ±90° by the sweep sign.
        var sweep = el.flip ? -g.sweep : g.sweep;
        var ss = sweep >= 0 ? 1 : -1;
        var velStart = RP.toDeg(Math.atan2(ss * (rel.a.x - g.cx), ss * (-(rel.a.y - g.cy))));
        var velEnd   = RP.toDeg(Math.atan2(ss * (rel.b.x - g.cx), ss * (-(rel.b.y - g.cy))));
        var nose = !backward;
        return {
          entry: nose ? velStart : (velStart + 180) % 360,
          exit:  nose ? velEnd   : (velEnd + 180) % 360,
          arc: { sweepDeg: sweep * 180 / Math.PI, radiusPx: g.radius, noseFirst: nose }
        };
      }
    }

    var h = backward ? RP.toDeg(RP.angleRad(rel.b.x, rel.b.y, rel.a.x, rel.a.y))
                     : RP.toDeg(RP.angleRad(rel.a.x, rel.a.y, rel.b.x, rel.b.y));
    // wall_align ends square to the wall it found, whatever it started as.
    var exit = (move === RP.MOVE_WALL_ALIGN) ? (Math.round(h / 90) * 90 % 360) : h;
    return { entry: h, exit: exit, arc: null };
  }

  var items = [];
  var acts = RP.routeActions(route);
  for (var j = 0; j < acts.length; j++) {
    var act = acts[j];
    if (RP.isMoveAction(act)) {
      var rel = byId[act.id];
      if (!rel) continue;
      var hd = headings(rel);
      items.push({
        kind: 'move', action: act, entity: rel.entity,
        a: rel.a, b: rel.b,
        entryHeading: hd.entry, exitHeading: hd.exit, arc: hd.arc
      });
    } else if (RP.isTurnAction(act)) {
      items.push({ kind: 'turn', action: act });
    } else if (RP.isCheckpointAction(act)) {
      items.push({ kind: 'checkpoint', action: act });
    }
  }

  // Each auto turn resolves against the next move in the walk.
  for (var k = 0; k < items.length; k++) {
    if (items[k].kind !== 'turn') continue;
    for (var n = k + 1; n < items.length; n++) {
      if (items[n].kind === 'move') { items[k].nextMove = items[n]; break; }
    }
  }

  return { ok: true, items: items, moves: resolved.moves };
};
