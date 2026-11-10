// The garden scene: backdrop, three plots, TaniBot standing next to the
// selected plot, and TaniBot's action animations.

import { loadToken, type GameState, type TreeView } from './api';
import { Backdrop, lockedFraction, phaseOf } from './art/backdrop';
import type { Place } from './art/hotspots';
import { playSound } from './audio';
import { BASKET, Drone, droneCount, HOE, TaniBot, TANIBOT_H, TANIBOT_W, tierOf, tierRank, type Tier } from './art/tanibot';
import { TreePixels, treeTopRow } from './art/trees';
import { leafBurst } from './fx';
import { Pixels, Sprite } from './sprites';
import { formatDuration } from './ui';
import { lookOf } from './weather';
import { dotsFor } from './dots';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export type ActionKind = 'plant' | 'water' | 'harvest' | 'fertilize' | 'chop';

export interface SceneFx {
  id: number;
  kind: ActionKind;
  plot: number;
  /** The tree before the action (used to dissolve a chopped tree). */
  tree: TreeView | null;
}

// Plots sit on the brown ground at the bottom of the backdrop, a little toward
// the middle so the houses on both sides stay visible (keep in sync with .plots).
// In the immersive layout the plots fill their own "stage" box instead.
interface Lane {
  left: number;
  width: number;
  botOffset: number;
}
const LANE_NORMAL: Lane = { left: 11, width: 78, botOffset: 14 };
const LANE_STAGE: Lane = { left: 0, width: 100, botOffset: 18 };
/** v2 laptop: TaniBot stands in the grass between two plots, clear of both mounds. */
const LANE_V2: Lane = { left: 0, width: 100, botOffset: 16 };
/** v2 phone: TaniBot stands on the grass in front of (below) the selected plot. */
const LANE_PHONE: Lane = { left: 0, width: 100, botOffset: 6 };
/**
 * v3 phone: TaniBot stands on the grass right beside the selected plot, in the gap between two
 * mounds (half a plot to the side), its feet on the mounds' baseline. The trees and their labels
 * are drawn in front of it, so it never hides them.
 */
const LANE_PHONE3: Lane = { left: 0, width: 100, botOffset: 50 / 3 };

/** Horizontal center of a plot in % of the scene (or stage) width. */
function plotCenter(plot: number, lane: Lane): number {
  return lane.left + (lane.width / 3) * (plot + 0.5);
}

/** TaniBot stands to the right of plots 1-2 and to the left of plot 3. */
function botX(plot: number, lane: Lane): number {
  return plot < 2 ? plotCenter(plot, lane) + lane.botOffset : plotCenter(plot, lane) - lane.botOffset;
}

// ---------- Immersive layout (laptop / PC): web/src/layout.ts ----------

export { ART_H, ART_W, immersiveLayout, laptopLayout, type Immersive } from './layout';
import type { Immersive, PhoneZoom } from './layout';
import { Mound, MOUND, MOUND_ART, MOUND_BASE, MoundArt } from './art/mound';

/** Dev builds only: ?time=day / dusk / night locks the village clock (screenshots and video). */
const TIME_LOCKED = import.meta.env.DEV && typeof location !== 'undefined' ? lockedFraction(location.search) : null;

function status(tree: TreeView, elapsed: number) {
  // Weather first: ash and wilting need the player now (missing on older servers = false).
  if (tree.ash) return { text: 'Ash!', cls: 'ash' };
  if (tree.ready) return { text: tree.stage === 'old' ? 'Seed ready' : 'Ready!', cls: 'ready' };
  if (tree.wilting) return { text: 'Wilting!', cls: 'thirsty wilting' };
  if ((tree.waterNeed ?? 1) > 1 && !tree.wateredToday) return { text: `Water ${tree.waterCount ?? 0}/${tree.waterNeed}`, cls: 'thirsty' };
  if (!tree.isWatered) return { text: 'Thirsty', cls: 'thirsty' };
  return { text: formatDuration(tree.msToReady - elapsed), cls: 'growing' };
}

/** A friend's tree (visits): only what a visitor needs (no countdowns of someone else's garden). */
function visitStatus(tree: TreeView) {
  if (tree.ash) return { text: 'Ash!', cls: 'ash' };
  if (tree.ready) return { text: tree.stage === 'old' ? 'Old tree' : 'Ready!', cls: 'ready' };
  if (!tree.isWatered) return { text: 'Thirsty', cls: tree.wilting ? 'thirsty wilting' : 'thirsty' };
  return { text: 'Watered', cls: 'growing' };
}

const FRUIT_SPRITE = { mango: 'mango', rambutan: 'rambutan', durian: 'durian' } as const;

interface Props {
  state: GameState;
  selected: number;
  onSelect: (plot: number) => void;
  elapsed: number;
  fx: SceneFx | null;
  big: boolean;
  /** Full-window garden with whole-pixel scale (laptop / PC). */
  immersive?: Immersive;
  onBot?: () => void;
  /** Hotspots in the village: open the Shop, the Market or the Village panel. */
  onPlace?: (p: Place) => void;
  /** Phones: the zoomed garden (the scene box is wider than the screen and pans sideways). */
  phone?: PhoneZoom;
  /** Visiting a friend's garden (friends.tsx): their trees; their TaniBot only as decoration. */
  visit?: boolean;
  /**
   * Visits: the owner's TaniBot (public ON / OFF only; its look follows the owner's title). It
   * floats or sleeps, never acts, and has no menu: a tap only says hello. Missing (older servers or
   * no TaniBot): none is shown.
   */
  visitBot?: { on: boolean; owner: string } | null;
}

export function GardenScene({ state, selected, onSelect, elapsed, fx, big, immersive: wideLayout, onBot, onPlace, phone, visit = false, visitBot = null }: Props) {
  const immersive = wideLayout ?? phone;
  const village = immersive?.village;
  const v2 = !!village && village.key !== 'v1';
  // Trees use the game pixel size: 2 on v1 phones, 3 on the wide layout, k in the immersive
  // layouts (laptop and v2 phones).
  const px = phone ? phone.spritePx : immersive ? immersive.k : big ? 3 : 2;
  // TaniBot: half the tree pixel on v1 laptops; smaller on v2 so it never covers the next
  // plot; laptops take it from the window only (`botScale`: the same with the drawer open or
  // closed, at home and on a visit); its 58 px size on phones (on the grass in front of the
  // selected plot).
  const botScale = phone
    ? village?.moundArt ? 1.25 : 1
    : immersive
      ? immersive.botScale ?? Math.max(1, Math.round(immersive.k / (v2 ? 3 : 2)))
      : big ? 2 : 1;
  const lane = phone && village?.moundArt ? LANE_PHONE3 : phone && v2 ? LANE_PHONE : v2 ? LANE_V2 : immersive ? LANE_STAGE : LANE_NORMAL;
  const moundArt = !!village?.moundArt;
  const mound = moundArt ? MOUND_ART : village?.key === 'v2-phone' ? MOUND.phone : village?.mounds ? MOUND.web : null;
  // Dev builds: ?time=day / dusk / night locks the village clock (screenshots and video).
  const fraction = TIME_LOCKED ?? 1 - Math.max(0, state.clock.msUntilNextDay - elapsed) / state.clock.dayLengthMs;
  const phase = phaseOf(fraction);
  const tier = tierOf(state.player.title);
  /** Drone size: about a third of TaniBot's width at every scale. */
  const droneScale = Math.max(1, botScale);
  const bx = botX(selected, lane);
  // A visited garden's TaniBot never works (the visitor's watering drone flies on its own).
  const working = fx !== null && !visit;
  const tb = visit ? null : state.player.tanibot;
  const on = visit ? !!visitBot?.on : !!tb && tb.enabled && tb.status === 'ready';
  /** Not active, switched off or failed: TaniBot sleeps and asks to be switched on. */
  const asleep = !on;
  // During the tutorial TaniBot's coach bubble does the talking (no "Turn me on" nudge).
  const askOn = !visit && !state.tutorial && (!tb || tb.status === 'failed' || (tb.status === 'ready' && !tb.enabled));
  const flash = useActionBubble(on, tb?.last ?? null);
  const nudge = useTurnOnNudge(askOn, state);
  const motion = useBotMotion(bx, on, working, selected);
  const bye = useGoodbye(on, tb?.status === 'ready');
  // Visits: the owner's look appears when their garden loads (that is not an evolution).
  const evolving = useEvolution(tier, !visit);
  const hello = useHello();
  const botSpot = useRef<HTMLDivElement>(null);
  useHintPlacement(botSpot, `${bye}|${nudge.key}|${flash?.id ?? ''}|${hello.id}|${bx}`);
  useSkyClearOfHud();

  return (
    <div
      class={`scene phase-${phase}${immersive ? ' immersive-scene' : ''}${phone ? ' phone-scene' : ''}${moundArt ? ' mound-art' : ''}`}
      role="group"
      aria-label={visit ? `${state.player.name}'s garden` : 'Your garden'}
      style={
        immersive
          ? {
              '--k': String(immersive.k),
              '--art-left': `${immersive.artLeft}px`,
              '--art-bottom': `${immersive.artBottom}px`,
              '--art-w': String(immersive.village.w),
              ...(mound ? { '--soil-h': `${mound.h * immersive.k}px` } : {}),
              ...(moundArt ? { '--mound-base': String(MOUND_BASE), '--mound-w': `${mound!.w * immersive.k}px` } : {}),
              ...(phone ? { '--sprite-px': `${phone.spritePx}px` } : {}),
              // v3 phones: the highest a tree label may sit above its plot (its top stays on the grass).
              ...(phone && moundArt && village?.grassRow !== undefined
                ? { '--label-max': `${Math.max(0, (village.bedRow - mound!.h * (1 - MOUND_BASE) + (2 * phone.spritePx) / phone.k - village.grassRow) * phone.k - 22)}px` }
                : {}),
              ...(phone ? { width: `${phone.sceneW}px`, height: `${phone.sceneH}px` } : {}),
            }
          : undefined
      }
    >
      <Backdrop
        fraction={fraction}
        blurFill={!!immersive && (!phone || phone.sceneW > phone.village.w * phone.k + 1)}
        hd={!!immersive}
        onPlace={onPlace}
        account={state.player.accountId}
        village={village}
        // The sky's top: the first game row shown (above the art when the scene is taller than it).
        skyTop={phone ? phone.village.h - (phone.sceneH - phone.artBottom - (phone.skyFrom ?? 0)) / phone.k : undefined}
        // Below the art (phones: under the plot sheet and tabs; laptops: under the plot panel):
        // the village's bottom bushes continue, so the panels sit on grass, not on a plain fill.
        groundBelow={phone ? phone.artBottom > 0 : !!immersive && immersive.artBottom > 0}
        groundWide={!!immersive && !phone}
        // Garden visits are live on servers that send `helps` (older servers: the Friends pin stays "Soon").
        friends={Array.isArray(state.helps)}
        friendsDot={!visit && dotsFor(state, null, false).friends}
        weather={lookOf(state.weather)}
        phone={!!phone}
      />

      <Stage immersive={immersive}>
      <div class="plots">
        {state.plots.map((p) => {
          const st = p.tree ? (visit ? visitStatus(p.tree) : status(p.tree, elapsed)) : null;
          return (
            <button
              key={p.plot}
              class={`plot${p.plot === selected ? ' selected' : ''}${p.locked ? ' locked' : ''}${fx?.kind === 'water' && fx.plot === p.plot ? ' watering' : ''}`}
              onClick={() => onSelect(p.plot)}
              aria-label={`Plot ${p.plot + 1}${p.tree ? `: ${p.tree.species}, ${p.tree.stage}` : p.locked ? ': locked' : p.memorial ? `: Memorial ${p.memorial.species} tree` : ': empty'}`}
            >
              <div
                class={`plot-art${p.tree?.isFertilized && p.tree.fertMsLeft - elapsed > 0 ? ' fertilized' : ''}${!p.tree && !p.locked && !p.memorial ? ' empty' : ''}${!p.tree && p.memorial ? ' memorial' : ''}${p.tree?.ash ? ' ashy' : ''}${p.tree?.wilting || p.tree?.wiltedRecently ? ' wilting' : ''}${p.tree?.volcanicSoil ? ' volcanic' : ''}`}
              >
                {p.locked ? (
                  <Sprite name="lock" scale={mound ? px : px * 2} title="Locked" />
                ) : p.tree ? (
                  <TreePixels species={p.tree.species} stage={p.tree.stage} quality={p.tree.quality} scale={px} seed={p.tree.tokenId ?? p.tree.id} />
                ) : p.memorial ? (
                  // A Memorial Tree keeps standing on its plot until the player plants a new seed here.
                  <span class="memorial-tree" title={`Memorial ${p.memorial.species}`}>
                    <TreePixels species={p.memorial.species} stage="old" quality={p.memorial.quality} scale={px} seed={p.memorial.tokenId ?? p.memorial.id} />
                  </span>
                ) : (
                  <span class="empty-hint">Plant</span>
                )}
                {p.tree?.isFertilized && p.tree.fertMsLeft - elapsed > 0 && (
                  <span class="fert-glow" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <i key={i} style={{ left: `${15 + i * 17}%`, animationDelay: `${i * 0.35}s` }} />
                    ))}
                  </span>
                )}
                {!p.tree && p.memorial && (
                  <span
                    class="badge memorial"
                    style={moundArt ? { '--tree-top': `${treeTopRow(p.memorial.species, 'old', p.memorial.tokenId ?? p.memorial.id) * px}px` } : undefined}
                  >
                    Memorial
                  </span>
                )}
                {st && (
                  <span
                    class={`badge ${st.cls}`}
                    // v3: the label sits just above the tree's real top (a sprout's label stays low).
                    style={moundArt && p.tree ? { '--tree-top': `${treeTopRow(p.tree.species, p.tree.stage, p.tree.tokenId ?? p.tree.id) * px}px` } : undefined}
                  >
                    {st.cls.startsWith('thirsty') && <Sprite name="droplet" scale={2} />}
                    {st.cls === 'ready' && <Sprite name="sparkle" scale={2} />}
                    {st.text}
                  </span>
                )}
              </div>
              <div class={`soil${mound ? ' mound' : ''}${moundArt ? ' art' : ''}${p.tree?.isWatered ? ' watered' : ''}`}>
                {moundArt ? <MoundArt /> : mound && <Mound size={mound} scale={px} kind={p.locked ? 'locked' : p.tree?.isWatered ? 'wet' : 'dry'} />}
                {fx?.kind === 'plant' && fx.plot === p.plot && <span class="soil-glow" key={fx.id} />}
              </div>
            </button>
          );
        })}
      </div>

      {motion.dust && (
        <span class={`bot-dust ${motion.dust.kind}`} style={{ left: `${motion.dust.x}%` }} key={motion.dust.id} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      {(!visit || visitBot) && (
      <div
        ref={botSpot}
        class={`bot-spot tier-${tier} ${motion.cls}${visit ? ' visit-bot' : ''}${evolving ? ' evolving' : ''}${phone && v2 && !village?.moundArt ? ' bot-front' : ''}${phone && village?.moundArt ? ' bot-beside' : ''}`}
        style={{
          left: `${bx}%`,
          '--bot-w': `${TANIBOT_W * botScale}px`,
          // Phones: on the grass in front of the plots (its head just under the mounds).
          ...(phone && v2 && !village?.moundArt ? { bottom: `${-(phone.village.h - phone.village.bedRow - 0.5) * phone.k}px` } : {}),
          // v3 phones: feet on the grass just in front of the mounds' baseline.
          ...(phone && village?.moundArt ? { bottom: `${-3 * phone.k}px` } : {}),
        }}
      >
        {on && (
          <span class="bot-jet" aria-hidden="true">
            <b />
            <b />
            <i />
            <i />
            <i />
          </span>
        )}
        {droneCount(tier) > 0 && (
          // Drones orbit TaniBot's shoulders; their shadows run along the ground. Asleep: parked and dim.
          <div class={`bot-drones${on ? '' : ' parked'}`} aria-hidden="true">
            {Array.from({ length: droneCount(tier) }, (_, i) => (
              <span key={i} class={`orbit o${i + 1}`}>
                <Drone scale={droneScale} shadow={Math.round(TANIBOT_H * botScale * 0.36)} />
              </span>
            ))}
          </div>
        )}
        {visit ? (
          hello.id > 0 && (
            <span class="bot-hint bot-hint-flash bot-hello" role="status" key={hello.id}>
              Hi! I'm {visitBot!.owner}'s TaniBot. Thanks for visiting!
            </span>
          )
        ) : bye ? (
          <button class="bot-hint bot-bye" onClick={onBot} key={bye}>
            Okay, going to sleep. Tap me when you need me!
          </button>
        ) : askOn ? (
          nudge.text && (
            <div class="bot-hint bot-nudge" role="status" key={nudge.key}>
              <button class="bot-nudge-text" onClick={onBot}>
                {nudge.text}
              </button>
              <button class="bot-nudge-later" onClick={nudge.notNow}>
                Not now
              </button>
            </div>
          )
        ) : (
          flash && (
            <button class="bot-hint bot-hint-flash" onClick={onBot} key={flash.id}>
              {flash.text}
            </button>
          )
        )}
        <button
          class={`bot-click${asleep ? ' asleep' : ''}`}
          onClick={visit ? hello.show : onBot}
          aria-label={visit ? `${visitBot!.owner}'s TaniBot (${on ? 'on' : 'asleep'}): say hello` : `TaniBot is ${on ? 'on' : 'off'}: open its log and settings`}
          title={visit ? `${visitBot!.owner}'s TaniBot` : 'TaniBot: log and settings'}
        >
          <TaniBot tier={tier} scale={botScale} working={working && on} effects={on} />
          {evolving > 0 && <span class="bot-evolve-scan" key={evolving} aria-hidden="true" />}
          {tier === 'legend' && on && <i class="bot-ripple" aria-hidden="true" />}
          {asleep && (
            <span class="bot-zzz" aria-hidden="true">
              <i>z</i>
              <i>z</i>
              <i>z</i>
            </span>
          )}
        </button>
        {!visit && (
          <span class={`bot-status ${on ? 'on' : 'off'}`} aria-hidden="true">
            <i />
            {on ? 'ON' : 'OFF'}
          </span>
        )}
        {fx?.kind === 'harvest' && !visit && (
          <div class="basket" key={fx.id}>
            <Pixels rows={BASKET} palette={{ H: '#9A7438', h: '#C9A35A' }} scale={px} />
          </div>
        )}
      </div>
      )}

      {fx && <ActionEffect fx={fx} from={botX(fx.plot, lane)} to={plotCenter(fx.plot, lane)} tier={tier} px={px} droneScale={droneScale} key={fx.id} />}
      </Stage>
    </div>
  );
}

/** In the immersive layout the plots, TaniBot and effects live in a box above the action bar. */
function Stage({ immersive, children }: { immersive?: Immersive; children: preact.ComponentChildren }) {
  if (!immersive) return <>{children}</>;
  return (
    <div class="stage" style={{ left: immersive.stageLeft, right: immersive.stageRight, bottom: immersive.stageBottom }}>
      {children}
    </div>
  );
}

/**
 * Watering (the player or TaniBot): a drone takes off next to TaniBot, flies to the chosen tree,
 * hovers just above its crown spraying water over it, then flies back. The tree's real top and
 * centre are read from the screen, so it works for a sprout and a big tree, on phones and laptops.
 * prefers-reduced-motion: the drone simply shows above the tree with a few still drops (CSS).
 */
function WaterDrone({ fx, from, to, droneScale }: { fx: SceneFx; from: number; to: number; droneScale: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ x: number; hover: number; fall: number; spread: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const area = el.getBoundingClientRect();
    const plot = el.closest('.stage, .scene')?.querySelectorAll('.plot')[fx.plot];
    const target = plot?.querySelector('.plot-art .tree') ?? plot?.querySelector('.plot-art');
    if (!area.width || !target) return;
    const t = target.getBoundingClientRect();
    // The crown's top: the first filled row of the tree picture (its canvas has empty rows on top).
    const svg = target.querySelector('svg');
    const top = svg ? svg.getBoundingClientRect().top + (svg.getBoundingClientRect().height * Number(target.getAttribute('data-top') ?? 0)) : t.top;
    const droneH = 11 * droneScale;
    setPlace({
      x: ((t.left + t.width / 2 - area.left) / area.width) * 100,
      hover: Math.max(droneH, area.bottom - top + 6),
      fall: Math.max(10, (area.bottom - top) * 0.6),
      spread: Math.max(8, Math.min(28, t.width * 0.3)),
    });
  }, [fx.id]);
  const x = place?.x ?? to;
  const vars = { '--from': `${from}%`, '--to': `${x}%`, '--hover': `${place?.hover ?? 60}px`, '--fall': `${place?.fall ?? 40}px` };
  return (
    <div class="act act-water" style={vars} ref={box}>
      <span class="fly-drone">
        <Drone scale={droneScale} />
      </span>
      {place &&
        Array.from({ length: 12 }, (_, i) => (
          <i
            key={i}
            class="drop"
            style={{ left: `calc(${x}% + ${Math.round(((i % 4) / 3 - 0.5) * 2 * place.spread)}px)`, animationDelay: `${520 + i * 75}ms` }}
          />
        ))}
    </div>
  );
}

function ActionEffect({ fx, from, to, tier, px, droneScale }: { fx: SceneFx; from: number; to: number; tier: Tier; px: number; droneScale: number }) {
  const vars = { '--from': `${from}%`, '--to': `${to}%` };
  const left = Math.min(from, to);
  const width = Math.abs(from - to);

  switch (fx.kind) {
    case 'water':
      return <WaterDrone fx={fx} from={from} to={to} droneScale={droneScale} />;
    case 'plant':
      return (
        <div class="act act-plant" style={vars}>
          <span class="hoe" style={{ left: `calc(${to}% - 6px)` }}>
            <Pixels rows={HOE} palette={{ c: '#00EC97', m: '#E0FFF4', k: '#5C5F66' }} scale={px + 1} />
          </span>
        </div>
      );
    case 'harvest':
      return (
        <div
          class="act act-harvest"
          style={vars}
          ref={(el) => {
            if (!el || el.dataset.done) return;
            el.dataset.done = '1';
            const r = el.parentElement!.getBoundingClientRect();
            leafBurst(r.left + (r.width * to) / 100, r.top + r.height * 0.45, 12);
          }}
        >
          <span class="laser" style={{ left: `${left}%`, width: `${width}%` }} />
          {tier === 'durian_king' &&
            [0, 1, 2, 3].map((i) => <i key={`c${i}`} class="king-coin" style={{ left: `calc(${to}% + ${i * 9 - 14}px)`, animationDelay: `${450 + i * 110}ms` }} />)}
          {fx.tree &&
            [0, 1, 2].map((i) => (
              <span key={i} class="jump-fruit" style={{ animationDelay: `${250 + i * 120}ms` }}>
                <Sprite name={FRUIT_SPRITE[fx.tree!.species]} scale={px} />
              </span>
            ))}
        </div>
      );
    case 'fertilize':
      return (
        <div class="act act-fertilize" style={vars}>
          <span class="spray" style={{ left: `${left}%`, width: `${width}%` }} />
          {Array.from({ length: 12 }, (_, i) => (
            <i
              key={i}
              class={`nano ${i % 2 ? 'gold' : 'mint'}`}
              style={{ left: `calc(${to}% + ${((i * 37) % 60) - 30}px)`, animationDelay: `${200 + i * 60}ms` }}
            />
          ))}
        </div>
      );
    case 'chop':
      return (
        <div class="act act-chop" style={vars}>
          {fx.tree && (
            <span class="ghost-tree" style={{ left: `${to}%` }}>
              <TreePixels species={fx.tree.species} stage={fx.tree.stage} quality={fx.tree.quality} scale={px} />
            </span>
          )}
          <span class="saw" style={{ left: `calc(${to}% - 34px)` }} />
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} class="mote" style={{ left: `calc(${to}% + ${((i * 29) % 64) - 32}px)`, animationDelay: `${500 + i * 45}ms` }} />
          ))}
        </div>
      );
  }
}

/**
 * While TaniBot is ON: a short bubble about its latest action ("Harvested 1
 * Durian!"), at most once a minute, gone after about 4 seconds. Actions that
 * already happened before the page was opened are not shown.
 */
function useActionBubble(on: boolean, last: { id: number; text: string; at: number } | null): { id: number; text: string } | null {
  const [bubble, setBubble] = useState<{ id: number; text: string } | null>(null);
  const seen = useRef<{ id: number | null; shownAt: number }>({ id: last?.id ?? null, shownAt: 0 });
  useEffect(() => {
    if (!on || !last || last.id === seen.current.id) return;
    seen.current.id = last.id;
    const now = Date.now();
    if (now - seen.current.shownAt < 60_000) return;
    seen.current.shownAt = now;
    setBubble({ id: last.id, text: last.text });
    const t = setTimeout(() => setBubble(null), 4000);
    return () => clearTimeout(t);
  }, [on, last?.id]);
  return on ? bubble : null;
}

/** How long the "turn me on" bubble stays, the idle time before it appears, and its minimum spacing. */
const NUDGE_SHOW_MS = 8_000;
const NUDGE_IDLE_MS = 20_000;
const NUDGE_GAP_MS = 3 * 60_000;

/** A short, stable id of the current login (a new login = a new session). */
function sessionId(): string {
  const t = loadToken() ?? '';
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function storage(kind: 'local' | 'session') {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

const SPECIES_LABEL: Record<string, string> = { mango: 'mango', rambutan: 'rambutan', durian: 'durian' };

/**
 * The friendly "turn me on" bubble while TaniBot is off, without nagging:
 * once per session after login, and when a tree is thirsty or ripe while the
 * player has been idle for ~20 s. At most every 3 minutes, gone after ~8 s.
 * "Not now" hides it until the next login (remembered per account).
 */
function useTurnOnNudge(askOn: boolean, state: GameState): { text: string | null; key: number; notNow: () => void } {
  const account = state.player.accountId;
  const offKey = `nearvest.botNudgeOff.${account}`;
  const greetKey = `nearvest.botNudgeGreeted.${account}`;
  const [shown, setShown] = useState<{ text: string; key: number } | null>(null);
  const lastShownAt = useRef(0);
  const lastActivity = useRef(Date.now());
  const plots = useRef(state.plots);
  plots.current = state.plots;

  const muted = () => storage('local')?.getItem(offKey) === sessionId();

  // Remember when the player last did something.
  useEffect(() => {
    const touch = () => (lastActivity.current = Date.now());
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, []);

  const show = (text: string) => {
    lastShownAt.current = Date.now();
    setShown({ text, key: Date.now() });
  };

  useEffect(() => {
    if (!askOn) {
      setShown(null);
      return;
    }
    const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const check = () => {
      if (muted()) return;
      const now = Date.now();
      if (now - lastShownAt.current < NUDGE_GAP_MS) return;
      // (a) Once per session after login.
      const session = storage('session');
      if (session && session.getItem(greetKey) !== sessionId()) {
        session.setItem(greetKey, sessionId());
        show(
          pick([
            'Zzz... Tap me to help!',
          ]),
        );
        return;
      }
      // (b) A tree needs care and the player has been idle for a while.
      if (now - lastActivity.current < NUDGE_IDLE_MS) return;
      const trees = plots.current.map((p) => p.tree).filter((t): t is TreeView => !!t);
      const ripe = trees.find((t) => t.ready);
      const thirsty = trees.find((t) => !t.wateredToday && !t.ready);
      if (ripe) show(pick(['Ripe fruit! Tap me to help!', `${SPECIES_LABEL[ripe.species]} is ripe! Tap me!`]));
      else if (thirsty) show(pick(['Thirsty trees! Tap me to help!', `${SPECIES_LABEL[thirsty.species]} is thirsty! Tap me!`]));
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [askOn, account]);

  // Gone by itself after ~8 seconds.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), NUDGE_SHOW_MS);
    return () => clearTimeout(t);
  }, [shown?.key]);

  const notNow = () => {
    storage('local')?.setItem(offKey, sessionId());
    setShown(null);
  };
  return { text: askOn && shown ? shown.text : null, key: shown?.key ?? 0, notNow };
}

/** Places that TaniBot's speech bubble must never cover: place pins, Mr. Darto, the HUD, plot labels. */
const HINT_AVOID = '.place-pin, .village-darto, .hud-capsule, .hud-chips, .hud-drawer, .hud-rail, .topbar, .badge, .coach-hud, .coach-float';

/**
 * Keeps TaniBot's speech bubble next to its head without covering a place pin or Mr. Darto:
 * centred above the head first, else shifted left or right (the tail still points at the head),
 * else a little higher. Sets --hint-dx / --hint-dy on the bubble (px; read by CSS).
 */
function useHintPlacement(spot: { current: HTMLDivElement | null }, key: string) {
  useLayoutEffect(() => {
    const place = () => {
      const hint = spot.current?.querySelector<HTMLElement>(':scope > .bot-hint');
      if (!hint) return;
      hint.style.setProperty('--hint-dx', '0px');
      hint.style.setProperty('--hint-dy', '0px');
      const base = hint.getBoundingClientRect();
      // The bubble's resting box (its pop-in / bob animation moves it by a few px only).
      const w = hint.offsetWidth;
      const h = hint.offsetHeight;
      const cx = base.left + base.width / 2;
      const top0 = base.bottom - h;
      const avoid = [...document.querySelectorAll(HINT_AVOID)]
        .filter((e) => !hint.contains(e))
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      const half = w / 2 - 14; // keep the tail inside the bubble
      const dxs = [0, -half * 0.6, half * 0.6, -half, half];
      const dys = [0, -12, -24];
      const fits = (l: number, t: number) =>
        l >= 4 && l + w <= window.innerWidth - 4 && t >= 0 &&
        !avoid.some((r) => l < r.right && r.left < l + w && t < r.bottom && r.top < t + h);
      for (const dy of dys)
        for (const dx of dxs) {
          if (fits(cx - w / 2 + dx, top0 + dy)) {
            hint.style.setProperty('--hint-dx', `${Math.round(dx)}px`);
            hint.style.setProperty('--hint-dy', `${Math.round(dy)}px`);
            return;
          }
        }
    };
    place();
    // Pins settle a moment after the scene appears; check once more then.
    const t = setTimeout(place, 1100);
    return () => clearTimeout(t);
  }, [key]);
}

/**
 * The sun and the moon are never hidden behind the HUD (profile box and status chips): when the
 * low morning sun or the moon would pass behind them, it dips just below them for that while
 * (smoothly, CSS `translate`), then follows its own path again.
 */
function useSkyClearOfHud() {
  useEffect(() => {
    const check = () => {
      const hud = [...document.querySelectorAll('.hud-left, .phone-hud > .hud-capsule-left, .phone-hud > .hud-chips, .phone-hud .hud-capsule-left')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0);
      for (const el of document.querySelectorAll<HTMLElement>('.scene .sky-sun, .scene .sky-moon')) {
        const shift = Number(el.dataset.hudShift ?? 0);
        const r = el.getBoundingClientRect();
        const top = r.top - shift; // where it would be without the dip
        const bottom = r.bottom - shift;
        let need = 0;
        for (const h of hud) {
          if (r.left < h.right && h.left < r.right && top < h.bottom + 4 && h.top < bottom) need = Math.max(need, h.bottom + 6 - top);
        }
        if (need !== shift) {
          el.dataset.hudShift = String(need);
          el.style.translate = need ? `0 ${Math.round(need)}px` : '';
        }
      }
    };
    check();
    const id = setInterval(check, 1000);
    window.addEventListener('resize', check);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', check);
    };
  }, []);
}

type IdleAct = 'glance' | 'blink' | 'leds' | 'wave' | 'look';

/**
 * TaniBot's body language in the garden (CSS classes on the bot spot):
 * - moving between plots: faces and leans toward the move, jets under the feet,
 *   dust when it lifts off, a puff and a small knee bend when it lands;
 * - idle: a calm "breathing" pose and, now and then, a random small action
 *   (glance, blink, hat lights, wave, look at the nearest tree);
 * - a happy bounce only right after it finished a job;
 * - switched off: none of this (it sleeps).
 */
function useBotMotion(x: number, on: boolean, working: boolean, plot: number) {
  const [move, setMove] = useState<{ dir: 'left' | 'right'; id: number } | null>(null);
  const [landing, setLanding] = useState(0);
  const [dust, setDust] = useState<{ x: number; id: number; kind: 'lift' | 'land' } | null>(null);
  const [idle, setIdle] = useState<IdleAct | null>(null);
  const [bounce, setBounce] = useState(0);
  const prevX = useRef(x);
  const wasWorking = useRef(working);

  // A move between plots.
  useEffect(() => {
    const from = prevX.current;
    prevX.current = x;
    if (from === x) return;
    const id = Date.now();
    const dir = x > from ? 'right' : 'left';
    setIdle(null);
    if (!on) return; // asleep: it just shifts, no jets, no dust
    setMove({ dir, id });
    setDust({ x: from, id, kind: 'lift' });
    const land = setTimeout(() => {
      setMove(null);
      setLanding(Date.now());
      setDust({ x, id: id + 1, kind: 'land' });
    }, 720);
    const clear = setTimeout(() => (setLanding(0), setDust(null)), 1300);
    return () => (clearTimeout(land), clearTimeout(clear));
  }, [x]);

  // A happy bounce right after a job.
  useEffect(() => {
    if (wasWorking.current && !working && on) {
      setBounce(Date.now());
      const t = setTimeout(() => setBounce(0), 700);
      wasWorking.current = working;
      return () => clearTimeout(t);
    }
    wasWorking.current = working;
  }, [working]);

  // Random idle moments every 5-10 seconds.
  useEffect(() => {
    if (!on) {
      setIdle(null);
      return;
    }
    let timer = 0;
    let off = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        const acts: IdleAct[] = ['glance', 'blink', 'leds', 'wave', 'look'];
        setIdle(acts[Math.floor(Math.random() * acts.length)]);
        off = window.setTimeout(() => setIdle(null), 1700);
        next();
      }, 5000 + Math.random() * 5000);
    };
    next();
    return () => (clearTimeout(timer), clearTimeout(off));
  }, [on]);

  // The nearest tree is on the bot's left for plots 1-2 and on its right for plot 3.
  const lookDir = plot < 2 ? 'left' : 'right';
  const cls = [
    move ? `moving dir-${move.dir}` : '',
    landing ? 'landing' : '',
    bounce ? 'bounce' : '',
    !move && !working && idle ? `idle-${idle === 'look' ? `look-${lookDir}` : idle}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { cls, dust };
}

/** Visits: a tap on the friend's TaniBot shows a short hello bubble (~4 s; a new tap restarts it). */
function useHello(): { id: number; show: () => void } {
  const [id, setId] = useState(0);
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => setId(0), 4000);
    return () => clearTimeout(t);
  }, [id]);
  return { id, show: () => (playSound('click'), setId(Date.now())) };
}

/** One goodbye bubble (~5 s) when the player switches TaniBot from ON to OFF. */
function useGoodbye(on: boolean, ready: boolean): number {
  const [bye, setBye] = useState(0);
  const was = useRef(on);
  useEffect(() => {
    const switchedOff = was.current && !on && ready;
    was.current = on;
    if (!switchedOff) return;
    const id = Date.now();
    setBye(id);
    const t = setTimeout(() => setBye(0), 5000);
    return () => clearTimeout(t);
  }, [on]);
  return bye;
}

/**
 * The evolution moment when a new title brings a new TaniBot: a flashing white
 * silhouette, a scan line from the feet up, then the new look (the app plays
 * the fanfare and offers the "TaniBot evolved" card).
 */
function useEvolution(tier: Tier, enabled = true): number {
  const [at, setAt] = useState(0);
  const prev = useRef(tier);
  useEffect(() => {
    const up = tierRank(tier) > tierRank(prev.current);
    prev.current = tier;
    if (!up || !enabled) return;
    const id = Date.now();
    setAt(id);
    const t = setTimeout(() => setAt(0), 2600);
    return () => clearTimeout(t);
  }, [tier]);
  return at;
}
