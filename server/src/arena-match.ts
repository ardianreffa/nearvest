// Arena v2 "lite" (docs/PLAN-arena.md section 7, Ardian 2026-11-11): a duel played turn by turn
// against the other garden's TaniBot (the computer). Every turn the player picks Rock / Paper /
// Scissors, or throws the Gold Durian when the skill bar is full. The server decides everything:
//
// - The computer's pick for the open turn is chosen and LOCKED in the database when the turn opens
//   (`bot_pick`) and is never part of any answer before the player's pick for that turn arrived.
//   A test checks that every answer is the same whatever the locked pick is.
// - Rock beats Scissors, Scissors beat Paper, Paper beats Rock; the same pick = both dodge.
// - The turn's winner throws a random fruit (species and quality drawn here); durian and Gold hit
//   harder; a small garden bonus (0-20%, from the v1 garden score) makes farming count without
//   deciding the fight.
// - Each turn won fills the skill bar by 1; full (3) = the Gold Durian: a sure hit of 40 (x bonus)
//   that cannot be dodged. The TaniBot throws its own as soon as its bar is full.
// - Each turn the player has 10 s (ARENA_TURN_MS, measured HERE, plus a small grace for slow
//   networks). No pick in time = the player loses the turn: the TaniBot throws (or uses its Gold
//   Durian) and its skill bar fills. Missed turns are decided on the next request or by the 10 s
//   sweep in main.ts, one after another, so a closed page keeps losing turns.
// - No turn limit: the match runs until a K.O. It always ends: a player who does nothing is hit
//   every ~13 s (a safety net of 200 turns is never reached in practice).
// - Prize, XP, limits and anti-cheat are v1's (arena.ts): the match counts toward the day's 3 from
//   the moment it starts. A loss while the player missed the last 3 turns in a row = "left" (no XP).
//
// Arena v3 part 2 (2026-11-11, docs/PLAN-arena.md 7.12): the ONLINE duel against a real player,
// only when the server's switch is on (ARENA_ONLINE=on, `game.arenaOnline`). The same engine:
// - Invite: Duel on an online garden creates the match as kind 'live', status 'invite' for 30 s.
//   The challenged player sees it on their next ping (every 4 s) and may Accept / Decline. Declined,
//   no answer, busy (already in a duel) or a judge garden = the same match goes on against that
//   garden's TaniBot (kind 'bot'): never stuck.
// - Turns: both players have the same 10 s; each pick is stored (pick_c / pick_d) and NEVER sent to
//   the other side before both picks of that turn are in (or the time ran out). No pick in time =
//   that player loses the turn ("Time's up!"); both missing = both are hit.
// - Gone: a side whose web has not asked for the match for 5 s pauses the duel; the other side sees
//   "Waiting for <name>... 20". Back in time = the turn restarts. Not back = the one who stayed WINS
//   (prize + XP like any win, counted in THEIR daily limits); the one who left gets no XP. Gone before
//   the first turn was decided = the duel is cancelled (no prize, not counted). Both gone = no winner.
// - Prize: the winner, whichever side (8 PANEN mint_reward, Season rule); the match uses one of the
//   CHALLENGER's 3 duels a day; accepting uses none of the challenged player's.
// - Anti-cheat: the same person (sign-in, a shared browser in `devices`, or the same IP at accept)
//   = practice (no prize, no XP), as v2's second-garden rule.
//
// Privacy: like v1, only names, avatars, titles, round scores and the trees' public data.

import { randomInt } from 'node:crypto';
import { fromMicro, toMicro, tx, type DB } from './db.ts';
import { GameError, type Game, type PlayerRow } from './game.ts';
import { cleanDeviceId, recordDevice } from './referral.ts';
import { arenaDay, dueledToday, duelsToday, overPaidLimit, winsToday, xpToday, type Arena, type ArenaScores, type DuelSide } from './arena.ts';
import {
  ARENA_BONUS_MAX,
  ARENA_DEFEND_XP_PER_DAY,
  ARENA_DUELS_PER_DAY,
  ARENA_FRUIT_CHANCE,
  ARENA_FRUIT_DAMAGE,
  ARENA_GONE_MS,
  ARENA_INVITE_MS,
  ARENA_PAUSE_MS,
  ARENA_GOLD_DURIAN,
  ARENA_HP,
  ARENA_IDLE_TURNS,
  ARENA_PLAYBACK_GOLD_MS,
  ARENA_PLAYBACK_MS,
  ARENA_PRIZE,
  ARENA_QUALITY_CHANCE,
  ARENA_QUALITY_DAMAGE,
  ARENA_RECENT,
  ARENA_SAFETY_TURNS,
  ARENA_SKILL_MAX,
  ARENA_START_MS,
  ARENA_TURN_GRACE_MS,
  ARENA_TURN_MS,
  ARENA_XP_DEFEND,
  ARENA_XP_LOSS,
  ARENA_XP_WIN,
  ARENA_XP_WINS_PER_DAY,
  DEMO_XP_MULTIPLIER,
  type Quality,
  type Species,
  isOnline,
  titleFor,
} from './rules.ts';

export type Rps = 'rock' | 'paper' | 'scissors';
export type Pick = Rps | 'gold';
export const RPS: readonly Rps[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<Rps, Rps> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
export const isPick = (v: unknown): v is Pick => v === 'gold' || RPS.includes(v as Rps);
/** What the player did in a decided turn: a pick, or nothing in time ('timeout'). */
export type TurnPick = Pick | 'timeout';

/** A random whole number in [0, n). */
export type Rand = (n: number) => number;

export interface Fruit {
  species: Species;
  quality: Quality;
}

export interface TurnHit {
  /** Who is hit. */
  to: 'challenger' | 'defender';
  fruit: Fruit;
  damage: number;
  /** The Gold Durian (sure hit). */
  gold: boolean;
}

/** One decided turn, as stored and shown (both picks are only known once the turn is decided). */
export interface TurnLog {
  turn: number;
  /** 'timeout' = no pick in time (the defender only in an online duel). */
  pick: { c: TurnPick; d: TurnPick };
  winner: 'challenger' | 'defender' | 'tie' | 'both';
  hits: TurnHit[];
  /** Life and skill bars after the turn. */
  hp: { c: number; d: number };
  skill: { c: number; d: number };
}

export interface Bars {
  hp_c: number;
  hp_d: number;
  skill_c: number;
  skill_d: number;
  bonus_c: number;
  bonus_d: number;
}

/** Garden bonus in percent (0-20) from the v1 garden score (0-9): veteran 9 = 20, new player 1/3/3 = 13, neglected <= 3 = 0. */
export function gardenBonus(s: ArenaScores): number {
  const sum = s.quality + s.care + s.ripeness;
  return Math.round((Math.max(0, sum - 3) / 6) * ARENA_BONUS_MAX);
}

function draw<K extends string>(table: Record<K, number>, rand: Rand): K {
  let r = rand(100);
  for (const [k, p] of Object.entries(table) as [K, number][]) {
    if (r < p) return k;
    r -= p;
  }
  return Object.keys(table)[0] as K;
}

/** A turn winner's throw: a random fruit (Mango 50 / Rambutan 35 / Durian 15; Common 70 / Rare 22 / Gold 8). */
export const rollFruit = (rand: Rand): Fruit => ({ species: draw(ARENA_FRUIT_CHANCE, rand), quality: draw(ARENA_QUALITY_CHANCE, rand) });

export const fruitDamage = (f: Fruit, bonus: number) => Math.round(ARENA_FRUIT_DAMAGE[f.species] * ARENA_QUALITY_DAMAGE[f.quality] * (1 + bonus / 100));
export const goldDamage = (bonus: number) => Math.round(ARENA_GOLD_DURIAN * (1 + bonus / 100));
const GOLD_DURIAN: Fruit = { species: 'durian', quality: 'gold' };

/** The computer's pick: its Gold Durian as soon as the bar is full, else Rock / Paper / Scissors at random (cannot be read). */
export const botPick = (skill: number, rand: Rand): Pick => (skill >= ARENA_SKILL_MAX ? 'gold' : RPS[rand(3)]);

/**
 * Decides one turn. `pc` / `pd` must be valid (the Gold Durian only with a full bar). `pc` =
 * 'timeout': the player did not pick in time and loses the turn (the TaniBot throws its fruit, or
 * its Gold Durian when that was its pick, and its skill bar fills).
 */
export function resolveTurn(b: Bars, turn: number, pc: TurnPick, pd: TurnPick, rand: Rand): { bars: Bars; log: TurnLog } {
  const next = { ...b };
  const hits: TurnHit[] = [];
  let winner: TurnLog['winner'];
  const cg = pc === 'gold';
  const dg = pd === 'gold';
  if (pc === 'timeout' && pd === 'timeout') {
    // Online duel: neither player picked in time. Both lose the turn and both are hit (so a duel
    // where nobody plays still ends); no skill for anyone.
    winner = 'both';
    const fc = rollFruit(rand);
    const fd = rollFruit(rand);
    hits.push({ to: 'challenger', fruit: fc, damage: fruitDamage(fc, b.bonus_d), gold: false });
    hits.push({ to: 'defender', fruit: fd, damage: fruitDamage(fd, b.bonus_c), gold: false });
  } else if (pc === 'timeout' && !dg) {
    winner = 'defender';
    const fruit = rollFruit(rand);
    hits.push({ to: 'challenger', fruit, damage: fruitDamage(fruit, b.bonus_d), gold: false });
    next.skill_d = Math.min(ARENA_SKILL_MAX, next.skill_d + 1);
  } else if (pd === 'timeout' && !cg) {
    // Online duel: the challenged player did not pick in time.
    winner = 'challenger';
    const fruit = rollFruit(rand);
    hits.push({ to: 'defender', fruit, damage: fruitDamage(fruit, b.bonus_c), gold: false });
    next.skill_c = Math.min(ARENA_SKILL_MAX, next.skill_c + 1);
  } else if (cg || dg) {
    // A Gold Durian always hits; a side that throws it does not play Rock / Paper / Scissors this turn.
    if (cg) {
      hits.push({ to: 'defender', fruit: GOLD_DURIAN, damage: goldDamage(b.bonus_c), gold: true });
      next.skill_c = 0;
    }
    if (dg) {
      hits.push({ to: 'challenger', fruit: GOLD_DURIAN, damage: goldDamage(b.bonus_d), gold: true });
      next.skill_d = 0;
    }
    winner = cg && dg ? 'both' : cg ? 'challenger' : 'defender';
  } else if (pc === pd) {
    winner = 'tie'; // both dodge
  } else {
    const cWins = BEATS[pc as Rps] === pd;
    winner = cWins ? 'challenger' : 'defender';
    const fruit = rollFruit(rand);
    hits.push({ to: cWins ? 'defender' : 'challenger', fruit, damage: fruitDamage(fruit, cWins ? b.bonus_c : b.bonus_d), gold: false });
    if (cWins) next.skill_c = Math.min(ARENA_SKILL_MAX, next.skill_c + 1);
    else next.skill_d = Math.min(ARENA_SKILL_MAX, next.skill_d + 1);
  }
  for (const h of hits) {
    if (h.to === 'defender') next.hp_d = Math.max(0, next.hp_d - h.damage);
    else next.hp_c = Math.max(0, next.hp_c - h.damage);
  }
  return { bars: next, log: { turn, pick: { c: pc, d: pd }, winner, hits, hp: { c: next.hp_c, d: next.hp_d }, skill: { c: next.skill_c, d: next.skill_d } } };
}

/** How long the web plays a decided turn before the next turn's 10 s start (the Gold Durian is longer). */
export const playbackMs = (log: TurnLog) => ARENA_PLAYBACK_MS + log.hits.filter((h) => h.gold).length * ARENA_PLAYBACK_GOLD_MS;

/**
 * Is the match over? Only by a K.O. (no turn limit). Both thrown down in the same turn (e.g. two Gold
 * Durians) = a DRAW (Ardian 2026-11-13): no winner. Only the safety net of 200 turns (never reached in
 * a real match) still picks a winner: most life, then most hits landed, then the challenged garden.
 */
export function matchEnd(b: Bars, turns: TurnLog[]): { winner: Side | null; reason: 'ko' | 'turns' | 'draw' } | null {
  const ko = b.hp_c <= 0 || b.hp_d <= 0;
  if (!ko && turns.length < ARENA_SAFETY_TURNS) return null;
  if (b.hp_c <= 0 && b.hp_d <= 0) return { winner: null, reason: 'draw' };
  const reason = ko ? ('ko' as const) : ('turns' as const);
  if (b.hp_c !== b.hp_d) return { winner: b.hp_c > b.hp_d ? 'challenger' : 'defender', reason };
  const landed = (to: TurnHit['to']) => turns.reduce((n, t) => n + t.hits.filter((h) => h.to === to).length, 0);
  const byC = landed('defender');
  const byD = landed('challenger');
  return { winner: byC > byD ? 'challenger' : 'defender', reason };
}


interface MatchData {
  c: DuelSide;
  d: DuelSide;
  turns: TurnLog[];
}

export type MatchStatus = 'invite' | 'playing' | 'paused' | 'done' | 'cancelled';
type Side = 'challenger' | 'defender';
/** 'draw' (2026-11-13): both thrown down in the same turn; winner NULL, nobody gets a prize. */
export type EndReason = 'ko' | 'turns' | 'left' | 'abandoned' | 'draw';
export type InviteResult = 'accepted' | 'declined' | 'timeout' | 'busy' | 'skipped' | 'judge' | 'cancelled';

interface MatchRow extends Bars {
  id: number;
  kind: 'bot' | 'live';
  status: MatchStatus;
  challenger_id: number;
  defender_id: number;
  duel_day: number;
  turn: number;
  bot_pick: Pick | null;
  winner: Side | null;
  end_reason: EndReason | null;
  practice: 'self' | 'limit' | null;
  prize_micro: number;
  job_id: number | null;
  xp_c: number;
  xp_d: number;
  data: string;
  ip: string | null;
  device_id: string | null;
  seen_at: number;
  turn_started_at: number | null;
  created_at: number;
  ended_at: number | null;
  pick_c: Pick | null;
  pick_d: Pick | null;
  seen_d: number;
  invite_ends_at: number | null;
  invite_result: InviteResult | null;
  paused_side: Side | null;
  pause_ends_at: number | null;
  ip_d: string | null;
  device_d: string | null;
  job_status?: string | null;
  tx_hash?: string | null;
}

const MATCH_SELECT = 'SELECT m.*, j.status AS job_status, j.tx_hash FROM arena_matches m LEFT JOIN chain_jobs j ON j.id = m.job_id';
const OPEN = "('invite', 'playing', 'paused')";

/**
 * A match as a player sees it. NEVER holds `bot_pick`, nor the OTHER player's pick of the open turn
 * (online duel): only whether they picked. Both picks are part of the turn once it is decided.
 */
export function matchView(r: MatchRow, viewerId: number, explorerTxUrl: string, now = 0) {
  const data = JSON.parse(r.data) as MatchData;
  const you: Side = r.challenger_id === viewerId ? 'challenger' : 'defender';
  const started = r.turn_started_at ?? r.created_at;
  const open = r.status === 'playing';
  const live = r.kind === 'live';
  const mine = you === 'challenger' ? r.pick_c : r.pick_d;
  const theirs = you === 'challenger' ? r.pick_d : r.pick_c;
  const sideName = (s: Side | null) => (s === 'challenger' ? data.c.name : s === 'defender' ? data.d.name : null);
  return {
    id: r.id,
    v: 2 as const,
    /** 'bot' = against the other garden's TaniBot; 'live' = against the player (online duel). */
    kind: r.kind,
    at: r.created_at,
    endedAt: r.ended_at,
    you,
    challenger: data.c,
    defender: data.d,
    status: r.status,
    /** Turns decided so far; the next pick is for turn `turn`. */
    turn: r.turn,
    /** The turn clock (server time): 10 s per turn. The open turn's 10 s start in `turnStartsInMs`
     *  (while the web plays the last turn), then `turnMsLeft` count down. 0 / 0 when not playing. */
    turnMs: ARENA_TURN_MS,
    turnStartsInMs: open ? Math.max(0, started - now) : 0,
    turnMsLeft: open ? Math.min(ARENA_TURN_MS, Math.max(0, started + ARENA_TURN_MS - now)) : 0,
    hp: { c: r.hp_c, d: r.hp_d },
    maxHp: ARENA_HP,
    skill: { c: r.skill_c, d: r.skill_d },
    skillMax: ARENA_SKILL_MAX,
    bonus: { c: r.bonus_c, d: r.bonus_d },
    turns: data.turns,
    winner: r.winner,
    /** 'ko' | 'turns' | 'left' (a player left) | 'abandoned' (online: both left) | 'draw' (both K.O. in one turn; winner null). */
    endReason: r.end_reason,
    practice: r.practice,
    /** PANEN the winner received (after the Season rule); 0 = none. Bot matches: the challenger only. */
    prize: fromMicro(r.prize_micro),
    prizeStatus: r.job_status ?? null,
    txUrl: r.tx_hash && !r.tx_hash.startsWith('fake') ? explorerTxUrl + r.tx_hash : null,
    gainedXp: you === 'challenger' ? r.xp_c : r.xp_d,
    // ---- Online duel (only these few fields; the other player's open pick is never here) ----
    /** Your own pick for the open turn (online duel), so a refresh keeps it. */
    myPick: live && (r.status === 'playing' || r.status === 'paused') ? mine : null,
    /** The other player has picked for the open turn (not WHAT they picked). */
    theyPicked: live && (r.status === 'playing' || r.status === 'paused') ? theirs !== null : false,
    /** The invite's time left (status 'invite'). */
    inviteLeftMs: r.status === 'invite' && r.invite_ends_at ? Math.max(0, r.invite_ends_at - now) : 0,
    /** How the invite ended ('declined' / 'timeout' / 'busy' / 'skipped' / 'judge' = a TaniBot duel now). */
    inviteResult: r.invite_result,
    /** Paused: whose web is gone (the other side waits for them) and how long they have left. */
    waitingFor: r.status === 'paused' ? sideName(r.paused_side) : null,
    pauseLeftMs: r.status === 'paused' && r.pause_ends_at ? Math.max(0, r.pause_ends_at - now) : 0,
  };
}

export type MatchView = ReturnType<typeof matchView>;

/** A finished match in lists (state, Arena window): no turn log, so the 8 s state poll stays small. */
export function matchSummary(r: MatchRow, viewerId: number, explorerTxUrl: string) {
  const { turns, ...rest } = matchView(r, viewerId, explorerTxUrl);
  return { ...rest, turns: undefined, turnCount: turns.length };
}

export type MatchSummary = ReturnType<typeof matchSummary>;

/**
 * The v2 part of `state.arena`: `v: 2` (the web plays turn-based duels), the open match to resume
 * (as challenger, or an online duel this garden accepted), matches this garden's TaniBot received.
 */
export function arenaMatchState(db: DB, playerId: number, explorerTxUrl: string, online = false) {
  const open = db
    .prepare(
      `SELECT m.id, m.kind, m.challenger_id, c.name AS cname, d.name AS dname FROM arena_matches m JOIN players c ON c.id = m.challenger_id JOIN players d ON d.id = m.defender_id
       WHERE (m.challenger_id = ? AND m.status IN ${OPEN}) OR (m.defender_id = ? AND m.kind = 'live' AND m.status IN ('playing', 'paused')) ORDER BY m.id DESC LIMIT 1`,
    )
    .get(playerId, playerId) as { id: number; kind: string; challenger_id: number; cname: string; dname: string } | undefined;
  // Online duels are not "received" (the player played them); their TaniBot did not fight.
  const received = (
    db.prepare(`${MATCH_SELECT} WHERE m.defender_id = ? AND m.status = 'done' AND m.kind != 'live' ORDER BY m.ended_at DESC LIMIT ?`).all(playerId, ARENA_RECENT) as unknown as MatchRow[]
  ).map((r) => matchSummary(r, playerId, explorerTxUrl));
  return {
    v: 2 as const,
    active: open ? { id: open.id, opponent: open.challenger_id === playerId ? open.dname : open.cname, live: open.kind === 'live' } : null,
    receivedMatches: received,
    /** The online duel is switched on (ARENA_ONLINE): Duel on an online garden sends an invite. */
    online,
  };
}

/** New titles from a finished match (challenger, defender). */
interface Titles {
  c: string | null;
  d: string | null;
}
const NO_TITLES: Titles = { c: null, d: null };
const merge = (a: Titles, b: Titles): Titles => ({ c: b.c ?? a.c, d: b.d ?? a.d });

export class ArenaMatches {
  private db: DB;
  private game: Game;
  private arena: Arena;
  private now: () => number;
  private rand: Rand;
  private explorerTxUrl: string;

  constructor(db: DB, game: Game, arena: Arena, now: () => number, opts: { rand?: Rand; explorerTxUrl?: string } = {}) {
    this.db = db;
    this.game = game;
    this.arena = arena;
    this.now = now;
    this.rand = opts.rand ?? ((n) => randomInt(0, n));
    this.explorerTxUrl = opts.explorerTxUrl ?? 'https://testnet.nearblocks.io/txns/';
  }

  private row(id: number): MatchRow | undefined {
    return this.db.prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(id) as unknown as MatchRow | undefined;
  }

  private view(r: MatchRow, viewerId: number): MatchView {
    return matchView(r, viewerId, this.explorerTxUrl, this.now());
  }

  /** Finished matches of this garden, both roles (Arena window "Recent duels"). */
  recent(viewerId: number): MatchSummary[] {
    return (
      this.db
        .prepare(`${MATCH_SELECT} WHERE (m.challenger_id = ? OR m.defender_id = ?) AND m.status = 'done' ORDER BY m.ended_at DESC LIMIT ?`)
        .all(viewerId, viewerId, ARENA_RECENT) as unknown as MatchRow[]
    ).map((r) => matchSummary(r, viewerId, this.explorerTxUrl));
  }

  /** Open matches this garden is in (as challenger, or as the player of an online duel), after their clocks were applied. */
  private openRows(playerId: number, asDefenderInvite = false): MatchRow[] {
    const rows = this.db
      .prepare(
        `${MATCH_SELECT} WHERE m.status IN ${OPEN} AND (m.challenger_id = ? OR (m.defender_id = ? AND m.kind = 'live' AND (m.status != 'invite' OR ?)))`,
      )
      .all(playerId, playerId, asDefenderInvite ? 1 : 0) as unknown as MatchRow[];
    const out: MatchRow[] = [];
    for (const r of rows) {
      this.tick(r);
      const again = this.row(r.id)!;
      if (again.status === 'invite' || again.status === 'playing' || again.status === 'paused') out.push(again);
    }
    return out;
  }

  /** The open match of this garden, if any (after deciding its missed turns: it may be over now). */
  private openOf(playerId: number): MatchRow | undefined {
    return this.openRows(playerId)[0];
  }

  private isJudge(p: PlayerRow): boolean {
    return !!this.db.prepare("SELECT 1 FROM users WHERE id = ? AND provider = 'judge'").get(p.user_id);
  }

  private online(p: PlayerRow): boolean {
    const r = this.db.prepare('SELECT active_at FROM players WHERE id = ?').get(p.id) as { active_at: number | null } | undefined;
    return isOnline(r?.active_at, this.now());
  }

  /**
   * Starts a match against the garden `name` (the v1 checks and limits; counts toward the day's 3 at
   * once). `live` (the online duel switch is on and the garden is online, not a judge garden, not in
   * a duel): an invite to the player; otherwise against its TaniBot (with `inviteResult` saying why
   * when an online duel was asked for but could not be).
   */
  start(viewerId: number, name: unknown, ip: string | null, device: unknown, live = false): { match: MatchView } {
    return tx(this.db, () => {
      const now = this.now();
      const me = this.game.getPlayer(viewerId);
      const them = typeof name === 'string' ? this.game.getPlayerByName(name.trim().toLowerCase()) : undefined;
      if (!them || them.account_status !== 'ready') throw new GameError('Garden not found', 404, { code: 'unknown_garden' });
      if (them.id === me.id) throw new GameError('You cannot challenge your own garden.', 400, { code: 'own_garden' });
      const open = this.openOf(me.id);
      if (open) throw new GameError('Finish your duel first.', 409, { code: 'match_open', matchId: open.id });
      const c = this.arena.side(me);
      const d = this.arena.side(them);
      if (c.trees === 0) throw new GameError('Plant a tree first: your trees fight for you in the Arena.', 409, { code: 'no_tree_you' });
      if (d.trees === 0) throw new GameError(`${them.name} has no tree to duel with right now.`, 409, { code: 'no_trees' });
      if (duelsToday(this.db, me.id, now) >= ARENA_DUELS_PER_DAY)
        throw new GameError(`You used your ${ARENA_DUELS_PER_DAY} duels today. Come back tomorrow!`, 429, { code: 'arena_limit' });
      if (dueledToday(this.db, me.id, now).has(them.id)) throw new GameError(`You already challenged ${them.name} today. Pick another farmer!`, 429, { code: 'arena_pair_today' });

      const deviceId = cleanDeviceId(device);
      recordDevice(this.db, me.id, deviceId, now);
      const practice = this.arena.samePerson(me, them, deviceId) ? ('self' as const) : null;
      // The online duel: only with the switch on and the garden online right now.
      let kind: 'bot' | 'live' = 'bot';
      let note: InviteResult | null = null;
      if (live && this.game.arenaOnline && this.online(them)) {
        if (this.isJudge(them)) note = 'judge';
        else if (this.openRows(them.id, true).length) note = 'busy';
        else kind = 'live';
      }
      const data: MatchData = { c, d, turns: [] };
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO arena_matches (kind, status, challenger_id, defender_id, duel_day, turn, hp_c, hp_d, skill_c, skill_d, bonus_c, bonus_d, bot_pick, practice, data, ip, device_id, seen_at, created_at, turn_started_at, invite_ends_at, invite_result)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            kind,
            kind === 'live' ? 'invite' : 'playing',
            me.id,
            them.id,
            arenaDay(now),
            ARENA_HP,
            ARENA_HP,
            gardenBonus(c.scores),
            gardenBonus(d.scores),
            kind === 'live' ? null : botPick(0, this.rand),
            practice,
            JSON.stringify(data),
            ip,
            deviceId,
            now,
            now,
            kind === 'live' ? null : now + ARENA_START_MS,
            kind === 'live' ? now + ARENA_INVITE_MS : null,
            note,
          ).lastInsertRowid,
      );
      return { match: this.view(this.row(id)!, me.id) };
    });
  }

  /** The newest open invite to this garden (shown as "<name> challenges you!"), for the ping. */
  invite(playerId: number): { id: number; from: string; avatar: string; title: string; msLeft: number } | null {
    if (!this.game.arenaOnline) return null;
    return tx(this.db, () => {
      const rows = this.db.prepare(`${MATCH_SELECT} WHERE m.defender_id = ? AND m.status = 'invite' ORDER BY m.id DESC`).all(playerId) as unknown as MatchRow[];
      for (const r of rows) {
        this.tick(r);
        const again = this.row(r.id)!;
        if (again.status !== 'invite') continue;
        const c = (JSON.parse(again.data) as MatchData).c;
        return { id: again.id, from: c.name, avatar: c.avatar, title: c.title, msLeft: Math.max(0, (again.invite_ends_at ?? 0) - this.now()) };
      }
      return null;
    });
  }

  /** The challenged player accepts the invite: the online duel starts (the first turn after a short moment). */
  accept(viewerId: number, id: number, ip: string | null, device: unknown): { match: MatchView } {
    return tx(this.db, () => {
      const first = this.mine(viewerId, id);
      if (first.defender_id !== viewerId || (first.kind !== 'live' && first.invite_result === null)) throw new GameError('Duel not found', 404, { code: 'unknown_match' });
      this.tick(first);
      const r = this.row(id)!;
      if (r.status !== 'invite') {
        const why = r.status === 'cancelled' ? `${this.names(r).c} left the Arena.` : `Too late: ${this.names(r).c} is fighting your TaniBot now.`;
        throw new GameError(why, 409, { code: 'invite_over' });
      }
      const now = this.now();
      if (now - r.seen_at > ARENA_GONE_MS) {
        this.cancel(r, 'cancelled');
        throw new GameError(`${this.names(r).c} left the Arena.`, 409, { code: 'invite_over' });
      }
      const busy = this.openRows(viewerId).filter((x) => x.id !== id);
      if (busy.length) throw new GameError('Finish your duel first.', 409, { code: 'match_open', matchId: busy[0].id });
      const me = this.game.getPlayer(r.challenger_id);
      const them = this.game.getPlayer(viewerId);
      const deviceId = cleanDeviceId(device);
      recordDevice(this.db, viewerId, deviceId, now);
      // Two gardens of one person (sign-in, a shared browser) or from the same IP = practice.
      const self = r.practice === 'self' || this.arena.samePerson(them, me, deviceId) || (!!ip && ip === r.ip) || (!!deviceId && deviceId === r.device_id);
      this.db
        .prepare(
          "UPDATE arena_matches SET status = 'playing', invite_result = 'accepted', seen_d = ?, ip_d = ?, device_d = ?, practice = ?, turn_started_at = ?, invite_ends_at = NULL WHERE id = ?",
        )
        .run(now, ip, deviceId, self ? 'self' : null, now + ARENA_START_MS, id);
      return { match: this.view(this.row(id)!, viewerId) };
    });
  }

  /**
   * Ends an invite: the challenged player declines, or the challenger does not want to wait
   * ("Fight their TaniBot now"). The same match goes on against the challenged garden's TaniBot.
   */
  decline(viewerId: number, id: number): { match: MatchView } {
    return tx(this.db, () => {
      const r = this.mine(viewerId, id);
      this.tick(r);
      const again = this.row(id)!;
      if (again.status === 'invite') this.toBot(again, again.defender_id === viewerId ? 'declined' : 'skipped');
      return { match: this.view(this.row(id)!, viewerId) };
    });
  }

  /**
   * The player closes the duel screen. Invite (challenger): cancelled, not counted. Online duel: this
   * side counts as gone at once (the other side waits 20 s for them). A TaniBot duel keeps running.
   */
  leave(viewerId: number, id: number): { match: MatchView } {
    return tx(this.db, () => {
      const r = this.mine(viewerId, id);
      if (r.kind === 'live') {
        if (r.status === 'invite' && r.challenger_id === viewerId) this.cancel(r, 'cancelled');
        else if (r.status === 'playing' || r.status === 'paused') {
          this.db.prepare(`UPDATE arena_matches SET ${r.challenger_id === viewerId ? 'seen_at' : 'seen_d'} = 0 WHERE id = ?`).run(id);
          this.tick(this.row(id)!);
        }
      }
      return { match: this.view(this.row(id)!, viewerId) };
    });
  }

  /** A match for one of its two gardens (its clocks applied first: missed turns, invite, pause). */
  get(viewerId: number, id: number): { match: MatchView; titleUp: string | null } {
    const r = this.mine(viewerId, id);
    let titles = NO_TITLES;
    if (r.status === 'playing' || r.status === 'invite' || r.status === 'paused') {
      tx(this.db, () => {
        // This side's web is here (the online duel's "gone" check; v2: the challenger's last request).
        if (r.challenger_id === viewerId) this.db.prepare('UPDATE arena_matches SET seen_at = ? WHERE id = ?').run(this.now(), id);
        else if (r.kind === 'live') this.db.prepare('UPDATE arena_matches SET seen_d = ? WHERE id = ?').run(this.now(), id);
        titles = this.tick(this.row(id)!);
      });
    }
    const after = this.row(id)!;
    return { match: this.view(after, viewerId), titleUp: after.challenger_id === viewerId ? titles.c : titles.d };
  }

  private mine(viewerId: number, id: number): MatchRow {
    const r = Number.isInteger(id) ? this.row(id) : undefined;
    if (!r || (r.challenger_id !== viewerId && r.defender_id !== viewerId)) throw new GameError('Duel not found', 404, { code: 'unknown_match' });
    return r;
  }

  private names(r: MatchRow): { c: string; d: string } {
    const data = JSON.parse(r.data) as MatchData;
    return { c: data.c.name, d: data.d.name };
  }

  /**
   * The player's pick for turn `turn`. A retry of a decided turn returns the match as it is (same
   * result, never rolled again); a pick for a later turn is refused. Online duel: the pick is stored
   * and the turn is decided once both picks are in (or the 10 s ran out).
   */
  pick(viewerId: number, id: number, turn: unknown, pick: unknown): { match: MatchView; titleUp: string | null } {
    return tx(this.db, () => {
      const first = this.mine(viewerId, id);
      const side: Side = first.challenger_id === viewerId ? 'challenger' : 'defender';
      if (side === 'defender' && first.kind !== 'live') throw new GameError('Only the challenger plays this duel.', 403, { code: 'not_your_turn' });
      if (side === 'challenger') this.db.prepare('UPDATE arena_matches SET seen_at = ? WHERE id = ?').run(this.now(), id);
      else this.db.prepare('UPDATE arena_matches SET seen_d = ? WHERE id = ?').run(this.now(), id);
      // Turns whose 10 s (+ grace) ran out are decided first: a pick that came too late finds its
      // turn already lost and gets the match as it is now.
      const lost = this.tick(this.row(id)!);
      const mineTitle = (t: Titles) => (side === 'challenger' ? t.c : t.d);
      const r = this.row(id)!;
      if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0) throw new GameError('Missing turn', 400, { code: 'bad_turn' });
      if (turn < r.turn || r.status === 'done' || r.status === 'cancelled') return { match: this.view(r, viewerId), titleUp: mineTitle(lost) };
      if (r.status === 'invite') throw new GameError('The duel has not started yet.', 409, { code: 'turn_wrong' });
      if (r.status === 'paused') throw new GameError(`Waiting for ${r.paused_side === 'challenger' ? this.names(r).c : this.names(r).d}...`, 409, { code: 'paused' });
      if (turn > r.turn) throw new GameError('That turn has not started yet.', 409, { code: 'turn_wrong' });
      if (!isPick(pick)) throw new GameError('Pick Rock, Paper or Scissors.', 400, { code: 'bad_pick' });
      const skill = side === 'challenger' ? r.skill_c : r.skill_d;
      if (pick === 'gold' && skill < ARENA_SKILL_MAX) throw new GameError('Fill the skill bar first: win 3 turns.', 400, { code: 'no_skill' });

      const now = this.now();
      if (r.kind !== 'live') {
        const t = this.decide(r, pick, r.bot_pick ?? botPick(r.skill_d, this.rand), now, now);
        return { match: this.view(this.row(id)!, viewerId), titleUp: t.c ?? lost.c };
      }
      // Online: the first pick of a turn is kept (a retry cannot change it).
      const col = side === 'challenger' ? 'pick_c' : 'pick_d';
      if ((side === 'challenger' ? r.pick_c : r.pick_d) === null) this.db.prepare(`UPDATE arena_matches SET ${col} = ? WHERE id = ?`).run(pick, id);
      const after = this.row(id)!;
      let t = NO_TITLES;
      if (after.pick_c !== null && after.pick_d !== null) t = this.decide(after, after.pick_c, after.pick_d, now, now);
      return { match: this.view(this.row(id)!, viewerId), titleUp: mineTitle(merge(lost, t)) };
    });
  }

  /**
   * Decides the open turn with both picks ('timeout' = none in time), then opens the next turn (its
   * 10 s start once the webs have played this one). Returns new titles.
   */
  private decide(r: MatchRow, pc: TurnPick, pd: TurnPick, at: number, now: number): Titles {
    const data = JSON.parse(r.data) as MatchData;
    const { bars, log } = resolveTurn(r, r.turn, pc, pd, this.rand);
    data.turns.push(log);
    const end = matchEnd(bars, data.turns);
    const bot = r.kind === 'bot';
    this.db
      .prepare(
        `UPDATE arena_matches SET turn = ?, hp_c = ?, hp_d = ?, skill_c = ?, skill_d = ?, bot_pick = ?, pick_c = NULL, pick_d = NULL, data = ?, turn_started_at = ?${bot ? ', seen_at = ?' : ''} WHERE id = ?`,
      )
      .run(
        ...([r.turn + 1, bars.hp_c, bars.hp_d, bars.skill_c, bars.skill_d, end || !bot ? null : botPick(bars.skill_d, this.rand), JSON.stringify(data), at + playbackMs(log)] as (
          | number
          | string
          | null
        )[]),
        ...(bot ? [now, r.id] : [r.id]),
      );
    if (!end) return NO_TITLES;
    // TaniBot duel lost while away: the last 3 turns were all missed = "left" (no XP).
    const idle = data.turns.slice(-ARENA_IDLE_TURNS);
    const left = bot && end.winner === 'defender' && idle.length === ARENA_IDLE_TURNS && idle.every((t) => t.pick.c === 'timeout');
    return this.finish(this.row(r.id)!, end.winner, left ? 'left' : end.reason);
  }

  /** The time the open turn's picks must have arrived by (10 s + the grace for slow networks). */
  private deadline(r: MatchRow): number {
    return (r.turn_started_at ?? r.created_at) + ARENA_TURN_MS + ARENA_TURN_GRACE_MS;
  }

  /**
   * Decides every turn whose time ran out, one after another (each missed turn is lost; the next
   * turn's clock starts after the previous one, as if the web had played it). Returns new titles.
   */
  private advance(start: MatchRow): Titles {
    let r = start;
    let titles = NO_TITLES;
    const now = this.now();
    for (let guard = 0; r.status === 'playing' && now >= this.deadline(r) && guard < ARENA_SAFETY_TURNS; guard++) {
      const t =
        r.kind === 'live'
          ? this.decide(r, r.pick_c ?? 'timeout', r.pick_d ?? 'timeout', this.deadline(r), now)
          : this.decide(r, 'timeout', r.bot_pick ?? botPick(r.skill_d, this.rand), this.deadline(r), now);
      titles = merge(titles, t);
      r = this.row(r.id)!;
    }
    return titles;
  }

  /** The invite ended without a yes: the same match goes on against the challenged garden's TaniBot. */
  private toBot(r: MatchRow, why: InviteResult): void {
    this.db
      .prepare("UPDATE arena_matches SET kind = 'bot', status = 'playing', invite_result = ?, bot_pick = ?, invite_ends_at = NULL, turn_started_at = ?, seen_at = ? WHERE id = ?")
      .run(why, botPick(0, this.rand), this.now() + ARENA_START_MS, this.now(), r.id);
  }

  /** Cancelled: no winner, no prize, no XP, and it does not count toward the day's duels. */
  private cancel(r: MatchRow, why: InviteResult | null): void {
    this.db
      .prepare("UPDATE arena_matches SET status = 'cancelled', invite_result = COALESCE(?, invite_result), pick_c = NULL, pick_d = NULL, bot_pick = NULL, ended_at = ? WHERE id = ?")
      .run(why, this.now(), r.id);
  }

  /**
   * Applies a match's clocks: an invite that ran out, an online duel whose player is gone (pause,
   * back, or the 20 s ran out) and missed turns. Returns new titles.
   */
  private tick(r: MatchRow): Titles {
    const now = this.now();
    if (r.status === 'invite') {
      if (now < (r.invite_ends_at ?? 0)) return NO_TITLES;
      // Nobody answered. The challenger still there = fight the TaniBot; gone too = cancelled.
      if (now - r.seen_at > ARENA_GONE_MS) this.cancel(r, 'timeout');
      else this.toBot(r, 'timeout');
      return NO_TITLES;
    }
    if (r.kind === 'live' && r.status === 'paused') {
      const side = r.paused_side!;
      const since = (r.pause_ends_at ?? 0) - ARENA_PAUSE_MS;
      const seen = side === 'challenger' ? r.seen_at : r.seen_d;
      if (seen > since && now - seen <= ARENA_GONE_MS) {
        // Back in time: the duel goes on; the open turn starts its 10 s again.
        this.db.prepare("UPDATE arena_matches SET status = 'playing', paused_side = NULL, pause_ends_at = NULL, turn_started_at = ? WHERE id = ?").run(now + ARENA_START_MS, r.id);
        return NO_TITLES;
      }
      if (now < (r.pause_ends_at ?? 0)) return NO_TITLES;
      return this.endGone(r, side);
    }
    if (r.kind === 'live' && r.status === 'playing') {
      const goneC = now - r.seen_at > ARENA_GONE_MS;
      const goneD = now - r.seen_d > ARENA_GONE_MS;
      if (goneC && goneD) return this.endGone(r, null);
      if (goneC || goneD) {
        this.db.prepare("UPDATE arena_matches SET status = 'paused', paused_side = ?, pause_ends_at = ? WHERE id = ?").run(goneC ? 'challenger' : 'defender', now + ARENA_PAUSE_MS, r.id);
        return NO_TITLES;
      }
    }
    return r.status === 'playing' ? this.advance(r) : NO_TITLES;
  }

  /** A player of an online duel did not come back (`side`; null = both gone). */
  private endGone(r: MatchRow, side: Side | null): Titles {
    const now = this.now();
    // Gone before the first turn was decided = cancelled (no prize, not counted for anyone).
    if (r.turn === 0) {
      this.cancel(r, null);
      return NO_TITLES;
    }
    const stayer: Side | null = side === null ? null : side === 'challenger' ? 'defender' : 'challenger';
    const stayerSeen = stayer === 'challenger' ? r.seen_at : r.seen_d;
    if (stayer && now - stayerSeen <= 2 * ARENA_GONE_MS) return this.finish(r, stayer, 'left');
    // Both gone: no winner, nobody paid (it counts as one of the challenger's duels).
    this.db
      .prepare("UPDATE arena_matches SET status = 'done', winner = NULL, end_reason = 'abandoned', paused_side = NULL, pause_ends_at = NULL, pick_c = NULL, pick_d = NULL, ended_at = ? WHERE id = ?")
      .run(now, r.id);
    return NO_TITLES;
  }

  /** Applies the clocks of every open match (every 10 s from main.ts), so a closed page loses its turns too. */
  sweep(): number {
    const now = this.now();
    const due = this.db
      .prepare(
        `${MATCH_SELECT} WHERE (m.status = 'playing' AND (m.kind = 'live' OR COALESCE(m.turn_started_at, m.created_at) <= ?)) OR m.status IN ('invite', 'paused')`,
      )
      .all(now - ARENA_TURN_MS - ARENA_TURN_GRACE_MS) as unknown as MatchRow[];
    let n = 0;
    for (const r of due)
      tx(this.db, () => {
        const before = this.row(r.id)!;
        this.tick(before);
        const after = this.row(r.id)!;
        if (after.turn !== before.turn || after.status !== before.status) n++;
      });
    return n;
  }

  /**
   * Ends a match: XP and the prize. TaniBot duel (v2): as v1, only the challenger can win the prize.
   * Online duel: the winner, whichever side, within THEIR own limits; the loser 1 XP (none when they
   * left). A draw (`winner` null): each side gets what it gets for a loss (challenger 1 XP; the
   * defender 1 XP in an online duel, none in a TaniBot duel; none for practice), no prize, no
   * mint_reward; the duel still counts toward the challenger's 3 a day. Returns new titles.
   */
  private finish(r: MatchRow, winner: Side | null, reason: EndReason): Titles {
    const now = this.now();
    const me = this.game.getPlayer(r.challenger_id);
    const them = this.game.getPlayer(r.defender_id);
    const mult = (p: PlayerRow) => (p.demo === 1 ? DEMO_XP_MULTIPLIER : 1);
    let xpC = 0;
    let xpD = 0;
    let practice: 'self' | 'limit' | null = r.practice;
    let prizeMicro = 0;
    let jobId: number | null = null;
    if (winner === null) {
      const self = practice === 'self';
      xpC = self ? 0 : ARENA_XP_LOSS * mult(me);
      xpD = self || r.kind !== 'live' ? 0 : ARENA_XP_LOSS * mult(them);
    } else if (r.kind === 'live') {
      const [w, l] = winner === 'challenger' ? [me, them] : [them, me];
      const [wDevice, wIp] = winner === 'challenger' ? [r.device_id, r.ip] : [r.device_d, r.ip_d];
      practice = practice ?? (overPaidLimit(this.db, wDevice, wIp, now) ? 'limit' : null);
      const xpW = practice === 'self' ? 0 : winsToday(this.db, w.id, now) < ARENA_XP_WINS_PER_DAY ? ARENA_XP_WIN * mult(w) : 0;
      const xpL = practice === 'self' || reason === 'left' ? 0 : ARENA_XP_LOSS * mult(l);
      [xpC, xpD] = winner === 'challenger' ? [xpW, xpL] : [xpL, xpW];
      if (!practice) {
        const p = this.game.earnReward(w, 'arena', ARENA_PRIZE, `Arena prize vs ${l.name}`);
        jobId = p.jobId;
        prizeMicro = toMicro(p.expectedPanen);
      }
    } else {
      const challengerWon = winner === 'challenger';
      practice = practice ?? (challengerWon && overPaidLimit(this.db, r.device_id, r.ip, now) ? 'limit' : null);
      const { wins, defended } = xpToday(this.db, me.id, them.id, now);
      // Leaving costs the loss XP too; one person's gardens give none.
      xpC = practice === 'self' || reason === 'left' ? 0 : challengerWon ? (wins < ARENA_XP_WINS_PER_DAY ? ARENA_XP_WIN * mult(me) : 0) : ARENA_XP_LOSS * mult(me);
      xpD = practice === 'self' || challengerWon || defended >= ARENA_DEFEND_XP_PER_DAY ? 0 : ARENA_XP_DEFEND * mult(them);
      if (challengerWon && !practice) {
        const p = this.game.earnReward(me, 'arena', ARENA_PRIZE, `Arena prize vs ${them.name}`);
        jobId = p.jobId;
        prizeMicro = toMicro(p.expectedPanen);
      }
    }
    if (xpC) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(xpC, me.id);
    if (xpD) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(xpD, them.id);
    this.db
      .prepare(
        "UPDATE arena_matches SET status = 'done', winner = ?, end_reason = ?, practice = ?, prize_micro = ?, job_id = ?, xp_c = ?, xp_d = ?, bot_pick = NULL, pick_c = NULL, pick_d = NULL, paused_side = NULL, pause_ends_at = NULL, ended_at = ? WHERE id = ?",
      )
      .run(winner, reason, practice, prizeMicro, jobId, xpC, xpD, now, r.id);
    const up = (p: PlayerRow, xp: number) => (xp && titleFor(p.xp + xp) !== titleFor(p.xp) ? titleFor(p.xp + xp) : null);
    return { c: up(me, xpC), d: up(them, xpD) };
  }
}
