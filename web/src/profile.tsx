// Profile window: opened from the player's avatar/name (top left).

import { useState } from 'preact/hooks';
import { api, nearblocksAccount, type GameState, type ServerConfig } from './api';
import { botVersion, TaniBotHead } from './art/tanibot';
import { Modal } from './help';
import { Panel } from './ui';
import { walletProof } from './wallet';

const SIGN_IN_LABEL: Record<GameState['player']['signIn'], string> = {
  google: 'Google',
  near: 'NEAR wallet',
  dev: 'Dev login (local testing)',
};

export function Profile({
  state,
  config,
  onState,
  onSignOut,
  onClose,
}: {
  state: GameState;
  config: ServerConfig;
  onState: (s: GameState) => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const p = state.player;
  const methods = [SIGN_IN_LABEL[p.signIn], ...(p.custody === 'server' && p.walletAccountId ? ['NEAR wallet (linked)'] : [])];
  return (
    <Modal title="Profile" onClose={onClose} closeLabel="Close">
      <div class="profile-head">
        <TaniBotHead version={botVersion(p.title)} scale={3} />
        <div>
          <b class="profile-name">{p.name}</b>
          <span class="block title-line">
            {p.title} · {p.xp} XP
          </span>
        </div>
      </div>
      <dl class="profile-facts">
        <dt>NEAR account</dt>
        <dd>
          <a href={nearblocksAccount(p.accountId)} target="_blank" rel="noreferrer">
            {p.accountId}
          </a>
        </dd>
        <dt>Signs in with</dt>
        <dd>{methods.join(' + ')}</dd>
      </dl>
      <WalletPanel state={state} config={config} onState={onState} />
      <Panel title="Farmer Card">
        <div class="farmer-card-slot">Your Farmer Card (a soulbound NFT) will appear here soon.</div>
      </Panel>
      <button class="btn profile-signout" onClick={onSignOut}>
        Sign out
      </button>
    </Modal>
  );
}

/** NEAR wallet: wallet gardens show their account; Google gardens can link one wallet ("Connect NEAR Wallet"). */
function WalletPanel({ state, config, onState }: { state: GameState; config: ServerConfig; onState: (s: GameState) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = state.player;

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const proof = await walletProof(config);
      onState(await api<GameState>('POST', '/api/wallet/link', proof));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="NEAR wallet">
      {p.custody === 'wallet' ? (
        <p class="muted small">This garden lives in your own NEAR wallet account {p.accountId}. You hold its keys; the game still pays the gas.</p>
      ) : p.walletAccountId ? (
        <p class="muted small">
          Linked wallet:{' '}
          <a href={nearblocksAccount(p.walletAccountId)} target="_blank" rel="noreferrer">
            {p.walletAccountId}
          </a>
          . You can also sign in with it.
        </p>
      ) : (
        <>
          <p class="muted small">Link your own NEAR wallet to this garden so you can also sign in with it. One wallet per garden; no gas fees.</p>
          <button class="btn btn-wallet" onClick={connect} disabled={busy}>
            {busy ? 'Waiting for your wallet...' : 'Connect NEAR Wallet'}
          </button>
        </>
      )}
      {error && <p class="error-text">{error}</p>}
    </Panel>
  );
}
