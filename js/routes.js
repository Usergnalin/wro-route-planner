/* ========================================================================
   routes.js - Route graph: nodes + segments (branching allowed)
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

RP.SEG_FORWARD = 'forward';
RP.SEG_BACKWARD = 'backward';
RP.SEG_MODE_NORMAL = 'normal';
RP.SEG_MODE_TELEPORT = 'teleport';
RP.SEG_MODE_LINETRACE_DIST = 'linetrace_dist';
RP.SEG_MODE_LINETRACE_JUNCT = 'linetrace_junct';
RP.SEG_MODE_WALL_ALIGN = 'wall_align';
RP.SEG_MODE_FOLLOW_PATH = 'follow_path';

// No-ops kept so any lingering call-sites don't crash
RP.ensureSegmentDirections = function() {};
RP.ensureSegmentModes = function() {};

// ---- Migration: old linear waypoints[] -> new nodes[]+segments[] ----
RP.migrateRoute = function(route) {
  if (!route.waypoints) return; // already new format
  var wps  = route.waypoints || [];
  var dirs = route.segmentDirections || [];
  var modes= route.segmentModes || [];
  var tpN  = route.segmentModeTeleportNames || [];
  var jct  = route.segmentModeJunctionCounts || [];
  route.nodes = [];
  route.segments = [];
  for (var i = 0; i < wps.length; i++) {
    route.nodes.push({ id: wps[i].id, x: wps[i].x, y: wps[i].y,
      isCheckpoint: wps[i].isCheckpoint || false,
      checkpointName: wps[i].checkpointName || null });
  }
  for (var j = 0; j < wps.length - 1; j++) {
    var dir  = dirs[j] || RP.SEG_FORWARD;
    var mode = modes[j] || RP.SEG_MODE_NORMAL;
    if (dir === 'teleport') { dir = RP.SEG_FORWARD; mode = RP.SEG_MODE_TELEPORT; }
    if ([RP.SEG_MODE_NORMAL, RP.SEG_MODE_TELEPORT,
         RP.SEG_MODE_LINETRACE_DIST, RP.SEG_MODE_LINETRACE_JUNCT,
         RP.SEG_MODE_WALL_ALIGN].indexOf(mode) < 0) {
      mode = RP.SEG_MODE_NORMAL;
    }
    route.segments.push({
      id: RP.nextSegId++,
      fromNodeId: wps[j].id, toNodeId: wps[j+1].id,
      direction: dir === RP.SEG_BACKWARD ? RP.SEG_BACKWARD : RP.SEG_FORWARD,
      mode: mode,
      teleportName: tpN[j] || null, junctionCount: jct[j] || null
    });
  }
  delete route.waypoints;
  delete route.segmentDirections;
  delete route.segmentModes;
  delete route.segmentModeTeleportNames;
  delete route.segmentModeJunctionCounts;
};

RP.migrateAllRoutes = function() {
  for (var i = 0; i < RP.routes.length; i++) RP.migrateRoute(RP.routes[i]);
};

// ---- Node / segment lookups ----
RP.findNode = function(route, nodeId) {
  for (var i = 0; i < route.nodes.length; i++)
    if (route.nodes[i].id === nodeId) return route.nodes[i];
  return null;
};

RP.findSegment = function(route, segId) {
  for (var i = 0; i < route.segments.length; i++)
    if (route.segments[i].id === segId) return route.segments[i];
  return null;
};

RP.findSegBetween = function(route, nodeId1, nodeId2) {
  for (var i = 0; i < route.segments.length; i++) {
    var s = route.segments[i];
    if ((s.fromNodeId === nodeId1 && s.toNodeId === nodeId2) ||
        (s.fromNodeId === nodeId2 && s.toNodeId === nodeId1)) return s;
  }
  return null;
};

// Nearest node to image-space point within screenPx screen pixels
RP.findNodeNear = function(route, ix, iy, screenPx) {
  var thresh = RP.snapThresholdImg(screenPx || RP.ROUTE_CONTINUE_SCREEN_RADIUS);
  var best = null, bestD = Infinity;
  for (var i = 0; i < route.nodes.length; i++) {
    var n = route.nodes[i];
    var d = RP.dist(ix, iy, n.x, n.y);
    if (d < thresh && d < bestD) { bestD = d; best = n; }
  }
  return best;
};

// ---- Longest simple path (DFS, brute-force — fine for small graphs) ----
RP.computeLongestPath = function(route) {
  if (!route || !route.nodes || route.nodes.length === 0) return [];
  if (!route.segments || route.segments.length === 0) return [];

  var nodeById = {};
  for (var i = 0; i < route.nodes.length; i++) nodeById[route.nodes[i].id] = route.nodes[i];

  // Adjacency: nodeId -> [neighborId, ...]
  var adj = {};
  for (var ni = 0; ni < route.nodes.length; ni++) adj[route.nodes[ni].id] = [];
  for (var si = 0; si < route.segments.length; si++) {
    var s = route.segments[si];
    if (adj[s.fromNodeId]) adj[s.fromNodeId].push(s.toNodeId);
    if (adj[s.toNodeId])   adj[s.toNodeId].push(s.fromNodeId);
  }

  var bestPath = [];
  var bestDist = -1;
  var visited = {};

  function dfs(nodeId, path, dist) {
    if (path.length >= 2 && dist > bestDist) {
      bestDist = dist;
      bestPath = path.slice();
    }
    var nb = adj[nodeId] || [];
    for (var j = 0; j < nb.length; j++) {
      var nid = nb[j];
      if (visited[nid]) continue;
      var cur = nodeById[nodeId], next = nodeById[nid];
      if (!cur || !next) continue;
      visited[nid] = true;
      path.push(nid);
      dfs(nid, path, dist + RP.dist(cur.x, cur.y, next.x, next.y));
      path.pop();
      visited[nid] = false;
    }
  }

  // Always start from the first node placed (route.nodes[0])
  var startId = route.nodes[0].id;
  visited[startId] = true;
  dfs(startId, [startId], 0);

  if (bestPath.length < 2) return [];
  return bestPath.map(function(id) { return nodeById[id]; });
};

// ---- Mutation helpers ----
RP._addNode = function(route, x, y, props) {
  var node = { id: RP.nextWpId++, x: x, y: y, isCheckpoint: false, checkpointName: null };
  if (props) {
    if (props.isCheckpoint !== undefined) node.isCheckpoint = props.isCheckpoint;
    if (props.checkpointName !== undefined) node.checkpointName = props.checkpointName;
  }
  route.nodes.push(node);
  return node;
};

RP._addSegment = function(route, fromNodeId, toNodeId) {
  var seg = {
    id: RP.nextSegId++,
    fromNodeId: fromNodeId, toNodeId: toNodeId,
    direction: RP.SEG_FORWARD, mode: RP.SEG_MODE_NORMAL,
    teleportName: null, junctionCount: null
  };
  route.segments.push(seg);
  return seg;
};

// ----------------------------------------------------------------------
// FOLLOW PATH geometry (freehand drawn curves)
// ----------------------------------------------------------------------

// Total arc length (px) of a polyline [{x,y}, ...]
RP.polylineLengthPx = function(pts) {
  var L = 0;
  for (var i = 1; i < pts.length; i++) L += RP.dist(pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y);
  return L;
};

// Chaikin corner-cutting subdivision for an OPEN polyline. Each iteration
// replaces every interior corner with two points at 1/4 and 3/4 along its
// adjacent edges, rounding the curve. The first and last points are kept
// fixed so the curve stays anchored to its route nodes.
RP.chaikinSmooth = function(pts, iterations) {
  if (!pts || pts.length < 3 || !iterations) return pts ? pts.slice() : [];
  var cur = pts.slice();
  for (var it = 0; it < iterations; it++) {
    if (cur.length < 3) break;
    var out = [{ x: cur[0].x, y: cur[0].y }];
    for (var i = 0; i < cur.length - 1; i++) {
      var p = cur[i], q = cur[i + 1];
      out.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y });
      out.push({ x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y });
    }
    out.push({ x: cur[cur.length - 1].x, y: cur[cur.length - 1].y });
    cur = out;
  }
  return cur;
};

// Resample a polyline to n points spaced uniformly by ARC LENGTH (not by
// parameter index). Returns array of {x,y} of length n (n >= 2).
RP.resamplePolylineByArcLength = function(pts, n) {
  if (!pts || pts.length === 0) return [];
  if (pts.length === 1) { var out1 = []; for (var k = 0; k < n; k++) out1.push({ x: pts[0].x, y: pts[0].y }); return out1; }
  // Cumulative arc length at each input vertex
  var cum = [0];
  for (var i = 1; i < pts.length; i++) cum.push(cum[i-1] + RP.dist(pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y));
  var total = cum[cum.length - 1];
  var result = [];
  if (total === 0) { for (var z = 0; z < n; z++) result.push({ x: pts[0].x, y: pts[0].y }); return result; }
  var seg = 1;
  for (var s = 0; s < n; s++) {
    var target = (total * s) / (n - 1);
    while (seg < cum.length - 1 && cum[seg] < target) seg++;
    var a = pts[seg - 1], b = pts[seg];
    var segLen = cum[seg] - cum[seg - 1];
    var t = segLen > 0 ? (target - cum[seg - 1]) / segLen : 0;
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
};

// Compute the follow_path output for a drawn polyline.
//   pts:    raw drawn points (image space), in travel order
//   n:      number of arc-length samples
//   flip:   negate dx when computing heading (true for y-down canvas)
//   ppm:    pixels per mm (for length); if absent, length stays in px
// Returns { headings: [deg...], lengthPx, lengthMm, samples: [{x,y}...] }
//   smoothing: number of Chaikin iterations applied before resampling
//   Headings use the robot convention: 0 deg = +y (forward), atan2(dx, dy),
//   unwrapped (no +/-180 jumps), then rebased so headings[0] === 0.
RP.computeFollowPathData = function(pts, n, flip, ppm, smoothing) {
  n = Math.max(2, n | 0);
  var src = (smoothing && smoothing > 0) ? RP.chaikinSmooth(pts, smoothing) : pts;
  var samples = RP.resamplePolylineByArcLength(src, n);
  var rawDeg = [];
  for (var i = 0; i < samples.length; i++) {
    // forward difference; last point reuses the previous direction
    var j = (i < samples.length - 1) ? i + 1 : i;
    var k = (i < samples.length - 1) ? i : i - 1;
    var dx = samples[j].x - samples[k].x;
    var dy = samples[j].y - samples[k].y;
    var hx = flip ? -dx : dx;
    rawDeg.push(Math.atan2(hx, dy) * 180 / Math.PI);
  }
  // Unwrap to remove discontinuities
  var unwrapped = [rawDeg[0]];
  for (var u = 1; u < rawDeg.length; u++) {
    var d = rawDeg[u] - rawDeg[u-1];
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    unwrapped.push(unwrapped[u-1] + d);
  }
  // Rebase so the first heading is 0
  var base = unwrapped[0];
  var headings = unwrapped.map(function(h) { return h - base; });
  var lengthPx = RP.polylineLengthPx(samples);
  return {
    headings: headings,
    lengthPx: lengthPx,
    lengthMm: ppm ? lengthPx / ppm : lengthPx,
    samples: samples
  };
};

// Remove a single segment (leaves nodes in place; orphaned nodes are ignored by DFS)
RP.removeSegment = function(routeId, segId) {
  for (var ri = 0; ri < RP.routes.length; ri++) {
    var r = RP.routes[ri];
    if (r.id !== routeId) continue;
    RP.pushHistory('Delete segment');
    r.segments = r.segments.filter(function(s) { return s.id !== segId; });
    if (RP.selectedSegment && RP.selectedSegment.routeId === routeId && RP.selectedSegment.segId === segId) {
      RP.selectedSegment = null;
    }
    RP.render();
    RP.updateSideRouteList();
    RP.updateInfoPanel();
    if (RP.updateInstructions) RP.updateInstructions();
    return;
  }
};

// Remove a construction line
RP.removeConstructionLine = function(lineId) {
  RP.pushHistory('Delete construction line');
  RP.lines = RP.lines.filter(function(l) { return l.id !== lineId; });
  if (RP.selectedLineId === lineId) RP.selectedLineId = null;
  RP.updateLayerList();
  RP.render();
};

// Remove a node and all segments connected to it
RP.removeNode = function(routeId, nodeId) {
  for (var ri = 0; ri < RP.routes.length; ri++) {
    var r = RP.routes[ri];
    if (r.id !== routeId) continue;
    r.segments = r.segments.filter(function(s) {
      return s.fromNodeId !== nodeId && s.toNodeId !== nodeId;
    });
    r.nodes = r.nodes.filter(function(n) { return n.id !== nodeId; });
    if (RP.selectedSegment && RP.selectedSegment.routeId === routeId) {
      if (!RP.findSegment(r, RP.selectedSegment.segId)) RP.selectedSegment = null;
    }
    RP.render();
    RP.updateRouteSelect();
    RP.updateSideRouteList();
    RP.updateInfoPanel();
    return;
  }
};

// ---- Selected segment (select mode) — now uses segId ----
RP.selectedSegment = null; // { routeId, segId } or null

// ──────────────────────────────────────────────────────────────────────────
// WALL ALIGN SNAPPING
// ──────────────────────────────────────────────────────────────────────────
RP.computeWallAlignEndPoint = function(route, seg) {
  var na = RP.findNode(route, seg.fromNodeId);
  var nb = RP.findNode(route, seg.toNodeId);
  if (!na || !nb || !RP.calibration || !RP.imgNaturalW || !RP.imgNaturalH) return null;

  var dx = nb.x - na.x, dy = nb.y - na.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return null;
  var ux = dx / len, uy = dy / len;

  // Find closest field wall in travel direction
  var tMin = Infinity, hitWall = null;
  if (ux > 0.001) { var t = (RP.imgNaturalW - na.x) / ux; if (t > 0 && t < tMin) { tMin = t; hitWall = 'right';  } }
  if (ux < -0.001){ var t = (0 - na.x)            / ux; if (t > 0 && t < tMin) { tMin = t; hitWall = 'left';   } }
  if (uy > 0.001) { var t = (RP.imgNaturalH - na.y) / uy; if (t > 0 && t < tMin) { tMin = t; hitWall = 'bottom'; } }
  if (uy < -0.001){ var t = (0 - na.y)            / uy; if (t > 0 && t < tMin) { tMin = t; hitWall = 'top';    } }

  if (!hitWall) return null;

  var ppm = RP.calibration.pixelsPerMm;
  var isBackward = seg.direction === RP.SEG_BACKWARD;
  var clearanceMm = isBackward ? (RP.robotConfig.rearClearance || 50) : (RP.robotConfig.frontClearance || 50);
  var clearancePx = clearanceMm * ppm;

  var snapX = na.x + tMin * ux - ux * clearancePx;
  var snapY = na.y + tMin * uy - uy * clearancePx;

  return { x: snapX, y: snapY, hitWall: hitWall };
};

RP.applyWallAlignSnap = function(route, seg) {
  var result = RP.computeWallAlignEndPoint(route, seg);
  if (!result) return;
  var nb = RP.findNode(route, seg.toNodeId);
  if (!nb) return;
  nb.x = result.x;
  nb.y = result.y;
};

RP.reapplyAllWallAlignSnaps = function() {
  for (var ri = 0; ri < RP.routes.length; ri++) {
    var r = RP.routes[ri];
    if (!r.segments) continue;
    for (var si = 0; si < r.segments.length; si++) {
      if (r.segments[si].mode === RP.SEG_MODE_WALL_ALIGN) {
        RP.applyWallAlignSnap(r, r.segments[si]);
      }
    }
  }
  if (RP.render) RP.render();
  if (RP.updateInstructions) RP.updateInstructions();
};

RP.flipSegmentDirection = function(routeId, segId) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    var seg = RP.findSegment(r, segId);
    if (!seg) return false;
    // Only wall_align and normal can be flipped
    if (seg.mode !== RP.SEG_MODE_NORMAL && seg.mode !== RP.SEG_MODE_WALL_ALIGN) return false;
    RP.pushHistory('Flip segment direction');
    seg.direction = (seg.direction === RP.SEG_BACKWARD) ? RP.SEG_FORWARD : RP.SEG_BACKWARD;
    if (seg.mode === RP.SEG_MODE_WALL_ALIGN) RP.applyWallAlignSnap(r, seg);
    RP.render(); RP.updateInfoPanel();
    return true;
  }
  return false;
};

RP.setSegmentMode = function(routeId, segId, mode) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    var seg = RP.findSegment(r, segId);
    if (!seg || seg.mode === mode) return false;
    RP.pushHistory('Set segment mode');
    seg.mode = mode;
    if (mode === RP.SEG_MODE_TELEPORT && !seg.teleportName)
      seg.teleportName = 'teleport_' + seg.id;
    if (mode === RP.SEG_MODE_LINETRACE_JUNCT && !seg.junctionCount)
      seg.junctionCount = 1;
    if (mode === RP.SEG_MODE_WALL_ALIGN)
      RP.applyWallAlignSnap(r, seg);
    if (mode === RP.SEG_MODE_FOLLOW_PATH && (!seg.pathPoints || seg.pathPoints.length < 2)) {
      // Converting a straight segment: seed with a 2-point straight path
      var fa = RP.findNode(r, seg.fromNodeId), fb = RP.findNode(r, seg.toNodeId);
      if (fa && fb) seg.pathPoints = [{ x: fa.x, y: fa.y }, { x: fb.x, y: fb.y }];
    }
    RP.render(); RP.updateInfoPanel();
    if (RP.updateInstructions) RP.updateInstructions();
    return true;
  }
  return false;
};

RP.setSegmentTeleportName = function(routeId, segId, name) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    var seg = RP.findSegment(r, segId);
    if (!seg) return false;
    seg.teleportName = name || null;
    RP.updateInfoPanel();
    return true;
  }
  return false;
};

RP.setSegmentJunctionCount = function(routeId, segId, count) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    var seg = RP.findSegment(r, segId);
    if (!seg) return false;
    var n = parseInt(count, 10);
    seg.junctionCount = (isFinite(n) && n > 0) ? n : 1;
    RP.updateInfoPanel();
    return true;
  }
  return false;
};

// ---- Route CRUD ----
RP.getActiveRoute = function() {
  for (var i = 0; i < RP.routes.length; i++)
    if (RP.routes[i].id === RP.activeRouteId) return RP.routes[i];
  return null;
};

RP.createRoute = function(name) {
  var id = RP.nextRouteId++;
  var r = { id: id, name: name || ('Route ' + id), nodes: [], segments: [], visible: true };
  RP.routes.push(r);
  RP.activeRouteId = r.id;
  RP.updateRouteSelect();
  RP.updateSideRouteList();
  RP.render();
  RP.updateInfoPanel();
  return r;
};

RP.deleteRoute = function(id) {
  if (RP.selectedSegment && RP.selectedSegment.routeId === id) RP.selectedSegment = null;
  RP.routes = RP.routes.filter(function(r) { return r.id !== id; });
  if (RP.activeRouteId === id)
    RP.activeRouteId = RP.routes.length > 0 ? RP.routes[RP.routes.length - 1].id : null;
  if (RP.routes.length === 0) { RP.activeRouteId = null; RP.createRoute('Route 1'); }
  RP.updateRouteSelect();
  RP.updateSideRouteList();
  RP.render();
  RP.updateInfoPanel();
};

RP.updateRouteSelect = function() {
  var sel = RP.dom.routeSelect;
  if (!sel) return;
  sel.innerHTML = '<option value="__new__">+ New Route</option>';
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    var opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name + (r.id === RP.activeRouteId ? ' (active)' : '') + (r.visible ? '' : ' [hidden]');
    sel.appendChild(opt);
  }
  if (RP.activeRouteId !== null) sel.value = RP.activeRouteId;
  RP.updateSideRouteList();
};

RP.updateSideRouteList = function() {
  RP.updateLayerList();
  var el = RP.dom.routeListEl;
  if (!el) return;
  el.innerHTML = '';
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    var div = document.createElement('div');
    div.className = 'route-item' + (r.id === RP.activeRouteId ? ' active' : '');
    (function(route) {
      var label = document.createElement('span');
      label.textContent = route.name + ' (' + route.nodes.length + ' nodes)';
      label.style.cursor = 'pointer';
      label.onclick = function() {
        if (RP.activeRouteId !== route.id) {
          RP.pushHistory('Switch active route');
          RP.activeRouteId = route.id;
          RP.updateRouteSelect();
          RP.render();
          RP.updateInfoPanel();
        }
      };
      var visBtn = document.createElement('button');
      visBtn.textContent = route.visible ? '👁' : '👁‍🗨';
      visBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:0 4px';
      visBtn.onclick = function() {
        RP.pushHistory(route.visible ? 'Hide route' : 'Show route');
        route.visible = !route.visible;
        RP.updateSideRouteList();
        RP.render();
      };
      var delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'del-btn';
      delBtn.onclick = function() {
        if (!confirm('Delete route "' + route.name + '"?')) return;
        RP.pushHistory('Delete route');
        RP.deleteRoute(route.id);
      };
      div.appendChild(label);
      div.appendChild(visBtn);
      div.appendChild(delBtn);
    })(r);
    el.appendChild(div);
  }
};

RP.updateLayerList = function() {
  var el = document.getElementById('layer-list');
  if (!el) return;
  el.innerHTML = '';

  // ---- Construction lines ----
  if (RP.lines.length > 0) {
    var lh = document.createElement('div');
    lh.className = 'layer-group-title';
    lh.textContent = 'Construction Lines';
    el.appendChild(lh);
    for (var li = 0; li < RP.lines.length; li++) {
      (function(line, idx) {
        var div = document.createElement('div');
        div.className = 'layer-item' + (RP.selectedLineId === line.id ? ' active' : '');

        var eye = document.createElement('button');
        eye.className = 'layer-vis-btn';
        eye.textContent = line.visible === false ? '○' : '●';
        eye.title = line.visible === false ? 'Show' : 'Hide';
        eye.onclick = function(e) {
          e.stopPropagation();
          line.visible = line.visible === false;
          RP.updateLayerList(); RP.render();
        };

        var lbl = document.createElement('span');
        lbl.className = 'layer-item-label';
        lbl.textContent = 'Line ' + (idx + 1) + (line.label ? '  ' + line.label : '');
        lbl.title = lbl.textContent;
        lbl.onclick = function() {
          RP.selectedLineId = (RP.selectedLineId === line.id) ? null : line.id;
          RP.updateLayerList(); RP.render();
        };

        var del = document.createElement('button');
        del.className = 'layer-del-btn';
        del.textContent = '✕';
        del.title = 'Delete line';
        del.onclick = function(e) {
          e.stopPropagation();
          RP.removeConstructionLine(line.id);
        };

        div.appendChild(eye); div.appendChild(lbl); div.appendChild(del);
        el.appendChild(div);
      })(RP.lines[li], li);
    }
  }

  // ---- Routes + segments ----
  if (RP.routes.length > 0) {
    var rh = document.createElement('div');
    rh.className = 'layer-group-title';
    rh.textContent = 'Routes';
    el.appendChild(rh);
    for (var ri = 0; ri < RP.routes.length; ri++) {
      (function(route) {
        // Route header row
        var div = document.createElement('div');
        div.className = 'layer-item' + (route.id === RP.activeRouteId ? ' active' : '');

        var eye = document.createElement('button');
        eye.className = 'layer-vis-btn';
        eye.textContent = route.visible ? '●' : '○';
        eye.title = route.visible ? 'Hide' : 'Show';
        eye.onclick = function(e) {
          e.stopPropagation();
          RP.pushHistory(route.visible ? 'Hide route' : 'Show route');
          route.visible = !route.visible;
          RP.updateLayerList(); RP.render();
        };

        var lbl = document.createElement('span');
        lbl.className = 'layer-item-label';
        var nodeCount = route.nodes ? route.nodes.length : 0;
        var segCount  = route.segments ? route.segments.length : 0;
        lbl.textContent = route.name + ' (' + segCount + ' seg)';
        lbl.title = lbl.textContent;
        lbl.onclick = function() {
          if (RP.activeRouteId !== route.id) {
            RP.pushHistory('Switch active route');
            RP.activeRouteId = route.id;
            RP.updateRouteSelect();
            RP.render();
            RP.updateInfoPanel();
          }
          RP.updateLayerList();
        };

        div.appendChild(eye); div.appendChild(lbl);
        el.appendChild(div);

        // Segment sub-rows
        if (route.segments && route.segments.length > 0) {
          for (var si = 0; si < route.segments.length; si++) {
            (function(seg, sidx) {
              var na = RP.findNode(route, seg.fromNodeId);
              var nb = RP.findNode(route, seg.toNodeId);
              var lenStr = '';
              if (na && nb && RP.calibration) {
                var mm = RP.dist(na.x, na.y, nb.x, nb.y) / RP.calibration.pixelsPerMm;
                lenStr = ' ' + mm.toFixed(0) + 'mm';
              }
              var modeTag = seg.mode && seg.mode !== RP.SEG_MODE_NORMAL
                ? ' [' + seg.mode.replace('linetrace_', 'LT-') + ']' : '';

              var isSelSeg = RP.selectedSegment && RP.selectedSegment.routeId === route.id && RP.selectedSegment.segId === seg.id;
              var sdiv = document.createElement('div');
              sdiv.className = 'layer-seg-item' + (isSelSeg ? ' active-seg' : '');

              var slbl = document.createElement('span');
              slbl.className = 'layer-item-label';
              slbl.textContent = 'Seg ' + (sidx + 1) + lenStr + modeTag;
              slbl.title = slbl.textContent;
              slbl.onclick = function() {
                RP.selectedSegment = { routeId: route.id, segId: seg.id };
                if (RP.activeRouteId !== route.id) {
                  RP.activeRouteId = route.id;
                  RP.updateRouteSelect();
                }
                RP.updateLayerList();
                RP.render();
                RP.updateInfoPanel();
              };

              var sdel = document.createElement('button');
              sdel.className = 'layer-del-btn';
              sdel.textContent = '✕';
              sdel.title = 'Delete segment';
              sdel.onclick = function(e) {
                e.stopPropagation();
                RP.removeSegment(route.id, seg.id);
              };

              sdiv.appendChild(slbl); sdiv.appendChild(sdel);
              el.appendChild(sdiv);
            })(route.segments[si], si);
          }
        }
      })(RP.routes[ri]);
    }
  }

  if (RP.lines.length === 0 && RP.routes.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'color:#555;font-size:10px;padding:4px 2px';
    empty.textContent = 'No layers yet';
    el.appendChild(empty);
  }
};
