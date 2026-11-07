// Try as Judge: one click, no Google and no wallet. Each judge gets a NEW garden of their own
// (a real testnet account `judge-xxxx.<suffix>` with real Tree NFTs and a TaniBot), filled so
// every feature can be tried at once. The same device always returns to its garden.
//
// Cost: about 0.04 testnet NEAR per garden (account, TaniBot account, 3 NFTs, token storage, gas),
// so new judge gardens are limited per IP and per day. When a limit is reached the judge is
// signed in to an existing judge garden instead: never stuck, never an empty screen.

import { randomBytes } from 'node:crypto';
import { login, openSession } from './auth.ts';
import type { DB } from './db.ts';
import { GameError, type Game } from './game.ts';
import type { TaniBotService } from './tanibot.ts';

/** New judge gardens per IP address per 24 hours. */
export const JUDGE_GARDENS_PER_IP_PER_DAY = 3;
/** New judge gardens per 24 hours for the whole game (testnet NEAR budget). */
export const JUDGE_GARDENS_PER_DAY = 50;
/** TaniBot in a judge garden: daily limit (PANEN) and starting budget. */
export const JUDGE_BOT_LIMIT = 50;
export const JUDGE_BOT_BUDGET = 30;
/** TaniBot waits this long for the judge's first harvest before it starts working. */
export const JUDGE_BOT_HOLD_MS = 3 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface JudgeLogin {
  token: string;
  playerId: number;
  /** 'new' = a fresh garden; 'same' = this device's garden; 'shared' = a limit was reached. */
  kind: 'new' | 'same' | 'shared';
}

export class JudgeService {
  private db: DB;
  private game: Game;
  private tanibot: TaniBotService;
  private now: () => number;
  private random: () => Buffer;

  constructor(db: DB, game: Game, tanibot: TaniBotService, now: () => number, random: () => Buffer = () => randomBytes(4)) {
    this.db = db;
    this.game = game;
    this.tanibot = tanibot;
    this.now = now;
    this.random = random;
  }

  enter(deviceId: unknown, ip: string | null): JudgeLogin {
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) throw new GameError('Missing device id');
    const now = this.now();

    // This device already has a judge garden: back to it.
    const own = this.db
      .prepare("SELECT p.id, p.user_id FROM users u JOIN players p ON p.user_id = u.id WHERE u.provider = 'judge' AND u.subject = ?")
      .get(deviceId) as { id: number; user_id: number } | undefined;
    if (own) return { token: openSession(this.db, own.user_id, now), playerId: own.id, kind: 'same' };

    const since = now - DAY_MS;
    const count = (where: string, ...args: (string | number)[]) =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM players p JOIN users u ON u.id = p.user_id WHERE u.provider = 'judge' AND p.created_at >= ? ${where}`).get(since, ...args) as { n: number }).n;
    const ipFull = ip !== null && count('AND p.created_ip = ?', ip) >= JUDGE_GARDENS_PER_IP_PER_DAY;
    const dayFull = count('') >= JUDGE_GARDENS_PER_DAY;
    if (ipFull || dayFull) {
      // A limit is reached: share the newest judge garden (from this IP first).
      const shared = (ipFull
        ? this.db.prepare("SELECT p.id, p.user_id FROM players p JOIN users u ON u.id = p.user_id WHERE u.provider = 'judge' AND p.created_ip = ? ORDER BY p.id DESC LIMIT 1").get(ip)
        : this.db.prepare("SELECT p.id, p.user_id FROM players p JOIN users u ON u.id = p.user_id WHERE u.provider = 'judge' ORDER BY p.id DESC LIMIT 1").get()) as
        | { id: number; user_id: number }
        | undefined;
      if (!shared) throw new GameError('Judge gardens are busy right now. Please try again later.', 429);
      return { token: openSession(this.db, shared.user_id, now), playerId: shared.id, kind: 'shared' };
    }

    const { token, userId } = login(this.db, { provider: 'judge', subject: deviceId, email: null }, now);
    const player = this.game.createPlayer(userId, this.freeName(), ip, true);
    this.game.prefillJudgeGarden(player.id);
    this.tanibot.setup(player.id, { dailyLimit: JUDGE_BOT_LIMIT, budget: JUDGE_BOT_BUDGET, afterAccount: true, holdMs: JUDGE_BOT_HOLD_MS });
    return { token, playerId: player.id, kind: 'new' };
  }

  /** judge-xxxx with 4 random lowercase letters / digits, not taken yet. */
  private freeName(): string {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 20; i++) {
      const name = `judge-${[...this.random()].map((b) => abc[b % abc.length]).join('')}`;
      if (!this.db.prepare('SELECT 1 FROM players WHERE name = ?').get(name)) return name;
    }
    throw new GameError('Could not find a free judge name. Please try again.', 503);
  }
}
