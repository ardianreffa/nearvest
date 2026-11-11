// Garden visits (docs/PLAN-social.md): the farmer list ("Farmers of Tandur", from the Friends pin
// or the Village tab), visiting a friend's garden (read only, the same village scene with their
// trees; the visit panel names the garden; their TaniBot as decoration: floating when ON, asleep when
// OFF, a tap says hello) and helping water one thirsty tree per village day. The server checks
// every rule (server/src/social.ts); visitors only get public data (TaniBot: ON / OFF only).
// "Sticker" leaves one of 6 template stickers (invite.tsx StickerWindow, 3 per garden per day, 5 s
// apart: only the button counts down, from the server's time). Search finds any ready garden by the start of its name.

import { useEffect, useState } from 'preact/hooks';
import { duelButton } from './arena-play';
import { api, type ArenaCan, type FarmersResponse, type GameState, type HelpResult, type PublicGarden, type VisitResponse } from './api';
import { Avatar } from './art/avatars';
import { playSound } from './audio';
import { floatText } from './fx';
import { PhoneGarden } from './garden';
import { Modal } from './help';
import type { Immersive } from './layout';
import { StickerWindow, useStickerStatus, type StickerStatus } from './invite';
import { matchesPrefix, stickerButtonLabel, stickerReadyAt } from './referral';
import { GardenScene, type SceneFx } from './scene';
import { Sprite, UiIcon } from './sprites';
import type { Toast } from './toast';
import { QUALITY_NAME, SPECIES_NAME } from './ui';

type Notify = (t: Omit<Toast, 'id'>) => void;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Farmers of Tandur": who to visit (helped you / thirsty first), one Visit button per farmer, and
 * a search by name (any ready garden whose name starts with it, judge gardens never). Only the
 * list scrolls (one scroll area: iPhone Safari drew rows over each other with two).
 */
export function FarmersWindow({ onClose, onVisit }: { onClose: () => void; onVisit: (name: string) => void }) {
  const [data, setData] = useState<FarmersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const q = query.trim().toLowerCase();
  useEffect(() => {
    let alive = true;
    setSearching(true);
    // Typing: ask the server a moment after the last key (the first load at once).
    const t = window.setTimeout(
      () =>
        api<FarmersResponse>('GET', q ? `/api/farmers?q=${encodeURIComponent(q)}` : '/api/farmers')
          .then((d) => {
            if (!alive) return;
            // Servers without search ignore ?q= and send the normal list: filter it here.
            setData(q && d.query === undefined ? { ...d, farmers: d.farmers.filter((f) => matchesPrefix(f.name, q)) } : d);
            setError(null);
          })
          .catch((e) => alive && setError(errorText(e)))
          .finally(() => alive && setSearching(false)),
      data ? 250 : 0,
    );
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const farmers = data?.farmers ?? [];
  return (
    <Modal title="Farmers of Tandur" onClose={onClose} closeLabel="Close" class="farmers-dialog">
      <div class="farmers-top">
        <p class="farmers-intro">
          Visit a farmer's garden and water one thirsty tree a day:{' '}
          {data?.help.youngGarden ? (
            <span>your garden is new, so helping gives no XP until tomorrow.</span>
          ) : (
            <span>
              you get <b>+{data?.help.helperXp ?? 5} XP</b>, they get <b>+3 XP</b>.
            </span>
          )}
        </p>
        {data?.helpedToday && (
          <p class="farmers-done">
            <Sprite name="droplet" scale={2} /> You helped {data.helpedToday.name} today. Come back tomorrow to help again (you can still visit).
          </p>
        )}
        <div class="farmer-search">
          <input
            aria-label="Find a farmer by name"
            type="search"
            value={query}
            placeholder="Find a farmer by name"
            maxLength={32}
            autoComplete="off"
            autoCapitalize="none"
            spellcheck={false}
            enterKeyHint="search"
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      {error && <p class="error-text">Could not load the farmers: {error}</p>}
      {!data && !error && <p class="muted">Looking for farmers...</p>}
      {data && farmers.length === 0 && !searching && (
        <p class="muted farmers-empty">
          {q ? `No garden name starts with "${q}".` : 'No other farmers yet. Share your profile card to invite a friend!'}
        </p>
      )}
      {farmers.length > 0 && (
        <ul class={`list farmer-list${searching ? ' loading' : ''}`} aria-label={q ? `Farmers whose name starts with ${q}` : 'Farmers to visit'}>
          {farmers.map((f) => (
            <li key={f.name} class="farmer-row">
              <Avatar id={f.avatar} size={32} />
              <span class="grow farmer-main">
                <b class="farmer-name">{f.name}</b>
                <span class="farmer-meta">
                  {f.title} · {f.trees} tree{f.trees === 1 ? '' : 's'}
                </span>
                <span class="farmer-tags">
                  {f.thirsty > 0 && (
                    <span class="tag tag-thirsty">
                      <Sprite name="droplet" scale={1} /> {f.thirsty} thirsty
                    </span>
                  )}
                  {f.helpedYou && <span class="tag tag-helped">Helped you</span>}
                  {f.judge && <span class="tag tag-judge">Judge garden</span>}
                </span>
              </span>
              <button class="btn btn-small btn-mint" onClick={() => (playSound('click'), onVisit(f.name))}>
                Visit
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** My state, shown as the friend's garden: their name, title, trees; no TaniBot, tutorial or tour. */
function visitState(mine: GameState, g: PublicGarden): GameState {
  return {
    ...mine,
    player: { ...mine.player, name: g.name, accountId: g.accountId, avatar: g.avatar, title: g.title, tanibot: null },
    tutorial: null,
    judgeTour: null,
    plots: g.plots.map((p) => ({
      plot: p.plot,
      locked: p.locked,
      tree: p.tree && {
        ...p.tree,
        id: Number(p.tree.tokenId ?? p.plot),
        // The scene shows "Thirsty" for a tree a visitor can water, "Watered" for the others.
        isWatered: !p.tree.needsWater,
        wateredToday: !p.tree.needsWater,
        waterNeed: 1,
        isFertilized: false,
        fertMsLeft: 0,
        fertSpeed: 1,
        nextHarvestOdds: { common: 0, rare: 0, gold: 0 },
        msToReady: 0,
        ageDays: 0,
      },
      memorial: p.memorial && { ...p.memorial, id: p.plot, maxHarvests: p.memorial.harvestCount, plantedAt: 0, diedAt: null, plot: p.plot },
    })),
  } as GameState;
}

/**
 * Visiting a friend's garden (read only): their trees in our village, a clear "Back to my garden"
 * button and, on a thirsty tree, "Help water" (once per village day).
 */
export function VisitGarden({
  name,
  mine,
  elapsed,
  big,
  immersive,
  onBack,
  onState,
  notify,
  onDuel,
  duelBusy = false,
}: {
  name: string;
  mine: GameState;
  elapsed: number;
  big: boolean;
  immersive?: Immersive;
  onBack: () => void;
  onState: (s: GameState) => void;
  notify: Notify;
  /** Arena (servers with `state.arena`): challenge this garden. */
  onDuel?: (name: string) => void;
  duelBusy?: boolean;
}) {
  const [visit, setVisit] = useState<VisitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fx, setFx] = useState<SceneFx | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  // The next sticker's time, fixed when the server's answer arrives (one countdown per visit).
  const [readyAt, setReadyAt] = useState(0);
  const takeVisit = (v: VisitResponse) => {
    setVisit(v);
    setReadyAt(stickerReadyAt(v.stickerWaitMs, Date.now()));
  };
  const stickerStatus = useStickerStatus(visit, readyAt);

  useEffect(() => {
    let alive = true;
    setVisit(null);
    setError(null);
    api<VisitResponse>('GET', `/api/farmers/${encodeURIComponent(name)}`)
      .then((v) => {
        if (!alive) return;
        takeVisit(v);
        // Start on the first thirsty tree (or the first tree).
        const first = v.garden.plots.findIndex((p) => p.tree?.needsWater);
        setSelected(first >= 0 ? first : Math.max(0, v.garden.plots.findIndex((p) => p.tree)));
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [name]);

  // Arena: can this garden be challenged today? (asked again after each duel: `left` changes)
  const arenaLeft = mine.arena?.left;
  const [can, setCan] = useState<ArenaCan | null>(null);
  useEffect(() => {
    if (!onDuel || arenaLeft === undefined) return;
    let alive = true;
    api<ArenaCan>('GET', `/api/arena/can/${encodeURIComponent(name)}`)
      .then((c) => alive && setCan(c))
      .catch(() => alive && setCan(null));
    return () => {
      alive = false;
    };
  }, [name, arenaLeft]);

  const help = async (plot: number) => {
    if (busy || !visit) return;
    setBusy(true);
    playSound('water');
    const tree = visitState(mine, visit.garden).plots[plot].tree;
    setFx({ id: Date.now(), kind: 'water', plot, tree });
    window.setTimeout(() => setFx(null), 1700);
    try {
      const r = await api<{ result: HelpResult; state: GameState; visit: VisitResponse }>('POST', `/api/farmers/${encodeURIComponent(name)}/water`, { plot });
      takeVisit(r.visit);
      onState(r.state);
      if (r.result.helperXp) floatText(`+${r.result.helperXp} XP`, 'xp');
      notify({
        kind: 'success',
        text: `You watered ${r.result.owner}'s ${SPECIES_NAME[r.result.species]}.${r.result.helperXp ? ` +${r.result.helperXp} XP for you` : ' No XP yet: your garden is less than a day old'}${r.result.ownerXp ? `, +${r.result.ownerXp} XP for ${r.result.owner}.` : '.'}`,
      });
    } catch (e) {
      setFx(null);
      playSound('error');
      notify({ kind: 'error', text: errorText(e) });
      // The tree may have been watered meanwhile: show the garden as it is now.
      void api<VisitResponse>('GET', `/api/farmers/${encodeURIComponent(name)}`).then(takeVisit).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const back = () => (playSound('click'), onBack());
  // While their garden loads: the village with empty plots (never our own trees under their name).
  const state = visitState(
    mine,
    visit?.garden ?? {
      name,
      accountId: '',
      avatar: 'farmer_hat',
      title: '',
      demo: false,
      weather: { kind: 'clear', waterNeed: 1 },
      plots: mine.plots.map((p) => ({ plot: p.plot, locked: false, tree: null, memorial: null })),
    },
  );
  const g = visit?.garden;
  // Their TaniBot (servers before 2026-11-10 send no `tanibot`: none is shown).
  const visitBot = g?.tanibot ? { on: g.tanibot.on, owner: g.name } : null;
  const panel = (
    <VisitPanel
      name={name}
      visit={visit}
      error={error}
      selected={selected}
      busy={busy}
      onHelp={help}
      onBack={back}
      onSticker={() => (playSound('click'), setStickerOpen(true))}
      sticker={stickerStatus}
      bar={!!immersive}
      duel={onDuel && arenaLeft !== undefined && !visit?.own ? { ...duelButton(can), busy: duelBusy, onClick: () => onDuel(name) } : null}
    />
  );
  const stickers = stickerOpen && visit && (
    <StickerWindow name={visit.garden.name} visit={visit} status={stickerStatus} onClose={() => setStickerOpen(false)} onSent={takeVisit} notify={notify} />
  );

  if (immersive) {
    return (
      <>
        {/* No sign in the sky (phones and laptops): the visit panel names the garden and its title in full. */}
        <GardenScene state={state} selected={selected} onSelect={setSelected} elapsed={elapsed} fx={fx} big={big} immersive={immersive} visit visitBot={visitBot} />
        <div class="hud-bar visit-bar" role="region" aria-label={`Visiting ${name}'s garden`}>
          {panel}
        </div>
        {stickers}
      </>
    );
  }
  return (
    <>
      <PhoneGarden state={state} selected={selected} onSelect={setSelected} elapsed={elapsed} fx={fx} big={big} sheet={panel} hint={false} visit visitBot={visitBot} />
      {stickers}
    </>
  );
}

/** The visit panel: whose garden, Back to my garden, the selected tree and Help water. */
function VisitPanel({
  name,
  visit,
  error,
  selected,
  busy,
  onHelp,
  onBack,
  onSticker,
  sticker: st,
  bar,
  duel,
}: {
  name: string;
  visit: VisitResponse | null;
  error: string | null;
  selected: number;
  busy: boolean;
  onHelp: (plot: number) => void;
  onBack: () => void;
  onSticker: () => void;
  sticker: StickerStatus;
  bar: boolean;
  /** Arena: the Duel button (null = no Arena on this server, or your own garden). */
  duel: { label: string; enabled: boolean; title: string; busy: boolean; onClick: () => void } | null;
}) {
  const g = visit?.garden;
  const p = g?.plots[selected];
  const t = p?.tree;
  // "Sticker" / "Sticker 1/3" / "Wait 4 s" / "Sent 3/3 today" (older servers: 1 a day, "Sent").
  const stickerLabel = stickerButtonLabel(st.sent.length, st.max, st.waitS);
  let body;
  if (error) body = <p class="error-text">Could not open {name}'s garden: {error}</p>;
  else if (!g || !p) body = <p class="muted">Walking over to {name}'s garden...</p>;
  else if (p.locked) body = <p class="visit-line">Plot {selected + 1} is still locked.</p>;
  else if (!t)
    body = (
      <p class="visit-line">
        Plot {selected + 1}: {p.memorial ? `a Memorial ${SPECIES_NAME[p.memorial.species]} tree stands here.` : 'empty.'}
      </p>
    );
  else {
    const what = `${QUALITY_NAME[t.quality]} ${SPECIES_NAME[t.species]}`;
    const done = visit!.helpedToday;
    const xp = visit!.help.helperXp;
    body = (
      <>
        <p class="visit-line">
          Plot {selected + 1}: <b>{what}</b> · {t.ready ? 'ripe' : t.stage === 'old' ? 'old tree' : `${t.growthPercent}% grown`}
          {t.needsWater ? ' · thirsty' : ''}
        </p>
        {visit!.own ? (
          <p class="muted small">This is your own garden.</p>
        ) : done && done.name === g.name && done.plot === selected ? (
          <p class="visit-note">You watered this tree today. Thanks, neighbour!</p>
        ) : done ? (
          <p class="visit-note">You already helped {done.name} today (one tree a day). Come back tomorrow!</p>
        ) : t.needsWater ? (
          <button class="btn btn-cyan visit-help" disabled={busy} onClick={() => onHelp(selected)}>
            <Sprite name="droplet" scale={2} /> {busy ? 'Watering...' : `Help water${xp ? ` (+${xp} XP)` : ''}`}
          </button>
        ) : (
          <p class="visit-note">This tree has water. {g.plots.some((x) => x.tree?.needsWater) ? 'Tap a thirsty tree.' : 'No thirsty tree here right now.'}</p>
        )}
      </>
    );
  }

  return (
    <section class={`panel visit-panel${bar ? ' bar' : ' plot-sheet'}`} aria-label={`Visiting ${name}'s garden`}>
      <header class="visit-head">
        {g && <Avatar id={g.avatar} size={bar ? 32 : 28} />}
        <span class="visit-title">
          <span class="visit-kicker">Visiting</span>
          <b>{name}'s garden</b>
          {g && <span class="visit-sub">{g.title}</span>}
        </span>
        {/* Stickers (servers without them send no `stickers`: no button). */}
        {visit?.stickers && !visit.own && (
          <button
            class={`btn btn-gold visit-sticker${st.full ? ' sent' : ''}${st.waitS > 0 ? ' waiting' : ''}`}
            onClick={onSticker}
            disabled={st.full || st.waitS > 0}
            aria-label={st.full ? `${stickerLabel}: come back tomorrow` : st.waitS > 0 ? `Next sticker in ${st.waitS} seconds` : `Leave a sticker for ${name}`}
            title={st.full ? 'Come back tomorrow' : 'Leave a sticker'}
          >
            <UiIcon name={st.full ? 'check' : 'sticker'} />
            <span class="visit-sticker-label">{stickerLabel}</span>
          </button>
        )}
        {duel && (
          <button class="btn visit-duel" onClick={duel.onClick} disabled={!duel.enabled || duel.busy} title={duel.title} aria-label={duel.enabled ? `Challenge ${name} in the Arena` : duel.title}>
            {duel.label === 'Dueled' ? <UiIcon name="check" /> : <Sprite name="sparkle" scale={2} />}
            <span>{duel.busy ? 'Dueling...' : duel.label}</span>
          </button>
        )}
        <button class="btn btn-mint visit-back" onClick={onBack} aria-label="Back to my garden">
          <span class="visit-back-long">← Back to my garden</span>
          <span class="visit-back-short">← My garden</span>
        </button>
      </header>
      {body}
    </section>
  );
}
