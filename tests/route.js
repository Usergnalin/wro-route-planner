/* ========================================================================
   route.js - Phases 4+5: routes as references, and the resolver.

     node tests/route.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('route model');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  RP.render = function () {};
  RP.updateLayerList = function () {};
  RP.updateInfoPanel = function () {};
  RP.updateInstructions = function () {};
  RP.updateConstraintPanel = function () {};
  RP.updateRouteSelect = function () {};
  RP.updateSideRouteList = function () {};
  RP.calibration = { pixelsPerMm: 2 };
  RP.scale = 1;
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

// Two lines joined at (100,0) by a coincident constraint, both referenced.
function twoElementRoute(RP) {
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.p2.id, b.p1.id]);
  const route = RP.routes[0];
  const e1 = RP.addMove(route.id, a.line.id, { move: 'forward' });
  const e2 = RP.addMove(route.id, b.line.id, { move: 'forward' });
  return { route, a, b, e1, e2 };
}

// Old-model route, as a pre-phase-4 save would contain.
function legacyRoute(RP) {
  const route = { id: 1, name: 'Legacy', visible: true, nodes: [], segments: [] };
  RP.routes = [route];
  RP.nextWpId = 1; RP.nextSegId = 1;
  const n = (x, y, props) => {
    const node = Object.assign({ id: RP.nextWpId++, x, y, isCheckpoint: false,
      checkpointName: null }, props || {});
    route.nodes.push(node); return node;
  };
  const s = (from, to, props) => {
    const seg = Object.assign({ id: RP.nextSegId++, fromNodeId: from.id,
      toNodeId: to.id, direction: 'forward', mode: 'normal' }, props || {});
    route.segments.push(seg); return seg;
  };
  return { route, n, s };
}

// ---- element CRUD ----------------------------------------------------
check('addMove references an entity and owns no coordinates', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  const el = RP.addMove(RP.routes[0].id, made.line.id, { move: 'forward', speed: 300 });
  assert(el && el.entityId === made.line.id, 'element should reference the line');
  assert(!('x' in el) && !('y' in el), 'elements must not carry coordinates');
  assert(el.speed === 300, 'movement params live on the element');
});

check('addMove rejects missing or non-line entities', () => {
  const RP = fresh();
  const p = RP.Sketch.addPoint(RP.sketch, 10, 10);
  assert(RP.addMove(RP.routes[0].id, 99999, {}) === null, 'missing entity');
  assert(RP.addMove(RP.routes[0].id, p.id, {}) === null, 'points are not drivable');
});

check('flip selects which endpoint is the entry', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  const el = RP.addMove(RP.routes[0].id, made.line.id, { flip: false });
  let ends = RP.moveEndpoints(RP.sketch, el);
  assert(ends.entry === made.p1.id && ends.exit === made.p2.id, 'unflipped');
  el.flip = true;
  ends = RP.moveEndpoints(RP.sketch, el);
  assert(ends.entry === made.p2.id && ends.exit === made.p1.id, 'flipped');
});

check('removeMove drops it from the route but keeps the geometry', () => {
  const RP = fresh();
  const { route, a, e1 } = twoElementRoute(RP);
  RP.removeMove(route.id, e1.id);
  assert(RP.moveActions(route).length === 1, 'element removed');
  assert(!!RP.Sketch.get(RP.sketch, a.line.id), 'geometry must survive');
});

check('reorderMove reorders the traversal', () => {
  const RP = fresh();
  const { route, e1, e2 } = twoElementRoute(RP);
  RP.reorderMove(route.id, e2.id, 0);
  assert(RP.moveActions(route)[0].id === e2.id, 'element should have moved to the front');
});

// ---- derived views ---------------------------------------------------
check('nodes/segments views are rebuilt from elements', () => {
  const RP = fresh();
  const { route } = twoElementRoute(RP);
  assert(route.segments.length === 2, 'one segment per element');
  // The shared junction collapses to a single node via the coincidence
  // cluster, so a 2-element chain has 3 nodes, not 4.
  assert(route.nodes.length === 3, 'expected 3 nodes, got ' + route.nodes.length);
});

check('route geometry follows the sketch when it solves', () => {
  const RP = fresh();
  const { route, a } = twoElementRoute(RP);
  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('distance', 100);      // 100 mm = 200 px
  RP.rebuildRouteViews();
  const seg = route.segments[0];
  const n1 = route.nodes.filter(n => n.id === seg.fromNodeId)[0];
  const n2 = route.nodes.filter(n => n.id === seg.toNodeId)[0];
  assertClose(Math.hypot(n2.x - n1.x, n2.y - n1.y), 200, 1e-6,
    'route length is whatever the solver says');
});

// ---- resolver --------------------------------------------------------
check('resolver rejects an empty route', () => {
  const RP = fresh();
  const res = RP.resolveRoute(RP.routes[0]);
  assert(!res.ok && res.code === 'EMPTY', 'expected EMPTY, got ' + JSON.stringify(res));
});

check('resolver accepts a properly joined chain', () => {
  const RP = fresh();
  const { route } = twoElementRoute(RP);
  const res = RP.resolveRoute(route);
  assert(res.ok, 'expected ok: ' + JSON.stringify(res));
  assert(res.moves.length === 2, 'two resolved elements');
  assertClose(res.moves[0].a.x, 0, 1e-9);
  assertClose(res.moves[1].b.y, 80, 1e-9);
});

check('resolver reports an open junction and names the elements', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(300, 0, 300, 80);   // deliberately detached
  const route = RP.routes[0];
  const e1 = RP.addMove(route.id, a.line.id, {});
  const e2 = RP.addMove(route.id, b.line.id, {});
  const res = RP.resolveRoute(route);
  assert(!res.ok && res.code === 'OPEN_JUNCTION',
    'expected OPEN_JUNCTION, got ' + JSON.stringify(res));
  assert(res.moveIds.indexOf(e1.id) >= 0 && res.moveIds.indexOf(e2.id) >= 0,
    'both sides of the gap should be named');
});

check('resolver treats a shared point entity as connected', () => {
  const RP = fresh();
  const sk = RP.sketch;
  const p1 = RP.Sketch.addPoint(sk, 0, 0);
  const p2 = RP.Sketch.addPoint(sk, 100, 0);
  const p3 = RP.Sketch.addPoint(sk, 100, 80);
  const l1 = RP.Sketch.addLine(sk, p1.id, p2.id);
  const l2 = RP.Sketch.addLine(sk, p2.id, p3.id);   // shares p2 outright
  RP.constructionMeta[l1.id] = { visible: true, role: 'route' };
  RP.constructionMeta[l2.id] = { visible: true, role: 'route' };
  const route = RP.routes[0];
  RP.addMove(route.id, l1.id, {});
  RP.addMove(route.id, l2.id, {});
  assert(RP.resolveRoute(route).ok, 'shared point should count as joined');
});

check('resolver reports geometry deleted out from under an element', () => {
  const RP = fresh();
  const { route, a } = twoElementRoute(RP);
  RP.Sketch.removeEntity(RP.sketch, a.line.id);
  const res = RP.resolveRoute(route);
  assert(!res.ok && res.code === 'MISSING_GEOMETRY',
    'expected MISSING_GEOMETRY, got ' + JSON.stringify(res));
});

check('broken routes produce a warning in the generated code, not silence', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(300, 0, 300, 80);
  const route = RP.routes[0];
  RP.addMove(route.id, a.line.id, {});
  RP.addMove(route.id, b.line.id, {});
  const code = RP.generateCode(route);
  assert(/⚠/.test(code) && /broken/.test(code),
    'expected a visible warning, got: ' + JSON.stringify(code));
});

// ---- flip vs reverse -------------------------------------------------
check('flip changes travel order; reverse changes only chassis direction', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  const route = RP.routes[0];
  const el = RP.addMove(route.id, made.line.id, { move: 'forward' });

  let steps = RP.computeSteps(route);
  let fwd = steps.filter(s => s.kind === 'forward')[0];
  assert(fwd && fwd.reverse === false, 'plain element drives forwards');

  RP.setMoveProps(route.id, el.id, { reverse: true });
  steps = RP.computeSteps(route);
  fwd = steps.filter(s => s.kind === 'forward')[0];
  assert(fwd.reverse === true, 'reverse flips chassis direction');

  // Flipping travel order reverses the heading but not the chassis flag.
  RP.setMoveProps(route.id, el.id, { reverse: false, flip: true });
  const res = RP.resolveRoute(route);
  assertClose(res.moves[0].a.x, 100, 1e-9, 'entry is now the far end');
  assertClose(res.moves[0].b.x, 0, 1e-9, 'exit is now the near end');
  steps = RP.computeSteps(route);
  assert(steps.filter(s => s.kind === 'forward')[0].reverse === false,
    'flip must not imply reverse');
});

// ---- migration -------------------------------------------------------
check('legacy route migrates to elements joined by coincident constraints', () => {
  const RP = fresh();
  const { route, n, s } = legacyRoute(RP);
  const a = n(0, 0), b = n(100, 0), c = n(100, 80);
  s(a, b); s(b, c);

  const migrated = RP.migrateRoutesToActions();
  assert(migrated === 1, 'one route migrated');
  assert(RP.moveActions(route).length === 2, 'two elements');
  assert(!RP.moveActions(route)[0].flip, 'forward-stored segment is unflipped');

  const sk = RP.sketch;
  const coincident = RP.Sketch.constraintIds(sk)
    .filter(id => sk.constraints[id].type === 'coincident').length;
  assert(coincident === 1, 'one junction constraint, got ' + coincident);
  assert(RP.resolveRoute(route).ok, 'migrated route should resolve');
});

check('migration preserves traversal direction of reversed segments', () => {
  const RP = fresh();
  const { route, n, s } = legacyRoute(RP);
  const a = n(0, 0), b = n(100, 0), c = n(200, 0);
  s(a, b);
  s(c, b);              // stored c->b but walked b->c
  RP.migrateRoutesToActions();
  assert(RP.moveActions(route)[1].flip === true, 'second element should be flipped');
  const res = RP.resolveRoute(route);
  assert(res.ok, 'should resolve: ' + JSON.stringify(res));
  assertClose(res.moves[1].b.x, 200, 1e-9, 'travel should end at x=200');
});

check('migration drops nodes off the longest path, as codegen already did', () => {
  const RP = fresh();
  const { route, n, s } = legacyRoute(RP);
  const a = n(0, 0), b = n(100, 0), c = n(300, 0), d = n(100, 50);
  s(a, b); s(b, c); s(b, d);          // Y-shape, short arm to d
  RP.migrateRoutesToActions();
  assert(RP.moveActions(route).length === 2, 'only the longest arm survives');
});

// ---- serialization ---------------------------------------------------
check('serializeRoutes persists actions and omits the derived views', () => {
  const RP = fresh();
  twoElementRoute(RP);
  const out = RP.serializeRoutes();
  const moves = out[0].actions.filter(a => a.type === 'move');
  assert(moves.length === 2, 'two moves are persisted, got ' + moves.length);
  assert(out[0].nodes === undefined && out[0].segments === undefined &&
         out[0].moves === undefined,
    'derived views must not be persisted');
});

if (!report()) process.exitCode = 1;
