-- El admin puede subir fotos al bucket privado "comprobantes" (carpeta salientes/) para enviarlas desde el chat del micrositio
drop policy if exists comprobantes_admin_insert on storage.objects;
create policy comprobantes_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and public.is_admin());
