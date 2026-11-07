/**
 * Demo recording mode (a dev aid for filming the demo video): `?record=1` in the game URL hides
 * the share card on title / evolution moments; the evolution animation, fanfare, confetti and
 * "New title" text still play, and the moment is not marked as seen (normal play still offers
 * the card later). Off without the parameter, also in the production build.
 */
export function isRecordMode(search: string): boolean {
  return new URLSearchParams(search).get('record') === '1';
}

export const RECORD_MODE = typeof location !== 'undefined' && isRecordMode(location.search);
