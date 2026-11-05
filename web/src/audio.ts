// Music and sound effects (all CC0, see docs/ASSETS.md).
// Browsers block audio until the player interacts, so nothing plays before the
// first tap/click. Mute is remembered in localStorage.

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
  | 'error';

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
};
const MUSIC_FILE = '/assets/audio/music-apple-cider.m4a';
const MUSIC_VOLUME = 0.3;
const SFX_VOLUME = 0.6;
const MUTE_KEY = 'nearvest.muted';

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let music: HTMLAudioElement | null = null;
let unlocked = false;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
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
  if (muted) return;
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
    else if (!muted && unlocked) void music.play().catch(() => undefined);
  });
}

export function playSound(name: SoundName): void {
  if (muted || !ctx || !sfxGain) return;
  const buffer = buffers.get(name);
  if (!buffer) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(sfxGain);
  src.start();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
  if (value) music?.pause();
  else if (unlocked) startMusic();
  for (const l of listeners) l(muted);
}

export function onMuteChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
