# WRO RoboMission Route Planner

A single-page offline web app for planning and generating autonomous robot movement code from a photograph of the WRO competition mat.

> **Context:** Built for WRO RoboMission Senior 2026 — ["Mosaic Masters"](#what-is-wro-robomission-senior-2026).

---

## ⚠️ AI Agent Instructions — Version Control

> **This project is under Git version control.** If you are an AI agent working on this codebase, you **must** use the local Git repository for all changes. Do not make edits without tracking them.
>
> ### Required Workflow for AI Agents
>
> 1. **Before making changes:** run `git status` and `git diff` to understand the current state.
> 2. **For every logical change:** create a commit with a descriptive message.
>    ```bash
>    git add -A
>    git commit -m "<type>: <short description>"
>    ```
>    Use conventional commit types: `feat:`, `fix:`, `refactor:`, `docs:`, `style:`, `chore:`.
> 3. **After completing a task:** verify with `git log --oneline -5` that your commits are clean and well-described.
> 4. **Never force-push or rewrite history** unless explicitly instructed.
> 5. **Read `AUDIT.md`** before making changes — it documents known bugs and the intended fix order.
> 6. **Keep `CHANGES.md` updated** with a summary of what you changed and why.
>
> ### Example Commit Messages
>
> ```
> feat: add virtual robot footprint overlay to waypoints
> fix: prevent keydown hijack when focused in text inputs
> refactor: extract computeSteps as single source of truth
> docs: update README with usage quickstart
> ```

---

## Why This Exists

### The "Shotgunning" Problem

WRO RoboMission introduces **surprise rules** on competition day — an extra mission or modified constraints revealed only at the event. After the reveal, teams have limited time (typically 2 hours) and **very few practice runs** to adapt their robot code. The conventional approach of "eyeballing distances, guessing angles, running the robot, hoping it works" — shotgunning — wastes precious runs on mechanical errors instead of logic bugs.

This tool replaces estimation with **measured precision**: overlay a photo of the competition mat, calibrate a known distance, draw construction lines for reference points, and plan routes. The tool then generates the exact `move()` and `turn()` calls so the robot goes where you intend on the first attempt.

### Designed for Offline Use

The competition venue may not have internet access, so there is nothing to fetch and nothing to install.

Working on the source, open `index.html` directly — it loads its modules as plain `<script src>` tags, so no server and no build step are needed.

To carry it around, run:

```bash
node build.js          # -> dist/wro-planner.html
```

That folds the stylesheet and all 18 scripts into **one self-contained ~320 KB HTML file** with no dependencies. Copy it to a USB stick, double-click it, and it works — no install, no admin rights, nothing for a school laptop's policy to block. `build.js` itself has no dependencies either; it is plain Node.

Projects are ordinary `.json` files — **File → Save Project** / **Open Project** — so they travel with you exactly as you'd expect: copy the file, copy the project. There is no in-browser project store to lose track of, and no size limit beyond what your filesystem has.

---

## What Is WRO RoboMission Senior 2026?

- **Theme:** "Robots Meet Culture" — **Mosaic Masters**
- **Objective:** Design and program a fully autonomous robot that helps restore a damaged mosaic. The robot transports tools, delivers building materials, and places coloured mosaic tiles on the competition field.
- **Key constraints:**
  - Fully autonomous — no remote control
  - Precision positioning is critical (tiles must be placed exactly)
  - Obstacles on the field, surroundings must be protected
  - A **surprise extra mission** is revealed at the International Final (October 8, 2026); local events may also have surprise rules
  - Robots are built from LEGO, typically programmed with EV3/SPIKE/Robot Inventor Python or block-based languages
- **Age group:** 14–19 (Senior)

---

## What This Tool Does

1. **Load a photo** of the WRO competition mat (drag-and-drop or file picker)
2. **Calibrate** by drawing a construction line on a known distance (e.g. the mat edge = 2362 mm) — establishes pixels-per-mm
3. **Draw construction lines** on reference points (mat corners, game object positions). Lines auto-label with mm lengths. Lines snap to each other's endpoints and intersections, with 90° angle snapping
4. **Create routes** — ordered sequences of waypoints drawn on the mat. Waypoints snap to construction-line features for precision. Midpoint insertion allows adding stops along existing legs
5. **Set robot config** — chassis dimensions, wheelbase, start position, and start heading
6. **Generate output:**
   - **Human-readable step-by-step instructions** (e.g. "Turn right 90°", "Forward 450 mm")
   - **Code template output** — customizable code generation with user-defined templates for `move()`, `turn_right()`, `turn_left()`, comment prefix, default speed, and unit (mm/cm/m/in)
   - Total distance summary
7. **Save/Open** projects as `.json` files (mat image + routes + calibration + config, all in one)
8. **Full undo/redo** (80 levels) for all edits

---

## Architecture

```
wro-route-planner/
├── index.html          # Single-page app shell (toolbars, canvas, panels, overlays)
├── style.css           # All styling — dark theme, hover-dropdown tabs, responsive panels
├── js/
│   ├── core.js         # Global state (RP namespace), DOM refs, geometry helpers,
│   │                     coordinate transforms, snap system, undo/redo, zoom/pan, tool switching
│   ├── render.js       # Canvas rendering — construction lines, routes, waypoints,
│   │                     route arrows, snap indicator, drag previews, robot start marker
│   ├── routes.js       # Route CRUD — create, delete, add/insert/remove waypoints,
│   │                     UI sync (dropdown + sidebar list)
│   ├── output.js       # Instruction generation + code template output
│   │                     (single computeSteps() source for both)
│   ├── persist.js      # save/open project as .json, image loading
│   ├── config.js       # Robot config panel, code template config UI, calibration
│   │                     prompt, recalibration
│   ├── events.js       # All mouse/touch/keyboard/button event handlers
│   └── main.js         # Bootstrap — ResizeObserver, initial state, init call
├── build.js            # Dependency-free build: inlines everything into
│                         dist/wro-planner.html for carrying around
├── AUDIT.md            # Detailed code audit with severity-ranked bugs (mostly resolved)
├── CHANGES.md          # Changelog: snap system rework + audit fix summary
└── README.md           # This file
```

### Module Dependency Order (load order in `index.html`)

```
core.js → render.js → routes.js → output.js → persist.js → config.js → events.js → main.js
```

All modules extend the shared `window.RP` namespace. `core.js` initializes the namespace and global state; `main.js` kicks off the app.

### Key Design Decisions

- **Snap targets are construction lines only** — route waypoints and segments are NEVER snap targets. This keeps the planning precise: you mark reference features on the mat first, then snap routes to those references.
- **Single source of truth for instructions and code** — `RP.computeSteps(route)` produces an array of `{kind:'turn', deg, dirRight}` / `{kind:'forward', mm}` steps consumed by both the on-screen instructions and the code generator.
- **All state in one namespace** — `RP.lines`, `RP.routes`, `RP.calibration`, `RP.robotConfig`, `RP.codeConfig`. Undo/redo snapshots and restores the whole thing.
- **Canvas is DPR-aware** — renders at native device resolution for sharp lines on HiDPI screens.
- **Two sketch documents, not one sketch with a role tag** — the mat (field geometry, routes, obstacles) and the robot body are separate `RP.Sketch` instances in unrelated coordinate spaces. The solver treats a sketch as one system, so a robot drawn into the mat would join the mat's DOF count, could be constrained to mat geometry, and would be dragged around by mat edits — a body and the field it drives over have nothing to solve together. `RP.sketch` / `RP.constructionMeta` always point at the ACTIVE document and the other parks in `RP.documents`, so every existing reader works unchanged. Both share one `RP.calibration`, which is what makes the robot's footprint directly comparable to mat coordinates.
- **The robot's frame comes from a drawn line, not numbers** — one line in the robot document tagged `role:'drive'` fixes both the origin (its start point is the turning centre) and the facing (it points forwards). One entity rather than two, because an axle alone leaves "which way is forward?" unanswerable and it cannot be guessed from a body outline. `RP.robotFrame()` / `RP.robotFootprint()` read it out; the footprint is expressed once in robot-local coordinates so a sweep never recomputes it per pose. Which end is the nose is stored as metadata (`flipped`), not by reordering the line's points — swapping `p1`/`p2` on the entity would silently negate any angle constraint measured against it.
- **Clearances are measured, not typed** — front and rear clearance ARE the body's overhang from the turning centre, so once a robot is drawn `RP.robotExtentsMm()` supplies them and the manual fields are disabled. Two numbers that could disagree with the drawing become one that cannot. The typed fields remain the fallback for projects with no robot drawn.
- **The solver stops when iterating stops paying, not at a fixed tolerance** — `tol` is an absolute residual, but coordinates are not: a mat-sized sketch runs to six figures of pixels, where 1e-9 is finer than a double can represent, so a perfectly-solved sketch could never trip it and re-ran its whole iteration budget on every solve. `RP.Sketch.solve` therefore also exits when the residual is already under `conflictTol` and a further iteration cannot improve it by 10%, and caps the damped-retry search at `RP.Sketch.MAX_LM_RETRIES` (each retry is a full O(n³) factorisation, and damping only ever shrinks the step). Genuine conflicts are unaffected — the diminishing-returns exit only applies below `conflictTol`.
- **Auto-tangency seeds the geometry before constraining it** — `tangent_at`'s residual `(p−c)·û` says nothing about how long the line is, so the solver reaching tangency by swinging the far end changes the line's length as an unopposed side effect. `RP.seedTangentLine` (`js/model/construction.js`) rotates a freshly-drawn line about the arc end it joins first, setting the angle exactly and leaving the length alone. It is only a starting guess; the constraint still goes on afterwards and the solver still has the last word.
- **Code-config fields are table-driven** — `RP.CODE_CONFIG_FIELDS` (`js/core.js`) is the one place that lists every field in the Robot & Code panel's template/speed section: its `<input id>`, its value type, and its default. Defaults, old-save backfilling, panel read/write, per-kind speed lookup, and DOM listener wiring all walk this table instead of naming each field by hand in five separate places. Adding a field is one row here plus one `<input>` in `index.html` — nothing else to remember or keep in sync.

---

## Features

### Core Planning
- [x] Load competition mat photo (drag-and-drop or file picker)
- [x] Draw construction lines with auto-labeled mm lengths
- [x] Calibrate by drawing a line on a known distance
- [x] Recalibrate later using the longest existing construction line
- [x] Create named multi-waypoint routes
- [x] Insert waypoints by clicking route segment midpoints
- [x] Move waypoints and line endpoints by dragging (Select tool)
- [x] Delete waypoints via right-click
- [x] Show/hide individual routes
- [x] Show/hide individual construction lines, arcs and points — from the
      geometry list or by right-clicking them. Hidden geometry is fully
      inert: it is not drawn, not snapped to, and not clickable, which is
      how you get a line out of the way when several overlap
- [x] Show/hide individual route moves too — independent of the
      construction line's own visibility, from the action list's eye
      icon, the move's detail panel, or right-clicking the move. Hiding a
      move is purely presentational (generated code is unaffected) and
      also frees the construction line underneath to render as a guide
      again, for when overlapping route lines fight for the cursor
- [x] Geometry list available in **both** Sketch and Route mode; clicking a
      row highlights that geometry on the canvas, and clicking geometry on
      the canvas (in Select, Constrain or Route mode) selects and scrolls
      to its row in return — the list and the canvas always agree
- [x] Hover to preview, click to select — in both the geometry list and the
      route action list, hovering a row highlights what that row points at
      on the canvas, so you can see what you are about to select and
      operate on before committing to it. Hover state is purely transient:
      never saved, never in undo history
- [x] Route move colour says which WAY the robot drives, not what kind of
      move it is: **blue forwards, orange backwards**, for straights and
      arcs alike (line trace, wall align and teleport keep their own
      colours, since those are about what the move *does*)
- [x] Robot start position marker with heading arrow
- [x] Snap system: endpoints, intersections, 90° angle, along-line projection
- [x] Ctrl to temporarily disable snap
- [x] Zoom (scroll/pinch/+/-/ctrl+wheel) and pan (drag/arrow keys)
- [x] FreeCAD-style merged constraints — one **Coincident** button (`C`)
      joins two points, pins a point to a line, or pins a point to an arc;
      one **Dimension** button (`D`) sets a line's length, the gap between
      two points, a point's distance to a line, an arc's radius, or the
      angle between two lines; the `A` hotkey applies Horizontal or
      Vertical, whichever the selected line is already closer to. Which
      one you get is decided by what's selected. The solver and the saved
      file still store the specific constraint — only the button/key is
      shared
- [x] Fit-to-view

### Output
- [x] Step-by-step turn/forward instructions
- [x] Auto-generated code with customizable templates
- [x] Template placeholders: `{distance}`, `{angle}`, `{speed}`, `{reversed}`,
      `{junctions}`, `{radius}`, `{name}`, `{expected_distance}` (wall align
      only — the solved leg length, so a real robot can slow down on
      approach instead of driving blind), `{extra_args}` (per-action, see
      below)
- [x] Configurable: comment prefix, forward/turn template, default speed, output unit
- [x] Per-move-kind default speeds (Robot & Code panel) — forward, turn,
      arc, wall align, and both line-trace modes can each override the
      plain default speed; blank falls back to it, and an action's own
      Speed field (Route mode) always wins over both
- [x] Extra args per action — every move, turn and checkpoint has its own
      free-text field (Route mode's detail panel) spliced verbatim into
      `{extra_args}` in that action's template, for whatever a project's
      robot API needs that no built-in placeholder covers
- [x] Unit conversion (mm, cm, m, in)
- [x] One-click copy (Instructions / Code)
- [x] Total distance summary

### Persistence
- [x] Save/Open projects as `.json` files (includes image, routes, calibration, config)
- [x] Undo/Redo (80 levels, covers all mutations)

### UX
- [x] Dark theme, consistent styling
- [x] Tool switching via top-bar tabs and sidebar buttons
- [x] Right-side info panel (tool, snap, hover position, click position, line/route counts, calibration)
- [x] Collapsible bottom panels (Construction Lines/Constraints, Instructions/Code)
- [x] Snap indicator crosshair
- [x] Construction line drawing preview
- [x] Route continuation magnet circle on last waypoint
- [x] Keyboard shortcuts: Ctrl+Z/Y, Escape, arrow keys, +/-, F
- [x] The arrow keys are reserved for panning in every tool — no
      constraint shortcut may claim them, so navigation never depends on
      which tool happens to be active. This is also what freed up WASD
      to match FreeCAD's own constraint letters. Constraint keys
      (Constrain tool only): `C` coincident, `D` dimension, `A`
      horizontal-or-vertical (picks whichever the selected line is
      closer to), `H`/`V` horizontal/vertical directly, `N` angle,
      `T` tangent, `E` equal, `L` lock
- [x] Touch support (pan, pinch-zoom)
- [x] No keyboard hijacking when focused in text inputs
- [x] Live preview of code template changes

### Robot Config
- [x] Robot body drawn as its own sketch document (Sketch mode → Robot), with the
      full constraint tools. Right-click a line to make it the drive axis; select
      it for a panel showing the turning centre, reach ahead/behind and body size,
      with **⇄ Reverse forward direction** to swap which end is the nose
- [x] Front/rear clearance measured from the drawn body instead of typed, whenever
      a robot exists (the manual fields grey out and say why)
- [x] Obstacles: right-click mat geometry → Mark as obstacle. Rendered red,
      collected by `RP.obstacleSegments()` for the simulator
- [x] Start position placement (click on map)
- [x] Start heading drag-to-set
- [x] Visual start marker on canvas with heading line

### Code Quality
- [x] Undo/redo deep-clone safety (no shared references)
- [x] Calibration prompt cancel properly resets state
- [x] Route name/id off-by-one fixed
- [x] Input validation on numeric fields
- [x] All JS files pass `node --check`

---

## TODO / Future Improvements

### High Priority
- [ ] **Virtual robot footprint overlay** — show robot chassis rect at waypoints to visualize clearance and avoid obstacle collisions
- [ ] **WRO scoring calculator** — integrate WRO 2026 scoring rules to estimate score from planned routes (which tiles picked, which delivered, time estimate)
- [ ] **Multi-route code merge** — generate a single combined program from multiple routes (e.g. "Route 1: collect tools, Route 2: place tiles, Route 3: return home")
- [ ] **Angle tolerance / rounding** — option to snap turn angles to common values (45°, 90°, 180°) for robots with limited turn precision
- [ ] **Waypoint labels** — allow naming waypoints (e.g. "Pick up red tile", "Drop zone A") and include them as inline comments in generated code
- [ ] **Route sequence ordering** — define execution order of routes and whether they chain (robot ends route A at position that becomes start of route B)

### Medium Priority
- [ ] **L/R turn convention toggle** — invert turn direction for mats photographed upside-down or mirrored
- [ ] **Grid overlay** — optional grid aligned with construction lines, useful for scoring-zone visualization
- [ ] **Distance measurement tool** — click two points anywhere to see the mm distance without drawing a permanent line
- [ ] **Route duplication** — clone a route as a starting point for a variation
- [ ] **Export to specific robot formats** — EV3 Python, SPIKE Prime Python, Robot Inventor Python, LEGO block code (via comment-annotated pseudocode)
- [ ] **Undo history browser** — see what each undo step will revert
- [ ] **Two-finger pan on touch devices** — currently only pinch-zoom and single-finger pan

### Polish / Low Priority
- [ ] Replace native `prompt()`/`alert()`/`confirm()` with in-app styled modals
- [ ] Magic number constants consolidation (screen-distance thresholds, snap radius, etc.)
- [ ] Tab-dropdown keyboard accessibility (currently hover-only)
- [ ] Print-friendly route card layout
- [ ] Dark/light theme toggle
- [ ] Session auto-recovery (restore last state on accidental close)
- [ ] `package.json` with ESLint/Prettier for code quality enforcement
- [ ] `<script defer>` on all JS loads for non-blocking parse
- [ ] Inline `onclick` handlers migrated to `addEventListener`

### Consideration / Discussion Needed
- [ ] **Route time estimation** — using robot speed + turn rate to estimate execution time (useful for the 2-minute match limit)
- [ ] **Line-following segments** — support line-follow mode (not just odometry) as a segment type, since WRO mats have guide lines
- [ ] **Obstacle zones** — define "keep-out" rectangles/circles that routes must not intersect, with visual warnings
- [ ] **Distance vs. encoder counts** — direct encoder tick output for robots that use raw encoder values instead of mm

---

## Usage Quickstart

### For a Human
1. Open `index.html` in a modern browser — or `node build.js` and open `dist/wro-planner.html`, which is the same app in one portable file. No server needed either way.
2. **File** → **Open Image** → load your mat photo.
3. Select the **📏 Construction Line** tool.
4. Drag to draw a line on a known distance (e.g. the full width of the mat, which is 2362 mm for a standard WRO mat). Enter the known mm value when prompted. This calibrates the image.
5. Draw more construction lines on reference points (mat borders, game object positions).
6. Switch to **📍 Route** tool. Click near the last waypoint dot and drag to extend the route. Waypoints snap to your construction lines.
7. Click **🤖 Robot Config** to set chassis dimensions, start position, and heading.
8. Read the turn-by-turn instructions and copy the generated code from the **📋 Instructions** panel at the bottom.
9. Save your work: **File** → **💾 Save Project**.

### For an AI Agent
1. This is a browser-based offline tool. You can inspect the codebase (see [Architecture](#architecture) above) and the [AUDIT.md](./AUDIT.md) for known issues.
2. All state lives in `window.RP`. You can programmatically drive it via browser console or a headless test harness.
3. Key state objects: `RP.lines[]`, `RP.routes[]`, `RP.calibration`, `RP.robotConfig`, `RP.codeConfig`.
4. Programmatic entry points: `RP.computeSteps(route)`, `RP.generateCode(route)`, `RP.createRoute(name)`, `RP.addWaypoint(x, y)`, `RP.pushHistory()`, `RP.loadImageFromDataUrl(dataUrl)`.
5. The generated code is template-driven via `RP.codeConfig` — you can modify templates to target any programming language or robot platform.

---

## Technical Notes

- **Zero dependencies** — no npm, no bundler, no CDN. Pure vanilla JS, CSS, and HTML.
- **Projects persist as `.json` files** — no browser storage, no size quota. **File → Save Project** / **Open Project**.
- **Canvas rendering** scales everything by `1/RP.scale` so visual elements stay constant pixel size regardless of zoom.
- **Snap priority:** construction-line endpoint/intersection → 90° angle from anchor → perpendicular projection onto construction line.
- **Undo/redo** snapshots all state with `JSON.parse(JSON.stringify(...))` deep clones — safe from reference-sharing bugs.
- **Unit conversion** uses a lookup table: `{ mm: 1, cm: 10, m: 1000, in: 25.4 }`. Unknown units treated as mm.
