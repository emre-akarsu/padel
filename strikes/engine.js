// Strike player: loads specs/<sport>.json, solves each frame with solver.js and poses the Rocketbox GLB.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadLayer, compileTechnique, timeTable } from "./solver.js?v=12";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x24303b); scene.fog = new THREE.Fog(0x24303b, 14, 40);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
const VIEWS = { side: [[-3.7, 1.6, 2.4], [0, 1.15, 0.25]], front: [[0.3, 1.5, 5.2], [0, 1.1, 0]], back: [[0.6, 1.9, -4.2], [0, 1.2, 0.3]], top: [[-0.2, 5.5, 1.2], [0, 0.9, 0.3]] };
// v11 fit (2026-11-08): strokes that travel (jumping serves land ~0.6 m in, then step) stayed framed for a fixed spot and
// left the screen on phones. FIT = centre and span of the body + racket over the whole stroke, set on every load.
let FIT = { x: 0, z: 0, s: 1 }, curView = "side";
function setView(v) { curView = v; const [p, t] = VIEWS[v];
  const tt = [t[0] + FIT.x, t[1], t[2] + FIT.z], pp = [0, 1, 2].map((i) => tt[i] + (p[i] - t[i]) * FIT.s);
  camera.position.set(...pp); controls.target.set(...tt); controls.update(); }
function fitStroke(c) { let x0 = 9, x1 = -9, z0 = 9, z1 = -9;
  for (let t = c.t0; t <= c.t1 + 1e-9; t += 0.05) { const r = c.solve(t); for (const q of Object.values(r.pos).concat([r.racket.center])) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); } }
  const span = Math.max(x1 - x0, z1 - z0); FIT = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 - 0.25, s: Math.min(1.15, Math.max(1, span / 2.2)) };   // fix 2026-11-08: zoom-out capped (serves were shown ~35% smaller)
  // keep the stock framing for strokes that stay in place (centre near the old target, small span)
  if (Math.abs(FIT.z) < 0.15 && Math.abs(FIT.x) < 0.15 && span < 1.7) FIT = { x: 0, z: 0, s: 1 };
  setView(curView); }
setView("side");
scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x2a3540, 1.1));
const key = new THREE.DirectionalLight(0xfff3e4, 2.4); key.position.set(-3, 6, 4); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 15 }); key.shadow.bias = -0.0004;
scene.add(key); const rim = new THREE.DirectionalLight(0xcfe0ff, 1.0); rim.position.set(2, 3, -4); scene.add(rim);

// ---------------------------------------------------------------- court (per sport)
const court = new THREE.Group(); scene.add(court);
function buildCourt(c) {
  court.clear();
  const g = new THREE.Mesh(new THREE.PlaneGeometry(c.width + 6, c.length + 8), new THREE.MeshStandardMaterial({ color: c.color || 0x1d5aa6, roughness: 0.92 }));
  g.rotation.x = -Math.PI / 2; g.position.z = c.net_z - c.length / 4; g.receiveShadow = true; court.add(g);
  const lm = new THREE.MeshBasicMaterial({ color: 0xe9eef2 });
  const line = (x0, z0, x1, z1, w = 0.05) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(Math.abs(x1 - x0), w), Math.max(Math.abs(z1 - z0), w)), lm);
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.003, (z0 + z1) / 2); court.add(m); };
  for (const l of c.lines || []) line(...l);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(c.width, c.net_h), new THREE.MeshBasicMaterial({ color: 0x0b0f12, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  net.position.set(0, c.net_h / 2, c.net_z); court.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(c.width, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 })); tape.position.set(0, c.net_h, c.net_z); court.add(tape);
  if (c.walls) for (const z of [c.net_z - c.length / 2]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(c.width, 3), new THREE.MeshStandardMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    w.position.set(0, 1.5, z); court.add(w);
  }
}

// ---------------------------------------------------------------- character
const world = new THREE.Group(); scene.add(world);           // mirrored (scale.x = -1) for left-handers
const fx = new THREE.Group(); world.add(fx);
let ch, bones = {}, restQ = {}, armRoot;
// shared layer: body profile (bone map, ROM), implements, grips -> see specs/README.md
const { ch: chL, layer } = await loadLayer(async (p) => (await fetch(p, { cache: "no-cache" })).json());
ch = chL;
const gltf = await new GLTFLoader().loadAsync("assets/player.glb");
world.add(gltf.scene);
gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } if (o.isBone) bones[o.name] = o; });
const boneOf = (n) => bones[n] || bones[THREE.PropertyBinding.sanitizeNodeName(n)];
armRoot = boneOf("Bip01 Pelvis").parent; gltf.scene.updateMatrixWorld(true);
const rootQinv = armRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
for (const b of ch.bones) { const o = boneOf(b.name); if (o) restQ[b.name] = rootQinv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion())); }
const Q = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
function applyPose(res) {
  const wq = {};
  for (const b of ch.bones) {
    const o = boneOf(b.name); if (!o) continue;
    const w = Q(res.delta[b.name]).multiply(restQ[b.name]); wq[b.name] = w;
    const pq = b.parent ? wq[b.parent] : new THREE.Quaternion();
    o.quaternion.copy(pq.clone().invert().multiply(w));
    if (!b.parent || ch.anchor[b.name]) {
      const pp = b.parent ? res.pos[b.parent] : [0, 0, 0];
      const v = new THREE.Vector3(res.pos[b.name][0] - pp[0], res.pos[b.name][1] - pp[1], res.pos[b.name][2] - pp[2]).applyQuaternion(pq.clone().invert());
      o.position.copy(v);
    }
  }
}

// ---------------------------------------------------------------- effects
const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,240,200,.85)"); r.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
function tube(points, r, color, glow) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const n = Math.max(8, points.length - 1);
  const core = new THREE.Mesh(new THREE.TubeGeometry(curve, n, r, 6, false), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, n, r * 3.2, 8, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const grp = new THREE.Group(); grp.add(core); if (glow) grp.add(halo); grp.userData = { n, parts: [[core, 6], [halo, 8]] };
  grp.reveal = (f) => { for (const [m, rad] of grp.userData.parts) m.geometry.setDrawRange(0, Math.round(Math.min(1, Math.max(0, f)) * n) * rad * 6); };
  return grp;
}
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0335, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd9ec3a, roughness: 0.85 }));
ball.castShadow = true; fx.add(ball);
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
fx.add(flash);
let trailObj, inObj, outObj;
// tennis racket (procedural): local -Y = handle-to-head direction from the wrist, +Z = face normal; head centre 0.44 m
// implement models (implements/<id>.json -> model): placed rigidly from the solved grip socket every frame
const implModels = {};
for (const [id, impl] of Object.entries(layer.implements)) {
  const g = await new GLTFLoader().loadAsync(impl.model.replace(/^\.\.\//, ""));
  g.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.scene.visible = false; g.scene.userData.keep = true; fx.add(g.scene); implModels[id] = g.scene;
}
let racketObj = null;
function placeRacket(rk) { if (!racketObj) return; racketObj.position.set(...rk.origin); racketObj.quaternion.set(rk.R[0], rk.R[1], rk.R[2], rk.R[3]); }

// ---------------------------------------------------------------- state / UI
// every ideal stroke's slow pass lasts about SLOW_S seconds at speed 1x (emre: 3-4 s swings).
// Fix 2026-11-08: the first version (e2759e7) sped the whole slow pass up uniformly, so preparation and recovery
// played 1.1-2.0x FASTER than real time (bandeja 2x). Now only the slow-motion depth changes: outside the slow
// window the stroke always runs at real time, and the slow-motion rate around contact is raised just enough
// to land on SLOW_S (never above 0.5x, so contact stays visibly slow). A slow-motion rate set by hand on the slider is used as is.
const SLOW_S = 3.5;
function fitSlow(c, rate0) { if (state.slow != null || !(rate0 < 1)) return;
  const dt = 0.002, W = []; for (let t = c.t0; t < c.t1; t += dt) W.push((1 - c.speed(t)) / (1 - rate0));
  const len = (r) => W.reduce((T, w) => T + dt / (1 - (1 - r) * w), 0);
  if (len(rate0) <= SLOW_S) return; let lo = rate0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (len(m) > SLOW_S) lo = m; else hi = m; }
  const r = Math.min(0.5, hi), w0 = c.speed; c.speed = (t) => 1 - (1 - r) * (1 - w0(t)) / (1 - rate0); c.fitRate = r; }
function tt(c) { return timeTable(c, 240, state.speed, state.replay); }
const state = { sports: {}, sport: null, tech: null, comp: null, table: [], idx: 0, playing: true, speed: 1, slow: null, hand: "R",
                contact: 0, replay: true, trail: true };
const index = await (await fetch("specs/index.json")).json();
const url = new URL(location.href);
// sports = specs/index.json + (on GitHub Pages) every specs/<sport>.json found via the public contents API + ?sport=
let found = [];
if (location.hostname.endsWith("github.io")) {
  try {
    const owner = location.hostname.split(".")[0], repo = location.pathname.split("/")[1], dir = location.pathname.split("/").slice(2, -1).join("/");
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${dir}/specs?ref=gh-pages`);
    if (r.ok) found = (await r.json()).map((f) => f.name).filter((n) => n.endsWith(".json") && n !== "index.json").map((n) => n.slice(0, -5));
  } catch (e) { /* offline or rate-limited: index.json is enough */ }
}
const sportIds = [...new Set([...index.sports, ...found, ...(url.searchParams.get("sport") ? [url.searchParams.get("sport")] : [])])];
for (const s of sportIds) { try { state.sports[s] = await (await fetch(`specs/${s}.json?v=13`, { cache: "no-cache" })).json(); } catch (e) { console.warn("spec", s, e); } }
for (const s of [...sportIds]) if (!state.sports[s]) sportIds.splice(sportIds.indexOf(s), 1);
const selSport = $("sport"), selTech = $("tech");
for (const s of sportIds) selSport.add(new Option(state.sports[s].name, s));
function fillTech() { selTech.innerHTML = ""; for (const t of state.sports[selSport.value].techniques) selTech.add(new Option(t.name, t.id)); }
selSport.onchange = () => { fillTech(); load(); }; selTech.onchange = () => load();
function load() {
  state.sport = state.sports[selSport.value]; state.tech = state.sport.techniques.find((t) => t.id === selTech.value);
  buildCourt(state.sport.court); compile();
  for (const o of Object.values(implModels)) o.visible = false;
  racketObj = implModels[state.tech.implement || state.sport.implement] || null; if (racketObj) racketObj.visible = true;
  const t = state.tech; $("techname").textContent = t.name; $("techfam").textContent = `${state.sport.name} · ${t.family}`;
  $("techdesc").textContent = t.summary || ""; $("arbtn").hidden = !t.ar; if (t.ar) $("arbtn").href = t.ar;
  $("phases").innerHTML = t.phases.map((p, i) => `<li data-i="${i}"><b>${p.label || p.name}</b><span>${p.cue}</span></li>`).join("");
  const u = new URL(location.href); u.searchParams.set("sport", selSport.value); u.searchParams.set("tech", selTech.value); history.replaceState(null, "", u);
}
function compile() {
  const t = state.tech; const rate = state.slow ?? t.slowmo?.rate ?? 1; $("slow").value = rate; $("slowv").textContent = `${rate.toFixed(2)}×`;
  state.comp = compileTechnique(ch, t, state.sport, layer, { slowRate: rate, contactHeight: state.contact });
  fitSlow(state.comp, rate); if (state.comp.fitRate) { $("slow").value = state.comp.fitRate; $("slowv").textContent = `${state.comp.fitRate.toFixed(2)}×`; }
  state.table = tt(state.comp); state.idx = 0;
  try { fitStroke(state.comp); } catch (e) { console.warn('fit', e); }
  for (const o of [trailObj, inObj, outObj]) if (o) fx.remove(o);
  const c = state.comp;
  trailObj = tube(c.trail.map((r) => r[1]), 0.0075, 0xffb020, true); fx.add(trailObj);
  inObj = tube(c.ballIn.filter((_, i) => i % 6 === 0).map((r) => r[1]), 0.004, 0x58c8ff, true); fx.add(inObj);
  outObj = tube(c.ballOut.filter((_, i) => i % 6 === 0).map((r) => r[1]), 0.005, 0x8ae2ff, true); fx.add(outObj);
  flash.position.set(...c.contact);
}
function phaseAt(t) {
  const ph = state.tech.phases; let k = 0;
  for (let i = 0; i < ph.length; i++) { const mid = i ? (ph[i - 1].t + ph[i].t) / 2 : -1e9; if (t >= mid) k = i; }
  return k;
}
function frame(i) {
  const c = state.comp; const [t, spd, part] = state.table[Math.min(state.table.length - 1, Math.max(0, i | 0))];
  const res = c.solve(t); applyPose(res); placeRacket(res.racket);
  const f = (t - c.trail[0][0]) / (c.trail[c.trail.length - 1][0] - c.trail[0][0]);
  trailObj.visible = state.trail; trailObj.reveal(f);
  inObj.visible = outObj.visible = state.trail;
  inObj.reveal((t - c.tIn0) / (c.tc - c.tIn0)); outObj.reveal((t - c.tc) / (c.tOut1 - c.tc));
  const b = c.ballAt(t); ball.visible = !!b; if (b) ball.position.set(...b);
  const k = t >= c.tc ? Math.exp(-(t - c.tc) / 0.035) : 0; flash.visible = t >= c.tc; const s = 0.07 + 0.35 * k; flash.scale.set(s, s, s);
  const pi = phaseAt(t), ph = state.tech.phases[pi];
  $("chip").textContent = part === "real" ? "Full speed" : `${pi + 1} · ${ph.label || ph.name}`;
  $("cue").textContent = part === "real" ? "The same stroke at full speed" : ph.cue;
  const tag = $("slowtag"); tag.hidden = !(part === "slow" && spd < 0.95); tag.textContent = `SLOW MOTION ${spd.toFixed(2).replace(/^0/, "")}×`;
  $("clock").textContent = `${(t - c.t0).toFixed(2)} s`;
  $("scrub").value = i / (state.table.length - 1);
  for (const li of $("phases").children) li.classList.toggle("on", +li.dataset.i === pi && part !== "real");
}
// controls
$("play").onclick = () => { state.playing = !state.playing; $("play").textContent = state.playing ? "Pause" : "Play"; };
$("scrub").oninput = (e) => { state.playing = false; $("play").textContent = "Play"; state.idx = Math.round(+e.target.value * (state.table.length - 1)); frame(state.idx); };
$("speed").oninput = (e) => { state.speed = +e.target.value; $("speedv").textContent = `${state.speed.toFixed(2)}×`; const f = state.idx / state.table.length; state.table = tt(state.comp); state.idx = Math.floor(f * state.table.length); };
$("slow").oninput = (e) => { state.slow = +e.target.value; compile(); };
$("contact").oninput = (e) => { state.contact = +e.target.value; $("contactv").textContent = `${state.contact >= 0 ? "+" : ""}${Math.round(state.contact * 100)} cm`; compile(); };
$("hand").onclick = () => { state.hand = state.hand === "R" ? "L" : "R"; world.scale.x = state.hand === "R" ? 1 : -1; $("hand").textContent = state.hand === "R" ? "Right-handed" : "Left-handed"; };
$("replay").onchange = (e) => { state.replay = e.target.checked; compile(); };
$("trail").onchange = (e) => { state.trail = e.target.checked; };
for (const b of document.querySelectorAll("[data-view]")) b.onclick = () => setView(b.dataset.view);
fillTech();
if (url.searchParams.get("sport")) selSport.value = url.searchParams.get("sport"), fillTech();
if (url.searchParams.get("tech")) selTech.value = url.searchParams.get("tech");
load();
window.__strike = { state, frame, applyPose, compile, setView, load, renderer, scene, camera, controls, selSport, selTech, fx, ready: true };
// loop
function resize() { const r = stage.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage); resize();
let last = performance.now(), acc = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;   // rAF time can precede performance.now()
  const n = state.table.length;
  if (state.playing) { acc += dt * 240; const steps = Math.floor(acc); acc -= steps; state.idx += steps; }
  state.idx = ((state.idx % n) + n) % n;
  frame(state.idx); controls.update(); renderer.render(scene, camera);
});
