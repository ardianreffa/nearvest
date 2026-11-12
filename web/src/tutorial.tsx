// The guided tutorial for new gardens (reworked 2026-11-12, Ardian): TaniBot (Seedling) guides the
// player one step at a time through the loop by hand (plant, water, buy fertilizer = burn,
// fertilize, check in, harvest, sell), introduces itself, then a first cast at the fishing pond and
// a look at the Arena. Progress lives on the server (state.tutorial); a step ends only when its own
// goal is reached (TaniBot, the pond and the Arena may be passed). The target of the step glows with
// a pixel arrow above it (TutorialPointer), other buttons are dimmed but still work; Skip is always
// there. The end: a "Welcome to Tandur!" banner and TaniBot's last words (app.tsx).

import { useEffect, useState } from 'preact/hooks';
import type { GameState, TutorialStep } from './api';
import { TaniBot } from './art/tanibot';

interface CoachText {
  text: string;
  /** "Show me" opens the place where the step happens. */
  go?: string;
}

export const COACH: Record<TutorialStep, CoachText> = {
  welcome: { text: "Hi, I'm TaniBot! Welcome to Tandur. I'll show you how farming works here. It takes about 5 minutes." },
  plant: { text: 'Plant your seed: tap plot 1, then tap the seed card. A Tree NFT is born in your NEAR account!', go: 'Show me' },
  water: { text: 'Trees only grow while watered. Tap Water on your tree (one watering lasts a game day). Ash from the volcano? Tap Clean ash first.', go: 'Show me' },
  buy_fertilizer: { text: 'Fertilizer makes a tree grow 1.5x faster. Buy one in the Shop: the PANEN you spend there is burned forever.', go: 'Open the Shop' },
  fertilize: { text: 'Now tap Fertilize on your tree.', go: 'Show me' },
  checkin: { text: 'While it grows: claim your daily check-in. 5 PANEN and a free Mango seed, every day.', go: 'Open check-in' },
  harvest: {
    text: 'Now we wait for the fruit: in demo mode a game day is one minute, so it ripens in a minute or two (longer in normal mode). Keep it watered; when it is ripe, tap Harvest.',
    go: 'Show me',
  },
  sell: { text: 'Sell your fruit to Mr. Darto in the Market. He pays in PANEN, minted to your account.', go: 'Open the Market' },
  tanibot: {
    text: 'You farmed it all by hand. Now meet me properly: I can do this for you, with my own NEAR wallet, a budget you give me and a daily limit the contract enforces.',
  },
  fishing: { text: 'Time for a break at the jungle pond! Open the Fishing pond and cast your line once. Mr. Darto buys what you catch.', go: 'Go fishing' },
  arena: { text: 'Last stop: the Arena. Challenge another farmer to Rock, Paper, Scissors with your TaniBot. No bets: the winner gets PANEN from the game. Just have a look for now.', go: 'Open the Arena' },
};

/** TaniBot's words when the tutorial is done (the welcome banner plays first). */
export const TUTORIAL_DONE_LINE = "You did it, farmer! Plant, water, harvest, sell, burn: that's the loop. I'll help while you're away. Try the pond and the Arena any time!";

/** Where each step's target is on screen (the pixel arrow points at the first one found). */
export const TUT_TARGETS: Partial<Record<TutorialStep, string[]>> = {
  plant: ['.plot-empty .seed-row > *', '.plots > .plot:first-child'],
  // Ash from the volcano first: Clean ash, then Water.
  water: ['.act-water:not(:disabled)', '.act-clean:not(:disabled)'],
  buy_fertilizer: ['.shop-fertilizer .shop-buy', '.tab-shop', '.rail-shop'],
  fertilize: ['.act-fertilize:not(:disabled)', '.act-clean:not(:disabled)'],
  checkin: ['.checkin-claim:not(:disabled)', '.chip-checkin.ready'],
  harvest: ['.act-harvest:not(:disabled)', '.act-clean:not(:disabled)', '.act-water:not(:disabled)'],
  sell: ['.sell-go:not(:disabled)', '.tab-market', '.rail-market'],
  tanibot: ['.tab-bot', '.rail-bot', '.drawer-bot'],
  fishing: ['.fish-cast:not(:disabled)', '.place-pin.pin-fishing'],
  arena: ['.place-pin.pin-arena'],
};

export function Coach({
  tutorial,
  onStart,
  onSkip,
  onGo,
  onActivate,
  onNext,
}: {
  tutorial: NonNullable<GameState['tutorial']>;
  /** Pass an optional step (TaniBot "Later", the Arena "Got it"). */
  onNext: () => void;
  onStart: () => void;
  onSkip: () => void;
  onGo: (step: TutorialStep) => void;
  onActivate: () => void;
}) {
  const { step, index, total } = tutorial;
  const c = COACH[step];
  return (
    <section class={`coach coach-${step}`} role="status" aria-live="polite" aria-label="Tutorial">
      <div class="coach-bot" aria-hidden="true">
        <TaniBot tier="seedling" scale={1} effects={false} />
      </div>
      <div class="coach-body">
        {index > 0 && (
          <span class="coach-progress">
            Step {index} of {total - 1}
          </span>
        )}
        <p class="coach-text">{c.text}</p>
        <div class="coach-actions">
          {step === 'welcome' ? (
            <button class="btn btn-small btn-mint" onClick={onStart}>
              Let's go
            </button>
          ) : step === 'tanibot' ? (
            <>
              <button class="btn btn-small btn-mint" onClick={onActivate}>
                Activate TaniBot
              </button>
              <button class="btn btn-small" onClick={onNext}>
                Later
              </button>
            </>
          ) : step === 'arena' ? (
            <>
              <button class="btn btn-small btn-mint" onClick={() => onGo(step)}>
                {c.go}
              </button>
              <button class="btn btn-small" onClick={onNext}>
                Got it
              </button>
            </>
          ) : (
            c.go && (
              <button class="btn btn-small" onClick={() => onGo(step)}>
                {c.go}
              </button>
            )
          )}
          <button class="link-btn coach-skip" onClick={onSkip}>
            Skip tutorial
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * A bouncing pixel arrow above the current step's target (TUT_TARGETS: the first one on screen),
 * following it as it moves (checked 4 times a second). Still with reduced motion (CSS).
 */
export function TutorialPointer({ step }: { step: TutorialStep }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const sels = TUT_TARGETS[step] ?? [];
    const find = () => {
      for (const sel of sels)
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          // A window on top (Arena, Shop on phones...): only targets inside that window count.
          const top = [...document.querySelectorAll('.dialog-backdrop, .pond-screen')].pop();
          if (top && !top.contains(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden') {
            document.querySelectorAll('.tut-target').forEach((e) => e !== el && e.classList.remove('tut-target'));
            el.classList.add('tut-target');
            return setAt((o) => (o && Math.abs(o.x - (r.left + r.width / 2)) < 1 && Math.abs(o.y - r.top) < 1 ? o : { x: r.left + r.width / 2, y: r.top }));
          }
        }
      document.querySelectorAll('.tut-target').forEach((e) => e.classList.remove('tut-target'));
      setAt(null);
    };
    find();
    const id = window.setInterval(find, 250);
    return () => {
      window.clearInterval(id);
      document.querySelectorAll('.tut-target').forEach((e) => e.classList.remove('tut-target'));
    };
  }, [step]);
  if (!at) return null;
  return (
    <span class="tut-arrow" style={{ left: `${at.x}px`, top: `${at.y}px` }} aria-hidden="true">
      <svg viewBox="0 0 9 9" shape-rendering="crispEdges">
        <path d="M3 0h3v4h3v1h-1v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h3z" />
      </svg>
    </span>
  );
}
