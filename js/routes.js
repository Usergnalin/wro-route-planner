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
// LEGACY ARC geometry — migration only
// ----------------------------------------------------------------------
// Pre-phase-8 saves stored an arc as a chord plus a signed "sagitta" (the
// perpendicular bulge, in px, of the arc's apex from the chord midpoint,
// toward n̂ = chord rotated +90°). Live arcs are real sketch entities now;
// this is only how migrateRoutesToActions turns an old bulge into a centre.
RP.arcPerp = function(ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (L < 1e-9) return { x: 0, y: 0, L: 0 };
  return { x: -dy / L, y: dx / L, L: L };
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

// The node/segment write path is gone. route.nodes / route.segments are
// derived READ-ONLY views (js/model/route.js), so the old mutators —
// removeSegment, removeNode, flipSegmentDirection, setSegmentMode,
// setSegmentTeleportName, setSegmentJunctionCount and the RP.selectedSegment
// they hung off — wrote to structures that the next rebuild discarded.
// Route mode's action panel is the real editor; see RP.setMoveProps.

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
      actions: []
    });
  }
  var r = RP.routes[0];
  if (!r.actions) r.actions = [];
  RP.activeRouteId = r.id;
  return r;
};

// Kept as call-site-safe no-ops: with a single route there is nothing to
// select between, and the sidebar list is now the layer list alone.
RP.updateRouteSelect = function() { RP.updateSideRouteList(); };
RP.updateSideRouteList = function() { RP.updateLayerList(); };

// Select a piece of construction geometry (line / arc / standalone point)
// in the layer list and make sure the row is actually ON SCREEN — a long
// list scrolls, and "select it in the list" is not much use if the row
// you wanted is still off the bottom. Un-collapses the panel too, since a
// collapsed list cannot show anything no matter how hard it is focused.
RP.focusGeometryInList = function(id) {
  if (id == null) return;
  RP.selectedLineId = id;
  RP.updateLayerList();
  var panel = document.getElementById('panel-geometry');
  if (panel) panel.classList.remove('collapsed');
  var el = document.getElementById('layer-list');
  var row = el && el.querySelector('[data-geo-id="' + id + '"]');
  if (row) row.scrollIntoView({ block: 'nearest' });
};

RP.updateLayerList = function() {
  var el = document.getElementById('layer-list');
  if (!el) return;
  // Rebuilding drops the row the cursor was over without firing its
  // mouseleave, so the preview has to be dropped with it or it sticks.
  RP.hoverGeoId = null;
  el.innerHTML = '';

  // ---- Routes (listed above construction lines) ----
  // Visibility only. Per-action editing is Route mode's action list; the
  // segment sub-rows that used to live here edited a derived view.
  // Routes reference MAT geometry, so they are not part of the robot
  // document and listing them there would offer edits that cannot apply.
  if (RP.routes.length > 0 && RP.activeDocId !== RP.DOC_ROBOT) {
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
        var actCount = route.actions ? route.actions.length : 0;
        lbl.textContent = route.name + ' (' + actCount + ' action' + (actCount === 1 ? '' : 's') + ')';
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
  })).concat(RP.points.map(function(p, i) {
    return { view: p, name: p.name || ('Point ' + (i + 1)), isArc: false };
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
        div.dataset.geoId = line.id;   // scroll target for RP.focusGeometryInList

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
        // Hover previews what a click would pick. Only the canvas is
        // re-rendered — rebuilding the list here would destroy the row the
        // cursor is currently on and the hover would flicker off.
        div.onmouseenter = function() { RP.hoverGeoId = line.id; RP.render(); };
        div.onmouseleave = function() {
          if (RP.hoverGeoId === line.id) { RP.hoverGeoId = null; RP.render(); }
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
