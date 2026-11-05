// Dev-only art gallery (http://localhost:5173/preview.html). Not part of the production build.
import { render } from 'preact';
import { Backdrop } from './art/backdrop';
import { DartoFigure, HoverCart } from './art/darto';
import { ShopStall } from './art/shop';
import { Drone, TaniBot } from './art/tanibot';
import { TreePixels } from './art/trees';
import type { Quality, Species, Stage } from './api';
import './styles.css';

const SPECIES: Species[] = ['mango', 'rambutan', 'durian'];
const STAGES: Stage[] = ['seed', 'sprout', 'tree', 'fruiting', 'old'];
// Fractions of the village day: 13:00, 17:40 (dusk), 18:20 (dusk), 01:00.
const PHASES = [6 / 24, 10.67 / 24, 11.33 / 24, 18 / 24];

function Gallery() {
  return (
    <main class="preview">
      <h2>Trees</h2>
      {SPECIES.map((s) => (
        <div class="preview-row" key={s}>
          {STAGES.map((st) => (
            <div key={st} class="preview-cell">
              <TreePixels species={s} stage={st} quality={'common' as Quality} scale={3} />
              <small>
                {s} {st}
              </small>
            </div>
          ))}
        </div>
      ))}
      <div class="preview-row">
        <div class="preview-cell"><TreePixels species="durian" stage="fruiting" quality="rare" scale={3} /><small>rare</small></div>
        <div class="preview-cell"><TreePixels species="mango" stage="fruiting" quality="gold" scale={3} /><small>gold</small></div>
      </div>
      <h2>TaniBot v1 / v2, drones</h2>
      <div class="preview-row">
        <TaniBot version={1} scale={2} />
        <TaniBot version={2} scale={2} />
        <Drone version={1} scale={4} />
        <Drone version={2} scale={4} />
      </div>
      <h2>Mr. Darto</h2>
      <div class="preview-row">
        <DartoFigure pose="idle" scale={3} />
        <DartoFigure pose="wave" scale={3} />
        <DartoFigure pose="durian" scale={3} />
        <HoverCart scale={3} />
      </div>
      <h2>Shop</h2>
      <div class="preview-row">
        <ShopStall scale={3} />
      </div>
      <h2>Backdrop</h2>
      {PHASES.map((p) => (
        <div key={p} class="scene preview-scene">
          <Backdrop fraction={p} />
        </div>
      ))}
    </main>
  );
}

render(<Gallery />, document.getElementById('app')!);
