'use strict';

// The end-of-floor screen: Wolf3D's percentage tally, from the moment a floor
// is cleared to the moment the elevator takes you off it.
//
// It came out of hud.js, which owns the status bar and the banners and was
// filling the 400-line budget rather than staying under it. The two halves
// share nothing but el(): the status bar is painted every frame of play and
// this runs at exactly one moment, after the last of them. clearLevel() and
// advanceFromTally() moved with it — they are the screen's two doors, and
// leaving them behind would have meant hud.js still reading `tally` across a
// file boundary to decide what the action key does.
//
// Nothing here runs at load, so its tag position is free; it sits after hud.js
// because that is where a reader who just met el() and showBanner() is.
//
// The ratios roll up one row at a time with a tick per digit, and a category
// only pays out at a clean 100%.

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
    lastTick: [-1, -1, -1],
    done: false,
  };
  el('tTitle').textContent = finalFloor ? 'ARCOLOGY CLEARED' : 'FLOOR CLEARED';
  el('tSub').textContent = 'FLOOR ' + (levelIndex + 1) + '  ·  ' + FLOOR_NAMES[levelIndex];
  for (const id of ['Time', ...tally.rows.map(r => r.id)]) {
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

// Painted identically by the roll-up and by the skip. The payout beside it
// stays duplicated on purpose: `tally-skip-pays-nothing` mutates finishTally's
// copy, and one shared site would make that divergence unexpressible.
function paintTimeRow() {
  el('tRowTime').classList.remove('hide');
  el('tTimeB').textContent = 'PAR ' + mmss(tally.par) +
    (tally.timeBonus > 0 ? '  +' + tally.timeBonus : '');
}

function paintScoreRow() {
  el('tScore').textContent = 'SCORE ' + String(player.score).padStart(6, '0');
}

// Reveal one row, award it, and move on. Called both by the roll-up and by
// finishTally(), so skipping the animation pays out exactly the same.
function settleRow(i) {
  const r = tally.rows[i];
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
  paintTimeRow();
  for (let i = 0; i < tally.rows.length; i++) settleRow(i);
  paintScoreRow();
  el('tScore').classList.remove('hide');
  el('tHint').textContent = tally.finalFloor
    ? 'press E to step outside'
    : 'press E to descend  ·  P to replay this floor';
  el('tHint').classList.remove('hide');
  tally.done = true;
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
      paintTimeRow();
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
