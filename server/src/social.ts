// Garden visits (docs/PLAN-social.md, Ardian 2026-11-09): the farmer list, visiting a garden
// (read only) and helping water one tree per village day. No chain transaction: watering is game
// data for every tree (the Tree NFT only changes when its stage changes, as always). Visitors can
// also leave one template sticker per garden per village day (no free text).
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
  HELP_MIN_GARDEN_AGE_MS,
  HELP_OWNER_XP_PER_DAY,
  HELP_XP_HELPER,
  HELP_XP_OWNER,
  STICKERS,
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
  farmers(viewerId: number) {
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
    return { farmers, helpedToday: this.helpedToday(viewerId), help: this.helpRules(viewerId) };
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
    return {
      garden: this.game.publicGarden(owner),
      own: owner.id === viewerId,
      helpedToday: this.helpedToday(viewerId),
      help: this.helpRules(viewerId),
      /** Template stickers a visitor can leave, and the one the viewer left here today (1 per day). */
      stickers: STICKERS,
      stickerToday: owner.id === viewerId ? null : this.stickerToday(viewerId, owner.id),
    };
  }

  /** The sticker the viewer left in this garden today, if any. */
  private stickerToday(fromId: number, toId: number): StickerId | null {
    const r = this.db.prepare('SELECT sticker FROM stickers WHERE from_id = ? AND to_id = ? AND sticker_day = ?').get(fromId, toId, this.helpDay()) as
      | { sticker: StickerId }
      | undefined;
    return r?.sticker ?? null;
  }

  /**
   * Leaves a template sticker in a friend's garden: one of the 6 fixed stickers (no free text), at
   * most 1 per visitor per garden per village day, never in your own garden. No XP, no chain.
   */
  sticker(viewerId: number, name: string, sticker: unknown) {
    return tx(this.db, () => {
      const from = this.game.getPlayer(viewerId);
      const owner = this.game.getPlayerByName(String(name).toLowerCase());
      if (!owner || owner.account_status !== 'ready') throw new GameError('Garden not found', 404);
      if (owner.id === from.id) throw new GameError('Stickers are for friends\' gardens.', 400, { code: 'own_garden' });
      const known = STICKERS.find((s) => s.id === sticker);
      if (!known) throw new GameError('Unknown sticker', 400, { code: 'unknown_sticker' });
      const today = this.stickerToday(from.id, owner.id);
      if (today) throw new GameError(`You already left a sticker for ${owner.name} today. Come back tomorrow!`, 409, { code: 'sticker_today', sticker: today });
      this.db
        .prepare('INSERT INTO stickers (from_id, to_id, sticker, sticker_day, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(from.id, owner.id, known.id, this.helpDay(), this.now());
      return { owner: owner.name, sticker: known.id, text: known.text };
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
