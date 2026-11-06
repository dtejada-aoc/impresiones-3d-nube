-- =====================================================================
-- Impresiones 3D — estructura de la base de datos en Supabase.
-- Se ejecuta una vez en Supabase: SQL Editor → New query → pegar → Run.
-- Se puede volver a ejecutar sin perder datos (solo crea lo que falte).
--
-- Cada fila pertenece a un usuario (propietario) y las reglas de seguridad
-- (RLS) hacen que cada usuario solo pueda ver y cambiar sus propios datos.
-- Los datos de cada impresión, catálogo o registro se guardan en JSON,
-- igual que los ficheros de la carpeta data/ de la versión de escritorio.
-- =====================================================================

-- Impresiones: una fila por impresión (datos = el antiguo datos.json)
create table if not exists public.impresiones (
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,120}$'),
  datos       jsonb not null default '{}'::jsonb,
  fotos       text[] not null default '{}',
  publico     boolean not null default false,   -- reservado para una futura galería pública
  actualizado timestamptz not null default now(),
  primary key (propietario, id)
);

-- Catálogos (máquinas, accesorios…) y registros (filamentos, gastos, ventas): una fila por lista
create table if not exists public.listas (
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo        text not null check (tipo in ('catalogos', 'registros')),
  lista       text not null,
  elementos   jsonb not null default '[]'::jsonb check (jsonb_typeof(elementos) = 'array'),
  actualizado timestamptz not null default now(),
  primary key (propietario, tipo, lista)
);

-- Configuración general
create table if not exists public.ajustes (
  propietario uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  datos       jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);

-- Papelera: impresiones borradas y versiones anteriores de las listas
create table if not exists public.papelera (
  propietario uuid not null default auth.uid() references auth.users (id) on delete cascade,
  num         bigint generated always as identity,
  ruta        text not null,
  datos       jsonb not null,
  fecha       timestamptz not null default now(),
  primary key (propietario, num)
);

-- Fecha de última modificación automática
create or replace function public.tocar_actualizado() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.actualizado := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['impresiones', 'listas', 'ajustes'] loop
    execute format('drop trigger if exists tocar_actualizado on public.%I', t);
    execute format('create trigger tocar_actualizado before update on public.%I
                    for each row execute function public.tocar_actualizado()', t);
  end loop;
end $$;

-- Seguridad: cada usuario solo ve y cambia sus filas
do $$
declare t text;
begin
  foreach t in array array['impresiones', 'listas', 'ajustes', 'papelera'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "solo el propietario" on public.%I', t);
    execute format('create policy "solo el propietario" on public.%I for all to authenticated
                    using (propietario = (select auth.uid()))
                    with check (propietario = (select auth.uid()))', t);
  end loop;
end $$;

-- Sin acceso para quien no ha iniciado sesión
revoke all on public.impresiones, public.listas, public.ajustes, public.papelera from anon;

-- Fotos: almacenamiento privado; cada usuario solo accede a su carpeta (<id de usuario>/...)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "fotos: ver las propias" on storage.objects;
drop policy if exists "fotos: subir a la carpeta propia" on storage.objects;
drop policy if exists "fotos: cambiar las propias" on storage.objects;
drop policy if exists "fotos: borrar las propias" on storage.objects;

create policy "fotos: ver las propias" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotos: subir a la carpeta propia" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotos: cambiar las propias" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fotos: borrar las propias" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
