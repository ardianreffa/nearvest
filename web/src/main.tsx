import { render } from 'preact';
import { App } from './app';
import { mountRotateScreen } from './rotate';
import { API_URL } from './api';
import { installChunkReload } from './chunk-reload';
import { installNoZoom } from './no-zoom';
import './fonts.css';
import './styles.css';

// A page opened before a new deploy reloads once instead of showing "Importing a module script failed."
installChunkReload();
// /play never zooms (iPhone double tap / pinch broke the layout); the landing page still zooms.
installNoZoom();

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
mountRotateScreen();
