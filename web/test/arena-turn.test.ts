// Arena v2 "lite" on the web (src/arena-turn.ts): the buttons, a decided turn played back (both
// picks pop up first, the life only drops when the fruit lands, a tie = dodge, the Gold Durian),
// the texts that explain a turn and the result.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DuelSide, MatchView, TurnLog } from '../src/api.ts';
import { flightMs } from '../src/arena-play.ts';
import { controls, endBanner, fruitName, hpBefore, matchLine, matchNotice, matchReward, turnAt, turnBanner, turnLength, turnLine, turnReason, turnTimes } from '../src/arena-turn.ts';

const side = (name: string): DuelSide => ({ name, avatar: 'farmer-1', title: 'Seedling', scores: { quality: 1, care: 3, ripeness: 3 }, best: null, ripest: null, trees: 1 });

const log = (o: Partial<TurnLog>): TurnLog => ({ turn: 0, pick: { c: 'rock', d: 'scissors' }, winner: 'challenger', hits: [], hp: { c: 100, d: 100 }, skill: { c: 0, d: 0 }, ...o });

function match(o: Partial<MatchView> = {}): MatchView {
  return {
    id: 1,
    v: 2,
    kind: 'bot',
    at: 0,
    endedAt: null,
    you: 'challenger',
    challenger: side('sari'),
    defender: side('budi'),
    status: 'playing',
    turn: 0,
    maxTurns: 15,
    hp: { c: 100, d: 100 },
    maxHp: 100,
    skill: { c: 0, d: 0 },
    skillMax: 3,
    bonus: { c: 13, d: 20 },
    winner: null,
    endReason: null,
    practice: null,
    prize: 0,
    prizeStatus: null,
    txUrl: null,
    gainedXp: 0,
    turns: [],
    ...o,
  };
}

const mango = { species: 'mango' as const, quality: 'common' as const };

describe('arena v2 controls', () => {
  it('Rock / Paper / Scissors while playing; the Gold Durian only with a full skill bar; nothing while a turn plays or after the end', () => {
    assert.deepEqual(controls(match(), false), { rps: true, gold: false, goldLit: false, skill: '0/3' });
    assert.deepEqual(controls(match({ skill: { c: 3, d: 0 } }), false), { rps: true, gold: true, goldLit: true, skill: '3/3' });
    assert.equal(controls(match({ skill: { c: 3, d: 0 } }), true).gold, false, 'busy: wait for the turn');
    assert.equal(controls(match({ skill: { c: 3, d: 0 } }), true).goldLit, true, 'still lit while busy');
    assert.deepEqual(controls(match({ status: 'done' }), false).rps, false);
  });

  it('turn line: "Turn 4 of 15 · Pick your move!" / "TaniBot is choosing..."', () => {
    assert.equal(turnLine(match({ turn: 3 }), false), 'Turn 4 of 15 · Pick your move!');
    assert.equal(turnLine(match({ turn: 3 }), true), 'Turn 4 of 15 · TaniBot is choosing...');
  });
});

describe('arena v2 turn playback', () => {
  it('the picks show first; the life drops only when the fruit lands', () => {
    const t = log({ hits: [{ to: 'defender', fruit: mango, damage: 16, gold: false }], hp: { c: 100, d: 84 }, skill: { c: 1, d: 0 } });
    const m = match({ turns: [t], turn: 1, hp: { c: 100, d: 84 }, skill: { c: 1, d: 0 } });
    const T = turnTimes(false);
    const at = (ms: number) => turnAt(m, 0, ms, false);
    assert.equal(at(0).phase, 'reveal');
    assert.deepEqual(at(0).hp, [100, 100]);
    assert.deepEqual(at(0).skill, [0, 0], 'the skill bar fills when the hit lands');
    assert.equal(at(T.reveal).phase, 'windup');
    assert.equal(at(T.reveal).hit?.from, 'me');
    assert.equal(at(T.reveal + T.windup).phase, 'flight');
    assert.deepEqual(at(T.reveal + T.windup + flightMs(mango) - 1).hp, [100, 100]);
    const land = T.reveal + T.windup + flightMs(mango);
    assert.equal(at(land).phase, 'impact');
    assert.deepEqual(at(land).hp, [100, 84]);
    assert.deepEqual(at(land).skill, [1, 0]);
    assert.equal(at(turnLength(t, false)).phase, 'done');
    assert.equal(turnLength(t, false), land + T.impact);
  });

  it('a tie = both dodge, no life lost; reduced motion: no flight, shorter', () => {
    const t = log({ pick: { c: 'paper', d: 'paper' }, winner: 'tie' });
    const m = match({ turns: [t], turn: 1 });
    assert.equal(turnAt(m, 0, turnTimes(false).reveal, false).phase, 'dodge');
    assert.deepEqual(turnAt(m, 0, turnTimes(false).reveal, false).hp, [100, 100]);
    const hit = log({ hits: [{ to: 'challenger', fruit: { species: 'durian', quality: 'gold' }, damage: 38, gold: false }], winner: 'defender', hp: { c: 62, d: 100 } });
    const r = match({ turns: [hit], turn: 1 });
    assert.equal(turnAt(r, 0, turnTimes(true).reveal, true).phase, 'impact');
    assert.equal(turnAt(r, 0, turnTimes(true).reveal, true).hit?.from, 'them');
    assert.ok(turnLength(hit, true) < turnLength(hit, false));
  });

  it('both throw the Gold Durian: two hits one after the other; life starts from the previous turn', () => {
    const gd = { species: 'durian' as const, quality: 'gold' as const };
    const t0 = log({ hits: [{ to: 'defender', fruit: mango, damage: 16, gold: false }], hp: { c: 100, d: 84 } });
    const t1 = log({ turn: 1, pick: { c: 'gold', d: 'gold' }, winner: 'both', hits: [{ to: 'defender', fruit: gd, damage: 45, gold: true }, { to: 'challenger', fruit: gd, damage: 48, gold: true }], hp: { c: 52, d: 39 } });
    const m = match({ turns: [t0, t1], turn: 2 });
    assert.deepEqual(hpBefore(m, 1), [100, 84]);
    const T = turnTimes(false);
    const first = T.reveal + T.windup + flightMs(gd);
    assert.deepEqual(turnAt(m, 1, first, false).hp, [100, 39]);
    const second = first + T.impact + T.windup + flightMs(gd);
    assert.equal(turnAt(m, 1, second, false).hit?.index, 1);
    assert.deepEqual(turnAt(m, 1, second, false).hp, [52, 39]);
    assert.equal(turnBanner(t1, 'budi'), 'GOLD DURIAN x2!');
  });
});

describe('arena v2 texts', () => {
  it('explains each turn: who beat whom, dodge, Gold Durian', () => {
    assert.equal(turnReason(log({ pick: { c: 'rock', d: 'scissors' } })), 'Rock beats Scissors.');
    assert.equal(turnReason(log({ pick: { c: 'rock', d: 'paper' }, winner: 'defender' })), 'Paper beats Rock.');
    assert.equal(turnReason(log({ pick: { c: 'paper', d: 'paper' }, winner: 'tie' })), 'Paper and Paper: both dodge.');
    assert.equal(turnReason(log({ pick: { c: 'gold', d: 'rock' } })), 'The Gold Durian always hits.');
    assert.equal(turnBanner(log({ winner: 'defender' }), 'budi'), "budi's TaniBot wins the turn");
    assert.equal(turnBanner(log({ winner: 'tie' }), 'budi'), 'Dodge!');
    assert.equal(fruitName({ species: 'rambutan', quality: 'rare' }), 'Rare Rambutan');
    assert.equal(fruitName(mango), 'Mango');
  });

  it('result: prize after the Season rule, practice, leaving, defender; K.O. or TIME UP!', () => {
    const won = match({ status: 'done', winner: 'challenger', endReason: 'ko', prize: 2, gainedXp: 75, hp: { c: 40, d: 0 } });
    assert.deepEqual(matchReward(won), { panen: 2, xp: 75, line: 'Paid by the game: nobody loses a token in the Arena.' });
    assert.equal(endBanner(won), 'K.O.!');
    assert.equal(endBanner({ ...won, endReason: 'turns' }), 'TIME UP!');
    assert.equal(matchReward({ ...won, practice: 'self' }).panen, null);
    assert.match(matchReward({ ...won, winner: 'defender', endReason: 'left', gainedXp: 0 }).line, /left the duel/);
    assert.equal(matchLine(won), "You beat budi's TaniBot (40-0 life)");
    const def = { ...won, you: 'defender' as const, winner: 'defender' as const, gainedXp: 15 };
    assert.equal(matchLine(def), 'sari challenged your TaniBot: it won!');
    assert.equal(matchNotice([def]), 'sari challenged your TaniBot in the Arena: your TaniBot won (+15 XP)!');
    assert.equal(matchNotice([{ ...def, winner: 'challenger' }]), 'sari beat your TaniBot in the Arena. Rematch?');
    assert.equal(matchNotice([]), null);
  });
});
