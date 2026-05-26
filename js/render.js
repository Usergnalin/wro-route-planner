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

  // Draw image
  ctx.save();
  ctx.translate(RP.offsetX, RP.offsetY);
  ctx.scale(RP.scale, RP.scale);
  ctx.drawImage(RP.img, 0, 0);
  ctx.restore();

  // Draw in image coordinate space
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
    var color = '#44ff44';
    var width = 2 / RP.scale;
    var dash = [6 / RP.scale, 4 / RP.scale];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
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

  // --- Draw routes ---
  for (var ri = 0; ri < RP.routes.length; ri++) {
    var r = RP.routes[ri];
    if (!r.visible || r.waypoints.length < 2) continue;
    RP.ensureSegmentDirections(r);
    RP.ensureSegmentModes(r);

    var isActive = r.id === RP.activeRouteId;
    var baseColor = isActive ? '#44aaff' : '#4488cc';
    var revColor  = isActive ? '#ff8844' : '#cc6633';
    var teleColor = '#ffaa00';
    var ltColor   = isActive ? '#44ff88' : '#33cc66';
    var selColor  = '#ffd966';

    ctx.setLineDash([]);

    for (var si = 0; si < r.waypoints.length - 1; si++) {
      var a = r.waypoints[si], b = r.waypoints[si + 1];
      var isBack = r.segmentDirections[si] === RP.SEG_BACKWARD;
      var mode = r.segmentModes[si] || RP.SEG_MODE_NORMAL;
      var isTeleport = mode === RP.SEG_MODE_TELEPORT;
      var isLineTrace = mode === RP.SEG_MODE_LINETRACE_DIST || mode === RP.SEG_MODE_LINETRACE_JUNCT;
      var isSel  = RP.selectedSegment && RP.selectedSegment.routeId === r.id && RP.selectedSegment.segIdx === si;
      var segColor = isTeleport ? teleColor : (isLineTrace ? ltColor : (isBack ? revColor : baseColor));

      // Selected segment: draw a thick highlight halo underneath.
      if (isSel) {
        ctx.strokeStyle = selColor;
        ctx.lineWidth = (isActive ? 6 : 5) / RP.scale;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      ctx.strokeStyle = segColor;
      ctx.fillStyle = segColor;
      ctx.lineWidth = isActive ? 3 / RP.scale : 2 / RP.scale;
      // Backward and teleport segments use different dash patterns.
      if (isTeleport) ctx.setLineDash([2 / RP.scale, 6 / RP.scale]);
      else if (isBack) ctx.setLineDash([8 / RP.scale, 5 / RP.scale]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Teleport: draw lightning-bolt zigzag mid-segment + label. No arrow.
      if (isTeleport) {
        if (RP.scale > 0.05) {
          var segMidX = (a.x + b.x) / 2, segMidY = (a.y + b.y) / 2;
          var segAng = RP.angleRad(a.x, a.y, b.x, b.y);
          var perpOff = 8 / RP.scale;
          var zigX = segMidX + Math.cos(segAng + Math.PI / 2) * perpOff;
          var zigY = segMidY + Math.sin(segAng + Math.PI / 2) * perpOff;
          ctx.fillStyle = segColor;
          ctx.font = 'bold ' + (13 / RP.scale) + 'px -apple-system, sans-serif';
          ctx.fillText('\u26A1', zigX, zigY + 4 / RP.scale);
        }
      } else if (RP.scale > 0.05) {
        var mx2 = (a.x + b.x) / 2, my2 = (a.y + b.y) / 2;
        // Arrow points in the direction of TRAVEL. For backward, that's
        // still a -> b geometrically, but we flip it to b -> a to
        // visually communicate "chassis-front points this way".
        var ang = isBack
          ? RP.angleRad(b.x, b.y, a.x, a.y)
          : RP.angleRad(a.x, a.y, b.x, b.y);
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
          var labOff = 18 / RP.scale;
          // Place "(rev)" perpendicular-ish to the segment, biased away
          // from the arrow tip.
          var perpAng = ang + Math.PI / 2;
          var lx = mx2 + labOff * Math.cos(perpAng);
          var ly = my2 + labOff * Math.sin(perpAng);
          ctx.strokeText('(rev)', lx, ly);
          ctx.fillText('(rev)', lx, ly);
          ctx.restore();
        }
      }
    }

    // Restore the per-route style for waypoint dots below.
    ctx.strokeStyle = baseColor;
    ctx.fillStyle = baseColor;
    ctx.lineWidth = isActive ? 3 / RP.scale : 2 / RP.scale;

    for (var wi = 0; wi < r.waypoints.length; wi++) {
      var wp = r.waypoints[wi];
      var wpR = 4.5 / RP.scale;

      ctx.beginPath();
      ctx.arc(wp.x, wp.y, wpR, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#44aaff' : '#4488cc';
      ctx.fill();

      var idxLabel = '' + (wi + 1);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + fs + 'px -apple-system, sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3 / RP.scale;
      ctx.strokeText(idxLabel, wp.x + (5 / RP.scale), wp.y - (5 / RP.scale));
      ctx.fillText(idxLabel, wp.x + (5 / RP.scale), wp.y - (5 / RP.scale));
    }

    if (r.waypoints.length > 0) {
      var first = r.waypoints[0];
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
    var label = 'Start ' + Math.round(RP.robotConfig.startHeading) + '\u00b0';
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

  // (Route standby preview removed: the user has to explicitly
  // click+drag from the last waypoint to extend a route. No
  // auto-rubber-band line from last waypoint to cursor.)

  // --- Last-waypoint magnet hint (route mode only) ---
  // When in route mode and not currently drawing, give a subtle visual
  // cue that the last waypoint is the magnetic anchor where the next
  // segment must start. Helps users discover the gesture without
  // pretending a line is being drawn.
  if (RP.activeTool === 'route' && !RP.lineDrawing && RP.img) {
    var activeRm = RP.getActiveRoute();
    if (activeRm && activeRm.waypoints.length > 0 && RP.activeRouteId === activeRm.id) {
      var lastWpM = activeRm.waypoints[activeRm.waypoints.length - 1];
      ctx.strokeStyle = 'rgba(68,170,255,0.55)';
      ctx.lineWidth = 1.5 / RP.scale;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(lastWpM.x, lastWpM.y, (RP.ROUTE_CONTINUE_SCREEN_RADIUS || 20) / RP.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();

  // --- Update status ---
  var info = RP.imgNaturalW ? (RP.imgNaturalW + '\u00d7' + RP.imgNaturalH + '  \u00b7  ' + Math.round(RP.scale * 100) + '%') : 'No image';
  RP.dom.imageInfo.textContent = info;
  RP.dom.calibStatus.textContent = RP.calibration ? '\u2705 ' + RP.calibration.pixelsPerMm.toFixed(4) + ' px/mm' : '';

  RP.updateInstructions();
  RP.updateInfoPanel();
};
