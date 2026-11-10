// Garden visits (docs/PLAN-social.md): the farmer list ("Farmers of Tandur", from the Friends pin
// or the Village tab), visiting a friend's garden (read only, the same village scene with their
// trees; the visit panel names the garden; their TaniBot as decoration: floating when ON, asleep when
// OFF, a tap says hello) and helping water one thirsty tree per village day. The server checks
// every rule (server/src/social.ts); visitors only get public data (TaniBot: ON / OFF only).
// "Sticker" leaves one of 6 template stickers (invite.tsx StickerWindow, 1 per garden per day).

import { useEffect, useState } from 'preact/hooks';
import { api, type FarmersResponse, type GameState, type HelpResult, type PublicGarden, type VisitResponse } from './api';
import { Avatar } from './art/avatars';
import { playSound } from './audio';
import { floatText } from './fx';
import { PhoneGarden } from './garden';
import { Modal } from './help';
import type { Immersive } from './layout';
import { StickerIcon, StickerWindow } from './invite';
import { GardenScene, type SceneFx } from './scene';
import { Sprite } from './sprites';
import type { Toast } from './toast';
import { QUALITY_NAME, SPECIES_NAME } from './ui';

type Notify = (t: Omit<Toast, 'id'>) => void;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Farmers of Tandur": who to visit (helped you / thirsty first), one Visit button per farmer. */
export function FarmersWindow({ onClose, onVisit }: { onClose: () => void; onVisit: (name: string) => void }) {
  const [data, setData] = useState<FarmersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<FarmersResponse>('GET', '/api/farmers')
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Modal title="Farmers of Tandur" onClose={onClose} closeLabel="Close" class="farmers-dialog">
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
      {error && <p class="error-text">Could not load the farmers: {error}</p>}
      {!data && !error && <p class="muted">Looking for farmers...</p>}
      {data && data.farmers.length === 0 && <p class="muted">No other farmers yet. Share your profile card to invite a friend!</p>}
      {data && data.farmers.length > 0 && (
        <ul class="list farmer-list">
          {data.farmers.map((f) => (
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
}: {
  name: string;
  mine: GameState;
  elapsed: number;
  big: boolean;
  immersive?: Immersive;
  onBack: () => void;
  onState: (s: GameState) => void;
  notify: Notify;
}) {
  const [visit, setVisit] = useState<VisitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fx, setFx] = useState<SceneFx | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setVisit(null);
    setError(null);
    api<VisitResponse>('GET', `/api/farmers/${encodeURIComponent(name)}`)
      .then((v) => {
        if (!alive) return;
        setVisit(v);
        // Start on the first thirsty tree (or the first tree).
        const first = v.garden.plots.findIndex((p) => p.tree?.needsWater);
        setSelected(first >= 0 ? first : Math.max(0, v.garden.plots.findIndex((p) => p.tree)));
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [name]);

  const help = async (plot: number) => {
    if (busy || !visit) return;
    setBusy(true);
    playSound('water');
    const tree = visitState(mine, visit.garden).plots[plot].tree;
    setFx({ id: Date.now(), kind: 'water', plot, tree });
    window.setTimeout(() => setFx(null), 1700);
    try {
      const r = await api<{ result: HelpResult; state: GameState; visit: VisitResponse }>('POST', `/api/farmers/${encodeURIComponent(name)}/water`, { plot });
      setVisit(r.visit);
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
      void api<VisitResponse>('GET', `/api/farmers/${encodeURIComponent(name)}`).then(setVisit).catch(() => undefined);
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
      bar={!!immersive}
    />
  );
  const stickers = stickerOpen && visit && (
    <StickerWindow name={visit.garden.name} visit={visit} onClose={() => setStickerOpen(false)} onSent={setVisit} notify={notify} />
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
  bar,
}: {
  name: string;
  visit: VisitResponse | null;
  error: string | null;
  selected: number;
  busy: boolean;
  onHelp: (plot: number) => void;
  onBack: () => void;
  onSticker: () => void;
  bar: boolean;
}) {
  const g = visit?.garden;
  const p = g?.plots[selected];
  const t = p?.tree;
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
            class={`btn btn-gold visit-sticker${visit.stickerToday ? ' sent' : ''}`}
            onClick={onSticker}
            disabled={!!visit.stickerToday}
            aria-label={visit.stickerToday ? 'Sticker sent today' : `Leave a sticker for ${name}`}
            title={visit.stickerToday ? 'Sticker sent today' : 'Leave a sticker'}
          >
            <StickerIcon id={visit.stickerToday ?? 'nice_garden'} />
            <span class="visit-sticker-label">{visit.stickerToday ? 'Sent' : 'Sticker'}</span>
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
