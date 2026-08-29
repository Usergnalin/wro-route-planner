/* ========================================================================
   sim-ui.js - Surfacing the collision sweep.

   The only part of the simulator that touches the DOM. Everything it
   shows comes from RP.simCollisions(), which is pure — so what is drawn
   here can never disagree with what the model computed.

   The result is CACHED in RP.simResult and recomputed only when the route,
   the obstacles or the robot actually change. Rendering reads the cache;
   it never re-runs the sweep, because render() is called on every hover
   and every pan.
   ======================================================================== */
var RP = window.RP || {};

RP.simResult = null;

// Recompute and cache. Cheap enough to call on any edit — a 102-action
// route with 20 obstacles is ~20ms — but not cheap enough for render().
RP.runSim = function() {
  if (RP.editMode !== 'route') { RP.simResult = null; return null; }
  RP.simResult = RP.simCollisions(RP.getActiveRoute());
  return RP.simResult;
};

RP.updateSimPanel = function() {
  var section = document.getElementById('sim-section');
  if (!section) return;
  var show = RP.editMode === 'route';
  section.style.display = show ? '' : 'none';
  if (!show) return;

  var statusEl = document.getElementById('sim-status');
  var hitsEl = document.getElementById('sim-hits');
  var hintEl = document.getElementById('sim-hint');
  if (!statusEl || !hitsEl) return;
  hitsEl.innerHTML = '';

  var res = RP.simResult;
  if (!res || !res.ok) {
    // Not a failure to hide — "no robot drawn" is the normal state until
    // one is, and saying so is more use than an empty panel.
    statusEl.textContent = res ? ('Not run — ' + res.reason) : 'Not run';
    statusEl.style.color = '#888';
    if (hintEl) {
      hintEl.textContent = (res && /robot body/.test(res.reason))
        ? 'Draw the robot (Sketch → Robot) and give it a drive axis to check for collisions.'
        : '';
    }
    return;
  }

  var n = res.hits.length;
  statusEl.textContent = n === 0 ? 'No collisions' : (n + (n === 1 ? ' collision' : ' collisions'));
  statusEl.style.color = n === 0 ? '#44ff44' : '#ff4444';
  if (hintEl) {
    hintEl.textContent = n === 0
      ? 'Robot body swept along the whole route, including turns in place.'
      : 'Click one to jump to it. Warnings only — nothing is blocked.';
  }
  if (n === 0) return;

  var ppm = (RP.calibration && RP.calibration.pixelsPerMm) || 1;
  for (var i = 0; i < res.hits.length; i++) {
    (function(hit, idx) {
      var row = document.createElement('div');
      row.className = 'layer-item' + (RP.simSelectedHit === idx ? ' active' : '');

      var glyph = document.createElement('span');
      glyph.className = 'constraint-glyph';
      glyph.textContent = '⚠';
      glyph.style.color = '#ff4444';

      var lbl = document.createElement('span');
      lbl.className = 'layer-item-label';
      // Distance along the route is what makes a hit findable — "which
      // move" alone is ambiguous when a move is a metre long.
      var names = hit.obstacleIds.map(function(id) {
        var m = RP.constructionMeta[id];
        return (m && m.label) || ('#' + id);
      }).join(', ');
      lbl.textContent = Math.round(hit.distMm) + ' mm in · ' + names;
      lbl.title = lbl.textContent + ' (' + hit.poses + ' samples in contact)';

      row.appendChild(glyph);
      row.appendChild(lbl);
      row.onclick = function() {
        RP.simSelectedHit = idx;
        // Selecting the move it happened on ties the warning back to the
        // thing you would edit to fix it.
        if (hit.actionId != null) RP.selectedActionId = hit.actionId;
        RP.refreshRouteUI();
      };
      row.onmouseenter = function() { RP.simHoverHit = idx; RP.render(); };
      row.onmouseleave = function() {
        if (RP.simHoverHit === idx) { RP.simHoverHit = null; RP.render(); }
      };
      hitsEl.appendChild(row);
    })(res.hits[i], i);
  }
};

// Canvas overlay: the body drawn where it collided. Reads the cache only.
RP.drawSimOverlay = function(ctx) {
  var res = RP.simResult;
  if (!res || !res.ok || !res.hits.length || RP.editMode !== 'route') return;
  if (RP.activeDocId !== RP.DOC_MAT) return;

  for (var i = 0; i < res.hits.length; i++) {
    var hit = res.hits[i];
    var focused = (RP.simSelectedHit === i) || (RP.simHoverHit === i);
    var poly = RP.footprintAt(res.hull, hit);

    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (var j = 1; j < poly.length; j++) ctx.lineTo(poly[j].x, poly[j].y);
    ctx.closePath();
    // Only the focused hit is filled. A robot body is a big shape at mat
    // scale, and several translucent fills at once read as a smear rather
    // than as distinct places to look at.
    if (focused) { ctx.fillStyle = 'rgba(255,60,60,0.3)'; ctx.fill(); }
    ctx.strokeStyle = focused ? '#ff4444' : 'rgba(255,68,68,0.75)';
    ctx.lineWidth = (focused ? 3 : 1.5) / RP.scale;
    ctx.stroke();

    // A ring at the turning centre, so the marker is findable when the
    // body outline is off-screen or tiny.
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, (focused ? 9 : 6) / RP.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
};
