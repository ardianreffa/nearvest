// Phones held sideways (landscape) do not show the game: a pixel screen with TaniBot asks to turn
// the phone upright. Only small screens (phones, and Chrome's device mode such as 956x440): CSS
// shows it with a media query (styles.css "Turn your phone"), so laptops and big tablets never see it.

import { render } from 'preact';
import { TaniBot } from './art/tanibot';

function RotateScreen() {
  return (
    <div class="rotate-inner">
      <TaniBot tier="seedling" scale={2} />
      <div class="rotate-text">
        <div class="rotate-logo">NEARvest</div>
        <span class="rotate-phone" aria-hidden="true">
          <i />
        </span>
        <p>NEARvest is played in portrait mode only. Please turn your phone upright.</p>
      </div>
    </div>
  );
}

export function mountRotateScreen() {
  const el = document.createElement('div');
  el.className = 'rotate-screen';
  el.setAttribute('role', 'alert');
  document.body.appendChild(el);
  render(<RotateScreen />, el);
}
