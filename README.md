# ASCII Rain City

A walkable text-based cyberpunk metropolis. Single-file HTML, canvas rendered
as monospace ASCII, DDA raycaster, procedural audio. Runs in any modern browser.

Live public build: `https://blackice.taila0726f.ts.net:8443/city/`

## Controls

| key           | action                     |
|---------------|----------------------------|
| `W A S D`     | walk / strafe              |
| `Left`/`Right`| turn                       |
| `Shift`       | run                        |
| `Q` / `E`     | elevator down / up (0.5-8u)|
| `Enter`       | enter door / confirm exit  |
| `M`           | mute audio                 |

## v2 features

- **Atlas cache** — every (char, color) pair is rendered once into an off-screen
  atlas canvas; each frame blits sprites with `drawImage`. No per-cell `fillText`
  in the hot loop. Solid 60fps on 160x90 = 14400 cells.
- **Interiors** — some buildings have doors. Step onto the tile, hit `Enter`,
  and the scene swaps to a small bar/diner interior (bar counter, lit window,
  branded sign). Step through the exit gap to return.
- **Elevator** — camera height ranges from street-level 0.5u up to rooftop 8u,
  changing wall projection through the raycaster.
- **NPCs** — 22 pedestrians and 8 cars wander the streets. Rendered with
  proper z-buffer culling so buildings occlude them.
- **Procedural audio** — Web Audio only, no external files. Filtered
  white-noise rain + detuned-saw traffic hum + proximity-modulated neon
  buzz near sign buildings.

## WOLFENSTAIN 3D — Neon Reich

`wolf3d.html` — an ASCII Wolfenstein 3D parody built on the same engine. You
raid a megacorp arcology: salaryman guards, sec-drones, sliding shutters,
keycards, and an elevator out.

| key             | action                            |
|-----------------|-----------------------------------|
| `W A S D`       | move / strafe                     |
| `Left`/`Right`  | turn (or mouse, click to capture) |
| `Shift`         | run                               |
| `Space` / click | fire                              |
| `E`             | open door / use switch / search walls |
| `R`             | reload                            |
| `1` … `4`       | knife / pistol / SMG / chaingun    |
| `Tab`           | show or hide the auto-map         |
| `P`             | restart floor                     |
| `Esc`           | pause (also releases the mouse)   |
| `M`             | mute audio and music              |

On a touch device an overlay appears on its own: left half is an analog
movement stick, right half drags to look, with fire, use, reload, pause and a
weapon row. It is completely absent on a mouse machine.

### What it reuses

The atlas glyph cache, DDA raycaster, billboard sprite projection with z-buffer
occlusion, procedural Web Audio, and the CRT/scanline shell all come straight
from `ascii_city.html`. The city itself is untouched.

### What is new

- **Sliding doors** — `castRay` now returns `wallX` (where along the wall face
  the ray landed) and lets rays slip through the opened slice of a door, so a
  half-open shutter really does show the room behind it. Red and blue keycards
  gate the route.
- **Enemies** — an `idle → alert → chase → attack → hurt → dead` state machine
  with line-of-sight checks that reuse `castRay`. Gunfire and barks wake nearby
  guards.
- **Multi-cell sprites** — the city drew one char per NPC; this scales ASCII art
  into a projected screen rect with per-column z-testing.
- **Four weapons, earned** — knife, pistol, SMG and chaingun, each an ASCII
  view-model with muzzle flash and weapon bob. You start with the knife and the
  pistol; five kills buys the SMG and ten the chaingun, and each arrives loaded
  and already in your hands. The count is for the whole run, so it carries down
  the floors with your health and ammo, and a restart puts it back.
- **Auto-map** — a scrolling 25x25-tile window in the corner that fills in only
  where you have walked or looked, marking doors, keycards and the elevator once
  you have seen them, plus anything alerted and hunting you within 8 tiles. It
  never points at the objective. `Tab` hides it.
- **Status bar** — score, kills, health, ammo, keycards, a four-slot weapon
  strip that doubles as the progress bar toward the next gun, an objective line
  naming what this floor wants from you, and a face portrait that degrades as
  you take damage.

### The floors

Three hand-authored 40x40 maps, each an array of strings in its own
`LEVEL_*`. Legend:
`#` panel, `|` window, `N` neon sign, `D` door, `R`/`B` locked doors, `X` exit,
`g` guard, `d` drone, `+` ramen, `a` battery cell, `r`/`b` keycards,
`$` crypto wallet, `@` spawn.

| | floor | route |
|---|---|---|
| 1 | ATRIUM · SUBLEVEL | plain door → red keycard (west office) → red door → blue keycard (neon office) → blue door → elevator |
| 2 | R&D · SERVER FARM | both keycards in mirrored lab wings behind plain doors → red door → clean room → blue door |
| 3 | EXECUTIVE SUITE | red keycard in a corner office off the aisle → red door → boardroom → kill the CEO → elevator |

Every floor is built the same way: one 3-wide spine runs north from the spawn to
the elevator, every room hangs off it as a bay of about 7x6, and the locked
doors sit *on* the spine — so you meet the lock before you go looking for its
key, and the floor states its own puzzle up front. A ring corridor loops each
floor so backtracking is never retracing. The first draft was four or five very
large open halls per floor and was close to unnavigable; the layout language is
written up in `reference/CLAUDE.md`.

Floors run 15, 15 and 17 enemies and 50-55 pickups.
`node reference/validate-level.js` prints the current counts, and proves every
floor's exit is reachable through its keycard gates.

Secret walls look exactly like the panelling they hide in — press `E` facing a
wall and it grinds back two tiles into an alcove. The status bar tracks how many
you have found, and the end-of-floor tally scores kills, secrets and treasure
against par time. Floor 3 ends with the CEO, who re-tunes himself through three
phases and summons drones on the last one.

## Tech

- Vanilla JS, no build step required to run or test
- `ascii_city.html` is one self-contained file, ~34 KB
- `wolf3d.html` is a 19-file source tree that bundles into one ~178 KB file
- Google Fonts: VT323 + IBM Plex Mono
- Palette: sodium orange / CRT green / neon pink+cyan / slate / warm wood
- CSP-safe: no external scripts, images, or audio files

## Files

- `index.html` — the city, served by http.server on port 5060 (localhost)
- `ascii_city.html` — identical copy for reference
- `wolf3d.html` — WOLFENSTAIN 3D: the development manifest (markup + script tags)
- `wolf3d/` — the shooter's source tree, one file per subsystem
- `dist/wolf3d.html` — the shooter as one self-contained file. **Generated** by
  `node reference/bundle.js`; never edit it directly. This is the build to
  deploy or hand to someone.
- `reference/` — headless test harness, level validator, bundler, structure
  check, mutation battery, engine notes
- `.github/workflows/` — CI: the four checks on every push, and the mutation
  battery weekly
- `deploy/` — the systemd unit behind the live build

The shooter is split for development and bundled for shipping: the two are the
same program, and `reference/run-tests.js` is run against both. See
`reference/CLAUDE.md` for the file map, the load order, and why the split is
classic scripts rather than ES modules.

## Checks

Nothing here needs a browser, and nothing needs `npm install` — there are no
dependencies.

```sh
node reference/run-tests.js                               # 523 assertions against the real game loop
WOLF3D_HTML=dist/wolf3d.html node reference/run-tests.js  # ...and against the shipped bundle
node reference/validate-level.js                          # map geometry + key-gated reachability
node reference/check-structure.js                         # src tags resolve, no ESM, dist current
node reference/bundle.js                                  # rebuild dist/wolf3d.html
node reference/mutate.js                                  # inject known bugs; the suite must go red
```

The mutation battery is a ratchet: it is green while its known gaps hold
steady and red the moment a new one appears, or an old one is closed without
dropping its marker.

All of them exit non-zero on failure. GitHub Actions runs the first four on
every push and pull request, against both the split tree and the bundle; the
mutation battery runs weekly and on demand, because it is a quarter-hour job.

There is an opt-in pre-commit hook that runs the same checks locally:

```sh
git config core.hooksPath reference/hooks     # undo: git config --unset core.hooksPath
```

It runs the two static tools always and the full suite only when a staged path
can affect it. Note it validates the working tree rather than the index, so a
partially staged commit is checked against what is on disk.

## Deployment

One server, two paths. A user systemd unit serves the **repo root** on
`127.0.0.1:5060` — see `deploy/ascii-city.service`, which is checked in — and
`tailscale funnel` is the only thing that exposes it:

```sh
# the city, as before
tailscale funnel --bg --https=8443 --set-path=/city    http://127.0.0.1:5060/

# the shooter, a second path on the same funnel and the same unit
tailscale funnel --bg --https=8443 --set-path=/wolf3d  http://127.0.0.1:5060/dist/wolf3d.html

tailscale funnel status
```

| | url |
|---|---|
| the city | `https://blackice.taila0726f.ts.net:8443/city/` |
| the shooter | `https://blackice.taila0726f.ts.net:8443/wolf3d` |

**A path can be mapped straight at the one file because the bundle has no local
dependencies.** `dist/wolf3d.html` inlines its CSS and all nineteen scripts; the
only request it makes is the Google Fonts stylesheet. The development tree could
not be served this way — its relative `<script src>` paths would need the whole
directory proxied — which is the practical reason the bundle exists at all,
beyond being nice to hand to someone.

Shipping a change:

```sh
node reference/bundle.js          # dist/wolf3d.html is GENERATED — never hand-edit it
node reference/check-structure.js # fails if dist/ is stale, so this cannot ship half-done
git commit && git push
ssh <host> 'cd ~/Github/ascii-rain-city && git pull'
```

No restart: the unit serves files off disk, so a `git pull` is the deploy. The
unit only needs `systemctl --user restart ascii-city` if the unit file itself
changed.
