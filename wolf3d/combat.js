'use strict';

// Shooting, the magazine cycle, floating damage numbers, and pickups.

// ─── THE ROSTER ─────────────────────────────────────────────
// WEAPONS lives in weapons.js and is pure data; everything here is the lookup
// the growth rules ask for instead of a branch per weapon.
function curWeapon() { return WEAPONS[player.weapon]; }

/**
 * Put a weapon up. Returns false if the index is out of range or unowned.
 *
 * The clip is TRUNCATED to the new weapon's capacity, never topped up: since
 * player.ammo already counts the seated rounds, the surplus simply falls back
 * into the reserve. That is what stops "switch away and back" from being a
 * free instant reload, which topping up would have made it.
 *
 * The knife is exempt, and that is not cosmetic: its capacity is 0, so
 * truncating would empty the gun you were holding, and switching back would
 * cost you a full reload for having drawn a blade.
 */
function selectWeapon(i) {
  if (gameState !== 'playing') return false;
  if (!(i >= 0 && i < WEAPONS.length)) return false;
  if (!player.weapons[i]) return false;
  if (i === player.weapon) return false;
  player.weapon = i;
  const w = curWeapon();
  if (w.cost > 0) player.clip = Math.min(player.clip, w.clip);
  player.reloadT = 0;            // a switch cancels a reload in flight
  player.reloadMax = w.reload || RELOAD_TIME;
  player.windT = 0;              // and drops any chaingun spin
  player.fireCd = Math.max(player.fireCd, 0.22);   // the raise costs you a beat
  resetGun();
  sfx('swap');
  syncHud();
  return true;
}

// ─── EARNING THE ROSTER ─────────────────────────────────────
//
// The guns are a reward, not a menu. WEAPON_UNLOCK is a column of the WEAPONS
// table, so this is a walk rather than a branch per weapon, and a fifth gun
// needs nothing here.

/**
 * Kills earn guns. Called once per kill from fire()'s death branch.
 *
 * Grants the first unowned weapon the run has paid for and puts it straight
 * up — Wolf3D hands you the gun the moment you find it, and a weapon you have
 * to go and select is a weapon a player never learns they have. One per kill:
 * the thresholds are far enough apart that two can never come due together,
 * and returning keeps the toast readable if they ever are.
 *
 * Ownership is written BEFORE selectWeapon, which refuses an index you do not
 * own. The ammo comes with it because the reserve is sized for the pistol —
 * unlocking a 50-round chaingun over 24 rounds of reserve is under two seconds
 * of trigger, which reads as a broken reward rather than a generous one.
 */
function checkWeaponUnlock() {
  for (let i = 0; i < WEAPONS.length; i++) {
    if (player.weapons[i] || player.runKills < WEAPON_UNLOCK[i]) continue;
    player.weapons[i] = 1;
    player.ammo = Math.min(99, player.ammo + 20);
    toast(WEAPONS[i].name + ' UNLOCKED  \u00b7  PRESS [' + (i + 1) + ']');
    selectWeapon(i);
    return true;
  }
  return false;
}

/**
 * The player-facing wrapper around selectWeapon, and what the number keys and
 * the touch buttons actually call.
 *
 * selectWeapon returns a silent false for four different refusals and the
 * suite and the mutation catalog both pin that contract, so the one refusal a
 * player can act on — "you have not earned it yet" — is answered here instead
 * of inside it. Saying how many kills are left is the whole point: a key that
 * does nothing teaches a player the key does not exist.
 */
function pickWeapon(i) {
  if (selectWeapon(i)) return true;
  if (gameState === 'playing' && WEAPONS[i] && !player.weapons[i]) {
    toast(WEAPONS[i].name + '  \u00b7  ' + player.runKills + '/' + WEAPON_UNLOCK[i] + ' KILLS');
    sfx('deny');
  }
  return false;
}

/** Back to the cold-start loadout. Called by startLevel on a non-carry start. */
function resetWeapons() {
  player.runKills = 0;
  player.weapons = WEAPON_UNLOCK.map(n => (n === 0 ? 1 : 0));
}

// ─── COMBAT ─────────────────────────────────────────────────
// Reserve rounds live in player.ammo; player.clip is what is actually seated.
// Firing empties the clip, then the reload cycle moves reserve into it.
// Capacity and cycle length are per weapon; the knife has neither and is
// filtered out by its cost of 0 before any of this runs.
function startReload() {
  if (player.reloadT > 0) return false;
  const w = curWeapon();
  if (w.cost <= 0) return false;                      // nothing to reload
  if (player.clip >= w.clip) return false;
  if (player.ammo - player.clip <= 0) return false;   // nothing in reserve
  player.reloadMax = w.reload;
  player.reloadT = w.reload;
  sfx('reload');
  return true;
}

function stepReload(dt) {
  if (player.reloadT <= 0) return;
  player.reloadT -= dt;
  if (player.reloadT <= 0) {
    player.reloadT = 0;
    player.clip = Math.min(curWeapon().clip, player.ammo);
    sfx('reloadDone');
    syncHud();
  }
}

// The chaingun's barrels have to come up to speed before anything comes out.
// Driven from frame() with whether the trigger is actually held, so releasing
// it spins back down rather than banking the wind-up for later.
function stepSpin(dt, held) {
  const w = curWeapon();
  if (!w.spinUp) { player.windT = 0; return; }
  if (held && gameState === 'playing') {
    if (player.windT <= 0) sfx('spin');
    player.windT = Math.min(w.spinUp, player.windT + dt);
  } else {
    player.windT = Math.max(0, player.windT - dt * 1.6);
  }
}

function fire() {
  if (gameState !== 'playing') return;
  if (player.reloadT > 0) return;
  if (player.fireCd > 0) return;
  const w = curWeapon();
  if (player.windT < w.spinUp) return;      // barrels not up to speed yet
  if (w.cost > 0) {
    if (player.clip < w.cost) {
      // auto-reload if there is anything left in reserve, otherwise dry-click
      if (!startReload()) { sfx('dry'); player.fireCd = 0.25; }
      return;
    }
    player.clip -= w.cost;
    player.ammo -= w.cost;
  }
  player.fireCd = w.cd;
  player.flashT = w.flash;
  triggerGunFire();
  sfx(w.sfx);
  syncHud();

  // One spread roll per shot, drawn OUTSIDE the candidate loop: rolling per
  // enemy would not be a cone, it would be a hit test that widens with the
  // number of things standing in front of you.
  const aimCol = COLS / 2 + (w.spread ? (Math.random() * 2 - 1) * w.spread : 0);

  const cosA = Math.cos(player.a), sinA = Math.sin(player.a);
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const ex = e.x - player.x, ey = e.y - player.y;
    const depth = ex * cosA + ey * sinA;
    // the far cull matches drawSprites', so you can always shoot what you see
    if (depth <= w.minDepth || depth >= MAX_DEPTH) continue;
    // A melee weapon caps on true distance; a gun does not cap at all. Note
    // this is a RADIUS, not the forward depth above — a body 1.5u to your side
    // is not something you can stab, however far in front of you it projects.
    if (w.reach && Math.hypot(ex, ey) > w.reach) continue;
    const lateral = -ex * sinA + ey * cosA;
    // SPR[e.type], not enemySprite(e): the hit span is the body's, not the
    // view's, so turning sideways never makes a guard harder to shoot. Safe
    // only while every live view keeps the base width — asserted in the suite.
    const { centerCol, halfW } = spriteSpan(depth, lateral, SPR[e.type].wW);
    if (Math.abs(centerCol - aimCol) > halfW) continue;
    if (!hasLOS(player.x, player.y, e.x, e.y)) continue;
    if (depth < bestD) { bestD = depth; best = e; }
  }
  if (!best) return;

  const dmg = w.dmgMin + Math.floor(Math.random() * w.dmgSpan);
  best.hp -= dmg;
  if (best.hp <= 0) {
    addDmgPop(best, dmg, true);
    best.alive = false;
    best.state = 'dying';
    best.stateT = 0;
    player.kills++;
    player.runKills++;
    player.score += KILL_SCORE[best.type] || 150;
    dropLoot(best);
    spillBlood(best);
    sfx('kill');
    checkWeaponUnlock();      // before syncHud, so the strip paints the new gun
    syncHud();
  } else {
    addDmgPop(best, dmg, false);
    best.state = 'hurt';
    best.stateT = 0.22;
    sfx('hit');
  }
  // gunfire wakes the neighbourhood — a blade barely does
  alertNear(player.x, player.y, w.alert);
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

    // Quantised to 8 steps, the same way mix() quantises its blend factor and
    // for the same reason: every distinct (glyph, colour) pair is an atlas
    // entry, and .toFixed(2) on a continuous fade mints a new one per frame.
    // Unquantised this cost ~375 entries over 40 shots against a 32768 cap —
    // never an overflow in play, but it is the exact drift CLAUDE.md warns
    // about, and it is the reason the arc above quantises too.
    const alpha = Math.round((u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3) * 8) / 8;
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
