// App shell: login, garden creation, polling, tabs, sounds, dialogs and the blockchain "flash".

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ACTIVITY_LABELS, api, ApiError, hasToken, setToken, type Activity, type GameState, type Quality, type ServerConfig, type Species } from './api';
import { botVersion, TaniBot, TaniBotHead } from './art/tanibot';
import { getAudioPrefs, initAudio, onAudioPrefsChange, playSound, setAudioPrefs, type SoundName } from './audio';
import { useFullscreen } from './fullscreen';
import { HowToPlay, PanenInfo } from './help';
import { ShareHost, shareMomentOnce } from './share';
import { burnAt, coinsToBalance, confetti, floatText, FxLayer } from './fx';
import { CheckinBanner, Garden, type Choice } from './garden';
import { immersiveLayout } from './scene';
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
  choices: Choice[];
  resolve: (value: string | null) => void;
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
  '/api/seeds/sell': 'coins',
  '/api/seeds/discard': 'click',
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

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

const DRAWER_KEY = 'nearvest.drawer';
/** Width of the right drawer (open) and of the icon rail (closed), and the action bar height. */
const DRAWER_W = 400;
const RAIL_W = 64;
const BAR_H = 128;

function readDrawer(): boolean {
  try {
    return localStorage.getItem(DRAWER_KEY) !== '0';
  } catch {
    return true;
  }
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
  const [audio, setAudio] = useState(getAudioPrefs());
  const fullscreen = useFullscreen();
  const [info, setInfo] = useState<'help' | 'panen' | null>(null);
  const seenDone = useRef<Set<number> | null>(null);
  const lastTitle = useRef<string | null>(null);
  const wide = useWide();
  const win = useWindowSize();
  const [drawerOpen, setDrawerOpenState] = useState(readDrawer);
  const setDrawerOpen = (open: boolean) => {
    setDrawerOpenState(open);
    try {
      localStorage.setItem(DRAWER_KEY, open ? '1' : '0');
    } catch {
      // Storage blocked: remembered for this visit only.
    }
  };

  useEffect(() => onAudioPrefsChange(setAudio), []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Math.random();
    setToasts((list) => [...list.slice(-1), { ...t, id }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.kind === 'chain' ? 6000 : 3500);
  }, []);

  /** Dialog with several choices; resolves to the chosen value, or null for Cancel. */
  const choose = useCallback(
    (message: string, choices: Choice[]) => new Promise<string | null>((resolve) => setDialog({ message, choices, resolve })),
    [],
  );
  const ask = useCallback(
    async (message: string, confirmLabel: string) => (await choose(message, [{ value: 'ok', label: confirmLabel, class: 'btn-gold' }])) === 'ok',
    [choose],
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
        const evolved = botVersion(s.player.title) > botVersion(lastTitle.current);
        playSound('levelup');
        confetti();
        floatText(`${s.player.title}!`, 'mint', window.innerWidth / 2, window.innerHeight / 3);
        toast({ kind: 'info', text: evolved ? `New title: ${s.player.title}! TaniBot evolved.` : `New title: ${s.player.title}!` });
        const id = s.player.accountId;
        if (evolved) shareMomentOnce(id, { kind: 'evolved' }, 2200);
        else if (s.player.title === 'Legend') shareMomentOnce(id, { kind: 'legend' }, 2200);
        else shareMomentOnce(id, { kind: 'title', title: s.player.title }, 2200);
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
        moments(path, res.result, res.state);
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
    <div class="icon-row">
      <button class="icon-btn help-btn" onClick={() => (playSound('click'), setInfo('help'))} aria-label="How to play" title="How to play">
        ?
      </button>
      <button
        class="icon-btn"
        onClick={() => setAudioPrefs({ music: !audio.music })}
        aria-pressed={audio.music}
        aria-label={audio.music ? 'Turn music off' : 'Turn music on'}
        title={audio.music ? 'Music on' : 'Music off'}
      >
        <Sprite name={audio.music ? 'music' : 'musicOff'} scale={3} />
      </button>
      <button
        class="icon-btn"
        onClick={() => setAudioPrefs({ sfx: !audio.sfx })}
        aria-pressed={audio.sfx}
        aria-label={audio.sfx ? 'Turn sound effects off' : 'Turn sound effects on'}
        title={audio.sfx ? 'Sound effects on' : 'Sound effects off'}
      >
        <Sprite name={audio.sfx ? 'speaker' : 'speakerOff'} scale={3} />
      </button>
      {fullscreen.supported && wide && (
        <button
          class="icon-btn"
          onClick={fullscreen.toggle}
          aria-label={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
          title={fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'}
        >
          <Sprite name={fullscreen.active ? 'fullscreenExit' : 'fullscreen'} scale={3} />
        </button>
      )}
    </div>
  );

  const dialogView = dialog && (
    <div class="dialog-backdrop" role="presentation">
      <div class="dialog panel" role="dialog" aria-modal="true" aria-labelledby="dialog-text">
        <p id="dialog-text">{dialog.message}</p>
        <div class={`dialog-actions${dialog.choices.length > 1 ? ' many' : ''}`}>
          <button
            class="btn"
            onClick={() => {
              dialog.resolve(null);
              setDialog(null);
            }}
          >
            Cancel
          </button>
          {dialog.choices.map((c) => (
            <button
              key={c.value}
              class={`btn ${c.class ?? 'btn-gold'}`}
              onClick={() => {
                dialog.resolve(c.value);
                setDialog(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (fatal) {
    return (
      <main class="shell center">
        <TaniBot version={1} scale={2} />
        <h1>NEARvest</h1>
        <p class="error-text">{fatal}</p>
        <p class="muted small">Start the server with "npm run dev" in the server folder, then reload.</p>
      </main>
    );
  }
  if (phase === 'loading' || !config) {
    return (
      <main class="shell center">
        <TaniBot version={1} scale={2} />
        <p class="muted">Waking up the village...</p>
      </main>
    );
  }
  const infoView =
    info === 'help' ? (
      <HowToPlay onClose={() => setInfo(null)} />
    ) : info === 'panen' ? (
      <PanenInfo state={state} config={config} onClose={() => setInfo(null)} />
    ) : null;
  if (phase === 'login') {
    return (
      <>
        <Login config={config} onLoggedIn={onLoggedIn} onHelp={() => setInfo('help')} />
        {infoView}
      </>
    );
  }
  if (phase === 'create') return <CreateGarden onCreated={(s) => (applyState(s), setPhase('play'))} onLogout={logout} />;
  if (!state) return null;

  const elapsed = now - loadedAt;
  const p = state.player;
  const xpFrom = p.nextTitle ? xpFloor(p.xp) : p.xp;
  const xpPct = p.nextTitle ? Math.round(((p.xp - xpFrom) / (p.nextTitle.xp - xpFrom)) * 100) : 100;

  const openSide = (t: SideTab) => {
    setSideTab(t);
    setDrawerOpen(true);
  };
  const goShop = () => (wide ? openSide('shop') : setTab('shop'));
  const goSell = () => (wide ? openSide('market') : setTab('market'));
  const immersive = wide ? immersiveLayout(win.width, win.height, drawerOpen ? DRAWER_W : RAIL_W, BAR_H) : undefined;
  const garden = (
    <Garden
      state={state}
      config={config}
      act={act}
      ask={ask}
      choose={choose}
      elapsed={elapsed}
      busy={busy}
      goShop={goShop}
      showCheckin={!wide}
      big={wide}
      immersive={immersive}
    />
  );
  const panelFor = (t: SideTab) =>
    t === 'storage' ? (
      <Storage state={state} config={config} act={act} busy={busy} goSell={goSell} />
    ) : t === 'shop' ? (
      <Shop state={state} config={config} act={act} busy={busy} />
    ) : t === 'market' ? (
      <Market state={state} config={config} sell={sell} act={act} busy={busy} />
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

  const who = (
    <div class="who">
      <span class="head-bot">
        <TaniBotHead version={botVersion(p.title)} scale={wide ? 2 : 1} />
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
  );
  const balanceView = (
    <button class="balance" title="Your PANEN balance: what is PANEN?" onClick={() => (playSound('click'), setInfo('panen'))} aria-label={`${formatPanen(p.balance)} PANEN. What is PANEN?`}>
      <Coin scale={3} />
      <span>{formatPanen(p.balance)}</span>
    </button>
  );
  const dayInfo = (
    <span>
      Farm day {state.clock.farmDay} · next day in {formatDuration(state.clock.msUntilNextDay - elapsed)}
      {p.demo && <span class="tag tag-demo">Demo: 1 day = 1 min</span>}
    </span>
  );
  const signOut = (
    <button class="link-btn" onClick={logout}>
      Sign out
    </button>
  );
  const notices = (
    <>
      {p.accountStatus === 'pending' && <p class="notice">Creating your NEAR account {p.accountId}...</p>}
      {p.accountStatus === 'failed' && <p class="notice error-text">Your NEAR account could not be created.</p>}
    </>
  );

  return (
    <main class={`shell${wide ? ' wide immersive' : ''}${wide && drawerOpen ? ' drawer-open' : ''}`}>
      {wide ? (
        <>
          {garden}
          <header class="hud hud-top">
            {who}
            <div class="hud-day">
              {dayInfo}
              {notices}
            </div>
            <div class="topbar-right">
              {muteButton}
              {balanceView}
            </div>
            {signOut}
          </header>

          <aside class="hud hud-drawer" aria-label="Menu" aria-hidden={!drawerOpen} inert={!drawerOpen}>
            <div class="drawer-head">
              <span>Menu</span>
              <button class="icon-btn drawer-close" onClick={() => (playSound('click'), setDrawerOpen(false))} aria-label="Close the menu" title="Close the menu (enjoy the garden)">
                {'>'}
              </button>
            </div>
            <div class="drawer-scroll">
              <CheckinBanner state={state} act={act} ask={ask} busy={busy} />
              <nav class="side-tabs" aria-label="Panels">
                {(['storage', 'shop', 'market', 'village'] as SideTab[]).map((t) => (
                  <TabButton key={t} tab={t} current={sideTab} set={(x) => (playSound('click'), setSideTab(x as SideTab))} icon={tabIcons[t]} label={tabLabels[t]} />
                ))}
              </nav>
              <div class="content">{panelFor(sideTab)}</div>
            </div>
          </aside>
          {!drawerOpen && (
            <nav class="hud hud-rail" aria-label="Open the menu">
              {state.checkin.available && (
                <button class="rail-btn rail-checkin" onClick={() => (playSound('click'), setDrawerOpen(true))} title="Daily check-in is ready">
                  <Sprite name="seedPacket" scale={3} />
                  <span>Check in</span>
                </button>
              )}
              {(['storage', 'shop', 'market', 'village'] as SideTab[]).map((t) => (
                <button key={t} class="rail-btn" onClick={() => (playSound('click'), openSide(t))} title={tabLabels[t]}>
                  {tabIcons[t]}
                  <span>{tabLabels[t]}</span>
                </button>
              ))}
            </nav>
          )}
        </>
      ) : (
        <>
          <header class="topbar">
            {who}
            <div class="topbar-right">
              {muteButton}
              {balanceView}
            </div>
          </header>
          <div class="subbar">
            {dayInfo}
            {signOut}
          </div>
          {notices}
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
      {infoView}
      <ShareHost state={state} />
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

/** Opens a share card the first time a big moment happens. */
function moments(path: string, result: unknown, s: GameState) {
  const r = (result ?? {}) as { kind?: string; firstHarvest?: boolean; species?: Species; quality?: Quality; calendarDay?: number };
  const id = s.player.accountId;
  if (path === '/api/harvest' && r.kind === 'fruit' && r.firstHarvest) shareMomentOnce(id, { kind: 'first_harvest', species: r.species, quality: r.quality });
  if (path === '/api/plant' && r.quality === 'gold') shareMomentOnce(id, { kind: 'first_gold', species: r.species, quality: 'gold' });
  if (path === '/api/checkin' && r.calendarDay === 7) shareMomentOnce(id, { kind: 'streak7' });
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

function Login({ config, onLoggedIn, onHelp }: { config: ServerConfig; onLoggedIn: (token: string, s: GameState | null) => void; onHelp: () => void }) {
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
    <div class="login-page">
      <div class="login-bg" aria-hidden="true" />
    <main class="shell center login">
      <TaniBot version={1} scale={3} />
      <h1 class="logo">NEARvest</h1>
      <p class="tagline">Grow. Harvest. Own.</p>
      <p class="login-lead">A pixel farming game where your tree is a living NFT and an AI farmer tends it while you sleep.</p>
      <ul class="login-points">
        <li>Plant a seed and a Tree NFT is born on NEAR. It grows and changes as you water it.</li>
        <li>Harvest fruit, sell it to Mr. Darto and earn $PANEN. Spend it in the Shop (it is burned).</li>
        <li>Goal: build the best orchard in Tandur and rise from Seedling to Legend.</li>
      </ul>
      <button class="btn how-btn" onClick={onHelp}>
        How to play
      </button>

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
      <p class="login-foot small">Runs on NEAR {config.network}. No wallet, no gas fees. Testnet tokens have no real value.</p>
    </main>
    </div>
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
      <TaniBot version={1} scale={2} />
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
