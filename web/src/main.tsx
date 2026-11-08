import { render } from 'preact';
import { App } from './app';
import { API_URL } from './api';
import './fonts.css';
import './styles.css';

// Look up and open the connection to the game server while the page loads, so the first action
// does not wait for DNS (sslip.io) and the TLS handshake.
for (const rel of ['dns-prefetch', 'preconnect']) {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = new URL(API_URL).origin;
  if (rel === 'preconnect') link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

render(<App />, document.getElementById('app')!);
