'use strict';

// Enemy pathfinding: ONE breadth-first flow field seeded at the player, not a
// search per enemy. Every chaser wants the same destination, so per-enemy
// fields would be N copies of one answer. Rebuilt every 0.35s or the moment the
// player crosses a tile line; 20µs on a 40x40 floor against a 1.9ms frame.

// ─── NAVIGATION ─────────────────────────────────────────────
//
// Enemies used to steer straight at the player, which works right up until a
// corner: a guard would close past its own standoff, lose line of sight and
// grind along the wall. The fix is a breadth-first flow field over the tile
// grid, and there is exactly ONE of them, seeded at the player rather than at
// each enemy. Every chaser wants the same destination, so N per-enemy fields
// would be N copies of one answer. A 40x40 floor is 1600 cells; rebuilding
// three times a second costs nothing.
//
// `navDist[i]` is the number of tile steps from that tile to the player, or
// -1 for unreachable.

const NAV_REBUILD = 0.35;      // seconds between rebuilds when the player sits still
const NAV_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Can a body walk through this tile? Tile-granular sibling of `blockAt`.
 * Enemies carry no keycards, so a locked door is a wall to them however open
 * it happens to be — otherwise the field would route a guard at a door it can
 * never pass and it would stand there.
 */
function navPassable(gx, gy) {
  if (!inMap(gx, gy)) return false;
  if (movingSecrets.length && inSlab(gx + 0.5, gy + 0.5)) return false;
  const c = grid[gy][gx];
  if (!c) return true;
  return c.tag === 'door' && c.lock === null;
}

function navAt(gx, gy) {
  if (!navDist || !inMap(gx, gy)) return -1;
  return navDist[gy * MAP_W + gx];
}

// Flat-array queue with a head index — never Array.prototype.shift(), which is
// O(n) and would make this quadratic in the number of tiles.
function buildNavField() {
  if (!navDist) return;
  const sx = player.x | 0, sy = player.y | 0;
  if (!navPassable(sx, sy)) return;      // keep the last good field rather than blanking it
  navDist.fill(-1);
  navSeedX = sx; navSeedY = sy;
  const q = navQueue;
  let head = 0, tail = 0;
  navDist[sy * MAP_W + sx] = 0;
  q[tail++] = sy * MAP_W + sx;
  while (head < tail) {
    const at = q[head++];
    const x = at % MAP_W, y = (at / MAP_W) | 0;
    const d = navDist[at] + 1;
    for (const [dx, dy] of NAV_DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!navPassable(nx, ny)) continue;
      const ni = ny * MAP_W + nx;
      if (navDist[ni] >= 0) continue;
      navDist[ni] = d;
      q[tail++] = ni;
    }
  }
}

function stepNav(dt) {
  navRebuildT -= dt;
  // rebuild on the timer, or immediately when the player crosses a tile line —
  // a stale field is only ever wrong by however far the player has walked
  if (navRebuildT > 0 && (player.x | 0) === navSeedX && (player.y | 0) === navSeedY) return;
  navRebuildT = NAV_REBUILD;
  buildNavField();
}

/**
 * One step down the flow field.
 * @returns {{x:number,y:number,gx:number,gy:number}|null} unit vector toward
 *   the centre of the next tile, or null if this enemy has no route (sealed
 *   off, or standing on the player's own tile) — callers fall back to steering
 *   straight at the player, which is what the whole roster did before.
 */
function navStep(e) {
  const gx = e.x | 0, gy = e.y | 0;
  const here = navAt(gx, gy);
  if (here <= 0) return null;
  let bx = -1, by = -1, best = here;
  for (const [dx, dy] of NAV_DIRS) {
    const nx = gx + dx, ny = gy + dy;
    const d = navAt(nx, ny);
    if (d < 0 || d >= best) continue;
    best = d; bx = nx; by = ny;
  }
  if (bx < 0) return null;
  // aim at the tile centre, not the tile edge, or an enemy cutting a corner
  // clips its shoulder on the wall it is rounding
  const vx = (bx + 0.5) - e.x, vy = (by + 0.5) - e.y;
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len, gx: bx, gy: by };
}
