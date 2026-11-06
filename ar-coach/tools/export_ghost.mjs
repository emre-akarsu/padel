// Strike Player specs -> coach techniques.json (2D side view, COCO-17, torso units, hip-mid origin, y down, facing +x)
import fs from 'fs'; import { pathToFileURL } from 'url';
const root = process.argv[2], S = await import(pathToFileURL(root + '/strikes/solver.js'));
const skel = JSON.parse(fs.readFileSync(root + '/strikes/assets/skeleton.json'));
const sport = JSON.parse(fs.readFileSync(root + '/strikes/specs/padel.json'));
const ch = S.createCharacter(skel);
const ID = { forehand_drive: 'forehand', backhand_drive: 'backhand', forehand_volley: 'volley_fh', backhand_volley: 'volley_bh', globo: 'lob' };
const PH = { turn: 'preparation', split_step: 'preparation', loading: 'backswing', racket_drop: 'forward_swing', finish: 'follow_through', ready_again: 'recovery' };
const B = 'Bip01 ', N = 72;
const shots = {};
for (const tech of sport.techniques) {
  const c = S.compileTechnique(ch, tech, sport, { slowRate: 1 });
  const dur = c.t1 - c.t0, frames = [];
  let torso0 = null;
  for (let i = 0; i < N; i++) {
    const p = c.solve(c.t0 + dur * i / (N - 1)).pos, g = n => p[B + n];
    const head = g('Head'), ear = s => [head[0] + s * 0.075, head[1] + 0.06, head[2] - 0.02];
    const J = [g('MNose'), g('LEye'), g('REye'), ear(1), ear(-1), g('L UpperArm'), g('R UpperArm'), g('L Forearm'), g('R Forearm'), g('L Hand'), g('R Hand'), g('L Thigh'), g('R Thigh'), g('L Calf'), g('R Calf'), g('L Foot'), g('R Foot')];
    const P = J.map(q => [q[2], -q[1]]); // side camera at -X: image x = +Z (toward the net), image y = -Y
    const hip = [(P[11][0] + P[12][0]) / 2, (P[11][1] + P[12][1]) / 2], sh = [(P[5][0] + P[6][0]) / 2, (P[5][1] + P[6][1]) / 2];
    if (torso0 === null) torso0 = Math.hypot(sh[0] - hip[0], sh[1] - hip[1]);
    frames.push(P.map(q => [+((q[0] - hip[0]) / torso0).toFixed(3), +((q[1] - hip[1]) / torso0).toFixed(3)]));
  }
  const id = ID[tech.id] || tech.id;
  shots[id] = { name: tech.name, family: tech.family, durationS: +dur.toFixed(3), contactU: +((c.tc - c.t0) / dur).toFixed(4), strikeId: tech.id,
    keys: tech.phases.map(p => ({ u: +((p.t - c.t0) / dur).toFixed(4), phase: PH[p.name] || p.name, label: p.label || p.name, cue: p.cue })), frames };
}
const out = { version: 2, source: 'Strike Player v5 (padel/strikes, specs/padel.json) via solver.js, sampled ' + N + ' frames per stroke, orthographic side view from the player\'s right', units: 'torso units (ready-frame shoulder-to-hip), hip-mid origin, y down, facing +x, right-handed', shots };
fs.writeFileSync(root + '/coach/techniques.json', JSON.stringify(out));
console.log(Object.entries(shots).map(([k, s]) => `${k} ${s.durationS}s c=${s.contactU}`).join('\n'), fs.statSync(root + '/coach/techniques.json').size);
