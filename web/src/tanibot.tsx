import { explorerTarget } from './ext-link';
// TaniBot window: activate, on/off, working style, budget and the Log
// (every action with its reason and the NEAR transaction that proves it).

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, type BotStyle, type GameState, type ServerConfig, type TaniBotLogEntry, type TaniBotResponse, type TaniBotView } from './api';
import { TaniBot, tierOf } from './art/tanibot';
import { Modal } from './help';
import { Info } from './info';
import { Panel } from './ui';
import { formatDuration } from './ui';
import { walletFunctionCalls } from './wallet';

/** A toast from the app shell ('success' = green with a check mark). */
export type Notify = (t: { kind: 'info' | 'error' | 'chain' | 'success'; text: string; link?: string }) => void;

/** What the busy button says: the wallet is open, or the transaction is on its way. */
type Phase = 'wallet' | 'confirm' | 'busy';
const PHASE_TEXT: Record<Phase, string> = { wallet: 'Waiting for wallet...', confirm: 'Confirming on NEAR...', busy: 'Please wait...' };

/** A transaction the window waits for: the Log entry of its chain job. */
interface Watch {
  logId: number;
  success: string;
  failure: string;
  button: 'activate' | 'add' | 'back';
}

const STYLES: { id: BotStyle; label: string; text: string }[] = [
  { id: 'thrifty', label: 'Thrifty', text: 'Waters, harvests and sells. Never buys.' },
  { id: 'balanced', label: 'Balanced', text: 'Also fertilizes the slow trees (rambutan, durian).' },
  { id: 'turbo', label: 'Turbo', text: 'Fertilizes every growing tree and sells right away.' },
];

const ACTION_ICON: Record<string, string> = {
  setup: '*',
  limit: '#',
  budget: '$',
  water: '~',
  harvest: '+',
  sell: '$',
  buy: '-',
  fertilize: '^',
  keep: '=',
  check: '.',
  notice: '!',
  switch: 'o',
  style: '>',
  ignored: 'x',
  summary: '=',
  clean: '*',
  weather: '!',
};

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TaniBotWindow({
  state,
  config,
  onState,
  onClose,
  notify,
}: {
  state: GameState;
  config: ServerConfig;
  onState: (s: GameState) => void;
  onClose: () => void;
  notify: Notify;
}) {
  const [data, setData] = useState<TaniBotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which button is working and what it waits for. */
  const [phase, setPhase] = useState<{ button: Watch['button']; phase: Phase } | null>(null);
  const [watch, setWatch] = useState<Watch | null>(null);
  /** Same as `watch`, readable right away inside run() (state updates come a render later). */
  const watchRef = useRef<Watch | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [amount, setAmount] = useState(10);
  const [now, setNow] = useState(Date.now());
  const p = state.player;
  const wallet = p.custody === 'wallet';

  const load = useCallback(async () => {
    try {
      const r = await api<TaniBotResponse>('GET', '/api/tanibot');
      setData(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => (void load(), setNow(Date.now())), watch ? 1500 : 5000);
    return () => clearInterval(id);
  }, [load, watch]);

  // A watched chain job landed (or failed): green toast with the tx link, or a clear error.
  useEffect(() => {
    if (!watch || !data?.bot) return;
    const entry = data.bot.log.find((l) => l.id === watch.logId);
    if (!entry || entry.txStatus === 'pending') return;
    if (entry.txStatus === 'failed') notify({ kind: 'error', text: watch.failure });
    else notify({ kind: 'success', text: watch.success, link: entry.txUrl ?? undefined });
    watchRef.current = null;
    setWatch(null);
    setPhase(null);
  }, [data, watch, notify]);

  /** Runs a request; keeps the window open and shows errors inline (and as a toast for budget actions). */
  const run = async (fn: () => Promise<TaniBotResponse | void>, button?: Watch['button']) => {
    setBusy(true);
    setError(null);
    if (button) setPhase({ button, phase: 'busy' });
    let keepPhase = false;
    try {
      const r = await fn();
      if (r) {
        setData((d) => ({ ...(d ?? r), ...r }));
        if (r.state) onState(r.state);
      }
      keepPhase = watchRef.current !== null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (button) notify({ kind: 'error', text: msg });
    } finally {
      setBusy(false);
      if (!keepPhase) setPhase(null);
    }
  };
  const step = (button: Watch['button'], p: Phase) => setPhase({ button, phase: p });

  const follow = (r: TaniBotResponse, before: number, w: Omit<Watch, 'logId'>, action: string) => {
    const entry: TaniBotLogEntry | undefined = r.bot?.log.find((l) => l.id > before && l.action === action && l.txStatus === 'pending');
    if (entry) {
      const next = { ...w, logId: entry.id };
      watchRef.current = next;
      setWatch(next);
      step(w.button, 'confirm');
      return;
    }
    // Already on chain (or nothing to wait for).
    const done = r.bot?.log.find((l) => l.id > before && l.action === action);
    if (done?.txStatus === 'failed') notify({ kind: 'error', text: w.failure });
    else notify({ kind: 'success', text: w.success, link: done?.txUrl ?? undefined });
  };
  const lastLogId = () => data?.bot?.log[0]?.id ?? 0;
  const txLink = (hash: string | null) => (hash ? config.explorerTxUrl + hash : undefined);

  const activate = () =>
    run(async () => {
      watchRef.current = null;
      const before = lastLogId();
      const r = await api<TaniBotResponse>('POST', '/api/tanibot/setup', {
        dailyLimit: limit ?? data?.defaults.dailyLimit,
        ...(wallet ? {} : { budget: budget ?? Math.min(data?.defaults.budget ?? 20, Math.floor(p.balance)) }),
      });
      setData(r);
      if (r.state) onState(r.state);
      if (wallet && r.walletCalls) return linkWithWallet(r);
      follow(r, before, activated(r), 'limit');
      return r;
    }, 'activate');

  const activated = (r: TaniBotResponse): Omit<Watch, 'logId'> => ({
    button: 'activate',
    success: `TaniBot activated: daily limit ${r.bot?.dailyLimit ?? limit ?? data?.defaults.dailyLimit} PANEN`,
    failure: 'Activating TaniBot failed on NEAR. Try again.',
  });

  /** Wallet gardens: the wallet signs set_bot (the limit), then the bot accepts on the server. */
  const linkWithWallet = async (r: TaniBotResponse) => {
    const calls = r.walletCalls ?? [
      { receiverId: config.contracts.panen, method: 'set_bot', args: { bot_id: r.bot!.accountId, daily_limit: toUnits(r.bot!.dailyLimit) }, deposit: '1' },
    ];
    step('activate', 'wallet');
    await walletFunctionCalls(config, p.accountId, calls[0].receiverId, calls);
    step('activate', 'confirm');
    const before = lastLogId();
    const linked = await api<TaniBotResponse>('POST', '/api/tanibot/linked');
    follow(linked, before, activated(linked), 'limit');
    return linked;
  };

  const settings = (body: { enabled?: boolean; style?: BotStyle; autoPlant?: 'off' | 'common' }) => run(() => api<TaniBotResponse>('POST', '/api/tanibot/settings', body));

  const addBudget = () =>
    run(async () => {
      watchRef.current = null;
      const w = { button: 'add' as const, success: `Added ${amount} PANEN to TaniBot's budget`, failure: 'Adding budget failed on NEAR. Your PANEN was put back.' };
      const before = lastLogId();
      if (!wallet) {
        const r = await api<TaniBotResponse>('POST', '/api/tanibot/fund', { amount });
        follow(r, before, w, 'budget');
        return r;
      }
      step('add', 'wallet');
      const hash = await walletFunctionCalls(config, p.accountId, config.contracts.panen, [
        { method: 'ft_transfer', args: { receiver_id: bot!.accountId, amount: toUnits(amount), memo: 'TaniBot budget' }, deposit: '1' },
      ]);
      step('add', 'confirm');
      const r = await api<TaniBotResponse>('POST', '/api/tanibot/sync');
      notify({ kind: 'success', text: w.success, link: txLink(hash) });
      return r;
    }, 'add');

  const takeBack = () =>
    run(async () => {
      watchRef.current = null;
      const amt = Math.min(amount, Math.floor(bot!.budget));
      const w = { button: 'back' as const, success: `Took back ${amt} PANEN`, failure: 'Taking budget back failed on NEAR. Nothing changed.' };
      const before = lastLogId();
      if (!wallet) {
        const r = await api<TaniBotResponse>('POST', '/api/tanibot/withdraw', { amount: amt });
        follow(r, before, w, 'budget');
        return r;
      }
      step('back', 'wallet');
      const hash = await walletFunctionCalls(config, p.accountId, config.contracts.panen, [
        { method: 'bot_withdraw', args: { bot_id: bot!.accountId, amount: toUnits(amt) }, deposit: '1' },
      ]);
      step('back', 'confirm');
      const r = await api<TaniBotResponse>('POST', '/api/tanibot/sync');
      notify({ kind: 'success', text: w.success, link: txLink(hash) });
      return r;
    }, 'back');

  const label = (button: Watch['button'], idle: string) => (phase?.button === button ? PHASE_TEXT[phase.phase] : idle);
  const working = busy || phase !== null;

  const bot: TaniBotView | null = data?.bot ?? null;

  return (
    <Modal title="TaniBot" onClose={onClose} closeLabel="Close" class="tanibot-dialog">
      <div class="bot-head">
        {/* A calm portrait: the robot itself with its small idle life (blinking eyes, LEDs), no
            tier effects. The Legend's aura and halo were cut by the window's edge and its light
            scan ran over the face; the full show stays in the garden. */}
        <TaniBot tier={tierOf(p.title)} scale={2} effects={false} />
        <div>
          <b>Your AI farmer with its own NEAR wallet</b>
          <p class="small">
            TaniBot works while you are away: it waters, harvests, sells and buys fertilizer from its own budget. Its only key can burn
            PANEN for Shop purchases; the PANEN contract enforces the daily limit, so it can never spend more or send coins anywhere.
          </p>
          <p class="small muted">
            Brain:{' '}
            {data?.brain === 'ai' ? (
              <>
                <b>NEAR AI</b> ({data.model}). The game checks every AI decision against the rules; simple rules take over if the AI fails.
              </>
            ) : (
              'simple rules (AI is off)'
            )}
          </p>
        </div>
      </div>

      {error && <p class="error-text">{error}</p>}
      {!data && !error && <p class="muted">Loading TaniBot...</p>}

      {data && (!bot || bot.status === 'failed') && (
        <Panel title={bot?.status === 'failed' ? 'Setup failed' : 'Activate TaniBot'}>
          {bot?.status === 'failed' && <p class="error-text small">Creating TaniBot's wallet failed. You can try again.</p>}
          <label class="bot-field">
            <span>Daily spending limit (PANEN)</span>
            <input type="number" min={0} max={data.defaults.maxDailyLimit} value={limit ?? data.defaults.dailyLimit} onInput={(e) => setLimit(Number((e.target as HTMLInputElement).value))} />
          </label>
          {!wallet && (
            <label class="bot-field">
              <span>Starting budget (PANEN, from your {Math.floor(p.balance)})</span>
              <input
                type="number"
                min={0}
                max={Math.floor(p.balance)}
                value={budget ?? Math.min(data.defaults.budget, Math.floor(p.balance))}
                onInput={(e) => setBudget(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          )}
          <p class="small muted">
            {wallet
              ? 'Your wallet confirms the daily limit once (a tiny testnet fee). Add budget afterwards.'
              : 'The game pays every fee. You can switch TaniBot off or take the budget back at any time.'}
          </p>
          <button class="btn btn-mint" disabled={working} onClick={activate}>
            {label('activate', 'Activate TaniBot')}
          </button>
        </Panel>
      )}

      {bot && (bot.status === 'creating' || bot.status === 'linking') && (
        <Panel title="Setting up">
          <p class="small">
            Creating TaniBot's wallet <b>{bot.accountId}</b> on NEAR and linking it to you. This takes a few seconds.
          </p>
          {phase?.button === 'activate' && !(wallet && bot.status === 'linking') && (
            <button class="btn btn-mint" disabled>
              {PHASE_TEXT[phase.phase]}
            </button>
          )}
          {wallet && bot.status === 'linking' && (
            <button class="btn btn-small" disabled={working} onClick={() => run(async () => linkWithWallet({ ...data!, walletCalls: null }), 'activate')}>
              {label('activate', 'Confirm the limit in my wallet again')}
            </button>
          )}
        </Panel>
      )}

      {bot && bot.status === 'ready' && (
        <>
          <Panel title="Status">
            <div class="bot-row">
              <button class={`btn bot-switch ${bot.enabled ? 'on' : 'off'}`} disabled={busy} onClick={() => settings({ enabled: !bot.enabled })} aria-pressed={bot.enabled}>
                {bot.enabled ? 'ON' : 'OFF'}
              </button>
              <span class="small">
                {bot.enabled
                  ? bot.nextRunAt
                    ? bot.nextRunAt <= now
                      ? 'Working on the next round...'
                      : `Next round in ${formatDuration(bot.nextRunAt - now)}`
                    : 'Starting...'
                  : 'Switched off: TaniBot rests.'}
              </span>
            </div>
            <p class="small info-line">
              <b>Working style</b> <Info k="styles" label="the working style" />
            </p>
            <div class="bot-styles" role="radiogroup" aria-label="Working style">
              {STYLES.map((s) => (
                <button key={s.id} role="radio" aria-checked={bot.style === s.id} class={`bot-style${bot.style === s.id ? ' selected' : ''}`} disabled={busy} onClick={() => settings({ style: s.id })}>
                  <b>{s.label}</b>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
            <div class="bot-autoplant" role="radiogroup" aria-label="Auto-plant">
              <span class="small">
                <b>Auto-plant</b> <Info k="autoPlant" label="Auto-plant" />
              </span>
              {(
                [
                  ['off', 'Off'],
                  ['common', 'Common seeds only'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} role="radio" aria-checked={bot.autoPlant === v} class={`btn btn-small${bot.autoPlant === v ? ' btn-mint' : ''}`} disabled={busy} onClick={() => settings({ autoPlant: v })}>
                  {l}
                </button>
              ))}
              <span class="small muted">TaniBot plants Common or unknown seeds in empty plots (a new Tree NFT each). Rare, Gold and superior seeds are always yours to plant.</span>
            </div>
          </Panel>

          <Panel title="Wallet and budget">
            <dl class="profile-facts">
              <dt>Wallet</dt>
              <dd>
                <a href={bot.explorerUrl} {...explorerTarget()}>
                  {bot.accountId}
                </a>
              </dd>
              <dt>
                Budget <Info k="budget" label="TaniBot's budget" />
              </dt>
              <dd>
                <CountNumber value={bot.budget} /> PANEN
              </dd>
              <dt>
                Today <Info k="dailyLimit" label="the daily limit" />
              </dt>
              <dd>
                {bot.spentToday} of {bot.dailyLimit} PANEN spent (limit set in the contract)
              </dd>
            </dl>
            <div class="bot-budget">
              <input type="number" min={1} value={amount} aria-label="Amount of PANEN" onInput={(e) => setAmount(Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value) || 1)))} />
              <button class="btn btn-small btn-mint" disabled={working || (!wallet && amount > p.balance)} onClick={addBudget}>
                {label('add', 'Add budget')}
              </button>
              <Info k="addBudget" label="Add budget" />
              <button class="btn btn-small" disabled={working || bot.budget < 1} onClick={takeBack}>
                {label('back', 'Take back')}
              </button>
              <Info k="takeBack" label="Take back" />
            </div>
            {wallet && <p class="small muted">Your wallet confirms budget changes (a tiny testnet fee).</p>}
          </Panel>
        </>
      )}

      {bot && (
        <Panel title="TaniBot Log">
          {bot.log.length === 0 ? (
            <p class="muted small">Nothing yet.</p>
          ) : (
            <ul class="list bot-log">
              {bot.log.map((l) => (
                <li key={l.id} class={`bot-log-${l.action}`}>
                  <span class="bot-log-icon" aria-hidden="true">
                    {ACTION_ICON[l.action] ?? '.'}
                  </span>
                  <span class="grow">
                    <span class="bot-log-time">{timeOf(l.at)}</span>{' '}
                    {l.brain === 'ai' && (
                      <span class="ai-tag" title="Decided by the NEAR AI brain">
                        AI
                      </span>
                    )}{' '}
                    {l.reason}
                  </span>
                  {l.txUrl ? (
                    <a href={l.txUrl} {...explorerTarget()}>
                      view tx
                    </a>
                  ) : l.txStatus === 'pending' ? (
                    <span class="muted small">sending...</span>
                  ) : l.txStatus === 'failed' ? (
                    <span class="error-text small">failed</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </Modal>
  );
}

/** A number that counts up or down to its new value and flashes green when it changes. */
function CountNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState(0);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    from.current = value;
    setFlash((f) => f + 1);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return setShown(value);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const eased = 1 - (1 - k) ** 3;
      setShown(k >= 1 ? value : Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <b class={`count-num${flash ? ' flash' : ''}`} key={flash}>
      {shown}
    </b>
  );
}

/** PANEN -> smallest units (18 decimals) as a string. */
function toUnits(panen: number): string {
  return (BigInt(Math.round(panen * 1_000_000)) * 10n ** 12n).toString();
}
