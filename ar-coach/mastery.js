/* Live drill mastery: 5 levels per shot from numbers the app already measures (tempo, and contact height as beta).
 * No fault claims: a rep is "in band" when its tempo is inside the target band. Contact height is not yet validated
 * on phones, so it only counts half as much as tempo in the score. Levels are never lost inside a session.
 * Pure logic, no DOM: window.PadelMastery (browser) or module.exports (node tests). */
(function (root) {
  'use strict';
  const LEVELS = [
    { n: 1, name: 'Started', rule: '5 reps' },
    { n: 2, name: 'Grooving', rule: '50% in band (10+ reps)', pct: .5, minReps: 10 },
    { n: 3, name: 'Consistent', rule: '70% in band over 20 reps', pct: .7, minReps: 20 },
    { n: 4, name: 'Locked in', rule: '85% in band over 20 reps, steady tempo', pct: .85, minReps: 20, maxSd: .12 },
    { n: 5, name: 'Mastered', rule: 'Locked in again on another day' }];
  const WINDOW = 20, STREAKS = [3, 5, 10, 15, 20];
  const inB = (v, b) => v != null && b && v >= b[0] && v <= b[1];
  const day = t => new Date(t).toISOString().slice(0, 10);

  /** score of one rep: tempo in band = 1; with a measured contact height, (2*tempo + height)/3. null = not measured. */
  function repScore(m, tb, hb) {
    if (!m || m.tempoS == null || m.tempoS <= .1 || !tb) return null; // a tempo near 0 is a detection glitch, not a rep to judge
    const t = inB(m.tempoS, tb) ? 1 : 0;
    if (m.contactHeightM == null || !hb) return t;
    return (2 * t + (inB(m.contactHeightM, hb) ? 1 : 0)) / 3;
  }
  const sd = a => { if (a.length < 2) return 0; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

  /** store: {get(k,d), set(k,v)}; profile per shot: {best, reps, l4Days:[YYYY-MM-DD], badges:[]} */
  function createSession({ shot, repGoal = 20, tempoBand, heightBand, store, now = () => Date.now() }) {
    const key = 'padel.mastery';
    const all = (store && store.get(key, {})) || {};
    const prof = all[shot] = Object.assign({ best: 0, reps: 0, l4Days: [], badges: [] }, all[shot] || {});
    const st = { shot, repGoal, reps: 0, scores: [], tempos: [], streak: 0, bestStreak: 0, level: 0, startBest: prof.best };
    const save = () => store && store.set(key, all);
    const badge = (id, label, ev) => { if (prof.badges.includes(id)) return; prof.badges.push(id); ev.push({ type: 'badge', id, label }); };

    function levelNow() {
      const w = st.scores.slice(-WINDOW).filter(s => s != null), p = w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
      const tw = st.tempos.slice(-WINDOW);
      let lv = st.reps >= 5 ? 1 : 0;
      for (const L of LEVELS.slice(1, 4)) if (w.length >= L.minReps && p >= L.pct - 1e-9 && (!L.maxSd || sd(tw) <= L.maxSd)) lv = Math.max(lv, L.n);
      return { pct: p, measured: w.length, level: lv, tempoSd: sd(tw) };
    }

    function add(stroke) {
      const m = stroke && stroke.metrics || {}, ev = [];
      st.reps++; prof.reps++;
      const s = repScore(m, tempoBand, heightBand); st.scores.push(s);
      if (s != null) st.tempos.push(m.tempoS);
      const inBand = s != null && s >= 2 / 3 - 1e-9;
      if (inBand) { st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); if (STREAKS.includes(st.streak)) ev.push({ type: 'streak', n: st.streak }); }
      else if (s != null) st.streak = 0;
      ev.unshift({ type: inBand ? 'good' : 'rep', score: s });
      const r = levelNow();
      let lv = Math.max(st.level, r.level);
      if (lv >= 4 && !prof.l4Days.includes(day(now()))) { prof.l4Days.push(day(now())); prof.l4Days = prof.l4Days.slice(-10); }
      if (lv >= 4 && prof.l4Days.length >= 2) lv = 5; // locked in on two different days = retained
      if (lv > st.level) {
        for (let n = st.level + 1; n <= lv; n++) { ev.push({ type: 'levelup', level: n, name: LEVELS[n - 1].name, newBest: n > prof.best }); if (n >= 3) badge(`${shot}_l${n}`, `${LEVELS[n - 1].name}: ${shot}`, ev); }
        st.level = lv; if (lv > prof.best) prof.best = lv;
      }
      if (st.reps === repGoal) ev.push({ type: 'setdone', reps: st.reps });
      if (prof.reps >= 100) badge(`${shot}_100`, `First 100: ${shot}`, ev);
      if (prof.reps >= 1000) badge(`${shot}_1000`, `1,000 reps: ${shot}`, ev);
      save();
      return Object.assign({ events: ev, inBand, streak: st.streak, reps: st.reps }, r, { level: st.level, next: LEVELS[st.level] || null });
    }
    function summary() { const r = levelNow(); return { shot, reps: st.reps, level: st.level, levelName: st.level ? LEVELS[st.level - 1].name : '-', pct: r.pct, measured: r.measured, bestStreak: st.bestStreak, best: prof.best }; }
    return { add, summary, profile: prof };
  }
  const api = { LEVELS, WINDOW, repScore, createSession };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PadelMastery = api;
})(typeof window !== 'undefined' ? window : globalThis);
