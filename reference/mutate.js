#!/usr/bin/env node
// ─── MUTATION BATTERY ────────────────────────────────────────────────────────
//
// Injects a known bug into a copy of the game and requires the suite to go red
// for it. This is the tool that tells green apart from covered.
//
//   node reference/mutate.js                 # the whole catalog
//   node reference/mutate.js --list          # print it, run nothing
//   node reference/mutate.js --only=nav      # substring filter on id / file / group
//   node reference/mutate.js --jobs=4        # default: min(cpus, 8)
//   node reference/mutate.js --verbose       # per-mutant suite output on failure
//   node reference/mutate.js --keep          # leave the scratch trees behind
//
// Exits non-zero if a killable mutation survives, an anchor has gone stale, a
// mutation marked unkillable turns out to be killable, or the baseline is red.
//
// ── Why this exists
//
// The suite has been mutation-tested five times — 16 bugs at the MVP, 20 over
// Phase 1, 14 over Phase 2, 31 over Phase 3, 11 over Phase 4 — and SEVEN of
// those survived a fully green suite. Several were real gaps: push-walls that
// blocked neither rays nor bodies, a CEO standoff with no assertion behind it,
// a spread roll moved inside the candidate loop, a jamb rejection no ray under
// test could see. Every one of those batteries was rebuilt from scratch and
// then thrown away with the session. This file is the fifth rebuild, kept.
//
// ── How a mutant is run
//
// The game is copied — wolf3d.html plus wolf3d/ — one patch is applied to the
// copy, and the PRISTINE suite is pointed at it with WOLF3D_HTML. reference/ is
// never copied: the tools have to stay honest, and collectSources() resolves
// every <script src> relative to the HTML's own directory, so a copy of the
// game alone is a complete game. That also keeps fixtures working, because
// loadWithLevel reads its htmlPath from the same env var.
//
// ── The two ways a battery lies to you
//
// 1. A STALE ANCHOR. If `find` no longer appears in the file — a rename, a
//    reflow, a refactor — the patch is a no-op and the pristine game runs. It
//    goes green, reads as SURVIVED, and sends you hunting for a coverage gap
//    that does not exist; or it goes red for an unrelated reason and reads as
//    a kill it never made. So every entry declares how many times its anchor
//    must match, and a mismatch is a hard error, not a warning.
//
// 2. A KNOWN GAP. A mutation that survives because nothing tests that
//    behaviour YET is real news the first time and noise every run after. So a
//    survivor that has been triaged carries `gap: '<what it would take>'` and
//    is reported, loudly, without failing the run. What DOES fail is a change
//    in either direction: a mutation with no marker that survives is a new
//    hole, and one marked `gap` that dies is covered now and its marker has to
//    go. That makes this a ratchet — the count can fall, never rise — instead
//    of a check that is red forever and therefore read by nobody.
//
// 3. AN UNKILLABLE MUTATION. Some bugs cannot be observed at all — not because
//    the suite is thin, but because the two branches are provably equal for
//    every input the game can reach. Phase 4 has a documented example: swapping
//    `c.axis` for the DDA's `side` in castGrid's `lat` line survives everything,
//    because for any door validate-level.js accepts, the two are the same
//    number. Chasing that a second time is pure waste, so it carries
//    `unkillable: '<reason>'` and is EXPECTED to survive. If one ever dies, that
//    is reported as a failure too: it means a test is claiming coverage it
//    cannot have, and the marker is now a lie.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATIONS = require('./mutations');

const arg = (name, dflt) => {
  const hit = process.argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = name => process.argv.includes('--' + name);

const VERBOSE = flag('verbose');
const KEEP    = flag('keep');
const ONLY    = arg('only', null);
const JOBS    = Math.max(1, parseInt(arg('jobs', Math.min(os.cpus().length, 8)), 10));

// What a mutant needs to be a complete game. reference/ is deliberately absent.
const GAME_PARTS = ['wolf3d.html', 'wolf3d'];

// ── catalog validation ───────────────────────────────────────────────────────

/** Static checks on the catalog itself, before anything is run. */
function lintCatalog(list) {
  const problems = [];
  const seen = new Set();
  for (const m of list) {
    const where = m.id || '(no id)';
    if (!m.id) problems.push('a mutation has no id');
    else if (seen.has(m.id)) problems.push(where + ': duplicate id');
    seen.add(m.id);
    if (!m.file)   problems.push(where + ': no file');
    if (!m.find)   problems.push(where + ': no find');
    if (m.replace === undefined) problems.push(where + ': no replace');
    if (m.find === m.replace) problems.push(where + ': find and replace are identical');
    if (!m.note)   problems.push(where + ': no note — say what the bug DOES');
    if (m.gap && m.unkillable)
      problems.push(where + ': marked both gap and unkillable — a gap is testable ' +
                    'and not tested yet; unkillable is not testable at all');
    if (m.file && !fs.existsSync(path.join(ROOT, m.file))) {
      problems.push(where + ': ' + m.file + ' does not exist');
      continue;
    }
    // The anchor check, up front rather than per-mutant. A `find` that no
    // longer matches makes its patch a no-op, and a no-op mutant runs the
    // PRISTINE game — it goes green, reads as SURVIVED, and sends the next
    // reader hunting a coverage gap that does not exist. Catching that here
    // costs one file read instead of a whole suite run, and it means --list is
    // enough to tell you the catalog has rotted.
    if (m.file && m.find) {
      const want = m.count === undefined ? 1 : m.count;
      const src = fs.readFileSync(path.join(ROOT, m.file), 'utf8');
      const got = src.split(m.find).length - 1;
      if (got !== want) {
        problems.push(where + ': STALE ANCHOR — matched ' + got + ' time(s) in ' +
                      m.file + ', expected ' + want + '\n      ' +
                      JSON.stringify(m.find.slice(0, 90)));
      }
    }
  }
  return problems;
}

// ── one mutant ───────────────────────────────────────────────────────────────

function copyGame(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const part of GAME_PARTS) {
    fs.cpSync(path.join(ROOT, part), path.join(dest, part), { recursive: true });
  }
}

/**
 * Apply one patch to a copied tree.
 * @returns {string|null} an error message, or null on success.
 */
function applyPatch(dest, m) {
  const target = path.join(dest, m.file);
  if (!fs.existsSync(target)) return 'file missing from the copy: ' + m.file;
  const src = fs.readFileSync(target, 'utf8');
  const want = m.count === undefined ? 1 : m.count;
  const got = src.split(m.find).length - 1;
  if (got !== want) {
    return 'STALE ANCHOR — `' + m.find.slice(0, 70) + '` matched ' + got +
           ' time(s) in ' + m.file + ', expected ' + want +
           '\n      the patch would be a no-op and the verdict meaningless; re-anchor it';
  }
  fs.writeFileSync(target, src.split(m.find).join(m.replace));
  return null;
}

function runSuite(htmlPath) {
  return new Promise(resolve => {
    const child = spawn(process.execPath,
      [path.join(ROOT, 'reference', 'run-tests.js'), '--bail'],
      { cwd: ROOT, env: Object.assign({}, process.env, { WOLF3D_HTML: htmlPath }) });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
    child.on('error', e => resolve({ code: -1, out: String(e) }));
  });
}

async function runMutant(m, scratch) {
  const dest = path.join(scratch, m.id);
  copyGame(dest);
  const bad = applyPatch(dest, m);
  if (bad) return { m, verdict: 'STALE', detail: bad };
  const { code, out } = await runSuite(path.join(dest, 'wolf3d.html'));
  if (!KEEP) fs.rmSync(dest, { recursive: true, force: true });
  // A load failure is not a kill. assertProbe throws by name when a source
  // fails to evaluate, and a mutation that breaks the parse would otherwise
  // read as covered by every assertion in the file.
  if (/incomplete game load|SyntaxError|ReferenceError: \w+ is not defined/.test(out) &&
      !/passed, \d+ failed/.test(out)) {
    return { m, verdict: 'BROKEN', detail: firstLines(out, 6) };
  }
  return { m, verdict: code === 0 ? 'SURVIVED' : 'KILLED', out };
}

const firstLines = (s, n) => s.split('\n').filter(Boolean).slice(0, n).map(l => '      ' + l).join('\n');

/** The assertion a mutant died on — the useful line out of a bailed run. */
const killedBy = out => {
  const line = (out.split('\n').find(l => l.includes('FAIL  ')) || '').trim();
  return line.replace(/^FAIL\s+/, '');
};

// ── pool ─────────────────────────────────────────────────────────────────────

async function runPool(list, scratch, onDone) {
  const queue = list.slice();
  const results = [];
  const workers = new Array(Math.min(JOBS, queue.length)).fill(0).map(async () => {
    for (;;) {
      const m = queue.shift();
      if (!m) return;
      const r = await runMutant(m, scratch);
      results.push(r);
      onDone(r, results.length);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const lint = lintCatalog(MUTATIONS);
  if (lint.length) {
    console.error('the catalog itself is broken:\n');
    for (const p of lint) console.error('  ' + p);
    process.exit(1);
  }

  const list = ONLY
    ? MUTATIONS.filter(m => (m.id + ' ' + m.file + ' ' + (m.group || '')).includes(ONLY))
    : MUTATIONS;

  if (flag('list')) {
    let group = null;
    for (const m of MUTATIONS) {
      if (m.group !== group) { group = m.group; console.log('\n' + group); }
      const mark = m.unkillable ? 'UNKILLABLE  ' : m.gap ? 'GAP  ' : '';
      console.log('  ' + m.id.padEnd(34) + mark + m.note);
    }
    console.log('\n' + MUTATIONS.length + ' mutations, ' +
                MUTATIONS.filter(m => m.gap).length + ' known gaps, ' +
                MUTATIONS.filter(m => m.unkillable).length + ' unkillable');
    return 0;
  }

  if (!list.length) {
    console.error('no mutations match --only=' + ONLY);
    return 1;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wolf3d-mutants-'));
  console.log('mutation battery — ' + list.length + ' mutation(s), ' + JOBS + ' job(s)');
  console.log('scratch: ' + scratch + (KEEP ? '  (kept)' : ''));

  // ── baseline, through the same copy path. A red baseline would make every
  //    mutant read as KILLED, and a copy that drops a file would do the same —
  //    so the baseline is a copied tree, not the working one.
  const base = path.join(scratch, '__baseline');
  copyGame(base);
  const t0 = Date.now();
  const baseline = await runSuite(path.join(base, 'wolf3d.html'));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (baseline.code !== 0) {
    console.error('\nBASELINE IS RED — every mutant would read as killed. Fix the tree first.\n');
    console.error(firstLines(baseline.out, 20));
    return 1;
  }
  const tally = (baseline.out.match(/(\d+) passed/) || [])[1] || '?';
  console.log('baseline: GREEN, ' + tally + ' assertions in ' + secs + 's\n');
  if (!KEEP) fs.rmSync(base, { recursive: true, force: true });

  const started = Date.now();
  const results = await runPool(list, scratch, (r, n) => {
    const tag = r.verdict === 'KILLED'   ? 'killed  '
              : r.verdict === 'SURVIVED' ? (r.m.unkillable ? 'survived' : 'SURVIVED')
              : r.verdict.toLowerCase().padEnd(8);
    process.stdout.write('  [' + String(n).padStart(3) + '/' + list.length + '] ' +
                         tag + '  ' + r.m.id + '\n');
  });

  // ── report
  const byId = id => results.find(r => r.m.id === id);
  const order = list.map(m => byId(m.id));

  const stale    = order.filter(r => r.verdict === 'STALE');
  const broken   = order.filter(r => r.verdict === 'BROKEN');
  const survived = order.filter(r => r.verdict === 'SURVIVED' && !r.m.unkillable && !r.m.gap);
  const gaps     = order.filter(r => r.verdict === 'SURVIVED' && r.m.gap);
  const expected = order.filter(r => r.verdict === 'SURVIVED' && r.m.unkillable);
  const zombies  = order.filter(r => r.verdict === 'KILLED' && (r.m.unkillable || r.m.gap));
  const killed   = order.filter(r => r.verdict === 'KILLED' && !r.m.unkillable && !r.m.gap);

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log('\n' + '─'.repeat(76));

  if (stale.length) {
    console.log('\nSTALE ANCHORS — these tested nothing:\n');
    for (const r of stale) console.log('  ' + r.m.id + '\n      ' + r.detail);
  }
  if (broken.length) {
    console.log('\nDID NOT LOAD — the mutation broke the parse, so no verdict:\n');
    for (const r of broken) console.log('  ' + r.m.id + '\n' + r.detail);
  }
  if (survived.length) {
    console.log('\nSURVIVED a green suite — these are coverage gaps:\n');
    for (const r of survived) {
      console.log('  ' + r.m.id + '  (' + r.m.file + ')');
      console.log('      ' + r.m.note + '\n');
    }
  }
  if (zombies.length) {
    console.log('\nMARKED, BUT DIED — the marker is now a lie, remove it:\n');
    for (const r of zombies) {
      console.log('  ' + r.m.id + '\n      was: ' + (r.m.unkillable || r.m.gap));
      console.log('      died on: ' + killedBy(r.out) + '\n');
    }
  }
  if (gaps.length) {
    console.log('\nKNOWN GAPS — triaged, survive on purpose, still worth closing:\n');
    for (const r of gaps) {
      console.log('  ' + r.m.id + '  (' + r.m.file + ')');
      console.log('      ' + r.m.note);
      console.log('      to close: ' + r.m.gap + '\n');
    }
  }
  if (expected.length && VERBOSE) {
    console.log('\nunkillable by construction, survived as expected:\n');
    for (const r of expected) console.log('  ' + r.m.id + '\n      ' + r.m.unkillable + '\n');
  }

  console.log('\n' + list.length + ' mutation(s) in ' + mins + ' min: ' +
              killed.length + ' killed, ' +
              gaps.length + ' known gaps, ' +
              survived.length + ' NEW survivors, ' +
              expected.length + ' unkillable (expected)' +
              (stale.length ? ', ' + stale.length + ' STALE' : '') +
              (broken.length ? ', ' + broken.length + ' broken' : '') +
              (zombies.length ? ', ' + zombies.length + ' wrongly marked' : ''));

  if (!KEEP) fs.rmSync(scratch, { recursive: true, force: true });
  // Green while the known gaps hold steady; red the moment one appears or one
  // is quietly closed without dropping its marker. A ratchet, not a wall.
  return (stale.length || broken.length || survived.length || zombies.length) ? 1 : 0;
}

if (require.main === module) {
  main().then(code => process.exit(code)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
