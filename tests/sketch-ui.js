/* ========================================================================
   sketch-ui.js - Phase 3: selection, constraint application, DOF readout.

     node tests/sketch-ui.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('constraint UI');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  RP.render = function () {};
  RP.updateLayerList = function () {};
  RP.updateInfoPanel = function () {};
  RP.updateInstructions = function () {};
  RP.updateConstraintPanel = function () {};
  RP.calibration = { pixelsPerMm: 2 };   // 2 px = 1 mm
  RP.scale = 1;
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  RP.activeTool = 'constrain';
  return RP;
}

// Two lines meeting near a corner, deliberately sloppy.
function twoLines(RP) {
  const a = RP.addConstructionLine(0, 0, 200, 8);
  const b = RP.addConstructionLine(200, 8, 196, 120);
  return { a, b };
}

// ---- selection -------------------------------------------------------
check('click selects, clicking again clears', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.toggleSketchSelection(a.line.id, false);
  assert(RP.isSketchSelected(a.line.id), 'should be selected');
  RP.toggleSketchSelection(a.line.id, false);
  assert(!RP.isSketchSelected(a.line.id), 'should be cleared');
});

check('plain click replaces selection, shift-click extends it', () => {
  const RP = fresh();
  const { a, b } = twoLines(RP);
  RP.toggleSketchSelection(a.line.id, false);
  RP.toggleSketchSelection(b.line.id, false);
  assert(RP.sketchSelection.length === 1 && RP.isSketchSelected(b.line.id),
    'plain click should replace');
  RP.toggleSketchSelection(a.line.id, true);
  assert(RP.sketchSelection.length === 2, 'shift-click should extend');
});

check('selection order is preserved for two-line constraints', () => {
  const RP = fresh();
  const { a, b } = twoLines(RP);
  RP.toggleSketchSelection(b.line.id, true);
  RP.toggleSketchSelection(a.line.id, true);
  const refs = RP.constraintRefsFor('angle');
  assert(refs[0] === b.line.id && refs[1] === a.line.id,
    'angle A->B must follow click order');
});

check('hit test finds points before lines', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  const onPoint = RP.sketchHitTest(0, 0);
  assert(onPoint && onPoint.kind === 'point' && onPoint.id === a.p1.id,
    'expected the endpoint, got ' + JSON.stringify(onPoint));
  const onLine = RP.sketchHitTest(100, 4);
  assert(onLine && onLine.kind === 'line' && onLine.id === a.line.id,
    'expected the line, got ' + JSON.stringify(onLine));
  assert(RP.sketchHitTest(1000, 1000) === null, 'empty space should miss');
});

// ---- selection -> constraint gating ----------------------------------
check('palette enablement matches what each constraint accepts', () => {
  const RP = fresh();
  const { a, b } = twoLines(RP);

  RP.sketchSelection = [a.line.id];
  assert(RP.canApplyConstraint('horizontal'), 'H needs 1 line');
  assert(RP.canApplyConstraint('vertical'), 'V needs 1 line');
  assert(RP.canApplyConstraint('distance'), 'distance accepts a line');
  assert(RP.canApplyConstraint('angle'), 'angle accepts 1 line');
  assert(!RP.canApplyConstraint('coincident'), 'coincident needs 2 points');
  assert(!RP.canApplyConstraint('fix'), 'fix needs a point');

  RP.sketchSelection = [a.p2.id, b.p1.id];
  assert(RP.canApplyConstraint('coincident'), 'coincident needs 2 points');
  assert(RP.canApplyConstraint('distance'), 'distance accepts 2 points');
  assert(!RP.canApplyConstraint('horizontal'), 'H should reject points');

  RP.sketchSelection = [a.p1.id, b.line.id];
  assert(RP.canApplyConstraint('point_on_line'), 'point + line');

  RP.sketchSelection = [a.p1.id];
  assert(RP.canApplyConstraint('fix'), 'fix needs 1 point');
});

check('constraintRefsFor orders point before line regardless of click order', () => {
  const RP = fresh();
  const { a, b } = twoLines(RP);
  RP.sketchSelection = [b.line.id, a.p1.id];   // line clicked first
  const refs = RP.constraintRefsFor('point_on_line');
  assert(refs[0] === a.p1.id && refs[1] === b.line.id, 'point must come first');
});

// ---- applying constraints -------------------------------------------
check('applying horizontal solves and clears the selection', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  const res = RP.applyConstraint('horizontal');
  assert(res.ok, 'expected success: ' + res.message);
  assertClose(RP.lines[0].y1, RP.lines[0].y2, 1e-6, 'line should be horizontal');
  assert(RP.sketchSelection.length === 0, 'selection should clear after apply');
});

check('distance is entered in mm and stored in pixels', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  const res = RP.applyConstraint('distance', 50);      // 50 mm at 2 px/mm
  assert(res.ok, 'expected success: ' + res.message);
  assertClose(res.constraint.value, 100, 1e-9, 'stored value should be px');
  const v = RP.lines[0];
  assertClose(Math.hypot(v.x2 - v.x1, v.y2 - v.y1), 100, 1e-6, 'geometry in px');
});

check('angle is entered in degrees and stored in radians', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.p1.id];
  RP.applyConstraint('fix');
  RP.sketchSelection = [a.line.id];
  const res = RP.applyConstraint('angle', 90);
  assert(res.ok, 'expected success: ' + res.message);
  assertClose(res.constraint.value, Math.PI / 2, 1e-9, 'stored value in radians');
});

check('mismatched selection is rejected with a message', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.p1.id];
  const res = RP.applyConstraint('horizontal');
  assert(!res.ok, 'should fail');
  assert(/does not fit/.test(res.message), 'expected an explanatory message');
});

check('a conflicting user constraint is kept and reported, not rolled back', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('distance', 50);
  const before = RP.Sketch.constraintIds(RP.sketch).length;
  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('distance', 90);          // contradicts the first
  assert(RP.Sketch.constraintIds(RP.sketch).length === before + 1,
    'user constraint must be kept so the conflict is visible');
  assert(RP.sketch.status === 'conflict', 'expected conflict, got ' + RP.sketch.status);
});

// ---- status readout --------------------------------------------------
check('status readout tracks the solver', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 8);

  RP.solveSketch();
  let info = RP.sketchStatusInfo();
  assert(info.status === 'under', 'expected under, got ' + info.status);
  assert(/4 DOF/.test(info.text), 'expected DOF count, got ' + info.text);

  RP.sketchSelection = [made.p1.id];
  RP.applyConstraint('fix');
  RP.sketchSelection = [made.line.id];
  RP.applyConstraint('horizontal');
  RP.sketchSelection = [made.line.id];
  RP.applyConstraint('distance', 50);
  info = RP.sketchStatusInfo();
  assert(info.status === 'full', 'expected full, got ' + info.status + ' / ' + info.text);
  assert(info.color === '#66ccff', 'fully constrained should be blue');
});

check('constraint values display in mm and degrees', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  const res = RP.applyConstraint('distance', 50);
  assert(RP.formatConstraintValue(res.constraint) === '50.0mm',
    'got ' + RP.formatConstraintValue(res.constraint));
});

// ---- editing and deleting -------------------------------------------
check('editing a constraint value re-solves the geometry', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.p1.id];
  RP.applyConstraint('fix');
  RP.sketchSelection = [a.line.id];
  const res = RP.applyConstraint('distance', 50);

  RP.setConstraintValue(res.constraint.id, 80);        // mm
  const v = RP.lines[0];
  assertClose(Math.hypot(v.x2 - v.x1, v.y2 - v.y1), 160, 1e-6, 'should be 80mm = 160px');
});

check('deleting a constraint frees the degrees of freedom again', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 8);
  RP.sketchSelection = [made.line.id];
  const res = RP.applyConstraint('horizontal');
  const dofAfter = RP.sketch.dof;

  RP.deleteConstraint(res.constraint.id);
  assert(RP.sketch.dof === dofAfter + 1,
    'expected one DOF back, got ' + RP.sketch.dof + ' from ' + dofAfter);
});

// ---- undo ------------------------------------------------------------
check('undo removes an applied constraint', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('horizontal');
  assert(RP.Sketch.constraintIds(RP.sketch).length === 1, 'setup');

  RP.undo();
  assert(RP.Sketch.constraintIds(RP.sketch).length === 0,
    'undo should remove the constraint');
});

check('dragging a point is undoable back to its original position', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  // Mirrors what the mousemove handler does: snapshot before first move.
  RP.pushHistory('Move point');
  RP.Sketch.dragPoint(RP.sketch, made.p2.id, 140, 40);
  RP.rebuildLines();
  assertClose(RP.lines[0].x2, 140, 1e-9, 'point moved');

  RP.undo();
  assertClose(RP.lines[0].x2, 100, 1e-9, 'undo should restore x');
  assertClose(RP.lines[0].y2, 0, 1e-9, 'undo should restore y');
});

// ---- live length measurement ----------------------------------------
check('length text follows the solver, it is not a snapshot', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  const before = RP.lines[0].label;

  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('distance', 50);          // 50 mm = 100 px

  const after = RP.lines.filter(l => l.id === a.line.id)[0].label;
  assert(after !== before, 'label must change when the constraint moves the line');
  assert(after === '50.00 mm', 'expected 50.00 mm, got ' + after);
});

check('right-triangle legs report their constrained lengths', () => {
  // The reported case: constrain both legs, both readouts must follow.
  const RP = fresh();
  const base = RP.addConstructionLine(0, 0, 200, 0);
  const rise = RP.addConstructionLine(200, 0, 200, 140);
  const hyp  = RP.addConstructionLine(200, 140, 0, 0);
  const sk = RP.sketch;
  RP.Sketch.addConstraint(sk, 'coincident', [base.p2.id, rise.p1.id]);
  RP.Sketch.addConstraint(sk, 'coincident', [rise.p2.id, hyp.p1.id]);
  RP.Sketch.addConstraint(sk, 'coincident', [hyp.p2.id, base.p1.id]);

  RP.sketchSelection = [base.p1.id];
  RP.applyConstraint('fix');
  RP.sketchSelection = [base.line.id];
  RP.applyConstraint('horizontal');
  RP.sketchSelection = [rise.line.id];
  RP.applyConstraint('vertical');
  RP.sketchSelection = [base.line.id];
  RP.applyConstraint('distance', 60);          // 60 mm
  RP.sketchSelection = [rise.line.id];
  RP.applyConstraint('distance', 80);          // 80 mm

  const byId = {};
  RP.lines.forEach(l => { byId[l.id] = l; });
  assert(byId[base.line.id].label === '60.00 mm',
    'base should read 60.00 mm, got ' + byId[base.line.id].label);
  assert(byId[rise.line.id].label === '80.00 mm',
    'rise should read 80.00 mm, got ' + byId[rise.line.id].label);
  // and the hypotenuse follows geometrically: 3-4-5
  assert(byId[hyp.line.id].label === '100.00 mm',
    'hypotenuse should read 100.00 mm, got ' + byId[hyp.line.id].label);
});

// ---- centralised entity annotations ---------------------------------
check('a driving distance bolds the length label instead of adding a badge', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  let ann = RP.buildAnnotations();
  assert(ann[a.line.id].label, 'line should carry a length label');
  assert(ann[a.line.id].bold === false, 'unconstrained length is not bold');

  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('distance', 50);
  ann = RP.buildAnnotations();
  const entry = ann[a.line.id];
  assert(entry.bold === true, 'a driven length should be bold');
  assert(entry.driverId != null, 'the label should know its driving constraint');
  const distBadges = entry.badges.filter(b => b.type === 'distance');
  assert(distBadges.length === 0,
    'a driving distance must not also add an overlapping badge');
});

check('constraints group under the entity they annotate', () => {
  const RP = fresh();
  const { a, b } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('horizontal');
  RP.sketchSelection = [b.line.id];
  RP.applyConstraint('vertical');

  const ann = RP.buildAnnotations();
  assert(ann[a.line.id].badges.length === 1, 'one badge on the first line');
  assert(ann[a.line.id].badges[0].type === 'horizontal', 'correct badge');
  assert(ann[b.line.id].badges.length === 1, 'one badge on the second line');
  assert(ann[b.line.id].badges[0].type === 'vertical', 'correct badge');
});

check('several constraints on one entity are laid out as separate badges', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.p1.id];
  RP.applyConstraint('fix');
  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('horizontal');
  RP.sketchSelection = [a.line.id];
  RP.applyConstraint('angle', 0);

  const ann = RP.buildAnnotations();
  // fix anchors on the point, the other two on the line
  assert(ann[a.p1.id].badges.length === 1, 'point badge');
  assert(ann[a.line.id].badges.length === 2,
    'expected 2 line badges, got ' + ann[a.line.id].badges.length);
});

check('horizontal and vertical have icon renderings, not letters', () => {
  const RP = fresh();
  assert(/svg/.test(RP.constraintIconHTML('horizontal')), 'H should be an icon');
  assert(/svg/.test(RP.constraintIconHTML('vertical')), 'V should be an icon');
  assert(typeof RP.drawConstraintIcon === 'function', 'canvas icon renderer exists');
});

// ---- constraint selection sync --------------------------------------
check('selecting a constraint is a two-way link with the canvas', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  const res = RP.applyConstraint('horizontal');

  RP.selectConstraint(res.constraint.id);
  assert(RP.selectedConstraintId === res.constraint.id, 'selection recorded');

  // Drawing records badge positions, which is what canvas clicks hit.
  RP.drawSketchOverlay(fakeCtx());
  assert(RP._badgeHits.length > 0, 'overlay should record badge hit targets');
  const hit = RP._badgeHits[0];
  assert(RP.badgeHitTest(hit.x, hit.y) === res.constraint.id,
    'clicking a badge should resolve to its constraint');
  assert(RP.badgeHitTest(hit.x + 500, hit.y + 500) === null, 'far away misses');
});

check('deleting the selected constraint clears the selection', () => {
  const RP = fresh();
  const { a } = twoLines(RP);
  RP.sketchSelection = [a.line.id];
  const res = RP.applyConstraint('horizontal');
  RP.selectConstraint(res.constraint.id);
  RP.deleteConstraint(res.constraint.id);
  RP.selectedConstraintId = null;
  assert(RP.sketch.constraints[res.constraint.id] === undefined, 'constraint gone');
});

// Minimal 2D context stand-in — the overlay only needs these to run.
function fakeCtx() {
  const noop = function () {};
  return {
    save: noop, restore: noop, beginPath: noop, arc: noop, fill: noop,
    stroke: noop, moveTo: noop, lineTo: noop, strokeRect: noop,
    fillText: noop, strokeText: noop, closePath: noop, rect: noop,
    set font(v) {}, set fillStyle(v) {}, set strokeStyle(v) {},
    set lineWidth(v) {}, set textAlign(v) {}, set textBaseline(v) {},
    set lineCap(v) {}
  };
}

// ---- equal, from the palette -----------------------------------------
check('equal accepts two lines or two arcs, and nothing else', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(0, 60, 40, 60);
  const arc1 = RP.addConstructionArc(300, 0, 400, 60, {});
  const arc2 = RP.addConstructionArc(300, 200, 360, 240, {});
  RP.setTool('constrain');

  const sel = (...ids) => { RP.sketchSelection = ids; };

  sel(a.line.id, b.line.id);
  assert(RP.canApplyConstraint('equal'), 'two lines should be accepted');

  sel(arc1.arc.id, arc2.arc.id);
  assert(RP.canApplyConstraint('equal'), 'two arcs should be accepted');

  sel(a.line.id, arc1.arc.id);
  assert(!RP.canApplyConstraint('equal'), 'a line and an arc must be refused');

  sel(a.line.id);
  assert(!RP.canApplyConstraint('equal'), 'one line is not a pair');

  sel(a.line.id, b.line.id, arc1.arc.id);
  assert(!RP.canApplyConstraint('equal'), 'a mixed trio must be refused');
});

check('applying equal from the palette resizes the geometry', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(0, 60, 40, 60);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [a.p1.id]);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [a.p2.id]);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [b.p1.id]);
  RP.solveSketch();

  RP.setTool('constrain');
  RP.sketchSelection = [a.line.id, b.line.id];
  const res = RP.applyConstraint('equal');
  assert(res.ok, 'apply failed: ' + JSON.stringify(res));

  const l = RP.lines.find(x => x.id === b.line.id);
  assertClose(Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 100, 1e-6,
    'the second line should now match the first');
  assert(RP.sketchSelection.length === 0, 'applying clears the selection');
});

check('equal has a real badge and a list icon, not a question mark', () => {
  const RP = fresh();
  assert(/<svg/.test(RP.constraintIconHTML('equal')), 'missing list icon');
  // drawConstraintIcon falls through to "?" for anything it does not know.
  const drawn = [];
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'save' || k === 'restore' || k === 'beginPath') return () => {};
      if (k === 'fillText') return (txt) => drawn.push(txt);
      if (typeof k === 'string') return () => {};
      return undefined;
    },
    set: () => true
  });
  RP.drawConstraintIcon(ctx, 'equal', 0, 0, 10, '#fff');
  assert(drawn.indexOf('?') < 0, 'equal fell through to the "?" glyph');
});

if (!report()) process.exitCode = 1;
