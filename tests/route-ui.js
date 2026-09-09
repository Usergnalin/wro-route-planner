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
  RP.addGeometryToRoute(a.line.id);
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
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(b.line.id);
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
  const el = RP.addGeometryToRoute(a.line.id);
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
  const el = RP.addGeometryToRoute(a.line.id);
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
  RP.addGeometryToRoute(a.line.id);
  const second = RP.addGeometryToRoute(b.line.id);
  assert(second.flip === true, 'expected the second element to be flipped');
  assert(RP.resolveRoute(RP.routes[0]).ok, 'route should resolve as connected');
});

check('appending connected geometry builds a resolvable route', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(b.line.id);
  const res = RP.resolveRoute(RP.routes[0]);
  assert(res.ok, 'expected ok: ' + JSON.stringify(res));
  assert(res.moves.length === 2, 'two elements');
});

check('routeReferencedEntities reports what routes already use', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
  const refs = RP.routeReferencedEntities();
  assert(refs[a.line.id] === true, 'referenced line listed');
  assert(refs[b.line.id] === undefined, 'unreferenced line absent');
});

// ---- element editing -------------------------------------------------
check('element parameters round-trip into generated code', () => {
  const RP = fresh();
  const { a, b } = drawL(RP);
  RP.setEditMode('route');
  const e1 = RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(b.line.id);

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
  const el = RP.addGeometryToRoute(a.line.id);
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
  const e1 = RP.addGeometryToRoute(a.line.id);
  const e2 = RP.addGeometryToRoute(b.line.id);
  RP.selectedMoveId = e2.id;
  RP.reorderSelectedMove(-1);
  assert(RP.moveActions(RP.routes[0])[0].id === e2.id, 'second element moved to front');
});

check('route edits are undoable', () => {
  const RP = fresh();
  const { a } = drawL(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
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
  const e1 = RP.addGeometryToRoute(a.line.id);
  const e2 = RP.addGeometryToRoute(b.line.id);
  const e3 = RP.addGeometryToRoute(c.line.id);
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
  RP.addGeometryToRoute(a.line.id);
  const e2 = RP.addGeometryToRoute(b.line.id);
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
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(b.line.id);
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
  const el = RP.addGeometryToRoute(a.line.id);
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

// ---- smart insertion --------------------------------------------------
// Geometry lands where it CONNECTS, not always at the end. Editing the
// middle of a route is the normal case when adapting to a surprise
// mission, and an appended move there was always disconnected.

// Three collinear-ish legs forming one chain: A(0,0)-(100,0),
// B(100,0)-(200,0), C(200,0)-(200,100). Coincident at each junction.
function threeLegs(RP) {
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 200, 0);
  const c = RP.addConstructionLine(200, 0, 200, 100);
  const sk = RP.sketch;
  RP.Sketch.addConstraint(sk, 'coincident', [a.line.p2, b.line.p1]);
  RP.Sketch.addConstraint(sk, 'coincident', [b.line.p2, c.line.p1]);
  return { a, b, c };
}

const moveEntities = (RP) =>
  RP.moveActions(RP.getActiveRoute()).map(m => m.entityId);

check('drawing a route in order still appends', () => {
  const RP = fresh();
  const { a, b, c } = threeLegs(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(b.line.id);
  RP.addGeometryToRoute(c.line.id);
  assert(JSON.stringify(moveEntities(RP)) ===
         JSON.stringify([a.line.id, b.line.id, c.line.id]),
    'sequential drawing must not change, got ' + JSON.stringify(moveEntities(RP)));
});

check('geometry that bridges a gap lands IN the gap, not at the end', () => {
  const RP = fresh();
  const { a, b, c } = threeLegs(RP);
  RP.setEditMode('route');
  // Build the route with the middle leg missing.
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(c.line.id);
  assert(JSON.stringify(moveEntities(RP)) === JSON.stringify([a.line.id, c.line.id]),
    'setup: A then C');

  // B joins A's exit AND C's entry, so it belongs between them.
  RP.addGeometryToRoute(b.line.id);
  assert(JSON.stringify(moveEntities(RP)) ===
         JSON.stringify([a.line.id, b.line.id, c.line.id]),
    'B should have landed in the middle, got ' + JSON.stringify(moveEntities(RP)));
  assert(RP.resolveRoute(RP.getActiveRoute()).ok,
    'and the route should now be continuous');
});

check('the bridging insertion is what makes the route resolve at all', () => {
  const RP = fresh();
  const { a, b, c } = threeLegs(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(c.line.id);
  assert(!RP.resolveRoute(RP.getActiveRoute()).ok,
    'A then C alone is a broken route — that is the premise');
  RP.addGeometryToRoute(b.line.id);
  assert(RP.resolveRoute(RP.getActiveRoute()).ok, 'and B repairs it');
});

check('geometry joining only the FRONT is inserted at the front', () => {
  const RP = fresh();
  const { a, b, c } = threeLegs(RP);
  RP.setEditMode('route');
  RP.addGeometryToRoute(b.line.id);
  RP.addGeometryToRoute(c.line.id);
  // A meets B's entry and nothing else — it precedes the route.
  RP.addGeometryToRoute(a.line.id);
  assert(JSON.stringify(moveEntities(RP)) ===
         JSON.stringify([a.line.id, b.line.id, c.line.id]),
    'A should lead, got ' + JSON.stringify(moveEntities(RP)));
});

check('geometry touching nothing still goes on the end', () => {
  const RP = fresh();
  const { a, b } = threeLegs(RP);
  const far = RP.addConstructionLine(900, 900, 1000, 900);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(b.line.id);
  RP.addGeometryToRoute(far.line.id);
  assert(moveEntities(RP)[2] === far.line.id,
    'disconnected geometry keeps the old append behaviour');
});

check('insertion picks the traversal direction that connects', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  // Drawn "backwards": its p1 is the far end, so it must be flipped to
  // follow A.
  const b = RP.addConstructionLine(200, 0, 100, 0);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.line.p2, b.line.p2]);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(b.line.id);
  assert(RP.resolveRoute(RP.getActiveRoute()).ok,
    'the reversed line should still join up');
});

check('bestInsertionFor reports how well the geometry fits', () => {
  const RP = fresh();
  const { a, b, c } = threeLegs(RP);
  const far = RP.addConstructionLine(900, 900, 1000, 900);
  RP.setEditMode('route');
  RP.addGeometryToRoute(a.line.id);
  RP.addGeometryToRoute(c.line.id);
  const route = RP.getActiveRoute();

  assert(RP.bestInsertionFor(route, b.line.id).joins === 2,
    'B bridges both sides');
  assert(RP.bestInsertionFor(route, far.line.id).joins === 0,
    'unrelated geometry joins nothing');
});

check('an empty route puts the first move at index 0', () => {
  const RP = fresh();
  const { a } = threeLegs(RP);
  RP.setEditMode('route');
  const where = RP.bestInsertionFor(RP.getActiveRoute(), a.line.id);
  assert(where.index === 0, 'expected 0, got ' + where.index);
});

// ---- picking among overlapping moves ---------------------------------
// Driving out and back along ONE line is two moves on one entity, at
// identical distance from any click. Nearest-wins alone always kept the
// first, so the second could never be selected at all.

check('two moves on the same line are both reachable by clicking', () => {
  const RP = fresh();
  const l = RP.addConstructionLine(0, 0, 400, 0);
  RP.setEditMode('route');
  const out = RP.addMove(RP.getActiveRoute().id, l.line.id, { move: 'forward' });
  const back = RP.addMove(RP.getActiveRoute().id, l.line.id, { move: 'forward', reverse: true });
  assert(out.id !== back.id, 'two distinct moves on one entity');

  const first = RP.routeHitTest(200, 0);
  assert(first && first.kind === 'move', 'the line should be hit');
  RP.selectedActionId = first.id;
  const second = RP.routeHitTest(200, 0);
  assert(second.id !== first.id,
    'clicking again must advance to the other move, got the same one');

  RP.selectedActionId = second.id;
  const third = RP.routeHitTest(200, 0);
  assert(third.id === first.id, 'and cycle back round');
});

check('cycling reaches every move on the line, not just two', () => {
  const RP = fresh();
  const l = RP.addConstructionLine(0, 0, 400, 0);
  RP.setEditMode('route');
  const ids = [0, 1, 2].map(() =>
    RP.addMove(RP.getActiveRoute().id, l.line.id, { move: 'forward' }).id);

  const seen = new Set();
  let hit = RP.routeHitTest(200, 0);
  for (let i = 0; i < 6 && hit; i++) {
    seen.add(hit.id);
    RP.selectedActionId = hit.id;
    hit = RP.routeHitTest(200, 0);
  }
  for (const id of ids) assert(seen.has(id), 'move ' + id + ' was never reachable');
});

check('a clearly nearer move still wins over a distant one', () => {
  const RP = fresh();
  const near = RP.addConstructionLine(0, 0, 400, 0);
  const far = RP.addConstructionLine(0, 300, 400, 300);
  RP.setEditMode('route');
  const nearMove = RP.addMove(RP.getActiveRoute().id, near.line.id, { move: 'forward' });
  RP.addMove(RP.getActiveRoute().id, far.line.id, { move: 'forward' });
  const hit = RP.routeHitTest(200, 1);
  assert(hit.id === nearMove.id,
    'cycling must not turn picking into a lottery among far-apart lines');
});

check('a hidden move is not in the cycle', () => {
  const RP = fresh();
  const l = RP.addConstructionLine(0, 0, 400, 0);
  RP.setEditMode('route');
  const a = RP.addMove(RP.getActiveRoute().id, l.line.id, { move: 'forward' });
  const b = RP.addMove(RP.getActiveRoute().id, l.line.id, { move: 'forward' });
  RP.setMoveProps(RP.getActiveRoute().id, b.id, { visible: false });
  RP.selectedActionId = a.id;
  const hit = RP.routeHitTest(200, 0);
  assert(hit.id === a.id, 'hidden geometry has no clickable presence');
});

// ---- action rows are tellable apart ----------------------------------
check('a move knows its own length in mm', () => {
  const RP = fresh();                       // 2 px per mm
  const l = RP.addConstructionLine(0, 0, 400, 0);
  RP.setEditMode('route');
  const m = RP.addMove(RP.getActiveRoute().id, l.line.id, { move: 'forward' });
  assertClose(RP.moveLengthMm(m), 200, 1e-9, '400px at 2px/mm');
});

check('moveLengthMm measures an arc along its curve, not its chord', () => {
  const RP = fresh();
  const arc = RP.addConstructionArc(0, 0, 400, 0, { sagitta: 100 });
  RP.setEditMode('route');
  const m = RP.addMove(RP.getActiveRoute().id, arc.arc.id, { move: 'arc' });
  const len = RP.moveLengthMm(m);
  assert(len > 200, 'an arc is longer than its 200mm chord, got ' + len);
});

check('moveLengthMm declines rather than guessing without calibration', () => {
  const RP = fresh();
  const l = RP.addConstructionLine(0, 0, 400, 0);
  RP.setEditMode('route');
  const m = RP.addMove(RP.getActiveRoute().id, l.line.id, { move: 'forward' });
  RP.calibration = null;
  assert(RP.moveLengthMm(m) === null, 'no px/mm means no answer');
});

// ---- route segments ---------------------------------------------------
// Segments are DERIVED from boundary markers, so they move with edits.
// A route with no markers is one segment and behaves exactly as before.

function fourLegs(RP) {
  const pts = [[0,0,100,0],[100,0,200,0],[200,0,300,0],[300,0,300,100]];
  const made = pts.map(p => RP.addConstructionLine(p[0],p[1],p[2],p[3]));
  for (let i = 1; i < made.length; i++) {
    RP.Sketch.addConstraint(RP.sketch, 'coincident',
      [made[i-1].line.p2, made[i].line.p1]);
  }
  RP.setEditMode('route');
  const route = RP.getActiveRoute();
  const moves = made.map(m => RP.addMove(route.id, m.line.id, { move: 'forward' }));
  return { route, moves };
}

check('an unsegmented route is one segment and gains no marker action', () => {
  const RP = fresh();
  const { route } = fourLegs(RP);
  const before = RP.routeActions(route).length;
  const segs = RP.routeSegments(route);
  assert(segs.length === 1, 'one segment, got ' + segs.length);
  assert(segs[0].moves.length === 4, 'covering every move');
  assert(RP.routeActions(route).length === before,
    'and asking must not have inserted anything into the action list');
  assert(RP.routeActions(route).every(a => !RP.isSegmentAction(a)),
    'no marker forced onto a route that never asked for one');
});

check('splitting at a move starts a new segment there', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  RP.splitSegmentHere();
  const segs = RP.routeSegments(route);
  assert(segs.length === 2, 'two segments, got ' + segs.length);
  assert(segs[0].moves.length === 2, 'first holds moves 1-2, got ' + segs[0].moves.length);
  assert(segs[1].moves.length === 2, 'second holds moves 3-4, got ' + segs[1].moves.length);
});

check('one segment ends exactly where the next begins', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  RP.splitSegmentHere();
  const segs = RP.routeSegments(route);
  assert(segs[0].end + 1 === segs[1].start,
    'no gap and no overlap between segments');
  const all = segs.reduce((n, g) => n + g.actions.length, 0);
  assert(all === RP.routeActions(route).length,
    'and every action belongs to exactly one segment');
});

check('boundaries move with edits rather than going stale', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  RP.splitSegmentHere();
  // Delete a move from the FIRST segment. A stored {start,end} pair would
  // now be pointing at the wrong actions; derived boundaries just shift.
  RP.removeMove(route.id, moves[0].id);
  const segs = RP.routeSegments(route);
  assert(segs.length === 2, 'still two segments');
  assert(segs[1].moves.length === 2, 'the second segment is untouched, got ' + segs[1].moves.length);
  assert(segs[0].moves.length === 1, 'the first lost the deleted move, got ' + segs[0].moves.length);
});

check('removing a boundary merges into the segment above', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  const m = RP.splitSegmentHere();
  assert(RP.routeSegments(route).length === 2, 'split happened');
  RP.removeSegmentMarker(route.id, m.id);
  const segs = RP.routeSegments(route);
  assert(segs.length === 1, 'back to one, got ' + segs.length);
  assert(segs[0].moves.length === 4, 'with every move, got ' + segs[0].moves.length);
});

// ---- hiding -----------------------------------------------------------
check('hiding a segment hides its moves in the derived view', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  const m = RP.splitSegmentHere();
  RP.setSegmentProps(route.id, m.id, { visible: false });
  RP.rebuildRouteViews();

  const segView = id => route.segments.find(s => s.id === id);
  assert(segView(moves[2].id).visible === false, 'move 3 hidden');
  assert(segView(moves[3].id).visible === false, 'move 4 hidden');
  assert(segView(moves[0].id).visible === true, 'moves in the other segment untouched');
});

check('a hidden segment leaves the moves own visible flag alone', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  const m = RP.splitSegmentHere();
  RP.setSegmentProps(route.id, m.id, { visible: false });
  RP.rebuildRouteViews();
  assert(RP.findMove(route, moves[2].id).visible !== false,
    'the move itself was never hidden, so un-hiding the segment restores what the user had');
  RP.setSegmentProps(route.id, m.id, { visible: true });
  RP.rebuildRouteViews();
  assert(route.segments.find(s => s.id === moves[2].id).visible === true, 'and it comes back');
});

check('a hidden segments moves are not clickable', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  const m = RP.splitSegmentHere();
  const hit = RP.routeHitTest(250, 0);
  assert(hit && hit.id === moves[2].id, 'reachable while shown');
  RP.setSegmentProps(route.id, m.id, { visible: false });
  const after = RP.routeHitTest(250, 0);
  assert(!after || after.id !== moves[2].id,
    'hidden means no clickable presence, same rule as everywhere else');
});

// ---- code inclusion ---------------------------------------------------
const moveCalls = code => (code.match(/move_distance\(/g) || []).length;

check('every segment is in the code by default', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  RP.splitSegmentHere();
  assert(moveCalls(RP.generateCode(route)) === 4, 'all four legs emitted');
});

check('excluding a segment drops exactly its moves from the code', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  const m = RP.splitSegmentHere();
  RP.setSegmentProps(route.id, m.id, { included: false });
  assert(moveCalls(RP.generateCode(route)) === 2,
    'only the first segment should be emitted');
});

check('excluded code says it is partial and where it assumes the robot is', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.robotConfig.startPos = { x: 0, y: 0 };
  RP.robotConfig.startHeading = 0;
  RP.selectedActionId = moves[2].id;
  const m = RP.splitSegmentHere();
  RP.setSegmentProps(route.id, null, { included: false });   // drop the LEAD
  const code = RP.generateCode(route);
  assert(/PARTIAL ROUTE/.test(code), 'must say it is partial, got:\n' + code);
  assert(/Assumes the robot starts at/.test(code),
    'running a middle section needs its start pose stated, got:\n' + code);

  // ...but saying it is pointless when the kept part starts where the
  // route does, since the Start line already says so.
  const RP2 = fresh();
  const two = fourLegs(RP2);
  RP2.robotConfig.startPos = { x: 0, y: 0 };
  RP2.selectedActionId = two.moves[2].id;
  const m2 = RP2.splitSegmentHere();
  RP2.setSegmentProps(two.route.id, m2.id, { included: false });   // drop the TAIL
  const code2 = RP2.generateCode(two.route);
  assert(/PARTIAL ROUTE/.test(code2), 'still partial');
  assert(!/Assumes the robot starts at/.test(code2),
    'and should not repeat the start pose it already prints, got:\n' + code2);
});

check('hiding and including are independent switches', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  RP.selectedActionId = moves[2].id;
  const m = RP.splitSegmentHere();
  // Hidden but still in the code — wanting to see less while running the
  // whole thing is completely ordinary.
  RP.setSegmentProps(route.id, m.id, { visible: false });
  assert(moveCalls(RP.generateCode(route)) === 4,
    'hiding must not change what the robot runs');
  // ...and the reverse.
  RP.setSegmentProps(route.id, m.id, { visible: true, included: false });
  RP.rebuildRouteViews();
  assert(route.segments.find(s => s.id === moves[2].id).visible === true,
    'excluding must not change what is drawn');
});

check('kept segments keep the headings they have in the whole route', () => {
  const RP = fresh();
  const { route, moves } = fourLegs(RP);
  // Leg 4 turns a corner. Excluding the lead must not change ITS turn,
  // because continuity is still computed across the entire route.
  const whole = RP.generateCode(route);
  const wholeTurn = (whole.match(/turn_in_place\((-?[\d.]+)/g) || []).pop();
  RP.selectedActionId = moves[3].id;
  const m = RP.splitSegmentHere();
  RP.setSegmentProps(route.id, null, { included: false });
  const part = RP.generateCode(route);
  const partTurn = (part.match(/turn_in_place\((-?[\d.]+)/g) || []).pop();
  assert(wholeTurn === partTurn,
    'the corner turn should be identical, got ' + partTurn + ' vs ' + wholeTurn);
});

if (!report()) process.exitCode = 1;
