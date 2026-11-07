// TaniBot window: activate, on/off, working style, budget and the Log
// (every action with its reason and the NEAR transaction that proves it).

import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, type BotStyle, type GameState, type ServerConfig, type TaniBotResponse, type TaniBotView } from './api';
import { botVersion, TaniBot } from './art/tanibot';
import { Modal } from './help';
import { Panel } from './ui';
import { formatDuration } from './ui';
import { walletFunctionCalls } from './wallet';

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
};

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TaniBotWindow({
  state,
  config,
  onState,
  onClose,
}: {
  state: GameState;
  config: ServerConfig;
  onState: (s: GameState) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<TaniBotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    const id = setInterval(() => (void load(), setNow(Date.now())), 5000);
    return () => clearInterval(id);
  }, [load]);

  /** Runs a request; keeps the window open and shows errors inline. */
  const run = async (fn: () => Promise<TaniBotResponse | void>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r) {
        setData((d) => ({ ...(d ?? r), ...r }));
        if (r.state) onState(r.state);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const activate = () =>
    run(async () => {
      const r = await api<TaniBotResponse>('POST', '/api/tanibot/setup', {
        dailyLimit: limit ?? data?.defaults.dailyLimit,
        ...(wallet ? {} : { budget: budget ?? Math.min(data?.defaults.budget ?? 20, Math.floor(p.balance)) }),
      });
      setData(r);
      if (r.state) onState(r.state);
      if (wallet && r.walletCalls) await linkWithWallet(r);
      return r;
    });

  /** Wallet gardens: the wallet signs set_bot (the limit), then the bot accepts on the server. */
  const linkWithWallet = async (r: TaniBotResponse) => {
    const calls = r.walletCalls ?? [
      { receiverId: config.contracts.panen, method: 'set_bot', args: { bot_id: r.bot!.accountId, daily_limit: toUnits(r.bot!.dailyLimit) }, deposit: '1' },
    ];
    await walletFunctionCalls(config, p.accountId, calls[0].receiverId, calls);
    setData(await api<TaniBotResponse>('POST', '/api/tanibot/linked'));
  };

  const settings = (body: { enabled?: boolean; style?: BotStyle }) => run(() => api<TaniBotResponse>('POST', '/api/tanibot/settings', body));

  const addBudget = () =>
    run(async () => {
      if (!wallet) return api<TaniBotResponse>('POST', '/api/tanibot/fund', { amount });
      await walletFunctionCalls(config, p.accountId, config.contracts.panen, [
        { method: 'ft_transfer', args: { receiver_id: bot!.accountId, amount: toUnits(amount), memo: 'TaniBot budget' }, deposit: '1' },
      ]);
      return api<TaniBotResponse>('POST', '/api/tanibot/sync');
    });

  const takeBack = () =>
    run(async () => {
      const amt = Math.min(amount, Math.floor(bot!.budget));
      if (!wallet) return api<TaniBotResponse>('POST', '/api/tanibot/withdraw', { amount: amt });
      await walletFunctionCalls(config, p.accountId, config.contracts.panen, [
        { method: 'bot_withdraw', args: { bot_id: bot!.accountId, amount: toUnits(amt) }, deposit: '1' },
      ]);
      return api<TaniBotResponse>('POST', '/api/tanibot/sync');
    });

  const bot: TaniBotView | null = data?.bot ?? null;

  return (
    <Modal title="TaniBot" onClose={onClose} closeLabel="Close" class="tanibot-dialog">
      <div class="bot-head">
        <TaniBot version={botVersion(p.title)} scale={2} />
        <div>
          <b>Your AI farmer with its own NEAR wallet</b>
          <p class="small">
            TaniBot works while you are away: it waters, harvests, sells and buys fertilizer from its own budget. Its only key can burn
            PANEN for Shop purchases; the PANEN contract enforces the daily limit, so it can never spend more or send coins anywhere.
          </p>
          <p class="small muted">Brain: {(data?.brain ?? 'rules') === 'ai' ? 'NEAR AI Cloud' : 'simple rules (AI is off)'}</p>
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
          <button class="btn btn-mint" disabled={busy} onClick={activate}>
            {busy ? 'Setting up...' : 'Activate TaniBot'}
          </button>
        </Panel>
      )}

      {bot && (bot.status === 'creating' || bot.status === 'linking') && (
        <Panel title="Setting up">
          <p class="small">
            Creating TaniBot's wallet <b>{bot.accountId}</b> on NEAR and linking it to you. This takes a few seconds.
          </p>
          {wallet && bot.status === 'linking' && (
            <button class="btn btn-small" disabled={busy} onClick={() => run(async () => linkWithWallet({ ...data!, walletCalls: null }))}>
              Confirm the limit in my wallet again
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
            <div class="bot-styles" role="radiogroup" aria-label="Working style">
              {STYLES.map((s) => (
                <button key={s.id} role="radio" aria-checked={bot.style === s.id} class={`bot-style${bot.style === s.id ? ' selected' : ''}`} disabled={busy} onClick={() => settings({ style: s.id })}>
                  <b>{s.label}</b>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Wallet and budget">
            <dl class="profile-facts">
              <dt>Wallet</dt>
              <dd>
                <a href={bot.explorerUrl} target="_blank" rel="noreferrer">
                  {bot.accountId}
                </a>
              </dd>
              <dt>Budget</dt>
              <dd>{bot.budget} PANEN</dd>
              <dt>Today</dt>
              <dd>
                {bot.spentToday} of {bot.dailyLimit} PANEN spent (limit set in the contract)
              </dd>
            </dl>
            <div class="bot-budget">
              <input type="number" min={1} value={amount} aria-label="Amount of PANEN" onInput={(e) => setAmount(Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value) || 1)))} />
              <button class="btn btn-small btn-mint" disabled={busy || (!wallet && amount > p.balance)} onClick={addBudget}>
                Add budget
              </button>
              <button class="btn btn-small" disabled={busy || bot.budget < 1} onClick={takeBack}>
                Take back
              </button>
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
                    <span class="bot-log-time">{timeOf(l.at)}</span> {l.reason}
                  </span>
                  {l.txUrl ? (
                    <a href={l.txUrl} target="_blank" rel="noreferrer">
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

/** PANEN -> smallest units (18 decimals) as a string. */
function toUnits(panen: number): string {
  return (BigInt(Math.round(panen * 1_000_000)) * 10n ** 12n).toString();
}
