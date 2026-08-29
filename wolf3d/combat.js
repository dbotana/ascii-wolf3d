'use strict';

// Shooting, the magazine cycle, floating damage numbers, and pickups.

// ─── COMBAT ─────────────────────────────────────────────────
// Reserve rounds live in player.ammo; player.clip is what is actually seated.
// Firing empties the clip, then the reload cycle moves reserve into it.
function startReload() {
  if (player.reloadT > 0) return false;
  if (player.clip >= CLIP_SIZE) return false;
  if (player.ammo - player.clip <= 0) return false;   // nothing in reserve
  player.reloadT = RELOAD_TIME;
  sfx('reload');
  return true;
}

function stepReload(dt) {
  if (player.reloadT <= 0) return;
  player.reloadT -= dt;
  if (player.reloadT <= 0) {
    player.reloadT = 0;
    player.clip = Math.min(CLIP_SIZE, player.ammo);
    sfx('reloadDone');
    syncHud();
  }
}

function fire() {
  if (gameState !== 'playing') return;
  if (player.reloadT > 0) return;
  if (player.fireCd > 0) return;
  if (player.clip <= 0) {
    // auto-reload if there is anything left in reserve, otherwise dry-click
    if (!startReload()) { sfx('dry'); player.fireCd = 0.25; }
    return;
  }
  player.clip--;
  player.ammo--;
  player.fireCd = 0.28;
  player.flashT = 0.09;
  triggerGunFire();
  sfx('shot');
  syncHud();

  const cosA = Math.cos(player.a), sinA = Math.sin(player.a);
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const ex = e.x - player.x, ey = e.y - player.y;
    const depth = ex * cosA + ey * sinA;
    if (depth <= 0.35 || depth >= MAX_DEPTH) continue;
    const lateral = -ex * sinA + ey * cosA;
    const { centerCol, halfW } = spriteSpan(depth, lateral, SPR[e.type].wW);
    if (Math.abs(centerCol - COLS / 2) > halfW) continue;
    if (!hasLOS(player.x, player.y, e.x, e.y)) continue;
    if (depth < bestD) { bestD = depth; best = e; }
  }
  if (!best) return;

  const dmg = 22 + Math.floor(Math.random() * 20);
  best.hp -= dmg;
  if (best.hp <= 0) {
    addDmgPop(best, dmg, true);
    best.alive = false;
    best.state = 'dying';
    best.stateT = 0;
    player.kills++;
    player.score += KILL_SCORE[best.type] || 150;
    dropLoot(best);
    sfx('kill');
    syncHud();
  } else {
    addDmgPop(best, dmg, false);
    best.state = 'hurt';
    best.stateT = 0.22;
    sfx('hit');
  }
  // gunfire wakes the neighbourhood
  alertNear(player.x, player.y, 9);
}

// ─── DAMAGE NUMBERS ─────────────────────────────────────────
// Each pop is anchored to the enemy's world position, then rises and fades
// in screen space. Depth-tested against the wall zbuffer like any sprite.
function addDmgPop(e, dmg, killing) {
  dmgPops.push({
    x: e.x, y: e.y,
    text: killing ? String(dmg) + '!' : String(dmg),
    kill: killing,
    // stagger sideways so rapid hits on one enemy don't stack illegibly
    jitter: (Math.random() - 0.5) * 0.45,
    t: 0, life: killing ? 1.15 : 0.85,
  });
  if (dmgPops.length > 24) dmgPops.shift();
}

function stepDmgPops(dt) {
  for (let i = dmgPops.length - 1; i >= 0; i--) {
    const p = dmgPops[i];
    p.t += dt;
    if (p.t >= p.life) dmgPops.splice(i, 1);
  }
}

function drawDmgPops(zbuf, horizon) {
  const cosA = Math.cos(player.a), sinA = Math.sin(player.a);
  for (const p of dmgPops) {
    const ex = p.x - player.x, ey = p.y - player.y;
    const depth = ex * cosA + ey * sinA;
    if (depth <= 0.4 || depth >= MAX_DEPTH) continue;
    const lateral = -ex * sinA + ey * cosA;
    const pph = PPH / depth;
    const u = p.t / p.life;

    const centerCol = COLS / 2 + ((lateral + p.jitter) / depth) * FOCAL;
    // start near the head, ease upward, decelerating
    const rise = (1 - (1 - u) * (1 - u)) * (pph * 0.9 + 3);
    const baseRow = horizon + pph * (EYE_Z - 1.5) - rise;

    const col0 = Math.round(centerCol - p.text.length / 2);
    const row  = Math.round(baseRow);
    if (row < 0 || row >= ROWS) continue;

    const alpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
    const rgb = p.kill ? '255,59,124' : '255,233,168';
    const color = 'rgba(' + rgb + ',' + (alpha * 0.95).toFixed(2) + ')';
    // a dark row underneath keeps the digits readable over bright walls
    const shadow = 'rgba(2,3,10,' + (alpha * 0.75).toFixed(2) + ')';
    for (let i = 0; i < p.text.length; i++) {
      const col = col0 + i;
      if (col < 0 || col >= COLS) continue;
      if (depth > zbuf[col] + 0.4) continue;   // behind a wall
      drawChar(col, row + 1, p.text[i], shadow);
      drawChar(col, row, p.text[i], color);
    }
  }
}

// ─── ITEMS ──────────────────────────────────────────────────
function stepItems(dt) {
  if (gameState !== 'playing') return;
  for (const it of items) {
    if (it.taken) continue;
    it.bob += dt * 2.2;
    if (Math.hypot(it.x - player.x, it.y - player.y) > 0.62) continue;
    switch (it.kind) {
      case 'health':
        if (player.hp >= 100) continue;
        player.hp = Math.min(100, player.hp + 25);
        toast('INSTANT RAMEN  +25 HP'); break;
      case 'ammo':
        if (player.ammo >= 99) continue;
        player.ammo = Math.min(99, player.ammo + CLIP_SIZE);
        // picking up with an empty gun seats a clip straight away
        if (player.clip <= 0 && player.reloadT <= 0) startReload();
        toast('BATTERY CELL  +' + CLIP_SIZE + ' AMMO'); break;
      case 'cash':
        player.score += 500;
        treasureFound++;
        toast('CRYPTO WALLET  +500'); break;
      case 'keyRed':
        player.keyRed = true;
        toast('RED KEYCARD ACQUIRED'); break;
      case 'keyBlue':
        player.keyBlue = true;
        toast('BLUE KEYCARD ACQUIRED'); break;
    }
    it.taken = true;
    sfx(it.kind === 'keyRed' || it.kind === 'keyBlue' ? 'key' : 'pickup');
    syncHud();
  }
}
