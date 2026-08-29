/* ========================================================================
   sim.js - Phase 12: pose track + collision sweep.

   Pure geometry over the route, the robot body and obstacle geometry.
   No DOM.

     node tests/sim.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('simulation');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  ['render', 'updateLayerList', 'updateInfoPanel', 'updateInstructions',
   'updateConstraintPanel', 'updateRouteSelect', 'updateSideRouteList']
    .forEach(k => { RP[k] = function () {}; });
  RP.calibration = { pixelsPerMm: 1 };   // 1 px = 1 mm keeps the numbers readable
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  RP.ensureSingleRoute();
  return RP;
}

// A 100 x 60 robot, turning centre 20 behind the nose... i.e. body spans
// -30..+70 in x and -30..+30 in y about the pivot.
function drawRobot(RP) {
  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.addConstructionLine(0, 0, 100, 0);
  RP.addConstructionLine(100, 0, 100, 60);
  RP.addConstructionLine(100, 60, 0, 60);
  RP.addConstructionLine(0, 60, 0, 0);
  const d = RP.addConstructionLine(30, 30, 80, 30);   // pivot at x=30, forward +x
  RP.setGeometryRole(d.line.id, RP.DRIVE_ROLE);
  RP.setActiveDoc(RP.DOC_MAT);
  return d;
}

// One straight move along y=500 from x=200 to x=1200, driven forwards.
function straightRoute(RP) {
  const l = RP.addConstructionLine(200, 500, 1200, 500);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 200, y: 500 };
  RP.robotConfig.startHeading = 0;      // +x
  const m = RP.addMove(route.id, l.line.id, { move: 'forward' });
  return { route, line: l, move: m };
}

function obstacle(RP, x1, y1, x2, y2) {
  const l = RP.addConstructionLine(x1, y1, x2, y2);
  RP.setGeometryRole(l.line.id, RP.OBSTACLE_ROLE);
  return l;
}

// ---- footprint hull --------------------------------------------------
check('the footprint reduces to a convex hull of the drawn body', () => {
  const RP = fresh();
  drawRobot(RP);
  const hull = RP.convexHull(RP.robotFootprint().points);
  assert(hull.length === 4, 'a rectangle should hull to 4 corners, got ' + hull.length);
  const xs = hull.map(p => p.x), ys = hull.map(p => p.y);
  assertClose(Math.min(...xs), -30, 1e-9, 'rear');
  assertClose(Math.max(...xs), 70, 1e-9, 'front');
  assertClose(Math.min(...ys), -30, 1e-9, 'left');
  assertClose(Math.max(...ys), 30, 1e-9, 'right');
});

check('the hull is placed and rotated correctly at a pose', () => {
  const RP = fresh();
  drawRobot(RP);
  const hull = RP.convexHull(RP.robotFootprint().points);
  // Facing +y (90°) at (1000, 1000): the body's forward axis is now +y.
  const poly = RP.footprintAt(hull, { x: 1000, y: 1000, deg: 90 });
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  assertClose(Math.max(...ys), 1070, 1e-9, '70 ahead becomes +y');
  assertClose(Math.min(...ys), 970, 1e-9, '30 behind becomes -y');
  assertClose(Math.max(...xs), 1030, 1e-9, 'half-width either side');
  assertClose(Math.min(...xs), 970, 1e-9, 'half-width either side');
});

// ---- pose track ------------------------------------------------------
check('a straight route produces poses along it at the right heading', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  const track = RP.simPoseTrack(route);
  assert(track.ok, 'track failed: ' + track.reason);
  assert(track.poses.length > 100, 'expected dense sampling, got ' + track.poses.length);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.x, 1200, 1e-6, 'ends at the far end');
  assertClose(last.y, 500, 1e-6, 'stays on the line');
  for (const p of track.poses) assertClose(p.deg % 360, 0, 1e-6, 'heading stays +x');
  assertClose(last.distMm, 1000, 1e-6, 'cumulative distance is the leg length');
});

check('a turn in place is sampled, not skipped', () => {
  const RP = fresh();
  drawRobot(RP);
  const a = RP.addConstructionLine(500, 500, 900, 500);      // east
  const b = RP.addConstructionLine(900, 500, 900, 900);      // then south
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.line.p2, b.line.p1]);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 500, y: 500 };
  RP.robotConfig.startHeading = 0;
  RP.addMove(route.id, a.line.id, { move: 'forward' });
  RP.addMove(route.id, b.line.id, { move: 'forward' });

  const track = RP.simPoseTrack(route);
  assert(track.ok, 'track failed: ' + track.reason);
  // The corner is at (900,500); there must be poses there at intermediate
  // headings, or a body pivoting into an obstacle would never be seen.
  const atCorner = track.poses.filter(p =>
    Math.abs(p.x - 900) < 1e-6 && Math.abs(p.y - 500) < 1e-6);
  assert(atCorner.length > 4, 'expected a sampled sweep at the corner, got ' + atCorner.length);
  const headings = atCorner.map(p => ((p.deg % 360) + 360) % 360);
  assert(Math.max(...headings) > 10 && Math.max(...headings) < 90.001,
    'intermediate headings should span the turn, got ' + JSON.stringify(headings));
});

check('a reversing move faces opposite its direction of travel', () => {
  const RP = fresh();
  drawRobot(RP);
  const l = RP.addConstructionLine(200, 500, 1200, 500);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 200, y: 500 };
  RP.robotConfig.startHeading = 180;
  RP.addMove(route.id, l.line.id, { move: 'forward', reverse: true });
  const track = RP.simPoseTrack(route);
  assert(track.ok, 'track failed: ' + track.reason);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.x, 1200, 1e-6, 'still travels to the far end');
  const deg = ((last.deg % 360) + 360) % 360;
  assertClose(deg, 180, 1e-6, 'but the chassis faces backwards along it');
});

check('a broken route reports why instead of producing poses', () => {
  const RP = fresh();
  drawRobot(RP);
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(900, 900, 1000, 900);   // nowhere near a
  const route = RP.routes[0];
  RP.addMove(route.id, a.line.id, { move: 'forward' });
  RP.addMove(route.id, b.line.id, { move: 'forward' });
  const track = RP.simPoseTrack(route);
  assert(!track.ok, 'a disconnected route should not silently produce a path');
  assert(track.poses.length === 0, 'and no poses');
});

// ---- collisions ------------------------------------------------------
check('a clear route reports no collisions', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  obstacle(RP, 600, 900, 800, 900);      // far below the path
  const res = RP.simCollisions(route);
  assert(res.ok, 'sim failed: ' + res.reason);
  assert(res.hits.length === 0, 'expected no hits, got ' + res.hits.length);
});

check('an obstacle across the path is reported, with where it happened', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  const o = obstacle(RP, 700, 400, 700, 600);   // a wall straight across
  const res = RP.simCollisions(route);
  assert(res.ok, 'sim failed: ' + res.reason);
  assert(res.hits.length === 1, 'expected one episode, got ' + res.hits.length);
  const hit = res.hits[0];
  assert(hit.obstacleIds.indexOf(o.line.id) >= 0, 'should name the obstacle it hit');
  // The nose reaches 70 ahead of the pivot, so contact starts around x=630.
  assert(hit.x > 600 && hit.x < 660,
    'contact should begin about a nose-length early, got x=' + hit.x);
});

check('an obstacle just outside the body width is missed, one just inside is hit', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  // Body half-width is 30. A point obstacle 40 off the centreline is clear.
  obstacle(RP, 700, 540, 720, 540);
  let res = RP.simCollisions(route);
  assert(res.hits.length === 0, '40 off the centreline should clear a 30 half-width');

  const RP2 = fresh();
  drawRobot(RP2);
  const r2 = straightRoute(RP2).route;
  obstacle(RP2, 700, 520, 720, 520);   // 20 off — inside the body
  res = RP2.simCollisions(r2);
  assert(res.hits.length === 1, '20 off the centreline should be hit');
});

check('brushing along a wall is one episode, not one warning per sample', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  // A long obstacle running parallel, just inside the body's edge.
  obstacle(RP, 400, 525, 1000, 525);
  const res = RP.simCollisions(route);
  assert(res.ok, 'sim failed: ' + res.reason);
  assert(res.hits.length === 1,
    'a 600mm graze is one problem, got ' + res.hits.length + ' warnings');
  assert(res.hits[0].poses > 50,
    'and it should know how long it lasted, got ' + res.hits[0].poses);
});

check('two separate obstacles give two separate episodes', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  obstacle(RP, 500, 400, 500, 600);
  obstacle(RP, 1000, 400, 1000, 600);
  const res = RP.simCollisions(route);
  assert(res.hits.length === 2, 'expected two episodes, got ' + res.hits.length);
  assert(res.hits[0].x < res.hits[1].x, 'reported in travel order');
});

check('the body sweeping through a turn can collide even though the path does not', () => {
  const RP = fresh();
  drawRobot(RP);
  const a = RP.addConstructionLine(500, 500, 900, 500);
  const b = RP.addConstructionLine(900, 500, 900, 900);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.line.p2, b.line.p1]);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 500, y: 500 };
  RP.robotConfig.startHeading = 0;
  RP.addMove(route.id, a.line.id, { move: 'forward' });
  RP.addMove(route.id, b.line.id, { move: 'forward' });

  // Diagonally off the corner. Facing +x the body spans x 870..970 /
  // y 470..530; facing +y it spans x 870..930 / y 470..570. This point is
  // outside BOTH, and is only reached at the intermediate angles the
  // robot passes through while pivoting.
  obstacle(RP, 940, 542, 950, 552);
  const res = RP.simCollisions(route);
  assert(res.ok, 'sim failed: ' + res.reason);
  assert(res.hits.length >= 1,
    'the swept body should catch this even though neither leg reaches it');
});

check('no robot body means the simulator declines rather than guessing one', () => {
  const RP = fresh();
  const { route } = straightRoute(RP);
  obstacle(RP, 700, 400, 700, 600);
  const res = RP.simCollisions(route);
  assert(!res.ok, 'should not run without a body');
  assert(/robot body/.test(res.reason), 'and should say why, got ' + res.reason);
});

check('geometry not tagged as an obstacle is driven through freely', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  RP.addConstructionLine(700, 400, 700, 600);   // plain construction line
  const res = RP.simCollisions(route);
  assert(res.ok, 'sim failed: ' + res.reason);
  assert(res.hits.length === 0, 'only tagged obstacles collide');
});

check('a hidden obstacle stops colliding', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  const o = obstacle(RP, 700, 400, 700, 600);
  assert(RP.simCollisions(route).hits.length === 1, 'hits while visible');
  RP.setConstructionVisible(o.line.id, false);
  assert(RP.simCollisions(route).hits.length === 0,
    'hidden geometry has no presence, same as everywhere else');
});

check('an obstacle arc is flattened and still collides', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  const arc = RP.addConstructionArc(700, 400, 700, 600, { sagitta: 60 });
  RP.setGeometryRole(arc.arc.id, RP.OBSTACLE_ROLE);
  const res = RP.simCollisions(route);
  assert(res.ok, 'sim failed: ' + res.reason);
  assert(res.hits.length >= 1, 'a curved obstacle across the path should be hit');
});

if (!report()) process.exitCode = 1;
