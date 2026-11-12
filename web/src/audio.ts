// Music and sound effects (all CC0, see docs/ASSETS.md).
// Browsers block audio until the player interacts, so nothing plays before the
// first tap/click. Music and sound effects are switched on/off separately and
// each choice is remembered in localStorage.

export type SoundName =
  | 'click'
  | 'plant'
  | 'water'
  | 'harvest'
  | 'coins'
  | 'burn'
  | 'checkin'
  | 'levelup'
  | 'chain'
  | 'error'
  | 'momentHarvest'
  | 'momentGold'
  | 'momentDurian'
  | 'momentEvolve'
  | 'momentLegend';

const SOUND_FILES: Record<SoundName, string> = {
  click: '/assets/audio/click.m4a',
  plant: '/assets/audio/plant.m4a',
  water: '/assets/audio/water.m4a',
  harvest: '/assets/audio/harvest.m4a',
  coins: '/assets/audio/coins.m4a',
  burn: '/assets/audio/burn.m4a',
  checkin: '/assets/audio/checkin.m4a',
  levelup: '/assets/audio/levelup.m4a',
  chain: '/assets/audio/chain.m4a',
  error: '/assets/audio/error.m4a',
  // Share moments (moment-fx.tsx): CC0 Kenney jingles and sounds, docs/ASSETS.md.
  momentHarvest: '/assets/audio/moment-harvest.m4a',
  momentGold: '/assets/audio/moment-gold.m4a',
  momentDurian: '/assets/audio/moment-durian.m4a',
  momentEvolve: '/assets/audio/moment-evolve.m4a',
  momentLegend: '/assets/audio/moment-legend.m4a',
};
const MUSIC_FILE = '/assets/audio/music-apple-cider.m4a';
const MUSIC_VOLUME = 0.3;
const SFX_VOLUME = 0.6;
const MUSIC_KEY = 'nearvest.music';
const SFX_KEY = 'nearvest.sfx';
/** Older builds had one switch for both. */
const OLD_MUTE_KEY = 'nearvest.muted';

export interface AudioPrefs {
  music: boolean;
  sfx: boolean;
}

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let music: HTMLAudioElement | null = null;
let unlocked = false;
let prefs: AudioPrefs = readPrefs();
const listeners = new Set<(p: AudioPrefs) => void>();

function readPrefs(): AudioPrefs {
  try {
    const old = localStorage.getItem(OLD_MUTE_KEY) === '1';
    const read = (key: string) => {
      const v = localStorage.getItem(key);
      return v === null ? !old : v === '1';
    };
    return { music: read(MUSIC_KEY), sfx: read(SFX_KEY) };
  } catch {
    return { music: true, sfx: true };
  }
}

async function loadBuffers(): Promise<void> {
  if (!ctx) return;
  await Promise.all(
    (Object.keys(SOUND_FILES) as SoundName[]).map(async (name) => {
      try {
        const data = await (await fetch(SOUND_FILES[name])).arrayBuffer();
        buffers.set(name, await ctx!.decodeAudioData(data));
      } catch {
        // A missing sound must never break the game.
      }
    }),
  );
}

function startMusic(): void {
  if (!prefs.music) return;
  if (!music) {
    music = new Audio(MUSIC_FILE);
    music.loop = true;
    music.volume = MUSIC_VOLUME;
  }
  void music.play().catch(() => undefined);
}

/** Call once at startup: audio unlocks on the player's first interaction. */
export function initAudio(): void {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    try {
      ctx = new AudioContext();
      sfxGain = ctx.createGain();
      sfxGain.gain.value = SFX_VOLUME;
      sfxGain.connect(ctx.destination);
      void loadBuffers();
    } catch {
      ctx = null;
    }
    startMusic();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  // Pause music while the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (!music) return;
    if (document.hidden) music.pause();
    else if (prefs.music && unlocked) void music.play().catch(() => undefined);
  });
}

export function playSound(name: SoundName): void {
  if (!prefs.sfx || !ctx || !sfxGain) return;
  const buffer = buffers.get(name);
  if (!buffer) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(sfxGain);
  src.start();
}

/**
 * The Gold Durian's own sound (Arena v2), made right here with Web Audio: no sound file, nothing
 * copied (docs/ASSETS.md). charge = a rising hum while TaniBot gathers power, fall = the whoosh of the
 * meteor, impact = a deep boom with a bright gold ring. Follows the Sound switch like every effect.
 */
export function playGoldDurian(part: 'charge' | 'fall' | 'impact'): void {
  if (!prefs.sfx || !ctx || !sfxGain) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const c = ctx;
  const out = sfxGain;
  const t = c.currentTime;
  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t + delay);
    o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(vol, t + delay + Math.min(0.08, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
    o.connect(g).connect(out);
    o.start(t + delay);
    o.stop(t + delay + dur + 0.05);
  };
  const noise = (dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType) => {
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
  };
  if (part === 'charge') {
    tone('sawtooth', 110, 520, 0.9, 0.12);
    tone('triangle', 220, 1040, 0.9, 0.06);
  } else if (part === 'fall') {
    noise(1.1, 0.35, 300, 2600, 'bandpass');
    tone('sine', 900, 180, 1.1, 0.05);
  } else {
    tone('sine', 95, 38, 0.8, 0.9);
    noise(0.35, 0.6, 1800, 200, 'lowpass');
    tone('triangle', 1320, 1760, 0.5, 0.12, 0.05);
    tone('triangle', 1980, 2640, 0.4, 0.06, 0.12);
  }
}

/**
 * A soft whoosh of leaves for the wipe between gardens (visit-wipe.tsx), made right here with Web
 * Audio: filtered noise, no sound file, nothing copied (docs/ASSETS.md). `soft` = the quieter one
 * when the squares leave. Follows the Sound switch like every effect.
 */
export function playWhoosh(soft = false): void {
  if (!prefs.sfx || !ctx || !sfxGain) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const c = ctx;
  const t = c.currentTime;
  const dur = 0.34;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(soft ? 1400 : 500, t);
  f.frequency.exponentialRampToValueAtTime(soft ? 500 : 1600, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(soft ? 0.08 : 0.14, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxGain);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/**
 * The 8-bit "pixel sparkle" of the wipe between gardens (visit-wipe.tsx): quick square-wave blips on
 * a pentatonic scale (the notes come from visit-wipe-plan.ts `sparkleNotes`), with a quieter
 * triangle voice an octave up for the glitter. Rising for a visit, falling for "Back to my garden".
 * Made right here with Web Audio: no sound file, nothing copied (docs/ASSETS.md). Follows the Sound
 * switch and plays only after the first tap, like every effect.
 */
export function playPixelSparkle(notes: { at: number; freq: number; dur: number; level: number }[]): void {
  if (!prefs.sfx || !ctx || !sfxGain) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const c = ctx;
  const t0 = c.currentTime + 0.01;
  const blip = (type: OscillatorType, freq: number, at: number, dur: number, vol: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0 + at);
    // A tiny upward chirp at the start of each blip: the classic 8-bit "pling".
    o.frequency.setValueAtTime(freq * 1.5, t0 + at);
    o.frequency.exponentialRampToValueAtTime(freq, t0 + at + 0.018);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(sfxGain!);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.02);
  };
  for (const n of notes) {
    blip('square', n.freq, n.at, n.dur, 0.415 * n.level);
    blip('triangle', n.freq * 2, n.at + 0.022, n.dur * 0.8, 0.285 * n.level);
  }
}

/**
 * Fishing sounds (fishing.tsx), made right here with Web Audio: no sound file, nothing copied
 * (docs/ASSETS.md). cast = the rod's swing whoosh + the line's whistle, plop = the "plunk" of the float
 * landing, bite = two quick splashes, reel = the reel's clicks while the line comes in (~0.7 s). The
 * result per tier (fishing-logic.ts catchTier): junk = a soft, slightly funny "bloop-boing"; fish = a
 * splash + a short happy tune; item = a bell "ding-ding" with a glint; gourami = a splash and a
 * festive run with a trill; legend = the biggest gold jingle. Follows the Sound switch and plays only
 * after the first tap, like every effect.
 */
export type FishingSound = 'cast' | 'plop' | 'bite' | 'reel' | 'junk' | 'fish' | 'item' | 'gourami' | 'legend';
export function playFishing(kind: FishingSound): void {
  if (!prefs.sfx || !ctx || !sfxGain) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const c = ctx;
  const out = sfxGain;
  const t = c.currentTime + 0.01;
  const tone = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t + at);
    o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(vol, t + at + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    o.connect(g).connect(out);
    o.start(t + at);
    o.stop(t + at + dur + 0.03);
  };
  const splash = (at: number, dur: number, vol: number, f0: number, f1: number, q = 1.2) => {
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t + at);
    f.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(vol, t + at + Math.min(0.04, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t + at);
    src.stop(t + at + dur + 0.03);
  };
  const run = (notes: number[], step: number, at: number, dur: number, vol: number, type: OscillatorType = 'square') =>
    notes.forEach((f, i) => tone(type, f, f, at + i * step, dur, vol));
  if (kind === 'cast') {
    // Whoosh of the swing (air rising then falling), then the line whistling out.
    splash(0, 0.2, 0.16, 400, 2600, 0.8);
    splash(0.18, 0.24, 0.14, 2600, 700, 0.8);
    tone('sine', 2300, 900, 0.3, 0.45, 0.03);
  } else if (kind === 'plop') {
    // "Plung": a round drop in pitch, a little water, one bubble.
    tone('sine', 760, 150, 0, 0.16, 0.4);
    splash(0.01, 0.14, 0.12, 900, 300);
    tone('sine', 320, 640, 0.13, 0.06, 0.08);
  } else if (kind === 'bite') {
    splash(0, 0.12, 0.25, 1600, 500);
    splash(0.16, 0.14, 0.3, 1400, 400);
    tone('square', 880, 880, 0.02, 0.06, 0.08);
    tone('square', 1175, 1175, 0.1, 0.08, 0.08);
  } else if (kind === 'reel') {
    // The reel's ratchet clicking while it spins, a soft whir under it, a drip as the float leaves the water.
    for (let i = 0; i < 14; i++) tone('square', i % 2 ? 1700 : 2100, i % 2 ? 1650 : 2000, i * 0.048, 0.014, 0.06);
    tone('triangle', 170, 260, 0, 0.68, 0.035);
    splash(0.5, 0.16, 0.1, 1700, 600);
  } else if (kind === 'junk') {
    // Bloop... boing (soft and a bit silly).
    tone('sine', 320, 110, 0, 0.2, 0.28);
    splash(0, 0.1, 0.06, 700, 300);
    tone('triangle', 200, 340, 0.22, 0.12, 0.1);
    tone('triangle', 240, 190, 0.36, 0.26, 0.08);
  } else if (kind === 'fish') {
    splash(0, 0.26, 0.22, 1800, 500);
    run([659, 784, 1046], 0.08, 0.14, 0.1, 0.1);
  } else if (kind === 'item') {
    // A bell: "ding-ding", then a small glint on top.
    tone('sine', 1318, 1318, 0, 0.5, 0.14);
    tone('triangle', 2637, 2637, 0, 0.25, 0.03);
    tone('sine', 1760, 1760, 0.13, 0.55, 0.14);
    tone('triangle', 3520, 3520, 0.13, 0.25, 0.03);
    tone('triangle', 2637, 3136, 0.3, 0.16, 0.05);
  } else if (kind === 'gourami') {
    splash(0, 0.3, 0.26, 2000, 450);
    run([523, 659, 784, 1046, 1318], 0.07, 0.12, 0.1, 0.11);
    run([1568, 1760, 1568, 1760, 1568], 0.05, 0.5, 0.05, 0.06);
    [784, 1046, 1318].forEach((f) => tone('triangle', f, f, 0.78, 0.4, 0.06));
  } else {
    splash(0, 0.32, 0.28, 2200, 450);
    run([523, 659, 784, 1046, 1318, 1568], 0.08, 0.1, 0.14, 0.12);
    [1046, 1318, 1568, 2093].forEach((f) => tone('triangle', f, f, 0.6, 0.8, 0.07));
    tone('triangle', 2093, 3136, 0.62, 0.7, 0.05);
    run([2637, 3136, 3520, 4186], 0.06, 1.0, 0.08, 0.04, 'sine');
  }
}

export function getAudioPrefs(): AudioPrefs {
  return prefs;
}

/** Turns music and/or sound effects on or off and remembers the choice. */
export function setAudioPrefs(change: Partial<AudioPrefs>): void {
  prefs = { ...prefs, ...change };
  try {
    localStorage.setItem(MUSIC_KEY, prefs.music ? '1' : '0');
    localStorage.setItem(SFX_KEY, prefs.sfx ? '1' : '0');
    localStorage.removeItem(OLD_MUTE_KEY);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
  if (!prefs.music) music?.pause();
  else if (unlocked) startMusic();
  for (const l of listeners) l(prefs);
}

export function onAudioPrefsChange(fn: (p: AudioPrefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Ambient layer (weather and time of day) ----------
//
// One quiet loop at a time: day = birds and wind, night = crickets, rain = rain; Mount Tandur's
// rumble plays once when the eruption warning starts. It follows the Sound (sfx) switch, not the
// music switch, and starts only after the first tap like every sound. Web Audio is used so the
// low volume also works on iPhone (HTMLAudio volume is fixed there). All CC0, see docs/ASSETS.md.

export type AmbientKind = 'day' | 'night' | 'rain';

const AMBIENT_FILES: Record<AmbientKind | 'rumble', string> = {
  day: '/assets/audio/ambient-day.m4a',
  night: '/assets/audio/ambient-night.m4a',
  rain: '/assets/audio/ambient-rain.m4a',
  rumble: '/assets/audio/ambient-rumble.m4a',
};
/** Relative to the sound effects volume (0.6): quiet, under the music. */
const AMBIENT_VOLUME = 0.25;
const RUMBLE_VOLUME = 0.7;
const FADE_S = 1.5;

const ambientBuffers = new Map<string, Promise<AudioBuffer | null>>();
let ambientWanted: AmbientKind | null = null;
let ambientPlaying: { kind: AmbientKind; src: AudioBufferSourceNode; gain: GainNode } | null = null;

function ambientBuffer(name: AmbientKind | 'rumble'): Promise<AudioBuffer | null> {
  if (!ctx) return Promise.resolve(null);
  let p = ambientBuffers.get(name);
  if (!p) {
    p = fetch(AMBIENT_FILES[name])
      .then((r) => r.arrayBuffer())
      .then((d) => ctx!.decodeAudioData(d))
      .catch(() => null); // a missing sound must never break the game
    ambientBuffers.set(name, p);
  }
  return p;
}

function fadeOut(node: { src: AudioBufferSourceNode; gain: GainNode }): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  node.gain.gain.cancelScheduledValues(t);
  node.gain.gain.setValueAtTime(node.gain.gain.value, t);
  node.gain.gain.linearRampToValueAtTime(0, t + FADE_S);
  node.src.stop(t + FADE_S + 0.05);
}

async function syncAmbient(): Promise<void> {
  const want = prefs.sfx && unlocked && !document.hidden ? ambientWanted : null;
  if (ambientPlaying?.kind === want) return;
  if (ambientPlaying) {
    fadeOut(ambientPlaying);
    ambientPlaying = null;
  }
  if (!want || !ctx || !sfxGain) return;
  const buffer = await ambientBuffer(want);
  // Something else was asked for while loading.
  if (!buffer || !ctx || !sfxGain || ambientPlaying || want !== (prefs.sfx && unlocked && !document.hidden ? ambientWanted : null)) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(AMBIENT_VOLUME, ctx.currentTime + FADE_S);
  gain.connect(sfxGain);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(gain);
  src.start();
  ambientPlaying = { kind: want, src, gain };
}

/** The loop the garden wants now (null = silence, e.g. outside the garden). */
export function setAmbient(kind: AmbientKind | null): void {
  ambientWanted = kind;
  void syncAmbient();
}

/** Mount Tandur rumbles once (the eruption warning). */
export async function playRumble(): Promise<void> {
  if (!prefs.sfx || !ctx || !sfxGain) return;
  const buffer = await ambientBuffer('rumble');
  if (!buffer || !ctx || !sfxGain) return;
  const gain = ctx.createGain();
  gain.gain.value = RUMBLE_VOLUME;
  gain.connect(sfxGain);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  src.start();
}

// Follow the Sound switch, the first tap and the tab being hidden.
listeners.add(() => void syncAmbient());
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => setTimeout(() => void syncAmbient(), 50));
  document.addEventListener('visibilitychange', () => void syncAmbient());
}
