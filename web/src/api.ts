// Client for the NEARvest game server.

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8787';

export type Species = 'mango' | 'rambutan' | 'durian';
export type Quality = 'common' | 'rare' | 'gold';
export type Stage = 'seed' | 'sprout' | 'tree' | 'fruiting' | 'old';

export interface TreeView {
  id: number;
  tokenId: string | null;
  species: Species;
  quality: Quality;
  stage: Stage;
  growthPercent: number;
  ready: boolean;
  wateredToday: boolean;
  isWatered: boolean;
  isFertilized: boolean;
  /** Real ms of fertilizer boost left. */
  fertMsLeft: number;
  /** Growth speed right now (1.5 while fertilized). */
  fertSpeed: number;
  /** Chances of each fruit quality on the next harvest (fertilizer raises them). */
  nextHarvestOdds: Record<Quality, number>;
  harvestCount: number;
  maxHarvests: number;
  msToReady: number;
  ageDays: number;
}

export interface Activity {
  id: number;
  kind: string;
  status: 'pending' | 'done' | 'failed';
  txHash: string | null;
  explorerUrl: string | null;
  error: string | null;
  createdAt: number;
}

export interface DartoPrice {
  species: Species;
  price: number;
  base: number;
  min: number;
  max: number;
}

export interface GameState {
  player: {
    name: string;
    accountId: string;
    accountStatus: 'pending' | 'ready' | 'failed';
    /** 'server' = Google garden (game holds the key), 'wallet' = the player's own NEAR account. */
    custody: 'server' | 'wallet';
    /** NEAR wallet that can sign in to this garden (own account or linked), if any. */
    walletAccountId: string | null;
    /** How the owner signs in: Google, NEAR wallet (wallet garden) or local dev login. */
    signIn: 'google' | 'near' | 'dev' | 'judge';
    /** Wallet gardens: a Google account is linked (Google sign-in opens this garden too). */
    googleLinked: boolean;
    /** Profile avatar id (web/src/art/avatars.tsx). */
    avatar: string;
    /** TaniBot at a glance (null = not activated yet). */
    tanibot: {
      status: 'creating' | 'linking' | 'ready' | 'failed';
      enabled: boolean;
      alert: 'low' | 'limit' | null;
      last: { id: number; text: string; at: number } | null;
    } | null;
    demo: boolean;
    balance: number;
    xp: number;
    title: string;
    nextTitle: { name: string; xp: number } | null;
    /** 5 in demo mode (faster titles for judges), 1 otherwise. */
    xpMultiplier: number;
  };
  clock: { day: number; farmDay: number; msUntilNextDay: number; dayLengthMs: number };
  checkin: { available: boolean; streak: number; nextCalendarDay: number; calendar: { day: number; reward: string }[] };
  plots: { plot: number; locked: boolean; tree: TreeView | null }[];
  seeds: { id: number; species: Species; quality: Quality | null; parentTreeId: number | null; source: string }[];
  seedSlots: { used: number; max: number };
  fruits: { species: Species; quality: Quality; qty: number }[];
  items: { item: string; qty: number }[];
  darto: { day: number; prices: DartoPrice[]; greeting: string };
  /** $PANEN Season: Mr. Darto's sale rewards are divided by `divisor`. */
  season: { number: number; divisor: number; rewardPercent: number };
  activity: Activity[];
  /** New gardens: the current tutorial step (null when finished or skipped). */
  tutorial: { step: TutorialStep; index: number; total: number } | null;
  /** Try as Judge gardens only: the 5-step tour (null for everyone else). */
  judgeTour: { step: JudgeStep; done: boolean; txStatus: 'pending' | 'done' | 'failed' | null; txUrl: string | null }[] | null;
}

export type TutorialStep = 'welcome' | 'plant' | 'water' | 'buy_fertilizer' | 'fertilize' | 'checkin' | 'harvest' | 'sell' | 'tanibot';

export type JudgeStep = 'harvest' | 'sell' | 'shop' | 'tanibot' | 'village';

export type BotStyle = 'thrifty' | 'balanced' | 'turbo';

export interface TaniBotLogEntry {
  id: number;
  action: string;
  reason: string;
  brain: 'rules' | 'ai';
  at: number;
  txStatus: 'pending' | 'done' | 'failed' | null;
  txUrl: string | null;
}

export interface TaniBotView {
  accountId: string;
  explorerUrl: string;
  status: 'creating' | 'linking' | 'ready' | 'failed';
  enabled: boolean;
  style: BotStyle;
  brain: 'rules' | 'ai';
  budget: number;
  dailyLimit: number;
  spentToday: number;
  remainingToday: number;
  nextRunAt: number | null;
  /** Plant empty plots: 'off' or 'common' (Common / unknown seeds only, never Rare or Gold). */
  autoPlant: 'off' | 'common';
  log: TaniBotLogEntry[];
}

export interface TaniBotResponse {
  bot: TaniBotView | null;
  brain: 'rules' | 'ai';
  /** NEAR AI model when the AI brain is on. */
  model: string | null;
  defaults: { dailyLimit: number; budget: number; maxDailyLimit: number };
  walletCalls?: { receiverId: string; method: string; args: Record<string, unknown>; deposit: string }[] | null;
  state?: GameState;
}

export interface ServerConfig {
  network: string;
  /** Transaction page base, e.g. https://testnet.nearblocks.io/txns/ */
  explorerTxUrl: string;
  googleClientId: string | null;
  devLogin: boolean;
  contracts: { panen: string; pohon: string };
  wallet: {
    loginRecipient: string;
    gameKey: { contractId: string; methodNames: string[]; allowance: string };
  };
  shop: Record<string, { name: string; price: number }>;
  species: Record<Species, { name: string; seedPrice: number; sellPrice: number; xpPerHarvest: number }>;
  titles: { name: string; xp: number }[];
  demoXpMultiplier: number;
  seedStorageSlots: number;
  seedSellPrices: Record<Species, number>;
  fertilizedOdds: Record<Quality, Record<Quality, number>>;
}

export interface VillageStats {
  panen: {
    totalMinted: number;
    totalBurned: number;
    circulatingSupply: number;
    season: number;
    rewardDivisor: number;
    nextSeasonAt: number | null;
  };
  treeNfts: number;
  village: {
    players: number;
    treesAlive: number;
    memorialTrees: number;
    harvests: number;
    fruitsSold: number;
    pendingTransactions: number;
  };
}

export class ApiError extends Error {
  status: number;
  /** Extra fields from the server, e.g. { code: 'price_changed', price: 12 }. */
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const TOKEN_KEY = 'nearvest.token';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked (private mode): the session lasts until the tab closes.
  }
}

let token: string | null = loadToken();

export function setToken(t: string | null): void {
  token = t;
  saveToken(t);
}

export function hasToken(): boolean {
  return token !== null;
}

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the game server. Is it running?', 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status, json);
  return json as T;
}

export const ACTIVITY_LABELS: Record<string, string> = {
  create_account: 'NEAR account created',
  mint: 'PANEN minted',
  mint_reward: 'Harvest sale paid',
  burn: 'PANEN burned',
  mint_tree: 'Tree NFT minted',
  update_tree: 'Tree NFT updated',
  make_memorial: 'Memorial Tree saved',
  burn_wallet: 'PANEN burned',
  create_bot: "TaniBot's wallet created",
  bot_link: 'TaniBot linked with its daily limit',
  bot_limit: "TaniBot's daily limit changed",
  bot_fund: 'PANEN moved to TaniBot',
  bot_withdraw: 'PANEN taken back from TaniBot',
  bot_burn: 'TaniBot bought (PANEN burned)',
};

export function nearblocksAccount(accountId: string): string {
  return `https://testnet.nearblocks.io/address/${accountId}`;
}
