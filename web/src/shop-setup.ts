// Wallet gardens, the first Shop purchase (Ardian 2026-11-10): a short window explains the
// limited game key BEFORE the wallet opens ("Continue" / "Not now"). The gas allowance comes from
// the server's config (GAME_KEY_ALLOWANCE_YOCTO = 0.01 NEAR), so the text never promises a wrong amount.

const YOCTO_PER_NEAR = 10n ** 24n;

/** Yocto NEAR as a short NEAR amount: "10000000000000000000000" -> "0.01". */
export function nearFromYocto(yocto: string): string {
  let v: bigint;
  try {
    v = BigInt(yocto);
  } catch {
    return '0.01';
  }
  const whole = v / YOCTO_PER_NEAR;
  const frac = (v % YOCTO_PER_NEAR).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** The Set up Shop window's text (Ardian's wording). */
export function shopSetupText(allowanceYocto: string): string[] {
  return [
    `Your wallet will ask to add a limited game key. It can only spend PANEN in the Shop (burn) and uses at most ${nearFromYocto(allowanceYocto)} testnet NEAR for gas.`,
    'Your NEAR and NFTs stay safe.',
    'Your wallet may show a red warning; this is expected.',
  ];
}
