-- «Мой автомеханик» — таблицы в Supabase.
-- Выполните один раз: Supabase Dashboard → SQL Editor → New query → вставьте этот файл → Run.
--
-- Сервер экосистемы хранит здесь снимок состояния (все заказы, профили, споры) и журнал действий.
-- Приложения к этим таблицам напрямую не обращаются: доступ есть только у сервера по секретному ключу.

create table if not exists public.app_state (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id      bigserial primary key,
  ts      bigint not null,          -- время в миллисекундах
  role    text,                     -- client / sto / concierge / dispatcher / director
  actor   text,                     -- id пользователя Supabase
  type    text not null,            -- действие, например order.create
  payload jsonb
);
create index if not exists events_ts_idx on public.events (ts desc);

-- RLS включён, политик нет: анонимный и обычный пользователь не прочитают и не изменят эти таблицы.
-- Секретный ключ сервера (service_role / sb_secret_…) обходит RLS.
alter table public.app_state enable row level security;
alter table public.events    enable row level security;
revoke all on public.app_state from anon, authenticated;
revoke all on public.events    from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Сотрудники платформы. Диспетчер и директор не регистрируются сами:
-- человек регистрируется в панели диспетчера (или его приглашают: Authentication → Users → Invite),
-- затем администратор выдаёт роль (подставьте email):
--
--   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"dispatcher"}'
--   where email = 'dispatcher@example.com';
--
--   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"director"}'
--   where email = 'director@example.com';
--
-- Роль из app_metadata пользователь изменить не может, в отличие от данных регистрации (user_metadata).
-- ---------------------------------------------------------------------------
