// ─── HEADLESS HARNESS ────────────────────────────────────────────────────────
//
// Runs wolf3d.html's real frame loop under Node with no browser. Stubs just
// enough of canvas + DOM that the game boots, renders, and steps its systems,
// then hands back live references to the internals so tests can drive and
// inspect it.
//
// This is not a mock of the game. It is the actual shipped source, evaluated.
// If a test passes here, that code path really ran.
//
//   const { load } = require('./harness');
//   const g = load();
//   g.step(16, ['w']);          // one 16ms frame with W held
//   g.P.player.hp               // live game state
//
// Limitations: no real pixels (draw calls are counted, not rasterised), no Web
// Audio (initAudio fails its try/catch, so sfx() is a no-op), no fonts. None of
// those affect game logic.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_GAME = path.join(__dirname, '..', 'wolf3d.html');

// Everything the game reaches for on `internals`, exposed to tests.
const PROBE_SRC = `global.__PROBE = {
  player, keys,
  enemies: () => enemies,
  items:   () => items,
  doors:   () => doorList,
  grid:    () => grid,
  state:   () => gameState,
  totalEnemies: () => totalEnemies,
  atlasSize:    () => atlasNext,
  atlasCap:     () => ATLAS_MAX,
  levelTime:    () => levelTime,
  startLevel, fire, use, castRay, blockAt, hasLOS, cellAt,
  // secrets arrived after the MVP; typeof-guarded so older builds still load
  secrets:       () => (typeof secretList    !== "undefined" ? secretList : []),
  totalSecrets:  () => (typeof totalSecrets  !== "undefined" ? totalSecrets : 0),
  secretsFound:  () => (typeof secretsFound  !== "undefined" ? secretsFound : 0),
  pushSecret:    (typeof pushSecret !== "undefined" ? pushSecret : null),
};`;

function extractScript(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
  if (!m) throw new Error('no <script> block found in ' + htmlPath);
  const src = m[1];
  // The game is one IIFE ending in `})();`. Splice the probe in just before it
  // closes, so tests get the real bindings rather than copies.
  const tail = '})();';
  const at = src.lastIndexOf(tail);
  if (at < 0) throw new Error('could not find the closing `})();` of the game IIFE');
  return src.slice(0, at) + PROBE_SRC + '\n' + src.slice(at);
}

function load(opts) {
  const o = opts || {};
  const htmlPath = o.htmlPath || DEFAULT_GAME;

  // ── canvas stub: count draws, rasterise nothing
  let drawCalls = 0;
  const ctx2d = {
    imageSmoothingEnabled: false, font: '', textBaseline: '', fillStyle: '',
    clearRect() {}, fillRect() {}, drawImage() { drawCalls++; },
    fillText() { drawCalls++; },
  };

  // ── DOM element stub
  const mkEl = () => ({
    _handlers: {},
    classList: {
      _s: new Set(),
      add(c)    { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, v) {
        if (v === undefined) this._s.has(c) ? this._s.delete(c) : this._s.add(c);
        else v ? this._s.add(c) : this._s.delete(c);
      },
    },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    style: {},
    // #sKeys needs two children (red + blue keycard lamps)
    children: [
      { classList: { _s: new Set(), toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); },
                     contains(c) { return this._s.has(c); } } },
      { classList: { _s: new Set(), toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); },
                     contains(c) { return this._s.has(c); } } },
    ],
    parentElement: {},
    textContent: '',
    remove() { this.parentElement = null; },
    getContext: () => ctx2d,
    width: 0, height: 0,
    requestPointerLock() {},
  });

  const els = {};
  const winHandlers = {};
  let now = 0;
  let rafCb = null;

  global.window = {};                       // no AudioContext -> audio disabled
  global.document = {
    getElementById(id) { return (els[id] || (els[id] = mkEl())); },
    createElement() { return mkEl(); },
    addEventListener(type, fn) { winHandlers['doc:' + type] = fn; },
    fonts: null,
    pointerLockElement: null,
    exitPointerLock() {},
  };
  global.addEventListener = (type, fn) => {
    (winHandlers[type] || (winHandlers[type] = [])).push(fn);
  };
  global.performance = { now: () => now };
  global.requestAnimationFrame = cb => { rafCb = cb; };

  // eslint-disable-next-line no-eval
  eval(extractScript(htmlPath));

  // Boot the game the way a player does: click the splash.
  els.splash._handlers.click();
  const P = global.__PROBE;

  return {
    P,
    els,
    /** Safe element accessor — creates on demand, exactly like getElementById.
     *  Prefer this over reaching into `els`, which is only populated once the
     *  game has actually asked for a given id. */
    el(id) { return (els[id] || (els[id] = mkEl())); },

    get drawCalls() { return drawCalls; },
    resetDrawCalls() { drawCalls = 0; },

    /**
     * Advance one frame.
     * @param {number} ms   frame duration; the game clamps dt to 50ms
     * @param {string[]} held  keys down this frame, e.g. ['w','shift']
     */
    step(ms, held) {
      P.keys.clear();
      if (held) for (const k of held) P.keys.add(k);
      now += (ms === undefined ? 16 : ms);
      if (rafCb) { const cb = rafCb; rafCb = null; cb(now); }
    },

    /** Advance n frames with the same keys held throughout. */
    run(n, held, perFrame) {
      for (let i = 0; i < n; i++) {
        if (perFrame) perFrame(i);
        this.step(16, held);
      }
    },
  };
}

let fixtureN = 0;

/**
 * Load the real game with LEVEL_1 swapped for a purpose-built map, so a test
 * can construct geometry the shipped level does not happen to contain (a
 * push-wall facing solid rock, a one-tile-clearance corridor, and so on).
 *
 * The fixture is derived from the current source rather than checked in, so it
 * cannot go stale.
 *
 * NOTE: loading replaces process globals, so the previously loaded instance
 * stops stepping. Call this after the tests that use the shipped level.
 */
function loadWithLevel(rows, opts) {
  const o = opts || {};
  const htmlPath = o.htmlPath || DEFAULT_GAME;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const body = rows.map(r => "    '" + r + "',").join('\n');
  const out = html.replace(/const LEVEL_1 = \[[\s\S]*?\n\s*\];/,
                           'const LEVEL_1 = [\n' + body + '\n  ];');
  if (out === html) throw new Error('could not substitute LEVEL_1 into ' + htmlPath);
  const tmp = path.join(os.tmpdir(), `wolf3d-fixture-${process.pid}-${fixtureN++}.html`);
  fs.writeFileSync(tmp, out);
  try { return load({ htmlPath: tmp }); }
  finally { try { fs.unlinkSync(tmp); } catch (e) { /* best effort */ } }
}

module.exports = { load, loadWithLevel, DEFAULT_GAME };
