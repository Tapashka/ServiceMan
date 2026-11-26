// Хранилище на встроенном в Node.js SQLite (node:sqlite, без нативных зависимостей).
// state  — снимок состояния экосистемы (JSON), events — журнал всех действий участников.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openStore(file) {
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
  return {
    load() { const r = get.get('state'); return r ? JSON.parse(r.json) : null; },
    save(S) { put.run('state', JSON.stringify(S), Date.now()); },
    event(who, type, p) { ev.run(Date.now(), who.role, who.id, type, JSON.stringify(p || {})); },
    recent(n) { return recent.all(Math.min(n, 1000)); }
  };
}
