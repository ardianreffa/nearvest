// Arena v2 "lite" (docs/PLAN-arena.md section 7): the pure parts of a turn-based match on the web,
// unit-tested in web/test/arena-turn.test.ts. The server decides every turn
// (server/src/arena-match.ts); the web only sends the player's pick and plays back what the server
// decided: both picks above the two TaniBots, then the Fruit Fight throw / hit, a dodge, or the Gold
// Durian. The player (the challenger) is always on the left ("me").

import type { ArenaPick, MatchSummary, MatchView, TurnHit, TurnLog } from './api';
import { flightMs, fmt, type Fruit } from './arena-play.ts';

export const PICK_LABEL: Record<ArenaPick | 'timeout', string> = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors', gold: 'Gold Durian', timeout: 'Time’s up!' };

/** What a missed turn is called everywhere (banner, bubble, the line under the stage). */
export const TIMES_UP = 'Time’s up!';

/** The other side's name on screen: "budi" in an online duel, "budi's TaniBot" against the computer. */
export const foeLabel = (m: Pick<MatchSummary, 'kind' | 'you' | 'challenger' | 'defender'>) => {
  const them = m.you === 'challenger' ? m.defender.name : m.challenger.name;
  return m.kind === 'live' ? them : `${them}'s TaniBot`;
};

const swap = <T>(o: { c: T; d: T }): { c: T; d: T } => ({ c: o.d, d: o.c });
const other = <T extends string | null>(s: T): T => (s === 'challenger' ? 'defender' : s === 'defender' ? 'challenger' : s) as T;

/**
 * Online duel seen by the challenged player: the match turned around so that "me" is always the
 * challenger (left side), and the whole duel screen works unchanged. TaniBot duels stay as they are.
 */
export function asMine<M extends MatchSummary>(m: M): M {
  if (m.kind !== 'live' || m.you !== 'defender') return m;
  const out = { ...m, you: 'challenger' as const, challenger: m.defender, defender: m.challenger, hp: swap(m.hp), skill: swap(m.skill), bonus: swap(m.bonus), winner: other(m.winner) };
  const turns = (m as unknown as { turns?: TurnLog[] }).turns;
  if (turns)
    (out as unknown as { turns: TurnLog[] }).turns = turns.map((t) => ({
      ...t,
      pick: swap(t.pick) as TurnLog['pick'],
      winner: other(t.winner as 'challenger') as TurnLog['winner'],
      hits: t.hits.map((h) => ({ ...h, to: other(h.to) })),
      hp: swap(t.hp),
      skill: swap(t.skill),
    }));
  return out;
}

/** Why a requested online duel became a TaniBot duel (shown once when it starts), or null. */
export function inviteNote(m: Pick<MatchSummary, 'kind' | 'inviteResult' | 'defender'>): string | null {
  if (m.kind !== 'bot') return null;
  const d = m.defender.name;
  switch (m.inviteResult) {
    case 'declined':
      return `${d} said no: you fight ${d}'s TaniBot!`;
    case 'timeout':
      return `${d} did not answer: you fight ${d}'s TaniBot!`;
    case 'busy':
      return `${d} is in another duel: you fight ${d}'s TaniBot!`;
    case 'judge':
      return `Judge gardens cannot be challenged online: you fight ${d}'s TaniBot!`;
    default:
      return null;
  }
}

/** The player's side ("me", left) and the computer's ("them", right). */
export const sideOf = (to: TurnHit['to']): 'me' | 'them' => (to === 'challenger' ? 'me' : 'them');

/** The controls: Rock / Paper / Scissors and the Gold Durian button (lit when the skill bar is full). */
export function controls(m: MatchView, busy: boolean): { rps: boolean; gold: boolean; goldLit: boolean; skill: string } {
  // Online duel: after your pick, wait for the other player's (no second pick).
  const playing = m.status === 'playing' && !busy && !m.myPick;
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
  /** The Gold Durian (about 3 s, Ardian 2026-11-11): the thrower charges up, a giant durian falls
   *  from the sky like a meteor (slowing down just before it hits), then the big impact. */
  charge: number;
  meteor: number;
  goldImpact: number;
}

export function turnTimes(reduced: boolean): TurnTimes {
  return reduced
    ? { reveal: 500, windup: 0, impact: 600, dodge: 600, charge: 0, meteor: 0, goldImpact: 900 }
    : { reveal: 700, windup: 300, impact: 700, dodge: 800, charge: 900, meteor: 1100, goldImpact: 1200 };
}

/** One hit's length: wind-up + flight + impact, or the Gold Durian's charge + meteor + impact. */
function hitLength(h: TurnHit, T: TurnTimes, reduced: boolean): number {
  if (h.gold) return T.charge + T.meteor + T.goldImpact;
  return (reduced ? 0 : T.windup + flightMs(h.fruit)) + T.impact;
}

/** How long a decided turn plays (ms). */
export function turnLength(log: TurnLog, reduced: boolean): number {
  const T = turnTimes(reduced);
  if (!log.hits.length) return T.reveal + T.dodge;
  return T.reveal + log.hits.reduce((n, h) => n + hitLength(h, T, reduced), 0);
}

export type TurnPhase = 'reveal' | 'windup' | 'flight' | 'charge' | 'meteor' | 'impact' | 'dodge' | 'done';

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
 * (the thrower winds up, the fruit flies, it lands: life drops), or both dodge on a tie. A Gold
 * Durian: charge, meteor, impact (`sinceImpact` counts from the landing as for any hit).
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
    const hit = { ...h, from: sideOf(h.to) === 'me' ? ('them' as const) : ('me' as const), index: k };
    let land: number;
    let impact: number;
    if (h.gold) {
      if (t < at + T.charge) return { phase: 'charge', hit, sinceImpact: t - at, hp, skill: skillPrev };
      if (t < at + T.charge + T.meteor) return { phase: 'meteor', hit, sinceImpact: t - at - T.charge, hp, skill: skillPrev };
      land = at + T.charge + T.meteor;
      impact = T.goldImpact;
    } else {
      const fly = reduced ? 0 : flightMs(h.fruit);
      if (!reduced && t < at + T.windup) return { phase: 'windup', hit, sinceImpact: 0, hp, skill: skillPrev };
      if (!reduced && t < at + T.windup + fly) return { phase: 'flight', hit, sinceImpact: 0, hp, skill: skillPrev };
      land = at + (reduced ? 0 : T.windup + fly);
      impact = T.impact;
    }
    // The hit lands: that side's life drops by this hit.
    if (h.to === 'challenger') hp[0] = Math.max(0, hp[0] - h.damage);
    else hp[1] = Math.max(0, hp[1] - h.damage);
    if (t < land + impact) return { phase: 'impact', hit, sinceImpact: t - land, hp, skill: after };
    at = land + impact;
  }
  return { phase: 'done', hit: null, sinceImpact: 0, hp: [log.hp.c, log.hp.d], skill: after };
}

/** The banner of a decided turn. */
export function turnBanner(log: TurnLog, them: string, live = false): string {
  // One wording everywhere for a missed turn (Ardian 2026-11-11), with the typographic apostrophe.
  if (log.pick.c === 'timeout' && log.pick.d === 'timeout') return TIMES_UP;
  if (log.winner === 'both') return 'GOLD DURIAN x2!';
  if (log.hits.some((h) => h.gold)) return 'GOLD DURIAN!';
  if (log.pick.c === 'timeout' || log.pick.d === 'timeout') return TIMES_UP;
  if (log.winner === 'tie') return 'Dodge!';
  return log.winner === 'challenger' ? 'You win the turn!' : live ? `${them} wins the turn` : `${them}'s TaniBot wins the turn`;
}

/** Why the turn went that way, in words ("Rock beats Scissors"). */
export function turnReason(log: TurnLog, them = 'the', live = false): string {
  const { c, d } = log.pick;
  if (c === 'timeout' && d === 'timeout') return `${TIMES_UP} Nobody moved in 10 s, so both are hit.`;
  if (c === 'timeout') return `${TIMES_UP} No move in 10 s, so ${live ? them : `${them === 'the' ? 'the' : `${them}’s`} TaniBot`} wins the turn.`;
  if (d === 'timeout') return `${TIMES_UP} ${them} did not move in 10 s, so you win the turn.`;
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

/** The big line at the end ("K.O.!"; "TIME UP!" only after the 200-turn safety net). */
export const endBanner = (m: MatchSummary) => (m.endReason === 'turns' ? 'TIME UP!' : 'K.O.!');

/** What the result gave the player: PANEN after the Season rule (server), XP and a line. */
export function matchReward(m: MatchSummary): { panen: number | null; xp: number; line: string } {
  const xp = m.gainedXp;
  if (m.kind === 'live') {
    const foe = m.you === 'challenger' ? m.defender.name : m.challenger.name;
    if (m.status === 'cancelled') return { panen: null, xp: 0, line: 'Duel cancelled before the first turn ended. It does not count for anyone.' };
    if (m.endReason === 'abandoned') return { panen: null, xp: 0, line: 'Both players left: nobody wins. No PANEN lost.' };
    if (m.practice === 'self') return { panen: null, xp: 0, line: 'Practice duel: these gardens share a browser, sign-in or network, so there is no prize or XP.' };
    if (!matchWon(m)) return { panen: null, xp, line: m.endReason === 'left' ? 'You left the duel, so it counts as a loss. No PANEN lost.' : 'No PANEN lost: the Arena never takes your tokens.' };
    if (m.practice === 'limit') return { panen: null, xp, line: "Today's prizes from this device or network are used up." };
    return { panen: m.prize, xp, line: m.endReason === 'left' ? `${foe} left the duel, so you win! Paid by the game.` : 'Paid by the game: nobody loses a token in the Arena.' };
  }
  if (m.practice === 'self') return { panen: null, xp: 0, line: 'Practice duel: these gardens share a browser or sign-in, so there is no prize or XP.' };
  if (m.you === 'defender') return { panen: null, xp, line: matchWon(m) ? 'Your TaniBot defended your garden!' : 'No PANEN lost: the Arena never takes your tokens.' };
  if (m.endReason === 'left') return { panen: null, xp: 0, line: 'You missed your last 3 turns, so it counts as leaving the duel. No PANEN lost.' };
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
  if (m.kind === 'live') {
    if (m.endReason === 'abandoned') return `Online duel with ${them}: both left`;
    if (m.endReason === 'left') return matchWon(m) ? `${them} left the online duel: you win` : `You left the online duel with ${them}`;
    return matchWon(m) ? `You beat ${them} online (${lifeScore(m)} life)` : `${them} beat you online (${lifeScore(m)} life)`;
  }
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
  if (m.kind === 'live') return `I beat ${m.defender.name} in a live Fruit Fight in the Tandur Arena! 🌳⚔️ Grow. Harvest. Own. on @NEARProtocol #NEARHackathon`;
  return `My TaniBot beat ${m.defender.name}'s TaniBot at Rock Paper Scissors in the Tandur Arena! 🌳⚔️ Grow. Harvest. Own. on @NEARProtocol #NEARHackathon`;
}

/** "Your garden bonus +13% · Theirs +20%". */
export const bonusLine = (m: MatchSummary) => `Garden bonus: you +${fmt(m.bonus.c)}% · them +${fmt(m.bonus.d)}%`;

/** The line under the stage while playing (no turn limit: a duel runs until a K.O.). */
export function turnLine(m: MatchView, waiting: boolean, playing?: number): string {
  // While a decided turn plays back: that turn's number (the next one starts after it).
  if (playing !== undefined) return `Turn ${playing + 1}`;
  if (m.status === 'done') return `${m.turns.length} turn${m.turns.length === 1 ? '' : 's'} played`;
  const n = `Turn ${m.turn + 1}`;
  if (m.kind === 'live') {
    const foe = m.defender.name;
    if (m.status === 'paused') return `${n} · Paused`;
    if (m.myPick) return m.theyPicked ? `${n} · Both picked!` : `${n} · Waiting for ${foe}...`;
    if (waiting) return `${n} · Sending...`;
    return m.theyPicked ? `${n} · ${foe} has picked. Your move!` : `${n} · Pick your move!`;
  }
  return waiting ? `${n} · TaniBot is choosing...` : `${n} · Pick your move!`;
}

/** The 10 s clock on the web, from the server's answer (`at` = when the answer arrived, local clock). */
export interface TurnClock {
  /** Local time the open turn's 10 s start, and run out (the server decides; the web only shows it). */
  startsAt: number;
  endsAt: number;
}

export function clockOf(m: MatchView, at: number): TurnClock | null {
  if (m.status !== 'playing' || m.turnMsLeft === undefined) return null;
  const startsAt = at + (m.turnStartsInMs ?? 0);
  return { startsAt, endsAt: startsAt + Math.min(m.turnMs ?? 10_000, m.turnMsLeft) };
}

/**
 * What the countdown shows at local time `now`: whole seconds left (10 ... 0), red and pulsing in the
 * last 3 s, and whether the 10 s have started yet (they start after the last turn's animation).
 */
export function countdown(c: TurnClock, now: number): { secs: number; urgent: boolean; started: boolean; over: boolean } {
  const started = now >= c.startsAt;
  const left = c.endsAt - Math.max(now, c.startsAt);
  const secs = Math.max(0, Math.ceil(left / 1000));
  return { secs, urgent: started && secs <= 3, started, over: now >= c.endsAt };
}
