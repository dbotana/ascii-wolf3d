'use strict';

// Keyboard, mouse-look and pointer lock. Registers its listeners at load, so
// it must come after gfx.js, which owns the canvas element it binds to.

// ─── INPUT ──────────────────────────────────────────────────
const keys = new Set();
let mouseLocked = false;
let firePressed = false;

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d','e','r',' '].includes(k)) e.preventDefault();
  if (keys.has(k)) return;
  keys.add(k);
  if (k === ' ')     firePressed = true;
  if (k === 'e')     use();
  if (k === 'm')     toggleMute();
  if (k === 'r')     { if (gameState === 'playing') startReload(); }
  if (k === 'p')     startLevel(gameState === 'won' ? 0 : levelIndex);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (!mouseLocked && canvas.requestPointerLock) { canvas.requestPointerLock(); return; }
  firePressed = true;
});
document.addEventListener('pointerlockchange', () => {
  mouseLocked = document.pointerLockElement === canvas;
});
addEventListener('mousemove', e => {
  if (!mouseLocked || gameState !== 'playing') return;
  player.a += e.movementX * 0.0022;
});
