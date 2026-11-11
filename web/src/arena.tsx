// Arena 1 VS 1, v1 (docs/PLAN-arena.md, Ardian 2026-11-11): the Arena window (Arena pin and the
// Village tab), the duel screen and the Village "Arena" box. Not real-time: the server decides a
// duel at once (server/src/arena.ts) and the web plays it back: the two TaniBots in their title's
// look with their living idle animation (hover, blink, per-title effects), the three rounds one by
// one, then the result with the prize and its transaction. No wagering: a loss costs nothing.
// Rolling dice, laser and the automatic share popup come later (Thursday).

import { useEffect, useState } from 'preact/hooks';
import { api, type Activity, type ArenaView, type DuelSide, type DuelView, type GameState } from './api';
import { duelPost, duelStep, headline, prizeChip, recentLine, rewardLine, roundView, roundWhat, ROUND_HINT, ROUND_NAME, scoreAfter, sides, youWon } from './arena-play';
import { Avatar } from './art/avatars';
import { TaniBot, tierOf } from './art/tanibot';
import { playSound } from './audio';
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

/** One garden in the duel: its TaniBot (the owner's title look, living idle animation), name and title. */
function DuelBot({ side, right, scale, lead, down }: { side: DuelSide; right: boolean; scale: number; lead: boolean; down: boolean }) {
  return (
    <figure class={`duel-bot${right ? ' right' : ''}${lead ? ' lead' : ''}${down ? ' down' : ''}`}>
      <div class="duel-bot-art">
        <TaniBot tier={tierOf(side.title)} scale={scale} />
      </div>
      <figcaption>
        <b>{side.name}</b>
        <span>{side.title}</span>
      </figcaption>
    </figure>
  );
}

/**
 * The duel screen: you on the left, them on the right (mirrored), the rounds one by one with each
 * side's score + die, the score board, then the result (prize, XP, the transaction from the log).
 * Skip shows everything at once.
 */
export function DuelScreen({ duel: d, wide, activity, onClose }: { duel: DuelView; wide: boolean; activity: Activity[]; onClose: () => void }) {
  const reduced = reducedMotion();
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (skipped) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [skipped]);
  const step = skipped ? { rounds: 3, result: true } : duelStep(now - t0, reduced);
  useEffect(() => {
    if (step.rounds > 0 && !step.result) playSound(roundView(d, step.rounds - 1).won ? 'coins' : 'click');
  }, [step.rounds]);
  useEffect(() => {
    if (step.result) playSound(youWon(d) ? 'levelup' : 'click');
  }, [step.result]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (step.result ? onClose() : setSkipped(true));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step.result, onClose]);

  const { me, them } = sides(d);
  const [mine, theirs] = scoreAfter(d, step.rounds);
  const lastWon = step.rounds > 0 ? roundView(d, step.rounds - 1).won : null;
  // The prize's transaction: from the duel (replays) or the game log once the job has landed.
  const job = d.prize > 0 && d.you === 'challenger' ? activity.find((a) => a.note === 'arena' && a.createdAt >= d.at - 2000) : undefined;
  const txUrl = d.txUrl ?? job?.explorerUrl ?? null;
  const paid = d.prize > 0 && d.you === 'challenger' && !txUrl;
  const pending = paid && (!job || job.status === 'pending');
  const sent = paid && job?.status === 'done';
  const scale = wide ? 4 : 2;
  const done = step.result;

  return (
    <div class="dialog-backdrop duel-backdrop" role="presentation">
      <div class={`duel panel${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={`Arena duel: ${me.name} vs ${them.name}`}>
        <header class="panel-head duel-head">
          <h2>ARENA · 1 VS 1</h2>
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
        <div class="duel-stage">
          <DuelBot side={me} right={false} scale={scale} lead={!done && lastWon === true} down={done && !youWon(d)} />
          <div class="duel-mid">
            <div class="duel-score" aria-live="polite">
              <span class={mine > theirs ? 'ahead' : ''}>{mine}</span>
              <span class="duel-vs">VS</span>
              <span class={theirs > mine ? 'ahead' : ''}>{theirs}</span>
            </div>
            <ol class="duel-rounds">
              {[0, 1, 2].map((i) => {
                const shown = i < step.rounds;
                const r = roundView(d, i);
                return (
                  <li key={i} class={`duel-round${shown ? (r.won ? ' won' : ' lost') : ' hidden'}`} aria-hidden={!shown}>
                    <span class="duel-round-name">
                      Round {i + 1} · {ROUND_NAME[r.round]}
                    </span>
                    {shown && (
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
                    )}
                    {shown && r.rerolls > 0 && <span class="duel-tie">Tie! Rolled again{r.rerolls > 1 ? ` ${r.rerolls} times` : ''}.</span>}
                    {!shown && <span class="duel-round-hint">{ROUND_HINT[r.round]}</span>}
                  </li>
                );
              })}
            </ol>
          </div>
          <DuelBot side={them} right scale={scale} lead={!done && lastWon === false} down={done && youWon(d)} />
        </div>
        {done ? (
          <div class={`duel-result${youWon(d) ? ' win' : ' lose'}`}>
            <div class="duel-headline">{headline(d)}</div>
            <p class="duel-reward">{rewardLine(d)}</p>
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
              {youWon(d) && !d.practice && d.you === 'challenger' && (
                <a class="btn btn-mint" href={postUrl(duelPost(d), PUBLIC_SITE)} target="_blank" rel="noopener noreferrer" onClick={() => playSound('click')}>
                  Share on X
                </a>
              )}
              <button class="btn btn-gold" onClick={onClose}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <p class="duel-wait muted" aria-hidden="true">
            {step.rounds === 0 ? 'The TaniBots face each other...' : step.rounds < 3 ? 'Next round...' : 'And the winner is...'}
          </p>
        )}
      </div>
    </div>
  );
}
