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
// --bail stops at the first failure. Off by default so ordinary runs report
// everything; reference/mutate.js passes it always, because a mutant that dies
// in the first group should not go on to pay for the other three hundred
// assertions. A killed mutation is the common case and this is most of what
// makes the battery affordable.
const BAIL = process.argv.includes('--bail');
let pass = 0, fail = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; if (VERBOSE) console.log(`  ok    ${msg}`); }
  else {
    fail++; failures.push(msg); console.log(`  FAIL  ${msg}`);
    if (BAIL) { console.log(`\n${pass} passed, ${fail} failed (bailed)`); process.exit(1); }
  }
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

// ...and the other half of that rule: crossing a tile line re-seeds the field
// IMMEDIATELY rather than waiting the 0.35s out. A field that only ever follows
// its timer is stale by however far you have walked, which reads as a guard
// chasing where you were. One frame is the whole test: 0.016s into a 0.35s
// period, the timer clause cannot be what moved the seed.
P.startLevel();
{
  P.player.x = 20.5; P.player.y = 38.5;
  run(1);                                            // seeds, and arms a full period
  const home = P.navSeed();
  ok(home.x === 20 && home.y === 38,
     `the field is seeded on the player's own tile (${home.x},${home.y})`);

  const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(d => P.navPassable(20 + d[0], 38 + d[1]));
  ok(dir !== undefined, 'test setup: the spawn tile has a passable neighbour to step onto');
  P.player.x = 20.5 + dir[0]; P.player.y = 38.5 + dir[1];
  run(1);
  const moved = P.navSeed();
  ok(moved.x === 20 + dir[0] && moved.y === 38 + dir[1],
     `a tile crossing re-seeds within ONE frame, not after 0.35s ` +
     `(${moved.x},${moved.y} after stepping to ${20 + dir[0]},${38 + dir[1]})`);
  ok(P.navAt(moved.x, moved.y) === 0, 'and the new tile is the zero of the rebuilt field');
}

// corpses are scenery. Separation acts on the living only: a body that creeps
// away from where it fell drifts out from under its own blood, and the splat
// stays where the kill happened.
P.startLevel();
freezeEnemies();
{
  const es = P.enemies();
  // The guard under test is the OUTER loop's `a`, so the crowd has to sit at
  // HIGHER indices than the corpse — that is the pairing the missing
  // `if (!a.alive) continue` would shove.
  const corpse = es.find(e => e.alive && e.type !== 'ceo');
  const at = es.indexOf(corpse);
  const crowd = es.filter((e, j) => j > at && e.alive && e.type !== 'ceo').slice(0, 3);
  ok(crowd.length === 3, `test setup: three live bodies follow the corpse in the roster`);

  corpse.x = 20.5; corpse.y = 36.5;
  corpse.hp = 0; corpse.alive = false; corpse.state = 'dead';
  const fell = { x: corpse.x, y: corpse.y };
  for (const e of crowd) { e.x = 20.5; e.y = 36.5; }

  for (let n = 0; n < 24; n++) P.separate();
  ok(corpse.x === fell.x && corpse.y === fell.y,
     `a corpse crowded by three live bodies has not moved off its own blood ` +
     `(${corpse.x.toFixed(3)},${corpse.y.toFixed(3)})`);
  // ...and this can fail for the right reason: the living really did come apart
  let closest = Infinity;
  for (let a = 0; a < crowd.length; a++)
    for (let b = a + 1; b < crowd.length; b++)
      closest = Math.min(closest, Math.hypot(crowd[a].x - crowd[b].x, crowd[a].y - crowd[b].y));
  ok(closest > 0.6,
     `while the live bodies stacked on top of it did (closest pair ${closest.toFixed(3)}u)`);
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

// ── and the reason that footprint rule matters, stated where it can go red.
//    fire() measures a body's hit span against SPR[e.type] rather than against
//    the view being drawn, on purpose: turning sideways must never make a guard
//    harder to shoot. That choice is only SAFE because every live view of every
//    type keeps the base width — so swapping the two expressions in fire() is
//    unobservable today, and this is what would stop being true first. Driven
//    through enemySprite on real poses rather than by indexing the table, so it
//    covers the firing frame and the rotation branch alike.
{
  const SPRT = P.spr();
  const pose = { x: 0, y: 0, alive: true, state: 'idle', heading: 0, stateT: 0 };
  const off = [];
  let poses = 0;
  for (const type of ['guard', 'drone', 'ceo']) {
    pose.type = type;
    for (let k = 0; k < 24; k++) {
      pose.x = P.player.x + Math.cos(k / 24 * Math.PI * 2) * 3;
      pose.y = P.player.y + Math.sin(k / 24 * Math.PI * 2) * 3;
      for (let h = 0; h < 24; h++) {
        pose.heading = h / 24 * Math.PI * 2;
        for (const st of ['idle', 'chase', 'attack', 'hurt']) {
          pose.state = st;
          poses++;
          const w = P.enemySprite(pose).wW;
          if (w !== SPRT[type].wW) off.push(`${type}/${st} ${w} != ${SPRT[type].wW}`);
        }
      }
    }
  }
  ok(off.length === 0,
     `every LIVE view of every type keeps the base sprite's width, which is what ` +
     `lets fire() measure against SPR[e.type] (${off[0] || poses + ' poses'})`);
  // ...and this is not vacuous: the frames that DO differ are the ones fire()
  // cannot reach, because it skips !e.alive before it ever measures a span.
  ok(SPRT.guardDie.wW !== SPRT.guard.wW && SPRT.guardDead.wW !== SPRT.guard.wW,
     `while the death frames are deliberately wider (${SPRT.guardDie.wW} and ` +
     `${SPRT.guardDead.wW} against ${SPRT.guard.wW}) — a body is out of reach of fire()`);
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

// The two quantised fades — the arc's and the damage pop's — are measured in
// their own group at the end of the file. They need a load per arm, and a load
// replaces process globals, so they cannot run from here.

// ── music ────────────────────────────────────────────────────────────────────
// The harness has no AudioContext, so initAudio fails its try/catch and every
// note is a no-op — the same condition sfx() has always run under here. What
// IS testable without a speaker is the part that would actually break: the
// table's shape, and which track the game reaches for.
group('music');
P.startLevel();
{
  const M = P.music();
  ok(M.length >= 2, `the track table has ${M.length} rows`);
  const bad = M.filter(t => !(t.bpm > 0) || !t.name || !t.root ||
                            !t.bass || !t.bass.length ||
                            !t.lead || !t.lead.length ||
                            !t.drum || !t.drum.length);
  ok(bad.length === 0,
     `every track has a tempo, a root and three non-empty voices ` +
     `(${bad.map(t => t.name || '?').join(', ') || 'all good'})`);
  // A [semitone, beats] pair with zero or negative beats would spin the
  // scheduler's while loop against its guard forever instead of advancing.
  const badStep = [];
  for (const t of M)
    for (const voice of ['bass', 'lead'])
      for (const st of t[voice])
        if (!(Array.isArray(st) && st.length === 2 && st[1] > 0)) badStep.push(t.name + '.' + voice);
  ok(badStep.length === 0,
     `every note carries a positive duration (${[...new Set(badStep)].join(', ') || 'all good'})`);
  ok(M.every(t => /^[xs.]+$/.test(t.drum)),
     'and every drum pattern is made of x / s / . only');

  // ── one march per floor, and the boardroom takes the CEO. The floor lookup
  //    has to survive more floors than tracks, so it is a modulo over the
  //    non-boss rows rather than an index that can fall off the end.
  ok(M.length - 1 >= P.levels().length,
     `there is a floor track for each of the ${P.levels().length} floors`);
  const perFloor = [];
  for (let i = 0; i < P.levels().length; i++) {
    P.startLevel(i);
    perFloor.push(P.musicTrackFor());
  }
  ok(new Set(perFloor).size === perFloor.length,
     `each floor gets its own march (${perFloor.map(t => t.name).join(' / ')})`);
  ok(perFloor.every(t => t !== M[M.length - 1]),
     'and none of them is the boardroom track');

  // the CEO's own floor, before and after it notices you
  P.startLevel(P.levels().length - 1);
  const ceo = P.boss();
  ok(ceo && ceo.alive, 'test setup: the last floor has a live CEO');
  ceo.state = 'idle';
  ok(P.musicTrackFor() !== M[M.length - 1],
     'a CEO that has not noticed you does not change the music — no spoiling the reveal');
  ceo.state = 'chase';
  ok(P.musicTrackFor() === M[M.length - 1],
     `once it wakes, the boardroom march takes over (${P.musicTrackFor().name})`);
  ceo.alive = false;
  ok(P.musicTrackFor() !== M[M.length - 1], 'and drops away when it dies');

  // ── the scheduler is inert without an AudioContext, which is exactly the
  //    "everything degrades" constraint: a browser that refuses audio gets a
  //    silent game, not a broken one. If this throws, so does every frame.
  P.startLevel(0);
  let threw = null;
  try { for (let i = 0; i < 5; i++) P.stepMusic(); run(30); } catch (e) { threw = e; }
  ok(threw === null, `stepMusic is a no-op with no AudioContext (${threw && threw.message})`);
}
P.startLevel(0);

// ── death frames and blood decals ────────────────────────────────────────────
group('gore');
P.startLevel();
{
  const SPRT = P.spr();
  const SEQ = P.deathSeq();
  const DT = P.deathTime();

  // ── the table has to cover every type mkEnemy can build. A missing row is a
  //    crash in the renderer at 60fps rather than a fallback, which is the
  //    trade rule 1 asks for: new content is a row, and a missing row should
  //    fail loudly here instead of being papered over with a runtime guard.
  const types = [...new Set(P.enemies().map(e => e.type))].concat('ceo');
  ok(types.every(t => Array.isArray(SEQ[t]) && SEQ[t].length >= 2),
     `every enemy type has a death sequence of 2+ frames ` +
     `(${types.map(t => t + ':' + (SEQ[t] || []).length).join(' ')})`);
  ok(['guard', 'drone', 'ceo'].every(t => SEQ[t][0] === SPRT[t + 'Die']),
     'and frame 0 of each is the Die frame that shipped before sequences existed');

  // ── a ragged sprite reads art[ay][ax] off the end of a short row and blits
  //    `undefined`. Every table in the game is hand-typed ASCII, so this is a
  //    typo away at all times and costs one loop to rule out.
  const ragged = [];
  for (const t of Object.keys(SEQ))
    SEQ[t].forEach((fr, i) => {
      if (!fr.rows.every(r => r.length === fr.rows[0].length)) ragged.push(t + '[' + i + ']');
    });
  P.decalSpr().forEach((fr, i) => {
    if (!fr.rows.every(r => r.length === fr.rows[0].length)) ragged.push('decal[' + i + ']');
  });
  ok(ragged.length === 0, `every death and decal frame is rectangular (${ragged.join(', ') || 'all'})`);

  // ── the frames actually advance, and land on the corpse. Driven through
  //    enemySprite on a real body rather than by indexing the table, so the
  //    arithmetic that picks the frame is what is under test.
  const foe = firstGuard();
  foe.alive = false; foe.state = 'dying';
  const seen = [];
  for (const frac of [0.0, 0.4, 0.75, 0.99]) {
    foe.stateT = DT * frac;
    const spr = P.enemySprite(foe);
    if (!seen.includes(spr)) seen.push(spr);
  }
  ok(seen.length === SEQ.guard.length,
     `a guard's death shows all ${SEQ.guard.length} frames across DEATH_TIME (saw ${seen.length})`);
  ok(seen[0] === SPRT.guardDie, 'starting on the original death frame');
  foe.stateT = DT * 1.5;                 // past the window, before the FSM flips it
  ok(P.enemySprite(foe) === SEQ.guard[SEQ.guard.length - 1],
     'and clamping to the last frame rather than running off the table');
  foe.state = 'dead';
  ok(P.enemySprite(foe) === SPRT.guardDead, 'then the corpse frame, as before');
  foe.alive = true; foe.state = 'chase'; foe.stateT = 0;

  // ── ...and the CLOCK driving those frames is DEATH_TIME, which the sequence
  //    test above cannot see: it sets stateT by hand, so a window four times
  //    as long shows the same four frames over the same fractions and passes
  //    unchanged. What a stretched window costs is a body left twitching in
  //    its animation state for nearly two seconds. dt is exactly 16ms here,
  //    so this lands to within one frame.
  {
    freezeEnemies();
    const dying = firstGuard();
    dying.hp = 0; dying.alive = false; dying.state = 'dying'; dying.stateT = 0;
    let frames = 0;
    while (dying.state === 'dying' && frames < 600) { run(1); frames++; }
    const took = frames * 0.016;
    ok(dying.state === 'dead', `the dying window ends (after ${frames} frames)`);
    ok(took > DT && took - DT <= 0.017,
       `and it ends ON DEATH_TIME, within a frame (${took.toFixed(3)}s against ${DT}s)`);
  }

  // ── decals. A drone is machinery and leaves none; that asymmetry is the
  //    cheapest thing to get wrong by making spillBlood unconditional.
  P.startLevel();
  const dec = () => P.decals().length;
  const n0 = dec();
  P.spillBlood({ type: 'guard', x: P.player.x + 2, y: P.player.y });
  ok(dec() > n0, `a guard leaves blood (${dec() - n0} splats)`);
  const n1 = dec();
  P.spillBlood({ type: 'drone', x: P.player.x + 2, y: P.player.y });
  ok(dec() === n1, 'a drone leaves none');

  // ── nothing ends up inside a wall. Jitter is +-0.35, so a body standing on
  //    a tile CENTRE can never leave its tile and the guard would look correct
  //    while doing nothing. It has to be tested from a body pressed up against
  //    a wall, which is where enemies actually die.
  const grid = P.grid();
  let edge = null;
  for (let y = 1; y < grid.length - 1 && !edge; y++)
    for (let x = 1; x < grid[y].length - 1 && !edge; x++)
      if (!grid[y][x] && grid[y][x + 1]) edge = { x: x + 0.95, y: y + 0.5 };
  ok(edge !== null, 'test setup: found an open tile hard against a wall');
  P.startLevel();
  for (let i = 0; i < 300; i++) P.spillBlood({ type: 'guard', x: edge.x, y: edge.y });
  const buried = P.decals().filter(d => P.cellAt(d.x | 0, d.y | 0));
  ok(buried.length === 0,
     `no splat lands inside a wall from a body pressed against one ` +
     `(${P.decals().length} kept, ${buried.length} buried)`);

  // ── and the list is bounded. Corpses persist by design, so their blood does
  //    too, and every splat is sorted and depth-tested every frame.
  ok(P.decals().length <= P.decalCap(),
     `the decal list is capped at ${P.decalCap()} (${P.decals().length} after 300 kills' worth)`);
  P.startLevel();
  ok(P.decals().length === 0, 'and a floor start wipes it');

  // ── a splat sorts BEHIND the corpse lying on it. Both sit at foot height on
  //    nearly the same tile, and drawSprite writes cells without depth-testing
  //    WITHIN a sprite, so at equal depth the draw order decides which one wins
  //    and the body flickers behind its own blood. The ordering is the whole
  //    behaviour and the blit is not, which is why spriteList() is a seam.
  freezeEnemies();
  {
    const body = firstGuard();
    P.player.a = 0;
    body.x = P.player.x + 3; body.y = P.player.y;
    body.hp = 0; body.alive = false; body.state = 'dead';
    P.decals().length = 0;
    P.spillBlood(body);
    ok(P.decals().length > 0, 'test setup: the corpse bled');
    // park the splat exactly under the body — the +-0.35 jitter is a different
    // test, and here it would be the thing being measured
    const splat = P.decals()[P.decals().length - 1];
    splat.x = body.x; splat.y = body.y;

    const L = P.spriteList();
    const se = L.find(x => x.kind === 'e' && x.ref === body);
    const sp = L.find(x => x.kind === 'p' && x.ref === splat);
    ok(se && sp, 'test setup: the corpse and its splat are both in the sprite list');
    ok(sp.d > se.d,
       `a splat sorts deeper than the corpse it lies under ` +
       `(${sp.d.toFixed(4)} against ${se.d.toFixed(4)})`);
    ok(L.indexOf(sp) < L.indexOf(se),
       'so the back-to-front pass draws it first, which is behind');
  }
  P.startLevel();

  // ── atlas cost, as an A/B over the SAME number of frames — the neon flicker
  //    and the rain mint entries as the clock advances, and a naive
  //    before/after would bill those to the decals. Same shape as the arc and
  //    damage-pop measurements above, same reason.
  run(600);
  const gSettled = P.atlasSize();
  run(400);
  const gQuiet = P.atlasSize() - gSettled;
  const beforeGore = P.atlasSize();
  P.player.a = 0;
  for (let i = 0; i < 80; i++) {
    P.spillBlood({ type: 'guard', x: P.player.x + 1.5 + (i % 5) * 0.3, y: P.player.y + (i % 3) * 0.2 });
    run(5);
  }
  const goreCost = P.atlasSize() - beforeGore;
  // Every decal colour comes from fade(COLOR.blood, depth), so the whole family
  // is 8 fog steps x the handful of block glyphs the three splats use — bounded
  // however many bodies fall.
  ok(goreCost - gQuiet < 60,
     `80 splats cost a bounded set of (glyph, colour) pairs ` +
     `(${goreCost} entries over 400 frames vs ${gQuiet} for the same frames idle)`);
  // The `atlasSize() < 500` bound belongs at BOOT, where the boot group already
  // asserts it. By this point the suite has deliberately driven arcs, damage
  // pops and eight hundred shots through the palette, so the running total is
  // legitimately larger and re-asserting 500 here would only measure how many
  // groups happen to run first. What matters is the distance to the cap, past
  // which drawChar silently degrades to fillText.
  ok(P.atlasSize() < P.atlasCap() / 8,
     `and the atlas is nowhere near the cap it degrades at ` +
     `(${P.atlasSize()} of ${P.atlasCap()})`);
  P.startLevel();
}

// ── pause ────────────────────────────────────────────────────────────────────
// gameState already gated movement, firing, enemies, items, nav and mouse-look
// before pause existed, so those cost nothing and prove nothing. What needs
// asserting is the OTHER half: the steppers that never checked gameState at
// all, which frame() now skips as a block. A pause that freezes the player but
// leaves the doors sliding and the hp chip draining is the failure this group
// exists to catch, and it is the only failure available — everything else was
// already gated.
//
// `e.bob` is the sharpest probe of the two halves: it advances at the TOP of
// stepEnemies, before the `gameState !== 'playing'` guard, so it keeps ticking
// on a dead or cleared screen. If it freezes under pause, frame() really did
// skip the call rather than lean on a guard that was already there.
group('pause');
P.startLevel();
freezeEnemies();
{
  const foe = firstGuard();
  const door = P.doors().find(x => !x.lock);
  door.phase = 'opening';

  // face somewhere actually walkable, so "the player moves again" after the
  // resume can fail for the right reason rather than for want of floor
  const openA = [0, Math.PI / 2, Math.PI, -Math.PI / 2].find(
    a => !P.blockAt(P.player.x + Math.cos(a) * 1.0, P.player.y + Math.sin(a) * 1.0));
  ok(openA !== undefined, 'test setup: the spawn has an open direction to walk in');
  P.player.a = openA;
  P.player.hp = 40;                       // hpShown still 100 -> the chip has something to drain

  const before = {
    x: P.player.x, y: P.player.y, t: P.levelTime(),
    open: door.open, bob: foe.bob, hp: g.el('hpChip').style.width,
    anim: P.animT(),
  };

  ok(P.togglePause() === true, 'togglePause() pauses a floor in play');
  ok(P.state() === 'paused', 'and gameState says so');
  g.run(60, ['w']);                       // a full second, walking into the pause

  ok(P.player.x === before.x && P.player.y === before.y,
     'a paused player does not move');
  ok(P.levelTime() === before.t,
     `the clock does not run (${P.levelTime().toFixed(3)}s)`);
  ok(door.open === before.open,
     `an opening door does not keep opening (${door.open.toFixed(3)})`);
  ok(foe.bob === before.bob,
     'and stepEnemies is skipped outright, not merely gated — e.bob is frozen');
  ok(g.el('hpChip').style.width === before.hp,
     'the health chip stops draining too');
  // animT is the presentation clock: the neon flicker and the window rain are
  // both driven off it, and a paused screen that keeps shimmering is a screen
  // that never stopped. Nothing else in the game reads it, so nothing else
  // would have noticed.
  ok(P.animT() === before.anim,
     `the animation clock holds too (${P.animT().toFixed(3)}s)`);
  ok(g.el('bTitle').textContent === 'PAUSED', 'the pause banner is up');

  // ── resume, and everything picks up where it left off
  ok(P.togglePause() === true, 'togglePause() resumes a paused floor');
  ok(P.state() === 'playing', 'gameState is back to playing');
  g.run(60, ['w']);
  ok(P.player.x !== before.x || P.player.y !== before.y,
     'and the player walks again');
  ok(P.levelTime() > before.t, 'the clock runs again');
  ok(door.open > before.open, `the door resumes opening (${door.open.toFixed(3)})`);
  ok(foe.bob > before.bob, 'and the enemy loop is stepping again');
  ok(P.animT() > before.anim, 'and the neon starts flickering again');

  // ── pausing releases the mouse, which is most of the point of pausing. The
  //    stub is a no-op, so the only way to see the call is to count it.
  {
    const real = g.doc.exitPointerLock;
    let unlocks = 0;
    g.doc.exitPointerLock = () => { unlocks++; };
    try {
      ok(P.pauseGame() === true, 'test setup: the floor pauses');
      ok(unlocks === 1, `pausing releases the pointer lock exactly once (${unlocks})`);
      unlocks = 0;
      ok(P.resumeGame() === true, 'test setup: and resumes');
      ok(unlocks === 0, 'resuming does not touch the lock — the player re-grabs it by clicking');
    } finally { g.doc.exitPointerLock = real; }
  }

  // ── E resumes as well, which is the path that matters when a browser has
  //    swallowed the Esc keydown to exit pointer lock and Esc never arrives.
  P.pauseGame();
  ok(P.state() === 'paused', 'pauseGame() pauses directly');
  P.use();
  ok(P.state() === 'playing', 'use() — the E key — resumes');

  // ── only a floor in play can be paused. Pausing a dead or cleared one would
  //    bury the banner that state is already showing, and the resume would hand
  //    control back to a game that has none.
  P.player.hp = 100;
  P.clearLevel();
  ok(P.state() === 'cleared', 'test setup: the floor is cleared');
  ok(P.pauseGame() === false && P.state() === 'cleared',
     'a cleared floor refuses to pause');
  P.startLevel();
  P.hurtPlayer(999, P.player.x, P.player.y + 1);
  ok(P.state() === 'dead', 'test setup: the player is dead');
  ok(P.pauseGame() === false && P.state() === 'dead',
     'and so does a dead one');
  ok(P.resumeGame() === false && P.state() === 'dead',
     'resumeGame() only ever acts on a paused floor');
  P.startLevel();
}

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
//
//    Two things this test has to avoid, both of which it once did NOT:
//
//    1. Never re-arm the FSM by hand. An earlier version forced the guard back
//       into 'attack' the moment it left, which skips e.atkCd altogether — the
//       one quantity under test. Let 'chase' re-enter 'attack' on its own gate.
//    2. Never let the player die. stepEnemies stops stepping live enemies the
//       instant gameState leaves 'playing', so e.state freezes wherever it was
//       and any counter keyed on it runs free for the rest of the window. The
//       earlier version counted exactly that: 195 vs 236 "attacks" were
//       (4000-864)/16 and (4000-208)/16 frames after death, which measures
//       D.dmg and D.acc. Deleting the cd multiplier left it green.
{
  const attacksIn = (d, ms) => {
    P.setDifficulty(d);
    P.startLevel();
    freezeEnemies();
    const e = firstGuard();
    place(e, 3);
    e.state = 'attack'; e.stateT = 0; e.shotsLeft = 1;
    let volleys = 0, was = e.state;
    for (let t = 0; t < ms; t += 16) {
      P.player.hp = 100;          // see (2) above — a corpse counts nothing
      run(1);
      if (was !== 'attack' && e.state === 'attack') volleys++;
      was = e.state;
    }
    return volleys;
  };
  // 20s, because a guard's cooldown is 1.15s before the multiplier and the
  // 0.75-1.25 jitter needs a dozen samples a side to settle. Measured over six
  // runs the ratio sits between 1.64 and 1.90 against a table ratio of
  // 1.35/0.72 = 1.875; the fixed 0.22s attack window is what dilutes it.
  const N = 20000;
  const soft = attacksIn(0, N), hard = attacksIn(3, N);
  ok(soft > 4 && hard > 4,
     `both settings get enough volleys in to compare (${soft}, ${hard})`);
  ok(hard > soft * 1.35,
     `a shorter cooldown fits more attacks into the same window ` +
     `(${soft} on the easiest, ${hard} on the hardest, ratio ${(hard / soft).toFixed(2)})`);
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

  // ── and now the guard itself, which the assertion above does NOT reach.
  //    Math.round(mob * keep) is >= 1 for every mob >= 1 whenever keep >= 0.5,
  //    and the lowest keep in the shipped table is 0.65 — so no floor the table
  //    can produce ever thins to zero, and the Math.max(1, ...) never fires.
  //    It is a guard against a FUTURE lower keep, so the only honest way to
  //    exercise it is to be that future table for two lines. Without this,
  //    deleting the floor passes the whole suite.
  {
    const D = f.P.difficulties();
    const was = D[0].keep;
    D[0].keep = 0.1;                     // round(1 * 0.1) === 0
    f.P.startLevel();
    ok(f.P.enemies().length >= 1,
       `a keep that rounds to zero still leaves a floor its last body (${f.P.enemies().length})`);
    ok(f.P.totalEnemies() >= 1,
       'because an empty category reads as a 100% kill ratio and pays its 2500 bonus');
    D[0].keep = was;
    f.P.startLevel();
    ok(f.P.enemies().length === 1, 'and the table is restored');
  }
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

  // 600 rather than 200, with a margin, because the SMG and the chaingun are
  // only 7.0 and 9.0 columns of jitter against a 3.7-column target: their hit
  // rates sit around 0.52 and 0.40, and a bare `chain < smg` on 200 samples
  // reverses about ONE RUN IN 25. It did — the mutation battery caught it,
  // reporting a door mutation as killed by this line, which is a verdict no
  // door geometry could earn. Measured over 25 trials at 600: no reversals,
  // and the ratio stayed inside 0.68-0.85 against the 0.92 asserted here.
  //
  // A flaky suite makes the battery UNDER-report: a chance failure turns a
  // survivor into a false kill, never the other way round. This one only
  // surfaced because the mutation was marked unkillable and so was expected to
  // survive. Bare inequalities between two random draws do not belong here.
  const N = 600;
  const pistolHits = volley(1, N);
  const smgHits    = volley(2, N);
  const chainHits  = volley(3, N);
  ok(pistolHits === N, `the pistol never misses a centred target (${pistolHits}/${N})`);
  ok(smgHits < N * 0.8, `the SMG does, at ${range.toFixed(1)}u (${smgHits}/${N})`);
  ok(chainHits < smgHits * 0.92,
     `and the chaingun is the loosest of the three (${chainHits}/${N} vs ${smgHits}/${N}, ` +
     `ratio ${(chainHits / smgHits).toFixed(3)})`);

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

// ── thin-wall doors (fixture) ────────────────────────────────────────────────
// A door slab stands at the tile CENTRE, not on the boundary the DDA crosses,
// so castGrid replaces the march's own hit with an explicit mid-plane crossing.
// The shipped floors would exercise this, but a two-tile corridor makes the
// arithmetic exact: every distance below is a whole or half tile, checked to
// 1e-6 rather than to a tolerance that would survive the bug.
group('thin-wall doors (fixture)');
{
  // East-west corridor. The door at (4,1) is flanked north and south, so it is
  // walked through along x and its slab stands at x = 4.5.
  const f = loadWithLevel([
    '##########',
    '#@..D...g#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const d = F.doors()[0];

  ok(d.axis === 0, `a door flanked north and south faces along x (axis=${d.axis})`);

  // ── the mid-plane. This is the assertion that dies if the half-tile step is
  //    dropped: a full-tile door reports 2.5u from x=1.5, a thin one 3.0u.
  const head = F.castRay(1.5, 1.25, 0);
  ok(head.cell === d, 'a head-on ray reaches the door');
  ok(Math.abs(head.dist - 3.0) < 1e-6,
     `and stops at its mid-plane x=4.5, not its face x=4 ` +
     `(${head.dist.toFixed(4)}u from x=1.5, not 2.5)`);
  const back = F.castRay(8.5, 1.25, Math.PI);
  ok(Math.abs(back.dist - 4.0) < 1e-6,
     `the same slab is 4.0u from x=8.5 on the other side (${back.dist.toFixed(4)}u) — ` +
     `both sides agree on where the plane is`);

  // ── the recess is not drawn, it falls out of the geometry: a ray steep
  //    enough to leave the tile before x=4.5 hits the flanking wall INSIDE the
  //    door's own column, which is the jamb standing proud of the slab.
  const oblique = F.castRay(3.6, 1.5, -0.6);
  ok(oblique.cell !== d && oblique.mapX === 4 && oblique.mapY === 0,
     `a ray that slips past the slab hits the jamb above it, not the door ` +
     `(${oblique.cell && oblique.cell.tag}@${oblique.mapX},${oblique.mapY})`);
  // Both ways past the slab, and the southward one is the half that matters.
  // A ray leaving northward lands at lat < 0, which `lat < c.open` would skip
  // anyway; only a ray leaving SOUTHWARD lands at lat > 1, where nothing else
  // catches it. Deleting the range rejection survived a green suite until this
  // line existed, and the symptom was a door hit reported at a point that is
  // not on the door, handing the renderer a wallX above 1.
  const obliqueS = F.castRay(3.6, 1.5, 0.6);
  ok(obliqueS.cell !== d && obliqueS.mapX === 4 && obliqueS.mapY === 2,
     `and one slipping the other way hits the jamb below it ` +
     `(${obliqueS.cell && obliqueS.cell.tag}@${obliqueS.mapX},${obliqueS.mapY})`);
  // the invariant behind both: a door hit is always ON the slab
  let offSlab = 0, doorHits = 0;
  for (let i = 0; i < 400; i++) {
    const h = F.castRay(3.6, 1.5, -1.2 + i * (2.4 / 400));
    if (h.cell !== d) continue;
    doorHits++;
    if (!(h.wallX >= 0 && h.wallX < 1)) offSlab++;
  }
  ok(doorHits > 50 && offSlab === 0,
     `every door hit across a 138° sweep lands on the slab ` +
     `(${doorHits} hits, ${offSlab} with wallX outside [0,1))`);
  const jN = F.cellAt(4, 0), jS = F.cellAt(4, 2);
  ok(jN && jN.jamb && jS && jS.jamb,
     'and both cells the slab retracts into are flagged as reveal');

  // ── the slice. `wallX` runs along the door's own axis, so the same physical
  //    point on the slab reads the same from either side — measured through
  //    castRay rather than reasoned about, which is the standing rule here.
  d.open = 0.5; d.phase = 'open';
  const inSlice  = [F.castRay(1.5, 1.25, 0), F.castRay(8.5, 1.25, Math.PI)];
  const onSlab   = [F.castRay(1.5, 1.75, 0), F.castRay(8.5, 1.75, Math.PI)];
  ok(inSlice.every(h => h.cell !== d),
     'a half-open door lets both sides see through its retracted half');
  ok(onSlab.every(h => h.cell === d),
     'and stops both sides on the half that is still slab');
  ok(Math.abs(onSlab[0].wallX - onSlab[1].wallX) < 1e-6,
     `both sides report the same wallX on the same point of the slab ` +
     `(${onSlab[0].wallX.toFixed(4)} / ${onSlab[1].wallX.toFixed(4)})`);

  // ── collision stayed tile-granular on purpose: the thin slab is a rendering
  //    change, and blockAt's 0.65 walk-through threshold is untouched.
  d.open = 0; d.phase = 'closed';
  ok(F.blockAt(4.5, 1.5), 'a closed thin door still blocks the whole tile');
  d.open = 0.7;
  ok(!F.blockAt(4.5, 1.5), 'and still opens to bodies at 0.65, not at the slab');
  d.open = 1; d.phase = 'open';
  const thru = F.castRay(1.5, 1.5, 0);
  ok(thru.cell !== d && thru.mapX === 9,
     `a fully open door is see-through to the far wall (hit ${thru.mapX},${thru.mapY})`);
}

{
  // The other orientation, because axis 1 is a different pair of terms in
  // castGrid and a fixture with only east-west doors would never run it.
  //
  // The door has to be genuinely FLANKED east and west (`##D##`), not merely
  // sitting in a north-south corridor. The first draft of this fixture wrote
  // `#.D.#`, which is a free-standing door: axis fell through to its default
  // of 1, every assertion below passed, and none of them was testing the
  // derivation they claimed to. It is the same false pass as the push-wall
  // test that stood a secret against solid rock.
  const f = loadWithLevel([
    '#####',
    '#.@.#',
    '#...#',
    '##D##',
    '#...#',
    '#####',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const d = F.doors()[0];
  ok(d.axis === 1, `a door flanked east and west faces along y (axis=${d.axis})`);
  const down = F.castRay(2.25, 1.5, Math.PI / 2);
  ok(down.cell === d && Math.abs(down.dist - 2.0) < 1e-6,
     `its slab stands at y=3.5 (${down.dist.toFixed(4)}u from y=1.5, not 1.5)`);
  const up = F.castRay(2.25, 4.9, -Math.PI / 2);
  ok(up.cell === d && Math.abs(up.dist - 1.4) < 1e-6,
     `and reads the same plane from below (${up.dist.toFixed(4)}u from y=4.9)`);
  const jW = F.cellAt(1, 3), jE = F.cellAt(3, 3);
  ok(jW && jW.jamb && jE && jE.jamb, 'its reveal is the pair east and west of it');
}

// ── the music scheduler (audio fixture) ──────────────────────────────────────
// Everything above about music tested the TABLE and the track choice, because
// the harness has no AudioContext and the scheduler's loops therefore never
// execute. `load({ audio: true })` installs a recording stand-in so they do —
// otherwise the one piece of new code containing while-loops over an
// externally-driven clock would be the one piece nobody had ever run.
//
// Last, with the fixtures, because loading replaces process globals.
group('music scheduler (audio fixture)');
{
  const f = load({ audio: true, htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const A = f.audio;
  // drive audio time forward in 50ms slices, stepping the scheduler each time
  const play = (seconds) => {
    const n0 = A.scheduled.length;
    for (let i = 0; i < seconds / 0.05; i++) { A.tick(0.05); F.stepMusic(); }
    return A.scheduled.length - n0;
  };

  F.startLevel(0);
  const first = play(4);
  ok(first > 0, `the scheduler queues notes once the game is playing (${first} in 4s)`);
  ok(F.musicNow() !== null && F.musicNow().name === 'ATRIUM',
     `and it is floor 1's march (${F.musicNow() && F.musicNow().name})`);

  // ── the lookahead is a window, not a runaway. A scheduler that advanced its
  //    cursor without respect to the clock would empty its whole bar into the
  //    first call and then either stall or spin against its guard.
  const rate4 = play(4) / 4, rate12 = play(12) / 12;
  ok(Math.abs(rate4 - rate12) < rate4 * 0.5,
     `notes arrive at a steady rate rather than in a burst ` +
     `(${rate4.toFixed(1)}/s over 4s vs ${rate12.toFixed(1)}/s over 12s)`);
  const voices = F.musicVoices();
  ok(voices && voices.every(v => v.t <= A.currentTime + 1.0),
     'and no voice has run further ahead than its lookahead window');

  // ── a track change waits for the bar line. The boardroom march taking over
  //    mid-note is the failure this defers; the pending track is held until
  //    the bass voice — which is one bar — wraps.
  F.startLevel(F.levels().length - 1);
  play(2);
  const floorTrack = F.musicNow();
  const ceo = F.boss();
  ceo.state = 'chase';
  A.tick(0.05); F.stepMusic();
  ok(F.musicNow() === floorTrack,
     'waking the CEO does not cut the current bar off mid-note');
  play(8);
  ok(F.musicNow() === F.music()[F.music().length - 1],
     `and the boardroom march has taken over by the next bar (${F.musicNow().name})`);

  // ── muted keeps the clock but schedules nothing, so unmuting drops back
  //    into the bar rather than restarting it.
  F.setMuted(true);
  const tBefore = F.musicVoices()[0].t;
  const whileMuted = play(4);
  ok(whileMuted === 0, `muted schedules no notes (${whileMuted})`);
  ok(F.musicVoices()[0].t > tBefore,
     'but the beat clock keeps running underneath it');
  F.setMuted(false);
  ok(play(4) > 0, 'and unmuting brings the march back');

  // ── paused is silent, and drops the voices so a resume starts clean.
  F.pauseGame();
  const whilePaused = play(4);
  ok(whilePaused === 0, `a paused game schedules no music (${whilePaused})`);
  ok(F.musicNow() === null, 'and the scheduler lets go of its track');
  F.resumeGame();
  ok(play(4) > 0, 'resuming starts it again');

  // ── the tally screen keeps its march: cutting the audio the instant a floor
  //    is cleared sounds like a crash rather than a reward.
  F.player.hp = 100;
  F.clearLevel();
  ok(play(4) > 0, 'a cleared floor keeps playing');
}

// ── the raycaster's own contract ─────────────────────────────────────────────
//
// Everything downstream reads these three properties and none of them had an
// assertion: the suite tested what the raycaster is FOR (doors, sightlines,
// sprites) and never what it promises. Three mutations lived in that gap.
group('raycast contract');
{
  const r = load({ htmlPath: process.env.WOLF3D_HTML });
  const R = r.P;
  R.startLevel(0);

  // Swept rather than sampled: one ray proves nothing about a branch that
  // depends on which face was struck.
  const LIM = 6;
  let notFraction = 0, pastLimit = 0, hits = 0;
  for (let i = 0; i < 720; i++) {
    const a = i * Math.PI / 360;
    const h = R.castRay(R.player.x, R.player.y, a, 24);
    if (h.cell) { hits++; if (!(h.wallX >= 0 && h.wallX < 1)) notFraction++; }
    if (R.castRay(R.player.x, R.player.y, a, LIM).dist > LIM + 1e-9) pastLimit++;
  }
  ok(hits > 600, `test setup: the sweep actually hits things (${hits}/720)`);
  ok(notFraction === 0,
     `wallX is a position ALONG the face, so it is always in [0,1) (${notFraction}/${hits} were not)`);
  ok(pastLimit === 0,
     `and a ray never reports further than the limit it was handed (${pastLimit}/720 past ${LIM}u)`);

  // The projection divides by depth, and both consumers of spriteSpan lean on
  // it: drop the divide and every distant body flies off the side of the
  // screen while still being shootable dead ahead.
  const mid = R.spriteSpan(4, 0, 1.15).centerCol;
  const off4 = R.spriteSpan(4, 1, 1.15).centerCol - mid;
  const off8 = R.spriteSpan(8, 1, 1.15).centerCol - mid;
  ok(off4 > 1, `test setup: a body 1u to the side is off-centre at all (${off4.toFixed(2)} cols)`);
  ok(Math.abs(off4 - 2 * off8) < 1e-9,
     `a body twice as far is half as far off-centre (${off4.toFixed(2)} vs ${off8.toFixed(2)})`);

  // Bodies pass a door only once it is most of the way open. blockAt is
  // tile-granular, so this threshold is the entire difference between walking
  // through a door and walking through one that has barely twitched.
  const d = R.doors()[0];
  const wasOpen = d.open, wasPhase = d.phase;
  d.phase = 'opening'; d.open = 0.3;
  ok(R.blockAt(d.gx + 0.5, d.gy + 0.5), 'a barely-open door still blocks a body');
  d.open = 0.9;
  ok(!R.blockAt(d.gx + 0.5, d.gy + 0.5), 'and a mostly-open one lets it through');
  d.open = wasOpen; d.phase = wasPhase;
}

// ── the shot, exactly (fixture) ──────────────────────────────────────────────
//
// A corridor with a wall two thirds along, so the same two bodies can be put
// in a line, behind cover, or in the player's face without reloading anything.
group('the shot, exactly (fixture)');
{
  const f = loadWithLevel([
    '################',
    '#@.gg......#...#',
    '################',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const foes = F.enemies().filter(e => e.type === 'guard');
  ok(foes.length === 2, `test setup: two guards in the corridor (${foes.length})`);
  for (const e of foes) { e.state = 'hurt'; e.stateT = 1e9; }
  const shoot = () => { F.player.fireCd = 0; F.player.reloadT = 0;
                        F.player.ammo = 500; F.player.clip = F.curWeapon().clip;
                        F.player.windT = F.curWeapon().spinUp; F.fire(); };

  F.player.x = 1.5; F.player.y = 1.5; F.player.a = 0;   // face east
  F.player.weapon = 1;                                   // pistol

  // ── the NEAREST body takes it. Both are dead ahead and both are hittable;
  //    only the depth test decides, and picking the last candidate instead
  //    would let you shoot past the guard standing in front of you.
  foes[0].x = 4.5; foes[1].x = 8.5;
  for (const e of foes) { e.y = 1.5; e.hp = 1e9; }
  shoot();
  ok(foes[0].hp < 1e9, 'the near body takes the shot');
  ok(foes[1].hp === 1e9, 'and the one behind it does not');

  // ── cover works. The far guard sits past the wall at x=11 with no sightline.
  foes[0].alive = false;
  foes[1].x = 13.5; foes[1].y = 1.5; foes[1].hp = 1e9;
  ok(!F.hasLOS(F.player.x, F.player.y, foes[1].x, foes[1].y),
     'test setup: the wall breaks the sightline');
  ok(Math.hypot(foes[1].x - F.player.x, foes[1].y - F.player.y) < 24,
     'test setup: but it is still inside the ray cutoff');
  shoot();
  ok(foes[1].hp === 1e9, 'a body behind solid wall cannot be shot');

  // ── the dead zone in front of the muzzle. A pistol has minDepth 0.35; the
  //    knife is the weapon that reaches a body in your face, which is its
  //    entire advantage.
  foes[1].x = F.player.x + 0.2; foes[1].hp = 1e9;
  shoot();
  ok(foes[1].hp === 1e9, 'a gun cannot hit a body inside its dead zone');
  foes[1].x = F.player.x + 1.0; foes[1].hp = 1e9;
  shoot();
  ok(foes[1].hp < 1e9, 'and does hit the same body a tile further out');

  // ── a shot spends a round. Without this the magazine never empties and the
  //    whole reload cycle is unreachable.
  F.player.fireCd = 0; F.player.reloadT = 0;
  F.player.ammo = 20; F.player.clip = 6;
  F.fire();
  ok(F.player.clip === 5, `firing seats one round fewer (${F.player.clip})`);
  ok(F.player.ammo === 19, `and spends one from the reserve (${F.player.ammo})`);
}

// ── the magazine contract ────────────────────────────────────────────────────
//
// player.ammo is the TOTAL and player.clip is what is seated, so the reserve is
// (ammo - clip). Every guard below protects a different way of minting rounds.
group('the magazine contract');
{
  const m = load({ htmlPath: process.env.WOLF3D_HTML });
  const M = m.P;
  M.startLevel(0);
  M.player.weapon = 1;                                   // pistol
  const cap = M.curWeapon().clip;

  M.player.reloadT = 0; M.player.ammo = 24; M.player.clip = cap;
  ok(M.startReload() === false, 'a full magazine does not start a reload');

  M.player.reloadT = 0; M.player.clip = 2;
  ok(M.startReload() === true, 'a partial one does');

  M.player.reloadT = 0; M.player.ammo = 2; M.player.clip = 2;
  ok(M.startReload() === false,
     'and there is nothing to reload when every round you own is already seated');

  // A reload seats what the reserve actually holds. Seating a full magazine
  // regardless would turn the last five rounds into five forever.
  M.player.reloadT = 0; M.player.ammo = 5; M.player.clip = 0;
  ok(M.startReload() === true, 'test setup: five in reserve, none seated');
  M.player.reloadT = 0.001;
  m.run(2);
  ok(M.player.reloadT === 0, 'test setup: the cycle completed');
  ok(M.player.clip === 5, `a reload seats only what the reserve holds (${M.player.clip}, cap ${cap})`);
  ok(M.player.ammo === 5, 'and does not mint any');

  // The chaingun's barrels spin back down when the trigger is released, or the
  // spin-up would be a one-time cost for the whole floor.
  M.player.weapon = 3;
  const spinUp = M.curWeapon().spinUp;
  ok(spinUp > 0, `test setup: the chaingun has a ${spinUp}s spin-up`);
  M.player.windT = spinUp;
  m.run(1);                                              // trigger not held
  ok(M.player.windT < spinUp, `releasing the trigger spins them down (${M.player.windT.toFixed(3)})`);
  m.run(30);
  ok(M.player.windT === 0, 'all the way to nothing');
}

// ── the tally pays once, and only for a clean sweep (fixture) ────────────────
//
// The existing perfect-tally group SKIPS the roll-up with use(), which is the
// path finishTally takes — so the roll-up's own loop, which calls settleRow
// every frame from the moment a row lands until the stage advances, was never
// run by anything. Without settleRow's `paid` latch a clean sweep pays its
// 2500 about nineteen times, and the suite stayed green.
//
// No S and no $ on this floor: ratio() reports an empty category as 100%, so
// killing the one guard is a clean sweep for the price of one kill.
group('the tally roll-up (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@.......#',
    '#..g.....#',
    '#.......X#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const foe = F.enemies()[0];
  F.player.x = foe.x; F.player.y = foe.y + 1.0; F.player.a = -Math.PI / 2;
  ok(F.hasLOS(F.player.x, F.player.y, foe.x, foe.y), 'test setup: the guard is in view');
  F.player.ammo = 90; F.player.clip = 8;
  for (let i = 0; i < 40 && foe.alive; i++) { F.fire(); f.run(20); F.player.hp = 100; }
  ok(!foe.alive, 'test setup: the floor is swept');

  const before = F.player.score;
  F.clearLevel();
  const t = F.tally();
  ok(t.rows.every(r => r.pct === 100),
     `test setup: all three categories read 100% (${t.rows.map(r => r.id + ' ' + r.pct).join('/')})`);

  // watch it, do not skip it
  let frames = 0;
  while (frames < 600 && !F.tally().done) { f.run(1); frames++; }
  ok(F.tally().done, `the roll-up finishes on its own (${frames} frames)`);
  ok(F.player.score === before + t.timeBonus + 3 * 2500,
     `and pays exactly once per category (${before} + ${t.timeBonus} + 7500 -> ${F.player.score})`);
}

// ── and a floor that is nearly perfect pays nothing for it ───────────────────
group('the tally pays only at 100%');
{
  const y = load({ htmlPath: process.env.WOLF3D_HTML });
  const Y = y.P;

  // One kill short, deliberately: the ratio has to land in the NINETIES. A
  // lower one (12 * 0.9 floors to 10, which is 83%) never reaches the branch
  // under test, and a payout threshold dropped to 90% would survive it — which
  // is exactly what the first version of this test did.
  Y.startLevel(0);
  Y.player.kills = Y.totalEnemies() - 1;
  Y.player.score = 0;
  Y.clearLevel();
  const t = Y.tally();
  ok(t.rows[0].pct >= 90 && t.rows[0].pct < 100,
     `test setup: a kill ratio in the nineties but short of clean (${t.rows[0].pct}%)`);
  Y.use();                                     // settle it
  ok(Y.player.score === t.timeBonus,
     `the entire payout is the time bonus — Wolf3D paid nothing for 99% ` +
     `(${Y.player.score} vs a ${t.timeBonus} time bonus)`);

  // Over par pays ZERO, never a negative. levelTime is driven directly here
  // because reaching par honestly means simulating three minutes of frames.
  Y.startLevel(0);
  Y.setLevelTime(99999);
  Y.clearLevel();
  ok(Y.tally().timeBonus === 0,
     `finishing far over par pays zero rather than subtracting (${Y.tally().timeBonus})`);
}

// ── the CEO re-tunes itself ──────────────────────────────────────────────────
//
// stepCeoPhase mutates e.spec in place, and every field it writes had been
// asserted only through its consequences — which meant three of them could be
// dropped entirely without the suite noticing.
group('the CEO re-tunes itself');
{
  const b = load({ htmlPath: process.env.WOLF3D_HTML });
  const B = b.P;
  B.startLevel(B.levels().length - 1);
  const ceo = B.boss();
  ok(!!ceo && ceo.type === 'ceo', 'test setup: the last floor places a CEO');
  const PH = B.ceoPhases();

  ok(ceo.spec.speed === PH[0].speed && ceo.spec.dmg === PH[0].dmg && ceo.want === PH[0].want,
     `it opens on ${PH[0].name}`);

  for (let i = 1; i < PH.length; i++) {
    ceo.hp = Math.floor(ceo.maxHp * PH[i].at) - 1;
    b.run(1);
    ok(ceo.phase === i,
       `dropping under ${Math.round(PH[i].at * 100)}% enters ${PH[i].name}`);
    ok(ceo.spec.speed === PH[i].speed, `taking its speed (${ceo.spec.speed})`);
    ok(ceo.spec.dmg === PH[i].dmg,     `its damage (${ceo.spec.dmg})`);
    ok(ceo.spec.cd === PH[i].cd,       `its cooldown (${ceo.spec.cd})`);
    ok(ceo.want === PH[i].want,        `and closing to its standoff (${ceo.want})`);
  }

  // It also claims more room than a guard does, or the drones it just summoned
  // stand inside its jacket.
  const drone = B.enemies().find(e => e.type === 'drone' && e.alive);
  ok(!!drone, 'test setup: the last phase summoned drones to crowd it with');
  drone.x = ceo.x; drone.y = ceo.y;
  for (let i = 0; i < 40; i++) B.separate();
  const gap = Math.hypot(drone.x - ceo.x, drone.y - ceo.y);
  ok(gap > 0.8,
     `the CEO holds more room than a pair of guards would (${gap.toFixed(2)}u, two guards claim 0.70)`);
}

// ── touch controls (the seam) ────────────────────────────────────────────────
//
// The overlay is pointer events on DOM elements, and the stub delivers neither,
// so what is tested here is the part that can be wrong in a way a player feels:
// the stick math, and the claim that folding an analog vector into
// updatePlayer left the KEYBOARD exactly where it was. That second one is why
// updatePlayer's normalise became a clamp, and "identical" is a claim, not an
// observation, until something measures it.
group('touch controls');
{
  const t = load({ htmlPath: process.env.WOLF3D_HTML });
  const T = t.P;

  // ── the pure stick math
  const zero = T.stickVector(0, 0);
  ok(zero.x === 0 && zero.y === 0, 'dead centre is dead');
  const dz = T.stickVector(6, 0);
  ok(dz.x === 0 && dz.y === 0, 'and so is anything inside the dead zone');
  // Just outside it the vector must start from ~0 rather than jump to a fifth
  // of full deflection, which is exactly what dropping the rescale would do.
  const edge = T.stickVector(10, 0);
  ok(edge.x > 0 && edge.x < 0.05,
     `leaving the dead zone starts from zero rather than jumping (${edge.x.toFixed(4)})`);
  const full = T.stickVector(400, 0);
  ok(Math.abs(full.x - 1) < 1e-9 && Math.abs(full.y) < 1e-9,
     'past the rim clamps to exactly full deflection');
  ok(full.run === true, 'and reads as running');
  ok(T.stickVector(20, 0).run === false, 'a gentle push does not');
  // screen-down is a POSITIVE delta and forward is up, so y is inverted
  ok(T.stickVector(0, -400).y > 0.99, 'up the screen is forward');
  ok(T.stickVector(0, 400).y < -0.99, 'and down the screen is backward');
  const diag = T.stickVector(400, 400);
  ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9,
     'a diagonal at the rim is still exactly one unit, not the square root of two');

  // ── the seam into updatePlayer. ONE frame at a time: the quantity under test
  //    is the speed the stick produces, and a single frame cannot reach a wall.
  const oneFrame = (held, touch) => {
    T.startLevel(0);
    for (const e of T.enemies()) { e.state = 'hurt'; e.stateT = 1e9; }
    T.setTouchMove(0, 0, false);
    if (touch) T.setTouchMove(touch[0], touch[1], !!touch[2]);
    const x0 = T.player.x, y0 = T.player.y;
    t.run(1, held);
    T.setTouchMove(0, 0, false);
    return Math.hypot(T.player.x - x0, T.player.y - y0);
  };
  const key = oneFrame(['w'], null);
  ok(key > 0.05, `test setup: W actually moves the player (${key.toFixed(4)}u in one frame)`);

  const stick = oneFrame(null, [0, 1]);
  ok(Math.abs(stick - key) < 1e-9,
     `a fully deflected stick moves exactly as far as W (${key.toFixed(4)} vs ${stick.toFixed(4)})`);
  const half = oneFrame(null, [0, 0.5]);
  ok(Math.abs(half - key * 0.5) < 1e-9,
     `and half deflection is half speed, which normalising could not give (${half.toFixed(4)})`);
  // The regression guard the whole clamp rests on: a keyboard diagonal has a
  // magnitude of the square root of two before scaling, and has to come out at
  // walking speed exactly as it did when this line normalised.
  const dg = oneFrame(['w', 'd'], null);
  ok(Math.abs(dg - key) < 1e-9,
     `a keyboard diagonal is still capped at walking speed (${dg.toFixed(4)})`);
  ok(oneFrame(['w', 'shift'], null) > key * 1.7, 'shift still runs');
  ok(oneFrame(null, [0, 1, true]) > key * 1.7, 'and so does the stick at the rim');
  ok(Math.abs(oneFrame(null, [1, 0]) - key) < 1e-9, 'a sideways stick strafes at walking speed');

  // ...and in the strafe DIRECTION, which distance alone cannot tell you:
  // forward and sideways cover exactly the same ground, so a test that only
  // measures how far the stick moves you passes with the two axes swapped.
  T.startLevel(0);
  for (const e of T.enemies()) { e.state = 'hurt'; e.stateT = 1e9; }
  T.player.a = -Math.PI / 2;                       // facing north
  const bx = T.player.x, by = T.player.y;
  T.setTouchMove(1, 0, false);                     // hard right on the stick
  t.run(1, null);
  T.setTouchMove(0, 0, false);
  const ddx = T.player.x - bx, ddy = T.player.y - by;
  ok(ddx > 0.04 && Math.abs(ddy) < 1e-9,
     `a right strafe while facing north goes east and only east ` +
     `(${ddx.toFixed(4)}, ${ddy.toFixed(4)})`);

  // ── look is banked between frames and applied once, by its sum
  T.startLevel(0);
  const a0 = T.player.a;
  T.addTouchLook(0.10);
  T.addTouchLook(0.20);
  t.run(1);
  ok(Math.abs(T.player.a - (a0 + 0.30)) < 1e-9,
     'two look deltas inside one frame turn once, by their sum');
  const a1 = T.player.a;
  t.run(1);
  ok(Math.abs(T.player.a - a1) < 1e-9, 'and the bank is consumed, not re-applied');

  // ── the stick goes through blockAt like every other mover
  {
    T.startLevel(0);
    for (const e of T.enemies()) { e.state = 'hurt'; e.stateT = 1e9; }
    const grid = T.grid();
    let spot = null;
    for (let y = 2; y < grid.length - 1 && !spot; y++)
      for (let x = 1; x < grid[y].length - 1; x++)
        if (!grid[y][x] && grid[y - 1][x] && !grid[y + 1][x]) { spot = [x + 0.5, y + 0.5]; break; }
    ok(!!spot, 'test setup: found a walkable tile with a wall directly north');
    T.player.x = spot[0]; T.player.y = spot[1]; T.player.a = -Math.PI / 2;
    T.setTouchMove(0, 1, true);
    t.run(80);
    T.setTouchMove(0, 0, false);
    ok(!T.blockAt(T.player.x, T.player.y),
       'a stick held into a wall does not push the player through it');
    ok(T.player.y > spot[1] - 1,
       `and it stops short of the wall (${(spot[1] - T.player.y).toFixed(2)}u travelled)`);
  }
}

// ── high scores (storage fixtures) ───────────────────────────────────────────
//
// LAST in the file, and each block asserts against the handle it just made:
// every load() replaces the process globals, so anything afterwards that still
// reaches for an older instance is reading a game that has stopped stepping.
//
// The store is stubbed four ways because wolf3d/scores.js guards four
// different failures — absent, hostile on access, refuses to write, holds
// garbage — and a guard nobody has driven is a guess.
group('high scores (storage fixtures)');
{
  const disk = {};                       // a backing map shared across loads
  const f = load({ htmlPath: process.env.WOLF3D_HTML, storage: disk });
  const S = f.P;

  ok(S.scores().length === 0, 'a fresh install has an empty table');
  ok(S.scoreSlots() === 5, `the table is ${S.scoreSlots()} slots`);

  // ── dying files the run
  S.startLevel(0);
  S.player.score = 12345;
  S.killPlayer();
  ok(S.state() === 'dead', 'test setup: the floor is over');
  ok(S.scores().length === 1, 'dying files the run');
  ok(S.scores()[0].score === 12345, `at the score it ended on (${S.scores()[0].score})`);
  ok(S.scores()[0].won === false, 'marked as a death rather than an escape');
  ok(S.scores()[0].floor === 1, `and the floor it ended on (${S.scores()[0].floor})`);
  ok(disk[S.scoresKey()] !== undefined, 'and it reached the store');

  // ── ordering, and the rank recordScore hands back
  ok(S.recordScore(99999, 3, 2, true) === 0, 'a better run takes the top slot');
  ok(S.scores()[0].score === 99999 && S.scores()[1].score === 12345,
     'and the table sorts descending');
  for (const n of [50000, 40000, 30000, 20000]) S.recordScore(n, 1, 2, false);
  ok(S.scores().length === 5, `the table caps at five (${S.scores().length})`);
  ok(S.scores()[4].score === 20000,
     `holding the five best (${S.scores().map(e => e.score).join(',')})`);
  ok(S.recordScore(5, 1, 2, false) === -1, 'a run below the cut is not filed');
  ok(S.scores().length === 5, 'and does not grow the table');
  // A tie takes the slot. Ranking it below would tell a player they had missed
  // a table they just equalled.
  ok(S.recordScore(20000, 2, 2, false) === 4, 'a run that ties the last slot takes it');
  ok(S.scores()[4].floor === 2, 'and it is the new run sitting there, not the old one');

  // ── persistence, which is the entire point of the feature
  const table = S.scores().map(e => e.score).join(',');
  const f2 = load({ htmlPath: process.env.WOLF3D_HTML, storage: disk });
  ok(f2.P.scores().map(e => e.score).join(',') === table,
     `the table survives a fresh load off the same store (${table})`);

  // ── garbage in the key degrades to an empty table rather than propagating
  const K = f2.P.scoresKey();
  const bad = {}; bad[K] = '{not json';
  ok(load({ htmlPath: process.env.WOLF3D_HTML, storage: bad }).P.scores().length === 0,
     'unparseable stored data reads as an empty table');
  const notArr = {}; notArr[K] = JSON.stringify({ nope: true });
  ok(load({ htmlPath: process.env.WOLF3D_HTML, storage: notArr }).P.scores().length === 0,
     'and so does a stored value that is not an array');
  const mixed = {};
  mixed[K] = JSON.stringify([{ score: 10 }, 'garbage', null, { score: 'x' }, { score: 20 }]);
  const f5 = load({ htmlPath: process.env.WOLF3D_HTML, storage: mixed });
  ok(f5.P.scores().length === 2 && f5.P.scores()[0].score === 20,
     `entries that are not scores are dropped and the rest survive (${f5.P.scores().length})`);

  // ── a store that reads but refuses to write: Safari's private mode, and a
  //    full quota. The game must boot, rank, and paint regardless.
  const f6 = load({ htmlPath: process.env.WOLF3D_HTML, storage: 'throws' });
  ok(f6.P.state() === 'playing', 'the game boots against a store that will not write');
  ok(f6.P.recordScore(777, 1, 2, false) === 0, 'and the session still ranks its runs');
  ok(f6.P.saveScores() === false, 'saveScores reports the failure instead of throwing');
  f6.P.paintScores();
  ok(f6.el('hsScore0').textContent === '000777',
     `and the splash still paints it (${f6.el('hsScore0').textContent})`);
  ok(f6.el('hs0').classList.contains('fresh'), 'marking the run that just ended');
  ok(f6.el('hsNone').classList.contains('hide'), 'and hiding the empty-table notice');

  // ── a store whose PROPERTY ACCESS throws. `typeof localStorage` is itself
  //    the throwing expression here, which is why that typeof sits inside the
  //    try in scoreStore() rather than in front of it.
  const f7 = load({ htmlPath: process.env.WOLF3D_HTML, storage: 'hostile' });
  ok(f7.P.state() === 'playing', 'the game boots where touching localStorage throws');
  ok(f7.P.loadScores().length === 0, 'and reads as an empty table');
  ok(f7.P.recordScore(42, 1, 2, false) === 0, 'while still ranking the session');
  ok(f7.P.saveScores() === false, 'and reports that nothing persisted');

  // ── no localStorage at all: the headless case, and any non-browser host
  const f8 = load({ htmlPath: process.env.WOLF3D_HTML, storage: null });
  ok(f8.P.state() === 'playing', 'and where there is no localStorage at all');
  ok(f8.P.saveScores() === false, 'saving is a no-op it reports honestly');
  ok(f8.P.loadScores().length === 0, 'and loading yields an empty table');

  // ── a run ends by dying or by getting out, and by NOTHING else. Restarting
  //    zeroes the score on startLevel's cold path, so filing there would enter
  //    a partial run and then file the real one again when it ended.
  const f9 = load({ htmlPath: process.env.WOLF3D_HTML, storage: {} });
  f9.P.startLevel(0);
  f9.P.player.score = 5000;
  f9.P.startLevel(0);
  ok(f9.P.scores().length === 0, 'restarting a floor does not file a run');
  ok(f9.P.player.score === 0,
     'because it resets the score, which is why filing there would be wrong');

  f9.P.player.score = 8888;
  f9.P.winGame();
  ok(f9.P.scores().length === 1, 'getting out does file one');
  ok(f9.P.scores()[0].won === true, 'marked as an escape');
  ok(f9.P.state() === 'won', 'and the floor is won');
}

// ── a slab in transit seals the route (fixture) ──────────────────────────────
// A push-wall mid-slide is out of `grid` entirely — pushSecret hands the tile
// back before the slab has gone anywhere — so `inSlab` is the ONLY thing that
// knows it is there. blockAt already asks; navPassable has to ask too, or the
// flow field routes a chaser straight through a moving wall for the ~1.1s it
// is in transit.
//
// A sealed one-row corridor, so the secret is the only link between the two
// halves and there is no way around for the field to find.
group('the flow field and a moving slab (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@..S...X#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const s = F.secrets()[0];
  ok(s && s.gx === 4 && s.gy === 1, `test setup: the secret is the corridor's only link (${s && s.gx},${s && s.gy})`);

  F.player.x = 3.5; F.player.y = 1.5; F.player.a = 0;
  f.run(2);
  F.buildNav();
  ok(F.navAt(7, 1) === -1, 'test setup: the far half is unreachable while the slab is seated');

  F.use();
  f.run(1);
  ok(s.phase === 'moving', `the secret is mid-slide (phase=${s.phase}, span=${s.span})`);

  // Sampled every frame of the whole transit rather than once: the slab covers
  // its ORIGIN tile early in the slide and its DESTINATION tile late, so a
  // single sample can only ever catch one of the two.
  let frames = 0, gridReleased = 0, sealed = 0, routed = 0;
  while (s.phase === 'moving' && frames < 200) {
    const cx = (s.gx + s.dx * s.push + 0.5) | 0;
    const cy = (s.gy + s.dy * s.push + 0.5) | 0;
    // the grid has ALREADY let go of the origin tile — this is what makes the
    // assertion below non-vacuous, because nothing but inSlab is holding it
    if (F.cellAt(4, 1) === 0) gridReleased++;
    if (!F.navPassable(cx, cy)) sealed++;
    F.buildNav();
    if (F.navAt(7, 1) === -1) routed++;
    f.run(1); frames++;
  }
  ok(frames > 30, `the slide lasts a real window (${frames} frames, ~${(frames * 0.016).toFixed(2)}s)`);
  ok(gridReleased === frames,
     `the grid released the slab's tile the moment it was pushed (${gridReleased}/${frames} frames)`);
  ok(sealed === frames,
     `and navPassable refuses the tile the slab covers on every one of them (${sealed}/${frames})`);
  ok(routed === frames,
     `so the corridor stays severed for the whole slide (${routed}/${frames} frames unreachable)`);

  // and once it lands, the ordinary grid path takes over again
  ok(s.phase === 'done', `the slab landed (phase=${s.phase} at ${s.gx},${s.gy})`);
  ok(!F.navPassable(s.gx, s.gy), 'a landed slab is impassable as an ordinary solid cell');
}

// ── a closed door is a wall on patrol (fixture) ──────────────────────────────
// Only a CHASER opens doors: openDoorAhead is on the chase path and nowhere
// else. Without the cell test in patrolOpen a floor of bored guards would pick
// door tiles as destinations and lean on every door on it. The player sits
// behind the closed door, which blocks line of sight, so the guard stays idle.
group('patrols and doors (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#g..D..@.#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const guard = F.enemies().find(e => e.type === 'guard');
  const door = F.doors()[0];
  ok(guard && door, 'test setup: a guard and a door');
  ok(door.lock === null && door.phase === 'closed' && door.open === 0,
     `test setup: the door is closed and unlocked (${door.phase})`);
  ok(!F.hasLOS(F.player.x, F.player.y, guard.x, guard.y),
     'test setup: the closed door hides the player, so the guard stays idle');

  // the predicate itself, from the tile beside the door, where the two answers
  // differ — one direction is open floor and the other is the door
  guard.x = 3.5; guard.y = 1.5;
  ok(F.patrolOpen(guard, [-1, 0]) === true, 'open floor is open to a patrol');
  ok(F.patrolOpen(guard, [1, 0]) === false, 'and a closed door is not — it is a wall');

  // ...and the behaviour that rests on it: a destination is never latched on
  // the door's tile, so the guard turns back instead of leaning on it
  guard.x = 1.5; guard.y = 1.5;
  let onDoor = 0, moved = 0;
  const from = { x: guard.x, y: guard.y };
  for (let i = 0; i < 600; i++) {
    f.run(1);
    if (Math.abs(guard.patrolTX - 4.5) < 1e-9 && Math.abs(guard.patrolTY - 1.5) < 1e-9) onDoor++;
    if (Math.hypot(guard.x - from.x, guard.y - from.y) > 0.25) moved = 1;
  }
  ok(guard.state === 'idle', `the guard never woke (state=${guard.state})`);
  ok(moved === 1, 'test setup: it did patrol, so this can fail for the right reason');
  ok(onDoor === 0, `it never aims at the door's tile over 10s (${onDoor} frames)`);
  ok(guard.x < 4, `and never gets past it (x=${guard.x.toFixed(2)})`);
  ok(door.phase === 'closed' && door.open === 0,
     `the door is untouched — only a chaser opens one (${door.phase})`);
}

// ── the board does not pace the halls (fixture) ──────────────────────────────
// Three sealed corridors: the player, the CEO, and a guard as the control. The
// CEO has to be measured against something that DOES patrol, or the assertion
// passes just as well on a floor where nothing moves at all.
group('the CEO does not patrol (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@.......#',
    '##########',
    '#..C.....#',
    '##########',
    '#..g.....#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const ceo = F.boss();
  const guard = F.enemies().find(e => e.type === 'guard');
  ok(ceo && ceo.type === 'ceo', 'test setup: the CEO is on the floor');
  ok(guard, 'test setup: and a guard, walled off from it, as the control');
  ok(!F.hasLOS(F.player.x, F.player.y, ceo.x, ceo.y),
     'test setup: the CEO has no sightline to the player');
  ok(Math.hypot(ceo.x - guard.x, ceo.y - guard.y) > 1.5,
     'test setup: the two are far enough apart that separation never touches them');

  const c0 = { x: ceo.x, y: ceo.y }, g0 = { x: guard.x, y: guard.y };
  f.run(500);                                        // 8s
  ok(ceo.state === 'idle', `the CEO stayed idle (state=${ceo.state})`);
  ok(ceo.x === c0.x && ceo.y === c0.y,
     `and has not moved a millimetre (${ceo.x.toFixed(3)},${ceo.y.toFixed(3)})`);
  ok(Math.hypot(guard.x - g0.x, guard.y - g0.y) > 0.25,
     `while the guard beneath it paced ${Math.hypot(guard.x - g0.x, guard.y - g0.y).toFixed(2)}u`);
}

// ── a corridor reads as a route, not a shuffle (fixture) ─────────────────────
// The 0.72 straight-line bias is the whole difference between a guard walking
// a beat and one milling about: without it a direction is re-rolled at every
// tile, and each re-roll that turns costs a 0.6-2.0s dwell on top.
//
// Two things this fixture has to get right. A plain one-wide corridor does NOT
// discriminate — with the bias gone, `fwd` still drops the way back, so the
// only remaining option is straight ahead and both variants walk the same line.
// It needs JUNCTIONS. And Math.random is pinned for the duration, so this is an
// exact assertion rather than a sampled one: a margin tuned against a random
// walk is the shape that already shipped one flaky assertion here.
//
//   row 3/5:  ##.#.#.###   stubs at x=2, 4, 6 — the junctions
//   row 4:    #g.......#   the beat; x=1 is a dead end, so the first pick is
//                          forced east and never depends on the pinned value
group('the patrol straight-line bias (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#@.......#',
    '##########',
    '##.#.#.###',
    '#g.......#',
    '##.#.#.###',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const gd = F.enemies().find(e => e.type === 'guard');
  ok(gd && gd.spawnX === 1.5 && gd.spawnY === 4.5,
     `test setup: the guard starts in the corridor's west dead end (${gd && gd.spawnX},${gd && gd.spawnY})`);
  ok(!F.hasLOS(F.player.x, F.player.y, gd.x, gd.y),
     'test setup: it is sealed away from the player, so it patrols rather than chases');
  // the dead end forces the opening move, and the junction is a real junction
  ok(F.patrolOpen(gd, [1, 0]) && !F.patrolOpen(gd, [-1, 0])
     && !F.patrolOpen(gd, [0, 1]) && !F.patrolOpen(gd, [0, -1]),
     'test setup: east is the only way out of the dead end');
  const at2 = { x: 2.5, y: 4.5, spawnX: gd.spawnX, spawnY: gd.spawnY };
  ok(F.patrolOpen(at2, [1, 0]) && F.patrolOpen(at2, [0, 1]) && F.patrolOpen(at2, [0, -1]),
     'test setup: and the second tile is a three-way junction to be tempted by');

  gd.patrolT = 0; gd.patrolDir = null;               // mkEnemy seeds patrolT randomly
  const realRandom = Math.random;
  Math.random = () => 0.5;                           // 0.5 < 0.72 holds; 0.5 < 0.0 does not
  let strayed = 0;
  try {
    for (let i = 0; i < 500; i++) { f.run(1); if (Math.abs(gd.y - 4.5) > 1e-9) strayed++; }
  } finally { Math.random = realRandom; }

  ok(gd.state === 'idle', `the guard patrolled the whole window (state=${gd.state})`);
  ok(strayed === 0,
     `a guard that CAN keep going straight does — it never left the corridor line ` +
     `in 500 frames (${strayed} frames off it, ${gd.y.toFixed(3)})`);
  ok(gd.x - gd.spawnX > 3.5,
     `and covers its beat rather than a third of it ` +
     `(${(gd.x - gd.spawnX).toFixed(3)}u east of spawn; a re-roll at every junction manages 1.0)`);
}

// ── a secret beside a door keeps its panelling (fixture) ─────────────────────
// The two cells a door retracts into are flagged `jamb` so drawWalls tints them
// steel and the recess reads as a frame. A push-wall is byte-for-byte an
// ordinary panel by design — same seed, same colour, same glyph ramp — so
// tinting one would announce it. The `!n.secret` clause is the only thing
// stopping that, and no shipped floor happens to stand a secret beside a door.
//
//   row 1:  a secret directly north of the door
//   row 3:  an ordinary panel directly south of it, as the control
group('secrets beside doors keep their panelling (fixture)');
{
  const f = loadWithLevel([
    '##########',
    '#...S....#',
    '#@..D...X#',
    '#...#....#',
    '##########',
  ], { htmlPath: process.env.WOLF3D_HTML });
  const F = f.P;
  const d = F.doors()[0];
  ok(d && d.gx === 4 && d.gy === 2, `test setup: the door is at 4,2 (${d && d.gx},${d && d.gy})`);
  ok(d.axis === 0,
     `test setup: it is flanked north and south, so those two ARE its jambs (axis=${d.axis})`);

  const north = F.cellAt(4, 1), south = F.cellAt(4, 3);
  ok(north && north.tag === 'panel' && north.secret === true,
     'test setup: the north neighbour is a push-wall');
  ok(south && south.tag === 'panel' && !south.secret,
     'test setup: and the south neighbour is an ordinary panel');

  ok(south.jamb === true,
     'the ordinary neighbour is flagged as the jamb, so the pass really ran');
  ok(north.jamb !== true,
     `and the secret is not — a secret that looks different is not a secret ` +
     `(jamb=${north.jamb})`);
}

// ── the two quantised fades, as a real A/B (fixtures) ───────────────────────
// Every distinct (glyph, colour) pair is an atlas entry, and a fade stringified
// per frame mints a fresh one each time — unbounded growth toward the silent
// fillText degradation. Both fades are quantised on purpose: the arc to 4
// steps, the damage pop to 8.
//
// The obvious test — measure the atlas before and after a burst — does not
// work, and the version that shipped from Phase 3 to Phase 6 could not fail.
// Two reasons, and the second is the one that bites:
//
//   1. Ordinary rendering mints entries of its own as the clock advances (the
//      neon flicker, the rain), so a naive before/after bills those to the
//      feature. That is what the idle arm is for.
//   2. An UNQUANTISED fade converges too. h.t and p.t advance in fixed 16ms
//      steps, so the alpha space is finite either way — ~150 entries for the
//      arc instead of ~6 — and by the time a late group measures it, earlier
//      groups have already minted every one of them. Marginal growth after
//      saturation is zero under both variants. The measurement has to start
//      from an atlas that has not seen the effect yet.
//
// So each arm is its own load: same build, same frame count, one idle and one
// driving the effect, compared at the end. Fixtures, because a load replaces
// process globals.
group('quantised fades (atlas fixtures)');
{
  const HTML = process.env.WOLF3D_HTML;
  const BURST = 120, PER = 5, FRAMES = BURST * PER;

  // Both arms run under a SEEDED stream, because Math.random is load-bearing
  // here in a way that is easy to miss: mkEnemy seeds every body's `bob` and
  // `patrolT` from it, so two loads put their enemies in different places and
  // draw different sprite-and-fog pairs. Measured unseeded, the arc cost swung
  // between -1 and 13 over fifteen trials — noise of the same order as the
  // honest figure. A constant is the wrong pin here: it would collapse the
  // damage-number jitter to one position and take most of the bug with it
  // (33 against 65, where a seeded stream reads 177 against 337). Seeded, both
  // arms are exact and repeat to the entry.
  const lcg = () => { let s = 987654321; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x80000000; };
  const seeded = (fn) => {
    const real = Math.random;
    Math.random = lcg();
    try { return fn(); } finally { Math.random = real; }
  };

  const idleArm = () => seeded(() => {
    const a = load({ htmlPath: HTML });
    a.P.startLevel(); a.run(FRAMES);
    return a.P.atlasSize();
  });

  // ── the damage arc: a 4-step fade over two glyphs
  {
    const quiet = idleArm();
    const cost = seeded(() => {
      const b = load({ htmlPath: HTML });
      const B = b.P;
      B.startLevel();
      for (let i = 0; i < BURST; i++) {
        B.player.hp = 100;                   // topped up, so no sample can kill
        B.hurtPlayer(1, B.player.x + Math.cos(i) * 3, B.player.y + Math.sin(i) * 3);
        b.run(PER);
      }
      return B.atlasSize();
    }) - quiet;
    // Measured, and repeatable to the entry: 6 quantised, 150 unquantised, over
    // the same 600 frames from the same cold atlas. 24 is four times the honest
    // cost and a sixth of the bug.
    ok(cost < 24,
       `${BURST} arcs cost the handful of (glyph, colour) pairs a 4-step fade can make ` +
       `(${cost} entries over ${FRAMES} frames against an idle load's ${quiet})`);
  }

  // ── the damage-number pop: an 8-step fade, multiplied by the digit glyphs,
  //    the jitter positions, the hit/kill colour and the shadow row
  {
    const quiet = idleArm();
    const cost = seeded(() => {
      const b = load({ htmlPath: HTML });
      const B = b.P;
      B.startLevel();
      const foe = B.enemies().find(e => e.type === 'guard');
      for (let i = 0; i < BURST; i++) {
        foe.hp = 1e9;                        // never dies, so every shot pops
        foe.x = B.player.x + 2; foe.y = B.player.y; B.player.a = 0;
        B.player.fireCd = 0; B.player.ammo = 500; B.player.clip = 8;
        B.fire(); b.run(PER);
      }
      return B.atlasSize();
    }) - quiet;
    // Measured: 177 quantised against 337 unquantised, both exact and both flat
    // from 120 shots through 480. The honest cost is large because of what the
    // 8 steps multiply against — the digit glyphs, the jitter positions, the
    // hit/kill colour and the shadow row — which is exactly why the bound has
    // to be measured rather than guessed. 260 sits between the two.
    ok(cost < 260,
       `${BURST} damage pops cost a bounded set of pairs, not half again as many ` +
       `(${cost} entries over ${FRAMES} frames against an idle load's ${quiet})`);
  }
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);
