/* ========================================================================
   construction.js - Phase 2: construction geometry backed by the sketch.

     node tests/construction.js
   ======================================================================== */
'use strict';

const { loadApp, appFiles, makeRunner, assert, assertClose } = require('./harness');

const { check, report } = makeRunner('construction layer');

// Fresh app with the rendering/DOM side stubbed out, so these tests only
// exercise model behaviour.
function fresh() {
  const RP = loadApp(appFiles()).RP;
  RP.render = function () {};
  RP.updateLayerList = function () {};
  RP.updateInfoPanel = function () {};
  RP.updateInstructions = function () {};
  RP.calibration = { pixelsPerMm: 2 };
  RP.resetSketch();
  RP.undoStack = [];
  RP.redoStack = [];
  return RP;
}

function constraintTypes(RP, pointId) {
  return RP.Sketch.constraintsOn(RP.sketch, pointId).map(c => c.type);
}

function countConstraints(RP, type) {
  const sk = RP.sketch;
  return RP.Sketch.constraintIds(sk)
    .filter(id => sk.constraints[id].type === type).length;
}

function lineById(RP, id) {
  return RP.lines.filter(l => l.id === id)[0] || null;
}

// ---- the view --------------------------------------------------------
check('addConstructionLine builds sketch entities and the RP.lines view', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(10, 20, 110, 20);
  assert(RP.lines.length === 1, 'expected 1 line in view');
  const v = RP.lines[0];
  assert(v.id === made.line.id, 'view id should be the sketch entity id');
  assertClose(v.x1, 10, 1e-9); assertClose(v.y1, 20, 1e-9);
  assertClose(v.x2, 110, 1e-9); assertClose(v.y2, 20, 1e-9);
  assert(v.p1 === made.p1.id && v.p2 === made.p2.id, 'view exposes point ids');
  assert(v.label === '50.00 mm', 'label should be mm at 2 px/mm, got ' + v.label);
});

check('view reflects the sketch after a solve, not stale writes', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  RP.lines[0].x2 = -999;              // writing the view does nothing
  RP.rebuildLines();
  assertClose(RP.lines[0].x2, 100, 1e-9, 'view rebuild discards direct writes');
  RP.sketch.entities[made.p2.id].x = 250;
  RP.rebuildLines();
  assertClose(RP.lines[0].x2, 250, 1e-9, 'view follows the sketch');
});

check('visibility survives a rebuild', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  RP.setConstructionVisible(made.line.id, false);
  RP.rebuildLines();
  assert(RP.lines[0].visible === false, 'visibility must live on the metadata');
});

// ---- auto-constraints ------------------------------------------------
check('endpoint snap becomes a coincident constraint', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80, {
    startSnap: { kind: 'endpoint', pointId: a.p2.id, x: 100, y: 0 }
  });
  assert(constraintTypes(RP, b.p1.id).indexOf('coincident') >= 0,
    'expected a coincident constraint on the new start point');
  assert(RP.sketch.status !== 'conflict', 'auto-constraint must not conflict');

  // and it should actually bind: moving a's end drags b's start along
  RP.moveConstructionEndpoint(a.line.id, 'end', 140, 30);
  const bv = lineById(RP, b.line.id);
  assertClose(bv.x1, 140, 1e-6, 'constrained endpoint should follow');
  assertClose(bv.y1, 30, 1e-6, 'constrained endpoint should follow');
});

check('along-line snap becomes a point_on_line constraint', () => {
  const RP = fresh();
  const base = RP.addConstructionLine(0, 0, 200, 0);
  const b = RP.addConstructionLine(50, 0, 50, 90, {
    startSnap: { kind: 'along-line', lineId: base.line.id, x: 50, y: 0 }
  });
  assert(constraintTypes(RP, b.p1.id).indexOf('point_on_line') >= 0,
    'expected point_on_line');
  assert(RP.sketch.status !== 'conflict', 'auto-constraint must not conflict');
});

check('intersection snap constrains the point onto both lines', () => {
  const RP = fresh();
  const h = RP.addConstructionLine(0, 50, 200, 50);
  const v = RP.addConstructionLine(80, 0, 80, 200);
  const b = RP.addConstructionLine(80, 50, 160, 120, {
    startSnap: { kind: 'intersection', lineIds: [h.line.id, v.line.id], x: 80, y: 50 }
  });
  const types = constraintTypes(RP, b.p1.id);
  assert(types.filter(t => t === 'point_on_line').length === 2,
    'expected two point_on_line constraints, got ' + JSON.stringify(types));
});

check('90deg snap becomes a horizontal/vertical constraint', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0, { endSnap: { kind: '90deg', x: 100, y: 0 } });
  assert(countConstraints(RP, 'horizontal') === 1, 'expected a horizontal constraint');

  RP.addConstructionLine(0, 0, 0, 100, { endSnap: { kind: '90deg', x: 0, y: 100 } });
  assert(countConstraints(RP, 'vertical') === 1, 'expected a vertical constraint');
});

check('auto-constraints are skipped when disabled', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  RP.autoConstrain = false;
  const b = RP.addConstructionLine(100, 0, 100, 80, {
    startSnap: { kind: 'endpoint', pointId: a.p2.id, x: 100, y: 0 }
  });
  assert(constraintTypes(RP, b.p1.id).length === 0, 'expected no constraints');
});

// ---- removal ---------------------------------------------------------
check('removing a line removes its points too', () => {
  const RP = fresh();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  RP.removeConstructionLine(made.line.id);
  assert(RP.lines.length === 0, 'view should be empty');
  assert(RP.Sketch.entityIds(RP.sketch).length === 0,
    'orphan points should not be left behind');
});

check('removing a line keeps points another entity is built on', () => {
  const RP = fresh();
  const sk = RP.ensureSketch();
  const made = RP.addConstructionLine(0, 0, 100, 0);
  // A second line deliberately sharing the first line's end point.
  const extra = RP.Sketch.addPoint(sk, 100, 90);
  const shared = RP.Sketch.addLine(sk, made.p2.id, extra.id);
  RP.constructionMeta[shared.id] = { label: 'shared', visible: true };
  RP.rebuildLines();

  RP.removeConstructionLine(made.line.id);
  assert(!!RP.Sketch.get(sk, made.p2.id), 'shared point must survive');
  assert(!!RP.Sketch.get(sk, shared.id), 'dependent line must survive');
  assert(RP.lines.length === 1, 'one line should remain');
});

check('removing a line drops its constraints', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const b = RP.addConstructionLine(100, 0, 100, 80, {
    startSnap: { kind: 'endpoint', pointId: a.p2.id, x: 100, y: 0 }
  });
  assert(countConstraints(RP, 'coincident') === 1, 'setup');
  RP.removeConstructionLine(a.line.id);
  assert(countConstraints(RP, 'coincident') === 0,
    'constraint referencing a removed point must go with it');
  assert(!!lineById(RP, b.line.id), 'the other line survives');
});

// ---- legacy migration ------------------------------------------------
check('legacy lines migrate with a spanning set of coincident constraints', () => {
  const RP = fresh();
  // Three endpoints meet at (100,0) — a cluster of 3 needs 2 constraints,
  // not 3 (which would be redundant).
  RP.sketchFromLegacyLines([
    { x1: 0,   y1: 0, x2: 100, y2: 0,   label: 'a', visible: true },
    { x1: 100, y1: 0, x2: 100, y2: 50,  label: 'b', visible: true },
    { x1: 100, y1: 0, x2: 200, y2: 0,   label: 'c', visible: false }
  ]);
  assert(RP.lines.length === 3, 'expected 3 lines');
  assert(countConstraints(RP, 'coincident') === 2,
    'expected 2 coincident constraints, got ' + countConstraints(RP, 'coincident'));
  assert(RP.lines[2].visible === false, 'visibility should migrate');
  const res = RP.solveSketch();
  assert(res.status !== 'conflict' && res.status !== 'redundant',
    'migrated sketch should be consistent, got ' + res.status);
});

check('legacy migration does not invent alignment constraints', () => {
  const RP = fresh();
  RP.sketchFromLegacyLines([
    { x1: 0, y1: 0, x2: 100, y2: 0.4 }   // nearly, but not exactly, horizontal
  ]);
  assert(countConstraints(RP, 'horizontal') === 0, 'must not guess horizontal');
  assertClose(RP.lines[0].y2, 0.4, 1e-9, 'geometry must not be reshaped');
});

// ---- persistence -----------------------------------------------------
check('sketch survives a serialize / load round trip', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  RP.addConstructionLine(100, 0, 100, 80, {
    startSnap: { kind: 'endpoint', pointId: a.p2.id, x: 100, y: 0 }
  });
  const payload = {
    sketch: RP.serializeSketch(),
    construction: JSON.parse(JSON.stringify(RP.constructionMeta))
  };
  const entitiesBefore = RP.Sketch.entityIds(RP.sketch).length;

  RP.resetSketch();
  assert(RP.lines.length === 0, 'reset should clear');

  RP.loadSketchFrom(payload);
  assert(RP.lines.length === 2, 'expected 2 lines after load');
  assert(RP.Sketch.entityIds(RP.sketch).length === entitiesBefore, 'entity count');
  assert(countConstraints(RP, 'coincident') === 1, 'constraints should round trip');
});

check('loadSketchFrom migrates a pre-sketch payload', () => {
  const RP = fresh();
  RP.loadSketchFrom({ lines: [{ x1: 0, y1: 0, x2: 100, y2: 0, visible: true }] });
  assert(RP.lines.length === 1, 'legacy payload should migrate');
  assert(!!RP.sketch, 'sketch should exist');
});

// ---- undo / redo -----------------------------------------------------
check('undo restores the sketch without re-solving it', () => {
  const RP = fresh();
  assert(typeof RP.undo === 'function', 'RP.undo should exist');
  RP.addConstructionLine(0, 0, 100, 0);
  const before = RP.lines.length;

  RP.pushHistory('add another');
  RP.addConstructionLine(0, 50, 100, 50);
  assert(RP.lines.length === before + 1, 'second line added');

  RP.undo();
  assert(RP.lines.length === before, 'undo should drop the second line');
  assertClose(RP.lines[0].x2, 100, 1e-9, 'remaining geometry must be untouched');
});

// ---- standalone points -----------------------------------------------
check('a standalone point appears in its own view, not among the lines', () => {
  const RP = fresh();
  const made = RP.addConstructionPoint(40, 60);
  assert(!!made && !!made.point, 'point created');
  assert(RP.points.length === 1, 'one standalone point, got ' + RP.points.length);
  assert(RP.lines.length === 0 && RP.arcs.length === 0, 'and no line or arc');
  assertClose(RP.points[0].x, 40, 1e-9);
  assertClose(RP.points[0].y, 60, 1e-9);
});

check('line endpoints do not leak into the points view', () => {
  const RP = fresh();
  RP.addConstructionLine(0, 0, 100, 0);
  assert(RP.points.length === 0,
    'endpoints belong to the line, got ' + RP.points.length + ' loose points');
});

check('a standalone point is a snap target', () => {
  const RP = fresh();
  const made = RP.addConstructionPoint(120, 80);
  const s = RP.computeSnap(122, 82, { kind: 'point' });
  assert(s && s.kind === 'endpoint' && s.pointId === made.point.id,
    'expected to snap to the point, got ' + JSON.stringify(s));
});

check('arc ends are snap targets, so a line can start where an arc stops', () => {
  const RP = fresh();
  const arc = RP.addConstructionArc(0, 0, 100, 0, { sagitta: 30 });
  const p2 = RP.sketch.entities[arc.p2.id];
  const s = RP.computeSnap(p2.x + 2, p2.y + 2, { kind: 'point' });
  assert(s && s.pointId === arc.p2.id,
    'expected the arc end, got ' + JSON.stringify(s));
});

check('a standalone point can be constrained like any other point', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  // Pin the line, or the solver is free to move it up to the point
  // instead — both satisfy point_on_line.
  RP.Sketch.addConstraint(RP.sketch, 'fix', [line.p1.id]);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [line.p2.id]);
  const pt = RP.addConstructionPoint(50, 40);
  RP.Sketch.addConstraint(RP.sketch, 'point_on_line', [pt.point.id, line.line.id]);
  RP.solveSketch();
  assertClose(RP.points[0].y, 0, 1e-6, 'the solver pulled it onto the line');
});

check('deleting a standalone point removes it; one in use is kept', () => {
  const RP = fresh();
  const pt = RP.addConstructionPoint(10, 10);
  RP.removeConstructionLine(pt.point.id);
  assert(RP.points.length === 0, 'gone');

  const line = RP.addConstructionLine(0, 0, 100, 0);
  RP.removeConstructionLine(line.p1.id);   // an endpoint, not a loose point
  assert(RP.lines.length === 1, 'the line must survive an attempt on its endpoint');
});

// ---- auto-tangency ---------------------------------------------------
function tangentsIn(RP) {
  const sk = RP.sketch;
  return RP.Sketch.constraintIds(sk)
    .filter(id => /^tangent/.test(sk.constraints[id].type));
}

// The tangent direction of an arc at one of its endpoints.
function arcTangentAt(RP, arcId, pointId) {
  const sk = RP.sketch;
  const arc = sk.entities[arcId];
  const c = sk.entities[arc.center], p = sk.entities[pointId];
  return Math.atan2(p.x - c.x, -(p.y - c.y));   // radius rotated 90°
}

check('an arc drawn onto a line end is made tangent to it', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  // Pinned so "along the line" still means +X after the solve — an
  // unconstrained line is free to swing to meet the arc instead.
  RP.Sketch.addConstraint(RP.sketch, 'fix', [line.p1.id]);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [line.p2.id]);
  RP.solveSketch();
  const endSnap = RP.computeSnap(100, 0, { kind: 'point' });
  assert(endSnap && endSnap.pointId === line.p2.id, 'the arc should snap to the line end');

  const arc = RP.addConstructionArc(100, 0, 180, 60, { startSnap: endSnap });
  assert(arc.tangents.length === 1, 'one tangent added, got ' + arc.tangents.length);
  assert(tangentsIn(RP).length === 1, 'and it is in the sketch');

  // Tangency means the arc leaves along the line's own direction.
  const t = arcTangentAt(RP, arc.arc.id, arc.p1.id);
  const along = Math.atan2(0, 100);          // the line runs along +X
  const diff = Math.abs(Math.atan2(Math.sin(t - along), Math.cos(t - along)));
  assert(Math.min(diff, Math.PI - diff) < 1e-3,
    'arc should leave along the line, off by ' + (diff * 180 / Math.PI).toFixed(2) + '°');
});

check('a line drawn away from an arc end is made tangent too', () => {
  const RP = fresh();
  const arc = RP.addConstructionArc(0, 0, 100, 0, { sagitta: 30 });
  const p2 = RP.sketch.entities[arc.p2.id];
  const snap = RP.computeSnap(p2.x, p2.y, { kind: 'point' });
  const line = RP.addConstructionLine(p2.x, p2.y, p2.x + 90, p2.y + 40, { startSnap: snap });
  assert(line.tangents.length === 1, 'one tangent added, got ' + line.tangents.length);
});

check('no tangent is guessed at a corner where two lines already meet', () => {
  const RP = fresh();
  const a = RP.addConstructionLine(0, 0, 100, 0);
  const bSnap = RP.computeSnap(100, 0, { kind: 'point' });
  RP.addConstructionLine(100, 0, 100, 80, { startSnap: bSnap });
  const cSnap = RP.computeSnap(100, 0, { kind: 'point' });
  const arc = RP.addConstructionArc(100, 0, 170, 60, { startSnap: cSnap });
  assert(arc.tangents.length === 0,
    'two candidate lines is ambiguous, so nothing should be guessed');
});

check('an arc drawn in free space gets no tangent', () => {
  const RP = fresh();
  const arc = RP.addConstructionArc(200, 200, 300, 260, {});
  assert(arc.tangents.length === 0, 'nothing to be tangent to');
  assert(tangentsIn(RP).length === 0, 'and none in the sketch');
});

check('autoConstrain off suppresses the tangent as well', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  const snap = RP.computeSnap(100, 0, { kind: 'point' });
  RP.autoConstrain = false;
  const arc = RP.addConstructionArc(100, 0, 180, 60, { startSnap: snap });
  RP.autoConstrain = true;
  assert(arc.tangents.length === 0, 'the whole auto layer is one switch');
});

check('tangency survives dragging the line', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  RP.Sketch.addConstraint(RP.sketch, 'fix', [line.p1.id]);
  const snap = RP.computeSnap(100, 0, { kind: 'point' });
  const arc = RP.addConstructionArc(100, 0, 180, 60, { startSnap: snap });
  assert(arc.tangents.length === 1, 'tangent applied');

  // Swing the line's far end up; the arc must follow and stay smooth.
  RP.Sketch.dragPoint(RP.sketch, line.p2.id, 100, -40);
  RP.solveSketch();

  const sk = RP.sketch;
  const a = sk.entities[line.p1.id], b = sk.entities[line.p2.id];
  const along = Math.atan2(b.y - a.y, b.x - a.x);
  const t = arcTangentAt(RP, arc.arc.id, arc.p1.id);
  const diff = Math.abs(Math.atan2(Math.sin(t - along), Math.cos(t - along)));
  assert(Math.min(diff, Math.PI - diff) < 1e-3,
    'still tangent after the drag, off by ' + (diff * 180 / Math.PI).toFixed(2) + '°');
});

check('an inferred tangent does not move the geometry already drawn', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  const before = { x: RP.lines[0].x1, y: RP.lines[0].y1,
                   x2: RP.lines[0].x2, y2: RP.lines[0].y2 };
  const snap = RP.computeSnap(100, 0, { kind: 'point' });
  RP.addConstructionArc(100, 0, 180, 60, { startSnap: snap });

  // Nothing pins this line, so the solver COULD have swung it to meet the
  // arc. Inferring a constraint must not rearrange what is already there.
  assertClose(RP.lines[0].x1, before.x, 1e-6, 'start x held');
  assertClose(RP.lines[0].y1, before.y, 1e-6, 'start y held');
  assertClose(RP.lines[0].x2, before.x2, 1e-6, 'end x held');
  assertClose(RP.lines[0].y2, before.y2, 1e-6, 'end y held');
});

check('the temporary pins used to steer the solve are not left behind', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  const snap = RP.computeSnap(100, 0, { kind: 'point' });
  RP.addConstructionArc(100, 0, 180, 60, { startSnap: snap });
  const sk = RP.sketch;
  const fixes = RP.Sketch.constraintIds(sk).filter(id => sk.constraints[id].type === 'fix');
  assert(fixes.length === 0, 'expected no fix constraints, got ' + fixes.length);
});

check('deleting the line takes its tangent constraint with it', () => {
  const RP = fresh();
  const line = RP.addConstructionLine(0, 0, 100, 0);
  const snap = RP.computeSnap(100, 0, { kind: 'point' });
  RP.addConstructionArc(100, 0, 180, 60, { startSnap: snap });
  assert(tangentsIn(RP).length === 1, 'tangent applied');

  RP.removeConstructionLine(line.line.id);
  assert(tangentsIn(RP).length === 0,
    'a constraint referencing deleted geometry must go too');
});

check('adding a point is undoable', () => {
  const RP = fresh();
  RP.pushHistory('Add point');
  RP.addConstructionPoint(70, 70);
  assert(RP.points.length === 1, 'placed');
  RP.undo();
  assert(RP.points.length === 0, 'undone, got ' + RP.points.length);
  RP.redo();
  assert(RP.points.length === 1, 'redone');
});

if (!report()) process.exitCode = 1;
