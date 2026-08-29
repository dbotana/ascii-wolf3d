# WOLFENSTAIN 3D — next steps

Roadmap for `wolf3d.html`. Three floors, the CEO fight, core combat, sliding
doors + keycards, secret push-walls, the magazine/feedback pass and the
end-of-floor tally are in — Phase 1 is done. Phase 2 closed the enemy engine
gaps: pathfinding, separation, patrols and rotations. The restructure pass then
split the single file into `wolf3d/*.js` and gave it a bundler. Open work is
ordered roughly by value per hour of work; everything finished is collected
under **Completed** at the bottom.

**The line numbers below are stale.** They were written against the single-file
build and every one of them has moved into some `wolf3d/*.js` — grep the
function name instead, and see the file map in `reference/CLAUDE.md` for which
file to look in.

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

- [ ] **Wire the tools into CI.** All four are built and all four exit non-zero
  already; nothing runs them automatically. A pre-commit hook or a GitHub action
  calling `node reference/run-tests.js && node reference/validate-level.js &&
  node reference/check-structure.js` — plus the same suite against
  `WOLF3D_HTML=dist/wolf3d.html` — is the whole job.
- [ ] **Keep the mutation battery.** The suite has been mutation-tested three
  times by injecting bugs into copies of the game: 16 at the MVP, 20 more over
  the Phase 1 systems, 14 over the Phase 2 movement systems — of which **five
  survived a fully green suite** and two turned out to be real bugs. It catches all of them, but only after the Phase 1 run
  exposed two behaviours with no assertion behind them. Three of the original sixteen
  initially slipped through, and one test was a false pass. Both batteries live
  only in session scratch — porting them to `reference/mutate.js` would keep the
  suite honest as it grows, and this is now the highest-value item in Phase 5:
  the Phase 1 pass had to rebuild the harness from nothing to check its own
  work.
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

- [x] **The restructure — split to develop, bundle to ship.** 2,883 lines of
  single-file HTML became a 91-line manifest, `wolf3d/style.css`, and fourteen
  `wolf3d/*.js` files, none over 343 lines. `node reference/bundle.js` collapses
  them back into `dist/wolf3d.html`, which is what deploys. The suite ran green
  after every single file moved, and runs against both representations now.
  - *Classic scripts, not ES modules, and that decision paid for everything
    else.* Top-level `let`/`const` in a classic script live in the shared
    script-level scope and function declarations hoist into it, so N scripts on
    one page are exactly one scope — semantically identical to the IIFE they
    replaced. So **no call site changed**: no namespace object, no import lists,
    every one of the ~2,400 lines moved verbatim. It also makes the bundler
    forty lines of string joining rather than a real bundler, keeps `file://`
    working, and keeps the harness's `eval` honest. ESM would have cost all
    four. The long-term collapse back to one file is `cp dist/wolf3d.html
    wolf3d.html`; `check-structure.js` fails the build if anyone introduces
    `import`/`export` and makes that one-way.
  - *The tooling had to move first, as its own step.* `harness.js` matched one
    attribute-less `<script>` and spliced its probe before the last `})();`;
    `validate-level.js` regexed levels out of the HTML text. Both now walk every
    `<script src>` through one shared `collectSources()`. `loadWithLevel` also
    stopped writing a temp file per fixture — it patches the collected sources
    in memory, which is faster and, more to the point, a temp file in
    `os.tmpdir()` would have resolved its relative `src` paths against the wrong
    directory.
  - **The probe's `typeof` guards would have hidden a broken split.** ~30 names
    in `PROBE_SRC` degrade to `null` for builds that predate them. A build that
    failed to load a file degrades the same way — to silent false passes rather
    than an honest failure. `assertProbe` now checks a manifest on every load and
    throws naming what is missing; verified by deleting a function and watching
    it fire. This was the single highest-value line in the pass.
  - *`drawWalls` came out of `frame()`.* 103 lines of column loop — ceiling,
    floor, wall, EXIT lettering, neon flicker, rain, lit windows — were inlined
    in the main loop with no function boundary. `frame()` is 61 lines now, down
    from 167, and `render.js` could not have existed without the extraction.
  - *`spriteSpan` moved to `raycast.js`.* It lived in COMBAT, but both `fire()`'s
    hit test and `drawSprite()` measure against it. Leaving projection math
    inside one of its two consumers is how they drift, and drift there means
    shooting things you cannot see.
  - *Cross-file writes got names.* `combat.js` assigned `gunFrame`/`gunT` —
    renderer state — and `enemies.js` assigned `hpShown`. Shared scope means you
    *can* write anything from anywhere; `triggerGunFire()` and `chipHpFromNow()`
    are how the next reader finds out that you did.
  - *Verified by line-set identity, not just by green.* Stages 3-5 were pure
    relocations, so the multiset of non-blank source lines had to be unchanged.
    Comparing sorted line sets before and after showed **zero lines lost** — a
    stronger claim than "the tests still pass" for a mechanical move, and it
    costs one shell pipeline.
  - `README.md` was repaired: an unquoted-heredoc accident had spliced a copy of
    its own first 33 lines into the middle of the level legend, mid-sentence.
    That is the exact mistake `reference/CLAUDE.md` warns about in its own
    "bugs already made here" list.

- [x] **Phase 2 — the enemy engine gaps.** All four items, shipped together. The
  suite went 145 assertions → 191, and a 14-bug mutation battery covers the new
  systems. **Five of those fourteen initially survived a fully green suite**, and
  chasing them down found two genuine bugs that the feature tests had missed —
  see the last two bullets. Green is not the same as covered; that has now been
  true in this repo three passes running.
  - *Pathfinding is one flow field, not N searches.* A single BFS over the tile
    grid seeded at **the player**, rebuilt every 0.35s or the moment the player
    crosses a tile line. Every chaser wants the same destination, so per-enemy
    fields would have been N copies of one answer; the original plan's
    "recompute per awake enemy" was more expensive and no better. `chase` still
    steers straight at the player whenever it has line of sight — that reads
    better in an open room than snapping between tile centres — and only drops
    to the field when geometry gets in the way.
  - *The standoff had to be gated on sight, and that was the other half of the
    bug.* The 3.2u standoff was tested against raw euclidean distance, so a
    guard would freeze 3.2u from a player it could not see and had no route to.
    Turning the field on alone did not fix the reported jam: the guard walked
    the corner and then froze one tile short. Both halves were needed, and there
    is a fixture whose geometry doubles the route back past the player behind a
    thin wall specifically to hold that gate honest.
  - *Enemies open unlocked doors, and only unlocked ones.* `navPassable` treats a
    locked door as a wall, because enemies carry no keycards and routing one at a
    door it can never open just parks it there. `openDoorAhead` reuses the two
    lines `use()` runs. Its own lock check is unreachable in play — `navPassable`
    already filtered — so it is **tested directly** rather than left as a branch
    nobody has ever seen work: enemies opening locked doors would unpick every
    keycard gate on all three floors.
  - *Separation.* O(n²) over live bodies only, per-type radii (the CEO claims
    0.55 against everyone else's 0.35, or its summoned drones stand inside its
    jacket), and the shove is applied **through `moveEnemy`** so it can never
    push a body through a wall. The closest live pair after a 6.6s group chase
    went from 0.009u to 0.70u.
  - *Patrols are a leashed corridor random-walk.* Authored waypoint routes were
    rejected: they would have meant new level syntax, validator rules and edits
    to all three floors, for a floor that only needs to look inhabited before the
    first shot. `spawnX`/`spawnY` had been on every enemy since the MVP with
    nothing reading them; they are the leash anchor.
  - *Guards got 4 rotations; drones and the CEO did not.* A drone is a symmetric
    ring of rotors with no front, and the CEO should always be squaring up to
    you. 8 rotations were rejected because at five columns of ASCII the diagonals
    are not distinguishable from the cardinals. `fire()` deliberately still
    measures its hit span against `SPR[e.type]`, so turning sideways never makes
    a guard harder to shoot.
  - **The left/right sprite pair shipped swapped in all eight viewing cases.**
    It was found by measuring which way a guard's `centerCol` actually drifts
    through the game's own projection — not by reasoning about the sign of
    `atan2`, which is exactly what produced the bug. The rotation test now does
    that same measurement rather than asserting a hard-coded pairing, so it
    cannot silently flip back.
  - **The patrol target was recomputed from the enemy's current tile every
    frame**, so it walked ahead of the body forever: the arrival test never
    fired, the direction was never re-picked, and the leash was never consulted a
    second time. A guard walked a 30-tile corridor end to end. Every
    shipped-level assertion passed throughout — the floors are open enough that
    a wandering guard looks like a working guard. It took a fixture built as a
    single long corridor, and a 40s run, to make the failure visible. The
    destination is now latched when the direction is chosen.

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
