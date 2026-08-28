# WOLFENSTAIN 3D — engine reference

Working notes for `wolf3d.html`. Written during the MVP build; the file
references were verified against the source, but line numbers drift — grep for
the function name if one looks wrong.

---

## The repo in one paragraph

Two single-file browser programs sharing one engine lineage. `ascii_city.html`
(and its byte-identical copy `index.html`) is the original: a walkable ASCII
cyberpunk city, no goal. `wolf3d.html` is a Wolfenstein 3D parody built on the
same primitives — a megacorp arcology you shoot your way out of. Everything
renders as monospace glyphs onto one canvas.

**The city is finished and deployed. Do not edit `ascii_city.html` or
`index.html`** — the shooter was deliberately built as a sibling file with its
engine primitives copied rather than extracted, precisely so the live build
could not regress. `git diff --stat` after any shooter work should never list
them.

## Hard constraints

These are not style preferences. Breaking one breaks the deployment.

- **Single file.** No build step, no bundler, no `import`. Everything —
  markup, CSS, game — lives in one `.html`.
- **CSP-safe.** No external scripts, images, or audio files. The only network
  request is the Google Fonts stylesheet. All audio is synthesised at runtime
  via Web Audio; all art is characters in source.
- **Everything degrades.** The atlas, the audio graph, and pointer lock each sit
  behind a `try/catch` or a capability check and fall back rather than throw.
  `drawChar` falls back to `fillText` if the atlas failed to initialise.

---

## Coordinate system and units

One world unit is one map tile. The map is a plain 2D array indexed
`grid[y][x]`; `x` runs east, `y` runs south, and angles are the usual
`atan2(dy, dx)` so `-π/2` faces north.

| constant | value | meaning |
|---|---|---|
| `COLS`, `ROWS` | 160, 90 | the screen, in character cells |
| `CELL_W`, `CELL_H` | 7, 12 | pixel size of one cell |
| `FOV` | `π * 0.42` | ~76° horizontal |
| `MAX_DEPTH` | 24 | ray cutoff, in tiles |
| `PPH` | `ROWS / 4` = 22.5 | screen rows per world unit at distance 1 |
| `WALL_H` | 3 | every wall is this tall — Wolf3D is flat-ceilinged |
| `EYE_Z` | 1.6 | player eye height |
| `FOCAL` | `COLS / (2·tan(FOV/2))` | columns per unit of lateral offset at distance 1 |

`WALL_H = 3` with `EYE_Z = 1.6` is what makes a wall at distance 1 nearly fill
the screen and a wall at distance 5 occupy about 13 rows. Changing either
without the other will make corridors feel wrong.

The projection used everywhere, for walls and sprites alike:

```
pph      = PPH / depth              // vertical scale at this depth
screenX  = COLS/2 + (lateral/depth) * FOCAL
floorRow = horizon + pph * EYE_Z    // where the floor meets this column
```

## Grid cells

A tile is either the number `0` (empty, walkable) or an object. Truthiness is
the emptiness test throughout — `if (c)` means "there is a wall here".

```js
{ tag: 'panel' | 'window' | 'neon' | 'exit' | 'door',
  h: WALL_H,
  seed,                  // stable per-tile RNG, drives lit windows and sign text
  signColor,             // 'neon' only
  lock, open, phase,     // 'door' only
  gx, gy }               // 'door' only — its own coordinates
```

Doors carry `gx/gy` because `stepDoors` needs to know where a door is without
scanning the map. An early version scanned all 1600 tiles per door per frame;
don't reintroduce that.

## Render pipeline

Order matters — each stage depends on the one before.

1. **Simulate** — fire input is consumed first, then `updatePlayer`,
   `stepDoors`, `stepEnemies`, `stepItems`, `stepGun`, `stepToast`,
   `updatePrompt`.
2. **Clear** to fog.
3. **Column pass** — for each of the 160 columns: cast one ray, then draw
   ceiling above the wall, the wall itself, and floor below it. This fills
   `zbuf[col]` with the perpendicular wall distance.
4. **Sprites** — `drawSprites` sorts enemies and items back-to-front and blits
   them, testing `zbuf[col] < depth` per column so walls occlude correctly.
5. **Crosshair, then weapon** — the view-model draws over everything.
6. **Screen flashes** — muzzle and damage tints, as translucent `fillRect`.
7. **HUD** — DOM, refreshed every 12 frames rather than every frame.

## The atlas — why this is fast

Naively this would be 14,400 `fillText` calls per frame. Instead every distinct
`(char, colour)` pair is rendered once into an off-screen canvas, and the frame
loop blits cached sprites with `drawImage`. See `initAtlas` / `atlasGet`.

**This only works because the colour space is quantised.** `mix()` rounds its
blend factor to 8 steps before caching, so distance fog produces a bounded set
of colours instead of a new one per pixel. In practice the atlas holds about
**74 entries against a 32768 cap**. If you add colours, keep them coming from
`mix`/`fade` rather than computing arbitrary rgb per frame — an unbounded atlas
silently degrades to the `fillText` path once full.

## The door trick

Doors are the one genuinely subtle piece. `castRay` returns `wallX` — where
along the struck wall face the ray landed, 0 to 1 — and then:

```js
if (c.tag === 'door' && wx < c.open) continue;   // ray keeps marching
```

The opened slice of a door is simply not there as far as the ray is concerned,
so a half-open shutter really does show the room behind it, with correct
distance shading, rather than a black gap. Collision uses a separate threshold
(`blockAt` lets bodies through at `open > 0.65`) so you can walk through a door
slightly before it looks fully open, which feels better than the reverse.

Known cosmetic flaw: `wallX` runs along opposite axes depending on which face
you hit, so a door appears to retract left from one side and right from the
other. Fixing it means deriving the slide axis from the door rather than the
hit face.

## Push-walls

Added after the MVP, and the one place the tile-based DDA is not enough: a
sliding wall straddles two cells, which `grid[y][x]` cannot express. The
solution is a second pass — `castSecrets` intersects each moving slab as a
plain 1x1 box and takes the nearer of the two hits, and `castRay` only pays
for it while something is actually in motion (`if (!movingSecrets.length)
return hit`). Collision does the same via `inSlab`.

`pushSecret` slides along whichever axis you face, **up to two tiles, stopping
short of anything solid, anyone alive, or any pickup still on the floor**. If it
cannot move at all it returns silently rather than announcing itself — a wedged
secret should not give away that it is a secret. That silence is also why
`validate-level.js` checks for push-walls that can never move: the engine will
not tell you.

A slab in transit is out of the grid but not out of the world. `blockAt` routes
through `inSlab`, `castRay` through `castSecrets`, so a moving wall blocks
movement, rays and line of sight, while the tile it vacated is immediately
walkable. `shoveClear` ejects anything caught inside it backwards into that
vacated space — the one side guaranteed clear — so nothing is ever sealed in.
All of that was verified by forcing both the player and an enemy inside a moving
slab and confirming they came out on walkable ground.

`itemAt` is the third guard, added in the Phase 1 pass. A slab that lands on a
pickup makes that tile solid: `blockAt` keeps you off it and `stepItems` needs
you within 0.62u, so the pickup is gone for good. The clause is one line in the
span loop, but the consequence for level design is not:

> **A push-wall can never open a one-wide dead end.** The slab travels up to two
> tiles and stops *short* of the loot, so it always ends up between you and
> whatever is deepest. The pocket has to widen — two tiles across the slide
> axis — so you can walk around the slab once it lands.

The shipped floor had three pockets shaped exactly wrong, all found by turning
the same rule on in `validate-level.js` rather than by playing. The flood fill
and the wedged-secret check both now treat a pickup on the first cell of the
slide as solid, because that is what the engine does.

One push per secret — `use()` gates on `c.secret && c.phase === 'idle'`, and a
landed wall is `'done'`.

## Enemies

State machine in `stepEnemies`: `idle → alert → chase → attack → hurt → dead`,
with `dying` as a brief animation state before `dead`. The `attack` case fires
through `enemyShot()` and re-enters itself while `shotsLeft > 1`, so a burst is
the same shot repeated rather than a second code path; ordinary guards and
drones have `burst: 1` and behave exactly as before. Line of sight is a
`castRay` from the enemy toward the player, comparing hit distance to actual
distance. Gunfire and barks call `alertNear`, which wakes idle enemies in a
radius — so a fight pulls in the room, not just the target.

**Two known limitations, both measured, not suspected:**

- **No pathfinding.** `chase` steers straight at the player with axis-separated
  collision. A guard sent around a corner closed from 9.5u to 4.2u and jammed —
  past its own 3.2u standoff, with no line of sight. It slid along the wall and
  stopped.
- **No enemy-to-enemy collision.** After 6.6s of a group chase the two closest
  live enemies sat **0.009u apart**, fully overlapping.

Both are in `todo.md` Phase 2. Don't be surprised by them; they're not new bugs.

### The CEO

Floor 3's boss is an ordinary member of `enemies` — same FSM, same `castRay`
line of sight, same death animation — with `type: 'ceo'` and a `phase` that
re-tunes its own `spec` as its health falls. `CEO_PHASES` is the whole fight:

| phase | at | speed | cd | dmg | standoff | burst |
|---|---|---|---|---|---|---|
| BOARD MEETING | 100% | 1.10 | 1.40 | 16 | 5.2 | 1 |
| HOSTILE TAKEOVER | 62% | 1.75 | 1.00 | 14 | 3.2 | 3 |
| GOLDEN PARACHUTE | 28% | 2.20 | 0.62 | 12 | 2.3 | 4 |

`stepCeoPhase` mutates `e.spec` in place, which is safe only because `mkEnemy`
builds a fresh spec literal per enemy — don't hoist those into shared constants.

The last phase calls `summonDrones`, which **increments `totalEnemies`**. That
is deliberate: summoned drones are real enemies and count toward the floor's
kill ratio, so 100% stays achievable and stays honest. If they were excluded the
ratio could exceed 100% the moment you killed one.

The elevator on a floor with a live boss refuses (`use()` checks `boss.alive`),
and `updatePrompt` says so. Nothing in `validate-level.js` models that gate — it
only proves the exit is *reachable*.

## Level format

Each floor is an array of strings, one character per tile. Entity characters are
stripped to floor during `parseLevel` so they never block rays.

```
#  panel        |  window       N  neon sign     X  exit switch (solid)
D  door         R  red-locked   B  blue-locked   S  secret push-wall
g  guard        d  sec-drone    C  the CEO (floor 3 only)
+  ramen (+25hp)  a  battery cell (+8 ammo)
r  red keycard    b  blue keycard    $  crypto wallet (+500)    @  spawn
```

Three 40x40 floors, each its own `const LEVEL_N`, collected into `LEVELS` with
display names in `FLOOR_NAMES` and target times in `PAR_TIME`:

| | name | route |
|---|---|---|
| 1 | ATRIUM · SUBLEVEL | red keycard → red door → blue keycard → blue door → elevator |
| 2 | R&D · SERVER FARM | clean-room keycards in both lab wings → red door → atrium → blue door |
| 3 | EXECUTIVE SUITE | red keycard in the cubicle farm → boardroom → kill the CEO → elevator |

**Keep each floor as its own top-level `const LEVEL_*` array.** Both tools find
levels by that name: `validate-level.js` scrapes them out of the HTML with a
regex, and `harness.js`'s `loadWithLevel` substitutes a fixture into `LEVEL_1`.
Inlining them into the `LEVELS` literal would blind both.

Per-floor counts move as levels are edited, so `run-tests.js` deliberately does
not assert on them — that is `validate-level.js`'s job, and its one-line summary
per floor is the place to read them off.

## Floors, and the tally between them

`startLevel(n, carry)` is the only entry point. `carry` is what separates
descending from restarting:

- **descending** (`nextLevel()`): health, ammo and score come with you.
- **restarting** (`P`, or dying): they reset.

Either way kills and keycards are per-floor — the tally screen reports *this*
floor's ratios, and last floor's keys open nothing here.

`clearLevel()` no longer writes a one-line banner. It opens `#tally`, the Wolf3D
percentage screen, and `stepTally` rolls the rows up one at a time. Payout:

```
time bonus  = max(0, round(PAR_TIME[floor] - levelTime)) * 10
per category = 2500, and only at a clean 100%
```

`finishTally()` is the single payout path — the roll-up calls it when it lands
and the action key calls it to skip ahead, so watching the animation and
skipping it award exactly the same total. There is a test for that, because an
early version paid the skip path nothing.

The action key (`E`, `Space`) does two different things on that screen: the
first press settles the roll-up, the second rides the elevator. Clearing the
last floor sets `gameState = 'won'` and shows the OUT banner instead.

---

## Tooling in this folder

Run both before shipping any change. Neither needs a browser.

```sh
node reference/run-tests.js          # 137 assertions against the real game loop
node reference/validate-level.js     # map geometry + key-gated reachability, all 3 floors
```

**`harness.js`** — stubs canvas and DOM, then `eval`s the actual `<script>`
block out of `wolf3d.html` with a probe object spliced in before the IIFE
closes. It is not a mock: a passing test means that code path really executed.
Point it at another build with `load({ htmlPath })`, or
`WOLF3D_HTML=path node reference/run-tests.js`.

**`run-tests.js`** — boot, render, enemy AI, combat, doors, keycards, pickups,
push-walls, death, restart, level clear, treasure counters, floor advance, the
tally payout, and the CEO fight.

Two ordering rules bite here. `startLevel()` with no argument restarts the
**current** floor, so any test that has moved off floor 1 must reset explicitly
— the multi-floor group ends with `P.startLevel(0)` for exactly that reason. And
fixtures still have to come last, for the reason below.

**Mutation-tested, and this is the part that matters.** Bugs are injected into
copies of the game and the suite must go red for every one. It has not always:
three push-wall mutations (a slab that blocks neither rays nor bodies, and a
secret pushable forever) passed a fully green suite, because nothing asserted
those behaviours. Green is not the same as covered. When you add a system, add a
mutation for it and confirm the suite goes red.

The Phase 1 battery covered the item guard, the treasure counters, the floor
advance and its carry rules, every branch of the tally payout, and all four
CEO behaviours (phases, summoning, the kill denominator, the elevator gate).

**Fixtures.** `loadWithLevel(rows, opts)` loads the real game with `LEVEL_1`
swapped for a map you supply, derived from current source so it cannot go stale.
It exists because the shipped level puts every push-wall in an open corridor and
so cannot exercise a blocked push at all.

Two traps, both of which produced silent false passes:

- **Pass `{ htmlPath: process.env.WOLF3D_HTML }`.** Without it a fixture loads
  the pristine build while you believe you are testing a mutated one, and every
  assertion passes for the wrong reason.
- Loading replaces process globals, so the previously loaded instance stops
  stepping. Call fixtures after the tests that use the shipped level.

**`validate-level.js`** — row widths, sealed border, exactly one spawn, an exit
exists, every locked door has its keycard placed, key-gated flood fill proving
the exit is reachable, a stranded-entity report, and push-wall checks. Verified
against seeded faults including two subtle ones: a keycard locked behind the
door it opens, and a push-wall with a free neighbour that still cannot be
shoved because there is nowhere to stand on the opposite face.

The flood fill models a secret the way the engine does — passable only when the
cell beyond it is free — so treasure behind a legitimately pushable wall counts
as reachable, and treasure behind a wedged one does not.

### Writing tests

Set `P.player.x/y/a` directly rather than walking the player there. Two early
tests failed for the boring reason that the player had been dropped behind a
wall — `place()` in `run-tests.js` exists to avoid that, checking both
`blockAt` and `hasLOS` before committing to a spot. Use `g.el(id)` rather than
`g.els.id`; banner elements don't exist until the game first asks for them, and
reaching into `els` directly will crash a failing test instead of reporting it.

**Make sure the assertion can fail for the reason you think.** The first
single-use push-wall test stood a secret against solid rock and checked it did
not move. It passed — but it would have passed with the phase guard deleted too,
because the wall was wedged regardless. The test proved nothing until it was
rebuilt against a secret with two clear tiles ahead. A test you have never seen
go red is a guess.

Both tools exit non-zero on failure, so they drop straight into CI.

---

## Bugs already made here, so they aren't made twice

- Enemy movement applied its y-step twice when the x-step was blocked, giving
  double sideways speed. Axis-separated collision needs two independent `if`s,
  never an `if/else if` followed by a bare `if`.
- The ceiling depth ramp was inverted — overhead shaded as distant, the horizon
  as near. Ceiling distance must fall to zero directly overhead.
- Four pickups shipped sealed inside the lobby kiosks with no opening. This is
  exactly what `validate-level.js` now catches, and the reason it exists.
- A `cat` of this very file inside an unquoted shell heredoc interpolated and
  corrupted `README.md` — and, later, this file, which carried a second copy
  of itself in this bullet for two commits. Write repo files with the Write
  tool or a quoted heredoc.
- `pushSecret` guarded its path with `cellAt` and `occupied` but not items, so a
  slab could land on a pickup and seal it away for good. Fixed with `itemAt`.
  Any new guard on a moving thing needs to ask what else can occupy a tile.
- That fix immediately failed three of the shipped level's own push-walls, whose
  treasure pockets were one-wide dead ends — geometry in which a two-tile slide
  can *never* leave the loot reachable, whatever the guard does. `todo.md` had
  recorded the bug as "latent, not live, every legal push was enumerated". It
  was live, and the enumeration was wrong. Turning the rule on in the validator
  found all three in one run; enumerating by hand had found none.
