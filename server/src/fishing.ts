// Fishing (docs/PLAN-fishing.md, Ardian 2026-11-11): a simple mini-game at the village's fishing hut.
// Tap to cast, wait for the bite, tap to reel, see the catch.
//
// Anti-cheat: the catch is rolled and stored HERE at the cast, and never sent before the reel (the
// cast answer has only the cast id and the bite time). Leaving does not give the cast back, so
// nobody can roll again by closing the window; a line nobody reels in is pulled in by the server
// (sweep, or the next cast) and paid all the same. A reel before the bite is refused.
//
// Limits: 3 casts per garden per village day (the normal 07:00 WIB day, also for demo gardens, like
// the Arena, so demo mode is not a PANEN tap). Paid catches (PANEN, a seed or Fertilizer) at most 3
// per browser and 10 per IP per day; over that the catch is "released" (1 XP). An IP is only counted,
// never blocked. A judge garden's first cast is always Tilapia or Catfish.
//
// Rewards: fish and the small chest pay PANEN with mint_reward (the Season rule applies); a Mango
// seed goes to Storage, or Mr. Darto buys it (2 PANEN base, mint_reward) when Storage is full;
// Fertilizer goes to the items; junk 1 XP; a message in a bottle 5 XP + a line. Demo XP x5.
//
// Switch: FISHING=on|off in server/.env (Game.fishing, set by main.ts). Off = the routes refuse
// (app.ts, 404 fishing_off) and state.fishing is not sent, so the web keeps "Fishing · Soon".

import { randomInt } from 'node:crypto';
import { dayIndex, msUntilNextDay } from './clock.ts';
import { fromMicro, toMicro, tx, type DB } from './db.ts';
import { GameError, type Game, type PlayerRow } from './game.ts';
import { cleanDeviceId, recordDevice } from './referral.ts';
import {
  DEMO_XP_MULTIPLIER,
  FISHING_AUTO_REEL_MS,
  FISHING_BITE_MAX_MS,
  FISHING_BITE_MIN_MS,
  FISHING_BOTTLE_LINES,
  FISHING_BOTTLE_XP,
  FISHING_CASTS_PER_DAY,
  FISHING_CATCHES,
  FISHING_CHEST_MAX,
  FISHING_CHEST_MIN,
  FISHING_JUNK_XP,
  FISHING_PAID_PER_DEVICE_PER_DAY,
  FISHING_PAID_PER_IP_PER_DAY,
  FISHING_REEL_GRACE_MS,
  rollCatch,
  rollJudgeFirstCatch,
  seedSellPrice,
  type FishingCatchId,
  type FishingKind,
} from './rules.ts';

/** The village day for fishing limits: the normal 07:00 WIB day, also for demo gardens. */
export const fishingDay = (now: number) => dayIndex(now, false);

const CATCH = new Map(FISHING_CATCHES.map((c) => [c.id, c]));

interface CastRow {
  id: number;
  player_id: number;
  cast_day: number;
  catch: FishingCatchId;
  base_panen: number;
  line: number | null;
  paid: number;
  released: number;
  status: 'open' | 'done';
  result: string | null;
  panen_micro: number;
  xp: number;
  job_id: number | null;
  auto: number;
  bite_at: number;
  reeled_at: number | null;
  created_at: number;
}

/** What the player caught (sent only after the reel). */
export interface CatchView {
  id: number;
  catch: FishingCatchId;
  name: string;
  kind: FishingKind;
  /** PANEN really paid (after the Season rule); 0 when none. */
  panen: number;
  /** PANEN before the Season rule (fish, chest, or Mr. Darto's seed price). */
  basePanen: number;
  xp: number;
  /** Over the day's paid-catch limit of this browser / IP: let go, 1 XP only. */
  released: boolean;
  /** 'seed' (in Storage), 'seed_sold' (Storage full: Mr. Darto bought it), 'fertilizer' or null. */
  item: 'seed' | 'seed_sold' | 'fertilizer' | null;
  /** Message in a bottle: its line. */
  line: string | null;
  /** Golden Arowana = a share moment. */
  moment: 'golden_arowana' | null;
  /** The mint_reward chain job (tx link in the Village log once it lands). */
  jobId: number | null;
  jobStatus: string | null;
  /** Pulled in by the server (nobody reeled within a minute). */
  auto: boolean;
  at: number;
}

interface StoredResult {
  item: CatchView['item'];
  seedId?: number;
}

function viewOf(r: CastRow, jobStatus: string | null): CatchView {
  const c = CATCH.get(r.catch)!;
  const res = (r.result ? JSON.parse(r.result) : { item: null }) as StoredResult;
  return {
    id: r.id,
    catch: r.catch,
    name: c.name,
    kind: c.kind,
    panen: fromMicro(r.panen_micro),
    basePanen: r.released ? 0 : r.base_panen,
    xp: r.xp,
    released: r.released === 1,
    item: res.item,
    line: r.line !== null && !r.released ? (FISHING_BOTTLE_LINES[r.line] ?? null) : null,
    moment: r.catch === 'golden_arowana' && !r.released ? 'golden_arowana' : null,
    jobId: r.job_id,
    jobStatus,
    auto: r.auto === 1,
    at: r.reeled_at ?? r.created_at,
  };
}

const jobStatusOf = (db: DB, jobId: number | null) =>
  jobId === null ? null : ((db.prepare('SELECT status FROM chain_jobs WHERE id = ?').get(jobId) as { status: string } | undefined)?.status ?? null);

/** Casts this garden made today. */
export function castsToday(db: DB, playerId: number, now: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM fishing_casts WHERE player_id = ? AND cast_day = ?').get(playerId, fishingDay(now)) as { n: number }).n;
}

/**
 * The fishing part of the game state (only when FISHING=on): casts left, the open line (id + bite
 * time, never the catch) and the newest finished catch (the web shows a notice once per id, e.g.
 * when the server pulled a line in).
 */
export function fishingState(db: DB, playerId: number, now: number) {
  const open = db.prepare("SELECT id, bite_at FROM fishing_casts WHERE player_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(playerId) as
    | { id: number; bite_at: number }
    | undefined;
  const last = db.prepare("SELECT * FROM fishing_casts WHERE player_id = ? AND status = 'done' ORDER BY reeled_at DESC, id DESC LIMIT 1").get(playerId) as
    | CastRow
    | undefined;
  return {
    left: Math.max(0, FISHING_CASTS_PER_DAY - castsToday(db, playerId, now)),
    max: FISHING_CASTS_PER_DAY,
    /** Time until the casts come back (07:00 WIB). */
    msUntilNextDay: msUntilNextDay(now, false),
    open: open ? { id: open.id, biteInMs: Math.max(0, open.bite_at - now) } : null,
    last: last ? viewOf(last, jobStatusOf(db, last.job_id)) : null,
  };
}

export class Fishing {
  private db: DB;
  private game: Game;
  private now: () => number;
  /** Random number in [0, 1) (tests pass a fixed sequence). */
  private random: () => number;

  constructor(db: DB, game: Game, now: () => number, random: () => number = () => randomInt(0, 2 ** 32) / 2 ** 32) {
    this.db = db;
    this.game = game;
    this.now = now;
    this.random = random;
  }

  /** The fishing window: state + what can be caught (names and PANEN now; no chances) + today's catches. */
  view(playerId: number) {
    const now = this.now();
    const today = this.db
      .prepare("SELECT * FROM fishing_casts WHERE player_id = ? AND cast_day = ? AND status = 'done' ORDER BY id")
      .all(playerId, fishingDay(now)) as unknown as CastRow[];
    return {
      ...fishingState(this.db, playerId, now),
      catches: FISHING_CATCHES.map((c) => ({ id: c.id, name: c.name, kind: c.kind, panen: c.panen, panenNow: this.game.afterSeason(c.panen) })),
      chest: { min: FISHING_CHEST_MIN, max: FISHING_CHEST_MAX },
      today: today.map((r) => viewOf(r, jobStatusOf(this.db, r.job_id))),
    };
  }

  /** Paid catches today from this browser / IP reached the limit. */
  private overPaidLimit(deviceId: string | null, ip: string | null, day: number): boolean {
    const count = (col: 'device_id' | 'ip', v: string) =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM fishing_casts WHERE ${col} = ? AND cast_day = ? AND paid = 1 AND released = 0`).get(v, day) as { n: number }).n;
    return (!!deviceId && count('device_id', deviceId) >= FISHING_PAID_PER_DEVICE_PER_DAY) || (!!ip && count('ip', ip) >= FISHING_PAID_PER_IP_PER_DAY);
  }

  /**
   * Casts a line. The catch is rolled and stored now; the answer holds only the cast id and the
   * bite time. A line still in the water is pulled in first (its catch was fixed at its cast).
   */
  cast(playerId: number, ip: string | null, device: unknown) {
    return tx(this.db, () => {
      const now = this.now();
      const day = fishingDay(now);
      const p = this.game.getPlayer(playerId);
      if (p.account_status !== 'ready') throw new GameError('Your garden is still being set up. Try again in a moment.', 409, { code: 'account_not_ready' });
      const open = this.db.prepare("SELECT * FROM fishing_casts WHERE player_id = ? AND status = 'open'").all(p.id) as unknown as CastRow[];
      for (const r of open) this.settle(r, true);
      if (castsToday(this.db, p.id, now) >= FISHING_CASTS_PER_DAY)
        throw new GameError(`You used your ${FISHING_CASTS_PER_DAY} casts today. The fish come back at 07:00 WIB!`, 429, { code: 'fishing_limit' });

      const deviceId = cleanDeviceId(device);
      recordDevice(this.db, p.id, deviceId, now);
      const first = !this.db.prepare('SELECT 1 FROM fishing_casts WHERE player_id = ?').get(p.id);
      const judgeFirst = first && this.game.isJudge(p.id);
      const id = judgeFirst ? rollJudgeFirstCatch(this.random()) : rollCatch(this.random());
      const c = CATCH.get(id)!;
      const basePanen = id === 'chest' ? FISHING_CHEST_MIN + Math.floor(this.random() * (FISHING_CHEST_MAX - FISHING_CHEST_MIN + 1)) : c.panen;
      const line = id === 'bottle' ? Math.floor(this.random() * FISHING_BOTTLE_LINES.length) : null;
      const released = c.paid && this.overPaidLimit(deviceId, ip, day);
      const biteAt = now + FISHING_BITE_MIN_MS + Math.floor(this.random() * (FISHING_BITE_MAX_MS - FISHING_BITE_MIN_MS + 1));
      const castId = Number(
        this.db
          .prepare(
            `INSERT INTO fishing_casts (player_id, cast_day, catch, base_panen, line, paid, released, status, device_id, ip, bite_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
          )
          .run(p.id, day, id, basePanen, line, c.paid ? 1 : 0, released ? 1 : 0, deviceId, ip, biteAt, now).lastInsertRowid,
      );
      return { cast: { id: castId, biteInMs: biteAt - now }, left: Math.max(0, FISHING_CASTS_PER_DAY - castsToday(this.db, p.id, now)) };
    });
  }

  /** Reels a line in: pays the catch (once). Reeling a finished cast returns its result again. */
  reel(playerId: number, castId: number) {
    return tx(this.db, () => {
      const r = this.db.prepare('SELECT * FROM fishing_casts WHERE id = ? AND player_id = ?').get(castId, playerId) as CastRow | undefined;
      if (!r) throw new GameError('Cast not found', 404, { code: 'unknown_cast' });
      if (r.status === 'done') return { result: viewOf(r, jobStatusOf(this.db, r.job_id)), titleUp: null };
      if (this.now() < r.bite_at - FISHING_REEL_GRACE_MS) throw new GameError('Wait for the bite!', 409, { code: 'too_early', biteInMs: r.bite_at - this.now() });
      return this.settle(r, false);
    });
  }

  /** Pulls in every line nobody reeled within a minute of its bite (main.ts, every 10 s). */
  sweep(): number {
    const due = this.db.prepare("SELECT * FROM fishing_casts WHERE status = 'open' AND bite_at <= ?").all(this.now() - FISHING_AUTO_REEL_MS) as unknown as CastRow[];
    for (const r of due) tx(this.db, () => this.settle(r, true));
    return due.length;
  }

  /** Gives the stored catch (call inside a transaction). */
  private settle(r: CastRow, auto: boolean): { result: CatchView; titleUp: string | null } {
    const now = this.now();
    const p: PlayerRow = this.game.getPlayer(r.player_id);
    const mult = p.demo === 1 ? DEMO_XP_MULTIPLIER : 1;
    const c = CATCH.get(r.catch)!;
    let panenMicro = 0;
    let basePanen = 0;
    let jobId: number | null = null;
    let xp = 0;
    const stored: StoredResult = { item: null };
    const pay = (base: number, note: string) => {
      const res = this.game.earnReward(p, 'fishing', base, note);
      basePanen = base;
      panenMicro = toMicro(res.expectedPanen);
      jobId = res.jobId;
    };

    if (r.released) xp = FISHING_JUNK_XP * mult;
    else if (c.kind === 'fish') pay(c.panen, `Fishing: ${c.name}`);
    else if (c.kind === 'junk') xp = FISHING_JUNK_XP * mult;
    else if (r.catch === 'chest') pay(r.base_panen, 'Fishing: Small chest');
    else if (r.catch === 'bottle') xp = FISHING_BOTTLE_XP * mult;
    else if (r.catch === 'fertilizer') {
      this.game.grantItem(p.id, 'fertilizer', 1);
      stored.item = 'fertilizer';
    } else if (r.catch === 'mango_seed') {
      const seedId = this.game.grantSeedIfRoom(p.id, 'mango', 'fishing');
      if (seedId !== null) {
        stored.item = 'seed';
        stored.seedId = seedId;
      } else {
        stored.item = 'seed_sold';
        pay(seedSellPrice('mango', null), 'Fishing: Mango seed sold to Mr. Darto (Storage full)');
      }
    }
    const titleUp = this.game.grantXp(p.id, xp);
    this.db
      .prepare("UPDATE fishing_casts SET status = 'done', result = ?, base_panen = ?, panen_micro = ?, xp = ?, job_id = ?, auto = ?, reeled_at = ? WHERE id = ?")
      .run(JSON.stringify(stored), basePanen || r.base_panen, panenMicro, xp, jobId, auto ? 1 : 0, now, r.id);
    const row = this.db.prepare('SELECT * FROM fishing_casts WHERE id = ?').get(r.id) as unknown as CastRow;
    return { result: viewOf(row, jobStatusOf(this.db, jobId)), titleUp };
  }
}
