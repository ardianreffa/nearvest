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
  ACTIVE_WRITE_MS,
  DEMO_XP_MULTIPLIER,
  FARMER_ACTIVE_DAYS,
  FARMER_LIST_MAX,
  FARMER_LIST_MIN,
  FARMER_SEARCH_MAX,
  FRIEND_ADDS_SHOWN,
  FRIENDS_ADDS_PER_DAY,
  FRIENDS_MAX,
  HELP_MIN_GARDEN_AGE_MS,
  HELP_OWNER_XP_PER_DAY,
  HELP_XP_HELPER,
  HELP_XP_OWNER,
  isOnline,
  ONLINE_MS,
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
  /** The viewer added this garden as a friend (servers from 2026-11-11 on). */
  friend: boolean;
  /** Its game tab sent a sign of life in the last minute (POST /api/ping). */
  online: boolean;
}

interface Candidate {
  row: PlayerRow;
  seen: number;
  judge: boolean;
  /** A judge garden linked to the viewer by a friendship (either way): listed like a real farmer. */
  linked?: boolean;
  trees: number;
}

/**
 * SQL: garden `p` and the viewer are friends either way (the viewer added it, or it added the
 * viewer). Two `?` = the viewer's id. Lets a judge garden show in the list and the search.
 */
const LINKED_TO_VIEWER =
  'p.id IN (SELECT friend_id FROM friends WHERE player_id = ?) OR p.id IN (SELECT player_id FROM friends WHERE friend_id = ?)';

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
   * never empty, and except a judge garden linked to the viewer by a friendship (either way: the
   * viewer added it, or it added the viewer), which is listed like a real farmer. Order: helped you, real farmers before judge gardens, a thirsty tree, the most
   * recently active.
   */
  farmers(viewerId: number, query?: unknown) {
    const q = typeof query === 'string' ? query.trim().toLowerCase().slice(0, FARMER_SEARCH_MAX) : '';
    const friendIds = this.friendIds(viewerId);
    const friends = this.friendRows(viewerId);
    const limits = this.myFriends(viewerId, friends.length);
    if (q) return { ...this.search(viewerId, q, friendIds), friends, myFriends: limits, helpedToday: this.helpedToday(viewerId), help: this.helpRules(viewerId) };
    const now = this.now();
    // judge = false: real farmers plus judge gardens linked by a friendship (sorted like real
    // farmers, still marked `judge`); judge = true: the other judge gardens that fill the list.
    const rows = (judge: boolean, limit: number, activeSince: number | null) =>
      (
        this.db
          .prepare(
            `SELECT p.*, COALESCE(p.last_seen_at, p.created_at) AS seen, u.provider = 'judge' AS is_judge,
               (SELECT count(*) FROM trees t WHERE t.player_id = p.id AND t.status = 'alive' AND t.plot IS NOT NULL) AS tree_count
             FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.id != ? AND p.account_status = 'ready'
               AND ${judge ? `u.provider = 'judge' AND NOT (${LINKED_TO_VIEWER})` : `(u.provider != 'judge' OR ${LINKED_TO_VIEWER})`}
               AND (? IS NULL OR COALESCE(p.last_seen_at, p.created_at) >= ?)
               AND EXISTS (SELECT 1 FROM trees t WHERE t.player_id = p.id AND t.status = 'alive' AND t.plot IS NOT NULL)
             ORDER BY ${judge ? 'p.created_at' : 'seen'} DESC LIMIT ?`,
          )
          .all(viewerId, viewerId, viewerId, activeSince, activeSince, limit) as unknown as (PlayerRow & {
          seen: number;
          is_judge: number;
          tree_count: number;
        })[]
      ).map((r): Candidate => ({ row: r, seen: r.seen, judge: r.is_judge === 1, linked: !judge && r.is_judge === 1, trees: r.tree_count }));

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
      .map((x) => ({ ...x, online: isOnline(x.c.row.active_at, now) }))
      // Judge gardens only fill the list: after the real farmers. Online farmers first among the rest.
      .sort(
        (a, b) =>
          b.helpedAt - a.helpedAt ||
          Number(a.c.judge && !a.c.linked) - Number(b.c.judge && !b.c.linked) ||
          Number(b.online) - Number(a.online) ||
          Number(b.thirsty > 0) - Number(a.thirsty > 0) ||
          b.c.seen - a.c.seen,
      )
      .slice(0, FARMER_LIST_MAX)
      .map(
        ({ c, thirsty, helpedAt, online }): FarmerRow => ({
          name: c.row.name,
          avatar: c.row.avatar,
          title: titleFor(c.row.xp),
          trees: c.trees,
          thirsty,
          helpedYou: helpedAt > 0,
          judge: c.judge,
          friend: friendIds.has(c.row.id),
          online,
        }),
      );
    // `farmers` keeps friends too (older webs know only this list); new webs show `friends` on top
    // and leave them out below.
    return { farmers, friends, myFriends: limits, query: null as string | null, helpedToday: this.helpedToday(viewerId), help: this.helpRules(viewerId) };
  }

  /**
   * Farmer search: every ready garden whose name starts with `q` (names are lower case; also
   * gardens without trees or not active lately), never the viewer, never judge gardens except one
   * linked to the viewer by a friendship (either way). Exact
   * name first, then the most recently active. Public data only (the same rows as the list).
   */
  private search(viewerId: number, q: string, friendIds: Set<number>): { farmers: FarmerRow[]; query: string | null } {
    const rows = this.db
      .prepare(
        `SELECT p.*, COALESCE(p.last_seen_at, p.created_at) AS seen, u.provider = 'judge' AS is_judge,
           (SELECT count(*) FROM trees t WHERE t.player_id = p.id AND t.status = 'alive' AND t.plot IS NOT NULL) AS tree_count
         FROM players p JOIN users u ON u.id = p.user_id
         WHERE p.id != ? AND p.account_status = 'ready' AND (u.provider != 'judge' OR ${LINKED_TO_VIEWER}) AND substr(p.name, 1, ?) = ?
         ORDER BY p.name = ? DESC, seen DESC LIMIT ?`,
      )
      .all(viewerId, viewerId, viewerId, q.length, q, q, FARMER_LIST_MAX) as unknown as (PlayerRow & { seen: number; is_judge: number; tree_count: number })[];
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
        judge: r.is_judge === 1,
        friend: friendIds.has(r.id),
        online: isOnline(r.active_at, this.now()),
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
      /** Add friend (servers from 2026-11-11 on): the viewer added this garden; it is online now. */
      friend: !own && this.isFriend(viewerId, owner.id),
      online: isOnline(owner.active_at, this.now()),
      myFriends: this.myFriends(viewerId),
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

  // ---------- Friends and Online (docs/PLAN-arena.md 7.11) ----------

  /**
   * A sign of life from a visible game tab (the web pings every 30 s while the tab is visible).
   * Writes `active_at` at most every 20 s, so pings cost almost no disk writes. `away` = the tab
   * was hidden or closed: the garden shows offline at once.
   */
  ping(playerId: number, away = false): { online: boolean; onlineMs: number } {
    const now = this.now();
    if (away) this.db.prepare('UPDATE players SET active_at = 0 WHERE id = ?').run(playerId);
    else this.db.prepare('UPDATE players SET active_at = ? WHERE id = ? AND active_at < ?').run(now, playerId, now - ACTIVE_WRITE_MS);
    return { online: !away, onlineMs: ONLINE_MS };
  }

  private friendIds(viewerId: number): Set<number> {
    return new Set((this.db.prepare('SELECT friend_id AS id FROM friends WHERE player_id = ?').all(viewerId) as { id: number }[]).map((r) => r.id));
  }

  private isFriend(viewerId: number, otherId: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM friends WHERE player_id = ? AND friend_id = ?').get(viewerId, otherId);
  }

  private addsToday(viewerId: number): number {
    return (this.db.prepare('SELECT count(*) AS n FROM friend_adds WHERE player_id = ? AND add_day = ?').get(viewerId, this.helpDay()) as { n: number }).n;
  }

  /** How many friends the viewer has, adds left today and the limits (shown by the web). */
  myFriends(viewerId: number, count?: number) {
    const n = count ?? (this.db.prepare('SELECT count(*) AS n FROM friends WHERE player_id = ?').get(viewerId) as { n: number }).n;
    return { count: n, max: FRIENDS_MAX, addsLeft: Math.max(0, FRIENDS_ADDS_PER_DAY - this.addsToday(viewerId)), addsPerDay: FRIENDS_ADDS_PER_DAY };
  }

  /**
   * The viewer's friends (public data only, the same fields as a farmer row): online first, then
   * the most recently active. Every friend shows, also without a tree or not active lately.
   */
  friendRows(viewerId: number): FarmerRow[] {
    const now = this.now();
    const rows = this.db
      .prepare(
        `SELECT p.*, u.provider = 'judge' AS is_judge,
           (SELECT count(*) FROM trees t WHERE t.player_id = p.id AND t.status = 'alive' AND t.plot IS NOT NULL) AS tree_count
         FROM friends f JOIN players p ON p.id = f.friend_id JOIN users u ON u.id = p.user_id
         WHERE f.player_id = ? AND p.account_status = 'ready'`,
      )
      .all(viewerId) as unknown as (PlayerRow & { is_judge: number; tree_count: number })[];
    const helped = new Set(
      (this.db.prepare('SELECT DISTINCT helper_id FROM garden_help WHERE owner_id = ? AND created_at > ?').all(viewerId, now - HELPED_YOU_MS) as { helper_id: number }[]).map(
        (h) => h.helper_id,
      ),
    );
    return rows
      .map((r) => ({ r, online: isOnline(r.active_at, now), seen: Math.max(r.active_at ?? 0, r.last_seen_at ?? r.created_at) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || b.seen - a.seen || a.r.name.localeCompare(b.r.name))
      .map(({ r, online }) => ({
        name: r.name,
        avatar: r.avatar,
        title: titleFor(r.xp),
        trees: r.tree_count,
        thirsty: this.game.thirstyTrees(r),
        helpedYou: helped.has(r.id),
        judge: r.is_judge === 1,
        friend: true,
        online,
      }));
  }

  /**
   * Add friend: one way, no accept needed. At most 50 friends and 20 adds per village day (a
   * remove does not give an add back), never yourself. Judge gardens can add and be added. The
   * added garden gets one notice per pair ever (add, remove, add again does not notify twice).
   * Adding a friend you already have changes nothing.
   */
  addFriend(viewerId: number, name: string) {
    return tx(this.db, () => {
      const me = this.game.getPlayer(viewerId);
      const them = this.game.getPlayerByName(String(name).toLowerCase());
      if (!them || them.account_status !== 'ready') throw new GameError('Garden not found', 404);
      if (them.id === me.id) throw new GameError('You cannot add your own garden as a friend.', 400, { code: 'own_garden' });
      if (this.isFriend(me.id, them.id)) return { friend: them.name, added: false, myFriends: this.myFriends(me.id) };
      const limits = this.myFriends(me.id);
      if (limits.count >= FRIENDS_MAX)
        throw new GameError(`You have ${FRIENDS_MAX} friends, the most a garden can have. Remove one to add ${them.name}.`, 409, { code: 'friends_full' });
      if (limits.addsLeft <= 0)
        throw new GameError(`You added ${FRIENDS_ADDS_PER_DAY} friends today. Add more tomorrow!`, 429, { code: 'friend_adds_today' });
      const now = this.now();
      const before = this.db.prepare('SELECT 1 FROM friend_adds WHERE player_id = ? AND friend_id = ? AND notify = 1').get(me.id, them.id);
      this.db.prepare('INSERT INTO friends (player_id, friend_id, created_at) VALUES (?, ?, ?)').run(me.id, them.id, now);
      this.db
        .prepare('INSERT INTO friend_adds (player_id, friend_id, add_day, notify, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(me.id, them.id, this.helpDay(), before ? 0 : 1, now);
      return { friend: them.name, added: true, myFriends: this.myFriends(me.id) };
    });
  }

  /** Remove friend: no notice to the other garden. Removing a garden that is not a friend changes nothing. */
  removeFriend(viewerId: number, name: string) {
    const them = this.game.getPlayerByName(String(name).toLowerCase());
    if (!them) throw new GameError('Garden not found', 404);
    const r = this.db.prepare('DELETE FROM friends WHERE player_id = ? AND friend_id = ?').run(viewerId, them.id);
    return { friend: them.name, removed: Number(r.changes) > 0, myFriends: this.myFriends(viewerId) };
  }
}
