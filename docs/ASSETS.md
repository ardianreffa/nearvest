# Third-party assets

Every third-party asset used in NEARvest is listed here with its license and any attribution the author asks for.
Rule: check the license on the source page **before** adding an asset to the repo, then add or update its row here.
Licenses below were checked on 2026-11-05.

## Approved assets (all CC0 1.0)

CC0 = public domain dedication (https://creativecommons.org/publicdomain/zero/1.0/). No attribution is legally required, but we credit every author anyway and honor any credit requests.

| Asset | Author | Source | License | Attribution requested | Planned use |
|---|---|---|---|---|---|
| Tiny Farm (16x16, 130 files) | Kenney | https://kenney.nl/assets/tiny-farm | CC0 | No | Soil, plots, farm tiles |
| Pixel Platformer Farm Expansion (18x18, 110 files) | Kenney | https://kenney.nl/assets/pixel-platformer-farm-expansion | CC0 | No | Extra farm props |
| 32 Free Fruits and Veggies | Crumpaloo | https://crumpaloo.itch.io/32-free-fruits-and-veggies-asset-pack | CC0 | No (author asks for a rating on itch.io) | Fruit/item icons (no mango/durian/rambutan included; base for recolors) |
| 32x32 Fruit (12 sprites) | srmp1 | https://srmp1.itch.io/32x32-fruit | CC0 ("Free to use without credit") | No | Fruit/item icons |
| Tropical tree | Miguel Oliveira (MiguelOliveira3D) aka Pixquare | https://opengameart.org/content/tropical-tree | CC0 | **Yes: "Credits for Miguel Oliveira aka Pixquare. https://twitter.com/PixquareGames"** | Base for fruit tree sprites |
| Palms (palm.png, palm_2.png) | fryhet | https://opengameart.org/node/65742 | CC0 | No | Background palms |
| Robot Sprite - BrawlBot | wuhu | https://opengameart.org/content/robot-sprite-brawlbot | CC0 | Appreciated, not required | Base for TaniBot |
| Robot Lab Asset Pack | Murphy's Dad (MurphysDad) | https://murphysdad.itch.io/robot-lab-asset-pack | CC0 | Appreciated, not required ("Crediting to Murphy's Dad (https://murphysdad.itch.io/) is appreciated") | Drone sprite, robot parts |

## Credits (copy into README)

- Tropical tree by Miguel Oliveira aka Pixquare — https://twitter.com/PixquareGames (CC0)
- Tiny Farm and Pixel Platformer Farm Expansion by Kenney — https://kenney.nl (CC0)
- 32 Free Fruits and Veggies by Crumpaloo (CC0)
- 32x32 Fruit by srmp1 (CC0)
- Palms by fryhet (CC0)
- BrawlBot robot sprite by wuhu (CC0)
- Robot Lab Asset Pack by Murphy's Dad — https://murphysdad.itch.io/ (CC0)

## Files in the repo

| File | Source asset | License | Used for |
|---|---|---|---|
| `web/public/assets/cc0/palm-fryhet-1.png` | Palms (`palm.png`) by fryhet | CC0 | Garden background (not used since the AI backdrop, 2026-11-05) |
| `web/public/assets/cc0/palm-fryhet-2.png` | Palms (`palm_2.png`) by fryhet | CC0 | Garden background (not used since the AI backdrop, 2026-11-05) |

Downloaded 2026-11-05 from OpenGameArt. BrawlBot was checked but not used (painted style, not pixel art). The Tropical tree by Pixquare was used in the first UI version and removed on 2026-11-05 when species-specific trees were drawn (keep the credit only if it comes back).

## Audio (all CC0, checked 2026-11-05)

Converted to AAC (`.m4a`, `afconvert` on macOS) so they are small and play in every browser. Files are in `web/public/assets/audio/`.

| File | Source | Author | License | Source page |
|---|---|---|---|---|
| `music-apple-cider.m4a` (background loop) | "Apple Cider" (`apple_cider.mp3`) | Zane Little Music | CC0 | https://opengameart.org/content/apple-cider |
| `click.m4a` | Interface Sounds `click_001.ogg` | Kenney | CC0 (bundled License.txt; credit optional) | https://opengameart.org/content/interface-sounds |
| `plant.m4a` | Interface Sounds `select_003.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `water.m4a` | Interface Sounds `drop_002.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `harvest.m4a` | Interface Sounds `pluck_001.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `checkin.m4a` | Interface Sounds `confirmation_001.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `chain.m4a` | Interface Sounds `glass_002.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `error.m4a` | Interface Sounds `error_004.ogg` | Kenney | CC0 | https://opengameart.org/content/interface-sounds |
| `coins.m4a` (sell) | RPG Audio `handleCoins.ogg` | Kenney | CC0 (bundled license.txt) | https://opengameart.org/content/50-rpg-sound-effects |
| `burn.m4a` (shop) | Digital SFX `lowDown.mp3` | Kenney | CC0 (OpenGameArt page) | https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc |
| `levelup.m4a` | Digital SFX `powerUp2.mp3` | Kenney | CC0 (OpenGameArt page) | https://opengameart.org/content/63-digital-sound-effects-lasers-phasers-space-etc |

Credits (copy into README): music "Apple Cider" by Zane Little Music; sound effects by Kenney (www.kenney.nl).

## Fonts

| Font | Source | License |
|---|---|---|
| Tiny5 (text and numbers) | Google Fonts | SIL Open Font License 1.1 |
| Pixelify Sans (headings) | Google Fonts | SIL Open Font License 1.1 |

## Modified and AI-generated assets

No CC0 mango, rambutan, or durian tree sprites were found. These will be recolored/edited from the CC0 assets above or generated with AI. List each one here with its base asset (or the AI tool used).

| File | Based on / made with | Notes |
|---|---|---|
| `web/src/sprites.tsx` (icons: seed mound, sprout, fruits, coin, droplet, sparkle, lock, fertilizer, seed packet, bolt, fire, speaker) | Original pixel art drawn in code for NEARvest (by Claude Code, 2026-11-05) | Part of this repo (MIT) |
| `web/src/art/trees.tsx` (mango, rambutan, durian x seed/sprout/tree/fruiting/old, generated procedurally) | Original, generated in code | Part of this repo (MIT) |
| **TaniBot (official design)**: `web/src/art/tanibot-sprite.ts` (58x64 sprite, v1 and v2 palettes), `web/public/assets/tanibot/tanibot-v1.png`, `tanibot-v2.png`, `tanibot-v1-large.png`, `tanibot-v2-large.png` (8x, for login / profile card / README) | **Made with ChatGPT (AI image generator) at Ardian's request** (source: `docs/art-source/tanibot-ai.png`, 1254x1254, white background). Converted by Claude Code on 2026-11-05: white background removed (flood fill from the edges), downsampled to 58x64 by the dominant color per cell, palette snapped to the GDD colors (mint #00EC97, cyan #22D3EE, gold #F5C542, soil #6B4A2F) plus metal and straw tones. v2 = same sprite recolored (shinier chrome, brighter LEDs). | AI-generated, used in NEARvest by its creator |
| **TaniBot evolutions (one per title)**: `web/src/art/tanibot-evolutions.ts` (Farmhand, Farmer, Orchard Master, Durian King, Legend; each as `sd` 58x64 and `hd` 116x128; Seedling = the original) | **Made with ChatGPT (AI image generator) at Ardian's request**, based on the original TaniBot (sources: `docs/art-source/tanibot-farmhand.png`, `tanibot-farmer.png`, `tanibot-orchard-master.png`, `tanibot-durian-king.png`, `tanibot-legend.png`, 1254x1254, white background). Converted by Claude Code on 2026-11-07 with `tools/pixelize/evolve.py`: registered on the original's eyes so every version uses exactly the original grid; body only (drones, halo ring, cyan aura and sparkles removed; they become code animations); dominant color per cell, snapped to the same palette as the original. | AI-generated, used in NEARvest by its creator |
| `web/src/art/tanibot.tsx` (animation layers for the sprite above, drones, basket, plasma hoe) | Drones, basket and hoe: original pixel art drawn in code | Part of this repo (MIT) |
| **Mr. Darto (official design)**: `web/src/art/darto-sprite.ts` (3 poses: idle 32x71, waving 39x70, holding a durian 44x71; hover cart 69x62 with thruster and core layers) | **Made with ChatGPT (AI image generator) at Ardian's request** (source: `docs/art-source/darto-ai.png`, 1774x887, white background). Converted by Claude Code on 2026-11-05 with `tools/pixelize/sheet.py` (8 px cells, white background and enclosed white gaps removed, shared 40-color palette snapped to the GDD colors, yellow sparkle lines dropped) and `make-market-shop.py`. | AI-generated, used in NEARvest by its creator |
| `web/src/art/darto.tsx` (pose switching, sparkle animation, cart thrusters and core glow) | Sparkle lines: original pixel art drawn in code | Part of this repo (MIT). The earlier code-drawn Mr. Darto was replaced on 2026-11-05 (see git history). |
| **Village Shop stall with guard robot**: `web/src/art/shop-sprite.ts` (152x115 stall, robot and robot-eye layers) | **Made with ChatGPT (AI image generator) at Ardian's request** (source: `docs/art-source/shop-ai.png`, 1536x1024, white background). Converted by Claude Code on 2026-11-05 with `tools/pixelize/sheet.py` (8 px cells, 62-color palette snapped to the GDD colors) and `make-market-shop.py` (robot cut into its own layer with foliage filled in behind; the tomato, eggplant and carrot seed packets redrawn as rambutan, mango and durian in code). | AI-generated, used in NEARvest by its creator |
| `web/src/art/shop.tsx` (robot float and eye blink) | Code only | Part of this repo (MIT) |
| **Garden backdrop (village of Tandur, day and night)**: `web/public/assets/bg/bg-day.png`, `bg-night.png` (240x135 each) | **Made with ChatGPT (AI image generator) at Ardian's request** (sources: `docs/art-source/bg-day-ai.png`, `bg-night-ai.png`, 1672x941, same composition). Converted by Claude Code on 2026-11-05 with `tools/pixelize` (`--keep-bg --colors 64`): dominant color per 6.97 px cell, a 64-color median-cut palette with the closest colors snapped exactly to the GDD colors (leaf, soil, mint, cyan, gold). | AI-generated, used in NEARvest by its creator |
| **Dusk backdrop (not used yet)**: `docs/art-source/bg-dusk.png` (1774x887, source only) | **Made with ChatGPT (AI image generator) at Ardian's request** (2026-11-07), same village as the day / night backdrops at dusk. Not converted or used yet: planned for the Wednesday atmosphere package (weather + ambient sound, see docs/BACKLOG.md). | AI-generated, used in NEARvest by its creator |
| **Garden backdrop, HD for laptops**: `web/public/assets/bg/bg-day-hd.png`, `bg-night-hd.png` (480x270 each) | Same ChatGPT images (made at Ardian's request, `docs/art-source/bg-day-ai.png`, `bg-night-ai.png`), converted by Claude Code on 2026-11-05 with `tools/pixelize` (`--keep-bg --colors 96`, 3.49 px cells, closest colors snapped to the GDD colors). Used only by the laptop immersive mode. | AI-generated, used in NEARvest by its creator |
| `web/src/art/backdrop.tsx` (day/night cross-fade, dawn/dusk tint, passing drones, drone LEDs, lantern and hologram glow, waterfall shimmer, volcano smoke) | Animation overlays: original pixel art drawn in code | Part of this repo (MIT). The earlier code-drawn village backdrop was replaced on 2026-11-05 (see git history). |
| **Market and Shop backdrops (floating market on the canal, village square with the banyan tree)**: `web/public/assets/bg/bg-market.png`, `bg-shop.png` (240x120 each) | **Made with ChatGPT (AI image generator) at Ardian's request** (sources: `docs/art-source/bg-market-ai.png`, `bg-shop-ai.png`, 1774x887). Converted by Claude Code on 2026-11-05 with `tools/pixelize` (`--keep-bg --colors 64`, 7.39 px cells, closest colors snapped to the GDD colors). | AI-generated, used in NEARvest by its creator |
| `web/src/art/scenes.tsx` (canal ripples, bobbing boats, passing drone, lantern and sign glow, fountain shimmer, string lights) | Animation overlays: original, drawn in code | Part of this repo (MIT) |
| `web/src/share.tsx` (share cards drawn on a canvas from the sprites above) | Code only | Part of this repo (MIT) |
