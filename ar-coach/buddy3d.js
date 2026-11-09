// Mini coach buddy: the Strike Player girl (same Rocketbox GLB + solver as the ghost) in a small corner canvas.
// She reacts to live drill events from mastery.js: a hop on each rep, a cheer on reps in band, more and more
// excited on streaks, and at a level-up she plays the ideal shot at full speed, jumps with a spin and throws
// both arms up. Positive only: an out-of-band rep gets no reaction. API: window.PadelBuddy.react(event), .mount(el), .setShot(id)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadLayer, compileTechnique } from '../strikes/solver.js?v=12';

const BASE = '../strikes/', B = 'Bip01 ';
const st = { ready: false, shot: null, q: [], act: null, excite: 0, mounted: null };
window.PadelBuddy = st;
st.react = ev => { st.q.push(ev); if (st.q.length > 4) st.q.splice(0, st.q.length - 4); };
st.setShot = id => { st.shot = id; };
st.mount = el => { st.mounted = el; };

const DUR = { rep: .45, good: .7, streak: 1.4, setdone: 1.6, levelup: 3.4 };
const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
const bump = (x, a, b) => x < a || x > b ? 0 : Math.sin(Math.PI * (x - a) / (b - a));

try {
  const [{ ch, layer }, sport, gltf] = await Promise.all([
    loadLayer(async p => (await fetch(BASE + p, { cache: 'no-cache' })).json()),
    fetch(BASE + 'specs/padel.json').then(r => r.json()),
    new GLTFLoader().loadAsync(BASE + 'assets/player.glb')]);
  const bones = {};
  gltf.scene.traverse(o => { if (o.isMesh) o.frustumCulled = false; if (o.isBone) bones[o.name] = o; });
  const boneOf = n => bones[n] || bones[THREE.PropertyBinding.sanitizeNodeName(n)];
  const armRoot = boneOf(B + 'Pelvis').parent; gltf.scene.updateMatrixWorld(true);
  const rootQ = armRoot.getWorldQuaternion(new THREE.Quaternion()), rootQinv = rootQ.clone().invert(), restQ = {};
  for (const b of ch.bones) { const o = boneOf(b.name); if (o) restQ[b.name] = rootQinv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())); }
  const Q = a => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
  function applyPose(res) { // same retarget as strikes/engine.js and ghost3d.js
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
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene(), rig = new THREE.Group(), body = new THREE.Group();
  body.add(gltf.scene);
  const racket = (await new GLTFLoader().loadAsync(BASE + layer.implements.padel_racket.model.replace(/^\.\.\//, ''))).scene; body.add(racket);
  rig.add(body); scene.add(rig);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-300, 600, 500); scene.add(key);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xd8ea3a, transparent: true, opacity: .35 }));
  glow.rotation.x = -Math.PI / 2; scene.add(glow);
  const cam = new THREE.PerspectiveCamera(30, 0.75, 1, 5000);

  const techOf = id => { const sid = window.PadelGhost?.specs?.shots?.[id]?.strikeId || id; return sport.techniques.find(t => t.id === sid) || sport.techniques[0]; };
  const comps = {};
  const comp = id => comps[id] || (comps[id] = compileTechnique(ch, techOf(id), sport, layer, { slowRate: 1 }));
  const handR = boneOf(B + 'R Hand'), armsUp = [B + 'L UpperArm', B + 'R UpperArm'].map(boneOf);
  const tmpQ = new THREE.Quaternion(), tmpP = new THREE.Quaternion(), raise = new THREE.Quaternion(), rotX = new THREE.Quaternion();

  // frame the girl once from her ready pose: centre between feet and head, camera from her front-right
  let frame = null;
  function frameOn() { // world-space box of her bones in the ready pose (rig at rest)
    rig.updateMatrixWorld(true); const bx = new THREE.Box3(), v = new THREE.Vector3();
    for (const b of ch.bones) { const o = boneOf(b.name); if (o) bx.expandByPoint(o.getWorldPosition(v)); }
    const H = bx.max.y - bx.min.y, pel = boneOf(B + 'Pelvis').getWorldPosition(new THREE.Vector3());
    frame = { H, piv: pel.clone(), c: new THREE.Vector3(pel.x, bx.min.y + H * .55, pel.z) };
    const dir = new THREE.Vector3(-.75, .18, .66).normalize();
    cam.position.copy(frame.c).addScaledVector(dir, H * 2.9); cam.lookAt(frame.c); cam.near = H * .3; cam.far = H * 10; cam.updateProjectionMatrix();
    glow.position.set(pel.x, bx.min.y - H * .03, pel.z); glow.scale.setScalar(H * .3);
  }

  function pose(now) {
    // pick the next action from the queue (a level-up wins over smaller events in the same batch)
    if ((!st.act || now - st.act.t0 > DUR[st.act.type] * 1000) && st.q.length) {
      const lv = st.q.filter(e => e.type === 'levelup').pop(), e = lv || st.q[st.q.length - 1]; st.q.length = 0;
      if (DUR[e.type]) st.act = Object.assign({ t0: now }, e);
      if (e.type === 'good') st.excite = Math.min(1, st.excite + .12); if (e.type === 'streak') st.excite = Math.min(1, st.excite + .25);
      if (e.type === 'rep') st.excite *= .6;
    }
    st.excite *= .9995;
    const a = st.act && now - st.act.t0 <= DUR[st.act.type] * 1000 ? st.act : null, p = a ? (now - a.t0) / 1000 / DUR[a.type] : 0, ts = now / 1000;
    let u = 0, hop = 0, spin = 0, arms = 0, lean = 0;
    // idle: breathing sway; the more excited, the bouncier
    const ex = st.excite;
    hop = ex * .03 * Math.max(0, Math.sin(ts * (6 + 6 * ex)));
    spin = Math.sin(ts * .7) * .25;
    if (a) switch (a.type) {
      case 'rep': hop = .04 * bump(p, 0, 1); break;
      case 'good': hop = .1 * bump(p, 0, 1); arms = .5 * bump(p, .1, 1); break;
      case 'streak': hop = .12 * (bump(p, 0, .45) + bump(p, .5, .95)); arms = bump(p, 0, 1); spin += .5 * Math.sin(p * Math.PI * 2); break;
      case 'setdone': hop = .1 * (bump(p, 0, .3) + bump(p, .35, .65)); spin = Math.PI * 2 * ease((p - .3) / .5); arms = bump(p, .3, 1); break;
      case 'levelup': // ideal shot at full speed, then a jump with a full spin, then arms up
        u = ease(p / .4); if (p > .4) u = 1 - ease((p - .4) / .1);
        hop = .25 * bump(p, .5, .75); spin = Math.PI * 2 * ease((p - .5) / .25); arms = p > .5 ? Math.min(1, (p - .5) / .1) * (p < .92 ? 1 : (1 - p) / .08) : 0;
        lean = 0; break;
    }
    return { u, hop, spin, arms, lean };
  }

  function render(now) {
    const el = st.mounted; if (!el) return;
    const c = comp(st.shot || 'bandeja'); if (!c) return;
    const k = pose(now);
    const res = c.solve(c.t0 + k.u * (c.t1 - c.t0)); applyPose(res);
    if (res.racket) { racket.position.set(...res.racket.origin); racket.quaternion.set(...res.racket.R); }
    if (!frame) { rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); body.position.set(0, 0, 0); frameOn(); }
    const H = frame.H, piv = frame.piv;
    body.position.set(-piv.x, 0, -piv.z); rig.position.set(piv.x, k.hop * H, piv.z); rig.rotation.y = k.spin;
    rig.updateMatrixWorld(true);
    const rq = armRoot.getWorldQuaternion(new THREE.Quaternion());
    // arms up: rotate both upper arms about her side axis (X) in the solver frame; the racket stays in the hand
    if (k.arms > 0.001) {
      const relR = handR.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(racket.getWorldQuaternion(new THREE.Quaternion()));
      const handP = new THREE.Vector3(), rp = racket.getWorldPosition(new THREE.Vector3()), hp = handR.getWorldPosition(handP);
      const offs = rp.clone().sub(hp).applyQuaternion(handR.getWorldQuaternion(new THREE.Quaternion()).invert());
      for (const o of armsUp) {
        if (!o) continue;
        rotX.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -st.ARM * k.arms);
        raise.copy(rq).multiply(rotX).multiply(rq.clone().invert()); // world-space rotation
        o.getWorldQuaternion(tmpQ); o.parent.getWorldQuaternion(tmpP);
        o.quaternion.copy(tmpP.invert().multiply(raise).multiply(tmpQ));
        o.updateMatrixWorld(true);
      }
      const hq = handR.getWorldQuaternion(new THREE.Quaternion()), hw = handR.getWorldPosition(new THREE.Vector3());
      const bodyInv = body.matrixWorld.clone().invert();
      const wp = hw.add(offs.applyQuaternion(hq)).applyMatrix4(bodyInv);
      racket.position.copy(wp); racket.quaternion.copy(body.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hq.multiply(relR)));
    }
    const w = el.clientWidth, h = el.clientHeight;
    if (renderer.domElement.parentNode !== el) el.appendChild(renderer.domElement);
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, true); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    renderer.render(scene, cam);
  }
  st.ARM = 1.45; // radians at full "arms up"
  let last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const el = st.mounted; if (st.paused || !el || !el.getClientRects().length || document.hidden) return;
    if (now - last < 33) return; last = now; // 30 fps cap, own budget so pose estimation keeps the GPU
    try { render(now); } catch (e) { console.warn('buddy', e); st.mounted = null; }
  }
  st.renderOnce = now => render(now ?? performance.now()); // for tests
  st.ready = true;
  requestAnimationFrame(loop);
  window.dispatchEvent(new Event('padelbuddy'));
} catch (e) { st.error = String(e && e.message || e); console.warn('buddy unavailable', e); }
