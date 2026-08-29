'use strict';

// Persistent high scores. The only state in the game that outlives the tab.
//
// localStorage is the whole mechanism, and it is guarded three ways, because it
// fails in three genuinely different ways and one try/catch does not cover them:
//
//   1. It is ABSENT. The headless harness has no DOM at all, and neither does
//      any non-browser host. `typeof` handles this.
//   2. Touching the PROPERTY throws. A browser with site data blocked can
//      define the getter and have it raise, so `typeof localStorage` is itself
//      the throwing expression — which is why the typeof lives inside the try.
//   3. It reads fine and setItem throws: Safari's private mode, and a full
//      quota. Nothing before the write can predict this one.
//
// A table that cannot be persisted still works for the session — the game runs
// identically, it just forgets. That is the repo's "everything degrades" rule:
// the atlas, the audio graph and pointer lock each do the same.

// ─── HIGH SCORES ────────────────────────────────────────────
const SCORES_KEY  = 'wolf3d.scores.v1';   // versioned: a shape change gets a new key
const SCORE_SLOTS = 5;

// The table, in memory, newest-first within a tie. Nothing here runs at load —
// growth rule 3 — so main.js is what calls loadScores() at boot.
let highScores = [];
// Which row the run that just ended landed in, so the splash can mark it. -1
// when the last run missed the table entirely.
let scoreFresh = -1;

/** The backing store, or null if there isn't a usable one. See the header. */
function scoreStore() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch (e) {
    return null;                 // the property access itself threw
  }
}

// Anything that is not this shape is discarded rather than repaired. The key
// could hold another app's data, a half-written value, or a table written by a
// future version — none of which should reach the splash.
function validScore(e) {
  return !!e && typeof e === 'object' &&
         typeof e.score === 'number' && isFinite(e.score) && e.score >= 0;
}

function normScore(e) {
  return {
    score: Math.max(0, e.score | 0),
    floor: Math.max(1, e.floor | 0),
    diff:  Math.max(0, Math.min(DIFFICULTY.length - 1, e.diff | 0)),
    won:   !!e.won,
    at:    (typeof e.at === 'number' && isFinite(e.at)) ? e.at : 0,
  };
}

// Newest first on a tie, so a run that matches the record appears ABOVE it.
// Ranking a tie below would tell a player they did not make the table when
// they just equalled the best score on it.
const byScore = (a, b) => (b.score - a.score) || (b.at - a.at);

function sortScores(list) {
  return list.filter(validScore).map(normScore).sort(byScore).slice(0, SCORE_SLOTS);
}

/** Read the table off disk into `highScores`. Always leaves it a valid array. */
function loadScores() {
  highScores = [];
  const store = scoreStore();
  if (!store) return highScores;
  try {
    const raw = store.getItem(SCORES_KEY);
    if (!raw) return highScores;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return highScores;
    highScores = sortScores(parsed);
  } catch (e) {
    highScores = [];             // unparseable is the same as absent
  }
  return highScores;
}

/** @returns {boolean} whether it actually persisted. */
function saveScores() {
  const store = scoreStore();
  if (!store) return false;
  try {
    store.setItem(SCORES_KEY, JSON.stringify(highScores));
    return true;
  } catch (e) {
    return false;                // quota, or a context that reads but will not write
  }
}

/**
 * Record the end of a run.
 * @returns {number} 0-based rank in the table, or -1 if it missed the cut.
 *
 * A run ends by DYING or by getting out, and by nothing else. Restarting with
 * `P` is deliberately not a record point: startLevel's cold path zeroes the
 * score, so recording there would file a partial run and then file the real one
 * again when it ends. Wolf3D's rule, and the reading of "a run ended" that a
 * player would recognise.
 *
 * The entry keeps its object identity through the merge, which is how the rank
 * is found: two runs can tie on every field, and the one that just happened is
 * the one that earned the slot.
 */
function recordScore(score, floor, diff, won) {
  const entry = normScore({ score, floor, diff, won, at: Date.now() });
  // The new entry goes in FRONT, and that is what makes "newest wins a tie"
  // actually true. byScore falls back to `at`, but Date.now() only has
  // millisecond resolution — two runs recorded inside the same millisecond tie
  // on that too, and a stable sort then keeps whichever came first in the
  // input. Leading with the new entry decides it without consulting a clock.
  const merged = [entry].concat(highScores).sort(byScore);
  const rank = merged.indexOf(entry);
  highScores = merged.slice(0, SCORE_SLOTS);
  scoreFresh = rank < SCORE_SLOTS ? rank : -1;
  saveScores();
  return scoreFresh;
}

/**
 * Paint the table onto the splash.
 *
 * Writes into a fixed set of rows rather than building elements, the same way
 * the tally screen drives #tRowKill and friends. Fixed rows keep this to
 * textContent and classList — which is all the headless harness's DOM stub
 * implements, and all it should have to.
 */
function paintScores() {
  for (let i = 0; i < SCORE_SLOTS; i++) {
    const row = el('hs' + i);
    if (!row) continue;
    const e = highScores[i];
    row.classList.toggle('hide', !e);
    row.classList.toggle('fresh', !!e && i === scoreFresh);
    if (!e) continue;
    el('hsScore' + i).textContent = String(e.score).padStart(6, '0');
    el('hsMeta' + i).textContent =
      (e.won ? 'ESCAPED' : 'FLOOR ' + e.floor) + '  ·  ' + DIFFICULTY[e.diff].name;
  }
  const none = el('hsNone');
  if (none) none.classList.toggle('hide', highScores.length > 0);
}
