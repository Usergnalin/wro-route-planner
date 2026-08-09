/* ========================================================================
   fixtures.js - Synthetic projects that exercise each computeSteps path.

   These are the inputs for the golden codegen tests. Built programmatically
   rather than captured from localStorage so they are readable and stable.
   ======================================================================== */
'use strict';

function reset(ctx) {
  const RP = ctx.RP;
  RP.calibration = { pixelsPerMm: 2 };   // 2 px = 1 mm
  RP.imgNaturalW = 2000;
  RP.imgNaturalH = 1200;
  RP.robotConfig = RP.freshRobotConfig();
  RP.codeConfig = RP.freshCodeConfig();
  RP.ensureCodeConfig();
  // Codegen does not touch construction geometry — the golden suite loads
  // only the codegen files, which is itself part of what it proves.
  RP.lines = [];
  RP.routes = [];
  RP.nextWpId = 1;
  RP.nextSegId = 1;
  RP.nextRouteId = 1;
  RP.activeRouteId = null;
  return RP;
}

function mkRoute(RP, name) {
  const r = { id: RP.nextRouteId++, name: name, nodes: [], segments: [], visible: true };
  RP.routes.push(r);
  RP.activeRouteId = r.id;
  return r;
}

function node(RP, r, x, y, props) {
  const n = Object.assign(
    { id: RP.nextWpId++, x: x, y: y, isCheckpoint: false, checkpointName: null },
    props || {}
  );
  r.nodes.push(n);
  return n;
}

function seg(RP, r, a, b, props) {
  const s = Object.assign(
    {
      id: RP.nextSegId++,
      fromNodeId: a.id,
      toNodeId: b.id,
      direction: RP.SEG_FORWARD,
      mode: RP.SEG_MODE_NORMAL
    },
    props || {}
  );
  r.segments.push(s);
  return s;
}

const FIXTURES = [
  {
    // Virtual start leg + geometric turn + forward.
    name: 'l_shape_with_start',
    build(ctx) {
      const RP = reset(ctx);
      RP.robotConfig.startPos = { x: 100, y: 300 };
      RP.robotConfig.startHeading = 0;
      const r = mkRoute(RP, 'L shape');
      const a = node(RP, r, 100, 100);
      const b = node(RP, r, 500, 100);
      const c = node(RP, r, 500, 400);
      seg(RP, r, a, b);
      seg(RP, r, b, c);
      return r;
    }
  },
  {
    // Checkpoints at first node, a middle node and the last node.
    name: 'checkpoints',
    build(ctx) {
      const RP = reset(ctx);
      const r = mkRoute(RP, 'Checkpoint run');
      const a = node(RP, r, 100, 100, { isCheckpoint: true, checkpointName: 'start_cp' });
      const b = node(RP, r, 400, 100);
      const c = node(RP, r, 700, 100, { isCheckpoint: true, checkpointName: 'grab_block' });
      const d = node(RP, r, 700, 500, { isCheckpoint: true, checkpointName: 'finish' });
      seg(RP, r, a, b);
      seg(RP, r, b, c);
      seg(RP, r, c, d);
      return r;
    }
  },
  {
    // teleport / linetrace_dist / linetrace_junct / wall_align
    name: 'segment_modes',
    build(ctx) {
      const RP = reset(ctx);
      const r = mkRoute(RP, 'Modes');
      const a = node(RP, r, 100, 100);
      const b = node(RP, r, 400, 100);
      const c = node(RP, r, 700, 100);
      const d = node(RP, r, 700, 400);
      const e = node(RP, r, 1000, 400);
      seg(RP, r, a, b, { mode: RP.SEG_MODE_LINETRACE_DIST, offset: 12 });
      seg(RP, r, b, c, { mode: RP.SEG_MODE_LINETRACE_JUNCT, junctionCount: 3 });
      seg(RP, r, c, d, { mode: RP.SEG_MODE_TELEPORT, teleportName: 'hop_to_zone_b' });
      seg(RP, r, d, e, { mode: RP.SEG_MODE_WALL_ALIGN });
      return r;
    }
  },
  {
    // Sagitta-based arc segment (existing SEG_MODE_ARC path).
    name: 'arc_segment',
    build(ctx) {
      const RP = reset(ctx);
      const r = mkRoute(RP, 'Arc');
      const a = node(RP, r, 200, 200);
      const b = node(RP, r, 600, 200);
      const c = node(RP, r, 900, 500);
      seg(RP, r, a, b, { mode: RP.SEG_MODE_ARC, sagitta: 80 });
      seg(RP, r, b, c);
      return r;
    }
  },
  {
    // Per-segment speed + offset, per-node turn speed, extra turns in both
    // the bare-number and {deg,speed} object forms.
    name: 'speeds_and_extra_turns',
    build(ctx) {
      const RP = reset(ctx);
      const r = mkRoute(RP, 'Speeds');
      const a = node(RP, r, 100, 100, { extraTurns: [90] });
      const b = node(RP, r, 500, 100, { turnSpeed: 120, extraTurns: [{ deg: -45, speed: 80 }] });
      const c = node(RP, r, 500, 600, { extraTurns: [180] });
      seg(RP, r, a, b, { speed: 300, offset: -10 });
      seg(RP, r, b, c, { speed: 150 });
      return r;
    }
  },
  {
    // Backward segment, plus a segment stored to->from so it is traversed
    // in reverse (exercises the effectiveBackward XOR).
    name: 'reverse_traversal',
    build(ctx) {
      const RP = reset(ctx);
      const r = mkRoute(RP, 'Reverse');
      const a = node(RP, r, 100, 100);
      const b = node(RP, r, 500, 100);
      const c = node(RP, r, 900, 100);
      seg(RP, r, a, b, { direction: RP.SEG_BACKWARD });
      seg(RP, r, c, b);   // stored c->b, walked b->c
      return r;
    }
  },
  {
    // Y-shaped branching route. Guards current longest-path behaviour so the
    // Phase 5 resolver change is a visible, intentional diff.
    name: 'branching_y',
    build(ctx) {
      const RP = reset(ctx);
      const r = mkRoute(RP, 'Branch');
      const a = node(RP, r, 100, 100);
      const b = node(RP, r, 400, 100);
      const c = node(RP, r, 900, 100);   // long arm
      const d = node(RP, r, 400, 300);   // short arm
      seg(RP, r, a, b);
      seg(RP, r, b, c);
      seg(RP, r, b, d);
      return r;
    }
  }
];

module.exports = { FIXTURES, reset, mkRoute, node, seg };
