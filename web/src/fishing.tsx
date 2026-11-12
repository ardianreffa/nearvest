// The Fishing window (docs/PLAN-fishing.md): opened by the "Fishing" pin when the server has fishing
// (`state.fishing`, FISHING=on). Tap to cast, wait for the bite, tap to reel in, see the catch.
// The server decides the catch at the cast and only sends it with the reel; the web never guesses.
// A line left in the water is resumed when the window opens again (or pulled in by the server).
// Text rules: fishing-logic.ts (unit-tested).

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type CatchView, type FishingView, type GameState } from './api';
import { CatchIcon } from './art/catch-icons';
import { FLOAT_AT, PondScene, pondAt } from './art/pond';
import { CAST_MS, REEL_MS } from './art/rod-pose';
import { pondSounds, pondTime, pondWeather } from './pond-life-plan';
import { villageHour } from './share';
import { lookOf } from './weather';
import { TaniBot } from './art/tanibot';
import { tierOf } from './art/tiers';
import { playFishing, playSound, setPondAmbience, setPondMode } from './audio';
import { Modal } from './help';
import { judgeDeviceId } from './judge';
import { castsLeftText, catchNote, catchTier, rewardChips, startPhase, untilText, type FishPhase } from './fishing-logic';
import { Sprite } from './sprites';
import { Coin } from './ui';

/** Gold sparkles around the leaping Golden Arowana (pond grid points). */
const SPARKS = [
  [220, 112],
  [282, 108],
  [250, 96],
  [292, 150],
  [208, 160],
  [270, 178],
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
  /** When the pond's current animation started (cast tap, bite, reel tap); 0 = none (resumed line). */
  const [since, setSince] = useState(0);
  const castAt = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  // The pond follows the village clock and weather (rain only; never ash), checked every 30 s.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const time = pondTime(villageHour(state));
  const weather = pondWeather(lookOf(state.weather));
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

  const actions = inWater ? (
    <button class={`btn fish-reel${phase.k === 'bite' ? ' btn-gold fish-now' : ' btn-mint'}`} onClick={reel} disabled={phase.k === 'reeling'}>
      {phase.k === 'bite' ? 'Reel in!' : phase.k === 'reeling' ? 'Reeling in...' : 'Reel in'}
    </button>
  ) : (
    <>
      <button class="btn" onClick={onClose}>
        Close
      </button>
      <button class="btn btn-mint fish-cast" onClick={cast} disabled={!canCast || busy}>
        {phase.k === 'casting' ? 'Casting...' : left === 0 ? 'No casts left' : c ? 'Cast again' : 'Cast line'}
      </button>
    </>
  );

  return (
    <Modal title="Fishing" onClose={onClose} class={`fishing-dialog fishing-live${inWater ? ' fishing-one' : ''}`} actions={actions}>
      <PondScene phase={phase.k} since={since} time={time} weather={weather} bot={<TaniBot tier={tierOf(state.player.title)} scale={1} effects={false} />}>
        {phase.k === 'bite' && (
          <span class="pond-bang" style={pondAt(FLOAT_AT.x, FLOAT_AT.y - 10)} aria-hidden="true">
            !
          </span>
        )}
        {tier && tier !== 'junk' && (
          <span class={`pond-splash splash-${tier}`} style={pondAt(FLOAT_AT.x, FLOAT_AT.y)} aria-hidden="true">
            {(tier === 'item' ? ITEM_GLINTS : tier === 'gourami' || tier === 'legend' ? CONFETTI : DROPS).map(([dx, dy], i) => (
              <i key={i} style={{ '--dx': dx, '--dy': dy, animationDelay: `${(i % 4) * 40}ms` }} />
            ))}
          </span>
        )}
        {tier === 'junk' && <span class="pond-plop" style={pondAt(FLOAT_AT.x, FLOAT_AT.y)} aria-hidden="true" />}
        {c?.moment === 'golden_arowana' &&
          SPARKS.map(([x, y], i) => (
            <span key={i} class="pond-spark" style={{ ...pondAt(x, y), animationDelay: `${200 + i * 120}ms` }} aria-hidden="true">
              <Sprite name="sparkle" scale={2} />
            </span>
          ))}
        {c && (
          <span class={`pond-catch tier-${tier}${c.released ? ' released' : ''}`} style={pondAt(FLOAT_AT.x, FLOAT_AT.y)} aria-hidden="true">
            <CatchIcon id={c.catch} scale={2} />
          </span>
        )}
      </PondScene>

      <p class="fish-status" aria-live="polite">
        {phase.k === 'ready' && (left > 0 ? 'Tap Cast line, then wait for the float to dip.' : `Come back at 07:00 WIB (in ${untilText(nextIn)}).`)}
        {phase.k === 'casting' && 'Casting...'}
        {phase.k === 'wait' && (early ? 'Wait for the bite! Watch the float.' : 'Waiting for a bite...')}
        {phase.k === 'bite' && <b>A bite! Tap Reel in!</b>}
        {phase.k === 'reeling' && 'Reeling in...'}
        {phase.k === 'result' && left === 0 && `That was your last cast today. Come back at 07:00 WIB (in ${untilText(nextIn)}).`}
      </p>

      {c && (
        <div class={`fish-result kind-${c.kind} tier-${tier}${tier === 'legend' ? ' legend' : ''}`}>
          <span class="fish-result-icon">
            <CatchIcon id={c.catch} scale={4} fitW={100} />
          </span>
          <div class="fish-result-text">
            <h3>{c.released ? `${c.name} (released)` : c.name}</h3>
            <p>{catchNote(c)}</p>
            {c.line && <p class="fish-line">“{c.line}”</p>}
            <div class="fish-chips">
              {rewardChips(c).map((x) => (
                <span key={x.text} class={`chip-reward reward-${x.kind}`}>
                  {x.kind === 'panen' && <Coin scale={1} />}
                  {x.text}
                </span>
              ))}
            </div>
            {c.panen > 0 && state.season.divisor > 1 && <p class="fish-season">Season {state.season.number}: rewards are {state.season.rewardPercent}% now.</p>}
          </div>
        </div>
      )}

      <div class="fish-casts">
        <span class="fish-pips" aria-hidden="true">
          {Array.from({ length: max }, (_, i) => (
            <i key={i} class={i < left ? 'on' : ''} />
          ))}
        </span>
        <span>{castsLeftText({ left, max })}</span>
      </div>

      {view && (
        <div class="fish-list">
          <button class="link-btn" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
            {listOpen ? '− What can I catch?' : '+ What can I catch?'}
          </button>
          {listOpen && (
            <ul>
              {view.catches.map((x) => (
                <li key={x.id}>
                  <span class="fish-list-icon">
                    <CatchIcon id={x.id} scale={2} fitW={64} />
                  </span>
                  <span class="fish-list-name">{x.name}</span>
                  <span class="fish-list-reward">
                    {x.kind === 'fish' ? `${x.panenNow} PANEN` : x.id === 'chest' ? `${view.chest.min}-${view.chest.max} PANEN` : x.kind === 'junk' ? '1 XP' : x.id === 'bottle' ? '5 XP' : x.id === 'mango_seed' ? 'Seed' : 'Item'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
