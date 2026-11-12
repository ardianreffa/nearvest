// The Arena's own music (Ardian 2026-11-13): a fast, upbeat chiptune made in code (Web Audio square /
// triangle waves and noise; no file, no licence). This file only holds the notes (tested in
// web/test/arena-music.test.ts); audio.ts plays them in a loop while a duel is fought.

export const ARENA_BPM = 160;
/** Sixteenth notes per bar (4/4). */
export const STEPS_PER_BAR = 16;
/** Seconds per sixteenth note. */
export const STEP_S = 60 / ARENA_BPM / 4;

export interface MusicNote {
  /** Sixteenth-note step inside the loop. */
  step: number;
  /** Length in steps. */
  len: number;
  /** MIDI note number (69 = A4 = 440 Hz); 0 = the noise hi-hat / snare. */
  midi: number;
  voice: 'lead' | 'bass' | 'arp' | 'hat' | 'snare';
}

export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// A minor, a driving i-VI-III-VII loop (Am F C G), 4 bars, then a second pass with a higher lead.
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const LEAD_A = [76, 0, 76, 79, 76, 0, 74, 72, 74, 0, 72, 69, 72, 74, 76, 0];
const LEAD_B = [72, 0, 72, 76, 77, 0, 76, 74, 72, 0, 74, 76, 79, 0, 81, 0];

function bar(b: number, lead: number[]): MusicNote[] {
  const chord = CHORDS[b % CHORDS.length];
  const at = b * STEPS_PER_BAR;
  const notes: MusicNote[] = [];
  // Bass: root on every eighth, octave jump on the off-beats (energetic, chiptune style).
  for (let s = 0; s < STEPS_PER_BAR; s += 2) notes.push({ step: at + s, len: 1, midi: chord[0] - 12 + (s % 4 === 2 ? 12 : 0), voice: 'bass' });
  // Fast arpeggio of the chord, every sixteenth.
  for (let s = 0; s < STEPS_PER_BAR; s++) notes.push({ step: at + s, len: 1, midi: chord[s % 3] + 12, voice: 'arp' });
  // Hi-hat on every eighth, snare on beats 2 and 4.
  for (let s = 0; s < STEPS_PER_BAR; s += 2) notes.push({ step: at + s, len: 1, midi: 0, voice: 'hat' });
  for (const s of [4, 12]) notes.push({ step: at + s, len: 1, midi: 0, voice: 'snare' });
  // Lead melody (0 = rest), shifted a little per chord so it follows the harmony.
  const shift = [0, -4, -9, -2][b % 4];
  lead.forEach((m, s) => m && notes.push({ step: at + s, len: s === 15 || lead[s + 1] === 0 ? 2 : 1, midi: m + shift, voice: 'lead' }));
  return notes;
}

/** The whole loop: 8 bars (about 12 s at 160 BPM). */
export const ARENA_LOOP: MusicNote[] = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((b) => bar(b, b < 4 ? LEAD_A : LEAD_B));
export const ARENA_LOOP_STEPS = 8 * STEPS_PER_BAR;
