// Profile window: opened from the player's avatar/name (top left).

import { useState } from 'preact/hooks';
import { api, nearblocksAccount, type GameState, type ServerConfig } from './api';
import { Avatar, AVATAR_IDS, AVATARS, avatarTitle } from './art/avatars';
import { GoogleButton } from './google';
import { Modal } from './help';
import { Panel } from './ui';
import { walletProof } from './wallet';

const SIGN_IN_LABEL: Record<GameState['player']['signIn'], string> = {
  google: 'Google',
  near: 'NEAR wallet',
  dev: 'Dev login (local testing)',
  judge: 'Try as Judge (this device)',
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
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const methods = [
    SIGN_IN_LABEL[p.signIn],
    ...(p.custody === 'server' && p.walletAccountId ? ['NEAR wallet (linked)'] : []),
    ...(p.custody === 'wallet' && p.googleLinked ? ['Google (linked)'] : []),
  ];

  const pick = async (avatar: string) => {
    setError(null);
    try {
      onState(await api<GameState>('POST', '/api/avatar', { avatar }));
      setPicking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title="Profile" onClose={onClose} closeLabel="Close" class="profile-dialog">
      <div class="profile-card">
        <div class="profile-head">
          <Avatar id={p.avatar} size={96} />
          <div>
            <b class="profile-name">{p.name}</b>
            <span class="block title-line">
              {p.title} · {p.xp} XP
            </span>
            <button class="link-btn profile-change" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
              {picking ? 'Keep this avatar' : 'Change avatar'}
            </button>
          </div>
        </div>
        {picking && (
          <div class="avatar-grid" role="list" aria-label="Choose an avatar">
            {AVATAR_IDS.map((id) => {
              // TaniBot heads unlock with their title.
              const needs = avatarTitle(id);
              const needXp = needs ? (config.titles.find((t) => t.name === needs)?.xp ?? Infinity) : 0;
              const locked = p.xp < needXp;
              return (
                <button
                  key={id}
                  role="listitem"
                  class={`avatar-choice${id === p.avatar ? ' selected' : ''}${locked ? ' locked' : ''}`}
                  onClick={() => !locked && void pick(id)}
                  aria-pressed={id === p.avatar}
                  aria-disabled={locked}
                  title={locked ? `Reach ${needs} to unlock` : AVATARS[id].name}
                >
                  <span class="avatar-wrap">
                    <Avatar id={id} size={48} locked={locked} />
                    {locked && (
                      <i class="avatar-lock" aria-hidden="true">
                        <b />
                      </i>
                    )}
                  </span>
                  <span>{locked ? `Reach ${needs}` : AVATARS[id].name}</span>
                </button>
              );
            })}
          </div>
        )}
        {error && <p class="error-text">{error}</p>}
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
      </div>
      <WalletPanel state={state} config={config} onState={onState} />
      {p.custody === 'wallet' && <GooglePanel state={state} config={config} onState={onState} />}
      <Panel title="Farmer Card">
        <div class="farmer-card-slot">Your Farmer Card (a soulbound NFT) will appear here soon.</div>
      </Panel>
      <button class="btn profile-signout" onClick={onSignOut}>
        Sign out
      </button>
    </Modal>
  );
}

/** Wallet gardens: link one Google account, so Google sign-in opens this garden too. */
function GooglePanel({ state, config, onState }: { state: GameState; config: ServerConfig; onState: (s: GameState) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={state.player.googleLinked ? 'Google account' : 'Link Google account'}>
      {state.player.googleLinked ? (
        <p class="muted small">A Google account is linked. You can also sign in to this garden with Google.</p>
      ) : (
        <>
          <p class="muted small">Link your Google account to sign in to this garden with Google too. One Google account per garden.</p>
          <GoogleButton
            clientId={config.googleClientId}
            text="continue_with"
            redirectOnIOS="link"
            onCredential={async (credential) => {
              setError(null);
              onState(await api<GameState>('POST', '/api/google/link', { credential }));
            }}
            onError={setError}
          />
        </>
      )}
      {error && <p class="error-text">{error}</p>}
    </Panel>
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
