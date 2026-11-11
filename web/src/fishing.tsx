// The Fishing window (docs/PLAN-fishing.md): opened by the "Fishing" pin when the server has fishing
// (`state.fishing`, FISHING=on). Tap to cast, wait for the bite, tap to reel in, see the catch.
// The server decides the catch at the cast and only sends it with the reel; the web never guesses.
// A line left in the water is resumed when the window opens again (or pulled in by the server).
// Text rules: fishing-logic.ts (unit-tested).

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type CatchView, type FishingView, type GameState } from './api';
import { CatchIcon } from './art/catch-icons';
import { FLOAT_AT, PondScene, pondAt } from './art/pond';
import { TaniBot } from './art/tanibot';
import { tierOf } from './art/tiers';
import { playFishing, playSound } from './audio';
import { Modal } from './help';
import { judgeDeviceId } from './judge';
import { castsLeftText, catchNote, rewardChips, startPhase, untilText, type FishPhase } from './fishing-logic';
import { Coin } from './ui';
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
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

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
      setEarly(false);
      playFishing('bite');
    }, Math.max(0, phase.biteAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [phase]);

  const left = view?.left ?? f.left;
  const max = view?.max ?? f.max;
  const nextIn = view?.msUntilNextDay ?? f.msUntilNextDay;

  const cast = useCallback(async () => {
    if (phase.k !== 'ready' && phase.k !== 'result') return;
    playFishing('cast');
    setPhase({ k: 'casting' });
    try {
      const r = await api<{ cast: { id: number; biteInMs: number }; left: number }>('POST', '/api/fishing/cast', { deviceId: judgeDeviceId() });
      if (!alive.current) return;
      setView((v) => (v ? { ...v, left: r.left } : v));
      window.setTimeout(() => alive.current && playFishing('plop'), 380);
      setPhase({ k: 'wait', id: r.cast.id, biteAt: Date.now() + r.cast.biteInMs });
    } catch (e) {
      if (!alive.current) return;
      setPhase({ k: 'ready' });
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
    setPhase({ k: 'reeling', id });
    try {
      const r = await api<{ result: CatchView; fishing: FishingView; state: GameState }>('POST', `/api/fishing/${id}/reel`);
      if (!alive.current) return;
      setView(r.fishing);
      onState(r.state);
      setPhase({ k: 'result', c: r.result });
      playFishing(r.result.kind === 'junk' || r.result.released ? 'junk' : r.result.catch === 'golden_arowana' ? 'legend' : 'catch');
      onCatch?.(r.result);
    } catch (e) {
      if (!alive.current) return;
      const body = e instanceof ApiError ? (e.data as { code?: string; biteInMs?: number }) : undefined;
      if (body?.code === 'too_early') {
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
      <PondScene phase={phase.k}>
        <div class="pond-bot" style={pondAt(14, 62)}>
          <TaniBot tier={tierOf(state.player.title)} scale={1} effects={false} />
        </div>
        {phase.k === 'bite' && (
          <span class="pond-bang" style={pondAt(FLOAT_AT.x, FLOAT_AT.y - 8)} aria-hidden="true">
            !
          </span>
        )}
        {c && (
          <span class={`pond-catch${c.released ? ' released' : ''}`} style={pondAt(FLOAT_AT.x, FLOAT_AT.y)} aria-hidden="true">
            <CatchIcon id={c.catch} scale={3} />
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
        <div class={`fish-result kind-${c.kind}${c.catch === 'golden_arowana' && !c.released ? ' legend' : ''}`}>
          <span class="fish-result-icon">
            <CatchIcon id={c.catch} scale={4} />
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
                  <CatchIcon id={x.id} scale={2} />
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
