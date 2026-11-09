// 3D ghost coach: the Strike Player girl (Rocketbox GLB) posed by the Strike Player solver,
// rendered from the side-fence view and fitted to the player (hip anchor, torso scale, facing).
// Reuses ../strikes assets and solver as-is. Falls back to the 2D stick ghost if anything fails.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadLayer, compileTechnique } from '../strikes/solver.js?v=12';

const BASE = '../strikes/', B = 'Bip01 ';
const st = { ready: false, comps: {} };
try {
  // Strike Player v6 layer: anatomical arm model, grip sockets, joint limits (body/, implements/, grips/, specs/)
  const [{ ch, layer }, sport, gltf] = await Promise.all([
    loadLayer(async p => (await fetch(BASE + p, { cache: 'no-cache' })).json()),
    fetch(BASE + 'specs/padel.json').then(r => r.json()),
    new GLTFLoader().loadAsync(BASE + 'assets/player.glb')]);
  const bones = {};
  gltf.scene.traverse(o => { if (o.isMesh) o.frustumCulled = false; if (o.isBone) bones[o.name] = o; });
  const boneOf = n => bones[n] || bones[THREE.PropertyBinding.sanitizeNodeName(n)];
  const armRoot = boneOf(B + 'Pelvis').parent; gltf.scene.updateMatrixWorld(true);
  const rootQinv = armRoot.getWorldQuaternion(new THREE.Quaternion()).invert(), restQ = {};
  for (const b of ch.bones) { const o = boneOf(b.name); if (o) restQ[b.name] = rootQinv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())); }
  const Q = a => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
  function applyPose(res) { // same retarget as strikes/engine.js
    const wq = {};
    for (const b of ch.bones) {
      const o = boneOf(b.name); if (!o) continue;
      const w = Q(res.delta[b.name]).multiply(restQ[b.name]); wq[b.name] = w;
      const pq = b.parent ? wq[b.parent] : new THREE.Quaternion();
      o.quaternion.copy(pq.clone().invert().multiply(w));
      if (!b.parent || ch.anchor[b.name]) {
        const pp = b.parent ? res.pos[b.parent] : [0, 0, 0];
        o.position.copy(new THREE.Vector3(res.pos[b.name][0] - pp[0], res.pos[b.name][1] - pp[1], res.pos[b.name][2] - pp[2]).applyQuaternion(pq.clone().invert()));
      }
    }
  }
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), rig = new THREE.Group(), mirror = new THREE.Group();
  mirror.add(gltf.scene);
  // v6: the racket is its own model, placed rigidly from the solved grip socket each frame
  const racket = (await new GLTFLoader().loadAsync(BASE + layer.implements.padel_racket.model.replace(/^\.\.\//, ''))).scene; mirror.add(racket); rig.add(mirror); scene.add(rig);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(-5, 6, 3); scene.add(key);
  const cam = new THREE.OrthographicCamera(0, 1, 0, -1, 0.1, 5000); // looks +X from the player's right: image x = +Z, image y = -Y
  cam.position.set(-1000, 0, 0); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
  // app shot id -> strike technique (same mapping as techniques.json strikeId)
  const techOf = id => { const sid = window.PadelGhost?.specs?.shots?.[id]?.strikeId || id; return sport.techniques.find(t => t.id === sid); };
  const comp = id => { if (!(id in st.comps)) { const t = techOf(id); st.comps[id] = t ? compileTechnique(ch, t, sport, layer, { slowRate: 1 }) : null; if (st.comps[id]) { const p = st.comps[id].solve(st.comps[id].t0).pos; st.comps[id].torso0 = torso(p); } } return st.comps[id]; };
  const hipOf = p => [(p[B + 'L Thigh'][0] + p[B + 'R Thigh'][0]) / 2, (p[B + 'L Thigh'][1] + p[B + 'R Thigh'][1]) / 2, (p[B + 'L Thigh'][2] + p[B + 'R Thigh'][2]) / 2];
  const torso = p => { const h = hipOf(p), s = [(p[B + 'L UpperArm'][1] + p[B + 'R UpperArm'][1]) / 2, (p[B + 'L UpperArm'][2] + p[B + 'R UpperArm'][2]) / 2]; return Math.hypot(s[0] - h[1], s[1] - h[2]); };

  // Playback: the Strike Player's own slow-motion curve (slow around contact), normalised so the whole stroke
  // plays in a fixed time. playU(shot, f) maps playback fraction f in [0,1] to stroke time u in [0,1].
  const plays = {};
  st.playU = (id, f, P = 3.5) => {
    if (!(id in plays)) { const t = techOf(id); let tab = null;
      try { if (t) { const c2 = compileTechnique(ch, t, sport, layer, {}), N = 400, dt = (c2.t1 - c2.t0) / N, r0 = t.slowmo?.rate ?? 1; const W = []; for (let i = 0; i < N; i++) W.push(r0 < 1 ? (1 - c2.speed(c2.t0 + (i + .5) * dt)) / (1 - r0) : 0); const len = (r) => W.reduce((a, w) => a + dt / (1 - (1 - r) * w), 0); let r = r0; if (len(r0) > P) { let lo = r0, hi = 1; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (len(m) > P) lo = m; else hi = m; } r = hi; } /* fix 2026-11-08: raise slow-mo rate instead of compressing the whole stroke (prep/recovery never faster than real time) */ tab = [0]; for (let i = 0; i < N; i++) tab.push(tab[i] + dt / (1 - (1 - r) * W[i])); const T = tab[N]; tab = tab.map(x => x / T); } } catch (e) { tab = null; }
      plays[id] = tab; }
    const tab = plays[id]; f = Math.max(0, Math.min(1, f)); if (!tab) return f;
    let i = 1; while (i < tab.length - 1 && tab[i] < f) i++; const a = tab[i - 1], b = tab[i];
    return (i - 1 + (b > a ? (f - a) / (b - a) : 0)) / (tab.length - 1);
  };
  /** draw(ctx, shot, u, fit {anchor:[px,py], scale: torso px, facing: +1/-1}, opts {alpha, leftHanded}) -> true if drawn */
  st.draw = (ctx, shot, u, fit, o = {}) => {
    const c = comp(shot); if (!c || !fit) return false;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (renderer.domElement.width !== W || renderer.domElement.height !== H) renderer.setSize(W, H, false);
    cam.left = 0; cam.right = W; cam.top = 0; cam.bottom = -H; cam.updateProjectionMatrix();
    const res = c.solve(c.t0 + Math.max(0, Math.min(1, u)) * (c.t1 - c.t0)); applyPose(res); if (res.racket) { racket.position.set(...res.racket.origin); racket.quaternion.set(...res.racket.R); }
    const s = fit.scale / c.torso0, h = hipOf(res.pos);
    mirror.scale.set(o.leftHanded ? -1 : 1, 1, 1);
    rig.scale.setScalar(s); rig.rotation.set(0, fit.facing < 0 ? Math.PI : 0, 0);
    rig.position.set(0, 0, 0); rig.updateMatrixWorld(true);
    const hw = new THREE.Vector3(o.leftHanded ? -h[0] : h[0], h[1], h[2]).applyMatrix4(rig.matrixWorld);
    rig.position.set(-hw.x, -fit.anchor[1] - hw.y, fit.anchor[0] - hw.z);
    renderer.render(scene, cam);
    ctx.save(); ctx.globalAlpha = o.alpha ?? .6; ctx.drawImage(renderer.domElement, 0, 0); ctx.restore();
    return true;
  };
  st.ready = true;
} catch (e) { st.error = String(e && e.message || e); console.warn('3D ghost unavailable, using stick ghost', e); }
window.PadelGhost3D = st;
