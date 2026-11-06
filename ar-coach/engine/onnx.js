/* On-device engine: ONNX Runtime Web (WebGPU, WASM fallback).
 *  - Pose: RTMPose-s 256x192 SimCC (models/rtmpose-s.onnx, from the mmdeploy SDK export).
 *  - Detector (optional plug point): RTMDet-nano end2end ONNX, input 1x3x320x320 BGR,
 *    outputs dets [1,N,5] (x1,y1,x2,y2,score) + labels. If detUrl is empty or fails to
 *    load, the engine starts from a centred full-body crop and tracks the subject from
 *    its own keypoints (fine for drill / shadow mode: one player in frame).
 *  Stroke / metrics / checks come from PadelCore (same code as the mock). */
(function () {
  'use strict';
  const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.all.min.js';
  const PW = 192, PH = 256, DS = 320;
  const loadScript = src => new Promise((res, rej) => { if (window.ort) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ONNX Runtime Web (offline?)')); document.head.appendChild(s); });

  function createOnnx(init) {
    let o = Object.assign({ mode: 'drill', shot: 'bandeja', view: 'side', playerHeightM: 1.8, handedness: 'right', checks: [],
      poseUrl: 'models/rtmpose-s.onnx', detUrl: '', detEvery: 5, provider: 'webgpu' }, init);
    let pose = null, det = null, an = null, box = null, n = 0, tap = null, persons = [], ep = null;
    const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; const cx = cv.getContext('2d', { willReadFrequently: true });
    const dv = document.createElement('canvas'); dv.width = dv.height = DS; const dx = dv.getContext('2d', { willReadFrequently: true });
    const info = { name: 'onnx-rtmpose-s', version: '0.1', capabilities: { live: true, video: true, dense: false, shotClassifier: false, shots: [], checks: [] } };

    function tensor(ctx, w, h, mean, std, bgr) {
      const d = ctx.getImageData(0, 0, w, h).data, a = new Float32Array(3 * w * h), N = w * h;
      for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) { const s = bgr ? 2 - c : c; a[c * N + i] = (d[i * 4 + s] - mean[c]) / std[c]; }
      return new ort.Tensor('float32', a, [1, 3, h, w]);
    }
    async function detect(f) {
      const s = Math.min(DS / f.width, DS / f.height);
      dx.fillStyle = 'rgb(114,114,114)'; dx.fillRect(0, 0, DS, DS); dx.drawImage(f.image, 0, 0, f.width * s, f.height * s);
      const out = await det.run({ [det.inputNames[0]]: tensor(dx, DS, DS, [103.53, 116.28, 123.675], [57.375, 57.12, 58.395], true) });
      const d = out[det.outputNames[0]].data, res = [];
      for (let i = 0; i + 4 < d.length; i += 5) if (d[i + 4] > 0.4) res.push({ bbox: [d[i] / s, d[i + 1] / s, (d[i + 2] - d[i]) / s, (d[i + 3] - d[i + 1]) / s], score: d[i + 4] });
      return res;
    }
    function pick(list) {
      if (!list.length) return null;
      const ref = tap || (box ? [box[0] + box[2] / 2, box[1] + box[3] / 2] : null);
      if (ref) return list.reduce((a, b) => Math.hypot(b.bbox[0] + b.bbox[2] / 2 - ref[0], b.bbox[1] + b.bbox[3] / 2 - ref[1]) < Math.hypot(a.bbox[0] + a.bbox[2] / 2 - ref[0], a.bbox[1] + a.bbox[3] / 2 - ref[1]) ? b : a);
      return list.reduce((a, b) => b.bbox[3] > a.bbox[3] ? b : a); // largest = nearest
    }
    async function runPose(f, b) {
      // TopDownGetBboxCenterScale(padding 1.25) + fixed 3:4 aspect, no rotation
      let cxm = b[0] + b[2] / 2, cym = b[1] + b[3] / 2, w = b[2] * 1.25, h = b[3] * 1.25;
      if (w / h > PW / PH) h = w * PH / PW; else w = h * PW / PH;
      const x0 = cxm - w / 2, y0 = cym - h / 2;
      cx.fillStyle = '#000'; cx.fillRect(0, 0, PW, PH); cx.drawImage(f.image, x0, y0, w, h, 0, 0, PW, PH);
      const out = await pose.run({ [pose.inputNames[0]]: tensor(cx, PW, PH, [123.675, 116.28, 103.53], [58.395, 57.12, 57.375], false) });
      const sx = out[pose.outputNames[0]].data, sy = out[pose.outputNames[1]].data, LX = sx.length / 17, LY = sy.length / 17, kp = [];
      for (let k = 0; k < 17; k++) {
        let bx = 0, mx = -1e9, by = 0, my = -1e9;
        for (let i = 0; i < LX; i++) { const v = sx[k * LX + i]; if (v > mx) { mx = v; bx = i; } }
        for (let i = 0; i < LY; i++) { const v = sy[k * LY + i]; if (v > my) { my = v; by = i; } }
        kp.push([x0 + (bx / 2) * w / PW, y0 + (by / 2) * h / PH, Math.min(mx, my)]);
      }
      return kp;
    }
    function kpBox(kp, W, H) {
      const g = kp.filter(k => k[2] > .3); if (g.length < 6) return null;
      const xs = g.map(k => k[0]), ys = g.map(k => k[1]); let x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
      y -= h * .08; h *= 1.12; // head top / feet
      return [Math.max(0, x), Math.max(0, y), Math.min(W, w), Math.min(H, h)];
    }

    return {
      info,
      async init(p) {
        Object.assign(o, p || {}); an = PadelCore.createAnalyzer(o); info.capabilities.checks = (o.checks || []).map(c => c.id);
        if (pose) return;
        await loadScript(ORT);
        ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
        const eps = (o.provider === 'webgpu' && navigator.gpu) ? ['webgpu', 'wasm'] : ['wasm'];
        pose = await ort.InferenceSession.create(o.poseUrl, { executionProviders: eps, graphOptimizationLevel: 'all' });
        ep = eps[0];
        info.name = 'onnx-rtmpose-s (' + ep + ')';
        if (o.detUrl) try { det = await ort.InferenceSession.create(o.detUrl, { executionProviders: eps }); info.name += ' + rtmdet'; } catch (e) { console.warn('detector not loaded, using keypoint tracking', e); }
      },
      configure(p) { Object.assign(o, p); an && an.configure(p); },
      async processFrame(f) {
        const a = performance.now();
        if (det && (n % o.detEvery === 0 || !box)) { persons = (await detect(f)).map((p, i) => ({ id: i + 1, bbox: p.bbox, score: p.score, keypoints: null })); const s = pick(persons); if (s) box = s.bbox; }
        if (!box) box = [f.width * .3, f.height * .05, f.width * .4, f.height * .9]; // centred full-body prior
        n++;
        const kp = await runPose(f, box);
        const good = kp.filter(k => k[2] > .3).length >= 8;
        const nb = good ? kpBox(kp, f.width, f.height) : null; box = nb || (det ? null : box);
        const r = an.update(f.t, good ? kp : null, f.width, f.height);
        const me = { id: 0, bbox: nb || box, score: good ? 1 : 0, keypoints: kp };
        const ps = det ? persons.map(p => p.bbox === box ? me : p) : [me];
        return Object.assign({ t: f.t, persons: ps, subject: good ? ps.indexOf(me) : null, shot: o.shot ? { id: o.shot, confidence: 1, source: 'drill' } : null, timing: { inferenceMs: performance.now() - a, skipped: false } }, r);
      },
      analyzeVideo(file, opt) { return PadelCore.analyzeVideoByFrames(this, file, opt); },
      selectSubject(x, y) { tap = [x, y]; box = null; if (!det) box = [x - 100, y - 200, 200, 400]; },
      reset() { an && an.reset(); box = null; n = 0; },
      async dispose() { pose && await pose.release?.(); det && await det.release?.(); pose = det = null; }
    };
  }
  PadelEngines.register('onnx', createOnnx);
})();
