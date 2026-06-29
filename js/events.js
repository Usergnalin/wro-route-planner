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

    // ---- SELECT MODE ----
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

    // ---- ROUTE MODE ----
    if (RP.activeTool === 'route') {
      if (!RP.img) return;
      var p = RP.screenToImage(e.clientX, e.clientY);
      var r = RP.getActiveRoute();
      if (!r) {
        RP.pushHistory('Create route');
        RP.createRoute('Route ' + (RP.routes.length + 1));
        r = RP.getActiveRoute();
      }

      // First node of empty route: snap + start drag
      if (!r.nodes || r.nodes.length === 0) {
        var sFirst = RP.computeSnap(p.x, p.y, { kind: 'point' });
        var startPt = sFirst || p;
        RP.lineDrawing = true;
        RP.lineDrawStart = { x: startPt.x, y: startPt.y, nodeId: null };
        RP.hoverSnapPoint = null;
        wrap.classList.add('drawing-route');
        return;
      }

      // Check segment midpoints for insertion
      if (r.segments && r.segments.length > 0) {
        for (var iSeg = 0; iSeg < r.segments.length; iSeg++) {
          var segMid = r.segments[iSeg];
          var naMid = RP.findNode(r, segMid.fromNodeId);
          var nbMid = RP.findNode(r, segMid.toNodeId);
          if (!naMid || !nbMid) continue;
          var midPt = { x: (naMid.x + nbMid.x) / 2, y: (naMid.y + nbMid.y) / 2 };
          if (RP.screenDist(p.x, p.y, midPt.x, midPt.y) < 12) {
            var sMid = RP.computeSnap(p.x, p.y, { kind: 'point' });
            var snapMid = sMid || p;
            RP.pushHistory('Insert node');
            var newNode = RP._addNode(r, snapMid.x, snapMid.y);
            // Remove old segment, add two new ones
            r.segments.splice(iSeg, 1);
            RP._addSegment(r, segMid.fromNodeId, newNode.id);
            RP._addSegment(r, newNode.id, segMid.toNodeId);
            RP.render();
            RP.updateSideRouteList();
            RP.updateInfoPanel();
            if (RP.updateInstructions) RP.updateInstructions();
            return;
          }
        }
      }

      // Click near any existing node: start drawing a new segment from it
      var anchor = RP.tryRouteContinueAnchor(p.x, p.y);
      if (anchor) {
        RP.lineDrawing = true;
        RP.lineDrawStart = { x: anchor.x, y: anchor.y, nodeId: anchor.nodeId };
        RP.hoverSnapPoint = null;
        wrap.classList.add('drawing-route');
        return;
      }
      // Not near any node — fall through (pan)
    }

    // ---- FREEHAND MODE ----
    if (RP.activeTool === 'freehand') {
      if (!RP.img) return;
      var pFh = RP.screenToImage(e.clientX, e.clientY);
      var sFh = RP.computeSnap(pFh.x, pFh.y, { kind: 'point' });
      var startFh = sFh || pFh;
      RP.freehandDrawing = true;
      RP.freehandPoints = [{ x: startFh.x, y: startFh.y }];
      RP.mouseMovedSinceDown = false;
      RP.hoverSnapPoint = null;
      wrap.classList.add('drawing-route');
      return;
    }

    // ---- CONSTRUCTION MODE ----
    if (RP.activeTool === 'construction') {
      var p2 = RP.screenToImage(e.clientX, e.clientY);
      var sC = RP.computeSnap(p2.x, p2.y, { kind: 'point' });
      var startC = sC || p2;
      RP.lineDrawing = true;
      RP.lineDrawStart = { x: startC.x, y: startC.y };
      RP.hoverSnapPoint = null;
      wrap.classList.add('drawing-route');
      return;
    }

    // ---- CHECKPOINT MODE ----
    if (RP.activeTool === 'checkpoint') {
      if (!RP.img) return;
      var pCP = RP.screenToImage(e.clientX, e.clientY);
      for (var cpri = 0; cpri < RP.routes.length; cpri++) {
        var cpr = RP.routes[cpri];
        if (!cpr.visible || !cpr.segments || cpr.segments.length === 0) continue;
        // Click near segment midpoint: insert checkpoint node
        for (var cpsi = 0; cpsi < cpr.segments.length; cpsi++) {
          var cpSeg = cpr.segments[cpsi];
          var cpA = RP.findNode(cpr, cpSeg.fromNodeId);
          var cpB = RP.findNode(cpr, cpSeg.toNodeId);
          if (!cpA || !cpB) continue;
          var cpmx = (cpA.x + cpB.x) / 2, cpmy = (cpA.y + cpB.y) / 2;
          if (RP.screenDist(pCP.x, pCP.y, cpmx, cpmy) < 18) {
            var cpSnap = RP.computeSnap(pCP.x, pCP.y, { kind: 'point' }) || pCP;
            var cpName = prompt('Checkpoint name:', 'CP-' + (cpsi + 1));
            if (cpName === null) return;
            RP.pushHistory('Insert checkpoint');
            var cpNewNode = RP._addNode(cpr, cpSnap.x, cpSnap.y, { isCheckpoint: true, checkpointName: cpName });
            cpr.segments.splice(cpsi, 1);
            var cpNewSeg1 = RP._addSegment(cpr, cpSeg.fromNodeId, cpNewNode.id);
            var cpNewSeg2 = RP._addSegment(cpr, cpNewNode.id, cpSeg.toNodeId);
            cpNewSeg1.direction = cpSeg.direction; cpNewSeg1.mode = cpSeg.mode;
            cpNewSeg2.direction = cpSeg.direction; cpNewSeg2.mode = cpSeg.mode;
            RP.render();
            RP.updateSideRouteList();
            RP.updateInfoPanel();
            return;
          }
        }
        // Click near an endpoint node: mark as checkpoint
        for (var cni = 0; cni < cpr.nodes.length; cni++) {
          var cnNode = cpr.nodes[cni];
          if (RP.screenDist(pCP.x, pCP.y, cnNode.x, cnNode.y) < 18) {
            var epName = prompt('Checkpoint name:', 'CP-end');
            if (epName === null) return;
            RP.pushHistory('Set checkpoint');
            cnNode.isCheckpoint = true;
            cnNode.checkpointName = epName;
            RP.render();
            return;
          }
        }
      }
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

    if (RP.freehandDrawing) {
      RP.mouseMovedSinceDown = true;
      var pFhm = RP.screenToImage(e.clientX, e.clientY);
      var lastFh = RP.freehandPoints[RP.freehandPoints.length - 1];
      // Throttle: only record points >= ~2 screen px apart
      if (RP.screenDist(lastFh.x, lastFh.y, pFhm.x, pFhm.y) >= 2) {
        RP.freehandPoints.push({ x: pFhm.x, y: pFhm.y });
        RP.render();
      }
      return;
    }

    if (RP.lineDrawing && RP.lineDrawStart) {
      RP.mouseMovedSinceDown = true;
      var p = RP.screenToImage(e.clientX, e.clientY);
      var snapP = RP.computeSnap(p.x, p.y, { kind: 'line-end', anchor: RP.lineDrawStart });
      if (!snapP) snapP = { x: p.x, y: p.y, kind: null };
      RP.hoverSnapPoint = (snapP.x !== p.x || snapP.y !== p.y) ? { x: snapP.x, y: snapP.y } : null;
      RP.render();
      return;
    }

    if (RP.elementDrag) {
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
        for (var rie = 0; rie < RP.routes.length; rie++) {
          var re_ = RP.routes[rie];
          if (re_.id !== RP.elementDrag.routeId || !re_.nodes) continue;
          var nd_ = RP.findNode(re_, RP.elementDrag.nodeId);
          if (nd_) {
            nd_.x = fED.x; nd_.y = fED.y;
            // Re-snap if this node is the end of a wall_align segment;
            // keep follow_path curve endpoints attached to their nodes
            if (re_.segments) {
              for (var wse = 0; wse < re_.segments.length; wse++) {
                var wseg = re_.segments[wse];
                if (wseg.mode === RP.SEG_MODE_WALL_ALIGN && wseg.toNodeId === nd_.id) {
                  RP.applyWallAlignSnap(re_, wseg);
                }
                if (wseg.mode === RP.SEG_MODE_FOLLOW_PATH && wseg.pathPoints && wseg.pathPoints.length >= 2) {
                  if (wseg.fromNodeId === nd_.id) { wseg.pathPoints[0].x = nd_.x; wseg.pathPoints[0].y = nd_.y; }
                  if (wseg.toNodeId === nd_.id) {
                    var lpEnd = wseg.pathPoints[wseg.pathPoints.length - 1];
                    lpEnd.x = nd_.x; lpEnd.y = nd_.y;
                  }
                }
              }
            }
          }
          break;
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

    // Finish freehand path drawing
    if (RP.freehandDrawing) {
      RP.freehandDrawing = false;
      wrap.classList.remove('drawing-route');
      var fhPts = RP.freehandPoints || [];
      RP.freehandPoints = null;

      if (fhPts.length >= 2 && RP.img) {
        // Snap the final point to a feature if close
        var fhEndRaw = fhPts[fhPts.length - 1];
        var fhEndSnap = RP.computeSnap(fhEndRaw.x, fhEndRaw.y, { kind: 'point' });
        if (fhEndSnap) fhPts[fhPts.length - 1] = { x: fhEndSnap.x, y: fhEndSnap.y };

        if (RP.polylineLengthPx(fhPts) > 4 / RP.scale) {
          RP.pushHistory('Draw freehand path');
          var rFh = RP.getActiveRoute();
          if (!rFh) { RP.createRoute('Route ' + (RP.routes.length + 1)); rFh = RP.getActiveRoute(); }

          // From node: reuse an existing nearby node, else create one
          var fhStart = fhPts[0];
          var existFhStart = RP.findNodeNear(rFh, fhStart.x, fhStart.y, RP.ROUTE_CONTINUE_SCREEN_RADIUS);
          var fhFromId;
          if (existFhStart) { fhFromId = existFhStart.id; fhPts[0] = { x: existFhStart.x, y: existFhStart.y }; }
          else { fhFromId = RP._addNode(rFh, fhStart.x, fhStart.y).id; }

          // To node: reuse an existing nearby node, else create one
          var fhEnd = fhPts[fhPts.length - 1];
          var existFhEnd = RP.findNodeNear(rFh, fhEnd.x, fhEnd.y, RP.ROUTE_CONTINUE_SCREEN_RADIUS);
          var fhToId;
          if (existFhEnd && existFhEnd.id !== fhFromId) {
            fhToId = existFhEnd.id; fhPts[fhPts.length - 1] = { x: existFhEnd.x, y: existFhEnd.y };
          } else {
            fhToId = RP._addNode(rFh, fhEnd.x, fhEnd.y).id;
          }

          if (fhToId !== fhFromId && !RP.findSegBetween(rFh, fhFromId, fhToId)) {
            var fhSeg = RP._addSegment(rFh, fhFromId, fhToId);
            fhSeg.mode = RP.SEG_MODE_FOLLOW_PATH;
            fhSeg.pathPoints = fhPts;
          }
          RP.updateSideRouteList();
          RP.updateInfoPanel();
          if (RP.updateInstructions) RP.updateInstructions();
        }
      }
      RP.render();
      return;
    }

    // Finish line drawing
    if (RP.lineDrawing && RP.lineDrawStart) {
      var pUp = RP.screenToImage(e.clientX, e.clientY);
      var snapUp = RP.computeSnap(pUp.x, pUp.y, { kind: 'line-end', anchor: RP.lineDrawStart });
      var endPt = snapUp || pUp;
      var movedFar = RP.dist(RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y) > 2 / RP.scale;

      if (RP.activeTool === 'route' && movedFar) {
        var routeR = RP.getActiveRoute();
        if (routeR) {
          RP.pushHistory('Add route segment');

          // fromNode: either existing (if drag started from a node) or new
          var fromNodeId = RP.lineDrawStart.nodeId;
          if (fromNodeId === null || fromNodeId === undefined) {
            // First node of the route
            var fromNode = RP._addNode(routeR, RP.lineDrawStart.x, RP.lineDrawStart.y);
            fromNodeId = fromNode.id;
          }

          // toNode: snap to existing node or create new
          var existingEnd = RP.findNodeNear(routeR, endPt.x, endPt.y, RP.ROUTE_CONTINUE_SCREEN_RADIUS);
          var toNodeId;
          if (existingEnd) {
            toNodeId = existingEnd.id;
          } else {
            var toNode = RP._addNode(routeR, endPt.x, endPt.y);
            toNodeId = toNode.id;
          }

          // Prevent duplicate segment between same two nodes
          if (toNodeId !== fromNodeId && !RP.findSegBetween(routeR, fromNodeId, toNodeId)) {
            RP._addSegment(routeR, fromNodeId, toNodeId);
          }

          RP.render();
          RP.updateSideRouteList();
          RP.updateInfoPanel();
          if (RP.updateInstructions) RP.updateInstructions();
        }
      } else if (RP.activeTool === 'construction' && movedFar) {
        RP.pushHistory('Draw construction line');
        var pxLen2 = RP.dist(RP.lineDrawStart.x, RP.lineDrawStart.y, endPt.x, endPt.y);
        var mm2 = RP.calibration ? pxLen2 / RP.calibration.pixelsPerMm : pxLen2;
        RP.lines.push({
          id: RP.nextLineId++,
          x1: RP.lineDrawStart.x, y1: RP.lineDrawStart.y,
          x2: endPt.x, y2: endPt.y,
          type: 'construction', visible: true,
          label: mm2.toFixed(2) + ' mm'
        });
        if (RP.updateLayerList) RP.updateLayerList();
      }

      RP.lineDrawing = false;
      RP.lineDrawStart = null;
      RP.hoverSnapPoint = null;
      wrap.classList.remove('drawing-route');
      RP.render();
      return;
    }

    // Finish element drag
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
  var ctxMenu     = document.getElementById('ctx-menu');
  var ctxTitle    = document.getElementById('ctx-menu-title');
  var ctxDelBtn   = document.getElementById('ctx-menu-delete');
  var ctxTarget   = null; // { kind: 'node'|'segment'|'line', ... }

  function hideCtxMenu() {
    if (ctxMenu) ctxMenu.style.display = 'none';
    ctxTarget = null;
  }

  function showCtxMenu(x, y, title, target) {
    if (!ctxMenu) return;
    ctxTitle.textContent = title;
    ctxTarget = target;
    ctxMenu.style.left = (x + 4) + 'px';
    ctxMenu.style.top  = (y + 4) + 'px';
    ctxMenu.style.display = 'block';
    // Keep menu on screen
    var mr = ctxMenu.getBoundingClientRect();
    if (mr.right  > window.innerWidth)  ctxMenu.style.left = (x - mr.width  - 4) + 'px';
    if (mr.bottom > window.innerHeight) ctxMenu.style.top  = (y - mr.height - 4) + 'px';
  }

  if (ctxDelBtn) {
    ctxDelBtn.addEventListener('click', function() {
      if (!ctxTarget) { hideCtxMenu(); return; }
      if (ctxTarget.kind === 'node') {
        var r = null;
        for (var i = 0; i < RP.routes.length; i++) if (RP.routes[i].id === ctxTarget.routeId) { r = RP.routes[i]; break; }
        if (r) {
          if (r.nodes.length <= 1) { RP.pushHistory('Delete route'); RP.deleteRoute(r.id); }
          else { RP.pushHistory('Delete node'); RP.removeNode(r.id, ctxTarget.nodeId); }
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
          showCtxMenu(e.clientX, e.clientY, nodeLabel, { kind: 'node', routeId: r.id, nodeId: n.id });
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
      node.extraTurns.push(0);
      RP.rebuildNodeTurnsList(node);
      // Focus the new input
      var inputs = RP.dom.nodeExtraTurnsList.querySelectorAll('.node-turn-input');
      if (inputs.length) inputs[inputs.length - 1].select();
      if (RP.updateInstructions) RP.updateInstructions();
      RP.render();
    });
  }

  if (RP.dom.nodeExtraTurnsList) {
    // Commit a turn value on change/blur
    RP.dom.nodeExtraTurnsList.addEventListener('change', function(e) {
      if (!e.target.classList.contains('node-turn-input')) return;
      var node = RP.getSelectedNodeObj();
      if (!node || !node.extraTurns) return;
      var entry = e.target.closest('.node-turn-entry');
      var idx = entry ? parseInt(entry.dataset.idx, 10) : -1;
      if (idx < 0 || idx >= node.extraTurns.length) return;
      var v = parseFloat(e.target.value);
      node.extraTurns[idx] = isFinite(v) ? v : 0;
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
  if (RP.dom.btnToolRoute)
    RP.dom.btnToolRoute.addEventListener('click', function() { RP.setTool('route'); });
  if (RP.dom.btnToolSelect)
    RP.dom.btnToolSelect.addEventListener('click', function() { RP.setTool('select'); });
  if (RP.dom.btnToolCheckpoint)
    RP.dom.btnToolCheckpoint.addEventListener('click', function() { RP.setTool('checkpoint'); });
  if (RP.dom.btnToolFreehand)
    RP.dom.btnToolFreehand.addEventListener('click', function() { RP.setTool('freehand'); });
  if (RP.dom.btnSidebarConstruction)
    RP.dom.btnSidebarConstruction.addEventListener('click', function() { RP.setTool('construction'); });
  if (RP.dom.btnSidebarRoute)
    RP.dom.btnSidebarRoute.addEventListener('click', function() { RP.setTool('route'); });
  if (RP.dom.btnSidebarSelect)
    RP.dom.btnSidebarSelect.addEventListener('click', function() { RP.setTool('select'); });
  if (RP.dom.btnSidebarCheckpoint)
    RP.dom.btnSidebarCheckpoint.addEventListener('click', function() { RP.setTool('checkpoint'); });
  if (RP.dom.btnSidebarFreehand)
    RP.dom.btnSidebarFreehand.addEventListener('click', function() { RP.setTool('freehand'); });

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

  if (RP.dom.routeSelect) {
    RP.dom.routeSelect.addEventListener('change', function() {
      var val = RP.dom.routeSelect.value;
      if (val === '__new__') {
        var suggested = 'Route ' + (RP.routes.length + 1);
        var name = prompt('Route name:', suggested);
        if (name === null) { RP.updateRouteSelect(); return; }
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
    RP.dom.segmentModeFollowPath.addEventListener('change', function() { if (this.checked) onModeChange(RP.SEG_MODE_FOLLOW_PATH); });

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
      RP.nextSegId = 1;
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

  ['robot-w', 'robot-l', 'robot-wb', 'robot-fc', 'robot-rc'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', RP.updateRobotConfigFromUI);
    el.addEventListener('input', RP.updateRobotConfigFromUI);
  });

  ['code-comment', 'code-forward', 'code-turn', 'code-wall-align', 'code-lt-dist', 'code-lt-junct', 'code-follow-path', 'code-fp-samples', 'code-fp-flip', 'code-fp-smooth', 'code-speed', 'code-unit'].forEach(function(id) {
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
