// The Online dot's sign of life (docs/PLAN-arena.md 7.11): one tiny POST /api/ping every 30 s
// (the server says how often: `state.friends.pingMs`), ONLY while the game tab is visible. When the
// tab is hidden or closed the web says "away" once (fetch keepalive) and stops. No open connection
// (no WebSocket, no Server-Sent Events): the VPS has about 1 GB free. Servers without
// `state.friends` get no ping at all.

import { useEffect, useRef } from 'preact/hooks';
import { api, apiKeepalive, type ArenaInvite } from './api';
import { presenceOnVisibility } from './friends-logic';

/** The ping's answer. With the online Arena duel switched on, it carries an invite waiting for this player. */
export interface PingAnswer {
  online: boolean;
  invite?: ArenaInvite | null;
}

export function usePresence(pingMs: number | null | undefined, onAnswer?: (a: PingAnswer) => void): void {
  const cb = useRef(onAnswer);
  cb.current = onAnswer;
  useEffect(() => {
    if (!pingMs) return;
    let timer = 0;
    const ping = () =>
      void api<PingAnswer>('POST', '/api/ping', {})
        .then((a) => cb.current?.(a))
        .catch(() => undefined);
    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
    };
    const start = () => {
      stop();
      ping();
      // The online duel's invites need a quicker ping (the server sends 4 s then); never below 3 s.
      timer = window.setInterval(ping, Math.max(3_000, pingMs));
    };
    const away = () => {
      stop();
      apiKeepalive('/api/ping', { away: true });
    };
    const onVisibility = () => {
      const step = presenceOnVisibility(true, document.visibilityState === 'visible');
      if (step.kind === 'ping') start();
      else if (step.kind === 'away') away();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', away);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', away);
    };
  }, [pingMs]);
}
