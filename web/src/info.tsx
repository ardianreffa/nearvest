// Small (i) buttons next to anything that can confuse a player. Tap / click = a short English
// explanation in a bubble (1-2 sentences) that can be closed with its x, Esc or a tap anywhere
// else. One bubble at a time. The bubble is fixed to the screen and kept inside it, so it also
// works inside scrolling panels and dialogs on phones. Texts live in INFO (one place to edit).

import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

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

let closeOpen: (() => void) | null = null;

export function Info({ k, label, text }: { k: InfoKey; label?: string; /** Overrides the fixed text (e.g. today's weather). */ text?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);

  const close = () => setOpen(false);
  const toggle = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    if (open) return close();
    closeOpen?.();
    closeOpen = close;
    setOpen(true);
  };

  // Place the bubble next to the button, inside the screen (above when there is no room below).
  useLayoutEffect(() => {
    if (!open || !btn.current || !bubble.current) return;
    const b = btn.current.getBoundingClientRect();
    const w = bubble.current.offsetWidth;
    const h = bubble.current.offsetHeight;
    const left = Math.min(
      Math.max(8, b.left + b.width / 2 - w / 2),
      window.innerWidth - w - 8,
    );
    const below = b.bottom + 8 + h <= window.innerHeight - 8;
    setPos({
      left,
      top: below ? b.bottom + 8 : Math.max(8, b.top - 8 - h),
      below,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (!bubble.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onMove = () => close();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    document.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("scroll", onMove, true);
      if (closeOpen === close) closeOpen = null;
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        class={`info-i${open ? " open" : ""}`}
        onClick={toggle}
        aria-label={`What is ${label ?? "this"}?`}
        aria-expanded={open}
      >
        i
      </button>
      {open &&
        // On document.body: a HUD panel with a transform would otherwise move a fixed bubble.
        createPortal(
          <div
            ref={bubble}
            class={`info-bubble${pos?.below === false ? " above" : ""}`}
            role="tooltip"
            style={
              pos
                ? { left: `${pos.left}px`, top: `${pos.top}px` }
                : { visibility: "hidden", left: 0, top: 0 }
            }
          >
            <p>{text ?? INFO[k]}</p>
            <button
              type="button"
              class="info-bubble-x"
              onClick={close}
              aria-label="Close"
            >
              ×
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
