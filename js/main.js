/* ========================================================================
   main.js - Init, resize observer, initial state setup
   WRO RoboMission Senior 2026 - Route Planner
   ======================================================================== */
var RP = window.RP || {};

(function() {
  // ======================================================================
  // RESIZE OBSERVER
  // ======================================================================
  var ro = new ResizeObserver(function() {
    clearTimeout(RP.resizeTimer);
    RP.resizeTimer = setTimeout(RP.resizeCanvas, 80);
  });
  ro.observe(RP.dom.wrap);

  // ======================================================================
  // INIT
  // ======================================================================
  setTimeout(RP.resizeCanvas, 50);
  RP.ensureSingleRoute();
  RP.updateRouteSelect();
  RP.updateSideRouteList();
  RP.updateLayerList();
  RP.updateMapList();
  RP.updateRobotUI();
  RP.updateCodeConfigUI();
  RP.setTool('construction');
  RP.updateInfoPanel();
  RP.dom.sidePanels.style.display = '';

  // Initialize events
  RP.initEvents();
})();
