// Creates server/.env with fresh secrets (only if it does not exist yet).
// Prints only the PUBLIC key of the game account, never the secrets.
//
// Usage: node scripts/init-env.ts

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { KeyPair } from 'near-api-js';

const path = new URL('../.env', import.meta.url);
if (existsSync(path)) {
  console.log('server/.env already exists; nothing changed.');
  process.exit(0);
}

const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const gameKey = KeyPair.fromRandom('ed25519');
const filled = example
  .replace(/^GAME_PRIVATE_KEY=.*$/m, `GAME_PRIVATE_KEY=${gameKey.toString()}`)
  .replace(/^MASTER_KEY=.*$/m, `MASTER_KEY=${randomBytes(32).toString('base64')}`);

writeFileSync(path, filled, { mode: 0o600 });
console.log('Created server/.env (permissions 600).');
console.log(`Game account public key: ${gameKey.getPublicKey().toString()}`);
