# Changes — 2026-08-30 (4)

## Groups: a current group, so filing costs nothing

The first groups build made you right-click each line and type a group
name. That is fine for three lines and unusable for thirty — which is the
number that actually matters. Reworked to the active-layer model every
CAD tool uses.

### Everything is in exactly one group

There is no longer an "ungrouped" tier. A document always has a
**Default** group; new geometry goes into the **current** group with no
extra step; files without groups migrate into Default on load. Two kinds
of membership that behave differently is a rule to keep in your head for
no benefit.

Default cannot be deleted, because it is the floor everything falls back
to. Deleting any other group keeps its geometry and moves it there.

### Setting the current group

- **Click** a group row to draw into it. **Double-click** to rename.
  Setting the current group is the frequent action, so it gets the plain
  click; renaming is rare and moves out of the way. Left-click used to
  rename, which was easy to trigger by accident.
- **＋ New group** creates one and makes it current, because making a
  group means you want to use it.
- Setting a hidden group current **un-hides** it. Otherwise the next line
  drawn vanishes the instant it is created, which reads as drawing being
  broken rather than as the group being hidden.
- The sidebar always shows *drawing into "…"* and the current row is
  marked ✎. Without that, the classic failure is drawing ten lines into
  the wrong group and finding out only when you hide it.

### Filing existing geometry

Right-click → **Add to "dropoff"**. One click, no typing.

It acts on the whole SELECTION when the right-clicked line is part of it,
and on just that line otherwise — the rule file managers use. Since
shift-click multi-select already existed, that turns "twenty-four clicks
for a dozen lines" into two. The menu names the count (`Add 12 to
"dropoff"`) so moving a stale selection by accident is at least visible,
and greys out when there is nothing to do.

### Verification

13 suites; documents 38 → 46. The six tests that failed were asserting
the OLD contract — an ungrouped tier, no Default — and were rewritten to
the new one rather than patched around: new geometry landing in the
current group, the current group being per-document, a hidden group
un-hiding when made current, Default refusing deletion, deleted groups
falling back to Default, and a pre-groups file migrating rather than
loading with nothing.

New tests cover the selection rule in all three cases (click inside the
selection, outside it, nothing selected) and twelve lines moving in one
action.

Verified in Chromium through the real UI: Default exists at startup with
the hint reading `drawing into "Default"`; a drawn line lands in Default;
＋ New group makes "line trace" current and the next line goes there;
clicking the Default row switches back and the list marks it ✎; hiding
"line trace" then making it current leaves it visible; and a five-line
selection files in one action.

---

# Changes — 2026-08-30 (3)

## Overlapping-line pain: click-cycling, readable action rows, named groups

Three changes from the post-competition feedback, smallest first. The
first two target the case groups were never going to fix — the robot
driving back and forth over the same geometry.

### 1. Overlapping moves cycle instead of one being unreachable

`routeHitTest` picked the nearest move with a strict comparison. Out and
back along ONE line is two moves on ONE entity, at identical distance
from any click, so the first always won and **the second could never be
selected at all**. Not a visibility problem, so no amount of hiding or
grouping would have helped.

It now gathers every move within a hair of the nearest and advances
through them on repeated clicks — the same cycling the junction actions
in the same function already did. A clearly nearer move still wins, so
picking does not become a lottery among lines that merely happen to be in
the neighbourhood.

### 2. Action rows say how long each move is

Rows were built from the move type alone, so a back-and-forth section
read `Straight · Straight · Straight` with nothing to tell the rows
apart. Since this list has hover-preview, it IS the tool you reach for
when the canvas is too crowded to click — and it could not do the job.

Now `Straight · 400 mm · rev`. `RP.moveLengthMm` measures along the curve
for arcs rather than across the chord, and returns null without
calibration rather than inventing a number.

### 3. Named groups, hard hide

A group is a named bag of geometry with one switch. Hiding it is exactly
hiding each member: invisible, unclickable, unsnappable, and its
obstacles stop colliding.

That last part is worth stating plainly because it is a footgun: hide a
group containing your obstacles and the simulator will report no
collisions. It is consistent — hiding a single obstacle line already did
this, and there is a test for it — but "hidden means inert" is a rule to
know rather than discover.

The implementation is one gate, not twenty. `rebuildLines` computes the
`visible` field of the `RP.lines`/`arcs`/`points` view, and the ~20
consumers that check `visible === false` all read that field. ANDing the
group's state in there gives render, snap, hit-testing, selection and the
layer list group-hiding without any of them knowing groups exist.

A bug I introduced and caught while writing it: `obstacleSegments` and
`robotFootprint` read a NAMED document, but `RP.groups` follows the
ACTIVE one, so they would have consulted whichever document happened to
be open. `groupVisible` now takes the groups list explicitly and those
two pass their own document's.

Details that matter:
- Groups are per-document — the mat and the robot each have their own.
- Deleting a group keeps its geometry and un-groups it. Losing drawn work
  to a tidying action would be a nasty surprise.
- A dangling group id fails OPEN. A bad save file must not hide work with
  no way to get it back.
- Typing an existing group name joins that group rather than creating a
  second one with the same label.
- A line hidden by its group shows a closed, DISABLED eye saying which
  group hides it. Its own flag is still true, so clicking would have set
  true to true and silently done nothing.

### Verification

13 suites; documents 26 → 38, route mode 32 → 39.

Both new behaviours were confirmed to catch their own absence by
mutation: reverting move-picking to nearest-wins fails 2 tests, and
removing the group gate from the line view fails 4, including the
save/load and undo round trips.

Verified in Chromium: repeated clicks on a doubled-up line alternate
between the two move ids (`3, 5, 3, 5`); action rows read
`Straight · 500 mm` / `Straight · 400 mm` / `Straight · 400 mm · rev`;
and hiding a group leaves its member with `visible: false`, no longer
hit-testable, dimmed in the list, with a disabled eye reading "Hidden by
the group "line trace" — show that group to get this back".

---

# Changes — 2026-08-30 (2)

## Route geometry is inserted where it connects, not always appended

Clicking geometry in Route mode always put the move at the END of the
route. That is right exactly while you are drawing a route front-to-back.
It is wrong the moment you EDIT one — which is what adapting to a
surprise mission is — because a move appended to the end of a route it
belongs in the middle of is always disconnected, and had to be dragged
into place by hand every time.

`RP.bestInsertionFor(route, entityId)` (`js/model/route.js`, pure model)
scores every slot in the route by how many of the two neighbouring
junctions the geometry actually meets, through the same coincidence
clusters that decide route continuity everywhere else:

| joins | meaning |
|---|---|
| 2 | it bridges a gap exactly — the move before AND the move after connect to it |
| 1 | it extends a chain at one end. Plain appending is this case |
| 0 | nothing touches; append, and the route is reported broken as before |

Both traversal directions are scored, so a line drawn "backwards" is
flipped to fit rather than rejected.

**Ties go to the latest slot.** Drawing a route in order is by far the
most common flow and must not regress — the ~30 existing tests that build
routes sequentially are the net that proves it, and they all still pass
untouched.

`RP.appendGeometryToRoute` is renamed **`RP.addGeometryToRoute`**. A
function called "append" that no longer always appends is an active lie
to the next reader; the rename is mechanical across `events.js` and four
test files. `RP.bestFlipFor` is gone — it only ever considered the LAST
move, which was the append assumption in miniature, and
`bestInsertionFor` subsumes it.

### Verification

13 suites, route mode 24 → 32.

Confirmed the new tests actually discriminate by mutating
`bestInsertionFor` to always append: four of them fail, including the two
that matter most — geometry landing in the gap, and the route resolving
as a result. Restored, all pass.

Verified in Chromium through the real hit-test path rather than by
calling the model directly: built A→C with the middle leg missing (status
reads "Route is broken between move 1 and 2"), then clicked the middle
leg on the canvas. It landed BETWEEN the two moves, the status changed to
"3 moves · connected", and the generated code came out as three straights
with the corner turn — with no manual reordering.

### Next

Groups for overlapping geometry, per the discussion: separate solver
documents were measured as genuinely faster (390 params → 57ms, and the
curve is ~n², so quartering a sketch quarters its solve), but route
continuity is a per-sketch union-find used in 9 places, so splitting mat
geometry across documents would break the invariant routes depend on.

---

# Changes — 2026-08-30

## Turn angles are no longer rounded away; output goes to 3dp

### The bug

Adding a typed turn close to the auto turn at a corner made the auto
turn disappear, taking the difference with it.

`computeSteps` suppressed any turn under **0.5°**. So at a 90° corner
with a typed 89.6° turn inserted in front of it, the auto turn's job was
the 0.4° remainder — which fell under the threshold and was dropped. But
the very next line still advanced the planner's heading the full 90°:

```
prevHeading = next.entryHeading;   // ran whether or not the turn emitted
```

So the generated code turned 89.6° while the planner believed the robot
was at 90°. Half a degree of silent disagreement, per corner, and the
robot integrates these into its own heading estimate — nothing
downstream can recover it.

A second, independent loss sat in the UI: switching a junction turn to
Typed seeded the field with `Number(deg.toFixed(1))`, so an 89.5312°
corner became 89.5 before the user had changed anything.

### The fix

- A turn is now suppressed only when it would **print as zero anyway** —
  `RP.turnEpsilonDeg()`, half of the last emitted decimal place. Anything
  a reader could see is emitted.
- The same threshold replaces the old 0.01° one on typed turns and the
  0.5° one on the initial turn off the start marker, which had the same
  shape of bug.
- Switching to Typed seeds the **exact** angle.

The 0.5mm threshold on the virtual start leg is deliberately left alone:
that one guards against a degenerate direction (a start marker sitting
essentially on the first point has no meaningful heading), not against
rounding.

### 3 decimal places

`RP.CODE_DECIMALS = 3`, applied to every physical value in generated
code: distances, angles, arc radii, expected distances, total distance.
Same reasoning — the robot integrates them.

Display follows, but honestly rather than uniformly: `RP.formatDeg`
shows up to 3dp with trailing zeros trimmed, so a corner still reads
"90°" while a residual reads "0.696°" instead of the "0.0°" that hid this
in the first place. The on-canvas turn badge keeps whole degrees except
below 1°, where whole degrees would round a real residual to "0°".

Teleport comment coordinates and the start-position comment are left at
their old precision — they are pixel positions in a comment, not values
the robot consumes.

### Verification

13 suites, action model 45 → 51.

The regression test was confirmed to fail against the old behaviour by
restoring the 0.5° threshold: the 0.4° remainder vanishes, exactly as
reported. Tests cover the remainder surviving at 89.9 / 89.99 / 89.999,
emitted turns summing to the corner's true angle, a sub-printable
remainder still being dropped (so the epsilon does something), 3dp on
angles and distances, and `formatDeg`'s trimming.

Two existing tests hard-coded the old 1dp format while actually testing
template substitution; rewritten to match the number without pinning the
decimal places, rather than re-pinning them to 3dp.

Golden fixtures regenerated. Every diff is precision-only — no step
added, removed or reordered — and `arc_segment` shows precision that had
been getting thrown away: `87.2 → 87.206`, `88.6 → 88.603`,
`212.1 → 212.132`.

Verified in Chromium through the real UI on a deliberately awkward
corner (40.696°): pressing **Typed** seeds `40.69553103949204`, and
inserting a typed 40.0° turn emits `40.000` followed by `0.696` — summing
to 40.696 — with the action list showing `0.696°` rather than `0.0°`.

---

# Changes — 2026-08-29 (6)

## Simulation phase 3: positional uncertainty

The swept body now grows as the robot dead-reckons, and shrinks back
whenever the route re-references something the robot can actually sense.

### The model

Uncertainty is an axis-aligned box `(ux, uy)` in **mat** axes, carried on
every pose, growing by `driftPerMm × distance driven` equally in both
axes — the model asked for, and roughly what wheel odometry does before
you start modelling heading error separately.

Mat axes rather than robot-local ones because that is the frame the
corrections live in: a wall align fixes the axis normal to **that wall**,
whichever way the robot happened to approach it.

Each correcting move collapses the box onto the direction it does NOT
measure (`RP.simCorrectAlong`):

| move | measures | uncertainty survives |
|---|---|---|
| wall align | distance to the wall | **along** the wall |
| line trace (dist) | which side of the line it is on | **along** the line |
| line trace (junctions) | both — the line laterally, the counted junction longitudinally | nothing |

The wall's direction comes from the move's own `point_line_distance`
constraint, so it is whatever wall that align actually targets rather
than an assumption. The projection onto the surviving direction is
conservative (`|ux·tx| + |uy·ty|`), which is exact for an axis-aligned
wall and never under-reports for a diagonal one.

### Off by default, on purpose

`driftPerMm` defaults to **0**. The rate is a property of one robot on one
surface and only its driver can measure it; shipping a plausible-looking
default would silently inflate every collision warning in the app on a
guess. The field says so, and the Simulation panel says so when drift is
off.

### Certain vs possible

The sweep now tests the drift-inflated body, and separately records
whether the contact also happens at the body's TRUE size. "This will hit"
and "this might hit once drift is allowed for" are different enough that
collapsing them would let a real collision hide among speculative ones,
so they are counted separately, listed with different glyphs (⚠ vs ?) and
colours, and drawn differently: the body solid, the drifted envelope
dashed outside it.

`RP.inflateHull` is a proper Minkowski sum of the hull with the
uncertainty box (the hull of the polygon translated to each of the box's
four corners). Scaling the polygon instead would have grown it about its
own centre, which is not what "the robot might be 20mm to the left" means.

### Verification

13 suites, `sim.js` 16 → 28. New tests: growth proportional to distance
and monotonic along the way; each of the three correction kinds clearing
the right axis and keeping the other; growth resuming after a correction;
`simCorrectAlong` on axis-aligned and diagonal inputs; `inflateHull`
growing by the box rather than about the centre; a near miss becoming a
POSSIBLE hit under drift and being flagged as not certain; a real hit
staying certain under drift; and a correction shrinking the body back
under an obstacle it would otherwise reach.

That last one initially failed, and the test was wrong, not the code: the
obstacle was within reach of the *drifted* body during the approach leg,
before the reset ever happened. Moved far enough past the reset that the
pre-reset body cannot reach it, and given a negative control — the same
obstacle with the correcting move swapped for a plain one, which must
hit — so it cannot pass for the wrong reason.

A real bug the tests caught: corrections were applied after the move's
final pose had already been emitted, so the pose at which the robot
corrects still carried the uncertainty it had just measured away.

Verified in Chromium. On the real 102-action project: drift set through
the real config field, 95.5mm peak uncertainty, refresh 33ms. On a
controlled route: an obstacle 20mm clear of the body reads "No
collisions" with drift off and "0 certain, 1 possible" in amber with
drift at 3%, the canvas showing the solid body clearing it and the dashed
envelope reaching it.

### Not done

Turn-based error growth. Turning is in practice the dominant source of
heading error, but the spec was distance-based growth and adding a second
uncontrolled constant would be guessing on the user's behalf twice over.
The mechanism is the same if it is wanted later.

---

# Changes — 2026-08-29 (5)

## Simulation phase 2: the collision sweep

The robot body is now swept along the whole route and every contact with
an obstacle is reported as a warning. Nothing is blocked — this tells you
where a problem is, it does not stop you drawing one.

### Poses come from the timeline, not from computeSteps()

The obvious source is `RP.computeSteps()`, since that is what the robot
actually executes, and it is what I argued for when we scoped this. It
cannot be used: a `linetrace_junct` step carries only a junction COUNT,
with no distance. Nothing downstream can know how far the robot travelled,
so dead reckoning loses the robot at the first junction trace and every
pose after it is fiction.

`RP.resolveTimeline()` has real coordinates for every move, including that
one, because the sketch knows where the geometry is. So `RP.simPoseTrack()`
walks the timeline and is exact by construction. Nothing is lost by the
change: phase 3's uncertainty is an explicit growth model, not a
dead-reckoning divergence, so no consumer needed the divergence signal.

### Turns in place are swept

A long robot pivoting in a tight corner is a real way to hit something the
path itself never touches, so rotations are sampled (`RP.SIM_TURN_DEG`,
4°) exactly as straights are (`RP.SIM_STEP_MM`, 5mm). There is a test for
precisely this: an obstacle placed diagonally off a corner, outside the
body's footprint on both legs, reachable only at the intermediate angles
the robot passes through while turning.

### The footprint is a convex hull

A body drawn as loose lines is a point cloud with no reliable ordering,
and there is no sound way to recover the intended outline. The convex hull
is the smallest polygon containing everything drawn, which is conservative
in the right direction: it can flag a collision that a concave body would
have squeezed past, but it can never miss one.

### Contact episodes, not contact samples

Brushing along a wall for 600mm is one problem to look at, not forty
identical warnings, so hits are grouped into episodes. A short break in
contact (≤25 samples) does not end one either: a body pivoting against an
obstacle can clip it, rotate just clear and clip again within a few
degrees, which is one problem in one place. Without that tolerance the
real project produced two warnings at an identical "5137 mm in", which is
exactly the sort of output that trains people to ignore warnings.

### Files

- `js/sim/pose.js` — `RP.simPoseTrack()`. Pure.
- `js/sim/collision.js` — `RP.convexHull`, `RP.pointInPoly`,
  `RP.polyHitsSegment`, `RP.footprintAt`, `RP.simCollisions`. Pure.
- `js/ui/sim-ui.js` — the only part that touches the DOM. Panel, canvas
  overlay, and the `RP.simResult` cache.

The sweep is recomputed in `refreshRouteUI` (on edits) and NEVER in
`render()`, which runs on every hover and pan.

### Verification

13 suites, new `sim.js` (16 tests). Both halves were mutation-tested
rather than trusted for passing first time: forcing turns to emit a single
pose, and forcing the footprint never to rotate, each break tests that
should catch them. The first pass revealed a test that was NOT
discriminating — its "swept turn" obstacle was also reachable by the
straight leg, so it passed even with turn sampling disabled. Moved to a
position outside the footprint on both legs; it now fails under that
mutation.

Measured in Chromium on the real 102-action project with a 220×180mm
robot: pose track under 1ms (2,905 poses), sweep 1ms, full
`refreshRouteUI` 14–15ms steady state. The first call after adding
geometry costs ~640ms, but that is the solver, not the sweep, and predates
this work.

End-to-end through the real UI: with no robot the panel reads "Not run —
no robot body" and says how to fix it; with a robot and no obstacles, "No
collisions"; with an obstacle across the route, two episodes listed by
distance and obstacle name, the focused one filled on the canvas and the
others outlined.

### Next

Phase 3: uncertainty growth per distance travelled, reset per-axis at wall
aligns and line traces.

---

# Changes — 2026-08-29 (4)

## Robot frame follow-ups: derived clearances and a reversible drive axis

Three gaps in phase 1, all raised as questions and all real.

### Front/rear clearance is now measured, not typed

Front and rear clearance ARE the body's overhang from the turning centre
— how far it sticks out ahead of and behind the point it pivots about.
With a body drawn, there was nothing left for a human to type, and two
hand-maintained numbers that could silently disagree with the drawing
they describe.

`RP.robotExtentsMm()` derives front, rear, left, right, length and width
from `RP.robotFootprint()`, in mm via the shared calibration.
`RP.wallClearanceMm()` — the single seam every wall_align already went
through — uses it whenever a body exists and falls back to the typed
fields when one does not. The Robot & Code panel shows the measured
values and disables the two inputs, rather than leaving editable numbers
that quietly feed nothing.

Extents are clamped at zero: a drive axis drawn ahead of the whole
chassis would otherwise report a negative overhang, which is not a
clearance.

Leaving the robot document re-runs `syncAllWallAligns()`, since editing
the body changes what every wall_align stands off by.

### The drive axis can be reversed in place

Previously the only way to change which end was the nose was to delete
the line and draw it the other way round.

`RP.flipDriveAxis()` toggles a `flipped` flag in the line's METADATA,
and `RP.robotFrame()` swaps the ends when reading it. Deliberately not
swapping `p1`/`p2` on the sketch entity: point order is what
direction-sensitive constraints measure against, so reordering it would
silently negate any angle constraint on that line. Which end is the nose
is a property of the role, not of the geometry.

Surfaced as **⇄ Reverse forward direction** in a new panel that appears
when the drive axis is selected, alongside the turning centre, reach
ahead/behind and body size — the answer to "how does it know the centre
of rotation?" now being visible rather than a convention to remember.

### Verification

12 suites, `documents.js` 19 → 26. New tests cover extents in mm,
clearance derived from the body with the typed fields deliberately set
wrong, fallback with no body, the flip changing direction and
re-measuring both overhangs, the flip NOT touching the entity's point
order, flipping twice being a no-op, and the flip surviving a save/load.

One of those tests initially failed, and the test was wrong rather than
the code: the shared fixture's drive axis sits symmetrically within the
body, so flipping it genuinely gives the same overhang either way and
the assertion could not tell a real flip from a no-op. Rewritten with a
deliberately asymmetric axis (40→120 within a 0..200 body), which
distinguishes them: 80/20 mm before, 60/40 mm after.

Verified in Chromium: extents read 80/20 mm, the real **⇄ Reverse
forward direction** button flips them to 60/40 with the frame reporting
`cos:-1` and the same entity id, the on-canvas arrow points the other
way, and the Robot & Code panel then reads "60.0 mm ahead of the turning
centre, 40.0 mm behind" with both inputs disabled.

---

# Changes — 2026-08-29 (3)

## Simulation phase 1: a robot document and obstacle geometry

Groundwork for collision simulation. Nothing simulates yet — this is the
model the simulator will read: what the robot's body is, where its
turning centre is and which way it faces, and which mat geometry it must
not drive through.

### Two sketch documents

The robot's body is now its own sketch, edited with the same tools as the
mat, switched from a new **Mat / Robot** control in Sketch mode.

Deliberately a second `RP.Sketch` instance rather than a role tag inside
the mat sketch. The solver treats a sketch as ONE system: a robot drawn
into the mat would join the mat's DOF count, could be constrained to mat
geometry, and would be dragged around by unrelated mat edits. A body and
the field it drives over have nothing to solve together, and the 390
parameters the mat already carries are not somewhere to add more.

`RP.sketch` / `RP.constructionMeta` keep pointing at whichever document
is ACTIVE, with the other parked in `RP.documents`. That was the whole
reason this stayed a small change: all 43 existing readers of `RP.sketch`
work unchanged, because they simply see whatever is being edited.

- `RP.setActiveDoc` / `RP.parkActiveDoc` / `RP.getDoc` (`construction.js`)
  are the model-level switch; `RP.switchDoc` (`route-ui.js`) is the UI one
  and additionally abandons in-flight drawing and swaps the pan/zoom, since
  the mat's view means nothing over a 200px robot.
- Route mode is forced back to the mat both ways round: routes reference
  mat entity ids, so Route mode over the robot would point at ids that are
  not there. The Route button is disabled while the robot is open.
- Both documents share one `RP.calibration`. That is not an oversight —
  it is what makes the robot's footprint directly comparable to mat
  coordinates when the sweep lands.

### The robot's frame

One line in the robot document, tagged `role:'drive'`, fixes both the
origin and the facing: its **start point is the turning centre** (the
drive-wheel axle midpoint) and it **points forwards**. One entity rather
than two, because an axle alone cannot say which way is forward and that
cannot be guessed from a body outline. It is drawn in cyan with a ring at
the turning centre and an arrowhead labelled "forward", because a bare
line cannot show either of the two things it exists to say.

- `RP.robotFrame()` → `{ ox, oy, cos, sin, ok }`, or `ok:false` rather
  than a guess when no drive axis has been set.
- `RP.robotFootprint()` → the body's points in ROBOT-LOCAL coordinates
  (origin at the turning centre, +x forward), computed once so a sweep
  never re-derives it per pose. The drive axis is excluded — it annotates
  the frame, and including it would put a phantom edge down the robot's
  centreline.

### Obstacles

`role:'obstacle'` on ordinary mat geometry, toggled from the right-click
menu, drawn red. Reuses the mechanism field walls already use, so
obstacles are drawn, constrained and solved with the tools that exist and
move with the sketch. `RP.obstacleSegments()` collects them as flat
segments with arcs pre-flattened, so the collision sweep does not
re-flatten the same curve for every sampled pose.

An obstacle is a BARRIER, not a filled region — the agreed scope. A solid
block is its outline, which behaves correctly unless the robot starts
inside one.

### Save files and undo

Save files go to v6. `sketch`/`construction` still hold the MAT, so a v5
reader still opens them, with the robot alongside in `robotDoc`. Both are
serialized BY NAME rather than from whatever is active — saving with the
robot open must not write the robot into the mat's slot, which is a test.
Undo snapshots carry both documents plus which was active, since undoing
a robot edit while looking at the mat would be baffling.

### Verification

12 suites (new `documents.js`, 19 tests) — 316 tests total, all passing.
Covers: geometry not leaking between documents, independent solver state
and DOF, save/undo round trips, saving from the robot still writing the
mat correctly, pre-v6 files getting an empty robot rather than a missing
one, a previous project's robot not surviving a load, the frame and
footprint including the rotated case and the drive-axis exclusion, and
Route mode forcing the mat both ways.

Verified in Chromium against the real 289-entity project: the Mat/Robot
buttons switch documents (85 mat lines ↔ 5 robot lines), the Route button
disables on the robot, the frame and footprint read correctly through the
real UI, tagging an obstacle produces segments, and a save/load round trip
restores both documents. Two bugs the screenshot pass caught: the mat's
field-boundary rectangle was being drawn over the robot document, and the
route was still listed in the geometry list there. Both fixed.

### Next

Phase 2 is the sweep itself — integrate `RP.computeSteps()` into a pose
track, put the footprint at each pose, test against `obstacleSegments()`,
and report collisions as warnings. Phase 3 is uncertainty growth with
per-axis resets at wall aligns and line traces.

---

# Changes — 2026-08-29 (2)

## QoL: "Straight" moves, direction-coloured arcs, hover-to-preview in both lists

### "Forward" moves are now labelled "Straight"

A move along a straight line is driven forwards *or* backwards — the Drive
toggle says which — so calling the move itself "Forward" was saying the
wrong thing twice. Only the display label changed: `RP.MOVE_LABELS.forward`
is now `'Straight'`, while the KEY stays `forward`, which is what save
files, generated code and `RP.STEP_KIND_SPEED_KEYS` all key off. An
existing project loads and generates identical code.

### Arcs take the same blue/orange as straights

Route move colour now means one thing: which way the robot drives.

| | before | after |
|---|---|---|
| straight, forwards | blue | blue |
| straight, backwards | orange | orange |
| arc, forwards | yellow | **blue** |
| arc, backwards | yellow | **orange** |

The old dedicated arc colour meant a reversing arc looked exactly like a
forward one — the direction, the thing most worth seeing at a glance, was
the one thing the colour did not tell you. Line trace, wall align and
teleport keep their own colours: those say what the move *does*, which is
a different question from which way it goes.

### Hover to preview, click to select

Both the geometry list (Sketch) and the action list (Route) previously
only highlighted on click, so finding the row for a particular line meant
clicking through candidates and actually changing the selection each time.
Hovering a row now highlights what it points at on the canvas, and only a
click selects.

- `RP.hoverGeoId` / `RP.hoverActionId` (`js/core.js`) hold the previewed
  row. Deliberately transient: never saved, never pushed to undo.
- Rows set them on `mouseenter`/`mouseleave` and re-render the CANVAS
  only. Rebuilding the list on hover would destroy the very row the cursor
  is on and the preview would flicker off.
- Both are cleared when their list is rebuilt: the hovered row is removed
  without ever firing its `mouseleave`, so the preview would otherwise
  stick to geometry the cursor had long left.
- Covers lines, arcs, points, route moves, turns and checkpoints — every
  row type in both lists previews the same marker its selection uses.

The hover highlight is drawn WIDER than the selection highlight (11px vs
6px for a route segment; 4.5px vs 3px for construction geometry) and at
0.85 alpha. That looks backwards written down, and the first attempt did
it the intuitive way round — a thin, half-transparent hint. On a bright
photo of a competition mat it was invisible in a screenshot comparison.
Selection can afford to be subtle because the eye is already on the thing
that was just clicked; a hover preview is read while the cursor is over
the sidebar, metres away on screen, so it has to carry further.

### Also

`index.html`'s footer hint still read "WASD to pan" after panning moved to
the arrow keys. Now says "Arrow keys to pan".

### Verification

11 suites pass, 1 new test (action model 44→45) pinning the label/key
split: the label reads "Straight" while the stored move type, the
per-kind speed lookup and codegen all still key off `forward`.

Verified in Chromium against the real mat image with a four-move route
(straight forwards, straight backwards, arc forwards, arc backwards):
action rows read `Straight`, `Straight · rev`, `Arc`, `Arc · rev`, and
the canvas draws solid blue / dashed orange / solid blue / dashed orange
— the forward arc blue where it used to be yellow. Hover was checked by
before/after screenshot on both lists: hovering sets the hover id and
draws the halo without touching `selectedLineId` / `selectedActionId`,
moving the cursor away clears both the id and the halo, and clicking then
sets the selection as before.

---

# Changes — 2026-08-29

## Solver: lines no longer run away or collapse on auto-tangency, and the sketcher is ~10–50× faster

Both reported problems turned out to live in the solver, and both were
diagnosed against a real 289-entity / 272-constraint competition sketch
rather than a synthetic one.

### 1. Auto-tangency destroyed the line's length

Drawing a line off an arc end auto-adds a `tangent_at` constraint, whose
residual is `(p − c)·û` — the radius vector dotted with the line's UNIT
direction. That expression is scale-invariant in the line's length: the
constraint says nothing whatsoever about how long the line is, and its
Jacobian is correspondingly flat along that direction.

So when the line was drawn far from tangent, the only correction the
solver had was to walk the far end sideways — and swinging a line by
translating one end changes its length as a side effect, with nothing
pushing back. Measured on the real sketch: drawing a **200px** line
radially off an arc end (the worst case, 90° from tangent) produced
lines of **2900, 3178, 6306, 10722 and 3688 px**. Driven the other way
the same null direction collapses the line toward zero, and at `L < EPS`
`tangent_at` hard-zeroes both its residual and its Jacobian — vacuously
satisfied, no gradient back out, and every other constraint touching
that line now unsatisfiable. That is the "conflicting constraints" that
only a manually-added length constraint could rescue, and it explains
why a line drawn already-close-to-tangent was fine: it started in the
right basin and never had to make the trip.

`RP.seedTangentLine` (`js/model/construction.js`) now rotates the new
line about the shared end BEFORE the constraint goes on, setting the
angle exactly while leaving the length untouched. Purely a starting
guess — same trick `rescueFlatArcs` already uses for runaway arc centres
— so the constraint is still added and the solver still has the last
word. All five real-sketch cases above now come out at exactly
**200.000**, tangent to machine precision (radius·direction cosine
≤ 2.3e-15).

### 2. The sketcher was spending almost all its time achieving nothing

`tol` is an ABSOLUTE residual of 1e-9. The real sketch's coordinates run
to 126,102 px, where 1e-9 is finer than a double can represent — so the
convergence test could never trip, no matter how well solved the sketch
was. Two consequences, both pure waste:

- **The damped-retry search ran to exhaustion.** λ starts at 1e-6 and
  ×4s until it passes 1e12 — about 30 iterations, each a full O(n³)
  factorisation on a 390-parameter system. A sketch that was *already
  converged* burned **34 factorisations** to rediscover that it could
  not improve. Since damping only ever shrinks the step, a step the
  first few retries cannot find, more of them cannot either.
- **The main loop ran its full iteration budget.** A drag reached a
  residual of 1.9e-7 in five iterations, then spent twenty-five more
  taking it to 1.7e-7 — five times the time for no visible difference.

Fixed with three bounded exits that do not change what "solved" means:

- `RP.Sketch.MAX_LM_RETRIES` (12) caps the retry search.
- A step-size floor, derived from the actual coordinate magnitudes
  rather than `charLength` (a fixed 100 that says nothing about a
  mat-sized sketch), abandons a retry once the damped step is
  indistinguishable from float noise.
- A diminishing-returns exit: once the residual is already under
  `conflictTol` — a millionth of a pixel — stop when an iteration cannot
  improve it by 10%. Real convergence moves in orders of magnitude per
  step (1e-2, 1e-3, 1e-5, 1e-7), so this only ever fires on the polish
  phase. It deliberately does NOT apply above `conflictTol`, so a
  genuine contradiction is still driven to a conflict verdict.

Separately, `RP.addConstructionLine` called `RP.solveSketch()` twice
unconditionally; the second is a no-op unless a tangent was actually
added, and it is now skipped otherwise. On a mat-sized sketch that alone
was half the cost of drawing a plain line.

### Measured (Chromium, the real project file loaded through the app)

Drawing a 200px line radially off an arc end:

| arc | before | after | speedup | length before | length after |
|-----|--------|-------|---------|---------------|--------------|
| 201 | 752ms  | 74ms  | 10×     | 2900.7        | 200 |
| 244 | 702ms  | 31ms  | 23×     | 3177.9        | 200 |
| 251 | 1231ms | 24ms  | 51×     | 6306.3        | 200 |
| 267 | 875ms  | 24ms  | 36×     | 10722.1       | 200 |
| 307 | 875ms  | 25ms  | 35×     | 3688.0        | 200 |

In the Node harness on the same file: drawing a plain line 749ms → 41ms
(18×); a converged re-solve 440ms → 54ms; dragging a point 1013ms →
374ms (2.7×).

Dragging is the weakest of these and is honestly reported as such: its
remaining cost is a pinned solve that genuinely fails to converge (8
iterations to establish that the pin is unsatisfiable) before falling
back to the free solve. Shortening that is not safe to do blindly, and
the dense O(n³) factorisation at n=390 is the real floor underneath it —
exploiting the Jacobian's sparsity is the next real win, and deserves
its own pass.

### Verification

11 suites pass, 9 new tests (arcs 29→34, sketch solver 25→29).

The tangency tests were confirmed to genuinely catch the bug: with
`seedTangentLine` disabled they fail with the drawn 200px line coming
out at 2315px. The solver tests cover a mat-scale sketch still
satisfying its constraints, a converged sketch exiting in ≤3 iterations,
the retry cap still reaching a solution from a deliberately inside-out
start, and a real contradiction still being reported as conflicting.

---

# Changes — 2026-08-25 (2)

## WASD panning dropped for arrow-keys-only; A and D now match FreeCAD

Panning previously worked on both WASD and the arrow keys, which is why
the Constrain tool's shortcuts couldn't use 'a' or 'd' — they were
reserved everywhere. Panning is now arrow-keys-only, which frees 'a' and
'd' to match FreeCAD's own layout:

- `D` — the merged Dimension head (was `K`): line length, point-point
  distance, point-to-line distance, radius, or angle between two lines,
  same dispatch as before, just back on FreeCAD's own key.
- `A` — a new merged head, `align`. Horizontal and Vertical take the
  identical selection (one line), so unlike Coincident/Dimension this
  can't dispatch on selection shape — instead it applies whichever the
  selected line is already closer to. `H`/`V` still apply a specific one
  directly and are unchanged.

`RP.CONSTRAINT_MERGED.align` and the geometric dispatch live in
`js/ui/sketch-ui.js`, alongside the two merged heads from the previous
change. `js/events.js`'s pan switch dropped its `w`/`a`/`s`/`d` cases
entirely, keeping only the four arrow keys.

### Verification

3 new constraint UI tests (align resolving by line orientation, applying
the resolved type rather than the merged head, and rejecting a selection
that fits neither) — 36/36 in that suite, all 11 suites pass. Verified
in Chromium: WASD no longer moves the canvas at all in the Constrain
tool, the arrow keys still do, `A` on a mostly-horizontal line applies
`horizontal`, and `D` on a point+line applies `point_line_distance`.

---

# Changes — 2026-08-25

## Code-config fields collapsed into one table

Adding a code-config field (like the per-move-kind speeds) used to mean
hand-editing five separate places, each naming the field by itself: the
`<input>` in `index.html`, a default in `RP.DEFAULT_CODE_CONFIG_VALUES`,
a backfill line in `RP.ensureCodeConfig` (for old saves), a read line in
`RP.updateCodeConfigFromUI`, a write line in `RP.updateCodeConfigUI`, and
— easiest of all to forget, since nothing errors when you do — an entry
in a hardcoded id array in `js/events.js` that wires up the field's DOM
listeners. That last one is exactly what went missing when the per-kind
speeds first shipped: the fields exist, read and wrote correctly by
direct call, and simply didn't respond to being typed into, because
nothing had bound a listener. A real bug, caught only by a browser pass,
not by the unit suite.

That's now one table: `RP.CODE_CONFIG_FIELDS` (`js/core.js`), a list of
`{ key, id, kind, default, stepKind? }` — one row per field, saying its
`<input id>`, how its raw string becomes a stored value (`text` falls
back to `default` when blank, `blank` is stored verbatim including
`''`, `posNum` is a positive number falling back to `default`,
`posNumOrNull` is a positive number or `null`), its default, and — for
the six per-move-kind speeds — which `RP.computeSteps()` step kind it
overrides the speed for.

Everything that used to name fields individually now walks this table:

- `RP.DEFAULT_CODE_CONFIG_VALUES` and `RP.codeConfig` (`js/core.js`) are
  both built from it, so `RP.codeConfig` is now fully populated at boot
  — no field is `undefined` before the first `ensureCodeConfig()` call
  anymore, only meaningfully blank/`null`.
- `RP.ensureCodeConfig`, `RP.updateCodeConfigFromUI`, `RP.updateCodeConfigUI`
  (`js/config.js`) all iterate the table instead of naming each field.
- `RP.STEP_KIND_SPEED_KEYS` (`js/output.js`) is derived from the table's
  `stepKind` entries rather than kept as a second, separately-maintained
  map of the same six pairs.
- The DOM-listener wiring in `js/events.js` iterates the table too — a
  new field now wires itself up for free. This closes off the exact bug
  class described above: there is no longer a second list to remember.

Net effect for adding a field going forward: one row in
`RP.CODE_CONFIG_FIELDS`, one `<input>` in `index.html`. Nothing else.

Pure refactor — no behavior changed for any existing field, no save-file
format change (`RP.DEFAULT_CODE_CONFIG_VALUES` has the same keys and
values as before, just generated instead of typed out).

### Verification

All 11 suites pass unmodified, including golden codegen (byte-identical
output — confirms no field's default or fallback behavior shifted).
Verified in Chromium end-to-end, reproducing the exact failure mode this
refactor closes off: opened the Robot & Code panel, typed `333` into
"Forward" under per-move-kind speeds via a real DOM `fill` + `change`
event (not a direct function call), and confirmed the generated code
came out `power=333` on the forward move while an untouched turn stayed
at the plain default `power=200` — the full path from keystroke to
generated code, through the newly-generic listener wiring.

---

# Changes — 2026-08-24

## FreeCAD-style merged constraints; WASD/arrow keys reserved for panning

### Merged constraint heads

The palette used to expose every constraint type as its own button, which
meant knowing in advance whether the thing you wanted was "Coincident",
"Point on line", "Point on arc", "Distance", "Distance to line" or
"Radius" — six buttons for what a sketcher user thinks of as two ideas.
FreeCAD collapses these: you select geometry, hit one key, and the tool
works out which constraint that selection can actually mean.

Two merged heads now do the same here:

| Head | Selection | Constraint actually applied |
|---|---|---|
| **Coincident** (`C`) | 2 points | `coincident` |
| | point + line | `point_on_line` |
| | point + arc | `point_on_arc` |
| **Dimension** (`K`) | 1 line | `distance` (its length) |
| | 2 points | `distance` |
| | point + line | `point_line_distance` |
| | 1 arc | `radius` |
| | 2 lines | `angle` |

The merge is **entry-point only**. `RP.CONSTRAINT_MERGED` /
`RP.resolveConstraintType` (`js/ui/sketch-ui.js`) sit in front of
`applyConstraint`, `promptConstraint` and `canApplyConstraint`; the
solver, the saved `.json`, the constraint list, the on-canvas badges and
every existing caller still deal exclusively in the specific type.
Anything that isn't a merged head — and a merged head whose selection
fits none of its members — resolves to itself, so resolution is safe to
call blindly and no existing code path changed behaviour.

Dispatch order matters for one genuinely ambiguous case: a single
selected line fits both `distance` (its length) and `angle` (to
horizontal). Length is the far commoner intent, so it wins under `K`, and
`angle` keeps its own key for the other reading.

Palette buttons dropped as redundant: Point on line, Distance to line,
Point on arc, Radius. Their constraints are unchanged and still fully
reachable — through the merged heads, and in existing save files.

### Keyboard

W/A/S/D previously panned the canvas *except* under the Constrain tool,
where `d` meant distance and `a` meant angle. Navigation silently
changing meaning based on the active tool is the wrong trade, so W/A/S/D
are now unconditionally reserved for panning and the two offending
shortcuts moved:

- `K` — dimension (was `D`)
- `N` — angle (was `A`)
- `T` — tangent (new; previously palette-only)
- `O` — dropped (point-on-line now lives under `C`)
- `C`, `H`, `V`, `L`, `E` — unchanged

Arrow keys now pan too, identically to WASD and equally unconditionally.

### Files

- `js/ui/sketch-ui.js`: `RP.CONSTRAINT_MERGED`, `RP.resolveConstraintType`;
  `applyConstraint`/`promptConstraint`/`canApplyConstraint` resolve first.
- `js/events.js`: remapped `CONSTRAINT_KEYS`; arrow keys added to the pan
  switch.
- `index.html`: palette trimmed to 8 buttons, titles updated with the new
  keys and the selections each head accepts.

### Verification

11 suites pass, 33/33 in the constraint UI suite (5 new: dispatch for
every member of both heads, a merged head storing the *specific* type
with a correctly unit-converted value, button-enable state following the
group, and non-merged types resolving to themselves).

Verified in Chromium against the real UI: the palette renders the
expected 8 buttons; with a point and a line selected both the Coincident
and Dimension buttons light up; clicking Dimension and entering a value
stores a `point_line_distance`; pressing `K` with an arc selected stores
a `radius`; pressing `C` with two points selected stores a `coincident`.
With the Constrain tool active — the case that used to break — `A`/`D`
and the arrow keys all pan the canvas as expected.
---

# Changes — 2026-08-22 (5)

## Fix: the route action list had no scrollbar

`#action-list` (Route mode's list of moves/turns/checkpoints) had no
`overflow` rule at all, and its parent, `#left-sidebar`, is
`overflow:hidden`. A route with enough actions to exceed the sidebar's
height just had the excess silently clipped — no scrollbar, and the
`↻ Turn` / `🏁 Checkpoint` / `⇄ Reverse route` buttons below it could get
pushed out of view entirely with no way to reach them.

`#route-mode-section` is the sole visible sidebar section in Route mode
(`RP.setEditMode` hides everything else), so this gives it the same
treatment `.layers-section`/`#layer-list` already has for the sketch
geometry list: the section becomes a flex column filling the sidebar's
full height, and `#action-list` alone gets `flex:1; overflow-y:auto` —
it scrolls while the header, hint, and button rows around it stay put.

CSS only; no JS or model changes.

### Verification

12 suites pass (unaffected — CSS only). Verified in Chromium with a
25-move route in a deliberately short viewport: list content (450px)
exceeded its visible area (275px), `overflow-y` computed to `auto`,
scrolling actually revealed the later items, and the Reverse route
button stayed within the sidebar's bounds instead of being pushed off
the bottom.

---

# Changes — 2026-08-22 (4)

## Per-move-kind default speeds

The fallback chain for a step's speed used to have two rungs: the
action's own typed Speed, else one plain global Default Speed shared by
every move, turn, arc, wall align and line-trace step. A wall approach
and a straight-line drive rarely want the same number, and the only way
to say otherwise used to be typing an explicit speed onto every single
action of that kind.

Added a third rung in between: six new, independently-optional defaults
in the Robot & Code panel — Forward, Turn, Arc, Wall Align, Line Trace
Dist, Line Trace Junct — under a new "Default speeds per move" section.
Each is blank by default and falls back to the plain Default Speed field
above it when left blank; an action's own explicit speed still beats
both.

- `js/core.js`: `defaultSpeedForward`/`Turn`/`Arc`/`WallAlign`/
  `LineTraceDist`/`LineTraceJunct`, all `null` in
  `DEFAULT_CODE_CONFIG_VALUES` — same "blank is meaningful, only backfill
  when the key is entirely absent" treatment as the existing pivot-turn
  templates, so an old save file is unaffected rather than silently
  gaining speed overrides it never asked for.
- `js/output.js`: `RP.STEP_KIND_SPEED_KEYS` maps each step kind to its
  codeConfig field; `spd(st)` now checks the action's own speed, then
  that kind's default, then the plain global default, in that order.
- `js/config.js`: new `_posNumOrNull` helper — unlike the existing
  `_posNum`, a blank/invalid field must stay `null`, not collapse to a
  fallback number, or a deliberately-blank override could never be told
  apart from one that happens to numerically match the global default.

### A bug the browser pass caught before it shipped

The six new inputs' `change`/`input` listeners are wired from a
hardcoded id list in `js/events.js`, not delegated — every existing
`code-*` field is already in that list, and the new ones simply weren't
yet. Typing into a fresh field silently did nothing until this was
added; a plain unit-test pass (which calls `RP.updateCodeConfigFromUI`
directly, never through a real DOM event) would not have caught it. This
is exactly the class of bug the Chromium verification pass exists to
catch.

### Verification

12 suites pass, goldens byte-identical (the feature is opt-in — nothing
changes for a project that never sets one of the six fields).
`action model` gained 5 tests (39 → 44) covering fallback-chain order and
per-kind isolation; `field + wall align` gained one for
`defaultSpeedWallAlign` specifically (18 → 19).

In Chromium: opened the Robot & Code panel, confirmed all six fields
render blank; typed a Forward-only override, confirmed it reached
`move_distance` calls but not `turn_in_place` calls in the generated
code; closed and reopened the panel and confirmed the value persisted
rather than resetting to blank. No console errors.

---

# Changes — 2026-08-22 (3)

## Fix: an already-solved sketch could be permanently stuck reporting "conflict"

A user-supplied project loaded with `sketch.status === 'conflict'` (dof
14, residual ~1.6e-8) despite the geometry being, by every visual and
practical measure, fully solved. Traced it to one arc sitting between two
construction lines (an S-curve): its start point was pinned by
`point_on_line` onto one line AND `tangent` to that same line, while its
end point was `coincident` with a second line's endpoint AND `tangent`
to that line too. That cluster is exactly-determined — zero slack — so
the two independently-measured radii (arc-center to each endpoint)
agreed to 10 significant figures (`2164.893383848816` vs
`2164.8933838664593`) but could never be driven to bit-for-bit equal.
300 solver iterations and manually nudging the arc's center didn't
change the outcome: this is not a slow-convergence problem, it's a
tolerance problem.

`RP.Sketch.solve` (`js/sketch/solver.js`) used ONE tolerance for two
different jobs: deciding when to stop refining, and deciding whether the
result counts as a conflict. A cluster with no slack can get stuck a
hair above any tolerance, however tight, purely from float noise carried
in from a save/load round-trip or an earlier drag — so tightening the
number further would never have helped; it would only take longer to
fail the same way.

Split into two: `opts.tol` (default 1e-9, unchanged) still governs how
hard the iteration chases full precision, so ordinarily-solvable sketches
solve to the same precision as before. `opts.conflictTol` (new, default
1e-6) is a separate, looser threshold used only to LABEL the outcome — a
residual has to miss by six orders of magnitude more than machine noise
before it's called a conflict. 1e-6 px is still meaningless at the mm
scale this app actually measures in; a real contradiction (mismatched
dimensions, etc.) misses by many more orders of magnitude than that, so
genuine conflicts are caught exactly as reliably as before.

### Verification

12 suites pass; `sketch solver` gained two targeted tests (23 → 25): one
proving an impossible `tol: 0` no longer falsely reports conflict now
that classification is separate from iteration, one proving a real
50-unit dimension mismatch still reads as conflict even with a
deliberately loose `conflictTol`. The reporting user's actual project
file (loaded via the Node test harness, no browser needed for this part)
now solves to `status: 'under'`, `ok: true` — previously `'conflict'` —
and its route resolves. Confirmed in Chromium via the app's real
open-project path plus several small drags of the arc's center point:
status stays `'under'` throughout, never flashes to `'conflict'`. No
console errors.

---

# Changes — 2026-08-22 (2)

## New default code templates, wall_align expected_distance, per-action extra args

### Default templates

The defaults now match the target robot API's actual calling convention:

- Forward: `robot.move_distance({distance}, power={speed})` (was
  `robot.move_distance(distance={distance}, speed={speed})`)
- Turn: `robot.turn_in_place({angle}, power={speed})` (was
  `robot.turn_arc(angle={angle}, speed={speed})` — turn and arc used to
  share a function name, which was never right for a plain spin)
- Wall align: `robot.wall_align(reversed={reversed}, power={speed},
  expected_distance={expected_distance})`
- Arc's default (`robot.turn_arc(angle={angle}, speed={speed},
  radius={radius})`) is untouched — it already had the right shape.

These are just the *shipped defaults*; the Robot & Code panel's template
fields are unchanged and still fully user-editable, so an existing
project that already customized its templates is unaffected — this only
changes what a brand new project starts with.

### `{expected_distance}` for wall_align

The point-line-distance solver already knows exactly how far a wall_align
leg is once its exit point is pinned `clearance` off the wall — this
change just hands that number out. The idea: a real robot can use it to
start slowing down on approach instead of driving at `wall_align` speed
blind for the whole leg, and only backing off once it actually feels the
wall. Computed in `RP.computeSteps` alongside every other wall_align
step (`js/output.js`), so it's always the solved distance, not a stale
one — changing `frontClearance`/`rearClearance` and re-solving moves it
right along with the stopping point.

### `{extra_args}`: per-action free text

Every move, turn and checkpoint now carries its own `extraArgs` string
(default blank), editable from an "Extra args" field in that action's
detail panel in Route mode. It's spliced verbatim into `{extra_args}`
wherever that token sits in the action's own template — literally
whatever the user types, comma and all, so it fits whatever position a
project's own template puts it in.

This is deliberately not a structured key/value system: the app can't
anticipate what a given robot API needs (`blocking=True`, a retry count,
a per-move sensor threshold, ...), so instead of guessing at a schema,
the user just writes the Python (or whatever) themselves and the
template splices it in raw. Blank is the default and vanishes cleanly —
existing projects and routes are unaffected until someone types
something.

Added `{extra_args}` to every templated line except arc's (arc's default
is intentionally untouched, per above — a user who wants extra args on
arc moves can add the token to their own custom arc template, the
substitution already handles it either way).

### Verification

12 suites pass. All 7 golden fixtures were regenerated (`node
tests/golden.js --update`) and the diff reviewed line by line — every
change is exactly the template-text swap above, nothing else moved.
`action model` gained extraArgs tests (34 → 39); `field + wall align`
gained expected_distance tests (14 → 18).

In Chromium: typed extra args into a move, a turn, and a checkpoint via
their real detail-panel inputs and confirmed each one lands only on its
own generated line, never bleeding onto a neighboring action; confirmed
a wall_align move emits `expected_distance=<solved leg length>`. No
console errors.

---

# Changes — 2026-08-22 (1)

## Hide route lines, not just construction lines

Hiding construction geometry (previous entry) solved overlapping raw
lines, but a route's own thick line has the same problem: two route
moves a few pixels apart still fight for the cursor, and there was no
way to get one out of the way to reach the other, or the construction
guide underneath.

A move is a separate thing from the construction line it draws — you
might want to hide the route's use of a line while leaving the line
itself, or its own hide state, completely alone. So this is a second,
independent `visible` flag, on the move action, not a read of the
entity's.

- **Model**: `js/model/action.js` — `makeMoveAction` now sets
  `visible: opts.visible !== false` on every move (was a dead `hidden`
  field nothing ever set — see below).
- **Hiding a move frees its entity.** `RP.routeReferencedEntities()`
  skips hidden moves, so `render.js`'s "route mode dims/skips geometry a
  route already draws" logic stops skipping it — the construction-line
  guide reappears right where the route line used to cover it. This is
  the actual point of the feature, not just a cosmetic toggle that would
  otherwise leave a blank gap.
- **Nearest wins, hidden-skip**, in both `routeHitTest` (left-click) and
  the Route-mode-aware right-click pass — same rule already used for
  construction geometry, now applied to moves too, and checked ahead of
  the construction-geometry pass since a route's use of a line is the
  more specific target while in Route mode.
- **Three ways to toggle it**, all going through the one model call
  (`RP.setMoveProps`):
  - the action list gets an eye icon per move row, reusing the same
    `.layer-vis-btn` the geometry list already uses;
  - the move's detail panel gets an "On canvas" toggle next to Drive;
  - right-click a route move for a Route-mode-aware context menu with
    **🙈 Hide** / **🗑 Remove from Route** (label changes from the
    construction-geometry menu's "Delete", since removing a move from a
    route and deleting geometry are different actions).

### A pre-existing bug this uncovered

`render.js` already had `if (seg.visible === false) continue;` gating
route-segment drawing — but the model populated the field as `hidden`,
which nothing ever set. The gate was dead code; hiding a move could
never have worked even before this change built the UI for it. Fixed by
renaming the model's field to match what the renderer already expected,
rather than changing the renderer to match a name nobody chose on
purpose.

v4 save files spelled this field `hidden` too (and never actually let
you set it from the UI). `liftElementsToActions` now translates it
explicitly (`el.visible = el.hidden !== true; delete el.hidden;`) rather
than assuming it was always false.

### The one thing this must never touch

Hiding is presentational only. `RP.generateCode()` / `RP.computeSteps()`
never read `.visible` — a hidden move still drives the robot exactly as
before. This is asserted directly: `action model` now has a test that
generates code with a move hidden, shown, and hidden again, and checks
the output is byte-identical every time.

### Verification

12 suites pass, goldens byte-identical; action model tests 27 → 34.

In Chromium, two overlapping route moves on parallel lines 6 px apart:

```
routeHitTest         nearer move wins, not whichever was added first
Eye toggle (list)     hides move -> hit-test falls through to the other move
On canvas (panel)     same toggle, same effect, from the detail panel
Right-click           title "Route move N", labels "Hide" / "Remove from
                       Route" (not generic "Delete"), Hide works
```

No console errors from the feature itself. Bundle rebuilt.

---

# Changes — 2026-08-09 (12)

## Clicking a line now focuses it in the list too

The previous change made the geometry list select geometry on the
canvas. This closes the other direction: clicking geometry on the canvas
now selects and scrolls to its row in the list.

- **Select mode** could not select a line at all before this — only its
  endpoints, for dragging. Clicking anywhere along a line's body (or an
  arc, or a standalone point) now focuses it in the list, the same
  nearest-wins rule the right-click menu and Route mode already use.
- **Constrain mode** already picked geometry for constraint application;
  it now also syncs the list, for lines, arcs and *standalone* points. A
  line's own endpoint is not a row in the geometry list, so clicking one
  leaves the list alone rather than focusing nothing.
- **Route mode**: clicking a line now focuses its row whether the click
  added it to the route or selected an existing move — both paths used to
  leave the list wherever it last was.

New `RP.focusGeometryInList(id)` is the one place this lives: sets the
selection, rebuilds the list, **un-collapses the panel** if it was
collapsed (focusing a line while its list is folded shut would select
something you can't see), and scrolls the row into view with
`scrollIntoView({ block: 'nearest' })` so a focus in a long list is
actually visible rather than merely true.

### Verification

11 suites pass, goldens byte-identical; construction tests 37 → 39.

In Chromium, 13 lines (enough to scroll the list) with the 13th far down
the list and off in a different part of the canvas:

```
Select mode     click line body   -> selectedLineId matches, row active, SCROLLED INTO VIEW
Constrain mode  click line        -> selectedLineId matches, sketchSelection also has it
Route mode      click line        -> appended to the route AND focused in the list
Collapsed panel click line        -> panel auto-expands
```

No console errors. Bundle 325 KB.

---

# Changes — 2026-08-09 (11)

## Hide geometry so overlapping lines stop fighting for the cursor

Two lines a few pixels apart made routing miserable: clicking picked
whichever the loop happened to reach first, and there was no way to get
one out of the way.

### Hiding

- **Right-click any construction geometry → 🙈 Hide.** Right-click now
  finds arcs and standalone points too, not just lines — it would have
  been odd for Hide to work on one kind of geometry only.
- **The geometry list is shown in Route mode**, not just Sketch mode. It
  is how you hide a line that overlaps the one you are trying to click,
  and the only way to bring a hidden one back. Constraints stay a
  Sketch-mode panel.
- **Clicking a list row highlights that geometry on the canvas** in Route
  mode as well. Route mode dims geometry to a guide, and that dimming was
  unconditionally overriding the selection colour, so the list could not
  be used to find anything. A line already used by the route highlights
  through its route segment, so the row never appears to do nothing.

### Hidden now genuinely means inert

Hiding only drew nothing before — the geometry still answered clicks and
still pulled the snap. All of these skipped hidden lines already, or do
now:

| | before | now |
|---|---|---|
| snap: endpoints | ✗ | ✓ |
| snap: intersections | ✗ | ✓ |
| snap: along-line projection | ✗ | ✓ |
| Select-mode endpoint grab | ✗ | ✓ |
| Route-mode click | ✓ | ✓ |
| Sketch-mode click | ✓ | ✓ |
| right-click menu | ✓ | ✓ |

(Arcs and points were already filtered everywhere; lines were the gap.)

### Nearest wins

Both the Route-mode hit test and the right-click menu returned the *first*
geometry within range rather than the nearest. With two overlapping lines
"first" is entity-creation order — arbitrary, and wrong half the time.
Caught in the browser: right-clicking nearer the lower of two lines
offered to hide the upper one. Both now pick the nearest.

### Also fixed

`refreshRouteUI` did not refresh the geometry list, so entering Route mode
showed whatever the list held when it was last built. Harmless while the
list was Sketch-only; not harmless now.

### Verification

11 suites pass, goldens byte-identical. `tests/construction.js` 32 → 37,
boot 15 → 16.

In Chromium, two lines 8 px apart:

```
click at y=297 -> TOP(y=296)          nearest wins
click at y=303 -> BOTTOM(y=304)
right-click y=303 -> hides BOTTOM     the nearest one
  now y=303 hits  -> TOP              hidden one no longer competes
  snap at y=303   -> projects onto TOP, not the hidden line
list shows        -> ● Line 1   ○ Line 2
un-hide from list -> 0 hidden
highlight from list -> selects and draws yellow
```

No console errors.

---

# Changes — 2026-08-09 (10)

## Projects are files now — localStorage is gone

The Saved Maps tray stored whole projects in `localStorage`: mat photo as
base64, plus routes, calibration and config. Mat photos are high
resolution, so one project was roughly all that fit under the ~5 MB
quota — which rather defeats the point of a list of *saved projects*.
It was also the only save that never left the machine, because
`localStorage` belongs to the browser, not to the HTML file.

So it is all files now, and only files.

### File menu

| was | now |
|---|---|
| 📂 Open Image | 🖼️ Open Image |
| 💾 Save Map (→ localStorage) | 💾 **Save Project** (→ `.json`) |
| 📂 Load Map (→ reveal the tray) | 📂 **Open Project** (→ file picker) |
| 📥 Export Project | *(merged into Save Project)* |
| 📤 Import Project | *(merged into Open Project)* |

Four confusingly-overlapping entries became two. Save and Open were
already doing the real work under the names Export and Import; they just
had a second, worse save path sitting next to them.

### Removed

- The **Saved Maps** panel and everything that fed it:
  `saveMapProject`, `loadMapProject`, `deleteMapProject`, `updateMapList`,
  `_buildSavePayload`, `_writeLocalStorage`
- `_forceMapPanel` and the mode-switch logic that revealed the tray in
  Sketch mode
- The quota-exceeded alert, which no longer has anything to warn about
- `.saved-project` CSS

`exportProject` / `importProject` became `saveProject` / `openProject`.
The on-disk `.json` format is unchanged, so existing project files open
exactly as before.

### Verification

11 suites pass, goldens byte-identical. A new boot check fails if
`localStorage` is ever *called* from a source file again (a mention in
prose is fine — `persist.js` explains why the switch happened), if any of
the removed functions come back, or if the old buttons and panel ids
reappear.

Driven through the real UI in Chromium, on both `index.html` and the
portable `dist/wro-planner.html`:

```
Save Project  -> My_Route.json, 32,434 bytes on disk
localStorage  -> [] (untouched)
wreck route   -> 0 moves
Open Project  -> 2 moves, generated code byte-identical
```

No console errors. Portable bundle is now 319 KB, down from 326 KB.

---

# Changes — 2026-08-09 (9)

## Equal constraint

Two lines the same length, or two arcs the same radius. Select a pair in
Constrain mode and press **E**, or use the new palette button.

The maths is two constraints already in the file, subtracted: line-line
is `distance` twice with opposite signs, arc-arc is `radius` twice. The
shared length-and-derivative bits came out into `spanLen` / `spanJacobian`
so `distance` and `equal` are not carrying two copies of the same
formula.

**Same type only.** A line's length and an arc's radius are not the same
quantity, so pairing them means nothing — `accepts` refuses it and the
palette greys out, the same rule FreeCAD uses. Pairs only, too: selecting
three lines does nothing rather than quietly applying two constraints.

### Where it touched

Exactly what the registry design promised, and no solver change:

| file | what |
|---|---|
| `js/sketch/constraints.js` | the constraint, plus two extracted helpers |
| `js/ui/sketch-ui.js` | selection→refs case, list icon, canvas badge |
| `index.html` | 12th palette button |
| `js/events.js` | `E` shortcut — the key was free |

### The part worth knowing

Equality is the constraint most likely to make a sketch **redundant**:
`equal(A,B) + equal(B,C) + equal(A,C)` is one equation too many, and
chaining is the natural way people reach for it. That is diagnosed
correctly — `redundant`, not `conflict`, and there is now a test pinning
that — but the status is still aggregate. It cannot say *which* of the
three to delete. That is objection 9 in the plan doc, deferred as needing
QR with column pivoting or SVD, and `equal` will make you meet it far
more often than `distance` or `angle` did.

### Verification

Both Jacobians checked against central differences (worst error 1.4e-8
line-line, 7.2e-9 arc-arc) before anything was wired up. 11 suites pass;
solver tests 18 → 23, constraint UI 25 → 28.

In Chromium, through the real UI: shift-click two lines and press `E`
(180 mm → 400 mm), palette button on two arcs (R 52 → R 131), and a line
paired with an arc refused with a message rather than a crash. The `=`
badge draws on the canvas and in the constraint list rather than falling
through to the `?` glyph. No console errors.

---

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
