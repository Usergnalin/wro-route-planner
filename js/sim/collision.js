/* ========================================================================
   collision.js - Sweep the robot's footprint along the pose track and
   report where it meets an obstacle.

   Pure geometry, no DOM. Reads: RP.simPoseTrack (poses), RP.robotFootprint
   (body, robot-local), RP.obstacleSegments (mat, flattened). Writes
   nothing.

   The footprint is reduced to its CONVEX HULL once, up front. A robot
   body drawn as loose lines is a point cloud, not an ordered polygon, and
   there is no reliable way to order it — the hull is the smallest polygon
   containing everything drawn, so it is conservative in the right
   direction: it can report a collision the real concave body would have
   squeezed past, but it can never miss one.
   ======================================================================== */
var RP = window.RP || {};

// Andrew's monotone chain. Returns hull points counter-clockwise in
// screen coordinates (y down), or the input when it is degenerate.
RP.convexHull = function(pts) {
  if (!pts || pts.length < 3) return (pts || []).slice();
  var p = pts.slice().sort(function(a, b) { return a.x - b.x || a.y - b.y; });
  var cross = function(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  };
  var lower = [], i;
  for (i = 0; i < p.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop();
    lower.push(p[i]);
  }
  var upper = [];
  for (i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  lower.pop(); upper.pop();
  var hull = lower.concat(upper);
  return hull.length >= 3 ? hull : p;
};

function _segHit(ax, ay, bx, by, cx, cy, dx, dy) {
  function d(px, py, qx, qy, rx, ry) {
    return (qx - px) * (ry - py) - (qy - py) * (rx - px);
  }
  var d1 = d(cx, cy, dx, dy, ax, ay);
  var d2 = d(cx, cy, dx, dy, bx, by);
  var d3 = d(ax, ay, bx, by, cx, cy);
  var d4 = d(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // Collinear touching counts: a body exactly grazing an obstacle edge is
  // a collision as far as a competition robot is concerned.
  function on(px, py, qx, qy, rx, ry) {
    return Math.abs(d(px, py, qx, qy, rx, ry)) < 1e-9 &&
           Math.min(px, qx) - 1e-9 <= rx && rx <= Math.max(px, qx) + 1e-9 &&
           Math.min(py, qy) - 1e-9 <= ry && ry <= Math.max(py, qy) + 1e-9;
  }
  return on(cx, cy, dx, dy, ax, ay) || on(cx, cy, dx, dy, bx, by) ||
         on(ax, ay, bx, by, cx, cy) || on(ax, ay, bx, by, dx, dy);
}

RP.pointInPoly = function(poly, x, y) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

// Does a closed polygon touch a segment? Either an edge crosses it, or
// the segment lies wholly inside — the second case is what catches a
// small obstacle swallowed by the body rather than clipped by its edge.
RP.polyHitsSegment = function(poly, s) {
  for (var i = 0; i < poly.length; i++) {
    var a = poly[i], b = poly[(i + 1) % poly.length];
    if (_segHit(a.x, a.y, b.x, b.y, s.x1, s.y1, s.x2, s.y2)) return true;
  }
  return RP.pointInPoly(poly, s.x1, s.y1);
};

// The robot's hull placed at one pose, in mat pixels.
RP.footprintAt = function(hull, pose) {
  var rad = pose.deg * Math.PI / 180;
  var c = Math.cos(rad), s = Math.sin(rad);
  var out = new Array(hull.length);
  for (var i = 0; i < hull.length; i++) {
    var p = hull[i];
    out[i] = { x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c };
  }
  return out;
};

// Run the whole thing.
//
//   { ok, reason, hits: [{ x, y, deg, actionId, obstacleId, distMm }], poses, hull }
//
// `hits` is one entry per CONTACT EPISODE, not per sampled pose: brushing
// along a wall for 200mm is one problem to look at, not forty identical
// warnings. A new episode starts when the set of obstacles being touched
// changes.
RP.simCollisions = function(route, opts) {
  route = route || (RP.getActiveRoute && RP.getActiveRoute());
  var fp = RP.robotFootprint();
  if (!fp.ok) return { ok: false, reason: 'no robot body', hits: [], poses: [], hull: [] };

  var hull = RP.convexHull(fp.points);
  if (hull.length < 3) return { ok: false, reason: 'robot body is not an area', hits: [], poses: [], hull: hull };

  var segs = RP.obstacleSegments();
  var track = RP.simPoseTrack(route, opts);
  if (!track.ok) return { ok: false, reason: track.reason, hits: [], poses: [], hull: hull };
  if (!segs.length) return { ok: true, reason: null, hits: [], poses: track.poses, hull: hull };

  // Obstacle bounding boxes, so most poses reject without any real work.
  var boxes = segs.map(function(s) {
    return { minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2),
             minY: Math.min(s.y1, s.y2), maxY: Math.max(s.y1, s.y2) };
  });
  var reach = 0;
  for (var h = 0; h < hull.length; h++) reach = Math.max(reach, Math.hypot(hull[h].x, hull[h].y));

  var hits = [];
  var openEpisode = null;
  var lastEpisode = null;
  var clearRun = 0;
  var poses = track.poses;

  // A body pivoting against an obstacle can clip it, rotate just clear,
  // and clip again within a few degrees. That is one problem in one place,
  // not three, so a short gap does not end an episode — only a sustained
  // one does.
  var GAP_POSES = 25;

  for (var i = 0; i < poses.length; i++) {
    var pose = poses[i];
    var touching = null;
    var poly = null;

    for (var j = 0; j < segs.length; j++) {
      var bx = boxes[j];
      // Cheap circle-vs-box reject before building the polygon at all.
      if (pose.x + reach < bx.minX || pose.x - reach > bx.maxX ||
          pose.y + reach < bx.minY || pose.y - reach > bx.maxY) continue;
      if (!poly) poly = RP.footprintAt(hull, pose);
      if (RP.polyHitsSegment(poly, segs[j])) {
        if (!touching) touching = {};
        touching[segs[j].id] = true;
      }
    }

    var key = touching ? Object.keys(touching).sort().join(',') : null;
    if (key) {
      var resumable = lastEpisode && lastEpisode.key === key && clearRun <= GAP_POSES;
      if (!openEpisode && resumable) openEpisode = lastEpisode;   // same contact, brief gap
      if (!openEpisode || openEpisode.key !== key) {
        openEpisode = {
          key: key, x: pose.x, y: pose.y, deg: pose.deg,
          actionId: pose.actionId, obstacleIds: Object.keys(touching).map(Number),
          distMm: pose.distMm, poseIndex: i, poses: 1
        };
        hits.push(openEpisode);
      } else {
        openEpisode.poses++;
      }
      lastEpisode = openEpisode;
      clearRun = 0;
    } else {
      clearRun++;
      if (clearRun > GAP_POSES) lastEpisode = null;
      openEpisode = null;
    }
  }

  return { ok: true, reason: null, hits: hits, poses: poses, hull: hull };
};
