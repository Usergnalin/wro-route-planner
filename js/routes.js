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
RP.SEG_MODE_ARC = 'arc';

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

// ----------------------------------------------------------------------
// FOLLOW PATH geometry (freehand drawn curves)
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// ARC geometry (circular-arc route segments -> robot.turn_arc)
// ----------------------------------------------------------------------
// Arcs are stored as a signed "sagitta" (perpendicular bulge, in px) of the
// arc's apex from the chord midpoint. The two endpoints are the segment's
// from/to nodes. Positive sagitta bulges toward n̂ = chord rotated +90°.
RP.arcPerp = function(ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (L < 1e-9) return { x: 0, y: 0, L: 0 };
  return { x: -dy / L, y: dx / L, L: L };
};

RP.arcApex = function(ax, ay, bx, by, sag) {
  var p = RP.arcPerp(ax, ay, bx, by);
  return { x: (ax + bx) / 2 + p.x * sag, y: (ay + by) / 2 + p.y * sag };
};

// Full arc geometry from endpoints + signed sagitta (px). Returns null when
// degenerate (near-zero chord or near-flat bulge -> treat as a straight line).
//   { cx, cy, radiusPx, sweepRad (signed, canvas math), a0 }
RP.computeArcGeom = function(ax, ay, bx, by, sag) {
  var p = RP.arcPerp(ax, ay, bx, by);
  var L = p.L;
  if (L < 1e-6 || Math.abs(sag) < 0.5) return null;
  var mx = (ax + bx) / 2, my = (ay + by) / 2;
  var half = L / 2;
  var R = (sag * sag + half * half) / (2 * Math.abs(sag));
  var t = (sag * sag - half * half) / (2 * sag); // center offset along n̂ from midpoint
  var cx = mx + p.x * t, cy = my + p.y * t;
  var apex = { x: mx + p.x * sag, y: my + p.y * sag };
  var a0 = Math.atan2(ay - cy, ax - cx);
  var a1 = Math.atan2(by - cy, bx - cx);
  var TAU = Math.PI * 2;
  var endCCW = ((a1 - a0) % TAU + TAU) % TAU;      // (0, 2π)
  var apexCCW = ((Math.atan2(apex.y - cy, apex.x - cx) - a0) % TAU + TAU) % TAU;
  // Pick the rotational direction (from a0) that sweeps through the apex.
  var sweep = (apexCCW > 0 && apexCCW < endCCW) ? endCCW : endCCW - TAU;
  return { cx: cx, cy: cy, radiusPx: R, sweepRad: sweep, a0: a0 };
};

// arcPolyline is gone — RP.Sketch.arcPoints draws from the arc entity.
// computeArcGeom above survives because it is how a chord + bulge is
// turned into a centre, which both the arc tool and the migration of old
// sagitta arcs still need.

// Default bulge (px) for a newly created / converted arc segment.
RP.defaultArcSagitta = function(ax, ay, bx, by) {
  var L = Math.hypot(bx - ax, by - ay);
  return Math.max(6, L * 0.2);
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

// Construction lines are sketch entities now — RP.removeConstructionLine
// lives in js/model/construction.js so it can cascade the underlying
// points and constraints.

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

// applyWallAlignSnap / reapplyAllWallAlignSnaps are GONE.
//
// They wrote node.x/y directly, which was the one place that competed
// with the solver for ownership of coordinates. Route nodes are sketch
// points now, so those writes would land on a derived view and vanish on
// the next rebuild.
//
// Phase 7 replaces this with the honest version: field walls become
// fixed sketch geometry and a wall_align element's far endpoint is
// CONSTRAINED to a wall at the robot's clearance distance, solved like
// everything else. computeWallAlignEndPoint above is kept because that
// wall-intersection maths is what phase 7 will build the constraint on.

RP.flipSegmentDirection = function(routeId, segId) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    var seg = RP.findSegment(r, segId);
    if (!seg) return false;
    // Only normal, wall_align and arc can be flipped (teleport/linetrace/follow_path can't)
    if (seg.mode !== RP.SEG_MODE_NORMAL && seg.mode !== RP.SEG_MODE_WALL_ALIGN && seg.mode !== RP.SEG_MODE_ARC) return false;
    RP.pushHistory('Flip segment direction');
    seg.direction = (seg.direction === RP.SEG_BACKWARD) ? RP.SEG_FORWARD : RP.SEG_BACKWARD;
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
    if (mode === RP.SEG_MODE_FOLLOW_PATH && (!seg.pathPoints || seg.pathPoints.length < 2)) {
      // Converting a straight segment: seed with a 2-point straight path
      var fa = RP.findNode(r, seg.fromNodeId), fb = RP.findNode(r, seg.toNodeId);
      if (fa && fb) seg.pathPoints = [{ x: fa.x, y: fa.y }, { x: fb.x, y: fb.y }];
    }
    if (mode === RP.SEG_MODE_ARC && !seg.sagitta) {
      // Converting a straight segment: seed a visible default bulge
      var aa = RP.findNode(r, seg.fromNodeId), ab = RP.findNode(r, seg.toNodeId);
      if (aa && ab) seg.sagitta = RP.defaultArcSagitta(aa.x, aa.y, ab.x, ab.y);
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
// There is exactly ONE route. Multi-route support bought complexity that
// was never needed; RP.routes stays an array purely so save files and the
// rendering loop keep their shape.
RP.getActiveRoute = function() {
  return RP.routes.length > 0 ? RP.routes[0] : null;
};

RP.ensureSingleRoute = function() {
  if (RP.routes.length > 1) RP.routes = RP.routes.slice(0, 1);
  if (RP.routes.length === 0) {
    RP.routes.push({
      id: RP.nextRouteId++, name: 'Route', visible: true,
      elements: [], startCheckpoint: null, endExtraTurns: []
    });
  }
  var r = RP.routes[0];
  if (!r.elements) r.elements = [];
  RP.activeRouteId = r.id;
  return r;
};

// Kept as call-site-safe no-ops: with a single route there is nothing to
// select between, and the sidebar list is now the layer list alone.
RP.updateRouteSelect = function() { RP.updateSideRouteList(); };
RP.updateSideRouteList = function() { RP.updateLayerList(); };

RP.updateLayerList = function() {
  var el = document.getElementById('layer-list');
  if (!el) return;
  el.innerHTML = '';

  // ---- Routes + segments (listed above construction lines) ----
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

              var seye = document.createElement('button');
              seye.className = 'layer-vis-btn';
              seye.textContent = seg.visible === false ? '○' : '●';
              seye.title = seg.visible === false ? 'Show' : 'Hide';
              seye.onclick = function(e) {
                e.stopPropagation();
                seg.visible = seg.visible === false;
                RP.updateLayerList(); RP.render();
              };

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

              sdiv.appendChild(seye); sdiv.appendChild(slbl); sdiv.appendChild(sdel);
              el.appendChild(sdiv);
            })(route.segments[si], si);
          }
        }
      })(RP.routes[ri]);
    }
  }

  // ---- Construction geometry (listed below routes) ----
  // Lines and arcs are both just geometry here — the row only differs in
  // its label, so they share one builder.
  var geometry = RP.lines.map(function(l, i) {
    return { view: l, name: 'Line ' + (i + 1), isArc: false };
  }).concat(RP.arcs.map(function(a, i) {
    return { view: a, name: 'Arc ' + (i + 1), isArc: true };
  }));

  if (geometry.length > 0) {
    var lh = document.createElement('div');
    lh.className = 'layer-group-title';
    lh.textContent = 'Construction Geometry';
    el.appendChild(lh);
    for (var li = 0; li < geometry.length; li++) {
      (function(line, name, isArc) {
        var div = document.createElement('div');
        div.className = 'layer-item' + (RP.selectedLineId === line.id ? ' active' : '');

        var eye = document.createElement('button');
        eye.className = 'layer-vis-btn';
        eye.textContent = line.visible === false ? '○' : '●';
        eye.title = line.visible === false ? 'Show' : 'Hide';
        eye.onclick = function(e) {
          e.stopPropagation();
          // RP.lines is a rebuilt view — visibility lives on the metadata.
          RP.setConstructionVisible(line.id, line.visible === false);
          RP.updateLayerList(); RP.render();
        };

        var lbl = document.createElement('span');
        lbl.className = 'layer-item-label';
        lbl.textContent = name + (line.label ? '  ' + line.label : '');
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

        div.appendChild(eye);
        div.appendChild(lbl);
        if (isArc) {
          var flip = document.createElement('button');
          flip.className = 'layer-del-btn';
          flip.textContent = '⇄';
          flip.title = 'Flip to the other side (the other arc through these points)';
          flip.style.color = '#8bd';
          flip.onclick = function(e) {
            e.stopPropagation();
            RP.pushHistory('Flip arc');
            RP.flipArc(line.id);
            RP.updateLayerList();
            RP.render();
          };
          div.appendChild(flip);
        }
        div.appendChild(del);
        el.appendChild(div);
      })(geometry[li].view, geometry[li].name, geometry[li].isArc);
    }
  }

  if (geometry.length === 0 && RP.routes.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'color:#555;font-size:10px;padding:4px 2px';
    empty.textContent = 'No layers yet';
    el.appendChild(empty);
  }
};
