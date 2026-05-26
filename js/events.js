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
    // Middle-click: pan
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

    // Update click-position info readout (was dead UI).
    if (RP.dom.infoClick && RP.img) {
      var cip = RP.screenToImage(e.clientX, e.clientY);
      RP.dom.infoClick.textContent = '(' + cip.x.toFixed(1) + ', ' + cip.y.toFixed(1) + ')';
    }

    // Robot start position placement mode
    if (RP.startMarkerPlacing) {
      var sp = RP.screenToImage(e.clientX, e.clientY);
      var fin = sp;
      var sStart = RP.computeSnap(sp.x, sp.y, { kind: 'point' });
      if (sStart) fin = sStart;
      RP.robotConfig.startPos = { x: fin.x, y: fin.y };
      RP.robotConfig.startHeading = 0;
      RP.startMarkerPlacing = false;
      RP.startMarkerPlacingHeading = true;
      RP.startMarkerPlacedPoint = { x: fin.x, y: fin.y };
      RP.dom.btnSetStart.textContent = '\ud83d\udccd Click on map to set';
      RP.updateRobotUI();
      RP.render();
      return;
    }

    // --- SELECT MODE: grab and move elements, or select a segment ---
    if (RP.activeTool === 'select') {
      if (!RP.img) return;
      var pSel = RP.screenToImage(e.clientX, e.clientY);

      // Check waypoints first (highest priority - small dot target)
      for (var ri = 0; ri < RP.routes.length; ri++) {
        var rt = RP.routes[ri];
        if (!rt.visible) continue;
        for (var wi = 0; wi < rt.waypoints.length; wi++) {
          var wp = rt.waypoints[wi];
          if (RP.screenDist(pSel.x, pSel.y, wp.x, wp.y) < 14) {
            RP.elementDrag = { type: 'waypoint', routeId: rt.id, wpIdx: wi };
            // Selecting a waypoint clears any segment selection.
            RP.selectedSegment = null;
            RP.updateInfoPanel();
            return;
          }
        }
      }

      // Check construction line endpoints
      for (var li = 0; li < RP.lines.length; li++) {
        var l = RP.lines[li];
        if (RP.screenDist(pSel.x, pSel.y, l.x1, l.y1) < 14) {
          RP.elementDrag = { type: 'line-endpoint', lineIdx: li, which: 'start' };
          RP.selectedSegment = null;
          RP.updateInfoPanel();
          return;
        }
        if (RP.screenDist(pSel.x, pSel.y, l.x2, l.y2) < 14) {
          RP.elementDrag = { type: 'line-endpoint', lineIdx: li, which: 'end' };
          RP.selectedSegment = null;
          RP.updateInfoPanel();
          return;
        }
      }

      // Check route segments (click anywhere along the line, away from
      // its endpoints which are already handled by the waypoint check
      // above). Use point-to-segment distance with a screen-space
      // threshold.
      var hitSegThreshImg = RP.snapThresholdImg(8); // 8 screen-px
      var hitSegThreshSq = hitSegThreshImg * hitSegThreshImg;
      for (var ri2 = 0; ri2 < RP.routes.length; ri2++) {
        var rt2 = RP.routes[ri2];
        if (!rt2.visible || rt2.waypoints.length < 2) continue;
        for (var seg = 0; seg < rt2.waypoints.length - 1; seg++) {
          var aSeg = rt2.waypoints[seg], bSeg = rt2.waypoints[seg + 1];
          var dSq = RP.pointToSegDistSq(pSel.x, pSel.y, aSeg.x, aSeg.y, bSeg.x, bSeg.y);
          if (dSq < hitSegThreshSq) {
            // Don't push history for selection changes - they're not
            // edits and would spam the undo stack.
            RP.selectedSegment = { routeId: rt2.id, segIdx: seg };
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

      // No element to grab — clear segment selection and pan.
      if (RP.selectedSegment) {
        RP.selectedSegment = null;
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

    // --- ROUTE MODE: click-and-drag, either starting a new route
    //     (first waypoint) or extending from the last waypoint ---
    if (RP.activeTool === 'route') {
      if (!RP.img) return;
      var p = RP.screenToImage(e.clientX, e.clientY);
      var r = RP.getActiveRoute();
      if (!r) {
        var newName = 'Route ' + (RP.routes.length + 1);
        RP.pushHistory('Create route');
        RP.createRoute(newName);
        r = RP.getActiveRoute();
      }

      // CASE A: first waypoint of this route. Start may snap freely to
      // any construction-line point feature.
      if (r.waypoints.length === 0) {
        var startPt = p;
        var sFirst = RP.computeSnap(p.x, p.y, { kind: 'point' });
        if (sFirst) startPt = sFirst;
        RP.lineDrawing = true;
        RP.lineDrawStart = { x: startPt.x, y: startPt.y };
        RP.hoverSnapPoint = null;
        RP.dom.wrap.classList.add('drawing-route');
        return;
      }

      // CASE B: route already has waypoints.
      // Sub-case B1: clicking near a segment midpoint -> insert.
      if (r.waypoints.length >= 2) {
        for (var iSeg = 0; iSeg < r.waypoints.length - 1; iSeg++) {
          var aSeg = r.waypoints[iSeg], bSeg = r.waypoints[iSeg + 1];
          var midSx = (aSeg.x + bSeg.x) / 2, midSy = (aSeg.y + bSeg.y) / 2;
          if (RP.screenDist(p.x, p.y, midSx, midSy) < 12) {
            var snapMid = p;
            var sMid = RP.computeSnap(p.x, p.y, { kind: 'point' });
            if (sMid) snapMid = sMid;
            RP.pushHistory('Insert waypoint');
            RP.insertWaypointAt(snapMid.x, snapMid.y, iSeg);
            return;
          }
        }
      }

      // Sub-case B2: starting a new segment. Required: click must be
      // near the last waypoint. The start is FORCED to the last
      // waypoint exactly. If not near, fall through to allow
      // waypoint-drag or pan.
      var anchor = RP.tryRouteContinueAnchor(p.x, p.y);
      if (anchor) {
        RP.lineDrawing = true;
        RP.lineDrawStart = { x: anchor.x, y: anchor.y };
        RP.hoverSnapPoint = null;
        RP.dom.wrap.classList.add('drawing-route');
        return;
      }
      // Not near last waypoint -> fall through (waypoint-drag or pan)
    }

    // --- CONSTRUCTION MODE: draw a line ---
    if (RP.activeTool === 'construction') {
      var p2 = RP.screenToImage(e.clientX, e.clientY);
      var startC = p2;
      var sC = RP.computeSnap(p2.x, p2.y, { kind: 'point' });
      if (sC) startC = sC;
      RP.lineDrawing = true;
      RP.lineDrawStart = { x: startC.x, y: startC.y };
      RP.hoverSnapPoint = null;
      RP.dom.wrap.classList.add('drawing-route');
      return;
    }

    // Check if clicking on a waypoint to start drag
    if (RP.img) {
      var p3 = RP.screenToImage(e.clientX, e.clientY);
      for (var ri = 0; ri < RP.routes.length; ri++) {
        var rt = RP.routes[ri];
        if (!rt.visible) continue;
        for (var wi = 0; wi < rt.waypoints.length; wi++) {
          var wp = rt.waypoints[wi];
          if (RP.screenDist(p3.x, p3.y, wp.x, wp.y) < 12) {
            RP.waypointDrag = { routeId: rt.id, wpIdx: wi, startX: wp.x, startY: wp.y };
            return;
          }
        }
      }
    }

    // Pan mode (fallback)
    RP.isDragging = true;
    wrap.classList.add('dragging');
    RP.dragStartX = e.clientX;
    RP.dragStartY = e.clientY;
    RP.dragStartOffX = RP.offsetX;
    RP.dragStartOffY = RP.offsetY;
  });

  window.addEventListener('mousemove', function(e) {
    RP.lastMouseImg = RP.screenToImage(e.clientX, e.clientY);

    // ---- Line drawing preview (construction or route) ----
    if (RP.lineDrawing && RP.lineDrawStart) {
      RP.mouseMovedSinceDown = true;
      var p = RP.screenToImage(e.clientX, e.clientY);
      var snapP = RP.computeSnap(p.x, p.y, { kind: 'line-end', anchor: RP.lineDrawStart });
      if (!snapP) snapP = { x: p.x, y: p.y, kind: null };
      // Show indicator only when we actually moved the point.
      RP.hoverSnapPoint = (snapP.x !== p.x || snapP.y !== p.y) ? { x: snapP.x, y: snapP.y } : null;
      RP.render();
      return;
    }

    // ---- Element drag (waypoints and line endpoints in select mode) ----
    if (RP.elementDrag) {
      var pED = RP.screenToImage(e.clientX, e.clientY);
      var snapED = null;
      if (RP.elementDrag.type === 'line-endpoint') {
        // Allow snap, but exclude this line so it can't self-snap.
        snapED = RP.computeSnap(pED.x, pED.y, { kind: 'point', excludeLineIdx: RP.elementDrag.lineIdx });
      } else {
        // Waypoints snap to construction features only.
        snapED = RP.computeSnap(pED.x, pED.y, { kind: 'point' });
      }
      var fED = snapED || pED;
      RP.hoverSnapPoint = snapED ? { x: snapED.x, y: snapED.y } : null;
      if (RP.elementDrag.type === 'waypoint') {
        for (var rie = 0; rie < RP.routes.length; rie++) {
          var re_ = RP.routes[rie];
          if (re_.id === RP.elementDrag.routeId && re_.waypoints[RP.elementDrag.wpIdx]) {
            re_.waypoints[RP.elementDrag.wpIdx].x = fED.x;
            re_.waypoints[RP.elementDrag.wpIdx].y = fED.y;
            break;
          }
        }
      } else if (RP.elementDrag.type === 'line-endpoint') {
        var lED = RP.lines[RP.elementDrag.lineIdx];
        if (lED) {
          if (RP.elementDrag.which === 'start') { lED.x1 = fED.x; lED.y1 = fED.y; }
          else { lED.x2 = fED.x; lED.y2 = fED.y; }
        }
      }
      RP.render();
      return;
    }

    // ---- Waypoint drag (fallback for non-select modes) ----
    if (RP.waypointDrag) {
      var pWD = RP.screenToImage(e.clientX, e.clientY);
      var snapWD = RP.computeSnap(pWD.x, pWD.y, { kind: 'point' });
      var fWD = snapWD || pWD;
      RP.hoverSnapPoint = snapWD ? { x: snapWD.x, y: snapWD.y } : null;
      for (var riw = 0; riw < RP.routes.length; riw++) {
        var rw = RP.routes[riw];
        if (rw.id === RP.waypointDrag.routeId && rw.waypoints[RP.waypointDrag.wpIdx]) {
          rw.waypoints[RP.waypointDrag.wpIdx].x = fWD.x;
          rw.waypoints[RP.waypointDrag.wpIdx].y = fWD.y;
          break;
        }
      }
      RP.render();
      return;
    }

    // ---- Pan ----
    if (RP.isDragging) {
      RP.offsetX = RP.dragStartOffX + (e.clientX - RP.dragStartX);
      RP.offsetY = RP.dragStartOffY + (e.clientY - RP.dragStartY);
      RP.hoverSnapPoint = null;
      RP.render();
      return;
    }

    // ---- Heading preview during start-marker heading placement ----
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

    // ---- Hover indicator (no drag in progress) ----
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
    }

    // Update hover info
    if (RP.dom.infoHover) {
      var hp = RP.screenToImage(e.clientX, e.clientY);
      RP.dom.infoHover.textContent = '(' + hp.x.toFixed(1) + ', ' + hp.y.toFixed(1) + ')';
    }
  });

  window.addEventListener('mouseup', function(e) {
    // Middle-click: stop pan
    if (e.button === 1) {
      if (RP.isDragging) {
        RP.isDragging = false;
        wrap.classList.remove('dragging');
      }
      return;
    }
    if (e.button !== 0) return;

    // Heading selection after placing start marker
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

    // Finish line drawing (route or construction)
    if (RP.lineDrawing && RP.lineDrawStart) {
      var pUp = RP.screenToImage(e.clientX, e.clientY);
      var snapUp = RP.computeSnap(pUp.x, pUp.y, { kind: 'line-end', anchor: RP.lineDrawStart });
      var endPt = snapUp || pUp;

      var movedFar = RP.dist(RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y) > 2 / RP.scale;

      if (RP.activeTool === 'route') {
        if (movedFar) {
          var routeR = RP.getActiveRoute();
          var emptyRoute = routeR && routeR.waypoints.length === 0;
          RP.pushHistory('Add route segment');
          if (emptyRoute) {
            RP.addWaypoint(RP.lineDrawStart.x, RP.lineDrawStart.y);
          }
          RP.addWaypoint(endPt.x, endPt.y);
        }
        RP.lineDrawing = false;
        RP.lineDrawStart = null;
        RP.hoverSnapPoint = null;
        RP.dom.wrap.classList.remove('drawing-route');
        RP.render();
        return;
      }

      // --- Construction line completion ---
      if (movedFar) {
        if (!RP.calibration) {
          // Calibrate FIRST so we don't leak nextLineId / push an empty
          // undo entry if the user cancels.
          var pxLenC = RP.dist(RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y);
          var calibrated = RP.promptCalibration(pxLenC);
          if (calibrated) {
            RP.pushHistory('Draw construction line');
            var lenMmC = pxLenC / RP.calibration.pixelsPerMm;
            RP.lines.push({
              id: RP.nextLineId++,
              x1: RP.lineDrawStart.x, y1: RP.lineDrawStart.y,
              x2: endPt.x, y2: endPt.y,
              type: 'construction',
              label: lenMmC.toFixed(2) + ' mm'
            });
          }
          // If cancelled: nothing committed, no history, no id bump.
        } else {
          RP.pushHistory('Draw construction line');
          var pxLen2 = RP.dist(RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y);
          var mm2 = pxLen2 / RP.calibration.pixelsPerMm;
          RP.lines.push({
            id: RP.nextLineId++,
            x1: RP.lineDrawStart.x, y1: RP.lineDrawStart.y,
            x2: endPt.x, y2: endPt.y,
            type: 'construction',
            label: mm2.toFixed(2) + ' mm'
          });
        }
      }
      RP.lineDrawing = false;
      RP.lineDrawStart = null;
      RP.hoverSnapPoint = null;
      RP.dom.wrap.classList.remove('drawing-route');
      RP.render();
      return;
    }

    // Finish element drag (select mode)
    if (RP.elementDrag) {
      if (RP.elementDrag.type === 'line-endpoint') {
        var l = RP.lines[RP.elementDrag.lineIdx];
        if (l && RP.calibration) {
          var pxLen = RP.dist(l.x1, l.y1, l.x2, l.y2);
          var mm = pxLen / RP.calibration.pixelsPerMm;
          l.label = mm.toFixed(2) + ' mm';
        }
      }
      RP.pushHistory('Move ' + RP.elementDrag.type);
      RP.elementDrag = null;
      RP.render();
      return;
    }

    // Finish waypoint drag
    if (RP.waypointDrag) {
      RP.pushHistory('Move waypoint');
      RP.waypointDrag = null;
      RP.render();
      return;
    }

    if (RP.isDragging) {
      RP.isDragging = false;
      wrap.classList.remove('dragging');
    }
  });

  // Right-click: delete waypoint or route
  wrap.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    if (!RP.img) return;
    var p = RP.screenToImage(e.clientX, e.clientY);
    for (var ri = 0; ri < RP.routes.length; ri++) {
      var r = RP.routes[ri];
      if (!r.visible) continue;
      for (var wi = 0; wi < r.waypoints.length; wi++) {
        var wp = r.waypoints[wi];
        if (RP.screenDist(p.x, p.y, wp.x, wp.y) < 12) {
          if (r.waypoints.length <= 1) {
            RP.pushHistory('Delete route');
            RP.deleteRoute(r.id);
          } else {
            RP.pushHistory('Delete waypoint');
            RP.removeWaypoint(r.id, wi);
          }
          return;
        }
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

  // Tool switching - use RP.setTool (defined in core.js).
  if (RP.dom.btnToolConstruction) {
    RP.dom.btnToolConstruction.addEventListener('click', function() { RP.setTool('construction'); });
  }
  if (RP.dom.btnToolRoute) {
    RP.dom.btnToolRoute.addEventListener('click', function() { RP.setTool('route'); });
  }
  if (RP.dom.btnToolSelect) {
    RP.dom.btnToolSelect.addEventListener('click', function() { RP.setTool('select'); });
  }
  if (RP.dom.btnSidebarConstruction) {
    RP.dom.btnSidebarConstruction.addEventListener('click', function() { RP.setTool('construction'); });
  }
  if (RP.dom.btnSidebarRoute) {
    RP.dom.btnSidebarRoute.addEventListener('click', function() { RP.setTool('route'); });
  }
  if (RP.dom.btnSidebarSelect) {
    RP.dom.btnSidebarSelect.addEventListener('click', function() { RP.setTool('select'); });
  }

  // Snap toggle
  function toggleSnap() {
    RP.snapEnabled = !RP.snapEnabled;
    if (RP.dom.btnSnap) RP.dom.btnSnap.classList.toggle('active', RP.snapEnabled);
    if (RP.dom.btnSidebarSnap) {
      RP.dom.btnSidebarSnap.classList.toggle('active', RP.snapEnabled);
      RP.dom.btnSidebarSnap.textContent = RP.snapEnabled ? '\ud83e\uddea Snap On' : '\ud83e\uddea Snap Off';
    }
    if (RP.dom.infoSnap) RP.dom.infoSnap.textContent = RP.snapEnabled ? 'On' : 'Off';
    if (!RP.snapEnabled) { RP.hoverSnapPoint = null; RP.render(); }
  }

  if (RP.dom.btnSnap) RP.dom.btnSnap.addEventListener('click', toggleSnap);
  if (RP.dom.btnSidebarSnap) RP.dom.btnSidebarSnap.addEventListener('click', toggleSnap);

  // Robot config
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
      // Toggle: clicking again cancels placement mode.
      if (RP.startMarkerPlacing || RP.startMarkerPlacingHeading) {
        RP.startMarkerPlacing = false;
        RP.startMarkerPlacingHeading = false;
        RP.startMarkerPlacedPoint = null;
        RP.dom.btnSetStart.textContent = '\ud83d\udccd Click on map to set';
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

  // Route select
  if (RP.dom.routeSelect) {
    RP.dom.routeSelect.addEventListener('change', function() {
      var val = RP.dom.routeSelect.value;
      if (val === '__new__') {
        var suggested = 'Route ' + (RP.routes.length + 1);
        var name = prompt('Route name:', suggested);
        if (name === null) { RP.updateRouteSelect(); return; } // cancel
        RP.pushHistory('Create route');
        RP.createRoute(name || suggested);
      } else {
        RP.pushHistory('Switch active route');
        RP.activeRouteId = parseInt(val);
        RP.updateRouteSelect();
        RP.render();
        RP.updateInfoPanel();
      }
    });
  }

  if (RP.dom.btnNewRoute) {
    RP.dom.btnNewRoute.addEventListener('click', function() {
      var suggested = 'Route ' + (RP.routes.length + 1);
      var name = prompt('Route name:', suggested);
      if (name === null) return;
      RP.pushHistory('Create route');
      RP.createRoute(name || suggested);
    });
  }

  if (RP.dom.btnDelRoute) {
    RP.dom.btnDelRoute.addEventListener('click', function() {
      if (RP.activeRouteId === null) return;
      var r = RP.getActiveRoute();
      if (!r) return;
      if (!confirm('Delete route "' + r.name + '"?')) return;
      RP.pushHistory('Delete route');
      RP.deleteRoute(RP.activeRouteId);
    });
  }

  if (RP.dom.btnSaveMap) RP.dom.btnSaveMap.addEventListener('click', RP.saveMapProject);

  if (RP.dom.btnLoadMap) {
    RP.dom.btnLoadMap.addEventListener('click', function() {
      var keys = Object.keys(localStorage).filter(function(k) { return k.startsWith('wro-map-'); });
      if (keys.length === 0) {
        alert('No saved maps yet. Use "Save Map" or "Import Project" first.');
        return;
      }
      RP.updateMapList();
      // Scroll the Saved Maps panel into view and briefly highlight it
      // so the user can find it (it's always visible at the bottom).
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
      // Toggle only the Instructions panel, not all three bottom panels.
      RP.instructionsVisible = !RP.instructionsVisible;
      RP.dom.btnInstrToggle.classList.toggle('active', RP.instructionsVisible);
      var instrPanel = document.getElementById('instr-panel');
      if (instrPanel) instrPanel.style.display = RP.instructionsVisible ? '' : 'none';
      if (RP.instructionsVisible) RP.updateInstructions();
      else { RP.dom.instrList.innerHTML = ''; RP.dom.instrTotal.textContent = ''; RP.dom.codeOutput.textContent = ''; }
    });
  }

  if (RP.dom.btnUndo) RP.dom.btnUndo.addEventListener('click', RP.undo);
  if (RP.dom.btnRedo) RP.dom.btnRedo.addEventListener('click', RP.redo);
  if (RP.dom.btnRecalibrate) RP.dom.btnRecalibrate.addEventListener('click', RP.recalibrate);

  if (RP.dom.btnFlipSegment) {
    RP.dom.btnFlipSegment.addEventListener('click', function() {
      if (!RP.selectedSegment) return;
      RP.flipSegmentDirection(RP.selectedSegment.routeId, RP.selectedSegment.segIdx);
    });
  }

  if (RP.dom.btnTeleportSegment) {
    RP.dom.btnTeleportSegment.addEventListener('click', function() {
      if (!RP.selectedSegment) return;
      RP.toggleSegmentTeleport(RP.selectedSegment.routeId, RP.selectedSegment.segIdx);
    });
  }

  if (RP.dom.btnClearAll) {
    RP.dom.btnClearAll.addEventListener('click', function() {
      if (!confirm('Clear all lines, routes, calibration, robot config, and code templates?')) return;
      RP.pushHistory('Clear all');
      RP.lines = [];
      RP.nextLineId = 1;
      RP.calibration = null;
      RP.routes = [];
      RP.activeRouteId = null;
      RP.nextWpId = 1;
      RP.nextRouteId = 1;
      RP.selectedSegment = null;
      RP.createRoute('Route 1');
      RP.robotConfig = RP.freshRobotConfig();
      RP.codeConfig = RP.freshCodeConfig();
      RP.updateRobotUI();
      RP.updateCodeConfigUI();
      RP.updateRouteSelect();
      RP.updateSideRouteList();
      RP.render();
    });
  }

  if (RP.dom.btnCopyInstr) {
    RP.dom.btnCopyInstr.addEventListener('click', function() {
      var lis = RP.dom.instrList.querySelectorAll('li');
      var parts = [];
      for (var i = 0; i < lis.length; i++) {
        parts.push(lis[i].textContent.replace(/^\d+\.\s*/, ''));
      }
      var text = parts.join('\n');
      if (text) {
        navigator.clipboard.writeText(text).then(function() {
          RP.dom.btnCopyInstr.textContent = '\u2705 Copied!';
          setTimeout(function() { RP.dom.btnCopyInstr.textContent = '\ud83d\udccb Copy Instructions'; }, 2000);
        });
      }
    });
  }

  if (RP.dom.btnCopyCode) {
    RP.dom.btnCopyCode.addEventListener('click', function() {
      var text = RP.dom.codeOutput.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(function() {
          RP.dom.btnCopyCode.textContent = '\u2705 Copied!';
          setTimeout(function() { RP.dom.btnCopyCode.textContent = '\ud83d\udccb Copy Code'; }, 2000);
        });
      }
    });
  }

  // Tab switching (instructions/code tabs)
  var tabBtns = document.querySelectorAll('.tab-btn');
  for (var ti = 0; ti < tabBtns.length; ti++) {
    (function(btn) {
      btn.addEventListener('click', function() { RP.switchTab(btn.dataset.tab); });
    })(tabBtns[ti]);
  }

  // Robot config value changes
  ['robot-w', 'robot-l', 'robot-wb'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', RP.updateRobotConfigFromUI);
    el.addEventListener('input', RP.updateRobotConfigFromUI);
  });

  // Code config value changes (live update as user types)
  ['code-comment', 'code-forward', 'code-turn-r', 'code-turn-l', 'code-speed', 'code-unit'].forEach(function(id) {
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
    // Ctrl key tracking (for snap suppression). Always track even when
    // focused in an input, so Ctrl+Z in inputs still works as native
    // browser undo (we won't intercept it below).
    if (e.key === 'Control') { RP.ctrlHeld = true; return; }

    // Don't hijack any keys while the user is typing in a form field.
    if (isTypingTarget(e.target)) return;

    // Escape: cancel any in-progress drawing / start-marker / segment selection.
    if (e.key === 'Escape') {
      var didCancel = false;
      if (RP.lineDrawing) { RP.lineDrawing = false; RP.lineDrawStart = null; didCancel = true; }
      if (RP.startMarkerPlacing || RP.startMarkerPlacingHeading) {
        RP.startMarkerPlacing = false;
        RP.startMarkerPlacingHeading = false;
        RP.startMarkerPlacedPoint = null;
        if (RP.dom.btnSetStart) RP.dom.btnSetStart.textContent = '\ud83d\udccd Click on map to set';
        didCancel = true;
      }
      if (RP.selectedSegment) { RP.selectedSegment = null; RP.updateInfoPanel(); didCancel = true; }
      if (didCancel) {
        RP.hoverSnapPoint = null;
        RP.dom.wrap.classList.remove('drawing-route');
        RP.render();
        e.preventDefault();
      }
      return;
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); RP.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); RP.redo(); return; }

    // Zoom
    if (e.key === '+' || e.key === '=') { if (e.ctrlKey || e.metaKey) e.preventDefault(); RP.zoomAt(1.3); return; }
    if (e.key === '-') { if (e.ctrlKey || e.metaKey) e.preventDefault(); RP.zoomAt(0.77); return; }
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) { RP.resetView(); return; }

    // WASD panning
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

  // Ctrl key release
  window.addEventListener('keyup', function(e) {
    if (e.key === 'Control') { RP.ctrlHeld = false; }
  });

  // Also handle when window loses focus (reset Ctrl state)
  window.addEventListener('blur', function() {
    RP.ctrlHeld = false;
  });
};
