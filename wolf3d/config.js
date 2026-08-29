'use strict';

// Engine constants, the colour palette and its fog cache, the distance ramps,
// and the status-bar faces. Loaded first: everything downstream reads these,
// and several files use them in top-level initialisers.

// ─── CONFIG ─────────────────────────────────────────────────
const COLS = 160, ROWS = 90;
const CELL_W = 7, CELL_H = 12;
const CANVAS_W = COLS * CELL_W;
const CANVAS_H = ROWS * CELL_H;
const FOV = Math.PI * 0.42;
const MAX_DEPTH = 24;
const PPH = ROWS / 4;         // pixels per world unit at distance 1
const WALL_H = 3;             // every wall is flat-topped, Wolf3D style
const EYE_Z = 1.6;            // player eye height
const FOCAL = COLS / (2 * Math.tan(FOV / 2));
const CLIP_SIZE = 8;          // rounds per magazine before a reload cycle
const KILL_SCORE = { guard: 200, drone: 150, ceo: 5000 };
const RELOAD_TIME = 1.05;     // seconds for the full reload animation

// ─── PALETTE ────────────────────────────────────────────────
const COLOR = {
  fog:'#0A1A2E', fogFar:'#0F2038', fogMid:'#1B2E44',
  slate:'#3A4A5C', slateHi:'#54687E',
  sodium:'#FF9500', sodiumD:'#B0640F',
  crt:'#7FFF6B', crtD:'#4EA044',
  pink:'#FF3B7C', cyan:'#55E6E6',
  window:'#FFD07A',
  floor:'#1A1A22', floorHi:'#282838',
  ceil:'#0C1420', ceilHi:'#16233A',
  steel:'#8A97A6', steelD:'#4A5563',
  keyRed:'#FF3B4E', keyBlue:'#4FA8FF',
  guard:'#C8B090', guardSuit:'#5C6B80', visor:'#55E6E6', visorHot:'#FF3B7C',
  ceoSuit:'#6A5480', ceoTrim:'#FFC24A',
  drone:'#9FB4C8', droneEye:'#FF3B7C',
  blood:'#B3243C',
  gun:'#6E7B8C', gunHi:'#AAB8C8', muzzle:'#FFE9A8',
  cash:'#FFD07A', ramen:'#FF9500', cell:'#7FFF6B',
};

const NEON_PAL = ['sodium', 'pink', 'cyan', 'crt', 'window'];
const SIGN_TEXTS = ['ZAIBATSU', 'NEO-KOBE', 'SYNTHCORP', 'KUROI', 'ORBIT',
                    'MEGADYNE', '電算', 'HELIX', 'BLACKICE', 'SUBSIDIARY'];

function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
const _mixCache = new Map();
function mix(a, b, t) {
  // t quantised to 8 steps so the atlas stays small and bounded
  const q = Math.max(0, Math.min(7, Math.round(t * 7)));
  const k = a + b + q;
  let out = _mixCache.get(k);
  if (out) return out;
  const f = q / 7;
  const A = hex2rgb(a), B = hex2rgb(b);
  const c = [0, 1, 2].map(i => Math.round(A[i] + (B[i] - A[i]) * f));
  out = '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  _mixCache.set(k, out);
  return out;
}
// fade a colour toward fog with distance
function fade(color, d) {
  return mix(color, COLOR.fog, Math.min(1, d / MAX_DEPTH) * 0.92);
}

// ─── CHAR RAMPS ─────────────────────────────────────────────
const WALL_CHARS  = ['█','▓','▒','░','#','%','&','+','=',':','.',' '];
const FLOOR_CHARS = ['▒','░','+',':','.','\'','`',' '];
const CEIL_CHARS  = ['▓','▒','░','·','`',' '];
const RAIN_CHARS  = ['|','/','.','\'',':'];

function distChar(d, ramp) {
  const idx = Math.min(ramp.length - 1, Math.floor(d / (MAX_DEPTH / ramp.length)));
  return ramp[idx];
}

// ─── STATUS-BAR FACES (degrade with health) ─────────────────
const FACES = [
  ' ___ \n|o o|\n|\\_/|',   // 100-81  smug
  ' ___ \n|o o|\n| - |',    // 80-61
  ' ___ \n|o o|\n|/-\\|',   // 60-41
  ' ___ \n|- o|\n|/¯\\|',   // 40-21
  ' ___ \n|x o|\n|/O\\|',   // 20-1
  ' ___ \n|x x|\n|_-_|',    // dead
];
