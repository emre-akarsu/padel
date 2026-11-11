const defs = {
  elbow_r:'deg', elbow_l:'deg', knee_r:'deg', knee_l:'deg', knee_max:'deg', lean:'deg',
  hand_y:'m', hand_sep:'m', hand_vs_shoulder_m:'m', elbow_vs_shoulder_m:'m', hand_rise_m:'m',
  knee_flex_load_deg:'deg', trunk_arch_deg:'deg', pelvis_drop_frac_leg:'fraction', com_rise_m:'m', gaze:'deg',
  phases_after_finish:'count', travel_m:'m', ms:'deg', flight_s:'s', landing_inside_m:'m',
  contact_height_x_body:'x body height', contact_airborne:'bool', land_before_finish_ms:'ms'
};
export const REGISTRY = Object.fromEntries(Object.entries(defs).map(([name, unit]) => [name, {name, unit}]));

// Match U02's dependency-free fallback: odd extension and steady-state initial conditions.
function smooth(x, fps) {
  const w = Math.tan(Math.PI * Math.min(3, .49 * fps) / fps);
  const a0 = 1 + Math.SQRT2*w + w*w;
  const b = [w*w/a0, 2*w*w/a0, w*w/a0];
  const a = [1, 2*(w*w-1)/a0, (1-Math.SQRT2*w+w*w)/a0];
  function filter(v) {
    let x1=v[0], x2=v[0], y1=v[0], y2=v[0];
    return v.map(x => { const y=b[0]*x+b[1]*x1+b[2]*x2-a[1]*y1-a[2]*y2; x2=x1; x1=x; y2=y1; y1=y; return y; });
  }
  const out=x.slice();
  for (let start=0; start<x.length;) {
    if (!Number.isFinite(x[start])) { start++; continue; }
    let end=start+1; while (end<x.length && Number.isFinite(x[end])) end++;
    if (end-start>9) {
      const y=x.slice(start,end), pad=6;
      const left=y.slice(1,pad+1).reverse().map(v=>2*y[0]-v);
      const right=y.slice(-pad-1,-1).reverse().map(v=>2*y[y.length-1]-v);
      const z=filter(filter(left.concat(y,right)).reverse()).reverse().slice(pad,-pad);
      for (let i=0;i<z.length;i++) out[start+i]=z[i];
    }
    start=end;
  }
  return out;
}
export function compute(kp, T, K, layout, fps, names=null) {
  if (!Number.isInteger(T) || T<0 || !Number.isInteger(K) || K<17 || kp.length!==T*K*2) throw new Error('expected [T,K,2] with at least 17 joints');
  if (layout!=='coco17' && layout!=='halpe26') throw new Error('unknown keypoint layout');
  if (layout==='halpe26' && K<26) throw new Error('halpe26 requires at least 26 joints');
  if (!Number.isFinite(fps) || fps<=0) throw new Error('fps must be positive');
  const selected=names==null ? Object.keys(REGISTRY) : Array.from(names);
  for (const n of selected) if (!Object.hasOwn(REGISTRY,n)) throw new Error('unknown metric: '+n);
  const p=Array.from({length:T},()=>Array.from({length:K},()=>[NaN,NaN]));
  for (let j=0;j<K;j++) for (let d=0;d<2;d++) {
    const x=smooth(Array.from({length:T},(_,t)=>Number.isFinite(kp[(t*K+j)*2+d]) ? kp[(t*K+j)*2+d] : NaN),fps);
    for (let t=0;t<T;t++) p[t][j][d]=x[t];
  }
  const cache={};
  function get(n) {
    if (cache[n]) return cache[n];
    const v=Array(T).fill(NaN), flex={elbow_l:[5,7,9],elbow_r:[6,8,10],knee_l:[11,13,15],knee_r:[12,14,16]};
    if (n==='knee_flex_load_deg') {
      const xs=get('knee_max').filter(Number.isFinite); if (xs.length) v.fill(Math.max(...xs));
    } else for (let t=0;t<T;t++) {
      const q=p[t], mid=(a,b,d)=>(q[a][d]+q[b][d])/2;
      const sx=mid(5,6,0), sy=mid(5,6,1), px=mid(11,12,0), py=mid(11,12,1);
      const torso=Math.hypot(sx-px,sy-py), scale=torso>0?torso:NaN;
      if (flex[n]) {
        const [a,b,c]=flex[n], ux=q[a][0]-q[b][0], uy=q[a][1]-q[b][1], vx=q[c][0]-q[b][0], vy=q[c][1]-q[b][1];
        const dot=(ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy));
        v[t]=180-Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;
      } else if (n==='knee_max') v[t]=Math.max(get('knee_l')[t],get('knee_r')[t]);
      else if (n==='lean') v[t]=Math.hypot(sx-px,sy-py)>0 ? Math.atan2(sx-px,py-sy)*180/Math.PI : NaN;
      else if (n==='hand_y') v[t]=(py-q[10][1])/scale;
      else if (n==='hand_sep') v[t]=Math.hypot(q[10][0]-q[9][0],q[10][1]-q[9][1])/scale;
      else if (n==='hand_vs_shoulder_m') v[t]=(q[6][1]-q[10][1])/scale;
      else if (n==='elbow_vs_shoulder_m') v[t]=(q[6][1]-q[8][1])/scale;
      else if (n==='hand_rise_m') v[t]=get('hand_y')[t]-get('hand_y')[0];
      else if (n==='com_rise_m') v[t]=(mid0(11,12,1)-py)/scale;
      else if (n==='pelvis_drop_frac_leg') {
        const legs=(Math.hypot(q[11][0]-q[15][0],q[11][1]-q[15][1])+Math.hypot(q[12][0]-q[16][0],q[12][1]-q[16][1]))/2;
        v[t]=(py-mid0(11,12,1))/(legs>0?legs:NaN);
      } else if (n==='gaze') {
        const x=q[0][0]-mid(1,2,0), y=q[0][1]-mid(1,2,1);
        v[t]=Math.hypot(x,y)>0 ? Math.atan2(x,-y)*180/Math.PI : NaN;
      }
    }
    function mid0(a,b,d) { return (p[0][a][d]+p[0][b][d])/2; }
    cache[n]=v; return v;
  }
  return Object.fromEntries(selected.map(n=>[n,Float32Array.from(get(n))]));
}

