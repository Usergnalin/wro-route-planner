/* ========================================================================
   route-ui.js - Sketch/Route mode switching and the Route mode UI.

   Route mode is strictly REFERENCE-ONLY: it never creates or moves
   geometry. You pick existing sketch geometry and say what the robot does
   along it, then set the movement parameters.

   Drawing lives entirely in Sketch mode.
   ======================================================================== */
var RP = window.RP || {};

RP.editMode = 'sketch';          // 'sketch' | 'route'
RP.selectedElementId = null;
RP._lastSketchTool = 'construction';

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

RP.routeHitTest = function(ix, iy) {
  var sk = RP.sketch;
  if (!sk) return null;
  var threshSq = Math.pow(RP.snapThresholdImg(8), 2);
  var route = RP.getActiveRoute();

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

RP.updateSelectedElement = function(props) {
  var route = RP.getActiveRoute();
  if (!route || RP.selectedElementId == null) return false;
  RP.pushHistory('Edit route element');
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

RP.updateElementList = function() {
  var list = document.getElementById('element-list');
  if (!list) return;
  list.innerHTML = '';
  var route = RP.getActiveRoute();
  var els = (route && route.elements) || [];
  if (els.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'sidebar-hint';
    empty.textContent = 'No elements yet';
    list.appendChild(empty);
    return;
  }
  for (var i = 0; i < els.length; i++) {
    (function(el, idx) {
      var row = document.createElement('div');
      row.className = 'layer-item' + (RP.selectedElementId === el.id ? ' active' : '');

      var num = document.createElement('span');
      num.className = 'constraint-glyph';
      num.textContent = String(idx + 1);

      var lbl = document.createElement('span');
      lbl.className = 'layer-item-label';
      var bits = [RP.MOVE_LABELS[el.move] || el.move];
      if (el.reverse) bits.push('rev');
      if (el.checkpoint) bits.push('🏁' + el.checkpoint);
      lbl.textContent = bits.join(' · ');
      lbl.title = lbl.textContent;
      lbl.onclick = function() {
        RP.selectedElementId = el.id;
        RP.refreshRouteUI();
      };

      var del = document.createElement('button');
      del.className = 'layer-del-btn';
      del.textContent = '✕';
      del.title = 'Remove from route (geometry is kept)';
      del.onclick = function(e) {
        e.stopPropagation();
        RP.selectedElementId = el.id;
        RP.removeSelectedElement();
      };

      row.appendChild(num);
      row.appendChild(lbl);
      row.appendChild(del);
      list.appendChild(row);
    })(els[i], i);
  }
};

var INPUT_CSS = 'width:70px;background:#3a3a3a;border:1px solid #555;color:#ddd;' +
                'padding:2px 4px;border-radius:3px;font-size:11px;text-align:right';

RP.updateElementParams = function() {
  var host = document.getElementById('element-params');
  if (!host) return;
  var el = RP.getSelectedElement();
  if (!el) {
    host.innerHTML = '<div class="sidebar-hint">Select an element to edit it</div>';
    return;
  }

  var moves = ['forward', 'arc', 'linetrace_dist', 'linetrace_junct', 'wall_align', 'teleport'];
  var html = '<label class="elp"><span>Move</span><select id="elp-move" style="' + INPUT_CSS + '">';
  for (var i = 0; i < moves.length; i++) {
    html += '<option value="' + moves[i] + '"' + (el.move === moves[i] ? ' selected' : '') + '>' +
            (RP.MOVE_LABELS[moves[i]] || moves[i]) + '</option>';
  }
  html += '</select></label>';

  // Travel direction is derived from the chain, so it is not offered here.
  // The only direction choice that is genuinely the user's is whether the
  // robot covers this element nose-first or tail-first — same start and
  // end, just driven backwards.
  html += '<label class="elp"><span>Drive</span><span class="seg-toggle">' +
          '<button type="button" id="elp-fwd" class="seg-btn' + (!el.reverse ? ' active' : '') + '">▶ Forwards</button>' +
          '<button type="button" id="elp-rev" class="seg-btn' + (el.reverse ? ' active' : '') + '">◀ Backwards</button>' +
          '</span></label>';
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
  html += '<label class="elp"><span>Checkpoint</span><input type="text" id="elp-checkpoint" ' +
          'placeholder="none" value="' + (el.checkpoint || '') + '" style="' + INPUT_CSS + ';text-align:left"></label>';
  html += '<div style="display:flex;gap:3px;margin-top:6px">' +
          '<button id="elp-up" class="sidebar-small-btn">↑</button>' +
          '<button id="elp-down" class="sidebar-small-btn">↓</button>' +
          '<button id="elp-del" class="sidebar-small-btn">🗑 Remove</button></div>';
  host.innerHTML = html;

  function on(id, evt, fn) {
    var node = document.getElementById(id);
    if (node) node.addEventListener(evt, fn);
  }
  on('elp-move', 'change', function() { RP.updateSelectedElement({ move: this.value }); });
  on('elp-fwd', 'click', function() { RP.updateSelectedElement({ reverse: false }); });
  on('elp-rev', 'click', function() { RP.updateSelectedElement({ reverse: true }); });
  on('elp-speed', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedElement({ speed: isFinite(v) && v > 0 ? v : null });
  });
  on('elp-offset', 'change', function() {
    var v = parseFloat(this.value);
    RP.updateSelectedElement({ offset: isFinite(v) ? v : 0 });
  });
  on('elp-junctions', 'change', function() {
    var v = parseInt(this.value, 10);
    RP.updateSelectedElement({ junctions: isFinite(v) && v > 0 ? v : 1 });
  });
  on('elp-teleport', 'change', function() {
    RP.updateSelectedElement({ teleportName: this.value || null });
  });
  on('elp-checkpoint', 'change', function() {
    RP.updateSelectedElement({ checkpoint: this.value || null });
  });
  on('elp-up', 'click', function() { RP.reorderSelectedElement(-1); });
  on('elp-down', 'click', function() { RP.reorderSelectedElement(1); });
  on('elp-del', 'click', function() { RP.removeSelectedElement(); });
};

RP.wireModeSwitch = function() {
  var bs = document.getElementById('btn-mode-sketch');
  var br = document.getElementById('btn-mode-route');
  if (bs) bs.addEventListener('click', function() { RP.setEditMode('sketch'); });
  if (br) br.addEventListener('click', function() { RP.setEditMode('route'); });
  var rev = document.getElementById('btn-reverse-route');
  if (rev) rev.addEventListener('click', function() { RP.reverseRoute(); });
  RP.updateModeUI();
  RP.updateRouteModePanel();
};
