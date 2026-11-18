-- RedMoviSim 2.13 · Tabla de sugerencias y comentarios (js/sugerencias.js)
-- Ejecutar una vez en Supabase → SQL Editor.
-- El juego solo puede INSERTAR: no hay regla de lectura, así que los mensajes
-- se leen únicamente desde el panel de Supabase (Table Editor → sugerencias).

create table if not exists public.sugerencias (
  id          bigint generated always as identity primary key,
  creado      timestamptz not null default now(),
  tipo        text not null check (tipo in ('sugerencia', 'error', 'comentario', 'felicitacion')),
  tema        text not null check (char_length(tema) <= 40),
  nota        smallint check (nota between 1 and 5),
  mensaje     text not null check (char_length(mensaje) between 10 and 2000),
  contacto    text check (char_length(contacto) <= 120),
  version     text check (char_length(version) <= 20),
  contexto    text check (char_length(contexto) <= 120),
  dispositivo text check (char_length(dispositivo) <= 300),
  user_id     uuid default auth.uid() references auth.users (id) on delete set null,
  leido       boolean not null default false
);

alter table public.sugerencias enable row level security;

-- Cualquiera (con o sin cuenta) puede enviar; con cuenta, solo a su propio nombre.
drop policy if exists "enviar sugerencias" on public.sugerencias;
create policy "enviar sugerencias" on public.sugerencias
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

revoke all on public.sugerencias from anon, authenticated;
grant insert (tipo, tema, nota, mensaje, contacto, version, contexto, dispositivo) on public.sugerencias to anon, authenticated;
