'use strict';

// ASCII art tables: every enemy sprite (with its four guard rotations) and
// every weapon view-model frame. Data only — no functions live here. Adding a
// weapon or an enemy should mean adding rows to these tables, not code.

// ─── SPRITE ART ─────────────────────────────────────────────
const SPR = {
  guard: {
    rows: [
      ' ▄▄▄ ',
      '▐▀◘▀▌',
      ' ╱█╲ ',
      '▟███▙',
      ' ▐█▌ ',
      ' █ █ ',
      ' ▙ ▟ ',
    ],
    wW: 1.15, wH: 2.0, foot: 0.0,
    base: 'guardSuit', accent: '◘▀', accentColor: 'visor',
  },
  // Three more views of the same guard. Wolf3D shipped 8 rotations; at five
  // columns of ASCII the diagonals are indistinguishable from the cardinals,
  // so this is 4. Every rotation keeps the front sprite's wW/wH/foot so the
  // silhouette does not jump size as a guard turns, and fire() deliberately
  // still measures its hit span against SPR.guard.
  guardBack: {
    rows: [
      ' ▄▄▄ ',
      '▐███▌',
      ' ███ ',
      '▟███▙',
      ' ▐█▌ ',
      ' █ █ ',
      ' ▙ ▟ ',
    ],
    wW: 1.15, wH: 2.0, foot: 0.0,
    base: 'guardSuit', accent: '', accentColor: 'visor',
  },
  // Edge-on there is no visor to catch the light, so the sides carry no
  // accent glyph — the shoulder profile is the whole read.
  guardLeft: {
    rows: [
      ' ▄▄  ',
      '◘██  ',
      '╱█▛  ',
      ' ██  ',
      ' ▐█  ',
      ' █▌  ',
      ' ▙▟  ',
    ],
    wW: 1.15, wH: 2.0, foot: 0.0,
    base: 'guardSuit', accent: '◘', accentColor: 'visor',
  },
  guardRight: {
    rows: [
      '  ▄▄ ',
      '  ██◘',
      '  ▜█╲',
      '  ██ ',
      '  █▌ ',
      '  ▐█ ',
      '  ▙▟ ',
    ],
    wW: 1.15, wH: 2.0, foot: 0.0,
    base: 'guardSuit', accent: '◘', accentColor: 'visor',
  },
  guardFire: {
    rows: [
      ' ▄▄▄ ',
      '▐▀◘▀▌',
      '╾█▛█╲',
      '▟███▙',
      ' ▐█▌ ',
      ' █ █ ',
      ' ▙ ▟ ',
    ],
    wW: 1.15, wH: 2.0, foot: 0.0,
    base: 'guardSuit', accent: '◘╾', accentColor: 'muzzle',
  },
  guardDie: {
    rows: [
      '     ',
      ' ▄▄▄ ',
      '▐▀x▀▌',
      '▟███▙',
      '▄▄▄▄▄',
    ],
    wW: 1.4, wH: 1.1, foot: 0.0,
    base: 'guardSuit', accent: 'x', accentColor: 'blood',
  },
  guardDead: {
    rows: [
      '▂▂▂▂▂',
      '█▄▄▄█',
    ],
    wW: 1.6, wH: 0.45, foot: 0.0,
    base: 'blood', accent: '', accentColor: 'blood',
  },
  drone: {
    rows: [
      ' ╱─╲ ',
      '◄(◉)►',
      ' ╲─╱ ',
      '  ▼  ',
      '  ·  ',
    ],
    wW: 1.2, wH: 1.15, foot: 0.75,
    base: 'drone', accent: '◉', accentColor: 'droneEye',
  },
  droneFire: {
    rows: [
      ' ╱─╲ ',
      '◄(◉)►',
      ' ╲─╱ ',
      '  ▼  ',
      '  ▲  ',
    ],
    wW: 1.2, wH: 1.15, foot: 0.75,
    base: 'drone', accent: '◉▲', accentColor: 'muzzle',
  },
  droneDie: {
    rows: [
      '  ▄  ',
      ' ▄█▄ ',
      '▀▀x▀▀',
    ],
    wW: 1.2, wH: 0.7, foot: 0.0,
    base: 'droneEye', accent: 'x', accentColor: 'muzzle',
  },
  droneDead: {
    rows: [
      '▂▂▂▂▂',
      '▖▄▄▄▗',
    ],
    wW: 1.2, wH: 0.35, foot: 0.0,
    base: 'steelD', accent: '', accentColor: 'steelD',
  },
  // The CEO. Twice a guard's footprint and the full height of the corridor,
  // so it reads as a wall of suit long before the damage numbers do.
  ceo: {
    rows: [
      '   ▄███▄   ',
      '  ▟█████▙  ',
      ' ▐██◘█◘██▌ ',
      ' ▐███▄███▌ ',
      '▟█████████▙',
      '███▛███▜███',
      '▜██▌▐█▌▐██▛',
      ' ▐███████▌ ',
      ' ▐██▌ ▐██▌ ',
      ' ▟██▛ ▜██▙ ',
    ],
    wW: 2.5, wH: 2.9, foot: 0.0,
    base: 'ceoSuit', accent: '◘', accentColor: 'ceoTrim',
  },
  ceoFire: {
    rows: [
      '   ▄███▄   ',
      '  ▟█████▙  ',
      ' ▐██◙█◙██▌ ',
      ' ▐███▄███▌ ',
      '▟█████████▙',
      '◄██▛███▜██►',
      '▜██▌▐█▌▐██▛',
      ' ▐███████▌ ',
      ' ▐██▌ ▐██▌ ',
      ' ▟██▛ ▜██▙ ',
    ],
    wW: 2.5, wH: 2.9, foot: 0.0,
    base: 'ceoSuit', accent: '◙◄►', accentColor: 'muzzle',
  },
  ceoDie: {
    rows: [
      '    ▄▄▄    ',
      '  ▄██x██▄  ',
      '▄█████████▄',
      '███████████',
      '▀▀▀▀▀▀▀▀▀▀▀',
    ],
    wW: 2.8, wH: 1.5, foot: 0.0,
    base: 'ceoSuit', accent: 'x', accentColor: 'blood',
  },
  ceoDead: {
    rows: [
      '▂▂▂▂▂▂▂▂▂▂▂',
      '██▄▄▄▄▄▄▄██',
    ],
    wW: 3.0, wH: 0.55, foot: 0.0,
    base: 'blood', accent: '', accentColor: 'blood',
  },
  health: {
    rows: ['╭─╮', '╰♨╯'],
    wW: 0.55, wH: 0.5, foot: 0.1,
    base: 'ramen', accent: '♨', accentColor: 'window',
  },
  ammo: {
    rows: ['▛▀▜', '▙▄▟'],
    wW: 0.5, wH: 0.45, foot: 0.1,
    base: 'cell', accent: '▀', accentColor: 'crt',
  },
  cash: {
    rows: ['╭$╮', '╰─╯'],
    wW: 0.5, wH: 0.45, foot: 0.15,
    base: 'cash', accent: '$', accentColor: 'sodium',
  },
  keyRed: {
    rows: ['▐▓▌', '▐░▌'],
    wW: 0.45, wH: 0.55, foot: 0.15,
    base: 'keyRed', accent: '▓', accentColor: 'window',
  },
  keyBlue: {
    rows: ['▐▓▌', '▐░▌'],
    wW: 0.45, wH: 0.55, foot: 0.15,
    base: 'keyBlue', accent: '▓', accentColor: 'window',
  },
};

// ─── WEAPON VIEW-MODEL ──────────────────────────────────────
const GUN_IDLE = [
  '      ▄      ',
  '     ▟█▙     ',
  '     ███     ',
  '    ▟███▙    ',
  '   ▟█████▙   ',
  '   ███████   ',
  '  ▟███████▙  ',
  '  █████████  ',
  ' ▟█████████▙ ',
  ' ███████████ ',
];
const GUN_FIRE = [
  '   ╲  ▲  ╱   ',
  '    ╲▄█▄╱    ',
  '     ███     ',
  '    ▟███▙    ',
  '   ▟█████▙   ',
  '   ███████   ',
  '  ▟███████▙  ',
  '  █████████  ',
  ' ▟█████████▙ ',
  ' ███████████ ',
];
const GUN_RECOIL = [
  '             ',
  '      ▄      ',
  '     ▟█▙     ',
  '     ███     ',
  '    ▟███▙    ',
  '   ▟█████▙   ',
  '   ███████   ',
  '  ▟███████▙  ',
  '  █████████  ',
  ' ▟█████████▙ ',
];
// reload cycle: gun drops out of frame, the spent cell ejects, a fresh one
// seats, then the gun rides back up. Four keyframes, same 13-col grid.
const GUN_DOWN = [
  '             ',
  '             ',
  '             ',
  '      ▄      ',
  '     ▟█▙     ',
  '     ███     ',
  '    ▟███▙    ',
  '   ▟█████▙   ',
  '   ███████   ',
  '  ▟███████▙  ',
];
const GUN_EJECT = [
  '          ▖  ',
  '         ▗▘  ',
  '             ',
  '             ',
  '      ▄      ',
  '     ▟█▙     ',
  '     ███     ',
  '    ▟███▙    ',
  '   ▟█████▙   ',
  '   ███████   ',
];
const GUN_SEAT = [
  '             ',
  '             ',
  '             ',
  '      ▄      ',
  '     ▟█▙     ',
  '     ███     ',
  '    ▟███▙    ',
  '   ▟█████▙   ',
  '  ▗▄▄▄▄▄▄▄▖  ',
  '  ▐▓▓▓▓▓▓▓▌  ',
];
const GUN_RAISE = [
  '             ',
  '      ▄      ',
  '     ▟█▙     ',
  '     ███     ',
  '    ▟███▙    ',
  '   ▟█████▙   ',
  '   ███████   ',
  '  ▟███████▙  ',
  '  █████████  ',
  ' ▟█████████▙ ',
];
const GUN_ACCENT = '╲╱▲▄';
const RELOAD_ACCENT = '▖▗▘▓▄';
