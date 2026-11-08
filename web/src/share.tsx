// Share to X: achievement cards drawn on a canvas (pixel art + text) and a
// button that opens X with a ready-to-post text. X intents cannot attach an
// image, so the card can be saved (or shared with the phone's share sheet,
// where supported) and attached to the post.

import { useEffect, useState } from 'preact/hooks';
import type { GameState, Quality, Species } from './api';
import { DARTO_IDLE, DARTO_PALETTE } from './art/darto-sprite';
import { botSprite, TIER_TITLE, tierOf, type Tier } from './art/tanibot';
import { treePalette, treeRows } from './art/trees';
import { withArticle } from './text';
import { formatPanen, QUALITY_NAME, SPECIES_NAME } from './ui';

import { enqueueMoment, momentId, orderMoments, type Moment, type MomentKind } from './moments';

export type { Moment, MomentKind };

export const MOMENT_LABELS: Record<MomentKind, string> = {
  first_harvest: 'First harvest',
  first_gold: 'First Gold tree',
  evolved: 'TaniBot evolved',
  streak7: '7-day streak',
  title: 'New title',
  legend: 'Legend',
  profile: 'Profile card',
};

const TAGS = '@NEARProtocol #NEARHackathon';


// ---------- Opening the share dialog ----------

const listeners = new Set<(m: Moment) => void>();

export function openShare(m: Moment): void {
  for (const l of listeners) l(m);
}

/** True while new cards wait (Judge tour or tutorial running). */
let holding = false;
/** The account whose cards are held (the waiting cards are kept in localStorage per account). */
let heldAccount: string | null = null;

function heldKey(accountId: string) {
  return `nearvest.momentsHeld.${accountId}`;
}

function readHeld(accountId: string): Moment[] {
  try {
    return JSON.parse(localStorage.getItem(heldKey(accountId)) ?? '[]') as Moment[];
  } catch {
    return [];
  }
}

function writeHeld(accountId: string, list: Moment[]) {
  try {
    if (list.length) localStorage.setItem(heldKey(accountId), JSON.stringify(list));
    else localStorage.removeItem(heldKey(accountId));
  } catch {
    // Storage blocked: the cards wait in memory for this visit only.
  }
}

/** In memory too, for browsers that block storage. */
let heldMemory: Moment[] = [];

/**
 * Holds new share cards (e.g. until a judge finishes the Judge tour or a new player the tutorial).
 * The waiting cards are saved per account, so a page reload does not lose them. Releasing opens
 * them one after another in showing order (moments.ts: the first harvest before a new title).
 */
export function holdShareCards(hold: boolean, accountId?: string): void {
  if (accountId) heldAccount = accountId;
  if (hold) {
    holding = true;
    return;
  }
  const wasHolding = holding;
  holding = false;
  const stored = heldAccount ? readHeld(heldAccount) : [];
  if (!wasHolding && !stored.length) return;
  const waiting = orderMoments([...stored, ...heldMemory]);
  heldMemory = [];
  if (heldAccount) writeHeld(heldAccount, []);
  if (waiting.length) window.setTimeout(() => waiting.forEach(openShare), 1200);
}

function seenKey(accountId: string) {
  return `nearvest.moments.${accountId}`;
}

function hold(accountId: string, m: Moment) {
  heldAccount = accountId;
  const list = orderMoments([...readHeld(accountId), m]);
  writeHeld(accountId, list);
  heldMemory = orderMoments([...heldMemory, m]);
}

/** Opens the share dialog for a moment the first time it happens to this player. */
export function shareMomentOnce(accountId: string, m: Moment, delayMs = 1600): void {
  // Title and evolution cards come once per title; the others once ever.
  const id = momentId(m);
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(seenKey(accountId)) ?? '[]') as string[];
  } catch {
    seen = [];
  }
  if (seen.includes(id)) return;
  try {
    localStorage.setItem(seenKey(accountId), JSON.stringify([...seen, id]));
  } catch {
    // Storage blocked: the moment may be offered again next visit.
  }
  if (holding) {
    hold(accountId, m);
    return;
  }
  window.setTimeout(() => (holding ? hold(accountId, m) : openShare(m)), delayMs);
}

// ---------- Texts ----------

function texts(m: Moment, s: GameState): { headline: string; sub: string; post: string } {
  const fruit = m.species ? SPECIES_NAME[m.species] : 'fruit';
  const p = s.player;
  switch (m.kind) {
    case 'first_harvest':
      return {
        headline: 'First harvest!',
        sub: `${p.name} picked ${withArticle(`${m.quality && m.quality !== 'common' ? QUALITY_NAME[m.quality] + ' ' : ''}${fruit}`)}`,
        post: `I just harvested my first ${fruit} in NEARvest, a pixel farming game where every tree is a living NFT. ${TAGS}`,
      };
    case 'first_gold':
      return {
        headline: 'My first Gold tree!',
        sub: `A Gold ${fruit} tree grows in ${p.name}'s garden`,
        post: `I grew my first Gold ${fruit} tree in NEARvest. It is a living Tree NFT that changes as it grows. ${TAGS}`,
      };
    case 'evolved':
      return {
        headline: 'TaniBot evolved!',
        sub: `${p.name} is now ${withArticle(p.title)}, and TaniBot evolved into its ${TIER_TITLE[tierOf(p.title)]} look`,
        post: `My AI farmer TaniBot just evolved into its ${TIER_TITLE[tierOf(p.title)]} look in NEARvest. ${TAGS}`,
      };
    case 'streak7':
      return {
        headline: '7-day streak!',
        sub: `${p.name} checked in 7 days in a row and got a Gold seed`,
        post: `7 days in a row on my NEARvest farm, and a Gold seed as the reward. ${TAGS}`,
      };
    case 'legend':
      return {
        headline: 'Legend!',
        sub: `${p.name} reached the highest title in Tandur`,
        post: `I became a Legend farmer in NEARvest. ${TAGS}`,
      };
    case 'title':
      return {
        headline: `New title: ${m.title ?? p.title}`,
        sub: `${p.name} has ${p.xp} XP from harvests`,
        post: `I am now ${withArticle(m.title ?? p.title)} in NEARvest, a pixel farming game on NEAR. ${TAGS}`,
      };
    case 'profile': {
      const trees = s.plots.filter((x) => x.tree).length;
      return {
        headline: `${p.name}`,
        sub: `${p.title} · ${p.xp} XP · ${formatPanen(p.balance)} PANEN · ${trees} tree${trees === 1 ? '' : 's'}`,
        post: `Meet my farm in NEARvest: ${p.title}, ${p.xp} XP and ${trees} living Tree NFT${trees === 1 ? '' : 's'}. Come grow with me. ${TAGS}`,
      };
    }
  }
}

export function postUrl(text: string, url: string | null): string {
  const q = new URLSearchParams({ text });
  if (url) q.set('url', url);
  return `https://x.com/intent/tweet?${q.toString()}`;
}

// ---------- Card drawing ----------

const CARD_W = 1200;
const CARD_H = 630;

function drawRows(ctx: CanvasRenderingContext2D, rows: string[], palette: Record<string, string>, x: number, y: number, scale: number) {
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const color = palette[rows[r][c]];
      if (rows[r][c] === '.' || !color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Wraps text to lines that fit `maxWidth`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** The still version of each tier's aura (as in the game), drawn behind TaniBot. */
function drawAura(ctx: CanvasRenderingContext2D, tier: Tier, x: number, y: number, r: number) {
  if (tier === 'durian_king') {
    // A golden durian: round glow with spikes of light.
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(255, 206, 84, 0.55)';
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.55);
      ctx.lineTo(0, -r * 1.08);
      ctx.lineTo(r * 0.12, -r * 0.55);
      ctx.fill();
    }
    ctx.restore();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.85);
    g.addColorStop(0, 'rgba(255, 236, 160, 0.95)');
    g.addColorStop(0.55, 'rgba(245, 197, 66, 0.6)');
    g.addColorStop(1, 'rgba(245, 197, 66, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  } else if (tier === 'legend') {
    // A white-cyan circle of light with a soft outer ring.
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.45, 'rgba(186, 250, 255, 0.8)');
    g.addColorStop(0.85, 'rgba(34, 211, 238, 0.35)');
    g.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 255, 255, 0.8)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Earlier titles: a soft mint glow so TaniBot stands out from the village.
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0, 236, 151, 0.35)');
    g.addColorStop(1, 'rgba(0, 236, 151, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Legend's halo above the hat. */
function drawHalo(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(34, 211, 238, 0.9)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#F0FFFF';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.26, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A 7-day calendar with every day ticked and day 7 in gold (streak card). */
function drawCalendar(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const cell = 46;
  const w = cell * 4 + 18;
  const h = cell * 2 + 70;
  ctx.fillStyle = '#FFFAF0';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#1B1B2F';
  ctx.fillRect(x, y, w, 6);
  ctx.fillRect(x, y + h - 6, w, 6);
  ctx.fillRect(x, y, 6, h);
  ctx.fillRect(x + w - 6, y, 6, h);
  ctx.fillStyle = '#E5484D';
  ctx.fillRect(x + 6, y + 6, w - 12, 34);
  for (let d = 0; d < 7; d++) {
    const cx = x + 9 + (d % 4) * cell;
    const cy = y + 52 + Math.floor(d / 4) * cell;
    ctx.fillStyle = d === 6 ? '#F5C542' : '#BBF7D0';
    ctx.fillRect(cx + 3, cy + 3, cell - 6, cell - 6);
    ctx.fillStyle = d === 6 ? '#7A4A00' : '#0B8F5F';
    // A pixel check mark.
    ctx.fillRect(cx + 12, cy + 22, 6, 6);
    ctx.fillRect(cx + 18, cy + 28, 6, 6);
    ctx.fillRect(cx + 24, cy + 22, 6, 6);
    ctx.fillRect(cx + 30, cy + 16, 6, 6);
  }
}

export async function drawCard(m: Moment, s: GameState): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // The card is drawn once: make sure both pixel fonts are loaded first.
  try {
    await Promise.all([document.fonts.load('44px "Pixelify Sans"'), document.fonts.load('32px Tiny5')]);
  } catch {
    // Fonts blocked: the browser's fallback font is used.
  }
  await document.fonts?.ready;

  // Layout: one margin on every side; TaniBot stands on the left-third line with its feet on the
  // village ground; the moment's object stands behind / beside it; text in the right column.
  const M = 56;
  const GROUND = 478; // top of the soil in the background below (row 104 of 135, drawn at 5x)

  // Background: the village, a little darker towards the text column.
  try {
    const bg = await loadImage('/assets/bg/bg-day.png');
    const scale = Math.max(CARD_W / bg.width, CARD_H / bg.height);
    ctx.drawImage(bg, (CARD_W - bg.width * scale) / 2, CARD_H - bg.height * scale, bg.width * scale, bg.height * scale);
  } catch {
    ctx.fillStyle = '#7fd3f2';
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  const shade = ctx.createLinearGradient(0, 0, CARD_W, 0);
  shade.addColorStop(0, 'rgba(6, 20, 14, 0.2)');
  shade.addColorStop(0.42, 'rgba(6, 20, 14, 0.45)');
  shade.addColorStop(0.55, 'rgba(6, 20, 14, 0.82)');
  shade.addColorStop(1, 'rgba(6, 20, 14, 0.9)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Frame in NEAR mint.
  ctx.fillStyle = '#00EC97';
  ctx.fillRect(0, 0, CARD_W, 8);
  ctx.fillRect(0, CARD_H - 8, CARD_W, 8);
  ctx.fillRect(0, 0, 8, CARD_H);
  ctx.fillRect(CARD_W - 8, 0, 8, CARD_H);

  // TaniBot of the player's title: the detailed 116x128 sprite at 3 px per pixel (348x384).
  const tier: Tier = m.kind === 'legend' ? 'legend' : m.kind === 'evolved' || m.kind === 'title' ? tierOf(m.title ?? s.player.title) : tierOf(s.player.title);
  const bot = botSprite(tier, true);
  const BOT_SCALE = 3;
  const botW = bot.rows[0].length * BOT_SCALE;
  const botH = bot.rows.length * BOT_SCALE;
  // Feet: the last row with pixels.
  const feetRow = bot.rows.length - 1 - [...bot.rows].reverse().findIndex((r) => /[^.]/.test(r));
  const botCx = CARD_W / 3;
  const botX = Math.round(botCx - botW / 2);
  const botY = GROUND + 6 - (feetRow + 1) * BOT_SCALE;
  const centre = { x: botCx, y: botY + botH * 0.56 };

  // The moment's object, behind / beside TaniBot (a bit smaller).
  if (m.kind === 'first_gold' || m.kind === 'first_harvest') {
    const species = m.species ?? 'mango';
    const T = 6; // 32x40 tree -> 192x240, beside TaniBot
    const tx = M - 4;
    const ty = GROUND + 4 - 37 * T;
    if (m.kind === 'first_gold') {
      const glow = ctx.createRadialGradient(tx + 16 * T, ty + 14 * T, 10, tx + 16 * T, ty + 14 * T, 170);
      glow.addColorStop(0, 'rgba(255, 220, 110, 0.75)');
      glow.addColorStop(1, 'rgba(255, 220, 110, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(tx - 60, ty - 60, 32 * T + 120, 40 * T + 60);
    }
    drawRows(ctx, treeRows(species, 'fruiting'), treePalette(species, 'fruiting'), tx, ty, T);
    if (m.kind === 'first_gold') {
      ctx.fillStyle = '#FFF3B0';
      for (const [x, y] of [[tx + 20, ty + 40], [tx + 190, ty + 20], [tx + 110, ty - 14], [tx + 210, ty + 150]]) {
        ctx.fillRect(x, y + 6, 18, 6);
        ctx.fillRect(x + 6, y, 6, 18);
      }
    }
  } else if (m.kind === 'streak7') {
    drawCalendar(ctx, M, GROUND - 250);
  } else if (m.kind === 'profile') {
    drawRows(ctx, DARTO_IDLE, DARTO_PALETTE, M - 10, GROUND + 6 - DARTO_IDLE.length * 4, 4);
  }

  // Tier aura behind TaniBot.
  drawAura(ctx, tier, centre.x, centre.y, botW * 0.62);
  // Shadow on the ground, then TaniBot.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.ellipse(botCx, GROUND + 4, botW * 0.36, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  drawRows(ctx, bot.rows, bot.palette, botX, botY, BOT_SCALE);
  if (tier === 'legend') drawHalo(ctx, botCx, botY + 4, botW * 0.27);
  if (m.kind === 'evolved' || m.kind === 'title' || m.kind === 'legend') {
    ctx.fillStyle = '#FFF3B0';
    for (const [x, y] of [[botX - 10, botY + 60], [botX + botW - 6, botY + 30], [botX + botW + 4, botY + 220], [botX - 24, botY + 250]]) {
      ctx.fillRect(x, y + 7, 21, 7);
      ctx.fillRect(x + 7, y, 7, 21);
    }
  }

  // Text in the right column, left-aligned, same margin as everywhere.
  const { headline, sub } = texts(m, s);
  const left = Math.round(CARD_W * 0.56);
  const width = CARD_W - left - M;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#00EC97';
  ctx.font = '44px "Pixelify Sans", sans-serif';
  ctx.fillText('NEARvest', left, M);
  ctx.fillStyle = '#F5C542';
  ctx.font = '58px Tiny5, monospace';
  let y = M + 76;
  for (const line of wrap(ctx, headline, width)) {
    ctx.fillText(line, left, y);
    y += 66;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '32px Tiny5, monospace';
  y += 12;
  for (const line of wrap(ctx, sub, width)) {
    ctx.fillText(line, left, y);
    y += 40;
  }
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#A7F3D0';
  ctx.font = '26px Tiny5, monospace';
  ctx.fillText(`${s.player.accountId}`, left, CARD_H - M - 40);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Grow. Harvest. Own.  ·  on NEAR', left, CARD_H - M);
  return canvas;
}

// ---------- Dialog ----------

export function ShareHost({ state }: { state: GameState }) {
  // Moments wait in a queue so two at once (first harvest + new title) both get shown.
  const [queue, setQueue] = useState<Moment[]>([]);
  const moment = queue[0] ?? null;
  const setMoment = (m: Moment | null) => setQueue((q) => (m ? [...q, m] : q.slice(1)));
  const [image, setImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    // Waiting cards keep their showing order (the first harvest before a new title).
    const on = (m: Moment) => setQueue((q) => enqueueMoment(q, m));
    listeners.add(on);
    return () => void listeners.delete(on);
  }, []);

  useEffect(() => {
    if (!moment) return;
    let alive = true;
    setImage(null);
    setFile(null);
    void drawCard(moment, state).then((canvas) => {
      if (!alive) return;
      setImage(canvas.toDataURL('image/png'));
      canvas.toBlob((blob) => alive && blob && setFile(new File([blob], `nearvest-${moment.kind}.png`, { type: 'image/png' })));
    });
    return () => {
      alive = false;
    };
    // Drawn once per moment, with the state at that time.
  }, [moment]);

  if (!moment) return null;
  const { post } = texts(moment, state);
  const link = /localhost|127\.0\.0\.1/.test(location.hostname) ? null : location.origin;
  const canShareFile = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  return (
    <div class="dialog-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && setMoment(null)}>
      <div class="dialog panel share-dialog" role="dialog" aria-modal="true" aria-label="Share to X">
        <header class="panel-head">
          <h2>Share: {MOMENT_LABELS[moment.kind]}</h2>
        </header>
        <div class="share-card">{image ? <img src={image} alt={`NEARvest card: ${MOMENT_LABELS[moment.kind]}`} /> : <p class="muted">Drawing your card...</p>}</div>
        <p class="share-text">{post}</p>
        <div class="dialog-actions share-actions">
          <button class="btn" onClick={() => setMoment(null)}>
            Close
          </button>
          {image && (
            <a class="btn" href={image} download={`nearvest-${moment.kind}.png`}>
              Save image
            </a>
          )}
          {canShareFile && (
            <button class="btn btn-cyan" onClick={() => void navigator.share({ files: [file!], text: post }).catch(() => undefined)}>
              Share image
            </button>
          )}
          <a class="btn btn-mint" href={postUrl(post, link)} target="_blank" rel="noreferrer">
            Post on X
          </a>
        </div>
        <p class="muted small">X opens with the text ready. Attach the saved card image to your post.</p>
      </div>
    </div>
  );
}
