/* Ghost coach: technique specs (techniques.json) -> COCO-17 2D pose at stroke time u in [0,1].
 * Spec keys = joint angles (2D forward kinematics) or `frames` = baked 2D keypoints
 * (torso units, hip-mid origin, y down, facing +x, right-handed) from the multi-strike engine. */
(function () {
  'use strict';
  let SPECS = null;
  const L = { ua: .62, fa: .55, th: .92, sh: .9, neck: .38 };
  const FIELDS = ['trunk', 'rot', 'rs', 're', 'ls', 'le', 'rt', 'rk', 'lt', 'lk'];
  const dir = (a, l) => [Math.sin(a * Math.PI / 180) * l, Math.cos(a * Math.PI / 180) * l];
  const add = (p, d) => [p[0] + d[0], p[1] + d[1]];
  const ease = x => x * x * (3 - 2 * x);

  async function load(url = 'techniques.json') {
    const r = await fetch(url); SPECS = await r.json();
    for (const s of Object.values(SPECS.shots)) if (s.keys) { // fill inherited fields
      let prev = {}; s.keys = s.keys.map(k => (prev = Object.assign({}, prev, k)));
    }
    return SPECS;
  }

  function fk(k) {
    const hip = [0, 0], up = dir(180 + k.trunk, 1), sh = add(hip, up);
    const w = .05 + .22 * k.rot, hw = .04 + .12 * k.rot;
    const rS = [sh[0] + w * .3, sh[1]], lS = [sh[0] - w * .3, sh[1] - .01], rH = [hw * .3, 0], lH = [-hw * .3, 0];
    // in a side view the far side is shifted; small x offsets keep left/right separable
    const rE = add(rS, dir(k.rs, L.ua)), rW = add(rE, dir(k.re, L.fa));
    const lE = add(lS, dir(k.ls, L.ua)), lW = add(lE, dir(k.le, L.fa));
    const rK = add(rH, dir(k.rt, L.th)), rA = add(rK, dir(k.rk, L.sh));
    const lK = add(lH, dir(k.lt, L.th)), lA = add(lK, dir(k.lk, L.sh));
    const nose = add(sh, add(dir(180 + k.trunk, L.neck), [.1, 0]));
    const eye = add(nose, [-.04, -.05]), ear = add(nose, [-.13, -.03]);
    return [nose, eye, eye, ear, ear, lS, rS, lE, rE, lW, rW, lH, rH, lK, rK, lA, rA];
  }

  /** pose(shot, u) -> 17 x [x, y] in torso units. */
  function pose(shot, u) {
    const s = SPECS && SPECS.shots[shot]; if (!s) return null;
    u = Math.max(0, Math.min(1, u));
    if (s.frames) { const f = s.frames, i = u * (f.length - 1), a = Math.floor(i), b = Math.min(f.length - 1, a + 1), t = i - a; return f[a].map((p, j) => [p[0] + (f[b][j][0] - p[0]) * t, p[1] + (f[b][j][1] - p[1]) * t]); }
    const ks = s.keys; let i = 0; while (i < ks.length - 2 && ks[i + 1].u < u) i++;
    const a = ks[i], b = ks[i + 1], t = ease((u - a.u) / Math.max(1e-6, b.u - a.u)), k = {};
    for (const f of FIELDS) k[f] = a[f] + (b[f] - a[f]) * t;
    return fk(k);
  }
  function phaseAt(shot, u) { const s = SPECS && SPECS.shots[shot]; if (!s || !s.keys) return null; let p = s.keys[0].phase; for (const k of s.keys) if (k.u <= u + 1e-6) p = k.phase; return p; }

  /** Map torso-unit pose to pixels: anchor = hip mid px, scale = torso length px, facing = +1/-1, mirrorLR swaps handedness. */
  function place(p, anchor, scale, facing = 1, leftHanded = false) {
    let out = p.map(q => [anchor[0] + q[0] * scale * facing, anchor[1] + q[1] * scale, 1]);
    if (leftHanded) { const sw = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15]; out = sw.map(i => out[i]); }
    return out;
  }
  /** Fit the ghost to a player skeleton: hip-mid anchor, torso-length scale. */
  function fitTo(kp) {
    if (!kp) return null;
    const hip = [(kp[11][0] + kp[12][0]) / 2, (kp[11][1] + kp[12][1]) / 2], sh = [(kp[5][0] + kp[6][0]) / 2, (kp[5][1] + kp[6][1]) / 2];
    const torso = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]); return torso > 5 ? { anchor: hip, scale: torso } : null;
  }

  const BONES = [[5, 7], [7, 9], [6, 8], [8, 10], [5, 6], [11, 12], [5, 11], [6, 12], [11, 13], [13, 15], [12, 14], [14, 16], [0, 5], [0, 6]];
  function draw(ctx, kp, o = {}) {
    if (!kp) return; const th = o.minScore ?? .3;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = o.width || 4; ctx.globalAlpha = o.alpha ?? 1;
    for (const [a, b] of BONES) {
      if ((kp[a][2] ?? 1) < th || (kp[b][2] ?? 1) < th) continue;
      ctx.strokeStyle = o.color || ((a % 2 === 0 && b % 2 === 0 && a > 4) ? '#ff9f43' : (a % 2 && b % 2) ? '#4fc3f7' : '#e8eef2');
      ctx.beginPath(); ctx.moveTo(kp[a][0], kp[a][1]); ctx.lineTo(kp[b][0], kp[b][1]); ctx.stroke();
    }
    if (!o.noHead && (kp[0][2] ?? 1) >= th) { ctx.fillStyle = o.color || '#e8eef2'; ctx.beginPath(); ctx.arc(kp[0][0], kp[0][1], (o.width || 4) * 1.6, 0, 7); ctx.fill(); }
    ctx.restore();
  }

  window.PadelGhost = { load, pose, phaseAt, place, fitTo, draw, BONES, get specs() { return SPECS; } };
})();
