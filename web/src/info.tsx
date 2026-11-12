// Small (i) buttons next to anything that can confuse a player. Tap / click = a short English
// explanation (1-2 sentences) in a centred popup with "Got it" (the same popup as the "?" help).
// Texts live in INFO (one place to edit).

import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useState } from "preact/hooks";
import { Modal } from "./help";

export const INFO = {
  addBudget:
    "TaniBot's own PANEN for buying fertilizer or seeds. It waters, harvests and sells without budget.",
  takeBack: "Moves TaniBot's unspent PANEN back to your own balance, on chain.",
  dailyLimit:
    "The PANEN contract lets TaniBot spend at most this much per day (resets 07:00 WIB). Even a faulty bot cannot spend more.",
  styles:
    "How TaniBot works for you. Thrifty never spends; Balanced and Turbo use fertilizer to grow faster, always within the daily limit.",
  autoPlant:
    "TaniBot plants Common or unknown seeds in empty plots (a new Tree NFT each). Rare, Gold and superior seeds stay yours to plant.",
  fertilizer:
    "Makes a tree grow 1.5x faster for 1 game day and raises the chance of Rare or Gold fruit on its next harvest.",
  nextHarvest:
    "The chance of each fruit quality on this tree's next harvest. Rare pays x2 and Gold x5 at Mr. Darto; fertilizer raises the odds.",
  season:
    "Harvest sales pay less as more PANEN exists (Season halving, never below 12.5%). Check-in and welcome gifts stay the same.",
  burned:
    "PANEN spent in the Shop is destroyed on chain forever, so the supply shrinks.",
  treeNft:
    "Each tree is an NFT in your NEAR account. Its growth, harvests and quality are updated on chain as it grows.",
  streak:
    "Check in every game day to grow your streak. Day 7 doubles the PANEN and adds a Gold seed; missing a day starts it over.",
  unknownSeed:
    "Shop and check-in seeds show their quality when planted: 80% Common, 17% Rare, 3% Gold.",
  dartoPrice:
    "Mr. Darto's price changes every game day and never drops below the seed price. The amount on Sell is what you receive.",
  demo: "Demo mode: 1 game day = 1 minute, so the whole loop fits in a few minutes. Testnet tokens have no real value.",
  weather: "The village weather is the same for everyone: rain waters every tree for free, a drought needs two waterings, and Mount Tandur sometimes erupts. Trees never die.",
  budget:
    "PANEN in TaniBot's own NEAR wallet. It can only spend it in the Shop, within the daily limit.",
  lockedPlot: "Plot 3 opens at 50 XP (Farmhand). You get XP from harvests.",
  seedStorage:
    "Seed storage holds 20 seeds. Sell seeds to Mr. Darto or discard them to make room.",
} as const;

export type InfoKey = keyof typeof INFO;

/**
 * The "i" button (2026-11-12, Ardian's iPhone test: the old bubble next to the button came out small
 * and squeezed at the screen's edge in the seed row). A tap opens the same centred popup as the plot
 * panel's "?" help: wide (phones: the screen's width minus a margin), the whole text readable, a
 * "Got it" button; Esc or a tap outside closes it. Rendered on document.body, so a panel with a
 * transform or a scrolling box never moves or clips it. The tap never reaches what the button sits in
 * (a seed card, a shop row).
 */
export function Info({ k, label, text }: { k: InfoKey; label?: string; /** Overrides the fixed text (e.g. today's weather). */ text?: string }) {
  return (
    <InfoChip k={k} label={label} text={text} class="info-i">
      i
    </InfoChip>
  );
}

/**
 * Any button that opens the same centred info popup as the (i): phones tap the Day chip or the
 * weather chip itself (no separate (i) next to them, Ardian 2026-11-12).
 */
export function InfoChip({
  k,
  label,
  text,
  class: cls,
  title: hover,
  children,
}: {
  k: InfoKey;
  label?: string;
  /** Overrides the fixed text (e.g. today's weather). */
  text?: string;
  class: string;
  title?: string;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(true);
  };
  const title = label ? label.replace(/^the /i, "").replace(/^./, (c) => c.toUpperCase()) : "Info";
  return (
    <>
      <button type="button" class={`${cls}${open ? " open" : ""}`} onClick={toggle} aria-label={cls === "info-i" ? `What is ${label ?? "this"}?` : undefined} aria-expanded={open} title={hover}>
        {children}
      </button>
      {open &&
        createPortal(
          <div onClick={(e) => e.stopPropagation()}>
            <Modal title={title} onClose={() => setOpen(false)} closeLabel="Got it" class="help-popup info-popup">
              <p>{text ?? INFO[k]}</p>
            </Modal>
          </div>,
          document.body,
        )}
    </>
  );
}
