// Strike solver: high-level phase targets -> per-bone rotations for the Rocketbox (Bip01) character.
// Dependency-free so it runs in the browser (three.js page) and in Node (smoothness check, AR baking).
// Frame (same as demos/ar_swing/rig.json and glTF): Y up, player faces +Z (the net), player's right side is -X.
// Quaternions are [x, y, z, w]. Angles in specs are degrees, distances metres, times seconds.

// ------------------------------------------------------------------ vector / quaternion helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
const qaxis = (ax, deg) => { const a = norm(ax), h = deg * Math.PI / 360, s = Math.sin(h); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)]; };
const QI = [0, 0, 0, 1];
function qfrommat(x, y, z) {           // columns x, y, z
  const m00 = x[0], m11 = y[1], m22 = z[2], t = m00 + m11 + m22;
  let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s]; }
  const l = Math.hypot(...q); return q.map((v) => v / l);
}
// world rotation whose local -Y points along downDir and whose local +Z leans toward hint (as gen.py basis_quat)
function basis(downDir, hint) {
  const y = mul(norm(downDir), -1);
  let z = sub(hint, mul(y, dot(hint, y)));
  if (len(z) < 1e-4) z = cross(y, [1, 0, 0]);
  z = norm(z); const x = cross(y, z);
  return qfrommat(x, y, z);
}
function rotBetween(a, b) {            // minimal-arc rotation taking unit a to unit b (= Blender rotation_difference)
  a = norm(a); b = norm(b); const d = dot(a, b);
  if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a); return qaxis(ax, 180); }
  const c = cross(a, b); const q = [c[0], c[1], c[2], 1 + d]; const l = Math.hypot(...q); return q.map((v) => v / l);
}
export const V = { add, sub, mul, dot, cross, len, norm, qmul, qinv, qrot, qaxis, basis };

// ------------------------------------------------------------------ character model
const B = "Bip01 ";
const SEG = {   // rig segment -> bones driven by it (as v2-v4 retarget)
  pelvis: ["Pelvis"], spine: ["Spine", "Spine1"], chest: ["Spine2", "L Clavicle", "R Clavicle"], neck: ["Neck", "Head"],
  r_upper: ["R UpperArm"], r_fore: ["R Forearm"], r_hand: ["R Hand"], l_upper: ["L UpperArm"], l_fore: ["L Forearm"], l_hand: ["L Hand"],
  r_thigh: ["R Thigh"], r_shin: ["R Calf"], r_foot: ["R Foot"], l_thigh: ["L Thigh"], l_shin: ["L Calf"], l_foot: ["L Foot"],
};
const ALIGN = {  // limb bones aligned to the rig's straight-down rest via the joint-to-joint direction
  "R UpperArm": "R Forearm", "R Forearm": "R Hand", "R Hand": "R Finger2", "L UpperArm": "L Forearm", "L Forearm": "L Hand",
  "L Hand": "L Finger2", "R Thigh": "R Calf", "R Calf": "R Foot", "L Thigh": "L Calf", "L Calf": "L Foot",
};
export const RACKET_CENTER = 0.33;   // sweet spot distance from the wrist along the racket (rig.json racket_center)

export function createCharacter(skel, opt = {}) {
  const bones = skel.bones.map((b) => ({ ...b }));
  const by = Object.fromEntries(bones.map((b) => [b.name, b]));
  const depth = (b) => (b.parent ? 1 + depth(by[b.parent]) : 0);
  bones.sort((a, b) => depth(a) - depth(b));
  const H = (n) => by[B + n].head;
  const A = {};
  for (const [bn, child] of Object.entries(ALIGN)) A[B + bn] = rotBetween(sub(H(child), H(bn)), [0, -1, 0]);
  const segOf = {};
  for (const [s, list] of Object.entries(SEG)) for (const n of list) segOf[B + n] = s;
  const L = {
    r_upper: len(sub(H("R Forearm"), H("R UpperArm"))), r_fore: len(sub(H("R Hand"), H("R Forearm"))),
    l_upper: len(sub(H("L Forearm"), H("L UpperArm"))), l_fore: len(sub(H("L Hand"), H("L Forearm"))),
    r_thigh: len(sub(H("R Calf"), H("R Thigh"))), r_shin: len(sub(H("R Foot"), H("R Calf"))),
    l_thigh: len(sub(H("L Calf"), H("L Thigh"))), l_shin: len(sub(H("L Foot"), H("L Calf"))),
  };
  const ankleH = (H("R Foot")[1] + H("L Foot")[1]) / 2;
  const pelvis0 = H("Pelvis");
  // finger grip curl (world-rest axis = knuckle line, sign so fingers close toward the palm), as posing_rb
  const curl = {};
  const grip = opt.grip ?? { R: 1.0, L: 0.35 };
  for (const s of ["R", "L"]) {
    const h = H(`${s} Hand`), d = norm(sub(H(`${s} Finger2`), h));
    let a = norm(sub(H(`${s} Finger1`), H(`${s} Finger4`))); a = norm(sub(a, mul(d, dot(a, d))));
    const inward = norm([-h[0], 0, 0]); const n0 = norm(add(inward, [0, -1, 0]));
    let n = cross(d, a); if (dot(n, n0) < 0) n = mul(n, -1);
    const sgn = dot(cross(a, d), n) > 0 ? -1 : 1;
    const ax = mul(a, sgn), k = grip[s];
    for (const f of "1234") [55, 75, 45].forEach((deg, j) => { curl[B + `${s} Finger${f}${j ? j : ""}`] = qaxis(ax, deg * k); });
    curl[B + `${s} Finger01`] = qaxis(ax, 25 * k); curl[B + `${s} Finger02`] = qaxis(ax, 30 * k);
  }
  return { bones, by, A, segOf, L, ankleH, pelvis0, curl, H };
}

// bones whose position follows another bone's frame instead of their parent (Bip01 hangs the clavicles off the
// neck and the thighs off the spine; the retarget treats them as chest- and pelvis-anchored, as in v2-v4)
export const ANCHOR = { [B + "R Clavicle"]: B + "Spine2", [B + "L Clavicle"]: B + "Spine2", [B + "R Thigh"]: B + "Pelvis", [B + "L Thigh"]: B + "Pelvis" };
function fk(ch, D, pel) {
  const delta = {}, pos = {};
  for (const b of ch.bones) {
    const seg = ch.segOf[b.name];
    if (seg) delta[b.name] = D[seg] ? (ch.A[b.name] ? qmul(D[seg], ch.A[b.name]) : D[seg]) : QI;
    else if (b.parent) delta[b.name] = ch.curl[b.name] ? qmul(delta[b.parent], ch.curl[b.name]) : delta[b.parent];
    else delta[b.name] = QI;
    const par = ANCHOR[b.name] || b.parent;
    if (!b.parent) pos[b.name] = pel;
    else pos[b.name] = add(pos[par], qrot(delta[par], sub(b.head, ch.by[par].head)));
  }
  return { delta, pos };
}
// smooth limb-length limit: identity below 92 % of full reach, then eases (C-infinity) toward 99.9 %
function softReach(d, L, dmin) {
  const a = 0.92 * L, b = 0.999 * L;
  if (d > a) d = a + (b - a) * Math.tanh((d - a) / (b - a));
  if (d < dmin + 0.05) d = dmin + 0.05 * Math.exp((d - dmin - 0.05) / 0.05);
  return d;
}
// ------------------------------------------------------------------ pose solve
// p (one phase, after interpolation):
//  pelvis [x,y,z] world; yaw, lean, chest_yaw, chest_roll, head_pitch (deg)
//  r_arm / l_arm: either {hand:[x,y,z], pole:[x,y,z], dir:[..], face:[..]} in the chest frame relative to the shoulder,
//                 or {dirs:[upper, fore, hand]} segment directions in the chest frame (gen.py style).
//  r_leg / l_leg: {foot:[x,z], yaw, lift} planted ankle target (world) solved by IK, or {dirs:[thigh, shin]} (world).
export function solvePose(ch, p, rc = RACKET_CENTER) {
  const D = {};
  const chestQ = (yawSum) => qaxis([0, 1, 0], yawSum);
  D.pelvis = qmul(qaxis([0, 1, 0], p.yaw), qaxis([1, 0, 0], p.lean * 0.4));
  D.spine = qmul(D.pelvis, qaxis([1, 0, 0], p.lean * 0.6));
  D.chest = qmul(D.spine, qmul(qaxis([0, 1, 0], p.chest_yaw), qaxis([0, 0, 1], p.chest_roll || 0)));
  D.neck = qmul(D.chest, qmul(qaxis([0, 1, 0], p.head_yaw || 0), qaxis([1, 0, 0], p.head_pitch - p.lean)));
  const armFrame = chestQ(p.yaw + p.chest_yaw);        // arm targets are given in this frame (as gen.py)
  const fwd = qrot(armFrame, [0, 0, 1]);
  // --- pelvis height: lower automatically so that planted feet never over-stretch the legs
  let pel = p.pelvis.slice();
  const hipOf = (pelPos, s) => add(pelPos, qrot(D.pelvis, sub(ch.H(`${s} Thigh`), ch.pelvis0)));
  const ankleTarget = (leg) => [leg.foot[0], ch.ankleH + (leg.lift || 0), leg.foot[1]];
  const softplus = (x, k) => (x > 20 * k ? x : k * Math.log1p(Math.exp(x / k)));
  for (let it = 0; it < 5; it++) {                // smooth (C-infinity) lowering, no kink when it engages
    let need = 0;
    for (const s of ["R", "L"]) {
      const leg = p[s === "R" ? "r_leg" : "l_leg"]; if (!leg.foot) continue;
      const k = s.toLowerCase(), reach = (ch.L[`${k}_thigh`] + ch.L[`${k}_shin`]) * 0.985;
      const d = len(sub(ankleTarget(leg), hipOf(pel, s)));
      need = Math.max(need, softplus(d - reach, 0.006));
    }
    if (need < 1e-6) break;
    pel = [pel[0], pel[1] - need * 0.9, pel[2]];
  }
  // --- arms (shoulder positions from the trunk FK)
  const info = { reach: {} };
  const trunk = fk(ch, D, pel, null);
  for (const side of ["r", "l"]) {
    const S = side.toUpperCase(), arm = p[`${side}_arm`];
    const sh = trunk.pos[B + `${S} UpperArm`];
    let up, lo, handDir, faceHint, bendHint = fwd;
    if (arm.dirs) {
      up = qrot(armFrame, norm(arm.dirs[0])); lo = qrot(armFrame, norm(arm.dirs[1])); handDir = qrot(armFrame, norm(arm.dirs[2]));
      faceHint = side === "r" ? norm(add(mul(norm(cross(handDir, [1, 0, 0])), 0.3), fwd)) : fwd;
      if (arm.face) faceHint = qrot(armFrame, norm(arm.face));
    } else {
      const L1 = ch.L[`${side}_upper`], L2 = ch.L[`${side}_fore`];
      const F = arm.frame === "world" ? QI : armFrame;          // world: absolute targets; chest: relative to the shoulder
      let W = arm.frame === "world" ? arm.hand.slice() : add(sh, qrot(armFrame, arm.hand));
      let dv = sub(W, sh), d = len(dv); const u = norm(dv);
      info.reach[side] = d / (L1 + L2);
      d = softReach(d, L1 + L2, Math.abs(L1 - L2) + 0.03);
      const pole = qrot(F, norm(arm.pole));
      let pp = sub(pole, mul(u, dot(pole, u))); if (len(pp) < 1e-5) pp = cross(u, [0, 1, 0]); pp = norm(pp);
      const a = (L1 * L1 + d * d - L2 * L2) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const E = add(sh, add(mul(u, a), mul(pp, h))); W = add(sh, mul(u, d)); bendHint = pp;
      up = norm(sub(E, sh)); lo = norm(sub(W, E));
      handDir = arm.head ? norm(sub(arm.head, W)) : arm.dir ? qrot(F, norm(arm.dir)) : lo;
      faceHint = arm.face ? qrot(F, norm(arm.face)) : pole;
    }
    // twist: IK arms orient the upper arm toward the authored elbow pole (smooth, defined even when the arm is
    // straight); direction-mode arms use gen.py's chest-forward hint so the reference bandeja matches v1-v4
    const upHint = arm.dirs ? fwd : bendHint;
    D[`${side}_upper`] = basis(up, upHint);
    D[`${side}_fore`] = basis(lo, arm.dirs ? fwd : add(faceHint, mul(qrot(D[`${side}_upper`], [0, 0, 1]), 0.5)));
    D[`${side}_hand`] = basis(handDir, faceHint);
  }
  // --- legs
  for (const side of ["r", "l"]) {
    const S = side.toUpperCase(), leg = p[`${side}_leg`];
    const hip = hipOf(pel, S);
    const facing = qrot(qaxis([0, 1, 0], (leg.yaw ?? p.yaw * 0.6)), [0, 0, 1]);
    let th, sh;
    if (leg.dirs) { th = norm(leg.dirs[0]); sh = norm(leg.dirs[1]); }
    else {
      const L1 = ch.L[`${side}_thigh`], L2 = ch.L[`${side}_shin`], T = ankleTarget(leg);
      const u = norm(sub(T, hip)); let d = softReach(len(sub(T, hip)), L1 + L2, Math.abs(L1 - L2) + 0.05);
      const kneeDir = norm(add(facing, [side === "r" ? -0.12 : 0.12, 0, 0]));
      let pp = sub(kneeDir, mul(u, dot(kneeDir, u))); pp = norm(pp);
      const a = (L1 * L1 + d * d - L2 * L2) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const K = add(hip, add(mul(u, a), mul(pp, h)));
      th = norm(sub(K, hip)); sh = norm(sub(add(hip, mul(u, d)), K));
    }
    D[`${side}_thigh`] = basis(th, facing); D[`${side}_shin`] = basis(sh, facing);
    const lift = leg.lift || 0, pitch = Math.asin(Math.min(0.6, lift / 0.16)) * 180 / Math.PI;
    D[`${side}_foot`] = qmul(qaxis([0, 1, 0], leg.yaw ?? p.yaw * 0.6), qaxis([1, 0, 0], pitch));
  }
  let { delta, pos } = fk(ch, D, pel, null);
  if (p.r_leg.dirs || p.l_leg.dirs) {     // direction-mode legs (reference port): drop so the lower foot touches the floor
    let low = Infinity;
    for (const s of ["R", "L"]) low = Math.min(low, pos[B + `${s} Toe0`][1] - ch.H(`${s} Toe0`)[1], pos[B + `${s} Foot`][1] - ch.H(`${s} Foot`)[1]);
    pel = [pel[0], pel[1] - low, pel[2]]; ({ delta, pos } = fk(ch, D, pel, null));
  }
  const wrist = pos[B + "R Hand"], Dh = D.r_hand;
  const racket = { wrist, dir: qrot(Dh, [0, -1, 0]), normal: qrot(Dh, [0, 0, 1]), center: add(wrist, qrot(Dh, [0, -rc, 0])) };
  return { delta, pos, racket, pelvis: pel, info, D };
}

// Pose from an interpolated state: segment rotations D (already interpolated), pelvis, planted-foot params and the
// two-hand weight. Legs are re-solved by IK to the planted feet with the knee pole taken from the interpolated thigh
// rotation (always defined, so no flips); the free hand is pulled onto the handle for two-handed strokes.
function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) { const r = a.map((v, i) => v + t * (b[i] - v)); const l = Math.hypot(...r); return r.map((v) => v / l); }
  const th = Math.acos(d), s0 = Math.sin((1 - t) * th) / Math.sin(th), s1 = Math.sin(t * th) / Math.sin(th);
  return a.map((v, i) => s0 * v + s1 * b[i]);
}
function twoBone(root, target, L1, L2, pole, dmin) {
  const u = norm(sub(target, root)); const d = softReach(len(sub(target, root)), L1 + L2, dmin);
  let pp = sub(pole, mul(u, dot(pole, u))); if (len(pp) < 1e-6) pp = cross(u, [0, 1, 0]); pp = norm(pp);
  const a = (L1 * L1 + d * d - L2 * L2) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const K = add(root, add(mul(u, a), mul(pp, h)));
  return { d1: norm(sub(K, root)), d2: norm(sub(add(root, mul(u, d)), K)), pp };
}
export function poseFromState(ch, st, rc = RACKET_CENTER) {
  const D = { ...st.D }; let pel = st.pelvis.slice();
  const hipOf = (pelPos, s) => add(pelPos, qrot(D.pelvis, sub(ch.H(`${s} Thigh`), ch.pelvis0)));
  if (st.feet) {
    const ankleT = (f) => [f.foot[0], ch.ankleH + (f.lift || 0), f.foot[1]];
    const softplus = (x, k) => (x > 20 * k ? x : k * Math.log1p(Math.exp(x / k)));
    for (let it = 0; it < 5; it++) {
      let need = 0;
      for (const s of ["r", "l"]) need = Math.max(need, softplus(len(sub(ankleT(st.feet[s]), hipOf(pel, s.toUpperCase()))) - (ch.L[`${s}_thigh`] + ch.L[`${s}_shin`]) * 0.985, 0.006));
      if (need < 1e-6) break; pel = [pel[0], pel[1] - need * 0.9, pel[2]];
    }
    for (const s of ["r", "l"]) {
      const f = st.feet[s], pole = qrot(D[`${s}_thigh`], [0, 0, 1]);
      const r = twoBone(hipOf(pel, s.toUpperCase()), ankleT(f), ch.L[`${s}_thigh`], ch.L[`${s}_shin`], pole, Math.abs(ch.L[`${s}_thigh`] - ch.L[`${s}_shin`]) + 0.05);
      D[`${s}_thigh`] = basis(r.d1, r.pp); D[`${s}_shin`] = basis(r.d2, r.pp);
      const pitch = Math.asin(Math.min(0.6, (f.lift || 0) / 0.16)) * 180 / Math.PI;
      D[`${s}_foot`] = qmul(qaxis([0, 1, 0], f.yaw), qaxis([1, 0, 0], pitch));
    }
  }
  if (st.twoHand > 1e-3) {
    const tmp = fk(ch, D, pel); const w = Math.min(1, st.twoHand);
    const handle = add(tmp.pos[B + "R Hand"], mul(qrot(D.r_hand, [0, -1, 0]), 0.085));
    const tgt = add(tmp.pos[B + "L Hand"], mul(sub(handle, tmp.pos[B + "L Hand"]), w));
    const r = twoBone(tmp.pos[B + "L UpperArm"], tgt, ch.L.l_upper, ch.L.l_fore, qrot(D.l_upper, [0, 0, 1]), Math.abs(ch.L.l_upper - ch.L.l_fore) + 0.03);
    D.l_upper = basis(r.d1, r.pp); D.l_fore = basis(r.d2, r.pp); D.l_hand = slerp(D.l_hand, D.r_hand, w);
  }
  const { delta, pos } = fk(ch, D, pel);
  const wrist = pos[B + "R Hand"], Dh = D.r_hand;
  const racket = { wrist, dir: qrot(Dh, [0, -1, 0]), normal: qrot(Dh, [0, 0, 1]), center: add(wrist, qrot(Dh, [0, -rc, 0])) };
  return { delta, pos, racket, pelvis: pel, info: { reach: {} }, D };
}
// ------------------------------------------------------------------ interpolation
// Flatten a phase pose to numbers (fixed key order), keep a template to rebuild. Feet use monotone cubic (planted
// feet stay exactly still), everything else a clamped C2 cubic spline (zero velocity at the loop ends).
function flatten(obj, path = "", out = []) {
  if (Array.isArray(obj)) {
    if (obj.length && Array.isArray(obj[0])) obj.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
    else obj.forEach((v, i) => out.push([`${path}[${i}]`, v]));
  } else if (obj && typeof obj === "object") for (const k of Object.keys(obj).sort()) flatten(obj[k], path ? `${path}.${k}` : k, out);
  else out.push([path, obj]);
  return out;
}
function setPath(o, path, v) {
  const parts = path.match(/[^.[\]]+/g); let cur = o;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i], nk = parts[i + 1];
    if (cur[k] === undefined) cur[k] = /^\d+$/.test(nk) ? [] : {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = v;
}
function clampedSpline(t, y) {          // returns f(x): C2 cubic through (t_i, y_i), f'(t0) = f'(tn) = 0
  const n = t.length - 1, h = []; for (let i = 0; i < n; i++) h.push(t[i + 1] - t[i]);
  // clamp: m_0 = m_n = 0
  const m = new Array(n + 1).fill(0);
  const A2 = [], B2 = [], C2 = [], R2 = [];
  for (let i = 1; i < n; i++) { A2.push(i > 1 ? h[i] : 0); B2.push(2 * (h[i - 1] + h[i])); C2.push(i < n - 1 ? h[i - 1] : 0);
    R2.push(3 * (h[i - 1] * (y[i + 1] - y[i]) / h[i] + h[i] * (y[i] - y[i - 1]) / h[i - 1])); }
  const N = n - 1;
  if (N > 0) {      // Thomas algorithm
    const cp = new Array(N), rp = new Array(N);
    cp[0] = C2[0] / B2[0]; rp[0] = R2[0] / B2[0];
    for (let i = 1; i < N; i++) { const den = B2[i] - A2[i] * cp[i - 1]; cp[i] = C2[i] / den; rp[i] = (R2[i] - A2[i] * rp[i - 1]) / den; }
    m[N] = rp[N - 1]; for (let i = N - 2; i >= 0; i--) m[i + 1] = rp[i] - cp[i] * m[i + 2];
  }
  return hermite(t, y, m);
}
function pchip(t, y) {                  // monotone cubic (Fritsch-Carlson), zero end slopes
  const n = t.length - 1, d = [], m = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) d.push((y[i + 1] - y[i]) / (t[i + 1] - t[i]));
  for (let i = 1; i < n; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * (t[i + 1] - t[i]) + (t[i] - t[i - 1]), w2 = (t[i + 1] - t[i]) + 2 * (t[i] - t[i - 1]); m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return hermite(t, y, m);
}
function hermite(t, y, m) {
  const n = t.length - 1;
  return (x) => {
    if (x <= t[0]) return y[0]; if (x >= t[n]) return y[n];
    let i = 0; while (i < n - 1 && x > t[i + 1]) i++;
    const h = t[i + 1] - t[i], s = (x - t[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

// ------------------------------------------------------------------ technique compile
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (6 * x - 15) + 10); };   // C2 smootherstep
export function compileTechnique(ch, tech, sport, opts = {}) {
  const ph = tech.phases; const T = ph.map((p) => p.t);
  const contactOffset = opts.contactHeight || 0;
  const iC = ph.findIndex((p) => p.name === (tech.contact?.phase || "contact"));
  const tc = T[iC];
  const rc = sport.implement?.grip_offset ?? RACKET_CENTER;
  // 1) solve every phase key (IK on clean authored targets)
  const keyPose = ph.map((P, i) => {
    const q = JSON.parse(JSON.stringify(P.pose));
    if (contactOffset && i === iC) { if (q.r_arm.hand) { q.r_arm.hand[1] += contactOffset; if (q.r_arm.head) q.r_arm.head[1] += contactOffset; } q.pelvis[1] += contactOffset * 0.25; }
    return q;
  });
  const keySol = keyPose.map((q) => solvePose(ch, q, rc));
  // 2) C2 spline per quaternion component (sign-aligned key to key, then normalised) for every segment rotation
  const segs = Object.keys(keySol[0].D), qf = {};
  for (const sg of segs) {
    const qs = []; for (const k of keySol) { let q = k.D[sg]; const pr = qs[qs.length - 1]; if (pr && pr[0] * q[0] + pr[1] * q[1] + pr[2] * q[2] + pr[3] * q[3] < 0) q = q.map((v) => -v); qs.push(q); }
    qf[sg] = [0, 1, 2, 3].map((c) => clampedSpline(T, qs.map((q) => q[c])));
  }
  const pf = [0, 1, 2].map((c) => clampedSpline(T, keySol.map((k) => k.pelvis[c])));
  // 3) planted feet: monotone cubic on the authored foot params (exactly still while a foot stays put)
  const ikLegs = !keyPose[0].r_leg.dirs;
  const ff = {};
  if (ikLegs) for (const s of ["r", "l"]) {
    const g = (fn) => pchip(T, keyPose.map((q) => fn(q[`${s}_leg`])));
    ff[s] = { x: g((l) => l.foot[0]), z: g((l) => l.foot[1]), yaw: g((l) => l.yaw ?? 0), lift: g((l) => l.lift || 0) };
  }
  const th = pchip(T, keyPose.map((q) => q.two_hand || 0));
  const at = (t) => {
    const D = {}; for (const sg of segs) { const q = qf[sg].map((f) => f(t)); const l = Math.hypot(...q); D[sg] = q.map((v) => v / l); }
    const st = { D, pelvis: pf.map((f) => f(t)), twoHand: th(t) };
    if (ikLegs) st.feet = Object.fromEntries(["r", "l"].map((s) => [s, { foot: [ff[s].x(t), ff[s].z(t)], yaw: ff[s].yaw(t), lift: ff[s].lift(t) }]));
    return st;
  };
  const solve = (t) => poseFromState(ch, at(t), rc);
  // --- time warp (output time -> real time) with an eased slow-motion window
  const sm = tech.slowmo || { from: ph[1].name, to: ph[ph.length - 2].name, rate: 1 };
  const rate = opts.slowRate ?? sm.rate, ramp = Math.max(0.45, sm.ramp ?? 0.45);
  const tA = T[ph.findIndex((p) => p.name === sm.from)], tB = T[ph.findIndex((p) => p.name === sm.to)];
  const speed = (t) => 1 - (1 - rate) * smooth((t - (tA - ramp)) / ramp) * (1 - smooth((t - tB) / ramp));
  // --- ball: anchored at the solved racket face at contact; incoming integrated backward, outgoing forward
  const R = sport.ball?.radius ?? 0.0335, g = -9.81, e = sport.ball?.restitution ?? 0.75;
  const cp = solve(tc).racket; const vin = tech.ball.in.vel, vout = tech.ball.out.vel;
  let n = cp.normal; if (dot(n, mul(vin, -1)) < 0) n = mul(n, -1);
  const C = add(cp.center, mul(n, R + 0.021));
  const integrate = (p0, v0, dur, dir) => {   // dir = -1 backward in time
    const pts = [[0, p0]]; let p = p0.slice(), v = v0.slice(); const dt = 1 / 480;
    for (let s = dt; s <= dur + 1e-9; s += dt) {
      if (dir > 0) { v = [v[0], v[1] + g * dt, v[2]]; p = add(p, mul(v, dt)); if (p[1] < R && v[1] < 0) { p[1] = 2 * R - p[1]; v = [v[0] * 0.85, -v[1] * e, v[2] * 0.85]; } }
      else { p = sub(p, mul(v, dt)); v = [v[0], v[1] - g * dt, v[2]]; if (p[1] < R && v[1] > 0) { p[1] = 2 * R - p[1]; v = [v[0] / 0.85, -v[1] / e, v[2] / 0.85]; } }
      pts.push([dir * s, p.slice()]);
    }
    return pts;
  };
  const ballIn = integrate(C, vin, tech.ball.in.dur ?? 1.0, -1).reverse();
  const ballOut = integrate(C, vout, tech.ball.out.dur ?? 0.8, 1);
  const tIn0 = tc + ballIn[0][0], tOut1 = tc + ballOut[ballOut.length - 1][0];
  const ballAt = (t) => {
    if (t < tIn0 || t > tOut1) return null;
    const arr = t <= tc ? ballIn : ballOut, rel = t - tc;
    const i = Math.min(arr.length - 2, Math.max(0, Math.floor((rel - arr[0][0]) * 480)));
    const [t0, p0] = arr[i], [t1, p1] = arr[i + 1]; const s = (rel - t0) / ((t1 - t0) || 1);
    return add(p0, mul(sub(p1, p0), Math.min(1, Math.max(0, s))));
  };
  // --- racket-head trail (sampled once)
  const tr0 = T[Math.max(0, ph.findIndex((p) => p.name === (tech.trail?.from || ph[1].name)))];
  const tr1 = T[ph.findIndex((p) => p.name === (tech.trail?.to || ph[ph.length - 2].name))];
  const trail = []; for (let t = tr0; t <= tr1 + 1e-9; t += 1 / 240) trail.push([t, solve(t).racket.center]);
  return { id: tech.id, T, t0: T[0], t1: T[T.length - 1], tc, speed, solve, at, ballAt, ballIn, ballOut, contact: C,
           tIn0, tOut1, trail, phases: ph, tA, tB };
}
// output-time table for playback: integrates dt_real = speed(t_real) * dt_out
export function timeTable(comp, fps = 240, globalSpeed = 1, includeReal = false) {
  const rows = []; let t = comp.t0;
  while (t < comp.t1) { rows.push([t, comp.speed(t), "slow"]); t += comp.speed(t) * globalSpeed / fps; }
  rows.push([comp.t1, 1, "slow"]);
  if (includeReal) for (let t2 = comp.t0; t2 <= comp.t1; t2 += globalSpeed / fps) rows.push([t2, 1, "real"]);
  return rows;
}
