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

// ---- uncertainty -----------------------------------------------------
// Drift is OFF by default; every test above therefore ran at the body's
// true size, and these are the only ones that turn it on.

check('with drift off the uncertainty stays zero', () => {
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  const track = RP.simPoseTrack(route);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.ux, 0, 1e-12, 'no drift configured');
  assertClose(last.uy, 0, 1e-12, 'no drift configured');
});

check('uncertainty grows with distance driven', () => {
  const RP = fresh();
  drawRobot(RP);
  RP.robotConfig.driftPerMm = 0.01;         // 1% of distance
  const { route } = straightRoute(RP);       // 1000mm leg
  const track = RP.simPoseTrack(route);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.ux, 10, 1e-6, '1% of 1000mm');
  assertClose(last.uy, 10, 1e-6, 'equally in both axes');
  // And it grows monotonically, not all at the end.
  const mid = track.poses[Math.floor(track.poses.length / 2)];
  assert(mid.ux > 0 && mid.ux < last.ux, 'should accumulate along the way');
});

check('a wall align clears the axis normal to the wall and keeps the other', () => {
  const RP = fresh();
  drawRobot(RP);
  RP.robotConfig.driftPerMm = 0.01;
  // Drive east into a VERTICAL wall: that fixes x, and says nothing about y.
  const wall = RP.addConstructionLine(1300, 0, 1300, 1000);
  RP.setGeometryRole(wall.line.id, RP.FIELD_ROLE);
  const l = RP.addConstructionLine(200, 500, 1200, 500);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 200, y: 500 };
  RP.robotConfig.startHeading = 0;
  const m = RP.addMove(route.id, l.line.id, { move: 'wall_align' });
  RP.Sketch.addConstraint(RP.sketch, 'point_line_distance',
    [l.line.p2, wall.line.id], 100);

  const track = RP.simPoseTrack(route);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.ux, 0, 1e-9, 'distance to a vertical wall is measured -> x is fixed');
  assert(last.uy > 5, 'position ALONG the wall is not, got ' + last.uy);
});

check('a line trace clears lateral uncertainty and keeps along-track', () => {
  const RP = fresh();
  drawRobot(RP);
  RP.robotConfig.driftPerMm = 0.01;
  const l = RP.addConstructionLine(200, 500, 1200, 500);   // runs along x
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 200, y: 500 };
  RP.robotConfig.startHeading = 0;
  RP.addMove(route.id, l.line.id, { move: 'linetrace_dist' });
  const track = RP.simPoseTrack(route);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.uy, 0, 1e-9, 'a follower knows which side of the line it is on');
  assert(last.ux > 5, 'but not how far along, got ' + last.ux);
});

check('a junction line trace clears both axes', () => {
  const RP = fresh();
  drawRobot(RP);
  RP.robotConfig.driftPerMm = 0.01;
  const l = RP.addConstructionLine(200, 500, 1200, 500);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 200, y: 500 };
  RP.robotConfig.startHeading = 0;
  RP.addMove(route.id, l.line.id, { move: 'linetrace_junct' });
  const track = RP.simPoseTrack(route);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.ux, 0, 1e-9, 'crossing a counted junction is a longitudinal fix too');
  assertClose(last.uy, 0, 1e-9, 'and the line itself fixes lateral');
});

check('uncertainty resumes growing after a correction', () => {
  const RP = fresh();
  drawRobot(RP);
  RP.robotConfig.driftPerMm = 0.01;
  const a = RP.addConstructionLine(200, 500, 1200, 500);
  const b = RP.addConstructionLine(1200, 500, 1200, 900);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.line.p2, b.line.p1]);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 200, y: 500 };
  RP.robotConfig.startHeading = 0;
  RP.addMove(route.id, a.line.id, { move: 'linetrace_junct' });   // zeroes both
  RP.addMove(route.id, b.line.id, { move: 'forward' });           // 400mm more
  const track = RP.simPoseTrack(route);
  const last = track.poses[track.poses.length - 1];
  assertClose(last.ux, 4, 1e-6, '1% of the 400mm driven since the reset');
});

check('the correction generalises to a wall that is not axis-aligned', () => {
  const RP = fresh();
  // A 45° tangent should leave equal x and y components, and the total
  // along-wall uncertainty should be preserved rather than invented.
  const u = { ux: 10, uy: 10 };
  RP.simCorrectAlong(u, 1, 1);
  assertClose(u.ux, u.uy, 1e-9, 'symmetric input, symmetric output');
  assert(u.ux > 0 && u.ux < 10, 'partially corrected, got ' + u.ux);
});

check('correcting along an axis leaves that axis untouched and zeroes the other', () => {
  const RP = fresh();
  let u = { ux: 7, uy: 3 };
  RP.simCorrectAlong(u, 0, 1);            // surviving direction is y
  assertClose(u.ux, 0, 1e-12, 'x measured away');
  assertClose(u.uy, 3, 1e-12, 'y untouched');

  u = { ux: 7, uy: 3 };
  RP.simCorrectAlong(u, 1, 0);            // surviving direction is x
  assertClose(u.ux, 7, 1e-12, 'x untouched');
  assertClose(u.uy, 0, 1e-12, 'y measured away');
});

// ---- uncertainty feeding collisions ----------------------------------
check('inflateHull grows a polygon by the uncertainty box, not about its centre', () => {
  const RP = fresh();
  const square = [{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}];
  const big = RP.inflateHull(square, 5, 2);
  const xs = big.map(p => p.x), ys = big.map(p => p.y);
  assertClose(Math.min(...xs), -15, 1e-9, 'grown by ux each side');
  assertClose(Math.max(...xs), 15, 1e-9, 'grown by ux each side');
  assertClose(Math.min(...ys), -12, 1e-9, 'and by uy, independently');
  assertClose(Math.max(...ys), 12, 1e-9, 'and by uy, independently');
});

check('drift turns a near miss into a possible collision, marked as not certain', () => {
  // 40mm off the centreline clears a 30mm half-width by 10mm — the
  // "just outside" case from the exact tests above.
  const RP = fresh();
  drawRobot(RP);
  const { route } = straightRoute(RP);
  obstacle(RP, 700, 540, 720, 540);
  assert(RP.simCollisions(route).hits.length === 0, 'clear at true size');

  const RP2 = fresh();
  drawRobot(RP2);
  RP2.robotConfig.driftPerMm = 0.05;      // 5%: ~25mm by the time it gets there
  const r2 = straightRoute(RP2).route;
  obstacle(RP2, 700, 540, 720, 540);
  const res = RP2.simCollisions(r2);
  assert(res.hits.length === 1, 'drift should bring it into reach, got ' + res.hits.length);
  assert(res.hits[0].certain === false,
    'and it must be reported as POSSIBLE, not certain — the body itself misses');
});

check('a collision that happens at true size is still marked certain under drift', () => {
  const RP = fresh();
  drawRobot(RP);
  RP.robotConfig.driftPerMm = 0.05;
  const { route } = straightRoute(RP);
  obstacle(RP, 700, 400, 700, 600);       // straight across the path
  const res = RP.simCollisions(route);
  assert(res.hits.length >= 1, 'still hit');
  assert(res.hits[0].certain === true,
    'the body hits this one whether it drifted or not');
});

check('a correction shrinks the swept body again', () => {
  const RP = fresh();
  drawRobot(RP);
  RP.robotConfig.driftPerMm = 0.05;
  // Line-trace the first leg (zeroes lateral), then continue past the
  // obstacle that only a drifted body would reach.
  const a = RP.addConstructionLine(200, 500, 700, 500);
  const b = RP.addConstructionLine(700, 500, 1200, 500);
  RP.Sketch.addConstraint(RP.sketch, 'coincident', [a.line.p2, b.line.p1]);
  const route = RP.routes[0];
  RP.robotConfig.startPos = { x: 200, y: 500 };
  RP.robotConfig.startHeading = 0;
  RP.addMove(route.id, a.line.id, { move: 'linetrace_junct' });
  RP.addMove(route.id, b.line.id, { move: 'forward' });
  // Placed far enough past the reset that the PRE-reset body cannot reach
  // it either. By the end of leg a the drifted body spans to x≈795 / y≈555,
  // so an obstacle at x=900 is out of its reach; after the reset the robot
  // has driven only 200mm by the time its nose gets there, so uy≈10mm and
  // the body reaches y≈540 — under this obstacle at 545.
  obstacle(RP, 900, 545, 920, 545);
  const res = RP.simCollisions(route);
  assert(res.ok, 'sim failed: ' + res.reason);
  assert(res.hits.length === 0,
    'the junction reset should have shrunk the body back under this, got ' + res.hits.length);

  // And without the reset, the same obstacle IS reached — otherwise this
  // test would pass for the wrong reason.
  const RP3 = fresh();
  drawRobot(RP3);
  RP3.robotConfig.driftPerMm = 0.05;
  const a3 = RP3.addConstructionLine(200, 500, 700, 500);
  const b3 = RP3.addConstructionLine(700, 500, 1200, 500);
  RP3.Sketch.addConstraint(RP3.sketch, 'coincident', [a3.line.p2, b3.line.p1]);
  RP3.robotConfig.startPos = { x: 200, y: 500 };
  RP3.robotConfig.startHeading = 0;
  RP3.addMove(RP3.routes[0].id, a3.line.id, { move: 'forward' });   // no reset
  RP3.addMove(RP3.routes[0].id, b3.line.id, { move: 'forward' });
  obstacle(RP3, 900, 545, 920, 545);
  assert(RP3.simCollisions(RP3.routes[0]).hits.length === 1,
    'without the correction the accumulated drift should reach this');
});

if (!report()) process.exitCode = 1;
