'use strict';

// The glyph atlas and the one primitive every renderer bottoms out in.
//
// Naively this would be 14,400 fillText calls per frame. Instead each distinct
// (char, colour) pair is rasterised once into an off-screen canvas and blitted
// with drawImage. It only works because mix() quantises its blend factor, so
// distance fog yields a bounded set of colours — keep new colours coming from
// mix()/fade() or the atlas fills and silently degrades to fillText.

// ─── ATLAS CACHE (from ascii_city.html — the perf story) ────
const ATLAS_COLS = 512, ATLAS_ROWS = 64;
const ATLAS_MAX = ATLAS_COLS * ATLAS_ROWS;
let atlasCanvas = null, atlasCtx = null;
let atlasFailed = false;
const atlasMap = new Map();
let atlasNext = 0;

function initAtlas() {
  try {
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width  = ATLAS_COLS * CELL_W;
    atlasCanvas.height = ATLAS_ROWS * CELL_H;
    atlasCtx = atlasCanvas.getContext('2d', { alpha: true });
    if (!atlasCtx) throw new Error('no atlas ctx');
    atlasCtx.font = (CELL_H - 1) + "px 'VT323', ui-monospace, monospace";
    atlasCtx.textBaseline = 'top';
    atlasCtx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  } catch (e) {
    atlasFailed = true;
    atlasCanvas = null;
  }
}

function atlasGet(ch, color) {
  const k = ch + '\x00' + color;
  let slot = atlasMap.get(k);
  if (slot !== undefined) return slot;
  if (atlasFailed || atlasNext >= ATLAS_MAX) return null;
  const idx = atlasNext++;
  const sx = (idx % ATLAS_COLS) * CELL_W;
  const sy = ((idx / ATLAS_COLS) | 0) * CELL_H;
  atlasCtx.clearRect(sx, sy, CELL_W, CELL_H);
  atlasCtx.fillStyle = color;
  atlasCtx.fillText(ch, sx, sy);
  slot = { sx, sy };
  atlasMap.set(k, slot);
  return slot;
}

// ─── CANVAS ─────────────────────────────────────────────────
const canvas = document.getElementById('screen');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
ctx.font = (CELL_H - 1) + "px 'VT323', ui-monospace, monospace";
ctx.textBaseline = 'top';

function drawChar(col, row, ch, color) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  if (!ch || ch === ' ') return;
  const slot = atlasGet(ch, color);
  if (slot) {
    ctx.drawImage(atlasCanvas,
      slot.sx, slot.sy, CELL_W, CELL_H,
      col * CELL_W, row * CELL_H, CELL_W, CELL_H);
  } else {
    ctx.fillStyle = color;
    ctx.fillText(ch, col * CELL_W, row * CELL_H);
  }
}

// ─── WALL SHADING ───────────────────────────────────────────
function neonHex(key) {
  switch (key) {
    case 'pink':   return COLOR.pink;
    case 'cyan':   return COLOR.cyan;
    case 'crt':    return COLOR.crt;
    case 'window': return COLOR.window;
    default:       return COLOR.sodium;
  }
}
function wallBase(cell) {
  switch (cell.tag) {
    case 'neon':   return neonHex(cell.signColor);
    case 'window': return COLOR.window;
    case 'exit':   return COLOR.crt;
    case 'door':   return cell.lock === 'red'  ? COLOR.keyRed
                        : cell.lock === 'blue' ? COLOR.keyBlue
                        : COLOR.steel;
    default:       return COLOR.slate;
  }
}
