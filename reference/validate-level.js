#!/usr/bin/env node
// ─── LEVEL VALIDATOR ─────────────────────────────────────────────────────────
//
// Static checks on the hand-authored maps in wolf3d.html. Run this before
// shipping any new floor — it reads the level source directly out of the HTML,
// so it needs no browser and no game boot.
//
//   node reference/validate-level.js
//   node reference/validate-level.js ../some-other-build.html
//
// Exits non-zero if any check fails, so it drops straight into CI.
//
// These checks are not hypothetical. During the MVP build the width check
// caught a miscounted row, and the reachability check caught four pickups
// accidentally sealed inside the lobby kiosks with no opening.

'use strict';

const fs = require('fs');
const path = require('path');
const { collectSources } = require('./harness');

const WALK   = '.@gdC+ar b$';       // tiles a body can stand on
const ITEMS  = 'gdC+arb$';          // entities that must be reachable
const LOCKS  = { R: 'red', B: 'blue' };
const SECRET = 'S';                 // push-wall: solid until shoved, then passable
const PICKUP = '+arb$';             // pushSecret() also stops short of these
const KEYCH  = { r: 'red', b: 'blue' };

/**
 * Scrape the floors out of a build without booting it.
 *
 * Levels are found by the token `const LEVEL_* = [`, which is why CLAUDE.md
 * requires each floor to stay a top-level array under that name. The search
 * covers every script the page loads — the split tree's wolf3d/levels.js and
 * the bundled single file alike — via the harness's one shared walk. Point it
 * at a .js file directly and it reads that instead.
 */
function extractLevels(target) {
  const text = /\.js$/i.test(target)
    ? fs.readFileSync(target, 'utf8')
    : collectSources(target).map(s => s.code).join('\n');
  const out = [];
  const re = /const (LEVEL_\w+) = \[([\s\S]*?)\n\s*\];/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const rows = m[2].split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^'/, '').replace(/',?$/, ''));
    out.push({ name: m[1], rows });
  }
  return out;
}

function validate(name, rows) {
  const problems = [];
  const note = m => problems.push(m);

  // ── geometry
  if (rows.length === 0) { note('level is empty'); return problems; }
  const W = [...rows[0]].length;
  const H = rows.length;
  rows.forEach((r, y) => {
    const len = [...r].length;                 // codepoints, not UTF-16 units
    if (len !== W) note(`row ${y} is ${len} chars, expected ${W}`);
  });
  if (problems.length) return problems;        // nothing else is meaningful yet

  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? '#' : rows[y][x];

  // ── the border must be sealed, or the player walks off the map
  for (let x = 0; x < W; x++) {
    if (WALK.includes(at(x, 0)))     note(`top border open at x=${x}`);
    if (WALK.includes(at(x, H - 1))) note(`bottom border open at x=${x}`);
  }
  for (let y = 0; y < H; y++) {
    if (WALK.includes(at(0, y)))     note(`left border open at y=${y}`);
    if (WALK.includes(at(W - 1, y))) note(`right border open at y=${y}`);
  }

  // ── required singletons
  const count = ch => rows.join('').split(ch).length - 1;
  const spawns = count('@');
  if (spawns !== 1) note(`expected exactly 1 spawn (@), found ${spawns}`);
  const exits = count('X');
  if (exits < 1) note('no exit switch (X) — the floor cannot be completed');

  // ── every door must be flanked by solid cells on exactly ONE axis.
  //
  // A door is a thin slab standing at the tile centre, and parseLevel derives
  // which way it faces from its flanking walls: solid north and south means you
  // walk through east-west, so the plane sits at constant x and the slab
  // retracts along y into one of those two walls. Neither pair solid and there
  // is nothing to retract into and no axis to derive — the door falls back to a
  // default, and castGrid lets rays slip past it at oblique angles while
  // blockAt still holds the whole tile. You get a door you can see through but
  // not walk through, from some angles only.
  //
  // The engine will not tell you: the fallback renders, and a level built that
  // way looks correct head-on. This is the same silence that made the wedged
  // push-wall check necessary.
  //
  // Both pairs solid is a door in a solid wall — walled in on all four sides is
  // caught by the flood fill, but a 2x2 of doors would satisfy both pairs and
  // still be nonsense, so it is called out here rather than left implied.
  const DOORCH = 'DRB';
  const SOLIDCH = '#|NXSDRB';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!DOORCH.includes(at(x, y))) continue;
      const ns = SOLIDCH.includes(at(x, y - 1)) && SOLIDCH.includes(at(x, y + 1));
      const ew = SOLIDCH.includes(at(x - 1, y)) && SOLIDCH.includes(at(x + 1, y));
      if (ns && ew) {
        note(`door at ${x},${y} is walled in on all four sides — it opens onto nothing`);
      } else if (!ns && !ew) {
        note(`door at ${x},${y} is free-standing (needs solid cells on one axis ` +
             `to slide into) — rays will slip past its slab at oblique angles`);
      } else {
        // The other axis is the one you WALK through, and both sides of it have
        // to be somewhere you can stand. A door with rock on one side is legal
        // by every rule above — one flanked axis, exit still reachable, nothing
        // stranded — and it is a door you open onto a wall. Two shipped on
        // floor 1's bay walls, found by reading the map rather than by running
        // this file, which is why the check is here now.
        const thru = ns ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
        for (const [dx, dy] of thru) {
          const c = at(x + dx, y + dy);
          if (!WALK.includes(c) && !DOORCH.includes(c)) {
            note(`door at ${x},${y} opens onto '${c}' at ${x + dx},${y + dy} — ` +
                 `you can open it but not walk through it`);
          }
        }
      }
    }
  }

  // ── every locked door needs its keycard to exist somewhere
  for (const [ch, lock] of Object.entries(LOCKS)) {
    if (count(ch) > 0) {
      const keyCh = Object.keys(KEYCH).find(k => KEYCH[k] === lock);
      if (count(keyCh) === 0) note(`'${ch}' (${lock} door) exists but no '${keyCh}' keycard is placed`);
    }
  }
  if (problems.length) return problems;

  let start = null;
  for (let y = 0; y < H && !start; y++)
    for (let x = 0; x < W; x++)
      if (at(x, y) === '@') { start = [x, y]; break; }
  if (!start) { note('spawn not locatable'); return problems; }

  // ── key-gated flood fill: walk what you can reach, collect keys, repeat
  function flood(keys) {
    const seen = new Set([start.join(',')]);
    const stack = [start];
    const found = { keys: new Set(), exit: false, blocked: new Set(), wedged: new Set() };
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (seen.has(k)) continue;
        const c = at(nx, ny);
        if (c === 'X') { found.exit = true; continue; }       // switch, not a tile
        if (LOCKS[c]) {
          if (!keys.has(LOCKS[c])) { found.blocked.add(`${LOCKS[c]} door at ${nx},${ny}`); continue; }
        } else if (c === SECRET) {
          // pushSecret() slides the slab along the facing axis and refuses if
          // wedged, so the wall is only passable when the cell beyond is free
          // — and it stops short of pickups as well as walls, so a slab with a
          // battery cell directly behind it does not move at all
          const beyond = at(nx + dx, ny + dy);
          if ((!WALK.includes(beyond) && beyond !== 'D') || PICKUP.includes(beyond)) {
            found.wedged.add(`${nx},${ny}`);
            continue;
          }
        } else if (c !== 'D' && !WALK.includes(c)) continue;
        seen.add(k);
        stack.push([nx, ny]);
        if (KEYCH[c]) found.keys.add(KEYCH[c]);
      }
    }
    return { seen, found };
  }

  const keys = new Set();
  let prev = -1, passes = 0;
  let last = flood(keys);
  while (keys.size !== prev && passes < 8) {
    prev = keys.size;
    last = flood(keys);
    for (const k of last.found.keys) keys.add(k);
    passes++;
  }

  if (!last.found.exit) {
    note('the exit is NOT reachable' +
         (last.found.blocked.size ? ' — blocked by: ' + [...last.found.blocked].join(', ') : ''));
  }

  // ── anything placed but unreachable is a content bug
  const stranded = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = at(x, y);
      if (ITEMS.includes(c) && !last.seen.has(x + ',' + y)) stranded.push(`'${c}' at ${x},${y}`);
    }
  }
  if (stranded.length) note(`unreachable entities: ${stranded.join(', ')}`);

  // a push-wall with no free cell on any axis is wedged — pushSecret() bails
  // silently, so the secret can never be found and its room is dead space
  const wedged = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y) !== SECRET) continue;
      // you must be able to STAND on one side and have the slab move into the
      // other — a free neighbour alone is not enough if you cannot reach the
      // opposite face to push from
      const open = ch => WALK.includes(ch) || ch === 'D';
      // the first cell of the slide must also be clear of pickups: pushSecret()
      // treats a pickup like a wall, and refuses silently when span works out
      // to zero, so this is indistinguishable from rock at the keyboard
      const clear = ch => open(ch) && !PICKUP.includes(ch);
      const pushable = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dy]) => open(at(x - dx, y - dy)) && clear(at(x + dx, y + dy)));
      if (!pushable) wedged.push(`${x},${y}`);
    }
  }
  if (wedged.length) note(`push-walls that cannot move in any direction: ${wedged.join(', ')}`);

  return problems;
}

function summarise(rows) {
  const all = rows.join('');
  const n = ch => all.split(ch).length - 1;
  return `${[...rows[0]].length}x${rows.length}  ` +
         `enemies ${n('g') + n('d') + n('C')} (${n('g')}g/${n('d')}d/${n('C')}C)  ` +
         `pickups ${n('+') + n('a') + n('$') + n('r') + n('b')}  ` +
         `doors ${n('D') + n('R') + n('B')}  secrets ${n('S')}`;
}

function main() {
  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'wolf3d.html');

  const levels = extractLevels(target);
  if (!levels.length) {
    console.error(`no LEVEL_* arrays found in ${target}`);
    process.exit(1);
  }

  console.log(`validating ${levels.length} level(s) in ${path.basename(target)}\n`);
  let failed = 0;
  for (const { name, rows } of levels) {
    const problems = validate(name, rows);
    if (problems.length === 0) {
      console.log(`  PASS  ${name}  ${summarise(rows)}`);
    } else {
      failed++;
      console.log(`  FAIL  ${name}`);
      for (const p of problems) console.log(`          ${p}`);
    }
  }
  console.log(failed ? `\n${failed} level(s) failed` : `\nall levels valid`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { extractLevels, validate };
