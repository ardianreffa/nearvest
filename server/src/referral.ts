// Referral (docs/PLAN-social.md section 3, Ardian 2026-11-10): a friend opens an invite link
// (?ref=<garden name>) and makes a NEW garden. The referral waits ('pending') until the friend's
// first harvest; then the inviter gets REF_REWARD_REFERRER PANEN (mint_reward, the Season rule
// applies) and the friend REF_REWARD_FRIEND PANEN (exact mint). Payment: Game.payReferral.
//
// Anti-cheat: never for judge gardens (either side), never yourself (same garden, a browser the
// inviter has used, the same Google / wallet identity), one inviter per garden, at most 3 referrals
// per real day from one device and from one IP. A refused referral is stored ('refused' + reason)
// but never shown and never paid. The login and the garden itself are never blocked.

import type { DB } from './db.ts';
import { REF_PER_DAY_PER_DEVICE, REF_PER_DAY_PER_IP } from './rules.ts';

const DAY = 24 * 60 * 60 * 1000;

/** The web's random browser id (`nearvest.judgeDevice` in localStorage), or null when missing / malformed. */
export function cleanDeviceId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null;
}

/** A garden name from `?ref=` (lower case), or null. */
export function cleanRef(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const r = v.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(r) ? r : null;
}

/** Remembers that a player used this browser (for the self-invite check). */
export function recordDevice(db: DB, playerId: number, deviceId: unknown, now: number): void {
  const id = cleanDeviceId(deviceId);
  if (id) db.prepare('INSERT OR IGNORE INTO devices (player_id, device_id, first_at) VALUES (?, ?, ?)').run(playerId, id, now);
}

export type ReferralOutcome = 'pending' | 'refused' | null;

/**
 * Stores the referral of a brand-new garden (inside its creation transaction). Returns 'pending',
 * 'refused' (stored, never paid) or null (no valid inviter: nothing stored).
 */
export function createReferral(
  db: DB,
  a: { friendId: number; friendUser: { provider: string; subject: string }; ref: unknown; deviceId: unknown; ip: string | null; now: number },
): ReferralOutcome {
  const name = cleanRef(a.ref);
  if (!name || a.friendUser.provider === 'judge') return null;
  const referrer = db
    .prepare("SELECT p.id, p.account_status, p.wallet_account_id, p.google_sub, u.provider, u.subject FROM players p JOIN users u ON u.id = p.user_id WHERE p.name = ?")
    .get(name) as { id: number; account_status: string; wallet_account_id: string | null; google_sub: string | null; provider: string; subject: string } | undefined;
  if (!referrer || referrer.id === a.friendId || referrer.provider === 'judge' || referrer.account_status === 'failed') return null;

  const device = cleanDeviceId(a.deviceId);
  const since = a.now - DAY;
  const sameIdentity =
    (referrer.provider === a.friendUser.provider && referrer.subject === a.friendUser.subject) ||
    (a.friendUser.provider === 'google' && referrer.google_sub === a.friendUser.subject) ||
    (a.friendUser.provider === 'near' && referrer.wallet_account_id === a.friendUser.subject);
  const sameDevice = !!device && !!db.prepare('SELECT 1 FROM devices WHERE player_id = ? AND device_id = ?').get(referrer.id, device);
  const count = (col: 'device_id' | 'ip', v: string) =>
    (db.prepare(`SELECT count(*) AS n FROM referrals WHERE ${col} = ? AND status != 'refused' AND created_at >= ?`).get(v, since) as { n: number }).n;
  const overLimit = (!!device && count('device_id', device) >= REF_PER_DAY_PER_DEVICE) || (!!a.ip && count('ip', a.ip) >= REF_PER_DAY_PER_IP);
  const reason = sameIdentity || sameDevice ? 'self' : overLimit ? 'limit' : null;
  db.prepare('INSERT INTO referrals (referrer_id, friend_id, device_id, ip, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    referrer.id,
    a.friendId,
    device,
    a.ip,
    reason ? 'refused' : 'pending',
    reason,
    a.now,
  );
  return reason ? 'refused' : 'pending';
}

export interface ReferralRow {
  id: number;
  referrer_id: number;
  friend_id: number;
  status: 'pending' | 'paid' | 'refused';
  paid_at: number | null;
  referrer_job_id: number | null;
  friend_job_id: number | null;
}

/** The friend's referral still waiting for their first harvest, if any. */
export function pendingReferralOf(db: DB, friendId: number): ReferralRow | null {
  return (db.prepare("SELECT * FROM referrals WHERE friend_id = ? AND status = 'pending'").get(friendId) as unknown as ReferralRow | undefined) ?? null;
}

/** How many referrals the inviter was paid for in the last real day. */
export function paidToday(db: DB, referrerId: number, now: number): number {
  return (db.prepare("SELECT count(*) AS n FROM referrals WHERE referrer_id = ? AND status = 'paid' AND paid_at >= ?").get(referrerId, now - DAY) as { n: number }).n;
}

/** What a garden sees of its referrals: friends it invited (pending / paid, never refused) and its own inviter. */
export function referralRows(db: DB, playerId: number) {
  const invited = db
    .prepare(
      `SELECT r.id, f.name, r.status, r.created_at AS at, r.paid_at AS paidAt, j.tx_hash AS tx
       FROM referrals r JOIN players f ON f.id = r.friend_id LEFT JOIN chain_jobs j ON j.id = r.referrer_job_id
       WHERE r.referrer_id = ? AND r.status != 'refused' ORDER BY r.id DESC LIMIT 20`,
    )
    .all(playerId) as unknown as { id: number; name: string; status: 'pending' | 'paid'; at: number; paidAt: number | null; tx: string | null }[];
  const by = db
    .prepare(
      `SELECT r.id, p.name, r.status, r.paid_at AS paidAt, j.tx_hash AS tx
       FROM referrals r JOIN players p ON p.id = r.referrer_id LEFT JOIN chain_jobs j ON j.id = r.friend_job_id
       WHERE r.friend_id = ? AND r.status != 'refused'`,
    )
    .get(playerId) as unknown as { id: number; name: string; status: 'pending' | 'paid'; paidAt: number | null; tx: string | null } | undefined;
  return { invited, invitedBy: by ?? null };
}
