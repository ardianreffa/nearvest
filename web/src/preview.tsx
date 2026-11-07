// Dev-only art gallery (http://localhost:5173/preview.html). Not part of the production build.
import { render } from 'preact';
import { Backdrop } from './art/backdrop';
import { Avatar, AVATAR_IDS, AVATARS } from './art/avatars';
import { EVOLUTION_PALETTE, TANIBOT_EVOLUTIONS, type EvolutionId } from './art/tanibot-evolutions';
import { Pixels } from './sprites';
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

const EVOLUTIONS: [EvolutionId, string][] = [
  ['seedling', 'Seedling (original)'],
  ['farmhand', 'Farmhand'],
  ['farmer', 'Farmer'],
  ['orchard_master', 'Orchard Master'],
  ['durian_king', 'Durian King'],
  ['legend', 'Legend'],
];

/** One row of all six TaniBots on a strip of the garden. `grid` sd = 58x64, hd = 116x128. */
function EvolutionRow({ label, grid, px }: { label: string; grid: 'sd' | 'hd'; px: number }) {
  return (
    <section class="evo-block">
      <h3>{label}</h3>
      <div class="evo-strip">
        {EVOLUTIONS.map(([id, name]) => (
          <div key={id} class="evo-cell">
            <Pixels rows={TANIBOT_EVOLUTIONS[id][grid]} palette={EVOLUTION_PALETTE} scale={px} title={name} />
            <small>{name}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function Gallery() {
  return (
    <main class="preview">
      <h2>TaniBot evolutions (draft for review)</h2>
      <p class="evo-note">
        Body only (drones, halo, aura and sparkles become code animations later). Same grid as the original, registered by the eyes. sd = 58x64 (like
        the original), hd = 116x128 (same size, twice the detail).
      </p>
      <EvolutionRow label="Phone, game size (sd, 1 px per pixel)" grid="sd" px={1} />
      <EvolutionRow label="Laptop 1280x800, game size: sd at 3 px" grid="sd" px={3} />
      <EvolutionRow label="Laptop 1280x800, game size: hd at 1.5 px" grid="hd" px={1.5} />
      <EvolutionRow label="Laptop 1920x1080, game size: sd at 4 px" grid="sd" px={4} />
      <EvolutionRow label="Laptop 1920x1080, game size: hd at 2 px" grid="hd" px={2} />
      <EvolutionRow label="Zoom x4 (hd at 4 px)" grid="hd" px={4} />
      <h2>Profile avatars</h2>
      <div class="preview-row">
        {AVATAR_IDS.map((id) => (
          <div key={id} class="preview-cell">
            <Avatar id={id} size={96} />
            <small>{AVATARS[id].name}</small>
          </div>
        ))}
      </div>
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
        <DartoFigure pose="hold" fruit="mango" scale={3} />
        <DartoFigure pose="hold" fruit="rambutan" scale={3} />
        <DartoFigure pose="hold" fruit="durian" scale={3} />
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
