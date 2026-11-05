// Dev-only art gallery (http://localhost:5173/preview.html). Not part of the production build.
import { render } from 'preact';
import { Backdrop, type Phase } from './art/backdrop';
import { DartoFigure, HoverCart } from './art/darto';
import { Drone, TaniBot } from './art/tanibot';
import { TreePixels } from './art/trees';
import type { Quality, Species, Stage } from './api';
import './styles.css';

const SPECIES: Species[] = ['mango', 'rambutan', 'durian'];
const STAGES: Stage[] = ['seed', 'sprout', 'tree', 'fruiting', 'old'];
const PHASES: Phase[] = ['day', 'dusk', 'night'];

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
        <TaniBot version={1} scale={4} />
        <TaniBot version={2} scale={4} />
        <Drone version={1} scale={4} />
        <Drone version={2} scale={4} />
      </div>
      <h2>Mr. Darto</h2>
      <div class="preview-row">
        <DartoFigure scale={5} />
        <HoverCart scale={4} />
      </div>
      <h2>Backdrop</h2>
      {PHASES.map((p) => (
        <div key={p} class="scene preview-scene">
          <Backdrop phase={p} />
        </div>
      ))}
    </main>
  );
}

render(<Gallery />, document.getElementById('app')!);
