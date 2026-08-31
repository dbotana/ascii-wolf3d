'use strict';

// Everything that drives a body other than the player: the state machine, the
// flow-field steering, patrols, separation, loot drops, and the CEO fight.
//
// Every move goes through moveEnemy() — chase, patrol and separation alike — so
// collision is enforced in exactly one place.

// ─── ENEMY LOOT ─────────────────────────────────────────────
// Guards carry a spare cell more often than drones do; the drop lands on the
// corpse tile so it is always reachable.
function dropLoot(e) {
  const chance = e.type === 'guard' ? 0.55 : 0.30;
  if (Math.random() > chance) return;
  items.push(mkItem('ammo', e.x, e.y));
}

// Blood where a body fell. Splats are jittered off the corpse so a kill does
// not read as one stamp, but a jittered point can land in a wall and render
// half-buried — so each one is checked and folded back onto the corpse's own
// tile if it does. That is the same question `itemAt` exists to ask about
// push-walls: anything placed in the world has to ask what else owns the tile.
//
// Drones bleed nothing. They are drones.
const DECAL_CAP = 64;
function spillBlood(e) {
  if (e.type === 'drone') return;
  const n = e.type === 'ceo' ? 3 : (Math.random() < 0.4 ? 2 : 1);
  for (let i = 0; i < n; i++) {
    let x = e.x + (Math.random() - 0.5) * 0.7;
    let y = e.y + (Math.random() - 0.5) * 0.7;
    if (cellAt(x | 0, y | 0)) { x = e.x; y = e.y; }
    decals.push({ x, y, spr: DECAL_SPR[(Math.random() * DECAL_SPR.length) | 0] });
  }
  // corpses persist and so do their splats, so the list needs a ceiling: a
  // long floor is a few hundred kills and every one of them is drawn, sorted
  // and depth-tested every frame.
  while (decals.length > DECAL_CAP) decals.shift();
}

function alertNear(x, y, radius) {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.state !== 'idle') continue;
    if (Math.hypot(e.x - x, e.y - y) > radius) continue;
    e.state = 'alert';
    e.stateT = 0.35 + Math.random() * 0.2;
  }
}

/**
 * Take damage. `sx`/`sy` are where it came from, and are optional: a source
 * that has no position (a future hazard, a scripted hit) simply gets the flash
 * without an arc rather than a marker pointing at the origin of the map.
 */
function hurtPlayer(amount, sx, sy) {
  if (gameState !== 'playing') return;
  chipHpFromNow();                          // chip starts from the old value
  addHitDir(sx, sy);
  player.hp -= amount;
  player.hurtT = 0.28;
  pulseHpBar();
  sfx('ouch');
  if (player.hp <= 0) {
    player.hp = 0;
    killPlayer();
  }
  syncHud();
}

// ─── THE CEO ────────────────────────────────────────────────
// A three-phase fight rather than a guard with more hp. Each phase re-tunes
// the same spec fields the ordinary FSM already reads — speed, cooldown,
// damage, standoff — plus a burst length, so no new state machine is needed.
const CEO_PHASES = [
  // `at` is the health fraction at or below which the phase takes over
  { at: 1.00, name: 'BOARD MEETING',    speed: 1.10, cd: 1.40, dmg: 16, want: 5.2, burst: 1 },
  { at: 0.62, name: 'HOSTILE TAKEOVER', speed: 1.75, cd: 1.00, dmg: 14, want: 3.2, burst: 3 },
  { at: 0.28, name: 'GOLDEN PARACHUTE', speed: 2.20, cd: 0.62, dmg: 12, want: 2.3, burst: 4,
    summon: 2 },
];

// Drones the CEO calls in are real enemies, so they count toward the floor's
// kill ratio — the denominator grows with them and 100% stays achievable.
function summonDrones(e, n) {
  const spots = [];
  for (let r = 2; r <= 4 && spots.length < n; r++) {
    for (let k = 0; k < 12 && spots.length < n; k++) {
      const th = (k / 12) * Math.PI * 2;
      const x = e.x + Math.cos(th) * r, y = e.y + Math.sin(th) * r;
      if (blockAt(x, y)) continue;
      if (spots.some(p => Math.hypot(p[0] - x, p[1] - y) < 1.2)) continue;
      spots.push([x, y]);
    }
  }
  for (const [x, y] of spots) {
    const d = mkEnemy('drone', x, y);
    d.state = 'chase';
    enemies.push(d);
    totalEnemies++;
  }
  if (spots.length) { sfx('ping'); syncHud(); }
}

function stepCeoPhase(e) {
  const frac = e.hp / e.maxHp;
  let want = 0;
  for (let i = 0; i < CEO_PHASES.length; i++) if (frac <= CEO_PHASES[i].at) want = i;
  if (want === e.phase) return;
  e.phase = want;
  const ph = CEO_PHASES[want];
  e.spec.speed = ph.speed;
  e.spec.cd    = ph.cd;
  e.spec.dmg   = ph.dmg;
  e.want  = ph.want;
  e.burst = ph.burst;
  e.atkCd = Math.min(e.atkCd, 0.5);
  if (want > 0) {
    toast('CEO  ·  ' + ph.name);
    sfx('bark');
    alertNear(e.x, e.y, 12);
    if (ph.summon) summonDrones(e, ph.summon);
  }
}

// One enemy shot, shared by the whole roster: the CEO's bursts are this same
// call repeated, so accuracy falloff and damage scaling stay in one place.
function enemyShot(e, dist) {
  if (!hasLOS(e.x, e.y, player.x, player.y)) return;
  if (dist >= e.spec.range + 1) return;
  sfx('enemyShot');
  const D = DIFFICULTY[difficulty];
  // the floor is applied first so the easy settings scale the real accuracy
  // rather than a number that has already been propped up, then clamped
  // because a multiplier above 1 could otherwise promise more than certainty
  const p = Math.min(1, Math.max(0.16, 0.72 - dist * 0.045) * D.acc);
  if (Math.random() >= p) return;
  const falloff = Math.max(0.45, 1 - dist / 18);
  hurtPlayer(Math.round(e.spec.dmg * D.dmg * falloff * (0.7 + Math.random() * 0.6)), e.x, e.y);
}

// ─── ENEMY MOVEMENT ─────────────────────────────────────────
//
// Every system that moves a body goes through here: chasing, patrolling and
// separation. Two INDEPENDENT ifs, never `if/else if` followed by a bare
// `if` — that exact shape once shipped a guard with double sideways speed
// (see "Bugs already made here" in reference/CLAUDE.md).
const BODY_MARGIN = 0.26;

function moveEnemy(e, nx, ny) {
  let moved = false;
  if (nx && !blockAt(e.x + nx + Math.sign(nx) * BODY_MARGIN, e.y)) { e.x += nx; moved = true; }
  if (ny && !blockAt(e.x, e.y + ny + Math.sign(ny) * BODY_MARGIN)) { e.y += ny; moved = true; }
  if (moved) e.heading = Math.atan2(ny, nx);
  return moved;
}

/**
 * A chaser whose next waypoint is a shut door leans on it, the same two lines
 * `use()` runs. Only unlocked doors: `navPassable` already refuses to route
 * through a locked one, because enemies carry no keycards and a guard queuing
 * at a door it can never open is worse than one that never came.
 * `stepDoors` will not close on an occupied tile, so nobody is crushed here.
 */
function openDoorAhead(e, gx, gy) {
  const c = cellAt(gx, gy);
  if (!c || c.tag !== 'door' || c.lock !== null || c.phase !== 'closed') return;
  if (Math.hypot(gx + 0.5 - e.x, gy + 0.5 - e.y) > 1.2) return;
  c.phase = 'opening';
  sfx('door');
}

// How much room a body claims. The CEO is two and a half tiles across, so a
// single radius would let the drones it summons stand inside its jacket.
function bodyRadius(e) { return e.type === 'ceo' ? 0.55 : 0.35; }

/**
 * Push overlapping enemies apart. Before this, six seconds of a group chase
 * left the two closest guards 0.009u apart — one sprite doing the work of
 * several. O(n²) over live bodies only; at 12-30 enemies that is a few hundred
 * pairs a frame, and corpses are scenery that must stay where they fell.
 *
 * The shove is applied through `moveEnemy`, so separation can never push a
 * body through a wall or off the map — the one way this kind of fix usually
 * goes wrong.
 */
function separateEnemies() {
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (!a.alive) continue;
    const ra = bodyRadius(a);
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (!b.alive) continue;
      const R = ra + bodyRadius(b);
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx > R || dx < -R || dy > R || dy < -R) continue;   // cheap reject
      let d = Math.hypot(dx, dy);
      if (d >= R) continue;
      let nx, ny;
      if (d < 1e-4) {
        // exactly coincident — summoned drones can land like this. Pick a
        // deterministic axis from the pair's index so the two never argue.
        // The axis is already unit length, and `d` stays the real (zero)
        // distance so the shove below is the full R * 0.5 each way — feeding
        // a fake d = 1 in here would shove a sub-tile pair backwards.
        nx = ((i + j) & 1) ? 0 : 1; ny = ((i + j) & 1) ? 1 : 0; d = 0;
      } else {
        nx = dx / d; ny = dy / d;
      }
      const shove = (R - d) * 0.5;
      const ux = nx * shove, uy = ny * shove;
      // heading belongs to where a body is *going*, not to being jostled
      const ha = a.heading, hb = b.heading;
      moveEnemy(a, -ux, -uy);
      moveEnemy(b,  ux,  uy);
      a.heading = ha; b.heading = hb;
    }
  }
}

// ─── PATROLS ────────────────────────────────────────────────
//
// Idle enemies used to stand exactly where the level placed them until they
// saw you, so a floor read as a diorama. This is a corridor random-walk, not
// pathfinding: pick a cardinal, walk it tile to tile, prefer to keep going
// straight, dwell at junctions. `spawnX`/`spawnY` have been on every enemy
// since the MVP with nothing reading them; they are the leash anchor, and the
// leash is what stops a patrol wandering onto the player's spawn or unpicking
// a floor's pacing.
const PATROL_LEASH = 6.0;
const PATROL_SPEED = 0.4;      // fraction of the enemy's chase speed

function patrolOpen(e, dir) {
  const gx = (e.x | 0) + dir[0], gy = (e.y | 0) + dir[1];
  // a closed door is a wall on patrol: only a chaser opens doors, or a floor
  // of bored guards would cycle every door on it
  const c = cellAt(gx, gy);
  if (c) return false;
  if (movingSecrets.length && inSlab(gx + 0.5, gy + 0.5)) return false;
  return Math.hypot(gx + 0.5 - e.spawnX, gy + 0.5 - e.spawnY) <= PATROL_LEASH;
}

function pickPatrolDir(e) {
  const open = NAV_DIRS.filter(d => patrolOpen(e, d));
  if (!open.length) { e.patrolDir = null; return; }
  // keep going straight if we still can — corridors should read as routes
  if (e.patrolDir && open.some(d => d[0] === e.patrolDir[0] && d[1] === e.patrolDir[1])
      && Math.random() < 0.72) return;
  const back = e.patrolDir ? [-e.patrolDir[0], -e.patrolDir[1]] : null;
  const fwd = back ? open.filter(d => d[0] !== back[0] || d[1] !== back[1]) : open;
  const from = fwd.length ? fwd : open;          // reverse only out of a dead end
  e.patrolDir = from[(Math.random() * from.length) | 0];
}

// Latch the destination when the direction is chosen. Deriving it from the
// enemy's CURRENT tile every frame walks the target ahead of the body forever
// — cross into the next tile and the goal moves with you — so the arrival
// test never fires, a direction is never re-picked, and the leash is never
// consulted a second time. That shipped for one build and a guard walked a
// 30-tile corridor end to end; the leash fixture is what caught it.
function patrolAim(e) {
  e.patrolTX = (e.x | 0) + 0.5 + e.patrolDir[0];
  e.patrolTY = (e.y | 0) + 0.5 + e.patrolDir[1];
}

function stepPatrol(e, dt) {
  if (e.type === 'ceo') return;                  // the board does not pace the halls
  if (e.patrolT > 0) { e.patrolT -= dt; return; }
  if (!e.patrolDir) {
    pickPatrolDir(e);
    if (!e.patrolDir) { e.patrolT = 1.0; return; }
    patrolAim(e);
  }
  const vx = e.patrolTX - e.x, vy = e.patrolTY - e.y;
  const len = Math.hypot(vx, vy);
  const sp = e.spec.speed * PATROL_SPEED * dt;
  if (len > sp && moveEnemy(e, vx / len * sp, vy / len * sp)) return;
  if (len <= sp) { e.x = e.patrolTX; e.y = e.patrolTY; }   // arrived; else we walked into something
  const was = e.patrolDir;
  pickPatrolDir(e);
  if (!e.patrolDir) { e.patrolT = 1.0; return; }
  patrolAim(e);
  // Break stride only where the route actually turns. Dwelling at every tile
  // centre made a corridor patrol read as a shuffle rather than a walk, and
  // left a guard covering barely a third of its beat.
  if (e.patrolDir[0] !== was[0] || e.patrolDir[1] !== was[1]) {
    e.patrolT = 0.6 + Math.random() * 1.4;
  }
}

// ─── ENEMY FSM ──────────────────────────────────────────────
function stepEnemies(dt) {
  if (gameState === 'playing') stepNav(dt);
  for (const e of enemies) {
    e.bob += dt * 2.4;
    if (!e.alive) {
      if (e.state === 'dying') {
        e.stateT += dt;
        if (e.stateT > DEATH_TIME) e.state = 'dead';
      }
      continue;
    }
    if (gameState !== 'playing') continue;
    if (e.type === 'ceo') stepCeoPhase(e);

    const dx = player.x - e.x, dy = player.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (e.atkCd > 0) e.atkCd -= dt;

    switch (e.state) {
      case 'idle': {
        stepPatrol(e, dt);
        // The spawn grace is a beat of blindness, not a pause: a body keeps
        // patrolling while it lasts, it just is not looking for the player yet.
        // Without it, an enemy that spawns already facing you fires the moment
        // the floor starts, before you have found any cover.
        if (e.graceT > 0) { e.graceT -= dt; break; }
        e.stateT -= dt;
        if (e.stateT <= 0) {
          e.stateT = 0.25;
          if (dist < e.spec.sight && hasLOS(e.x, e.y, player.x, player.y)) {
            e.state = 'alert';
            e.stateT = 0.4;
            sfx(e.type === 'guard' ? 'bark' : 'ping');
            alertNear(e.x, e.y, 7);
          }
        }
        break;
      }
      case 'alert': {
        e.stateT -= dt;
        if (e.stateT <= 0) e.state = 'chase';
        break;
      }
      case 'hurt': {
        e.stateT -= dt;
        if (e.stateT <= 0) e.state = 'chase';
        break;
      }
      case 'chase': {
        const los = hasLOS(e.x, e.y, player.x, player.y);
        if (los && dist < e.spec.range && e.atkCd <= 0) {
          e.state = 'attack';
          e.stateT = 0.22;
          e.shotsLeft = e.burst || 1;
          e.heading = Math.atan2(dy, dx);       // you get shot at face-on
          break;
        }
        // Close the gap, but keep a little standoff. The standoff is only
        // meaningful with line of sight: holding position at 3.2u through a
        // wall is how a guard used to freeze one room short of the fight.
        const want = e.want !== undefined ? e.want
                   : e.type === 'guard' ? 3.2 : 2.2;
        if (!los || dist > want) {
          const sp = e.spec.speed * dt;
          // straight at the player while it can see them — that reads better
          // in an open room than snapping between tile centres — and down the
          // flow field the moment the geometry gets in the way
          const w = los ? null : navStep(e);
          if (w) {
            moveEnemy(e, w.x * sp, w.y * sp);
            openDoorAhead(e, w.gx, w.gy);
          } else {
            moveEnemy(e, dx / dist * sp, dy / dist * sp);
          }
        }
        break;
      }
      case 'attack': {
        e.stateT -= dt;
        if (e.stateT <= 0) {
          enemyShot(e, dist);
          if (e.shotsLeft > 1) {
            e.shotsLeft--;
            e.stateT = 0.16;          // stay in the muzzle-flash frame
          } else {
            e.state = 'chase';
            // scaled HERE and not in mkEnemy: stepCeoPhase reassigns e.spec.cd
            // outright on every phase change, so a multiplier baked into the
            // spec would silently evaporate the moment the boss hit 62%
            e.atkCd = e.spec.cd * DIFFICULTY[difficulty].cd * (0.75 + Math.random() * 0.5);
          }
        }
        break;
      }
    }
  }
  if (gameState === 'playing') separateEnemies();
}
