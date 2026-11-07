// Reads a wallet's transaction result (FinalExecutionOutcome). Kept apart from wallet.ts so it can be unit-tested.

/** The transaction hash of a wallet result; throws if NEAR reports a failure. */
export function outcomeHash(outcome: unknown): string | null {
  const o = outcome as { status?: unknown; transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | null | undefined;
  const status = o?.status;
  if (status && typeof status === 'object' && 'Failure' in status) {
    const f = JSON.stringify((status as { Failure: unknown }).Failure);
    const panic = /"(?:panic_msg|ExecutionError)":"([^"]+)"/.exec(f)?.[1];
    throw new Error(`The transaction failed on NEAR${panic ? `: ${panic}` : ''}. Nothing changed.`);
  }
  return o?.transaction?.hash ?? o?.transaction_outcome?.id ?? null;
}
