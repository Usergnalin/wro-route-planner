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

// The selection is an ACTION of any type. `selectedElementId` survives as
// an accessor because render, the resolver-facing panel and the tests all
// speak "element": it reads through only when the selection really is a
// move, so selecting a turn correctly un-highlights every segment.
RP.selectedActionId = null;
Object.defineProperty(RP, 'selectedElementId', {
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
RP.setEditMode = function(mode) {
  if (mode !== 'route') mode = 'sketch';
  if (RP.editMode === mode) return;

  if (mode === 'route') {
    RP._lastSketchTool = RP.activeTool || 'construction';
    if (RP.clearSketchSelection) RP.clearSketchSelection();
    RP.sketchDrag = null;
    RP.elementDrag = null;
    RP.lineDrawing = false;
    RP.lineDrawStart = null;
    RP.hoverSnapPoint = null;
  } else {
    RP.selectedElementId = null;
  }
  RP._forceMapPanel = false;
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
  show('tool-section', sketchOn);
  show('field-section', sketchOn);
  show('snap-section', sketchOn);
  show('route-mode-section', !sketchOn);          // element list, left
  show('element-params-section', !sketchOn);      // element detail, right

  // Bottom panels follow the mode: sketch gets the geometry and constraint
  // lists, route gets the generated code. Nothing about routes clutters
  // Sketch mode.
  show('panel-geometry', sketchOn);
  show('panel-constraints', sketchOn);
  show('instr-panel', !sketchOn && RP.instructionsVisible !== false);
  // Saved Maps is project management rather than route data, but it is
  // noise while sketching — hidden unless Load Map explicitly asks for it.
  show('panel-maps', !sketchOn || !!RP._forceMapPanel);
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
    var els = RP.routes[i].elements || [];
    for (var j = 0; j < els.length; j++) set[els[j].entityId] = true;
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

  // Elements of the active route win — they are what you edit here.
  // Measured against the actual geometry, so an arc element is clickable
  // along its curve rather than only near its chord.
  if (route && route.elements) {
    for (var i = route.elements.length - 1; i >= 0; i--) {
      var el = route.elements[i];
      if (RP.entityDistSq(sk, el.entityId, ix, iy) < threshSq) {
        return { kind: 'element', id: el.id, entityId: el.entityId };
      }
    }
  }
  for (var j = 0; j < RP.lines.length; j++) {
    var l = RP.lines[j];
    if (l.visible === false) continue;
    if (RP.pointToSegDistSq(ix, iy, l.x1, l.y1, l.x2, l.y2) < threshSq) {
      return { kind: 'geometry', id: l.id };
    }
  }
  // Arcs live in their own view, and were being missed entirely here.
  for (var k = 0; k < RP.arcs.length; k++) {
    var arc = RP.arcs[k];
    if (arc.visible === false) continue;
    if (RP.arcHitDistSq(arc.id, ix, iy) < threshSq) {
      return { kind: 'geometry', id: arc.id };
    }
  }
  return null;
};

RP.getSelectedElement = function() {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedElementId == null) return null;
  return RP.findElement(route, RP.selectedElementId);
};

// ---- adding geometry to the route ------------------------------------
// Pick the traversal direction that joins the previous element's exit, so
// appending geometry usually just works.
RP.bestFlipFor = function(route, entityId) {
  var sk = RP.sketch;
  var ent = sk.entities[entityId];
  if (!ent || !route.elements || route.elements.length === 0) return false;
  var last = route.elements[route.elements.length - 1];
  var lastEnds = RP.elementEndpoints(sk, last);
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
  RP.pushHistory('Add route element');
  // No explicit move: addRouteElement picks one the geometry can actually
  // do (an arc entity must be driven as an arc).
  var el = RP.addRouteElement(route.id, entityId, {
    flip: RP.bestFlipFor(route, entityId)
  });
  if (!el) { RP.undoStack.pop(); return null; }
  RP.recomputeFlips(route);
  return el;
};

RP.removeSelectedElement = function() {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedElementId == null) return false;
  RP.pushHistory('Remove route element');
  RP.removeRouteElement(route.id, RP.selectedElementId);
  RP.selectedElementId = null;
  RP.recomputeFlips(route);
  RP.refreshRouteUI();
  return true;
};

RP.reorderSelectedElement = function(delta) {
  var route = RP.getActiveRoute();
  var el = RP.getSelectedElement();
  if (!route || !el) return false;
  var idx = route.elements.indexOf(el);
  var next = idx + delta;
  if (next < 0 || next >= route.elements.length) return false;
  RP.pushHistory('Reorder route element');
  RP.moveRouteElement(route.id, el.id, next);
  // Reordering changes which end each element must enter from; without
  // this the route silently broke at the junction.
  RP.recomputeFlips(route);
  RP.refreshRouteUI();
  return true;
};

RP.reverseRoute = function() {
  var route = RP.getActiveRoute();
  if (!route || !route.elements || route.elements.length === 0) return false;
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
  if (RP.isMoveAction(act)) return RP.updateSelectedElement(props);
  RP.pushHistory('Edit ' + act.type);
  RP.setActionProps(route.id, act.id, props);
  RP.refreshRouteUI();
  return true;
};

RP.removeSelectedAction = function() {
  var route = RP.getActiveRoute();
  var act = RP.getSelectedAction();
  if (!route || !act) return false;
  if (RP.isMoveAction(act)) return RP.removeSelectedElement();
  RP.pushHistory('Remove ' + act.type);
  if (!RP.removeAction(route.id, act.id)) { RP.undoStack.pop(); return false; }
  RP.selectedActionId = null;
  RP.refreshRouteUI();
  return true;
};

// Insert in front of the current selection, or at the end when nothing is
// selected — the same "where the cursor is" rule the element list follows.
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

RP.updateSelectedElement = function(props) {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedElementId == null) return false;
  RP.pushHistory('Edit route element');
  // A checkpoint is its own action now; the move panel still offers it as
  // a field, so route that one key through the action call.
  if (Object.prototype.hasOwnProperty.call(props, 'checkpoint')) {
    RP.setMoveCheckpoint(route.id, RP.selectedElementId, props.checkpoint);
    props = Object.assign({}, props);
    delete props.checkpoint;
  }
  RP.setRouteElementProps(route.id, RP.selectedElementId, props);
  // Becoming (or ceasing to be) a wall align changes the constraints, and
  // driving backwards swaps front clearance for rear.
  if (props.move !== undefined || props.reverse !== undefined) {
    var el = RP.getSelectedElement();
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
        statusEl.textContent = res.elements.length + ' element' +
          (res.elements.length === 1 ? '' : 's') + ' · connected';
        statusEl.style.color = '#66ccff';
      } else if (res.code === 'EMPTY') {
        statusEl.textContent = 'Empty — click geometry to add it';
        statusEl.style.color = '#888';
      } else {
        statusEl.textContent = res.message;
        statusEl.style.color = '#ff4444';
      }
    }
  }
  RP.updateElementList();
  RP.updateElementParams();
};

RP.TURN_GLYPH = function(deg) {
  if (deg == null) return '↻';
  return deg >= 0 ? '↻' : '↺';     // clockwise / anticlockwise
};

// One row per ACTION, in walk order. Turns and checkpoints are indented
// under the move they lead into, so the list reads like the program.
RP.updateActionList = function() {
  var list = document.getElementById('element-list');
  if (!list) return;
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
        lbl.textContent = bits.join(' · ');
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
          var parts = [deg.toFixed(1) + '°'];
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

      row.appendChild(glyph);
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

// Kept as the old name so nothing outside this file has to care.
RP.updateElementList = function() { RP.updateActionList(); };

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

RP.updateElementParams = function() {
  var host = document.getElementById('element-params');
  var title = document.getElementById('element-params-title');
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

  var html = '<div class="elp-readout">';
  if (deg == null) {
    html += isAuto
      ? 'No turn here — the legs are in line, or the heading is unknown after a teleport.'
      : 'A turn of 0° emits nothing.';
  } else {
    html += '<b>' + deg.toFixed(1) + '°</b> ' + (deg >= 0 ? 'clockwise' : 'anticlockwise');
    html += '<br><span style="color:#888">' +
            (derived ? 'derived from the geometry either side' : 'typed, overriding the geometry') +
            '</span>';
  }
  html += '</div>';

  // Only a junction turn has geometry to fall back to, so only it gets
  // the choice. A standalone turn is always a typed angle.
  if (isAuto) {
    html += '<label class="elp"><span>Angle</span><span class="seg-toggle">' +
            '<button type="button" id="elp-t-auto" class="seg-btn' + (derived ? ' active' : '') + '">Derived</button>' +
            '<button type="button" id="elp-t-fixed" class="seg-btn' + (!derived ? ' active' : '') + '">Typed</button>' +
            '</span></label>';
  }
  if (!derived || !isAuto) {
    html += '<label class="elp"><span>Degrees</span><input type="number" id="elp-t-angle" step="1" ' +
            'value="' + (act.angle != null ? act.angle : 0) + '" style="' + INPUT_CSS + '"></label>';
  }
  html += '<label class="elp"><span>Speed</span><input type="number" id="elp-t-speed" min="1" ' +
          'placeholder="default" value="' + (act.speed != null ? act.speed : '') + '" style="' + INPUT_CSS + '"></label>';

  html += '<label class="elp"><span>Style</span><select id="elp-t-style" style="' + SELECT_CSS + '">';
  for (var i = 0; i < RP.TURN_STYLES.length; i++) {
    var st = RP.TURN_STYLES[i];
    html += '<option value="' + st + '"' + ((act.style || RP.DEFAULT_TURN_STYLE) === st ? ' selected' : '') + '>' +
            RP.TURN_STYLE_LABELS[st] + '</option>';
  }
  html += '</select></label>';
  html += '<div class="sidebar-hint">Each style has its own code template ' +
          '(blank pivot templates fall back to the plain turn).</div>';

  if (!isAuto) {
    html += '<div style="display:flex;gap:3px;margin-top:6px">' +
            '<button id="elp-t-del" class="sidebar-small-btn">🗑 Remove turn</button></div>';
  }
  host.innerHTML = html;

  elpOn('elp-t-auto', 'click', function() {
    RP.updateSelectedAction({ angle: null });
  });
  elpOn('elp-t-fixed', 'click', function() {
    // Seed with what the geometry was already producing, so switching to
    // Typed does not jump the robot.
    RP.updateSelectedAction({ angle: deg != null ? Number(deg.toFixed(1)) : 0 });
  });
  elpOn('elp-t-angle', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedAction({ angle: isFinite(v) ? v : 0 });
  });
  elpOn('elp-t-speed', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedAction({ speed: isFinite(v) && v > 0 ? v : null });
  });
  elpOn('elp-t-style', 'change', function() {
    RP.updateSelectedAction({ style: this.value });
  });
  elpOn('elp-t-del', 'click', function() { RP.removeSelectedAction(); });
};

// ---- checkpoint panel ------------------------------------------------
RP.renderCheckpointParams = function(host, act) {
  host.innerHTML =
    '<label class="elp"><span>Name</span><input type="text" id="elp-c-name" ' +
    'value="' + (act.name || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>' +
    '<div class="sidebar-hint">Emitted where it sits in the list, using the ' +
    'checkpoint template.</div>' +
    '<div style="display:flex;gap:3px;margin-top:6px">' +
    '<button id="elp-c-del" class="sidebar-small-btn">🗑 Remove</button></div>';
  elpOn('elp-c-name', 'change', function() {
    RP.updateSelectedAction({ name: this.value || 'checkpoint' });
  });
  elpOn('elp-c-del', 'click', function() { RP.removeSelectedAction(); });
};

// ---- move panel ------------------------------------------------------
RP.renderMoveParams = function(host, el) {
  var route = RP.getActiveRoute();
  var sk = RP.sketch;
  var ent = sk ? sk.entities[el.entityId] : null;
  var moves = RP.movesForEntity(ent ? ent.type : 'line');

  var html = '<label class="elp"><span>Move</span><select id="elp-move" style="' + SELECT_CSS + '">';
  for (var i = 0; i < moves.length; i++) {
    html += '<option value="' + moves[i] + '"' + (el.move === moves[i] ? ' selected' : '') + '>' +
            (RP.MOVE_LABELS[moves[i]] || moves[i]) + '</option>';
  }
  html += '</select></label>';

  // Travel direction is derived from the chain, so it is not offered here.
  // The only direction choice that is genuinely the user's is whether the
  // robot covers this element nose-first or tail-first. Two states, so one
  // toggle — and it is tinted to match the segment's colour on the canvas.
  html += '<label class="elp"><span>Drive</span>' +
          '<button type="button" id="elp-drive" class="drive-toggle' + (el.reverse ? ' rev' : '') + '" ' +
          'title="Click to drive the other way along this leg">' +
          (el.reverse ? '◀ Backwards' : '▶ Forwards') + '</button></label>';
  html += '<label class="elp"><span>Speed</span><input type="number" id="elp-speed" min="1" ' +
          'placeholder="default" value="' + (el.speed != null ? el.speed : '') + '" style="' + INPUT_CSS + '"></label>';

  if (el.move === 'forward' || el.move === 'linetrace_dist') {
    html += '<label class="elp"><span>Offset (mm)</span><input type="number" id="elp-offset" ' +
            'value="' + (el.offset || 0) + '" style="' + INPUT_CSS + '"></label>';
  }
  if (el.move === 'linetrace_junct') {
    html += '<label class="elp"><span>Junctions</span><input type="number" id="elp-junctions" min="1" ' +
            'value="' + (el.junctions || 1) + '" style="' + INPUT_CSS + '"></label>';
  }
  if (el.move === 'teleport') {
    html += '<label class="elp"><span>Name</span><input type="text" id="elp-teleport" ' +
            'value="' + (el.teleportName || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>';
  }
  var cpAct = RP.checkpointAfterMove(route, el.id);
  html += '<label class="elp"><span>Checkpoint</span><input type="text" id="elp-checkpoint" ' +
          'placeholder="none" value="' + (cpAct ? cpAct.name : '') + '" style="' + INPUT_CSS + ';text-align:left"></label>';
  html += '<div style="display:flex;gap:3px;margin-top:6px">' +
          '<button id="elp-up" class="sidebar-small-btn">↑</button>' +
          '<button id="elp-down" class="sidebar-small-btn">↓</button>' +
          '<button id="elp-del" class="sidebar-small-btn">🗑 Remove</button></div>';
  host.innerHTML = html;

  elpOn('elp-move', 'change', function() { RP.updateSelectedElement({ move: this.value }); });
  elpOn('elp-drive', 'click', function() { RP.updateSelectedElement({ reverse: !el.reverse }); });
  elpOn('elp-speed', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedElement({ speed: isFinite(v) && v > 0 ? v : null });
  });
  elpOn('elp-offset', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedElement({ offset: isFinite(v) ? v : 0 });
  });
  elpOn('elp-junctions', 'change', function() {
    var v = parseInt(this.value, 10);
    RP.updateSelectedElement({ junctions: isFinite(v) && v > 0 ? v : 1 });
  });
  elpOn('elp-teleport', 'change', function() {
    RP.updateSelectedElement({ teleportName: this.value || null });
  });
  elpOn('elp-checkpoint', 'change', function() {
    RP.updateSelectedElement({ checkpoint: this.value || null });
  });
  elpOn('elp-up', 'click', function() { RP.reorderSelectedElement(-1); });
  elpOn('elp-down', 'click', function() { RP.reorderSelectedElement(1); });
  elpOn('elp-del', 'click', function() { RP.removeSelectedElement(); });
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
