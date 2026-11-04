/* CudicClip — one-click share clips for published games.
 *
 * Loaded INSIDE the player frame (run.html injects it into the game document
 * alongside the localStorage shim). The frame is sandboxed without
 * allow-same-origin on purpose — the parent page can't read this document, so
 * the game page asks for a clip over postMessage and gets the finished file
 * back as a Blob (structured-cloneable across the sandbox boundary).
 *
 * Protocol (view.html <-> player frame), bump `v` on any change:
 *   frame  -> {type:'cudic-clip-ready', v, can}            once at boot
 *   parent -> {type:'cudic-clip-start', seconds, title, by, score}
 *   frame  -> {type:'cudic-clip-done', v, blob, mime}
 *   frame  -> {type:'cudic-clip-error', v, error}
 *
 * Everything is drawn onto one composite canvas (the game canvas is a live
 * source, not something we can write to), and the recorder captures that —
 * so the overlay costs the game nothing and works for 2D, WebGL and mixed
 * projects alike. No audio track: a canvas stream has none, and pulling the
 * game's <audio> in would need a destination node per element.
 */
(function () {
  if (window.CudicClip) return;
  var V = 1;
  var LONG_EDGE = 1280;      // cap the long edge: keeps an 8s clip a few MB
  var LIME = '#b8f23a';
  var INK = '#f7f5ec';
  var active = false;

  function post(msg) {
    msg.v = V;
    try { parent.postMessage(msg, '*'); } catch (e) {}
  }
  function fail(error) { active = false; post({ type: 'cudic-clip-error', error: error }); }

  function supported() {
    try {
      return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && window.Blob);
    } catch (e) { return false; }
  }

  // The game's main surface: the largest canvas that actually has pixels.
  // Games that add HUD canvases on top still get the big one; DOM-only games
  // have nothing to record and are told so honestly.
  function mainCanvas() {
    var list = document.querySelectorAll('canvas'), best = null, area = 0;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var w = c.width | 0, h = c.height | 0;
      if (w < 32 || h < 32) continue;
      if (w * h > area) { area = w * h; best = c; }
    }
    return best;
  }

  function pickMime() {
    var tries = [
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
      'video/mp4;codecs=avc1', 'video/mp4',
    ];
    for (var i = 0; i < tries.length; i++) {
      try { if (MediaRecorder.isTypeSupported(tries[i])) return tries[i]; } catch (e) {}
    }
    return '';
  }

  function font(size, weight) {
    return (weight || 600) + ' ' + Math.round(size) + 'px Geist, system-ui, -apple-system, "Segoe UI", sans-serif';
  }
  function monoFont(size) {
    return '500 ' + Math.round(size) + 'px "Geist Mono", ui-monospace, Menlo, monospace';
  }

  // Trim a string to fit a width, with an ellipsis. Called once per frame —
  // cheap, and keeps long titles from sliding under the badge.
  function fit(ctx, text, max) {
    if (!text) return '';
    if (ctx.measureText(text).width <= max) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  function drawFrame(ctx, src, w, h, opts, elapsed, dur) {
    var u = Math.max(1, Math.round(h / 40)); // one design unit, scales with the clip

    ctx.fillStyle = '#0d0e10';
    ctx.fillRect(0, 0, w, h);

    // Contain the game, never crop it: a cut-off player looks worse than bars.
    var sw = src.width || w, sh = src.height || h;
    var s = Math.min(w / sw, h / sh);
    var dw = Math.round(sw * s), dh = Math.round(sh * s);
    var dx = Math.round((w - dw) / 2), dy = Math.round((h - dh) / 2);
    try { ctx.drawImage(src, dx, dy, dw, dh); } catch (e) { /* WebGL context loss mid-clip */ }

    // Vignette so the overlay text stays readable over bright games.
    var g = ctx.createLinearGradient(0, h * 0.55, 0, h);
    if (g) {
      g.addColorStop(0, 'rgba(13,14,16,0)');
      g.addColorStop(1, 'rgba(13,14,16,0.82)');
      ctx.fillStyle = g;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);
    }

    // Brand corners — the same crisp bracket motif as the site chrome.
    ctx.fillStyle = LIME;
    var t = u * 1.6, pad = u * 2;
    ctx.fillRect(pad, pad, t, u * 0.9);
    ctx.fillRect(pad, pad, u * 0.9, t);
    ctx.fillRect(w - pad - t, pad, t, u * 0.9);
    ctx.fillRect(w - pad - u * 0.9, pad, u * 0.9, t);

    // Title + creator, bottom-left.
    var baseline = h - pad - u * 3.2;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = font(u * 3.4, 600);
    ctx.fillStyle = INK;
    ctx.fillText(fit(ctx, opts.title || 'Cudic', w - pad * 2 - u * 4), pad, baseline);
    ctx.font = font(u * 2, 400);
    ctx.fillStyle = 'rgba(247,245,236,0.62)';
    var by = opts.by ? 'by ' + opts.by : 'cudic.vercel.app';
    ctx.fillText(fit(ctx, by, w - pad * 2), pad, baseline + u * 3);

    // Score chip, top-left, only when the game reported one this session.
    if (opts.score != null && opts.score !== '') {
      var label = 'SCORE ' + String(opts.score);
      ctx.font = monoFont(u * 2);
      var cw = ctx.measureText(label).width + u * 3;
      ctx.fillStyle = 'rgba(13,14,16,0.72)';
      ctx.fillRect(pad, pad + u * 3.2, cw, u * 4);
      ctx.fillStyle = LIME;
      ctx.fillRect(pad, pad + u * 3.2, u * 0.6, u * 4);
      ctx.fillText(label, pad + u * 1.6, pad + u * 6.1);
    }

    // Site mark, top-right — the thing that makes the clip an ad.
    ctx.textAlign = 'right';
    ctx.font = monoFont(u * 2);
    ctx.fillStyle = 'rgba(247,245,236,0.85)';
    ctx.fillText('cudic.vercel.app', w - pad, pad + u * 5.6);
    ctx.textAlign = 'left';

    // Recording progress along the bottom edge.
    var pct = Math.min(1, elapsed / dur);
    ctx.fillStyle = 'rgba(247,245,236,0.18)';
    ctx.fillRect(0, h - u, w, u);
    ctx.fillStyle = LIME;
    ctx.fillRect(0, h - u, Math.round(w * pct), u);

    // REC dot, blinking once a second like a camera tally light.
    if (elapsed < dur - 0.35) {
      var blink = Math.floor(elapsed * 2) % 2 === 0;
      if (blink) {
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath();
        ctx.arc(w - pad - u * 1.2, pad + u * 9.4, u * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function start(opts) {
    if (active) return;
    opts = opts || {};
    if (!supported()) return fail('unsupported');
    var src = mainCanvas();
    if (!src) return fail('no-canvas');
    var sw = src.width | 0, sh = src.height | 0;
    if (!sw || !sh) return fail('no-canvas');

    var scale = Math.min(1, LONG_EDGE / Math.max(sw, sh));
    var w = Math.max(2, Math.round(sw * scale));
    var h = Math.max(2, Math.round(sh * scale));
    w -= w % 2; h -= h % 2; // encoders want even dimensions

    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!ctx) return fail('unsupported');

    var mime = pickMime();
    var stream, rec;
    try {
      stream = canvas.captureStream(30);
      rec = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 })
                 : new MediaRecorder(stream);
    } catch (e) { return fail('unsupported'); }

    var dur = Math.min(Math.max(Number(opts.seconds) || 8, 3), 15);
    var chunks = [];
    var raf = 0, stopped = false;
    active = true;

    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      active = false;
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      if (!chunks.length) return fail('empty');
      var type = (rec.mimeType || mime || 'video/webm').split(';')[0];
      var blob = new Blob(chunks, { type: type });
      var m = /mp4/.test(type) ? 'mp4' : 'webm';
      post({ type: 'cudic-clip-done', blob: blob, mime: type, ext: m });
    };
    rec.onerror = function () { fail('record-failed'); };

    var t0 = performance.now();
    function loop(now) {
      if (stopped) return;
      var elapsed = (now - t0) / 1000;
      drawFrame(ctx, src, w, h, opts, elapsed, dur);
      if (elapsed >= dur) {
        stopped = true;
        try { rec.stop(); } catch (e) { fail('record-failed'); }
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    // One frame before recording so the first encoded frame isn't black.
    drawFrame(ctx, src, w, h, opts, 0, dur);
    try {
      rec.start(250);
      raf = requestAnimationFrame(loop);
    } catch (e) { stopped = true; cancelAnimationFrame(raf); return fail('record-failed'); }
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type !== 'cudic-clip-start') return;
    if (e.source !== parent) return; // only the page hosting the player
    start(d);
  });

  window.CudicClip = { version: V, start: start, supported: supported, mainCanvas: mainCanvas };
  post({ type: 'cudic-clip-ready', can: supported() });
})();
