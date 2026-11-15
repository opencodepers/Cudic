/* file: public/servers-motion.js
 * what: Motion for the Servers page. The hero splits into letters, reveals on
 *   a stagger, tilts with the pointer and runs a small canvas particle field.
 *   Motion (motion.dev) still handles server cards and modals.
 * invariants: classic script with a dynamic import, so node --check and older
 *   browsers are happy; everything is skipped under prefers-reduced-motion; the
 *   page works unchanged if the CDN is unreachable; skeletons are left alone so
 *   the first paint does not double-animate.
 */
(function () {
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce) {
    window.CudicMotion = window.CudicMotion || { reduce: true };
    return;
  }

  initHero();

  import('https://cdn.jsdelivr.net/npm/motion@12/+esm').then(function (motion) {
    var animate = motion.animate;
    var stagger = motion.stagger;
    if (typeof animate !== 'function') return;

    window.CudicMotion = window.CudicMotion || { animate: animate, stagger: stagger, reduce: false };
    var ease = [0.22, 1, 0.36, 1];

    function cardsIn(cards) {
      if (!cards.length) return;
      try {
        animate(cards, { opacity: [0, 1], y: [12, 0], scale: [0.98, 1] }, {
          duration: 0.34,
          delay: stagger(0.03, { start: 0.02 }),
          easing: ease
        });
      } catch (e) {}
    }

    function realCards(root) {
      var out = [];
      var all = root.querySelectorAll('.server-card');
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute('aria-hidden') !== 'true') out.push(all[i]);
      }
      return out;
    }

    function watchGrid(id) {
      var grid = document.getElementById(id);
      if (!grid) return;
      cardsIn(realCards(grid));
      try {
        new MutationObserver(function (mutations) {
          var batch = [];
          for (var m = 0; m < mutations.length; m++) {
            var added = mutations[m].addedNodes;
            for (var n = 0; n < added.length; n++) {
              var el = added[n];
              if (el && el.nodeType === 1 && el.classList && el.classList.contains('server-card') &&
                  el.getAttribute('aria-hidden') !== 'true') {
                batch.push(el);
              }
            }
          }
          cardsIn(batch);
        }).observe(grid, { childList: true });
      } catch (e) {}
    }

    watchGrid('ownGrid');
    watchGrid('publicGrid');

    function modalIn(overlay) {
      var box = overlay.querySelector('.modal');
      if (!box) return;
      try {
        animate(overlay, { opacity: [0, 1] }, { duration: 0.16, easing: 'ease-out' });
        animate(box, { opacity: [0, 1], scale: [0.97, 1], y: [8, 0] }, {
          duration: 0.22,
          easing: ease
        });
      } catch (e) {}
    }

    var overlays = document.querySelectorAll('.modal-overlay');
    for (var i = 0; i < overlays.length; i++) {
      (function (overlay) {
        try {
          new MutationObserver(function () {
            if (overlay.classList.contains('open')) modalIn(overlay);
          }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
        } catch (e) {}
      })(overlays[i]);
    }
  }).catch(function () {});

  function initHero() {
    var hero = document.getElementById('srvHero');
    if (!hero) return;
    var title = hero.querySelector('.hero-title');
    var sub = hero.querySelector('.hero-sub');
    var rule = hero.querySelector('.hero-rule');
    var inner = hero.querySelector('.hero-inner');
    var actions = hero.querySelector('.hero-actions');
    var stats = hero.querySelector('.hero-stats');
    var canvas = hero.querySelector('.hero-fx');
    var ease = 'cubic-bezier(.16,1,.3,1)';
    var letters = [];

    if (title) {
      var text = (title.getAttribute('aria-label') || title.textContent || '').trim();
      title.setAttribute('aria-label', text);
      title.textContent = '';
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var span = document.createElement('span');
        span.className = 'hero-letter' + (ch === ' ' ? ' is-space' : '');
        span.setAttribute('aria-hidden', 'true');
        span.textContent = ch === ' ' ? '\u00a0' : ch;
        title.appendChild(span);
        if (ch !== ' ') letters.push(span);
      }
    }

    try {
      hero.animate([
        { opacity: 0, transform: 'translateY(16px) scale(0.992)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' }
      ], { duration: 650, easing: ease, fill: 'both' });

      for (var l = 0; l < letters.length; l++) {
        (function (el, index) {
          el.animate([
            { opacity: 0, transform: 'translateY(30px) rotateX(-78deg) scaleY(0.8)', filter: 'blur(8px)' },
            { opacity: 1, transform: 'translateY(0) rotateX(0deg) scaleY(1)', filter: 'blur(0)' }
          ], { duration: 720, delay: 150 + index * 38, easing: ease, fill: 'both' });

          el.addEventListener('pointerenter', function () {
            try {
              el.animate([
                { transform: 'translateY(0) scale(1)' },
                { transform: 'translateY(-7px) scale(1.06)' },
                { transform: 'translateY(0) scale(1)' }
              ], { duration: 460, easing: 'cubic-bezier(.34,1.56,.64,1)' });
            } catch (e) {}
          });
        })(letters[l], l);
      }

      if (sub) {
        sub.animate([
          { opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }
        ], { duration: 620, delay: 520, easing: ease, fill: 'both' });
      }

      if (actions) {
        actions.animate([
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 520, delay: 620, easing: ease, fill: 'both' });
      }

      if (stats) {
        stats.animate([
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 560, delay: 700, easing: ease, fill: 'both' });
      }

      if (rule) {
        rule.animate([
          { transform: 'scaleX(0)' },
          { transform: 'scaleX(1)' }
        ], { duration: 900, delay: 560, easing: ease, fill: 'both' });
      }
    } catch (e) {}

    if (inner) {
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        var px = (e.clientX - r.left) / Math.max(r.width, 1) - 0.5;
        var py = (e.clientY - r.top) / Math.max(r.height, 1) - 0.5;
        inner.style.transform = 'rotateX(' + (-py * 3.2).toFixed(2) + 'deg) rotateY(' + (px * 4.2).toFixed(2) + 'deg)';
      });
      hero.addEventListener('pointerleave', function () {
        inner.style.transform = '';
      });
    }

    if (canvas) startParticles(hero, canvas);
  }

  function startParticles(hero, canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var colors = ['#FF9B3D', '#48C9A9', '#6CB6FF', '#B69CFF', '#FF8FB8'];
    var w = 0;
    var h = 0;
    var parts = [];
    var pointer = { x: -999, y: -999, on: false };

    function make() {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 1.1 + Math.random() * 1.8,
        color: colors[Math.floor(Math.random() * colors.length)],
        phase: Math.random() * Math.PI * 2,
        speed: 0.008 + Math.random() * 0.014
      };
    }

    function size() {
      var r = hero.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var want = Math.max(14, Math.min(34, Math.round(w / 42)));
      while (parts.length < want) parts.push(make());
      if (parts.length > want) parts.length = want;
    }

    size();
    if (window.ResizeObserver) {
      try { new ResizeObserver(size).observe(hero); } catch (e) {}
    } else {
      window.addEventListener('resize', size);
    }

    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = true;
    });
    hero.addEventListener('pointerleave', function () {
      pointer.on = false;
    });

    function frame() {
      ctx.clearRect(0, 0, w, h);
      var i, j, p, q, dx, dy, dist;

      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        p.phase += p.speed;
        p.x += p.vx + Math.cos(p.phase) * 0.06;
        p.y += p.vy + Math.sin(p.phase * 0.8) * 0.06;

        if (pointer.on) {
          dx = p.x - pointer.x;
          dy = p.y - pointer.y;
          dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110 && dist > 0.1) {
            var push = (1 - dist / 110) * 0.9;
            p.x += (dx / dist) * push;
            p.y += (dy / dist) * push;
          }
        }

        if (p.x < -12) p.x = w + 12;
        if (p.x > w + 12) p.x = -12;
        if (p.y < -12) p.y = h + 12;
        if (p.y > h + 12) p.y = -12;
      }

      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        for (j = i + 1; j < parts.length; j++) {
          q = parts[j];
          dx = p.x - q.x;
          dy = p.y - q.y;
          dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 118) {
            ctx.globalAlpha = (1 - dist / 118) * 0.2;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }

        ctx.globalAlpha = 0.72;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
})();
