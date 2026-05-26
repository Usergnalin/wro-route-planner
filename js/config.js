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
  // Use the literal raw value when it is a non-empty string. Empty
  // strings fall back to the default. We accept whitespace-only as a
  // valid string (someone might want a blank comment prefix to keep
  // structure but produce no comments? Unlikely. Treat as empty.)
  if (typeof raw !== 'string') return fallback;
  var t = raw;
  return t.length > 0 ? t : fallback;
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
  document.getElementById('robot-heading-label').textContent = Math.round(RP.robotConfig.startHeading) + '\u00b0';
};

// ======================================================================
// CODE CONFIG UI
// ======================================================================
RP.updateCodeConfigFromUI = function() {
  var d = RP.DEFAULT_CODE_CONFIG_VALUES || {};
  RP.codeConfig.commentPrefix = _strOr(document.getElementById('code-comment').value, d.commentPrefix || '//');
  RP.codeConfig.forwardTemplate = _strOr(document.getElementById('code-forward').value, d.forwardTemplate || 'move({distance}, {speed})');
  RP.codeConfig.turnRightTemplate = _strOr(document.getElementById('code-turn-r').value, d.turnRightTemplate || 'turn_right({angle}, {speed})');
  RP.codeConfig.turnLeftTemplate = _strOr(document.getElementById('code-turn-l').value, d.turnLeftTemplate || 'turn_left({angle}, {speed})');
  RP.codeConfig.defaultSpeed = _posNum(document.getElementById('code-speed').value, d.defaultSpeed || 200);
  RP.codeConfig.defaultUnit = _strOr(document.getElementById('code-unit').value, d.defaultUnit || 'mm');
  if (RP.render) RP.render();
};

RP.updateCodeConfigUI = function() {
  document.getElementById('code-comment').value = RP.codeConfig.commentPrefix;
  document.getElementById('code-forward').value = RP.codeConfig.forwardTemplate;
  document.getElementById('code-turn-r').value = RP.codeConfig.turnRightTemplate;
  document.getElementById('code-turn-l').value = RP.codeConfig.turnLeftTemplate;
  document.getElementById('code-speed').value = RP.codeConfig.defaultSpeed;
  document.getElementById('code-unit').value = RP.codeConfig.defaultUnit;
};

// ======================================================================
// CALIBRATION PROMPT
// ======================================================================
RP.promptCalibration = function(pxLength) {
  var raw = prompt('Enter the known length of this line in mm (e.g. 2362 for a WRO mat):', '2362');
  if (raw === null) return false; // user cancelled
  var knownMm = parseFloat(raw);
  if (!(isFinite(knownMm) && knownMm > 0)) {
    alert('Calibration value must be a positive number of millimetres.');
    return false;
  }
  RP.calibration = { pixelsPerMm: pxLength / knownMm };
  // Re-label all construction lines
  for (var i = 0; i < RP.lines.length; i++) {
    var l = RP.lines[i];
    var lp = RP.dist(l.x1, l.y1, l.x2, l.y2);
    l.label = (lp / RP.calibration.pixelsPerMm).toFixed(2) + ' mm';
  }
  return true;
};

// Trigger calibration again on demand by picking the longest existing
// construction line as the reference (most accurate). Used by the
// "Recalibrate" button.
RP.recalibrate = function() {
  if (!RP.lines || RP.lines.length === 0) {
    alert('Draw at least one construction line first.');
    return;
  }
  // Use the longest existing line as the reference.
  var longest = RP.lines[0];
  var longestPx = RP.dist(longest.x1, longest.y1, longest.x2, longest.y2);
  for (var i = 1; i < RP.lines.length; i++) {
    var li = RP.lines[i];
    var px = RP.dist(li.x1, li.y1, li.x2, li.y2);
    if (px > longestPx) { longest = li; longestPx = px; }
  }
  RP.pushHistory('Recalibrate');
  if (RP.promptCalibration(longestPx)) {
    RP.render();
  }
};

// ======================================================================
// TAB SWITCHING (instructions/code tabs in bottom panel)
// ======================================================================
RP.switchTab = function(tabId) {
  RP.activeTab = tabId;
  var btns = document.querySelectorAll('.tab-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].dataset.tab === tabId);
  }
  document.getElementById('instr-tab').classList.toggle('hidden', tabId !== 'instr');
  document.getElementById('code-tab').classList.toggle('hidden', tabId !== 'code');
};
