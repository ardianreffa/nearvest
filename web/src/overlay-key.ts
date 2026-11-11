// Keys of the elements that sit side by side in the game's <main>: the chain flash (a counter
// 1, 2, 3...), the v1 duel screen (duel id) and the v2 match screen (match id). Plain numbers
// collided (Preact: "two or more children with the same key attribute: 1" when the first chain
// flash and the first match were both 1), so every kind gets its own prefix.
export type OverlayKind = 'flash' | 'duel' | 'match';

export const overlayKey = (kind: OverlayKind, id: number) => `${kind}-${id}`;
