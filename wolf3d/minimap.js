'use strict';

// The auto-map: a scrolling window on the floor, filled in only where you have
// actually been or looked.
//
// Its own file because render.js is at its 400-line budget and rule 4 says
// that is a signal to split rather than a target to fill. It draws through
// drawChar like everything else, so it lives inside the CRT overlay for free
// and shares the glyph atlas — every colour here comes from COLOR, which is
// what keeps that atlas bounded.
//
// It is deliberately NOT a compass. It shows where you have been and what you
// have seen; it never points at the objective, which is the objective line's
// job (hud.js) and stops well short of walking you down the corridor.

// ─── THE WINDOW ─────────────────────────────────────────────
// 25x25 tiles at one tile per character cell, top-right. Windowed rather than
// whole-floor for two reasons: a 40x40 floor at 1:1 would eat a quarter of the
// screen, and a map that scrolls with you answers "which way out of THIS room"
// — which is the question the big open halls were failing to answer.
const MINI_TILES = 25;
const MINI_PAD = 1;
const MINI_COL0 = COLS - MINI_TILES - MINI_PAD;
const MINI_ROW0 = MINI_PAD + 1;
// how close an enemy has to be before the map admits it is coming for you
const MINI_THREAT = 8.0;
// rays per sweep. Far fewer than the 160 the wall pass casts: this marks whole
// tiles, so angular resolution past ~one ray per two screen columns buys
// nothing, and the sweep is the only cost the map adds to a frame.
const MINI_RAYS = 48;
const MINI_STEP = 0.7;        // sample spacing along a ray, in tiles

let miniOn = true;

function toggleMinimap() { miniOn = !miniOn; return miniOn; }

function markSeen(gx, gy) {
  if (!seen || gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return;
  seen[gy * MAP_W + gx] = 1;
}

/**
 * Reveal what the player can currently see.
 *
 * Samples along each ray rather than marking only the cell it struck, or the
 * map would fill in walls across a room while the floor between stayed blank.
 * Called on a stride from frame() — a player crosses a tile in well over three
 * frames at any speed the game can produce, so nothing is missed.
 */
function markVisible() {
  if (!seen) return;
  // the tile you are standing in and its neighbours, so hugging a wall still
  // maps the corner you are in
  const px = player.x | 0, py = player.y | 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) markSeen(px + dx, py + dy);

  for (let i = 0; i < MINI_RAYS; i++) {
    const t = i / (MINI_RAYS - 1);
    const rayA = player.a + Math.atan((t - 0.5) * 2 * Math.tan(FOV / 2));
    const hit = castRay(player.x, player.y, rayA);
    const cosA = Math.cos(rayA), sinA = Math.sin(rayA);
    // walk the open span, then mark the wall itself one step past the face
    for (let d = MINI_STEP; d < hit.dist; d += MINI_STEP)
      markSeen((player.x + cosA * d) | 0, (player.y + sinA * d) | 0);
    if (hit.cell)
      markSeen((player.x + cosA * (hit.dist + 0.02)) | 0,
               (player.y + sinA * (hit.dist + 0.02)) | 0);
  }
}

// ─── DRAWING ────────────────────────────────────────────────
// The glyph and colour for one seen tile. Doors and the elevator are called
// out because they are the things a lost player is looking for; everything
// else is structure.
function miniCell(c) {
  if (!c) return ['·', COLOR.slate];
  if (c.tag === 'door') {
    return ['+', c.lock === 'red'  ? COLOR.keyRed
              : c.lock === 'blue' ? COLOR.keyBlue
              : COLOR.steel];
  }
  if (c.tag === 'exit')   return ['X', COLOR.crt];
  if (c.tag === 'window') return ['▒', COLOR.window];
  return ['▒', COLOR.slateHi];
}

const MINI_FACES = ['▶', '▼', '◀', '▲'];   // E S W N

function drawMinimap() {
  if (!miniOn || !seen || !grid) return;
  const cx = player.x | 0, cy = player.y | 0;
  const half = MINI_TILES >> 1;
  const x0 = cx - half, y0 = cy - half;

  for (let ty = 0; ty < MINI_TILES; ty++) {
    const gy = y0 + ty;
    if (gy < 0 || gy >= MAP_H) continue;
    for (let tx = 0; tx < MINI_TILES; tx++) {
      const gx = x0 + tx;
      if (gx < 0 || gx >= MAP_W) continue;
      if (!seen[gy * MAP_W + gx]) continue;         // fog: draw nothing at all
      const [ch, color] = miniCell(grid[gy][gx]);
      drawChar(MINI_COL0 + tx, MINI_ROW0 + ty, ch, color);
    }
  }

  // keycards, once you have laid eyes on the tile they sit on. A key you have
  // seen and walked past is exactly what the big halls kept losing.
  for (const it of items) {
    if (it.taken) continue;
    if (it.kind !== 'keyRed' && it.kind !== 'keyBlue') continue;
    const gx = it.x | 0, gy = it.y | 0;
    if (!seen[gy * MAP_W + gx]) continue;
    drawChar(MINI_COL0 + (gx - x0), MINI_ROW0 + (gy - y0),
             it.kind === 'keyRed' ? 'r' : 'b',
             it.kind === 'keyRed' ? COLOR.keyRed : COLOR.keyBlue);
  }

  // Only what is HUNTING you, and only close by. Plotting every body on the
  // floor would turn the map into a wallhack and take the surprise out of
  // every room; an alerted guard two rooms away is information you have
  // already earned by making noise.
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.state === 'idle') continue;
    if (Math.hypot(e.x - player.x, e.y - player.y) > MINI_THREAT) continue;
    const gx = e.x | 0, gy = e.y | 0;
    if (gx < x0 || gy < y0 || gx >= x0 + MINI_TILES || gy >= y0 + MINI_TILES) continue;
    drawChar(MINI_COL0 + (gx - x0), MINI_ROW0 + (gy - y0), '!', COLOR.pink);
  }

  // you, facing. The quadrant is enough — a 25x25 tile grid cannot express
  // more heading than that anyway.
  const q = (Math.round(player.a / (Math.PI / 2)) % 4 + 4) % 4;
  drawChar(MINI_COL0 + half, MINI_ROW0 + half, MINI_FACES[q], COLOR.sodium);
}
