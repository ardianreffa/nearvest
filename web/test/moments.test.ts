import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enqueueMoment, orderMoments, type Moment } from '../src/moments.ts';

const kinds = (list: Moment[]) => list.map((m) => (m.title ? `${m.kind}:${m.title}` : m.kind));

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

  it('the dialog queue: the card on screen stays, a later first harvest jumps ahead of a waiting title', () => {
    let q: Moment[] = [];
    q = enqueueMoment(q, { kind: 'streak7' }); // on screen
    q = enqueueMoment(q, { kind: 'evolved', title: 'Farmhand' });
    q = enqueueMoment(q, { kind: 'first_harvest' });
    q = enqueueMoment(q, { kind: 'first_harvest' }); // duplicate: ignored
    assert.deepEqual(kinds(q), ['streak7', 'first_harvest', 'evolved:Farmhand']);
  });

  it('a first harvest that arrives after a new title still opens first when nothing is on screen', () => {
    const q = enqueueMoment(enqueueMoment([], { kind: 'first_harvest' }), { kind: 'evolved', title: 'Farmhand' });
    assert.deepEqual(kinds(q), ['first_harvest', 'evolved:Farmhand']);
  });
});
