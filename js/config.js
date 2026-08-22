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
  if (!cfg.forwardTemplate) cfg.forwardTemplate = d.forwardTemplate || 'robot.move_distance({distance}, power={speed}{extra_args})';
  if (!cfg.turnTemplate) cfg.turnTemplate = d.turnTemplate || 'robot.turn_in_place({angle}, power={speed}{extra_args})';
  if (!cfg.turnArcTemplate) cfg.turnArcTemplate = d.turnArcTemplate || 'robot.turn_arc(angle={angle}, speed={speed}, radius={radius})';
  if (!cfg.wallAlignTemplate) cfg.wallAlignTemplate = d.wallAlignTemplate || 'robot.wall_align(reversed={reversed}, power={speed}, expected_distance={expected_distance}{extra_args})';
  // Migrate old split templates
  if (!cfg.turnTemplate && (cfg.turnRightTemplate || cfg.turnLeftTemplate)) cfg.turnTemplate = 'robot.turn_in_place({angle}, power={speed}{extra_args})';
  delete cfg.turnRightTemplate; delete cfg.turnLeftTemplate;
  if (!cfg.lineTraceDistTemplate) cfg.lineTraceDistTemplate = d.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed}{extra_args})';
  if (!cfg.lineTraceJunctTemplate) cfg.lineTraceJunctTemplate = d.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed}{extra_args})';
  if (!cfg.checkpointTemplate) cfg.checkpointTemplate = d.checkpointTemplate || 'if callable({name}): {name}({extra_args})';
  // Blank is a meaningful value here, so only backfill when absent.
  if (cfg.turnPivotLeftTemplate === undefined) cfg.turnPivotLeftTemplate = d.turnPivotLeftTemplate || '';
  if (cfg.turnPivotRightTemplate === undefined) cfg.turnPivotRightTemplate = d.turnPivotRightTemplate || '';
  if (cfg.defaultSpeed === undefined || cfg.defaultSpeed === null) cfg.defaultSpeed = d.defaultSpeed || 200;
  // null is meaningful here too — "no override, use defaultSpeed" — so
  // only backfill when the key is missing entirely (an old save file).
  if (cfg.defaultSpeedForward === undefined) cfg.defaultSpeedForward = d.defaultSpeedForward != null ? d.defaultSpeedForward : null;
  if (cfg.defaultSpeedTurn === undefined) cfg.defaultSpeedTurn = d.defaultSpeedTurn != null ? d.defaultSpeedTurn : null;
  if (cfg.defaultSpeedArc === undefined) cfg.defaultSpeedArc = d.defaultSpeedArc != null ? d.defaultSpeedArc : null;
  if (cfg.defaultSpeedWallAlign === undefined) cfg.defaultSpeedWallAlign = d.defaultSpeedWallAlign != null ? d.defaultSpeedWallAlign : null;
  if (cfg.defaultSpeedLineTraceDist === undefined) cfg.defaultSpeedLineTraceDist = d.defaultSpeedLineTraceDist != null ? d.defaultSpeedLineTraceDist : null;
  if (cfg.defaultSpeedLineTraceJunct === undefined) cfg.defaultSpeedLineTraceJunct = d.defaultSpeedLineTraceJunct != null ? d.defaultSpeedLineTraceJunct : null;
  if (!cfg.defaultUnit) cfg.defaultUnit = d.defaultUnit || 'mm';
};

// ======================================================================
// CODE CONFIG UI
// ======================================================================
RP.updateCodeConfigFromUI = function() {
  var d = RP.DEFAULT_CODE_CONFIG_VALUES || {};
  function _el(id) { var e = document.getElementById(id); return e && e.value !== undefined ? e.value : ''; }
  RP.codeConfig.commentPrefix = _strOr(_el('code-comment'), d.commentPrefix || '//');
  RP.codeConfig.forwardTemplate = _strOr(_el('code-forward'), d.forwardTemplate || 'robot.move_distance({distance}, power={speed}{extra_args})');
  RP.codeConfig.turnTemplate       = _strOr(_el('code-turn'),       d.turnTemplate       || 'robot.turn_in_place({angle}, power={speed}{extra_args})');
  // Pivot templates are deliberately allowed to be blank — that is how a
  // style says "same as a plain turn", so _strOr's default must not apply.
  RP.codeConfig.turnPivotLeftTemplate  = _el('code-turn-pivot-l');
  RP.codeConfig.turnPivotRightTemplate = _el('code-turn-pivot-r');
  RP.codeConfig.turnArcTemplate    = _strOr(_el('code-turn-arc'),   d.turnArcTemplate    || 'robot.turn_arc(angle={angle}, speed={speed}, radius={radius})');
  RP.codeConfig.wallAlignTemplate  = _strOr(_el('code-wall-align'), d.wallAlignTemplate  || 'robot.wall_align(reversed={reversed}, power={speed}, expected_distance={expected_distance}{extra_args})');
  RP.codeConfig.lineTraceDistTemplate = _strOr(_el('code-lt-dist'), d.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed}{extra_args})');
  RP.codeConfig.lineTraceJunctTemplate = _strOr(_el('code-lt-junct'), d.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed}{extra_args})');
  RP.codeConfig.checkpointTemplate = _strOr(_el('code-checkpoint'), d.checkpointTemplate || 'if callable({name}): {name}({extra_args})');
  RP.codeConfig.defaultSpeed = _posNum(_el('code-speed'), d.defaultSpeed || 200);
  // Blank is the norm here — most kinds are happy sharing defaultSpeed —
  // so these use _posNumOrNull, not _strOr's "fall back to a default"
  // shape.
  RP.codeConfig.defaultSpeedForward = _posNumOrNull(_el('code-speed-forward'));
  RP.codeConfig.defaultSpeedTurn = _posNumOrNull(_el('code-speed-turn'));
  RP.codeConfig.defaultSpeedArc = _posNumOrNull(_el('code-speed-arc'));
  RP.codeConfig.defaultSpeedWallAlign = _posNumOrNull(_el('code-speed-wall-align'));
  RP.codeConfig.defaultSpeedLineTraceDist = _posNumOrNull(_el('code-speed-lt-dist'));
  RP.codeConfig.defaultSpeedLineTraceJunct = _posNumOrNull(_el('code-speed-lt-junct'));
  RP.codeConfig.defaultUnit = _strOr(_el('code-unit'), d.defaultUnit || 'mm');
  if (RP.render) RP.render();
};

RP.updateCodeConfigUI = function() {
  document.getElementById('code-comment').value = RP.codeConfig.commentPrefix;
  document.getElementById('code-forward').value = RP.codeConfig.forwardTemplate;
  document.getElementById('code-turn').value       = RP.codeConfig.turnTemplate      || 'robot.turn_in_place({angle}, power={speed}{extra_args})';
  var pvL = document.getElementById('code-turn-pivot-l');
  if (pvL) pvL.value = RP.codeConfig.turnPivotLeftTemplate || '';
  var pvR = document.getElementById('code-turn-pivot-r');
  if (pvR) pvR.value = RP.codeConfig.turnPivotRightTemplate || '';
  var arcTmplEl = document.getElementById('code-turn-arc');
  if (arcTmplEl) arcTmplEl.value = RP.codeConfig.turnArcTemplate || 'robot.turn_arc(angle={angle}, speed={speed}, radius={radius})';
  document.getElementById('code-wall-align').value = RP.codeConfig.wallAlignTemplate || 'robot.wall_align(reversed={reversed}, power={speed}, expected_distance={expected_distance}{extra_args})';
  document.getElementById('code-lt-dist').value = RP.codeConfig.lineTraceDistTemplate || 'line_trace_distance({distance}, {speed}{extra_args})';
  document.getElementById('code-lt-junct').value = RP.codeConfig.lineTraceJunctTemplate || 'line_trace_until_junctions({junctions}, {speed}{extra_args})';
  var cpTmplEl = document.getElementById('code-checkpoint');
  if (cpTmplEl) cpTmplEl.value = RP.codeConfig.checkpointTemplate || 'if callable({name}): {name}({extra_args})';
  document.getElementById('code-speed').value = RP.codeConfig.defaultSpeed;
  // null renders as an empty field, i.e. "no override" — never coerce to
  // defaultSpeed here, or a blank field would look identical to one that
  // was explicitly set to match it.
  function _speedEl(id, val) { var e = document.getElementById(id); if (e) e.value = val != null ? val : ''; }
  _speedEl('code-speed-forward', RP.codeConfig.defaultSpeedForward);
  _speedEl('code-speed-turn', RP.codeConfig.defaultSpeedTurn);
  _speedEl('code-speed-arc', RP.codeConfig.defaultSpeedArc);
  _speedEl('code-speed-wall-align', RP.codeConfig.defaultSpeedWallAlign);
  _speedEl('code-speed-lt-dist', RP.codeConfig.defaultSpeedLineTraceDist);
  _speedEl('code-speed-lt-junct', RP.codeConfig.defaultSpeedLineTraceJunct);
  document.getElementById('code-unit').value = RP.codeConfig.defaultUnit;
};

