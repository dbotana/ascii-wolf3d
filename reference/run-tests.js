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

/**
 * Park every enemy where it stands, in a state the FSM will not move it out of.
 *
 * Since Phase 2 enemies patrol while idle and route around corners once woken,
 * so a test that waits several seconds can no longer assume the geometry it set
 * up is still empty. `stepDoors` refuses to close on an occupied tile, and a
 * guard wandering into the frame made the door-hold assertion fail about one run
 * in four. Call this straight after `startLevel()`, while everyone is still on
 * their authored spawn tile — a spawn is never a door tile, so the frame is
 * guaranteed clear.
 */
function freezeEnemies() {
  for (const e of P.enemies()) { e.state = 'hurt'; e.stateT = 1e9; }
}
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

// Booting twice is not a hypothetical: the splash is not removed for 600ms, so
// a second click — or a difficulty row's click bubbling up to it — used to sail
// past the old `parentElement` guard, restart the level and register a SECOND
// requestAnimationFrame chain. The harness keeps only one rAF callback, so no
// frame-count assertion can see that; this asserts on begin()'s idempotence,
// which is the part that can actually be checked.
P.player.hp = 42;
g.el('splash')._handlers.click();
ok(P.player.hp === 42, 'booting a second time does not restart the game');

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

// ── enemy movement: flow field, separation, patrols ──────────────────────────
// The first two behaviours here were measured failures before Phase 2, not
// suspicions: a guard jammed at 4.2u around a corner, and a group chase left two
// guards 0.009u apart. Both numbers are in the assertion messages so a
// regression reads as a regression rather than as a mystery.
group('enemy movement');
P.startLevel();
P.player.x = 20.5; P.player.y = 38.5;
run(4);
ok(P.navAt(P.player.x | 0, P.player.y | 0) === 0,
   'the flow field is seeded at zero on the player tile');
{
  const grid = P.grid();
  let wall = null, open = null;
  for (let y = 0; y < grid.length && !(wall && open); y++)
    for (let x = 0; x < grid[y].length; x++) {
      if (!wall && grid[y][x] && grid[y][x].tag === 'panel') wall = [x, y];
      if (!open && !grid[y][x] && (x !== (P.player.x | 0) || y !== (P.player.y | 0))
          && P.navAt(x, y) > 0) open = [x, y];
    }
  ok(wall && P.navAt(wall[0], wall[1]) === -1, 'a solid tile is unreachable in the field');
  const manhattan = Math.abs(open[0] - (P.player.x | 0)) + Math.abs(open[1] - (P.player.y | 0));
  ok(P.navAt(open[0], open[1]) >= manhattan,
     `a step count can never beat the manhattan bound (${P.navAt(open[0], open[1])} >= ${manhattan})`);
  ok(P.navAt(-1, 5) === -1 && P.navAt(5, 9999) === -1, 'off-map queries read as unreachable');
}

// enemies carry no keycards, so a locked door has to be a wall to the field —
// otherwise it routes a guard at a door it can never open and the guard stands there
{
  const locked = P.doors().find(d => d.lock !== null);
  const free   = P.doors().find(d => d.lock === null);
  ok(locked && !P.navPassable(locked.gx, locked.gy),
     'a locked door is impassable to the flow field');
  ok(free && P.navPassable(free.gx, free.gy),
     'an unlocked door is passable to the flow field');
}

// the catch-all: whatever moved a body — chasing, patrolling or being shoved —
// it may never end up inside geometry
P.startLevel();
for (const e of P.enemies()) if (e.alive) e.state = 'chase';
run(625);                                            // 10s of everyone converging
{
  const live = P.enemies().filter(e => e.alive);
  ok(live.every(e => !P.blockAt(e.x, e.y)),
     `every live enemy is on walkable ground after a 10s chase (${live.length} bodies)`);
  let closest = Infinity;
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++)
      closest = Math.min(closest, Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y));
  ok(closest > 0.6,
     `a group chase keeps bodies apart (closest pair ${closest.toFixed(3)}u; was 0.009u pre-Phase-2)`);
}

// forced full overlap — this is the state summoned drones can spawn into
P.startLevel();
{
  const stack = P.enemies().filter(e => e.alive).slice(0, 4);
  for (const e of stack) { e.x = 20.5; e.y = 36.5; e.state = 'chase'; }
  run(120);
  let closest = Infinity;
  for (let i = 0; i < stack.length; i++)
    for (let j = i + 1; j < stack.length; j++)
      closest = Math.min(closest, Math.hypot(stack[i].x - stack[j].x, stack[i].y - stack[j].y));
  ok(closest > 0.6, `four enemies stacked on one point push apart (${closest.toFixed(3)}u)`);
  ok(stack.every(e => !P.blockAt(e.x, e.y)), 'separation never shoves a body into a wall');
}

// patrols: the floor should be in motion before the first shot, but on a leash
P.startLevel();
{
  const roster = P.enemies().filter(e => e.type !== 'ceo');
  const home = roster.map(e => ({ e, x: e.x, y: e.y }));
  P.player.x = 20.5; P.player.y = 38.5;              // spawn corner, out of everyone's sight
  run(500);                                          // 8s
  const moved = home.filter(h => Math.hypot(h.e.x - h.x, h.e.y - h.y) > 0.25).length;
  ok(moved > 0, `idle enemies patrol rather than standing still (${moved}/${roster.length} moved)`);
  // the leash bounds the tile a patrol will WALK TO, so a body can sit a little
  // beyond it — at its centre, plus whatever separation shoved it. The strict
  // version of this assertion lives in the long-corridor fixture below.
  const worst = Math.max(...roster.map(e => Math.hypot(e.x - e.spawnX, e.y - e.spawnY)));
  ok(worst <= 7.5, `a patrol stays near its leash (furthest ${worst.toFixed(2)}u from spawn)`);
  ok(roster.some(e => Math.abs(e.heading + Math.PI / 2) > 0.01),
     'patrolling turns a body — heading is not still the spawn default');
  ok(roster.every(e => !e.alive || !P.blockAt(e.x, e.y)), 'a patrolling enemy stays out of walls');
  ok(roster.every(e => e.state === 'idle' || Math.hypot(e.x - P.player.x, e.y - P.player.y) < e.spec.sight),
     'patrolling does not wake enemies that never saw the player');
}

// the field is rebuilt on a timer, not only when the player crosses a tile line:
// a push-wall landing or a door changing state alters the route under a player
// who has not moved at all
P.startLevel();
{
  const grid = P.grid();
  P.player.x = 20.5; P.player.y = 38.5;
  run(4);
  let seal = null;
  for (let y = 1; y < grid.length - 1 && !seal; y++)
    for (let x = 1; x < grid[y].length - 1; x++)
      if (!grid[y][x] && P.navAt(x, y) > 2) { seal = [x, y]; break; }
  const wall = grid.flat().find(c => c && c.tag === 'panel');
  grid[seal[1]][seal[0]] = wall;                     // brick up a tile, player stands still
  run(40);                                           // 0.64s — longer than the rebuild period
  ok(P.navAt(seal[0], seal[1]) === -1,
     'the field refreshes on its timer while the player stays on one tile');
  grid[seal[1]][seal[0]] = 0;
}

// heading is written by moveEnemy — the one primitive every mover goes through
{
  const e = firstGuard();
  e.x = 20.5; e.y = 36.5; e.heading = 0;
  P.moveEnemy(e, 0, 0.05);
  ok(Math.abs(e.heading - Math.PI / 2) < 0.01,
     `moving south records a southward heading (${e.heading.toFixed(2)})`);
  P.moveEnemy(e, -0.05, 0);
  ok(Math.abs(Math.abs(e.heading) - Math.PI) < 0.01,
     `moving west records a westward heading (${e.heading.toFixed(2)})`);
}

// ── enemy facing ─────────────────────────────────────────────────────────────
group('enemy facing');
P.startLevel();
{
  const SPRT = P.spr();
  const foe = firstGuard();

  // the branches that existed before Phase 2 still win over any rotation
  foe.state = 'attack';
  ok(P.enemySprite(foe) === SPRT.guardFire, 'an attacking guard still shows the firing frame');
  foe.alive = false; foe.state = 'dying';
  ok(P.enemySprite(foe) === SPRT.guardDie, 'a dying guard still shows the death frame');
  foe.state = 'dead';
  ok(P.enemySprite(foe) === SPRT.guardDead, 'a dead guard still shows the corpse frame');
  foe.alive = true; foe.state = 'chase';

  // A drone is a symmetric ring of rotors and the CEO always squares up to you,
  // so neither rotates — asserted so nobody "completes" the feature by accident.
  const drone = P.enemies().find(e => e.type === 'drone' && e.alive);
  if (drone) {
    drone.state = 'chase';
    drone.heading = 0;   const a = P.enemySprite(drone);
    drone.heading = Math.PI;
    ok(a === P.enemySprite(drone) && a === SPRT.drone, 'drones stay single-view');
  } else {
    ok(false, 'test setup: no live drone to check');
  }

  // Rotation pick, checked against the game's OWN projection rather than
  // against the algebra. The first implementation had left and right swapped in
  // all eight viewing cases and looked perfectly reasonable in review.
  P.player.x = 20; P.player.y = 20; P.player.a = 0;
  foe.x = 25; foe.y = 20;                            // five units straight ahead
  const screenCol = (x, y) => {
    const c = Math.cos(P.player.a), s = Math.sin(P.player.a);
    const ex = x - P.player.x, ey = y - P.player.y;
    return P.spriteSpan(ex * c + ey * s, -ex * s + ey * c, SPRT.guard.wW).centerCol;
  };
  foe.heading = 0;
  ok(P.enemySprite(foe) === SPRT.guardBack, 'a guard walking away shows its back');
  foe.heading = Math.PI;
  ok(P.enemySprite(foe) === SPRT.guard, 'a guard walking at you shows its front');

  let sides = 0, agree = 0;
  for (const h of [-Math.PI / 2, Math.PI / 2]) {
    foe.heading = h;
    const drift = screenCol(foe.x + Math.cos(h) * 0.5, foe.y + Math.sin(h) * 0.5)
                - screenCol(foe.x, foe.y);
    const want = drift < 0 ? SPRT.guardLeft : SPRT.guardRight;
    sides++;
    if (P.enemySprite(foe) === want) agree++;
  }
  ok(agree === sides,
     `the side sprite matches the way the guard actually travels on screen (${agree}/${sides})`);
  foe.heading = -Math.PI / 2;  const sA = P.enemySprite(foe);
  foe.heading =  Math.PI / 2;  const sB = P.enemySprite(foe);
  ok(sA !== sB && sA !== SPRT.guard && sB !== SPRT.guard,
     'the two profiles are distinct sprites, and neither is the front view');
  ok([SPRT.guardBack, SPRT.guardLeft, SPRT.guardRight]
       .every(a => a.wW === SPRT.guard.wW && a.wH === SPRT.guard.wH && a.foot === SPRT.guard.foot),
     'every rotation keeps the front sprite\'s footprint, so turning never resizes a guard');
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

// ── the weapon roster ────────────────────────────────────────────────────────
group('weapons');
P.startLevel();
const KNIFE = 0, PISTOL_I = 1, SMG_I = 2, CHAIN = 3;
const W = P.weapons();
ok(W.length === 4, `the roster has four weapons (${W.map(w => w.name).join(', ')})`);
ok(P.player.weapon === PISTOL_I && P.curWeapon().name === 'PISTOL',
   'a cold start hands you the pistol');
ok(W[PISTOL_I].cd === 0.28 && W[PISTOL_I].dmgMin === 22 && W[PISTOL_I].dmgSpan === 20 &&
   W[PISTOL_I].clip === 8 && W[PISTOL_I].spread === 0 && W[PISTOL_I].alert === 9,
   'the pistol row still describes the weapon the game shipped with');

// only the pistol is single-shot; that is the whole semi-auto item
ok(W[PISTOL_I].auto === false, 'the pistol does not repeat on a held trigger');
ok(W[KNIFE].auto && W[SMG_I].auto && W[CHAIN].auto, 'everything else does');

// ── selection
ok(P.selectWeapon(SMG_I) && P.player.weapon === SMG_I, 'a number key selects a weapon');
ok(!P.selectWeapon(SMG_I), 'selecting the weapon already up is a no-op');
ok(!P.selectWeapon(9) && !P.selectWeapon(-1) && P.player.weapon === SMG_I,
   'an out-of-range index is refused');
P.player.weapons[CHAIN] = 0;
ok(!P.selectWeapon(CHAIN) && P.player.weapon === SMG_I, 'an unowned weapon is refused');
P.player.weapons[CHAIN] = 1;

// ── the clip truncates on a switch, and never tops up. Switching would
//    otherwise be a free instant reload, which is the whole reason for the rule.
P.selectWeapon(SMG_I);
P.player.clip = 25; P.player.ammo = 60;
P.selectWeapon(PISTOL_I);
ok(P.player.clip === 8, `switching to a smaller magazine truncates (${P.player.clip})`);
ok(P.player.ammo === 60, `and the surplus stays in the reserve (${P.player.ammo})`);
P.selectWeapon(SMG_I);
ok(P.player.clip === 8, `switching back does NOT refill the magazine (${P.player.clip})`);

// ── the knife has no magazine, and must not eat the one you were holding
P.selectWeapon(PISTOL_I);
P.player.clip = 8; P.player.ammo = 40;
P.selectWeapon(KNIFE);
ok(P.player.clip === 8, `drawing the knife leaves your gun loaded (${P.player.clip})`);
ok(!P.startReload(), 'the knife cannot be reloaded');
P.player.fireCd = 0;
P.player.ammo = 40;
P.fire(); run(2);
ok(P.player.ammo === 40 && P.player.clip === 8, 'and swinging it spends no ammo');

// ── the knife reaches a body you are standing on, which is most of the range
//    it has. Nothing keeps the player off an enemy tile — blockAt only reads
//    the grid — so walking into a guard puts it at depth ~0.2, inside the
//    0.35 dead zone every gun has. That one number is the whole of "melee
//    works at contact range"; the screen-space test needs no help, because
//    depth cancels out of it and it is really |lateral| > wW/2.
P.startLevel();
freezeEnemies();
const kv = firstGuard();
P.player.x = kv.x - 0.18; P.player.y = kv.y;
P.player.a = Math.atan2(kv.y - P.player.y, kv.x - P.player.x);
ok(0.18 < W[PISTOL_I].minDepth && W[KNIFE].minDepth === 0,
   `test setup: 0.18u is inside the guns' dead zone (${W[PISTOL_I].minDepth}) and outside the knife's`);
P.selectWeapon(KNIFE);
P.player.fireCd = 0;
const kvHp = kv.hp;
P.fire(); run(2);
ok(kv.hp < kvHp, `the knife connects at contact range (${kvHp} -> ${kv.hp})`);

// ...and not across a room, which is what `reach` is for
P.startLevel();
freezeEnemies();
const kf = firstGuard();
ok(place(kf, 3), 'test setup: player placed 3u from a guard with LOS');
P.selectWeapon(KNIFE);
P.player.fireCd = 0;
const kfHp = kf.hp;
P.fire(); run(2);
ok(kf.hp === kfHp, 'the knife does not reach across a room');
P.selectWeapon(PISTOL_I);
P.player.fireCd = 0;          // the raise costs a beat; clear it after the switch
P.fire(); run(2);
ok(kf.hp < kfHp, 'but the pistol does, from the same spot');

// ── per-weapon cooldown really gates the rate of fire
P.startLevel();
freezeEnemies();
const cdTarget = firstGuard();
place(cdTarget, 3);
for (const [idx, name] of [[PISTOL_I, 'pistol'], [CHAIN, 'chaingun']]) {
  P.player.weapon = idx;
  P.player.ammo = 400; P.player.clip = P.curWeapon().clip;
  P.player.fireCd = 0; P.player.windT = P.curWeapon().spinUp;
  const before = P.player.ammo;
  // 30 frames at 16ms = 0.48s: 1 pistol shot at 0.28s, several chaingun at 0.07s
  for (let i = 0; i < 30; i++) { P.fire(); run(1); P.player.windT = P.curWeapon().spinUp; }
  const shots = before - P.player.ammo;
  if (name === 'pistol') ok(shots <= 2, `the pistol fires at most twice in 0.48s (${shots})`);
  else ok(shots >= 5, `the chaingun fires far more in the same time (${shots})`);
}

// ── the chaingun will not fire until its barrels are up to speed
P.startLevel();
freezeEnemies();
P.selectWeapon(CHAIN);
P.player.ammo = 100; P.player.clip = 50; P.player.fireCd = 0; P.player.windT = 0;
const spinAmmo = P.player.ammo;
P.fire();
ok(P.player.ammo === spinAmmo, 'a cold chaingun fires nothing on the first pull');
run(40, [' ']);   // hold the trigger past the 0.42s spin-up
ok(P.player.ammo < spinAmmo, `holding it spins up and then fires (${spinAmmo} -> ${P.player.ammo})`);

// ── the auto gate: a held trigger repeats for the SMG and not for the pistol.
//    This is the semi-auto item, exercised through frame()'s real input path
//    rather than by calling fire() directly, which bypasses the gate.
P.startLevel();
freezeEnemies();
for (const [idx, name] of [[PISTOL_I, 'pistol'], [SMG_I, 'SMG']]) {
  P.player.weapon = idx;
  P.player.ammo = 300; P.player.clip = P.curWeapon().clip;
  P.player.fireCd = 0; P.player.reloadT = 0;
  const before = P.player.ammo;
  run(40, [' ']);            // ~0.64s with the trigger held down
  const shots = before - P.player.ammo;
  if (name === 'pistol') ok(shots === 0, `holding fire does not repeat the pistol (${shots} shots)`);
  else ok(shots >= 4, `holding fire does repeat the ${name} (${shots} shots)`);
}

// ── reload cycle length is the weapon's own, not always the pistol's
P.startLevel();
P.selectWeapon(SMG_I);
P.player.ammo = 60; P.player.clip = 1; P.player.reloadT = 0;
ok(P.startReload() && Math.abs(P.player.reloadT - W[SMG_I].reload) < 1e-9,
   `the SMG reloads on its own cycle (${P.player.reloadT}s, not ${W[PISTOL_I].reload}s)`);
ok(Math.abs(P.player.reloadMax - W[SMG_I].reload) < 1e-9,
   'and the view-model is told how long that cycle is');
run(90);
ok(P.player.clip === W[SMG_I].clip, `it seats a full SMG magazine (${P.player.clip})`);

P.selectWeapon(PISTOL_I);

// ── doors ────────────────────────────────────────────────────────────────────
group('doors & keycards');
P.startLevel();
freezeEnemies();                     // this group is about doors, not about who walks into one
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
freezeEnemies();
const red = P.doors().find(d => d.lock === 'red');
P.player.x = red.gx + 0.5; P.player.y = red.gy + 1.5; P.player.a = -Math.PI / 2;
P.use(); run(10);
ok(red.phase === 'closed', 'red door stays shut without its keycard');
P.player.keyRed = true;
P.use(); run(40);
ok(red.open >= 1, 'red door opens once the keycard is held');

P.startLevel();
freezeEnemies();
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

// ── damage direction ─────────────────────────────────────────────────────────
group('damage direction');
P.startLevel();
freezeEnemies();

// A hit with no source is still a hit: the flash fires, the arc does not.
P.hitDirs().length = 0;
P.player.hp = 100;
P.hurtPlayer(7);
ok(P.player.hp === 93, 'a source-less hit still takes health');
ok(P.hitDirs().length === 0, 'and leaves no marker pointing nowhere');

// The side the arc lands on is MEASURED against the game's own projection —
// the same technique the guard-rotation test uses, and for the same reason:
// the guardLeft/guardRight pair shipped mirrored in all eight cases because
// someone reasoned about the sign of atan2 instead of measuring it. An arc
// that points at the wrong side of the screen would be just as invisible in
// review and considerably more annoying in play.
for (const turn of [-0.55, 0.55]) {
  P.startLevel();
  freezeEnemies();
  const src = firstGuard();
  ok(place(src, 3), 'test setup: a guard 3u ahead with LOS');
  P.player.a += turn;                       // now it is off to one side

  const cosA = Math.cos(P.player.a), sinA = Math.sin(P.player.a);
  const ex = src.x - P.player.x, ey = src.y - P.player.y;
  const depth = ex * cosA + ey * sinA;
  const lat   = -ex * sinA + ey * cosA;
  // where the renderer itself would put this body on screen
  const truth = P.spriteSpan(depth, lat, P.spr().guard.wW).centerCol;

  P.hitDirs().length = 0;
  P.player.hp = 100;
  P.hurtPlayer(5, src.x, src.y);
  ok(P.hitDirs().length === 1, 'a hit from a known body leaves one marker');

  const cell = P.hitDirCell(P.hitDirAngle(P.hitDirs()[0]), 0, 45);
  const side = n => (n > 80 ? 'right' : 'left');
  ok(Math.sign(cell.col - 80) === Math.sign(truth - 80),
     `the arc lands on the same side the shooter renders on ` +
     `(sprite at col ${truth.toFixed(0)} = ${side(truth)}, ` +
     `arc at col ${cell.col} = ${side(cell.col)})`);
}

// Behind you is behind you: the arc drops below the crosshair, not above it.
{
  P.startLevel();
  freezeEnemies();
  P.player.a = 0;
  P.hitDirs().length = 0;
  P.hurtPlayer(5, P.player.x - 4, P.player.y);        // directly astern
  const back = P.hitDirCell(P.hitDirAngle(P.hitDirs()[0]), 0, 45);
  P.hitDirs().length = 0;
  P.hurtPlayer(5, P.player.x + 4, P.player.y);        // dead ahead
  const front = P.hitDirCell(P.hitDirAngle(P.hitDirs()[0]), 0, 45);
  ok(back.row > 45 && front.row < 45,
     `a shot from behind reads low and one from ahead reads high (${back.row} vs ${front.row})`);
}

// The arc swings as you turn to look: it is anchored in the world, not to the
// screen position it first appeared at.
{
  P.startLevel();
  freezeEnemies();
  P.player.a = 0;
  P.hitDirs().length = 0;
  P.hurtPlayer(5, P.player.x, P.player.y + 4);
  const before = P.hitDirCell(P.hitDirAngle(P.hitDirs()[0]), 0, 45).col;
  P.player.a += Math.PI / 2;                          // turn to face the shooter
  const after = P.hitDirCell(P.hitDirAngle(P.hitDirs()[0]), 0, 45).col;
  ok(before !== after && Math.abs(after - 80) < Math.abs(before - 80),
     `turning toward the shooter swings the arc to centre (col ${before} -> ${after})`);
}

// The arc is a CIRCLE, which on a 7x12 cell grid means the row radius has to be
// smaller than the column radius, not equal to it. Getting this backwards
// draws a tall ellipse that still points the right way, so it survives review.
{
  const c = P.cellSize();
  const top   = P.hitDirCell(0, 0, 45);              // straight ahead
  const right = P.hitDirCell(Math.PI / 2, 0, 45);    // 90 degrees starboard
  const rowPx = (45 - top.row) * c.h;
  const colPx = (right.col - 80) * c.w;
  ok(Math.abs(rowPx - colPx) <= c.h,
     `the arc is round in pixels, not in cells (${colPx}px across, ${rowPx}px up)`);
}

// A new floor is a clean slate: an arc left pointing at last floor's ambush
// would be pointing at a body that is not there.
P.startLevel();
P.hurtPlayer(5, P.player.x + 3, P.player.y);
ok(P.hitDirs().length === 1, 'test setup: a marker is live');
P.startLevel();
ok(P.hitDirs().length === 0, 'starting a floor clears the markers');

// Markers merge and expire rather than piling up on the same few cells.
P.startLevel();
P.hitDirs().length = 0;
for (let i = 0; i < 5; i++) P.hurtPlayer(1, P.player.x + 3, P.player.y);
ok(P.hitDirs().length === 1, 'repeated fire from one spot refreshes one marker');
P.hurtPlayer(1, P.player.x - 3, P.player.y);
ok(P.hitDirs().length === 2, 'but a shot from elsewhere adds its own');
run(60);
ok(P.hitDirs().length === 0, 'and they expire');

// The arc redraws every frame it is alive, so its fade has to be quantised:
// every distinct (glyph, colour) pair is an atlas entry, and a continuous
// alpha stringified per frame mints a fresh one each time. The property that
// matters is not a magic number, it is that the cost CONVERGES — so this
// measures the atlas after a burst of arcs and again after five times as many.
//
// Measured as an A/B over the SAME number of frames, because ordinary
// rendering — the neon flicker, the rain — mints entries of its own as the
// clock advances, and a naive before/after would bill those to the arc.
P.startLevel();
run(600);                                  // let the background palette settle
const settled = P.atlasSize();
run(1000);                                 // 1000 quiet frames
const quietCost = P.atlasSize() - settled;
const beforeArcs = P.atlasSize();
for (let i = 0; i < 200; i++) {            // 1000 frames, 200 arcs
  P.player.hp = 100;
  P.hurtPlayer(1, P.player.x + Math.cos(i) * 3, P.player.y + Math.sin(i) * 3);
  run(5);
}
const arcCost = P.atlasSize() - beforeArcs;
ok(arcCost - quietCost <= 8,
   `200 arcs cost at most the 8 (glyph, colour) pairs a 4-step fade can make ` +
   `(${arcCost} entries over 1000 frames vs ${quietCost} for the same frames idle)`);

// The damage-number pop fade is the pre-existing sibling of the arc fade above
// — the one that was found unquantised while fixing the arc — and it needs
// its own assertion for the same reason: nothing else in the suite fires
// enough shots to trip the boot-time `atlasSize() < 500` check before this
// point, so a regression here would pass every other assertion clean.
// Unquantised, 40 shots cost ~375 atlas entries; quantised to 8 steps it
// converges. Same A/B shape as the arc, same reason: ordinary rendering
// mints entries of its own as frames advance.
P.startLevel();
run(600);
const popSettled = P.atlasSize();
run(300);
const popQuietCost = P.atlasSize() - popSettled;
const popFoe = firstGuard();
const beforePops = P.atlasSize();
for (let i = 0; i < 40; i++) {
  popFoe.hp = 1e9; popFoe.x = P.player.x + 2; popFoe.y = P.player.y; P.player.a = 0;
  P.player.fireCd = 0; P.player.ammo = 500; P.player.clip = 8;
  P.fire(); run(5);
}
const popCost = P.atlasSize() - beforePops;
// Measured convergence at 8-step quantisation: ~293 entries flat through 320+
// shots (hit/kill colour x jitter position x shadow row all multiply against
// the 8 alpha steps). Unquantised the same 40 shots cost ~375 on their own and
// never stop growing. 100 is comfortably below "never converges" and above
// the honest quantised cost.
ok(popCost - popQuietCost < 100,
   `40 damage-number pops cost a bounded handful of (glyph, colour) pairs, ` +
   `not an unbounded ~375 (${popCost} entries vs ${popQuietCost} idle)`);

// ── difficulty ───────────────────────────────────────────────────────────────
// LAST of the shipped-level groups on purpose. `difficulty` is a run-level
// setting that startLevel deliberately does NOT reset, so it leaks forward into
// every test after it — the same ordering trap as startLevel() defaulting to
// the current floor. This group restores the default before it hands back.
group('difficulty');
const D = P.difficulties();
ok(D.length === 4, `four settings (${D.map(d => d.name).join(' / ')})`);
ok(P.difficulty() === 2, 'the default is index 2');
ok(D[2].acc === 1 && D[2].dmg === 1 && D[2].cd === 1 && D[2].keep === 1 && D[2].extra === 0,
   'and every multiplier on it is 1.0 — the default IS the pre-difficulty game');
ok(D[0].acc < D[2].acc && D[2].acc < D[3].acc, 'accuracy climbs across the four');
ok(D[0].dmg < D[2].dmg && D[2].dmg < D[3].dmg, 'so does damage');
ok(D[3].cd < D[2].cd && D[2].cd < D[0].cd, 'and the delay between attacks shortens');

ok(P.setDifficulty(0) === 0 && P.difficulty() === 0, 'setDifficulty selects');
ok(P.setDifficulty(99) === 3 && P.setDifficulty(-5) === 0, 'and clamps to the table');

// ── enemy HP is deliberately NOT scaled: shots-to-kill has to mean the same
//    thing at every setting, or the damage numbers stop being feedback.
const hpAt = d => { P.setDifficulty(d); P.startLevel(); return firstGuard().spec.hp; };
ok(hpAt(0) === hpAt(3), `a guard has the same health on both extremes (${hpAt(0)})`);

// ── spawn counts. Deterministic, so the same setting twice gives the same
//    floor — a random filter would make every restart a different level.
const countAt = d => { P.setDifficulty(d); P.startLevel(); return P.enemies().length; };
const easy = countAt(0), normal = countAt(2), death = countAt(3);
ok(easy === countAt(0), `the same setting builds the same floor twice (${easy})`);
ok(easy < normal, `the easiest floor is thinner (${easy} vs ${normal})`);
ok(death > normal, `and the hardest is denser (${death} vs ${normal})`);
ok(P.enemies().length === P.totalEnemies(),
   `the kill denominator follows the real body count (${P.totalEnemies()})`);

// ── the boss is never filtered away: it is the floor's win condition, and the
//    elevator will not move while it lives.
for (const d of [0, 1, 2, 3]) {
  P.setDifficulty(d);
  P.startLevel(2);
  if (!P.boss()) { ok(false, `floor 3 still places a CEO on setting ${d}`); break; }
}
ok(!!P.boss(), 'the CEO survives every difficulty filter');
P.startLevel(0);

// ── what difficulty is actually FOR: the same guard, in the same spot, has to
//    hurt you more on a harder setting. Everything above this point asserts on
//    the table's shape and the body count — none of it would notice the
//    multipliers being dropped on the floor of enemyShot(), and a mutation
//    battery caught exactly that: deleting D.acc and deleting D.dmg both
//    survived a fully green suite.
//
//    Accuracy and damage are sampled SEPARATELY so that dropping either one
//    fails its own assertion rather than hiding behind the other.
{
  const sample = (d, n) => {
    P.setDifficulty(d);
    P.startLevel();
    freezeEnemies();
    const e = firstGuard();
    place(e, 2);
    let hits = 0, dmg = 0;
    for (let i = 0; i < n; i++) {
      P.player.hp = 100;              // topped up so a sample can never kill
      P.enemyShot(e, 2);
      const took = 100 - P.player.hp;
      if (took > 0) { hits++; dmg += took; }
    }
    return { hits, perHit: hits ? dmg / hits : 0 };
  };
  const N = 500;
  const soft = sample(0, N), hard = sample(3, N);
  // the tables differ by 1.30/0.55 = 2.4x on each; 1.6x is a wide margin on
  // 500 samples while still being far above the noise
  ok(hard.hits > soft.hits * 1.6,
     `a harder setting lands more shots (${soft.hits}/${N} on the easiest, ` +
     `${hard.hits}/${N} on the hardest)`);
  ok(hard.perHit > soft.perHit * 1.6,
     `and each one hurts more (${soft.perHit.toFixed(1)} vs ` +
     `${hard.perHit.toFixed(1)} hp per hit)`);
}

// ── and the delay between attacks: only enemyShot() was sampled above, which
//    never exercises DIFFICULTY[difficulty].cd — that multiplier is applied to
//    e.atkCd in the 'attack' case of stepEnemies, one FSM transition away from
//    anything the sample above touches. Drive the real FSM instead: park a
//    guard already in 'attack' with LOS and count how many volleys it gets off
//    in a fixed window on each setting.
{
  const attacksIn = (d, ms) => {
    P.setDifficulty(d);
    P.startLevel();
    freezeEnemies();
    const e = firstGuard();
    place(e, 3);
    e.state = 'attack'; e.stateT = 0; e.shotsLeft = 1;
    let shots = 0;
    const before = P.player.hp;
    let lastHp = before;
    for (let t = 0; t < ms; t += 16) {
      run(1);
      if (e.state === 'attack' && e.stateT === 0) shots++;   // just re-entered attack
      // re-arm: freezeEnemies + a fixed spot means it will keep re-entering
      // 'attack' every cooldown as long as it stays alive and in range
      if (e.state === 'chase') { e.state = 'attack'; e.stateT = 0; e.shotsLeft = 1; }
    }
    return shots;
  };
  const N = 4000;   // milliseconds
  const soft = attacksIn(0, N), hard = attacksIn(3, N);
  ok(hard > soft, `a shorter cooldown fits more attacks into the same window (${soft} vs ${hard})`);
}


// Restore the default BEFORE the fixture below: loadWithLevel replaces the
// process globals, and every assertion on `P` after that point would be
// running against an instance that has stopped stepping. Forgetting this is
// exactly how a difficulty group poisons every group after it.
P.setDifficulty(2);
P.startLevel(0);
ok(P.difficulty() === 2, 'the default is restored before the fixtures run');

// ── thinning can never empty a floor. ratio() reports an empty category as
//    100%, so a floor filtered down to nothing would silently hand out a
//    perfect kill ratio and its 2500 bonus.
{
  const f = loadWithLevel([
    '##########',
    '#@......g#',
    '#........#',
    '#.......X#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  f.P.setDifficulty(0);
  f.P.startLevel();
  ok(f.P.enemies().length === 1,
     `a one-guard floor keeps its guard on the easiest setting (${f.P.enemies().length})`);
  ok(f.P.totalEnemies() > 0, 'so the kill ratio never divides by zero');
}

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

// ── pathfinding around geometry (fixture) ────────────────────────────────────
// The shipped floors are open enough that a guard usually stumbles into the
// player by accident. This is the exact shape that beat the pre-Phase-2 chase:
// a guard in the east room, a player up the west leg, and no sightline between
// them. The old build closed to 3.19u, dropped inside its own 3.2u standoff
// with no line of sight, and stopped dead against the wall at (4.35, 2.93).
//
//   #@#......#     player up the one-wide west leg
//   #.#....g.#     guard in the east room
//   #.####...#     the only route is south, east, then north
group('pathfinding (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@#......#',
    '#.#......#',
    '#.#......#',
    '#.#....g.#',
    '#.#.....g#',
    '#.####...#',
    '#........#',
    '#.......X#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  F.player.x = 1.5; F.player.y = 1.5; F.player.a = 0;
  const foe = F.enemies().find(e => e.type === 'guard');
  ok(!F.hasLOS(foe.x, foe.y, F.player.x, F.player.y),
     'test setup: the guard starts with no sightline to the player');
  foe.state = 'chase';

  let arrived = -1;
  for (let i = 0; i < 1250 && arrived < 0; i++) {          // up to 20s
    f.step(16, []);
    if (F.hasLOS(foe.x, foe.y, F.player.x, F.player.y)
        && Math.hypot(foe.x - F.player.x, foe.y - F.player.y) < 3.4) arrived = i * 16 / 1000;
  }
  ok(arrived >= 0,
     `a guard routes around a corner instead of grinding the wall (arrived at ${arrived.toFixed(1)}s)`);
  ok(!F.blockAt(foe.x, foe.y), 'and it is standing on walkable ground when it gets there');

  // Two bodies side by side ACROSS a one-wide corridor. The push wants to go
  // straight into both walls, so separation has to give up rather than squeeze
  // them out — a corridor that narrow simply cannot hold two guards abreast.
  // Asserted on body clearance, not on tile occupancy: a shoulder 0.11u inside
  // the wall still leaves the centre on a walkable tile, which is exactly how
  // this would slip through review.
  const pair = F.enemies().filter(e => e.alive).slice(0, 2);
  if (pair.length === 2) {
    // 'hurt' with a long timer parks the FSM so only separation is moving them
    for (const e of pair) { e.state = 'hurt'; e.stateT = 999; e.y = 3.5; }
    pair[0].x = 1.4; pair[1].x = 1.6;
    f.run(90);
    const B = 0.26;                                  // BODY_MARGIN in wolf3d.html
    ok(pair.every(e => !F.blockAt(e.x - B, e.y) && !F.blockAt(e.x + B, e.y)),
       `separation never squeezes a body into a corridor wall ` +
       `(${pair.map(e => e.x.toFixed(2)).join(', ')})`);
  } else {
    ok(false, 'test setup: needed two live enemies for the corridor case');
  }
}

// ── the standoff has to be gated on sight (fixture) ──────────────────────────
// A route that doubles back past the player behind a thin wall. The guard's
// straight-line distance drops under its own 3.2u standoff at (2,3) — one tile
// short of turning the corner — while it still has no sightline. Hold the
// standoff on raw distance and it freezes there having done all the walking.
//
//   #@.......#
//   #.########     the only way through is column 1
//   #...g....#
group('sight-gated standoff (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@.......#',
    '#.########',
    '#...g....#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  F.player.x = 1.5; F.player.y = 1.5; F.player.a = 0;
  const foe = F.enemies().find(e => e.type === 'guard');
  ok(!F.hasLOS(foe.x, foe.y, F.player.x, F.player.y)
     && Math.hypot(foe.x - F.player.x, foe.y - F.player.y) > 3.2,
     'test setup: no sightline, and the guard starts outside its standoff');
  ok(!F.hasLOS(2.5, 3.5, F.player.x, F.player.y)
     && Math.hypot(2.5 - F.player.x, 3.5 - F.player.y) < 3.2,
     'test setup: the route passes inside 3.2u while still walled off');
  foe.state = 'chase';
  let arrived = false;
  for (let i = 0; i < 1250 && !arrived; i++) {
    f.step(16, []);
    arrived = F.hasLOS(foe.x, foe.y, F.player.x, F.player.y);
  }
  ok(arrived, `the standoff yields to a blocked sightline instead of freezing the ` +
              `guard mid-route (ended at ${foe.x.toFixed(2)},${foe.y.toFixed(2)})`);
}

// ── the patrol leash, strictly (fixture) ─────────────────────────────────────
// A long straight corridor, with the player bricked into an alcove so nothing
// ever wakes. Unleashed, a guard walks this end to end; leashed, it turns round
// at 6u and comes back.
group('patrol leash (fixture)');
{
  const f = loadWithLevel([
    '#################################',
    '#@#..g..........................#',
    '#################################',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const foe = F.enemies().find(e => e.type === 'guard');
  ok(foe && foe.state === 'idle' && !F.hasLOS(foe.x, foe.y, F.player.x, F.player.y),
     'test setup: one guard, idle, with the player sealed out of sight');
  let far = 0, path = 0, px = foe.x, py = foe.y;
  for (let i = 0; i < 2500; i++) {                   // 40s of patrolling
    f.step(16, []);
    far = Math.max(far, Math.hypot(foe.x - foe.spawnX, foe.y - foe.spawnY));
    path += Math.hypot(foe.x - px, foe.y - py); px = foe.x; py = foe.y;
  }
  ok(foe.state === 'idle', 'the guard never spotted the sealed-off player');
  ok(far > 2.0, `and it actually walked its beat (reached ${far.toFixed(2)}u from spawn)`);
  ok(far <= 7.0, `a patrol never leaves its leash (furthest ${far.toFixed(2)}u of a 6u leash)`);
  // A guard that dwelt at every tile centre rather than only at turns covered
  // 12-13u here instead of 19u. That is the difference between walking a beat
  // and shuffling, and it is invisible on the shipped floors.
  ok(path > 16, `a patrol walks rather than shuffles (${path.toFixed(1)}u covered in 40s)`);
}

// ── enemies and doors (fixture) ──────────────────────────────────────────────
// A shut door blocks the sightline by itself, so no corner is needed here.
// `D` is unlocked and `R` needs the red keycard, which no enemy will ever hold.
group('enemies and doors (fixture)');
{
  const openRun = (lockChar) => {
    const f = loadWithLevel([
      '##########',
      '#@..' + lockChar + '...g#',
      '##########',
    ], { htmlPath: process.env.WOLF3D_HTML });
    const F = f.P;
    F.player.x = 1.5; F.player.y = 1.5; F.player.a = 0;
    const foe = F.enemies().find(e => e.type === 'guard');
    foe.state = 'chase';
    f.run(750);                                            // 12s
    return { F, foe, door: F.doors()[0] };
  };

  const un = openRun('D');
  ok(un.door.phase !== 'closed',
     `a chasing guard leans on an unlocked door (phase=${un.door.phase})`);
  ok(un.F.hasLOS(un.foe.x, un.foe.y, un.F.player.x, un.F.player.y),
     'and comes through it to reach the player');

  const lk = openRun('R');
  ok(lk.door.phase === 'closed' && lk.door.open === 0,
     `a locked door stays shut — enemies carry no keycards (phase=${lk.door.phase})`);
  ok((lk.foe.x | 0) !== lk.door.gx,
     `and the guard never ends up inside it (guard at ${lk.foe.x.toFixed(2)}, door at ${lk.door.gx})`);
  ok(!lk.F.blockAt(lk.foe.x, lk.foe.y), 'the balked guard is still on walkable ground');

  // `navPassable` already keeps the field off locked doors, so openDoorAhead's
  // own lock check never fires in play. It is tested directly rather than left
  // as a branch nobody has ever seen work: enemies opening locked doors would
  // unpick every keycard gate on all three floors, which is too load-bearing to
  // leave resting on one caller happening to filter its arguments.
  lk.foe.x = lk.door.gx + 1.4; lk.foe.y = lk.door.gy + 0.5;
  lk.F.openDoorAhead(lk.foe, lk.door.gx, lk.door.gy);
  ok(lk.door.phase === 'closed',
     'openDoorAhead refuses a locked door even when handed one directly');
  const un2 = un.door;
  un2.phase = 'closed'; un2.open = 0;
  un.foe.x = un2.gx + 1.4; un.foe.y = un2.gy + 0.5;
  un.F.openDoorAhead(un.foe, un2.gx, un2.gy);
  ok(un2.phase === 'opening', 'and opens an unlocked one from the same distance');
  un.foe.x = un2.gx + 4.0;
  un2.phase = 'closed'; un2.open = 0;
  un.F.openDoorAhead(un.foe, un2.gx, un2.gy);
  ok(un2.phase === 'closed', 'a door is only leaned on from arm\'s length, not across the room');
}

// ── spread makes distance matter (fixture) ───────────────────────────────────
// The shipped floors have no sightline long enough to tell an accurate weapon
// from an inaccurate one, which is the usual reason a fixture exists here.
//
// The hit test is depth-independent on its own (|lateral| > wW/2), so ALL of
// the SMG's and chaingun's inaccuracy comes from `spread`: a fixed jitter in
// screen columns against a target whose half-width is 59/depth columns. Close
// up nothing misses; far away the jitter is wider than the guard.
group('weapon spread (fixture)');
{
  const f = loadWithLevel([
    '####################',
    '#..................#',
    '#@...............g.#',
    '#..................#',
    '####################',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const foe = F.enemies().find(e => e.type === 'guard');
  foe.state = 'hurt'; foe.stateT = 1e9;      // park it; this is about aim only

  // dead centre on the target, at the far end of the corridor
  F.player.y = foe.y;
  F.player.a = Math.atan2(foe.y - F.player.y, foe.x - F.player.x);
  const range = Math.hypot(foe.x - F.player.x, foe.y - F.player.y);
  ok(range > 12, `test setup: the corridor gives a ${range.toFixed(1)}u sightline`);
  ok(F.hasLOS(F.player.x, F.player.y, foe.x, foe.y), 'test setup: with line of sight');

  // Perfectly aimed, so every miss is spread and nothing else.
  const volley = (idx, shots) => {
    F.player.weapon = idx;
    let hits = 0;
    for (let i = 0; i < shots; i++) {
      foe.hp = 1e9;
      F.player.ammo = 500; F.player.clip = F.curWeapon().clip;
      F.player.fireCd = 0; F.player.reloadT = 0;
      F.player.windT = F.curWeapon().spinUp;
      F.fire();
      if (foe.hp < 1e9) hits++;
    }
    return hits;
  };

  const N = 200;
  const pistolHits = volley(1, N);
  const smgHits    = volley(2, N);
  const chainHits  = volley(3, N);
  ok(pistolHits === N, `the pistol never misses a centred target (${pistolHits}/${N})`);
  ok(smgHits < N, `the SMG does, at ${range.toFixed(1)}u (${smgHits}/${N})`);
  ok(chainHits < smgHits,
     `and the chaingun is the loosest of the three (${chainHits}/${N} vs ${smgHits}/${N})`);

  // ...and none of them misses in your face, where the jitter is far narrower
  // than the target: same weapon, same roll, different geometry.
  foe.x = F.player.x + 1.2;
  const smgClose = volley(2, 60);
  ok(smgClose === 60, `the SMG does not miss at 1.2u (${smgClose}/60)`);

  // ── one roll per SHOT, not one per candidate.
  // Rolling inside the candidate loop gives every enemy its own independent
  // chance, so a shot into a crowd would hit far more often than the same shot
  // at one body — spread would quietly stop being a cone and start being a
  // hit test that widens with the number of things in front of you. Stacking
  // three targets on one spot makes that difference enormous and needs no
  // randomness to reason about: p versus 1-(1-p)^3.
  foe.x = 17.5;
  const stackHits = (n, shots) => {
    const stack = [foe];
    for (let i = 1; i < n; i++) {
      const clone = F.enemies().find(e => e.type === 'guard' && e !== foe && !stack.includes(e));
      const born = clone || Object.assign(Object.create(Object.getPrototypeOf(foe)), foe);
      born.x = foe.x; born.y = foe.y; born.alive = true;
      born.state = 'hurt'; born.stateT = 1e9;
      if (!F.enemies().includes(born)) F.enemies().push(born);
      stack.push(born);
    }
    let hits = 0;
    for (let i = 0; i < shots; i++) {
      for (const e of stack) e.hp = 1e9;
      F.player.weapon = 2;
      F.player.ammo = 500; F.player.clip = F.curWeapon().clip;
      F.player.fireCd = 0; F.player.reloadT = 0;
      F.fire();
      if (stack.some(e => e.hp < 1e9)) hits++;
    }
    // leave only the original standing for anything downstream
    for (const e of stack.slice(1)) e.alive = false;
    return hits;
  };
  const one   = stackHits(1, 300);
  const three = stackHits(3, 300);
  ok(three < one * 1.35,
     `stacking three targets does not raise the SMG's hit rate ` +
     `(${one}/300 on one, ${three}/300 on three — a per-candidate roll would be ~${
        Math.round(300 * (1 - Math.pow(1 - one / 300, 3)))})`);

  // ── `reach` is a RADIUS, not a forward depth. A guard 1.55u ahead and 0.5u
  //    to the side is 1.63u away: outside the knife's 1.6u reach, but inside
  //    it on the forward axis alone, and still well within the sprite column
  //    the hit test uses. Exact arithmetic, no randomness — this is the only
  //    geometry that tells the two models apart.
  F.player.x = 1.5; F.player.y = 2.5; F.player.a = 0;
  foe.x = F.player.x + 1.55; foe.y = F.player.y + 0.5;
  foe.hp = 1e9;
  const away = Math.hypot(foe.x - F.player.x, foe.y - F.player.y);
  ok(away > 1.6 && 1.55 < 1.6 && 0.5 < F.spr().guard.wW / 2,
     `test setup: ${away.toFixed(3)}u away but only 1.55u ahead, and inside the sprite`);
  F.player.weapon = 0;                       // knife
  F.player.fireCd = 0; F.player.windT = 0;
  F.fire();
  ok(foe.hp === 1e9, 'the knife measures reach as a radius, not a forward depth');
  foe.x = F.player.x + 1.0; foe.y = F.player.y + 0.3;
  F.player.fireCd = 0;
  F.fire();
  ok(foe.hp < 1e9, 'and does connect once the body is genuinely within reach');
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);
