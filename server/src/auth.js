// Вход через Supabase Auth.
// Приложение получает токен (access_token) в Supabase и передаёт его серверу.
// Сервер проверяет токен запросом GET /auth/v1/user и узнаёт пользователя и его роль:
//   • client / sto / concierge — выбирается при регистрации (user_metadata.role);
//   • dispatcher / director — только вручную, через app_metadata.role (см. supabase/schema.sql).
// Без SUPABASE_URL сервер не пускает никого, кроме режима разработки AUTH_DISABLED=1.

export const SELF_ROLES = ['client', 'sto', 'concierge'];
export const ALL_ROLES = [...SELF_ROLES, 'dispatcher', 'director'];

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const DISABLED = process.env.AUTH_DISABLED === '1';

export const authConfig = {
  enabled: !!(URL_ && ANON),
  disabled: DISABLED,
  // эти значения публичные — их и так видит любой браузер
  public: { supabaseUrl: URL_, supabaseKey: ANON }
};

export class AuthError extends Error {}

const cache = new Map(); // token → { who, meta, exp }
const CACHE_MS = 60 * 1000;

function roleOf(user) {
  const app = (user.app_metadata && user.app_metadata.role) || '';
  if (ALL_ROLES.includes(app)) return app;
  const self = (user.user_metadata && user.user_metadata.role) || '';
  return SELF_ROLES.includes(self) ? self : 'client';
}

// → { who: { role, id }, meta: { name, phone, email, ... } }
export async function verify(token, wantRole) {
  if (DISABLED) {
    // режим разработки: токен вида "dev:<role>:<id>:<имя>"
    const [, role, id, name] = String(token || '').split(':');
    if (!ALL_ROLES.includes(role) || !id) throw new AuthError('Войдите в аккаунт');
    return check({ who: { role, id }, meta: { name: name || id } }, wantRole);
  }
  if (!authConfig.enabled) throw new AuthError('Сервер не настроен: укажите SUPABASE_URL и SUPABASE_ANON_KEY');
  if (!token) throw new AuthError('Войдите в аккаунт');

  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return check(hit, wantRole);

  let r;
  try {
    r = await fetch(URL_ + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
  } catch (e) {
    throw new AuthError('Нет связи с сервисом входа');
  }
  if (r.status === 401 || r.status === 403) throw new AuthError('Сессия истекла, войдите снова');
  if (!r.ok) throw new AuthError('Сервис входа недоступен (' + r.status + ')');
  const u = await r.json();
  const m = u.user_metadata || {};
  const res = {
    who: { role: roleOf(u), id: u.id },
    meta: { name: m.name, phone: m.phone || u.phone, email: u.email, address: m.address, stoName: m.stoName, car: m.car, hint: m.hint },
    exp: Date.now() + CACHE_MS
  };
  cache.set(token, res);
  if (cache.size > 5000) for (const [k, v] of cache) if (v.exp < Date.now()) cache.delete(k);
  return check(res, wantRole);
}

const ROLE_NAME = { client: 'клиентки', sto: 'СТО', concierge: 'консьержа', dispatcher: 'диспетчера', director: 'директора' };

function check(res, wantRole) {
  if (!wantRole) return res;
  const ok = res.who.role === wantRole
    || (wantRole === 'dispatcher' && res.who.role === 'director')
    || (wantRole === 'director' && res.who.role === 'dispatcher');
  if (!ok) throw new AuthError(`Этот аккаунт зарегистрирован как аккаунт ${ROLE_NAME[res.who.role]}. Откройте своё приложение или войдите другим аккаунтом.`);
  // в панели диспетчера директор и диспетчер работают под своей настоящей ролью
  return res;
}
