# Changes — 2026-08-09 (8)

## Portable single-file build

`node build.js` → `dist/wro-planner.html`, one self-contained ~320 KB
file. Copy it to a USB stick, double-click, done — no install, no admin
rights, nothing for a school laptop's policy to block.

`build.js` has no dependencies and never will. It reads `index.html`,
replaces the stylesheet link and each `<script src>` with the file's
contents, and writes the result. Load order comes from `index.html`,
because that is the only place it is defined. Nothing is minified: the
output is the thing you hand to a teammate, and being able to open it in
an editor and read real code beats shaving 100 KB off a file that already
fits on a floppy disk.

The 2.6 MB sample mat photo is deliberately **not** embedded — it is a
sample, and you load your own.

This also makes the README true again. It has claimed "a single
self-contained HTML file" since before the code was split into modules.

### Verified from `file://`, not assumed

Loading `dist/wro-planner.html` straight off disk in Chromium:

| | |
|---|---|
| boots, all 9 tool buttons wired | ✅ |
| `isSecureContext` | **true** — so *Copy Code* works |
| `localStorage` | **works** — *Save Map* wrote and read back 31 KB |
| Export Project download | ✅ real download fired |
| draw → constrain → route → generate code | ✅ identical output |
| console errors | none |

One finding worth knowing, and now in the README: `localStorage` on
`file://` belongs to the **browser, not the file**. Saved maps survive a
reload but do **not** travel with the HTML, and they are shared with any
other local page opened in that browser. *Export Project* is what moves
between machines — which is what the `.json` export was always for.

### Kept honest

New `tests/build.js` (6 checks) runs the real build and then boots its
output the same way `boot.js` boots the loose sources:

- nothing is left to fetch from disk
- every source `index.html` references is actually in the bundle
- the bundle boots and its solver solves
- **the bundle generates byte-identical code to the loose sources** for
  all seven golden fixtures — otherwise the file people carry around is
  not the thing the rest of the suite has been testing
- a source containing `</script>` fails the build loudly instead of
  silently truncating the bundle, which is the one way this could ship
  something that looks fine and is broken

`loadApp` now takes either paths or `{ name, code }`, so the bundle's
inlined scripts boot through the same harness without being written back
to disk.

`dist/` is gitignored — rebuild with one command. Un-ignore it if you
would rather the built file be downloadable straight from the repo.

---

# Changes — 2026-08-09 (7)

## Phase 10.3 — one name for one thing

The last of the action refactor. 10.1 and 10.2 left `route.elements` as a
rebuilt array aliasing the live move actions, so everything written
before actions kept working. That compat layer is now gone, along with
the element-era vocabulary that came with it — "element" and "action"
both meaning *move action* is exactly the double naming that made the
node/segment era confusing enough to need phase 9.

### Renamed

| was | now |
|-----|-----|
| `addRouteElement` | `addMove` |
| `removeRouteElement` | `removeMove` |
| `setRouteElementProps` | `setMoveProps` |
| `moveRouteElement` | `reorderMove` |
| `findElement` | `findMove` |
| `elementEndpoints` | `moveEndpoints` |
| `getSelectedElement` / `selectedElementId` | `getSelectedMove` / `selectedMoveId` |
| `updateSelectedElement` / `removeSelectedElement` / `reorderSelectedElement` | …`Move` |
| `updateElementParams` | `updateActionParams` |
| `migrateRoutesToElements` | `migrateRoutesToActions` |
| `nextElementId` | `nextActionId` |
| `resolveRoute() → { elements: [{ element, … }] }` | `→ { moves: [{ move, … }] }` |
| `#element-list`, `#element-params`, `.elp` | `#action-list`, `#action-params`, `.ap-row` |
| `routeHitTest` kind `'element'` | `'move'` |

### Deleted

`route.elements` is no longer built. Callers use `RP.moveActions(route)`.
The name now means exactly one thing — **this route came out of a v4 save
file** — which makes the migration guard unambiguous instead of relying
on checking `.actions` first.

`route.startCheckpoint` had been a vestigial `null` on every new route
since checkpoints became actions in 10.2. Gone, so a route persists as
just `actions, id, name, visible`.

### One real bug this could have shipped

The blanket rename hit the save-file keys as well, so `nextElementId`
became `nextActionId` on the *read* side too — and any project saved
before this change would have loaded with its id counter reset to 1,
handing out ids that already existed. Both readers now fall back:
`nextActionId || nextElementId`, and `nextIds.action || nextIds.element`.

### Verification

10 suites pass, goldens byte-identical, boot up to 14 checks — one of
which fails if any old name reappears, if `rebuildRouteViews` recreates
`route.elements`, or if the old DOM ids come back.

Re-ran every browser walkthrough from the earlier phases against the
renamed build: the action UI end to end, undo/redo across every action
edit, the drive toggle, the config modal and hotkeys, the sketcher's
points and auto-tangency, the S-curve drag, and all nine tool buttons.
No console errors anywhere.

---

# Changes — 2026-08-09 (6)

## Solver: arcs no longer go red under the cursor

Reported as "conflicting constraints, or flashing red and green as I drag,
on a shape FreeCAD handles freely". It turned out to be three separate
faults, only one of which was really about the maths.

### 1. A drag that could not reach the cursor was reported as a conflict

`dragPoint` pins the dragged point and solves. When the cursor goes
somewhere the constraints cannot follow, that pinned solve fails — and
the failure was being reported as `conflict` and written to `sk.status`,
which is what colours the sketch. So an unreachable cursor painted the
whole sketch red, and it stayed red for the rest of the drag.

The pin is an interaction device, not part of the model. Now: try pinned;
if it cannot be satisfied, release the pin and solve the real system
instead. Geometry lags the cursor — what a CAD sketcher does — and the
status reported is the model's own. `laggedCursor` on the result says the
point did not keep up, for anything that wants to know.

This alone removed 8 of the 13 red frames in the reported case.

### 2. Tangency captured which side the centre was on

`tangent(line, arc)` constrains the centre to stand one radius off the
line, and captured the sign at creation so the arc would not flip. That
side lock makes regions of the sketch simply unreachable: drag an end far
enough and the solver has to push the centre through the line to follow,
cannot, and grinds to a halt in a configuration it can no longer solve.

New `tangent_at(line, arc, point)` states it at the shared end instead:

    f = (p − c)·û = 0

the radius at that end is perpendicular to the line. Zero when tangent,
whichever side the centre is on and whichever way the arc sweeps. Smooth
everywhere, no captured state, and the exact meaning of "tangent at this
end" — which is what was being asked for anyway. It is the same endpoint
tangency FreeCAD recommends for smooth joins.

It is also much better conditioned: the reported drag settles in **3
iterations instead of 16–30**.

Auto-tangency now produces it, and the palette upgrades a plain tangent
to it whenever the selected line and arc already meet at a point.

### 3. A flattened arc could never come back

Even with the sign gone, an arc cannot change sides *continuously* — the
centre would have to travel through infinity, and the arc straightens out
on the way. Levenberg-Marquardt follows that path faithfully and strands
the arc at a radius of 1e5, un-flippable.

The escape is that the right centre is available in closed form. For an
arc tangent at `p` and passing through its other end `q`, with `n̂` the
line normal:

    R = |q − p|² / (2 |(q − p)·n̂|)      c = p + sign((q − p)·n̂)·R·n̂

`Sketch.rescueFlatArcs` re-seeds a runaway centre there and re-solves,
keeping the guess only if it satisfies the sketch better. It has to run
while the dragged point is still at the cursor — once the pin is released
the point falls back onto the flattened arc, and the closed form then
correctly declines because that endpoint is already on the tangent line.

An arc dragged across the line it is tangent to now crosses cleanly and
comes back the same way.

### Measured

Random mouse-like dragging of the reported shape, 1200 steps:

| | before | after |
|---|---|---|
| S-curve, no dimensions | 36.8% frames red | **1.3%** |
| S-curve + two radii    | 50.4% frames red | **1.4%** |

The reported sequential drag went from 13/19 red frames to **0/19**. In
Chromium, drawing line–arc–arc–line and hauling an end around for 60
frames stayed green the whole way.

### What is still not fixed

- **Arc-to-arc tangency is not inferred.** Auto-tangency handles line↔arc
  only, so the inflection where two arcs meet gets a coincident and can
  still kink. The constraint to add is the arc-arc analogue of
  `tangent_at`.
- **A line dragged to zero length** has no direction, so tangency against
  it is undefined and the solve stalls. That is the entire remaining 1.3%
  above, and it is a degeneracy the other line constraints share.

---

# Changes — 2026-08-09 (5)

## Fix: the Point tool was dead on arrival

The button appeared, highlighted correctly when clicked, and did nothing.
Every tool was hand-wired by id — `btnToolConstruction.addEventListener`,
`btnToolSelect.addEventListener`, eight of them — so adding markup without
adding a matching line produced a control that *looked* bound because
`setTool` highlights from `data-tool`, but had no click handler at all.

Tool buttons are now bound from `data-tool`, the same attribute `setTool`
already reads to decide which one lights up. Eight blocks become one loop,
the six cached `RP.dom.btnTool*` handles are gone (nothing needed them),
and the dead `btn-tool-arc` reference — an id that has not existed in the
HTML for some time — went with them.

A boot test now asserts the binding is attribute-driven and that every
`data-tool` value names a tool that actually exists.

## Sketcher: standalone points and auto-tangency

### Standalone points

A new **⦁ Point** tool places a point that exists in its own right rather
than as the end of something — a mission object, a drop zone, any
reference you want to measure or constrain against.

They are ordinary sketch points, so everything already built works on
them: they snap on placement, they are draggable and constrainable in
Constrain mode, they appear in the geometry list, and they persist with
the rest of the sketch. Deleting one that another entity is built on is
refused rather than silently orphaning it.

`RP.points` is a rebuilt view alongside `RP.lines` and `RP.arcs`. The
thing that separates a standalone point from a line's endpoint is simply
whether it carries construction metadata of its own, so endpoints cannot
leak into the view.

### Snap now reaches arc ends and points

`computeSnap` only ever offered LINE endpoints. That meant an arc's end
could not be snapped to at all — so a line drawn away from an arc never
became coincident with it, and nothing downstream could tell the two were
joined. Both new features need it, so arc ends and standalone points are
now first-class snap targets. An arc's *centre* deliberately is not: it is
a control handle, not a place on the mat.

### Arcs are auto-tangent to the straights they join

Draw an arc onto the end of a line — or a line away from the end of an arc
— and a `tangent` constraint is added alongside the coincident. That is
what makes the robot's path continuous instead of kinking, and it is the
main reason to put an arc between two legs at all.

Details that matter:

- **Only when exactly one candidate ends at that point.** At a corner
  where two lines already meet there is no way to guess which was meant,
  and a second tangent would over-constrain. Candidates are compared
  through the coincidence union-find, not by point id — two lines meeting
  at a corner keep their *own* endpoints joined by a constraint, so an id
  comparison would have seen one line where there are two.
- **It never moves what you already drew.** The tangent is solved once
  with the pre-existing geometry pinned, which steers the solver to the
  solution that moves the new arc instead. Without this you draw a
  horizontal line, add an arc, and the line tilts to meet it. The pins
  come straight back off; the configuration already satisfies everything,
  so the unpinned solve that follows has nothing left to do.
- **A rejected guess is never fatal.** If the tangent conflicts or turns
  out redundant it is backed out on its own, so it cannot take the
  coincident that joined the ends down with it. `RP.autoConstrain = false`
  suppresses the whole inferred layer as before.

### Verification

10 suites pass, goldens byte-identical; `tests/construction.js` is up to
32 checks. Browser: drew a line, an arc off its end and a line off the
arc's end with real mouse drags — two coincidents, two tangents, both
joins tangent to 0.000°, the first line still exactly horizontal at
200.00 mm — then placed a loose point and one snapped onto a line, which
picked up a `point_on_line`. No console errors.

### Worth knowing

Tangency is applied unconditionally, so drawing a line at a sharp angle
from an arc end will swing it round to the tangent direction — that is
the constraint doing its job, and the constraint can be deleted from the
Constraints list for any join you want kinked. If that turns out to be
annoying in practice, the usual CAD answer is to only infer tangency when
the drawn direction is already close to tangent.

---

# Changes — 2026-08-09 (4)

## UI polish

### Drive is one toggle, not two buttons

The move panel's ▶ Forwards / ◀ Backwards pair became a single button that
flips on click, tinted to match the segment on the canvas — blue driving
forwards, orange driving backwards. Two states never needed two controls,
and it buys back the width the pair was fighting over.

### Robot & Code config is a real modal

- **The button moved out of the Insert dropdown into the top bar**, next
  to the zoom controls, and lights up while the dialog is open. It was
  buried three levels down in a hover menu.
- **The dialog is centred and fixed**, not pinned to `right: 200px` where
  it hung half off-screen on narrower windows. `min(760px, 92vw)` wide, a
  proper header with a ✕, and the body scrolls rather than the page.
- **Templates are a two-column grid** under section headers, so the
  dialog is a page rather than a scroll marathon.
- **Closes on ✕, on backdrop click, and on Escape.** Escape is handled
  before the "is the user typing?" guard — every control in that dialog
  is a text input, so the guard would otherwise have swallowed the only
  key that dismisses it.
- **Set-start now closes the dialog** instead of leaving it covering the
  canvas you have been asked to click.
- Opening and closing goes through one `RP.setRobotOverlay(open)`, so the
  backdrop and the button's lit state cannot drift apart from the dialog.
- The **pivot-left / pivot-right turn templates** added in 10.1 finally
  have fields. Blank means "same as a plain turn", so they are read
  without `_strOr`'s default, which would have overwritten the blank.
  `code-checkpoint` was also never wired to the live-update list — it is
  now.

### Mode hotkeys

`1` → Sketch, `2` → Route, `Tab` flips between them. None collide with
WASD panning or the constraint letters, and all three are ignored while
you are typing in a field. Shown in the mode buttons' tooltips and the
canvas hint.

### Also

The Style and Move dropdowns were rendering as "Pivot on ⌄" and
"Line trace (jur" — 70px is fine for numbers, not for words. Widened to
112px and shortened the longest labels.

### Verification

10 suites pass, goldens byte-identical. Browser: hotkeys in both
directions and ignored inside a field, modal centred at exactly the
viewport centre, all three close paths, the drive toggle round-tripping,
and a filled-in pivot template reaching the generated code.

---

# Changes — 2026-08-09 (3)

## Phase 10.2 — the action UI

Turns are now things you click, select and configure. 10.1 made them real
objects; this makes them reachable.

### Selecting

`RP.selectedActionId` is the selection, and it can be any action.
`selectedElementId` survives as an accessor that reads through **only**
when the selection really is a move — so selecting a turn correctly
un-highlights every segment instead of leaving a stale one lit.

`routeHitTest` now returns point-anchored actions ahead of the geometry
they sit on. They are small targets, and the line underneath is always
reachable a few pixels away. Several actions can share one junction — a
typed turn, the geometric turn and a checkpoint all happen at the same
corner — so clicking again advances through them rather than sticking on
the first.

Clicking a line still appends a move, exactly as before.

### The action list

The element list is an action list: turns and checkpoints indented under
the move they lead into, so it reads like the program.

A junction turn that emits nothing *and* carries no settings is hidden —
a straight joint, or the leading turn when no start position is set. It
stays clickable on the canvas and reappears the moment it matters or is
selected.

New **↻ Turn** and **🏁 Checkpoint** buttons insert in front of the
selection, which is also where the panel's remove button acts.

### Per-type panels

| Selection | Panel |
|---|---|
| Turn | readout of what it emits, Derived/Typed, degrees, speed, style |
| Checkpoint | name |
| Move | move type, drive direction, speed, offset/junctions/teleport name, checkpoint, reorder, remove |

### Canvas markers

Each turn draws at its junction: a sweep arc from the incoming heading to
the outgoing one, the angle spelled out, an asterisk when typed, a white
ring when selected. Turns that emit nothing draw a hollow dot so the
junction is still clickable. The old hover-only annotation and the
extra-turn pips are suppressed in route mode, where they would double up.

### Model changes this needed

**Checkpoints became their own action type.** `el.checkpoint` and
`route.startCheckpoint` are gone — the start checkpoint was only ever a
special case for "a checkpoint with no move in front of it", which as an
action is just index 0. The move panel keeps its Checkpoint field, routed
through `setMoveCheckpoint`.

**A typed angle is an override, not a type change.** This was a real bug
caught while wiring the panel: converting a junction turn to `fixed`
would have taken it out of `syncTurnActions`' ownership, and sync would
then have created a *second* turn at the same corner — doubling the
robot's rotation. So `angleMode` is ownership (`auto` = the invariant's,
`fixed` = user-inserted) and `angle` is the value (`null` = derive from
geometry, a number = use this instead).

**`computeSteps` tags every step with its `actionId`.** The list and the
canvas read what was actually emitted instead of re-deriving the same
walk and drifting from it.

### Fixed

`.elp span { flex: 1 }` applied to the toggle widgets too, so they split
width equally with their label and clipped their second button off the
sidebar. The Drive toggle in the move panel had the same problem.

### Verification

- 10 suites pass; `tests/action.js` is up to 27 checks.
- **All seven golden fixtures still byte-identical.**
- Browser (Chromium via Playwright), driving the real UI with real mouse
  clicks: click two lines to build a route, click the corner to select
  its turn, set speed and style through the actual inputs, override the
  angle, insert a turn and a checkpoint from the buttons, then undo and
  redo the lot. Undo/redo is exact at every step. No console errors.

### Still to come (phase 10.3)

Delete the `route.elements` compat view and rename the element-era calls
(`addRouteElement`, `setRouteElementProps`, …) to their action names.

---

# Changes — 2026-08-09 (2)

## Phase 10.1 — routes become ordered ACTIONS

The structural half of making turns first-class. A route was
*one move per piece of geometry*, and turns were not objects at all:
`computeSteps` derived each one from consecutive headings and billed it
to whichever element came next, so `el.turnSpeed` literally meant "the
speed of the turn BEFORE this line". That is why turns could not be
selected, and why `extraTurnsBefore`, `endExtraTurns` and
`startCheckpoint` existed — three workarounds for one missing concept.

### The model

`route.actions` is an ordered list. Each action references the sketch
entity that suits it:

- **move** → a line or arc. Distance, radius, sweep and headings are
  derived from the sketch; the action carries what the robot does along
  it.
- **turn** → a **point**. The angle is derived from the headings either
  side of that point; the action carries speed, style and an optional
  typed-angle override.

Nothing stores a coordinate — the sketch still owns every position.

`syncTurnActions()` maintains the invariant: exactly one `auto` turn
immediately before every move, created and destroyed with it. `fixed`
turns are user-owned and sync never touches them. Re-matching is
positional first, then by coincidence cluster, so **reordering or
reversing a route carries each junction's speed and style with it**
instead of leaving them behind on the wrong move. It is idempotent, so
`rebuildRouteViews` re-establishes it on every refresh.

The leading auto turn, in front of the first move, is not redundant: with
a start position set it is the turn from the robot's start heading onto
the first leg.

### What this replaces

| Was | Now |
|---|---|
| `el.turnSpeed` | `speed` on the auto turn at that junction |
| `el.extraTurnsBefore[]` | ordinary fixed turns in the action list |
| `route.endExtraTurns[]` | ordinary fixed turns at the end |
| turn angle inferred mid-emit | `resolveTimeline()` computes entry/exit headings up front |

### Turn styles

`spin`, `pivot_left` and `pivot_right` are physically different
manoeuvres, so each maps to its own code template. The pivot templates
default to blank and fall back to `turnTemplate`, so adding them cannot
change existing output.

### Unknown headings are now explicit

`resolveTimeline` reports `entryHeading`/`exitHeading` as `null` where the
planner genuinely cannot know them — a teleport arrives pointing
somewhere nothing can predict. An auto turn against a null heading
resolves to nothing, rather than being silently skipped by a `continue`
buried mid-loop.

### Compatibility

- `route.elements` is a rebuilt array of the **live** move actions, not
  copies, so the resolver, `recomputeFlips` and the route-mode panel keep
  working and keep writing to the real model. It is not persisted.
- Save format is **v5**. v4 (`elements`) and older lift through
  `liftElementsToActions`; the node/segment migration chain is unchanged.

### Verification

- 10 suites pass, including a new `tests/action.js` (16 checks).
- **All seven golden fixtures byte-identical** — the whole point of doing
  the model first.
- Browser (Chromium via Playwright): build a route, set a junction speed
  and style, insert a typed turn, undo/redo, remove a move and undo it,
  inspect the save payload. Turn params survive undo; removing a move
  takes its auto turn; the payload carries only `actions`. No console
  errors.

### Still to come (phase 10.2, UI)

Clicking a junction point to select its turn, an action list with turn
rows between move rows, per-type parameter panels, and the angle drawn at
the point. That is also where extra turns become editable again (the gap
phase 9 recorded) and where checkpoints become their own action type.

---

# Changes — 2026-08-09

## Phase 9 cleanup (finishing the sketch-layer refactor)

Deleted the last of the node/segment write path. `route.nodes` and
`route.segments` became derived read-only views in phase 4, so everything
below was writing to structures that the next `rebuildRouteViews()` threw
away — it looked like it worked until you touched anything else.

**Removed**

| | |
|---|---|
| UI | The **Selected Segment** and **Selected Node** sidebar panels (`#segment-section`, `#node-section`) and every input in them: the 6-way mode radios, offset, speed, teleport name, junction count, flip-direction button, turn speed, and the extra-turns list. |
| State | `RP.selectedSegment`, `RP.selectedNode`. Save/load and Clear All now reset `RP.selectedElementId` instead. |
| Model | `removeSegment`, `removeNode`, `flipSegmentDirection`, `setSegmentMode`, `setSegmentTeleportName`, `setSegmentJunctionCount`, `findSegment`. |
| Arcs | The sagitta bulge handle's mousedown/mousemove branches, plus `arcApex` and `defaultArcSagitta`, now that arcs are sketch entities. `arcPerp` and `computeArcGeom` stay — they are how `migrateRoutesToElements` turns an old chord+bulge into a centre. |
| Layer list | The per-segment sub-rows (select / hide / delete). The route row now reports element count and keeps only its visibility toggle. |
| Context menu | The node and segment branches, including "Clear checkpoint". Construction lines are the only right-click target now; checkpoints are edited in the element panel. |
| Tool plumbing | `TOOL_LABELS` / `setTool` hints for the deleted `route`, `checkpoint` and `freehand` tools. |
| CSS | `.layer-seg-item`, `.active-seg`, `.seg-mode-group`, `.seg-mode-radio`. |

Select mode is now purely "move geometry": drag a construction-line
endpoint or a route node, both of which go through the solver.

**Fixed along the way**

`<div id="ctx-menu">` was declared *after* the `<script>` block, so
`document.getElementById('ctx-menu')` inside `initEvents()` returned
`null` and `showCtxMenu()` early-returned every time. The right-click
menu had never opened. Moved the markup above the scripts; a new boot
test now fails if any element the scripts resolve at load time is
declared below them.

Also gone: a dangling `if (RP.dom.segmentModeFollowPath)` with no body,
left over from the `follow_path` deletion.

**Verification**

- `node tests/run.js` — 9 suites, all pass (boot 10 → 12 checks).
- Golden codegen output byte-identical.
- Browser smoke test (Chromium via Playwright): draw + constrain
  geometry, all four tools, Sketch↔Route switching, append elements,
  edit them, undo/redo, right-click delete + undo. No console errors.

**Known gap**

`element.turnSpeed` and `element.extraTurnsBefore` are still consumed by
codegen and covered by the golden suite, but nothing edits them any more.
The node panel that used to was writing to a derived view, so this was
already broken before the deletion. Fix is to add both to
`RP.updateElementParams` in `js/ui/route-ui.js`.

**Line counts** (`js/` + `index.html` + `style.css`): 7515 → 6718.
`events.js` 1094 → 807, `core.js` 842 → 595, `routes.js` 528 → 326.

---

# Changes — 2026-05-25

Two passes: your snap rework + the audit fixes.

---

## Snapping (your requested behaviour)

### New rules

Snap targets are **only construction lines**, period. The single source of truth is `RP.computeSnap(ix, iy, opts)` in `js/core.js`.

- **Point snap** (hover indicator, start of click+drag, robot start marker, waypoint/endpoint drag): priority is
  1. construction-line endpoint / intersection (treated as the same "precise" tier)
  2. perpendicular projection onto a construction line ("along-line")
- **Line-end snap** (during click+drag, and at mouseup commit): priority is
  1. construction-line endpoint / intersection
  2. 90° angle from the anchor
  3. along-line
- **Route waypoints and route segments are NEVER snap targets.** Removed from all candidate lists.
- **Ctrl held** still disables snap entirely.
- **`excludeLineIdx`** option so a line endpoint being dragged in Select mode doesn't snap to itself.

Construction-line midpoints have been removed as snap targets (they weren't in your spec). If you want them back, add a Priority-1 block to `computeSnap` — it's one short loop.

> Note: I kept **intersections** alongside endpoints. They're the most useful snap target on a WRO mat (grid corners). If you want them gone, delete the second loop in the Priority-1 section.

### Removed: auto-extend route preview

The faint dashed line that drew automatically from the last waypoint to the cursor while idling in route mode is gone (`js/render.js`). Replaced with a subtle static circle around the last waypoint of the **active** route — a magnetic-anchor hint without pretending a line is being drawn.

### Route lines: must start from the last waypoint

When a route already has waypoints, you can only start a new segment if your click is within ~20 screen-px of the last waypoint. The start of the drag is **forced** to the last waypoint's exact coordinates (no drift). Clicks outside that radius fall through to the existing waypoint-drag / pan behaviour.

The midpoint-click-to-insert behaviour (click near a segment midpoint to splice in a waypoint) is preserved.

### Fixed: "cursor snaps but start of drag doesn't"

Both the hover indicator and the mousedown that starts a drag now call the **exact same** `computeSnap` with the same `kind: 'point'` options on the same screen→image coordinates. They cannot disagree.

### Fixed: "construction line looks like it snaps to a route line"

The hover indicator no longer considers route waypoints or route segments. If the indicator shows up, it's snapping to a real construction-line feature.

---

## Audit fixes

### Tier H — bugs that were biting

| | |
|---|---|
| **H1** | Window-level keydown handler now early-returns when `e.target` is an `INPUT`/`TEXTAREA`/`SELECT`/contenteditable. You can finally type "forward" into the Forward Template field. |
| **H2** | `routes.js` `createRoute` now snapshots `id = nextRouteId++` before using it in the default name, so default name and id agree (no more "Route 2" with id 1). |
| **H3** | Cancelling the calibration prompt no longer leaks a `nextLineId` increment or a no-op undo entry. Calibration now happens **before** the line is committed; cancel = nothing happened. |
| **H4** | `localStorage.setItem` is wrapped in try/catch. Quota exceeded gives a clear "storage is full, try Export Project" message instead of an uncaught exception. |
| **H5** | `importProject` no longer silently auto-saves the imported project to localStorage (so it can't silently overwrite a saved map or blow the quota). `saveMapProject` now confirms before overwriting an existing entry, and treats Cancel on the name prompt as a no-op. |
| **H6** | Code generation now respects `startPos` as an actual position. If `startPos` is not coincident with `wp[0]`, the generated code emits a turn to face `wp[0]` and a forward leg from `startPos` to `wp[0]` before the rest. If `startPos == wp[0]`, only the initial heading turn is emitted. If `startPos` isn't set, behaviour is unchanged. |
| **H7** | The Unit field now actually converts. mm/cm/m/in supported via `RP.UNIT_FACTORS_MM`. Both the on-screen instructions list, the total-distance line, and the generated `{distance}` template values are converted to the chosen unit. Unknown units fall back to mm without rescaling. |
| **H8** | `restoreState` now deep-clones on the way out, so the live state never shares array references with anything still in the undo/redo stacks. |

### Tier M — UX / robustness wins

- **M1/M2** — Robot start marker placement: the button now toggles (click again to cancel), Escape cancels in-progress placement and any in-progress line drawing. Hint text remains as-is for now ("click on map, then drag to set heading") — the underlying gesture is still click-move-click, but Escape gives an out and re-clicking the button does too.
- **M3** — "Load Map" top-bar button now scrolls the always-visible Saved Maps panel into view and flashes its background, instead of just calling `updateMapList`. (The whole concept is still a bit redundant given the panel is always visible — feel free to delete the button.)
- **M4** — "📋 Route Instructions" toggle now hides **only** the Instructions panel, not all three bottom panels.
- **M6** — Numeric inputs (`code-speed`, `robot-w/l/wb`) validate explicitly (`> 0`, finite); empty/invalid → default. Strings (`code-comment`, templates, unit) use empty-check, so a literal `0` value would survive (not that it makes sense for these fields).
- **M7** — Midpoint-insert hit radius increased from 8 → 12 screen-px to match the waypoint hit radius.
- **M8** — Route switching (via dropdown or sidebar label click) and visibility toggle now push undo history. The route delete button (top-bar **and** sidebar `×`) now confirms.
- **M9** — Line-endpoint drag in Select mode now snaps to other construction-line features (via `excludeLineIdx` so it doesn't self-snap).
- **M10** — New **📏 Recalibrate** button in the right sidebar's Calibration section. Uses the longest existing construction line as the reference and re-prompts; existing line labels are recomputed.
- **M13** — `URL.revokeObjectURL` in `exportProject` is now deferred via `setTimeout(..., 1500)` after appending the `<a>` to the DOM, so Safari/iOS downloads aren't broken.

### Tier L — polish

- **L1** — `#info-click` now shows the last-click image coordinates (was dead UI).
- **L3** — `updateInstructions` and `generateCode` no longer duplicate the turn/forward loop. Both consume `RP.computeSteps(route)` which is the single source of truth.
- **L4** — Default `robotConfig` and `codeConfig` are defined once (`RP.DEFAULT_ROBOT_CONFIG`, `RP.DEFAULT_CODE_CONFIG_VALUES`) with `RP.freshRobotConfig()` / `RP.freshCodeConfig()` helpers. `persist.js` and the Clear All handler use them instead of inline literals.
- **L7** — `RP.setTool` is now the single source of truth (the duplicated local copy in `events.js` is gone). It also cancels in-progress drawing when you switch tools.
- **Live config preview** — Code-template inputs now update the Code panel as you type, not just on blur/Enter.

---

## What I deliberately did NOT change

- **L/R turn convention** (Audit M5): the code still maps clockwise-on-screen → right turn. Adding a "flip L/R" toggle is straightforward but I'd want to know your mat's actual orientation before guessing the right default.
- **Mobile pinch-pan** (Audit M12): not a stated requirement; the existing pinch-zoom still works.
- **Magic numbers consolidation** (Audit L8): out of scope for this pass.
- **Native `prompt()`/`alert()`/`confirm()`** (Audit L11): same.
- **Tab-dropdown keyboard accessibility** (Audit M14): same.

---

## Files touched

```
index.html                +1   (Recalibrate button)
js/core.js                ±   (computeSnap, setTool, freshConfig helpers, deep-clone restoreState)
js/render.js              ±   (route standby preview removed, magnet circle added)
js/routes.js              ±   (createRoute id, delete/visibility confirm + history, label click history)
js/output.js              rewritten (single computeSteps source, unit conversion, startPos respect)
js/persist.js             ±   (quota handling, no silent auto-save on import, overwrite confirm, defer revokeObjectURL, freshConfig)
js/config.js              ±   (typed validation helpers, recalibrate, live render)
js/events.js              ±   (snap rework, key-guard, escape, dedup setTool, history on route ops, info-click, Load Map UX)
```

Nothing on `js/main.js`. No new dependencies, no network — fully offline.

---

## Verification

- All eight JS files pass `node --check`.
- Stub-DOM smoke test (loads every file top-level): all OK.
- Headless browser testing: skipped (no Chromium/Puppeteer available on this host). Recommend opening in a real browser and walking through:
  1. Draw a couple of construction lines, calibrate.
  2. Hover near construction endpoints/intersections/along lines — indicator should appear and snap.
  3. Hover near route waypoints/segments — indicator should NOT appear.
  4. Draw a route segment from the first waypoint; confirm the start position matches whatever the indicator showed during hover.
  5. Try to start a second route segment by clicking somewhere other than the last waypoint — nothing should happen (no auto-line).
  6. Click+drag from the last waypoint — should extend the route.
  7. Set robot start marker at a position different from `wp[0]` and inspect the generated code: should have an initial turn AND an initial forward leg.
  8. Change the Unit field to `cm` and confirm both the instructions list and the code use cm-scaled numbers.
  9. Cancel the calibration prompt — nothing should be drawn, undo stack should be unchanged.
  10. Focus the Forward Template input and type "forward" — should land in the input, not pan the canvas.
