// Хранилище состояния экосистемы.
//  • Supabase (Postgres) — если заданы SUPABASE_URL и SUPABASE_SERVICE_KEY. Данные переживают перезапуски сервера.
//  • SQLite (node:sqlite) — локально, для разработки и тестов.
// state  — снимок состояния экосистемы (JSON), events — журнал всех действий участников.
// Интерфейс одинаковый: await load(), save(S), event(who, type, p), await recent(n).
import fs from 'node:fs';
import path from 'node:path';

export async function openStore(file) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  if (url && key) return openSupabase(url, key);
  return openSqlite(file);
}

async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, role TEXT, actor TEXT, type TEXT NOT NULL, payload TEXT);
  `);
  const get = db.prepare('SELECT json FROM kv WHERE key = ?');
  const put = db.prepare('INSERT INTO kv (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at');
  const ev = db.prepare('INSERT INTO events (ts, role, actor, type, payload) VALUES (?, ?, ?, ?, ?)');
  const recent = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?');
  console.log('Хранилище: SQLite ' + file);
  return {
    kind: 'sqlite',
    async load() { const r = get.get('state'); return r ? JSON.parse(r.json) : null; },
    save(S) { put.run('state', JSON.stringify(S), Date.now()); },
    event(who, type, p) { ev.run(Date.now(), who.role, who.id, type, JSON.stringify(p || {})); },
    async recent(n) { return recent.all(Math.min(n, 1000)); },
    async flush() {}
  };
}

// Supabase REST (PostgREST) с секретным ключом. Ключ хранится только на сервере, в приложения не попадает.
async function openSupabase(url, key) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = 'Bearer ' + key; // старые JWT-ключи service_role
  const rest = url + '/rest/v1';
  async function call(method, p, body, extra = {}) {
    const r = await fetch(rest + p, { method, headers: Object.assign({}, headers, extra), body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`Supabase ${method} ${p}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  }

  // запись снимка: не чаще одного запроса за раз, всегда последняя версия
  let pending = null, writing = null;
  async function pump() {
    while (pending) {
      const json = pending; pending = null;
      try { await call('POST', '/app_state?on_conflict=key', [{ key: 'state', data: json, updated_at: new Date().toISOString() }], { Prefer: 'resolution=merge-duplicates,return=minimal' }); }
      catch (e) { console.error('Не удалось сохранить состояние:', e.message); if (!pending) pending = json; await new Promise((r) => setTimeout(r, 3000)); }
    }
    writing = null;
  }
  // журнал событий отправляем пачками
  let evq = [], evTimer = null;
  async function flushEvents() {
    clearTimeout(evTimer); evTimer = null;
    if (!evq.length) return;
    const batch = evq; evq = [];
    try { await call('POST', '/events', batch, { Prefer: 'return=minimal' }); }
    catch (e) { console.error('Не удалось записать журнал:', e.message); }
  }

  const store = {
    kind: 'supabase',
    async load() {
      const rows = await call('GET', '/app_state?key=eq.state&select=data');
      return rows && rows[0] ? rows[0].data : null;
    },
    save(S) {
      pending = JSON.parse(JSON.stringify(S));
      if (!writing) writing = pump();
    },
    event(who, type, p) {
      evq.push({ ts: Date.now(), role: who.role, actor: who.id, type, payload: p || {} });
      if (!evTimer) evTimer = setTimeout(flushEvents, 1000);
    },
    async recent(n) {
      await flushEvents();
      const rows = await call('GET', `/events?select=id,ts,role,actor,type,payload&order=id.desc&limit=${Math.min(+n || 100, 1000)}`);
      return rows.map((r) => Object.assign(r, { payload: JSON.stringify(r.payload) }));
    },
    async flush() { await flushEvents(); if (writing) await writing; }
  };
  await store.load(); // проверка доступа к таблицам при старте
  console.log('Хранилище: Supabase ' + url);
  return store;
}
