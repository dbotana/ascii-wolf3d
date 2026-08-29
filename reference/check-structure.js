// ─── STRUCTURE CHECK ─────────────────────────────────────────────────────────
//
// Guards the properties that make the split reversible and the bundle safe.
// None of these are things run-tests.js can catch: a build can be fully green
// and still have drifted somewhere that costs you later.
//
//   node reference/check-structure.js
//
// Checks:
//   1. Every <script src> in the manifest resolves to a file on disk.
//   2. No source uses import / export / type="module". This is the one that
//      matters most: ESM is what would make collapsing back to a single file a
//      rewrite instead of a copy, and it would break both file:// and the
//      harness's eval. See CLAUDE.md, "Two representations, one source of truth".
//   3. dist/wolf3d.html is current, so a stale artifact can never be deployed.
//   4. No source has grown past the line budget — a warning, not a failure.
//
// Exits non-zero on any failure, so it drops straight into CI next to the
// other two tools.

'use strict';

const fs = require('fs');
const path = require('path');
const { collectSources, DEFAULT_GAME } = require('./harness');
const { bundle, SRC, OUT } = require('./bundle');

const BUDGET = 400;

function main() {
  const problems = [];
  const warnings = [];

  // 1. every src resolves — collectSources throws with the offending path
  let sources;
  try {
    sources = collectSources(DEFAULT_GAME);
  } catch (e) {
    console.error('FAIL  ' + e.message);
    process.exit(1);
  }

  for (const s of sources) {
    const rel = path.relative(path.dirname(DEFAULT_GAME), s.path);

    // 2. no module syntax
    const lines = s.code.split('\n');
    lines.forEach((l, i) => {
      if (/^\s*(import|export)\b/.test(l) && !/^\s*\/\//.test(l)) {
        problems.push(rel + ':' + (i + 1) + '  module syntax: ' + l.trim());
      }
    });

    // 4. line budget
    if (lines.length > BUDGET) {
      warnings.push(rel + '  ' + lines.length + ' lines (budget ' + BUDGET +
                    ') — a signal to split, not a target to fill');
    }
  }

  const html = fs.readFileSync(DEFAULT_GAME, 'utf8');
  if (/<script[^>]*\btype\s*=\s*["']module["']/i.test(html)) {
    problems.push('wolf3d.html  <script type="module"> — classic scripts only');
  }

  // 3. the bundle is current
  const want = bundle(SRC);
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (have === null) problems.push('dist/wolf3d.html missing — run: node reference/bundle.js');
  else if (have !== want) problems.push('dist/wolf3d.html STALE — run: node reference/bundle.js');

  console.log('checked ' + sources.length + ' script sources from ' +
              path.basename(DEFAULT_GAME) + '\n');
  for (const w of warnings) console.log('  WARN  ' + w);
  for (const p of problems) console.log('  FAIL  ' + p);
  if (warnings.length && !problems.length) console.log('');

  if (problems.length) {
    console.log('\n' + problems.length + ' problem(s)');
    process.exit(1);
  }
  console.log((warnings.length ? '\n' : '') + 'structure ok');
}

if (require.main === module) main();
