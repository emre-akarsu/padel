// Strike solver v6: anatomical arm model + rigid grip socket.
// Dependency-free (browser + Node). Frame: Y up, player faces +Z (net), player's right = -X. Quaternions [x,y,z,w].
//
// Arm chain (per side), in the rig frame used by v2-v5 (every limb bone A-aligned to point down at rest):
//   D_upper = D_chest * R_shoulder                       (3 DOF, humeral rotation limited)
//   D_fore  = D_upper * Rx(-elbow) * Ry(k * pron)        (elbow flexion 2..145 deg; part of the pronation on the forearm bone)
//   D_hand  = D_upper * Rx(-elbow) * Ry(pron) * Swing(wrist_flex, wrist_dev)
//   racket  = D_hand * G (grip socket rotation), origin at wrist + D_hand * g      -> the racket is a RESULT of the joints
// Phase keys give racket targets; the key solve inverts the socket, runs two-bone IK and searches the elbow swivel so
// that shoulder / pronation / wrist stay inside their ranges; leftovers are clamped (racket orientation then follows).
// Between keys the joint angles are interpolated (C2), so every frame is anatomical by construction.

// ------------------------------------------------------------------ math
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [p[0], p[1], p[2]]; };
const qaxis = (ax, deg) => { const a = norm(ax), h = deg * Math.PI / 360, s = Math.sin(h); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)]; };
const qnorm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };
const QI = [0, 0, 0, 1];
const DEG = 180 / Math.PI;
function qfrommat(x, y, z) {
  const t = x[0] + y[1] + z[2]; let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4]; }
  else if (x[0] > y[1] && x[0] > z[2]) { const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2; q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s]; }
  else if (y[1] > z[2]) { const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2; q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s]; }
  else { const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2; q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s]; }
  return qnorm(q);
}
function basis(downDir, hint) {        // local -Y along downDir, local +Z toward hint
  const y = mul(norm(downDir), -1); let z = sub(hint, mul(y, dot(hint, y)));
  if (len(z) < 1e-6) z = cross(y, [1, 0, 0]); if (len(z) < 1e-6) z = cross(y, [0, 0, 1]);
  z = norm(z); return qfrommat(cross(y, z), y, z);
}
function rotBetween(a, b) {
  a = norm(a); b = norm(b); const d = dot(a, b);
  if (d < -0.999999) { let ax = cross([1, 0, 0], a); if (len(ax) < 1e-6) ax = cross([0, 1, 0], a); return qaxis(ax, 180); }
  const c = cross(a, b); return qnorm([c[0], c[1], c[2], 1 + d]);
}
function swingTwist(q, axis) {          // q = swing * twist(axis); returns twist angle (deg, signed about axis)
  const p = dot([q[0], q[1], q[2]], axis); let t = [axis[0] * p, axis[1] * p, axis[2] * p, q[3]];
  const l = Math.hypot(...t); t = l < 1e-9 ? QI : t.map((v) => v / l);
  return { twist: 2 * Math.atan2(dot([t[0], t[1], t[2]], axis), t[3]) * DEG, swing: qmul(q, qinv(t)) };
}
const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
export const V = { add, sub, mul, dot, cross, len, norm, qmul, qinv, qrot, qaxis, basis, swingTwist, rotBetween };

// ------------------------------------------------------------------ ranges of motion: from the body profile (body/<id>.json)
function romFrom(r) {
  return { elbow: r.elbow_flexion, pron: r.forearm_pronation, wflex: r.wrist_flexion, wdev: r.wrist_deviation, shoulderRot: r.shoulder_rotation,
    shoulderBack: r.shoulder_horizontal_extension_max, shoulderCross: r.shoulder_cross_body_max, chestYaw: r.chest_yaw, lean: r.lean, chestRoll: r.chest_roll,
    neck: r.neck_pitch, knee: r.knee_flexion, hipFlex: r.hip_flexion, hipAbd: r.hip_abduction, ankle: r.ankle, valgus: r.knee_valgus_max };
}
const soft = (x, lo, hi, m = 10) => {    // smooth saturation into [lo, hi]; identity well inside the range
  if (x > hi - m) return hi - m + m * Math.tanh((x - (hi - m)) / m);
  if (x < lo + m) return lo + m + m * Math.tanh((x - (lo + m)) / m);
  return x;
};

// ------------------------------------------------------------------ character (skeleton + body profile)
// Internal logical names ("R Hand", "R Finger21", "Spine2", ...) are translated through the profile's bone_map,
// so any character with the same joint set works by supplying its own body/<id>.json + skeleton file.
function nameMap(bm) {
  const m = { Pelvis: bm.pelvis, Spine: bm.spine[0], Spine1: bm.spine[1], Spine2: bm.chest_joint, Neck: bm.neck_joint, Head: bm.head };
  const F = ["thumb", "index", "middle", "ring", "pinky"];
  for (const [S, s] of [["R", "r"], ["L", "l"]]) {
    Object.assign(m, { [`${S} Clavicle`]: bm[`${s}_clavicle`], [`${S} UpperArm`]: bm[`${s}_upper`], [`${S} Forearm`]: bm[`${s}_fore`], [`${S} Hand`]: bm[`${s}_hand`],
      [`${S} Thigh`]: bm[`${s}_thigh`], [`${S} Calf`]: bm[`${s}_shin`], [`${S} Foot`]: bm[`${s}_foot`], [`${S} Toe0`]: bm[`${s}_toe`] });
    F.forEach((f, i) => bm[`${s}_fingers`][f].forEach((n, j) => { m[`${S} Finger${i}${j ? j : ""}`] = n; }));
  }
  return m;
}
export function createCharacter(skel, body) {
  const map = nameMap(body.bone_map); const N = (l) => map[l] ?? l;
  const bones = skel.bones.map((b) => ({ ...b })); const by = Object.fromEntries(bones.map((b) => [b.name, b]));
  const depth = (b) => (b.parent ? 1 + depth(by[b.parent]) : 0); bones.sort((a, b) => depth(a) - depth(b));
  const H = (n) => by[N(n)].head;
  const ALIGN = { "R UpperArm": "R Forearm", "R Forearm": "R Hand", "R Hand": "R Finger2", "L UpperArm": "L Forearm", "L Forearm": "L Hand",
    "L Hand": "L Finger2", "R Thigh": "R Calf", "R Calf": "R Foot", "L Thigh": "L Calf", "L Calf": "L Foot" };
  const A = {}; for (const [bn, c] of Object.entries(ALIGN)) A[N(bn)] = rotBetween(sub(H(c), H(bn)), [0, -1, 0]);
  const segOf = {}; for (const [seg, v] of Object.entries(body.bone_map)) {
    if (!/^(pelvis|spine|chest|neck|[rl]_(upper|fore|hand|thigh|shin|foot))$/.test(seg)) continue;
    for (const n of [].concat(v)) segOf[n] = seg;
  }
  const anchor = {}; for (const [k, v] of Object.entries(body.anchors || {})) anchor[body.bone_map[k]] = [].concat(body.bone_map[v])[0];
  const L = {}; for (const s of ["r", "l"]) { const S = s.toUpperCase();
    L[`${s}_upper`] = len(sub(H(`${S} Forearm`), H(`${S} UpperArm`))); L[`${s}_fore`] = len(sub(H(`${S} Hand`), H(`${S} Forearm`)));
    L[`${s}_thigh`] = len(sub(H(`${S} Calf`), H(`${S} Thigh`))); L[`${s}_shin`] = len(sub(H(`${S} Foot`), H(`${S} Calf`))); }
  // hand frames in the rig (hand-local) frame: fingers -Y, palm normal p0, radial (thumb-side) axis r0
  const hand = {};
  for (const S of ["R", "L"]) {
    const h = H(`${S} Hand`), d = norm(sub(H(`${S} Finger2`), h));
    let a = norm(sub(H(`${S} Finger1`), H(`${S} Finger4`))); a = norm(sub(a, mul(d, dot(a, d))));
    let n = cross(d, a); if (dot(n, [-Math.sign(h[0]), -0.5, 0]) < 0) n = mul(n, -1);
    const Ah = A[N(`${S} Hand`)];
    let p0 = qrot(Ah, n); p0 = norm([p0[0], 0, p0[2]]); const r0 = norm(cross([0, -1, 0], p0));
    hand[S] = { p0, r0: dot(r0, qrot(Ah, a)) > 0 ? r0 : mul(r0, -1) };
  }
  return { bones, by, A, segOf, anchor, L, H, N, hand, body, rom: romFrom(body.rom_deg), pronK: body.pronation_on_forearm ?? 0.55,
    ankleH: (H("R Foot")[1] + H("L Foot")[1]) / 2, pelvis0: H("Pelvis") };
}
// bone lengths (rest): every parent->child offset, for the constant-length check
export function restLengths(ch) { const o = {}; for (const b of ch.bones) if (b.parent) o[b.name] = len(sub(b.head, ch.by[b.parent].head)); return o; }

// ------------------------------------------------------------------ grip socket + finger wrap
// Implement model frame (implements/<id>.json): handle axis -Y (butt -> head), face normal +Z.
// Grip (grips/<id>.json): bevel rotation of the face about the handle from the eastern-forehand position, handle tilt
// from the thumb-side axis toward the fingers, and where the handle axis crosses the closed fist.
const rkOf = (impl) => ({ fist: impl.fist, center: impl.sweet_spot, handleR: impl.handle.radius, head: impl.head, butt: impl.butt, length: impl.length, id: impl.id });
export function gripSocket(ch, side, grip, impl, oppositeFace = false) {
  const S = side.toUpperCase(), hd = ch.hand[S], rk = rkOf(impl), tilt = grip.handle_tilt_deg ?? 16;
  const dirL = norm(add(mul(hd.r0, Math.cos(tilt / DEG)), mul([0, -1, 0], Math.sin(tilt / DEG))));
  let face = sub(hd.p0, mul(dirL, dot(hd.p0, dirL))); face = norm(face);
  face = qrot(qaxis(dirL, (grip.bevel_deg ?? 0) * (S === "R" ? 1 : -1)), face);
  if (oppositeFace) face = mul(face, -1);              // second hand wraps the handle from the other side
  const G = basis(dirL, face);                                         // implement model -> hand-local
  const fo = grip.fist_offset_m || { palm: 0.031, along_fingers: 0.060 };
  const fistL = add(mul(hd.p0, fo.palm), [0, -fo.along_fingers, 0]);   // handle axis passes through the closed fist
  const g = sub(fistL, qrot(G, [0, -rk.fist, 0]));                    // model origin in hand-local
  return { G, g, fistL, dirL, grip: grip.id, curls: grip.fingers === "wrap" ? fingerWrap(ch, S, G, g, rk) : relaxedCurls(ch, S) };
}
// solve finger flexions so every phalanx rests on the handle surface (no gap, nothing inside the handle)
function fingerWrap(ch, S, G, g, rk) {
  const Ah = ch.A[ch.N(`${S} Hand`)], Ainv = qinv(Ah), h = ch.H(`${S} Hand`);
  const toRest = (vL) => add(h, qrot(Ainv, vL));                     // hand-local point -> rest-world point
  const axisP = toRest(add(g, qrot(G, [0, -0.06, 0]))), axisD = norm(qrot(Ainv, qrot(G, [0, -1, 0])));
  const R = rk.handleR + 0.0085;                                      // handle radius + finger half thickness
  const distAxis = (p) => { const v = sub(p, axisP); return len(sub(v, mul(axisD, dot(v, axisD)))); };
  const palmW = qrot(Ainv, ch.hand[S].p0), radW = qrot(Ainv, ch.hand[S].r0);
  const curls = {};
  const chainFK = (names, rots, tipLen) => {      // rots: rest-world rotations per joint (applied cumulatively)
    let q = QI; const pts = []; let p = ch.H(`${S} ${names[0]}`);
    for (let i = 0; i < names.length; i++) {
      q = qmul(q, rots[i]); const next = i + 1 < names.length ? ch.H(`${S} ${names[i + 1]}`) : add(ch.H(`${S} ${names[i]}`), mul(norm(sub(ch.H(`${S} ${names[i]}`), ch.H(`${S} ${names[i - 1]}`))), tipLen));
      const off = sub(next, ch.H(`${S} ${names[i]}`)); const np = add(p, qrot(q, off)); pts.push(mul(add(p, np), 0.5), np); p = np;
    }
    return pts;
  };
  const err = (pts) => pts.reduce((s, p) => { const d = distAxis(p) - R; return s + (d < 0 ? 4 * d * d : d * d); }, 0);
  for (const f of ["1", "2", "3", "4"]) {
    const names = [`Finger${f}`, `Finger${f}1`, `Finger${f}2`];
    const dir = norm(sub(ch.H(`${S} ${names[1]}`), ch.H(`${S} ${names[0]}`)));
    let ax = norm(cross(dir, palmW)); if (dot(cross(ax, dir), palmW) < 0) ax = mul(ax, -1);   // rotating about ax curls toward the palm
    const tip = len(sub(ch.H(`${S} ${names[2]}`), ch.H(`${S} ${names[1]}`))) * 0.85;
    let best = [1e9];
    for (let a = 0; a <= 95; a += 5) for (let b = 0; b <= 110; b += 5) for (let c = 0; c <= 80; c += 10) {
      const rots = [qaxis(ax, a), qaxis(ax, b), qaxis(ax, c)];
      const e = err(chainFK(names, rots, tip)) + 1e-7 * (a * a + b * b + c * c);
      if (e < best[0]) best = [e, a, b, c];
    }
    let [, a, b, c] = best;                                            // refine
    for (const st of [2, 1, 0.5]) for (let it = 0; it < 3; it++) for (const [da, db, dc] of [[st, 0, 0], [-st, 0, 0], [0, st, 0], [0, -st, 0], [0, 0, st], [0, 0, -st]]) {
      const e = err(chainFK(names, [qaxis(ax, a + da), qaxis(ax, b + db), qaxis(ax, c + dc)], tip));
      if (e < best[0]) { best = [e, a + da, b + db, c + dc]; [, a, b, c] = best; }
    }
    [a, b, c].forEach((ang, j) => { curls[ch.N(`${S} ${names[j]}`)] = qaxis(ax, ang); });
    (curls._fing ||= {})[f] = { names, ax, tip, abc: [a, b, c], palmW };
  }
  // thumb: opposes across the front of the handle (2 DOF at the base, flexion of the two distal joints)
  const tn = ["Finger0", "Finger01", "Finger02"];
  const tdir = norm(sub(ch.H(`${S} Finger01`), ch.H(`${S} Finger0`)));
  const tax = norm(cross(tdir, palmW)); const ttip = len(sub(ch.H(`${S} Finger02`), ch.H(`${S} Finger01`))) * 0.8;
  let bt = [1e9];
  for (let o = -30; o <= 60; o += 6) for (let fl = -10; fl <= 50; fl += 6) for (let b = 0; b <= 70; b += 10) for (let c = 0; c <= 70; c += 10) {
    const r0 = qmul(qaxis(axisD, o * (S === "R" ? 1 : -1)), qaxis(tax, fl));
    const e = err(chainFK(tn, [r0, qaxis(tax, b), qaxis(tax, c)], ttip)) + 1e-7 * (o * o + fl * fl + b * b + c * c);
    if (e < bt[0]) bt = [e, o, fl, b, c];
  }
  const [, o, fl, tb, tc] = bt;
  curls[ch.N(`${S} Finger0`)] = qmul(qaxis(axisD, o * (S === "R" ? 1 : -1)), qaxis(tax, fl)); curls[ch.N(`${S} Finger01`)] = qaxis(tax, tb); curls[ch.N(`${S} Finger02`)] = qaxis(tax, tc);
  return curls;
}
// v13 (2026-11-09): the loose second hand tilts/rolls on the handle (loose_deg), so the socket finger wrap no longer
// matches the handle; re-rest each finger on the actual handle (local refine from the socket wrap, nothing else moves)
const REWRAP = new Map();
function rewrapFingers(ch, S, base, axisPW, axisDW, rk) {
  const R = rk.handleR + 0.0085, out = { ...base };
  const distAxis = (p) => { const v = sub(p, axisPW); return len(sub(v, mul(axisDW, dot(v, axisDW)))); };
  const chainFK = (names, rots, tipLen) => {
    let q = QI; const pts = []; let p = ch.H(`${S} ${names[0]}`);
    for (let i = 0; i < names.length; i++) {
      q = qmul(q, rots[i]); const next = i + 1 < names.length ? ch.H(`${S} ${names[i + 1]}`) : add(ch.H(`${S} ${names[i]}`), mul(norm(sub(ch.H(`${S} ${names[i]}`), ch.H(`${S} ${names[i - 1]}`))), tipLen));
      const off = sub(next, ch.H(`${S} ${names[i]}`)); const np = add(p, qrot(q, off)); pts.push(mul(add(p, np), 0.5), np); p = np;
    }
    return pts;
  };
  const err = (pts) => pts.reduce((s, p) => { const d = distAxis(p) - R; return s + d * d + (d < -0.0005 ? 4000 * (d + 0.0005) ** 2 : 0) + (d > 0.004 ? 4000 * (d - 0.004) ** 2 : 0); }, 0);
  for (const f of ["1", "2", "3", "4"]) {
    const F = base._fing[f]; let [a, b, c] = F.abc, sp = 0; const ax = F.ax, pw = norm(F.palmW);
    const rots = (a, b, c, sp) => [qmul(qaxis(pw, sp), qaxis(ax, a)), qaxis(ax, b), qaxis(ax, c)];
    const E = (a, b, c, sp) => err(chainFK(F.names, rots(a, b, c, sp), F.tip)) + 1e-7 * (a * a + b * b + c * c + 4 * sp * sp);
    const pen = (a, b, c, sp) => Math.min(...chainFK(F.names, rots(a, b, c, sp), F.tip).map((p) => distAxis(p) - R));
    const gap = (a, b, c, sp) => Math.max(...chainFK(F.names, rots(a, b, c, sp), F.tip).map((p) => distAxis(p) - R));
    const refine = () => { let best = E(a, b, c, sp);
      for (const st of [8, 4, 2, 1]) for (let it = 0; it < 5; it++) { let moved = false;
        for (const [da, db, dc, ds] of [[st, 0, 0, 0], [-st, 0, 0, 0], [0, st, 0, 0], [0, -st, 0, 0], [0, 0, st, 0], [0, 0, -st, 0], [0, 0, 0, st], [0, 0, 0, -st]]) {
          const na = Math.max(-40, Math.min(110, a + da)), nb = Math.max(0, Math.min(115, b + db)), nc = Math.max(0, Math.min(90, c + dc)), ns = Math.max(-30, Math.min(30, sp + ds));
          const e = E(na, nb, nc, ns); if (e < best) { best = e; a = na; b = nb; c = nc; sp = ns; moved = true; } }
        if (!moved) break; } };
    refine(); let r1 = [E(a, b, c, sp), a, b, c, sp];
    if (pen(a, b, c, sp) < -0.0015 || gap(a, b, c, sp) > 0.0055) {   // stuck on the wrong side: second start with the finger splayed
      for (const s0 of [[...F.abc, -25], [...F.abc, 25], [10, 15, 30, -25], [40, 40, 30, -15]]) { [a, b, c, sp] = s0; refine(); const e = E(a, b, c, sp); if (e < r1[0]) r1 = [e, a, b, c, sp]; }
      [, a, b, c, sp] = r1;
    }
    rots(a, b, c, sp).forEach((q, j) => { out[ch.N(`${S} ${F.names[j]}`)] = q; });
  }
  return out;
}
// relaxed free hand (light curl)
function relaxedCurls(ch, S) {
  const out = {}, Ainv = qinv(ch.A[ch.N(`${S} Hand`)]), palmW = qrot(Ainv, ch.hand[S].p0);
  for (const f of "1234") {
    const names = [`Finger${f}`, `Finger${f}1`, `Finger${f}2`]; const dir = norm(sub(ch.H(`${S} ${names[1]}`), ch.H(`${S} ${names[0]}`)));
    let ax = norm(cross(dir, palmW)); if (dot(cross(ax, dir), palmW) < 0) ax = mul(ax, -1);
    (ch.body.relaxed_hand_curl_deg || [20, 28, 15]).forEach((d, j) => { out[ch.N(`${S} ${names[j]}`)] = qaxis(ax, d); });
  }
  return out;
}

// ------------------------------------------------------------------ FK
export function fk(ch, D, pel, curls) {
  const delta = {}, pos = {};
  for (const b of ch.bones) {
    const seg = ch.segOf[b.name];
    if (seg) delta[b.name] = D[seg] ? (ch.A[b.name] ? qmul(D[seg], ch.A[b.name]) : D[seg]) : QI;
    else if (b.parent) delta[b.name] = curls[b.name] ? qmul(delta[b.parent], curls[b.name]) : delta[b.parent];
    else delta[b.name] = QI;
    const par = ch.anchor[b.name] || b.parent;
    pos[b.name] = b.parent ? add(pos[par], qrot(delta[par], sub(b.head, ch.by[par].head))) : pel;
  }
  return { delta, pos };
}
export function trunkD(p) {
  const D = {};
  D.pelvis = qmul(qaxis([0, 1, 0], p.yaw), qaxis([1, 0, 0], p.lean * 0.4));
  D.spine = qmul(D.pelvis, qaxis([1, 0, 0], p.lean * 0.6));
  D.chest = qmul(D.spine, qmul(qaxis([0, 1, 0], p.chest_yaw), qaxis([0, 0, 1], p.chest_roll || 0)));
  D.neck = qmul(D.chest, qmul(qaxis([0, 1, 0], p.head_yaw || 0), qaxis([1, 0, 0], p.head_pitch - p.lean)));
  return D;
}

// ------------------------------------------------------------------ arm: joint angles <-> segment rotations
function wristSwing(hd, flex, dev) {
  const u = norm(add([0, -1, 0], add(mul(hd.p0, Math.tan(flex / DEG)), mul(hd.r0, Math.tan(dev / DEG)))));
  return rotBetween([0, -1, 0], u);
}
// humerus direction (azimuth from lateral toward forward, elevation from hanging) + humeral rotation -> shoulder quat
export function shoulderQuat(side, az, el, rot) {
  const S = side.toUpperCase(), sx = S === "R" ? -1 : 1;
  const hor = [sx * Math.cos(az / DEG), 0, Math.sin(az / DEG)];
  const h = [Math.sin(el / DEG) * hor[0], -Math.cos(el / DEG), Math.sin(el / DEG) * hor[2]];
  const lat = [sx, 0, 0];
  const ref = qmul(rotBetween(lat, h), qaxis([0, 0, 1], S === "R" ? -90 : 90));
  return qmul(ref, qaxis([0, 1, 0], S === "R" ? -rot : rot));
}
export function armFromAngles(ch, side, Dchest, J) {
  const S = side.toUpperCase(), hd = ch.hand[S], sg = S === "R" ? 1 : -1;
  const Du = qmul(Dchest, J.shoulder || shoulderQuat(side, J.az, J.el, J.rot));
  const El = qmul(Du, qaxis([1, 0, 0], -J.elbow));
  const tw = J.pron * sg;                        // pronation = twist about +Y on the right, -Y on the left
  return { upper: Du, fore: qmul(El, qaxis([0, 1, 0], tw * ch.pronK)), hand: qmul(qmul(El, qaxis([0, 1, 0], tw)), wristSwing(hd, J.wflex, J.wdev)) };
}
function anglesFromSegments(ch, side, Dchest, Du, elbow, Dhand) {
  const S = side.toUpperCase(), hd = ch.hand[S], sg = S === "R" ? 1 : -1;
  const F0 = qmul(Du, qaxis([1, 0, 0], -elbow));
  const rel = qmul(qinv(F0), Dhand);
  const { twist } = swingTwist(rel, [0, 1, 0]);
  const uh = qrot(rel, [0, -1, 0]); const ul = qrot(qaxis([0, 1, 0], -twist), uh);
  const wflex = Math.atan2(dot(ul, hd.p0), -ul[1]) * DEG, wdev = Math.atan2(dot(ul, hd.r0), -ul[1]) * DEG;
  return { shoulder: qmul(qinv(Dchest), Du), elbow, pron: wrapDeg(twist * sg), wflex, wdev };
}
// humeral rotation (lateral reference, singular only when the arm points straight across the chest) + direction limits
export function shoulderMeasures(side, Rs) {
  const S = side.toUpperCase(), lat = S === "R" ? [-1, 0, 0] : [1, 0, 0];
  const h = qrot(Rs, [0, -1, 0]);
  const ref = qmul(rotBetween(lat, h), qaxis([0, 0, 1], S === "R" ? -90 : 90));
  const { twist } = swingTwist(qmul(qinv(ref), Rs), [0, 1, 0]);
  const ext = wrapDeg(twist * (S === "R" ? -1 : 1));
  const hz = Math.hypot(h[0], h[2]); let back = 0, cross = 0;
  if (hz > 0.3) {
    const az = Math.atan2(h[2], -h[0] * (S === "R" ? 1 : -1)) * DEG;   // 0 = lateral, 90 = straight ahead, 180 = across
    back = Math.max(0, -az); cross = Math.max(0, az - 90);
  }
  return { rot: ext, back, cross, elev: Math.acos(Math.max(-1, Math.min(1, -h[1]))) * DEG };
}
const excess = (v, [lo, hi]) => (v < lo ? lo - v : v > hi ? v - hi : 0);
// key solve: hand pose target -> joint angles within ROM (elbow swivel search, then clamp)
function solveArm(ch, side, Dchest, shoulderPos, wristT, handT, poleW, pref = {}, swPrev = null) {
  const S = side.toUpperCase(), L1 = ch.L[`${side}_upper`], L2 = ch.L[`${side}_fore`];
  const v = sub(wristT, shoulderPos), u = norm(v);
  let d = len(v), reach = d / (L1 + L2);
  const a0 = 0.92 * (L1 + L2), b0 = 0.995 * (L1 + L2); if (d > a0) d = a0 + (b0 - a0) * Math.tanh((d - a0) / (b0 - a0));
  d = Math.max(d, Math.abs(L1 - L2) + 0.08);
  const elbow = Math.PI - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  const aa = (L1 * L1 + d * d - L2 * L2) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
  let pp0 = sub(poleW, mul(u, dot(poleW, u))); if (len(pp0) < 1e-6) pp0 = cross(u, [0, 1, 0]); pp0 = norm(pp0);
  const W = add(shoulderPos, mul(u, d));
  const hard = (J) => ({ ...J, pron: Math.max(ch.rom.pron[0], Math.min(ch.rom.pron[1], J.pron)), wflex: Math.max(ch.rom.wflex[0], Math.min(ch.rom.wflex[1], J.wflex)),
                         wdev: Math.max(ch.rom.wdev[0], Math.min(ch.rom.wdev[1], J.wdev)) });
  const evalSw = (phi) => {
    const pp = qrot(qaxis(u, phi), pp0); const E = add(shoulderPos, add(mul(u, aa), mul(pp, hh)));
    const up = norm(sub(E, shoulderPos)), lo = norm(sub(W, E));
    let bend = sub(lo, mul(up, dot(lo, up))); bend = len(bend) < 1e-6 ? pp : norm(bend);
    const Du = basis(up, bend);
    // racket hand: joints that reproduce the target hand orientation; free hand: neutral wrist, preferred pronation
    let J = handT ? anglesFromSegments(ch, side, Dchest, Du, elbow * DEG, handT)
                  : { shoulder: qmul(qinv(Dchest), Du), elbow: elbow * DEG, pron: pref.pron ?? 0, wflex: pref.wflex ?? 0, wdev: pref.wdev ?? 0 };
    const sm = shoulderMeasures(side, J.shoulder);
    const shEx = excess(sm.rot, ch.rom.shoulderRot) + Math.max(0, sm.back - ch.rom.shoulderBack) + Math.max(0, sm.cross - ch.rom.shoulderCross);
    let oriErr = 0, Jc = J;
    if (handT) {               // forearm/wrist limits are hard: clamp, then measure how far the hand (racket) is from the target
      Jc = hard(J); const Dh = armFromAngles(ch, side, Dchest, Jc).hand;
      const d = Math.abs(qmul(qinv(Dh), handT)[3]); oriErr = 2 * Math.acos(Math.min(1, d)) * DEG;
    }
    const near = (v, [lo, hi]) => Math.max(0, v - (hi - 0.15 * (hi - lo))) + Math.max(0, (lo + 0.15 * (hi - lo)) - v);  // keep off the limits
    const pf = pref.wflex ?? 0, pd = pref.wdev ?? 0, pr = pref.pron ?? 0;
    const cost = 2000 * shEx * shEx + 3 * oriErr * oriErr + 0.6 * (Jc.wflex - pf) ** 2 + 0.6 * (Jc.wdev - pd) ** 2 + 0.15 * (Jc.pron - pr) ** 2
      + 0.25 * phi * phi + 2 * (near(Jc.pron, ch.rom.pron) ** 2 + near(Jc.wflex, ch.rom.wflex) ** 2 + near(Jc.wdev, ch.rom.wdev) ** 2 + near(sm.rot, ch.rom.shoulderRot) ** 2);
    return { cost, J: Jc, sm, phi, ex: shEx, oriErr };
  };
  let best = null;
  if (swPrev === null) for (let phi = -150; phi <= 150; phi += 5) { const r = evalSw(phi); if (!best || r.cost < best.cost) best = r; }
  else for (let phi = swPrev - 12; phi <= swPrev + 12; phi += 1) { const r = evalSw(phi); r.cost += 0.5 * (phi - swPrev) ** 2; if (!best || r.cost < best.cost) best = r; }
  for (const st of [2.5, 1, 0.4, 0.1]) for (const dp of [-st, st]) { const r = evalSw(best.phi + dp); if (swPrev !== null) r.cost += 0.5 * (r.phi - swPrev) ** 2; if (r.cost < best.cost) best = r; }
  const J = { ...best.J }; J.elbow = Math.max(ch.rom.elbow[0], Math.min(ch.rom.elbow[1], J.elbow));
  return { J, reach, violation: best.ex, swivel: best.phi, oriErr: best.oriErr };
}

// ------------------------------------------------------------------ pose from joint state
// st: { trunk:{pelvis,yaw,lean,chest_yaw,chest_roll,head_pitch,head_yaw}, arms:{r:J,l:J}, feet:{r,l}, kneeR, kneeL, twoHand }
export function lowerPelvis(ch, D, pel0, feet) {     // smooth drop so planted feet never over-stretch the legs
  let pel = pel0.slice();
  const hipOf = (pelPos, s) => add(pelPos, qrot(D.pelvis, sub(ch.H(`${s} Thigh`), ch.pelvis0)));
  const ankleT = (f) => [f.foot[0], ch.ankleH + (f.lift || 0), f.foot[1]];
  const softplus = (x, k) => (x > 20 * k ? x : k * Math.log1p(Math.exp(x / k)));
  for (let it = 0; it < 5; it++) {
    let need = 0;
    for (const s of ["r", "l"]) need = Math.max(need, softplus(len(sub(ankleT(feet[s]), hipOf(pel, s.toUpperCase()))) - (ch.L[`${s}_thigh`] + ch.L[`${s}_shin`]) * 0.985, 0.006));
    if (need < 1e-6) break; pel = [pel[0], pel[1] - need * 0.9, pel[2]];
  }
  return pel;
}
// v7: when the state carries a CoM target (st.com), the pelvis is translated until the whole-body CoM (segment
// masses, loco.js) sits on it. v7 feet are given by the BALL of the foot (toe joint): the heel rises by rotating the
// foot about the ball, so a heel-off foot stays pinned at the ball. heel:"auto" raises the heel just enough that the
// leg stays below 95 % reach (the plantarflexion push); a lift beyond the toe-pivot range takes the whole foot up.
const PMAX = 50;
function toeGeom(ch, s) { const S = s.toUpperCase(), a = ch.H(`${S} Foot`), b = ch.H(`${S} Toe0`); return { x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] }; }
function footFromBall(ch, s, f) {   // ball-of-foot target (x,z) + lift -> ankle target (x,z), lift, pitch
  const g = toeGeom(ch, s), lift = f.lift || 0;
  const lp = (p) => { const r = p / DEG; return -(g.y * Math.cos(r) - g.z * Math.sin(r)) + g.y; };   // ankle rise that keeps the ball on the floor
  // note: Rx(p) maps (y,z) -> (y cos - z sin, y sin + z cos); ball height = ankleH + lift + y'
  // exact toe-pivot pitch up to 15 deg, then linear in lift (ball within ~2 mm of the floor up to 30 deg), soft cap 45 deg (C-infinity, no singularity)
  const P1 = 15, l1 = lp(P1);
  const dl = (lp(P1 + 0.01) - lp(P1 - 0.01)) / 0.02;            // d lift / d pitch at 35 deg
  let pl;
  if (lift <= 0) pl = 0;
  else if (lift < l1) { let lo = 0, hi = P1; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (lp(m) < lift) lo = m; else hi = m; } pl = (lo + hi) / 2; }
  else pl = P1 + (lift - l1) / dl;
  const Pc = 48, kq = 9, p = pl <= 0 ? 0 : -kq * Math.log(Math.exp(-pl / kq) + Math.exp(-Pc / kq));
  const r = p / DEG, zl = g.y * Math.sin(r) + g.z * Math.cos(r), xl = g.x;
  const yq = qaxis([0, 1, 0], f.yaw ?? 0), off = qrot(yq, [xl, 0, zl]);
  return { ...f, foot: [f.foot[0] - off[0], f.foot[1] - off[2]], lift, pitch: p, ball: f.foot };
}
export function poseFromState(ch, st, grip) {
  if (!st.com) return poseCore(ch, st, grip);
  const D = trunkD(st.trunk); let pel = st.trunk.pelvis.slice(), r = null, c = null;
  const feetAt = (pelP) => { const feet = {};
    for (const s of ["r", "l"]) { const f0 = st.feet[s]; let f = footFromBall(ch, s, f0);
      if (f0.heel === "auto") {         // lift the heel (about the ball) until the leg is at 96.5 % reach; soft onset
        const hip = add(pelP, qrot(D.pelvis, sub(ch.H(`${s.toUpperCase()} Thigh`), ch.pelvis0)));
        const Lm = 0.965 * (ch.L[`${s}_thigh`] + ch.L[`${s}_shin`]), base = f0.lift || 0;
        const dist = (dl) => { const g = footFromBall(ch, s, { ...f0, lift: Math.max(0, base + dl) }); return len(sub([g.foot[0], ch.ankleH + g.lift, g.foot[1]], hip)) - Lm; };
        // signed extra lift needed: bisection when the flat foot over-reaches, linear extension (same slope) when not,
        // so req(t) is smooth through the onset; the soft-plus then gives a smooth heel rise
        const d0 = dist(0); let req;
        if (d0 > 0) { let lo = 0, hi = 0.6; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (dist(m) > 0) lo = m; else hi = m; } req = (lo + hi) / 2; }
        else { const sl = (dist(0.002) - d0) / 0.002; req = -d0 / Math.min(sl, -0.2); }
        const kk = 0.02, extra = req > 20 * kk ? req : kk * Math.log1p(Math.exp(req / kk));
        f = footFromBall(ch, s, { ...f0, lift: base + extra });
      }
      feet[s] = f; }
    return feet; };
  let feet = st.feet;
  for (let it = 0; it < 8; it++) {
    feet = feetAt(pel);
    r = poseCore(ch, { ...st, trunk: { ...st.trunk, pelvis: pel }, feet }, grip);
    c = comOf(ch, r.pos, r.racket); const e = sub(st.com, c);
    if (len(e) < 2e-5 && it > 1) break; pel = add(pel, mul(e, 1.15));
  }
  r.info.com = c; r.info.comTarget = st.com; r.info.feet = feet; r.info.pelvisIn = pel;
  return r;
}
export function poseCore(ch, st, grip) {
  const D = trunkD(st.trunk); const pel = lowerPelvis(ch, D, st.trunk.pelvis, st.feet);
  const hipOf = (pelPos, s) => add(pelPos, qrot(D.pelvis, sub(ch.H(`${s} Thigh`), ch.pelvis0)));
  const ankleT = (f) => [f.foot[0], ch.ankleH + (f.lift || 0), f.foot[1]];
  const info = { legs: {} };
  for (const s of ["r", "l"]) {
    const f = st.feet[s], facing = qrot(qaxis([0, 1, 0], f.yaw), [0, 0, 1]);
    const kneeDir = norm(add(facing, [s === "r" ? -0.1 : 0.1, 0, 0]));
    const hip = hipOf(pel, s.toUpperCase()), T = ankleT(f), L1 = ch.L[`${s}_thigh`], L2 = ch.L[`${s}_shin`];
    const u = norm(sub(T, hip)); let d = len(sub(T, hip)); const a0 = 0.92 * (L1 + L2), b0 = 0.999 * (L1 + L2);
    if (d > a0) d = a0 + (b0 - a0) * Math.tanh((d - a0) / (b0 - a0));
    let pp = sub(kneeDir, mul(u, dot(kneeDir, u))); pp = norm(pp);
    const aa = (L1 * L1 + d * d - L2 * L2) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
    const K = add(hip, add(mul(u, aa), mul(pp, hh)));
    const th = norm(sub(K, hip)), sh = norm(sub(add(hip, mul(u, d)), K));
    D[`${s}_thigh`] = basis(th, pp); D[`${s}_shin`] = basis(sh, pp);
    const pitch = f.pitch !== undefined ? f.pitch : Math.asin(Math.min(0.6, (f.lift || 0) / 0.16)) * DEG;
    D[`${s}_foot`] = qmul(qaxis([0, 1, 0], f.yaw), qaxis([1, 0, 0], pitch));
    info.legs[s] = { knee: Math.acos(Math.max(-1, Math.min(1, dot(th, sh)))) * DEG, kneeDir: pp, facing, pitch, th };
  }
  for (const s of ["r", "l"]) { const A = armFromAngles(ch, s, D.chest, st.arms[s]); D[`${s}_upper`] = A.upper; D[`${s}_fore`] = A.fore; D[`${s}_hand`] = A.hand; }
  const curls = { ...grip.curlsR, ...grip.curlsL };
  let { delta, pos } = fk(ch, D, pel, curls);
  const rk = grip.rk, gs = grip.R;
  const racketAt = (Dh, wrist) => { const R = qmul(Dh, gs.G), origin = add(wrist, qrot(Dh, gs.g));
    return { R, origin, wrist, dir: qrot(R, [0, -1, 0]), normal: qrot(R, [0, 0, 1]), center: add(origin, qrot(R, [0, -rk.center, 0])), implement: rk.id }; };
  let racket = racketAt(D.r_hand, pos[ch.N("R Hand")]);
  // two-handed: left hand IK onto the handle above the right hand, through its own grip socket
  if (st.twoHand > 1e-3 && grip.L) {
    const w = Math.min(1, st.twoHand);
    const fistTarget = add(racket.origin, qrot(racket.R, [0, -(rk.fist + grip.secondAlong), 0]));
    const handT = qmul(racket.R, qinv(grip.L.G));
    const wristT = sub(fistTarget, qrot(handT, grip.L.fistL));
    const J0 = st.arms.l;
    const r = st.leftBaked ? J0 : (w < 1e-3 ? J0 : optimizeArm(ch, "l", D.chest, pos[ch.N("L UpperArm")], { wrist: wristT, handQ: handT, pref: { wflex: J0.wflex, wdev: J0.wdev, pron: J0.pron }, contW: 6 / w },
      J0, null, {}, J0, [1, 0.5, 0.25, 0.12], armBounds(ch, true)).J);
    const A = armFromAngles(ch, "l", D.chest, r); D.l_upper = A.upper; D.l_fore = A.fore; D.l_hand = A.hand; st.arms.l = r;
    ({ delta, pos } = fk(ch, D, pel, curls));
    racket = racketAt(D.r_hand, pos[ch.N("R Hand")]);
    const fistNow = add(pos[ch.N("L Hand")], qrot(D.l_hand, grip.L.fistL));
    const aa = Math.max(rk.fist + grip.slide[0], Math.min(rk.fist + grip.slide[1], dot(sub(fistNow, racket.origin), racket.dir)));
    if (grip.loose > 0 && grip.curlsL && grip.curlsL._fing) {   // v13: re-rest the loose second hand's fingers on the handle
      const Dh = delta[ch.N("L Hand")], ph = pos[ch.N("L Hand")], h = ch.H("L Hand");
      const toRest = (p) => add(h, qrot(qinv(Dh), sub(p, ph)));   // world -> rest frame of the left hand
      const aP = toRest(racket.origin), aD = norm(sub(toRest(add(racket.origin, racket.dir)), aP));
      const key = [...aP, ...aD].map((v) => Math.round(v * 2e4)).join(",");   // the result depends only on the hand-relative handle axis
      let cL = REWRAP.get(key); if (!cL || cL._base !== grip.curlsL) { cL = rewrapFingers(ch, "L", grip.curlsL, aP, aD, rk); cL._base = grip.curlsL; if (REWRAP.size > 20000) REWRAP.clear(); REWRAP.set(key, cL); }
      Object.assign(curls, cL); ({ delta, pos } = fk(ch, D, pel, curls));
    }
    info.leftGrip = { fistTarget: add(racket.origin, mul(racket.dir, aa)), fist: fistNow, roll: Math.acos(Math.max(-1, Math.min(1, dot(qrot(D.l_hand, qrot(grip.L.G, [0, 0, 1])), racket.normal)))) * DEG };
  }
  return { delta, pos, racket, pelvis: pel, D, info, arms: st.arms };
}
// per-frame left-hand IK (no swivel search: pole from the current upper-arm frame keeps it continuous)
export function solveArmFast(ch, side, Dchest, S, W0, handT, poleW) {
  const L1 = ch.L[`${side}_upper`], L2 = ch.L[`${side}_fore`]; const u = norm(sub(W0, S)); let d = len(sub(W0, S));
  const a0 = 0.92 * (L1 + L2), b0 = 0.995 * (L1 + L2); if (d > a0) d = a0 + (b0 - a0) * Math.tanh((d - a0) / (b0 - a0)); d = Math.max(d, Math.abs(L1 - L2) + 0.08);
  const elbow = Math.PI - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
  const aa = (L1 * L1 + d * d - L2 * L2) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - aa * aa));
  let pp = sub(poleW, mul(u, dot(poleW, u))); pp = len(pp) < 1e-6 ? cross(u, [0, 1, 0]) : norm(pp);
  const E = add(S, add(mul(u, aa), mul(pp, hh))), up = norm(sub(E, S)), lo = norm(sub(add(S, mul(u, d)), E));
  let bend = sub(lo, mul(up, dot(lo, up))); bend = len(bend) < 1e-6 ? mul(pp, -1) : norm(bend);   // forearm side = elbow flexion side
  const J = anglesFromSegments(ch, side, Dchest, basis(up, bend), elbow * DEG, handT);
  J.pron = soft(J.pron, ...ch.rom.pron); J.wflex = soft(J.wflex, ...ch.rom.wflex); J.wdev = soft(J.wdev, ...ch.rom.wdev); J.elbow = soft(J.elbow, ...ch.rom.elbow, 2);
  return J;
}
function slerp(a, b, t) {
  let d = dot([a[0], a[1], a[2]], [b[0], b[1], b[2]]) + a[3] * b[3]; if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + t * (b[i] - v)));
  const th = Math.acos(d), s0 = Math.sin((1 - t) * th) / Math.sin(th), s1 = Math.sin(t * th) / Math.sin(th);
  return a.map((v, i) => s0 * v + s1 * b[i]);
}

// ------------------------------------------------------------------ bounded arm optimiser (key solve)
// 7 anatomical DOF, each box-bounded by the body profile: humerus azimuth/elevation, humeral rotation, elbow,
// pronation, wrist flexion, wrist deviation. Objective: racket sweet spot at the target (1 cm = 1), face normal
// (either face, 8 deg = 1), handle direction (25 deg = 1), wrist/pronation cues, authored elbow pole.
export function armBounds(ch, full = false) {
  const r = ch.rom;
  if (full) return { az: [-r.shoulderBack, 90 + r.shoulderCross], el: [0, 178], rot: r.shoulderRot, elbow: r.elbow, pron: r.pron, wflex: r.wflex, wdev: r.wdev };
  const m = (a, k = 6) => [a[0] + k, a[1] - k];      // keys stay 6 deg inside each limit (frames may use the margin smoothly)
  return { az: [-r.shoulderBack + 6, 90 + r.shoulderCross - 6], el: [0, 165], rot: m(r.shoulderRot), elbow: [r.elbow[0] + 2, r.elbow[1] - 6], pron: m(r.pron), wflex: m(r.wflex), wdev: m(r.wdev, 4) };
}
import { makeLoco, comOf } from "./loco.js";
export const PK = ["az", "el", "rot", "elbow", "pron", "wflex", "wdev"];
function angOf(a, b) { return Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * DEG; }
export function optimizeArm(ch, side, Dchest, shoulderPos, target, init, grip, extra = {}, prevJ = null, steps = [16, 8, 4, 2, 1, 0.5, 0.25], bounds = null) {
  const bd = bounds || armBounds(ch), rk = grip ? grip.rk : null, gs = grip ? (side === "r" ? grip.R : grip.L) : null;
  const L1 = ch.L[`${side}_upper`], L2 = ch.L[`${side}_fore`];
  const pf = target.pref || {};
  const clampJ = (J) => { const o = { ...J }; for (const k of PK) o[k] = Math.max(bd[k][0], Math.min(bd[k][1], o[k])); return o; };
  const evalJ = (J) => {
    const A = armFromAngles(ch, side, Dchest, J);
    const elbowPos = add(shoulderPos, qrot(A.upper, [0, -L1, 0]));
    const wrist = add(elbowPos, qrot(qmul(A.upper, qaxis([1, 0, 0], -J.elbow)), [0, -L2, 0]));
    let c = 0;
    if (target.center || target.racketOnly) {
      const R = qmul(A.hand, gs.G), origin = add(wrist, qrot(A.hand, gs.g)), center = add(origin, qrot(R, [0, -rk.center, 0]));
      const n = qrot(R, [0, 0, 1]), d = qrot(R, [0, -1, 0]);
      const ps = target.posScale ?? 0.01, fs = target.faceScale ?? 8, ds = target.dirScale ?? 25;
      if (target.center) c += (len(sub(center, target.center)) / ps) ** 2;
      if (target.face) { const fa = target.faceSigned ? angOf(n, target.face) : Math.min(angOf(n, target.face), angOf(mul(n, -1), target.face)); c += (target.faceW ?? 1) * (fa / fs) ** 2; }
      if (target.dir) c += (target.dirW ?? 1) * (angOf(d, target.dir) / ds) ** 2;
      if (extra.body) {                     // keep the racket head out of the head / torso volumes
        for (let i = 0; i < 12; i++) { const a = 2 * Math.PI * i / 12;
          const wp = add(origin, qrot(R, [rk.head.half_width * Math.cos(a), -rk.center + rk.head.half_height * Math.sin(a), 0]));
          for (const [a0, b0, rad] of extra.body) { const ab = sub(b0, a0); const tt = Math.max(0, Math.min(1, dot(sub(wp, a0), ab) / (dot(ab, ab) || 1)));
            const def = rad + 0.03 - len(sub(wp, add(a0, mul(ab, tt)))); if (def > 0) c += 5 * (def / 0.01) ** 2; } }
      }
      if (extra.leftReach) {                // two-handed: score the second hand's best legal grip on this racket pose
        const lr = extra.leftReach, fist2 = add(origin, qrot(R, [0, -(rk.fist + lr.along), 0]));
        const dl = len(sub(fist2, lr.shoulder)); const ex2 = dl - (lr.gsL && lr.w === 0 ? 0.97 * (lr.L + len(lr.gsL.fistL)) : 0.86 * lr.L); if (ex2 > 0)   // v12 loose grip: the fist sits a hand-length past the wrist (0.86 x arm-to-wrist forbade a normal two-hand contact)
        c += (ex2 / 0.01) ** 2; if (dl < 0.35 * lr.L) c += ((0.35 * lr.L - dl) / 0.01) ** 2;
        if (!lr.w) { /* reach-only estimate */ } else {
        const handL = qmul(R, qinv(lr.gsL.G)), wristL = sub(fist2, qrot(handL, lr.gsL.fistL));
        const JL = solveArmFast(ch, "l", Dchest, lr.shoulder, wristL, handL, lr.pole);
        const AL = armFromAngles(ch, "l", Dchest, JL);
        const elL = add(lr.shoulder, qrot(AL.upper, [0, -ch.L.l_upper, 0]));
        const wrL = add(elL, qrot(qmul(AL.upper, qaxis([1, 0, 0], -JL.elbow)), [0, -ch.L.l_fore, 0]));
        const gap = len(sub(add(wrL, qrot(AL.hand, lr.gsL.fistL)), fist2));
        const smL = shoulderMeasures("l", JL.shoulder);
        c += (lr.w ?? 0) * ((gap / 0.012) ** 2 + 10 * (excess(smL.rot, ch.rom.shoulderRot) / 5) ** 2);
        }
      }
    } else if (target.wrist) c += (len(sub(wrist, target.wrist)) / 0.01) ** 2;
    if (target.handle) {                  // second hand: fist on the handle axis inside a slide band, hand axis along the handle, limited roll
      const hdl = target.handle, gsL = hdl.gs;
      const fist = add(wrist, qrot(A.hand, gsL.fistL)), v = sub(fist, hdl.p);
      const a = Math.max(hdl.band[0], Math.min(hdl.band[1], dot(v, hdl.d)));
      c += (len(sub(fist, add(hdl.p, mul(hdl.d, a)))) / 0.002) ** 2;
      const axL = qrot(A.hand, qrot(gsL.G, [0, -1, 0])), nL = qrot(A.hand, qrot(gsL.G, [0, 0, 1]));
      c += (Math.max(0, angOf(axL, hdl.d) - (hdl.tilt ?? 0)) / 2) ** 2;
      const roll = angOf(nL, hdl.n); c += (Math.max(0, roll - hdl.roll) / 3) ** 2;
    }
    if (target.handQ) { const dq = Math.abs(qmul(qinv(A.hand), target.handQ)[3]); c += ((2 * Math.acos(Math.min(1, dq)) * DEG) / 6) ** 2; }
    c += ((J.wflex - (pf.wflex ?? 0)) / 20) ** 2 + ((J.wdev - (pf.wdev ?? 0)) / 20) ** 2 + ((J.pron - (pf.pron ?? 0)) / 40) ** 2;
    if (target.pole) { const mid = add(shoulderPos, mul(sub(wrist, shoulderPos), 0.5)); c += 0.5 * (angOf(sub(elbowPos, mid), target.pole) / 45) ** 2; }
    if (prevJ) for (const k of PK) c += (target.contW ?? 0.15) * ((J[k] - prevJ[k]) / 40) ** 2;   // continuity with the previous key
    if (target.near) for (const k of PK) c += ((J[k] - target.near[k]) / (target.nearScale?.[k] ?? 8)) ** 2;   // stay near the interpolated joints (v11: per-joint scale)
    if (target.accel) for (const k of PK) c += ((J[k] - target.accel[k]) / (target.accelScale ?? 3)) ** 2;             // smooth: stay near the constant-velocity prediction
    if (target.prior) c += target.prior * (((J.rot - 20) / 50) ** 2 + (Math.max(0, 30 - J.elbow) / 25) ** 2 + (Math.max(0, J.elbow - 120) / 25) ** 2);
    for (const k of ["rot", "pron", "wflex", "wdev"]) { const [lo, hi] = bd[k], m = 0.12 * (hi - lo); c += 0.02 * (Math.max(0, J[k] - (hi - m)) ** 2 + Math.max(0, lo + m - J[k]) ** 2); }
    return { c, wrist };
  };
  const local = (J0) => {
    let J = clampJ(J0), best = evalJ(J).c;
    for (const step of steps) {
      for (let pass = 0; pass < 40; pass++) {
        let improved = false;
        for (const k of PK) for (const sgn of [1, -1]) {
          const T = clampJ({ ...J, [k]: J[k] + sgn * step }); const v = evalJ(T).c;
          if (v < best - 1e-9) { best = v; J = T; improved = true; }
        }
        if (!improved) break;
      }
    }
    return { J, best };
  };
  let starts = [init];
  if (extra.multiStart) {                 // global: deterministic quasi-random samples over the joint box, keep the best few
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const smp = [];
    for (let i = 0; i < extra.multiStart; i++) { const J = {}; for (const k of PK) J[k] = bd[k][0] + rnd() * (bd[k][1] - bd[k][0]); smp.push([evalJ(J).c, J]); }
    smp.sort((a, b) => a[0] - b[0]); starts = starts.concat(smp.slice(0, 4).map((x) => x[1]));
  }
  let bestR = null; for (const st of starts) { const r = local(st); if (!bestR || r.best < bestR.best) bestR = r; }
  return { J: bestR.J, cost: bestR.best, wrist: evalJ(bestR.J).wrist };
}
function anglesToParams(ch, side, J) {             // analytic-IK seed -> optimiser parameters
  const sm = shoulderMeasures(side, J.shoulder); const h = qrot(J.shoulder, [0, -1, 0]); const sx = side === "r" ? -1 : 1;
  return { az: Math.atan2(h[2], h[0] * sx) * DEG, el: Math.acos(Math.max(-1, Math.min(1, -h[1]))) * DEG, rot: sm.rot, elbow: J.elbow, pron: J.pron, wflex: J.wflex, wdev: J.wdev };
}
// ------------------------------------------------------------------ key solve (phase targets -> joint state)

// phase pose (v6): trunk fields as v5; racket:{center,dir,face} (world); r_pole; r_wrist:{flex,dev} preference;
// l_arm:{hand,dir,face,pole} for the free hand; r_leg/l_leg feet; two_hand (0/1)
export function solveKey(ch, p, grip, opts = {}, prev = null) {
  const D = trunkD(p);
  const feet = { r: { foot: p.r_leg.foot, lift: p.r_leg.lift || 0 }, l: { foot: p.l_leg.foot, lift: p.l_leg.lift || 0 } };
  const trunk = fk(ch, D, lowerPelvis(ch, D, p.pelvis, feet), {});
  const rk = grip.rk, gs = grip.R;
  const shR = trunk.pos[ch.N("R UpperArm")], shL = trunk.pos[ch.N("L UpperArm")];
  // seed: analytic IK + swivel search on the exact racket pose; then the bounded optimiser
  // v2 (2026-11-08): the hitting face is signed. +Z of the implement = the palm-side face. Forehands, serves and overheads
  // hit with the palm side, backhands with the back of the hand. v1 accepted either face, so 8 strokes hit with the wrong
  // side (forearm twisted ~180 deg). Contact: face toward the outgoing ball x faceSide; other keys: the sign that keeps the
  // palm-side normal continuous with the neighbouring key already solved.
  let faceT = p.racket.face, signed = false;
  if (opts.faceSide && opts.outVel) { faceT = dot(faceT, opts.outVel) < 0 ? mul(faceT, -opts.faceSide) : mul(faceT, opts.faceSide); signed = true; }
  else if (opts.palmRef) { faceT = dot(faceT, opts.palmRef) < 0 ? mul(faceT, -1) : faceT; signed = true; }
  const Rt = basis(p.racket.dir, faceT), handT = qmul(Rt, qinv(gs.G));
  const wristT = sub(sub(p.racket.center, qrot(Rt, [0, -rk.center, 0])), qrot(handT, gs.g));
  const seed = solveArm(ch, "r", D.chest, shR, wristT, handT, norm(p.r_pole), { ...(p.r_wrist || {}) });
  const twoH = (p.two_hand || 0) > 0.5 && grip.L;
  const C = opts.isContact;
  const tgtR = { center: p.racket.center, face: faceT, faceSigned: signed, dir: p.racket.dir, pole: norm(p.r_pole), pref: p.r_wrist || {},
                 posScale: C ? 0.01 : 0.06, faceScale: C ? 8 : 30, dirScale: C ? (twoH ? 10 : 25) : 45,   // v12: two-hand contact keys keep centre and racket direction (was 0.04 m / dirW 0.08: racket hung head-down)
                 faceW: C ? 3 : 1, dirW: twoH ? (opts.twoDirW ?? 0.6) : (C ? 0.6 : 0.5),
                 contW: C ? 0.15 : Math.min(8, opts.contK ?? 1), prior: C ? 0 : 1 };
  const P = trunk.pos, cap = ch.body.body_capsules_m, hd = add(P[ch.N("Head")], [0, 0.09, 0]);
  const body = [[P[ch.N("Pelvis")], P[ch.N("Spine2")], cap.torso_lower], [P[ch.N("Spine2")], P[ch.N("Neck")], cap.torso_upper], [hd, hd, cap.head]];
  const rOpt = optimizeArm(ch, "r", D.chest, shR, tgtR, anglesToParams(ch, "r", seed.J), grip,
    { body, multiStart: twoH ? 4000 : 1500, ...(twoH ? { leftReach: { shoulder: shL, along: grip.secondAlong, L: ch.L.l_upper + ch.L.l_fore, gsL: grip.L, pole: norm(p.l_arm.pole), w: grip.loose ? 0 : 60 } } : {}) }, prev ? prev.arms.r : null);
  // left: free hand to its wrist target, or (two-handed) onto the handle through its own grip socket
  let lOpt;
  if (twoH) {
    const A = armFromAngles(ch, "r", D.chest, rOpt.J); const R = qmul(A.hand, gs.G), origin = add(rOpt.wrist, qrot(A.hand, gs.g));
    const fistT = add(origin, qrot(R, [0, -(rk.fist + grip.secondAlong), 0])); const handL = qmul(R, qinv(grip.L.G));
    const wristL = sub(fistT, qrot(handL, grip.L.fistL));
    const s2 = solveArm(ch, "l", D.chest, shL, wristL, handL, norm(p.l_arm.pole), {});
    lOpt = grip.loose
      ? optimizeArm(ch, "l", D.chest, shL, { handle: { gs: grip.L, p: origin, d: qrot(R, [0, -1, 0]), n: qrot(R, [0, 0, 1]), band: [rk.fist + grip.slide[0], rk.fist + grip.slide[1]], tilt: grip.tiltFree, roll: grip.rollFree }, pole: norm(p.l_arm.pole), pref: {} }, anglesToParams(ch, "l", s2.J), null, { multiStart: 1500 }, prev ? prev.arms.l : null)
      : optimizeArm(ch, "l", D.chest, shL, { wrist: wristL, handQ: handL, pole: norm(p.l_arm.pole), pref: {} }, anglesToParams(ch, "l", s2.J), null, {}, prev ? prev.arms.l : null);
  } else {
    const la = p.l_arm; const pref = { wflex: la.wflex ?? -10, wdev: 0, pron: la.pron ?? 0 };
    const s2 = solveArm(ch, "l", D.chest, shL, la.hand, null, norm(la.pole), pref);
    lOpt = optimizeArm(ch, "l", D.chest, shL, { wrist: la.hand, pole: norm(la.pole), pref, contW: 1.0, prior: 1 }, anglesToParams(ch, "l", s2.J), null, {}, prev ? prev.arms.l : null);
  }
  if (p.r_pins) for (const k in p.r_pins) rOpt.J[k] = p.r_pins[k];   // joint-angle keys (e.g. racket drop: rot 170, elbow 100)
  return { trunk: { pelvis: p.pelvis, yaw: p.yaw, lean: p.lean, chest_yaw: p.chest_yaw, chest_roll: p.chest_roll || 0, head_pitch: p.head_pitch, head_yaw: p.head_yaw || 0 },
           arms: { r: rOpt.J, l: lOpt.J }, diag: { r: { cost: rOpt.cost, seed }, l: { cost: lOpt.cost } } };
}

// ------------------------------------------------------------------ splines
function clampedSpline(t, y) {
  const n = t.length - 1, h = []; for (let i = 0; i < n; i++) h.push(t[i + 1] - t[i]);
  const m = new Array(n + 1).fill(0), A2 = [], B2 = [], C2 = [], R2 = [];
  for (let i = 1; i < n; i++) { A2.push(i > 1 ? h[i] : 0); B2.push(2 * (h[i - 1] + h[i])); C2.push(i < n - 1 ? h[i - 1] : 0);
    R2.push(3 * (h[i - 1] * (y[i + 1] - y[i]) / h[i] + h[i] * (y[i] - y[i - 1]) / h[i - 1])); }
  const N = n - 1;
  if (N > 0) { const cp = new Array(N), rp = new Array(N); cp[0] = C2[0] / B2[0]; rp[0] = R2[0] / B2[0];
    for (let i = 1; i < N; i++) { const den = B2[i] - A2[i] * cp[i - 1]; cp[i] = C2[i] / den; rp[i] = (R2[i] - A2[i] * rp[i - 1]) / den; }
    m[N] = rp[N - 1]; for (let i = N - 2; i >= 0; i--) m[i + 1] = rp[i] - cp[i] * m[i + 2]; }
  return hermite(t, y, m);
}
function pchip(t, y) {
  const n = t.length - 1, d = [], m = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) d.push((y[i + 1] - y[i]) / (t[i + 1] - t[i]));
  for (let i = 1; i < n; i++) { if (d[i - 1] * d[i] <= 0) m[i] = 0; else { const w1 = 2 * (t[i + 1] - t[i]) + (t[i] - t[i - 1]), w2 = (t[i + 1] - t[i]) + 2 * (t[i] - t[i - 1]); m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); } }
  return hermite(t, y, m);
}
function hermite(t, y, m) {
  const n = t.length - 1;
  return (x) => { if (x <= t[0]) return y[0]; if (x >= t[n]) return y[n]; let i = 0; while (i < n - 1 && x > t[i + 1]) i++;
    const h = t[i + 1] - t[i], s = (x - t[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h * m[i + 1]; };
}
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (6 * x - 15) + 10); };

// ------------------------------------------------------------------ technique compile
// layer = { implements: {id: json}, grips: {id: json} }; a technique names its implement (or the sport's default) and grip
export function makeGrip(ch, tech, sport, layer) {
  const impl = layer.implements[tech.implement || sport.implement]; if (!impl) throw new Error(`${tech.id}: unknown implement`);
  const gdef = layer.grips[tech.grip || "continental"]; if (!gdef) throw new Error(`${tech.id}: unknown grip ${tech.grip}`);
  const R = gripSocket(ch, "r", gdef, impl);
  const sh = gdef.second_hand; const L = sh ? gripSocket(ch, "l", layer.grips[sh.grip], impl, !!sh.opposite_face) : null;
  return { impl, rk: rkOf(impl), R, L, secondAlong: sh ? sh.along_handle_m : 0, slide: sh ? (sh.slide_m || [sh.along_handle_m, sh.along_handle_m]) : null, rollFree: sh ? Math.max(sh.roll_free_deg ?? 0, sh.loose_deg ?? 0) : 0, tiltFree: sh ? Math.max(sh.tilt_free_deg ?? 0, sh.loose_deg ?? 0) : 0, loose: sh ? (sh.loose_deg ?? 0) : 0, closureTilt: sh ? (sh.closure_tilt_deg ?? Math.max(sh.tilt_free_deg ?? 0, sh.loose_deg ?? 0)) : 0,   // v12 loose_deg: second hand only has to sit ON the handle (axis tilt and roll free up to loose_deg), so it cannot dictate the racket face
    curlsR: R.curls, curlsL: L ? L.curls : relaxedCurls(ch, "L") };
}
export function compileTechnique(ch, tech, sport, layer, opts = {}) {
  const ph = tech.phases, T = ph.map((p) => p.t);
  const grip = makeGrip(ch, tech, sport, layer), rk = grip.rk; const LOCO = makeLoco(tech);
  const iC = ph.findIndex((p) => p.name === (tech.contact?.phase || "contact")); const tc = T[iC];
  const keyPose = ph.map((P, i) => { const q = JSON.parse(JSON.stringify(P.pose));
    if (opts.contactHeight && i === iC) { q.racket.center[1] += opts.contactHeight; q.pelvis[1] += opts.contactHeight * 0.25; }
    return q; });
  const keys = new Array(keyPose.length);
  const isBH = tech.face_side ? tech.face_side === "back" : /backhand/.test(tech.family + " " + tech.id + " " + (tech.side || ""));
  const gdef = layer.grips[tech.grip] || {};   // which model face hits, per grip: forehand side +Z (palm side), backhand side -Z, except grips that say otherwise
  const faceSide = tech.face_side === "either" ? 0 : (isBH ? (gdef.bh_face ?? -1) : (gdef.fh_face ?? 1));
  const signed = opts.signedFace !== false && faceSide !== 0;
  const palmOf = (K, q) => poseFromState(ch, { trunk: K.trunk, arms: K.arms, feet: { r: { foot: q.r_leg.foot, yaw: q.r_leg.yaw ?? 0, lift: q.r_leg.lift || 0 }, l: { foot: q.l_leg.foot, yaw: q.l_leg.yaw ?? 0, lift: q.l_leg.lift || 0 } }, twoHand: 0 }, grip).racket.normal;
  keys[iC] = solveKey(ch, keyPose[iC], grip, { isContact: true, ...(signed ? { faceSide, outVel: norm(tech.ball.out.vel) } : {}) }, null);
  for (let i = iC + 1; i < keyPose.length; i++) keys[i] = solveKey(ch, keyPose[i], grip, { contK: (0.3 / (T[i] - T[i - 1])) ** 2, ...(signed ? { palmRef: palmOf(keys[i - 1], keyPose[i - 1]) } : {}) }, keys[i - 1]);
  for (let i = iC - 1; i >= 0; i--) keys[i] = solveKey(ch, keyPose[i], grip, { contK: (0.3 / (T[i + 1] - T[i])) ** 2, ...(signed ? { palmRef: palmOf(keys[i + 1], keyPose[i + 1]) } : {}) }, keys[i + 1]);
  // the loop closes on the first key: the last key (same pose) reuses it exactly
  if (JSON.stringify(keyPose[0]) === JSON.stringify(keyPose[keyPose.length - 1])) keys[keys.length - 1] = keys[0];
  // joint-space splines (rebuilt when automatic via-keys are added)
  const bd = armBounds(ch, true);
  let Tk = T.slice(), K = keys.slice(), FT = keyPose.map((q) => ({ r: q.r_leg, l: q.l_leg, th: q.two_hand || 0 }));
  const build = () => {
    const tf = {}; for (const k of ["yaw", "lean", "chest_yaw", "chest_roll", "head_pitch", "head_yaw"]) tf[k] = clampedSpline(Tk, K.map((Q) => Q.trunk[k]));
    const pf = [0, 1, 2].map((c) => clampedSpline(Tk, K.map((Q) => Q.trunk.pelvis[c])));
    // v11 (2026-11-08): joints listed in tech.monotone_joints (e.g. ["pron"]) use monotone PCHIP between keys: a C2 spline
    // rings after a fast swing (pron -78 -> +45 in 0.16 s), giving the forearm a back-and-forth twist in the finish.
    const MJ = new Set(tech.monotone_joints || []);
    const af = {}; for (const s of ["r", "l"]) { af[s] = {}; for (const k of PK) { const ys = K.map((Q) => Q.arms[s][k]), sp = clampedSpline(Tk, ys);
      if (s === "r" && MJ.has(k)) { const pc = pchip(Tk, ys); af[s][k] = (t) => (t < tc ? sp(t) : pc(t)); } else af[s][k] = sp; } }   // monotone only after contact
    const ff = {}; for (const s of ["r", "l"]) { const g = (fn) => pchip(Tk, FT.map((q) => fn(q[s])));
      ff[s] = { x: g((l) => l.foot[0]), z: g((l) => l.foot[1]), yaw: g((l) => l.yaw ?? 0), lift: g((l) => l.lift || 0) }; }
    const th = pchip(Tk, FT.map((q) => q.th));
    return (t) => {
      const trunk = { pelvis: pf.map((f) => f(t)) }; for (const k in tf) trunk[k] = tf[k](t);
      const arms = {}; for (const s of ["r", "l"]) { const J = {}; for (const k of PK) J[k] = soft(af[s][k](t), bd[k][0], bd[k][1], 6); arms[s] = J; }
      const feet = Object.fromEntries(["r", "l"].map((s) => [s, { foot: [ff[s].x(t), ff[s].z(t)], yaw: ff[s].yaw(t), lift: ff[s].lift(t) }]));
      const st = { trunk, arms, feet, twoHand: th(t) }; return LOCO ? LOCO.apply(t, st) : st;
    };
  };
  let at = build();
  // automatic via-keys: where the interpolated racket passes through the torso / head / thighs, insert a key at
  // that instant solved to stay near the interpolated arm while clearing the body; repeat (max 4)
  const bodyCaps = (P) => { const cap = ch.body.body_capsules_m, hd = add(P[ch.N("Head")], [0, 0.09, 0]);
    return [[P[ch.N("Pelvis")], P[ch.N("Spine2")], cap.torso_lower], [P[ch.N("Spine2")], P[ch.N("Neck")], cap.torso_upper], [hd, hd, cap.head],
      [P[ch.N("R Thigh")], P[ch.N("R Calf")], cap.thigh], [P[ch.N("L Thigh")], P[ch.N("L Calf")], cap.thigh]]; };
  const clearance = (r) => { let m = 9;
    for (let i = 0; i < 12; i++) { const a = 2 * Math.PI * i / 12; const wp = add(r.racket.origin, qrot(r.racket.R, [rk.head.half_width * Math.cos(a), -rk.center + rk.head.half_height * Math.sin(a), 0]));
      for (const [a0, b0, rad] of bodyCaps(r.pos)) { const ab = sub(b0, a0); const tt = Math.max(0, Math.min(1, dot(sub(wp, a0), ab) / (dot(ab, ab) || 1)));
        m = Math.min(m, len(sub(wp, add(a0, mul(ab, tt)))) - rad - rk.head.thickness / 2); } }
    return m; };
  for (let it = 0; it < 4; it++) {
    let worst = [0.02, -1];
    for (let t = Tk[0]; t <= Tk[Tk.length - 1]; t += 1 / 60) { const c = clearance(poseFromState(ch, at(t), grip)); if (c < worst[0]) worst = [c, t]; }
    if (worst[1] < 0) break;
    const tv = worst[1]; if (Tk.some((x) => Math.abs(x - tv) < 0.03)) break;
    const st = at(tv); const D = trunkD(st.trunk); const pel = lowerPelvis(ch, D, st.trunk.pelvis, st.feet); const trk = fk(ch, D, pel, {});
    const o = optimizeArm(ch, "r", D.chest, trk.pos[ch.N("R UpperArm")], { racketOnly: true, near: st.arms.r, pref: {} }, st.arms.r, grip,
      { body: bodyCaps(trk.pos).map(([a, b, r]) => [a, b, r + 0.02]) }, null, [8, 4, 2, 1, 0.5], armBounds(ch));
    const i = Tk.findIndex((x) => x > tv);
    Tk.splice(i, 0, tv); K.splice(i, 0, { trunk: { ...st.trunk }, arms: { r: o.J, l: st.arms.l }, diag: { via: true } });
    FT.splice(i, 0, { r: st.feet.r, l: st.feet.l, th: st.twoHand });
    at = build();
  }
  if (tech.micro) at = microLayer(at, tech.micro, tc, T[0], T[T.length - 1]);
  const at0ref = at;
  let solve = (t) => poseFromState(ch, at(t), grip); let bakeOut = null;
  if (grip.L) {   // two-handed = closed chain: both arms solved TOGETHER at dense keys (1/30 s) by box-projected
                  // Levenberg-Marquardt over the 14 joint angles. Hard terms: second-hand fist on the handle axis inside its slide
                  // band, hand axis along the handle. Soft terms: racket follows the interpolated stroke path (centre, face),
                  // continuity and acceleration vs the previous dense keys. Joint ranges are box bounds.
    const keyRk = Tk.map((t) => poseFromState(ch, { ...at(t), twoHand: 0 }, grip).racket);
    const cf = [0, 1, 2].map((c) => clampedSpline(Tk, keyRk.map((r) => r.center[c])));
    // v12 (2026-11-08): signed face in the closed chain too. The hitting face is ccS * (+Z normal) for every key (the keys were
    // solved with the signed face); v11 flipped normals for continuity and used a sign-blind cross() residual, so the
    // two-handed backhand could hit with the wrong face.
    const ccS = faceSide || 0;
    const nfA = []; for (const r of keyRk) { let n = ccS ? mul(r.normal, ccS) : r.normal; const pr = nfA[nfA.length - 1]; if (!ccS && pr && dot(pr, n) < 0) n = mul(n, -1); nfA.push(n); }
    const nf = [0, 1, 2].map((c) => clampedSpline(Tk, nfA.map((n) => n[c])));
    const bf = armBounds(ch, true), NP = PK.length;
    const toX = (Jr, Jl) => PK.map((k) => Jr[k]).concat(PK.map((k) => Jl[k]));
    const fromX = (x) => { const Jr = {}, Jl = {}; PK.forEach((k, i) => { Jr[k] = x[i]; Jl[k] = x[i + NP]; }); return [Jr, Jl]; };
    const clampX = (x) => x.map((v, i) => { const b = bf[PK[i % NP]]; return Math.max(b[0], Math.min(b[1], v)); });
    const BK = !opts.rebake && tech.closed_chain_bake;   // baked tables (scripts/bake_two_hand.mjs) skip both solves
    const step = 1 / (opts.keyHz || 30), ts = BK ? BK.ts.slice() : [], jr = BK ? BK.jr : [], jl = BK ? BK.jl : []; let xPrev = null, xPrev2 = null;
    if (!BK) for (let t = Tk[0]; t <= Tk[Tk.length - 1] + 1e-9; t += step) {
      const st = at(t); const D = trunkD(st.trunk); const pel = lowerPelvis(ch, D, st.trunk.pelvis, st.feet); const trk = fk(ch, D, pel, {});
      const shR = trk.pos[ch.N("R UpperArm")], shL = trk.pos[ch.N("L UpperArm")];
      const cT = cf.map((f) => f(t)), nT = norm(nf.map((f) => f(t)));
      const pred = xPrev ? xPrev.map((v, i) => 2 * v - (xPrev2 || xPrev)[i]) : null;
      const resid = (x) => {
        const [Jr, Jl] = fromX(x); const r = [];
        const A = armFromAngles(ch, "r", D.chest, Jr), el = add(shR, qrot(A.upper, [0, -ch.L.r_upper, 0])), wr = add(el, qrot(qmul(A.upper, qaxis([1, 0, 0], -Jr.elbow)), [0, -ch.L.r_fore, 0]));
        const R = qmul(A.hand, grip.R.G), origin = add(wr, qrot(A.hand, grip.R.g)), center = add(origin, qrot(R, [0, -rk.center, 0]));
        const n = qrot(R, [0, 0, 1]), d = qrot(R, [0, -1, 0]);
        sub(center, cT).forEach((v) => r.push(v / 0.03));
        const fw = opts.fw || 0.3; if (ccS) sub(mul(n, ccS), nT).forEach((v) => r.push(v / fw)); else { const nn = dot(n, nT) < 0 ? mul(n, -1) : n; cross(nn, nT).forEach((v) => r.push(v / fw)); }
        const AL = armFromAngles(ch, "l", D.chest, Jl), elL = add(shL, qrot(AL.upper, [0, -ch.L.l_upper, 0])), wrL = add(elL, qrot(qmul(AL.upper, qaxis([1, 0, 0], -Jl.elbow)), [0, -ch.L.l_fore, 0]));
        const fist = add(wrL, qrot(AL.hand, grip.L.fistL)), v = sub(fist, origin), along = dot(v, d);
        sub(v, mul(d, along)).forEach((q) => r.push(q / (opts.ccFist ?? 0.003)));   // v12: was 0.1 mm: 2 mm of left-fist error outweighed 60 cm of racket path, so the right arm left its keys; the closure pass below makes the left fist exact
        const lo = rk.fist + grip.slide[0], hi = rk.fist + grip.slide[1]; r.push((along < lo ? along - lo : along > hi ? along - hi : 0) / (opts.ccFist ?? 0.003));
        const axL = qrot(AL.hand, qrot(grip.L.G, [0, -1, 0])); const tilt = Math.acos(Math.max(-1, Math.min(1, dot(axL, d)))) * DEG; r.push(Math.max(0, tilt - grip.tiltFree) / (opts.ccTilt ?? 3));
        const nL = qrot(AL.hand, qrot(grip.L.G, [0, 0, 1])); const roll = Math.acos(Math.max(-1, Math.min(1, dot(nL, n)))) * DEG; r.push(Math.max(0, roll - grip.rollFree) / 2);
        if (xPrev) x.forEach((q, i) => r.push((q - xPrev[i]) / 40));
        if (pred) x.forEach((q, i) => r.push((q - pred[i]) / (opts.ccPred ?? 12)));
        return r;
      };
      const cost = (r) => r.reduce((s, v) => s + v * v, 0);
      // v12: seed every dense frame from the interpolated KEY arms (the keys are already jointly holdable two-handed poses);
      // v11 seeded from the previous frame and pulled hard toward constant velocity, so the chain drifted 30-40 cm off the keys.
      let x = clampX(toX(st.arms.r, st.arms.l)), r = resid(x), c = cost(r), lam = 1e-2;
      { const xp = xPrev ? clampX(xPrev.slice()) : null; if (xp) { const rp = resid(xp), cp = cost(rp); if (cp < c) { x = xp; r = rp; c = cp; } } }
      for (let it = 0; it < 60; it++) {
        const m = r.length, Jm = [];
        for (let j = 0; j < 2 * NP; j++) { const xe = x.slice(); xe[j] += 0.05; const re = resid(xe); Jm.push(re.map((v, i) => (v - r[i]) / 0.05)); }
        const JtJ = []; const Jtr = new Array(2 * NP).fill(0);
        for (let a = 0; a < 2 * NP; a++) { JtJ.push(new Array(2 * NP).fill(0)); for (let i = 0; i < m; i++) Jtr[a] += Jm[a][i] * r[i]; }
        for (let a = 0; a < 2 * NP; a++) for (let b = a; b < 2 * NP; b++) { let s2 = 0; for (let i = 0; i < m; i++) s2 += Jm[a][i] * Jm[b][i]; JtJ[a][b] = JtJ[b][a] = s2; }
        let improved = false;
        for (let tries = 0; tries < 6; tries++) {
          const Aa = JtJ.map((row, a) => row.map((v, b) => v + (a === b ? lam * (v + 1e-6) : 0))), bb = Jtr.map((v) => -v);
          const n2 = 2 * NP;                     // Gaussian elimination
          for (let p = 0; p < n2; p++) { let mx = p; for (let q = p + 1; q < n2; q++) if (Math.abs(Aa[q][p]) > Math.abs(Aa[mx][p])) mx = q;
            [Aa[p], Aa[mx]] = [Aa[mx], Aa[p]]; [bb[p], bb[mx]] = [bb[mx], bb[p]];
            for (let q = p + 1; q < n2; q++) { const f = Aa[q][p] / (Aa[p][p] || 1e-12); for (let k = p; k < n2; k++) Aa[q][k] -= f * Aa[p][k]; bb[q] -= f * bb[p]; } }
          const dx = new Array(n2).fill(0); for (let p = n2 - 1; p >= 0; p--) { let s2 = bb[p]; for (let k = p + 1; k < n2; k++) s2 -= Aa[p][k] * dx[k]; dx[p] = s2 / (Aa[p][p] || 1e-12); }
          const xn = clampX(x.map((v, i) => v + dx[i])), rn = resid(xn), cn = cost(rn);
          if (cn < c) { x = xn; r = rn; c = cn; lam = Math.max(1e-7, lam / 3); improved = true; break; } else lam *= 5;
        }
        if (!improved) break;
      }
      xPrev2 = xPrev; xPrev = x;
      const [Jr, Jl] = fromX(x); ts.push(t); jr.push(Jr); jl.push(Jl);
    }
    const n = ts.length, m = Math.max(2, Math.round(0.25 / step));
    const closeLoop = (arr) => tech.end === "hold" ? arr : arr.map((v, i) => {   // v12: held strokes do not blend back to the first key (that blend jerked the left arm in the last 0.25 s)
      const u = (i - (n - 1 - m)) / m; if (u <= 0) return v; const ww = u * u * u * (u * (6 * u - 15) + 10); return v + (arr[0] - v) * ww; });
    const rf = {}, lf = {}; for (const k of PK) { rf[k] = clampedSpline(ts, closeLoop(jr.map((J) => J[k]))); lf[k] = clampedSpline(ts, closeLoop(jl.map((J) => J[k]))); }
    // closure pass: at every 1/120 s the left arm alone is re-solved (LM, 7 angles) so its fist sits exactly on the handle
    // axis inside the slide band with the hand axis along the handle. The prior is the spline value AT THAT TIME (no history),
    // so the result is a smooth function of t; it is then re-splined.
    const lmSolve = (x0, resid, lo, hi, iters) => {
      const N2 = x0.length, cost = (r) => r.reduce((a, v) => a + v * v, 0);
      let x = x0.map((v, i) => Math.max(lo[i], Math.min(hi[i], v))), r = resid(x), c = cost(r), lam = 1e-3;
      for (let it = 0; it < iters; it++) {
        const Jm = []; for (let j = 0; j < N2; j++) { const xe = x.slice(); xe[j] += 0.02; const re = resid(xe); Jm.push(re.map((v, i) => (v - r[i]) / 0.02)); }
        const JtJ = Jm.map((a) => Jm.map((b) => a.reduce((s2, v, i) => s2 + v * b[i], 0))), Jtr = Jm.map((a) => a.reduce((s2, v, i) => s2 + v * r[i], 0));
        let ok = false;
        for (let tries = 0; tries < 8; tries++) {
          const Aa = JtJ.map((row, a) => row.map((v, b) => v + (a === b ? lam * (v + 1e-6) : 0))), bb = Jtr.map((v) => -v);
          for (let p = 0; p < N2; p++) { let mx = p; for (let q = p + 1; q < N2; q++) if (Math.abs(Aa[q][p]) > Math.abs(Aa[mx][p])) mx = q;
            [Aa[p], Aa[mx]] = [Aa[mx], Aa[p]]; [bb[p], bb[mx]] = [bb[mx], bb[p]];
            for (let q = p + 1; q < N2; q++) { const f = Aa[q][p] / (Aa[p][p] || 1e-12); for (let k = p; k < N2; k++) Aa[q][k] -= f * Aa[p][k]; bb[q] -= f * bb[p]; } }
          const dx = new Array(N2).fill(0); for (let p = N2 - 1; p >= 0; p--) { let s2 = bb[p]; for (let k = p + 1; k < N2; k++) s2 -= Aa[p][k] * dx[k]; dx[p] = s2 / (Aa[p][p] || 1e-12); }
          const xn = x.map((v, i) => Math.max(lo[i], Math.min(hi[i], v + dx[i]))), rn = resid(xn), cn = cost(rn);
          if (cn < c) { x = xn; r = rn; c = cn; lam = Math.max(1e-9, lam / 4); ok = true; break; } lam *= 6;
        }
        if (!ok || c < 1e-10) break;
      }
      return x;
    };
    const softJ = (f, t) => { const J = {}; for (const k of PK) J[k] = soft(f[k](t), bf[k][0], bf[k][1], 6); return J; };
    const lo7 = PK.map((k) => bf[k][0] + 1), hi7 = PK.map((k) => bf[k][1] - 1);
    const cts = BK ? BK.cts : [], cjl = BK ? BK.cjl : [], hz = opts.bakeHz || 120;
    if (!BK) for (let i = 0; i <= Math.round((ts[n - 1] - ts[0]) * hz); i++) {
      const t = Math.min(ts[n - 1], ts[0] + i / hz), st = at(t); const D = trunkD(st.trunk); const pel = lowerPelvis(ch, D, st.trunk.pelvis, st.feet); const trk = fk(ch, D, pel, {});
      const shR = trk.pos[ch.N("R UpperArm")], shL = trk.pos[ch.N("L UpperArm")], Jr = softJ(rf, t), J0 = softJ(lf, t);
      const A = armFromAngles(ch, "r", D.chest, Jr), el = add(shR, qrot(A.upper, [0, -ch.L.r_upper, 0])), wr = add(el, qrot(qmul(A.upper, qaxis([1, 0, 0], -Jr.elbow)), [0, -ch.L.r_fore, 0]));
      const R = qmul(A.hand, grip.R.G), origin = add(wr, qrot(A.hand, grip.R.g)), n3 = qrot(R, [0, 0, 1]), d = qrot(R, [0, -1, 0]);
      const x0 = PK.map((k) => J0[k]);
      const resid = (x) => { const Jl = {}; PK.forEach((k, i) => (Jl[k] = x[i])); const r = [];
        const AL = armFromAngles(ch, "l", D.chest, Jl), elL = add(shL, qrot(AL.upper, [0, -ch.L.l_upper, 0])), wrL = add(elL, qrot(qmul(AL.upper, qaxis([1, 0, 0], -Jl.elbow)), [0, -ch.L.l_fore, 0]));
        const fist = add(wrL, qrot(AL.hand, grip.L.fistL)), v = sub(fist, origin), along = dot(v, d);
        sub(v, mul(d, along)).forEach((q) => r.push(q / 0.00002));
        const lo = rk.fist + grip.slide[0], hi = rk.fist + grip.slide[1]; r.push((along < lo ? along - lo : along > hi ? along - hi : 0) / 0.00002);
        const axL = qrot(AL.hand, qrot(grip.L.G, [0, -1, 0])); if (grip.loose) { const tl = Math.acos(Math.max(-1, Math.min(1, dot(axL, d)))) * DEG; r.push(Math.max(0, tl - grip.closureTilt) / 0.5); } else cross(axL, d).forEach((q) => r.push(q / 0.002));
        const nL = qrot(AL.hand, qrot(grip.L.G, [0, 0, 1])); const roll = Math.acos(Math.max(-1, Math.min(1, dot(nL, n3)))) * DEG; r.push(Math.max(0, roll - grip.rollFree) / 2);
        x.forEach((q, i) => r.push((q - x0[i]) / 30));
        return r; };
      const x = lmSolve(x0, resid, lo7, hi7, 80); const Jl = {}; PK.forEach((k, i) => (Jl[k] = x[i]));
      cts.push(t); cjl.push(Jl);
    }
    const lf2 = {}; for (const k of PK) lf2[k] = clampedSpline(cts, cjl.map((J) => J[k]));
    bakeOut = { ts, jr, jl, cts, cjl };
    const at0 = at;
    solve = (t) => { const st = at0(t); const Jr = softJ(rf, t), Jl = {}; for (const k of PK) Jl[k] = lf2[k](t); st.arms.r = Jr; st.arms.l = Jl; st.leftBaked = true; const P = poseFromState(ch, st, grip); P.arms = { r: Jr, l: Jl }; return P; };
  }
  // time warp
  const sm = tech.slowmo || { from: ph[1].name, to: ph[ph.length - 2].name, rate: 1 };
  const rate = opts.slowRate ?? sm.rate, ramp = Math.max(0.45, sm.ramp ?? 0.45);
  const tA = T[ph.findIndex((p) => p.name === sm.from)], tB = T[ph.findIndex((p) => p.name === sm.to)];
  const speed = (t) => 1 - (1 - rate) * smooth((t - (tA - ramp)) / ramp) * (1 - smooth((t - tB) / ramp));
  // ball anchored at the solved face at contact
  const R = sport.ball?.radius ?? 0.0335, g = -9.81, e = sport.ball?.restitution ?? 0.75;
  const cp = solve(tc).racket; const vin = tech.ball.in.vel, vout = tech.ball.out.vel;
  let n = cp.normal; if (dot(n, mul(vin, -1)) < 0) n = mul(n, -1);
  const C = add(cp.center, mul(n, R + 0.021));
  const integrate = (p0, v0, dur, dir) => { const pts = [[0, p0]]; let p = p0.slice(), v = v0.slice(); const dt = 1 / 480;
    for (let s = dt; s <= dur + 1e-9; s += dt) {
      if (dir > 0) { v = [v[0], v[1] + g * dt, v[2]]; p = add(p, mul(v, dt)); if (p[1] < R && v[1] < 0) { p[1] = 2 * R - p[1]; v = [v[0] * 0.85, -v[1] * e, v[2] * 0.85]; } }
      else { p = sub(p, mul(v, dt)); v = [v[0], v[1] - g * dt, v[2]]; if (p[1] < R && v[1] > 0) { p[1] = 2 * R - p[1]; v = [v[0] / 0.85, -v[1] / e, v[2] / 0.85]; } }
      pts.push([dir * s, p.slice()]); }
    return pts; };
  const ballIn = integrate(C, vin, tech.ball.in.dur ?? 1.0, -1).reverse(), ballOut = integrate(C, vout, tech.ball.out.dur ?? 0.8, 1);
  const tIn0 = tc + ballIn[0][0], tOut1 = tc + ballOut[ballOut.length - 1][0];
  const ballAt = (t) => { if (t < tIn0 || t > tOut1) return null; const arr = t <= tc ? ballIn : ballOut, rel = t - tc;
    const i = Math.min(arr.length - 2, Math.max(0, Math.floor((rel - arr[0][0]) * 480))); const [t0, p0] = arr[i], [t1, p1] = arr[i + 1];
    return add(p0, mul(sub(p1, p0), Math.min(1, Math.max(0, (rel - t0) / ((t1 - t0) || 1))))); };
  const tr0 = T[Math.max(0, ph.findIndex((p) => p.name === (tech.trail?.from || ph[1].name)))], tr1 = T[ph.findIndex((p) => p.name === (tech.trail?.to || ph[ph.length - 2].name))];
  const trail = []; for (let t = tr0; t <= tr1 + 1e-9; t += 1 / 240) trail.push([t, solve(t).racket.center]);
  return { id: tech.id, T, t0: T[0], t1: T[T.length - 1], tc, speed, solve, at: grip.L ? ((t) => { const r = solve(t), a = at(t); return { ...a, arms: r.arms || a.arms, twoHand: a.twoHand }; }) : at,   // v12: closed chain reports the SOLVED arms (v11 returned the key arms, so elbow/ER gates measured keys)
    ballAt, atKeys: at0ref, ballIn, ballOut, contact: C, tIn0, tOut1, trail, phases: ph, tA, tB, grip, keys, rk, bake: bakeOut, loco: LOCO };
}

// ------------------------------------------------------------------ micro-motion layer (v7m)
// Optional per technique (tech.micro). Works on the joint-space state, so every downstream constraint (grip, IK
// feet, CoM) still applies. Parts:
//   warp   overlapping action: each arm group samples its own spline through a monotone time warp that keeps the
//          window ends and contact fixed and moves that group's speed peak from tOld to tNew (proximal first,
//          distal last). groups: shoulder = az, el, rot; elbow = elbow; wrist = wflex, wdev, pron
//   layback  wrist extension bump (deg) that lags the forearm into the drop and releases into contact
//   sway   small breathing / balance sway in the ready holds (deg), zero at the loop ends so the loop stays seamless
const MICRO_GROUPS = { shoulder: ["az", "el", "rot"], elbow: ["elbow"], wrist: ["wflex", "wdev", "pron"] };
export function microWarp(ta, tOld, tNew, tc, tb, sg = 0.018) {
  if (!(ta < tOld && tOld < tc && ta < tNew && tNew < tc)) return (t) => t;
  const X = [ta, tNew, tc, tb], Y = [ta, tOld, tc, tb], n = 3, d = [], m = [1, 0, 0, 1];
  for (let i = 0; i < n; i++) d.push((Y[i + 1] - Y[i]) / (X[i + 1] - X[i]));
  for (let i = 1; i < n; i++) { const w1 = 2 * (X[i + 1] - X[i]) + (X[i] - X[i - 1]), w2 = (X[i + 1] - X[i]) + 2 * (X[i] - X[i - 1]); m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  for (let i = 0; i < n; i++) { const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const s3 = 3 / Math.sqrt(h); m[i] = s3 * a * d[i]; m[i + 1] = s3 * b * d[i]; } }   // Fritsch-Carlson: stays monotone
  const H = hermite(X, Y, m), raw = (t) => (t <= ta || t >= tb ? t : H(t));
  // C2: Gaussian-smooth the C1 warp (sigma 18 ms) so no acceleration step appears at the knots; stays monotone
  const dt = 1 / 960, ts = [], ws = [], KN = Math.ceil(3 * sg / dt);
  for (let t = ta - 0.08; t <= tb + 0.08 + 1e-9; t += dt) { let a = 0, z = 0; for (let k = -KN; k <= KN; k++) { const e = Math.exp(-0.5 * (k * dt / sg) ** 2); a += e * raw(t + k * dt); z += e; } ts.push(t); ws.push(a / z); }
  const Sm = clampedSpline(ts, ws), lo = ts[0], hi = ts[ts.length - 1];
  return (t) => (t <= lo || t >= hi ? t : Sm(t));
}
function microLayer(at, M, tc, t0, t1) {
  const ta = M.window?.[0] ?? tc - 0.4, tb = tc + (M.window?.[1] ?? 0.25);
  const W = {}; for (const g in MICRO_GROUPS) { const w = M.warp?.[g]; W[g] = w ? microWarp(ta, tc + w[0] / 1000, tc + w[1] / 1000, tc, tb, (M.sigma_ms ?? 18) / 1000) : null; }
  const bump = (t, c, wd) => { const u = (t - c) / wd; return Math.abs(u) >= 1 ? 0 : (0.5 * (1 + Math.cos(Math.PI * u))) ** 2; };
  return (t) => {
    const st = at(t);
    for (const g in MICRO_GROUPS) { if (!W[g]) continue; const tw = W[g](t); if (tw === t) continue;
      const src = at(tw).arms.r; for (const k of (M.groups?.[g] || MICRO_GROUPS[g])) st.arms.r[k] = src[k]; }
    if (M.layback) { const [deg, cms, wms] = M.layback; st.arms.r.wflex -= deg * bump(t, tc + cms / 1000, wms / 1000); }
    if (M.sway) { const [deg, hold] = M.sway, env = (t < t0 + hold ? Math.sin(Math.PI * (t - t0) / hold) ** 2 : 0) + (t > t1 - hold ? Math.sin(Math.PI * (t1 - t) / hold) ** 2 : 0);
      if (env > 0) { st.trunk.lean += deg * env * Math.sin(2 * Math.PI * (t - t0) / hold); st.trunk.chest_yaw += 0.6 * deg * env * Math.sin(4 * Math.PI * (t - t0) / hold);
        st.trunk.head_pitch += 0.5 * deg * env * Math.sin(2 * Math.PI * (t - t0) / hold + 1); } }
    return st;
  };
}
export function timeTable(comp, fps = 240, globalSpeed = 1, includeReal = false) {
  const rows = []; let t = comp.t0;
  while (t < comp.t1) { rows.push([t, comp.speed(t), "slow"]); t += comp.speed(t) * globalSpeed / fps; }
  rows.push([comp.t1, 1, "slow"]);
  if (includeReal) for (let t2 = comp.t0; t2 <= comp.t1; t2 += globalSpeed / fps) rows.push([t2, 1, "real"]);
  return rows;
}
// anatomical readout for checks / UI
export function jointReport(ch, res) {
  const out = {};
  const Dch = res.D.chest;
  for (const s of ["r", "l"]) {
    const J = anglesFromSegments(ch, s, Dch, res.D[`${s}_upper`], res.arms[s].elbow, res.D[`${s}_hand`]);
    const sm = shoulderMeasures(s, J.shoulder);
    out[s] = { elbow: res.arms[s].elbow, pron: J.pron, wflex: J.wflex, wdev: J.wdev, shoulderRot: sm.rot, shoulderBack: sm.back, shoulderCross: sm.cross };
  }
  return out;
}

// ------------------------------------------------------------------ layer loader (browser: fetch; node: fs) -------------
// loadLayer(readJson, bodyPath) -> { ch, layer } ; readJson(path) returns parsed JSON (paths relative to the web root)
export async function loadLayer(readJson, bodyPath = "body/rocketbox_female.json", implIds = ["padel_racket", "tennis_racket"],
  gripIds = ["continental", "eastern_fh", "semi_western_fh", "eastern_bh", "two_handed_bh", "top_hand_fh"]) {
  const body = await readJson(bodyPath);
  const skel = await readJson(body.skeleton.replace(/^\.\.\//, ""));
  const ch = createCharacter(skel, body);
  const layer = { implements: {}, grips: {} };
  for (const id of implIds) layer.implements[id] = await readJson(`implements/${id}.json`);
  for (const id of gripIds) layer.grips[id] = await readJson(`grips/${id}.json`);
  return { ch, layer };
}
