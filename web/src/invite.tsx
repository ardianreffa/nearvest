// Referral + stickers on the web (docs/PLAN-social.md sections 1.4 and 3):
// - Village tab "Invite a friend": the invite link (Copy, Share on X), the rewards, the friends
//   invited (paid / waiting for their first harvest) and who invited you.
// - Village tab "Visitors": the last stickers visitors left in your garden.
// - Visiting a garden: "Sticker" opens the 6 template stickers (1 per garden per day, no free text).
// Shown only when the server sends `referral` / `stickers` (older servers: nothing new appears).

import { useState } from 'preact/hooks';
import { api, type GameState, type ReferralView, type StickerKind, type StickerView, type VisitResponse } from './api';
import { playSound } from './audio';
import { Modal } from './help';
import { inviteLink, inviteOrigin, invitePost } from './referral';
import { postUrl } from './share';
import { Sprite, type SpriteName } from './sprites';
import type { Toast } from './toast';
import { formatPanen, Panel } from './ui';

type Notify = (t: Omit<Toast, 'id'>) => void;

/** One pixel icon per template sticker (server rules.ts STICKERS). */
const STICKER_ICON: Record<string, SpriteName> = {
  nice_garden: 'sprout',
  great_durian: 'durian',
  keep_it_up: 'bolt',
  thanks_water: 'droplet',
  gold_vibes: 'sparkle',
  see_you: 'seedPacket',
};

export function StickerIcon({ id, scale = 2 }: { id: string; scale?: number }) {
  return <Sprite name={STICKER_ICON[id] ?? 'sparkle'} scale={scale} />;
}

/** "today", "yesterday", "3 days ago" (real days). */
export function whenText(at: number, now = Date.now()): string {
  const days = Math.floor((startOfDay(now) - startOfDay(at)) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Village tab: invite link + Share on X, rewards, friends invited and their status. */
export function InvitePanel({ state, notify }: { state: GameState; notify: Notify }) {
  const r = state.referral as ReferralView;
  const name = state.player.name;
  const link = inviteLink(inviteOrigin(import.meta.env.DEV, location.origin), name);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    playSound('click');
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: select the link so the player can copy it by hand.
      const input = document.querySelector<HTMLInputElement>('.invite-link input');
      input?.select();
      notify({ kind: 'info', text: 'Select the link and copy it by hand.' });
    }
  };
  const cut = r.rewards.referrerNow < r.rewards.referrer;
  return (
    <Panel title="Invite a friend" class="invite-panel">
      {r.canInvite ? (
        <>
          <p class="small">
            Send your link. When your friend makes their <b>first harvest</b>, you get <b>{formatPanen(r.rewards.referrerNow)} PANEN</b> and they get{' '}
            <b>{formatPanen(r.rewards.friend)} PANEN</b>.
          </p>
          {cut && (
            <p class="muted small">
              Your reward follows the Season rule ({formatPanen(r.rewards.referrer)} {'->'} {formatPanen(r.rewards.referrerNow)} PANEN now).
            </p>
          )}
          <div class="invite-link">
            <input readOnly value={link} aria-label="Your invite link" onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button class="btn btn-small btn-mint invite-copy" onClick={() => void copy()}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div class="share-buttons">
            <a class="btn btn-small invite-x" href={postUrl(invitePost(name), link)} target="_blank" rel="noreferrer" onClick={() => playSound('click')}>
              Share on X
            </a>
          </div>
          <p class="muted small">Max 3 new friends a day per phone or network. Your own second garden does not count.</p>
          {r.invited.length > 0 && (
            <ul class="list invite-list" aria-label="Friends you invited">
              {r.invited.map((f) => (
                <li key={f.id} class="invite-row">
                  <b class="grow invite-name">{f.name}</b>
                  {f.status === 'paid' ? (
                    <span class="tag tag-paid">
                      {f.txUrl ? (
                        <a href={f.txUrl} target="_blank" rel="noreferrer">
                          Paid
                        </a>
                      ) : (
                        'Paid'
                      )}
                    </span>
                  ) : (
                    <span class="tag tag-waiting">Waiting for first harvest</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p class="muted small">Judge gardens cannot invite friends. Make your own garden to get an invite link.</p>
      )}
      {r.invitedBy && (
        <p class="invite-by small">
          {r.invitedBy.name} invited you.{' '}
          {r.invitedBy.status === 'paid' ? (
            <>
              You got your {formatPanen(r.rewards.friend)} PANEN bonus
              {r.invitedBy.txUrl && (
                <>
                  {' '}
                  (
                  <a href={r.invitedBy.txUrl} target="_blank" rel="noreferrer">
                    tx
                  </a>
                  )
                </>
              )}
              .
            </>
          ) : (
            `Your first harvest gives you both PANEN (you: ${formatPanen(r.rewards.friend)}).`
          )}
        </p>
      )}
    </Panel>
  );
}

/** Village tab: stickers visitors left in your garden (last 10). */
export function VisitorsPanel({ stickers }: { stickers: StickerView[] }) {
  return (
    <Panel title="Visitors" class="visitors-panel">
      {stickers.length === 0 ? (
        <p class="muted small">No stickers yet. Friends who visit your garden can leave one a day.</p>
      ) : (
        <ul class="list sticker-list" aria-label="Stickers you received">
          {stickers.map((s) => (
            <li key={s.id} class="sticker-row">
              <span class="sticker-badge">
                <StickerIcon id={s.sticker} />
              </span>
              <span class="grow sticker-main">
                <b class="sticker-text">{s.text}</b>
                <span class="sticker-meta">
                  from {s.from} · {whenText(s.at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Visiting: the 6 template stickers; one per garden per day. */
export function StickerWindow({
  name,
  visit,
  onClose,
  onSent,
  notify,
}: {
  name: string;
  visit: VisitResponse;
  onClose: () => void;
  onSent: (v: VisitResponse) => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const sent = visit.stickerToday ?? null;
  const kinds: StickerKind[] = visit.stickers ?? [];
  const send = async (id: string) => {
    if (busy || sent) return;
    setBusy(id);
    playSound('click');
    try {
      const r = await api<{ result: { text: string; owner: string }; visit: VisitResponse }>('POST', `/api/farmers/${encodeURIComponent(name)}/sticker`, { sticker: id });
      onSent(r.visit);
      playSound('plant');
      notify({ kind: 'success', text: `You left "${r.result.text}" for ${r.result.owner}.` });
      onClose();
    } catch (e) {
      playSound('error');
      notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Leave a sticker" onClose={onClose} closeLabel="Close" class="sticker-dialog">
      <p class="small">
        {sent ? `You left a sticker for ${name} today. Come back tomorrow!` : `Pick one for ${name}. One sticker per garden a day.`}
      </p>
      <div class="sticker-grid" role="list">
        {kinds.map((k) => (
          <button
            key={k.id}
            role="listitem"
            class={`sticker-pick${sent === k.id ? ' sent' : ''}`}
            disabled={!!sent || !!busy}
            onClick={() => void send(k.id)}
            aria-label={sent === k.id ? `${k.text} (sent today)` : `Leave "${k.text}"`}
          >
            <StickerIcon id={k.id} scale={3} />
            <span>{busy === k.id ? 'Sending...' : k.text}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
