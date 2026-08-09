# Sketch Layer Refactor — Design & Implementation Plan

Status: **phases 0–9 complete, 10 in progress (10.1 and 10.2 done)**, on
branch `refactor/sketch-layer`
The Sketch/Route split is live, every coordinate is solver-owned, and
arcs are real constrainable entities. `follow_path`, the old route tools,
the segment/node side panels and `RP.selectedSegment` are all gone.
Phases 4+ **re-planned** after phase 3 — routes are now reference-only
over sketch geometry, with a hard sketch/route mode split (§4, §7).
**Phase 10** (§10) makes a route an ordered list of ACTIONS rather than
one-move-per-line, so turns become selectable, parameterised objects
anchored to the junction point they happen at.
Goal: replace ad-hoc construction/route geometry with a real 2D parametric
constraint solver, and split the app into clean layers.

Run the tests with `node tests/run.js`.

---

## 1. Target architecture

Four layers, each ignorant of the ones above it.

```
┌─────────────────────────────────────────────────────────┐
│ UI          render, events, constraint palette, panels  │
├─────────────────────────────────────────────────────────┤
│ CODEGEN     steps  →  template emit                     │
├─────────────────────────────────────────────────────────┤
│ MODEL       construction semantics │ route = ORDERED    │
│             (label, visible)       │ REFERENCES to      │
│                                    │ entities + moves   │
├─────────────────────────────────────────────────────────┤
│ SKETCH      entities + constraints + solver             │
│             knows NOTHING about construction vs route   │
│             OWNS EVERY COORDINATE                       │
└─────────────────────────────────────────────────────────┘
```

The sketch layer's entire vocabulary is: points, lines, arcs, circles,
constraints between them. It has no concept of "construction line" or
"route segment" — those are *model-layer tags on sketch entity ids*.

The single invariant everything else follows from: **only the sketch
layer writes coordinates.** Routes reference geometry; they never own or
move it (§4). Anything that needs to move a point does so by adding a
constraint or dragging through the solver.

### File layout

```
js/
  core.js                state, dom refs, zoom/pan, undo, geometry primitives
  sketch/
    linalg.js            dense LU solve, rank, matrix helpers      (~140 lines)
    sketch.js            Sketch facade: entities, param packing    (~250 lines)
    constraints.js       registry + v1 constraint definitions      (~300 lines)
    solver.js            Levenberg-Marquardt, DOF, drag solve      (~200 lines)
  model/
    construction.js      construction-geometry semantics
    route.js             route graph semantics
    resolver.js          route validation + linearization
  codegen/
    steps.js             computeSteps
    emit.js              generateCode / template rendering
  ui/
    render.js
    events.js
    sketch-ui.js         selection, constraint palette, badges, DOF readout
    panels.js            robot + code config  (was config.js)
  persist.js
  main.js
```

Script load order (no ES modules — the app runs from `file://` on a UNC
share, so `import` is off the table; keep the `var RP = window.RP || {}`
namespace pattern):

```
core.js
sketch/linalg.js  sketch/sketch.js  sketch/constraints.js  sketch/solver.js
model/construction.js  model/route.js  model/resolver.js
codegen/steps.js  codegen/emit.js
ui/render.js  ui/events.js  ui/sketch-ui.js  ui/panels.js
persist.js
main.js
```

---

## 2. Sketch data model

### Entities

| Type     | Own params      | References                   | Internal equations |
|----------|-----------------|------------------------------|--------------------|
| `point`  | `x`, `y`  (2)   | —                            | 0                  |
| `line`   | none            | `p1`, `p2` (point ids)       | 0                  |
| `arc`    | none            | `center`, `p1`, `p2`, `ccw`  | 1 — equal radius   |
| `circle` | `r`  (1)        | `center`                     | 0                  |

Only **points carry positional parameters**. Lines and arcs are pure
topology over points. This is what makes constraints composable: an arc
endpoint is a real point you can make coincident with a line endpoint.

The arc's internal equation is `|p1 − c| − |p2 − c| = 0` (both endpoints
equidistant from centre). Radius is *derived*, not stored, which keeps
arcs constrainable without a redundant parameter.

```js
{ id: 7, type: 'line', p1: 3, p2: 4 }
{ id: 3, type: 'point', x: 120.5, y: 88.0 }
{ id: 9, type: 'arc', center: 5, p1: 4, p2: 6, ccw: true }
```

### Constraints — v1 set

| Name            | Args                        | Eqs | Residual                                        |
|-----------------|-----------------------------|-----|-------------------------------------------------|
| `coincident`    | pA, pB                      | 2   | `ax−bx`, `ay−by`                                |
| `point_on_line` | p, line(a,b)                | 1   | `(bx−ax)(py−ay) − (by−ay)(px−ax)`               |
| `horizontal`    | line(a,b)                   | 1   | `ay − by`                                       |
| `vertical`      | line(a,b)                   | 1   | `ax − bx`                                       |
| `distance`      | line(a,b) \| pA,pB — value  | 1   | `hypot(bx−ax, by−ay) − L`                       |
| `angle`         | lineA, lineB? — value       | 1   | `wrap(atan2(cross, dot) − θ)`                   |
| `fix`           | p                           | 2   | `px − x₀`, `py − y₀`                            |

`fix` is **not** on the original minimum list but is required — see
objection 2. `angle` with one line measures against +X.

### Tangency comes in two forms

| Name         | Args                | Meaning |
|--------------|---------------------|---------|
| `tangent`    | line, arc           | the centre stands one radius off the line, with the SIDE captured at creation |
| `tangent_at` | line, arc, point    | `(p − c)·û = 0` — the radius at that end is perpendicular to the line |

`tangent_at` is what auto-tangency and the palette produce whenever the
two already meet at a point, and it exists because the side capture in
`tangent` makes whole regions of the sketch unreachable: the arc can
never flip, so dragging an end far enough forces the solver to push the
centre through the line, which it cannot do, and the sketch goes red and
stays red. Stating tangency at the shared point removes the sign
entirely. It is also far better conditioned — the same drag settles in 3
iterations instead of 16–30.

A tangent arc still cannot change sides *continuously* (the centre would
travel through infinity, flattening the arc on the way), so
`Sketch.rescueFlatArcs` re-seeds the centre from the closed form
`R = |q−p|² / 2|(q−p)·n̂|` when a radius runs away. The solver keeps the
guess only if it satisfies the sketch better.

### Extension points — designed for, not implemented

`parallel`, `perpendicular`, `equal`, `symmetric`,
`point_on_arc`, `radius`, `point_line_distance`, arc-to-arc tangency.

Each is a registry entry, so adding one is a self-contained ~20-line
addition with no changes to the solver:

```js
RP.Sketch.registerConstraint('parallel', {
  entities: ['line', 'line'],
  equations: 1,
  hasValue: false,
  residual: function(c, g, out, row) { /* cross(u,v) = 0 */ },
  jacobian: function(c, g, J, row) { /* … */ },
  label:  'Parallel',
  glyph:  '∥'
});
```

### Analytic Jacobians

All derivatives are closed-form — no numerical differentiation.

**point_on_line**, `f = (bx−ax)(py−ay) − (by−ay)(px−ax)`

```
∂f/∂px = −(by−ay)        ∂f/∂ax = (by−ay) − (py−ay)
∂f/∂py =  (bx−ax)        ∂f/∂ay = (px−ax) − (bx−ax)
                         ∂f/∂bx =  (py−ay)
                         ∂f/∂by = −(px−ax)
```

**distance**, `f = d − L`, `d = hypot(dx,dy)`, `dx = bx−ax`

```
∂f/∂bx =  dx/d    ∂f/∂ax = −dx/d
∂f/∂by =  dy/d    ∂f/∂ay = −dy/d
```
Guard `d < ε` (fall back to an arbitrary unit direction).

**angle**, `u = b−a`, `v = d−c`, `C = cross(u,v)`, `D = dot(u,v)`,
`f = atan2(C, D) − θ`. Note `C² + D² = |u|²|v|²`.

```
∂f/∂ux = ( D·vy − C·vx) / (C²+D²)      ∂f/∂bx = +∂f/∂ux,  ∂f/∂ax = −∂f/∂ux
∂f/∂uy = (−D·vx − C·vy) / (C²+D²)      ∂f/∂by = +∂f/∂uy,  ∂f/∂ay = −∂f/∂uy
∂f/∂vx = (−D·uy + C·ux) / (C²+D²)      (and mirrored onto c,d)
∂f/∂vy = ( D·ux + C·uy) / (C²+D²)
```

Residual must be wrapped into `(−π, π]` so the solver takes the short way
round.

---

## 3. Solver

Levenberg-Marquardt on the constraint residual vector.

```
assemble r (m×1), J (m×n)
solve  (JᵀJ + λ·s·I) Δ = −Jᵀr,  s = max diag(JᵀJ)   ← dense LU, n×n
x += Δ
if |r| improved:  λ /= 3,  accept
else:             revert,  λ *= 4
converged when |r|∞ < 1e-9;  bail at 60 iters or λ > 1e12
```

`n` is small (a busy WRO sketch is maybe 60 points = 120 params), so a
dense normal-equation solve is microseconds. No sparse machinery needed.

### Damping must be uniform, not per-parameter

Marquardt's classic `λ·diag(JᵀJ)` is **wrong for this problem** — this was
found during phase 3, after phase 1's well-conditioned tests missed it.
Sketches are routinely rank-deficient, and scaling damping by each
parameter's own gradient amplifies the weakly-constrained directions. A
single distance constraint on a near-horizontal line yields a step of
`r/(4·g_y)` in y — hundreds of pixels — which breaks the linearisation,
gets rejected, and ratchets λ upward until the solve stalls at maxIter.

Uniform damping scaled by the largest diagonal gives the minimum-norm
step, which moves along the gradient as intended. Pinned by a regression
test in `tests/sketch.js`.

### Row weighting (important)

Positions are in image pixels (range ~2400); angles are radians (~1).
Mixing those rows makes `J` badly conditioned and the solver will
mysteriously stall. Every constraint declares a row scale:

- positional equations → weight `1`
- angle equations → weight `L_char` (≈ image diagonal / 10)

### DOF and diagnosis

`rank(J)` via Gaussian elimination with partial pivoting,
tol `= 1e-9 · max|J|`.

| State             | Condition                      | UI colour |
|-------------------|--------------------------------|-----------|
| under-constrained | converged, `DOF = n−rank > 0`  | white     |
| fully constrained | converged, `DOF = 0`           | green     |
| redundant         | converged, `m > rank`          | orange    |
| conflicting       | not converged                  | red       |

v1 reports the *aggregate* state only — it will not pinpoint which
constraint is redundant (see objection 9).

### Dragging

The dragged point's params are **removed from the free set** and held at
the cursor; the solver runs on the remainder. This is what makes dragging
feel like FreeCAD. If that fails to converge, retry with the point back in
the free set plus a soft `fix` (weight 0.1) so the drag degrades
gracefully instead of exploding.

---

## 4. Routes as references (revised design)

**Routes do not own geometry.** A route is an ordered list of references
to sketch entities, plus the movement semantics for each. The sketch is
the single source of truth for every coordinate, unconditionally.

This replaces the original plan of merging route nodes into the solver.
It is strictly better: the old plan had two systems both writing
positions (the solver, and `applyWallAlignSnap` writing `node.x/y`), and
phase 4 existed to reconcile them. Here the conflict cannot arise.

It is also the standard CAM pattern — sketch geometry, then toolpaths
that reference it.

### Two modes

`RP.editMode` is `'sketch'` or `'route'`, and the distinction is hard:

| | Sketch mode | Route mode |
|---|---|---|
| edits | points, lines, arcs, constraints | element order, move type, parameters |
| creates geometry | yes | **no** |
| routes shown | dimmed, inert | active |
| geometry | fully editable | visible, selectable, **not movable** |

Route mode is strictly reference-only: you select existing geometry and
say what the robot does along it. Drawing lives entirely in sketch mode.

### Element model

Every element references **exactly one** sketch entity (line or arc).
Uniformity matters more here than saving a field — teleports reference a
line too, where the line is simply the visual indicator of the jump.

```js
{ id, entityId,
  move: 'forward'|'arc'|'linetrace_dist'|'linetrace_junct'|'wall_align'|'teleport',
  flip,            // travel p2->p1 instead of p1->p2
  reverse,         // robot drives backwards (chassis orientation)
  speed, offset, junctions, teleportName,
  extraTurnsBefore: [],
  checkpoint       // reached at the END of this element
}
```

`flip` and `reverse` are deliberately separate in the MODEL, because the
resolver needs both. They were previously conflated through
`storedForward` XOR `direction`.

**`flip` is never exposed in the UI.** It is a consequence of the chain,
not a choice: element N must enter through whichever end touches element
N−1's exit, so there is exactly one valid value. Exposing it as a toggle
meant the only thing a user could do with it was break connectivity —
and reordering, which never recomputed it, broke routes silently.
`RP.recomputeFlips(route)` now maintains it after every append, reorder
and removal.

The one genuine freedom is which end the whole route starts from, which
is `RP.reverseRouteDirection()` — reverse the element order and flip
every element. Per-element `reverse` (drive tail-first over the same
endpoints) stays, because that is a real mechanism decision, and it is
deliberately NOT touched by reversing the path.

`route.startCheckpoint` covers a checkpoint at the very start.

### Continuity via the constraint graph

Consecutive elements must meet end-to-start. Rather than comparing
coordinates with a tolerance, build a **union-find over `coincident`
constraints**: two points are "the same place" if they share a point
entity or sit in the same coincident cluster.

Continuity then becomes a property the solver already maintains, and a
broken route reports exactly which junction is open. This is the same
union-find already used by the legacy line migration.

### Keeping one-step route creation cheap to add later

Strict separation is the chosen design, but it must stay cheap to relax.
The rule that guarantees this:

> **Route-element creation is a model-layer function taking an entity id,
> never a mouse event.**

Geometry creation is already `RP.addConstructionLine(...)`. So one-step
creation, if ever wanted, is a thin composite of two existing calls:

```js
RP.drawRouteLine = function(x1, y1, x2, y2, snapOpts, moveOpts) {
  var made = RP.addConstructionLine(x1, y1, x2, y2, snapOpts);
  return RP.addRouteElement(RP.activeRouteId, made.line.id, moveOpts);
};
```

Nothing else may assume the two happen separately: no event-handler
logic inside either creator, and no route state touched by the sketch
layer.

### wall_align stops being a special case

Field walls become **preset, `fix`-ed sketch geometry** shipped with the
map. A `wall_align` element references a line whose far endpoint is
constrained to a wall line at the robot's clearance distance. The
position is solved like everything else, and `RP.applyWallAlignSnap` —
which today writes `node.x/y` directly — is deleted.

Note `linetrace_junct` legitimately has no geometrically determined
endpoint: the robot stops after N junctions. Its geometry is nominal,
expressing intent. That is fine, but the UI should not imply the
position is authoritative.

---

## 5. Serialization

Bump to `version: '4.0'`.

```jsonc
{
  "version": "4.0",
  "sketch": {
    "entities":    { "1": {"id":1,"type":"point","x":10,"y":20}, "…": {} },
    "constraints": { "1": {"id":1,"type":"coincident","refs":[2,5]} },
    "nextEntityId": 42, "nextConstraintId": 17
  },
  "construction": { "12": { "label": "wall A", "visible": true } },
  "field":  { "preset": "wro-2026-senior", "wallLineIds": [3, 5, 7, 9] },
  "routes": [ {
    "id": 1, "name": "Run A", "visible": true,
    "startCheckpoint": null,
    "elements": [
      { "id":1, "entityId":12, "move":"forward", "flip":false,
        "reverse":false, "speed":300, "offset":-10, "checkpoint":"grab" }
    ]
  } ]
}
```

**Migration.** v3 (phase 2) already carries a real sketch, so only routes
need converting: for each old route node create a point, for each old
segment create a line, then emit one element per segment carrying the old
`mode`/`speed`/`offset`/`junctions`. Add `coincident` constraints where
segments shared a node — that is what preserves continuity. Nothing else
is inferred. v1/v2 files migrate their lines first, exactly as now.

Old files must open and generate byte-identical code; the golden suite is
what proves it.

---

## 6. Interaction model (the "FreeCAD feel")

The solver is invisible; this layer is what the user actually judges.

- **Selection**: click to select an entity or point, shift-click to add.
  Selected set drives which constraint buttons are enabled.
- **Palette** with FreeCAD-ish keys: `C` coincident, `H` horizontal,
  `V` vertical, `K,D` distance, `K,A` angle, `L` lock/fix.
  Buttons grey out when the selection doesn't match the constraint arity.
- **Badges** drawn on canvas: `H`/`V` glyphs near the line midpoint,
  dimension lines with the value for distance/angle, small dots for
  coincident, a padlock for fix.
- **Dimension editing**: click a dimension value → inline input → re-solve.
- **DOF readout** in the info bar: `DOF: 4` / `Fully constrained` /
  `Conflicting constraints`, with the matching entity colour state.
- **Constraint list panel**: grouped by entity, click to highlight,
  `✕` to delete. Also right-click an entity → its constraints.
- **Auto-constraints** from the existing snap system, toggleable: endpoint
  snap → `coincident`, along-line snap → `point_on_line`, 90° snap →
  `horizontal`/`vertical`. Snap remains a *drawing aid* that offers
  constraints; it never becomes the constraint system (objection 7).

---

## 7. Phases

Every phase leaves the app shippable. Strangler-fig: the new layer grows
alongside the old one behind adapters, and the old paths are deleted last.

| # | Phase | Ships | Risk |
|---|-------|-------|------|
| 0 | ✅ **Safety net.** Branch + Node test harness (`tests/harness.js` loads the browser app into a `vm` context with DOM stubs). `tests/golden.js` diffs `generateCode` over 7 fixtures; `tests/boot.js` loads every script `index.html` references. | no behaviour change | — |
| 1 | ✅ **Solver core, isolated.** `js/sketch/{linalg,sketch,constraints,solver}.js` + 16 unit tests. Wired into `index.html` but nothing calls it yet. | dead code, app untouched | low |
| 2 | ✅ **Sketch owns construction geometry.** `js/model/construction.js`; `RP.lines` is a rebuilt read-only view; `computeSnap` now also returns the snapped feature's identity; auto-constraints on draw; persist v3 write + legacy read; undo carries the sketch. 16 tests. | construction lines now hold relationships | med |
| 3 | ✅ **Constraint UI.** New `constrain` tool; `js/ui/sketch-ui.js`; selection + shift-select, palette with keyboard shortcuts, canvas badges, DOF readout, status colouring, dimension editing, constraint list, point dragging. Also fixed uniform-damping solver bug and the drag-undo off-by-one. 17 tests. | the "FreeCAD feel" milestone | med |
Phases 4+ were **re-planned** after phase 3, when routes moved to a
reference-only model (§4). The old phase 4 — merging route nodes into the
solver — no longer exists; routes stop owning positions instead.

| # | Phase | Ships | Risk |
|---|-------|-------|------|
| 4 | ✅ **Route model becomes references.** `js/model/route.js`: elements referencing sketch entities, `flip`/`reverse` split, `addRouteElement(routeId, entityId, opts)` as a pure model call. Migration from node/segment routes. `applyWallAlignSnap` deleted. `nodes`/`segments` kept as derived read-only views so render/panels survive until phase 6. | data model | med |
| 5 | ✅ **Resolver + codegen on elements.** `model/resolver.js`: ordered-chain validation via the coincident union-find, naming the open junction. `computeSteps`/`generateCode` consume elements; broken routes emit a visible warning. Golden suite byte-identical through migration. 18 tests. | broken routes error loudly | med |
| 6 | ✅ **Mode switching + route mode UI.** `js/ui/route-ui.js`: `RP.editMode`, Sketch/Route switch, tool group hidden in route mode, routes dimmed in sketch mode and geometry dimmed to a guide in route mode, click geometry to append (auto-picking the connecting direction), element list, movement-parameter panel, reorder/remove. Old route/freehand/arc/checkpoint tools removed from the UI. 14 tests. | the two-mode design | high |
| 7 | ✅ **Preset field geometry + wall_align as a constraint.** New `point_line_distance` constraint (shares its maths with `point_on_line`, which is the same thing with target 0). `RP.createFieldBoundary()` builds four rigid walls from four pinned corners. Setting an element to `wall_align` constrains its exit point to stand `clearance` off a wall — signed, so the side is kept — and clearance changes re-solve. 14 tests. | wall_align stops being magic | med |
| 8 | ✅ **Arcs in the sketcher.** `point_on_arc`, `radius` and `tangent` constraints; arc tool (drag the chord, then drag the centre); arc view + rendering; arcs are selectable, snappable and constrainable. Route elements can reference arcs and are forced to an arc move. Old `sagitta` arcs migrate into real arc entities with byte-identical codegen; `arcPolyline` and the bulge handle are deleted. 15 tests. | curves | med |
| 9 | ✅ **Cleanup.** First pass deleted the freehand/route/checkpoint tool handlers, the whole `follow_path` subsystem (helpers, config, UI, codegen branch, rendering), the sagitta bulge handle, and ~20 orphaned functions. Second pass finished the job: the segment and node side panels, `RP.selectedSegment` / `RP.selectedNode`, the six node/segment mutators, the layer list's segment sub-rows, and the context menu's node/segment branches — all of which wrote to `route.nodes` / `route.segments`, derived read-only views whose writes vanished on the next rebuild. Also fixed `#ctx-menu` being declared below the `<script>` block, which made `getElementById` return null and had silently disabled the right-click menu. 7875 → 6718 lines; `events.js` 1335 → 807. 2 new boot tests. | right-click menu starts working | low |

**Effort shape**: phases 1 and 3 were the bulk of the solver/UI work, and
phase 6 the bulk of the rest. Phase 4 was never the risky one — that risk
was designed out — but phase 6 took its place, because it is where the two
modes and all existing tool behaviour had to be reconciled.

**Known gap after phase 9**: `element.turnSpeed` and
`element.extraTurnsBefore` are read by codegen and covered by the golden
suite, but nothing in Route mode's element panel edits them. The node
panel that used to was writing to a derived view, so the capability was
already broken when it was deleted; restoring it means adding the two
fields to `updateElementParams`.

**Reversibility constraint** (§4): nothing in phases 4–6 may entangle
route-element creation with event handling, so that one-step route
creation stays a small composite if the strict separation is ever
relaxed.

---

## 8. Objections & open decisions

See the accompanying discussion. Summary of what needs a decision:

1. **Skip `numeric.js`** — dead since ~2014, ~50 KB, and we need only a
   dense LU solve + rank. A ~140-line `linalg.js` is *less* code than the
   vendored library. → recommend writing our own.
2. **Add a `fix`/lock constraint to v1** despite it not being on the
   minimum list. Without an anchor the sketch has 3 free global DOF and
   drifts under dragging; and geometry is meant to be pinned to a fixed
   mat image. 2 equations. → recommend including.
3. **`wall_align` collides with solver-owned positions.** It currently
   writes `node.x/y` directly (`routes.js:412`). Options: (a) model as a
   real `point_line_distance` constraint against field-wall lines that
   are themselves fixed sketch geometry; (b) keep it a codegen-time
   derived value and never store the position; (c) flag the node
   solver-driven/read-only. → recommend (a); it also turns the field
   boundary into proper sketch geometry.
4. **Drop longest-path search.** Longest simple path is NP-hard in
   general graphs; if branching is an error then the valid input is a
   simple path and the answer is trivially the whole path. → recommend
   validate-and-linearize, keep a shim for old branchy saves.
5. **Add explicit `route.startNodeId`.** Start is currently implicitly
   `route.nodes[0]`, which is fragile and unflippable.
6. `point_on_line` is point-on-**infinite**-line — equality constraints
   cannot express "within the segment". FreeCAD behaves the same. Noted,
   not fixed.
7. **Keep snap and constraints as separate systems** — snap offers
   auto-constraints on commit; it does not become the constraint system.
8. **Row weighting for mixed px/radian units** or the solver will stall.
9. **Redundancy diagnosis is coarse in v1** — aggregate state only.
   Pinpointing the culprit constraint needs QR with column pivoting or
   SVD; defer.
10. **Undo must snapshot params *and* constraints**, and must not
    re-solve on restore (restored positions are already consistent).
11. Dense sampled polylines never enter the solver — only their
    endpoints. Moot now that `follow_path` is deprecated, but the rule
    stands.

---

## 9. Licensing

All-custom solver means no GPL entanglement (the concern with
SolveSpace's `libslvs`) and no dependency on jsketcher's entity model.
The maths is public — Gauss-Newton/LM on a constraint Jacobian is
textbook (Kramer, *Solving Geometric Constraint Systems*, MIT Press 1992).

---

## 10. Actions (phase 10)

Phases 4–9 left a route as *one move per piece of geometry*. Turns did
not exist as objects: `computeSteps` derived each one from consecutive
headings and billed it to whichever element came next, so `el.turnSpeed`
meant "the speed of the turn BEFORE this line". That is why turns could
not be selected and why turn parameters were awkward to reach —
`extraTurnsBefore`, `endExtraTurns` and `startCheckpoint` were all
workarounds for the same missing concept.

### 10.1 Model ✅

A route is `route.actions`, an ordered list where each action references
the sketch entity that suits it:

| Action | References | Derived from the sketch | Stored on the action |
|--------|-----------|-------------------------|----------------------|
| `move` | line or arc | distance, radius, sweep, entry/exit headings | move mode, flip, reverse, speed, offset, junctions, teleport name, checkpoint |
| `turn` | **point**   | the angle, from the headings either side | angleMode, angle override, speed, style |
| `checkpoint` | **point** | — | name |

The §1 invariant is untouched: an action stores a reference and the
parameters that cannot be derived, never a coordinate.

**The auto-turn invariant.** `syncTurnActions(route)` keeps exactly one
`auto` turn immediately before every move. It is created and destroyed
with its move; `fixed` turns are user-owned and sync never touches them.
Re-matching on resync is positional first, then by coincidence cluster,
which is what makes a reorder or a reversal carry each junction's speed
and style along with it. It is idempotent, so `rebuildRouteViews` can
re-establish it on every refresh rather than every mutating call site
having to remember.

The leading auto turn, in front of the *first* move, looks redundant and
is not: with a start position set it is the turn from the robot's start
heading onto the first leg. With none it resolves to nothing.

**Turn styles.** `spin`, `pivot_left`, `pivot_right` are physically
different manoeuvres, so each maps to its own code template. The pivot
templates default to blank and fall back to `turnTemplate`, so adding
styles cannot change existing output.

**Unknown headings are explicit.** `resolveTimeline` reports
`entryHeading`/`exitHeading` as `null` where the planner genuinely cannot
know them — a teleport arrives pointing somewhere nothing can predict.
Auto turns against a null heading resolve to nothing instead of being
silently skipped mid-loop, which is what the old code did.

**angleMode is ownership, not provenance.** `auto` is the junction turn
the invariant maintains; `fixed` is a standalone turn the user inserted.
The angle itself is `angle`: `null` derives it from the geometry, a
number overrides it. An overridden junction turn therefore stays `auto`
and stays owned by its move — flipping it to `fixed` would leave sync
free to add a SECOND turn at the same corner, and double the robot's
rotation.

**Compat.** `route.elements` is a rebuilt array of the LIVE move actions,
not copies, so the resolver, `recomputeFlips` and the route-mode panel
keep working and keep writing to the real model. It is not persisted.
Save format is v5; v4 (`elements`) and older lift through
`liftElementsToActions`, and all seven golden fixtures still produce
byte-identical code.

### 10.2 UI ✅

- **Selection is an action of any type.** `RP.selectedActionId` is the
  state; `selectedElementId` survives as an accessor that reads through
  only when the selection really is a move, so selecting a turn correctly
  un-highlights every segment.
- **`routeHitTest` returns point-anchored actions first.** They are small
  targets and the line underneath is always reachable a few pixels away.
  Several actions can share one junction, so clicking again advances
  through them instead of sticking on the first.
- **The element list is an action list**, turns and checkpoints indented
  under the move they lead into. A junction turn that emits nothing and
  carries no settings is hidden — a straight joint, or the leading turn
  with no start position — and reappears the moment it matters or is
  selected.
- **Per-type panels.** A turn gets Derived/Typed, degrees, speed and
  style; a checkpoint gets its name; a move keeps what it had.
- **Canvas markers.** Each turn draws at its junction as a sweep arc from
  the incoming heading to the outgoing one, with the angle, an asterisk
  when typed, and a white ring when selected. Turns that emit nothing
  draw a hollow dot so the junction is still clickable.
- **`computeSteps` tags every step with its `actionId`**, so the list and
  canvas read what was actually emitted instead of re-deriving the walk
  and drifting from it.
- Checkpoints became their own action type; `el.checkpoint` and
  `route.startCheckpoint` are gone. The move panel keeps a Checkpoint
  field, routed through `setMoveCheckpoint`.

### 10.3 Cleanup (not started)

Delete the `route.elements` compat view and rename the element-era calls
(`addRouteElement`, `setRouteElementProps`, …) to their action names.
