/* AR coach -> feedback widget. Snapshot of shot, engine, mode, last stroke (metrics, checks, phases) and replay time.
 * The camera picture is opt-in (box unticked by default); no video is ever sent. */
(function () {
  'use strict';
  const FB = window.PadelFeedback; if (!FB || !window.PadelApp) return;
  const $ = s => document.querySelector(s), r3 = x => x == null ? null : Math.round(x * 1000) / 1000;
  const visible = id => { const e = document.getElementById(id); return e && !e.hidden; };
  let padelSpec = null; fetch('../strikes/specs/padel.json').then(r => r.json()).then(j => padelSpec = j).catch(() => { });
  let SWV = 'ar-coach'; fetch('sw.js').then(r => r.text()).then(t => { const m = t.match(/const V = '([^']+)'/); if (m) SWV = m[1]; }).catch(() => { });
  const stageAt = (s, t) => (s && s.phases || []).find(p => t >= p.tStart && t <= p.tEnd) || null;
  FB.mount({
    app: 'ar-coach', version: 'ar-coach', build: 'app.js', shotDefault: false,
    screenshot() {
      if (visible('replay')) return FB.grab($('#rp'));
      if (visible('live')) { const v = $('#cam'); return v && v.videoWidth ? FB.grab([v, $('#ov')]) : null; }
      return null;
    },
    async context(o) {
      const { S, L, DR, RP, REL, engine, shotName } = window.PadelApp.snap();
      const sess = o && (o.kind === 'session' || o.kind === 'drill') ? lastSession() : null;
      const page = visible('live') ? (visible('replay') ? 'replay' : 'live') : ([...document.querySelectorAll('main.page')].find(m => !m.hidden) || {}).id;
      const s = page === 'replay' && RP ? RP.s : L.lastStroke || null;
      const t = page === 'replay' && RP ? RP.tNow : null, ph = t != null ? stageAt(s, t) : null;
      const tech = padelSpec && padelSpec.techniques.find(x => x.id === S.shot);
      const ghost = window.PadelGhost && PadelGhost.specs && PadelGhost.specs.shots[S.shot];
      return {
        app_version: 'release ' + (REL && REL.version) + ' · ' + SWV,
        subject: { sport: 'padel', stroke_id: S.shot, stroke_name: shotName(S.shot), hand: S.hand, player_height_m: +S.height,
          spec_file: 'strikes/specs/padel.json', spec_hash: tech ? await FB.hash(tech) : null, ghost_hash: ghost ? await FB.hash(ghost) : null,
          detected_shot: s && s.shot ? s.shot : null },
        moment: { page, mode: L.mode || null, use: S.use, view: S.view, reps: (L.strokes || []).length,
          t_s: t != null && s ? r3(t - s.tStart) : null, t_contact_s: s ? r3(s.tContact - s.tStart) : null,
          stage: ph ? ph.id : (page === 'live' ? ($('#hPhase') || {}).textContent : null), stage_label: ph ? ph.id : null,
          stroke: s ? { id: s.id, tStart: r3(s.tStart), tEnd: r3(s.tEnd), tContact: r3(s.tContact), metrics: s.metrics,
            checks: (s.checks || []).map(c => ({ id: c.id, pass: c.pass, value: c.value ?? null })), phases: s.phases, player_answer: s.playerFeedback || null } : null,
          shown_cue: ($('#cue') || {}).textContent || null },
        session: sess ? { id: sess.id, mode: sess.mode, shot: sess.shot, engine: sess.engine, minutes: Math.round((sess.end - sess.start) / 6000) / 10, strokes: sess.strokes.length,
          mastery: sess.mastery ? { level: sess.mastery.level, levelName: sess.mastery.levelName, pct: sess.mastery.pct, measured: sess.mastery.measured } : null,
          strokes_detail: sess.strokes.slice(-30).map(x => ({ tContact: r3(x.tContact), metrics: x.metrics, checks: (x.checks || []).map(c => ({ id: c.id, pass: c.pass, value: c.value ?? null })), player_answer: x.playerFeedback })) } : null,
        extra: { engine: engine ? engine.info.name + ' ' + engine.info.version : S.engine, drill: DR ? { set: DR.set.id, step: DR.step.name, index: DR.stepIndex } : null,
          voice: S.voice, feedback_mode: S.fb, facing: L.facing || null },
      };
    },
  });
  // the floating button would sit over the camera view: use the bar buttons there instead
  const fixed = FB.button, sync = () => { fixed.hidden = visible('live'); };
  new MutationObserver(sync).observe($('#live'), { attributes: true, attributeFilter: ['hidden'] }); sync();
  ['#fbLive', '#fbReplay'].forEach(id => $(id) && FB.attach($(id)));

  // after every session / drill: a one-tap card at the top of the summary (once per session)
  function lastSession() { try { return (JSON.parse(localStorage.getItem('padel.sessions')) || [])[0] || null; } catch { return null; } }
  function sessionCard() {
    const sum = $('#summary'); if (!sum || sum.hidden) return;
    const x = lastSession(); if (!x || sum.querySelector('.pfb-card[data-sid="' + x.id + '"]')) return;
    sum.querySelectorAll('.pfb-card').forEach(n => n.remove());
    let done = null; try { done = localStorage.getItem('padel.feedback.card.session-' + x.id); } catch { }
    if (done || Date.now() - x.end > 6 * 3600e3) return;
    const { DR, shotName } = window.PadelApp.snap(), drill = x.mode === 'drill' || !!DR;
    const n = FB.card(sum, { kind: drill ? 'drill' : 'session', key: 'session-' + x.id,
      question: `How was this ${drill ? 'drill' : 'session'}? (${shotName(x.shot)}, ${x.strokes.length} stroke${x.strokes.length === 1 ? '' : 's'})`,
      extra: { session_line: `${x.mode} · ${shotName(x.shot)} · ${x.strokes.length} strokes · ${x.engine}` } });
    if (n) { n.dataset.sid = x.id; const bar = sum.querySelector('.bar'); bar && bar.after(n); }
  }
  new MutationObserver(sessionCard).observe($('#summary'), { attributes: true, attributeFilter: ['hidden'] }); sessionCard();

  // live: when a drill step completes, offer feedback without stopping the drill
  const cue = $('#cue'); let lastCue = '';
  if (cue) new MutationObserver(() => { const t = cue.textContent; if (t !== lastCue && /drill step done/i.test(t)) FB.nudge('Drill step done. Anything off?', { kind: 'drill', title: 'How was this drill step?' }); lastCue = t; })
    .observe(cue, { childList: true, characterData: true, subtree: true });

  // errors the app shows as status text (camera denied, model failed, upload failed) get the same Report toast
  const BAD = /error|denied|fail|not allowed|cannot|can't|could not|unsupported|not supported|blocked/i;
  ['#setupStatus', '#upStatus'].forEach(id => { const n = $(id); if (!n) return; let last = '';
    new MutationObserver(() => { const t = n.textContent.trim(); if (t && t !== last && BAD.test(t)) FB.reportError(t, { where: id.slice(1) }); last = t; }).observe(n, { childList: true, characterData: true, subtree: true }); });
})();
