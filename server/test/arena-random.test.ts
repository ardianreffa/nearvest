// Arena: the TaniBot's Rock / Paper / Scissors pick cannot be predicted (player report 2026-11-13).
// The server picks with crypto.randomInt (no fixed order, no seed, no style, never looks at the
// player's picks), locks it in `bot_pick` when the turn opens, and throws its Gold Durian as soon as
// its skill bar is full (ARENA_SKILL_MAX). These tests check the spread of the picks and that simple
// fixed strategies win about 1/3 of the turns, both on the pure pick and through real matches.

import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { describe, it } from 'node:test';
import { Arena } from '../src/arena.ts';
import { ArenaMatches, botPick, type Pick } from '../src/arena-match.ts';
import type { PlayerRow } from '../src/game.ts';
import { ARENA_SKILL_MAX } from '../src/rules.ts';
import { makeWorld } from './helpers.ts';

type Rps = 'rock' | 'paper' | 'scissors';
const RPS: Rps[] = ['rock', 'paper', 'scissors'];
const BEATS: Record<Rps, Rps> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const beaterOf = (p: Rps): Rps => RPS.find((x) => BEATS[x] === p)!;
const crypto = (n: number) => randomInt(0, n);

/** Player strategies that a pattern in the TaniBot's picks would reward. */
const STRATEGIES: Record<string, (turn: number, lastBot: Rps | null) => Rps> = {
  'always rock': () => 'rock',
  'rotate rock -> paper -> scissors': (turn) => RPS[turn % 3],
  'copy the TaniBot\'s last pick': (_t, last) => last ?? 'rock',
  'beat the TaniBot\'s last pick': (_t, last) => (last ? beaterOf(last) : 'rock'),
};

describe('arena: the TaniBot pick is random', () => {
  it('the pick spreads evenly over Rock / Paper / Scissors (30,000 picks per skill level below full)', () => {
    for (let skill = 0; skill < ARENA_SKILL_MAX; skill++) {
      const n = 30_000;
      const count: Record<string, number> = { rock: 0, paper: 0, scissors: 0 };
      for (let i = 0; i < n; i++) count[botPick(skill, crypto)]++;
      for (const p of RPS) {
        const share = count[p] / n;
        assert.ok(Math.abs(share - 1 / 3) < 0.02, `skill ${skill}: ${p} = ${(share * 100).toFixed(1)}%`);
      }
    }
  });

  it('a full skill bar always throws the Gold Durian (the only fixed rule)', () => {
    for (let i = 0; i < 100; i++) assert.equal(botPick(ARENA_SKILL_MAX, crypto), 'gold');
  });

  it('fixed strategies win about 1/3 of the turns against the pick (30,000 turns each)', () => {
    for (const [name, strategy] of Object.entries(STRATEGIES)) {
      let wins = 0;
      let last: Rps | null = null;
      const n = 30_000;
      for (let t = 0; t < n; t++) {
        const bot = botPick(0, crypto) as Rps;
        if (BEATS[strategy(t, last)] === bot) wins++;
        last = bot;
      }
      const rate = wins / n;
      assert.ok(rate < 0.36 && rate > 0.3, `${name}: ${(rate * 100).toFixed(1)}% won`);
    }
  });
});

let ips = 0;
async function garden(w: ReturnType<typeof makeWorld>, name: string): Promise<PlayerRow> {
  const p = w.newPlayer(name, `10.0.7.${++ips}`);
  await w.worker.drain();
  w.game.checkin(p.id);
  const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
  w.game.plant(p.id, 0, seed);
  await w.worker.drain();
  return w.game.getPlayer(p.id);
}

describe('arena: real matches with the server\'s own random (no test rand)', () => {
  it('the locked picks spread evenly and no fixed strategy wins far above 1/3 (about 1,500 turns per strategy)', async (t) => {
    const w = makeWorld({ devLogin: true });
    const arena = new Arena(w.db, w.game, w.now);
    const matches = new ArenaMatches(w.db, w.game, arena, w.now); // default rand = crypto.randomInt
    const me = await garden(w, 'sari');
    const foes: string[] = [];
    for (let i = 0; i < 8; i++) foes.push((await garden(w, `foe${i}`)).name);

    const count: Record<string, number> = { rock: 0, paper: 0, scissors: 0, gold: 0 };
    let foe = 0;
    for (const [name, strategy] of Object.entries(STRATEGIES)) {
      let wins = 0;
      let turns = 0;
      for (let round = 0; round < 8; round++) {
        let m = matches.start(me.id, foes[foe++ % foes.length], '1.1.1.1', 'dev-a').match;
        let last: Rps | null = null;
        for (let t = 0; t < 190 && m.status === 'playing'; t++) {
          // Keep the match going (full life, empty skill bars): only the pick is measured.
          w.db.prepare('UPDATE arena_matches SET hp_c = 100, hp_d = 100, skill_c = 0, skill_d = 0 WHERE id = ?').run(m.id);
          const locked = (w.db.prepare('SELECT bot_pick FROM arena_matches WHERE id = ?').get(m.id) as { bot_pick: Pick }).bot_pick;
          const mine = strategy(m.turn, last);
          m = matches.pick(me.id, m.id, m.turn, mine).match;
          const log = m.turns[m.turns.length - 1];
          assert.equal(log.pick.d, locked, 'the TaniBot plays the pick locked before the player picked');
          count[locked]++;
          if (locked === 'gold') continue; // a bar filled before the reset: the Gold rule, not a guess
          turns++;
          if (log.winner === 'challenger') wins++;
          last = locked as Rps;
        }
        // Next day: the 3-duels-a-day limit starts again.
        w.advance(24 * 3_600_000);
      }
      const rate = wins / turns;
      assert.ok(turns > 1_000, `${name}: ${turns} turns`);
      t.diagnostic(`${name}: won ${(rate * 100).toFixed(1)}% of ${turns} turns`);
      assert.ok(rate < 0.4, `${name}: ${(rate * 100).toFixed(1)}% of ${turns} turns won`);
    }
    const rps = count.rock + count.paper + count.scissors;
    t.diagnostic(`TaniBot picks: rock ${count.rock}, paper ${count.paper}, scissors ${count.scissors}, gold ${count.gold}`);
    for (const p of RPS) assert.ok(Math.abs(count[p] / rps - 1 / 3) < 0.04, `${p} = ${((count[p] / rps) * 100).toFixed(1)}% of ${rps}`);
  });
});
