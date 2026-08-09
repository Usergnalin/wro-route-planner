/* ========================================================================
   events.js - Mouse events, touch, wheel, keyboard, button handlers
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

RP.initEvents = function() {
  var wrap = RP.dom.wrap;

  // ======================================================================
  // MOUSE EVENTS
  // ======================================================================
  wrap.addEventListener('mousedown', function(e) {
    if (e.button === 1) {
      e.preventDefault();
      RP.isDragging = true;
      wrap.classList.add('dragging');
      RP.dragStartX = e.clientX;
      RP.dragStartY = e.clientY;
      RP.dragStartOffX = RP.offsetX;
      RP.dragStartOffY = RP.offsetY;
      return;
    }
    if (e.button !== 0) return;
    RP.mouseDownClient = { x: e.clientX, y: e.clientY };
    RP.mouseMovedSinceDown = false;

    if (RP.dom.infoClick && RP.img) {
      var cip = RP.screenToImage(e.clientX, e.clientY);
      RP.dom.infoClick.textContent = '(' + cip.x.toFixed(1) + ', ' + cip.y.toFixed(1) + ')';
    }

    // Robot start marker placement
    if (RP.startMarkerPlacing) {
      var sp = RP.screenToImage(e.clientX, e.clientY);
      var sStart = RP.computeSnap(sp.x, sp.y, { kind: 'point' });
      var fin = sStart || sp;
      RP.robotConfig.startPos = { x: fin.x, y: fin.y };
      RP.robotConfig.startHeading = 0;
      RP.startMarkerPlacing = false;
      RP.startMarkerPlacingHeading = true;
      RP.startMarkerPlacedPoint = { x: fin.x, y: fin.y };
      RP.dom.btnSetStart.textContent = '📍 Click on map to set';
      RP.updateRobotUI();
      RP.render();
      return;
    }

    // ---- ROUTE MODE ----
    // Reference-only: pick geometry to add it to the route, or pick an
    // element to edit it. Nothing here creates or moves geometry.
    if (RP.editMode === 'route') {
      if (!RP.img) return;
      var pRM = RP.screenToImage(e.clientX, e.clientY);
      var hitRM = RP.routeHitTest(pRM.x, pRM.y);
      if (hitRM) {
        if (hitRM.kind === 'element') {
          RP.selectedElementId = hitRM.id;
        } else {
          var addedEl = RP.appendGeometryToRoute(hitRM.id);
          RP.selectedElementId = addedEl ? addedEl.id : null;
        }
        RP.refreshRouteUI();
        return;
      }
      // Empty space deselects and falls back to panning.
      RP.selectedElementId = null;
      RP.refreshRouteUI();
      RP.isDragging = true;
      wrap.classList.add('dragging');
      RP.dragStartX = e.clientX;
      RP.dragStartY = e.clientY;
      RP.dragStartOffX = RP.offsetX;
      RP.dragStartOffY = RP.offsetY;
      return;
    }

    // ---- SELECT MODE ----
    // Arc bulge handle for the currently selected arc — draggable in select OR arc tool
    // (The old sagitta bulge-handle drag; arcs are sketch entities now.)
    if (RP.activeTool === 'select' && RP.selectedSegment && RP.img) {
      var pHandle = RP.screenToImage(e.clientX, e.clientY);
      var selR = null;
      for (var sri = 0; sri < RP.routes.length; sri++) {
        if (RP.routes[sri].id === RP.selectedSegment.routeId) { selR = RP.routes[sri]; break; }
      }
      var selSeg = selR && RP.findSegment ? RP.findSegment(selR, RP.selectedSegment.segId) : null;
      if (selSeg && selSeg.mode === RP.SEG_MODE_ARC && selSeg.sagitta) {
        var hA = RP.findNode(selR, selSeg.fromNodeId), hB = RP.findNode(selR, selSeg.toNodeId);
        if (hA && hB) {
          var apexH = RP.arcApex(hA.x, hA.y, hB.x, hB.y, selSeg.sagitta);
          if (RP.screenDist(pHandle.x, pHandle.y, apexH.x, apexH.y) < 12) {
            RP.elementDrag = { type: 'arc-handle', routeId: selR.id, segId: selSeg.id };
            return;
          }
        }
      }
    }

    if (RP.activeTool === 'select') {
      if (!RP.img) return;
      var pSel = RP.screenToImage(e.clientX, e.clientY);

      // Check route nodes first
      for (var ri = 0; ri < RP.routes.length; ri++) {
        var rt = RP.routes[ri];
        if (!rt.visible || !rt.nodes) continue;
        for (var ni = 0; ni < rt.nodes.length; ni++) {
          var nd = rt.nodes[ni];
          if (RP.screenDist(pSel.x, pSel.y, nd.x, nd.y) < 14) {
            RP.elementDrag = { type: 'node', routeId: rt.id, nodeId: nd.id };
            RP.selectedSegment = null;
            RP.selectedNode = { routeId: rt.id, nodeId: nd.id };
            RP.updateNodePanel();
            RP.updateInfoPanel();
            return;
          }
        }
      }

      // Prioritised construction line endpoint (already selected in layer list)
      if (RP.selectedLineId !== null && RP.selectedLineId !== undefined) {
        for (var liPri = 0; liPri < RP.lines.length; liPri++) {
          if (RP.lines[liPri].id !== RP.selectedLineId) continue;
          var lPri = RP.lines[liPri];
          if (RP.screenDist(pSel.x, pSel.y, lPri.x1, lPri.y1) < 14) {
            RP.elementDrag = { type: 'line-endpoint', lineIdx: liPri, which: 'start' };
            RP.selectedSegment = null;
            RP.updateInfoPanel();
            return;
          }
          if (RP.screenDist(pSel.x, pSel.y, lPri.x2, lPri.y2) < 14) {
            RP.elementDrag = { type: 'line-endpoint', lineIdx: liPri, which: 'end' };
            RP.selectedSegment = null;
            RP.updateInfoPanel();
            return;
          }
          break;
        }
      }

      // Construction line endpoints — also select the line in the layer list
      for (var li = 0; li < RP.lines.length; li++) {
        var l = RP.lines[li];
        if (RP.screenDist(pSel.x, pSel.y, l.x1, l.y1) < 14 ||
            RP.screenDist(pSel.x, pSel.y, l.x2, l.y2) < 14) {
          var which = RP.screenDist(pSel.x, pSel.y, l.x1, l.y1) < 14 ? 'start' : 'end';
          RP.elementDrag = { type: 'line-endpoint', lineIdx: li, which: which };
          RP.selectedSegment = null;
          RP.selectedLineId = l.id;
          RP.updateLayerList();
          RP.updateInfoPanel();
          return;
        }
      }

      // Route segments (click near segment line)
      var hitThreshSq = Math.pow(RP.snapThresholdImg(8), 2);
      for (var ri2 = 0; ri2 < RP.routes.length; ri2++) {
        var rt2 = RP.routes[ri2];
        if (!rt2.visible || !rt2.segments) continue;
        for (var si2 = 0; si2 < rt2.segments.length; si2++) {
          var seg2 = rt2.segments[si2];
          var na2 = RP.findNode(rt2, seg2.fromNodeId);
          var nb2 = RP.findNode(rt2, seg2.toNodeId);
          if (!na2 || !nb2) continue;
          var dSq2 = RP.pointToSegDistSq(pSel.x, pSel.y, na2.x, na2.y, nb2.x, nb2.y);
          if (dSq2 < hitThreshSq) {
            RP.selectedSegment = { routeId: rt2.id, segId: seg2.id };
            RP.selectedNode = null;
            if (RP.activeRouteId !== rt2.id) {
              RP.activeRouteId = rt2.id;
              RP.updateRouteSelect();
            }
            RP.updateInfoPanel();
            RP.render();
            return;
          }
        }
      }

      // No element — clear selection and pan
      if (RP.selectedSegment || RP.selectedNode) {
        RP.selectedSegment = null;
        RP.selectedNode = null;
        RP.updateInfoPanel();
        RP.render();
      }
      RP.isDragging = true;
      wrap.classList.add('dragging');
      RP.dragStartX = e.clientX;
      RP.dragStartY = e.clientY;
      RP.dragStartOffX = RP.offsetX;
      RP.dragStartOffY = RP.offsetY;
      return;
    }



    // ---- CONSTRUCTION MODE ----
    // Arcs are drawn by their chord, exactly like a line; the centre is
    // then a normal sketch point you can drag or constrain.
    if (RP.activeTool === 'construction' || RP.activeTool === 'arc') {
      var p2 = RP.screenToImage(e.clientX, e.clientY);
      var sC = RP.computeSnap(p2.x, p2.y, { kind: 'point' });
      var startC = sC || p2;
      RP.lineDrawing = true;
      // Keep the snap itself, not just its coordinates — the auto-constraint
      // applied on commit needs to know WHICH feature was snapped to.
      RP.lineDrawStart = { x: startC.x, y: startC.y, snap: sC || null };
      RP.hoverSnapPoint = null;
      wrap.classList.add('drawing-route');
      return;
    }


    // ---- CONSTRAIN MODE ----
    if (RP.activeTool === 'constrain') {
      if (!RP.img) return;
      var pCon = RP.screenToImage(e.clientX, e.clientY);
      // Constraint badges are clickable, which highlights them in the list.
      var badgeId = RP.badgeHitTest ? RP.badgeHitTest(pCon.x, pCon.y) : null;
      if (badgeId != null) {
        RP.selectConstraint(RP.selectedConstraintId === badgeId ? null : badgeId);
        return;
      }
      var hitCon = RP.sketchHitTest(pCon.x, pCon.y);
      if (!hitCon) {
        if (!e.shiftKey) RP.clearSketchSelection();
        RP.refreshSketchUI();
        return;
      }
      RP.toggleSketchSelection(hitCon.id, e.shiftKey);
      // Dragging a point re-solves with it pinned, so constrained geometry
      // follows the cursor. History is pushed on first movement, not here,
      // so a plain click does not litter the undo stack.
      if (hitCon.kind === 'point' && RP.isSketchSelected(hitCon.id)) {
        RP.sketchDrag = { pointId: hitCon.id, moved: false };
      }
      RP.refreshSketchUI();
      return;
    }

    // Fallback: pan
    RP.isDragging = true;
    wrap.classList.add('dragging');
    RP.dragStartX = e.clientX;
    RP.dragStartY = e.clientY;
    RP.dragStartOffX = RP.offsetX;
    RP.dragStartOffY = RP.offsetY;
  });

  window.addEventListener('mousemove', function(e) {
    RP.lastMouseImg = RP.screenToImage(e.clientX, e.clientY);


    if (RP.lineDrawing && RP.lineDrawStart) {
      RP.mouseMovedSinceDown = true;
      var p = RP.screenToImage(e.clientX, e.clientY);
      var snapP = RP.computeSnap(p.x, p.y, { kind: 'line-end', anchor: RP.lineDrawStart });
      if (!snapP) snapP = { x: p.x, y: p.y, kind: null };
      RP.hoverSnapPoint = (snapP.x !== p.x || snapP.y !== p.y) ? { x: snapP.x, y: snapP.y } : null;
      RP.render();
      return;
    }

    if (RP.elementDrag && RP.elementDrag.type === 'arc-handle') {
      var pAH = RP.screenToImage(e.clientX, e.clientY);
      var ahR = null;
      for (var ahi = 0; ahi < RP.routes.length; ahi++) {
        if (RP.routes[ahi].id === RP.elementDrag.routeId) { ahR = RP.routes[ahi]; break; }
      }
      var ahSeg = ahR && RP.findSegment ? RP.findSegment(ahR, RP.elementDrag.segId) : null;
      if (ahSeg) {
        var ahA = RP.findNode(ahR, ahSeg.fromNodeId), ahB = RP.findNode(ahR, ahSeg.toNodeId);
        if (ahA && ahB) {
          var perp = RP.arcPerp(ahA.x, ahA.y, ahB.x, ahB.y);
          var mxAH = (ahA.x + ahB.x) / 2, myAH = (ahA.y + ahB.y) / 2;
          // Signed perpendicular distance of cursor from chord = new sagitta
          var sag = (pAH.x - mxAH) * perp.x + (pAH.y - myAH) * perp.y;
          var maxSag = perp.L * 3;
          if (sag > maxSag) sag = maxSag; else if (sag < -maxSag) sag = -maxSag;
          if (Math.abs(sag) < 1) sag = sag < 0 ? -1 : 1;
          ahSeg.sagitta = sag;
          RP.render();
          if (RP.updateInfoPanel) RP.updateInfoPanel();
          if (RP.updateInstructions) RP.updateInstructions();
        }
      }
      return;
    }

    if (RP.sketchDrag) {
      var pSD = RP.screenToImage(e.clientX, e.clientY);
      if (!RP.sketchDrag.moved) {
        RP.pushHistory('Move point');
        RP.sketchDrag.moved = true;
      }
      RP.Sketch.dragPoint(RP.sketch, RP.sketchDrag.pointId, pSD.x, pSD.y);
      RP.rebuildLines();
      RP.render();
      return;
    }

    if (RP.elementDrag) {
      if (!RP.elementDrag.pushed) {
        // pushHistory snapshots the CURRENT state, so it has to run before
        // the first mutation. Doing it on mouseup recorded the post-move
        // state, which made the first undo a no-op.
        RP.elementDrag.pushed = true;
        RP.pushHistory('Move ' + RP.elementDrag.type);
      }
      var pED = RP.screenToImage(e.clientX, e.clientY);
      var snapED = null;
      if (RP.elementDrag.type === 'line-endpoint') {
        snapED = RP.computeSnap(pED.x, pED.y, { kind: 'point', excludeLineIdx: RP.elementDrag.lineIdx });
      } else {
        snapED = RP.computeSnap(pED.x, pED.y, { kind: 'point' });
      }
      var fED = snapED || pED;
      RP.hoverSnapPoint = snapED ? { x: snapED.x, y: snapED.y } : null;
      if (RP.elementDrag.type === 'node') {
        // A route node IS a sketch point now (the view carries the point
        // entity id), so dragging one goes through the solver like any
        // other geometry. The old wall_align re-snap and follow_path
        // endpoint sync are gone with the model that needed them.
        RP.Sketch.dragPoint(RP.sketch, RP.elementDrag.nodeId, fED.x, fED.y);
        RP.rebuildLines();
        RP.rebuildRouteViews();
      } else if (RP.elementDrag.type === 'line-endpoint') {
        var lED = RP.lines[RP.elementDrag.lineIdx];
        // The sketch owns positions now: move the underlying point and let
        // the solver drag any constrained geometry along with it.
        if (lED) RP.moveConstructionEndpoint(lED.id, RP.elementDrag.which, fED.x, fED.y);
      }
      RP.render();
      return;
    }

    if (RP.isDragging) {
      RP.offsetX = RP.dragStartOffX + (e.clientX - RP.dragStartX);
      RP.offsetY = RP.dragStartOffY + (e.clientY - RP.dragStartY);
      RP.hoverSnapPoint = null;
      RP.render();
      return;
    }

    if (RP.startMarkerPlacingHeading && RP.robotConfig.startPos) {
      var p3 = RP.screenToImage(e.clientX, e.clientY);
      var dx = p3.x - RP.robotConfig.startPos.x;
      var dy = p3.y - RP.robotConfig.startPos.y;
      if (Math.abs(dx) > 0.5 / RP.scale || Math.abs(dy) > 0.5 / RP.scale) {
        RP.robotConfig.startHeading = RP.toDeg(Math.atan2(dy, dx));
        RP.render();
      }
      return;
    }

    if (RP.img) {
      var p4 = RP.screenToImage(e.clientX, e.clientY);
      var s4 = RP.computeSnap(p4.x, p4.y, { kind: 'point' });
      if (s4 && RP.screenDist(s4.x, s4.y, p4.x, p4.y) > 1) {
        if (!RP.hoverSnapPoint || RP.hoverSnapPoint.x !== s4.x || RP.hoverSnapPoint.y !== s4.y) {
          RP.hoverSnapPoint = { x: s4.x, y: s4.y };
          RP.render();
        }
      } else if (RP.hoverSnapPoint) {
        RP.hoverSnapPoint = null;
        RP.render();
      }

      // Node hover detection
      var newHover = null;
      outer: for (var hri = 0; hri < RP.routes.length; hri++) {
        var hr = RP.routes[hri];
        if (!hr.visible || !hr.nodes) continue;
        for (var hni = 0; hni < hr.nodes.length; hni++) {
          var hn = hr.nodes[hni];
          if (RP.screenDist(p4.x, p4.y, hn.x, hn.y) < 12) {
            newHover = { routeId: hr.id, nodeId: hn.id };
            break outer;
          }
        }
      }
      var prevHover = RP.hoveredNode;
      var changed = (!prevHover && newHover) || (prevHover && !newHover) ||
        (prevHover && newHover && (prevHover.nodeId !== newHover.nodeId || prevHover.routeId !== newHover.routeId));
      if (changed) {
        RP.hoveredNode = newHover;
        RP.render();
      }
    }

    if (RP.dom.infoHover) {
      var hp = RP.screenToImage(e.clientX, e.clientY);
      RP.dom.infoHover.textContent = '(' + hp.x.toFixed(1) + ', ' + hp.y.toFixed(1) + ')';
    }
  });

  window.addEventListener('mouseup', function(e) {
    if (e.button === 1) {
      if (RP.isDragging) { RP.isDragging = false; wrap.classList.remove('dragging'); }
      return;
    }
    if (e.button !== 0) return;

    if (RP.startMarkerPlacingHeading && RP.robotConfig.startPos) {
      var p = RP.screenToImage(e.clientX, e.clientY);
      var dx = p.x - RP.robotConfig.startPos.x;
      var dy = p.y - RP.robotConfig.startPos.y;
      if (Math.abs(dx) > 1 / RP.scale || Math.abs(dy) > 1 / RP.scale) {
        RP.robotConfig.startHeading = RP.toDeg(Math.atan2(dy, dx));
      }
      RP.startMarkerPlacingHeading = false;
      RP.startMarkerPlacedPoint = null;
      RP.pushHistory('Set robot start & heading');
      RP.updateRobotUI();
      RP.render();
      return;
    }


    // Finish line drawing
    if (RP.lineDrawing && RP.lineDrawStart) {
      var pUp = RP.screenToImage(e.clientX, e.clientY);
      var snapUp = RP.computeSnap(pUp.x, pUp.y, { kind: 'line-end', anchor: RP.lineDrawStart });
      var endPt = snapUp || pUp;
      var movedFar = RP.dist(RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y) > 2 / RP.scale;

      if ((RP.activeTool === 'construction' || RP.activeTool === 'arc') && movedFar) {
        var drawOpts = {
          startSnap: RP.lineDrawStart.snap,
          endSnap: (endPt && endPt.kind) ? endPt : null
        };
        if (RP.activeTool === 'arc') {
          RP.pushHistory('Draw construction arc');
          RP.addConstructionArc(
            RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y, drawOpts);
        } else {
          RP.pushHistory('Draw construction line');
          RP.addConstructionLine(
            RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y, drawOpts);
        }
        if (RP.updateLayerList) RP.updateLayerList();
      }

      RP.lineDrawing = false;
      RP.lineDrawStart = null;
      RP.hoverSnapPoint = null;
      wrap.classList.remove('drawing-route');
      RP.render();
      return;
    }

    // Finish a sketch point drag
    if (RP.sketchDrag) {
      RP.sketchDrag = null;
      RP.solveSketch();
      RP.refreshSketchUI();
      return;
    }

    // Finish element drag
    if (RP.elementDrag) {
      // Lengths are measured live in rebuildLines(); nothing to refresh.
      RP.elementDrag = null;
      RP.render();
      if (RP.updateInstructions) RP.updateInstructions();
      return;
    }

    if (RP.isDragging) {
      RP.isDragging = false;
      wrap.classList.remove('dragging');
    }
  });

  // ======================================================================
  // CONTEXT MENU (right-click)
  // ======================================================================
  var ctxMenu       = document.getElementById('ctx-menu');
  var ctxTitle      = document.getElementById('ctx-menu-title');
  var ctxDelBtn     = document.getElementById('ctx-menu-delete');
  var ctxClearCpBtn = document.getElementById('ctx-menu-clear-checkpoint');
  var ctxTarget     = null; // { kind: 'node'|'segment'|'line', isCheckpoint?, ... }

  function hideCtxMenu() {
    if (ctxMenu) ctxMenu.style.display = 'none';
    ctxTarget = null;
  }

  function showCtxMenu(x, y, title, target) {
    if (!ctxMenu) return;
    ctxTitle.textContent = title;
    ctxTarget = target;
    if (ctxClearCpBtn) ctxClearCpBtn.style.display = target.isCheckpoint ? '' : 'none';
    ctxMenu.style.left = (x + 4) + 'px';
    ctxMenu.style.top  = (y + 4) + 'px';
    ctxMenu.style.display = 'block';
    // Keep menu on screen
    var mr = ctxMenu.getBoundingClientRect();
    if (mr.right  > window.innerWidth)  ctxMenu.style.left = (x - mr.width  - 4) + 'px';
    if (mr.bottom > window.innerHeight) ctxMenu.style.top  = (y - mr.height - 4) + 'px';
  }

  if (ctxClearCpBtn) {
    ctxClearCpBtn.addEventListener('click', function() {
      if (!ctxTarget || ctxTarget.kind !== 'node') { hideCtxMenu(); return; }
      for (var i = 0; i < RP.routes.length; i++) {
        var r = RP.routes[i];
        if (r.id !== ctxTarget.routeId) continue;
        for (var j = 0; j < r.nodes.length; j++) {
          if (r.nodes[j].id === ctxTarget.nodeId) {
            RP.pushHistory('Clear checkpoint');
            r.nodes[j].isCheckpoint = false;
            r.nodes[j].checkpointName = null;
            RP.render();
            RP.updateInstructions();
            break;
          }
        }
        break;
      }
      hideCtxMenu();
    });
  }

  if (ctxDelBtn) {
    ctxDelBtn.addEventListener('click', function() {
      if (!ctxTarget) { hideCtxMenu(); return; }
      if (ctxTarget.kind === 'node') {
        var r = null;
        for (var i = 0; i < RP.routes.length; i++) if (RP.routes[i].id === ctxTarget.routeId) { r = RP.routes[i]; break; }
        if (r) {
          RP.pushHistory('Delete node');
          RP.removeNode(r.id, ctxTarget.nodeId);
        }
      } else if (ctxTarget.kind === 'segment') {
        RP.removeSegment(ctxTarget.routeId, ctxTarget.segId);
      } else if (ctxTarget.kind === 'line') {
        RP.removeConstructionLine(ctxTarget.lineId);
      }
      hideCtxMenu();
    });
  }

  // Hide on any click outside the menu or on scroll/escape
  document.addEventListener('click', function(e) {
    if (ctxMenu && ctxMenu.style.display !== 'none' && !ctxMenu.contains(e.target)) hideCtxMenu();
  });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') hideCtxMenu(); });
  wrap.addEventListener('scroll', hideCtxMenu);

  wrap.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    hideCtxMenu();
    if (!RP.img) return;
    var p = RP.screenToImage(e.clientX, e.clientY);

    // 1. Route nodes (highest priority — small click target)
    for (var ri = 0; ri < RP.routes.length; ri++) {
      var r = RP.routes[ri];
      if (!r.visible || !r.nodes) continue;
      for (var ni = 0; ni < r.nodes.length; ni++) {
        var n = r.nodes[ni];
        if (RP.screenDist(p.x, p.y, n.x, n.y) < 12) {
          var nodeLabel = n.isCheckpoint ? ('Checkpoint: ' + (n.checkpointName || 'node')) : ('Node in ' + r.name);
          showCtxMenu(e.clientX, e.clientY, nodeLabel, { kind: 'node', routeId: r.id, nodeId: n.id, isCheckpoint: !!n.isCheckpoint });
          return;
        }
      }
    }

    // 2. Route segments
    var segThreshSq = Math.pow(RP.snapThresholdImg(8), 2);
    for (var ri2 = 0; ri2 < RP.routes.length; ri2++) {
      var r2 = RP.routes[ri2];
      if (!r2.visible || !r2.segments) continue;
      for (var si = 0; si < r2.segments.length; si++) {
        var seg = r2.segments[si];
        var na = RP.findNode(r2, seg.fromNodeId);
        var nb = RP.findNode(r2, seg.toNodeId);
        if (!na || !nb) continue;
        var dSq = RP.pointToSegDistSq(p.x, p.y, na.x, na.y, nb.x, nb.y);
        if (dSq < segThreshSq) {
          var lenStr = RP.calibration
            ? (RP.dist(na.x, na.y, nb.x, nb.y) / RP.calibration.pixelsPerMm).toFixed(0) + 'mm'
            : 'seg ' + (si + 1);
          showCtxMenu(e.clientX, e.clientY, r2.name + ' › ' + lenStr, { kind: 'segment', routeId: r2.id, segId: seg.id });
          return;
        }
      }
    }

    // 3. Construction lines
    var lineThreshSq = Math.pow(RP.snapThresholdImg(8), 2);
    for (var li = 0; li < RP.lines.length; li++) {
      var l = RP.lines[li];
      if (l.visible === false) continue;
      var ldSq = RP.pointToSegDistSq(p.x, p.y, l.x1, l.y1, l.x2, l.y2);
      if (ldSq < lineThreshSq) {
        showCtxMenu(e.clientX, e.clientY, l.label ? ('Line: ' + l.label) : ('Line ' + (li + 1)), { kind: 'line', lineId: l.id });
        return;
      }
    }
  });

  // ======================================================================
  // WHEEL ZOOM
  // ======================================================================
  wrap.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (!RP.img) return;
    var factor = e.deltaY < 0 ? 1.15 : 0.87;
    RP.zoomAt(factor, e.clientX, e.clientY);
    RP.dom.zoomHint.classList.remove('hidden');
    clearTimeout(RP.dom.zoomHint._hideTimer);
    RP.dom.zoomHint._hideTimer = setTimeout(function() { RP.dom.zoomHint.classList.add('hidden'); }, 1500);
  }, { passive: false });

  // ======================================================================
  // TOUCH SUPPORT
  // ======================================================================
  wrap.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      RP.touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: RP.offsetX, oy: RP.offsetY };
    } else if (e.touches.length === 2) {
      var t = e.touches;
      RP.lastTouchDist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      RP.lastTouchCenter = { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (e.touches.length === 1 && RP.touchPanStart) {
      RP.offsetX = RP.touchPanStart.ox + (e.touches[0].clientX - RP.touchPanStart.x);
      RP.offsetY = RP.touchPanStart.oy + (e.touches[0].clientY - RP.touchPanStart.y);
      RP.render();
    } else if (e.touches.length === 2 && RP.lastTouchCenter) {
      var t = e.touches;
      var dist_ = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      if (RP.lastTouchDist > 0) {
        var factor = dist_ / RP.lastTouchDist;
        RP.zoomAt(factor, (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
      }
      RP.lastTouchDist = dist_;
    }
  }, { passive: false });

  wrap.addEventListener('touchend', function() {
    RP.touchPanStart = null; RP.lastTouchDist = 0; RP.lastTouchCenter = null;
  });

  // ======================================================================
  // FILE INPUT
  // ======================================================================
  RP.dom.fileInput.addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) { RP.loadImageFromDataUrl(ev.target.result); };
    reader.readAsDataURL(file);
    RP.dom.fileInput.value = '';
  });

  // ---- Node extra turns ----
  if (RP.dom.btnAddNodeTurn) {
    RP.dom.btnAddNodeTurn.addEventListener('click', function() {
      var node = RP.getSelectedNodeObj();
      if (!node) return;
      if (!node.extraTurns) node.extraTurns = [];
      node.extraTurns.push({ deg: 0, speed: null });
      RP.rebuildNodeTurnsList(node);
      // Focus the new input
      var inputs = RP.dom.nodeExtraTurnsList.querySelectorAll('.node-turn-input');
      if (inputs.length) inputs[inputs.length - 1].select();
      if (RP.updateInstructions) RP.updateInstructions();
      RP.render();
    });
  }

  if (RP.dom.nodeExtraTurnsList) {
    // Commit a turn angle or turn speed on change/blur
    RP.dom.nodeExtraTurnsList.addEventListener('change', function(e) {
      var isAngle = e.target.classList.contains('node-turn-input');
      var isSpeed = e.target.classList.contains('node-turn-speed-input');
      if (!isAngle && !isSpeed) return;
      var node = RP.getSelectedNodeObj();
      if (!node || !node.extraTurns) return;
      var entry = e.target.closest('.node-turn-entry');
      var idx = entry ? parseInt(entry.dataset.idx, 10) : -1;
      if (idx < 0 || idx >= node.extraTurns.length) return;
      // Normalize entry to object form, preserving the other field
      var cur = node.extraTurns[idx];
      var deg = RP.extraTurnDeg(cur); if (!isFinite(deg)) deg = 0;
      var spd = RP.extraTurnSpeed(cur);
      if (isAngle) {
        var v = parseFloat(e.target.value); deg = isFinite(v) ? v : 0;
      } else {
        var sv = parseFloat(e.target.value); spd = (isFinite(sv) && sv > 0) ? sv : null;
      }
      node.extraTurns[idx] = { deg: deg, speed: spd };
      if (RP.updateInstructions) RP.updateInstructions();
      RP.render();
    });

    // Delete a turn entry
    RP.dom.nodeExtraTurnsList.addEventListener('click', function(e) {
      if (!e.target.classList.contains('node-turn-del')) return;
      var node = RP.getSelectedNodeObj();
      if (!node || !node.extraTurns) return;
      var entry = e.target.closest('.node-turn-entry');
      var idx = entry ? parseInt(entry.dataset.idx, 10) : -1;
      if (idx < 0 || idx >= node.extraTurns.length) return;
      node.extraTurns.splice(idx, 1);
      RP.rebuildNodeTurnsList(node);
      if (RP.updateInstructions) RP.updateInstructions();
      RP.render();
    });
  }

  wrap.addEventListener('mouseleave', function() {
    if (RP.hoveredNode) { RP.hoveredNode = null; RP.render(); }
  });

  wrap.addEventListener('dragover', function(e) { e.preventDefault(); });
  wrap.addEventListener('drop', function(e) {
    e.preventDefault();
    var file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    var reader = new FileReader();
    reader.onload = function(ev) { RP.loadImageFromDataUrl(ev.target.result); };
    reader.readAsDataURL(file);
  });

  // ======================================================================
  // BUTTON HANDLERS
  // ======================================================================
  RP.dom.btnZoomIn.addEventListener('click', function() { RP.zoomAt(1.3); });
  RP.dom.btnZoomOut.addEventListener('click', function() { RP.zoomAt(0.77); });
  RP.dom.btnFit.addEventListener('click', RP.resetView);

  if (RP.dom.btnToolConstruction)
    RP.dom.btnToolConstruction.addEventListener('click', function() { RP.setTool('construction'); });
  if (RP.dom.btnToolSelect)
    RP.dom.btnToolSelect.addEventListener('click', function() { RP.setTool('select'); });
  var btnToolConstrain = document.getElementById('btn-tool-constrain');
  if (btnToolConstrain)
    btnToolConstrain.addEventListener('click', function() { RP.setTool('constrain'); });
  var btnSidebarConstrain = document.getElementById('btn-sidebar-constrain');
  if (btnSidebarConstrain)
    btnSidebarConstrain.addEventListener('click', function() { RP.setTool('constrain'); });
  if (RP.wireConstraintPanel) RP.wireConstraintPanel();
  if (RP.wireModeSwitch) RP.wireModeSwitch();

  var btnField = document.getElementById('btn-field-boundary');
  if (btnField) {
    btnField.addEventListener('click', function() {
      if (!RP.imgNaturalW || !RP.imgNaturalH) { alert('Load an image first.'); return; }
      if (RP.hasFieldBoundary() &&
          !confirm('Replace the existing field walls?')) return;
      RP.pushHistory('Add field walls');
      RP.createFieldBoundary();
      RP.syncAllWallAligns();
      if (RP.updateLayerList) RP.updateLayerList();
      RP.refreshSketchUI();
    });
  }
  if (RP.dom.btnSidebarConstruction)
    RP.dom.btnSidebarConstruction.addEventListener('click', function() { RP.setTool('construction'); });
  if (RP.dom.btnSidebarSelect)
    RP.dom.btnSidebarSelect.addEventListener('click', function() { RP.setTool('select'); });
  if (RP.dom.btnToolArc)
    RP.dom.btnToolArc.addEventListener('click', function() { RP.setTool('arc'); });
  if (RP.dom.btnSidebarArc)
    RP.dom.btnSidebarArc.addEventListener('click', function() { RP.setTool('arc'); });

  function toggleSnap() {
    RP.snapEnabled = !RP.snapEnabled;
    if (RP.dom.btnSnap) RP.dom.btnSnap.classList.toggle('active', RP.snapEnabled);
    if (RP.dom.btnSidebarSnap) {
      RP.dom.btnSidebarSnap.classList.toggle('active', RP.snapEnabled);
      RP.dom.btnSidebarSnap.textContent = RP.snapEnabled ? '🧪 Snap On' : '🧪 Snap Off';
    }
    if (RP.dom.infoSnap) RP.dom.infoSnap.textContent = RP.snapEnabled ? 'On' : 'Off';
    if (!RP.snapEnabled) { RP.hoverSnapPoint = null; RP.render(); }
  }
  if (RP.dom.btnSnap) RP.dom.btnSnap.addEventListener('click', toggleSnap);
  if (RP.dom.btnSidebarSnap) RP.dom.btnSidebarSnap.addEventListener('click', toggleSnap);

  if (RP.dom.btnRobotConfig) {
    RP.dom.btnRobotConfig.addEventListener('click', function() {
      RP.robotOverlayVisible = !RP.robotOverlayVisible;
      RP.dom.robotOverlay.classList.toggle('visible', RP.robotOverlayVisible);
      RP.updateRobotUI();
      RP.updateCodeConfigUI();
    });
  }

  if (RP.dom.btnSetStart) {
    RP.dom.btnSetStart.addEventListener('click', function() {
      if (RP.startMarkerPlacing || RP.startMarkerPlacingHeading) {
        RP.startMarkerPlacing = false;
        RP.startMarkerPlacingHeading = false;
        RP.startMarkerPlacedPoint = null;
        RP.dom.btnSetStart.textContent = '📍 Click on map to set';
        return;
      }
      RP.startMarkerPlacing = true;
      RP.dom.btnSetStart.textContent = 'Click canvas... (click button to cancel)';
      RP.robotOverlayVisible = true;
      RP.dom.robotOverlay.classList.add('visible');
    });
  }

  if (RP.dom.btnClearStart) {
    RP.dom.btnClearStart.addEventListener('click', function() {
      RP.pushHistory('Clear robot start');
      RP.robotConfig.startPos = null;
      RP.robotConfig.startHeading = 0;
      RP.updateRobotUI();
      RP.render();
    });
  }

  // (Route create/switch/delete handlers removed — there is one route.)

  if (RP.dom.btnSaveMap) RP.dom.btnSaveMap.addEventListener('click', RP.saveMapProject);

  if (RP.dom.btnLoadMap) {
    RP.dom.btnLoadMap.addEventListener('click', function() {
      var keys = Object.keys(localStorage).filter(function(k) { return k.startsWith('wro-map-'); });
      if (keys.length === 0) {
        alert('No saved maps yet. Use "Save Map" or "Import Project" first.');
        return;
      }
      // The panel is hidden in Sketch mode; asking to load a map is an
      // explicit request to see it.
      RP._forceMapPanel = true;
      if (RP.updateModeUI) RP.updateModeUI();
      RP.updateMapList();
      if (RP.dom.mapListEl) {
        RP.dom.mapListEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        var panel = RP.dom.mapListEl.closest && RP.dom.mapListEl.closest('.side-panel');
        if (panel) {
          panel.style.transition = 'background .3s';
          var oldBg = panel.style.background;
          panel.style.background = '#3a4a5a';
          setTimeout(function() { panel.style.background = oldBg; }, 600);
        }
      }
    });
  }

  if (RP.dom.btnExportProject) RP.dom.btnExportProject.addEventListener('click', RP.exportProject);

  if (RP.dom.btnImportProject) {
    RP.dom.btnImportProject.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = function(e) { if (e.target.files[0]) RP.importProject(e.target.files[0]); };
      input.click();
    });
  }

  if (RP.dom.btnInstrToggle) {
    RP.dom.btnInstrToggle.addEventListener('click', function() {
      RP.instructionsVisible = !RP.instructionsVisible;
      RP.dom.btnInstrToggle.classList.toggle('active', RP.instructionsVisible);
      var instrPanel = document.getElementById('instr-panel');
      if (instrPanel) instrPanel.style.display = RP.instructionsVisible ? '' : 'none';
      if (RP.instructionsVisible) RP.updateInstructions();
      else if (RP.dom.codeOutput) RP.dom.codeOutput.textContent = '';
    });
  }

  if (RP.dom.btnUndo) RP.dom.btnUndo.addEventListener('click', RP.undo);
  if (RP.dom.btnRedo) RP.dom.btnRedo.addEventListener('click', RP.redo);

  if (RP.dom.btnFlipSegment) {
    RP.dom.btnFlipSegment.addEventListener('click', function() {
      if (!RP.selectedSegment) return;
      RP.flipSegmentDirection(RP.selectedSegment.routeId, RP.selectedSegment.segId);
    });
  }

  function onModeChange(mode) {
    if (!RP.selectedSegment) return;
    RP.setSegmentMode(RP.selectedSegment.routeId, RP.selectedSegment.segId, mode);
  }
  if (RP.dom.segmentModeNormal)
    RP.dom.segmentModeNormal.addEventListener('change', function() { if (this.checked) onModeChange(RP.SEG_MODE_NORMAL); });
  if (RP.dom.segmentModeTeleport)
    RP.dom.segmentModeTeleport.addEventListener('change', function() { if (this.checked) onModeChange(RP.SEG_MODE_TELEPORT); });
  if (RP.dom.segmentModeLTDist)
    RP.dom.segmentModeLTDist.addEventListener('change', function() { if (this.checked) onModeChange(RP.SEG_MODE_LINETRACE_DIST); });
  if (RP.dom.segmentModeLTJunct)
    RP.dom.segmentModeLTJunct.addEventListener('change', function() { if (this.checked) onModeChange(RP.SEG_MODE_LINETRACE_JUNCT); });
  if (RP.dom.segmentModeWallAlign)
    RP.dom.segmentModeWallAlign.addEventListener('change', function() { if (this.checked) onModeChange(RP.SEG_MODE_WALL_ALIGN); });
  if (RP.dom.segmentModeFollowPath)
  if (RP.dom.segmentModeArc)
    RP.dom.segmentModeArc.addEventListener('change', function() { if (this.checked) onModeChange(RP.SEG_MODE_ARC); });

  if (RP.dom.segmentTeleportName) {
    RP.dom.segmentTeleportName.addEventListener('change', function() {
      if (!RP.selectedSegment) return;
      RP.pushHistory('Edit teleport name');
      RP.setSegmentTeleportName(RP.selectedSegment.routeId, RP.selectedSegment.segId, this.value);
    });
  }

  if (RP.dom.segmentJunctionCount) {
    RP.dom.segmentJunctionCount.addEventListener('change', function() {
      if (!RP.selectedSegment) return;
      RP.pushHistory('Edit junction count');
      RP.setSegmentJunctionCount(RP.selectedSegment.routeId, RP.selectedSegment.segId, this.value);
    });
  }

  if (RP.dom.segmentOffset) {
    RP.dom.segmentOffset.addEventListener('change', function() {
      if (!RP.selectedSegment) return;
      var route = null;
      for (var i = 0; i < RP.routes.length; i++) {
        if (RP.routes[i].id === RP.selectedSegment.routeId) { route = RP.routes[i]; break; }
      }
      var seg = route && RP.findSegment ? RP.findSegment(route, RP.selectedSegment.segId) : null;
      if (!seg) return;
      var v = parseFloat(this.value);
      seg.offset = isFinite(v) ? v : 0;
      if (RP.updateInstructions) RP.updateInstructions();
    });
  }

  if (RP.dom.segmentSpeed) {
    RP.dom.segmentSpeed.addEventListener('change', function() {
      if (!RP.selectedSegment) return;
      var route = null;
      for (var i = 0; i < RP.routes.length; i++) {
        if (RP.routes[i].id === RP.selectedSegment.routeId) { route = RP.routes[i]; break; }
      }
      var seg = route && RP.findSegment ? RP.findSegment(route, RP.selectedSegment.segId) : null;
      if (!seg) return;
      var v = parseFloat(this.value);
      if (isFinite(v) && v > 0) seg.speed = v; else delete seg.speed;
      if (RP.updateInstructions) RP.updateInstructions();
    });
  }

  if (RP.dom.nodeTurnSpeed) {
    RP.dom.nodeTurnSpeed.addEventListener('change', function() {
      var node = RP.getSelectedNodeObj();
      if (!node) return;
      var v = parseFloat(this.value);
      if (isFinite(v) && v > 0) node.turnSpeed = v; else delete node.turnSpeed;
      if (RP.updateInstructions) RP.updateInstructions();
      RP.render();
    });
  }

  if (RP.dom.btnClearAll) {
    RP.dom.btnClearAll.addEventListener('click', function() {
      if (!confirm('Clear all lines, routes, calibration, robot config, and code templates?')) return;
      RP.pushHistory('Clear all');
      RP.resetSketch();
      RP.calibration = null;
      RP.routes = [];
      RP.activeRouteId = null;
      RP.nextWpId = 1;
      RP.nextSegId = 1;
      RP.nextRouteId = 1;
      RP.selectedSegment = null;
      RP.ensureSingleRoute();
      RP.robotConfig = RP.freshRobotConfig();
      RP.codeConfig = RP.freshCodeConfig();
      RP.updateRobotUI();
      RP.updateCodeConfigUI();
      RP.updateRouteSelect();
      RP.updateSideRouteList();
      RP.render();
    });
  }

  if (RP.dom.btnCopyCode) {
    RP.dom.btnCopyCode.addEventListener('click', function() {
      var text = RP.dom.codeOutput ? RP.dom.codeOutput.textContent : '';
      if (text) {
        navigator.clipboard.writeText(text).then(function() {
          RP.dom.btnCopyCode.textContent = '✅ Copied!';
          setTimeout(function() { RP.dom.btnCopyCode.textContent = '📋 Copy Code'; }, 2000);
        });
      }
    });
  }

  ['robot-fc', 'robot-rc'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', RP.updateRobotConfigFromUI);
    el.addEventListener('input', RP.updateRobotConfigFromUI);
  });

  ['code-comment', 'code-forward', 'code-turn', 'code-turn-arc', 'code-wall-align', 'code-lt-dist', 'code-lt-junct', 'code-speed', 'code-unit'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', RP.updateCodeConfigFromUI);
    el.addEventListener('input', RP.updateCodeConfigFromUI);
  });

  // ======================================================================
  // KEYBOARD SHORTCUTS
  // ======================================================================
  function isTypingTarget(t) {
    if (!t) return false;
    var tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (t.isContentEditable) return true;
    return false;
  }

  window.addEventListener('keydown', function(e) {
    if (e.key === 'Control') { RP.ctrlHeld = true; return; }
    if (isTypingTarget(e.target)) return;

    // Constraint shortcuts, constrain tool only so they cannot collide with
    // anything else. Modifier combos (Ctrl+V etc.) are left alone.
    if (RP.activeTool === 'constrain' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var CONSTRAINT_KEYS = {
        c: 'coincident', o: 'point_on_line', h: 'horizontal',
        v: 'vertical', d: 'distance', a: 'angle', l: 'fix'
      };
      var ckType = CONSTRAINT_KEYS[String(e.key).toLowerCase()];
      if (ckType) {
        e.preventDefault();
        var ckRes = RP.promptConstraint(ckType);
        if (ckRes && !ckRes.ok && !ckRes.cancelled && ckRes.message) alert(ckRes.message);
        return;
      }
    }

    if (e.key === 'Escape') {
      var didCancel = false;
      if (RP.lineDrawing) { RP.lineDrawing = false; RP.lineDrawStart = null; didCancel = true; }
      if (RP.startMarkerPlacing || RP.startMarkerPlacingHeading) {
        RP.startMarkerPlacing = false;
        RP.startMarkerPlacingHeading = false;
        RP.startMarkerPlacedPoint = null;
        if (RP.dom.btnSetStart) RP.dom.btnSetStart.textContent = '📍 Click on map to set';
        didCancel = true;
      }
      if (RP.selectedSegment) { RP.selectedSegment = null; RP.updateInfoPanel(); didCancel = true; }
      if (RP.sketchSelection && RP.sketchSelection.length) {
        RP.clearSketchSelection();
        RP.refreshSketchUI();
        didCancel = true;
      }
      if (didCancel) {
        RP.hoverSnapPoint = null;
        wrap.classList.remove('drawing-route');
        RP.render();
        e.preventDefault();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); RP.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); RP.redo(); return; }

    if (e.key === '+' || e.key === '=') { if (e.ctrlKey || e.metaKey) e.preventDefault(); RP.zoomAt(1.3); return; }
    if (e.key === '-') { if (e.ctrlKey || e.metaKey) e.preventDefault(); RP.zoomAt(0.77); return; }
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) { RP.resetView(); return; }

    if (!e.ctrlKey && !e.metaKey) {
      var panStep = 30 / RP.scale;
      switch (e.key.toLowerCase()) {
        case 'w': RP.offsetY += panStep; RP.render(); e.preventDefault(); return;
        case 's': RP.offsetY -= panStep; RP.render(); e.preventDefault(); return;
        case 'a': RP.offsetX += panStep; RP.render(); e.preventDefault(); return;
        case 'd': RP.offsetX -= panStep; RP.render(); e.preventDefault(); return;
      }
    }
  });

  window.addEventListener('keyup', function(e) {
    if (e.key === 'Control') { RP.ctrlHeld = false; }
  });

  window.addEventListener('blur', function() {
    RP.ctrlHeld = false;
  });
};
