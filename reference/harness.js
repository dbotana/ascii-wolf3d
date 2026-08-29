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
// It loads either representation of the game: the development manifest
// (wolf3d.html + wolf3d/*.js, a list of <script src> tags) or the bundled
// single file (dist/wolf3d.html, one inline block). Classic scripts share one
// script scope, so concatenating them in document order and eval'ing the result
// is the same program either way — which is what lets the same suite run
// against both and mean something.
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
  // multi-floor, the tally screen and the CEO arrived in the Phase 1 pass;
  // same typeof guard so the harness still loads a pre-Phase-1 build
  levels:        () => (typeof LEVELS !== "undefined" ? LEVELS : [LEVEL_1]),
  levelIndex:    () => (typeof levelIndex !== "undefined" ? levelIndex : 0),
  nextLevel:     (typeof nextLevel !== "undefined" ? nextLevel : null),
  clearLevel:    (typeof clearLevel !== "undefined" ? clearLevel : null),
  boss:          () => (typeof boss !== "undefined" ? boss : null),
  totalTreasure: () => (typeof totalTreasure !== "undefined" ? totalTreasure : 0),
  treasureFound: () => (typeof treasureFound !== "undefined" ? treasureFound : 0),
  tally:         () => (typeof tally !== "undefined" ? tally : null),
  itemAt:        (typeof itemAt !== "undefined" ? itemAt : null),
  ceoPhases:     () => (typeof CEO_PHASES !== "undefined" ? CEO_PHASES : []),
  // Phase 2: pathfinding, separation, patrols and enemy rotations. Same
  // typeof guard as everything above, so a pre-Phase-2 build still loads.
  navAt:         (typeof navAt !== "undefined" ? navAt : null),
  buildNav:      (typeof buildNavField !== "undefined" ? buildNavField : null),
  navStep:       (typeof navStep !== "undefined" ? navStep : null),
  navPassable:   (typeof navPassable !== "undefined" ? navPassable : null),
  moveEnemy:     (typeof moveEnemy !== "undefined" ? moveEnemy : null),
  openDoorAhead: (typeof openDoorAhead !== "undefined" ? openDoorAhead : null),
  separate:      (typeof separateEnemies !== "undefined" ? separateEnemies : null),
  enemySprite:   (typeof enemySprite !== "undefined" ? enemySprite : null),
  spriteSpan:    (typeof spriteSpan !== "undefined" ? spriteSpan : null),
  spr:           () => SPR,
  // Phase 3: the weapon roster, difficulty, and directional damage.
  curWeapon:     (typeof curWeapon    !== "undefined" ? curWeapon : null),
  selectWeapon:  (typeof selectWeapon !== "undefined" ? selectWeapon : null),
  startReload:   (typeof startReload  !== "undefined" ? startReload : null),
  weapons:       () => (typeof WEAPONS !== "undefined" ? WEAPONS : []),
  setDifficulty: (typeof setDifficulty !== "undefined" ? setDifficulty : null),
  difficulty:    () => (typeof difficulty !== "undefined" ? difficulty : 2),
  difficulties:  () => (typeof DIFFICULTY !== "undefined" ? DIFFICULTY : []),
  populate:      (typeof populateEnemies !== "undefined" ? populateEnemies : null),
  hurtPlayer:    (typeof hurtPlayer   !== "undefined" ? hurtPlayer : null),
  hitDirs:       () => (typeof hitDirs !== "undefined" ? hitDirs : []),
  hitDirAngle:   (typeof hitDirAngle  !== "undefined" ? hitDirAngle : null),
  hitDirCell:    (typeof hitDirCell   !== "undefined" ? hitDirCell : null),
  cellSize:      () => ({ w: CELL_W, h: CELL_H }),
  enemyShot:     (typeof enemyShot   !== "undefined" ? enemyShot : null),
  // Phase 4: pause, thin-wall doors, gore and music.
  pauseGame:     (typeof pauseGame    !== "undefined" ? pauseGame : null),
  resumeGame:    (typeof resumeGame   !== "undefined" ? resumeGame : null),
  togglePause:   (typeof togglePause  !== "undefined" ? togglePause : null),
  decals:        () => (typeof decals !== "undefined" ? decals : []),
  spillBlood:    (typeof spillBlood !== "undefined" ? spillBlood : null),
  deathSeq:      () => (typeof DEATH_SEQ !== "undefined" ? DEATH_SEQ : {}),
  decalSpr:      () => (typeof DECAL_SPR !== "undefined" ? DECAL_SPR : []),
  deathTime:     () => (typeof DEATH_TIME !== "undefined" ? DEATH_TIME : 0.45),
  decalCap:      () => (typeof DECAL_CAP !== "undefined" ? DECAL_CAP : 0),
  music:         () => (typeof MUSIC !== "undefined" ? MUSIC : []),
  musicTrackFor: (typeof musicTrackFor !== "undefined" ? musicTrackFor : null),
  stepMusic:     (typeof stepMusic !== "undefined" ? stepMusic : null),
  musicNow:      () => (typeof musicTrack !== "undefined" ? musicTrack : null),
  musicVoices:   () => (typeof musicVoices !== "undefined" && musicVoices
                          ? musicVoices.map(v => ({ i: v.i, t: v.t })) : null),
  setMuted:      (v) => { muted = !!v; },
  // A test hook, and an honest one: the over-par payout branch is otherwise
  // reachable only by simulating three minutes of frames per assertion.
  setLevelTime:  (v) => { levelTime = v; },
  // Phase 5: persistent high scores.
  loadScores:    (typeof loadScores  !== "undefined" ? loadScores  : null),
  saveScores:    (typeof saveScores  !== "undefined" ? saveScores  : null),
  recordScore:   (typeof recordScore !== "undefined" ? recordScore : null),
  paintScores:   (typeof paintScores !== "undefined" ? paintScores : null),
  winGame:       (typeof winGame     !== "undefined" ? winGame     : null),
  killPlayer:    (typeof killPlayer  !== "undefined" ? killPlayer  : null),
  scores:        () => (typeof highScores  !== "undefined" ? highScores : []),
  scoreSlots:    () => (typeof SCORE_SLOTS !== "undefined" ? SCORE_SLOTS : 0),
  scoresKey:     () => (typeof SCORES_KEY  !== "undefined" ? SCORES_KEY : null),
  levelIndex2:   () => (typeof levelIndex !== "undefined" ? levelIndex : 0),
  // Phase 5: touch. The overlay is pointer events on DOM elements, which the
  // stub cannot deliver, so the probe exposes the SEAM instead: the pure stick
  // math and the two values updatePlayer actually reads.
  stickVector:   (typeof stickVector   !== "undefined" ? stickVector : null),
  setTouchMove:  (typeof setTouchMove  !== "undefined" ? setTouchMove : null),
  addTouchLook:  (typeof addTouchLook  !== "undefined" ? addTouchLook : null),
  touchVec:      () => (typeof touchMove !== "undefined" ? { x: touchMove.x, y: touchMove.y } : null),
  touchRunning:  () => (typeof touchRun  !== "undefined" ? touchRun : false),
  // Phase 6: the seams the coverage pass needed. navSeedX/navSeedY and animT
  // are plain module state that nothing outside their own file reads, so a
  // stale flow field and a clock that keeps running under the pause banner
  // were both invisible. patrolOpen and spriteList are the other shape: the
  // ANSWER is the behaviour and the caller throws it away, so the only way to
  // assert on it is to ask the same question the game asks.
  navSeed:       () => (typeof navSeedX !== "undefined" ? { x: navSeedX, y: navSeedY } : null),
  animT:         () => (typeof animT !== "undefined" ? animT : null),
  patrolOpen:    (typeof patrolOpen !== "undefined" ? patrolOpen : null),
  spriteList:    (typeof spriteList !== "undefined" ? spriteList : null),
};`;

// Names the probe exposes as direct function references. Every one of them is
// `typeof`-guarded in PROBE_SRC so the harness can still load an older build —
// which means a BROKEN LOAD degrades to a pile of nulls and silent false passes
// rather than an honest failure. assertProbe is what makes the guards safe: a
// current build must supply all of these, and a split that drops a file fails
// here with the names it lost instead of somewhere deep in a test.
const REQUIRED_FNS = [
  'startLevel', 'fire', 'use', 'castRay', 'blockAt', 'hasLOS', 'cellAt',
  'pushSecret', 'nextLevel', 'clearLevel', 'itemAt',
  'navAt', 'buildNav', 'navStep', 'navPassable',
  'moveEnemy', 'openDoorAhead', 'separate', 'enemySprite', 'spriteSpan',
  'curWeapon', 'selectWeapon', 'startReload', 'setDifficulty', 'populate',
  'hurtPlayer', 'hitDirAngle', 'hitDirCell', 'enemyShot',
  'pauseGame', 'resumeGame', 'togglePause', 'spillBlood',
  'musicTrackFor', 'stepMusic',
  'loadScores', 'saveScores', 'recordScore', 'paintScores', 'winGame', 'killPlayer',
  'stickVector', 'setTouchMove', 'addTouchLook',
  'patrolOpen', 'spriteList',
];

function assertProbe(P, htmlPath) {
  if (!P) throw new Error('the game did not install its probe — nothing evaluated?');
  const missing = REQUIRED_FNS.filter(k => typeof P[k] !== 'function');
  // The thunks can't be checked by type (they all return something), so spot
  // check the three whose emptiness would mean a data file failed to load.
  if (!P.spr || Object.keys(P.spr()).length === 0) missing.push('SPR (sprite art)');
  if (!P.levels || P.levels().length === 0) missing.push('LEVELS (level data)');
  if (!P.ceoPhases || P.ceoPhases().length === 0) missing.push('CEO_PHASES');
  // weapons.js is its own <script src>. collectSources only throws on a tag
  // whose file is missing, not on a file with no tag — so without this line a
  // forgotten tag evals cleanly and first surfaces as a ReferenceError deep
  // inside fire(), which is exactly the silent-false-pass failure these
  // emptiness checks exist to prevent.
  if (!P.weapons || P.weapons().length === 0) missing.push('WEAPONS (weapon table)');
  if (!P.difficulties || P.difficulties().length === 0) missing.push('DIFFICULTY');
  if (!P.deathSeq || Object.keys(P.deathSeq()).length === 0) missing.push('DEATH_SEQ (gore.js)');
  if (!P.decalSpr || P.decalSpr().length === 0) missing.push('DECAL_SPR (gore.js)');
  if (!P.music || P.music().length === 0) missing.push('MUSIC (track table)');
  if (!P.scoreSlots || !P.scoreSlots()) missing.push('SCORE_SLOTS (scores.js)');
  if (missing.length) {
    throw new Error(
      'incomplete game load from ' + htmlPath + ' — missing: ' + missing.join(', ') +
      '\n(a source file failed to load, or a name moved out of the shared script scope)');
  }
}

/**
 * Every script this page runs, in document order, as `{ path, code }`.
 *
 * Handles both shapes the game ships in: the development manifest, which is a
 * list of `<script src>` tags, and the bundled single file, which is one inline
 * block. They are the same program — classic scripts share one script scope, so
 * concatenating them reproduces browser semantics exactly.
 *
 * External (http/https) scripts are skipped; there are none, and eval'ing one
 * would be a network dependency the game does not have.
 */
function collectSources(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dir = path.dirname(htmlPath);
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = (m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/) || [])[1];
    if (!src) { out.push({ path: htmlPath, code: m[2] }); continue; }
    if (/^https?:/i.test(src)) continue;
    const file = path.resolve(dir, src);
    if (!fs.existsSync(file)) {
      throw new Error('script src "' + src + '" in ' + htmlPath + ' does not exist (' + file + ')');
    }
    out.push({ path: file, code: fs.readFileSync(file, 'utf8') });
  }
  if (!out.length) throw new Error('no script sources found in ' + htmlPath);
  return out;
}

/** Concatenate sources into one program, with the probe appended in scope. */
function buildProgram(sources) {
  return sources.map(s => s.code).join('\n;\n') + '\n' + PROBE_SRC;
}

/**
 * A minimal Web Audio stand-in, for `load({ audio: true })`.
 *
 * The harness runs silent by default and that is the right default: initAudio
 * fails its try/catch, `sfx()` becomes a no-op, and no test pays for a graph it
 * does not look at. But "silent" also means the music scheduler's loops — the
 * bar wrap, the track hand-over, the lookahead window — never execute at all,
 * and a scheduler that never runs is a scheduler nobody has tested.
 *
 * This records what was scheduled and when, rather than rendering anything.
 * `ctx.tick(seconds)` advances the clock the scheduler reads.
 */
function fakeAudio() {
  const scheduled = [];
  const param = (v) => ({
    value: v,
    setValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  const node = (kind) => ({
    kind,
    type: '', buffer: null, loop: false,
    gain: param(1), frequency: param(440), Q: param(1),
    playbackRate: param(1), detune: param(0),
    connect() {}, disconnect() {},
    start(at) { scheduled.push({ kind, at: at === undefined ? ctx.currentTime : at, node: this }); },
    stop() {},
  });
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    destination: node('destination'),
    createGain:          () => node('gain'),
    createOscillator:    () => node('osc'),
    createBufferSource:  () => node('src'),
    createBiquadFilter:  () => node('filter'),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    // test-only handles
    scheduled,
    tick(sec) { ctx.currentTime += sec; },
  };
  return ctx;
}

/**
 * A localStorage stand-in, for `load({ storage })`.
 *
 * wolf3d/scores.js guards THREE different failures and they are not the same
 * failure: the object can be absent, the property access itself can throw, and
 * setItem can throw on a store that reads perfectly well. A stand-in that only
 * models the happy path would leave two of those guards as guesses, and the
 * game boots through all three.
 *
 *   storage: undefined   a fresh, empty, working store
 *   storage: {…}         that object as the backing map — so a SECOND load()
 *                        sees what the first one wrote, which is the only way
 *                        to test that a table actually persists
 *   storage: 'throws'    reads fine, setItem raises (private mode, quota)
 *   storage: 'hostile'   the PROPERTY ACCESS raises (site data blocked)
 *   storage: null        no localStorage at all
 */
function fakeStorage(backing, throwOnWrite) {
  const map = (backing && typeof backing === 'object') ? backing : {};
  return {
    _map: map,
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) {
      if (throwOnWrite) throw new Error('QuotaExceededError (fake)');
      map[k] = String(v);
    },
    removeItem(k) { delete map[k]; },
    clear() { for (const k of Object.keys(map)) delete map[k]; },
  };
}

function installStorage(spec) {
  delete global.localStorage;
  if (spec === null) return;
  if (spec === 'hostile') {
    Object.defineProperty(global, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError (fake)'); },
    });
    return;
  }
  Object.defineProperty(global, 'localStorage', {
    configurable: true, writable: true,
    value: fakeStorage(spec === 'throws' ? null : spec, spec === 'throws'),
  });
}

function load(opts) {
  const o = opts || {};
  const htmlPath = o.htmlPath || DEFAULT_GAME;
  // `sources` lets loadWithLevel hand over a rewritten tree without ever
  // touching the filesystem.
  const sources = o.sources || collectSources(htmlPath);

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

  // No AudioContext by default -> initAudio fails its try/catch and the game
  // runs silent. `load({ audio: true })` installs the stand-in above instead,
  // for the tests that need the music scheduler to actually execute.
  installStorage(o.storage);
  const actx = o.audio ? fakeAudio() : null;
  global.window = actx ? { AudioContext: function () { return actx; } } : {};
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
  eval(buildProgram(sources));

  const P = global.__PROBE;
  assertProbe(P, htmlPath);

  // Boot the game the way a player does: click the splash.
  els.splash._handlers.click();

  return {
    P,
    els,
    audio: actx,
    /** The document stub itself, for tests that need to count what the game
     *  calls on it — document.exitPointerLock is the one that matters. */
    doc: global.document,
    /** The backing store, or null where reading it throws. */
    get storage() { try { return global.localStorage || null; } catch (e) { return null; } },
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
 *
 * The substitution happens on the collected sources in memory rather than on a
 * temp copy of the HTML. That matters once the game is split across files: a
 * temp file written elsewhere would resolve its relative `src` paths against
 * the wrong directory. It is also faster — no filesystem write per fixture.
 */
function loadWithLevel(rows, opts) {
  const o = opts || {};
  const htmlPath = o.htmlPath || DEFAULT_GAME;
  const sources = collectSources(htmlPath);
  const body = rows.map(r => "    '" + r + "',").join('\n');
  let done = false;
  const patched = sources.map(s => {
    if (done) return s;
    const code = s.code.replace(/const LEVEL_1 = \[[\s\S]*?\n\s*\];/,
                                'const LEVEL_1 = [\n' + body + '\n  ];');
    if (code === s.code) return s;
    done = true;
    return { path: s.path, code };
  });
  if (!done) throw new Error('could not substitute LEVEL_1 into ' + htmlPath);
  return load({ htmlPath, sources: patched });
}

module.exports = { load, loadWithLevel, collectSources, DEFAULT_GAME };
