// Referral + stickers on the web (docs/PLAN-social.md sections 1.4 and 3):
// - Village tab "Invite a friend": the invite link (Copy, Share on X), the rewards, the friends
//   invited (paid / waiting for their first harvest) and who invited you.
// - Village tab "Visitors": one row per visitor per day (stickers + watering on that row, Wave back,
//   Visit) and the waves back you got (Visit); Visit buttons for invited friends and the farmer who invited you.
// - Visiting a garden: "Sticker" opens the 6 template stickers (3 per garden per day, 5 s apart).
// Shown only when the server sends `referral` / `stickers` (older servers: nothing new appears).

import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type FriendAddView, type GameState, type ReferralView, type Species, type StickerKind, type StickerView, type VisitorView, type VisitResponse, type WaveView } from './api';
import { Avatar } from './art/avatars';
import { playSound } from './audio';
import { Modal } from './help';
import { OnlineAvatar, OnlineTag } from './online';
import { inviteLink, inviteOrigin, invitePost, stickerWaitS } from './referral';
import { postUrl } from './share';
import { Sprite, UiIcon, type SpriteName } from './sprites';
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

/** The 6 template stickers (same ids and text as the server's rules.ts STICKERS; wave back uses them). */
export const STICKER_KINDS: StickerKind[] = [
  { id: 'nice_garden', text: 'Nice garden!' },
  { id: 'great_durian', text: 'Great durian!' },
  { id: 'keep_it_up', text: 'Keep it up!' },
  { id: 'thanks_water', text: 'Thanks for the water!' },
  { id: 'gold_vibes', text: 'Gold vibes!' },
  { id: 'see_you', text: 'See you tomorrow!' },
];

const SPECIES_WORD: Record<Species, string> = { mango: 'mango', rambutan: 'rambutan', durian: 'durian' };

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

/**
 * The invite link (Copy, Share on X) and the rewards: the Village "Invite a friend" box and the
 * "Invite a friend" window (Farmers of Tandur, Profile) show the same thing.
 */
export function InviteLink({ state, notify }: { state: GameState; notify: Notify }) {
  const r = state.referral as ReferralView;
  const name = state.player.name;
  const link = inviteLink(inviteOrigin(import.meta.env.DEV, location.origin), name);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const copy = async () => {
    playSound('click');
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: select the link so the player can copy it by hand.
      input.current?.select();
      notify({ kind: 'info', text: 'Select the link and copy it by hand.' });
    }
  };
  const cut = r.rewards.referrerNow < r.rewards.referrer;
  return (
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
        <input ref={input} readOnly value={link} aria-label="Your invite link" onFocus={(e) => (e.target as HTMLInputElement).select()} />
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
    </>
  );
}

export const JUDGE_NO_INVITE = 'Judge gardens cannot invite friends. Make your own garden to get an invite link.';

/** "Invite a friend" window (Farmers of Tandur, Profile): the same link and rewards as the Village box. */
export function InviteWindow({ state, notify, onClose }: { state: GameState; notify: Notify; onClose: () => void }) {
  const r = state.referral as ReferralView;
  return (
    <Modal title="Invite a friend" onClose={onClose} closeLabel="Close" class="invite-dialog">
      {r.canInvite ? <InviteLink state={state} notify={notify} /> : <p class="muted small">{JUDGE_NO_INVITE}</p>}
    </Modal>
  );
}

/** Village tab: invite link + Share on X, rewards, friends invited and their status. */
export function InvitePanel({ state, notify, onVisit }: { state: GameState; notify: Notify; onVisit?: (name: string) => void }) {
  const r = state.referral as ReferralView;
  return (
    <Panel title="Invite a friend" class="invite-panel">
      {r.canInvite ? (
        <>
          <InviteLink state={state} notify={notify} />
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
                  {onVisit && (
                    <button class="btn btn-small btn-mint invite-visit" onClick={() => (playSound('click'), onVisit(f.name))} aria-label={`Visit ${f.name}'s garden`}>
                      Visit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p class="muted small">{JUDGE_NO_INVITE}</p>
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
          {onVisit && (
            <button class="btn btn-small btn-mint invite-by-visit" onClick={() => (playSound('click'), onVisit(r.invitedBy!.name))}>
              Visit {r.invitedBy.name}
            </button>
          )}
        </p>
      )}
    </Panel>
  );
}

/**
 * Village tab "Visitors". Servers from 2026-11-10 on: one row per visitor per village day ("budi
 * visited · today", the stickers they left that day and the tree they watered on the same row, and
 * Wave back), mixed with the waves back you got from gardens you visited. Older servers: the last
 * stickers, one row each.
 */
export function VisitorsPanel({
  state,
  onState,
  notify,
  onVisit,
  onAddBack,
}: {
  state: GameState;
  onState: (s: GameState) => void;
  notify: Notify;
  onVisit?: (name: string) => void;
  /** Add friend (servers from 2026-11-11 on): add back a garden that added you. */
  onAddBack?: (name: string) => Promise<void>;
}) {
  const [waving, setWaving] = useState<VisitorView | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  if (!state.visitors) return <StickerList stickers={state.stickers ?? []} />;
  type Row = { kind: 'visit'; at: number; v: VisitorView } | { kind: 'wave'; at: number; w: WaveView } | { kind: 'friend'; at: number; f: FriendAddView };
  const rows: Row[] = [
    ...state.visitors.map((v): Row => ({ kind: 'visit', at: v.at, v })),
    ...(state.waves ?? []).map((w): Row => ({ kind: 'wave', at: w.at, w })),
    ...(state.friendAdds ?? []).map((f): Row => ({ kind: 'friend', at: f.at, f })),
  ].sort((a, b) => b.at - a.at);
  const addBack = async (name: string) => {
    if (!onAddBack || adding) return;
    setAdding(name);
    try {
      await onAddBack(name);
    } finally {
      setAdding(null);
    }
  };
  return (
    <Panel title="Visitors" class="visitors-panel">
      {rows.length === 0 ? (
        <p class="muted small">No visitors yet. Farmers who visit your garden show up here, with the stickers they leave.</p>
      ) : (
        <ul class="list visitor-list" aria-label="Visitors and waves back">
          {rows.map((r) =>
            r.kind === 'friend' ? (
              <li key={`f${r.f.id}`} class="visitor-row friend-add-row">
                <OnlineAvatar id={r.f.avatar} size={32} online={r.f.online} />
                <span class="grow visitor-main">
                  <span class="visitor-line">
                    <b>{r.f.from}</b> added you as a friend · {whenText(r.f.at)}
                  </span>
                  <span class="visitor-did">
                    <span class="visitor-sticker">{r.f.title}</span>
                    {r.f.online && <OnlineTag />}
                  </span>
                </span>
                <span class="visitor-actions">
                  {r.f.mutual ? (
                    <button class="btn btn-small visitor-wave waved friend-done" disabled aria-label={`${r.f.from} is your friend`}>
                      Friends <UiIcon name="check" />
                    </button>
                  ) : (
                    onAddBack && (
                      <button class="btn btn-small btn-gold visitor-wave" disabled={!!adding} onClick={() => void addBack(r.f.from)}>
                        {adding === r.f.from ? 'Adding...' : 'Add back'}
                      </button>
                    )
                  )}
                  {onVisit && (
                    <button class="btn btn-small btn-mint visitor-visit" onClick={() => (playSound('click'), onVisit(r.f.from))} aria-label={`Visit ${r.f.from}'s garden`}>
                      Visit
                    </button>
                  )}
                </span>
              </li>
            ) : r.kind === 'visit' ? (
              <li key={`v${r.v.id}`} class="visitor-row">
                <Avatar id={r.v.avatar} size={32} />
                <span class="grow visitor-main">
                  <span class="visitor-line">
                    <b>{r.v.from}</b> visited · {whenText(r.v.at)}
                  </span>
                  {(r.v.stickers.length > 0 || r.v.watered) && (
                    <span class="visitor-did">
                      {r.v.stickers.map((k, i) => (
                        <span key={i} class="visitor-sticker">
                          <StickerIcon id={k.id} scale={1} /> {k.text}
                        </span>
                      ))}
                      {r.v.watered && (
                        <span class="visitor-sticker visitor-watered">
                          <Sprite name="droplet" scale={1} /> watered your {SPECIES_WORD[r.v.watered]}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <span class="visitor-actions">
                  {r.v.wave ? (
                    <button class="btn btn-small visitor-wave waved" disabled aria-label={`You waved back to ${r.v.from}: ${r.v.wave.text}`}>
                      <StickerIcon id={r.v.wave.id} scale={1} /> Waved
                    </button>
                  ) : r.v.canWave ? (
                    <button class="btn btn-small btn-gold visitor-wave" onClick={() => (playSound('click'), setWaving(r.v))}>
                      Wave back
                    </button>
                  ) : (
                    <button class="btn btn-small visitor-wave waved" disabled title={`You waved back to ${r.v.from} today`}>
                      Waved
                    </button>
                  )}
                  {onVisit && (
                    <button class="btn btn-small btn-mint visitor-visit" onClick={() => (playSound('click'), onVisit(r.v.from))} aria-label={`Visit ${r.v.from}'s garden`}>
                      Visit
                    </button>
                  )}
                </span>
              </li>
            ) : (
              <li key={`w${r.w.id}`} class="visitor-row wave-row">
                <Avatar id={r.w.avatar} size={32} />
                <span class="grow visitor-main">
                  <span class="visitor-line">
                    <b>{r.w.from}</b> waved back · {whenText(r.w.at)}
                  </span>
                  <span class="visitor-did">
                    <span class="visitor-sticker">
                      <StickerIcon id={r.w.sticker} scale={1} /> {r.w.text}
                    </span>
                  </span>
                </span>
                {onVisit && (
                  <span class="visitor-actions">
                    <button class="btn btn-small btn-mint visitor-visit" onClick={() => (playSound('click'), onVisit(r.w.from))} aria-label={`Visit ${r.w.from}'s garden`}>
                      Visit
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {/* On the page itself: inside the panel other panels (and the laptop drawer) would cover it. */}
      {waving && createPortal(<WaveWindow visitor={waving} kinds={STICKER_KINDS} onClose={() => setWaving(null)} onState={onState} notify={notify} />, document.body)}
    </Panel>
  );
}

/** Older servers: the last stickers visitors left (one row each). */
function StickerList({ stickers }: { stickers: StickerView[] }) {
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

export type StickerStatus = ReturnType<typeof useStickerStatus>;

/**
 * What the viewer may still do in a visited garden today: stickers sent / allowed (3; servers
 * before 2026-11-10: 1) and the seconds to wait before the next one (5 s apart).
 *
 * ONE countdown per visit (Ardian's phone test, 2026-11-10): `readyAt` is fixed once, when the
 * server's answer arrives (`stickerReadyAt`; the server counts from the last sticker it stored), and
 * the visit owns it. Before, every window computed "now + wait" again when it opened, so the
 * window and the button showed two countdowns and reopening the window restarted the wait. After a
 * refresh or a tab switch the visit is opened again and the server sends the time still left.
 * `readyAt` comes from `stickerReadyAt` (referral.ts).
 */
export function useStickerStatus(visit: VisitResponse | null, readyAt: number) {
  const sent = visit ? (visit.stickersToday ?? (visit.stickerToday ? [visit.stickerToday] : [])) : [];
  const max = visit?.stickerMax ?? 1;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (readyAt <= Date.now()) return setNow(Date.now());
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= readyAt) window.clearInterval(t);
    }, 250);
    return () => window.clearInterval(t);
  }, [readyAt]);
  const full = sent.length >= max;
  return { sent, max, full, waitS: full ? 0 : stickerWaitS(readyAt, now) };
}

/** The pick-a-sticker window (6 template stickers): visiting (leave one) and Visitors (wave back). */
function StickerPicker({
  title,
  intro,
  kinds,
  marked,
  disabled,
  busy,
  label,
  onPick,
  onClose,
}: {
  title: string;
  intro: string;
  kinds: StickerKind[];
  /** Stickers already sent (marked with the mint "sent" look). */
  marked: string[];
  disabled: boolean;
  busy: string | null;
  label: (k: StickerKind) => string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} closeLabel="Close" class="sticker-dialog">
      <p class="small">{intro}</p>
      <div class="sticker-grid" role="list">
        {kinds.map((k) => (
          <button
            key={k.id}
            role="listitem"
            class={`sticker-pick${marked.includes(k.id) ? ' sent' : ''}`}
            disabled={disabled || !!busy}
            onClick={() => onPick(k.id)}
            aria-label={label(k)}
          >
            <StickerIcon id={k.id} scale={3} />
            <span>{busy === k.id ? 'Sending...' : k.text}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Visiting: the 6 template stickers; up to 3 per garden a day, 5 s apart. */
export function StickerWindow({
  name,
  visit,
  status,
  onClose,
  onSent,
  notify,
}: {
  name: string;
  visit: VisitResponse;
  /** The visit's sticker status (the only countdown: it shows on the Sticker button). */
  status: StickerStatus;
  onClose: () => void;
  onSent: (v: VisitResponse) => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const { sent, max, full, waitS } = status;
  const kinds: StickerKind[] = visit.stickers ?? [];
  const send = async (id: string) => {
    if (busy || full || waitS > 0) return;
    setBusy(id);
    playSound('click');
    try {
      const r = await api<{ result: { text: string; owner: string; sent?: number; max?: number }; visit: VisitResponse }>(
        'POST',
        `/api/farmers/${encodeURIComponent(name)}/sticker`,
        { sticker: id },
      );
      onSent(r.visit);
      playSound('plant');
      const left = r.result.max && r.result.sent ? r.result.max - r.result.sent : 0;
      notify({ kind: 'success', text: `You left "${r.result.text}" for ${r.result.owner}.${left > 0 ? ` ${left} more today.` : ''}` });
      onClose();
    } catch (e) {
      playSound('error');
      notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      // The wait or the count may have changed: show the visit as the server has it.
      void api<VisitResponse>('GET', `/api/farmers/${encodeURIComponent(name)}`).then(onSent).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };
  const intro = full
    ? `You left ${max} sticker${max === 1 ? '' : 's'} for ${name} today. Come back tomorrow!`
    : waitS > 0
      ? // No second countdown here: the Sticker button counts down.
        `Your next sticker is ready in a moment (${sent.length}/${max} today).`
      : `Pick one for ${name}. Up to ${max} sticker${max === 1 ? '' : 's'} per garden a day${sent.length ? ` (${sent.length}/${max} sent)` : ''}.`;
  return (
    <StickerPicker
      title="Leave a sticker"
      intro={intro}
      kinds={kinds}
      marked={sent}
      disabled={full || waitS > 0}
      busy={busy}
      label={(k) => (sent.includes(k.id) ? `${k.text} (sent today)` : `Leave "${k.text}"`)}
      onPick={(id) => void send(id)}
      onClose={onClose}
    />
  );
}

/** Wave back: the owner sends one template sticker to a visitor (1 per visitor per day). */
export function WaveWindow({
  visitor,
  kinds,
  onClose,
  onState,
  notify,
}: {
  visitor: VisitorView;
  kinds: StickerKind[];
  onClose: () => void;
  onState: (s: GameState) => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (id: string) => {
    if (busy) return;
    setBusy(id);
    playSound('click');
    try {
      const r = await api<{ result: { text: string; visitor: string }; state: GameState }>('POST', `/api/visitors/${visitor.id}/wave`, { sticker: id });
      onState(r.state);
      playSound('plant');
      notify({ kind: 'success', text: `You waved back to ${r.result.visitor}: "${r.result.text}"` });
      onClose();
    } catch (e) {
      playSound('error');
      notify({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <StickerPicker
      title="Wave back"
      intro={`Send ${visitor.from} a sticker. They see it without visiting you. One wave back per visitor a day.`}
      kinds={kinds}
      marked={[]}
      disabled={false}
      busy={busy}
      label={(k) => `Wave back to ${visitor.from} with "${k.text}"`}
      onPick={(id) => void send(id)}
      onClose={onClose}
    />
  );
}
