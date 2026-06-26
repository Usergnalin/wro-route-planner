/* ========================================================================
   routes.js - Create/delete routes, add/insert/delete waypoints
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

RP.getActiveRoute = function() {
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id === RP.activeRouteId) return RP.routes[i];
  }
  return null;
};

// ----------------------------------------------------------------------
// Direction model
// ----------------------------------------------------------------------
// Each route has a parallel array `segmentDirections` of length
// max(0, waypoints.length - 1). segmentDirections[i] is the direction
// of the segment between waypoints[i] and waypoints[i+1]:
//   'forward'  - robot drives forward (chassis-front in direction A->B)
//   'backward' - robot drives in reverse (chassis-front opposite, B->A)
// Old saves without this field default to all-forward.
//
// Segment mode (parallel array `segmentModes`):
//   'normal'           - regular turn+forward movement
//   'teleport'         - manual segment: turns omitted, comment placeholder
//   'linetrace_dist'   - line trace for a known distance
//   'linetrace_junct'  - line trace until N junctions detected
//
// Mode parameters (parallel arrays):
//   segmentModeTeleportNames[i]  - string name for teleport (Ctrl+F target)
//   segmentModeJunctionCounts[i] - number of junctions to detect
// Old saves without these fields default to 'normal' with null params.
// ----------------------------------------------------------------------
RP.SEG_FORWARD = 'forward';
RP.SEG_BACKWARD = 'backward';

RP.SEG_MODE_NORMAL = 'normal';
RP.SEG_MODE_TELEPORT = 'teleport';
RP.SEG_MODE_LINETRACE_DIST = 'linetrace_dist';
RP.SEG_MODE_LINETRACE_JUNCT = 'linetrace_junct';

RP.ensureSegmentDirections = function(route) {
  if (!route) return;
  if (!Array.isArray(route.segmentDirections)) route.segmentDirections = [];
  var wanted = Math.max(0, route.waypoints.length - 1);
  while (route.segmentDirections.length < wanted) route.segmentDirections.push(RP.SEG_FORWARD);
  if (route.segmentDirections.length > wanted) route.segmentDirections.length = wanted;
  // Coerce any stray values to 'forward' so we never trust corrupted data.
  for (var i = 0; i < route.segmentDirections.length; i++) {
    if (route.segmentDirections[i] !== RP.SEG_BACKWARD) route.segmentDirections[i] = RP.SEG_FORWARD;
  }
};

RP.ensureSegmentModes = function(route) {
  if (!route) return;
  if (!Array.isArray(route.segmentModes)) route.segmentModes = [];
  if (!Array.isArray(route.segmentModeTeleportNames)) route.segmentModeTeleportNames = [];
  if (!Array.isArray(route.segmentModeJunctionCounts)) route.segmentModeJunctionCounts = [];
  var wanted = Math.max(0, route.waypoints.length - 1);
  while (route.segmentModes.length < wanted) route.segmentModes.push(RP.SEG_MODE_NORMAL);
  if (route.segmentModes.length > wanted) route.segmentModes.length = wanted;
  while (route.segmentModeTeleportNames.length < wanted) route.segmentModeTeleportNames.push(null);
  if (route.segmentModeTeleportNames.length > wanted) route.segmentModeTeleportNames.length = wanted;
  while (route.segmentModeJunctionCounts.length < wanted) route.segmentModeJunctionCounts.push(null);
  if (route.segmentModeJunctionCounts.length > wanted) route.segmentModeJunctionCounts.length = wanted;
  // Coerce invalid modes.
  var validModes = [RP.SEG_MODE_NORMAL, RP.SEG_MODE_TELEPORT, RP.SEG_MODE_LINETRACE_DIST, RP.SEG_MODE_LINETRACE_JUNCT];
  for (var j = 0; j < route.segmentModes.length; j++) {
    if (validModes.indexOf(route.segmentModes[j]) < 0) route.segmentModes[j] = RP.SEG_MODE_NORMAL;
  }
  // Coerce junction counts to positive integers.
  for (var k = 0; k < route.segmentModeJunctionCounts.length; k++) {
    var c = route.segmentModeJunctionCounts[k];
    if (c !== null && (!isFinite(c) || c < 1)) route.segmentModeJunctionCounts[k] = 1;
  }
  // Migrate old saves that used segmentDirections='teleport'.
  RP.ensureSegmentDirections(route);
  for (var m = 0; m < route.segmentDirections.length; m++) {
    if (route.segmentDirections[m] === 'teleport') {
      route.segmentDirections[m] = RP.SEG_FORWARD;
      route.segmentModes[m] = RP.SEG_MODE_TELEPORT;
    }
  }
};

// Apply migration across all routes. Safe to call any time.
RP.migrateAllRoutes = function() {
  for (var i = 0; i < RP.routes.length; i++) {
    RP.ensureSegmentDirections(RP.routes[i]);
    RP.ensureSegmentModes(RP.routes[i]);
  }
};

// Selected segment (select mode only). Lives outside the route model so
// it doesn't get persisted.
RP.selectedSegment = null; // { routeId, segIdx } or null

// Get/flip helpers for segment direction.
RP.getSegmentDirection = function(route, segIdx) {
  if (!route || !Array.isArray(route.segmentDirections)) return RP.SEG_FORWARD;
  return route.segmentDirections[segIdx] || RP.SEG_FORWARD;
};

RP.flipSegmentDirection = function(routeId, segIdx) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    RP.ensureSegmentDirections(r);
    RP.ensureSegmentModes(r);
    if (segIdx < 0 || segIdx >= r.segmentDirections.length) return false;
    // Can't flip direction in teleport or line trace modes.
    var mode = r.segmentModes[segIdx] || RP.SEG_MODE_NORMAL;
    if (mode !== RP.SEG_MODE_NORMAL) return false;
    RP.pushHistory('Flip segment direction');
    r.segmentDirections[segIdx] = (r.segmentDirections[segIdx] === RP.SEG_BACKWARD) ? RP.SEG_FORWARD : RP.SEG_BACKWARD;
    RP.render();
    RP.updateInfoPanel();
    return true;
  }
  return false;
};

// Set the segment mode. Called from the mode selector UI.
RP.setSegmentMode = function(routeId, segIdx, mode) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    RP.ensureSegmentModes(r);
    if (segIdx < 0 || segIdx >= r.segmentModes.length) return false;
    if (r.segmentModes[segIdx] === mode) return false;
    RP.pushHistory('Set segment mode');
    r.segmentModes[segIdx] = mode;
    // Default teleport name if switching to teleport.
    if (mode === RP.SEG_MODE_TELEPORT && !r.segmentModeTeleportNames[segIdx]) {
      r.segmentModeTeleportNames[segIdx] = 'teleport_' + (segIdx + 1);
    }
    // Default junction count if switching to linetrace_junct.
    if (mode === RP.SEG_MODE_LINETRACE_JUNCT && !r.segmentModeJunctionCounts[segIdx]) {
      r.segmentModeJunctionCounts[segIdx] = 1;
    }
    RP.render();
    RP.updateInfoPanel();
    if (RP.updateInstructions) RP.updateInstructions();
    return true;
  }
  return false;
};

// Update teleport name for a segment.
RP.setSegmentTeleportName = function(routeId, segIdx, name) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    RP.ensureSegmentModes(r);
    if (segIdx < 0 || segIdx >= r.segmentModes.length) return false;
    // Don't push history on every keystroke — only when leaving the field.
    r.segmentModeTeleportNames[segIdx] = name || null;
    RP.updateInfoPanel();
    return true;
  }
  return false;
};

// Update junction count for a segment.
RP.setSegmentJunctionCount = function(routeId, segIdx, count) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    RP.ensureSegmentModes(r);
    if (segIdx < 0 || segIdx >= r.segmentModes.length) return false;
    var n = parseInt(count, 10);
    r.segmentModeJunctionCounts[segIdx] = (isFinite(n) && n > 0) ? n : 1;
    RP.updateInfoPanel();
    return true;
  }
  return false;
};

RP.addWaypoint = function(x, y) {
  var r = RP.getActiveRoute();
  if (!r) return;
  r.waypoints.push({ x: x, y: y, label: '', id: RP.nextWpId++ });
  // New trailing segment defaults to forward, normal mode.
  if (r.waypoints.length >= 2) {
    RP.ensureSegmentDirections(r);
    RP.ensureSegmentModes(r);
    r.segmentDirections.push(RP.SEG_FORWARD);
    r.segmentModes.push(RP.SEG_MODE_NORMAL);
    r.segmentModeTeleportNames.push(null);
    r.segmentModeJunctionCounts.push(null);
  }
  RP.render();
  RP.updateRouteSelect();
  RP.updateSideRouteList();
  RP.updateInfoPanel();
};

RP.insertWaypointAt = function(x, y, idx) {
  var r = RP.getActiveRoute();
  if (!r || idx < 0 || idx >= r.waypoints.length - 1) return;
  RP.ensureSegmentDirections(r);
  RP.ensureSegmentModes(r);
  // Inserting in segment `idx` splits it into two halves; both halves
  // inherit the parent segment's direction and mode.
  var parentDir = r.segmentDirections[idx] || RP.SEG_FORWARD;
  var parentMode = r.segmentModes[idx] || RP.SEG_MODE_NORMAL;
  var parentTpName = r.segmentModeTeleportNames[idx] || null;
  var parentJct = r.segmentModeJunctionCounts[idx] || null;
  r.waypoints.splice(idx + 1, 0, { x: x, y: y, label: '', id: RP.nextWpId++ });
  r.segmentDirections.splice(idx, 1, parentDir, parentDir);
  r.segmentModes.splice(idx, 1, parentMode, parentMode);
  r.segmentModeTeleportNames.splice(idx, 1, parentTpName, parentTpName);
  r.segmentModeJunctionCounts.splice(idx, 1, parentJct, parentJct);
  RP.render();
  RP.updateRouteSelect();
  RP.updateSideRouteList();
  RP.updateInfoPanel();
};

RP.removeWaypoint = function(rteId, wpIdx) {
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id === rteId) {
      var r = RP.routes[i];
      if (!r || r.waypoints.length <= 1) return;
      RP.ensureSegmentDirections(r);
      RP.ensureSegmentModes(r);
      var lastIdx = r.waypoints.length - 1;
      if (wpIdx === 0) {
        r.segmentDirections.splice(0, 1);
        r.segmentModes.splice(0, 1);
        r.segmentModeTeleportNames.splice(0, 1);
        r.segmentModeJunctionCounts.splice(0, 1);
      } else if (wpIdx === lastIdx) {
        r.segmentDirections.splice(lastIdx - 1, 1);
        r.segmentModes.splice(lastIdx - 1, 1);
        r.segmentModeTeleportNames.splice(lastIdx - 1, 1);
        r.segmentModeJunctionCounts.splice(lastIdx - 1, 1);
      } else {
        var incomingDir = r.segmentDirections[wpIdx - 1] || RP.SEG_FORWARD;
        // Merged segment inherits incoming direction and is always normal mode.
        r.segmentDirections.splice(wpIdx - 1, 2, incomingDir);
        r.segmentModes.splice(wpIdx - 1, 2, RP.SEG_MODE_NORMAL);
        r.segmentModeTeleportNames.splice(wpIdx - 1, 2, null);
        r.segmentModeJunctionCounts.splice(wpIdx - 1, 2, null);
      }
      r.waypoints.splice(wpIdx, 1);
      if (RP.selectedSegment && RP.selectedSegment.routeId === rteId) {
        if (RP.selectedSegment.segIdx >= r.segmentDirections.length) RP.selectedSegment = null;
      }
      RP.render();
      RP.updateRouteSelect();
      RP.updateSideRouteList();
      RP.updateInfoPanel();
      return;
    }
  }
};

RP.createRoute = function(name) {
  // Snapshot the id BEFORE incrementing so the default name doesn't
  // run one ahead of the route id.
  var id = RP.nextRouteId++;
  var r = { id: id, name: name || ('Route ' + id), waypoints: [], visible: true, segmentDirections: [], segmentModes: [], segmentModeTeleportNames: [], segmentModeJunctionCounts: [] };
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
  var newRoutes = [];
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id !== id) newRoutes.push(RP.routes[i]);
  }
  RP.routes = newRoutes;
  if (RP.activeRouteId === id) {
    RP.activeRouteId = RP.routes.length > 0 ? RP.routes[RP.routes.length - 1].id : null;
  }
  if (RP.routes.length === 0) { RP.activeRouteId = null; RP.createRoute('Route 1'); }
  RP.updateRouteSelect();
  RP.updateSideRouteList();
  RP.render();
  RP.updateInfoPanel();
};

// Snap a point to the end of the previous route segment.
// Returns the snapped point, or the original if no snap needed.
RP.snapToPrevRouteEnd = function(ix, iy) {
  var r = RP.getActiveRoute();
  if (!r || r.waypoints.length === 0) return { x: ix, y: iy };
  var last = r.waypoints[r.waypoints.length - 1];
  var d = RP.dist(ix, iy, last.x, last.y);
  var thresh = RP.snapThresholdImg(20);
  if (d < thresh) {
    return { x: last.x, y: last.y };
  }
  return { x: ix, y: iy };
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

RP.updateLayerList = function() {
  var el = document.getElementById('layer-list');
  if (!el) return;
  el.innerHTML = '';

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
          RP.updateLayerList();
          RP.render();
        };
        var lbl = document.createElement('span');
        lbl.className = 'layer-item-label';
        lbl.textContent = 'Line ' + (idx + 1) + (line.label ? '  ' + line.label : '');
        lbl.title = lbl.textContent;
        lbl.onclick = function() {
          RP.selectedLineId = (RP.selectedLineId === line.id) ? null : line.id;
          RP.updateLayerList();
          RP.render();
        };
        div.appendChild(eye);
        div.appendChild(lbl);
        el.appendChild(div);
      })(RP.lines[li], li);
    }
  }

  if (RP.routes.length > 0) {
    var rh = document.createElement('div');
    rh.className = 'layer-group-title';
    rh.textContent = 'Routes';
    el.appendChild(rh);
    for (var ri = 0; ri < RP.routes.length; ri++) {
      (function(route) {
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
          RP.updateLayerList();
          RP.render();
        };
        var lbl = document.createElement('span');
        lbl.className = 'layer-item-label';
        lbl.textContent = route.name + ' (' + route.waypoints.length + ' pts)';
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
        div.appendChild(eye);
        div.appendChild(lbl);
        el.appendChild(div);
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
      label.textContent = route.name + ' (' + route.waypoints.length + ' pts)';
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
      visBtn.textContent = route.visible ? '\ud83d\udc41' : '\ud83d\udc41\u200d\ud83d\udde8';
      visBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:0 4px';
      visBtn.onclick = function() {
        RP.pushHistory(route.visible ? 'Hide route' : 'Show route');
        route.visible = !route.visible;
        RP.updateSideRouteList();
        RP.render();
      };
      var delBtn = document.createElement('button');
      delBtn.textContent = '\u2715';
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
