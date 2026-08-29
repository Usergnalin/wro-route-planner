/* ========================================================================
   documents.js - Phase 11: two sketch documents (mat + robot).

   The mat and the robot are separate sketches in separate coordinate
   spaces. RP.sketch / RP.constructionMeta always point at whichever is
   ACTIVE; the other parks in RP.documents. These pin that the two never
   leak into each other, and that the robot frame is read correctly.

     node tests/documents.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('documents');

function fresh() {
  const RP = loadApp(appFiles()).RP;
  ['render', 'updateLayerList', 'updateInfoPanel', 'updateInstructions',
   'updateConstraintPanel', 'updateRouteSelect', 'updateSideRouteList']
    .forEach(k => { RP[k] = function () {}; });
  RP.calibration = { pixelsPerMm: 2 };
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

// ---- isolation -------------------------------------------------------
check('a fresh app starts on the mat document', () => {
  const RP = fresh();
  assert(RP.activeDocId === RP.DOC_MAT, 'expected mat, got ' + RP.activeDocId);
});

check('geometry drawn in one document does not appear in the other', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);
  assert(RP.lines.length === 1, 'mat should have its line');

  RP.setActiveDoc(RP.DOC_ROBOT);
  assert(RP.lines.length === 0, 'the robot document starts empty, got ' + RP.lines.length);
  RP.addConstructionLine(0, 0, 200, 0);
  RP.addConstructionLine(0, 0, 0, 180);
  assert(RP.lines.length === 2, 'robot should have its own two lines');

  RP.setActiveDoc(RP.DOC_MAT);
  assert(RP.lines.length === 1, 'the mat must be untouched, got ' + RP.lines.length);
});

check('each document keeps its own solver state', () => {
  const RP = fresh();
  // Mat: fully constrained single line.
  const m = RP.addConstructionLine(0, 0, 100, 0);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [m.line.p1]);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [m.line.p2]);
  RP.solveSketch();
  const matDof = RP.sketch.dof;

  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.addConstructionLine(0, 0, 200, 0);   // nothing constrained
  RP.solveSketch();
  assert(RP.sketch.dof > 0, 'the robot sketch has its own free DOF');

  RP.setActiveDoc(RP.DOC_MAT);
  RP.solveSketch();
  assert(RP.sketch.dof === matDof,
    'the mat DOF must not have been changed by robot edits: ' + RP.sketch.dof + ' vs ' + matDof);
});

check('switching documents drops the selection rather than carrying the id across', () => {
  const RP = fresh();
  const m = RP.addConstructionLine(0, 0, 100, 0);
  RP.selectedLineId = m.line.id;
  RP.setActiveDoc(RP.DOC_ROBOT);
  assert(RP.selectedLineId === null,
    'an id from another document would highlight unrelated geometry');
});

// ---- persistence -----------------------------------------------------
check('undo/redo restores both documents and which one was active', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);
  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.pushHistory('robot edit');
  RP.addConstructionLine(0, 0, 200, 0);
  assert(RP.lines.length === 1, 'robot line added');

  RP.undo();
  assert(RP.activeDocId === RP.DOC_ROBOT, 'undo should land back on the robot document');
  assert(RP.lines.length === 0, 'the robot line should be gone, got ' + RP.lines.length);

  RP.setActiveDoc(RP.DOC_MAT);
  assert(RP.lines.length === 1, 'the mat line must have survived the robot undo');
});

check('a save payload round-trips both documents', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);
  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.addConstructionLine(0, 0, 200, 0);
  RP.addConstructionLine(0, 0, 0, 150);
  RP.setActiveDoc(RP.DOC_MAT);

  const payload = {
    sketch: RP._serializeDoc(RP.getDoc(RP.DOC_MAT)).sketch,
    construction: RP._serializeDoc(RP.getDoc(RP.DOC_MAT)).construction,
    robotDoc: RP.serializeRobotDoc()
  };

  const RP2 = fresh();
  RP2.loadSketchFrom(payload);
  assert(RP2.activeDocId === RP.DOC_MAT, 'opening a project lands on the mat');
  assert(RP2.lines.length === 1, 'mat restored, got ' + RP2.lines.length);
  RP2.setActiveDoc(RP2.DOC_ROBOT);
  assert(RP2.lines.length === 2, 'robot restored, got ' + RP2.lines.length);
});

check('saving while the robot is open still writes the mat into the mat slot', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);          // the mat's only line
  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.addConstructionLine(0, 0, 200, 0);
  RP.addConstructionLine(0, 0, 0, 150);
  RP.addConstructionLine(0, 0, 40, 40);          // robot now has 3

  // Serialized BY NAME, not from whatever happens to be active.
  const mat = RP._serializeDoc(RP.getDoc(RP.DOC_MAT));
  const lineCount = Object.values(mat.sketch.entities).filter(e => e.type === 'line').length;
  assert(lineCount === 1,
    'the mat slot must hold the mat, got ' + lineCount + ' lines (the robot has 3)');
});

check('a pre-robot save file loads with an empty robot rather than a missing one', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);
  const legacy = {
    sketch: RP._serializeDoc(RP.getDoc(RP.DOC_MAT)).sketch,
    construction: RP._serializeDoc(RP.getDoc(RP.DOC_MAT)).construction
    // no robotDoc — this is what every file before v6 looks like
  };
  const RP2 = fresh();
  RP2.loadSketchFrom(legacy);
  assert(RP2.lines.length === 1, 'mat still loads');
  RP2.setActiveDoc(RP2.DOC_ROBOT);
  assert(RP2.lines.length === 0, 'robot should be empty, not undefined');
  assert(RP2.robotFrame().ok === false, 'and has no frame yet');
});

check('opening a project clears the previously-open robot document', () => {
  const RP = fresh();
  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.addConstructionLine(0, 0, 999, 0);   // robot from the OLD project
  RP.setActiveDoc(RP.DOC_MAT);
  RP.loadSketchFrom({ sketch: null, construction: {} });   // open a different project
  RP.setActiveDoc(RP.DOC_ROBOT);
  assert(RP.lines.length === 0,
    'the previous project\'s robot must not survive, got ' + RP.lines.length);
});

// ---- the robot frame -------------------------------------------------
function robotWithDrive(RP, opts) {
  opts = opts || {};
  RP.setActiveDoc(RP.DOC_ROBOT);
  // Body: a 200 x 180 rectangle whose rear-axle midpoint is at (50, 90).
  RP.addConstructionLine(0, 0, 200, 0);
  RP.addConstructionLine(200, 0, 200, 180);
  RP.addConstructionLine(200, 180, 0, 180);
  RP.addConstructionLine(0, 180, 0, 0);
  // Drive axis: starts at the rotation centre, points forward (+x here).
  const d = RP.addConstructionLine(50, 90, 150, 90);
  RP.setGeometryRole(d.line.id, RP.DRIVE_ROLE);
  return d;
}

check('robotFrame reads the origin and facing off the drive axis', () => {
  const RP = fresh();
  robotWithDrive(RP);
  const f = RP.robotFrame();
  assert(f.ok, 'a drive axis should give a frame');
  assertClose(f.ox, 50, 1e-9, 'origin x is the drive axis start');
  assertClose(f.oy, 90, 1e-9, 'origin y is the drive axis start');
  assertClose(f.cos, 1, 1e-9, 'forward is +x here');
  assertClose(f.sin, 0, 1e-9, 'forward is +x here');
});

check('without a drive axis the frame reports failure instead of guessing', () => {
  const RP = fresh();
  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.addConstructionLine(0, 0, 200, 0);
  assert(RP.robotFrame().ok === false,
    'there is no way to know which way a bare outline faces');
});

check('the footprint is expressed in the robot frame, not document coordinates', () => {
  const RP = fresh();
  robotWithDrive(RP);
  const fp = RP.robotFootprint();
  assert(fp.ok, 'should have a footprint');
  // The rectangle's corners relative to (50,90) with forward = +x:
  // x from -50..150, y from -90..90.
  const xs = fp.points.map(p => p.x), ys = fp.points.map(p => p.y);
  assertClose(Math.min(...xs), -50, 1e-9, 'rear extent behind the axle');
  assertClose(Math.max(...xs), 150, 1e-9, 'front extent ahead of the axle');
  assertClose(Math.min(...ys), -90, 1e-9, 'left extent');
  assertClose(Math.max(...ys), 90, 1e-9, 'right extent');
});

check('a drive axis drawn at an angle still yields an axis-aligned footprint', () => {
  const RP = fresh();
  RP.setActiveDoc(RP.DOC_ROBOT);
  // Same body, but rotated 90°: forward is +y in document coordinates.
  RP.addConstructionLine(0, 0, 0, 200);
  RP.addConstructionLine(0, 200, 180, 200);
  RP.addConstructionLine(180, 200, 180, 0);
  RP.addConstructionLine(180, 0, 0, 0);
  const d = RP.addConstructionLine(90, 50, 90, 150);
  RP.setGeometryRole(d.line.id, RP.DRIVE_ROLE);

  const fp = RP.robotFootprint();
  assert(fp.ok, 'should have a footprint');
  const xs = fp.points.map(p => p.x), ys = fp.points.map(p => p.y);
  // Rotating into the frame must give the same extents as the un-rotated
  // robot above — that is the whole point of having a frame.
  assertClose(Math.min(...xs), -50, 1e-9, 'rear extent');
  assertClose(Math.max(...xs), 150, 1e-9, 'front extent');
  assertClose(Math.min(...ys), -90, 1e-9, 'one side');
  assertClose(Math.max(...ys), 90, 1e-9, 'the other side');
});

check('the drive axis itself is not part of the body outline', () => {
  const RP = fresh();
  robotWithDrive(RP);
  const withAxis = RP.robotFootprint().points.length;
  // Four body lines, two endpoints each.
  assert(withAxis === 8,
    'expected only the 4 body lines to contribute 8 points, got ' + withAxis);
});

check('a hidden robot line is left out of the footprint', () => {
  const RP = fresh();
  robotWithDrive(RP);
  const before = RP.robotFootprint().points.length;
  RP.setConstructionVisible(RP.lines[0].id, false);
  const after = RP.robotFootprint().points.length;
  assert(after === before - 2, 'hiding a line should drop its 2 points, got ' + after);
});

check('robotFrame reads the robot document even while the mat is active', () => {
  const RP = fresh();
  robotWithDrive(RP);
  RP.setActiveDoc(RP.DOC_MAT);
  RP.addConstructionLine(0, 0, 1000, 0);
  const f = RP.robotFrame();
  assert(f.ok, 'the simulator runs from mat mode, so this must not depend on focus');
  assertClose(f.ox, 50, 1e-9, 'still the robot document origin');
});

// ---- interaction with Route mode ------------------------------------
check('entering Route mode forces the mat, since routes reference mat ids', () => {
  const RP = fresh();
  RP.ensureSingleRoute();
  RP.setActiveDoc(RP.DOC_ROBOT);
  RP.setEditMode('route');
  assert(RP.activeDocId === RP.DOC_MAT,
    'Route mode over the robot document would point at ids that are not there');
  assert(RP.editMode === 'route', 'and the mode switch itself still happened');
});

check('switching to the robot while in Route mode drops back to Sketch', () => {
  const RP = fresh();
  RP.ensureSingleRoute();
  RP.setEditMode('route');
  RP.switchDoc(RP.DOC_ROBOT);
  assert(RP.activeDocId === RP.DOC_ROBOT, 'the document switch happened');
  assert(RP.editMode === 'sketch', 'and Route mode was left, got ' + RP.editMode);
});

check('switching documents abandons a half-drawn line', () => {
  const RP = fresh();
  RP.lineDrawing = true;
  RP.lineDrawStart = { x: 10, y: 10 };
  RP.switchDoc(RP.DOC_ROBOT);
  assert(RP.lineDrawing === false && RP.lineDrawStart === null,
    'a line started on the mat must not finish itself on the robot');
});

if (!report()) process.exitCode = 1;
