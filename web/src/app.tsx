// App shell: login, garden creation, polling, tabs, sounds, dialogs and the blockchain "flash".

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { activityLabel, api, ApiError, hasToken, setToken, type Activity, type DuelView, type GameState, type MatchView, type JudgeStep, type Quality, type TutorialStep, type ServerConfig, type Species } from './api';
import { DartoHead } from './art/darto';
import { LOOK_LABEL, lookOf, lookText, withWeather, type WeatherLook } from './weather';
import { lockedFraction, phaseOf } from './art/backdrop';

/** Dev builds: ?time=day / dusk / night also locks the duel's village (screenshots), like the garden. */
const DUEL_TIME_LOCK = import.meta.env.DEV && typeof location !== 'undefined' ? lockedFraction(location.search) : null;
import { TaniBot, TaniBotHead, tierOf, tierRank } from './art/tanibot';
import { getAudioPrefs, initAudio, onAudioPrefsChange, playRumble, playSound, setAmbient, setAudioPrefs, type SoundName } from './audio';
import { useFullscreen } from './fullscreen';
import { HowToPlay, Modal, PanenInfo } from './help';
import { shopSetupText } from './shop-setup';
import { RECORD_MODE } from './record';
import { holdShareCards, ShareHost, shareMomentOnce } from './share';
import { MomentFxLayer } from './moment-fx';
import { ArenaPanel, ArenaWindow, DuelScreen } from './arena';
import { receivedNotice } from './arena-play';
import { matchNotice } from './arena-turn';
import { MatchScreen } from './arena-match';
import { overlayKey } from './overlay-key';
import { FarmersWindow, VisitGarden } from './friends';
import { SPECIES_NAME as SPECIES_LABEL } from './ui';
import { burnAt, coinsToBalance, floatText, FxLayer } from './fx';
import { CheckinBanner, Garden, type Choice } from './garden';
import { laptopLayout } from './scene';
import { bgVersion } from './art/village';
import { Market, Shop, Storage, Village } from './panels';
import { Sprite } from './sprites';
import { signShopBurn, WALLET_LIST_BLOCKED, walletProof } from './wallet';
import { Profile } from './profile';
import { TaniBotWindow } from './tanibot';
import { GoogleButton, pendingGoogleRedirect, takeGoogleRedirect } from './google';
import { judgeDeviceId, JudgeTour, JudgeTourChip } from './judge';
import { Coach } from './tutorial';
import { dotsFor, fruitSnap, LOCAL_NONE, markMarketSeen, markSeen, marketNew, readLocalSeen, saveLocalSeen, settleLocal, shopNeed, useSeenWhenVisible, villageNews, type LocalSeen } from './dots';
import { InvitePanel, VisitorsPanel } from './invite';
import { clearRef, freshIds, keepRefFromUrl, readRef, withoutRef } from './referral';
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
  '/api/clean': 'harvest',
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
  const { toast, shown: toastShown, dismiss: dismissToast, setHidden: setToastHidden } = useToasts();
  const [flash, setFlash] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [audio, setAudio] = useState(getAudioPrefs());
  const fullscreen = useFullscreen();
  const [info, setInfo] = useState<'help' | 'panen' | 'profile' | 'tanibot' | 'checkin' | 'judge' | null>(null);
  /** Garden visits (friends.tsx): the farmer list window, and the friend's garden being visited. */
  const [farmersOpen, setFarmersOpen] = useState(false);
  const [visiting, setVisiting] = useState<string | null>(null);
  /** Arena 1 VS 1 (arena.tsx): the Arena window, the duel on screen, the garden being challenged. */
  const [arenaOpen, setArenaOpen] = useState(false);
  const [duel, setDuel] = useState<DuelView | null>(null);
  const [duelBusy, setDuelBusy] = useState<string | null>(null);
  /** Arena v2: the turn-based match on screen (servers with `state.arena.v === 2`). */
  const [match, setMatch] = useState<MatchView | null>(null);
  /** While a duel plays, a new title's moment (banner, TaniBot evolving) waits until it closes. */
  const duelOnScreen = useRef(false);
  const afterDuel = useRef<(() => void)[]>([]);
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
  // Wallet gardens: the "Set up Shop" window before the wallet adds the limited game key.
  const [shopSetup, setShopSetup] = useState<((ok: boolean) => void) | null>(null);
  const confirmShopSetup = useCallback(() => new Promise<boolean>((resolve) => setShopSetup(() => resolve)), []);
  const closeShopSetup = (ok: boolean) => {
    playSound('click');
    shopSetup?.(ok);
    setShopSetup(null);
  };

  /** Applies new state: chain flash for landed jobs, level-up fanfare for a new title. */
  const applyState = useCallback(
    (s: GameState) => {
      // Judge gardens: share cards wait until the Judge tour is complete; new gardens until the
      // tutorial is over. Then they come one by one.
      holdShareCards((!!s.judgeTour && !s.judgeTour.every((t) => t.done)) || !!s.tutorial, s.player.accountId);
      // Friends who watered our trees since we last looked (garden visits): one notice.
      if (s.helps?.length) {
        const key = `nearvest.helpsSeen.${s.player.accountId}`;
        let seen = 0;
        try {
          seen = Number(localStorage.getItem(key) ?? 0);
        } catch {
          seen = Number.MAX_SAFE_INTEGER; // storage blocked: no notice rather than the same one again and again
        }
        const fresh = s.helps.filter((h) => h.id > seen);
        if (fresh.length) {
          try {
            localStorage.setItem(key, String(Math.max(...s.helps.map((h) => h.id))));
          } catch {
            // Storage blocked: shown once this visit.
          }
          const h = fresh[0];
          const xp = fresh.reduce((n, x) => n + x.xp, 0);
          // A moment after the garden shows, and long enough to read.
          window.setTimeout(() => toast({
            kind: 'success',
            long: true,
            text:
              fresh.length === 1
                ? `${h.helper} watered your ${SPECIES_LABEL[h.species]} on plot ${h.plot + 1}${xp ? `: +${xp} XP` : ''}. Thanks, neighbour!`
                : `${[...new Set(fresh.map((x) => x.helper))].join(', ')} watered ${fresh.length} of your trees${xp ? `: +${xp} XP` : ''}.`,
          }), 1200);
        }
      }
      // Stickers visitors left, and referrals paid (both sides): one notice each since we last looked.
      const seenOf = (key: string) => {
        try {
          return Number(localStorage.getItem(key) ?? 0);
        } catch {
          return Number.MAX_SAFE_INTEGER;
        }
      };
      const setSeen = (key: string, v: number) => {
        try {
          localStorage.setItem(key, String(v));
        } catch {
          // Storage blocked.
        }
      };
      if (s.stickers?.length) {
        const key = `nearvest.stickersSeen.${s.player.accountId}`;
        const { fresh, seen } = freshIds(s.stickers.map((x) => x.id), seenOf(key));
        if (fresh.length) {
          setSeen(key, seen);
          const first = s.stickers.find((x) => x.id === fresh[0])!;
          window.setTimeout(
            () =>
              toast({
                kind: 'success',
                long: true,
                text: fresh.length === 1 ? `${first.from} left you a sticker: "${first.text}"` : `${fresh.length} new stickers from visitors. See them in the Village tab.`,
              }),
            1800,
          );
        }
      }
      // Waves back from gardens we visited (one notice since we last looked).
      if (s.waves?.length) {
        const key = `nearvest.wavesSeen.${s.player.accountId}`;
        const { fresh, seen } = freshIds(s.waves.map((x) => x.id), seenOf(key));
        if (fresh.length) {
          setSeen(key, seen);
          const first = s.waves.find((x) => x.id === fresh[0])!;
          window.setTimeout(
            () =>
              toast({
                kind: 'success',
                long: true,
                text: fresh.length === 1 ? `${first.from} waved back: "${first.text}"` : `${fresh.length} farmers waved back. See them in the Village tab.`,
              }),
            2100,
          );
        }
      }
      // Arena v2: matches against our TaniBot (one notice since we last looked).
      if (s.arena?.receivedMatches?.length) {
        const key = `nearvest.matchSeen.${s.player.accountId}`;
        const { fresh, seen } = freshIds(s.arena.receivedMatches.map((x) => x.id), seenOf(key));
        if (fresh.length) {
          setSeen(key, seen);
          const text = matchNotice(s.arena.receivedMatches.filter((x) => fresh.includes(x.id)));
          if (text) window.setTimeout(() => toast({ kind: 'success', long: true, text }), 3000);
        }
      }
      // Arena: duels this garden was challenged in (one notice since we last looked).
      if (s.arena?.received.length) {
        const key = `nearvest.arenaSeen.${s.player.accountId}`;
        const { fresh, seen } = freshIds(s.arena.received.map((x) => x.id), seenOf(key));
        if (fresh.length) {
          setSeen(key, seen);
          const text = receivedNotice(s.arena.received.filter((x) => fresh.includes(x.id)));
          if (text) window.setTimeout(() => toast({ kind: 'success', long: true, text }), 2700);
        }
      }
      if (s.referral) {
        const key = `nearvest.refPaidSeen.${s.player.accountId}`;
        const paid = s.referral.invited.filter((r) => r.status === 'paid');
        const by = s.referral.invitedBy?.status === 'paid' ? s.referral.invitedBy : null;
        const { fresh, seen } = freshIds([...paid.map((r) => r.id), ...(by ? [by.id] : [])], seenOf(key));
        if (fresh.length) {
          setSeen(key, seen);
          const r = s.referral;
          const friends = paid.filter((x) => fresh.includes(x.id)).map((x) => x.name);
          const texts = [
            friends.length ? `${friends.join(', ')} made their first harvest: +${formatPanen(r.rewards.referrerNow * friends.length)} PANEN for inviting them!` : '',
            by && fresh.includes(by.id) ? `First harvest done: +${formatPanen(r.rewards.friend)} PANEN invite bonus (thanks to ${by.name}).` : '',
          ].filter(Boolean);
          window.setTimeout(() => toast({ kind: 'success', long: true, text: texts.join(' ') }), 2400);
        }
      }
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
            text: `${activityLabel(latest)}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`,
            link: latest.explorerUrl ?? undefined,
          });
        }
      }
      if (lastTitle.current !== null && lastTitle.current !== s.player.title) {
        const evolved = tierRank(tierOf(s.player.title)) > tierRank(tierOf(lastTitle.current));
        const title = s.player.title;
        const id = s.player.accountId;
        const celebrate = () => {
          toast({ kind: 'info', text: evolved ? `New title: ${title}! TaniBot evolved.` : `New title: ${title}!` });
          // The moment's own animation + sound (banner, confetti, fanfare...), then its share card.
          // ?record=1 (demo recording, record.ts): the animation only, no share card.
          const popup = !RECORD_MODE;
          if (title === 'Legend') shareMomentOnce(id, { kind: 'legend' }, { popup });
          else if (evolved) shareMomentOnce(id, { kind: 'evolved', title }, { popup });
          else shareMomentOnce(id, { kind: 'title', title }, { popup });
        };
        // Arena: the title came from a duel's XP; it is celebrated once the duel screen closes.
        if (duelOnScreen.current) afterDuel.current.push(celebrate);
        else celebrate();
      }
      lastTitle.current = s.player.title;
      setState(withWeather(s));
      setLoadedAt(Date.now());
    },
    [toast],
  );

  // Village weather: a notice once per eruption phase (the warning also rumbles), the share
  // card after an eruption, and the quiet ambient loop (day / night / rain; Sound switch).
  const eruptionKey = state?.weather?.eruption ? `${state.weather.eruption.id}:${state.weather.eruption.phase}` : null;
  useEffect(() => {
    const e = state?.weather?.eruption;
    if (phase !== 'play' || !state || !e || !eruptionKey) return;
    const key = `nearvest.wx.${state.player.accountId}.${eruptionKey}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Storage blocked: the notice may show again after a reload, that is all.
    }
    if (e.phase === 'warning') {
      toast({ kind: 'warn', text: 'Mount Tandur is rumbling! Ash will fall soon. Cleaning it is free, and trees never die.' });
      void playRumble();
    } else if (e.phase === 'eruption') {
      toast({ kind: 'error', text: 'Eruption! Ash covers your trees and stops them growing. Tap a tree and Clean ash (free).' });
    } else if (state.plots.some((x) => x.tree)) {
      toast({ kind: 'success', text: 'The eruption is over: trees you cleaned grow faster on Volcanic soil.' });
      shareMomentOnce(state.player.accountId, { kind: 'eruption' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, eruptionKey]);
  const ambientLook = lookOf(state?.weather);
  const ambientNight = state
    ? phaseOf(1 - Math.max(0, state.clock.msUntilNextDay - (now - loadedAt)) / state.clock.dayLengthMs) === 'night'
    : false;
  useEffect(() => {
    setAmbient(phase === 'play' && state ? (ambientLook === 'rain' ? 'rain' : ambientNight ? 'night' : 'day') : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, !!state, ambientLook, ambientNight]);
  useEffect(() => () => setAmbient(null), []);

  // Back from Google after "Continue with Google" in the Profile (iPhone / iPad redirect): link
  // that Google account to this garden with the existing link route, then say how it went.
  const linkChecked = useRef(false);
  useEffect(() => {
    if (phase !== 'play' || !state || linkChecked.current) return;
    linkChecked.current = true;
    if (pendingGoogleRedirect() !== 'link') return;
    const back = takeGoogleRedirect();
    if (!back) return;
    if ('error' in back) {
      toast({ kind: 'error', text: back.error });
      return;
    }
    api<GameState>('POST', '/api/google/link', { credential: back.credential })
      .then((s) => {
        applyState(s);
        toast({ kind: 'success', text: 'Google account linked. You can now sign in to this garden with Google too.' });
      })
      .catch((e) => toast({ kind: 'error', text: `Google account not linked: ${e instanceof Error ? e.message : String(e)}` }));
  }, [phase, state]);

  const resetSession = () => {
    seenDone.current = null;
    lastTitle.current = null;
  };

  const refresh = useCallback(async () => {
    try {
      applyState(await api<GameState>('GET', ME_PATH()));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setPhase('login');
      } else if (e instanceof ApiError && e.status === 404) {
        setPhase('create');
      }
    }
  }, [applyState]);

  // Boot: server config, then the session if there is one. An invite link (?ref=) is kept first.
  useEffect(() => {
    try {
      keepRefFromUrl(location.search, localStorage, Date.now());
      // Kept: take it out of the address bar (a reload after the new garden must not bring it back).
      // Storage blocked: it stays in the address bar, the only place that still has it.
      if (new URLSearchParams(location.search).has('ref') && readRef(localStorage, Date.now())) history.replaceState(null, '', location.pathname + withoutRef(location.search) + location.hash);
    } catch {
      // Storage blocked: no invite.
    }
    api<ServerConfig>('GET', '/api/config')
      .then(async (c) => {
        setConfig(c);
        if (!hasToken()) return setPhase('login');
        try {
          applyState(await api<GameState>('GET', ME_PATH()));
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
          const signedBurn = await signShopBurn(config, me.accountId, { item: String(payload.item), qty: Number(payload.qty ?? 1) }, confirmShopSetup);
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
    [applyState, toast, ask, confirmShopSetup, config, refresh],
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
    // A shared judge garden is worth a warning (whole text shown); a returning judge just info.
    if (note) toast({ kind: note.startsWith('Many judge gardens') ? 'warn' : 'info', text: note });
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

  // Red dot on the Village tab: once the Visitors / Invite boxes are on screen, the news is seen
  // (stored on the server, so every device agrees). Not while visiting a friend's garden.
  const villageOnScreen = !!state && !visiting && villageNews(state) && (wide ? drawerOpen && sideTab === 'village' : tab === 'village');
  const seeVillage = useCallback(() => {
    const s = stateRef.current;
    if (!s?.news) return;
    const upTo = s.news.latestAt;
    setState((cur) => (cur ? markSeen(cur) : cur));
    api<{ state: GameState }>('POST', '/api/village/seen', { upTo })
      .then((r) => applyState(r.state))
      .catch(() => undefined);
  }, [applyState]);
  useSeenWhenVisible('.visitors-panel, .invite-panel, .arena-panel', villageOnScreen, seeVillage);

  // Red dots on the Market and the Shop (dots.ts): gone as soon as the tab opens, and the tab then
  // points at what to do (a short hint and a glow on the rows, `marketFocus` / `shopFocus`).
  // What this browser saw is kept per garden (localStorage); the Market's "seen" is also on the
  // server when it has `state.market`, so every device agrees.
  const account = state?.player.accountId ?? '';
  const [seen, setSeen] = useState<{ account: string; v: LocalSeen }>({ account: '', v: LOCAL_NONE });
  const localSeen = seen.account === account ? seen.v : account ? readLocalSeen(account) : LOCAL_NONE;
  const [marketFocus, setMarketFocus] = useState(0);
  const [shopFocus, setShopFocus] = useState(0);
  const openTab: Tab | null = !state || phase !== 'play' || visiting ? null : wide ? (drawerOpen ? sideTab : null) : tab;
  useEffect(() => {
    if (!state || !account) return;
    let next = settleLocal(state, localSeen);
    if (openTab === 'market') {
      if (marketNew(state, next)) {
        setMarketFocus((n) => n + 1);
        if (state.market) {
          const upTo = state.market.fruitAt;
          setState((cur) => (cur ? markMarketSeen(cur) : cur));
          api<{ state: GameState }>('POST', '/api/market/seen', { upTo })
            .then((r) => applyState(r.state))
            .catch(() => undefined);
        }
      }
      const snap = fruitSnap(state);
      if (JSON.stringify(snap) !== JSON.stringify(next.fruits)) next = { ...next, fruits: snap };
    }
    if (openTab === 'shop' && shopNeed(state) && !next.shop) {
      setShopFocus((n) => n + 1);
      next = { ...next, shop: true };
    }
    if (next !== localSeen || seen.account !== account) {
      setSeen({ account, v: next });
      if (next !== localSeen) saveLocalSeen(account, next);
    }
  }, [state, openTab, account, localSeen, seen.account, applyState]);

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
  // Red dots (dots.ts): laptops have no Garden tab (the garden is always on screen).
  const dots = dotsFor(state, wide ? (drawerOpen ? sideTab : null) : tab, !!visiting, localSeen).tabs;
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
      onPlace={(p) => (playSound('click'), p === 'friends' ? setFarmersOpen(true) : p === 'arena' ? setArenaOpen(true) : wide ? openSide(p) : setTab(p))}
    />
  );
  /** Arena v2: opens a match (new or resumed) on the turn-based duel screen. */
  const openMatch = (m: MatchView) => {
    duelOnScreen.current = true;
    setArenaOpen(false);
    setMatch(m);
  };
  const resumeMatch = async (id: number) => {
    try {
      openMatch((await api<{ match: MatchView }>('GET', `/api/arena/match/${id}`)).match);
    } catch (e) {
      toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
  /**
   * Challenges a garden. v2 servers: a turn-based match against its TaniBot (Rock / Paper /
   * Scissors). Older servers: the v1 duel, decided at once and played back.
   */
  const startDuel = async (name: string) => {
    if (duelBusy) return;
    playSound('click');
    setDuelBusy(name);
    if (state?.arena?.v === 2) {
      try {
        const r = await api<{ match: MatchView; state: GameState }>('POST', '/api/arena/match', { opponent: name, deviceId: judgeDeviceId() });
        applyState(r.state);
        openMatch(r.match);
      } catch (e) {
        // A duel is still open (another tab, or left earlier): continue it.
        if (e instanceof ApiError && e.data.code === 'match_open' && typeof e.data.matchId === 'number') void resumeMatch(e.data.matchId);
        else {
          playSound('error');
          toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        setDuelBusy(null);
      }
      return;
    }
    try {
      const r = await api<{ duel: DuelView; state: GameState }>('POST', '/api/arena/duel', { opponent: name, deviceId: judgeDeviceId() });
      duelOnScreen.current = true;
      applyState(r.state);
      setDuel(r.duel);
    } catch (e) {
      playSound('error');
      toast({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setDuelBusy(null);
    }
  };
  /** Shows a stored duel again (Replay); new titles wait while it plays. */
  const showDuel = (d: DuelView) => {
    duelOnScreen.current = true;
    setDuel(d);
  };
  const closeDuel = () => {
    duelOnScreen.current = false;
    setDuel(null);
    setMatch(null);
    const later = afterDuel.current.splice(0);
    later.forEach((f, i) => window.setTimeout(f, 400 + i * 200));
  };
  const startVisit = (name: string) => {
    setFarmersOpen(false);
    setVisiting(name);
    if (!wide) setTab('garden');
  };
  const view = visiting ? (
    <VisitGarden
      key={visiting}
      name={visiting}
      mine={state}
      elapsed={elapsed}
      big={wide}
      immersive={immersive}
      onBack={() => setVisiting(null)}
      onState={applyState}
      notify={toast}
      onDuel={state.arena ? startDuel : undefined}
      duelBusy={!!duelBusy}
    />
  ) : (
    garden
  );
  const panelFor = (t: SideTab) =>
    t === 'storage' ? (
      <Storage state={state} config={config} act={act} busy={busy} goSell={goSell} />
    ) : t === 'shop' ? (
      <Shop state={state} config={config} act={act} busy={busy} focus={shopFocus} />
    ) : t === 'market' ? (
      <Market state={state} config={config} sell={sell} act={act} busy={busy} focus={marketFocus} />
    ) : (
      <Village
        state={state}
        config={config}
        onBot={openBot}
        onFarmers={Array.isArray(state.helps) ? () => (playSound('click'), setFarmersOpen(true)) : undefined}
        social={
          <>
            {state.referral && <InvitePanel state={state} notify={toast} onVisit={Array.isArray(state.helps) ? startVisit : undefined} />}
            {state.arena && <ArenaPanel state={state} onOpen={() => setArenaOpen(true)} onReplay={showDuel} />}
            {(state.visitors || state.stickers) && (
              <VisitorsPanel state={state} onState={applyState} notify={toast} onVisit={Array.isArray(state.helps) ? startVisit : undefined} />
            )}
          </>
        }
      />
    );

  const tabIcons: Record<Tab, ComponentChildren> = {
    garden: <Sprite name="sprout" scale={2} />,
    storage: <Sprite name="seedPacket" scale={3} />,
    shop: <Coin scale={3} />,
    market: <DartoHead />,
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
        <span class="chip-checkin-text" data-size="Check in">
          <span>{state.checkin.available ? 'Check in' : nextIn}</span>
        </span>
      </button>
      {/* Day chip and its (i) are one unit that never splits when the row wraps: on narrow
          screens (Safari's text is a little wider) the (i) used to drop to the next line alone. */}
      <span class="chip-day-group">
        <span class="chip chip-day" title={`Next farm day in ${nextIn}`}>
          Day {state.clock.farmDay}
          {p.demo && <span class="chip-demo">Demo</span>}
        </span>
        {p.demo && <Info k="demo" label="Demo mode" />}
      </span>
      {/* Village weather (servers before the weather release send none: no chip). */}
      {state.weather && (
        <span class="chip-day-group chip-weather-group">
          <span class={`chip chip-weather wx-${lookOf(state.weather)}`} title={lookText(state.weather)}>
            <Sprite name={WEATHER_ICON[lookOf(state.weather)]} scale={2} />
            {LOOK_LABEL[lookOf(state.weather)]}
          </span>
          <Info k="weather" label="the weather" text={lookText(state.weather)} />
        </span>
      )}
      {!visiting && <JudgeTourChip state={state} onOpen={() => (playSound('click'), setInfo('judge'))} />}
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
  // Visiting a friend's garden: our own tutorial coach and Judge tour chip hide (progress unchanged).
  const coach = !visiting && state.tutorial && (
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
      data-tut={visiting ? undefined : state.tutorial?.step}
    >
      {wide ? (
        <>
          {view}
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
                  <TabButton key={t} tab={t} current={sideTab} set={(x) => (playSound('click'), setSideTab(x as SideTab))} icon={tabIcons[t]} label={tabLabels[t]} dot={dots[t]} />
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
                  {dots[t] && <i class="rail-dot" aria-label={DOT_LABEL[t]} />}
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
            {tab === 'garden' ? view : panelFor(tab)}
          </div>
          <nav class="tabs">
            {(['garden', 'storage', 'shop', 'market', 'village'] as Tab[]).map((t) => (
              <TabButton key={t} tab={t} current={tab} set={(x) => (playSound('click'), setVisiting(null), setTab(x))} icon={tabIcons[t]} label={tabLabels[t]} dot={dots[t]} />
            ))}
            <button class="tab tab-bot" onClick={openBot} aria-label={botDotTitle}>
              <span class="tab-icon">{botIcon}</span>
              <span>TaniBot</span>
            </button>
          </nav>
        </>
      )}

      {flash > 0 && <div class="chain-flash" key={overlayKey('flash', flash)} aria-hidden="true" />}
      <ToastStrip shown={toastShown} dismiss={dismissToast} setHidden={setToastHidden} />
      {dialogView}
      {infoView}
      {farmersOpen && <FarmersWindow onClose={() => setFarmersOpen(false)} onVisit={startVisit} />}
      {arenaOpen && state.arena && <ArenaWindow state={state} busy={duelBusy} onClose={() => setArenaOpen(false)} onDuel={startDuel} onReplay={showDuel} onResume={resumeMatch} />}
      {duel && <DuelScreen key={overlayKey('duel', duel.id)} duel={duel} wide={wide} activity={state.activity} season={state.season} onClose={closeDuel} />}
      {match && (
        <MatchScreen
          key={overlayKey('match', match.id)}
          initial={match}
          wide={wide}
          activity={state.activity}
          season={state.season}
          fraction={DUEL_TIME_LOCK ?? 1 - Math.max(0, state.clock.msUntilNextDay - elapsed) / state.clock.dayLengthMs}
          weather={lookOf(state.weather)}
          onDone={(s) => applyState(s)}
          onClose={() => (closeDuel(), void refresh())}
        />
      )}
      {shopSetup && config && (
        <Modal
          title="Set up Shop"
          onClose={() => closeShopSetup(false)}
          class="shop-setup-dialog"
          actions={
            <>
              <button class="btn" onClick={() => closeShopSetup(false)}>
                Not now
              </button>
              <button class="btn btn-gold" onClick={() => closeShopSetup(true)}>
                Continue
              </button>
            </>
          }
        >
          {shopSetupText(config.wallet.gameKey.allowance).map((t) => (
            <p key={t}>{t}</p>
          ))}
        </Modal>
      )}
      {info === 'checkin' && (
        <Modal title="Daily check-in" onClose={() => setInfo(null)} closeLabel="Close" class="checkin-dialog">
          <CheckinBanner state={state} act={act} ask={ask} busy={busy} elapsed={elapsed} />
          <p class="muted small">Check in every day: 5 PANEN and a free Mango seed. Day 7 of a streak doubles the PANEN and adds a Gold seed.</p>
        </Modal>
      )}
      <ShareHost state={state} />
      <MomentFxLayer />
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
  if (path === '/api/harvest' && r.kind === 'fruit' && r.species === 'durian' && (r.quality === 'rare' || r.quality === 'gold'))
    shareMomentOnce(id, { kind: 'big_durian', species: 'durian', quality: r.quality });
  if (path === '/api/plant' && r.quality === 'gold') shareMomentOnce(id, { kind: 'first_gold', species: r.species, quality: 'gold' });
  if (path === '/api/checkin' && r.calendarDay === 7) shareMomentOnce(id, { kind: 'streak7' });
}

const TITLE_XP = [0, 50, 200, 600, 1500, 4000];
function xpFloor(xp: number): number {
  let floor = 0;
  for (const t of TITLE_XP) if (xp >= t) floor = t;
  return floor;
}

/** What a red dot on a tab means (screen readers; dots.ts). */
const DOT_LABEL: Record<Tab, string> = {
  garden: 'A tree is ripe or thirsty',
  storage: '',
  shop: 'No seeds left and a plot is empty',
  market: 'Fruit to sell',
  village: 'New visitors or news',
};

function TabButton({ tab, current, set, icon, label, dot = false }: { tab: Tab; current: Tab; set: (t: Tab) => void; icon: ComponentChildren; label: string; dot?: boolean }) {
  return (
    <button class={`tab tab-${tab}${tab === current ? ' active' : ''}`} onClick={() => set(tab)} aria-current={tab === current ? 'page' : undefined}>
      <span class="tab-icon">
        {icon}
        {dot && <i class="tab-dot" aria-label={DOT_LABEL[tab]} />}
      </span>
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

/** Weather chip icons (existing sprites only). */
const WEATHER_ICON: Record<WeatherLook, 'sparkle' | 'droplet' | 'fire' | 'sprout'> = {
  clear: 'sparkle',
  rain: 'droplet',
  drought: 'fire',
  warning: 'fire',
  eruption: 'fire',
  volcanic: 'sprout',
};

/** Width of every sign-in button (px); the Google button is drawn at the same width. */
const LOGIN_BUTTON_W = 300;

function Login({ config, onLoggedIn, onHelp }: { config: ServerConfig; onLoggedIn: (token: string, s: GameState | null, note?: string) => void; onHelp: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The wallet list is being opened (the button says so). */
  /** Problems of the Google button (shown next to wallet / judge messages, never replacing them). */
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [walletOpening, setWalletOpening] = useState(false);

  const walletLogin = async () => {
    setBusy(true);
    setWalletOpening(true);
    setError(null);
    // near-connect shows its wallet list as a .hot-connector-popup element. If it has not appeared
    // after 10 s, something blocked it: say so instead of a button that seems to do nothing.
    const noList = window.setTimeout(() => {
      if (!document.querySelector('.hot-connector-popup')) setError(WALLET_LIST_BLOCKED);
    }, 10_000);
    try {
      const proof = await walletProof(config);
      const res = await api<{ token: string; player: GameState | null }>('POST', '/auth/near', proof);
      onLoggedIn(res.token, res.player);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      window.clearTimeout(noList);
      setBusy(false);
      setWalletOpening(false);
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
  // Back from Google's sign-in page (iPhone / iPad redirect): sign in with the ID token.
  useEffect(() => {
    const purpose = pendingGoogleRedirect();
    const back = takeGoogleRedirect();
    if (!back) return;
    if (purpose === 'link') {
      setGoogleError('Sign in to your garden first, then link Google from your Profile.');
      return;
    }
    if ('error' in back) {
      setGoogleError(back.error);
      return;
    }
    setBusy(true);
    api<{ token: string; player: GameState | null }>('POST', '/auth/google', { credential: back.credential })
      .then((res) => onLoggedIn(res.token, res.player))
      .catch((err) => setGoogleError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {/* Top to bottom: title near the sky, buttons in the middle, the note on the grass, links last.
          The two flexible gaps around the buttons are equal (login-gap). */}
      <header class="login-head">
        <h1 class="logo">NEARvest</h1>
        <p class="tagline">Grow. Harvest. Own.</p>
      </header>
      <div class="login-gap" aria-hidden="true" />

      {/* One column, every button the same width (pixel-game style sign-in). */}
      <div class="login-actions">
        <GoogleButton
          clientId={config.googleClientId}
          width={LOGIN_BUTTON_W}
          redirectOnIOS
          onCredential={async (credential) => {
            const res = await api<{ token: string; player: GameState | null }>('POST', '/auth/google', { credential });
            onLoggedIn(res.token, res.player);
          }}
          onError={setGoogleError}
        />
        <button class="btn btn-wallet" onClick={walletLogin} disabled={busy} aria-busy={walletOpening}>
          {walletOpening ? 'Opening wallets...' : 'Connect NEAR Wallet'}
        </button>
        <button
          class="btn btn-judge"
          onClick={judgeLogin}
          disabled={busy}
          title="One click, no sign-in: your own ready garden with real testnet Tree NFTs, PANEN and TaniBot, plus a 5-step tour."
        >
          {busy && !walletOpening ? 'Preparing your garden...' : 'Try as Judge'}
        </button>
        <button class="link-btn how-link" onClick={onHelp}>
          How to play
        </button>
      </div>

      {/* Dev login: local `npm run dev` only. The whole component is left out of production
          builds (import.meta.env.DEV is false there), not only hidden; the server refuses it too. */}
      {import.meta.env.DEV && config.devLogin && <DevLogin busy={busy} setBusy={setBusy} setError={setError} onLoggedIn={onLoggedIn} />}
      {googleError && <p class="error-text">{googleError}</p>}
      {error && <p class="error-text">{error}</p>}
      <div class="login-gap" aria-hidden="true" />
      <footer class="login-bottom">
        {/* The note is shown in the middle of the empty grass (absolutely placed); an invisible copy
            keeps its old place in the column, so the title and the buttons do not move. */}
        <p class="login-foot small login-foot-ghost" aria-hidden="true">
          Sign in with <b>Google</b> or a <b>NEAR wallet</b>. With Google you need no wallet: the game creates your NEAR {config.network} account and pays all fees. Testnet tokens have no real value.
        </p>
        <p class="login-foot small login-foot-grass">
          Sign in with <b>Google</b> or a <b>NEAR wallet</b>. With Google you need no wallet: the game creates your NEAR {config.network} account and pays all fees. Testnet tokens have no real value.
        </p>
        <p class="login-legal small">
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </footer>
    </main>
    </div>
  );
}

/** GET /api/me with this browser's random id (the server refuses self-invites with it, referral.ts). */
const ME_PATH = () => `/api/me?device=${encodeURIComponent(judgeDeviceId())}`;

/** Longest farmer name for a new garden (the server refuses longer ones: NEW_NAME_MAX). */
const NAME_MAX = 16;

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
      // An invite link opened in this browser (?ref=, kept 7 days): the server decides if it counts.
      const ref = readRef(localStorage, Date.now());
      onCreated(await api<GameState>('POST', '/api/player', { name: clean, demo, deviceId: judgeDeviceId(), ...(ref ? { ref } : {}) }));
      clearRef(localStorage);
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
        <input
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value.slice(0, NAME_MAX))}
          placeholder="your-name"
          maxLength={NAME_MAX}
          autocomplete="off"
          aria-label="Farmer name"
          aria-describedby="name-count"
        />
        <div class="name-meta">
          <p class="account-preview">{walletAccount ?? `${clean || 'your-name'}.nearvest.testnet`}</p>
          <span id="name-count" class={`name-count${name.length >= NAME_MAX ? ' full' : ''}`} aria-label={`${name.length} of ${NAME_MAX} characters`}>
            {name.length}/{NAME_MAX}
          </span>
        </div>
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
