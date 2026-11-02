/* CudicTouch — on-screen controls for phones, one script tag.
 *
 *   <script src="/cudic-touch.js?v=2" data-cudic-touch="auto"></script>
 *      (customize: data-cudic-touch="auto:A=Space,B=z,D=arrows,J=on,dpad=false")
 *
 *   var t = CudicTouch.auto();   // mounts only on touch-first devices
 *   CudicTouch.mount({ keys:'wasd', joystick:true,
 *                      buttons:[{ key:'Space', label:'JUMP' }] });
 *   CudicTouch.hide(); CudicTouch.show(); CudicTouch.unmount();
 *   CudicTouch.mounted;  CudicTouch.version;
 *
 * The overlay lives inside the game's own document, so it works in the
 * sandboxed live player, in Studio previews and on file:// with no
 * mediator. Taps become standard keydown/keyup events at document level,
 * carrying key, code and a legacy keyCode/which — any game that already
 * listens for arrow keys, WASD or Space plays on a phone unedited.
 *
 * The D-pad is one 3x3 cluster whose corners are real multitouch zones:
 * pressing two adjacent directions yields a diagonal without dead spots.
 * Joystick mode (J=on, or { joystick: true }) swaps the cluster for a
 * drag-anywhere stick: hold it anywhere in the base, drag to steer, and
 * 8 compass sectors map to key pairs so diagonals are first-class. Both
 * keep working when the finger drifts or leaves the base — the stick
 * re-centers and releases the keys on pointerup/leave, never leaving a
 * key stuck down.
 * Style: pixel squares, brand palette (lime action button, ink pad),
 * ~45% idle opacity, short vibrate on press where the phone allows it.
 */
(function () {
  if (window.CudicTouch) return;

  var KEY_ALIASES = {
    ' ': { key: ' ', code: 'Space', keyCode: 32 },
    space: { key: ' ', code: 'Space', keyCode: 32 },
    enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
    up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
  };
  var PAD_ICONS = {
    up: '...##...|..####..|.######.|##.aa.##|.######.|..####..|...##...|........',
    down: '........|...##...|..####..|.######.|##.aa.##|.######.|..####..|...##...',
    left: '....##..|...###..|..####..|.######.|a#####..|..####..|...###..|....##..',
    right: '..##....|..###...|..####..|..#####a|.######.|..####..|..###...|..##....'
  };
  // Lime spark marks the "point" of each arrow, per the icon-set rule.
  function icon(dir) {
    var s = '';
    PAD_ICONS[dir].split('|').forEach(function (r, y) {
      for (var x = 0; x < 8; x++) {
        var c = r[x];
        if (c === '.') continue;
        s += '<rect x="' + x + '" y="' + y + '" width="1.02" height="1.02" fill="' + (c === 'a' ? '#b8f23a' : 'currentColor') + '" shape-rendering="crispEdges"/>';
      }
    });
    return '<svg width="22" height="22" viewBox="0 0 8 8" style="display:block">' + s + '</svg>';
  }

  var KEYMAPS = {
    arrows: { up: 'up', down: 'down', left: 'left', right: 'right' },
    wasd: { up: 'w', down: 's', left: 'a', right: 'd' }
  };
  var DEFAULTS = {
    dpad: true,
    keys: 'arrows',
    buttons: [{ key: ' ', label: 'A', accent: 'a' }]
  };
  var held = {}, root = null, vibrate = true, size = 54;

  function isCoarse() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  }
  function buzz() { if (!vibrate) return; try { navigator.vibrate && navigator.vibrate(9); } catch (e) {} }

  function keyDef(name) {
    var n = String(name || ' ').trim();
    var d = KEY_ALIASES[n.toLowerCase()];
    if (d) return d;
    // Plain letters (or any single character): best-effort code/keyCode.
    var d2 = { key: n, code: /^[a-zA-Z]$/.test(n) ? 'Key' + n.toUpperCase() : n, keyCode: /^[a-zA-Z]$/.test(n) ? n.toLowerCase().charCodeAt(0) - 96 + 64 : 0 };
    KEY_ALIASES[n.toLowerCase()] = d2;
    return d2;
  }
  function dispatch(k, down) {
    var d = keyDef(k);
    var ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { key: d.key, code: d.code, bubbles: true, cancelable: true });
    // Games written against e.keyCode / e.which never see constructor-set
    // values, so pin both onto the instance (read-only in some engines).
    try {
      Object.defineProperty(ev, 'keyCode', { get: function () { return d.keyCode; } });
      Object.defineProperty(ev, 'which', { get: function () { return d.keyCode; } });
    } catch (e) {}
    document.dispatchEvent(ev);
  }
  function setState(k, down, el) {
    if (el) {
      el.style.opacity = down ? '.95' : '';
      el.style.transform = down ? 'scale(.92)' : '';
    }
    if (held[k] === down) return; // no-op re-press or stray duplicate release
    held[k] = down;
    dispatch(k, down);
    if (down) buzz();
  }

  function pressable(el, k) {
    function down(e) { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (err) {} setState(k, true, el); }
    function up(e) { e.preventDefault(); setState(k, false, el); }
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', function () { if (held[k]) setState(k, false, el); });
  }

  function styleBtn(base) {
    return base + ';width:' + size + 'px;height:' + size + 'px;border:2px solid currentColor;border-radius:0;background:rgba(20,22,27,.55);color:currentColor;opacity:.45;transition:opacity .12s steps(2),transform .12s steps(2);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;pointer-events:auto;padding:0;display:flex;align-items:center;justify-content:center;font:600 18px/1 "Geist Mono",ui-monospace,monospace;flex-shrink:0';
  }
  function buildBtn(cfg) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = cfg.label || keyDef(cfg.key).key.toUpperCase();
    b.style.cssText = styleBtn('');
    if (cfg.accent === 'a') { b.style.color = '#b8f23a'; b.style.borderColor = '#b8f23a'; }
    pressable(b, cfg.key);
    return b;
  }
  function buildDpad(map) {
    var c = size * 0.86;
    var pad = document.createElement('div');
    pad.style.cssText = 'position:relative;width:' + (c * 3) + 'px;height:' + (c * 3) + 'px;flex-shrink:0';
    [[1, 0, 'up'], [0, 1, 'left'], [2, 1, 'right'], [1, 2, 'down']].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = icon(t[2]);
      b.setAttribute('aria-label', 'touch ' + t[2]);
      b.style.cssText = styleBtn('position:absolute;left:' + (t[0] * c) + 'px;top:' + (t[1] * c) + 'px');
      pressable(b, map[t[2]]);
      pad.appendChild(b);
    });
    return pad;
  }

  // ── Joystick: drag-anywhere stick, 8 compass sectors → key pairs ──
  var stickHeld = {};
  function stickApply(want) {
    Object.keys(stickHeld).forEach(function (k) {
      if (stickHeld[k] && want.indexOf(k) === -1) { stickHeld[k] = false; dispatch(k, false); }
    });
    want.forEach(function (k) {
      if (!stickHeld[k]) { stickHeld[k] = true; dispatch(k, true); }
    });
  }
  // Sector round(angle/45°): ±0 right, ±1 diagonal, ±2 vertical, ±4 left.
  function wantKeys(s, map) {
    switch (s) {
      case 0: return [map.right];
      case 1: return [map.up, map.right];
      case 2: return [map.up];
      case 3: return [map.up, map.left];
      case 4: case -4: return [map.left];
      case -1: return [map.down, map.right];
      case -2: return [map.down];
      case -3: return [map.down, map.left];
    }
    return [];
  }
  function buildStick(map) {
    var R = size * 1.35, K = size * 0.7;
    var base = document.createElement('div');
    base.setAttribute('aria-label', 'touch joystick');
    base.style.cssText = styleBtn('position:relative') + ';width:' + R + 'px;height:' + R + 'px;border-color:#b8f23a;color:currentColor';
    // static hint arrows on the four mid-edges, tiny and dim
    [['up', R / 2 - 11, 6], ['down', R / 2 - 11, R - 28], ['left', 6, R / 2 - 11], ['right', R - 28, R / 2 - 11]].forEach(function (h) {
      var hint = document.createElement('div');
      hint.style.cssText = 'position:absolute;left:' + h[1] + 'px;top:' + h[2] + 'px;color:currentColor;opacity:.35;pointer-events:none';
      hint.innerHTML = icon(h[0]);
      base.appendChild(hint);
    });
    var knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;left:' + ((R - K) / 2) + 'px;top:' + ((R - K) / 2) + 'px;width:' + K + 'px;height:' + K + 'px;box-sizing:border-box;border:2px solid #b8f23a;background:rgba(184,242,58,.25);transition:transform .07s steps(2);pointer-events:none';
    base.appendChild(knob);
    var grabbed = false;
    function apply(e) {
      var r = base.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      var mag = Math.hypot(dx, dy);
      var px = Math.max(-0.62, Math.min(0.62, dx)) * (R - K);
      var py = Math.max(-0.62, Math.min(0.62, dy)) * (R - K);
      knob.style.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
      if (mag < 0.28) stickApply([]);
      else stickApply(wantKeys(Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)), map));
    }
    function recentre() {
      grabbed = false;
      base.style.opacity = '';
      knob.style.transform = '';
      stickApply([]);
    }
    base.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    base.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { base.setPointerCapture(e.pointerId); } catch (err) {}
      grabbed = true;
      base.style.opacity = '.92';
      buzz();
      apply(e);
    });
    base.addEventListener('pointermove', function (e) { if (grabbed) apply(e); });
    base.addEventListener('pointerup', function (e) { e.preventDefault(); recentre(); });
    base.addEventListener('pointercancel', function () { recentre(); });
    base.addEventListener('lostpointercapture', function () { if (grabbed) recentre(); });
    return base;
  }

  function layout(opts) {
    unmount();
    root = document.createElement('div');
    root.setAttribute('data-cudic-touch', 'on');
    root.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:0 18px calc(14px + env(safe-area-inset-bottom,0px));display:flex;justify-content:space-between;align-items:flex-end;gap:12px;z-index:2147483000;pointer-events:none;user-select:none;-webkit-user-select:none';
    if (opts.joystick) root.appendChild(buildStick(KEYMAPS[opts.keys] || KEYMAPS.arrows));
    else if (opts.dpad !== false) root.appendChild(buildDpad(KEYMAPS[opts.keys] || KEYMAPS.arrows));
    var col = document.createElement('div');
    col.style.cssText = 'display:flex;gap:14px;align-items:flex-end;flex:1;justify-content:flex-end;pointer-events:none';
    (opts.buttons || []).forEach(function (c) { col.appendChild(buildBtn(c)); });
    root.appendChild(col);
    document.body.appendChild(root);
    return root;
  }

  function unmount() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    Object.keys(held).forEach(function (k) { if (held[k]) dispatch(k, false); });
    Object.keys(stickHeld).forEach(function (k) { if (stickHeld[k]) dispatch(k, false); });
    held = {}; stickHeld = {}; root = null;
  }

  function auto(spec) {
    var opts;
    if (typeof spec === 'string') opts = parseSpec(spec);
    else if (spec) opts = spec;
    else opts = { keys: 'arrows' };
    if (!opts) return null;
    opts.dpad = typeof opts.dpad === 'boolean' ? opts.dpad : DEFAULTS.dpad;
    if (!(opts.buttons || []).length) opts.buttons = DEFAULTS.buttons.slice();
    if (!isCoarse()) return null;
    if (root) return root;
    return layout(opts);
  }
  // "A=Space,B=z,D=arrows,dpad=false" → options object (see header).
  function parseSpec(spec) {
    var o = {};
    String(spec || '').split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var kv = part.split('=');
      var k = kv[0].trim().toLowerCase();
      if (kv.length === 1) { o.dpad = k !== 'dpad:false'; return; }
      var v = kv.slice(1).join('=').trim();
      if (k === 'd') o.keys = v.toLowerCase();
      else if (k === 'dpad') o.dpad = v !== 'false';
      else if (k === 'j') o.joystick = v !== 'off' && v !== 'false';
      else {
        // "A=Space" → a button whose label is the token before '=' and
        // whose key is what follows. First button lime, later ones blue.
        (o.buttons = o.buttons || []).push({ key: v, label: kv[0].trim(), accent: (o.buttons || []).length ? 'o' : 'a' });
      }
    });
    return o;
  }

  window.CudicTouch = {
    auto: auto,
    mount: function (opts) { return layout(Object.assign({}, DEFAULTS, opts || {})); },
    show: function () { if (root) root.style.display = ''; return !!root; },
    hide: function () { if (root) root.style.display = 'none'; return !!root; },
    unmount: unmount,
    get mounted() { return !!root; },
    version: 2
  };

  // Self-boot: <script ... data-cudic-touch="auto"> mounts with defaults on
  // touch-first devices; "auto:A=Space,B=z,D=wasd..." passes options.
  var me = document.currentScript;
  if (me) {
    var spec = me.getAttribute('data-cudic-touch');
    if (spec && spec.indexOf('auto') === 0) {
      var opts = spec.length > 4 ? spec.slice(4) : '';
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { auto(opts); });
      } else auto(opts);
    }
  }
})();
