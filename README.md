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
| `P`             | restart floor                     |
| `Esc`           | pause (also releases the mouse)   |
| `M`             | mute audio and music              |

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
- **Hitscan pistol** with an ASCII view-model, muzzle flash, and weapon bob.
- **Status bar** — score, kills, health, ammo, keycards, and a face portrait
  that degrades as you take damage.

### The floors

Three hand-authored 40x40 maps, each an array of strings in its own
`LEVEL_*`. Legend:
`#` panel, `|` window, `N` neon sign, `D` door, `R`/`B` locked doors, `X` exit,
`g` guard, `d` drone, `+` ramen, `a` battery cell, `r`/`b` keycards,
`$` crypto wallet, `@` spawn.

| | floor | route |
|---|---|---|
| 1 | ATRIUM · SUBLEVEL | red keycard → red door → blue keycard → blue door → elevator |
| 2 | R&D · SERVER FARM | clean-room keycards in both lab wings → red door → atrium → blue door |
| 3 | EXECUTIVE SUITE | red keycard in the cubicle farm → boardroom → kill the CEO → elevator |

Floor 1 is 12 enemies, 39 pickups, 4 doors, 3 secret push-walls; floors 2 and 3
run 15 enemies apiece. `node reference/validate-level.js` prints the current
counts, and proves every floor's exit is reachable through its keycard gates.

Secret walls look exactly like the panelling they hide in — press `E` facing a
wall and it grinds back two tiles into an alcove. The status bar tracks how many
you have found, and the end-of-floor tally scores kills, secrets and treasure
against par time. Floor 3 ends with the CEO, who re-tunes himself through three
phases and summons drones on the last one.

## Tech

- Vanilla JS, no build step required to run or test
- `ascii_city.html` is one self-contained file, ~34 KB
- `wolf3d.html` is a 14-file source tree that bundles into one ~110 KB file
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
  check, engine notes

The shooter is split for development and bundled for shipping: the two are the
same program, and `reference/run-tests.js` is run against both. See
`reference/CLAUDE.md` for the file map, the load order, and why the split is
classic scripts rather than ES modules.

Backing systemd unit: `~/.config/systemd/user/ascii-city.service`.
Public exposure: `tailscale funnel --https=8443 --set-path=/city`.
