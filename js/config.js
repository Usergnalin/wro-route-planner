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
function _strOr(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  return raw.length > 0 ? raw : fallback;
}

RP.updateRobotConfigFromUI = function() {
  RP.robotConfig.width = _posNum(document.getElementById('robot-w').value, 250);
  RP.robotConfig.length = _posNum(document.getElementById('robot-l').value, 250);
  RP.robotConfig.wheelbase = _posNum(document.getElementById('robot-wb').value, 180);
};

RP.updateRobotUI = function() {
  document.getElementById('robot-w').value = RP.robotConfig.width;
  document.getElementById('robot-l').value = RP.robotConfig.length;
  document.getElementById('robot-wb').value = RP.robotConfig.wheelbase;
  document.getElementById('robot-start-label').textContent = RP.robotConfig.startPos
    ? '(' + RP.robotConfig.startPos.x.toFixed(1) + ', ' + RP.robotConfig.startPos.y.toFixed(1) + ')'
    : 'not set';
  document.getElementById('robot-heading-label').textContent = Math.round(RP.robotConfig.startHeading) + '°';
};

// ======================================================================
// CODE CONFIG MIGRATION
// ======================================================================
RP.ensureCodeConfig = function() {
  var d = RP.DEFAULT_CODE_CONFIG_VALUES || {};
  var cfg = RP.codeConfig;
  if (!cfg) { RP.codeConfig = RP.freshCodeConfig(); cfg = RP.codeConfig; }
  if (!cfg.commentPrefix) cfg.commentPrefix = d.commentPrefix || '//';
  if (!cfg.forwardTemplate) cfg.forwardTemplate = d.forwardTemplate || 'move({distance}, {speed})';
  if (!cfg.turnRightTemplate) cfg.turnRightTemplate = d.turnRightTemplate || 'turn_right({angle}, {speed})';
  if (!cfg.turnLeftTemplate) cfg.turnLeftTemplate = d.turnLeftTemplate || 'turn_left({angle}, {speed})';
  if (!cfg.lineTraceDistTemplate) cfg.lineTraceDistTemplate = d.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed})';
  if (!cfg.lineTraceJunctTemplate) cfg.lineTraceJunctTemplate = d.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed})';
  if (cfg.defaultSpeed === undefined || cfg.defaultSpeed === null) cfg.defaultSpeed = d.defaultSpeed || 200;
  if (!cfg.defaultUnit) cfg.defaultUnit = d.defaultUnit || 'mm';
};

// ======================================================================
// CODE CONFIG UI
// ======================================================================
RP.updateCodeConfigFromUI = function() {
  var d = RP.DEFAULT_CODE_CONFIG_VALUES || {};
  function _el(id) { var e = document.getElementById(id); return e && e.value !== undefined ? e.value : ''; }
  RP.codeConfig.commentPrefix = _strOr(_el('code-comment'), d.commentPrefix || '//');
  RP.codeConfig.forwardTemplate = _strOr(_el('code-forward'), d.forwardTemplate || 'move({distance}, {speed})');
  RP.codeConfig.turnRightTemplate = _strOr(_el('code-turn-r'), d.turnRightTemplate || 'turn_right({angle}, {speed})');
  RP.codeConfig.turnLeftTemplate = _strOr(_el('code-turn-l'), d.turnLeftTemplate || 'turn_left({angle}, {speed})');
  RP.codeConfig.lineTraceDistTemplate = _strOr(_el('code-lt-dist'), d.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed})');
  RP.codeConfig.lineTraceJunctTemplate = _strOr(_el('code-lt-junct'), d.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed})');
  RP.codeConfig.defaultSpeed = _posNum(_el('code-speed'), d.defaultSpeed || 200);
  RP.codeConfig.defaultUnit = _strOr(_el('code-unit'), d.defaultUnit || 'mm');
  if (RP.render) RP.render();
};

RP.updateCodeConfigUI = function() {
  document.getElementById('code-comment').value = RP.codeConfig.commentPrefix;
  document.getElementById('code-forward').value = RP.codeConfig.forwardTemplate;
  document.getElementById('code-turn-r').value = RP.codeConfig.turnRightTemplate;
  document.getElementById('code-turn-l').value = RP.codeConfig.turnLeftTemplate;
  document.getElementById('code-lt-dist').value = RP.codeConfig.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed})';
  document.getElementById('code-lt-junct').value = RP.codeConfig.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed})';
  document.getElementById('code-speed').value = RP.codeConfig.defaultSpeed;
  document.getElementById('code-unit').value = RP.codeConfig.defaultUnit;
};

// ======================================================================
// TAB SWITCHING (no-op - tabs removed, kept for call-site safety)
// ======================================================================
RP.switchTab = function() {};
