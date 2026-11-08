/* Padel feedback widget (schema padel.feedback/1). One file, no dependencies, no accounts.
 * A page mounts it with:
 *   PadelFeedback.mount({ app: 'strike-player', build: 'engine.js?v=8',
 *     context: async () => ({ subject: {...}, moment: {...}, extra: {...} }),   // snapshot at the moment the button is pressed
 *     screenshot: () => dataURL | null,  shotDefault: true,                       // optional frame grab (opt-in box)
 *     fields: [{ id: 'side', label: 'Which one?', options: ['v8 (right)', 'v7 (left)'] }],
 *     finalize: rec => {},                                                         // adjust the record on save
 *     onOpen, onClose });                                                         // e.g. pause / resume playback
 * Every record is saved on the device first (localStorage 'padel.feedback.v1'), then POSTed to the sink.
 * Unsent records retry on the next page load. "My feedback" exports JSON or opens a prefilled GitHub issue.
 */
(function () {
  'use strict';
  if (window.PadelFeedback) return;
  const KEY = 'padel.feedback.v1', AID = 'padel.feedback.anon', MAX = 300, MAX_SHOTS_LOCAL = 15;
  const SCHEMA = 'padel.feedback/1';
  const REPO_ISSUES = 'https://github.com/emre-akarsu/padel/issues/new';
  const MODAL = 'https://emreakarsu--padel-coach-web.us-east.modal.run/api/feedback';
  const SINK = window.PADEL_FEEDBACK_URL || (/\.modal\.run$/.test(location.hostname) ? '/api/feedback' : MODAL);
  const TAGS = ['arm', 'elbow', 'wrist', 'hand / grip', 'racket face', 'racket side', 'racket path', 'legs / feet', 'trunk / hips', 'head', 'angle / camera', 'timing', 'speed / smoothness', 'ball', 'contact point', 'cue text', 'other'];
  const SEV = [['minor', 'Looks a bit off'], ['major', 'Clearly wrong'], ['broken', 'Impossible / broken']];

  const store = {
    all() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
    save(a) {
      a = a.slice(-MAX);
      let shots = 0; for (let i = a.length - 1; i >= 0; i--) if (a[i].attachments?.screenshot && ++shots > MAX_SHOTS_LOCAL) a[i].attachments.screenshot = null;
      for (let k = 0; k < 4; k++) { try { localStorage.setItem(KEY, JSON.stringify(a)); return true; } catch { a = a.slice(Math.ceil(a.length / 3)); } }
      return false;
    },
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  function anon() { try { let a = localStorage.getItem(AID); if (!a) { a = uid().slice(0, 8); localStorage.setItem(AID, a); } return a; } catch { return 'na'; } }
  async function hash(obj) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join(''); }
    catch { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return 'f' + (h >>> 0).toString(16); }
  }
  async function send(rec) {
    try {
      const r = await fetch(SINK, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(rec), mode: 'cors', keepalive: !rec.attachments?.screenshot });
      return r.ok;
    } catch { return false; }
  }
  async function flush() {
    const a = store.all(); let changed = false;
    for (const r of a) if (!r._sent && (await send(r))) { r._sent = new Date().toISOString(); changed = true; }
    if (changed) store.save(a);
    return a.filter(r => !r._sent).length;
  }
  const strip = r => { const o = JSON.parse(JSON.stringify(r)); delete o._sent; return o; };
  function issueUrl(r) {
    const o = strip(r); if (o.attachments) o.attachments.screenshot = o.attachments.screenshot ? '(screenshot kept on device)' : null;
    const s = o.subject || {}, m = o.moment || {};
    const title = `[feedback] ${s.sport || ''} ${s.stroke_name || s.stroke_id || ''} ${o.app.version || ''} @ ${m.stage_label || m.stage || ''} ${m.t_s != null ? m.t_s + ' s' : ''}`.replace(/\s+/g, ' ').trim();
    const body = `${o.feedback.text || ''}\n\nTags: ${o.feedback.tags.join(', ') || '-'} · severity: ${o.feedback.severity}\n\n<!-- padel.feedback/1 -->\n\`\`\`json\n${JSON.stringify(o, null, 1).slice(0, 5500)}\n\`\`\``;
    return `${REPO_ISSUES}?labels=feedback&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }
  function download(name, text) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const CSS = `
.pfb-btn{position:fixed;z-index:2147483000;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));font:600 14px system-ui,-apple-system,"Segoe UI",sans-serif;
 background:#14212b;color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:10px 15px;min-height:42px;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer}
.pfb-btn.tl{right:auto;left:max(14px,env(safe-area-inset-left));bottom:auto;top:max(14px,env(safe-area-inset-top))}
.pfb-btn.tr{bottom:auto;top:max(14px,env(safe-area-inset-top))}
.pfb-bg{position:fixed;inset:0;z-index:2147483001;background:rgba(5,12,18,.55);display:flex;align-items:flex-end;justify-content:center}
@media(min-width:700px){.pfb-bg{align-items:center}}
.pfb{--b:#fff;--i:#14212b;--m:#5a6b78;--l:#d3dce3;--a:#2f6b45;--ai:#fff;background:var(--b);color:var(--i);width:min(560px,100%);max-height:92vh;overflow:auto;border-radius:14px 14px 0 0;
 padding:16px 16px max(16px,env(safe-area-inset-bottom));font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-sizing:border-box}
@media(min-width:700px){.pfb{border-radius:14px}}
@media(prefers-color-scheme:dark){.pfb{--b:#16222c;--i:#e5edf2;--m:#93a6b4;--l:#2b3a46;--a:#5fb07a;--ai:#0b1a10}}
.pfb *{box-sizing:border-box}.pfb h3{margin:0 0 4px;font-size:19px}.pfb .m{color:var(--m);font-size:13px}
.pfb .ctx{font:12px/1.5 ui-monospace,Menlo,monospace;background:color-mix(in srgb,var(--l) 45%,transparent);border-radius:8px;padding:8px 10px;margin:10px 0;word-break:break-word}
.pfb .tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.pfb .tags button,.pfb .sev button{font:500 13px inherit;font-family:inherit;color:var(--i);background:transparent;border:1px solid var(--l);border-radius:999px;padding:6px 11px;min-height:34px;cursor:pointer}
.pfb .tags button[aria-pressed=true],.pfb .sev button[aria-pressed=true]{background:var(--a);color:var(--ai);border-color:transparent}
.pfb .sev{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.pfb textarea,.pfb select{width:100%;font:15px inherit;font-family:inherit;color:var(--i);background:transparent;border:1px solid var(--l);border-radius:8px;padding:9px}
.pfb textarea{min-height:92px;resize:vertical}.pfb label{display:block;margin:8px 0 4px;font-weight:600;font-size:14px}
.pfb label.ck{display:flex;gap:8px;align-items:center;font-weight:400}.pfb label.ck input{width:18px;height:18px}
.pfb .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.pfb .row>*{flex:1 1 auto}
.pfb .row button,.pfb .row a{font:600 15px inherit;font-family:inherit;min-height:42px;border-radius:8px;border:1px solid var(--l);background:transparent;color:var(--i);cursor:pointer;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;padding:8px 12px}
.pfb .row .p{background:var(--a);color:var(--ai);border-color:transparent}
.pfb img.sh{max-width:100%;max-height:160px;border-radius:8px;display:block;margin-top:6px}
.pfb ul{list-style:none;padding:0;margin:8px 0;display:grid;gap:6px}.pfb li{border:1px solid var(--l);border-radius:8px;padding:8px 10px;font-size:13px}
.pfb .ok{color:var(--a);font-weight:600}`;

  let cfg = null, btn = null;
  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function close(bg) { bg.remove(); cfg.onClose && cfg.onClose(); }
  function summary(c) {
    const s = c.subject || {}, m = c.moment || {};
    return [`${c.app.id} ${c.app.version || ''}`.trim(), [s.sport, s.stroke_name || s.stroke_id, s.hand && s.hand + '-handed'].filter(Boolean).join(' · '),
      s.spec_hash ? `spec ${s.spec_file || ''} #${s.spec_hash}` : '',
      [m.stage_index != null ? `stage ${m.stage_index + 1}` : '', m.stage_label || m.stage, m.t_s != null ? `t=${m.t_s} s` : '', m.frame != null ? `frame ${m.frame}${m.frames ? '/' + m.frames : ''}` : '', m.part].filter(Boolean).join(' · ')]
      .filter(Boolean).map(esc).join('<br>');
  }
  async function open() {
    cfg.onOpen && cfg.onOpen();
    let c = {}; try { c = (await cfg.context()) || {}; } catch (e) { c = { extra: { context_error: String(e) } }; }
    const base = { app: { id: cfg.app, version: c.app_version || cfg.version || null, build: cfg.build || null, page: location.pathname } };
    c = Object.assign(base, c);
    let shot = null; try { shot = cfg.screenshot ? cfg.screenshot() : null; } catch { shot = null; }
    const bg = el(`<div class="pfb-bg" role="dialog" aria-modal="true" aria-label="Send feedback"><div class="pfb">
      <h3>What looks wrong here?</h3><div class="m">The exact stroke, version and moment below are saved with your note. No account, no video.</div>
      <div class="ctx">${summary(c)}</div>
      ${(cfg.fields || []).map(f => `<label for="pfb-${f.id}">${esc(f.label)}</label><select id="pfb-${f.id}" data-f="${f.id}">${f.options.map((o, i) => `<option ${i === (f.default ?? 0) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`).join('')}
      <label>Where is the problem?</label><div class="tags">${TAGS.map(t => `<button type="button" aria-pressed="false" data-t="${t}">${t}</button>`).join('')}</div>
      <label>How bad?</label><div class="sev">${SEV.map(([k, v], i) => `<button type="button" aria-pressed="${i === 1}" data-s="${k}">${v}</button>`).join('')}</div>
      <label for="pfb-text">Details</label><textarea id="pfb-text" placeholder="e.g. the elbow bends backwards just before contact; racket face points at the floor"></textarea>
      ${shot ? `<label class="ck"><input type="checkbox" id="pfb-shot" ${cfg.shotDefault ? 'checked' : ''}> Attach a picture of this frame</label><img class="sh" alt="Current frame" src="${shot}">` : ''}
      <div class="row"><button type="button" class="p" id="pfb-send">Save feedback</button><button type="button" id="pfb-cancel">Cancel</button></div>
      <div class="row"><button type="button" id="pfb-mine">My feedback (${store.all().length})</button></div>
      <div id="pfb-out" class="m" aria-live="polite"></div></div></div>`);
    document.body.append(bg);
    const q = s => bg.querySelector(s);
    bg.addEventListener('click', e => {
      if (e.target === bg) return close(bg);
      const t = e.target.closest('[data-t]'); if (t) t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true');
      const s = e.target.closest('[data-s]'); if (s) bg.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-pressed', b === s));
    });
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(bg); });
    q('#pfb-cancel').onclick = () => close(bg);
    q('#pfb-mine').onclick = () => mine(q('.pfb'), bg);
    q('#pfb-text').focus({ preventScroll: true });
    q('#pfb-send').onclick = async () => {
      const tags = [...bg.querySelectorAll('[data-t][aria-pressed=true]')].map(b => b.dataset.t), text = q('#pfb-text').value.trim();
      if (!tags.length && !text) { q('#pfb-out').textContent = 'Pick a tag or write a few words first.'; return; }
      const fields = {}; bg.querySelectorAll('[data-f]').forEach(x => fields[x.dataset.f] = x.value);
      const rec = {
        schema: SCHEMA, id: uid(), created: new Date().toISOString(),
        app: c.app, subject: c.subject || {}, moment: c.moment || {}, extra: Object.assign({}, c.extra || {}, fields),
        feedback: { tags, severity: bg.querySelector('[data-s][aria-pressed=true]')?.dataset.s || 'major', text },
        attachments: { screenshot: shot && q('#pfb-shot')?.checked ? shot : null },
        client: { anon: anon(), lang: navigator.language, screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, touch: 'ontouchstart' in window, ua: navigator.userAgent.slice(0, 160) },
        url: location.href.split('#')[0],
      };
      try { cfg.finalize && cfg.finalize(rec); } catch (e) { rec.extra.finalize_error = String(e); }
      const all = store.all(); all.push(rec); store.save(all);
      q('#pfb-send').disabled = true; q('#pfb-out').textContent = 'Saved on this device. Sending…';
      const ok = await send(rec);
      if (ok) { rec._sent = new Date().toISOString(); const a = store.all(); const i = a.findIndex(x => x.id === rec.id); if (i >= 0) { a[i]._sent = rec._sent; store.save(a); } }
      q('.pfb').innerHTML = `<h3>Thanks, saved</h3><p class="${ok ? 'ok' : 'm'}">${ok ? 'Sent to the coach team.' : 'Saved on this device; it will be sent automatically later. You can also send it as a GitHub issue.'}</p>
        <div class="row">${ok ? '' : `<a href="${esc(issueUrl(rec))}" target="_blank" rel="noopener">Send as GitHub issue</a>`}<button type="button" class="p" id="pfb-done">Done</button></div>`;
      q('#pfb-done').onclick = () => close(bg); updateBtn();
    };
  }
  function mine(box, bg) {
    const a = store.all().slice().reverse();
    box.innerHTML = `<h3>My feedback (${a.length})</h3><div class="m">Stored in this browser. ${a.filter(r => !r._sent).length} not yet sent.</div>
      <ul>${a.slice(0, 30).map(r => `<li><b>${esc(r.subject?.stroke_name || r.subject?.stroke_id || r.app?.id)}</b> ${esc(r.app?.version || '')} · ${esc(r.moment?.stage_label || r.moment?.stage || '')} ${r.moment?.t_s != null ? esc(r.moment.t_s) + ' s' : ''}<br>${esc(r.feedback.tags.join(', '))} · ${esc(r.feedback.severity)} ${r._sent ? '· <span class="ok">sent</span>' : '· not sent'}<br>${esc(r.feedback.text)}${r._sent ? '' : `<br><a href="${esc(issueUrl(r))}" target="_blank" rel="noopener">Send as GitHub issue</a>`}</li>`).join('')}</ul>
      <div class="row"><button type="button" id="pfb-exp">Export JSON</button><button type="button" id="pfb-retry">Send unsent now</button><button type="button" class="p" id="pfb-close">Close</button></div><div id="pfb-out" class="m" aria-live="polite"></div>`;
    box.querySelector('#pfb-exp').onclick = () => download(`padel-feedback-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.all().map(strip), null, 1));
    box.querySelector('#pfb-retry').onclick = async () => { const n = await flush(); box.querySelector('#pfb-out').textContent = n ? `${n} still not sent (sink offline).` : 'All sent.'; updateBtn(); };
    box.querySelector('#pfb-close').onclick = () => close(bg);
  }
  function updateBtn() { if (!btn) return; const n = store.all().filter(r => !r._sent).length; btn.textContent = n ? `Feedback · ${n}` : 'Feedback'; btn.title = n ? `${n} saved on this device, not yet sent` : 'Report something that looks wrong'; }
  function mount(o) {
    cfg = Object.assign({ app: 'unknown', context: async () => ({}) }, o);
    if (!document.getElementById('pfb-css')) { const s = document.createElement('style'); s.id = 'pfb-css'; s.textContent = CSS; document.head.append(s); }
    btn = el(`<button type="button" class="pfb-btn ${cfg.position || ''}" aria-haspopup="dialog">Feedback</button>`);
    btn.onclick = open; (cfg.parent || document.body).append(btn); updateBtn();
    setTimeout(() => flush().then(updateBtn), 1500);
    return api;
  }
  function grab(canvas, max = 720, q = 0.78) { // downscaled JPEG of a canvas (or of several stacked canvases)
    const list = (Array.isArray(canvas) ? canvas : [canvas]).filter(c => c && (c.width || c.videoWidth));
    if (!list.length) return null; const w0 = list[0].width || list[0].videoWidth, h0 = list[0].height || list[0].videoHeight;
    const k = Math.min(1, max / Math.max(w0, h0)), o = document.createElement('canvas'); o.width = Math.round(w0 * k); o.height = Math.round(h0 * k);
    const g = o.getContext('2d'); for (const c of list) g.drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/jpeg', q);
  }
  function attach(node) { node.addEventListener('click', e => { e.preventDefault(); open(); }); return node; }
  const api = { mount, attach, grab, open, flush, hash, all: () => store.all(), schema: SCHEMA, sink: SINK, get button() { return btn; } };
  window.PadelFeedback = api;
})();
