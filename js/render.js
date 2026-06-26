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

  if (!RP.img) return;

  ctx.save();
  ctx.translate(RP.offsetX, RP.offsetY);
  ctx.scale(RP.scale, RP.scale);
  ctx.drawImage(RP.img, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(RP.offsetX, RP.offsetY);
  ctx.scale(RP.scale, RP.scale);

  var fs = 14 / RP.scale;
  ctx.font = fs + 'px -apple-system, sans-serif';
  ctx.lineCap = 'round';
  ctx.textBaseline = 'bottom';

  // --- Draw construction lines ---
  for (var li = 0; li < RP.lines.length; li++) {
    var l = RP.lines[li];
    if (l.visible === false) continue;
    var isSel = RP.selectedLineId === l.id;
    var color = isSel ? '#ffee44' : '#44ff44';
    var width = (isSel ? 3 : 2) / RP.scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([6 / RP.scale, 4 / RP.scale]);
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (l.label) {
      var mx = (l.x1 + l.x2) / 2;
      var my = (l.y1 + l.y2) / 2;
      ctx.save();
      ctx.lineWidth = 3 / RP.scale;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(l.label, mx, my - 4 / RP.scale);
      ctx.fillText(l.label, mx, my - 4 / RP.scale);
      ctx.restore();
    }
  }

  // --- Draw routes (graph model) ---
  for (var ri = 0; ri < RP.routes.length; ri++) {
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
      var na = RP.findNode(r, seg.fromNodeId);
      var nb = RP.findNode(r, seg.toNodeId);
      if (!na || !nb) continue;

      var isBack = seg.direction === RP.SEG_BACKWARD;
      var sMode = seg.mode || RP.SEG_MODE_NORMAL;
      var isTeleport  = sMode === RP.SEG_MODE_TELEPORT;
      var isLineTrace = sMode === RP.SEG_MODE_LINETRACE_DIST || sMode === RP.SEG_MODE_LINETRACE_JUNCT;
      var isSegSel = RP.selectedSegment && RP.selectedSegment.routeId === r.id && RP.selectedSegment.segId === seg.id;
      var onPath = pathSegIds[seg.id];
      var segColor = (hasLongestPath && !onPath) ? dimColor
        : (isTeleport ? teleColor : (isLineTrace ? ltColor : (isBack ? revColor : baseColor)));

      if (isSegSel) {
        ctx.strokeStyle = selColor;
        ctx.lineWidth = (isActive ? 6 : 5) / RP.scale;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      ctx.strokeStyle = segColor;
      ctx.fillStyle = segColor;
      ctx.lineWidth = isActive ? 3 / RP.scale : 2 / RP.scale;
      if (isTeleport) ctx.setLineDash([2 / RP.scale, 6 / RP.scale]);
      else if (isBack) ctx.setLineDash([8 / RP.scale, 5 / RP.scale]);
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (hasLongestPath && !onPath) continue; // skip decorations for off-path segs

      if (isTeleport) {
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
        var nodeR = 4.5 / RP.scale;
        ctx.fillStyle = nodeColor;
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeR, 0, Math.PI * 2);
        ctx.fill();

        // Show node index along the longest path, otherwise just a dot
        var idxLabel = onLongestPath ? String(nodeIdx + 1) : '';
        if (idxLabel) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold ' + fs + 'px -apple-system, sans-serif';
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 3 / RP.scale;
          ctx.strokeText(idxLabel, node.x + (5 / RP.scale), node.y - (5 / RP.scale));
          ctx.fillText(idxLabel, node.x + (5 / RP.scale), node.y - (5 / RP.scale));
        }
      }
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

  ctx.restore();

  // --- Update status ---
  var info = RP.imgNaturalW ? (RP.imgNaturalW + '×' + RP.imgNaturalH + '  ·  ' + Math.round(RP.scale * 100) + '%') : 'No image';
  RP.dom.imageInfo.textContent = info;
  RP.dom.calibStatus.textContent = RP.calibration ? '✅ ' + RP.calibration.pixelsPerMm.toFixed(4) + ' px/mm' : '';

  RP.updateInstructions();
  RP.updateInfoPanel();
};
