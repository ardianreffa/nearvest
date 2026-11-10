// Garden visits (docs/PLAN-social.md, Ardian 2026-11-09): the farmer list, visiting a garden
// (read only) and helping water one tree per village day. No chain transaction: watering is game
// data for every tree (the Tree NFT only changes when its stage changes, as always). Visitors can
// also leave up to 3 template stickers per garden per village day, 5 s apart (no free text). Every
// visit is recorded (1 row per visitor per garden per day, no XP); the owner can wave back with a
// template sticker once per visitor per day.
//
// Privacy: visitors only see a garden's name, title, avatar and trees (Game.publicGarden). Never
// a balance, seeds, fruit, items, TaniBot budget, sign-in method, Google / wallet data or IP.

import { dayIndex } from './clock.ts';
import { tx, type DB } from './db.ts';
import { GameError, type Game, type PlayerRow } from './game.ts';
import {
  DEMO_XP_MULTIPLIER,
  FARMER_ACTIVE_DAYS,
  FARMER_LIST_MAX,
  FARMER_LIST_MIN,
  FARMER_SEARCH_MAX,
  HELP_MIN_GARDEN_AGE_MS,
  HELP_OWNER_XP_PER_DAY,
  HELP_XP_HELPER,
  HELP_XP_OWNER,
  STICKER_COOLDOWN_MS,
  STICKERS,
  STICKERS_PER_DAY,
  titleFor,
  type StickerId,
} from './rules.ts';

const DAY = 24 * 60 * 60 * 1000;
/** "Helped you" stays on a farmer's row this long. */
const HELPED_YOU_MS = 3 * DAY;

export interface FarmerRow {
  name: string;
  avatar: string;
  title: string;
  /** Living trees on the garden's plots. */
  trees: number;
  /** Trees a visitor can help water now. */
  thirsty: number;
  /** This farmer helped water one of your trees in the last 3 days. */
  helpedYou: boolean;
  /** A Try as Judge garden (only shown while there are fewer than 5 other farmers). */
  judge: boolean;
}

interface Candidate {
  row: PlayerRow;
  seen: number;
  judge: boolean;
  trees: number;
}

export class Social {
  private db: DB;
  private game: Game;
  private now: () => number;

  constructor(db: DB, game: Game, now: () => number) {
    this.db = db;
    this.game = game;
    this.now = now;
  }

  /** The village day for help limits: the normal 07:00 WIB day, also for demo gardens. */
  private helpDay(): number {
    return dayIndex(this.now(), false);
  }

  private young(p: PlayerRow): boolean {
    return this.now() - p.created_at < HELP_MIN_GARDEN_AGE_MS;
  }

  /** What the viewer did today: the friend's tree they helped (one per day). */
  private helpedToday(viewerId: number): { name: string; plot: number } | null {
    const r = this.db
      .prepare('SELECT o.name, h.plot FROM garden_help h JOIN players o ON o.id = h.owner_id WHERE h.helper_id = ? AND h.help_day = ?')
      .get(viewerId, this.helpDay()) as { name: string; plot: number } | undefined;
    return r ?? null;
  }

  /**
   * Farmers of Tandur: ready gardens with a living tree, active in the last 7 days, not the viewer.
   * Judge gardens are left out, except to fill the list up to 5 rows (the newest first), so it is
   * never empty. Order: helped you, real farmers before judge gardens, a thirsty tree, the most
   * recently active.
   */
  farmers(viewerId: number, query?: unknown) {
    const q = typeof query === 'string' ? query.trim().toLowerCase().slice(0, FARMER_SEARCH_MAX) : '';
    if (q) return { ...this.search(viewerId, q), helpedToday: this.helpedToday(viewerId), help: this.helpRules(viewerId) };
    const now = this.now();
    const rows = (judge: boolean, limit: number, activeSince: number | null) =>
      (
        this.db
          .prepare(
            `SELECT p.*, COALESCE(p.last_seen_at, p.created_at) AS seen,
               (SELECT count(*) FROM trees t WHERE t.player_id = p.id AND t.status = 'alive' AND t.plot IS NOT NULL) AS tree_count
             FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.id != ? AND p.account_status = 'ready' AND (u.provider = 'judge') = ?
               AND (? IS NULL OR COALESCE(p.last_seen_at, p.created_at) >= ?)
               AND EXISTS (SELECT 1 FROM trees t WHERE t.player_id = p.id AND t.status = 'alive' AND t.plot IS NOT NULL)
             ORDER BY ${judge ? 'p.created_at' : 'seen'} DESC LIMIT ?`,
          )
          .all(viewerId, judge ? 1 : 0, activeSince, activeSince, limit) as unknown as (PlayerRow & { seen: number; tree_count: number })[]
      ).map((r): Candidate => ({ row: r, seen: r.seen, judge, trees: r.tree_count }));

    let list = rows(false, 200, now - FARMER_ACTIVE_DAYS * DAY);
    if (list.length < FARMER_LIST_MIN) list = [...list, ...rows(true, FARMER_LIST_MIN - list.length, null)];

    const helpers = new Map(
      (
        this.db
          .prepare('SELECT helper_id, max(created_at) AS at FROM garden_help WHERE owner_id = ? AND created_at > ? GROUP BY helper_id')
          .all(viewerId, now - HELPED_YOU_MS) as { helper_id: number; at: number }[]
      ).map((h) => [h.helper_id, h.at]),
    );
    const farmers = list
      .map((c) => ({ c, thirsty: this.game.thirstyTrees(c.row), helpedAt: helpers.get(c.row.id) ?? 0 }))
      // Judge gardens only fill the list: after the real farmers.
      .sort((a, b) => b.helpedAt - a.helpedAt || Number(a.c.judge) - Number(b.c.judge) || Number(b.thirsty > 0) - Number(a.thirsty > 0) || b.c.seen - a.c.seen)
      .slice(0, FARMER_LIST_MAX)
      .map(
        ({ c, thirsty, helpedAt }): FarmerRow => ({
          name: c.row.name,
          avatar: c.row.avatar,
          title: titleFor(c.row.xp),
          trees: c.trees,
          thirsty,
          helpedYou: helpedAt > 0,
          judge: c.judge,
        }),
      );
    return { farmers, query: null as string | null, helpedToday: this.helpedToday(viewerId), help: this.helpRules(viewerId) };
  }

  /**
   * Farmer search: every ready garden whose name starts with `q` (names are lower case; also
   * gardens without trees or not active lately), never judge gardens, never the viewer. Exact
   * name first, then the most recently active. Public data only (the same rows as the list).
   */
  private search(viewerId: number, q: string): { farmers: FarmerRow[]; query: string | null } {
    const rows = this.db
      .prepare(
        `SELECT p.*, COALESCE(p.last_seen_at, p.created_at) AS seen,
           (SELECT count(*) FROM trees t WHERE t.player_id = p.id AND t.status = 'alive' AND t.plot IS NOT NULL) AS tree_count
         FROM players p JOIN users u ON u.id = p.user_id
         WHERE p.id != ? AND p.account_status = 'ready' AND u.provider != 'judge' AND substr(p.name, 1, ?) = ?
         ORDER BY p.name = ? DESC, seen DESC LIMIT ?`,
      )
      .all(viewerId, q.length, q, q, FARMER_LIST_MAX) as unknown as (PlayerRow & { seen: number; tree_count: number })[];
    const helped = new Set(
      (this.db.prepare('SELECT DISTINCT helper_id FROM garden_help WHERE owner_id = ? AND created_at > ?').all(viewerId, this.now() - HELPED_YOU_MS) as { helper_id: number }[]).map(
        (h) => h.helper_id,
      ),
    );
    return {
      query: q,
      farmers: rows.map((r) => ({
        name: r.name,
        avatar: r.avatar,
        title: titleFor(r.xp),
        trees: r.tree_count,
        thirsty: this.game.thirstyTrees(r),
        helpedYou: helped.has(r.id),
        judge: false,
      })),
    };
  }

  /** Records a visit: 1 row per visitor per garden per village day (later visits update its time). No XP. */
  private recordVisit(visitorId: number, ownerId: number): void {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO visits (visitor_id, owner_id, visit_day, created_at, last_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (visitor_id, owner_id, visit_day) DO UPDATE SET last_at = excluded.last_at`,
      )
      .run(visitorId, ownerId, this.helpDay(), now, now);
  }

  /** The help rules for the viewer (shown in the list / visit). */
  private helpRules(viewerId: number) {
    const viewer = this.game.getPlayer(viewerId);
    return {
      helperXp: this.young(viewer) ? 0 : HELP_XP_HELPER * (viewer.demo === 1 ? DEMO_XP_MULTIPLIER : 1),
      youngGarden: this.young(viewer),
      perDay: 1,
    };
  }

  /** A garden as a visitor sees it (read only), plus what the visitor may do there today. */
  visit(viewerId: number, name: string) {
    const owner = this.game.getPlayerByName(String(name).toLowerCase());
    if (!owner || owner.account_status !== 'ready') throw new GameError('Garden not found', 404);
    const own = owner.id === viewerId;
    if (!own) this.recordVisit(viewerId, owner.id);
    const today = own ? [] : this.stickersToday(viewerId, owner.id);
    return {
      garden: this.game.publicGarden(owner),
      own,
      helpedToday: this.helpedToday(viewerId),
      help: this.helpRules(viewerId),
      /** Template stickers a visitor can leave. */
      stickers: STICKERS,
      /** The last sticker the viewer left here today (older webs: one a day). */
      stickerToday: today.length ? today[today.length - 1].sticker : null,
      /** Every sticker the viewer left here today (oldest first), the daily limit and the wait. */
      stickersToday: today.map((t) => t.sticker),
      stickerMax: STICKERS_PER_DAY,
      stickerWaitMs: today.length ? Math.max(0, today[today.length - 1].at + STICKER_COOLDOWN_MS - this.now()) : 0,
    };
  }

  /** The stickers the viewer left in this garden today (oldest first). */
  private stickersToday(fromId: number, toId: number): { sticker: StickerId; at: number }[] {
    return this.db
      .prepare('SELECT sticker, created_at AS at FROM stickers WHERE from_id = ? AND to_id = ? AND sticker_day = ? ORDER BY id')
      .all(fromId, toId, this.helpDay()) as unknown as { sticker: StickerId; at: number }[];
  }

  /**
   * Leaves a template sticker in a friend's garden: one of the 6 fixed stickers (no free text), at
   * most 3 per visitor per garden per village day and 5 s apart, never in your own garden. No XP,
   * no chain. It belongs to that day's visit row.
   */
  sticker(viewerId: number, name: string, sticker: unknown) {
    return tx(this.db, () => {
      const from = this.game.getPlayer(viewerId);
      const owner = this.game.getPlayerByName(String(name).toLowerCase());
      if (!owner || owner.account_status !== 'ready') throw new GameError('Garden not found', 404);
      if (owner.id === from.id) throw new GameError('Stickers are for friends\' gardens.', 400, { code: 'own_garden' });
      const known = STICKERS.find((s) => s.id === sticker);
      if (!known) throw new GameError('Unknown sticker', 400, { code: 'unknown_sticker' });
      const today = this.stickersToday(from.id, owner.id);
      if (today.length >= STICKERS_PER_DAY)
        throw new GameError(`You left ${STICKERS_PER_DAY} stickers for ${owner.name} today. Come back tomorrow!`, 409, { code: 'sticker_today', sticker: today[today.length - 1].sticker });
      const last = this.db.prepare('SELECT max(created_at) AS at FROM stickers WHERE from_id = ? AND to_id = ?').get(from.id, owner.id) as { at: number | null };
      const waitMs = last.at === null ? 0 : last.at + STICKER_COOLDOWN_MS - this.now();
      if (waitMs > 0) throw new GameError(`Wait ${Math.ceil(waitMs / 1000)} s before the next sticker.`, 429, { code: 'sticker_wait', waitMs });
      this.db
        .prepare('INSERT INTO stickers (from_id, to_id, sticker, sticker_day, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(from.id, owner.id, known.id, this.helpDay(), this.now());
      this.recordVisit(from.id, owner.id);
      return { owner: owner.name, sticker: known.id, text: known.text, sent: today.length + 1, max: STICKERS_PER_DAY };
    });
  }

  /**
   * Wave back: the owner answers a row of their Visitors list with one of the 6 template stickers,
   * sent to that visitor (who does not need to visit back). At most once per visitor per village
   * day. No XP, no chain.
   */
  waveBack(ownerId: number, visitId: number, sticker: unknown) {
    return tx(this.db, () => {
      const v = this.db.prepare('SELECT v.*, p.name AS visitor FROM visits v JOIN players p ON p.id = v.visitor_id WHERE v.id = ?').get(visitId) as
        | { id: number; owner_id: number; visitor_id: number; wave_sticker: string | null; visitor: string }
        | undefined;
      if (!v || v.owner_id !== ownerId) throw new GameError('Visit not found', 404);
      const known = STICKERS.find((s) => s.id === sticker);
      if (!known) throw new GameError('Unknown sticker', 400, { code: 'unknown_sticker' });
      const day = this.helpDay();
      const waved = this.db.prepare('SELECT 1 FROM visits WHERE owner_id = ? AND visitor_id = ? AND wave_day = ?').get(ownerId, v.visitor_id, day);
      if (v.wave_sticker || waved) throw new GameError(`You already waved back to ${v.visitor} today.`, 409, { code: 'waved_today' });
      this.db.prepare('UPDATE visits SET wave_sticker = ?, wave_day = ?, wave_at = ? WHERE id = ?').run(known.id, day, this.now(), v.id);
      return { visitor: v.visitor, sticker: known.id, text: known.text };
    });
  }

  /**
   * Helps water a friend's tree: 1 per helper per village day, only a tree that needs water now
   * (not when it rains), never your own garden. XP: helper +5, owner +3 (owner at most 3 times per
   * day); a garden younger than 1 day gets no help XP. The demo XP multiplier applies.
   */
  help(viewerId: number, name: string, plot: number) {
    return tx(this.db, () => {
      const now = this.now();
      const helper = this.game.getPlayer(viewerId);
      const owner = this.game.getPlayerByName(String(name).toLowerCase());
      if (!owner || owner.account_status !== 'ready') throw new GameError('Garden not found', 404);
      if (owner.id === helper.id) throw new GameError('This is your own garden: water your trees here as usual.', 400, { code: 'own_garden' });
      const day = this.helpDay();
      const done = this.helpedToday(helper.id);
      if (done) throw new GameError(`You already helped ${done.name} today. Come back tomorrow!`, 409, { code: 'helped_today' });

      const watered = this.game.waterTree(owner, plot, { helping: true });

      const mult = (p: PlayerRow) => (p.demo === 1 ? DEMO_XP_MULTIPLIER : 1);
      const helperXp = this.young(helper) ? 0 : HELP_XP_HELPER * mult(helper);
      const ownerXpToday = (
        this.db.prepare('SELECT count(*) AS n FROM garden_help WHERE owner_id = ? AND help_day = ? AND owner_xp > 0').get(owner.id, day) as { n: number }
      ).n;
      const ownerXp = this.young(owner) || ownerXpToday >= HELP_OWNER_XP_PER_DAY ? 0 : HELP_XP_OWNER * mult(owner);
      if (helperXp) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(helperXp, helper.id);
      if (ownerXp) this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(ownerXp, owner.id);
      this.db
        .prepare('INSERT INTO garden_help (helper_id, owner_id, tree_id, plot, help_day, helper_xp, owner_xp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(helper.id, owner.id, watered.treeId, plot, day, helperXp, ownerXp, now);
      const titleBefore = titleFor(helper.xp);
      const titleAfter = titleFor(helper.xp + helperXp);
      return {
        watered: true,
        owner: owner.name,
        plot,
        species: watered.species,
        waterings: watered.waterings,
        needed: watered.needed,
        helperXp,
        ownerXp,
        /** Why no XP (if so): 'young' = your garden is less than a day old. */
        noXpReason: helperXp === 0 ? 'young' : null,
        titleUp: titleAfter !== titleBefore ? titleAfter : null,
      };
    });
  }
}
