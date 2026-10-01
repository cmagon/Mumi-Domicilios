-- Bandeja de chats tipo WhatsApp en el micrositio: responder como persona, no leídos, imágenes y avisos por chat.

-- Mensajes escritos por una persona del equipo desde el micrositio; imágenes recibidas (comprobantes) enlazadas al mensaje
alter table public.mensajes drop constraint if exists mensajes_rol_check;
alter table public.mensajes add constraint mensajes_rol_check check (rol in ('user', 'assistant', 'admin'));
alter table public.mensajes add column if not exists media_path text;

-- Hasta cuándo el admin ha leído cada chat
alter table public.conversaciones add column if not exists admin_leido_en timestamptz;

-- Una fila por cliente: último mensaje, no leídos, avisos pendientes y estado de la última sesión
create or replace view public.chats_bandeja with (security_invoker = true) as
select t.telefono, c.nombre_wa, coalesce(c.humano, false) as humano, c.humano_desde, c.admin_leido_en,
       lm.contenido as ultimo_contenido, lm.rol as ultimo_rol, lm.creado_en as ultimo_en,
       uc.creado_en as ultimo_cliente_en,
       (select count(*) from public.mensajes m where m.telefono = t.telefono and m.rol = 'user'
           and m.creado_en > coalesce(c.admin_leido_en, 'epoch'::timestamptz)) as no_leidos,
       (select count(*) from public.notificaciones n where n.telefono = t.telefono and not n.leida) as avisos,
       (select array_agg(distinct n.tipo) from public.notificaciones n where n.telefono = t.telefono and not n.leida) as tipos_avisos,
       s.vendida as ult_vendida, s.escalada as ult_escalada, s.pidio_sin_stock as ult_sin_stock,
       s.resultado as ult_resultado, s.motivo as ult_motivo, s.etapa as ult_etapa, s.resumen as ult_resumen, s.fin as ult_fin, s.pedido_numero as ult_pedido
  from (select distinct telefono from public.mensajes) t
  left join public.conversaciones c on c.telefono = t.telefono
  left join lateral (select m.contenido, m.rol, m.creado_en from public.mensajes m where m.telefono = t.telefono order by m.creado_en desc limit 1) lm on true
  left join lateral (select m.creado_en from public.mensajes m where m.telefono = t.telefono and m.rol = 'user' order by m.creado_en desc limit 1) uc on true
  left join lateral (select * from public.chat_sesiones x where x.telefono = t.telefono order by x.inicio desc limit 1) s on true;

-- Tiempo real para la bandeja
do $$
declare t text;
begin
  foreach t in array array['mensajes', 'conversaciones', 'notificaciones'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
