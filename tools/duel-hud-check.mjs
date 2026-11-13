// Shared browser check for the Arena duel's top bar (Ardian 2026-11-13), used by tools/ui-test.mjs
// (--match) and tools/duel-online.mjs: row 1 = the owner's name on ONE line (font steps down, never
// cut for names up to 16 characters), row 2 = "TaniBot · <title>" (TaniBot duel) or the title (online),
// both life bars and both skill bars level, and at K.O. / the result the last turn's line is whole.
// Evaluate HUD_CHECK in the page; it returns a JSON string. `ok` is false when something is wrong.
export const HUD_CHECK = `(() => {
  const d = document.querySelector('.duel.match');
  if (!d) return JSON.stringify({ ok: false, why: 'no match screen' });
  const R = (e) => e.getBoundingClientRect();
  const sides = [...d.querySelectorAll('.fighter-hud')].map((h) => {
    const o = h.querySelector('.fighter-owner, .fighter-name > b');
    const s = h.querySelector('.fighter-sub, .fighter-name > span');
    const cs = o ? getComputedStyle(o) : null;
    return {
      owner: o ? o.textContent : null,
      font: cs ? cs.fontSize : null,
      cut: o ? o.scrollWidth > o.clientWidth + 0.5 : null,
      lines: o ? Math.round(R(o).height / parseFloat(cs.lineHeight)) : null,
      sub: s ? s.textContent : null,
      subCut: s ? s.scrollWidth > s.clientWidth + 0.5 : null,
      hpTop: Math.round(R(h.querySelector('.hp-bar')).top),
      skillTop: h.querySelector('.skill-bar') ? Math.round(R(h.querySelector('.skill-bar')).top) : null,
    };
  });
  const level = sides.length === 2 && Math.abs(sides[0].hpTop - sides[1].hpTop) <= 0.5 && (sides[0].skillTop === null || Math.abs(sides[0].skillTop - sides[1].skillTop) <= 0.5);
  const why = d.querySelector('.match-info.over .match-why');
  const whyCut = why ? why.scrollHeight > why.clientHeight + 1 : null;
  const dock = d.querySelector('.match-dock-panel');
  const dockCut = dock ? dock.scrollHeight > dock.clientHeight + 1 : null;
  const longOk = sides.every((x) => !x.cut || (x.owner || '').length > 16);
  return JSON.stringify({ ok: level && longOk && sides.every((x) => x.lines === 1) && whyCut !== true && dockCut !== true, level, sides, koLine: why ? why.textContent : null, whyCut, dockCut });
})()`;
