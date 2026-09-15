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

// ---- derived clearances and the flip --------------------------------
check('robotExtentsMm measures reach from the turning centre, in mm', () => {
  const RP = fresh();               // 2 px per mm
  robotWithDrive(RP);               // body 0..200 x, centre at x=50
  const ext = RP.robotExtentsMm();
  assert(ext, 'a drawn body should give extents');
  assertClose(ext.front, 75, 1e-9, '150px ahead / 2 = 75mm');
  assertClose(ext.rear, 25, 1e-9, '50px behind / 2 = 25mm');
  assertClose(ext.length, 100, 1e-9, '200px / 2');
  assertClose(ext.width, 90, 1e-9, '180px / 2');
});

check('flipping the drive axis reverses forward without redrawing it', () => {
  const RP = fresh();
  RP.setActiveDoc(RP.DOC_ROBOT);
  // Body 0..200 in x. The drive axis is deliberately ASYMMETRIC within it
  // (40 -> 120, not 50 -> 150): a symmetric axis gives the same overhang
  // whichever end is the nose, so it could not tell a real flip from a
  // no-op.
  RP.addConstructionLine(0, 0, 200, 0);
  RP.addConstructionLine(200, 0, 200, 180);
  RP.addConstructionLine(200, 180, 0, 180);
  RP.addConstructionLine(0, 180, 0, 0);
  const d = RP.addConstructionLine(40, 90, 120, 90);
  RP.setGeometryRole(d.line.id, RP.DRIVE_ROLE);

  const before = RP.robotFrame();
  assertClose(before.cos, 1, 1e-9, 'forward starts as +x');
  const extBefore = RP.robotExtentsMm();
  assertClose(extBefore.front, 80, 1e-9, 'pivot at x=40, body to x=200 -> 160px');
  assertClose(extBefore.rear, 20, 1e-9, 'and 40px behind');

  assert(RP.flipDriveAxis(), 'flip should succeed');
  const after = RP.robotFrame();
  assertClose(after.cos, -1, 1e-9, 'forward is now -x');
  assert(after.id === before.id, 'it is still the same line, not a new one');
  // The turning centre moves to the other end of the axis, so both the
  // pivot AND the facing change — the overhangs are re-measured, not
  // merely swapped.
  const ext = RP.robotExtentsMm();
  assertClose(ext.front, 60, 1e-9, 'pivot now x=120, facing -x, body to x=0 -> 120px');
  assertClose(ext.rear, 40, 1e-9, 'and 80px behind it');
});

check('flipping does not touch the sketch entity, so constraints still hold', () => {
  const RP = fresh();
  const d = robotWithDrive(RP);
  const ent = RP.sketch.entities[d.line.id];
  const p1Before = ent.p1, p2Before = ent.p2;
  RP.flipDriveAxis();
  assert(ent.p1 === p1Before && ent.p2 === p2Before,
    'point order must be untouched — swapping it would negate any angle constraint');
});

check('flipping twice returns to where it started', () => {
  const RP = fresh();
  robotWithDrive(RP);
  RP.flipDriveAxis();
  RP.flipDriveAxis();
  assertClose(RP.robotFrame().cos, 1, 1e-9, 'back to +x');
});

check('flip survives a save/load round trip', () => {
  const RP = fresh();
  robotWithDrive(RP);
  RP.flipDriveAxis();
  const payload = { sketch: null, construction: {}, robotDoc: RP.serializeRobotDoc() };
  const RP2 = fresh();
  RP2.loadSketchFrom(payload);
  assertClose(RP2.robotFrame().cos, -1, 1e-9, 'the flip is part of the document');
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

// ---- groups ----------------------------------------------------------
// Hiding a group must be EXACTLY hiding each member: the `visible` field
// of the rebuilt view is the one gate every consumer reads, so testing it
// there is testing render, snap, hit-testing and selection at once.

const viewOf = (RP, id) =>
  RP.lines.concat(RP.arcs, RP.points).find(v => v.id === id);

check('new geometry lands in the current group, which starts as Default', () => {
  const RP = fresh();
  const l = RP.addConstructionLine(0, 0, 100, 0);
  assert(viewOf(RP, l.line.id).visible === true, 'visible by default');
  const def = RP.currentGroup();
  assert(def.isDefault === true, 'the current group starts as Default');
  assert(viewOf(RP, l.line.id).group === def.id,
    'and geometry is filed into it without being asked');
});

check('new geometry follows the current group when it changes', () => {
  const RP = fresh();
  const g = RP.addGroup('dropoff');
  RP.setCurrentGroup(g.id);
  const l = RP.addConstructionLine(0, 0, 100, 0);
  assert(viewOf(RP, l.line.id).group === g.id,
    'drawing should go where you said, with no per-line step');
});

check('setting a hidden group current un-hides it', () => {
  const RP = fresh();
  const g = RP.addGroup('dropoff');
  RP.setGroupVisible(g.id, false);
  RP.setCurrentGroup(g.id);
  assert(RP.findGroup(g.id).visible !== false,
    'or the next line drawn would vanish as it was created');
  const l = RP.addConstructionLine(0, 0, 100, 0);
  assert(viewOf(RP, l.line.id).visible === true, 'and it is actually visible');
});

check('Default cannot be deleted, because it is the fallback', () => {
  const RP = fresh();
  const def = RP.currentGroup();
  assert(RP.removeGroup(def.id) === false, 'should refuse');
  assert(RP.currentGroup().isDefault === true, 'and still be there');
});

check('hiding a group hides its members in the view every consumer reads', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(0, 50, 100, 50);
  const g = RP.addGroup('line trace');
  RP.setGeometryGroup(a.line.id, g.id);

  RP.setGroupVisible(g.id, false);
  assert(viewOf(RP, a.line.id).visible === false, 'the member is hidden');
  assert(viewOf(RP, b.line.id).visible === true, 'the non-member is untouched');

  RP.setGroupVisible(g.id, true);
  assert(viewOf(RP, a.line.id).visible === true, 'and comes back');
});

check('a hidden group beats a per-line visible flag', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const g = RP.addGroup('hidden things');
  RP.setGeometryGroup(a.line.id, g.id);
  RP.setConstructionVisible(a.line.id, true);   // explicitly visible...
  RP.setGroupVisible(g.id, false);              // ...but its group is not
  assert(viewOf(RP, a.line.id).visible === false,
    'the group switch has to win, or hiding a group would be unreliable');
});

check('a hidden group makes its obstacles inert, like hiding them one by one', () => {
  const RP = fresh();
  const o = RP.addConstructionLine(300, 0, 300, 400);
  RP.setGeometryRole(o.line.id, RP.OBSTACLE_ROLE);
  assert(RP.obstacleSegments().length === 1, 'obstacle counts while shown');
  const g = RP.addGroup('walls');
  RP.setGeometryGroup(o.line.id, g.id);
  RP.setGroupVisible(g.id, false);
  assert(RP.obstacleSegments().length === 0,
    'hidden means no presence at all — same as the per-line rule');
});

check('groups are per-document and do not leak', () => {
  const RP = fresh();
  RP.addGroup('mat things');
  const matNames = RP.groups.map(g => g.name);
  RP.setActiveDoc(RP.DOC_ROBOT);
  assert(RP.groups.map(g => g.name).indexOf('mat things') < 0,
    'the robot document must not see the mat\'s groups');
  assert(RP.currentGroup().isDefault === true, 'and gets its own Default');
  RP.addGroup('robot things');
  RP.setActiveDoc(RP.DOC_MAT);
  assert(JSON.stringify(RP.groups.map(g => g.name)) === JSON.stringify(matNames),
    'and the mat keeps exactly its own, got ' + JSON.stringify(RP.groups.map(g => g.name)));
});

check('the current group is per-document too', () => {
  const RP = fresh();
  const matG = RP.addGroup('mat things');
  RP.setCurrentGroup(matG.id);
  RP.setActiveDoc(RP.DOC_ROBOT);
  assert(RP.currentGroup().id !== matG.id, 'the robot has its own current group');
  RP.setActiveDoc(RP.DOC_MAT);
  assert(RP.currentGroup().id === matG.id, 'and the mat remembers its own');
});

check('the robot footprint respects its OWN document groups from the mat', () => {
  const RP = fresh();
  robotWithDrive(RP);            // leaves the robot document active
  const bodyLine = RP.lines[0].id;
  const g = RP.addGroup('body');
  RP.setGeometryGroup(bodyLine, g.id);
  RP.setGroupVisible(g.id, false);
  RP.setActiveDoc(RP.DOC_MAT);   // now the ACTIVE groups are the mat's
  const fp = RP.robotFootprint();
  assert(fp.points.length === 6,
    'a hidden robot group must still be honoured from the mat, got ' + fp.points.length);
});

check('deleting a group keeps the geometry and un-hides it', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const g = RP.addGroup('temp');
  RP.setGeometryGroup(a.line.id, g.id);
  RP.setGroupVisible(g.id, false);
  RP.removeGroup(g.id);
  assert(RP.lines.length === 1, 'the line survives — deleting a group is not deleting work');
  assert(viewOf(RP, a.line.id).visible === true, 'and is visible again');
  assert(RP.constructionMeta[a.line.id].group === RP.currentGroup().id &&
         RP.currentGroup().isDefault === true,
    'and falls back to Default rather than to a nonexistent ungrouped tier');
});

check('naming an existing group joins it instead of making a duplicate', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(0, 50, 100, 50);
  const g1 = RP.groupByNameOrCreate('dropoff');
  const g2 = RP.groupByNameOrCreate('Dropoff');    // different case, same group
  assert(g1.id === g2.id, 'should have matched the existing group');
  const dropoffs = RP.groups.filter(g => g.name.toLowerCase() === 'dropoff');
  assert(dropoffs.length === 1, 'and not created a second, got ' + dropoffs.length);
  RP.setGeometryGroup(a.line.id, g1.id);
  RP.setGeometryGroup(b.line.id, g2.id);
  assert(RP.entitiesInGroup(g1.id).length === 2, 'both members land in the one group');
});

check('a dangling group id never hides geometry', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  RP.constructionMeta[a.line.id].group = 9999;   // group that does not exist
  RP.rebuildLines();
  assert(viewOf(RP, a.line.id).visible === true,
    'unknown group must fail open, or a bad save would hide work with no way back');
});

check('groups survive a save/load round trip', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const g = RP.addGroup('line trace');
  RP.setGeometryGroup(a.line.id, g.id);
  RP.setGroupVisible(g.id, false);

  const mat = RP._serializeDoc(RP.getDoc(RP.DOC_MAT));
  const RP2 = fresh();
  RP2.loadSketchFrom({ sketch: mat.sketch, construction: mat.construction,
                       groups: mat.groups, nextGroupId: mat.nextGroupId });
  const lt = RP2.groups.filter(g => g.name === 'line trace');
  assert(lt.length === 1, 'group restored');
  assert(lt[0].visible === false, 'with its hidden state');
  assert(viewOf(RP2, a.line.id).visible === false, 'so the member is still hidden');
});

check('a pre-groups save file migrates its geometry into Default', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);
  const mat = RP._serializeDoc(RP.getDoc(RP.DOC_MAT));
  // Strip every trace of groups, as a file written before they existed.
  const legacyMeta = JSON.parse(JSON.stringify(mat.construction));
  for (const k in legacyMeta) delete legacyMeta[k].group;

  const RP2 = fresh();
  RP2.loadSketchFrom({ sketch: mat.sketch, construction: legacyMeta });
  const def = RP2.currentGroup();
  assert(def.isDefault === true, 'a Default group is created for it');
  assert(RP2.lines.length === 1 && RP2.lines[0].visible === true, 'everything visible');
  assert(RP2.constructionMeta[RP2.lines[0].id].group === def.id,
    'and the old geometry is filed into Default rather than left in limbo');
});

check('undo restores group visibility', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const g = RP.addGroup('temp');
  RP.setGeometryGroup(a.line.id, g.id);
  RP.pushHistory('hide group');
  RP.setGroupVisible(g.id, false);
  assert(viewOf(RP, a.line.id).visible === false, 'hidden');
  RP.undo();
  assert(viewOf(RP, a.line.id).visible === true, 'undo brings it back');
});

// ---- assigning by selection ------------------------------------------
check('right-clicking inside the selection acts on the whole selection', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(0, 50, 100, 50);
  const c = RP.addConstructionLine(0, 90, 100, 90);
  RP.sketchSelection = [a.line.id, b.line.id];
  const targets = RP.groupAssignmentTargets(a.line.id);
  assert(targets.length === 2, 'both selected lines, got ' + targets.length);
  assert(targets.indexOf(c.line.id) < 0, 'and not the unselected one');
});

check('right-clicking OUTSIDE the selection acts on just that line', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(0, 50, 100, 50);
  const c = RP.addConstructionLine(0, 90, 100, 90);
  RP.sketchSelection = [a.line.id, b.line.id];
  const targets = RP.groupAssignmentTargets(c.line.id);
  assert(JSON.stringify(targets) === JSON.stringify([c.line.id]),
    'clicking away from a selection should mean that one thing, got ' + JSON.stringify(targets));
});

check('with nothing selected it is just the clicked line', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  RP.sketchSelection = [];
  assert(JSON.stringify(RP.groupAssignmentTargets(a.line.id)) ===
         JSON.stringify([a.line.id]), 'one line');
});

check('a dozen selected lines move in one action', () => {
  const RP = fresh();
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(RP.addConstructionLine(0, i * 10, 100, i * 10).line.id);
  const g = RP.addGroup('dropoff');
  RP.sketchSelection = ids.slice();
  const n = RP.setGeometryGroupMany(RP.groupAssignmentTargets(ids[0]), g.id);
  assert(n === 12, 'all twelve moved, got ' + n);
  assert(RP.entitiesInGroup(g.id).length === 12, 'and they are all in the group');
});

if (!report()) process.exitCode = 1;
