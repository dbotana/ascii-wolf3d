'use strict';

// The DDA raycaster. Returns perpendicular distance, the cell struck, which
// face, and wallX — where along that face the ray landed — which is what makes
// the door slip-through and the sprite projection agree with each other.
//
// Doors are the one cell the tile grid cannot express on its own: the slab
// hangs at the tile centre rather than on a boundary, so the DDA's hit has to
// be replaced by an explicit mid-plane crossing. That is the only place in
// here that does not simply report where the march stopped.

// ─── DDA RAYCAST (thin-wall doors + wallX) ──────────────────
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
    if (c.tag === 'door') {
      // Thin wall. The slab stands at the tile CENTRE, not on the tile
      // boundary the DDA just crossed, so step on to its mid-plane and test
      // there — half a tile further in. That half tile is the whole effect:
      // the door renders set back, and the flanking walls a ray reaches
      // instead at oblique angles are the frame standing proud of it.
      const t = c.axis === 0 ? (mapX + 0.5 - px) / cosA
                             : (mapY + 0.5 - py) / sinA;
      // `perp` is where the ray entered this cell, so this rejects a crossing
      // that is behind us. Only a door with an open flank can produce one, and
      // validate-level.js refuses to ship those. An axis-aligned ray divides
      // by ~6e-17 rather than 0 and lands here too, as a huge t.
      //
      // Kept for the intent, not because anything rests on it: the `lat` range
      // test below subsumes it. A crossing behind the entry face is outside the
      // cell laterally, which that test already rejects. The only rays where
      // the two differ are exact 45-degree corner grazes decided by one ULP,
      // and they need geometry no floor can ship. See ray-door-behind-face in
      // reference/mutations.js for the measurement.
      if (t < perp || t > limit) continue;
      // `lat` runs along the door's OWN fixed axis, so it is a world
      // coordinate and not a face-relative one: the same physical point on the
      // slab reads the same from either side, and the slice retracts one way
      // for everybody. Deriving it from the hit face is what mirrored it.
      const lat = c.axis === 0 ? (py + t * sinA) - mapY
                               : (px + t * cosA) - mapX;
      // Landing outside the tile is not a failure, it is the jamb: the ray
      // crossed into a flanking wall before it reached the mid-plane. Marching
      // on lets the DDA hit that wall's face at the tile boundary, which IS
      // the recess — nothing draws it.
      if (lat < 0 || lat >= 1) continue;
      // the opened slice of a door is empty space — keep marching through it
      if (lat < c.open) continue;
      return { dist: t, cell: c, side: c.axis, mapX, mapY, wallX: lat };
    }
    let wx = side === 0 ? (py + perp * sinA) : (px + perp * cosA);
    wx -= Math.floor(wx);
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
