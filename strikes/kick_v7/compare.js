// Kick serve v6 vs v7, side by side: one clock, one camera, two scenes (left = v6 before, right = v7 after).
// The body / grips / implements / character come from the published Strike Player layer (../); the solver here is the
// v7 copy (root motion + CoM, see loco.js), which runs v6 specs unchanged.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadLayer, compileTechnique } from "./solver.js?v=7";
import { comOf } from "./loco.js?v=7";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), status = $("status");
const capture = new URL(location.href).searchParams.has("capture"); if (capture) document.body.classList.add("capture");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(capture ? 1 : Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setScissorTest(true);
stage.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.autoRotateSpeed = 1.6;
const VIEWS = { side: [[-5.4, 1.45, 0.45], [0, 1.28, 0.4]], front: [[0.35, 1.6, 6.6], [0, 1.25, 0.3]], orbit: [[-3.6, 2.2, 3.8], [0, 1.2, 0.35]] };
let view = "side";
function setView(v) { view = v; const [p, t] = VIEWS[v]; camera.position.set(...p); controls.target.set(...t); controls.autoRotate = v === "orbit"; controls.update();
  for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === v)); }

status.textContent = "Loading the character and solving both serves…";
const base = "../";
const { ch, layer } = await loadLayer(async (p) => (await fetch(base + p)).json());
const sport = await (await fetch("kick.json")).json();
const T = { v6: sport.techniques.find((t) => t.id === "kick_serve_v6"), v7: sport.techniques.find((t) => t.id === "kick_serve_v7") };
const glbs = await Promise.all([0, 1].map(() => new GLTFLoader().loadAsync(base + "assets/player.glb")));   // one instance per side
const racketGlb = await new GLTFLoader().loadAsync(base + layer.implements.tennis_racket.model.replace(/^\.\.\//, ""));
const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,240,200,.85)"); r.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
function tube(points, r, color, opacity = 1) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const n = Math.max(8, points.length - 1);
  const core = new THREE.Mesh(new THREE.TubeGeometry(curve, n, r, 6, false), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity }));
  const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, n, r * 3.2, 8, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 * opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const grp = new THREE.Group(); grp.add(core, halo);
  grp.reveal = (f) => { for (const [m, rad] of [[core, 6], [halo, 8]]) m.geometry.setDrawRange(0, Math.round(Math.min(1, Math.max(0, f)) * n) * rad * 6); };
  return grp;
}
function court(scene) {
  const c = sport.court, g = new THREE.Mesh(new THREE.PlaneGeometry(c.width + 6, c.length + 8), new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.92 }));
  g.rotation.x = -Math.PI / 2; g.position.z = c.net_z - c.length / 4; g.receiveShadow = true; scene.add(g);
  const behind = new THREE.Mesh(new THREE.PlaneGeometry(c.width + 6, 4), new THREE.MeshStandardMaterial({ color: 0x1b4a86, roughness: 0.95 }));   // behind the baseline, darker
  behind.rotation.x = -Math.PI / 2; behind.position.set(0, 0.001, -2); behind.receiveShadow = true; scene.add(behind);
  const lm = new THREE.MeshBasicMaterial({ color: 0xe9eef2 });
  for (const [x0, z0, x1, z1] of c.lines) { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(Math.abs(x1 - x0), 0.05), Math.max(Math.abs(z1 - z0), 0.05)), lm);
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.003, (z0 + z1) / 2); scene.add(m); }
  const bl = new THREE.Mesh(new THREE.PlaneGeometry(c.width, 0.06), new THREE.MeshBasicMaterial({ color: 0xffd166, toneMapped: false }));   // the baseline, highlighted
  bl.rotation.x = -Math.PI / 2; bl.position.set(0, 0.005, -0.03); scene.add(bl);
  const lab = document.createElement("canvas"); lab.width = 256; lab.height = 64; const lg = lab.getContext("2d");
  lg.font = "600 34px IBM Plex Sans, sans-serif"; lg.fillStyle = "#ffd166"; lg.fillText("baseline", 8, 44);
  const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.16), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lab), transparent: true, toneMapped: false }));
  sp.rotation.x = -Math.PI / 2; sp.position.set(0.95, 0.006, -0.16); scene.add(sp);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(c.width, c.net_h), new THREE.MeshBasicMaterial({ color: 0x0b0f12, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  net.position.set(0, c.net_h / 2, c.net_z); scene.add(net);
}
// one side = scene + character instance + effects + precomputed frames
function makeSide(key, color) {
  const tech = T[key];
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x24303b); scene.fog = new THREE.Fog(0x24303b, 14, 40);
  scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x2a3540, 1.1));
  const key_ = new THREE.DirectionalLight(0xfff3e4, 2.4); key_.position.set(-3, 6, 4); key_.castShadow = true;
  key_.shadow.mapSize.set(2048, 2048); Object.assign(key_.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 15 }); key_.shadow.bias = -0.0004;
  scene.add(key_); const rim = new THREE.DirectionalLight(0xcfe0ff, 1.0); rim.position.set(2, 3, -4); scene.add(rim);
  court(scene);
  const body = glbs[key === "v6" ? 0 : 1].scene;
  scene.add(body);
  const bones = {}; body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } if (o.isBone) bones[o.name] = o; });
  const boneOf = (n) => bones[n] || bones[THREE.PropertyBinding.sanitizeNodeName(n)];
  const armRoot = boneOf("Bip01 Pelvis").parent; body.updateMatrixWorld(true);
  const rootQinv = armRoot.getWorldQuaternion(new THREE.Quaternion()).invert(), restQ = {};
  for (const b of ch.bones) { const o = boneOf(b.name); if (o) restQ[b.name] = rootQinv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())); }
  const racket = racketGlb.scene.clone(true); racket.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(racket);
  const comp = compileTechnique(ch, tech, sport, layer, { slowRate: 1 });
  const HZ = 240, frames = [];
  for (let t = comp.t0; t <= comp.t1 + 1e-9; t += 1 / HZ) { const r = comp.solve(t); frames.push({ t, delta: r.delta, pos: r.pos, racket: r.racket, com: r.info.com || comOf(ch, r.pos, r.racket) }); }
  const trail = tube(comp.trail.map((r) => r[1]), 0.0075, 0xffb020); scene.add(trail);
  const comPath = tube(frames.filter((_, i) => i % 4 === 0).map((f) => f.com), 0.006, 0x58e0ff, 0.9); scene.add(comPath);
  const comDot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 18, 12), new THREE.MeshBasicMaterial({ color: 0x58e0ff, toneMapped: false })); scene.add(comDot);
  const comShadow = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 24), new THREE.MeshBasicMaterial({ color: 0x58e0ff, toneMapped: false, side: THREE.DoubleSide }));
  comShadow.rotation.x = -Math.PI / 2; scene.add(comShadow);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0335, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd9ec3a, roughness: 0.85 })); ball.castShadow = true; scene.add(ball);
  const inObj = tube(comp.ballIn.filter((_, i) => i % 6 === 0).map((r) => r[1]), 0.004, 0x8ae2ff); scene.add(inObj);
  const outObj = tube(comp.ballOut.filter((_, i) => i % 6 === 0).map((r) => r[1]), 0.005, 0x8ae2ff); scene.add(outObj);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); flash.position.set(...comp.contact); scene.add(flash);
  const Q = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
  function pose(res) {
    const wq = {};
    for (const b of ch.bones) { const o = boneOf(b.name); if (!o) continue;
      const w = Q(res.delta[b.name]).multiply(restQ[b.name]); wq[b.name] = w; const pq = b.parent ? wq[b.parent] : new THREE.Quaternion();
      o.quaternion.copy(pq.clone().invert().multiply(w));
      if (!b.parent || ch.anchor[b.name]) { const pp = b.parent ? res.pos[b.parent] : [0, 0, 0];
        o.position.copy(new THREE.Vector3(res.pos[b.name][0] - pp[0], res.pos[b.name][1] - pp[1], res.pos[b.name][2] - pp[2]).applyQuaternion(pq.clone().invert())); } }
    racket.position.set(...res.racket.origin); racket.quaternion.set(...res.racket.R);
  }
  const phaseAt = (t) => { const ph = tech.phases; let k = 0; for (let i = 0; i < ph.length; i++) { const mid = i ? (ph[i - 1].t + ph[i].t) / 2 : -1e9; if (t >= mid) k = i; } return ph[k]; };
  const ev = tech.locomotion?.events, tcK = comp.tc;
  const locoCue = ev ? [[0.5, 0.78, "Foot-up", "Right foot slides up next to the left"], [0.82, ev.toe_off - 0.035, "Load", "Knees bend, hips forward, back arched"],
    [ev.toe_off - 0.035, ev.toe_off + 0.03, "Leg drive", "Toe-off 0.12 s before contact"], [ev.toe_off + 0.03, tcK - 0.03, "In the air", "Ballistic flight, right leg kicks back"],
    [tcK + 0.05, ev.touchdown, "In the air", "Still flying: land on the left foot"], [ev.touchdown, ev.touchdown + 0.16, "Land", "Left foot inside the court, knees absorb"],
    [ev.touchdown + 0.16, ev.touchdown2 + 0.1, "Recover", "Right leg swings through and lands"]] : [];
  const cueAt = (t) => { for (const [a, b, label, cue] of locoCue) if (t >= a && t < b) return { label, cue }; return phaseAt(t); };
  function show(tau, fx) {
    const t = Math.min(comp.t1, Math.max(comp.t0, tau)), f = frames[Math.min(frames.length - 1, Math.round((t - comp.t0) * HZ))];
    pose(f);
    trail.visible = fx.trail; trail.reveal((t - comp.trail[0][0]) / (comp.trail[comp.trail.length - 1][0] - comp.trail[0][0]));
    comPath.visible = comDot.visible = comShadow.visible = fx.com; comPath.reveal((t - comp.t0) / (comp.t1 - comp.t0));
    comDot.position.set(...f.com); comShadow.position.set(f.com[0], 0.006, f.com[2]);
    inObj.visible = outObj.visible = fx.trail; inObj.reveal((t - comp.tIn0) / (comp.tc - comp.tIn0)); outObj.reveal((t - comp.tc) / (comp.tOut1 - comp.tc));
    const b = comp.ballAt(t); ball.visible = !!b; if (b) ball.position.set(...b);
    const k = t >= comp.tc ? Math.exp(-(t - comp.tc) / 0.035) : 0; flash.visible = t >= comp.tc && k > 0.02; const s = 0.07 + 0.35 * k; flash.scale.set(s, s, s);
    return cueAt(t);
  }
  return { key, scene, comp, show, color };
}
const L = makeSide("v6"), R = makeSide("v7");
status.remove();
// ---------------------------------------------------------------- clock: motion time tau, slow motion around contact
const tEnd = Math.max(L.comp.t1, R.comp.t1) + 0.25;
const st = { tau: 0, playing: !capture, rate: 0.25, speed: 1, fx: { trail: true, com: true } };
const sm = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (6 * x - 15) + 10); };
const tA = 0.98, tB = 1.36, ramp = 0.16;
const speedAt = (tau) => 1 - (1 - st.rate) * sm((tau - (tA - ramp)) / ramp) * (1 - sm((tau - tB) / ramp));
// ---------------------------------------------------------------- UI
const scrub = $("scrub");
$("play").onclick = () => { st.playing = !st.playing; $("play").textContent = st.playing ? "Pause" : "Play"; };
scrub.oninput = () => { st.playing = false; $("play").textContent = "Play"; st.tau = +scrub.value * tEnd; };
$("slow").oninput = (e) => { st.rate = +e.target.value; $("slowv").textContent = `${st.rate.toFixed(2)}×`; };
$("trail").onchange = (e) => (st.fx.trail = e.target.checked); $("com").onchange = (e) => (st.fx.com = e.target.checked);
for (const b of document.querySelectorAll("[data-view]")) b.onclick = () => setView(b.dataset.view);
setView("side");
function draw() {
  const r = stage.getBoundingClientRect(), W = Math.round(r.width), H = Math.round(r.height);
  const sz = renderer.getSize(new THREE.Vector2()); if (sz.x !== W || sz.y !== H) renderer.setSize(W, H, false);
  camera.aspect = (W / 2) / H; camera.updateProjectionMatrix();
  const pl = L.show(st.tau, st.fx), pr = R.show(st.tau, st.fx);
  for (const [side, x] of [[L, 0], [R, W / 2]]) { renderer.setViewport(x, 0, W / 2, H); renderer.setScissor(x, 0, W / 2, H); renderer.render(side.scene, camera); }
  $("cueL").textContent = `${pl.label || pl.name}: ${pl.cue}`; $("cueR").textContent = `${pr.label || pr.name}: ${pr.cue}`;
  const sp = speedAt(st.tau); $("slowtag").hidden = sp > 0.95; $("slowtag").textContent = `SLOW MOTION ${sp.toFixed(2).replace(/^0/, "")}×`;
  $("clock").textContent = `${(st.tau - 1.16 >= 0 ? "+" : "")}${(st.tau - 1.16).toFixed(2)} s from contact`;
  scrub.value = st.tau / tEnd;
}
let last = performance.now();
if (!capture) renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (st.playing) { st.tau += dt * speedAt(st.tau) * st.speed; if (st.tau > tEnd) st.tau = 0; }
  controls.update(); draw();
});
// capture API (video): frame times at a given fps with the same slow motion
window.__cmp = { ready: true, st, setView, draw, tEnd,
  setTau: (tau) => { st.tau = tau; controls.update(); draw(); },
  schedule: (fps = 30, rate = 0.25) => { st.rate = rate; const out = []; let tau = 0; while (tau <= tEnd) { out.push(tau); tau += speedAt(tau) / fps; } return out; } };
