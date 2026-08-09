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
  EMPTY:            'Route has no elements',
  MISSING_GEOMETRY: 'An element references geometry that no longer exists',
  OPEN_JUNCTION:    'Route is broken between two elements',
  NO_CALIBRATION:   'Image is not calibrated'
};

// → { ok:true, elements:[ {element, entity, entryId, exitId, a, b} ] }
// → { ok:false, code, message, elementIds:[…] }
RP.resolveRoute = function(route) {
  var sk = RP.sketch;
  if (!route || !route.elements || route.elements.length === 0) {
    return { ok: false, code: 'EMPTY', message: RP.ROUTE_ERRORS.EMPTY, elementIds: [] };
  }
  if (!sk) {
    return { ok: false, code: 'MISSING_GEOMETRY',
             message: RP.ROUTE_ERRORS.MISSING_GEOMETRY, elementIds: [] };
  }

  var find = RP.Sketch.coincidenceClusters(sk);
  var out = [];
  var prevExit = null;
  var prevEl = null;

  for (var i = 0; i < route.elements.length; i++) {
    var el = route.elements[i];
    var ent = sk.entities[el.entityId];
    if (!ent || (ent.type !== 'line' && ent.type !== 'arc')) {
      return {
        ok: false, code: 'MISSING_GEOMETRY',
        message: 'Element ' + (i + 1) + ' references missing geometry',
        elementIds: [el.id]
      };
    }
    var ends = RP.elementEndpoints(sk, el);
    var pa = sk.entities[ends.entry], pb = sk.entities[ends.exit];
    if (!pa || !pb) {
      return {
        ok: false, code: 'MISSING_GEOMETRY',
        message: 'Element ' + (i + 1) + ' has missing endpoints',
        elementIds: [el.id]
      };
    }

    if (prevExit !== null && find(prevExit) !== find(ends.entry)) {
      return {
        ok: false, code: 'OPEN_JUNCTION',
        message: 'Route is broken between element ' + i + ' and ' + (i + 1) +
                 ' — join the endpoints with a coincident constraint',
        elementIds: [prevEl.id, el.id]
      };
    }

    out.push({
      element: el, entity: ent,
      entryId: ends.entry, exitId: ends.exit,
      a: { x: pa.x, y: pa.y },
      b: { x: pb.x, y: pb.y }
    });
    prevExit = ends.exit;
    prevEl = el;
  }

  return { ok: true, elements: out };
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
  for (var i = 0; i < resolved.elements.length; i++) {
    byId[resolved.elements[i].element.id] = resolved.elements[i];
  }

  function headings(rel) {
    var el = rel.element;
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

  return { ok: true, items: items, elements: resolved.elements };
};
