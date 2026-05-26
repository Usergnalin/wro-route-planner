/* ========================================================================
   core.js - State, DOM refs, geometry, snap, undo/redo, zoom/pan
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

// ======================================================================
// DOM REFERENCES
// ======================================================================
RP.dom = {};
RP.dom.canvas = document.getElementById('canvas');
RP.dom.ctx = RP.dom.canvas.getContext('2d');
RP.dom.wrap = document.getElementById('canvas-wrap');
RP.dom.fileInput = document.getElementById('file-input');
RP.dom.imageInfo = document.getElementById('image-info');
RP.dom.calibStatus = document.getElementById('calib-status');
RP.dom.zoomHint = document.getElementById('zoom-hint');
RP.dom.sidePanels = document.getElementById('side-panels');
RP.dom.instrList = document.getElementById('instr-list');
RP.dom.instrTotal = document.getElementById('instr-total');
RP.dom.codeOutput = document.getElementById('code-output');
RP.dom.routeListEl = document.getElementById('route-list');
RP.dom.mapListEl = document.getElementById('map-list');
RP.dom.routeSelect = document.getElementById('route-select');
RP.dom.robotOverlay = document.getElementById('robot-overlay');
RP.dom.infoTool = document.getElementById('info-tool');
RP.dom.infoSnap = document.getElementById('info-snap');
RP.dom.infoHover = document.getElementById('info-hover');
RP.dom.infoClick = document.getElementById('info-click');
RP.dom.infoLines = document.getElementById('info-lines');
RP.dom.infoRoutes = document.getElementById('info-routes');
RP.dom.infoCalibStatus = document.getElementById('info-calib-status');
RP.dom.routeWpCount = document.getElementById('route-wp-count');

RP.dom.btnZoomIn = document.getElementById('btn-zoom-in');
RP.dom.btnZoomOut = document.getElementById('btn-zoom-out');
RP.dom.btnFit = document.getElementById('btn-fit');
RP.dom.btnSnap = document.getElementById('btn-snap');
RP.dom.btnSidebarSnap = document.getElementById('btn-sidebar-snap');
RP.dom.btnRobotConfig = document.getElementById('btn-robot-config');
RP.dom.btnDelRoute = document.getElementById('btn-del-route');
RP.dom.btnNewRoute = document.getElementById('btn-new-route');
RP.dom.btnSaveMap = document.getElementById('btn-save-map');
RP.dom.btnLoadMap = document.getElementById('btn-load-map');
RP.dom.btnExportProject = document.getElementById('btn-export-project');
RP.dom.btnImportProject = document.getElementById('btn-import-project');
RP.dom.btnInstrToggle = document.getElementById('btn-instr-toggle');
RP.dom.btnUndo = document.getElementById('btn-undo');
RP.dom.btnRedo = document.getElementById('btn-redo');
RP.dom.btnClearAll = document.getElementById('btn-clear-all');
RP.dom.btnRecalibrate = document.getElementById('btn-recalibrate');
RP.dom.segmentSection = document.getElementById('segment-section');
RP.dom.segmentInfo = document.getElementById('segment-info');
RP.dom.btnFlipSegment = document.getElementById('btn-flip-segment');
RP.dom.btnCopyInstr = document.getElementById('btn-copy-instr');
RP.dom.btnCopyCode = document.getElementById('btn-copy-code');
RP.dom.btnSetStart = document.getElementById('btn-set-start');
RP.dom.btnClearStart = document.getElementById('btn-clear-start');
RP.dom.btnToolConstruction = document.getElementById('btn-tool-construction');
RP.dom.btnToolRoute = document.getElementById('btn-tool-route');
RP.dom.btnToolSelect = document.getElementById('btn-tool-select');
RP.dom.btnSidebarConstruction = document.getElementById('btn-sidebar-construction');
RP.dom.btnSidebarRoute = document.getElementById('btn-sidebar-route');
RP.dom.btnSidebarSelect = document.getElementById('btn-sidebar-select');

// ======================================================================
// STATE
// ======================================================================
RP.img = null;
RP.imgDataUrl = null;
RP.offsetX = 0;
RP.offsetY = 0;
RP.scale = 1;
RP.minScale = 0.01;
RP.maxScale = 500;
RP.imgNaturalW = 0;
RP.imgNaturalH = 0;

// Calibration
RP.calibration = null;

// Lines (construction lines only now): [{ id, x1, y1, x2, y2, type: 'construction', label }]
RP.lines = [];
RP.nextLineId = 1;

// Routes: { id, name, waypoints: [{x,y,label,id}], visible }
// Waypoints no longer have 'action' property; route mode just adds waypoints
RP.routes = [];
RP.activeRouteId = null;
RP.nextWpId = 1;
RP.nextRouteId = 1;

// Active tool: 'construction' | 'route'
RP.activeTool = 'construction';

// Code configuration
RP.codeConfig = {
  commentPrefix: '//',
  forwardTemplate: 'move({distance}, {speed})',
  turnRightTemplate: 'turn_right({angle}, {speed})',
  turnLeftTemplate: 'turn_left({angle}, {speed})',
  defaultSpeed: 200,
  defaultUnit: 'mm'
};

// State for interaction
RP.isDragging = false;
RP.dragStartX = 0;
RP.dragStartY = 0;
RP.dragStartOffX = 0;
RP.dragStartOffY = 0;
RP.lineDrawing = false;
RP.lineDrawStart = null;
RP.waypointDrag = null;
RP.elementDrag = null;
RP.startMarkerPlacing = false;
RP.startMarkerPlacingHeading = false;
RP.startMarkerPlacedPoint = null;
RP.hoverSnapPoint = null;
RP.snapEnabled = true;
RP.ctrlHeld = false;     // Track Ctrl key state
RP.instructionsVisible = true;
RP.activeTab = 'instr';

// Undo/Redo
RP.MAX_HISTORY = 80;
RP.undoStack = [];
RP.redoStack = [];

// Robot config
RP.DEFAULT_ROBOT_CONFIG = {
  width: 250,
  length: 250,
  wheelbase: 180,
  startPos: null,
  startHeading: 0
};
RP.DEFAULT_CODE_CONFIG_VALUES = {
  commentPrefix: '//',
  forwardTemplate: 'move({distance}, {speed})',
  turnRightTemplate: 'turn_right({angle}, {speed})',
  turnLeftTemplate: 'turn_left({angle}, {speed})',
  defaultSpeed: 200,
  defaultUnit: 'mm'
};
RP.freshRobotConfig = function() { return JSON.parse(JSON.stringify(RP.DEFAULT_ROBOT_CONFIG)); };
RP.freshCodeConfig = function() { return JSON.parse(JSON.stringify(RP.DEFAULT_CODE_CONFIG_VALUES)); };
RP.robotConfig = {
  width: 250,
  length: 250,
  wheelbase: 180,
  startPos: null,
  startHeading: 0
};
RP.robotOverlayVisible = false;

// Debounce
RP.resizeTimer = null;

// Last mouse position
RP.lastMouseImg = { x: 0, y: 0 };

// Mouse state
RP.mouseDownClient = { x: 0, y: 0 };
RP.mouseMovedSinceDown = false;

// Touch state
RP.lastTouchDist = 0;
RP.lastTouchCenter = null;
RP.touchPanStart = null;

// ======================================================================
// CANVAS SIZING
// ======================================================================
RP.resizeCanvas = function() {
  var rect = RP.dom.wrap.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  RP.dom.canvas.width = rect.width * dpr;
  RP.dom.canvas.height = rect.height * dpr;
  RP.dom.canvas.style.width = rect.width + 'px';
  RP.dom.canvas.style.height = rect.height + 'px';
  RP.dom.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  RP.render();
};

RP.getCanvasSize = function() {
  var rect = RP.dom.wrap.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
};

// ======================================================================
// COORDINATE TRANSFORMS
// ======================================================================
RP.screenToImage = function(sx, sy) {
  var rect = RP.dom.wrap.getBoundingClientRect();
  return {
    x: (sx - rect.left - RP.offsetX) / RP.scale,
    y: (sy - rect.top - RP.offsetY) / RP.scale
  };
};

RP.imageToScreen = function(ix, iy) {
  return {
    x: ix * RP.scale + RP.offsetX,
    y: iy * RP.scale + RP.offsetY
  };
};

RP.screenDist = function(ix1, iy1, ix2, iy2) {
  var s1 = RP.imageToScreen(ix1, iy1);
  var s2 = RP.imageToScreen(ix2, iy2);
  return Math.hypot(s2.x - s1.x, s2.y - s1.y);
};

RP.snapThresholdImg = function(pxScreen) {
  return pxScreen / RP.scale;
};

// ======================================================================
// GEOMETRY HELPERS
// ======================================================================
RP.dist = function(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); };
RP.midpoint = function(x1, y1, x2, y2) { return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }; };
RP.lerp = function(x1, y1, x2, y2, t) { return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }; };
RP.angleRad = function(x1, y1, x2, y2) { return Math.atan2(y2 - y1, x2 - x1); };
RP.toDeg = function(r) { return ((r * 180 / Math.PI) % 360 + 360) % 360; };
RP.turnAngle = function(aDeg, bDeg) {
  var d = (bDeg - aDeg) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};
RP.pointToSegDistSq = function(px, py, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
  var t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  var cx = x1 + t * dx, cy = y1 + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
};
RP.perpendicularProject = function(px, py, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return null;
  var t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  if (t < 0 || t > 1) return null;
  return { x: x1 + t * dx, y: y1 + t * dy };
};
RP.lineIntersect = function(x1, y1, x2, y2, x3, y3, x4, y4) {
  var d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-10) return null;
  var t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
};
RP.segIntersect = function(x1, y1, x2, y2, x3, y3, x4, y4) {
  var d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-10) return null;
  var t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  var u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  }
  return null;
};

// ======================================================================
// 90-DEGREE ANGLE SNAP
// ======================================================================
RP.snap90 = function(ix, iy, ox, oy) {
  var dx = ix - ox;
  var dy = iy - oy;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x: ix, y: iy };
  var angDeg = RP.toDeg(Math.atan2(dy, dx));
  var targets = [0, 90, 180, 270];
  var best = targets[0];
  var bestDiff = 999;
  for (var ti = 0; ti < targets.length; ti++) {
    var t = targets[ti];
    var diff = Math.abs(angDeg - t);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = t; }
  }
  if (bestDiff <= 4) {
    var snapRad = best * Math.PI / 180;
    var len = Math.hypot(dx, dy);
    return { x: ox + len * Math.cos(snapRad), y: oy + len * Math.sin(snapRad) };
  }
  return { x: ix, y: iy };
};

// ======================================================================
// SNAP SYSTEM
// ----------------------------------------------------------------------
// Snap targets are ALWAYS only construction-line features. Route
// waypoints and route segments are NEVER snap targets. This is the
// single source of truth used by hover-indicator, start-of-drag, and
// end-of-drag (both for construction lines and route lines).
//
//   - kind: 'point'    -> hover / start-of-drag.
//                          Priority: endpoint+intersection > along-line.
//   - kind: 'line-end' -> end-of-drag (requires anchor).
//                          Priority: endpoint+intersection > 90deg > along-line.
//
// Ctrl held disables snap entirely (matches the sidebar hint).
// excludeLineIdx lets a line endpoint drag skip its own line so it
// doesn't self-snap.
// ======================================================================
RP.SNAP_SCREEN_RADIUS = 15;

RP.computeSnap = function(ix, iy, opts) {
  if (!RP.snapEnabled) return null;
  if (RP.ctrlHeld) return null;
  opts = opts || {};
  var kind = opts.kind || 'point';
  var anchor = opts.anchor || null;
  var excludeLineIdx = (typeof opts.excludeLineIdx === 'number') ? opts.excludeLineIdx : -1;

  var thresh = RP.snapThresholdImg(RP.SNAP_SCREEN_RADIUS);
  var threshSq = thresh * thresh;

  // ---------- PRIORITY 1: precise construction points ----------
  // (endpoints and intersections - both are "start/end of construction
  //  line" features in the geometric sense)
  var bestPt = null, bestPtSq = Infinity;

  // Endpoints
  for (var li = 0; li < RP.lines.length; li++) {
    if (li === excludeLineIdx) continue;
    var l = RP.lines[li];
    var dx1 = ix - l.x1, dy1 = iy - l.y1;
    var dSq1 = dx1 * dx1 + dy1 * dy1;
    if (dSq1 < threshSq && dSq1 < bestPtSq) { bestPtSq = dSq1; bestPt = { x: l.x1, y: l.y1, kind: 'endpoint' }; }
    var dx2 = ix - l.x2, dy2 = iy - l.y2;
    var dSq2 = dx2 * dx2 + dy2 * dy2;
    if (dSq2 < threshSq && dSq2 < bestPtSq) { bestPtSq = dSq2; bestPt = { x: l.x2, y: l.y2, kind: 'endpoint' }; }
  }

  // Intersections (still a "precise" construction-line feature)
  for (var i = 0; i < RP.lines.length; i++) {
    if (i === excludeLineIdx) continue;
    for (var j = i + 1; j < RP.lines.length; j++) {
      if (j === excludeLineIdx) continue;
      var a = RP.lines[i], b = RP.lines[j];
      var p = RP.segIntersect(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
      if (!p) continue;
      var ddx = ix - p.x, ddy = iy - p.y;
      var dSq = ddx * ddx + ddy * ddy;
      if (dSq < threshSq && dSq < bestPtSq) { bestPtSq = dSq; bestPt = { x: p.x, y: p.y, kind: 'intersection' }; }
    }
  }

  if (bestPt) return { x: bestPt.x, y: bestPt.y, kind: bestPt.kind };

  // ---------- PRIORITY 2: 90deg from anchor (line-end only) ----------
  // The 90deg snap is only valid when we already know the start of the
  // line we are drawing. It produces a candidate; we then check whether
  // that candidate also projects onto a construction line and prefer the
  // projected version (handled by along-line below).
  var ninetyPt = null;
  if (kind === 'line-end' && anchor) {
    var snapped = RP.snap90(ix, iy, anchor.x, anchor.y);
    if (snapped.x !== ix || snapped.y !== iy) {
      ninetyPt = { x: snapped.x, y: snapped.y, kind: '90deg' };
    }
  }
  if (ninetyPt) return ninetyPt;

  // ---------- PRIORITY 3: along a construction line (perpendicular projection) ----------
  var bestProj = null, bestProjSq = Infinity;
  for (var li2 = 0; li2 < RP.lines.length; li2++) {
    if (li2 === excludeLineIdx) continue;
    var l2 = RP.lines[li2];
    var proj = RP.perpendicularProject(ix, iy, l2.x1, l2.y1, l2.x2, l2.y2);
    if (!proj) continue;
    var pdx = ix - proj.x, pdy = iy - proj.y;
    var pSq = pdx * pdx + pdy * pdy;
    if (pSq < threshSq && pSq < bestProjSq) { bestProjSq = pSq; bestProj = proj; }
  }
  if (bestProj) return { x: bestProj.x, y: bestProj.y, kind: 'along-line' };

  return null;
};

// Screen-space distance from a point to the last waypoint of the active
// route, used to gate "start a new route segment" gestures. Route
// waypoints are never general-purpose snap targets, but the last
// waypoint of the active route IS a magnetic anchor specifically for
// continuing the route.
RP.ROUTE_CONTINUE_SCREEN_RADIUS = 20;
RP.tryRouteContinueAnchor = function(ix, iy) {
  var r = RP.getActiveRoute();
  if (!r || r.waypoints.length === 0) return null;
  var last = r.waypoints[r.waypoints.length - 1];
  var screenD = RP.screenDist(ix, iy, last.x, last.y);
  if (screenD < RP.ROUTE_CONTINUE_SCREEN_RADIUS) {
    return { x: last.x, y: last.y };
  }
  return null;
};

// ======================================================================
// UNDO / REDO
// ======================================================================
RP.snapshotState = function() {
  return {
    lines: JSON.parse(JSON.stringify(RP.lines)),
    nextLineId: RP.nextLineId,
    routes: JSON.parse(JSON.stringify(RP.routes)),
    activeRouteId: RP.activeRouteId,
    nextWpId: RP.nextWpId,
    nextRouteId: RP.nextRouteId,
    calibration: RP.calibration ? JSON.parse(JSON.stringify(RP.calibration)) : null,
    robotConfig: JSON.parse(JSON.stringify(RP.robotConfig)),
    codeConfig: JSON.parse(JSON.stringify(RP.codeConfig))
  };
};

RP.restoreState = function(s) {
  // Deep-clone on the way out so the live state can't ever share refs
  // with anything still sitting in the undo/redo stacks (defense in depth
  // against future refactors).
  RP.lines = JSON.parse(JSON.stringify(s.lines));
  RP.nextLineId = s.nextLineId;
  RP.routes = JSON.parse(JSON.stringify(s.routes));
  RP.activeRouteId = s.activeRouteId;
  RP.nextWpId = s.nextWpId;
  RP.nextRouteId = s.nextRouteId;
  RP.calibration = s.calibration ? JSON.parse(JSON.stringify(s.calibration)) : null;
  RP.robotConfig = JSON.parse(JSON.stringify(s.robotConfig));
  RP.codeConfig = JSON.parse(JSON.stringify(s.codeConfig));
  // Migrate restored routes in case the snapshot pre-dates the
  // direction field (no-op otherwise).
  if (RP.migrateAllRoutes) RP.migrateAllRoutes();
  // Validate selected segment against restored state; clear if stale.
  if (RP.selectedSegment) {
    var stillValid = false;
    for (var ri = 0; ri < RP.routes.length; ri++) {
      var r = RP.routes[ri];
      if (r.id === RP.selectedSegment.routeId && RP.selectedSegment.segIdx < r.waypoints.length - 1) {
        stillValid = true; break;
      }
    }
    if (!stillValid) RP.selectedSegment = null;
  }
  RP.updateRouteSelect();
  RP.updateSideRouteList();
  RP.updateRobotUI();
  RP.updateCodeConfigUI();
};

RP.pushHistory = function(desc) {
  RP.undoStack.push({ desc: desc, state: RP.snapshotState() });
  if (RP.undoStack.length > RP.MAX_HISTORY) RP.undoStack.shift();
  RP.redoStack = [];
};

RP.undo = function() {
  if (RP.undoStack.length === 0) return;
  var cur = RP.snapshotState();
  var prev = RP.undoStack.pop();
  RP.redoStack.push({ desc: prev.desc, state: cur });
  RP.restoreState(prev.state);
  RP.render();
};

RP.redo = function() {
  if (RP.redoStack.length === 0) return;
  var cur = RP.snapshotState();
  var next = RP.redoStack.pop();
  RP.undoStack.push({ desc: next.desc, state: cur });
  RP.restoreState(next.state);
  RP.render();
};

// ======================================================================
// ZOOM / PAN
// ======================================================================
RP.zoomAt = function(factor, sx, sy) {
  if (!RP.img) return;
  var size = RP.getCanvasSize();
  var cx = sx !== undefined ? sx : size.w / 2;
  var cy = sy !== undefined ? sy : size.h / 2;
  var newScale = Math.min(RP.maxScale, Math.max(RP.minScale, RP.scale * factor));
  if (newScale === RP.scale) return;
  factor = newScale / RP.scale;
  RP.offsetX = cx - factor * (cx - RP.offsetX);
  RP.offsetY = cy - factor * (cy - RP.offsetY);
  RP.scale = newScale;
  RP.render();
};

RP.resetView = function() {
  if (!RP.img) return;
  var size = RP.getCanvasSize();
  var iw = RP.img.naturalWidth || RP.img.width;
  var ih = RP.img.naturalHeight || RP.img.height;
  var pad = 40;
  var availW = size.w - pad * 2, availH = size.h - pad * 2;
  RP.scale = Math.min(availW / iw, availH / ih);
  RP.scale = Math.max(RP.minScale, Math.min(RP.maxScale, RP.scale));
  RP.offsetX = (size.w - iw * RP.scale) / 2;
  RP.offsetY = (size.h - ih * RP.scale) / 2;
  RP.render();
};

// ======================================================================
// TOOL SWITCHING
// (single source of truth - events.js used to have its own copy)
// ======================================================================
RP.setTool = function(tool) {
  RP.activeTool = tool;
  // Update top-bar tool buttons and sidebar tool buttons in one pass.
  var btns = document.querySelectorAll('.tool-btn[data-tool], .sidebar-tool-btn[data-tool]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].dataset.tool === tool);
  }
  // Update sidebar hint.
  var hint = document.getElementById('sidebar-tool-hint');
  if (hint) {
    if (tool === 'construction') hint.textContent = 'Drag to draw a line';
    else if (tool === 'route') hint.textContent = 'Drag from last dot to extend route';
    else if (tool === 'select') hint.textContent = 'Click dots/endpoints to move';
  }
  // Cancel any in-progress drawing when switching tools.
  RP.lineDrawing = false;
  RP.lineDrawStart = null;
  RP.hoverSnapPoint = null;
  // Selected segment only makes sense in select mode.
  if (tool !== 'select') RP.selectedSegment = null;
  RP.updateInfoPanel();
  RP.render();
};

// ======================================================================
// SEGMENT PANEL
// ======================================================================
RP.updateSegmentPanel = function() {
  if (!RP.dom.segmentSection) return;
  // Only show in select mode AND when we have a selection.
  if (RP.activeTool !== 'select' || !RP.selectedSegment) {
    RP.dom.segmentSection.style.display = 'none';
    return;
  }
  // Find the route + segment; clear stale selection.
  var route = null;
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id === RP.selectedSegment.routeId) { route = RP.routes[i]; break; }
  }
  if (!route || RP.selectedSegment.segIdx >= route.waypoints.length - 1) {
    RP.selectedSegment = null;
    RP.dom.segmentSection.style.display = 'none';
    return;
  }
  RP.ensureSegmentDirections(route);
  var idx = RP.selectedSegment.segIdx;
  var a = route.waypoints[idx], b = route.waypoints[idx + 1];
  var dir = route.segmentDirections[idx];
  var isTeleport = dir === RP.SEG_TELEPORT;
  var dirColor = isTeleport ? '#ffaa00' : (dir === RP.SEG_BACKWARD ? '#ff8844' : '#44aaff');
  var dirLabel = isTeleport ? 'Teleport' : (dir === RP.SEG_BACKWARD ? 'Backward' : 'Forward');
  var lenStr = '';
  if (RP.calibration) {
    var mm = RP.dist(a.x, a.y, b.x, b.y) / RP.calibration.pixelsPerMm;
    var unit = (RP.codeConfig && RP.codeConfig.defaultUnit) || 'mm';
    var uf = (RP.unitFactor ? RP.unitFactor(unit) : 1);
    lenStr = (mm / uf).toFixed(1) + ' ' + unit;
  } else {
    lenStr = 'no calibration';
  }
  if (RP.dom.segmentInfo) {
    RP.dom.segmentInfo.innerHTML =
      '<div>Route: ' + route.name + '</div>' +
      '<div>Segment: ' + (idx + 1) + ' of ' + (route.waypoints.length - 1) + '</div>' +
      '<div>Length: ' + lenStr + '</div>' +
      '<div>Direction: <b style="color:' + dirColor + '">' + dirLabel + '</b></div>' +
      (isTeleport ? '<div style="font-size:10px;color:#ffaa00;margin-top:2px">Turns omitted — insert manual arc logic</div>' : '');
  }
  RP.dom.segmentSection.style.display = '';
};

// ======================================================================
// INFO PANEL
// ======================================================================
RP.updateInfoPanel = function() {
  if (!RP.dom.infoTool) return;
  RP.dom.infoTool.textContent = RP.activeTool === 'construction' ? 'Construction' : (RP.activeTool === 'route' ? 'Route' : 'Select / Move');
  RP.dom.infoSnap.textContent = RP.snapEnabled ? 'On' : 'Off';
  RP.dom.infoLines.textContent = RP.lines.length;
  RP.dom.infoRoutes.textContent = RP.routes.length;
  RP.dom.infoCalibStatus.textContent = RP.calibration
    ? RP.calibration.pixelsPerMm.toFixed(4) + ' px/mm'
    : 'Not set';
  if (RP.dom.routeWpCount) {
    var r = RP.getActiveRoute();
    RP.dom.routeWpCount.textContent = r ? r.waypoints.length + ' waypoints' : 'No active route';
  }
  RP.updateSegmentPanel();
};

// ======================================================================
// togglePanel - exposed globally for onclick in HTML
// ======================================================================
window.togglePanel = function(el) {
  el.classList.toggle('collapsed');
  var arrow = el.querySelector('span');
  if (arrow) arrow.textContent = el.classList.contains('collapsed') ? '\u25b6' : '\u25bc';
};
