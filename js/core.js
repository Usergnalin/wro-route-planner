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
// (Saved Routes panel removed — there is only one route.)
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
RP.dom.segmentModeNormal = document.getElementById('seg-mode-normal');
RP.dom.segmentModeTeleport = document.getElementById('seg-mode-teleport');
RP.dom.segmentModeLTDist = document.getElementById('seg-mode-lt-dist');
RP.dom.segmentModeLTJunct = document.getElementById('seg-mode-lt-junct');
RP.dom.segmentModeWallAlign = document.getElementById('seg-mode-wall-align');
RP.dom.segmentTeleportName = document.getElementById('seg-teleport-name');
RP.dom.segmentJunctionCount = document.getElementById('seg-junction-count');
RP.dom.segmentModeArc = document.getElementById('seg-mode-arc');
RP.dom.segmentModeParams = document.getElementById('seg-mode-params');
RP.dom.segmentOffsetRow = document.getElementById('seg-offset-row');
RP.dom.segmentOffset = document.getElementById('seg-offset');
RP.dom.segmentSpeedRow = document.getElementById('seg-speed-row');
RP.dom.segmentSpeed = document.getElementById('seg-speed');
RP.dom.nodeSection = document.getElementById('node-section');
RP.dom.nodeInfo = document.getElementById('node-info');
RP.dom.nodeTurnSpeedRow = document.getElementById('node-turn-speed-row');
RP.dom.nodeTurnSpeed = document.getElementById('node-turn-speed');
RP.dom.nodeExtraTurnsList = document.getElementById('node-extra-turns-list');
RP.dom.btnAddNodeTurn = document.getElementById('btn-add-node-turn');
RP.dom.btnCopyInstr = document.getElementById('btn-copy-instr');
RP.dom.btnCopyCode = document.getElementById('btn-copy-code');
RP.dom.btnSetStart = document.getElementById('btn-set-start');
RP.dom.btnClearStart = document.getElementById('btn-clear-start');
RP.dom.btnToolConstruction = document.getElementById('btn-tool-construction');
RP.dom.btnToolSelect = document.getElementById('btn-tool-select');
RP.dom.btnToolArc = document.getElementById('btn-tool-arc');
RP.dom.btnSidebarArc = document.getElementById('btn-sidebar-arc');
RP.dom.btnSidebarConstruction = document.getElementById('btn-sidebar-construction');
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
// Read-only VIEW over the sketch layer, rebuilt by RP.rebuildLines().
// Line ids are sketch entity ids — there is no separate line id space.
RP.lines = [];
RP.arcs = [];   // sibling view for arc entities

// Routes: { id, name, nodes: [{x,y,id,isCheckpoint,checkpointName}], segments: [{id,fromNodeId,toNodeId,direction,mode,...}], visible }
RP.routes = [];
RP.activeRouteId = null;
RP.nextWpId = 1;    // shared id counter for nodes
RP.nextSegId = 1;   // segment id counter
RP.nextRouteId = 1;

// Active tool: 'construction' | 'route'
RP.activeTool = 'construction';
// The old route CREATION tools spoke the node/segment model, which is now
// a derived read-only view. They have been removed from the UI and their
// job belongs to Route mode; this guard just stops anything reactivating
// them before phase 9 deletes the handlers.
RP.ROUTE_EDIT_LOCKED = true;
// `arc` is no longer locked: it now draws a SKETCH arc, not a route arc.
RP.LOCKED_TOOLS = { route: 1, freehand: 1, checkpoint: 1 };

RP.TOOL_LABELS = {
  construction: 'Construction', route: 'Route', select: 'Select',
  checkpoint: 'Checkpoint', freehand: 'Freehand', arc: 'Arc',
  constrain: 'Constrain'
};

// Code configuration
RP.codeConfig = {
  commentPrefix: '#',
  forwardTemplate: 'robot.move_distance(distance={distance}, speed={speed})',
  turnTemplate: 'robot.turn_arc(angle={angle}, speed={speed})',
  turnArcTemplate: 'robot.turn_arc(angle={angle}, speed={speed}, radius={radius})',
  wallAlignTemplate: 'robot.wall_align(reversed={reversed}, speed={speed})',
  lineTraceDistTemplate: 'line_trace_distance({distance}, {speed})',
  lineTraceJunctTemplate: 'line_trace_until_junctions({junctions}, {speed})',
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
RP.elementDrag = null;
RP.sketchDrag = null;   // { pointId, moved } while dragging in constrain mode
RP.startMarkerPlacing = false;
RP.startMarkerPlacingHeading = false;
RP.startMarkerPlacedPoint = null;
RP.hoverSnapPoint = null;
RP.snapEnabled = true;
RP.ctrlHeld = false;     // Track Ctrl key state
RP.instructionsVisible = true;

// Undo/Redo
RP.MAX_HISTORY = 80;
RP.undoStack = [];
RP.redoStack = [];

// Robot config
RP.DEFAULT_ROBOT_CONFIG = {
  frontClearance: 50,
  rearClearance: 50,
  startPos: null,
  startHeading: 0
};
RP.DEFAULT_CODE_CONFIG_VALUES = {
  commentPrefix: '#',
  forwardTemplate: 'robot.move_distance(distance={distance}, speed={speed})',
  turnTemplate: 'robot.turn_arc(angle={angle}, speed={speed})',
  turnArcTemplate: 'robot.turn_arc(angle={angle}, speed={speed}, radius={radius})',
  wallAlignTemplate: 'robot.wall_align(reversed={reversed}, speed={speed})',
  lineTraceDistTemplate: 'line_trace_distance({distance}, {speed})',
  lineTraceJunctTemplate: 'line_trace_until_junctions({junctions}, {speed})',
  checkpointTemplate: 'if callable({name}): {name}()',
  defaultSpeed: 200,
  defaultUnit: 'mm'
};
RP.freshRobotConfig = function() { return JSON.parse(JSON.stringify(RP.DEFAULT_ROBOT_CONFIG)); };
RP.freshCodeConfig = function() { return JSON.parse(JSON.stringify(RP.DEFAULT_CODE_CONFIG_VALUES)); };
RP.robotConfig = {
  frontClearance: 50,
  rearClearance: 50,
  startPos: null,
  startHeading: 0
};
RP.robotOverlayVisible = false;

// Extra-turn entries may be a plain number (legacy) or { deg, speed } object.
RP.extraTurnDeg = function(t) { return (t && typeof t === 'object') ? Number(t.deg) : Number(t); };
RP.extraTurnSpeed = function(t) {
  if (t && typeof t === 'object' && t.speed !== undefined && t.speed !== null && t.speed !== '') {
    var v = Number(t.speed);
    return isFinite(v) && v > 0 ? v : null;
  }
  return null;
};

// Debounce
RP.resizeTimer = null;

// Selected line (from layer list, for resolving overlapping line picks)
RP.selectedLineId = null;

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
    if (dSq1 < threshSq && dSq1 < bestPtSq) { bestPtSq = dSq1; bestPt = { x: l.x1, y: l.y1, kind: 'endpoint', pointId: l.p1 }; }
    var dx2 = ix - l.x2, dy2 = iy - l.y2;
    var dSq2 = dx2 * dx2 + dy2 * dy2;
    if (dSq2 < threshSq && dSq2 < bestPtSq) { bestPtSq = dSq2; bestPt = { x: l.x2, y: l.y2, kind: 'endpoint', pointId: l.p2 }; }
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
      if (dSq < threshSq && dSq < bestPtSq) { bestPtSq = dSq; bestPt = { x: p.x, y: p.y, kind: 'intersection', lineIds: [a.id, b.id] }; }
    }
  }

  // Returned as-is so callers also get the snapped feature's identity
  // (pointId / lineIds), which is what auto-constraints are derived from.
  if (bestPt) return bestPt;

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
  var bestProj = null, bestProjSq = Infinity, bestProjLineId = null;
  for (var li2 = 0; li2 < RP.lines.length; li2++) {
    if (li2 === excludeLineIdx) continue;
    var l2 = RP.lines[li2];
    var proj = RP.perpendicularProject(ix, iy, l2.x1, l2.y1, l2.x2, l2.y2);
    if (!proj) continue;
    var pdx = ix - proj.x, pdy = iy - proj.y;
    var pSq = pdx * pdx + pdy * pdy;
    if (pSq < threshSq && pSq < bestProjSq) { bestProjSq = pSq; bestProj = proj; bestProjLineId = l2.id; }
  }
  if (bestProj) return { x: bestProj.x, y: bestProj.y, kind: 'along-line', lineId: bestProjLineId };

  return null;
};

// Screen-space distance from a point to the nearest node of the active
// route. ANY node can be a drag anchor for a new segment.
RP.ROUTE_CONTINUE_SCREEN_RADIUS = 20;

// ======================================================================
// UNDO / REDO
// ======================================================================
RP.snapshotState = function() {
  return {
    sketch: RP.serializeSketch(),
    construction: JSON.parse(JSON.stringify(RP.constructionMeta)),
    routes: RP.serializeRoutes ? RP.serializeRoutes() : JSON.parse(JSON.stringify(RP.routes)),
    activeRouteId: RP.activeRouteId,
    nextElementId: RP.nextElementId,
    nextWpId: RP.nextWpId,
    nextSegId: RP.nextSegId,
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
  // Restored positions are already consistent, so the sketch is NOT
  // re-solved here — that would be free to pick a different valid
  // configuration and quietly move geometry on undo.
  RP.deserializeSketch(s.sketch);
  RP.constructionMeta = JSON.parse(JSON.stringify(s.construction || {}));
  RP.rebuildLines();
  RP.routes = JSON.parse(JSON.stringify(s.routes));
  RP.activeRouteId = s.activeRouteId;
  RP.nextElementId = s.nextElementId || RP.nextElementId || 1;
  RP.nextWpId = s.nextWpId;
  RP.nextSegId = s.nextSegId || 1;
  RP.nextRouteId = s.nextRouteId;
  RP.calibration = s.calibration ? JSON.parse(JSON.stringify(s.calibration)) : null;
  RP.robotConfig = JSON.parse(JSON.stringify(s.robotConfig));
  RP.codeConfig = JSON.parse(JSON.stringify(s.codeConfig));
  // Migrate restored routes in case the snapshot pre-dates the
  // direction field (no-op otherwise).
  if (RP.migrateAllRoutes) RP.migrateAllRoutes();
  if (RP.migrateRoutesToElements) RP.migrateRoutesToElements();
  // nodes/segments are derived views and are not persisted, so they must
  // be rebuilt before anything reads them.
  if (RP.rebuildRouteViews) RP.rebuildRouteViews();
  // Validate selected segment against restored state; clear if stale.
  if (RP.selectedSegment) {
    var stillValid = false;
    for (var ri = 0; ri < RP.routes.length; ri++) {
      var r = RP.routes[ri];
      if (r.id === RP.selectedSegment.routeId && RP.findSegment && RP.findSegment(r, RP.selectedSegment.segId)) {
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
  if (RP.ROUTE_EDIT_LOCKED && RP.LOCKED_TOOLS[tool]) {
    var lockHint = document.getElementById('sidebar-tool-hint');
    if (lockHint) lockHint.textContent = 'Route editing lives in Route mode now';
    return;
  }
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
    else if (tool === 'checkpoint') hint.textContent = 'Click route mid/end to place checkpoint';
    else if (tool === 'arc') hint.textContent = 'Drag the chord · then drag the centre to curve it';
    else if (tool === 'constrain') hint.textContent = 'Click geometry to select · shift-click adds · drag points to move';
  }
  // Cancel any in-progress drawing when switching tools.
  RP.lineDrawing = false;
  RP.lineDrawStart = null;
  RP.hoverSnapPoint = null;
  // Selected segment only makes sense in select mode.
  if (tool !== 'select') RP.selectedSegment = null;
  // Sketch selection only makes sense in constrain mode.
  if (tool !== 'constrain' && RP.clearSketchSelection) RP.clearSketchSelection();
  if (RP.updateConstraintPanel) RP.updateConstraintPanel();
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
  var seg = route && RP.findSegment ? RP.findSegment(route, RP.selectedSegment.segId) : null;
  if (!route || !seg) {
    RP.selectedSegment = null;
    RP.dom.segmentSection.style.display = 'none';
    return;
  }
  var a = RP.findNode(route, seg.fromNodeId);
  var b = RP.findNode(route, seg.toNodeId);
  var dir  = seg.direction || RP.SEG_FORWARD;
  var mode = seg.mode || RP.SEG_MODE_NORMAL;
  var isTeleport = mode === RP.SEG_MODE_TELEPORT;
  var isLineTrace = mode === RP.SEG_MODE_LINETRACE_DIST || mode === RP.SEG_MODE_LINETRACE_JUNCT;
  var dirColor = isTeleport ? '#ffaa00' : (isLineTrace ? '#44ff88' : (dir === RP.SEG_BACKWARD ? '#ff8844' : '#44aaff'));
  var dirLabel = dir === RP.SEG_BACKWARD ? 'Backward' : 'Forward';
  var isFollowPath = mode === RP.SEG_MODE_FOLLOW_PATH;
  var isArc = mode === RP.SEG_MODE_ARC && seg.sagitta;
  var modeLabel = mode === RP.SEG_MODE_TELEPORT ? 'Teleport' : (mode === RP.SEG_MODE_LINETRACE_DIST ? 'Line Trace (dist)' : (mode === RP.SEG_MODE_LINETRACE_JUNCT ? 'Line Trace (junct)' : (mode === RP.SEG_MODE_WALL_ALIGN ? 'Wall Align' : (isFollowPath ? 'Follow Path' : (isArc ? 'Arc' : 'Normal')))));
  var unit = (RP.codeConfig && RP.codeConfig.defaultUnit) || 'mm';
  var uf = (RP.unitFactor ? RP.unitFactor(unit) : 1);
  var lenStr = '';
  // Follow-path / arc length is the true curved length, not the straight node-to-node distance
  var lenPx;
  var arcGeo = null;
  if (isFollowPath && seg.pathPoints && RP.polylineLengthPx) {
    var fpSmoothPanel = (RP.codeConfig && RP.codeConfig.followPathSmoothness) || 0;
    var fpLenPts = (fpSmoothPanel > 0 && RP.chaikinSmooth) ? RP.chaikinSmooth(seg.pathPoints, fpSmoothPanel) : seg.pathPoints;
    lenPx = RP.polylineLengthPx(fpLenPts);
  } else if (isArc && RP.computeArcGeom) {
    arcGeo = RP.computeArcGeom(a.x, a.y, b.x, b.y, seg.sagitta);
    lenPx = arcGeo ? arcGeo.radiusPx * Math.abs(arcGeo.sweepRad) : RP.dist(a.x, a.y, b.x, b.y);
  } else {
    lenPx = RP.dist(a.x, a.y, b.x, b.y);
  }
  if (RP.calibration) {
    lenStr = (lenPx / RP.calibration.pixelsPerMm / uf).toFixed(1) + ' ' + unit;
  } else {
    lenStr = 'no calibration';
  }
  if (RP.dom.segmentInfo) {
    var fpInfo = '';
    if (isFollowPath) {
      var nSamp = (RP.codeConfig && RP.codeConfig.followPathSamples) || 60;
      fpInfo = '<div style="font-size:10px;color:#cc88ff;margin-top:2px">Drawn path: ' +
        (seg.pathPoints ? seg.pathPoints.length : 0) + ' pts → ' + nSamp + ' heading samples</div>';
    } else if (isArc && arcGeo) {
      var arcRmm = RP.calibration ? (arcGeo.radiusPx / RP.calibration.pixelsPerMm / uf) : arcGeo.radiusPx;
      var arcAngDeg = Math.abs(arcGeo.sweepRad) * 180 / Math.PI;
      var sideTxt = (arcGeo.sweepRad >= 0) === (dir !== RP.SEG_BACKWARD) ? 'right' : 'left';
      fpInfo = '<div style="font-size:10px;color:#ffcc44;margin-top:2px">Radius: ' + arcRmm.toFixed(1) + ' ' + unit +
        ' · Sweep: ' + arcAngDeg.toFixed(1) + '° ' + sideTxt + '<br>Drag the handle to reshape</div>';
    }
    RP.dom.segmentInfo.innerHTML =
      '<div>Route: ' + route.name + '</div>' +
      '<div>Segment ' + (route.segments.indexOf(seg) + 1) + ' of ' + route.segments.length + '</div>' +
      '<div>Length: ' + lenStr + '</div>' +
      '<div>Direction: <b style="color:' + dirColor + '">' + dirLabel + '</b></div>' +
      '<div>Mode: <b>' + modeLabel + '</b></div>' +
      (isTeleport ? '<div style="font-size:10px;color:#ffaa00;margin-top:2px">Turns omitted — insert custom code</div>' : '') +
      fpInfo;
  }

  // Mode selector radios.
  if (RP.dom.segmentModeNormal)    RP.dom.segmentModeNormal.checked    = (mode === RP.SEG_MODE_NORMAL);
  if (RP.dom.segmentModeTeleport)  RP.dom.segmentModeTeleport.checked  = (mode === RP.SEG_MODE_TELEPORT);
  if (RP.dom.segmentModeLTDist)    RP.dom.segmentModeLTDist.checked    = (mode === RP.SEG_MODE_LINETRACE_DIST);
  if (RP.dom.segmentModeLTJunct)   RP.dom.segmentModeLTJunct.checked   = (mode === RP.SEG_MODE_LINETRACE_JUNCT);
  if (RP.dom.segmentModeWallAlign) RP.dom.segmentModeWallAlign.checked = (mode === RP.SEG_MODE_WALL_ALIGN);
  if (RP.dom.segmentModeFollowPath) RP.dom.segmentModeFollowPath.checked = (mode === RP.SEG_MODE_FOLLOW_PATH);
  if (RP.dom.segmentModeArc) RP.dom.segmentModeArc.checked = (mode === RP.SEG_MODE_ARC);

  // Direction button — greyed out for teleport and both line trace modes.
  if (RP.dom.btnFlipSegment) {
    RP.dom.btnFlipSegment.textContent = (dir === RP.SEG_BACKWARD ? '\u2190 Backward' : '\u2192 Forward');
    var blockDir = isTeleport || isLineTrace || isFollowPath;
    RP.dom.btnFlipSegment.style.opacity = blockDir ? '0.35' : '1';
    RP.dom.btnFlipSegment.style.pointerEvents = blockDir ? 'none' : 'auto';
  }

  // Mode-specific parameter inputs.
  if (RP.dom.segmentModeParams) {
    if (isTeleport) {
      RP.dom.segmentModeParams.style.display = '';
      if (RP.dom.segmentTeleportName) {
        RP.dom.segmentTeleportName.style.display = '';
        RP.dom.segmentTeleportName.value = seg.teleportName || ('teleport_' + seg.id);
      }
      if (RP.dom.segmentJunctionCount) RP.dom.segmentJunctionCount.style.display = 'none';
    } else if (mode === RP.SEG_MODE_LINETRACE_JUNCT) {
      RP.dom.segmentModeParams.style.display = '';
      if (RP.dom.segmentTeleportName) RP.dom.segmentTeleportName.style.display = 'none';
      if (RP.dom.segmentJunctionCount) {
        RP.dom.segmentJunctionCount.style.display = '';
        RP.dom.segmentJunctionCount.value = seg.junctionCount || 1;
      }
    } else {
      RP.dom.segmentModeParams.style.display = 'none';
    }
  }

  // Offset row — shown for normal, linetrace_dist, and follow_path (adds to distance/length)
  var hasOffset = mode === RP.SEG_MODE_NORMAL || mode === RP.SEG_MODE_LINETRACE_DIST || mode === RP.SEG_MODE_FOLLOW_PATH;
  if (RP.dom.segmentOffsetRow) RP.dom.segmentOffsetRow.style.display = hasOffset ? '' : 'none';
  if (RP.dom.segmentOffset && hasOffset) RP.dom.segmentOffset.value = seg.offset || 0;

  // Speed row — every mode emits a {speed} action except teleport (comment block only)
  var hasSpeed = !isTeleport;
  if (RP.dom.segmentSpeedRow) RP.dom.segmentSpeedRow.style.display = hasSpeed ? '' : 'none';
  if (RP.dom.segmentSpeed && hasSpeed) RP.dom.segmentSpeed.value = (seg.speed != null ? seg.speed : '');

  RP.dom.segmentSection.style.display = '';
};

// ======================================================================
// NODE PANEL
// ======================================================================
RP.selectedNode = null;

RP.updateNodePanel = function() {
  if (!RP.dom.nodeSection) return;
  if (RP.activeTool !== 'select' || !RP.selectedNode) {
    RP.dom.nodeSection.style.display = 'none';
    return;
  }
  var route = null;
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id === RP.selectedNode.routeId) { route = RP.routes[i]; break; }
  }
  var node = route ? RP.findNode(route, RP.selectedNode.nodeId) : null;
  if (!node) { RP.selectedNode = null; RP.dom.nodeSection.style.display = 'none'; return; }
  RP.dom.nodeSection.style.display = '';

  var lp = RP.computeLongestPath ? RP.computeLongestPath(route) : [];
  var pathIdx = -1;
  for (var j = 0; j < lp.length; j++) { if (lp[j].id === node.id) { pathIdx = j; break; } }
  var posLabel = pathIdx >= 0 ? 'Node ' + (pathIdx + 1) + ' of ' + lp.length : 'Off-path node';
  var typeLabel = pathIdx === 0 ? ' (start)' : (pathIdx === lp.length - 1 ? ' (end)' : (pathIdx > 0 ? ' (interior)' : ''));
  RP.dom.nodeInfo.textContent = 'Route: ' + route.name + '\n' + posLabel + typeLabel + '\n(' + node.x.toFixed(0) + ', ' + node.y.toFixed(0) + ')';

  // Geometric turn speed only meaningful for interior nodes (start/end have no geometric turn)
  if (RP.dom.nodeTurnSpeedRow) {
    var interior = pathIdx > 0 && pathIdx < lp.length - 1;
    RP.dom.nodeTurnSpeedRow.style.display = interior ? '' : 'none';
    if (RP.dom.nodeTurnSpeed) RP.dom.nodeTurnSpeed.value = (node.turnSpeed != null ? node.turnSpeed : '');
  }

  RP.rebuildNodeTurnsList(node);
};

RP.rebuildNodeTurnsList = function(node) {
  if (!RP.dom.nodeExtraTurnsList || !node) return;
  var turns = node.extraTurns || [];
  var html = '';
  for (var i = 0; i < turns.length; i++) {
    var tDeg = RP.extraTurnDeg(turns[i]);
    var tSpd = RP.extraTurnSpeed(turns[i]);
    html += '<div class="node-turn-entry" data-idx="' + i + '" style="display:flex;align-items:center;gap:4px;margin-bottom:3px">' +
      '<input type="number" class="node-turn-input" value="' + (isFinite(tDeg) ? tDeg : 0).toFixed(1) + '" step="1" title="Turn angle" ' +
      'style="flex:1;min-width:0;background:#3a3a3a;border:1px solid #555;color:#ddd;padding:2px 6px;border-radius:3px;font-size:11px;text-align:right">' +
      '<span style="color:#aaa;font-size:11px;flex-shrink:0">°</span>' +
      '<input type="number" class="node-turn-speed-input" value="' + (tSpd != null ? tSpd : '') + '" min="1" placeholder="spd" title="Turn speed (blank = default)" ' +
      'style="width:44px;flex-shrink:0;background:#3a3a3a;border:1px solid #555;color:#ddd;padding:2px 4px;border-radius:3px;font-size:11px;text-align:right">' +
      '<button class="node-turn-del" title="Remove" style="background:#552222;border:1px solid #774444;color:#faa;padding:1px 7px;border-radius:3px;font-size:12px;cursor:pointer;flex-shrink:0">×</button>' +
      '</div>';
  }
  if (turns.length === 0) {
    html = '<div style="color:#666;font-size:11px;font-style:italic;margin-bottom:3px">No extra turns</div>';
  }
  RP.dom.nodeExtraTurnsList.innerHTML = html;
};

RP.getSelectedNodeObj = function() {
  if (!RP.selectedNode) return null;
  for (var i = 0; i < RP.routes.length; i++) {
    if (RP.routes[i].id === RP.selectedNode.routeId)
      return RP.findNode(RP.routes[i], RP.selectedNode.nodeId) || null;
  }
  return null;
};

// ======================================================================
// INFO PANEL
// ======================================================================
RP.updateInfoPanel = function() {
  if (!RP.dom.infoTool) return;
  // (A ternary chain here used to label the arc tool "Checkpoint".)
  RP.dom.infoTool.textContent = (RP.editMode === 'route')
    ? 'Route mode'
    : (RP.TOOL_LABELS[RP.activeTool] || RP.activeTool);
  RP.dom.infoSnap.textContent = RP.snapEnabled ? 'On' : 'Off';
  RP.dom.infoLines.textContent = RP.lines.length;
  var dofEl = document.getElementById('info-dof');
  if (dofEl && RP.sketchStatusInfo) {
    var si = RP.sketchStatusInfo();
    dofEl.textContent = si.text;
    dofEl.style.color = si.color;
  }
  // One route, so the useful count is how many elements it has.
  var theRoute = RP.getActiveRoute ? RP.getActiveRoute() : null;
  RP.dom.infoRoutes.textContent = (theRoute && theRoute.elements) ? theRoute.elements.length : 0;
  RP.dom.infoCalibStatus.textContent = RP.calibration
    ? RP.calibration.pixelsPerMm.toFixed(4) + ' px/mm'
    : 'Not set';
  if (RP.dom.routeWpCount) {
    var r = RP.getActiveRoute();
    RP.dom.routeWpCount.textContent = r ? (r.nodes ? r.nodes.length : 0) + ' nodes' : 'No active route';
  }
  RP.updateSegmentPanel();
  // Node panel: only refresh info text, not the turns list (avoid clobbering active inputs)
  if (RP.dom.nodeSection) {
    if (RP.activeTool !== 'select' || !RP.selectedNode) {
      RP.dom.nodeSection.style.display = 'none';
    } else {
      var _n = RP.getSelectedNodeObj();
      if (_n && RP.dom.nodeInfo) {
        var _r = null;
        for (var _i = 0; _i < RP.routes.length; _i++) {
          if (RP.routes[_i].id === RP.selectedNode.routeId) { _r = RP.routes[_i]; break; }
        }
        if (_r) {
          var _lp = RP.computeLongestPath ? RP.computeLongestPath(_r) : [];
          var _pi = -1;
          for (var _j = 0; _j < _lp.length; _j++) { if (_lp[_j].id === _n.id) { _pi = _j; break; } }
          var _tl = _pi === 0 ? ' (start)' : (_pi === _lp.length - 1 ? ' (end)' : (_pi > 0 ? ' (interior)' : ''));
          RP.dom.nodeInfo.textContent = 'Route: ' + _r.name + '\n' + (_pi >= 0 ? 'Node ' + (_pi + 1) + ' of ' + _lp.length : 'Off-path') + _tl + '\n(' + _n.x.toFixed(0) + ', ' + _n.y.toFixed(0) + ')';
        }
      }
    }
  }
};

// ======================================================================
// togglePanel - exposed globally for onclick in HTML
// ======================================================================
window.togglePanel = function(el) {
  el.classList.toggle('collapsed');
  var arrow = el.querySelector('span');
  if (arrow) arrow.textContent = el.classList.contains('collapsed') ? '\u25b6' : '\u25bc';
};
