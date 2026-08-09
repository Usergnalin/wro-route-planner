/* ========================================================================
   persist.js - Save/load map projects, export/import JSON
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

// ======================================================================
// LOCAL STORAGE SAVE / LOAD
// ======================================================================
// Internal helper: build the save payload for the current state.
RP._buildSavePayload = function(name) {
  return {
    version: '5.0',
    name: name,
    imageData: RP.imgDataUrl,
    calibration: RP.calibration ? JSON.parse(JSON.stringify(RP.calibration)) : null,
    sketch: RP.serializeSketch(),
    construction: JSON.parse(JSON.stringify(RP.constructionMeta)),
    routes: RP.serializeRoutes(),
    robotConfig: JSON.parse(JSON.stringify(RP.robotConfig)),
    codeConfig: JSON.parse(JSON.stringify(RP.codeConfig)),
    nextWpId: RP.nextWpId,
    nextElementId: RP.nextElementId,
    nextSegId: RP.nextSegId,
    nextRouteId: RP.nextRouteId,
    activeRouteId: RP.activeRouteId
  };
};

// Internal helper: try to write to localStorage with quota handling.
// Returns true on success, false on quota / other failure.
RP._writeLocalStorage = function(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    var isQuota = err && (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 || err.code === 1014
    );
    if (isQuota) {
      alert('Browser storage is full (\u22485 MB limit).\n\n' +
        'The map image is probably too large. Try:\n' +
        '  \u2022 Export Project (saves to a .json file instead)\n' +
        '  \u2022 Delete some saved maps to free space\n' +
        '  \u2022 Use a smaller / more compressed map image');
    } else {
      alert('Failed to save: ' + (err && err.message ? err.message : err));
    }
    return false;
  }
};

RP.saveMapProject = function() {
  if (!RP.imgDataUrl) { alert('Load an image first.'); return; }
  var name = prompt('Name this map project:', 'WRO Map ' + new Date().toLocaleDateString());
  if (name === null) return;
  if (!name) { alert('Name cannot be empty.'); return; }
  var key = 'wro-map-' + name;
  if (localStorage.getItem(key) !== null) {
    if (!confirm('A saved map named "' + name + '" already exists. Overwrite?')) return;
  }
  var data = RP._buildSavePayload(name);
  if (RP._writeLocalStorage(key, JSON.stringify(data))) {
    alert('Saved "' + name + '"');
    RP.updateMapList();
  }
};

RP.loadMapProject = function(name) {
  var raw = localStorage.getItem('wro-map-' + name);
  if (!raw) return;
  var data = JSON.parse(raw);
  if (data.imageData) {
    var loaded = new Image();
    loaded.onload = function() {
      RP.img = loaded;
      RP.imgDataUrl = data.imageData;
      RP.imgNaturalW = loaded.naturalWidth || loaded.width;
      RP.imgNaturalH = loaded.naturalHeight || loaded.height;
      RP.calibration = data.calibration || { pixelsPerMm: RP.imgNaturalW / 2362 };
      RP.loadSketchFrom(data);
      RP.routes = data.routes || [];
      RP.migrateAllRoutes();          // v1 waypoints -> nodes/segments
      RP.migrateRoutesToElements();   // nodes/segments -> element references
      RP.selectedActionId = null;
      RP.nextWpId = data.nextWpId || 1;
      RP.nextElementId = data.nextElementId || 1;
      RP.nextSegId = data.nextSegId || 1;
      RP.nextRouteId = data.nextRouteId || 1;
      RP.activeRouteId = data.activeRouteId || (RP.routes.length > 0 ? RP.routes[0].id : null);
      RP.robotConfig = data.robotConfig ? JSON.parse(JSON.stringify(data.robotConfig)) : RP.freshRobotConfig();
      RP.codeConfig = data.codeConfig ? JSON.parse(JSON.stringify(data.codeConfig)) : RP.freshCodeConfig();
      RP.ensureCodeConfig();  // backfill any fields missing from old saves
      RP.robotOverlayVisible = false;
      RP.dom.robotOverlay.classList.remove('visible');
      RP.undoStack = [];
      RP.redoStack = [];

      RP.ensureSingleRoute();
      RP.updateRouteSelect();
      RP.updateSideRouteList();
      RP.updateMapList();
      RP.updateRobotUI();
      RP.updateCodeConfigUI();
      RP.resetView();
      RP.render();
    };
    loaded.src = data.imageData;
  }
};

RP.deleteMapProject = function(name) {
  if (!confirm('Delete "' + name + '"?')) return;
  localStorage.removeItem('wro-map-' + name);
  RP.updateMapList();
};

RP.updateMapList = function() {
  var el = RP.dom.mapListEl;
  if (!el) return;
  el.innerHTML = '';
  var keys = Object.keys(localStorage).filter(function(k) { return k.startsWith('wro-map-'); });
  for (var ki = 0; ki < keys.length; ki++) {
    var name = keys[ki].slice(8);
    var div = document.createElement('div');
    div.className = 'saved-project';
    var label = document.createElement('span');
    label.textContent = name;
    (function(n) {
      var loadBtn = document.createElement('button');
      loadBtn.textContent = 'Load';
      loadBtn.className = 'load-btn';
      loadBtn.onclick = function() { RP.loadMapProject(n); };
      var delBtn = document.createElement('button');
      delBtn.textContent = '\u2715';
      delBtn.className = 'del-btn';
      delBtn.onclick = function() { RP.deleteMapProject(n); };
      div.appendChild(label);
      div.appendChild(loadBtn);
      div.appendChild(delBtn);
    })(name);
    el.appendChild(div);
  }
};

// ======================================================================
// EXPORT / IMPORT PROJECT
// ======================================================================
RP.exportProject = function() {
  if (!RP.imgDataUrl) { alert('Load an image first.'); return; }
  var name = prompt('Project name:', 'WRO Project ' + new Date().toLocaleDateString());
  if (name === null) return;
  if (!name) { alert('Name cannot be empty.'); return; }
  RP.updateCodeConfigFromUI();
  var data = {
    version: '5.0',
    name: name,
    imageData: RP.imgDataUrl,
    calibration: RP.calibration ? JSON.parse(JSON.stringify(RP.calibration)) : null,
    sketch: RP.serializeSketch(),
    construction: JSON.parse(JSON.stringify(RP.constructionMeta)),
    routes: RP.serializeRoutes(),
    robotConfig: JSON.parse(JSON.stringify(RP.robotConfig)),
    codeConfig: JSON.parse(JSON.stringify(RP.codeConfig)),
    nextIds: { wp: RP.nextWpId, seg: RP.nextSegId, route: RP.nextRouteId,
               element: RP.nextElementId },
    activeRouteId: RP.activeRouteId
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'wro-project') + '.json';
  document.body.appendChild(a);
  a.click();
  // Delay revoke so Safari/iOS can actually start the download.
  setTimeout(function() {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
};

RP.importProject = function(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!data.imageData) { alert('Invalid file: no image data.'); return; }
      var loaded = new Image();
      loaded.onload = function() {
        RP.img = loaded;
        RP.imgDataUrl = data.imageData;
        RP.imgNaturalW = loaded.naturalWidth || loaded.width;
        RP.imgNaturalH = loaded.naturalHeight || loaded.height;
        RP.calibration = data.calibration || { pixelsPerMm: RP.imgNaturalW / 2362 };
        RP.loadSketchFrom(data);
        RP.routes = data.routes || [];
        RP.migrateAllRoutes();            // v1 waypoints -> nodes/segments
        RP.migrateRoutesToElements();   // nodes/segments -> element references
        RP.selectedActionId = null;

        if (data.nextIds) {
          RP.nextWpId = data.nextIds.wp || 1;
          RP.nextElementId = data.nextIds.element || 1;
          RP.nextSegId = data.nextIds.seg || data.nextSegId || 1;
          RP.nextRouteId = data.nextIds.route || 1;
        } else {
          RP.nextWpId = data.nextWpId || 1;
          RP.nextSegId = data.nextSegId || 1;
          RP.nextRouteId = data.nextRouteId || 1;
        }

        RP.activeRouteId = data.activeRouteId || (RP.routes.length > 0 ? RP.routes[0].id : null);
        RP.robotConfig = data.robotConfig ? JSON.parse(JSON.stringify(data.robotConfig)) : RP.freshRobotConfig();
        RP.codeConfig = data.codeConfig ? JSON.parse(JSON.stringify(data.codeConfig)) : RP.freshCodeConfig();
        RP.ensureCodeConfig();  // backfill any fields missing from old saves
        RP.robotOverlayVisible = false;
        RP.dom.robotOverlay.classList.remove('visible');
        RP.undoStack = [];
        RP.redoStack = [];

        RP.ensureSingleRoute();
        RP.updateRouteSelect();
        RP.updateSideRouteList();
        RP.updateMapList();
        RP.updateRobotUI();
        RP.updateCodeConfigUI();
        RP.resetView();
        RP.render();

        // Don't silently auto-save to localStorage. The user can click
        // Save Map if they want to persist the imported project.
        // (Previously this silently overwrote any existing wro-map-<name>
        //  entry and could blow the storage quota.)
      };
      loaded.src = data.imageData;
    } catch (err) {
      alert('Failed to parse JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
};

// ======================================================================
// IMAGE LOADING
// ======================================================================
RP.loadImageFromDataUrl = function(dataUrl) {
  var loaded = new Image();
  loaded.onload = function() {
    RP.img = loaded;
    RP.imgDataUrl = dataUrl;
    RP.imgNaturalW = loaded.naturalWidth || loaded.width;
    RP.imgNaturalH = loaded.naturalHeight || loaded.height;
    RP.resetSketch();
    RP.calibration = { pixelsPerMm: RP.imgNaturalW / 2362 };
    RP.routes = [];
    RP.activeRouteId = null;
    RP.nextWpId = 1;
    RP.nextSegId = 1;
    RP.nextRouteId = 1;
    RP.selectedActionId = null;
    RP.ensureSingleRoute();
    RP.robotConfig.startPos = null;
    RP.robotConfig.startHeading = 0;
    RP.undoStack = [];
    RP.redoStack = [];
    RP.updateRobotUI();
    RP.resetView();
    RP.render();
    RP.updateMapList();
  };
  loaded.src = dataUrl;
};
