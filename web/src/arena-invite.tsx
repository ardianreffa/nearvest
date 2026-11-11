// The online Arena duel's invite (docs/PLAN-arena.md 7.12): when another player taps Duel on this
// garden while it is online, the ping's answer (presence.ts, every 4 s while the server's switch
// ARENA_ONLINE is on) carries the invite and this popup shows "<NAME> CHALLENGES YOU!" with Accept /
// Decline and a 30 s countdown. Declined or no answer: the challenger fights this garden's TaniBot
// instead. An outside click does nothing (the choice is Accept or Decline). Tokens only.

import { useEffect, useState } from 'preact/hooks';
import type { ArenaInvite } from './api';
import { Avatar } from './art/avatars';

export function InvitePopup({
  invite,
  receivedAt,
  busy,
  error,
  onAccept,
  onDecline,
  onExpire,
}: {
  invite: ArenaInvite;
  /** Local time the invite arrived (the countdown counts from it). */
  receivedAt: number;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
  /** The 30 s ran out: just hide (the server turns it into a TaniBot duel). */
  onExpire: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.ceil((invite.msLeft - (Date.now() - receivedAt)) / 1000));
  useEffect(() => {
    if (secs === 0 && !busy) onExpire();
  }, [secs === 0]);
  return (
    <div class="dialog-backdrop invite-backdrop" role="presentation">
      <div class="dialog panel arena-invite" role="alertdialog" aria-modal="true" aria-label={`${invite.from} challenges you`}>
        <header class="panel-head">
          <h2>{invite.from.toUpperCase()} CHALLENGES YOU!</h2>
        </header>
        <div class="arena-invite-body">
          <Avatar id={invite.avatar} size={48} />
          <p>
            <b>{invite.from}</b> <span class="muted">· {invite.title}</span>
            <br />
            wants a live Fruit Fight in the Tandur Arena: Rock, Paper, Scissors, 10 s per turn.
          </p>
          <b class="arena-invite-secs" aria-label={`${secs} seconds left`}>
            {secs}
          </b>
        </div>
        <p class="arena-invite-hint muted">Decline or no answer: {invite.from} fights your TaniBot instead.</p>
        {error && <p class="error-text">{error}</p>}
        <div class="dialog-actions">
          <button class="btn" disabled={busy} onClick={onDecline}>
            Decline
          </button>
          <button class="btn btn-gold" disabled={busy || secs === 0} onClick={onAccept}>
            {busy ? 'Joining...' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
