// Strike Player -> feedback widget: snapshots sport, stroke, spec hash, stage, time, frame and camera when "Feedback" is pressed.
// Used by strikes/index.html (current engine) and strikes/v5/index.html (older engine); both expose window.__strike.
const FB = window.PadelFeedback;
const until = (f) => new Promise((ok) => { const k = () => (f() ? ok() : setTimeout(k, 150)); k(); });
await until(() => window.__strike?.ready && window.__strike.state.comp);
const S = window.__strike, r2 = (x) => Math.round(x * 1000) / 1000;
const eng = [...document.scripts].map((s) => s.src).find((s) => /engine\.js/.test(s)) || "";
const build = eng.replace(/^.*\//, "");
const ver = (location.pathname.match(/\/(v\d+[\w.]*)\/?$/) || [])[1] || "engine-v" + (new URL(eng, location.href).searchParams.get("v") || "?");
let wasPlaying = true;
FB.mount({
  app: "strike-player", version: ver, build, shotDefault: true,
  onOpen() { wasPlaying = S.state.playing; S.state.playing = false; },
  onClose() { S.state.playing = wasPlaying; },
  screenshot: () => { S.renderer.render(S.scene, S.camera); return FB.grab(S.renderer.domElement); },
  async context() {
    const st = S.state, c = st.comp, t = st.tech, n = st.table.length, i = Math.min(n - 1, Math.max(0, st.idx | 0));
    const [tt, spd, part] = st.table[i];
    const ph = t.phases; let k = 0;
    for (let j = 0; j < ph.length; j++) { const mid = j ? (ph[j - 1].t + ph[j].t) / 2 : -1e9; if (tt >= mid) k = j; }
    const sportId = S.selSport.value;
    return {
      subject: { sport: sportId, stroke_id: t.id, stroke_name: t.name, family: t.family, grip: t.grip || null, hand: st.hand,
        spec_file: `strikes/specs/${sportId}.json`, spec_hash: await FB.hash(t), spec_version: st.sport.version || null },
      moment: { t_s: r2(tt - c.t0), t_spec: r2(tt), t_contact_s: c.tc != null ? r2(c.tc - c.t0) : null, frame: i, frames: n,
        stage_index: k, stage: ph[k].name, stage_label: ph[k].label || ph[k].name, cue: ph[k].cue || null,
        part, speed_shown: r2(spd), playback_speed: st.speed, slow: st.slow, contact_offset_m: st.contact, replay: st.replay, trail: st.trail,
        camera: { pos: S.camera.position.toArray().map(r2), target: S.controls.target.toArray().map(r2) } },
    };
  },
});
