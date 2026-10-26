-- InroScan · esquema base
--
-- Rendiciones de caja chica y de memos de viáticos. La base es la verdad: la
-- hoja de Google y el PDF de cada versión se generan a partir de esto, nunca
-- al revés.
--
-- Las reglas de negocio que importan viven acá y no en la app: quién ve qué,
-- qué se puede editar en cada estado, cómo se avanza de estado y que nada se
-- borre. Así valen igual desde la app, desde el programa de la PC o desde
-- alguien que consulte Supabase directo.
--
-- Convención: auth.uid() nulo significa «el sistema» (el programa de la PC con
-- la clave service_role, o una migración). Las personas siempre traen uid.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type public.tipo_rendicion as enum ('caja', 'memo');

-- abierta → enviada → (observada → enviada)* → aprobada → repuesta | liquidada
-- La caja chica se REPONE; el memo se LIQUIDA (devolución o reembolso).
create type public.estado_rendicion as enum
  ('abierta', 'enviada', 'observada', 'aprobada', 'repuesta', 'liquidada');

create type public.estado_lectura as enum ('pendiente', 'procesando', 'leido', 'fallido');

create type public.via_lectura as enum ('ocr', 'clasificador', 'ia', 'manual');

-- ---------------------------------------------------------------------------
-- Catálogos: los lee cualquiera, los escribe solo administración. No se
-- borran: se desactivan, porque hay rendiciones viejas que los usan.
-- ---------------------------------------------------------------------------

create table public.empresas (
  id smallint generated always as identity primary key,
  nombre text not null check (nombre = btrim(nombre) and nombre <> ''),
  activo boolean not null default true
);

create table public.areas (
  id smallint generated always as identity primary key,
  nombre text not null check (nombre = btrim(nombre) and nombre <> ''),
  -- El orden de su código interno (IRP 00…15). No se muestra.
  orden smallint not null default 0,
  activo boolean not null default true
);

-- Centros de costo.
create table public.proyectos (
  id integer generated always as identity primary key,
  nombre text not null check (nombre = btrim(nombre) and nombre <> ''),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.tipos_comprobante (
  id text primary key check (id ~ '^[A-Z_]+$'),
  nombre text not null check (nombre = btrim(nombre) and nombre <> ''),
  -- Si suma al monto sustentado por defecto. La declaración jurada arranca en
  -- false: se archiva, pero no sustenta ante SUNAT. Cada rendición puede
  -- cambiarlo (rendiciones.no_sustentan).
  sustenta boolean not null default true,
  orden smallint not null default 0,
  activo boolean not null default true
);

-- Concepto → categoría y subcategoría por una tabla fija: la ruta no se
-- escribe a mano en cada gasto, que es lo que llenó los datos viejos de rutas
-- inconsistentes.
create table public.conceptos (
  id integer generated always as identity primary key,
  nombre text not null check (nombre = btrim(nombre) and nombre <> ''),
  categoria text not null check (categoria <> ''),
  subcategoria text not null check (subcategoria <> ''),
  origen text not null default 'administracion'
    check (origen in ('datos', 'propuesta', 'administracion')),
  activo boolean not null default true
);

-- «PAQ 02 CHINA CIVIL» y «paq 02 china civil» no pueden ser dos proyectos.
create unique index empresas_nombre_unico on public.empresas (upper(nombre));
create unique index areas_nombre_unico on public.areas (upper(nombre));
create unique index proyectos_nombre_unico on public.proyectos (upper(nombre));
create unique index tipos_nombre_unico on public.tipos_comprobante (upper(nombre));
create unique index conceptos_nombre_unico on public.conceptos (upper(nombre));

-- ---------------------------------------------------------------------------
-- Personas: una por cuenta de Google. Las crea un trigger al primer ingreso.
-- ---------------------------------------------------------------------------

create table public.personas (
  id uuid primary key references auth.users (id) on delete cascade,
  correo text not null unique
    check (correo = lower(correo) and correo like '%@inroprin.com'),
  nombre text not null default '',
  area_id smallint references public.areas (id),
  es_administracion boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Cajas chicas: el fondo fijo de un área. Su número no cambia nunca; cada
-- ciclo gastar → sustentar → reponer es una rendición con su correlativo.
-- ---------------------------------------------------------------------------

create table public.cajas (
  id integer generated always as identity primary key,
  numero text not null unique check (numero = btrim(numero) and numero <> ''),
  empresa_id smallint not null references public.empresas (id),
  area_id smallint not null references public.areas (id),
  administrador_id uuid not null references public.personas (id),
  monto_fondo numeric(12, 2) not null check (monto_fondo > 0),
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rendiciones: una reposición de caja chica o un memo de viáticos.
-- ---------------------------------------------------------------------------

create table public.rendiciones (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_rendicion not null,
  caja_id integer references public.cajas (id),
  correlativo integer check (correlativo > 0),
  numero_memo text,
  empresa_id smallint not null references public.empresas (id),
  fecha_solicitud date not null default current_date,
  -- Caja: su administrador. Memo: quien viajó.
  responsable_id uuid not null references public.personas (id),
  -- Caja: el fondo. Memo: lo recibido.
  monto numeric(12, 2) not null check (monto >= 0),
  estado public.estado_rendicion not null default 'abierta',
  -- Cuántas veces se envió. Cada envío genera una hoja y un PDF congelados.
  version integer not null default 0,
  -- Tipos de comprobante que no suman al sustento en ESTA rendición.
  no_sustentan text[],
  observacion text not null default '',
  enviada_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint caja_o_memo check (
    (tipo = 'caja' and caja_id is not null and numero_memo is null)
    or (tipo = 'memo' and caja_id is null and correlativo is null
        and numero_memo is not null and btrim(numero_memo) <> '')
  ),
  constraint cierre_segun_tipo check (
    not (tipo = 'caja' and estado = 'liquidada')
    and not (tipo = 'memo' and estado = 'repuesta')
  ),
  unique (caja_id, correlativo)
);

-- El mismo memo no puede rendirse dos veces, se escriba como se escriba.
create unique index rendiciones_memo_unico
  on public.rendiciones (empresa_id, upper(btrim(numero_memo)))
  where tipo = 'memo';

-- Una caja tiene un solo ciclo abierto a la vez.
create unique index una_reposicion_en_curso
  on public.rendiciones (caja_id)
  where tipo = 'caja' and estado in ('abierta', 'enviada', 'observada');

create index rendiciones_responsable on public.rendiciones (responsable_id);

-- ---------------------------------------------------------------------------
-- Archivos: cada imagen o PDF que se sube. Uno puede traer varios
-- comprobantes (dos boletas en una foto, un PDF de doce páginas).
-- ---------------------------------------------------------------------------

create table public.archivos (
  id uuid primary key default gen_random_uuid(),
  rendicion_id uuid not null references public.rendiciones (id),
  -- Lo genera el teléfono al capturar. Si la subida se reintenta sin señal,
  -- el mismo client_id choca acá en vez de duplicar el archivo.
  client_id uuid not null unique,
  -- Ruta dentro del bucket «comprobantes». Nula cuando ya se archivó en
  -- Drive y se borró de Supabase.
  ruta text,
  drive_id text,
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  tipo_mime text not null
    check (tipo_mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  tamano integer not null check (tamano > 0),
  estado_lectura public.estado_lectura not null default 'pendiente',
  procesando_desde timestamptz,
  intentos smallint not null default 0,
  error text,
  leido_en timestamptz,
  subido_por uuid references public.personas (id) default auth.uid(),
  creado_en timestamptz not null default now(),

  -- La misma foto dos veces en la misma rendición es un error de captura.
  unique (rendicion_id, huella),
  constraint guardado_en_algun_lado check (ruta is not null or drive_id is not null),
  constraint ruta_de_su_rendicion check (ruta is null or ruta like rendicion_id::text || '/%')
);

create index archivos_pendientes on public.archivos (creado_en)
  where estado_lectura in ('pendiente', 'procesando');

-- ---------------------------------------------------------------------------
-- Comprobantes: una fila de la rendición. Las cuatro primeras columnas de la
-- hoja (N° de caja, fecha de solicitud, empresa, administrador) salen de la
-- rendición; el resto vive acá.
-- ---------------------------------------------------------------------------

create table public.comprobantes (
  id uuid primary key default gen_random_uuid(),
  rendicion_id uuid not null references public.rendiciones (id),
  -- Nulo si se cargó a mano sin imagen.
  archivo_id uuid references public.archivos (id),
  pagina smallint not null default 1 check (pagina > 0),
  -- Los que nacen en el teléfono lo traen; los que separa el procesador, no.
  client_id uuid unique,

  fecha date,
  tipo_comprobante_id text references public.tipos_comprobante (id),
  serie text not null default '',
  numero text not null default '',
  ruc text not null default '' check (ruc = '' or ruc ~ '^(10|15|17|20)[0-9]{9}$'),
  proveedor text not null default '',
  proyecto_id integer references public.proyectos (id),
  area_id smallint references public.areas (id),
  solicitante text not null default '',
  concepto_id integer references public.conceptos (id),
  descripcion text not null default '',
  -- Nulo hasta que se lea o se escriba. Una nota de crédito va en negativo.
  total numeric(12, 2),
  moneda text not null default 'PEN' check (moneda in ('PEN', 'USD')),

  -- Identidad del comprobante para encontrar repetidos: F001-6384 y
  -- F001-006384 son el mismo papel, y 002-001175 se teclea igual de fácil
  -- como 2-1175. La misma regla que clave() en procesador/…/reglas.py.
  clave text generated always as (
    regexp_replace(upper(regexp_replace(serie, '[^A-Za-z0-9]', '', 'g')), '^0+(?=.)', '') || '-' ||
    regexp_replace(upper(regexp_replace(numero, '[^A-Za-z0-9]', '', 'g')), '^0+(?=.)', '')
  ) stored,

  via public.via_lectura,
  -- Lo que dejó el procesador: confianza por campo, campos que faltaron, etc.
  confianza jsonb not null default '{}',
  descartado boolean not null default false,
  motivo_descarte text not null default '',
  -- La escribe administración al validar.
  observacion text not null default '',
  creado_por uuid references public.personas (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index comprobantes_rendicion on public.comprobantes (rendicion_id);
create index comprobantes_clave on public.comprobantes (ruc, clave) where not descartado;

-- ---------------------------------------------------------------------------
-- Versiones: lo que se generó en cada envío. Las escribe el procesador.
-- ---------------------------------------------------------------------------

create table public.versiones (
  id uuid primary key default gen_random_uuid(),
  rendicion_id uuid not null references public.rendiciones (id),
  numero integer not null check (numero > 0),
  hoja_id text,
  pdf_drive_id text,
  total numeric(12, 2) not null,
  sustentado numeric(12, 2) not null,
  -- Foto completa de lo enviado: aunque después se corrija, esto no cambia.
  datos jsonb not null,
  generado_en timestamptz not null default now(),
  unique (rendicion_id, numero)
);

-- ---------------------------------------------------------------------------
-- Historial: quién cambió qué y cuándo. Lo llena un trigger; nadie lo escribe
-- ni lo borra a mano.
-- ---------------------------------------------------------------------------

create table public.historial (
  id bigint generated always as identity primary key,
  rendicion_id uuid not null,
  tabla text not null,
  fila uuid not null,
  accion text not null check (accion in ('crear', 'cambiar')),
  -- crear: la fila completa. cambiar: { campo: { antes, despues } }.
  cambios jsonb not null,
  -- Nulo: el sistema (programa de la PC o migración).
  actor uuid,
  en timestamptz not null default now()
);

create index historial_rendicion on public.historial (rendicion_id, en);

-- ---------------------------------------------------------------------------
-- Estado del programa de la PC, para poder decir «corrió hace 3 h».
-- ---------------------------------------------------------------------------

create table public.procesador_estado (
  id smallint primary key default 1 check (id = 1),
  ultima_corrida timestamptz,
  version text,
  detalle jsonb not null default '{}'
);

-- Ejemplos para entrenar el clasificador de concepto. Tienen nombres de
-- personas y destinos: solo los ve administración. Se cargan fuera del repo.
create table public.ejemplos_concepto (
  id bigint generated always as identity primary key,
  descripcion text not null,
  concepto_id integer not null references public.conceptos (id),
  fuente text not null check (fuente in ('historico', 'aprobado')),
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Quién es quién. SECURITY DEFINER para poder consultarse desde las
-- políticas de las mismas tablas sin entrar en recursión.
-- ---------------------------------------------------------------------------

create function public.persona_activa() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.personas p where p.id = auth.uid() and p.activo)
$$;

create function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.personas p
    where p.id = auth.uid() and p.activo and p.es_administracion)
$$;

create function public.puede_ver(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.es_admin() or exists (
    select 1 from public.rendiciones r
    where r.id = rid and r.responsable_id = auth.uid() and public.persona_activa())
$$;

-- El responsable edita mientras la rendición está abierta u observada.
-- Administración además puede corregir mientras la valida (enviada).
-- Aprobada en adelante, nadie: lo aprobado es lo que se pagó.
create function public.puede_editar(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rendiciones r
    where r.id = rid and (
      (r.responsable_id = auth.uid() and public.persona_activa()
        and r.estado in ('abierta', 'observada'))
      or (public.es_admin() and r.estado in ('abierta', 'enviada', 'observada'))))
$$;

-- ---------------------------------------------------------------------------
-- Alta de personas: al primer ingreso con Google. Rechaza cualquier correo
-- que no sea del dominio, además de que la app de Google ya es interna.
-- ---------------------------------------------------------------------------

create function public.alta_de_persona() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or lower(new.email) not like '%@inroprin.com' then
    raise exception 'InroScan es solo para cuentas @inroprin.com.';
  end if;
  insert into public.personas (id, correo, nombre)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger alta_de_persona
  after insert on auth.users
  for each row execute function public.alta_de_persona();

-- ---------------------------------------------------------------------------
-- Rendiciones: lo que se completa solo al crear.
-- ---------------------------------------------------------------------------

create function public.rendicion_al_crear() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.cajas;
begin
  if new.tipo = 'caja' then
    select * into c from public.cajas where id = new.caja_id;
    if not found or not c.activa then
      raise exception 'La caja % no existe o está inactiva.', new.caja_id;
    end if;
    -- Lo de la caja no lo decide quien crea la reposición: sale de la caja.
    new.empresa_id := c.empresa_id;
    new.responsable_id := c.administrador_id;
    new.monto := c.monto_fondo;
    new.correlativo := coalesce(
      (select max(r.correlativo) from public.rendiciones r where r.caja_id = new.caja_id), 0) + 1;
  else
    new.numero_memo := upper(btrim(new.numero_memo));
  end if;

  if new.no_sustentan is null then
    new.no_sustentan := coalesce(
      (select array_agg(t.id order by t.orden) from public.tipos_comprobante t where not t.sustenta),
      '{}');
  end if;

  -- Toda rendición nace abierta, sin envíos ni observaciones.
  new.estado := 'abierta';
  new.version := 0;
  new.enviada_en := null;
  if auth.uid() is not null and not public.es_admin() then
    new.observacion := '';
  end if;
  return new;
end $$;

create trigger rendicion_al_crear
  before insert on public.rendiciones
  for each row execute function public.rendicion_al_crear();

-- ---------------------------------------------------------------------------
-- Rendiciones: qué puede cambiar cada uno, y cómo se avanza de estado.
-- ---------------------------------------------------------------------------

create function public.rendicion_al_cambiar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  admin boolean := public.es_admin();
  suyo boolean := old.responsable_id = auth.uid();
  cierre public.estado_rendicion :=
    case old.tipo when 'caja' then 'repuesta'::public.estado_rendicion
                  else 'liquidada'::public.estado_rendicion end;
begin
  new.actualizado_en := now();
  if auth.uid() is null then
    return new;  -- el sistema
  end if;

  if new.tipo <> old.tipo or new.caja_id is distinct from old.caja_id
     or new.correlativo is distinct from old.correlativo
     or new.empresa_id <> old.empresa_id or new.creado_en <> old.creado_en then
    raise exception 'Tipo, caja, correlativo y empresa de una rendición no se cambian.';
  end if;
  if new.responsable_id <> old.responsable_id and not admin then
    raise exception 'Solo administración cambia el responsable.';
  end if;
  if new.observacion <> old.observacion and not admin then
    raise exception 'Las observaciones las escribe administración.';
  end if;
  if new.tipo = 'caja' and new.monto <> old.monto and not admin then
    raise exception 'El monto de una reposición es el del fondo de la caja.';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado in ('abierta', 'observada') and new.estado = 'enviada' and (suyo or admin) then
      new.version := old.version + 1;
      new.enviada_en := now();
      return new;
    elsif admin and old.estado = 'enviada' and new.estado in ('observada', 'aprobada') then
      null;
    elsif admin and old.estado = 'aprobada' and new.estado = cierre then
      null;
    else
      raise exception 'Una rendición % no puede pasar a %.', old.estado, new.estado;
    end if;
  elsif old.estado not in ('abierta', 'observada')
        and not (admin and old.estado = 'enviada') then
    raise exception 'La rendición está %: ya no se edita.', old.estado;
  end if;

  -- La versión y la fecha de envío solo las mueve el envío.
  new.version := old.version;
  new.enviada_en := old.enviada_en;
  return new;
end $$;

create trigger rendicion_al_cambiar
  before update on public.rendiciones
  for each row execute function public.rendicion_al_cambiar();

-- ---------------------------------------------------------------------------
-- Archivos y comprobantes: lo que la persona no puede tocar.
-- ---------------------------------------------------------------------------

create function public.archivo_al_crear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    -- Lo que sube una persona entra siempre igual: pendiente de leer, a su
    -- nombre y todavía solo en Supabase.
    new.subido_por := auth.uid();
    new.estado_lectura := 'pendiente';
    new.procesando_desde := null;
    new.intentos := 0;
    new.error := null;
    new.leido_en := null;
    new.drive_id := null;
  end if;
  return new;
end $$;

create trigger archivo_al_crear
  before insert on public.archivos
  for each row execute function public.archivo_al_crear();

create function public.comprobante_al_guardar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rendicion_del_archivo uuid;
begin
  if new.archivo_id is not null then
    select a.rendicion_id into rendicion_del_archivo from public.archivos a where a.id = new.archivo_id;
    if rendicion_del_archivo is distinct from new.rendicion_id then
      raise exception 'El comprobante y su imagen tienen que ser de la misma rendición.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.actualizado_en := now();
  end if;
  if auth.uid() is null then
    return new;  -- el sistema
  end if;

  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    if not public.es_admin() then
      new.observacion := '';
    end if;
    new.descartado := false;
    new.motivo_descarte := '';
  else
    if new.rendicion_id <> old.rendicion_id or new.archivo_id is distinct from old.archivo_id
       or new.pagina <> old.pagina or new.client_id is distinct from old.client_id
       or new.creado_por is distinct from old.creado_por or new.creado_en <> old.creado_en then
      raise exception 'Rendición, imagen y autor de un comprobante no se cambian.';
    end if;
    if new.observacion <> old.observacion and not public.es_admin() then
      raise exception 'Las observaciones las escribe administración.';
    end if;
    if new.via is distinct from old.via or new.confianza <> old.confianza then
      raise exception 'Cómo se leyó lo anota el procesador.';
    end if;
  end if;
  return new;
end $$;

create trigger comprobante_al_guardar
  before insert or update on public.comprobantes
  for each row execute function public.comprobante_al_guardar();

-- ---------------------------------------------------------------------------
-- Historial.
-- ---------------------------------------------------------------------------

create function public.anotar_historial() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  nuevo jsonb := to_jsonb(new);
  viejo jsonb;
  cambios jsonb := '{}';
  campo text;
begin
  if tg_op = 'INSERT' then
    cambios := nuevo - 'creado_en' - 'actualizado_en';
  else
    viejo := to_jsonb(old);
    for campo in select jsonb_object_keys(nuevo) loop
      if campo <> 'actualizado_en' and (viejo -> campo) is distinct from (nuevo -> campo) then
        cambios := cambios || jsonb_build_object(
          campo, jsonb_build_object('antes', viejo -> campo, 'despues', nuevo -> campo));
      end if;
    end loop;
    if cambios = '{}' then
      return null;
    end if;
  end if;

  insert into public.historial (rendicion_id, tabla, fila, accion, cambios, actor)
  values (
    case tg_table_name when 'rendiciones' then (nuevo ->> 'id')::uuid
                       else (nuevo ->> 'rendicion_id')::uuid end,
    tg_table_name,
    (nuevo ->> 'id')::uuid,
    case tg_op when 'INSERT' then 'crear' else 'cambiar' end,
    cambios,
    auth.uid());
  return null;
end $$;

create trigger historial after insert or update on public.rendiciones
  for each row execute function public.anotar_historial();
create trigger historial after insert or update on public.archivos
  for each row execute function public.anotar_historial();
create trigger historial after insert or update on public.comprobantes
  for each row execute function public.anotar_historial();

-- ---------------------------------------------------------------------------
-- Para el programa de la PC: tomar trabajo sin que dos corridas agarren lo
-- mismo. Lo «procesando» de más de 30 minutos se da por abandonado (la PC se
-- apagó a mitad) y se vuelve a tomar.
-- ---------------------------------------------------------------------------

create function public.tomar_pendientes(cuantos integer default 10)
returns setof public.archivos
language sql volatile security definer set search_path = '' as $$
  update public.archivos a
     set estado_lectura = 'procesando',
         procesando_desde = now(),
         intentos = a.intentos + 1
   where a.id in (
     select x.id from public.archivos x
      where x.ruta is not null
        and (x.estado_lectura = 'pendiente'
             or (x.estado_lectura = 'procesando' and x.procesando_desde < now() - interval '30 minutes'))
      order by x.creado_en
      for update skip locked
      limit cuantos)
  returning a.*
$$;

-- ---------------------------------------------------------------------------
-- Comprobantes repetidos: el mismo RUC + número en otra rendición. Con
-- security_invoker cada uno ve los repetidos dentro de lo que puede ver;
-- administración los ve todos.
-- ---------------------------------------------------------------------------

create view public.comprobantes_repetidos with (security_invoker = true) as
  select c.id, c.rendicion_id, c.ruc, c.clave, c.total,
         otro.id as repetido_id, otro.rendicion_id as repetido_en
    from public.comprobantes c
    join public.comprobantes otro
      on otro.ruc = c.ruc and otro.clave = c.clave
     and otro.id <> c.id and otro.rendicion_id <> c.rendicion_id
   where not c.descartado and not otro.descartado
     and c.ruc <> '' and c.numero <> '';

-- ---------------------------------------------------------------------------
-- Permisos por fila
-- ---------------------------------------------------------------------------

alter table public.empresas enable row level security;
alter table public.areas enable row level security;
alter table public.proyectos enable row level security;
alter table public.tipos_comprobante enable row level security;
alter table public.conceptos enable row level security;
alter table public.personas enable row level security;
alter table public.cajas enable row level security;
alter table public.rendiciones enable row level security;
alter table public.archivos enable row level security;
alter table public.comprobantes enable row level security;
alter table public.versiones enable row level security;
alter table public.historial enable row level security;
alter table public.procesador_estado enable row level security;
alter table public.ejemplos_concepto enable row level security;

-- Catálogos
do $$
declare
  t text;
begin
  foreach t in array array['empresas', 'areas', 'proyectos', 'tipos_comprobante', 'conceptos'] loop
    execute format('create policy leer on public.%I for select to authenticated using (public.persona_activa())', t);
    execute format('create policy crear on public.%I for insert to authenticated with check (public.es_admin())', t);
    execute format('create policy cambiar on public.%I for update to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- Personas: cada uno se ve a sí mismo; administración ve y gestiona a todos.
create policy leer on public.personas for select to authenticated
  using (id = auth.uid() or public.es_admin());
create policy cambiar on public.personas for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Cajas: su administrador la ve; administración las crea y gestiona.
create policy leer on public.cajas for select to authenticated
  using ((administrador_id = auth.uid() and public.persona_activa()) or public.es_admin());
create policy crear on public.cajas for insert to authenticated with check (public.es_admin());
create policy cambiar on public.cajas for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Rendiciones. Las políticas miran las columnas de la fila y no llaman a
-- puede_ver(id): esa función busca la rendición en la foto de la base de
-- antes de la sentencia, donde una fila recién insertada todavía no existe,
-- y entonces INSERT … RETURNING (lo que hace supabase-js siempre) fallaba.
create policy leer on public.rendiciones for select to authenticated
  using ((responsable_id = auth.uid() and public.persona_activa()) or public.es_admin());
-- Un memo es de quien lo crea. Una reposición, del administrador de la caja.
create policy crear on public.rendiciones for insert to authenticated
  with check (
    public.persona_activa() and (
      public.es_admin()
      or (tipo = 'memo' and responsable_id = auth.uid())
      or (tipo = 'caja' and responsable_id = auth.uid())));
create policy cambiar on public.rendiciones for update to authenticated
  using ((responsable_id = auth.uid() and public.persona_activa()) or public.es_admin())
  with check ((responsable_id = auth.uid() and public.persona_activa()) or public.es_admin());

-- Archivos: se suben y se ven; lo demás lo hace el procesador.
create policy leer on public.archivos for select to authenticated
  using (public.puede_ver(rendicion_id));
create policy crear on public.archivos for insert to authenticated
  with check (public.puede_editar(rendicion_id));

-- Comprobantes
create policy leer on public.comprobantes for select to authenticated
  using (public.puede_ver(rendicion_id));
create policy crear on public.comprobantes for insert to authenticated
  with check (public.puede_editar(rendicion_id));
create policy cambiar on public.comprobantes for update to authenticated
  using (public.puede_editar(rendicion_id)) with check (public.puede_editar(rendicion_id));

-- Lo que solo se lee
create policy leer on public.versiones for select to authenticated
  using (public.puede_ver(rendicion_id));
create policy leer on public.historial for select to authenticated
  using (public.puede_ver(rendicion_id));
create policy leer on public.procesador_estado for select to authenticated
  using (public.persona_activa());
create policy leer on public.ejemplos_concepto for select to authenticated
  using (public.es_admin());

-- ---------------------------------------------------------------------------
-- Privilegios. Sin DELETE para nadie salvo el sistema: descartar es una
-- marca, no un borrado. anon no ve nada.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

grant select on all tables in schema public to authenticated;
grant insert, update on public.empresas, public.areas, public.proyectos,
  public.tipos_comprobante, public.conceptos, public.cajas,
  public.rendiciones, public.comprobantes to authenticated;
grant update on public.personas to authenticated;
grant insert on public.archivos to authenticated;

grant all on all tables in schema public to service_role;

revoke all on function public.persona_activa(), public.es_admin(), public.puede_ver(uuid),
  public.puede_editar(uuid), public.tomar_pendientes(integer) from public, anon;
grant execute on function public.persona_activa(), public.es_admin(), public.puede_ver(uuid),
  public.puede_editar(uuid) to authenticated;
grant execute on function public.tomar_pendientes(integer) to service_role;

-- Las funciones de trigger no se llaman a mano.
revoke all on function public.alta_de_persona(), public.rendicion_al_crear(),
  public.rendicion_al_cambiar(), public.archivo_al_crear(),
  public.comprobante_al_guardar(), public.anotar_historial() from public, anon, authenticated;
