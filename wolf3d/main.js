'use strict';

// Player movement, the frame loop, and boot. Loaded last: it is the only file
// that starts anything, and by the time it runs every system it calls exists.

// ─── MOVEMENT ───────────────────────────────────────────────
function updatePlayer(dt) {
  if (gameState !== 'playing') return;
  const running = keys.has('shift');
  const speed = 3.4 * (running ? 1.75 : 1) * dt;
  const turn  = 2.2 * dt;
  const fx = Math.cos(player.a), fy = Math.sin(player.a);
  const sx = Math.cos(player.a + Math.PI / 2), sy = Math.sin(player.a + Math.PI / 2);

  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup'))   { mx += fx; my += fy; }
  if (keys.has('s') || keys.has('arrowdown')) { mx -= fx; my -= fy; }
  if (keys.has('a')) { mx -= sx; my -= sy; }
  if (keys.has('d')) { mx += sx; my += sy; }

  const mag = Math.hypot(mx, my);
  if (mag > 0.001) {
    mx = mx / mag * speed; my = my / mag * speed;
    const BUF = 0.24;
    if (!blockAt(player.x + mx + Math.sign(mx) * BUF, player.y)) player.x += mx;
    if (!blockAt(player.x, player.y + my + Math.sign(my) * BUF)) player.y += my;
    player.bob += speed * 5.5;
  } else {
    player.bob += dt * 1.2;
  }

  if (keys.has('arrowleft'))  player.a -= turn;
  if (keys.has('arrowright')) player.a += turn;

  if (player.fireCd > 0) player.fireCd -= dt;
  if (player.hurtT  > 0) player.hurtT  -= dt;
  if (player.flashT > 0) player.flashT -= dt;
}

// ─── FRAME ──────────────────────────────────────────────────
let last = performance.now(), hudTick = 0, animT = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  animT += dt;
  if (gameState === 'playing') levelTime += dt;

  const trigger = keys.has(' ') || mouseHeld;
  stepSpin(dt, trigger);

  if (firePressed) {
    firePressed = false;
    if (gameState === 'cleared') advanceFromTally();
    else fire();
  }
  // Hold to repeat, but only for weapons that repeat. The pistol is one shot
  // per press — it reaches fire() through the edge above and nowhere else.
  if (trigger && gameState === 'playing' && curWeapon().auto) fire();

  updatePlayer(dt);
  stepDoors(dt);
  stepSecrets(dt);
  stepEnemies(dt);
  stepItems(dt);
  stepGun(dt);
  stepReload(dt);
  stepDmgPops(dt);
  stepHitDirs(dt);
  stepHpBar(dt);
  stepTally(dt);
  stepToast(dt);
  updatePrompt();

  // ── clear
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const horizon = Math.floor(ROWS * 0.5);
  const zbuf = new Float32Array(COLS);

  // ── WALL / FLOOR / CEILING PASS
  drawWalls(zbuf, horizon, animT);

  // ── SPRITES
  drawSprites(zbuf, horizon);

  // ── DAMAGE NUMBERS (over sprites, under the weapon)
  drawDmgPops(zbuf, horizon);

  // ── CROSSHAIR + WEAPON
  drawCrosshair(horizon);
  drawHitDirs(horizon);
  if (gameState === 'playing') drawGun();

  // ── SCREEN FLASHES
  if (player.flashT > 0) {
    ctx.fillStyle = 'rgba(255,225,160,' + (player.flashT / 0.09 * 0.13).toFixed(3) + ')';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  if (player.hurtT > 0) {
    ctx.fillStyle = 'rgba(220,30,50,' + (player.hurtT / 0.28 * 0.30).toFixed(3) + ')';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // ── HUD refresh (cheap, every ~12 frames)
  if ((++hudTick % 12) === 0) syncHud();

  requestAnimationFrame(frame);
}

// ─── BOOT ───────────────────────────────────────────────────
const splash = document.getElementById('splash');
// A latch, not a parentElement check. The splash is not removed for 600ms, so
// the original guard let begin() run twice — once from a difficulty row and
// again when that click bubbled to #splash, or from a keypress landing inside
// the fade. Twice means two audio graphs and, worse, TWO requestAnimationFrame
// chains that both re-arm forever: every system would step twice per frame.
let booted = false;
function begin() {
  if (booted || !splash.parentElement) return;
  booted = true;
  splash.classList.add('fade-out');
  setTimeout(() => splash.remove(), 600);
  initAudio();                 // inside the user gesture
  startLevel();
  const start = () => {
    initAtlas();
    last = performance.now();
    requestAnimationFrame(frame);
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start, start);
  else start();
}
splash.addEventListener('click', begin);

// Difficulty rows. Each row is its own element with its own handler, NOT one
// delegated listener on #splash: the stub DOM keeps a single handler per type
// per element, so delegating would replace the boot click above — which is the
// path the headless harness uses to start the game.
//
// A row's click also bubbles to #splash and calls begin() a second time. That
// is safe now only because begin() latches; see the note on `booted`.
const diffRows = DIFFICULTY.map((d, i) => el('diff' + i));
function paintDiff() {
  for (let i = 0; i < diffRows.length; i++) {
    if (diffRows[i]) diffRows[i].classList.toggle('sel', i === difficulty);
  }
}
for (let i = 0; i < diffRows.length; i++) {
  if (!diffRows[i]) continue;
  diffRows[i].addEventListener('click', () => { setDifficulty(i); paintDiff(); begin(); });
}
paintDiff();

addEventListener('keydown', e => {
  if (!splash.parentElement) return;
  const k = e && e.key;
  if (k >= '1' && k <= '4') { setDifficulty(+k - 1); paintDiff(); }
  begin();
}, { once: true });
