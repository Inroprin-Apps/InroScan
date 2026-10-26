-- InroScan · ajustes que pidió el Supabase real
--
-- Los avisos de seguridad y rendimiento de Supabase, corridos después de
-- aplicar las tres primeras migraciones, encontraron lo que un Postgres común
-- no muestra.

-- ---------------------------------------------------------------------------
-- 1. Funciones que nadie con sesión debe poder llamar.
--
-- Supabase concede EXECUTE a anon y authenticated en cada función nueva de
-- public, además del PUBLIC de siempre. La migración del esquema le quitó el
-- permiso a public y a anon, pero no a authenticated: cualquier persona con
-- sesión podía llamar a tomar_pendientes() por /rest/v1/rpc, que se salta los
-- permisos por fila, y llevarse los archivos pendientes de todos.
-- ---------------------------------------------------------------------------

revoke all on function public.tomar_pendientes(integer) from public, anon, authenticated;
revoke all on function public.uuid_o_nulo(text) from public, anon;

-- Que no vuelva a pasar con la próxima función: en public nada nace
-- ejecutable por anon ni por authenticated, ni legible por anon. Cada
-- migración concede lo que haga falta, explícitamente.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- 2. Políticas que calculan «quién soy» una vez por consulta y no por fila.
--
-- auth.uid() y las funciones de rol no dependen de la fila, pero Postgres las
-- vuelve a evaluar en cada una salvo que vayan dentro de (select …). Mismo
-- resultado; con miles de comprobantes, mucho menos trabajo.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['empresas', 'areas', 'proyectos', 'tipos_comprobante', 'conceptos'] loop
    execute format('alter policy leer on public.%I using ((select public.persona_activa()))', t);
    execute format('alter policy crear on public.%I with check ((select public.es_admin()))', t);
    execute format('alter policy cambiar on public.%I using ((select public.es_admin())) with check ((select public.es_admin()))', t);
  end loop;
end $$;

alter policy leer on public.personas
  using (id = (select auth.uid()) or (select public.es_admin()));
alter policy cambiar on public.personas
  using ((select public.es_admin())) with check ((select public.es_admin()));

alter policy leer on public.cajas
  using ((administrador_id = (select auth.uid()) and (select public.persona_activa()))
         or (select public.es_admin()));
alter policy crear on public.cajas with check ((select public.es_admin()));
alter policy cambiar on public.cajas
  using ((select public.es_admin())) with check ((select public.es_admin()));

alter policy leer on public.rendiciones
  using ((responsable_id = (select auth.uid()) and (select public.persona_activa()))
         or (select public.es_admin()));
alter policy crear on public.rendiciones
  with check (
    (select public.persona_activa()) and (
      (select public.es_admin())
      or (tipo = 'memo' and responsable_id = (select auth.uid()))
      or (tipo = 'caja' and responsable_id = (select auth.uid()))));
alter policy cambiar on public.rendiciones
  using ((responsable_id = (select auth.uid()) and (select public.persona_activa()))
         or (select public.es_admin()))
  with check ((responsable_id = (select auth.uid()) and (select public.persona_activa()))
              or (select public.es_admin()));

alter policy leer on public.procesador_estado using ((select public.persona_activa()));
alter policy leer on public.ejemplos_concepto using ((select public.es_admin()));

-- ---------------------------------------------------------------------------
-- 3. Índices para las claves foráneas. Las tablas son chicas hoy; cuestan
-- nada ahora y evitan recorridos completos cuando crezcan.
-- ---------------------------------------------------------------------------

create index archivos_subido_por on public.archivos (subido_por);
create index cajas_administrador on public.cajas (administrador_id);
create index cajas_area on public.cajas (area_id);
create index cajas_empresa on public.cajas (empresa_id);
create index comprobantes_archivo on public.comprobantes (archivo_id);
create index comprobantes_area on public.comprobantes (area_id);
create index comprobantes_concepto on public.comprobantes (concepto_id);
create index comprobantes_creado_por on public.comprobantes (creado_por);
create index comprobantes_proyecto on public.comprobantes (proyecto_id);
create index comprobantes_tipo on public.comprobantes (tipo_comprobante_id);
create index ejemplos_concepto_concepto on public.ejemplos_concepto (concepto_id);
create index personas_area on public.personas (area_id);
