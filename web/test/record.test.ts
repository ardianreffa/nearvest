import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRecordMode } from '../src/record.ts';

describe('demo recording mode', () => {
  it('is on only with ?record=1', () => {
    assert.equal(isRecordMode('?record=1'), true);
    assert.equal(isRecordMode('?demo=1&record=1'), true);
    assert.equal(isRecordMode(''), false);
    assert.equal(isRecordMode('?record=0'), false);
    assert.equal(isRecordMode('?record=true'), false);
    assert.equal(isRecordMode('?recorder=1'), false);
  });
});
