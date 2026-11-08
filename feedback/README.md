# In-app feedback (schema `padel.feedback/1`)

A **Feedback** button on Strike Player (`strikes/`, `strikes/v5/`), the kick-serve comparisons (`strikes/kick_v7/`, `strikes/kick_v8/`)
and the AR coach (`ar-coach/`: floating on menus, **Feedback** in the live top bar, **Details…** next to Agree / Not sure / Wrong in the replay).
Pressing it pauses the animation and snapshots the exact context; the user adds tags, severity and a note. No account.

| File | Role |
|---|---|
| `feedback/feedback.js` | Widget, local store (`localStorage['padel.feedback.v1']`, last 300), sender, export, GitHub-issue link |
| `strikes/feedback-hook.js` | Strike Player context (sport, stroke, spec hash, stage, t, frame, camera) |
| `strikes/kick-feedback-hook.js` | Kick comparison context; user picks which panel (v6 / v7 / v8 / v8.1) |
| `ar-coach/feedback-hook.js` | AR coach context (shot, engine, mode, last stroke metrics + checks + phases, replay time, drill) |
| `deploy/modal_app.py` | Sink: `POST /api/feedback` writes `items/<day>/<id>.json` to Modal Volume `padel-feedback` (write-only over HTTP) |
| `feedback/tools/aggregate.py` | Records -> `fix_list.md` / `fix_list.json` grouped by stroke and version |

## Record

```jsonc
{
  "schema": "padel.feedback/1", "id": "uuid", "created": "ISO time",
  "app":     { "id": "strike-player | kick-compare | ar-coach", "version": "engine-v8 | v5 | kick_v7:v8.1 | release 2 · ar-coach-v14", "build": "engine.js?v=8", "page": "/padel/strikes/" },
  "subject": { "sport": "tennis", "stroke_id": "kick_serve", "stroke_name": "Kick serve", "family": "serve", "grip": "continental", "hand": "R",
               "spec_file": "strikes/specs/tennis.json", "spec_hash": "a0f46b33b9fb" },  // spec_hash = first 12 hex of SHA-256(JSON.stringify(technique))
  "moment":  { "t_s": 1.694, "t_contact_s": 1.16, "frame": 840, "frames": 1755, "stage_index": 6, "stage": "finish", "stage_label": "Finish", "cue": "…", "part": "slow", "camera": {…} },
  "extra":   { "panel": "v8.1", "engine": "onnx-rtmpose-s 0.1", "drill": null },
  "feedback": { "tags": ["elbow", "racket face"], "severity": "minor | major | broken", "text": "free text" },
  "attachments": { "screenshot": "data:image/jpeg;base64,… | null" },   // avatar frame ticked by default; camera frame (AR coach) only if the user ticks it
  "client":  { "anon": "8-char random per browser", "lang": "en-GB", "screen": "390x844", "dpr": 3, "touch": true, "ua": "…" },
  "url": "page URL with ?sport=&tech="
}
```

The spec hash pins the exact stroke definition: the aggregator recomputes it for every spec on disk, so each report says
whether it is about the **latest** spec, another spec still on disk (e.g. kick_v7 v8.1), or an older/unknown version.

## Where feedback goes

1. Always saved on the device first. Unsent items retry on every page load; **My feedback** lists them, **Export JSON** downloads them.
2. Sent to the Modal sink (`https://emreakarsu--padel-coach-web.us-east.modal.run/api/feedback`, or same-origin `/api/feedback` when the app runs on Modal).
   Until the sink is deployed, sending fails quietly and the item stays on the device.
3. If not sent, the user can tap **Send as GitHub issue**: a prefilled `[feedback]` issue on `emre-akarsu/padel` with the record as JSON (no screenshot).

## Reading it

```bash
modal deploy deploy/modal_app.py                               # once, from the repo root (gh-pages branch)
modal volume get padel-feedback items ./feedback_dump          # download all records
python feedback/tools/aggregate.py ./feedback_dump ~/Downloads/padel-feedback-*.json --github --out feedback/out
# -> feedback/out/fix_list.md (per stroke+version: tags, stages, every note with t/frame and a frame picture), fix_list.json
```

`--specs knowledge/ideal_strokes/v1/*.spec.json` lets it recognise ideal-stroke specs that live outside this repo.
