// ─── THE MUTATION CATALOG ────────────────────────────────────────────────────
//
// Data only — the runner is reference/mutate.js. Each entry is ONE string
// substitution that injects a known bug, and the suite is required to go red
// for it.
//
// Fields:
//   id          stable name; --only matches against it
//   group       which battery it came from, for reading the --list output
//   file        path from the repo root
//   find        the exact source to replace. MUST match `count` times.
//   replace     what to put there. Keep it syntactically valid — a mutation
//               that fails to parse is reported as BROKEN, not as a kill.
//   count       expected occurrences of `find`; defaults to 1
//   note        what the bug DOES, in player-visible terms. This is what you
//               read when it survives, so "removes the guard" is useless and
//               "a slab lands on a pickup and seals it away" is the point.
//   unkillable  a reason string when the mutation cannot be observed AT ALL —
//               not merely uncovered. See mutate.js for why these are marked
//               rather than chased.
//
// ── Choosing an anchor
//
// Anchor on something that has to change if the behaviour changes, and never
// on a comment. `find` is checked for an exact occurrence count before
// anything runs, so a rename fails the catalog loudly instead of quietly
// running the pristine game and reporting a coverage gap that is not there.
//
// ── Adding one
//
// When you add a system, add its mutations in the same pass and confirm the
// suite goes red for each. A test you have never seen fail is a guess; this
// file is where that gets checked mechanically.

'use strict';

module.exports = [

  // ══ MVP CORE ═══════════════════════════════════════════════════════════════
  // The raycaster, the grid queries, push-walls, firing and pickups. Sixteen of
  // these ran at the MVP and three survived: a slab that blocked neither rays
  // nor bodies, and a secret that could be pushed forever.

  { id: 'ray-door-open-slice', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'if (lat < c.open) continue;',
    replace: 'if (false) continue;',
    note: 'an opened door still stops rays — a half-open shutter shows a wall, not the room behind it' },

  { id: 'ray-lat-range', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'if (lat < 0 || lat >= 1) continue;',
    replace: 'if (false) continue;',
    note: 'a ray that left the tile before the mid-plane reports a hit that is not on the door, handing the renderer a wallX above 1. Survived Phase 4 until a SOUTHWARD oblique ray was added: northward lands at lat<0, which lat<c.open skips anyway' },

  { id: 'ray-door-behind-face', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'if (t < perp || t > limit) continue;',
    replace: 'if (t > limit) continue;',
    unkillable: 'The lat range test on the next line subsumes it for every ray that is not a degenerate corner graze. t is defined so the crossing sits ON the mid-plane in one axis, so a crossing behind the entry face is outside the cell in the OTHER axis, which `lat < 0 || lat >= 1` already rejects. Measured on hand-built open-flank geometry the validator refuses to ship: 400,000 off-grid rays, ZERO differences; 1.4M rays on a grid, five \u2014 all of them exactly 45 degrees through a tile corner, where lat lands on exactly 0 (in range, by the half-open interval) and `t < perp` is decided by a single ULP between two different expressions. Pinning that in the suite would assert a rounding accident, not a behaviour, and no shipped floor can contain the geometry: validate-level.js requires every door to be flanked on exactly one axis. The guard is kept \u2014 it states the intent and costs nothing.',
    note: 'a door mid-plane crossing BEHIND the entry face is accepted, so a door can be hit through its own tile from the wrong side' },

  { id: 'ray-perp-off-by-a-tile', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'const perp = side === 0 ? (sideDistX - deltaX) : (sideDistY - deltaY);',
    replace: 'const perp = side === 0 ? sideDistX : sideDistY;',
    note: 'every wall reports the distance to its FAR face — the whole world renders one tile further away than it is' },

  { id: 'ray-wallx-fraction', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'wx -= Math.floor(wx);',
    replace: 'wx -= 0;',
    note: 'wallX stays a world coordinate instead of a 0..1 position along the face, so texture seeding and the door slice both read garbage' },

  { id: 'ray-depth-limit', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'if (perp > limit) break;',
    replace: 'if (perp > limit * 4) break;',
    note: 'the ray cutoff stops being MAX_DEPTH, so walls render out past the fog and hasLOS sees through the whole floor' },

  { id: 'los-tolerance-sign', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'return hit.dist >= d - 0.25;',
    replace: 'return hit.dist >= d + 0.25;',
    note: 'line of sight demands the ray travel PAST the target, so nothing can ever see the player and no enemy wakes' },

  { id: 'sprite-span-no-depth', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'const halfW = (FOCAL * wW * 0.5) / depth;',
    replace: 'const halfW = (FOCAL * wW * 0.5);',
    note: 'a sprite claims the same screen width at every distance — a guard across the room is as easy to hit as one in your face' },

  { id: 'sprite-center-no-depth', group: 'MVP core', file: 'wolf3d/raycast.js',
    find: 'const centerCol = COLS / 2 + (lateral / depth) * FOCAL;',
    replace: 'const centerCol = COLS / 2 + lateral * FOCAL;',
    note: 'the projection stops dividing by depth, so distant sprites fly off the sides of the screen' },

  { id: 'block-door-threshold', group: 'MVP core', file: 'wolf3d/world.js',
    find: "if (c.tag === 'door') return c.open < 0.65;",
    replace: "if (c.tag === 'door') return c.open < 0.02;",
    note: 'you walk through a door the instant it starts moving, well before it looks open' },

  { id: 'block-ignores-slab', group: 'MVP core', file: 'wolf3d/world.js',
    find: 'if (movingSecrets.length && inSlab(wx, wy)) return true;',
    replace: 'if (false) return true;',
    note: 'a push-wall in transit blocks no bodies — you walk straight through a moving slab. SURVIVED the MVP suite' },

  { id: 'castray-skips-secrets', group: 'MVP core', file: 'wolf3d/world.js',
    find: 'return castSecrets(px, py, angle, hit.dist) || hit;',
    replace: 'return hit;',
    note: 'a push-wall in transit blocks no rays — you see straight through a moving slab. SURVIVED the MVP suite' },

  { id: 'secret-pushable-forever', group: 'MVP core', file: 'wolf3d/world.js',
    find: "} else if (c.secret && c.phase === 'idle') {",
    replace: '} else if (c.secret) {',
    note: 'a landed push-wall can be shoved again, and again — secretsFound climbs past totalSecrets. SURVIVED the MVP suite' },

  { id: 'secret-lands-on-pickup', group: 'MVP core', file: 'wolf3d/world.js',
    find: 'if (cellAt(nx, ny) || occupied(nx, ny) || itemAt(nx, ny)) break;',
    replace: 'if (cellAt(nx, ny) || occupied(nx, ny)) break;',
    note: 'a slab parks on top of a pickup and seals it away for good: blockAt keeps you off the tile and stepItems needs 0.62u' },

  { id: 'secret-no-shove-clear', group: 'MVP core', file: 'wolf3d/world.js',
    find: 'shoveClear(player, ox, oy, s);',
    replace: 'void 0;',
    note: 'the player caught inside a moving slab is never ejected — sealed inside a wall' },

  { id: 'secret-span-two-tiles', group: 'MVP core', file: 'wolf3d/world.js',
    find: 'for (let n = 1; n <= 2; n++) {',
    replace: 'for (let n = 1; n <= 6; n++) {',
    note: 'a push-wall travels six tiles instead of two, so it can cross a whole room and open geometry no floor was authored for' },

  { id: 'door-closes-on-body', group: 'MVP core', file: 'wolf3d/world.js',
    find: 'if (occupied(d.gx, d.gy)) d.timer = 1.0;',
    replace: 'if (false) d.timer = 1.0;',
    note: 'a door closes on top of whoever is standing in it' },

  { id: 'fire-through-walls', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'if (!hasLOS(player.x, player.y, e.x, e.y)) continue;',
    replace: 'if (false) continue;',
    note: 'you shoot enemies through solid walls' },

  { id: 'fire-hits-farthest', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'if (depth < bestD) { bestD = depth; best = e; }',
    replace: '{ bestD = depth; best = e; }',
    note: 'a shot picks the LAST candidate in the list rather than the nearest, so you shoot past the guard in front of you' },

  { id: 'fire-no-aim-test', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'if (Math.abs(centerCol - aimCol) > halfW) continue;',
    replace: 'if (false) continue;',
    note: 'anything in the forward hemisphere is a hit — aiming stops mattering entirely' },

  { id: 'fire-no-cooldown', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'player.fireCd = w.cd;',
    replace: 'player.fireCd = 0;',
    note: 'the rate of fire cap is gone: every weapon fires once per frame' },

  { id: 'fire-clip-free', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'player.clip -= w.cost;',
    replace: 'player.clip -= 0;',
    note: 'firing never empties the magazine, so the reload cycle can never start' },

  { id: 'fire-ammo-free', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'player.ammo -= w.cost;',
    replace: 'player.ammo -= 0;',
    note: 'firing never spends reserve ammo — infinite rounds' },

  { id: 'pickup-radius', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'if (Math.hypot(it.x - player.x, it.y - player.y) > 0.62) continue;',
    replace: 'if (Math.hypot(it.x - player.x, it.y - player.y) > 6.2) continue;',
    note: 'pickups are collected from ten times the range — a whole room empties as you enter it' },

  { id: 'pickup-not-consumed', group: 'MVP core', file: 'wolf3d/combat.js',
    find: 'it.taken = true;',
    replace: 'it.taken = false;',
    note: 'a pickup is never consumed: standing on a wallet pays 500 every frame' },

  // ══ PHASE 1 ════════════════════════════════════════════════════════════════
  // Three floors, the CEO, the end-of-floor tally, and the treasure counters.
  // Twenty ran; the CEO's standoff and its burst fire both survived, with no
  // assertion behind either.

  { id: 'tally-pays-below-100', group: 'Phase 1', file: 'wolf3d/tally.js',
    find: 'if (r.pct >= 100 && !r.paid) {',
    replace: 'if (r.pct >= 90 && !r.paid) {',
    note: 'the perfect bonus pays at 90% — Wolf3D paid nothing for 99% and neither should this' },

  { id: 'tally-perfect-bonus', group: 'Phase 1', file: 'wolf3d/tally.js',
    find: 'player.score += PERFECT_BONUS;',
    replace: 'player.score += 0;',
    note: 'a clean 100% category pays nothing' },

  { id: 'tally-double-pays', group: 'Phase 1', file: 'wolf3d/tally.js',
    find: 'r.paid = true;',
    replace: 'r.paid = false;',
    note: 'settleRow stops being idempotent, so the roll-up landing and finishTally settling both pay — 5000 a category' },

  { id: 'tally-skip-pays-nothing', group: 'Phase 1', file: 'wolf3d/tally.js',
    find: `  if (!tally.timePaid) {
    tally.timePaid = true;
    player.score += tally.timeBonus;
  }`,
    replace: `  if (!tally.timePaid) {
    tally.timePaid = true;
  }`,
    note: 'skipping the roll-up forfeits the time bonus that watching it awards — the exact bug an early version shipped' },

  { id: 'tally-time-bonus-negative', group: 'Phase 1', file: 'wolf3d/tally.js',
    find: 'timeBonus: Math.max(0, Math.round(par - levelTime) * TIME_BONUS_PER_SEC),',
    replace: 'timeBonus: Math.round(par - levelTime) * TIME_BONUS_PER_SEC,',
    note: 'finishing over par SUBTRACTS score instead of paying zero' },

  { id: 'tally-kill-ratio', group: 'Phase 1', file: 'wolf3d/tally.js',
    find: "{ id: 'Kill',     pct: ratio(player.kills,  totalEnemies)  },",
    replace: "{ id: 'Kill',     pct: ratio(player.kills,  player.kills)  },",
    note: 'the kill ratio measures kills against itself and always reads 100%, paying its bonus every floor' },

  { id: 'tally-secret-ratio', group: 'Phase 1', file: 'wolf3d/tally.js',
    find: "{ id: 'Secret',   pct: ratio(secretsFound,  totalSecrets)  },",
    replace: "{ id: 'Secret',   pct: ratio(secretsFound,  secretsFound)  },",
    note: 'the secret ratio always reads 100% and pays for secrets you never found' },

  { id: 'treasure-denominator', group: 'Phase 1', file: 'wolf3d/level.js',
    find: "case '$': items.push(mkItem('cash',    x + 0.5, y + 0.5)); totalTreasure++; break;",
    replace: "case '$': items.push(mkItem('cash',    x + 0.5, y + 0.5)); break;",
    note: 'totalTreasure stays 0, so the treasure ratio is a division by zero that ratio() reports as a free 100%' },

  { id: 'treasure-counter', group: 'Phase 1', file: 'wolf3d/combat.js',
    find: 'treasureFound++;',
    replace: 'void 0;',
    note: 'collecting a wallet pays 500 but never counts toward the treasure ratio' },

  { id: 'carry-loses-score', group: 'Phase 1', file: 'wolf3d/level.js',
    find: 'if (!carry) { player.hp = 100; player.ammo = 24; player.score = 0; player.weapon = PISTOL; resetWeapons(); }',
    replace: '{ player.hp = 100; player.ammo = 24; player.score = 0; player.weapon = PISTOL; resetWeapons(); }',
    note: 'descending a floor resets health, ammo and score — carry stops meaning anything' },

  { id: 'carry-keeps-kills', group: 'Phase 1', file: 'wolf3d/level.js',
    find: 'player.kills = 0;',
    replace: 'player.kills = player.kills;',
    note: 'kills accumulate across floors, so floor 2 opens with floor 1 already on the board and the ratio exceeds 100%' },

  { id: 'carry-keeps-keycards', group: 'Phase 1', file: 'wolf3d/level.js',
    find: 'player.keyRed = false; player.keyBlue = false;',
    replace: 'player.keyRed = player.keyRed; player.keyBlue = player.keyBlue;',
    note: 'last floor’s keycards open this floor’s doors, so every keycard gate after floor 1 is free' },

  { id: 'nextlevel-past-last', group: 'Phase 1', file: 'wolf3d/level.js',
    find: 'if (levelIndex + 1 >= LEVELS.length) return false;',
    replace: 'if (false) return false;',
    note: 'clearing the last floor descends into a floor that does not exist instead of winning' },

  { id: 'ceo-phases-frozen', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'for (let i = 0; i < CEO_PHASES.length; i++) if (frac <= CEO_PHASES[i].at) want = i;',
    replace: 'for (let i = 0; i < CEO_PHASES.length; i++) if (frac <= CEO_PHASES[i].at) want = 0;',
    note: 'the CEO never leaves BOARD MEETING: no speed-up, no bursts, no drones' },

  { id: 'ceo-summon-off', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'if (ph.summon) summonDrones(e, ph.summon);',
    replace: 'if (false) summonDrones(e, ph.summon);',
    note: 'GOLDEN PARACHUTE summons nothing — the last phase is just a faster boss' },

  { id: 'ceo-summon-denominator', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'totalEnemies++;',
    replace: 'void 0;',
    note: 'summoned drones are killable but not counted, so killing them pushes the kill ratio ABOVE 100%' },

  { id: 'ceo-elevator-ungated', group: 'Phase 1', file: 'wolf3d/world.js',
    find: "if (boss && boss.alive) { toast('THE BOARD IS STILL IN SESSION'); sfx('deny'); return; }",
    replace: "if (false) { toast('THE BOARD IS STILL IN SESSION'); sfx('deny'); return; }",
    note: 'you ride the elevator out past a living CEO — the whole boss fight is skippable' },

  { id: 'ceo-standoff-seed', group: 'Phase 1', file: 'wolf3d/world.js',
    find: "want: type === 'ceo' ? CEO_PHASES[0].want : undefined,",
    replace: 'want: undefined,',
    note: 'the CEO falls back to a drone’s 2.2u standoff and walks straight into your muzzle' },

  { id: 'ceo-standoff-phase', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'e.want  = ph.want;',
    replace: 'e.want  = e.want;',
    note: 'the CEO keeps its opening 5.2u standoff through every phase and never closes' },

  { id: 'ceo-burst-length', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'e.burst = ph.burst;',
    replace: 'e.burst = 1;',
    note: 'the CEO never fires a burst — the 3- and 4-shot phases hit like the first one' },

  { id: 'ceo-phase-speed', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'e.spec.speed = ph.speed;',
    replace: 'e.spec.speed = e.spec.speed;',
    note: 'the CEO never speeds up between phases' },

  { id: 'ceo-phase-damage', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'e.spec.dmg   = ph.dmg;',
    replace: 'e.spec.dmg   = e.spec.dmg;',
    note: 'the CEO keeps its opening damage forever' },

  { id: 'burst-single-shot', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'if (e.shotsLeft > 1) {',
    replace: 'if (false) {',
    note: 'a burst collapses to one shot for every enemy that has one' },

  { id: 'burst-seed', group: 'Phase 1', file: 'wolf3d/enemies.js',
    find: 'e.shotsLeft = e.burst || 1;',
    replace: 'e.shotsLeft = 1;',
    note: 'the burst counter is seeded at one regardless of the enemy’s burst length' },

  // ══ PHASE 2 ════════════════════════════════════════════════════════════════
  // Pathfinding, separation, patrols and rotations. Fourteen ran and FIVE
  // survived; running them down found the mirrored sprite pair and the patrol
  // target that walked ahead of the body forever.

  { id: 'nav-routes-locked-doors', group: 'Phase 2', file: 'wolf3d/nav.js',
    find: "return c.tag === 'door' && c.lock === null;",
    replace: "return c.tag === 'door';",
    note: 'the flow field routes enemies through locked doors they carry no keycard for, and they queue against them forever' },

  { id: 'nav-ignores-slab', group: 'Phase 2', file: 'wolf3d/nav.js',
    find: 'if (movingSecrets.length && inSlab(gx + 0.5, gy + 0.5)) return false;',
    replace: 'if (false) return false;',
    note: 'the flow field routes straight through a push-wall in transit' },

  { id: 'nav-seed-not-player', group: 'Phase 2', file: 'wolf3d/nav.js',
    find: 'const sx = player.x | 0, sy = player.y | 0;',
    replace: 'const sx = 1, sy = 1;',
    note: 'the field is seeded at the map corner, so chasers walk to the corner instead of to you' },

  { id: 'nav-stale-until-timer', group: 'Phase 2', file: 'wolf3d/nav.js',
    find: 'if (navRebuildT > 0 && (player.x | 0) === navSeedX && (player.y | 0) === navSeedY) return;',
    replace: 'if (navRebuildT > 0) return;',
    note: 'the field is never rebuilt on a tile crossing, only on the 0.35s timer — enemies chase where you were' },

  { id: 'nav-step-uphill', group: 'Phase 2', file: 'wolf3d/nav.js',
    find: 'if (d < 0 || d >= best) continue;',
    replace: 'if (d < 0) continue;',
    note: 'a step down the field accepts any reachable neighbour rather than a closer one, so enemies wander instead of converging' },

  { id: 'nav-step-tile-edge', group: 'Phase 2', file: 'wolf3d/nav.js',
    find: 'const vx = (bx + 0.5) - e.x, vy = (by + 0.5) - e.y;',
    replace: 'const vx = bx - e.x, vy = by - e.y;',
    note: 'enemies aim at the tile CORNER rather than its centre and clip their shoulder on every wall they round' },

  { id: 'nav-field-not-cleared', group: 'Phase 2', file: 'wolf3d/nav.js',
    find: 'navDist.fill(-1);',
    replace: 'void 0;',
    note: 'stale distances survive the rebuild, so unreachable tiles keep whatever number they last had' },

  { id: 'chase-no-flow-field', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'const w = los ? null : navStep(e);',
    replace: 'const w = null;',
    note: 'the pre-Phase-2 behaviour: chasers steer straight at the player and grind along the wall at every corner' },

  { id: 'chase-standoff-ungated', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'if (!los || dist > want) {',
    replace: 'if (dist > want) {',
    note: 'the standoff stops being gated on sight, so a guard freezes 3.2u from a player it cannot see and has no route to — the "jammed at 4.2u" bug' },

  { id: 'move-enemy-axis-coupled', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: `  if (nx && !blockAt(e.x + nx + Math.sign(nx) * BODY_MARGIN, e.y)) { e.x += nx; moved = true; }
  if (ny && !blockAt(e.x, e.y + ny + Math.sign(ny) * BODY_MARGIN)) { e.y += ny; moved = true; }`,
    replace: `  if (nx && !blockAt(e.x + nx + Math.sign(nx) * BODY_MARGIN, e.y)) { e.x += nx; moved = true; }
  else if (ny && !blockAt(e.x, e.y + ny + Math.sign(ny) * BODY_MARGIN)) { e.y += ny; moved = true; }`,
    note: 'the two axis tests become exclusive, so a body pressed against a wall stops sliding along it — the sibling of the double-sideways-speed bug' },

  { id: 'move-enemy-no-margin', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'const BODY_MARGIN = 0.26;',
    replace: 'const BODY_MARGIN = 0;',
    note: 'bodies walk until their centre is inside a wall, so a guard renders half-buried' },

  { id: 'move-enemy-no-heading', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'if (moved) e.heading = Math.atan2(ny, nx);',
    replace: 'if (false) e.heading = Math.atan2(ny, nx);',
    note: 'a body never updates which way it faces, so every guard keeps its spawn rotation for the whole floor' },

  { id: 'enemy-opens-locked-door', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: "if (!c || c.tag !== 'door' || c.lock !== null || c.phase !== 'closed') return;",
    replace: "if (!c || c.tag !== 'door' || c.phase !== 'closed') return;",
    note: 'enemies open LOCKED doors, which unpicks every keycard gate on all three floors' },

  { id: 'enemy-opens-doors-far', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'if (Math.hypot(gx + 0.5 - e.x, gy + 0.5 - e.y) > 1.2) return;',
    replace: 'if (Math.hypot(gx + 0.5 - e.x, gy + 0.5 - e.y) > 12) return;',
    note: 'a chaser opens doors from across the floor rather than by leaning on the one in front of it' },

  { id: 'separate-one-radius', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: "function bodyRadius(e) { return e.type === 'ceo' ? 0.55 : 0.35; }",
    replace: 'function bodyRadius(e) { return 0.35; }',
    note: 'the CEO claims a guard’s radius, so the drones it summons stand inside its jacket' },

  { id: 'separate-shoves-corpses', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: `    const a = enemies[i];
    if (!a.alive) continue;`,
    replace: `    const a = enemies[i];
    if (false) continue;`,
    note: 'separation acts on corpses, so bodies creep away from where they fell and drift out from under their own blood' },

  { id: 'separate-through-walls', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: `      moveEnemy(a, -ux, -uy);
      moveEnemy(b,  ux,  uy);`,
    replace: `      a.x -= ux; a.y -= uy;
      b.x += ux; b.y += uy;`,
    note: 'the shove bypasses collision and pushes bodies through walls — the way this kind of fix usually goes wrong' },

  { id: 'separate-coincident-nan', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'if (d < 1e-4) {',
    replace: 'if (false) {',
    note: 'exactly-coincident bodies divide by zero and both positions become NaN — which is exactly how summoned drones spawn' },

  { id: 'separate-not-run', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: "if (gameState === 'playing') separateEnemies();",
    replace: 'if (false) separateEnemies();',
    note: 'separation never runs: a group chase collapses to one sprite doing the work of several' },

  { id: 'patrol-target-walks-ahead', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'const vx = e.patrolTX - e.x, vy = e.patrolTY - e.y;',
    replace: 'const vx = ((e.x | 0) + 0.5 + e.patrolDir[0]) - e.x, vy = ((e.y | 0) + 0.5 + e.patrolDir[1]) - e.y;',
    note: 'the destination is recomputed from the CURRENT tile every frame, so it walks ahead of the body forever: arrival never fires, the direction is never re-picked, the leash is never consulted again. A guard walks a 30-tile corridor end to end' },

  { id: 'patrol-no-leash', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: 'return Math.hypot(gx + 0.5 - e.spawnX, gy + 0.5 - e.spawnY) <= PATROL_LEASH;',
    replace: 'return true;',
    note: 'patrols wander the whole floor, unpicking its pacing and walking onto the player’s spawn' },

  { id: 'patrol-through-doors', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: `  const c = cellAt(gx, gy);
  if (c) return false;`,
    replace: `  const c = cellAt(gx, gy);
  if (c && c.tag !== 'door') return false;`,
    note: 'bored guards patrol into closed doors, so a floor of them cycles every door on it' },

  { id: 'patrol-ceo-paces', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: "if (e.type === 'ceo') return;",
    replace: 'if (false) return;',
    note: 'the CEO patrols the boardroom instead of waiting, and can wander off its own arena' },

  { id: 'patrol-never-straight', group: 'Phase 2', file: 'wolf3d/enemies.js',
    find: '&& Math.random() < 0.72) return;',
    replace: '&& Math.random() < 0.0) return;',
    note: 'a patrol re-rolls its direction at every tile, so a corridor reads as a shuffle rather than a route' },

  { id: 'sprite-back-view', group: 'Phase 2', file: 'wolf3d/render.js',
    find: 'if (a <= Math.PI / 4)     return SPR.guardBack;',
    replace: 'if (a <= Math.PI / 4)     return SPR.guard;',
    note: 'a guard walking away faces you — the back view never appears' },

  { id: 'sprite-lr-swapped', group: 'Phase 2', file: 'wolf3d/render.js',
    find: 'return rel > 0 ? SPR.guardLeft : SPR.guardRight;',
    replace: 'return rel > 0 ? SPR.guardRight : SPR.guardLeft;',
    note: 'the left/right pair is mirrored in all eight viewing cases — exactly what shipped, from reasoning about the sign of atan2 instead of measuring' },

  { id: 'sprite-drone-rotates', group: 'Phase 2', file: 'wolf3d/render.js',
    find: "if (e.type !== 'guard') return SPR[e.type];",
    replace: 'if (false) return SPR[e.type];',
    note: 'drones and the CEO get the guard rotation table and render as guards from three of four angles' },

  { id: 'fire-span-follows-rotation', group: 'Phase 2', file: 'wolf3d/combat.js',
    find: 'const { centerCol, halfW } = spriteSpan(depth, lateral, SPR[e.type].wW);',
    replace: 'const { centerCol, halfW } = spriteSpan(depth, lateral, enemySprite(e).wW);',
    unkillable: 'Every LIVE view of every type keeps the base sprite\u2019s wW on purpose (art.js: \u201cEvery rotation keeps the front sprite\u2019s wW/wH/foot\u201d) \u2014 guard/Back/Left/Right/Fire are all 1.15, drone and droneFire 1.2, ceo and ceoFire 2.5. The only frames that differ are Die and Dead, and fire() skips !e.alive before it measures, so they are unreachable. Swept exhaustively over every heading x relative bearing x live state: the two expressions are equal for every input fire() can see. The base sprite is still the honest form \u2014 turning must never make a body harder to shoot \u2014 and the invariant that makes this unkillable is now asserted in the enemy facing group, so the day a rotation is given its own width the suite goes red and this becomes killable again.',
    note: 'the hit span follows the rotated sprite, so turning sideways makes a guard measurably harder to shoot' },

  // ══ PHASE 3 ════════════════════════════════════════════════════════════════
  // The weapon roster, spread, difficulty scaling and the damage arc. Thirty-one
  // ran and three survived: the accuracy and damage multipliers, and a floor
  // thinned to zero enemies. Two more are still live — see the notes.

  { id: 'weapon-lookup-frozen', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'function curWeapon() { return WEAPONS[player.weapon]; }',
    replace: 'function curWeapon() { return WEAPONS[PISTOL]; }',
    note: 'every weapon behaves like the pistol — the roster is cosmetic' },

  { id: 'switch-tops-up-clip', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (w.cost > 0) player.clip = Math.min(player.clip, w.clip);',
    replace: 'if (w.cost > 0) player.clip = w.clip;',
    note: 'switching away and back is a free instant reload, and mints ammo that was never in the reserve' },

  { id: 'switch-empties-on-knife', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (w.cost > 0) player.clip = Math.min(player.clip, w.clip);',
    replace: 'player.clip = Math.min(player.clip, w.clip);',
    note: 'the knife’s capacity of 0 truncates the magazine you were holding, so drawing a blade costs you a full reload' },

  { id: 'switch-to-unowned', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (!player.weapons[i]) return false;',
    replace: 'if (false) return false;',
    note: 'you can select a weapon you do not own' },

  { id: 'spread-rolled-per-enemy', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (Math.abs(centerCol - aimCol) > halfW) continue;',
    replace: 'if (Math.abs(centerCol - (COLS / 2 + (w.spread ? (Math.random() * 2 - 1) * w.spread : 0))) > halfW) continue;',
    note: 'the spread roll moves INSIDE the candidate loop, giving every body its own chance — spread quietly becomes a hit test that widens with the size of the crowd. Indistinguishable against one target; needs three bodies stacked on a tile' },

  { id: 'spread-disabled', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'const aimCol = COLS / 2 + (w.spread ? (Math.random() * 2 - 1) * w.spread : 0);',
    replace: 'const aimCol = COLS / 2;',
    note: 'the SMG and chaingun become pinpoint accurate at every range' },

  { id: 'melee-unlimited-reach', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (w.reach && Math.hypot(ex, ey) > w.reach) continue;',
    replace: 'if (false) continue;',
    note: 'the knife kills across the room — its 1.6u radius is the only thing making it melee' },

  { id: 'gun-dead-zone', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (depth <= w.minDepth || depth >= MAX_DEPTH) continue;',
    replace: 'if (depth <= 0 || depth >= MAX_DEPTH) continue;',
    note: 'the 0.35u dead zone in front of every gun disappears, so a body touching you is shootable and the knife loses its only advantage' },

  { id: 'chaingun-no-spinup', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (player.windT < w.spinUp) return;',
    replace: 'if (false) return;',
    note: 'the chaingun fires the instant you pull the trigger — the barrels never have to come up to speed' },

  { id: 'chaingun-banks-spin', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'player.windT = Math.max(0, player.windT - dt * 1.6);',
    replace: 'void 0;',
    note: 'releasing the trigger banks the wind-up forever, so the spin-up is a one-time cost per floor' },

  { id: 'reload-with-empty-reserve', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (player.ammo - player.clip <= 0) return false;',
    replace: 'if (false) return false;',
    note: 'you can reload with nothing in reserve, so the gun refills from thin air' },

  { id: 'reload-when-full', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'if (player.clip >= w.clip) return false;',
    replace: 'if (false) return false;',
    note: 'a full magazine still starts a reload cycle, locking the gun for the duration' },

  { id: 'reload-conjures-ammo', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'player.clip = Math.min(curWeapon().clip, player.ammo);',
    replace: 'player.clip = curWeapon().clip;',
    note: 'a reload seats a full magazine regardless of the reserve, so the last 8 rounds become 8 forever' },

  { id: 'difficulty-accuracy', group: 'Phase 3', file: 'wolf3d/enemies.js',
    find: 'const p = Math.min(1, Math.max(0.16, 0.72 - dist * 0.045) * D.acc);',
    replace: 'const p = Math.min(1, Math.max(0.16, 0.72 - dist * 0.045));',
    note: 'every difficulty shoots with the same accuracy. SURVIVED the Phase 3 suite until a 500-sample test measured hit rate through the real enemyShot' },

  { id: 'difficulty-damage', group: 'Phase 3', file: 'wolf3d/enemies.js',
    find: 'hurtPlayer(Math.round(e.spec.dmg * D.dmg * falloff * (0.7 + Math.random() * 0.6)), e.x, e.y);',
    replace: 'hurtPlayer(Math.round(e.spec.dmg * falloff * (0.7 + Math.random() * 0.6)), e.x, e.y);',
    note: 'every difficulty hits for the same damage. SURVIVED the Phase 3 suite; the fix measures per-hit damage separately from hit rate' },

  { id: 'difficulty-attack-delay', group: 'Phase 3', file: 'wolf3d/enemies.js',
    find: 'e.atkCd = e.spec.cd * DIFFICULTY[difficulty].cd * (0.75 + Math.random() * 0.5);',
    replace: 'e.atkCd = e.spec.cd * (0.75 + Math.random() * 0.5);',
    note: 'every difficulty attacks at the same rate. KNOWN LIVE SURVIVOR at Phase 4 — the cd multiplier has no assertion behind it; the jitter means this needs a sampled RATE over a long run, not one cycle' },

  { id: 'thinning-empties-floor', group: 'Phase 3', file: 'wolf3d/level.js',
    find: 'const want = Math.min(mob, Math.max(1, Math.round(mob * D.keep)));',
    replace: 'const want = Math.min(mob, Math.round(mob * D.keep));',
    note: 'a one-guard floor thinned at the easiest setting rounds to ZERO enemies — and ratio() reports an empty category as 100%, silently awarding a perfect kill ratio and its 2500 bonus. KNOWN LIVE SURVIVOR at Phase 4' },

  { id: 'thinning-keeps-everyone', group: 'Phase 3', file: 'wolf3d/level.js',
    find: 'acc += want;',
    replace: 'acc += mob;',
    note: 'the running-ratio walk keeps every spawn, so the easy settings stop thinning the floor at all' },

  { id: 'difficulty-no-reinforcements', group: 'Phase 3', file: 'wolf3d/level.js',
    find: 'const extra = survivors.length ? Math.round(mob * D.extra) : 0;',
    replace: 'const extra = 0;',
    note: 'I AM DEATH INCARNATE stops adding its 35% reinforcements' },

  { id: 'difficulty-clamp', group: 'Phase 3', file: 'wolf3d/world.js',
    find: 'difficulty = Math.max(0, Math.min(DIFFICULTY.length - 1, n | 0));',
    replace: 'difficulty = n | 0;',
    note: 'an out-of-range difficulty index is stored, and every DIFFICULTY[difficulty] lookup after it is undefined' },

  { id: 'difficulty-reset-on-floor', group: 'Phase 3', file: 'wolf3d/level.js',
    find: '  player.fireCd = 0; player.bob = 0; player.hurtT = 0; player.flashT = 0;',
    replace: '  difficulty = DIFF_DEFAULT;\n  player.fireCd = 0; player.bob = 0; player.hurtT = 0; player.flashT = 0;',
    note: 'starting a floor silently resets the difficulty, so dying on floor 3 puts you back on the default' },

  { id: 'arc-direction-mirrored', group: 'Phase 3', file: 'wolf3d/render.js',
    find: 'return Math.atan2(lat, fwd);',
    replace: 'return Math.atan2(-lat, fwd);',
    note: 'the damage arc points away from whoever shot you — the same mirrored-sign failure as the guard sprite pair' },

  { id: 'arc-markers-stack', group: 'Phase 3', file: 'wolf3d/render.js',
    find: 'if (Math.hypot(h.x - sx, h.y - sy) < 1.2) { h.x = sx; h.y = sy; h.t = 0; return; }',
    replace: 'if (false) { h.x = sx; h.y = sy; h.t = 0; return; }',
    note: 'a burst from one enemy stacks six markers on the same few cells instead of refreshing one' },

  { id: 'arc-alpha-unquantised', group: 'Phase 3', file: 'wolf3d/render.js',
    find: 'const a = Math.round(fade * (1 - Math.abs(k) / 5) * 4) / 4;',
    replace: 'const a = fade * (1 - Math.abs(k) / 5);',
    note: 'every frame of every arc fade mints a fresh (glyph, colour) atlas entry — unbounded growth toward the silent fillText degradation' },

  { id: 'dmgpop-alpha-unquantised', group: 'Phase 3', file: 'wolf3d/combat.js',
    find: 'const alpha = Math.round((u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3) * 8) / 8;',
    replace: 'const alpha = (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3);',
    note: 'damage numbers mint an atlas entry per frame per fade — 454 entries over a few hundred shots, against a suite bound of 500' },

  { id: 'arc-cell-aspect', group: 'Phase 3', file: 'wolf3d/render.js',
    find: 'const HIT_ARC_ROWS = HIT_ARC_COLS * CELL_W / CELL_H;',
    replace: 'const HIT_ARC_ROWS = HIT_ARC_COLS;',
    note: 'the arc radius ignores the 7:12 cell aspect and draws a circle in cells, which is a tall ellipse on screen' },

  { id: 'arc-accepts-no-source', group: 'Phase 3', file: 'wolf3d/render.js',
    find: "if (typeof sx !== 'number' || typeof sy !== 'number') return;",
    replace: 'if (false) return;',
    note: 'a hit with no source position pushes an undefined marker, and the arc angle comes out NaN' },

  { id: 'boot-runs-twice', group: 'Phase 3', file: 'wolf3d/main.js',
    find: 'if (booted || !splash.parentElement) return;',
    replace: 'if (!splash.parentElement) return;',
    note: 'a difficulty click bubbling to #splash calls begin() twice: two audio graphs and TWO requestAnimationFrame chains that both re-arm forever' },

  // ══ PHASE 4 ════════════════════════════════════════════════════════════════
  // Thin-wall doors, pause, gore and music. Eleven ran; the jamb rejection
  // survived because the one oblique ray under test pointed the direction
  // another guard already covered.

  { id: 'ray-axis-vs-side', group: 'Phase 4', file: 'wolf3d/raycast.js',
    find: 'const lat = c.axis === 0 ? (py + t * sinA) - mapY',
    replace: 'const lat = side === 0 ? (py + t * sinA) - mapY',
    unkillable: 'For any door validate-level.js accepts, c.axis and the DDA’s `side` are provably EQUAL: a well-formed door is flanked on the axis it slides into, so the march can only enter it through the two faces perpendicular to travel. Nothing observable rests on the difference. c.axis is kept because `t` genuinely needs it and one source for both lines is the honest form.',
    note: 'derives the door’s lateral coordinate from the hit face instead of the door’s own axis' },

  { id: 'door-axis-defaulted', group: 'Phase 4', file: 'wolf3d/level.js',
    find: 'd.axis = (cellAt(d.gx, d.gy - 1) && cellAt(d.gx, d.gy + 1)) ? 0 : 1;',
    replace: 'd.axis = 1;',
    note: 'every door takes the fallback axis, so half of them are see-through at oblique angles while blockAt still holds the whole tile' },

  { id: 'jamb-never-flagged', group: 'Phase 4', file: 'wolf3d/level.js',
    find: "if (n && n.tag === 'panel' && !n.secret) n.jamb = true;",
    replace: 'if (false) n.jamb = true;',
    note: 'the recess a door retracts into is never tinted steel, so the frame reads as more corridor' },

  { id: 'jamb-tints-secrets', group: 'Phase 4', file: 'wolf3d/level.js',
    find: "if (n && n.tag === 'panel' && !n.secret) n.jamb = true;",
    replace: "if (n && n.tag === 'panel') n.jamb = true;",
    note: 'a secret push-wall beside a door is tinted as a jamb and gives itself away — a secret that looks different is not a secret' },

  { id: 'pause-steps-world', group: 'Phase 4', file: 'wolf3d/main.js',
    find: `  if (!paused) {
    // Hold to repeat`,
    replace: `  if (true) {
    // Hold to repeat`,
    note: 'pause stops nothing: doors, secrets, the gun, the reload cycle, the damage pops and the hp chip all keep running under the banner' },

  { id: 'pause-animates', group: 'Phase 4', file: 'wolf3d/main.js',
    find: 'if (!paused) animT += dt;',
    replace: 'animT += dt;',
    note: 'the neon flicker and the rain keep moving on a paused screen' },

  { id: 'pause-any-state', group: 'Phase 4', file: 'wolf3d/world.js',
    find: "if (gameState !== 'playing') return false;",
    replace: 'if (false) return false;',
    note: 'a dead or cleared floor can be paused, burying the banner that state is showing and resuming into a game with no control' },

  { id: 'resume-any-state', group: 'Phase 4', file: 'wolf3d/world.js',
    find: "if (gameState !== 'paused') return false;",
    replace: 'if (false) return false;',
    note: 'resume fires on a dead floor and puts a corpse back in play' },

  { id: 'pause-keeps-mouse', group: 'Phase 4', file: 'wolf3d/world.js',
    find: 'if (document.exitPointerLock) document.exitPointerLock();',
    replace: 'void 0;',
    note: 'pausing does not release the mouse, which is the point of pausing for most players' },

  { id: 'death-one-frame', group: 'Phase 4', file: 'wolf3d/render.js',
    find: 'return seq[Math.min(seq.length - 1, (e.stateT / DEATH_TIME * seq.length) | 0)];',
    replace: 'return seq[0];',
    note: 'a body holds its first death frame for the whole window instead of animating through the sequence' },

  { id: 'death-window-stretched', group: 'Phase 4', file: 'wolf3d/enemies.js',
    find: 'if (e.stateT > DEATH_TIME) e.state = \'dead\';',
    replace: 'if (e.stateT > DEATH_TIME * 4) e.state = \'dead\';',
    note: 'the dying window runs four times as long, so a corpse sits in its animation state for nearly two seconds' },

  { id: 'decal-buried-in-walls', group: 'Phase 4', file: 'wolf3d/enemies.js',
    find: 'if (cellAt(x | 0, y | 0)) { x = e.x; y = e.y; }',
    replace: 'if (false) { x = e.x; y = e.y; }',
    note: 'jittered blood lands inside walls and renders half-buried. Invisible from a corpse on a tile centre, where 0.35 of jitter can never leave the tile — needs a body hard against a wall, where 29 of 64 splats end up buried' },

  { id: 'decal-no-cap', group: 'Phase 4', file: 'wolf3d/enemies.js',
    find: 'while (decals.length > DECAL_CAP) decals.shift();',
    replace: 'void 0;',
    note: 'blood accumulates without a ceiling — a few hundred kills is a few hundred sprites sorted and depth-tested every frame' },

  { id: 'decal-drones-bleed', group: 'Phase 4', file: 'wolf3d/enemies.js',
    find: "if (e.type === 'drone') return;",
    replace: 'if (false) return;',
    note: 'drones bleed. They are drones' },

  { id: 'decal-no-depth-bias', group: 'Phase 4', file: 'wolf3d/render.js',
    find: "list.push({ d: d + 0.02, kind: 'p', ref: p });",
    replace: "list.push({ d: d, kind: 'p', ref: p });",
    note: 'a splat and the corpse lying on it sort at equal depth, so draw order decides which one wins per frame and the body flickers behind its own blood' },

  { id: 'music-lookahead-runaway', group: 'Phase 4', file: 'wolf3d/audio.js',
    find: 'const horizon = now + MUSIC_LOOKAHEAD;',
    replace: 'const horizon = now + 10;',
    note: 'the scheduler empties ten seconds of every voice into one call instead of holding a 0.25s window' },

  { id: 'music-handover-midbar', group: 'Phase 4', file: 'wolf3d/audio.js',
    find: 'else if (want !== musicTrack && want !== musicPending) musicPending = want;',
    replace: 'else if (want !== musicTrack) startTrack(want, now + 0.05);',
    note: 'the boardroom march takes over the instant the CEO wakes, cutting the current note in half instead of waiting for the bar line' },

  { id: 'music-ignores-mute', group: 'Phase 4', file: 'wolf3d/audio.js',
    find: 'if (step[0] !== null && !muted) {',
    replace: 'if (step[0] !== null) {',
    note: 'M mutes the sound effects but the music keeps scheduling notes' },

  { id: 'music-plays-when-dead', group: 'Phase 4', file: 'wolf3d/audio.js',
    find: "const live = gameState === 'playing' || gameState === 'cleared';",
    replace: 'const live = true;',
    note: 'the march keeps playing under the pause banner and over the death screen' },

  { id: 'music-cuts-on-clear', group: 'Phase 4', file: 'wolf3d/audio.js',
    find: "const live = gameState === 'playing' || gameState === 'cleared';",
    replace: "const live = gameState === 'playing';",
    note: 'the audio cuts dead the instant a floor is cleared, which sounds like a crash rather than a reward' },

  { id: 'music-no-boss-track', group: 'Phase 4', file: 'wolf3d/audio.js',
    find: "if (boss && boss.alive && boss.state !== 'idle') return MUSIC[MUSIC.length - 1];",
    replace: "if (false) return MUSIC[MUSIC.length - 1];",
    note: 'the CEO fight plays the ordinary floor track — the boardroom march never appears' },

  { id: 'music-one-track', group: 'Phase 4', file: 'wolf3d/audio.js',
    find: 'return MUSIC[levelIndex % (MUSIC.length - 1)];',
    replace: 'return MUSIC[0];',
    note: 'every floor plays floor 1’s track' },


  // ══ PHASE 5 ════════════════════════════════════════════════════════════════
  // Persistent high scores and the touch overlay, mutated in the same pass that
  // added them — which is the rule this file exists to enforce.

  { id: 'scores-never-persist', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'store.setItem(SCORES_KEY, JSON.stringify(highScores));',
    replace: 'void 0;',
    note: 'the table works for the session and is gone on refresh, which is the entire feature' },

  { id: 'scores-no-store-guard', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'if (!store) return false;',
    replace: 'if (false) return false;',
    unkillable: 'The try/catch two lines below subsumes it: with the guard gone, `store` is null and `null.setItem` throws INSIDE the try, which returns false — the same value, by the same function, for the same input. The guard is an early-out and a statement of intent (no store is an expected state, not an exception), not a load-bearing branch. Nothing observable can tell the two apart.',
    note: 'saving reaches null.setItem instead of returning early — same answer, different route' },

  { id: 'scores-no-cap', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'highScores = merged.slice(0, SCORE_SLOTS);',
    replace: 'highScores = merged;',
    note: 'the table grows without bound, so the splash renders every run ever played and the stored value grows forever' },

  { id: 'scores-sorted-ascending', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'const byScore = (a, b) => (b.score - a.score) || (b.at - a.at);',
    replace: 'const byScore = (a, b) => (a.score - b.score) || (b.at - a.at);',
    note: 'the worst runs take the top slots and the best are the ones that fall off the bottom' },

  { id: 'scores-tie-ranks-below', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'const merged = [entry].concat(highScores).sort(byScore);',
    replace: 'const merged = highScores.concat([entry]).sort(byScore);',
    note: 'a run that ties the last slot is told it missed the table — Date.now() is millisecond-resolution, so the at tiebreak cannot order two runs recorded in the same millisecond and a stable sort keeps the older one' },

  { id: 'scores-no-validation', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'return list.filter(validScore).map(normScore).sort(byScore).slice(0, SCORE_SLOTS);',
    replace: 'return list.map(normScore).sort(byScore).slice(0, SCORE_SLOTS);',
    note: 'garbage in the storage key reaches the splash as NaN rows instead of being discarded' },

  { id: 'scores-corrupt-propagates', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'if (!Array.isArray(parsed)) return highScores;',
    replace: 'if (false) return highScores;',
    unkillable: 'Same shape as scores-no-store-guard: without it a non-array reaches sortScores, `parsed.filter` throws inside the enclosing try, and the catch sets highScores to [] — which is exactly what the guard returns. A broad catch makes every guard inside it unobservable, so both are kept for the reader and neither can be tested.',
    note: 'a non-array stored value reaches .filter instead of returning early — same empty table, different route' },

  { id: 'scores-death-not-filed', group: 'Phase 5', file: 'wolf3d/hud.js',
    find: 'const rank = recordScore(player.score, levelIndex + 1, difficulty, false);',
    replace: 'const rank = -1;',
    note: 'dying never files a run, so only the runs you win are ever recorded' },

  { id: 'scores-escape-not-filed', group: 'Phase 5', file: 'wolf3d/hud.js',
    find: 'const rank = recordScore(player.score, levelIndex + 1, difficulty, true);',
    replace: 'const rank = -1;',
    note: 'getting out never files a run — the best score you can post is one you died on' },

  { id: 'scores-fresh-marks-a-miss', group: 'Phase 5', file: 'wolf3d/scores.js',
    find: 'scoreFresh = rank < SCORE_SLOTS ? rank : -1;',
    replace: 'scoreFresh = rank;',
    note: 'a run that missed the table is reported as having made it, and the banner claims a NEW HIGH SCORE for it' },

  { id: 'touch-no-deadzone', group: 'Phase 5', file: 'wolf3d/touch.js',
    find: 'if (!len || len < TOUCH_RADIUS * TOUCH_DEADZONE) return { x: 0, y: 0, run: false };',
    replace: 'if (!len) return { x: 0, y: 0, run: false };',
    note: 'a thumb resting on the pad drifts the player, because no touch surface reports a true zero' },

  { id: 'touch-no-deadzone-rescale', group: 'Phase 5', file: 'wolf3d/touch.js',
    find: 'const t = (k - TOUCH_DEADZONE) / (1 - TOUCH_DEADZONE);',
    replace: 'const t = k;',
    note: 'the stick jumps straight to a fifth of walking speed the instant it leaves the dead zone, instead of easing out of it' },

  { id: 'touch-no-rim-clamp', group: 'Phase 5', file: 'wolf3d/touch.js',
    find: 'const k = Math.min(1, len / TOUCH_RADIUS);',
    replace: 'const k = len / TOUCH_RADIUS;',
    note: 'dragging past the ring keeps accelerating, so a long swipe walks faster than running' },

  { id: 'touch-forward-inverted', group: 'Phase 5', file: 'wolf3d/touch.js',
    find: 'return { x: dx / len * t, y: -dy / len * t, run: k >= TOUCH_RUN_AT };',
    replace: 'return { x: dx / len * t, y: dy / len * t, run: k >= TOUCH_RUN_AT };',
    note: 'pushing the stick up walks you backwards' },

  { id: 'touch-never-runs', group: 'Phase 5', file: 'wolf3d/touch.js',
    find: 'const TOUCH_RUN_AT    = 0.85;',
    replace: 'const TOUCH_RUN_AT    = 2;',
    note: 'the stick can never reach the run threshold, so a touch player has no way to run at all' },

  { id: 'touch-look-not-consumed', group: 'Phase 5', file: 'wolf3d/touch.js',
    find: 'function consumeTouchLook() { const d = touchLookD; touchLookD = 0; return d; }',
    replace: 'function consumeTouchLook() { return touchLookD; }',
    note: 'the banked yaw is re-applied every frame forever, so one flick spins the camera until you drag it back' },

  { id: 'move-normalise-not-clamp', group: 'Phase 5', file: 'wolf3d/main.js',
    find: 'const k = (mag > 1 ? 1 / mag : 1) * speed;',
    replace: 'const k = (1 / mag) * speed;',
    note: 'the pre-touch normalise comes back, so any stick deflection past the dead zone moves at FULL speed and the analog stick is a digital one' },

  { id: 'move-ignores-stick', group: 'Phase 5', file: 'wolf3d/main.js',
    find: 'if (touchMove.y) { mx += fx * touchMove.y; my += fy * touchMove.y; }',
    replace: 'if (false) { mx += fx * touchMove.y; my += fy * touchMove.y; }',
    note: 'the stick cannot walk forward or back, only strafe' },

  { id: 'move-stick-axes-swapped', group: 'Phase 5', file: 'wolf3d/main.js',
    find: 'if (touchMove.x) { mx += sx * touchMove.x; my += sy * touchMove.x; }',
    replace: 'if (touchMove.x) { mx += fx * touchMove.x; my += fy * touchMove.x; }',
    note: 'the stick strafes along the facing vector, so pushing sideways walks you forward' },

  { id: 'touch-run-ignored', group: 'Phase 5', file: 'wolf3d/main.js',
    find: "const running = keys.has('shift') || touchRun;",
    replace: "const running = keys.has('shift');",
    note: 'the stick at the rim walks rather than runs, and a phone has no shift key to fall back on' },

  // ── Phase 7: earning the weapon roster, the auto-map, the objective line ───
  // The roster shipped fully owned and invisible, which is how a whole
  // playthrough happened on the pistol. These are the bugs that would put it
  // back without anything looking wrong on screen.

  { id: 'unlock-threshold-off-by-one', group: 'Phase 7', file: 'wolf3d/combat.js',
    find: 'if (player.weapons[i] || player.runKills < WEAPON_UNLOCK[i]) continue;',
    replace: 'if (player.weapons[i] || player.runKills <= WEAPON_UNLOCK[i]) continue;',
    note: 'every weapon costs one kill more than the HUD says it does' },

  { id: 'unlock-counts-floor-kills', group: 'Phase 7', file: 'wolf3d/combat.js',
    find: 'if (player.weapons[i] || player.runKills < WEAPON_UNLOCK[i]) continue;',
    replace: 'if (player.weapons[i] || player.kills < WEAPON_UNLOCK[i]) continue;',
    note: 'the thresholds read the per-floor kill count, which startLevel zeroes on every descent — so progress toward the next gun resets each floor and the chaingun needs ten kills on ONE floor' },

  { id: 'unlock-never-equips', group: 'Phase 7', file: 'wolf3d/combat.js',
    find: "    toast(WEAPONS[i].name + ' UNLOCKED  \\u00b7  PRESS [' + (i + 1) + ']');\n    selectWeapon(i);",
    replace: "    toast(WEAPONS[i].name + ' UNLOCKED  \\u00b7  PRESS [' + (i + 1) + ']');",
    note: 'a new gun is granted but left holstered — which is the exact failure the whole feature exists to fix, since a weapon you have to go and select is one a player never learns they own' },

  { id: 'unlock-brings-no-ammo', group: 'Phase 7', file: 'wolf3d/combat.js',
    find: 'player.ammo = Math.min(99, player.ammo + 20);',
    replace: 'player.ammo = Math.min(99, player.ammo);',
    note: 'the chaingun arrives over a pistol-sized reserve, so the reward is under two seconds of trigger' },

  { id: 'unlock-fires-every-kill', group: 'Phase 7', file: 'wolf3d/combat.js',
    find: '    selectWeapon(i);\n    return true;',
    replace: '    selectWeapon(i);\n    player.weapons[i] = 0;\n    return true;',
    note: 'ownership is handed out and immediately taken back, so every kill past the threshold re-announces and re-equips the same gun' },

  { id: 'cold-start-keeps-guns', group: 'Phase 7', file: 'wolf3d/level.js',
    find: 'player.weapon = PISTOL; resetWeapons(); }',
    replace: 'player.weapon = PISTOL; }',
    note: 'a restart or a death keeps the roster you earned last run, so the progression only ever happens once' },

  { id: 'map-sees-through-walls', group: 'Phase 7', file: 'wolf3d/minimap.js',
    find: 'for (let d = MINI_STEP; d < hit.dist; d += MINI_STEP)',
    replace: 'for (let d = MINI_STEP; d < MAX_DEPTH; d += MINI_STEP)',
    note: 'the auto-map reveals straight through walls, so it maps rooms you have never entered and stops being a record of where you have been' },

  { id: 'map-not-wiped-per-floor', group: 'Phase 7', file: 'wolf3d/level.js',
    find: 'seen = new Uint8Array(MAP_W * MAP_H);',
    replace: 'seen = seen || new Uint8Array(MAP_W * MAP_H);',
    note: 'the last floor’s exploration carries into the next one, so floor 2 opens already half mapped — and a floor of a different shape reads a stale array' },

  { id: 'strip-hides-the-price', group: 'Phase 7', file: 'wolf3d/hud.js',
    find: "    s.textContent = owned ? (i + 1) + ' ' + w.name\n                          : player.runKills + '/' + WEAPON_UNLOCK[i];",
    replace: "    s.textContent = (i + 1) + ' ' + w.name;",
    note: 'a locked slot shows the weapon’s name like any other, so the strip stops being the progress bar and nothing on screen says what the gun costs' },

  { id: 'strip-marks-all-owned', group: 'Phase 7', file: 'wolf3d/hud.js',
    find: '    const owned = !!player.weapons[i];',
    replace: '    const owned = true;',
    note: 'every slot reads as owned, so the strip claims you hold guns the number keys will refuse' },

  { id: 'touch-row-unpainted', group: 'Phase 7', file: 'wolf3d/hud.js',
    find: "    const tw = el('tW' + i);",
    replace: "    const tw = null;",
    note: 'the touch weapon row is four identical buttons, three of which silently do nothing — the phone half of the bug the strip exists to fix' },

  { id: 'objective-ignores-keycards', group: 'Phase 7', file: 'wolf3d/hud.js',
    find: "  if (needs('red')  && !player.keyRed)  return 'FIND THE RED KEYCARD';",
    replace: "  if (false) return 'FIND THE RED KEYCARD';",
    note: 'the objective line sends you to the elevator before you hold the keycard that opens the way to it' },

  { id: 'objective-ignores-boss', group: 'Phase 7', file: 'wolf3d/hud.js',
    find: "  if (boss && boss.alive)               return 'THE BOARD IS IN SESSION \\u2014 KILL THE CEO';",
    replace: "  if (false) return 'THE BOARD IS IN SESSION \\u2014 KILL THE CEO';",
    note: 'floor 3 tells you to ride an elevator that use() refuses while the CEO lives' },

  // ── the palette ───────────────────────────────────────────────────────────
  // Not a phase's feature work. This is the invariant the whole renderer rests
  // on, and it went unpinned through seven of them: the atlas is only bounded
  // because mix() rounds its blend factor to 8 steps, and every colour in the
  // game — walls, sprites, decals, the HUD — arrives through fade() -> mix().
  //
  // It went unpinned because it LOOKED covered. Three atlas assertions stood
  // over it and only one of them could see this, and that one was the last
  // A/B still built the wrong way. Re-derived by hand every few phases; here
  // as a ratchet fact instead.

  { id: 'mix-unquantised', group: 'the palette', file: 'wolf3d/config.js',
    find: 'const q = Math.max(0, Math.min(7, Math.round(t * 7)));',
    replace: 'const q = Math.max(0, Math.min(7, t * 7));',
    note: 'the fog blend stops quantising, so EVERY colour in the game — walls, sprites, decals, the HUD — mints a fresh atlas entry per distinct depth. Unbounded growth toward the silent fillText degradation the atlas exists to avoid. Standing still it is invisible (138 entries against 67, both under the boot bound of 500); walking the same 60 frames it is 1124 against 87' },

];
