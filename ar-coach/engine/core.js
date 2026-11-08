/* Engine registry + shared deterministic analysis (smoothing, stroke detector,
 * metrics, checks, generic analyzeVideo). Any pose-only engine can reuse it:
 * feed keypoints in, get the contract's FrameResult fields out. See engine.d.ts. */
(function () {
  'use strict';
  const factories = {};
  window.PadelEngines = {
    register(name, f) { factories[name] = f; },
    create(name, o) { if (!factories[name]) throw new Error('Unknown engine: ' + name); return factories[name](o || {}); },
    list() { return Object.keys(factories); }
  };

  const K = { nose: 0, ls: 5, rs: 6, le: 7, re: 8, lw: 9, rw: 10, lh: 11, rh: 12, lk: 13, rk: 14, la: 15, ra: 16 };
  const PHASES = ['ready', 'preparation', 'backswing', 'forward_swing', 'contact', 'follow_through', 'recovery'];

  // One-euro filter per coordinate (Casiez 2012)
  function OneEuro(minCut = 1.2, beta = 0.02, dCut = 1.0) { this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.x = null; this.dx = 0; this.t = null; }
  OneEuro.prototype.f = function (x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const a = c => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    const dx = (x - this.x) / dt; this.dx += a(this.dCut) * (dx - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += a(cut) * (x - this.x); return this.x;
  };

  const angle = (a, b, c) => { // angle at b, degrees
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const d = Math.hypot(...v1) * Math.hypot(...v2); if (!d) return null;
    return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI;
  };
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, Math.min(p[2], q[2])];
  const conf = (kp, ids) => ids.reduce((s, i) => s + kp[i][2], 0) / ids.length;
  const emptyMetrics = n => ({ strokeCount: n, tempoS: null, contactHeightM: null, contactAheadM: null, elbowAngleContactDeg: null, kneeAngleLoadDeg: null, wristSpeedPeak: null });

  // facing in a side view: nose ahead of the visible ear; fallback = swing direction
  function facing(kp, vx) { const e = kp[3][2] > kp[4][2] ? kp[3] : kp[4]; return kp[0][2] > .3 && e[2] > .3 && Math.abs(kp[0][0] - e[0]) > 2 ? Math.sign(kp[0][0] - e[0]) : Math.sign(vx || 1); }
  function bandFor(def, shot, H = 1.8) { const v = def.band, b = Array.isArray(v) ? v : (v[shot] || v.default || [-Infinity, Infinity]); return def.relHeight ? [+(b[0] * H).toFixed(2), +(b[1] * H).toFixed(2)] : b; }

  function runChecks(defs, metrics, shot, c, H) {
    return (defs || []).filter(d => !d.shots || !shot || d.shots.includes(shot)).map(d => {
      const v = metrics[d.metric]; const band = bandFor(d, shot, H);
      const abstain = v === null || v === undefined || c < 0.3;
      return { id: d.id, value: abstain ? null : v, unit: d.unit, band, pass: abstain ? null : (v >= band[0] && v <= band[1]), confidence: abstain ? 0 : c };
    });
  }

  /** createAnalyzer(opts) -> { update(t, kps, w, h) -> partial FrameResult, reset(), configure() }
   *  opts: playerHeightM, handedness, shot, checks (release.json checks), hi/lo thresholds (body heights / s) */
  function createAnalyzer(opts) {
    let o = Object.assign({ playerHeightM: 1.8, handedness: 'right', shot: null, checks: [], hi: 0.8, lo: 0.3, quietS: 0.18, mergeS: 0.9, maxS: 3.5, expectS: 1.4, minTempoS: 0.2 }, opts);
    let filt = [], hist = [], bodyPx = null, state = 'idle', st = null, count = 0, last = emptyMetrics(0), lastV = 0, lastQuietT = 0, seq = 0;
    // overheads lift the racket, wait for the ball, then swing: that wait can be well over a second,
    // so a longer merge window keeps prep + swing as ONE stroke (with 0.9 s the lift counted as the stroke)
    const OVER = ['bandeja', 'vibora', 'smash', 'smash_x3', 'bajada', 'serve'], mergeS = () => OVER.includes(o.shot) ? Math.max(o.mergeS, 1.6) : o.mergeS;
    const dom = () => o.handedness === 'left' ? { w: K.lw, s: K.ls, e: K.le, ow: K.rw, os: K.rs } : { w: K.rw, s: K.rs, e: K.re, ow: K.lw, os: K.ls };

    function smooth(t, kps) {
      if (!filt.length) filt = kps.map(() => [new OneEuro(), new OneEuro()]);
      return kps.map((p, i) => [filt[i][0].f(p[0], t), filt[i][1].f(p[1], t), p[2]]);
    }
    function frameAt(t) { let best = hist[0]; for (const h of hist) if (Math.abs(h.t - t) < Math.abs(best.t - t)) best = h; return best; }

    function finish(tEnd) {
      const d = dom();
      if (OVER.includes(o.shot)) { // overheads: contact = highest racket wrist near the speed peak
        for (const h of hist) if (h.t >= Math.max(st.tStart, st.peak.t - .25) && h.t <= st.peak.t + .1 && h.kp[d.w][1] < st.peak.kp[d.w][1]) st.peak = { t: h.t, v: st.peak.v, vx: h.vx, kp: h.kp };
      }
      // no wind-up before the speed peak = the racket coming back down to ready (or a fidget), not a new stroke:
      // without this every bandeja counted twice (swing + recovery, the second with tempo 0)
      if (st.peak.t - st.tStart < o.minTempoS) return null;
      const pk = st.peak, kp = pk.kp, pxM = (bodyPx || 1) / (0.88 * o.playerHeightM);
      const ground = Math.max(kp[K.la][1], kp[K.ra][1]);
      const hip = mid(kp[K.lh], kp[K.rh]);
      const win = hist.filter(h => h.t >= st.tStart && h.t <= tEnd);
      const pre = frameAt(pk.t - 0.3).kp;
      let knee = null; for (const h of win) if (h.t <= pk.t) { const a = Math.min(angle(h.kp[K.lh], h.kp[K.lk], h.kp[K.la]) ?? 999, angle(h.kp[K.rh], h.kp[K.rk], h.kp[K.ra]) ?? 999); if (a < 999) knee = knee === null ? a : Math.min(knee, a); }
      count++;
      const m = {
        strokeCount: count,
        tempoS: +(pk.t - st.tStart).toFixed(3),
        contactHeightM: +((ground - kp[d.w][1]) / pxM).toFixed(2),
        contactAheadM: +(((kp[d.w][0] - hip[0]) * facing(kp, pk.vx)) / pxM).toFixed(2),
        elbowAngleContactDeg: Math.round(angle(kp[d.s], kp[d.e], kp[d.w]) ?? NaN) || null,
        kneeAngleLoadDeg: knee === null ? null : Math.round(knee),
        wristSpeedPeak: +pk.v.toFixed(2),
        racketUpEarly: pre[d.w][1] < pre[d.s][1] ? 1 : 0,
        freeArmUp: pre[d.ow][1] < pre[d.os][1] ? 1 : 0
      };
      const a = st.tStart, c = pk.t, b = tEnd, L = c - a, R = b - c;
      const cut = [a, a + .4 * L, a + .75 * L, c - .03, c + .03, c + .6 * R, b];
      const phases = PHASES.slice(1).map((id, i) => ({ id, tStart: +cut[i].toFixed(3), tEnd: +cut[i + 1].toFixed(3) }));
      const c0 = conf(kp, [d.s, d.e, d.w, K.la, K.ra, K.nose]);
      const checks = runChecks(o.checks, m, o.shot, c0, o.playerHeightM);
      last = m;
      return {
        id: 's' + Date.now().toString(36) + (seq++), tStart: a, tContact: c, tEnd: b,
        shot: o.shot ? { id: o.shot, confidence: 1, source: 'drill' } : null,
        phases, metrics: m, checks,
        track: win.map(h => ({ t: h.t, keypoints: h.kp })),
        trail: win.map(h => [h.kp[d.w][0], h.kp[d.w][1], h.t])
      };
    }

    return {
      configure(p) { Object.assign(o, p); },
      reset() { filt = []; hist = []; state = 'idle'; st = null; count = 0; last = emptyMetrics(0); bodyPx = null; },
      get count() { return count; },
      update(t, raw, w, h) {
        const out = { skeleton: null, phase: null, strokes: [], metrics: last, checks: [], quality: { fullBody: false, personPx: null, message: 'No player in view' } };
        if (!raw) return out;
        const kp = smooth(t, raw), d = dom();
        const ground = Math.max(kp[K.la][1], kp[K.ra][1]), bpx = ground - kp[K.nose][1];
        const okFeet = kp[K.la][2] > .3 && kp[K.ra][2] > .3 && ground < h * 0.98, okHead = kp[K.nose][2] > .3 && kp[K.nose][1] > h * 0.02;
        out.quality = { fullBody: okFeet && okHead, personPx: Math.round(bpx / 0.88), message: !okFeet ? 'Feet out of frame: move the phone back or lower' : !okHead ? 'Head out of frame: tilt up or step back' : bpx < 130 ? 'Player is small: move closer (2-6 m)' : null };
        if (state === 'idle' && bpx > 40) bodyPx = bodyPx === null ? bpx : bodyPx * 0.95 + bpx * 0.05;
        const prev = hist[hist.length - 1];
        let v = 0, vx = 0;
        if (prev && bodyPx) { const dt = Math.max(1e-3, t - prev.t); vx = (kp[d.w][0] - prev.kp[d.w][0]) / dt; v = Math.hypot(vx, (kp[d.w][1] - prev.kp[d.w][1]) / dt) / bodyPx; }
        v = lastV * 0.4 + v * 0.6; lastV = v;
        hist.push({ t, kp, v, vx }); while (hist.length && hist[0].t < t - 4) hist.shift();
        out.skeleton = kp;
        if (state === 'idle') {
          if (v < o.lo) lastQuietT = t;
          if (v > o.hi) { state = 'active'; st = { tStart: lastQuietT, segs: [], peak: { t, v, vx, kp }, quietSince: null }; }
        } else if (state === 'active') {
          if (v > st.peak.v) st.peak = { t, v, vx, kp };
          st.quietSince = v < o.lo ? (st.quietSince ?? t) : null;
          if ((st.quietSince !== null && t - st.quietSince >= o.quietS) || t - st.tStart > o.maxS) { st.segs.push(st.peak); st.endT = t; state = 'pending'; }
        } else { // pending: a pause (e.g. prep then swing) within mergeS continues the same stroke
          if (v > o.hi && t - st.endT < mergeS() && t - st.tStart < o.maxS) { state = 'active'; st.peak = { t, v, vx, kp }; st.quietSince = null; }
          else if (t - st.endT >= mergeS() || t - st.tStart > o.maxS) {
            const mx = Math.max(...st.segs.map(p => p.v)); st.peak = st.segs.filter(p => p.v >= .6 * mx).pop(); // swing = last strong segment
            const s = finish(st.endT); if (s) { out.strokes.push(s); out.checks = s.checks; } state = 'idle'; lastQuietT = t; st = null;
          }
        }
        out.metrics = last;
        if (state === 'idle') out.phase = { id: 'ready', progress: null, confidence: .6, approx: true };
        else {
          const pre = state === 'active' && t <= st.peak.t + 0.02;
          out.phase = { id: pre ? (v > 2 * o.hi ? 'forward_swing' : 'preparation') : 'follow_through', progress: Math.min(1, (t - st.tStart) / o.expectS), confidence: .4, approx: true };
        }
        return out;
      }
    };
  }

  /** Generic analyzeVideo for any frame engine: seeks through the clip at `fps` and calls processFrame. */
  async function analyzeVideoByFrames(engine, file, opts = {}) {
    const fps = opts.fps || 15, url = URL.createObjectURL(file), v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Cannot decode this video in the browser')); });
    const N = Math.floor(v.duration * fps), strokes = [], track = [];
    engine.reset();
    for (let i = 0; i < N; i++) {
      if (opts.signal && opts.signal.aborted) break;
      v.currentTime = i / fps; await new Promise(r => v.onseeked = r);
      const r = await engine.processFrame({ image: v, width: v.videoWidth, height: v.videoHeight, t: i / fps, index: i });
      if (r.skeleton) track.push({ t: i / fps, keypoints: r.skeleton });
      strokes.push(...r.strokes);
      if (opts.onProgress && i % 5 === 0) opts.onProgress(i / N);
    }
    URL.revokeObjectURL(url);
    return { engine: engine.info, durationS: v.duration, fps, width: v.videoWidth, height: v.videoHeight, strokes, track };
  }

  window.PadelCore = { K, PHASES, OneEuro, angle, createAnalyzer, runChecks, analyzeVideoByFrames, emptyMetrics, bandFor };
})();
