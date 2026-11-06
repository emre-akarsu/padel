/**
 * Padel Coach engine contract (v1).
 *
 * The app never analyses video itself. It talks to exactly one object that
 * implements `Engine`. Three implementations ship with the app:
 *   - engine/mock.js   synthetic skeleton + strokes (no model, runs anywhere)
 *   - engine/onnx.js   on-device RTMDet-nano + RTMPose-s via ONNX Runtime Web (plug point)
 *   - engine/remote.js HTTP adapter to the MSI pipeline (upload-a-video only)
 * A real engine drops in by implementing this interface and calling
 *   window.PadelEngines.register('<name>', (opts) => engine)
 * from a script loaded before app.js (see README "Plugging in an engine").
 *
 * Conventions
 *   - Time `t` is seconds. Live: performance.now()/1000. Video: media time.
 *   - Coordinates are pixels in the source frame (FrameInput.width/height), y down.
 *   - Keypoints are COCO-17 order: 0 nose, 1 l_eye, 2 r_eye, 3 l_ear, 4 r_ear,
 *     5 l_shoulder, 6 r_shoulder, 7 l_elbow, 8 r_elbow, 9 l_wrist, 10 r_wrist,
 *     11 l_hip, 12 r_hip, 13 l_knee, 14 r_knee, 15 l_ankle, 16 r_ankle.
 *   - Units: metres (M), seconds (S), degrees (Deg) as suffixed in field names.
 *   - The engine reports values. It never decides what the user sees:
 *     release gating (numbers vs cues) is done by the app from release.json.
 *   - Absent / not measurable => null (never 0, never a guess).
 */

export type Keypoint = [x: number, y: number, score: number];

export type ShotId =
  | 'bandeja' | 'vibora' | 'smash' | 'forehand' | 'backhand'
  | 'volley_fh' | 'volley_bh' | 'lob' | 'serve' | (string & {});

export type PhaseId =
  | 'ready' | 'preparation' | 'backswing' | 'forward_swing'
  | 'contact' | 'follow_through' | 'recovery';

export type View = 'side' | 'behind' | 'front';
export type Mode = 'shadow' | 'drill' | 'review' | 'bench';

export interface EngineOptions {
  mode: Mode;
  /** Known shot (drill / shadow mode). null = free play, engine may classify. */
  shot: ShotId | null;
  view: View;
  /** Used to convert pixels to metres (contact height etc.). */
  playerHeightM: number;
  handedness: 'right' | 'left';
  /** Target live inference rate; engine may skip frames to hold it. */
  targetFps?: number;
  /** Engine-specific extras (model URLs, server URL, ...). */
  [extra: string]: unknown;
}

export interface EngineInfo {
  name: string;
  version: string;
  capabilities: {
    live: boolean;          // processFrame usable at >= 15 fps
    video: boolean;         // analyzeVideo implemented
    dense: boolean;         // can re-run pose densely around contact (slow-mo)
    shotClassifier: boolean;// shot is estimated when options.shot is null
    shots: ShotId[];
    checks: string[];       // check ids it can measure (see release.json)
  };
}

export interface FrameInput {
  /** Anything drawImage accepts: HTMLVideoElement, ImageBitmap, canvas, VideoFrame. */
  image: CanvasImageSource;
  width: number;
  height: number;
  t: number;
  index: number;
}

export interface Person {
  id: number;                       // tracker id, stable across frames
  bbox: [x: number, y: number, w: number, h: number];
  score: number;
  keypoints: Keypoint[];            // 17, COCO order
}

export interface PhaseState {
  id: PhaseId;
  /** 0..1 through the current stroke (0 = prep start, 1 = recovery end); null when idle. */
  progress: number | null;
  confidence: number;               // 0..1
  /** true until the phase model passes its release gate (shown as "approx."). */
  approx: boolean;
}

export interface ShotEstimate {
  id: ShotId;
  confidence: number;               // 0..1
  source: 'drill' | 'model' | 'coach';
}

export interface Metrics {
  strokeCount: number;              // strokes completed since reset()
  /** Preparation start -> contact. */
  tempoS: number | null;
  /** Wrist (racket hand) height above the ground at contact. */
  contactHeightM: number | null;
  /** + = contact in front of the hip line along the swing direction. */
  contactAheadM: number | null;
  elbowAngleContactDeg: number | null;
  kneeAngleLoadDeg: number | null;
  /** Peak racket-wrist speed in body heights per second. */
  wristSpeedPeak: number | null;
  /** 1 = racket wrist above its shoulder 0.3 s before contact, 0 = not, null = unknown. */
  racketUpEarly?: 0 | 1 | null;
  /** 1 = free-arm wrist above its shoulder 0.3 s before contact. */
  freeArmUp?: 0 | 1 | null;
}

export interface CheckResult {
  /** Must match an id in release.json (e.g. 'contact_low'). */
  id: string;
  value: number | null;
  unit: 'm' | 's' | 'deg' | 'bool';
  /** Target band [lo, hi] used for the verdict. */
  band: [number, number];
  /** true = inside band, false = fault, null = abstained (low confidence / out of frame). */
  pass: boolean | null;
  confidence: number;               // 0..1
}

export interface Stroke {
  id: string;
  tStart: number;
  tContact: number;
  tEnd: number;
  shot: ShotEstimate | null;
  phases: { id: PhaseId; tStart: number; tEnd: number }[];
  metrics: Metrics;                 // values for this stroke (strokeCount = running count)
  checks: CheckResult[];
  /** Subject pose track tStart..tEnd (dense if capabilities.dense) for replay. */
  track: { t: number; keypoints: Keypoint[] }[];
  /** Racket-wrist path, for the hit-path trail. */
  trail: [x: number, y: number, t: number][];
}

export interface FrameResult {
  t: number;
  persons: Person[];
  /** Index into persons of the tracked player, or null. */
  subject: number | null;
  /** Smoothed subject skeleton (convenience copy), or null. */
  skeleton: Keypoint[] | null;
  phase: PhaseState | null;
  shot: ShotEstimate | null;
  /** Strokes that COMPLETED on this frame (events; usually empty). */
  strokes: Stroke[];
  /** Running metrics (last stroke values + count). */
  metrics: Metrics;
  /** Checks of the strokes completed on this frame (same as strokes[*].checks, flattened). */
  checks: CheckResult[];
  timing: { inferenceMs: number; skipped: boolean };
  /** Frame quality for setup guidance. */
  quality: { fullBody: boolean; personPx: number | null; message: string | null };
}

export interface VideoResult {
  engine: EngineInfo;
  durationS: number;
  fps: number;
  width: number;
  height: number;
  strokes: Stroke[];
  /** Optional per-frame subject track for scrubbing replay. */
  track?: { t: number; keypoints: Keypoint[] }[];
}

export interface Engine {
  readonly info: EngineInfo;
  /** Load models / connect. Must be idempotent. Rejects with a readable Error. */
  init(options: EngineOptions): Promise<void>;
  /** Change shot / view / mode without reloading models. */
  configure(options: Partial<EngineOptions>): void;
  /** Live path. Must resolve within one frame budget or set timing.skipped. */
  processFrame(frame: FrameInput): Promise<FrameResult>;
  /** Offline path for uploaded clips. */
  analyzeVideo(
    file: Blob,
    opts?: { onProgress?: (p: number) => void; signal?: AbortSignal }
  ): Promise<VideoResult>;
  /** Tap-to-pick subject in source-frame pixels. */
  selectSubject(x: number, y: number): void;
  /** Clear stroke count, tracker and buffers. */
  reset(): void;
  dispose(): Promise<void>;
}

/** Global registry used by app.js. */
export interface EngineRegistry {
  register(name: string, factory: (o: Partial<EngineOptions>) => Engine): void;
  create(name: string, o?: Partial<EngineOptions>): Engine;
  list(): string[];
}
declare global { interface Window { PadelEngines: EngineRegistry } }
