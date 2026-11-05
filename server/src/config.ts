// Server configuration, read from environment variables (see .env.example).

export interface Config {
  port: number;
  /** "near" talks to NEAR testnet; "fake" keeps everything local (dev and tests). */
  chainMode: 'near' | 'fake';
  networkId: string;
  rpcUrl: string;
  explorerTxUrl: string;
  factoryAccountId: string;
  gameAccountId: string;
  gamePrivateKey: string;
  panenContractId: string;
  pohonContractId: string;
  /** 32-byte key (base64) used to encrypt player keys in the database. */
  masterKey: string;
  databasePath: string;
  googleClientId: string;
  devLogin: boolean;
  /** New players start in demo mode (1 game day = 1 minute) when true. */
  demoModeDefault: boolean;
  /** NEAR attached to fund each new player account's storage. */
  playerAccountDepositNear: string;
  webOrigins: string[];
}

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}`);
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export function loadConfig(): Config {
  const chainMode = env('CHAIN_MODE', 'fake') === 'near' ? 'near' : 'fake';
  const needsChain = chainMode === 'near';
  return {
    port: Number(env('PORT', '8787')),
    chainMode,
    networkId: env('NEAR_NETWORK', 'testnet'),
    rpcUrl: env('NEAR_RPC_URL', 'https://test.rpc.fastnear.com'),
    explorerTxUrl: env('EXPLORER_TX_URL', 'https://testnet.nearblocks.io/txns/'),
    factoryAccountId: env('FACTORY_ACCOUNT_ID', 'nearvest.testnet'),
    gameAccountId: env('GAME_ACCOUNT_ID', 'game.nearvest.testnet'),
    gamePrivateKey: needsChain ? env('GAME_PRIVATE_KEY') : env('GAME_PRIVATE_KEY', ''),
    panenContractId: env('PANEN_CONTRACT_ID', 'panen.nearvest.testnet'),
    pohonContractId: env('POHON_CONTRACT_ID', 'pohon.nearvest.testnet'),
    masterKey: env('MASTER_KEY'),
    databasePath: env('DATABASE_PATH', './data/nearvest.sqlite'),
    googleClientId: env('GOOGLE_CLIENT_ID', ''),
    devLogin: bool('DEV_LOGIN', false),
    demoModeDefault: bool('DEMO_MODE_DEFAULT', false),
    playerAccountDepositNear: env('PLAYER_ACCOUNT_DEPOSIT_NEAR', '0.003'),
    webOrigins: env('WEB_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
