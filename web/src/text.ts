// Small English text helpers (pure, unit-tested in web/test/text.test.ts).

/** "a Farmer", "an Orchard Master", "an Apple": the right English article. */
export function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word.trim()) ? 'an' : 'a'} ${word}`;
}
