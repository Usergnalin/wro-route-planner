/* ========================================================================
   boot.js - Smoke test: load every script index.html references, in the
   order the page loads them.

   The script list is parsed out of index.html rather than hardcoded, so
   this cannot drift from the real page. It catches syntax errors, broken
   load order, and load-time crashes without needing a browser.

     node tests/boot.js
   ======================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadApp, makeRunner, assert } = require('./harness');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const scripts = [];
const re = /<script\s+src=["']([^"']+)["']/gi;
let match;
while ((match = re.exec(html)) !== null) scripts.push(match[1]);

const { check, report } = makeRunner('boot');

check('index.html references at least the core scripts', () => {
  assert(scripts.length > 0, 'no <script src> tags found in index.html');
  assert(scripts.indexOf('js/core.js') >= 0, 'js/core.js not referenced');
});

check('every referenced script exists on disk', () => {
  const missing = scripts.filter(s => !fs.existsSync(path.join(ROOT, s)));
  assert(missing.length === 0, 'missing: ' + missing.join(', '));
});

check('all scripts load in page order without throwing', () => {
  const ctx = loadApp(scripts);
  assert(!!ctx.RP, 'RP namespace missing after load');
});

check('sketch layer is present and wired up', () => {
  const ctx = loadApp(scripts);
  const RP = ctx.RP;
  assert(typeof RP.LinAlg.luSolve === 'function', 'LinAlg.luSolve missing');
  assert(typeof RP.Sketch.create === 'function', 'Sketch.create missing');
  assert(typeof RP.Sketch.solve === 'function', 'Sketch.solve missing');
  assert(typeof RP.Sketch.dragPoint === 'function', 'Sketch.dragPoint missing');
  for (const t of ['coincident', 'point_on_line', 'horizontal', 'vertical',
                   'distance', 'angle', 'fix']) {
    assert(!!RP.Sketch.constraintDefs[t], 'constraint "' + t + '" not registered');
  }
  assert(!!RP.Sketch.entityDefs.arc, 'arc entity equations not registered');
});

check('existing app surface still intact', () => {
  const ctx = loadApp(scripts);
  const RP = ctx.RP;
  for (const fn of ['generateCode', 'computeSteps', 'computeLongestPath',
                    'computeSnap', 'render']) {
    assert(typeof RP[fn] === 'function', 'RP.' + fn + ' missing');
  }
});

check('sketch layer works end to end after a full page load', () => {
  const ctx = loadApp(scripts);
  const S = ctx.RP.Sketch;
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 90, 12);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'horizontal', [line.id]);
  S.addConstraint(sk, 'distance', [line.id], 100);
  const res = S.solve(sk);
  assert(res.ok && res.status === 'full', 'expected full, got ' + res.status);
  assert(Math.abs(b.x - 100) < 1e-6 && Math.abs(b.y) < 1e-6,
    'expected (100,0), got (' + b.x + ',' + b.y + ')');
});

check('no duplicate element ids', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  assert(dup.length === 0, 'duplicated: ' + dup.join(', '));
});

check('bottom panels are split by edit mode', () => {
  for (const id of ['panel-geometry', 'panel-constraints', 'instr-panel', 'panel-maps']) {
    assert(html.indexOf('id="' + id + '"') >= 0, 'missing panel: ' + id);
  }
  // The sketch-mode lists live in the bottom panels, not the sidebar.
  const panelsAt = html.indexOf('id="side-panels"');
  assert(html.indexOf('id="layer-list"') > panelsAt, 'layer-list should be a bottom panel');
  assert(html.indexOf('id="constraint-list"') > panelsAt, 'constraint-list should be a bottom panel');
});

check('the Saved Routes panel is gone', () => {
  assert(!/Saved Routes/.test(html), 'Saved Routes panel should be removed');
  assert(html.indexOf('id="route-list"') < 0, 'route-list element should be removed');
  assert(html.indexOf('id="route-select"') < 0, 'route-select element should be removed');
});

check('sidebar keeps the tools and palette, not the long lists', () => {
  const left = html.indexOf('id="left-sidebar"');
  const panelsAt = html.indexOf('id="side-panels"');
  assert(html.indexOf('id="tool-section"') > left, 'tool section on the left');
  assert(html.indexOf('id="constraint-section"') > left, 'palette on the left');
  assert(html.indexOf('id="constraint-section"') < panelsAt, 'palette above the panels');
});

check('every element the scripts resolve at load time is parsed first', () => {
  // initEvents / core.js call getElementById while the page is still
  // parsing, so anything they resolve has to appear ABOVE the <script>
  // block. #ctx-menu sat below it and silently resolved to null, which
  // disabled the right-click menu entirely.
  const firstScript = html.indexOf('<script src=');
  assert(firstScript >= 0, 'no <script src> block found');
  const js = scripts
    .filter(s => fs.existsSync(path.join(ROOT, s)))
    .map(s => fs.readFileSync(path.join(ROOT, s), 'utf8'))
    .join('\n');
  const late = [...new Set([...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))]
    .filter(id => {
      const at = html.indexOf('id="' + id + '"');
      return at >= 0 && at > firstScript;
    });
  assert(late.length === 0, 'declared after the scripts: ' + late.join(', '));
});

check('the dead segment / node panels are gone', () => {
  for (const id of ['segment-section', 'node-section', 'seg-mode-normal',
                    'seg-offset', 'seg-speed', 'btn-flip-segment',
                    'node-turn-speed', 'node-extra-turns-list', 'btn-add-node-turn']) {
    assert(html.indexOf('id="' + id + '"') < 0, id + ' should be removed');
  }
  const ctx = loadApp(scripts);
  const RP = ctx.RP;
  // These all wrote to route.nodes / route.segments, which are derived
  // read-only views — the writes vanished on the next rebuild.
  for (const fn of ['updateSegmentPanel', 'updateNodePanel', 'getSelectedNodeObj',
                    'rebuildNodeTurnsList', 'removeSegment', 'removeNode',
                    'flipSegmentDirection', 'setSegmentMode', 'setSegmentTeleportName',
                    'setSegmentJunctionCount', 'findSegment', 'arcApex',
                    'defaultArcSagitta']) {
    assert(RP[fn] === undefined, 'RP.' + fn + ' should be deleted');
  }
  assert(!('selectedSegment' in RP), 'RP.selectedSegment should be deleted');
  assert(!('selectedNode' in RP), 'RP.selectedNode should be deleted');
});

if (!report()) process.exitCode = 1;
