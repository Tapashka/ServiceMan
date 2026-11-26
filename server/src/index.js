// Сервер экосистемы «Мой автомеханик»
//  • REST:      GET /api/config   GET /api/state?role=   POST /api/act {role,type,p}   GET /api/health
//               (кроме config и health — с заголовком Authorization: Bearer <токен Supabase>)
//  • WebSocket: /ws  — живая синхронизация всех приложений (клиентка, СТО, консьерж, диспетчер)
//  • Статика:   /client/ /sto/ /dispatcher/ /concierge/ и страница экосистемы /
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { seed } from './seed.js';
import { apply, viewFor, matchTo, ensureProfile, staffName, DomainError } from './domain.js';
import { openStore } from './store.js';
import { verify, authConfig, AuthError, ALL_ROLES } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8080;
const APPS_DIR = path.resolve(process.env.APPS_DIR || path.join(__dirname, '../../apps'));
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '../data/ecosystem.db');
const ROLES = new Set(ALL_ROLES);

if (authConfig.disabled) console.warn('ВНИМАНИЕ: AUTH_DISABLED=1 — вход без пароля, только для разработки');
else if (!authConfig.enabled) console.warn('ВНИМАНИЕ: не заданы SUPABASE_URL и SUPABASE_ANON_KEY — приложения не смогут войти');

const store = await openStore(DB_FILE);
let S = await store.load();
// версия 1 — старое демо-состояние с выдуманными клиентками и СТО: начинаем с чистого листа
if (!S || !S.version || S.version < 2) S = seed();
store.save(S);

// ------------------------------------------------------------ рассылка
const sockets = new Set();
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
let saveTimer = null;
function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.save(S), 300); }
function broadcastState() {
  for (const ws of sockets) if (ws.who) send(ws, { t: 'state', data: viewFor(S, ws.who) });
  persistSoon();
}
function deliverNotifications(list) {
  for (const n of list) for (const ws of sockets) if (ws.who && matchTo(n.to, ws.who)) send(ws, { t: 'notify', n });
}
function broadcastLoc(list) {
  for (const l of list) for (const ws of sockets) if (ws.who) send(ws, Object.assign({ t: 'loc' }, l));
}

function act(who, type, p) {
  const ctx = apply(S, who, type, p || {});
  store.event(who, type, p);
  broadcastState();
  deliverNotifications(ctx.out);
  return { ok: true, result: ctx.result };
}

// ------------------------------------------------------------ вход
// Проверяет токен, создаёт профиль при первом входе и возвращает { role, id }.
async function login(token, role) {
  if (!ROLES.has(role)) throw new AuthError('Неизвестная роль');
  const { who, meta } = await verify(token, role);
  if (ensureProfile(S, who, meta)) { store.event(who, 'profile.create', { name: meta.name }); broadcastState(); }
  return who;
}
function bearer(req) { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; }

// ------------------------------------------------------------ HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function json(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, seq: S.seq, clients: sockets.size, store: store.kind });
    if (url.pathname === '/api/config') return json(res, 200, Object.assign({ authDisabled: authConfig.disabled }, authConfig.public));
    if (url.pathname === '/api/state') {
      const who = await login(bearer(req), url.searchParams.get('role'));
      return json(res, 200, viewFor(S, who));
    }
    if (url.pathname === '/api/act' && req.method === 'POST') {
      const b = await readBody(req);
      const who = await login(bearer(req), b.role);
      return json(res, 200, act(who, b.type, b.p));
    }
    if (url.pathname === '/api/events') {
      const who = await login(bearer(req), 'dispatcher');
      const name = (role, id) => role === 'client' ? S.clients[id] && S.clients[id].name : role === 'sto' ? S.stos[id] && S.stos[id].name
        : role === 'concierge' ? S.concierges[id] && S.concierges[id].name : staffName(S, { role, id });
      const list = await store.recent(+url.searchParams.get('limit') || 100);
      return json(res, 200, list.map((e) => Object.assign(e, { actor: name(e.role, e.actor) || e.actor })));
    }
  } catch (e) {
    if (e instanceof AuthError) return json(res, 401, { ok: false, auth: true, error: e.message });
    if (e instanceof DomainError) return json(res, 422, { ok: false, error: e.message });
    console.error(e); return json(res, 500, { ok: false, error: 'Ошибка сервера' });
  }

  // статика
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(APPS_DIR, p));
  if (!file.startsWith(APPS_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    if (st.isDirectory()) { res.writeHead(302, { Location: url.pathname + '/' }); return res.end(); }
    cors(res);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => sockets.delete(ws));
  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'hello') { // { t:'hello', role, token } — повторяется после обновления токена
      try { ws.who = await login(m.token, m.role); }
      catch (e) { ws.who = null; return send(ws, { t: 'auth', error: e instanceof AuthError ? e.message : 'Ошибка входа' }); }
      return send(ws, { t: 'state', data: viewFor(S, ws.who) });
    }
    if (!ws.who) return send(ws, { t: 'auth', error: 'Войдите в аккаунт' });
    if (m.t === 'act') {
      try { const r = act(ws.who, m.type, m.p); send(ws, { t: 'ack', rid: m.rid, ok: true, result: r.result }); }
      catch (e) {
        if (!(e instanceof DomainError)) console.error(e);
        send(ws, { t: 'ack', rid: m.rid, ok: false, error: e instanceof DomainError ? e.message : 'Ошибка сервера' });
      }
      return;
    }
    if (m.t === 'loc' && ws.who.role === 'concierge') { // живая позиция консьержа во время поездки
      const o = S.orders[m.orderId]; const leg = m.leg === 'ret' ? 'ret' : 'pickup';
      if (o && o[leg] && o[leg].conciergeId === ws.who.id) {
        o[leg].progress = Math.max(0, Math.min(1, +m.progress || 0));
        if (m.lng && m.lat) { o[leg].lng = +m.lng; o[leg].lat = +m.lat; }
        broadcastLoc([{ orderId: o.id, leg, step: o[leg].step, progress: o[leg].progress, lng: o[leg].lng, lat: o[leg].lat, conciergeId: ws.who.id }]);
        persistSoon();
      }
    }
  });
});
setInterval(() => { for (const ws of sockets) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch {} } }, 25000);

server.listen(PORT, () => {
  console.log(`«Мой автомеханик» — сервер экосистемы: http://localhost:${PORT}/`);
  console.log(`  клиентка  /client/   СТО  /sto/   диспетчер  /dispatcher/   консьерж  /concierge/`);
});

// при остановке (деплой на Render) дописываем последние изменения
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => {
  clearTimeout(saveTimer); store.save(S);
  try { await store.flush(); } catch (e) { console.error(e); }
  process.exit(0);
});
