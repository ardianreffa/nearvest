// Share to X: achievement cards drawn on a canvas (pixel art + text) and a
// button that opens X with a ready-to-post text. X intents cannot attach an
// image, so the card can be saved (or shared with the phone's share sheet,
// where supported) and attached to the post.

import { useEffect, useState } from 'preact/hooks';
import type { GameState, Quality, Species } from './api';
import { DARTO_IDLE, DARTO_PALETTE } from './art/darto-sprite';
import { botSprite, TIER_TITLE, tierOf } from './art/tanibot';
import { treePalette, treeRows } from './art/trees';
import { BASE_PALETTE, SPRITES } from './sprites';
import { withArticle } from './text';
import { formatPanen, QUALITY_NAME, SPECIES_NAME } from './ui';

export type MomentKind = 'first_harvest' | 'first_gold' | 'evolved' | 'streak7' | 'title' | 'legend' | 'profile';

export interface Moment {
  kind: MomentKind;
  species?: Species;
  quality?: Quality;
  title?: string;
}

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

function seenKey(accountId: string) {
  return `nearvest.moments.${accountId}`;
}

/** Opens the share dialog for a moment the first time it happens to this player. */
export function shareMomentOnce(accountId: string, m: Moment, delayMs = 1600): void {
  // Title and evolution cards come once per title; the others once ever.
  const id = m.kind === 'title' || m.kind === 'evolved' ? `${m.kind}:${m.title}` : m.kind;
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
  window.setTimeout(() => openShare(m), delayMs);
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

export async function drawCard(m: Moment, s: GameState): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  await document.fonts?.ready;

  // Background: the village, darkened on the right for the text.
  try {
    const bg = await loadImage('/assets/bg/bg-day.png');
    const scale = Math.max(CARD_W / bg.width, CARD_H / bg.height);
    ctx.drawImage(bg, (CARD_W - bg.width * scale) / 2, CARD_H - bg.height * scale, bg.width * scale, bg.height * scale);
  } catch {
    ctx.fillStyle = '#7fd3f2';
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  const shade = ctx.createLinearGradient(0, 0, CARD_W, 0);
  shade.addColorStop(0, 'rgba(6, 20, 14, 0.15)');
  shade.addColorStop(0.45, 'rgba(6, 20, 14, 0.75)');
  shade.addColorStop(1, 'rgba(6, 20, 14, 0.9)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Frame in NEAR mint.
  ctx.fillStyle = '#00EC97';
  ctx.fillRect(0, 0, CARD_W, 8);
  ctx.fillRect(0, CARD_H - 8, CARD_W, 8);
  ctx.fillRect(0, 0, 8, CARD_H);
  ctx.fillRect(CARD_W - 8, 0, 8, CARD_H);

  // Hero art on the left.
  // The TaniBot of the player's title, in the detailed (116x128) version drawn at half scale.
  const bot = botSprite(tierOf(s.player.title), true);
  const drawBot = (x: number, y: number, scale: number) => drawRows(ctx, bot.rows, bot.palette, x, y, scale / 2);
  if (m.kind === 'first_gold' || m.kind === 'first_harvest') {
    const species = m.species ?? 'mango';
    drawRows(ctx, treeRows(species, 'fruiting'), treePalette(species, 'fruiting'), 40, 150, 10);
    if (m.kind === 'first_gold') {
      ctx.fillStyle = 'rgba(245, 197, 66, 0.35)';
      for (const [x, y] of [[70, 170], [330, 200], [200, 140], [300, 420]]) ctx.fillRect(x, y, 14, 14);
    }
    drawBot(300, 330, 4);
  } else if (m.kind === 'profile') {
    drawBot(50, 150, 6);
  } else {
    drawBot(70, 130, 7);
  }
  if (m.kind === 'streak7') drawRows(ctx, SPRITES.seedPacket, BASE_PALETTE, 380, 420, 12);
  if (m.kind === 'profile') drawRows(ctx, DARTO_IDLE.slice(0, 30), DARTO_PALETTE, 380, 380, 5);

  // Text on the right.
  const { headline, sub } = texts(m, s);
  const left = 560;
  const width = CARD_W - left - 60;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#00EC97';
  ctx.font = '44px "Pixelify Sans", sans-serif';
  ctx.fillText('NEARvest', left, 70);
  ctx.fillStyle = '#F5C542';
  ctx.font = '62px Tiny5, monospace';
  let y = 150;
  for (const line of wrap(ctx, headline, width)) {
    ctx.fillText(line, left, y);
    y += 70;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '34px Tiny5, monospace';
  y += 14;
  for (const line of wrap(ctx, sub, width)) {
    ctx.fillText(line, left, y);
    y += 42;
  }
  ctx.fillStyle = '#A7F3D0';
  ctx.font = '28px Tiny5, monospace';
  ctx.fillText(`${s.player.accountId}`, left, CARD_H - 140);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('Grow. Harvest. Own.  ·  on NEAR', left, CARD_H - 96);
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
    const on = (m: Moment) => setQueue((q) => [...q, m]);
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
