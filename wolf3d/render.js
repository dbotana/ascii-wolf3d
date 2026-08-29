'use strict';

// Everything drawn into the canvas apart from the wall pass: sprites with
// z-buffer occlusion, the weapon view-model, and the crosshair.

// ─── SPRITE RENDERER (generalised from drawNPCs) ────────────
function drawSprite(spec, wx, wy, zbuf, horizon, bobOffset) {
  const cosA = Math.cos(player.a), sinA = Math.sin(player.a);
  const ex = wx - player.x, ey = wy - player.y;
  const depth   =  ex * cosA + ey * sinA;
  if (depth <= 0.32 || depth >= MAX_DEPTH) return;
  const lateral = -ex * sinA + ey * cosA;

  const pph = PPH / depth;
  const { centerCol, halfW } = spriteSpan(depth, lateral, spec.wW);
  const c0 = Math.floor(centerCol - halfW);
  const c1 = Math.ceil(centerCol + halfW);
  if (c1 < 0 || c0 >= COLS) return;

  const foot = spec.foot + (bobOffset || 0);
  const rBot = Math.floor(horizon + pph * (EYE_Z - foot));
  const rTop = Math.floor(rBot - pph * spec.wH);
  const spanC = Math.max(1, c1 - c0);
  const spanR = Math.max(1, rBot - rTop);

  const art = spec.rows;
  const artH = art.length, artW = art[0].length;
  const base   = fade(COLOR[spec.base], depth);
  const accent = fade(COLOR[spec.accentColor], depth * 0.5);
  const acc = spec.accent || '';

  for (let col = Math.max(0, c0); col < Math.min(COLS, c1); col++) {
    if (zbuf[col] < depth) continue;                    // wall in front
    const ax = Math.min(artW - 1, ((col - c0) / spanC * artW) | 0);
    for (let row = Math.max(0, rTop); row < Math.min(ROWS, rBot); row++) {
      const ay = Math.min(artH - 1, ((row - rTop) / spanR * artH) | 0);
      const ch = art[ay][ax];
      if (!ch || ch === ' ') continue;
      drawChar(col, row, ch, acc.indexOf(ch) >= 0 ? accent : base);
    }
  }
}

/**
 * Which view of an enemy we are looking at.
 *
 * Guards get four rotations. Drones are a symmetric ring of rotors with no
 * front to speak of, and the CEO is a boss that should always be squaring up
 * to you, so both stay single-view — as do the firing, dying and dead frames
 * for everyone (an enemy shooting at you is facing you by definition).
 *
 * `view` is the direction from the player TO the enemy, so a heading equal to
 * it means the guard is walking away and we see its back.
 */
function enemySprite(e) {
  if (!e.alive) return e.state === 'dying' ? SPR[e.type + 'Die'] : SPR[e.type + 'Dead'];
  if (e.state === 'attack') return SPR[e.type + 'Fire'];
  if (e.type !== 'guard') return SPR[e.type];
  const view = Math.atan2(e.y - player.y, e.x - player.x);
  let rel = view - e.heading;
  rel -= Math.PI * 2 * Math.floor((rel + Math.PI) / (Math.PI * 2));   // -> [-π, π)
  const a = Math.abs(rel);
  if (a <= Math.PI / 4)     return SPR.guardBack;
  if (a >= Math.PI * 0.75)  return SPR.guard;
  // The sprite is named for the way the guard faces ON SCREEN. Which sign of
  // `rel` that is was measured through the real projection, not derived: the
  // first version had the pair swapped in all eight viewing cases, and a
  // mirrored pair is invisible in review. See the rotation test.
  return rel > 0 ? SPR.guardLeft : SPR.guardRight;
}

function drawSprites(zbuf, horizon) {
  const cosA = Math.cos(player.a), sinA = Math.sin(player.a);
  const list = [];
  for (const e of enemies) {
    const d = (e.x - player.x) * cosA + (e.y - player.y) * sinA;
    if (d > 0.32 && d < MAX_DEPTH) list.push({ d, kind: 'e', ref: e });
  }
  for (const it of items) {
    if (it.taken) continue;
    const d = (it.x - player.x) * cosA + (it.y - player.y) * sinA;
    if (d > 0.32 && d < MAX_DEPTH) list.push({ d, kind: 'i', ref: it });
  }
  list.sort((a, b) => b.d - a.d);      // back to front
  for (const s of list) {
    if (s.kind === 'e') {
      const e = s.ref;
      const bob = e.alive && e.type === 'drone' ? Math.sin(e.bob) * 0.12 : 0;
      drawSprite(enemySprite(e), e.x, e.y, zbuf, horizon, bob);
    } else {
      const it = s.ref;
      drawSprite(SPR[it.kind], it.x, it.y, zbuf, horizon, Math.sin(it.bob) * 0.06);
    }
  }
}

// ─── ART BLITTER (weapon / overlays) ────────────────────────
function blitArt(art, col0, row0, spanC, spanR, base, accentSet, accent) {
  const artH = art.length, artW = art[0].length;
  for (let c = 0; c < spanC; c++) {
    const col = col0 + c;
    if (col < 0 || col >= COLS) continue;
    const ax = Math.min(artW - 1, (c / spanC * artW) | 0);
    for (let r = 0; r < spanR; r++) {
      const row = row0 + r;
      if (row < 0 || row >= ROWS) continue;
      const ay = Math.min(artH - 1, (r / spanR * artH) | 0);
      const ch = art[ay][ax];
      if (!ch || ch === ' ') continue;
      drawChar(col, row, ch, accentSet.indexOf(ch) >= 0 ? accent : base);
    }
  }
}

// The view-model's animation clock. Two other files drive it — combat.js on
// a shot and world.js on a floor start — so both go through a named call
// rather than assigning these directly: a cross-file write you can grep for
// is a dependency, one you cannot is a surprise.
let gunFrame = 0, gunT = 0;
function triggerGunFire() { gunFrame = 1; gunT = 0.09; }
function resetGun()       { gunFrame = 0; gunT = 0; }
function stepGun(dt) {
  if (gunT > 0) {
    gunT -= dt;
    if (gunT <= 0) {
      if (gunFrame === 1) { gunFrame = 2; gunT = 0.10; }
      else gunFrame = 0;
    }
  }
}
function drawGun() {
  const spanC = 39, spanR = 22;
  const sway = Math.round(Math.sin(player.bob * 0.5) * 2);
  const rise = Math.round(Math.cos(player.bob) * 1.2);
  let col0 = ((COLS - spanC) / 2 | 0) + sway;
  let row0 = ROWS - spanR + 2 + rise;

  if (player.reloadT > 0) {
    // u runs 0→1 across the cycle: drop, eject, seat, raise
    const u = 1 - player.reloadT / RELOAD_TIME;
    let art, accent = RELOAD_ACCENT, base = COLOR.gun, accentCol = COLOR.crt;
    let dip;
    if (u < 0.22)      { art = GUN_DOWN;  dip = u / 0.22; }
    else if (u < 0.50) { art = GUN_EJECT; dip = 1; accentCol = COLOR.sodium; }
    else if (u < 0.78) { art = GUN_SEAT;  dip = 1; }
    else               { art = GUN_RAISE; dip = 1 - (u - 0.78) / 0.22; }
    // ease the whole model down and back up over the cycle
    row0 += Math.round(dip * dip * (3 - 2 * dip) * 9);
    col0 += Math.round(Math.sin(u * Math.PI * 2) * 2);
    blitArt(art, col0, row0, spanC, spanR, base, accent, accentCol);
    return;
  }

  const art = gunFrame === 1 ? GUN_FIRE : gunFrame === 2 ? GUN_RECOIL : GUN_IDLE;
  blitArt(art, col0, row0, spanC, spanR,
          gunFrame === 1 ? COLOR.gunHi : COLOR.gun, GUN_ACCENT, COLOR.muzzle);
}

function drawCrosshair(horizon) {
  const c = COLS / 2 | 0;
  const col = gameState === 'playing' ? 'rgba(127,255,107,0.55)' : 'rgba(127,255,107,0.2)';
  drawChar(c - 2, horizon, '-', col);
  drawChar(c + 2, horizon, '-', col);
  drawChar(c, horizon - 1, '|', col);
  drawChar(c, horizon + 1, '|', col);
}

// The wall / floor / ceiling column pass. One ray per screen column,
// filling zbuf[col] with the perpendicular distance so sprites can be
// occluded against it afterwards.
//
// Extracted from frame(), which had it inline. It is the single biggest
// thing the renderer does, and the loop that draws ceiling lights, EXIT
// lettering, neon flicker, rain streaks and lit windows has no business
// being read as part of the main loop.
function drawWalls(zbuf, horizon, animT) {
  for (let col = 0; col < COLS; col++) {
    const rayA = player.a + Math.atan((col / COLS - 0.5) * 2 * Math.tan(FOV / 2));
    const hit = castRay(player.x, player.y, rayA);
    const dist = Math.max(0.06, hit.dist * Math.cos(rayA - player.a));
    zbuf[col] = hit.cell ? dist : MAX_DEPTH;

    const pph = PPH / dist;
    const wallTop = hit.cell ? Math.floor(horizon - pph * (WALL_H - EYE_Z)) : horizon;
    const wallBot = hit.cell ? Math.floor(horizon + pph * EYE_Z) : horizon;

    // ceiling
    const ceilEnd = Math.min(ROWS, Math.max(0, wallTop));
    for (let row = 0; row < ceilEnd; row++) {
      const t = (horizon - row) / Math.max(1, horizon);
      const cd = MAX_DEPTH * 0.6 * (1 - Math.min(0.98, t));
      const ch = distChar(cd, CEIL_CHARS);
      // periodic ceiling light strips
      const lit = ((col + 3) % 24 < 2) && t > 0.25;
      drawChar(col, row, lit ? '═' : ch,
               lit ? mix(COLOR.window, COLOR.fog, 0.35)
                   : mix(row & 1 ? COLOR.ceil : COLOR.ceilHi, COLOR.fog, 1 - t));
    }

    // floor
    const floorStart = Math.max(horizon, Math.min(ROWS, wallBot));
    for (let row = floorStart; row < ROWS; row++) {
      const t = (row - horizon) / Math.max(1, ROWS - horizon);
      const gd = MAX_DEPTH * 0.6 * (1 - Math.min(0.98, t));
      drawChar(col, row, distChar(gd, FLOOR_CHARS),
               mix(row & 1 ? COLOR.floor : COLOR.floorHi, COLOR.fog, 1 - t));
    }

    if (!hit.cell) continue;

    // wall column
    const cell = hit.cell;
    const baseCh = distChar(dist, WALL_CHARS);
    let baseCol = wallBase(cell);
    if (hit.side === 1) baseCol = mix(baseCol, '#000000', 0.28);   // side shading
    const shaded = fade(baseCol, dist);

    // door slice: the opened part of the face is already skipped by castRay,
    // so anything we draw here is still solid door
    const isDoor = cell.tag === 'door';
    const wx = hit.wallX;

    const start = Math.max(0, wallTop);
    const end   = Math.min(ROWS, wallBot);
    const span  = Math.max(1, wallBot - wallTop);

    for (let row = start; row < end; row++) {
      const v = (row - wallTop) / span;      // 0 = top of wall, 1 = floor
      let ch = baseCh, color = shaded;

      if (isDoor) {
        // steel shutter: horizontal ribs + a lock strip in the middle
        ch = (row & 1) ? '▤' : '▥';
        if (Math.abs(v - 0.5) < 0.05) {
          ch = cell.lock ? '▮' : '▬';
          color = fade(cell.lock ? wallBase(cell) : COLOR.steel, dist * 0.4);
        } else {
          color = fade(mix(COLOR.steel, COLOR.steelD, wx), dist);
        }
      } else if (cell.tag === 'exit') {
        ch = (row & 1) ? '▓' : '▒';
        if (Math.abs(v - 0.42) < 0.09) {
          const word = 'EXIT';
          ch = word[(Math.floor(wx * 8) + col) % word.length];
          color = COLOR.crt;
        } else color = fade(mix(COLOR.crtD, COLOR.steelD, 0.4), dist);
      } else if (cell.tag === 'neon' && dist < 16) {
        const bandC = 0.30;
        if (Math.abs(v - bandC) < 0.10) {
          const txt = SIGN_TEXTS[(cell.seed >>> 9) % SIGN_TEXTS.length];
          ch = txt[(Math.floor(wx * txt.length * 1.5) + (cell.seed & 3)) % txt.length];
          const flick = ((cell.seed >>> 3) & 7) === 0 && Math.sin(animT * 11 + cell.seed) < -0.75;
          color = flick ? COLOR.slate : neonHex(cell.signColor);
        } else {
          color = fade(mix(neonHex(cell.signColor), COLOR.slate, 0.72), dist);
        }
      } else if (cell.tag === 'window' && dist < 18) {
        // rain running down the glass, outside the arcology
        if (v > 0.12 && v < 0.82) {
          const streak = (col * 7 + Math.floor(animT * 22 + (cell.seed & 15))) % 9;
          ch = streak < 3 ? RAIN_CHARS[streak] : '░';
          color = streak < 3
            ? mix(COLOR.window, COLOR.cyan, 0.5)
            : fade(mix(COLOR.window, COLOR.fog, 0.55), dist);
        } else {
          color = fade(COLOR.steelD, dist);
        }
      } else if (cell.tag === 'panel') {
        // lit office windows punched into the panelling
        const band = Math.floor(v * 6);
        const k = ((cell.seed ^ (band * 2654435761) ^ (Math.floor(wx * 4) * 97)) >>> 0) / 0xFFFFFFFF;
        if (dist < 14 && k < 0.13) {
          ch = dist < 6 ? '▣' : 'o';
          color = fade(COLOR.window, dist * 0.7);
        }
      }
      drawChar(col, row, ch, color);
    }
  }
}
