'use strict';

// The boss fights. A boss is an ordinary member of `enemies` — same FSM, same
// line of sight, same death animation — with a `phases` table on its roster row
// that re-tunes its own spec as its health falls. Everything here is generic
// over that table, so a new boss is a row in roster.js, four sprites and a
// character in a level, and nothing in this file changes.
//
// Split out of enemies.js when the roster grew past one boss: that file owns
// the shared FSM and was at its line budget, and bosses are the growth area.

// The live boss's roster row, or null. hud.js and audio.js both ask, and both
// would otherwise reach through `boss.type` into a table they do not own.
function bossRow() { return boss ? ENEMY_TYPES[boss.type] : null; }

// Minions a boss calls in are real enemies, so they count toward the floor's
// kill ratio — the denominator grows with them and 100% stays achievable. If
// they were excluded the ratio could exceed 100% the moment you killed one.
function summonMinions(e, type, n) {
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
    const d = mkEnemy(type, x, y);
    d.state = 'chase';
    enemies.push(d);
    totalEnemies++;
  }
  if (spots.length) { sfx('ping'); syncHud(); }
}

/**
 * Advance a boss to whichever phase its health has earned, and re-tune it.
 *
 * The spec fields are written one by one rather than spread, so a phase row
 * only moves what it names and a typo cannot invent a field the FSM never
 * reads. They are written onto `e.spec` IN PLACE, which is safe only because
 * mkEnemy copies the roster's spec per body — see the note there.
 */
function stepBossPhase(e) {
  const row = ENEMY_TYPES[e.type];
  const frac = e.hp / e.maxHp;
  let want = 0;
  for (let i = 0; i < row.phases.length; i++) if (frac <= row.phases[i].at) want = i;
  if (want === e.phase) return;
  e.phase = want;
  const ph = row.phases[want];
  if (ph.speed !== undefined) e.spec.speed = ph.speed;
  if (ph.cd    !== undefined) e.spec.cd    = ph.cd;
  if (ph.dmg   !== undefined) e.spec.dmg   = ph.dmg;
  if (ph.range !== undefined) e.spec.range = ph.range;
  if (ph.sight !== undefined) e.spec.sight = ph.sight;
  e.want  = ph.want;
  e.burst = ph.burst;
  e.atkCd = Math.min(e.atkCd, 0.5);
  if (want > 0) {
    toast(row.tag + '  ·  ' + ph.name);
    sfx('bark');
    alertNear(e.x, e.y, 12);
    if (ph.summon) summonMinions(e, ph.summon.type, ph.summon.n);
  }
}
