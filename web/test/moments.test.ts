import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addLater,
  enqueueMoment,
  orderMoments,
  POPUP_AFTER_FX_MS,
  popupDelay,
  removeLater,
  SHARE_LATER_MAX,
  type Moment,
  type QueuedMoment,
} from '../src/moments.ts';

const kinds = (list: Moment[]) => list.map((m) => (m.title ? `${m.kind}:${m.title}` : m.kind));
const auto = (m: Moment): QueuedMoment => ({ m, fx: true });

describe('share card order', () => {
  it('first harvest comes before the new title and TaniBot evolution (demo XP x5 gives both at once)', () => {
    // The title change is noticed first (state update), the first harvest a moment later.
    const held: Moment[] = [{ kind: 'evolved', title: 'Farmhand' }, { kind: 'first_harvest', species: 'durian', quality: 'rare' }];
    assert.deepEqual(kinds(orderMoments(held)), ['first_harvest', 'evolved:Farmhand']);
  });

  it('keeps every card (none is lost) and drops only exact duplicates', () => {
    const list: Moment[] = [
      { kind: 'title', title: 'Farmer' },
      { kind: 'evolved', title: 'Farmhand' },
      { kind: 'first_harvest' },
      { kind: 'first_harvest' },
      { kind: 'first_gold' },
    ];
    assert.deepEqual(kinds(orderMoments(list)), ['first_harvest', 'first_gold', 'title:Farmer', 'evolved:Farmhand']);
  });

  it('the waiting queue: a later first harvest jumps ahead of a waiting title; duplicates are ignored', () => {
    let q: QueuedMoment[] = [];
    q = enqueueMoment(q, auto({ kind: 'evolved', title: 'Farmhand' }));
    q = enqueueMoment(q, auto({ kind: 'big_durian', quality: 'rare' }));
    q = enqueueMoment(q, auto({ kind: 'first_harvest' }));
    q = enqueueMoment(q, auto({ kind: 'first_harvest' }));
    assert.deepEqual(kinds(q.map((x) => x.m)), ['first_harvest', 'big_durian', 'evolved:Farmhand']);
  });

  it('a card the player opens goes before the automatic ones', () => {
    let q: QueuedMoment[] = [auto({ kind: 'first_harvest' })];
    q = enqueueMoment(q, { m: { kind: 'profile' }, fx: false, manual: true });
    assert.deepEqual(kinds(q.map((x) => x.m)), ['profile', 'first_harvest']);
  });
});

describe('share popup timing', () => {
  it('opens 1.5 s after the moment animation ends', () => {
    assert.equal(POPUP_AFTER_FX_MS, 1500);
    assert.equal(popupDelay(auto({ kind: 'first_harvest' }), 1600), 3100);
  });

  it('a card whose animation already played (held by the tutorial / Judge tour) waits 1.5 s', () => {
    assert.equal(popupDelay({ m: { kind: 'title', title: 'Farmer' }, fx: false }, 1800), 1500);
  });

  it('a card the player opened opens at once', () => {
    assert.equal(popupDelay({ m: { kind: 'profile' }, fx: false, manual: true }, 0), 0);
  });
});

describe('Share later list', () => {
  it('newest first, one entry per moment', () => {
    let l: Moment[] = [];
    l = addLater(l, { kind: 'first_harvest' });
    l = addLater(l, { kind: 'title', title: 'Farmer' });
    l = addLater(l, { kind: 'first_harvest' });
    assert.deepEqual(kinds(l), ['first_harvest', 'title:Farmer']);
  });

  it('keeps at most 10 and removes one', () => {
    let l: Moment[] = [];
    for (let i = 0; i < 14; i++) l = addLater(l, { kind: 'title', title: `T${i}` });
    assert.equal(l.length, SHARE_LATER_MAX);
    assert.equal(l[0].title, 'T13');
    l = removeLater(l, { kind: 'title', title: 'T13' });
    assert.equal(l[0].title, 'T12');
  });
});
