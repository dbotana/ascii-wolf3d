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

## Tech

- Vanilla JS, single file, ~34 KB source
- Google Fonts: VT323 + IBM Plex Mono
- Palette: sodium orange / CRT green / neon pink+cyan / slate / warm wood
- CSP-safe: no external scripts, images, or audio files

## Files

- `index.html` — served by http.server on port 5060 (localhost)
- `ascii_city.html` — identical copy for reference

Backing systemd unit: `~/.config/systemd/user/ascii-city.service`.
Public exposure: `tailscale funnel --https=8443 --set-path=/city`.
