'use strict';

// Procedural Web Audio: a rain bed, a traffic hum, and one-shot blips. No
// asset files, by constraint. The whole graph sits behind a try/catch, so a
// browser that refuses an AudioContext gets a silent game rather than a broken
// one — which is also why the headless harness runs with audio disabled.

// ─── AUDIO (procedural, CSP-safe) ───────────────────────────
let audio = null, audioReady = false, muted = false;
let masterGain, sfxGain, noiseBuf;

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
    case 'enemyShot': noiseBurst(0.11, 1100, 0.22, 0.9); break;
    case 'dry':       blip(1400, 0.04, 'square', 0.07, 900); break;
    case 'reload':    noiseBurst(0.06, 2200, 0.10, 1.2); blip(420, 0.05, 'square', 0.09, 260);
                      setTimeout(() => blip(300, 0.05, 'square', 0.08, 200), 320); break;
    case 'reloadDone': blip(760, 0.06, 'square', 0.11, 1080); noiseBurst(0.05, 1800, 0.08, 1.4); break;
    case 'hit':       noiseBurst(0.07, 480, 0.20, 2.0); break;
    case 'kill':      noiseBurst(0.30, 320, 0.30, 0.8); blip(140, 0.32, 'sawtooth', 0.12, 42); break;
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
