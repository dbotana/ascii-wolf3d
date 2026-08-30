'use strict';

// The weapon roster: view-model art for everything that is not the pistol,
// and the WEAPONS table that drives fire(), drawGun() and the HUD.
//
// Data only, like art.js and levels.js — no functions live here. Adding a
// weapon is a row plus three art tables; fire() never grows a branch for it.
//
// Every art table is the same 13-column x 10-row grid as GUN_IDLE, because
// blitArt() scales whatever it is handed into one fixed 39x22 cell span. The
// pistol's own frames stay in art.js next to the reload keyframes, which all
// four weapons share.

// ─── KNIFE ──────────────────────────────────────────────────
// Held low and to the left, edge up. The fire frame is a thrust into the
// centre of the screen rather than a slash, so it reads at 0.45s intervals.
const KNIFE_IDLE = [
  '          ▗▖ ',
  '         ▗▛  ',
  '        ▗▛   ',
  '       ▗▛    ',
  '      ▗▛     ',
  '     ▗▛      ',
  '    ▗▛       ',
  '   ▟█▙       ',
  '   ███       ',
  '   ▜█▛       ',
];
const KNIFE_FIRE = [
  '     ▗▄▖     ',
  '     ▐█▌     ',
  '     ▐█▌     ',
  '     ▐█▌     ',
  '     ▐█▌     ',
  '    ▗▟█▙▖    ',
  '    ▐███▌    ',
  '    ▝▜█▛▘    ',
  '     ███     ',
  '     ▜█▛     ',
];
const KNIFE_RECOIL = [
  '             ',
  '        ▗▖   ',
  '       ▗▛    ',
  '      ▗▛     ',
  '     ▗▛      ',
  '    ▗▛       ',
  '   ▗▛        ',
  '  ▟█▙        ',
  '  ███        ',
  '  ▜█▛        ',
];

// ─── SMG ────────────────────────────────────────────────────
// Boxy receiver, stubby barrel offset left, magazine hanging under the grip.
const SMG_IDLE = [
  '   ▄▄        ',
  '   ██        ',
  '   ██        ',
  '  ▟██▙       ',
  '  ████▙▖     ',
  '  ███████    ',
  ' ▟████████▙  ',
  ' ██████████  ',
  ' ███▛▀▀▜███  ',
  ' ██▌    ▐██  ',
];
const SMG_FIRE = [
  '  ╲▲╱        ',
  '  ▄██▄       ',
  '   ██        ',
  '  ▟██▙       ',
  '  ████▙▖     ',
  '  ███████    ',
  ' ▟████████▙  ',
  ' ██████████  ',
  ' ███▛▀▀▜███  ',
  ' ██▌    ▐██  ',
];
const SMG_RECOIL = [
  '             ',
  '   ▄▄        ',
  '   ██        ',
  '   ██        ',
  '  ▟██▙       ',
  '  ████▙▖     ',
  '  ███████    ',
  ' ▟████████▙  ',
  ' ██████████  ',
  ' ███▛▀▀▜███  ',
];

// ─── CHAINGUN ───────────────────────────────────────────────
// Three barrels over a wide receiver. The recoil frame shifts the barrel
// caps rather than dropping the whole model: at a 0.07s cooldown the
// idle/fire/recoil cycle repeats fast enough to read as rotation.
const CHAIN_IDLE = [
  '   ▄  ▄  ▄   ',
  '   █  █  █   ',
  '  ▟█▙▟█▙▟█▙  ',
  '  █████████  ',
  '  █████████  ',
  '▗███████████▖',
  '▐███████████▌',
  '▐███████████▌',
  ' ▜█████████▛ ',
  '  ▜███████▛  ',
];
const CHAIN_FIRE = [
  '  ╲▲╱╲▲╱╲▲╱  ',
  '  ▄█▄▄█▄▄█▄  ',
  '  ▟█▙▟█▙▟█▙  ',
  '  █████████  ',
  '  █████████  ',
  '▗███████████▖',
  '▐███████████▌',
  '▐███████████▌',
  ' ▜█████████▛ ',
  '  ▜███████▛  ',
];
const CHAIN_RECOIL = [
  '   ▄  ▄  ▄   ',
  '  ▟█▙▟█▙▟█▙  ',
  '  ▜█▛▜█▛▜█▛  ',
  '  █████████  ',
  '  █████████  ',
  '▗███████████▖',
  '▐███████████▌',
  '▐███████████▌',
  ' ▜█████████▛ ',
  '  ▜███████▛  ',
];

// ─── THE ROSTER ─────────────────────────────────────────────
//
// Index is the number key minus one. Row 1 (the pistol) reproduces the
// numbers the single-weapon game shipped with — 0.28s cooldown, 22-41 damage,
// a CLIP_SIZE magazine, a 9-tile alert radius, no spread — so the whole
// existing test suite still describes the default weapon exactly.
//
//   cd       seconds between shots
//   auto     does holding the trigger repeat? (the pistol is one shot per press)
//   dmgMin   damage is dmgMin + floor(random() * dmgSpan)
//   cost     rounds spent per shot; 0 means the weapon needs no ammo at all
//   clip     magazine capacity; 0 alongside cost 0 means "never reloads"
//   reload   seconds for the reload cycle, using the shared GUN_* keyframes
//   spread   aim jitter in SCREEN COLUMNS, rolled once per shot. This is the
//            one place distance genuinely matters: the hit test itself is
//            depth-independent, but a target's on-screen half-width is
//            59/depth columns, so a fixed column jitter misses a guard past
//            ~8u for the SMG and ~6.5u for the chaingun, and never up close.
//   minDepth how far in front of the eye a target must be to be hittable. The
//            guns keep the 0.35 the game shipped with; the knife needs 0, and
//            that single number is the whole of "melee works at contact range".
//            (The screen-space test itself does NOT need special-casing: depth
//            cancels out of it, so it reduces to |lateral| > wW/2 and behaves
//            identically at 0.2u and 20u.)
//   reach    melee radius in tiles — a true distance, not the forward depth
//            above, so a body beside you is not stabbable. 0 means no cap.
//   spinUp   seconds of held trigger before the first round leaves the barrel
//   flash    seconds of muzzle wash; 0 for anything with no muzzle
//   alert    radius in tiles that the noise wakes idle enemies in
//   base/hi  COLOR keys for the body, and the accent colour for `accent` chars
const WEAPONS = [
  { name: 'KNIFE',
    idle: KNIFE_IDLE, fire: KNIFE_FIRE, recoil: KNIFE_RECOIL,
    accent: '▗▛▘▝▄', base: 'steelD', hi: 'steel', accentColor: 'steel',
    cd: 0.45, auto: true, dmgMin: 18, dmgSpan: 17,
    cost: 0, clip: 0, reload: 0,
    spread: 0, minDepth: 0, reach: 1.6,
    spinUp: 0, flash: 0, alert: 2,
    fireT: 0.10, recoilT: 0.13, sfx: 'knife' },

  { name: 'PISTOL',
    idle: GUN_IDLE, fire: GUN_FIRE, recoil: GUN_RECOIL,
    accent: GUN_ACCENT, base: 'gun', hi: 'gunHi', accentColor: 'muzzle',
    cd: 0.28, auto: false, dmgMin: 22, dmgSpan: 20,
    cost: 1, clip: CLIP_SIZE, reload: RELOAD_TIME,
    spread: 0, minDepth: 0.35, reach: 0,
    spinUp: 0, flash: 0.09, alert: 9,
    fireT: 0.09, recoilT: 0.10, sfx: 'shot' },

  { name: 'SMG',
    idle: SMG_IDLE, fire: SMG_FIRE, recoil: SMG_RECOIL,
    accent: '╲╱▲▄▀', base: 'gun', hi: 'gunHi', accentColor: 'muzzle',
    cd: 0.11, auto: true, dmgMin: 14, dmgSpan: 13,
    cost: 1, clip: 25, reload: 1.25,
    spread: 7.0, minDepth: 0.35, reach: 0,
    spinUp: 0, flash: 0.09, alert: 10,
    fireT: 0.05, recoilT: 0.05, sfx: 'smg' },

  { name: 'CHAINGUN',
    idle: CHAIN_IDLE, fire: CHAIN_FIRE, recoil: CHAIN_RECOIL,
    accent: '╲╱▲▄▖▗', base: 'gun', hi: 'gunHi', accentColor: 'muzzle',
    cd: 0.07, auto: true, dmgMin: 13, dmgSpan: 12,
    cost: 1, clip: 50, reload: 1.90,
    spread: 9.0, minDepth: 0.35, reach: 0,
    spinUp: 0.42, flash: 0.09, alert: 12,
    fireT: 0.035, recoilT: 0.035, sfx: 'chain' },
];

const PISTOL = 1;   // the weapon a cold start hands you

// Cumulative kills THIS RUN that earn each weapon; 0 means you start with it.
// Indexed like WEAPONS, so earning a gun is a column of that table rather than
// a branch anywhere — checkWeaponUnlock() walks it and grants the first row it
// has paid for. A fifth weapon is a row here and a row there, still no code.
const WEAPON_UNLOCK = [0, 0, 5, 10];
