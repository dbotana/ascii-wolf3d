'use strict';

// The world: the tile grid, the entities in it, and everything that mutates
// them. Level parsing and floor lifecycle, the grid queries the raycaster and
// the AI both read, sliding doors, and push-wall secrets.

// ─── LEVEL STATE ────────────────────────────────────────────
let grid, MAP_W, MAP_H;
let enemies = [], items = [], doorList = [];
let secretList = [], movingSecrets = [];
let totalEnemies = 0, totalSecrets = 0, secretsFound = 0;
// BFS flow field over the tile grid, seeded at the player — see NAVIGATION
let navDist = null, navQueue = null, navRebuildT = 0, navSeedX = -1, navSeedY = -1;
// the auto-map's exploration record: 1 where the player has stood or looked.
// Sized with the map in parseLevel, like navDist, so a floor of a different
// shape cannot read a stale one. See wolf3d/minimap.js.
let seen = null;
// treasure is the crypto wallets only — the generic item loop also runs over
// ramen, cells and keycards, and dropLoot() appends to `items` mid-level, so
// the denominator has to be fixed at parse time from the '$' tiles alone
let totalTreasure = 0, treasureFound = 0;

const player = {
  x: 20.5, y: 38.5, a: -Math.PI / 2,
  hp: 100, ammo: 24, score: 0, kills: 0,
  keyRed: false, keyBlue: false,
  fireCd: 0, bob: 0, hurtT: 0, flashT: 0,
  reloadT: 0, clip: CLIP_SIZE,
  // Which weapon is up, and which ones you own. You start with the knife and
  // the pistol; the SMG and the chaingun are earned — see WEAPON_UNLOCK and
  // checkWeaponUnlock(). selectWeapon refuses any index that is 0 here.
  weapon: PISTOL, weapons: [1, 1, 0, 0],
  // Kills for the whole RUN, which is what buys guns. Deliberately NOT
  // player.kills: startLevel zeroes that every floor because the tally reports
  // a per-floor ratio, so spending it here would reset your progress toward
  // the next weapon on every descent.
  runKills: 0,
  // reloadMax latches the current weapon's cycle length so the view-model
  // animation stays correct for magazines that take longer than the pistol's.
  reloadMax: RELOAD_TIME,
  windT: 0,            // chaingun spin-up, in seconds of held trigger
};

// floating damage numbers over enemies we just shot
let dmgPops = [];
// where the shots that hit US came from, for the direction arc
let hitDirs = [];
// blood left where a body fell — see spillBlood in enemies.js
let decals = [];

let gameState = 'playing';   // playing | paused | dead | cleared | won

// ─── PAUSE ──────────────────────────────────────────────────
// Nearly free, because movement, firing, enemies, items, nav, mouse-look and
// the gun view-model already gate on gameState. What pause adds on top is
// frame()'s skip of the handful of steppers that never checked anything —
// doors, secrets, the gun, the reload cycle, the damage pops and the hp chip.
//
// Only a floor in play can be paused. Pausing a dead or cleared one would
// bury the banner that state is already showing, and resuming would hand
// control back to a game that has none.
function pauseGame() {
  if (gameState !== 'playing') return false;
  gameState = 'paused';
  // Releasing the mouse is the point of pausing for most players. It also
  // re-enters through pointerlockchange below, which is harmless: that handler
  // only ever pauses a floor that is still 'playing'.
  if (document.exitPointerLock) document.exitPointerLock();
  showBanner('PAUSED', 'THE MEETING IS ON HOLD',
             'press ESC · E · SPACE to resume', false);
  return true;
}
function resumeGame() {
  if (gameState !== 'paused') return false;
  gameState = 'playing';
  hideBanner();
  return true;
}
function togglePause() {
  return gameState === 'paused' ? resumeGame() : pauseGame();
}

// Chosen once on the splash and then left alone. This is a RUN-level setting,
// not player state: startLevel deliberately does not reset it, on either the
// carry path or the cold restart, because dying on floor 3 should not quietly
// put you back on the default.
let difficulty = DIFF_DEFAULT;
function setDifficulty(n) {
  difficulty = Math.max(0, Math.min(DIFFICULTY.length - 1, n | 0));
  return difficulty;
}
let levelTime = 0;
let levelIndex = 0;          // which floor of LEVELS we are on
let boss = null;             // the CEO, once a floor places one

// `axis` is which way the slab faces: 0 puts its plane at constant x, so you
// walk through east-west and the door retracts along y; 1 is the other way
// round. parseLevel derives it from the flanking walls — the 1 here is only
// what a door built outside a level would get.
function mkDoor(lock) {
  return { tag: 'door', h: WALL_H, lock, open: 0, phase: 'closed', timer: 0,
           seed: 7, axis: 1 };
}
// a push-wall is an ordinary panel until someone leans on it: same seed, same
// colour, same glyph ramp, so it is indistinguishable from the wall it sits in
function mkSecret(x, y, seed) {
  return { tag: 'panel', h: WALL_H, seed, secret: true,
           gx: x, gy: y, dx: 0, dy: 0, push: 0, span: 0, phase: 'idle' };
}
function mkEnemy(type, x, y) {
  // The CEO is tuned as a fight, not an obstacle: enough hp to need three
  // magazines, enough reach that backing off is not a free answer, and a
  // standoff of its own so it never simply walks into your muzzle.
  const spec = type === 'ceo'
    ? { hp: 520, speed: 1.10, range: 12.0, cd: 1.40, dmg: 16, sight: 20 }
    : type === 'guard'
    ? { hp: 45, speed: 1.35, range: 9.5, cd: 1.15, dmg: 11, sight: 15 }
    : { hp: 28, speed: 2.10, range: 7.0, cd: 0.85, dmg:  7, sight: 13 };
  return {
    type, x, y, spawnX: x, spawnY: y,
    hp: spec.hp, maxHp: spec.hp, spec,
    state: 'idle', stateT: 0, atkCd: 0, bob: Math.random() * 6.28,
    alive: true,
    // A freshly spawned body gives the player a beat to reach cover before it
    // starts looking for them — see the idle sight check in enemies.js. It
    // exists separately from stateT because that field is reused for the alert
    // window, and a spawn grace is a different thing from a reaction delay.
    graceT: SPAWN_GRACE,
    // which way the body is facing, in world radians. Set wherever the enemy
    // moves; seeded rather than left undefined so enemySprite can rotate a
    // guard that has never taken a step.
    heading: -Math.PI / 2,
    patrolDir: null, patrolT: Math.random() * 1.2, patrolTX: 0, patrolTY: 0,
    phase: 0, burst: 1, shotsLeft: 1,
    want: type === 'ceo' ? CEO_PHASES[0].want : undefined,
  };
}
function mkItem(kind, x, y) {
  return { kind, x, y, taken: false, bob: Math.random() * 6.28 };
}

// ─── GRID QUERIES ───────────────────────────────────────────
// Is this tile on the floor at all? Five callers ran the same four comparisons
// inline; nav.js and minimap.js index flat arrays off it, where an out-of-range
// tile reads a neighbouring row rather than nothing.
function inMap(x, y) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }

// Which keycard a lock wants. An ordinary door (`null`) wants none, so callers
// can ask this about any door without testing for a lock first.
function hasKey(lock) {
  return lock === 'red' ? player.keyRed : lock === 'blue' ? player.keyBlue : true;
}

function cellAt(x, y) {
  if (!inMap(x, y)) return 0;
  return grid[y][x];
}
// solid for movement — an open-enough door lets bodies through
function blockAt(wx, wy) {
  if (movingSecrets.length && inSlab(wx, wy)) return true;
  const c = cellAt(wx | 0, wy | 0);
  if (!c) return false;
  if (c.tag === 'door') return c.open < 0.65;
  return true;
}

// is a world point inside a push-wall that is mid-slide?
function inSlab(wx, wy) {
  for (const s of movingSecrets) {
    const ox = s.gx + s.dx * s.push, oy = s.gy + s.dy * s.push;
    if (wx >= ox && wx < ox + 1 && wy >= oy && wy < oy + 1) return true;
  }
  return false;
}

// A sliding push-wall straddles two cells, which the tile DDA cannot express,
// so it is intersected as a plain 1x1 box and the nearer of the two hits wins.
// Only ever runs while a wall is actually in motion — under a second, once.
function castSecrets(px, py, angle, best) {
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  let out = null;
  for (const s of movingSecrets) {
    const bx = s.gx + s.dx * s.push, by = s.gy + s.dy * s.push;
    let tx0 = (bx - px) / cosA, tx1 = (bx + 1 - px) / cosA;
    if (tx0 > tx1) { const t = tx0; tx0 = tx1; tx1 = t; }
    let ty0 = (by - py) / sinA, ty1 = (by + 1 - py) / sinA;
    if (ty0 > ty1) { const t = ty0; ty0 = ty1; ty1 = t; }
    const tIn = Math.max(tx0, ty0), tOut = Math.min(tx1, ty1);
    if (tOut < 0 || tIn > tOut) continue;               // ray misses the slab
    const d = Math.max(0.02, tIn);                      // 0 when we are inside it
    if (d >= best) continue;
    const side = tx0 > ty0 ? 0 : 1;
    const w = side === 0 ? (py + d * sinA) - by : (px + d * cosA) - bx;
    out = { dist: d, cell: s, side, mapX: bx | 0, mapY: by | 0,
            wallX: Math.min(0.999, Math.max(0, w)) };
    best = d;
  }
  return out;
}

function castRay(px, py, angle, maxD) {
  const hit = castGrid(px, py, angle, maxD);
  if (!movingSecrets.length) return hit;
  return castSecrets(px, py, angle, hit.dist) || hit;
}

// ─── DOORS ──────────────────────────────────────────────────
function occupied(gx, gy) {
  if ((player.x | 0) === gx && (player.y | 0) === gy) return true;
  for (const e of enemies) {
    if (e.alive && (e.x | 0) === gx && (e.y | 0) === gy) return true;
  }
  return false;
}

// An uncollected pickup makes a tile off-limits to anything that turns it
// solid: `blockAt` would keep the player out and `stepItems` needs them
// within 0.62u, so a slab parked on top of one seals it away for good.
function itemAt(gx, gy) {
  for (const it of items) {
    if (!it.taken && (it.x | 0) === gx && (it.y | 0) === gy) return true;
  }
  return false;
}

function stepDoors(dt) {
  for (const d of doorList) {
    if (d.phase === 'opening') {
      d.open = Math.min(1, d.open + dt / 0.4);
      if (d.open >= 1) { d.phase = 'open'; d.timer = 4.0; }
    } else if (d.phase === 'open') {
      d.timer -= dt;
      if (d.timer <= 0) {
        // never close on top of the player or a body in the frame
        if (occupied(d.gx, d.gy)) d.timer = 1.0;
        else d.phase = 'closing';
      }
    } else if (d.phase === 'closing') {
      d.open = Math.max(0, d.open - dt / 0.5);
      if (d.open <= 0) d.phase = 'closed';
    }
  }
}

// ─── SECRET PUSH-WALLS ──────────────────────────────────────
const SECRET_SPEED = 1.8;      // tiles/sec — two tiles in a beat over a second

// nothing may end up sealed inside the slab: shove it out the back, into the
// cell the wall has just vacated, which is the one side guaranteed to be clear
function shoveClear(body, ox, oy, s) {
  if (body.x < ox || body.x >= ox + 1 || body.y < oy || body.y >= oy + 1) return;
  if      (s.dx > 0) body.x = ox - 0.3;
  else if (s.dx < 0) body.x = ox + 1.3;
  else if (s.dy > 0) body.y = oy - 0.3;
  else               body.y = oy + 1.3;
}

function stepSecrets(dt) {
  for (let i = movingSecrets.length - 1; i >= 0; i--) {
    const s = movingSecrets[i];
    s.push = Math.min(s.span, s.push + dt * SECRET_SPEED);
    const ox = s.gx + s.dx * s.push, oy = s.gy + s.dy * s.push;
    shoveClear(player, ox, oy, s);
    for (const e of enemies) if (e.alive) shoveClear(e, ox, oy, s);
    if (s.push >= s.span) {
      // landed: hand the slab back to the grid as an ordinary solid cell
      s.gx += s.dx * s.span; s.gy += s.dy * s.span;
      s.push = 0; s.span = 0; s.phase = 'done';
      grid[s.gy][s.gx] = s;
      movingSecrets.splice(i, 1);
    }
  }
}

// travels along whichever axis you are facing, up to two tiles, stopping short
// of anything solid, anyone alive, or any pickup still on the floor
function pushSecret(s) {
  const fx = Math.cos(player.a), fy = Math.sin(player.a);
  let dx = 0, dy = 0;
  if (Math.abs(fx) > Math.abs(fy)) dx = fx > 0 ? 1 : -1;
  else                             dy = fy > 0 ? 1 : -1;
  let span = 0;
  for (let n = 1; n <= 2; n++) {
    const nx = s.gx + dx * n, ny = s.gy + dy * n;
    if (!inMap(nx, ny)) break;
    if (cellAt(nx, ny) || occupied(nx, ny) || itemAt(nx, ny)) break;
    span = n;
  }
  if (!span) return;           // wedged — stay silent rather than give it away
  s.dx = dx; s.dy = dy; s.span = span; s.push = 0; s.phase = 'moving';
  grid[s.gy][s.gx] = 0;
  movingSecrets.push(s);
  secretsFound++;
  sfx('secret');
  toast('SECRET AREA  ' + secretsFound + '/' + totalSecrets);
  syncHud();
}

function frontCell() {
  for (const reach of [0.6, 1.1, 1.6]) {
    const wx = player.x + Math.cos(player.a) * reach;
    const wy = player.y + Math.sin(player.a) * reach;
    const c = cellAt(wx | 0, wy | 0);
    if (c) return { cell: c, x: wx | 0, y: wy | 0 };
  }
  return null;
}

function use() {
  if (gameState === 'paused')  { resumeGame(); return; }
  if (gameState === 'cleared') { advanceFromTally(); return; }
  if (gameState === 'won')     { startLevel(0); return; }
  if (gameState === 'dead')    { startLevel(levelIndex); return; }
  const f = frontCell();
  if (!f) return;
  const c = f.cell;
  if (c.tag === 'door') {
    if (c.phase === 'opening' || c.phase === 'open') { c.timer = 4.0; return; }
    if (!hasKey(c.lock)) {
      toast('SEALED — NEEDS ' + c.lock.toUpperCase() + ' KEYCARD'); sfx('deny'); return;
    }
    c.phase = 'opening';
    sfx('door');
  } else if (c.secret && c.phase === 'idle') {
    pushSecret(c);
  } else if (c.tag === 'exit') {
    // the CEO holds the elevator: no leaving the floor while the board sits
    if (boss && boss.alive) { toast('THE BOARD IS STILL IN SESSION'); sfx('deny'); return; }
    clearLevel();
  }
}
