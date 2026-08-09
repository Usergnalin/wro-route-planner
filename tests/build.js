/* ========================================================================
   build.js - The portable single-file build.

   The whole point of dist/wro-planner.html is that you can hand it to
   someone on a USB stick and it works. That only stays true if the build
   keeps producing something self-contained and bootable, so this runs the
   real build and then boots its output the same way boot.js boots the
   loose sources.

     node tests/build.js
   ======================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadApp, makeRunner, assert } = require('./harness');

const { check, report } = makeRunner('portable build');

const builder = require(path.join(ROOT, 'build.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let built = null;
function output() {
  if (built === null) {
    builder.build();
    built = fs.readFileSync(builder.OUT, 'utf8');
  }
  return built;
}

// The inlined <script> bodies, in the order the page runs them.
function inlineScripts(src) {
  const out = [];
  const re = /<script>\n([\s\S]*?)\n<\/script>/g;
  let m, i = 0;
  while ((m = re.exec(src)) !== null) out.push({ name: 'inline#' + (++i), code: m[1] });
  return out;
}

check('the build runs and writes one file', () => {
  const res = builder.build();
  assert(fs.existsSync(builder.OUT), 'no output written');
  assert(res.inlined.length > 0, 'nothing was inlined');
  assert(res.bytes > 100000, 'output looks too small: ' + res.bytes + ' bytes');
});

check('nothing is left to fetch from disk', () => {
  const src = output();
  assert(!/<script\s+src=/i.test(src), 'a <script src> survived the build');
  assert(!/<link\s+rel="stylesheet"/i.test(src), 'a stylesheet link survived the build');
});

check('every source the page references is actually in there', () => {
  const src = output();
  const refs = [...html.matchAll(/(?:src|href)="((?:js|style)[^"]*)"/g)].map(m => m[1]);
  assert(refs.length > 0, 'index.html referenced nothing');
  for (const rel of refs) {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8').trim();
    // The first non-trivial line is enough of a fingerprint, and unlike a
    // whole-file compare it survives the trailing-whitespace trim.
    const probe = body.split('\n').find(l => l.trim().length > 20);
    assert(src.indexOf(probe.trim()) >= 0, rel + ' is missing from the bundle');
  }
});

check('the bundle boots and the solver works inside it', () => {
  const scripts = inlineScripts(output());
  assert(scripts.length >= 15, 'expected the full script set, got ' + scripts.length);

  const ctx = loadApp(scripts);
  const RP = ctx.RP;
  assert(typeof RP.generateCode === 'function', 'codegen missing from the bundle');
  assert(typeof RP.Sketch.solve === 'function', 'solver missing from the bundle');

  const S = RP.Sketch;
  const sk = S.create();
  const a = S.addPoint(sk, 0, 0);
  const b = S.addPoint(sk, 90, 12);
  const line = S.addLine(sk, a.id, b.id);
  S.addConstraint(sk, 'fix', [a.id]);
  S.addConstraint(sk, 'horizontal', [line.id]);
  S.addConstraint(sk, 'distance', [line.id], 100);
  const res = S.solve(sk);
  assert(res.ok && res.status === 'full', 'solve failed in the bundle: ' + res.status);
  assert(Math.abs(b.x - 100) < 1e-6 && Math.abs(b.y) < 1e-6, 'wrong solution in the bundle');
});

check('the bundle generates the same code as the loose sources', () => {
  // If these ever diverge, the file people actually carry around is not
  // the thing the rest of the suite has been testing.
  const { CODEGEN_FILES } = require('./harness');
  const { FIXTURES } = require('./fixtures');

  const scripts = inlineScripts(output());
  for (const fx of FIXTURES) {
    const loose = loadApp(CODEGEN_FILES);
    const looseRoute = fx.build(loose);
    loose.RP.migrateRoutesToActions();
    const expected = loose.RP.generateCode(looseRoute);

    const bundle = loadApp(scripts);
    const bundleRoute = fx.build(bundle);
    bundle.RP.migrateRoutesToActions();
    const actual = bundle.RP.generateCode(bundleRoute);

    assert(actual === expected, fx.name + ' differs between bundle and sources');
  }
});

check('a tag-closing string in a source would fail the build loudly', () => {
  // Silent truncation is the one way this build can produce a file that
  // looks fine and is broken, so it must throw rather than emit.
  const victim = path.join(ROOT, 'js', '__build_probe.js');
  const marker = '/* ' + '</scr' + 'ipt>' + ' */';
  fs.writeFileSync(victim, marker + '\nvar RP = window.RP || {};\n', 'utf8');
  const idx = path.join(ROOT, 'index.html');
  const original = fs.readFileSync(idx, 'utf8');
  try {
    fs.writeFileSync(idx,
      original.replace('<script src="js/main.js"></script>',
        '<script src="js/__build_probe.js"></script>\n<script src="js/main.js"></script>'),
      'utf8');
    let threw = null;
    try { builder.build(); } catch (e) { threw = e; }
    assert(threw !== null, 'the build should have refused to inline that');
    assert(/would end the inlined tag early/.test(threw.message),
      'unhelpful error: ' + (threw && threw.message));
  } finally {
    fs.writeFileSync(idx, original, 'utf8');
    fs.unlinkSync(victim);
    builder.build();          // leave a good artefact behind
  }
});

if (!report()) process.exitCode = 1;
