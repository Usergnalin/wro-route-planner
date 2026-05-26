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
