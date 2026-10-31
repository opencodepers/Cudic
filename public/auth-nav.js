/* Shared auth-aware nav: turns "Sign in" links into a username + dropdown
   (Dashboard / Logout) when the visitor is already signed in. */
(function () {
    var style = document.createElement('style');
    style.textContent = '.auth-nav{position:relative;display:inline-flex;align-items:center}.auth-nav .auth-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid var(--line,#262a33);background:var(--panel,#14161b);color:var(--ink,#f7f5ec);font:500 14px "Geist",system-ui,sans-serif;cursor:pointer}.auth-nav .auth-btn:hover{background:var(--ink,#f7f5ec);color:var(--bg,#0d0e10)}.auth-nav .auth-menu{position:absolute;top:calc(100% + 4px);right:0;min-width:180px;border:1px solid var(--line,#262a33);background:var(--panel,#14161b);display:none;flex-direction:column;z-index:50}.auth-nav.open .auth-menu{display:flex}.auth-nav .auth-menu a,.auth-nav .auth-menu button{display:block;width:100%;text-align:left;padding:10px 14px;border:0;background:none;color:var(--ink,#f7f5ec);font:500 13px "Geist",system-ui,sans-serif;cursor:pointer;text-decoration:none;border-bottom:1px solid var(--line,#262a33)}.auth-nav .auth-menu a:last-child,.auth-nav .auth-menu button:last-child{border-bottom:0}.auth-nav .auth-menu a:hover,.auth-nav .auth-menu button:hover{background:var(--bg,#0d0e10)}.auth-nav .auth-name{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
    (document.head || document.documentElement).appendChild(style);

    function apiHost() {
        if (typeof WS_URL !== 'undefined' && WS_URL) return WS_URL.replace(/^wss?:\/\//, 'https://');
        return (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? '' : 'https://glox-o7rr.onrender.com';
    }
    async function getToken() {
        try {
            if (typeof getSupabase === 'function') {
                var db = await getSupabase();
                if (db) { var r = await db.auth.getSession(); if (r && r.data && r.data.session && r.data.session.access_token) return r.data.session.access_token; }
            }
        } catch (e) {}
        try {
            var raw = localStorage.getItem('sb-qgcydphkaujomxyzwcht-auth-token');
            var s = raw ? JSON.parse(raw) : null;
            if (s && s.access_token) return s.access_token;
        } catch (e) {}
        return null;
    }
    function targets() {
        var out = [];
        var ns = document.getElementById('navSignIn');
        if (ns) out.push(ns);
        document.querySelectorAll('a[href="/login"]').forEach(function (a) {
            if (/sign in/i.test((a.textContent || '').trim())) out.push(a);
        });
        var seen = new Set();
        return out.filter(function (el) { if (seen.has(el)) return false; seen.add(el); return true; });
    }
    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    async function init() {
        var token = await getToken();
        if (!token) return;
        var name = '';
        try {
            var res = await fetch(apiHost() + '/api/profile', { headers: { 'Authorization': 'Bearer ' + token } });
            var d = await res.json();
            if (d && d.profile && d.profile.display_name) name = d.profile.display_name;
        } catch (e) {}
        if (!name) name = 'Account';
        targets().forEach(function (anchor) {
            var wrap = document.createElement('span');
            wrap.className = 'auth-nav';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'auth-btn';
            btn.innerHTML = '<span class="auth-name">' + esc(name) + '</span> \u25BE';
            var menu = document.createElement('div');
            menu.className = 'auth-menu';
            var dash = document.createElement('a');
            dash.href = '/profile';
            dash.textContent = 'Dashboard';
            var logout = document.createElement('button');
            logout.type = 'button';
            logout.textContent = 'Logout';
            logout.addEventListener('click', async function () {
                try {
                    if (typeof getSupabase === 'function') {
                        var db = await getSupabase();
                        if (db) await db.auth.signOut();
                    }
                } catch (e) {}
                try { localStorage.removeItem('sb-qgcydphkaujomxyzwcht-auth-token'); } catch (e) {}
                location.href = '/login';
            });
            menu.appendChild(dash);
            menu.appendChild(logout);
            wrap.appendChild(btn);
            wrap.appendChild(menu);
            btn.addEventListener('click', function (e) { e.stopPropagation(); wrap.classList.toggle('open'); });
            document.addEventListener('click', function () { wrap.classList.remove('open'); });
            anchor.parentNode.replaceChild(wrap, anchor);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
