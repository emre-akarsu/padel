/* Mock engine: ignores pixels, animates a synthetic player from the technique
 * specs (one stroke every ~3 s with random tempo / height variation) and runs it
 * through the shared PadelCore analyzer, so every UI path gets contract-shaped data. */
(function () {
  'use strict';
  function createMock(init) {
    let o = Object.assign({ mode: 'drill', shot: 'bandeja', view: 'side', playerHeightM: 1.8, handedness: 'right', checks: [] }, init);
    let an = null, t0 = null, cyc = null;
    const info = { name: 'mock', version: '1.0', capabilities: { live: true, video: true, dense: false, shotClassifier: false, shots: ['bandeja', 'vibora', 'smash', 'forehand', 'backhand', 'volley_fh'], checks: [] } };
    const rnd = (a, b) => a + Math.random() * (b - a);
    function newCycle(t) { const s = PadelGhost.specs.shots[o.shot || 'bandeja']; cyc = { start: t + rnd(0.8, 1.6), dur: s.durationS * rnd(.85, 1.2), lift: rnd(-.12, .12), shift: rnd(-.15, .15) }; }
    function synth(t, w, h) {
      if (!cyc || t > cyc.start + cyc.dur) newCycle(t);
      const u = t < cyc.start ? 0 : (t - cyc.start) / cyc.dur;
      const p = PadelGhost.pose(o.shot || 'bandeja', u);
      const scale = h * 0.17, anchor = [w * (0.5 + cyc.shift * 0.3), h * 0.55];
      const kp = PadelGhost.place(p, anchor, scale, o.handedness === 'left' ? -1 : 1, o.handedness === 'left');
      // contact-height variation: lift arms; tiny jitter
      return kp.map((q, i) => [q[0] + rnd(-1, 1), q[1] + rnd(-1, 1) - ((i >= 7 && i <= 10) ? cyc.lift * scale : 0), 0.9]);
    }
    function result(t, kp, w, h, ms) {
      const r = an.update(t, kp, w, h);
      const box = kp ? (() => { const xs = kp.map(k => k[0]), ys = kp.map(k => k[1]); const x = Math.min(...xs), y = Math.min(...ys); return [x, y, Math.max(...xs) - x, Math.max(...ys) - y]; })() : null;
      return Object.assign({ t, persons: kp ? [{ id: 1, bbox: box, score: .9, keypoints: kp }] : [], subject: kp ? 0 : null, shot: o.shot ? { id: o.shot, confidence: 1, source: 'drill' } : null, timing: { inferenceMs: ms, skipped: false } }, r);
    }
    return {
      info,
      async init(p) { Object.assign(o, p || {}); if (!PadelGhost.specs) await PadelGhost.load(); an = PadelCore.createAnalyzer(o); info.capabilities.checks = (o.checks || []).map(c => c.id); },
      configure(p) { Object.assign(o, p); an && an.configure(p); cyc = null; },
      async processFrame(f) {
        const a = performance.now(); if (t0 === null) t0 = f.t;
        const kp = synth(f.t - t0, f.width, f.height);
        return result(f.t, kp, f.width, f.height, performance.now() - a);
      },
      async analyzeVideo(file, opt = {}) {
        const v = document.createElement('video'), url = URL.createObjectURL(file); v.src = url; v.muted = true;
        await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Cannot read this video')); });
        const W = v.videoWidth || 1280, H = v.videoHeight || 720, fps = 30, strokes = [], track = [];
        an.reset(); cyc = null;
        for (let i = 0; i < v.duration * fps; i++) {
          if (opt.signal && opt.signal.aborted) break;
          const t = i / fps, r = result(t, synth(t, W, H), W, H, 0);
          track.push({ t, keypoints: r.skeleton }); strokes.push(...r.strokes);
          if (opt.onProgress && i % 30 === 0) { opt.onProgress(t / v.duration); await new Promise(r => setTimeout(r)); }
        }
        URL.revokeObjectURL(url);
        return { engine: info, durationS: v.duration, fps, width: W, height: H, strokes, track };
      },
      selectSubject() { },
      reset() { an && an.reset(); t0 = null; cyc = null; },
      async dispose() { }
    };
  }
  PadelEngines.register('mock', createMock);
})();
