'use strict';

// The three floors, their display names and their par times.
//
// Keep each floor as its own top-level `const LEVEL_*` array. Both tools find
// them by that token: validate-level.js scrapes them without booting the game,
// and harness.js loadWithLevel() substitutes a fixture into LEVEL_1. Inlining
// them into the LEVELS literal would blind both.
//
// ─── HOW THESE FLOORS ARE SHAPED ────────────────────────────
// The first draft was four or five very large open halls per floor, and keys,
// doors and enemies all dissolved into that space. Every floor here is built
// the same way instead:
//
//   * ONE 3-wide spine runs north from the spawn to the elevator, and every
//     room hangs off it. You are always at most one turn from a corridor you
//     recognise. The spawn faces along it — startLevel sets the heading to
//     north unconditionally.
//   * Rooms are bays of about 7x6, never halls. A room you can take in at a
//     glance is a room you can find a keycard in.
//   * Locked doors sit ON the spine, so you meet the lock before you go
//     looking for its key and the floor states its own puzzle up front. Each
//     door narrows the spine to one tile, which is also what gives the slab an
//     axis to retract into — see validate-level.js.
//   * A ring corridor loops the floor so backtracking is never retracing.
//   * Enemies come in room-sized clusters rather than sprinkled across a hall,
//     which is also what paces the weapon unlocks (5 kills, then 10).
//   * Every push-wall pocket is 3x3 with the loot off the slab's own row: the
//     slab travels up to two tiles and stops SHORT of any pickup, so a
//     one-wide pocket can never be opened. See CLAUDE.md.
//
// ─── LEVEL ──────────────────────────────────────────────────
// #  panel   |  window   N  neon sign   X  exit switch
// D  door    R  red-locked door   B  blue-locked door   S  secret push-wall
// g  salaryman guard   d  sec-drone   C  the CEO (floor 3 only)
// +  ramen   a  battery cell   r/b  keycard   $  crypto wallet   @  spawn

// FLOOR 1 — ATRIUM · SUBLEVEL. The teaching floor: a plain door on the spine
// first, then the red door, then the blue one, in the order you can solve
// them. The atrium you spawn in and the two bays either side of it hold
// enough bodies to buy the SMG before you reach the red door.
const LEVEL_1 = [
  '########################################',
  '####################X###################',
  '#################.......################',
  '#################...$...################',
  '#################.......################',
  '####################B####NN###NN########',
  '#########.......###...###.......########',
  '#########a$.....###...###......$########',
  '#########.....................b.########',
  '#########.+.....S##...###...g...########',
  '#########.....$a.$#...###a$.....########',
  '#########.........#...###.....a.########',
  '################a$#...##################',
  '###################...##################',
  '#########.......###...###.......########',
  '#########.$....a###...###.$....a########',
  '#########....d.............d....########',
  '#########a....$.###...###a....$.########',
  '#########.......###...###.......########',
  '#########NN###NN####R###################',
  '#########.......###...###.......########',
  '#####$a.#.$....a###...###.$....a#..$####',
  '#####...S..r....................S...####',
  '#####$..#..g....###...###...g...#.a$####',
  '#########a....$.###...###a....$.########',
  '#########.......###...###.......########',
  '#####..............................#####',
  '#####.......d..............+d......#####',
  '#####..............................#####',
  '#########.......###...###.......########',
  '#########.$....a###...###.$....a########',
  '#########..g.g...D.....D...d.g..########',
  '#########a....$.###...###a....$.########',
  '#########.......####D####.......########',
  '#######....#................#....#######',
  '#######.a......###....###......a.#######',
  '#######..g.#.+g###....###g+.#.g..#######',
  '#######....#........@.......#....#######',
  '#||||||||||||||||||||||||||||||||||||||#',
  '########################################',
];

// FLOOR 2 — R&D · SERVER FARM. Both keycards sit in mirrored lab wings behind
// plain doors, so the floor asks you to sweep two sides rather than walk one
// line. The server bays below are four sealed cells off the ring, each with
// its own door — they must not touch the spine, or the door is scenery.
const LEVEL_2 = [
  '########################################',
  '####################X###################',
  '#################.......################',
  '#################...$...################',
  '#################.......################',
  '#########NN###NN####B####NN###NN########',
  '#########.......###...###.......########',
  '#########a$.....###...###.....$a########',
  '#########..g................g...########',
  '#########.......S##...###.......########',
  '#########.....$a.$#.d.###a$.....########',
  '#########.........#...###.......########',
  '################a$#...##################',
  '####################R###################',
  '###################...##################',
  '######........#####...####........######',
  '######.....$.a#####...####.$.....a######',
  '##$a.#...##...#####...####...##...#..$##',
  '##...S.r.##...D..........D...##.b.S...##',
  '##$..#...##g..#####...####..g##...#.a$##',
  '######a.....$.#####...####a.$.....######',
  '######........#####...####........######',
  '###################...##################',
  '#####..............................#####',
  '#####.+.$.d.....$......$.....d.$.+.#####',
  '#####..............................#####',
  '########D######D###...###D#####D########',
  '######......#.....#...#.....#......#####',
  '######.$..$.#.$.$.#...#.$.$.#.$..$.#####',
  '######..d...#..d..#...#..d..#..d...#####',
  '######....a.#...a.#...#...a.#....a.#####',
  '######......#.....#...#.....#......#####',
  '###################...##################',
  '########........................########',
  '########.a..###..g....g..###..a.########',
  '########.g+.###....a.a...###.+g.########',
  '########............@...........########',
  '#||||||||||||||||||||||||||||||||||||||#',
  '########################################',
  '########################################',
];

// FLOOR 3 — EXECUTIVE SUITE. A cubicle farm of 4x3 bays around two inner
// corridors and an outer loop, the red keycard in a corner office off the
// aisle, and the boardroom behind the red door. The boardroom is the one
// deliberately large room on any floor: the CEO opens at a 5.2u standoff and
// needs the space to use it.
const LEVEL_3 = [
  '########################################',
  '####################X###################',
  '#################.......################',
  '#################...$...################',
  '#################.......################',
  '###########NN#######D#######NN##########',
  '#######$a.#...................#..$######',
  '#######...S..$.............$..S...######',
  '#######$..#..####.......####..#.a$######',
  '###########..####.......####..##########',
  '###########.a...............a.##########',
  '###########.........C.........##########',
  '###########...................##########',
  '###########..$.............$..##########',
  '###########...................##########',
  '####################R###################',
  '###################...##################',
  '#####...........$.......$..........#####',
  '#####.$....$...####...###$....$....#####',
  '#####..g....d..####...###........g.#####',
  '#####+...a....a####.d.###...a....a+#####',
  '#####.####.########...#######.####.#####',
  '#####..............................#####',
  '#$a.#.$....$...####...###$....$....#..$#',
  '#...S.......g..####...###.g......d.S...#',
  '#$..#....a....a####.d.###...a....a.#.a$#',
  '#####.####.########...#######.####.#####',
  '#####..............................#####',
  '#####.$....$...####...###$....$....#####',
  '#####..g....d..####...###.d......g.#####',
  '#####+...a....a####.d.###...a....a+#####',
  '#####.####.########...#######.####.#####',
  '#####...........$.......$..........#####',
  '###################...##################',
  '######.......######.g.#####.....$.######',
  '######.r.....D..g.......g.D.+.....######',
  '######.......######...#####.....$.######',
  '###################.@.##################',
  '#||||||||||||||||||||||||||||||||||||||#',
  '########################################',
];

// Floors in play order. Each stays its own `const LEVEL_*` array so
// reference/validate-level.js keeps finding them by name.
const LEVELS = [LEVEL_1, LEVEL_2, LEVEL_3];
const FLOOR_NAMES = ['ATRIUM \u00b7 SUBLEVEL', 'R&D \u00b7 SERVER FARM', 'EXECUTIVE SUITE'];
// seconds a competent run takes; drives the time bonus on the tally screen
const PAR_TIME = [150, 180, 210];
