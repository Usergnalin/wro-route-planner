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

if (!report()) process.exitCode = 1;
