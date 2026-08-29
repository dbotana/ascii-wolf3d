# WOLFENSTAIN 3D — next steps

Roadmap for `wolf3d.html`. Three floors, the CEO fight, core combat, sliding
doors + keycards, secret push-walls, the magazine/feedback pass and the
end-of-floor tally are in — Phase 1 is done. Phase 2 closed the enemy engine
gaps: pathfinding, separation, patrols and rotations. The restructure pass then
split the single file into `wolf3d/*.js` and gave it a bundler. Phase 3 added
the weapon roster, the semi-auto pistol, difficulty levels and a damage
direction arc. Phase 4 is the presentation pass: thin-wall doors with frames,
pause, music, death frames and blood, and a HUD that no longer escapes the CRT
overlay. Open work is
ordered roughly by value per hour of work; everything finished is collected
under **Completed** at the bottom.

Entries below name the function and the file it lives in rather than a line
number — line numbers drift with every edit, and the file map in
`reference/CLAUDE.md` says which file owns what.

---

## Phase 5 — infrastructure

- [ ] **Wire the tools into CI.** All four are built and all four exit non-zero
  already; nothing runs them automatically. A pre-commit hook or a GitHub action
  calling `node reference/run-tests.js && node reference/validate-level.js &&
  node reference/check-structure.js` — plus the same suite against
  `WOLF3D_HTML=dist/wolf3d.html` — is the whole job.
- [ ] **Keep the mutation battery.** The suite has been mutation-tested five
  times by injecting bugs into copies of the game: 16 at the MVP, 20 over the
  Phase 1 systems, 14 over the Phase 2 movement systems, 31 over Phase 3, and
  11 over Phase 4 — of which **seven survived a fully green suite** across the
  runs, and several turned out to be real gaps. Every pass has had to rebuild
  the harness from scratch to check its own work, and every pass has found
  something: Phase 4's survivor was a jamb rejection whose deletion the suite
  could not see, because the one oblique ray under test pointed the direction
  another guard already covered.

  All five batteries live only in session scratch. Porting them to
  `reference/mutate.js` is the highest-value item in Phase 5 — the shape is
  already stable (copy the tree, patch one file, run the suite against the
  copy, assert it goes red), and Phase 4's was a ten-line shell script over a
  directory of one-line Python patches. One caveat worth carrying over: a
  mutation can be **unkillable by construction** rather than merely uncovered,
  and Phase 4 has a documented example. The battery needs a way to mark those
  so they are not chased twice.
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
- `castRay` (`wolf3d/raycast.js`) computes `Math.abs(1 / cosA)`, which is
  `Infinity` when the angle is exactly axis-aligned; combined with a player
  sitting exactly on a grid line it would produce `NaN`. Not reachable in
  practice — JS `Math.cos` returns `6.1e-17` rather than `0` at ±π/2 — but it
  is a latent trap if angles are ever snapped to exact multiples of π/2. The
  thin-wall door branch added in Phase 4 divides by the same `cosA`/`sinA` and
  lands harmlessly: a near-zero divisor yields a huge `t`, which fails the
  `t > limit` test and marches on.
- `zbuf` is a fresh `new Float32Array(COLS)` every frame, allocated in `frame()`
  in `wolf3d/main.js`. Harmless at 160 columns, but it is per-frame garbage;
  hoist it if the profile ever matters.
- `frontCell` (`wolf3d/world.js`) probes three fixed distances (0.6 / 1.1 / 1.6)
  along the facing vector to find what you are trying to use. Crude, and it can
  pick a diagonal neighbour at odd angles.
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

- [x] **Phase 4 — presentation.** All six items, shipped together. The suite
  went 270 assertions → 350, and an 11-bug mutation battery covers the new
  systems. **One of the six turned out not to be a bug**, and one of the eleven
  mutations is unkillable by construction — both below.
  - **The view-dependent door slide did not exist.** The entry claimed `wallX`
    ran along opposite axes depending on the hit face, so a door retracted left
    from one side and right from the other. It cannot: a well-formed door is
    flanked by solid cells on the axis it slides into, so the DDA can only
    enter it through the two faces perpendicular to travel — `side` is always
    the *same* value for a given door. Measured on the pre-Phase-4 build before
    touching anything: rays fired at the same physical point on a slab from
    both sides returned `wallX = 0.2500`, both orientations, with the half-open
    slice passing and blocking identically either way. What a player sees — a
    door sliding toward world-north reading as leftward from one side and
    rightward from the other — is what a real sliding door does. **This is the
    second Phase todo in a row to describe a problem that was not there**,
    after the Phase 3 melee cone. Both were caught by measuring first.
  - *So the mutation for it is unkillable, and is recorded rather than fixed.*
    Swapping `c.axis` for the DDA's `side` in the `lat` line of `castGrid`
    survives the full suite, because for any door the validator will accept the
    two are equal. `c.axis` is kept — `t` genuinely needs it and one source for
    both lines is the honest form — but no test claims to cover the difference,
    because none can.
  - *Thin-wall doors are the mid-plane crossing, and the frame is free.* On
    stepping into a door cell `castGrid` discards the march's own hit and
    solves for the slab at the tile centre. A ray steep enough to leave the
    tile first falls through the `lat` range test and the DDA carries on to the
    flanking wall's face — half a tile proud of the slab. **That is the recess;
    nothing draws it.** The `jamb` flag exists only to tint those cells steel.
    Head-on distance goes 2.5u → 3.0u on the corridor fixture, exact to 1e-6.
  - **Deleting the `lat` range test survived a green suite**, because the
    oblique ray the first test used pointed north: it lands at `lat < 0`, which
    `lat < c.open` skips anyway. Only a *southward* ray lands at `lat > 1`,
    where nothing else catches it — and the symptom is a door hit reported at a
    point that is not on the door, handing the renderer a `wallX` above 1. The
    fix is a 138° sweep asserting every door hit lands on the slab: 65 of 234
    hits were off it with the test removed.
  - *`validate-level.js` gained a door-flanking rule*, because the engine will
    not tell you. A free-standing door renders correctly head-on and only
    misbehaves at oblique angles. Verified against two seeded faults — an
    opened flank and a door walled in on all four sides — before being
    believed.
  - *Pause is `gameState`, and the half worth testing is the half that was
    never gated.* Movement, firing, enemies, items, nav and mouse-look already
    checked `gameState`, so they cost nothing. `frame()` now skips the rest as
    a block: doors, secrets, the gun, the reload cycle, the damage pops, the hp
    chip and `animT`. The sharpest probe is `e.bob`, which advances at the TOP
    of `stepEnemies` before its own state guard and so keeps ticking on a dead
    or cleared screen — if it freezes under pause, the call really was skipped
    rather than leaning on a guard that was already there.
  - *Esc pauses, and so does losing pointer lock.* Chrome swallows the `Escape`
    keydown that exits pointer lock, so the key alone would do nothing there;
    `pointerlockchange` carries the same call. Where the keydown IS delivered
    it lands first (the default action runs after dispatch) and the lock
    handler then finds a floor already paused and no-ops. `blur` pauses too.
    Resume on Esc, E, Space or regaining the lock. No existing key moved —
    restart had already been shuffled once, R → P, in the Phase 1 pass.
  - *The status bar went under the overlays rather than into the canvas.*
    Rendering it as ASCII cells is the more authentic option and was rejected:
    it costs viewport rows, re-implements the face, hp bar and keycard lamps as
    glyphs, and `syncHud()` would stop writing DOM — which is what every HUD
    assertion in the suite reads. The whole diegetic layer dropped 7 → 3;
    modals stay above at 8 and 10 because they are read, not inhabited.
  - *Death frames subdivide `DEATH_TIME`; they do not lengthen it.* Same 0.45s
    window, same FSM clock, so nothing in the timing moved. `DEATH_SEQ` holds
    sprite **objects** rather than names, with frame 0 of each being the
    existing `SPR[type + 'Die']` — which is why the death-frame assertion that
    predates the sequences still passes untouched.
  - *Decals are sprites, because the floor is drawn by row.* A true floor decal
    needs per-column floor casting, which this renderer does not do; a flat
    sprite at foot height is exactly what a corpse frame already is, so
    `drawSprite` blits them with no new code path. They sort with a small depth
    bias so a splat lands behind the corpse lying on it. Jitter is checked
    against `cellAt` and folded back onto the corpse tile if it lands in a wall
    — **and that guard is invisible from a body on a tile centre**, where ±0.35
    of jitter can never leave the tile. The test had to place a corpse hard
    against a wall; 29 of 64 splats end up buried with the check removed.
  - *Music is a table and a lookahead scheduler.* Four tracks — one per floor
    plus the boardroom — as `[semitone, beats]` voice lists, scheduled ~0.25s
    ahead against `audio.currentTime` rather than the frame clock. It hangs off
    `masterGain`, so `M` mutes it for free and it does not duck when a gunshot
    pushes `sfxGain`. A track change is held until the bass voice wraps, which
    is one bar, so the CEO reveal does not cut a note in half. The plan's idea
    of adding a `dest` argument to `blip`/`noiseBurst` did not survive contact:
    music needs *absolute* start times and both helpers schedule relative to
    `currentTime`, so the two voices are their own dozen lines.
  - **The harness got a fake AudioContext, and it earned its place
    immediately.** Everything above about music was otherwise untestable — the
    harness has no audio, so `stepMusic` returned at line one and its loops
    never ran. `load({ audio: true })` installs a recording stand-in with a
    tickable clock; the scheduler group is 13 assertions covering the lookahead
    window, the bar-aligned hand-over, mute keeping the clock but not the notes,
    and pause dropping the track. Three of the eleven mutations land here.
  - *Two of my own mistakes, recorded in `reference/CLAUDE.md`.* A fixture
    wrote `#.D.#` for the north-south door — free-standing, so `axis` fell
    through to a default that happened to be the right answer and four
    assertions passed while testing nothing. And an atlas bound was asserted
    from a group running near the end of the suite, where the palette has
    legitimately grown past the boot-time `< 500` figure; it measured group
    ordering, not the feature.

- [x] **Phase 3 — combat depth.** All four items, shipped together. The suite
  went 192 assertions → 269, and a 31-bug mutation battery covers the new
  systems. **Three of the first twenty survived a fully green suite** —
  `enemyShot`'s accuracy and damage multipliers, and a floor filtered down to
  zero enemies never being caught — because every difficulty assertion up to
  that point was structural (table shape, spawn counts) rather than behavioural
  (does a harder setting actually hurt more). Fixed with a 500-sample test that
  drives real hits through `enemyShot` and measures hit rate and per-hit damage
  separately, so dropping either multiplier fails its own assertion. The battery
  run was still going when this entry was written; see the note below.
  - *The roster is a table, and it landed as a pure refactor first.* `WEAPONS`
    in a new `wolf3d/weapons.js` — data only, per rule 2 — with the pistol row
    reproducing the shipped numbers exactly (0.28s, 22-41, 8-round magazine,
    9-tile alert, no spread). That row is why the entire existing suite stayed
    at **192/192 unchanged** through the indirection, which is a stronger claim
    than "still green": it is the same game until you press a number key.
    `art.js` was 307 lines and nine more art tables would have crossed the
    400-line budget, so the table went to its own file rather than where
    `reference/CLAUDE.md` said to put it — rule 4 outranks a filename, and that
    note has been corrected.
  - **The melee "problem" did not exist, and the mutation battery is what
    proved it.** Both the plan and its review said the screen-space hit test
    collapses at contact range, so the knife needed an angular cone. It does
    not: `|centerCol - aim| > halfW` has `depth` on both sides and it cancels,
    leaving `|lateral| > wW/2` — a cylinder test that behaves identically at
    0.2u and 20u. A mutation that replaced the cone with the ordinary column
    test **survived a green suite**, which is what sent anyone to check the
    algebra. The cone came back out; melee is now one number, `minDepth: 0`,
    against the 0.35 dead zone every gun keeps. One aiming model, one branch
    fewer, and the reason is in `weapons.js` so it is not re-derived.
  - *Spread is jitter in screen columns, and that is the only reason distance
    matters.* Since the hit test is depth-independent, all of an SMG's
    inaccuracy is a fixed column jitter against a target whose half-width is
    59/depth columns. It is rolled **once per shot, outside the candidate
    loop** — rolling per enemy would give every body its own chance and quietly
    turn spread into a hit test that widens with the size of the crowd. That
    was the second survivor: with one target the two are indistinguishable, so
    it needed a fixture that stacks three bodies on one tile, where the models
    predict 152/300 against 275/300. Measured 275.
  - *Switching truncates the magazine, never tops it up.* `player.ammo` already
    counts the seated rounds, so the surplus falls back to the reserve on its
    own and no accounting changed. The knife is exempt: at capacity 0 the same
    rule would have emptied the gun you were holding and charged you a reload
    for having drawn a blade.
  - *Difficulty scales offence and counts, never health.* Wolf3D's philosophy
    and a practical one: shots-to-kill has to mean the same thing at every
    setting or the damage numbers stop being feedback. Index 2 is the default
    and every multiplier on it is 1.0, so the default IS the pre-difficulty
    game. The `cd` multiplier is applied **at the point of use** rather than in
    `mkEnemy`, because `stepCeoPhase` reassigns `e.spec.cd` outright on a phase
    change and a baked-in multiplier would have evaporated at 62% health with
    every existing CEO assertion still green.
  - *Spawn thinning is a running-ratio walk, not a random roll.* Deterministic,
    order-preserving, exactly `round(n × keep)` bodies, and it never rounds to
    zero — `ratio()` reports an empty category as 100%, so thinning a one-guard
    floor out of existence would have silently paid a perfect kill ratio and
    its 2500 bonus. Reinforcements land on a tile a body already holds and let
    `separateEnemies` push them apart, so there is no new placement logic that
    could drop someone inside a wall.
  - **`begin()` could run twice, and that bug was already in the tree.** The
    splash is not removed for 600ms, so its `parentElement` guard stayed true:
    a difficulty row's click bubbling to `#splash`, or the old click-then-
    keypress race, called it again — two audio graphs and **two
    requestAnimationFrame chains that both re-arm forever**. The harness keeps
    one rAF callback, so no frame-count assertion could ever have seen it; the
    test asserts `begin()`'s idempotence instead. Fixed with a `booted` latch
    rather than `stopPropagation`, because the stub DOM invokes handlers with
    no event object.
  - *The damage arc is derived from `fwd`/`lat`, not from a world `atan2`.*
    Same basis the projection uses, where a positive `lat` is screen-right —
    the quantity `fire()` and `drawSprite` already steer by. The test measures
    the arc's column against `spriteSpan`'s own answer for the same body rather
    than asserting a sign, because reasoning about the sign of `atan2` is
    exactly what shipped `guardLeft`/`guardRight` mirrored in all eight cases.
    The radius is in columns and converted to rows by the 7:12 cell aspect;
    using one radius for both axes draws a tall ellipse that still points the
    right way and so survives review. There is an assertion on the pixel
    radii for that reason.
  - **Damage numbers were minting atlas entries without a bound.** Found while
    quantising the arc's own fade: `drawDmgPops` stringified a continuous alpha
    to two decimals, so every frame of every fade was a new `(glyph, colour)`
    pair — 454 entries against the suite's own 500-entry assertion, 91% of the
    way to tripping it and to the silent `fillText` degradation
    `reference/CLAUDE.md` warns about. Pre-existing, not Phase 3, and now on
    the same 8-step quantisation `mix()` uses: a flat 293 through 1,240 shots.
    The arc's own cost is measured as an A/B over equal frame counts, because
    the neon flicker and the rain mint entries as the clock advances and a
    naive before/after bills those to the feature under test.
  - *`world.js` hit 410 lines, so it split.* `populateEnemies`, `parseLevel`,
    `startLevel` and `nextLevel` moved to `wolf3d/level.js`. Rule 4 says a file
    past 400 is a signal to split rather than a target to fill, and the note
    that says so also says not to answer it by shaving comments.
  - **TO INVESTIGATE — two mutation-battery survivors, confirmed live against
    the current tree, no fix yet for either:**
    - `attack delay ignores difficulty` — deleting the
      `DIFFICULTY[difficulty].cd` multiplier from the `e.atkCd` assignment in
      the `attack` case of `stepEnemies` (`wolf3d/enemies.js`) still passes the
      full suite (270/270). A prior attempt at a fix here did not reproduce red
      against the actual mutation on direct re-check, so nothing currently
      guards this multiplier — needs a real test, not another guess at one.
    - `thinning may empty a floor` — changing the `keep` floor in
      `populateEnemies` (`wolf3d/level.js`) from `Math.max(1, Math.round(mob *
      D.keep))` to plain `Math.round(mob * D.keep)` also still passes the full
      suite (270/270), even though a floor thinned to zero enemies is exactly
      the case `hud.js`'s `ratio()` mishandles (an empty category reads as a
      100% kill ratio). No fix attempted yet.

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
