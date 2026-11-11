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
// - At most 15 turns; no K.O. by then = most life wins, then most hits landed, then the challenged
//   garden (as v1's tie rule).
// - Prize, XP, limits and anti-cheat are v1's (arena.ts): the match counts toward the day's 3 from
//   the moment it starts; no request from the player for 2 minutes = a loss without prize.
//
// Privacy: like v1, only names, avatars, titles, round scores and the trees' public data.

import { randomInt } from 'node:crypto';
import { fromMicro, toMicro, tx, type DB } from './db.ts';
import { GameError, type Game, type PlayerRow } from './game.ts';
import { cleanDeviceId, recordDevice } from './referral.ts';
import { arenaDay, dueledToday, duelsToday, overPaidLimit, xpToday, type Arena, type ArenaScores, type DuelSide } from './arena.ts';
import {
  ARENA_BONUS_MAX,
  ARENA_DEFEND_XP_PER_DAY,
  ARENA_DUELS_PER_DAY,
  ARENA_FRUIT_CHANCE,
  ARENA_FRUIT_DAMAGE,
  ARENA_GOLD_DURIAN,
  ARENA_HP,
  ARENA_LEAVE_MS,
  ARENA_MAX_TURNS,
  ARENA_PRIZE,
  ARENA_QUALITY_CHANCE,
  ARENA_QUALITY_DAMAGE,
  ARENA_RECENT,
  ARENA_SKILL_MAX,
  ARENA_XP_DEFEND,
  ARENA_XP_LOSS,
  ARENA_XP_WIN,
  ARENA_XP_WINS_PER_DAY,
  DEMO_XP_MULTIPLIER,
  type Quality,
  type Species,
  titleFor,
} from './rules.ts';

export type Rps = 'rock' | 'paper' | 'scissors';
export type Pick = Rps | 'gold';
export const RPS: readonly Rps[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<Rps, Rps> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
export const isPick = (v: unknown): v is Pick => v === 'gold' || RPS.includes(v as Rps);

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
  pick: { c: Pick; d: Pick };
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

/** Decides one turn. `pc` / `pd` must be valid (the Gold Durian only with a full bar). */
export function resolveTurn(b: Bars, turn: number, pc: Pick, pd: Pick, rand: Rand): { bars: Bars; log: TurnLog } {
  const next = { ...b };
  const hits: TurnHit[] = [];
  let winner: TurnLog['winner'];
  const cg = pc === 'gold';
  const dg = pd === 'gold';
  if (cg || dg) {
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

/** Is the match over after `turns` decided turns? K.O. first; after the last turn: most life, then most hits landed, then the challenged garden. */
export function matchEnd(b: Bars, turns: TurnLog[]): { winner: 'challenger' | 'defender'; reason: 'ko' | 'turns' } | null {
  const ko = b.hp_c <= 0 || b.hp_d <= 0;
  if (!ko && turns.length < ARENA_MAX_TURNS) return null;
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

interface MatchRow extends Bars {
  id: number;
  kind: string;
  status: 'playing' | 'done';
  challenger_id: number;
  defender_id: number;
  duel_day: number;
  turn: number;
  bot_pick: Pick | null;
  winner: 'challenger' | 'defender' | null;
  end_reason: 'ko' | 'turns' | 'left' | null;
  practice: 'self' | 'limit' | null;
  prize_micro: number;
  job_id: number | null;
  xp_c: number;
  xp_d: number;
  data: string;
  ip: string | null;
  device_id: string | null;
  seen_at: number;
  created_at: number;
  ended_at: number | null;
  job_status?: string | null;
  tx_hash?: string | null;
}

const MATCH_SELECT = 'SELECT m.*, j.status AS job_status, j.tx_hash FROM arena_matches m LEFT JOIN chain_jobs j ON j.id = m.job_id';

/**
 * A match as a player sees it. NEVER holds `bot_pick`: the open turn's computer pick stays on the
 * server until the player's pick for that turn arrived (then it is part of the decided turn).
 */
export function matchView(r: MatchRow, viewerId: number, explorerTxUrl: string) {
  const data = JSON.parse(r.data) as MatchData;
  const you = r.challenger_id === viewerId ? ('challenger' as const) : ('defender' as const);
  return {
    id: r.id,
    v: 2 as const,
    kind: 'bot' as const,
    at: r.created_at,
    endedAt: r.ended_at,
    you,
    challenger: data.c,
    defender: data.d,
    status: r.status,
    /** Turns decided so far; the next pick is for turn `turn`. */
    turn: r.turn,
    maxTurns: ARENA_MAX_TURNS,
    hp: { c: r.hp_c, d: r.hp_d },
    maxHp: ARENA_HP,
    skill: { c: r.skill_c, d: r.skill_d },
    skillMax: ARENA_SKILL_MAX,
    bonus: { c: r.bonus_c, d: r.bonus_d },
    turns: data.turns,
    winner: r.winner,
    /** 'ko' | 'turns' | 'left' (the player left for 2 minutes). */
    endReason: r.end_reason,
    practice: r.practice,
    /** PANEN the challenger received (after the Season rule); 0 = none. */
    prize: fromMicro(r.prize_micro),
    prizeStatus: r.job_status ?? null,
    txUrl: r.tx_hash && !r.tx_hash.startsWith('fake') ? explorerTxUrl + r.tx_hash : null,
    gainedXp: you === 'challenger' ? r.xp_c : r.xp_d,
  };
}

export type MatchView = ReturnType<typeof matchView>;

/** A finished match in lists (state, Arena window): no turn log, so the 8 s state poll stays small. */
export function matchSummary(r: MatchRow, viewerId: number, explorerTxUrl: string) {
  const { turns, ...rest } = matchView(r, viewerId, explorerTxUrl);
  return { ...rest, turns: undefined, turnCount: turns.length };
}

export type MatchSummary = ReturnType<typeof matchSummary>;

/** The v2 part of `state.arena`: `v: 2` (the web plays turn-based duels), the open match to resume, matches this garden received. */
export function arenaMatchState(db: DB, playerId: number, explorerTxUrl: string) {
  const open = db
    .prepare("SELECT m.id, p.name FROM arena_matches m JOIN players p ON p.id = m.defender_id WHERE m.challenger_id = ? AND m.status = 'playing' ORDER BY m.id DESC LIMIT 1")
    .get(playerId) as { id: number; name: string } | undefined;
  const received = (db.prepare(`${MATCH_SELECT} WHERE m.defender_id = ? AND m.status = 'done' ORDER BY m.ended_at DESC LIMIT ?`).all(playerId, ARENA_RECENT) as unknown as MatchRow[]).map(
    (r) => matchSummary(r, playerId, explorerTxUrl),
  );
  return { v: 2 as const, active: open ? { id: open.id, opponent: open.name } : null, receivedMatches: received };
}

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
    return matchView(r, viewerId, this.explorerTxUrl);
  }

  /** Finished matches of this garden, both roles (Arena window "Recent duels"). */
  recent(viewerId: number): MatchSummary[] {
    return (
      this.db
        .prepare(`${MATCH_SELECT} WHERE (m.challenger_id = ? OR m.defender_id = ?) AND m.status = 'done' ORDER BY m.ended_at DESC LIMIT ?`)
        .all(viewerId, viewerId, ARENA_RECENT) as unknown as MatchRow[]
    ).map((r) => matchSummary(r, viewerId, this.explorerTxUrl));
  }

  /** The open match of this garden, if any (after closing one whose player left). */
  private openOf(playerId: number): MatchRow | undefined {
    const r = this.db.prepare(`${MATCH_SELECT} WHERE m.challenger_id = ? AND m.status = 'playing' ORDER BY m.id DESC LIMIT 1`).get(playerId) as unknown as MatchRow | undefined;
    return r && this.expire(r) ? undefined : r;
  }

  /** Starts a match against the garden `name`'s TaniBot (the v1 checks and limits; counts toward the day's 3 at once). */
  start(viewerId: number, name: unknown, ip: string | null, device: unknown): { match: MatchView } {
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
      const data: MatchData = { c, d, turns: [] };
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO arena_matches (kind, status, challenger_id, defender_id, duel_day, turn, hp_c, hp_d, skill_c, skill_d, bonus_c, bonus_d, bot_pick, practice, data, ip, device_id, seen_at, created_at)
             VALUES ('bot', 'playing', ?, ?, ?, 0, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(me.id, them.id, arenaDay(now), ARENA_HP, ARENA_HP, gardenBonus(c.scores), gardenBonus(d.scores), botPick(0, this.rand), practice, JSON.stringify(data), ip, deviceId, now, now)
          .lastInsertRowid,
      );
      return { match: this.view(this.row(id)!, me.id) };
    });
  }

  /** A match for one of its two gardens (the challenger's request also keeps it alive: the 2-minute rule). */
  get(viewerId: number, id: number): { match: MatchView } {
    const r = this.mine(viewerId, id);
    if (r.status === 'playing' && r.challenger_id === viewerId) {
      if (this.expire(r)) return { match: this.view(this.row(id)!, viewerId) };
      this.db.prepare('UPDATE arena_matches SET seen_at = ? WHERE id = ?').run(this.now(), id);
    }
    return { match: this.view(this.row(id)!, viewerId) };
  }

  private mine(viewerId: number, id: number): MatchRow {
    const r = Number.isInteger(id) ? this.row(id) : undefined;
    if (!r || (r.challenger_id !== viewerId && r.defender_id !== viewerId)) throw new GameError('Duel not found', 404, { code: 'unknown_match' });
    return r;
  }

  /**
   * The player's pick for turn `turn`. A retry of a decided turn returns the match as it is (same
   * result, never rolled again); a pick for a later turn is refused.
   */
  pick(viewerId: number, id: number, turn: unknown, pick: unknown): { match: MatchView; titleUp: string | null } {
    return tx(this.db, () => {
      const r = this.mine(viewerId, id);
      if (r.challenger_id !== viewerId) throw new GameError('Only the challenger plays this duel.', 403, { code: 'not_your_turn' });
      if (r.status === 'playing' && this.expire(r)) return { match: this.view(this.row(id)!, viewerId), titleUp: null };
      if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0) throw new GameError('Missing turn', 400, { code: 'bad_turn' });
      if (turn < r.turn || r.status === 'done') return { match: this.view(r, viewerId), titleUp: null };
      if (turn > r.turn) throw new GameError('That turn has not started yet.', 409, { code: 'turn_wrong' });
      if (!isPick(pick)) throw new GameError('Pick Rock, Paper or Scissors.', 400, { code: 'bad_pick' });
      if (pick === 'gold' && r.skill_c < ARENA_SKILL_MAX) throw new GameError('Fill the skill bar first: win 3 turns.', 400, { code: 'no_skill' });

      const now = this.now();
      const data = JSON.parse(r.data) as MatchData;
      const bot = r.bot_pick ?? botPick(r.skill_d, this.rand);
      const { bars, log } = resolveTurn(r, r.turn, pick, bot, this.rand);
      data.turns.push(log);
      const end = matchEnd(bars, data.turns);
      this.db
        .prepare('UPDATE arena_matches SET turn = ?, hp_c = ?, hp_d = ?, skill_c = ?, skill_d = ?, bot_pick = ?, data = ?, seen_at = ? WHERE id = ?')
        .run(r.turn + 1, bars.hp_c, bars.hp_d, bars.skill_c, bars.skill_d, end ? null : botPick(bars.skill_d, this.rand), JSON.stringify(data), now, id);
      let titleUp: string | null = null;
      if (end) titleUp = this.finish(this.row(id)!, end.winner, end.reason);
      return { match: this.view(this.row(id)!, viewerId), titleUp };
    });
  }

  /** Closes a match whose player made no request for 2 minutes: a loss without prize. True if closed. */
  private expire(r: MatchRow): boolean {
    if (r.status !== 'playing' || this.now() - r.seen_at < ARENA_LEAVE_MS) return false;
    this.finish(r, 'defender', 'left');
    return true;
  }

  /** Closes every match whose player left (every 10 s from main.ts). */
  sweep(): number {
    const stale = this.db
      .prepare(`${MATCH_SELECT} WHERE m.status = 'playing' AND m.seen_at < ?`)
      .all(this.now() - ARENA_LEAVE_MS) as unknown as MatchRow[];
    let n = 0;
    for (const r of stale) tx(this.db, () => (this.expire(this.row(r.id)!) ? n++ : 0));
    return n;
  }

  /** Ends a match: XP and the prize as in v1 (arena.ts). Returns the challenger's new title, if any. */
  private finish(r: MatchRow, winner: 'challenger' | 'defender', reason: 'ko' | 'turns' | 'left'): string | null {
    const now = this.now();
    const me = this.game.getPlayer(r.challenger_id);
    const them = this.game.getPlayer(r.defender_id);
    const challengerWon = winner === 'challenger';
    const practice: 'self' | 'limit' | null = r.practice ?? (challengerWon && overPaidLimit(this.db, r.device_id, r.ip, now) ? 'limit' : null);
    const mult = (p: PlayerRow) => (p.demo === 1 ? DEMO_XP_MULTIPLIER : 1);
    const { wins, defended } = xpToday(this.db, me.id, them.id, now);
    // Leaving costs the loss XP too; one person's gardens give none.
    const xpC =
      practice === 'self' || reason === 'left' ? 0 : challengerWon ? (wins < ARENA_XP_WINS_PER_DAY ? ARENA_XP_WIN * mult(me) : 0) : ARENA_XP_LOSS * mult(me);
    const xpD = practice === 'self' || challengerWon || defended >= ARENA_DEFEND_XP_PER_DAY ? 0 : ARENA_XP_DEFEND * mult(them);
    if (xpC) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(xpC, me.id);
    if (xpD) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(xpD, them.id);
    let prizeMicro = 0;
    let jobId: number | null = null;
    if (challengerWon && !practice) {
      const p = this.game.earnReward(me, 'arena', ARENA_PRIZE, `Arena prize vs ${them.name}`);
      jobId = p.jobId;
      prizeMicro = toMicro(p.expectedPanen);
    }
    this.db
      .prepare(
        "UPDATE arena_matches SET status = 'done', winner = ?, end_reason = ?, practice = ?, prize_micro = ?, job_id = ?, xp_c = ?, xp_d = ?, bot_pick = NULL, ended_at = ? WHERE id = ?",
      )
      .run(winner, reason, practice, prizeMicro, jobId, xpC, xpD, now, r.id);
    const before = titleFor(me.xp);
    const after = titleFor(me.xp + xpC);
    return after !== before ? after : null;
  }
}
