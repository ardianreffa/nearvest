// Arena 1 VS 1 (docs/PLAN-arena.md): the pure parts of the web side, unit-tested in
// web/test/arena.test.ts. The server decides every duel (server/src/arena.ts); the web only shows
// it: the two TaniBots, the three rounds one by one, then the result.

import type { ArenaCan, ArenaRound, ArenaScores, DuelSide, DuelView, Quality, Species, Stage } from './api';

export const ROUND_NAME: Record<ArenaRound, string> = { quality: 'Fruit quality', care: 'Care', ripeness: 'Ripeness' };

/** The viewer's side and the other side ("you" are always on the left). */
export function sides(d: DuelView): { me: DuelSide; them: DuelSide } {
  return d.you === 'challenger' ? { me: d.challenger, them: d.defender } : { me: d.defender, them: d.challenger };
}

/** Round score from the viewer's side: [mine, theirs] after the first `n` rounds. */
export function scoreAfter(d: DuelView, n: number): [number, number] {
  let mine = 0;
  for (const r of d.rounds.slice(0, n)) if (r.winner === d.you) mine++;
  return [mine, Math.min(n, d.rounds.length) - mine];
}

export const youWon = (d: DuelView) => d.winner === d.you;

/** A round from the viewer's side: score, last die (after ties), total, and whether a tie was rolled again. */
export function roundView(d: DuelView, i: number) {
  const r = d.rounds[i];
  const mine = d.you === 'challenger' ? r.c : r.d;
  const theirs = d.you === 'challenger' ? r.d : r.c;
  const last = (x: { dice: number[] }) => x.dice[x.dice.length - 1];
  return {
    round: r.round,
    mine: { score: mine.score, die: last(mine), total: mine.score + last(mine) },
    theirs: { score: theirs.score, die: last(theirs), total: theirs.score + last(theirs) },
    won: r.winner === d.you,
    rerolls: r.c.dice.length - 1,
  };
}

const SPECIES: Record<Species, string> = { mango: 'Mango', rambutan: 'Rambutan', durian: 'Durian' };
const QUALITY: Record<Quality, string> = { common: 'Common', rare: 'Rare', gold: 'Gold' };
const STAGE: Record<Stage, string> = { seed: 'seed', sprout: 'sprout', tree: 'growing', fruiting: 'with fruit', old: 'old tree' };

/** What stands for a garden in a round ("Gold Mango", "3 of 3 trees cared for", "Durian with fruit"). */
export function roundWhat(side: DuelSide, round: ArenaRound): string {
  if (round === 'quality') return side.best ? `${QUALITY[side.best.quality]} ${SPECIES[side.best.species]}` : 'No tree';
  if (round === 'ripeness') return side.ripest ? `${SPECIES[side.ripest.species]} ${STAGE[side.ripest.stage]}` : 'No tree';
  const cared = careCount(side.scores, side.trees);
  return `${cared} of ${side.trees} tree${side.trees === 1 ? '' : 's'} cared for`;
}

/** Trees cared for, back from the Care score (floor(3 x share)): the smallest count with that score. */
function careCount(s: ArenaScores, trees: number): number {
  for (let n = 0; n <= trees; n++) if (Math.floor((3 * n) / Math.max(1, trees)) === s.care) return n;
  return trees;
}

/** The big line of the result. */
export function headline(d: DuelView): string {
  return youWon(d) ? 'YOU WIN!' : 'YOU LOSE';
}

/**
 * What the result gave the viewer: the PANEN really received (after the Season rule, from the
 * server) and the XP, shown as chips, plus one line that explains it.
 */
export function rewardOf(d: DuelView): { panen: number | null; xp: number; line: string } {
  const xp = d.gainedXp;
  if (d.practice === 'self') return { panen: null, xp: 0, line: 'Practice duel: these gardens share a browser or sign-in, so there is no prize or XP.' };
  if (d.you === 'defender') return { panen: null, xp, line: youWon(d) ? 'You defended your garden!' : 'No PANEN lost: the Arena never takes your tokens.' };
  if (!youWon(d)) return { panen: null, xp, line: 'No PANEN lost: the Arena never takes your tokens.' };
  if (d.practice === 'limit') return { panen: null, xp, line: "Today's prizes from this device or network are used up." };
  return { panen: d.prize, xp, line: 'Paid by the game: nobody loses a token in the Arena.' };
}

/** One line version (Recent duels, tests). */
export function rewardLine(d: DuelView): string {
  const r = rewardOf(d);
  const bits = [r.panen ? `+${fmt(r.panen)} PANEN` : '', r.xp ? `+${r.xp} XP` : ''].filter(Boolean).join(' · ');
  return bits ? `${bits}. ${r.line}` : r.line;
}

export const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

/** The prize line in the Arena window ("Win: +2 PANEN (Season 3)"). */
export function prizeChip(prizeNow: number, prize: number, season?: { number: number }): string {
  return `Win: +${fmt(prizeNow)} PANEN${prizeNow !== prize && season ? ` (Season ${season.number})` : ''}`;
}

/** The visit panel's Duel button: label, enabled, and why not. */
export function duelButton(can: ArenaCan | null): { label: string; enabled: boolean; title: string } {
  if (!can) return { label: 'Duel', enabled: false, title: 'Checking the Arena...' };
  switch (can.reason) {
    case null:
      return { label: 'Duel', enabled: true, title: `Challenge this garden (${can.left} duel${can.left === 1 ? '' : 's'} left today)` };
    case 'limit':
      return { label: 'No duels', enabled: false, title: 'You used your duels today. Come back tomorrow!' };
    case 'pair_today':
      return { label: 'Dueled', enabled: false, title: 'You already challenged this garden today.' };
    case 'no_tree':
      return { label: 'Duel', enabled: false, title: 'Plant a tree first: your trees fight for you.' };
    case 'no_tree_them':
      return { label: 'Duel', enabled: false, title: 'This garden has no tree to duel with.' };
    default:
      return { label: 'Duel', enabled: false, title: '' };
  }
}

/** A row of "Recent duels": "You beat budi 2-1" / "budi beat you 2-1" / "sari challenged you: you won 2-1". */
export function recentLine(d: DuelView): string {
  const { them } = sides(d);
  const [a, b] = scoreAfter(d, 3);
  const score = `${Math.max(a, b)}-${Math.min(a, b)}`;
  if (d.you === 'challenger') return youWon(d) ? `You beat ${them.name} ${score}` : `${them.name} beat you ${score}`;
  return youWon(d) ? `${them.name} challenged you: you won ${score}` : `${them.name} challenged you and won ${score}`;
}

/** Notice for duels received since the last one this browser showed. */
export function receivedNotice(fresh: DuelView[]): string | null {
  if (!fresh.length) return null;
  if (fresh.length > 1) return `${fresh.length} farmers challenged you in the Arena. See the Village tab.`;
  const d = fresh[0];
  const [a, b] = scoreAfter(d, 3);
  // The winner's rounds first ("won 2-1").
  const score = `${Math.max(a, b)}-${Math.min(a, b)}`;
  return youWon(d)
    ? `${d.challenger.name} challenged you in the Arena: you won ${score}${d.gainedXp ? ` (+${d.gainedXp} XP)` : ''}!`
    : `${d.challenger.name} challenged you in the Arena and won ${score}. Rematch?`;
}

/** Post text for X after a win. */
export function duelPost(d: DuelView): string {
  const { them } = sides(d);
  const [a, b] = scoreAfter(d, 3);
  return `My TaniBot beat ${them.name} ${a}-${b} in the Tandur Arena! 🌳⚔️ Grow. Harvest. Own. on @NEARProtocol #NEARHackathon`;
}

// ---------- "Fruit Fight" (Ardian 2026-11-11): the duel played as a fighting game ----------
// Each round's winner throws a fruit at the other TaniBot and its life bar drops. The server's
// result is the script: the duel's loser always ends at 0 (K.O.), the winner always keeps some life.

export interface Fruit {
  species: Species;
  quality: Quality;
}

/**
 * The fruit a garden throws in a round, from the trees the server sent: Fruit quality and Care =
 * its best tree, Ripeness = its most grown tree.
 */
export function roundFruit(side: DuelSide, round: ArenaRound): Fruit {
  const t = round === 'ripeness' ? (side.ripest ?? side.best) : (side.best ?? side.ripest);
  return t ? { species: t.species, quality: t.quality } : { species: 'mango', quality: 'common' };
}

const SPECIES_POWER: Record<Species, number> = { mango: 1, rambutan: 1.3, durian: 1.8 };
const QUALITY_POWER: Record<Quality, number> = { common: 1, rare: 1.25, gold: 1.6 };

/** How hard a fruit hits (durian and Gold hit harder). */
export function fruitPower(f: Fruit): number {
  return SPECIES_POWER[f.species] * QUALITY_POWER[f.quality];
}

/** A heavy hit: bigger knock-back and screen shake. */
/**
 * The short white flash on the TaniBot that is hit: on for the first HIT_FLASH_MS after the impact.
 * It is a plain class switched by the turn's clock (never a CSS filter animation): on iPhone Safari a
 * filter animation on the TaniBot could stay stuck on its white frame (both TaniBots white for good).
 */
export const HIT_FLASH_MS = 180;
export const hitFlash = (sinceImpact: number) => sinceImpact >= 0 && sinceImpact < HIT_FLASH_MS;

/**
 * The key of a fighter's art: changes when the white flash goes on and off and when the fighter
 * reaches K.O. / win, so the TaniBot is drawn on a fresh element (no stale white filter on iPhone).
 */
export function fighterArtKey(state: string, flash: boolean): string {
  if (flash && state === 'hit') return 'flash';
  return state === 'win' || state === 'ko' ? `art-${state}` : 'art';
}

export const hardHit = (f: Fruit) => f.species === 'durian' || f.quality === 'gold';

export interface Hit {
  round: number;
  /** Who throws (from the viewer's side: "me" is always on the left). */
  from: 'me' | 'them';
  fruit: Fruit;
  damage: number;
  /** Life after this hit: [mine, theirs] (0-100). */
  hpAfter: [number, number];
  hard: boolean;
}

/**
 * The three hits of a duel, in round order. The duel's loser receives the duel winner's hits, split
 * by fruit power so they add up to exactly 100 (K.O. on the last one). The winner receives at most
 * one hit (it lost one round at most) of 20-60, so it always keeps at least 40.
 */
export function fightHits(d: DuelView): Hit[] {
  const iWon = d.winner === d.you;
  const { me, them } = sides(d);
  const raw = d.rounds.map((r, i) => {
    const from = r.winner === d.you ? ('me' as const) : ('them' as const);
    const fruit = roundFruit(from === 'me' ? me : them, r.round);
    return { round: i, from, fruit, power: fruitPower(fruit), toLoser: (from === 'me') === iWon };
  });
  const loserHits = raw.filter((h) => h.toLoser);
  const total = loserHits.reduce((n, h) => n + h.power, 0);
  let dealt = 0;
  let left = loserHits.length;
  const hp: [number, number] = [100, 100];
  return raw.map((h) => {
    let damage: number;
    if (h.toLoser) {
      left--;
      damage = left === 0 ? 100 - dealt : Math.max(1, Math.round((100 * h.power) / total));
      dealt += damage;
    } else {
      damage = Math.min(60, Math.max(20, Math.round(28 * h.power)));
    }
    const target = h.from === 'me' ? 1 : 0;
    hp[target] = Math.max(0, hp[target] - damage);
    return { round: h.round, from: h.from, fruit: h.fruit, damage, hpAfter: [hp[0], hp[1]] as [number, number], hard: hardHit(h.fruit) };
  });
}

/** Life bar colour: full = mint, half = gold, nearly gone = red. */
export function hpTone(hp: number): 'high' | 'mid' | 'low' {
  return hp > 50 ? 'high' : hp > 20 ? 'mid' : 'low';
}

/** Flight time of a thrown fruit: a mango is small and fast, a durian big and slow. */
export function flightMs(f: Fruit): number {
  return f.species === 'mango' ? 450 : f.species === 'rambutan' ? 600 : 850;
}

export interface FightTimes {
  intro: number;
  round: number;
  banner: number;
  windup: number;
  ko: number;
  celebrate: number;
  /** When the result screen shows. */
  result: number;
}

/** The fight's timing (about 12 s; reduced motion: shorter, the bars jump, nothing flies or shakes). */
export function fightTimes(reduced: boolean): FightTimes {
  const t = reduced
    ? { intro: 500, round: 1500, banner: 700, windup: 0, ko: 1000, celebrate: 900 }
    : { intro: 1200, round: 2700, banner: 600, windup: 300, ko: 1300, celebrate: 1400 };
  return { ...t, result: t.intro + 3 * t.round + t.ko + t.celebrate };
}

export type FightPhase = 'intro' | 'banner' | 'windup' | 'flight' | 'impact' | 'ko' | 'celebrate' | 'result';

/** What the fight shows `t` ms after it started. */
export function fightAt(
  d: DuelView,
  t: number,
  reduced: boolean,
): { phase: FightPhase; round: number; hit: Hit | null; hitAt: number; hp: [number, number]; rounds: number } {
  const T = fightTimes(reduced);
  const hits = fightHits(d);
  const impactAt = (i: number) => T.intro + i * T.round + T.banner + (reduced ? 0 : T.windup + flightMs(hits[i].fruit));
  const hp: [number, number] = [100, 100];
  let landed = 0;
  for (let i = 0; i < hits.length; i++)
    if (t >= impactAt(i)) {
      hp[0] = hits[i].hpAfter[0];
      hp[1] = hits[i].hpAfter[1];
      landed = i + 1;
    }
  const end = T.intro + 3 * T.round;
  if (t >= T.result) return { phase: 'result', round: 2, hit: null, hitAt: 0, hp, rounds: 3 };
  if (t >= end + T.ko) return { phase: 'celebrate', round: 2, hit: null, hitAt: 0, hp, rounds: 3 };
  if (t >= end) return { phase: 'ko', round: 2, hit: null, hitAt: 0, hp, rounds: 3 };
  if (t < T.intro) return { phase: 'intro', round: -1, hit: null, hitAt: 0, hp, rounds: 0 };
  const round = Math.min(2, Math.floor((t - T.intro) / T.round));
  const start = T.intro + round * T.round;
  const hit = hits[round];
  const into = t - start;
  const phase: FightPhase =
    into < T.banner ? 'banner' : t >= impactAt(round) ? 'impact' : reduced ? 'impact' : into < T.banner + T.windup ? 'windup' : 'flight';
  // A round's result shows in the list when its fruit lands (not before).
  return { phase, round, hit, hitAt: impactAt(round), hp, rounds: landed };
}

/** Small note under the prize: the running Season, from the game state (never written in by hand). */
export function seasonLine(season?: { number: number; divisor: number; rewardPercent: number }): string {
  if (!season) return '';
  return season.divisor > 1 ? `Season ${season.number}: rewards are ${fmt(season.rewardPercent)}% now` : `Season ${season.number}: full rewards`;
}
