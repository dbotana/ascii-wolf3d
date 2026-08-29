'use strict';

// The DDA raycaster. Returns perpendicular distance, the cell struck, which
// face, and wallX — where along that face the ray landed — which is what makes
// the door slip-through and the sprite projection agree with each other.

// ─── DDA RAYCAST (with wallX + door slip-through) ───────────
function castGrid(px, py, angle, maxD) {
  const limit = maxD || MAX_DEPTH;
  const sinA = Math.sin(angle), cosA = Math.cos(angle);
  let mapX = px | 0, mapY = py | 0;
  const deltaX = Math.abs(1 / cosA);
  const deltaY = Math.abs(1 / sinA);
  let stepX, stepY, sideDistX, sideDistY;
  if (cosA < 0) { stepX = -1; sideDistX = (px - mapX) * deltaX; }
  else          { stepX =  1; sideDistX = (mapX + 1 - px) * deltaX; }
  if (sinA < 0) { stepY = -1; sideDistY = (py - mapY) * deltaY; }
  else          { stepY =  1; sideDistY = (mapY + 1 - py) * deltaY; }
  let side = 0;
  for (let n = 0; n < limit * 2; n++) {
    if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
    else                       { sideDistY += deltaY; mapY += stepY; side = 1; }
    const c = cellAt(mapX, mapY);
    if (!c) continue;
    const perp = side === 0 ? (sideDistX - deltaX) : (sideDistY - deltaY);
    if (perp > limit) break;
    let wx = side === 0 ? (py + perp * sinA) : (px + perp * cosA);
    wx -= Math.floor(wx);
    // the opened slice of a door is empty space — keep marching through it
    if (c.tag === 'door' && wx < c.open) continue;
    return { dist: perp, cell: c, side, mapX, mapY, wallX: wx };
  }
  return { dist: limit, cell: null, side: 0, mapX, mapY, wallX: 0 };
}

// clear line of sight between two points?
function hasLOS(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return true;
  const hit = castRay(ax, ay, Math.atan2(dy, dx), Math.min(MAX_DEPTH, d + 1));
  return hit.dist >= d - 0.25;
}

// Where a sprite of world-width wW lands on screen at this depth and lateral
// offset. It lives here, with the rest of the projection, because BOTH fire()'s
// hit test and drawSprite() measure against it — if they ever drift apart you
// can shoot things you cannot see, or vice versa. Keeping it in either consumer
// invites exactly that.
function spriteSpan(depth, lateral, wW) {
  const centerCol = COLS / 2 + (lateral / depth) * FOCAL;
  const halfW = (FOCAL * wW * 0.5) / depth;
  return { centerCol, halfW };
}
