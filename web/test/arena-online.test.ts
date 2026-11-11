// The online Arena duel on the web (src/arena-turn.ts, docs/PLAN-arena.md 7.12): the challenged
// player sees the duel turned around (always "me" on the left), the buttons wait after your pick,
// the texts name the player (not "their TaniBot"), why an invite became a TaniBot duel, the result
// lines (left, cancelled, practice) and the Recent duels row.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DuelSide, MatchView, TurnLog } from '../src/api.ts';
import { asMine, controls, pickBubbles, foeLabel, inviteNote, matchLine, matchPost, matchReward, turnBanner, turnLine, turnReason } from '../src/arena-turn.ts';

const side = (name: string): DuelSide => ({ name, avatar: 'farmer-1', title: 'Seedling', scores: { quality: 1, care: 3, ripeness: 3 }, best: null, ripest: null, trees: 1 });
const log = (o: Partial<TurnLog>): TurnLog => ({ turn: 0, pick: { c: 'rock', d: 'scissors' }, winner: 'challenger', hits: [], hp: { c: 100, d: 100 }, skill: { c: 0, d: 0 }, ...o });
const mango = { species: 'mango' as const, quality: 'common' as const };

function match(o: Partial<MatchView> = {}): MatchView {
  return {
    id: 1, v: 2, kind: 'live', at: 0, endedAt: null, you: 'challenger', challenger: side('sari'), defender: side('budi'), status: 'playing', turn: 0,
    turnMs: 10_000, turnStartsInMs: 0, turnMsLeft: 10_000, hp: { c: 100, d: 100 }, maxHp: 100, skill: { c: 0, d: 0 }, skillMax: 3, bonus: { c: 13, d: 20 },
    winner: null, endReason: null, practice: null, prize: 0, prizeStatus: null, txUrl: null, gainedXp: 0, turns: [], myPick: null, theyPicked: false, ...o,
  };
}

describe('arena online duel (web)', () => {
  it('the challenged player sees the duel turned around: me on the left, every number swapped', () => {
    const m = match({
      you: 'defender',
      hp: { c: 86, d: 100 },
      skill: { c: 0, d: 1 },
      bonus: { c: 5, d: 20 },
      winner: 'defender',
      turns: [log({ pick: { c: 'scissors', d: 'rock' }, winner: 'defender', hits: [{ to: 'challenger', fruit: mango, damage: 14, gold: false }], hp: { c: 86, d: 100 }, skill: { c: 0, d: 1 } })],
    });
    const f = asMine(m);
    assert.equal(f.you, 'challenger');
    assert.equal(f.challenger.name, 'budi');
    assert.equal(f.defender.name, 'sari');
    assert.deepEqual(f.hp, { c: 100, d: 86 });
    assert.deepEqual(f.skill, { c: 1, d: 0 });
    assert.deepEqual(f.bonus, { c: 20, d: 5 });
    assert.equal(f.winner, 'challenger');
    assert.deepEqual(f.turns[0].pick, { c: 'rock', d: 'scissors' });
    assert.equal(f.turns[0].winner, 'challenger');
    assert.equal(f.turns[0].hits[0].to, 'defender');
    assert.deepEqual(f.turns[0].hp, { c: 100, d: 86 });
    // The challenger and TaniBot duels stay as they are.
    const mine = match();
    assert.equal(asMine(mine), mine);
    const bot = match({ kind: 'bot', you: 'defender' });
    assert.equal(asMine(bot), bot);
  });

  it('after your pick the buttons wait for the other player; the line says who we wait for', () => {
    assert.equal(controls(match({ myPick: 'rock' }), false).rps, false);
    assert.equal(controls(match(), false).rps, true);
    assert.equal(turnLine(match({ myPick: 'rock' }), false), 'Turn 1 · Waiting for budi...');
    assert.equal(turnLine(match({ myPick: 'rock', theyPicked: true }), false), 'Turn 1 · Both picked!');
    assert.equal(turnLine(match({ theyPicked: true }), false), 'Turn 1 · budi has picked. Your move!');
  });

  it('texts name the player, not "their TaniBot"; a missed turn on either side = "Time’s up!"', () => {
    assert.equal(foeLabel(match()), 'budi');
    assert.equal(foeLabel(match({ kind: 'bot' })), "budi's TaniBot");
    const lost = log({ pick: { c: 'rock', d: 'paper' }, winner: 'defender' });
    assert.equal(turnBanner(lost, 'budi', true), 'budi wins the turn');
    assert.equal(turnBanner(lost, 'budi'), "budi's TaniBot wins the turn");
    assert.equal(turnBanner(log({ pick: { c: 'rock', d: 'timeout' } }), 'budi', true), 'Time’s up!');
    assert.equal(turnBanner(log({ pick: { c: 'timeout', d: 'timeout' }, winner: 'both' }), 'budi', true), 'Time’s up!');
    assert.equal(turnReason(log({ pick: { c: 'rock', d: 'timeout' } }), 'budi', true), 'Time’s up! budi did not move in 10 s, so you win the turn.');
    assert.equal(turnReason(log({ pick: { c: 'timeout', d: 'rock' }, winner: 'defender' }), 'budi', true), 'Time’s up! No move in 10 s, so budi wins the turn.');
    assert.equal(turnReason(log({ pick: { c: 'timeout', d: 'timeout' }, winner: 'both' }), 'budi', true), 'Time’s up! Nobody moved in 10 s, so both are hit.');
  });

  it('why an invite became a TaniBot duel', () => {
    assert.equal(inviteNote(match({ kind: 'bot', inviteResult: 'declined' })), "budi said no: you fight budi's TaniBot!");
    assert.equal(inviteNote(match({ kind: 'bot', inviteResult: 'timeout' })), "budi did not answer: you fight budi's TaniBot!");
    assert.equal(inviteNote(match({ kind: 'bot', inviteResult: 'busy' })), "budi is in another duel: you fight budi's TaniBot!");
    assert.match(inviteNote(match({ kind: 'bot', inviteResult: 'judge' }))!, /Judge gardens/);
    assert.equal(inviteNote(match({ kind: 'bot', inviteResult: 'skipped' })), null);
    assert.equal(inviteNote(match({ kind: 'live', inviteResult: 'accepted' })), null);
  });

  it('result lines: a win (also when the other player left), a loss after leaving, cancelled, practice', () => {
    const won = asMine(match({ status: 'done', winner: 'challenger', endReason: 'ko', prize: 8, gainedXp: 15 }));
    assert.deepEqual(matchReward(won), { panen: 8, xp: 15, line: 'Paid by the game: nobody loses a token in the Arena.' });
    const left = match({ you: 'defender', status: 'done', winner: 'defender', endReason: 'left', prize: 8, gainedXp: 15 });
    assert.equal(matchReward(asMine(left)).line, 'sari left the duel, so you win! Paid by the game.');
    assert.equal(matchReward(asMine(left)).panen, 8);
    const iLeft = match({ status: 'done', winner: 'defender', endReason: 'left' });
    assert.equal(matchReward(iLeft).line, 'You left the duel, so it counts as a loss. No PANEN lost.');
    assert.match(matchReward(match({ status: 'cancelled' })).line, /cancelled/);
    assert.equal(matchReward(match({ status: 'done', winner: 'challenger', endReason: 'ko', practice: 'self' })).panen, null);
    assert.match(matchReward(match({ status: 'done', endReason: 'abandoned' })).line, /Both players left/);
  });

  it('Recent duels row and the post on X', () => {
    const m = { ...match({ status: 'done', winner: 'challenger', endReason: 'ko', hp: { c: 40, d: 0 } }), turns: undefined, turnCount: 6 };
    assert.equal(matchLine(m), 'You beat budi online (40-0 life)');
    assert.equal(matchLine({ ...m, you: 'defender' }), 'sari beat you online (40-0 life)');
    assert.equal(matchLine({ ...m, endReason: 'left' }), 'budi left the online duel: you win');
    assert.match(matchPost(match()), /live Fruit Fight/);
  });

  it('pick bubbles: "?" over both heads at every new turn, your own pick at once, both opened together when decided (also vs a TaniBot)', () => {
    const q = { pick: '?', pop: false };
    const t1 = log({ pick: { c: 'paper', d: 'rock' } });
    for (const kind of ['live', 'bot'] as const) {
      // Turn 2 starts after turn 1 was played back: last turn's picks are gone.
      const m = match({ kind, turn: 1, turns: [t1] });
      assert.deepEqual(pickBubbles(m, { sending: null, anim: null, gold: false, result: false }), { me: q, them: q });
      // Tapping: mine at once, theirs secret.
      assert.deepEqual(pickBubbles(m, { sending: 'scissors', anim: null, gold: false, result: false }), { me: { pick: 'scissors', pop: true }, them: q });
      // Turn 1 playing back: both picks together.
      assert.deepEqual(pickBubbles(m, { sending: null, anim: { i: 0, reveal: true }, gold: false, result: false }), { me: { pick: 'paper', pop: true }, them: { pick: 'rock', pop: true } });
    }
    // Online: my pick is in, waiting for the other player: mine shown, theirs "?" (even when they picked).
    const waiting = match({ turn: 1, turns: [t1], myPick: 'rock', theyPicked: true });
    assert.deepEqual(pickBubbles(waiting, { sending: null, anim: null, gold: false, result: false }), { me: { pick: 'rock', pop: false }, them: q });
    // The other player's screen while I wait: both "?".
    assert.deepEqual(pickBubbles(match({ turn: 1, turns: [t1], theyPicked: true }), { sending: null, anim: null, gold: false, result: false }), { me: q, them: q });
    // Paused: still "?".
    assert.deepEqual(pickBubbles(match({ status: 'paused', turn: 1, turns: [t1] }), { sending: null, anim: null, gold: false, result: false }), { me: q, them: q });
    // Gold Durian playing, result shown, invite: no bubbles.
    assert.deepEqual(pickBubbles(match({ turns: [t1] }), { sending: null, anim: { i: 0, reveal: false }, gold: true, result: false }), { me: null, them: null });
    assert.deepEqual(pickBubbles(match({ status: 'done', turns: [t1] }), { sending: null, anim: null, gold: false, result: true }), { me: null, them: null });
    assert.deepEqual(pickBubbles(match({ status: 'invite' }), { sending: null, anim: null, gold: false, result: false }), { me: null, them: null });
    // K.O. (before the result): the final picks stay.
    assert.deepEqual(pickBubbles(match({ status: 'done', turns: [t1] }), { sending: null, anim: null, gold: false, result: false }).them, { pick: 'rock', pop: false });
  });
});
