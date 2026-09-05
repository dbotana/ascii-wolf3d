'use strict';

// Keyboard, mouse-look and pointer lock. Registers its listeners at load, so
// it must come after gfx.js, which owns the canvas element it binds to.

// ─── INPUT ──────────────────────────────────────────────────
const keys = new Set();
// One digit per weapon, in roster order. A seventh weapon would want a
// non-digit here, which is the point at which this stops being a slice.
const WEAPON_KEYS = WEAPONS.map((w, i) => String(i + 1));
let mouseLocked = false;
let firePressed = false;
// held, as opposed to firePressed, which is one edge. The auto weapons read
// this every frame; the pistol only ever sees the edge.
let mouseHeld = false;

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  // WEAPON_KEYS is derived from the roster rather than typed out, so a new
  // row in WEAPONS binds its own key and stops its digit scrolling the page.
  if (['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d','e','r',' ',
       'tab'].includes(k) || WEAPON_KEYS.includes(k)) e.preventDefault();
  if (keys.has(k)) return;
  keys.add(k);
  if (k === ' ')     firePressed = true;
  if (k === 'e')     use();
  if (k === 'm')     toggleMute();
  // Esc both pauses and, as its browser default action, exits pointer lock —
  // which pauses too, through pointerlockchange below. The default action runs
  // AFTER dispatch, so this lands first and that handler then finds a floor
  // already paused and no-ops. Chrome swallows the keydown entirely, which is
  // exactly why the lock handler carries the same call.
  if (k === 'escape') togglePause();
  if (k === 'r')     { if (gameState === 'playing') startReload(); }
  if (k === 'p')     startLevel(gameState === 'won' ? 0 : levelIndex);
  if (WEAPON_KEYS.includes(k)) pickWeapon(+k - 1);
  if (k === 'tab')   toggleMinimap();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  // A tap synthesises a mousedown AFTER the overlay's own handlers have run.
  // Pointer lock on a touch device is at best a no-op and at worst swallows
  // the shot, and preventDefault on the overlay cannot be relied on across
  // every browser's mouse emulation. touch.js declares touchActive and loads
  // after this file; the handler body only runs on an event, long after.
  if (touchActive) return;
  if (!mouseLocked && canvas.requestPointerLock) { canvas.requestPointerLock(); return; }
  // both, deliberately: the edge drives the semi-auto path and the tally
  // screen, the held flag drives the auto weapons. frame() may act on both in
  // the same frame, which is harmless only because fire() sets its own
  // cooldown before it returns — don't reorder that.
  firePressed = true;
  mouseHeld = true;
});
// every way the button can stop being down, including the ones that never
// deliver a mouseup: releasing the pointer lock with Esc, and losing focus
addEventListener('mouseup', e => { if (e.button === 0) mouseHeld = false; });
addEventListener('blur', () => { mouseHeld = false; keys.clear(); pauseGame(); });
document.addEventListener('pointerlockchange', () => {
  mouseLocked = document.pointerLockElement === canvas;
  if (!mouseLocked) { mouseHeld = false; pauseGame(); }
  else resumeGame();
});
addEventListener('mousemove', e => {
  if (!mouseLocked || gameState !== 'playing') return;
  player.a += e.movementX * 0.0022;
});
