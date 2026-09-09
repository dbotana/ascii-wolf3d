'use strict';

// The bestiary. One row per enemy type, and every per-type difference in the
// game is a column of it.
//
// This file exists because the alternative was a ternary chain in mkEnemy plus
// a dozen `e.type === 'ceo'` guards scattered across enemies.js, level.js,
// render.js and hud.js — one branch per type per behaviour, growing as the
// product of the two. Growth rule 1: new content is a table row, not a code
// path. A new enemy is a row here, four sprites in bodies.js, a death sequence
// in gore.js, and a character in a level. No new code.
//
// ─── THE COLUMNS ────────────────────────────────────────────
//   char       the level-map character that spawns one; see levels.js
//   name       what it is, for readers — nothing renders this
//   spec       hp / speed / range / cd / dmg / sight. COPIED per body by
//              mkEnemy, never shared: a boss phase rewrites these in place.
//   want       standoff distance held while chasing with line of sight
//   burst      shots per attack entry
//   gap        seconds between the shots of one burst; omitted means BURST_GAP
//   radius     how much room the body claims in separateEnemies
//   score      points for the kill
//   loot       probability of dropping an ammo cell
//   blood      [lo, hi] splats; hi is rolled at 0.4, else lo. [0,0] is a machine
//   patrol     does it pace its beat while idle
//   rotates    does it have back/left/right sprites (only a guard does)
//   bobs       does it hover
//   relocate   may spawn-safety walk it out of the player's opening sightline
//   alertSfx   what it says when it notices you
//   blast      optional { radius, dmg }: the body goes up when it dies
//
// ─── BOSS COLUMNS ───────────────────────────────────────────
//   boss       exempt from difficulty thinning, and claims the `boss` handle.
//              A boss row carries no `want` or `burst` of its own: phases[0] is
//              the only source, so the two can never drift apart
//   phases     the whole fight: a health fraction `at`, a display `name`, any
//              of speed/cd/dmg/range/sight to write onto the spec, plus want,
//              burst, an optional gap and an optional summon { type, n }
//   title      the boss bar's name
//   tag        the phase-change toast's prefix
//   objective  the objective line while it lives
//   heldBy     the exit prompt while it lives
//   deny       the toast for trying the exit anyway
//   track      which MUSIC row plays once it has noticed you

const ENEMY_TYPES = {

  guard: {
    char: 'g', name: 'SALARYMAN GUARD',
    spec: { hp: 45, speed: 1.35, range: 9.5, cd: 1.15, dmg: 11, sight: 15 },
    want: 3.2, burst: 1, radius: 0.35, score: 200,
    loot: 0.55, blood: [1, 2],
    patrol: true, rotates: true, bobs: false, relocate: true,
    alertSfx: 'bark',
  },

  drone: {
    char: 'd', name: 'SEC-DRONE',
    spec: { hp: 28, speed: 2.10, range: 7.0, cd: 0.85, dmg: 7, sight: 13 },
    want: 2.2, burst: 1, radius: 0.35, score: 150,
    loot: 0.30, blood: [0, 0],
    patrol: true, rotates: false, bobs: true, relocate: true,
    alertSfx: 'ping',
  },

  // A fixture, not a body: `speed: 0` is the whole of "it holds position and
  // shoots", because moveEnemy treats a zero delta as no delta and the chase
  // state then has nothing to do. It out-ranges everything but the chaingun,
  // and `relocate: false` keeps it in the sightline a level places it in.
  turret: {
    char: 't', name: 'CEILING TURRET',
    spec: { hp: 35, speed: 0, range: 14.0, cd: 1.60, dmg: 12, sight: 18 },
    want: 0, burst: 2, radius: 0.40, score: 250,
    loot: 0.40, blood: [0, 0],
    patrol: false, rotates: false, bobs: false, relocate: false,
    alertSfx: 'ping',
  },

  // A charge on rotors. `range` 1.4 means it has to reach you before it can do
  // anything at all, and `want: 0` means it never stops closing — then it goes
  // off when it dies, so killing one at your feet is its own mistake.
  spark: {
    char: 'k', name: 'SPARK CHARGE',
    spec: { hp: 30, speed: 2.80, range: 1.4, cd: 0.90, dmg: 10, sight: 14 },
    want: 0, burst: 1, radius: 0.30, score: 300,
    loot: 0.15, blood: [0, 0],
    patrol: true, rotates: false, bobs: true, relocate: true,
    alertSfx: 'ping',
    blast: { radius: 2.2, dmg: 22 },
  },

  // The corridor plug. Three times a guard's hp and two thirds its speed, so
  // backing away works and standing your ground does not; the wide radius is
  // what makes it actually block a doorway rather than be walked around.
  enforcer: {
    char: 'h', name: 'CORPORATE ENFORCER',
    spec: { hp: 140, speed: 0.90, range: 8.0, cd: 1.50, dmg: 15, sight: 16 },
    want: 4.0, burst: 3, radius: 0.50, score: 500,
    loot: 0.80, blood: [1, 2],
    patrol: true, rotates: false, bobs: false, relocate: true,
    alertSfx: 'bark',
  },

  // ─── BOSSES ───────────────────────────────────────────────
  // Tuned as fights, not obstacles: enough hp to need several magazines,
  // enough reach that backing off is not a free answer, and a standoff of
  // their own so they never simply walk into your muzzle.

  ceo: {
    char: 'C', name: 'THE CEO', boss: true,
    spec: { hp: 1400, speed: 1.10, range: 12.0, cd: 0.85, dmg: 11, sight: 20 },
    radius: 0.55, score: 5000,
    loot: 0.30, blood: [3, 3],
    patrol: false, rotates: false, bobs: false, relocate: false,
    alertSfx: 'ping',
    title: 'CHIEF EXECUTIVE OFFICER', tag: 'CEO', track: 'BOARDROOM',
    objective: 'THE BOARD IS IN SESSION — KILL THE CEO',
    heldBy: 'ELEVATOR — HELD BY THE BOARD',
    deny: 'THE BOARD IS STILL IN SESSION',
    // A four-phase fight rather than a guard with more hp. Each phase re-tunes
    // the same spec fields the ordinary FSM already reads, so no new state
    // machine is needed. `at` is the health fraction it takes over at.
    //
    // It opened at ONE round every 1.4s — 3.4 dps at its own standoff, which
    // is 29 seconds to kill a full-health player, against a fight that a
    // measured run finished in five. It never got to fire twice. The rewrite
    // keeps the same closing arc and changes what a phase IS: a volley, not a
    // shot. Landed damage in the open, at each phase's standoff, now runs
    // 12 -> 22 -> 33 -> 42 dps, so the boardroom's tables stop being scenery.
    //
    // The bursts are the dodge, not just the threat. A body in `attack` does
    // not move, and enemyShot re-checks line of sight for EVERY round — so a
    // long volley roots the CEO for a second while you break its sightline,
    // and the rest of that volley hits the table you stepped behind.
    phases: [
      { at: 1.00, name: 'BOARD MEETING',    speed: 1.10, cd: 0.85, dmg: 11, want: 5.0,
        burst: 5,  gap: 0.13 },
      { at: 0.70, name: 'HOSTILE TAKEOVER', speed: 1.80, cd: 0.60, dmg: 10, want: 3.6,
        burst: 8,  gap: 0.11, summon: { type: 'drone', n: 2 } },
      { at: 0.42, name: 'GOLDEN PARACHUTE', speed: 2.20, cd: 0.45, dmg:  9, want: 2.6,
        burst: 11, gap: 0.09, summon: { type: 'drone', n: 3 } },
      { at: 0.18, name: 'SEVERANCE',        speed: 2.45, cd: 0.35, dmg:  8, want: 2.0,
        burst: 14, gap: 0.07, summon: { type: 'spark', n: 2 } },
    ],
  },

  // The inverse of the CEO's arc. It opens ROOTED and out-ranging every gun
  // you own, so the vault's pillars are the fight; then it seeds the room with
  // turrets, so the cover starts shooting back; then it comes off the pedestal
  // and its reach shortens as it hunts. `speed: 0` in the first two phases is
  // the same field the turret uses — the FSM needs nothing new for either.
  blackice: {
    char: 'I', name: 'BLACK ICE', boss: true,
    spec: { hp: 1700, speed: 0, range: 16.0, cd: 0.70, dmg: 24, sight: 24 },
    radius: 0.60, score: 6000,
    loot: 0.30, blood: [0, 0],
    patrol: false, rotates: false, bobs: false, relocate: false,
    alertSfx: 'ping',
    title: 'BLACK ICE — INTRUSION COUNTERMEASURE', tag: 'BLACK ICE', track: 'ICEWALL',
    objective: 'THE VAULT IS SEALED — BREAK THE ICE',
    heldBy: 'ELEVATOR — LOCKED BY BLACK ICE',
    deny: 'THE ICE STILL HOLDS THE FLOOR',
    // Its two rooted phases carry the damage on the SHOT, not on the rate,
    // and that is forced by the accuracy model rather than chosen: enemyShot
    // floors the hit chance at 0.16 past ~12.4u, so a boss that lives at 16u
    // lands roughly one round in six however many it fires. Heavy rounds turn
    // that into a distance gradient instead of a flat nuisance — attrition
    // across the vault at 12u, punishing at 6u, lethal if you walk up to it.
    // The pillars are what you spend that gradient on, which is the fight the
    // room was drawn for.
    //
    // Coming off the pedestal inverts it: phases 2 and 3 close, so their reach
    // shortens, their damage per round drops and the volleys get long enough
    // that the room's cover matters again on the way in.
    phases: [
      { at: 1.00, name: 'COLD BOOT',      speed: 0,    cd: 0.70, dmg: 24, range: 16.0,
        want: 0,   burst: 8,  gap: 0.11 },
      { at: 0.65, name: 'TRACE LOCK',     speed: 0,    cd: 0.50, dmg: 22, range: 16.0,
        want: 0,   burst: 12, gap: 0.09, summon: { type: 'turret', n: 3 } },
      { at: 0.38, name: 'SCORCHED EARTH', speed: 1.70, cd: 0.42, dmg: 10, range: 12.0,
        want: 5.5, burst: 14, gap: 0.08, summon: { type: 'spark', n: 3 } },
      { at: 0.15, name: 'MELTDOWN',       speed: 2.40, cd: 0.32, dmg:  9, range: 8.0,
        want: 2.4, burst: 18, gap: 0.06 },
    ],
  },

  // The finale, and the only fight that pulls you IN: every phase raises the
  // speed and shortens the reach, so the room gets smaller as it gets deadlier
  // and the last one is a knife fight. The blast on the row is the point of the
  // whole arc — kill it at your feet and it takes you with it.
  founder: {
    char: 'F', name: 'THE FOUNDER', boss: true,
    spec: { hp: 2100, speed: 1.30, range: 13.0, cd: 0.80, dmg: 12, sight: 24 },
    radius: 0.60, score: 8000,
    loot: 0.30, blood: [3, 3],
    patrol: false, rotates: false, bobs: false, relocate: false,
    alertSfx: 'bark',
    blast: { radius: 3.5, dmg: 30 },
    title: 'THE FOUNDER — MAJORITY SHAREHOLDER', tag: 'THE FOUNDER', track: 'LAST FLIGHT',
    objective: 'THE FOUNDER IS BOARDING — DO NOT LET THEM LEAVE',
    heldBy: 'ELEVATOR — THE ROOF IS NOT CLEAR',
    deny: 'THE ROOF IS NOT CLEAR',
    // The last phase is the heaviest volley in the game and the shortest reach
    // to deliver it from, which is the arc finally arriving: by then the deck
    // has nowhere left to stand. It stays survivable for the same reason the
    // CEO's does — a boss unloading twenty rounds is a boss standing still,
    // and every one of them is line-of-sight gated — but on an almost bare
    // helipad that buys you distance rather than cover, which is the whole
    // difference between this floor and the vault.
    phases: [
      { at: 1.00, name: 'EXIT PACKAGE',    speed: 1.30, cd: 0.80, dmg: 12, range: 13.0,
        want: 6.5, burst: 6,  gap: 0.12 },
      { at: 0.68, name: 'VESTED INTEREST', speed: 2.00, cd: 0.55, dmg: 11, range: 9.0,
        want: 3.5, burst: 10, gap: 0.09, summon: { type: 'enforcer', n: 2 } },
      { at: 0.40, name: 'LEGACY MODE',     speed: 2.60, cd: 0.42, dmg: 10, range: 5.0,
        want: 1.8, burst: 14, gap: 0.07, summon: { type: 'spark', n: 4 } },
      { at: 0.15, name: "FOUNDER'S SHARE", speed: 2.90, cd: 0.30, dmg:  8, range: 4.0,
        want: 1.2, burst: 16, gap: 0.05 },
    ],
  },

};
