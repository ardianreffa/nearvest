// Design-system tokens (styles.css :root) for code that cannot use var(), such as a canvas.
// Colours and fonts are only ever named here through their token; see CLAUDE.md "Design system".

/** The value of a CSS custom property on :root, e.g. token('--mint-500'). */
export function token(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

