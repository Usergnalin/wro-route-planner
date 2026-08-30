/* ========================================================================
   route-ui.js - Sketch/Route mode switching and the Route mode UI.

   Route mode is strictly REFERENCE-ONLY: it never creates or moves
   geometry. You pick existing sketch geometry and say what the robot does
   along it, then set the movement parameters.

   Drawing lives entirely in Sketch mode.
   ======================================================================== */
var RP = window.RP || {};

RP.editMode = 'sketch';          // 'sketch' | 'route'
RP._lastSketchTool = 'construction';

// The selection is an ACTION of any type. `selectedMoveId` is a
// move-only view of it, which is what render and the move panel want: it
// reads through only when the selection really is a move, so selecting a
// turn correctly un-highlights every segment.
RP.selectedActionId = null;
Object.defineProperty(RP, 'selectedMoveId', {
  get: function() {
    var route = RP.getActiveRoute ? RP.getActiveRoute() : null;
    if (!route || RP.selectedActionId == null) return null;
    var act = RP.findAction(route, RP.selectedActionId);
    return RP.isMoveAction(act) ? act.id : null;
  },
  set: function(v) { RP.selectedActionId = v; },
  configurable: true
});

RP.getSelectedAction = function() {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedActionId == null) return null;
  return RP.findAction(route, RP.selectedActionId);
};

// ---- mode switching --------------------------------------------------
// Switch which sketch document is being drawn on. The UI-level wrapper
// around RP.setActiveDoc: it also drops any in-flight drawing (a line
// half-drawn on the mat must not finish itself on the robot) and resets
// the view, since the two documents are in unrelated coordinate spaces
// and the mat's pan/zoom means nothing over a 200px robot.
RP.switchDoc = function(id) {
  if (id !== RP.DOC_ROBOT) id = RP.DOC_MAT;
  if (id === RP.activeDocId) return false;

  // Routes reference mat entity ids, so Route mode is only coherent over
  // the mat. Editing the robot is a Sketch-mode activity.
  if (id === RP.DOC_ROBOT && RP.editMode === 'route') RP.setEditMode('sketch');

  RP.lineDrawing = false;
  RP.lineDrawStart = null;
  RP.sketchDrag = null;
  RP.elementDrag = null;
  RP.hoverSnapPoint = null;

  RP._docViews = RP._docViews || {};
  RP._docViews[RP.activeDocId] = { scale: RP.scale, offsetX: RP.offsetX, offsetY: RP.offsetY };
  RP.setActiveDoc(id);
  var v = RP._docViews[id];
  if (v) { RP.scale = v.scale; RP.offsetX = v.offsetX; RP.offsetY = v.offsetY; }
  else if (RP.resetView) RP.resetView();

  // Leaving the robot means its extents may have changed, and wall_align
  // stands off by exactly those — so the mat's constraints have to catch up.
  if (id === RP.DOC_MAT && RP.syncAllWallAligns) RP.syncAllWallAligns();

  RP.updateDocUI();
  RP.updateModeUI();
  if (RP.updateLayerList) RP.updateLayerList();
  if (RP.refreshSketchUI) RP.refreshSketchUI();
  if (RP.updateInfoPanel) RP.updateInfoPanel();
  if (RP.render) RP.render();
  return true;
};

RP.updateDocUI = function() {
  var btns = document.querySelectorAll('[data-doc]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].dataset.doc === RP.activeDocId);
  }
  var hint = document.getElementById('doc-hint');
  if (hint) {
    hint.textContent = RP.activeDocId === RP.DOC_ROBOT
      ? 'Robot body. Right-click a line to set the drive axis (its start is the turning centre, and it points forwards).'
      : 'Field geometry, routes and obstacles';
  }
  // Route mode is meaningless over the robot document — see switchDoc.
  var br = document.getElementById('btn-mode-route');
  if (br) br.disabled = (RP.activeDocId === RP.DOC_ROBOT);
};

RP.setEditMode = function(mode) {
  if (mode !== 'route') mode = 'sketch';
  if (RP.editMode === mode) return;
  // Route mode only makes sense over the mat, which owns the geometry
  // routes point at.
  if (mode === 'route' && RP.activeDocId !== RP.DOC_MAT) RP.switchDoc(RP.DOC_MAT);

  if (mode === 'route') {
    RP._lastSketchTool = RP.activeTool || 'construction';
    if (RP.clearSketchSelection) RP.clearSketchSelection();
    RP.sketchDrag = null;
    RP.elementDrag = null;
    RP.lineDrawing = false;
    RP.lineDrawStart = null;
    RP.hoverSnapPoint = null;
  } else {
    RP.selectedMoveId = null;
  }
  RP.editMode = mode;

  if (mode === 'sketch' && RP.setTool) RP.setTool(RP._lastSketchTool);
  RP.updateModeUI();
  RP.refreshRouteUI();
};

RP.updateModeUI = function() {
  var sketchOn = RP.editMode === 'sketch';
  var bs = document.getElementById('btn-mode-sketch');
  var br = document.getElementById('btn-mode-route');
  if (bs) bs.classList.toggle('active', sketchOn);
  if (br) br.classList.toggle('active', !sketchOn);

  var show = function(id, on) {
    var el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  };
  show('doc-section', sketchOn);
  show('tool-section', sketchOn);
  show('field-section', sketchOn);
  show('snap-section', sketchOn);
  show('sim-section', !sketchOn);                 // collision warnings, right
  show('route-mode-section', !sketchOn);          // action list, left
  show('action-params-section', !sketchOn);      // action detail, right

  // Bottom panels follow the mode, except the geometry list, which is
  // wanted in both: in Route mode it is how you hide lines that overlap
  // the one you are trying to click, and how you find a line you cannot
  // see. Constraints stay a Sketch-mode concern.
  show('panel-geometry', true);
  show('panel-constraints', sketchOn);
  show('instr-panel', !sketchOn && RP.instructionsVisible !== false);
  var instrBtn = document.getElementById('btn-instr-toggle');
  if (instrBtn) instrBtn.style.display = sketchOn ? 'none' : '';
  if (!sketchOn) {
    var cs = document.getElementById('constraint-section');
    if (cs) cs.style.display = 'none';
    var cd = document.getElementById('constraint-detail-section');
    if (cd) cd.style.display = 'none';
    var gd = document.getElementById('geometry-detail-section');
    if (gd) gd.style.display = 'none';
  } else {
    if (RP.updateConstraintDetail) RP.updateConstraintDetail();
    if (RP.updateGeometryDetail) RP.updateGeometryDetail();
  }
  var hint = document.getElementById('sidebar-tool-hint');
  if (hint && !sketchOn) hint.textContent = '';
};

RP.refreshRouteUI = function() {
  if (RP.rebuildRouteViews) RP.rebuildRouteViews();
  RP.updateRouteModePanel();
  // The sweep is recomputed HERE, on edits, and never in render() — which
  // runs on every hover and pan. ~20ms on a 100-action route.
  if (RP.runSim) { RP.runSim(); RP.updateSimPanel(); }
  // The geometry list is visible in Route mode, so it has to be kept
  // current here as well — otherwise it shows whatever existed when the
  // mode was last entered.
  if (RP.updateLayerList) RP.updateLayerList();
  if (RP.updateInfoPanel) RP.updateInfoPanel();
  if (RP.updateInstructions) RP.updateInstructions();
  if (RP.render) RP.render();
};

// ---- selection / hit testing ----------------------------------------
// Entities referenced by any route, so rendering can avoid drawing the
// same line twice and so route mode can tell "already used" from "free".
RP.routeReferencedEntities = function() {
  var set = {};
  for (var i = 0; i < RP.routes.length; i++) {
    var moves = RP.moveActions(RP.routes[i]);
    for (var j = 0; j < moves.length; j++) {
      // A hidden move frees its entity to render as a construction-line
      // guide again — that is the whole point of hiding it: getting the
      // thick route line out of the way of whatever is underneath.
      if (moves[j].visible === false) continue;
      set[moves[j].entityId] = true;
    }
  }
  return set;
};

// Turn and checkpoint markers sit on points, so they need a radius rather
// than a distance-to-curve. Bigger than the drawn glyph, as ever.
RP.ACTION_POINT_HIT_PX = 13;

RP.routeHitTest = function(ix, iy) {
  var sk = RP.sketch;
  if (!sk) return null;
  var threshSq = Math.pow(RP.snapThresholdImg(8), 2);
  var route = RP.getActiveRoute();

  // Actions anchored to a point win over the geometry they sit on: they
  // are small targets, and the line underneath is always reachable a few
  // pixels away. Several actions can share one junction — a typed turn,
  // the geometric turn and a checkpoint all happen at the same corner —
  // so clicking again advances through them rather than sticking.
  if (route) {
    var ptThresh = RP.snapThresholdImg(RP.ACTION_POINT_HIT_PX);
    var acts = RP.routeActions(route);
    var best = null, bestD = Infinity;
    for (var p = 0; p < acts.length; p++) {
      var act = acts[p];
      if (RP.isMoveAction(act) || act.pointId == null) continue;
      var pt = sk.entities[act.pointId];
      if (!pt) continue;
      var d = RP.dist(ix, iy, pt.x, pt.y);
      if (d < ptThresh && d < bestD) { best = act; bestD = d; }
    }
    if (best) {
      var atPoint = RP.actionsAtPoint(route, best.pointId);
      var cur = atPoint.map(function(a) { return a.id; }).indexOf(RP.selectedActionId);
      var pick = cur >= 0 ? atPoint[(cur + 1) % atPoint.length] : best;
      return { kind: 'action', id: pick.id, actionType: pick.type };
    }
  }

  // Moves of the active route win — they are what you edit here.
  // Measured against the actual geometry, so an arc move is clickable
  // along its curve rather than only near its chord. Nearest wins, same
  // reasoning as construction geometry: two moves running close together
  // are exactly the case this needs to get right. A hidden move has no
  // presence to click, matching hidden construction geometry.
  if (route) {
    var moves = RP.moveActions(route);
    var bestMove = null, bestMoveSq = threshSq;
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].visible === false) continue;
      var mDSq = RP.entityDistSq(sk, moves[i].entityId, ix, iy);
      if (mDSq < bestMoveSq) { bestMoveSq = mDSq; bestMove = moves[i]; }
    }
    if (bestMove) return { kind: 'move', id: bestMove.id, entityId: bestMove.entityId };
  }
  // Nearest wins rather than first-in-entity-order. Where two lines
  // overlap, "first" is arbitrary and picks the wrong one half the time,
  // which is precisely the situation hiding exists to help with.
  var bestGeo = null, bestGeoSq = threshSq;
  for (var j = 0; j < RP.lines.length; j++) {
    var l = RP.lines[j];
    if (l.visible === false) continue;
    var dSqL = RP.pointToSegDistSq(ix, iy, l.x1, l.y1, l.x2, l.y2);
    if (dSqL < bestGeoSq) { bestGeoSq = dSqL; bestGeo = l.id; }
  }
  for (var k = 0; k < RP.arcs.length; k++) {
    var arc = RP.arcs[k];
    if (arc.visible === false) continue;
    var dSqA = RP.arcHitDistSq(arc.id, ix, iy);
    if (dSqA < bestGeoSq) { bestGeoSq = dSqA; bestGeo = arc.id; }
  }
  return bestGeo === null ? null : { kind: 'geometry', id: bestGeo };
};

RP.getSelectedMove = function() {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedMoveId == null) return null;
  return RP.findMove(route, RP.selectedMoveId);
};

// ---- adding geometry to the route ------------------------------------
// Pick the traversal direction that joins the previous move's exit, so
// appending geometry usually just works.
RP.bestFlipFor = function(route, entityId) {
  var sk = RP.sketch;
  var ent = sk.entities[entityId];
  var moves = RP.moveActions(route);
  if (!ent || moves.length === 0) return false;
  var last = moves[moves.length - 1];
  var lastEnds = RP.moveEndpoints(sk, last);
  if (!lastEnds) return false;
  var find = RP.Sketch.coincidenceClusters(sk);
  var exitKey = find(lastEnds.exit);
  if (find(ent.p1) === exitKey) return false;
  if (find(ent.p2) === exitKey) return true;
  return false;
};

RP.appendGeometryToRoute = function(entityId) {
  var route = RP.getActiveRoute();
  if (!route) return null;
  RP.pushHistory('Add move');
  // No explicit move: addMove picks one the geometry can actually
  // do (an arc entity must be driven as an arc).
  var el = RP.addMove(route.id, entityId, {
    flip: RP.bestFlipFor(route, entityId)
  });
  if (!el) { RP.undoStack.pop(); return null; }
  RP.recomputeFlips(route);
  return el;
};

RP.removeSelectedMove = function() {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedMoveId == null) return false;
  RP.pushHistory('Remove move');
  RP.removeMove(route.id, RP.selectedMoveId);
  RP.selectedMoveId = null;
  RP.recomputeFlips(route);
  RP.refreshRouteUI();
  return true;
};

RP.reorderSelectedMove = function(delta) {
  var route = RP.getActiveRoute();
  var el = RP.getSelectedMove();
  if (!route || !el) return false;
  var moves = RP.moveActions(route);
  var next = moves.indexOf(el) + delta;
  if (next < 0 || next >= moves.length) return false;
  RP.pushHistory('Reorder move');
  RP.reorderMove(route.id, el.id, next);
  // Reordering changes which end each move must enter from; without
  // this the route silently broke at the junction.
  RP.recomputeFlips(route);
  RP.refreshRouteUI();
  return true;
};

RP.reverseRoute = function() {
  var route = RP.getActiveRoute();
  if (!route || RP.moveActions(route).length === 0) return false;
  RP.pushHistory('Reverse route');
  RP.reverseRouteDirection(route);
  RP.refreshRouteUI();
  return true;
};

// ---- UI-level action operations (these push history) -----------------
RP.updateSelectedAction = function(props) {
  var route = RP.getActiveRoute();
  var act = RP.getSelectedAction();
  if (!route || !act) return false;
  if (RP.isMoveAction(act)) return RP.updateSelectedMove(props);
  RP.pushHistory('Edit ' + act.type);
  RP.setActionProps(route.id, act.id, props);
  RP.refreshRouteUI();
  return true;
};

RP.removeSelectedAction = function() {
  var route = RP.getActiveRoute();
  var act = RP.getSelectedAction();
  if (!route || !act) return false;
  if (RP.isMoveAction(act)) return RP.removeSelectedMove();
  RP.pushHistory('Remove ' + act.type);
  if (!RP.removeAction(route.id, act.id)) { RP.undoStack.pop(); return false; }
  RP.selectedActionId = null;
  RP.refreshRouteUI();
  return true;
};

// Insert in front of the current selection, or at the end when nothing is
// selected — the same "where the cursor is" rule the action list follows.
RP.addTurnHere = function() {
  var route = RP.getActiveRoute();
  if (!route) return null;
  RP.pushHistory('Add turn');
  var turn = RP.insertFixedTurn(route.id, RP.selectedActionId, { angle: 90 });
  if (!turn) { RP.undoStack.pop(); return null; }
  RP.selectedActionId = turn.id;
  RP.refreshRouteUI();
  return turn;
};

RP.addCheckpointHere = function() {
  var route = RP.getActiveRoute();
  if (!route) return null;
  RP.pushHistory('Add checkpoint');
  var cp = RP.insertCheckpoint(route.id, RP.selectedActionId, 'checkpoint');
  if (!cp) { RP.undoStack.pop(); return null; }
  RP.selectedActionId = cp.id;
  RP.refreshRouteUI();
  return cp;
};

// What each action actually emitted, keyed by action id. computeSteps
// tags every step it produces, so this is a lookup rather than a second,
// drift-prone walk of the same logic.
//
// A turn missing from the map emitted nothing: below the 0.5° threshold,
// or a heading the planner cannot know (arriving from a teleport).
RP.emittedStepsByAction = function(route) {
  var map = {};
  var steps = RP.computeSteps(route) || [];
  for (var i = 0; i < steps.length; i++) {
    var id = steps[i].actionId;
    if (id == null) continue;
    (map[id] = map[id] || []).push(steps[i]);
  }
  return map;
};

RP.turnAngleFor = function(emitted, turnAction) {
  var list = emitted[turnAction.id] || [];
  for (var i = 0; i < list.length; i++) {
    // The start-leg turn shares the leading turn's action; the junction
    // turn is the one that describes the corner.
    if (list[i].kind === 'turn' && !list[i].startLeg) return list[i].deg;
  }
  return null;
};

RP.updateSelectedMove = function(props) {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedMoveId == null) return false;
  RP.pushHistory('Edit move');
  // A checkpoint is its own action now; the move panel still offers it as
  // a field, so route that one key through the action call.
  if (Object.prototype.hasOwnProperty.call(props, 'checkpoint')) {
    RP.setMoveCheckpoint(route.id, RP.selectedMoveId, props.checkpoint);
    props = Object.assign({}, props);
    delete props.checkpoint;
  }
  RP.setMoveProps(route.id, RP.selectedMoveId, props);
  // Becoming (or ceasing to be) a wall align changes the constraints, and
  // driving backwards swaps front clearance for rear.
  if (props.move !== undefined || props.reverse !== undefined) {
    var el = RP.getSelectedMove();
    if (el) {
      RP.syncWallAlignConstraint(route, el);
      RP.solveSketch();
    }
  }
  RP.refreshRouteUI();
  return true;
};

// ---- panels ----------------------------------------------------------
RP.updateRouteModePanel = function() {
  var section = document.getElementById('route-mode-section');
  if (!section || RP.editMode !== 'route') return;

  var route = RP.getActiveRoute();
  var statusEl = document.getElementById('route-mode-status');
  if (statusEl) {
    if (!route) {
      statusEl.textContent = 'No route selected';
      statusEl.style.color = '#888';
    } else {
      var res = RP.resolveRoute(route);
      if (res.ok) {
        statusEl.textContent = res.moves.length + ' move' +
          (res.moves.length === 1 ? '' : 's') + ' · connected';
        statusEl.style.color = '#66ccff';
      } else if (res.code === 'EMPTY') {
        statusEl.textContent = 'Empty — click geometry to add a move';
        statusEl.style.color = '#888';
      } else {
        statusEl.textContent = res.message;
        statusEl.style.color = '#ff4444';
      }
    }
  }
  RP.updateActionList();
  RP.updateActionParams();
};

RP.TURN_GLYPH = function(deg) {
  if (deg == null) return '↻';
  return deg >= 0 ? '↻' : '↺';     // clockwise / anticlockwise
};

// One row per ACTION, in walk order. Turns and checkpoints are indented
// under the move they lead into, so the list reads like the program.
RP.updateActionList = function() {
  var list = document.getElementById('action-list');
  if (!list) return;
  // Rebuilding drops the row the cursor was over without firing its
  // mouseleave, so the preview has to be dropped with it or it sticks.
  RP.hoverActionId = null;
  list.innerHTML = '';
  var route = RP.getActiveRoute();
  var acts = (route && route.actions) || [];
  if (acts.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'sidebar-hint';
    empty.textContent = 'No actions yet — click geometry to add a move';
    list.appendChild(empty);
    return;
  }

  var emitted = RP.emittedStepsByAction(route);
  var moveNo = 0;

  for (var i = 0; i < acts.length; i++) {
    (function(act) {
      var isMove = RP.isMoveAction(act);
      if (isMove) moveNo++;

      // A junction turn that emits nothing and carries no settings is
      // noise in the list — a straight joint, or the leading turn with no
      // start position. It stays clickable on the canvas, and reappears
      // here the moment it matters or is selected.
      if (RP.isTurnAction(act) && act.angleMode === RP.TURN_AUTO &&
          RP.selectedActionId !== act.id &&
          act.angle == null && act.speed == null &&
          (!act.style || act.style === RP.DEFAULT_TURN_STYLE) &&
          RP.turnAngleFor(emitted, act) == null) {
        return;
      }

      var row = document.createElement('div');
      row.className = (isMove ? 'layer-item' : 'action-sub') +
                      (RP.selectedActionId === act.id ? ' active' : '');

      var glyph = document.createElement('span');
      glyph.className = 'constraint-glyph';

      var lbl = document.createElement('span');
      lbl.className = 'layer-item-label';

      if (isMove) {
        glyph.textContent = String(moveNo);
        var bits = [RP.MOVE_LABELS[act.move] || act.move];
        if (act.reverse) bits.push('rev');
        if (act.speed != null) bits.push(act.speed);
        if (act.visible === false) bits.push('hidden');
        lbl.textContent = bits.join(' · ');
        if (act.visible === false) lbl.style.color = '#777';
      } else if (RP.isTurnAction(act)) {
        var deg = RP.turnAngleFor(emitted, act);
        // "Typed" means the angle was typed, not that the action is a
        // standalone turn — an overridden junction turn is typed too, and
        // the canvas already marks it with an asterisk.
        var isTyped = act.angle != null;
        glyph.textContent = RP.TURN_GLYPH(deg);
        glyph.style.color = isTyped ? '#ff9944' : '#66ccff';
        if (deg == null) {
          // Not a failure: a straight junction needs no turn, and a
          // heading after a teleport is unknowable.
          lbl.textContent = 'no turn';
          lbl.style.color = '#666';
        } else {
          var parts = [RP.formatDeg(deg) + '°'];
          if (isTyped) parts.push('typed');
          if (act.speed != null) parts.push('spd ' + act.speed);
          if (act.style && act.style !== RP.DEFAULT_TURN_STYLE) parts.push(act.style.replace('_', ' '));
          lbl.textContent = parts.join(' · ');
        }
      } else {
        glyph.textContent = '🏁';
        lbl.textContent = act.name || 'checkpoint';
        lbl.style.color = '#ff99ff';
      }
      lbl.title = lbl.textContent;
      lbl.onclick = function() {
        RP.selectedActionId = act.id;
        RP.refreshRouteUI();
      };
      // Hover previews what a click would pick. Canvas only — re-rendering
      // the list here would destroy the row the cursor is on.
      row.onmouseenter = function() { RP.hoverActionId = act.id; RP.render(); };
      row.onmouseleave = function() {
        if (RP.hoverActionId === act.id) { RP.hoverActionId = null; RP.render(); }
      };

      row.appendChild(glyph);

      // A move's own rendering can be hidden — independent of whether the
      // CONSTRUCTION line underneath is hidden — so two overlapping route
      // moves (or a move and a not-yet-added line) can be told apart the
      // same way overlapping construction lines already can.
      if (isMove) {
        var eye = document.createElement('button');
        eye.className = 'layer-vis-btn';
        eye.textContent = act.visible === false ? '○' : '●';
        eye.title = act.visible === false ? 'Show this move\u2019s line' : 'Hide this move\u2019s line';
        eye.onclick = function(e) {
          e.stopPropagation();
          RP.pushHistory(act.visible === false ? 'Show move' : 'Hide move');
          RP.setMoveProps(route.id, act.id, { visible: act.visible === false });
          RP.refreshRouteUI();
        };
        row.appendChild(eye);
      }

      row.appendChild(lbl);

      // Auto turns belong to their move and cannot be deleted on their own.
      var deletable = !(RP.isTurnAction(act) && act.angleMode === RP.TURN_AUTO);
      if (deletable) {
        var del = document.createElement('button');
        del.className = 'layer-del-btn';
        del.textContent = '✕';
        del.title = isMove ? 'Remove from route (geometry is kept)' : 'Remove this action';
        del.onclick = function(e) {
          e.stopPropagation();
          RP.selectedActionId = act.id;
          RP.removeSelectedAction();
        };
        row.appendChild(del);
      }
      list.appendChild(row);
    })(acts[i]);
  }
};

var INPUT_CSS = 'width:70px;background:#3a3a3a;border:1px solid #555;color:#ddd;' +
                'padding:2px 4px;border-radius:3px;font-size:11px;text-align:right';
// Dropdowns hold words, not numbers, so they need more room than the
// number fields — at 70px "Pivot left" rendered as "Pivot on ⌄".
var SELECT_CSS = 'width:112px;background:#3a3a3a;border:1px solid #555;color:#ddd;' +
                 'padding:2px 4px;border-radius:3px;font-size:11px';

function elpOn(id, evt, fn) {
  var node = document.getElementById(id);
  if (node) node.addEventListener(evt, fn);
}

RP.updateActionParams = function() {
  var host = document.getElementById('action-params');
  var title = document.getElementById('action-params-title');
  if (!host) return;
  var act = RP.getSelectedAction();
  if (!act) {
    if (title) title.textContent = 'Selected Action';
    host.innerHTML = '<div class="sidebar-hint">Select an action to edit it' +
                     '<br>Click a line for a move, a corner for its turn</div>';
    return;
  }
  if (RP.isTurnAction(act)) {
    if (title) title.textContent = 'Selected Turn';
    return RP.renderTurnParams(host, act);
  }
  if (RP.isCheckpointAction(act)) {
    if (title) title.textContent = 'Selected Checkpoint';
    return RP.renderCheckpointParams(host, act);
  }
  if (title) title.textContent = 'Selected Move';
  return RP.renderMoveParams(host, act);
};

// ---- turn panel ------------------------------------------------------
RP.renderTurnParams = function(host, act) {
  var route = RP.getActiveRoute();
  var emitted = RP.emittedStepsByAction(route);
  var deg = RP.turnAngleFor(emitted, act);
  var isAuto = act.angleMode === RP.TURN_AUTO;

  var derived = act.angle == null;

  var html = '<div class="ap-readout">';
  if (deg == null) {
    html += isAuto
      ? 'No turn here — the legs are in line, or the heading is unknown after a teleport.'
      : 'A turn of 0° emits nothing.';
  } else {
    html += '<b>' + RP.formatDeg(deg) + '°</b> ' + (deg >= 0 ? 'clockwise' : 'anticlockwise');
    html += '<br><span style="color:#888">' +
            (derived ? 'derived from the geometry either side' : 'typed, overriding the geometry') +
            '</span>';
  }
  html += '</div>';

  // Only a junction turn has geometry to fall back to, so only it gets
  // the choice. A standalone turn is always a typed angle.
  if (isAuto) {
    html += '<label class="ap-row"><span>Angle</span><span class="seg-toggle">' +
            '<button type="button" id="ap-t-auto" class="seg-btn' + (derived ? ' active' : '') + '">Derived</button>' +
            '<button type="button" id="ap-t-fixed" class="seg-btn' + (!derived ? ' active' : '') + '">Typed</button>' +
            '</span></label>';
  }
  if (!derived || !isAuto) {
    html += '<label class="ap-row"><span>Degrees</span><input type="number" id="ap-t-angle" step="1" ' +
            'value="' + (act.angle != null ? act.angle : 0) + '" style="' + INPUT_CSS + '"></label>';
  }
  html += '<label class="ap-row"><span>Speed</span><input type="number" id="ap-t-speed" min="1" ' +
          'placeholder="default" value="' + (act.speed != null ? act.speed : '') + '" style="' + INPUT_CSS + '"></label>';

  html += '<label class="ap-row"><span>Style</span><select id="ap-t-style" style="' + SELECT_CSS + '">';
  for (var i = 0; i < RP.TURN_STYLES.length; i++) {
    var st = RP.TURN_STYLES[i];
    html += '<option value="' + st + '"' + ((act.style || RP.DEFAULT_TURN_STYLE) === st ? ' selected' : '') + '>' +
            RP.TURN_STYLE_LABELS[st] + '</option>';
  }
  html += '</select></label>';
  html += '<div class="sidebar-hint">Each style has its own code template ' +
          '(blank pivot templates fall back to the plain turn).</div>';

  html += '<label class="ap-row"><span>Extra args</span><input type="text" id="ap-t-extra" ' +
          'placeholder="e.g. , blocking=True" value="' + (act.extraArgs || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>';
  html += '<div class="sidebar-hint">Spliced verbatim into {extra_args} in this turn’s code template.</div>';

  if (!isAuto) {
    html += '<div style="display:flex;gap:3px;margin-top:6px">' +
            '<button id="ap-t-del" class="sidebar-small-btn">🗑 Remove turn</button></div>';
  }
  host.innerHTML = html;

  elpOn('ap-t-auto', 'click', function() {
    RP.updateSelectedAction({ angle: null });
  });
  elpOn('ap-t-fixed', 'click', function() {
    // Seed with what the geometry was already producing, so switching to
    // Typed does not jump the robot.
    // Seeded at FULL precision. Rounding here to 1dp was the other half of
    // the same bug: switching a 89.5312° junction to Typed stored 89.5 and
    // threw the remainder away before the user had changed anything.
    RP.updateSelectedAction({ angle: deg != null ? deg : 0 });
  });
  elpOn('ap-t-angle', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedAction({ angle: isFinite(v) ? v : 0 });
  });
  elpOn('ap-t-speed', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedAction({ speed: isFinite(v) && v > 0 ? v : null });
  });
  elpOn('ap-t-style', 'change', function() {
    RP.updateSelectedAction({ style: this.value });
  });
  elpOn('ap-t-extra', 'change', function() {
    RP.updateSelectedAction({ extraArgs: this.value });
  });
  elpOn('ap-t-del', 'click', function() { RP.removeSelectedAction(); });
};

// ---- checkpoint panel ------------------------------------------------
RP.renderCheckpointParams = function(host, act) {
  host.innerHTML =
    '<label class="ap-row"><span>Name</span><input type="text" id="ap-c-name" ' +
    'value="' + (act.name || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>' +
    '<div class="sidebar-hint">Emitted where it sits in the list, using the ' +
    'checkpoint template.</div>' +
    '<label class="ap-row"><span>Extra args</span><input type="text" id="ap-c-extra" ' +
    'placeholder="e.g. reason=\'junction\'" value="' + (act.extraArgs || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>' +
    '<div class="sidebar-hint">Spliced verbatim into {extra_args} in the checkpoint template.</div>' +
    '<div style="display:flex;gap:3px;margin-top:6px">' +
    '<button id="ap-c-del" class="sidebar-small-btn">🗑 Remove</button></div>';
  elpOn('ap-c-name', 'change', function() {
    RP.updateSelectedAction({ name: this.value || 'checkpoint' });
  });
  elpOn('ap-c-extra', 'change', function() {
    RP.updateSelectedAction({ extraArgs: this.value });
  });
  elpOn('ap-c-del', 'click', function() { RP.removeSelectedAction(); });
};

// ---- move panel ------------------------------------------------------
RP.renderMoveParams = function(host, el) {
  var route = RP.getActiveRoute();
  var sk = RP.sketch;
  var ent = sk ? sk.entities[el.entityId] : null;
  var moves = RP.movesForEntity(ent ? ent.type : 'line');

  var html = '<label class="ap-row"><span>Move</span><select id="ap-move" style="' + SELECT_CSS + '">';
  for (var i = 0; i < moves.length; i++) {
    html += '<option value="' + moves[i] + '"' + (el.move === moves[i] ? ' selected' : '') + '>' +
            (RP.MOVE_LABELS[moves[i]] || moves[i]) + '</option>';
  }
  html += '</select></label>';

  // Travel direction is derived from the chain, so it is not offered here.
  // The only direction choice that is genuinely the user's is whether the
  // robot covers this move nose-first or tail-first. Two states, so one
  // toggle — and it is tinted to match the segment's colour on the canvas.
  html += '<label class="ap-row"><span>Drive</span>' +
          '<button type="button" id="ap-drive" class="drive-toggle' + (el.reverse ? ' rev' : '') + '" ' +
          'title="Click to drive the other way along this leg">' +
          (el.reverse ? '◀ Backwards' : '▶ Forwards') + '</button></label>';
  // Independent of the construction line's own show/hide — this is
  // whether the ROUTE draws its use of it, for getting an overlapping
  // move out of the way on canvas without touching the geometry itself.
  html += '<label class="ap-row"><span>On canvas</span>' +
          '<button type="button" id="ap-visible" class="drive-toggle' + (el.visible === false ? ' rev' : '') + '" ' +
          'title="Click to hide/show this move\u2019s line on the canvas">' +
          (el.visible === false ? '🙈 Hidden' : '👁 Shown') + '</button></label>';
  html += '<label class="ap-row"><span>Speed</span><input type="number" id="ap-speed" min="1" ' +
          'placeholder="default" value="' + (el.speed != null ? el.speed : '') + '" style="' + INPUT_CSS + '"></label>';

  if (el.move === 'forward' || el.move === 'linetrace_dist') {
    html += '<label class="ap-row"><span>Offset (mm)</span><input type="number" id="ap-offset" ' +
            'value="' + (el.offset || 0) + '" style="' + INPUT_CSS + '"></label>';
  }
  if (el.move === 'linetrace_junct') {
    html += '<label class="ap-row"><span>Junctions</span><input type="number" id="ap-junctions" min="1" ' +
            'value="' + (el.junctions || 1) + '" style="' + INPUT_CSS + '"></label>';
  }
  if (el.move === 'teleport') {
    html += '<label class="ap-row"><span>Name</span><input type="text" id="ap-teleport" ' +
            'value="' + (el.teleportName || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>';
  }
  var cpAct = RP.checkpointAfterMove(route, el.id);
  html += '<label class="ap-row"><span>Checkpoint</span><input type="text" id="ap-checkpoint" ' +
          'placeholder="none" value="' + (cpAct ? cpAct.name : '') + '" style="' + INPUT_CSS + ';text-align:left"></label>';
  html += '<label class="ap-row"><span>Extra args</span><input type="text" id="ap-extra" ' +
          'placeholder="e.g. , blocking=True" value="' + (el.extraArgs || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>';
  html += '<div class="sidebar-hint">Spliced verbatim into {extra_args} in this move’s code template.</div>';
  html += '<div style="display:flex;gap:3px;margin-top:6px">' +
          '<button id="ap-up" class="sidebar-small-btn">↑</button>' +
          '<button id="ap-down" class="sidebar-small-btn">↓</button>' +
          '<button id="ap-del" class="sidebar-small-btn">🗑 Remove</button></div>';
  host.innerHTML = html;

  elpOn('ap-move', 'change', function() { RP.updateSelectedMove({ move: this.value }); });
  elpOn('ap-drive', 'click', function() { RP.updateSelectedMove({ reverse: !el.reverse }); });
  elpOn('ap-visible', 'click', function() {
    RP.updateSelectedMove({ visible: el.visible === false });
  });
  elpOn('ap-speed', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedMove({ speed: isFinite(v) && v > 0 ? v : null });
  });
  elpOn('ap-offset', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedMove({ offset: isFinite(v) ? v : 0 });
  });
  elpOn('ap-junctions', 'change', function() {
    var v = parseInt(this.value, 10);
    RP.updateSelectedMove({ junctions: isFinite(v) && v > 0 ? v : 1 });
  });
  elpOn('ap-teleport', 'change', function() {
    RP.updateSelectedMove({ teleportName: this.value || null });
  });
  elpOn('ap-checkpoint', 'change', function() {
    RP.updateSelectedMove({ checkpoint: this.value || null });
  });
  elpOn('ap-extra', 'change', function() {
    RP.updateSelectedMove({ extraArgs: this.value });
  });
  elpOn('ap-up', 'click', function() { RP.reorderSelectedMove(-1); });
  elpOn('ap-down', 'click', function() { RP.reorderSelectedMove(1); });
  elpOn('ap-del', 'click', function() { RP.removeSelectedMove(); });
};

RP.wireModeSwitch = function() {
  var bs = document.getElementById('btn-mode-sketch');
  var br = document.getElementById('btn-mode-route');
  if (bs) bs.addEventListener('click', function() { RP.setEditMode('sketch'); });
  if (br) br.addEventListener('click', function() { RP.setEditMode('route'); });
  var rev = document.getElementById('btn-reverse-route');
  if (rev) rev.addEventListener('click', function() { RP.reverseRoute(); });
  var addTurn = document.getElementById('btn-add-turn');
  if (addTurn) addTurn.addEventListener('click', function() { RP.addTurnHere(); });
  var addCp = document.getElementById('btn-add-checkpoint');
  if (addCp) addCp.addEventListener('click', function() { RP.addCheckpointHere(); });
  RP.updateModeUI();
  RP.updateRouteModePanel();
};
