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
// g  salaryman guard   d  sec-drone   t  ceiling turret
// k  spark charge      h  corporate enforcer
// C  the CEO (floor 3)   I  BLACK ICE (floor 4)   F  the FOUNDER (floor 5)
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
  '#########.+.....S##...###...t...########',
  '#########.....$a.$#...###a$.....########',
  '#########.........#...###.....a.########',
  '################a$#...##################',
  '###################...##################',
  '#########.......###...###.......########',
  '#########.$....a###...###.$....a########',
  '#########....d.............k....########',
  '#########a....$.###...###a....$.########',
  '#########.......###...###.......########',
  '#########NN###NN####R###################',
  '#########.......###...###.......########',
  '#####$a.#.$....a###...###.$....a#..$####',
  '#####...S..r....................S...####',
  '#####$..#..t....###...###...g...#.a$####',
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
  '#########.....$a.$#.t.###a$.....########',
  '#########.........#...###.......########',
  '################a$#...##################',
  '####################R###################',
  '###################...##################',
  '######........#####...####........######',
  '######.....$.a#####...####.$.....a######',
  '##$a.#...##...#####...####...##...#..$##',
  '##...S.r.##...D..........D...##.b.S...##',
  '##$..#...##g..#####...####..h##...#.a$##',
  '######a.....$.#####...####a.$.....######',
  '######........#####...####........######',
  '###################...##################',
  '#####..............................#####',
  '#####.+.$.k.....$......$.....k.$.+.#####',
  '#####..............................#####',
  '########D######D###...###D#####D########',
  '######......#.....#...#.....#......#####',
  '######.$..$.#.$.$.#...#.$.$.#.$..$.#####',
  '######..d...#..t..#...#..d..#..d...#####',
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
  '#######$a.#.........+.........#..$######',
  '#######...S..$.............$..S...######',
  '#######$..#..####.......####..#.a$######',
  '###########..####.......####..##########',
  '###########.a..+.........+..a.##########',
  '###########.........C.........##########',
  '###########..a.............a..##########',
  '###########..$.............$..##########',
  '###########...a...........a...##########',
  '####################R###################',
  '###################...##################',
  '#####...........$.......$..........#####',
  '#####.$....$...####...###$....$....#####',
  '#####..h....d..####...###........g.#####',
  '#####+...a....a####.d.###...a....a+#####',
  '#####.####.########...#######.####.#####',
  '#####..............................#####',
  '#$a.#.$....$...####...###$....$....#..$#',
  '#...S.......k..####...###.t......k.S...#',
  '#$..#....a....a####.d.###...a....a.#.a$#',
  '#####.####.########...#######.####.#####',
  '#####..............................#####',
  '#####.$....$...####...###$....$....#####',
  '#####..g....d..####...###.d......h.#####',
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

// FLOOR 4 — BLACK ICE \u00b7 DATA VAULT. Cold storage: four east-west aisles of
// racks off the spine, a ring around all of them, and the vault behind the red
// door. The vault is the floor's one large room, and unlike the boardroom it is
// full of pillars on purpose — BLACK ICE opens rooted with a 16u reach, so the
// fight is about what you can put between you and it. The blue keycard is
// inside, which is what makes the vault the route and not a detour.
const LEVEL_4 = [
  '########################################',
  '####################X###################',
  '#################.......################',
  '#################...$...################',
  '#################.......################',
  '###########NN#######B#######NN##########',
  '########..a.................a..#########',
  '########.....##..........##....#########',
  '########..$..##....I.....##.$..#########',
  '########.a...................a.#########',
  '########....t.............t....#########',
  '########.##.....a.....a.....##.#########',
  '########.##........b........##.#########',
  '########......a.........a......#########',
  '########.....##..........##....#########',
  '########..$..##....t.....##.$..#########',
  '########......+..........+.....#########',
  '####################R###################',
  '###################...##################',
  '#####..a..g.......a..........d.....#####',
  '#####.a.h.....d.$.......a.g....h.a.#####',
  '##.a#.###########.#....###########.#####',
  '##$.S.#############...############.#####',
  '##..#.#############...############.#####',
  '#####..g..a..k...t..a....k...a..g..#####',
  '#####.###########.#....###########.#####',
  '#####.#############.$.############.#####',
  '#####.#############...############.#####',
  '#####.a..d.....h........d.....g..a.#####',
  '#####.###########.#....###########.#a.##',
  '#####.#############..a############.S.$##',
  '#####.#############...############.#..##',
  '#####...k..a..g.....a...a..h..t.d..#####',
  '#####.###########.#....###########.#####',
  '#####.#############+..############.#####',
  '#####.#############...############.#####',
  '#####.......k.#.............g....$.#####',
  '######..a.....D.....@.........a...######',
  '######.r...$..#..............+..$.######',
  '########################################',
];

// FLOOR 5 — THE SPIRE \u00b7 HELIPAD. The service level is four plant rooms on a
// ring with the red door on the spine; the blue door opens onto the deck. The
// deck is glass on every side and almost bare — four service blocks and nothing
// else. That is the counterpart to the vault: THE FOUNDER's phases shorten its
// reach as they raise its speed, so a floor that let you keep breaking line of
// sight would be fighting its own boss.
const LEVEL_5 = [
  '########################################',
  '####################X###################',
  '############||||||.....|||||############',
  '###########|................|###########',
  '#########|..a......$.......a..|#########',
  '#######|......h..........h......|#######',
  '######|...a..................a...|######',
  '######|....##...............##...|######',
  '######|....##...............##...|######',
  '######|......a............a......|######',
  '######|..$.........F..........$..|######',
  '######|...a..................a...|######',
  '######|....##...............##...|######',
  '######|....##...............##...|######',
  '######|.....a..............a.....|######',
  '#######|........+......+........|#######',
  '#########|...a.....$......a...|#########',
  '###########|................|###########',
  '############|||||||#B#||||||############',
  '###################...##################',
  '####....a......................a....####',
  '####.#########.#k##...##k.#########.####',
  '####.#...h.....####.$.###.....h...#.####',
  '####.#..r...a..####...###...a.....#.####',
  '####.......k....a.......a....k......####',
  '####.#......$..####...###...$.....#.####',
  '####.#.a.......####...###.......a.#.####',
  '####.###############R##############.####',
  '####t##############...#############t####',
  '####.##############...#############.####',
  '####.#.g.......####...###.......g.#.####',
  '####.#.+.......####.a.###.......+.#.####',
  '####......a..d.............d..a.....####',
  '####.#......$..####...###...$..b..#.####',
  '####.#....t....####.+.###.....t...#.####',
  '####.............g.....g............####',
  '###########.a.#####...#####.+.##########',
  '###########$..S...........S..$##########',
  '###########...#..a..@..$..#...##########',
  '########################################',
];

// Floors in play order. Each stays its own `const LEVEL_*` array so
// reference/validate-level.js keeps finding them by name.
const LEVELS = [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5];
const FLOOR_NAMES = ['ATRIUM \u00b7 SUBLEVEL', 'R&D \u00b7 SERVER FARM', 'EXECUTIVE SUITE',
                     'BLACK ICE \u00b7 DATA VAULT', 'THE SPIRE \u00b7 HELIPAD'];
// Seconds a competent run takes; drives the time bonus on the tally screen
// (10 points per second under par).
//
// These were [150, 180, 210, 230, 260], and every one of them was a guess made
// against a floor plan that no longer exists — the first three were set when a
// floor was four or five open halls, and a spine with a ring traverses much
// faster than that did. A stopwatch run at BRING 'EM ON came in at 1:30 on
// floor 2, 1:19 on floor 3, 1:30 on floor 4 and 2:00 on floor 5, so par was
// paying a full-price time bonus for taking twice as long as the floor needs.
//
// Par is now that measurement plus the room the boss rewrite takes. Floors 3
// and 4 were measured with bosses that died in about five seconds; those two
// fights are several times longer now, which is where floor 3's 79s becomes
// 120 and floor 4's 90s becomes 135. Floors 1 and 2 have no boss and take the
// measurement almost straight — floor 1 was never timed, and is set just under
// floor 2 because it is the smaller, thinner floor. Floor 5 gets the most
// headroom of all: the largest floor, the longest fight, and the only one
// where dying to the death blast costs you the whole run back.
const PAR_TIME = [100, 110, 120, 135, 150];
