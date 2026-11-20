/* ========================================================================
   config.js - Robot config panel, code templates UI
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

// ======================================================================
// ROBOT CONFIG UI
// ======================================================================
function _strOr(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  return raw.length > 0 ? raw : fallback;
}

RP.updateRobotConfigFromUI = function() {
  // Zero is a meaningful value here (model off), so it cannot fall back
  // to a default the way a blank text field does.
  var dRaw = parseFloat(document.getElementById('robot-drift').value);
  RP.robotConfig.driftPerMm = (isFinite(dRaw) && dRaw >= 0) ? dRaw : 0;
  if (RP.render) RP.render();
};

RP.updateRobotUI = function() {
  var dEl = document.getElementById('robot-drift');
  if (dEl) dEl.value = RP.robotConfig.driftPerMm || 0;

  // The robot body is still worth reporting even though nothing stands off
  // a wall automatically any more: it is what the collision sweep uses, and
  // it is how you check the drive axis is where you think it is.
  var ext = RP.robotExtentsMm ? RP.robotExtentsMm() : null;
  var derived = document.getElementById('robot-derived');
  if (derived) {
    derived.style.display = ext ? '' : 'none';
    if (ext) {
      derived.innerHTML = 'Measured from the robot body: <b>' + ext.front.toFixed(1) +
        ' mm</b> ahead of the turning centre, <b>' + ext.rear.toFixed(1) +
        ' mm</b> behind. Body ' + ext.length.toFixed(1) + ' × ' + ext.width.toFixed(1) + ' mm.';
    }
  }
  document.getElementById('robot-start-label').textContent = RP.robotConfig.startPos
    ? '(' + RP.robotConfig.startPos.x.toFixed(1) + ', ' + RP.robotConfig.startPos.y.toFixed(1) + ')'
    : 'not set';
  document.getElementById('robot-heading-label').textContent = Math.round(RP.robotConfig.startHeading) + '°';
};

// ======================================================================
// CODE CONFIG MIGRATION
// ======================================================================
// Brings any codeConfig up to the current shape: a pre-parameter save is
// converted (RP.migrateCodeConfig), then anything still missing — a
// project-wide field, a whole movement, one of a movement's template
// variants — is backfilled from the defaults.
RP.ensureCodeConfig = function() {
  var cfg = RP.codeConfig;
  if (!cfg) cfg = RP.freshCodeConfig();
  if (!cfg.movements) cfg = RP.migrateCodeConfig(cfg);
  RP.CODE_CONFIG_FIELDS.forEach(function(f) {
    if (cfg[f.key] == null || cfg[f.key] === '') cfg[f.key] = f.default;
    if (f.kind === 'choice' && f.options.indexOf(cfg[f.key]) < 0) cfg[f.key] = f.default;
  });
  RP.MOVEMENTS.forEach(function(m) {
    var def = RP.DEFAULT_MOVEMENTS[m.key];
    var mc = cfg.movements[m.key];
    if (!mc) { cfg.movements[m.key] = JSON.parse(JSON.stringify(def)); return; }
    m.templates.forEach(function(t) {
      if (mc[t.key] == null) mc[t.key] = t.fallback ? '' : def[t.key];
    });
    if (!Array.isArray(mc.params)) mc.params = [];
  });
  RP.codeConfig = cfg;
};

// ======================================================================
// CODE CONFIG UI — the project-wide fields. Movements and their
// parameters have their own editor (js/ui/params-ui.js).
// ======================================================================
RP.updateCodeConfigFromUI = function() {
  RP.CODE_CONFIG_FIELDS.forEach(function(f) {
    var el = document.getElementById(f.id);
    if (!el || el.value === undefined) return;
    var raw = el.value;
    if (f.kind === 'choice') RP.codeConfig[f.key] = f.options.indexOf(raw) >= 0 ? raw : f.default;
    else RP.codeConfig[f.key] = _strOr(raw, f.default);
  });
  if (RP.render) RP.render();
};

RP.updateCodeConfigUI = function() {
  RP.CODE_CONFIG_FIELDS.forEach(function(f) {
    var el = document.getElementById(f.id);
    if (!el) return;
    var v = RP.codeConfig[f.key];
    el.value = (v != null && v !== '') ? v : f.default;
  });
  if (RP.renderMovementEditor) RP.renderMovementEditor();
};
