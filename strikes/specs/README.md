# Strike layer (v6): body + implements + grips + specs

A sport-agnostic layer for animating any racket or bat stroke on a rigged human.

**What each part does**
- **Specs** say *what* the stroke is.
- **The solver** decides *how* a human body does it, within joint ranges, with the implement held in a real grip.
- **`scripts/check.mjs`** gates every stroke and exits non-zero on failure.

```
web/
  solver.js                 loadLayer(), compileTechnique(), timeTable(), jointReport()  (no dependencies; browser + Node)
  body/rocketbox_female.json   bone map, joint ranges (ROM), pole rules, body capsules, skeleton file
  assets/skeleton.json      rest joint positions of the character (bone lengths are measured from it)
  implements/<id>.json      padel_racket, tennis_racket: model, handle axis/radius, butt, fist position, head, sweet spot
  grips/<id>.json           continental, eastern_fh, semi_western_fh, eastern_bh, two_handed_bh
  specs/<sport>.json        techniques: phases of targets + grip + ball + slow motion
scripts/check.mjs           the gate (ROM, grip gap, finger fit, racket-body collision, bone lengths, smoothness)
```

## Frame and units
- Y up. The player faces +Z (the net) at ready, and the player's right is -X.
- Metres, degrees, seconds.
- Specs are right-handed; the page mirrors the whole scene for left-handers.

## Body profile (`body/<id>.json`)
- **`bone_map`**: maps the solver's joints to your rig's bones (pelvis, spine, chest, neck, arms, legs, five fingers per hand).
- **`rom_deg`**: the joint ranges.
  - Elbow 2–145 (no hyperextension).
  - Forearm pronation ±85. `pronation_on_forearm` sets how much of it goes on the forearm bone, the rest on the hand.
  - Wrist flexion ±70; deviation 20 radial / 35 ulnar.
  - Shoulder rotation −80..120, horizontal extension 60, cross-body 45.
  - Trunk, neck, hips, knees and ankles.
- **`anchors`**: bones positioned in another bone's frame (Bip01 hangs the clavicles off the neck).
- **`body_capsules_m`**: capsules used for racket–body collisions.

Another character = its own skeleton file + a body file with its bone names.

## Implement (`implements/<id>.json`)
- The model frame has the handle along −Y (butt → head), the face normal along +Z, and its origin just beyond the butt cap.
- Fields:
  - `fist`: where the dominant fist's centre sits on the handle axis.
  - `sweet_spot`: the head centre.
  - `handle.radius`: used by the finger wrap.
  - `head`: half width / half height / thickness, used for collisions.
  - `model`: the glTF the page loads.

## Grip (`grips/<id>.json`)
- **`bevel_deg`**: rotates the face about the handle, measured from the eastern-forehand position (palm behind the strings).
- **`handle_tilt_deg`**: tilts the handle from the thumb-side axis toward the fingers (hammer grip).
- **`fist_offset_m`**: places the handle axis in the closed fist (`palm`, `along_fingers`).
- **`fingers`**: `"wrap"` solves every phalanx onto the handle surface.
- **`second_hand`** (optional): `{grip, along_handle_m, slide_m, roll_free_deg, opposite_face}` puts the other hand on the handle. The two-handed solve is a closed chain (see below).

The solver turns a grip into a **socket**: a fixed rotation `G` and offset `g` from the implement model into the hand frame, plus finger and thumb flexions. The racket is then `hand × G`, which makes it a rigid child of the hand bone.

## Technique phases (`specs/<sport>.json`)
```json
{ "id": "flat_serve", "name": "Flat serve", "family": "serve", "grip": "continental",
  "contact": {"phase": "contact"}, "slowmo": {"from": "racket_drop", "to": "follow_through", "rate": 0.25},
  "ball": {"in": {"vel": [0, -2.8, 0.05], "dur": 0.69}, "out": {"vel": [0.6, -3, 46], "dur": 0.45}},
  "phases": [ {"name": "contact", "t": 1.16, "cue": "Full reach, square face", "pose": {
      "pelvis": [x,y,z], "yaw": -22, "lean": 6, "chest_yaw": -4, "chest_roll": 10, "head_pitch": -24,
      "racket": {"center": [x,y,z], "dir": [x,y,z], "face": [x,y,z]},
      "r_pole": [x,y,z], "r_wrist": {"wflex": -10, "pron": 30},
      "l_arm": {"hand": [x,y,z], "dir": [x,y,z], "face": [x,y,z], "pole": [x,y,z]},
      "r_leg": {"foot": [x,z], "yaw": -70, "lift": 0.12}, "l_leg": {"foot": [x,z], "yaw": -35, "lift": 0.06},
      "two_hand": 0 } } ] }
```

Pose fields:
- **`racket`**: the sweet-spot centre, handle direction and face normal (either face). Matched exactly at contact; elsewhere it is a loose guide (about 6 cm, 30°).
- **`r_pole`**: where the elbow points.
- **`r_wrist`**: cues, for example a laid-back forehand (`wflex` −45), a firm volley, pronation through the serve (`pron` +30…+65).
- **Feet**: planted feet don't slide.
- `implement` can also be set per technique; otherwise the sport's default is used.

## How the solver works
1. **Key solve.** Each phase is solved as a bounded optimisation over the arm's 7 anatomical degrees of freedom: humerus azimuth and elevation, humeral rotation, elbow, pronation, wrist flexion and wrist deviation. Every one is boxed by its range of motion. The terms are:
   - racket position, face and direction
   - the wrist cues and the elbow pole
   - continuity with the neighbouring keys
   - racket clearance from the head and torso

   It uses multi-start plus a local pattern search. If a target can't be reached, the contact point moves; a joint never breaks.
2. **Interpolation.** Those seven joint parameters, the trunk and the pelvis follow C2 splines, soft-limited to their ranges. The legs are solved by IK to the planted feet. Every in-between frame is therefore anatomical, and the racket path comes out of forward kinematics.
3. **Via-keys.** If the racket passes through the body between keys, a key is inserted at that instant, solved clear of the body, and the stroke is re-splined.
4. **Two hands.** A closed chain, solved as dense coupled keys every 1/30 s: the dominant arm follows the racket path while the second hand must stay legally on the handle within its slide band, with joint acceleration penalised. Both arms are then splined.

## Gate
Run `node scripts/check.mjs [specs/<sport>.json]`. It exits with code 1 if any technique fails. Pass rules:
- 0 frames outside joint ranges (0.5° tolerance)
- dominant hand–handle gap ≤ 1 mm, second hand ≤ 5 mm
- fingers: penetration ≤ 2 mm, gap ≤ 6 mm
- racket–body clearance > 0
- bone lengths constant
- face/ball ≤ 65° at contact
- acceleration jump ≤ the earlier bandeja's (v4), seamless loop, planted feet ≤ 2 mm slide, slow-motion step ≤ v4

## Example: adding a tennis stroke (10 lines)
```js
// scripts/author.mjs, inside the tennis list; the templates write the phases (racket targets, poles, wrist cues, feet)
ground("inside_out_forehand", "Inside-out forehand",
  "Run around the backhand and hit the forehand cross-court from the left side.",
  { grip: "semi_western_fh", side: "fh", swing: "topspin", cy: 0.98, cz: 0.42, cx: 0.46, step: false, turn: 1.15,
    ball: { in: { vel: [-1.5, -2.0, -14.0], dur: 1.0 }, out: { vel: [3.5, 6.0, 21.0], dur: 0.8 } },
    cues: ["Ready", "Run round, unit turn", "Racket back, open stance", "Lag: racket drops below the ball",
           "Contact in front, low to high", "Brush up and across", "Finish over the left shoulder", "Recover"] }),
```
Then run `bash scripts/build_specs.sh`, which writes `specs/tennis.json` and gates everything. A stroke that fails the gate shows its reason.

A new sport = a new `specs/<sport>.json` (and an implement / grip JSON if the sport needs one). The page finds the file automatically.
