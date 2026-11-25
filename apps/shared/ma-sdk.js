/* =====================================================================
   «Мой автомеханик» — общий SDK экосистемы
   Подключает любое приложение (клиентка, СТО, консьерж, диспетчер) к серверу:
     MA.connect({ role, id, onState, onNotify, onLoc })  — живая синхронизация по WebSocket
     MA.act(type, payload) → Promise                       — действие участника
     MA.loc(orderId, leg, progress, lng, lat)               — позиция консьержа в поездке
   Адрес сервера: ?server=… → localStorage → window.MA_CONFIG.server → текущий домен.
   ===================================================================== */
(function () {
  const LS_KEY = 'ma.server';
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }

  function serverUrl() {
    try { const q = new URLSearchParams(location.search).get('server'); if (q) { lsSet(LS_KEY, q); return q.replace(/\/$/, ''); } } catch (e) {}
    const saved = lsGet(LS_KEY); if (saved) return saved.replace(/\/$/, '');
    if (window.MA_CONFIG && window.MA_CONFIG.server) return window.MA_CONFIG.server.replace(/\/$/, '');
    if (!isNative() && /^https?:$/.test(location.protocol)) return location.origin;
    return 'http://localhost:8080';
  }

  const MA = {
    state: null, prev: null, who: null, status: 'connecting', ws: null, opts: {},
    _rid: 1, _pending: {}, _retry: 0, _seen: new Set(),
    serverUrl, isNative,
    setServer(url) { lsSet(LS_KEY, url || ''); location.reload(); },

    connect(opts) {
      this.opts = opts; this.who = { role: opts.role, id: opts.id };
      if (opts.badge !== false) injectBadge(opts.badge || {});
      this._open();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && this.status !== 'online') this._open(); });
      if (opts.askNotifications !== false) askNotificationPermission();
      return this;
    },

    _open() {
      try { if (this.ws) { this.ws.onclose = null; this.ws.close(); } } catch (e) {}
      const url = serverUrl().replace(/^http/, 'ws') + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return this._schedule(); }
      this.ws = ws; this._setStatus('connecting');
      ws.onopen = () => { this._retry = 0; ws.send(JSON.stringify(Object.assign({ t: 'hello' }, this.who))); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'state') {
          this._setStatus('online');
          const first = !this.state;
          this.prev = this.state; this.state = m.data;
          if (first) (m.data.notifications || []).forEach((n) => this._seen.add(n.id));
          try { this.opts.onState && this.opts.onState(m.data, this.prev, first); } catch (e) { console.error(e); }
        } else if (m.t === 'ack') {
          const p = this._pending[m.rid]; if (!p) return; delete this._pending[m.rid];
          m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'Ошибка'));
        } else if (m.t === 'notify') {
          if (this._seen.has(m.n.id)) return; this._seen.add(m.n.id);
          try { this.opts.onNotify && this.opts.onNotify(m.n); } catch (e) { console.error(e); }
          nativeNotify(m.n);
        } else if (m.t === 'loc') {
          try { this.opts.onLoc && this.opts.onLoc(m); } catch (e) { console.error(e); }
        }
      };
      ws.onclose = () => { this._setStatus('offline'); Object.values(this._pending).forEach((p) => p.reject(new Error('Нет связи с сервером'))); this._pending = {}; this._schedule(); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    },
    _schedule() { clearTimeout(this._t); const d = Math.min(8000, 600 * Math.pow(1.6, this._retry++)); this._t = setTimeout(() => this._open(), d); },
    _setStatus(s) { this.status = s; updateBadge(s); this.opts.onStatus && this.opts.onStatus(s); },

    act(type, p) {
      if (this.ws && this.ws.readyState === 1) {
        const rid = this._rid++;
        return new Promise((resolve, reject) => {
          this._pending[rid] = { resolve, reject };
          this.ws.send(JSON.stringify({ t: 'act', rid, type, p: p || {} }));
          setTimeout(() => { if (this._pending[rid]) { delete this._pending[rid]; reject(new Error('Сервер не ответил')); } }, 10000);
        });
      }
      // запасной путь — REST
      return fetch(serverUrl() + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ type, p }, this.who)) })
        .then((r) => r.json()).then((j) => { if (!j.ok) throw new Error(j.error || 'Ошибка'); return j.result; })
        .catch((e) => { throw new Error(e.message === 'Failed to fetch' ? 'Нет связи с сервером' : e.message); });
    },

    loc(orderId, leg, progress, lng, lat) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'loc', orderId, leg, progress, lng, lat }));
    },

    // ----- утилиты форматирования, общие для всех приложений
    hhmm(ts) { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },
    when(ts) {
      const d = new Date(ts), n = new Date();
      const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const diff = Math.round((day(n) - day(d)) / 864e5);
      if (diff === 0) return 'Сегодня, ' + this.hhmm(ts);
      if (diff === 1) return 'Вчера, ' + this.hhmm(ts);
      return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' }) + ' ' + this.hhmm(ts);
    },
    group(ts) { const w = this.when(ts); return w.startsWith('Сегодня') ? 'Сегодня' : w.startsWith('Вчера') ? 'Вчера' : 'Ранее'; },
    ago(ts) {
      const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (s < 60) return 'только что'; if (s < 3600) return Math.round(s / 60) + ' мин назад';
      if (s < 86400) return Math.round(s / 3600) + ' ч назад'; return Math.round(s / 86400) + ' дн назад';
    },
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    reset() { return fetch(serverUrl() + '/api/reset', { method: 'POST' }).then((r) => r.json()); }
  };

  // ----- индикатор связи (нажатие — сменить адрес сервера)
  let badge = null;
  function injectBadge(o) {
    if (badge) return;
    const css = document.createElement('style');
    css.textContent = `.ma-badge{position:fixed;z-index:9999;${o.pos === 'top-center' ? 'top:max(6px,env(safe-area-inset-top));left:50%;transform:translateX(-50%)' : o.pos === 'top-right' ? 'top:8px;right:8px' : o.pos === 'bottom-right' ? 'bottom:8px;right:8px' : o.pos === 'top-left' ? 'top:8px;left:8px' : 'bottom:8px;left:8px'};
      font:600 10.5px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.03em;padding:5px 8px;border-radius:20px;background:rgba(27,36,48,.86);color:#ECE8DE;
      cursor:pointer;display:flex;gap:6px;align-items:center;user-select:none;-webkit-tap-highlight-color:transparent;opacity:.82}
      .ma-badge:hover{opacity:1}.ma-badge i{width:7px;height:7px;border-radius:50%;background:#E8A33D;display:block}
      .ma-badge.online i{background:#5FA58F}.ma-badge.offline i{background:#E07463}.ma-badge.online span{display:${o.compact ? 'none' : 'inline'}}`;
    document.head.appendChild(css);
    badge = document.createElement('div');
    badge.className = 'ma-badge'; badge.title = 'Связь с сервером экосистемы. Нажмите, чтобы сменить адрес';
    badge.innerHTML = '<i></i><span>подключение…</span>';
    badge.onclick = () => {
      const v = prompt('Адрес сервера экосистемы «Мой автомеханик»\n(пусто — по умолчанию)', serverUrl());
      if (v !== null) MA.setServer(v.trim());
    };
    (document.body ? Promise.resolve() : new Promise((r) => document.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(badge));
  }
  function updateBadge(s) {
    if (!badge) return;
    badge.className = 'ma-badge ' + s;
    badge.querySelector('span').textContent = s === 'online' ? 'синхронизировано' : s === 'offline' ? 'нет связи · повтор' : 'подключение…';
  }

  // ----- системные уведомления: на телефоне — Capacitor Local Notifications, в браузере — Notification API
  function askNotificationPermission() {
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (LN && LN.requestPermissions) { LN.requestPermissions().catch(() => {}); return; }
  }
  let nid = 1;
  function nativeNotify(n) {
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (LN && document.hidden) {
      LN.schedule({ notifications: [{ id: nid++, title: n.title, body: n.text || '', extra: n.link || {} }] }).catch(() => {});
      return;
    }
    if (!LN && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(n.title, { body: n.text || '' }); } catch (e) {}
    }
  }

  window.MA = MA;
})();
