// App shell: login, garden creation, polling, tabs, sounds, dialogs and the blockchain "flash".

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ACTIVITY_LABELS, api, ApiError, hasToken, setToken, type Activity, type GameState, type JudgeStep, type Quality, type TutorialStep, type ServerConfig, type Species } from './api';
import { TaniBot, TaniBotHead, TIER_TITLE, TIERS, tierOf, tierRank } from './art/tanibot';
import { getAudioPrefs, initAudio, onAudioPrefsChange, playSound, setAudioPrefs, type SoundName } from './audio';
import { useFullscreen } from './fullscreen';
import { HowToPlay, Modal, PanenInfo } from './help';
import { RECORD_MODE } from './record';
import { holdShareCards, ShareHost, shareMomentOnce } from './share';
import { burnAt, coinsToBalance, confetti, floatText, FxLayer } from './fx';
import { CheckinBanner, Garden, type Choice } from './garden';
import { laptopLayout } from './scene';
import { bgVersion } from './art/village';
import { Market, Shop, Storage, Village } from './panels';
import { Sprite } from './sprites';
import { signShopBurn, walletProof } from './wallet';
import { Profile } from './profile';
import { TaniBotWindow } from './tanibot';
import { GoogleButton } from './google';
import { judgeDeviceId, JudgeTour, JudgeTourChip } from './judge';
import { Coach } from './tutorial';
import { predict } from './optimistic';
import { Info } from './info';
import { ToastStrip, useToasts } from './toast';
import { seasonPayout } from './qty';
import { Avatar } from './art/avatars';
import { Coin, formatDuration, formatPanen, QUALITY_NAME, SPECIES_NAME } from './ui';

type Tab = 'garden' | 'storage' | 'shop' | 'market' | 'village';
type SideTab = Exclude<Tab, 'garden'>;


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
    // Entering / leaving fullscreen (button or Esc): the final size can arrive after the
    // animation, so measure right away and once more a moment later.
    let late = 0;
    const onFullscreen = () => {
      on();
      clearTimeout(late);
      late = window.setTimeout(on, 350);
    };
    window.addEventListener('resize', on);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('resize', on);
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearTimeout(late);
    };
  }, []);
  return size;
}

const DRAWER_KEY = 'nearvest.drawer';
/** Width of the right drawer (open) and of the icon rail (closed), and the action bar height. */
const DRAWER_W = 400;
const RAIL_W = 64;
const BAR_H = 200;

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
  const stateRef = useRef<GameState | null>(null);
  stateRef.current = state;
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [phase, setPhase] = useState<'loading' | 'login' | 'create' | 'play'>('loading');
  const [fatal, setFatal] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('garden');
  const [sideTab, setSideTab] = useState<SideTab>('storage');
  const [busy, setBusy] = useState(false);
  const { toast, shown: toastShown, dismiss: dismissToast } = useToasts();
  const [flash, setFlash] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [audio, setAudio] = useState(getAudioPrefs());
  const fullscreen = useFullscreen();
  const [info, setInfo] = useState<'help' | 'panen' | 'profile' | 'tanibot' | 'checkin' | 'judge' | null>(null);
  const seenDone = useRef<Set<number> | null>(null);
  const lastTitle = useRef<string | null>(null);
  const wide = useWide();
  // Phones, Garden tab: one fixed screen (no page scroll, no bounce); the scene fills it behind the
  // HUD, the plot sheet and the tabs. Other tabs scroll inside their own panels.
  const phoneFit = !wide && phase === 'play' && tab === 'garden' && bgVersion() !== 'v1';
  useEffect(() => {
    document.documentElement.classList.toggle('page-locked', phoneFit);
    if (phoneFit) window.scrollTo(0, 0);
  }, [phoneFit]);
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
      // Judge gardens: share cards wait until the Judge tour is complete; new gardens until the
      // tutorial is over. Then they come one by one.
      holdShareCards((!!s.judgeTour && !s.judgeTour.every((t) => t.done)) || !!s.tutorial, s.player.accountId);
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
        const evolved = tierRank(tierOf(s.player.title)) > tierRank(tierOf(lastTitle.current));
        playSound('levelup');
        confetti();
        floatText(`${s.player.title}!`, 'mint', window.innerWidth / 2, window.innerHeight / 3);
        toast({ kind: 'info', text: evolved ? `New title: ${s.player.title}! TaniBot evolved.` : `New title: ${s.player.title}!` });
        const id = s.player.accountId;
        // ?record=1 (demo recording, record.ts): no share card on this moment.
        if (!RECORD_MODE) {
          if (s.player.title === 'Legend') shareMomentOnce(id, { kind: 'legend' }, 2600);
          else if (evolved) shareMomentOnce(id, { kind: 'evolved', title: s.player.title }, 2600);
          else shareMomentOnce(id, { kind: 'title', title: s.player.title }, 2600);
        }
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
        let payload = (body ?? {}) as Record<string, unknown>;
        const me = stateRef.current?.player;
        if (path === '/api/shop/buy' && me?.custody === 'wallet' && config) {
          // Wallet gardens: the browser signs the burn with the game key; the game relays it and pays gas.
          const signedBurn = await signShopBurn(config, me.accountId, { item: String(payload.item), qty: Number(payload.qty ?? 1) }, ask);
          if (!signedBurn) return null;
          payload = { ...payload, signedBurn };
        }
        // Show what is already certain right away (optimistic.ts); the server's answer replaces it.
        const guess = stateRef.current ? predict(path, payload, stateRef.current, config) : null;
        if (guess) {
          setState(guess);
          playSound(ACTION_SOUNDS[path] ?? 'click');
          if (path === '/api/shop/buy') burnAt();
        }
        let res: { state: GameState; result: unknown };
        try {
          res = await api<{ state: GameState; result: unknown }>('POST', path, payload);
        } catch (e) {
          if (guess) void refresh();
          throw e;
        }
        if (!guess) playSound(ACTION_SOUNDS[path] ?? 'click');
        juice(path, res.result, !!guess);
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
    [applyState, toast, ask, config, refresh],
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
          // Coins and the new balance show at once; the server's answer confirms them.
          const body = { species, quality, qty, expectedPrice: price };
          const guess = stateRef.current ? predict('/api/sell', body, stateRef.current, config) : null;
          if (guess) {
            setState(guess);
            playSound('coins');
            floatText(`+${formatPanen(seasonPayout(price * mult * qty, guess.season.divisor))} PANEN`, 'gold');
            coinsToBalance(Math.min(10, 3 + qty * 2));
          }
          let res: { state: GameState; result?: { expectedPanen?: number } };
          try {
            res = await api<{ state: GameState; result?: { expectedPanen?: number } }>('POST', '/api/sell', body);
          } catch (e) {
            if (guess) void refresh();
            throw e;
          }
          const earned = res.result?.expectedPanen ?? price * mult * qty;
          if (!guess) {
            playSound('coins');
            floatText(`+${formatPanen(earned)} PANEN`, 'gold');
            coinsToBalance(Math.min(10, 3 + qty * 2));
          }
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
    [applyState, ask, refresh, toast, config],
  );

  const onLoggedIn = (token: string, s: GameState | null, note?: string) => {
    setToken(token);
    resetSession();
    if (s) {
      applyState(s);
      setPhase('play');
      // Judge gardens open with the tour.
      if (s.judgeTour) setInfo('judge');
    } else setPhase('create');
    if (note) toast({ kind: 'info', text: note });
  };

  // Judge tour: opening TaniBot's window or the Village counts as done (once).
  const judgeTour = state?.judgeTour;
  const villageOpen = wide ? drawerOpen && sideTab === 'village' : tab === 'village';
  useEffect(() => {
    if (!judgeTour) return;
    const step: JudgeStep | null = info === 'tanibot' ? 'tanibot' : villageOpen ? 'village' : null;
    if (!step || judgeTour.find((t) => t.step === step)?.done) return;
    api<{ state: GameState }>('POST', '/api/judge/step', { step })
      .then((r) => applyState(r.state))
      .catch(() => undefined);
  }, [info, villageOpen, judgeTour, applyState]);

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
    const el = document.querySelector('.chip-panen');
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
        <TaniBot tier="seedling" scale={2} />
        <h1>NEARvest</h1>
        {import.meta.env.DEV ? (
          // Developers: the real error and how to start the local server.
          <>
            <p class="error-text">{fatal}</p>
            <p class="muted small">Start the server with "npm run dev" in the server folder, then reload.</p>
          </>
        ) : (
          // Players: a friendly message and a way to try again (no technical details).
          <>
            <p class="error-text">Can't reach the game server right now. Please try again in a moment.</p>
            <button class="btn btn-mint" onClick={() => location.reload()}>
              Try again
            </button>
          </>
        )}
      </main>
    );
  }
  if (phase === 'loading' || !config) {
    return (
      <main class="shell center">
        <TaniBot tier="seedling" scale={2} />
        <p class="muted">Waking up the village...</p>
      </main>
    );
  }
  /** Judge tour "Go" buttons: open the place where the step happens. */
  const judgeGo = (step: JudgeStep) => {
    setInfo(step === 'tanibot' ? 'tanibot' : null);
    const side = (t: SideTab) => (wide ? (setSideTab(t), setDrawerOpen(true)) : setTab(t));
    if (step === 'harvest' && !wide) setTab('garden');
    if (step === 'sell') side('market');
    if (step === 'shop') side('shop');
    if (step === 'village') side('village');
  };

  const infoView =
    info === 'help' ? (
      <HowToPlay onClose={() => setInfo(null)} />
    ) : info === 'panen' ? (
      <PanenInfo state={state} config={config} onClose={() => setInfo(null)} />
    ) : info === 'tanibot' && state ? (
      <TaniBotWindow state={state} config={config} onState={applyState} onClose={() => setInfo(null)} notify={toast} />
    ) : info === 'judge' && state && config ? (
      <JudgeTour state={state} config={config} onGo={judgeGo} onClose={() => setInfo(null)} />
    ) : info === 'profile' && state ? (
      <Profile state={state} config={config} onState={applyState} onSignOut={() => (setInfo(null), void logout())} onClose={() => setInfo(null)} />
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
  const openBot = () => {
    playSound('click');
    setInfo('tanibot');
  };
  /** TaniBot dot: green ON, grey OFF / not active, yellow when it can no longer buy (budget or daily limit). */
  const tb = p.tanibot;
  const botDot = !tb || !tb.enabled || tb.status !== 'ready' ? 'off' : tb.alert ? 'warn' : 'on';
  const botDotTitle = botDot === 'on' ? 'TaniBot is on' : botDot === 'warn' ? (tb?.alert === 'low' ? 'TaniBot: budget almost empty' : "TaniBot: today's limit reached") : 'TaniBot is off';
  const botIcon = (
    <span class="bot-icon" title={botDotTitle}>
      <TaniBotHead tier={tierOf(p.title)} scale={1} />
      <i class={`bot-dot bot-dot-${botDot}`} aria-label={botDotTitle} />
    </span>
  );

  const xpFrom = p.nextTitle ? xpFloor(p.xp) : p.xp;
  const xpPct = p.nextTitle ? Math.round(((p.xp - xpFrom) / (p.nextTitle.xp - xpFrom)) * 100) : 100;

  const openSide = (t: SideTab) => {
    setSideTab(t);
    setDrawerOpen(true);
  };
  const goShop = () => (wide ? openSide('shop') : setTab('shop'));
  const goSell = () => (wide ? openSide('market') : setTab('market'));
  const immersive = wide ? laptopLayout(win.width, win.height, drawerOpen ? DRAWER_W : RAIL_W, BAR_H, bgVersion()) : undefined;
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
      big={wide}
      immersive={immersive}
      onBot={openBot}
      onPlace={(p) => (playSound('click'), wide ? openSide(p) : setTab(p))}
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
      <Village state={state} config={config} onBot={openBot} />
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
    <button class="who who-btn" onClick={() => (playSound('click'), setInfo('profile'))} title="Your profile" aria-label={`${p.name}: open your profile`}>
      <Avatar id={p.avatar} size={wide ? 48 : 32} />
      <div>
        <div class="name">{p.name}</div>
        <div class="title-line">
          {p.title} · {p.xp} XP
        </div>
        <div class="xp" aria-label="XP to next title">
          <div style={{ width: `${xpPct}%` }} />
        </div>
      </div>
    </button>
  );
  const nextIn = formatDuration(state.clock.msUntilNextDay - elapsed);
  /** Player status chips under the profile: PANEN (most prominent), check-in, farm day. */
  const chips = (
    <div class="hud-chips">
      <button class="chip chip-panen" title="Your PANEN balance: what is PANEN?" onClick={() => (playSound('click'), setInfo('panen'))} aria-label={`${formatPanen(p.balance)} PANEN. What is PANEN?`}>
        <Coin scale={2} />
        <b>{formatPanen(p.balance)}</b>
        <span class="chip-unit">PANEN</span>
      </button>
      <button
        class={`chip chip-checkin ${state.checkin.available ? 'ready' : 'done'}`}
        onClick={() => (playSound('click'), setInfo('checkin'))}
        title={state.checkin.available ? 'Daily check-in is ready' : `Checked in. Next check-in in ${nextIn}`}
      >
        <span class="chip-icon">
          <Sprite name="seedPacket" scale={2} />
          {state.checkin.available ? <i class="chip-dot" aria-hidden="true" /> : <i class="chip-check" aria-hidden="true">✓</i>}
        </span>
        <span>{state.checkin.available ? 'Check in' : nextIn}</span>
      </button>
      <span class="chip chip-day" title={`Next farm day in ${nextIn}`}>
        Day {state.clock.farmDay}
        {p.demo && <span class="chip-demo">Demo</span>}
      </span>
      {p.demo && <Info k="demo" label="Demo mode" />}
      <JudgeTourChip state={state} onOpen={() => (playSound('click'), setInfo('judge'))} />
    </div>
  );
  const notices = (
    <>
      {p.accountStatus === 'pending' && <p class="notice">Creating your NEAR account {p.accountId}...</p>}
      {p.accountStatus === 'failed' && <p class="notice error-text">Your NEAR account could not be created.</p>}
    </>
  );

  // Tutorial coach (TaniBot): "Show me" opens the place of the step.
  const tutorialGo = (step: TutorialStep) => {
    const side = (t: SideTab) => (wide ? openSide(t) : setTab(t));
    if (step === 'buy_fertilizer') side('shop');
    else if (step === 'sell') side('market');
    else if (step === 'checkin') setInfo('checkin');
    else if (!wide) setTab('garden');
    // Bring the glowing target into view (e.g. the fertilizer below the Shop picture on phones).
    const target: Partial<Record<TutorialStep, string>> = {
      plant: '.plot-empty .seed-row > *',
      water: '.act-water',
      buy_fertilizer: '.shop-fertilizer .shop-buy',
      fertilize: '.act-fertilize',
      harvest: '.act-harvest',
      sell: '.sell-go:not(:disabled)',
    };
    const sel = target[step];
    if (sel) window.setTimeout(() => document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
  };
  const tutorialAction = (action: 'start' | 'skip') =>
    api<{ state: GameState }>('POST', '/api/tutorial', { action })
      .then((r) => applyState(r.state))
      .catch((e) => toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) }));
  const coach = state.tutorial && (
    <Coach
      tutorial={state.tutorial}
      onStart={() => (playSound('click'), void tutorialAction('start'))}
      onSkip={() => void tutorialAction('skip')}
      onGo={(step) => (playSound('click'), tutorialGo(step))}
      onActivate={openBot}
    />
  );

  return (
    <main
      class={`shell${wide ? ' wide immersive' : ''}${wide && drawerOpen ? ' drawer-open' : ''}${phoneFit ? ' phone-fit' : ''}`}
      data-tut={state.tutorial?.step}
    >
      {wide ? (
        <>
          {garden}
          {/* Two floating capsules; the middle stays open so the village shows through. */}
          {/* Top left: the player's status. Top right: only system controls. The middle stays open. */}
          <header class="hud-top">
            <div class="hud-left">
              <div class="hud-capsule hud-capsule-left">{who}</div>
              {chips}
              {notices}
            </div>
            <div class="hud-capsule hud-sys">{muteButton}</div>
          </header>
          {/* Tutorial coach: in the open menu, or floating at the top centre when the menu is closed. */}
          {coach && !drawerOpen && <div class="coach-hud">{coach}</div>}

          <aside class="hud hud-drawer" aria-label="Menu" aria-hidden={!drawerOpen} inert={!drawerOpen}>
            <div class="drawer-head">
              <span>Menu</span>
              <button class="icon-btn drawer-bot" onClick={openBot} aria-label={`Open TaniBot (${botDotTitle})`} title={botDotTitle}>
                {botIcon}
              </button>
              <button class="icon-btn drawer-close" onClick={() => (playSound('click'), setDrawerOpen(false))} aria-label="Close the menu" title="Close the menu (enjoy the garden)">
                {'>'}
              </button>
            </div>
            {coach && <div class="drawer-coach">{coach}</div>}
            <div class="drawer-scroll">
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
              {(['storage', 'shop', 'market', 'village'] as SideTab[]).map((t) => (
                <button key={t} class={`rail-btn rail-${t}`} onClick={() => (playSound('click'), openSide(t))} title={tabLabels[t]}>
                  {tabIcons[t]}
                  <span>{tabLabels[t]}</span>
                </button>
              ))}
              <button class="rail-btn rail-bot" onClick={openBot} title={botDotTitle}>
                {botIcon}
                <span>TaniBot</span>
              </button>
            </nav>
          )}
        </>
      ) : (
        <>
          <div class="phone-hud">
            <header class="topbar">
              <div class="hud-capsule hud-capsule-left">{who}</div>
              <div class="hud-capsule hud-sys topbar-right">{muteButton}</div>
            </header>
            {chips}
            {notices}
          </div>
          <div class="content">
            {/* Garden: the coach floats over the top (sky) of the scene, so it never pushes the
                village and the mounds down. Other tabs: above the panel as before. */}
            {coach && (tab === 'garden' ? <div class="coach-float">{coach}</div> : coach)}
            {tab === 'garden' ? garden : panelFor(tab)}
          </div>
          <nav class="tabs">
            {(['garden', 'storage', 'shop', 'market', 'village'] as Tab[]).map((t) => (
              <TabButton key={t} tab={t} current={tab} set={(x) => (playSound('click'), setTab(x))} icon={tabIcons[t]} label={tabLabels[t]} />
            ))}
            <button class="tab tab-bot" onClick={openBot} aria-label={botDotTitle}>
              <span class="tab-icon">{botIcon}</span>
              <span>TaniBot</span>
            </button>
          </nav>
        </>
      )}

      {flash > 0 && <div class="chain-flash" key={flash} aria-hidden="true" />}
      <ToastStrip shown={toastShown} dismiss={dismissToast} />
      {dialogView}
      {infoView}
      {info === 'checkin' && (
        <Modal title="Daily check-in" onClose={() => setInfo(null)} closeLabel="Close" class="checkin-dialog">
          <CheckinBanner state={state} act={act} ask={ask} busy={busy} elapsed={elapsed} />
          <p class="muted small">Check in every day: 5 PANEN and a free Mango seed. Day 7 of a streak doubles the PANEN and adds a Gold seed.</p>
        </Modal>
      )}
      <ShareHost state={state} />
      <FxLayer />
    </main>
  );
}

/** Floating numbers, coins and flames for actions with a PANEN effect. */
/** Effects after an action; `early`: the instant ones already played when the button was pressed. */
function juice(path: string, result: unknown, early = false) {
  const r = (result ?? {}) as { rewards?: string[]; burnedPanen?: number };
  if (path === '/api/checkin' && r.rewards?.[0]) {
    floatText(`+${r.rewards[0]}`, 'gold');
    coinsToBalance(4);
  } else if (path === '/api/shop/buy' && r.burnedPanen) {
    if (!early) burnAt();
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
    <button class={`tab tab-${tab}${tab === current ? ' active' : ''}`} onClick={() => set(tab)} aria-current={tab === current ? 'page' : undefined}>
      <span class="tab-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** Username-only login for local testing (dev builds only). */
function DevLogin({
  busy,
  setBusy,
  setError,
  onLoggedIn,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  onLoggedIn: (token: string, s: GameState | null) => void;
}) {
  const [username, setUsername] = useState('');
  const submit = async (e: Event) => {
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
    <form class="dev-login" onSubmit={submit}>
      <label for="dev-user">Dev login (local testing)</label>
      <div class="row">
        <input id="dev-user" value={username} onInput={(e) => setUsername((e.target as HTMLInputElement).value)} placeholder="username" autocomplete="off" />
        <button class="btn btn-mint" disabled={busy || username.trim().length < 2}>
          Enter
        </button>
      </div>
    </form>
  );
}

function Login({ config, onLoggedIn, onHelp }: { config: ServerConfig; onLoggedIn: (token: string, s: GameState | null, note?: string) => void; onHelp: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const walletLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const proof = await walletProof(config);
      const res = await api<{ token: string; player: GameState | null }>('POST', '/auth/near', proof);
      onLoggedIn(res.token, res.player);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** Try as Judge: a new, filled garden for this device (the same one again next time). */
  const judgeLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; kind: 'new' | 'same' | 'shared'; player: GameState }>('POST', '/auth/judge', { deviceId: judgeDeviceId() });
      const note =
        res.kind === 'same'
          ? 'Welcome back: this is your judge garden.'
          : res.kind === 'shared'
            ? 'Many judge gardens were made today, so you are sharing a recent one.'
            : undefined;
      onLoggedIn(res.token, res.player, note);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // The landing page's "Try as Judge" opens /play?judge=1: make the judge garden right away.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('judge')) return;
    q.delete('judge');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
    void judgeLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div class="login-page">
      <div class="login-bg" aria-hidden="true" />
    <main class="shell center login">
      <EvolutionJourney />
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

      <div class="judge-entry">
        <button class="btn btn-gold btn-judge" onClick={judgeLogin} disabled={busy}>
          {busy ? 'Preparing your garden...' : 'Try as Judge'}
        </button>
        <p class="small">One click, no sign-in: your own ready garden with real testnet Tree NFTs, PANEN and TaniBot, plus a 5-step tour.</p>
      </div>

      <GoogleButton
        clientId={config.googleClientId}
        onCredential={async (credential) => {
          const res = await api<{ token: string; player: GameState | null }>('POST', '/auth/google', { credential });
          onLoggedIn(res.token, res.player);
        }}
        onError={setError}
      />
      <button class="btn btn-wallet" onClick={walletLogin} disabled={busy}>
        Connect NEAR Wallet
      </button>

      {/* Dev login: local `npm run dev` only. The whole component is left out of production
          builds (import.meta.env.DEV is false there), not only hidden; the server refuses it too. */}
      {import.meta.env.DEV && config.devLogin && <DevLogin busy={busy} setBusy={setBusy} setError={setError} onLoggedIn={onLoggedIn} />}
      {error && <p class="error-text">{error}</p>}
      <p class="login-foot small">
        Sign in with <b>Google</b> or a <b>NEAR wallet</b>. With Google you need no wallet: the game creates your NEAR {config.network} account and pays all fees. Testnet tokens have no real value.
      </p>
      <p class="login-legal small">
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>
    </main>
    </div>
  );
}

/** Login page: the six TaniBots from Seedling to Legend, the evolution journey (swipe on phones). */
function EvolutionJourney() {
  const wide = useWide();
  return (
    <div class="journey" role="img" aria-label="TaniBot evolves with your title: Seedling, Farmhand, Farmer, Orchard Master, Durian King, Legend">
      <div class="journey-track">
        {TIERS.map((t, i) => (
          <figure key={t} class={`journey-step tier-${t}`} style={{ '--i': String(i) }}>
            <TaniBot tier={t} scale={wide ? 2 : 1} />
            <figcaption>{TIER_TITLE[t]}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function CreateGarden({ onCreated, onLogout }: { onCreated: (s: GameState) => void; onLogout: () => void }) {
  const [name, setName] = useState('');
  const [demo, setDemo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = name.trim().toLowerCase();
  /** Set when signed in with a NEAR wallet: the garden uses that account. */
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  useEffect(() => {
    api<{ walletAccountId: string | null }>('GET', '/api/session')
      .then((s) => setWalletAccount(s.walletAccountId))
      .catch(() => undefined);
  }, []);

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
      <TaniBot tier="seedling" scale={2} />
      <h1>Welcome to Tandur!</h1>
      <p class="muted">
        {walletAccount
          ? 'Choose your farmer name. It is how friends find you; your garden uses your own NEAR wallet account.'
          : 'Choose your farmer name. It becomes your NEAR account and how friends find you.'}
      </p>
      <form class="create" onSubmit={submit}>
        <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="your-name" maxLength={32} autocomplete="off" />
        <p class="account-preview">{walletAccount ?? `${clean || 'your-name'}.nearvest.testnet`}</p>
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
