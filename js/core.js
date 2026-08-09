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
RP.dom.robotBackdrop = document.getElementById('robot-backdrop');
RP.dom.btnRobotClose = document.getElementById('btn-robot-close');
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
RP.dom.btnCopyInstr = document.getElementById('btn-copy-instr');
RP.dom.btnCopyCode = document.getElementById('btn-copy-code');
RP.dom.btnSetStart = document.getElementById('btn-set-start');
RP.dom.btnClearStart = document.getElementById('btn-clear-start');
// Tool buttons are not cached: they are bound and highlighted through
// their data-tool attribute, so nothing needs a handle on them by id.

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
RP.arcs = [];     // sibling view for arc entities
RP.points = [];   // standalone points — reference marks, not endpoints

// Routes: { id, name, nodes: [{x,y,id,isCheckpoint,checkpointName}], segments: [{id,fromNodeId,toNodeId,direction,mode,...}], visible }
RP.routes = [];
RP.activeRouteId = null;
RP.nextWpId = 1;    // shared id counter for nodes
RP.nextSegId = 1;   // segment id counter
RP.nextRouteId = 1;

// Active tool: 'construction' | 'route'
RP.activeTool = 'construction';
// The old route CREATION tools spoke the node/segment model, which is now
// a derived read-only view. Their handlers are gone and their job belongs
// to Route mode; this guard stops a stale save or a bookmarked call from
// selecting a tool that no longer does anything.
RP.ROUTE_EDIT_LOCKED = true;
// `arc` is no longer locked: it now draws a SKETCH arc, not a route arc.
RP.LOCKED_TOOLS = { route: 1, freehand: 1, checkpoint: 1 };

RP.TOOL_LABELS = {
  construction: 'Construction', select: 'Select', arc: 'Arc',
  point: 'Point', constrain: 'Constrain'
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
  // Blank = fall back to turnTemplate. Fill these in only if the robot
  // has a real one-wheel pivot that differs from a centre spin.
  turnPivotLeftTemplate: '',
  turnPivotRightTemplate: '',
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
  function considerPoint(x, y, pointId) {
    var dx = ix - x, dy = iy - y;
    var dSq = dx * dx + dy * dy;
    if (dSq < threshSq && dSq < bestPtSq) {
      bestPtSq = dSq;
      bestPt = { x: x, y: y, kind: 'endpoint', pointId: pointId };
    }
  }
  for (var li = 0; li < RP.lines.length; li++) {
    if (li === excludeLineIdx) continue;
    var l = RP.lines[li];
    considerPoint(l.x1, l.y1, l.p1);
    considerPoint(l.x2, l.y2, l.p2);
  }
  // Arc ends, so a line can be drawn away from where an arc finishes. The
  // centre is deliberately not offered: it is a control handle, not a
  // place on the mat you would measure to.
  for (var ai2 = 0; ai2 < RP.arcs.length; ai2++) {
    var sarc = RP.arcs[ai2];
    if (sarc.visible === false) continue;
    considerPoint(sarc.x1, sarc.y1, sarc.p1);
    considerPoint(sarc.x2, sarc.y2, sarc.p2);
  }
  // Standalone points exist to be snapped to — that is the whole job.
  for (var spi2 = 0; spi2 < RP.points.length; spi2++) {
    var spt = RP.points[spi2];
    if (spt.visible === false) continue;
    considerPoint(spt.x, spt.y, spt.id);
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
  // Validate the route-mode selection against restored state; clear if stale.
  if (RP.selectedActionId != null) {
    var restored = RP.getActiveRoute ? RP.getActiveRoute() : null;
    if (!restored || !RP.findAction(restored, RP.selectedActionId)) {
      RP.selectedActionId = null;
    }
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
    else if (tool === 'select') hint.textContent = 'Click dots/endpoints to move';
    else if (tool === 'point') hint.textContent = 'Click to place a reference point';
    else if (tool === 'arc') hint.textContent = 'Drag the chord · then drag the centre to curve it';
    else if (tool === 'constrain') hint.textContent = 'Click geometry to select · shift-click adds · drag points to move';
  }
  // Cancel any in-progress drawing when switching tools.
  RP.lineDrawing = false;
  RP.lineDrawStart = null;
  RP.hoverSnapPoint = null;
  // Sketch selection only makes sense in constrain mode.
  if (tool !== 'constrain' && RP.clearSketchSelection) RP.clearSketchSelection();
  if (RP.updateConstraintPanel) RP.updateConstraintPanel();
  RP.updateInfoPanel();
  RP.render();
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
};

// ======================================================================
// ROBOT / CODE CONFIG MODAL
// (single entry point so the backdrop and the button state cannot drift
//  out of sync with the dialog)
// ======================================================================
RP.setRobotOverlay = function(open) {
  RP.robotOverlayVisible = !!open;
  if (RP.dom.robotOverlay) RP.dom.robotOverlay.classList.toggle('visible', RP.robotOverlayVisible);
  if (RP.dom.robotBackdrop) RP.dom.robotBackdrop.classList.toggle('visible', RP.robotOverlayVisible);
  if (RP.dom.btnRobotConfig) RP.dom.btnRobotConfig.classList.toggle('active', RP.robotOverlayVisible);
  if (RP.robotOverlayVisible) {
    if (RP.updateRobotUI) RP.updateRobotUI();
    if (RP.updateCodeConfigUI) RP.updateCodeConfigUI();
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
