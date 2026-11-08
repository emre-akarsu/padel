// Kick-serve comparison pages (kick_v7: v6/v7/v8/v8.1, kick_v8: v7/v8) -> feedback widget.
// Panel labels and cues are read from the page in DOM order, which matches kick.json techniques; the user picks the panel.
const FB = window.PadelFeedback;
const until = (f) => new Promise((ok) => { const k = () => (f() ? ok() : setTimeout(k, 150)); k(); });
await until(() => window.__cmp?.ready);
const C = window.__cmp, $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)], r2 = (x) => Math.round(x * 1000) / 1000;
const spec = await (await fetch("kick.json")).json();
const page = (location.pathname.match(/\/(kick_v[\w.]+)\/?$/) || [])[1] || "kick";
const labs = $$("#stage .lab").map((e) => e.textContent.trim());
const V = await Promise.all(spec.techniques.map(async (t, i) => ({ id: t.id, name: t.name, label: labs[i] || t.name, spec_hash: await FB.hash(t), t })));
const opts = [...V.map((v) => v.label), "All of them"];
let wasPlaying = true;
FB.mount({
  app: "kick-compare", version: page, build: [...document.scripts].map((s) => s.src).find((s) => /compare\.js/.test(s))?.replace(/^.*\//, "") || null, shotDefault: true,
  fields: [{ id: "panel", label: "Which one is wrong?", options: opts, default: V.length - 1 }],
  onOpen() { wasPlaying = C.st.playing; C.st.playing = false; }, onClose() { C.st.playing = wasPlaying; },
  screenshot: () => { C.draw(); return FB.grab($("#stage canvas")); },
  async context() {
    const cues = $$("#stage .cue").map((e) => e.textContent);
    return {
      subject: { sport: spec.sport || "tennis", family: "serve", spec_file: `strikes/${page}/kick.json`, panels: V.map(({ t, ...v }) => v) },
      moment: { t_s: r2(C.st.tau), t_end_s: r2(C.tEnd), clock: $("#clock")?.textContent || null, cues, slow_rate: C.st.rate, trail: C.st.fx.trail, com: C.st.fx.com },
    };
  },
  finalize(rec) { // point subject/stage at the chosen panel
    const i = opts.indexOf(rec.extra.panel), v = V[i] || V[V.length - 1], cue = rec.moment.cues[V.indexOf(v)] || "";
    Object.assign(rec.subject, { stroke_id: v.id, stroke_name: v.name, variant: v.label, spec_hash: v.spec_hash, grip: v.t.grip || null, hand: v.t.handed || "R", all_panels: i >= V.length });
    rec.app.version = `${page}:${v.label}`; rec.moment.stage_label = cue.split(":")[0].trim(); rec.moment.cue = cue;
  },
});
