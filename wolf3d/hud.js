'use strict';

// The DOM half of the interface: toasts, banners, the status bar, the health
// bar with its lagging chip layer, and the end-of-floor tally screen.
//
// This is the only file that writes DOM outside the canvas. Gameplay code calls
// syncHud() directly rather than going through an event bus — deliberately: the
// calls are one line each and the indirection would buy nothing.

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
  el('sWeapon').textContent = w.name;
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

// ─── END-OF-FLOOR TALLY ─────────────────────────────────────
// Wolf3D's percentage screen: the ratios roll up one row at a time with a
// tick per digit, and a category only pays out at a clean 100%.
const PERFECT_BONUS = 2500;    // per category, awarded only at 100%
const TIME_BONUS_PER_SEC = 10; // for every second under par
const ROW_ROLL = 0.85;         // seconds a row takes to count up
const ROW_GAP  = 0.30;         // pause before the next row starts

let tally = null;

function mmss(t) {
  const s = Math.max(0, Math.floor(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 100);

function openTally(finalFloor) {
  const par = PAR_TIME[levelIndex] || 180;
  tally = {
    finalFloor: !!finalFloor,
    par,
    timeBonus: Math.max(0, Math.round(par - levelTime) * TIME_BONUS_PER_SEC),
    rows: [
      { id: 'Kill',     pct: ratio(player.kills,  totalEnemies)  },
      { id: 'Secret',   pct: ratio(secretsFound,  totalSecrets)  },
      { id: 'Treasure', pct: ratio(treasureFound, totalTreasure) },
    ],
    stage: 0,        // 0 = time row, 1..3 = the ratio rows, 4 = score + hint
    stageT: 0,
    shown: [0, 0, 0],
    lastTick: [-1, -1, -1],
    done: false,
  };
  el('tTitle').textContent = finalFloor ? 'ARCOLOGY CLEARED' : 'FLOOR CLEARED';
  el('tSub').textContent = 'FLOOR ' + (levelIndex + 1) + '  ·  ' + FLOOR_NAMES[levelIndex];
  for (const id of ['Time', 'Kill', 'Secret', 'Treasure']) {
    const r = el('tRow' + id);
    r.classList.add('hide');
    r.classList.remove('perfect');
    el('t' + id + 'B').textContent = '';
  }
  el('tKill').textContent = el('tSecret').textContent = el('tTreasure').textContent = '0%';
  el('tTime').textContent = mmss(levelTime);
  el('tScore').classList.add('hide');
  el('tHint').classList.add('hide');
  el('tally').classList.add('show');
}

function hideTally() {
  tally = null;
  el('tally').classList.remove('show');
}

function paintScoreRow() {
  el('tScore').textContent = 'SCORE ' + String(player.score).padStart(6, '0');
}

// Reveal one row, award it, and move on. Called both by the roll-up and by
// finishTally(), so skipping the animation pays out exactly the same.
function settleRow(i) {
  const r = tally.rows[i];
  tally.shown[i] = r.pct;
  el('t' + r.id).textContent = r.pct + '%';
  el('tRow' + r.id).classList.remove('hide');
  if (r.pct >= 100 && !r.paid) {
    r.paid = true;
    el('tRow' + r.id).classList.add('perfect');
    el('t' + r.id + 'B').textContent = '100% +' + PERFECT_BONUS;
    player.score += PERFECT_BONUS;
    sfx('key');
  }
}

function finishTally() {
  if (!tally || tally.done) return;
  if (!tally.timePaid) {
    tally.timePaid = true;
    player.score += tally.timeBonus;
  }
  el('tRowTime').classList.remove('hide');
  el('tTimeB').textContent = 'PAR ' + mmss(tally.par) +
    (tally.timeBonus > 0 ? '  +' + tally.timeBonus : '');
  for (let i = 0; i < tally.rows.length; i++) settleRow(i);
  paintScoreRow();
  el('tScore').classList.remove('hide');
  el('tHint').textContent = tally.finalFloor
    ? 'press E to step outside'
    : 'press E to descend  ·  P to replay this floor';
  el('tHint').classList.remove('hide');
  tally.done = true;
  tally.stage = 5;
  sfx('clear');
  syncHud();
}

function stepTally(dt) {
  if (!tally || tally.done) return;
  tally.stageT += dt;

  if (tally.stage === 0) {                       // time row
    if (!tally.timePaid) {
      tally.timePaid = true;
      player.score += tally.timeBonus;
      el('tRowTime').classList.remove('hide');
      el('tTimeB').textContent = 'PAR ' + mmss(tally.par) +
        (tally.timeBonus > 0 ? '  +' + tally.timeBonus : '');
      sfx('pickup');
    }
    if (tally.stageT >= ROW_GAP) { tally.stage = 1; tally.stageT = 0; }
    return;
  }

  const i = tally.stage - 1;
  if (i >= tally.rows.length) {                  // score + hint
    if (tally.stageT >= ROW_GAP) finishTally();
    return;
  }

  const r = tally.rows[i];
  el('tRow' + r.id).classList.remove('hide');
  const k = Math.min(1, tally.stageT / ROW_ROLL);
  const v = Math.round(r.pct * k);
  tally.shown[i] = v;
  el('t' + r.id).textContent = v + '%';
  // one tick every few percent, so a 100% row is a run of ticks and a 0% row
  // is a single one — the audio reads as the number climbing
  const tickBucket = Math.floor(v / 7);
  if (tickBucket !== tally.lastTick[i]) {
    tally.lastTick[i] = tickBucket;
    sfx('ping');
  }
  if (k >= 1) {
    settleRow(i);                 // idempotent: the payout and chime self-guard
    if (tally.stageT >= ROW_ROLL + ROW_GAP) { tally.stage++; tally.stageT = 0; }
  }
}

function clearLevel() {
  if (gameState !== 'playing') return;
  gameState = 'cleared';
  if (document.exitPointerLock) document.exitPointerLock();
  openTally(levelIndex + 1 >= LEVELS.length);
  syncHud();
}

// The tally screen's own action key: skip the roll-up if it is still
// running, otherwise ride the elevator down to the next floor.
function advanceFromTally() {
  if (tally && !tally.done) { finishTally(); return; }
  hideTally();
  if (!nextLevel()) winGame();
}

function winGame() {
  gameState = 'won';
  hideTally();
  sfx('clear');
  showBanner('OUT',
    'YOU RESIGN, WITH PREJUDICE  ·  FINAL SCORE ' +
    String(player.score).padStart(6, '0'),
    'press P to start over', false);
}

function killPlayer() {
  gameState = 'dead';
  if (document.exitPointerLock) document.exitPointerLock();
  sfx('die');
  showBanner('TERMINATED',
    'YOUR EMPLOYMENT HAS BEEN CONCLUDED ON FLOOR ' + (levelIndex + 1) +
    '  ·  SCORE ' + String(player.score).padStart(6, '0'),
    'press P or E to retake the floor', true);
}

function updatePrompt() {
  if (gameState !== 'playing') { promptEl.classList.remove('show'); return; }
  const f = frontCell();
  if (!f) { promptEl.classList.remove('show'); return; }
  const c = f.cell;
  let msg = null;
  if (c.tag === 'door' && c.phase === 'closed') {
    if (c.lock === 'red')       msg = player.keyRed  ? 'RED DOOR  [E] OPEN'  : 'RED DOOR  — LOCKED';
    else if (c.lock === 'blue') msg = player.keyBlue ? 'BLUE DOOR  [E] OPEN' : 'BLUE DOOR — LOCKED';
    else                        msg = '[E] OPEN';
  } else if (c.tag === 'exit') {
    msg = (boss && boss.alive) ? 'ELEVATOR — HELD BY THE BOARD'
        : levelIndex + 1 >= LEVELS.length ? 'ELEVATOR  [E] SURFACE'
        : 'ELEVATOR  [E] DESCEND';
  }
  if (msg) { promptEl.textContent = msg; promptEl.classList.add('show'); }
  else promptEl.classList.remove('show');
}
