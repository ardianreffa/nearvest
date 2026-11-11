// Arena v2 "lite" (docs/PLAN-arena.md section 7): the pure parts of a turn-based match on the web,
// unit-tested in web/test/arena-turn.test.ts. The server decides every turn
// (server/src/arena-match.ts); the web only sends the player's pick and plays back what the server
// decided: both picks above the two TaniBots, then the Fruit Fight throw / hit, a dodge, or the Gold
// Durian. The player (the challenger) is always on the left ("me").

import type { ArenaPick, MatchSummary, MatchView, TurnHit, TurnLog } from './api';
import { flightMs, fmt, type Fruit } from './arena-play.ts';

export const PICK_LABEL: Record<ArenaPick, string> = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors', gold: 'Gold Durian' };

/** The player's side ("me", left) and the computer's ("them", right). */
export const sideOf = (to: TurnHit['to']): 'me' | 'them' => (to === 'challenger' ? 'me' : 'them');

/** The controls: Rock / Paper / Scissors and the Gold Durian button (lit when the skill bar is full). */
export function controls(m: MatchView, busy: boolean): { rps: boolean; gold: boolean; goldLit: boolean; skill: string } {
  const playing = m.status === 'playing' && !busy;
  const full = m.skill.c >= m.skillMax;
  return { rps: playing, gold: playing && full, goldLit: full && m.status === 'playing', skill: `${Math.min(m.skill.c, m.skillMax)}/${m.skillMax}` };
}

/** Life [mine, theirs] before turn `i` (the previous turn's result, or full life). */
export function hpBefore(m: MatchView, i: number): [number, number] {
  const prev = m.turns[i - 1];
  return prev ? [prev.hp.c, prev.hp.d] : [m.maxHp, m.maxHp];
}

/** Skill bars [mine, theirs] before turn `i`. */
export function skillBefore(m: MatchView, i: number): [number, number] {
  const prev = m.turns[i - 1];
  return prev ? [prev.skill.c, prev.skill.d] : [0, 0];
}

export interface TurnTimes {
  reveal: number;
  windup: number;
  impact: number;
  dodge: number;
}

export function turnTimes(reduced: boolean): TurnTimes {
  return reduced ? { reveal: 500, windup: 0, impact: 600, dodge: 600 } : { reveal: 700, windup: 300, impact: 700, dodge: 800 };
}

/** How long a decided turn plays (ms). */
export function turnLength(log: TurnLog, reduced: boolean): number {
  const T = turnTimes(reduced);
  if (!log.hits.length) return T.reveal + T.dodge;
  return T.reveal + log.hits.reduce((n, h) => n + (reduced ? 0 : T.windup + flightMs(h.fruit)) + T.impact, 0);
}

export type TurnPhase = 'reveal' | 'windup' | 'flight' | 'impact' | 'dodge' | 'done';

export interface TurnFrame {
  phase: TurnPhase;
  /** The hit in play (windup / flight / impact). */
  hit: (TurnHit & { from: 'me' | 'them'; index: number }) | null;
  /** ms since the hit landed (impact). */
  sinceImpact: number;
  hp: [number, number];
  skill: [number, number];
}

/**
 * What a decided turn shows `t` ms after it started: the two picks pop up (reveal), then each hit
 * (the thrower winds up, the fruit flies, it lands: life drops), or both dodge on a tie.
 */
export function turnAt(m: MatchView, i: number, t: number, reduced: boolean): TurnFrame {
  const log = m.turns[i];
  const T = turnTimes(reduced);
  const hp = hpBefore(m, i);
  const skillPrev = skillBefore(m, i);
  const after: [number, number] = [log.skill.c, log.skill.d];
  if (t < T.reveal) return { phase: 'reveal', hit: null, sinceImpact: 0, hp, skill: skillPrev };
  let at = T.reveal;
  if (!log.hits.length) return { phase: t < at + T.dodge ? 'dodge' : 'done', hit: null, sinceImpact: 0, hp, skill: after };
  for (let k = 0; k < log.hits.length; k++) {
    const h = log.hits[k];
    const fly = reduced ? 0 : flightMs(h.fruit);
    const hit = { ...h, from: sideOf(h.to) === 'me' ? ('them' as const) : ('me' as const), index: k };
    if (!reduced && t < at + T.windup) return { phase: 'windup', hit, sinceImpact: 0, hp, skill: skillPrev };
    if (!reduced && t < at + T.windup + fly) return { phase: 'flight', hit, sinceImpact: 0, hp, skill: skillPrev };
    const land = at + (reduced ? 0 : T.windup + fly);
    // The hit lands: that side's life drops by this hit.
    if (h.to === 'challenger') hp[0] = Math.max(0, hp[0] - h.damage);
    else hp[1] = Math.max(0, hp[1] - h.damage);
    if (t < land + T.impact) return { phase: 'impact', hit, sinceImpact: t - land, hp, skill: after };
    at = land + T.impact;
  }
  return { phase: 'done', hit: null, sinceImpact: 0, hp: [log.hp.c, log.hp.d], skill: after };
}

/** The banner of a decided turn. */
export function turnBanner(log: TurnLog, them: string): string {
  if (log.winner === 'both') return 'GOLD DURIAN x2!';
  if (log.hits.some((h) => h.gold)) return 'GOLD DURIAN!';
  if (log.winner === 'tie') return 'Dodge!';
  return log.winner === 'challenger' ? 'You win the turn!' : `${them}'s TaniBot wins the turn`;
}

/** Why the turn went that way, in words ("Rock beats Scissors"). */
export function turnReason(log: TurnLog): string {
  const { c, d } = log.pick;
  if (c === 'gold' || d === 'gold') return 'The Gold Durian always hits.';
  if (c === d) return `${PICK_LABEL[c]} and ${PICK_LABEL[d]}: both dodge.`;
  const [w, l] = log.winner === 'challenger' ? [c, d] : [d, c];
  return `${PICK_LABEL[w]} beats ${PICK_LABEL[l]}.`;
}

/** A thrown fruit's name ("Gold Durian", "Rare Mango"). */
export function fruitName(f: Fruit): string {
  const q = f.quality === 'common' ? '' : f.quality === 'rare' ? 'Rare ' : 'Gold ';
  return q + f.species.charAt(0).toUpperCase() + f.species.slice(1);
}

export const matchWon = (m: MatchSummary) => m.winner === m.you;

/** The big line under K.O. ("K.O.!" or "TIME UP!" after 15 turns). */
export const endBanner = (m: MatchSummary) => (m.endReason === 'turns' ? 'TIME UP!' : 'K.O.!');

/** What the result gave the player: PANEN after the Season rule (server), XP and a line. */
export function matchReward(m: MatchSummary): { panen: number | null; xp: number; line: string } {
  const xp = m.gainedXp;
  if (m.practice === 'self') return { panen: null, xp: 0, line: 'Practice duel: these gardens share a browser or sign-in, so there is no prize or XP.' };
  if (m.you === 'defender') return { panen: null, xp, line: matchWon(m) ? 'Your TaniBot defended your garden!' : 'No PANEN lost: the Arena never takes your tokens.' };
  if (m.endReason === 'left') return { panen: null, xp: 0, line: 'You left the duel for 2 minutes, so it counts as a loss. No PANEN lost.' };
  if (!matchWon(m)) return { panen: null, xp, line: 'No PANEN lost: the Arena never takes your tokens.' };
  if (m.practice === 'limit') return { panen: null, xp, line: "Today's prizes from this device or network are used up." };
  return { panen: m.prize, xp, line: 'Paid by the game: nobody loses a token in the Arena.' };
}

/** Life left as the score line ("72-0"): winner first. */
function lifeScore(m: MatchSummary): string {
  const a = m.hp.c;
  const b = m.hp.d;
  return `${Math.max(a, b)}-${Math.min(a, b)}`;
}

/** A row of Recent duels / the Village Arena box. */
export function matchLine(m: MatchSummary): string {
  const them = m.you === 'challenger' ? m.defender.name : m.challenger.name;
  if (m.you === 'challenger') {
    if (m.endReason === 'left') return `You left the duel with ${them}'s TaniBot`;
    return matchWon(m) ? `You beat ${them}'s TaniBot (${lifeScore(m)} life)` : `${them}'s TaniBot beat you (${lifeScore(m)} life)`;
  }
  return matchWon(m) ? `${them} challenged your TaniBot: it won!` : `${them} beat your TaniBot`;
}

/** Notice for matches this garden received (since the last one this browser showed). */
export function matchNotice(fresh: MatchSummary[]): string | null {
  if (!fresh.length) return null;
  if (fresh.length > 1) return `${fresh.length} farmers challenged your TaniBot in the Arena. See the Village tab.`;
  const m = fresh[0];
  return matchWon(m)
    ? `${m.challenger.name} challenged your TaniBot in the Arena: your TaniBot won${m.gainedXp ? ` (+${m.gainedXp} XP)` : ''}!`
    : `${m.challenger.name} beat your TaniBot in the Arena. Rematch?`;
}

/** Post text for X after a win. */
export function matchPost(m: MatchSummary): string {
  return `My TaniBot beat ${m.defender.name}'s TaniBot at Rock Paper Scissors in the Tandur Arena! 🌳⚔️ Grow. Harvest. Own. on @NEARProtocol #NEARHackathon`;
}

/** "Your garden bonus +13% · Theirs +20%". */
export const bonusLine = (m: MatchSummary) => `Garden bonus: you +${fmt(m.bonus.c)}% · them +${fmt(m.bonus.d)}%`;

/** The line under the stage while playing. */
export function turnLine(m: MatchView, waiting: boolean, playing?: number): string {
  // While a decided turn plays back: that turn's number (the next one starts after it).
  if (playing !== undefined) return `Turn ${playing + 1} of ${m.maxTurns}`;
  if (m.status === 'done') return `${m.turns.length} turn${m.turns.length === 1 ? '' : 's'} played`;
  const n = `Turn ${m.turn + 1} of ${m.maxTurns}`;
  return waiting ? `${n} · TaniBot is choosing...` : `${n} · Pick your move!`;
}
