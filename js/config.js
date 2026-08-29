/* ========================================================================
   config.js - Robot config panel, code templates UI
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

// ======================================================================
// ROBOT CONFIG UI
// ======================================================================
function _posNum(raw, fallback) {
  var v = parseFloat(raw);
  return (isFinite(v) && v > 0) ? v : fallback;
}
// Unlike _posNum, a blank/invalid field here means "no override" — it
// must stay null rather than collapse to some fallback number, or a
// per-kind speed left blank could never be told apart from one that
// happens to match the global default.
function _posNumOrNull(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  var v = parseFloat(raw);
  return (isFinite(v) && v > 0) ? v : null;
}
function _strOr(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  return raw.length > 0 ? raw : fallback;
}

RP.updateRobotConfigFromUI = function() {
  RP.robotConfig.frontClearance = _posNum(document.getElementById('robot-fc').value, 50);
  RP.robotConfig.rearClearance  = _posNum(document.getElementById('robot-rc').value, 50);
  // Clearance feeds the wall_align distance constraints; re-solving is
  // what actually moves the geometry.
  if (RP.syncAllWallAligns) RP.syncAllWallAligns();
  if (RP.render) RP.render();
};

RP.updateRobotUI = function() {
  document.getElementById('robot-fc').value = RP.robotConfig.frontClearance || 50;
  document.getElementById('robot-rc').value = RP.robotConfig.rearClearance  || 50;

  // With a body drawn, the clearances are measured from it and the manual
  // fields no longer feed anything — so say so rather than leaving two
  // editable numbers that silently do nothing.
  var ext = RP.robotExtentsMm ? RP.robotExtentsMm() : null;
  var derived = document.getElementById('robot-derived');
  var fc = document.getElementById('robot-fc');
  var rc = document.getElementById('robot-rc');
  var hint = document.getElementById('robot-clearance-hint');
  if (derived) {
    derived.style.display = ext ? '' : 'none';
    if (ext) {
      derived.innerHTML = 'Measured from the robot body: <b>' + ext.front.toFixed(1) +
        ' mm</b> ahead of the turning centre, <b>' + ext.rear.toFixed(1) +
        ' mm</b> behind. Body ' + ext.length.toFixed(1) + ' × ' + ext.width.toFixed(1) + ' mm.';
    }
  }
  if (fc) fc.disabled = !!ext;
  if (rc) rc.disabled = !!ext;
  if (hint) {
    hint.textContent = ext
      ? 'Taken from the drawn body, so they cannot disagree with it. Delete the robot\'s drive axis to type them by hand again.'
      : 'How far the robot stands off a wall when it aligns. Draw a robot body (Sketch \u2192 Robot) and these are measured from it instead.';
  }
  document.getElementById('robot-start-label').textContent = RP.robotConfig.startPos
    ? '(' + RP.robotConfig.startPos.x.toFixed(1) + ', ' + RP.robotConfig.startPos.y.toFixed(1) + ')'
    : 'not set';
  document.getElementById('robot-heading-label').textContent = Math.round(RP.robotConfig.startHeading) + '°';
};

// ======================================================================
// CODE CONFIG MIGRATION
// ======================================================================
RP.ensureCodeConfig = function() {
  var cfg = RP.codeConfig;
  if (!cfg) { RP.codeConfig = RP.freshCodeConfig(); cfg = RP.codeConfig; }

  // Migrate an old save's split left/right turn templates onto the one
  // unified turnTemplate field — unrelated to the table below, since
  // those two fields no longer exist at all.
  if (!cfg.turnTemplate && (cfg.turnRightTemplate || cfg.turnLeftTemplate)) {
    cfg.turnTemplate = RP.DEFAULT_CODE_CONFIG_VALUES.turnTemplate;
  }
  delete cfg.turnRightTemplate; delete cfg.turnLeftTemplate;

  // Backfill anything an old save file never had, one field at a time per
  // RP.CODE_CONFIG_FIELDS. 'blank'/'posNumOrNull' fields treat their own
  // blank/null as a real, meaningful value (not "missing"), so those only
  // backfill when the key is absent entirely; the rest backfill whenever
  // they're falsy, same as an empty template string would be.
  RP.CODE_CONFIG_FIELDS.forEach(function(f) {
    if (f.kind === 'blank' || f.kind === 'posNumOrNull') {
      if (cfg[f.key] === undefined) cfg[f.key] = f.default;
    } else if (!cfg[f.key]) {
      cfg[f.key] = f.default;
    }
  });
};

// ======================================================================
// CODE CONFIG UI
// ======================================================================
// Reads every field in RP.CODE_CONFIG_FIELDS from its <input> straight
// into RP.codeConfig. A new field needs a row in that table (core.js)
// and an <input id> in index.html — nothing here changes.
RP.updateCodeConfigFromUI = function() {
  function _el(id) { var e = document.getElementById(id); return e && e.value !== undefined ? e.value : ''; }
  RP.CODE_CONFIG_FIELDS.forEach(function(f) {
    var raw = _el(f.id);
    if (f.kind === 'text') RP.codeConfig[f.key] = _strOr(raw, f.default);
    else if (f.kind === 'blank') RP.codeConfig[f.key] = raw;
    else if (f.kind === 'posNum') RP.codeConfig[f.key] = _posNum(raw, f.default);
    else RP.codeConfig[f.key] = _posNumOrNull(raw); // posNumOrNull
  });
  if (RP.render) RP.render();
};

// The inverse: writes RP.codeConfig back into the panel's <input>s.
RP.updateCodeConfigUI = function() {
  RP.CODE_CONFIG_FIELDS.forEach(function(f) {
    var el = document.getElementById(f.id);
    if (!el) return;
    var v = RP.codeConfig[f.key];
    // 'blank'/'posNumOrNull' show a genuinely blank field for null/''
    // rather than falling back to `default` — a blank field and one
    // explicitly set to match the default must not look identical.
    if (f.kind === 'blank' || f.kind === 'posNumOrNull') el.value = (v != null) ? v : '';
    else el.value = (v != null && v !== '') ? v : f.default;
  });
};

