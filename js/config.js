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
  RP.robotConfig.frontClearance = _posNum(document.getElementById('robot-fc').value, 50);
  RP.robotConfig.rearClearance  = _posNum(document.getElementById('robot-rc').value, 50);
  // Re-snap any wall_align segments whose clearance offset just changed
  if (RP.reapplyAllWallAlignSnaps) RP.reapplyAllWallAlignSnaps();
};

RP.updateRobotUI = function() {
  document.getElementById('robot-w').value = RP.robotConfig.width;
  document.getElementById('robot-l').value = RP.robotConfig.length;
  document.getElementById('robot-wb').value = RP.robotConfig.wheelbase;
  document.getElementById('robot-fc').value = RP.robotConfig.frontClearance || 50;
  document.getElementById('robot-rc').value = RP.robotConfig.rearClearance  || 50;
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
  if (!cfg.commentPrefix) cfg.commentPrefix = d.commentPrefix || '#';
  if (!cfg.forwardTemplate) cfg.forwardTemplate = d.forwardTemplate || 'robot.move_distance(distance={distance}, speed={speed})';
  if (!cfg.turnTemplate) cfg.turnTemplate = d.turnTemplate || 'robot.turn_arc(angle={angle}, speed={speed})';
  if (!cfg.wallAlignTemplate) cfg.wallAlignTemplate = d.wallAlignTemplate || 'robot.wall_align(reversed={reversed}, speed={speed})';
  // Migrate old split templates
  if (!cfg.turnTemplate && (cfg.turnRightTemplate || cfg.turnLeftTemplate)) cfg.turnTemplate = 'robot.turn_arc(angle={angle}, speed={speed})';
  delete cfg.turnRightTemplate; delete cfg.turnLeftTemplate;
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
  RP.codeConfig.turnTemplate       = _strOr(_el('code-turn'),       d.turnTemplate       || 'turn({angle}, {speed})');
  RP.codeConfig.wallAlignTemplate  = _strOr(_el('code-wall-align'), d.wallAlignTemplate  || 'wall_align({reversed}, {speed})');
  RP.codeConfig.lineTraceDistTemplate = _strOr(_el('code-lt-dist'), d.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed})');
  RP.codeConfig.lineTraceJunctTemplate = _strOr(_el('code-lt-junct'), d.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed})');
  RP.codeConfig.defaultSpeed = _posNum(_el('code-speed'), d.defaultSpeed || 200);
  RP.codeConfig.defaultUnit = _strOr(_el('code-unit'), d.defaultUnit || 'mm');
  if (RP.render) RP.render();
};

RP.updateCodeConfigUI = function() {
  document.getElementById('code-comment').value = RP.codeConfig.commentPrefix;
  document.getElementById('code-forward').value = RP.codeConfig.forwardTemplate;
  document.getElementById('code-turn').value       = RP.codeConfig.turnTemplate      || 'turn({angle}, {speed})';
  document.getElementById('code-wall-align').value = RP.codeConfig.wallAlignTemplate || 'wall_align({reversed}, {speed})';
  document.getElementById('code-lt-dist').value = RP.codeConfig.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed})';
  document.getElementById('code-lt-junct').value = RP.codeConfig.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed})';
  document.getElementById('code-speed').value = RP.codeConfig.defaultSpeed;
  document.getElementById('code-unit').value = RP.codeConfig.defaultUnit;
};

// ======================================================================
// TAB SWITCHING (no-op - tabs removed, kept for call-site safety)
// ======================================================================
RP.switchTab = function() {};
