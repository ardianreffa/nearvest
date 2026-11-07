// Login. Google: the web game shows the "Sign in with Google" button (Google
// Identity Services), receives an ID token and sends it here; we verify it
// with Google's public keys. Dev: a username-only login for local testing,
// only when DEV_LOGIN=true. NEAR wallet: see wallet.ts (NEP-413 signed message).
// All return a session token (Bearer).

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { hashToken, newSessionToken } from './crypto.ts';
import type { DB } from './db.ts';
import { GameError } from './game.ts';

/** Google's public signing keys (fetched and cached by jose). Tests pass their own. */
export const GOOGLE_JWKS: JWTVerifyGetKey = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const SESSION_DAYS = 30;

export interface Identity {
  provider: 'google' | 'near' | 'dev' | 'judge';
  subject: string;
  email: string | null;
}

/**
 * Checks a Google ID token: signed by Google, issued by Google, made for our
 * Client ID, not expired, and with a verified email. The player's identity is
 * Google's stable `sub` (1 Google account = 1 garden).
 */
export async function verifyGoogleCredential(
  credential: string,
  clientId: string,
  opts: { keys?: JWTVerifyGetKey; nowMs?: number } = {},
): Promise<Identity> {
  if (!clientId) throw new GameError('Google login is not configured on this server', 503);
  try {
    const { payload } = await jwtVerify(credential, opts.keys ?? GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
      currentDate: opts.nowMs === undefined ? undefined : new Date(opts.nowMs),
      clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('missing sub');
    if (payload.email_verified !== true) throw new Error('email not verified');
    return { provider: 'google', subject: payload.sub, email: (payload.email as string | undefined) ?? null };
  } catch {
    throw new GameError('Google sign-in failed. Please try again.', 401);
  }
}

export function devIdentity(username: string): Identity {
  if (!/^[a-z0-9_-]{2,32}$/.test(username)) throw new GameError('Dev username: 2-32 lowercase letters, digits, - or _');
  return { provider: 'dev', subject: username, email: null };
}

/** Finds or creates the user for an identity and opens a session. */
export function login(db: DB, identity: Identity, nowMs: number): { token: string; userId: number } {
  db.prepare('INSERT INTO users (provider, subject, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (provider, subject) DO NOTHING')
    .run(identity.provider, identity.subject, identity.email, nowMs);
  const user = db.prepare('SELECT id FROM users WHERE provider = ? AND subject = ?').get(identity.provider, identity.subject) as {
    id: number;
  };
  return { token: openSession(db, user.id, nowMs), userId: user.id };
}

/** Opens a session for a user (also used when a linked wallet signs in to a Google garden). */
export function openSession(db: DB, userId: number, nowMs: number): string {
  const token = newSessionToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    nowMs + SESSION_DAYS * 24 * 60 * 60 * 1000,
  );
  return token;
}

export function userFromToken(db: DB, token: string | undefined, nowMs: number): number | null {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hashToken(token)) as
    | { user_id: number; expires_at: number }
    | undefined;
  if (!row || row.expires_at < nowMs) return null;
  return row.user_id;
}

export function logout(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
