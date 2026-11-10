// Small English text helpers (pure, unit-tested in web/test/text.test.ts).

/** "a Farmer", "an Orchard Master", "an Apple": the right English article. */
export function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word.trim()) ? 'an' : 'a'} ${word}`;
}

/** Mr. Darto's line when the Market was opened by its red dot (new fruit): short, with the count. */
export function dartoFreshLine(fruits: number): string {
  return `Fresh fruit! I'll buy your ${fruits} ${fruits === 1 ? 'fruit' : 'fruits'}. Tap Sell!`;
}
