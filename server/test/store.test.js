// Хранилище в Supabase (PostgREST) против поддельного сервера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('состояние и журнал пишутся в Supabase и читаются обратно', async () => {
  const db = { state: null, events: [] }; const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen.push({ m: req.method, u: req.url, key: req.headers.apikey, auth: req.headers.authorization });
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(j === undefined ? '' : JSON.stringify(j)); };
      if (req.method === 'GET' && req.url.startsWith('/rest/v1/app_state')) return send(200, db.state ? [{ data: db.state }] : []);
      if (req.method === 'POST' && req.url.startsWith('/rest/v1/app_state')) { db.state = JSON.parse(b)[0].data; return send(201); }
      if (req.method === 'POST' && req.url === '/rest/v1/events') { JSON.parse(b).forEach((e, i) => db.events.push(Object.assign({ id: db.events.length + i + 1 }, e))); return send(201); }
      if (req.method === 'GET' && req.url.startsWith('/rest/v1/events')) return send(200, db.events.slice().reverse());
      send(404, {});
    });
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${srv.address().port}`;
  process.env.SUPABASE_SERVICE_KEY = 'sb_secret_test';
  const { openStore } = await import('../src/store.js?' + Date.now());
  const store = await openStore('/dev/null');
  assert.equal(store.kind, 'supabase');
  assert.equal(await store.load(), null);
  store.save({ version: 2, seq: 7 });
  store.event({ role: 'client', id: 'u1' }, 'order.create', { tags: ['ТО'] });
  await store.flush();
  assert.deepEqual(await store.load(), { version: 2, seq: 7 });
  const ev = await store.recent(10);
  assert.equal(ev[0].type, 'order.create'); assert.equal(JSON.parse(ev[0].payload).tags[0], 'ТО');
  // новый секретный ключ sb_secret_… отправляется только в apikey, не в Authorization
  assert.ok(seen.every((x) => x.key === 'sb_secret_test' && !x.auth));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  srv.close();
});
