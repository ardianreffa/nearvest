// App shell: login, garden creation, polling, tabs, sounds, dialogs and the blockchain "flash".

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ACTIVITY_LABELS, api, ApiError, hasToken, setToken, type Activity, type GameState, type Quality, type ServerConfig, type Species } from './api';
import { botVersion, TaniBotHead } from './art/tanibot';
import { initAudio, isMuted, onMuteChange, playSound, setMuted, type SoundName } from './audio';
import { burnAt, coinsToBalance, confetti, floatText, FxLayer } from './fx';
import { CheckinBanner, Garden } from './garden';
import { Market, Shop, Storage, Village } from './panels';
import { Sprite } from './sprites';
import { Coin, formatDuration, formatPanen, QUALITY_NAME, SPECIES_NAME } from './ui';

type Tab = 'garden' | 'storage' | 'shop' | 'market' | 'village';
type SideTab = Exclude<Tab, 'garden'>;

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'chain';
  link?: string;
}

interface Dialog {
  message: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

/** Sound for each successful action. */
const ACTION_SOUNDS: Record<string, SoundName> = {
  '/api/checkin': 'checkin',
  '/api/plant': 'plant',
  '/api/water': 'water',
  '/api/fertilize': 'plant',
  '/api/harvest': 'harvest',
  '/api/sell': 'coins',
  '/api/shop/buy': 'burn',
  '/api/chop': 'click',
};

const WIDE_QUERY = '(min-width: 1024px)';

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

initAudio();

export function App() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [phase, setPhase] = useState<'loading' | 'login' | 'create' | 'play'>('loading');
  const [fatal, setFatal] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('garden');
  const [sideTab, setSideTab] = useState<SideTab>('storage');
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const seenDone = useRef<Set<number> | null>(null);
  const lastTitle = useRef<string | null>(null);
  const wide = useWide();

  useEffect(() => onMuteChange(setMutedState), []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random();
    setToasts((list) => [...list.slice(-1), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.kind === 'chain' ? 6000 : 3500);
  }, []);

  const ask = useCallback(
    (message: string, confirmLabel: string) => new Promise<boolean>((resolve) => setDialog({ message, confirmLabel, resolve })),
    [],
  );

  /** Applies new state: chain flash for landed jobs, level-up fanfare for a new title. */
  const applyState = useCallback(
    (s: GameState) => {
      const done = s.activity.filter((a) => a.status === 'done');
      if (seenDone.current === null) {
        seenDone.current = new Set(done.map((a) => a.id));
      } else {
        const fresh = done.filter((a) => !seenDone.current!.has(a.id));
        for (const a of fresh) seenDone.current.add(a.id);
        if (fresh.length > 0) {
          setFlash((f) => f + 1);
          playSound('chain');
          const latest: Activity = fresh[fresh.length - 1];
          toast({
            kind: 'chain',
            text: `${ACTIVITY_LABELS[latest.kind] ?? latest.kind}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`,
            link: latest.explorerUrl ?? undefined,
          });
        }
      }
      if (lastTitle.current !== null && lastTitle.current !== s.player.title) {
        playSound('levelup');
        confetti();
        floatText(`${s.player.title}!`, 'mint', window.innerWidth / 2, window.innerHeight / 3);
        toast({ kind: 'info', text: `New title: ${s.player.title}! TaniBot got an upgrade.` });
      }
      lastTitle.current = s.player.title;
      setState(s);
      setLoadedAt(Date.now());
    },
    [toast],
  );

  const resetSession = () => {
    seenDone.current = null;
    lastTitle.current = null;
  };

  const refresh = useCallback(async () => {
    try {
      applyState(await api<GameState>('GET', '/api/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setPhase('login');
      } else if (e instanceof ApiError && e.status === 404) {
        setPhase('create');
      }
    }
  }, [applyState]);

  // Boot: server config, then the session if there is one.
  useEffect(() => {
    api<ServerConfig>('GET', '/api/config')
      .then(async (c) => {
        setConfig(c);
        if (!hasToken()) return setPhase('login');
        try {
          applyState(await api<GameState>('GET', '/api/me'));
          setPhase('play');
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) setPhase('create');
          else {
            setToken(null);
            setPhase('login');
          }
        }
      })
      .catch((e: Error) => setFatal(e.message));
  }, [applyState]);

  // Poll faster while transactions are on their way.
  const pending = state?.activity.some((a) => a.status === 'pending') ?? false;
  useEffect(() => {
    if (phase !== 'play') return;
    const id = setInterval(refresh, pending ? 2500 : 8000);
    return () => clearInterval(id);
  }, [phase, pending, refresh]);

  // Clock tick for countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const act = useCallback(
    async (path: string, body?: unknown, success?: string): Promise<unknown | null> => {
      setBusy(true);
      try {
        const res = await api<{ state: GameState; result: unknown }>('POST', path, body ?? {});
        playSound(ACTION_SOUNDS[path] ?? 'click');
        juice(path, res.result);
        applyState(res.state);
        if (success) toast({ kind: 'info', text: success });
        return res.result ?? {};
      } catch (e) {
        playSound('error');
        toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [applyState, toast],
  );

  /** Sells at the price shown; if Mr. Darto's price changed meanwhile, asks before selling at the new one. */
  const sell = useCallback(
    async (species: Species, quality: Quality, qty: number, shownPrice: number) => {
      const mult = { common: 1, rare: 2, gold: 5 }[quality];
      const label = `${qty} ${QUALITY_NAME[quality]} ${SPECIES_NAME[species]}`;
      let price = shownPrice;
      for (let attempt = 0; attempt < 3; attempt++) {
        setBusy(true);
        try {
          const res = await api<{ state: GameState }>('POST', '/api/sell', { species, quality, qty, expectedPrice: price });
          playSound('coins');
          const earned = (res as { result?: { expectedPanen?: number } }).result?.expectedPanen ?? price * mult * qty;
          floatText(`+${formatPanen(earned)} PANEN`, 'gold');
          coinsToBalance(Math.min(10, 3 + qty * 2));
          applyState(res.state);
          toast({ kind: 'info', text: `Sold ${label} for ${formatPanen(earned)} PANEN` });
          return;
        } catch (e) {
          if (e instanceof ApiError && e.data.code === 'price_changed' && typeof e.data.price === 'number') {
            setBusy(false);
            const newPrice = e.data.price;
            const ok = await ask(
              `A new day started and Mr. Darto changed his price: ${price} -> ${newPrice} per fruit. Sell ${label} for ${newPrice * mult * qty} PANEN?`,
              `Sell for ${newPrice * mult * qty}`,
            );
            if (!ok) {
              void refresh();
              return;
            }
            price = newPrice;
            continue;
          }
          playSound('error');
          toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
          return;
        } finally {
          setBusy(false);
        }
      }
    },
    [applyState, ask, refresh, toast],
  );

  const onLoggedIn = (token: string, s: GameState | null) => {
    setToken(token);
    resetSession();
    if (s) {
      applyState(s);
      setPhase('play');
    } else setPhase('create');
  };

  const logout = async () => {
    await api('POST', '/auth/logout').catch(() => undefined);
    setToken(null);
    setState(null);
    resetSession();
    setPhase('login');
  };

  // Bump the balance when it changes.
  const balance = state?.player.balance;
  const lastBalance = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = document.querySelector('.balance');
    if (el && lastBalance.current !== undefined && balance !== lastBalance.current) {
      el.classList.remove('bump');
      void (el as HTMLElement).offsetWidth;
      el.classList.add('bump');
    }
    lastBalance.current = balance;
  }, [balance]);

  const muteButton = (
    <button class="icon-btn" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute sound' : 'Mute sound'} title={muted ? 'Sound off' : 'Sound on'}>
      <Sprite name={muted ? 'speakerOff' : 'speaker'} scale={3} />
    </button>
  );

  const dialogView = dialog && (
    <div class="dialog-backdrop" role="presentation">
      <div class="dialog panel" role="dialog" aria-modal="true" aria-labelledby="dialog-text">
        <p id="dialog-text">{dialog.message}</p>
        <div class="dialog-actions">
          <button
            class="btn"
            onClick={() => {
              dialog.resolve(false);
              setDialog(null);
            }}
          >
            Cancel
          </button>
          <button
            class="btn btn-gold"
            onClick={() => {
              dialog.resolve(true);
              setDialog(null);
            }}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (fatal) {
    return (
      <main class="shell center">
        <Sprite name="taniBot" scale={5} />
        <h1>NEARvest</h1>
        <p class="error-text">{fatal}</p>
        <p class="muted small">Start the server with "npm run dev" in the server folder, then reload.</p>
      </main>
    );
  }
  if (phase === 'loading' || !config) {
    return (
      <main class="shell center">
        <Sprite name="taniBot" scale={5} />
        <p class="muted">Waking up the village...</p>
      </main>
    );
  }
  if (phase === 'login') return <Login config={config} onLoggedIn={onLoggedIn} />;
  if (phase === 'create') return <CreateGarden onCreated={(s) => (applyState(s), setPhase('play'))} onLogout={logout} />;
  if (!state) return null;

  const elapsed = now - loadedAt;
  const p = state.player;
  const xpFrom = p.nextTitle ? xpFloor(p.xp) : p.xp;
  const xpPct = p.nextTitle ? Math.round(((p.xp - xpFrom) / (p.nextTitle.xp - xpFrom)) * 100) : 100;

  const goShop = () => (wide ? setSideTab('shop') : setTab('shop'));
  const goSell = () => (wide ? setSideTab('market') : setTab('market'));
  const garden = <Garden state={state} act={act} ask={ask} elapsed={elapsed} busy={busy} goShop={goShop} showCheckin={!wide} big={wide} />;
  const panelFor = (t: SideTab) =>
    t === 'storage' ? (
      <Storage state={state} goSell={goSell} />
    ) : t === 'shop' ? (
      <Shop state={state} config={config} act={act} busy={busy} />
    ) : t === 'market' ? (
      <Market state={state} sell={sell} busy={busy} />
    ) : (
      <Village state={state} config={config} />
    );

  const tabIcons: Record<Tab, ComponentChildren> = {
    garden: <Sprite name="sprout" scale={2} />,
    storage: <Sprite name="seedPacket" scale={3} />,
    shop: <Coin scale={3} />,
    market: <Sprite name="darto" scale={2} />,
    village: <Sprite name="bolt" scale={3} />,
  };
  const tabLabels: Record<Tab, string> = { garden: 'Garden', storage: 'Storage', shop: 'Shop', market: 'Market', village: 'Village' };

  return (
    <main class={`shell${wide ? ' wide' : ''}`}>
      <header class="topbar">
        <div class="who">
          <span class="head-bot">
            <TaniBotHead version={botVersion(p.title)} scale={wide ? 3 : 2} />
          </span>
          <div>
            <div class="name">{p.name}</div>
            <div class="title-line">
              {p.title} · {p.xp} XP
            </div>
            <div class="xp" aria-label="XP to next title">
              <div style={{ width: `${xpPct}%` }} />
            </div>
          </div>
        </div>
        <div class="topbar-right">
          {muteButton}
          <div class="balance" title="Your PANEN balance">
            <Coin scale={3} />
            <span>{formatPanen(p.balance)}</span>
          </div>
        </div>
      </header>

      <div class="subbar">
        <span>
          Farm day {state.clock.farmDay} · next day in {formatDuration(state.clock.msUntilNextDay - elapsed)}
          {p.demo && <span class="tag tag-demo">Demo: 1 day = 1 min</span>}
        </span>
        <button class="link-btn" onClick={logout}>
          Sign out
        </button>
      </div>
      {p.accountStatus === 'pending' && <p class="notice">Creating your NEAR account {p.accountId}...</p>}
      {p.accountStatus === 'failed' && <p class="notice error-text">Your NEAR account could not be created.</p>}

      {wide ? (
        <div class="wide-grid">
          <div class="wide-left">{garden}</div>
          <div class="wide-right">
            <CheckinBanner state={state} act={act} busy={busy} />
            <nav class="side-tabs" aria-label="Panels">
              {(['storage', 'shop', 'market', 'village'] as SideTab[]).map((t) => (
                <TabButton key={t} tab={t} current={sideTab} set={(x) => (playSound('click'), setSideTab(x as SideTab))} icon={tabIcons[t]} label={tabLabels[t]} />
              ))}
            </nav>
            <div class="content">{panelFor(sideTab)}</div>
          </div>
        </div>
      ) : (
        <>
          <div class="content">{tab === 'garden' ? garden : panelFor(tab)}</div>
          <nav class="tabs">
            {(['garden', 'storage', 'shop', 'market', 'village'] as Tab[]).map((t) => (
              <TabButton key={t} tab={t} current={tab} set={(x) => (playSound('click'), setTab(x))} icon={tabIcons[t]} label={tabLabels[t]} />
            ))}
          </nav>
        </>
      )}

      {flash > 0 && <div class="chain-flash" key={flash} aria-hidden="true" />}
      <div class="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`toast toast-${t.kind}`}>
            {t.kind === 'chain' && <Sprite name="bolt" scale={2} />}
            <span>
              {t.kind === 'chain' ? 'On NEAR: ' : ''}
              {t.text}
            </span>
            {t.link && (
              <a href={t.link} target="_blank" rel="noreferrer">
                view tx
              </a>
            )}
          </div>
        ))}
      </div>
      {dialogView}
      <FxLayer />
    </main>
  );
}

/** Floating numbers, coins and flames for actions with a PANEN effect. */
function juice(path: string, result: unknown) {
  const r = (result ?? {}) as { rewards?: string[]; burnedPanen?: number };
  if (path === '/api/checkin' && r.rewards?.[0]) {
    floatText(`+${r.rewards[0]}`, 'gold');
    coinsToBalance(4);
  } else if (path === '/api/shop/buy' && r.burnedPanen) {
    burnAt();
    floatText(`-${r.burnedPanen} PANEN`, 'burn');
  }
}

const TITLE_XP = [0, 50, 200, 600, 1500, 4000];
function xpFloor(xp: number): number {
  let floor = 0;
  for (const t of TITLE_XP) if (xp >= t) floor = t;
  return floor;
}

function TabButton({ tab, current, set, icon, label }: { tab: Tab; current: Tab; set: (t: Tab) => void; icon: ComponentChildren; label: string }) {
  return (
    <button class={`tab${tab === current ? ' active' : ''}`} onClick={() => set(tab)} aria-current={tab === current ? 'page' : undefined}>
      <span class="tab-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Login({ config, onLoggedIn }: { config: ServerConfig; onLoggedIn: (token: string, s: GameState | null) => void }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const devLogin = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; player: GameState | null }>('POST', '/auth/dev', { username: username.trim().toLowerCase() });
      onLoggedIn(res.token, res.player);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="shell center login">
      <Sprite name="taniBot" scale={6} />
      <h1 class="logo">NEARvest</h1>
      <p class="tagline">Grow. Harvest. Own.</p>
      <p class="muted">A pixel farming game where your tree is a living NFT and an AI farmer tends it while you sleep.</p>

      <GoogleButton clientId={config.googleClientId} onLoggedIn={onLoggedIn} onError={setError} />

      {config.devLogin && (
        <form class="dev-login" onSubmit={devLogin}>
          <label for="dev-user">Dev login (local testing)</label>
          <div class="row">
            <input id="dev-user" value={username} onInput={(e) => setUsername((e.target as HTMLInputElement).value)} placeholder="username" autocomplete="off" />
            <button class="btn btn-mint" disabled={busy || username.trim().length < 2}>
              Enter
            </button>
          </div>
        </form>
      )}
      {error && <p class="error-text">{error}</p>}
      <p class="muted small">Runs on NEAR {config.network}. No wallet, no gas fees.</p>
    </main>
  );
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** "Sign in with Google" (Google Identity Services). Shows a placeholder until a Client ID is configured. */
function GoogleButton({ clientId, onLoggedIn, onError }: { clientId: string | null; onLoggedIn: (t: string, s: GameState | null) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!clientId || !ref.current) return;
    const render = () => {
      window.google!.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            const res = await api<{ token: string; player: GameState | null }>('POST', '/auth/google', { credential });
            onLoggedIn(res.token, res.player);
          } catch (e) {
            onError(e instanceof Error ? e.message : String(e));
          }
        },
      });
      window.google!.accounts.id.renderButton(ref.current!, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
    };
    if (window.google) return render();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [clientId]);

  if (!clientId) {
    return (
      <button class="btn btn-google" disabled title="Google login is being set up">
        Sign in with Google (coming soon)
      </button>
    );
  }
  return <div class="google-slot" ref={ref} />;
}

function CreateGarden({ onCreated, onLogout }: { onCreated: (s: GameState) => void; onLogout: () => void }) {
  const [name, setName] = useState('');
  const [demo, setDemo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = name.trim().toLowerCase();

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<GameState>('POST', '/api/player', { name: clean, demo }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="shell center">
      <Sprite name="taniBot" scale={5} />
      <h1>Welcome to Tandur!</h1>
      <p class="muted">Choose your farmer name. It becomes your NEAR account and how friends find you.</p>
      <form class="create" onSubmit={submit}>
        <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="your-name" maxLength={32} autocomplete="off" />
        <p class="account-preview">{clean || 'your-name'}.nearvest.testnet</p>
        <label class="check">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo((e.target as HTMLInputElement).checked)} />
          Demo mode: 1 game day = 1 minute
        </label>
        <button class="btn btn-mint" disabled={busy || clean.length < 2}>
          {busy ? 'Planting your garden...' : 'Start farming'}
        </button>
      </form>
      <p class="muted small">Welcome pack: 50 PANEN + 1 Rare Durian seed.</p>
      {error && <p class="error-text">{error}</p>}
      <button class="link-btn" onClick={onLogout}>
        Use another login
      </button>
    </main>
  );
}
