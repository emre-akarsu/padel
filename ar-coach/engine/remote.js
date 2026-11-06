/* Remote engine: HTTP adapter to the MSI / cloud pipeline (upload-a-video only).
 * Server contract (see README):
 *   GET  {url}/v1/info            -> EngineInfo
 *   POST {url}/v1/analyze         multipart: file=<video>, options=<EngineOptions JSON>  -> { jobId }
 *   GET  {url}/v1/jobs/{jobId}    -> { status: 'queued'|'running'|'done'|'error', progress?: 0..1, result?: VideoResult, error?: string }
 * Optional header: Authorization: Bearer <token>. CORS must allow the Pages origin. */
(function () {
  'use strict';
  function createRemote(init) {
    let o = Object.assign({ remoteUrl: '', token: '', pollMs: 2000 }, init);
    const info = { name: 'remote', version: '1.0', capabilities: { live: false, video: true, dense: true, shotClassifier: true, shots: [], checks: [] } };
    const H = () => o.token ? { Authorization: 'Bearer ' + o.token } : {};
    const base = () => o.remoteUrl.replace(/\/$/, '');
    async function j(r) { if (!r.ok) throw new Error('Server ' + r.status + ': ' + (await r.text()).slice(0, 200)); return r.json(); }
    return {
      info,
      async init(p) {
        Object.assign(o, p || {}); if (!o.remoteUrl) throw new Error('Set the server URL in Settings');
        try { Object.assign(info, await j(await fetch(base() + '/v1/info', { headers: H() }))); } catch (e) { throw new Error('Cannot reach ' + o.remoteUrl + ' (' + e.message + ')'); }
      },
      configure(p) { Object.assign(o, p); },
      async processFrame() { throw new Error('Remote engine is upload-only; pick mock or onnx for live modes'); },
      async analyzeVideo(file, opt = {}) {
        const fd = new FormData(); fd.append('file', file, file.name || 'clip.mp4');
        fd.append('options', JSON.stringify({ mode: 'review', shot: o.shot, view: o.view, playerHeightM: o.playerHeightM, handedness: o.handedness }));
        const { jobId } = await j(await fetch(base() + '/v1/analyze', { method: 'POST', body: fd, headers: H(), signal: opt.signal }));
        for (;;) {
          await new Promise(r => setTimeout(r, o.pollMs));
          if (opt.signal && opt.signal.aborted) throw new Error('Cancelled');
          const s = await j(await fetch(base() + '/v1/jobs/' + encodeURIComponent(jobId), { headers: H() }));
          if (opt.onProgress && s.progress != null) opt.onProgress(s.progress);
          if (s.status === 'done') return s.result;
          if (s.status === 'error') throw new Error(s.error || 'Server error');
        }
      },
      selectSubject() { }, reset() { }, async dispose() { }
    };
  }
  PadelEngines.register('remote', createRemote);
})();
