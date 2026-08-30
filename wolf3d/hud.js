'use strict';

// The DOM half of the interface: toasts, banners, the status bar with its
// weapon strip and objective line, and the health bar with its lagging chip
// layer. The end-of-floor screen used to live here too and is now tally.js.
//
// This and tally.js are the only files that write DOM outside the canvas.
// Gameplay code calls syncHud() directly rather than going through an event bus
// — deliberately: the calls are one line each and the indirection would buy
// nothing.

// ─── HUD / BANNERS ──────────────────────────────────────────
const promptEl = document.getElementById('prompt');
const toastEl  = document.getElementById('toast');
const bannerEl = document.getElementById('banner');
const el = id => document.getElementById(id);
let toastT = 0;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastT = 2.0;
}
function stepToast(dt) {
  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) toastEl.classList.remove('show');
  }
}

function faceFor(hp) {
  if (hp <= 0)  return FACES[5];
  if (hp > 80)  return FACES[0];
  if (hp > 60)  return FACES[1];
  if (hp > 40)  return FACES[2];
  if (hp > 20)  return FACES[3];
  return FACES[4];
}

// ─── HEALTH BAR ─────────────────────────────────────────────
// hpShown is the lagging "chip" value: it snaps to nothing on a hit and then
// drains down to the real HP, which is what makes the loss legible.
let hpShown = 100, hpFlashT = 0;

// world.js resets the chip on a floor start; enemies.js latches it to the
// pre-hit value so the drain has something to drain from. Both go through
// these rather than writing hpShown across a file boundary.
function resetHpShown() { hpFlashT = 0; hpShown = player.hp; }
function chipHpFromNow() { hpShown = Math.max(hpShown, player.hp); }

function pulseHpBar() {
  const bar = el('hpBar');
  if (!bar) return;
  hpFlashT = 0.42;
  bar.classList.remove('hp-hit');
  void bar.offsetWidth;          // restart the keyframes
  bar.classList.add('hp-hit');
}

function stepHpBar(dt) {
  if (hpFlashT > 0) {
    hpFlashT -= dt;
    if (hpFlashT <= 0) el('hpBar').classList.remove('hp-hit');
  }
  if (hpShown > player.hp) {
    // hold briefly, then drain ~60hp/s so the red wedge is readable
    hpShown = Math.max(player.hp, hpShown - dt * 60);
    paintHpBar();
  } else if (hpShown < player.hp) {
    hpShown = Math.min(player.hp, hpShown + dt * 90);
    paintHpBar();
  }
}

function paintHpBar() {
  const pct  = Math.max(0, Math.min(100, player.hp));
  const chip = Math.max(pct, Math.min(100, hpShown));
  el('hpFill').style.width = pct + '%';
  el('hpChip').style.width = chip + '%';
  el('hpFill').classList.toggle('low', pct <= 25);
  // screen border reddens as health falls: nothing at full, strong near death
  const t = 1 - pct / 100;
  el('hpVignette').style.opacity = (t * t * 0.9).toFixed(3);
}

function syncHud() {
  el('sFloor').textContent = String(levelIndex + 1);
  el('sScore').textContent = String(player.score).padStart(6, '0');
  el('sKills').textContent = player.kills + '/' + totalEnemies;
  el('sSecrets').textContent = secretsFound + '/' + totalSecrets;
  el('sTreasure').textContent = treasureFound + '/' + totalTreasure;
  const meta = el('floorName');
  if (meta) meta.textContent = 'neon reich \u00b7 floor ' + (levelIndex + 1) +
                               ' \u00b7 ' + FLOOR_NAMES[levelIndex].toLowerCase() +
                               ' \u00b7 ' + DIFFICULTY[difficulty].name.toLowerCase();
  el('sHp').textContent   = player.hp;
  const w = curWeapon();
  paintWeaponStrip();
  paintObjective();
  // a weapon that costs no ammo has no magazine to report, and must not read
  // as permanently empty
  el('sAmmo').textContent = w.cost <= 0 ? '--'
    : player.reloadT > 0 ? '--/' + player.ammo
    : player.clip + '/' + player.ammo;
  el('sHp').classList.toggle('low', player.hp <= 25);
  paintHpBar();
  el('sAmmo').classList.toggle('low', w.cost > 0 && player.clip <= 2);
  el('sFace').textContent = faceFor(player.hp);
  const ks = el('sKeys').children;
  ks[0].classList.toggle('on', player.keyRed);
  ks[1].classList.toggle('on', player.keyBlue);
  paintBossBar();
}

/**
 * The four weapon slots under the status bar.
 *
 * The game shipped showing one name, which is exactly why a whole playthrough
 * could end on the pistol: nothing ever said the other three existed. A locked
 * slot shows what it costs instead of what it is, so the strip doubles as the
 * progress bar toward the next gun — and the number on it is the number the
 * key press quotes back at you.
 */
function paintWeaponStrip() {
  const slots = el('sWeapons');
  if (!slots) return;
  for (let i = 0; i < slots.children.length; i++) {
    const s = slots.children[i];
    const w = WEAPONS[i];
    if (!w) { s.textContent = ''; continue; }
    const owned = !!player.weapons[i];
    s.textContent = owned ? (i + 1) + ' ' + w.name
                          : player.runKills + '/' + WEAPON_UNLOCK[i];
    s.classList.toggle('on', owned && i === player.weapon);
    s.classList.toggle('owned', owned && i !== player.weapon);
    s.classList.toggle('locked', !owned);
    // the touch row is the same three states, painted from the same place —
    // four identical buttons, three of which silently do nothing, is the touch
    // half of the bug the strip exists to fix
    const tw = el('tW' + i);
    if (tw) {
      tw.classList.toggle('on', owned && i === player.weapon);
      tw.classList.toggle('owned', owned && i !== player.weapon);
      tw.classList.toggle('locked', !owned);
    }
  }
}

/**
 * What you are for on this floor.
 *
 * Derived from the parsed level rather than from per-floor data: doorList
 * knows which locks this map actually has, so a floor with no blue door never
 * asks for a blue keycard and a rewritten map needs no new table. It names the
 * goal and never the route — the brief was to hold the player\u2019s hand, not to
 * walk them down the corridor.
 */
function objectiveText() {
  const needs = lock => doorList.some(d => d.lock === lock);
  if (needs('red')  && !player.keyRed)  return 'FIND THE RED KEYCARD';
  if (needs('blue') && !player.keyBlue) return 'FIND THE BLUE KEYCARD';
  if (boss && boss.alive)               return 'THE BOARD IS IN SESSION \u2014 KILL THE CEO';
  return 'RIDE THE ELEVATOR OUT';
}

function paintObjective() {
  const o = el('objective');
  if (!o) return;
  // only while a floor is actually in play: a tally or a death banner is not
  // the moment to be told what to do next
  const show = gameState === 'playing';
  if (show) o.textContent = objectiveText();
  o.classList.toggle('show', show);
}

// The bar stays hidden until the CEO has actually noticed you, so walking in
// does not spoil the reveal, and drops away the moment it dies.
function paintBossBar() {
  const bar = el('bossBar');
  const live = boss && boss.alive && boss.state !== 'idle' && gameState === 'playing';
  bar.classList.toggle('show', !!live);
  if (!live) return;
  const frac = Math.max(0, boss.hp / boss.maxHp);
  el('bossFill').style.width = (frac * 100).toFixed(1) + '%';
  el('bossPhase').textContent = CEO_PHASES[boss.phase].name;
}

function showBanner(title, body, hint, fail) {
  el('bTitle').textContent = title;
  el('bBody').textContent  = body;
  el('bHint').textContent  = hint;
  bannerEl.classList.toggle('fail', !!fail);
  bannerEl.classList.add('show');
}
function hideBanner() { bannerEl.classList.remove('show'); }

// A run ends here or in killPlayer, and nowhere else. Restarting with P is
// deliberately not a record point: startLevel's cold path zeroes the score, so
// filing one there would enter a partial run and then file the real one again.
function winGame() {
  gameState = 'won';
  hideTally();
  sfx('clear');
  const rank = recordScore(player.score, levelIndex + 1, difficulty, true);
  showBanner('OUT',
    'YOU RESIGN, WITH PREJUDICE  ·  FINAL SCORE ' +
    String(player.score).padStart(6, '0'),
    rank >= 0 ? 'NEW HIGH SCORE  #' + (rank + 1) + '  ·  press P to start over'
              : 'press P to start over', false);
  if (rank >= 0) sfx('key');
  paintScores();
}

function killPlayer() {
  gameState = 'dead';
  if (document.exitPointerLock) document.exitPointerLock();
  sfx('die');
  // hurtPlayer gates on gameState === 'playing', so this runs exactly once per
  // death and needs no latch of its own.
  const rank = recordScore(player.score, levelIndex + 1, difficulty, false);
  showBanner('TERMINATED',
    'YOUR EMPLOYMENT HAS BEEN CONCLUDED ON FLOOR ' + (levelIndex + 1) +
    '  ·  SCORE ' + String(player.score).padStart(6, '0'),
    rank >= 0 ? 'NEW HIGH SCORE  #' + (rank + 1) + '  ·  press P or E to retake the floor'
              : 'press P or E to retake the floor', true);
  if (rank >= 0) sfx('key');
  paintScores();
}

function updatePrompt() {
  if (gameState !== 'playing') { promptEl.classList.remove('show'); return; }
  const f = frontCell();
  if (!f) { promptEl.classList.remove('show'); return; }
  const c = f.cell;
  let msg = null;
  if (c.tag === 'door' && c.phase === 'closed') {
    msg = c.lock ? c.lock.toUpperCase() + ' DOOR' +
                   (hasKey(c.lock) ? '  [E] OPEN' : '  — LOCKED')
                 : '[E] OPEN';
  } else if (c.tag === 'exit') {
    msg = (boss && boss.alive) ? 'ELEVATOR — HELD BY THE BOARD'
        : levelIndex + 1 >= LEVELS.length ? 'ELEVATOR  [E] SURFACE'
        : 'ELEVATOR  [E] DESCEND';
  }
  if (msg) { promptEl.textContent = msg; promptEl.classList.add('show'); }
  else promptEl.classList.remove('show');
}
