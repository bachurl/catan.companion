-- Esquema para multijugador online (PLAN.md Fase B).
-- Correr en el SQL Editor del proyecto Supabase (una sola vez).
--
-- Modelo: cada sala tiene un log de acciones append-only. El orden canónico
-- es el id autoincremental. Los clientes replayean el log con el mismo
-- reducer que usan offline.

-- ── Salas ──
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                -- código corto para unirse (ej: "TRIGO4")
  host_id uuid not null,                    -- auth.uid() del creador
  status text not null default 'playing',   -- playing | finished
  created_at timestamptz not null default now()
);

-- ── Log de acciones por sala ──
create table if not exists public.room_actions (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  author_id uuid not null,
  uid text not null,                        -- id generado por el cliente (dedupe)
  action jsonb not null,
  created_at timestamptz not null default now(),
  unique (room_id, uid)
);

create index if not exists room_actions_room_id_id on public.room_actions (room_id, id);

-- ── Miembros: qué usuario controla qué jugador ──
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  player_index int,                         -- null = espectador
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- ── RLS ──
-- v1: cualquier usuario autenticado (anon auth) puede leer/escribir salas en
-- las que participa; el código de sala es el secreto de acceso.
alter table public.rooms enable row level security;
alter table public.room_actions enable row level security;
alter table public.room_members enable row level security;

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated using (true);

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms
  for insert to authenticated with check (host_id = auth.uid());

drop policy if exists rooms_update_host on public.rooms;
create policy rooms_update_host on public.rooms
  for update to authenticated using (host_id = auth.uid());

drop policy if exists room_actions_select on public.room_actions;
create policy room_actions_select on public.room_actions
  for select to authenticated using (true);

drop policy if exists room_actions_insert on public.room_actions;
create policy room_actions_insert on public.room_actions
  for insert to authenticated with check (author_id = auth.uid());

drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
  for select to authenticated using (true);

drop policy if exists room_members_upsert on public.room_members;
create policy room_members_upsert on public.room_members
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists room_members_update on public.room_members;
create policy room_members_update on public.room_members
  for update to authenticated using (user_id = auth.uid());

-- ── Realtime ──
-- Publica los INSERT de room_actions y cambios de room_members.
do $$
begin
  alter publication supabase_realtime add table public.room_actions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.room_members;
exception when duplicate_object then null;
end $$;

-- Nota: habilitar "Anonymous sign-ins" en Authentication → Providers.
