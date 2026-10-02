-- Los recordatorios del bot se envían hasta las 9 p. m. (antes 8 p. m.)
update public.config set valor = '21' where clave = 'horario_fin' and valor = '20';
insert into public.config (clave, valor) values ('horario_fin', '21') on conflict (clave) do nothing;

-- Tiempo real de los chats: asegura que estas tablas estén en la publicación de Supabase Realtime (idempotente)
do $$
declare t text;
begin
  foreach t in array array['mensajes', 'conversaciones', 'notificaciones', 'pedidos'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
