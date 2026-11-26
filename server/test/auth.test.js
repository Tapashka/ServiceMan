// Вход через Supabase: сервер экосистемы против поддельного Supabase Auth.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const USERS = {
  'tok-client': { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'anna@example.com', user_metadata: { role: 'client', name: 'Анна Тестова', phone: '+375 29 111-11-11' }, app_metadata: {} },
  'tok-sto': { id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'sto@example.com', user_metadata: { role: 'sto', name: 'Иван', stoName: 'Гараж Тест', address: 'ул. Тест, 1' }, app_metadata: {} },
  // пытается назначить себя диспетчером при регистрации — не должно сработать
  'tok-fake-disp': { id: 'aaaaaaaa-0000-0000-0000-000000000003', email: 'x@example.com', user_metadata: { role: 'dispatcher', name: 'Хитрый' }, app_metadata: {} },
  'tok-disp': { id: 'aaaaaaaa-0000-0000-0000-000000000004', email: 'd@example.com', user_metadata: { name: 'Диспетчер' }, app_metadata: { role: 'dispatcher' } }
};

let supa, srv, base, dbDir;
const port = 18000 + Math.floor(Math.random() * 1000);

before(async () => {
  supa = http.createServer((req, res) => {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    if (req.url === '/auth/v1/user' && req.headers.apikey === 'anon-key' && USERS[tok]) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(USERS[tok])); }
    res.writeHead(401); res.end('{"msg":"invalid JWT"}');
  });
  await new Promise((r) => supa.listen(0, r));
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-auth-'));
  srv = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(here, '../src/index.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), DB_FILE: path.join(dbDir, 'db.sqlite'), SUPABASE_URL: `http://127.0.0.1:${supa.address().port}`, SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_KEY: '', AUTH_DISABLED: '' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('сервер не стартовал');
});
after(() => { srv && srv.kill(); supa && supa.close(); fs.rmSync(dbDir, { recursive: true, force: true }); });

const state = (tok, role) => fetch(`${base}/api/state?role=${role}`, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} });
const act = (tok, role, type, p) => fetch(base + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ role, type, p }) }).then((r) => r.json());

test('config отдаёт только публичные данные Supabase', async () => {
  const c = await (await fetch(base + '/api/config')).json();
  assert.equal(c.supabaseKey, 'anon-key'); assert.equal(c.authDisabled, false);
  assert.ok(!JSON.stringify(c).includes('service'));
});

test('без токена или с чужим токеном данных нет', async () => {
  assert.equal((await state('', 'client')).status, 401);
  assert.equal((await state('bad', 'client')).status, 401);
});

test('при первом входе создаётся профиль из данных регистрации', async () => {
  const v = await (await state('tok-client', 'client')).json();
  assert.equal(v.me.id, USERS['tok-client'].id);
  assert.equal(v.client.name, 'Анна Тестова'); assert.deepEqual(v.client.cars, []);
  assert.equal(v.orders.length, 0);
  const s = await (await state('tok-sto', 'sto')).json();
  assert.equal(s.sto.name, 'Гараж Тест');
});

test('аккаунт одной роли не открывает чужое приложение', async () => {
  const r = await state('tok-client', 'sto');
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /клиентки/);
});

test('роль диспетчера нельзя выдать себе при регистрации', async () => {
  assert.equal((await state('tok-fake-disp', 'dispatcher')).status, 401);
  assert.equal((await state('tok-disp', 'dispatcher')).status, 200);
});

test('заявка клиентки доходит до СТО, id участника берётся из токена', async () => {
  const r = await act('tok-client', 'client', 'order.create', { tags: ['Плановое ТО'] });
  assert.equal(r.ok, true);
  const s = await (await state('tok-sto', 'sto')).json();
  const o = s.orders.find((x) => x.id === r.result.orderId);
  assert.ok(o); assert.equal(o.phone, null);
  const bad = await act('tok-sto', 'sto', 'order.cancel', { orderId: o.id });
  assert.equal(bad.ok, false);
  const ev = await fetch(base + '/api/events', { headers: { Authorization: 'Bearer tok-client' } });
  assert.equal(ev.status, 401, 'журнал событий — только для сотрудников');
});
