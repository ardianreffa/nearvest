// Arena 1 VS 1, web side (src/arena-play.ts): the duel's timeline (rounds one by one, Skip /
// reduced motion), the viewer's side, round texts, result lines, the visit panel's Duel button.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DuelSide, DuelView } from '../src/api.ts';
import { duelButton, duelPost, fightAt, fightHits, fightTimes, headline, fighterArtKey, hitFlash, HIT_FLASH_MS, hpTone, prizeChip, receivedNotice, recentLine, rewardLine, rewardOf, roundFruit, roundView, roundWhat, scoreAfter, seasonLine, sides } from '../src/arena-play.ts';
import type { DuelRound, Quality, Species } from '../src/api.ts';

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

  it('result: PANEN really received + XP as chips, the right line for each case', () => {
    assert.equal(headline(duel()), 'YOU WIN!');
    assert.deepEqual(rewardOf(duel()), { panen: 2, xp: 5, line: 'Paid by the game: nobody loses a token in the Arena.' });
    assert.equal(rewardLine(duel({ gainedXp: 15 })), '+2 PANEN · +15 XP. Paid by the game: nobody loses a token in the Arena.');
    assert.equal(rewardOf(duel({ winner: 'defender', prize: 0, gainedXp: 1 })).panen, null);
    assert.match(rewardOf(duel({ winner: 'defender', prize: 0, gainedXp: 1 })).line, /never takes your tokens/);
    assert.deepEqual(rewardOf(duel({ practice: 'self', prize: 0, gainedXp: 0 })).xp, 0);
    assert.match(rewardOf(duel({ practice: 'self', prize: 0, gainedXp: 0 })).line, /Practice duel/);
    assert.match(rewardOf(duel({ practice: 'limit', prize: 0 })).line, /used up/);
    assert.equal(rewardOf(duel({ you: 'defender', winner: 'defender', prize: 0, gainedXp: 3 })).line, 'You defended your garden!');
    assert.equal(prizeChip(2, 8, { number: 3 }), 'Win: +2 PANEN (Season 3)');
    assert.equal(prizeChip(8, 8, { number: 1 }), 'Win: +8 PANEN');
    // The Season note comes from the running Season (state.season), never written in.
    assert.equal(seasonLine({ number: 3, divisor: 4, rewardPercent: 25 }), 'Season 3: rewards are 25% now');
    assert.equal(seasonLine({ number: 1, divisor: 1, rewardPercent: 100 }), 'Season 1: full rewards');
    assert.equal(seasonLine(undefined), '');
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

/** A duel where the challenger wins the rounds in `wins` (true = challenger) with the given trees. */
function fight(wins: boolean[], you: 'challenger' | 'defender', c: [Species, Quality], d: [Species, Quality]): DuelView {
  const tree = (x: [Species, Quality]) => ({ best: { species: x[0], quality: x[1] }, ripest: { species: x[0], quality: x[1], stage: 'fruiting' as const } });
  const rounds: DuelRound[] = (['quality', 'care', 'ripeness'] as const).map((round, i) => ({
    round,
    c: { score: 1, dice: [4] },
    d: { score: 1, dice: [3] },
    winner: wins[i] ? 'challenger' : 'defender',
  }));
  const cw = wins.filter(Boolean).length;
  return duel({ you, rounds, winner: cw >= 2 ? 'challenger' : 'defender', challenger: side('sari', tree(c)), defender: side('budi', tree(d)) });
}

describe('Fruit Fight life bars', () => {
  const FRUITS: [Species, Quality][] = [
    ['mango', 'common'],
    ['rambutan', 'rare'],
    ['durian', 'gold'],
    ['durian', 'common'],
    ['mango', 'gold'],
  ];
  // Every 2-1 and 3-0 result (both orders of rounds, both sides, both viewers, every fruit pair).
  const RESULTS = [
    [true, true, true],
    [false, false, false],
    [true, true, false],
    [true, false, true],
    [false, true, true],
    [false, false, true],
    [false, true, false],
    [true, false, false],
  ];

  it('the duel loser always ends at 0 (K.O.) and the winner always keeps life: 2-1 and 3-0', () => {
    let checked = 0;
    for (const wins of RESULTS)
      for (const you of ['challenger', 'defender'] as const)
        for (const c of FRUITS)
          for (const dd of FRUITS) {
            const d = fight(wins, you, c, dd);
            const hits = fightHits(d);
            assert.equal(hits.length, 3);
            const [mine, theirs] = hits[2].hpAfter;
            const iWon = d.winner === d.you;
            const [winner, loser] = iWon ? [mine, theirs] : [theirs, mine];
            assert.equal(loser, 0, `loser at 0 (${wins} ${you} ${c} ${dd})`);
            assert.ok(winner > 0, `winner keeps life (${wins} ${you} ${c} ${dd}): ${winner}`);
            // Nobody is knocked out before the last hit on them, life never goes below 0.
            for (const h of hits) assert.ok(h.hpAfter.every((x) => x >= 0 && x <= 100));
            const loserHits = hits.filter((h) => (h.from === 'me') === iWon);
            for (const h of loserHits.slice(0, -1)) assert.ok((iWon ? h.hpAfter[1] : h.hpAfter[0]) > 0, 'K.O. only on the last hit');
            checked++;
          }
    assert.equal(checked, RESULTS.length * 2 * FRUITS.length * FRUITS.length);
  });

  it('each round the round winner throws its own fruit; durian and Gold hit harder', () => {
    const d = fight([true, false, true], 'challenger', ['durian', 'gold'], ['mango', 'common']);
    const hits = fightHits(d);
    assert.deepEqual(hits.map((h) => h.from), ['me', 'them', 'me']);
    assert.deepEqual(hits[0].fruit, { species: 'durian', quality: 'gold' });
    assert.deepEqual(hits[1].fruit, { species: 'mango', quality: 'common' });
    assert.equal(hits[0].hard, true);
    assert.equal(hits[1].hard, false);
    // 3-0 with a mango vs a durian: the durian hit does more damage.
    const mixed = fightHits(fight([true, true, true], 'challenger', ['mango', 'common'], ['mango', 'common']));
    assert.deepEqual(mixed.map((h) => h.damage).reduce((a, b) => a + b, 0), 100);
    assert.equal(roundFruit(side('x', { ripest: { species: 'durian', quality: 'rare', stage: 'fruiting' } }), 'ripeness').species, 'durian');
    assert.equal(roundFruit(side('x'), 'care').species, 'mango');
  });

  it('bar colours: full mint, half gold, nearly gone red', () => {
    assert.equal(hpTone(100), 'high');
    assert.equal(hpTone(51), 'high');
    assert.equal(hpTone(50), 'mid');
    assert.equal(hpTone(21), 'mid');
    assert.equal(hpTone(20), 'low');
    assert.equal(hpTone(0), 'low');
  });

  it('about 10-12 s; the bars change only on impact; K.O. then the result; reduced motion jumps per round', () => {
    const T = fightTimes(false);
    assert.ok(T.result >= 10_000 && T.result <= 12_500, `fight lasts ${T.result} ms`);
    const d = fight([true, false, true], 'challenger', ['mango', 'common'], ['durian', 'gold']);
    assert.equal(fightAt(d, 0, false).phase, 'intro');
    assert.deepEqual(fightAt(d, 0, false).hp, [100, 100]);
    const r1 = fightAt(d, T.intro + T.banner + T.windup + 100, false);
    assert.equal(r1.phase, 'flight');
    assert.deepEqual(r1.hp, [100, 100], 'no damage while the fruit flies');
    const after = fightAt(d, r1.hitAt + 10, false);
    assert.equal(after.phase, 'impact');
    assert.ok(after.hp[1] < 100);
    const ko = fightAt(d, T.intro + 3 * T.round + 10, false);
    assert.equal(ko.phase, 'ko');
    assert.equal(ko.hp[1], 0);
    assert.ok(ko.hp[0] > 0);
    assert.equal(fightAt(d, T.result, false).phase, 'result');
    // Reduced motion: shorter, nothing flies; the bar has its round value right after the banner.
    const R = fightTimes(true);
    assert.ok(R.result < T.result);
    const rr = fightAt(d, R.intro + R.banner, true);
    assert.equal(rr.phase, 'impact');
    assert.ok(rr.hp[1] < 100);
  });
});

describe('the white hit flash always ends (iPhone Safari: TaniBots stayed white)', () => {
  it('is on only for the first moment after the impact', () => {
    assert.equal(hitFlash(0), true);
    assert.equal(hitFlash(HIT_FLASH_MS - 1), true);
    assert.equal(hitFlash(HIT_FLASH_MS), false);
    assert.equal(hitFlash(1000), false);
    assert.equal(hitFlash(-1), false);
    assert.ok(HIT_FLASH_MS <= 300, 'a flash, not a long white');
  });

  it('the TaniBot gets a fresh element after the flash and at K.O. / win (the winner stayed white)', () => {
    assert.notEqual(fighterArtKey('hit', true), fighterArtKey('hit', false));
    assert.notEqual(fighterArtKey('idle', false), fighterArtKey('win', false));
    assert.notEqual(fighterArtKey('idle', false), fighterArtKey('ko', false));
    assert.notEqual(fighterArtKey('hit', true), fighterArtKey('win', false));
    assert.equal(fighterArtKey('idle', true), fighterArtKey('idle', false), 'flash only on the TaniBot that is hit');
  });
});
