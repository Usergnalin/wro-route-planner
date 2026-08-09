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
