// Run from the repo root:  PW=<path to playwright package> node ar-coach/tests/run.mjs
// Serves the repo root on a local port, then runs smoke + U04 parity + U21 cue + panel tests at 390x844 and 844x390.
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}/ar-coach/`;
const golden = JSON.parse(fs.readFileSync(path.join(root, 'ar-coach/tests/golden_u04.json'), 'utf8'));
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
let total = 0, failed = 0; const summary = {};
async function t(vp, name, fn) { total++; summary[vp] = summary[vp] || { pass: 0, fail: 0 }; try { await fn(); summary[vp].pass++; console.log('ok   ', vp, name); } catch (e) { summary[vp].fail++; failed++; console.log('FAIL ', vp, name, '\n     ', String(e.message).split('\n')[0]); } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'eq'}: ${a} !== ${b}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const FRAME = `(n) => { for (let i = 0; i < n; i++) PadelFeat.frame({ skeleton: Array.from({ length: 17 }, (_, j) => [j * 3, j * 5 + i, 1]) }, i / 30, { REL: { checks: [] }, S: { hand: 'right', shot: 'bandeja' }, gate: () => ({ show: false }), band: () => null }); }`;
for (const [vp, w, h] of [['390x844', 390, 844], ['844x390', 844, 390]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR/.test(m.text())) errs.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForFunction(() => document.querySelectorAll('#gates tr').length > 0, null, { timeout: 15000 });
  // ---- smoke ----
  await t(vp, 'smoke: title', async () => ok(/Padel Coach/.test(await page.title())));
  await t(vp, 'smoke: no page errors on boot', async () => eq(errs.filter(e => !/three|jsdelivr|ONNX|onnx/i.test(e)).length, 0, errs.join('|')));
  await t(vp, 'smoke: engine name shown', async () => ok((await page.textContent('#engName')).trim().length > 0));
  await t(vp, 'smoke: 7 release-gate rows', async () => eq(await page.locator('#gates tr').count(), 7));
  await t(vp, 'smoke: no LIVE CUE pill while nothing is released', async () => eq(await page.locator('#gates .pill', { hasText: 'LIVE CUE' }).count(), 0));
  await t(vp, 'smoke: shot chips', async () => ok(await page.locator('#shots .chip').count() >= 10));
  await t(vp, 'smoke: settings controls', async () => { for (const id of ['#sEngine', '#sView', '#sHeight', '#sHand']) ok(await page.locator(id).count() === 1, id); });
  await t(vp, 'smoke: no horizontal scroll', async () => ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)));
  for (const s of ['upload', 'drills', 'summary', 'inbox']) await t(vp, `smoke: open #${s} and back`, async () => { await page.click(`[data-go="${s}"]`); ok(await page.locator('#' + s).isVisible()); await page.click(`#${s} [data-go="home"]`); ok(await page.locator('#home').isVisible()); });
  await t(vp, 'smoke: release.json + manifest + sw served', async () => { for (const f of ['release.json', 'manifest.webmanifest', 'sw.js']) ok((await page.request.get(BASE + f)).ok(), f); });
  // ---- U04 parity ----
  await t(vp, `u04 parity: ${golden.cases.length} golden cases within 1e-3`, async () => {
    const res = await page.evaluate(async G => { const M = await import('./vendor/metrics.js'); const out = []; for (const c of G.cases) { const kp = Float32Array.from(c.kp.map(x => x == null ? NaN : x)); const js = M.compute(kp, c.T, c.K, c.layout, c.fps); let n = 0, bad = 0; for (const k of Object.keys(c.expected)) { const e = c.expected[k], v = js[k]; if (!v || v.length !== e.length) { bad += e.length; n += e.length; continue; } for (let i = 0; i < e.length; i++) { n++; const a = v[i], b = e[i]; if (b == null ? !Number.isNaN(a) : !(Math.abs(a - b) <= G.tolerance)) bad++; } } out.push([c.name, n, bad, Object.keys(js).length, Object.keys(M.REGISTRY).length]); } return out; }, golden);
    for (const [n, cnt, bad, a, b] of res) { ok(cnt > 0, n + ' empty'); eq(bad, 0, `${n}: ${bad}/${cnt} mismatches`); eq(a, b, 'registry size'); }
  });
  // ---- U21 cues ----
  await t(vp, 'u21 cue lookup es+en (exact key, findCue, shot alias, validation)', async () => {
    const r = await page.evaluate(async () => { const d = await fetch('vendor/cues_padel.json').then(r => r.json()), P = PadelFeat; let thrown = 0; try { P.cue(d, 'padel/bandeja:contact:elbow_r', 'mid', 'club', 'en'); } catch { thrown++; } try { P.cue(d, 'padel/bandeja:contact:elbow_r', 'low', 'club', 'fr'); } catch { thrown++; }
      return { en: P.cue(d, 'padel/bandeja:contact:elbow_r', 'low', 'club', 'en'), es: P.cue(d, 'padel/bandeja:contact:elbow_r', 'low', 'club', 'es'), fc: P.findCue(d, 'forehand', 'elbow_r', 'high', 'club', 'es'), fcEn: P.findCue(d, 'smash', 'knee_max', 'low', 'beginner', 'en'), none: P.findCue(d, 'bandeja', 'nope', 'low'), thrown, n: Object.keys(d.cues).length }; });
    eq(r.en, 'Reach the racket farther out'); eq(r.es, 'Extiende más la pala'); ok(r.fc && r.fc.length > 3, 'alias forehand->forehand_drive'); ok(r.fcEn && r.fcEn.length > 3); eq(r.none, null); eq(r.thrown, 2); ok(r.n > 200);
  });
  await t(vp, 'u21 cue shown only when gate releases the check (es and en)', async () => {
    const r = await page.evaluate(async () => {
      const P = PadelFeat; P.on.u04 = true; P.on.u21 = true; P.ensure(); await P.metricsP; await P.cuesP; P.buf.length = 0;
      const sk = (elbowDeg) => { const kp = Array.from({ length: 17 }, () => [0, 0, 1]); const a = (180 - elbowDeg) * Math.PI / 180; kp[8] = [1, 0, 1]; kp[10] = [1 + Math.cos(a), Math.sin(a), 1]; kp[11] = [0, 2, 1]; kp[12] = [0, 2, 1]; return kp; };
      const mkctx = fault => ({ REL: { checks: [{ id: 'elbow_contact' }] }, S: { hand: 'right', shot: 'bandeja' }, gate: () => ({ show: true, fault, def: { unit: 'deg' } }), band: () => [140, 180] });
      for (let i = 0; i < 20; i++) P.frame({ skeleton: sk(90) }, i / 30, mkctx(false));
      const stroke = { tStart: 0, tContact: 19 / 30 }, out = {}; document.getElementById('u21cue')?.remove(); P.lastCue = null;
      P.stroke(stroke, mkctx(false)); out.hidden = P.lastCue === null && !document.getElementById('u21cue');
      P.lang = 'es'; P.stroke(stroke, mkctx(true)); out.es = P.lastCue && P.lastCue.text; out.esDom = document.getElementById('u21cue')?.textContent;
      P.lang = 'en'; P.stroke(stroke, mkctx(true)); out.en = P.lastCue && P.lastCue.text; out.val = P.lastCue && P.lastCue.value;
      P.on.u04 = false; P.on.u21 = false; P.lang = 'auto'; return out; });
    ok(r.hidden, 'cue must stay hidden when gate.fault is false'); eq(r.es, 'Extiende más la pala'); eq(r.esDom, r.es); eq(r.en, 'Reach the racket farther out'); ok(Math.abs(r.val - 90) < 1, 'metric ~90 deg got ' + r.val);
  });
  // ---- panel ----
  await t(vp, 'panel: gear opens, defaults off, baseline row + fps readout', async () => {
    await page.evaluate(() => localStorage.removeItem('padel.features')); await page.reload({ waitUntil: 'load' });
    await page.click('#featBtn'); ok(await page.locator('#featPanel').isVisible()); eq(await page.locator('#featRows input:checked').count(), 0);
    ok(/Baseline/.test(await page.textContent('#featBase'))); ok(/fps/.test(await page.textContent('#featFps')), 'fps readout');
    const box = await page.locator('#featPanel').boundingBox(); ok(box.x >= 0 && box.x + box.width <= w + 1 && box.y >= 0 && box.y + box.height <= h + 1, 'panel inside viewport ' + JSON.stringify(box)); });
  for (const f of ['u04', 'u21']) await t(vp, `panel: toggle ${f}, persists, ms/fps columns fill`, async () => {
    if (!await page.locator('#featPanel').isVisible()) await page.click('#featBtn');
    await page.evaluate(`(${FRAME})(40)`);
    await page.check(`#featRows input[data-feat="${f}"]`); ok(await page.evaluate(k => PadelFeat.on[k], f)); ok(await page.evaluate(k => JSON.parse(localStorage.getItem('padel.features')).on[k], f), 'persisted');
    await page.evaluate(`(async () => { for (let i = 0; i < 40; i++) { (${FRAME})(1); await new Promise(r => setTimeout(r, 4)); } PadelFeat.render(true); })()`);
    const row = page.locator('#featRows tr', { has: page.locator(`input[data-feat="${f}"]`) }); const cells = await row.locator('td').allTextContents(); ok(/\d/.test(cells[1]), 'ms/frame ' + cells[1]); ok(/\d/.test(cells[2]), 'fps with ' + cells[2]);
    await page.uncheck(`#featRows input[data-feat="${f}"]`); eq(await page.evaluate(k => PadelFeat.on[k], f), false); });
  await t(vp, 'panel: persisted choice survives reload; bad localStorage tolerated', async () => {
    await page.evaluate(() => localStorage.setItem('padel.features', JSON.stringify({ on: { u04: true, u21: false }, lang: 'es' }))); await page.reload({ waitUntil: 'load' });
    eq(await page.evaluate(() => PadelFeat.on.u04), true); eq(await page.evaluate(() => PadelFeat.lang), 'es');
    await page.evaluate(() => localStorage.setItem('padel.features', '{bad json')); await page.reload({ waitUntil: 'load' }); eq(await page.evaluate(() => PadelFeat.on.u04), false, 'bad json -> defaults'); await page.evaluate(() => localStorage.removeItem('padel.features')); });
  await t(vp, 'smoke: live screen opens (shadow)', async () => { await page.click('[data-go="shadow"]'); await page.waitForTimeout(300); ok(await page.locator('#live').isVisible()); });
  await ctx.close();
}
console.log('\nSUMMARY', JSON.stringify(summary), `total=${total} failed=${failed}`); browser.close().catch(() => { }); srv.close(); setTimeout(() => process.exit(failed ? 1 : 0), 500);
