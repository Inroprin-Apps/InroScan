-- La hoja y el PDF de cada versión, y el archivo de las imágenes, en la
-- unidad compartida de Drive. Lo hace la función «drive» con una cuenta de
-- administración conectada una vez; acá solo se guarda lo que necesita.

-- La conexión con Google (el token de larga duración, la cuenta, la unidad).
-- Sin políticas ni permisos: solo la lee y escribe el sistema (service_role).
create table public.integraciones (
  clave text primary key,
  datos jsonb not null,
  actualizado_en timestamptz not null default now()
);
alter table public.integraciones enable row level security;
revoke all on public.integraciones from public, anon, authenticated;
grant all on public.integraciones to service_role;

-- Dónde vive en Drive cada rendición.
alter table public.rendiciones add column drive_carpeta_id text;

-- La huella MD5 que devolvió Drive al copiar la imagen: se vuelve a comparar
-- antes de borrarla de Supabase, para no borrar nada que Drive no tenga.
alter table public.archivos add column drive_md5 text;

-- Lo que escribe el sistema no lo cambia una persona.
create function public.columnas_del_sistema() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.drive_carpeta_id := old.drive_carpeta_id;
  end if;
  return new;
end $$;

create trigger columnas_del_sistema
  before update on public.rendiciones
  for each row execute function public.columnas_del_sistema();

revoke all on function public.columnas_del_sistema() from public, anon, authenticated;
