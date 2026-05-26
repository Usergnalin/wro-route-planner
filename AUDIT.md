# WRO Route Planner — Code Audit

_Date: 2026-05-25_
_Files reviewed: `index.html`, `style.css`, `js/{core,render,routes,output,persist,config,events,main}.js` (~2.5k LOC)_

Severity legend:
- 🔴 **High** — incorrect behaviour, data loss, or broken feature
- 🟠 **Medium** — wrong-but-tolerable behaviour, surprising UX, or latent fragility
- 🟡 **Low** — polish, dead code, micro-perf, robustness nits

---

## 🔴 High-severity bugs

### H1. WASD / F / +/− / Ctrl+Z keys hijack focused text inputs
`events.js` keydown listener is bound on `window` with **no** `e.target.tagName === 'INPUT'/'TEXTAREA'` guard. The Robot Config overlay has several `<input type="text">` fields (`code-comment`, `code-forward`, `code-turn-r`, `code-turn-l`, `code-unit`). When typing into them:
- `w`, `a`, `s`, `d` — pan the canvas instead of being typed
- `f` — fits the view
- `+` / `-` — zoom
- `Ctrl+Z` / `Ctrl+Y` — fire app undo/redo instead of input-level undo

You literally **cannot type the word "forward" into the Forward Template field** — every `w` and `a` and `d` is eaten and `preventDefault`-ed.

**Fix:** at the top of the keydown handler, early-return if `e.target` is an `INPUT` / `TEXTAREA` / `[contenteditable]`.

```js
var t = e.target;
if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
```

---

### H2. `createRoute` default name is off-by-one
`routes.js:50`
```js
var r = { id: RP.nextRouteId++, name: name || ('Route ' + RP.nextRouteId), ... };
```
`RP.nextRouteId++` evaluates first and returns the pre-increment value to `id`, then increments. The default-name expression is then evaluated using the **incremented** value. So when no name is passed:

| Call order | id  | default name  |
|------------|-----|---------------|
| 1st        | 1   | "Route 2"     |
| 2nd        | 2   | "Route 3"     |

The IDs and names don't line up, and a route created on a fresh app with no name is called "Route 2".

**Fix:** capture the id first.
```js
var id = RP.nextRouteId++;
var r = { id: id, name: name || ('Route ' + id), waypoints: [], visible: true };
```

(In practice all current call-sites pass an explicit name, so this is dormant — but it's still wrong, and the default branch is exactly what would run if a user pressed OK on an empty prompt.)

---

### H3. Cancelling the calibration prompt leaves zombie state
`events.js:397-419` (construction line completion)

The flow when no calibration exists yet:
1. `RP.pushHistory('Draw construction line')` — snapshot taken
2. `var line = { id: RP.nextLineId++, ... }` — id counter **incremented**
3. `RP.lines.push(line)`
4. `RP.promptCalibration(pxLen)` — user presses **Cancel**
5. Filter removes `line` from `RP.lines`

Result: the line is gone, but:
- `RP.nextLineId` is now `N+1` despite no line existing → next line will be id `N+2`, leaving a hole
- The undo stack has a "Draw construction line" entry that snapshots the pre-line state — undo will appear to do nothing (no visible diff), wasting a slot and confusing the user

**Fix:** snapshot id BEFORE incrementing nextLineId, or only push history + bump id once calibration succeeds:

```js
if (RP.dist(...) > 2 / RP.scale) {
  var lineDraft = { x1: ..., y1: ..., x2: ..., y2: ..., type: 'construction', label: null };

  if (!RP.calibration) {
    var pxLen = RP.dist(...);
    // Show preview by rendering with the draft; OR commit only after calibration
    var calibrated = RP.promptCalibration(pxLen);
    if (!calibrated) return; // no history, no id bump
  }
  RP.pushHistory('Draw construction line');
  lineDraft.id = RP.nextLineId++;
  if (RP.calibration) lineDraft.label = (...).toFixed(2) + ' mm';
  RP.lines.push(lineDraft);
}
```

---

### H4. `localStorage.setItem` can throw `QuotaExceededError` — no `try/catch`
`persist.js:22` (`saveMapProject`) and `persist.js:200` (auto-save inside `importProject`) call `localStorage.setItem('wro-map-' + name, ...)` with a JSON blob that contains a **base64-encoded image data URL**. WRO mat images are easily 1–4 MB, which after base64+JSON overhead can exceed the ~5 MB per-origin localStorage quota.

Today this crashes with an uncaught `DOMException`. Worse, `importProject` then bails halfway through after the in-memory state is already mutated.

**Fix:** wrap in `try/catch` and surface a clear "storage full" message. Optionally, store the image in IndexedDB (much higher quota) and only keep metadata in localStorage.

---

### H5. `importProject` silently auto-saves and silently overwrites
`persist.js:182-202` ends `importProject` by writing a `wro-map-<name>` entry into localStorage automatically. There is:
- no confirmation that the user wanted to save (just imported, didn't ask to persist)
- no overwrite check if a saved map with the same name already exists

`saveMapProject` has the same overwrite-no-warn problem.

**Fix:** drop the auto-save inside `importProject` (let the user click Save Map if they want it), and in `saveMapProject` check `localStorage.getItem(key)` before writing and confirm.

---

### H6. Start position is ignored for distance — first leg phantom-teleports
`output.js:25-49`: when `RP.robotConfig.startPos` is set and `prevAngle === null` on the first segment, the generated code emits a **turn** from `startHeading` to the first segment's bearing, then a **forward** of `dist(wp[0], wp[1])`.

But there's no `forward` from `startPos` to `wp[0]`. The robot is implicitly teleported to the first waypoint. Two of the three likely user intents are broken:

| User intent                                                | Current behaviour |
|------------------------------------------------------------|-------------------|
| "wp[0] is where the robot actually starts"                 | mostly fine, but the initial turn might still be wrong because startHeading ≠ angle(startPos→wp[0]) — they're using startPos for heading, wp[0] for position |
| "startPos is the chassis origin; wp[0] is the first target" | **broken** — missing forward from startPos to wp[0] |

**Fix:** decide on a contract. Either:
- Require/auto-snap wp[0] = startPos, OR
- Emit `turn(angle(startPos→wp[0]) − startHeading)` then `forward(dist(startPos, wp[0]))` then the existing loop, treating `startPos` as a virtual wp[−1] and `startHeading` as its incoming heading.

This is the single biggest semantic bug in the code-generation layer.

---

### H7. `defaultUnit` is decorative — values are always mm
`output.js:9, 18` reads `RP.codeConfig.defaultUnit` and labels the comment as `' ' + unit`, but the numeric `dMm` and `totalDist` values are produced by dividing px by `pixelsPerMm`, i.e. always in millimetres. Changing the Unit field from `mm` to `cm`/`in` only changes the *label*, not the math.

**Fix:** either remove the Unit field, or convert: keep a `unitFactor` table (`{ mm:1, cm:10, in:25.4 }`) and divide `dMm`/`totalDist` by the factor before formatting.

---

### H8. `restoreState` does not deep-clone what it stores
`core.js:386-399`

```js
RP.restoreState = function(s) {
  RP.lines = s.lines;
  RP.routes = s.routes;
  // ...
};
```

`undo()` does `var prev = RP.undoStack.pop(); RP.restoreState(prev.state);` — so the live `RP.lines` / `RP.routes` arrays now **share references** with the popped snapshot. Subsequent mutations (`RP.lines.push`, dragging a waypoint) mutate the snapshot too… but the snapshot is no longer in any stack, so it's fine.

**BUT** redo then pushes `cur = snapshotState()` — `cur` is a fresh deep clone of the pre-restore state, also fine.

The hidden landmine: if anyone ever calls `restoreState` without immediately pushing the previous state, or if a future change reuses a popped snapshot, mutations will leak. Recommend defensive cloning inside `restoreState`:

```js
RP.lines = JSON.parse(JSON.stringify(s.lines));
RP.routes = JSON.parse(JSON.stringify(s.routes));
// etc.
```

Slight overhead, but matches what `snapshotState` already does on the way in.

---

## 🟠 Medium-severity issues

### M1. "Click to set heading" UX is actually click-move-click, not drag
`events.js:24-37, 320-336`. The hint in the robot overlay says **"then drag to set heading"** but the implementation is:
- mousedown → place start pos, set `startMarkerPlacingHeading = true`
- mousemove (no button) → updates heading live
- mouseup → commits heading

Since the user already released the button on the placement click, "drag" isn't possible — they need to *click, move, click again*. Either fix the hint or implement actual drag (set `startMarkerPlacing` on button-press, place on first mousemove, finalize on mouseup).

### M2. `Set Start` button has no cancel path
Clicking 🤖 → 📍 sets `RP.startMarkerPlacing = true` and changes button text to "Click canvas...". There's no way to bail out except by clicking somewhere on the canvas (which then places the start point). Clicking the button again just re-arms the same flag. Pressing Escape does nothing.

**Fix:** add Escape handler that clears `startMarkerPlacing`/`startMarkerPlacingHeading`, and toggle the flag off when the button is clicked while already armed.

### M3. "Load Map" top-bar button is essentially dead
`events.js:684-689` calls `RP.updateMapList()` and alerts if there are none. The saved-maps list is already permanently visible in the bottom panel. So this button is just a refresh, and feels broken to users who expect a file-picker dialog. Either remove it, or have it scroll/focus the saved-maps panel.

### M4. "📋 Route Instructions" toggle hides ALL three bottom panels
`events.js:711-720`: toggling `btn-instr-toggle` flips `display:none` on `#side-panels`, which contains Instructions **and** Saved Routes **and** Saved Maps. Label/intent suggests it should only hide the instruction panel.

**Fix:** toggle visibility of `#instr-panel` only, not the whole `#side-panels` container.

### M5. Right turn vs. left turn depends on map orientation (undocumented)
`output.js`/`updateInstructions` map `turn > 0 → right`, `turn < 0 → left`, where turn comes from `atan2(dy, dx)` in image coordinates (y-down). This corresponds to clockwise-on-screen = right for a robot whose "forward" matches the user's drawn direction.

If your WRO mat photo is upside-down, mirrored, or the robot's physical forward isn't aligned with the image's positive-X axis, the generated code will turn left when you meant right. There is no setting to invert this, and no documentation that warns about it.

**Fix:** add a "swap L/R" or "Y axis points up/down" toggle to the robot config, or document the convention clearly.

### M6. `code-speed` / `defaultSpeed` accepts 0 → silently rewritten to 200
`config.js:36`:
```js
RP.codeConfig.defaultSpeed = parseFloat(...) || 200;
```
`0` is falsy; if a user wants slow-and-steady at speed=0 (or some special "stop" semantics) it's clobbered. Same trick on `width`/`length`/`wheelbase` in `updateRobotConfigFromUI` and on every template string field — empty string falls back to the hard-coded default.

**Fix:** validate explicitly:
```js
var v = parseFloat(...);
RP.codeConfig.defaultSpeed = isFinite(v) && v > 0 ? v : 200;
```
…and for strings, use `value !== '' ? value : default`.

### M7. Insert-waypoint-by-clicking-midpoint can fail to snap
`events.js:108-126`. The midpoint hit-test uses a screen radius of 8 px (`sDist < 8`) which is *smaller* than the waypoint hit radius (12 px) and tighter than the snap radius (15 px). On a busy route with closely spaced waypoints this makes the insert gesture finicky.

**Fix:** unify these magic numbers in `core.js` as named constants and tune them (e.g. all 12 px).

### M8. Changing the active route through the dropdown / route list doesn't push history
`events.js:646-660` and `routes.js:99` (sidebar click handler). Changing `RP.activeRouteId` mutates state but doesn't snapshot, so a subsequent undo will roll back the *previous edit* without first reverting the active-route change. Many users won't notice, but it's surprising when it bites.

**Fix:** call `RP.pushHistory('Switch active route')` on those handlers, OR explicitly exclude `activeRouteId` from snapshotted state to be consistent.

### M9. Line endpoints can't snap while being dragged in Select mode
`events.js:213-216`:
```js
if (RP.snapEnabled && RP.elementDrag.type !== 'line-endpoint') {
  var s2 = RP.findSnap(p2.x, p2.y, { construction: false });
  if (s2) p2 = s2;
}
```
Waypoints snap during drag, line endpoints don't. There's no comment explaining why, and it breaks "shift one endpoint of a calibration line so it lines up with the corner I just discovered".

**Fix:** allow line-endpoint drag to snap to other line endpoints/intersections (exclude the *same* line from the snap candidates to avoid self-snapping).

### M10. No mid-life recalibration
The only way to re-run `promptCalibration` is **Clear All** (which nukes routes, lines, robot config, code templates). There's no "Recalibrate" button. If the user enters the wrong mm value the first time, they lose all work.

**Fix:** add a Recalibrate button in the calibration sidebar, or let the user click any construction line to enter "this line is X mm" mode.

### M11. `nextLineId` / `nextWpId` / `nextRouteId` aren't reconciled after deletions
After deleting most routes/lines/waypoints, the `next*Id` counters keep marching up. Combined with cancel-calibration leaking ids (H3), the ids drift further from sequential. Not strictly a bug — ids only need to be unique — but `JSON.parse(JSON.stringify(...))` snapshots embed them in every undo step, making the project file harder to read.

**Fix (optional):** when `lines`/`routes`/etc. become empty, reset their counters to 1.

### M12. Wheel zoom passive listener with `preventDefault` is fine, but pinch (touchmove) does `e.preventDefault()` on every touchmove
That's necessary to disable pinch-zoom in mobile browsers, but combined with the lack of two-finger-pan handling, single-finger and pinch are the only gestures. Two-finger pan (very natural for trackpads on iPad) is missing.

**Fix:** in 2-touch handler, also translate by the centroid delta, not just zoom.

### M13. `URL.revokeObjectURL(url)` immediately after `a.click()` in `exportProject`
`persist.js:135-138`. `a.click()` triggers a download asynchronously in some browsers (notably Safari/iOS). Revoking immediately can break the download.

**Fix:** revoke after a short timeout (`setTimeout(() => URL.revokeObjectURL(url), 1500)`) or on the next animation frame.

### M14. Tab dropdowns are hover-only — keyboard inaccessible
`style.css:14-18`: `.tab:hover .tab-dropdown { display: flex }`. Touch users can hover with a tap on most browsers, but keyboard focus doesn't open the dropdowns. Minor accessibility issue.

### M15. `pushHistory` is missing on a few destructive paths
- `togglePanel` (cosmetic, no history needed — OK)
- visibility toggle on routes (sidebar 👁 button) — no history, but state IS snapshotted ⇒ undo of an unrelated change will *also* flip visibility back. Surprising.
- `loadImageFromDataUrl` and `loadMapProject` / `importProject` blow away `RP.undoStack` and `RP.redoStack` — defensible, but worth a comment.

---

## 🟡 Low / polish

### L1. `#info-click` element is in the DOM, referenced in `RP.dom`, but never written
`core.js:29`, `index.html:97`. Dead UI hook. Either implement (show last-click position) or remove.

### L2. Render is called from `updateInstructions` which is called from `render` — actually not recursive
`render` calls `updateInstructions()` at the end, but `updateInstructions` only writes DOM, doesn't re-render. False alarm — but the coupling is tight enough that someone refactoring will break it.

### L3. `updateInstructions` and `generateCode` duplicate the same loop
Two copies of the angle/turn/forward iteration. They'll drift. Extract a single `RP.computeSteps(route)` that returns `[{kind:'turn', deg}, {kind:'forward', mm}, ...]` and have both renderers consume it.

### L4. `RP.codeConfig` defaults defined in three places
core.js (initial), persist.js loadMapProject (fallback), persist.js importProject (fallback), events.js btnClearAll (reset). Four copies of the same object literal — any future field is going to be added to one and forgotten in the others.

**Fix:** `RP.DEFAULT_CODE_CONFIG = { ... }` and `function freshCodeConfig() { return JSON.parse(JSON.stringify(RP.DEFAULT_CODE_CONFIG)); }`.

### L5. `RP.MAX_HISTORY = 80` and uses `shift()` on overflow
O(n) per push once the cap is hit. With 80 entries each ~10KB of JSON, that's still cheap, but a ring buffer would be cleaner.

### L6. `RP.imgNaturalW`/`RP.imgNaturalH` are read in `render` via `RP.img.naturalWidth || RP.img.width` and again via `RP.imgNaturalW` cached field. Double source of truth.

### L7. `setTool` is defined twice
Once in `core.js:471` as `RP.setTool`, and again as a local `function setTool(tool)` inside `RP.initEvents` (`events.js:585`). The local one duplicates work and also handles sidebar buttons / hint text. The exported `RP.setTool` (called once in `main.js`) only does the top-bar buttons + info panel. So initial state at boot doesn't include the sidebar toggle or the hint update.

**Fix:** drop one. Make `RP.setTool` do the full thing.

### L8. Magic numbers everywhere
`screenDist < 14` (mousedown waypoint grab), `< 12` (right-click delete), `< 20` (route-mode last-wp), `< 8` (midpoint insert), screen radius `15` in snap, perpendicular `15`, etc. Pull into named constants in core.

### L9. `style.css:122` selector typo? `#instr-list .action` — the `action` class is never applied (only `forward` / `turn`)
The action color (`#f90`) is dead. Same with `#code-output .comment / .keyword / .number` (no syntax-highlighter wraps these spans).

### L10. `RP.dom.routeWpCount` shows "0 waypoints" or "N waypoints" but no "1 waypoint" pluralization
Cosmetic.

### L11. `prompt()` / `alert()` / `confirm()` for naming / errors
Blocking native dialogs, no styling, no cancel UX consistency, no usability on mobile. Replace with in-app modals (most existing CSS infrastructure is already there).

### L12. The HTML loads scripts without `defer` and in dependency order
Works, but inline `<script>` blocks block parsing. Adding `defer` to all and dropping `<script src="js/main.js">` to be auto-deferred would be cleaner.

### L13. `togglePanel` is set on `window` but only used via inline `onclick=`
Inline handlers are awkward when CSP gets involved. Move to `addEventListener` in events.js.

### L14. `RP.dom.btnSidebarSnap` text says "🧲 Snap On" / "🧲 Snap Off" but `RP.dom.btnSnap` (top bar) stays "🧲 Snap"
Inconsistent; pick one.

### L15. `code-output` block is `white-space: pre` and `max-height: 110px` — long routes scroll horizontally AND vertically, awkward
Consider `pre-wrap` or a "wrap" toggle.

### L16. Reset of `imgNaturalW`/`imgNaturalH` in `loadImageFromDataUrl` happens, but `saveMapProject` doesn't store them — `loadMapProject` recomputes from the loaded Image. Fine, just noting.

### L17. There's no `package.json` / linter / formatter in the project
Several of the above (off-by-one, dead vars, falsy-default pitfalls) would have been caught by ESLint with default rules. Strongly suggest adding it.

---

## Suggested fix order

1. **H1 (input-key hijack)** — 5-minute fix, high frustration.
2. **H6 (start position vs. first leg)** — affects correctness of generated code, which is the *entire point* of the tool.
3. **H7 (unit label lies)** — same reason.
4. **H3 + H4 + H5 (persistence robustness)** — protect user work.
5. **H2 (route name off-by-one)** — fast, latent.
6. **M1, M2, M4, M10** — biggest UX wins.
7. **L3, L4, L7** — refactor cleanups to reduce future bugs.

---

## Things that look fine

- Geometry helpers (`dist`, `midpoint`, `lineIntersect`, `segIntersect`, `pointToSegDistSq`, `perpendicularProject`) are all correct and well-bounded.
- Snap priority (point > 90° > projection) is sensible and consistently applied across construction-line and route-segment drawing.
- Undo/redo state shape covers everything that matters (modulo the deep-clone observation in H8).
- DPR-aware canvas sizing (`resizeCanvas`) is correct.
- Coordinate transforms (`screenToImage` / `imageToScreen`) and `zoomAt` are textbook and correct.
- Construction line / route rendering scales line widths and font sizes by `1/scale`, so visuals stay constant across zoom — nice.
