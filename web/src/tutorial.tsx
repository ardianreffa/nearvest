// The interactive tutorial for new gardens: TaniBot (Seedling) guides the player through the
// loop by hand (plant, water, buy fertilizer = burn, fertilize, check in, harvest, sell), then
// introduces itself right after the first harvest. Progress lives on the server (state.tutorial);
// each step ends as soon as its goal is reached. The target of the step glows (data-tut on the
// shell, see styles.css).

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
  water: { text: 'Trees only grow while watered. Tap Water on your tree (one watering lasts a game day).', go: 'Show me' },
  buy_fertilizer: { text: 'Fertilizer makes a tree grow 1.5x faster. Buy one in the Shop: the PANEN you spend there is burned forever.', go: 'Open the Shop' },
  fertilize: { text: 'Now tap Fertilize on your tree.', go: 'Show me' },
  checkin: { text: 'While it grows: claim your daily check-in. 5 PANEN and a free Mango seed, every day.', go: 'Open check-in' },
  harvest: { text: 'Almost there! Keep it watered. When the fruit is ripe, tap Harvest.', go: 'Show me' },
  sell: { text: 'Sell your fruit to Mr. Darto in the Market. He pays in PANEN, minted to your account.', go: 'Open the Market' },
  tanibot: {
    text: 'You farmed it all by hand. Now meet me properly: I can do this for you, with my own NEAR wallet, a budget you give me and a daily limit the contract enforces.',
  },
};

export function Coach({
  tutorial,
  onStart,
  onSkip,
  onGo,
  onActivate,
}: {
  tutorial: NonNullable<GameState['tutorial']>;
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
            <button class="btn btn-small btn-mint" onClick={onActivate}>
              Activate TaniBot
            </button>
          ) : (
            c.go && (
              <button class="btn btn-small" onClick={() => onGo(step)}>
                {c.go}
              </button>
            )
          )}
          <button class="link-btn coach-skip" onClick={onSkip}>
            {step === 'tanibot' ? 'Later' : 'Skip tutorial'}
          </button>
        </div>
      </div>
    </section>
  );
}
