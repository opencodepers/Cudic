// file: public/sidebar.js
// what: The shared 60px icon rail on every classic page — brand (inline SVG so
//   each path can stagger), nav rows, per-lobby links, the account row, and the
//   theme-pack boot at the end of the file.
// invariants: bump sidebar.js?v= on every page that includes it after editing;
//   labels never expand (hover shows #railTip) and the rail brand keeps no white
//   chip — the user wants raw art there.
// see: AGENTS.md 9, 12.10

// ── Glox Sidebar Component ──────────────────────────────
(function(){
  if(window._gloxSidebar) return; window._gloxSidebar=true;
  if(document.querySelector('nav.sidebar'))return;

  var page=document.body.getAttribute('data-page')||'home';
  // Opt-out: <body data-no-rail> pages (docs, privacy) skip the rail chrome
  // but keep prefs, theme packs and the component loader below.
  var noRail=document.body.hasAttribute('data-no-rail');

  // Single source of truth for the auth token. Asks the Supabase client
  // first (it owns session storage), falls back to the legacy key.
  async function getAuthToken(){
    try{
      if(typeof getSupabase==='function'){
        var db=await getSupabase();
        if(db){var r=await db.auth.getSession();if(r.data&&r.data.session&&r.data.session.access_token)return r.data.session.access_token;}
      }
    }catch(e){}
    try{
      var raw=localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      var s=raw?JSON.parse(raw):null;
      if(s&&s.access_token)return s.access_token;
    }catch(e){}
    return null;
  }
  window.getAuthToken=getAuthToken;

  // Backend base — same rule as config.js, but pages without config.js
  // (index, privacy, terms) still resolve to the Render API.
  function apiHost(){
    if(typeof WS_URL!=='undefined'&&WS_URL)return WS_URL.replace(/^wss?:\/\//,'https://');
    return (location.hostname==='localhost'||location.hostname==='127.0.0.1')?'':'https://glox-o7rr.onrender.com';
  }

  // Apply saved prefs (personalization + performance) on every page.
  // Re-applied on bfcache restore (back/forward nav) and on cross-tab
  // storage changes — otherwise a page frozen before an accent change
  // keeps showing the old colour after you leave profile.
  function applyAccentPref(){
    var acc=localStorage.getItem('glox_accent');
    if(!acc||!/^#[0-9a-fA-F]{6}$/.test(acc))return;
    var c=[parseInt(acc.slice(1,3),16),parseInt(acc.slice(3,5),16),parseInt(acc.slice(5,7),16)];
    var hovers={'#7300FF':'#5D00E9','#FF8C1A':'#E67A00','#2E9EDB':'#1F7FB8','#14A468':'#0E7A4E'};
    var hover=hovers[acc];
    if(!hover){
      var d=c.map(function(v){return Math.max(0,v-22)});
      hover='#'+d.map(function(v){var s=v.toString(16);return s.length<2?'0'+s:s}).join('');
    }
    document.documentElement.style.setProperty('--signal',acc);
    document.documentElement.style.setProperty('--signal-hover',hover);
    document.documentElement.style.setProperty('--signal-tint','rgba('+c[0]+','+c[1]+','+c[2]+',0.12)');
    var _lum=0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
    document.documentElement.style.setProperty('--on-signal',_lum>=150?'#141414':'#fff');
  }
  try{
    applyAccentPref();
    window.addEventListener('pageshow',function(e){if(e.persisted){try{applyAccentPref();}catch(x){}}});
    window.addEventListener('storage',function(e){
      if(e.key==='glox_accent'){try{applyAccentPref();}catch(x){}}
      if(e.key==='glox_theme'){try{
        var darkT = e.newValue !== 'light';
        if(e.newValue==='light')delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme='dark';
        var sunE=document.getElementById('themeSun'),moonE=document.getElementById('themeMoon'),btnE=document.getElementById('themeBtn');
        if(sunE)sunE.style.display=darkT?'':'none';
        if(moonE)moonE.style.display=darkT?'none':'';
        if(btnE)btnE.title=darkT?'Switch to light mode':'Switch to dark mode';
      }catch(x){}}
    });
    if(localStorage.getItem('glox_reduce_motion')==='1'){
      document.documentElement.classList.add('reduce-motion');
      var _st=document.createElement('style');
      _st.textContent='html.reduce-motion *,html.reduce-motion *::before,html.reduce-motion *::after{animation-duration:.001s!important;transition-duration:.001s!important}';
      document.head.appendChild(_st);
    }
  }catch(e){}

  var icons={
    home:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-house" aria-hidden="true" focusable="false"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /> <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>',
    chat:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-message-circle" aria-hidden="true" focusable="false"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /></svg>',
    forum:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-messages-square" aria-hidden="true" focusable="false"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /> <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" /></svg>',
    games:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-gamepad-2" aria-hidden="true" focusable="false"><line x1="6" x2="10" y1="11" y2="11" /> <line x1="8" x2="8" y1="9" y2="13" /> <line x1="15" x2="15.01" y1="12" y2="12" /> <line x1="18" x2="18.01" y1="10" y2="10" /> <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" /></svg>',
    projects:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid" aria-hidden="true" focusable="false"><rect width="7" height="7" x="3" y="3" rx="1" /> <rect width="7" height="7" x="14" y="3" rx="1" /> <rect width="7" height="7" x="14" y="14" rx="1" /> <rect width="7" height="7" x="3" y="14" rx="1" /></svg>',
    editor:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-code-xml" aria-hidden="true" focusable="false"><path d="m18 16 4-4-4-4" /> <path d="m6 8-4 4 4 4" /> <path d="m14.5 4-5 16" /></svg>',
    cube:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-box" aria-hidden="true" focusable="false"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /> <path d="m3.3 7 8.7 5 8.7-5" /> <path d="M12 22V12" /></svg>',
    news:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-newspaper" aria-hidden="true" focusable="false"><path d="M15 18h-5" /> <path d="M18 14h-8" /> <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" /> <rect width="8" height="4" x="10" y="6" rx="1" /></svg>',
    users:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users" aria-hidden="true" focusable="false"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" /></svg>',
    inbox:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-inbox" aria-hidden="true" focusable="false"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /> <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>',
    search:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search" aria-hidden="true" focusable="false"><path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" /></svg>',
    bell:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bell" aria-hidden="true" focusable="false"><path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></svg>',
    server:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-server" aria-hidden="true" focusable="false"><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /> <rect width="20" height="8" x="2" y="14" rx="2" ry="2" /> <line x1="6" x2="6.01" y1="6" y2="6" /> <line x1="6" x2="6.01" y1="18" y2="18" /></svg>',
    coin:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins" aria-hidden="true" focusable="false"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48" /> <path d="M15 6h1v4" /> <path d="m6.134 14.768.866-.5 2 3.464" /> <circle cx="16" cy="8" r="6" /></svg>',
    palette:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-palette" aria-hidden="true" focusable="false"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg>',
    bag:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shopping-bag" aria-hidden="true" focusable="false"><path d="M16 10a4 4 0 0 1-8 0" /> <path d="M3.103 6.034h17.794" /> <path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" /></svg>',
  };

  var qs=window.location.search;
  function sbItem(href,key,icon,label){
    var dest=href+(key!=='home'?qs:'');
    return '<a class="sidebar-item" data-p="'+key+'" href="'+dest+'">'
      +icons[icon]+'<span>'+label+'</span></a>';
  }

  // Servers icon

  // Friends icon (two people)

  // Bell icon (notifications)

  // News / update log icon (megaphone-ish)
  // Themes icon (palette)

  // Quests icon (coin)

  // Discord community (external invite, new tab)
  icons.discord='<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.319 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.1.246.199.373.293a.077.077 0 0 1-.007.128 12.3 12.3 0 0 1-1.872.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.951-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.951 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';

  // GitHub repo (external, new tab)
  icons.github='<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';

  // Theme packs engine (real feature — loads on every page)
  // Theme packs restyle the app pages only. The landing page has its own art
  // and layout, so don't even load the engine there (it also hits /api/profile).
  if (!document.querySelector('.landing')) (function(){var s=document.createElement('script');s.src='/theme-engine.js?v=6';document.head.appendChild(s);})();

  // Account customisation: one CSS file and one runtime on every rail page.
  // The runtime reads prefs from cache immediately, then refreshes from API.
  (function(){
    var l=document.createElement('link');l.rel='stylesheet';l.href='/customize.css?v=2';document.head.appendChild(l);
    var s=document.createElement('script');s.src='/customize-runtime.js?v=1';s.defer=true;document.head.appendChild(s);
  })();

  // Cudic ads (Adsterra banners): themed slot chrome + collapse-on-block.
  // Ad snippets themselves live inline in `.ad-frame` placeholders.
  (function(){
    var l=document.createElement('link');l.rel='stylesheet';l.href='/ads.css?v=1';document.head.appendChild(l);
    var s=document.createElement('script');s.src='/ads.js?v=1';s.defer=true;document.head.appendChild(s);
  })();

  // Google AdSense: account-level library (site verification + future units).
  // The loader alone renders nothing; slot tags arrive after approval.
  (function(){
    if(document.querySelector('script[src*="adsbygoogle.js"]'))return;
    var g=document.createElement('script');
    g.async=true;
    g.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9483499851682563';
    g.setAttribute('crossorigin','anonymous');
    document.head.appendChild(g);
  })();

  // Web Awesome 3.14.0: default theme + lazy component loader (CDN, pinned).
  // Components load on demand only when a <wa-*> tag is present, so this is
  // ~free until used. Dark theme file (+wa-dark class) lands with dark mode.
  (function(){
    var l=document.createElement('link');l.rel='stylesheet';
    l.href='https://ka-f.webawesome.com/webawesome@3.14.0/styles/themes/default.css';
    document.head.appendChild(l);
    var s=document.createElement('script');s.type='module';
    s.src='https://ka-f.webawesome.com/webawesome@3.14.0/webawesome.loader.js';
    document.head.appendChild(s);
  })();

  var nav=document.createElement('nav');
  nav.className='sidebar';
  nav.innerHTML=''
    +'<div class="sidebar-nav-card">'
      +'<a class="rail-brand" id="railBrand" href="/" aria-label="Cudic home"><img src="/cudic_sfsvg.svg" alt="Cudic" width="36" height="36" style="max-width:100%;object-fit:contain;"></a>'
      +'<div class="nav-section-label">Navigate</div>'
      +sbItem('/home','home','home','Home')
      +sbItem('/chat','chat','chat','Chat')
      +sbItem('/inbox','inbox','inbox','Inbox')
      +sbItem('/search','search','search','Search')
      +sbItem('/updlog','updates','news','Updates')
      +sbItem('/friends','friends','users','Friends')
      +sbItem('/notifications','notifs','bell','Notifications')
      +sbItem('/servers','servers','server','Servers')
      +sbItem('/games','games','games','Games')
      +sbItem('/projects','projects','projects','Projects')
      +sbItem('/race','race','coin','Race')
      +sbItem('/forums','forums','forum','Forums')
      +sbItem('/quests','quests','coin','Quests')
      +sbItem('/shop','shop','bag','Shop')
      +sbItem('/themes','themes','palette','Themes')
      +'<a class="sidebar-item" data-p="discord" href="https://discord.gg/rAar6AJ3N" target="_blank" rel="noopener" aria-label="Join our Discord server">'+icons.discord+'<span>Discord</span></a>'
      +'<a class="sidebar-item" data-p="github" href="https://github.com/opencodepers/Cudic" target="_blank" rel="noopener" aria-label="Cudic on GitHub">'+icons.github+'<span>GitHub</span></a>'
      +'<div id="serversSection" style="margin-top:16px">'
        +'<div class="nav-section-label" style="display:flex;align-items:center;justify-content:space-between">Your servers <span id="serverCount" style="font-size:0.7rem;color:var(--text-tertiary)">0/50</span></div>'
        +'<div id="serverList"></div>'
      +'</div>'
      +'<div style="flex:1"></div>'
    +'</div>';

  if(!noRail)document.body.insertBefore(nav,document.body.firstChild);

  // Unread notification badge on the bell (quiet: no badge when signed out).
  (function(){
    try {
      var s = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
      var tok = s ? (function(){ try { var j = JSON.parse(s); return j && j.access_token || s; } catch(e){ return s; } })() : '';
      if (!tok) return;
      fetch(apiHost() + '/api/notifications', { headers: { 'Authorization': 'Bearer ' + tok } })
        .then(function(r){ return r.json(); })
        .then(function(d){
          var n = d.unread || 0;
          if (!n) return;
          var item = nav.querySelector('[data-p="notifs"]');
          if (!item) return;
          var dot = document.createElement('span');
          dot.textContent = n > 9 ? '9+' : n;
          dot.style.cssText = 'position:absolute;top:4px;right:4px;min-width:14px;height:14px;border-radius:8px;background:var(--signal,#b8f23a);color:#0d0e10;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px';
          item.style.position = 'relative';
          item.appendChild(dot);
        })
        .catch(function(){});
    } catch (e) {}
  })();

  // Floating account button: bottom-left of the main panel. Same IDs as
  // before, so the login/logout hover, tooltip, and profile wiring below
  // keep working unchanged.
  var accountHtml='<div class="account-row" id="accountRow" style="position:fixed;cursor:pointer">'
    +'<div class="ava-wrap"><div class="avatar" id="sbAvatar">?</div><span id="sbDot"></span></div>'
    +'<div>'
      +'<div class="account-name" id="sbName">Guest</div>'
      +'<div class="account-status" id="sbStatus">Not signed in</div>'
    +'</div>'
    +'<button class="iconbtn" id="themeBtn" title="Toggle theme"><svg id="themeSun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg><svg id="themeMoon" viewBox="0 0 24 24" style="display:none"><path d="M20 13.2A8 8 0 1 1 10.8 4 6.6 6.6 0 0 0 20 13.2Z" fill="currentColor" stroke="none"/></svg></button>'
    +'<div id="logoutBtn" style="display:none;position:absolute;right:0;bottom:100%;background:var(--panel-raised);border:1px solid var(--line);border-radius:var(--radius-sm);padding:8px 14px;font-size:0.75rem;color:var(--danger);cursor:pointer;white-space:nowrap;z-index:10;box-shadow:0 4px 12px rgba(0,0,0,0.15)" onmouseover="this.style.borderColor=\'var(--danger)\'" onmouseout="this.style.borderColor=\'var(--line)\'">Logout</div>'
  +'</div>';
  if(!noRail)document.body.insertAdjacentHTML('beforeend',accountHtml);

  // Rail tooltip: one floating pill, positioned fixed so rail scrolling
  // never clips it. Shows on hover AND focus (keyboard users get it too).
  // Delegated so server rows added later by loadServers() get tips too.
  var railTip=document.createElement('div');
  railTip.id='railTip';
  if(!noRail)document.body.appendChild(railTip);
  function railLabel(item){
    var s=item.querySelector('span:last-child');
    return s?s.textContent.trim():'';
  }
  function showRailTip(el,text){
    if(!text)return;
    railTip.textContent=text;
    railTip.style.display='block';
    var r=el.getBoundingClientRect();
    railTip.style.top=Math.max(8,r.top+r.height/2-railTip.offsetHeight/2)+'px';
    railTip.style.left=(r.right+10)+'px';
  }
  function hideRailTip(){railTip.style.display='none';}
  var railCard=nav.querySelector('.sidebar-nav-card');
  railCard.addEventListener('mouseover',function(e){
    var item=e.target&&e.target.closest?e.target.closest('.sidebar-item'):null;
    if(item&&railCard.contains(item))showRailTip(item,railLabel(item));
  });
  railCard.addEventListener('mouseout',function(e){
    var to=e.relatedTarget&&e.relatedTarget.closest?e.relatedTarget.closest('.sidebar-item'):null;
    if(!to)hideRailTip();
  });
  railCard.addEventListener('focusin',function(e){
    var item=e.target&&e.target.closest?e.target.closest('.sidebar-item'):null;
    if(item&&railCard.contains(item))showRailTip(item,railLabel(item));
  });
  railCard.addEventListener('focusout',hideRailTip);
  railCard.addEventListener('scroll',hideRailTip);

  // Pixel-swipe page transition (Cudi) — plays a vertical bar of pixels
  // across the screen before navigating to the new page.
  var swipeEl=null;
  function pixelSwipe(cb){
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){ cb(); return; }
    if(!swipeEl){ swipeEl=document.createElement('div'); swipeEl.id='pixelSwipe'; swipeEl.setAttribute('aria-hidden','true'); document.body.appendChild(swipeEl); }
    swipeEl.classList.remove('go'); void swipeEl.offsetWidth; swipeEl.classList.add('go');
    setTimeout(cb, 420);
  }
  railCard.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    var href = a.getAttribute('href') || '';
    if(!href || href.charAt(0) !== '/' || href.charAt(1) === '/' || a.target === '_blank' || href.charAt(0) === '#') return;
    if(swipeEl && swipeEl.classList.contains('go')) return;
    e.preventDefault(); pixelSwipe(function(){ window.location.href = href; });
  });

  // Theme engine hook: let packs mount rail art + icon sets on this nav.
  try{window.dispatchEvent(new Event('cudic:sidebar-ready'));}catch(e){}

  nav.querySelectorAll('.sidebar-item').forEach(function(el){
    if(el.getAttribute('data-p')===page) el.classList.add('active');
  });

  // Theme default is dark; an explicit 'light' choice opts out.
  // (localStorage['glox_theme']: 'dark' | 'light'.)

  // Boot: finish OAuth callback first (GitHub lands on /chat with ?code=
  // or #access_token), then load user + servers so the session is visible
  // immediately. A failed handshake shows a toast instead of silent guest.
  (async function bootSidebar(){
    if(noRail)return; // rail-less pages need no user/servers/seat boot
    var attempted=false;
    try{
      var hasCode=window.location.search.indexOf('code=')!==-1;
      var hasHash=window.location.hash.indexOf('access_token')!==-1;
      if((hasCode||hasHash)&&typeof handleAuthCallback==='function'){attempted=true;await handleAuthCallback();}
    }catch(e){window._authError=(e&&e.message)||'Sign-in failed';}
    try{window.currentToken=window.currentToken||await getAuthToken();}catch(e){}
    // Fresh OAuth return with unfinished setup goes to the welcome wizard,
    // not chat. Explicit false only (missing profile or old rows mean chat).
    try{
      if(attempted&&window.currentToken){
        var _ph=(typeof WS_URL!=='undefined'&&WS_URL)?WS_URL.replace(/^wss?:\/\//,'https://'):'';
        var _pr=await fetch(_ph+'/api/profile',{headers:{'Authorization':'Bearer '+window.currentToken}});
        var _pd=await _pr.json().catch(function(){return {};});
        // Onboarding wizard removed (/welcome thinned); no redirect.
        // if(_pd&&_pd.profile&&_pd.profile.setup_done===false&&!window.location.pathname.startsWith('/welcome')){window.location.href='/welcome';return;}
      }
    }catch(e){}
    // Brand link: games panel when signed in, landing when not.
    try{var rb=document.getElementById('railBrand');if(rb)rb.href=window.currentToken?'/games':'/';}catch(e){}
    try{window.dispatchEvent(new Event('glox:auth'));}catch(e){}
    // Single-seat sessions: fresh OAuth login mints a new seat (takeover);
    // a missing seat mints + claims once; normal loads only heartbeat
    // (never kick another device just by loading). Heartbeat runs in the
    // leader tab.
    try{
      if(typeof bootSeat==='function'&&window.currentToken){
        bootSeat(attempted);
      }
    }catch(e){}
    loadSidebarUser();
    loadServers();
    try{
      if(attempted&&!localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token')){
        var diag=['cfg='+(typeof SUPABASE_URL!=='undefined'?'ok':'MISSING')];
        try{
          if(typeof getSupabase==='function'){
            var db2=await getSupabase();
            diag.push('db='+(!!db2));
            if(db2){var gs=await db2.auth.getSession();diag.push('sess='+!!(gs.data&&gs.data.session));if(gs.error)diag.push('sesserr='+gs.error.message);}
          }else{diag.push('no-authjs');}
        }catch(e3){diag.push('exc='+((e3&&e3.message)||e3));}
        var t=document.createElement('div');
        t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--panel-raised);border:1px solid var(--danger);color:var(--text-primary);border-radius:10px;padding:12px 18px;font-size:0.85rem;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,.25);max-width:90vw;text-align:center';
        t.textContent='GitHub sign-in did not complete ('+diag.join(', ')+(window._authError?'; '+window._authError:'')+'). Please try again.';
        document.body.appendChild(t);
        setTimeout(function(){t.remove()},20000);
      }
    }catch(e2){}
  })();

  // JWT payloads are base64url, not base64: raw atob() throws on the
  // '-'/'_' characters, which silently left signed-in users showing as
  // Guest (GitHub metadata with avatar URLs hits this almost every time).
  // One helper for every avatar fallback. The old code had a local string
  // named `initials` in loadSidebarUser and a call to initials(...) in
  // fetchProfile, where no such function existed — the throw was swallowed
  // and a user without an avatar kept the JWT-derived letters.
  function initialsOf(name){
    var s=String(name||'?').trim().split(/\s+/).map(function(w){return w.charAt(0)||''}).join('');
    return (s||'?').substring(0,2).toUpperCase();
  }
  function jwtPayload(t){
    try{
      var p=String(t||'').split('.');
      if(p.length<3) return null;
      var b=p[1].replace(/-/g,'+').replace(/_/g,'/');
      while(b.length%4) b+='=';
      return JSON.parse(atob(b));
    }catch(e){ return null; }
  }
  function loadSidebarUser(){
    getAuthToken().then(function(access_token){
    try{
      if(!access_token) return;
      var payload=jwtPayload(access_token);
      if(!payload) return;
      var name=payload.user_metadata?.full_name||payload.user_metadata?.name||payload.email||'User';
      var initials=initialsOf(name);
      document.getElementById('sbAvatar').textContent=initials;
      document.getElementById('sbName').textContent=name;
      document.getElementById('sbStatus').textContent='Signed in';
      window.currentToken=access_token;
      window.currentUser={id:payload.sub,email:payload.email,name:name};
      var sbDot=document.getElementById('sbDot');if(sbDot)sbDot.classList.add('on');

      // Fetch profile for user_id
      fetchProfile(access_token);
    }catch(e){}
    });
  }

  async function fetchProfile(token){
    try{
      var res=await fetch(apiHost()+'/api/profile',{headers:{'Authorization':'Bearer '+token}});
      var data=await res.json();
      if(data.profile){
        window.userProfile=data.profile;
        var nameEl=document.getElementById('sbName');
        var statusEl=document.getElementById('sbStatus');
        nameEl.textContent=data.profile.display_name;
        statusEl.textContent='#'+data.profile.user_id;
        var avEl=document.getElementById('sbAvatar');
        if(avEl){
          if(data.profile.avatar_url){avEl.innerHTML='<img src="'+String(data.profile.avatar_url).replace(/"/g,'')+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';}
          else{avEl.textContent=initialsOf(data.profile.display_name);}
        }
      }
    }catch(e){}
  }

  // Load servers (called from bootSidebar above)
  async function loadServers(){
    try{
      var token=window.currentToken||await getAuthToken();
      var headers=token?{'Authorization':'Bearer '+token}:{};
      // My servers
      if(token){
        var res=await fetch(apiHost()+'/api/servers/mine',{headers:headers});
        var data=await res.json();
        var myServers=data.servers||[];
        document.getElementById('serverCount').textContent=myServers.length+'/50';
        var list=document.getElementById('serverList');
        if(myServers.length){
          list.innerHTML=myServers.map(function(s){
            var href='/chat?server='+encodeURIComponent(s.id);
            var active=(window.location.search.indexOf(s.id)!==-1)?' active':'';
            return '<a class="sidebar-item'+active+'" href="'+href+'" style="font-size:0.85rem"><span style="width:20px;height:20px;border-radius:4px;background:var(--signal-tint);color:var(--signal);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0">'+s.name.substring(0,2).toUpperCase()+'</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+s.name+'</span></a>';
          }).join('');
        } else {
          list.innerHTML='<div style="font-size:0.75rem;color:var(--text-tertiary);padding:6px 20px">No servers yet</div>';
        }
      } else {
        document.getElementById('serversSection').style.display='none';
      }
    }catch(e){}
  }

  window._reloadSidebarUser=loadSidebarUser;

  // Show/hide auth button on hover; click account row opens profile
  var accountRow=document.getElementById('accountRow');
  var logoutBtn=document.getElementById('logoutBtn');
  if(accountRow&&logoutBtn){
    accountRow.addEventListener('mouseenter',function(){
      var loggedIn=false;
      try{var raw=localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');if(raw){var s=JSON.parse(raw);loggedIn=!!(s&&s.access_token);}}catch(e){}
      if(loggedIn){
        logoutBtn.textContent='Logout';
        logoutBtn.onclick=function(e){
          e.stopPropagation();
          try{if(typeof getSupabase==='function'){getSupabase().then(function(db){if(db){try{db.auth.signOut();}catch(x){}}}).catch(function(){});}}catch(x){}
          localStorage.removeItem('sb-qgcydphkaujomxyzwcht-auth-token');
          window.location.href='/';
        };
      }else{
        logoutBtn.textContent='Login';
        logoutBtn.onclick=function(e){e.stopPropagation();window.location.href='/login';};
      }
      logoutBtn.style.display='block';
    });
    accountRow.addEventListener('mouseleave',function(){logoutBtn.style.display='none'});
    accountRow.style.cursor='pointer';
    accountRow.addEventListener('click',function(){window.location.href='/profile'});
    function isDarkTheme(){ try { return localStorage.getItem('glox_theme') !== 'light'; } catch (e) { return true; } }
    function paintThemeIcon(){
      var dark = isDarkTheme();
      var sun = document.getElementById('themeSun'), moon = document.getElementById('themeMoon'), btn = document.getElementById('themeBtn');
      if (sun) sun.style.display = dark ? '' : 'none';
      if (moon) moon.style.display = dark ? 'none' : '';
      if (btn) btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    var themeBtn = document.getElementById('themeBtn');
    /* Animated swap (Magic UI pattern) lives in theme-toggle.js; fallback = the instant swap below. */
    if (themeBtn) themeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (window.CudicThemeToggle) { window.CudicThemeToggle(e, themeBtn); return; }
      var dark = isDarkTheme();
      try { localStorage.setItem('glox_theme', dark ? 'light' : 'dark'); } catch (x) {}
      if (dark) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = 'dark';
      paintThemeIcon();
    });
    paintThemeIcon();
    accountRow.addEventListener('mouseenter',function(){
      var n='Account';
      try{if(window.currentUser&&window.currentUser.name)n=window.currentUser.name;}catch(e){}
      showRailTip(accountRow,n);
    });
    accountRow.addEventListener('mouseleave',hideRailTip);
  }
})();

/* Animated theme toggler on every page (Magic UI pattern; fab on rail-less pages). */
(function(){var s=document.createElement('script');s.src='/theme-toggle.js?v=1';document.head.appendChild(s);})();

/* Site-wide command palette (Ctrl/Cmd+K) — loaded with the rail so every
   page that has nav gets it without its own script tag. */
(function(){ if (window.CudicPalette || document.querySelector('script[data-cudic-palette]')) return; var s=document.createElement('script'); s.src='/cudic-palette.js?v=2'; s.defer=true; s.setAttribute('data-cudic-palette',''); document.head.appendChild(s); })();

/* Cudic's own right-click menu — text fields keep the native one. */
(function(){ if (window.CudicMenu || document.querySelector('script[data-cudic-menu]')) return; var s=document.createElement('script'); s.src='/cudic-menu.js?v=5'; s.defer=true; s.setAttribute('data-cudic-menu',''); document.head.appendChild(s); })();
