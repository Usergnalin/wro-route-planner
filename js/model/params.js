/* ========================================================================
   params.js - Movement parameters and the templates that use them.

   Each movement (forward, turn, arc, ...) owns a code template and its
   own list of parameters. A template is STRICT: it is the user's own text
   with {placeholders} filled in, and nothing else is ever added or
   removed — no commas, no quoting, no guessing at the target language's
   argument syntax. A parameter whose value is empty fills in nothing.

   A placeholder resolves, in order, to:
     1. a built-in of that movement (RP.BUILTINS) — measured, read-only
     2. a parameter of that movement — the action's own value if it set
        one, otherwise the parameter's default
   Anything else is left in the output exactly as typed and reported by
   RP.templateProblems(), so a typo cannot vanish silently.

   {{name}} is the escape for a literal "{name}" in the output (a C++
   brace initialiser around a bare identifier, say). Other braces — {1,2},
   {.x = 3}, a lone { — are never placeholders and pass through untouched.

   Values live on each action as act.params = { name: value }. Missing
   means "use the default". Number, text and choice values are stored as
   the text the user typed, so 80 prints as 80 and 80.0 as 80.0; booleans
   are stored as true/false and spelled per codeConfig.boolStyle.
   ======================================================================== */
var RP = window.RP || {};

RP.PARAM_TYPES = ['number', 'text', 'bool', 'choice'];
RP.PARAM_TYPE_LABELS = { number: 'Number', text: 'Text', bool: 'True / false', choice: 'Choice' };
RP.PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---- template parsing ------------------------------------------------
RP.TEMPLATE_TOKEN_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

// [{ text }, { name }, ...] — the one tokenizer that both codegen and the
// template editor use, so the editor can never show a token the output
// would not fill in, or the reverse.
RP.parseTemplate = function(str) {
  var out = [];
  var s = String(str == null ? '' : str);
  var last = 0, m;
  RP.TEMPLATE_TOKEN_RE.lastIndex = 0;
  while ((m = RP.TEMPLATE_TOKEN_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    if (m[1] != null) out.push({ text: '{' + m[1] + '}', escaped: true });
    else out.push({ name: m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
};

// The inverse of parseTemplate: escaped literals go back to {{name}}.
RP.joinTemplate = function(toks) {
  return toks.map(function(t) {
    if (t.name) return '{' + t.name + '}';
    return t.escaped ? '{' + t.text + '}' : t.text;
  }).join('');
};

RP.templateNames = function(str) {
  return RP.parseTemplate(str).filter(function(t) { return t.name; })
                              .map(function(t) { return t.name; });
};

// ---- config access ---------------------------------------------------
RP.movementConfig = function(key) {
  var cfg = RP.codeConfig && RP.codeConfig.movements;
  return cfg ? cfg[key] || null : null;
};

RP.movementParams = function(key) {
  var mc = RP.movementConfig(key);
  return (mc && mc.params) || [];
};

RP.findParam = function(key, name) {
  var ps = RP.movementParams(key);
  for (var i = 0; i < ps.length; i++) if (ps[i].name === name) return ps[i];
  return null;
};

RP.isBuiltinOf = function(key, name) {
  var m = RP.MOVEMENT_BY_KEY[key];
  return !!m && m.builtins.indexOf(name) >= 0;
};

// Which movement an action renders as — the key into RP.MOVEMENTS.
// Teleports emit only comments, so they have none.
RP.MOVE_TO_MOVEMENT = {
  forward: 'forward', arc: 'arc', smooth: 'smooth', wall_align: 'wall_align',
  linetrace_dist: 'linetrace', linetrace_junct: 'linetrace_junct'
};
RP.movementForAction = function(act) {
  if (!act) return null;
  if (RP.isTurnAction(act)) return 'turn';
  if (RP.isCheckpointAction(act)) return 'checkpoint';
  if (RP.isMoveAction(act)) return RP.MOVE_TO_MOVEMENT[act.move || 'forward'] || null;
  return null;
};

// ---- values ----------------------------------------------------------
RP.boolWords = function() {
  var style = RP.codeConfig && RP.codeConfig.boolStyle;
  return RP.BOOL_STYLES[style] || RP.BOOL_STYLES['True/False'];
};

RP.formatBool = function(v) {
  if (v === '' || v == null) return '';
  return RP.boolWords()[v === true || v === 'true' ? 0 : 1];
};

// Has the action set its own value for this parameter? An empty field
// means "default", so '' is never an override.
RP.hasOwnParam = function(act, name) {
  if (!act || !act.params) return false;
  var v = act.params[name];
  return v !== undefined && v !== null && v !== '';
};

// The raw (unformatted) value in effect: the action's own, else the default.
RP.paramRaw = function(param, actParams) {
  var v = actParams ? actParams[param.name] : undefined;
  if (v === undefined || v === null || v === '') v = param.default;
  return v == null ? '' : v;
};

RP.formatParam = function(param, raw) {
  if (param.type === 'bool') return RP.formatBool(raw);
  return String(raw == null ? '' : raw);
};

// ---- rendering -------------------------------------------------------
// builtins: { name: already-formatted string }. Unknown placeholders stay
// as typed — see the header — and are reported by templateProblems().
RP.renderTemplate = function(key, tmpl, builtins, actParams) {
  var toks = RP.parseTemplate(tmpl);
  var out = '';
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i];
    if (!t.name) { out += t.text; continue; }
    if (RP.isBuiltinOf(key, t.name) && builtins && builtins[t.name] !== undefined) {
      out += builtins[t.name];
      continue;
    }
    var p = RP.findParam(key, t.name);
    out += p ? RP.formatParam(p, RP.paramRaw(p, actParams)) : '{' + t.name + '}';
  }
  return out;
};

// The template text a step renders with. Variants (pivot styles) fall
// back to the movement's own template when left blank.
RP.templateFor = function(key, variant) {
  var mc = RP.movementConfig(key);
  if (!mc) return '';
  if (variant && mc[variant] && String(mc[variant]).trim()) return mc[variant];
  return mc.template || '';
};

// Every placeholder that resolves to nothing, across every template.
// [{ movement, label, template, name, message }]
RP.templateProblems = function() {
  var out = [];
  RP.MOVEMENTS.forEach(function(m) {
    var mc = RP.movementConfig(m.key);
    if (!mc) return;
    m.templates.forEach(function(tdef) {
      var names = RP.templateNames(mc[tdef.key]);
      var seen = {};
      names.forEach(function(n) {
        if (seen[n] || RP.isBuiltinOf(m.key, n) || RP.findParam(m.key, n)) return;
        seen[n] = true;
        out.push({ movement: m.key, label: tdef.label, template: tdef.key, name: n,
                   message: tdef.label + ': {' + n + '} is not a parameter or built-in of ' + m.label });
      });
    });
  });
  return out;
};

// Parameters defined but not placed in any of the movement's templates —
// a value typed for one of these would never reach the code.
RP.unusedParams = function(key) {
  var m = RP.MOVEMENT_BY_KEY[key];
  var mc = RP.movementConfig(key);
  if (!m || !mc) return [];
  var used = {};
  m.templates.forEach(function(tdef) {
    RP.templateNames(mc[tdef.key]).forEach(function(n) { used[n] = true; });
  });
  return (mc.params || []).filter(function(p) { return !used[p.name]; })
                          .map(function(p) { return p.name; });
};

// ---- editing parameters ----------------------------------------------
// null when fine, otherwise a sentence saying why not.
RP.paramNameError = function(key, name, exceptName) {
  if (!name) return 'A parameter needs a name.';
  if (!RP.PARAM_NAME_RE.test(name)) return 'Use letters, digits and _ only, not starting with a digit.';
  if (RP.BUILTINS[name]) return '{' + name + '} is a built-in value measured from the drawing.';
  if (name !== exceptName && RP.findParam(key, name)) return 'This movement already has a parameter called ' + name + '.';
  return null;
};

function eachActionOf(key, fn) {
  (RP.routes || []).forEach(function(r) {
    (r.actions || []).forEach(function(a) { if (RP.movementForAction(a) === key) fn(a); });
  });
}

RP.addParam = function(key, param) {
  var mc = RP.movementConfig(key);
  if (!mc) return 'Unknown movement.';
  var err = RP.paramNameError(key, param.name);
  if (err) return err;
  if (!mc.params) mc.params = [];
  mc.params.push({
    name: param.name,
    type: RP.PARAM_TYPES.indexOf(param.type) >= 0 ? param.type : 'number',
    default: param.default != null ? param.default : '',
    options: param.options || []
  });
  return null;
};

// Renaming rewrites the movement's own templates and every action value,
// so nothing that used the old name is left pointing at nothing.
RP.renameParam = function(key, oldName, newName) {
  var p = RP.findParam(key, oldName);
  if (!p) return 'No such parameter.';
  if (oldName === newName) return null;
  var err = RP.paramNameError(key, newName, oldName);
  if (err) return err;
  var mc = RP.movementConfig(key);
  RP.MOVEMENT_BY_KEY[key].templates.forEach(function(tdef) {
    var toks = RP.parseTemplate(mc[tdef.key]);
    if (!toks.some(function(t) { return t.name === oldName; })) return;
    mc[tdef.key] = RP.joinTemplate(toks.map(function(t) {
      return (t.name === oldName) ? { name: newName } : t;
    }));
  });
  eachActionOf(key, function(a) {
    if (a.params && Object.prototype.hasOwnProperty.call(a.params, oldName)) {
      a.params[newName] = a.params[oldName];
      delete a.params[oldName];
    }
  });
  p.name = newName;
  return null;
};

// Placeholders that used it are left in place, so they show up as
// problems rather than silently printing nothing.
RP.removeParam = function(key, name) {
  var mc = RP.movementConfig(key);
  if (!mc || !mc.params) return false;
  var before = mc.params.length;
  mc.params = mc.params.filter(function(p) { return p.name !== name; });
  eachActionOf(key, function(a) { if (a.params) delete a.params[name]; });
  return mc.params.length < before;
};

// Changing a parameter's type invalidates values typed for the old one
// (a "fast" choice is not a number), so they go back to the default.
RP.setParamType = function(key, name, type) {
  var p = RP.findParam(key, name);
  if (!p || p.type === type) return;
  p.type = type;
  p.default = type === 'bool' ? false : '';
  if (type === 'choice' && !p.options) p.options = [];
  eachActionOf(key, function(a) { if (a.params) delete a.params[name]; });
};

// A move switched to another movement keeps the values whose names the
// new movement also has, and drops the rest.
RP.pruneParamsTo = function(act, key) {
  if (!act || !act.params) return;
  for (var n in act.params) {
    if (Object.prototype.hasOwnProperty.call(act.params, n) && !RP.findParam(key, n)) delete act.params[n];
  }
};

// ---- migration -------------------------------------------------------
// Actions from before parameters carried speed / extraArgs / junctions as
// fields of their own. They become ordinary parameter values, so an old
// project (and every old-format test fixture) renders exactly as before
// under the default templates.
RP.normalizeActionParams = function(act) {
  if (!act) return act;
  if (!act.params || typeof act.params !== 'object') act.params = {};
  if (act.speed !== undefined) {
    if (act.speed != null && act.speed !== '') act.params.speed = String(act.speed);
    delete act.speed;
  }
  if (act.extraArgs !== undefined) {
    if (act.extraArgs) act.params.extra_args = String(act.extraArgs);
    delete act.extraArgs;
  }
  if (act.junctions !== undefined) {
    if (act.junctions != null && act.junctions !== '') act.params.junctions = String(act.junctions);
    delete act.junctions;
  }
  return act;
};

RP.normalizeAllActionParams = function() {
  (RP.routes || []).forEach(function(r) {
    (r.actions || []).forEach(RP.normalizeActionParams);
  });
};

// Old saves had one flat template per movement, a global defaultSpeed and
// optional per-kind speeds. Each movement gets parameters for the
// placeholders its old template actually used.
var OLD_TEMPLATE_KEYS = {
  forward: { template: 'forwardTemplate' },
  turn: { template: 'turnTemplate', pivotLeft: 'turnPivotLeftTemplate', pivotRight: 'turnPivotRightTemplate' },
  arc: { template: 'turnArcTemplate' },
  smooth: { template: 'smoothTemplate' },   // newer than flat configs: always the default
  wall_align: { template: 'wallAlignTemplate' },
  linetrace: { template: 'lineTraceDistTemplate' },
  linetrace_junct: { template: 'lineTraceJunctTemplate' },
  checkpoint: { template: 'checkpointTemplate' }
};
var OLD_SPEED_KEYS = {
  forward: 'defaultSpeedForward', turn: 'defaultSpeedTurn', arc: 'defaultSpeedArc',
  wall_align: 'defaultSpeedWallAlign', linetrace: 'defaultSpeedLineTraceDist',
  linetrace_junct: 'defaultSpeedLineTraceJunct'
};

RP.migrateCodeConfig = function(cfg) {
  if (cfg.movements) return cfg;
  var global = (cfg.defaultSpeed != null && cfg.defaultSpeed !== '') ? cfg.defaultSpeed : 200;
  var mv = {};
  RP.MOVEMENTS.forEach(function(m) {
    var def = RP.DEFAULT_MOVEMENTS[m.key];
    var keys = OLD_TEMPLATE_KEYS[m.key];
    var mc = { params: [] };
    m.templates.forEach(function(tdef) {
      var old = cfg[keys[tdef.key]];
      mc[tdef.key] = (old != null && (old !== '' || tdef.fallback)) ? String(old) : def[tdef.key];
    });
    var seen = {};
    m.templates.forEach(function(tdef) {
      RP.templateNames(mc[tdef.key]).forEach(function(n) {
        if (seen[n] || RP.BUILTINS[n]) return;
        seen[n] = true;
        if (n === 'speed') {
          var per = cfg[OLD_SPEED_KEYS[m.key]];
          mc.params.push({ name: 'speed', type: 'number',
                           default: String(per != null && per !== '' ? per : global) });
        } else if (n === 'junctions') {
          mc.params.push({ name: 'junctions', type: 'number', default: '1' });
        } else {
          mc.params.push({ name: n, type: 'text', default: '' });
        }
      });
    });
    mv[m.key] = mc;
  });
  var out = {};
  RP.CODE_CONFIG_FIELDS.forEach(function(f) {
    out[f.key] = (cfg[f.key] != null && cfg[f.key] !== '') ? cfg[f.key] : f.default;
  });
  out.movements = mv;
  return out;
};
