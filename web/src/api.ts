// Client for the NEARvest game server.

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) || 'http://127.0.0.1:8787';

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
  // Weather (servers before the weather release do not send these: treat missing as false / none).
  /** Waterings today and how many are needed (2 in a drought, 0 in the rain). */
  waterCount?: number;
  waterNeed?: number;
  /** No water for a while; `wilting`: it goes back one stage soon. */
  thirsty?: boolean;
  wilting?: boolean;
  msToWilt?: number | null;
  /** Went back one stage from thirst within the last game day. */
  wiltedRecently?: boolean;
  /** Covered in volcanic ash (no growth until cleaned with POST /api/clean, free). */
  ash?: boolean;
  /** Cleaned during the eruption: faster growth and a better Gold chance now. */
  volcanicSoil?: boolean;
}

/** A Memorial Tree: an old tree that dropped its seed, or a tree that was cut down. Its NFT stays. */
export interface MemorialView {
  id: number;
  tokenId: string | null;
  species: Species;
  quality: Quality;
  harvestCount: number;
  maxHarvests: number;
  plantedAt: number;
  diedAt: number | null;
  /** The plot it still stands on (until a new seed is planted there), or null. */
  plot: number | null;
}

export type WeatherKind = 'clear' | 'rain' | 'drought';
export type EruptionPhase = 'warning' | 'eruption' | 'volcanic';

/** The village weather (the same for every garden of a mode). Never called a "season". */
export interface Weather {
  kind: WeatherKind;
  tomorrow: WeatherKind;
  waterNeed: number;
  wiltDays: number;
  eruption: null | {
    phase: EruptionPhase;
    msSinceWarning: number;
    msToEruption: number;
    msToEnd: number;
    msToVolcanicEnd: number;
    msLeft: number;
    /** Stable id of this eruption (for once-only notices and the share card). */
    id: string;
  };
}

export interface Activity {
  id: number;
  kind: string;
  status: 'pending' | 'done' | 'failed';
  txHash: string | null;
  explorerUrl: string | null;
  error: string | null;
  createdAt: number;
  /** 'referral' = a referral reward / bonus mint; 'arena' = an Arena prize (missing on older servers). */
  note?: 'referral' | 'arena' | null;
}

/** A sticker a visitor left in your garden (newest first). */
export interface StickerView {
  id: number;
  sticker: string;
  text: string;
  at: number;
  from: string;
}

/** Village tab "Visitors": one row per visitor per village day (servers from 2026-11-10 on). */
export interface VisitorView {
  /** The visit row (wave back: POST /api/visitors/:id/wave). */
  id: number;
  from: string;
  avatar: string;
  /** Last visit / sticker / help that day. */
  at: number;
  /** The row is from today's village day. */
  today: boolean;
  /** Stickers this visitor left that day (up to 3, oldest first). */
  stickers: StickerKind[];
  /** The tree they watered that day, if any. */
  watered: Species | null;
  /** The owner's wave back on this row. */
  wave: StickerKind | null;
  /** The owner has not waved back to this visitor today. */
  canWave: boolean;
}

/** A wave back the player got from a garden they visited. */
export interface WaveView {
  id: number;
  from: string;
  avatar: string;
  sticker: string;
  text: string;
  at: number;
}

/** One of the 6 template stickers (server rules.ts STICKERS). */
export interface StickerKind {
  id: string;
  text: string;
}

/** Invite a friend (referral): rewards, friends invited, who invited this garden. */
export interface ReferralView {
  /** Judge gardens cannot invite. */
  canInvite: boolean;
  /** referrer = base PANEN (Season rule), referrerNow = after today's Season, friend = exact. */
  rewards: { referrer: number; referrerNow: number; friend: number };
  invited: { id: number; name: string; status: 'pending' | 'paid'; at: number; paidAt: number | null; txUrl: string | null }[];
  invitedBy: { id: number; name: string; status: 'pending' | 'paid'; paidAt: number | null; txUrl: string | null } | null;
}

export interface DartoPrice {
  species: Species;
  price: number;
  base: number;
  min: number;
  max: number;
}

/** A friend watered one of your trees (garden visits). */
export interface HelpView {
  id: number;
  plot: number;
  /** XP you got for it (0 after 3 helps a day, or while your garden is less than a day old). */
  xp: number;
  at: number;
  helper: string;
  species: Species;
}

/** A row of the farmer list (GET /api/farmers): public data only. */
export interface FarmerRow {
  name: string;
  avatar: string;
  title: string;
  trees: number;
  /** Trees a visitor can help water now. */
  thirsty: number;
  helpedYou: boolean;
  /** A Try as Judge garden (only while there are fewer than 5 farmers). */
  judge: boolean;
  /** Servers from 2026-11-11 on (missing = no Add friend / Online on this server). */
  friend?: boolean;
  online?: boolean;
}

/** Add friend on this server: how many friends, adds left today and the limits. */
export interface MyFriends {
  count: number;
  max: number;
  addsLeft: number;
  addsPerDay: number;
}

/** "<name> added you as a friend" (Village tab + notice). */
export interface FriendAddView {
  id: number;
  from: string;
  avatar: string;
  title: string;
  at: number;
  /** You added them too (no "Add back"). */
  mutual: boolean;
  online: boolean;
}

export interface HelpRules {
  /** XP the viewer gets for helping (0 while their garden is less than a day old). */
  helperXp: number;
  youngGarden: boolean;
  perDay: number;
}

export interface FarmersResponse {
  farmers: FarmerRow[];
  /** The friend's garden the viewer helped today (one per day), if any. */
  helpedToday: { name: string; plot: number } | null;
  help: HelpRules;
  /** The search the list answers (null / missing = the normal list). */
  query?: string | null;
  /** Servers from 2026-11-11 on: your friends (on top of the list) and your friend limits. */
  friends?: FarmerRow[];
  myFriends?: MyFriends;
}

/** A friend's garden as visitors see it (read only). */
export interface PublicGarden {
  name: string;
  accountId: string;
  avatar: string;
  title: string;
  demo: boolean;
  weather: { kind: string; waterNeed: number };
  /** The owner's TaniBot: ON / OFF only (null = none; missing on servers before 2026-11-10). */
  tanibot?: { on: boolean } | null;
  plots: {
    plot: number;
    locked: boolean;
    tree: {
      tokenId: string | null;
      species: Species;
      quality: Quality;
      stage: Stage;
      growthPercent: number;
      ready: boolean;
      harvestCount: number;
      maxHarvests: number;
      waterCount: number;
      waterNeed: number;
      isWatered: boolean;
      thirsty: boolean;
      wilting: boolean;
      ash: boolean;
      volcanicSoil: boolean;
      /** A visitor can help water it now. */
      needsWater: boolean;
    } | null;
    memorial: { species: Species; quality: Quality; tokenId: string | null; harvestCount: number } | null;
  }[];
}

export interface VisitResponse {
  garden: PublicGarden;
  own: boolean;
  helpedToday: { name: string; plot: number } | null;
  help: HelpRules;
  /** Template stickers (missing on servers without stickers: no sticker button). */
  stickers?: StickerKind[];
  /** The last sticker the viewer left here today. */
  stickerToday?: string | null;
  /** Servers from 2026-11-10 on: every sticker left here today, the daily limit (3) and the wait left (ms). */
  stickersToday?: string[];
  stickerMax?: number;
  stickerWaitMs?: number;
  /** Servers from 2026-11-11 on: you added this garden as a friend; it is online now. */
  friend?: boolean;
  online?: boolean;
  myFriends?: MyFriends;
}

export interface HelpResult {
  watered: boolean;
  owner: string;
  plot: number;
  species: Species;
  waterings: number;
  needed: number;
  helperXp: number;
  ownerXp: number;
  noXpReason: 'young' | null;
  titleUp: string | null;
}

export interface GameState {
  /** Missing on servers from before the weather release. */
  weather?: Weather;
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
  /** `memorial`: a Memorial Tree standing on the plot (missing on older servers). */
  plots: { plot: number; locked: boolean; tree: TreeView | null; memorial?: MemorialView | null }[];
  /** The player's Memorial Trees, newest first (missing on older servers). */
  memorials?: MemorialView[];
  /** Friends who helped water this garden lately (newest first). Missing on servers without garden visits. */
  helps?: HelpView[];
  /** Stickers visitors left here, last 10 (missing on servers without stickers). */
  stickers?: StickerView[];
  /** Visitors (1 row per visitor per day) and waves back (missing on older servers: the sticker list instead). */
  visitors?: VisitorView[];
  waves?: WaveView[];
  /**
   * Red dots (servers from 2026-11-10 on; missing = no Village / Friends dot): the newest Village
   * event (visitor, sticker, watering, wave back, paid referral), the newest wave back and the
   * newest one the owner has seen (stored on the server, the same on every device).
   */
  news?: { latestAt: number; waveAt: number; seenAt: number };
  /**
   * Red dot on the Market tab (servers from 2026-11-10 on; missing = this browser remembers what it
   * saw, dots.ts): when fruit was last added and the newest one the owner saw by opening the Market.
   */
  market?: { fruitAt: number; seenAt: number };
  /** Add friend + Online (missing on older servers: no Add friend, no Online dots, no ping). */
  friends?: MyFriends & { onlineMs: number; pingMs: number };
  /** Who added this garden as a friend, newest first (Village tab + notice). */
  friendAdds?: FriendAddView[];
  /** Invite a friend (missing on servers without referral: no invite box). */
  referral?: ReferralView;
  /** Arena 1 VS 1 (missing on servers without the Arena: the Arena pin says "Soon"). */
  arena?: ArenaState;
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
  /** The online Arena duel is switched on (server ARENA_ONLINE; missing on older servers = off). */
  arenaOnline?: boolean;
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

/**
 * A small POST that may outlive the page (the tab is being hidden or closed): fetch with
 * keepalive and the session header. Errors are ignored (it is only a hint for the Online dot).
 */
export function apiKeepalive(path: string, body: unknown): void {
  if (!token) return;
  try {
    void fetch(API_URL + path, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // Not sent: the dot goes out by itself a minute later.
  }
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

/** The log label of a chain job (referral mints are not harvest sales). */
export function activityLabel(a: Pick<Activity, 'kind' | 'note'>): string {
  if (a.note === 'arena') return 'Arena prize minted';
  if (a.note === 'referral') return a.kind === 'mint_reward' ? 'Referral reward paid' : 'Referral bonus minted';
  return ACTIVITY_LABELS[a.kind] ?? a.kind;
}

/** A Tree NFT on nearblocks (testnet). */
export function nearblocksNft(contractId: string, tokenId: string): string {
  return `https://testnet.nearblocks.io/nft-token/${contractId}/${encodeURIComponent(tokenId)}`;
}

export function nearblocksAccount(accountId: string): string {
  return `https://testnet.nearblocks.io/address/${accountId}`;
}

// ---------- Arena 1 VS 1 (server/src/arena.ts, docs/PLAN-arena.md) ----------

export type ArenaRound = 'quality' | 'care' | 'ripeness';
export type ArenaScores = Record<ArenaRound, number>;

/** One side of a duel (public data only). */
export interface DuelSide {
  name: string;
  avatar: string;
  title: string;
  scores: ArenaScores;
  best: { species: Species; quality: Quality } | null;
  ripest: { species: Species; quality: Quality; stage: Stage } | null;
  trees: number;
}

export interface DuelRound {
  round: ArenaRound;
  c: { score: number; dice: number[] };
  d: { score: number; dice: number[] };
  winner: 'challenger' | 'defender';
}

export interface DuelView {
  id: number;
  at: number;
  you: 'challenger' | 'defender';
  challenger: DuelSide;
  defender: DuelSide;
  rounds: DuelRound[];
  winner: 'challenger' | 'defender';
  score: { challenger: number; defender: number };
  /** null = a real duel; 'self' = one person's gardens; 'limit' = the day's paid wins are used up. */
  practice: 'self' | 'limit' | null;
  /** PANEN the challenger received (after the Season rule). */
  prize: number;
  prizeStatus: 'pending' | 'done' | 'failed' | null;
  txUrl: string | null;
  gainedXp: number;
}

export interface ArenaState {
  left: number;
  max: number;
  prize: number;
  prizeNow: number;
  /** Duels this garden was challenged in (newest first, last 10). */
  received: DuelView[];
  /** 2 = the server plays turn-based matches (Arena v2, Rock / Paper / Scissors); missing = v1 duels only. */
  v?: 2;
  /** v2: this garden's match still being played (resume it). */
  active?: { id: number; opponent: string; live?: boolean } | null;
  /** v2: finished matches this garden was challenged in (newest first). */
  receivedMatches?: MatchSummary[];
  /** The online duel is switched on (server ARENA_ONLINE): Duel on an online garden sends an invite. */
  online?: boolean;
}

// ---------- Arena v2 (server/src/arena-match.ts): Rock / Paper / Scissors against a TaniBot ----------
export type Rps = 'rock' | 'paper' | 'scissors';
export type ArenaPick = Rps | 'gold';

export interface TurnHit {
  to: 'challenger' | 'defender';
  fruit: { species: Species; quality: Quality };
  damage: number;
  /** The Gold Durian (sure hit). */
  gold: boolean;
}

/** A decided turn (both picks are only sent once the turn is decided). */
export interface TurnLog {
  turn: number;
  /** 'timeout' = the player did not pick within the 10 s and lost the turn. */
  pick: { c: ArenaPick | 'timeout'; d: ArenaPick | 'timeout' };
  winner: 'challenger' | 'defender' | 'tie' | 'both';
  hits: TurnHit[];
  hp: { c: number; d: number };
  skill: { c: number; d: number };
}

export interface MatchSummary {
  id: number;
  v: 2;
  /** 'bot' = against the other garden's TaniBot; 'live' = the online duel against the player. */
  kind: 'bot' | 'live';
  at: number;
  endedAt: number | null;
  you: 'challenger' | 'defender';
  challenger: DuelSide;
  defender: DuelSide;
  /** 'invite' / 'paused' / 'cancelled' only in online duels (servers with ARENA_ONLINE). */
  status: 'invite' | 'playing' | 'paused' | 'done' | 'cancelled';
  /** Turns decided so far; the next pick is for turn `turn`. */
  turn: number;
  /** The turn clock, measured on the server: 10 s per turn. The open turn's 10 s start in
   *  `turnStartsInMs` (while the last turn plays back), then `turnMsLeft` count down (at answer time). */
  turnMs?: number;
  turnStartsInMs?: number;
  turnMsLeft?: number;
  hp: { c: number; d: number };
  maxHp: number;
  skill: { c: number; d: number };
  skillMax: number;
  /** Garden bonus in percent (0-20). */
  bonus: { c: number; d: number };
  winner: 'challenger' | 'defender' | null;
  endReason: 'ko' | 'turns' | 'left' | 'abandoned' | null;
  practice: 'self' | 'limit' | null;
  prize: number;
  prizeStatus: 'pending' | 'done' | 'failed' | null;
  txUrl: string | null;
  gainedXp: number;
  turnCount?: number;
  // Online duel (servers with ARENA_ONLINE): the other player's open pick is never sent.
  /** Your own pick for the open turn (kept after a refresh). */
  myPick?: ArenaPick | null;
  /** The other player has picked for the open turn (not what). */
  theyPicked?: boolean;
  inviteLeftMs?: number;
  /** How the invite ended: 'declined' / 'timeout' / 'busy' / 'skipped' / 'judge' = a TaniBot duel now. */
  inviteResult?: 'accepted' | 'declined' | 'timeout' | 'busy' | 'skipped' | 'judge' | 'cancelled' | null;
  /** Paused: the player the duel waits for, and their time left. */
  waitingFor?: string | null;
  pauseLeftMs?: number;
}

/** An online duel invite (in the ping's answer). */
export interface ArenaInvite {
  id: number;
  from: string;
  avatar: string;
  title: string;
  msLeft: number;
}

export interface MatchView extends MatchSummary {
  turns: TurnLog[];
}

export interface ArenaOpponent {
  name: string;
  avatar: string;
  title: string;
  trees: number;
  judge: boolean;
  dueledToday: boolean;
  /** Servers from 2026-11-11 on. */
  friend?: boolean;
  online?: boolean;
}

export interface ArenaView {
  left: number;
  max: number;
  prize: number;
  prizeNow: number;
  blocked: 'no_tree' | 'limit' | null;
  you: DuelSide;
  opponents: ArenaOpponent[];
  recent: DuelView[];
  /** v2 servers: finished turn-based matches (both roles). */
  v?: 2;
  matches?: MatchSummary[];
}

export interface ArenaCan {
  ok: boolean;
  reason: 'own_garden' | 'no_tree' | 'no_tree_them' | 'limit' | 'pair_today' | null;
  left: number;
}
