// Arena 1 VS 1, v1 (docs/PLAN-arena.md, Ardian 2026-11-11): the Arena window (Arena pin and the
// Village tab), the duel screen and the Village "Arena" box. Not real-time: the server decides a
// duel at once (server/src/arena.ts) and the web plays it back: the two TaniBots in their title's
// look with their living idle animation (hover, blink, per-title effects), the three rounds one by
// one, then the result with the prize and its transaction. No wagering: a loss costs nothing.
// Rolling dice, laser and the automatic share popup come later (Thursday).

import { useEffect, useState } from 'preact/hooks';
import { api, type Activity, type ArenaView, type DuelSide, type DuelView, type GameState } from './api';
import { duelPost, fightAt, fightTimes, flightMs, fmt, headline, hpTone, prizeChip, recentLine, rewardOf, roundView, roundWhat, ROUND_NAME, seasonLine, sides, youWon, type Fruit, type Hit } from './arena-play';
import { Avatar } from './art/avatars';
import { TaniBot, tierOf } from './art/tanibot';
import { playSound, type SoundName } from './audio';
import { confetti } from './fx';
import { Sprite } from './sprites';
import { Modal } from './help';
import { PUBLIC_SITE } from './referral';
import { postUrl } from './share';
import { Panel } from './ui';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "today" / "yesterday" / "3 days ago". */
function ago(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The Arena window: duels left, the prize, opponents (Farmers of Tandur with a tree), recent duels. */
export function ArenaWindow({
  state,
  busy,
  onClose,
  onDuel,
  onReplay,
}: {
  state: GameState;
  busy: string | null;
  onClose: () => void;
  onDuel: (name: string) => void;
  onReplay: (d: DuelView) => void;
}) {
  const [data, setData] = useState<ArenaView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reload after each duel (the state's `left` changes).
  const left = state.arena?.left;
  useEffect(() => {
    let alive = true;
    api<ArenaView>('GET', '/api/arena')
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [left]);

  const blocked = data?.blocked;
  return (
    <Modal title="Arena 1 VS 1" onClose={onClose} closeLabel="Close" class="farmers-dialog arena-dialog">
      <div class="farmers-top arena-top">
        <p class="farmers-intro">
          Challenge a farmer: your trees against theirs in 3 rounds (fruit quality, care, ripeness) plus a little luck. The winner of a challenge gets PANEN from the game.{' '}
          <b>No bets: a loss costs nothing.</b>
        </p>
        {data && (
          <div class="arena-chips">
            <span class="arena-chip">
              Duels left today {data.left}/{data.max}
            </span>
            <span class="arena-chip gold">{prizeChip(data.prizeNow, data.prize, state.season)}</span>
          </div>
        )}
        {blocked === 'no_tree' && <p class="visit-note arena-blocked">Plant a tree first: your trees fight for you in the Arena.</p>}
        {blocked === 'limit' && <p class="visit-note arena-blocked">You used your duels today. Come back tomorrow!</p>}
      </div>
      {error && <p class="error-text">Could not open the Arena: {error}</p>}
      {!data && !error && <p class="muted">Opening the Arena...</p>}
      {data && (
        <div class="arena-scroll">
          {data.opponents.length === 0 ? (
            <p class="muted farmers-empty">No farmer with a tree to challenge yet. Invite a friend from the Village tab!</p>
          ) : (
            <ul class="list farmer-list arena-list" aria-label="Farmers to challenge">
              {data.opponents.map((f) => (
                <li key={f.name} class="farmer-row">
                  <Avatar id={f.avatar} size={32} />
                  <span class="grow farmer-main">
                    <b class="farmer-name">{f.name}</b>
                    <span class="farmer-meta">
                      {f.title} · {f.trees} tree{f.trees === 1 ? '' : 's'}
                    </span>
                    {f.judge && (
                      <span class="farmer-tags">
                        <span class="tag tag-judge">Judge garden</span>
                      </span>
                    )}
                  </span>
                  <button
                    class="btn btn-small btn-gold arena-duel-btn"
                    disabled={!!blocked || f.dueledToday || !!busy}
                    title={f.dueledToday ? 'You already challenged this garden today' : `Challenge ${f.name}`}
                    onClick={() => onDuel(f.name)}
                  >
                    {busy === f.name ? 'Dueling...' : f.dueledToday ? 'Dueled' : 'Duel'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data.recent.length > 0 && (
            <section class="arena-recent" aria-label="Recent duels">
              <h3 class="arena-h3">Recent duels</h3>
              <ul class="list farmer-list arena-recent-list">
                {data.recent.map((d) => (
                  <RecentRow key={d.id} d={d} onReplay={onReplay} onRematch={d.you === 'defender' ? () => onDuel(sides(d).them.name) : undefined} busy={!!busy || data.left === 0} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function RecentRow({ d, onReplay, onRematch, busy }: { d: DuelView; onReplay: (d: DuelView) => void; onRematch?: () => void; busy: boolean }) {
  const { them } = sides(d);
  return (
    <li class={`farmer-row arena-row${youWon(d) ? ' won' : ' lost'}`}>
      <Avatar id={them.avatar} size={28} />
      <span class="grow farmer-main">
        <b class="arena-row-line">{recentLine(d)}</b>
        <span class="farmer-meta">
          {ago(d.at)}
          {d.prize > 0 && d.you === 'challenger' && ` · +${d.prize} PANEN`}
          {d.practice && ' · practice'}
          {d.txUrl && (
            <>
              {' · '}
              <a href={d.txUrl} target="_blank" rel="noopener noreferrer">
                tx
              </a>
            </>
          )}
        </span>
      </span>
      <span class="arena-row-actions">
        <button class="btn btn-small" onClick={() => (playSound('click'), onReplay(d))}>
          Replay
        </button>
        {onRematch && (
          <button class="btn btn-small btn-gold" disabled={busy} onClick={onRematch}>
            Rematch
          </button>
        )}
      </span>
    </li>
  );
}

/** Village tab: the duels this garden was challenged in (the Village red dot points here too). */
export function ArenaPanel({ state, onOpen, onReplay }: { state: GameState; onOpen: () => void; onReplay: (d: DuelView) => void }) {
  const received = state.arena?.received ?? [];
  return (
    <Panel
      title="Arena"
      class="arena-panel"
      right={
        <button class="btn btn-small btn-gold" onClick={() => (playSound('click'), onOpen())}>
          Open Arena
        </button>
      }
    >
      {received.length === 0 ? (
        <p class="muted small">No one has challenged your garden yet. Challenges you receive show up here, win or lose.</p>
      ) : (
        <ul class="list arena-recent-list" aria-label="Duels you were challenged in">
          {received.slice(0, 5).map((d) => (
            <RecentRow key={d.id} d={d} onReplay={onReplay} busy={false} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------- Fruit Fight (Ardian 2026-11-11): the duel played like a fighting game ----------
// The server's result is the script (fightHits in arena-play.ts): each round's winner steps forward
// and throws its fruit (species + quality from the server's trees) in an arc; the target flashes,
// is knocked back, sees stars and its life bar drops. The duel's loser always ends at 0 (K.O.!),
// then sleeps (TaniBot's OFF look with Zzz) while the winner jumps; then the result. Motion is CSS
// (transform / opacity only, light on phones); reduced motion: nothing flies or shakes, the bars
// jump to each round's value.

/** Name, title and life bar above a fighter (fighting-game style). */
function FighterHud({ side, hp, right }: { side: DuelSide; hp: number; right: boolean }) {
  return (
    <div class={`fighter-hud${right ? ' right' : ''}`}>
      <span class="fighter-name">
        <b>{side.name}</b>
        <span>{side.title}</span>
      </span>
      <span class="hp-bar" role="meter" aria-label={`${side.name}'s life`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hp}>
        <i class={`hp-fill hp-${hpTone(hp)}`} style={{ width: `${hp}%` }} />
      </span>
    </div>
  );
}

/** A thrown fruit: flies in an arc from the thrower to the target (trail of gold / purple sparkle). */
function FlyingFruit({ fruit, from, ms, hitKey, big }: { fruit: Fruit; from: 'me' | 'them'; ms: number; hitKey: string; big: boolean }) {
  const size = (fruit.species === 'durian' ? 5 : fruit.species === 'rambutan' ? 4 : 3) * (big ? 2 : 1);
  const ghosts = fruit.quality === 'common' ? [] : [1, 2, 3];
  const one = (ghost: number) => (
    <span
      key={`${hitKey}-${ghost}`}
      class={`fruit-x${ghost ? ' ghost' : ''}`}
      style={{ animationDuration: `${ms}ms`, animationDelay: `${ghost * 45}ms`, opacity: ghost ? 0.55 - ghost * 0.13 : 1 }}
    >
      <span class={`fruit-y ${fruit.species}`} style={{ animationDuration: `${ms}ms`, animationDelay: `${ghost * 45}ms` }}>
        <span class={`fruit-spin q-${fruit.quality}`} style={{ animationDuration: `${ms}ms` }}>
          <Sprite name={fruit.species} scale={size} />
        </span>
      </span>
    </span>
  );
  return (
    <div class={`fruit-path from-${from} ${fruit.species}`} aria-hidden="true">
      {ghosts.map((g) => one(g)).reverse()}
      {one(0)}
    </div>
  );
}

/** One fighter: its TaniBot in its title's look (living idle animation), mirrored on the right. */
function Fighter({ side, right, scale, state, hard }: { side: DuelSide; right: boolean; scale: number; state: 'idle' | 'windup' | 'hit' | 'ko' | 'win'; hard: boolean }) {
  const tier = tierOf(side.title);
  return (
    <div class={`fighter ${right ? 'them' : 'me'} ${state}${hard ? ' hard' : ''}`}>
      <div class={`fighter-art${state === 'ko' ? ' asleep' : ''}`}>
        <TaniBot tier={tier} scale={scale} effects={state !== 'ko'} />
      </div>
      {state === 'hit' && (
        <span class="ko-stars" aria-hidden="true">
          <span class="ko-stars-ring">
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
      {state === 'ko' && (
        <span class="bot-zzz fighter-zzz" aria-hidden="true">
          <i>z</i>
          <i>z</i>
          <i>z</i>
        </span>
      )}
      <span class="fighter-shadow" aria-hidden="true" />
    </div>
  );
}

/** The sound of a fruit hitting (CC0 files already in the game, docs/ASSETS.md). */
const hitSound = (h: Hit): SoundName => (h.fruit.species === 'durian' ? 'momentDurian' : h.fruit.quality === 'gold' ? 'momentGold' : 'harvest');

/**
 * The duel screen: the Fruit Fight (about 12 s, Skip any time), then the result with the PANEN
 * really received (after the Season rule), the XP, the running Season and the prize's transaction.
 */
export function DuelScreen({
  duel: d,
  wide,
  activity,
  season,
  onClose,
}: {
  duel: DuelView;
  wide: boolean;
  activity: Activity[];
  season?: { number: number; divisor: number; rewardPercent: number };
  onClose: () => void;
}) {
  const reduced = reducedMotion();
  const T = fightTimes(reduced);
  const [t0] = useState(() => Date.now());
  const [skipped, setSkipped] = useState(false);
  // Dev builds: window.__duelT = <ms> freezes the fight at that moment (screenshots, tools/ui-test.mjs).
  const devT = () => (import.meta.env.DEV ? (window as unknown as { __duelT?: number }).__duelT : undefined);
  const timeNow = () => (skipped ? T.result : (devT() ?? Date.now() - t0));
  // Light on phones: the screen is drawn again only when something changes (a phase, a hit, the
  // bars), not every frame; the motion itself is CSS.
  const look = (t: number) => {
    const x = fightAt(d, t, reduced);
    return `${x.phase}|${x.round}|${x.rounds}|${x.hp}|${x.phase === 'impact' && t - x.hitAt < 350}|${x.phase === 'impact' && t - x.hitAt < 1000}`;
  };
  const [, setLook] = useState('');
  useEffect(() => {
    if (skipped) return;
    const id = window.setInterval(() => {
      const t = timeNow();
      setLook(look(t));
      if (t >= T.result && devT() === undefined) window.clearInterval(id);
    }, 50);
    return () => window.clearInterval(id);
  }, [skipped]);
  const elapsed = timeNow();
  const f = fightAt(d, elapsed, reduced);
  const done = f.phase === 'result';
  const won = youWon(d);

  // Sounds and confetti, once per event.
  const event = `${f.phase}:${f.round}`;
  useEffect(() => {
    if (skipped && !done) return;
    if (f.phase === 'windup' && f.hit) playSound('click');
    if (f.phase === 'impact' && f.hit) playSound(hitSound(f.hit));
    if (f.phase === 'ko') playSound('momentEvolve');
    if (f.phase === 'celebrate' && won) confetti(36);
    if (f.phase === 'result') playSound(won ? 'levelup' : 'click');
  }, [event]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (done ? onClose() : setSkipped(true));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, onClose]);

  const { me, them } = sides(d);
  // Fighter poses: the thrower steps forward, the target is hit (knock-back, flash, stars) for ~1 s.
  const hitShown = f.hit && f.phase === 'impact' && elapsed - f.hitAt < 1000;
  const pose = (who: 'me' | 'them') => {
    const loser = won ? 'them' : 'me';
    if (f.phase === 'ko' || f.phase === 'celebrate' || done) return who === loser ? 'ko' : f.phase === 'ko' ? 'idle' : 'win';
    if (!f.hit) return 'idle';
    if ((f.phase === 'windup' || f.phase === 'flight') && f.hit.from === who) return 'windup';
    if (hitShown && f.hit.from !== who) return 'hit';
    return 'idle';
  };
  const hitKey = `${f.round}`;
  const shake = !reduced && hitShown && elapsed - f.hitAt < 350 ? (f.hit!.hard ? ' shake hard' : ' shake') : '';
  const [mineWon, theirsWon] = [0, 1, 2].slice(0, f.rounds).reduce(([a, b], i) => (roundView(d, i).won ? [a + 1, b] : [a, b + 1]), [0, 0]);

  // The prize's transaction: from the duel (replays) or the game log once the job has landed.
  const job = d.prize > 0 && d.you === 'challenger' ? activity.find((a) => a.note === 'arena' && a.createdAt >= d.at - 2000) : undefined;
  const txUrl = d.txUrl ?? job?.explorerUrl ?? null;
  const paid = d.prize > 0 && d.you === 'challenger' && !txUrl;
  const pending = paid && (!job || job.status === 'pending');
  const sent = paid && job?.status === 'done';
  const reward = rewardOf(d);
  const scale = wide ? 4 : 2;

  return (
    <div class="dialog-backdrop duel-backdrop" role="presentation">
      <div class={`duel panel${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={`Arena duel: ${me.name} vs ${them.name}`}>
        <header class="panel-head duel-head">
          <h2>FRUIT FIGHT</h2>
          {!done ? (
            <button class="btn btn-small duel-skip" onClick={() => setSkipped(true)}>
              Skip
            </button>
          ) : (
            <button class="icon-btn info-close" onClick={onClose} aria-label="Close">
              x
            </button>
          )}
        </header>

        <div class={`fight-stage${shake}${reduced ? ' still' : ''}`}>
          <div class="fight-hud">
            <FighterHud side={me} hp={f.hp[0]} right={false} />
            <div class="fight-score" aria-live="polite">
              <span class={mineWon > theirsWon ? 'ahead' : ''}>{mineWon}</span>
              <span class="duel-vs">VS</span>
              <span class={theirsWon > mineWon ? 'ahead' : ''}>{theirsWon}</span>
            </div>
            <FighterHud side={them} hp={f.hp[1]} right />
          </div>
          <div class="fight-floor" style={`--bot-w:${58 * scale}px;--bot-h:${64 * scale}px`}>
            <Fighter side={me} right={false} scale={scale} state={pose('me')} hard={!!f.hit?.hard} />
            {!reduced && f.hit && f.phase === 'flight' && <FlyingFruit fruit={f.hit.fruit} from={f.hit.from} ms={flightMs(f.hit.fruit)} hitKey={hitKey} big={wide} />}
            {hitShown && <span key={`burst-${hitKey}`} class={`hit-burst at-${f.hit!.from === 'me' ? 'them' : 'me'}${f.hit!.hard ? ' hard' : ''} q-${f.hit!.fruit.quality}`} aria-hidden="true" />}
            <Fighter side={them} right scale={scale} state={pose('them')} hard={!!f.hit?.hard} />
          </div>
          {(f.phase === 'intro' || f.phase === 'banner') && (
            <div class="fight-banner" key={`banner-${f.round}`}>
              {f.phase === 'intro' ? 'FIGHT!' : `ROUND ${f.round + 1} · ${ROUND_NAME[d.rounds[f.round].round].toUpperCase()}`}
            </div>
          )}
          {(f.phase === 'ko' || f.phase === 'celebrate') && <div class="fight-ko">K.O.!</div>}
        </div>

        <ol class="duel-rounds">
          {[0, 1, 2].map((i) => {
            const shown = i < f.rounds;
            const r = roundView(d, i);
            return (
              <li key={i} class={`duel-round${shown ? (r.won ? ' won' : ' lost') : ' hidden'}`} aria-hidden={!shown}>
                <span class="duel-round-name">
                  {i + 1} · {ROUND_NAME[r.round]}
                </span>
                {shown ? (
                  <span class="duel-round-row">
                    <span class={`duel-side${r.won ? ' win' : ''}`}>
                      <span class="duel-what">{roundWhat(me, r.round)}</span>
                      <span class="duel-sum">
                        {r.mine.score} + <i class="die">{r.mine.die}</i> = <b>{r.mine.total}</b>
                      </span>
                    </span>
                    <span class={`duel-side right${!r.won ? ' win' : ''}`}>
                      <span class="duel-what">{roundWhat(them, r.round)}</span>
                      <span class="duel-sum">
                        {r.theirs.score} + <i class="die">{r.theirs.die}</i> = <b>{r.theirs.total}</b>
                      </span>
                    </span>
                  </span>
                ) : (
                  <span class="duel-round-hint">...</span>
                )}
                {shown && r.rerolls > 0 && <span class="duel-tie">Tie! Rolled again{r.rerolls > 1 ? ` ${r.rerolls} times` : ''}.</span>}
              </li>
            );
          })}
        </ol>

        {done && (
          <div class={`duel-result${won ? ' win' : ' lose'}`}>
            <div class="duel-headline">{headline(d)}</div>
            {(reward.panen !== null || reward.xp > 0) && (
              <div class="duel-gains">
                {reward.panen !== null && <span class="gain gain-panen">+{fmt(reward.panen)} PANEN</span>}
                {reward.xp > 0 && <span class="gain gain-xp">+{reward.xp} XP</span>}
              </div>
            )}
            <p class="duel-reward">{reward.line}</p>
            {reward.panen !== null && season && <p class="duel-season">{seasonLine(season)}</p>}
            {txUrl ? (
              <p class="duel-tx">
                <a href={txUrl} target="_blank" rel="noopener noreferrer">
                  See the prize on NEAR (nearblocks)
                </a>
              </p>
            ) : pending ? (
              <p class="duel-tx muted">Sending the prize on NEAR... the transaction appears in the Village log.</p>
            ) : sent ? (
              <p class="duel-tx muted">Prize sent: see it in the Village log.</p>
            ) : null}
            <div class="duel-actions">
              {won && !d.practice && d.you === 'challenger' && (
                <a class="btn btn-mint" href={postUrl(duelPost(d), PUBLIC_SITE)} target="_blank" rel="noopener noreferrer" onClick={() => playSound('click')}>
                  Share on X
                </a>
              )}
              <button class="btn btn-gold" onClick={onClose}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
