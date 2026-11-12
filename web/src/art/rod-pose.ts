// Where the rod, the line and the float are at any moment (art/pond.tsx draws them; Ardian's fishing
// test, package 1, 2026-11-12; docs/PLAN-fishing.md section 8). Pure maths in the pond's 480 x 270 grid,
// tested in web/test/rod-pose.test.ts. The line ALWAYS starts at the rod's tip and ends at the float:
// both come from the same pose, so it can never look broken.
//
// Cast  : the rod swings back, then forward; the float leaves the tip, flies out over the water
//         (bigger = higher, its shadow on the water) and drops in; the line curves out behind it.
// Wait  : the line sags softly from the tip to the float.
// Bite  : the rod BENDS toward the float and trembles; the line is taut (straight).
// Reel  : the float is pulled back to the tip; the rod lifts, still bent, the line taut.

export type Pt = { x: number; y: number };
export type RodPhase = 'ready' | 'casting' | 'wait' | 'bite' | 'reeling' | 'result';

/** TaniBot's hands on the end of the dock (it faces right, toward the water). */
export const HANDS: Pt = { x: 75, y: 107 };
/**
 * The rod's places for one pond layout (art/pond-layouts.ts): TaniBot's hands, the float, the rod's
 * length and its angles. Defaults = the 16:9 pond.
 */
export interface RodGeo {
  hands: Pt;
  float: Pt;
  rodLen: number;
  angles: { rest: number; back: number; forward: number; wait: number; reel: number };
}
/** The float on the open water in the middle (well away from the frogs and the ducks). */
export const FLOAT_AT: Pt = { x: 250, y: 142 };
export const ROD_LEN = 62;
/** Cast animation: swing back, swing forward, the float flies and lands (plunk) at CAST_MS. */
export const CAST_BACK_MS = 260;
export const CAST_RELEASE_MS = 470;
export const CAST_MS = 950;
/** Reel animation: the float comes back to the tip in this time. */
export const REEL_MS = 700;

/** Rod angles in degrees above "pointing right" (screen y grows downward). */
const A_BITE_BEND = 16;
/** The 16:9 pond's rod (the default). */
export const WIDE_ROD: RodGeo = { hands: HANDS, float: FLOAT_AT, rodLen: ROD_LEN, angles: { rest: 52, back: 118, forward: 12, wait: 20, reel: 26 } };

export interface RodPose {
  butt: Pt;
  /** The rod is a quadratic curve butt -> tip with this control point (on the straight rod = no bend). */
  ctrl: Pt;
  tip: Pt;
  /** How much the rod bends (0 = straight), for tests and the data attribute. */
  bend: number;
  /** The line: quadratic curve tip -> float with this control point. */
  line: Pt;
  float: Pt;
  /** The float's height over the water while it flies (0 = on the water / hanging at the tip). */
  lift: number;
  /** The float is on the water (ripples show). */
  inWater: boolean;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const easeOut = (p: number) => 1 - (1 - p) * (1 - p);
const easeIn = (p: number) => p * p;
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A rod at `angle` degrees, bent by `bend` degrees toward the water (clockwise on screen). */
export function rodAt(angle: number, bend = 0, G: RodGeo = WIDE_ROD): { butt: Pt; ctrl: Pt; tip: Pt } {
  const HANDS = G.hands;
  const ROD_LEN = G.rodLen;
  const a = rad(angle);
  const dir = { x: Math.cos(a), y: -Math.sin(a) };
  const ctrl = { x: HANDS.x + dir.x * ROD_LEN * 0.55, y: HANDS.y + dir.y * ROD_LEN * 0.55 };
  // Bending: the tip turns down toward the water and the chord gets a little shorter.
  const b = rad(angle - bend);
  const chord = ROD_LEN * (1 - Math.min(Math.abs(bend), 40) / 300);
  const tip = { x: HANDS.x + Math.cos(b) * chord, y: HANDS.y - Math.sin(b) * chord };
  return { butt: HANDS, ctrl, tip };
}

/** Where the float hangs under the tip when it is not in the water. */
const hang = (tip: Pt): Pt => ({ x: tip.x + 2, y: tip.y + 7 });

/**
 * The pose for a phase, `ms` after its animation started (casting / wait: since the Cast tap, Infinity
 * for a line resumed from the server; reeling: since the Reel tap; bite: since the bite, for the
 * tremble). `still` = reduced motion: end poses, no tremble.
 */
export function rodPose(phase: RodPhase, ms: number, still = false, G: RodGeo = WIDE_ROD): RodPose {
  const FLOAT_AT = G.float;
  const { rest: A_REST, wait: A_WAIT } = G.angles;
  // The cast animation runs on into 'wait' when the server answered before it ended.
  if ((phase === 'casting' || phase === 'wait') && !still && ms >= 0 && ms < CAST_MS) return castPose(ms, G);
  if (phase === 'reeling' && !still) return reelPose(ms, G);
  if (phase === 'wait' || phase === 'casting') {
    const r = rodAt(A_WAIT, 0, G);
    const m = mid(r.tip, FLOAT_AT);
    return { ...r, bend: 0, float: FLOAT_AT, line: { x: m.x - 4, y: m.y + 16 }, lift: 0, inWater: true };
  }
  if (phase === 'bite') {
    const tremble = still ? 0 : Math.sin(ms / 38) * 2.2 + Math.sin(ms / 91) * 1.2;
    const bend = A_BITE_BEND + tremble;
    const r = rodAt(A_WAIT, bend, G);
    const f = { x: FLOAT_AT.x - (still ? 0 : Math.abs(Math.sin(ms / 60))), y: FLOAT_AT.y };
    return { ...r, bend, float: f, line: mid(r.tip, f), lift: 0, inWater: true };
  }
  if (phase === 'reeling') return reelPose(REEL_MS, G);
  // ready / result: the rod is raised, the float hangs at the tip.
  const r = rodAt(A_REST, 0, G);
  const f = hang(r.tip);
  return { ...r, bend: 0, float: f, line: mid(r.tip, f), lift: 0, inWater: false };
}

function castPose(ms: number, G: RodGeo): RodPose {
  const FLOAT_AT = G.float;
  const { rest: A_REST, back: A_BACK, forward: A_FORWARD, wait: A_WAIT } = G.angles;
  // The rod: back (ease out), then a fast swing forward past the wait angle, then it settles.
  let angle: number;
  if (ms < CAST_BACK_MS) angle = lerp(A_REST, A_BACK, easeOut(ms / CAST_BACK_MS));
  else if (ms < CAST_RELEASE_MS) angle = lerp(A_BACK, A_FORWARD, easeIn((ms - CAST_BACK_MS) / (CAST_RELEASE_MS - CAST_BACK_MS)));
  else angle = lerp(A_FORWARD, A_WAIT, easeOut(clamp01((ms - CAST_RELEASE_MS) / 300)));
  // The rod flexes a little against the swing.
  const bend = ms < CAST_BACK_MS ? -4 * (ms / CAST_BACK_MS) : ms < CAST_RELEASE_MS ? lerp(-4, 8, (ms - CAST_BACK_MS) / (CAST_RELEASE_MS - CAST_BACK_MS)) : 8 * (1 - clamp01((ms - CAST_RELEASE_MS) / 250));
  const r = rodAt(angle, bend, G);
  if (ms < CAST_RELEASE_MS) {
    const f = hang(r.tip);
    // The float trails the tip a little on the forward swing.
    const k = clamp01((ms - CAST_BACK_MS) / 90);
    const trail = { x: f.x - 4 * k, y: f.y + 3 * k };
    return { ...r, bend, float: trail, line: mid(r.tip, trail), lift: 0, inWater: false };
  }
  if (ms >= CAST_MS) {
    const w = rodPose('wait', 0, false, G);
    return { ...w, ...r, bend };
  }
  // Flying: from where it left the tip straight out to the water spot (seen from above, its height
  // shows as `lift`: drawn bigger, with a shadow), the line curving out behind it.
  const p = (ms - CAST_RELEASE_MS) / (CAST_MS - CAST_RELEASE_MS);
  const from = releasedAt(G);
  const f = { x: lerp(from.x, FLOAT_AT.x, easeOut(p)), y: lerp(from.y, FLOAT_AT.y, easeOut(p)) };
  const m = mid(r.tip, f);
  // The line bows out to the lower side (away from the frog above the path), then settles into the sag.
  const bow = 10 + 14 * Math.sin(Math.PI * p);
  return { ...r, bend, float: f, line: { x: m.x - 2, y: m.y + bow }, lift: Math.sin(Math.PI * p), inWater: false };
}

/** Where the float is when it leaves the tip (the last trailing point of the forward swing). */
function releasedAt(G: RodGeo): Pt {
  const f = hang(rodAt(G.angles.forward, 8, G).tip);
  return { x: f.x - 4, y: f.y + 3 };
}

function reelPose(ms: number, G: RodGeo): RodPose {
  const FLOAT_AT = G.float;
  const { rest: A_REST, wait: A_WAIT, reel: A_REEL } = G.angles;
  // First the float comes in with the rod kept low (its line stays clear of the frog above the path),
  // then the rod lifts back to rest with the float hanging at the tip.
  const p1 = clamp01(ms / (REEL_MS * 0.7));
  const p2 = clamp01((ms - REEL_MS * 0.7) / (REEL_MS * 0.3));
  const angle = p2 > 0 ? lerp(A_REEL, A_REST, easeOut(p2)) : lerp(A_WAIT, A_REEL, p1);
  const bend = A_BITE_BEND * (1 - p1) + 4 * Math.sin(Math.PI * p1);
  const r = rodAt(angle, bend, G);
  const end = hang(r.tip);
  const e = easeIn(p1);
  const f = { x: lerp(FLOAT_AT.x, end.x, e), y: lerp(FLOAT_AT.y, end.y, e) };
  return { ...r, bend, float: f, line: mid(r.tip, f), lift: 0, inWater: p1 < 0.15 };
}

/** A point on a quadratic curve. */
export function qAt(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** The unit normal of a quadratic curve at t (pointing to the curve's right-hand side on screen). */
export function qNormal(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
  const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
  const n = Math.hypot(dx, dy) || 1;
  return { x: -dy / n, y: dx / n };
}
