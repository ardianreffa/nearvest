import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outcomeHash } from '../src/outcome.ts';

describe('wallet transaction result', () => {
  it('returns the transaction hash of a successful result', () => {
    assert.equal(outcomeHash({ status: { SuccessValue: '' }, transaction: { hash: 'AbC123' } }), 'AbC123');
    assert.equal(outcomeHash({ status: { SuccessValue: '' }, transaction_outcome: { id: 'XyZ' } }), 'XyZ');
    assert.equal(outcomeHash(undefined), null);
  });
  it('throws a clear error when the transaction failed on NEAR', () => {
    const failed = { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: Not enough balance' } } } } }, transaction: { hash: 'h' } };
    assert.throws(() => outcomeHash(failed), /failed on NEAR: Smart contract panicked: Not enough balance\. Nothing changed\./);
  });
});
