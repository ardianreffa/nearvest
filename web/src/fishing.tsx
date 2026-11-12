// The Fishing window (docs/PLAN-fishing.md): opened by the "Fishing" pin when the server has fishing
// (`state.fishing`, FISHING=on). Tap to cast, wait for the bite, tap to reel in, see the catch.
// The server decides the catch at the cast and only sends it with the reel; the web never guesses.
// A line left in the water is resumed when the window opens again (or pulled in by the server).
// Text rules: fishing-logic.ts (unit-tested).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type CatchView, type FishingView, type GameState } from './api';
import { CatchIcon } from './art/catch-icons';
import { PondScene, pondAt } from './art/pond';
import { layoutFor } from './art/pond-layouts';
import { CAST_MS, REEL_MS } from './art/rod-pose';
import { moodMix, nextMood, pondFit, pondSounds, pondTime, pondWeather, type Box, type PondMood as PondMoodState } from './pond-life-plan';
import { villageHour } from './share';
import { lookOf } from './weather';
import { TaniBot } from './art/tanibot';
import { tierOf } from './art/tiers';
import { playFishing, playSound, setPondAmbience, setPondMode } from './audio';
import { Modal } from './help';
import { judgeDeviceId } from './judge';
import { castsLeftText, catchNote, catchReward, catchTier, rewardChips, seasonNote, startPhase, untilText, type FishPhase } from './fishing-logic';
import { Sprite } from './sprites';
import { Coin, formatPanen } from './ui';
import { PanenCoin } from './art/panen-coin';

/** Gold sparkles around the leaping Golden Arowana (grid px from the float). */
const SPARKS = [
  [-30, -30],
  [32, -34],
  [0, -46],
  [42, 8],
  [-42, 18],
  [20, 36],
];
/** Splash drops (grid px from the float): a normal fish. */
const DROPS = [
  [-16, -10],
  [16, -12],
  [-22, 2],
  [22, 0],
  [-10, -20],
  [10, -22],
  [-6, 8],
  [8, 9],
].map(([x, y]) => [String(x), String(y)]);
/** More, further, coloured bits: Gourami (and the Golden Arowana under its sparkles). */
const CONFETTI = [
  [-30, -18],
  [30, -20],
  [-36, 0],
  [36, -2],
  [-20, -32],
  [20, -34],
  [0, -38],
  [-26, 14],
  [26, 12],
  [-12, -26],
  [12, -28],
  [-6, 16],
].map(([x, y]) => [String(x), String(y)]);
/** A few soft glints rising around an item. */
const ITEM_GLINTS = [
  [-14, -16],
  [14, -14],
  [0, -24],
  [-18, 2],
  [18, 4],
].map(([x, y]) => [String(x), String(y)]);
import type { Toast } from './toast';

export function FishingWindow({
  state,
  onClose,
  onState,
  notify,
  onCatch,
}: {
  state: GameState;
  onClose: () => void;
  onState: (s: GameState) => void;
  notify: (t: Omit<Toast, 'id'>) => void;
  /** A catch was shown (the Golden Arowana moment starts from here). */
  onCatch?: (c: CatchView) => void;
}) {
  const f = state.fishing!;
  const [phase, setPhase] = useState<FishPhase>(() => startPhase(f, Date.now()));
  const [view, setView] = useState<FishingView | null>(null);
  const [early, setEarly] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Full screen (package 3): the pond fills the screen like the village. Cover when that crops at most
  // 12% (laptops), else the whole pond fits the width with a blurred copy around it (phones upright).
  const screen = useRef<HTMLDivElement>(null);
  // Upright phones get the phone pictures (art/pond-layouts.ts), everything else the 16:9 pond.
  const [L, setL] = useState(() => layoutFor(window.innerWidth, window.innerHeight));
  const [fit, setFit] = useState(() => pondFit(window.innerWidth, window.innerHeight, layoutFor(window.innerWidth, window.innerHeight)));
  const [avoid, setAvoid] = useState<Box[]>([]);
  useLayoutEffect(() => {
    const onResize = () => {
      const l = layoutFor(window.innerWidth, window.innerHeight);
      setL(l);
      setFit(pondFit(window.innerWidth, window.innerHeight, l));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // The floating panels as pond-grid boxes: the ducks do not swim under them.
  useLayoutEffect(() => {
    const el = screen.current;
    if (!el) return;
    const k = fit.w / L.w;
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-pond-avoid]')].map((p): Box => {
      const r = p.getBoundingClientRect();
      return [(r.left - fit.left) / k, (r.top - fit.top) / k, r.width / k, r.height / k];
    });
    const key = (b: Box[]) => b.map((x) => x.map(Math.round).join(',')).join(';');
    setAvoid((old) => (key(old) === key(boxes) ? old : boxes));
  });
  // Escape goes back to the village (unless the catch list is open on top).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.dialog-backdrop') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  /** When the pond's current animation started (cast tap, bite, reel tap); 0 = none (resumed line). */
  const [since, setSince] = useState(0);
  const castAt = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  // The pond follows the village clock and weather (rain only; never ash), checked every 5 s; it
  // changes calmly (pond-life-plan.ts nextMood: fades, and in demo mode each mood holds 20 s).
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((n) => n + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);
  const want = { time: pondTime(villageHour(state)), weather: pondWeather(lookOf(state.weather)) };
  const moodRef = useRef<PondMoodState | null>(null);
  moodRef.current = nextMood(moodRef.current, want, Date.now(), !!state.player.demo);
  const { time, weather } = moodRef.current;
  const mix = moodMix(time);
  // The pond's own background sounds while the window is open (the garden's loop pauses, app.tsx).
  useEffect(() => {
    setPondAmbience(pondSounds(time, weather));
  }, [time, weather]);
  // Tandur's music and ambient loop are silent at the pond and come back when it closes.
  useEffect(() => {
    setPondMode(true);
    return () => {
      setPondAmbience(null);
      setPondMode(false);
    };
  }, []);

  // What can be caught + today's catches (the window works without it too). The game state may be a
  // few seconds old, so a line still in the water is resumed from this fresh answer too.
  useEffect(() => {
    api<FishingView>('GET', '/api/fishing')
      .then((v) => {
        if (!alive.current) return;
        setView(v);
        if (v.open) setPhase((p) => (p.k === 'ready' ? startPhase(v, Date.now()) : p));
      })
      .catch(() => undefined);
  }, []);

  // The bite comes at the time the server chose.
  useEffect(() => {
    if (phase.k !== 'wait') return;
    const t = window.setTimeout(() => {
      if (!alive.current) return;
      setPhase({ k: 'bite', id: phase.id });
      setSince(Date.now());
      setEarly(false);
      playFishing('bite');
      // Never before the float has landed.
    }, Math.max(0, phase.biteAt - Date.now(), castAt.current + CAST_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [phase]);

  const left = view?.left ?? f.left;
  const max = view?.max ?? f.max;
  const nextIn = view?.msUntilNextDay ?? f.msUntilNextDay;

  const cast = useCallback(async () => {
    if (phase.k !== 'ready' && phase.k !== 'result') return;
    // The swing whoosh now, the "plunk" when the float lands (the animation runs on its own clock).
    playFishing('cast');
    const at = Date.now();
    castAt.current = at;
    setSince(at);
    window.setTimeout(() => alive.current && playFishing('plop'), CAST_MS);
    setPhase({ k: 'casting' });
    try {
      const r = await api<{ cast: { id: number; biteInMs: number }; left: number }>('POST', '/api/fishing/cast', { deviceId: judgeDeviceId() });
      if (!alive.current) return;
      setView((v) => (v ? { ...v, left: r.left } : v));
      setPhase({ k: 'wait', id: r.cast.id, biteAt: Date.now() + r.cast.biteInMs });
    } catch (e) {
      if (!alive.current) return;
      setPhase({ k: 'ready' });
      setSince(0);
      castAt.current = 0;
      notify({ kind: 'error', text: e instanceof Error ? e.message : 'Could not cast. Try again.' });
      void api<FishingView>('GET', '/api/fishing').then((v) => alive.current && setView(v)).catch(() => undefined);
    }
  }, [phase, notify]);

  const reel = useCallback(async () => {
    if (phase.k === 'wait') {
      // Too early: nothing is lost, the float just keeps bobbing.
      setEarly(true);
      playSound('click');
      return;
    }
    if (phase.k !== 'bite') return;
    const id = phase.id;
    playFishing('reel');
    const at = Date.now();
    setSince(at);
    setPhase({ k: 'reeling', id });
    try {
      const r = await api<{ result: CatchView; fishing: FishingView; state: GameState }>('POST', `/api/fishing/${id}/reel`);
      if (!alive.current) return;
      setView(r.fishing);
      onState(r.state);
      // The catch shows once the line is all the way in (reduced motion: at once).
      const rest = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : at + REEL_MS - Date.now();
      if (rest > 0) await new Promise((ok) => window.setTimeout(ok, rest));
      if (!alive.current) return;
      setPhase({ k: 'result', c: r.result });
      setSince(Date.now());
      playFishing(catchTier(r.result));
      onCatch?.(r.result);
    } catch (e) {
      if (!alive.current) return;
      const body = e instanceof ApiError ? (e.data as { code?: string; biteInMs?: number }) : undefined;
      if (body?.code === 'too_early') {
        setSince(0);
        setPhase({ k: 'wait', id, biteAt: Date.now() + (body.biteInMs ?? 500) });
        return;
      }
      setPhase({ k: 'ready' });
      notify({ kind: 'error', text: e instanceof Error ? e.message : 'Could not reel in. Try again.' });
    }
  }, [phase, onState, onCatch, notify]);

  const busy = phase.k === 'casting' || phase.k === 'reeling';
  const inWater = phase.k === 'wait' || phase.k === 'bite' || phase.k === 'reeling';
  const c = phase.k === 'result' ? phase.c : null;
  const tier = c ? catchTier(c) : null;
  const canCast = left > 0 && (phase.k === 'ready' || phase.k === 'result');

  const primary = inWater ? (
    <button class={`btn fish-reel${phase.k === 'bite' ? ' btn-gold fish-now' : ' btn-mint'}`} onClick={reel} disabled={phase.k === 'reeling'}>
      {phase.k === 'bite' ? 'Reel in!' : phase.k === 'reeling' ? 'Reeling in...' : 'Reel in'}
    </button>
  ) : (
    <button class="btn btn-mint fish-cast" onClick={cast} disabled={!canCast || busy}>
      {phase.k === 'casting' ? 'Casting...' : left === 0 ? 'No casts left' : c ? 'Cast again' : 'Cast line'}
    </button>
  );

  return (
    <div
      ref={screen}
      class={`pond-screen fishing-live pond-time-${time}${inWater ? ' fishing-one' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Fishing pond"
      data-fit={fit.mode}
      // Upright phones: the panel gets exactly the room under the pond (it scrolls inside, never covers it).
      style={{ '--pond-free': `${Math.max(120, window.innerHeight - fit.top - (fit.mode === 'phone' ? L.lakeBottom * (fit.w / L.w) : fit.h) - 16)}px` }}
    >
      {/* Upright phones (package 7): no blurred copy; the picture's own ground continues below it. */}
      {fit.mode === 'phone' && L.ground
        ? (['day', 'dusk', 'night'] as const).map((t) => (
            <img
              key={`g${t}`}
              class="pond-ground pond-fade"
              src={L.ground!.pics[t]}
              style={{
                left: `${fit.left}px`,
                top: `${fit.top + fit.h - L.ground!.over * (fit.w / 480)}px`,
                width: `${fit.w}px`,
                height: `${L.ground!.h * (fit.w / 480)}px`,
                opacity: t === 'day' ? 1 : t === 'dusk' ? mix.dusk : mix.night,
              }}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          ))
        : null}
      {fit.mode !== 'phone' && (['day', 'dusk', 'night'] as const).map((t) => (
        <img
          key={t}
          class="pond-backfill"
          src={L.pics[t]}
          style={{ opacity: t === 'day' ? 1 : t === 'dusk' ? mix.dusk : mix.night }}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      ))}      <div class="pond-stage" style={{ left: `${fit.left}px`, top: `${fit.top}px`, width: `${fit.w}px`, height: `${fit.h}px` }}>
        <PondScene phase={phase.k} since={since} time={time} weather={weather} avoid={avoid} mix={mix} layout={L} bot={<TaniBot tier={tierOf(state.player.title)} scale={1} effects={false} />}>
        {phase.k === 'bite' && (
            <span class="pond-bang" style={pondAt(L.float.x, L.float.y - 10, L)} aria-hidden="true">
              !
            </span>
          )}
          {/* The catch's show at the float (package 7): it fades away once it has played, so no fish
              (or boot, or seed) is left floating in the lake. */}
          {c && (
            <div class="pond-result-fx" key={since}>
              {tier !== 'junk' && (
                <span class={`pond-splash splash-${tier}`} style={pondAt(L.float.x, L.float.y, L)} aria-hidden="true">
                  {(tier === 'item' ? ITEM_GLINTS : tier === 'gourami' || tier === 'legend' ? CONFETTI : DROPS).map(([dx, dy], i) => (
                    <i key={i} style={{ '--dx': dx, '--dy': dy, animationDelay: `${(i % 4) * 40}ms` }} />
                  ))}
                </span>
              )}
              {tier === 'junk' && <span class="pond-plop" style={pondAt(L.float.x, L.float.y, L)} aria-hidden="true" />}
              {c.moment === 'golden_arowana' &&
                SPARKS.map(([x, y], i) => (
                  <span key={i} class="pond-spark" style={{ ...pondAt(L.float.x + x, L.float.y + y, L), animationDelay: `${200 + i * 120}ms` }} aria-hidden="true">
                    <Sprite name="sparkle" scale={2} />
                  </span>
                ))}
              <span class={`pond-catch tier-${tier}${c.released ? ' released' : ''}`} style={pondAt(L.float.x, L.float.y, L)} aria-hidden="true">
                <CatchIcon id={c.catch} scale={2} />
              </span>
            </div>
          )}
        </PondScene>
      </div>

      <header class="pond-hud-top" data-pond-avoid>
        <button class="btn pond-back" onClick={onClose} aria-label="Back to the village">
          ← Village
        </button>
        <PondBalance balance={state.player.balance} />
        <div class="pond-chip fish-casts" aria-label={castsLeftText({ left, max })}>
          <span class="fish-pips" aria-hidden="true">
            {Array.from({ length: max }, (_, i) => (
              <i key={i} class={i < left ? 'on' : ''} />
            ))}
          </span>
          <span class="fish-casts-long">{castsLeftText({ left, max })}</span>
          <span class="fish-casts-short" aria-hidden="true">
            {left}/{max}
          </span>
        </div>
      </header>

      <section class="pond-panel" data-pond-avoid>
        <div class="pond-panel-body">
          {/* No casts left (package 7): one short, clear line instead of the hint. */}
          {left === 0 && (phase.k === 'ready' || phase.k === 'result') ? (
            <p class="fish-status fish-done" aria-live="polite">
              Come back at 07:00 WIB (in {untilText(nextIn)})
            </p>
          ) : (
            <p class="fish-status" aria-live="polite">
              {phase.k === 'ready' && 'Tap Cast line, then wait for the float to dip.'}
              {phase.k === 'casting' && 'Casting...'}
              {phase.k === 'wait' && (early ? 'Wait for the bite! Watch the float.' : 'Waiting for a bite...')}
              {phase.k === 'bite' && <b>A bite! Tap Reel in!</b>}
              {phase.k === 'reeling' && 'Reeling in...'}
            </p>
          )}

          {c && (
            <div class={`fish-result kind-${c.kind} tier-${tier}${tier === 'legend' ? ' legend' : ''}`}>
              <span class="fish-result-icon">
                <CatchIcon id={c.catch} scale={4} fitW={100} />
              </span>
              <div class="fish-result-text">
                <h3>{c.released ? `${c.name} (released)` : c.name}</h3>
                <div class="fish-chips">
                  {rewardChips(c).map((x) => (
                    <span key={x.text} class={`chip-reward reward-${x.kind}`}>
                      {x.kind === 'panen' && <Coin scale={1} />}
                      {x.text}
                    </span>
                  ))}
                </div>
                <p class="fish-note">{catchNote(c)}</p>
                {c.line && <p class="fish-line">“{c.line}”</p>}
                {c.panen > 0 && seasonNote(state.season) && <p class="fish-season">{seasonNote(state.season)}. This is what you received.</p>}
              </div>
            </div>
          )}

        </div>
        <div class="pond-actions">
          {primary}
          {view && (
            <button class="link-btn fish-list-open" onClick={() => setListOpen(true)}>
              What can I catch?
            </button>
          )}
        </div>
      </section>

      {listOpen && view && (
        <Modal title="What can I catch?" onClose={() => setListOpen(false)} closeLabel="Close" class="fishing-list-dialog">
          <div class="fish-list">
            <ul>
              {view.catches.map((x) => (
                <li key={x.id}>
                  <span class="fish-list-icon">
                    <CatchIcon id={x.id} scale={2} fitW={64} />
                  </span>
                  <span class="fish-list-name">{x.name}</span>
                  <span class="fish-list-reward">{catchReward(x, view.chest, state.season)}</span>
                </li>
              ))}
            </ul>
            <p class="fish-list-note">
              Fish are bought on the spot by Mr. Darto. The amounts are what you receive{seasonNote(state.season) ? ` (${seasonNote(state.season)})` : ''}.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * The PANEN balance at the pond (package 6): the round gold PANEN coin and the number; when a catch
 * pays, the number counts up (~0.9 s) and a small "+N" rises (reduced motion: it just changes).
 */
function PondBalance({ balance }: { balance: number }) {
  const [shown, setShown] = useState(balance);
  const [gain, setGain] = useState<{ n: number; id: number } | null>(null);
  const from = useRef(balance);
  useEffect(() => {
    const start = from.current;
    from.current = balance;
    if (balance === start) return;
    if (balance > start) setGain({ n: balance - start, id: Date.now() });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(balance);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setShown(start + (balance - start) * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [balance]);
  return (
    <div class={`pond-chip pond-balance${gain ? ' bump' : ''}`} key={gain?.id} aria-label={`${formatPanen(balance)} PANEN`}>
      <PanenCoin scale={2} />
      <b>{formatPanen(Math.round(shown * 100) / 100)}</b>
      {gain && (
        <span class="pond-gain" aria-hidden="true">
          +{formatPanen(gain.n)}
        </span>
      )}
    </div>
  );
}
