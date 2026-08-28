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
| `R`             | restart floor                     |
| `M`             | mute audio                        |

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

### The floor

One hand-authored 40x40 map, held as an array of strings in `LEVEL_1`. Legend:
`#` panel, `|` window, `N` neon sign, `D` door, `R`/`B` locked doors, `X` exit,
`g` guard, `d` drone, `+` ramen, `a` battery cell, `r`/`b` keycards,
`# ASCII Rain City

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

 crypto wallet, `@` spawn.

12 enemies, 22 pickups, 4 doors, 3 secret push-walls. The route is red keycard
→ red door → blue keycard → blue door → elevator.

Secret walls look exactly like the panelling they hide in — press `E` facing a
wall and it grinds back two tiles into an alcove. One is in the west corridor,
one in the east office, one beside the elevator. The status bar tracks how many
of the three you have found.

Not in this MVP: the end-of-level percentage tally, floors 2-3 and the boss.

## Tech

- Vanilla JS, single file, ~34 KB source
- Google Fonts: VT323 + IBM Plex Mono
- Palette: sodium orange / CRT green / neon pink+cyan / slate / warm wood
- CSP-safe: no external scripts, images, or audio files

## Files

- `index.html` — served by http.server on port 5060 (localhost)
- `ascii_city.html` — identical copy for reference
- `wolf3d.html` — WOLFENSTAIN 3D, the shooter parody
- `reference/` — headless test harness, level validator, engine notes

Backing systemd unit: `~/.config/systemd/user/ascii-city.service`.
Public exposure: `tailscale funnel --https=8443 --set-path=/city`.
