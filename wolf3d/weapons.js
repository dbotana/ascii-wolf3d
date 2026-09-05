'use strict';

// The weapon roster: view-model art for everything that is not the pistol,
// and the WEAPONS table that drives fire(), drawGun() and the HUD.
//
// Data only, like art.js and levels.js — no functions live here. Adding a
// weapon is a row plus three art tables; fire() never grows a branch for it.
//
// Every art table is the same 13-column x 10-row grid as GUN_IDLE, because
// blitArt() scales whatever it is handed into one fixed 39x22 cell span. The
// pistol's own frames stay in art.js next to the reload keyframes, which every
// weapon that reloads shares.

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

// ─── SHOTGUN ────────────────────────────────────────────────
// Twin barrels over a fat pump slide. The recoil frame drops the whole model
// two rows rather than one — at a 0.8s cycle there is time to see the kick,
// and the barrels leaving the top of the cell is what sells it.
const SHOT_IDLE = [
  '    ██ ██    ',
  '    ██ ██    ',
  '   ▟█████▙   ',
  '  ▟███████▙  ',
  '  █████████  ',
  ' ▗█████████▖ ',
  ' ▐█████████▌ ',
  '  ▜███████▛  ',
  '  ███▛▀▜███  ',
  '  ██▌   ▐██  ',
];
const SHOT_FIRE = [
  '   ╲▲╱╲▲╱    ',
  '   ▄██▄██▄   ',
  '   ▟█████▙   ',
  '  ▟███████▙  ',
  '  █████████  ',
  ' ▗█████████▖ ',
  ' ▐█████████▌ ',
  '  ▜███████▛  ',
  '  ███▛▀▜███  ',
  '  ██▌   ▐██  ',
];
const SHOT_RECOIL = [
  '             ',
  '             ',
  '    ██ ██    ',
  '   ▟█████▙   ',
  '  ▟███████▙  ',
  '  █████████  ',
  ' ▗█████████▖ ',
  ' ▐█████████▌ ',
  '  ▜███████▛  ',
  '  ███▛▀▜███  ',
];

// ─── SNIPER ─────────────────────────────────────────────────
// Thin barrel, a scope tube across the receiver, a bolt handle out to the
// right. The lens is the one accent char the idle frame carries, so the
// weapon reads as the scoped one even when nothing is firing; the recoil
// frame cycles the bolt rather than flashing anything.
const SNIPE_IDLE = [
  '   ██        ',
  '   ██        ',
  '   ██        ',
  '  ▟██▙▄▄▄▖   ',
  '  █████████  ',
  '  ▜██●██▛▘   ',
  '  ▟██████▙   ',
  ' ▐████████▙  ',
  ' ▐█████████▙ ',
  '  ▜████████▛ ',
];
const SNIPE_FIRE = [
  '  ╲▲▲╱       ',
  '  ▟██▙       ',
  '   ██        ',
  '  ▟██▙▄▄▄▖   ',
  '  █████████  ',
  '  ▜██●██▛▘   ',
  '  ▟██████▙   ',
  ' ▐████████▙  ',
  ' ▐█████████▙ ',
  '  ▜████████▛ ',
];
const SNIPE_RECOIL = [
  '             ',
  '   ██        ',
  '   ██        ',
  '  ▟██▙▄▄▄▖   ',
  '  █████████  ',
  '  ▜██●██▛▘   ',
  '  ▟██████▙   ',
  ' ▐███████▛▀  ',
  ' ▐█████████▙ ',
  '  ▜████████▛ ',
];

// ─── THE ROSTER ─────────────────────────────────────────────
//
// Index is the number key minus one. Row 1 (the pistol) reproduces the
// numbers the single-weapon game shipped with — 0.28s cooldown, 22-41 damage,
// a CLIP_SIZE magazine, a 9-tile alert radius, no spread — so the whole
// existing test suite still describes the default weapon exactly.
//
//   cd       seconds between shots
//   auto     does holding the trigger repeat? False is a manual action — the
//            pistol, the pump shotgun and the sniper's bolt are one per press
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
//   pellets  projectiles per pull, each with its OWN spread roll. Absent means
//            one, and the shotgun is the only row that sets it. Damage is
//            rolled per pellet, so a shotgun's damage at range is not a
//            falloff curve anyone had to write: the pellets that miss are
//            simply the ones whose jitter exceeded the target's half-width.
//   pierce   how many bodies ONE projectile passes through, nearest first.
//            Absent means one, which is the nearest-target-only rule every
//            other weapon has always had.
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

  // Eight pellets on eight separate rolls, each worth a fraction of a shot.
  // Inside ~4.5u a guard's half-width (58.9/depth columns) is wider than the
  // 13 columns of jitter, so the whole 64-120 lands at once; by 9u the body is
  // 6.5 columns and half the volley goes past it, and by 13u two thirds does.
  // That falloff IS the shotgun, and the spread column is the whole of it —
  // there is no range term anywhere in fire().
  { name: 'SHOTGUN',
    idle: SHOT_IDLE, fire: SHOT_FIRE, recoil: SHOT_RECOIL,
    accent: '╲╱▲▄', base: 'gun', hi: 'gunHi', accentColor: 'muzzle',
    cd: 0.80, auto: false, dmgMin: 8, dmgSpan: 8,
    cost: 1, clip: 6, reload: 1.55,
    pellets: 8, spread: 13.0, minDepth: 0.35, reach: 0,
    spinUp: 0, flash: 0.16, alert: 14,
    fireT: 0.10, recoilT: 0.17, sfx: 'boom' },

  // The opposite weapon in every column: one projectile, no jitter at all, and
  // a cycle long enough that a missed shot is a real cost. `pierce: 2` is the
  // only reason to hold it in a corridor rather than the chaingun — a round
  // that keeps going is worth more the more bodies are queued up in front of
  // you, which is exactly the geometry the chaingun's spread is worst in.
  { name: 'SNIPER',
    idle: SNIPE_IDLE, fire: SNIPE_FIRE, recoil: SNIPE_RECOIL,
    accent: '╲╱▲●', base: 'gun', hi: 'gunHi', accentColor: 'muzzle',
    cd: 1.30, auto: false, dmgMin: 90, dmgSpan: 45,
    cost: 1, clip: 5, reload: 2.10,
    pierce: 2, spread: 0, minDepth: 0.35, reach: 0,
    spinUp: 0, flash: 0.18, alert: 16,
    fireT: 0.11, recoilT: 0.24, sfx: 'bolt' },
];

const PISTOL = 1;   // the weapon a cold start hands you

// Cumulative kills THIS RUN that earn each weapon; 0 means you start with it.
// Indexed like WEAPONS, so earning a gun is a column of that table rather than
// a branch anywhere — checkWeaponUnlock() walks it and grants the first row it
// has paid for. A seventh weapon is a row here and a row there, still no code.
//
// The gaps widen deliberately. Floor 1 holds fifteen bodies and floor 2
// fifteen more, so 5 and 10 both come due on the first floor, 18 early on the
// second and 28 around the third — one reward per floor after the opening,
// rather than the whole roster inside the atrium. They also stay far enough
// apart that two can never come due on the same kill, which is what lets
// checkWeaponUnlock() return after granting one.
const WEAPON_UNLOCK = [0, 0, 5, 10, 18, 28];
