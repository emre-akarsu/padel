# Strike specs

Each sport is one file, `specs/<sport>.json`. Add a sport by dropping in a new file. On GitHub Pages the player finds it automatically through the public contents API. Elsewhere, add it to `index.json` or open `?sport=<sport>`.

## Frame
- Y is up. The player faces +Z (the net) at ready, and the player's right side is -X.
- Units: metres, degrees, seconds.
- Specs are right-handed; the page mirrors the scene for left-handers.

## File
```json
{
  "sport": "padel", "name": "Padel",
  "implement": { "type": "racket", "model": "padel|tennis", "length": 0.455, "head": [0.26, 0.29], "grip_offset": 0.33 },
  "ball": { "radius": 0.0335, "restitution": 0.75 },
  "court": { "net_z": 6.95, "net_h": 0.88, "width": 10, "length": 20, "color": 1964454, "walls": true, "lines": [[x0, z0, x1, z1, width?]] },
  "techniques": [ {
    "id": "vibora", "name": "Víbora", "family": "overhead", "handed": "R", "summary": "…",
    "contact": { "phase": "contact" },
    "slowmo": { "from": "racket_drop", "to": "follow_through", "rate": 0.25, "ramp": 0.45 },
    "trail": { "from": "preparation", "to": "finish" },
    "ball": { "in": { "vel": [vx, vy, vz], "dur": 1.1 }, "out": { "vel": [vx, vy, vz], "dur": 0.6 } },
    "ar": "ar/padel_vibora.usdz",
    "phases": [ { "name": "ready", "label": "Ready", "t": 0.0, "cue": "subtitle text", "pose": { … } } ]
  } ]
}
```

Field notes:
- **`grip_offset`**: distance from the wrist to the racket's sweet spot. It is used for the trail and for where the ball meets the face.
- **`ball`**: the ball's velocity **at contact**. The incoming path is integrated backward and the outgoing path forward, with gravity and bounces. Both are anchored to the solved racket face, so the ball always meets the racket, whatever the pose or the contact-height slider.
- **`slowmo`**: an eased (C2) speed ramp from `from` to `to` at `rate`. `ramp` is the ease length in real seconds.

## Phase pose (targets, solved by IK)
```json
{
  "pelvis": [x, y, z], "yaw": 0, "lean": 8, "chest_yaw": 0, "chest_roll": 0, "head_pitch": -4,
  "r_arm": { "frame": "world", "hand": [x, y, z], "head": [x, y, z], "face": [x, y, z], "pole": [x, y, z] },
  "l_arm": { "frame": "world", "hand": [x, y, z], "head": [x, y, z], "face": [x, y, z], "pole": [x, y, z] },
  "r_leg": { "foot": [x, z], "yaw": -8, "lift": 0 }, "l_leg": { "foot": [x, z], "yaw": 8, "lift": 0 },
  "two_hand": 0
}
```

Pose fields:
- **`hand`**: the wrist position.
- **`head`**: a point the racket points at from the wrist, so racket direction = `head - hand`.
- **`face`**: the racket face normal hint.
- **`pole`**: where the elbow points.
- **`lift`**: heel lift. A foot that keeps the same values from one phase to the next stays planted.
- **`two_hand`**: 1 puts the free hand on the handle.
- **Reference port:** limbs can instead be given as gen.py segment directions, `{"dirs": [[upper], [fore], [hand]]}` for arms or `{"dirs": [[thigh], [shin]]}` for legs. The bandeja uses this, unchanged from v1–v4.

## Interpolation
- IK runs only at the phase keys.
- Between keys, every body segment's rotation follows a clamped C2 cubic spline per quaternion component, normalised. That gives continuous velocity and acceleration, with zero velocity at the loop ends.
- Planted feet use a monotone cubic, so they never slide.
- The legs are re-solved to the feet each frame, using the knee direction from the interpolated thigh.
- The pelvis lowers smoothly if a stance would over-stretch a leg.
- `scripts/check.mjs` checks every technique against the v4 bandeja's smoothness.
