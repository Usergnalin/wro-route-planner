/* ========================================================================
   persist.js - Save/load project as .json files, image loading

   Projects live on disk, never in the browser. localStorage briefly held
   whole projects (mat photo + routes + calibration + robot config) but
   the photos are large enough that only one project fit under its ~5 MB
   quota at a time -- defeating the point of "saved projects", plural.
   A file has no such ceiling, and it is also the only kind of save that
   actually travels with you: localStorage belongs to the BROWSER, not to
   any particular HTML file, so it never left the machine you saved on.
   ======================================================================== */
var RP = window.RP || {};

// ======================================================================
// SAVE / OPEN PROJECT
// ======================================================================
RP.saveProject = function() {
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
               action: RP.nextActionId },
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

RP.openProject = function(file) {
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
        RP.migrateRoutesToActions();   // nodes/segments -> actions
        RP.selectedActionId = null;

        if (data.nextIds) {
          RP.nextWpId = data.nextIds.wp || 1;
          RP.nextActionId = data.nextIds.action || data.nextIds.element || 1;
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
        RP.setRobotOverlay(false);
        RP.undoStack = [];
        RP.redoStack = [];

        RP.ensureSingleRoute();
        RP.updateRouteSelect();
        RP.updateSideRouteList();
        RP.updateRobotUI();
        RP.updateCodeConfigUI();
        RP.resetView();
        RP.render();
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
  };
  loaded.src = dataUrl;
};
