// Dev-only art gallery (http://localhost:5173/preview.html). Not part of the production build.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { drawCard, type Moment } from './share';
import type { GameState } from './api';
import { Backdrop } from './art/backdrop';
import { Avatar, AVATAR_IDS, AVATARS } from './art/avatars';
import { EVOLUTION_PALETTE, TANIBOT_EVOLUTIONS, type EvolutionId } from './art/tanibot-evolutions';
import { Pixels } from './sprites';
import { DartoFigure, HoverCart } from './art/darto';
import { ShopStall } from './art/shop';
import { botSprite, Drone, TaniBot, TIER_TITLE, TIERS } from './art/tanibot';
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

/**
 * Hole check: every TaniBot on loud backgrounds (magenta, black), zoomed x4. Any hole in the body
 * shows up as a magenta or black spot. Phone = the sd sprite; laptop = the live, layered TaniBot
 * (hd, all layers composed, no effects).
 */
function HoleCheck() {
  return (
    <>
      <h2>TaniBot hole check (zoom x4, magenta and black)</h2>
      {(['#FF00FF', '#000000'] as const).map((bg) => (
        <div key={bg}>
          <div class="evo-strip hole-check" style={{ background: bg }}>
            {TIERS.map((t) => {
              const { rows, palette } = botSprite(t, false);
              return (
                <div key={t} class="evo-cell">
                  <Pixels rows={rows} palette={palette} scale={4} title={`${TIER_TITLE[t]} sd`} />
                  <small>{TIER_TITLE[t]} sd</small>
                </div>
              );
            })}
          </div>
          <div class="evo-strip hole-check" style={{ background: bg }}>
            {TIERS.map((t) => (
              <div key={t} class="evo-cell">
                <TaniBot tier={t} scale={4} effects={false} />
                <small>{TIER_TITLE[t]} hd, live</small>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Every share card, drawn with a sample player (title from the URL: ?title=Farmer, default Legend). */
function ShareCards() {
  const title = new URLSearchParams(location.search).get('title') ?? 'Legend';
  const state = {
    player: { name: 'sari', title, xp: 4100, balance: 186, accountId: 'sari.nearvest.testnet' },
    plots: [{ tree: {} }, { tree: {} }, { tree: null }],
  } as unknown as GameState;
  const moments: Moment[] = [
    { kind: 'first_harvest', species: 'mango', quality: 'common' },
    { kind: 'first_gold', species: 'durian', quality: 'gold' },
    { kind: 'evolved', title },
    { kind: 'streak7' },
    { kind: 'title', title },
    { kind: 'legend' },
    { kind: 'profile' },
  ];
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    void Promise.all(moments.map((m) => drawCard(m, state).then((c) => c.toDataURL('image/png')))).then(setUrls);
  }, []);
  return (
    <>
      <h2>Share cards ({title})</h2>
      <div class="preview-row share-cards" style={{ flexWrap: 'wrap', gap: '12px' }}>
        {urls.map((u, i) => (
          <img key={i} src={u} width={600} height={315} alt={moments[i].kind} />
        ))}
      </div>
    </>
  );
}

function Gallery() {
  return (
    <main class="preview">
      <ShareCards />
      <h2 id="tree-stages">Every tree state (seed, sprout, tree, fruiting, old) x quality, per species</h2>
      {SPECIES.map((sp) => (
        <div class="preview-row tree-stages" key={`st-${sp}`} style={{ background: '#cfe9f5', padding: '8px', alignItems: 'flex-end', gap: '10px' }}>
          {(['seed', 'sprout', 'tree', 'fruiting', 'old'] as const).flatMap((st) =>
            (['common', 'rare', 'gold'] as const).map((q) => <TreePixels key={`${st}-${q}`} species={sp} stage={st} quality={q} scale={3} seed={`${sp}-${st}`} />),
          )}
        </div>
      ))}
      <h2>Tree looks (6 seeds per species, fruiting and young tree)</h2>
      {SPECIES.map((sp) => (
        <div class="preview-row tree-looks" key={sp} style={{ background: '#cfe9f5', padding: '8px', alignItems: 'flex-end', gap: '10px' }}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <TreePixels key={n} species={sp} stage="fruiting" quality="common" scale={4} seed={String(n * 7 + 3)} />
          ))}
          <TreePixels species={sp} stage="tree" quality="common" scale={4} seed="11" />
          <TreePixels species={sp} stage="old" quality="common" scale={4} seed="12" />
        </div>
      ))}
      <h2>TaniBot avatars: capsule (32, 48), Profile (96), locked (48)</h2>
      <div class="preview-row" style={{ background: '#2a1d10', padding: '8px', gap: '12px', alignItems: 'center' }}>
        {AVATAR_IDS.filter((id) => id.startsWith('bot_')).map((id) => (
          <div key={id} class="preview-cell" style={{ flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
            <Avatar id={id} size={32} />
            <Avatar id={id} size={48} />
            <Avatar id={id} size={96} />
            <Avatar id={id} size={48} locked />
          </div>
        ))}
      </div>
      <HoleCheck />
      <h2>Drones</h2>
      <div class="preview-row drone-row">
        <Drone scale={2} />
        <Drone scale={4} shadow={30} />
      </div>
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
      <h2>TaniBot tiers, live (laptop size, with effects)</h2>
      <div class="evo-strip evo-live">
        {TIERS.map((t) => (
          <div key={t} class="evo-cell">
            <TaniBot tier={t} scale={3} />
            <small>{TIER_TITLE[t]}</small>
          </div>
        ))}
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
