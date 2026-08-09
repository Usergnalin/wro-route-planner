#!/usr/bin/env node
/* ========================================================================
   build.js - Fold the app into one self-contained HTML file.

     node build.js              ->  dist/wro-planner.html

   No dependencies, and there never will be: this reads index.html,
   replaces the stylesheet link and every <script src> with the file's
   contents, and writes the result. Load order is whatever index.html
   says, because that is the only place it is defined.

   Nothing is minified. The output is meant to stay readable — it is the
   thing you hand to a teammate on a USB stick, and being able to open it
   in an editor and see real code is worth more than shaving 100 KB off a
   file that already fits on a floppy disk.

   The mat photograph is deliberately NOT embedded. It is 2.6 MB, it is
   only a sample, and you load your own anyway.
   ======================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SOURCE = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'wro-planner.html');

// A script or stylesheet containing this would close the tag it is being
// inlined into and turn the rest of the file into markup. Nothing in the
// app does today; this makes sure a future edit cannot do it silently.
function assertInlineSafe(file, body, closer) {
  const at = body.toLowerCase().indexOf(closer);
  if (at >= 0) {
    const line = body.slice(0, at).split('\n').length;
    throw new Error(
      file + ':' + line + ' contains "' + closer + '", which would end the ' +
      'inlined tag early. Split the literal (e.g. "<\\/scr" + "ipt>") and rebuild.'
    );
  }
}

function read(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error('index.html references a missing file: ' + rel);
  return fs.readFileSync(file, 'utf8');
}

function build() {
  let html = fs.readFileSync(SOURCE, 'utf8');
  const inlined = [];

  html = html.replace(
    /[ \t]*<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/gi,
    (m, href) => {
      const css = read(href);
      assertInlineSafe(href, css, '</style');
      inlined.push(href);
      return '<style>\n' + css.trimEnd() + '\n</style>';
    }
  );

  html = html.replace(
    /[ \t]*<script\s+src="([^"]+)"\s*><\/script>/gi,
    (m, src) => {
      const js = read(src);
      assertInlineSafe(src, js, '</script');
      inlined.push(src);
      return '<script>\n' + js.trimEnd() + '\n</script>';
    }
  );

  if (/<script\s+src=|<link\s+rel="stylesheet"/i.test(html)) {
    throw new Error('something in index.html was not inlined — check the tag formatting');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  html = html.replace(/<head>/i,
    '<head>\n<!-- Built by build.js on ' + stamp + ' from ' + inlined.length +
    ' source files. Self-contained: open it straight from disk. -->');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  return { inlined, bytes: Buffer.byteLength(html, 'utf8') };
}

if (require.main === module) {
  try {
    const res = build();
    console.log('wrote ' + path.relative(ROOT, OUT) +
      '  (' + res.inlined.length + ' files, ' + (res.bytes / 1024).toFixed(0) + ' KB)');
  } catch (err) {
    console.error('build failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = { build, OUT };
