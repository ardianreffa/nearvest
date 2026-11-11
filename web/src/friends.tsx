// Garden visits (docs/PLAN-social.md): the farmer list ("Farmers of Tandur", from the Friends pin
// or the Village tab), visiting a friend's garden (read only, the same village scene with their
// trees; the visit panel names the garden; their TaniBot as decoration: floating when ON, asleep when
// OFF, a tap says hello) and helping water one thirsty tree per village day. The server checks
// every rule (server/src/social.ts); visitors only get public data (TaniBot: ON / OFF only).
// "Sticker" leaves one of 6 template stickers (invite.tsx StickerWindow, 3 per garden per day, 5 s
// apart: only the button counts down, from the server's time). Search finds any ready garden by the start of its name.

import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { duelButton } from './arena-play';
import { api, type ArenaCan, type FarmerRow, type FarmersResponse, type GameState, type HelpResult, type MyFriends, type PublicGarden, type VisitResponse } from './api';
import { addFriendBlocked, friendButtonLabel, othersAfterFriends } from './friends-logic';
import { OnlineAvatar, OnlineTag } from './online';
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
 * a search by name (any ready garden whose name starts with it; judge gardens only when linked
 * to you by a friendship, either way). Only the
 * list scrolls (one scroll area: iPhone Safari drew rows over each other with two).
 */
export function FarmersWindow({
  onClose,
  onVisit,
  onDuel,
  liveDuel = false,
  onState,
  notify,
  onInvite,
}: {
  onClose: () => void;
  onVisit: (name: string) => void;
  /** Opens the "Invite a friend" window (servers with referral, own garden; not while visiting). */
  onInvite?: () => void;
  /** Arena (servers with `state.arena`): challenge a friend from the Friends section. */
  onDuel?: (name: string) => void;
  /** The online duel is switched on: Duel on an online farmer sends a live invite (a mint dot on the button). */
  liveDuel?: boolean;
  onState?: (s: GameState) => void;
  notify?: Notify;
}) {
  const [data, setData] = useState<FarmersResponse | null>(null);
  const [friendBusy, setFriendBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
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

  // Servers from 2026-11-11 on send `friends` (+ `online` per row); older ones: the list as before.
  const hasFriends = !!data?.friends;
  const friends = q ? [] : (data?.friends ?? []);
  const farmers = othersAfterFriends(data?.farmers ?? [], friends);
  const blocked = addFriendBlocked(data?.myFriends);

  /** Add or remove a friend, then show the list as the server has it now. */
  const setFriend = async (name: string, add: boolean) => {
    if (friendBusy) return;
    setFriendBusy(name);
    try {
      const r = await friendCall(name, add);
      onState?.(r.state);
      playSound('click');
      notify?.({ kind: 'success', text: add ? `${name} is now your friend.` : `${name} was removed from your friends.` });
      const d = await api<FarmersResponse>('GET', q ? `/api/farmers?q=${encodeURIComponent(q)}` : '/api/farmers');
      setData(d);
    } catch (e) {
      playSound('error');
      notify?.({ kind: 'error', text: errorText(e) });
    } finally {
      setFriendBusy(null);
    }
  };

  const row = (f: FarmerRow, isFriendRow: boolean) => (
    <li key={f.name} class={`farmer-row${isFriendRow ? ' friend-row' : ''}`}>
      <OnlineAvatar id={f.avatar} size={32} online={!!f.online} />
      <span class="grow farmer-main">
        <b class="farmer-name">{f.name}</b>
        <span class="farmer-meta">
          {f.title} · {f.trees} tree{f.trees === 1 ? '' : 's'}
        </span>
        <span class="farmer-tags">
          {f.online && <OnlineTag />}
          {f.thirsty > 0 && (
            <span class="tag tag-thirsty">
              <Sprite name="droplet" scale={1} /> {f.thirsty} thirsty
            </span>
          )}
          {f.helpedYou && <span class="tag tag-helped">Helped you</span>}
          {f.judge && <span class="tag tag-judge">Judge garden</span>}
          {hasFriends && f.friend && (
            <button
              class="tag tag-friend"
              onClick={() => (playSound('click'), setRemoving(f.name))}
              aria-label={`${f.name} is your friend. Remove friend?`}
              title="Remove friend"
            >
              {friendButtonLabel(true, friendBusy === f.name)}
              {friendBusy !== f.name && <UiIcon name="check" />}
            </button>
          )}
        </span>
      </span>
      <span class="farmer-actions">
        {hasFriends && !f.friend && (
          <button
            class="btn btn-small farmer-add"
            disabled={!!friendBusy || !!blocked}
            title={blocked ?? `Add ${f.name} as a friend`}
            aria-label={`Add ${f.name} as a friend`}
            onClick={() => setFriend(f.name, true)}
          >
            <UiIcon name="friendAdd" />
            <span>{friendBusy === f.name ? '...' : 'Add'}</span>
          </button>
        )}
        <button class="btn btn-small btn-mint" onClick={() => (playSound('click'), onVisit(f.name))} aria-label={`Visit ${f.name}'s garden`}>
          Visit
        </button>
        {isFriendRow && onDuel && (
          <button
            class="btn btn-small farmer-duel"
            disabled={f.trees === 0}
            title={f.trees === 0 ? 'No tree to duel yet' : liveDuel && f.online && !f.judge ? `Challenge ${f.name} live (online now)` : `Challenge ${f.name}`}
            onClick={() => (onClose(), onDuel(f.name))}
          >
            {liveDuel && f.online && !f.judge && <span class="online-dot inline" aria-hidden="true" />}
            Duel
          </button>
        )}
      </span>
    </li>
  );

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
      {data && farmers.length === 0 && friends.length === 0 && !searching && (
        <p class="muted farmers-empty">
          {q ? `No garden name starts with "${q}".` : 'No other farmers yet. Share your profile card to invite a friend!'}
        </p>
      )}
      {(farmers.length > 0 || friends.length > 0) && (
        // One scroll area for both sections (iPhone Safari drew rows over each other with two).
        <div class={`farmer-list farmer-sections${searching ? ' loading' : ''}`}>
          {friends.length > 0 && (
            <>
              <h3 class="farmer-section-title">
                Friends ({friends.length}){data?.myFriends ? <span class="farmer-section-max"> / {data.myFriends.max}</span> : null}
              </h3>
              <ul class="list farmer-sublist" aria-label="Your friends">
                {friends.map((f) => row(f, true))}
              </ul>
            </>
          )}
          {friends.length > 0 && farmers.length > 0 && <h3 class="farmer-section-title">Other farmers</h3>}
          {farmers.length > 0 && (
            <ul class="list farmer-sublist" aria-label={q ? `Farmers whose name starts with ${q}` : 'Farmers to visit'}>
              {farmers.map((f) => row(f, false))}
            </ul>
          )}
        </div>
      )}
      {onInvite && (
        // Its own section under the list (the search box only finds players).
        <section class="farmers-invite" aria-label="Invite new farmers">
          <h3 class="farmer-section-title">Invite new farmers</h3>
          <div class="farmers-invite-row">
            <span class="small">Send your link: you both get PANEN after their first harvest.</span>
            <button class="btn btn-small btn-mint farmers-invite-btn" onClick={() => (playSound('click'), onInvite())}>
              Invite by link
            </button>
          </div>
        </section>
      )}
      {removing &&
        createPortal(
          <RemoveFriendWindow
            name={removing}
            onKeep={() => setRemoving(null)}
            onRemove={() => {
              const n = removing;
              setRemoving(null);
              void setFriend(n, false);
            }}
          />,
          document.body,
        )}
    </Modal>
  );
}

/** POST /api/friends/:name (add) or /remove: the result and my new state. */
export function friendCall(name: string, add: boolean) {
  return api<{ result: { friend: string; myFriends: MyFriends }; state: GameState }>('POST', `/api/friends/${encodeURIComponent(name)}${add ? '' : '/remove'}`);
}

/** "Remove budi from your friends?" (Remove / Keep). No notice goes to budi. */
export function RemoveFriendWindow({ name, onKeep, onRemove }: { name: string; onKeep: () => void; onRemove: () => void }) {
  return (
    <Modal
      title="Remove friend"
      onClose={onKeep}
      class="remove-friend-dialog"
      actions={
        <>
          <button class="btn" onClick={onKeep}>
            Keep
          </button>
          <button class="btn btn-red" onClick={onRemove}>
            Remove friend
          </button>
        </>
      }
    >
      <p>Remove {name} from your friends? They will not be told.</p>
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
  onLoaded,
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
  /** The garden loaded (or could not): the wipe between gardens opens then. */
  onLoaded?: (ok: boolean, error?: string) => void;
}) {
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;
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
  // Add friend (servers from 2026-11-11 on send `friend` with the visit).
  const [friendBusy, setFriendBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const setFriend = async (add: boolean) => {
    if (friendBusy || !visit) return;
    setFriendBusy(true);
    try {
      const r = await friendCall(name, add);
      setVisit((v) => v && { ...v, friend: add, myFriends: r.result.myFriends });
      onState(r.state);
      playSound('click');
      notify({ kind: 'success', text: add ? `${visit.garden.name} is now your friend.` : `${visit.garden.name} was removed from your friends.` });
    } catch (e) {
      playSound('error');
      notify({ kind: 'error', text: errorText(e) });
    } finally {
      setFriendBusy(false);
    }
  };

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
        loadedRef.current?.(true);
      })
      .catch((e) => {
        if (!alive) return;
        setError(errorText(e));
        loadedRef.current?.(false, errorText(e));
      });
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
      duel={
        onDuel && arenaLeft !== undefined && !visit?.own
          ? { ...duelButton(can), busy: duelBusy, live: !!mine.arena?.online && !!visit?.online && !name.startsWith('judge-'), onClick: () => onDuel(name) }
          : null
      }
      friend={
        visit && visit.friend !== undefined && !visit.own
          ? {
              isFriend: visit.friend,
              busy: friendBusy,
              blocked: visit.friend ? null : addFriendBlocked(visit.myFriends),
              onClick: () => (visit.friend ? (playSound('click'), setRemoveOpen(true)) : void setFriend(true)),
            }
          : null
      }
    />
  );
  const stickers = (
    <>
      {stickerOpen && visit && (
        <StickerWindow name={visit.garden.name} visit={visit} status={stickerStatus} onClose={() => setStickerOpen(false)} onSent={takeVisit} notify={notify} />
      )}
      {removeOpen &&
        createPortal(
          <RemoveFriendWindow
            name={visit?.garden.name ?? name}
            onKeep={() => setRemoveOpen(false)}
            onRemove={() => {
              setRemoveOpen(false);
              void setFriend(false);
            }}
          />,
          document.body,
        )}
    </>
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
  friend,
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
  /** `live`: the online duel is on and this farmer is online (Duel sends a live invite). */
  duel: { label: string; enabled: boolean; title: string; busy: boolean; live?: boolean; onClick: () => void } | null;
  /** Add friend (null = not on this server, or your own garden). Friends: tap = Remove friend? */
  friend: { isFriend: boolean; busy: boolean; blocked: string | null; onClick: () => void } | null;
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
          <span class="visit-kicker">
            Visiting{visit?.online ? <OnlineTag /> : null}
          </span>
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
            {duel.live && duel.enabled && <span class="online-dot inline" aria-label="live" />}
          </button>
        )}
        {friend && (
          <button
            class={`btn visit-friend${friend.isFriend ? ' is-friend' : ''}`}
            onClick={friend.onClick}
            disabled={friend.busy || !!friend.blocked}
            title={friend.blocked ?? (friend.isFriend ? 'Remove friend' : `Add ${name} as a friend`)}
            aria-label={friend.isFriend ? `${name} is your friend. Remove friend?` : friend.blocked ?? `Add ${name} as a friend`}
          >
            {!friend.isFriend && <UiIcon name="friendAdd" />}
            <span>{friendButtonLabel(friend.isFriend, friend.busy)}</span>
            {friend.isFriend && !friend.busy && <UiIcon name="check" />}
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
