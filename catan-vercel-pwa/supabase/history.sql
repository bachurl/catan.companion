-- Historial de partidas ("Mis partidas").
-- Correr en el SQL Editor del proyecto Supabase, después de schema.sql.
--
-- Identidad sin login: la sesión anónima de Supabase (auth.uid()) identifica
-- al dispositivo y persiste entre recargas. El nombre visible lo elige el
-- usuario y vive en `profiles`. Si más adelante se agrega login real, se
-- linkea el mismo uid y no hay que migrar nada.
--
-- Quién escribe: el dueño de la partida (`owner_id`) es el dispositivo que la
-- creó (host de la sala, o el propio celular en partidas locales). Los demás
-- se registran en `game_participants` para que la partida les aparezca en su
-- lista. Así no hay dos dispositivos escribiendo la misma fila.

-- ── Perfil (sin login) ──
create table if not exists public.profiles (
  user_id uuid primary key,                 -- auth.uid() de la sesión anónima
  display_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ── Partida ──
-- El id lo genera el cliente: es el uid de la acción que creó la partida, así
-- guardar dos veces la misma partida (autosave + fin) es idempotente.
create table if not exists public.games (
  id text primary key,
  owner_id uuid not null,
  room_code text,                           -- null en partidas locales
  mode text not null default 'full',        -- full | simple
  expansion boolean not null default false,
  player_count int not null default 0,
  status text not null default 'playing',   -- lobby | playing | finished
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  turns int,
  roll_count int,
  dice_totals jsonb not null default '{}'::jsonb,
  winner_index int,
  winner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists games_owner_updated on public.games (owner_id, updated_at desc);

-- ── Jugadores de la partida (una fila por asiento) ──
create table if not exists public.game_players (
  game_id text not null references public.games(id) on delete cascade,
  player_index int not null,
  name text,
  color_index int,
  user_id uuid,                             -- dispositivo que controló el asiento
  vp int,
  vp_base int,
  settlements int,
  cities int,
  roads_built int,
  knights int,
  dev_cards int,
  longest_road boolean not null default false,
  largest_army boolean not null default false,
  primary key (game_id, player_index)
);

-- ── Dispositivos que jugaron la partida (para "Mis partidas") ──
create table if not exists public.game_participants (
  game_id text not null references public.games(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index if not exists game_participants_user on public.game_participants (user_id);

-- ── Tiradas ──
create table if not exists public.game_rolls (
  game_id text not null references public.games(id) on delete cascade,
  seq int not null,
  d1 int, d2 int,
  total int not null,
  player_index int,
  manual boolean not null default false,
  rolled_at timestamptz,
  primary key (game_id, seq)
);
create index if not exists game_rolls_game on public.game_rolls (game_id, total);

-- ── RLS ──
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_participants enable row level security;
alter table public.game_rolls enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for insert to authenticated with check (user_id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (user_id = auth.uid());

-- Lectura: solo las partidas propias o en las que participó este dispositivo.
drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated using (
  owner_id = auth.uid()
  or exists (select 1 from public.game_participants p where p.game_id = games.id and p.user_id = auth.uid())
);
drop policy if exists games_insert on public.games;
create policy games_insert on public.games for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists games_update on public.games;
create policy games_update on public.games for update to authenticated using (owner_id = auth.uid());

-- Las tablas hijas siguen al dueño de la partida.
drop policy if exists game_players_select on public.game_players;
create policy game_players_select on public.game_players for select to authenticated using (
  exists (select 1 from public.games g where g.id = game_players.game_id)
);
drop policy if exists game_players_write on public.game_players;
create policy game_players_write on public.game_players for insert to authenticated with check (
  exists (select 1 from public.games g where g.id = game_players.game_id and g.owner_id = auth.uid())
);
drop policy if exists game_players_update on public.game_players;
create policy game_players_update on public.game_players for update to authenticated using (
  exists (select 1 from public.games g where g.id = game_players.game_id and g.owner_id = auth.uid())
);

drop policy if exists game_rolls_select on public.game_rolls;
create policy game_rolls_select on public.game_rolls for select to authenticated using (
  exists (select 1 from public.games g where g.id = game_rolls.game_id)
);
drop policy if exists game_rolls_write on public.game_rolls;
create policy game_rolls_write on public.game_rolls for insert to authenticated with check (
  exists (select 1 from public.games g where g.id = game_rolls.game_id and g.owner_id = auth.uid())
);
drop policy if exists game_rolls_update on public.game_rolls;
create policy game_rolls_update on public.game_rolls for update to authenticated using (
  exists (select 1 from public.games g where g.id = game_rolls.game_id and g.owner_id = auth.uid())
);

-- Cada dispositivo se registra a sí mismo como participante.
drop policy if exists game_participants_select on public.game_participants;
create policy game_participants_select on public.game_participants for select to authenticated using (true);
drop policy if exists game_participants_write on public.game_participants;
create policy game_participants_write on public.game_participants for insert to authenticated with check (user_id = auth.uid());
