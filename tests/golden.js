/* ========================================================================
   golden.js - Regression guard for code generation.

   Runs RP.generateCode() over each fixture and diffs against a captured
   baseline. Any refactor that changes generated code will fail loudly.

     node tests/golden.js            verify against baselines
     node tests/golden.js --update   re-capture baselines (review the diff!)
   ======================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadApp, CODEGEN_FILES } = require('./harness');
const { FIXTURES } = require('./fixtures');

const EXPECTED_DIR = path.join(__dirname, 'expected');
const update = process.argv.includes('--update');

function firstDiff(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return '  line ' + (i + 1) + '\n' +
             '    expected: ' + JSON.stringify(la[i]) + '\n' +
             '    actual:   ' + JSON.stringify(lb[i]);
    }
  }
  return '  (identical)';
}

function main() {
  if (!fs.existsSync(EXPECTED_DIR)) fs.mkdirSync(EXPECTED_DIR, { recursive: true });

  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const fx of FIXTURES) {
    let actual;
    try {
      const ctx = loadApp(CODEGEN_FILES);
      const route = fx.build(ctx);
      // Fixtures are written against the OLD node/segment model on
      // purpose: running them through the migration is what proves old
      // projects still generate byte-identical code.
      ctx.RP.migrateRoutesToElements();
      actual = ctx.RP.generateCode(route);
      if (typeof actual !== 'string' || actual.length === 0) {
        throw new Error('generateCode returned empty output');
      }
    } catch (e) {
      fail++;
      failures.push({ name: fx.name, detail: '  threw: ' + e.message });
      continue;
    }

    const file = path.join(EXPECTED_DIR, fx.name + '.txt');

    if (update || !fs.existsSync(file)) {
      fs.writeFileSync(file, actual, 'utf8');
      console.log('  captured  ' + fx.name);
      pass++;
      continue;
    }

    const expected = fs.readFileSync(file, 'utf8');
    if (expected === actual) {
      pass++;
    } else {
      fail++;
      failures.push({ name: fx.name, detail: firstDiff(expected, actual) });
    }
  }

  for (const f of failures) {
    console.log('  FAIL  ' + f.name);
    console.log(f.detail);
  }

  const total = pass + fail;
  console.log(
    (fail === 0 ? 'PASS' : 'FAIL') +
    '  golden codegen: ' + pass + '/' + total +
    (update ? ' (baselines updated)' : '')
  );
  return fail === 0;
}

if (!main()) process.exitCode = 1;
