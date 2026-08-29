# WOLFENSTAIN 3D — next steps

Roadmap for `wolf3d.html`. Three floors, the CEO fight, core combat, sliding
doors + keycards, secret push-walls, the magazine/feedback pass and the
end-of-floor tally are in — Phase 1 is done. Phase 2 closed the enemy engine
gaps: pathfinding, separation, patrols and rotations. The restructure pass then
split the single file into `wolf3d/*.js` and gave it a bundler. Phase 3 added
the weapon roster, the semi-auto pistol, difficulty levels and a damage
direction arc. Phase 4 is the presentation pass: thin-wall doors with frames,
pause, music, death frames and blood, and a HUD that no longer escapes the CRT
overlay. Phase 5 is the infrastructure pass: CI, the mutation battery kept as
a tool rather than rebuilt every time, persistent high scores, touch controls
and a deployment story. Phase 6 closed every coverage gap the battery had
triaged, and the battery now reports none. Open work is
ordered roughly by value per hour of work; everything finished is collected
under **Completed** at the bottom.

Entries below name the function and the file it lives in rather than a line
number — line numbers drift with every edit, and the file map in
`reference/CLAUDE.md` says which file owns what.

---

## Also open

- [ ] **The third atlas A/B is still on the shape that could not fail, and it is
  the only thing standing between the game and an unbounded palette.** The
  decal measurement in the `gore` group is the one Phase 6 did not rebuild: it
  still reads a running total mid-suite rather than an arm per `load()`, and it
  is still unseeded. It measures 18 entries against an idle 1, bound at 60,
  taken 576 entries deep — so it works today only because no earlier group
  happens to draw a splat. That is precisely the dependency that made the arc
  and damage-pop versions unfalsifiable from Phase 3 to Phase 6, and it will
  collapse silently the first time a decal is drawn earlier in the run.

  What makes it urgent rather than tidy: **`mix()`'s `Math.round(t * 7)` is the
  choke point for every colour in the game** — walls, sprites, decals and the
  HUD all arrive through `fade()` → `mix()` — and unquantising it was measured
  against the suite: `522 passed, 1 failed`, and the one failure is this
  assertion (125 entries against its bound of 60). Not the boot `< 500` bound,
  not the late distance-to-cap check, not either of the two new fade A/Bs, which
  inflate both of their arms equally and so cancel it out. The single guard on
  the atlas staying bounded is the single guard still built the wrong way.

  Three things, in order: rebuild it as a seeded load-per-arm A/B like the other
  two; add `mix-unquantised` to `reference/mutations.js` so this is a ratchet
  fact rather than something re-derived by hand every few phases; then check
  whether the boot bound *should* have caught it, because a `< 500` check that
  sails through an unbounded palette is measuring the wrong thing.

- [ ] **`separateEnemies` shoves exactly-coincident bodies the wrong way, once.**
  The coincident branch substitutes `d = 1` as a direction magnitude, and that
  same `1` lands in `shove = (R - d) * 0.5` — negative for any radius under a
  tile, which every pair has. The bodies do come apart, by twice that and in
  the reversed direction, and the following passes push properly once `d` is
  real, so it self-corrects within a few frames and nothing visible is wrong.
  But one call moves a coincident pair 0.10u where the radii say 0.90u, which
  is why the CEO radius test has to iterate to convergence rather than measure
  one pass. Found while writing that test. `shove` wants to be `R * 0.5` in the
  coincident branch; left alone because changing separation is not a
  test-writing change.

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

- [x] **Phase 6 — closing the coverage gaps.** All fifteen, in one pass. The
  suite went 463 assertions → 523 and the battery now reports **0 known gaps**:
  thirteen closed by assertion, two reclassified `unkillable` because the
  behaviour turned out not to be observable at all. Two of the fifteen were not
  missing tests — they were tests that could not fail — and finding that out is
  most of what this pass was.
  - **The two atlas A/B tests had been green since Phase 3 and could not have
    gone red.** They read exactly like what their `gap:` lines asked for: an
    idle arm and an active arm over the same number of frames, so the neon
    flicker and the rain are not billed to the feature. What they missed is that
    **an unquantised fade converges too.** `h.t` and `p.t` advance in fixed 16ms
    steps, so the alpha space is finite either way — ~150 entries for the arc
    against ~6 — and by the time either measurement ran, earlier groups had
    already minted every one of them. Both arms were measuring marginal growth
    after saturation, which is zero under either variant. The fix is not a
    tighter bound: it is that **each arm needs its own `load()`**, so the two
    start from equally cold atlases.
  - *And the rebuilt arms had to be seeded, which was nearly the next bug.* The
    first version measured 6 for the arc — but `mkEnemy` seeds every body's
    `bob` and `patrolT` from `Math.random`, so two loads put their enemies in
    different places and draw different sprite-and-fog pairs. Over fifteen
    trials the arc cost swung **between -1 and 13** against a bound of 24: noise
    of the same order as the figure, and a bound that was one unlucky run from
    flaking. A *constant* pin is the wrong fix — it collapses the damage-number
    jitter to a single position and takes most of the bug with it, 33 against 65
    where the real spread is 177 against 337. Seeded with an LCG both arms are
    exact and repeat to the entry: **6 against 150 for the arc, 177 against 337
    for the pop**, flat from 120 shots through 480.
  - **`fire-span-follows-rotation` is unkillable, and this is the fourth Phase
    todo in a row to describe a problem that was not there.** `fire()` measures
    against `SPR[e.type]` on purpose so that turning never makes a body harder
    to shoot — but every live view of every type already keeps the base width
    (`art.js`: "Every rotation keeps the front sprite's wW/wH/foot"), and
    `fire()` skips `!e.alive` before it measures, so the Die and Dead frames
    that *do* differ are out of reach. Swept exhaustively over every heading ×
    relative bearing × live state for all three types: the two expressions are
    equal for every input `fire()` can see. So the deliverable is the invariant
    rather than the test — the suite now asserts that every live view keeps the
    base width, which is what would stop being true first, and the marker comes
    back off the day someone gives a rotation its own.
  - **`ray-door-behind-face` is unkillable because the `lat` range test subsumes
    it** — the same shape as the two `scores.js` guards, where a broad catch
    swallows its own early-out. `t` is defined so the crossing sits ON the
    mid-plane in one axis, so a crossing behind the entry face is outside the
    cell in the *other* axis, which `lat < 0 || lat >= 1` already rejects.
    Measured against a real mutant on hand-built open-flank geometry: **400,000
    off-grid rays, zero differences.** On a grid, five — every one of them
    exactly 45° through a tile corner, where `lat` lands on exactly 0 (in range,
    by the half-open interval) and `t < perp` is decided by a single ULP between
    two different expressions. Pinning that would assert a rounding accident,
    and no floor can ship the geometry anyway: `validate-level.js` requires
    every door to be flanked on exactly one axis. The guard stays; it states
    intent and costs nothing.
  - *Four seams on the probe, and each one is a different kind of invisible.*
    `navSeedX/navSeedY` and `animT` are plain module state nothing outside their
    own file reads, so a stale flow field and a clock still running under the
    pause banner were both unobservable. `patrolOpen` and a new `spriteList()`
    are the other shape: the answer *is* the behaviour and the caller throws it
    away. `spriteList()` is the one source change — the list build and its sort
    lifted out of `drawSprites`, with the `d + 0.02` push left byte-identical so
    the mutation's anchor still holds.
  - **A plain corridor cannot test the 0.72 straight-line bias.** With the bias
    gone, `fwd` still drops the way back, so the only remaining option is
    straight ahead and both variants walk the same line — a default and a
    correct answer coinciding, which is the third time this repo has shipped
    that fixture. It needs junctions. And rather than sample a random walk and
    tune a margin — the shape that already produced one flaky assertion here —
    `Math.random` is pinned to 0.5 for the duration, which makes `< 0.72` true
    and `< 0.0` false and nothing else. Exact both ways: the guard covers 4.31u
    of its beat and never leaves the corridor line, against 1.0u and 302 frames
    off it. `mkEnemy` seeds `patrolT` randomly, so that has to be zeroed too or
    the "deterministic" fixture drifts by up to 0.65u.
  - *A slab in transit is out of `grid` entirely*, so `inSlab` is the only thing
    that knows it is there. The fixture asserts every frame of the whole slide,
    because the slab covers its ORIGIN tile early and its DESTINATION tile late
    and one sample can only ever catch one of the two — and it asserts that the
    grid has *already* let go of the tile, which is what makes the rest of it
    non-vacuous.
  - *The CEO test needed a control.* "It has not moved" passes just as well on a
    floor where nothing moves at all, so the fixture is three sealed corridors —
    the player, the CEO, and a guard whose pacing is measured in the same
    window. Same reason the jamb fixture asserts the ordinary neighbour IS
    flagged, and the patrol-door fixture asserts the open direction IS open.
  - *The death-frame test reads the sprite sequence; nothing read the clock.* It
    sets `stateT` by hand, so a window four times as long shows the same frames
    over the same fractions and passes unchanged. Counting frames to the
    `dying → dead` transition lands on `DEATH_TIME` to within one, because `dt`
    is exactly 16ms here.

- [x] **Phase 5 — infrastructure.** All five items, shipped together. The suite
  went 350 assertions → 463, the mutation battery stopped being session scratch
  and became `reference/mutate.js` + a 147-bug catalog, and **22 coverage gaps
  were closed on the way** — including both of the Phase 3 survivors this file
  has been carrying. The final run is 128 killed, 15 known gaps, 3 unkillable,
  0 new survivors. Two of the five items turned out to rest on something that
  was not true, and the battery found a flaky assertion and two guards that
  cannot be tested at all; all of it is below.
  - *CI is four tools and no dependencies.* `.github/workflows/ci.yml` runs
    `check-structure` → `validate-level` → the suite → **the suite against
    `dist/wolf3d.html`** → the validator against the bundle, as five named steps
    so a failure is named rather than buried in a chained shell line.
    `check-structure` goes first because it is instant and it is the one that
    catches a stale `dist/`. No `package.json` was added: "no build step
    required to run or test" is a property of this repo and the workflow needs
    nothing from npm. The pre-commit hook is **opt-in** — `git config
    core.hooksPath reference/hooks`, so it stays version controlled and the
    install is one reversible line — and it runs the 40-second suite only when
    a staged path is under `wolf3d/`, `wolf3d.html` or `reference/`.
  - *The battery is a ratchet, not a wall.* 147 mutations, of which 15 survive.
    Shipping a tool that exits non-zero forever would make it a check nobody
    reads, so a triaged survivor carries `gap: '<what it would take>'` and is
    reported loudly without failing the run. What fails is **movement in either
    direction**: a survivor with no marker is a new hole, and a marked mutation
    that dies is coverage being claimed where the marker says there is none.
    The count can fall and never rise.
  - **The anchor check is the whole reason the catalog can be trusted.** A
    `find` string that has drifted makes its patch a no-op, and a no-op mutant
    runs the *pristine* game: green, reported as SURVIVED, sending the next
    reader after a gap that does not exist. Every anchor's occurrence count is
    verified before anything runs, so `--list` alone tells you the catalog has
    rotted. This is the failure mode that would have turned five previous
    batteries into theatre if they had been kept.
  - **The suite had a flaky assertion, and only the battery could have found
    it.** `ok(chainHits < smgHits)` compared two random draws with no margin —
    hit rates of about 0.52 and 0.40 over 200 shots — and reverses roughly
    **one run in 25**. It surfaced because the battery reported a *door*
    mutation as killed by that line, a verdict no door geometry could earn. Now
    600 samples with a 0.92 margin, measured at 0.68-0.85 across 25 trials.
    The direction of the damage is worth keeping: **a flaky suite makes the
    battery under-report**, turning survivors into false kills and never the
    reverse, so the survivor list can be trusted and the kill list cannot quite.
  - **`attack delay ignores difficulty` was not a missing test — it was a test
    measuring the wrong thing.** The assertion drove a guard through the FSM and
    counted entries into `attack`, but it re-armed the state by hand every time
    the guard left it, which skips `e.atkCd` entirely, and it let the player
    die a second in. `stepEnemies` stops stepping live enemies the moment
    `gameState` leaves `'playing'`, so `e.state` froze at `'attack'` with
    `stateT === 0` and the counter ticked once per remaining frame: 195 against
    236 "attacks" are exactly `(4000-864)/16` and `(4000-208)/16`. It was
    measuring **time to death**, driven by `D.dmg` and `D.acc`. Now: never
    re-arm, never let the player die, count FSM-driven volleys over 20s. Six
    runs put the ratio between 1.64 and 1.90 against a table ratio of 1.875,
    and the assertion sits at 1.35.
  - **`thinning may empty a floor` was a guard no shipped table can reach.**
    `Math.round(mob * keep) >= 1` for every `mob >= 1` whenever `keep >= 0.5`,
    and the lowest `keep` in `DIFFICULTY` is 0.65 — so the `Math.max(1, ...)`
    floor never fires, and the existing one-guard test passed identically with
    it deleted. **This is the third Phase todo in a row to describe a problem
    that was not there**, after the Phase 3 melee cone and the Phase 4 door
    slide. The guard is still worth keeping, so the only honest test is to *be*
    the future it defends against: the fixture drops `DIFFICULTY[0].keep` to
    0.1 for two lines and puts it back.
  - *High scores are five slots, four failure modes, and one clock problem.*
    `localStorage` fails three genuinely different ways — absent, throwing on
    the property access itself, and throwing only on `setItem` — so
    `scoreStore()` guards all three and `load({ storage })` can produce each of
    them plus a shared backing map, which is the only way to test that a table
    actually persists across loads. A run ends by **dying or getting out and by
    nothing else**: `P` restart zeroes the score on `startLevel`'s cold path, so
    filing there would enter a partial run and then file the real one again.
  - **The tie-break depended on the clock's resolution.** `recordScore` sorted
    by score then by `at`, meaning to put the newest run above a tie — but
    `Date.now()` is millisecond-resolution, two runs recorded inside one
    millisecond tie on `at` as well, and a stable sort then keeps the *older*
    one. Works in play, fails in any test fast enough to matter, and the test
    caught it on the first run. Fixed by putting the new entry at the front of
    the array before sorting, which decides it without consulting a clock.
  - **Three of the new mutations survived, and only one was a real gap.** The
    battery was run against the systems this pass added, which is the rule this
    repo keeps failing to follow and now enforces. Two `scores.js` early-outs
    turned out to be **unobservable**: delete `if (!store) return false` and
    `null.setItem` throws inside the try two lines below, which returns false
    by another route; delete the `Array.isArray` check and `parsed.filter`
    throws inside the same try, and the catch produces the same empty table. A
    broad catch subsumes its own guards. The third was real and cheap — the
    stick test measured *distance*, and forward and strafe cover exactly the
    same ground, so it passed with the two axes swapped. It asserts a direction
    now.
  - *Touch is one engine change, and it is behaviour-identical.* The overlay
    reuses everything — fire sets the same `firePressed` edge and `mouseHeld`
    flag the mouse does, so the semi-auto / hold-to-repeat split in `frame()` is
    untouched, and the buttons call `use()`, `startReload()`, `togglePause()`
    and `selectWeapon()`. The one thing that could not be reused is movement:
    the keyboard is binary and a stick is analog, so `updatePlayer`'s
    normalise became a **clamp**. A single key is a magnitude of exactly 1 and
    a diagonal is √2, and both land where normalising put them — the whole
    350-assertion suite stayed green through the change, and there is now an
    assertion that a keyboard diagonal is still capped at walking speed.
  - *A fixed ring, not one that appears under the thumb.* That choice keeps
    `getBoundingClientRect` out of the file entirely — the knob is a transform
    of the raw pointer delta — which means no layout reads and no DOM surface
    the headless stub does not implement. The right half is a drag surface
    rather than a second stick: it maps straight onto the mouse-look delta that
    already existed, and it costs one element.
  - *`pointercancel` is not optional.* A touch the system takes over never
    delivers `pointerup`, so without it the stick sticks and the gun fires
    forever — the same class of bug `blur` and `pointerlockchange` already
    exist to prevent. The look pad also carries the mouse handler's
    `gameState !== 'playing'` guard, or a drag under the pause banner banks yaw
    that snaps the instant play resumes.
  - *One unit, two paths.* The shooter joins the city on the same funnel rather
    than getting its own service, and **that is only possible because the
    bundle has no local dependencies**: a funnel path can be mapped straight at
    `dist/wolf3d.html`, where the split tree would need the whole directory
    proxied for its relative `src` paths. `deploy/ascii-city.service` is checked
    in so the deployment stops being undocumented state in one machine's home
    directory.

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
  - **Both survivors are CLOSED in Phase 5, and neither was what this entry
    said it was.** `attack delay ignores difficulty` had a test all along — it
    was measuring time-to-death rather than an attack rate, because it re-armed
    the FSM by hand and then counted frames after the player died.
    `thinning may empty a floor` was a guard **no shipped difficulty table can
    reach**: `Math.round(mob * 0.65) >= 1` for every `mob >= 1`. See the
    Phase 5 entry above for both, and note that "no fix yet" here meant "no
    diagnosis yet" — the fix was cheap once the measurement was right.

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
