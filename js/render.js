/* ========================================================================
   render.js - Canvas rendering, line drawing, route drawing
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

RP.render = function() {
  var size = RP.getCanvasSize();
  var ctx = RP.dom.ctx;
  var w = size.w, h = size.h;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  // The robot document is drawn in its own coordinate space, so the mat
  // photo means nothing there — and unlike the mat, it must still render
  // with no image loaded at all, or you could not draw a robot before
  // opening a project.
  var onRobotDoc = RP.activeDocId === RP.DOC_ROBOT;
  if (!RP.img && !onRobotDoc) return;

  if (RP.img && !onRobotDoc) {
    ctx.save();
    ctx.translate(RP.offsetX, RP.offsetY);
    ctx.scale(RP.scale, RP.scale);
    ctx.drawImage(RP.img, 0, 0);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(RP.offsetX, RP.offsetY);
  ctx.scale(RP.scale, RP.scale);

  var fs = 14 / RP.scale;
  ctx.font = fs + 'px -apple-system, sans-serif';
  ctx.lineCap = 'round';
  ctx.textBaseline = 'bottom';

  // --- Draw construction lines ---
  // Route mode dims geometry to a guide, and skips lines a route already
  // draws, so the same line is not rendered twice with two meanings.
  var inRouteMode = RP.editMode === 'route';
  var routeRefs = (inRouteMode && RP.routeReferencedEntities) ? RP.routeReferencedEntities() : {};
  for (var li = 0; li < RP.lines.length; li++) {
    var l = RP.lines[li];
    if (l.visible === false) continue;
    if (inRouteMode && routeRefs[l.id]) continue;
    var isSel = RP.selectedLineId === l.id ||
                (RP.isSketchSelected ? RP.isSketchSelected(l.id) : false);
    // Unselected construction geometry is tinted by solver status:
    // green under-constrained, blue fully constrained, orange redundant,
    // red conflicting.
    // Route mode dims geometry to a guide — but a line picked in the
    // geometry list still has to stand out, or the list cannot be used to
    // find anything.
    var isHover = RP.hoverGeoId === l.id;
    var color = isSel ? '#ffee44'
                      : (isHover ? RP.HOVER_GEO_COLOR
                      : (inRouteMode ? 'rgba(90,150,90,0.45)'
                                     : (RP.sketchStatusColor ? RP.sketchStatusColor() : '#44ff44')));
    // Field walls are fixed reference geometry, not something you drew.
    var isField = l.role === 'field';
    if (isField && !isSel && !isHover) color = inRouteMode ? 'rgba(200,200,210,0.30)' : 'rgba(190,190,205,0.75)';
    // Obstacles and the drive axis are read at a glance rather than
    // looked up, so they keep their own colour whatever the solver
    // status is: red for "do not drive through this", cyan for the
    // robot's own frame.
    if (l.role === RP.OBSTACLE_ROLE && !isSel && !isHover) color = inRouteMode ? 'rgba(255,90,90,0.55)' : '#ff5a5a';
    if (l.role === RP.DRIVE_ROLE && !isSel && !isHover) color = '#33e0ff';
    // Hover is drawn thicker than selection for the same reason the route
    // halo is: the cursor is over the list, not the geometry.
    var width = (isHover ? 4.5 : (isSel ? 3 : 2)) / RP.scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([6 / RP.scale, 4 / RP.scale]);
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Labels are NOT drawn here. Length text and constraint badges are
    // laid out together by RP.drawSketchOverlay so they cannot overlap.
  }

  // --- Draw construction arcs ---
  for (var ai = 0; ai < RP.arcs.length; ai++) {
    var arc = RP.arcs[ai];
    if (arc.visible === false) continue;
    if (inRouteMode && routeRefs[arc.id]) continue;
    var arcSel = RP.selectedLineId === arc.id ||
                 (RP.isSketchSelected ? RP.isSketchSelected(arc.id) : false);
    var arcHover = RP.hoverGeoId === arc.id;
    var arcColor = arcSel ? '#ffee44'
                          : (arcHover ? RP.HOVER_GEO_COLOR
                          : (inRouteMode ? 'rgba(90,150,90,0.45)'
                                         : (RP.sketchStatusColor ? RP.sketchStatusColor() : '#44ff44')));
    if (arc.role === RP.OBSTACLE_ROLE && !arcSel && !arcHover) {
      arcColor = inRouteMode ? 'rgba(255,90,90,0.55)' : '#ff5a5a';
    }
    var apts = RP.Sketch.arcPoints(RP.sketch, RP.sketch.entities[arc.id], 48);
    if (apts.length < 2) continue;
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = (arcHover ? 4.5 : (arcSel ? 3 : 2)) / RP.scale;
    ctx.setLineDash([6 / RP.scale, 4 / RP.scale]);
    ctx.beginPath();
    ctx.moveTo(apts[0].x, apts[0].y);
    for (var api = 1; api < apts.length; api++) ctx.lineTo(apts[api].x, apts[api].y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Centre tick, so it is obvious the centre is draggable geometry.
    if (!inRouteMode) {
      ctx.strokeStyle = 'rgba(160,200,255,0.6)';
      ctx.lineWidth = 1 / RP.scale;
      var tk = 4 / RP.scale;
      ctx.beginPath();
      ctx.moveTo(arc.cx - tk, arc.cy); ctx.lineTo(arc.cx + tk, arc.cy);
      ctx.moveTo(arc.cx, arc.cy - tk); ctx.lineTo(arc.cx, arc.cy + tk);
      ctx.stroke();
    }
  }

  // --- Draw standalone points ---
  // Drawn as a small ring with a centre dot so they read as a marked
  // position rather than as another line's endpoint.
  for (var spi = 0; spi < RP.points.length; spi++) {
    var sp = RP.points[spi];
    if (sp.visible === false) continue;
    var spSel = RP.selectedLineId === sp.id ||
                (RP.isSketchSelected ? RP.isSketchSelected(sp.id) : false);
    var spHover = RP.hoverGeoId === sp.id;
    var spColor = spSel ? '#ffee44'
                        : (spHover ? RP.HOVER_GEO_COLOR
                        : (inRouteMode ? 'rgba(150,190,150,0.5)'
                                       : (RP.sketchStatusColor ? RP.sketchStatusColor() : '#44ff44')));
    var spR = (spSel || spHover ? 6 : 4.5) / RP.scale;
    ctx.strokeStyle = spColor;
    ctx.lineWidth = (spSel || spHover ? 2.5 : 1.8) / RP.scale;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, spR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = spColor;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 1.4 / RP.scale, 0, Math.PI * 2);
    ctx.fill();
    if (sp.name && RP.scale > 0.05) {
      ctx.font = fs + 'px -apple-system, sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3 / RP.scale;
      ctx.strokeText(sp.name, sp.x + spR + 4 / RP.scale, sp.y - 2 / RP.scale);
      ctx.fillStyle = spColor;
      ctx.fillText(sp.name, sp.x + spR + 4 / RP.scale, sp.y - 2 / RP.scale);
    }
  }

  // --- Field boundary (shown when any wall_align segment exists) ---
  if (RP.imgNaturalW && RP.imgNaturalH && RP.calibration && !onRobotDoc) {
    var hasWallAlign = false;
    for (var wri = 0; wri < RP.routes.length && !hasWallAlign; wri++) {
      var wr = RP.routes[wri];
      if (wr.segments) for (var wsi = 0; wsi < wr.segments.length && !hasWallAlign; wsi++) {
        if (wr.segments[wsi].mode === RP.SEG_MODE_WALL_ALIGN) hasWallAlign = true;
      }
    }
    if (hasWallAlign) {
      ctx.save();
      ctx.strokeStyle = 'rgba(220,220,220,0.35)';
      ctx.lineWidth = 2 / RP.scale;
      ctx.setLineDash([8 / RP.scale, 8 / RP.scale]);
      ctx.strokeRect(0, 0, RP.imgNaturalW, RP.imgNaturalH);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // --- Draw routes (graph model) ---
  // Routes recede in Sketch mode so construction geometry reads clearly.
  ctx.save();
  if (!inRouteMode) ctx.globalAlpha = 0.35;
  // Routes reference MAT geometry, so their coordinates are meaningless
  // over the robot document — drawing them there would scatter the route
  // across the robot's body at robot scale.
  for (var ri = 0; ri < RP.routes.length && !onRobotDoc; ri++) {
    var r = RP.routes[ri];
    if (!r.visible || !r.nodes || r.nodes.length === 0) continue;
    if (!r.segments || r.segments.length === 0) {
      // Route with single node only — draw dot
      var soloNode = r.nodes[0];
      ctx.fillStyle = r.id === RP.activeRouteId ? '#44aaff' : '#4488cc';
      ctx.beginPath();
      ctx.arc(soloNode.x, soloNode.y, 4.5 / RP.scale, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    var isActive = r.id === RP.activeRouteId;
    var baseColor  = isActive ? '#44aaff' : '#4488cc';
    var revColor   = isActive ? '#ff8844' : '#cc6633';
    var teleColor  = '#ffaa00';
    var ltColor    = isActive ? '#44ff88' : '#33cc66';
    var waColor    = '#e0e0e0';
    var selColor   = '#ffd966';
    var dimColor   = isActive ? 'rgba(68,170,255,0.28)' : 'rgba(68,136,204,0.22)';

    // Compute longest path (for code generation path highlighting)
    var longestPath = RP.computeLongestPath ? RP.computeLongestPath(r) : [];
    var pathNodeIds = {};
    for (var pi = 0; pi < longestPath.length; pi++) pathNodeIds[longestPath[pi].id] = pi;

    // Build set of segment ids on longest path
    var pathSegIds = {};
    for (var pi2 = 0; pi2 < longestPath.length - 1; pi2++) {
      var ps = RP.findSegBetween ? RP.findSegBetween(r, longestPath[pi2].id, longestPath[pi2 + 1].id) : null;
      if (ps) pathSegIds[ps.id] = true;
    }
    var hasLongestPath = longestPath.length >= 2;

    ctx.setLineDash([]);

    // Draw segments
    for (var si = 0; si < r.segments.length; si++) {
      var seg = r.segments[si];
      if (seg.visible === false) continue;
      var na = RP.findNode(r, seg.fromNodeId);
      var nb = RP.findNode(r, seg.toNodeId);
      if (!na || !nb) continue;

      var isBack = seg.direction === RP.SEG_BACKWARD;
      var sMode = seg.mode || RP.SEG_MODE_NORMAL;
      var isTeleport  = sMode === RP.SEG_MODE_TELEPORT;
      var isLineTrace = sMode === RP.SEG_MODE_LINETRACE_DIST || sMode === RP.SEG_MODE_LINETRACE_JUNCT;
      var isWallAlign = sMode === RP.SEG_MODE_WALL_ALIGN;
      var isArc = seg.entityType === 'arc';
      // Segment ids ARE move-action ids, so the route-mode selection lines up
      // with the derived segment view directly.
      var isSegSel = inRouteMode && r.id === RP.activeRouteId &&
                     RP.selectedMoveId === seg.id;
      var onPath = pathSegIds[seg.id];
      var segColor = (hasLongestPath && !onPath) ? dimColor
        // Arcs take the same blue/orange as straights: what the colour says
        // is which WAY the robot drives, and an arc is driven forwards or
        // backwards exactly like a straight is. A separate arc colour meant
        // a reversing arc looked identical to a forward one.
        : (isTeleport ? teleColor : (isLineTrace ? ltColor : (isWallAlign ? waColor : (isBack ? revColor : baseColor))));

      // Arc render polyline (matches the generated turn_arc geometry)
      var arcRenderPts = null;
      if (isArc) {
        arcRenderPts = RP.Sketch.arcPoints(RP.sketch, RP.sketch.entities[seg.entityId], 48);
        // Points come back in stored p1->p2 order; put them in travel order
        // so the direction chevron points the right way.
        if (seg.flip) arcRenderPts = arcRenderPts.slice().reverse();
        if (arcRenderPts.length < 2) { isArc = false; arcRenderPts = null; }
      }

      // Trace the straight segment or the arc polyline
      var _segPath = function() {
        ctx.beginPath();
        if (isArc) {
          var pp = arcRenderPts;
          ctx.moveTo(pp[0].x, pp[0].y);
          for (var ppi = 1; ppi < pp.length; ppi++) ctx.lineTo(pp[ppi].x, pp[ppi].y);
        } else {
          ctx.moveTo(na.x, na.y);
          ctx.lineTo(nb.x, nb.y);
        }
        ctx.stroke();
      };

      // Same outline the selection uses, one shade down: hovering a row in
      // the action list previews exactly what clicking it would pick.
      var isSegHover = inRouteMode && r.id === RP.activeRouteId &&
                       RP.hoverActionId === seg.id && !isSegSel;
      if (isSegSel || isSegHover) {
        ctx.strokeStyle = isSegSel ? selColor : RP.HOVER_ROUTE_COLOR;
        // The hover halo is wider than the selection's. It has to be: it is
        // read against a bright mat photo while the cursor is elsewhere
        // (over the list), so it cannot rely on the eye already being on
        // the line the way a just-clicked selection can.
        ctx.lineWidth = (isSegSel ? (isActive ? 6 : 5) : 11) / RP.scale;
        _segPath();
      }

      ctx.strokeStyle = segColor;
      ctx.fillStyle = segColor;
      ctx.lineWidth = isActive ? 3 / RP.scale : 2 / RP.scale;
      if (isTeleport) ctx.setLineDash([2 / RP.scale, 6 / RP.scale]);
      else if (isBack) ctx.setLineDash([8 / RP.scale, 5 / RP.scale]);
      _segPath();
      ctx.setLineDash([]);

      // Travel-direction chevron. Direction along the geometry is derived
      // from the chain, so this is the only place it is visible — you read
      // it off the canvas instead of a checkbox. Colour/dash already
      // encodes whether the robot drives that stretch tail-first.
      if (inRouteMode && !isTeleport && RP.scale > 0.05) {
        var cmx, cmy, cAng;
        if (isArc && arcRenderPts && arcRenderPts.length >= 2) {
          var ai = Math.floor(arcRenderPts.length / 2);
          var aa = arcRenderPts[Math.max(0, ai - 1)], ab = arcRenderPts[ai];
          cmx = ab.x; cmy = ab.y;
          cAng = RP.angleRad(aa.x, aa.y, ab.x, ab.y);
        } else {
          cmx = (na.x + nb.x) / 2; cmy = (na.y + nb.y) / 2;
          cAng = RP.angleRad(na.x, na.y, nb.x, nb.y);
        }
        var cs = 9 / RP.scale;
        ctx.fillStyle = segColor;
        ctx.beginPath();
        ctx.moveTo(cmx + cs * Math.cos(cAng), cmy + cs * Math.sin(cAng));
        ctx.lineTo(cmx + cs * 0.6 * Math.cos(cAng + 2.4), cmy + cs * 0.6 * Math.sin(cAng + 2.4));
        ctx.lineTo(cmx + cs * 0.6 * Math.cos(cAng - 2.4), cmy + cs * 0.6 * Math.sin(cAng - 2.4));
        ctx.closePath();
        ctx.fill();
      }

      if (hasLongestPath && !onPath) continue; // skip decorations for off-path segs


      if (isArc) {
        var apts = arcRenderPts;
        // Direction arrow at the arc midpoint (respect reverse traversal)
        if (RP.scale > 0.05) {
          var amI = Math.floor(apts.length / 2);
          var aa0 = apts[Math.max(0, amI - 1)], ab0 = apts[Math.min(apts.length - 1, amI)];
          var aAng = isBack ? RP.angleRad(ab0.x, ab0.y, aa0.x, aa0.y) : RP.angleRad(aa0.x, aa0.y, ab0.x, ab0.y);
          var aTip = isBack ? aa0 : ab0;
          var aArr = 12 / RP.scale;
          ctx.fillStyle = segColor;
          ctx.beginPath();
          ctx.moveTo(aTip.x + aArr * Math.cos(aAng), aTip.y + aArr * Math.sin(aAng));
          ctx.lineTo(aTip.x + aArr * 0.5 * Math.cos(aAng + 2.5), aTip.y + aArr * 0.5 * Math.sin(aAng + 2.5));
          ctx.lineTo(aTip.x + aArr * 0.5 * Math.cos(aAng - 2.5), aTip.y + aArr * 0.5 * Math.sin(aAng - 2.5));
          ctx.closePath();
          ctx.fill();
        }
        // The sagitta bulge handle is gone. An arc's shape is now changed by
        // dragging its centre point in Sketch mode, or by constraining its
        // radius — there is nothing route-side left to drag.
        continue; // skip the straight-segment decorations below
      }

      if (isWallAlign && RP.scale > 0.03) {
        // Draw a wall-stop block at the end (toNode = nb)
        var wallBlockSize = 10 / RP.scale;
        var wAng = RP.angleRad(na.x, na.y, nb.x, nb.y) + Math.PI / 2; // perpendicular to segment
        ctx.save();
        ctx.strokeStyle = waColor;
        ctx.lineWidth = 3 / RP.scale;
        ctx.beginPath();
        ctx.moveTo(nb.x + wallBlockSize * Math.cos(wAng), nb.y + wallBlockSize * Math.sin(wAng));
        ctx.lineTo(nb.x - wallBlockSize * Math.cos(wAng), nb.y - wallBlockSize * Math.sin(wAng));
        ctx.stroke();
        ctx.restore();
        // Small label
        if (RP.scale > 0.1) {
          ctx.save();
          ctx.font = (10 / RP.scale) + 'px -apple-system, sans-serif';
          ctx.fillStyle = waColor;
          var labAng = RP.angleRad(na.x, na.y, nb.x, nb.y) + Math.PI / 2;
          ctx.fillText('wall', nb.x + (14 / RP.scale) * Math.cos(labAng), nb.y + (14 / RP.scale) * Math.sin(labAng));
          ctx.restore();
        }
      } else if (isTeleport) {
        if (RP.scale > 0.05) {
          var segMidX = (na.x + nb.x) / 2, segMidY = (na.y + nb.y) / 2;
          var segAng = RP.angleRad(na.x, na.y, nb.x, nb.y);
          var perpOff = 8 / RP.scale;
          ctx.fillStyle = segColor;
          ctx.font = 'bold ' + (13 / RP.scale) + 'px -apple-system, sans-serif';
          ctx.fillText('⚡', segMidX + Math.cos(segAng + Math.PI / 2) * perpOff,
            segMidY + Math.sin(segAng + Math.PI / 2) * perpOff + 4 / RP.scale);
        }
      } else if (RP.scale > 0.05) {
        var mx2 = (na.x + nb.x) / 2, my2 = (na.y + nb.y) / 2;
        var ang = isBack ? RP.angleRad(nb.x, nb.y, na.x, na.y) : RP.angleRad(na.x, na.y, nb.x, nb.y);
        var arrLen = 12 / RP.scale;
        ctx.fillStyle = segColor;
        ctx.beginPath();
        ctx.moveTo(mx2 + arrLen * Math.cos(ang), my2 + arrLen * Math.sin(ang));
        ctx.lineTo(mx2 + arrLen * 0.5 * Math.cos(ang + 2.5), my2 + arrLen * 0.5 * Math.sin(ang + 2.5));
        ctx.lineTo(mx2 + arrLen * 0.5 * Math.cos(ang - 2.5), my2 + arrLen * 0.5 * Math.sin(ang - 2.5));
        ctx.closePath();
        ctx.fill();
        if (isBack) {
          ctx.save();
          ctx.font = 'bold ' + fs + 'px -apple-system, sans-serif';
          ctx.fillStyle = segColor;
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = 3 / RP.scale;
          var perpAng = ang + Math.PI / 2;
          var labOff = 18 / RP.scale;
          ctx.strokeText('(rev)', mx2 + labOff * Math.cos(perpAng), my2 + labOff * Math.sin(perpAng));
          ctx.fillText('(rev)', mx2 + labOff * Math.cos(perpAng), my2 + labOff * Math.sin(perpAng));
          ctx.restore();
        }
      }
    }

    // Restore font/style for node dots
    ctx.font = fs + 'px -apple-system, sans-serif';
    ctx.strokeStyle = baseColor;
    ctx.fillStyle = baseColor;
    ctx.lineWidth = isActive ? 3 / RP.scale : 2 / RP.scale;

    // Draw nodes
    for (var ni = 0; ni < r.nodes.length; ni++) {
      var node = r.nodes[ni];
      var nodeIdx = pathNodeIds[node.id];
      var onLongestPath = nodeIdx !== undefined;
      var nodeColor = (hasLongestPath && !onLongestPath) ? dimColor : baseColor;

      if (node.isCheckpoint) {
        var cpR = 7 / RP.scale;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - cpR);
        ctx.lineTo(node.x + cpR, node.y);
        ctx.lineTo(node.x, node.y + cpR);
        ctx.lineTo(node.x - cpR, node.y);
        ctx.closePath();
        ctx.fillStyle = '#ff44ff';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 / RP.scale;
        ctx.stroke();
        var cpLabel = node.checkpointName || ('CP ' + (ni + 1));
        ctx.fillStyle = '#ffccff';
        ctx.font = 'bold ' + (fs * 0.9) + 'px -apple-system, sans-serif';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 2.5 / RP.scale;
        ctx.strokeText(cpLabel, node.x + (9 / RP.scale), node.y - (1 / RP.scale));
        ctx.fillText(cpLabel, node.x + (9 / RP.scale), node.y - (1 / RP.scale));
      } else {
        var isHoveredNode = RP.hoveredNode && RP.hoveredNode.routeId === r.id && RP.hoveredNode.nodeId === node.id;
        var nodeR = (isHoveredNode ? 7 : 4.5) / RP.scale;
        ctx.fillStyle = isHoveredNode ? '#ffffff' : nodeColor;
        if (isHoveredNode) {
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 2 / RP.scale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Show node index along the longest path, otherwise just a dot
        var idxLabel = onLongestPath ? String(nodeIdx + 1) : '';
        if (idxLabel) {
          ctx.fillStyle = isHoveredNode ? '#000' : '#fff';
          ctx.font = 'bold ' + fs + 'px -apple-system, sans-serif';
          ctx.strokeStyle = isHoveredNode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 3 / RP.scale;
          ctx.strokeText(idxLabel, node.x + (5 / RP.scale), node.y - (5 / RP.scale));
          ctx.fillText(idxLabel, node.x + (5 / RP.scale), node.y - (5 / RP.scale));
        }

        // Extra-turn indicator pip. Route mode draws real, clickable
        // action markers instead, so this would only double up there.
        var extraTurns = inRouteMode ? [] : (node.extraTurns || []);
        if (extraTurns.length > 0) {
          ctx.save();
          var pipR = 4 / RP.scale;
          var pipY = node.y - nodeR - pipR - 2 / RP.scale;
          ctx.fillStyle = '#ff9944';
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 1 / RP.scale;
          ctx.beginPath();
          ctx.arc(node.x, pipY, pipR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (extraTurns.length > 1) {
            ctx.fillStyle = '#000';
            ctx.font = 'bold ' + (7 / RP.scale) + 'px -apple-system, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.fillText(extraTurns.length, node.x, pipY);
            ctx.textAlign = 'left';
          }
          ctx.restore();
        }

        // Turn angle annotation on hover (sketch mode only — in route mode
        // every turn is drawn permanently as its own marker).
        if (!inRouteMode && isHoveredNode && onLongestPath && nodeIdx > 0 && nodeIdx < longestPath.length - 1) {
          var prevNode = longestPath[nodeIdx - 1];
          var nextNode = longestPath[nodeIdx + 1];
          var inSeg  = RP.findSegBetween ? RP.findSegBetween(r, prevNode.id, node.id) : null;
          var outSeg = RP.findSegBetween ? RP.findSegBetween(r, node.id, nextNode.id) : null;
          if (inSeg && outSeg) {
            var inHeadingDeg  = RP.toDeg ? RP.toDeg(Math.atan2(node.y - prevNode.y, node.x - prevNode.x)) : 0;
            var outHeadingDeg = RP.toDeg ? RP.toDeg(Math.atan2(nextNode.y - node.y, nextNode.x - node.x)) : 0;
            // Account for extra turns that shift prevHeading before the geometric turn
            var extraSum = 0;
            var nodeET = node.extraTurns || [];
            for (var eti3 = 0; eti3 < nodeET.length; eti3++) extraSum += (RP.extraTurnDeg ? RP.extraTurnDeg(nodeET[eti3]) : Number(nodeET[eti3])) || 0;
            var adjustedInDeg = ((inHeadingDeg + extraSum) % 360 + 360) % 360;
            var geomTurnDeg = outHeadingDeg - adjustedInDeg;
            while (geomTurnDeg > 180) geomTurnDeg -= 360;
            while (geomTurnDeg < -180) geomTurnDeg += 360;
            var inRad  = Math.atan2(node.y - prevNode.y, node.x - prevNode.x);
            var outRad = Math.atan2(nextNode.y - node.y, nextNode.x - node.x);
            var arcStart = inRad + Math.PI;
            var arcEnd   = outRad;
            var cwSweep = geomTurnDeg >= 0;
            ctx.save();

            // Draw extra-turn arcs at a smaller radius first (orange)
            if (nodeET.length > 0) {
              var arcR0 = 16 / RP.scale;
              var curHeadRad = inRad; // incoming direction
              ctx.lineWidth = 1.5 / RP.scale;
              for (var eti4 = 0; eti4 < nodeET.length; eti4++) {
                var etV = (RP.extraTurnDeg ? RP.extraTurnDeg(nodeET[eti4]) : Number(nodeET[eti4])) || 0;
                if (Math.abs(etV) < 0.01) continue;
                var etEnd = curHeadRad + etV * Math.PI / 180;
                ctx.strokeStyle = '#ff9944';
                ctx.beginPath();
                ctx.arc(node.x, node.y, arcR0, curHeadRad + Math.PI, etEnd + Math.PI, etV < 0);
                ctx.stroke();
                curHeadRad = etEnd;
                arcR0 += 5 / RP.scale;
              }
            }

            // Geometric turn arc
            var arcR = 22 / RP.scale;
            ctx.strokeStyle = geomTurnDeg === 0 ? '#88ffcc' : (geomTurnDeg > 0 ? '#ffaa44' : '#44aaff');
            ctx.lineWidth = 1.5 / RP.scale;
            ctx.beginPath();
            var adjStart = inRad + Math.PI + extraSum * Math.PI / 180;
            ctx.arc(node.x, node.y, arcR, adjStart, arcEnd, !cwSweep);
            ctx.stroke();

            // Label: show extra turns + geometric turn
            var midArcAngle = adjStart + (cwSweep ? 1 : -1) * (Math.abs(geomTurnDeg * Math.PI / 180) / 2);
            var labR = arcR + 14 / RP.scale;
            var labX = node.x + labR * Math.cos(midArcAngle);
            var labY = node.y + labR * Math.sin(midArcAngle);
            var geomLabel = geomTurnDeg === 0 ? 'straight' : (Math.abs(geomTurnDeg).toFixed(0) + '° ' + (geomTurnDeg > 0 ? 'R' : 'L'));
            var fullLabel = nodeET.length > 0 ? ('[+' + nodeET.length + ' extra] ' + geomLabel) : geomLabel;
            ctx.font = 'bold ' + (11 / RP.scale) + 'px -apple-system, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.lineWidth = 3 / RP.scale;
            ctx.strokeText(fullLabel, labX, labY);
            ctx.fillStyle = geomTurnDeg === 0 ? '#88ffcc' : (geomTurnDeg > 0 ? '#ffaa44' : '#44aaff');
            ctx.fillText(fullLabel, labX, labY);
            ctx.restore();
          }
        }
      }
    }

    // --- Action markers (route mode) ---
    // Turns and checkpoints are objects you can click now, so they get
    // drawn where they happen rather than only appearing on hover.
    if (inRouteMode && r.id === RP.activeRouteId && RP.drawActionMarkers) {
      RP.drawActionMarkers(ctx, r, fs);
    }

    // Route name label at first node
    if (r.nodes.length > 0) {
      var first = r.nodes[0];
      ctx.font = 'bold ' + (fs * 1.1) + 'px -apple-system, sans-serif';
      ctx.fillStyle = isActive ? '#aaddff' : '#6699aa';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3 / RP.scale;
      ctx.strokeText(r.name, first.x, first.y + (18 / RP.scale));
      ctx.fillText(r.name, first.x, first.y + (18 / RP.scale));
    }
  }

  // --- Robot start marker ---
  if (RP.robotConfig.startPos) {
    var sx = RP.robotConfig.startPos.x, sy = RP.robotConfig.startPos.y;
    var heading = RP.robotConfig.startHeading;
    var rad = heading * Math.PI / 180;
    var iconR = 12 / RP.scale;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rad);
    ctx.fillStyle = 'rgba(0,200,255,0.3)';
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2 / RP.scale;
    ctx.beginPath();
    ctx.moveTo(iconR * 1.5, 0);
    ctx.lineTo(-iconR * 0.8, -iconR);
    ctx.lineTo(-iconR * 0.8, iconR);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 1.5 / RP.scale;
    ctx.setLineDash([3 / RP.scale, 3 / RP.scale]);
    ctx.beginPath();
    ctx.moveTo(iconR * 1.5, 0);
    ctx.lineTo(iconR * 4, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.font = 'bold ' + fs + 'px -apple-system, sans-serif';
    ctx.fillStyle = '#00ccff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3 / RP.scale;
    var label = 'Start ' + Math.round(RP.robotConfig.startHeading) + '°';
    ctx.strokeText(label, sx - 5 / RP.scale, sy - iconR * 1.5 - 2 / RP.scale);
    ctx.fillText(label, sx - 5 / RP.scale, sy - iconR * 1.5 - 2 / RP.scale);
  }

  // --- Snap indicator ---
  if (RP.hoverSnapPoint) {
    var hs = RP.hoverSnapPoint;
    ctx.strokeStyle = '#00ffff';
    ctx.fillStyle = 'rgba(0,255,255,0.2)';
    ctx.lineWidth = 1.5 / RP.scale;
    var cr = 6 / RP.scale;
    ctx.beginPath();
    ctx.arc(hs.x, hs.y, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    var ch = 10 / RP.scale;
    ctx.beginPath();
    ctx.moveTo(hs.x - ch, hs.y);
    ctx.lineTo(hs.x + ch, hs.y);
    ctx.moveTo(hs.x, hs.y - ch);
    ctx.lineTo(hs.x, hs.y + ch);
    ctx.stroke();
  }

  // --- Line drawing preview ---
  if (RP.lineDrawing && RP.lineDrawStart) {
    var previewEnd = RP.hoverSnapPoint || RP.lastMouseImg || RP.lineDrawStart;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2 / RP.scale;
    ctx.setLineDash([4 / RP.scale, 4 / RP.scale]);
    ctx.beginPath();
    ctx.moveTo(RP.lineDrawStart.x, RP.lineDrawStart.y);
    ctx.lineTo(previewEnd.x, previewEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }


  // --- All-node magnet hint (route mode only) ---
  // Show magnetic circles around ALL nodes of active route to hint that
  // any of them can be a drag anchor for new segments.
  if (RP.activeTool === 'route' && !RP.lineDrawing && RP.img) {
    var activeRm = RP.getActiveRoute();
    if (activeRm && activeRm.nodes && activeRm.nodes.length > 0) {
      for (var mni = 0; mni < activeRm.nodes.length; mni++) {
        var mn = activeRm.nodes[mni];
        ctx.strokeStyle = 'rgba(68,170,255,0.55)';
        ctx.lineWidth = 1.5 / RP.scale;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(mn.x, mn.y, (RP.ROUTE_CONTINUE_SCREEN_RADIUS || 20) / RP.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  ctx.restore();   // route dimming

  // --- Drive axis marker (robot document) ---
  // The line alone cannot show which END is the turning centre or which
  // way is forwards, and both are exactly what the axis exists to say.
  // So: a ring at the rotation centre and an arrowhead at the nose.
  if (onRobotDoc) {
    var rf = RP.robotFrame();
    if (rf.ok) {
      var ax = rf.ox, ay = rf.oy;
      var len = 26 / RP.scale;
      var hx = ax + rf.cos * len, hy = ay + rf.sin * len;
      ctx.strokeStyle = '#33e0ff';
      ctx.fillStyle = '#33e0ff';
      ctx.lineWidth = 2 / RP.scale;
      // Turning centre.
      ctx.beginPath();
      ctx.arc(ax, ay, 5 / RP.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ax, ay, 1.6 / RP.scale, 0, Math.PI * 2);
      ctx.fill();
      // Forward arrowhead.
      var ah = 7 / RP.scale;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - rf.cos * ah - rf.sin * ah * 0.55, hy - rf.sin * ah + rf.cos * ah * 0.55);
      ctx.lineTo(hx - rf.cos * ah + rf.sin * ah * 0.55, hy - rf.sin * ah - rf.cos * ah * 0.55);
      ctx.closePath();
      ctx.fill();
      if (RP.scale > 0.05) {
        ctx.font = 'bold ' + (10 / RP.scale) + 'px -apple-system, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 3 / RP.scale;
        ctx.strokeText('forward', hx + 5 / RP.scale, hy - 3 / RP.scale);
        ctx.fillStyle = '#33e0ff';
        ctx.fillText('forward', hx + 5 / RP.scale, hy - 3 / RP.scale);
      }
    }
  }

  // Constraint badges and point handles, drawn last so they sit on top.
  if (RP.drawSketchOverlay) RP.drawSketchOverlay(ctx);

  ctx.restore();

  // --- Update status ---
  var info = RP.imgNaturalW ? (RP.imgNaturalW + '×' + RP.imgNaturalH + '  ·  ' + Math.round(RP.scale * 100) + '%') : 'No image';
  RP.dom.imageInfo.textContent = info;
  RP.dom.calibStatus.textContent = RP.calibration ? '✅ ' + RP.calibration.pixelsPerMm.toFixed(4) + ' px/mm' : '';

  RP.updateInstructions();
  RP.updateInfoPanel();
};

// ======================================================================
// ACTION MARKERS (route mode)
// ======================================================================
// A turn is drawn at the junction it happens at, an arc sweeping from the
// incoming heading to the outgoing one, with the angle spelled out. Turns
// that emit nothing (legs in line, or an unknowable heading after a
// teleport) draw a hollow dot so the junction is still clickable.
RP.ACTION_MARKER_R = 9;

RP.drawActionMarkers = function(ctx, route, fs) {
  var sk = RP.sketch;
  if (!sk || !RP.resolveTimeline) return;
  var tl = RP.resolveTimeline(route);
  if (!tl.ok) return;
  var emitted = RP.emittedStepsByAction ? RP.emittedStepsByAction(route) : {};

  var mR = RP.ACTION_MARKER_R / RP.scale;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  for (var i = 0; i < tl.items.length; i++) {
    var it = tl.items[i];
    if (it.kind === 'move') continue;
    var act = it.action;
    var pt = act.pointId != null ? sk.entities[act.pointId] : null;
    if (!pt) continue;
    var selected = RP.selectedActionId === act.id;
    var hovered = !selected && RP.hoverActionId === act.id;

    if (it.kind === 'checkpoint') {
      // The diamond itself is already drawn off the node view; this is the
      // selection ring and the click target. Hover gets the same ring a
      // shade down, so a list row previews what it would select.
      if (selected || hovered) {
        ctx.strokeStyle = selected ? '#ffffff' : RP.HOVER_ROUTE_COLOR;
        ctx.lineWidth = 2 / RP.scale;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, mR + 3 / RP.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }

    var steps = emitted[act.id] || [];
    var deg = null;
    for (var s = 0; s < steps.length; s++) {
      if (steps[s].kind === 'turn' && !steps[s].startLeg) { deg = steps[s].deg; break; }
    }
    var typed = act.angle != null;
    var colour = deg === null ? '#667' : (typed ? '#ff9944' : (deg >= 0 ? '#ffcc44' : '#66ccff'));

    // Sweep arc from the incoming heading to the outgoing one.
    if (deg !== null && it.nextMove && it.nextMove.entryHeading !== null) {
      var endRad = it.nextMove.entryHeading * Math.PI / 180;
      var startRad = endRad - deg * Math.PI / 180;
      ctx.strokeStyle = colour;
      ctx.lineWidth = (selected || hovered ? 2.5 : 1.5) / RP.scale;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, mR + 5 / RP.scale, startRad, endRad, deg < 0);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, mR, 0, Math.PI * 2);
    ctx.fillStyle = deg === null ? 'rgba(30,30,34,0.8)' : 'rgba(20,20,24,0.85)';
    ctx.fill();
    ctx.strokeStyle = selected ? '#ffffff' : (hovered ? RP.HOVER_ROUTE_COLOR : colour);
    ctx.lineWidth = (selected || hovered ? 2.5 : 1.5) / RP.scale;
    ctx.stroke();

    ctx.fillStyle = selected ? '#ffffff' : colour;
    ctx.font = 'bold ' + (11 / RP.scale) + 'px -apple-system, sans-serif';
    ctx.fillText(deg === null ? '·' : (deg >= 0 ? '↻' : '↺'), pt.x, pt.y);

    if (deg !== null && RP.scale > 0.05) {
      var label = Math.abs(deg).toFixed(0) + '°' + (typed ? '*' : '');
      ctx.font = 'bold ' + (10 / RP.scale) + 'px -apple-system, sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 3 / RP.scale;
      var ly = pt.y - mR - 8 / RP.scale;
      ctx.strokeText(label, pt.x, ly);
      ctx.fillStyle = selected ? '#ffffff' : colour;
      ctx.fillText(label, pt.x, ly);
    }
  }
  ctx.restore();
};
