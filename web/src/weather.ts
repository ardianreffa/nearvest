// The village weather in the web game (server: server/src/weather.ts). Never called a "season"
// (a Season is the PANEN halving). Everything here is safe with a server that sends no weather:
// then the garden simply looks clear.
//
// Dev builds only: ?weather=rain|drought|warning|eruption|volcanic locks the look (screenshots and
// the demo video), like ?time=. Production builds ignore it.

import type { GameState, TreeView, Weather } from './api';

export type WeatherLook = 'clear' | 'rain' | 'drought' | 'warning' | 'eruption' | 'volcanic';

const LOCK: WeatherLook | null = (() => {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('weather');
  return v === 'clear' || v === 'rain' || v === 'drought' || v === 'warning' || v === 'eruption' || v === 'volcanic' ? v : null;
})();

/** The weather of a state, with the dev lock applied to the weather and to the trees. */
export function withWeather(state: GameState): GameState {
  if (!LOCK) return state;
  const eruption = LOCK === 'warning' || LOCK === 'eruption' || LOCK === 'volcanic';
  const weather: Weather = {
    kind: LOCK === 'rain' || LOCK === 'drought' ? LOCK : 'clear',
    tomorrow: 'clear',
    waterNeed: LOCK === 'rain' ? 0 : LOCK === 'drought' ? 2 : 1,
    wiltDays: state.weather?.wiltDays ?? 2,
    eruption: eruption
      ? { phase: LOCK, msSinceWarning: 0, msToEruption: LOCK === 'warning' ? 20_000 : 0, msToEnd: 30_000, msToVolcanicEnd: 60_000, msLeft: 30_000, id: 'dev' }
      : null,
  };
  const tree = (t: TreeView | null): TreeView | null =>
    t && {
      ...t,
      ash: LOCK === 'eruption' && t.stage !== 'old',
      volcanicSoil: LOCK === 'volcanic' && t.stage !== 'old',
      wateredToday: LOCK === 'rain' ? true : LOCK === 'drought' ? false : t.wateredToday,
      waterCount: LOCK === 'drought' ? 1 : t.waterCount,
      waterNeed: weather.waterNeed,
      isWatered: LOCK === 'rain' ? true : t.isWatered,
    };
  return { ...state, weather, plots: state.plots.map((p) => ({ ...p, tree: tree(p.tree) })) };
}

/** What the garden shows: one look (an eruption phase wins over rain or drought). */
export function lookOf(w: Weather | undefined): WeatherLook {
  if (!w) return 'clear';
  if (w.eruption) return w.eruption.phase;
  return w.kind;
}

/** Short words for the HUD chip. */
export const LOOK_LABEL: Record<WeatherLook, string> = {
  clear: 'Clear',
  rain: 'Rain',
  drought: 'Drought',
  warning: 'Rumbling!',
  eruption: 'Eruption!',
  volcanic: 'Volcanic soil',
};

/** Weather chip icons (existing sprites only; the village HUD and the fishing pond). */
export const WEATHER_ICON: Record<WeatherLook, 'sparkle' | 'droplet' | 'fire' | 'sprout'> = {
  clear: 'sparkle',
  rain: 'droplet',
  drought: 'fire',
  warning: 'fire',
  eruption: 'fire',
  volcanic: 'sprout',
};

/** One line for the chip's info bubble. */
export function lookText(w: Weather | undefined): string {
  const look = lookOf(w);
  const tomorrow = w && w.tomorrow !== 'clear' ? ` Tomorrow: ${w.tomorrow}.` : '';
  switch (look) {
    case 'rain':
      return `Rain: every tree is watered for free today.${tomorrow}`;
    case 'drought':
      return `Drought: a watering only lasts half a day, so water each tree twice today.${tomorrow}`;
    case 'warning':
      return 'Mount Tandur is rumbling! Ash will fall soon. Trees never die, and cleaning the ash is free.';
    case 'eruption':
      return 'Eruption! Ash stops your trees from growing. Tap a tree and Clean ash (free) to get Volcanic soil.';
    case 'volcanic':
      return 'Volcanic soil: trees you cleaned grow faster and have a better Gold chance for a while.';
    default:
      return `Clear skies: water each tree once a day. Without water for ${w?.wiltDays ?? 2} days a tree goes back one stage (it never dies).${tomorrow}`;
  }
}
