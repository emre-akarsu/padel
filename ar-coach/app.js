/* Padel Coach PWA: UI only. All analysis goes through the Engine contract (engine/engine.d.ts). */
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const LS = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { alert('Phone storage is full: export and clear the inbox.'); } }
};
const S = Object.assign({ engine: 'onnx', use: 'machine', view: 'side', height: 1.8, hand: 'right', voice: '1', remote: '', shot: 'bandeja' }, LS.get('padel.settings', {}));
const saveS = () => LS.set('padel.settings', S);
const PH_COL = { preparation: '#4fc3f7', backswing: '#ab47bc', forward_swing: '#ff9f43', contact: '#d8ea3a', follow_through: '#5fb07a', recovery: '#90a4ae', ready: '#cfd8dc' };
const PH_NAME = { ready: 'Ready', preparation: 'Preparation', backswing: 'Backswing', forward_swing: 'Forward swing', contact: 'Contact', follow_through: 'Follow-through', recovery: 'Recovery' };
let REL = null, engine = null, engKey = '';
const shotName = id => (PadelGhost.specs.shots[id] || {}).name || id || 'Stroke';
const fmt = (v, d = 1) => v === null || v === undefined ? '-' : (+v).toFixed(d);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- release gates (numbers by default, cues only when released) ---------- */
function gate(id) {
  const d = REL.checks.find(x => x.id === id), g = REL.gates;
  if (!d) return { show: false };
  return { def: d, show: d.status !== 'hidden', fault: d.status === 'auto' && (d.precisionLB ?? 0) >= g.faultGate && d.n >= g.minN, good: d.goodStatus === 'auto' && (d.goodPrecisionLB ?? 0) >= g.goodGate && d.n >= g.minN };
}
const band = (id, shot) => { const g = gate(id); return g.def ? PadelCore.bandFor(g.def, shot, +S.height) : null; };
const countTxt = n => (REL.features.stroke_count.precisionLB ?? 0) >= REL.features.stroke_count.approxUntilGate ? String(n) : '≈' + n;

/* ---------- engine ---------- */
function engOpts(mode) { return { mode, shot: S.shot, view: S.view, playerHeightM: +S.height, handedness: S.hand, checks: REL.checks, remoteUrl: S.remote }; }
async function getEngine(mode) {
  if (!engine || engKey !== S.engine) { if (engine) await engine.dispose(); engine = PadelEngines.create(S.engine, engOpts(mode)); engKey = S.engine; }
  await engine.init(engOpts(mode)); engine.configure(engOpts(mode)); $('#engName').textContent = engine.info.name; return engine;
}

/* ---------- navigation ---------- */
function show(id) {
  $$('main.page,#live').forEach(e => e.hidden = e.id !== id);
  if (id === 'summary') renderSummary(); if (id === 'inbox') renderInbox(); if (id === 'drills') renderDrills();
  if (id === 'shadow' || id === 'drill') startLive(id);
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (!g) return; if (g.dataset.use) { S.use = g.dataset.use; saveS(); } if (g.dataset.go !== 'shadow' && g.dataset.go !== 'drill') DR = null; show(g.dataset.go); });
/* ---------- error-correction drill sets (drills.json via drills.js) ---------- */
let DR = null; // active drill step {set, stepIndex, step}
async function renderDrills() {
  await PadelDrills.load();
  PadelDrills.render($('#drillList'), { checks: REL.checks, shotName, onStart: p => {
    DR = { set: p.set, stepIndex: p.stepIndex, step: p.step };
    if (p.shot && PadelGhost.specs.shots[p.shot]) S.shot = p.shot;
    if (p.step.use) S.use = p.step.use; saveS();
    show(p.step.mode === 'shadow' ? 'shadow' : 'drill');
  } });
}
const USE_TIPS = {
  shadow: ['Prop the phone on a bag, shelf or the floor, 2-4 m away.', 'Whole body in frame, side-on to the phone.', 'Swing slowly and watch the ideal model swing beside you.'],
  machine: ['Clip the phone to the side fence, 5-7 m from your hitting spot, at hip height (1.2-1.5 m).', 'Landscape, main 1x lens (no ultrawide).', 'Same shot every ball. Earbuds on for the spoken numbers.'],
  gadget: ['Side view, 3-5 m from the gadget, hip height.', 'The ball sits in one place, so contact height is measured best here.', 'Only you in the frame.'],
  wall: ['Phone behind you, outside the play area, 4-8 m away.', 'Whole body in frame. Replays after each stroke; skip with Close.', 'Only you in the frame.'],
  lesson: ['Phone on the side fence, 5-7 m away, hip height.', 'The coach can open any replay and answer Agree / Not sure / Wrong.', 'Every coach answer is saved as a training label.'],
};
const USE_NAME = { shadow: 'Shadow swing', machine: 'Ball machine', gadget: 'Hitting gadget', wall: 'Wall / rebound', lesson: 'Coach lesson' };

/* ---------- home ---------- */
function renderHome() {
  $('#shots').innerHTML = Object.entries(PadelGhost.specs.shots).map(([id, s]) => `<button class="chip" data-shot="${id}" aria-pressed="${id === S.shot}">${esc(s.name)}</button>`).join('');
  $$('#shots .chip').forEach(b => b.onclick = () => { S.shot = b.dataset.shot; saveS(); renderHome(); });
  $('#sEngine').innerHTML = PadelEngines.list().map(n => `<option ${n === S.engine ? 'selected' : ''}>${n}</option>`).join('');
  const bind = (sel, key) => { const el = $(sel); el.value = S[key]; el.onchange = () => { S[key] = el.value; saveS(); }; };
  bind('#sEngine', 'engine'); bind('#sView', 'view'); bind('#sHeight', 'height'); bind('#sHand', 'hand'); bind('#sVoice', 'voice'); bind('#sRemote', 'remote');
  $('#engName').textContent = S.engine;
  $('#gates').innerHTML = REL.checks.map(c => { const g = gate(c.id), lvl = g.fault ? ['LIVE CUE', 'ok'] : g.show ? ['NUMBERS', ''] : ['HIDDEN', 'bad'];
    return `<tr><td>${esc(c.phase || '')}</td><td>${esc(c.label || c.id)}</td><td class="small muted">${c.precisionLB != null ? Math.round(c.precisionLB * 100) + '% · ' : ''}${c.n || 0}/${REL.gates.minN}</td><td><span class="pill ${lvl[1]}">${lvl[0]}</span></td></tr>`; }).join('');
}

/* ---------- speech ---------- */
function say(txt) { if (S.voice !== '1' || !window.speechSynthesis) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(txt); u.rate = 1.05; speechSynthesis.speak(u); }
function flashCue(txt) { const c = $('#cue'); c.textContent = txt; c.hidden = false; clearTimeout(flashCue.t); flashCue.t = setTimeout(() => c.hidden = true, 2500); }

/* ---------- live (shadow mirror + drill) ---------- */
const L = { on: false };
const cam = $('#cam'), ov = $('#ov'), octx = ov.getContext('2d');

async function startLive(mode) {
  Object.assign(L, { mode, on: true, running: false, busy: false, ring: [], keep: new Set(), strokes: [], trail: [], idx: 0, lastProc: 0, fpsN: 0, fpsT: performance.now(), fps: 0, dropped: 0, faults: 0, sessionId: 'S' + Date.now().toString(36), start: Date.now(), ghostOn: mode === 'shadow', facing: L.facing || (mode === 'shadow' ? 'user' : 'environment'), lastFit: null });
  $('#live').hidden = false; $('#setup').hidden = false; $('#replay').hidden = true; $('#lastReplay').hidden = true;
  const use = mode === 'shadow' ? 'shadow' : (USE_TIPS[S.use] && S.use !== 'shadow' ? S.use : 'machine');
  $('#liveTitle').textContent = (DR ? `${DR.set.title} · step ${DR.stepIndex + 1}: ` : USE_NAME[use] + ' · ') + shotName(S.shot);
  const tips = DR ? [`${DR.step.name}: ${DR.step.reps} reps.`, 'Focus: ' + DR.step.focus, 'Pass: ' + DR.set.pass, ...USE_TIPS[use].slice(0, 1)] : USE_TIPS[use];
  $('#setupList').innerHTML = tips.map(t => `<li>${t}</li>`).join('') + '<li id="fbStat">Full body: checking...</li>';
  $('#hCount').textContent = '0'; ['#hTempo', '#hHeight', '#hPhase'].forEach(s => $(s).textContent = '-');
  const b = band('contact_low', S.shot); $('#hHeightL').textContent = 'contact m' + (b && gate('contact_low').show ? ` (${b[0]}-${b[1]})` : '');
  // Camera first (no black screen while the model loads), then the engine; frames are only analysed once it is ready.
  L.engReady = false; $('#startBtn').disabled = true;
  $('#setupStatus').textContent = 'Opening the camera…';
  await openCam();
  if (!L.stream) return;
  $('#setupStatus').textContent = S.engine === 'onnx' ? 'Camera on. Loading the pose model (22 MB the first time, then cached)…' : 'Starting…';
  try { await getEngine(mode); } catch (e) { $('#setupStatus').textContent = 'Engine error: ' + e.message + '. Try again, or pick "mock" in Settings → Engine.'; console.error(e); return; }
  if (!engine.info.capabilities.live) { $('#setupStatus').textContent = engine.info.name + ' is upload-only. Pick mock or onnx in Settings.'; return; }
  engine.reset(); L.engReady = true; $('#startBtn').disabled = false;
  $('#setupStatus').textContent = 'Ready: ' + engine.info.name;
  try { L.wake = await navigator.wakeLock?.request('screen'); } catch { }
}

async function openCam() {
  if (L.stream) L.stream.getTracks().forEach(t => t.stop());
  const v = r => ({ audio: false, video: { facingMode: L.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: r } } });
  try { L.stream = await navigator.mediaDevices.getUserMedia(v(120)); }
  catch { try { L.stream = await navigator.mediaDevices.getUserMedia(v(30)); } catch (e) { $('#setupStatus').textContent = 'Camera blocked: ' + e.message; return; } }
  cam.setAttribute('playsinline', ''); cam.muted = true; cam.srcObject = L.stream;
  await cam.play().catch(e => console.warn('video play', e));
  const ok = await Promise.race([new Promise(r => cam.videoWidth ? r(true) : cam.onloadedmetadata = () => r(true)), new Promise(r => setTimeout(() => r(false), 5000))]);
  if (!ok || cam.paused) { // never leave a silent black screen: say what happened and offer a tap to start the video
    $('#setupStatus').innerHTML = 'Camera did not start. <button class="btn primary" id="camRetry">Tap to start camera</button>';
    await new Promise(r => $('#camRetry').onclick = () => { cam.play().catch(() => { }); r(); });
    await new Promise(r => cam.videoWidth ? r() : cam.onloadedmetadata = r);
  }
  ov.width = cam.videoWidth; ov.height = cam.videoHeight;
  const st = L.stream.getVideoTracks()[0].getSettings(); L.camFps = st.frameRate;
  const m = L.facing === 'user'; cam.classList.toggle('mirror', m); ov.classList.toggle('mirror', m);
  engine && L.engReady && engine.reset(); schedule();
}
function schedule() { if (!L.on) return; cam.requestVideoFrameCallback ? cam.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame); }
function onFrame(now) {
  schedule();
  if (!L.engReady || !engine) return;
  if (L.busy) { L.dropped++; return; }
  if (now - L.lastProc < 30) return; // cap inference ~30 fps
  L.lastProc = now; L.busy = true;
  processLive(now / 1000).catch(e => console.error(e)).finally(() => L.busy = false);
}
async function processLive(t) {
  const w = cam.videoWidth, h = cam.videoHeight; if (!w) return;
  const bmpP = createImageBitmap(cam, { resizeWidth: 480, resizeHeight: Math.round(480 * h / w) }).catch(() => null);
  const r = await engine.processFrame({ image: cam, width: w, height: h, t, index: L.idx++ });
  const bmp = await bmpP;
  L.ring.push({ t, bmp, kp: r.skeleton });
  while (L.ring.length && L.ring[0].t < t - 4) { const f = L.ring.shift(); if (!L.keep.has(f.bmp)) f.bmp?.close(); }
  L.last = r;
  draw(r, t);
  // HUD
  L.fpsN++; if (performance.now() - L.fpsT > 1000) { L.fps = L.fpsN * 1000 / (performance.now() - L.fpsT); L.fpsN = 0; L.fpsT = performance.now(); }
  $('#liveInfo').textContent = `ghost ${window.PadelGhost3D?.ready ? '3D' : window.PadelGhost3D?.error ? 'stick (' + window.PadelGhost3D.error.slice(0, 40) + ')' : 'loading'} · ${engine.info.name} · ${L.fps.toFixed(0)} fps · ${r.timing.inferenceMs.toFixed(0)} ms · cam ${L.camFps ? Math.round(L.camFps) : '?'} fps`;
  $('#hPhase').textContent = r.phase ? PH_NAME[r.phase.id] : '-';
  const q = r.quality, fb = $('#fbStat');
  if (fb) { fb.className = q.fullBody && !q.message ? 'ok' : 'bad'; fb.textContent = q.fullBody && !q.message ? 'Full body in frame ✓' : (q.message || 'Step into the frame'); }
  if (L.running) for (const s of r.strokes) onStroke(s);
}

function draw(r, t) {
  octx.clearRect(0, 0, ov.width, ov.height);
  const kp = r.skeleton, s = Math.max(2, ov.height / 180);
  if (kp) {
    const wi = S.hand === 'left' ? 9 : 10;
    L.trail.push([kp[wi][0], kp[wi][1], t]); while (L.trail.length && L.trail[0][2] < t - 1) L.trail.shift();
    octx.lineWidth = s * 1.5; octx.lineCap = 'round';
    for (let i = 1; i < L.trail.length; i++) { octx.globalAlpha = i / L.trail.length; octx.strokeStyle = '#d8ea3a'; octx.beginPath(); octx.moveTo(...L.trail[i - 1]); octx.lineTo(...L.trail[i]); octx.stroke(); }
    octx.globalAlpha = 1;
    const fit = PadelGhost.fitTo(kp); if (fit) { fit.facing = facingOf(kp); L.lastFit = fit; }
  }
  if (L.ghostOn && L.lastFit && L.mode === 'shadow') {
    const spec = PadelGhost.specs.shots[S.shot], period = spec.durationS * 2 + 1; // half speed + 1 s pause
    let u = r.phase && r.phase.progress != null && r.phase.id !== 'ready' ? r.phase.progress : Math.min(1, ((t % period) / (spec.durationS * 2)));
    // beside the player, not on top (overlapping bodies were unreadable): shift towards the emptier side of the frame
    const f = L.lastFit, dir = f.anchor[0] < ov.width / 2 ? 1 : -1;
    drawGhost(octx, S.shot, u, { ...f, anchor: [f.anchor[0] + dir * f.scale * 2.6, f.anchor[1]] }, s * 2.4);
    const sub = $('#sub'); sub.hidden = false; sub.textContent = 'Coach: ' + PadelGhost.labelAt(S.shot, u);
  } else $('#sub').hidden = true;
}
// Ghost coach: the Strike Player girl in 3D (ghost3d.js) when available, else the 2D stick ghost.
function drawGhost(ctx, shot, u, fit, width) {
  const lh = S.hand === 'left';
  if (window.PadelGhost3D?.ready && window.PadelGhost3D.draw(ctx, shot, u, fit, { alpha: .85, leftHanded: lh })) return;
  // no stick figure: the 3D girl is the only ghost
}
function facingOf(kp) { // nose ahead of ears => facing that way; fall back to +x
  const ear = (kp[3][2] > kp[4][2] ? kp[3] : kp[4]); return kp[0][2] > .3 && ear[2] > .3 ? Math.sign(kp[0][0] - ear[0]) || 1 : 1;
}

function onStroke(s) {
  L.strokes.push(s);
  const n = L.strokes.length; $('#hCount').textContent = countTxt(n);
  $('#hTempo').textContent = fmt(s.metrics.tempoS, 2); $('#hHeight').textContent = fmt(s.metrics.contactHeightM, 2);
  // neutral numbers cue, plus at most one released fault cue (max 3 per 10-stroke block)
  if (n % 10 === 1) L.faults = 0;
  let txt = `${shotName(S.shot)} ${n}.` + (s.metrics.contactHeightM != null ? ` Contact ${fmt(s.metrics.contactHeightM, 1)} metres.` : '') + (s.metrics.tempoS != null ? ` Tempo ${fmt(s.metrics.tempoS, 1)} seconds.` : '');
  const f = L.faults < 3 && s.checks.find(c => c.pass === false && gate(c.id).fault);
  const g = !f && s.checks.find(c => c.pass === true && gate(c.id).good);
  if (f) { txt += ' ' + gate(f.id).def.cue + '.'; L.faults++; } else if (g) txt += ' ' + gate(g.id).def.goodCue + '.';
  say(txt); flashCue(txt);
  const frames = L.ring.filter(x => x.t >= s.tStart - .3 && x.t <= s.tEnd + .3 && x.bmp);
  s._frames = frames; s._src = [cam.videoWidth, cam.videoHeight];
  frames.forEach(x => L.keep.add(x.bmp));
  if (L.lastStroke && L.lastStroke._frames) L.lastStroke._frames.forEach(x => { if (!frames.includes(x)) { L.keep.delete(x.bmp); if (!L.ring.includes(x)) x.bmp.close(); } });
  L.lastStroke = s; $('#lastReplay').hidden = false;
  addInbox(s, 'live', thumbFromBitmap(frames, s));
  if (L.mode === 'drill') setTimeout(() => openReplay(s, { frames }), 300);
  if (DR && n === DR.step.reps) { PadelDrills.progress.mark(DR.set.id, DR.stepIndex); setTimeout(() => { say(`Step done: ${DR.step.reps} reps.`); flashCue('Drill step done ✓ End to see your summary'); }, 3000); }
  else if (DR && n < DR.step.reps) setTimeout(() => flashCue(`Focus: ${DR.step.focus} (${n}/${DR.step.reps})`), 2600);
  if (n % 6 === 0) setTimeout(() => { // between-point summary
    const last = L.strokes.slice(-6), hs = last.map(x => x.metrics.contactHeightM).filter(v => v != null), ts = last.map(x => x.metrics.tempoS).filter(v => v != null);
    const txt = `Last ${last.length}: contact ${hs.length ? fmt(Math.min(...hs), 2) + ' to ' + fmt(Math.max(...hs), 2) + ' m' : 'not measured'}` + (ts.length ? `, tempo ${fmt(ts.reduce((a, b) => a + b, 0) / ts.length, 2)} s average.` : '.');
    say(txt); flashCue(txt);
  }, 6000);
}

$('#startBtn').onclick = () => { engine && engine.reset(); L.strokes = []; L.running = true; L.start = Date.now(); $('#setup').hidden = true; $('#hCount').textContent = '0'; say('Go'); };
$('#ghostBtn').onclick = () => L.ghostOn = !L.ghostOn;
$('#flipBtn').onclick = () => { L.facing = L.facing === 'user' ? 'environment' : 'user'; openCam(); };
$('#lastReplay').onclick = () => L.lastStroke && openReplay(L.lastStroke, { frames: L.lastStroke._frames });
$('#stage').onclick = e => { // tap to pick the player
  if (!engine || !cam.videoWidth) return; const r = ov.getBoundingClientRect(), sc = Math.min(r.width / ov.width, r.height / ov.height);
  let x = (e.clientX - r.left - (r.width - ov.width * sc) / 2) / sc; const y = (e.clientY - r.top - (r.height - ov.height * sc) / 2) / sc;
  if (L.facing === 'user') x = ov.width - x; engine.selectSubject(x, y); flashCue('Player selected');
};
$('#liveBack').onclick = endLive;
function endLive() {
  L.on = false; $('#replay').hidden = true; RP && cancelAnimationFrame(RP.raf); RP = null; L.stream && L.stream.getTracks().forEach(t => t.stop()); L.stream = null; L.wake?.release?.();
  L.ring.forEach(f => f.bmp?.close()); L.ring = [];
  if (L.strokes.length) saveSession({ id: L.sessionId, mode: L.mode, shot: S.shot, start: L.start, end: Date.now(), engine: engine.info.name, strokes: L.strokes.map(slim) });
  $('#live').hidden = true; show(L.strokes.length ? 'summary' : 'home');
}
const slim = s => ({ id: s.id, tStart: s.tStart, tContact: s.tContact, tEnd: s.tEnd, shot: s.shot, phases: s.phases, metrics: s.metrics, checks: s.checks, playerFeedback: s.playerFeedback || null });

/* ---------- replay: slow-mo 0.25x, skeleton, hit-path trail, ghost, contact freeze ---------- */
const rp = $('#rp'), rctx = rp.getContext('2d');
let RP = null;
function openReplay(s, src) {
  $('#replay').hidden = false; RP && cancelAnimationFrame(RP.raf);
  const t0 = s.tStart - .2, t1 = s.tEnd + .2;
  RP = { s, src, t0, t1, real0: performance.now(), frozen: false, freezeUntil: 0, frozeOnce: false };
  if (src.video) { const v = src.video; RP.stack = v.videoWidth > v.videoHeight && innerHeight > innerWidth; rp.width = v.videoWidth * (RP.stack ? 1 : 2); rp.height = v.videoHeight * (RP.stack ? 2 : 1); v.pause(); v.currentTime = t0; v.playbackRate = .25; v.muted = true; v.onseeked = () => { v.onseeked = null; v.play().catch(() => { }); RP.real0 = performance.now(); }; RP.k = 1; }
  else { const b = src.frames[0]?.bmp; if (!b) { $('#replay').hidden = true; return; } RP.stack = b.width > b.height && innerHeight > innerWidth; rp.width = b.width * (RP.stack ? 1 : 2); rp.height = b.height * (RP.stack ? 2 : 1); RP.k = b.width / s._src[0]; }
  RP.mirror = !src.video && L.facing === 'user';
  const b = band('contact_low', S.shot);
  $('#rpInfo').textContent = `${shotName(s.shot?.id || S.shot)} · contact ${fmt(s.metrics.contactHeightM, 2)} m${b ? ` (target ${b[0]}-${b[1]})` : ''} · tempo ${fmt(s.metrics.tempoS, 2)} s · stages approx.`;
  RP.raf = requestAnimationFrame(stepReplay);
}
function stepReplay(now) {
  const R = RP; if (!R || $('#replay').hidden) return; R.raf = requestAnimationFrame(stepReplay);
  let t;
  if (R.src.video) {
    const v = R.src.video; t = v.currentTime;
    if (!R.frozeOnce && t >= R.s.tContact) { R.frozeOnce = true; v.pause(); setTimeout(() => !$('#replay').hidden && v.play().catch(() => { }), 500); }
    if (t >= R.t1) v.pause();
  } else {
    let el = (now - R.real0) / 1000;
    const tc = (R.s.tContact - R.t0) / .25;
    if (el > tc && el < tc + .5) el = tc; else if (el >= tc + .5) el -= .5;
    t = Math.min(R.t1, R.t0 + el * .25);
  }
  drawReplay(t);
}
function nearest(arr, t, key = 't') { let b = arr[0]; for (const x of arr) if (Math.abs(x[key] - t) < Math.abs(b[key] - t)) b = x; return b; }
// Split replay: left = you (video, hit path, contact line), right = the ideal 3D model at the same scale and timing.
const gc = document.createElement('canvas'), gctx = gc.getContext('2d');
function drawReplay(t) {
  const R = RP, s = R.s, k = R.k, W = R.stack ? rp.width : rp.width / 2, H = R.stack ? rp.height / 2 : rp.height, ox = R.stack ? 0 : W, oy = R.stack ? H : 0, lw = Math.max(2, Math.min(W, H) / 160), labels = [];
  rctx.fillStyle = '#1b2733'; rctx.fillRect(0, 0, rp.width, rp.height);
  rctx.save(); rctx.beginPath(); rctx.rect(0, 0, W, H); rctx.clip(); if (R.mirror) rctx.setTransform(-1, 0, 0, 1, W, 0);
  try { if (R.src.video) rctx.drawImage(R.src.video, 0, 0, W, H); else rctx.drawImage(nearest(R.src.frames, t).bmp, 0, 0); } catch { rctx.restore(); return; } // frame released
  const sc = kp => kp.map(p => [p[0] * k, p[1] * k, p[2]]);
  rctx.lineCap = 'round'; rctx.lineWidth = lw * 1.8;
  const tr = s.trail.filter(p => p[2] <= t);
  for (let i = 1; i < tr.length; i++) { const ph = s.phases.find(p => tr[i][2] >= p.tStart && tr[i][2] <= p.tEnd); rctx.strokeStyle = PH_COL[ph ? ph.id : 'ready']; rctx.beginPath(); rctx.moveTo(tr[i - 1][0] * k, tr[i - 1][1] * k); rctx.lineTo(tr[i][0] * k, tr[i][1] * k); rctx.stroke(); }
  let wy = null;
  if (s.track.length) {
    const kp = sc(nearest(s.track, t).keypoints);
    const spec = PadelGhost.specs.shots[s.shot?.id || S.shot], fit = PadelGhost.fitTo(kp);
    if (spec && fit) { // ideal model, time-warped so its contact matches yours, drawn in its own half
      const cu = spec.contactU, u = t < s.tContact ? cu * (t - s.tStart) / Math.max(.05, s.tContact - s.tStart) : cu + (1 - cu) * (t - s.tContact) / Math.max(.05, s.tEnd - s.tContact);
      fit.facing = facingOf(kp); if (gc.width !== W || gc.height !== H) { gc.width = W; gc.height = H; } gctx.clearRect(0, 0, W, H);
      window.PadelGhost3D?.ready && window.PadelGhost3D.draw(gctx, s.shot?.id || S.shot, u, fit, { alpha: 1, leftHanded: S.hand === 'left' });
    }
    if (t >= s.tContact - .02) { const ck = sc(nearest(s.track, s.tContact).keypoints); wy = ck[S.hand === 'left' ? 9 : 10][1]; }
  }
  rctx.restore();
  rctx.save(); if (R.mirror) rctx.setTransform(-1, 0, 0, 1, ox * 2 + W, 0); rctx.drawImage(gc, ox, oy); rctx.restore();
  if (wy != null) { // your contact height across both halves
    rctx.setLineDash([lw * 3, lw * 2]); rctx.strokeStyle = '#d8ea3a'; rctx.lineWidth = lw; rctx.beginPath(); rctx.moveTo(0, wy); rctx.lineTo(R.stack ? W : 2 * W, wy); if (R.stack) { rctx.moveTo(0, wy + H); rctx.lineTo(W, wy + H); } rctx.stroke(); rctx.setLineDash([]);
    labels.push([`Your contact ${fmt(s.metrics.contactHeightM, 2)} m`, W * .03, wy - lw * 3]);
  }
  rctx.fillStyle = '#ffffff66'; if (R.stack) rctx.fillRect(0, H - lw / 2, W, lw); else rctx.fillRect(W - lw / 2, 0, lw, H);
  labels.forEach(a => label(a[0], a[1], a[2], lw));
  label('YOU', W * .03, lw * 12, lw); label('IDEAL', ox + W * .03, oy + lw * 12, lw);
  const ph = s.phases.find(p => t >= p.tStart && t <= p.tEnd);
  label((ph ? PH_NAME[ph.id] : t < s.tStart ? 'Ready' : 'Recovery') + ' (approx.)  0.25x', W * .03, H - lw * 6, lw);
}
function label(txt, x, y, lw) { rctx.font = `600 ${Math.round(lw * 8)}px system-ui`; const w = rctx.measureText(txt).width; rctx.fillStyle = '#000a'; rctx.fillRect(x - lw * 2, y - lw * 8, w + lw * 4, lw * 10.5); rctx.fillStyle = '#fff'; rctx.fillText(txt, x, y); }
$('#rpClose').onclick = () => { $('#replay').hidden = true; RP?.src.video?.pause(); };
$('#rpAgain').onclick = () => RP && openReplay(RP.s, RP.src);
$$('#replay [data-fb]').forEach(b => b.onclick = () => { if (!RP) return; RP.s.playerFeedback = b.dataset.fb; const inb = LS.get('padel.inbox', []), it = inb.find(i => i.id === RP.s.id); if (it) { it.playerFeedback = b.dataset.fb; LS.set('padel.inbox', inb); } flashCue('Thanks: saved as a label'); });

/* ---------- thumbnails ---------- */
function thumbCanvas(img, w0, h0, kp, k) {
  const c = document.createElement('canvas'); c.width = 200; c.height = Math.round(200 * h0 / w0); const x = c.getContext('2d'), sc = 200 / w0;
  x.drawImage(img, 0, 0, c.width, c.height); if (kp) PadelGhost.draw(x, kp.map(p => [p[0] * k * sc, p[1] * k * sc, p[2]]), { width: 2 });
  return c.toDataURL('image/jpeg', .6);
}
function thumbFromBitmap(frames, s) { if (!frames.length) return null; const f = nearest(frames, s.tContact); const kp = s.track.length ? nearest(s.track, s.tContact).keypoints : null; return thumbCanvas(f.bmp, f.bmp.width, f.bmp.height, kp, f.bmp.width / s._src[0]); }

/* ---------- storage: sessions + inbox ---------- */
function saveSession(x) { const a = LS.get('padel.sessions', []); a.unshift(x); LS.set('padel.sessions', a.slice(0, 30)); }
function addInbox(s, source, thumb) {
  const a = LS.get('padel.inbox', []);
  a.unshift({ id: s.id, sessionId: L.sessionId || null, source, mode: L.mode || 'review', createdAt: new Date().toISOString(), tContact: s.tContact, thumb, shot: { suggested: s.shot || { id: S.shot, confidence: 1, source: 'drill' }, final: null }, metrics: s.metrics, checks: s.checks.filter(c => gate(c.id).show), engine: engine?.info.name, playerFeedback: null, review: null });
  LS.set('padel.inbox', a.slice(0, 300));
}

/* ---------- summary ---------- */
const stats = a => { const v = a.filter(x => x != null); if (!v.length) return null; const m = v.reduce((p, c) => p + c, 0) / v.length; return { n: v.length, min: Math.min(...v), max: Math.max(...v), mean: m, sd: Math.sqrt(v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length) }; };
function renderSummary() {
  const ss = LS.get('padel.sessions', []);
  const cur = ss[0], prev = cur && ss.slice(1).find(x => x.shot === cur.shot);
  PadelDrills.load().catch(() => null).then(d => PadelChat.mount($('#sumChat'), () => ({ strokes: cur ? cur.strokes : [], prev: prev ? prev.strokes : null, shot: cur ? cur.shot : S.shot, band: (id, sh) => band(id, sh), shotName, drills: d && d.sets || [],
    replay: n => { const s = L.strokes && L.strokes[n - 1]; if (!s || !s._frames || cur.id !== L.sessionId) return false; $('#live').hidden = false; $('#setup').hidden = true; openReplay(s, { frames: s._frames }); $('#rpClose').addEventListener('click', () => $('#live').hidden = true, { once: true }); return true; } })));
  if (!ss.length) { $('#sumBody').innerHTML = '<p class="muted">No sessions yet. Run a shadow or drill session.</p>'; return; }
  $('#sumBody').innerHTML = ss.slice(0, 15).map(x => {
    const h = stats(x.strokes.map(s => s.metrics.contactHeightM)), tp = stats(x.strokes.map(s => s.metrics.tempoS));
    const rows = REL.checks.filter(d => d.status !== 'hidden').map(d => { const cs = x.strokes.flatMap(s => s.checks.filter(c => c.id === d.id && c.pass !== null)); if (!cs.length) return ''; const st = stats(cs.map(c => c.value)); return `<tr><td>${esc(d.label)}</td><td>${fmt(st.mean, d.unit === 'deg' ? 0 : 2)} ${d.unit === 'bool' ? '' : d.unit}</td><td>${cs.filter(c => c.pass).length}/${cs.length} in target</td></tr>`; }).join('');
    return `<div class="card"><div class="bar"><b class="grow">${new Date(x.start).toLocaleString()} · ${esc(x.mode)} · ${esc(shotName(x.shot))}</b><span class="muted small">${esc(x.engine)}</span></div>
      <p><b>${countTxt(x.strokes.length)}</b> strokes in ${Math.max(1, Math.round((x.end - x.start) / 60000))} min.
      ${h ? `Contact height ${fmt(h.min, 2)}-${fmt(h.max, 2)} m (mean ${fmt(h.mean, 2)}).` : ''} ${tp ? `Tempo ${fmt(tp.mean, 2)} ± ${fmt(tp.sd, 2)} s${tp.sd < .12 ? ', steady' : ''}.` : ''}</p>
      ${rows ? `<table><tr><th>Measure</th><th>Mean</th><th>Target band</th></tr>${rows}</table>` : ''}</div>`;
  }).join('') + '<p class="muted small">Numbers only. Faults are drafts for your coach until each check passes its release gate.</p>';
}
$('#sumExport').onclick = () => download('padel_sessions.json', { schema: 'padel.sessions.v1', exportedAt: new Date().toISOString(), sessions: LS.get('padel.sessions', []) });

/* ---------- coach review inbox ---------- */
function renderInbox() {
  const a = LS.get('padel.inbox', []), f = $('#inFilter').value;
  const list = a.filter(i => f === 'all' || (f === 'todo' ? !i.review : !!i.review));
  const shots = Object.entries(PadelGhost.specs.shots);
  $('#inList').innerHTML = list.length ? list.map(i => {
    const sug = i.shot.suggested || {};
    return `<div class="card inbox-item" data-id="${esc(i.id)}">${i.thumb ? `<img src="${i.thumb}" alt="Contact frame">` : '<div></div>'}<div>
      <div class="bar"><b class="grow">${esc(shotName(sug.id))} <span class="pill">${esc(sug.source || '?')} ${sug.confidence != null ? Math.round(sug.confidence * 100) + '%' : ''}</span></b>
        <span class="muted small">${new Date(i.createdAt).toLocaleString()} · ${esc(i.source)}${i.playerFeedback ? ' · player: ' + esc(i.playerFeedback) : ''}</span></div>
      <div class="small muted">Contact ${fmt(i.metrics.contactHeightM, 2)} m · tempo ${fmt(i.metrics.tempoS, 2)} s · elbow ${fmt(i.metrics.elbowAngleContactDeg, 0)}° · knee ${fmt(i.metrics.kneeAngleLoadDeg, 0)}°</div>
      <table>${i.checks.map(c => { const d = gate(c.id).def, rv = i.review?.checks?.[c.id]; return `<tr><td>${esc(d.label)}<br><span class="small muted">${c.value == null ? 'not measured' : fmt(c.value, c.unit === 'deg' ? 0 : 2) + ' ' + (c.unit === 'bool' ? '' : c.unit)} · target ${c.band.join('-')}</span></td>
        <td>${c.pass === null ? '<span class="pill">abstain</span>' : c.pass ? '<span class="pill ok">in band</span>' : `<span class="pill bad">draft: ${esc(d.cue)}</span>`}</td>
        <td><select data-check="${esc(c.id)}"><option value="">-</option>${['agree', 'disagree', 'unsure'].map(o => `<option ${rv === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td></tr>`; }).join('')}</table>
      <div class="bar" style="margin-top:8px"><select data-shotfix><option value="">Shot ok</option>${shots.map(([id, s]) => `<option value="${id}" ${i.review?.shot === id && i.review?.verdict === 'fixed' ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <input data-note placeholder="Note for the player" value="${esc(i.review?.note || '')}" style="flex:1;min-width:120px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--surface)">
        <button class="btn primary" data-act="approve">${i.review ? 'Update' : 'Approve'}</button><button class="btn" data-act="reject">Not a stroke</button></div>
      ${i.review ? `<div class="small muted">Reviewed: ${esc(i.review.verdict)} ${new Date(i.review.at).toLocaleString()}</div>` : ''}</div></div>`;
  }).join('') : '<p class="muted">Nothing here. Strokes from sessions and uploads land here for review.</p>';
  $$('#inList [data-act]').forEach(b => b.onclick = () => {
    const card = b.closest('[data-id]'), all = LS.get('padel.inbox', []), it = all.find(x => x.id === card.dataset.id); if (!it) return;
    const fix = card.querySelector('[data-shotfix]').value, checks = {};
    card.querySelectorAll('[data-check]').forEach(s => { if (s.value) checks[s.dataset.check] = s.value; });
    const verdict = b.dataset.act === 'reject' ? 'rejected' : fix && fix !== it.shot.suggested?.id ? 'fixed' : 'approved';
    it.review = { verdict, shot: verdict === 'rejected' ? null : (fix || it.shot.suggested?.id), checks, note: card.querySelector('[data-note]').value, at: new Date().toISOString() };
    it.shot.final = it.review.shot; LS.set('padel.inbox', all); renderInbox();
  });
}
$('#inFilter').onchange = renderInbox;
$('#inExport').onclick = () => {
  const items = LS.get('padel.inbox', []).filter(i => i.review || i.playerFeedback).map(({ thumb, ...r }) => r);
  download('padel_coach_labels_' + new Date().toISOString().slice(0, 10) + '.json', { schema: 'padel.coach_labels.v1', exportedAt: new Date().toISOString(), app: 'padel-coach-pwa/1.0', releaseVersion: REL.version, trust: 'coach_label', items });
};
function download(name, obj) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }

/* ---------- upload a video ---------- */
$('#upFile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  const st = $('#upStatus'), out = $('#upResult'); out.innerHTML = ''; st.textContent = 'Loading engine...';
  try {
    await getEngine('review');
    const ac = new AbortController(); L.sessionId = 'U' + Date.now().toString(36); L.mode = 'review';
    const res = await engine.analyzeVideo(file, { onProgress: p => st.textContent = `Analysing ${Math.round(p * 100)}%`, signal: ac.signal });
    st.textContent = `${res.strokes.length} strokes in ${fmt(res.durationS, 1)} s (${res.engine.name})`;
    const v = document.createElement('video'); v.src = URL.createObjectURL(file); v.playsInline = true; v.muted = true; v.preload = 'auto';
    await new Promise(r => v.onloadeddata = r);
    for (const s of res.strokes) { // contact thumbnails for the inbox
      v.currentTime = s.tContact; await new Promise(r => v.onseeked = r);
      const kp = s.track.length ? nearest(s.track, s.tContact).keypoints : null;
      addInbox(s, 'upload', thumbCanvas(v, v.videoWidth, v.videoHeight, kp, 1));
    }
    saveSession({ id: L.sessionId, mode: 'review', shot: S.shot, start: Date.now(), end: Date.now() + res.durationS * 1000, engine: res.engine.name, strokes: res.strokes.map(slim) });
    out.innerHTML = `<div class="card"><table><tr><th>#</th><th>Time</th><th>Shot</th><th>Contact m</th><th>Tempo s</th><th></th></tr>${res.strokes.map((s, i) => `<tr><td>${i + 1}</td><td>${fmt(s.tContact, 1)}</td><td>${esc(shotName(s.shot?.id))}</td><td>${fmt(s.metrics.contactHeightM, 2)}</td><td>${fmt(s.metrics.tempoS, 2)}</td><td><button class="btn" data-rp="${i}">Replay</button></td></tr>`).join('')}</table>
      <p class="small muted">All strokes were added to the Coach Review Inbox.</p></div><div class="card" id="upChat"></div>`;
    const ss = LS.get('padel.sessions', []), prev = ss.slice(1).find(x => x.shot === S.shot), rpv = n => { const st = res.strokes[n - 1]; if (!st) return false; $('#live').hidden = false; $('#setup').hidden = true; L.on = false; openReplay(st, { video: v }); $('#rpClose').addEventListener('click', () => $('#live').hidden = true, { once: true }); return true; };
    PadelDrills.load().catch(() => null).then(d => PadelChat.mount($('#upChat'), () => ({ strokes: res.strokes, prev: prev ? prev.strokes : null, shot: S.shot, band: (id, sh) => band(id, sh), shotName, drills: d && d.sets || [], replay: rpv })));
    out.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => { $('#live').hidden = false; $('#setup').hidden = true; L.on = false; openReplay(res.strokes[+b.dataset.rp], { video: v }); $('#rpClose').addEventListener('click', () => $('#live').hidden = true, { once: true }); });
  } catch (err) { st.textContent = 'Error: ' + err.message; }
};

/* ---------- PWA ---------- */
let deferred = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = () => { deferred?.prompt(); $('#installBtn').hidden = true; };
if ('serviceWorker' in navigator) { const had = !!navigator.serviceWorker.controller; navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => { }); navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !window.__reloaded) { window.__reloaded = 1; location.reload(); } }); }

(async function boot() {
  REL = await fetch('release.json').then(r => r.json());
  await PadelGhost.load();
  renderHome();
  const h = location.hash.slice(1); if (['upload', 'summary', 'inbox', 'drills'].includes(h)) show(h);
  const pr = h.match(/^practice=(\w+)/), sh = pr && Object.keys(PadelGhost.specs.shots).find(k => k === pr[1] || PadelGhost.specs.shots[k].strikeId === pr[1]);
  if (sh) { S.shot = sh; saveS(); renderHome(); }
})();
