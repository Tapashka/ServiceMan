// Сервер экосистемы «Мой автомеханик»
//  • REST:      GET /api/state?role=&id=   POST /api/act {role,id,type,p}   POST /api/reset   GET /api/health
//  • WebSocket: /ws  — живая синхронизация всех приложений (клиентка, СТО, консьерж, диспетчер)
//  • Статика:   /client/ /sto/ /dispatcher/ /concierge/ и страница экосистемы /
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { seed } from './seed.js';
import { apply, tick, viewFor, matchTo, DomainError } from './domain.js';
import { openStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8080;
const APPS_DIR = path.resolve(process.env.APPS_DIR || path.join(__dirname, '../../apps'));
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '../data/ecosystem.db');
const ROLES = new Set(['client', 'sto', 'concierge', 'dispatcher', 'director']);

const store = openStore(DB_FILE);
let S = store.load() || seed();
if (!S.version) S = seed();
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
  if (type === 'demo.reset') { S = seed(); store.save(S); store.event(who, type, {}); broadcastState(); return { ok: true }; }
  const ctx = apply(S, who, type, p || {});
  store.event(who, type, p);
  broadcastState();
  deliverNotifications(ctx.out);
  return { ok: true, result: ctx.result };
}

// ------------------------------------------------------------ боты и время
setInterval(() => {
  try {
    const { changed, ctx } = tick(S);
    if (ctx.loc.length) broadcastLoc(ctx.loc);
    ctx.events.forEach((e) => store.event(e.who, e.type, e.p));
    if (changed) { broadcastState(); deliverNotifications(ctx.out); }
  } catch (e) { console.error('tick error', e); }
}, 1000);

// ------------------------------------------------------------ HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject);
  });
}
function whoFrom(o) {
  const role = o && o.role; if (!ROLES.has(role)) return null;
  return { role, id: String(o.id || ({ client: 'c1', sto: 'sto1', concierge: 'k1' }[role] || 'd1')) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  try {
    if (url.pathname === '/api/health') return json(res, 200, { ok: true, seq: S.seq, clients: sockets.size });
    if (url.pathname === '/api/state') {
      const who = whoFrom({ role: url.searchParams.get('role'), id: url.searchParams.get('id') });
      if (!who) return json(res, 400, { ok: false, error: 'role?' });
      return json(res, 200, viewFor(S, who));
    }
    if (url.pathname === '/api/act' && req.method === 'POST') {
      const b = await readBody(req); const who = whoFrom(b);
      if (!who) return json(res, 400, { ok: false, error: 'role?' });
      return json(res, 200, act(who, b.type, b.p));
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') return json(res, 200, act({ role: 'dispatcher', id: 'd1' }, 'demo.reset', {}));
    if (url.pathname === '/api/events') {
      const name = (role, id) => role === 'client' ? S.clients[id] && S.clients[id].name : role === 'sto' ? S.stos[id] && S.stos[id].name
        : role === 'concierge' ? S.concierges[id] && S.concierges[id].name : role === 'dispatcher' ? 'Ольга К.' : role === 'director' ? 'директор' : 'демо-бот';
      const bot = (role, id) => (role === 'client' && S.clients[id] && S.clients[id].bot) || (role === 'sto' && S.stos[id] && S.stos[id].bot) || (role === 'concierge' && S.concierges[id] && S.concierges[id].bot);
      return json(res, 200, store.recent(+url.searchParams.get('limit') || 100).map((e) => Object.assign(e, { actor: (name(e.role, e.actor) || e.actor) + (bot(e.role, e.actor) ? ' (бот)' : '') })));
    }
  } catch (e) {
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
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'hello') {
      ws.who = whoFrom(m);
      if (!ws.who) return send(ws, { t: 'error', error: 'Неизвестная роль' });
      return send(ws, { t: 'state', data: viewFor(S, ws.who) });
    }
    if (!ws.who) return send(ws, { t: 'error', error: 'Сначала hello' });
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
