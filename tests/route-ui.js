/* ========================================================================
   route-ui.js - Phase 6: sketch/route mode split and route-mode editing.

     node tests/route-ui.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('route mode');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  RP.render = function () {};
  RP.updateLayerList = function () {};
  RP.updateInfoPanel = function () {};
  RP.updateInstructions = function () {};
  RP.calibration = { pixelsPerMm: 2 };
  RP.scale = 1;
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

// An L of two lines joined at (100,0), drawn in Sketch mode.
function drawL(RP) {
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.p2.id, b.p1.id]);
  return { a, b };
}

// ---- mode switching --------------------------------------------------
check('switching to route mode clears sketch selection and drag state', () => {
  const RP = fresh();
  const { a } = drawL(RP);
  RP.setTool('constrain');
  RP.sketchSelection = [a.line.id];
  RP.sketchDrag = { pointId: a.p1.id, moved: false };

  RP.setEditMode('route');
  assert(RP.editMode === 'route', 'mode should be route');
  assert(RP.sketchSelection.length === 0, 'sketch selection should clear');
  assert(RP.sketchDrag === null, 'in-progress drag should be dropped');
});

check('returning to sketch mode restores the previous tool', () => {
  const RP = fresh();
  RP.setTool('constrain');
  RP.setEditMode('route');
  RP.setEditMode('sketch');
  assert(RP.editMode === 'sketch', 'mode should be sketch');
  assert(RP.activeTool === 'constrain', 'expected constrain, got ' + RP.activeTool);
});

check('leaving route mode clears the element selection', () => {
  const RP = fresh();
  const { a } = drawL(RP);
  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  RP.selectedMoveId = RP.moveActions(RP.routes[0])[0].id;
  RP.setEditMode('sketch');
  assert(RP.selectedMoveId === null, 'element selection should clear');
});

// ---- reference-only guarantee ---------------------------------------
check('route mode never moves geometry', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  const before = RP.lines.map(l => [l.x1, l.y1, l.x2, l.y2].join(','));

  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  RP.appendGeometryToRoute(b.line.id);
  RP.updateSelectedMove && (RP.selectedMoveId = RP.moveActions(RP.routes[0])[0].id);
  RP.updateSelectedMove({ move: 'linetrace_dist', speed: 250 });

  const after = RP.lines.map(l => [l.x1, l.y1, l.x2, l.y2].join(','));
  assert(JSON.stringify(before) === JSON.stringify(after),
    'geometry must be untouched by route editing');
});

check('removing an element keeps the geometry it referenced', () => {
  const RP = fresh();
  const { a } = drawL(RP);
  RP.setEditMode('route');
  const el = RP.appendGeometryToRoute(a.line.id);
  RP.selectedMoveId = el.id;
  RP.removeSelectedMove();
  assert(RP.moveActions(RP.routes[0]).length === 0, 'element removed');
  assert(!!RP.Sketch.get(RP.sketch, a.line.id), 'geometry survives');
});

// ---- hit testing -----------------------------------------------------
check('hit test prefers route elements over bare geometry', () => {
  const RP = fresh();
  const { a } = drawL(RP);
  RP.setEditMode('route');
  assert(RP.routeHitTest(50, 0).kind === 'geometry', 'unreferenced line is geometry');
  const el = RP.appendGeometryToRoute(a.line.id);
  const hit = RP.routeHitTest(50, 0);
  assert(hit.kind === 'move' && hit.id === el.id,
    'once referenced it should hit as an element');
});

check('hit test misses empty space', () => {
  const RP = fresh();
  drawL(RP);
  RP.setEditMode('route');
  assert(RP.routeHitTest(900, 900) === null, 'empty space should miss');
});

// ---- appending -------------------------------------------------------
check('appending picks the traversal direction that connects', () => {
  const RP = fresh();
  // Second line is drawn AWAY from the junction, so it must be flipped to
  // follow the first one.
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 80, 100, 0);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.p2.id, b.p2.id]);

  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  const second = RP.appendGeometryToRoute(b.line.id);
  assert(second.flip === true, 'expected the second element to be flipped');
  assert(RP.resolveRoute(RP.routes[0]).ok, 'route should resolve as connected');
});

check('appending connected geometry builds a resolvable route', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  RP.appendGeometryToRoute(b.line.id);
  const res = RP.resolveRoute(RP.routes[0]);
  assert(res.ok, 'expected ok: ' + JSON.stringify(res));
  assert(res.moves.length === 2, 'two elements');
});

check('routeReferencedEntities reports what routes already use', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  const refs = RP.routeReferencedEntities();
  assert(refs[a.line.id] === true, 'referenced line listed');
  assert(refs[b.line.id] === undefined, 'unreferenced line absent');
});

// ---- element editing -------------------------------------------------
check('element parameters round-trip into generated code', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  RP.setEditMode('route');
  const e1 = RP.appendGeometryToRoute(a.line.id);
  RP.appendGeometryToRoute(b.line.id);

  RP.selectedMoveId = e1.id;
  RP.updateSelectedMove({ move: 'linetrace_junct', junctions: 3, speed: 250 });

  const code = RP.generateCode(RP.routes[0]);
  assert(/line_trace_until_junctions\(3, 250\)/.test(code),
    'expected the junction move in the output, got:\n' + code);
});

check('checkpoint set on an element appears in the code', () => {
  const RP = fresh();
  const { a } = drawL(RP);
  RP.setEditMode('route');
  const el = RP.appendGeometryToRoute(a.line.id);
  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ checkpoint: 'grab_block' });
  const code = RP.generateCode(RP.routes[0]);
  assert(/if callable\(grab_block\): grab_block\(\)/.test(code),
    'expected the checkpoint call, got:\n' + code);
});

check('reordering elements changes traversal order', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  RP.setEditMode('route');
  const e1 = RP.appendGeometryToRoute(a.line.id);
  const e2 = RP.appendGeometryToRoute(b.line.id);
  RP.selectedMoveId = e2.id;
  RP.reorderSelectedMove(-1);
  assert(RP.moveActions(RP.routes[0])[0].id === e2.id, 'second element moved to front');
});

check('route edits are undoable', () => {
  const RP = fresh();
  const { a } = drawL(RP);
  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  assert(RP.moveActions(RP.routes[0]).length === 1, 'setup');
  RP.undo();
  assert(RP.moveActions(RP.routes[0]).length === 0, 'undo should remove the element');
  assert(!!RP.Sketch.get(RP.sketch, a.line.id), 'geometry must survive the undo');
});

// ---- travel direction is derived, not chosen -------------------------
// A 3-segment staircase, drawn end to end.
function staircase(RP) {
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80);
  const c = RP.addConstructionLine(100, 80, 200, 80);
  const sk = RP.sketch;
  RP.Sketch.addConstraint(sk, 'coincident', [a.p2.id, b.p1.id]);
  RP.Sketch.addConstraint(sk, 'coincident', [b.p2.id, c.p1.id]);
  RP.setEditMode('route');
  const e1 = RP.appendGeometryToRoute(a.line.id);
  const e2 = RP.appendGeometryToRoute(b.line.id);
  const e3 = RP.appendGeometryToRoute(c.line.id);
  return { a, b, c, e1, e2, e3, route: RP.routes[0] };
}

check('reordering finds a valid orientation when one exists', () => {
  // Two collinear segments: both orders are connectable, but only if the
  // travel directions are re-derived. This used to break the route.
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 200, 0);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.p2.id, b.p1.id]);
  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  const e2 = RP.appendGeometryToRoute(b.line.id);
  const route = RP.routes[0];
  assert(RP.resolveRoute(route).ok, 'setup should resolve');

  RP.selectedMoveId = e2.id;
  RP.reorderSelectedMove(-1);           // now [b, a]

  const res = RP.resolveRoute(route);
  assert(res.ok, 'a valid orientation exists and should be found: ' + JSON.stringify(res));
  assertClose(res.moves[0].a.x, 200, 1e-9, 'the walk now starts from the far end');
  assertClose(res.moves[1].b.x, 0, 1e-9, 'and finishes at the old start');
});

check('a geometrically impossible order is still reported, not papered over', () => {
  // Moving the last leg of a staircase to the front leaves it touching
  // nothing. No choice of direction can fix that, and pretending otherwise
  // would be worse than saying so.
  const RP = fresh();
  const { route, e3 } = staircase(RP);
  RP.selectedMoveId = e3.id;
  RP.reorderSelectedMove(-1);
  RP.reorderSelectedMove(-1);
  const res = RP.resolveRoute(route);
  assert(!res.ok && res.code === 'OPEN_JUNCTION',
    'expected an honest OPEN_JUNCTION, got ' + JSON.stringify(res));
});

check('appending in a chain derives each travel direction', () => {
  const RP = fresh();
  // Middle line drawn backwards relative to the walk.
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 80, 100, 0);
  const sk = RP.sketch;
  RP.Sketch.addConstraint(sk, 'coincident', [a.p2.id, b.p2.id]);
  RP.setEditMode('route');
  RP.appendGeometryToRoute(a.line.id);
  RP.appendGeometryToRoute(b.line.id);
  const route = RP.routes[0];
  assert(RP.resolveRoute(route).ok, 'chain should resolve regardless of draw order');
  assert(RP.moveActions(route)[1].flip === true, 'direction should have been derived');
});

check('recomputeFlips repairs a desynced chain', () => {
  const RP = fresh();
  const { route, e2 } = staircase(RP);
  // Simulate what the old flip checkbox allowed.
  e2.flip = !e2.flip;
  assert(!RP.resolveRoute(route).ok, 'desynced chain should be broken');
  RP.recomputeFlips(route);
  assert(RP.resolveRoute(route).ok, 'recomputeFlips should repair it');
});

check('reversing the route walks it the other way', () => {
  const RP = fresh();
  const { route } = staircase(RP);
  const before = RP.resolveRoute(route);
  const startBefore = before.moves[0].a;
  const endBefore = before.moves[before.moves.length - 1].b;

  RP.reverseRoute();

  const after = RP.resolveRoute(route);
  assert(after.ok, 'reversed route must still resolve: ' + JSON.stringify(after));
  assertClose(after.moves[0].a.x, endBefore.x, 1e-9, 'now starts at the old end');
  assertClose(after.moves[0].a.y, endBefore.y, 1e-9, 'now starts at the old end');
  const newEnd = after.moves[after.moves.length - 1].b;
  assertClose(newEnd.x, startBefore.x, 1e-9, 'now ends at the old start');
  assertClose(newEnd.y, startBefore.y, 1e-9, 'now ends at the old start');
});

check('reversing does not change which elements drive backwards', () => {
  const RP = fresh();
  const { route, e2 } = staircase(RP);
  RP.selectedMoveId = e2.id;
  RP.updateSelectedMove({ reverse: true });

  RP.reverseRoute();
  const still = RP.findMove(route, e2.id);
  assert(still.reverse === true,
    'drive-backwards is a mechanism choice and must survive a path reversal');
});

check('drive backwards keeps the same endpoints, only the heading changes', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  RP.setEditMode('route');
  const el = RP.appendGeometryToRoute(a.line.id);
  const route = RP.routes[0];

  const fwd = RP.resolveRoute(route).moves[0];
  const fwdA = { x: fwd.a.x, y: fwd.a.y }, fwdB = { x: fwd.b.x, y: fwd.b.y };

  RP.selectedMoveId = el.id;
  RP.updateSelectedMove({ reverse: true });

  const rev = RP.resolveRoute(route).moves[0];
  assertClose(rev.a.x, fwdA.x, 1e-9, 'start unchanged');
  assertClose(rev.b.x, fwdB.x, 1e-9, 'end unchanged');
  const step = RP.computeSteps(route).filter(s => s.kind === 'forward')[0];
  assert(step.reverse === true, 'the move itself is driven in reverse');
});

// ---- single route ----------------------------------------------------
check('there is exactly one route, and loading extras trims to it', () => {
  const RP = fresh();
  assert(RP.routes.length === 1, 'starts with one route');
  // As if a multi-route save from before this change had been loaded.
  RP.routes.push({ id: 99, name: 'Extra', visible: true, elements: [] });
  RP.ensureSingleRoute();
  assert(RP.routes.length === 1, 'extras trimmed');
  assert(RP.routes[0].name !== 'Extra', 'the first route is the one kept');
});

check('ensureSingleRoute recreates a route if none exists', () => {
  const RP = fresh();
  RP.routes = [];
  const r = RP.ensureSingleRoute();
  assert(RP.routes.length === 1 && !!r, 'a route should be created');
  assert(Array.isArray(r.actions), 'with an action list ready');
  assert(RP.activeRouteId === r.id, 'and marked active');
});

check('getActiveRoute always returns the one route', () => {
  const RP = fresh();
  RP.activeRouteId = 12345;               // stale id
  assert(RP.getActiveRoute() === RP.routes[0],
    'lookup should not depend on activeRouteId any more');
});

if (!report()) process.exitCode = 1;
