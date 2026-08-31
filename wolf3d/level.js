'use strict';

// The floor lifecycle: turning a level's ASCII into a populated world, and
// starting, restarting or descending between floors.
//
// Split out of world.js when the difficulty spawn scaling pushed that file
// past the 400-line budget — rule 4 says that is a signal to split, not a
// target to fill. It is a clean seam: world.js owns the grid and the entities
// as STATE, plus the queries over them, and this file owns the one path that
// builds and rebuilds that state. Nothing here runs at load, so it only needs
// to follow world.js for readers, not for the engine.

/**
 * Turn a floor's spawn list into actual bodies, thinned or reinforced to suit
 * the difficulty. The CEO is never touched: it is the floor's win condition,
 * and the elevator will not move while it lives.
 *
 * Selection is a running-ratio (Bresenham) walk rather than a random roll.
 * Random would make a floor different on every restart, make the fixtures
 * unrepeatable, and give no guarantee about how many bodies you actually get;
 * this keeps exactly round(n * keep) of them, evenly spread through the map in
 * source order.
 *
 * `keep` never rounds down to zero. A floor with no enemies left would divide
 * by zero in the tally, where ratio() reports an empty category as 100% — so
 * thinning a one-guard floor out of existence would silently award a perfect
 * kill ratio and its 2500 bonus.
 */
function populateEnemies(spawns) {
  const D = DIFFICULTY[difficulty];
  const mob = spawns.filter(s => s[0] !== 'ceo').length;
  const want = Math.min(mob, Math.max(1, Math.round(mob * D.keep)));

  const survivors = [];
  let acc = 0;
  for (const s of spawns) {
    if (s[0] !== 'ceo') {
      acc += want;
      if (acc < mob) continue;      // this one does not make the cut
      acc -= mob;
    }
    const e = mkEnemy(s[0], s[1], s[2]);
    enemies.push(e);
    if (s[0] === 'ceo') boss = e;
    else survivors.push(s);
  }

  // Reinforcements, on the hardest setting only. They land on a tile a body
  // already occupies rather than somewhere new: separateEnemies resolves
  // exactly-coincident bodies with a deterministic axis, so this needs no
  // placement logic of its own and can never spawn anyone inside a wall.
  const extra = survivors.length ? Math.round(mob * D.extra) : 0;
  for (let i = 0; i < extra; i++) {
    const s = survivors[i % survivors.length];
    enemies.push(mkEnemy(s[0], s[1], s[2]));
  }
  relocateSpawnLOS();
}

// ─── SPAWN SAFETY ──────────────────────────────────────────
// A body that spawns already looking at the player opens fire before the floor
// has finished fading in. Relocation walks any such enemy — reinforcements
// included, since they land on a survivor's authored tile — to the nearest open
// tile with no line of sight back to the spawn, staying inside its own room
// (doors are walls here: a body parked behind a closed door can neither patrol
// nor be reached). The CEO is exempt — it is the floor's win condition, tuned
// to a fixed boardroom, and never spawns in view anyway.
const RELOCATE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function relocateSpawnLOS() {
  const px = player.x, py = player.y;
  const occupied = new Set();
  occupied.add((px | 0) + ',' + (py | 0));
  for (const e of enemies) occupied.add((e.x | 0) + ',' + (e.y | 0));

  for (const e of enemies) {
    if (e.type === 'ceo') continue;
    const d = Math.hypot(e.x - px, e.y - py);
    if (d >= e.spec.sight || !hasLOS(e.x, e.y, px, py)) continue;
    const spot = findCoverTile(e, px, py, occupied);
    if (!spot) continue;
    occupied.delete((e.x | 0) + ',' + (e.y | 0));
    e.x = spot.x; e.y = spot.y;
    e.spawnX = spot.x; e.spawnY = spot.y;      // the patrol leash moves with it
    occupied.add((e.x | 0) + ',' + (e.y | 0));
  }
}

// BFS from the enemy's own tile over open floor, returning the nearest tile it
// cannot see the player from. A flat-array queue, like buildNavField: shift()
// would be quadratic, and this runs once per enemy per floor. Exhausting the
// room without finding cover (a bare hall with no pillars) leaves the body in
// place rather than dropping it somewhere unreachable.
function findCoverTile(e, px, py, occupied) {
  const gx0 = e.x | 0, gy0 = e.y | 0;
  const visited = new Uint8Array(MAP_W * MAP_H);
  const queue = new Int32Array(MAP_W * MAP_H);
  let head = 0, tail = 0;
  const start = gy0 * MAP_W + gx0;
  visited[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const at = queue[head++];
    const x = at % MAP_W, y = (at / MAP_W) | 0;
    if (at !== start) {
      const cx = x + 0.5, cy = y + 0.5;
      if (!hasLOS(cx, cy, px, py)) return { x: cx, y: cy };
    }
    for (const [dx, dy] of RELOCATE_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      if (cellAt(nx, ny)) continue;            // wall or door — stay in-room
      if (occupied.has(nx + ',' + ny)) continue;
      const ni = ny * MAP_W + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return null;
}

function parseLevel(src) {
  MAP_H = src.length;
  MAP_W = src[0].length;
  grid = [];
  enemies = []; items = []; doorList = []; secretList = []; movingSecrets = [];
  decals = [];
  totalTreasure = 0; treasureFound = 0;
  boss = null;
  const spawns = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = new Array(MAP_W).fill(0);
    for (let x = 0; x < MAP_W; x++) {
      const ch = src[y][x];
      const seed = (((x * 91) ^ (y * 17) ^ 0x9E3779B1) * 2654435761) >>> 0;
      switch (ch) {
        case '#': row[x] = { tag: 'panel',  h: WALL_H, seed }; break;
        case '|': row[x] = { tag: 'window', h: WALL_H, seed }; break;
        case 'X': row[x] = { tag: 'exit',   h: WALL_H, seed }; break;
        case 'N': row[x] = { tag: 'neon',   h: WALL_H, seed,
                             signColor: NEON_PAL[(seed >>> 5) % NEON_PAL.length] }; break;
        case 'D': case 'R': case 'B': {
          const lock = ch === 'R' ? 'red' : ch === 'B' ? 'blue' : null;
          const d = mkDoor(lock);
          d.gx = x; d.gy = y;
          row[x] = d; doorList.push(d);
          break;
        }
        case 'S': {
          const sec = mkSecret(x, y, seed);
          row[x] = sec; secretList.push(sec);
          break;
        }
        // bodies are collected, not built, because how many of them actually
        // appear is a difficulty question — see populateEnemies below
        case 'g': spawns.push(['guard', x + 0.5, y + 0.5]); break;
        case 'd': spawns.push(['drone', x + 0.5, y + 0.5]); break;
        case 'C': spawns.push(['ceo',   x + 0.5, y + 0.5]); break;
        case '+': items.push(mkItem('health',  x + 0.5, y + 0.5)); break;
        case 'a': items.push(mkItem('ammo',    x + 0.5, y + 0.5)); break;
        case 'r': items.push(mkItem('keyRed',  x + 0.5, y + 0.5)); break;
        case 'b': items.push(mkItem('keyBlue', x + 0.5, y + 0.5)); break;
        case '$': items.push(mkItem('cash',    x + 0.5, y + 0.5)); totalTreasure++; break;
        case '@': player.x = x + 0.5; player.y = y + 0.5; break;
      }
    }
    grid.push(row);
  }
  // A door is a thin slab standing at the tile CENTRE, so it has to know which
  // way it faces. Solid cells north and south mean you walk through east-west:
  // the plane sits at constant x (axis 0) and the slab retracts along y, into
  // one of those two walls. This runs after the grid is built rather than
  // inside the loop above because cellAt has to be able to see the row below.
  //
  // Deriving the axis here is also what fixes the view-dependent slide.
  // `wallX` taken along the door's own axis is a world coordinate, the same
  // from either side; taken from the hit face — which is what castGrid used to
  // do — it ran along opposite axes depending on which way you approached, so
  // the same door appeared to retract left from one side and right from the
  // other. validate-level.js enforces exactly one flanked axis per door: a
  // free-standing one would default to 1 and be see-through from oblique
  // angles while blockAt still held the whole tile.
  for (const d of doorList) {
    d.axis = (cellAt(d.gx, d.gy - 1) && cellAt(d.gx, d.gy + 1)) ? 0 : 1;
    // The two cells it retracts into are the reveal you see once it opens.
    // Flagging them lets drawWalls tint them steel so the recess reads as a
    // frame. A secret push-wall beside a door keeps its panelling — a jamb
    // tint would give away that it is not an ordinary wall.
    const jx = d.axis === 0 ? 0 : 1, jy = d.axis === 0 ? 1 : 0;
    for (const s of [-1, 1]) {
      const n = cellAt(d.gx + jx * s, d.gy + jy * s);
      if (n && n.tag === 'panel' && !n.secret) n.jamb = true;
    }
  }

  populateEnemies(spawns);
  totalEnemies = enemies.length;
  totalSecrets = secretList.length;
  secretsFound = 0;
  // sized with the map, so a floor of a different shape cannot read a stale field
  navDist = new Int32Array(MAP_W * MAP_H).fill(-1);
  navQueue = new Int32Array(MAP_W * MAP_H);   // hoisted: the field rebuilds ~3x a second
  seen = new Uint8Array(MAP_W * MAP_H);       // the auto-map starts every floor blind
  navSeedX = navSeedY = -1;
  navRebuildT = 0;
}

/**
 * Start (or restart) a floor.
 * @param {number} [n]      index into LEVELS; defaults to the current floor
 * @param {boolean} [carry] true when descending — health, ammo and score
 *                          come with you, the way they do in Wolf3D. A cold
 *                          start resets them.
 */
function startLevel(n, carry) {
  levelIndex = Math.max(0, Math.min(LEVELS.length - 1,
                                    n === undefined ? levelIndex : n));
  parseLevel(LEVELS[levelIndex]);
  player.a = -Math.PI / 2;
  if (!carry) { player.hp = 100; player.ammo = 24; player.score = 0; player.weapon = PISTOL; resetWeapons(); }
  // kills and keycards are per-floor even on a descent: the ratio on the
  // tally screen is this floor's, and last floor's keys open nothing here
  player.kills = 0;
  player.keyRed = false; player.keyBlue = false;
  player.fireCd = 0; player.bob = 0; player.hurtT = 0; player.flashT = 0;
  player.reloadT = 0; player.windT = 0;
  player.reloadMax = curWeapon().reload || RELOAD_TIME;
  player.clip = Math.min(curWeapon().clip, player.ammo);
  dmgPops = [];
  hitDirs = [];
  resetHpShown();
  gameState = 'playing';
  levelTime = 0;
  resetGun();
  hideBanner();
  hideTally();
  syncHud();
}

function nextLevel() {
  if (levelIndex + 1 >= LEVELS.length) return false;
  startLevel(levelIndex + 1, true);
  sfx('door');
  toast('FLOOR ' + (levelIndex + 1) + '  ·  ' + FLOOR_NAMES[levelIndex]);
  return true;
}
