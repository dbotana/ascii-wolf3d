'use strict';

// Death animation frames and floor decals. Data only, per rule 2.
//
// This is its own file rather than more rows in `art.js` because art.js was
// already 307 lines and this is ~90 more: rule 4 says a file past 400 is a
// signal to split, not a target to fill, and 397 is filling it. Same call
// `weapons.js` made in the Phase 3 pass.
//
// It must load AFTER art.js — the sequences below hold sprite OBJECTS, not
// names, and frame 0 of each one is the existing `SPR[type + 'Die']`. That is
// deliberate twice over: it means enemySprite indexes a table instead of
// building a string and looking it up, and it means the first frame of every
// death is still exactly the frame that shipped before this file existed.

// ─── DEATH SEQUENCES ────────────────────────────────────────
// A death is subdivided across DEATH_TIME, never lengthened — stepEnemies
// still flips to 'dead' on the same clock, so nothing in the FSM's timing
// moves and this stays a purely visual change. Each sequence collapses: the
// body gets shorter and wider frame by frame, landing on the corpse sprite.
const DEATH_SEQ = {
  guard: [
    SPR.guardDie,
    {
      rows: [
        '  ▄  ',
        '▄███▄',
        '█▀x▀█',
        '▀▀▀▀▀',
      ],
      wW: 1.5, wH: 0.80, foot: 0.0,
      base: 'guardSuit', accent: 'x', accentColor: 'blood',
    },
    {
      rows: [
        '▄▄▄▄▄',
        '███▛█',
        '▀▀▀▀▀',
      ],
      wW: 1.55, wH: 0.55, foot: 0.0,
      base: 'guardSuit', accent: '', accentColor: 'blood',
    },
  ],
  // A drone has further to fall and less to fall with, so two frames read as
  // a drop rather than a collapse.
  drone: [
    SPR.droneDie,
    {
      rows: [
        ' ▄▄▄ ',
        '▄▀x▀▄',
        '▀▀▀▀▀',
      ],
      wW: 1.2, wH: 0.50, foot: 0.0,
      base: 'steelD', accent: 'x', accentColor: 'muzzle',
    },
  ],
  ceo: [
    SPR.ceoDie,
    {
      rows: [
        '   ▄███▄   ',
        ' ▄███x███▄ ',
        '███████████',
        '▀▀▀▀▀▀▀▀▀▀▀',
      ],
      wW: 2.9, wH: 1.00, foot: 0.0,
      base: 'ceoSuit', accent: 'x', accentColor: 'blood',
    },
    {
      rows: [
        ' ▄███████▄ ',
        '███████████',
        '▀▀▀▀▀▀▀▀▀▀▀',
      ],
      wW: 2.95, wH: 0.70, foot: 0.0,
      base: 'ceoSuit', accent: '', accentColor: 'blood',
    },
  ],
};

// ─── FLOOR DECALS ───────────────────────────────────────────
// Not a decal in the projection sense. The floor is drawn per row off a
// distance ramp rather than per world position, so a true floor decal would
// need per-column floor casting — a renderer this does not have. These are
// flat sprites sitting at foot height, which is exactly what a corpse frame
// already is, so drawSprite blits them with no new code path.
const DECAL_SPR = [
  {
    rows: ['▗▄▄▖'],
    wW: 0.85, wH: 0.16, foot: 0.0,
    base: 'blood', accent: '', accentColor: 'blood',
  },
  {
    rows: ['▖▄▄▄▗'],
    wW: 1.00, wH: 0.14, foot: 0.0,
    base: 'blood', accent: '', accentColor: 'blood',
  },
  {
    rows: [
      ' ▄▄ ',
      '▝▀▀▘',
    ],
    wW: 0.70, wH: 0.20, foot: 0.0,
    base: 'blood', accent: '', accentColor: 'blood',
  },
];
