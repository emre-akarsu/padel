/* Optional lab features + cost panel. Everything here is OFF by default and wrapped so it can never break the app.
 *  u04: live joint metrics from the vendored U04 library (vendor/metrics.js), shown for checks the release gate lets us show.
 *  u21: coach cue from the vendored U21 library (vendor/cues_padel.json), shown only for checks whose gate.fault is true.
 * The panel shows measured cost per feature (ms added per processed frame, fps with / without) and logs a console summary. */
(function () {
  'use strict';
  const KEY = 'padel.features', FEATS = [['u04', 'U04 live metrics (metrics.js)'], ['u21', 'U21 coach cue (needs release gate)']];
  const ld = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const sv = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: P.on, lang: P.lang })); } catch { } };
  const saved = ld();
  const P = window.PadelFeat = {
    on: Object.assign({ u04: false, u21: false }, saved.on), lang: saved.lang || 'auto', // auto = browser language
    cost: {}, fps: {}, buf: [], metricsMod: null, cues: null, live: {}, lastCue: null
  };
  FEATS.forEach(([k]) => { P.cost[k] = { ms: 0, n: 0 }; P.fps[k] = { w: { n: 0, s: 0 }, wo: { n: 0, s: 0 } }; });
  P.fps.base = { n: 0, s: 0 };
  const BUF_N = 90;

  /* ---------- U21 cue lookup (vendored cue data, same API shape as speclink.cue_library.cue) ---------- */
  const SHOT_TO_CUE = { forehand: 'forehand_drive', backhand: 'backhand_drive', volley_fh: 'forehand_volley', volley_bh: 'backhand_volley', lob: 'globo' };
  // app check id -> { U04 metric, U21 metric id }
  const CHECK_MAP = { elbow_contact: { u04: h => h === 'left' ? 'elbow_l' : 'elbow_r', cue: 'elbow_r' }, knee_load: { u04: () => 'knee_flex_load_deg', cue: 'knee_max' } };
  P.resolveLang = (l = P.lang) => l === 'es' || l === 'en' ? l : (/^es/i.test(navigator.language || '') ? 'es' : 'en');
  /** cue(data, checkId, direction, level, lang): exact U21 key, e.g. padel/bandeja:contact:elbow_r. */
  P.cue = function (data, key, direction, level, lang) {
    if (direction !== 'low' && direction !== 'high') throw new Error('direction must be low or high');
    if (!['beginner', 'club', 'advanced'].includes(level)) throw new Error('level must be beginner, club, or advanced');
    if (lang !== 'en' && lang !== 'es') throw new Error('lang must be en or es');
    return data.cues[key][direction][level][lang];
  };
  /** findCue: app shot + U21 metric id -> first matching stage key (contact preferred). Returns text or null. */
  P.findCue = function (data, shot, metric, direction, level = 'club', lang = 'en') {
    const sh = 'padel/' + (SHOT_TO_CUE[shot] || shot) + ':', ks = Object.keys(data.cues).filter(k => k.startsWith(sh) && k.endsWith(':' + metric));
    if (!ks.length) return null;
    ks.sort((a, b) => (b.includes(':contact:') ? 1 : 0) - (a.includes(':contact:') ? 1 : 0));
    return P.cue(data, ks[0], direction, level, lang);
  };

  /* ---------- lazy loading (only when a feature is switched on) ---------- */
  P.ensure = function () {
    if (P.on.u04 || P.on.u21) P.metricsP = P.metricsP || import('./vendor/metrics.js').then(m => (P.metricsMod = m)).catch(e => console.warn('metrics.js', e));
    if (P.on.u21) P.cuesP = P.cuesP || fetch('vendor/cues_padel.json').then(r => r.json()).then(d => (P.cues = d)).catch(e => console.warn('cues', e));
  };

  /* ---------- per-frame work ---------- */
  const COCO = 17, mk = kp => { const a = new Float32Array(COCO * 2); for (let j = 0; j < COCO; j++) { const p = kp[j]; const ok = p && (p[2] === undefined || p[2] >= .2); a[j * 2] = ok ? p[0] : NaN; a[j * 2 + 1] = ok ? p[1] : NaN; } return a; };
  const timed = (k, fn) => { const t0 = performance.now(); try { return fn(); } finally { const c = P.cost[k]; c.ms += performance.now() - t0; } };
  const tail = (win, f) => { const T = win.length, a = new Float32Array(T * COCO * 2); win.forEach((e, i) => a.set(e.a, i * COCO * 2)); return f(a, T); };

  P.frame = function (r, t, ctx) {
    const now = performance.now();
    // fps bookkeeping: delta between processed frames; gaps over 1 s (paused, tab hidden) are skipped
    if (P.lastT && now - P.lastT < 1000) {
      const dt = P.lastDt = now - P.lastT, any = P.on.u04 || P.on.u21;
      if (!any) { P.fps.base.n++; P.fps.base.s += dt; }
      FEATS.forEach(([k]) => { const b = P.on[k] ? P.fps[k].w : P.fps[k].wo; b.n++; b.s += dt; });
    }
    P.lastT = now;
    FEATS.forEach(([k]) => { if (P.on[k]) P.cost[k].n++; });
    if (!(P.on.u04 || P.on.u21) || !r || !r.skeleton) return;
    const owner = P.on.u04 ? 'u04' : 'u21';
    timed(owner, () => { P.buf.push({ t, a: mk(r.skeleton) }); if (P.buf.length > BUF_N) P.buf.shift(); });
    if (P.on.u04 && P.metricsMod && P.buf.length >= 2) timed('u04', () => {
      const M = P.metricsMod, win = P.buf.slice(-24), live = {};
      for (const c of ctx.REL.checks) {
        const m = CHECK_MAP[c.id]; if (!m || !ctx.gate(c.id).show) continue; // numbers only for released checks
        const name = m.u04(ctx.S.hand), v = tail(win, (a, T) => M.compute(a, T, COCO, 'coco17', 30, [name]))[name];
        live[c.id] = { metric: name, value: v[v.length - 1], unit: ctx.gate(c.id).def.unit };
      }
      P.live = live;
    });
    if (now - (P.lastSum || 0) > 10000) { P.lastSum = now; if (P.on.u04 || P.on.u21) P.summary(); }
    P.render();
  };

  // a stroke finished: evaluate released fault checks with U04 metrics at contact and pick the U21 cue
  P.stroke = function (s, ctx) {
    if (!P.on.u21 || !P.metricsMod || !P.cues || !P.buf.length) return;
    timed('u21', () => {
      const M = P.metricsMod, lang = P.resolveLang(), out = [];
      const win = P.buf.filter(e => e.t >= s.tStart - .1 && e.t <= s.tContact + .05);
      if (win.length < 2) return;
      for (const c of ctx.REL.checks) {
        const m = CHECK_MAP[c.id], g = m && ctx.gate(c.id);
        if (!g || !g.fault) continue; // error cue stays hidden unless the release gate releases this check
        const name = m.u04(ctx.S.hand), v = tail(win, (a, T) => M.compute(a, T, COCO, 'coco17', 30, [name]))[name];
        const val = name === 'knee_flex_load_deg' ? v[0] : v[v.length - 1], band = ctx.band(c.id, ctx.S.shot);
        if (!Number.isFinite(val) || !band || (val >= band[0] && val <= band[1])) continue;
        const txt = P.findCue(P.cues, ctx.S.shot, m.cue, val < band[0] ? 'low' : 'high', 'club', lang);
        if (txt) out.push({ id: c.id, value: val, text: txt });
      }
      if (out.length) { P.lastCue = out[0]; P.showCue(out[0].text); }
    });
  };
  P.showCue = function (text) {
    let el = document.getElementById('u21cue');
    if (!el) { el = document.createElement('div'); el.id = 'u21cue'; el.setAttribute('role', 'status'); el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:60;background:#d8ea3a;color:#111;font-weight:700;padding:8px 14px;border-radius:10px;max-width:90vw'; document.body.appendChild(el); }
    el.textContent = text; el.hidden = false; clearTimeout(P._ct); P._ct = setTimeout(() => { el.hidden = true; }, 4000);
  };

  /* ---------- stats ---------- */
  const fpsOf = b => b.s > 0 ? b.n * 1000 / b.s : null, f1 = v => v == null ? '-' : v.toFixed(v < 10 ? 2 : 1);
  P.stats = function () {
    const rows = [{ name: 'baseline (all off)', on: !(P.on.u04 || P.on.u21), ms: 0, fpsWith: fpsOf(P.fps.base), fpsWithout: null }];
    FEATS.forEach(([k, n]) => rows.push({ name: n, key: k, on: P.on[k], frames: P.cost[k].n, ms: P.cost[k].n ? P.cost[k].ms / P.cost[k].n : null, fpsWith: fpsOf(P.fps[k].w), fpsWithout: fpsOf(P.fps[k].wo) }));
    return rows;
  };
  P.summary = function () { try { console.table ? console.log('[padel-feat] ' + JSON.stringify(P.stats().map(r => ({ f: r.name, ms: r.ms == null ? null : +r.ms.toFixed(3), fpsWith: r.fpsWith && +r.fpsWith.toFixed(1), fpsWithout: r.fpsWithout && +r.fpsWithout.toFixed(1) })))) : 0; } catch { } };

  /* ---------- panel ---------- */
  function build() {
    if (document.getElementById('featBtn')) return;
    const css = document.createElement('style');
    css.textContent = '#featBtn{position:fixed;left:8px;bottom:8px;z-index:70;min-width:44px;min-height:44px;border-radius:22px;border:1px solid #888;background:#222;color:#fff;font-size:18px;opacity:.85}' +
      '#featPanel{position:fixed;left:8px;bottom:60px;z-index:70;width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 80px);overflow:auto;background:#1b1b1b;color:#eee;border:1px solid #555;border-radius:10px;padding:10px;font-size:13px}' +
      '#featPanel table{width:100%;border-collapse:collapse}#featPanel td,#featPanel th{padding:4px 2px;text-align:left}#featPanel label{display:flex;gap:6px;align-items:center;min-height:32px}';
    document.head.appendChild(css);
    const b = document.createElement('button'); b.id = 'featBtn'; b.type = 'button'; b.textContent = '⚙'; b.setAttribute('aria-label', 'Lab features and cost'); document.body.appendChild(b);
    const p = document.createElement('div'); p.id = 'featPanel'; p.hidden = true;
    p.innerHTML = '<b>Lab features</b> <span class="muted small">(off by default)</span>' +
      '<div style="margin:6px 0">Cue language <select id="featLang"><option value="auto">auto</option><option value="en">English</option><option value="es">Español</option></select></div>' +
      '<table><thead><tr><th>Feature</th><th>ms/frame</th><th>fps with</th><th>fps w/o</th></tr></thead><tbody id="featRows"></tbody></table>' +
      '<div id="featLive" class="small" style="margin-top:6px"></div><div class="small" id="featFps" style="margin-top:6px">fps: -</div>';
    document.body.appendChild(p);
    b.onclick = () => { p.hidden = !p.hidden; if (!p.hidden) P.render(true); };
    p.querySelector('#featLang').value = P.lang;
    p.querySelector('#featLang').onchange = e => { P.lang = e.target.value; sv(); };
    p.querySelector('#featRows').addEventListener('change', e => {
      const k = e.target.dataset.feat; if (!k) return; P.on[k] = e.target.checked; sv(); P.ensure(); P.buf.length = 0; P.live = {}; P.summary(); P.render(true);
    });
    P.render(true);
  }
  let lastR = 0;
  P.render = function (force) {
    const p = document.getElementById('featPanel'); if (!p || p.hidden) return;
    const now = performance.now(); if (!force && now - lastR < 500) return; lastR = now;
    const rows = P.stats(), tb = p.querySelector('#featRows');
    // never rebuild while a row is being clicked: only rewrite the numbers once the checkboxes exist
    if (!tb.children.length) tb.innerHTML = '<tr id="featBase"><td>Baseline (all off)</td><td>0</td><td class="v"></td><td>-</td></tr>' +
      FEATS.map(([k, n]) => `<tr><td><label><input type="checkbox" data-feat="${k}"> ${n}</label></td><td class="m"></td><td class="w"></td><td class="o"></td></tr>`).join('');
    const base = tb.querySelector('#featBase'); base.children[2].textContent = f1(rows[0].fpsWith);
    FEATS.forEach(([k], i) => { const tr = tb.children[i + 1], r = rows[i + 1]; tr.querySelector('input').checked = !!P.on[k]; tr.querySelector('.m').textContent = f1(r.ms); tr.querySelector('.w').textContent = f1(r.fpsWith); tr.querySelector('.o').textContent = f1(r.fpsWithout); });
    p.querySelector('#featFps').textContent = 'fps now: ' + (P.lastDt ? f1(1000 / P.lastDt) : f1(fpsOf(P.fps.base) || fpsOf(P.fps.u04.w) || fpsOf(P.fps.u21.w)));
    p.querySelector('#featLive').textContent = Object.entries(P.live).map(([id, v]) => `${id}: ${Number.isFinite(v.value) ? v.value.toFixed(v.unit === 'deg' ? 0 : 2) : '-'} ${v.unit}`).join(' · ');
  };

  P.ensure();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
