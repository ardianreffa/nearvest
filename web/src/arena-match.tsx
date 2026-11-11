// Arena v2 "lite" (docs/PLAN-arena.md section 7, Ardian 2026-11-11): the duel screen of a turn-based
// match against the other garden's TaniBot, and its row in the lists. Every turn the player taps
// Rock / Paper / Scissors (or the Gold Durian when the skill bar is full); the server decides the
// turn with the TaniBot's pick that it locked before (server/src/arena-match.ts) and the web plays it
// back: both picks pop up above the two TaniBots (so the player sees why), then the v1 Fruit Fight
// throw / hit or a dodge; the last turn ends with K.O.! (or TIME UP! after 15 turns) and the result.
// Light on phones: the screen is drawn again only when the turn's frame changes; motion is CSS.

import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type Activity, type ArenaPick, type GameState, type MatchSummary, type MatchView, type Rps } from './api';
import { Fighter, FighterHud, FlyingFruit, hitSound, reducedMotion } from './arena';
import { flightMs, fmt, seasonLine } from './arena-play';
import { bonusLine, clockOf, controls, countdown, endBanner, fruitName, matchLine, matchPost, matchReward, matchWon, PICK_LABEL, turnAt, turnBanner, turnLength, turnLine, turnReason, type TurnClock, type TurnFrame } from './arena-turn';
import { Avatar } from './art/avatars';
import { DuelBackdrop } from './art/duel-backdrop';
import type { WeatherLook } from './weather';
import { playGoldDurian, playSound } from './audio';
import { confetti } from './fx';
import { PUBLIC_SITE } from './referral';
import { postUrl } from './share';
import { GoldDurian, UiIcon } from './sprites';

const KO_MS = 1300;
const CELEBRATE_MS = 1400;
/** The server takes picks a little after the 10 s (slow networks); after that the web asks for the decided turn. */
const AFTER_DEADLINE_MS = 1_800;
/** Also asked now and then while the duel is open (another tab, a long pause). */
const POLL_MS = 15_000;

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
              <a href={m.txUrl} target="_blank" rel="noopener noreferrer">
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
export function MatchScreen({
  initial,
  wide,
  activity,
  season,
  fraction,
  weather,
  onDone,
  onClose,
}: {
  initial: MatchView;
  wide: boolean;
  activity: Activity[];
  season?: { number: number; divisor: number; rewardPercent: number };
  /** The village clock (0 = 07:00 WIB) and weather, as in the garden: the duel's background follows them. */
  fraction: number;
  weather: WeatherLook;
  onDone: (state: GameState, titleUp: string | null) => void;
  onClose: () => void;
}) {
  const reduced = reducedMotion();
  // While the duel is open the garden's village behind it stands still (one moving village, light on phones).
  useEffect(() => {
    document.documentElement.classList.add('duel-open');
    return () => document.documentElement.classList.remove('duel-open');
  }, []);
  const [m, setMatch] = useState<MatchView>(initial);
  /** The turn clock on this device, set from every answer (the server decides; this only shows it). */
  const [clock, setClock] = useState<TurnClock | null>(() => clockOf(initial, Date.now()));
  /** The decided turn being played back (index into m.turns) and when it started. */
  const [anim, setAnim] = useState<{ i: number; t0: number } | null>(null);
  /** The end: K.O.!, the celebration, then the result. */
  const [end, setEnd] = useState<number | null>(initial.status === 'done' ? -Infinity : null);
  const [sending, setSending] = useState<ArenaPick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [, setTick] = useState('');
  const mRef = useRef(m);
  mRef.current = m;
  const asking = useRef(false);

  /** A new answer from the server: the match, its clock, and the newly decided turn to play back. */
  const take = (next: MatchView, state?: GameState, titleUp?: string | null) => {
    const before = mRef.current.turns.length;
    setMatch(next);
    setClock(clockOf(next, Date.now()));
    // Several turns may have been decided while away: the last one is played back.
    if (next.turns.length > before) setAnim({ i: next.turns.length - 1, t0: Date.now() });
    else if (next.status === 'done' && mRef.current.status === 'playing') setEnd(Date.now());
    if (state) onDone(state, titleUp ?? null);
  };

  const ask = () => {
    if (asking.current) return;
    asking.current = true;
    api<{ match: MatchView; state?: GameState }>('GET', `/api/arena/match/${mRef.current.id}`)
      .then((r) => take(r.match, r.state))
      .catch(() => undefined)
      .finally(() => (asking.current = false));
  };

  // Now and then while the duel is open (another tab, a long pause).
  useEffect(() => {
    if (m.status !== 'playing') return;
    const id = window.setInterval(ask, POLL_MS);
    return () => window.clearInterval(id);
  }, [m.id, m.status]);

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
  const frameKey = (f: TurnFrame | null) => (f ? `${f.phase}|${f.hit?.index}|${f.hp}|${f.sinceImpact < 350}|${f.sinceImpact < 1000}` : '');
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

  /** Skip the turn playing now (the Gold Durian too): its result shows at once. */
  const skip = () => anim && setAnim({ i: anim.i, t0: now() - 1e7 });

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
    if (sending || anim || m.status !== 'playing') return;
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
  const last = anim ? m.turns[anim.i] : m.turns[m.turns.length - 1];
  const done = endPhase === 'result';
  const over = m.status === 'done' && !anim;
  // Life and skill shown: the playing turn's frame, else the match now.
  const hp: [number, number] = frame ? frame.hp : [m.hp.c, m.hp.d];
  const skill: [number, number] = frame ? frame.skill : [m.skill.c, m.skill.d];
  const gold = !!frame?.hit?.gold && (frame.phase === 'charge' || frame.phase === 'meteor' || frame.phase === 'impact');
  const heavy = (f: TurnFrame | null) => !!f?.hit && (f.hit.gold || f.hit.fruit.species === 'durian');
  const hitShown = frame?.phase === 'impact' && frame.sinceImpact < 1000;
  const pose = (who: 'me' | 'them') => {
    if (over && endPhase !== null) {
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
  // The picks above the heads: while sending, mine at once and theirs "?" (still secret on the
  // server); then both picks of the decided turn, kept until the next pick.
  const bubble = (who: 'me' | 'them') => {
    if (sending) return who === 'me' ? { pick: sending, pop: true } : { pick: '?' as const, pop: false };
    // During the Gold Durian the big title needs the room (the picks were shown just before).
    if (!last || done || gold) return null;
    return { pick: who === 'me' ? last.pick.c : last.pick.d, pop: !!frame && frame.phase === 'reveal' };
  };
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
  const scale = wide ? 4 : 2;
  const reward = matchReward(m);
  const job = m.prize > 0 && m.you === 'challenger' ? activity.find((a) => a.note === 'arena' && a.createdAt >= m.at - 2000) : undefined;
  const txUrl = m.txUrl ?? job?.explorerUrl ?? null;
  const paid = m.prize > 0 && m.you === 'challenger' && !txUrl;
  const pending = paid && (!job || job.status === 'pending');
  // The banner of the turn: after the picks pop up, while the hits play (the Gold Durian has its own title).
  const banner = frame && frame.phase !== 'reveal' && last && !gold ? turnBanner(last, them.name) : null;
  const clockNow = clock && devClock() !== undefined ? clock.startsAt + devClock()! : now();

  return (
    <div class="dialog-backdrop duel-backdrop" role="presentation">
      <div class={`duel match panel${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={`Arena duel: ${me.name} vs ${them.name}'s TaniBot`}>
        <header class="panel-head duel-head">
          <h2>FRUIT FIGHT</h2>
          {anim && !done && (
            <button class="btn btn-small duel-skip" onClick={skip}>
              Skip
            </button>
          )}
          <button
            class="icon-btn info-close"
            onClick={() => (m.status === 'playing' ? setLeaving(true) : onClose())}
            aria-label={m.status === 'playing' ? 'Leave the duel' : 'Close'}
          >
            x
          </button>
        </header>

        <div class={`fight-stage with-village${shake}${reduced ? ' still' : ''}${gold ? ' gold-on' : ''}`}>
          <DuelBackdrop fraction={fraction} weather={weather} wide={wide} />
          {gold && frame && <GoldStageFx frame={frame} reduced={reduced} />}
          <div class="fight-hud">
            <FighterHud side={me} hp={hp[0]} right={false} skill={{ n: skill[0], max: m.skillMax }} />
            <div class="fight-score">
              <span class="duel-vs">VS</span>
            </div>
            {/* Their TaniBot's name AND its title (its look comes from the title). */}
            <FighterHud side={{ ...them, name: `${them.name}'s TaniBot` }} hp={hp[1]} right skill={{ n: skill[1], max: m.skillMax }} />
          </div>
          <div class="fight-floor" style={`--bot-w:${58 * scale}px;--bot-h:${64 * scale}px`}>
            <Fighter side={me} right={false} scale={scale} state={pose('me')} hard={heavy(frame)} pick={bubble('me')} />
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
            <Fighter side={them} right scale={scale} state={pose('them')} hard={heavy(frame)} pick={bubble('them')} />
          </div>
          {banner && (
            <div class="fight-banner turn-banner" key={`banner-${anim?.i}`}>
              {banner}
            </div>
          )}
          {(endPhase === 'ko' || endPhase === 'celebrate') && endT !== Infinity && <div class="fight-ko">{endBanner(m)}</div>}
        </div>

        {!done && (
          <div class="match-info" aria-live="polite">
            <p class="match-turn">{turnLine(m, !!sending, anim?.i)}</p>
            {last && (
              <p class="match-why">
                {turnReason(last, them.name)}
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

        {!over && (
          <div class="match-controls">
            {idle && clock && <TurnTimer clock={clock} now={clockNow} />}
            <button
              class={`btn gold-durian-btn${ctl.goldLit ? ' lit' : ''}`}
              disabled={!ctl.gold}
              onClick={() => pick('gold')}
              aria-label={ctl.goldLit ? 'Throw the Gold Durian' : `Gold Durian: win ${m.skillMax} turns to fill the skill bar (${ctl.skill})`}
            >
              <GoldDurian scale={3} class="gold-durian-icon" />
              <span>{ctl.goldLit ? 'GOLD DURIAN!' : `Gold Durian ${ctl.skill}`}</span>
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
          <div class={`duel-result${won ? ' win' : ' lose'}`}>
            <div class="duel-headline">{won ? 'YOU WIN!' : 'THEY WIN'}</div>
            {(reward.panen !== null || reward.xp > 0) && (
              <div class="duel-gains">
                {reward.panen !== null && <span class="gain gain-panen">+{fmt(reward.panen)} PANEN</span>}
                {reward.xp > 0 && <span class="gain gain-xp">+{reward.xp} XP</span>}
              </div>
            )}
            <p class="duel-reward">{reward.line}</p>
            <p class="duel-reward muted">
              {m.turns.length} turns · life {m.hp.c} vs {m.hp.d}
            </p>
            {reward.panen !== null && season && <p class="duel-season">{seasonLine(season)}</p>}
            {txUrl ? (
              <p class="duel-tx">
                <a href={txUrl} target="_blank" rel="noopener noreferrer">
                  See the prize on NEAR (nearblocks)
                </a>
              </p>
            ) : pending ? (
              <p class="duel-tx muted">Sending the prize on NEAR... the transaction appears in the Village log.</p>
            ) : paid ? (
              <p class="duel-tx muted">Prize sent: see it in the Village log.</p>
            ) : null}
            <div class="duel-actions">
              {won && !m.practice && m.you === 'challenger' && (
                <a class="btn btn-mint" href={postUrl(matchPost(m), PUBLIC_SITE)} target="_blank" rel="noopener noreferrer" onClick={() => playSound('click')}>
                  Share on X
                </a>
              )}
              <button class="btn btn-gold" onClick={onClose}>
                Back
              </button>
            </div>
          </div>
        )}

        {leaving && (
          <div class="match-leave" role="alertdialog" aria-label="Leave the duel?">
            <p>
              Leave the duel? It keeps going without you: every turn you miss (10 s) the TaniBot hits you. Come back soon (Arena window: Continue), or you lose without a
              prize.
            </p>
            <div class="duel-actions">
              <button class="btn btn-mint" onClick={() => setLeaving(false)}>
                Stay
              </button>
              <button class="btn" onClick={onClose}>
                Leave
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
