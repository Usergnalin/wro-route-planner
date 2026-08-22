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
    // action to edit it. Nothing here creates or moves geometry.
    if (RP.editMode === 'route') {
      if (!RP.img) return;
      var pRM = RP.screenToImage(e.clientX, e.clientY);
      var hitRM = RP.routeHitTest(pRM.x, pRM.y);
      if (hitRM) {
        if (hitRM.kind === 'action' || hitRM.kind === 'move') {
          // A turn or checkpoint at a junction point, or a move's geometry.
          RP.selectedActionId = hitRM.id;
          if (hitRM.kind === 'move') RP.focusGeometryInList(hitRM.entityId);
        } else {
          var added = RP.appendGeometryToRoute(hitRM.id);
          RP.selectedActionId = added ? added.id : null;
          RP.focusGeometryInList(hitRM.id);
        }
        RP.refreshRouteUI();
        return;
      }
      // Empty space deselects and falls back to panning.
      RP.selectedActionId = null;
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
    // Moving geometry only. Which piece of geometry a route uses, and what
    // the robot does along it, are Route mode's job.
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
            // A route node is a sketch point; dragging it moves geometry,
            // which is all Select mode does now.
            RP.elementDrag = { type: 'node', routeId: rt.id, nodeId: nd.id };
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
          if (lPri.visible === false) break;   // hidden geometry is not grabbable
          if (RP.screenDist(pSel.x, pSel.y, lPri.x1, lPri.y1) < 14) {
            RP.elementDrag = { type: 'line-endpoint', lineIdx: liPri, which: 'start' };
            RP.focusGeometryInList(lPri.id);
            RP.updateInfoPanel();
            return;
          }
          if (RP.screenDist(pSel.x, pSel.y, lPri.x2, lPri.y2) < 14) {
            RP.elementDrag = { type: 'line-endpoint', lineIdx: liPri, which: 'end' };
            RP.focusGeometryInList(lPri.id);
            RP.updateInfoPanel();
            return;
          }
          break;
        }
      }

      // Construction line endpoints — also select the line in the layer list
      for (var li = 0; li < RP.lines.length; li++) {
        var l = RP.lines[li];
        if (l.visible === false) continue;
        if (RP.screenDist(pSel.x, pSel.y, l.x1, l.y1) < 14 ||
            RP.screenDist(pSel.x, pSel.y, l.x2, l.y2) < 14) {
          var which = RP.screenDist(pSel.x, pSel.y, l.x1, l.y1) < 14 ? 'start' : 'end';
          RP.elementDrag = { type: 'line-endpoint', lineIdx: li, which: which };
          RP.focusGeometryInList(l.id);
          RP.updateInfoPanel();
          return;
        }
      }

      // Clicking the BODY of a line/arc/point (not an endpoint) is not a
      // drag — nothing is grabbable there — but it should still pick the
      // geometry, the same way clicking it in Constrain or Route mode
      // does. Without this, Select mode was the one place clicking a line
      // did nothing, which made it useless for finding a line in an
      // overlapping tangle. Nearest wins, same reasoning as the
      // right-click menu and the Route-mode hit test.
      var bodyThreshSq = Math.pow(RP.snapThresholdImg(8), 2);
      var bodyId = null, bodyDSq = bodyThreshSq;
      for (var lb = 0; lb < RP.lines.length; lb++) {
        var lB = RP.lines[lb];
        if (lB.visible === false) continue;
        var dSqB = RP.pointToSegDistSq(pSel.x, pSel.y, lB.x1, lB.y1, lB.x2, lB.y2);
        if (dSqB < bodyDSq) { bodyDSq = dSqB; bodyId = lB.id; }
      }
      for (var ab = 0; ab < RP.arcs.length; ab++) {
        var arcB = RP.arcs[ab];
        if (arcB.visible === false) continue;
        var aDSqB = RP.arcHitDistSq(arcB.id, pSel.x, pSel.y);
        if (aDSqB < bodyDSq) { bodyDSq = aDSqB; bodyId = arcB.id; }
      }
      for (var pb = 0; pb < RP.points.length; pb++) {
        var ptB = RP.points[pb];
        if (ptB.visible === false) continue;
        var pDSqB = RP.dist(pSel.x, pSel.y, ptB.x, ptB.y);
        pDSqB *= pDSqB;
        if (pDSqB < bodyDSq) { bodyDSq = pDSqB; bodyId = ptB.id; }
      }
      if (bodyId !== null) {
        RP.focusGeometryInList(bodyId);
        RP.updateInfoPanel();
        return;
      }

      // Nothing grabbable here — pan.
      RP.isDragging = true;
      wrap.classList.add('dragging');
      RP.dragStartX = e.clientX;
      RP.dragStartY = e.clientY;
      RP.dragStartOffX = RP.offsetX;
      RP.dragStartOffY = RP.offsetY;
      return;
    }



    // ---- POINT TOOL ----
    // A click, not a drag: a standalone point is a reference mark, and it
    // snaps like any other drawn geometry so it can land exactly on a
    // corner or an intersection.
    if (RP.activeTool === 'point') {
      if (!RP.img) return;
      var pPt = RP.screenToImage(e.clientX, e.clientY);
      var sPt = RP.computeSnap(pPt.x, pPt.y, { kind: 'point' });
      var finPt = sPt || pPt;
      RP.pushHistory('Add point');
      var madePt = RP.addConstructionPoint(finPt.x, finPt.y, { snap: sPt || null });
      if (!madePt) { RP.undoStack.pop(); return; }
      RP.selectedLineId = madePt.point.id;
      RP.hoverSnapPoint = null;
      if (RP.updateLayerList) RP.updateLayerList();
      RP.updateInfoPanel();
      RP.render();
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
      // Sync the geometry list too, so it shows what you just clicked
      // rather than whatever was last touched there. Only for lines/arcs
      // and STANDALONE points — a line's own endpoint is not a row in
      // that list, so focusing it would select nothing visible.
      if (hitCon.kind === 'line' || hitCon.kind === 'arc') {
        RP.focusGeometryInList(hitCon.id);
      } else if (hitCon.kind === 'point' &&
                 RP.points.some(function(pt) { return pt.id === hitCon.id; })) {
        RP.focusGeometryInList(hitCon.id);
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
  var ctxHideBtn    = document.getElementById('ctx-menu-hide');
  // Only construction geometry is right-clickable. The node and segment
  // entries deleted here mutated route.nodes / route.segments, which are
  // derived views — Route mode's element list is the real editor.
  var ctxTarget     = null; // { kind: 'line', lineId } | { kind: 'move', routeId, moveId }

  function hideCtxMenu() {
    if (ctxMenu) ctxMenu.style.display = 'none';
    ctxTarget = null;
  }

  function showCtxMenu(x, y, title, target) {
    if (!ctxMenu) return;
    ctxTitle.textContent = title;
    ctxTarget = target;
    // Removing a MOVE only drops the route's reference to it — the
    // construction line is kept, same as everywhere else in Route mode.
    // Wording it as Delete would read as "delete the line".
    if (ctxDelBtn) ctxDelBtn.textContent = target.kind === 'move' ? '🗑 Remove from Route' : '🗑 Delete';
    ctxMenu.style.left = (x + 4) + 'px';
    ctxMenu.style.top  = (y + 4) + 'px';
    ctxMenu.style.display = 'block';
    // Keep menu on screen
    var mr = ctxMenu.getBoundingClientRect();
    if (mr.right  > window.innerWidth)  ctxMenu.style.left = (x - mr.width  - 4) + 'px';
    if (mr.bottom > window.innerHeight) ctxMenu.style.top  = (y - mr.height - 4) + 'px';
  }

  if (ctxHideBtn) {
    ctxHideBtn.addEventListener('click', function() {
      // Right-clicking only ever finds VISIBLE geometry, so this is
      // always a hide. Unhiding is the geometry/action list's job — a
      // hidden line (construction or route) has no clickable presence on
      // the canvas by design.
      if (ctxTarget && ctxTarget.kind === 'move') {
        RP.pushHistory('Hide move');
        RP.setMoveProps(ctxTarget.routeId, ctxTarget.moveId, { visible: false });
        if (RP.selectedActionId === ctxTarget.moveId) RP.selectedActionId = null;
        RP.refreshRouteUI();
      } else if (ctxTarget && ctxTarget.kind === 'line') {
        RP.pushHistory('Hide geometry');
        RP.setConstructionVisible(ctxTarget.lineId, false);
        if (RP.selectedLineId === ctxTarget.lineId) RP.selectedLineId = null;
        if (RP.updateLayerList) RP.updateLayerList();
        RP.render();
      }
      hideCtxMenu();
    });
  }

  if (ctxDelBtn) {
    ctxDelBtn.addEventListener('click', function() {
      if (ctxTarget && ctxTarget.kind === 'move') {
        // Reuse the exact path the action list's own ✕ button uses —
        // one remove-a-move implementation, not two that can drift apart.
        RP.selectedActionId = ctxTarget.moveId;
        RP.removeSelectedAction();
      } else if (ctxTarget && ctxTarget.kind === 'line') {
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
    var geoThreshSq = Math.pow(RP.snapThresholdImg(8), 2);

    // In Route mode, the route's own use of a line is the more specific
    // target — hiding or removing THAT is what overlapping route lines
    // need. Falls through to raw construction geometry, below, exactly
    // mirroring left-click's priority in routeHitTest.
    if (RP.editMode === 'route') {
      var rmRoute = RP.getActiveRoute();
      if (rmRoute) {
        var rmMoves = RP.moveActions(rmRoute);
        var rmBestId = null, rmBestSq = geoThreshSq, rmBestNo = 0;
        for (var mi = 0; mi < rmMoves.length; mi++) {
          if (rmMoves[mi].visible === false) continue;
          var mSq = RP.entityDistSq(RP.sketch, rmMoves[mi].entityId, p.x, p.y);
          if (mSq < rmBestSq) { rmBestSq = mSq; rmBestId = rmMoves[mi].id; rmBestNo = mi + 1; }
        }
        if (rmBestId !== null) {
          showCtxMenu(e.clientX, e.clientY, 'Route move ' + rmBestNo,
            { kind: 'move', routeId: rmRoute.id, moveId: rmBestId });
          return;
        }
      }
    }

    // Construction geometry is the only remaining right-click target, and
    // only while it is visible — a hidden line has no presence to click.
    // Points first: they are the smallest target and sit on top.
    var ptThresh = RP.snapThresholdImg(RP.ACTION_POINT_HIT_PX || 13);
    for (var pi = 0; pi < RP.points.length; pi++) {
      var sp = RP.points[pi];
      if (sp.visible === false) continue;
      if (RP.dist(p.x, p.y, sp.x, sp.y) < ptThresh) {
        showCtxMenu(e.clientX, e.clientY, sp.name || ('Point ' + (pi + 1)),
          { kind: 'line', lineId: sp.id });
        return;
      }
    }
    // Nearest wins among lines and arcs. First-in-order would pick an
    // arbitrary one of two overlapping lines, and hiding the wrong one is
    // worse than useless.
    var bestId = null, bestTitle = null, bestSq = geoThreshSq;
    for (var ai = 0; ai < RP.arcs.length; ai++) {
      var arc = RP.arcs[ai];
      if (arc.visible === false) continue;
      var dSqA = RP.arcHitDistSq(arc.id, p.x, p.y);
      if (dSqA < bestSq) {
        bestSq = dSqA; bestId = arc.id;
        bestTitle = arc.label ? ('Arc: ' + arc.label) : ('Arc ' + (ai + 1));
      }
    }
    for (var li = 0; li < RP.lines.length; li++) {
      var l = RP.lines[li];
      if (l.visible === false) continue;
      var ldSq = RP.pointToSegDistSq(p.x, p.y, l.x1, l.y1, l.x2, l.y2);
      if (ldSq < bestSq) {
        bestSq = ldSq; bestId = l.id;
        bestTitle = l.label ? ('Line: ' + l.label) : ('Line ' + (li + 1));
      }
    }
    if (bestId !== null) {
      showCtxMenu(e.clientX, e.clientY, bestTitle, { kind: 'line', lineId: bestId });
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

  // Every tool button carries data-tool, which setTool already reads to
  // decide which one lights up — so bind from the same attribute rather
  // than hand-wiring each id. The old per-button list meant adding a
  // button and forgetting to wire it produced a control that highlighted
  // correctly and did nothing, which is exactly what happened to Point.
  var toolBtns = document.querySelectorAll('[data-tool]');
  for (var tb = 0; tb < toolBtns.length; tb++) {
    (function(btn) {
      btn.addEventListener('click', function() { RP.setTool(btn.dataset.tool); });
    })(toolBtns[tb]);
  }

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
      RP.setRobotOverlay(!RP.robotOverlayVisible);
    });
  }
  if (RP.dom.btnRobotClose) {
    RP.dom.btnRobotClose.addEventListener('click', function() { RP.setRobotOverlay(false); });
  }
  if (RP.dom.robotBackdrop) {
    RP.dom.robotBackdrop.addEventListener('click', function() { RP.setRobotOverlay(false); });
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
      // Placing the marker means clicking the canvas, which the modal
      // covers — so get out of the way rather than sitting on top of it.
      RP.setRobotOverlay(false);
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

  if (RP.dom.btnSaveProject) RP.dom.btnSaveProject.addEventListener('click', RP.saveProject);

  if (RP.dom.btnOpenProject) {
    RP.dom.btnOpenProject.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = function(e) { if (e.target.files[0]) RP.openProject(e.target.files[0]); };
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
      RP.selectedActionId = null;
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

  ['code-comment', 'code-forward', 'code-turn', 'code-turn-pivot-l', 'code-turn-pivot-r',
   'code-turn-arc', 'code-wall-align', 'code-lt-dist', 'code-lt-junct',
   'code-checkpoint', 'code-speed', 'code-unit'].forEach(function(id) {
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

    // Escape closes the modal even from inside one of its fields — every
    // control in that dialog is a text input, so the typing guard below
    // would otherwise swallow the only key that dismisses it.
    if (e.key === 'Escape' && RP.robotOverlayVisible) {
      RP.setRobotOverlay(false);
      if (e.target && e.target.blur) e.target.blur();
      e.preventDefault();
      return;
    }

    if (isTypingTarget(e.target)) return;

    // Constraint shortcuts, constrain tool only so they cannot collide with
    // anything else. Modifier combos (Ctrl+V etc.) are left alone.
    if (RP.activeTool === 'constrain' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var CONSTRAINT_KEYS = {
        c: 'coincident', o: 'point_on_line', h: 'horizontal',
        v: 'vertical', d: 'distance', a: 'angle', l: 'fix',
        e: 'equal'
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

    // Mode switching. Digits pick a mode directly, Tab flips between them
    // — none of these collide with WASD panning or the constraint letters.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '1') { e.preventDefault(); RP.setEditMode('sketch'); return; }
      if (e.key === '2') { e.preventDefault(); RP.setEditMode('route'); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        RP.setEditMode(RP.editMode === 'sketch' ? 'route' : 'sketch');
        return;
      }
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
