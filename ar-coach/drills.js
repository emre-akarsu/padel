'use strict';
(function () {
  var cache = null;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var KEY = 'padelDrillProgress';
  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  var progress = {
    get: function (id) {
      var o = readAll()[id];
      return { done: (o && Array.isArray(o.done)) ? o.done : [] };
    },
    mark: function (id, i) {
      try {
        var all = readAll();
        var o = all[id] || { done: [] };
        if (o.done.indexOf(i) < 0) o.done.push(i);
        all[id] = o;
        localStorage.setItem(KEY, JSON.stringify(all));
      } catch (e) {}
    }
  };
  function load() {
    if (!cache) {
      cache = fetch('drills.json').then(function (r) {
        if (!r.ok) throw new Error('drills.json ' + r.status);
        return r.json();
      }).catch(function (e) { cache = null; throw e; });
    }
    return cache;
  }
  var PH = { E1: 'E1', E2: 'E2', E3: 'E3' };
  function render(el, opts) {
    opts = opts || {};
    var checks = opts.checks || [];
    var shotName = opts.shotName || function (x) { return x; };
    var byId = {};
    checks.forEach(function (c) { byId[c.id] = c; });
    return load().then(function (data) {
      var sets = data.sets || [];
      var html = '';
      ['E1', 'E2', 'E3'].forEach(function (ph) {
        var grp = sets.filter(function (s) { var c = byId[s.check]; return c && c.phase === ph; });
        if (!grp.length) return;
        html += '<h3>' + esc(PH[ph]) + '</h3>';
        grp.forEach(function (s) {
          var c = byId[s.check];
          var done = progress.get(s.id).done;
          var live = c.status === 'auto';
          html += '<div class="card"><h4>' + esc(s.title) + '</h4>' +
            '<p class="muted small">' + esc(s.why) + '</p>' +
            '<p class="small">' + esc(c.label) + ' <span class="pill">' + (live ? 'live cue' : 'numbers only') + '</span></p>' +
            '<div class="chips">' + (s.shots || []).map(function (id) {
              return '<span class="chip">' + esc(shotName(id)) + '</span>';
            }).join('') + '</div><ol>';
          (s.steps || []).forEach(function (st, i) {
            var d = done.indexOf(i) >= 0;
            html += '<li><b>' + esc(st.name) + '</b> <span class="muted small">' + esc(st.mode) +
              (st.use ? ' / ' + esc(st.use) : '') + ' &middot; ' + esc(st.reps) + ' reps</span> ' +
              (d ? '<span class="pill">&#10003;</span> ' : '') +
              '<div class="muted small">' + esc(st.focus) + '</div>' +
              '<button class="btn primary" data-set="' + esc(s.id) + '" data-step="' + i + '">Start</button></li>';
          });
          html += '</ol><p class="muted small">Pass: ' + esc(s.pass) + '</p></div>';
        });
      });
      el.innerHTML = html || '<p class="muted">No drills.</p>';
      el.onclick = function (ev) {
        var b = ev.target.closest && ev.target.closest('button[data-set]');
        if (!b || !el.contains(b)) return;
        var set = sets.filter(function (s) { return s.id === b.getAttribute('data-set'); })[0];
        var idx = +b.getAttribute('data-step');
        if (!set || !set.steps[idx]) return;
        if (opts.onStart) opts.onStart({ set: set, step: set.steps[idx], stepIndex: idx, shot: (set.shots || [])[0] });
      };
    });
  }
  window.PadelDrills = { load: load, render: render, progress: progress };
})();
