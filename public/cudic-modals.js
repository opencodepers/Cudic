// ── Cudic site-wide modals (cudic-modals.js) ────────────────────────
// Included on every content page. Two overlays, both brand-styled
// (hairlines, square corners, existing theme vars with fallbacks):
//
//  1. External-link gate — clicking a link to another site opens a
//     "you're leaving Cudic" check before it goes. Per-host remember
//     for the browser session; ctrl/middle-click bypasses it.
//  2. Media lightbox — clicking a link (or a standalone picture)
//     whose target is an image or video file shows that file in an
//     overlay instead of navigating away.
//
// One delegated listener; nothing else on the page changes. Made for
// kid users: no third-party embeds (YouTube etc. still go through the
// gate), Escape and outside-click both close, focus returns on close.
(function () {
  'use strict';
  if (window.__cudicModals) return;
  window.__cudicModals = true;

  var MIXED_RE = /\.(png|jpe?g|gif|webp|avif|apng|svg|bmp|ico)(\?|#|$)/i;
  var VIDEO_RE = /\.(mp4|webm|ogv|m4v|mov)(\?|#|$)/i;
  var OK_HOSTS = 'cudic_ext_ok_hosts';
  var modal = null, lastFocus = null;

  var CSS = [
    '#cg-ov{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(8,9,11,.74)}',
    '#cg-ov.open{display:flex;animation:cg-in .24s steps(5)}',
    '#cg-ov.cg-closing{display:flex;animation:cg-out .16s steps(4) forwards}',
    '#cg-card{position:relative;background:var(--panel,#14161b);border:1px solid var(--line,#262a33);color:var(--ink,#f7f5ec);max-width:min(560px,94vw);max-height:88vh;overflow:auto;font:500 15px/1.5 "Geist",system-ui,sans-serif;animation:cg-pop .3s steps(7);scrollbar-width:none}',
    '#cg-card::-webkit-scrollbar{display:none}',
    '#cg-card.cg-m{max-height:none;overflow:visible;background:#0d0e10}',
    '#cg-card.cg-m #cg-head,#cg-card.cg-m #cg-swoosh{display:none}',
    '#cg-card.cg-m #cg-body{padding:12px 20px 16px}',
    '#cg-card.cg-m #cg-media img,#cg-card.cg-m #cg-media video{max-width:min(92vw,1080px);max-height:80vh;border-bottom:1px solid var(--line,#262a33)}',
    '#cg-card *{box-sizing:border-box}',
    '#cg-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 20px;border-bottom:1px solid var(--line,#262a33)}',
    '#cg-kick{font:500 11px "Geist Mono",ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--mute,#9a9a94)}',
    '#cg-x{flex:none;width:34px;height:34px;border:1px solid var(--line,#262a33);background:transparent;color:var(--ink,#f7f5ec);font:500 18px/1 system-ui,sans-serif;cursor:pointer;padding:0;transition:color .12s steps(2),border-color .12s steps(2),transform .12s steps(2)}',
    '#cg-x:hover{border-color:var(--lime,#b8f23a);color:var(--lime,#b8f23a);transform:translateY(-2px)}',
    '#cg-x:focus-visible{outline:2px solid var(--lime,#b8f23a);outline-offset:2px}',
    '#cg-swoosh{position:relative;height:4px;background:var(--line,#262a33);overflow:hidden}',
    '#cg-swoosh i{position:absolute;left:0;top:0;height:100%;width:0;background:var(--lime,#b8f23a);animation:cg-swoosh .5s steps(7) forwards}',
    '@keyframes cg-swoosh{to{width:100%}}',
    '#cg-card.cg-open-ring::before{content:"";position:absolute;inset:-12px;border:3px solid var(--lime,#b8f23a);pointer-events:none;animation:cg-ring .8s steps(5) forwards}',
    '@keyframes cg-ring{from{transform:scale(.92);opacity:1}to{transform:scale(1.05);opacity:0}}',
    '#cg-kick .cg-cur{display:inline-block;width:8px;height:13px;background:var(--lime,#b8f23a);margin-left:7px;vertical-align:-1px;animation:cg-blink 1s steps(2) infinite}',
    '@keyframes cg-blink{50%{opacity:0}}',
    '#cg-body{padding:20px}',
    '#cg-body>*{animation:cg-rise .4s steps(5) both}',
    '#cg-body>*:nth-child(2){animation-delay:60ms}',
    '#cg-body>*:nth-child(3){animation-delay:120ms}',
    '#cg-body>*:nth-child(n+4){animation-delay:180ms}',
    '#cg-title{margin:0 0 8px;font-weight:600;font-size:22px;letter-spacing:-.02em;animation:cg-rise .4s steps(5) both 40ms}',
    '#cg-text{margin:0 0 14px;color:var(--mute,#9a9a94);font-size:14px;word-break:break-word}',
    '#cg-text b{color:var(--ink,#f7f5ec);font-weight:600}',
    '#cg-media{display:none;max-width:min(86vw,900px)}',
    '#cg-media img,#cg-media video{display:block;max-width:88vw;max-height:80vh;background:#0d0e10}',
    '#cg-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px}',
    '.cg-btn{font:500 12px "Geist Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;padding:12px 16px;cursor:pointer;text-decoration:none;border:1px solid var(--ink,#f7f5ec);background:var(--lime,#b8f23a);color:#0d0e10;border-color:var(--lime,#b8f23a);transition:background .12s steps(2),color .12s steps(2),border-color .12s steps(2)}',
    '.cg-btn:hover{background:var(--ink,#f7f5ec);color:var(--bg,#0d0e10);border-color:var(--ink,#f7f5ec)}',
    '.cg-btn:focus-visible{outline:2px solid var(--lime,#b8f23a);outline-offset:3px}',
    '.cg-btn.cg-arrow{display:inline-flex;align-items:center;gap:14px}',
    '.cg-btn.cg-arrow:after{content:"→";transition:transform .12s steps(2)}',
    '.cg-btn.cg-arrow:hover:after{transform:translateX(4px)}',
    '.cg-ghost{background:transparent;color:var(--ink,#f7f5ec)}',
    '.cg-ghost:hover{background:var(--ink,#f7f5ec);color:var(--bg,#0d0e10)}',
    '.cg-ghost:hover.cg-stay{color:#fff;background:var(--panel,#14161b);border-color:var(--line,#262a33)}',
    '#cg-rem{display:inline-flex;align-items:center;gap:8px;margin-top:14px;font:500 12px "Geist Mono",ui-monospace,monospace;letter-spacing:.04em;color:var(--mute,#9a9a94);cursor:pointer;user-select:none}',
    '#cg-rem b{width:15px;height:15px;border:1px solid var(--line,#262a33);display:inline-block;position:relative;flex:none}',
    '#cg-rem.on b{background:var(--lime,#b8f23a);border-color:var(--lime,#b8f23a)}',
    '#cg-rem.on b:after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #0d0e10;border-width:0 2px 2px 0;transform:rotate(42deg)}',
    '@keyframes cg-in{from{opacity:0}}',
    '@keyframes cg-out{to{opacity:0}}',
    '@keyframes cg-pop{from{transform:translateY(16px);opacity:0}}',
    '@keyframes cg-rise{from{transform:translateY(14px);opacity:0}}',
    '@media(prefers-reduced-motion:reduce){#cg-ov,#cg-card,#cg-body>*,#cg-title,#cg-swoosh i,#cg-card.cg-open-ring::before,.cg-cur{animation:none!important}.cg-swoosh-i-hidden,#cg-swoosh i{width:100%!important}}'
  ].join('\n');

  function ensureModal() {
    if (modal) return modal;
    var style = document.createElement('style');
    style.id = 'cg-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var ov = document.createElement('div');
    ov.id = 'cg-ov';
    ov.innerHTML =
      '<div id="cg-card" role="dialog" aria-modal="true">' +
      '<div id="cg-head"><span id="cg-kick"></span><button id="cg-x" type="button" aria-label="Close">✕</button></div>' +
      '<div id="cg-swoosh"><i></i></div>' +
      '<div id="cg-media"></div>' +
      '<div id="cg-body"></div>' +
      '</div>';
    document.body.appendChild(ov);
    modal = {
      ov: ov,
      kick: ov.querySelector('#cg-kick'),
      body: ov.querySelector('#cg-body'),
      media: ov.querySelector('#cg-media'),
      swoosh: ov.querySelector('#cg-swoosh i'),
      card: ov.querySelector('#cg-card')
    };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#cg-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && modal.ov.classList.contains('open')) close();
    });
    return modal;
  }

  function close() {
    if (!modal || !modal.ov.classList.contains('open')) return;
    modal.ov.classList.remove('open');
    // Brand exit: a 4-step fade out, then the node goes away entirely so a
    // paused video doesn't keep a decoder open behind the page.
    modal.ov.classList.add('cg-closing');
    setTimeout(function () {
      if (!modal) return;
      modal.ov.classList.remove('cg-closing');
      modal.media.innerHTML = '';
    }, 170);
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  function openOverlay(kick, scroll, mediaMode) {
    ensureModal();
    lastFocus = document.activeElement;
    modal.kick.textContent = kick;
    var cur = document.createElement('i');
    cur.className = 'cg-cur';
    modal.kick.appendChild(cur);
    modal.body.innerHTML = scroll;
    modal.card.classList.toggle('cg-m', !!mediaMode);
    modal.media.style.display = 'none';
    modal.media.innerHTML = '';
    // Replay the entrance motions on every open: the lime swoosh bar under
    // the header, the one-shot ring bloom around the card, and the stepped
    // body reveal all key off fresh animation runs.
    modal.ov.classList.remove('cg-closing');
    modal.card.classList.remove('cg-open-ring');
    modal.swoosh.style.animation = 'none';
    void modal.card.offsetWidth;
    modal.swoosh.style.animation = '';
    modal.card.classList.add('cg-open-ring');
    modal.ov.classList.add('open');
    var f = modal.body.querySelector('.cg-btn');
    if (f) { try { f.focus(); } catch (e) {} }
  }

  // ── 1. External link gate ───────────────────────────────────────
  function gate(host, url) {
    var remembered = '';
    try { remembered = sessionStorage.getItem(OK_HOSTS) || ''; } catch (e) {}
    if (remembered.split('\n').indexOf(host) !== -1) { location.href = url.href; return; }
    var externalBtn = '<a class="cg-btn cg-arrow" data-cg-follow href="' + url.href.replace(/"/g, '%22') + '" rel="nofollow noopener">Visit <b style="font-weight:600">' + host.replace(/</g, '&lt;') + '</b></a>';
    openOverlay('Heads-up',
      '<h2 id="cg-title">You\'re leaving Cudic</h2>' +
      '<p id="cg-text">This link goes to <b>' + host.replace(/</g, '&lt;') + '</b> — a place outside this site. Ads, uploads and people there are not checked by the Cudic moderation team, so treat it like talking to strangers: look before you click, never share private info, and follow it <b>at your own risk</b>.</p>' +
      '<div id="cg-row">' + externalBtn + '<button class="cg-btn cg-ghost cg-stay" type="button">Stay on Cudic</button></div>' +
      '<div id="cg-rem" role="checkbox" aria-checked="false" tabindex="0"><b></b>Don\'t warn me about <u>' + host.replace(/</g, '&lt;') + '</u> this session</div>');
    modal.body.querySelector('.cg-stay').addEventListener('click', close);
    var rem = modal.body.querySelector('#cg-rem');
    var chk = false;
    function toggle() { chk = !chk; rem.classList.toggle('on', chk); rem.setAttribute('aria-checked', !!chk); }
    rem.addEventListener('click', toggle);
    rem.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    modal.body.querySelector('.cg-btn').addEventListener('click', function () {
      if (chk) {
        try {
          var list = (sessionStorage.getItem(OK_HOSTS) || '').split('\n').filter(Boolean);
          list.push(host);
          sessionStorage.setItem(OK_HOSTS, list.join('\n'));
        } catch (e) {}
        location.href = url.href;
      }
      // not checked: the default anchor navigation runs (this click was
      // prevented; the button IS an anchor, so it follows the link itself)
    });
  }

  // ── 2. Media lightbox ───────────────────────────────────────────
  function media(url, isVideo) {
    openOverlay(isVideo ? 'Video' : 'Picture', '', true);
    var m = modal;
    m.media.style.display = 'block';
    if (isVideo) {
      m.media.innerHTML = '<video controls playsinline src="' + url.href.replace(/"/g, '%22') + '"></video>';
    } else {
      m.media.innerHTML = '<img alt="Cudic media" src="' + url.href.replace(/"/g, '%22') + '">';
      var img = m.media.querySelector('img');
      if (img) {
        img.onerror = function () {
          m.media.innerHTML = '';
          m.media.style.display = 'none';
          m.body.querySelector('#cg-text').textContent = 'That picture could not be shown — it may have been moved or deleted.';
        };
      }
    }
    m.body.innerHTML =
      '<p id="cg-text" style="margin-bottom:0;word-break:break-all">' + url.pathname.split('/').pop().substring(0, 64) +
      ' <span style="color:var(--mute,#9a9a94)">· in-site content</span></p>' +
      '<div id="cg-row"><a class="cg-btn cg-ghost" data-cg-follow target="_blank" rel="noopener" href="' + url.href.replace(/"/g, '%22') + '">Open in new tab</a>' +
      '<button class="cg-btn" type="button">Done</button></div>';
    m.body.querySelector('.cg-btn:last-child').addEventListener('click', close);
    var v = m.media.querySelector('video');
    if (v) try { v.play(); } catch (e) {}
  }

  // ── Shared click plumbing ───────────────────────────────────────
  function shouldIgnore(e) {
    if (e.button !== 0 || e.defaultPrevented) return true;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return true; // new tab, etc.
    return false;
  }

  document.addEventListener('click', function (e) {
    if (shouldIgnore(e)) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (a) {
      // Anchors rendered by our own modals (gate confirm, media new-tab)
      // have already passed the check once — let them follow directly.
      if (a.hasAttribute('data-cg-follow')) return;
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return;
      var url;
      try { url = new URL(href, location.href); } catch (err) { return; }
      var file = url.pathname.match(/\.([a-z0-9]+)$/i);
      var isImg = file && MIXED_RE.test(url.pathname);
      var isVid = file && VIDEO_RE.test(url.pathname);
      if (url.origin !== location.origin) {
        // Foreign origin: always gate, media files included (unknown sites).
        e.preventDefault();
        gate(url.hostname, url);
        return;
      }
      if ((isImg || isVid) && !a.hasAttribute('download')) {
        e.preventDefault();
        media(url, isVid);
      }
      return;
    }
    // Standalone pictures (not inside a link): zoom them.
    var img = e.target.tagName === 'IMG' ? e.target : null;
    if (!img) {
      // Inline <video> elements: clicking opens the modal player instead of
      // their native surface play/pause, so every click lands in one
      // consistent place. Videos already inside our modal are skipped, as
      // are videos wrapped in an anchor (the link branch handles that).
      var v = e.target.tagName === 'VIDEO' ? e.target : null;
      if (!v || v.closest('#cg-ov') || v.closest('a[href]')) return;
      var vsrc = v.currentSrc || v.src || (v.querySelector && v.querySelector('source') ? v.querySelector('source').src : '') || '';
      if (!vsrc) return;
      var vu;
      try { vu = new URL(vsrc, location.href); } catch (err) { return; }
      if (vu.origin !== location.origin) return; // foreign video: never surprise-load
      e.preventDefault();
      e.stopPropagation();
      try { v.pause(); } catch (err2) {}
      media(vu, true);
      return;
    }
    if (img.closest && img.closest('a[href]')) return; // link handles it
    var src = img.currentSrc || img.src || '';
    var iu;
    try { iu = new URL(src, location.href); } catch (err) { return; }
    if (iu.origin !== location.origin) return; // never fetch foreign media in-page
    if (!MIXED_RE.test(iu.pathname)) return;
    if ((img.naturalWidth || 0) < 220 && (img.width || 0) < 220) return; // icons, not content
    e.preventDefault();
    media(iu, false);
  }, true);
  // capture: so page handlers that stopPropagation elsewhere can't skip the
  // gate. shouldIgnore still lets every replaced/pointer-modified click go.
})();
