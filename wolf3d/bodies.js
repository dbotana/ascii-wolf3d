'use strict';

// Enemy sprite art for everything added after the MVP roster. Data only.
//
// This is its own file rather than more rows in `art.js` for the reason
// `gore.js` and `weapons.js` are: art.js was already 307 lines and this is
// ~280 more, and rule 4 says a file past 400 is a signal to split, not a
// target to fill.
//
// It must load BEFORE art.js, which opens its own literal with `...BODY_SPR`.
// That spread is the whole seam: `SPR` stays one object with one lookup, so
// enemySprite's `SPR[type + 'Fire']`, fire()'s `SPR[e.type].wW` and gore.js's
// `SPR[type + 'Die']` never learn that the art arrived from two files.
//
// ─── THE RULES A BODY MUST KEEP ─────────────────────────────
//   * `rows` must be rectangular. A short row blits `undefined` into the
//     atlas; the suite measures every row's length for this.
//   * every LIVE view of a type (idle, Fire, and any rotations) must carry the
//     same `wW`. fire() measures its hit span against the base sprite, so a
//     wider firing pose would make a body easier to shoot while it shoots.
//     `Die` and `Dead` are free — nothing aims at a corpse.
//   * `base` and `accentColor` are keys into COLOR, never literals: every
//     colour reaches the screen through fade() so the glyph atlas stays small.
const BODY_SPR = {

  // ─── TURRET ───────────────────────────────────────────────
  // Wall-mounted, so it hangs at `foot: 0.9` and never moves. It reads as a
  // fixture rather than a body on purpose: the answer to it is cover, not aim.
  turret: {
    rows: [
      '  ▄▄▄  ',
      ' ▟█◙█▙ ',
      '▐█████▌',
      ' ▜███▛ ',
      '  ▐█▌  ',
    ],
    wW: 1.3, wH: 1.6, foot: 0.9,
    base: 'steelD', accent: '◙', accentColor: 'turretEye',
  },
  turretFire: {
    rows: [
      '  ▄▄▄  ',
      ' ▟█◙█▙ ',
      '◄█████►',
      ' ▜███▛ ',
      '  ▐█▌  ',
    ],
    wW: 1.3, wH: 1.6, foot: 0.9,
    base: 'steelD', accent: '◙◄►', accentColor: 'muzzle',
  },
  turretDie: {
    rows: [
      ' ▄▄▄▄▄ ',
      '▄██x██▄',
      '▀▀▀▀▀▀▀',
    ],
    wW: 1.4, wH: 0.70, foot: 0.0,
    base: 'steelD', accent: 'x', accentColor: 'muzzle',
  },
  turretDead: {
    rows: [
      '▂▂▂▂▂▂▂',
      '▖▄▄▄▄▄▗',
    ],
    wW: 1.4, wH: 0.35, foot: 0.0,
    base: 'steelD', accent: '', accentColor: 'steelD',
  },

  // ─── SPARK ────────────────────────────────────────────────
  // A charge on rotors. Small, hovering and almost harmless at range — the
  // whole body is a delivery system for the blast on its roster row.
  spark: {
    rows: [
      '╲ ▲ ╱',
      ' ▟◘▙ ',
      '╱ ▼ ╲',
      '  ·  ',
    ],
    wW: 0.95, wH: 0.90, foot: 0.85,
    base: 'spark', accent: '◘', accentColor: 'sparkCore',
  },
  sparkFire: {
    rows: [
      '╲ ▲ ╱',
      '◄▟◙▙►',
      '╱ ▼ ╲',
      '  ▲  ',
    ],
    wW: 0.95, wH: 0.90, foot: 0.85,
    base: 'spark', accent: '◙◄►', accentColor: 'muzzle',
  },
  // The one death frame in the game that grows. A spark does not fall over,
  // it goes off, and the blast it deals is a roster field the FSM reads.
  sparkDie: {
    rows: [
      '╲ ◙ ╱',
      '◄◙◙◙►',
      '╱ ◙ ╲',
    ],
    wW: 1.70, wH: 1.10, foot: 0.45,
    base: 'muzzle', accent: '◙', accentColor: 'sparkCore',
  },
  sparkDead: {
    rows: [
      '▗▄▄▄▖',
      '▝▀▀▀▘',
    ],
    wW: 1.10, wH: 0.30, foot: 0.0,
    base: 'steelD', accent: '', accentColor: 'steelD',
  },

  // ─── ENFORCER ─────────────────────────────────────────────
  // Half again a guard's width and a head taller, which is the honest read on
  // a body with three times the hp: you are meant to see the wall coming.
  enforcer: {
    rows: [
      ' ▄███▄ ',
      '▐█◘█◘█▌',
      ' ▜███▛ ',
      '▟█████▙',
      '███▀███',
      '▜█████▛',
      ' ▐█ █▌ ',
      ' ▙▛ ▜▟ ',
    ],
    wW: 1.7, wH: 2.4, foot: 0.0,
    base: 'enforcer', accent: '◘', accentColor: 'enforcerTrim',
  },
  enforcerFire: {
    rows: [
      ' ▄███▄ ',
      '▐█◘█◘█▌',
      ' ▜███▛ ',
      '▟█████▙',
      '██◙▀◙██',
      '▜█████▛',
      ' ▐█ █▌ ',
      ' ▙▛ ▜▟ ',
    ],
    wW: 1.7, wH: 2.4, foot: 0.0,
    base: 'enforcer', accent: '◙', accentColor: 'muzzle',
  },
  enforcerDie: {
    rows: [
      '  ▄▄▄  ',
      ' ▄███▄ ',
      '▄██x██▄',
      '▀▀▀▀▀▀▀',
    ],
    wW: 2.0, wH: 1.00, foot: 0.0,
    base: 'enforcer', accent: 'x', accentColor: 'blood',
  },
  enforcerDead: {
    rows: [
      '▂▂▂▂▂▂▂',
      '█▄▄▄▄▄█',
    ],
    wW: 2.2, wH: 0.45, foot: 0.0,
    base: 'blood', accent: '', accentColor: 'blood',
  },


  // ─── BLACK ICE ────────────────────────────────────────────
  // Not a body — a countermeasure. It reads as a column of frozen data with a
  // core you can see through it, which is the tell for where the phase is.
  blackice: {
    rows: [
      '   ▄▄▄▄▄   ',
      '  ╱█████╲  ',
      ' ▟███◙███▙ ',
      '▐█████████▌',
      '▐██◙███◙██▌',
      '▐█████████▌',
      ' ▜███◙███▛ ',
      '  ╲█████╱  ',
      '   ▐███▌   ',
      '   ▟███▙   ',
    ],
    wW: 2.5, wH: 2.9, foot: 0.0,
    base: 'ice', accent: '◙', accentColor: 'iceCore',
  },
  blackiceFire: {
    rows: [
      '   ▄▄▄▄▄   ',
      '  ╱█████╲  ',
      ' ▟███◙███▙ ',
      '◄█████████►',
      '▐██◙███◙██▌',
      '◄█████████►',
      ' ▜███◙███▛ ',
      '  ╲█████╱  ',
      '   ▐███▌   ',
      '   ▟███▙   ',
    ],
    wW: 2.5, wH: 2.9, foot: 0.0,
    base: 'ice', accent: '◙◄►', accentColor: 'muzzle',
  },
  blackiceDie: {
    rows: [
      '╲  ▄▄▄▄▄  ╱',
      '▄██▀▀x▀▀██▄',
      '▀▀▀▀▀▀▀▀▀▀▀',
    ],
    wW: 2.9, wH: 1.30, foot: 0.0,
    base: 'ice', accent: 'x', accentColor: 'iceCore',
  },
  blackiceDead: {
    rows: [
      '▂▂▂▂▂▂▂▂▂▂▂',
      '▖▄▄▄▄▄▄▄▄▄▗',
    ],
    wW: 3.0, wH: 0.50, foot: 0.0,
    base: 'steelD', accent: '', accentColor: 'steelD',
  },

  // ─── THE FOUNDER ──────────────────────────────────────────
  // Taller than the CEO and narrower: a long coat over an exoframe, and the
  // last thing between you and the roof.
  founder: {
    rows: [
      '    ▄▄▄    ',
      '   ▟█◙█▙   ',
      '   ▜███▛   ',
      '  ▟█████▙  ',
      ' ▟███◘███▙ ',
      '▐█████████▌',
      '▐██▛███▜██▌',
      ' ▜██▌ ▐██▛ ',
      '  ▐█▌ ▐█▌  ',
      '  ▟█▙ ▟█▙  ',
    ],
    wW: 2.3, wH: 3.0, foot: 0.0,
    base: 'founderCoat', accent: '◙◘', accentColor: 'founderTrim',
  },
  founderFire: {
    rows: [
      '    ▄▄▄    ',
      '   ▟█◙█▙   ',
      '   ▜███▛   ',
      '  ▟█████▙  ',
      '◄▟███◙███▙►',
      '▐█████████▌',
      '▐██▛███▜██▌',
      ' ▜██▌ ▐██▛ ',
      '  ▐█▌ ▐█▌  ',
      '  ▟█▙ ▟█▙  ',
    ],
    wW: 2.3, wH: 3.0, foot: 0.0,
    base: 'founderCoat', accent: '◙◄►', accentColor: 'muzzle',
  },
  founderDie: {
    rows: [
      '  ▄▄▄▄▄▄▄  ',
      ' ▄███████▄ ',
      '▄███▀x▀███▄',
      '▀▀▀▀▀▀▀▀▀▀▀',
    ],
    wW: 2.8, wH: 1.40, foot: 0.0,
    base: 'founderCoat', accent: 'x', accentColor: 'blood',
  },
  founderDead: {
    rows: [
      '▂▂▂▂▂▂▂▂▂▂▂',
      '██▄▄▄▄▄▄▄██',
    ],
    wW: 3.0, wH: 0.55, foot: 0.0,
    base: 'blood', accent: '', accentColor: 'blood',
  },

};
