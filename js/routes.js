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
//   'teleport' - manual segment: turns before & after are omitted,
//                replaced with a comment for hand-editing (e.g. arc logic)
// Old saves without this field default to all-forward.
// ----------------------------------------------------------------------
RP.SEG_FORWARD = 'forward';
RP.SEG_BACKWARD = 'backward';
RP.SEG_TELEPORT = 'teleport';

RP.ensureSegmentDirections = function(route) {
  if (!route) return;
  if (!Array.isArray(route.segmentDirections)) route.segmentDirections = [];
  var wanted = Math.max(0, route.waypoints.length - 1);
  while (route.segmentDirections.length < wanted) route.segmentDirections.push(RP.SEG_FORWARD);
  if (route.segmentDirections.length > wanted) route.segmentDirections.length = wanted;
  // Coerce any stray values to 'forward' so we never trust corrupted data.
  // Accept 'teleport' as a valid value alongside 'forward' and 'backward'.
  for (var i = 0; i < route.segmentDirections.length; i++) {
    var d = route.segmentDirections[i];
    if (d !== RP.SEG_BACKWARD && d !== RP.SEG_TELEPORT) route.segmentDirections[i] = RP.SEG_FORWARD;
  }
};

// Apply migration across all routes. Safe to call any time.
RP.migrateAllRoutes = function() {
  for (var i = 0; i < RP.routes.length; i++) RP.ensureSegmentDirections(RP.routes[i]);
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
    if (segIdx < 0 || segIdx >= r.segmentDirections.length) return false;
    RP.pushHistory('Flip segment direction');
    var cur = r.segmentDirections[segIdx];
    if (cur === RP.SEG_TELEPORT) return false; // can't flip while teleported
    r.segmentDirections[segIdx] = (cur === RP.SEG_BACKWARD) ? RP.SEG_FORWARD : RP.SEG_BACKWARD;
    RP.render();
    RP.updateInfoPanel();
    return true;
  }
  return false;
};

// Toggle teleport on/off for a segment. When teleport is turned OFF,
// the segment reverts to forward direction.
RP.toggleSegmentTeleport = function(routeId, segIdx) {
  for (var i = 0; i < RP.routes.length; i++) {
    var r = RP.routes[i];
    if (r.id !== routeId) continue;
    RP.ensureSegmentDirections(r);
    if (segIdx < 0 || segIdx >= r.segmentDirections.length) return false;
    RP.pushHistory('Toggle teleport');
    var cur = r.segmentDirections[segIdx];
    if (cur === RP.SEG_TELEPORT) {
      r.segmentDirections[segIdx] = RP.SEG_FORWARD;
    } else {
      r.segmentDirections[segIdx] = RP.SEG_TELEPORT;
    }
    RP.render();
    RP.updateInfoPanel();
    return true;
  }
  return false;
};

RP.addWaypoint = function(x, y) {
  var r = RP.getActiveRoute();
  if (!r) return;
  r.waypoints.push({ x: x, y: y, label: '', id: RP.nextWpId++ });
  // New trailing segment defaults to forward.
  if (r.waypoints.length >= 2) {
    if (!Array.isArray(r.segmentDirections)) r.segmentDirections = [];
    r.segmentDirections.push(RP.SEG_FORWARD);
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
  // Inserting in segment `idx` splits it into two halves; both halves
  // inherit the parent segment's direction.
  var parentDir = r.segmentDirections[idx] || RP.SEG_FORWARD;
  r.waypoints.splice(idx + 1, 0, { x: x, y: y, label: '', id: RP.nextWpId++ });
  // Replace segmentDirections[idx] (the parent) with two copies.
  r.segmentDirections.splice(idx, 1, parentDir, parentDir);
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
      // Adjust segmentDirections:
      //   - Removing wpIdx removes segment(s) touching it. Specifically:
      //     * If wpIdx == 0: segment 0 (between wp[0] and wp[1]) goes away.
      //     * If wpIdx == last: segment (last-1) goes away.
      //     * Otherwise: segments (wpIdx-1) and (wpIdx) merge into one;
      //       the surviving segment inherits the INCOMING segment's
      //       direction (segmentDirections[wpIdx-1]).
      var lastIdx = r.waypoints.length - 1;
      if (wpIdx === 0) {
        r.segmentDirections.splice(0, 1);
      } else if (wpIdx === lastIdx) {
        r.segmentDirections.splice(lastIdx - 1, 1);
      } else {
        var incomingDir = r.segmentDirections[wpIdx - 1] || RP.SEG_FORWARD;
        // Replace the two adjacent segments with one inheriting incoming.
        r.segmentDirections.splice(wpIdx - 1, 2, incomingDir);
      }
      r.waypoints.splice(wpIdx, 1);
      // Clear selected segment if it pointed at something that no longer exists.
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
  var r = { id: id, name: name || ('Route ' + id), waypoints: [], visible: true, segmentDirections: [] };
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

RP.updateSideRouteList = function() {
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
