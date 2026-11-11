// Arena 1 VS 1 (docs/PLAN-arena.md, Ardian 2026-11-11): not real-time. A player challenges another
// garden; the server compares the two gardens' living trees (the Tree NFTs, public data) in three
// rounds and stores the result. No wagering: a challenger's win pays a small prize FROM THE GAME
// (mint_reward, the Season rule applies); a loss costs nothing.
//
// Each round: a small garden score 0-3 + one die (1-6) per side; the higher total wins the round,
// a tie is rolled again (at most ARENA_TIE_REROLLS times, then the challenged garden wins it).
//   1. Fruit quality: the best living tree's quality (Common 1, Rare 2, Gold 3).
//   2. Care: share of living trees that are not thirsty, not wilting and free of ash (floor of 3 x share).
//   3. Ripeness: the most grown tree (seed / sprout 1, tree / old 2, fruiting 3).
// Species and title never add points, so a new player who waters a Mango until it fruits beats the
// strongest garden about 1 time in 3 (odds in the plan, test in server/test/arena.test.ts).
//
// Anti-cheat: the web sends only the opponent's name; scores, dice, winner and prize are decided
// and stored here before the answer. Own garden refused; a second garden of the same person (a
// browser both used, or the same Google / wallet identity) = practice duel (no prize, no XP);
// paid wins per day at most 3 per browser and 10 per IP (more = practice 'limit', XP still counts).
// XP: a challenger's win 15 (x demo), at most 3 wins with XP per day; a loss 1; a defender's win 3.
//
// Privacy: a duel holds only names, avatars, titles, round scores, dice and the trees' species /
// quality / stage (the same public data as a garden visit).

import { randomInt } from 'node:crypto';
import { dayIndex } from './clock.ts';
import { fromMicro, toMicro, tx, type DB } from './db.ts';
import { GameError, type Game, type PlayerRow } from './game.ts';
import { cleanDeviceId, recordDevice } from './referral.ts';
import {
  ARENA_DEFEND_XP_PER_DAY,
  ARENA_DUELS_PER_DAY,
  ARENA_PAID_PER_DEVICE_PER_DAY,
  ARENA_PAID_PER_IP_PER_DAY,
  ARENA_PRIZE,
  ARENA_RECENT,
  ARENA_TIE_REROLLS,
  ARENA_XP_DEFEND,
  ARENA_XP_LOSS,
  ARENA_XP_WIN,
  ARENA_XP_WINS_PER_DAY,
  DEMO_XP_MULTIPLIER,
  type Quality,
  type Species,
  type Stage,
  titleFor,
} from './rules.ts';

export const ARENA_ROUNDS = ['quality', 'care', 'ripeness'] as const;
export type ArenaRound = (typeof ARENA_ROUNDS)[number];
export type ArenaScores = Record<ArenaRound, number>;

/** What a duel needs of one living tree (from the public garden view). */
export interface ArenaTree {
  species: Species;
  quality: Quality;
  stage: Stage;
  thirsty: boolean;
  wilting: boolean;
  ash: boolean;
}

const QUALITY_POINTS: Record<Quality, number> = { common: 1, rare: 2, gold: 3 };
const STAGE_POINTS: Record<Stage, number> = { seed: 1, sprout: 1, tree: 2, old: 2, fruiting: 3 };

/** A garden's three round scores (0-3 each) and the trees that stand for it in rounds 1 and 3. */
export function arenaScores(trees: ArenaTree[]): {
  scores: ArenaScores;
  best: { species: Species; quality: Quality } | null;
  ripest: { species: Species; quality: Quality; stage: Stage } | null;
} {
  if (!trees.length) return { scores: { quality: 0, care: 0, ripeness: 0 }, best: null, ripest: null };
  const best = trees.reduce((a, b) => (QUALITY_POINTS[b.quality] > QUALITY_POINTS[a.quality] ? b : a));
  const ripest = trees.reduce((a, b) => (STAGE_POINTS[b.stage] > STAGE_POINTS[a.stage] ? b : a));
  const cared = trees.filter((t) => !t.thirsty && !t.wilting && !t.ash).length;
  return {
    scores: { quality: QUALITY_POINTS[best.quality], care: Math.floor((3 * cared) / trees.length), ripeness: STAGE_POINTS[ripest.stage] },
    best: { species: best.species, quality: best.quality },
    ripest: { species: ripest.species, quality: ripest.quality, stage: ripest.stage },
  };
}

export interface RoundResult {
  round: ArenaRound;
  /** Challenger: score and every die rolled (more than one after ties). */
  c: { score: number; dice: number[] };
  d: { score: number; dice: number[] };
  winner: 'challenger' | 'defender';
}

/** Plays the three rounds with `die` (1-6). Best of three; all three rounds are always played (the animation shows them). */
export function playDuel(c: ArenaScores, d: ArenaScores, die: () => number): { rounds: RoundResult[]; winner: 'challenger' | 'defender'; score: { challenger: number; defender: number } } {
  const rounds = ARENA_ROUNDS.map((round): RoundResult => {
    const cd: number[] = [];
    const dd: number[] = [];
    let winner: RoundResult['winner'] = 'defender';
    for (let i = 0; i <= ARENA_TIE_REROLLS; i++) {
      const a = die();
      const b = die();
      cd.push(a);
      dd.push(b);
      if (c[round] + a !== d[round] + b) {
        winner = c[round] + a > d[round] + b ? 'challenger' : 'defender';
        break;
      }
    }
    return { round, c: { score: c[round], dice: cd }, d: { score: d[round], dice: dd }, winner };
  });
  const won = rounds.filter((r) => r.winner === 'challenger').length;
  return { rounds, winner: won >= 2 ? 'challenger' : 'defender', score: { challenger: won, defender: 3 - won } };
}

/** One side of a duel as stored and shown (public data only). */
export interface DuelSide {
  name: string;
  avatar: string;
  title: string;
  scores: ArenaScores;
  best: { species: Species; quality: Quality } | null;
  ripest: { species: Species; quality: Quality; stage: Stage } | null;
  trees: number;
}

interface DuelData {
  c: DuelSide;
  d: DuelSide;
  rounds: RoundResult[];
}

interface DuelRow {
  id: number;
  challenger_id: number;
  defender_id: number;
  winner: 'challenger' | 'defender';
  practice: 'self' | 'limit' | null;
  prize_micro: number;
  job_id: number | null;
  xp_c: number;
  xp_d: number;
  data: string;
  created_at: number;
  job_status?: string | null;
  tx_hash?: string | null;
}

/** A stored duel as the viewer sees it (their own XP only). */
export function duelView(r: DuelRow, viewerId: number, explorerTxUrl: string) {
  const data = JSON.parse(r.data) as DuelData;
  const you = r.challenger_id === viewerId ? ('challenger' as const) : ('defender' as const);
  const won = data.rounds.filter((x) => x.winner === 'challenger').length;
  return {
    id: r.id,
    at: r.created_at,
    you,
    challenger: data.c,
    defender: data.d,
    rounds: data.rounds,
    winner: r.winner,
    score: { challenger: won, defender: data.rounds.length - won },
    /** null = a real duel; 'self' = same person's gardens; 'limit' = the day's paid wins from this browser / IP are used up. */
    practice: r.practice,
    /** PANEN the challenger received (after the Season rule); 0 = none. */
    prize: fromMicro(r.prize_micro),
    prizeStatus: r.job_status ?? null,
    txUrl: r.tx_hash && !r.tx_hash.startsWith('fake') ? explorerTxUrl + r.tx_hash : null,
    gainedXp: you === 'challenger' ? r.xp_c : r.xp_d,
  };
}

export type DuelView = ReturnType<typeof duelView>;

const DUEL_SELECT = `SELECT a.*, j.status AS job_status, j.tx_hash FROM arena_duels a LEFT JOIN chain_jobs j ON j.id = a.job_id`;

/** The village day for Arena limits: the normal 07:00 WIB day, also for demo gardens. */
export const arenaDay = (now: number) => dayIndex(now, false);

/**
 * Every Arena fight for the limits: v1 duels and v2 matches (arena-match.ts) count together
 * (3 a day, 1 per opponent, paid wins, XP caps). A v2 match counts from the moment it starts.
 */
// Online duels (kind 'live'): a cancelled one (left before the first turn) does not count; when the
// challenged player wins, the paid-win limits count THEIR browser / IP (ip_d / device_d).
const ALL_FIGHTS = `(SELECT 'duel' AS kind, challenger_id, defender_id, duel_day, winner, prize_micro, xp_c, xp_d, ip, device_id FROM arena_duels
  UNION ALL SELECT kind, challenger_id, defender_id, duel_day, winner, prize_micro, xp_c, xp_d,
    CASE WHEN kind = 'live' AND winner = 'defender' THEN ip_d ELSE ip END,
    CASE WHEN kind = 'live' AND winner = 'defender' THEN device_d ELSE device_id END
  FROM arena_matches WHERE status != 'cancelled')`;

const countFights = (db: DB, where: string, ...args: (string | number)[]) =>
  (db.prepare(`SELECT count(*) AS n FROM ${ALL_FIGHTS} WHERE ${where}`).get(...args) as { n: number }).n;

/** Duels and matches this garden started today. */
export function duelsToday(db: DB, playerId: number, now: number): number {
  return countFights(db, 'challenger_id = ? AND duel_day = ?', playerId, arenaDay(now));
}

/** Gardens this garden already challenged today (1 challenge per opponent per day). */
export function dueledToday(db: DB, playerId: number, now: number): Set<number> {
  return new Set(
    (db.prepare(`SELECT defender_id AS id FROM ${ALL_FIGHTS} WHERE challenger_id = ? AND duel_day = ?`).all(playerId, arenaDay(now)) as { id: number }[]).map((r) => r.id),
  );
}

/** Paid wins today from this browser / IP reached the limit. */
export function overPaidLimit(db: DB, deviceId: string | null, ip: string | null, now: number): boolean {
  const day = arenaDay(now);
  return (
    (!!deviceId && countFights(db, 'device_id = ? AND duel_day = ? AND prize_micro > 0', deviceId, day) >= ARENA_PAID_PER_DEVICE_PER_DAY) ||
    (!!ip && countFights(db, 'ip = ? AND duel_day = ? AND prize_micro > 0', ip, day) >= ARENA_PAID_PER_IP_PER_DAY)
  );
}

/** Wins with XP today of this garden: as a challenger, and as the challenged player of an online duel. */
export function winsToday(db: DB, playerId: number, now: number): number {
  return countFights(
    db,
    "duel_day = ? AND ((challenger_id = ? AND winner = 'challenger' AND xp_c > 0) OR (defender_id = ? AND kind = 'live' AND winner = 'defender' AND xp_d > 0))",
    arenaDay(now),
    playerId,
    playerId,
  );
}

/** Today's XP so far: wins with XP of the challenger, defences with XP of the defender. */
export function xpToday(db: DB, challengerId: number, defenderId: number, now: number): { wins: number; defended: number } {
  const day = arenaDay(now);
  return {
    wins: winsToday(db, challengerId, now),
    defended: countFights(db, "defender_id = ? AND duel_day = ? AND xp_d > 0 AND kind != 'live'", defenderId, day),
  };
}

/** The Arena part of the game state: duels left today, the prize now and duels this garden received. */
export function arenaState(db: DB, playerId: number, now: number, prizeNow: number, explorerTxUrl: string) {
  const left = Math.max(0, ARENA_DUELS_PER_DAY - duelsToday(db, playerId, now));
  const received = (db.prepare(`${DUEL_SELECT} WHERE a.defender_id = ? ORDER BY a.id DESC LIMIT ?`).all(playerId, ARENA_RECENT) as unknown as DuelRow[]).map((r) =>
    duelView(r, playerId, explorerTxUrl),
  );
  return { left, max: ARENA_DUELS_PER_DAY, prize: ARENA_PRIZE, prizeNow, received };
}

/** The newest duel or finished match this garden received (Village red dot). */
export function arenaNewsAt(db: DB, playerId: number): number {
  const duel = (db.prepare('SELECT max(created_at) AS at FROM arena_duels WHERE defender_id = ?').get(playerId) as { at: number | null }).at ?? 0;
  const match = (db.prepare("SELECT max(ended_at) AS at FROM arena_matches WHERE defender_id = ? AND status = 'done' AND kind != 'live'").get(playerId) as { at: number | null }).at ?? 0;
  return Math.max(duel, match);
}

export class Arena {
  private db: DB;
  private game: Game;
  private now: () => number;
  private die: () => number;
  private explorerTxUrl: string;

  constructor(db: DB, game: Game, now: () => number, opts: { die?: () => number; explorerTxUrl?: string } = {}) {
    this.db = db;
    this.game = game;
    this.now = now;
    this.die = opts.die ?? (() => randomInt(1, 7));
    this.explorerTxUrl = opts.explorerTxUrl ?? 'https://testnet.nearblocks.io/txns/';
  }

  /** A garden's side of a duel, read from its living trees right now. */
  side(p: PlayerRow): DuelSide {
    const trees = this.game
      .publicGarden(p)
      .plots.flatMap((pl) => (pl.tree ? [pl.tree] : []))
      .map((t): ArenaTree => ({ species: t.species as Species, quality: t.quality as Quality, stage: t.stage, thirsty: t.thirsty, wilting: t.wilting, ash: t.ash }));
    const s = arenaScores(trees);
    return { name: p.name, avatar: p.avatar, title: titleFor(p.xp), scores: s.scores, best: s.best, ripest: s.ripest, trees: trees.length };
  }

  private recent(viewerId: number): DuelView[] {
    return (
      this.db.prepare(`${DUEL_SELECT} WHERE a.challenger_id = ? OR a.defender_id = ? ORDER BY a.id DESC LIMIT ?`).all(viewerId, viewerId, ARENA_RECENT) as unknown as DuelRow[]
    ).map((r) => duelView(r, viewerId, this.explorerTxUrl));
  }

  /** Gardens the viewer already challenged today (1 challenge per opponent per day; v1 duels and v2 matches). */
  private dueledToday(viewerId: number): Set<number> {
    return dueledToday(this.db, viewerId, this.now());
  }

  /** The Arena window: duels left, prize, opponents (the Farmers of Tandur rows with a tree) and recent duels. */
  view(viewerId: number, farmers: { name: string; avatar: string; title: string; trees: number; judge: boolean; friend?: boolean; online?: boolean }[]) {
    const me = this.game.getPlayer(viewerId);
    const mine = this.side(me);
    const left = Math.max(0, ARENA_DUELS_PER_DAY - duelsToday(this.db, viewerId, this.now()));
    const dueled = this.dueledToday(viewerId);
    const ids = new Map(
      (farmers.length
        ? (this.db.prepare(`SELECT id, name FROM players WHERE name IN (${farmers.map(() => '?').join(',')})`).all(...farmers.map((f) => f.name)) as { id: number; name: string }[])
        : []
      ).map((r) => [r.name, r.id]),
    );
    return {
      left,
      max: ARENA_DUELS_PER_DAY,
      prize: ARENA_PRIZE,
      prizeNow: this.game.afterSeason(ARENA_PRIZE),
      /** null = you can duel; 'no_tree' = plant a tree first; 'limit' = no duels left today. */
      blocked: mine.trees === 0 ? ('no_tree' as const) : left === 0 ? ('limit' as const) : null,
      you: mine,
      opponents: farmers
        .filter((f) => f.trees > 0)
        .map((f) => ({
          name: f.name,
          avatar: f.avatar,
          title: f.title,
          trees: f.trees,
          judge: f.judge,
          dueledToday: dueled.has(ids.get(f.name) ?? -1),
          // Add friend + Online (2026-11-11; older webs ignore them).
          friend: !!f.friend,
          online: !!f.online,
        })),
      recent: this.recent(viewerId),
    };
  }

  /** Can the viewer challenge this garden today? (for the visit panel's Duel button) */
  canChallenge(viewerId: number, name: string): { ok: boolean; reason: 'own_garden' | 'no_tree' | 'no_tree_them' | 'limit' | 'pair_today' | null; left: number } {
    const me = this.game.getPlayer(viewerId);
    const them = this.game.getPlayerByName(String(name).toLowerCase());
    const left = Math.max(0, ARENA_DUELS_PER_DAY - duelsToday(this.db, viewerId, this.now()));
    const reason =
      !them || them.id === me.id
        ? ('own_garden' as const)
        : this.side(me).trees === 0
          ? ('no_tree' as const)
          : this.side(them).trees === 0
            ? ('no_tree_them' as const)
            : left === 0
              ? ('limit' as const)
              : this.dueledToday(viewerId).has(them.id)
                ? ('pair_today' as const)
                : null;
    return { ok: reason === null, reason, left };
  }

  /** The two gardens belong to one person: a browser both used, or the same Google / wallet identity. */
  samePerson(a: PlayerRow, b: PlayerRow, deviceId: string | null): boolean {
    const ids = (p: PlayerRow) => {
      const u = this.db.prepare('SELECT provider, subject FROM users WHERE id = ?').get(p.user_id) as { provider: string; subject: string };
      const out = new Set([`${u.provider}:${u.subject}`]);
      if (p.google_sub) out.add(`google:${p.google_sub}`);
      if (p.wallet_account_id) out.add(`near:${p.wallet_account_id}`);
      return out;
    };
    const ib = ids(b);
    if ([...ids(a)].some((x) => ib.has(x))) return true;
    if (deviceId && this.db.prepare('SELECT 1 FROM devices WHERE player_id = ? AND device_id = ?').get(b.id, deviceId)) return true;
    return !!this.db.prepare('SELECT 1 FROM devices x JOIN devices y ON y.device_id = x.device_id WHERE x.player_id = ? AND y.player_id = ?').get(a.id, b.id);
  }

  /** Paid wins today from this browser / IP reached the limit. */
  private overPaidLimit(deviceId: string | null, ip: string | null): boolean {
    return overPaidLimit(this.db, deviceId, ip, this.now());
  }

  /**
   * Plays a duel: the viewer challenges the garden `name`. Everything is decided and stored here
   * (in one transaction) before the answer, so a refresh cannot roll again.
   */
  duel(viewerId: number, name: unknown, ip: string | null, device: unknown) {
    return tx(this.db, () => {
      const now = this.now();
      const day = arenaDay(now);
      const me = this.game.getPlayer(viewerId);
      const them = typeof name === 'string' ? this.game.getPlayerByName(name.trim().toLowerCase()) : undefined;
      if (!them || them.account_status !== 'ready') throw new GameError('Garden not found', 404, { code: 'unknown_garden' });
      if (them.id === me.id) throw new GameError('You cannot challenge your own garden.', 400, { code: 'own_garden' });
      const c = this.side(me);
      const d = this.side(them);
      if (c.trees === 0) throw new GameError('Plant a tree first: your trees fight for you in the Arena.', 409, { code: 'no_tree_you' });
      if (d.trees === 0) throw new GameError(`${them.name} has no tree to duel with right now.`, 409, { code: 'no_trees' });
      if (duelsToday(this.db, me.id, now) >= ARENA_DUELS_PER_DAY)
        throw new GameError(`You used your ${ARENA_DUELS_PER_DAY} duels today. Come back tomorrow!`, 429, { code: 'arena_limit' });
      if (this.dueledToday(me.id).has(them.id)) throw new GameError(`You already challenged ${them.name} today. Pick another farmer!`, 429, { code: 'arena_pair_today' });

      const deviceId = cleanDeviceId(device);
      recordDevice(this.db, me.id, deviceId, now);
      const self = this.samePerson(me, them, deviceId);
      const result = playDuel(c.scores, d.scores, this.die);
      const challengerWon = result.winner === 'challenger';
      const practice: 'self' | 'limit' | null = self ? 'self' : challengerWon && this.overPaidLimit(deviceId, ip) ? 'limit' : null;

      // XP (normal path: the demo multiplier applies). A practice duel of one person's gardens gives none.
      const mult = (p: PlayerRow) => (p.demo === 1 ? DEMO_XP_MULTIPLIER : 1);
      const { wins: winXpToday, defended: defendedToday } = xpToday(this.db, me.id, them.id, now);
      const xpC =
        practice === 'self' ? 0 : challengerWon ? (winXpToday < ARENA_XP_WINS_PER_DAY ? ARENA_XP_WIN * mult(me) : 0) : ARENA_XP_LOSS * mult(me);
      const xpD = practice === 'self' || challengerWon || defendedToday >= ARENA_DEFEND_XP_PER_DAY ? 0 : ARENA_XP_DEFEND * mult(them);
      if (xpC) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(xpC, me.id);
      if (xpD) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(xpD, them.id);

      // The prize comes from the game (mint_reward: the contract applies the Season rule).
      let prizeMicro = 0;
      let jobId: number | null = null;
      if (challengerWon && !practice) {
        const r = this.game.earnReward(me, 'arena', ARENA_PRIZE, `Arena prize vs ${them.name}`);
        jobId = r.jobId;
        prizeMicro = toMicro(r.expectedPanen);
      }

      const data: DuelData = { c, d, rounds: result.rounds };
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO arena_duels (challenger_id, defender_id, duel_day, winner, practice, prize_micro, job_id, xp_c, xp_d, data, ip, device_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(me.id, them.id, day, result.winner, practice, prizeMicro, jobId, xpC, xpD, JSON.stringify(data), ip, deviceId, now).lastInsertRowid,
      );
      const row = this.db.prepare(`${DUEL_SELECT} WHERE a.id = ?`).get(id) as unknown as DuelRow;
      const titleBefore = titleFor(me.xp);
      const titleAfter = titleFor(me.xp + xpC);
      return { duel: duelView(row, me.id, this.explorerTxUrl), titleUp: titleAfter !== titleBefore ? titleAfter : null };
    });
  }
}
