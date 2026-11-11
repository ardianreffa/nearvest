// Arena 1 VS 1, web side (src/arena-play.ts): the duel's timeline (rounds one by one, Skip /
// reduced motion), the viewer's side, round texts, result lines, the visit panel's Duel button.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DuelSide, DuelView } from '../src/api.ts';
import { duelButton, duelPost, duelStep, duelTimeline, headline, prizeChip, receivedNotice, recentLine, rewardLine, roundView, roundWhat, scoreAfter, sides } from '../src/arena-play.ts';

const side = (name: string, o: Partial<DuelSide> = {}): DuelSide => ({
  name,
  avatar: 'farmer_hat',
  title: 'Seedling',
  scores: { quality: 1, care: 3, ripeness: 3 },
  best: { species: 'mango', quality: 'common' },
  ripest: { species: 'mango', quality: 'common', stage: 'fruiting' },
  trees: 1,
  ...o,
});

/** sari (challenger) vs budi: rounds won by challenger, defender, challenger (2-1). */
function duel(o: Partial<DuelView> = {}): DuelView {
  return {
    id: 1,
    at: 0,
    you: 'challenger',
    challenger: side('sari'),
    defender: side('budi', { title: 'Durian King', scores: { quality: 3, care: 3, ripeness: 3 }, best: { species: 'durian', quality: 'gold' }, trees: 3 }),
    rounds: [
      { round: 'quality', c: { score: 1, dice: [4, 6] }, d: { score: 3, dice: [2, 1] }, winner: 'challenger' },
      { round: 'care', c: { score: 3, dice: [1] }, d: { score: 3, dice: [5] }, winner: 'defender' },
      { round: 'ripeness', c: { score: 3, dice: [6] }, d: { score: 3, dice: [2] }, winner: 'challenger' },
    ],
    winner: 'challenger',
    score: { challenger: 2, defender: 1 },
    practice: null,
    prize: 2,
    prizeStatus: 'pending',
    txUrl: null,
    gainedXp: 5,
    ...o,
  };
}

describe('arena duel playback', () => {
  it('shows the rounds one by one, then the result; reduced motion is faster but still step by step', () => {
    const tl = duelTimeline(false);
    assert.deepEqual(duelStep(0, false), { rounds: 0, result: false });
    assert.deepEqual(duelStep(tl.intro, false), { rounds: 1, result: false });
    assert.deepEqual(duelStep(tl.intro + tl.round, false), { rounds: 2, result: false });
    assert.deepEqual(duelStep(tl.intro + 2 * tl.round + 1, false), { rounds: 3, result: false });
    assert.deepEqual(duelStep(tl.result, false), { rounds: 3, result: true });
    assert.ok(tl.result < 6000, 'the whole duel takes under 6 s');
    assert.ok(duelTimeline(true).result < tl.result);
    assert.deepEqual(duelStep(duelTimeline(true).intro, true), { rounds: 1, result: false });
  });

  it('the viewer is always on the left; scores count from the viewer', () => {
    const d = duel();
    assert.equal(sides(d).me.name, 'sari');
    assert.deepEqual(scoreAfter(d, 1), [1, 0]);
    assert.deepEqual(scoreAfter(d, 3), [2, 1]);
    const asDefender = duel({ you: 'defender' });
    assert.equal(sides(asDefender).me.name, 'budi');
    assert.deepEqual(scoreAfter(asDefender, 3), [1, 2]);
    assert.equal(headline(asDefender), 'THEY WIN');
  });

  it('a round shows score + the last die (after a tie) and which tree stands for each side', () => {
    const r = roundView(duel(), 0);
    assert.deepEqual(r.mine, { score: 1, die: 6, total: 7 });
    assert.deepEqual(r.theirs, { score: 3, die: 1, total: 4 });
    assert.equal(r.won, true);
    assert.equal(r.rerolls, 1);
    const d = duel();
    assert.equal(roundWhat(d.defender, 'quality'), 'Gold Durian');
    assert.equal(roundWhat(d.challenger, 'ripeness'), 'Mango with fruit');
    assert.equal(roundWhat(d.defender, 'care'), '3 of 3 trees cared for');
    assert.equal(roundWhat(side('x', { trees: 3, scores: { quality: 1, care: 2, ripeness: 1 } }), 'care'), '2 of 3 trees cared for');
  });

  it('result lines: prize, loss without cost, practice, defended', () => {
    assert.equal(headline(duel()), 'YOU WIN!');
    assert.equal(rewardLine(duel()), '+2 PANEN from the game · +5 XP');
    assert.match(rewardLine(duel({ winner: 'defender', prize: 0, gainedXp: 1 })), /No PANEN lost: the Arena never takes your tokens · \+1 XP/);
    assert.match(rewardLine(duel({ practice: 'self', prize: 0, gainedXp: 0 })), /Practice duel/);
    assert.match(rewardLine(duel({ practice: 'limit', prize: 0 })), /used up/);
    assert.equal(rewardLine(duel({ you: 'defender', winner: 'defender', prize: 0, gainedXp: 3 })), 'You defended your garden · +3 XP.');
    assert.equal(prizeChip(2, 8, { number: 3 }), 'Win: +2 PANEN (Season 3)');
    assert.equal(prizeChip(8, 8, { number: 1 }), 'Win: +8 PANEN');
  });

  it('recent rows, notices and the X post', () => {
    assert.equal(recentLine(duel()), 'You beat budi 2-1');
    assert.equal(recentLine(duel({ winner: 'defender' })), 'budi beat you 2-1');
    assert.equal(recentLine(duel({ you: 'defender' })), 'sari challenged you and won 2-1');
    assert.equal(receivedNotice([]), null);
    assert.equal(receivedNotice([duel({ you: 'defender' })]), 'sari challenged you in the Arena and won 2-1. Rematch?');
    // budi defends 2-1 (rounds 2 and 3 to the defender).
    const defended = duel({ you: 'defender', winner: 'defender', gainedXp: 3 });
    defended.rounds = defended.rounds.map((r, i) => ({ ...r, winner: i === 0 ? 'challenger' : 'defender' }));
    assert.equal(receivedNotice([defended]), 'sari challenged you in the Arena: you won 2-1 (+3 XP)!');
    assert.match(receivedNotice([duel(), duel()])!, /2 farmers challenged you/);
    const post = duelPost(duel());
    assert.match(post, /beat budi 2-1/);
    assert.match(post, /@NEARProtocol #NEARHackathon/);
  });

  it('the Duel button says why it is off', () => {
    assert.deepEqual(duelButton(null).enabled, false);
    assert.equal(duelButton({ ok: true, reason: null, left: 2 }).enabled, true);
    assert.equal(duelButton({ ok: false, reason: 'limit', left: 0 }).label, 'No duels');
    assert.equal(duelButton({ ok: false, reason: 'pair_today', left: 2 }).label, 'Dueled');
    assert.match(duelButton({ ok: false, reason: 'no_tree', left: 3 }).title, /Plant a tree first/);
  });
});
