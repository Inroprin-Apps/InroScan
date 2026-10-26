-- InroScan · imágenes de comprobantes
--
-- Bucket privado. Es tránsito, no archivo: al enviar la rendición, el
-- procesador copia cada imagen a Drive, y al aprobarse la borra de acá después
-- de verificar la copia. Drive es donde quedan.
--
-- Ruta: <rendicion_id>/<client_id>.<ext>. La carpeta decide la rendición, y
-- con ella quién puede subir y quién puede ver.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes', 'comprobantes', false,
  -- Una foto comprimida en el teléfono pesa unos 300 KB; un PDF escaneado de
  -- varias páginas puede pesar bastante más.
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Una ruta mal formada no debe romper la evaluación de la política para todo
-- el bucket: se descarta en vez de lanzar un error de conversión.
create function public.uuid_o_nulo(texto text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return texto::uuid;
exception when invalid_text_representation then
  return null;
end $$;

grant execute on function public.uuid_o_nulo(text) to authenticated;

create policy "comprobantes: subir a una rendición editable"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and public.puede_editar(public.uuid_o_nulo((storage.foldername(name))[1])));

create policy "comprobantes: ver las de rendiciones visibles"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and public.puede_ver(public.uuid_o_nulo((storage.foldername(name))[1])));

-- Sin UPDATE ni DELETE para personas: una imagen subida no se reemplaza ni se
-- borra, se descarta su comprobante. El borrado lo hace el procesador.
