// Arena v2 "lite" on the web (src/arena-turn.ts): the buttons, a decided turn played back (both
// picks pop up first, the life only drops when the fruit lands, a tie = dodge, the Gold Durian),
// the texts that explain a turn and the result.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DuelSide, MatchView, TurnLog } from '../src/api.ts';
import { flightMs } from '../src/arena-play.ts';
import { PICK_LABEL, clockOf, controls, countdown, endBanner, fruitName, hpBefore, matchLine, matchNotice, matchReward, turnAt, turnBanner, turnLength, turnLine, turnReason, turnTimes } from '../src/arena-turn.ts';
import { droneCount, tierOf } from '../src/art/tiers.ts';

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
    turnMs: 10_000,
    turnStartsInMs: 0,
    turnMsLeft: 10_000,
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

  it('turn line without a turn limit: "Turn 4 · Pick your move!" / "TaniBot is choosing..."', () => {
    assert.equal(turnLine(match({ turn: 3 }), false), 'Turn 4 · Pick your move!');
    assert.equal(turnLine(match({ turn: 3 }), true), 'Turn 4 · TaniBot is choosing...');
    assert.equal(turnLine(match({ turn: 3 }), false, 2), 'Turn 3');
  });

  it('the 10 s clock comes from the server; it starts after the last turn plays, red in the last 3 s', () => {
    const c = clockOf(match({ turnStartsInMs: 3000, turnMsLeft: 10_000 }), 1000)!;
    assert.deepEqual(c, { startsAt: 4000, endsAt: 14_000 });
    assert.deepEqual(countdown(c, 2000), { secs: 10, urgent: false, started: false, over: false }, 'full 10 while the last turn still plays');
    assert.deepEqual(countdown(c, 4000), { secs: 10, urgent: false, started: true, over: false });
    assert.equal(countdown(c, 7500).secs, 7);
    assert.deepEqual(countdown(c, 11_000), { secs: 3, urgent: true, started: true, over: false });
    assert.deepEqual(countdown(c, 13_900), { secs: 1, urgent: true, started: true, over: false });
    assert.deepEqual(countdown(c, 14_000), { secs: 0, urgent: true, started: true, over: true });
    // A resumed duel: only the time the server says is left.
    assert.deepEqual(clockOf(match({ turnMsLeft: 4200 }), 0), { startsAt: 0, endsAt: 4200 });
    assert.equal(clockOf(match({ status: 'done' }), 0), null);
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
    const first = T.reveal + T.charge + T.meteor;
    assert.deepEqual(turnAt(m, 1, first, false).hp, [100, 39]);
    const second = first + T.goldImpact + T.charge + T.meteor;
    assert.equal(turnAt(m, 1, second, false).hit?.index, 1);
    assert.deepEqual(turnAt(m, 1, second, false).hp, [52, 39]);
    assert.equal(turnBanner(t1, 'budi'), 'GOLD DURIAN x2!');
  });
});

describe('arena v2 missed turns and the Gold Durian', () => {
  it('a missed turn says "Time’s up!" everywhere (typographic apostrophe); the TaniBot wins and throws', () => {
    const t = log({ pick: { c: 'timeout', d: 'paper' }, winner: 'defender', hits: [{ to: 'challenger', fruit: mango, damage: 14, gold: false }], hp: { c: 86, d: 100 }, skill: { c: 0, d: 1 } });
    assert.equal(turnBanner(t, 'budi'), 'Time’s up!');
    assert.equal(turnReason(t, 'budi'), 'Time’s up! No move in 10 s, so budi’s TaniBot wins the turn.');
    assert.equal(PICK_LABEL.timeout, 'Time’s up!');
    for (const text of [turnBanner(t, 'budi'), turnReason(t, 'budi'), PICK_LABEL.timeout]) assert.doesNotMatch(text, /Too slow|Times up|'/);
    const m = match({ turns: [t], turn: 1, hp: { c: 86, d: 100 } });
    const T = turnTimes(false);
    assert.equal(turnAt(m, 0, T.reveal, false).hit?.from, 'them');
  });

  it('the Gold Durian plays about 3 s: charge, meteor, then the impact (life drops only then)', () => {
    const gd = { species: 'durian' as const, quality: 'gold' as const };
    const t = log({ pick: { c: 'gold', d: 'rock' }, hits: [{ to: 'defender', fruit: gd, damage: 48, gold: true }], hp: { c: 100, d: 52 } });
    const m = match({ turns: [t], turn: 1 });
    const T = turnTimes(false);
    const at = (ms: number) => turnAt(m, 0, ms, false);
    assert.equal(at(T.reveal).phase, 'charge');
    assert.equal(at(T.reveal).hit?.from, 'me');
    assert.equal(at(T.reveal + T.charge).phase, 'meteor');
    assert.deepEqual(at(T.reveal + T.charge + T.meteor - 1).hp, [100, 100]);
    assert.equal(at(T.reveal + T.charge + T.meteor).phase, 'impact');
    assert.deepEqual(at(T.reveal + T.charge + T.meteor).hp, [100, 52]);
    const length = turnLength(t, false);
    assert.ok(length - T.reveal >= 3000 && length - T.reveal <= 3600, `the Gold Durian itself lasts ${length - T.reveal} ms`);
    assert.ok(turnLength(t, false) > turnLength(log({ hits: [{ to: 'defender', fruit: mango, damage: 14, gold: false }] }), false) + 1500);
    // The computer's Gold Durian looks the same (thrown from the right).
    const theirs = match({ turns: [log({ pick: { c: 'rock', d: 'gold' }, winner: 'defender', hits: [{ to: 'challenger', fruit: gd, damage: 40, gold: true }] })], turn: 1 });
    assert.equal(turnAt(theirs, 0, T.reveal, false).phase, 'charge');
    assert.equal(turnAt(theirs, 0, T.reveal, false).hit?.from, 'them');
    // Reduced motion: no charge or meteor, a short impact.
    const R = turnTimes(true);
    assert.equal(turnAt(m, 0, R.reveal, true).phase, 'impact');
    assert.ok(turnLength(t, true) < 1600);
  });
});

describe('the TaniBots in the duel look like in the garden', () => {
  it('each title has its look and its drones (Farmer 1 drone, Durian King 1, Legend 2)', () => {
    assert.equal(tierOf('Durian King'), 'durian_king');
    assert.equal(tierOf('Farmer'), 'farmer');
    assert.equal(tierOf('Legend'), 'legend');
    assert.equal(tierOf('Seedling'), 'seedling');
    assert.equal(tierOf("wati's TaniBot"), 'seedling', 'a name is not a title: the look must come from the title');
    assert.deepEqual(['seedling', 'farmhand', 'farmer', 'orchard_master', 'durian_king', 'legend'].map((t) => droneCount(t as never)), [0, 0, 1, 1, 1, 2]);
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
    assert.match(matchReward({ ...won, winner: 'defender', endReason: 'left', gainedXp: 0 }).line, /missed your last 3 turns/);
    assert.equal(matchLine(won), "You beat budi's TaniBot (40-0 life)");
    const def = { ...won, you: 'defender' as const, winner: 'defender' as const, gainedXp: 15 };
    assert.equal(matchLine(def), 'sari challenged your TaniBot: it won!');
    assert.equal(matchNotice([def]), 'sari challenged your TaniBot in the Arena: your TaniBot won (+15 XP)!');
    assert.equal(matchNotice([{ ...def, winner: 'challenger' }]), 'sari beat your TaniBot in the Arena. Rematch?');
    assert.equal(matchNotice([]), null);
  });

  it('draw (both K.O. in one turn, 2026-11-13): no prize, the loss XP, DOUBLE K.O.!, "Draw" in the history and notice', () => {
    const draw = match({ status: 'done', winner: null, endReason: 'draw', prize: 0, gainedXp: 5, hp: { c: 0, d: 0 } });
    assert.deepEqual(matchReward(draw), { panen: null, xp: 5, line: 'Both TaniBots fell in the same turn: a draw. No prize for anyone, no PANEN lost.' });
    assert.equal(endBanner(draw), 'DOUBLE K.O.!');
    assert.equal(matchLine(draw), "Draw with budi's TaniBot (both K.O.)");
    const def = { ...draw, you: 'defender' as const, gainedXp: 0 };
    assert.equal(matchReward(def).panen, null);
    assert.equal(matchLine(def), 'sari challenged your TaniBot: a draw');
    assert.match(matchNotice([def])!, /a draw/);
    const live = { ...draw, kind: 'live' as const };
    assert.equal(matchLine(live), 'Draw with budi online (both K.O.)');
    assert.equal(matchReward(live).panen, null);
    assert.equal(matchReward({ ...live, practice: 'self' as const, gainedXp: 0 }).xp, 0);
  });
});
