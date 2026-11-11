// Live cost of the optional features: fake camera + mock engine, 4 windows (baseline, u04, u21, both).
// Run from repo root:  PW_CHANNEL=msedge PW=<playwright pkg> node ar-coach/tests/bench_feats.mjs [seconds_per_window]
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SEC = +(process.argv[2] || 8);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}/ar-coach/`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
for (const [vp, w, h] of [['390x844', 390, 844], ['844x390', 844, 390]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block', permissions: ['camera'] }); const page = await ctx.newPage();
  await page.route('**/release.json', async r => { const j = await (await r.fetch()).json(); j.checks.forEach(c => { if (['elbow_contact', 'knee_load'].includes(c.id)) { c.status = 'auto'; c.precisionLB = .9; c.n = 100; } }); r.fulfill({ json: j }); });
  await page.addInitScript(() => { localStorage.setItem('padel.settings', JSON.stringify({ engine: 'mock' })); });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => document.querySelectorAll('#gates tr').length > 0);
  await page.click('[data-go="shadow"]'); await page.waitForFunction(() => !document.querySelector('#startBtn').disabled, null, { timeout: 60000 });
  await page.click('#startBtn');
  const res = [];
  for (const [name, on] of [['baseline', { u04: false, u21: false }], ['u04', { u04: true, u21: false }], ['u21', { u04: false, u21: true }], ['u04+u21', { u04: true, u21: true }]]) {
    await page.evaluate(async on => { const P = PadelFeat; Object.assign(P.on, on); P.ensure(); await P.metricsP; await P.cuesP; for (const k of ['u04', 'u21']) { P.cost[k] = { ms: 0, n: 0 }; P.fps[k] = { w: { n: 0, s: 0 }, wo: { n: 0, s: 0 } }; } P.fps.base = { n: 0, s: 0 }; P.buf.length = 0; P.lastT = 0; }, on);
    await page.waitForTimeout(SEC * 1000);
    res.push([name, await page.evaluate(() => { const P = PadelFeat, f = b => b.s > 0 ? +(b.n * 1000 / b.s).toFixed(1) : null; return { frames: P.cost.u04.n || P.cost.u21.n || P.fps.base.n, fpsBase: f(P.fps.base), fpsU04: f(P.fps.u04.w), fpsU21: f(P.fps.u21.w), msU04: P.cost.u04.n ? +(P.cost.u04.ms / P.cost.u04.n).toFixed(4) : null, msU21: P.cost.u21.n ? +(P.cost.u21.ms / P.cost.u21.n).toFixed(4) : null }; })]);
  }
  console.log(vp, JSON.stringify(res)); await ctx.close();
}
srv.close(); browser.close().catch(() => { }); setTimeout(() => process.exit(0), 500);
