// Arena 1 VS 1, v1 (docs/PLAN-arena.md, Ardian 2026-11-11): the Arena window (Arena pin and the
// Village tab), the duel screen and the Village "Arena" box. Not real-time: the server decides a
// duel at once (server/src/arena.ts) and the web plays it back: the two TaniBots in their title's
// look with their living idle animation (hover, blink, per-title effects), the three rounds one by
// one, then the result with the prize and its transaction. No wagering: a loss costs nothing.
// Rolling dice, laser and the automatic share popup come later (Thursday).

import { useEffect, useState } from 'preact/hooks';
import { api, type Activity, type ArenaPick, type ArenaView, type DuelSide, type DuelView, type GameState, type MatchSummary } from './api';
import { duelPost, fightAt, fighterArtKey, hitFlash, HIT_FLASH_MS, fightTimes, flightMs, fmt, headline, hpTone, prizeChip, recentLine, rewardOf, roundView, roundWhat, ROUND_NAME, seasonLine, sides, youWon, type Fruit, type Hit } from './arena-play';
import { Avatar } from './art/avatars';
import { BotDrones, TaniBot, TANIBOT_H, tierOf } from './art/tanibot';
import { playSound, type SoundName } from './audio';
import { confetti } from './fx';
import { GoldDurian, Sprite, UiIcon } from './sprites';
import { Modal } from './help';
import { PUBLIC_SITE } from './referral';
import { postUrl } from './share';
import { Coin, Panel } from './ui';
import { MatchRow } from './arena-match';
import { OnlineAvatar, OnlineTag } from './online';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  onResume,
}: {
  state: GameState;
  busy: string | null;
  onClose: () => void;
  onDuel: (name: string) => void;
  onReplay: (d: DuelView) => void;
  /** v2: continue the open match. */
  onResume?: (id: number) => void;
}) {
  const [data, setData] = useState<ArenaView | null>(null);
  const v2 = state.arena?.v === 2;
  const active = state.arena?.active ?? null;
  /** Online duel switched on: Duel on an online garden (not a judge garden) invites the player. */
  const liveOn = !!state.arena?.online;
  const [error, setError] = useState<string | null>(null);
  // Reload after each duel: our own (the state's `left` changes) and one we received while the
  // window is open (the newest received duel changes; the 8 s state poll brings it).
  const left = state.arena?.left;
  const newestReceived = state.arena?.received[0]?.id ?? 0;
  useEffect(() => {
    let alive = true;
    api<ArenaView>('GET', '/api/arena')
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [left, newestReceived, active?.id]);

  const blocked = data?.blocked;
  return (
    <Modal title="Arena 1 VS 1" onClose={onClose} closeLabel="Close" class="farmers-dialog arena-dialog">
      <div class="farmers-top arena-top">
        <p class="farmers-intro">
          {v2
            ? 'Challenge a farmer\'s TaniBot to Rock, Paper, Scissors: each turn won throws a fruit, and 3 wins fill your Gold Durian. Better trees hit a little harder. The winner gets PANEN from the game.'
            : 'Challenge a farmer: your trees against theirs in 3 rounds (fruit quality, care, ripeness) plus a little luck. The winner of a challenge gets PANEN from the game.'}{' '}
          <b>No bets: a loss costs nothing.</b>
        </p>
        {active && onResume && (
          <div class="arena-active">
            <span>{active.live ? `Your online duel with ${active.opponent} is waiting for you.` : `Your duel with ${active.opponent}'s TaniBot is waiting.`}</span>
            <button class="btn btn-small btn-mint" onClick={() => (playSound('click'), onResume(active.id))}>
              Continue
            </button>
          </div>
        )}
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
                  <OnlineAvatar id={f.avatar} size={32} online={!!f.online} />
                  <span class="grow farmer-main">
                    <b class="farmer-name">{f.name}</b>
                    <span class="farmer-meta">
                      {f.title} · {f.trees} tree{f.trees === 1 ? '' : 's'}
                    </span>
                    {(f.judge || f.online || f.friend) && (
                      <span class="farmer-tags">
                        {f.online && <OnlineTag />}
                        {f.friend && <span class="tag tag-friend static">Friend</span>}
                        {f.judge && <span class="tag tag-judge">Judge garden</span>}
                      </span>
                    )}
                  </span>
                  <button
                    class="btn btn-small btn-gold arena-duel-btn"
                    disabled={!!blocked || f.dueledToday || !!busy || !!active}
                    title={f.dueledToday ? 'You already challenged this garden today' : liveOn && f.online && !f.judge ? `Challenge ${f.name} live (online now)` : `Challenge ${f.name}`}
                    onClick={() => onDuel(f.name)}
                  >
                    {liveOn && f.online && !f.judge && !f.dueledToday && <span class="online-dot inline" aria-hidden="true" />}
                    {busy === f.name ? 'Dueling...' : f.dueledToday ? 'Dueled' : 'Duel'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(data.recent.length > 0 || (data.matches?.length ?? 0) > 0) && (
            <section class="arena-recent" aria-label="Recent duels">
              <h3 class="arena-h3">Recent duels</h3>
              <ul class="list farmer-list arena-recent-list">
                {recentItems(data.recent, data.matches ?? []).map((x) =>
                  x.kind === 'duel' ? (
                    <RecentRow key={`d${x.d.id}`} d={x.d} onReplay={onReplay} onRematch={x.d.you === 'defender' ? () => onDuel(sides(x.d).them.name) : undefined} busy={!!busy || data.left === 0} />
                  ) : (
                    <MatchRow key={`m${x.m.id}`} m={x.m} onRematch={x.m.you === 'defender' ? () => onDuel(x.m.challenger.name) : undefined} busy={!!busy || data.left === 0 || !!active} />
                  ),
                )}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

/** v1 duels and v2 matches in one list, newest first (at most 10). */
function recentItems(duels: DuelView[], matches: MatchSummary[]) {
  const items = [
    ...duels.map((d) => ({ kind: 'duel' as const, at: d.at, d })),
    ...matches.map((m) => ({ kind: 'match' as const, at: m.endedAt ?? m.at, m })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, 10);
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
  const received = recentItems(state.arena?.received ?? [], state.arena?.receivedMatches ?? []).slice(0, 5);
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
          {received.map((x) => (x.kind === 'duel' ? <RecentRow key={`d${x.d.id}`} d={x.d} onReplay={onReplay} busy={false} /> : <MatchRow key={`m${x.m.id}`} m={x.m} busy={false} />))}
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

/** Name, title and life bar above a fighter (fighting-game style); v2 adds the skill bar under it. */
export function FighterHud({ side, hp, right, skill }: { side: DuelSide; hp: number; right: boolean; skill?: { n: number; max: number } }) {
  return (
    <div class={`fighter-hud${right ? ' right' : ''}`}>
      <span class="fighter-name">
        <b>{side.name}</b>
        <span>{side.title}</span>
      </span>
      <span class="hp-bar" role="meter" aria-label={`${side.name}'s life`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hp}>
        <i class={`hp-fill hp-${hpTone(hp)}`} style={{ width: `${hp}%` }} />
      </span>
      {skill && (
        <span class={`skill-bar${skill.n >= skill.max ? ' full' : ''}`} role="meter" aria-label={`${side.name}'s skill`} aria-valuemin={0} aria-valuemax={skill.max} aria-valuenow={skill.n}>
          {Array.from({ length: skill.max }, (_, i) => (
            <i key={i} class={i < skill.n ? 'on' : ''} />
          ))}
          <GoldDurian scale={1} class="skill-durian" />
        </span>
      )}
    </div>
  );
}

/** A thrown fruit: flies in an arc from the thrower to the target (trail of gold / purple sparkle). */
export function FlyingFruit({ fruit, from, ms, hitKey, big }: { fruit: Fruit; from: 'me' | 'them'; ms: number; hitKey: string; big: boolean }) {
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
          {fruit.species === 'durian' && fruit.quality === 'gold' ? <GoldDurian scale={size} /> : <Sprite name={fruit.species} scale={size} />}
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

/** What a bubble above a TaniBot's head can show (Arena v2). */
export type BubblePick = ArenaPick | '?' | 'timeout';

/**
 * The pick above a TaniBot's head (Arena v2): Rock / Paper / Scissors / the Gold Durian, "?" while it
 * is still secret, or "Time’s up!" (a red "0s") when the player did not pick within the 10 s.
 */
export function PickBubble({ pick, pop }: { pick: BubblePick; pop: boolean }) {
  const label = pick === '?' ? 'Choosing...' : pick === 'gold' ? 'Gold Durian' : pick === 'timeout' ? 'Time’s up!' : pick.charAt(0).toUpperCase() + pick.slice(1);
  return (
    <span class={`pick-bubble${pop ? ' pop' : ''}${pick === 'gold' ? ' gold' : ''}${pick === '?' ? ' secret' : ''}${pick === 'timeout' ? ' late' : ''}`} role="img" aria-label={label}>
      {pick === '?' ? (
        <b class="pick-q">?</b>
      ) : pick === 'timeout' ? (
        <b class="pick-late">0s</b>
      ) : pick === 'gold' ? (
        <GoldDurian scale={3} />
      ) : (
        <UiIcon name={pick} scale={2} />
      )}
    </span>
  );
}

/** One fighter: its TaniBot in its title's look (living idle animation); the left one is mirrored so they face each other. */
export function Fighter({
  side,
  right,
  scale,
  state,
  hard,
  pick,
  flash = false,
}: {
  side: DuelSide;
  right: boolean;
  scale: number;
  state: 'idle' | 'windup' | 'hit' | 'ko' | 'win' | 'dodge' | 'charging';
  hard: boolean;
  /** v2: the pick shown above its head (pop = it just appeared). */
  pick?: { pick: BubblePick; pop: boolean } | null;
  /** The hit's short white flash (only while it is hit; see hitFlash in arena-play.ts). */
  flash?: boolean;
}) {
  // The same look as in the garden: the title's TaniBot with its effects AND its drones (Ardian
  // 2026-11-11: the duel had no drones, so a Farmer / Durian King / Legend did not look like itself).
  const tier = tierOf(side.title);
  return (
    <div class={`fighter ${right ? 'them' : 'me'} ${state}${hard ? ' hard' : ''} tier-${tier}`}>
      {pick && <PickBubble pick={pick.pick} pop={pick.pop} />}
      <BotDrones tier={tier} scale={Math.max(1, scale)} shadow={Math.round(TANIBOT_H * scale * 0.36)} />
      {state === 'charging' && (
        // The Gold Durian charge: a growing gold aura, small sparks, gold motes drawn in.
        <span class="gold-charge" aria-hidden="true">
          <i class="charge-aura" />
          {[0, 1, 2, 3].map((k) => (
            <i key={`s${k}`} class={`charge-spark s${k}`} />
          ))}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
            <i key={`m${k}`} class="charge-mote" style={`--a:${k * 45}deg`} />
          ))}
        </span>
      )}
      {/* A new element (key) when the flash goes on and off and at K.O. / win: iPhone Safari could keep
          the removed white filter painted on the animated TaniBot (the winner stayed white on "YOU WIN!"),
          a fresh element never carries it. */}
      {/* Both fighters are always awake with their title's full look (Ardian 2026-11-13), also the
          loser at K.O. (it only staggers under spinning stars; the garden's ON / OFF never matters here). */}
      <div key={fighterArtKey(state, flash)} class={`fighter-art${flash && state === 'hit' ? ' flash' : ''}`}>
        <TaniBot tier={tier} scale={scale} effects />
      </div>
      {(state === 'hit' || state === 'ko') && (
        <span class="ko-stars" aria-hidden="true">
          <span class="ko-stars-ring">
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
      <span class="fighter-shadow" aria-hidden="true" />
    </div>
  );
}

/** The sound of a fruit hitting (CC0 files already in the game, docs/ASSETS.md). */
export const hitSound = (h: { fruit: Fruit }): SoundName => (h.fruit.species === 'durian' ? 'momentDurian' : h.fruit.quality === 'gold' ? 'momentGold' : 'harvest');

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
    return `${x.phase}|${x.round}|${x.rounds}|${x.hp}|${x.phase === 'impact' && t - x.hitAt < HIT_FLASH_MS}|${x.phase === 'impact' && t - x.hitAt < 350}|${x.phase === 'impact' && t - x.hitAt < 1000}`;
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
            <Fighter side={me} right={false} scale={scale} state={pose('me')} hard={!!f.hit?.hard} flash={!!hitShown && hitFlash(elapsed - f.hitAt)} />
            {!reduced && f.hit && f.phase === 'flight' && <FlyingFruit fruit={f.hit.fruit} from={f.hit.from} ms={flightMs(f.hit.fruit)} hitKey={hitKey} big={wide} />}
            {hitShown && <span key={`burst-${hitKey}`} class={`hit-burst at-${f.hit!.from === 'me' ? 'them' : 'me'}${f.hit!.hard ? ' hard' : ''} q-${f.hit!.fruit.quality}`} aria-hidden="true" />}
            <Fighter side={them} right scale={scale} state={pose('them')} hard={!!f.hit?.hard} flash={!!hitShown && hitFlash(elapsed - f.hitAt)} />
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
                {reward.panen !== null && <span class="gain gain-panen">
                    <Coin scale={2} />+{fmt(reward.panen)} PANEN
                  </span>}
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
