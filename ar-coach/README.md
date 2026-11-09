# Padel Coach PWA

Live: https://emre-akarsu.github.io/padel/ar-coach/ · Feasibility test: https://emre-akarsu.github.io/padel/ar-coach/bench.html

A plain-web, mobile-first PWA (no framework, no build step) for the plan in *Real-time AR coaching on the phone*. The app is UI only. Every number comes from an **engine** behind one contract, so the real engine drops in without touching the UI.

| Screen | What it does |
|---|---|
| Use cases (home) | Shadow swing, Ball machine, Hitting gadget, Wall / rebound, Coach lesson (live, each with its own phone setup tips); Match or handheld clip (upload only). A release-gates table shows each check as HIDDEN, NUMBERS or LIVE CUE from `release.json`. |
| Shadow swing mirror | Front or rear camera, the ideal 3D model drawn **beside** you at your scale (not on top: overlapping bodies were unreadable), stage subtitle, wrist trail. |
| Drill | Rear camera, highest fps the camera gives (asks for 120), live HUD (count, tempo, contact height + target band, phase), a 4 s ring buffer, and an automatic 0.25x **split replay** after each stroke: YOU (video, hit-path trail coloured by phase, your contact line) next to IDEAL (3D model at your scale, time-warped to your contact). Side by side, or stacked when a landscape clip is shown on a portrait screen. A spoken between-point summary every 6 strokes. Spoken neutral numbers after each stroke. |
| Review a video | Upload a clip and run `engine.analyzeVideo` on it. You get a stroke table and a replay over the video, and every stroke goes to the inbox. |
| Session summary | Count, contact-height range, tempo mean ± sd, and each measure against its target band. Export JSON. |
| Coach Review Inbox | Each stroke shows a contact thumbnail, the suggested shot and engine check drafts. The coach can approve, fix the shot, mark "not a stroke", answer agree/disagree/unsure per check and add a note. Export gives `padel.coach_labels.v1` JSON for the learning loop. Player Agree / Not sure / Wrong taps from replay are saved too. |
| Feasibility test | Camera → pose → skeleton for N minutes (30 by default). Every 10 s it logs fps, p50/p95 inference, p95 frame time, dropped frames, camera fps, battery and CPU pressure. It shows PASS/FAIL against the plan (≥20 fps, p95 frame ≤50 ms, battery ≤25 % per 30 min) and lets you download a CSV. |

Offline: `sw.js` caches the app shell. The model and ONNX Runtime are cached the first time they are used. Install: on Android use "Install" (Chrome), on iOS use Share → Add to Home Screen. Bump `V` in `sw.js` on every deploy.

## Release gating (cues off by default)

`release.json` decides what the user sees. The engine only reports values. For each check:

- `hidden`: not shown.
- `numbers` (the default now, phase E0): the value is shown next to its target band, with no verdict.
- `suggest`: a coach-only draft in the inbox.
- `auto`: spoken and subtitled. This only happens when `precisionLB ≥ gates.faultGate` (0.85) **and** `n ≥ gates.minN` (60). The "looks good" cue needs `goodStatus = auto` and `goodPrecisionLB ≥ 0.95`.

There is at most one fault cue per stroke and at most 3 per block of 10 strokes. Checks are phased E1 (contact low or behind), E2 (elbow, knee, free arm, racket up early) and E3 (tempo). The stroke count shows as "≈N" until `features.stroke_count.precisionLB ≥ 0.85`. Stage labels always say "approx." until the phase gate passes. To release a check, edit `release.json`. It is fetched network-first, so no app update is needed.

## Engine contract (v1)

The authoritative types are in [`engine/engine.d.ts`](engine/engine.d.ts). Summary:

```ts
interface Engine {
  info: EngineInfo;                              // name, version, capabilities {live, video, dense, shotClassifier, shots, checks}
  init(o: EngineOptions): Promise<void>;         // load models / connect; idempotent
  configure(o: Partial<EngineOptions>): void;    // shot, view, mode, height, hand
  processFrame(f: FrameInput): Promise<FrameResult>;          // live path
  analyzeVideo(file: Blob, {onProgress, signal}): Promise<VideoResult>;
  selectSubject(x: number, y: number): void;     // tap-to-pick, source pixels
  reset(): void;  dispose(): Promise<void>;
}
EngineOptions = { mode: 'shadow'|'drill'|'review'|'bench', shot: ShotId|null, view: 'side'|'behind'|'front',
                  playerHeightM, handedness: 'right'|'left', targetFps?, checks? (release.json checks), ...extras }
FrameInput    = { image: CanvasImageSource, width, height, t /* s */, index }
FrameResult   = { t, persons: Person[], subject: number|null, skeleton: Keypoint[17]|null,
                  phase: {id, progress 0..1|null, confidence, approx} | null, shot: {id, confidence, source}|null,
                  strokes: Stroke[] /* completed on THIS frame */, metrics: Metrics, checks: CheckResult[],
                  timing: {inferenceMs, skipped}, quality: {fullBody, personPx, message} }
Stroke        = { id, tStart, tContact, tEnd, shot, phases: [{id, tStart, tEnd}], metrics, checks,
                  track: [{t, keypoints}], trail: [[x, y, t]] }
Metrics       = { strokeCount, tempoS, contactHeightM, contactAheadM, elbowAngleContactDeg, kneeAngleLoadDeg,
                  wristSpeedPeak, racketUpEarly?, freeArmUp? }          // null = not measurable, never a guess
CheckResult   = { id /* release.json id */, value, unit: 'm'|'s'|'deg'|'bool', band: [lo, hi], pass: true|false|null /* null = abstain */, confidence }
VideoResult   = { engine, durationS, fps, width, height, strokes, track? }
```

Conventions:

- Keypoints are COCO-17 `[x, y, score]` in source pixels, y down.
- Time is in seconds (live: `performance.now()/1000`; video: media time).
- Phases are `ready, preparation, backswing, forward_swing, contact, follow_through, recovery`.
- Shots are `bandeja, vibora, smash, forehand, backhand, volley_fh, ...`.

### Plugging in an engine

1. Write `engine/my-engine.js` that calls `PadelEngines.register('real', opts => ({ info, init, configure, processFrame, analyzeVideo, selectSubject, reset, dispose }))`.
2. Add `<script src="engine/my-engine.js"></script>` before `app.js` in `index.html` (and in `bench.html` if you want to benchmark it). Add the file to `SHELL` in `sw.js`.
3. Pick "real" under Settings → Engine.

A pose-only engine can reuse the shared deterministic core. `PadelCore.createAnalyzer(opts).update(t, keypoints, w, h)` returns `skeleton, phase, strokes, metrics, checks, quality` (one-euro smoothing, wrist-speed stroke detector, metrics at the contact frame, checks against the bands). `PadelCore.analyzeVideoByFrames(engine, file)` gives any frame engine an `analyzeVideo`.

### Shipped engines

| Name | File | What it is |
|---|---|---|
| `mock` | `engine/mock.js` | Ignores pixels and animates a synthetic player from `techniques.json` (a stroke every ~3 s with tempo and height variation). It runs through the shared core, so every screen gets data in the contract's shape. |
| `onnx` | `engine/onnx.js` | On-device **RTMPose-s** 256x192 SimCC (`models/rtmpose-s.onnx`, 21.9 MB, the mmdeploy SDK export) on ONNX Runtime Web 1.20.1, WebGPU with WASM fallback. Pose normalisation matches the mmpose config (RGB, mean 123.675/116.28/103.53, std 58.395/57.12/57.375; crop padding 1.25, 3:4). **RTMDet-nano is a plug point**: set `detUrl` to an end2end ONNX (1x3x320x320 BGR, `dets [1,N,5]`). Without it, the engine starts from a centred full-body crop and tracks the player from its own keypoints, which is enough for one player in drill or shadow mode. |
| `remote` | `engine/remote.js` | HTTP adapter to the MSI pipeline, upload only (see below). |

### Remote (MSI) server contract

```
GET  /v1/info                 -> EngineInfo
POST /v1/analyze              multipart: file=<video>, options=<EngineOptions JSON>  -> { "jobId": "..." }
GET  /v1/jobs/{jobId}         -> { "status": "queued"|"running"|"done"|"error", "progress": 0..1, "result": VideoResult, "error": "..." }
```

`Authorization: Bearer <token>` is optional. CORS must allow `https://emre-akarsu.github.io`. The app polls every 2 s.

## Ghost coach / technique specs

`techniques.json` is generated from the **Strike Player v5** specs (`/padel/strikes/specs/padel.json`, 13 padel strokes). `tools/export_ghost.mjs` runs the Strike Player's own `solver.js` (same IK and C2 splines), samples 72 frames per stroke, and projects them orthographically from the side-fence view. That view is the player's right side, with image x = toward the net. The frames are stored as COCO-17 `frames` in torso units (hip-mid origin, y down, right-handed), along with `durationS`, `contactU` and phase `keys` (`phase`, `label`, `cue`).

Regenerate after the specs change:

```
node coach/tools/export_ghost.mjs <path to the padel site checkout>
```

Then bump `V` in `sw.js`.

The ghost you see is the **Strike Player girl in 3D** (`ghost3d.js`). It loads `../strikes/assets/player.glb`, the specs and `solver.js` directly from the Strike Player and renders them with three.js 0.160 from the side-fence view (orthographic, 60% opacity). It is fitted to the player the same way. If WebGL or the assets fail, the app falls back to the 2D stick ghost from these frames. `ghost.js` fits the frames to the player (hip-mid anchor, torso-length scale, facing from nose vs ear). In replay it is time-warped so the ghost's contact lands on the player's contact. Shot ids follow the app (`forehand_drive` → `forehand`, `globo` → `lob`, volleys → `volley_fh`/`volley_bh`). The rest keep their Strike ids. Hand-set angle `keys` (the old format) still work for shots that have no frames.

The wrist-height band for each shot (`release.json` → `contact_low`, `relHeight: true` = fractions of the player's height) is the Strike reference wrist height at contact ± 0.09 H. These bands are placeholders until pro footage replaces them.

## Coach label export (`padel.coach_labels.v1`)

```json
{ "schema": "padel.coach_labels.v1", "trust": "coach_label", "releaseVersion": 1,
  "items": [{ "id": "...", "sessionId": "...", "source": "live|upload", "mode": "drill", "tContact": 14.2,
     "shot": { "suggested": {"id": "bandeja", "confidence": 1, "source": "drill"}, "final": "bandeja" },
     "metrics": {...}, "checks": [{ "id": "contact_low", "value": 2.1, "band": [2.3, 2.7], "pass": false }],
     "playerFeedback": "agree|unsure|wrong|null",
     "review": { "verdict": "approved|fixed|rejected", "shot": "bandeja", "checks": {"contact_low": "agree"}, "note": "", "at": "..." } }] }
```

## Known limits

- Contact is the racket-wrist speed peak; for overheads it is the highest wrist point within -0.25 to +0.1 s of that peak. Stage cuts are fixed fractions around contact, which is why they are marked approx.
- Contact height is the racket-hand wrist height (not the ball). It uses your height setting: pixels per metre = (ankle − nose) / (0.88 × height).
- The web camera usually tops out at 30 to 60 fps, and iOS has no exposure lock, thermal state or battery API. The bench page shows what the phone actually gives you.
- Checked in headless Chromium (CPU WASM, no GPU): the full UI flow worked on the mock and onnx engines, and RTMPose-s keypoints matched a rendered bandeja clip. Real phone fps is still unmeasured: run the bench page on the phones.
- RTMPose body7 weights: licence audit still pending (see Path to production, blocker 4).

## Smoke test (2026-11-07)
14 tests run in parallel in headless Chromium with the real RTMPose-s engine (WASM) and a padel clip as the camera: home, shadow, ball machine, gadget, wall, lesson, drill sets, practice link, review a video, summary chat, inbox export, ideal swings library, Strike Player page, feasibility page. 14 of 14 pass. Not yet run on a real phone.
New: voice question in live (🎤, browser speech recognition, no AI): "show me the last one", "replay 2", "how was that?". Chat filters: low, high, slow, fast, on target.

## Step-by-step Swing Guide (POC)

`guide.html` (live: https://emre-akarsu.github.io/padel/ar-coach/guide.html). Pick a padel stroke; the page walks you through its stages one position at a time (the ghost `keys` from `techniques.json`). For each step: the ideal avatar pose is shown beside you, you move into it and hold still for 1.2 s (or tap "Capture now"; it captures anyway after 14 s), then that step's checks appear: hitting/free elbow bend, knee bend, upper-body lean, racket-hand height and how far in front of the hips, each as your value vs target band, PASS/FAIL/n/a and a plain-language fix. A summary and JSON export come at the end. Pose = the same on-device RTMPose-s engine (`engine/onnx.js` + `engine/core.js`).

Targets are measured on the ideal avatar frame with the same 2D side-view code used for you (like for like), ± a tolerance; where the v3 spec (`guide_spec.json`, extracted from `knowledge/ideal_strokes/v3` padel `*.ranges.json`, realtime rows) has a coaching range, the band is widened to it. **Not coach-validated.** `?shot=<id>` preselects a stroke.
