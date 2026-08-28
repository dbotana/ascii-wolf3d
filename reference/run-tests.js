#!/usr/bin/env node
// ─── REGRESSION SUITE ────────────────────────────────────────────────────────
//
// Drives the real game loop through the headless harness and asserts on live
// state. Covers the whole loop: boot, render, combat, enemy AI, doors,
// keycards, pickups, death, restart, level clear.
//
//   node reference/run-tests.js
//   node reference/run-tests.js --verbose
//   WOLF3D_HTML=path/to/build.html node reference/run-tests.js
//
// Exits non-zero on any failure.
//
// Writing tests here: place the player with `P.player.x/y/a` rather than
// walking them, and remember that enemies only wake when they have line of
// sight. `place()` below exists because two early tests failed for the boring
// reason that the player had been dropped behind a wall.

'use strict';

const { load, loadWithLevel } = require('./harness');

const VERBOSE = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; if (VERBOSE) console.log(`  ok    ${msg}`); }
  else { fail++; failures.push(msg); console.log(`  FAIL  ${msg}`); }
}
function group(name) { console.log(`\n${name}`); }

const g = load({ htmlPath: process.env.WOLF3D_HTML });
const P = g.P;
const run = (n, held) => g.run(n, held);

/** Put the player `dist` in front of `e`, on a tile that exists and has LOS. */
function place(e, dist) {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const px = e.x + dx * dist, py = e.y + dy * dist;
    if (P.blockAt(px, py)) continue;
    if (!P.hasLOS(px, py, e.x, e.y)) continue;
    P.player.x = px; P.player.y = py;
    P.player.a = Math.atan2(e.y - py, e.x - px);
    return true;
  }
  return false;
}
const firstGuard = () => P.enemies().find(e => e.type === 'guard' && e.alive);
const exitTile = () => {
  const grid = P.grid();
  for (let y = 0; y < grid.length; y++)
    for (let x = 0; x < grid[y].length; x++)
      if (grid[y][x] && grid[y][x].tag === 'exit') return [x, y];
  return null;
};

// ── boot & render ────────────────────────────────────────────────────────────
group('boot & render');
P.startLevel();
ok(P.state() === 'playing', 'boots into the playing state');
ok(P.enemies().length > 0 && P.enemies().length === P.totalEnemies(),
   `level populates enemies and the counter agrees (${P.enemies().length})`);
ok(P.items().length > 0, `level populates pickups (${P.items().length})`);
ok(P.doors().length > 0, `level populates doors (${P.doors().length})`);
ok(P.player.hp === 100 && P.player.ammo === 8, 'starts at 100 hp / 8 ammo');

g.resetDrawCalls();
run(60);
const perFrame = g.drawCalls / 60;
ok(perFrame > 10000, `renders a full screen each frame (~${Math.round(perFrame)} draws)`);
ok(P.atlasSize() < 500, `glyph atlas stays bounded (${P.atlasSize()} of ${P.atlasCap()})`);

// ── enemy AI ─────────────────────────────────────────────────────────────────
group('enemy AI');
P.startLevel();
const g1 = firstGuard();
ok(place(g1, 3), 'test setup: player placed in front of a guard with LOS');
run(25);
ok(g1.state !== 'idle', `guard leaves idle on sight (state=${g1.state})`);
run(220);
ok(P.player.hp < 100, `guard damages the player (hp=${P.player.hp})`);

// propagation: enemies with no LOS still wake via their neighbours
P.startLevel();
const es = P.enemies();
let spot = null;
for (const e of es) {
  for (const [dx, dy] of [[0, 2.5], [0, -2.5], [2.5, 0], [-2.5, 0]]) {
    const px = e.x + dx, py = e.y + dy;
    if (P.blockAt(px, py) || !P.hasLOS(px, py, e.x, e.y)) continue;
    const seen = es.filter(o => Math.hypot(o.x - px, o.y - py) < o.spec.sight && P.hasLOS(o.x, o.y, px, py));
    const hidden = es.filter(o => o !== e && Math.hypot(o.x - e.x, o.y - e.y) <= 7 && !seen.includes(o));
    if (hidden.length) { spot = { px, py, seen: seen.length }; break; }
  }
  if (spot) break;
}
if (spot) {
  P.player.x = spot.px; P.player.y = spot.py;
  run(35);
  const awake = es.filter(e => e.state !== 'idle').length;
  ok(awake > spot.seen, `alert propagates past line of sight (${spot.seen} saw the player, ${awake} awake)`);
} else {
  ok(false, 'test setup: could not find a propagation vantage point');
}

// ── combat ───────────────────────────────────────────────────────────────────
group('combat');
P.startLevel();
const g2 = firstGuard();
place(g2, 3);
P.player.ammo = 50;
run(2);
const ammoBefore = P.player.ammo;
let volleys = 0;
while (g2.alive && volleys < 40) { P.fire(); run(20); volleys++; }
ok(!g2.alive, `aimed fire kills a guard (${volleys} volleys)`);
ok(P.player.ammo < ammoBefore, `firing spends ammo (${ammoBefore} -> ${P.player.ammo})`);
ok(P.player.kills === 1, `kill is counted (${P.player.kills})`);
ok(P.player.score > 0, `kill awards score (${P.player.score})`);

P.player.ammo = 0;
const scoreBefore = P.player.score;
P.fire(); run(20);
ok(P.player.ammo === 0 && P.player.score === scoreBefore, 'firing with 0 ammo is a no-op');

P.startLevel();
P.player.x = 20.5; P.player.y = 38.5; P.player.a = Math.PI / 2;   // face a wall
P.player.ammo = 20;
P.fire(); run(20);
ok(P.player.kills === 0, 'shooting a wall hits nothing');

// ── doors ────────────────────────────────────────────────────────────────────
group('doors & keycards');
P.startLevel();
const plain = P.doors().find(d => !d.lock);
P.player.x = plain.gx + 0.5; P.player.y = plain.gy + 1.5; P.player.a = -Math.PI / 2;
ok(P.blockAt(plain.gx + 0.5, plain.gy + 0.5), 'a closed door blocks movement');
P.use(); run(3);
ok(plain.phase === 'opening', 'use() starts the door opening');
run(40);
ok(plain.open >= 1 && plain.phase === 'open', 'door reaches fully open');
ok(!P.blockAt(plain.gx + 0.5, plain.gy + 0.5), 'an open door is passable');
run(340);
ok(plain.phase === 'closed' && plain.open === 0, 'door auto-closes after its hold');

P.use(); run(40);
P.player.x = plain.gx + 0.5; P.player.y = plain.gy + 0.5;         // stand in the doorway
run(400);
ok(plain.phase !== 'closed', 'door refuses to close on top of the player');

P.startLevel();
const red = P.doors().find(d => d.lock === 'red');
P.player.x = red.gx + 0.5; P.player.y = red.gy + 1.5; P.player.a = -Math.PI / 2;
P.use(); run(10);
ok(red.phase === 'closed', 'red door stays shut without its keycard');
P.player.keyRed = true;
P.use(); run(40);
ok(red.open >= 1, 'red door opens once the keycard is held');

P.startLevel();
const blue = P.doors().find(d => d.lock === 'blue');
P.player.x = blue.gx + 0.5; P.player.y = blue.gy + 1.5; P.player.a = -Math.PI / 2;
P.use(); run(10);
ok(blue.phase === 'closed', 'blue door stays shut without its keycard');

// ── pickups ──────────────────────────────────────────────────────────────────
group('pickups');
P.startLevel();
const grab = kind => {
  const it = P.items().find(i => i.kind === kind && !i.taken);
  P.player.x = it.x; P.player.y = it.y;
  run(2);
  return it;
};
P.player.hp = 50;
ok(grab('health').taken && P.player.hp === 75, `ramen heals +25 (hp=${P.player.hp})`);
P.player.ammo = 2;
ok(grab('ammo').taken && P.player.ammo === 10, `battery cell gives +8 ammo (ammo=${P.player.ammo})`);
const s0 = P.player.score;
ok(grab('cash').taken && P.player.score === s0 + 500, 'crypto wallet gives +500');
ok(grab('keyRed').taken && P.player.keyRed, 'red keycard is collected');
ok(grab('keyBlue').taken && P.player.keyBlue, 'blue keycard is collected');

P.player.hp = 100;
const leftover = P.items().find(i => i.kind === 'health' && !i.taken);
if (leftover) {
  P.player.x = leftover.x; P.player.y = leftover.y;
  run(2);
  ok(!leftover.taken && P.player.hp === 100, 'ramen is left on the floor at full health');
} else {
  ok(true, 'ramen cap check skipped (no spare health pickup)');
}

// ── secrets (push-walls; skipped on builds without them) ─────────────────────
if (P.totalSecrets() > 0) {
  group('secret push-walls');
  P.startLevel();
  const secrets = P.secrets();
  ok(secrets.length === P.totalSecrets(), `secret list matches the counter (${secrets.length})`);
  ok(P.secretsFound() === 0, 'no secrets found at level start');
  ok(secrets.every(s => s.phase === 'idle' && s.push === 0), 'secrets start idle and unmoved');

  // a push-wall must look exactly like the wall it hides in
  ok(secrets.every(s => s.tag === 'panel'),
     'secrets masquerade as plain panels so they are not obvious');

  // find one we can actually stand in front of and shove
  const s = secrets.find(sec =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
      !P.blockAt(sec.gx + 0.5 - dx, sec.gy + 0.5 - dy) && !P.blockAt(sec.gx + 0.5 + dx, sec.gy + 0.5 + dy)));
  if (s) {
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) =>
      !P.blockAt(s.gx + 0.5 - dx, s.gy + 0.5 - dy) && !P.blockAt(s.gx + 0.5 + dx, s.gy + 0.5 + dy));
    const [dx, dy] = dir;
    P.player.x = s.gx + 0.5 - dx; P.player.y = s.gy + 0.5 - dy;
    P.player.a = Math.atan2(dy, dx);
    const ox = s.gx, oy = s.gy;
    ok(P.blockAt(s.gx + 0.5, s.gy + 0.5), 'an unpushed secret is solid');
    P.use(); run(4);
    ok(s.phase === 'moving', `use() starts the slab moving (phase=${s.phase})`);
    ok(P.secretsFound() === 1, `secret is counted when pushed (${P.secretsFound()})`);
    run(120);
    ok(s.phase === 'done', `slab finishes its slide (phase=${s.phase})`);
    ok(s.gx !== ox || s.gy !== oy, `slab actually relocated (${ox},${oy} -> ${s.gx},${s.gy})`);
    ok(!P.blockAt(ox + 0.5, oy + 0.5), 'the vacated tile is now walkable');
    ok(P.blockAt(s.gx + 0.5, s.gy + 0.5), 'the slab is solid at its new home');
  } else {
    ok(false, 'test setup: no secret with a free face to push from');
  }

  // a wedged secret must refuse silently rather than teleport
  P.startLevel();
  const w = P.secrets()[0];
  P.player.x = w.gx + 0.5; P.player.y = w.gy + 0.5;   // stand inside it: no valid push axis
  const before = P.secretsFound();
  P.use(); run(4);
  ok(P.secretsFound() >= before, 'pushing from inside a secret does not corrupt the count');
}

// ── end states ───────────────────────────────────────────────────────────────
group('end states');
P.startLevel();
P.player.hp = 1;
place(firstGuard(), 2.5);
let frames = 0;
while (P.state() === 'playing' && frames < 1500) { run(1); frames++; }
ok(P.state() === 'dead', `player dies under fire (after ${frames} frames)`);
ok(P.player.hp === 0, `hp floors at 0 (hp=${P.player.hp})`);
ok(g.el('banner').classList.contains('show') && g.el('banner').classList.contains('fail'), 'death banner is shown');
ok(g.el('bTitle').textContent === 'TERMINATED', `death banner reads TERMINATED (got "${g.el('bTitle').textContent}")`);
const deadX = P.player.x;
run(20, ['w']);
ok(P.player.x === deadX, 'movement is frozen while dead');

P.startLevel();
ok(P.state() === 'playing' && P.player.hp === 100 && P.player.ammo === 8, 'restart resets hp / ammo / state');
ok(P.enemies().every(e => e.alive) && P.items().every(i => !i.taken), 'restart respawns enemies and pickups');
ok(P.doors().every(d => d.phase === 'closed' && d.open === 0), 'restart re-closes every door');
ok(!P.player.keyRed && !P.player.keyBlue && P.player.score === 0 && P.player.kills === 0,
   'restart clears keycards, score and kills');
ok(!g.el('banner').classList.contains('show'), 'restart hides the banner');

const ex = exitTile();
ok(ex !== null, `exit switch exists (at ${ex})`);
P.player.x = ex[0] + 0.5; P.player.y = ex[1] + 1.5; P.player.a = -Math.PI / 2;
P.use(); run(2);
ok(P.state() === 'cleared', 'using the exit switch clears the floor');
ok(g.el('bTitle').textContent === 'FLOOR CLEARED', `clear banner reads FLOOR CLEARED (got "${g.el('bTitle').textContent}")`);

// ── push-wall clamping, on purpose-built geometry ────────────────────────────
// The shipped level happens to put every secret in an open corridor, so it
// cannot exercise a blocked push. Build a map that can.
//
//   row 3:  #..S#....#   secret at 3,3 faces solid rock  -> must refuse
//   row 5:  #..S.#...#   secret at 3,5 has one free tile -> must stop at 1
if (P.totalSecrets() > 0) {
  group('push-wall clamping (fixture)');
  const f = loadWithLevel([
    '##########',
    '#@.......#',
    '#........#',
    '#..S#....#',
    '#........#',
    '#..S.#...#',
    '#.S......#',
    '#.......X#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;

  const wedge = F.secrets().find(s => s.gy === 3);
  F.player.x = 2.5; F.player.y = 3.5; F.player.a = 0;      // face east into rock
  f.run(4);
  f.P.use();
  f.run(150);
  ok(wedge.gx === 3 && wedge.gy === 3 && wedge.phase === 'idle',
     `secret facing solid rock refuses to move (at ${wedge.gx},${wedge.gy}, phase=${wedge.phase})`);
  ok(F.secretsFound() === 0, `a refused push is not counted (found=${F.secretsFound()})`);

  const short = F.secrets().find(s => s.gy === 5);
  F.player.x = 2.5; F.player.y = 5.5; F.player.a = 0;      // face east, one tile clear
  f.run(4);
  F.use();
  f.run(250);
  const moved = Math.abs(short.gx - 3) + Math.abs(short.gy - 5);
  ok(moved === 1, `secret stops short of an obstruction (moved ${moved} tile(s), expected 1)`);
  ok(!!F.cellAt(short.gx, short.gy), 'the slab is solid where it stopped');
  ok(F.secretsFound() === 1, `the successful push was counted (found=${F.secretsFound()})`);

  // a wall that has landed is spent: one push per secret, forever
  F.player.x = 2.5; F.player.y = 5.5; F.player.a = 0;
  const restX = short.gx, restY = short.gy, foundAfter = F.secretsFound();
  F.use(); f.run(200);
  ok(short.gx === restX && short.gy === restY && short.phase === 'done',
     'a landed secret cannot be pushed a second time');
  ok(F.secretsFound() === foundAfter, 're-using a spent secret does not inflate the count');

  // ── a slab in transit is a real obstacle, not a decoration
  const roamer = F.secrets().find(s => s.gy === 6);
  F.player.x = 1.5; F.player.y = 6.5; F.player.a = 0;
  f.run(4); F.use(); f.run(20);
  ok(roamer.phase === 'moving', `third secret is mid-slide (phase=${roamer.phase})`);
  const bx = roamer.gx + roamer.dx * roamer.push;
  const by = roamer.gy + roamer.dy * roamer.push;
  ok(F.blockAt(bx + 0.5, by + 0.5), 'a moving slab blocks movement');
  ok(!F.blockAt(2.5, 6.5), 'the tile a moving slab has vacated is walkable');
  ok(!F.hasLOS(1.5, 6.5, 7.5, 6.5), 'a moving slab blocks line of sight');

  // nothing may be sealed inside a slab — bodies get shoved out the back
  const victim = F.enemies()[0];
  if (victim) {
    victim.x = bx + 0.5; victim.y = by + 0.5;
    f.run(1);
    const nx = roamer.gx + roamer.dx * roamer.push, ny = roamer.gy + roamer.dy * roamer.push;
    const stuck = victim.x >= nx && victim.x < nx + 1 && victim.y >= ny && victim.y < ny + 1;
    ok(!stuck, 'a body caught inside a moving slab is ejected');
    ok(!F.blockAt(victim.x, victim.y), 'the ejected body lands on walkable ground');
  }

  F.player.x = bx + 0.5; F.player.y = by + 0.5;
  f.run(1);
  const px = roamer.gx + roamer.dx * roamer.push, py = roamer.gy + roamer.dy * roamer.push;
  const pStuck = F.player.x >= px && F.player.x < px + 1 && F.player.y >= py && F.player.y < py + 1;
  ok(!pStuck, 'the player is never sealed inside a moving slab');
  ok(!F.blockAt(F.player.x, F.player.y), 'the ejected player is not left inside a wall');

  // The earlier re-push check used a secret hemmed in by rock, so it could not
  // tell "spent" from "wedged". This one has two clear tiles ahead: if the
  // phase guard is removed it WILL move, so the assertion actually discriminates.
  f.run(300);                                   // let the roamer finish landing
  ok(roamer.phase === 'done', `roamer landed (phase=${roamer.phase})`);
  const rx = roamer.gx, ry = roamer.gy, foundNow = F.secretsFound();
  ok(!F.cellAt(rx + 1, ry) && !F.cellAt(rx + 2, ry),
     'test setup: the landed roamer still has two clear tiles ahead of it');
  F.player.x = rx - 0.5; F.player.y = ry + 0.5; F.player.a = 0;
  F.use(); f.run(250);
  ok(roamer.gx === rx && roamer.gy === ry,
     `a spent secret stays put even with room to move (${rx},${ry} -> ${roamer.gx},${roamer.gy})`);
  ok(F.secretsFound() === foundNow, 're-using a spent secret does not raise the found count');
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);
