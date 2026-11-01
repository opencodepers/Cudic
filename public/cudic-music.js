/* CudicMusic — one call to give a published game its soundtrack.
 *   <script src="/cudic-music.js?v=1"></script>
 *   CudicMusic.play('<trackId>');   // loops the track, starts with the next user gesture if needed
 *   CudicMusic.stop();
 *   CudicMusic.volume(0.4);         // optional, 0..1 (default = the track's saved master)
 *
 * Track ids come from the Music tab in Studio (it writes music.json into the
 * project when you pick one). Fetches the PUBLIC /api/music/:id/public
 * endpoint — the game frame holds no token, same rule as saves/scores.
 * The synth is a compact port of the Music Lab voices so a track sounds
 * the same everywhere.
 */
(function () {
  if (window.CudicMusic) return;
  var mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
  var VOICES = {
    piano: { gain: 0.30, a: 0.005, r: 0.35, sustain: true, lp: 5200, partials: [[1, 'triangle', 1], [2, 'sine', 0.4], [3, 'sine', 0.16], [4.02, 'sine', 0.07]] },
    pad: { gain: 0.24, a: 0.16, r: 0.6, sustain: true, lp: 1500, partials: [[1, 'sawtooth', 0.5], [1.007, 'sawtooth', 0.5], [2, 'sine', 0.2]] },
    bass: { gain: 0.42, a: 0.008, r: 0.22, sustain: true, lp: 900, partials: [[1, 'triangle', 1], [2, 'sine', 0.3]] },
    pluck: { gain: 0.34, a: 0.003, r: 0.42, sustain: false, lp: 3400, partials: [[1, 'triangle', 1], [2, 'sine', 0.25]] },
    bell: { gain: 0.26, a: 0.004, r: 0.9, sustain: false, lp: 6000, partials: [[1, 'sine', 1], [2.76, 'sine', 0.4], [5.4, 'sine', 0.15]] },
    lead: { gain: 0.26, a: 0.03, r: 0.3, sustain: true, lp: 2600, partials: [[1, 'sawtooth', 0.7], [2, 'square', 0.2]] }
  };
  var ROWS = ['kick', 'snare', 'hat', 'clap', 'tom', 'n60', 'n64', 'n67', 'n72'];
  var MIDI = { n60: 60, n64: 64, n67: 67, n72: 72 };
  var STEPS = 16;

  var bus = null, ac = null, track = null, timer = 0, on = false, step = 0, next = 0;
  var pendId = null, pendVol = null, vol = null, noiseData = null;

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return ac.state === 'running'; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    bus = ac.createGain(); bus.gain.value = vol == null ? 0.8 : vol;
    bus.connect(ac.destination);
    return ac.state === 'running';
  }
  if (typeof document !== 'undefined') {
    var gesture = function () {
      document.removeEventListener('pointerdown', gesture);
      document.removeEventListener('keydown', gesture);
      if (!ensure()) { stop(); return; }
      if (pendId) { var id = pendId; pendId = null; play(id); }
    };
    document.addEventListener('pointerdown', gesture);
    document.addEventListener('keydown', gesture);
  }

  function noise() {
    if (noiseData) return noiseData;
    var b = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseData = b;
    return b;
  }
  function burst(t, type, freq, q, dur, gain) {
    var s = ac.createBufferSource(); s.buffer = noise(); s.loop = true;
    var f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    var g = ac.createGain(); g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t); s.stop(t + dur + 0.02);
  }
  function blip(t, f0, f1, dur, type, gain) {
    var o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.9);
    var g = ac.createGain(); g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }
  var DRUMS = {
    kick: function (t) { blip(t, 150, 45, 0.36, 'sine', 1); },
    snare: function (t) { burst(t, 'bandpass', 1800, 0.8, 0.18, 0.55); blip(t, 220, 140, 0.1, 'triangle', 0.3); },
    hat: function (t) { burst(t, 'highpass', 7000, 1, 0.05, 0.35); },
    clap: function (t) { burst(t, 'bandpass', 1400, 1.2, 0.1, 0.4); burst(t + 0.012, 'bandpass', 1400, 1.2, 0.1, 0.4); burst(t + 0.024, 'bandpass', 1400, 1.2, 0.1, 0.4); },
    tom: function (t) { blip(t, 260, 110, 0.3, 'sine', 0.7); }
  };
  function note(t, midi, cfg) {
    var peak = Math.max(0.002, cfg.gain);
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + cfg.a);
    var stopT = t + 0.42;
    if (cfg.sustain) g.gain.setValueAtTime(peak, stopT);
    g.gain.exponentialRampToValueAtTime(0.0001, stopT + cfg.r);
    var out = g;
    if (cfg.lp) { var bq = ac.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = cfg.lp; g.connect(bq); out = bq; }
    out.connect(bus);
    for (var i = 0; i < cfg.partials.length; i++) {
      var p = cfg.partials[i];
      var o = ac.createOscillator(); o.type = p[1];
      o.frequency.setValueAtTime(mtof(midi) * p[0], t);
      var pg = ac.createGain(); pg.gain.value = p[2];
      o.connect(pg); pg.connect(g);
      o.start(t); o.stop(stopT + cfg.r + 0.08);
    }
  }
  function fire(t, row) {
    if (MIDI[row] != null) note(t, MIDI[row], VOICES[track.v] || VOICES.piano);
    else if (DRUMS[row]) DRUMS[row](t);
  }
  function tick() {
    if (!on || !track || !ac) return;
    var dur = 60 / track.bpm / 4, horizon = ac.currentTime + 0.1;
    while (next < horizon) {
      var t = next + (step % 2 === 1 ? (track.swing || 0) * dur : 0);
      for (var i = 0; i < ROWS.length; i++) {
        var r = ROWS[i], arr = track.pattern && track.pattern[r];
        if (arr && arr[step]) fire(t, r);
      }
      next += dur;
      step = (step + 1) % STEPS;
    }
  }
  function halt() {
    on = false;
    if (timer) { clearInterval(timer); timer = 0; }
    if (track) track = null;
  }
  function play(id) {
    if (typeof id !== 'string' || !id) return Promise.reject(new Error('CudicMusic.play: track id expected'));
    pendId = id;
    return fetch('/api/music/' + encodeURIComponent(id) + '/public')
      .then(function (r) { if (!r.ok) throw new Error('track not found'); return r.json(); })
      .then(function (d) {
        var t = d && d.track; if (!t || !t.data || !t.data.pattern) throw new Error('bad track data');
        halt(); track = t.data; vol = pendVol != null ? pendVol : (t.data.master != null ? t.data.master : 0.8);
        track.v = t.data.v; track.bpm = t.data.bpm || 110; track.swing = t.data.swing || 0;
        if (!ensure()) return 'pending'; // starts on the first user gesture
        on = true; step = 0; next = ac.currentTime + 0.08;
        if (!timer) timer = setInterval(tick, 25);
        pendId = null;
        return 'playing';
      });
  }
  function stop() { halt(); pendId = null; }
  function volume(v) { var n = Math.min(1, Math.max(0, Number(v))); if (isNaN(n)) return; pendVol = n; if (bus) { vol = n; bus.gain.value = n; } }
  window.CudicMusic = { play: play, stop: stop, volume: volume, version: 1 };
})();
