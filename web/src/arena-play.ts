// Arena 1 VS 1 (docs/PLAN-arena.md): the pure parts of the web side, unit-tested in
// web/test/arena.test.ts. The server decides every duel (server/src/arena.ts); the web only shows
// it: the two TaniBots, the three rounds one by one, then the result.

import type { ArenaCan, ArenaRound, ArenaScores, DuelSide, DuelView, Quality, Species, Stage } from './api';

export const ROUND_NAME: Record<ArenaRound, string> = { quality: 'Fruit quality', care: 'Care', ripeness: 'Ripeness' };
export const ROUND_HINT: Record<ArenaRound, string> = {
  quality: 'Best tree: Common 1, Rare 2, Gold 3',
  care: 'Trees watered, not wilting, no ash',
  ripeness: 'Most grown tree: fruit = 3',
};

/** Milliseconds: when the rounds appear and when the result shows (reduced motion: still cards, a little faster). */
export function duelTimeline(reduced: boolean): { intro: number; round: number; result: number } {
  const intro = reduced ? 400 : 900;
  const round = reduced ? 1000 : 1400;
  return { intro, round, result: intro + 3 * round + (reduced ? 200 : 600) };
}

/** How many rounds are visible `t` ms after the duel screen opened (0-3), and whether the result shows. */
export function duelStep(t: number, reduced: boolean): { rounds: number; result: boolean } {
  const tl = duelTimeline(reduced);
  const rounds = t < tl.intro ? 0 : Math.min(3, 1 + Math.floor((t - tl.intro) / tl.round));
  return { rounds, result: t >= tl.result };
}

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
  return youWon(d) ? 'YOU WIN!' : 'THEY WIN';
}

/** What the result gave the viewer (prize, XP, or why there was no prize). */
export function rewardLine(d: DuelView, seasonNote = ''): string {
  const xp = d.gainedXp ? ` · +${d.gainedXp} XP` : '';
  if (d.practice === 'self') return 'Practice duel: these gardens share a browser or sign-in, so there is no prize or XP.';
  if (d.you === 'defender') return youWon(d) ? `You defended your garden${xp}.` : 'No PANEN lost: the Arena never takes your tokens.';
  if (!youWon(d)) return `No PANEN lost: the Arena never takes your tokens${xp}.`;
  if (d.practice === 'limit') return `Today's prizes from this device or network are used up${xp}.`;
  return `+${fmt(d.prize)} PANEN from the game${seasonNote}${xp}`;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

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
