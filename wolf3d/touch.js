'use strict';

// Twin-stick touch controls. Binds its listeners at load, so like input.js it
// must follow gfx.js — and it must follow input.js, whose state it writes.
//
// The overlay is the only new INPUT path; there is no new game logic behind it.
// Firing sets the same `firePressed` edge and `mouseHeld` flag the mouse does,
// so the semi-auto / hold-to-repeat split in frame() is reused rather than
// reimplemented, and the buttons call use(), startReload(), togglePause() and
// selectWeapon() — the same calls the key handlers make.
//
// The one thing that could not be reused is movement. The keyboard is binary
// and a stick is analog, so `touchMove` is added to updatePlayer's vector and
// the normalise there became a CLAMP. That change is behaviour-identical for
// the keyboard — one key is a magnitude of exactly 1 and a diagonal is √2, and
// clamping leaves both where normalising put them — which is the claim the
// suite asserts rather than assumes.
//
// ── Layout
//
// Left: a FIXED ring at the bottom corner rather than one that appears under
// the thumb. A fixed ring needs no getBoundingClientRect anywhere in this file
// — the knob is a transform of the raw pointer delta — which keeps the whole
// module free of layout reads, and free of the DOM surface the headless stub
// does not implement.
//
// Right: a drag surface, not a second stick. It is what every mobile shooter
// uses, it maps straight onto the mouse-look delta that already exists, and it
// costs one element.

// ─── TOUCH ──────────────────────────────────────────────────
const TOUCH_DEADZONE  = 0.18;    // fraction of the ring radius that reads as centre
const TOUCH_RADIUS    = 52;      // px from the ring's centre to full deflection
const TOUCH_RUN_AT    = 0.85;    // deflection past which you are running
const TOUCH_LOOK_RATE = 0.0042;  // radians of yaw per px dragged

// x is strafe (screen-right positive), y is forward. Read by updatePlayer.
let touchMove = { x: 0, y: 0 };
let touchRun = false;
// Yaw banked since the last frame. Accumulated rather than applied directly
// because a pointermove can fire several times between frames, and applying it
// on the spot would turn while the game is paused.
let touchLookD = 0;
// Has this device ever produced a touch? Gates the overlay, and gates the
// canvas's pointer-lock request — a tap synthesises a mousedown, and asking a
// phone for pointer lock on every shot is at best a no-op.
let touchActive = false;

/**
 * Raw pixel offset from the ring's centre -> a movement vector.
 *
 * Pure, and deliberately so: it is the only part of the overlay a headless test
 * can reach, and it holds every number worth getting wrong — the dead zone, the
 * rescale, the clamp at the rim, and the run threshold.
 *
 * `y` is negated because screen-down is a positive delta and forward is up.
 */
function stickVector(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!len || len < TOUCH_RADIUS * TOUCH_DEADZONE) return { x: 0, y: 0, run: false };
  const k = Math.min(1, len / TOUCH_RADIUS);
  // Rescale so the edge of the dead zone is 0 rather than TOUCH_DEADZONE, or
  // the stick jumps to a fifth of full speed the instant it leaves centre.
  const t = (k - TOUCH_DEADZONE) / (1 - TOUCH_DEADZONE);
  return { x: dx / len * t, y: -dy / len * t, run: k >= TOUCH_RUN_AT };
}

function setTouchMove(x, y, run) {
  touchMove.x = x; touchMove.y = y;
  touchRun = !!run;
}
function addTouchLook(d) { touchLookD += d; }
/** Hand the banked yaw to updatePlayer and reset. */
function consumeTouchLook() { const d = touchLookD; touchLookD = 0; return d; }

// Everything below is DOM wiring, and every piece of it is optional: the
// headless harness has no pointer events and no matchMedia, so each binding is
// guarded and the module is inert there rather than throwing at load.

function markTouchActive() {
  if (touchActive) return;
  touchActive = true;
  const stage = document.getElementById('stage');
  if (stage && stage.classList) stage.classList.add('touch');
}

function bind(id, type, fn) {
  const node = document.getElementById(id);
  if (!node || !node.addEventListener) return null;
  node.addEventListener(type, fn);
  return node;
}

// A button that does one thing on press. preventDefault stops the browser
// synthesising a mousedown on the canvas underneath, which would ask for
// pointer lock and, on the fire button, fire a second time.
function tapButton(id, fn) {
  bind(id, 'pointerdown', e => {
    if (e && e.preventDefault) e.preventDefault();
    markTouchActive();
    fn();
  });
}

// ── the movement stick
(function bindStick() {
  const pad = document.getElementById('tStickPad');
  const knob = document.getElementById('tKnob');
  if (!pad || !pad.addEventListener) return;
  let id = null, ox = 0, oy = 0;

  const moveKnob = (dx, dy) => {
    if (!knob || !knob.style) return;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, TOUCH_RADIUS / len);
    knob.style.transform = 'translate(' + (dx * k).toFixed(1) + 'px,' +
                                          (dy * k).toFixed(1) + 'px)';
  };

  pad.addEventListener('pointerdown', e => {
    if (e && e.preventDefault) e.preventDefault();
    markTouchActive();
    id = e.pointerId; ox = e.clientX; oy = e.clientY;
    if (pad.setPointerCapture) { try { pad.setPointerCapture(id); } catch (err) { /* not captured; moves still arrive */ } }
    moveKnob(0, 0);
  });
  pad.addEventListener('pointermove', e => {
    if (id === null || e.pointerId !== id) return;
    const dx = e.clientX - ox, dy = e.clientY - oy;
    const v = stickVector(dx, dy);
    setTouchMove(v.x, v.y, v.run);
    moveKnob(dx, dy);
  });
  // Every way a touch can stop, including the one that delivers no pointerup:
  // a gesture the system takes over. Without pointercancel the stick sticks and
  // the player walks into a wall forever — the movement half of the held-fire
  // bug that blur and pointerlockchange already exist to prevent.
  const release = e => {
    if (id === null || (e && e.pointerId !== id)) return;
    id = null;
    setTouchMove(0, 0, false);
    moveKnob(0, 0);
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('pointerleave', release);
})();

// ── the look surface
(function bindLook() {
  const pad = document.getElementById('tLook');
  if (!pad || !pad.addEventListener) return;
  let id = null, lx = 0;

  pad.addEventListener('pointerdown', e => {
    if (e && e.preventDefault) e.preventDefault();
    markTouchActive();
    id = e.pointerId; lx = e.clientX;
    if (pad.setPointerCapture) { try { pad.setPointerCapture(id); } catch (err) { /* moves still arrive */ } }
  });
  pad.addEventListener('pointermove', e => {
    if (id === null || e.pointerId !== id) return;
    const dx = e.clientX - lx;
    lx = e.clientX;                 // tracked even when ignored, so no jump on resume
    // The same guard the mouse-look handler carries. Without it a drag under
    // the pause banner banks yaw that snaps the moment play resumes.
    if (gameState !== 'playing') return;
    addTouchLook(dx * TOUCH_LOOK_RATE);
  });
  const release = e => { if (id !== null && (!e || e.pointerId === id)) id = null; };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('pointerleave', release);
})();

// ── fire, held. Sets both the edge and the held flag, exactly as the mouse
//    does, so the pistol's one-shot-per-press and the SMG's hold-to-repeat both
//    come out of frame() unchanged.
(function bindFire() {
  const btn = document.getElementById('tFire');
  if (!btn || !btn.addEventListener) return;
  btn.addEventListener('pointerdown', e => {
    if (e && e.preventDefault) e.preventDefault();
    markTouchActive();
    firePressed = true;
    mouseHeld = true;
    if (btn.setPointerCapture && e.pointerId !== undefined) {
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* still get up */ }
    }
  });
  const release = () => { mouseHeld = false; };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
})();

tapButton('tUse',    () => use());
tapButton('tReload', () => { if (gameState === 'playing') startReload(); });
tapButton('tPause',  () => togglePause());
for (let i = 0; i < 4; i++) {
  (function (n) { tapButton('tW' + n, () => selectWeapon(n)); })(i);
}

// Show the overlay on a device that has no mouse, without waiting for the
// first touch. A desktop browser matches neither branch and never sees it.
(function detectTouch() {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
      markTouchActive();
    }
  } catch (e) { /* no matchMedia: fall back to the first touchstart below */ }
  if (typeof addEventListener === 'function') {
    addEventListener('touchstart', markTouchActive, { once: true, passive: true });
  }
})();
