/* ========================================================================
   run.js - Run every test suite.

     node tests/run.js
   ======================================================================== */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = ['boot.js', 'sketch.js', 'construction.js', 'sketch-ui.js',
                'route.js', 'action.js', 'route-ui.js', 'field.js', 'arc.js', 'golden.js'];
let failed = 0;

for (const suite of SUITES) {
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, suite)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    process.stdout.write(out);
  } catch (e) {
    failed++;
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
  }
}

console.log(failed === 0 ? '\nAll suites passed.' : '\n' + failed + ' suite(s) failed.');
if (failed) process.exitCode = 1;
