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
}

function parseLevel(src) {
  MAP_H = src.length;
  MAP_W = src[0].length;
  grid = [];
  enemies = []; items = []; doorList = []; secretList = []; movingSecrets = [];
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
  populateEnemies(spawns);
  totalEnemies = enemies.length;
  totalSecrets = secretList.length;
  secretsFound = 0;
  // sized with the map, so a floor of a different shape cannot read a stale field
  navDist = new Int32Array(MAP_W * MAP_H).fill(-1);
  navQueue = new Int32Array(MAP_W * MAP_H);   // hoisted: the field rebuilds ~3x a second
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
  if (!carry) { player.hp = 100; player.ammo = 24; player.score = 0; player.weapon = PISTOL; }
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
