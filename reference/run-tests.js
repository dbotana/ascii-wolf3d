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
ok(P.player.hp === 100 && P.player.ammo === 24 && P.player.clip === 8,
   `starts at 100 hp / a seated clip of 8 in a reserve of 24 (${P.player.clip}/${P.player.ammo})`);

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
// the shot is probabilistic (p ~= 0.59 at 3u) on a jittered ~1.15s cooldown, so
// a short window fails on an unlucky seed rather than on a real regression
run(700);
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

// dry means both empty: with a seated clip the gun still fires, and with only
// the reserve empty a trigger pull starts a reload instead
P.player.ammo = 0; P.player.clip = 0; P.player.reloadT = 0;
const scoreBefore = P.player.score;
P.fire(); run(20);
ok(P.player.ammo === 0 && P.player.clip === 0 && P.player.score === scoreBefore,
   'firing with an empty clip and an empty reserve is a no-op');

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
ok(P.state() === 'playing' && P.player.hp === 100 && P.player.ammo === 24,
   'restart resets hp / ammo / state');
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
ok(g.el('tally').classList.contains('show'), 'the tally screen is raised');
ok(g.el('tTitle').textContent === 'FLOOR CLEARED', `tally reads FLOOR CLEARED (got "${g.el('tTitle').textContent}")`);

// ── treasure counters ────────────────────────────────────────────────────────
// The tally screen's treasure ratio needs a denominator the generic item loop
// cannot supply: dropLoot() appends ammo to `items` mid-level, so the total has
// to be fixed at parse time from the '$' tiles alone.
group('treasure');
P.startLevel(0);
const cashTiles = P.items().filter(i => i.kind === 'cash').length;
ok(P.totalTreasure() === cashTiles && cashTiles > 0,
   `totalTreasure counts the wallets and nothing else (${P.totalTreasure()} of ${P.items().length} items)`);
ok(P.treasureFound() === 0, 'no treasure banked at level start');

const wallet = P.items().find(i => i.kind === 'cash' && !i.taken);
P.player.x = wallet.x; P.player.y = wallet.y;
run(2);
ok(wallet.taken && P.treasureFound() === 1, `banking a wallet counts it (${P.treasureFound()})`);

// a battery cell must not move the treasure count
const cell = P.items().find(i => i.kind === 'ammo' && !i.taken);
P.player.ammo = 2;
P.player.x = cell.x; P.player.y = cell.y;
run(2);
ok(P.treasureFound() === 1, 'a non-treasure pickup leaves the treasure count alone');

// killing things appends ammo drops; the denominator must not drift with them
const beforeTotal = P.totalTreasure();
const itemsBefore = P.items().length;
const victimG = firstGuard();
place(victimG, 3);
P.player.ammo = 90; P.player.clip = 8;
for (let i = 0; i < 40 && victimG.alive; i++) { P.fire(); run(20); }
ok(P.totalTreasure() === beforeTotal,
   `totalTreasure is immune to loot drops (${itemsBefore} -> ${P.items().length} items, total still ${P.totalTreasure()})`);

// ── multi-floor ──────────────────────────────────────────────────────────────
group('floors');
ok(P.levels().length >= 3, `the campaign has ${P.levels().length} floors`);
P.startLevel(0);
ok(P.levelIndex() === 0, 'startLevel(0) selects the first floor');
const sig = () => P.grid().map(r => r.map(c => (c ? '#' : '.')).join('')).join('\n');
const sig0 = sig();
P.startLevel(1);
ok(P.levelIndex() === 1 && sig() !== sig0, 'startLevel(1) loads different geometry');
const sig1 = sig();
P.startLevel(2);
ok(P.levelIndex() === 2 && sig() !== sig0 && sig() !== sig1,
   'startLevel(2) loads different geometry again');
ok(P.enemies().length === P.totalEnemies(), 'each floor re-derives its enemy total');

// descending carries the run with you; the floor's own counters reset
P.startLevel(0);
P.player.hp = 61; P.player.ammo = 17; P.player.score = 4321;
P.player.kills = 5; P.player.keyRed = true; P.player.keyBlue = true;
ok(P.nextLevel(), 'nextLevel() advances off floor 1');
ok(P.levelIndex() === 1, `we are on floor ${P.levelIndex() + 1}`);
ok(P.player.hp === 61 && P.player.ammo === 17 && P.player.score === 4321,
   'health, ammo and score ride the elevator down');
ok(P.player.kills === 0 && !P.player.keyRed && !P.player.keyBlue,
   'kills and keycards are per-floor and reset on arrival');
ok(P.state() === 'playing', 'the new floor starts playable');

P.startLevel(P.levels().length - 1);
ok(P.nextLevel() === false, 'nextLevel() refuses to run off the end of the campaign');

// a cold start wipes the run
P.player.score = 999; P.player.hp = 12; P.player.ammo = 3;
P.startLevel(0);
ok(P.player.score === 0 && P.player.hp === 100 && P.player.ammo === 24,
   'a cold startLevel() resets health, ammo and score');

// ── end-of-floor tally ───────────────────────────────────────────────────────
group('tally screen');
P.startLevel(0);
run(120);                                     // bank a little level time
const scoreAtClear = P.player.score;
P.clearLevel();
ok(P.state() === 'cleared', 'clearLevel() puts the game in the cleared state');
const t0 = P.tally();
ok(t0 && !t0.done, 'the tally opens un-rolled');
ok(g.el('tally').classList.contains('show'), 'the tally overlay is visible');
ok(g.el('tScore').classList.contains('hide'), 'the final score is withheld until the roll-up ends');
ok(t0.rows.length === 3 && t0.rows.map(r => r.id).join(',') === 'Kill,Secret,Treasure',
   'the tally rolls kill, secret and treasure ratios');
// nothing was killed, found or banked on this run, so every ratio is zero
ok(t0.rows.every(r => r.pct === 0), `every ratio reads 0% on an untouched floor (${t0.rows.map(r => r.pct).join('/')})`);
const expected = t0.timeBonus;                // no category hit 100%, so no perfect bonuses
run(400);
const t1 = P.tally();
ok(t1 && t1.done, 'the roll-up completes on its own');
ok(P.player.score === scoreAtClear + expected,
   `the payout is exactly the time bonus (${scoreAtClear} + ${expected} -> ${P.player.score})`);
ok(!g.el('tScore').classList.contains('hide') && !g.el('tHint').classList.contains('hide'),
   'score and hint are revealed once the roll-up lands');
ok(g.el('tKill').textContent === '0%', `the kill row settled on its value (${g.el('tKill').textContent})`);

// skipping the animation must pay out identically
P.startLevel(0);
run(120);
const scoreAtClear2 = P.player.score;
P.clearLevel();
const expected2 = P.tally().timeBonus;
P.use();                                      // first press skips the roll-up
ok(P.tally() && P.tally().done, 'the action key skips the roll-up');
ok(P.player.score === scoreAtClear2 + expected2,
   'skipping the roll-up awards the same total as watching it');
ok(P.state() === 'cleared', 'skipping does not itself advance the floor');
P.use();                                      // second press rides the elevator
ok(P.state() === 'playing' && P.levelIndex() === 1,
   `a second press descends (floor ${P.levelIndex() + 1}, state ${P.state()})`);
ok(!g.el('tally').classList.contains('show'), 'the tally is dismissed on descent');

// clearing the last floor ends the campaign rather than looping
P.startLevel(P.levels().length - 1);
P.clearLevel();
ok(g.el('tTitle').textContent === 'ARCOLOGY CLEARED',
   `the last floor's tally says so (got "${g.el('tTitle').textContent}")`);
P.use(); P.use();
ok(P.state() === 'won', `finishing the last floor wins the game (state=${P.state()})`);
ok(g.el('bTitle').textContent === 'OUT', `the win banner reads OUT (got "${g.el('bTitle').textContent}")`);

// ── the CEO ──────────────────────────────────────────────────────────────────
group('the CEO');
P.startLevel(P.levels().length - 1);
const ceo = P.boss();
ok(ceo && ceo.type === 'ceo', 'the last floor places a boss');
ok(P.enemies().includes(ceo), 'the boss is an ordinary member of the enemy list');
ok(ceo.maxHp > 400, `the boss has boss-grade health (${ceo.maxHp})`);
ok(ceo.spec.range > 10, `the boss out-ranges a guard (${ceo.spec.range})`);

// the elevator is held while the board sits
const ex3 = exitTile();
P.player.x = ex3[0] + 0.5; P.player.y = ex3[1] + 1.5; P.player.a = -Math.PI / 2;
P.use(); run(2);
ok(P.state() === 'playing', 'the exit refuses to work while the CEO is alive');

// fight it down, topping the player up: we are testing the boss, not survival
P.player.x = ceo.x; P.player.y = ceo.y + 2.5; P.player.a = -Math.PI / 2;
const phasesSeen = new Set([ceo.phase]);
const totalAtStart = P.totalEnemies();
let bossFrames = 0;
while (ceo.alive && bossFrames < 1600) {
  P.fire(); run(18);            // one shot per 0.28s cooldown, not eight wasted calls
  P.player.hp = 100; P.player.ammo = 200; P.player.clip = 8; P.player.reloadT = 0;
  phasesSeen.add(ceo.phase);
  bossFrames += 18;
}
ok(!ceo.alive, `the boss can be killed (${bossFrames} frames)`);
ok(phasesSeen.size === P.ceoPhases().length,
   `the fight passes through all ${P.ceoPhases().length} phases (saw ${[...phasesSeen].join(',')})`);
ok(P.totalEnemies() > totalAtStart,
   `summoned drones join the kill denominator (${totalAtStart} -> ${P.totalEnemies()})`);
ok(P.player.score >= 5000, `the boss is worth a boss's score (${P.player.score})`);

P.player.x = ex3[0] + 0.5; P.player.y = ex3[1] + 1.5; P.player.a = -Math.PI / 2;
P.use(); run(2);
ok(P.state() === 'cleared', 'the exit releases once the CEO is down');

// The boss's standoff and its burst fire both had no assertion behind them
// until a mutation run proved it: deleting either left the suite fully green.

// ── standoff: a phase-1 CEO holds 5.2u, well outside the 2.2u a drone keeps
P.startLevel(P.levels().length - 1);
const ceo2 = P.boss();
P.player.x = 8.5; P.player.y = ceo2.y;            // same row, clear sightline
P.player.a = 0;
ok(P.hasLOS(P.player.x, P.player.y, ceo2.x, ceo2.y), 'test setup: the CEO is in view down the arena');
ok(Math.hypot(ceo2.x - P.player.x, ceo2.y - P.player.y) > ceo2.want,
   'test setup: it starts further out than its standoff, so it has to close');
let minDist = Infinity;
for (let i = 0; i < 300; i++) {
  g.step(50);                                     // distance, not frame timing: coarse steps are fine
  P.player.hp = 100;                              // we are measuring range, not survival
  if (ceo2.state !== 'idle') minDist = Math.min(minDist, Math.hypot(ceo2.x - P.player.x, ceo2.y - P.player.y));
}
ok(ceo2.phase === 0, `the CEO stayed in its opening phase (${ceo2.phase})`);
ok(minDist < 9, `test setup: it actually advanced (closed to ${minDist.toFixed(2)}u)`);
ok(minDist > 4, `the CEO keeps its own ${ceo2.want}u standoff rather than a drone's 2.2u ` +
   `(closest ${minDist.toFixed(2)}u)`);

// ── bursts: a later phase fires several rounds on one trigger pull, which shows
// up as a longer stay in the attack state — 0.22s, then 0.16s per extra shot.
// There is no randomness in that spacing, so the frame count is deterministic.
P.startLevel(P.levels().length - 1);
const ceo3 = P.boss();
P.player.x = ceo3.x; P.player.y = ceo3.y + 2.0; P.player.a = -Math.PI / 2;
ceo3.hp = Math.floor(ceo3.maxHp * 0.2);           // drop it straight into the last phase
let held = 0, longestAttack = 0;
for (let i = 0; i < 400; i++) {   // ~3 attack cycles at a 0.62s cooldown
  run(1);
  P.player.hp = 100;
  if (ceo3.state === 'attack') { held++; longestAttack = Math.max(longestAttack, held); }
  else held = 0;
}
ok(ceo3.phase === P.ceoPhases().length - 1, `the CEO reached its last phase (${ceo3.phase})`);
ok(ceo3.burst > 1, `the last phase is a burst weapon (${ceo3.burst} rounds)`);
ok(longestAttack > 25,
   `a burst holds the attack state for ${longestAttack} frames — a single shot is ~14`);

P.startLevel(0);

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

// ── a slab must never bury a pickup (fixture) ────────────────────────────────
// pushSecret() guards its path with cellAt and occupied; without an items check
// too, a slab parks on a wallet, blockAt keeps you off that tile forever and
// stepItems needs you within 0.62u of it. The shipped floors are laid out so
// this cannot happen, which is exactly why it needs purpose-built geometry.
//
//   row 3:  #..S.$...#   one clear tile, then a wallet -> slide must clamp to 1
//   row 5:  #..S$....#   a wallet immediately behind   -> push must refuse
group('pickups under push-walls (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@.......#',
    '#........#',
    '#..S.$...#',
    '#........#',
    '#..S$....#',
    '#........#',
    '#.......X#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;

  const clamp = F.secrets().find(s => s.gy === 3);
  const wallet = F.items().find(i => i.kind === 'cash' && (i.y | 0) === 3);
  ok(!!clamp && !!wallet, 'test setup: a secret with a wallet two tiles ahead of it');
  ok(F.itemAt(5, 3), 'test setup: the engine sees the wallet on tile 5,3');

  F.player.x = 2.5; F.player.y = 3.5; F.player.a = 0;    // face east
  f.run(4); F.use(); f.run(250);
  ok(clamp.gx === 4 && clamp.gy === 3,
     `a slide stops short of a pickup rather than burying it (landed ${clamp.gx},${clamp.gy}, wanted 4,3)`);
  ok(!F.blockAt(wallet.x, wallet.y), 'the wallet tile is still open ground');
  F.player.x = wallet.x; F.player.y = wallet.y;
  f.run(3);
  ok(wallet.taken, 'the wallet is still collectable after the push');
  ok(F.secretsFound() === 1, `the clamped push still counts as a secret (${F.secretsFound()})`);

  // a pickup directly behind the slab leaves no legal span at all
  const wedged = F.secrets().find(s => s.gy === 5);
  const foundBefore = F.secretsFound();
  F.player.x = 2.5; F.player.y = 5.5; F.player.a = 0;
  f.run(4); F.use(); f.run(200);
  ok(wedged.gx === 3 && wedged.gy === 5 && wedged.phase === 'idle',
     `a pickup one tile ahead wedges the slab (at ${wedged.gx},${wedged.gy}, phase=${wedged.phase})`);
  ok(F.secretsFound() === foundBefore, 'a refused push is not counted');
  const stuck = F.items().find(i => i.kind === 'cash' && (i.y | 0) === 5);
  ok(stuck && !stuck.taken && !F.blockAt(stuck.x, stuck.y),
     'and its wallet is left reachable rather than sealed under the slab');
}

// ── a clean sweep pays every bonus (fixture) ─────────────────────────────────
// One enemy, one secret, one wallet, so 100% in all three categories is
// reachable inside a test. Confirms the payout schedule, not just that the
// numbers render.
group('perfect tally (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@.......#',
    '#........#',
    '#..g.....#',
    '#....$...#',
    '#..S.....#',
    '#........#',
    '#.......X#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  ok(F.totalEnemies() === 1 && F.totalSecrets() === 1 && F.totalTreasure() === 1,
     `test setup: one of each (${F.totalEnemies()}e / ${F.totalSecrets()}s / ${F.totalTreasure()}t)`);

  const foe = F.enemies()[0];
  // one tile south, not two-and-a-half: the secret at 3,5 sits on the longer
  // sightline and a slab blocks line of sight exactly like a wall
  F.player.x = foe.x; F.player.y = foe.y + 1.0;
  F.player.a = -Math.PI / 2;
  ok(F.hasLOS(F.player.x, F.player.y, foe.x, foe.y), 'test setup: the guard is in view');
  F.player.ammo = 90; F.player.clip = 8;
  for (let i = 0; i < 40 && foe.alive; i++) { F.fire(); f.run(20); F.player.hp = 100; }
  ok(!foe.alive, 'test setup: the only enemy is down');

  const sec = F.secrets()[0];
  F.player.x = sec.gx + 0.5 - 1; F.player.y = sec.gy + 0.5; F.player.a = 0;
  f.run(4); F.use(); f.run(250);
  ok(F.secretsFound() === 1, 'test setup: the only secret is found');

  const wal = F.items().find(i => i.kind === 'cash');
  F.player.x = wal.x; F.player.y = wal.y;
  f.run(3);
  ok(F.treasureFound() === 1, 'test setup: the only wallet is banked');

  const before = F.player.score;
  F.clearLevel();
  const t = F.tally();
  ok(t.rows.every(r => r.pct === 100),
     `all three ratios read 100% (${t.rows.map(r => r.id + ' ' + r.pct + '%').join(', ')})`);
  F.use();                                    // skip straight to the payout
  ok(F.player.score === before + t.timeBonus + 3 * 2500,
     `a clean sweep pays the time bonus plus 2500 per category ` +
     `(${before} + ${t.timeBonus} + 7500 -> ${F.player.score})`);
  ok(f.el('tRowKill').classList.contains('perfect'), 'a 100% row is flagged as perfect');
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);
