// Try as Judge: the device id (one judge garden per device) and the Judge tour, five
// "do X -> see Y" steps, each ticked off with the NEAR transaction or page that proves it.

import { nearblocksAccount, type GameState, type JudgeStep, type ServerConfig } from './api';
import { Modal } from './help';

const DEVICE_KEY = 'nearvest.judgeDevice';

/** A random id for this browser, kept in localStorage: the same device returns to its judge garden. */
export function judgeDeviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known && /^[A-Za-z0-9_-]{16,64}$/.test(known)) return known;
  } catch {
    // Storage blocked: a new id each time (the IP limit still applies on the server).
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    // See above.
  }
  return id;
}

const STEPS: Record<JudgeStep, { title: string; doText: string; see: string; go: string }> = {
  harvest: {
    title: 'Harvest',
    doText: 'Harvest the ripe Rare Durian on plot 1.',
    see: 'Its Tree NFT is updated on NEAR (stage and harvest count).',
    go: 'Go to the garden',
  },
  sell: {
    title: 'Sell to Mr. Darto',
    doText: 'Open the Market and sell the fruit.',
    see: 'PANEN is minted to your account (Season halving applies).',
    go: 'Open the Market',
  },
  shop: {
    title: 'Buy in the Shop',
    doText: 'Buy a seed or fertilizer in the Shop.',
    see: 'The PANEN you spend is burned on chain.',
    go: 'Open the Shop',
  },
  tanibot: {
    title: "TaniBot's Log",
    doText: 'Open TaniBot (it starts working after your first harvest).',
    see: "Every action with its reason; on-chain actions link their transaction. Shop purchases are burns signed by TaniBot's own account (its daily limit is enforced by the PANEN contract); harvest and sale transactions are sent by the game account. Watering is off chain.",
    go: 'Open TaniBot',
  },
  village: {
    title: 'Village Stats',
    doText: 'Open the Village tab.',
    see: 'PANEN supply, burned total, Season and halving: read live from the contracts.',
    go: 'Open the Village',
  },
};

/** Small chip in the status row: "Judge tour 2/5". */
export function JudgeTourChip({ state, onOpen, compact = false }: { state: GameState; onOpen: () => void; /** Phones: a finished tour is a small "✓ Tour" chip. */ compact?: boolean }) {
  const tour = state.judgeTour;
  if (!tour) return null;
  const done = tour.filter((t) => t.done).length;
  if (compact && done === tour.length)
    return (
      <button class="chip chip-judge done chip-judge-mini" onClick={onOpen} title="Judge tour done (5/5): open it again" aria-label={`Judge tour done, ${done} of ${tour.length}`}>
        <span aria-hidden="true">✓ Tour</span>
      </button>
    );
  return (
    <button class={`chip chip-judge${done === tour.length ? ' done' : ''}`} onClick={onOpen} title="Judge tour: try every feature in 5 steps">
      Judge tour <b>{done}/{tour.length}</b>
    </button>
  );
}

/** Where each step's proof lives on nearblocks. */
function proofLink(step: JudgeStep, txUrl: string | null, state: GameState, config: ServerConfig): string | null {
  if (txUrl) return txUrl;
  if (step === 'tanibot') return nearblocksAccount(`bot.${state.player.accountId}`);
  if (step === 'village') return nearblocksAccount(config.contracts.panen);
  return null;
}

/** Extra places a judge can open at the end of the tour (no step count). */
export type JudgeExtra = 'fishing' | 'arena' | 'friends';
const EXTRAS: Record<JudgeExtra, { title: string; text: string; go: string }> = {
  fishing: { title: 'Fishing', text: 'Cast a line with TaniBot at the pond.', go: 'Go fishing' },
  arena: { title: 'Arena', text: 'Fruit Fight 1 VS 1 against another garden.', go: 'Open the Arena' },
  friends: { title: 'Friends', text: 'Visit other farmers, help water and send stickers.', go: 'Find farmers' },
};

export function JudgeTour({
  state,
  config,
  onGo,
  onClose,
  extras = [],
  onExtra,
}: {
  state: GameState;
  config: ServerConfig;
  onGo: (step: JudgeStep) => void;
  onClose: () => void;
  /** The extras this server offers (Ardian 2026-11-13: "Also try" at the end of the tour). */
  extras?: JudgeExtra[];
  onExtra?: (extra: JudgeExtra) => void;
}) {
  const tour = state.judgeTour ?? [];
  const next = tour.find((t) => !t.done)?.step ?? null;
  return (
    <Modal title="Judge tour" onClose={onClose} closeLabel="Close" class="judge-dialog">
      <p class="small">
        This is your own garden on NEAR testnet (<b>{state.player.accountId}</b>): testnet Tree NFTs and PANEN, and a TaniBot with its own wallet. The game pays
        every fee. Do each step and check the proof on nearblocks.
      </p>
      <ol class="judge-steps">
        {tour.map((t, i) => {
          const s = STEPS[t.step];
          const link = t.done ? proofLink(t.step, t.txUrl, state, config) : null;
          return (
            <li key={t.step} class={`judge-step${t.done ? ' done' : ''}${t.step === next ? ' next' : ''}`}>
              <span class="judge-num" aria-hidden="true">
                {t.done ? '✓' : i + 1}
              </span>
              <span class="grow">
                <b>{s.title}</b>
                <span class="judge-line judge-do">
                  <span class="tag judge-tag judge-tag-do">Do</span>
                  <span>{s.doText}</span>
                </span>
                <span class="judge-line judge-see">
                  <span class="tag judge-tag judge-tag-see">See</span>
                  <span>{s.see}</span>
                </span>
                {t.done && (
                  <span class="judge-proof">
                    {t.txStatus === 'pending' ? (
                      'Sending to NEAR...'
                    ) : t.txStatus === 'failed' ? (
                      <span class="error-text">The transaction failed.</span>
                    ) : link ? (
                      <a href={link} target="_blank" rel="noopener">
                        {t.txUrl ? 'View transaction on nearblocks' : 'View on nearblocks'}
                      </a>
                    ) : null}
                  </span>
                )}
              </span>
              {!t.done && (
                <button class={`btn btn-small${t.step === next ? ' btn-gold' : ''}`} onClick={() => onGo(t.step)}>
                  {s.go}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <p class="small muted">
        Your account: <a href={nearblocksAccount(state.player.accountId)} target="_blank" rel="noopener">{state.player.accountId}</a>. Demo mode: 1 game day = 1 minute.
      </p>
      {extras.length > 0 && onExtra && (
        <section class="judge-also" aria-label="Also try">
          <h3>Also try</h3>
          <ul>
            {extras.map((k) => (
              <li key={k} class="judge-also-row">
                <span class="grow">
                  <b>{EXTRAS[k].title}</b>
                  <span>{EXTRAS[k].text}</span>
                </span>
                <button class="btn btn-small" onClick={() => onExtra(k)}>
                  {EXTRAS[k].go}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
