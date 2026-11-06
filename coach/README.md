# Padel Coach PWA

Live: https://emre-akarsu.github.io/padel/coach/ · Feasibility test: https://emre-akarsu.github.io/padel/coach/bench.html

A plain-web, mobile-first PWA (no framework, no build step) for the plan in *Real-time AR coaching on the phone*. The app is UI only. Every number comes from an **engine** behind one contract, so the real engine drops in without touching the UI.

| Screen | What it does |
|---|---|
| Shadow swing mirror | Front or rear camera, live skeleton, green ghost coach fitted to your body (hip anchor, torso scale), stage subtitle, wrist trail. |
| Drill | Rear camera, highest fps the camera gives (asks for 120), live HUD (count, tempo, contact height + target band, phase), a 4 s ring buffer, and an automatic 0.25x replay after each stroke (skeleton, hit-path trail coloured by phase, ghost time-warped to your contact, 0.5 s contact freeze with a height line). Spoken neutral numbers after each stroke. |
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

`techniques.json` currently holds **placeholder** 2D keyframes. Each key gives joint angles at a stroke time `u` (0 to 1), plus `contactU`. `ghost.js` turns them into COCO-17 poses with 2D forward kinematics, then fits the pose to the player (hip-mid anchor, torso-length scale, facing from nose vs ear). In replay, the ghost is time-warped so its contact matches the player's contact.

The multi-strike engine can replace a shot with a baked clip. Use `"frames": [[[x, y] x17], ...]` in torso units (hip-mid origin, y down, facing +x, right-handed), with the same `name`, `durationS`, `contactU` and `keys[].phase` (for subtitles). No code change is needed.

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
- Contact height uses your height setting: pixels per metre = (ankle − nose) / (0.88 × height).
- The web camera usually tops out at 30 to 60 fps, and iOS has no exposure lock, thermal state or battery API. The bench page shows what the phone actually gives you.
- Checked in headless Chromium (CPU WASM, no GPU): the full UI flow worked on the mock and onnx engines, and RTMPose-s keypoints matched a rendered bandeja clip. Real phone fps is still unmeasured: run the bench page on the phones.
- RTMPose body7 weights: licence audit still pending (see Path to production, blocker 4).
