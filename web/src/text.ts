// Small English text helpers (pure, unit-tested in web/test/text.test.ts).

/** "a Farmer", "an Orchard Master", "an Apple": the right English article. */
export function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word.trim()) ? 'an' : 'a'} ${word}`;
}

/** Mr. Darto's line when the Market was opened by its red dot (new fruit): short, with the count. */
export function dartoFreshLine(fruits: number): string {
  return `Fresh fruit! I'll buy your ${fruits} ${fruits === 1 ? 'fruit' : 'fruits'}. Tap Sell!`;
}

/** Mr. Darto introduces himself only the first time (per garden, this browser). */
export const DARTO_INTRO = "Welcome, farmer! I'm Mr. Darto. Show me what you've got!";

/** ONE greeting at a time (Ardian 2026-11-13): the introduction once, then the server's daily line. */
export function dartoGreeting(firstMeeting: boolean, daily: string): string {
  return firstMeeting || !daily.trim() ? DARTO_INTRO : daily;
}

const dartoMetKey = (account: string) => `nearvest.dartoMet.${account}`;

/** True only the first time this garden meets Mr. Darto in this browser (and remembers it). */
export function firstDartoMeeting(account: string, store: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    if (!store || store.getItem(dartoMetKey(account))) return false;
    store.setItem(dartoMetKey(account), '1');
    return true;
  } catch {
    return false;
  }
}
