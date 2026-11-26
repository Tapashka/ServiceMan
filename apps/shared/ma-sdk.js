/* =====================================================================
   «Мой автомеханик» — общий SDK экосистемы
   Подключает любое приложение (клиентка, СТО, консьерж, диспетчер) к серверу:
     MA.connect({ role, onState, onNotify, onLoc })      — вход/регистрация, затем живая синхронизация по WebSocket
     MA.act(type, payload) → Promise                       — действие участника
     MA.loc(orderId, leg, progress, lng, lat)               — позиция консьержа в поездке
   Адрес сервера: ?server=… → localStorage → window.MA_CONFIG.server → текущий домен.
   Вход: Supabase Auth (email + пароль). Сервер сообщает адрес Supabase в /api/config,
   приложение получает токен и передаёт его серверу; кто вы и какая у вас роль — решает сервер.
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
      this.opts = opts; this.who = { role: opts.role, id: null };
      if (opts.badge !== false) injectBadge(opts.badge || {});
      Auth.start(opts.role).then(() => { this._ready = true; this._open(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden && this.status !== 'online') this._open(); });
      if (opts.askNotifications !== false) askNotificationPermission();
      return this;
    },

    _open() {
      if (!this._ready) return; // сначала вход
      try { if (this.ws) { this.ws.onclose = null; this.ws.close(); } } catch (e) {}
      const url = serverUrl().replace(/^http/, 'ws') + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return this._schedule(); }
      this.ws = ws; this._setStatus('connecting');
      ws.onopen = () => { this._retry = 0; this._hello(); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'auth') { // сервер не принял токен: показываем вход
          this._setStatus('offline');
          Auth.fail(m.error).then(() => this._hello());
          return;
        }
        if (m.t === 'state') {
          this._setStatus('online');
          if (m.data.me) this.who = m.data.me;
          if (Auth._mode !== 'account') Auth.hide();
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
    _hello() {
      if (this.ws && this.ws.readyState === 1 && Auth.token()) this.ws.send(JSON.stringify({ t: 'hello', role: this.opts.role, token: Auth.token() }));
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
      return fetch(serverUrl() + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + Auth.token() }, body: JSON.stringify({ role: this.opts.role, type, p }) })
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
    logout() { return Auth.logout(); },
    user() { return Auth.user(); },
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
    badge.title = 'Аккаунт и связь с сервером';
    badge.onclick = () => Auth.account();
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

  // =====================================================================
  //  ВХОД И РЕГИСТРАЦИЯ (Supabase Auth, email + пароль)
  // =====================================================================
  const SESSION_KEY = () => 'ma.session.' + Auth.role; // у каждого приложения свой вход
  const APP = {
    client:     { title: 'Мой автомеханик', sub: 'Ремонт машины без поездок в сервис', path: '/client/', signup: true },
    sto:        { title: 'Панель СТО', sub: 'Заявки клиенток, сметы и выдача машин', path: '/sto/', signup: true },
    concierge:  { title: 'Автоконсьерж', sub: 'Перегон машин клиенток в СТО и обратно', path: '/concierge/', signup: true },
    dispatcher: { title: 'Панель диспетчера', sub: 'Аккаунты диспетчеров и директора выдаёт администратор', path: '/dispatcher/', signup: false },
    director:   { title: 'Панель диспетчера', sub: '', path: '/dispatcher/', signup: false }
  };
  const ROLE_RU = { client: 'клиентка', sto: 'СТО', concierge: 'консьерж', dispatcher: 'диспетчер', director: 'директор' };
  const ERR_RU = {
    invalid_credentials: 'Неверный email или пароль', invalid_grant: 'Неверный email или пароль',
    email_not_confirmed: 'Email ещё не подтверждён. Откройте ссылку из письма', user_already_exists: 'Этот email уже зарегистрирован. Войдите',
    email_exists: 'Этот email уже зарегистрирован. Войдите', weak_password: 'Пароль слишком простой. Нужно минимум 6 символов',
    over_email_send_rate_limit: 'Слишком много писем за короткое время. Попробуйте через час', over_request_rate_limit: 'Слишком много попыток. Подождите минуту',
    signup_disabled: 'Регистрация временно закрыта', validation_failed: 'Проверьте email', email_address_invalid: 'Такой email не подходит',
    same_password: 'Новый пароль совпадает со старым', otp_expired: 'Ссылка из письма устарела. Запросите новую'
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const Auth = {
    cfg: null, session: null, role: null, _resolve: null, _refreshT: null, _el: null,

    token() { return this.session ? this.session.access_token : ''; },
    user() { return this.session ? this.session.user : null; },
    dev() { return !!(this.cfg && this.cfg.authDisabled); },

    async config() {
      while (!this.cfg) {
        try { const r = await fetch(serverUrl() + '/api/config'); if (r.ok) this.cfg = await r.json(); }
        catch (e) { this._screen('wait'); await sleep(3000); }
      }
      return this.cfg;
    },

    async start(role) {
      this.role = role;
      await this.config();
      this.session = this._load();
      // переход по ссылке из письма: #access_token=…&refresh_token=…&type=signup|recovery
      const h = new URLSearchParams((location.hash || '').slice(1));
      let recovery = false, notice = '';
      if (h.get('access_token')) {
        try {
          const user = await this._api('GET', '/auth/v1/user', null, h.get('access_token'));
          this._save({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: +h.get('expires_at') || (Date.now() / 1000 + (+h.get('expires_in') || 3600)), user });
          recovery = h.get('type') === 'recovery';
          if (h.get('type') === 'signup') notice = 'Email подтверждён. Добро пожаловать!';
        } catch (e) { notice = e.message; }
        history.replaceState(null, '', location.pathname + location.search);
      } else if (h.get('error_description')) {
        notice = ERR_RU[h.get('error_code')] || h.get('error_description');
        history.replaceState(null, '', location.pathname + location.search);
      }
      if (this.session && !this.dev() && this.session.expires_at * 1000 < Date.now() + 60000) {
        try { await this.refresh(); } catch (e) { this._save(null); }
      }
      if (recovery && this.session) await this._ask('newpass');
      if (!this.session) await this._ask('login', notice && !this.session ? notice : '');
      else if (notice) setTimeout(() => toast(notice), 600);
      this._schedule();
    },

    // сервер не принял токен
    async fail(msg) {
      if (/истекла/.test(msg || '') && this.session && this.session.refresh_token) {
        try { await this.refresh(); return; } catch (e) {}
      }
      this._save(null);
      await this._ask('login', msg);
    },

    async refresh() {
      if (this.dev()) return;
      const s = await this._api('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: this.session.refresh_token });
      this._save(s); this._schedule();
      MA._hello(); // новый токен — серверу
    },
    _schedule() {
      clearTimeout(this._refreshT);
      if (!this.session || this.dev()) return;
      const ms = Math.max(5000, this.session.expires_at * 1000 - Date.now() - 120000);
      this._refreshT = setTimeout(() => this.refresh().catch(() => this.fail('Сессия истекла, войдите снова')), ms);
    },

    async logout() {
      try { if (!this.dev() && this.session) await this._api('POST', '/auth/v1/logout', {}, this.token()); } catch (e) {}
      this._save(null);
      location.reload();
    },

    hide() { if (this._el) this._el.style.display = 'none'; },

    // ---------------- Supabase Auth REST
    async _api(method, path, body, token) {
      const c = this.cfg;
      const headers = { apikey: c.supabaseKey, 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      let r;
      try { r = await fetch(c.supabaseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
      catch (e) { throw new Error('Нет связи с сервисом входа'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = j.error_code || j.code || j.error;
        throw new Error(ERR_RU[code] || j.msg || j.error_description || j.message || 'Ошибка входа (' + r.status + ')');
      }
      return j;
    },
    _redirect() { return encodeURIComponent(serverUrl() + APP[this.role].path); },
    _load() { try { return JSON.parse(lsGet(SESSION_KEY()) || 'null'); } catch (e) { return null; } },
    _save(s) {
      if (s && !s.expires_at && s.expires_in) s.expires_at = Math.floor(Date.now() / 1000) + s.expires_in;
      this.session = s; lsSet(SESSION_KEY(), s ? JSON.stringify(s) : '');
    },

    async login(email, password) {
      this._save(await this._api('POST', '/auth/v1/token?grant_type=password', { email, password }));
    },
    // → true, если сразу вошли; false — нужно подтвердить email
    async signup(email, password, data) {
      const r = await this._api('POST', '/auth/v1/signup?redirect_to=' + this._redirect(), { email, password, data });
      if (r.access_token) { this._save(r); return true; }
      // Supabase не сообщает, что email занят: у такого «пользователя» пустой список identities
      if (r.identities && !r.identities.length) throw new Error(ERR_RU.user_already_exists);
      return false;
    },
    recover(email) { return this._api('POST', '/auth/v1/recover?redirect_to=' + this._redirect(), { email }); },
    resend(email) { return this._api('POST', '/auth/v1/resend', { type: 'signup', email, options: { email_redirect_to: decodeURIComponent(this._redirect()) } }); },
    async setPassword(password) {
      const user = await this._api('PUT', '/auth/v1/user', { password }, this.token());
      this.session.user = user; this._save(this.session);
    },
    devLogin(name, role) {
      const id = 'dev-' + role + '-' + name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '');
      this._save({ access_token: ['dev', role, id, name].join(':'), expires_at: 4e9, user: { id, email: '', user_metadata: { name, role } } });
    },

    // ---------------- экран входа
    _ask(mode, msg) {
      if (this._waiting) { this._screen(mode, msg); return this._waiting; }
      this._waiting = new Promise((resolve) => { this._resolve = resolve; this._screen(mode, msg); });
      return this._waiting;
    },
    _done() { const r = this._resolve; this._resolve = null; this._waiting = null; this.hide(); r && r(); },

    _screen(mode, msg, email) {
      ensureCss();
      if (!this._el) {
        this._el = document.createElement('div'); this._el.className = 'ma-auth';
        const mount = () => document.body.appendChild(this._el);
        document.body ? mount() : document.addEventListener('DOMContentLoaded', mount);
      }
      const el = this._el; el.style.display = 'flex'; this._mode = mode;
      const app = APP[this.role] || APP.client;
      const e = MA.esc;
      const field = (name, label, type = 'text', extra = '') =>
        `<label class="ma-f"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;
      const err = msg ? `<div class="ma-msg ${/подтвержд|отправ|Добро|готов/i.test(msg) ? 'ok' : ''}">${e(msg)}</div>` : '';
      let body = '';

      if (mode === 'wait') {
        body = `<div class="ma-msg">Нет связи с сервером ${e(serverUrl())}. Пробуем снова…</div>
          <button class="ma-link" data-go="server">Сменить адрес сервера</button>`;
      } else if (this.dev() && mode !== 'account') {
        const roles = this.role === 'dispatcher' ? ['dispatcher', 'director'] : [this.role];
        body = `<div class="ma-msg">Режим разработки: сервер запущен с AUTH_DISABLED=1, вход без пароля.</div>${err}
          <form data-f="dev">${field('name', 'Ваше имя', 'text', 'required autocomplete="name"')}
          ${roles.length > 1 ? `<label class="ma-f"><span>Роль</span><select name="role">${roles.map((r) => `<option value="${r}">${ROLE_RU[r]}</option>`).join('')}</select></label>` : ''}
          <button class="ma-btn">Войти</button></form>`;
      } else if (mode === 'login') {
        body = `${err}<form data-f="login">
          ${field('email', 'Email', 'email', 'required autocomplete="email"')}
          ${field('password', 'Пароль', 'password', 'required autocomplete="current-password" minlength="6"')}
          <button class="ma-btn">Войти</button></form>
          <button class="ma-link" data-go="forgot">Забыли пароль?</button>
          ${app.signup ? `<div class="ma-alt">Нет аккаунта? <button class="ma-link" data-go="signup">Зарегистрироваться</button></div>` : ''}`;
      } else if (mode === 'signup') {
        const extra = this.role === 'sto'
          ? field('stoName', 'Название СТО', 'text', 'required') + field('address', 'Адрес СТО', 'text', 'required autocomplete="street-address"') + field('name', 'Контактное лицо', 'text', 'required autocomplete="name"')
          : this.role === 'concierge'
            ? field('name', 'Имя и фамилия', 'text', 'required autocomplete="name"') + field('car', 'Ваша машина (марка, модель)', 'text')
            : field('name', 'Имя и фамилия', 'text', 'required autocomplete="name"');
        body = `${err}<form data-f="signup">${extra}
          ${field('phone', 'Телефон', 'tel', 'required autocomplete="tel" placeholder="+375 29 000-00-00"')}
          ${field('email', 'Email', 'email', 'required autocomplete="email"')}
          ${field('password', 'Пароль (минимум 6 символов)', 'password', 'required autocomplete="new-password" minlength="6"')}
          <button class="ma-btn">Создать аккаунт</button></form>
          <div class="ma-alt">Уже есть аккаунт? <button class="ma-link" data-go="login">Войти</button></div>`;
      } else if (mode === 'check') {
        body = `<div class="ma-msg ok">Мы отправили письмо на <b>${e(email)}</b>. Откройте ссылку из письма, чтобы подтвердить email, затем войдите.</div>
          <button class="ma-btn" data-go="login">Я подтвердил(а), войти</button>
          <button class="ma-link" data-go="resend" data-email="${e(email)}">Отправить письмо ещё раз</button>`;
      } else if (mode === 'forgot') {
        body = `${err}<form data-f="forgot">${field('email', 'Email', 'email', 'required autocomplete="email"')}
          <button class="ma-btn">Прислать ссылку для нового пароля</button></form>
          <button class="ma-link" data-go="login">Назад ко входу</button>`;
      } else if (mode === 'newpass') {
        body = `${err}<form data-f="newpass">${field('password', 'Новый пароль (минимум 6 символов)', 'password', 'required autocomplete="new-password" minlength="6"')}
          <button class="ma-btn">Сохранить пароль</button></form>`;
      } else if (mode === 'account') {
        const u = this.user() || {}; const m = u.user_metadata || {};
        const me = MA.who || {};
        body = `<div class="ma-kv"><span>Аккаунт</span><b>${e(m.name || u.email || '—')}</b></div>
          ${u.email ? `<div class="ma-kv"><span>Email</span><b>${e(u.email)}</b></div>` : ''}
          <div class="ma-kv"><span>Роль</span><b>${e(ROLE_RU[me.role] || ROLE_RU[this.role])}</b></div>
          <div class="ma-kv"><span>Сервер</span><b>${e(serverUrl())} · ${MA.status === 'online' ? 'на связи' : 'нет связи'}</b></div>
          <button class="ma-btn danger" data-go="logout">Выйти из аккаунта</button>
          <button class="ma-link" data-go="server">Сменить адрес сервера</button>
          <button class="ma-link" data-go="close">Закрыть</button>`;
      }

      el.innerHTML = `<div class="ma-card" role="dialog" aria-modal="true">
        <div class="ma-logo">${e(app.title)}</div>
        <div class="ma-sub">${mode === 'signup' ? 'Регистрация' : mode === 'forgot' || mode === 'newpass' ? 'Восстановление пароля' : mode === 'account' ? 'Ваш аккаунт' : e(app.sub)}</div>
        ${body}</div>`;
      if (mode === 'account') el.onclick = (ev) => { if (ev.target === el) this.hide(); };
      else el.onclick = null;
      const first = el.querySelector('input'); if (first) setTimeout(() => first.focus(), 50);

      el.querySelectorAll('[data-go]').forEach((b) => b.onclick = async (ev) => {
        ev.preventDefault();
        const go = b.dataset.go;
        if (go === 'logout') return this.logout();
        if (go === 'close') return this.hide();
        if (go === 'server') { const v = prompt('Адрес сервера экосистемы «Мой автомеханик»\n(пусто — по умолчанию)', serverUrl()); if (v !== null) MA.setServer(v.trim()); return; }
        if (go === 'resend') { try { await this.resend(b.dataset.email); toast('Письмо отправлено ещё раз'); } catch (e2) { toast(e2.message); } return; }
        this._screen(go);
      });
      const f = el.querySelector('form');
      if (f) f.onsubmit = async (ev) => {
        ev.preventDefault();
        const v = Object.fromEntries(new FormData(f).entries());
        Object.keys(v).forEach((k) => { if (k !== 'password') v[k] = String(v[k]).trim(); });
        const btn = f.querySelector('.ma-btn'); const label = btn.textContent;
        btn.disabled = true; btn.textContent = 'Подождите…';
        try {
          if (f.dataset.f === 'dev') { this.devLogin(v.name, v.role || this.role); return this._done(); }
          if (f.dataset.f === 'login') { await this.login(v.email, v.password); return this._done(); }
          if (f.dataset.f === 'signup') {
            const data = { role: this.role, name: v.name, phone: v.phone };
            if (v.stoName) data.stoName = v.stoName;
            if (v.address) data.address = v.address;
            if (v.car) data.car = v.car;
            if (await this.signup(v.email, v.password, data)) return this._done();
            return this._screen('check', '', v.email);
          }
          if (f.dataset.f === 'forgot') { await this.recover(v.email); return this._screen('login', 'Ссылка для нового пароля отправлена на ' + v.email); }
          if (f.dataset.f === 'newpass') { await this.setPassword(v.password); toast('Пароль сохранён'); return this._done(); }
        } catch (e2) {
          btn.disabled = false; btn.textContent = label;
          let m = f.parentNode.querySelector('.ma-msg');
          if (!m) { m = document.createElement('div'); f.parentNode.insertBefore(m, f); }
          m.className = 'ma-msg'; m.textContent = e2.message;
        }
      };
    },
    account() { if (this.cfg) this._screen('account'); }
  };

  let cssDone = false;
  function ensureCss() {
    if (cssDone) return; cssDone = true;
    const css = document.createElement('style');
    css.textContent = `.ma-auth{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;
        background:rgba(246,244,239,.97);font-family:Inter,system-ui,-apple-system,sans-serif;color:#1B2430;overflow:auto}
      .ma-card{width:100%;max-width:380px;background:#fff;border:1px solid #DEDACE;border-radius:18px;padding:26px 22px 20px;box-shadow:0 12px 40px rgba(27,36,48,.08);margin:auto}
      .ma-logo{font:700 22px/1.2 "Space Grotesk",Inter,sans-serif;letter-spacing:-.01em}
      .ma-sub{font-size:13px;color:#8891A0;margin:4px 0 18px}
      .ma-f{display:block;margin-bottom:12px}.ma-f span{display:block;font-size:12px;font-weight:600;color:#4D5769;margin-bottom:5px}
      .ma-f input,.ma-f select{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:11px 12px;border:1px solid #DEDACE;border-radius:12px;background:#F6F4EF;color:#1B2430;outline:none}
      .ma-f input:focus,.ma-f select:focus{border-color:#3F7D6B;background:#fff}
      .ma-btn{display:block;width:100%;font:600 15px/1 Inter,sans-serif;padding:14px;border:0;border-radius:12px;background:#1B2430;color:#fff;cursor:pointer;margin-top:6px}
      .ma-btn:disabled{opacity:.6;cursor:default}.ma-btn.danger{background:#C1503F;margin-top:16px}
      .ma-link{display:block;margin:12px auto 0;background:none;border:0;font:500 13px Inter,sans-serif;color:#3F7D6B;cursor:pointer;padding:4px}
      .ma-alt{text-align:center;font-size:13px;color:#4D5769;margin-top:14px;padding-top:14px;border-top:1px solid #ECE8DE}
      .ma-alt .ma-link{display:inline;margin:0}
      .ma-msg{font-size:13px;line-height:1.45;padding:10px 12px;border-radius:10px;background:#F6E4E0;color:#8E3527;margin-bottom:14px}
      .ma-msg.ok{background:#E3EEE9;color:#2C5E50}
      .ma-kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:9px 0;border-bottom:1px solid #ECE8DE}
      .ma-kv span{color:#8891A0}.ma-kv b{font-weight:600;text-align:right;word-break:break-all}
      .ma-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10001;background:#1B2430;color:#fff;font:500 13px Inter,sans-serif;padding:10px 14px;border-radius:12px}`;
    document.head.appendChild(css);
  }
  function toast(t) {
    ensureCss();
    const d = document.createElement('div'); d.className = 'ma-toast'; d.textContent = t;
    document.body.appendChild(d); setTimeout(() => d.remove(), 3200);
  }
  window.MA = MA;
})();
