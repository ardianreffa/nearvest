import { explorerTarget } from './ext-link';
// Arena v2 "lite" (docs/PLAN-arena.md section 7, Ardian 2026-11-11): the duel screen of a turn-based
// match against the other garden's TaniBot, and its row in the lists. Every turn the player taps
// Rock / Paper / Scissors (or the Gold Durian when the skill bar is full); the server decides the
// turn with the TaniBot's pick that it locked before (server/src/arena-match.ts) and the web plays it
// back: both picks pop up above the two TaniBots (so the player sees why), then the v1 Fruit Fight
// throw / hit or a dodge; the last turn ends with K.O.! (or TIME UP! after 15 turns) and the result.
// Light on phones: the screen is drawn again only when the turn's frame changes; motion is CSS.

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, apiKeepalive, type Activity, type ArenaPick, type GameState, type MatchSummary, type MatchView, type Rps } from './api';
import { Fighter, FighterHud, FlyingFruit, hitSound, reducedMotion } from './arena';
import { flightMs, fmt, hitFlash, HIT_FLASH_MS, seasonLine } from './arena-play';
import {
  asMine,
  bonusLine,
  clockOf,
  controls,
  countdown,
  endBanner,
  foeLabel,
  fruitName,
  inviteNote,
  matchLine,
  matchPost,
  matchReward,
  matchDraw,
  matchWon,
  PICK_LABEL,
  pickBubbles,
  turnAt,
  turnBanner,
  turnLength,
  turnLine,
  turnReason,
  type TurnClock,
  type TurnFrame,
} from './arena-turn';
import { Avatar } from './art/avatars';
import { DuelBackdrop } from './art/duel-backdrop';
import { playGoldDurian, playSound, setArenaMusic } from './audio';
import { confetti } from './fx';
import { PUBLIC_SITE } from './referral';
import { postUrl } from './share';
import { GoldDurian, Sprite, UiIcon } from './sprites';
import { useFullscreen } from './fullscreen';
import { Coin } from './ui';
import { AudioButtons } from './audio-buttons';

const KO_MS = 1300;
const CELEBRATE_MS = 1400;
/** The server takes picks a little after the 10 s (slow networks); after that the web asks for the decided turn. */
const AFTER_DEADLINE_MS = 1_800;
/** Also asked now and then while the duel is open (another tab, a long pause). */
const POLL_MS = 15_000;
/** Online duel (and its invite): both webs ask every second (one small row; the server measures who is gone). */
const LIVE_POLL_MS = 1_000;
const isOpen = (s: MatchView['status']) => s === 'invite' || s === 'playing' || s === 'paused';
const isOver = (s: MatchView['status']) => s === 'done' || s === 'cancelled';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "today" / "yesterday" / "3 days ago". */
function ago(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * The Gold Durian on the stage (Ardian 2026-11-11: it must feel huge, about 3 s): the screen darkens,
 * speed lines, a big "GOLD DURIAN!" slams in; the thrower charges up (Fighter "charging"); a giant
 * gold durian falls from the sky like a meteor with a gold fire tail, slowing down just before it
 * hits; then a white-gold flash, a ring-shaped shock wave, a hard shake, gold shards and the big
 * damage number. Motion = transform / opacity (light on phones). Reduced motion: a short version
 * without shake and flash. Pixel art (the durian) keeps its own colours; the rest uses tokens.
 */
function GoldStageFx({ frame, reduced }: { frame: TurnFrame; reduced: boolean }) {
  return (
    <div class={`gold-stage phase-${frame.phase}${reduced ? ' still' : ''}`} aria-hidden="true">
      <i class="gold-dim" />
      {!reduced && (
        <span class="speed-lines">
          {Array.from({ length: 10 }, (_, k) => (
            <i key={k} style={`--a:${k * 36}deg;--d:${(k % 3) * 70}ms`} />
          ))}
        </span>
      )}
      <b class="gold-title">GOLD DURIAN!</b>
    </div>
  );
}

function GoldFloorFx({ frame, wide, reduced }: { frame: TurnFrame; wide: boolean; reduced: boolean }) {
  const hit = frame.hit!;
  const at = hit.from === 'me' ? 'them' : 'me';
  return (
    <div class={`gold-floor at-${at} phase-${frame.phase}${reduced ? ' still' : ''}`} aria-hidden="true">
      {(frame.phase === 'meteor' || reduced) && (
        <span class="gold-meteor">
          {!reduced && <i class="meteor-tail" />}
          <GoldDurian scale={wide ? 16 : 9} />
        </span>
      )}
      {frame.phase === 'impact' && (
        <>
          {!reduced && <i class="gold-flash" />}
          {!reduced && <i class="gold-wave" />}
          {!reduced &&
            Array.from({ length: 10 }, (_, k) => <i key={k} class="gold-shard" style={`--a:${k * 36 + 10}deg;--r:${(k % 3) * 0.25 + 0.75}`} />)}
          <b class="gold-damage">-{hit.damage}</b>
        </>
      )}
    </div>
  );
}

/** The 10 s turn clock (numbers from the server; red and pulsing in the last 3 s). */
function TurnTimer({ clock, now }: { clock: TurnClock; now: number }) {
  const c = countdown(clock, now);
  const pct = c.started ? Math.max(0, Math.min(100, ((clock.endsAt - now) / (clock.endsAt - clock.startsAt)) * 100)) : 100;
  return (
    <div class={`turn-timer${c.urgent ? ' urgent' : ''}`} role="timer" aria-live="off" aria-label={`${c.secs} seconds to pick`}>
      <b class="turn-secs" key={c.urgent ? c.secs : 'calm'}>
        {c.secs}
      </b>
      <span class="turn-bar">
        <i style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** A finished match in Recent duels / the Village Arena box. */
export function MatchRow({ m, onRematch, busy }: { m: MatchSummary; onRematch?: () => void; busy: boolean }) {
  const them = m.you === 'challenger' ? m.defender : m.challenger;
  return (
    <li class={`farmer-row arena-row${matchWon(m) ? ' won' : ' lost'}`}>
      <Avatar id={them.avatar} size={28} />
      <span class="grow farmer-main">
        <b class="arena-row-line">{matchLine(m)}</b>
        <span class="farmer-meta">
          {ago(m.endedAt ?? m.at)} · {m.turnCount ?? 0} turns
          {m.prize > 0 && m.you === 'challenger' && ` · +${fmt(m.prize)} PANEN`}
          {m.practice && ' · practice'}
          {m.txUrl && (
            <>
              {' · '}
              <a href={m.txUrl} {...explorerTarget()}>
                tx
              </a>
            </>
          )}
        </span>
      </span>
      {onRematch && (
        <span class="arena-row-actions">
          <button class="btn btn-small btn-gold" disabled={busy} onClick={onRematch}>
            Rematch
          </button>
        </span>
      )}
    </li>
  );
}

/** Dev builds: window.__turnT = <ms> freezes the playing turn at that moment (screenshots, tools/ui-test.mjs). */
const devT = () => (import.meta.env.DEV ? (window as unknown as { __turnT?: number }).__turnT : undefined);
/** Dev builds: window.__clockNow = <ms> freezes the turn clock that many ms after its start (screenshots). */
const devClock = () => (import.meta.env.DEV ? (window as unknown as { __clockNow?: number }).__clockNow : undefined);

/**
 * The v2 duel screen. `initial` is the match from the server (new or resumed). `onDone` gets the
 * game state once the match is over (prize, XP, duels left).
 */
/** The opening show's length (CSS .duel-intro). */
const INTRO_MS = 1800;

export function MatchScreen({
  initial,
  wide,
  activity,
  season,
  fraction,
  onDone,
  onClose,
}: {
  initial: MatchView;
  wide: boolean;
  activity: Activity[];
  season?: { number: number; divisor: number; rewardPercent: number };
  /** The village clock (0 = 07:00 WIB), as in the garden: the arena's day / dusk / night follow it. */
  fraction: number;
  onDone: (state: GameState, titleUp: string | null) => void;
  onClose: () => void;
}) {
  const reduced = reducedMotion();
  // While the duel is open the garden's village behind it stands still (one moving village, light on phones).
  useEffect(() => {
    document.documentElement.classList.add('duel-open');
    return () => document.documentElement.classList.remove('duel-open');
  }, []);
  const [m, setMatch] = useState<MatchView>(() => asMine(initial));
  /** The turn clock on this device, set from every answer (the server decides; this only shows it). */
  const [clock, setClock] = useState<TurnClock | null>(() => clockOf(initial, Date.now()));
  /** When the last answer arrived (local clock): the invite / pause countdowns count from it. */
  const [answeredAt, setAnsweredAt] = useState(() => Date.now());
  /** Why an online duel became a TaniBot duel ("budi said no..."), until the first turn is decided. */
  const [note, setNote] = useState<string | null>(() => inviteNote(initial));
  /** The decided turn being played back (index into m.turns) and when it started. */
  const [anim, setAnim] = useState<{ i: number; t0: number } | null>(null);
  /** The end: K.O.!, the celebration, then the result. */
  const [end, setEnd] = useState<number | null>(isOver(initial.status) ? -Infinity : null);
  const [sending, setSending] = useState<ArenaPick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Laptops: the browser fullscreen button, as at the pond (2026-11-12).
  const fullscreen = useFullscreen();
  // The opening show before turn 1 (2026-11-12): both TaniBots run in from the sides, "VS", then
  // "FIGHT!" (~1.8 s). Only a picture on top: the turn clock and the buttons are not held up.
  const [introAt, setIntroAt] = useState(0);
  const introShown = useRef(false);
  const introTimer = useRef<number>();
  const [, setTick] = useState('');
  const mRef = useRef(m);
  useEffect(() => {
    if (introShown.current || reduced || m.status !== 'playing' || m.turns.length > 0) return;
    introShown.current = true;
    setIntroAt(Date.now());
    // Not cleared when the first turn comes quickly (that left "VS / FIGHT!" on screen after every
    // turn); only when the duel closes.
    introTimer.current = window.setTimeout(() => setIntroAt(0), INTRO_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.status, m.turns.length]);
  useEffect(() => () => window.clearTimeout(introTimer.current), []);
  mRef.current = m;
  const asking = useRef(false);

  /** A new answer from the server: the match, its clock, and the newly decided turn to play back. */
  const take = (raw: MatchView, state?: GameState, titleUp?: string | null) => {
    const next = asMine(raw);
    const prev = mRef.current;
    const before = prev.turns.length;
    mRef.current = next;
    setMatch(next);
    setClock(clockOf(next, Date.now()));
    setAnsweredAt(Date.now());
    if (prev.status === 'invite' && next.status !== 'invite') setNote(inviteNote(next));
    // Several turns may have been decided while away: the last one is played back.
    if (next.turns.length > before) setAnim({ i: next.turns.length - 1, t0: Date.now() });
    else if (isOver(next.status) && !isOver(prev.status)) {
      // Online duel cancelled or won because the other player left: straight to the result (no K.O.).
      const quiet = next.status === 'cancelled' || (next.kind === 'live' && (next.endReason === 'left' || next.endReason === 'abandoned'));
      setEnd(quiet ? -Infinity : Date.now());
    }
    if (state) onDone(state, titleUp ?? null);
  };

  const ask = () => {
    if (asking.current) return;
    asking.current = true;
    api<{ match: MatchView; state?: GameState; titleUp?: string | null }>('GET', `/api/arena/match/${mRef.current.id}`)
      .then((r) => take(r.match, r.state, r.titleUp))
      .catch(() => undefined)
      .finally(() => (asking.current = false));
  };

  // Now and then while the duel is open (another tab, a long pause).
  // Online duel and its invite: every second, so each side sees the other's moves and the server
  // knows who is still here (a web gone for 5 s pauses the duel).
  const live = m.kind === 'live' || m.status === 'invite';
  useEffect(() => {
    if (!isOpen(m.status)) return;
    const id = window.setInterval(ask, live ? LIVE_POLL_MS : POLL_MS);
    return () => window.clearInterval(id);
  }, [m.id, m.status, live]);
  // The invite / pause countdowns tick on screen.
  useEffect(() => {
    if (m.status !== 'invite' && m.status !== 'paused') return;
    const id = window.setInterval(() => setTick(String(Math.floor(Date.now() / 250))), 250);
    return () => window.clearInterval(id);
  }, [m.status]);
  // Online duel: closing the page counts as leaving (the other side waits 20 s; back in time = it goes on).
  useEffect(() => {
    if (m.kind !== 'live' && m.status !== 'invite') return;
    const bye = () => apiKeepalive(`/api/arena/match/${mRef.current.id}/leave`, {});
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [m.kind, m.status === 'invite']);

  // The countdown: drawn about 5 times a second while the player can pick; when the 10 s (and the
  // server's grace) are over without a pick, the web asks for the turn the server decided.
  const idle = m.status === 'playing' && !anim && !sending;
  useEffect(() => {
    if (!idle || !clock) return;
    const id = window.setInterval(() => {
      setTick(String(Math.floor(Date.now() / 200)));
      if (devClock() === undefined && Date.now() >= clock.endsAt + AFTER_DEADLINE_MS) ask();
    }, 200);
    return () => window.clearInterval(id);
  }, [idle, clock]);

  // Time of the playing turn (or the end), drawn again only when the frame changes.
  const now = () => Date.now();
  const tTurn = () => (anim ? (devT() ?? now() - anim.t0) : 0);
  const frame = anim ? turnAt(m, anim.i, tTurn(), reduced) : null;
  const frameKey = (f: TurnFrame | null) => (f ? `${f.phase}|${f.hit?.index}|${f.hp}|${f.phase === 'impact' && f.sinceImpact < HIT_FLASH_MS}|${f.sinceImpact < 350}|${f.sinceImpact < 1000}` : '');
  const endT = end === null ? null : end === -Infinity ? Infinity : now() - end;
  const endPhase = endT === null ? null : endT < KO_MS ? 'ko' : endT < KO_MS + CELEBRATE_MS ? 'celebrate' : 'result';
  useEffect(() => {
    if (!anim && (end === null || endPhase === 'result')) return;
    const id = window.setInterval(() => {
      const f = anim ? turnAt(mRef.current, anim.i, tTurn(), reduced) : null;
      setTick(`${anim?.i}|${frameKey(f)}|${end !== null ? Math.floor((now() - (end === -Infinity ? 0 : end)) / 100) : ''}`);
      if (anim && devT() === undefined && now() - anim.t0 >= turnLength(mRef.current.turns[anim.i], reduced)) {
        setAnim(null);
        if (mRef.current.status === 'done') setEnd(now());
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [anim, end, endPhase]);


  // Sounds and confetti, once per event.
  const event = frame ? `${anim!.i}:${frame.phase}:${frame.hit?.index}` : `end:${endPhase}`;
  const won = matchWon(m);
  useEffect(() => {
    if (frame?.phase === 'reveal') playSound('click');
    if (frame?.phase === 'charge') playGoldDurian('charge');
    if (frame?.phase === 'meteor') playGoldDurian('fall');
    if (frame?.phase === 'impact' && frame.hit) frame.hit.gold ? playGoldDurian('impact') : playSound(hitSound(frame.hit));
    if (endPhase === 'ko' && endT !== Infinity) playSound('momentEvolve');
    if (endPhase === 'celebrate' && won) confetti(36);
    if (endPhase === 'result' && end !== -Infinity && end !== null) playSound(won ? 'levelup' : 'click');
  }, [event]);

  const pick = async (p: ArenaPick) => {
    if (sending || anim || m.status !== 'playing' || m.myPick) return;
    playSound('click');
    setSending(p);
    setError(null);
    try {
      const r = await api<{ match: MatchView; state?: GameState; titleUp?: string | null }>('POST', `/api/arena/match/${m.id}/pick`, { turn: m.turn, pick: p });
      take(r.match, r.state, r.titleUp);
    } catch (e) {
      playSound('error');
      setError(errorText(e));
      // The turn may have moved on (another tab): read the match again.
      if (e instanceof ApiError && e.status === 409) ask();
    } finally {
      setSending(null);
    }
  };

  const me = m.challenger;
  const them = m.defender;
  const foe = foeLabel(m);
  const isLive = m.kind === 'live';
  /** Leaves the duel screen. Invite: cancelled. Online duel: the other side waits 20 s for you. */
  const leave = () => {
    if (isLive || m.status === 'invite') void api('POST', `/api/arena/match/${m.id}/leave`, {}).catch(() => undefined);
    onClose();
  };
  /** "Fight budi's TaniBot now" while waiting for an answer. */
  const skipInvite = () => {
    playSound('click');
    api<{ match: MatchView }>('POST', `/api/arena/match/${m.id}/decline`, {})
      .then((r) => take(r.match))
      .catch((e) => setError(errorText(e)));
  };
  const secsLeft = (ms: number | undefined) => Math.max(0, Math.ceil(((ms ?? 0) - (now() - answeredAt)) / 1000));
  const last = anim ? m.turns[anim.i] : m.turns[m.turns.length - 1];
  const done = endPhase === 'result';
  // The Arena's own music from after "VS / FIGHT!" until the result; Tandur's music waits while the
  // duel screen is open and comes back when it closes (audio.ts setArenaMusic).
  const fighting = !introAt && !done && (m.status === 'playing' || m.status === 'paused');
  useEffect(() => setArenaMusic(true, fighting), [fighting]);
  useEffect(() => () => setArenaMusic(false, false), []);
  const over = isOver(m.status) && !anim;
  // A draw (both K.O. in one turn, servers from 2026-11-13) has no winner either, but both TaniBots fall.
  const draw = matchDraw(m);
  const noWinner = !draw && (m.status === 'cancelled' || m.winner === null);
  // Life and skill shown: the playing turn's frame, else the match now.
  const hp: [number, number] = frame ? frame.hp : [m.hp.c, m.hp.d];
  const skill: [number, number] = frame ? frame.skill : [m.skill.c, m.skill.d];
  const gold = !!frame?.hit?.gold && (frame.phase === 'charge' || frame.phase === 'meteor' || frame.phase === 'impact');
  const heavy = (f: TurnFrame | null) => !!f?.hit && (f.hit.gold || f.hit.fruit.species === 'durian');
  const hitShown = frame?.phase === 'impact' && frame.sinceImpact < 1000;
  const flash = !!hitShown && hitFlash(frame!.sinceImpact);
  const pose = (who: 'me' | 'them') => {
    if (over && endPhase !== null) {
      if (draw) return 'ko';
      if (noWinner) return 'idle';
      const loser = won ? 'them' : 'me';
      return who === loser ? 'ko' : endPhase === 'ko' ? 'idle' : 'win';
    }
    if (!frame) return 'idle';
    if (frame.phase === 'dodge') return 'dodge';
    if (!frame.hit) return 'idle';
    if (frame.phase === 'charge' && frame.hit.from === who) return 'charging';
    if ((frame.phase === 'windup' || frame.phase === 'flight') && frame.hit.from === who) return 'windup';
    if (hitShown && frame.hit.from !== who) return 'hit';
    return 'idle';
  };
  // The picks above the heads (arena-turn.ts pickBubbles): "?" over both at the start of every turn,
  // your own pick as soon as you tap it, both opened together when the turn is decided.
  const bubbles = pickBubbles(m, { sending, anim: anim ? { i: anim.i, reveal: !!frame && frame.phase === 'reveal' } : null, gold, result: done });
  const bubble = (who: 'me' | 'them') => (who === 'me' ? bubbles.me : bubbles.them);
  const shake =
    reduced || frame?.phase !== 'impact'
      ? ''
      : frame.hit?.gold && frame.sinceImpact < 600
        ? ' shake mega'
        : frame.sinceImpact < 350
          ? heavy(frame)
            ? ' shake hard'
            : ' shake'
          : '';
  // The Gold Durian button follows the bar on screen (it fills when the hit lands).
  const ctl = controls({ ...m, skill: { c: skill[0], d: skill[1] } }, !!sending || !!anim);
  // Full screen (2026-11-12): taller laptop screens get bigger TaniBots (whole, even pixel scales).
  const scale = wide ? Math.max(4, 2 * Math.floor(window.innerHeight / 380)) : 2;
  // The TaniBots' feet line (px from the stage's top), from the arena picture: they stand on its ring,
  // above the floating dock (art/duel-backdrop.tsx arenaFullFit).
  const [feet, setFeet] = useState<number | null>(null);
  // Glides (result panel) only after the first placement, never from the first frame.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (feet === null || settled) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [feet]);
  const reward = matchReward(m);
  const job = m.prize > 0 && m.you === 'challenger' ? activity.find((a) => a.note === 'arena' && a.createdAt >= m.at - 2000) : undefined;
  const txUrl = m.txUrl ?? job?.explorerUrl ?? null;
  const paid = m.prize > 0 && m.you === 'challenger' && !txUrl;
  const pending = paid && (!job || job.status === 'pending');
  // The banner of the turn: after the picks pop up, while the hits play (the Gold Durian has its own title).
  const banner = frame && frame.phase !== 'reveal' && last && !gold ? turnBanner(last, them.name, isLive) : null;
  const clockNow = clock && devClock() !== undefined ? clock.startsAt + devClock()! : now();

  return (
    <div class="dialog-backdrop duel-backdrop full" role="presentation">
      {/* Full screen like the fishing pond (2026-11-12): the arena fills the screen, names and life
          bars on top, a compact dock at the bottom (turn clock, Gold Durian, Rock / Paper / Scissors). */}
      <div class={`duel match panel full${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={`Arena duel: ${me.name} vs ${foe}`}>
        <header class="panel-head duel-head">
          <h2>FRUIT FIGHT</h2>
          {/* Music and Sound, the same switches as the village HUD (Ardian 2026-11-13). */}
          <AudioButtons class="duel-audio" />
          {fullscreen.supported && wide && (
            <button class="icon-btn duel-fullscreen" onClick={fullscreen.toggle} aria-label={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}>
              <Sprite name={fullscreen.active ? 'fullscreenExit' : 'fullscreen'} scale={3} />
            </button>
          )}
          {/* No Skip (Ardian 2026-11-13): every turn's show is short; the duel runs on by itself. */}
          <button
            class="icon-btn info-close"
            onClick={() => (m.status === 'playing' || m.status === 'paused' ? setLeaving(true) : leave())}
            aria-label={m.status === 'playing' || m.status === 'paused' ? 'Leave the duel' : m.status === 'invite' ? 'Cancel the challenge' : 'Close'}
          >
            x
          </button>
        </header>

        <div class={`fight-stage with-village${shake}${reduced ? ' still' : ''}${gold ? ' gold-on' : ''}${feet === null ? '' : ' has-feet'}${settled ? ' settled' : ''}`} style={feet === null ? undefined : { '--feet': `${feet}px` }}>
          <DuelBackdrop fraction={fraction} wide={wide} onFeet={setFeet} hold={over} />
          {gold && frame && <GoldStageFx frame={frame} reduced={reduced} />}
          <div class="fight-hud">
            <FighterHud side={me} hp={hp[0]} right={false} skill={{ n: skill[0], max: m.skillMax }} />
            <div class="fight-score">
              <span class="duel-vs">VS</span>
            </div>
            {/* Their TaniBot's name AND its title (its look comes from the title). */}
            <FighterHud side={them} hp={hp[1]} right skill={{ n: skill[1], max: m.skillMax }} bot={!isLive} />
          </div>
          <div class={`fight-floor${introAt ? ' intro' : ''}`} style={`--bot-w:${58 * scale}px;--bot-h:${64 * scale}px`}>
            <Fighter side={me} right={false} scale={scale} state={pose('me')} hard={heavy(frame)} pick={bubble('me')} flash={flash} />
            {!reduced && frame?.hit && !frame.hit.gold && frame.phase === 'flight' && (
              <FlyingFruit fruit={frame.hit.fruit} from={frame.hit.from} ms={flightMs(frame.hit.fruit)} hitKey={`${anim!.i}-${frame.hit.index}`} big={wide} />
            )}
            {hitShown && !frame!.hit!.gold && (
              <span
                key={`burst-${anim!.i}-${frame!.hit!.index}`}
                class={`hit-burst at-${frame!.hit!.from === 'me' ? 'them' : 'me'}${heavy(frame) ? ' hard' : ''} q-${frame!.hit!.fruit.quality}`}
                aria-hidden="true"
              />
            )}
            {gold && frame && (frame.phase === 'meteor' || frame.phase === 'impact') && <GoldFloorFx key={`gold-${anim!.i}-${frame.hit!.index}-${frame.phase}`} frame={frame} wide={wide} reduced={reduced} />}
            <Fighter side={them} right scale={scale} state={pose('them')} hard={heavy(frame)} pick={bubble('them')} flash={flash} />
          </div>
          {introAt > 0 && !anim && (
            <div class="duel-intro" key={introAt} aria-hidden="true">
              <span class="duel-intro-vs">VS</span>
              <span class="duel-intro-fight">FIGHT!</span>
            </div>
          )}
          {banner && (
            <div class="fight-banner turn-banner" key={`banner-${anim?.i}`}>
              {banner}
            </div>
          )}
          {(endPhase === 'ko' || endPhase === 'celebrate') && endT !== Infinity && <div class="fight-ko">{endBanner(m)}</div>}
          {m.status === 'paused' && m.waitingFor && !anim && (
            <div class="match-wait" role="status" aria-live="polite">
              <b>Waiting for {m.waitingFor}...</b>
              <span class="match-wait-secs">{secsLeft(m.pauseLeftMs)}</span>
              <small>If {m.waitingFor} does not come back, you win.</small>
            </div>
          )}
        </div>

        {/* The dock floats over the arena's floor in a see-through panel (Ardian 2026-11-12): turn text
            and buttons, the invite, or the result. Its height never changes between turns. */}
        <div class="match-dock">
        <div class={`match-dock-panel${done ? ' is-result' : ''}`}>
        {!done && m.status === 'invite' && (
          <div class="match-invite" role="status" aria-live="polite">
            <p class="match-invite-line">
              Waiting for <b>{them.name}</b> to accept... <span class="match-wait-secs">{secsLeft(m.inviteLeftMs)}</span>
            </p>
            <p class="match-invite-hint">No answer in time? You fight {them.name}'s TaniBot instead.</p>
            <div class="duel-actions">
              <button class="btn btn-gold" onClick={skipInvite}>
                Fight {them.name}'s TaniBot now
              </button>
              <button class="btn" onClick={leave}>
                Cancel
              </button>
            </div>
            {error && <p class="error-text match-error">{error}</p>}
          </div>
        )}

        {!done && m.status !== 'invite' && (
          <div class={`match-info${over ? ' over' : ''}`} aria-live="polite">
            {note && m.turns.length === 0 && last && <p class="match-note">{note}</p>}
            <p class="match-turn">{turnLine(m, !!sending, anim?.i)}</p>
            {/* Before turn 1 the same two-line slot holds the opening note (e.g. "said no: you fight
                their TaniBot!"), so the dock keeps its height. */}
            {!last && <p class={`match-why${note ? ' match-note' : ''}`}>{note ?? ''}</p>}
            {last && (
              <p class="match-why">
                {/* A new turn is open: the line is about the turn before (its picks are hidden again). */}
                {!anim && (m.status === 'playing' || m.status === 'paused') ? 'Last turn: ' : ''}
                {turnReason(last, them.name, isLive)}
                {/* The damage only once the fruit has landed. */}
                {(!frame || frame.phase === 'impact' || frame.phase === 'done') &&
                  last.hits.map((h, k) => (
                    <span key={k}>
                      {' '}
                      {h.to === 'defender' ? 'You hit' : 'You got hit'} with a {fruitName(h.fruit)}: -{h.damage}.
                    </span>
                  ))}
              </p>
            )}
            <p class="match-bonus">{bonusLine(m)}</p>
          </div>
        )}

        {/* At K.O. the buttons go and the dock shrinks to its text; the arena and TaniBots hold their
            place (DuelBackdrop hold), they only move up for the taller result panel. */}
        {!over && m.status !== 'invite' && (
          <div class="match-controls">
            {/* The timer's row is always there (hidden between turns), so the dock never changes height. */}
            {idle && clock ? (
              <TurnTimer clock={clock} now={clockNow} />
            ) : (
              <div class="turn-timer turn-timer-slot" aria-hidden="true">
                <b class="turn-secs">10</b>
                <span class="turn-bar" />
              </div>
            )}
            <button
              class={`btn gold-durian-btn${ctl.goldLit ? ' lit' : ''}`}
              disabled={!ctl.gold}
              onClick={() => pick('gold')}
              aria-label={ctl.goldLit ? 'Throw the Gold Durian' : `Gold Durian: win ${m.skillMax} turns to fill the skill bar (${ctl.skill})`}
            >
              <GoldDurian scale={wide ? 3 : 2} class="gold-durian-icon" />
              {/* Laptops: one line; phones: two short lines, so all four buttons fit in one row. */}
              <span class="gd-label">{ctl.goldLit ? <><span>GOLD</span> <span>DURIAN!</span></> : <><span>Gold Durian</span> <span>{ctl.skill}</span></>}</span>
            </button>
            <div class="rps-row" role="group" aria-label="Your move">
              {(['rock', 'paper', 'scissors'] as Rps[]).map((p) => (
                <button key={p} class={`btn rps-btn${sending === p ? ' picked' : ''}`} disabled={!ctl.rps} onClick={() => pick(p)}>
                  <UiIcon name={p} scale={2} />
                  <span>{PICK_LABEL[p]}</span>
                </button>
              ))}
            </div>
            {error && <p class="error-text match-error">{error}</p>}
          </div>
        )}

        {done && (
          <div class={`duel-result${won ? ' win' : draw ? ' draw' : ' lose'}`}>
            <div class="duel-headline">{m.status === 'cancelled' ? 'CANCELLED' : draw ? 'DRAW' : noWinner ? 'NO WINNER' : won ? 'YOU WIN!' : isLive ? `${them.name.toUpperCase()} WINS` : 'YOU LOSE'}</div>
            {(reward.panen !== null || reward.xp > 0) && (
              <div class="duel-gains">
                {reward.panen !== null && <span class="gain gain-panen">
                    <Coin scale={2} />+{fmt(reward.panen)} PANEN
                  </span>}
                {reward.xp > 0 && <span class="gain gain-xp">+{reward.xp} XP</span>}
              </div>
            )}
            <p class="duel-reward">{reward.line}</p>
            {m.status !== 'cancelled' && (
              <p class="duel-reward muted">
                {m.turns.length} turn{m.turns.length === 1 ? '' : 's'} · life {m.hp.c} vs {m.hp.d}
              </p>
            )}
            {reward.panen !== null && season && <p class="duel-season">{seasonLine(season)}</p>}
            {txUrl ? (
              <p class="duel-tx">
                <a href={txUrl} {...explorerTarget()}>
                  See the prize on NEAR (nearblocks)
                </a>
              </p>
            ) : pending ? (
              <p class="duel-tx muted">Sending the prize on NEAR... the transaction appears in the Village log.</p>
            ) : paid ? (
              <p class="duel-tx muted">Prize sent: see it in the Village log.</p>
            ) : null}
            <div class="duel-actions">
              {won && !m.practice && m.you === 'challenger' && m.status === 'done' && (
                <a class="btn btn-mint" href={postUrl(matchPost(m), PUBLIC_SITE)} target="_blank" rel="noopener" onClick={() => playSound('click')}>
                  Share on X
                </a>
              )}
              <button class="btn btn-gold" onClick={onClose}>
                Back
              </button>
            </div>
          </div>
        )}
        </div>
        </div>

        {leaving && (
          // A popup in the middle of the screen over a dark veil (2026-11-12, Ardian's iPhone test).
          <div class="match-leave-veil" role="presentation">
          <div class="match-leave" role="alertdialog" aria-label="Leave the duel?">
            <h3 class="match-leave-title">Leave the duel?</h3>
            {isLive ? (
              <p>
                {them.name} waits 20 s for you. If you do not come back in time, {them.name} wins
                {m.turns.length === 0 ? ' (before the first turn ends, the duel is simply cancelled).' : '.'}
              </p>
            ) : (
              <p>
                It keeps going without you: every turn you miss (10 s) the TaniBot hits you. Come back soon (Arena window: Continue), or you lose without a
                prize.
              </p>
            )}
            <div class="duel-actions">
              <button class="btn btn-mint" onClick={() => setLeaving(false)}>
                Stay
              </button>
              <button class="btn" onClick={leave}>
                Leave
              </button>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
