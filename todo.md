# WOLFENSTAIN 3D — next steps

Roadmap for `wolf3d.html`. Three floors, the CEO fight, core combat, sliding
doors + keycards, secret push-walls, the magazine/feedback pass and the
end-of-floor tally are in — Phase 1 is done. Open work is ordered roughly by
value per hour of work; everything finished is collected under **Completed** at
the bottom.

File references are to `wolf3d.html` unless noted, and they drift every time the
file grows — grep the function name if one looks wrong. Line numbers below
predate the combat-feedback pass and have all shifted; treat them as hints.

---

## Phase 2 — engine gaps that will bite as levels get bigger

Both of the first two are **confirmed empirically**, not suspected.

- [ ] **Enemy pathfinding.** `chase` (`:1113`) steers directly at the player with
  axis-separated collision and no route planning. Measured: a guard asked to
  reach a player around a corner closed from 9.5u to 4.2u and then jammed —
  past its own 3.2u standoff, with no line of sight. It slid along the wall and
  stopped. Fix with a coarse BFS/flow-field over the tile grid, recomputed
  every ~0.5s per awake enemy (the map is only 40x40, this is cheap), and steer
  toward the next waypoint instead of at the player.
- [ ] **Enemy-to-enemy collision.** Measured: after 6.6s of a group chase the two
  closest live enemies were **0.009u apart** — fully overlapping. Add a cheap
  separation step in `stepEnemies` (`:1073`): push apart any two live enemies
  within ~0.7u. O(n²) is fine at 12-30 enemies.
- [ ] **Enemy patrols.** Idle enemies are stationary (`:1090`) — they stand still
  until they see you. Give each a waypoint loop or a random-walk-along-corridor
  behaviour so the floor feels inhabited before the shooting starts.
- [ ] **Directional enemy sprites.** `enemySprite` (`:1221`) returns one
  front-facing sprite regardless of viewing angle, so guards always face you
  even when walking away. Wolf3D used 8 rotations. Even 4 (front/back/left/
  right), picked from `atan2(e.y - player.y, e.x - player.x)` minus the enemy's
  own heading, would be a large readability upgrade. Enemies need a `heading`
  field first — `chase` currently never stores one.

---

## Phase 3 — combat depth

- [ ] **Weapon roster.** Only the pistol exists (`GUN_IDLE` at `:586`, `fire` at
  `:1005`). Add knife (melee, no ammo), SMG (fast, auto), chaingun (spin-up).
  Number keys select. `fire()` needs per-weapon cooldown, damage, spread, and
  ammo cost; the view-model blit in `drawGun` (`:1302`) already takes any art
  table, so new weapons are mostly new ASCII art.
- [ ] **Semi-auto pistol.** Holding Space currently auto-fires at the 0.28s
  cooldown (`:1540`). Wolf3D's pistol was one shot per press. Gate the hold-to-
  fire path behind the weapon's own `auto` flag once the roster lands.
- [ ] **Difficulty levels.** "Can I play, Daddy?" through "I am Death incarnate" —
  scale enemy damage, accuracy (`p` in the `attack` case), and spawn counts.
  Pick it on the splash screen.
- [ ] **Damage direction indicator.** `hurtPlayer` (`:1060`) flashes the whole
  screen red. Show which side the shot came from so ambushes are readable.

---

## Phase 4 — presentation

- [ ] **Thin-wall doors with frames.** Doors currently fill their whole tile, so
  they sit flush with the wall plane. Real Wolf3D doors sit at the tile centre
  with a visible recess. Requires proper thin-wall raycasting: on hitting a door
  cell, step to the mid-plane and test there. `castRay` (`:780`) already
  computes `wallX` and already slips rays through the opened slice (`:809`), so
  this is an extension of machinery that exists, not a rewrite.
- [ ] **Door slide direction is view-dependent.** `wallX` runs along opposite
  axes depending on which face you hit, so the same door appears to retract left
  from one side and right from the other. Cosmetic and easy to miss, but it is
  wrong. Fix by deriving the slide direction from the door's own fixed axis
  rather than from the hit face.
- [ ] **Status bar sits above the scanlines.** `#statusbar` is `z-index: 7`
  (`:94`) and `#stage::before` (the scanline overlay) is `z-index: 6` (`:60`),
  so the HUD escapes the CRT treatment the viewport gets. Either move the bar
  under the overlay or render it into the canvas as ASCII cells.
- [ ] **Music.** Audio is ambience plus one-shots (`initAudio` at `:1326`, `sfx`
  at `:1410`). A procedural chiptune march, muted with the rest under `M`, would
  do a lot for the parody.
- [ ] **Pause.** No pause exists. `gameState` (`:647`) already gates movement,
  firing and enemies, so a `'paused'` value is a small addition.
- [ ] **Blood decals / gib frames.** Corpses persist (good) but death is two
  frames. More frames, plus floor decals, would sell the hits.

---

## Phase 5 — infrastructure

- [ ] **Wire the harness and validator into CI.** Both are built (see
  **Completed**) and both exit non-zero already; nothing runs them
  automatically. A pre-commit hook or a GitHub action calling
  `node reference/run-tests.js && node reference/validate-level.js` is the whole
  job.
- [ ] **Keep the mutation battery.** The suite has been mutation-tested twice by
  injecting bugs into copies of the game: 16 at the MVP, 20 more over the
  Phase 1 systems. It catches all of them, but only after the Phase 1 run
  exposed two behaviours with no assertion behind them. Three of the original sixteen
  initially slipped through, and one test was a false pass. Both batteries live
  only in session scratch — porting them to `reference/mutate.js` would keep the
  suite honest as it grows, and this is now the highest-value item in Phase 5:
  the Phase 1 pass had to rebuild the harness from nothing to check its own
  work.
- [ ] **Move levels out of the source file.** All three floors are inline and
  are now ~120 of `wolf3d.html`'s lines. Load them from a separate `levels.js` —
  still CSP-safe, still no build step, but the game file stops growing. Note
  that both tools find floors by the `const LEVEL_*` name: `validate-level.js`
  regexes them out of the HTML and `harness.js` substitutes fixtures into
  `LEVEL_1`. Moving them means teaching both where to look.
- [ ] **Persist high scores.** `localStorage`, guarded by try/catch — it throws
  in some privacy contexts.
- [ ] **Touch / mobile controls.** Currently keyboard + pointer-lock mouse only;
  unplayable on a phone. A twin-stick overlay would work given the fixed
  viewport.
- [ ] **Deployment.** The city is served by a systemd unit and exposed via
  `tailscale funnel` (see `README.md`). Decide whether the shooter joins it at a
  second path or gets its own unit.

---

## Known minor issues

- `reference/CLAUDE.md` shipped with the entire document duplicated inside one
  bullet of its own "bugs already made here" list — caused by exactly the
  unquoted-heredoc interpolation that bullet warns about. Repaired in the
  Phase 1 pass; noted here because the same mistake would be invisible in a
  diff that only reads the top of the file.

- `castSecrets` divides by `cosA`/`sinA` for its slab test and so shares the
  latent axis-aligned trap described immediately below; same reasoning, same
  non-reachability in practice.
- Two adjacent push-walls could still be pushed into one another (see the last
  bullet in this list). Now that there are three floors' worth of secrets, that
  is worth a validator check rather than a curiosity — no shipped floor places
  two secrets adjacent, but nothing enforces it.
- `castRay` (`:791`) computes `Math.abs(1 / cosA)`, which is `Infinity` when the
  angle is exactly axis-aligned; combined with a player sitting exactly on a
  grid line it would produce `NaN`. Not reachable in practice — JS `Math.cos`
  returns `6.1e-17` rather than `0` at ±π/2 — but it is a latent trap if angles
  are ever snapped to exact multiples of π/2.
- `zbuf` is a fresh `new Float32Array(COLS)` every frame (`:1556`). Harmless at
  160 columns, but it is per-frame garbage; hoist it if the profile ever matters.
- `frontCell` (`:970`) probes three fixed distances (0.6 / 1.1 / 1.6) along the
  facing vector to find what you are trying to use. Crude, and it can pick a
  diagonal neighbour at odd angles.
- The atlas holds only ~80 entries in normal play against a 32768 cap, so there
  is plenty of headroom for new colours and glyphs.
- `castSecrets` returns `mapX`/`mapY` truncated from a fractional slab origin.
  Nothing reads them — the wall renderer uses `cell`, `side`, `wallX` and the
  corrected distance — so they are dead fields rather than a bug, but they would
  be wrong if anything started trusting them.
- Two adjacent secrets could in principle be pushed into one another: a slab in
  transit is out of `grid`, so `cellAt` cannot see it and the second push would
  not stop short. It needs two adjacent push-walls and precise timing, and the
  shipped level has none, so this is a curiosity rather than a task.

---

## Completed

Newest first. Kept for the design notes — several record why an approach that
looks obvious was not the one taken.

- [x] **Phase 1 — the rest of the Wolf3D feature set.** Three items, shipped
  together; the suite went 74 assertions → 145, and a 20-bug mutation battery
  confirms each new assertion can go red. Two of those twenty initially slipped
  through — the CEO's standoff and its burst fire had no assertion behind them
  at all, and deleting either left the suite fully green. Both now have one.
  - *End-of-level tally.* `#tally` replaces the one-line clear banner: time
    against par, then kill / secret / treasure ratios rolling up a row at a
    time with a tick per few percent. `totalTreasure` had to be counted at
    **parse time** rather than off the item list, because `dropLoot()` appends
    ammo to `items` mid-level and would otherwise inflate the denominator every
    time you killed something. Payout is the time bonus plus 2500 per category,
    and **only at a clean 100%** — Wolf3D paid nothing for 99%. `finishTally()`
    is the single payout path so skipping the roll-up awards exactly what
    watching it does; an early version paid the skip path nothing.
  - *Push-walls no longer strand pickups.* `itemAt` joins `cellAt` and
    `occupied` in `pushSecret`'s span loop. **The todo entry that described this
    as "latent, not live" was wrong** — turning the same rule on in
    `validate-level.js` failed three of the shipped floor's own secrets on the
    first run, all of them treasure pockets one tile wide. That geometry can
    never work: the slab stops *short* of the loot, so it always parks between
    you and it. All three pockets were widened to two tiles across the slide
    axis so you can walk around the landed slab. The lesson is in
    `reference/CLAUDE.md`; the enumeration that "proved" it was safe had found
    none of them.
  - *Three floors and the CEO.* `LEVELS[]` plus `startLevel(n, carry)`, where
    `carry` is what separates descending (health, ammo and score come with you)
    from restarting (they reset); kills and keycards are per-floor either way.
    Floors 2 (R&D · server farm) and 3 (executive suite) are new 40x40 maps,
    both authored against the validator rather than by eye. The CEO is an
    ordinary member of `enemies` with a `phase` that re-tunes its own `spec` as
    its health falls — three phases, the last of which summons drones and
    **increments `totalEnemies`** so the kill ratio stays honest. Its elevator
    refuses to move while it is alive. The burst fire it needed turned into
    `enemyShot()`, shared by the whole roster at `burst: 1`.

- [x] **Ammo economy, reload cycle, and combat feedback.** Five changes shipped
  together, all verified by driving the real game in a headless browser rather
  than by inspection.
  - *Ammo drops.* ~14 extra `a` pickups seeded across `LEVEL_1`, plus
    `dropLoot()` on kill — guards 55%, drones 30%, landing on the corpse tile so
    the drop is always reachable. Measured 98/200 over guards.
  - *Magazine model.* `player.clip` is what is seated, `player.ammo` the total;
    firing decrements both. **The starting reserve had to change from 8 to 24**:
    at 8 the clip consumed the entire reserve, so `startReload`'s "anything in
    reserve" guard could never pass and the gun could never be refilled. Pickups
    now grant `CLIP_SIZE` so the two stay in sync if it is retuned.
  - *Reload animation.* Four 13-col frames (`GUN_DOWN`/`EJECT`/`SEAT`/`RAISE`)
    over 1.05s, eased down and back up. `R` reloads, or a trigger pull on an
    empty clip starts it. HUD reads `8/24`, `--/24` mid-cycle. Two new SFX.
  - *Damage numbers.* `addDmgPop` anchors a number to the enemy's world position;
    it rises on a decelerating ease and fades. Cream for hits, pink `!` for
    kills, sideways jitter so rapid hits do not stack, depth-tested against
    `zbuf`, with a dark shadow row for legibility over bright walls.
  - *Health feedback.* A bar with a lagging red "chip" layer that drains at
    60hp/s behind the live fill, a 0.42s shake-and-brighten on hit, and
    `#hpVignette` — a border tint at `(1 - hp/100)²`, so 0 at full health,
    0.11 at 65hp, 0.58 at 20hp, 0.9 at death.
  - *Keys.* `R` was restart and is now reload; **restart moved to `P`**. Splash
    text and both banner hints updated.
- [x] **Secret push-walls.** Done. `S` parses to a `tag: 'panel'` cell carrying a
  `secret` flag, so it renders through the ordinary panel branch with a seed from
  the same formula — verified bit-identical in depth and glyph to its neighbours.
  The door lerp turned out not to be reusable: `open` slides a face *laterally*
  within one tile (`wx < c.open` in `castRay`), whereas a push-wall recedes along
  the depth axis and its faces stop being tile-aligned — that is the thin-wall
  problem deferred to Phase 4. Instead a wall in transit is lifted out of `grid`
  into `movingSecrets` and intersected as a plain 1x1 box (`castSecrets`), with
  the nearer of box/DDA hit winning; idle and landed walls are ordinary grid
  cells, so the box test only runs during the ~1.1s slide. `secretsFound` /
  `totalSecrets` are in the status bar and the cleared banner. 3 secrets placed.
- [x] **Headless test harness.** Done — `reference/harness.js` stubs canvas and
  DOM and `eval`s the real `<script>` out of `wolf3d.html`, so a passing test
  means that code path actually executed. `reference/run-tests.js` drives 74
  assertions across boot, render, enemy AI, combat, doors, keycards, pickups,
  push-walls, death, restart and level clear. `loadWithLevel(rows)` swaps
  `LEVEL_1` for a fixture derived from current source, for geometry the shipped
  level does not happen to contain.
- [x] **Level validator.** Done — `reference/validate-level.js`: row widths,
  sealed border, one spawn, an exit, keycards for every locked door, key-gated
  flood fill, stranded-entity report, and push-wall checks (a wall with a free
  neighbour is still wedged if there is nowhere to stand on the opposite face).
