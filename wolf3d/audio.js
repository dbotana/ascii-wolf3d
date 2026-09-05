'use strict';

// Procedural Web Audio: a rain bed, a traffic hum, and one-shot blips. No
// asset files, by constraint. The whole graph sits behind a try/catch, so a
// browser that refuses an AudioContext gets a silent game rather than a broken
// one — which is also why the headless harness runs with audio disabled.

// ─── AUDIO (procedural, CSP-safe) ───────────────────────────
let audio = null, audioReady = false, muted = false;
let masterGain, sfxGain, musicGain, noiseBuf;

function initAudio() {
  if (audioReady) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('no webaudio');
    audio = new AC();
    masterGain = audio.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(audio.destination);

    sfxGain = audio.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(masterGain);

    // Music hangs off masterGain rather than sfxGain: `M` already ramps
    // masterGain, so muting covers the march for free, and the march does not
    // duck every time a gunshot pushes sfxGain around.
    musicGain = audio.createGain();
    musicGain.gain.value = 0.16;
    musicGain.connect(masterGain);

    // shared white-noise buffer (rain bed + every noise-based SFX)
    const sr = audio.sampleRate;
    noiseBuf = audio.createBuffer(1, sr * 2, sr);
    const dat = noiseBuf.getChannelData(0);
    for (let i = 0; i < dat.length; i++) dat[i] = Math.random() * 2 - 1;

    // ambience: rain outside the glass
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuf; noise.loop = true;
    const bp = audio.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const rainG = audio.createGain();
    rainG.gain.value = 0.075;
    noise.connect(bp); bp.connect(rainG); rainG.connect(masterGain);
    noise.start();

    // ambience: HVAC / traffic hum
    const h1 = audio.createOscillator(), h2 = audio.createOscillator();
    h1.type = 'sawtooth'; h2.type = 'sawtooth';
    h1.frequency.value = 48; h2.frequency.value = 51;
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.7;
    const humG = audio.createGain();
    humG.gain.value = 0.05;
    const lfo = audio.createOscillator(); lfo.frequency.value = 0.12;
    const lfoAmp = audio.createGain(); lfoAmp.gain.value = 0.018;
    lfo.connect(lfoAmp); lfoAmp.connect(humG.gain);
    h1.connect(lp); h2.connect(lp); lp.connect(humG); humG.connect(masterGain);
    h1.start(); h2.start(); lfo.start();

    audioReady = true;
  } catch (e) {
    audioReady = false;
  }
}

function blip(freq, dur, type, gain, slideTo) {
  if (!audioReady) return;
  try {
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}

function noiseBurst(dur, freq, gain, q) {
  if (!audioReady) return;
  try {
    const t = audio.currentTime;
    const s = audio.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.9 + Math.random() * 0.3;
    const f = audio.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1.1;
    const g = audio.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxGain);
    s.start(t); s.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}

function sfx(name) {
  if (!audioReady || muted) return;
  switch (name) {
    case 'shot':      noiseBurst(0.13, 1500, 0.5, 0.8); blip(190, 0.09, 'square', 0.16, 60); break;
    case 'knife':     noiseBurst(0.07, 3200, 0.16, 3.0); blip(1500, 0.05, 'sine', 0.06, 2600); break;
    case 'smg':       noiseBurst(0.07, 1800, 0.34, 1.1); blip(230, 0.05, 'square', 0.11, 90); break;
    case 'chain':     noiseBurst(0.05, 1200, 0.30, 0.7); blip(150, 0.04, 'square', 0.10, 70); break;
    // the shotgun is the widest, lowest noise in the game and the sniper the
    // sharpest — they are 0.80s and 1.30s apart, so both get room to ring out
    case 'boom':      noiseBurst(0.30, 620, 0.60, 0.45); blip(96, 0.20, 'square', 0.22, 34); break;
    case 'bolt':      noiseBurst(0.22, 2800, 0.52, 2.4); noiseBurst(0.34, 420, 0.26, 0.6);
                      blip(300, 0.14, 'square', 0.19, 58); break;
    case 'spin':      blip(90, 0.42, 'sawtooth', 0.13, 320); break;
    case 'swap':      blip(520, 0.05, 'square', 0.10, 780); noiseBurst(0.04, 2400, 0.07, 1.6); break;
    case 'enemyShot': noiseBurst(0.11, 1100, 0.22, 0.9); break;
    case 'dry':       blip(1400, 0.04, 'square', 0.07, 900); break;
    case 'reload':    noiseBurst(0.06, 2200, 0.10, 1.2); blip(420, 0.05, 'square', 0.09, 260);
                      setTimeout(() => blip(300, 0.05, 'square', 0.08, 200), 320); break;
    case 'reloadDone': blip(760, 0.06, 'square', 0.11, 1080); noiseBurst(0.05, 1800, 0.08, 1.4); break;
    case 'hit':       noiseBurst(0.07, 480, 0.20, 2.0); break;
    case 'kill':      noiseBurst(0.30, 320, 0.30, 0.8); blip(140, 0.32, 'sawtooth', 0.12, 42); break;
    case 'blast':     noiseBurst(0.45, 180, 0.42, 0.55); blip(70, 0.40, 'sawtooth', 0.20, 34); break;
    case 'ouch':      blip(240, 0.16, 'sawtooth', 0.20, 90); noiseBurst(0.10, 700, 0.16, 1.4); break;
    case 'bark':      blip(300, 0.10, 'square', 0.16, 420); blip(430, 0.09, 'square', 0.12, 300); break;
    case 'ping':      blip(1250, 0.07, 'sine', 0.13, 1750); break;
    case 'door':      noiseBurst(0.42, 320, 0.16, 1.6); blip(90, 0.42, 'sine', 0.10, 150); break;
    case 'secret':    noiseBurst(1.15, 240, 0.15, 1.0); blip(58, 1.15, 'sine', 0.11, 92); break;
    case 'deny':      blip(150, 0.16, 'square', 0.16, 90); break;
    case 'pickup':    blip(880, 0.07, 'square', 0.15, 1320); break;
    case 'key':       blip(660, 0.08, 'square', 0.14); blip(990, 0.10, 'square', 0.13); break;
    case 'clear':     [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'square', 0.16), i * 130)); break;
    case 'die':       blip(300, 1.1, 'sawtooth', 0.22, 45); noiseBurst(0.8, 260, 0.20, 0.7); break;
  }
}

function toggleMute() {
  if (!audioReady) return;
  muted = !muted;
  masterGain.gain.setTargetAtTime(muted ? 0 : 0.55, audio.currentTime, 0.05);
  toast(muted ? 'AUDIO MUTED' : 'AUDIO ON');
}

// ─── MUSIC (procedural chiptune march) ──────────────────────
//
// A lookahead scheduler, not a setInterval: every frame it schedules whatever
// falls inside the next MUSIC_LOOKAHEAD seconds against `audio.currentTime`,
// so the beat is on the audio clock rather than the frame clock and a dropped
// frame does not drop a note.
//
// The notes want absolute start times, which `blip` and `noiseBurst` cannot
// give — both schedule relative to currentTime the moment they are called.
// Rather than grow those to seven positional parameters, the two voices below
// are their own dozen lines. It is the one place in the audio graph where a
// one-shot helper genuinely did not fit.

// Each voice is a list of [semitone-from-root, beats]; null is a rest. The
// bass list is one bar, and its wrap is where a track change lands. `drum` is
// one bar of eighths: x kick, s snare, . rest. New content is a table row.
const MUSIC = [
  { name: 'ATRIUM', bpm: 130, root: 43,           // G2 — plodding, corporate
    bass: [[0, 1], [0, 0.5], [7, 0.5], [0, 1], [-2, 1]],
    lead: [[12, 0.5], [15, 0.5], [12, 1], [10, 0.5], [7, 0.5], [null, 1]],
    drum: 'x..s..x.' },
  { name: 'SERVERS', bpm: 142, root: 41,          // F2 — colder, busier
    bass: [[0, 0.5], [0, 0.5], [12, 0.5], [0, 0.5], [3, 0.5], [3, 0.5], [10, 1]],
    lead: [[15, 0.5], [14, 0.5], [12, 0.5], [10, 0.5], [8, 1], [null, 1]],
    drum: 'x.xs.xx.' },
  { name: 'EXEC', bpm: 150, root: 39,             // Eb2 — the top floor
    bass: [[0, 0.5], [7, 0.5], [0, 0.5], [10, 0.5], [0, 1], [-1, 1]],
    lead: [[19, 0.5], [17, 0.5], [15, 1], [12, 0.5], [15, 0.5], [17, 1]],
    drum: 'xxs.xxs.' },
  { name: 'VAULT', bpm: 138, root: 42,            // F#2 — still, and very cold
    bass: [[0, 1], [0, 0.5], [-2, 0.5], [0, 1], [5, 1]],
    lead: [[12, 1], [null, 0.5], [11, 0.5], [12, 0.5], [7, 0.5], [null, 1]],
    drum: 'x...s...' },
  { name: 'SPIRE', bpm: 156, root: 40,            // E2 — thinner air
    bass: [[0, 0.5], [12, 0.5], [0, 0.5], [7, 0.5], [-3, 1], [0, 1]],
    lead: [[19, 0.5], [16, 0.5], [19, 0.5], [21, 0.5], [16, 1], [12, 1]],
    drum: 'x.s.xxs.' },
  // The boss tracks. Found by NAME off the boss's roster row, not by position:
  // with three bosses "the last row" stopped being a rule and became a bug
  // waiting for the fourth. The floor tracks are still the first LEVELS-many
  // rows, which musicTrackFor indexes directly.
  { name: 'BOARDROOM', bpm: 168, root: 37,        // Db2 — faster, meaner
    bass: [[0, 0.25], [0, 0.25], [0, 0.5], [6, 0.5], [0, 0.5], [8, 0.5], [7, 0.5]],
    lead: [[12, 0.25], [13, 0.25], [12, 0.5], [8, 0.5], [6, 0.5], [12, 1]],
    drum: 'xxsxxxsx' },
  { name: 'ICEWALL', bpm: 160, root: 38,          // D2 — a wall of it
    bass: [[0, 0.5], [0, 0.5], [1, 0.5], [0, 0.5], [8, 0.5], [7, 0.5], [6, 1]],
    lead: [[12, 0.5], [18, 0.5], [17, 0.5], [12, 0.5], [11, 1], [12, 1]],
    drum: 'xxsxx.sx' },
  { name: 'LAST FLIGHT', bpm: 176, root: 36,      // C2 — the bottom of the keyboard
    bass: [[0, 0.25], [0, 0.25], [7, 0.5], [0, 0.25], [0, 0.25], [10, 0.5], [-2, 1]],
    lead: [[24, 0.25], [23, 0.25], [19, 0.5], [15, 0.5], [12, 0.5], [19, 0.5], [24, 0.5]],
    drum: 'xxsxxsxs' },
];

const MUSIC_LOOKAHEAD = 0.25;   // seconds of notes queued ahead of the clock

let musicVoices = null, musicDrumV = null, musicTrack = null, musicPending = null;

/**
 * Which march is playing. A boss's track takes over the moment it has actually
 * noticed you — the same liveness test the boss bar uses, so the music and the
 * health bar arrive together rather than one spoiling the other.
 *
 * The boss track is looked up by the NAME on its roster row. It used to be
 * `MUSIC[MUSIC.length - 1]`, which was fine while there was one boss and is a
 * silent mis-pick the moment there are two. Floor tracks are still positional:
 * the first LEVELS-many rows, in floor order.
 */
function musicTrackFor() {
  if (boss && boss.alive && boss.state !== 'idle') {
    const want = bossRow().track;
    // the fallback is the first boss row: a roster typo should cost the right
    // march, not silence the scheduler mid-fight. A test pins every name.
    return MUSIC.find(t => t.name === want) || MUSIC[LEVELS.length];
  }
  return MUSIC[levelIndex % LEVELS.length];
}

function midiHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }

/** One pitched note, at an absolute time on the audio clock. */
function musicNote(hz, dur, type, gain, at) {
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(hz, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(musicGain);
  o.start(at); o.stop(at + dur + 0.02);
}

/** One drum hit, at an absolute time. Kick is a pitch drop, snare is noise. */
function musicHit(kind, at) {
  if (kind === 'x') {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, at);
    o.frequency.exponentialRampToValueAtTime(38, at + 0.11);
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    o.connect(g); g.connect(musicGain);
    o.start(at); o.stop(at + 0.16);
  } else {
    const sN = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    sN.buffer = noiseBuf;
    f.type = 'highpass'; f.frequency.value = 1400;
    g.gain.setValueAtTime(0.28, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    sN.connect(f); f.connect(g); g.connect(musicGain);
    sN.start(at); sN.stop(at + 0.12);
  }
}

function startTrack(tr, when) {
  musicTrack = tr;
  musicVoices = [
    { seq: tr.bass, i: 0, t: when, type: 'triangle', gain: 0.30, oct: 0 },
    { seq: tr.lead, i: 0, t: when, type: 'square',   gain: 0.13, oct: 12 },
  ];
  musicDrumV = { i: 0, t: when };
}

/**
 * Called once a frame from frame(). Silent — and clockless — while paused,
 * dead or won: a march under a pause banner is worse than quiet. The tally
 * screen keeps it, because a floor-cleared screen with the music cut sounds
 * like a crash rather than a reward.
 */
function stepMusic() {
  if (!audioReady) return;
  const live = gameState === 'playing' || gameState === 'cleared';
  if (!live) { musicVoices = null; musicDrumV = null; musicTrack = null; musicPending = null; return; }

  const want = musicTrackFor();
  const now = audio.currentTime;
  if (!musicVoices) startTrack(want, now + 0.05);
  else if (want !== musicTrack && want !== musicPending) musicPending = want;

  const spb = 60 / musicTrack.bpm;
  const horizon = now + MUSIC_LOOKAHEAD;

  for (let vi = 0; vi < musicVoices.length; vi++) {
    const v = musicVoices[vi];
    let guard = 0;
    while (v.t < horizon && guard++ < 64) {
      const step = v.seq[v.i];
      const dur = step[1] * spb;
      // While muted the clock still runs but nothing is scheduled, so unmuting
      // drops you back into the bar rather than restarting it.
      if (step[0] !== null && !muted) {
        musicNote(midiHz(musicTrack.root + step[0] + v.oct), dur * 0.92, v.type, v.gain, v.t);
      }
      v.t += dur;
      v.i++;
      if (v.i >= v.seq.length) {
        v.i = 0;
        // The bass list is one bar, so its wrap is the bar line — the one
        // place a track change can land without cutting a note in half.
        if (vi === 0 && musicPending) {
          startTrack(musicPending, v.t);
          musicPending = null;
          return;
        }
      }
    }
  }

  const dv = musicDrumV, pat = musicTrack.drum, eighth = spb * 0.5;
  let guard = 0;
  while (dv.t < horizon && guard++ < 64) {
    const k = pat[dv.i % pat.length];
    if (k !== '.' && !muted) musicHit(k, dv.t);
    dv.t += eighth;
    dv.i++;
  }
}
