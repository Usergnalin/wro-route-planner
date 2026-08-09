/* ========================================================================
   harness.js - Load the browser app into a Node vm context for testing.

   The app uses classic <script> tags and the `var RP = window.RP || {}`
   pattern, which relies on top-level `var` being a window property. A vm
   context with `window` aliased to the context itself reproduces that
   exactly, so app files load unmodified.
   ======================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// A permissive fake DOM element: any property access returns itself, and it
// is callable. That covers getContext(), addEventListener(), classList.add(),
// style.left = …, without needing to model the real DOM.
function fakeEl() {
  const el = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'value' || prop === 'textContent' ||
          prop === 'innerHTML' || prop === 'className') return '';
      if (prop === 'checked') return false;
      if (prop === 'length') return 0;
      if (prop === 'toString' || prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.iterator) return undefined;
      return el;
    },
    set() { return true; },
    apply() { return el; },
    has() { return true; }
  });
  return el;
}

// Files needed to exercise code generation. render.js / events.js are
// excluded: they wire up the DOM and are not on the codegen path.
const CODEGEN_FILES = [
  'js/core.js',
  'js/sketch/linalg.js',
  'js/sketch/sketch.js',
  'js/sketch/constraints.js',
  'js/sketch/solver.js',
  'js/routes.js',
  'js/model/construction.js',
  'js/model/route.js',
  'js/model/action.js',
  'js/model/resolver.js',
  'js/output.js',
  'js/config.js'
];

// Sketch layer — pure geometry, no DOM at all.
const SKETCH_FILES = [
  'js/sketch/linalg.js',
  'js/sketch/sketch.js',
  'js/sketch/constraints.js',
  'js/sketch/solver.js'
];

function loadApp(files) {
  const ctx = {};
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.console = console;
  ctx.devicePixelRatio = 1;
  ctx.innerWidth = 1280;
  ctx.innerHeight = 800;
  ctx.navigator = { userAgent: 'node' };
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};
  ctx.dispatchEvent = () => true;
  ctx.document = {
    getElementById: () => fakeEl(),
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
    createElement: () => fakeEl(),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: fakeEl(),
    documentElement: fakeEl()
  };
  ctx.localStorage = {
    _d: Object.create(null),
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
  ctx.alert = () => {};
  ctx.prompt = () => null;
  ctx.confirm = () => true;
  ctx.setTimeout = setTimeout;
  ctx.clearTimeout = clearTimeout;
  ctx.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  ctx.Image = function Image() {};
  ctx.Blob = function Blob() {};
  ctx.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  ctx.FileReader = function FileReader() {};
  ctx.getComputedStyle = () => fakeEl();
  ctx.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  function NoopObserver() {
    this.observe = function () {};
    this.unobserve = function () {};
    this.disconnect = function () {};
    this.takeRecords = function () { return []; };
  }
  ctx.ResizeObserver = NoopObserver;
  ctx.MutationObserver = NoopObserver;
  ctx.IntersectionObserver = NoopObserver;

  vm.createContext(ctx);

  // Entries are either a path relative to ROOT, or { name, code } for
  // source already in hand — which is how the built single-file bundle
  // gets booted the same way the loose sources are, without writing its
  // inlined scripts back out to disk.
  for (const entry of files) {
    const src = (typeof entry === 'string')
      ? { name: entry, code: readSource(entry) }
      : entry;
    try {
      vm.runInContext(src.code, ctx, { filename: src.name });
    } catch (e) {
      throw new Error('harness: failed loading ' + src.name + '\n  ' + e.message);
    }
  }

  if (!ctx.RP) throw new Error('harness: RP namespace never created');
  return ctx;
}

function readSource(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error('harness: missing file ' + rel);
  return fs.readFileSync(abs, 'utf8');
}

// ----------------------------------------------------------------------
// Tiny assertion helpers shared by the test scripts
// ----------------------------------------------------------------------
function makeRunner(label) {
  const state = { pass: 0, fail: 0, failures: [] };

  function check(name, fn) {
    try {
      fn();
      state.pass++;
    } catch (e) {
      state.fail++;
      state.failures.push({ name, message: e.message });
    }
  }

  function report() {
    for (const f of state.failures) {
      console.log('  FAIL  ' + f.name);
      for (const line of String(f.message).split('\n')) {
        console.log('        ' + line);
      }
    }
    const total = state.pass + state.fail;
    console.log(
      (state.fail === 0 ? 'PASS' : 'FAIL') +
      '  ' + label + ': ' + state.pass + '/' + total + ' passed'
    );
    return state.fail === 0;
  }

  return { check, report, state };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertClose(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(
      (msg ? msg + ': ' : '') +
      'expected ' + expected + ' ± ' + tol + ', got ' + actual
    );
  }
}

// Every script index.html loads, in page order. Parsed rather than
// hardcoded so tests cannot drift from the real page.
function appFiles() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

module.exports = {
  ROOT,
  CODEGEN_FILES,
  SKETCH_FILES,
  appFiles,
  loadApp,
  makeRunner,
  assert,
  assertClose
};
