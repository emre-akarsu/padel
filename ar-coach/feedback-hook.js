/* AR coach -> feedback widget. Snapshot of shot, engine, mode, last stroke (metrics, checks, phases) and replay time.
 * The camera picture is opt-in (box unticked by default); no video is ever sent. */
(function () {
  'use strict';
  const FB = window.PadelFeedback; if (!FB || !window.PadelApp) return;
  const $ = s => document.querySelector(s), r3 = x => x == null ? null : Math.round(x * 1000) / 1000;
  const visible = id => { const e = document.getElementById(id); return e && !e.hidden; };
  let padelSpec = null; fetch('../strikes/specs/padel.json').then(r => r.json()).then(j => padelSpec = j).catch(() => { });
  const stageAt = (s, t) => (s && s.phases || []).find(p => t >= p.tStart && t <= p.tEnd) || null;
  FB.mount({
    app: 'ar-coach', version: 'sw ' + (window.PADEL_SW_VERSION || 'ar-coach-v14'), build: 'app.js', shotDefault: false,
    screenshot() {
      if (visible('replay')) return FB.grab($('#rp'));
      if (visible('live')) { const v = $('#cam'); return v && v.videoWidth ? FB.grab([v, $('#ov')]) : null; }
      return null;
    },
    async context() {
      const { S, L, DR, RP, REL, engine, shotName } = window.PadelApp.snap();
      const page = visible('live') ? (visible('replay') ? 'replay' : 'live') : ([...document.querySelectorAll('main.page')].find(m => !m.hidden) || {}).id;
      const s = page === 'replay' && RP ? RP.s : L.lastStroke || null;
      const t = page === 'replay' && RP ? RP.tNow : null, ph = t != null ? stageAt(s, t) : null;
      const tech = padelSpec && padelSpec.techniques.find(x => x.id === S.shot);
      const ghost = window.PadelGhost && PadelGhost.specs && PadelGhost.specs.shots[S.shot];
      return {
        app_version: 'release ' + (REL && REL.version) + ' · ' + (window.PADEL_SW_VERSION || 'ar-coach-v14'),
        subject: { sport: 'padel', stroke_id: S.shot, stroke_name: shotName(S.shot), hand: S.hand, player_height_m: +S.height,
          spec_file: 'strikes/specs/padel.json', spec_hash: tech ? await FB.hash(tech) : null, ghost_hash: ghost ? await FB.hash(ghost) : null,
          detected_shot: s && s.shot ? s.shot : null },
        moment: { page, mode: L.mode || null, use: S.use, view: S.view, reps: (L.strokes || []).length,
          t_s: t != null && s ? r3(t - s.tStart) : null, t_contact_s: s ? r3(s.tContact - s.tStart) : null,
          stage: ph ? ph.id : (page === 'live' ? ($('#hPhase') || {}).textContent : null), stage_label: ph ? ph.id : null,
          stroke: s ? { id: s.id, tStart: r3(s.tStart), tEnd: r3(s.tEnd), tContact: r3(s.tContact), metrics: s.metrics,
            checks: (s.checks || []).map(c => ({ id: c.id, pass: c.pass, value: c.value ?? null })), phases: s.phases, player_answer: s.playerFeedback || null } : null,
          shown_cue: ($('#cue') || {}).textContent || null },
        extra: { engine: engine ? engine.info.name + ' ' + engine.info.version : S.engine, drill: DR ? { set: DR.set.id, step: DR.step.name, index: DR.stepIndex } : null,
          voice: S.voice, feedback_mode: S.fb, facing: L.facing || null },
      };
    },
  });
  // the floating button would sit over the camera view: use the bar buttons there instead
  const fixed = FB.button, sync = () => { fixed.hidden = visible('live'); };
  new MutationObserver(sync).observe($('#live'), { attributes: true, attributeFilter: ['hidden'] }); sync();
  ['#fbLive', '#fbReplay'].forEach(id => $(id) && FB.attach($(id)));
})();
