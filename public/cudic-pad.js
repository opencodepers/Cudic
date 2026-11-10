/* file: public/cudic-pad.js
 * what: Gamepad API shim injected into the player frame — CudicPad.get() snapshots plus connect/button/axis events.
 * invariants: runs inside the sandboxed game document; never touches the account token or the parent page. Polls only after start()/on().
 * see: public/docs.html#pad, public/run.html
 */
(function () {
  if (window.CudicPad) return;

  var listeners = { connect: [], disconnect: [], buttondown: [], buttonup: [], axischanged: [] };
  var prev = {};        // gamepad index -> { buttons: bool[], axes: number[] }
  var running = false;
  var raf = 0;

  function pads() {
    try {
      var raw = navigator.getGamepads ? navigator.getGamepads() : [];
      return Array.prototype.slice.call(raw || []).filter(Boolean);
    } catch (e) { return []; }
  }

  function snapshot(pad) {
    if (!pad) return null;
    return {
      index: pad.index,
      id: pad.id,
      connected: !!pad.connected,
      mapping: pad.mapping || '',
      axes: Array.prototype.slice.call(pad.axes || []),
      buttons: Array.prototype.map.call(pad.buttons || [], function (b) {
        return { pressed: !!b.pressed, value: Number(b.value) || 0 };
      })
    };
  }

  function emit(type, payload) {
    (listeners[type] || []).slice().forEach(function (fn) {
      try { fn(payload); }
      catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }

  function poll() {
    if (!running) return;
    var list = pads();
    var seen = {};
    var deadzone = Math.max(0.05, Number(api.deadzone) || 0.18);
    list.forEach(function (pad) {
      seen[pad.index] = true;
      var state = prev[pad.index];
      if (!state) {
        // Seed the edges so a button already held at connect time does not
        // fire a phantom press.
        prev[pad.index] = {
          buttons: Array.prototype.map.call(pad.buttons || [], function (b) { return !!b.pressed; }),
          axes: Array.prototype.slice.call(pad.axes || [])
        };
        emit('connect', { pad: snapshot(pad), index: pad.index });
        return;
      }
      Array.prototype.forEach.call(pad.buttons || [], function (b, i) {
        var now = !!b.pressed;
        if (now !== !!state.buttons[i]) {
          state.buttons[i] = now;
          emit(now ? 'buttondown' : 'buttonup', { pad: snapshot(pad), index: pad.index, button: i, value: Number(b.value) || 0 });
        }
      });
      Array.prototype.forEach.call(pad.axes || [], function (v, i) {
        var value = Number(v) || 0;
        var old = Number(state.axes[i]) || 0;
        if (Math.abs(value - old) >= deadzone) {
          state.axes[i] = value;
          emit('axischanged', { pad: snapshot(pad), index: pad.index, axis: i, value: value });
        }
      });
    });
    Object.keys(prev).forEach(function (key) {
      if (!seen[key]) {
        emit('disconnect', { index: Number(key) });
        delete prev[key];
      }
    });
    raf = requestAnimationFrame(poll);
  }

  function start() {
    if (running) return true;
    if (!navigator.getGamepads) return false;
    running = true;
    prev = {};
    raf = requestAnimationFrame(poll);
    return true;
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    prev = {};
    return true;
  }

  function on(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
    start();
    return function () { off(type, fn); };
  }

  function off(type, fn) {
    var arr = listeners[type] || [];
    var i = arr.indexOf(fn);
    if (i !== -1) arr.splice(i, 1);
  }

  var api = {
    supported: !!navigator.getGamepads,
    get: function (index) { return snapshot(pads()[index || 0] || null); },
    pads: pads,
    on: on,
    off: off,
    start: start,
    stop: stop,
    deadzone: 0.18,
    version: 1
  };
  window.CudicPad = api;
})();
