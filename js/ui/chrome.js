/* ========================================================================
   chrome.js - Menus, dialog tabs and the resizable bottom dock.

   Pure presentation: nothing here reads or writes planner state, so it
   can be loaded anywhere after icons.js.

   Menus open on CLICK, not hover. The old hover dropdowns opened whenever
   the pointer crossed the top bar on its way to the canvas, and could not
   be opened at all on a touch screen. Once one menu is open, hovering a
   neighbouring trigger switches to it, the way a desktop menu bar does.
   ======================================================================== */
var RP = window.RP || {};

(function() {
  var openMenu = null;

  function setOpen(menu, open) {
    menu.classList.toggle('open', open);
    var trig = menu.querySelector('.menu-trigger');
    if (trig) trig.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  RP.closeMenus = function() {
    if (openMenu) setOpen(openMenu, false);
    openMenu = null;
  };

  function openOne(menu) {
    if (openMenu === menu) return;
    RP.closeMenus();
    setOpen(menu, true);
    openMenu = menu;
  }

  var menus = document.querySelectorAll('.menu');
  for (var i = 0; i < menus.length; i++) {
    (function(menu) {
      var trig = menu.querySelector('.menu-trigger');
      if (!trig) return;
      trig.addEventListener('click', function(e) {
        e.stopPropagation();
        if (openMenu === menu) RP.closeMenus(); else openOne(menu);
      });
      trig.addEventListener('mouseenter', function() {
        if (openMenu && openMenu !== menu) openOne(menu);
      });
      // Choosing an item is the end of the menu's job. The file <input>
      // sits on top of its button, so its click lands here too.
      var pop = menu.querySelector('.menu-pop');
      if (pop) pop.addEventListener('click', function() { RP.closeMenus(); });
    })(menus[i]);
  }

  document.addEventListener('click', function(e) {
    if (openMenu && !openMenu.contains(e.target)) RP.closeMenus();
  });
  // Capture phase, so an open menu swallows Escape before the canvas
  // shortcuts see it — otherwise closing a menu would also drop the
  // current selection.
  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && openMenu) {
      RP.closeMenus();
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // ---- tabs (the Robot & Code dialog) ---------------------------------
  var tabBtns = document.querySelectorAll('[data-tab-target]');
  for (var t = 0; t < tabBtns.length; t++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var group = btn.closest('[data-tabs]');
        if (!group) return;
        var name = btn.getAttribute('data-tab-target');
        var bs = group.querySelectorAll('[data-tab-target]');
        for (var j = 0; j < bs.length; j++) {
          var on = bs[j] === btn;
          bs[j].classList.toggle('active', on);
          bs[j].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        var panes = group.querySelectorAll('[data-tab-pane]');
        for (var k = 0; k < panes.length; k++) {
          panes[k].classList.toggle('hidden', panes[k].getAttribute('data-tab-pane') !== name);
        }
      });
    })(tabBtns[t]);
  }

  // ---- empty canvas ----------------------------------------------------
  // The same two actions as the File menu, where a first-time user is
  // actually looking. They forward to the real controls rather than
  // duplicating what those do.
  var emptyImg = document.getElementById('empty-open-image');
  if (emptyImg) emptyImg.addEventListener('click', function() {
    var fi = document.getElementById('file-input');
    if (fi) fi.click();
  });
  var emptyProj = document.getElementById('empty-open-project');
  if (emptyProj) emptyProj.addEventListener('click', function() {
    var op = document.getElementById('btn-open-project');
    if (op) op.click();
  });

  // ---- resizable bottom dock ------------------------------------------
  // The generated code is the thing you read most in Route mode, and a
  // fixed 180px showed about eight lines of it. Drag the top edge. (Not
  // remembered between sessions: the app keeps nothing in browser
  // storage — see the localStorage check in tests/boot.js.)
  var DOCK_MIN = 90;
  var handle = document.getElementById('dock-resize');
  var dock = document.getElementById('side-panels');
  function setDockHeight(px) {
    var max = Math.max(DOCK_MIN, window.innerHeight - 260);
    px = Math.max(DOCK_MIN, Math.min(max, px));
    dock.style.setProperty('--dock-h', px + 'px');
    return px;
  }
  if (handle && dock && dock.style && dock.style.setProperty) {
    handle.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      var startY = e.clientY;
      // --dock-h is the panel BODY height; the dock itself is taller by
      // its headers and padding. The default is a clamp() expression, so
      // read the height a body actually rendered at rather than the var.
      var body = dock.querySelector('.side-panel:not(.collapsed) .side-panel-body');
      var startH = body ? body.getBoundingClientRect().height : 190;
      handle.classList.add('dragging');
      function move(ev) { setDockHeight(startH + (startY - ev.clientY)); }
      function up() {
        handle.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
})();
