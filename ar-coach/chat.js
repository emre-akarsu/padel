/* Coach chat: template answers over gated stroke numbers (no LLM, no network). Numbers are compared with
   target bands, never called faults; unmeasured technique gets a fixed reply. Classic script. */
'use strict';
(function () {
  const f2 = v => v == null ? '-' : (+v).toFixed(2);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function rel(v, b, u) { if (v == null || !b) return ''; if (v >= b[0] && v <= b[1]) return 'inside your band'; const d = v < b[0] ? b[0] - v : v - b[1]; return `${u === 'm' ? Math.round(d * 100) + ' cm' : d.toFixed(2) + ' s'} ${v < b[0] ? 'below' : 'above'} your band`; }
  function answer(q, c) {
    q = q.toLowerCase(); const S = c.strokes || [];
    if (!S.length) return ['No strokes yet. Run a shadow, drill or video session and ask me again.', 'template'];
    const H = s => s.metrics?.contactHeightM, T = s => s.metrics?.tempoS, shot = c.shot;
    const hb = c.band('contact_low', shot), tb = c.band('tempo', shot);
    const hs = S.map(H).filter(v => v != null), ts = S.map(T).filter(v => v != null);
    const rp = q.match(/(replay|show)\D*(\d+)/), num = q.match(/(?:stroke|#|number)\s*(\d+)|^(\d+)$/);
    if (/(show|replay).*(last|latest)/.test(q)) return c.replay && c.replay(S.length) ? [`Replaying stroke ${S.length}: you on the left, ideal on the right.`, 'template · replay'] : ['Replays are available right after a live session or in Review a video.', 'template'];
    if (rp) return c.replay && c.replay(+rp[2]) ? [`Replaying stroke ${rp[2]}: you on the left, ideal on the right.`, 'template · replay'] : ['Replays are available right after a live session or in Review a video.', 'template'];
    if (/fault|wrong|error|mistake|bad|fix/.test(q)) return ["I can't judge faults reliably yet, so I only give numbers against your target band. Your coach can review these strokes in the Coach Review Inbox.", 'template · gate'];
    if (/elbow|wrist|knee|shoulder|grip|feet|footwork|split|hip|swing path/.test(q)) return ["I can't measure that reliably yet, so I won't guess. I can tell you stroke count, tempo and contact height, or send the clips to your coach.", 'template · not measured'];
    if (/looks? good|am i good|was (it|that) good|is (it|that) good/.test(q)) return [`I only say "looks good" for checks that pass 95%, and none do yet. Numbers: ${hb ? hs.filter(v => v >= hb[0] && v <= hb[1]).length + ' of ' + hs.length + ' strokes had contact height inside ' + f2(hb[0]) + '-' + f2(hb[1]) + ' m.' : ''}`, 'template · gate'];
    if (/drill|practi[cs]e|work on|improve/.test(q)) {
      const dh = hb && hs.length ? Math.max(0, hb[0] - avg(hs), avg(hs) - hb[1]) / ((hb[1] - hb[0]) || 1) : 0;
      const dt = tb && ts.length ? Math.max(0, tb[0] - avg(ts), avg(ts) - tb[1]) / ((tb[1] - tb[0]) || 1) : 0;
      const pick = dh >= dt ? 'contact_low' : 'tempo', set = (c.drills || []).find(d => d.check === pick);
      if (!dh && !dt) return ['Your averages are inside their bands. Keep them there: repeat a ball-machine set of 15 at the same rhythm.', 'template · drill'];
      return [`${pick === 'tempo' ? 'Tempo' : 'Contact height'} is the number furthest from its band. Try the drill set "${set ? set.title : pick}" in Error-correction drills: ${set ? set.steps.map(s => s.name).join(' → ') : ''}.`, 'template · drill library'];
    }
    if (/compare|last (time|session|week)|progress|better/.test(q)) {
      const p = c.prev; if (!p || !p.length) return ['No earlier session with this shot to compare yet.', 'template · compare'];
      const a = avg(hs), b = avg(p.map(H).filter(v => v != null)), x = avg(ts), y = avg(p.map(T).filter(v => v != null));
      return [`Contact height ${f2(a)} m vs ${f2(b)} m last time (${a >= b ? 'up' : 'down'} ${Math.round(Math.abs(a - b) * 100)} cm). Tempo ${f2(x)} s vs ${f2(y)} s.`, 'template · compare'];
    }
    // stroke filters over measured numbers: low / high contact, slow / fast tempo, inside both bands
    const F = [[/below|lowest|\blow|under/, 'contact below', H, hb, v => v < hb?.[0], 'm', 'None: every measured contact was at or above your band.'],
      [/above|highest|\bhigh|over/, 'contact above', H, hb, v => v > hb?.[1], 'm', 'None: no measured contact was above your band.'],
      [/slow|longest/, 'tempo slower than', T, tb, v => v > tb?.[1], 's', 'None: no stroke was slower than your tempo band.'],
      [/fast|quick|rushed|shortest/, 'tempo faster than', T, tb, v => v < tb?.[0], 's', 'None: no stroke was faster than your tempo band.']];
    const isFilter = /which|find|list|filter|were|show me( the)? (low|high|slow|fast)/.test(q);
    for (const [re, lab, get, band, test, u, none] of F) if (re.test(q) && (isFilter || lab.startsWith('contact below'))) {
      if (!band) return ['There is no target band for this shot yet.', 'template · filter'];
      const r = S.map((s, i) => [i + 1, get(s)]).filter(x => x[1] != null && test(x[1]));
      return [r.length ? `${r.length} stroke${r.length > 1 ? "s" : ""} had ${lab} ${f2(lab.includes('below') || lab.includes('faster') ? band[0] : band[1])} ${u}: ` + r.map(x => `#${x[0]} (${f2(x[1])} ${u})`).join(', ') + '.' : none, 'template · filter'];
    }
    if (/good|best|inside|on target|in (the )?band/.test(q) && isFilter && hb && tb) {
      const r = S.map((s, i) => [i + 1, s]).filter(([, s]) => H(s) >= hb[0] && H(s) <= hb[1] && T(s) >= tb[0] && T(s) <= tb[1]).map(x => '#' + x[0]);
      return [r.length ? `${r.length} stroke${r.length > 1 ? "s" : ""} were inside both bands (contact and tempo): ${r.join(', ')}.` : 'None had both contact height and tempo inside the band.', 'template · filter'];
    }
    if (/summary|session|overall|how did|how was/.test(q) || /^(hi|hello)/.test(q)) {
      const a = avg(hs), t = avg(ts), best = hb && hs.length ? S.reduce((m, s, i) => H(s) != null && Math.abs(H(s) - (hb[0] + hb[1]) / 2) < m[1] ? [i + 1, Math.abs(H(s) - (hb[0] + hb[1]) / 2)] : m, [0, 9])[0] : null;
      return [`${S.length} strokes (${c.shotName(shot)}). Contact height average ${f2(a)} m, ${rel(a, hb, 'm')}. Tempo average ${f2(t)} s${tb ? ', ' + rel(t, tb, 's') : ''}.${best ? ' Closest to target: stroke ' + best + '.' : ''}`, 'template'];
    }
    if (num) { const n = +(num[1] || num[2]), s = S[n - 1]; if (!s) return [`There are ${S.length} strokes in this session.`, 'template'];
      return [`Stroke ${n}: contact ${f2(H(s))} m, ${rel(H(s), hb, 'm')}. Tempo ${f2(T(s))} s${tb ? ', ' + rel(T(s), tb, 's') : ''}.`, 'template · stroke']; }
    if (/tempo|fast|slow|timing|rhythm/.test(q)) return [`Tempo average ${f2(avg(ts))} s (range ${f2(Math.min(...ts))}-${f2(Math.max(...ts))} s)${tb ? ', ' + rel(avg(ts), tb, 's') : ''}.`, 'template'];
    if (/height|contact|high/.test(q)) return [`Contact height average ${f2(avg(hs))} m, ${rel(avg(hs), hb, 'm')}. ${hb ? hs.filter(v => v >= hb[0] && v <= hb[1]).length + ' of ' + hs.length + ' inside the band.' : ''}`, 'template'];
    if (/how many|count|strokes/.test(q)) return [`${S.length} strokes in this session.`, 'template'];
    return ['I can answer about this session\'s numbers: try "summary", "stroke 3", "replay 2", "which were low / high / slow / fast / on target?", "compare with last time" or "what should I practise?".', 'template · help'];
  }
  function mount(el, ctx) {
    el.innerHTML = `<h2 style="margin-top:0">Ask your coach</h2><div class="chatlog" style="max-height:260px;overflow:auto;display:grid;gap:6px;margin-bottom:8px"></div>
      <div class="chips" style="margin-bottom:8px"></div><form class="bar"><input class="grow" placeholder="Ask about this session" style="padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);min-width:0"><button class="btn primary">Ask</button></form>
      <p class="muted small">Answers come from your measured numbers only (no AI guesses). Faults wait for coach review.</p>`;
    const log = el.querySelector('.chatlog');
    const say = (who, t, src) => { const d = document.createElement('div'); d.style.cssText = `padding:8px 10px;border-radius:10px;max-width:90%;${who === 'me' ? 'justify-self:end;background:var(--accent);color:var(--accent-ink)' : 'background:var(--bg);border:1px solid var(--line)'}`; d.innerHTML = esc(t) + (src ? `<div class="muted small">${esc(src)}</div>` : ''); log.appendChild(d); log.scrollTop = log.scrollHeight; };
    const ask = q => { if (!q.trim()) return; say('me', q); const [a, s] = answer(q, ctx()); say('bot', a, s); };
    const chips = el.querySelector('.chips');
    chips.innerHTML = ['Summary', 'Stroke 1', 'Replay last', 'Which were low?', 'Which were slow?', 'Which were on target?', 'Compare with last time', 'What should I practise?', 'Is my elbow wrong?'].map(t => `<button type="button" class="chip">${t}</button>`).join('');
    chips.querySelectorAll('button').forEach(b => b.onclick = () => ask(b.textContent));
    const f = el.querySelector('form'); f.onsubmit = e => { e.preventDefault(); ask(f.querySelector('input').value); f.querySelector('input').value = ''; };
    const c = ctx(); say('bot', c.strokes?.length ? `I have ${c.strokes.length} strokes from this session. Ask me anything about the numbers.` : 'No strokes yet.', 'template');
  }
  window.PadelChat = { answer, mount };
})();
