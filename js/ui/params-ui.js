/* ========================================================================
   params-ui.js - Editing templates and parameters, and parameter values.

   Three pieces, all over the model in js/model/params.js:

   1. The template editor: a one-line field where placeholders are atomic
      tokens. Typing "{" closes the brace and opens a list of what can go
      there (that movement's built-ins and parameters); typing narrows it
      and Tab/Enter puts the token in. A placeholder typed out in full is
      recognised too. The field's VALUE is still plain template text — the
      tokens are only how it is shown — so what is saved, rendered and
      tested is exactly what RP.parseTemplate reads.

   2. The Code tab of the Robot & Code dialog: one page per movement with
      its template(s), its built-ins and its parameter table, plus a
      General page for the project-wide fields.

   3. The parameter rows in the route panel, for the selected action.
   ======================================================================== */
var RP = window.RP || {};

(function() {
  var esc = function(s) { return RP.escapeHtml(s == null ? '' : s); };

  // ====================================================================
  // 1. TEMPLATE EDITOR
  // ====================================================================
  function tokClass(key, name) {
    if (RP.isBuiltinOf(key, name)) return 'tok tok-builtin';
    if (RP.findParam(key, name)) return 'tok tok-param';
    return 'tok tok-unknown';
  }
  function tokTitle(key, name) {
    if (RP.isBuiltinOf(key, name)) return 'Built-in: ' + RP.BUILTINS[name];
    var p = RP.findParam(key, name);
    if (p) return 'Parameter · ' + RP.PARAM_TYPE_LABELS[p.type] +
                  (p.default !== '' && p.default != null ? ' · default ' + RP.formatParam(p, p.default) : ' · no default');
    return 'Not a parameter or built-in of this movement — it will be printed as typed';
  }

  // Plain template text out of the field: text nodes as they are, tokens
  // back to {name}.
  function serialize(el) {
    var out = '';
    el.childNodes.forEach(function(n) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.dataset && n.dataset.name) out += '{' + n.dataset.name + '}';
      else out += n.textContent;
    });
    return out;
  }

  // Where the caret is, as an offset into serialize()'s string.
  function caretOffset(el) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return null;
    var off = 0;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (r.startContainer === el && i === r.startOffset) return off;
      if (n === r.startContainer || n.contains(r.startContainer)) {
        return off + (n.nodeType === 3 ? r.startOffset : 0);
      }
      off += n.nodeType === 3 ? n.nodeValue.length : ('{' + (n.dataset.name || '') + '}').length;
    }
    return off;
  }

  function setCaret(el, offset) {
    var off = 0;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      var len = n.nodeType === 3 ? n.nodeValue.length : ('{' + n.dataset.name + '}').length;
      if (n.nodeType === 3 && offset <= off + len) {
        // An offset that fell inside the token before lands just after it.
        placeAt(n, Math.max(0, offset - off));
        return;
      }
      if (n.nodeType !== 3 && offset <= off) { placeBefore(el, i); return; }
      off += len;
    }
    placeBefore(el, el.childNodes.length);
  }
  function placeAt(node, o) {
    var r = document.createRange();
    r.setStart(node, o); r.collapse(true);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function placeBefore(el, idx) {
    var r = document.createRange();
    r.setStart(el, idx); r.collapse(true);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  // Draw `value` into the field as text + tokens. Text runs are kept as
  // separate text nodes either side of every token, with an empty one at
  // each end, so the caret always has somewhere to go.
  //
  // `pending` is the {placeholder} being typed right now, as [start, end).
  // Because "{" auto-closes, "{s}" is already a complete placeholder after
  // one letter; turning it into a token then would swallow the caret
  // mid-word. It stays plain text until it is picked, dismissed, or the
  // caret leaves it.
  function tokensOf(value, pending) {
    if (!pending) return RP.parseTemplate(value);
    return RP.parseTemplate(value.slice(0, pending[0]))
      .concat([{ text: value.slice(pending[0], pending[1]) }])
      .concat(RP.parseTemplate(value.slice(pending[1])));
  }
  function paint(el, key, value, pending) {
    el.innerHTML = '';
    var toks = tokensOf(value, pending);
    el.appendChild(document.createTextNode(''));
    toks.forEach(function(t) {
      if (t.name) {
        var chip = document.createElement('span');
        chip.className = tokClass(key, t.name);
        chip.contentEditable = 'false';
        chip.dataset.name = t.name;
        chip.textContent = t.name;
        chip.title = tokTitle(key, t.name);
        el.appendChild(chip);
        el.appendChild(document.createTextNode(''));
      } else {
        // Escaped {{name}} is shown as typed, so it reads as a literal.
        var txt = t.escaped ? '{' + t.text + '}' : t.text;
        var last = el.lastChild;
        last.nodeValue += txt;
      }
    });
  }

  // ---- autocomplete popup ----------------------------------------------
  var pop = null, popState = null;
  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'tok-pop popover';
    pop.style.display = 'none';
    document.body.appendChild(pop);
    pop.addEventListener('mousedown', function(e) {
      var item = e.target.closest('[data-pick]');
      if (!item) return;
      e.preventDefault();               // keep focus in the editor
      popState.index = Number(item.dataset.idx);
      choose();
    });
    return pop;
  }
  function closePop() {
    if (pop) pop.style.display = 'none';
    popState = null;
  }

  // Inside an open "{partial" right before the caret?
  function braceContext(el) {
    var off = caretOffset(el);
    if (off == null) return null;
    var text = serialize(el);
    var before = text.slice(0, off);
    var m = /\{([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
    if (!m) return null;
    // "{{" is the start of an escape, not of a placeholder.
    if (m.index > 0 && before.charAt(m.index - 1) === '{') return null;
    return { start: m.index, partial: m[1] || '', caret: off,
             closed: text.charAt(off) === '}' };
  }

  function candidates(key, partial) {
    var m = RP.MOVEMENT_BY_KEY[key];
    var list = [];
    var lp = partial.toLowerCase();
    m.builtins.forEach(function(n) {
      if (n.toLowerCase().indexOf(lp) === 0) list.push({ name: n, kind: 'builtin', note: RP.BUILTINS[n] });
    });
    RP.movementParams(key).forEach(function(p) {
      if (p.name.toLowerCase().indexOf(lp) === 0) {
        list.push({ name: p.name, kind: 'param', note: RP.PARAM_TYPE_LABELS[p.type] +
          (p.default !== '' && p.default != null ? ' · default ' + RP.formatParam(p, p.default) : '') });
      }
    });
    // Offer to create it, if it is a name that could be a parameter here.
    if (partial && !list.some(function(c) { return c.name === partial; }) &&
        RP.paramNameError(key, partial) === null) {
      list.push({ name: partial, kind: 'create', note: 'New number parameter for ' + m.label });
    }
    return list;
  }

  function showPop(ed) {
    var ctx = braceContext(ed.el);
    if (!ctx) { closePop(); return; }
    var list = candidates(ed.key, ctx.partial);
    if (!list.length) { closePop(); return; }
    var p = ensurePop();
    var keep = popState && popState.ed === ed ? Math.min(popState.index, list.length - 1) : 0;
    popState = { ed: ed, ctx: ctx, list: list, index: keep };
    p.innerHTML = list.map(function(c, i) {
      return '<div class="tok-pop-item' + (i === keep ? ' active' : '') + '" data-pick="1" data-idx="' + i + '">' +
        (c.kind === 'create' ? RP.icon('plus') : '') +
        '<span class="tok ' + (c.kind === 'builtin' ? 'tok-builtin' : 'tok-param') + '">' + esc(c.name) + '</span>' +
        '<span class="tok-pop-note">' + esc(c.note) + '</span></div>';
    }).join('');
    var r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    var box = ed.el.getBoundingClientRect();
    p.style.left = Math.round(r.left || box.left) + 'px';
    p.style.top = Math.round(box.bottom + 4) + 'px';
    p.style.display = 'block';
  }

  function movePop(d) {
    if (!popState) return;
    popState.index = (popState.index + d + popState.list.length) % popState.list.length;
    var items = pop.querySelectorAll('.tok-pop-item');
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('active', i === popState.index);
  }

  function choose() {
    if (!popState) return;
    var ed = popState.ed, ctx = popState.ctx, c = popState.list[popState.index];
    if (c.kind === 'create') {
      ed.beginEdit();
      RP.addParam(ed.key, { name: c.name, type: 'number', default: '' });
      if (RP.renderParamTable) RP.renderParamTable(ed.key);
    }
    var text = serialize(ed.el);
    var end = ctx.caret + (ctx.closed ? 1 : 0);
    var next = text.slice(0, ctx.start) + '{' + c.name + '}' + text.slice(end);
    closePop();
    ed.set(next, ctx.start + c.name.length + 2);
  }

  // ---- the editor itself -----------------------------------------------
  // opts: { key (movement), get() -> text, set(text), placeholder }
  RP.makeTemplateEditor = function(opts) {
    var el = document.createElement('div');
    el.className = 'tmpl-editor';
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.setAttribute('role', 'textbox');
    if (opts.placeholder) el.dataset.placeholder = opts.placeholder;

    var editing = false;   // one undo step per focus, not per keystroke
    var ed = {
      el: el, key: opts.key,
      beginEdit: function() {
        if (!editing) { RP.pushHistory('Edit template'); editing = true; }
      },
      set: function(text, caret, pending) {
        ed.beginEdit();
        opts.set(text);
        paint(el, opts.key, text, pending);
        el.classList.toggle('is-empty', text === '');
        if (caret != null) setCaret(el, caret);
        if (RP.onTemplatesChanged) RP.onTemplatesChanged(opts.key);
      },
      refresh: function() {
        var off = document.activeElement === el ? caretOffset(el) : null;
        paint(el, opts.key, opts.get());
        el.classList.toggle('is-empty', !opts.get());
        if (off != null) setCaret(el, off);
      }
    };
    ed.refresh();

    el.addEventListener('focus', function() { editing = false; });
    // Leaving the field finishes whatever placeholder was being typed.
    el.addEventListener('blur', function() { closePop(); ed.refresh(); });

    el.addEventListener('beforeinput', function(e) {
      // Auto-close: "{" becomes "{}" with the caret inside.
      if (e.inputType === 'insertText' && e.data === '{') {
        e.preventDefault();
        var off = caretOffset(el);
        var text = serialize(el);
        ed.set(text.slice(0, off) + '{}' + text.slice(off), off + 1, [off, off + 2]);
        showPop(ed);
      } else if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
        e.preventDefault();             // templates are one line
      }
    });

    el.addEventListener('input', function() {
      var off = caretOffset(el);
      var text = serialize(el);
      ed.beginEdit();
      opts.set(text);
      // A placeholder typed out in full becomes a token as soon as its
      // closing brace exists — unless it is the one being typed now.
      var ctx = braceContext(el);
      var pending = ctx && ctx.closed ? [ctx.start, ctx.caret + 1] : null;
      var want = tokensOf(text, pending).filter(function(t) { return t.name; }).length;
      var typedTok = el.querySelectorAll('.tok').length !== want;
      if (typedTok) paint(el, opts.key, text, pending);
      el.classList.toggle('is-empty', text === '');
      if (typedTok && off != null) setCaret(el, off);
      if (RP.onTemplatesChanged) RP.onTemplatesChanged(opts.key);
      showPop(ed);
    });

    el.addEventListener('keydown', function(e) {
      if (popState && popState.ed === ed) {
        if (e.key === 'ArrowDown') { e.preventDefault(); movePop(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); movePop(-1); return; }
        if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); choose(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); ed.refresh(); return; }
      }
      if (e.key === 'Enter') e.preventDefault();
    });
    // Moving the caret out of a placeholder finishes it; moving into an
    // unfinished one reopens the list.
    function caretMoved() {
      if (braceContext(el)) showPop(ed);
      else { closePop(); if (el.querySelectorAll('.tok').length !== RP.templateNames(opts.get()).length) ed.refresh(); }
    }
    el.addEventListener('keyup', function(e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') caretMoved();
    });
    el.addEventListener('mouseup', function() { setTimeout(caretMoved, 0); });

    // Paste as plain text; the input handler then tokenises it.
    el.addEventListener('paste', function(e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text').replace(/[\r\n]+/g, ' ');
      var off = caretOffset(el);
      var text = serialize(el);
      var sel = window.getSelection();
      var selLen = sel.rangeCount ? sel.toString().length : 0;
      ed.set(text.slice(0, off) + t + text.slice(off + selLen), off + t.length);
    });
    return ed;
  };

  // ====================================================================
  // 2. THE CODE TAB
  // ====================================================================
  var editors = {};           // movement key -> [editor]
  var currentPage = 'general';

  RP.onTemplatesChanged = function(key) {
    RP.renderParamTable(key, true);
    updateNavMarks();
    if (RP.render) RP.render();
  };

  function updateNavMarks() {
    var probs = RP.templateProblems();
    var nav = document.querySelectorAll('#movement-nav [data-page]');
    for (var i = 0; i < nav.length; i++) {
      var k = nav[i].dataset.page;
      var bad = probs.some(function(p) { return p.movement === k; });
      // An unused parameter is only a warning: nothing renders wrongly.
      var warn = !bad && k !== 'general' && RP.unusedParams(k).length > 0;
      nav[i].classList.toggle('has-problem', bad);
      nav[i].classList.toggle('has-warning', warn);
    }
  }

  function navHTML() {
    var h = '<button class="mv-nav-item' + (currentPage === 'general' ? ' active' : '') +
            '" data-page="general">' + RP.icon('settings') + '<span>General</span></button>' +
            '<div class="mv-nav-sep">Movements</div>';
    RP.MOVEMENTS.forEach(function(m) {
      h += '<button class="mv-nav-item' + (currentPage === m.key ? ' active' : '') + '" data-page="' + m.key + '">' +
           '<span>' + esc(m.label) + '</span><span class="mv-dot"></span></button>';
    });
    return h;
  }

  function generalHTML() {
    return '<h4 class="modal-section">Output</h4>' +
      '<div class="tmpl-grid">' +
      '<label><span>Comment prefix <small>header lines and notes</small></span><input type="text" id="code-comment"></label>' +
      '<label><span>Unit <small>mm, cm, m or in — for every measured length</small></span><input type="text" id="code-unit"></label>' +
      '<label><span>True / false spelled as <small>parameters and {reversed}</small></span><select id="code-bool-style">' +
        Object.keys(RP.BOOL_STYLES).map(function(k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('') +
      '</select></label>' +
      '</div>' +
      '<div class="hint">Each movement has its own template and its own parameters — pick one on the left. ' +
      'Templates are strict: your text, with each <span class="tok tok-param">placeholder</span> filled in and nothing else added. ' +
      'An empty value fills in nothing. Type <code>{</code> to insert one; write <code>{{name}}</code> for a literal <code>{name}</code>.</div>';
  }

  function movementHTML(m) {
    var h = '<h4 class="modal-section">' + esc(m.label) + ' template' + (m.templates.length > 1 ? 's' : '') + '</h4>';
    m.templates.forEach(function(t) {
      h += '<div class="tmpl-row"><div class="tmpl-label">' + esc(t.label) +
           (t.fallback ? ' <small>blank = same as ' + esc(m.templates[0].label) + '</small>' : '') +
           '</div><div class="tmpl-slot" data-tkey="' + t.key + '"></div></div>';
    });
    h += '<div class="builtin-row"><span class="kv-k">Built-in</span>' +
         m.builtins.map(function(b) {
           return '<span class="tok tok-builtin" title="' + esc(RP.BUILTINS[b]) + '">' + esc(b) + '</span>';
         }).join('') + '<span class="hint inline">measured from the drawing</span></div>';
    h += '<h4 class="modal-section">Parameters</h4><div id="param-table" data-key="' + m.key + '"></div>';
    return h;
  }

  RP.renderMovementEditor = function() {
    var nav = document.getElementById('movement-nav');
    var page = document.getElementById('movement-page');
    if (!nav || !page) return;
    nav.innerHTML = navHTML();
    editors = {};
    if (currentPage === 'general') {
      page.innerHTML = generalHTML();
      RP.CODE_CONFIG_FIELDS.forEach(function(f) {
        var el = document.getElementById(f.id);
        if (!el) return;
        el.value = RP.codeConfig[f.key];
        el.addEventListener('change', function() { RP.pushHistory('Edit code setting'); RP.updateCodeConfigFromUI(); });
        el.addEventListener('input', RP.updateCodeConfigFromUI);
      });
    } else {
      var m = RP.MOVEMENT_BY_KEY[currentPage];
      page.innerHTML = movementHTML(m);
      var mc = RP.movementConfig(m.key);
      editors[m.key] = [];
      m.templates.forEach(function(t) {
        var slot = page.querySelector('[data-tkey="' + t.key + '"]');
        var ed = RP.makeTemplateEditor({
          key: m.key,
          get: function() { return mc[t.key] || ''; },
          set: function(v) { mc[t.key] = v; },
          placeholder: t.fallback ? 'Same as ' + m.templates[0].label : 'Type the call your robot makes…'
        });
        slot.appendChild(ed.el);
        editors[m.key].push(ed);
      });
      RP.renderParamTable(m.key);
    }
    updateNavMarks();
  };

  // ---- parameter table -------------------------------------------------
  function defaultControl(p, idx) {
    if (p.type === 'bool') {
      return '<select data-f="default" data-i="' + idx + '">' +
        '<option value="true"' + (p.default === true ? ' selected' : '') + '>True</option>' +
        '<option value="false"' + (p.default === false ? ' selected' : '') + '>False</option>' +
        '<option value=""' + (p.default === '' || p.default == null ? ' selected' : '') + '>(empty)</option></select>';
    }
    if (p.type === 'choice') {
      var opts = (p.options || []);
      return '<select data-f="default" data-i="' + idx + '"><option value="">(empty)</option>' +
        opts.map(function(o) { return '<option' + (o === p.default ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        '</select>';
    }
    return '<input type="text" data-f="default" data-i="' + idx + '" value="' + esc(p.default) + '" placeholder="(empty)"' +
           (p.type === 'number' ? ' inputmode="decimal"' : '') + '>';
  }

  // onlyMarks: just refresh the "not in template" flags (while typing in
  // a template, rebuilding the inputs would steal focus).
  RP.renderParamTable = function(key, onlyMarks) {
    var host = document.getElementById('param-table');
    if (!host || host.dataset.key !== key) return;
    var params = RP.movementParams(key);
    var unused = RP.unusedParams(key);
    if (onlyMarks) {
      var rows = host.querySelectorAll('.param-row');
      for (var r = 0; r < rows.length; r++) {
        rows[r].classList.toggle('is-unused', unused.indexOf(rows[r].dataset.name) >= 0);
      }
      (editors[key] || []).forEach(function(ed) { if (document.activeElement !== ed.el) ed.refresh(); });
      return;
    }
    var h = '';
    if (params.length) {
      h += '<div class="param-head"><span>Name</span><span>Type</span><span>Default</span><span></span></div>';
    }
    params.forEach(function(p, i) {
      h += '<div class="param-row' + (unused.indexOf(p.name) >= 0 ? ' is-unused' : '') + '" data-name="' + esc(p.name) + '">' +
        '<input type="text" class="param-name" data-f="name" data-i="' + i + '" value="' + esc(p.name) + '" spellcheck="false">' +
        '<select data-f="type" data-i="' + i + '">' + RP.PARAM_TYPES.map(function(t) {
          return '<option value="' + t + '"' + (t === p.type ? ' selected' : '') + '>' + RP.PARAM_TYPE_LABELS[t] + '</option>';
        }).join('') + '</select>' +
        defaultControl(p, i) +
        '<button class="layer-vis-btn" data-f="del" data-i="' + i + '" title="Delete parameter">' + RP.icon('trash') + '</button>' +
        (p.type === 'choice'
          ? '<label class="param-options"><span>Options</span><input type="text" data-f="options" data-i="' + i + '" value="' +
            esc((p.options || []).join(', ')) + '" placeholder="slow, normal, fast"></label>' : '') +
        '<div class="param-warn">Not in any ' + esc(RP.MOVEMENT_BY_KEY[key].label) + ' template — a value typed for it goes nowhere.</div>' +
        '<div class="param-err"></div>' +
        '</div>';
    });
    if (!params.length) h += '<div class="hint">No parameters yet. Values that are not measured from the drawing — speed, acceleration, a blocking flag — go here.</div>';
    h += '<button class="pill-btn small" id="param-add">' + RP.icon('plus') + '<span>Add parameter</span></button>';
    host.innerHTML = h;
    wireParamTable(host, key);
    (editors[key] || []).forEach(function(ed) { ed.refresh(); });
  };

  function wireParamTable(host, key) {
    function param(i) { return RP.movementParams(key)[Number(i)]; }
    function after(full) {
      RP.renderParamTable(key, !full);
      updateNavMarks();
      if (RP.refreshRouteUI && RP.editMode === 'route') RP.refreshRouteUI();
      if (RP.render) RP.render();
    }
    host.querySelectorAll('[data-f="name"]').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var p = param(inp.dataset.i), v = inp.value.trim();
        if (v === p.name) return;
        RP.pushHistory('Rename parameter');
        var err = RP.renameParam(key, p.name, v);
        if (err) {
          RP.undoStack.pop();
          inp.value = p.name;
          var row = inp.closest('.param-row');
          row.querySelector('.param-err').textContent = err;
          row.classList.add('has-err');
          return;
        }
        after(true);
      });
      inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') inp.blur(); });
    });
    host.querySelectorAll('[data-f="type"]').forEach(function(sel) {
      sel.addEventListener('change', function() {
        RP.pushHistory('Change parameter type');
        RP.setParamType(key, param(sel.dataset.i).name, sel.value);
        after(true);
      });
    });
    host.querySelectorAll('[data-f="default"]').forEach(function(c) {
      c.addEventListener('change', function() {
        var p = param(c.dataset.i);
        var v = c.value;
        if (p.type === 'bool') v = v === 'true' ? true : v === 'false' ? false : '';
        else if (p.type === 'number' && v.trim() !== '' && !isFinite(Number(v))) {
          c.classList.add('invalid');
          c.title = 'Not a number';
          return;
        }
        c.classList.remove('invalid');
        RP.pushHistory('Edit parameter default');
        p.default = typeof v === 'string' ? v.trim() : v;
        after(false);
      });
    });
    host.querySelectorAll('[data-f="options"]').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var p = param(inp.dataset.i);
        RP.pushHistory('Edit parameter options');
        p.options = inp.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        if (p.default && p.options.indexOf(p.default) < 0) p.default = '';
        after(true);
      });
    });
    host.querySelectorAll('[data-f="del"]').forEach(function(b) {
      b.addEventListener('click', function() {
        RP.pushHistory('Delete parameter');
        RP.removeParam(key, param(b.dataset.i).name);
        after(true);
      });
    });
    var add = host.querySelector('#param-add');
    if (add) add.addEventListener('click', function() {
      var n = 1, name;
      do { name = 'param' + n++; } while (RP.findParam(key, name));
      RP.pushHistory('Add parameter');
      RP.addParam(key, { name: name, type: 'number', default: '' });
      after(true);
      var inputs = host.querySelectorAll('.param-name');
      var last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    });
  }

  // Nav clicks (delegated — the nav is re-rendered).
  document.addEventListener('click', function(e) {
    var item = e.target.closest && e.target.closest('#movement-nav [data-page]');
    if (!item) return;
    currentPage = item.dataset.page;
    RP.renderMovementEditor();
  });

  // Open Robot & Code on its Code tab.
  RP.openCodeTab = function() {
    if (!RP.robotOverlayVisible) RP.setRobotOverlay(true);
    var tab = document.querySelector('[data-tab-target="code"]');
    if (tab) tab.click();
  };

  RP.openMovementPage = function(key) {
    currentPage = key || 'general';
    RP.renderMovementEditor();
  };

  // ====================================================================
  // 3. PARAMETER ROWS IN THE ROUTE PANEL
  // ====================================================================
  // The markup for every parameter of the action's movement. Values the
  // action set itself are shown normally; inherited defaults show as grey
  // placeholder text, so "why is this move slow" has a visible answer.
  RP.paramRowsHTML = function(act) {
    var key = RP.movementForAction(act);
    if (!key) return '';
    var params = RP.movementParams(key);
    var label = RP.MOVEMENT_BY_KEY[key].label;
    var h = '<div class="ap-params"><div class="ap-params-head"><span>Parameters</span>' +
            '<button type="button" class="link-btn" data-open-movement="' + key + '" title="Edit ' + esc(label) +
            '’s template and parameters">' + RP.icon('settings') + esc(label) + '</button></div>';
    if (!params.length) {
      return h + '<div class="sidebar-hint">' + esc(label) + ' has no parameters.</div></div>';
    }
    params.forEach(function(p) {
      var own = RP.hasOwnParam(act, p.name);
      var v = own ? act.params[p.name] : '';
      var dflt = RP.formatParam(p, p.default);
      var ctl;
      if (p.type === 'bool') {
        var eff = own ? (v === true) : (p.default === true ? true : p.default === false ? false : null);
        ctl = '<span class="seg-toggle" data-param="' + esc(p.name) + '">' +
          '<button type="button" class="seg-btn' + (own && v === true ? ' active' : (!own && eff === true ? ' inherited' : '')) + '" data-val="true">' + esc(RP.boolWords()[0]) + '</button>' +
          '<button type="button" class="seg-btn' + (own && v === false ? ' active' : (!own && eff === false ? ' inherited' : '')) + '" data-val="false">' + esc(RP.boolWords()[1]) + '</button></span>';
      } else if (p.type === 'choice') {
        ctl = '<select data-param="' + esc(p.name) + '"' + (own ? '' : ' class="inherited"') + '>' +
          '<option value="">' + esc(dflt === '' ? '(empty)' : dflt) + ' · default</option>' +
          (p.options || []).map(function(o) {
            return '<option' + (own && o === v ? ' selected' : '') + '>' + esc(o) + '</option>';
          }).join('') + '</select>';
      } else {
        ctl = '<input type="text" data-param="' + esc(p.name) + '" value="' + esc(v) + '" placeholder="' +
              esc(dflt === '' ? '(empty)' : dflt) + '"' + (p.type === 'number' ? ' inputmode="decimal"' : '') +
              ' spellcheck="false">';
      }
      h += '<label class="ap-row param' + (own ? ' is-own' : '') + '"><span title="' + esc(RP.PARAM_TYPE_LABELS[p.type]) + '">' + esc(p.name) + '</span>' +
           ctl +
           '<button type="button" class="layer-vis-btn reset" data-reset="' + esc(p.name) + '" title="Back to the default (' +
           esc(dflt === '' ? 'empty' : dflt) + ')"' + (own ? '' : ' disabled') + '>' + RP.icon('undo') + '</button></label>';
    });
    return h + '</div>';
  };

  RP.wireParamRows = function(host, act) {
    var key = RP.movementForAction(act);
    host.querySelectorAll('[data-param]').forEach(function(c) {
      var name = c.dataset.param;
      var p = RP.findParam(key, name);
      if (!p) return;
      if (p.type === 'bool') {
        c.querySelectorAll('[data-val]').forEach(function(b) {
          b.addEventListener('click', function() { RP.setSelectedParam(name, b.dataset.val === 'true'); });
        });
        return;
      }
      c.addEventListener('change', function() {
        var v = c.value.trim();
        if (p.type === 'number' && v !== '' && !isFinite(Number(v))) {
          c.classList.add('invalid');
          c.title = 'Not a number — not saved';
          return;
        }
        RP.setSelectedParam(name, v);
      });
      c.addEventListener('keydown', function(e) { if (e.key === 'Enter') c.blur(); });
    });
    host.querySelectorAll('[data-reset]').forEach(function(b) {
      b.addEventListener('click', function(e) { e.preventDefault(); RP.setSelectedParam(b.dataset.reset, ''); });
    });
    host.querySelectorAll('[data-open-movement]').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.preventDefault();
        RP.openMovementPage(b.dataset.openMovement);
        RP.openCodeTab();
      });
    });
  };

  // Compact "speed 50 · brake true" of the values an action set itself,
  // for its row in the action list.
  RP.ownParamSummary = function(act) {
    var key = RP.movementForAction(act);
    if (!key || !act.params) return [];
    return RP.movementParams(key).filter(function(p) { return RP.hasOwnParam(act, p.name); })
      .map(function(p) { return p.name + ' ' + RP.formatParam(p, act.params[p.name]); });
  };

  // ====================================================================
  // Template problems, shown over the generated code.
  // ====================================================================
  RP.updateCodeWarnings = function() {
    var host = document.getElementById('code-warnings');
    if (!host) return;
    var probs = RP.templateProblems();
    host.classList.toggle('hidden', probs.length === 0);
    host.innerHTML = probs.map(function(p) {
      return '<button type="button" class="code-warn" data-open-movement="' + p.movement + '">' + RP.icon('warning') +
             '<span>' + esc(p.message) + ' — printed as typed</span></button>';
    }).join('');
    host.querySelectorAll('[data-open-movement]').forEach(function(b) {
      b.addEventListener('click', function() {
        RP.openMovementPage(b.dataset.openMovement);
        RP.openCodeTab();
      });
    });
  };
})();
