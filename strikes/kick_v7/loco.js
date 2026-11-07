// v7 root motion: the centre-of-mass (CoM) path drives the body; feet follow a per-foot contact script.
// Ground CoM segments are quintic Hermite curves (position, velocity, acceleration matched at every key, so C2);
// flight segments are exact ballistic parabolas (only gravity). At take-off and touch-down the ground segments
// carry a = -g, i.e. the legs unload smoothly to zero force, which keeps the whole path C2.
// Feet: pinned intervals are constant (world-pinned); swing intervals are minimum-jerk (quintic) blends with a
// lifted arc. "heel":"auto" lets the heel rise just enough that the leg never over-stretches (plantarflexion push).
// No dependencies; browser + Node.
export const G = 9.81;
// Dempster/Winter segment mass fractions and CoM positions (fraction from the proximal joint)
export const MASS = [
  ["head", 0.081], ["trunk", 0.497],
  ["r_upper", 0.028], ["l_upper", 0.028], ["r_fore", 0.016], ["l_fore", 0.016], ["r_hand", 0.006], ["l_hand", 0.006],
  ["r_thigh", 0.100], ["l_thigh", 0.100], ["r_shank", 0.0465], ["l_shank", 0.0465], ["r_foot", 0.0145], ["l_foot", 0.0145]];
const SEG = {
  head: ["Neck", "Head", 2.0], trunk: ["Pelvis", "Neck", 0.5],
  r_upper: ["R UpperArm", "R Forearm", 0.436], l_upper: ["L UpperArm", "L Forearm", 0.436],
  r_fore: ["R Forearm", "R Hand", 0.43], l_fore: ["L Forearm", "L Hand", 0.43],
  r_hand: ["R Hand", "R Finger2", 0.5], l_hand: ["L Hand", "L Finger2", 0.5],
  r_thigh: ["R Thigh", "R Calf", 0.433], l_thigh: ["L Thigh", "L Calf", 0.433],
  r_shank: ["R Calf", "R Foot", 0.433], l_shank: ["L Calf", "L Foot", 0.433],
  r_foot: ["R Foot", "R Toe0", 0.5], l_foot: ["L Foot", "L Toe0", 0.5] };
export function comOf(ch, pos, racket, implMassFrac = 0.005) {
  let c = [0, 0, 0], m = 0;
  for (const [k, f] of MASS) { const [a, b, u] = SEG[k]; const A = pos[ch.N(a)], B = pos[ch.N(b)];
    for (let i = 0; i < 3; i++) c[i] += f * (A[i] + (B[i] - A[i]) * u); m += f; }
  if (racket) { for (let i = 0; i < 3; i++) c[i] += implMassFrac * racket.center[i]; m += implMassFrac; }
  return c.map((v) => v / m);
}
// quintic Hermite on [0,1] with p, v, a at both ends (v, a already scaled by the segment duration)
function quintic(p0, v0, a0, p1, v1, a1, u) {
  const u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
  const h0 = 1 - 10 * u3 + 15 * u4 - 6 * u5, h1 = u - 6 * u3 + 8 * u4 - 3 * u5, h2 = 0.5 * u2 - 1.5 * u3 + 1.5 * u4 - 0.5 * u5;
  const h3 = 0.5 * u3 - u4 + 0.5 * u5, h4 = -4 * u3 + 7 * u4 - 3 * u5, h5 = 10 * u3 - 15 * u4 + 6 * u5;
  return h0 * p0 + h1 * v0 + h2 * a0 + h3 * a1 + h4 * v1 + h5 * p1;
}
const mj = (u) => u * u * u * (10 - 15 * u + 6 * u * u);          // minimum-jerk 0..1
const bump = (u) => 64 * u * u * u * (1 - u) * (1 - u) * (1 - u);   // 0 at ends with zero vel/acc, 1 at mid
// Build the CoM path from loc.com: [{t, p, v?, a?}, {flight:{rise, land_at:[x,z]}}, {t, p, v?, a?}, ...]
// A flight entry sits between the take-off key (before it) and the touch-down key (after it, whose t and p are derived).
export function makeComPath(loc) {
  const K = []; const src = loc.com;
  for (let i = 0; i < src.length; i++) {
    const e = src[i];
    if (e.flight) {
      const k0 = K[K.length - 1]; const h = e.flight.rise, vz = Math.sqrt(2 * G * h), drop = e.flight.land_drop || 0;
      const T = (vz + Math.sqrt(vz * vz + 2 * G * drop)) / G;   // touch-down lower than take-off by land_drop (legs flexed)
      const p0 = k0.p, la = e.flight.land_at;            // land_at = CoM ground projection at touch-down
      const vh = [(la[0] - p0[0]) / T, (la[1] - p0[2]) / T];
      k0.v = [vh[0], vz, vh[1]]; k0.a = [0, -G, 0];
      const fl = { flight: true, t0: k0.t, T, p0: p0.slice(), v0: k0.v.slice() };
      K.push(fl);
      const t1 = k0.t + T, p1 = [la[0], p0[1] - drop, la[1]];
      K.push({ t: t1, p: p1, v: [vh[0], vz - G * T, vh[1]], a: [0, -G, 0], land: true });
      fl.t1 = t1; continue;
    }
    if (K.length && K[K.length - 1].land && e.t === undefined) continue;
    K.push({ t: e.t, p: e.p.slice(), v: e.v ? e.v.slice() : null, a: e.a ? e.a.slice() : [0, 0, 0] });
  }
  // missing velocities: Catmull-Rom style from neighbours (zero at the ends)
  const keys = K.filter((k) => !k.flight);
  for (let i = 0; i < keys.length; i++) if (!keys[i].v) {
    const a = keys[i - 1], b = keys[i + 1];
    keys[i].v = a && b ? [0, 1, 2].map((c) => (b.p[c] - a.p[c]) / (b.t - a.t) * 0.5) : [0, 0, 0];
  }
  const flights = K.filter((k) => k.flight);
  const at = (t) => {
    for (const f of flights) if (t >= f.t0 && t <= f.t1) { const s = t - f.t0; return [f.p0[0] + f.v0[0] * s, f.p0[1] + f.v0[1] * s - 0.5 * G * s * s, f.p0[2] + f.v0[2] * s]; }
    if (t <= keys[0].t) return keys[0].p.slice();
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].p.slice();
    let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1], d = b.t - a.t, u = (t - a.t) / d;
    return [0, 1, 2].map((c) => quintic(a.p[c], a.v[c] * d, a.a[c] * d * d, b.p[c], b.v[c] * d, b.a[c] * d * d, u));
  };
  return { at, keys, flights };
}
// Feet: loc.feet[s] = [{t, foot:[x,z], yaw, lift?, arc?, heel?:"auto", state}]; state of an interval = its first key
export function makeFeet(loc) {
  const F = {};
  for (const s of ["r", "l"]) {
    const ks = loc.feet[s];
    F[s] = (t) => {
      if (t <= ks[0].t) return { ...ks[0], state: ks[0].state || "PLANTED" };
      if (t >= ks[ks.length - 1].t) return { ...ks[ks.length - 1], state: ks[ks.length - 1].state || "PLANTED" };
      let i = 0; while (i < ks.length - 2 && t > ks[i + 1].t) i++;
      const a = ks[i], b = ks[i + 1], u = (t - a.t) / (b.t - a.t), w = mj(u);
      const same = a.foot[0] === b.foot[0] && a.foot[1] === b.foot[1] && (a.yaw ?? 0) === (b.yaw ?? 0) && (a.lift || 0) === (b.lift || 0);
      if (same) return { foot: a.foot.slice(), yaw: a.yaw ?? 0, lift: a.lift || 0, heel: a.heel, state: a.state || "PLANTED" };
      return { foot: [a.foot[0] + (b.foot[0] - a.foot[0]) * w, a.foot[1] + (b.foot[1] - a.foot[1]) * w], yaw: (a.yaw ?? 0) + ((b.yaw ?? 0) - (a.yaw ?? 0)) * w,
        lift: (a.lift || 0) + ((b.lift || 0) - (a.lift || 0)) * w + (a.arc || 0) * bump(u), heel: a.heel && b.heel ? a.heel : null, state: a.state || "SWING" };
    };
  }
  return F;
}
export function makeLoco(tech) {
  const loc = tech.locomotion; if (!loc) return null;
  const com = makeComPath(loc), feet = makeFeet(loc);
  return { com, feet, apply: (t, st) => { st.com = com.at(t); st.feet = { r: feet.r(t), l: feet.l(t) }; return st; } };
}
