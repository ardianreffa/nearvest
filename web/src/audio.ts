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
